/**
 * EvaluationPanel V1 — wired to backend /analysis/* endpoints.
 */

const VERDICT_STYLES = {
  solide:       { badge: 'bg-green-500/10 text-green-400 ring-1 ring-green-500/30',    dot: 'bg-green-400', glow: 'shadow-[0_0_12px_rgba(74,222,128,0.15)]' },
  prometteuse:  { badge: 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30',       dot: 'bg-blue-400',  glow: 'shadow-[0_0_12px_rgba(96,165,250,0.15)]' },
  a_confirmer:  { badge: 'bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/30', dot: 'bg-yellow-400', glow: 'shadow-[0_0_12px_rgba(250,204,21,0.15)]' },
  fragile:      { badge: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/30',          dot: 'bg-red-400',   glow: 'shadow-[0_0_12px_rgba(248,113,113,0.15)]' },
};

const FAMILY_STYLES = {
  risque:     'border-red-500/20 bg-red-500/5 text-red-300',
  fiabilite:  'border-yellow-500/20 bg-yellow-500/5 text-yellow-300',
  qualite:    'border-slate-500/20 bg-slate-500/5 text-slate-300',
};

const CONFIDENCE_COLORS = {
  eleve:  'text-green-400',
  bon:    'text-blue-400',
  moyen:  'text-yellow-400',
  faible: 'text-red-400',
};

const BADGE_STYLES = {
  plus_rentable:      'bg-green-500/10 text-green-400 ring-green-500/30',
  plus_stable:        'bg-blue-500/10 text-blue-400 ring-blue-500/30',
  meilleur_compromis: 'bg-purple-500/10 text-purple-400 ring-purple-500/30',
};

export function EvaluationPanel({ result, title = 'Évaluation' }) {
  if (!result) return null;
  const vc = VERDICT_STYLES[result.verdict] || VERDICT_STYLES.a_confirmer;
  const cc = CONFIDENCE_COLORS[result.confidence] || 'text-slate-400';

  return (
    <div className={`bg-gradient-to-br from-slate-800 to-slate-800/80 border border-slate-700/60 rounded-xl p-6 mb-6 ${vc.glow}`}>
      {/* Header: titre + verdict + confiance */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          {title}
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/50 uppercase tracking-wider">Beta</span>
        </h2>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${vc.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${vc.dot} animate-pulse`}></span>
            {result.verdict_label}
          </span>
          <span className={`text-xs font-medium ${cc}`}>Confiance&nbsp;: {result.confidence_label}</span>
        </div>
      </div>

      {/* Synthèse */}
      <p className="text-sm text-slate-300 leading-relaxed mb-4">{result.synthesis}</p>

      {/* Action recommandée */}
      {result.action && (
        <div className="bg-slate-900/50 border border-slate-600/40 rounded-lg px-4 py-3 mb-4">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Action recommandée</div>
          <div className="text-sm text-white font-semibold">{result.action.primary_label}</div>
          {result.action.secondary && (
            <div className="text-xs text-slate-400 mt-1">→ {result.action.secondary}</div>
          )}
        </div>
      )}

      {/* Régularité */}
      {result.regularity && (
        <div className="text-xs text-slate-400 mb-4">
          <span className="font-semibold text-slate-300">Régularité :</span> {result.regularity.label} — {result.regularity.phrase}
        </div>
      )}

      {/* Warnings (max 4, groupés par famille) */}
      {result.warnings?.length > 0 && (
        <div className="space-y-2 mb-3">
          {result.warnings.map((w, i) => (
            <div key={i} className={`border rounded-lg px-4 py-2.5 text-xs ${FAMILY_STYLES[w.family] || FAMILY_STYLES.qualite}`}>
              <span className="font-semibold">{w.title}</span> — {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComparisonEvaluationPanel({ result }) {
  if (!result) return null;

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-800/80 border border-slate-700/60 rounded-xl p-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          Évaluation comparative
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/50 uppercase tracking-wider">Beta</span>
        </h2>
        <span className="text-xs font-semibold text-slate-200 bg-slate-700/60 ring-1 ring-slate-600/50 px-3 py-1 rounded-full">
          {result.decision_label}
        </span>
      </div>

      {/* Verdict texte */}
      <p className="text-sm text-slate-300 leading-relaxed mb-4">{result.verdict}</p>

      {/* Badges (3 angles) */}
      {result.badges?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {result.badges.map((b, i) => (
            <span key={i} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ring-1 ${BADGE_STYLES[b.badge] || 'bg-slate-700/60 text-slate-400 ring-slate-600/50'}`}>
              {b.label} → {b.winner_name}
            </span>
          ))}
        </div>
      )}

      {/* KPI table */}
      {result.kpi_table?.length > 0 && (
        <div className="border border-slate-600/40 rounded-lg overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-600/40 text-slate-500 bg-slate-900/30">
                <th className="py-2.5 px-4 text-left font-semibold">KPI</th>
                <th className="py-2.5 px-4 text-center font-semibold">Variante A</th>
                <th className="py-2.5 px-4 text-center font-semibold">Variante B</th>
              </tr>
            </thead>
            <tbody>
              {result.kpi_table.map((row, i) => (
                <tr key={i} className="border-b border-slate-700/30">
                  <td className="py-2 px-4 text-slate-400">{row.label}</td>
                  <td className="py-2 px-4 text-center text-slate-300">{row.value_a != null ? (typeof row.value_a === 'number' ? row.value_a.toFixed(2) : row.value_a) : '—'}</td>
                  <td className="py-2 px-4 text-center text-slate-300">{row.value_b != null ? (typeof row.value_b === 'number' ? row.value_b.toFixed(2) : row.value_b) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Warnings */}
      {result.warnings?.length > 0 && (
        <div className="space-y-2">
          {result.warnings.map((w, i) => (
            <div key={i} className={`border rounded-lg px-4 py-2.5 text-xs ${FAMILY_STYLES[w.family] || FAMILY_STYLES.qualite}`}>
              <span className="font-semibold">{w.title}</span> — {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
