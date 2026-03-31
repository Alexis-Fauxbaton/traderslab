import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import API from '../lib/api';
import { formatDate, timeAgo, formatPercent, formatPnlRaw, setCurrentAvgLoss, STATUS_LABELS, richTextPlain } from '../lib/utils';
import { Spinner, PnlSpan } from '../components/UI';
import MiniChart from '../components/MiniChart';

function WidgetCard({ title, icon, children }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <span>{icon}</span>{title}
      </h3>
      {children}
    </div>
  );
}

function RowLink({ href, primary, secondary, badge }) {
  return (
    <Link to={href} className="flex items-center justify-between py-1.5 hover:bg-slate-700/40 -mx-2 px-2 rounded transition group">
      <div className="min-w-0 flex-1">
        <p className="truncate text-slate-200 text-xs group-hover:text-blue-400 transition">{primary}</p>
        {secondary && <p className="text-slate-500 text-xs truncate">{secondary}</p>}
      </div>
      {badge && <span className="ml-2 shrink-0 text-slate-500 text-xs">{badge}</span>}
    </Link>
  );
}

function ResumeBanner() {
  const [lastVisit, setLastVisit] = useState(null);

  useEffect(() => {
    try {
      const lv = JSON.parse(localStorage.getItem('lastVisit'));
      if (lv?.hash) setLastVisit(lv);
    } catch {}
  }, []);

  if (!lastVisit) return null;
  const ago = timeAgo(lastVisit.ts);
  const crumbs = lastVisit.crumbs;

  let pathHtml;
  if (crumbs?.length > 0) {
    pathHtml = crumbs.map((c, i) => {
      const isLast = i === crumbs.length - 1;
      return (
        <span key={i}>
          {isLast
            ? <strong className="text-blue-200">{c.label}</strong>
            : <><span className="text-blue-300/70">{c.label}</span><span className="text-blue-500/50 mx-1">›</span></>
          }
        </span>
      );
    });
  } else {
    let label = lastVisit.hash;
    if (lastVisit.hash.match(/^\/strategy\//)) label = 'Stratégie';
    else if (lastVisit.hash.match(/^\/variant\//)) label = 'Variante';
    else if (lastVisit.hash.match(/^\/run\//)) label = 'Run';
    else if (lastVisit.hash === '/compare') label = 'Comparaison';
    pathHtml = <strong className="text-blue-200">{label}</strong>;
  }

  return (
    <div className="mb-5">
      <a href={'#' + lastVisit.hash} className="inline-flex items-center gap-2 bg-blue-600/15 border border-blue-500/30 hover:bg-blue-600/25 transition text-blue-300 px-4 py-2.5 rounded-lg text-sm">
        <span>↩</span>
        <span>Reprendre — {pathHtml}</span>
        <span className="text-blue-400/50 text-xs">({ago})</span>
      </a>
    </div>
  );
}

export default function Dashboard({ onNewStrategy }) {
  const [strategies, setStrategies] = useState(null);
  const [activity, setActivity] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener('unitchange', handler);
    return () => window.removeEventListener('unitchange', handler);
  }, []);

  useEffect(() => {
    Promise.all([
      API.get('/strategies/dashboard'),
      API.get('/strategies/dashboard/activity'),
    ]).then(([s, a]) => {
      setStrategies(s); setActivity(a);
    });
  }, []);

  if (!strategies || !activity) return <Spinner />;

  const hasActivity = (activity.recent_variants?.length > 0) ||
    (activity.recent_runs?.length > 0) ||
    (activity.to_review?.length > 0) ||
    activity.best_variant;

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Mes Stratégies</h1>
        <button onClick={onNewStrategy} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">+ Nouvelle Stratégie</button>
      </div>

      <ResumeBanner />

      {hasActivity && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
          <WidgetCard title="Variantes récentes" icon="🧪">
            {!activity.recent_variants?.length ? <p className="text-slate-500 text-xs italic">Aucune variante</p> :
              activity.recent_variants.map(v => (
                <RowLink key={v.id} href={'/variant/' + v.id} primary={v.name} secondary={v.strategy_name} badge={timeAgo(v.created_at)} />
              ))
            }
          </WidgetCard>
          <WidgetCard title="Derniers imports" icon="📥">
            {!activity.recent_runs?.length ? <p className="text-slate-500 text-xs italic">Aucun import</p> :
              activity.recent_runs.map(r => (
                <RowLink key={r.id} href={'/run/' + r.id} primary={r.label || r.type} secondary={r.variant_name} badge={timeAgo(r.imported_at)} />
              ))
            }
          </WidgetCard>
          <WidgetCard title="À revoir" icon="🔍">
            {!activity.to_review?.length ? <p className="text-slate-500 text-xs text-green-400/70">Tout est à jour ✓</p> :
              activity.to_review.map(v => {
                const badgeClass = (v.status === 'testing' || v.status === 'ready_to_test') ? 'text-yellow-400' : v.status === 'idea' ? 'text-purple-400' : 'text-blue-400';
                return <RowLink key={v.id} href={'/variant/' + v.id} primary={v.name} secondary={v.strategy_name} badge={<span className={badgeClass}>{STATUS_LABELS[v.status] || v.status}</span>} />;
              })
            }
          </WidgetCard>
          <WidgetCard title="Performances" icon="🏆">
            {(!activity.best_variant && !activity.worst_variant) ? <p className="text-slate-500 text-xs italic">Pas encore de données</p> : (
              <>
                {activity.best_variant && (
                  <div className="mb-3">
                    <p className="text-xs text-slate-500 mb-1">🏆 Meilleure variante</p>
                    <Link to={'/variant/' + activity.best_variant.id} className="group block">
                      <p className="text-slate-200 text-xs group-hover:text-blue-400 transition truncate">{activity.best_variant.name}</p>
                      <p className="text-xs text-slate-500 truncate">{activity.best_variant.strategy_name}</p>
                      <p className={`text-sm font-semibold mt-0.5 ${activity.best_variant.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {activity.best_variant.total_pnl >= 0 ? '+' : ''}{activity.best_variant.total_pnl.toFixed(2)}
                      </p>
                    </Link>
                  </div>
                )}
                {activity.worst_variant && (!activity.best_variant || activity.worst_variant.id !== activity.best_variant.id) && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">↓ Pire variante</p>
                    <Link to={'/variant/' + activity.worst_variant.id} className="group block">
                      <p className="text-slate-200 text-xs group-hover:text-blue-400 transition truncate">{activity.worst_variant.name}</p>
                      <p className="text-xs text-slate-500 truncate">{activity.worst_variant.strategy_name}</p>
                      <p className={`text-sm font-semibold mt-0.5 ${activity.worst_variant.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {activity.worst_variant.total_pnl >= 0 ? '+' : ''}{activity.worst_variant.total_pnl.toFixed(2)}
                      </p>
                    </Link>
                  </div>
                )}
              </>
            )}
          </WidgetCard>
        </div>
      )}

      {strategies.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg mb-4">Aucune stratégie créée</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {strategies.map(s => {
            const m = s.aggregate_metrics;
            const hasMet = m && m.total_trades > 0;
            if (hasMet) setCurrentAvgLoss(m.avg_loss);
            const rr = (hasMet && m.avg_win && m.avg_loss && m.avg_loss !== 0) ? Math.abs(m.avg_win / m.avg_loss) : null;
            const desc = richTextPlain(s.description, 120);
            const pnl = hasMet ? formatPnlRaw(m.total_pnl) : null;

            return (
              <Link key={s.id} to={'/strategy/' + s.id} className="block bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/50 transition group">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-white group-hover:text-blue-400 transition">{s.name}</h3>
                  <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{s.timeframe}</span>
                </div>
                <p className="text-xs text-slate-400 mb-2">{desc || <span className="italic">Pas de description</span>}</p>
                {hasMet && (
                  <>
                    <MiniChart data={m.equity_curve} height={60} />
                    <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mb-2">
                      <span>PnL <PnlSpan value={m.total_pnl} /></span>
                      <span>Profit Factor <span className="text-white">{m.profit_factor != null ? m.profit_factor.toFixed(2) : '—'}</span></span>
                      <span>RR Moyen <span className="text-white">{rr != null ? rr.toFixed(2) : '—'}</span></span>
                    </div>
                  </>
                )}
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>📈 {s.market}</span>
                  <span>📅 {formatDate(s.created_at)}</span>
                  {hasMet && <span>{m.total_trades} trades</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
