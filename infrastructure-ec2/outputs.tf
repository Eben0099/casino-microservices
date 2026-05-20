output "ec2_public_ip" {
  description = "Elastic IP of the application server"
  value       = aws_eip.app.public_ip
}

output "ec2_public_dns" {
  description = "AWS-default public DNS of the EC2 (use this with sslip.io if you want HTTPS later)"
  value       = aws_instance.app.public_dns
}

output "ec2_sslip_hostname" {
  description = "Auto-resolving hostname for Let's Encrypt later (no domain purchase needed)"
  value       = "${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
}

output "rds_endpoint" {
  description = "RDS Postgres hostname (without port)"
  value       = aws_db_instance.postgres.address
}

output "rds_port" {
  description = "RDS Postgres port"
  value       = aws_db_instance.postgres.port
}

output "rds_connection_string_template" {
  description = "Template to paste into the EC2 .env (replace <PG_PASSWORD>)"
  value       = "postgresql+asyncpg://postgres:<PG_PASSWORD>@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/postgres"
  sensitive   = false
}

output "ssh_command" {
  description = "Shell command to SSH into the instance"
  value = var.ssh_key_name != "" ? "ssh -i ~/.ssh/${var.ssh_key_name}.pem ubuntu@${aws_eip.app.public_ip}" : "No SSH key set. Configure ssh_key_name in tfvars and run terraform apply again."
}

output "next_steps" {
  description = "Post-apply checklist"
  value       = <<-EOT

  Infrastructure is up. Now:

  1. Wait ~2 minutes for user-data to finish installing Docker:
       ssh ubuntu@${aws_eip.app.public_ip}
       ls /var/log/user-data-done    # sentinel file == ready

  2. From your laptop, push the project (exclude infra + git):
       rsync -av --exclude='.git' \
                 --exclude='infrastructure*' \
                 --exclude='node_modules' \
                 --exclude='__pycache__' \
                 ./ ubuntu@${aws_eip.app.public_ip}:/opt/${var.project_name}/

  3. On the EC2, create an .env file with the secrets that come from this
     terraform run (DO NOT commit it):
       cd /opt/${var.project_name}
       cat > .env <<EOF
       POSTGRES_HOST=${aws_db_instance.postgres.address}
       POSTGRES_PORT=${aws_db_instance.postgres.port}
       POSTGRES_USER=postgres
       POSTGRES_PASSWORD=<the pg_password from terraform.tfvars>
       JWT_SECRET=<the jwt_secret from terraform.tfvars>
       ADMIN_API_KEY=<the admin_api_key from terraform.tfvars>
       EOF

  4. The current docker-compose.yml has hardcoded credentials and a local
     postgres container. Edit it before first run:
       - Remove the 'postgres' service block
       - Remove the 'depends_on: postgres' in services
       - Replace DATABASE_URL values to point at $${POSTGRES_HOST}:$${POSTGRES_PORT}
       - Replace JWT_SECRET / ADMIN_API_KEY with $${JWT_SECRET} / $${ADMIN_API_KEY}

  5. Start the stack:
       docker compose up -d
       docker compose logs -f traefik

  6. Smoke test:
       curl http://${aws_eip.app.public_ip}/
       curl http://${aws_eip.app.public_ip}/api/agents/status
  EOT
}
