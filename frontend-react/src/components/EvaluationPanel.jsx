import { Evaluation } from '../evaluation';

const VERDICT_STYLES = {
  promising:    { badge: 'bg-green-900/30 text-green-400 border border-green-700',  dot: 'bg-green-400' },
  fragile:      { badge: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700', dot: 'bg-yellow-400' },
  inconclusive: { badge: 'bg-slate-700/60 text-slate-400 border border-slate-600',  dot: 'bg-slate-400' },
  invalid:      { badge: 'bg-red-900/30 text-red-400 border border-red-700',        dot: 'bg-red-400' },
};
const COMP_VERDICT_STYLES = {
  promote_a:    { badge: 'bg-green-900/30 text-green-400 border border-green-700',   dot: 'bg-green-400' },
  promote_b:    { badge: 'bg-green-900/30 text-green-400 border border-green-700',   dot: 'bg-green-400' },
  keep_testing: { badge: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700', dot: 'bg-yellow-400' },
  inconclusive: { badge: 'bg-slate-700/60 text-slate-400 border border-slate-600',   dot: 'bg-slate-400' },
};
const WARN_COLORS = {
  high:   'border-red-800 bg-red-900/20 text-red-300',
  medium: 'border-yellow-800 bg-yellow-900/20 text-yellow-300',
  low:    'border-slate-600 bg-slate-700/30 text-slate-300',
};
const CONF_COLORS = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-red-400' };

function robustnessColor(score) {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

function RobustnessCircle({ robustness }) {
  if (!robustness) return null;
  const { total, consistencyPart, recoveryPart, riskRewardPart, sampleSizePart, significancePart } = robustness;
  const color = robustnessColor(total);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (total / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: 88, height: 88 }}>
        <svg width="88" height="88" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r={radius} fill="none" stroke="#1e293b" strokeWidth="6" />
          <circle cx="44" cy="44" r={radius} fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset}
            transform="rotate(-90 44 44)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold" style={{ color }}>{total}</span>
          <span className="text-[10px] text-slate-500">/ 100</span>
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-4"><span className="text-slate-400">Consistance</span><span className="text-slate-300">{consistencyPart}/30</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-400">Significativité</span><span className="text-slate-300">{significancePart}/20</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-400">Recovery</span><span className="text-slate-300">{recoveryPart}/20</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-400">Risk/Reward</span><span className="text-slate-300">{riskRewardPart}/15</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-400">Échantillon</span><span className="text-slate-300">{sampleSizePart}/15</span></div>
      </div>
    </div>
  );
}

function SignificanceBadge({ significance }) {
  if (!significance) return null;
  let label, className;
  if (significance.significant_1pct) {
    label = 'Edge réel (p < 1%)';
    className = 'bg-green-900/30 text-green-400 border-green-700';
  } else if (significance.significant_5pct) {
    label = 'Edge probable (p < 5%)';
    className = 'bg-emerald-900/30 text-emerald-400 border-emerald-700';
  } else if (significance.p_value < 0.1) {
    label = 'Signal faible (p < 10%)';
    className = 'bg-yellow-900/30 text-yellow-400 border-yellow-700';
  } else {
    label = 'Non significatif';
    className = 'bg-red-900/20 text-red-400 border-red-700';
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${className}`}>
      {label}
    </span>
  );
}

function MonteCarloCard({ mc }) {
  if (!mc) return null;
  return (
    <div className="border border-slate-700 rounded-lg p-3">
      <div className="text-xs font-medium text-slate-400 mb-2">Monte Carlo ({mc.n_simulations} sim.)</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-slate-500">PnL médian</span>
          <div className="text-slate-200 font-medium">{mc.pnl_median?.toFixed(0)}</div>
        </div>
        <div>
          <span className="text-slate-500">IC 95% PnL</span>
          <div className="text-slate-200 font-medium">{mc.pnl_ci_lower?.toFixed(0)} → {mc.pnl_ci_upper?.toFixed(0)}</div>
        </div>
        <div>
          <span className="text-slate-500">Max DD médian</span>
          <div className="text-slate-200 font-medium">{mc.max_dd_median?.toFixed(0)}</div>
        </div>
        <div>
          <span className="text-slate-500">% rentable</span>
          <div className={`font-medium ${mc.pct_profitable >= 60 ? 'text-green-400' : mc.pct_profitable >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
            {mc.pct_profitable}%
          </div>
        </div>
      </div>
    </div>
  );
}

function DegradationCard({ degradation }) {
  if (!degradation) return null;
  const statusLabels = { degrading: 'Dégradation', improving: 'Amélioration', stable: 'Stable' };
  const statusColors = { degrading: 'text-red-400', improving: 'text-green-400', stable: 'text-slate-300' };
  const statusIcons = { degrading: '⚠️', improving: '📈', stable: '➡️' };
  const h1 = degradation.first_half;
  const h2 = degradation.second_half;

  return (
    <div className="border border-slate-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-400">Analyse split-half</span>
        <span className={`text-xs font-medium ${statusColors[degradation.status]}`}>
          {statusIcons[degradation.status]} {statusLabels[degradation.status]}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="border border-slate-700/50 rounded p-2">
          <div className="text-slate-500 mb-1">1ère moitié ({h1.trades} trades)</div>
          <div>PnL: <span className={h1.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{h1.pnl.toFixed(0)}</span></div>
          <div>WR: {(h1.win_rate * 100).toFixed(0)}%</div>
          <div>Exp: {h1.expectancy.toFixed(1)}</div>
        </div>
        <div className="border border-slate-700/50 rounded p-2">
          <div className="text-slate-500 mb-1">2ème moitié ({h2.trades} trades)</div>
          <div>PnL: <span className={h2.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{h2.pnl.toFixed(0)}</span></div>
          <div>WR: {(h2.win_rate * 100).toFixed(0)}%</div>
          <div>Exp: {h2.expectancy.toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}

export function EvaluationPanel({ result, title = 'Évaluation' }) {
  if (!result || !Evaluation) return null;
  const vc = VERDICT_STYLES[result.verdict] || VERDICT_STYLES.inconclusive;
  const cc = CONF_COLORS[result.confidence] || 'text-slate-400';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">{title}</h2>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${vc.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${vc.dot}`}></span>
            {Evaluation.verdictLabel(result.verdict)}
          </span>
          <span className={`text-xs ${cc}`}>Confiance&nbsp;: {Evaluation.confidenceLabel(result.confidence)}</span>
          <SignificanceBadge significance={result.significance} />
        </div>
      </div>
      <p className="text-sm text-slate-300 mb-3">{result.summary}</p>

      {/* Robustness score + Monte Carlo row */}
      {(result.robustness || result.monteCarlo) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {result.robustness && (
            <div className="border border-slate-700 rounded-lg p-3">
              <div className="text-xs font-medium text-slate-400 mb-2">Score de robustesse</div>
              <RobustnessCircle robustness={result.robustness} />
            </div>
          )}
          <MonteCarloCard mc={result.monteCarlo} />
        </div>
      )}

      {/* Degradation */}
      {result.degradation && (
        <div className="mb-3">
          <DegradationCard degradation={result.degradation} />
        </div>
      )}

      {result.reasons?.length > 0 && (
        <div className="text-xs text-slate-500 mb-3">
          {result.reasons.map((r, i) => <div key={i}>→ {r}</div>)}
        </div>
      )}

      {(result.strengths?.length > 0 || result.weaknesses?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {result.strengths?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-green-400 mb-1">✓ Points forts</div>
              <ul className="space-y-0.5">
                {result.strengths.map((s, i) => <li key={i} className="text-xs text-slate-300">• {s}</li>)}
              </ul>
            </div>
          )}
          {result.weaknesses?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-red-400 mb-1">✗ Points faibles</div>
              <ul className="space-y-0.5">
                {result.weaknesses.map((s, i) => <li key={i} className="text-xs text-slate-300">• {s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {result.warnings?.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {result.warnings.map((w, i) => (
            <div key={i} className={`border rounded-lg px-3 py-2 text-xs ${WARN_COLORS[w.severity] || WARN_COLORS.low}`}>
              <span className="font-medium">{w.title}</span> — {w.message}
            </div>
          ))}
        </div>
      )}

      {result.nextSteps?.length > 0 && (
        <div className="border-t border-slate-700 mt-3 pt-3">
          <div className="text-xs font-medium text-slate-400 mb-1.5">Prochaines étapes</div>
          <ul className="space-y-0.5">
            {result.nextSteps.map((s, i) => <li key={i} className="text-xs text-slate-300">→ {s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ComparisonEvaluationPanel({ result, nameA, nameB }) {
  if (!result || !Evaluation) return null;
  const vc = COMP_VERDICT_STYLES[result.verdict] || COMP_VERDICT_STYLES.inconclusive;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Évaluation comparative</h2>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${vc.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${vc.dot}`}></span>
          {Evaluation.comparisonVerdictLabel(result.verdict)}
        </span>
      </div>
      <p className="text-sm text-slate-300 mb-3">{result.summary}</p>

      {result.score && result.score.total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="text-blue-400">{nameA} — {result.score.scoreA} pts</span>
            <span className="text-slate-500">/ {result.score.total} pts</span>
            <span className="text-amber-400">{result.score.scoreB} pts — {nameB}</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-slate-700">
            {Math.round(result.score.scoreA / result.score.total * 100) > 0 && (
              <div className="bg-blue-500 transition-all" style={{ width: Math.round(result.score.scoreA / result.score.total * 100) + '%' }}></div>
            )}
            {Math.round(result.score.scoreB / result.score.total * 100) > 0 && (
              <div className="bg-amber-500 ml-auto transition-all" style={{ width: Math.round(result.score.scoreB / result.score.total * 100) + '%' }}></div>
            )}
          </div>
          {/* Score detail breakdown */}
          <div className="mt-2 space-y-0.5">
            {result.score.details?.filter(d => d.winner !== 'n/a').map((d, i) => {
              const label = { pnl: 'PnL', maxDrawdown: 'Drawdown', expectancy: 'Expectancy', winRate: 'Win Rate', profitFactor: 'PF', sharpeRatio: 'Sharpe', sortinoRatio: 'Sortino', consistencyScore: 'Consist.', recoveryFactor: 'Recovery', riskRewardRatio: 'R/R' }[d.metric] || d.metric;
              return (
                <div key={i} className="flex items-center text-[11px] gap-2">
                  <span className="w-16 text-slate-500 text-right">{label}</span>
                  <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-slate-700">
                    {d.gainA > 0 && <div className="bg-blue-500" style={{ width: Math.round(d.gainA / d.weight * 100) + '%' }}></div>}
                    {d.gainB > 0 && <div className="bg-amber-500 ml-auto" style={{ width: Math.round(d.gainB / d.weight * 100) + '%' }}></div>}
                  </div>
                  <span className="w-8 text-slate-600 text-[10px]">{d.weight}pt</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Significance test for comparison */}
      {result.significanceTest && (
        <div className="mb-3 border border-slate-700 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Test de significativité (Welch t-test)</span>
            <SignificanceBadge significance={result.significanceTest} />
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            t = {result.significanceTest.t_statistic?.toFixed(3)}, p = {result.significanceTest.p_value?.toFixed(4)}
            {result.significanceTest.significant_5pct
              ? ' — la différence entre les variantes est statistiquement significative'
              : ' — pas de différence significative entre les variantes'}
          </div>
        </div>
      )}

      {result.reasons?.length > 0 && (
        <div className="text-xs text-slate-500 mb-3">
          {result.reasons.map((r, i) => <div key={i}>→ {r}</div>)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="border border-slate-700/60 rounded-lg p-3">
          <div className="text-xs font-medium text-blue-400 mb-2">{nameA}</div>
          {(result.strengthsA || []).map((s, i) => <div key={i} className="text-xs text-green-400">✓ {s}</div>)}
          {(result.weaknessesA || []).map((s, i) => <div key={i} className="text-xs text-red-400">✗ {s}</div>)}
          {!(result.strengthsA || []).length && !(result.weaknessesA || []).length && <div className="text-xs text-slate-600">—</div>}
        </div>
        <div className="border border-slate-700/60 rounded-lg p-3">
          <div className="text-xs font-medium text-amber-400 mb-2">{nameB}</div>
          {(result.strengthsB || []).map((s, i) => <div key={i} className="text-xs text-green-400">✓ {s}</div>)}
          {(result.weaknessesB || []).map((s, i) => <div key={i} className="text-xs text-red-400">✗ {s}</div>)}
          {!(result.strengthsB || []).length && !(result.weaknessesB || []).length && <div className="text-xs text-slate-600">—</div>}
        </div>
      </div>

      {result.warnings?.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {result.warnings.map((w, i) => (
            <div key={i} className={`border rounded-lg px-3 py-2 text-xs ${WARN_COLORS[w.severity] || WARN_COLORS.low}`}>
              <span className="font-medium">[{w.target?.toUpperCase()}] {w.title}</span> — {w.message}
            </div>
          ))}
        </div>
      )}

      {result.nextSteps?.length > 0 && (
        <div className="border-t border-slate-700 mt-3 pt-3">
          <div className="text-xs font-medium text-slate-400 mb-1.5">Prochaines étapes</div>
          <ul className="space-y-0.5">
            {result.nextSteps.map((s, i) => <li key={i} className="text-xs text-slate-300">→ {s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
