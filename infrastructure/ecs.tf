# 1. Le Cluster ECS
resource "aws_ecs_cluster" "main" {
  name = "casino-cluster"
}

# --- CONFIGURATION DES ROUTES, IMAGES ET ENVIRONNEMENT ---
locals {
  # Chemins de connexion Postgres communs.
  # admin_db_url pointe sur la DB master 'postgres' utilisee par init_db.py
  # pour creer les bases logiques de chaque service au demarrage.
  pg_user_pass     = "postgres:SuperSecretPassword2026"
  pg_host_port     = "${aws_db_instance.postgres.address}:5432"
  admin_db_url     = "postgresql+asyncpg://${local.pg_user_pass}@${local.pg_host_port}/postgres"
  redis_url        = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379/0"
  jwt_secret       = "MonSuperSecretCasino2026!NePasPartager"
  admin_api_key    = "CleSuperSecreteBackoffice2026"

  microservices = {
    "agent-service" = {
      path           = "/api/agents*"
      repository_url = aws_ecr_repository.agent_service.repository_url
      env = [
        { name = "DATABASE_URL",       value = "postgresql+asyncpg://${local.pg_user_pass}@${local.pg_host_port}/casino_agent_db" },
        { name = "ADMIN_DATABASE_URL", value = local.admin_db_url },
        { name = "JWT_SECRET",         value = local.jwt_secret },
        { name = "ADMIN_API_KEY",      value = local.admin_api_key },
        { name = "ROOT_PATH",          value = "/api/agents" }
      ]
    }
    "game-roulette-service" = {
      path           = "/api/roulette*"
      repository_url = aws_ecr_repository.game_service.repository_url
      env = [
        { name = "DATABASE_URL",       value = "postgresql+asyncpg://${local.pg_user_pass}@${local.pg_host_port}/casino_roulette_db" },
        { name = "ADMIN_DATABASE_URL", value = local.admin_db_url },
        { name = "REDIS_URL",          value = local.redis_url },
        { name = "ADMIN_API_KEY",      value = local.admin_api_key },
        { name = "ROOT_PATH",          value = "/api/roulette" }
      ]
    }
    "ticket-service" = {
      path           = "/api/tickets*"
      repository_url = aws_ecr_repository.ticket_service.repository_url
      env = [
        { name = "DATABASE_URL",       value = "postgresql+asyncpg://${local.pg_user_pass}@${local.pg_host_port}/casino_ticket_db" },
        { name = "ADMIN_DATABASE_URL", value = local.admin_db_url },
        { name = "REDIS_URL",          value = local.redis_url },
        { name = "JWT_SECRET",         value = local.jwt_secret },
        { name = "ADMIN_API_KEY",      value = local.admin_api_key },
        { name = "ROOT_PATH",          value = "/api/tickets" }
      ]
    }
  }
}

# 2. Les permissions pour Fargate (IAM)
data "aws_iam_policy_document" "ecs_task_execution_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name               = "casino-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_execution_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# 3. La centralisation des logs (CloudWatch)
resource "aws_cloudwatch_log_group" "ecs_logs" {
  name              = "/ecs/casino-microservices"
  retention_in_days = 7
}

# 4. La Recette du Conteneur Web (Backoffice)
resource "aws_ecs_task_definition" "web" {
  family                   = "casino-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "web-container"
      image     = "${aws_ecr_repository.backoffice_web.repository_url}:latest"
      essential = true
      portMappings = [
        {
          containerPort = 5173
          hostPort      = 5173
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_logs.name
          "awslogs-region"        = "eu-west-3"
          "awslogs-stream-prefix" = "web"
        }
      }
    }
  ])
}

# 5. Service Web (Backoffice)
resource "aws_ecs_service" "web" {
  name            = "casino-web-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_1.id, aws_subnet.public_2.id]
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true 
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web-container"
    container_port   = 5173
  }
}

# 4bis. La Recette du Conteneur Agent Web
resource "aws_ecs_task_definition" "agent_web" {
  family                   = "casino-agent-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "agent-web-container"
      image     = "${aws_ecr_repository.agent_web.repository_url}:latest"
      essential = true
      portMappings = [
        {
          containerPort = 5173
          hostPort      = 5173
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_logs.name
          "awslogs-region"        = "eu-west-3"
          "awslogs-stream-prefix" = "agent-web"
        }
      }
    }
  ])
}

# 5bis. Service Agent Web
resource "aws_ecs_service" "agent_web" {
  name            = "casino-agent-web-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.agent_web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_1.id, aws_subnet.public_2.id]
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true 
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.agent_web.arn
    container_name   = "agent-web-container"
    container_port   = 5173
  }
}

# --- MODE D'EMPLOI DOCKER (TASK DEFINITIONS) POUR LES BACKENDS ---
resource "aws_ecs_task_definition" "backends" {
  for_each                 = local.microservices
  family                   = "casino-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = "${each.value.repository_url}:latest"
      essential = true
      portMappings = [
        {
          containerPort = 8000
          hostPort      = 8000
          protocol      = "tcp"
        }
      ]
      environment = each.value.env
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_logs.name
          "awslogs-region"        = "eu-west-3"
          "awslogs-stream-prefix" = each.key
        }
      }
    }
  ])
}

# --- GARDIENS FARGATE (ECS SERVICES) POUR LES BACKENDS ---
resource "aws_ecs_service" "backends" {
  for_each        = local.microservices
  name            = "casino-${each.key}-service"
  cluster         = aws_ecs_cluster.main.id 
  task_definition = aws_ecs_task_definition.backends[each.key].arn
  launch_type     = "FARGATE"
  desired_count   = 1

  network_configuration {
    subnets          = [aws_subnet.public_1.id, aws_subnet.public_2.id] 
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true 
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backends[each.key].arn
    container_name   = each.key
    container_port   = 8000
  }
}
