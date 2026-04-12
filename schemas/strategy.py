from pydantic import BaseModel, Field
from datetime import datetime


class StrategyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    pairs: list[str] = Field(default=[], max_length=50)
    timeframes: list[str] = Field(default=[], max_length=20)


class StrategyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    pairs: list[str] | None = Field(default=None, max_length=50)
    timeframes: list[str] | None = Field(default=None, max_length=20)


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
