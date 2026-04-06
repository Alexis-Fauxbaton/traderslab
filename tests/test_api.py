"""Tests CRUD API — stratégies, variantes, runs.

Utilise une base SQLite en mémoire isolée par test pour éviter
toute pollution entre les tests ou avec la DB de dev.
"""

import io
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app


# ─── Fixture : DB en mémoire + client isolé ───────────────────

@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def _override():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ─── Helpers ───────────────────────────────────────────────────

def create_strategy(client, **overrides):
    payload = {"name": "My Strat", "description": "desc", "pairs": ["XAUUSD"], "timeframes": ["M15"]}
    payload.update(overrides)
    r = client.post("/strategies", json=payload)
    assert r.status_code == 201
    return r.json()


def create_variant(client, strategy_id, **overrides):
    payload = {"strategy_id": strategy_id, "name": "V1", "status": "idea", "key_change": ""}
    payload.update(overrides)
    r = client.post("/variants", json=payload)
    assert r.status_code == 201
    return r.json()


SAMPLE_CSV = (
    "dateStart,dateEnd,pair,side,entryPrice,avgClosePrice,amount,rPnL\n"
    "2024-01-02 10:00,2024-01-02 11:00,XAUUSD,buy,2000,2010,0.1,100\n"
    "2024-01-03 10:00,2024-01-03 11:00,XAUUSD,sell,2010,2020,0.1,-50\n"
    "2024-01-04 10:00,2024-01-04 11:00,XAUUSD,buy,2020,2040,0.1,200\n"
)


def import_csv(client, variant_id, label="BT1", run_type="backtest", csv_content=SAMPLE_CSV):
    r = client.post(
        "/runs/import",
        data={"variant_id": variant_id, "label": label, "type": run_type},
        files={"file": ("trades.csv", io.BytesIO(csv_content.encode()), "text/csv")},
    )
    return r


# ═══════════════════════════════════════════════════════════════
# STRATEGIES
# ═══════════════════════════════════════════════════════════════


class TestStrategyCreate:
    def test_create_minimal(self, client):
        r = client.post("/strategies", json={"name": "Test"})
        assert r.status_code == 201
        data = r.json()
        assert data["name"] == "Test"
        assert data["pairs"] == []
        assert data["timeframes"] == []
        assert data["description"] == ""
        assert "id" in data

    def test_create_with_pairs_and_timeframes(self, client):
        r = client.post("/strategies", json={
            "name": "Gold Scalper",
            "description": "FVG strategy",
            "pairs": ["XAUUSD", "EURUSD"],
            "timeframes": ["M15", "H1"],
        })
        assert r.status_code == 201
        data = r.json()
        assert data["pairs"] == ["XAUUSD", "EURUSD"]
        assert data["timeframes"] == ["M15", "H1"]

    def test_create_missing_name_returns_422(self, client):
        r = client.post("/strategies", json={"description": "no name"})
        assert r.status_code == 422


class TestStrategyRead:
    def test_list_empty(self, client):
        r = client.get("/strategies")
        assert r.status_code == 200
        assert r.json() == []

    def test_list_returns_created(self, client):
        create_strategy(client, name="A")
        create_strategy(client, name="B")
        r = client.get("/strategies")
        assert r.status_code == 200
        names = {s["name"] for s in r.json()}
        assert names == {"A", "B"}

    def test_get_by_id(self, client):
        s = create_strategy(client)
        r = client.get(f"/strategies/{s['id']}")
        assert r.status_code == 200
        assert r.json()["name"] == s["name"]
        assert "variants" in r.json()

    def test_get_nonexistent_returns_404(self, client):
        r = client.get("/strategies/nonexistent-id")
        assert r.status_code == 404


class TestStrategyUpdate:
    def test_update_name(self, client):
        s = create_strategy(client, name="Old")
        r = client.put(f"/strategies/{s['id']}", json={"name": "New"})
        assert r.status_code == 200
        assert r.json()["name"] == "New"

    def test_update_pairs(self, client):
        s = create_strategy(client, pairs=["XAUUSD"])
        r = client.put(f"/strategies/{s['id']}", json={"pairs": ["EURUSD", "GBPUSD"]})
        assert r.status_code == 200
        assert r.json()["pairs"] == ["EURUSD", "GBPUSD"]

    def test_update_timeframes(self, client):
        s = create_strategy(client, timeframes=["M15"])
        r = client.put(f"/strategies/{s['id']}", json={"timeframes": ["H1", "H4"]})
        assert r.status_code == 200
        assert r.json()["timeframes"] == ["H1", "H4"]

    def test_partial_update_preserves_other_fields(self, client):
        s = create_strategy(client, name="Keep", description="Original", pairs=["XAUUSD"])
        r = client.put(f"/strategies/{s['id']}", json={"description": "Updated"})
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Keep"
        assert data["description"] == "Updated"
        assert data["pairs"] == ["XAUUSD"]

    def test_update_nonexistent_returns_404(self, client):
        r = client.put("/strategies/nonexistent-id", json={"name": "X"})
        assert r.status_code == 404


class TestStrategyDelete:
    def test_delete(self, client):
        s = create_strategy(client)
        r = client.delete(f"/strategies/{s['id']}")
        assert r.status_code == 204
        assert client.get(f"/strategies/{s['id']}").status_code == 404

    def test_delete_nonexistent_returns_404(self, client):
        r = client.delete("/strategies/nonexistent-id")
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════
# VARIANTS
# ═══════════════════════════════════════════════════════════════


class TestVariantCreate:
    def test_create(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"], name="V1")
        assert v["name"] == "V1"
        assert v["strategy_id"] == s["id"]
        assert v["status"] == "idea"

    def test_create_with_parent(self, client):
        s = create_strategy(client)
        v1 = create_variant(client, s["id"], name="V1")
        v2 = create_variant(client, s["id"], name="V2", parent_variant_id=v1["id"])
        assert v2["parent_variant_id"] == v1["id"]

    def test_create_missing_strategy_id_returns_422(self, client):
        r = client.post("/variants", json={"name": "V1"})
        assert r.status_code == 422


class TestVariantRead:
    def test_list_by_strategy(self, client):
        s = create_strategy(client)
        create_variant(client, s["id"], name="V1")
        create_variant(client, s["id"], name="V2")
        r = client.get("/variants", params={"strategy_id": s["id"]})
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_list_requires_strategy_id(self, client):
        r = client.get("/variants")
        assert r.status_code == 422

    def test_get_by_id(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"], name="MyVariant")
        r = client.get(f"/variants/{v['id']}")
        assert r.status_code == 200
        assert r.json()["name"] == "MyVariant"
        assert r.json()["strategy_name"] == s["name"]

    def test_get_nonexistent_returns_404(self, client):
        r = client.get("/variants/nonexistent-id")
        assert r.status_code == 404


class TestVariantUpdate:
    def test_update_status(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        r = client.put(f"/variants/{v['id']}", json={"status": "active"})
        assert r.status_code == 200
        assert r.json()["status"] == "active"

    def test_update_nonexistent_returns_404(self, client):
        r = client.put("/variants/nonexistent-id", json={"name": "X"})
        assert r.status_code == 404


class TestVariantDelete:
    def test_delete(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        r = client.delete(f"/variants/{v['id']}")
        assert r.status_code == 204
        assert client.get(f"/variants/{v['id']}").status_code == 404

    def test_delete_nonexistent_returns_404(self, client):
        r = client.delete("/variants/nonexistent-id")
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════
# RUNS + CSV IMPORT
# ═══════════════════════════════════════════════════════════════


class TestRunImport:
    def test_import_csv_success(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        r = import_csv(client, v["id"])
        assert r.status_code == 200
        data = r.json()
        assert data["nb_trades_imported"] == 3
        assert "run_id" in data
        assert data["metrics"]["total_trades"] == 3

    def test_import_nonexistent_variant_returns_404(self, client):
        r = import_csv(client, "nonexistent-id")
        assert r.status_code == 404

    def test_import_invalid_type_returns_400(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        r = import_csv(client, v["id"], run_type="invalid")
        assert r.status_code == 400

    def test_import_empty_csv_returns_400(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        r = import_csv(client, v["id"], csv_content="col1,col2\n")
        assert r.status_code == 400

    def test_import_overlap_warning(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        import_csv(client, v["id"], label="Run1")
        r = import_csv(client, v["id"], label="Run2")
        assert r.status_code == 200
        assert any("Overlap" in w for w in r.json()["warnings"])


class TestRunRead:
    def test_list_runs(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        import_csv(client, v["id"], label="R1")
        import_csv(client, v["id"], label="R2")
        r = client.get("/runs", params={"variant_id": v["id"]})
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_get_run_detail(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        imp = import_csv(client, v["id"])
        run_id = imp.json()["run_id"]
        r = client.get(f"/runs/{run_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["label"] == "BT1"
        assert data["metrics"]["total_trades"] == 3

    def test_get_run_trades_paginated(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        imp = import_csv(client, v["id"])
        run_id = imp.json()["run_id"]
        r = client.get(f"/runs/{run_id}/trades", params={"page": 1, "per_page": 2})
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) == 2
        assert data["total"] == 3
        assert data["page"] == 1

    def test_get_nonexistent_run_returns_404(self, client):
        assert client.get("/runs/nonexistent-id").status_code == 404


class TestRunDelete:
    def test_delete_run_recomputes_metrics(self, client):
        s = create_strategy(client)
        v = create_variant(client, s["id"])
        imp = import_csv(client, v["id"])
        run_id = imp.json()["run_id"]
        r = client.delete(f"/runs/{run_id}")
        assert r.status_code == 204
        # Run supprimé, la liste doit être vide
        r = client.get("/runs", params={"variant_id": v["id"]})
        assert len(r.json()) == 0

    def test_delete_nonexistent_returns_404(self, client):
        r = client.delete("/runs/nonexistent-id")
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════
# FULL WORKFLOW (intégration)
# ═══════════════════════════════════════════════════════════════


class TestFullWorkflow:
    """Simule le parcours utilisateur complet :
    créer stratégie → créer variante → importer CSV → consulter métriques → supprimer."""

    def test_create_strategy_variant_import_and_read(self, client):
        # 1. Créer stratégie
        s = create_strategy(client, name="Gold FVG", pairs=["XAUUSD"], timeframes=["M15"])
        assert s["pairs"] == ["XAUUSD"]

        # 2. Créer variante
        v = create_variant(client, s["id"], name="Gold FVG V1")

        # 3. Importer un backtest
        imp = import_csv(client, v["id"])
        assert imp.status_code == 200
        run_id = imp.json()["run_id"]

        # 4. Lire le détail de la stratégie (avec variantes)
        detail = client.get(f"/strategies/{s['id']}").json()
        assert len(detail["variants"]) == 1
        assert detail["variants"][0]["name"] == "Gold FVG V1"

        # 5. Lire le détail du run
        run = client.get(f"/runs/{run_id}").json()
        assert run["metrics"]["total_trades"] == 3
        assert run["metrics"]["total_pnl"] == pytest.approx(250.0)

        # 6. Lire les trades
        trades = client.get(f"/runs/{run_id}/trades").json()
        assert trades["total"] == 3

        # 7. Supprimer le run
        assert client.delete(f"/runs/{run_id}").status_code == 204

        # 8. Supprimer la variante
        assert client.delete(f"/variants/{v['id']}").status_code == 204

        # 9. Supprimer la stratégie
        assert client.delete(f"/strategies/{s['id']}").status_code == 204
        assert client.get("/strategies").json() == []
