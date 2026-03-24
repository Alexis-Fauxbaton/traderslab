from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import engine, Base
from routers import strategies, variants, runs, compare

# Création des tables au démarrage
Base.metadata.create_all(bind=engine)

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


@app.get("/")
def serve_frontend():
    return FileResponse("frontend/index.html")


# Fichiers statiques du frontend (CSS, JS)
app.mount("/static", StaticFiles(directory="frontend"), name="static")
