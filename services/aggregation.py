"""Service de pré-calcul et persistance des métriques agrégées (variant / strategy)."""

import logging

from sqlalchemy.orm import Session

from models.run import Run
from models.trade import Trade
from models.variant import Variant
from models.strategy import Strategy
from services.metrics import compute_metrics

logger = logging.getLogger(__name__)

MAX_EQUITY_POINTS = 50  # sparkline dashboard


def _downsample(points: list, max_pts: int = MAX_EQUITY_POINTS) -> list:
    if not points or len(points) <= max_pts:
        return points
    step = len(points) / max_pts
    indices = [int(i * step) for i in range(max_pts)]
    indices[-1] = len(points) - 1
    return [points[i] for i in dict.fromkeys(indices)]


# Clés « Pro » ajoutées après le MVP — servent de sentinelle pour la migration lazy.
_PRO_METRIC_KEYS = {"consistency_score", "ttest", "monte_carlo", "split_half", "sortino_ratio"}


def _run_metrics_stale(metrics: dict | None) -> bool:
    """Retourne True si les métriques d'un run ne contiennent pas les clés Pro."""
    if not metrics:
        return True
    return not _PRO_METRIC_KEYS.issubset(metrics.keys())


def recompute_run_metrics(run_id: str, db: Session) -> dict | None:
    """Recalcule et persiste les métriques d'un run individuel."""
    trades = (
        db.query(Trade)
        .filter(Trade.run_id == run_id)
        .order_by(Trade.close_time)
        .all()
    )
    trades_data = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades]
    metrics = compute_metrics(trades_data) if trades_data else None

    run = db.query(Run).filter(Run.id == run_id).first()
    if run and metrics:
        run.metrics = metrics
        db.flush()
    return metrics


def recompute_variant_metrics(variant_id: str, db: Session) -> dict | None:
    """Recalcule et persiste les métriques agrégées d'une variante. Retourne les métriques."""
    trades = (
        db.query(Trade)
        .join(Run, Trade.run_id == Run.id)
        .filter(Run.variant_id == variant_id)
        .order_by(Trade.close_time)
        .all()
    )
    trades_data = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades]
    metrics = compute_metrics(trades_data) if trades_data else None

    if metrics:
        metrics["equity_curve"] = _downsample(metrics.get("equity_curve", []))

    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if variant:
        variant.aggregate_metrics = metrics
        db.flush()
    return metrics


def recompute_strategy_metrics(strategy_id: str, db: Session) -> dict | None:
    """Recalcule et persiste les métriques agrégées d'une stratégie. Retourne les métriques."""
    trades = (
        db.query(Trade)
        .join(Run, Trade.run_id == Run.id)
        .join(Variant, Run.variant_id == Variant.id)
        .filter(Variant.strategy_id == strategy_id)
        .order_by(Trade.close_time)
        .all()
    )
    trades_data = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades]
    metrics = compute_metrics(trades_data) if trades_data else None

    if metrics:
        metrics["equity_curve"] = _downsample(metrics.get("equity_curve", []))

    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if strategy:
        strategy.aggregate_metrics = metrics
        db.flush()
    return metrics


def backfill_all_metrics(db: Session) -> int:
    """Recalcule les métriques pour toutes les variantes/stratégies qui n'en ont pas encore.

    Retourne le nombre d'entités mises à jour.
    """
    updated = 0

    variants = db.query(Variant).filter(Variant.aggregate_metrics.is_(None)).all()
    variant_ids_with_trades = set()
    for v in variants:
        has_trades = (
            db.query(Trade.id)
            .join(Run, Trade.run_id == Run.id)
            .filter(Run.variant_id == v.id)
            .limit(1)
            .first()
        )
        if has_trades:
            recompute_variant_metrics(v.id, db)
            variant_ids_with_trades.add(v.id)
            updated += 1

    strategies = db.query(Strategy).filter(Strategy.aggregate_metrics.is_(None)).all()
    for s in strategies:
        has_trades = (
            db.query(Trade.id)
            .join(Run, Trade.run_id == Run.id)
            .join(Variant, Run.variant_id == Variant.id)
            .filter(Variant.strategy_id == s.id)
            .limit(1)
            .first()
        )
        if has_trades:
            recompute_strategy_metrics(s.id, db)
            updated += 1

    # --- Backfill des runs dont les métriques sont obsolètes ---
    runs = db.query(Run).filter(Run.metrics.isnot(None)).all()
    for r in runs:
        if _run_metrics_stale(r.metrics):
            recompute_run_metrics(r.id, db)
            updated += 1

    if updated:
        db.commit()
        logger.info("Backfill: %d metrics recomputed", updated)
    return updated
