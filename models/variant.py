import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey
from database import Base


class Variant(Base):
    __tablename__ = "variants"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_id = Column(String, ForeignKey("strategies.id"), nullable=False)
    parent_variant_id = Column(String, ForeignKey("variants.id"), nullable=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    hypothesis = Column(String, default="")
    changes = Column(String, default="")
    change_reason = Column(String, default="")
    decision = Column(String, default="")
    status = Column(String, default="active")  # active | testing | archived | abandoned
    created_at = Column(DateTime, default=datetime.utcnow)
