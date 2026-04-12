import os
import logging
import asyncio
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import engine, Base, run_migrations, SessionLocal
from models.user import User  # noqa: F401 — ensure users table is created
from models.mt5_connection import MT5Connection  # noqa: F401 — ensure mt5_connections table is created
from routers import strategies, variants, runs, compare, analysis, auth, mt5_sync

logger = logging.getLogger(__name__)

# Création des tables au démarrage
Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(
    title="TradersLab API",
    description="Backend MVP — organiser des stratégies, documenter des variantes, comparer des backtests.",
    version="0.1.0",
)

# --- Rate limiting ---
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# --- Security headers middleware ---
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# --- CORS ---
_allowed_origins = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(strategies.router)
app.include_router(variants.router)
app.include_router(runs.router)
app.include_router(compare.router)
app.include_router(analysis.router)
app.include_router(mt5_sync.router)


@app.on_event("startup")
def _reset_stale_mt5_connections():
    """Reset MT5 connections stuck in pending/deploying from a previous server run."""
    db = SessionLocal()
    try:
        stale = db.query(MT5Connection).filter(
            MT5Connection.status.in_(["pending", "deploying"])
        ).all()
        for conn in stale:
            logger.warning("Resetting stale MT5 connection %s (was %s)", conn.id, conn.status)
            conn.status = "error"
            conn.error_message = "Connexion interrompue par un redémarrage serveur. Réessayez."
        if stale:
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
def _backfill_metrics():
    from services.aggregation import backfill_all_metrics
    db = SessionLocal()
    try:
        backfill_all_metrics(db)
    finally:
        db.close()


@app.on_event("startup")
def _backfill_run_pairs():
    """Backfill pairs on runs that don't have them yet."""
    from models.run import Run
    from models.trade import Trade
    from sqlalchemy import func
    db = SessionLocal()
    try:
        runs_without = db.query(Run).filter(Run.pairs.is_(None)).all()
        for run in runs_without:
            symbols = db.query(Trade.symbol).filter(Trade.run_id == run.id).distinct().all()
            if symbols:
                run.pairs = sorted({s[0] for s in symbols})
        if runs_without:
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
async def _start_mt5_sync_loop():
    """Background loop: sync all active MT5 connections every 5 minutes."""
    from services.mt5_sync import sync_all_connections

    async def _loop():
        await asyncio.sleep(60)  # wait 60s after startup
        while True:
            try:
                await sync_all_connections()
            except Exception as e:
                logger.error("MT5 sync loop error: %s", e)
            await asyncio.sleep(300)  # 5 minutes

    asyncio.create_task(_loop())

# Choix du frontend : React (frontend-react/dist) si buildé, sinon vanilla (frontend/)
_react_dist = os.path.join(os.path.dirname(__file__), "frontend-react", "dist")
_use_react = os.path.isdir(_react_dist) and os.path.isfile(os.path.join(_react_dist, "index.html"))
_frontend_dir = _react_dist if _use_react else "frontend"


@app.get("/")
def serve_frontend():
    return FileResponse(os.path.join(_frontend_dir, "index.html"))


# Fichiers statiques du frontend (CSS, JS)
app.mount("/static", StaticFiles(directory=_frontend_dir), name="static")
# Servir les assets Vite (JS/CSS) directement sous /assets/
if _use_react:
    app.mount("/assets", StaticFiles(directory=os.path.join(_react_dist, "assets")), name="assets")
