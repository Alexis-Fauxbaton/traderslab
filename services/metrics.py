"""Service de calcul des métriques de performance à partir d'une liste de trades."""

from datetime import datetime


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
            "expectancy": 0.0,
            "total_pnl": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "best_trade": 0.0,
            "worst_trade": 0.0,
            "equity_curve": [],
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

    loss_rate = 1.0 - win_rate
    expectancy = (win_rate * avg_win) - (loss_rate * abs(avg_loss))

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
    max_drawdown = 0.0
    peak = cumulative_values[0]
    for val in cumulative_values:
        if val > peak:
            peak = val
        drawdown = peak - val
        if drawdown > max_drawdown:
            max_drawdown = drawdown

    return {
        "total_trades": total_trades,
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4) if profit_factor is not None else None,
        "max_drawdown": round(max_drawdown, 2),
        "expectancy": round(expectancy, 2),
        "total_pnl": round(total_pnl, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "best_trade": round(best_trade, 2),
        "worst_trade": round(worst_trade, 2),
        "equity_curve": equity_points,
    }
