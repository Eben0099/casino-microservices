from sqlalchemy import Column, String, Integer, DateTime, JSON
from sqlalchemy.sql import func
from .database import Base


class KenoDraw(Base):
    """Persists every Keno draw for provably-fair audit via /verify/{round_id}."""
    __tablename__ = "keno_draws"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, unique=True, index=True, nullable=False)
    server_seed = Column(String, nullable=False)
    server_seed_hash = Column(String, nullable=False)
    # JSON list of 20 integers in reveal order [1..80]
    drawn_numbers = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
