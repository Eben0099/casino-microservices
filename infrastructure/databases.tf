# --- CONFIGURATION DU RÉSEAU POUR LES DB ---
# On dit à AWS dans quels sous-réseaux (privés) il a le droit de placer nos bases de données
resource "aws_db_subnet_group" "default" {
  name       = "casino-db-subnet-group"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]
}

resource "aws_elasticache_subnet_group" "default" {
  name       = "casino-redis-subnet-group"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]
}

# --- 1. POSTGRESQL (AMAZON RDS) ---
resource "aws_db_instance" "postgres" {
  identifier           = "casino-db"
  allocated_storage    = 20
  engine               = "postgres"
  engine_version       = "15" # Une version très stable
  instance_class       = "db.t3.micro" # 🚨 Éligible Free Tier
  
  # Identifiants (En production, on utiliserait AWS Secrets Manager)
  db_name              = "casino_db"
  username             = "postgres"
  password             = "SuperSecretPassword2026"
  
  # Configuration réseau et sécurité
  db_subnet_group_name   = aws_db_subnet_group.default.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # Totalement invisible depuis internet

  # 🚨 CRUCIAL POUR L'APPRENTISSAGE : 
  # Sans ça, "terraform destroy" refuse de supprimer la DB sans faire une sauvegarde finale (ce qui bloque tout et peut coûter de l'argent).
  skip_final_snapshot    = true 
}

# --- 2. REDIS (AMAZON ELASTICACHE) ---
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "casino-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro" # 🚨 Éligible Free Tier
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379

  # Configuration réseau et sécurité
  subnet_group_name    = aws_elasticache_subnet_group.default.name
  security_group_ids   = [aws_security_group.redis.id]
}