import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, JSON
from database import Base


class Variant(Base):
    __tablename__ = "variants"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_id = Column(String, ForeignKey("strategies.id"), nullable=False, index=True)
    parent_variant_id = Column(String, ForeignKey("variants.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    hypothesis = Column(String, default="")
    changes = Column(String, default="")
    change_reason = Column(String, default="")
    decision = Column(String, default="")
    key_change = Column(String, default="")  # une ligne : le delta principal de cette itération
    status = Column(String, default="idea")  # idea | ready_to_test | testing | active | validated | rejected | archived | abandoned
    created_at = Column(DateTime, default=datetime.utcnow)
    aggregate_metrics = Column(JSON, nullable=True)
