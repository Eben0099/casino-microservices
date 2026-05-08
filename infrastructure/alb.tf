# 1. Le garde-du-corps de l'ALB (Autorise tout le monde sur le port 80 HTTP)
resource "aws_security_group" "alb" {
  name        = "casino-alb-sg"
  description = "Autorise le trafic HTTP public"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "casino-alb-sg" }
}

# 2. Mise a jour du garde-du-corps de nos futurs conteneurs
# On dit : "Les conteneurs acceptent le trafic, MAIS UNIQUEMENT s'il vient de l'ALB"
resource "aws_security_group_rule" "alb_to_ecs" {
  type                     = "ingress"
  from_port                = 0 # On autorise tous les ports car tes microservices ont des ports différents (ex: 5173, 8000, etc.)
  to_port                  = 65535
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.alb.id
}

# 3. L'Application Load Balancer (ALB)
resource "aws_lb" "main" {
  name               = "casino-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  # Il doit être dans les sous-réseaux publics pour être vu d'Internet
  subnets            = [aws_subnet.public_1.id, aws_subnet.public_2.id]

  tags = { Name = "casino-alb" }
}

# 4. Le groupe cible (Target Group) pour ton Backoffice Web
# C'est la liste d'attente où l'ALB va envoyer les requêtes web
resource "aws_lb_target_group" "web" {
  name        = "casino-tg-web"
  port        = 5173 # Le port de Vite (React)
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # Indispensable pour Fargate

  health_check {
    path                = "/status"
    healthy_threshold   = 2
    unhealthy_threshold = 10
    timeout             = 5
    interval            = 10
  }
}

# 4bis. Le groupe cible (Target Group) pour l'interface Agent Web
resource "aws_lb_target_group" "agent_web" {
  name        = "casino-tg-agent-web"
  port        = 5173 
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/agents/pos"
    healthy_threshold   = 2
    unhealthy_threshold = 10
    timeout             = 5
    interval            = 10
  }
}

# 5. L'écouteur (Listener) principal
# L'ALB écoute sur le port 80 et envoie tout vers le Backoffice Web par défaut
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# 5bis. Règle pour l'interface Agent
resource "aws_lb_listener_rule" "agent_web" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 5 # Priorité plus haute que le défaut

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.agent_web.arn
  }

  condition {
    path_pattern {
      values = ["/agents/pos*"]
    }
  }
}

# 5ter. Règle WebSocket /ws/roulette* — utilisée par le backoffice admin et l'agent POS
# pour la connexion live au moteur de roulette (phase, result_revealed, stats).
resource "aws_lb_listener_rule" "roulette_ws" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 6

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backends["game-roulette-service"].arn
  }

  condition {
    path_pattern {
      values = ["/ws/roulette*"]
    }
  }
}

# --- ZONES D'ATTENTE (TARGET GROUPS) POUR LES BACKENDS ---
resource "aws_lb_target_group" "backends" {
  for_each    = local.microservices
  name        = "tg-${each.key}"
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id 

  health_check {
    path                = "/status"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

# --- RÈGLES DE L'AIGUILLEUR (LISTENER RULES) ---
resource "aws_lb_listener_rule" "backends" {
  for_each     = local.microservices
  listener_arn = aws_lb_listener.http.arn 
  priority     = 10 + index(keys(local.microservices), each.key)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backends[each.key].arn
  }

  condition {
    path_pattern {
      values = [each.value.path]
    }
  }
}