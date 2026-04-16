# 1. Le groupe de sécurité pour nos futurs conteneurs (Fargate)
resource "aws_security_group" "ecs_tasks" {
  name        = "casino-ecs-tasks-sg"
  description = "Autorise les conteneurs a sortir sur internet"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "casino-ecs-tasks-sg" }
}

# 2. Le groupe de sécurité pour PostgreSQL
resource "aws_security_group" "rds" {
  name        = "casino-rds-sg"
  description = "Acces exclusif pour les conteneurs Fargate"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = { Name = "casino-rds-sg" }
}

# 3. Le groupe de sécurité pour Redis
resource "aws_security_group" "redis" {
  name        = "casino-redis-sg"
  description = "Acces exclusif pour les conteneurs Fargate"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = { Name = "casino-redis-sg" }
}