"""
MT5 Live Sync service — MetaApi cloud integration.

Manages MetaApi account provisioning, deal fetching, trade deduplication,
and periodic background synchronization.
"""

import os
import logging
import asyncio
from datetime import date, datetime, timedelta, timezone

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


def _user_friendly_error(e: Exception) -> str:
    """Convert Python exceptions into user-friendly messages (French)."""
    msg = str(e)
    if "TimeoutException" in type(e).__name__ or "timeout" in msg.lower():
        return "Le compte MT5 n'a pas pu se connecter au broker. Vérifiez que le serveur et le login sont corrects."
    if "NotFound" in type(e).__name__ or "not found" in msg.lower():
        return "Compte MetaApi introuvable. Il a peut-être été supprimé."
    if "Unauthorized" in type(e).__name__ or "401" in msg:
        return "Token MetaApi invalide ou expiré. Vérifiez votre configuration."
    if "ValidationException" in type(e).__name__ or "validation" in msg.lower():
        return "Paramètres de connexion invalides. Vérifiez le login, le serveur et le mot de passe."
    if "password" in msg.lower() or "credentials" in msg.lower() or "auth" in msg.lower():
        return "Échec d'authentification. Vérifiez votre mot de passe investisseur et le serveur."
    if "connect" in msg.lower() or "network" in msg.lower() or "socket" in msg.lower():
        return "Erreur de connexion au service MetaApi. Réessayez dans quelques minutes."
    if "'str' object" in msg or "'coroutine' object" in msg or "AttributeError" in msg:
        return "Erreur interne lors de la synchronisation. Réessayez ou contactez le support."
    return "Une erreur est survenue lors de la synchronisation. Réessayez plus tard."


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


def _deal_get(deal, key, default=None):
    """Access a deal field whether it's a dict or an SDK object."""
    if isinstance(deal, dict):
        return deal.get(key, default)
    return getattr(deal, key, default)


def _extract_deals_list(raw):
    """Normalize the return value of get_deals_by_time_range.
    MetaAPI SDK may return a list of deals, or a dict like {"deals": [...], "synchronizing": bool}.
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and "deals" in raw:
        return raw["deals"] or []
    # Some SDK versions return an object with a .deals attribute
    if hasattr(raw, "deals"):
        return raw.deals or []
    return []


# ─── MetaApi low-level operations ────────────────────────────────────


async def _get_first_deposit(connection) -> float | None:
    """Fetch the first BALANCE deal (initial deposit) from the account history."""
    try:
        since = datetime(2000, 1, 1, tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        raw = await connection.get_deals_by_time_range(start_time=since, end_time=now)
        deals = _extract_deals_list(raw)
        logger.info("_get_first_deposit: got %d deals", len(deals))
        for d in deals:
            if isinstance(d, str):
                continue
            deal_type = _deal_get(d, "type", "")
            pos_id = _deal_get(d, "positionId", "")
            if not pos_id:
                logger.info("_get_first_deposit: non-trade deal type=%s profit=%s", deal_type, _deal_get(d, "profit", "?"))
            deal_type_upper = str(deal_type).upper()
            if "BALANCE" in deal_type_upper or "CHARGE" in deal_type_upper:
                profit = float(_deal_get(d, "profit", 0))
                if profit > 0:
                    logger.info("_get_first_deposit: found first deposit = %s (type=%s)", profit, deal_type)
                    return profit
        logger.warning("_get_first_deposit: no BALANCE deal found with positive profit")
    except Exception as e:
        logger.warning("Could not fetch first deposit: %s", e)
    return None


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

        info = await connection.get_account_information()
        currency = _deal_get(info, "currency", "USD")
        current_balance = float(_deal_get(info, "balance", 0))

        # Try to get the first deposit as initial balance
        first_deposit = await _get_first_deposit(connection)
        await connection.close()

        return {
            "account_id": account.id,
            "currency": currency,
            "balance": first_deposit or current_balance,
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

        info = await connection.get_account_information()
        currency = _deal_get(info, "currency", "USD")
        current_balance = float(_deal_get(info, "balance", 0))

        first_deposit = await _get_first_deposit(connection)
        await connection.close()

        return {
            "currency": currency,
            "balance": first_deposit or current_balance,
        }
    finally:
        if hasattr(api, "close"):
            api.close()


async def fetch_closed_trades_from_metaapi(
    metaapi_account_id: str, since: datetime
) -> dict:
    """
    Fetch closed trades (paired entry+exit deals) from MetaApi.
    Returns {"trades": list[dict], "first_deposit": float|None}.
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

        # Grab first deposit while connected
        first_deposit = await _get_first_deposit(connection)

        since_utc = since.replace(tzinfo=timezone.utc) if since.tzinfo is None else since
        now_utc = datetime.now(timezone.utc)
        raw = await connection.get_deals_by_time_range(
            start_time=since_utc, end_time=now_utc
        )
        deals = _extract_deals_list(raw)

        # Build a map: positionId → entry deal
        entry_map: dict[str, dict] = {}
        exit_list: list = []

        for d in deals:
            if isinstance(d, str):
                continue
            entry_type = _deal_get(d, "entryType", "")
            deal_type = _deal_get(d, "type", "")
            pos_id = _deal_get(d, "positionId")

            # Skip balance / credit / charge / commission-only operations
            if "BALANCE" in deal_type or "CREDIT" in deal_type or "CHARGE" in deal_type or not pos_id:
                continue

            if entry_type == "DEAL_ENTRY_IN":
                entry_map[pos_id] = d
            elif entry_type == "DEAL_ENTRY_OUT":
                exit_list.append(d)

        # For exits without a matching entry in range, fetch by position
        missing = [
            _deal_get(d, "positionId")
            for d in exit_list
            if _deal_get(d, "positionId") not in entry_map
        ]
        for pos_id in missing[:20]:  # cap API calls
            try:
                raw_pos = await connection.get_deals_by_position(
                    position_id=str(pos_id)
                )
                pos_deals = _extract_deals_list(raw_pos)
                for pd in pos_deals:
                    if _deal_get(pd, "entryType") == "DEAL_ENTRY_IN":
                        entry_map[pos_id] = pd
                        break
            except Exception:
                pass

        await connection.close()

        # Pair entry + exit into trade dicts
        trades: list[dict] = []
        for exit_deal in exit_list:
            pos_id = _deal_get(exit_deal, "positionId")
            entry_deal = entry_map.get(pos_id)
            if not entry_deal:
                continue

            deal_type = _deal_get(entry_deal, "type", "")
            side = "long" if "BUY" in deal_type else "short"

            # PnL = profit + swap + commission (net)
            pnl = (
                float(_deal_get(exit_deal, "profit", 0))
                + float(_deal_get(exit_deal, "swap", 0))
                + float(_deal_get(exit_deal, "commission", 0))
            )

            trades.append({
                "external_ticket": str(_deal_get(exit_deal, "id", "")),
                "open_time": _parse_time(_deal_get(entry_deal, "time")),
                "close_time": _parse_time(_deal_get(exit_deal, "time")),
                "symbol": _deal_get(exit_deal, "symbol", ""),
                "side": side,
                "entry_price": float(_deal_get(entry_deal, "price", 0)),
                "exit_price": float(_deal_get(exit_deal, "price", 0)),
                "lot_size": float(_deal_get(exit_deal, "volume", 0)),
                "pnl": pnl,
                "pips": None,
            })

        return {"trades": trades, "first_deposit": first_deposit}
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


async def undeploy_metaapi_account(metaapi_account_id: str):
    """Undeploy a MetaApi account WITHOUT removing it.
    The account stays in MetaAPI cloud in UNDEPLOYED state and can be
    re-deployed for the next sync. Saves costs (min 6h per deployment)."""
    _require_metaapi()
    api = MetaApi(token=METAAPI_TOKEN)
    try:
        account = await api.metatrader_account_api.get_account(metaapi_account_id)
        if hasattr(account, "state") and account.state == "DEPLOYED":
            await account.undeploy()
            if hasattr(account, "wait_undeployed"):
                await account.wait_undeployed(timeout_in_seconds=120)
            logger.info("MetaApi account %s undeployed (kept)", metaapi_account_id)
    except Exception as e:
        logger.error("Failed to undeploy MetaApi account %s: %s", metaapi_account_id, e)
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

        # If a MetaApi account already exists (failed retry), try to reuse it
        if conn.metaapi_account_id:
            try:
                info = await _connect_existing_metaapi_account(conn.metaapi_account_id)
                conn.currency = info["currency"]
                conn.initial_balance = info["balance"]
            except Exception:
                # Account was deleted from MetaAPI — provision a new one
                logger.info("MetaApi account %s gone, creating new one", conn.metaapi_account_id)
                conn.metaapi_account_id = None

        if not conn.metaapi_account_id:
            result = await provision_metaapi_account(
                login=conn.mt5_login,
                server=conn.mt5_server,
                password=investor_password,
                platform=conn.platform,
            )
            conn.metaapi_account_id = result["account_id"]
            conn.currency = result["currency"]
            conn.initial_balance = result["balance"]

        # Create run if none exists yet — auto-detect type from sync dates
        if not conn.run_id:
            is_backtest = (
                conn.sync_from and conn.sync_to
                and conn.sync_to < date.today()
            )
            if is_backtest:
                run_type = "backtest"
                run_label = f"Backtest MT5 — {conn.sync_from} → {conn.sync_to}"
            else:
                run_type = "live"
                run_label = "Live Sync — MT5"
            run = Run(
                variant_id=conn.variant_id,
                label=run_label,
                type=run_type,
                initial_balance=conn.initial_balance,
                currency=conn.currency,
                currency_source="detected",
            )
            db.add(run)
            db.flush()
            conn.run_id = run.id
        conn.status = "connected"
        conn.error_message = None
        db.commit()

        # Initial sync — pulls full history then undeploys
        await _do_sync(conn, db)

    except Exception as e:
        import traceback
        logger.error("Provision failed for connection %s: %s\n%s", connection_id, e, traceback.format_exc())
        if conn:
            # Undeploy the MetaApi account to stop billing
            if conn.metaapi_account_id:
                try:
                    await undeploy_metaapi_account(conn.metaapi_account_id)
                except Exception:
                    pass
            conn.status = "error"
            conn.error_message = _user_friendly_error(e)
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
            conn.error_message = _user_friendly_error(e)
            db.commit()
        return 0
    finally:
        db.close()


async def sync_all_connections():
    """Sync MT5 connections that haven't synced in ~20 hours. Called by the background loop."""
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
        now = datetime.utcnow()
        for conn in connections:
            # Skip if synced within last 20 hours
            if conn.last_sync_at and (now - conn.last_sync_at).total_seconds() < 72000:
                continue
            # Skip if sync_to date has passed
            if conn.sync_to and conn.sync_to < now.date():
                continue
            try:
                await _do_sync(conn, db)
            except Exception as e:
                logger.error("Sync error for connection %s: %s", conn.id, e)
                conn.error_message = _user_friendly_error(e)
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
    """Core sync: deploy → fetch deals → undeploy → deduplicate → insert trades → recompute metrics."""
    from models.trade import Trade
    from models.run import Run
    from models.variant import Variant
    from services.metrics import compute_metrics
    from services.aggregation import recompute_variant_metrics, recompute_strategy_metrics

    if not conn.metaapi_account_id or not conn.run_id:
        return 0

    conn.status = "syncing"
    db.commit()

    try:
        # Determine fetch window
        if conn.last_sync_at:
            since = conn.last_sync_at
        elif conn.sync_from:
            since = datetime.combine(conn.sync_from, datetime.min.time())
        else:
            since = datetime(2015, 1, 1)  # no limit — fetch all available broker history

        result = await fetch_closed_trades_from_metaapi(conn.metaapi_account_id, since)
        trades_data = result["trades"]
        first_deposit = result.get("first_deposit")

        # Update initial_balance from first deposit if found
        if first_deposit and conn.initial_balance != first_deposit:
            conn.initial_balance = first_deposit
            run = db.query(Run).filter(Run.id == conn.run_id).first()
            if run:
                run.initial_balance = first_deposit

        # Undeploy immediately after fetch — DB operations don't need MetaAPI
        if conn.metaapi_account_id:
            await undeploy_metaapi_account(conn.metaapi_account_id)

        # Filter by sync_to if set
        if conn.sync_to and trades_data:
            sync_to_dt = datetime.combine(conn.sync_to, datetime.max.time())
            trades_data = [t for t in trades_data if t["close_time"] <= sync_to_dt]

        if not trades_data:
            conn.last_sync_at = datetime.utcnow()
            conn.status = "connected"
            conn.error_message = None
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
            conn.status = "connected"
            conn.error_message = None
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
        conn.status = "connected"
        conn.error_message = None
        db.commit()
        variant = db.query(Variant).filter(Variant.id == conn.variant_id).first()
        if variant:
            recompute_variant_metrics(variant.id, db)
            recompute_strategy_metrics(variant.strategy_id, db)

        logger.info("Synced %d new trades for connection %s", len(new_trades), conn.id)
        return len(new_trades)

    except Exception:
        conn.status = "connected"
        db.commit()
        raise
