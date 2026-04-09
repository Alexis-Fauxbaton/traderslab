from pydantic import BaseModel
from datetime import datetime


class StrategyCreate(BaseModel):
    name: str
    description: str = ""
    pairs: list[str] = []
    timeframes: list[str] = []


class StrategyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    pairs: list[str] | None = None
    timeframes: list[str] | None = None


class StrategyOut(BaseModel):
    id: str
    name: str
    description: str
    pairs: list[str]
    timeframes: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class StrategyDetail(StrategyOut):
    """Stratégie avec ses variantes incluses."""
    variants: list["VariantOut"] = []


from schemas.variant import VariantOut  # noqa: E402

StrategyDetail.model_rebuild()
