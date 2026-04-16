import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

# On récupère le secret depuis le docker-compose
SECRET_KEY = os.getenv("JWT_SECRET", "secret_par_defaut")
ALGORITHM = "HS256"

# Ce "schéma" indique à FastAPI et Swagger qu'on attend un Bearer Token
security = HTTPBearer()

async def get_current_agent_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Cette fonction agit comme un videur. Elle intercepte le token, le décode, 
    et extrait l'ID de l'agent. Si le token est faux, elle rejette la requête.
    """
    token = credentials.credentials
    try:
        # On tente de décoder mathématiquement le token avec notre clé secrète
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        agent_id: str = payload.get("sub") # 'sub' (subject) contient généralement l'ID de l'utilisateur
        
        if agent_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide : ID manquant")
        
        return agent_id
        
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Signature du token invalide ou token expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )

# --- RÉCUPÉRATION DE LA CLÉ ADMIN ---
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

from fastapi import Header

def verify_admin_key(x_api_key: str = Header(None)):
    """Vérifie que la requête vient bien du Backoffice autorisé"""
    if x_api_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Accès refusé : Clé Admin invalide.")
    return x_api_key
