import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Date, Float, ForeignKey
from database import Base


class BinanceConnection(Base):
    __tablename__ = "binance_connections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    variant_id = Column(String, ForeignKey("variants.id"), nullable=False, index=True)
    run_id = Column(String, ForeignKey("runs.id"), nullable=True)
    api_key_enc = Column(String, nullable=False)
    api_secret_enc = Column(String, nullable=False)
    account_type = Column(String, default="futures_usdm")  # futures_usdm | spot
    status = Column(String, default="pending")              # pending | connected | syncing | error | disconnected
    currency = Column(String, default="USDT")
    initial_balance = Column(Float, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    error_message = Column(String, nullable=True)
    sync_from = Column(Date, nullable=True)
    sync_to = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
