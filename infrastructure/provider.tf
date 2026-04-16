terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0" # On utilise la dernière version majeure du plugin AWS
    }
  }
}

# On configure notre fournisseur avec la région choisie précédemment
provider "aws" {
  region = "eu-west-3" # Paris
  
  # C'est une excellente pratique : on ajoute des "tags" automatiques.
  # Toutes les ressources créées sur AWS auront ces étiquettes, très pratique pour voir ce qui coûte de l'argent !
  default_tags {
    tags = {
      Project     = "Casino-Microservices"
      Environment = "Dev"
      ManagedBy   = "Terraform"
    }
  }
}