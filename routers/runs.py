import json
import math

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session

from database import get_db
from models.run import Run
from models.trade import Trade
from models.variant import Variant
from models.strategy import Strategy
from models.user import User
from schemas.run import RunOut, RunDetail, RunImportResponse, TradesPaginated
from schemas.trade import TradeOut
from services.csv_parser import parse_csv
from services.metrics import compute_metrics, _compute_sharpe_annualized
from services.aggregation import recompute_variant_metrics, recompute_strategy_metrics, recompute_run_metrics, _run_metrics_stale
from services.auth import get_current_user

router = APIRouter(prefix="/runs", tags=["runs"])


def _verify_run_owner(run_id: str, db: Session, user: User) -> Run:
    """Get run and verify ownership through variant → strategy."""
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run introuvable")
    variant = db.query(Variant).filter(Variant.id == run.variant_id).first()
    if not variant:
        raise HTTPException(404, "Run introuvable")
    strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id, Strategy.user_id == user.id).first()
    if not strategy:
        raise HTTPException(404, "Run introuvable")
    return run


@router.get("", response_model=list[RunOut])
def list_runs(variant_id: str = Query(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Verify variant ownership
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if variant:
        strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id, Strategy.user_id == current_user.id).first()
        if not strategy:
            raise HTTPException(404, "Variante introuvable")
    return (
        db.query(Run)
        .filter(Run.variant_id == variant_id)
        .order_by(Run.imported_at.desc())
        .all()
    )


@router.get("/{run_id}/summary", response_model=RunOut)
def get_run_summary(run_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retourne le run sans ses trades — léger, pour header + métriques + chart."""
    run = _verify_run_owner(run_id, db, current_user)
    # Migration lazy : recalcule les métriques si les clés Pro sont absentes
    if _run_metrics_stale(run.metrics):
        recompute_run_metrics(run_id, db)
        db.commit()
        db.refresh(run)
    return run


@router.get("/{run_id}/trades", response_model=TradesPaginated)
def get_run_trades(
    run_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retourne les trades d'un run avec pagination."""
    run = _verify_run_owner(run_id, db, current_user)

    total = db.query(Trade).filter(Trade.run_id == run_id).count()
    trades = (
        db.query(Trade)
        .filter(Trade.run_id == run_id)
        .order_by(Trade.close_time)
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return TradesPaginated(
        items=[TradeOut.model_validate(t) for t in trades],
        total=total,
        page=page,
        per_page=per_page,
        pages=math.ceil(total / per_page) if total else 0,
    )


@router.get("/{run_id}", response_model=RunDetail)
def get_run(run_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    run = _verify_run_owner(run_id, db, current_user)

    # Migration lazy : recalcule les métriques si les clés Pro sont absentes
    if _run_metrics_stale(run.metrics):
        recompute_run_metrics(run_id, db)
        db.commit()
        db.refresh(run)

    trades = db.query(Trade).filter(Trade.run_id == run_id).order_by(Trade.close_time).all()

    return RunDetail(
        **RunOut.model_validate(run).model_dump(),
        trades=[TradeOut.model_validate(t) for t in trades],
    )


@router.delete("/{run_id}", status_code=204)
def delete_run(run_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    run = _verify_run_owner(run_id, db, current_user)
    variant_id = run.variant_id
    # Supprimer les trades associés d'abord
    db.query(Trade).filter(Trade.run_id == run_id).delete()
    db.delete(run)
    db.flush()

    # Recalculer les métriques agrégées
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    recompute_variant_metrics(variant_id, db)
    if variant:
        recompute_strategy_metrics(variant.strategy_id, db)
    db.commit()


@router.post("/import", response_model=RunImportResponse)
async def import_csv(
    variant_id: str = Form(...),
    label: str = Form(...),
    type: str = Form(...),
    initial_balance: float | None = Form(None),
    currency: str | None = Form(None),
    timeframe: str | None = Form(None),
    file: UploadFile = File(...),
    column_mapping: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import CSV de trades pour créer un Run.

    Étapes :
    1. Parser le CSV
    2. Appliquer le mapping de colonnes
    3. Valider les trades
    4. Détecter les overlaps de dates (warning sans blocage)
    5. Calculer les métriques
    6. Persister Run + Trades + Metrics
    """
    # Vérifier que la variante existe et appartient à l'utilisateur
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Variante introuvable")

    # Valider le type de run
    if type not in ("backtest", "forward", "live"):
        raise HTTPException(400, "Type doit être backtest, forward ou live")

    # Parser le mapping si fourni
    mapping = None
    if column_mapping:
        try:
            mapping = json.loads(column_mapping)
        except json.JSONDecodeError:
            raise HTTPException(400, "column_mapping n'est pas un JSON valide")

    # Étape 1-3 : Parser et valider le CSV
    content = await file.read()
    trades_data, parse_errors, detected_balance, detected_currency = parse_csv(content, mapping)

    # Résoudre la balance initiale : formulaire > CSV > défaut
    resolved_balance = initial_balance or detected_balance or 10000.0
    # Résoudre la currency : formulaire > CSV > défaut
    resolved_currency = currency or detected_currency or "USD"
    currency_source = "detected" if detected_currency else "default"
    if currency:
        currency_source = "manual"

    warnings: list[str] = []
    if parse_errors:
        warnings.extend(parse_errors)

    if not trades_data:
        raise HTTPException(400, f"Aucun trade valide trouvé. Erreurs : {parse_errors}")

    # Étape 4 : Détecter les overlaps de dates avec les runs existants
    new_start = min(t["open_time"] for t in trades_data)
    new_end = max(t["close_time"] for t in trades_data)

    existing_runs = db.query(Run).filter(Run.variant_id == variant_id).all()
    for existing in existing_runs:
        if existing.start_date and existing.end_date:
            # Vérifier l'overlap : les périodes se chevauchent si start_a <= end_b ET start_b <= end_a
            if new_start.date() <= existing.end_date and existing.start_date <= new_end.date():
                warnings.append(
                    f"Overlap de dates détecté avec le run '{existing.label}' "
                    f"({existing.start_date} → {existing.end_date})"
                )

    # Étape 5 : Calculer les métriques
    metrics = compute_metrics(trades_data, initial_balance=resolved_balance)

    # Auto-detect pairs from trades
    detected_pairs = sorted({t["symbol"] for t in trades_data if t.get("symbol")})

    # Étape 6 : Persister
    # Dates calculées automatiquement depuis les trades
    run = Run(
        variant_id=variant_id,
        label=label,
        type=type,
        start_date=new_start.date(),
        end_date=new_end.date(),
        initial_balance=resolved_balance,
        currency=resolved_currency,
        currency_source=currency_source,
        pairs=detected_pairs or None,
        timeframe=timeframe or None,
        metrics=metrics,
    )
    db.add(run)
    db.flush()  # Pour obtenir run.id

    for t in trades_data:
        trade = Trade(run_id=run.id, **t)
        db.add(trade)

    db.flush()

    # Recalculer les métriques agrégées variant + stratégie
    recompute_variant_metrics(variant_id, db)
    recompute_strategy_metrics(variant.strategy_id, db)

    db.commit()
    db.refresh(run)

    return RunImportResponse(
        run_id=run.id,
        nb_trades_imported=len(trades_data),
        warnings=warnings,
        metrics=metrics,
        initial_balance=resolved_balance,
        currency=resolved_currency,
    )
