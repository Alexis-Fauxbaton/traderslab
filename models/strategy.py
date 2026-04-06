import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, JSON
from database import Base


class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(String, default="")
    pairs = Column(JSON, nullable=False, default=list)
    timeframes = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    aggregate_metrics = Column(JSON, nullable=True)
