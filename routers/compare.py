from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Any, Optional

from database import get_db
from models.variant import Variant
from models.run import Run
from models.trade import Trade
from services.metrics import compute_metrics

router = APIRouter(prefix="/compare", tags=["compare"])


def _get_latest_run_data(
    variant_id: str,
    db: Session,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> dict[str, Any] | None:
    """Récupère les données du run le plus récent d'une variante, optionnellement filtrées par période."""
    run = (
        db.query(Run)
        .filter(Run.variant_id == variant_id)
        .order_by(Run.imported_at.desc())
        .first()
    )
    if not run:
        return None

    query = db.query(Trade).filter(Trade.run_id == run.id)
    if start_date:
        query = query.filter(Trade.close_time >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.filter(Trade.close_time <= datetime.combine(end_date, datetime.max.time()))
    trades = query.order_by(Trade.close_time).all()

    # Si filtrage par période, recalculer les métriques sur les trades filtrés
    if start_date or end_date:
        trade_dicts = [
            {"close_time": t.close_time, "pnl": t.pnl}
            for t in trades
        ]
        metrics = compute_metrics(trade_dicts)
        equity_curve = metrics.pop("equity_curve", [])
    else:
        metrics = run.metrics
        equity_curve = []
        if run.metrics and "equity_curve" in run.metrics:
            equity_curve = run.metrics["equity_curve"]
        else:
            cumulative = 0.0
            for t in trades:
                cumulative += t.pnl
                equity_curve.append({
                    "date": t.close_time.isoformat(),
                    "cumulative_pnl": round(cumulative, 2),
                })

    return {
        "run_id": run.id,
        "label": run.label,
        "metrics": metrics,
        "equity_curve": equity_curve,
    }


# Métriques où une valeur plus haute est meilleure
_HIGHER_IS_BETTER = {
    "total_pnl", "win_rate", "profit_factor", "expectancy",
    "avg_win", "best_trade", "total_trades",
}
# Métriques où une valeur plus basse (en valeur absolue) est meilleure
_LOWER_IS_BETTER = {"max_drawdown", "worst_trade", "avg_loss"}


def _build_diff(metrics_a: dict | None, metrics_b: dict | None) -> dict[str, str]:
    """Compare deux jeux de métriques et indique quelle variante est meilleure pour chaque métrique."""
    if not metrics_a or not metrics_b:
        return {}

    diff: dict[str, str] = {}
    all_keys = set(metrics_a.keys()) | set(metrics_b.keys())

    for key in all_keys:
        if key == "equity_curve":
            continue
        val_a = metrics_a.get(key)
        val_b = metrics_b.get(key)
        if val_a is None or val_b is None:
            diff[key] = "N/A"
            continue
        if not isinstance(val_a, (int, float)) or not isinstance(val_b, (int, float)):
            continue

        if key in _HIGHER_IS_BETTER:
            if val_a > val_b:
                diff[key] = "A"
            elif val_b > val_a:
                diff[key] = "B"
            else:
                diff[key] = "equal"
        elif key in _LOWER_IS_BETTER:
            # Pour avg_loss et worst_trade (négatifs), moins négatif = mieux
            # Pour max_drawdown, plus petit = mieux
            if key == "max_drawdown":
                diff[key] = "A" if val_a < val_b else ("B" if val_b < val_a else "equal")
            else:
                # avg_loss et worst_trade sont négatifs : plus proche de 0 = mieux
                diff[key] = "A" if val_a > val_b else ("B" if val_b > val_a else "equal")
        else:
            diff[key] = "equal"

    return diff


@router.get("")
def compare_variants(
    variant_a: str = Query(...),
    variant_b: str = Query(...),
    start_date_a: Optional[date] = Query(None),
    end_date_a: Optional[date] = Query(None),
    start_date_b: Optional[date] = Query(None),
    end_date_b: Optional[date] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """Compare deux variantes en retournant leurs infos, métriques et equity curves.

    Paramètres de période :
    - start_date / end_date : période commune aux deux variantes
    - start_date_a / end_date_a : période spécifique à la variante A
    - start_date_b / end_date_b : période spécifique à la variante B
    Les périodes spécifiques écrasent la période commune.
    """
    va = db.query(Variant).filter(Variant.id == variant_a).first()
    vb = db.query(Variant).filter(Variant.id == variant_b).first()
    if not va:
        raise HTTPException(404, f"Variante A introuvable : {variant_a}")
    if not vb:
        raise HTTPException(404, f"Variante B introuvable : {variant_b}")

    sd_a = start_date_a or start_date
    ed_a = end_date_a or end_date
    sd_b = start_date_b or start_date
    ed_b = end_date_b or end_date

    data_a = _get_latest_run_data(variant_a, db, sd_a, ed_a)
    data_b = _get_latest_run_data(variant_b, db, sd_b, ed_b)

    metrics_a = data_a["metrics"] if data_a else None
    metrics_b = data_b["metrics"] if data_b else None

    return {
        "variant_a": {
            "id": va.id,
            "name": va.name,
            "hypothesis": va.hypothesis,
            "decision": va.decision,
            "status": va.status,
            "latest_run": data_a,
        },
        "variant_b": {
            "id": vb.id,
            "name": vb.name,
            "hypothesis": vb.hypothesis,
            "decision": vb.decision,
            "status": vb.status,
            "latest_run": data_b,
        },
        "diff": _build_diff(metrics_a, metrics_b),
    }
