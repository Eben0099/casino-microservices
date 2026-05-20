resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]

  tags = { Name = "${var.project_name}-db-subnet-group" }
}

resource "aws_db_instance" "postgres" {
  identifier = "${var.project_name}-db"

  engine         = "postgres"
  engine_version = "15"
  instance_class = var.rds_instance_class

  allocated_storage     = var.rds_allocated_storage
  max_allocated_storage = 0
  storage_type          = "gp2"
  storage_encrypted     = true

  # Master DB only; the apps' init_db.py creates per-service logical DBs
  # at startup (casino_agent_db, casino_roulette_db, casino_ticket_db).
  db_name  = "postgres"
  username = "postgres"
  password = var.pg_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # 0 = no automated backups. Free Plan accounts restrict retention.
  # Bump to 7 once you upgrade to Paid Plan (recommended — gives same $200 credits + no auto-close at M+6).
  backup_retention_period = 0
  maintenance_window      = "sun:04:00-sun:05:00"

  performance_insights_enabled = false
  monitoring_interval          = 0

  skip_final_snapshot = true
  deletion_protection = false

  tags = { Name = "${var.project_name}-db" }
}
