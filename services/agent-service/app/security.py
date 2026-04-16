import os
from datetime import datetime, timedelta
from jose import jwt

# On récupère LA MÊME clé secrète que le ticket-service !
SECRET_KEY = os.getenv("JWT_SECRET", "MonSuperSecretCasino2026!NePasPartager")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480 # 8 heures

def create_access_token(data: dict) -> str:
    """Génère un Token JWT signé mathématiquement"""
    to_encode = data.copy()
    
    # On ajoute la date d'expiration au token
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    
    # On signe le token avec notre clé secrète
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
