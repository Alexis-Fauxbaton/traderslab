import asyncio
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from database import get_db
from models.mt5_connection import MT5Connection
from models.variant import Variant
from models.strategy import Strategy
from models.trade import Trade
from models.user import User
from schemas.mt5_connection import MT5ConnectionCreate, MT5ConnectionOut, MT5SyncResult, MT5ConnectionRetry
from services.auth import get_current_user
from services.mt5_sync import (
    provision_and_first_sync,
    sync_connection,
    disconnect_account,
    disconnect_and_delete,
    remove_metaapi_account,
    encrypt_password,
    decrypt_password,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mt5", tags=["mt5-sync"])

# Keep references to background tasks to prevent GC
_background_tasks: set[asyncio.Task] = set()


def _fire_and_forget(coro):
    """Schedule an async coroutine as a background task with GC protection."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def _verify_connection_owner(
    connection_id: str, db: Session, user: User
) -> MT5Connection:
    conn = (
        db.query(MT5Connection)
        .filter(MT5Connection.id == connection_id, MT5Connection.user_id == user.id)
        .first()
    )
    if not conn:
        raise HTTPException(404, "Connexion MT5 introuvable")
    return conn


# ─── Popular MT5/MT4 broker servers ─────────────────────────────────
MT5_SERVERS = [
    # Prop firms
    "FundedNext-Server",
    "FundedNext-Server 2",
    "FundedNext-Server 3",
    "FundedNext-Demo",
    "FTMO-Server",
    "FTMO-Server2",
    "FTMO-Server3",
    "FTMO-Demo",
    "ThePropTrading-Server",
    "TopstepTrader-Server",
    "E8Funding-Server",
    "E8Markets-Server",
    "MyForexFunds-Server",
    "MyForexFunds-Live",
    "TrueForexFunds-Server",
    "TheForexFunder-Server",
    "TheFundedTrader-Server",
    "TheFundedTrader-Live",
    "Lux-Trading-Server",
    "SurgeTrader-Server",
    "FidelCrest-Server",
    "FidelCrest-Live",
    "BlueBerryFunded-Server",
    "Bulenox-Server",
    "FundingPips-Server",
    "FundingPips-Server 2",
    "InstantFunding-Server",
    "Alpha-Capital-Server",
    # Major brokers
    "ICMarketsSC-Demo",
    "ICMarketsSC-Live01",
    "ICMarketsSC-Live02",
    "ICMarketsSC-Live03",
    "ICMarketsSC-Live04",
    "ICMarkets-Demo",
    "ICMarkets-Live01",
    "Pepperstone-Demo",
    "Pepperstone-Live01",
    "Pepperstone-Edge-Demo",
    "Pepperstone-Edge-Live01",
    "FPMarkets-Live",
    "FPMarkets-Demo",
    "Tickmill-Demo",
    "Tickmill-Live",
    "Tickmill-Live02",
    "XMGlobal-MT5",
    "XMGlobal-MT5-2",
    "XMGlobal-MT5-3",
    "Exness-MT5Real",
    "Exness-MT5Trial",
    "Exness-MT5Real2",
    "OctaFX-Real",
    "OctaFX-Demo",
    "RoboForex-ECN",
    "RoboForex-Demo",
    "Admiral-Live",
    "Admiral-Demo",
    "Admirals-MT5",
    "FXCM-MT5",
    "ActivTrades-Server",
    "AvaTrade-MT5",
    "VantageInternational-Live",
    "VantageInternational-Demo",
    "EightCap-Live",
    "EightCap-Demo",
    "OANDA-MT5-1",
    "OANDA-MT5-2",
    "FxPro-MT5",
    "HFMarketsSV-Live",
    "HFMarketsSV-Demo",
    "LiteFinance-MT5-Demo",
    "LiteFinance-MT5-Live",
    "Deriv-Demo",
    "Deriv-Server",
    "BlackBull-Live",
    "BlackBull-Demo",
    "AXI-Live",
    "AXI-Demo",
]


@router.get("/servers")
def list_servers(q: str = ""):
    """Returns list of known MT5 broker servers, optionally filtered by query."""
    if q:
        q_lower = q.lower()
        return [s for s in MT5_SERVERS if q_lower in s.lower()]
    return MT5_SERVERS


@router.post("/connect", response_model=MT5ConnectionOut)
async def connect_mt5(
    body: MT5ConnectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Connecte un compte MT5 via MetaApi (investor password) à une variante."""
    # Verify variant ownership
    variant = db.query(Variant).filter(Variant.id == body.variant_id).first()
    if not variant:
        raise HTTPException(404, "Variante introuvable")
    strategy = db.query(Strategy).filter(
        Strategy.id == variant.strategy_id, Strategy.user_id == current_user.id
    ).first()
    if not strategy:
        raise HTTPException(404, "Variante introuvable")

    conn = MT5Connection(
        user_id=current_user.id,
        variant_id=body.variant_id,
        mt5_login=body.mt5_login,
        mt5_server=body.mt5_server,
        platform=body.platform,
        status="pending",
        investor_password_enc=encrypt_password(body.investor_password),
        sync_from=body.sync_from,
        sync_to=body.sync_to,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    # Launch provisioning in background (non-blocking)
    _fire_and_forget(provision_and_first_sync(conn.id, body.investor_password))

    return MT5ConnectionOut.model_validate(conn)


@router.get("/connections", response_model=list[MT5ConnectionOut])
def list_connections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Liste toutes les connexions MT5 de l'utilisateur."""
    return (
        db.query(MT5Connection)
        .filter(MT5Connection.user_id == current_user.id)
        .order_by(MT5Connection.created_at.desc())
        .all()
    )


@router.get("/connections/{connection_id}", response_model=MT5ConnectionOut)
def get_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Détail d'une connexion MT5."""
    return _verify_connection_owner(connection_id, db, current_user)


@router.post("/connections/{connection_id}/retry", response_model=MT5ConnectionOut)
async def retry_connection(
    connection_id: str,
    body: MT5ConnectionRetry = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Relance le provisioning d'une connexion en erreur."""
    conn = _verify_connection_owner(connection_id, db, current_user)
    if conn.status in ("pending", "deploying", "syncing"):
        raise HTTPException(400, "Un provisioning ou une synchronisation est déjà en cours. Veuillez patienter.")
    if conn.status not in ("error", "disconnected"):
        raise HTTPException(400, f"Retry possible uniquement si status=error|disconnected (actuel : {conn.status})")

    # Use new password if provided, otherwise use stored one
    if body and body.investor_password:
        password = body.investor_password
        conn.investor_password_enc = encrypt_password(password)
    elif conn.investor_password_enc:
        password = decrypt_password(conn.investor_password_enc)
    else:
        raise HTTPException(400, "Aucun mot de passe stocké — veuillez en fournir un")

    # Update connection params if provided
    needs_new_account = False
    if body:
        if body.mt5_server and body.mt5_server != conn.mt5_server:
            conn.mt5_server = body.mt5_server
            needs_new_account = True
        if body.mt5_login and body.mt5_login != conn.mt5_login:
            conn.mt5_login = body.mt5_login
            needs_new_account = True
        if body.platform and body.platform != conn.platform:
            conn.platform = body.platform
            needs_new_account = True

    # If server/login/platform changed, force new MetaApi account provisioning
    if needs_new_account and conn.metaapi_account_id:
        try:
            await remove_metaapi_account(conn.metaapi_account_id)
        except Exception:
            pass  # best effort cleanup
        conn.metaapi_account_id = None

    conn.status = "pending"
    conn.error_message = None
    db.commit()
    db.refresh(conn)
    _fire_and_forget(provision_and_first_sync(conn.id, password))
    return MT5ConnectionOut.model_validate(conn)


@router.post("/connections/{connection_id}/sync")
async def trigger_sync(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force une synchronisation manuelle immédiate (admin only)."""
    if not current_user.is_admin:
        raise HTTPException(403, "Seuls les administrateurs peuvent forcer une synchronisation.")
    conn = _verify_connection_owner(connection_id, db, current_user)
    if conn.status not in ("connected",):
        raise HTTPException(400, "Synchronisation impossible : le compte n'est pas connecté ou un sync est déjà en cours.")
    _fire_and_forget(sync_connection(conn.id))
    return {"message": "Synchronisation lancée"}


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Déconnecte et supprime une connexion MT5 (undeploy MetaApi + supprime de la DB)."""
    conn = _verify_connection_owner(connection_id, db, current_user)
    if conn.status not in ("disconnected", "error"):
        # Active connection: undeploy MetaApi first, then delete record
        _fire_and_forget(disconnect_and_delete(connection_id))
        return {"message": "Déconnexion et suppression en cours"}
    # Already disconnected/error: delete record immediately
    db.delete(conn)
    db.commit()
    return {"message": "Connexion supprimée"}


CRON_SECRET = os.getenv("CRON_SECRET", "")


@router.post("/cron-sync")
async def cron_sync(x_cron_secret: str = Header(None)):
    """Sync all active MT5 connections. Called by external cron job."""
    if not CRON_SECRET or x_cron_secret != CRON_SECRET:
        raise HTTPException(403, "Forbidden")
    from services.mt5_sync import sync_all_connections
    _fire_and_forget(sync_all_connections())
    return {"message": "Sync lancé pour toutes les connexions"}
