"""Schémas Pydantic pour le moteur d'analyse V1."""

from pydantic import BaseModel
from typing import Any


class WarningOut(BaseModel):
    code: str
    family: str
    title: str
    message: str


class RecommendedActionOut(BaseModel):
    primary: str
    primary_label: str
    secondary: str | None = None


class RegularityOut(BaseModel):
    level: str
    label: str
    phrase: str


class VariantAnalysisOut(BaseModel):
    verdict: str
    verdict_label: str
    synthesis: str
    action: RecommendedActionOut
    confidence: str
    confidence_label: str
    regularity: RegularityOut | None = None
    warnings: list[WarningOut]
    context: dict[str, Any]
    kpis_primary: dict[str, Any]
    kpis_secondary: dict[str, Any]


class CompareBadgeOut(BaseModel):
    badge: str
    label: str
    winner: str
    winner_name: str


class CompareAnalysisOut(BaseModel):
    verdict: str
    decision: str
    decision_label: str
    badges: list[CompareBadgeOut]
    kpi_table: list[dict[str, Any]]
    warnings: list[WarningOut]
