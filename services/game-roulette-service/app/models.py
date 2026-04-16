from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.sql import func
from .database import Base

class RouletteRound(Base):
    __tablename__ = "roulette_rounds"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(String, unique=True, index=True, nullable=False)
    winning_number = Column(String, nullable=False)
    server_seed = Column(String, nullable=False)
    server_seed_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
