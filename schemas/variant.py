from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum
from typing import Any


class VariantStatus(str, Enum):
    idea = "idea"
    ready_to_test = "ready_to_test"
    testing = "testing"
    active = "active"
    validated = "validated"
    rejected = "rejected"
    archived = "archived"
    abandoned = "abandoned"  # rétrocompat


class VariantCreate(BaseModel):
    strategy_id: str
    parent_variant_id: str | None = None
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    hypothesis: str = Field(default="", max_length=2000)
    changes: str = Field(default="", max_length=2000)
    change_reason: str = Field(default="", max_length=2000)
    decision: str = Field(default="", max_length=2000)
    key_change: str = Field(default="", max_length=500)
    status: VariantStatus = VariantStatus.idea


class VariantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    hypothesis: str | None = Field(default=None, max_length=2000)
    changes: str | None = Field(default=None, max_length=2000)
    change_reason: str | None = Field(default=None, max_length=2000)
    decision: str | None = Field(default=None, max_length=2000)
    key_change: str | None = Field(default=None, max_length=500)
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
    key_change: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class VariantDetail(VariantOut):
    """Variante avec ses runs inclus."""
    runs: list["RunOut"] = []


class VariantDetailEnriched(VariantDetail):
    """Variante enrichie — réduit les round-trips frontend."""
    strategy_name: str | None = None
    parent_variant_name: str | None = None
    aggregate_metrics: dict[str, Any] | None = None
    lineage: "VariantLineageNode | None" = None


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
VariantDetailEnriched.model_rebuild()
VariantLineageNode.model_rebuild()
