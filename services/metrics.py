"""Service de calcul des métriques de performance à partir d'une liste de trades."""

import math
import random
from collections import defaultdict
from datetime import datetime


def _compute_sharpe_annualized(
    sorted_trades: list[dict],
    risk_free_rate: float = 0.0,
) -> float | None:
    """Calcule le Sharpe ratio annualisé par trade."""
    pnls = [t["pnl"] for t in sorted_trades if t["pnl"] != 0]
    n = len(pnls)
    if n < 2:
        return None

    mean_r = sum(pnls) / n
    variance = sum((p - mean_r) ** 2 for p in pnls) / (n - 1)
    std_r = math.sqrt(variance)
    if std_r == 0:
        return None

    first_ct = sorted_trades[0]["close_time"]
    last_ct = sorted_trades[-1]["close_time"]
    delta_seconds = (last_ct - first_ct).total_seconds()
    if delta_seconds <= 0:
        return None

    years = delta_seconds / (365.25 * 24 * 3600)
    trades_per_year = n / years
    rf_per_trade = risk_free_rate / trades_per_year

    sharpe = ((mean_r - rf_per_trade) / std_r) * math.sqrt(trades_per_year)
    return round(sharpe, 4)


def _compute_sortino_annualized(
    sorted_trades: list[dict],
    risk_free_rate: float = 0.0,
) -> float | None:
    """Sortino ratio annualisé — pénalise uniquement la volatilité à la baisse."""
    pnls = [t["pnl"] for t in sorted_trades if t["pnl"] != 0]
    n = len(pnls)
    if n < 2:
        return None

    mean_r = sum(pnls) / n
    downside = [p for p in pnls if p < 0]
    if not downside:
        return None  # pas de downside → ratio non calculable

    downside_var = sum(p ** 2 for p in downside) / n  # semi-variance (divisée par n total)
    downside_dev = math.sqrt(downside_var)
    if downside_dev == 0:
        return None

    first_ct = sorted_trades[0]["close_time"]
    last_ct = sorted_trades[-1]["close_time"]
    delta_seconds = (last_ct - first_ct).total_seconds()
    if delta_seconds <= 0:
        return None

    years = delta_seconds / (365.25 * 24 * 3600)
    trades_per_year = n / years
    rf_per_trade = risk_free_rate / trades_per_year

    sortino = ((mean_r - rf_per_trade) / downside_dev) * math.sqrt(trades_per_year)
    return round(sortino, 4)


def _compute_streaks(pnls: list[float]) -> dict:
    """Calcule les séries max consécutives de wins et de losses."""
    max_win_streak = 0
    max_loss_streak = 0
    current_win = 0
    current_loss = 0

    for p in pnls:
        if p > 0:
            current_win += 1
            current_loss = 0
            max_win_streak = max(max_win_streak, current_win)
        elif p < 0:
            current_loss += 1
            current_win = 0
            max_loss_streak = max(max_loss_streak, current_loss)
        else:
            current_win = 0
            current_loss = 0

    return {
        "max_consecutive_wins": max_win_streak,
        "max_consecutive_losses": max_loss_streak,
    }


def _compute_monthly_breakdown(sorted_trades: list[dict]) -> list[dict]:
    """Retourne le PnL et nombre de trades par mois."""
    buckets: dict[str, dict] = defaultdict(lambda: {"pnl": 0.0, "trades": 0})
    for t in sorted_trades:
        ct = t["close_time"]
        if isinstance(ct, datetime):
            key = ct.strftime("%Y-%m")
        else:
            key = str(ct)[:7]
        buckets[key]["pnl"] += t["pnl"]
        buckets[key]["trades"] += 1

    return [
        {"month": k, "pnl": round(v["pnl"], 2), "trades": v["trades"]}
        for k, v in sorted(buckets.items())
    ]


def _compute_consistency_score(monthly_breakdown: list[dict]) -> float | None:
    """Score de consistance 0-100 basé sur le % de mois rentables et la régularité."""
    if len(monthly_breakdown) < 2:
        return None

    pnls = [m["pnl"] for m in monthly_breakdown]
    profitable_months = sum(1 for p in pnls if p > 0)
    pct_profitable = profitable_months / len(pnls)

    mean_pnl = sum(pnls) / len(pnls)
    variance = sum((p - mean_pnl) ** 2 for p in pnls) / (len(pnls) - 1)
    std_pnl = math.sqrt(variance)

    # Coefficient de variation (inversé) : plus c'est régulier, plus le score est haut
    if mean_pnl > 0 and std_pnl > 0:
        cv = std_pnl / abs(mean_pnl)
        regularity = max(0, min(1, 1 - cv / 3))  # CV=0 → 1, CV>=3 → 0
    else:
        regularity = 0

    # Score composé : 60% mois rentables + 40% régularité
    score = (pct_profitable * 60) + (regularity * 40)
    return round(min(100, max(0, score)), 1)


def _compute_underwater(cumulative_values: list[float], initial_balance: float = 10_000.0) -> tuple[list[float], list[float]]:
    """Retourne (underwater_abs, underwater_pct) pour l'underwater chart.
    underwater_abs = drawdown en unité de prix (valeurs <= 0)
    underwater_pct = drawdown en % de l'equity au pic (valeurs <= 0)
    """
    underwater = []
    underwater_pct = []
    peak = 0.0
    for val in cumulative_values:
        if val > peak:
            peak = val
        dd = round(val - peak, 2)
        underwater.append(dd)
        peak_equity = initial_balance + peak
        if peak_equity > 0:
            underwater_pct.append(round(dd / peak_equity * 100, 2))
        else:
            underwater_pct.append(0.0)
    return underwater, underwater_pct


def _compute_distribution_stats(pnls: list[float]) -> dict:
    """Skewness, kurtosis et bins pour histogramme de la distribution des PnL."""
    n = len(pnls)
    if n < 3:
        return {"skewness": None, "kurtosis": None, "histogram": []}

    mean = sum(pnls) / n
    m2 = sum((p - mean) ** 2 for p in pnls) / n
    m3 = sum((p - mean) ** 3 for p in pnls) / n
    m4 = sum((p - mean) ** 4 for p in pnls) / n

    std = math.sqrt(m2) if m2 > 0 else 0
    skewness = (m3 / (std ** 3)) if std > 0 else None
    kurtosis = (m4 / (std ** 4) - 3) if std > 0 else None  # excess kurtosis

    # Histogramme : 20 bins
    min_p, max_p = min(pnls), max(pnls)
    if min_p == max_p:
        return {
            "skewness": round(skewness, 4) if skewness is not None else None,
            "kurtosis": round(kurtosis, 4) if kurtosis is not None else None,
            "histogram": [{"bin_start": min_p, "bin_end": max_p, "count": n}],
        }

    num_bins = min(20, max(5, n // 5))
    bin_width = (max_p - min_p) / num_bins
    bins = [0] * num_bins
    for p in pnls:
        idx = int((p - min_p) / bin_width)
        idx = min(idx, num_bins - 1)
        bins[idx] += 1

    histogram = [
        {
            "bin_start": round(min_p + i * bin_width, 2),
            "bin_end": round(min_p + (i + 1) * bin_width, 2),
            "count": c,
        }
        for i, c in enumerate(bins)
    ]

    return {
        "skewness": round(skewness, 4) if skewness is not None else None,
        "kurtosis": round(kurtosis, 4) if kurtosis is not None else None,
        "histogram": histogram,
    }


def _compute_ttest(pnls: list[float]) -> dict | None:
    """T-test unilatéral : l'espérance est-elle significativement > 0 ?"""
    n = len(pnls)
    if n < 5:
        return None

    mean = sum(pnls) / n
    variance = sum((p - mean) ** 2 for p in pnls) / (n - 1)
    std = math.sqrt(variance)
    if std == 0:
        return None

    t_stat = mean / (std / math.sqrt(n))

    # Approximation de la p-value via la distribution normale (n>=30 raisonnable,
    # pour n<30 c'est une approximation acceptable)
    z = abs(t_stat)
    # Approximation erfc via Abramowitz & Stegun
    p_value = 0.5 * math.erfc(z / math.sqrt(2))

    return {
        "t_statistic": round(t_stat, 4),
        "p_value": round(p_value, 6),
        "significant_5pct": p_value < 0.05,
        "significant_1pct": p_value < 0.01,
        "n": n,
    }


def _compute_monte_carlo(pnls: list[float], n_simulations: int = 1000) -> dict | None:
    """Bootstrap Monte Carlo : intervalle de confiance à 95% sur PnL final et max DD."""
    n = len(pnls)
    if n < 10:
        return None

    rng = random.Random(42)  # seed fixe pour reproductibilité
    final_pnls = []
    max_dds = []

    for _ in range(n_simulations):
        # Tirage avec remplacement
        sample = [pnls[rng.randint(0, n - 1)] for _ in range(n)]
        cumulative = 0.0
        peak = 0.0
        max_dd = 0.0
        for p in sample:
            cumulative += p
            if cumulative > peak:
                peak = cumulative
            dd = peak - cumulative
            if dd > max_dd:
                max_dd = dd
        final_pnls.append(cumulative)
        max_dds.append(max_dd)

    final_pnls.sort()
    max_dds.sort()

    idx_2_5 = int(n_simulations * 0.025)
    idx_97_5 = int(n_simulations * 0.975)
    idx_50 = int(n_simulations * 0.5)

    return {
        "pnl_median": round(final_pnls[idx_50], 2),
        "pnl_ci_lower": round(final_pnls[idx_2_5], 2),
        "pnl_ci_upper": round(final_pnls[idx_97_5], 2),
        "max_dd_median": round(max_dds[idx_50], 2),
        "max_dd_ci_lower": round(max_dds[idx_2_5], 2),
        "max_dd_ci_upper": round(max_dds[idx_97_5], 2),
        "pct_profitable": round(sum(1 for p in final_pnls if p > 0) / n_simulations * 100, 1),
        "n_simulations": n_simulations,
    }


def _compute_split_half(pnls: list[float]) -> dict | None:
    """Compare les métriques de la 1ère moitié vs la 2ème moitié pour détecter une dégradation."""
    n = len(pnls)
    if n < 10:
        return None

    mid = n // 2
    first_half = pnls[:mid]
    second_half = pnls[mid:]

    def _half_stats(half: list[float]) -> dict:
        total = sum(half)
        wins = [p for p in half if p > 0]
        losses = [p for p in half if p < 0]
        wr = len(wins) / len(half) if half else 0
        sw = sum(wins)
        sl = abs(sum(losses))
        pf = (sw / sl) if sl > 0 else None
        exp = total / len(half) if half else 0
        return {
            "pnl": round(total, 2),
            "win_rate": round(wr, 4),
            "profit_factor": round(pf, 4) if pf is not None else None,
            "expectancy": round(exp, 2),
            "trades": len(half),
        }

    f = _half_stats(first_half)
    s = _half_stats(second_half)

    # Dégradation = 2ème moitié significativement pire
    degradation_signals = 0
    if f["pnl"] > 0 and s["pnl"] < f["pnl"] * 0.5:
        degradation_signals += 1
    if f["win_rate"] > 0 and s["win_rate"] < f["win_rate"] * 0.85:
        degradation_signals += 1
    if f["expectancy"] > 0 and s["expectancy"] < f["expectancy"] * 0.5:
        degradation_signals += 1

    if degradation_signals >= 2:
        status = "degrading"
    elif s["pnl"] > f["pnl"] * 1.2:
        status = "improving"
    else:
        status = "stable"

    return {
        "first_half": f,
        "second_half": s,
        "status": status,
        "degradation_signals": degradation_signals,
    }


def compute_metrics(trades: list[dict], initial_balance: float = 10_000.0) -> dict:
    """Calcule toutes les métriques de performance depuis une liste de trades.

    Le max_drawdown est calculé sur la equity curve cumulée (cumsum du PnL),
    PAS trade par trade — c'est la méthode correcte.
    initial_balance : capital initial pour les calculs de DD%.
    """
    if not trades:
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "profit_factor": None,
            "max_drawdown": 0.0,
            "max_drawdown_pct": None,
            "max_drawdown_pct_true": None,
            "dd_peak_equity": 0.0,
            "dd_start_idx": 0,
            "dd_end_idx": 0,
            "expectancy": 0.0,
            "total_pnl": 0.0,
            "total_return_pct": None,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "best_trade": 0.0,
            "worst_trade": 0.0,
            "equity_curve": [],
            "sharpe_ratio": None,
            "sortino_ratio": None,
            "calmar_ratio": None,
            "recovery_factor": None,
            "risk_reward_ratio": None,
            "max_consecutive_wins": 0,
            "max_consecutive_losses": 0,
            "monthly_breakdown": [],
            "consistency_score": None,
            "underwater": [],
            "distribution": {"skewness": None, "kurtosis": None, "histogram": []},
            "ttest": None,
            "monte_carlo": None,
            "split_half": None,
            "dd_ib_aware": True,
        }

    # Tri chronologique par close_time
    sorted_trades = sorted(trades, key=lambda t: t["close_time"])

    pnls = [t["pnl"] for t in sorted_trades]
    total_trades = len(pnls)

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]

    win_rate = len(wins) / total_trades if total_trades > 0 else 0.0

    # Profit factor : somme gains / |somme pertes|
    sum_wins = sum(wins)
    sum_losses = abs(sum(losses))
    profit_factor = (sum_wins / sum_losses) if sum_losses > 0 else None

    avg_win = (sum_wins / len(wins)) if wins else 0.0
    avg_loss = (sum(losses) / len(losses)) if losses else 0.0

    # Expectancy = espérance mathématique par trade = PnL total / nombre de trades
    # Équivalent à : win_rate * avg_win + loss_rate * avg_loss (avg_loss est négatif)
    expectancy = sum(pnls) / total_trades if total_trades > 0 else 0.0

    total_pnl = sum(pnls)
    best_trade = max(pnls)
    worst_trade = min(pnls)

    # Equity curve cumulée
    cumulative = 0.0
    equity_points: list[dict] = []
    cumulative_values: list[float] = []
    for t in sorted_trades:
        cumulative += t["pnl"]
        cumulative_values.append(cumulative)
        close_time = t["close_time"]
        # Sérialiser la date en ISO si c'est un objet datetime
        if isinstance(close_time, datetime):
            close_time = close_time.isoformat()
        equity_points.append({
            "date": close_time,
            "cumulative_pnl": round(cumulative, 2),
        })

    # Max drawdown calculé sur la courbe cumulée (peak-to-trough)
    # Peak démarre à 0 (capital initial avant le premier trade)
    max_drawdown = 0.0
    peak = 0.0
    dd_peak = 0.0  # pic d'equity au moment du max drawdown
    dd_start_idx = 0  # indice du pic (début du drawdown)
    dd_end_idx = 0    # indice du creux (fin du drawdown)
    peak_idx = 0
    for i, val in enumerate(cumulative_values):
        if val > peak:
            peak = val
            peak_idx = i
        drawdown = peak - val
        if drawdown > max_drawdown:
            max_drawdown = drawdown
            dd_peak = peak
            dd_start_idx = peak_idx
            dd_end_idx = i

    # Max drawdown en % = drawdown / peak_equity (incluant initial_balance)
    peak_equity = initial_balance + dd_peak
    max_drawdown_pct = None
    if peak_equity > 0 and max_drawdown > 0:
        max_drawdown_pct = round(-(max_drawdown / peak_equity), 4)

    # True max DD% — may differ from max $ DD period
    max_drawdown_pct_true = None
    _peak_cum = 0.0
    _worst_pct = 0.0
    for val in cumulative_values:
        if val > _peak_cum:
            _peak_cum = val
        eq_peak = initial_balance + _peak_cum
        if eq_peak > 0:
            dd_pct = (_peak_cum - val) / eq_peak
            if dd_pct > _worst_pct:
                _worst_pct = dd_pct
    if _worst_pct > 0:
        max_drawdown_pct_true = round(-_worst_pct, 4)

    # ---- Nouvelles métriques Pro ----
    streaks = _compute_streaks(pnls)
    monthly_breakdown = _compute_monthly_breakdown(sorted_trades)
    consistency_score = _compute_consistency_score(monthly_breakdown)
    underwater, underwater_pct = _compute_underwater(cumulative_values, initial_balance)
    distribution = _compute_distribution_stats(pnls)
    ttest = _compute_ttest(pnls)
    monte_carlo = _compute_monte_carlo(pnls)
    split_half = _compute_split_half(pnls)

    # Calmar ratio : rendement annualisé / max drawdown
    calmar_ratio = None
    first_ct = sorted_trades[0]["close_time"]
    last_ct = sorted_trades[-1]["close_time"]
    delta = (last_ct - first_ct).total_seconds()
    if delta > 0 and max_drawdown > 0:
        years = delta / (365.25 * 24 * 3600)
        annualized_return = total_pnl / years if years > 0 else 0
        calmar_ratio = round(annualized_return / max_drawdown, 4)

    # Recovery factor : total PnL / max drawdown
    recovery_factor = None
    if max_drawdown > 0:
        recovery_factor = round(total_pnl / max_drawdown, 4)

    # Risk/Reward ratio : avg_win / |avg_loss|
    risk_reward_ratio = None
    if avg_loss < 0:
        risk_reward_ratio = round(avg_win / abs(avg_loss), 4)

    return {
        "total_trades": total_trades,
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4) if profit_factor is not None else None,
        "max_drawdown": round(max_drawdown, 2),
        "max_drawdown_pct": max_drawdown_pct,
        "max_drawdown_pct_true": max_drawdown_pct_true,
        "dd_peak_equity": round(dd_peak, 2),
        "dd_start_idx": dd_start_idx,
        "dd_end_idx": dd_end_idx,
        "expectancy": round(expectancy, 2),
        "total_pnl": round(total_pnl, 2),
        "total_return_pct": round(total_pnl / initial_balance, 4) if initial_balance > 0 else None,
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "best_trade": round(best_trade, 2),
        "worst_trade": round(worst_trade, 2),
        "equity_curve": equity_points,
        "sharpe_ratio": _compute_sharpe_annualized(sorted_trades),
        "sortino_ratio": _compute_sortino_annualized(sorted_trades),
        "calmar_ratio": calmar_ratio,
        "recovery_factor": recovery_factor,
        "risk_reward_ratio": risk_reward_ratio,
        "max_consecutive_wins": streaks["max_consecutive_wins"],
        "max_consecutive_losses": streaks["max_consecutive_losses"],
        "monthly_breakdown": monthly_breakdown,
        "consistency_score": consistency_score,
        "underwater": underwater,
        "underwater_pct": underwater_pct,
        "distribution": distribution,
        "ttest": ttest,
        "monte_carlo": monte_carlo,
        "split_half": split_half,
        "dd_ib_aware": True,
    }
