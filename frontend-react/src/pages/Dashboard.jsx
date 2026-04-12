import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import API from '../lib/api';
import { formatDate, timeAgo, formatPercent, formatPnlRaw, setCurrentAvgLoss, STATUS_LABELS, richTextPlain, getCurrencySymbol } from '../lib/utils';
import { Spinner, PnlSpan } from '../components/UI';
import MiniChart from '../components/MiniChart';
import MetricCard from '../components/MetricCard';
import Onboarding from '../components/Onboarding';

function WidgetCard({ title, icon, accent, children }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3 flex items-center gap-2" style={{ color: accent || '#94a3b8' }}>
        {icon}{title}
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

function ResumeBanner({ strategyIds }) {
  const [lastVisit, setLastVisit] = useState(null);

  useEffect(() => {
    try {
      const lv = JSON.parse(localStorage.getItem('lastVisit'));
      if (!lv?.hash) return;
      // Validate the lastVisit references a resource owned by the current user
      const m = lv.hash.match(/^\/(strategy|variant|run)\/([^/]+)/);
      if (m && strategyIds) {
        // For strategy pages, check directly; for variant/run, try to validate via API
        if (m[1] === 'strategy' && !strategyIds.has(m[2])) {
          localStorage.removeItem('lastVisit');
          return;
        }
        // For variant/run: validate ownership via a quick fetch
        if (m[1] === 'variant' || m[1] === 'run') {
          API.get(`/${m[1]}s/${m[2]}`).then(() => setLastVisit(lv)).catch(() => {
            localStorage.removeItem('lastVisit');
          });
          return;
        }
      }
      setLastVisit(lv);
    } catch {}
  }, [strategyIds]);

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
    else if (lastVisit.hash.match(/^\/variant\//)) label = 'Version';
    else if (lastVisit.hash.match(/^\/run\//)) label = 'Test';
    else if (lastVisit.hash === '/compare') label = 'Comparaison';
    pathHtml = <strong className="text-blue-200">{label}</strong>;
  }

  return (
    <div className="mb-5">
      <a href={'#' + lastVisit.hash} className="inline-flex items-center gap-2 bg-blue-600/15 border border-blue-500/30 hover:bg-blue-600/25 transition text-blue-300 px-4 py-2.5 rounded-lg text-sm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
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
      // Apply sidebar order (drag-and-drop) from localStorage
      try {
        const order = JSON.parse(localStorage.getItem('strategyOrder')) || [];
        if (order.length) {
          s.sort((a, b) => {
            let ia = order.indexOf(a.id), ib = order.indexOf(b.id);
            if (ia === -1) ia = 9999;
            if (ib === -1) ib = 9999;
            return ia - ib;
          });
        }
      } catch {}
      setStrategies(s); setActivity(a);
    });
  }, []);

  if (!strategies || !activity) return <Spinner />;

  const strategyIds = new Set(strategies.map(s => s.id));
  const hasActivity = (activity.recent_variants?.length > 0) ||
    (activity.recent_runs?.length > 0) ||
    (activity.to_review?.length > 0) ||
    activity.best_variant;

  return (
    <div className="fade-in">
      <Onboarding flow="dashboard" />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Mes Stratégies</h1>
        <button data-onboarding="new-strategy" onClick={onNewStrategy} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">+ Nouvelle Stratégie</button>
      </div>

      <ResumeBanner strategyIds={strategyIds} />

      {hasActivity && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
          <WidgetCard title="Versions récentes" accent="#a78bfa" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6l-1 7h4L10 21l1-8H7L9 3z"/></svg>}>
            {!activity.recent_variants?.length ? <p className="text-slate-500 text-xs italic">Aucune version</p> :
              activity.recent_variants.map(v => (
                <RowLink key={v.id} href={'/variant/' + v.id} primary={v.name} secondary={v.strategy_name} badge={timeAgo(v.created_at)} />
              ))
            }
          </WidgetCard>
          <WidgetCard title="Derniers tests" accent="#f87171" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}>
            {!activity.recent_runs?.length ? <p className="text-slate-500 text-xs italic">Aucun test</p> :
              activity.recent_runs.map(r => (
                <RowLink key={r.id} href={'/run/' + r.id} primary={r.label || r.type} secondary={r.variant_name} badge={timeAgo(r.imported_at)} />
              ))
            }
          </WidgetCard>
          <WidgetCard title="À revoir" accent="#fbbf24" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}>
            {!activity.to_review?.length ? <p className="text-slate-500 text-xs text-green-400/70">Tout est à jour ✓</p> :
              activity.to_review.map(v => {
                const badgeClass = (v.status === 'testing' || v.status === 'ready_to_test') ? 'text-yellow-400' : v.status === 'idea' ? 'text-purple-400' : 'text-blue-400';
                return <RowLink key={v.id} href={'/variant/' + v.id} primary={v.name} secondary={v.strategy_name} badge={<span className={badgeClass}>{STATUS_LABELS[v.status] || v.status}</span>} />;
              })
            }
          </WidgetCard>
          <WidgetCard title="Performances" accent="#34d399" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}>
            {(!activity.best_variant && !activity.worst_variant) ? <p className="text-slate-500 text-xs italic">Pas encore de données</p> : (
              <>
                {activity.best_variant && (
                  <div className="mb-3">
                    <p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Meilleure version</p>
                    <Link to={'/variant/' + activity.best_variant.id} className="group block">
                      <p className="text-slate-200 text-xs group-hover:text-blue-400 transition truncate">{activity.best_variant.name}</p>
                      <p className="text-xs text-slate-500 truncate">{activity.best_variant.strategy_name}</p>
                      <p className={`text-sm font-semibold mt-0.5 ${activity.best_variant.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {activity.best_variant.total_pnl >= 0 ? '+' : ''}{getCurrencySymbol()}{activity.best_variant.total_pnl.toFixed(2)}
                      </p>
                    </Link>
                  </div>
                )}
                {activity.worst_variant && (!activity.best_variant || activity.worst_variant.id !== activity.best_variant.id) && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Pire version</p>
                    <Link to={'/variant/' + activity.worst_variant.id} className="group block">
                      <p className="text-slate-200 text-xs group-hover:text-blue-400 transition truncate">{activity.worst_variant.name}</p>
                      <p className="text-xs text-slate-500 truncate">{activity.worst_variant.strategy_name}</p>
                      <p className={`text-sm font-semibold mt-0.5 ${activity.worst_variant.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {activity.worst_variant.total_pnl >= 0 ? '+' : ''}{getCurrencySymbol()}{activity.worst_variant.total_pnl.toFixed(2)}
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 [&>a]:h-full">
          {strategies.map(s => (
            <MetricCard
              key={s.id}
              to={'/strategy/' + s.id}
              title={s.name}
              badge={
                <div className="flex gap-1 flex-wrap justify-end">
                  {(s.timeframes || []).map(tf => (
                    <span key={tf} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{tf}</span>
                  ))}
                </div>
              }
              description={s.description}
              metrics={s.aggregate_metrics}
              footer={
                <>
                  <span className="flex items-center gap-1"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> {(s.pairs || []).length === 0 ? '—' : (s.pairs.slice(0, 3).join(', ') + (s.pairs.length > 3 ? ` +${s.pairs.length - 3}` : ''))}</span>
                  <span className="flex items-center gap-1"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> {formatDate(s.created_at)}</span>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
