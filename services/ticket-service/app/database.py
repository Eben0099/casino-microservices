import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base

# L'URL correspond aux identifiants définis dans le docker-compose.yml
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://casino_admin:super_secret_password@postgres:5432/casino_ticket_db"
)

# Pool tunable via env (defaults sized for ~500 tickets/s on a single worker).
# In production, multiply by replicas to size Postgres `max_connections` accordingly.
POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "20"))
POOL_MAX_OVERFLOW = int(os.getenv("DB_POOL_MAX_OVERFLOW", "20"))
SQL_ECHO = os.getenv("SQL_ECHO", "false").lower() == "true"

engine = create_async_engine(
    DATABASE_URL,
    echo=SQL_ECHO,
    pool_size=POOL_SIZE,
    max_overflow=POOL_MAX_OVERFLOW,
    pool_pre_ping=True,
    pool_recycle=1800,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

Base = declarative_base()

# Dépendance FastAPI pour injecter la session dans nos routes
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
