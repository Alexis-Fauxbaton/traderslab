from fastapi import APIRouter, Depends, HTTPException
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
