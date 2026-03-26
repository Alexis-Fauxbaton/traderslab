"""Tests exhaustifs pour services/metrics.py — compute_metrics.

Chaque KPI est vérifié manuellement avec des valeurs calculées à la main.
"""

import pytest
from datetime import datetime
from services.metrics import compute_metrics


# ─── Helpers ───────────────────────────────────────────────────

def make_trade(pnl: float, close_time: str = "2024-01-01T10:00:00") -> dict:
    return {"pnl": pnl, "close_time": close_time}


def make_trades(pnls: list[float], start: str = "2024-01-01") -> list[dict]:
    """Génère des trades avec des dates incrémentales."""
    trades = []
    for i, pnl in enumerate(pnls):
        day = str(i + 1).zfill(2)
        trades.append({"pnl": pnl, "close_time": f"{start}-{day}T10:00:00"})
    return trades


# ─── Test : liste vide ────────────────────────────────────────

def test_empty_trades():
    m = compute_metrics([])
    assert m["total_trades"] == 0
    assert m["win_rate"] == 0.0
    assert m["profit_factor"] is None
    assert m["max_drawdown"] == 0.0
    assert m["dd_peak_equity"] == 0.0
    assert m["dd_start_idx"] == 0
    assert m["dd_end_idx"] == 0
    assert m["expectancy"] == 0.0
    assert m["total_pnl"] == 0.0
    assert m["avg_win"] == 0.0
    assert m["avg_loss"] == 0.0
    assert m["best_trade"] == 0.0
    assert m["worst_trade"] == 0.0
    assert m["equity_curve"] == []


# ─── Test : un seul trade gagnant ─────────────────────────────

def test_single_winning_trade():
    m = compute_metrics([make_trade(100.0)])
    assert m["total_trades"] == 1
    assert m["win_rate"] == 1.0
    assert m["profit_factor"] is None  # pas de pertes → division par 0
    assert m["total_pnl"] == 100.0
    assert m["avg_win"] == 100.0
    assert m["avg_loss"] == 0.0
    assert m["best_trade"] == 100.0
    assert m["worst_trade"] == 100.0
    assert m["expectancy"] == 100.0
    assert m["max_drawdown"] == 0.0
    assert m["dd_peak_equity"] == 0.0
    assert m["dd_start_idx"] == 0
    assert m["dd_end_idx"] == 0


# ─── Test : un seul trade perdant ─────────────────────────────

def test_single_losing_trade():
    m = compute_metrics([make_trade(-50.0)])
    assert m["total_trades"] == 1
    assert m["win_rate"] == 0.0
    # sum_wins = 0, sum_losses = 50 → profit_factor = 0/50 = 0.0
    assert m["profit_factor"] == 0.0
    assert m["total_pnl"] == -50.0
    assert m["avg_win"] == 0.0
    assert m["avg_loss"] == -50.0
    assert m["expectancy"] == -50.0
    # Max drawdown : equity part de 0, descend à -50 → drawdown = 0 - (-50) = 50
    assert m["max_drawdown"] == 50.0
    # dd_peak_equity = pic au moment du max DD = 0 (capital initial)
    assert m["dd_peak_equity"] == 0.0
    # DD de l'indice 0 (pic=0) à l'indice 0 (seul trade)
    assert m["dd_start_idx"] == 0
    assert m["dd_end_idx"] == 0


# ─── Test : cas classique mixte ───────────────────────────────

def test_mixed_trades():
    """5 trades : +200, -100, +150, -50, +100 = +300 total."""
    pnls = [200, -100, 150, -50, 100]
    trades = make_trades(pnls)
    m = compute_metrics(trades)

    assert m["total_trades"] == 5
    assert m["total_pnl"] == 300.0

    # Win rate : 3 gagnants / 5 = 0.6
    assert m["win_rate"] == 0.6

    # Profit factor : (200+150+100) / |(-100)+(-50)| = 450/150 = 3.0
    assert m["profit_factor"] == 3.0

    # Avg win : (200+150+100)/3 = 150
    assert m["avg_win"] == 150.0

    # Avg loss : (-100 + -50) / 2 = -75
    assert m["avg_loss"] == -75.0

    # Expectancy : total_pnl / total_trades = 300/5 = 60
    assert m["expectancy"] == 60.0

    # Best/worst
    assert m["best_trade"] == 200.0
    assert m["worst_trade"] == -100.0

    # Max drawdown :
    # Equity : 200, 100, 250, 200, 300
    # Peak :   200, 200, 250, 250, 300
    # DD :       0, 100,   0,  50,   0  → max = 100
    assert m["max_drawdown"] == 100.0
    # dd_peak_equity = pic au moment du max DD (200→100) = 200
    assert m["dd_peak_equity"] == 200.0
    # Equity : 200, 100, 250, 200, 300 — DD max entre indice 0 (pic=200) et indice 1 (creux=100)
    assert m["dd_start_idx"] == 0
    assert m["dd_end_idx"] == 1


# ─── Test : max drawdown quand tout descend ───────────────────

def test_max_drawdown_all_losses():
    """Tous les trades sont perdants : -10, -20, -30."""
    trades = make_trades([-10, -20, -30])
    m = compute_metrics(trades)

    # Equity : -10, -30, -60
    # Peak commence à 0, reste à 0
    # DD : 10, 30, 60 → max = 60
    assert m["max_drawdown"] == 60.0
    # Peak au moment du max DD = 0 (jamais monté au-dessus)
    assert m["dd_peak_equity"] == 0.0
    # Peak=0 avant le premier trade, creux au dernier trade (indice 2)
    assert m["dd_start_idx"] == 0
    assert m["dd_end_idx"] == 2
    assert m["total_pnl"] == -60.0


# ─── Test : max drawdown avec recovery ────────────────────────

def test_max_drawdown_with_recovery():
    """Drawdown suivi d'une recovery partielle."""
    # Equity: +100, +50, +150, +50, +200
    pnls = [100, -50, 100, -100, 150]
    trades = make_trades(pnls)
    m = compute_metrics(trades)

    # Cumulative : 100, 50, 150, 50, 200
    # Peak :       100, 100, 150, 150, 200
    # DD :           0,  50,   0, 100,   0 → max = 100
    assert m["max_drawdown"] == 100.0
    # dd_peak_equity = pic au moment du max DD (150→50) = 150
    assert m["dd_peak_equity"] == 150.0
    # Cumulative : 100, 50, 150, 50, 200 — DD max entre indice 2 (pic=150) et indice 3 (creux=50)
    assert m["dd_start_idx"] == 2
    assert m["dd_end_idx"] == 3


# ─── Test : profit factor sans aucune perte ───────────────────

def test_profit_factor_no_losses():
    """Aucun trade perdant → profit_factor = None (infini)."""
    trades = make_trades([100, 200, 50])
    m = compute_metrics(trades)
    assert m["profit_factor"] is None
    assert m["win_rate"] == 1.0


# ─── Test : profit factor sans aucun gain ─────────────────────

def test_profit_factor_no_wins():
    """Aucun trade gagnant → profit_factor = 0."""
    trades = make_trades([-100, -200])
    m = compute_metrics(trades)
    # sum_wins = 0, sum_losses = 300 → 0/300 = 0.0
    assert m["profit_factor"] == 0.0
    assert m["win_rate"] == 0.0


# ─── Test : trade à PnL = 0 (breakeven) ──────────────────────

def test_breakeven_trade():
    """Un trade à 0 n'est ni gagnant ni perdant."""
    trades = make_trades([100, 0, -50])
    m = compute_metrics(trades)

    # total = 3, wins = [100], losses = [-50], 0 n'est dans aucun
    assert m["total_trades"] == 3
    assert m["win_rate"] == pytest.approx(1 / 3, abs=0.001)
    assert m["avg_win"] == 100.0
    assert m["avg_loss"] == -50.0
    assert m["profit_factor"] == 2.0  # 100/50


# ─── Test : equity curve order ────────────────────────────────

def test_equity_curve_chronological():
    """L'equity curve doit être triée chronologiquement."""
    trades = [
        {"pnl": 50, "close_time": "2024-01-03T10:00:00"},
        {"pnl": -20, "close_time": "2024-01-01T10:00:00"},
        {"pnl": 30, "close_time": "2024-01-02T10:00:00"},
    ]
    m = compute_metrics(trades)

    dates = [p["date"] for p in m["equity_curve"]]
    assert dates == sorted(dates)

    # Chronological pnls: -20, +30, +50
    # Cumulative: -20, 10, 60
    assert m["equity_curve"][0]["cumulative_pnl"] == -20.0
    assert m["equity_curve"][1]["cumulative_pnl"] == 10.0
    assert m["equity_curve"][2]["cumulative_pnl"] == 60.0


# ─── Test : datetime objects ──────────────────────────────────

def test_datetime_objects_in_trades():
    """close_time peut être un objet datetime, pas juste un string."""
    trades = [
        {"pnl": 100, "close_time": datetime(2024, 1, 1, 10, 0, 0)},
        {"pnl": -30, "close_time": datetime(2024, 1, 2, 12, 0, 0)},
    ]
    m = compute_metrics(trades)
    assert m["total_trades"] == 2
    assert m["total_pnl"] == 70.0
    # Equity curve dates should be ISO strings
    assert isinstance(m["equity_curve"][0]["date"], str)


# ─── Test : expectancy vérification croisée ───────────────────

def test_expectancy_cross_check():
    """Expectancy = total_pnl / total_trades, vérifié par formule alternative."""
    pnls = [120, -80, 60, -40, 90, -30, 50, -60, 110, -20]
    trades = make_trades(pnls)
    m = compute_metrics(trades)

    total_pnl = sum(pnls)
    n = len(pnls)

    # Méthode directe
    assert m["expectancy"] == round(total_pnl / n, 2)

    # Cross-check avec formule : WR * avg_win + LR * avg_loss
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    wr = len(wins) / n
    lr = len(losses) / n
    avg_w = sum(wins) / len(wins)
    avg_l = sum(losses) / len(losses)
    expected = wr * avg_w + lr * avg_l
    assert m["expectancy"] == pytest.approx(expected, abs=0.01)


# ─── Test : max drawdown depuis le capital initial (0) ────────

def test_max_drawdown_starts_from_zero():
    """Si le premier trade est une perte, le drawdown se calcule depuis 0."""
    trades = make_trades([-100, 50])
    m = compute_metrics(trades)

    # Equity : -100, -50
    # Peak part de 0, reste à 0
    # DD : 100, 50 → max = 100
    assert m["max_drawdown"] == 100.0
    # Peak au moment du max DD = 0
    assert m["dd_peak_equity"] == 0.0
    # Equity : -100, -50 — DD max entre peak_idx=0 et indice 0
    assert m["dd_start_idx"] == 0
    assert m["dd_end_idx"] == 0


# ─── Test : grands nombres ────────────────────────────────────

def test_large_numbers():
    """Vérifie la précision avec de grands montants."""
    pnls = [1_000_000, -500_000, 750_000, -250_000]
    trades = make_trades(pnls)
    m = compute_metrics(trades)

    assert m["total_pnl"] == 1_000_000.0
    assert m["profit_factor"] == pytest.approx(1_750_000 / 750_000, abs=0.001)
    assert m["expectancy"] == 250_000.0


# ─── Test : beaucoup de trades ────────────────────────────────

def test_many_trades():
    """100 trades alternant win/loss."""
    pnls = [10 if i % 2 == 0 else -8 for i in range(100)]
    trades = make_trades(pnls, start="2024-01")
    m = compute_metrics(trades)

    assert m["total_trades"] == 100
    assert m["win_rate"] == 0.5
    # 50 wins * 10 = 500, 50 losses * 8 = 400
    assert m["profit_factor"] == pytest.approx(500 / 400, abs=0.001)
    assert m["total_pnl"] == pytest.approx(500 - 400, abs=0.01)
    assert m["expectancy"] == pytest.approx(1.0, abs=0.01)  # 100/100


# ─── Test : rounding ─────────────────────────────────────────

def test_rounding():
    """Vérifie que les résultats sont bien arrondis."""
    trades = make_trades([33.333, -16.667])
    m = compute_metrics(trades)

    assert m["total_pnl"] == 16.67  # round(33.333 - 16.667, 2)
    assert m["avg_win"] == 33.33
    assert m["avg_loss"] == -16.67
    assert isinstance(m["win_rate"], float)
    assert len(str(m["win_rate"]).split(".")[-1]) <= 4  # max 4 décimales
