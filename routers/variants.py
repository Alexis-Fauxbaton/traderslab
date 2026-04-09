from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models.variant import Variant
from models.strategy import Strategy
from models.run import Run
from models.user import User
from schemas.variant import (
    VariantCreate,
    VariantUpdate,
    VariantOut,
    VariantDetailEnriched,
    VariantLineageNode,
)
from schemas.run import RunOut
from services.aggregation import recompute_variant_metrics, _run_metrics_stale
from services.auth import get_current_user

router = APIRouter(prefix="/variants", tags=["variants"])


def _verify_variant_owner(variant_id: str, db: Session, user: User) -> Variant:
    """Get variant and verify ownership through strategy."""
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id, Strategy.user_id == user.id).first()
    if not strategy:
        raise HTTPException(404, "Variante introuvable")
    return variant


@router.get("", response_model=list[VariantOut])
def list_variants(strategy_id: str = Query(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    return (
        db.query(Variant)
        .filter(Variant.strategy_id == strategy_id)
        .order_by(Variant.created_at.desc())
        .all()
    )


@router.post("", response_model=VariantOut, status_code=201)
def create_variant(payload: VariantCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    strategy = db.query(Strategy).filter(Strategy.id == payload.strategy_id, Strategy.user_id == current_user.id).first()
    if not strategy:
        raise HTTPException(404, "Stratégie introuvable")
    variant = Variant(**payload.model_dump())
    db.add(variant)
    db.commit()
    db.refresh(variant)
    return variant


@router.get("/{variant_id}", response_model=VariantDetailEnriched)
def get_variant(variant_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    variant = _verify_variant_owner(variant_id, db, current_user)

    # Lazy migration: recompute aggregate metrics if stale
    if _run_metrics_stale(variant.aggregate_metrics):
        recompute_variant_metrics(variant_id, db)
        db.commit()
        db.refresh(variant)

    runs = db.query(Run).filter(Run.variant_id == variant_id).order_by(Run.imported_at.desc()).all()

    # Strategy name
    strategy = db.query(Strategy).filter(Strategy.id == variant.strategy_id).first()
    strategy_name = strategy.name if strategy else None

    # Parent variant name
    parent_variant_name = None
    if variant.parent_variant_id:
        parent = db.query(Variant).filter(Variant.id == variant.parent_variant_id).first()
        if parent:
            parent_variant_name = parent.name

    # Lineage
    lineage = _build_lineage(variant, db)

    return VariantDetailEnriched(
        **VariantOut.model_validate(variant).model_dump(),
        runs=[RunOut.model_validate(r) for r in runs],
        strategy_name=strategy_name,
        parent_variant_name=parent_variant_name,
        aggregate_metrics=variant.aggregate_metrics,
        lineage=lineage,
    )


@router.put("/{variant_id}", response_model=VariantOut)
def update_variant(variant_id: str, payload: VariantUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    variant = _verify_variant_owner(variant_id, db, current_user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(variant, field, value)
    db.commit()
    db.refresh(variant)
    return variant


@router.delete("/{variant_id}", status_code=204)
def delete_variant(variant_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    variant = _verify_variant_owner(variant_id, db, current_user)
    db.delete(variant)
    db.commit()


@router.get("/{variant_id}/metrics")
def get_variant_metrics(variant_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retourne les métriques agrégées pré-calculées d'une variante."""
    variant = _verify_variant_owner(variant_id, db, current_user)
    return {"aggregate_metrics": variant.aggregate_metrics}


def _build_lineage(variant: Variant, db: Session) -> VariantLineageNode | None:
    """Construit l'arbre de lignée depuis la racine."""
    root = variant
    visited = {root.id}
    while root.parent_variant_id:
        parent = db.query(Variant).filter(Variant.id == root.parent_variant_id).first()
        if not parent or parent.id in visited:
            break
        visited.add(parent.id)
        root = parent

    all_variants = db.query(Variant).filter(Variant.strategy_id == root.strategy_id).all()
    children_map: dict[str | None, list[Variant]] = {}
    for v in all_variants:
        children_map.setdefault(v.parent_variant_id, []).append(v)

    def build_tree(node: Variant) -> VariantLineageNode:
        children = children_map.get(node.id, [])
        return VariantLineageNode(
            id=node.id,
            name=node.name,
            status=node.status,
            hypothesis=node.hypothesis,
            changes=node.changes,
            change_reason=node.change_reason,
            decision=node.decision,
            parent_variant_id=node.parent_variant_id,
            children=[build_tree(c) for c in children],
        )

    return build_tree(root)


@router.get("/{variant_id}/lineage", response_model=VariantLineageNode)
def get_lineage(variant_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retourne l'arbre de lignée complet depuis la racine."""
    variant = _verify_variant_owner(variant_id, db, current_user)
    return _build_lineage(variant, db)
