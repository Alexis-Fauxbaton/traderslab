import { Link } from 'react-router-dom';
import MiniChart from './MiniChart';
import { PnlSpan } from './UI';
import { formatDate, setCurrentAvgLoss, richTextPlain } from '../lib/utils';

/**
 * Carte partagée pour stratégie (Dashboard) et variante (StrategyDetail).
 *
 * Props:
 *  - to: lien de navigation
 *  - title: nom affiché
 *  - badge: élément affiché à droite du titre (StatusBadge, timeframe chips, etc.)
 *  - description: texte brut ou rich text (sera tronqué)
 *  - metrics: objet métriques agrégées (equity_curve, total_pnl, profit_factor, avg_win, avg_loss, total_trades)
 *  - footer: éléments supplémentaires en bas (pairs, date, trades, etc.)
 */
export default function MetricCard({ to, title, badge, description, metrics, footer }) {
  const m = metrics;
  const hasMet = m && m.total_trades > 0;
  if (hasMet) setCurrentAvgLoss(m.avg_loss);
  const rr = (hasMet && m.avg_win && m.avg_loss && m.avg_loss !== 0) ? Math.abs(m.avg_win / m.avg_loss) : null;
  const desc = typeof description === 'string' ? richTextPlain(description, 120) : description;

  return (
    <Link to={to} className="flex flex-col bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/50 transition group">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-white group-hover:text-blue-400 transition">{title}</h3>
        {badge}
      </div>
      {desc && <p className="text-xs text-slate-500 mb-2 truncate">{desc}</p>}
      <div className="flex-1" />
      {hasMet && (
        <>
          <div className="h-14 shrink-0 mb-3">
            <MiniChart data={m.equity_curve} height={56} />
          </div>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mb-2">
            <span>PnL <PnlSpan value={m.total_pnl} /></span>
            <span>PF <span className="text-white">{m.profit_factor != null ? m.profit_factor.toFixed(2) : '—'}</span></span>
            <span>RR <span className="text-white">{rr != null ? rr.toFixed(2) : '—'}</span></span>
          </div>
        </>
      )}
      <div className="flex items-center gap-3 text-xs text-slate-500">
        {footer}
        {hasMet && <span>{m.total_trades} trades</span>}
      </div>
    </Link>
  );
}
