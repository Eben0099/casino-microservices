import os
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET environment variable is required")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480 # 8 heures

# Schéma Bearer pour FastAPI/Swagger
security = HTTPBearer()

def create_access_token(data: dict) -> str:
    """Génère un Token JWT signé mathématiquement"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_agent_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Intercepte le token Bearer, le décode, et extrait l'ID de l'agent.
    Rejette la requête si le token est invalide ou expiré.
    """
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        agent_id: str = payload.get("sub")

        if agent_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide : ID manquant")

        return agent_id

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Signature du token invalide ou token expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY")
if not ADMIN_API_KEY:
    raise RuntimeError("ADMIN_API_KEY environment variable is required")

def verify_admin_key(x_api_key: str = Header(None)):
    """Vérifie que la requête vient bien du Backoffice autorisé"""
    if x_api_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Accès refusé : Clé Admin invalide.")
    return x_api_key
