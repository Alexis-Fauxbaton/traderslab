from pydantic import BaseModel
from datetime import datetime
from enum import Enum


class VariantStatus(str, Enum):
    active = "active"
    testing = "testing"
    archived = "archived"
    abandoned = "abandoned"


class VariantCreate(BaseModel):
    strategy_id: str
    parent_variant_id: str | None = None
    name: str
    description: str = ""
    hypothesis: str = ""
    changes: str = ""
    change_reason: str = ""
    decision: str = ""
    status: VariantStatus = VariantStatus.active


class VariantUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    hypothesis: str | None = None
    changes: str | None = None
    change_reason: str | None = None
    decision: str | None = None
    status: VariantStatus | None = None


class VariantOut(BaseModel):
    id: str
    strategy_id: str
    parent_variant_id: str | None
    name: str
    description: str
    hypothesis: str
    changes: str
    change_reason: str
    decision: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class VariantDetail(VariantOut):
    """Variante avec ses runs inclus."""
    runs: list["RunOut"] = []


class VariantLineageNode(BaseModel):
    """Nœud dans l'arbre de lignée d'une variante."""
    id: str
    name: str
    status: str
    hypothesis: str
    changes: str
    change_reason: str
    decision: str
    parent_variant_id: str | None
    children: list["VariantLineageNode"] = []


from schemas.run import RunOut  # noqa: E402

VariantDetail.model_rebuild()
VariantLineageNode.model_rebuild()
