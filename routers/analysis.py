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
from models.user import User
from schemas.analysis import VariantAnalysisOut, CompareAnalysisOut
from services.metrics import compute_metrics
from services.analysis import analyze_variant, compare_variants, compute_verdict_only
from services.auth import get_current_user

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
def get_variant_analysis(variant_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Analyse complète V1 d'une variante."""
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Variante introuvable")

    trade_dicts, runs = _aggregate_trades(variant_id, db)
    initial_balance = runs[0].initial_balance if runs and runs[0].initial_balance else 10_000.0
    metrics = compute_metrics(trade_dicts, initial_balance=initial_balance)

    # Contexte enrichi
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
def get_run_analysis(run_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Analyse V1 d'un run individuel."""
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run introuvable")
    # Verify ownership
    variant = db.query(Variant).filter(Variant.id == run.variant_id).first()
    if variant:
        s = db.query(Strategy).filter(Strategy.id == variant.strategy_id, Strategy.user_id == current_user.id).first()
        if not s:
            raise HTTPException(404, "Run introuvable")

    trades = (
        db.query(Trade)
        .filter(Trade.run_id == run_id)
        .order_by(Trade.close_time)
        .all()
    )
    trade_dicts = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades]
    initial_balance = run.initial_balance if run.initial_balance else 10_000.0
    metrics = compute_metrics(trade_dicts, initial_balance=initial_balance)

    # Contexte enrichi — variant & strategy already loaded above
    strategy = s

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
    current_user: User = Depends(get_current_user),
):
    """Comparaison V1 de deux variantes."""
    va = db.query(Variant).filter(Variant.id == variant_a).first()
    vb = db.query(Variant).filter(Variant.id == variant_b).first()
    if not va:
        raise HTTPException(404, f"Variante A introuvable : {variant_a}")
    if not vb:
        raise HTTPException(404, f"Variante B introuvable : {variant_b}")
    sa = db.query(Strategy).filter(Strategy.id == va.strategy_id, Strategy.user_id == current_user.id).first()
    sb = db.query(Strategy).filter(Strategy.id == vb.strategy_id, Strategy.user_id == current_user.id).first()
    if not sa:
        raise HTTPException(404, f"Variante A introuvable : {variant_a}")
    if not sb:
        raise HTTPException(404, f"Variante B introuvable : {variant_b}")

    trades_a, runs_a = _aggregate_trades(variant_a, db)
    trades_b, runs_b = _aggregate_trades(variant_b, db)

    ib_a = runs_a[0].initial_balance if runs_a and runs_a[0].initial_balance else 10_000.0
    ib_b = runs_b[0].initial_balance if runs_b and runs_b[0].initial_balance else 10_000.0
    metrics_a = compute_metrics(trades_a, initial_balance=ib_a)
    metrics_b = compute_metrics(trades_b, initial_balance=ib_b)

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


@router.get("/verdicts/{strategy_id}")
def get_strategy_verdicts(strategy_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retourne le verdict léger pour chaque variante d'une stratégie."""
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")

    variants = db.query(Variant).filter(Variant.strategy_id == strategy_id).all()
    result = {}
    for v in variants:
        metrics = v.aggregate_metrics
        if metrics and metrics.get("total_trades", 0) > 0:
            verdict_val, verdict_label = compute_verdict_only(metrics)
            result[v.id] = {"verdict": verdict_val, "verdict_label": verdict_label}
    return result
