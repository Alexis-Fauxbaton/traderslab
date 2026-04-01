import uuid

from sqlalchemy import Column, String, DateTime, Float, ForeignKey
from database import Base


class Trade(Base):
    __tablename__ = "trades"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = Column(String, ForeignKey("runs.id"), nullable=False, index=True)
    open_time = Column(DateTime, nullable=False)
    close_time = Column(DateTime, nullable=False, index=True)
    symbol = Column(String, nullable=False)
    side = Column(String, nullable=False)  # long | short
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float, nullable=False)
    lot_size = Column(Float, nullable=False)
    pnl = Column(Float, nullable=False)
    pips = Column(Float, nullable=True)
