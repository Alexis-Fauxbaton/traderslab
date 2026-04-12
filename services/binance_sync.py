"""
Binance Sync service — fetch trades from Binance API.

Supports USDM Futures and Spot. Pairs individual fills into
entry/exit trades using FIFO matching, then stores them as Trade records.
"""

import os
import hmac
import hashlib
import logging
import time as _time
from datetime import date, datetime, timezone
from collections import defaultdict

import httpx

from services.mt5_sync import encrypt_password, decrypt_password

logger = logging.getLogger(__name__)

FUTURES_BASE = "https://fapi.binance.com"
SPOT_BASE = "https://api.binance.com"


# ─── Binance API helpers ────────────────────────────────────────────


def _sign(query_string: str, api_secret: str) -> str:
    return hmac.new(api_secret.encode(), query_string.encode(), hashlib.sha256).hexdigest()


async def _binance_request(
    method: str, url: str, params: dict, api_key: str, api_secret: str
) -> dict | list:
    """Make a signed Binance API request."""
    params["timestamp"] = int(_time.time() * 1000)
    params["recvWindow"] = 10000
    # Build query string in deterministic order, sign it, then append signature
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    sig = _sign(qs, api_secret)
    full_url = f"{url}?{qs}&signature={sig}"
    headers = {"X-MBX-APIKEY": api_key}

    async with httpx.AsyncClient(timeout=30) as client:
        if method == "GET":
            resp = await client.get(full_url, headers=headers)
        else:
            resp = await client.post(full_url, headers=headers)

    if resp.status_code != 200:
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        msg = body.get("msg", resp.text[:200])
        raise RuntimeError(f"Binance API error {resp.status_code}: {msg}")

    return resp.json()


def _user_friendly_error(e: Exception) -> str:
    msg = str(e)
    if "Invalid API-key" in msg or "-2015" in msg:
        return "Clé API Binance invalide. Vérifiez votre API key."
    if "Signature" in msg or "-1022" in msg:
        return "Signature invalide. Vérifiez votre API secret."
    if "-2014" in msg or "API-key format" in msg:
        return "Format de clé API Binance incorrect."
    if "-1021" in msg or "Timestamp" in msg:
        return "Erreur de synchronisation d'horloge avec Binance. Réessayez."
    if "IP" in msg or "-2016" in msg:
        return "IP non autorisée pour cette clé API. Vérifiez vos restrictions IP."
    if "permission" in msg.lower() or "-2017" in msg:
        return "Permissions insuffisantes. La clé API doit avoir l'accès en lecture."
    if "timeout" in msg.lower() or "connect" in msg.lower():
        return "Erreur de connexion à Binance. Réessayez dans quelques minutes."
    return "Erreur Binance. Réessayez plus tard."


# ─── Futures USDM ──────────────────────────────────────────────────


async def _get_futures_balance(api_key: str, api_secret: str) -> tuple[float, str]:
    """Get total wallet balance from Binance USDM Futures. Returns (balance, asset)."""
    data = await _binance_request(
        "GET", f"{FUTURES_BASE}/fapi/v2/balance", {}, api_key, api_secret
    )
    # Find USDT balance (most common), fallback to first non-zero
    for item in data:
        if item["asset"] == "USDT" and float(item["balance"]) > 0:
            return float(item["balance"]), "USDT"
    for item in data:
        if float(item["balance"]) > 0:
            return float(item["balance"]), item["asset"]
    return 0.0, "USDT"


async def _get_futures_traded_symbols(
    api_key: str, api_secret: str, since_ms: int
) -> list[str]:
    """Get all symbols with realized PnL since a given timestamp."""
    symbols = set()
    start = since_ms
    while True:
        params = {
            "incomeType": "REALIZED_PNL",
            "startTime": start,
            "limit": 1000,
        }
        data = await _binance_request(
            "GET", f"{FUTURES_BASE}/fapi/v1/income", params, api_key, api_secret
        )
        for item in data:
            symbols.add(item["symbol"])
        if len(data) < 1000:
            break
        start = data[-1]["time"] + 1
    return sorted(symbols)


async def _get_futures_trades(
    api_key: str, api_secret: str, symbol: str, since_ms: int
) -> list[dict]:
    """Fetch all user trades for a symbol since a timestamp."""
    all_trades = []
    start = since_ms
    while True:
        params = {"symbol": symbol, "startTime": start, "limit": 1000}
        data = await _binance_request(
            "GET", f"{FUTURES_BASE}/fapi/v1/userTrades", params, api_key, api_secret
        )
        all_trades.extend(data)
        if len(data) < 1000:
            break
        start = data[-1]["time"] + 1
    return all_trades


def _pair_futures_trades(raw_trades: list[dict]) -> list[dict]:
    """
    Pair Binance Futures fills into entry/exit trades.

    For each trade with realizedPnl != 0, we derive the entry price from:
      LONG:  entry = exit - pnl/qty
      SHORT: entry = exit + pnl/qty
    """
    trades = sorted(raw_trades, key=lambda t: t["time"])
    closed = []
    # Track first open time per (symbol, positionSide)
    open_times: dict[tuple, int] = {}

    for t in trades:
        symbol = t["symbol"]
        pos_side = t.get("positionSide", "BOTH")
        side = t["side"]
        price = float(t["price"])
        qty = float(t["qty"])
        pnl = float(t["realizedPnl"])

        key = (symbol, pos_side)

        # Determine if this is opening or closing
        if pos_side == "LONG":
            is_opening = side == "BUY"
        elif pos_side == "SHORT":
            is_opening = side == "SELL"
        else:
            # One-way mode: no clear signal, use realizedPnl
            is_opening = pnl == 0

        if is_opening and key not in open_times:
            open_times[key] = t["time"]

        if pnl != 0 and qty > 0:
            # Closing trade — compute entry price from PnL
            if pos_side == "SHORT" or (pos_side == "BOTH" and side == "BUY"):
                trade_side = "short"
                entry_price = price + (pnl / qty)
            else:
                trade_side = "long"
                entry_price = price - (pnl / qty)

            open_time_ms = open_times.pop(key, t["time"])

            closed.append({
                "external_ticket": str(t["id"]),
                "open_time": datetime.fromtimestamp(open_time_ms / 1000, tz=timezone.utc).replace(tzinfo=None),
                "close_time": datetime.fromtimestamp(t["time"] / 1000, tz=timezone.utc).replace(tzinfo=None),
                "symbol": symbol,
                "side": trade_side,
                "entry_price": round(entry_price, 8),
                "exit_price": price,
                "lot_size": qty,
                "pnl": pnl,
                "pips": None,
            })

    return closed


# ─── Spot ───────────────────────────────────────────────────────────


async def _get_spot_balance(api_key: str, api_secret: str) -> tuple[float, str]:
    """Get total estimated balance in USDT from Spot account."""
    data = await _binance_request(
        "GET", f"{SPOT_BASE}/api/v3/account", {}, api_key, api_secret
    )
    for b in data.get("balances", []):
        if b["asset"] == "USDT":
            total = float(b["free"]) + float(b["locked"])
            if total > 0:
                return total, "USDT"
    # Sum all non-zero balances (can't convert without prices, just report USDT)
    return 0.0, "USDT"


async def _get_spot_traded_symbols(
    api_key: str, api_secret: str, since_ms: int
) -> list[str]:
    """Get spot symbols by checking recent trades on common quote assets."""
    # Binance spot myTrades requires symbol — we use the account endpoint
    # to find assets with non-zero balance, then check USDT pairs
    data = await _binance_request(
        "GET", f"{SPOT_BASE}/api/v3/account", {}, api_key, api_secret
    )
    symbols = []
    for b in data.get("balances", []):
        asset = b["asset"]
        total = float(b["free"]) + float(b["locked"])
        if total > 0 and asset not in ("USDT", "BUSD", "USD", "BNB"):
            symbols.append(f"{asset}USDT")
    # Also try to get traded symbols from recent trades on popular pairs
    return symbols


async def _get_spot_trades(
    api_key: str, api_secret: str, symbol: str, since_ms: int
) -> list[dict]:
    """Fetch all spot trades for a symbol."""
    all_trades = []
    from_id = None
    while True:
        params = {"symbol": symbol, "limit": 1000}
        if from_id:
            params["fromId"] = from_id
        else:
            params["startTime"] = since_ms
        try:
            data = await _binance_request(
                "GET", f"{SPOT_BASE}/api/v3/myTrades", params, api_key, api_secret
            )
        except RuntimeError as e:
            if "-1121" in str(e):  # Invalid symbol
                break
            raise
        all_trades.extend(data)
        if len(data) < 1000:
            break
        from_id = data[-1]["id"] + 1
    return all_trades


def _pair_spot_trades(raw_trades: list[dict]) -> list[dict]:
    """
    Pair spot buy/sell fills into round-trip trades using FIFO.
    Buy = entry (long), Sell = exit.
    """
    trades = sorted(raw_trades, key=lambda t: t["time"])
    # Group by symbol
    by_symbol: dict[str, list] = defaultdict(list)
    for t in trades:
        by_symbol[t["symbol"]].append(t)

    closed = []

    for symbol, sym_trades in by_symbol.items():
        entries: list[tuple] = []  # (price, qty, time, commission)

        for t in sym_trades:
            price = float(t["price"])
            qty = float(t["qty"])
            is_buyer = t["isBuyer"]
            commission = float(t.get("commission", 0))

            if is_buyer:
                entries.append((price, qty, t["time"]))
            else:
                # Sell = close long position, FIFO match
                remaining = qty
                matched_entries = []

                while remaining > 0 and entries:
                    e_price, e_qty, e_time = entries[0]
                    matched = min(remaining, e_qty)
                    matched_entries.append((e_price, matched, e_time))
                    remaining -= matched
                    if matched >= e_qty:
                        entries.pop(0)
                    else:
                        entries[0] = (e_price, e_qty - matched, e_time)

                if matched_entries:
                    total_qty = sum(m[1] for m in matched_entries)
                    avg_entry = sum(m[0] * m[1] for m in matched_entries) / total_qty
                    first_entry_time = min(m[2] for m in matched_entries)
                    pnl = (price - avg_entry) * total_qty - commission

                    closed.append({
                        "external_ticket": str(t["id"]),
                        "open_time": datetime.fromtimestamp(first_entry_time / 1000, tz=timezone.utc).replace(tzinfo=None),
                        "close_time": datetime.fromtimestamp(t["time"] / 1000, tz=timezone.utc).replace(tzinfo=None),
                        "symbol": symbol,
                        "side": "long",
                        "entry_price": round(avg_entry, 8),
                        "exit_price": price,
                        "lot_size": total_qty,
                        "pnl": round(pnl, 8),
                        "pips": None,
                    })

    return closed


# ─── High-level fetch ───────────────────────────────────────────────


async def fetch_binance_trades(
    api_key: str, api_secret: str, account_type: str, since: datetime
) -> dict:
    """
    Fetch closed trades from Binance.
    Returns {"trades": list[dict], "balance": float, "currency": str}.
    """
    since_ms = int(since.replace(tzinfo=timezone.utc).timestamp() * 1000)

    if account_type == "futures_usdm":
        balance, currency = await _get_futures_balance(api_key, api_secret)
        symbols = await _get_futures_traded_symbols(api_key, api_secret, since_ms)
        logger.info("Binance futures: found %d traded symbols", len(symbols))

        all_raw = []
        for sym in symbols:
            raw = await _get_futures_trades(api_key, api_secret, sym, since_ms)
            all_raw.extend(raw)

        trades = _pair_futures_trades(all_raw)
    else:
        balance, currency = await _get_spot_balance(api_key, api_secret)
        symbols = await _get_spot_traded_symbols(api_key, api_secret, since_ms)
        logger.info("Binance spot: found %d potential symbols", len(symbols))

        all_raw = []
        for sym in symbols:
            raw = await _get_spot_trades(api_key, api_secret, sym, since_ms)
            all_raw.extend(raw)

        trades = _pair_spot_trades(all_raw)

    return {"trades": trades, "balance": balance, "currency": currency}


# ─── Business logic ─────────────────────────────────────────────────


async def provision_and_first_sync(connection_id: str, api_key: str, api_secret: str):
    """Background task: validate Binance credentials, create run, initial sync."""
    from database import SessionLocal
    from models.binance_connection import BinanceConnection
    from models.run import Run

    db = SessionLocal()
    conn = None
    try:
        conn = db.query(BinanceConnection).filter(
            BinanceConnection.id == connection_id
        ).first()
        if not conn:
            return

        conn.status = "syncing"
        db.commit()

        # Validate credentials by fetching balance
        if conn.account_type == "futures_usdm":
            balance, currency = await _get_futures_balance(api_key, api_secret)
        else:
            balance, currency = await _get_spot_balance(api_key, api_secret)

        conn.currency = currency
        conn.initial_balance = balance

        # Auto-detect run type
        is_backtest = (
            conn.sync_from and conn.sync_to
            and conn.sync_to < date.today()
        )
        run_type = "backtest" if is_backtest else "live"
        run_label = (
            f"Backtest Binance — {conn.sync_from} → {conn.sync_to}"
            if is_backtest
            else f"Live Sync — Binance {'Futures' if conn.account_type == 'futures_usdm' else 'Spot'}"
        )

        run = Run(
            variant_id=conn.variant_id,
            label=run_label,
            type=run_type,
            initial_balance=balance,
            currency=currency,
            currency_source="detected",
        )
        db.add(run)
        db.flush()
        conn.run_id = run.id
        conn.status = "connected"
        conn.error_message = None
        db.commit()

        # Initial sync
        await _do_sync(conn, db, api_key, api_secret)

    except Exception as e:
        import traceback
        logger.error("Binance provision failed for %s: %s\n%s", connection_id, e, traceback.format_exc())
        if conn:
            conn.status = "error"
            conn.error_message = _user_friendly_error(e)
            db.commit()
    finally:
        db.close()


async def sync_connection(connection_id: str) -> int:
    """Sync a single Binance connection. Returns new trade count."""
    from database import SessionLocal
    from models.binance_connection import BinanceConnection

    db = SessionLocal()
    conn = None
    try:
        conn = db.query(BinanceConnection).filter(
            BinanceConnection.id == connection_id
        ).first()
        if not conn or conn.status != "connected":
            return 0

        api_key = decrypt_password(conn.api_key_enc)
        api_secret = decrypt_password(conn.api_secret_enc)
        return await _do_sync(conn, db, api_key, api_secret)
    except Exception as e:
        logger.error("Binance sync error for %s: %s", connection_id, e)
        if conn:
            conn.error_message = _user_friendly_error(e)
            db.commit()
        return 0
    finally:
        db.close()


async def sync_all_binance_connections():
    """Sync Binance connections that haven't synced in 24h."""
    from database import SessionLocal
    from models.binance_connection import BinanceConnection

    db = SessionLocal()
    try:
        connections = (
            db.query(BinanceConnection)
            .filter(BinanceConnection.status == "connected")
            .all()
        )
        now = datetime.utcnow()
        for conn in connections:
            if conn.last_sync_at and (now - conn.last_sync_at).total_seconds() < 86400:
                continue
            if conn.sync_to and conn.sync_to < now.date():
                continue
            try:
                api_key = decrypt_password(conn.api_key_enc)
                api_secret = decrypt_password(conn.api_secret_enc)
                await _do_sync(conn, db, api_key, api_secret)
            except Exception as e:
                logger.error("Binance sync error for %s: %s", conn.id, e)
                conn.error_message = _user_friendly_error(e)
                db.commit()
    finally:
        db.close()


async def _do_sync(conn, db, api_key: str, api_secret: str) -> int:
    """Core sync: fetch trades from Binance → deduplicate → insert → recompute."""
    from models.trade import Trade
    from models.run import Run
    from models.variant import Variant
    from services.metrics import compute_metrics
    from services.aggregation import recompute_variant_metrics, recompute_strategy_metrics

    if not conn.run_id:
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
            since = datetime(2020, 1, 1)

        result = await fetch_binance_trades(api_key, api_secret, conn.account_type, since)
        trades_data = result["trades"]

        # Filter by sync_to
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
                    "open_time": t.open_time, "close_time": t.close_time,
                    "symbol": t.symbol, "side": t.side,
                    "entry_price": t.entry_price, "exit_price": t.exit_price,
                    "lot_size": t.lot_size, "pnl": t.pnl, "pips": t.pips,
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

        logger.info("Binance synced %d new trades for connection %s", len(new_trades), conn.id)
        return len(new_trades)

    except Exception:
        conn.status = "connected"
        db.commit()
        raise
