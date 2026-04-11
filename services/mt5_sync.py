"""
MT5 Live Sync service — MetaApi cloud integration.

Manages MetaApi account provisioning, deal fetching, trade deduplication,
and periodic background synchronization.
"""

import os
import logging
import asyncio
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

METAAPI_TOKEN = os.getenv("METAAPI_TOKEN", "")

# ─── Investor password encryption (Fernet, keyed from METAAPI_TOKEN) ─────
import hashlib, base64
from cryptography.fernet import Fernet

def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(METAAPI_TOKEN.encode()).digest())
    return Fernet(key)

def encrypt_password(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()

def decrypt_password(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


try:
    from metaapi_cloud_sdk import MetaApi
    METAAPI_AVAILABLE = True
except ImportError:
    METAAPI_AVAILABLE = False
    logger.warning("metaapi-cloud-sdk not installed — MT5 live sync unavailable")


def _require_metaapi():
    if not METAAPI_AVAILABLE:
        raise RuntimeError(
            "metaapi-cloud-sdk n'est pas installé. Exécutez : pip install metaapi-cloud-sdk"
        )
    if not METAAPI_TOKEN:
        raise RuntimeError(
            "METAAPI_TOKEN non configuré. Créez un compte sur https://app.metaapi.cloud "
            "et ajoutez le token dans votre fichier .env"
        )


def _parse_time(val):
    """Parse a datetime from MetaApi (ISO string or datetime). Returns naive UTC."""
    if isinstance(val, datetime):
        return val.replace(tzinfo=None) if val.tzinfo else val
    if isinstance(val, str):
        dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        return dt.replace(tzinfo=None)
    return datetime.utcnow()


# ─── MetaApi low-level operations ────────────────────────────────────


async def provision_metaapi_account(
    login: str, server: str, password: str, platform: str = "mt5"
) -> dict:
    """
    Create and deploy a MetaTrader account on MetaApi cloud.
    Returns {"account_id": str, "currency": str, "balance": float}
    """
    _require_metaapi()
    api = MetaApi(token=METAAPI_TOKEN)
    try:
        account = await api.metatrader_account_api.create_account(account={
            "name": f"TradersLab-{login}",
            "type": "cloud",
            "login": str(login),
            "platform": platform,
            "password": password,
            "server": server,
            "magic": 0,
        })
        logger.info("MetaApi account %s created, waiting for deployment…", account.id)
        await account.wait_deployed(timeout_in_seconds=120)
        logger.info("MetaApi account %s deployed", account.id)

        connection = account.get_rpc_connection()
        await connection.connect()
        await connection.wait_synchronized(timeout_in_seconds=60)

        info = connection.get_account_information()
        await connection.close()

        return {
            "account_id": account.id,
            "currency": info.get("currency", "USD"),
            "balance": info.get("balance", 0),
        }
    finally:
        if hasattr(api, "close"):
            api.close()


async def _connect_existing_metaapi_account(metaapi_account_id: str) -> dict:
    """Re-connect to an already-provisioned MetaApi account. Returns {currency, balance}."""
    _require_metaapi()
    api = MetaApi(token=METAAPI_TOKEN)
    try:
        account = await api.metatrader_account_api.get_account(metaapi_account_id)
        if hasattr(account, "state") and account.state != "DEPLOYED":
            await account.deploy()
            await account.wait_deployed(timeout_in_seconds=120)

        connection = account.get_rpc_connection()
        await connection.connect()
        await connection.wait_synchronized(timeout_in_seconds=60)

        info = connection.get_account_information()
        await connection.close()

        return {
            "currency": info.get("currency", "USD"),
            "balance": info.get("balance", 0),
        }
    finally:
        if hasattr(api, "close"):
            api.close()


async def fetch_closed_trades_from_metaapi(
    metaapi_account_id: str, since: datetime
) -> list[dict]:
    """
    Fetch closed trades (paired entry+exit deals) from MetaApi.
    Returns list of dicts ready for Trade model insertion.
    """
    _require_metaapi()
    api = MetaApi(token=METAAPI_TOKEN)
    try:
        account = await api.metatrader_account_api.get_account(metaapi_account_id)

        if hasattr(account, "state") and account.state != "DEPLOYED":
            await account.deploy()
            await account.wait_deployed(timeout_in_seconds=120)

        connection = account.get_rpc_connection()
        await connection.connect()
        await connection.wait_synchronized(timeout_in_seconds=60)

        since_utc = since.replace(tzinfo=timezone.utc) if since.tzinfo is None else since
        now_utc = datetime.now(timezone.utc)
        deals = connection.get_deals_by_time_range(
            start_time=since_utc, end_time=now_utc
        )

        # Build a map: positionId → entry deal
        entry_map: dict[str, dict] = {}
        exit_list: list[dict] = []

        for d in deals or []:
            entry_type = d.get("entryType", "")
            deal_type = d.get("type", "")
            pos_id = d.get("positionId")

            # Skip balance / credit / commission-only operations
            if "BALANCE" in deal_type or "CREDIT" in deal_type or not pos_id:
                continue

            if entry_type == "DEAL_ENTRY_IN":
                entry_map[pos_id] = d
            elif entry_type == "DEAL_ENTRY_OUT":
                exit_list.append(d)

        # For exits without a matching entry in range, fetch by position
        missing = [
            d.get("positionId")
            for d in exit_list
            if d.get("positionId") not in entry_map
        ]
        for pos_id in missing[:20]:  # cap API calls
            try:
                pos_deals = connection.get_deals_by_position(
                    position_id=str(pos_id)
                )
                for pd in pos_deals:
                    if pd.get("entryType") == "DEAL_ENTRY_IN":
                        entry_map[pos_id] = pd
                        break
            except Exception:
                pass

        await connection.close()

        # Pair entry + exit into trade dicts
        trades: list[dict] = []
        for exit_deal in exit_list:
            pos_id = exit_deal.get("positionId")
            entry_deal = entry_map.get(pos_id)
            if not entry_deal:
                continue

            deal_type = entry_deal.get("type", "")
            side = "long" if "BUY" in deal_type else "short"

            # PnL = profit + swap + commission (net)
            pnl = (
                float(exit_deal.get("profit", 0))
                + float(exit_deal.get("swap", 0))
                + float(exit_deal.get("commission", 0))
            )

            trades.append({
                "external_ticket": str(exit_deal.get("id", "")),
                "open_time": _parse_time(entry_deal.get("time")),
                "close_time": _parse_time(exit_deal.get("time")),
                "symbol": exit_deal.get("symbol", ""),
                "side": side,
                "entry_price": float(entry_deal.get("price", 0)),
                "exit_price": float(exit_deal.get("price", 0)),
                "lot_size": float(exit_deal.get("volume", 0)),
                "pnl": pnl,
                "pips": None,
            })

        return trades
    finally:
        if hasattr(api, "close"):
            api.close()


async def remove_metaapi_account(metaapi_account_id: str):
    """Undeploy and remove a MetaApi account."""
    _require_metaapi()
    api = MetaApi(token=METAAPI_TOKEN)
    try:
        account = await api.metatrader_account_api.get_account(metaapi_account_id)
        if hasattr(account, "state") and account.state == "DEPLOYED":
            await account.undeploy()
            if hasattr(account, "wait_undeployed"):
                await account.wait_undeployed()
        await account.remove()
        logger.info("MetaApi account %s removed", metaapi_account_id)
    except Exception as e:
        logger.error("Failed to remove MetaApi account %s: %s", metaapi_account_id, e)
    finally:
        if hasattr(api, "close"):
            api.close()


# ─── Business logic ──────────────────────────────────────────────────


async def provision_and_first_sync(connection_id: str, investor_password: str):
    """Background task: provision MetaApi account, create run, initial sync."""
    from database import SessionLocal
    from models.mt5_connection import MT5Connection
    from models.run import Run

    db = SessionLocal()
    conn = None
    try:
        conn = db.query(MT5Connection).filter(
            MT5Connection.id == connection_id
        ).first()
        if not conn:
            return

        conn.status = "deploying"
        db.commit()

        # If a MetaApi account already exists (failed retry), reuse it
        if conn.metaapi_account_id:
            info = await _connect_existing_metaapi_account(conn.metaapi_account_id)
            conn.currency = info["currency"]
            conn.initial_balance = info["balance"]
        else:
            result = await provision_metaapi_account(
                login=conn.mt5_login,
                server=conn.mt5_server,
                password=investor_password,
                platform=conn.platform,
            )
            conn.metaapi_account_id = result["account_id"]
            conn.currency = result["currency"]
            conn.initial_balance = result["balance"]

        # Create a "Live Sync" run attached to the variant
        run = Run(
            variant_id=conn.variant_id,
            label="Live Sync — MT5",
            type="live",
            initial_balance=result["balance"],
            currency=result["currency"],
            currency_source="detected",
        )
        db.add(run)
        db.flush()

        conn.run_id = run.id
        conn.status = "connected"
        conn.error_message = None
        db.commit()

        # Initial sync — pulls full history
        await _do_sync(conn, db)

    except Exception as e:
        import traceback
        logger.error("Provision failed for connection %s: %s\n%s", connection_id, e, traceback.format_exc())
        if conn:
            conn.status = "error"
            conn.error_message = str(e)[:500]
            db.commit()
    finally:
        db.close()


async def sync_connection(connection_id: str) -> int:
    """Sync a single connection (called via manual trigger). Returns new trade count."""
    from database import SessionLocal
    from models.mt5_connection import MT5Connection

    db = SessionLocal()
    conn = None
    try:
        conn = db.query(MT5Connection).filter(
            MT5Connection.id == connection_id
        ).first()
        if not conn or conn.status != "connected":
            return 0
        return await _do_sync(conn, db)
    except Exception as e:
        logger.error("Sync error for connection %s: %s", connection_id, e)
        if conn:
            conn.error_message = str(e)[:500]
            db.commit()
        return 0
    finally:
        db.close()


async def sync_all_connections():
    """Sync all active MT5 connections. Called by the background loop."""
    from database import SessionLocal
    from models.mt5_connection import MT5Connection

    if not METAAPI_AVAILABLE or not METAAPI_TOKEN:
        return

    db = SessionLocal()
    try:
        connections = (
            db.query(MT5Connection)
            .filter(MT5Connection.status == "connected")
            .all()
        )
        for conn in connections:
            try:
                await _do_sync(conn, db)
            except Exception as e:
                logger.error("Sync error for connection %s: %s", conn.id, e)
                conn.error_message = str(e)[:500]
                db.commit()
    finally:
        db.close()


async def disconnect_account(connection_id: str):
    """Disconnect and remove a MetaApi account."""
    from database import SessionLocal
    from models.mt5_connection import MT5Connection

    db = SessionLocal()
    try:
        conn = db.query(MT5Connection).filter(
            MT5Connection.id == connection_id
        ).first()
        if not conn:
            return

        if conn.metaapi_account_id:
            await remove_metaapi_account(conn.metaapi_account_id)

        conn.status = "disconnected"
        conn.error_message = None
        db.commit()
    finally:
        db.close()


async def disconnect_and_delete(connection_id: str):
    """Disconnect MetaApi account and delete the connection record from DB."""
    from database import SessionLocal
    from models.mt5_connection import MT5Connection

    db = SessionLocal()
    try:
        conn = db.query(MT5Connection).filter(
            MT5Connection.id == connection_id
        ).first()
        if not conn:
            return

        if conn.metaapi_account_id:
            await remove_metaapi_account(conn.metaapi_account_id)

        db.delete(conn)
        db.commit()
        logger.info("Connection %s deleted", connection_id)
    finally:
        db.close()


async def _do_sync(conn, db) -> int:
    """Core sync: fetch deals → deduplicate → insert trades → recompute metrics."""
    from models.trade import Trade
    from models.run import Run
    from models.variant import Variant
    from services.metrics import compute_metrics
    from services.aggregation import recompute_variant_metrics, recompute_strategy_metrics

    if not conn.metaapi_account_id or not conn.run_id:
        return 0

    since = conn.last_sync_at or (datetime.utcnow() - timedelta(days=365))

    trades_data = await fetch_closed_trades_from_metaapi(conn.metaapi_account_id, since)

    if not trades_data:
        conn.last_sync_at = datetime.utcnow()
        db.commit()
        return 0

    # Deduplicate by external_ticket
    tickets = [t["external_ticket"] for t in trades_data if t.get("external_ticket")]
    existing_tickets: set[str] = set()
    if tickets:
        existing = (
            db.query(Trade.external_ticket)
            .filter(Trade.external_ticket.in_(tickets))
            .all()
        )
        existing_tickets = {e[0] for e in existing}

    new_trades = [
        t for t in trades_data
        if t.get("external_ticket") and t["external_ticket"] not in existing_tickets
    ]

    if not new_trades:
        conn.last_sync_at = datetime.utcnow()
        db.commit()
        return 0

    # Insert new trades
    for t in new_trades:
        trade = Trade(
            run_id=conn.run_id,
            external_ticket=t["external_ticket"],
            open_time=t["open_time"],
            close_time=t["close_time"],
            symbol=t["symbol"],
            side=t["side"],
            entry_price=t["entry_price"],
            exit_price=t["exit_price"],
            lot_size=t["lot_size"],
            pnl=t["pnl"],
            pips=t.get("pips"),
        )
        db.add(trade)
    db.flush()

    # Recompute run metrics
    run = db.query(Run).filter(Run.id == conn.run_id).first()
    all_trades = (
        db.query(Trade)
        .filter(Trade.run_id == conn.run_id)
        .order_by(Trade.close_time)
        .all()
    )
    if all_trades and run:
        td = [
            {
                "open_time": t.open_time,
                "close_time": t.close_time,
                "symbol": t.symbol,
                "side": t.side,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "lot_size": t.lot_size,
                "pnl": t.pnl,
                "pips": t.pips,
            }
            for t in all_trades
        ]
        run.metrics = compute_metrics(td, run.initial_balance or 10000)
        run.start_date = all_trades[0].open_time.date()
        run.end_date = all_trades[-1].close_time.date()
        run.pairs = sorted({t.symbol for t in all_trades})

    conn.last_sync_at = datetime.utcnow()
    db.commit()

    # Recompute variant & strategy metrics
    variant = db.query(Variant).filter(Variant.id == conn.variant_id).first()
    if variant:
        recompute_variant_metrics(variant.id, db)
        recompute_strategy_metrics(variant.strategy_id, db)

    logger.info("Synced %d new trades for connection %s", len(new_trades), conn.id)
    return len(new_trades)
