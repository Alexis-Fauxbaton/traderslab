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
        </div>
      </div>
      <p className="text-sm text-slate-300 mb-3">{result.summary}</p>

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
              const label = { pnl: 'PnL', maxDrawdown: 'Drawdown', expectancy: 'Expectancy', winRate: 'Win Rate', profitFactor: 'PF', sharpeRatio: 'Sharpe', consistencyScore: 'Consist.', recoveryFactor: 'Recovery', riskRewardRatio: 'R/R' }[d.metric] || d.metric;
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
