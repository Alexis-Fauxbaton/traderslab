/**
 * EvaluationPanel V1 — wired to backend /analysis/* endpoints.
 */

const VERDICT_STYLES = {
  solide:       { badge: 'bg-green-900/30 text-green-400 border border-green-700',    dot: 'bg-green-400' },
  prometteuse:  { badge: 'bg-blue-900/30 text-blue-400 border border-blue-700',       dot: 'bg-blue-400' },
  a_confirmer:  { badge: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700', dot: 'bg-yellow-400' },
  fragile:      { badge: 'bg-red-900/30 text-red-400 border border-red-700',          dot: 'bg-red-400' },
};

const FAMILY_STYLES = {
  risque:     'border-red-800 bg-red-900/20 text-red-300',
  fiabilite:  'border-yellow-800 bg-yellow-900/20 text-yellow-300',
  qualite:    'border-slate-600 bg-slate-700/30 text-slate-300',
};

const CONFIDENCE_COLORS = {
  eleve:  'text-green-400',
  bon:    'text-blue-400',
  moyen:  'text-yellow-400',
  faible: 'text-red-400',
};

const BADGE_STYLES = {
  plus_rentable:      'bg-green-900/30 text-green-400 border-green-700',
  plus_stable:        'bg-blue-900/30 text-blue-400 border-blue-700',
  meilleur_compromis: 'bg-purple-900/30 text-purple-400 border-purple-700',
};

export function EvaluationPanel({ result, title = 'Évaluation' }) {
  if (!result) return null;
  const vc = VERDICT_STYLES[result.verdict] || VERDICT_STYLES.a_confirmer;
  const cc = CONFIDENCE_COLORS[result.confidence] || 'text-slate-400';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      {/* Header: titre + verdict + confiance */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">{title}</h2>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${vc.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${vc.dot}`}></span>
            {result.verdict_label}
          </span>
          <span className={`text-xs ${cc}`}>Confiance\u00a0: {result.confidence_label}</span>
        </div>
      </div>

      {/* Synthèse */}
      <p className="text-sm text-slate-300 mb-3">{result.synthesis}</p>

      {/* Action recommandée */}
      {result.action && (
        <div className="border border-slate-700 rounded-lg px-3 py-2 mb-3">
          <div className="text-xs font-medium text-slate-400 mb-0.5">Action recommandée</div>
          <div className="text-sm text-white font-medium">{result.action.primary_label}</div>
          {result.action.secondary && (
            <div className="text-xs text-slate-400 mt-0.5">→ {result.action.secondary}</div>
          )}
        </div>
      )}

      {/* Régularité */}
      {result.regularity && (
        <div className="text-xs text-slate-400 mb-3">
          <span className="font-medium text-slate-300">Régularité :</span> {result.regularity.label} — {result.regularity.phrase}
        </div>
      )}

      {/* Warnings (max 4, groupés par famille) */}
      {result.warnings?.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {result.warnings.map((w, i) => (
            <div key={i} className={`border rounded-lg px-3 py-2 text-xs ${FAMILY_STYLES[w.family] || FAMILY_STYLES.qualite}`}>
              <span className="font-medium">{w.title}</span> — {w.message}
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
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Évaluation comparative</h2>
        <span className="text-xs font-medium text-slate-300 bg-slate-700 px-2.5 py-0.5 rounded-full">
          {result.decision_label}
        </span>
      </div>

      {/* Verdict texte */}
      <p className="text-sm text-slate-300 mb-3">{result.verdict}</p>

      {/* Badges (3 angles) */}
      {result.badges?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {result.badges.map((b, i) => (
            <span key={i} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${BADGE_STYLES[b.badge] || 'bg-slate-700/60 text-slate-400 border-slate-600'}`}>
              {b.label} → {b.winner_name}
            </span>
          ))}
        </div>
      )}

      {/* KPI table */}
      {result.kpi_table?.length > 0 && (
        <div className="border border-slate-700 rounded-lg overflow-hidden mb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-500">
                <th className="py-2 px-3 text-left">KPI</th>
                <th className="py-2 px-3 text-center">Variante A</th>
                <th className="py-2 px-3 text-center">Variante B</th>
              </tr>
            </thead>
            <tbody>
              {result.kpi_table.map((row, i) => (
                <tr key={i} className="border-b border-slate-700/50">
                  <td className="py-1.5 px-3 text-slate-400">{row.label}</td>
                  <td className="py-1.5 px-3 text-center text-slate-300">
                    {row.value_a != null ? (typeof row.value_a === 'number' ? row.value_a.toFixed(2) : row.value_a) : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-center text-slate-300">
                    {row.value_b != null ? (typeof row.value_b === 'number' ? row.value_b.toFixed(2) : row.value_b) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Warnings */}
      {result.warnings?.length > 0 && (
        <div className="space-y-1.5">
          {result.warnings.map((w, i) => (
            <div key={i} className={`border rounded-lg px-3 py-2 text-xs ${FAMILY_STYLES[w.family] || FAMILY_STYLES.qualite}`}>
              <span className="font-medium">{w.title}</span> — {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
