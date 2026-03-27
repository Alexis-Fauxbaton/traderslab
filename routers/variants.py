from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models.variant import Variant
from models.run import Run
from models.trade import Trade
from services.metrics import compute_metrics
from schemas.variant import (
    VariantCreate,
    VariantUpdate,
    VariantOut,
    VariantDetail,
    VariantLineageNode,
)
from schemas.run import RunOut

router = APIRouter(prefix="/variants", tags=["variants"])


@router.get("", response_model=list[VariantOut])
def list_variants(strategy_id: str = Query(...), db: Session = Depends(get_db)):
    return (
        db.query(Variant)
        .filter(Variant.strategy_id == strategy_id)
        .order_by(Variant.created_at.desc())
        .all()
    )


@router.post("", response_model=VariantOut, status_code=201)
def create_variant(payload: VariantCreate, db: Session = Depends(get_db)):
    variant = Variant(**payload.model_dump())
    db.add(variant)
    db.commit()
    db.refresh(variant)
    return variant


@router.get("/{variant_id}", response_model=VariantDetail)
def get_variant(variant_id: str, db: Session = Depends(get_db)):
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    runs = db.query(Run).filter(Run.variant_id == variant_id).order_by(Run.imported_at.desc()).all()
    return VariantDetail(
        **VariantOut.model_validate(variant).model_dump(),
        runs=[RunOut.model_validate(r) for r in runs],
    )


@router.put("/{variant_id}", response_model=VariantOut)
def update_variant(variant_id: str, payload: VariantUpdate, db: Session = Depends(get_db)):
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(variant, field, value)
    db.commit()
    db.refresh(variant)
    return variant


@router.delete("/{variant_id}", status_code=204)
def delete_variant(variant_id: str, db: Session = Depends(get_db)):
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    db.delete(variant)
    db.commit()


@router.get("/{variant_id}/metrics")
def get_variant_metrics(variant_id: str, db: Session = Depends(get_db)):
    """Retourne les métriques agrégées de tous les runs d'une variante."""
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    trades_rows = (
        db.query(Trade)
        .join(Run, Trade.run_id == Run.id)
        .filter(Run.variant_id == variant_id)
        .order_by(Trade.close_time)
        .all()
    )
    if not trades_rows:
        return {"aggregate_metrics": None}
    trade_dicts = [{"close_time": t.close_time, "pnl": t.pnl} for t in trades_rows]
    return {"aggregate_metrics": compute_metrics(trade_dicts)}


@router.get("/{variant_id}/lineage", response_model=VariantLineageNode)
def get_lineage(variant_id: str, db: Session = Depends(get_db)):
    """Retourne l'arbre de lignée complet depuis la racine.

    Remonte via parent_variant_id jusqu'à la racine, puis reconstruit
    l'arbre descendant pour toute la lignée.
    """
    # 1. Trouver la variante demandée
    variant = db.query(Variant).filter(Variant.id == variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")

    # 2. Remonter jusqu'à la racine
    root = variant
    visited = {root.id}
    while root.parent_variant_id:
        parent = db.query(Variant).filter(Variant.id == root.parent_variant_id).first()
        if not parent or parent.id in visited:
            break
        visited.add(parent.id)
        root = parent

    # 3. Charger toutes les variantes de la même stratégie pour construire l'arbre
    all_variants = db.query(Variant).filter(Variant.strategy_id == root.strategy_id).all()

    # 4. Construire un index parent → enfants
    children_map: dict[str | None, list[Variant]] = {}
    for v in all_variants:
        children_map.setdefault(v.parent_variant_id, []).append(v)

    # 5. Construction récursive de l'arbre depuis la racine
    def build_tree(node: Variant) -> VariantLineageNode:
        children = children_map.get(node.id, [])
        return VariantLineageNode(
            id=node.id,
            name=node.name,
            status=node.status,
            hypothesis=node.hypothesis,
            decision=node.decision,
            parent_variant_id=node.parent_variant_id,
            children=[build_tree(c) for c in children],
        )

    return build_tree(root)
