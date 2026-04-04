"""Router pour le moteur d'analyse V1."""

from __future__ import annotations

from datetime import date, datetime
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models.variant import Variant
from models.strategy import Strategy
from models.run import Run
from models.trade import Trade
from schemas.analysis import VariantAnalysisOut, CompareAnalysisOut
from services.metrics import compute_metrics
from services.analysis import analyze_variant, compare_variants

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _aggregate_trades(variant_id: str, db: Session) -> tuple[list[dict], list[Run]]:
    """Récupère tous les trades agrégés d'une variante."""
    runs = (
        db.query(Run)
        .filter(Run.variant_id == variant_id)
        .order_by(Run.imported_at.asc())
        .all()
    )
    trades = (
        db.query(Trade)
        .join(Run, Trade.run_id == Run.id)
        .filter(Run.variant_id == variant_id)
        .order_by(Trade.close_time)
        .all()
    )
    trade_dicts = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades]
    return trade_dicts, runs


@router.get("/variant/{variant_id}", response_model=VariantAnalysisOut)
def get_variant_analysis(variant_id: str, db: Session = Depends(get_db)):
    """Analyse complète V1 d'une variante."""
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")

    trade_dicts, runs = _aggregate_trades(variant_id, db)
    metrics = compute_metrics(trade_dicts)

    # Contexte enrichi
    strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id).first()
    parent_variant_name = None
    if variant.parent_variant_id:
        parent = db.query(Variant).filter(Variant.id == variant.parent_variant_id).first()
        if parent:
            parent_variant_name = parent.name

    run_types = list({r.type for r in runs if r.type})

    result = analyze_variant(
        metrics,
        run_types=run_types,
        runs_count=len(runs),
        strategy_name=strategy.name if strategy else None,
        variant_name=variant.name,
        parent_variant_name=parent_variant_name,
    )

    return _analysis_to_dict(result)


@router.get("/run/{run_id}", response_model=VariantAnalysisOut)
def get_run_analysis(run_id: str, db: Session = Depends(get_db)):
    """Analyse V1 d'un run individuel."""
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run introuvable")

    trades = (
        db.query(Trade)
        .filter(Trade.run_id == run_id)
        .order_by(Trade.close_time)
        .all()
    )
    trade_dicts = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades]
    metrics = compute_metrics(trade_dicts)

    # Contexte enrichi
    variant = db.query(Variant).filter(Variant.id == run.variant_id).first()
    strategy = None
    if variant:
        strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id).first()

    result = analyze_variant(
        metrics,
        run_types=[run.type] if run.type else [],
        runs_count=1,
        strategy_name=strategy.name if strategy else None,
        variant_name=variant.name if variant else None,
    )

    return _analysis_to_dict(result)


@router.get("/compare", response_model=CompareAnalysisOut)
def get_compare_analysis(
    variant_a: str = Query(...),
    variant_b: str = Query(...),
    db: Session = Depends(get_db),
):
    """Comparaison V1 de deux variantes."""
    va = db.query(Variant).filter(Variant.id == variant_a).first()
    vb = db.query(Variant).filter(Variant.id == variant_b).first()
    if not va:
        raise HTTPException(404, f"Variante A introuvable : {variant_a}")
    if not vb:
        raise HTTPException(404, f"Variante B introuvable : {variant_b}")

    trades_a, _ = _aggregate_trades(variant_a, db)
    trades_b, _ = _aggregate_trades(variant_b, db)

    metrics_a = compute_metrics(trades_a)
    metrics_b = compute_metrics(trades_b)

    result = compare_variants(metrics_a, metrics_b, name_a=va.name, name_b=vb.name)

    return _compare_to_dict(result)


def _analysis_to_dict(result) -> dict:
    """Convertit un VariantAnalysis (dataclass) en dict sérialisable."""
    d = asdict(result)
    # Retirer le score interne
    d.pop("_internal_score", None)
    # Convertir les enums en valeurs
    d["verdict"] = result.verdict.value
    d["confidence"] = result.confidence.value
    d["action"]["primary"] = result.action.primary.value
    if result.regularity:
        d["regularity"]["level"] = result.regularity.level.value
    for w in d["warnings"]:
        w["family"] = w["family"].value if hasattr(w["family"], "value") else w["family"]
    return d


def _compare_to_dict(result) -> dict:
    """Convertit un CompareAnalysis (dataclass) en dict sérialisable."""
    d = asdict(result)
    d["decision"] = result.decision.value
    for b in d["badges"]:
        b["badge"] = b["badge"].value if hasattr(b["badge"], "value") else b["badge"]
    for w in d["warnings"]:
        w["family"] = w["family"].value if hasattr(w["family"], "value") else w["family"]
    return d
