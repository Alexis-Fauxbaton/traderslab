"""Tests exhaustifs pour services/metrics.py — compute_metrics.

Chaque KPI est vérifié manuellement avec des valeurs calculées à la main.
"""

import pytest
from datetime import datetime
from services.metrics import compute_metrics


# ─── Helpers ───────────────────────────────────────────────────

def make_trade(pnl: float, close_time: str = "2024-01-01T10:00:00") -> dict:
    return {"pnl": pnl, "close_time": datetime.fromisoformat(close_time)}


def make_trades(pnls: list[float], start: str = "2024-01") -> list[dict]:
    """Génère des trades avec des dates incrémentales (objets datetime)."""
    trades = []
    for i, pnl in enumerate(pnls):
        day = str(i + 1).zfill(2)
        dt = datetime.fromisoformat(f"{start}-{day}T10:00:00")
        trades.append({"pnl": pnl, "close_time": dt})
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
        {"pnl": 50, "close_time": datetime(2024, 1, 3, 10, 0, 0)},
        {"pnl": -20, "close_time": datetime(2024, 1, 1, 10, 0, 0)},
        {"pnl": 30, "close_time": datetime(2024, 1, 2, 10, 0, 0)},
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
    # Spread across multiple months to avoid >31 days in a single month
    trades = []
    for i, pnl in enumerate(pnls):
        month = (i // 28) + 1
        day = (i % 28) + 1
        trades.append({"pnl": pnl, "close_time": datetime(2024, month, day, 10, 0, 0)})
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


# ═══════════════════════════════════════════════════════════════
# Tests : max_drawdown_pct (ratio négatif)
# ═══════════════════════════════════════════════════════════════

class TestMaxDrawdownPct:
    """Le drawdown en pourcentage doit être un ratio négatif relatif au pic d'equity."""

    def test_positive_equity_peak(self):
        """DD% = -(max_drawdown / dd_peak_equity) quand le pic est positif."""
        # Equity: 200, 100, 250 → peak=200 au moment du DD, DD=100
        trades = make_trades([200, -100, 150])
        m = compute_metrics(trades)
        assert m["max_drawdown"] == 100.0
        assert m["dd_peak_equity"] == 200.0
        # DD% = -(100 / 200) = -0.5
        assert m["max_drawdown_pct"] == -0.5

    def test_no_positive_peak(self):
        """Si l'equity n'est jamais positive, max_drawdown_pct = None."""
        trades = make_trades([-10, -20, -30])
        m = compute_metrics(trades)
        assert m["max_drawdown"] == 60.0
        assert m["dd_peak_equity"] == 0.0
        assert m["max_drawdown_pct"] is None

    def test_no_drawdown(self):
        """Si tous les trades sont gagnants, pas de drawdown."""
        trades = make_trades([100, 200, 50])
        m = compute_metrics(trades)
        assert m["max_drawdown"] == 0.0
        assert m["max_drawdown_pct"] is None

    def test_small_drawdown_ratio(self):
        """DD petit par rapport au pic → ratio proche de zéro."""
        trades = make_trades([1000, -10, 500])
        m = compute_metrics(trades)
        # Equity: 1000, 990, 1490 → peak=1000 au DD, DD=10
        assert m["max_drawdown"] == 10.0
        assert m["max_drawdown_pct"] == pytest.approx(-0.01, abs=0.001)

    def test_empty_trades(self):
        """Liste vide → max_drawdown_pct = None."""
        m = compute_metrics([])
        assert m["max_drawdown_pct"] is None


# ═══════════════════════════════════════════════════════════════
# Tests : _compute_ttest
# ═══════════════════════════════════════════════════════════════

class TestTTest:
    """T-test unilatéral : l'espérance est-elle significativement > 0 ?"""

    def test_too_few_trades(self):
        """Moins de 5 trades → ttest = None."""
        trades = make_trades([10, 20, -5, 15])
        m = compute_metrics(trades)
        assert m["ttest"] is None

    def test_all_same_pnl(self):
        """Variance nulle → ttest = None."""
        trades = make_trades([10, 10, 10, 10, 10])
        m = compute_metrics(trades)
        assert m["ttest"] is None

    def test_clearly_positive(self):
        """PnL fortement positifs → significatif."""
        pnls = [100, 90, 110, 95, 105, 100, 98, 102, 97, 103]
        trades = make_trades(pnls, start="2024-01")
        m = compute_metrics(trades)
        assert m["ttest"] is not None
        assert m["ttest"]["t_statistic"] > 0
        assert m["ttest"]["p_value"] < 0.01
        assert m["ttest"]["significant_1pct"] is True
        assert m["ttest"]["n"] == 10

    def test_mixed_results_not_significant(self):
        """PnL très variables → non significatif."""
        pnls = [50, -60, 70, -80, 40, -50, 60, -70, 30, -40]
        trades = make_trades(pnls, start="2024-01")
        m = compute_metrics(trades)
        assert m["ttest"] is not None
        assert m["ttest"]["significant_5pct"] is False

    def test_structure(self):
        """Le résultat contient les bonnes clés."""
        trades = make_trades([10, 20, -5, 15, 25], start="2024-01")
        m = compute_metrics(trades)
        ttest = m["ttest"]
        assert ttest is not None
        expected_keys = {"t_statistic", "p_value", "significant_5pct", "significant_1pct", "n"}
        assert set(ttest.keys()) == expected_keys


# ═══════════════════════════════════════════════════════════════
# Tests : _compute_monte_carlo
# ═══════════════════════════════════════════════════════════════

class TestMonteCarlo:
    """Bootstrap Monte Carlo avec seed fixe pour reproductibilité."""

    def test_too_few_trades(self):
        """Moins de 10 trades → monte_carlo = None."""
        trades = make_trades([10, 20, -5, 15, 25, -10, 30, 20, -15])
        m = compute_metrics(trades)
        assert m["monte_carlo"] is None

    def test_reproducibility(self):
        """Seed fixe → résultats identiques à chaque appel."""
        pnls = [10, -5, 15, -8, 20, -3, 12, -7, 18, -2, 14, -6]
        trades = make_trades(pnls, start="2024-01")
        m1 = compute_metrics(trades)
        m2 = compute_metrics(trades)
        assert m1["monte_carlo"]["pnl_median"] == m2["monte_carlo"]["pnl_median"]
        assert m1["monte_carlo"]["max_dd_median"] == m2["monte_carlo"]["max_dd_median"]

    def test_structure(self):
        """Le résultat contient les bonnes clés."""
        pnls = [10, -5, 15, -8, 20, -3, 12, -7, 18, -2, 14, -6]
        trades = make_trades(pnls, start="2024-01")
        m = compute_metrics(trades)
        mc = m["monte_carlo"]
        assert mc is not None
        expected_keys = {
            "pnl_median", "pnl_ci_lower", "pnl_ci_upper",
            "max_dd_median", "max_dd_ci_lower", "max_dd_ci_upper",
            "pct_profitable", "n_simulations",
        }
        assert set(mc.keys()) == expected_keys

    def test_ci_ordering(self):
        """L'intervalle de confiance est correctement ordonné : lower <= median <= upper."""
        pnls = [10, -5, 15, -8, 20, -3, 12, -7, 18, -2, 14, -6]
        trades = make_trades(pnls, start="2024-01")
        mc = compute_metrics(trades)["monte_carlo"]
        assert mc["pnl_ci_lower"] <= mc["pnl_median"] <= mc["pnl_ci_upper"]
        assert mc["max_dd_ci_lower"] <= mc["max_dd_median"] <= mc["max_dd_ci_upper"]

    def test_mostly_positive_strategy(self):
        """Stratégie profitable → pct_profitable élevé."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        trades = make_trades(pnls, start="2024-01")
        mc = compute_metrics(trades)["monte_carlo"]
        assert mc["pct_profitable"] > 80

    def test_mostly_negative_strategy(self):
        """Stratégie perdante → pct_profitable faible."""
        pnls = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42]
        trades = make_trades(pnls, start="2024-01")
        mc = compute_metrics(trades)["monte_carlo"]
        assert mc["pct_profitable"] < 30


# ═══════════════════════════════════════════════════════════════
# Tests : _compute_split_half
# ═══════════════════════════════════════════════════════════════

class TestSplitHalf:
    """Détection de dégradation en comparant 1ère et 2ème moitié."""

    def test_too_few_trades(self):
        """Moins de 10 trades → split_half = None."""
        trades = make_trades([10, 20, -5, 15, 25, -10, 30, 20, -15])
        m = compute_metrics(trades)
        assert m["split_half"] is None

    def test_stable_performance(self):
        """Performance égale → status = 'stable'."""
        pnls = [10, -5, 15, -8, 20, 10, -5, 15, -8, 20]
        trades = make_trades(pnls, start="2024-01")
        sh = compute_metrics(trades)["split_half"]
        assert sh is not None
        assert sh["status"] == "stable"
        assert sh["degradation_signals"] == 0

    def test_degrading_performance(self):
        """PnL excellent puis négatif → status = 'degrading'."""
        pnls = [50, 60, 40, 55, 45, -20, -30, -25, -35, -15]
        trades = make_trades(pnls, start="2024-01")
        sh = compute_metrics(trades)["split_half"]
        assert sh is not None
        assert sh["status"] == "degrading"
        assert sh["degradation_signals"] >= 2

    def test_improving_performance(self):
        """PnL faible puis beaucoup mieux → status = 'improving'."""
        pnls = [5, 3, 2, 4, 6, 50, 60, 55, 45, 40]
        trades = make_trades(pnls, start="2024-01")
        sh = compute_metrics(trades)["split_half"]
        assert sh is not None
        assert sh["status"] == "improving"

    def test_structure(self):
        """Le résultat contient les bonnes clés."""
        pnls = [10, -5, 15, -8, 20, 10, -5, 15, -8, 20]
        trades = make_trades(pnls, start="2024-01")
        sh = compute_metrics(trades)["split_half"]
        assert sh is not None
        assert "first_half" in sh
        assert "second_half" in sh
        assert "status" in sh
        assert "degradation_signals" in sh
        for half_key in ("first_half", "second_half"):
            half = sh[half_key]
            assert "pnl" in half
            assert "win_rate" in half
            assert "profit_factor" in half
            assert "expectancy" in half
            assert "trades" in half

    def test_half_trade_counts(self):
        """Chaque moitié doit avoir le bon nombre de trades."""
        pnls = [10, -5, 15, -8, 20, 10, -5, 15, -8, 20, 12, -3]
        trades = make_trades(pnls, start="2024-01")
        sh = compute_metrics(trades)["split_half"]
        assert sh["first_half"]["trades"] == 6
        assert sh["second_half"]["trades"] == 6


# ═══════════════════════════════════════════════════════════════
# Tests : _compute_streaks
# ═══════════════════════════════════════════════════════════════

class TestStreaks:
    """Séries max consécutives de wins et losses."""

    def test_alternating(self):
        """Win/loss alterné → 1 max partout."""
        trades = make_trades([10, -5, 10, -5, 10, -5])
        m = compute_metrics(trades)
        assert m["max_consecutive_wins"] == 1
        assert m["max_consecutive_losses"] == 1

    def test_all_wins(self):
        """Tous gagnants → streak = total."""
        trades = make_trades([10, 20, 30, 40])
        m = compute_metrics(trades)
        assert m["max_consecutive_wins"] == 4
        assert m["max_consecutive_losses"] == 0

    def test_all_losses(self):
        """Tous perdants → loss streak = total."""
        trades = make_trades([-10, -20, -30])
        m = compute_metrics(trades)
        assert m["max_consecutive_wins"] == 0
        assert m["max_consecutive_losses"] == 3

    def test_streak_with_breakeven(self):
        """Un trade à 0 casse les deux séries."""
        trades = make_trades([10, 10, 0, 10])
        m = compute_metrics(trades)
        assert m["max_consecutive_wins"] == 2  # les 2 premiers

    def test_long_loss_streak(self):
        """Détecte une longue série de pertes."""
        pnls = [10, -5, -5, -5, -5, -5, 20]
        trades = make_trades(pnls)
        m = compute_metrics(trades)
        assert m["max_consecutive_losses"] == 5
        assert m["max_consecutive_wins"] == 1


# ═══════════════════════════════════════════════════════════════
# Tests : _compute_consistency_score
# ═══════════════════════════════════════════════════════════════

class TestConsistencyScore:
    """Score de consistance 0-100 basé sur les mois rentables et la régularité."""

    def test_single_month(self):
        """Un seul mois → consistency_score = None."""
        trades = make_trades([10, 20, -5])
        m = compute_metrics(trades)
        assert m["consistency_score"] is None

    def test_all_profitable_months(self):
        """Tous les mois rentables et réguliers → score élevé."""
        trades = []
        for month in range(1, 7):
            for day in range(1, 6):
                dt = datetime(2024, month, day, 10, 0, 0)
                trades.append({"pnl": 10.0, "close_time": dt})
        m = compute_metrics(trades)
        assert m["consistency_score"] is not None
        assert m["consistency_score"] >= 60  # 100% mois rentables = 60 pts minimum

    def test_very_irregular(self):
        """Mois très irréguliers → score plus bas."""
        trades = []
        # M1: +1000, M2: -800, M3: +1200, M4: -900
        for val, month in [(1000, 1), (-800, 2), (1200, 3), (-900, 4)]:
            trades.append({"pnl": val, "close_time": datetime(2024, month, 15, 10, 0, 0)})
        m = compute_metrics(trades)
        assert m["consistency_score"] is not None
        # Seulement 50% des mois rentables, forte irrégularité
        assert m["consistency_score"] < 50

    def test_score_bounds(self):
        """Le score doit être entre 0 et 100."""
        pnls_per_month = [100, -200, 50, -150, 300, -10]
        trades = []
        for i, pnl in enumerate(pnls_per_month):
            trades.append({"pnl": pnl, "close_time": datetime(2024, i + 1, 15, 10, 0, 0)})
        m = compute_metrics(trades)
        if m["consistency_score"] is not None:
            assert 0 <= m["consistency_score"] <= 100


# ═══════════════════════════════════════════════════════════════
# Tests : drawdown unité cohérence backend/frontend
# ═══════════════════════════════════════════════════════════════

class TestDrawdownUnitCoherence:
    """Vérifie que max_drawdown (absolu) et max_drawdown_pct (ratio) sont cohérents."""

    def test_ratio_is_negative(self):
        """max_drawdown_pct est toujours négatif (convention)."""
        trades = make_trades([200, -100, 150, -50, 100])
        m = compute_metrics(trades)
        if m["max_drawdown_pct"] is not None:
            assert m["max_drawdown_pct"] < 0

    def test_ratio_consistent_with_absolute(self):
        """max_drawdown_pct = -(max_drawdown / dd_peak_equity)."""
        trades = make_trades([500, -200, 300, -100, 400])
        m = compute_metrics(trades)
        if m["max_drawdown_pct"] is not None and m["dd_peak_equity"] > 0:
            expected = -(m["max_drawdown"] / m["dd_peak_equity"])
            assert m["max_drawdown_pct"] == pytest.approx(expected, abs=0.0001)

    def test_pct_within_valid_range(self):
        """Le ratio doit être entre -1 et 0 (drawdown ne peut excéder 100% du pic)."""
        trades = make_trades([200, -100, 150, -50, 100])
        m = compute_metrics(trades)
        if m["max_drawdown_pct"] is not None:
            assert -1.0 <= m["max_drawdown_pct"] <= 0.0
