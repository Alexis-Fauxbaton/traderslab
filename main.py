import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import engine, Base, run_migrations, SessionLocal
from routers import strategies, variants, runs, compare

# Création des tables au démarrage
Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(
    title="TradersLab API",
    description="Backend MVP — organiser des stratégies, documenter des variantes, comparer des backtests.",
    version="0.1.0",
)

# CORS ouvert pour le développement (Lovable frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(strategies.router)
app.include_router(variants.router)
app.include_router(runs.router)
app.include_router(compare.router)


@app.on_event("startup")
def _backfill_metrics():
    from services.aggregation import backfill_all_metrics
    db = SessionLocal()
    try:
        backfill_all_metrics(db)
    finally:
        db.close()

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
