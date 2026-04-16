# 1. Le VPC : Notre grand terrain vierge
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16" # Cela nous donne 65 536 adresses IP privées
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "casino-vpc"
  }
}

# 2. La Porte d'entrée Internet
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "casino-igw"
  }
}

# 3. Les Sous-réseaux (Subnets) PUBLICS
# AWS exige d'être sur au moins 2 zones géographiques (Availability Zones) différentes pour la haute disponibilité.
resource "aws_subnet" "public_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "eu-west-3a"
  map_public_ip_on_launch = true # Les ressources ici auront une IP publique

  tags = { Name = "casino-public-eu-west-3a" }
}

resource "aws_subnet" "public_2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "eu-west-3b"
  map_public_ip_on_launch = true

  tags = { Name = "casino-public-eu-west-3b" }
}

# 4. Les Sous-réseaux (Subnets) PRIVÉS (Pour nos Bases de Données)
resource "aws_subnet" "private_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "eu-west-3a"
  
  tags = { Name = "casino-private-eu-west-3a" }
}

resource "aws_subnet" "private_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.4.0/24"
  availability_zone = "eu-west-3b"

  tags = { Name = "casino-private-eu-west-3b" }
}

# 5. La table de routage (Le GPS du réseau)
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  # On dit que tout le trafic sortant (0.0.0.0/0) va vers la porte Internet
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = { Name = "casino-public-rt" }
}

# On associe le GPS à nos sous-réseaux publics
resource "aws_route_table_association" "public_1" {
  subnet_id      = aws_subnet.public_1.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_2" {
  subnet_id      = aws_subnet.public_2.id
  route_table_id = aws_route_table.public.id
}