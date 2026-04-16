import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base

# L'URL correspond aux identifiants définis dans le docker-compose.yml
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://casino_admin:super_secret_password@postgres:5432/casino_ticket_db"
)

# Création du moteur asynchrone
engine = create_async_engine(DATABASE_URL, echo=True)

# Création du générateur de sessions
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

Base = declarative_base()

# Dépendance FastAPI pour injecter la session dans nos routes
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
