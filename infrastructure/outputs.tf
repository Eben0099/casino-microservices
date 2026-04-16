output "application_url" {
  description = "L'URL publique de ton Casino"
  value       = "http://${aws_lb.main.dns_name}"
}