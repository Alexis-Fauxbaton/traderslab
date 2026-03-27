from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models.strategy import Strategy
from models.variant import Variant
from models.run import Run
from models.trade import Trade
from schemas.strategy import StrategyCreate, StrategyUpdate, StrategyOut, StrategyDetail
from schemas.variant import VariantOut
from services.metrics import compute_metrics

router = APIRouter(prefix="/strategies", tags=["strategies"])


@router.get("/dashboard/activity")
def dashboard_activity(db: Session = Depends(get_db)):
    """Données d'activité récente pour le dashboard home."""
    recent_variants = (
        db.query(Variant, Strategy)
        .join(Strategy, Variant.strategy_id == Strategy.id)
        .order_by(Variant.created_at.desc())
        .limit(5)
        .all()
    )

    recent_runs = (
        db.query(Run, Variant, Strategy)
        .join(Variant, Run.variant_id == Variant.id)
        .join(Strategy, Variant.strategy_id == Strategy.id)
        .order_by(Run.imported_at.desc())
        .limit(5)
        .all()
    )

    to_review = (
        db.query(Variant, Strategy)
        .join(Strategy, Variant.strategy_id == Strategy.id)
        .filter(Variant.status.in_(["testing", "active"]))
        .filter((Variant.decision == None) | (Variant.decision == ""))
        .order_by(Variant.created_at.desc())
        .limit(8)
        .all()
    )

    variant_pnl_rows = (
        db.query(
            Variant.id,
            Variant.name,
            Strategy.name.label("strategy_name"),
            Strategy.id.label("strategy_id"),
            func.sum(Trade.pnl).label("total_pnl"),
        )
        .join(Run, Trade.run_id == Run.id)
        .join(Variant, Run.variant_id == Variant.id)
        .join(Strategy, Variant.strategy_id == Strategy.id)
        .group_by(Variant.id, Variant.name, Strategy.name, Strategy.id)
        .all()
    )

    best = max(variant_pnl_rows, key=lambda x: x.total_pnl, default=None)
    worst = min(variant_pnl_rows, key=lambda x: x.total_pnl, default=None)

    return {
        "recent_variants": [
            {
                "id": v.id,
                "name": v.name,
                "status": v.status,
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "strategy_id": s.id,
                "strategy_name": s.name,
            }
            for v, s in recent_variants
        ],
        "recent_runs": [
            {
                "id": r.id,
                "label": r.label,
                "type": r.type,
                "imported_at": r.imported_at.isoformat() if r.imported_at else None,
                "variant_id": v.id,
                "variant_name": v.name,
                "strategy_id": s.id,
                "strategy_name": s.name,
            }
            for r, v, s in recent_runs
        ],
        "to_review": [
            {
                "id": v.id,
                "name": v.name,
                "status": v.status,
                "strategy_id": s.id,
                "strategy_name": s.name,
            }
            for v, s in to_review
        ],
        "best_variant": {
            "id": best.id,
            "name": best.name,
            "strategy_id": best.strategy_id,
            "strategy_name": best.strategy_name,
            "total_pnl": float(best.total_pnl),
        } if best else None,
        "worst_variant": {
            "id": worst.id,
            "name": worst.name,
            "strategy_id": worst.strategy_id,
            "strategy_name": worst.strategy_name,
            "total_pnl": float(worst.total_pnl),
        } if worst else None,
    }


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    """Retourne toutes les stratégies avec métriques agrégées (tous runs, toutes variantes)."""
    strategies = db.query(Strategy).order_by(Strategy.created_at.desc()).all()
    result = []
    for s in strategies:
        trades_rows = (
            db.query(Trade)
            .join(Run, Trade.run_id == Run.id)
            .join(Variant, Run.variant_id == Variant.id)
            .filter(Variant.strategy_id == s.id)
            .order_by(Trade.close_time)
            .all()
        )
        trades_data = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades_rows]
        metrics = compute_metrics(trades_data) if trades_data else None

        strategy_dict = StrategyOut.model_validate(s).model_dump()
        strategy_dict["aggregate_metrics"] = metrics
        result.append(strategy_dict)

    return result


@router.get("/{strategy_id}/variants-summary")
def variants_summary(strategy_id: str, db: Session = Depends(get_db)):
    """Retourne les variantes d'une stratégie avec métriques agrégées par variante."""
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")

    variants = db.query(Variant).filter(Variant.strategy_id == strategy_id).all()
    result = []
    for v in variants:
        trades_rows = (
            db.query(Trade)
            .join(Run, Trade.run_id == Run.id)
            .filter(Run.variant_id == v.id)
            .order_by(Trade.close_time)
            .all()
        )
        trades_data = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades_rows]
        metrics = compute_metrics(trades_data) if trades_data else None

        variant_dict = VariantOut.model_validate(v).model_dump()
        variant_dict["aggregate_metrics"] = metrics
        result.append(variant_dict)

    return result


@router.get("", response_model=list[StrategyOut])
def list_strategies(db: Session = Depends(get_db)):
    return db.query(Strategy).order_by(Strategy.created_at.desc()).all()


@router.post("", response_model=StrategyOut, status_code=201)
def create_strategy(payload: StrategyCreate, db: Session = Depends(get_db)):
    strategy = Strategy(**payload.model_dump())
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.get("/{strategy_id}", response_model=StrategyDetail)
def get_strategy(strategy_id: str, db: Session = Depends(get_db)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    variants = db.query(Variant).filter(Variant.strategy_id == strategy_id).all()
    return StrategyDetail(
        **StrategyOut.model_validate(strategy).model_dump(),
        variants=[VariantOut.model_validate(v) for v in variants],
    )


@router.put("/{strategy_id}", response_model=StrategyOut)
def update_strategy(strategy_id: str, payload: StrategyUpdate, db: Session = Depends(get_db)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(strategy, field, value)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.delete("/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: str, db: Session = Depends(get_db)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    db.delete(strategy)
    db.commit()
