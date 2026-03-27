"""Service de calcul des métriques de performance à partir d'une liste de trades."""

import math
from datetime import datetime


def _compute_sharpe_annualized(
    sorted_trades: list[dict],
    risk_free_rate: float = 0.0,
) -> float | None:
    """Calcule le Sharpe ratio annualisé par trade.

    Méthode :
      1. Extraire les PnL de chaque trade (trades à PnL = 0 ignorés).
      2. Calculer mean et std (ddof=1) sur cette liste.
      3. Estimer trades_per_year = n / years, où years est la durée entre
         le close_time du premier et du dernier trade.
      4. sharpe = (mean / std) * sqrt(trades_per_year)

    Retourne None si std == 0, moins de 2 trades non-nuls, ou durée nulle.
    """
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


def compute_metrics(trades: list[dict]) -> dict:
    """Calcule toutes les métriques de performance depuis une liste de trades.

    Le max_drawdown est calculé sur la equity curve cumulée (cumsum du PnL),
    PAS trade par trade — c'est la méthode correcte.
    """
    if not trades:
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "profit_factor": None,
            "max_drawdown": 0.0,
            "dd_peak_equity": 0.0,
            "dd_start_idx": 0,
            "dd_end_idx": 0,
            "expectancy": 0.0,
            "total_pnl": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "best_trade": 0.0,
            "worst_trade": 0.0,
            "equity_curve": [],
            "sharpe_ratio": None,
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

    return {
        "total_trades": total_trades,
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4) if profit_factor is not None else None,
        "max_drawdown": round(max_drawdown, 2),
        "dd_peak_equity": round(dd_peak, 2),
        "dd_start_idx": dd_start_idx,
        "dd_end_idx": dd_end_idx,
        "expectancy": round(expectancy, 2),
        "total_pnl": round(total_pnl, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "best_trade": round(best_trade, 2),
        "worst_trade": round(worst_trade, 2),
        "equity_curve": equity_points,
        "sharpe_ratio": _compute_sharpe_annualized(sorted_trades),
    }
