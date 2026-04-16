# 1. Dépôt pour le service Agent (Banque)
resource "aws_ecr_repository" "agent_service" {
  name                 = "casino-agent-service"
  image_tag_mutability = "MUTABLE"
  
  # EXPLICATION CLOUD : force_delete = true est crucial pour l'apprentissage. 
  # Sur AWS, on ne peut pas détruire un dépôt ECR s'il contient des images. 
  # Cette option forcera la suppression, ce qui nous permettra d'utiliser "terraform destroy" 
  # le soir sans que ça bloque, pour économiser ton budget !
  force_delete         = true 
}

# 2. Dépôt pour le service Ticket (Guichet)
resource "aws_ecr_repository" "ticket_service" {
  name                 = "casino-ticket-service"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# 3. Dépôt pour le service Game (Moteur de Roulette)
resource "aws_ecr_repository" "game_service" {
  name                 = "casino-game-roulette-service"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# 4. Dépôt pour le service Display (Écran TV)
resource "aws_ecr_repository" "display_service" {
  name                 = "casino-display-service"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# On peut même faire créer le dépôt pour le frontend web si tu veux le déployer en conteneur !
resource "aws_ecr_repository" "backoffice_web" {
  name                 = "casino-backoffice-web"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}