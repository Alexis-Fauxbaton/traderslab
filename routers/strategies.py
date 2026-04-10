import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models.strategy import Strategy
from models.variant import Variant
from models.run import Run
from models.trade import Trade
from models.user import User
from schemas.strategy import StrategyCreate, StrategyUpdate, StrategyOut, StrategyDetail
from schemas.variant import VariantOut
from services.auth import get_current_user

router = APIRouter(prefix="/strategies", tags=["strategies"])


@router.get("/dashboard/activity")
def dashboard_activity(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Données d'activité récente pour le dashboard home."""
    user_strategy_ids = [s.id for s in db.query(Strategy.id).filter(Strategy.user_id == current_user.id).all()]
    if not user_strategy_ids:
        return {"recent_variants": [], "recent_runs": [], "to_review": [], "best_variant": None, "worst_variant": None}

    recent_variants = (
        db.query(Variant, Strategy)
        .join(Strategy, Variant.strategy_id == Strategy.id)
        .filter(Strategy.user_id == current_user.id)
        .order_by(Variant.created_at.desc())
        .limit(5)
        .all()
    )

    recent_runs = (
        db.query(Run, Variant, Strategy)
        .join(Variant, Run.variant_id == Variant.id)
        .join(Strategy, Variant.strategy_id == Strategy.id)
        .filter(Strategy.user_id == current_user.id)
        .order_by(Run.imported_at.desc())
        .limit(5)
        .all()
    )

    to_review = (
        db.query(Variant, Strategy)
        .join(Strategy, Variant.strategy_id == Strategy.id)
        .filter(Strategy.user_id == current_user.id)
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
        .filter(Strategy.user_id == current_user.id)
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
def dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retourne toutes les stratégies avec métriques agrégées pré-calculées."""
    strategies = db.query(Strategy).filter(Strategy.user_id == current_user.id).order_by(Strategy.created_at.desc()).all()
    result = []
    for s in strategies:
        strategy_dict = StrategyOut.model_validate(s).model_dump()
        strategy_dict["aggregate_metrics"] = s.aggregate_metrics
        result.append(strategy_dict)

    return result


@router.get("/{strategy_id}/variants-summary")
def variants_summary(strategy_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retourne les variantes d'une stratégie avec métriques agrégées pré-calculées."""
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")

    variants = db.query(Variant).filter(Variant.strategy_id == strategy_id).all()
    variant_ids = [v.id for v in variants]

    # Aggregate pairs & timeframes from runs per variant
    runs = db.query(Run).filter(Run.variant_id.in_(variant_ids)).all() if variant_ids else []
    runs_by_variant: dict[str, list] = {}
    for r in runs:
        runs_by_variant.setdefault(r.variant_id, []).append(r)

    result = []
    for v in variants:
        variant_dict = VariantOut.model_validate(v).model_dump()
        variant_dict["aggregate_metrics"] = v.aggregate_metrics
        v_runs = runs_by_variant.get(v.id, [])
        all_pairs: set[str] = set()
        all_timeframes: set[str] = set()
        for r in v_runs:
            if r.pairs:
                pairs_val = r.pairs
                if isinstance(pairs_val, str):
                    pairs_val = json.loads(pairs_val)
                all_pairs.update(pairs_val)
            if r.timeframe:
                all_timeframes.add(r.timeframe)
        variant_dict["pairs"] = sorted(all_pairs)
        variant_dict["timeframes"] = sorted(all_timeframes)
        result.append(variant_dict)

    return result


@router.get("", response_model=list[StrategyOut])
def list_strategies(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Strategy).filter(Strategy.user_id == current_user.id).order_by(Strategy.created_at.desc()).all()


@router.post("", response_model=StrategyOut, status_code=201)
def create_strategy(payload: StrategyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    strategy = Strategy(**payload.model_dump(), user_id=current_user.id)
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.get("/{strategy_id}", response_model=StrategyDetail)
def get_strategy(strategy_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    variants = db.query(Variant).filter(Variant.strategy_id == strategy_id).all()
    return StrategyDetail(
        **StrategyOut.model_validate(strategy).model_dump(),
        variants=[VariantOut.model_validate(v) for v in variants],
    )


@router.put("/{strategy_id}", response_model=StrategyOut)
def update_strategy(strategy_id: str, payload: StrategyUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(strategy, field, value)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.delete("/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    db.delete(strategy)
    db.commit()
