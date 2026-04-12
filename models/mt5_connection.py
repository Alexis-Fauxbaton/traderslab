import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Date, Float, ForeignKey
from database import Base


class MT5Connection(Base):
    __tablename__ = "mt5_connections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    variant_id = Column(String, ForeignKey("variants.id"), nullable=False, index=True)
    run_id = Column(String, ForeignKey("runs.id"), nullable=True)
    metaapi_account_id = Column(String, nullable=True)
    mt5_login = Column(String, nullable=False)
    mt5_server = Column(String, nullable=False)
    platform = Column(String, default="mt5")          # mt5 | mt4
    status = Column(String, default="pending")         # pending | deploying | connected | syncing | error | disconnected
    currency = Column(String, nullable=True)
    initial_balance = Column(Float, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    error_message = Column(String, nullable=True)
    investor_password_enc = Column(String, nullable=True)
    sync_from = Column(Date, nullable=True)
    sync_to = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
