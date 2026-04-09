import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Date, Float, ForeignKey, JSON
from database import Base


class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    variant_id = Column(String, ForeignKey("variants.id"), nullable=False, index=True)
    label = Column(String, nullable=False)
    type = Column(String, nullable=False)  # backtest | forward | live
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    imported_at = Column(DateTime, default=datetime.utcnow)
    initial_balance = Column(Float, nullable=True, default=10000.0)
    currency = Column(String, nullable=True, default="USD")
    currency_source = Column(String, nullable=True, default="detected")  # detected | inherited
    timeframe = Column(String, nullable=True)
    pairs = Column(JSON, nullable=True)     # auto-detected from trades: ["EURUSD", "GBPUSD"]
    metrics = Column(JSON, nullable=True)
