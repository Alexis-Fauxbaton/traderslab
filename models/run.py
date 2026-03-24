import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Date, ForeignKey, JSON
from database import Base


class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    variant_id = Column(String, ForeignKey("variants.id"), nullable=False)
    label = Column(String, nullable=False)
    type = Column(String, nullable=False)  # backtest | forward | live
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    imported_at = Column(DateTime, default=datetime.utcnow)
    metrics = Column(JSON, nullable=True)
