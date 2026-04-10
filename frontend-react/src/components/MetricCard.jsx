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
const VERDICT_STYLES = {
  solide:      'bg-green-900/40 text-green-400 border-green-700/50',
  prometteuse: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
  a_confirmer: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  fragile:     'bg-red-900/40 text-red-400 border-red-700/50',
};

export default function MetricCard({ to, title, badge, description, metrics, pairs, timeframes, verdict, footer }) {
  const m = metrics;
  const hasMet = m && m.total_trades > 0;
  if (hasMet) setCurrentAvgLoss(m.avg_loss);
  const rr = (hasMet && m.avg_win && m.avg_loss && m.avg_loss !== 0) ? Math.abs(m.avg_win / m.avg_loss) : null;
  const desc = typeof description === 'string' ? richTextPlain(description, 120) : description;
  const hasTags = (pairs && pairs.length > 0) || (timeframes && timeframes.length > 0);

  return (
    <Link to={to} className="flex flex-col bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/50 transition group">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-white group-hover:text-blue-400 transition">{title}</h3>
        {badge}
      </div>
      {desc && <p className="text-xs text-slate-500 mb-2 truncate">{desc}</p>}
      {hasTags && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pairs && pairs.map(p => <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{p}</span>)}
          {timeframes && timeframes.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400">{t}</span>)}
        </div>
      )}
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
        {verdict && (
          <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full border ${VERDICT_STYLES[verdict.verdict] || 'bg-slate-700 text-slate-300 border-slate-600'}`}>
            {verdict.verdict_label}
          </span>
        )}
      </div>
    </Link>
  );
}
