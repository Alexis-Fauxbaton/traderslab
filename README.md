# 📊 TradersLab

Application pour traders — organiser des stratégies, documenter des variantes et comparer des résultats de backtest.

## Stack

- **Backend** : Python 3.12+, FastAPI, SQLAlchemy 2.0, SQLite (PostgreSQL-ready), Pydantic v2
- **Frontend** : React 19, Vite 8, Tailwind CSS 4, Chart.js + chartjs-plugin-zoom
- **Serveur** : Uvicorn

## Installation et lancement

### 1. Backend (API)

```bash
# Installer uv (si pas déjà installé)
# Windows
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Cloner et installer
git clone <url-du-repo>
cd traderslab
uv sync            # crée le venv et installe les dépendances

# Lancer le backend
uv run python run_server.py
# ou directement
uv run uvicorn main:app --reload
```

L'API est accessible sur **http://localhost:8000**.
La documentation Swagger est sur **http://localhost:8000/docs**.

### 2. Frontend (React)

```bash
cd frontend-react
npm install
npm run dev
```

Le frontend est accessible sur **http://localhost:5173**.

### Lancer les deux en parallèle (PowerShell)

```powershell
# Terminal 1 — Backend
uv run python run_server.py

# Terminal 2 — Frontend
cd frontend-react; npm run dev
```

> La base SQLite (`traderslab.db`) est créée automatiquement au premier démarrage. Les migrations de schéma sont appliquées automatiquement.

### Avec pip (alternative)

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
python run_server.py
```

## Structure du projet

```
traderslab/
├── main.py                   # Point d'entrée FastAPI, CORS, montage frontend
├── run_server.py             # Lanceur Uvicorn
├── database.py               # Engine SQL, session, migrations auto
├── models/
│   ├── strategy.py           # Modèle Strategy
│   ├── variant.py            # Modèle Variant (parent_variant_id)
│   ├── run.py                # Modèle Run (métriques JSON, currency, initial_balance)
│   └── trade.py              # Modèle Trade
├── schemas/
│   ├── strategy.py           # Schemas Pydantic Strategy
│   ├── variant.py            # Schemas Pydantic Variant + Lineage
│   ├── run.py                # Schemas Pydantic Run + ImportResponse
│   └── trade.py              # Schema Pydantic Trade
├── routers/
│   ├── strategies.py         # CRUD stratégies
│   ├── variants.py           # CRUD variantes + lignée récursive
│   ├── runs.py               # List/detail/delete runs + import CSV
│   ├── compare.py            # Comparaison A vs B avec diff
│   └── analysis.py           # Analyse avancée (Monte Carlo, etc.)
├── services/
│   ├── metrics.py            # Métriques (drawdown, ratios, return %)
│   ├── csv_parser.py         # Parsing CSV + détection currency
│   ├── aggregation.py        # Agrégation métriques variantes (multi-run)
│   └── analysis.py           # Services d'analyse avancée
├── frontend-react/           # SPA React (Vite + Tailwind)
│   ├── src/
│   │   ├── pages/            # Dashboard, StrategyDetail, VariantDetail, RunDetail, Compare, ImportCSV
│   │   ├── components/       # Navbar, Sidebar, ProCharts, EvaluationPanel, UI...
│   │   ├── hooks/            # useSidebar
│   │   └── lib/              # api.js, utils.js, pageCache.js
│   └── ...
├── tests/                    # Tests unitaires (pytest)
└── requirements.txt
```

## Endpoints API

### Stratégies

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/strategies` | Liste toutes les stratégies |
| POST | `/strategies` | Créer une stratégie |
| GET | `/strategies/{id}` | Détail avec variantes |
| PUT | `/strategies/{id}` | Modifier |
| DELETE | `/strategies/{id}` | Supprimer |

### Variantes

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/variants?strategy_id=xxx` | Liste les variantes d'une stratégie |
| POST | `/variants` | Créer une variante |
| GET | `/variants/{id}` | Détail avec runs |
| PUT | `/variants/{id}` | Modifier (decision, status...) |
| DELETE | `/variants/{id}` | Supprimer |
| GET | `/variants/{id}/lineage` | Arbre de lignée depuis la racine |

### Runs

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/runs?variant_id=xxx` | Liste les runs d'une variante |
| GET | `/runs/{id}` | Détail avec métriques et trades |
| GET | `/runs/{id}/summary` | Résumé (métriques, currency, initial_balance) |
| DELETE | `/runs/{id}` | Supprimer |
| POST | `/runs/import` | Import CSV (multipart, avec currency optionnelle) |

### Comparaison

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/compare?variant_a=xxx&variant_b=xxx` | Compare deux variantes (métriques, diff, currency) |

## Import CSV

L'import accepte le format **FX Replay** par défaut :

```csv
Open Time,Close Time,Symbol,Type,Entry,Exit,Lots,Profit,Pips
2024-01-15 10:00:00,2024-01-15 10:30:00,XAUUSD,buy,2050.50,2052.00,0.1,15.0,15
```

Un mapping de colonnes personnalisé peut être envoyé en JSON dans le champ `column_mapping` du formulaire d'import.

### Currency (devise du compte)

La devise du compte est résolue dans cet ordre de priorité :

1. **Saisie manuelle** dans le formulaire d'import (champ « Devise du compte »)
2. **Auto-détection CSV** — colonnes `currency`, `accountCurrency`, `base_currency`, `Currency Deposit`
3. **Défaut** — `USD`

La currency est stockée sur chaque Run (`currency`, `currency_source`). Au niveau de la Variante, les métriques agrégées incluent `currency`, `mixed_currencies` (booléen) et `currencies` (liste) pour signaler quand les runs n'ont pas la même devise.

## Métriques calculées

- **Total PnL** — somme des profits/pertes
- **Total Return %** — PnL total / capital initial
- **Win Rate** — ratio de trades gagnants
- **Profit Factor** — gains / pertes
- **Max Drawdown ($)** — calculé sur la courbe d'equity cumulée
- **Max Drawdown (%)** — drawdown relatif au capital initial (initial_balance-aware)
- **Sharpe Ratio** — rendement ajusté au risque (annualisé)
- **Sortino Ratio** — rendement ajusté au risque baissier (annualisé)
- **Recovery Factor** — PnL total / max drawdown
- **Expectancy** — (win_rate × avg_win) - (loss_rate × avg_loss)
- **Avg Win / Avg Loss / Best / Worst Trade**
- **Equity Curve** — série chronologique du PnL cumulé
