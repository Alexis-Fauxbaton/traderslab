import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.binance_connection import BinanceConnection
from models.variant import Variant
from models.strategy import Strategy
from models.user import User
from schemas.binance_connection import BinanceConnectionCreate, BinanceConnectionOut
from services.auth import get_current_user
from services.mt5_sync import encrypt_password, decrypt_password
from services.binance_sync import provision_and_first_sync, sync_connection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/binance", tags=["binance-sync"])

_background_tasks: set[asyncio.Task] = set()


def _fire_and_forget(coro):
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def _verify_connection_owner(connection_id: str, db: Session, user: User) -> BinanceConnection:
    conn = (
        db.query(BinanceConnection)
        .filter(BinanceConnection.id == connection_id, BinanceConnection.user_id == user.id)
        .first()
    )
    if not conn:
        raise HTTPException(404, "Connexion Binance introuvable")
    return conn


@router.post("/connect", response_model=BinanceConnectionOut)
async def connect_binance(
    body: BinanceConnectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Connecte un compte Binance à une variante."""
    variant = db.query(Variant).filter(Variant.id == body.variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    strategy = db.query(Strategy).filter(
        Strategy.id == variant.strategy_id, Strategy.user_id == current_user.id
    ).first()
    if not strategy:
        raise HTTPException(404, "Variante introuvable")

    conn = BinanceConnection(
        user_id=current_user.id,
        variant_id=body.variant_id,
        api_key_enc=encrypt_password(body.api_key),
        api_secret_enc=encrypt_password(body.api_secret),
        account_type=body.account_type,
        status="pending",
        sync_from=body.sync_from,
        sync_to=body.sync_to,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    _fire_and_forget(provision_and_first_sync(conn.id, body.api_key, body.api_secret))

    return BinanceConnectionOut.model_validate(conn)


@router.get("/connections", response_model=list[BinanceConnectionOut])
def list_binance_connections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Liste toutes les connexions Binance de l'utilisateur."""
    conns = (
        db.query(BinanceConnection)
        .filter(BinanceConnection.user_id == current_user.id)
        .order_by(BinanceConnection.created_at.desc())
        .all()
    )
    # Clean stale error messages
    dirty = False
    for c in conns:
        if c.status == "connected" and c.error_message:
            c.error_message = None
            dirty = True
    if dirty:
        db.commit()
    return conns


@router.delete("/connections/{connection_id}")
async def delete_binance_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Supprime une connexion Binance."""
    conn = _verify_connection_owner(connection_id, db, current_user)
    db.delete(conn)
    db.commit()
    return {"message": "Connexion supprimée"}


@router.post("/connections/{connection_id}/retry")
async def retry_binance_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Réessaie la connexion Binance en erreur."""
    conn = _verify_connection_owner(connection_id, db, current_user)
    if conn.status not in ("error", "disconnected"):
        raise HTTPException(400, "Seules les connexions en erreur peuvent être réessayées.")
    api_key = decrypt_password(conn.api_key_enc)
    api_secret = decrypt_password(conn.api_secret_enc)
    conn.status = "pending"
    conn.error_message = None
    db.commit()
    _fire_and_forget(provision_and_first_sync(conn.id, api_key, api_secret))
    return {"message": "Reconnexion en cours…"}


@router.post("/connections/{connection_id}/sync")
async def trigger_binance_sync(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force une synchronisation manuelle (admin only)."""
    if not current_user.is_admin:
        raise HTTPException(403, "Seuls les administrateurs peuvent forcer une synchronisation.")
    conn = _verify_connection_owner(connection_id, db, current_user)
    if conn.status != "connected":
        raise HTTPException(400, "Le compte n'est pas connecté.")
    _fire_and_forget(sync_connection(conn.id))
    return {"message": "Synchronisation lancée"}
