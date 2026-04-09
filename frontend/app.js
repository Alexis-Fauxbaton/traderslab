/* ========================================================================
   TradersLab — Frontend SPA (vanilla JS, hash routing, sidebar + drag & drop)
   ======================================================================== */

// ===== UTILS =====

function esc(s) {
  if (s == null) return '';
  var d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// ===== UNIT SYSTEM =====

var _unitSettings = JSON.parse(localStorage.getItem('unitSettings') || 'null') || {
  initial_balance: 10000
};
// Risque moyen (|avg_loss|) du contexte courant — mis à jour avant chaque rendu de section
var _currentAvgLoss = null;

// ===== EVALUATION ENGINE HELPERS =====

/**
 * Construit un objet RunMetrics à partir des données brutes de l'API.
 * Normalise le max_drawdown en ratio (0–1) en le divisant par le pic d'equity.
 */
function buildRunMetrics(data) {
  var m = data.metrics || {};
  var ib = _unitSettings.initial_balance || 10000;
  var ddPeak = ib + (m.dd_peak_equity || 0);
  var maxDDRatio = ddPeak > 0 ? (m.max_drawdown || 0) / ddPeak : null;

  var totalTrades = m.total_trades || 0;
  var winCount = Math.round((m.win_rate || 0) * totalTrades);
  var lossCount = totalTrades - winCount;
  var totalPositivePnl = (m.avg_win || 0) * winCount;
  var totalNegativePnl = (m.avg_loss || 0) * lossCount; // avg_loss < 0 → négatif

  var coveredDays = null;
  if (data.start_date && data.end_date) {
    coveredDays = Math.round((new Date(data.end_date) - new Date(data.start_date)) / 86400000);
  }

  return {
    id: data.id,
    name: data.label,
    runType: data.type || 'backtest',
    tradeCount: totalTrades,
    pnl: m.total_pnl !== undefined ? m.total_pnl : null,
    winRate: m.win_rate !== undefined ? m.win_rate : null,
    profitFactor: m.profit_factor !== undefined ? m.profit_factor : null,
    expectancy: m.expectancy !== undefined ? m.expectancy : null,
    maxDrawdown: maxDDRatio,
    avgWin: m.avg_win !== undefined ? m.avg_win : null,
    avgLoss: m.avg_loss !== undefined ? m.avg_loss : null,
    bestTrade: m.best_trade !== undefined ? m.best_trade : null,
    worstTrade: m.worst_trade !== undefined ? m.worst_trade : null,
    sharpeRatio: m.sharpe_ratio !== undefined ? m.sharpe_ratio : null,
    totalPositivePnl: totalPositivePnl,
    totalNegativePnl: totalNegativePnl,
    periodStart: data.start_date || null,
    periodEnd: data.end_date || null,
    coveredDays: coveredDays,
  };
}

/**
 * Construit un objet VariantMetrics depuis les métriques agrégées et les runs de la variante.
 */
function buildVariantMetrics(variantData, aggMetrics, runs) {
  if (!aggMetrics) return null;
  var m = aggMetrics;
  var ib = _unitSettings.initial_balance || 10000;
  var ddPeak = ib + (m.dd_peak_equity || 0);
  var maxDDRatio = ddPeak > 0 ? (m.max_drawdown || 0) / ddPeak : null;

  var totalTrades = m.total_trades || 0;
  var winCount = Math.round((m.win_rate || 0) * totalTrades);
  var lossCount = totalTrades - winCount;
  var totalPositivePnl = (m.avg_win || 0) * winCount;
  var totalNegativePnl = (m.avg_loss || 0) * lossCount;

  var allDates = [];
  (runs || []).forEach(function (r) {
    if (r.start_date) allDates.push(new Date(r.start_date));
    if (r.end_date) allDates.push(new Date(r.end_date));
  });
  var coveredDays = null;
  if (allDates.length >= 2) {
    var minDate = allDates.reduce(function (a, b) { return a < b ? a : b; });
    var maxDate = allDates.reduce(function (a, b) { return a > b ? a : b; });
    coveredDays = Math.round((maxDate - minDate) / 86400000);
  }

  var runTypes = (runs || []).map(function (r) { return r.type; })
    .filter(function (v, i, arr) { return arr.indexOf(v) === i; });

  return {
    id: variantData.id,
    name: variantData.name,
    tradeCount: totalTrades,
    pnl: m.total_pnl !== undefined ? m.total_pnl : null,
    winRate: m.win_rate !== undefined ? m.win_rate : null,
    profitFactor: m.profit_factor !== undefined ? m.profit_factor : null,
    expectancy: m.expectancy !== undefined ? m.expectancy : null,
    maxDrawdown: maxDDRatio,
    avgWin: m.avg_win !== undefined ? m.avg_win : null,
    avgLoss: m.avg_loss !== undefined ? m.avg_loss : null,
    bestTrade: m.best_trade !== undefined ? m.best_trade : null,
    worstTrade: m.worst_trade !== undefined ? m.worst_trade : null,
    sharpeRatio: m.sharpe_ratio !== undefined ? m.sharpe_ratio : null,
    totalPositivePnl: totalPositivePnl,
    totalNegativePnl: totalNegativePnl,
    coveredDays: coveredDays,
    runTypes: runTypes,
    runsCount: (runs || []).length,
  };
}

/**
 * Construit un VariantMetrics pour la page de comparaison
 * (données venant de l'endpoint /compare, sans info sur les runs individuels).
 */
function buildVariantMetricsForCompare(variantData, metricsData, trades) {
  if (!metricsData) return null;
  var m = metricsData;
  var ib = _unitSettings.initial_balance || 10000;
  var ddPeak = ib + (m.dd_peak_equity || 0);
  var maxDDRatio = ddPeak > 0 ? (m.max_drawdown || 0) / ddPeak : null;

  var totalTrades = m.total_trades || 0;
  var winCount = Math.round((m.win_rate || 0) * totalTrades);
  var lossCount = totalTrades - winCount;
  var totalPositivePnl = (m.avg_win || 0) * winCount;
  var totalNegativePnl = (m.avg_loss || 0) * lossCount;

  var coveredDays = null;
  if (trades && trades.length >= 2) {
    var t0 = new Date(trades[0].date);
    var tN = new Date(trades[trades.length - 1].date);
    coveredDays = Math.round((tN - t0) / 86400000);
  }

  return {
    id: variantData.id,
    name: variantData.name,
    tradeCount: totalTrades,
    pnl: m.total_pnl !== undefined ? m.total_pnl : null,
    winRate: m.win_rate !== undefined ? m.win_rate : null,
    profitFactor: m.profit_factor !== undefined ? m.profit_factor : null,
    expectancy: m.expectancy !== undefined ? m.expectancy : null,
    maxDrawdown: maxDDRatio,
    avgWin: m.avg_win !== undefined ? m.avg_win : null,
    avgLoss: m.avg_loss !== undefined ? m.avg_loss : null,
    bestTrade: m.best_trade !== undefined ? m.best_trade : null,
    worstTrade: m.worst_trade !== undefined ? m.worst_trade : null,
    sharpeRatio: m.sharpe_ratio !== undefined ? m.sharpe_ratio : null,
    totalPositivePnl: totalPositivePnl,
    totalNegativePnl: totalNegativePnl,
    coveredDays: coveredDays,
    runTypes: [],
    runsCount: null,
  };
}

// Couleurs par verdict
var VERDICT_STYLES = {
  promising:    { badge: 'bg-green-900/30 text-green-400 border border-green-700',  dot: 'bg-green-400'  },
  fragile:      { badge: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700', dot: 'bg-yellow-400' },
  inconclusive: { badge: 'bg-slate-700/60 text-slate-400 border border-slate-600',  dot: 'bg-slate-400'  },
  invalid:      { badge: 'bg-red-900/30 text-red-400 border border-red-700',        dot: 'bg-red-400'    },
};
var COMP_VERDICT_STYLES = {
  promote_a:    { badge: 'bg-green-900/30 text-green-400 border border-green-700',   dot: 'bg-green-400'  },
  promote_b:    { badge: 'bg-green-900/30 text-green-400 border border-green-700',   dot: 'bg-green-400'  },
  keep_testing: { badge: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700', dot: 'bg-yellow-400' },
  inconclusive: { badge: 'bg-slate-700/60 text-slate-400 border border-slate-600',   dot: 'bg-slate-400'  },
};
var WARN_COLORS = {
  high:   'border-red-800 bg-red-900/20 text-red-300',
  medium: 'border-yellow-800 bg-yellow-900/20 text-yellow-300',
  low:    'border-slate-600 bg-slate-700/30 text-slate-300',
};
var CONF_COLORS = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-red-400' };

/**
 * Génère le HTML d'un panneau d'évaluation (run ou variante).
 */
function renderEvaluationPanel(result, title) {
  if (!result || typeof Evaluation === 'undefined') return '';
  title = title || 'Évaluation';
  var vc = VERDICT_STYLES[result.verdict] || VERDICT_STYLES.inconclusive;
  var cc = CONF_COLORS[result.confidence] || 'text-slate-400';

  var verdictBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ' + vc.badge + '">' +
    '<span class="w-1.5 h-1.5 rounded-full ' + vc.dot + '"></span>' +
    Evaluation.verdictLabel(result.verdict) + '</span>';

  var html = '<div class="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">' +
    '<div class="flex items-center justify-between mb-3">' +
      '<h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wide">' + esc(title) + '</h2>' +
      '<div class="flex items-center gap-2">' + verdictBadge +
        '<span class="text-xs ' + cc + '">Confiance&nbsp;: ' + Evaluation.confidenceLabel(result.confidence) + '</span>' +
      '</div>' +
    '</div>' +
    '<p class="text-sm text-slate-300 mb-3">' + esc(result.summary) + '</p>';

  if (result.reasons && result.reasons.length) {
    html += '<div class="text-xs text-slate-500 mb-3">' +
      result.reasons.map(function (r) { return '→ ' + esc(r); }).join('<br>') +
    '</div>';
  }

  var hasSW = (result.strengths && result.strengths.length) || (result.weaknesses && result.weaknesses.length);
  if (hasSW) {
    html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">';
    if (result.strengths && result.strengths.length) {
      html += '<div><div class="text-xs font-medium text-green-400 mb-1">✓ Points forts</div><ul class="space-y-0.5">' +
        result.strengths.map(function (s) { return '<li class="text-xs text-slate-300">• ' + esc(s) + '</li>'; }).join('') +
      '</ul></div>';
    }
    if (result.weaknesses && result.weaknesses.length) {
      html += '<div><div class="text-xs font-medium text-red-400 mb-1">✗ Points faibles</div><ul class="space-y-0.5">' +
        result.weaknesses.map(function (s) { return '<li class="text-xs text-slate-300">• ' + esc(s) + '</li>'; }).join('') +
      '</ul></div>';
    }
    html += '</div>';
  }

  if (result.warnings && result.warnings.length) {
    html += '<div class="space-y-1.5 mb-3">';
    result.warnings.forEach(function (w) {
      html += '<div class="border rounded-lg px-3 py-2 text-xs ' + (WARN_COLORS[w.severity] || WARN_COLORS.low) + '">' +
        '<span class="font-medium">' + esc(w.title) + '</span> — ' + esc(w.message) +
      '</div>';
    });
    html += '</div>';
  }

  if (result.nextSteps && result.nextSteps.length) {
    html += '<div class="border-t border-slate-700 mt-3 pt-3">' +
      '<div class="text-xs font-medium text-slate-400 mb-1.5">Prochaines étapes</div>' +
      '<ul class="space-y-0.5">' +
      result.nextSteps.map(function (s) { return '<li class="text-xs text-slate-300">→ ' + esc(s) + '</li>'; }).join('') +
      '</ul></div>';
  }

  return html + '</div>';
}

/**
 * Génère le HTML du panneau d'évaluation pour la comparaison A/B.
 */
function renderComparisonEvaluationPanel(result, nameA, nameB) {
  if (!result || typeof Evaluation === 'undefined') return '';
  var vc = COMP_VERDICT_STYLES[result.verdict] || COMP_VERDICT_STYLES.inconclusive;

  var verdictBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ' + vc.badge + '">' +
    '<span class="w-1.5 h-1.5 rounded-full ' + vc.dot + '"></span>' +
    Evaluation.comparisonVerdictLabel(result.verdict) + '</span>';

  var scoreBar = '';
  if (result.score && result.score.total > 0) {
    var pctA = Math.round(result.score.scoreA / result.score.total * 100);
    var pctB = Math.round(result.score.scoreB / result.score.total * 100);
    scoreBar = '<div class="mb-3">' +
      '<div class="flex items-center justify-between text-xs text-slate-400 mb-1">' +
        '<span class="text-blue-400">' + esc(nameA) + ' — ' + result.score.scoreA + ' pts</span>' +
        '<span class="text-slate-500">/ ' + result.score.total + ' pts</span>' +
        '<span class="text-amber-400">' + result.score.scoreB + ' pts — ' + esc(nameB) + '</span>' +
      '</div>' +
      '<div class="flex h-2 rounded-full overflow-hidden bg-slate-700">' +
        (pctA > 0 ? '<div class="bg-blue-500 transition-all" style="width:' + pctA + '%"></div>' : '') +
        (pctB > 0 ? '<div class="bg-amber-500 ml-auto transition-all" style="width:' + pctB + '%"></div>' : '') +
      '</div></div>';
  }

  var html = '<div class="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">' +
    '<div class="flex items-center justify-between mb-3">' +
      '<h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wide">Évaluation comparative</h2>' +
      verdictBadge +
    '</div>' +
    '<p class="text-sm text-slate-300 mb-3">' + esc(result.summary) + '</p>' +
    scoreBar;

  if (result.reasons && result.reasons.length) {
    html += '<div class="text-xs text-slate-500 mb-3">' +
      result.reasons.map(function (r) { return '→ ' + esc(r); }).join('<br>') +
    '</div>';
  }

  html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">';
  html += '<div class="border border-slate-700/60 rounded-lg p-3">' +
    '<div class="text-xs font-medium text-blue-400 mb-2">' + esc(nameA) + '</div>';
  (result.strengthsA || []).forEach(function (s) { html += '<div class="text-xs text-green-400">✓ ' + esc(s) + '</div>'; });
  (result.weaknessesA || []).forEach(function (s) { html += '<div class="text-xs text-red-400">✗ ' + esc(s) + '</div>'; });
  if (!(result.strengthsA || []).length && !(result.weaknessesA || []).length) {
    html += '<div class="text-xs text-slate-600">—</div>';
  }
  html += '</div>';

  html += '<div class="border border-slate-700/60 rounded-lg p-3">' +
    '<div class="text-xs font-medium text-amber-400 mb-2">' + esc(nameB) + '</div>';
  (result.strengthsB || []).forEach(function (s) { html += '<div class="text-xs text-green-400">✓ ' + esc(s) + '</div>'; });
  (result.weaknessesB || []).forEach(function (s) { html += '<div class="text-xs text-red-400">✗ ' + esc(s) + '</div>'; });
  if (!(result.strengthsB || []).length && !(result.weaknessesB || []).length) {
    html += '<div class="text-xs text-slate-600">—</div>';
  }
  html += '</div>';
  html += '</div>';

  if (result.warnings && result.warnings.length) {
    html += '<div class="space-y-1.5 mb-3">';
    result.warnings.forEach(function (w) {
      html += '<div class="border rounded-lg px-3 py-2 text-xs ' + (WARN_COLORS[w.severity] || WARN_COLORS.low) + '">' +
        '<span class="font-medium">[' + esc(w.target.toUpperCase()) + '] ' + esc(w.title) + '</span> — ' + esc(w.message) +
      '</div>';
    });
    html += '</div>';
  }

  if (result.nextSteps && result.nextSteps.length) {
    html += '<div class="border-t border-slate-700 mt-3 pt-3">' +
      '<div class="text-xs font-medium text-slate-400 mb-1.5">Prochaines étapes</div>' +
      '<ul class="space-y-0.5">' +
      result.nextSteps.map(function (s) { return '<li class="text-xs text-slate-300">→ ' + esc(s) + '</li>'; }).join('') +
      '</ul></div>';
  }

  return html + '</div>';
}

function saveUnitSettings() {
  localStorage.setItem('unitSettings', JSON.stringify(_unitSettings));
}

function getUnit() {
  var sel = document.getElementById('unit-selector');
  return sel ? sel.value : 'cash';
}

/**
 * Convertit une valeur monétaire selon l'unité sélectionnée.
 *   cash → valeur brute
 *   pct  → value / dénominateur * 100 (dénominateur varie selon ctx)
 *   R    → value / |avg_loss|
 *
 * ctx = objet { denom: number } — dénominateur du % (initial_balance, peak equity, solde avant trade…)
 */
function convertMetric(value, ctx) {
  if (value == null) return null;
  var unit = getUnit();
  if (unit === 'cash') return value;
  if (unit === 'pct') {
    var d = ctx && ctx.denom != null ? ctx.denom : _unitSettings.initial_balance;
    return d > 0 ? (value / d) * 100 : null;
  }
  if (unit === 'R') {
    var r = _currentAvgLoss != null ? Math.abs(_currentAvgLoss) : 0;
    return r > 0 ? value / r : null;
  }
  return value;
}

function unitSuffix() {
  var unit = getUnit();
  if (unit === 'pct') return '%';
  if (unit === 'R') return 'R';
  return '';
}

/**
 * Formate un PnL avec conversion.
 * denom = dénominateur pour le mode % (par défaut: initial_balance).
 */
function formatPnl(n, denom) {
  if (n == null) return '—';
  var v = convertMetric(n, {denom: denom != null ? denom : _unitSettings.initial_balance});
  if (v == null) return '—';
  var cls = v >= 0 ? 'text-green-400' : 'text-red-400';
  var sign = v >= 0 ? '+' : '';
  var suffix = unitSuffix();
  return '<span class="' + cls + '">' + sign + v.toFixed(2) + (suffix ? suffix : '') + '</span>';
}

/**
 * Formate un drawdown (toujours positif en entrée, affiché en négatif).
 * ddPeak = pic d'equity pour le mode % (drawdown% = dd / peak_equity).
 */
function formatDrawdown(n, ddPeak) {
  if (n == null) return '—';
  var v = convertMetric(n, {denom: ddPeak || 0});
  if (v == null) return '—';
  var suffix = unitSuffix();
  return '<span class="text-red-400">-' + v.toFixed(2) + (suffix ? suffix : '') + '</span>';
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(d) {
  if (!d) return '—';
  var ms = Date.now() - new Date(d).getTime();
  var s = Math.floor(ms / 1000);
  if (s < 60) return 'à l\'instant';
  var m = Math.floor(s / 60); if (m < 60) return 'il y a ' + m + ' min';
  var h = Math.floor(m / 60); if (h < 24) return 'il y a ' + h + 'h';
  var days = Math.floor(h / 24); if (days < 7) return 'il y a ' + days + 'j';
  var weeks = Math.floor(days / 7); if (weeks < 5) return 'il y a ' + weeks + 'sem';
  var months = Math.floor(days / 30); if (months < 12) return 'il y a ' + months + ' mois';
  return 'il y a ' + Math.floor(months / 12) + ' an(s)';
}

function formatPercent(n) {
  if (n == null) return '—';
  return (n * 100).toFixed(1) + '%';
}

var STATUS_LABELS = {
  idea:          'Idée',
  ready_to_test: 'Prêt à tester',
  testing:       'En test',
  active:        'Active',
  validated:     'Validée',
  rejected:      'Rejetée',
  archived:      'Archivée',
  abandoned:     'Abandonnée',
};

function statusBadge(status) {
  var label = STATUS_LABELS[status] || status;
  return '<span class="status-' + esc(status) + ' text-xs font-medium px-2.5 py-0.5 rounded-full">' + esc(label) + '</span>';
}

function breadcrumb(items) {
  return '<nav class="flex items-center gap-2 text-sm text-slate-400 mb-6 flex-wrap">' +
    items.map(function(item, i) {
      if (i < items.length - 1)
        return '<a href="' + item.href + '" class="hover:text-white transition">' + esc(item.label) + '</a><span class="text-slate-600">›</span>';
      return '<span class="text-slate-200">' + esc(item.label) + '</span>';
    }).join('') +
  '</nav>';
}

function spinner() {
  return '<div class="flex items-center justify-center h-64"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>';
}

function emptyState(message, actionLabel, actionHref) {
  return '<div class="text-center py-16 text-slate-400"><p class="text-lg mb-4">' + esc(message) + '</p>' +
    (actionLabel ? '<a href="' + actionHref + '" class="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition">' + esc(actionLabel) + '</a>' : '') +
  '</div>';
}

// ===== MODAL =====

function showModal(title, bodyHtml, onSubmit, options) {
  options = options || {};
  var overlay = document.getElementById('modal-overlay');
  var content = document.getElementById('modal-content');
  if (options.wide) {
    content.className = 'bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto';
  } else {
    content.className = 'bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto';
  }
  var footer = options.customFooter ||
    '<div class="flex justify-end gap-3 mt-6">' +
      '<button type="button" id="modal-cancel" class="px-4 py-2 text-sm text-slate-300 hover:text-white transition">Annuler</button>' +
      '<button type="submit" class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Confirmer</button>' +
    '</div>';
  content.innerHTML = '<h3 class="text-lg font-semibold text-white mb-4">' + esc(title) + '</h3>' +
    '<form id="modal-form">' + bodyHtml + footer + '</form>';
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
  document.getElementById('modal-cancel').onclick = closeModal;
  overlay.onclick = function(e) { if (e.target === overlay) closeModal(); };

  if (options.richText) {
    setTimeout(function() { initRichEditors(); }, 50);
  }

  var _lastSubmitBtn = null;
  content.querySelectorAll('button[type="submit"]').forEach(function(btn) {
    btn.addEventListener('click', function() { _lastSubmitBtn = btn; });
  });

  document.getElementById('modal-form').onsubmit = async function(e) {
    e.preventDefault();
    try { await onSubmit(new FormData(e.target), _lastSubmitBtn); closeModal(); }
    catch (err) { alert(err.message); }
  };
}

function closeModal() {
  var overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('flex');
  var content = document.getElementById('modal-content');
  content.className = 'bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto';
}

function inputField(name, label, type, required, value, placeholder) {
  type = type || 'text'; required = required !== false; value = value || '';
  return '<div class="mb-3"><label class="block text-sm text-slate-300 mb-1">' + esc(label) + '</label>' +
    '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + (required ? 'required' : '') +
    (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') +
    ' class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none placeholder:text-slate-500"></div>';
}

function textareaField(name, label, required, value) {
  return '<div class="mb-3"><label class="block text-sm text-slate-300 mb-1">' + esc(label) + '</label>' +
    '<textarea name="' + name + '" ' + (required ? 'required' : '') + ' rows="2"' +
    ' class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">' + esc(value || '') + '</textarea></div>';
}

// ===== RICH TEXT EDITOR (contenteditable) =====

function richTextField(name, label, value) {
  var id = 'rich-' + name;
  var encoded = esc(JSON.stringify(value || ''));
  return '<div class="mb-3"><label class="block text-sm text-slate-300 mb-1">' + esc(label) + '</label>' +
    '<div class="rich-editor" id="' + id + '" data-field-name="' + name + '" data-initial="' + encoded + '">' +
      '<div class="rich-toolbar">' +
        '<button type="button" data-cmd="bold" title="Gras (Ctrl+B)"><strong>G</strong></button>' +
        '<button type="button" data-cmd="italic" title="Italique (Ctrl+I)"><em>I</em></button>' +
        '<button type="button" data-cmd="underline" title="Souligné (Ctrl+U)"><u>S</u></button>' +
        '<span class="rich-sep"></span>' +
        '<button type="button" data-cmd="insertUnorderedList" title="Liste à puces">• ≡</button>' +
        '<button type="button" data-cmd="insertOrderedList" title="Liste numérotée">1.</button>' +
        '<button type="button" data-cmd="checklist" title="Checklist">☑</button>' +
      '</div>' +
      '<div class="rich-content" contenteditable="true" data-placeholder="Saisissez du texte…"></div>' +
    '</div>' +
  '</div>';
}

function normalizeRichValue(val) {
  if (!val) return '';
  try {
    var data = typeof val === 'string' ? JSON.parse(val) : val;
    if (data && typeof data === 'object' && data.blocks) {
      return editorjsBlocksToHtml(data.blocks);
    }
    if (typeof data === 'string') return data;
  } catch(e) {}
  return val;
}

function editorjsBlocksToHtml(blocks) {
  var html = '';
  blocks.forEach(function(b) {
    switch(b.type) {
      case 'paragraph': html += '<p>' + (b.data.text || '') + '</p>'; break;
      case 'header': html += '<h' + b.data.level + '>' + (b.data.text || '') + '</h' + b.data.level + '>'; break;
      case 'list':
        var tag = b.data.style === 'ordered' ? 'ol' : 'ul';
        html += '<' + tag + '>';
        (b.data.items || []).forEach(function(item) {
          var text = typeof item === 'string' ? item : (item.content || item.text || '');
          html += '<li>' + text + '</li>';
        });
        html += '</' + tag + '>'; break;
      case 'checklist':
        html += '<ul class="checklist">';
        (b.data.items || []).forEach(function(item) {
          html += '<li' + (item.checked ? ' class="checked"' : '') + '>' + (item.text || '') + '</li>';
        });
        html += '</ul>'; break;
      case 'quote': html += '<blockquote>' + (b.data.text || '') + '</blockquote>'; break;
      case 'delimiter': html += '<hr>'; break;
      default: if (b.data && b.data.text) html += '<p>' + b.data.text + '</p>';
    }
  });
  return html;
}

function initRichEditors() {
  document.querySelectorAll('.rich-editor').forEach(function(editor) {
    var name = editor.getAttribute('data-field-name');
    var raw = editor.getAttribute('data-initial');
    var content = editor.querySelector('.rich-content');
    var val = '';
    if (raw) {
      try { val = normalizeRichValue(JSON.parse(raw)); } catch(e) { val = raw; }
    }
    content.innerHTML = val;

    // Toolbar buttons
    editor.querySelectorAll('.rich-toolbar button[data-cmd]').forEach(function(btn) {
      btn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        content.focus();
        var cmd = btn.getAttribute('data-cmd');
        if (cmd === 'checklist') {
          toggleChecklist(content);
        } else {
          document.execCommand(cmd, false, null);
        }
        updateToolbarState(editor);
      });
    });

    // Update toolbar on selection/input change
    content.addEventListener('keyup', function() { updateToolbarState(editor); });
    content.addEventListener('mouseup', function() { updateToolbarState(editor); });

    // Checklist toggle on click in checkbox zone
    content.addEventListener('mousedown', function(e) {
      var li = e.target.closest('ul.checklist > li');
      if (li) {
        var rect = li.getBoundingClientRect();
        if (e.clientX - rect.left < 28) {
          e.preventDefault();
          li.classList.toggle('checked');
        }
      }
    });

    // Notion-style shortcuts: detect patterns on input
    content.addEventListener('input', function() {
      handleNotionShortcuts(content, editor);
    });

    // Handle Enter inside checklist to keep checklist mode
    content.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var sel = window.getSelection();
        if (!sel.rangeCount) return;
        var el = sel.anchorNode;
        el = el && el.nodeType === 3 ? el.parentElement : el;
        var li = el ? el.closest('ul.checklist > li') : null;
        if (li) {
          // If current li is empty, break out of the list
          if (!li.textContent.trim()) {
            e.preventDefault();
            var ul = li.closest('ul.checklist');
            li.remove();
            if (ul && ul.children.length === 0) ul.remove();
            document.execCommand('insertParagraph', false, null);
            return;
          }
        }
      }
      // Tab inside list = indent, Shift+Tab = outdent
      if (e.key === 'Tab') {
        var sel = window.getSelection();
        if (!sel.rangeCount) return;
        var el = sel.anchorNode;
        el = el && el.nodeType === 3 ? el.parentElement : el;
        if (el && el.closest('li')) {
          e.preventDefault();
          document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
        }
      }
    });
  });
}

function handleNotionShortcuts(content, editor) {
  var sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;

  var node = sel.anchorNode;
  if (!node || node.nodeType !== 3) return;
  var textNode = node;
  var text = textNode.textContent;

  // Only trigger at the start of a block-level element
  var blockEl = textNode.parentElement;
  while (blockEl && blockEl !== content && !isBlockElement(blockEl)) {
    blockEl = blockEl.parentElement;
  }
  if (!blockEl || blockEl === content) blockEl = textNode.parentElement;

  // Don't trigger inside an already-formatted list
  if (blockEl.closest('ul') || blockEl.closest('ol')) return;

  // Pattern: "- " or "* " → bullet list
  if (/^[-*]\s$/.test(text)) {
    clearTextAndExec(textNode, blockEl, content, function() {
      document.execCommand('insertUnorderedList', false, null);
    });
    updateToolbarState(editor);
    return;
  }

  // Pattern: "1. " → numbered list
  if (/^1\.\s$/.test(text)) {
    clearTextAndExec(textNode, blockEl, content, function() {
      document.execCommand('insertOrderedList', false, null);
    });
    updateToolbarState(editor);
    return;
  }

  // Pattern: "[] " or "[ ] " → checklist
  if (/^\[\s?\]\s$/.test(text)) {
    clearTextAndExec(textNode, blockEl, content, function() {
      document.execCommand('insertUnorderedList', false, null);
      var sel2 = window.getSelection();
      if (sel2.rangeCount) {
        var el = sel2.anchorNode;
        el = el && el.nodeType === 3 ? el.parentElement : el;
        while (el && el !== content) {
          if (el.tagName === 'UL') { el.classList.add('checklist'); break; }
          el = el.parentElement;
        }
      }
    });
    updateToolbarState(editor);
    return;
  }
}

function isBlockElement(el) {
  if (!el || !el.tagName) return false;
  return /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|UL|OL)$/.test(el.tagName);
}

function clearTextAndExec(textNode, blockEl, content, execFn) {
  // Remove the trigger text, then execute the command
  textNode.textContent = '\u200B'; // zero-width space to keep caret position
  var range = document.createRange();
  range.setStart(textNode, 1);
  range.collapse(true);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  execFn();
  // Clean up zero-width space
  setTimeout(function() {
    var s = window.getSelection();
    if (s.rangeCount) {
      var n = s.anchorNode;
      if (n && n.nodeType === 3 && n.textContent === '\u200B') {
        n.textContent = '';
      }
    }
  }, 0);
}

function toggleChecklist(content) {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var node = sel.anchorNode;
  var el = node && node.nodeType === 3 ? node.parentElement : node;
  var ul = null;
  while (el && el !== content) {
    if (el.tagName === 'UL') { ul = el; break; }
    el = el.parentElement;
  }
  if (ul && ul.classList.contains('checklist')) {
    ul.classList.remove('checklist');
    ul.querySelectorAll('li').forEach(function(li) { li.classList.remove('checked'); });
  } else if (ul) {
    ul.classList.add('checklist');
  } else {
    document.execCommand('insertUnorderedList', false, null);
    var node2 = sel.anchorNode;
    var el2 = node2 && node2.nodeType === 3 ? node2.parentElement : node2;
    while (el2 && el2 !== content) {
      if (el2.tagName === 'UL') { el2.classList.add('checklist'); break; }
      el2 = el2.parentElement;
    }
  }
}

function updateToolbarState(editor) {
  editor.querySelectorAll('.rich-toolbar button[data-cmd]').forEach(function(btn) {
    var cmd = btn.getAttribute('data-cmd');
    if (cmd === 'checklist') {
      var sel = window.getSelection();
      var inCL = false;
      if (sel.rangeCount) {
        var el = sel.anchorNode;
        el = el && el.nodeType === 3 ? el.parentElement : el;
        while (el) {
          if (el.classList && el.classList.contains('checklist')) { inCL = true; break; }
          el = el.parentElement;
        }
      }
      btn.classList.toggle('active', inCL);
    } else if (cmd === 'insertUnorderedList') {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    } else {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    }
  });
}

function getRichValue(name) {
  var editor = document.querySelector('.rich-editor[data-field-name="' + name + '"]');
  if (!editor) return '';
  var content = editor.querySelector('.rich-content');
  if (!content) return '';
  var html = content.innerHTML.trim();
  if (!html || html === '<br>' || html === '<p><br></p>') return '';
  return html;
}

function renderRichText(val) {
  if (!val) return '<span class="text-slate-600 italic">non renseigné</span>';
  var html = normalizeRichValue(val);
  if (!html || !html.trim()) return '<span class="text-slate-600 italic">non renseigné</span>';
  return '<div class="rich-display">' + html + '</div>';
}

function richTextPlain(val, maxLen) {
  if (!val) return '';
  var html = normalizeRichValue(val);
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  var text = tmp.textContent || tmp.innerText || '';
  if (maxLen && text.length > maxLen) text = text.substring(0, maxLen) + '…';
  return text;
}

function selectField(name, label, options, selected) {
  return '<div class="mb-3"><label class="block text-sm text-slate-300 mb-1">' + esc(label) + '</label>' +
    '<select name="' + name + '" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">' +
    options.map(function(o) { return '<option value="' + esc(o.value) + '" ' + (o.value === selected ? 'selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') +
    '</select></div>';
}

// ===== SIDEBAR =====

var _sidebarData = [];
var _expandedStrategies = {};
var _STRAT_ORDER_KEY = 'strategyOrder';

function getSavedStrategyOrder() {
  try { return JSON.parse(localStorage.getItem(_STRAT_ORDER_KEY)) || []; } catch(e) { return []; }
}
function saveStrategyOrder(ids) {
  try { localStorage.setItem(_STRAT_ORDER_KEY, JSON.stringify(ids)); } catch(e) {}
}
function sortSidebarData() {
  var order = getSavedStrategyOrder();
  if (!order.length) return;
  _sidebarData.sort(function(a, b) {
    var ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia === -1) ia = 9999;
    if (ib === -1) ib = 9999;
    return ia - ib;
  });
}

async function loadSidebar() {
  var tree = document.getElementById('sidebar-tree');
  try {
    var strategies = await API.get('/strategies');
    _sidebarData = [];
    for (var i = 0; i < strategies.length; i++) {
      var detail = await API.get('/strategies/' + strategies[i].id);
      _sidebarData.push(detail);
    }
    sortSidebarData();
    renderSidebar();
  } catch (err) {
    tree.innerHTML = '<div class="text-xs text-red-400 py-2 text-center">Erreur chargement</div>';
  }
}

function renderSidebar() {
  var tree = document.getElementById('sidebar-tree');
  if (_sidebarData.length === 0) {
    tree.innerHTML = '<div class="text-xs text-slate-500 italic py-4 text-center">Aucune stratégie</div>';
    return;
  }

  var html = '';
  _sidebarData.forEach(function(s) {
    var isOpen = _expandedStrategies[s.id];
    var varCount = s.variants ? s.variants.length : 0;
    html += '<div class="mb-1 strat-dnd-item" draggable="true" data-strat-id="' + s.id + '">' +
      '<div class="strat-toggle ' + (isOpen ? 'open' : '') + ' flex items-center gap-2 px-2 py-1.5 rounded-md text-sm" data-strat-id="' + s.id + '">' +
        '<span class="text-slate-600 cursor-grab hover:text-slate-400 transition select-none text-base leading-none">⠿</span>' +
        '<svg class="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<a href="#/strategy/' + s.id + '" class="flex-1 text-slate-200 hover:text-white truncate font-medium" draggable="false" title="' + esc(s.name) + '">' + esc(s.name) + '</a>' +
        '<span class="text-xs text-slate-500">' + varCount + '</span>' +
      '</div>';

    html += '<div class="variant-list pl-5" style="max-height:' + (isOpen ? (varCount * 40 + 10) + 'px' : '0') + '">';
    if (s.variants) {
      s.variants.forEach(function(v) {
        var statusDot = v.status === 'active' || v.status === 'validated'
          ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>'
          : v.status === 'testing' || v.status === 'ready_to_test'
            ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400"></span>'
            : v.status === 'rejected'
              ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-red-400"></span>'
              : '<span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-500"></span>';
        html += '<div class="sidebar-variant group px-3 py-2.5 text-xs" draggable="true" data-variant-id="' + v.id + '" data-variant-name="' + esc(v.name) + '" data-strategy-name="' + esc(s.name) + '">' +
          '<div class="flex items-center gap-2.5">' +
            '<span class="text-slate-500 cursor-grab group-active:cursor-grabbing transition opacity-0 group-hover:opacity-100">⠿</span>' +
            '<div class="flex items-center gap-2 flex-1 min-w-0">' +
              statusDot +
              '<a href="#/variant/' + v.id + '" class="flex-1 text-slate-300 hover:text-white truncate font-medium transition" title="' + esc(v.name) + '">' + esc(v.name) + '</a>' +
            '</div>' +
            '<span class="status-' + esc(v.status) + ' text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0">' + esc(STATUS_LABELS[v.status] || v.status) + '</span>' +
          '</div>' +
        '</div>';
      });
    }
    html += '</div></div>';
  });

  tree.innerHTML = html;

  // Bind expand/collapse — toggle in place pour conserver l'animation CSS
  tree.querySelectorAll('.strat-toggle').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.tagName === 'A') return;
      var stratId = el.getAttribute('data-strat-id');
      _expandedStrategies[stratId] = !_expandedStrategies[stratId];
      var isOpen = _expandedStrategies[stratId];
      el.classList.toggle('open', isOpen);
      var list = el.nextElementSibling;
      list.style.maxHeight = isOpen ? list.scrollHeight + 'px' : '0';
    });
  });

  // Bind drag start on variants (pour comparaison)
  tree.querySelectorAll('.sidebar-variant[draggable]').forEach(function(el) {
    el.addEventListener('dragstart', function(e) {
      var variantId = el.getAttribute('data-variant-id');
      var variantName = el.getAttribute('data-variant-name');
      var stratName = el.getAttribute('data-strategy-name');
      e.dataTransfer.setData('application/x-variant-id', variantId);
      e.dataTransfer.setData('application/x-variant-name', variantName);
      e.dataTransfer.setData('application/x-strategy-name', stratName);
      e.dataTransfer.effectAllowed = 'copy';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', function() {
      el.classList.remove('dragging');
    });
  });

  // Drag & drop reorder strategies — délégation sur le conteneur + zone bas
  var _dragSrcStratId = null;

  // Ajouter zone de drop en bas de la liste
  var bottomZone = document.createElement('div');
  bottomZone.id = 'strat-dnd-bottom';
  bottomZone.className = 'strat-dnd-bottom';
  tree.appendChild(bottomZone);

  // dragstart sur chaque item strat
  tree.querySelectorAll('.strat-dnd-item').forEach(function(el) {
    el.addEventListener('dragstart', function(e) {
      _dragSrcStratId = el.getAttribute('data-strat-id');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragSrcStratId);
      // Afficher uniquement la ligne de la strat dans le fantôme de drag
      var toggle = el.querySelector('.strat-toggle');
      if (toggle) e.dataTransfer.setDragImage(toggle, Math.min(120, toggle.offsetWidth / 2), toggle.offsetHeight / 2);
      setTimeout(function() { el.style.opacity = '0.4'; }, 0);
    });
    el.addEventListener('dragend', function() {
      el.style.opacity = '';
      tree.querySelectorAll('.strat-dnd-item').forEach(function(i) { i.classList.remove('dnd-over'); });
      bottomZone.classList.remove('dnd-over');
      _dragSrcStratId = null;
    });
  });

  // Délégation dragover/drop sur tout le tree
  tree.addEventListener('dragover', function(e) {
    if (!_dragSrcStratId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Trouver le .strat-dnd-item le plus proche
    var target = e.target;
    while (target && target !== tree && !target.classList.contains('strat-dnd-item')) {
      target = target.parentElement;
    }
    tree.querySelectorAll('.strat-dnd-item').forEach(function(i) { i.classList.remove('dnd-over'); });
    bottomZone.classList.remove('dnd-over');
    if (target && target.classList.contains('strat-dnd-item') && target.getAttribute('data-strat-id') !== _dragSrcStratId) {
      target.classList.add('dnd-over');
    } else if (!target || target === tree) {
      bottomZone.classList.add('dnd-over');
    }
  });

  tree.addEventListener('dragleave', function(e) {
    if (!e.relatedTarget || !tree.contains(e.relatedTarget)) {
      tree.querySelectorAll('.strat-dnd-item').forEach(function(i) { i.classList.remove('dnd-over'); });
      bottomZone.classList.remove('dnd-over');
    }
  });

  tree.addEventListener('drop', function(e) {
    if (!_dragSrcStratId) return;
    e.preventDefault();
    var target = e.target;
    while (target && target !== tree && !target.classList.contains('strat-dnd-item')) {
      target = target.parentElement;
    }
    var srcIdx = _sidebarData.findIndex(function(s) { return String(s.id) === String(_dragSrcStratId); });
    if (srcIdx === -1) return;
    var moved = _sidebarData.splice(srcIdx, 1)[0];
    if (target && target.classList.contains('strat-dnd-item') && target.getAttribute('data-strat-id') !== String(moved.id)) {
      var tgtIdx = _sidebarData.findIndex(function(s) { return String(s.id) === target.getAttribute('data-strat-id'); });
      if (tgtIdx !== -1) _sidebarData.splice(tgtIdx, 0, moved);
      else _sidebarData.push(moved);
    } else {
      // Zone bas ou zone vide → mettre en dernier
      _sidebarData.push(moved);
    }
    saveStrategyOrder(_sidebarData.map(function(s) { return s.id; }));
    renderSidebar();
  });
}

function setupTheme() {
  var root = document.documentElement;
  var btn = document.getElementById('btn-theme-toggle');

  function applyTheme(theme) {
    if (theme === 'light') {
      root.classList.add('light');
      btn.title = 'Passer en mode sombre';
      document.getElementById('icon-sun').classList.add('hidden');
      document.getElementById('icon-moon').classList.remove('hidden');
    } else {
      root.classList.remove('light');
      btn.title = 'Passer en mode clair';
      document.getElementById('icon-sun').classList.remove('hidden');
      document.getElementById('icon-moon').classList.add('hidden');
    }
  }

  var stored = localStorage.getItem('theme') || 'dark';
  applyTheme(stored);

  btn.addEventListener('click', function() {
    var next = root.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });
}

function setupSidebar() {
  document.getElementById('btn-toggle-sidebar').addEventListener('click', function() {
    var sidebar = document.getElementById('sidebar');
    var isCollapsed = sidebar.classList.toggle('collapsed');
    if (isCollapsed) {
      sidebar._savedWidth = sidebar.style.width || '';
      sidebar.style.width = '';
    } else {
      if (sidebar._savedWidth) sidebar.style.width = sidebar._savedWidth;
    }
  });
  document.getElementById('btn-new-strat-sidebar').addEventListener('click', function() {
    showNewStrategyModal();
  });

  // Resize handle
  var sidebar = document.getElementById('sidebar');
  var handle = document.getElementById('sidebar-resize-handle');
  var STORAGE_KEY = 'sidebar_width';

  var saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  if (saved && saved >= 160 && saved <= 520) sidebar.style.width = saved + 'px';

  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var startX = e.clientX;
    var startW = sidebar.offsetWidth;
    sidebar.classList.add('resizing');
    handle.classList.add('active');

    function onMove(e) {
      var w = Math.min(520, Math.max(160, startW + e.clientX - startX));
      sidebar.style.width = w + 'px';
    }
    function onUp() {
      sidebar.classList.remove('resizing');
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(STORAGE_KEY, parseInt(sidebar.style.width, 10));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function showNewStrategyModal() {
  showModal('Nouvelle Stratégie',
    inputField('name', 'Nom') +
    textareaField('description', 'Description') +
    inputField('pairs', 'Paires (séparées par des virgules)', 'text', true, 'XAUUSD') +
    inputField('timeframes_input', 'Timeframes (séparées par des virgules)', 'text', true, 'M15'),
    async function(fd) {
      var pairsStr = fd.get('pairs') || '';
      var tfsStr = fd.get('timeframes_input') || '';
      var strat = await API.post('/strategies', {
        name: fd.get('name'), description: fd.get('description'),
        pairs: pairsStr.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean),
        timeframes: tfsStr.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean),
      });
      // Créer silencieusement la première itération : NomStratégie V1
      var v = await API.post('/variants', {
        strategy_id: strat.id,
        name: strat.name + ' V1',
        status: 'active',
        key_change: '',
      });
      await loadSidebar();
      // Aller directement à l'import pour fluidifier le démarrage
      location.hash = '#/import/' + v.id;
    }
  );
}

// ===== ROUTER =====

var APP = document.getElementById('app');
var _prevHash = null;

function getPageDepth(hash) {
  if (!hash || hash === '/') return 0;
  if (hash.match(/^\/strategy\//)) return 1;
  if (hash === '/compare') return 1;
  if (hash.match(/^\/import\//)) return 2;
  if (hash.match(/^\/variant\//)) return 2;
  if (hash.match(/^\/run\//)) return 3;
  return 1;
}

function saveLastVisit(hash, crumbs) {
  try { localStorage.setItem('lastVisit', JSON.stringify({ hash: hash, ts: Date.now(), crumbs: crumbs || null })); } catch(e) {}
}

async function route() {
  var hash = location.hash.slice(1) || '/';
  if (hash !== '/') {
    try { localStorage.setItem('lastVisit', JSON.stringify({ hash: hash, ts: Date.now(), crumbs: null })); } catch(e) {}
  }

  // Direction : profondeur croissante = forward (slide from right), décroissante = back
  var dir = (_prevHash !== null && getPageDepth(hash) < getPageDepth(_prevHash)) ? 'back' : 'forward';

  // Animate out
  if (_prevHash !== null) {
    var outEl = APP.firstElementChild;
    if (outEl) {
      outEl.style.pointerEvents = 'none';
      outEl.classList.add(dir === 'forward' ? 'page-exit-left' : 'page-exit-right');
      await new Promise(function(r) { setTimeout(r, 130); });
    }
  }
  _prevHash = hash;
  APP.innerHTML = '';

  try {
    var m;
    if (hash === '/') await pageDashboard();
    else if ((m = hash.match(/^\/strategy\/(.+)$/))) await pageStrategy(m[1]);
    else if ((m = hash.match(/^\/variant\/(.+)$/))) await pageVariant(m[1]);
    else if ((m = hash.match(/^\/run\/(.+)$/))) await pageRun(m[1]);
    else if ((m = hash.match(/^\/import\/(.+)$/))) await pageImport(m[1]);
    else if (hash === '/compare') await pageCompare();
    else { APP.innerHTML = '<p class="text-center mt-20 text-slate-400">Page introuvable</p>'; return; }
  } catch (err) {
    APP.innerHTML = '<div class="text-center mt-20"><p class="text-red-400 text-lg">Erreur</p><p class="text-slate-400 mt-2">' + esc(err.message) + '</p></div>';
    return;
  }

  // Animate in
  var inEl = APP.firstElementChild;
  if (inEl) {
    inEl.classList.remove('fade-in');
    void inEl.offsetWidth; // force reflow
    inEl.classList.add(dir === 'forward' ? 'page-enter-right' : 'page-enter-left');
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', function() {
  setupTheme();
  setupSidebar();
  loadSidebar();
  initUnitSystem();
  route();
});

function initUnitSystem() {
  var sel = document.getElementById('unit-selector');
  var infoIcon = document.getElementById('unit-info');
  var saved = localStorage.getItem('unitMode');
  if (saved && sel) sel.value = saved;

  var _infoTexts = {
    'pct': 'PnL, expectancy, avg\u2026 → % du capital initial. Drawdown → % du pic equity. Trade → % du solde avant le trade.',
    'R': 'R = valeur / |avg loss|. Le risque moyen est calculé automatiquement depuis le avg_loss du run affiché.'
  };
  function toggleInfo() {
    if (!infoIcon) return;
    var txt = _infoTexts[sel.value];
    if (txt) {
      infoIcon.classList.remove('hidden');
      infoIcon.title = txt;
    } else {
      infoIcon.classList.add('hidden');
    }
  }
  if (sel) {
    toggleInfo();
    sel.onchange = function() {
      localStorage.setItem('unitMode', sel.value);
      toggleInfo();
      route(); // re-render page with new unit
    };
  }

  var btn = document.getElementById('btn-unit-settings');
  if (btn) {
    btn.onclick = function() {
      showModal('Paramètres des unités',
        inputField('initial_balance', 'Capital initial ($)', 'number', true, _unitSettings.initial_balance),
        function(fd) {
          _unitSettings.initial_balance = parseFloat(fd.get('initial_balance')) || 10000;
          saveUnitSettings();
          route();
        }
      );
    };
  }
}

// ===== PAGE: DASHBOARD =====

var _dashboardCharts = [];

async function pageDashboard() {
  var [strategies, activity] = await Promise.all([
    API.get('/strategies/dashboard'),
    API.get('/strategies/dashboard/activity'),
  ]);

  // --- "Reprendre" banner ---
  var lastVisit = null;
  try { lastVisit = JSON.parse(localStorage.getItem('lastVisit')); } catch (e) {}

  function resumeBanner() {
    if (!lastVisit || !lastVisit.hash) return '';
    var hash = lastVisit.hash;
    var ago = timeAgo(lastVisit.ts);
    var crumbs = lastVisit.crumbs;

    var pathHtml;
    if (crumbs && crumbs.length > 0) {
      // Arborescence enrichie : Stratégie > Variante > Run
      pathHtml = crumbs.map(function(c, i) {
        var isLast = i === crumbs.length - 1;
        var labelHtml = isLast
          ? '<strong class="text-blue-200">' + esc(c.label) + '</strong>'
          : '<span class="text-blue-300/70">' + esc(c.label) + '</span>';
        return labelHtml + (isLast ? '' : '<span class="text-blue-500/50 mx-1">›</span>');
      }).join('');
    } else {
      // Fallback label simple
      var label = hash;
      var m2;
      if ((m2 = hash.match(/^\/strategy\/(.+)$/))) label = 'Stratégie';
      else if ((m2 = hash.match(/^\/variant\/(.+)$/))) label = 'Variante';
      else if ((m2 = hash.match(/^\/run\/(.+)$/))) label = 'Run';
      else if (hash === '/compare') label = 'Comparaison';
      pathHtml = '<strong class="text-blue-200">' + esc(label) + '</strong>';
    }

    return '<div class="mb-5">' +
      '<a href="#' + esc(hash) + '" class="inline-flex items-center gap-2 bg-blue-600/15 border border-blue-500/30 hover:bg-blue-600/25 transition text-blue-300 px-4 py-2.5 rounded-lg text-sm">' +
        '<span>↩</span>' +
        '<span>Reprendre — ' + pathHtml + '</span>' +
        '<span class="text-blue-400/50 text-xs">(' + esc(ago) + ')</span>' +
      '</a>' +
    '</div>';
  }

  // --- Widget helpers ---
  function widgetCard(title, icon, content) {
    return '<div class="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col">' +
      '<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">' +
        '<span>' + icon + '</span>' + title +
      '</h3>' +
      content +
    '</div>';
  }

  function rowLink(href, primary, secondary, badge) {
    return '<a href="' + esc(href) + '" class="flex items-center justify-between py-1.5 hover:bg-slate-700/40 -mx-2 px-2 rounded transition group">' +
      '<div class="min-w-0 flex-1">' +
        '<p class="truncate text-slate-200 text-xs group-hover:text-blue-400 transition">' + esc(primary) + '</p>' +
        (secondary ? '<p class="text-slate-500 text-xs truncate">' + esc(secondary) + '</p>' : '') +
      '</div>' +
      (badge ? '<span class="ml-2 shrink-0 text-slate-500 text-xs">' + badge + '</span>' : '') +
    '</a>';
  }

  // --- Recent variants widget ---
  function recentVariantsContent() {
    if (!activity.recent_variants || activity.recent_variants.length === 0)
      return '<p class="text-slate-500 text-xs italic">Aucune variante</p>';
    return activity.recent_variants.map(function(v) {
      return rowLink('#/variant/' + v.id, v.name, v.strategy_name, timeAgo(v.created_at));
    }).join('');
  }

  // --- Recent imports widget ---
  function recentRunsContent() {
    if (!activity.recent_runs || activity.recent_runs.length === 0)
      return '<p class="text-slate-500 text-xs italic">Aucun import</p>';
    return activity.recent_runs.map(function(r) {
      return rowLink('#/run/' + r.id, r.label || r.type, r.variant_name, timeAgo(r.imported_at));
    }).join('');
  }

  // --- To review widget ---
  function toReviewContent() {
    if (!activity.to_review || activity.to_review.length === 0)
      return '<p class="text-slate-500 text-xs text-green-400/70">Tout est à jour ✓</p>';
    var badgeCount = activity.to_review.length;
    var rows = activity.to_review.map(function(v) {
      var badgeClass = v.status === 'testing' || v.status === 'ready_to_test' ? 'text-yellow-400' : v.status === 'idea' ? 'text-purple-400' : 'text-blue-400';
      var badge = '<span class="' + badgeClass + '">' + esc(STATUS_LABELS[v.status] || v.status) + '</span>';
      return rowLink('#/variant/' + v.id, v.name, v.strategy_name, badge);
    }).join('');
    return rows;
  }

  // --- Best / worst widget ---
  function performancesContent() {
    var b = activity.best_variant, w = activity.worst_variant;
    if (!b && !w) return '<p class="text-slate-500 text-xs italic">Pas encore de données</p>';
    var html = '';
    if (b) {
      html += '<div class="mb-3">' +
        '<p class="text-xs text-slate-500 mb-1">🏆 Meilleure variante</p>' +
        '<a href="#/variant/' + esc(b.id) + '" class="group block">' +
          '<p class="text-slate-200 text-xs group-hover:text-blue-400 transition truncate">' + esc(b.name) + '</p>' +
          '<p class="text-xs text-slate-500 truncate">' + esc(b.strategy_name) + '</p>' +
          '<p class="text-green-400 text-sm font-semibold mt-0.5">' + (b.total_pnl >= 0 ? '+' : '') + b.total_pnl.toFixed(2) + '</p>' +
        '</a>' +
      '</div>';
    }
    if (w && (!b || w.id !== b.id)) {
      html += '<div>' +
        '<p class="text-xs text-slate-500 mb-1">↓ Pire variante</p>' +
        '<a href="#/variant/' + esc(w.id) + '" class="group block">' +
          '<p class="text-slate-200 text-xs group-hover:text-blue-400 transition truncate">' + esc(w.name) + '</p>' +
          '<p class="text-xs text-slate-500 truncate">' + esc(w.strategy_name) + '</p>' +
          '<p class="text-red-400 text-sm font-semibold mt-0.5">' + (w.total_pnl >= 0 ? '+' : '') + w.total_pnl.toFixed(2) + '</p>' +
        '</a>' +
      '</div>';
    }
    return html;
  }

  var hasActivity = (activity.recent_variants && activity.recent_variants.length > 0) ||
                    (activity.recent_runs && activity.recent_runs.length > 0) ||
                    (activity.to_review && activity.to_review.length > 0) ||
                    activity.best_variant;

  APP.innerHTML = '<div class="fade-in">' +
    '<div class="flex items-center justify-between mb-6">' +
      '<h1 class="text-2xl font-bold text-white">Mes Stratégies</h1>' +
      '<button id="btn-new-strat" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">+ Nouvelle Stratégie</button>' +
    '</div>' +

    resumeBanner() +

    (hasActivity ?
      '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">' +
        widgetCard('Variantes récentes', '🧪', recentVariantsContent()) +
        widgetCard('Derniers imports', '📥', recentRunsContent()) +
        widgetCard('À revoir', '🔍', toReviewContent()) +
        widgetCard('Performances', '🏆', performancesContent()) +
      '</div>'
    : '') +

    (strategies.length === 0 ? emptyState('Aucune stratégie créée') :
    '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">' +
      strategies.map(function(s, idx) {
        var m = s.aggregate_metrics;
        var hasMet = m && m.total_trades > 0;
        _currentAvgLoss = hasMet ? m.avg_loss : null;
        var rr = (hasMet && m.avg_win && m.avg_loss && m.avg_loss !== 0) ? Math.abs(m.avg_win / m.avg_loss) : null;
        var desc = richTextPlain(s.description, 120);
        return '<a href="#/strategy/' + s.id + '" class="block bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/50 transition group">' +
          '<div class="flex items-start justify-between mb-2">' +
            '<h3 class="font-semibold text-white group-hover:text-blue-400 transition">' + esc(s.name) + '</h3>' +
            '<span class="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">' + esc((s.timeframes || []).join(', ')) + '</span>' +
          '</div>' +
          '<p class="text-xs text-slate-400 mb-2">' + (esc(desc) || '<span class="italic">Pas de description</span>') + '</p>' +
          (hasMet ?
            '<div style="height:60px" class="mb-2"><canvas id="dash-chart-' + idx + '"></canvas></div>' +
            '<div class="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mb-2">' +
              '<span>PnL ' + formatPnl(m.total_pnl) + '</span>' +
              '<span>Profit Factor <span class="text-white">' + (m.profit_factor != null ? m.profit_factor.toFixed(2) : '—') + '</span></span>' +
              '<span>RR Moyen <span class="text-white">' + (rr != null ? rr.toFixed(2) : '—') + '</span></span>' +
            '</div>'
          : '') +
          '<div class="flex items-center gap-3 text-xs text-slate-500">' +
            '<span>📈 ' + esc((s.pairs || []).join(', ')) + '</span>' +
            '<span>📅 ' + formatDate(s.created_at) + '</span>' +
            (hasMet ? '<span>' + m.total_trades + ' trades</span>' : '') +
          '</div>' +
        '</a>';
      }).join('') +
    '</div>') +
  '</div>';

  // Render mini equity charts
  _dashboardCharts.forEach(function(c) { c.destroy(); });
  _dashboardCharts = [];
  strategies.forEach(function(s, idx) {
    var m = s.aggregate_metrics;
    if (!m || !m.equity_curve || m.equity_curve.length === 0) return;
    var canvas = document.getElementById('dash-chart-' + idx);
    if (!canvas) return;
    var values = m.equity_curve.map(function(p) { return p.cumulative_pnl; });
    var labels = m.equity_curve.map(function(p) { return ''; });
    var color = values[values.length - 1] >= 0 ? '#22c55e' : '#ef4444';
    var bgColor = values[values.length - 1] >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: [{ data: values, borderColor: color, backgroundColor: bgColor, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, interaction: { enabled: false } }
    });
    _dashboardCharts.push(chart);
  });

  document.getElementById('btn-new-strat').onclick = function() { showNewStrategyModal(); };
}

// ===== PAGE: STRATEGY DETAIL =====

var _strategyCharts = [];
var _strategyNetwork = null;

function renderStrategyGraph(containerId, variants, varMetrics) {
  if (_strategyNetwork) { _strategyNetwork.destroy(); _strategyNetwork = null; }
  var container = document.getElementById(containerId);
  if (!container || !variants || variants.length === 0) return;

  var nodes = [];
  var edges = [];

  variants.forEach(function(v) {
    var m = varMetrics[v.id];
    var hasMet = m && m.total_trades > 0;

    // Build multiline label
    var label = v.name;
    if (hasMet) {
      var pnlVal = m.total_pnl != null ? (m.total_pnl >= 0 ? '+' : '') + m.total_pnl.toFixed(2) : '—';
      var wrVal = m.win_rate != null ? (m.win_rate * 100).toFixed(1) + '%' : '—';
      label += '\n' + m.total_trades + ' trades | WR ' + wrVal + '\nPnL ' + pnlVal;
    } else {
      label += '\nPas de données';
    }

    // Color based on PnL
    var borderColor = '#475569'; // slate-600
    var bgColor = '#1e293b';     // slate-800
    var fontColor = '#e2e8f0';   // slate-200
    if (hasMet && m.total_pnl != null) {
      if (m.total_pnl > 0) {
        borderColor = '#22c55e'; bgColor = '#0f3a24';
      } else if (m.total_pnl < 0) {
        borderColor = '#ef4444'; bgColor = '#3b1111';
      }
    }

    // Status indicator
    var statusEmoji = v.status === 'active' ? '🟢 '
      : v.status === 'validated'    ? '✅ '
      : v.status === 'testing'      ? '🟡 '
      : v.status === 'ready_to_test'? '🔵 '
      : v.status === 'idea'         ? '💡 '
      : v.status === 'rejected'     ? '🔴 '
      : v.status === 'archived'     ? '⚪ ' : '';

    nodes.push({
      id: v.id,
      label: statusEmoji + label,
      shape: 'box',
      margin: { top: 12, bottom: 12, left: 16, right: 16 },
      font: { multi: false, color: fontColor, size: 13, face: 'ui-sans-serif, system-ui, sans-serif', align: 'center' },
      color: { background: bgColor, border: borderColor, highlight: { background: '#334155', border: '#60a5fa' }, hover: { background: '#334155', border: '#60a5fa' } },
      borderWidth: 2,
      borderWidthSelected: 3,
      shadow: { enabled: true, color: 'rgba(0,0,0,0.4)', size: 8, x: 0, y: 3 },
      chosen: true,
      variantId: v.id
    });

    if (v.parent_variant_id) {
      edges.push({
        from: v.parent_variant_id,
        to: v.id,
        arrows: { to: { enabled: true, scaleFactor: 0.7, type: 'arrow' } },
        color: { color: '#475569', highlight: '#60a5fa', hover: '#60a5fa' },
        width: 2,
        smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.4 }
      });
    }
  });

  var data = {
    nodes: new vis.DataSet(nodes),
    edges: new vis.DataSet(edges)
  };

  var options = {
    layout: {
      hierarchical: {
        enabled: true,
        direction: 'UD',
        sortMethod: 'directed',
        levelSeparation: 100,
        nodeSpacing: 180,
        treeSpacing: 200,
        blockShifting: true,
        edgeMinimization: true,
        parentCentralization: true
      }
    },
    physics: { enabled: false },
    interaction: {
      hover: true,
      tooltipDelay: 200,
      zoomView: true,
      dragView: true,
      navigationButtons: false,
      keyboard: false
    },
    nodes: {
      shapeProperties: { borderRadius: 8 }
    }
  };

  _strategyNetwork = new vis.Network(container, data, options);

  // Click on node → navigate to variant page
  _strategyNetwork.on('doubleClick', function(params) {
    if (params.nodes && params.nodes.length > 0) {
      var nodeId = params.nodes[0];
      location.hash = '#/variant/' + nodeId;
    }
  });

  // Cursor pointer on hover
  _strategyNetwork.on('hoverNode', function() { container.style.cursor = 'pointer'; });
  _strategyNetwork.on('blurNode', function() { container.style.cursor = 'default'; });

  // Fit to content after stabilization
  _strategyNetwork.once('afterDrawing', function() {
    _strategyNetwork.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
  });
}

async function pageStrategy(id) {
  var data = await API.get('/strategies/' + id);
  var variantsSummary = await API.get('/strategies/' + id + '/variants-summary');
  saveLastVisit('/strategy/' + id, [{ label: 'Stratégies', href: '#/' }, { label: data.name }]);

  // Build a lookup map from summary data
  var varMetrics = {};
  variantsSummary.forEach(function(vs) { varMetrics[vs.id] = vs.aggregate_metrics; });

  APP.innerHTML = '<div class="fade-in">' +
    breadcrumb([{label:'Stratégies', href:'#/'}, {label: data.name}]) +
    '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
      '<div class="flex items-start justify-between">' +
        '<div>' +
          '<h1 class="text-2xl font-bold text-white mb-1">' + esc(data.name) + '</h1>' +
          '<p class="text-slate-400 text-sm mb-3">' + (esc(data.description) || 'Pas de description') + '</p>' +
          '<div class="flex gap-4 text-sm text-slate-400">' +
            '<span>📈 ' + esc((data.pairs || []).join(', ')) + '</span>' +
            '<span>⏱ ' + esc((data.timeframes || []).join(', ')) + '</span>' +
            '<span>📅 ' + formatDate(data.created_at) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex gap-2">' +
          '<button id="btn-edit-strat" class="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Modifier</button>' +
          '<button id="btn-del-strat" class="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    (function() {
      var activeVar = data.variants.find(function(v) { return v.status === 'active'; });
      var lastVar = data.variants.length > 0 ? data.variants[0] : null; // déjà trié par date desc
      if (!activeVar && !lastVar) return '';
      var importTarget = activeVar || lastVar; // import dispo même si pas de variante "active"
      if (!importTarget && !lastVar) return '';
      var activeHtml = activeVar
        ? '<div class="flex items-center gap-2"><span class="text-xs text-slate-500">Version active</span><a href="#/variant/' + activeVar.id + '" class="text-sm font-medium text-white hover:text-blue-400 transition">' + esc(activeVar.name) + '</a>' + statusBadge(activeVar.status) + '</div>'
        : '<div class="flex items-center gap-2"><span class="text-xs text-slate-500">Version active</span><span class="text-sm text-slate-500 italic">aucune</span></div>';
      var lastHtml = (lastVar && (!activeVar || lastVar.id !== activeVar.id))
        ? '<div class="flex items-center gap-2 mt-1"><span class="text-xs text-slate-500">Dernière itération</span><a href="#/variant/' + lastVar.id + '" class="text-sm text-slate-300 hover:text-white transition">' + esc(lastVar.name) + '</a>' + statusBadge(lastVar.status) + '</div>'
        : '';
      return '<div class="bg-slate-800/60 border border-slate-700/60 rounded-xl px-5 py-4 mb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">' +
        '<div>' + activeHtml + lastHtml + '</div>' +
        '<div class="flex flex-wrap gap-2">' +
          '<button id="btn-new-var-quick" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">+ Tester une modification</button>' +
          (importTarget ? '<a href="#/import/' + importTarget.id + '" class="text-sm text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">📥 Importer un run</a>' : '') +
          (activeVar && lastVar && lastVar.id !== activeVar.id
            ? '<button id="btn-compare-quick" class="text-sm text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">⚖ Comparer active vs dernier test</button>'
            : '') +
        '</div>' +
      '</div>';
    })() +
    '<div class="flex items-center justify-between mb-4">' +
      '<h2 class="text-base font-semibold text-slate-400">Historique des itérations (' + data.variants.length + ')</h2>' +
      '<div class="flex gap-2">' +
        '<button id="btn-view-grid" class="text-sm px-3 py-1.5 rounded-lg border transition bg-blue-600 border-blue-500 text-white">Grille</button>' +
        (data.variants.length >= 2 ? '<button id="btn-view-tree" class="text-sm px-3 py-1.5 rounded-lg border transition border-slate-600 text-slate-400 hover:text-white">Arborescence</button>' : '') +
        '<button id="btn-new-var" class="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">+ Nouvelle itération</button>' +
      '</div>' +
    '</div>' +
    '<div id="variants-grid">' +
    (data.variants.length === 0
      ? '<div class="text-center py-16 bg-slate-800/40 border border-dashed border-slate-700 rounded-xl">' +
          '<div class="text-5xl mb-4">📥</div>' +
          '<h3 class="text-base font-semibold text-white mb-2">Importez vos premiers résultats</h3>' +
          '<p class="text-sm text-slate-400 mb-6">Créez une itération et importez vos trades pour commencer à analyser cette stratégie.</p>' +
          '<button id="btn-first-import" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">📥 Créer et importer un run</button>' +
        '</div>'
    :
    '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">' +
      data.variants.map(function(v, idx) {
        var m = varMetrics[v.id];
        var hasMet = m && m.total_trades > 0;
        _currentAvgLoss = hasMet ? m.avg_loss : null;
        var rr = (hasMet && m.avg_win && m.avg_loss && m.avg_loss !== 0) ? Math.abs(m.avg_win / m.avg_loss) : null;
        var desc = richTextPlain(v.description, 100);
        return '<a href="#/variant/' + v.id + '" class="block bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/50 transition group">' +
          '<div class="flex items-start justify-between mb-2">' +
            '<h3 class="font-semibold text-white group-hover:text-blue-400 transition">' + esc(v.name) + '</h3>' +
            statusBadge(v.status) +
          '</div>' +
          (v.key_change ? '<div class="flex items-start gap-1.5 mb-2"><span class="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5 shrink-0">Δ</span><span class="text-xs text-blue-300/90 font-medium leading-snug">' + esc(v.key_change) + '</span></div>' : '') +
          (desc ? '<p class="text-xs text-slate-500 mb-2 truncate">' + esc(desc) + '</p>' : '') +
          (hasMet ?
            '<div style="height:56px" class="mb-2"><canvas id="var-chart-' + idx + '"></canvas></div>' +
            '<div class="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mb-2">' +
              '<span>PnL ' + formatPnl(m.total_pnl) + '</span>' +
              '<span>PF <span class="text-white">' + (m.profit_factor != null ? m.profit_factor.toFixed(2) : '—') + '</span></span>' +
              '<span>RR <span class="text-white">' + (rr != null ? rr.toFixed(2) : '—') + '</span></span>' +
            '</div>'
          : '') +
          '<div class="flex items-center gap-3 text-xs text-slate-500">' +
            '<span>📅 ' + formatDate(v.created_at) + '</span>' +
            (hasMet ? '<span>' + m.total_trades + ' trades</span>' : '') +
          '</div>' +
        '</a>';
      }).join('') +
    '</div>') +
    '</div>' +
    (data.variants.length >= 2
      ? '<div id="variants-tree" class="hidden">' +
          '<div id="strategy-graph" style="height:550px;border-radius:12px;overflow:hidden" class="bg-slate-800 border border-slate-700"></div>' +
        '</div>'
      : '') +
  '</div>';

  // Cleanup previous
  _strategyCharts.forEach(function(c) { c.destroy(); });
  _strategyCharts = [];
  if (_strategyNetwork) { _strategyNetwork.destroy(); _strategyNetwork = null; }

  data.variants.forEach(function(v, idx) {
    var m = varMetrics[v.id];
    if (!m || !m.equity_curve || m.equity_curve.length === 0) return;
    var canvas = document.getElementById('var-chart-' + idx);
    if (!canvas) return;
    var values = m.equity_curve.map(function(p) { return p.cumulative_pnl; });
    var labels = m.equity_curve.map(function(p) { return ''; });
    var color = values[values.length - 1] >= 0 ? '#22c55e' : '#ef4444';
    var bgColor = values[values.length - 1] >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: [{ data: values, borderColor: color, backgroundColor: bgColor, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, interaction: { enabled: false } }
    });
    _strategyCharts.push(chart);
  });

  // View toggle: Grid / Tree (tree only shown if >= 2 variants)
  document.getElementById('btn-view-grid').onclick = function() {
    document.getElementById('variants-grid').classList.remove('hidden');
    var treeEl = document.getElementById('variants-tree');
    if (treeEl) treeEl.classList.add('hidden');
    this.className = 'text-sm px-3 py-1.5 rounded-lg border transition bg-blue-600 border-blue-500 text-white';
    var treeBtn = document.getElementById('btn-view-tree');
    if (treeBtn) treeBtn.className = 'text-sm px-3 py-1.5 rounded-lg border transition border-slate-600 text-slate-400 hover:text-white';
  };
  var btnViewTree = document.getElementById('btn-view-tree');
  if (btnViewTree) {
    btnViewTree.onclick = function() {
      document.getElementById('variants-tree').classList.remove('hidden');
      document.getElementById('variants-grid').classList.add('hidden');
      this.className = 'text-sm px-3 py-1.5 rounded-lg border transition bg-blue-600 border-blue-500 text-white';
      document.getElementById('btn-view-grid').className = 'text-sm px-3 py-1.5 rounded-lg border transition border-slate-600 text-slate-400 hover:text-white';
      if (!_strategyNetwork) {
        renderStrategyGraph('strategy-graph', data.variants, varMetrics);
      }
    };
  }

  // ── Handlers stratégie ──────────────────────────────────────
  document.getElementById('btn-edit-strat').onclick = function() {
    showModal('Modifier la Stratégie',
      inputField('name', 'Nom', 'text', true, data.name) +
      textareaField('description', 'Description', false, data.description) +
      inputField('pairs', 'Paires (séparées par des virgules)', 'text', true, (data.pairs || []).join(', ')) +
      inputField('timeframes_input', 'Timeframes (séparées par des virgules)', 'text', true, (data.timeframes || []).join(', ')),
      async function(fd) {
        var pairsStr = fd.get('pairs') || '';
        var tfsStr = fd.get('timeframes_input') || '';
        await API.put('/strategies/' + id, {
          name: fd.get('name'), description: fd.get('description'),
          pairs: pairsStr.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean),
          timeframes: tfsStr.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean),
        });
        await loadSidebar();
        route();
      }
    );
  };

  document.getElementById('btn-del-strat').onclick = async function() {
    if (confirm('Supprimer cette stratégie et toutes ses variantes ?')) {
      await API.del('/strategies/' + id);
      await loadSidebar();
      location.hash = '#/';
    }
  };

  // Fonction partagée : ouvre le modal "Tester une modification"
  function openNewIterationModal(defaultParentOverride) {
    var activeVar = data.variants.find(function(v) { return v.status === 'active'; });
    var defaultParentId = defaultParentOverride !== undefined ? defaultParentOverride : (activeVar ? activeVar.id : '');
    // Auto-name : "Itération N"
    var iterCount = data.variants.length + 1;
    var autoName = 'Itération ' + iterCount;
    var parentOpts = [{value:'', label:'— Aucune (racine) —'}]
      .concat(data.variants.map(function(v) {
        return {value: v.id, label: (STATUS_LABELS[v.status] ? '[' + STATUS_LABELS[v.status] + '] ' : '') + v.name};
      }));
    var statusOpts = [
      {value:'idea',label:'Idée'},{value:'ready_to_test',label:'Prêt à tester'},
      {value:'testing',label:'En test'},{value:'active',label:'Active'},
      {value:'validated',label:'Validée'},{value:'rejected',label:'Rejetée'},
      {value:'archived',label:'Archivée'}
    ];
    var advancedHtml =
      '<div class="mt-4 pt-3 border-t border-slate-700/60">' +
        '<button type="button" id="btn-advanced-toggle" class="text-xs text-slate-500 hover:text-slate-300 transition flex items-center gap-1.5 mb-3">' +
          '<span id="advanced-arrow" class="text-[10px]">▶</span> Options avancées' +
        '</button>' +
        '<div id="advanced-fields" class="hidden space-y-0">' +
          richTextField('description', 'Description') +
          richTextField('hypothesis', 'Hypothèse détaillée') +
          richTextField('changes', 'Changements techniques') +
          richTextField('decision', 'Conclusion après test') +
          selectField('parent_variant_id', 'Variante de base' + (activeVar ? ' (auto : ' + esc(activeVar.name) + ')' : ''), parentOpts, defaultParentId) +
          selectField('status', 'Statut', statusOpts, 'idea') +
        '</div>' +
      '</div>';

    // Deux boutons de submit : Créer / Créer et importer
    var customFooter =
      '<div class="flex justify-end gap-3 mt-6">' +
        '<button type="button" id="modal-cancel" class="px-4 py-2 text-sm text-slate-300 hover:text-white transition">Annuler</button>' +
        '<button type="submit" name="_action" value="create" class="px-4 py-2 text-sm border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition">Créer</button>' +
        '<button type="submit" name="_action" value="import" class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Créer et importer un run →</button>' +
      '</div>';

    showModal('Tester une modification',
      inputField('name', 'Nom de l\'itération', 'text', true, autoName) +
      inputField('key_change', 'Changement clé', 'text', false, '', 'Ex : Entrée après close M15 au lieu de wick touch') +
      textareaField('change_reason', 'Pourquoi tu le testes', false) +
      advancedHtml,
      async function(fd, submitBtn) {
        var action = (submitBtn && submitBtn.value) || 'create';
        var resp = await API.post('/variants', {
          strategy_id: id,
          name: fd.get('name'),
          key_change: fd.get('key_change') || '',
          change_reason: fd.get('change_reason') || '',
          description: getRichValue('description'),
          hypothesis: getRichValue('hypothesis'),
          changes: getRichValue('changes'),
          decision: getRichValue('decision'),
          parent_variant_id: fd.get('parent_variant_id') || defaultParentId || null,
          status: fd.get('status') || 'idea',
        });
        await loadSidebar();
        if (action === 'import' && resp && resp.id) {
          location.hash = '#/import/' + resp.id;
        } else {
          route();
        }
      },
      { richText: true, wide: true, customFooter: customFooter }
    );
    setTimeout(function() {
      var toggle = document.getElementById('btn-advanced-toggle');
      if (toggle) {
        toggle.onclick = function() {
          var fields = document.getElementById('advanced-fields');
          var arrow = document.getElementById('advanced-arrow');
          if (fields) {
            fields.classList.toggle('hidden');
            arrow.textContent = fields.classList.contains('hidden') ? '▶' : '▼';
          }
        };
      }
    }, 60);
  }

  // Bouton "Tester une modification" (bloc contexte + barre secondaire)
  document.getElementById('btn-new-var').onclick = function() { openIterationModal(); };
  var btnQuick = document.getElementById('btn-new-var-quick');
  if (btnQuick) btnQuick.onclick = function() { openNewIterationModal(); };
  // Empty state : créer Itération 1 silencieusement et aller vers l'import
  var btnFirstImport = document.getElementById('btn-first-import');
  if (btnFirstImport) {
    btnFirstImport.onclick = async function() {
      var v = await API.post('/variants', {
        strategy_id: id,
        name: 'Itération 1',
        status: 'active',
        key_change: '',
      });
      await loadSidebar();
      location.hash = '#/import/' + v.id;
    };
  }
  var btnCompare = document.getElementById('btn-compare-quick');
  if (btnCompare) {
    btnCompare.onclick = function() {
      var activeVar = data.variants.find(function(v) { return v.status === 'active'; });
      var lastVar = data.variants.length > 0 ? data.variants[0] : null;
      if (activeVar) _compareSlotA = { id: activeVar.id, name: activeVar.name, strategyName: data.name };
      if (lastVar && lastVar.id !== (activeVar && activeVar.id)) _compareSlotB = { id: lastVar.id, name: lastVar.name, strategyName: data.name };
      location.hash = '#/compare';
    };
  }

  function openIterationModal() { openNewIterationModal(); }
}

// ===== PAGE: VARIANT DETAIL =====

async function pageVariant(id) {
  var data = await API.get('/variants/' + id);
  var aggMetrics = data.aggregate_metrics || null;
  var lineage = data.lineage || null;
  var stratName = data.strategy_name || 'Stratégie';
  var parentName = data.parent_variant_name || null;
  saveLastVisit('/variant/' + id, [{ label: 'Stratégies', href: '#/' }, { label: stratName, href: '#/strategy/' + data.strategy_id }, { label: data.name }]);

  // Évaluation de la variante
  var variantEvalHtml = '';
  if (typeof Evaluation !== 'undefined' && aggMetrics && aggMetrics.total_trades > 0) {
    try {
      var _varMetrics = buildVariantMetrics(data, aggMetrics, data.runs || []);
      if (_varMetrics) variantEvalHtml = renderEvaluationPanel(Evaluation.evaluateVariant(_varMetrics), 'Évaluation de la variante');
    } catch(e) {}
  }

  var infoVal = function(val) { return renderRichText(val); };
  var isRoot = !data.parent_variant_id;

  // Helpers : carte statique vs carte éditable au clic
  var staticCard = function(label, valueHtml) {
    return '<div class="bg-slate-700/30 rounded-lg px-4 py-3">' +
      '<div class="text-slate-500 text-xs mb-1">' + esc(label) + '</div>' +
      '<div>' + valueHtml + '</div>' +
    '</div>';
  };
  var editCard = function(field, label, valueHtml) {
    return '<div class="bg-slate-700/30 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-600/30 transition group" data-editfield="' + field + '">' +
      '<div class="text-slate-500 text-xs mb-1 flex items-center gap-1.5">' + esc(label) + '<span class="opacity-0 group-hover:opacity-60 text-[9px] transition">✎</span></div>' +
      '<div class="edit-value">' + valueHtml + '</div>' +
    '</div>';
  };
  var noValue = '<span class="text-slate-600 italic">non renseigné</span>';
  // Pour itération racine : toujours visible = Créée le + Hypothèse + Conclusion
  // Collapsible = Variante de base + Pourquoi + Changements techniques
  // Pour itération dérivée : toujours visible = Créée le + Variante de base
  // Collapsible = ouvert si contenu présent
  var hasCollapsibleContent = isRoot
    ? !!(data.change_reason || data.changes)
    : !!(data.change_reason || data.hypothesis || data.changes || data.decision || data.description);

  var alwaysVisible = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm mt-4">' +
    (data.key_change ? editCard('key_change', '\u0394 Changement cl\u00e9',
      '<span class="text-blue-200 font-medium">' + esc(data.key_change) + '</span>').replace('bg-slate-700/30', 'bg-blue-900/20 border border-blue-700/40') : '') +
    staticCard('Cr\u00e9\u00e9e le', '<span class="text-slate-300">' + formatDate(data.created_at) + '</span>') +
    (!isRoot ? staticCard('Variante de base',
      parentName ? '<a href="#/variant/' + data.parent_variant_id + '" class="text-blue-400 hover:text-blue-300">' + esc(parentName) + '</a>' : '<span class="text-slate-600 italic">aucune (racine)</span>'
    ) : '') +
    (isRoot ? editCard('hypothesis', 'Hypoth\u00e8se test\u00e9e', data.hypothesis ? infoVal(data.hypothesis) : noValue) : '') +
    (isRoot ? editCard('decision', 'Conclusion apr\u00e8s test', data.decision ? infoVal(data.decision) : noValue) : '') +
  '</div>';

  var collapsibleFields = isRoot
    ? editCard('change_reason', 'Pourquoi ce test', data.change_reason ? infoVal(data.change_reason) : noValue) +
      editCard('changes', 'Changements techniques', data.changes ? infoVal(data.changes) : noValue)
    : staticCard('Variante de base',
        parentName ? '<a href="#/variant/' + data.parent_variant_id + '" class="text-blue-400 hover:text-blue-300">' + esc(parentName) + '</a>' : '<span class="text-slate-600 italic">aucune (racine)</span>'
      ) +
      editCard('change_reason', 'Pourquoi ce test', data.change_reason ? infoVal(data.change_reason) : noValue) +
      editCard('hypothesis', 'Hypoth\u00e8se test\u00e9e', data.hypothesis ? infoVal(data.hypothesis) : noValue) +
      editCard('changes', 'Changements techniques', data.changes ? infoVal(data.changes) : noValue) +
      editCard('decision', 'Conclusion apr\u00e8s test', data.decision ? infoVal(data.decision) : noValue);

  var infoCards = alwaysVisible +
  '<div class="mt-3">' +
    '<button id="btn-toggle-text-fields" class="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition mb-2">' +
      '<span id="text-fields-arrow" class="text-[10px]">' + (hasCollapsibleContent ? '▼' : '▶') + '</span>' +
      'Annotations &amp; détails' +
    '</button>' +
    '<div id="var-text-fields" class="' + (hasCollapsibleContent ? '' : 'hidden') + '">' +
      '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">' +
        collapsibleFields +
      '</div>' +
    '</div>' +
  '</div>';

  APP.innerHTML = '<div class="fade-in">' +
    breadcrumb([
      {label:'Stratégies', href:'#/'},
      {label: stratName, href:'#/strategy/' + data.strategy_id},
      {label: data.name}
    ]) +
    '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
      '<div class="flex items-start justify-between mb-2">' +
        '<div>' +
          '<div class="flex items-center gap-3 mb-1">' +
            '<h1 class="text-2xl font-bold text-white">' + esc(data.name) + '</h1>' +
            statusBadge(data.status) +
          '</div>' +
          '<p class="text-slate-400 text-sm">' + renderRichText(data.description) + '</p>' +
        '</div>' +
        '<div class="flex flex-wrap gap-2">' +
          '<button id="btn-compare-var" class="text-sm text-blue-400 hover:text-blue-300 px-3 py-1.5 rounded-lg border border-blue-900 hover:border-blue-700 transition">⚖ Comparer</button>' +
          (data.status !== 'active' ? '<button id="btn-promote-var" class="text-sm text-emerald-400 hover:text-emerald-300 px-3 py-1.5 rounded-lg border border-emerald-900 hover:border-emerald-700 transition">↑ Promouvoir en active</button>' : '') +
          '<button id="btn-duplicate-var" class="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Dupliquer</button>' +
          '<button id="btn-edit-var" class="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Modifier</button>' +
          '<button id="btn-del-var" class="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>' +
        '</div>' +
      '</div>' +
      infoCards +
    '</div>' +
    (lineage ? '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
      '<h2 class="text-lg font-semibold text-white mb-3">Lignée</h2>' +
      '<div class="text-sm">' + renderLineageTree(lineage, id) + '</div>' +
    '</div>' : '') +
    (aggMetrics && aggMetrics.total_trades > 0 ? (function() {
      _currentAvgLoss = aggMetrics.avg_loss;
      var ddPeak = _unitSettings.initial_balance + (aggMetrics.dd_peak_equity || 0);
      var rr = (aggMetrics.avg_win && aggMetrics.avg_loss && aggMetrics.avg_loss !== 0) ? Math.abs(aggMetrics.avg_win / aggMetrics.avg_loss) : null;
      var aggItems = [
        {label:'Total PnL', value: formatPnl(aggMetrics.total_pnl)},
        {label:'Trades', value: aggMetrics.total_trades},
        {label:'Win Rate', value: formatPercent(aggMetrics.win_rate)},
        {label:'Profit Factor', value: aggMetrics.profit_factor != null ? aggMetrics.profit_factor.toFixed(2) : '—'},
        {label:'Max Drawdown', value: formatDrawdown(aggMetrics.max_drawdown, ddPeak)},
        {label:'Expectancy', value: formatPnl(aggMetrics.expectancy)},
        {label:'Avg Win', value: formatPnl(aggMetrics.avg_win)},
        {label:'Avg Loss', value: formatPnl(aggMetrics.avg_loss)},
        {label:'RR Moyen', value: rr != null ? rr.toFixed(2) : '—'},
        {label:'Sharpe (ann.)', value: aggMetrics.sharpe_ratio != null ? aggMetrics.sharpe_ratio.toFixed(2) : '—'},
      ];
      return '<div class="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">' +
        '<h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Métriques agrégées — ' + data.runs.length + ' run' + (data.runs.length > 1 ? 's' : '') + '</h2>' +
        '<div class="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">' +
          aggItems.map(function(it) {
            return '<div class="metric-card bg-slate-700/40 rounded-lg px-3 py-2 text-center">' +
              '<div class="text-xs text-slate-500 mb-0.5">' + it.label + '</div>' +
              '<div class="text-sm font-semibold text-white">' + it.value + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    })() : '') +
    variantEvalHtml +
    '<div class="flex items-center justify-between mb-4">' +
      '<h2 class="text-lg font-semibold text-white">Runs (' + data.runs.length + ')</h2>' +
      '<a href="#/import/' + id + '" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition inline-block">📥 Importer CSV</a>' +
    '</div>' +
    (data.runs.length === 0 ? emptyState('Aucun run importé', 'Importer un CSV', '#/import/' + id) :
    '<div class="space-y-3">' +
      data.runs.map(function(r) {
        _currentAvgLoss = (r.metrics && r.metrics.avg_loss) ? r.metrics.avg_loss : null;
        return '<a href="#/run/' + r.id + '" class="block bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-blue-500/50 transition group">' +
          '<div class="flex items-center justify-between">' +
            '<div>' +
              '<h3 class="font-medium text-white group-hover:text-blue-400 transition">' + esc(r.label) + '</h3>' +
              '<div class="flex gap-3 text-xs text-slate-400 mt-1">' +
                '<span class="uppercase bg-slate-700 px-2 py-0.5 rounded">' + esc(r.type) + '</span>' +
                '<span>' + formatDate(r.start_date) + ' → ' + formatDate(r.end_date) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="text-right">' +
              (r.metrics ?
                '<div class="text-lg font-semibold">' + formatPnl(r.metrics.total_pnl) + '</div>' +
                '<div class="text-xs text-slate-400">' + r.metrics.total_trades + ' trades · WR ' + formatPercent(r.metrics.win_rate) + '</div>'
              : '<span class="text-slate-500 text-sm">Pas de métriques</span>') +
            '</div>' +
          '</div>' +
        '</a>';
      }).join('') +
    '</div>') +
  '</div>';

  // Toggle annotations
  var btnToggleText = document.getElementById('btn-toggle-text-fields');
  if (btnToggleText) {
    var panel = document.getElementById('var-text-fields');
    var arrow = document.getElementById('text-fields-arrow');
    // Initialisation de l'état : si 'hidden' (fermé par défaut), on met max-height 0
    if (panel) {
      var isOpen = !panel.classList.contains('hidden');
      panel.classList.remove('hidden');
      panel.style.overflow = 'hidden';
      panel.style.transition = 'max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease';
      if (isOpen) {
        panel.style.maxHeight = panel.scrollHeight + 'px';
        panel.style.opacity = '1';
      } else {
        panel.style.maxHeight = '0';
        panel.style.opacity = '0';
      }
    }
    btnToggleText.onclick = function() {
      if (!panel) return;
      var opening = panel.style.maxHeight === '0px' || panel.style.maxHeight === '';
      if (opening) {
        // Ouvrir : on mesure d'abord la vraie hauteur
        panel.style.maxHeight = panel.scrollHeight + 'px';
        panel.style.opacity = '1';
        arrow.textContent = '▼';
        // Après l'animation, laisser max-height libre pour les éditeurs inline qui agrandissent le panel
        panel.addEventListener('transitionend', function onEnd() {
          panel.removeEventListener('transitionend', onEnd);
          if (panel.style.opacity === '1') panel.style.maxHeight = 'none';
        });
      } else {
        // Fermer : remettre la hauteur exacte avant de l'animer à 0
        panel.style.maxHeight = panel.scrollHeight + 'px';
        requestAnimationFrame(function() {
          panel.style.maxHeight = '0';
          panel.style.opacity = '0';
        });
        arrow.textContent = '▶';
      }
    };
  }

  // Inline edit au clic sur les cartes data-editfield
  var RICH_FIELDS = { hypothesis: 1, decision: 1, change_reason: 1, changes: 1 };

  document.querySelectorAll('[data-editfield]').forEach(function(card) {
    var field = card.getAttribute('data-editfield');
    card.addEventListener('click', function(e) {
      // Ne rien faire si clic dans l'éditeur déjà ouvert
      if (card.querySelector('.inline-rich-editor,.inline-input')) return;
      if (e.target.closest('.inline-rich-editor,.inline-input')) return;
      var valueDiv = card.querySelector('.edit-value');
      if (!valueDiv) return;
      var currentHtml = data[field] ? normalizeRichValue(data[field]) : '';

      if (RICH_FIELDS[field]) {
        // --- Rich text inline editor ---
        valueDiv.innerHTML =
          '<div class="inline-rich-editor">' +
            '<div class="rich-toolbar inline-rich-toolbar">' +
              '<button type="button" data-cmd="bold" title="Gras (Ctrl+B)"><strong>G</strong></button>' +
              '<button type="button" data-cmd="italic" title="Italique (Ctrl+I)"><em>I</em></button>' +
              '<button type="button" data-cmd="underline" title="Souligné (Ctrl+U)"><u>S</u></button>' +
              '<span class="rich-sep"></span>' +
              '<button type="button" data-cmd="insertUnorderedList" title="Puces">• ≡</button>' +
              '<button type="button" data-cmd="insertOrderedList" title="Numérotée">1.</button>' +
            '</div>' +
            '<div class="rich-content inline-rich-content" contenteditable="true"></div>' +
            '<div class="inline-rich-footer px-2 py-1 flex items-center justify-between border-t border-slate-700">' +
              '<span class="text-xs text-slate-500">Ctrl+↵ &middot; Échap pour annuler</span>' +
              '<button type="button" class="inline-save-btn text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition">Valider ✓</button>' +
            '</div>' +
          '</div>';

        var wrapper = valueDiv.querySelector('.inline-rich-editor');
        var content = valueDiv.querySelector('.inline-rich-content');
        content.innerHTML = currentHtml;
        content.focus();
        // place cursor at end
        var range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);

        // Toolbar buttons
        wrapper.querySelectorAll('button[data-cmd]').forEach(function(btn) {
          btn.addEventListener('mousedown', function(ev) {
            ev.preventDefault();
            content.focus();
            document.execCommand(btn.getAttribute('data-cmd'), false, null);
          });
        });

        // Notion-style shortcuts
        content.addEventListener('input', function() { handleNotionShortcuts(content, wrapper); });

        // Keyboard shortcuts
        content.addEventListener('keydown', function(ev) {
          if (ev.key === 'Tab') {
            var node = ev.target;
            if (node && node.closest && node.closest('li')) { ev.preventDefault(); document.execCommand(ev.shiftKey ? 'outdent' : 'indent', false, null); }
          }
        });

        // Bouton Valider
        var saveBtn = wrapper.querySelector('.inline-save-btn');
        if (saveBtn) {
          saveBtn.addEventListener('mousedown', function(ev) {
            ev.preventDefault(); // ne pas perdre le focus du contenteditable immédiatement
            ev.stopPropagation();
          });
          saveBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            saveRich();
          });
        }

        var saved = false;
        async function saveRich() {
          if (saved) return; saved = true;
          var newVal = content.innerHTML.trim();
          // Vide si pas de texte réel (gère <br>, <p><br></p>, etc.)
          if (!content.textContent.trim()) newVal = '';
          else if (newVal === '<br>') newVal = '';
          var patch = {}; patch[field] = newVal;
          try { await API.put('/variants/' + id, patch); data[field] = newVal; } catch(e) {}
          valueDiv.innerHTML = newVal ? renderRichText(newVal) : '<span class="text-slate-600 italic">non renseigné</span>';
        }

        // Sauvegarder quand le focus quitte l'éditeur
        function onFocusOut(ev) {
          if (!wrapper.contains(ev.relatedTarget)) {
            document.removeEventListener('focusin', onFocusOut, true);
            saveRich();
          }
        }
        // focusin sur tout le doc pour détecter le clic ailleurs (toolbar incluse)
        setTimeout(function() {
          document.addEventListener('focusin', function handler(ev) {
            if (!card.contains(ev.target)) {
              document.removeEventListener('focusin', handler, true);
              saveRich();
            }
          }, true);
        }, 0);

        content.addEventListener('keydown', function(ev) {
          if (ev.key === 'Escape') {
            saved = true;
            valueDiv.innerHTML = currentHtml ? renderRichText(currentHtml) : '<span class="text-slate-600 italic">non renseigné</span>';
          }
          if (ev.key === 'Enter' && ev.ctrlKey) {
            ev.preventDefault();
            saveRich();
          }
        });

      } else {
        // --- Champ texte simple (key_change) ---
        valueDiv.innerHTML = '';
        var input = document.createElement('input');
        input.type = 'text';
        input.value = richTextPlain(data[field]) || '';
        input.className = 'inline-input w-full bg-slate-700 text-slate-200 text-sm rounded px-2 py-1 outline-none border border-blue-500';
        valueDiv.appendChild(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        var savedSimple = false;
        async function saveSimple() {
          if (savedSimple) return; savedSimple = true;
          var newVal = input.value.trim();
          var patch = {}; patch[field] = newVal;
          try { await API.put('/variants/' + id, patch); data[field] = newVal; } catch(e) {}
          valueDiv.innerHTML = newVal ? '<span class="text-blue-200 font-medium">' + esc(newVal) + '</span>' : '<span class="text-slate-600 italic">non renseigné</span>';
        }
        input.addEventListener('blur', saveSimple);
        input.addEventListener('keydown', function(ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
          if (ev.key === 'Escape') {
            savedSimple = true;
            var orig = richTextPlain(data[field]) || '';
            valueDiv.innerHTML = orig ? '<span class="text-blue-200 font-medium">' + esc(orig) + '</span>' : '<span class="text-slate-600 italic">non renseigné</span>';
          }
        });
      }
    });
  });

  document.getElementById('btn-edit-var').onclick = function() {
    var statusOpts = [
      {value:'idea',label:'Idée'},{value:'ready_to_test',label:'Prêt à tester'},
      {value:'testing',label:'En test'},{value:'active',label:'Active'},
      {value:'validated',label:'Validée'},{value:'rejected',label:'Rejetée'},
      {value:'archived',label:'Archivée'},{value:'abandoned',label:'Abandonnée'},
    ];
    showModal('Modifier l\'itération',
      inputField('name', 'Nom', 'text', true, data.name) +
      inputField('key_change', 'Changement clé', 'text', false, data.key_change || '', 'Ex : Entrée après close M15 au lieu de wick touch') +
      textareaField('change_reason', 'Pourquoi ce test', false, richTextPlain(data.change_reason)) +
      richTextField('description', 'Description', data.description) +
      richTextField('hypothesis', 'Hypothèse testée', data.hypothesis) +
      richTextField('changes', 'Changements techniques', data.changes) +
      richTextField('decision', 'Conclusion après test', data.decision) +
      selectField('status', 'Statut', statusOpts, data.status),
      async function(fd) {
        await API.put('/variants/' + id, {
          name: fd.get('name'),
          key_change: fd.get('key_change') || '',
          change_reason: fd.get('change_reason') || '',
          description: getRichValue('description'),
          hypothesis: getRichValue('hypothesis'),
          changes: getRichValue('changes'),
          decision: getRichValue('decision'),
          status: fd.get('status'),
        });
        await loadSidebar();
        route();
      },
      { richText: true, wide: true }
    );
  };

  document.getElementById('btn-duplicate-var').onclick = function() {
    showModal('Dupliquer cette itération',
      inputField('name', 'Nom de la nouvelle itération', 'text', true, 'Copie — ' + data.name) +
      inputField('key_change', 'Changement clé', 'text', false, '', 'Qu\'est-ce qui change par rapport à la version précédente ?') +
      textareaField('change_reason', 'Pourquoi tu le testes', false),
      async function(fd) {
        await API.post('/variants', {
          strategy_id: data.strategy_id,
          name: fd.get('name'),
          key_change: fd.get('key_change') || '',
          change_reason: fd.get('change_reason') || '',
          description: data.description || '',
          hypothesis: data.hypothesis || '',
          changes: data.changes || '',
          decision: '',
          parent_variant_id: data.id,
          status: 'idea',
        });
        await loadSidebar();
        route();
      }
    );
  };

  document.getElementById('btn-compare-var').onclick = function() {
    _compareSlotA = { id: data.id, name: data.name, strategyName: stratName };
    location.hash = '#/compare';
  };

  var btnPromote = document.getElementById('btn-promote-var');
  if (btnPromote) {
    btnPromote.onclick = async function() {
      if (!confirm('Promouvoir "' + data.name + '" comme version active ?')) return;
      await API.put('/variants/' + id, { status: 'active' });
      await loadSidebar();
      route();
    };
  }

  document.getElementById('btn-del-var').onclick = async function() {
    if (confirm('Supprimer cette variante ?')) {
      await API.del('/variants/' + id);
      await loadSidebar();
      location.hash = '#/strategy/' + data.strategy_id;
    }
  };
}

function renderLineageTree(node, currentId, depth) {
  depth = depth || 0;
  var isCurrent = node.id === currentId;
  var indent = depth * 24;
  var html = '<div style="margin-left:' + indent + 'px" class="flex items-center gap-2 py-1">' +
    (depth > 0 ? '<span class="text-slate-600">└─</span>' : '') +
    '<a href="#/variant/' + node.id + '" class="' + (isCurrent ? 'text-blue-400 font-semibold' : 'text-slate-300 hover:text-white') + ' transition">' +
      esc(node.name) +
    '</a> ' +
    statusBadge(node.status) +
  '</div>';
  if (node.children) {
    node.children.forEach(function(c) { html += renderLineageTree(c, currentId, depth + 1); });
  }
  return html;
}

// ===== PAGE: RUN DETAIL =====

async function pageRun(id) {
  var data = await API.get('/runs/' + id);
  var m = data.metrics || {};

  var variantName = 'Variante', stratId = '', stratName = 'Stratégie';
  try {
    var variant = await API.get('/variants/' + data.variant_id);
    variantName = variant.name;
    stratId = variant.strategy_id;
    stratName = variant.strategy_name || 'Stratégie';
  } catch(e) {}
  saveLastVisit('/run/' + id, [{ label: 'Stratégies', href: '#/' }, { label: stratName, href: '#/strategy/' + stratId }, { label: variantName, href: '#/variant/' + data.variant_id }, { label: data.label }]);

  _currentAvgLoss = m.avg_loss;
  var _ddPeak = _unitSettings.initial_balance + (m.dd_peak_equity || 0);
  var metrics = [
    {label: 'Total PnL', value: formatPnl(m.total_pnl)},
    {label: 'Trades', value: m.total_trades || 0},
    {label: 'Win Rate', value: formatPercent(m.win_rate)},
    {label: 'Profit Factor', value: m.profit_factor != null ? m.profit_factor.toFixed(2) : '—'},
    {label: 'Max Drawdown', value: formatDrawdown(m.max_drawdown, _ddPeak)},
    {label: 'Expectancy', value: formatPnl(m.expectancy)},
    {label: 'Avg Win', value: formatPnl(m.avg_win)},
    {label: 'Avg Loss', value: formatPnl(m.avg_loss)},
    {label: 'Best Trade', value: formatPnl(m.best_trade)},
    {label: 'Worst Trade', value: formatPnl(m.worst_trade)},
    {label: 'Sharpe (ann.)', value: m.sharpe_ratio != null ? m.sharpe_ratio.toFixed(2) : '—'},
  ];

  // Évaluation du run
  var runEvalHtml = '';
  if (typeof Evaluation !== 'undefined' && m.total_trades !== undefined) {
    try {
      var _runMetrics = buildRunMetrics(data);
      runEvalHtml = renderEvaluationPanel(Evaluation.evaluateRun(_runMetrics), 'Évaluation du run');
    } catch(e) {}
  }

  APP.innerHTML = '<div class="fade-in">' +
    breadcrumb([
      {label:'Stratégies', href:'#/'},
      {label: stratName, href:'#/strategy/' + stratId},
      {label: variantName, href:'#/variant/' + data.variant_id},
      {label: data.label}
    ]) +
    '<div class="flex items-center justify-between mb-6">' +
      '<div>' +
        '<h1 class="text-2xl font-bold text-white">' + esc(data.label) + '</h1>' +
        '<div class="flex gap-3 text-sm text-slate-400 mt-1">' +
          '<span class="uppercase bg-slate-700 px-2 py-0.5 rounded text-xs">' + esc(data.type) + '</span>' +
          '<span>' + formatDate(data.start_date) + ' → ' + formatDate(data.end_date) + '</span>' +
        '</div>' +
      '</div>' +
      '<button id="btn-del-run" class="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>' +
    '</div>' +
    '<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">' +
      metrics.map(function(mi) {
        return '<div class="metric-card bg-slate-800 border border-slate-700 rounded-xl p-4">' +
          '<div class="text-xs text-slate-400 mb-1">' + mi.label + '</div>' +
          '<div class="text-lg font-semibold">' + mi.value + '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
    runEvalHtml +
    '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h2 class="text-lg font-semibold text-white">Equity Curve</h2>' +
        '<div class="flex items-center gap-3">' +
          (m.max_drawdown > 0 ? '<label class="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none"><input type="checkbox" id="dd-highlight" class="accent-red-500"> Max Drawdown</label>' : '') +
          '<button id="btn-reset-zoom" class="hidden text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition">Reset zoom</button>' +
        '</div>' +
      '</div>' +
      '<div style="height:300px"><canvas id="equity-chart"></canvas></div>' +
    '</div>' +
    '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6">' +
      '<h2 class="text-lg font-semibold text-white mb-4">Trades (' + data.trades.length + ')</h2>' +
      '<div class="overflow-x-auto max-h-96">' +
        '<table class="w-full text-sm"><thead><tr class="text-left text-slate-400 border-b border-slate-700">' +
          '<th class="py-2 px-3 bg-slate-800">Open</th><th class="py-2 px-3 bg-slate-800">Close</th>' +
          '<th class="py-2 px-3 bg-slate-800">Symbol</th><th class="py-2 px-3 bg-slate-800">Side</th>' +
          '<th class="py-2 px-3 bg-slate-800">Entry</th><th class="py-2 px-3 bg-slate-800">Exit</th>' +
          '<th class="py-2 px-3 bg-slate-800">Lots</th><th class="py-2 px-3 bg-slate-800">PnL</th>' +
          '<th class="py-2 px-3 bg-slate-800">Pips</th></tr></thead><tbody>' +
          (function() {
            var cumPnl = 0;
            return data.trades.map(function(t) {
              var pnlBefore = cumPnl;
              cumPnl += (t.pnl || 0);
              return '<tr class="border-b border-slate-700/50 hover:bg-slate-700/30">' +
                '<td class="py-2 px-3 text-slate-300">' + formatDateTime(t.open_time) + '</td>' +
                '<td class="py-2 px-3 text-slate-300">' + formatDateTime(t.close_time) + '</td>' +
                '<td class="py-2 px-3">' + esc(t.symbol) + '</td>' +
                '<td class="py-2 px-3"><span class="' + (t.side === 'long' ? 'text-green-400' : 'text-red-400') + '">' + esc(t.side) + '</span></td>' +
                '<td class="py-2 px-3">' + t.entry_price + '</td>' +
                '<td class="py-2 px-3">' + t.exit_price + '</td>' +
                '<td class="py-2 px-3">' + t.lot_size + '</td>' +
                '<td class="py-2 px-3">' + formatPnl(t.pnl, _unitSettings.initial_balance + pnlBefore) + '</td>' +
                '<td class="py-2 px-3">' + (t.pips != null ? t.pips : '—') + '</td>' +
              '</tr>';
            }).join('');
          })() +
        '</tbody></table></div>' +
    '</div>' +
  '</div>';

  // Equity curve chart
  if (m.equity_curve && m.equity_curve.length > 0) {
    var ctx = document.getElementById('equity-chart').getContext('2d');
    var labels = m.equity_curve.map(function(p) { return formatDate(p.date); });
    var values = m.equity_curve.map(function(p) { return p.cumulative_pnl; });
    var color = values[values.length - 1] >= 0 ? '#22c55e' : '#ef4444';
    var bgColor = values[values.length - 1] >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

    // Drawdown highlight dataset (hidden by default)
    // Recalcul du DD directement depuis l'equity curve
    // Le peak démarre à 0 (capital initial), comme dans le backend
    var ddData = values.map(function() { return null; });
    var ddStartIdx = -1, ddEndIdx = 0, ddMax = 0, peakVal = 0, peakIdx = -1;
    for (var di = 0; di < values.length; di++) {
      if (values[di] > peakVal) { peakVal = values[di]; peakIdx = di; }
      var dd = peakVal - values[di];
      if (dd > ddMax) { ddMax = dd; ddStartIdx = peakIdx; ddEndIdx = di; }
    }
    if (ddMax > 0) {
      var from = ddStartIdx >= 0 ? ddStartIdx : 0;
      for (var dj = from; dj <= ddEndIdx; dj++) {
        ddData[dj] = values[dj];
      }
    }

    var _isZoomed = false;
    var equityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'PnL Cumulé', data: values, borderColor: color, backgroundColor: bgColor, fill: true, tension: 0.3, pointRadius: 3, pointHoverRadius: 6 },
          { label: 'Max Drawdown', data: ddData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.25)', fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#ef4444', borderWidth: 2, borderDash: [4, 2], hidden: true }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          zoom: {
            zoom: {
              drag: { enabled: true, backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)', borderWidth: 1 },
              mode: 'x',
              onZoom: function() {
                _isZoomed = true;
                var btn = document.getElementById('btn-reset-zoom');
                if (btn) btn.classList.remove('hidden');
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }
        }
      }
    });

    var btnReset = document.getElementById('btn-reset-zoom');
    if (btnReset) {
      btnReset.onclick = function() {
        equityChart.resetZoom();
        _isZoomed = false;
        btnReset.classList.add('hidden');
      };
    }

    var ddCheckbox = document.getElementById('dd-highlight');
    if (ddCheckbox) {
      ddCheckbox.onchange = function() {
        equityChart.data.datasets[1].hidden = !this.checked;
        equityChart.update();
      };
    }
  }

  document.getElementById('btn-del-run').onclick = async function() {
    if (confirm('Supprimer ce run ?')) {
      await API.del('/runs/' + id);
      location.hash = '#/variant/' + data.variant_id;
    }
  };
}

// ===== PAGE: IMPORT CSV =====

var _csvFile = null;
var _selectedFormat = 'manual';

async function pageImport(variantId) {
  _csvFile = null;
  var variant = await API.get('/variants/' + variantId);
  var strat = null;
  var stratName = 'Stratégie';
  try {
    strat = await API.get('/strategies/' + variant.strategy_id);
    stratName = strat.name;
  } catch(e) {}
  var stratVariantsCount = strat && strat.variants ? strat.variants.length : 2; // 2 = affiche le lien variante par défaut

  var fields = ['open_time','close_time','symbol','side','entry_price','exit_price','lot_size','pnl','pips'];
  var fieldLabels = {
    open_time: 'Open Time', close_time: 'Close Time', symbol: 'Symbol',
    side: 'Side (Type)', entry_price: 'Entry Price', exit_price: 'Exit Price',
    lot_size: 'Lot Size', pnl: 'PnL (Profit)', pips: 'Pips (optionnel)'
  };
  // Breadcrumb simplifié si une seule variante (l'utilisateur n'a pas à savoir ce que c'est)
  var crumbs = stratVariantsCount <= 1
    ? [ {label:'Stratégies', href:'#/'}, {label: stratName, href:'#/strategy/' + variant.strategy_id}, {label: 'Import CSV'} ]
    : [ {label:'Stratégies', href:'#/'}, {label: stratName, href:'#/strategy/' + variant.strategy_id}, {label: variant.name, href:'#/variant/' + variantId}, {label: 'Import CSV'} ];

  APP.innerHTML = '<div class="fade-in">' +
    breadcrumb(crumbs) +
    '<h1 class="text-2xl font-bold text-white mb-6">Importer un CSV</h1>' +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
      '<div>' +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">' +
          inputField('label', 'Nom de la run') +
          selectField('run_type', 'Type', [
            {value:'backtest',label:'Backtest'},
            {value:'forward',label:'Forward Test'},
            {value:'live',label:'Live'}
          ]) +
        '</div>' +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">' +
          '<label class="text-sm text-slate-400 block mb-3">Format d\'import</label>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div id="fmt-manual" class="format-card cursor-pointer rounded-xl border-2 ' + (_selectedFormat === 'manual' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-slate-700/50') + ' p-4 text-center transition">' +
              '<div class="text-2xl mb-2">📝</div>' +
              '<div class="text-sm font-semibold text-white">Manuel</div>' +
              '<p class="text-xs text-slate-400 mt-1">Mapping personnalisé</p>' +
            '</div>' +
            '<div id="fmt-fxreplay" class="format-card cursor-pointer rounded-xl border-2 ' + (_selectedFormat === 'fxreplay' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-600 bg-slate-700/50') + ' p-4 text-center transition">' +
              '<div class="mb-2"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" class="inline-block"><rect width="32" height="32" rx="6" fill="#F59E0B"/><path d="M13 9l10 7-10 7V9z" fill="white"/></svg></div>' +
              '<div class="text-sm font-semibold text-white">FX Replay</div>' +
              '<p class="text-xs text-slate-400 mt-1">Colonnes auto-mappées</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="drop-zone" class="drop-zone bg-slate-800 rounded-xl p-12 text-center cursor-pointer mb-4">' +
          '<div class="text-4xl mb-3">📁</div>' +
          '<p class="text-slate-300 mb-1">Glisser-déposer un fichier CSV ici</p>' +
          '<p class="text-slate-500 text-sm">ou cliquer pour sélectionner</p>' +
          '<input type="file" id="file-input" accept=".csv" class="hidden">' +
        '</div>' +
        '<div id="file-info" class="hidden bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">' +
          '<div class="flex items-center justify-between">' +
            '<span id="file-name" class="text-sm text-white"></span>' +
            '<button id="btn-clear-file" class="text-xs text-red-400 hover:text-red-300">✕ Retirer</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div>' +
        '<div id="mapping-section" class="hidden bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">' +
          '<h3 class="text-sm font-semibold text-white mb-3">Mapping des colonnes</h3>' +
          '<div id="mapping-fields">' +
            fields.map(function(f) {
              return '<div class="flex items-center gap-3 mb-2">' +
                '<label class="text-xs text-slate-400 w-28">' + fieldLabels[f] + '</label>' +
                '<select name="map_' + f + '" class="mapping-select flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"><option value="">— Non mappé —</option></select>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="preview-section" class="hidden mt-6"><div class="bg-slate-800 border border-slate-700 rounded-xl p-6">' +
      '<h3 class="text-sm font-semibold text-white mb-3">Aperçu (5 premières lignes)</h3>' +
      '<div id="preview-table" class="overflow-x-auto"></div>' +
    '</div></div>' +
    '<div id="import-section" class="hidden mt-6">' +
      '<button id="btn-import" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-sm font-semibold transition">📥 Importer les trades</button>' +
    '</div>' +
    '<div id="result-section" class="hidden mt-6"></div>' +
  '</div>';

  // Drag & drop for CSV file
  var dropZone = document.getElementById('drop-zone');
  var fileInput = document.getElementById('file-input');
  dropZone.onclick = function() { fileInput.click(); };
  dropZone.ondragover = function(e) { e.preventDefault(); dropZone.classList.add('drag-over'); };
  dropZone.ondragleave = function() { dropZone.classList.remove('drag-over'); };
  dropZone.ondrop = function(e) { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0], fields); };
  fileInput.onchange = function() { if (fileInput.files[0]) handleFile(fileInput.files[0], fields); };

  document.getElementById('btn-clear-file').onclick = function() {
    _csvFile = null;
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('mapping-section').classList.add('hidden');
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('import-section').classList.add('hidden');
    dropZone.classList.remove('hidden');
  };

  // Format preset handlers
  document.getElementById('fmt-manual').onclick = function() {
    _selectedFormat = 'manual';
    document.getElementById('fmt-manual').className = 'format-card cursor-pointer rounded-xl border-2 border-blue-500 bg-blue-500/10 p-4 text-center transition';
    document.getElementById('fmt-fxreplay').className = 'format-card cursor-pointer rounded-xl border-2 border-slate-600 bg-slate-700/50 p-4 text-center transition';
    if (_csvFile) handleFile(_csvFile, fields);
  };
  document.getElementById('fmt-fxreplay').onclick = function() {
    _selectedFormat = 'fxreplay';
    document.getElementById('fmt-fxreplay').className = 'format-card cursor-pointer rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4 text-center transition';
    document.getElementById('fmt-manual').className = 'format-card cursor-pointer rounded-xl border-2 border-slate-600 bg-slate-700/50 p-4 text-center transition';
    if (_csvFile) handleFile(_csvFile, fields);
  };

  document.getElementById('btn-import').onclick = async function() {
    var label = document.querySelector('[name=label]').value.trim();
    var runType = document.querySelector('[name=run_type]').value;
    if (!label) return alert('Le label est requis');
    if (!_csvFile) return alert('Aucun fichier sélectionné');

    var mapping = {};
    var hasMapping = false;
    document.querySelectorAll('.mapping-select').forEach(function(sel) {
      var field = sel.name.replace('map_', '');
      if (sel.value) { mapping[field] = sel.value; hasMapping = true; }
    });

    var fd = new FormData();
    fd.append('variant_id', variantId);
    fd.append('label', label);
    fd.append('type', runType);
    fd.append('file', _csvFile);
    if (hasMapping) fd.append('column_mapping', JSON.stringify(mapping));

    var btn = document.getElementById('btn-import');
    btn.disabled = true;
    btn.textContent = 'Import en cours...';

    try {
      var result = await API.upload('/runs/import', fd);
      document.getElementById('import-section').classList.add('hidden');
      var rs = document.getElementById('result-section');
      rs.classList.remove('hidden');
      _currentAvgLoss = result.metrics.avg_loss;
      rs.innerHTML = '<div class="bg-green-900/30 border border-green-700 rounded-xl p-6">' +
        '<h3 class="text-lg font-semibold text-green-400 mb-3">✅ Import réussi</h3>' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">' +
          '<div><span class="text-slate-400">Trades importés</span><br><span class="text-white font-semibold">' + result.nb_trades_imported + '</span></div>' +
          '<div><span class="text-slate-400">Total PnL</span><br>' + formatPnl(result.metrics.total_pnl) + '</div>' +
          '<div><span class="text-slate-400">Win Rate</span><br><span class="text-white">' + formatPercent(result.metrics.win_rate) + '</span></div>' +
          '<div><span class="text-slate-400">Profit Factor</span><br><span class="text-white">' + (result.metrics.profit_factor != null ? result.metrics.profit_factor : '—') + '</span></div>' +
        '</div>' +
        (result.warnings.length > 0 ?
          '<div class="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mt-3">' +
            '<p class="text-yellow-400 text-sm font-medium mb-1">⚠️ Warnings</p>' +
            '<ul class="text-xs text-yellow-300 list-disc list-inside">' +
              result.warnings.map(function(w) { return '<li>' + esc(w) + '</li>'; }).join('') +
            '</ul></div>' : '') +
        '<a href="#/run/' + result.run_id + '" class="inline-block mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">Voir le run →</a>' +
      '</div>';
      await loadSidebar();
    } catch (err) {
      alert('Erreur: ' + err.message);
      btn.disabled = false;
      btn.textContent = '📥 Importer les trades';
    }
  };
}

function handleFile(file, fields) {
  if (!file || !file.name.toLowerCase().endsWith('.csv')) return alert('Fichier CSV requis');
  _csvFile = file;
  document.getElementById('file-name').textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' Ko)';
  document.getElementById('file-info').classList.remove('hidden');
  document.getElementById('drop-zone').classList.add('hidden');

  var defaults;
  if (_selectedFormat === 'fxreplay') {
    defaults = {
      open_time: 'dateStart', close_time: 'dateEnd', symbol: 'pair',
      side: 'side', entry_price: 'entryPrice', exit_price: 'avgClosePrice',
      lot_size: 'amount', pnl: 'rPnL'
    };
  } else {
    defaults = {
      open_time: 'Open Time', close_time: 'Close Time', symbol: 'Symbol',
      side: 'Type', entry_price: 'Entry', exit_price: 'Exit',
      lot_size: 'Lots', pnl: 'Profit', pips: 'Pips'
    };
  }

  Papa.parse(file, {
    header: true,
    preview: 6,
    complete: function(results) {
      var columns = results.meta.fields || [];
      document.querySelectorAll('.mapping-select').forEach(function(sel) {
        var field = sel.name.replace('map_', '');
        sel.innerHTML = '<option value="">— Non mappé —</option>' +
          columns.map(function(c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        if (defaults[field] && columns.indexOf(defaults[field]) !== -1) {
          sel.value = defaults[field];
        }
      });
      document.getElementById('mapping-section').classList.remove('hidden');

      if (results.data.length > 0) {
        var html = '<table class="w-full text-xs"><thead><tr class="text-slate-400 border-b border-slate-700">';
        columns.forEach(function(c) { html += '<th class="py-2 px-2 text-left bg-slate-800">' + esc(c) + '</th>'; });
        html += '</tr></thead><tbody>';
        results.data.slice(0, 5).forEach(function(row) {
          html += '<tr class="border-b border-slate-700/50">';
          columns.forEach(function(c) { html += '<td class="py-1.5 px-2 text-slate-300">' + esc(row[c]) + '</td>'; });
          html += '</tr>';
        });
        html += '</tbody></table>';
        document.getElementById('preview-table').innerHTML = html;
        document.getElementById('preview-section').classList.remove('hidden');
      }
      document.getElementById('import-section').classList.remove('hidden');
    },
    error: function(err) { alert('Erreur de parsing: ' + err.message); }
  });
}

// ===== PAGE: COMPARE (with drag & drop support) =====

var _compareChart = null;
var _compareSlotA = null;
var _compareSlotB = null;
var _comparePeriodMode = 'common'; // 'common' | 'individual'
var _temporalCountChart = null;
var _temporalPnlChart = null;
var _temporalTradesA = [];
var _temporalTradesB = [];
var _temporalNameA = '';
var _temporalNameB = '';

function getBucketKey(dateStr, granularity) {
  var d = new Date(dateStr);
  if (granularity === 'day') return d.toISOString().slice(0, 10);
  if (granularity === 'week') {
    var tmp = new Date(d.getTime());
    var day = tmp.getDay() || 7;
    tmp.setDate(tmp.getDate() + 4 - day);
    var yearStart = new Date(tmp.getFullYear(), 0, 1);
    var weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    return tmp.getFullYear() + '-W' + String(weekNo).padStart(2, '0');
  }
  if (granularity === 'month') return dateStr.slice(0, 7);
  if (granularity === 'year') return dateStr.slice(0, 4);
  return dateStr.slice(0, 7);
}

function formatBucketLabel(key, granularity) {
  var months = ['janv','fév','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'];
  if (granularity === 'day') {
    var p = key.split('-');
    return parseInt(p[2], 10) + ' ' + months[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2);
  }
  if (granularity === 'week') return key;
  if (granularity === 'month') {
    var p = key.split('-');
    return months[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2);
  }
  return key;
}

function aggregateTrades(trades, granularity) {
  var buckets = {};
  trades.forEach(function(t) {
    var key = getBucketKey(t.date, granularity);
    if (!buckets[key]) buckets[key] = { count: 0, pnl: 0 };
    buckets[key].count += 1;
    buckets[key].pnl += t.pnl;
  });
  return buckets;
}

function renderTemporalCharts(granularity) {
  if (_temporalCountChart) { _temporalCountChart.destroy(); _temporalCountChart = null; }
  if (_temporalPnlChart) { _temporalPnlChart.destroy(); _temporalPnlChart = null; }

  var canvasCount = document.getElementById('temporal-count-chart');
  var canvasPnl = document.getElementById('temporal-pnl-chart');
  if (!canvasCount || !canvasPnl) return;

  var bucketsA = aggregateTrades(_temporalTradesA, granularity);
  var bucketsB = aggregateTrades(_temporalTradesB, granularity);

  var keySet = {};
  Object.keys(bucketsA).forEach(function(k) { keySet[k] = true; });
  Object.keys(bucketsB).forEach(function(k) { keySet[k] = true; });
  var allKeys = Object.keys(keySet).sort();
  if (allKeys.length === 0) return;

  var labels = allKeys.map(function(k) { return formatBucketLabel(k, granularity); });
  var countA = allKeys.map(function(k) { return bucketsA[k] ? bucketsA[k].count : 0; });
  var countB = allKeys.map(function(k) { return bucketsB[k] ? bucketsB[k].count : 0; });
  var pnlA = allKeys.map(function(k) { return bucketsA[k] ? Math.round(bucketsA[k].pnl * 100) / 100 : 0; });
  var pnlB = allKeys.map(function(k) { return bucketsB[k] ? Math.round(bucketsB[k].pnl * 100) / 100 : 0; });

  var chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#94a3b8' } } },
    scales: {
      x: { ticks: { color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 30 }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }
    }
  };

  _temporalCountChart = new Chart(canvasCount.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: _temporalNameA, data: countA, backgroundColor: 'rgba(59,130,246,0.7)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3 },
        { label: _temporalNameB, data: countB, backgroundColor: 'rgba(245,158,11,0.7)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3 },
      ]
    },
    options: chartOpts
  });

  _temporalPnlChart = new Chart(canvasPnl.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: _temporalNameA, data: pnlA, backgroundColor: pnlA.map(function(v) { return v >= 0 ? 'rgba(59,130,246,0.7)' : 'rgba(59,130,246,0.3)'; }), borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3 },
        { label: _temporalNameB, data: pnlB, backgroundColor: pnlB.map(function(v) { return v >= 0 ? 'rgba(245,158,11,0.7)' : 'rgba(245,158,11,0.3)'; }), borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3 },
      ]
    },
    options: chartOpts
  });
}

async function pageCompare() {
  APP.innerHTML = '<div class="fade-in">' +
    '<h1 class="text-2xl font-bold text-white mb-2">Comparer des Variantes</h1>' +
    '<p class="text-sm text-slate-400 mb-6">Glissez des variantes depuis la sidebar ou sélectionnez-les ci-dessous.</p>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">' +
      '<div>' +
        '<label class="text-sm text-slate-400 block mb-2">Variante A</label>' +
        '<div id="drop-a" class="compare-drop ' + (_compareSlotA ? 'has-variant' : '') + ' bg-slate-800 rounded-xl p-4 flex items-center justify-center">' +
          (_compareSlotA
            ? '<div class="flex items-center justify-between w-full"><div><span class="text-xs text-slate-500">' + esc(_compareSlotA.strategyName) + '</span><br><span class="text-white font-medium">' + esc(_compareSlotA.name) + '</span></div><button class="clear-slot text-xs text-red-400 hover:text-red-300" data-slot="a">✕</button></div>'
            : '<span class="text-slate-500 text-sm">Déposez une variante ici</span>') +
        '</div>' +
        '<select id="sel-a" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white mt-2"><option value="">Ou sélectionner...</option></select>' +
      '</div>' +
      '<div>' +
        '<label class="text-sm text-slate-400 block mb-2">Variante B</label>' +
        '<div id="drop-b" class="compare-drop ' + (_compareSlotB ? 'has-variant' : '') + ' bg-slate-800 rounded-xl p-4 flex items-center justify-center">' +
          (_compareSlotB
            ? '<div class="flex items-center justify-between w-full"><div><span class="text-xs text-slate-500">' + esc(_compareSlotB.strategyName) + '</span><br><span class="text-white font-medium">' + esc(_compareSlotB.name) + '</span></div><button class="clear-slot text-xs text-red-400 hover:text-red-300" data-slot="b">✕</button></div>'
            : '<span class="text-slate-500 text-sm">Déposez une variante ici</span>') +
        '</div>' +
        '<select id="sel-b" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white mt-2"><option value="">Ou sélectionner...</option></select>' +
      '</div>' +
    '</div>' +
    '<div class="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-6">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<h3 class="text-sm font-semibold text-white">Filtrer par période</h3>' +
        '<div class="flex gap-2">' +
          '<button id="btn-period-common" class="text-xs px-3 py-1 rounded-lg border transition ' + (_comparePeriodMode === 'common' ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white') + '">Période commune</button>' +
          '<button id="btn-period-individual" class="text-xs px-3 py-1 rounded-lg border transition ' + (_comparePeriodMode === 'individual' ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white') + '">Par variante</button>' +
        '</div>' +
      '</div>' +
      '<div id="period-common" class="' + (_comparePeriodMode === 'common' ? '' : 'hidden') + '">' +
        '<div class="grid grid-cols-2 gap-4">' +
          '<div><label class="text-xs text-slate-400 block mb-1">Début</label><input type="text" id="date-start" placeholder="AAAA-MM-JJ" class="flatpickr-date w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"></div>' +
          '<div><label class="text-xs text-slate-400 block mb-1">Fin</label><input type="text" id="date-end" placeholder="AAAA-MM-JJ" class="flatpickr-date w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"></div>' +
        '</div>' +
      '</div>' +
      '<div id="period-individual" class="' + (_comparePeriodMode === 'individual' ? '' : 'hidden') + '">' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div class="border border-slate-700 rounded-lg p-3">' +
            '<span class="text-xs text-blue-400 font-medium block mb-2">Variante A</span>' +
            '<div class="grid grid-cols-2 gap-2">' +
              '<div><label class="text-xs text-slate-400 block mb-1">Début</label><input type="text" id="date-start-a" placeholder="AAAA-MM-JJ" class="flatpickr-date w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"></div>' +
              '<div><label class="text-xs text-slate-400 block mb-1">Fin</label><input type="text" id="date-end-a" placeholder="AAAA-MM-JJ" class="flatpickr-date w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"></div>' +
            '</div>' +
          '</div>' +
          '<div class="border border-slate-700 rounded-lg p-3">' +
            '<span class="text-xs text-amber-400 font-medium block mb-2">Variante B</span>' +
            '<div class="grid grid-cols-2 gap-2">' +
              '<div><label class="text-xs text-slate-400 block mb-1">Début</label><input type="text" id="date-start-b" placeholder="AAAA-MM-JJ" class="flatpickr-date w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"></div>' +
              '<div><label class="text-xs text-slate-400 block mb-1">Fin</label><input type="text" id="date-end-b" placeholder="AAAA-MM-JJ" class="flatpickr-date w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="flex justify-end mt-3">' +
        '<button id="btn-apply-period" class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg transition">Appliquer</button>' +
        '<button id="btn-clear-period" class="text-xs text-slate-400 hover:text-white px-3 py-1.5 ml-2 transition">Réinitialiser</button>' +
      '</div>' +
    '</div>' +
    '<div id="compare-results"></div>' +
  '</div>';

  // Populate selects
  var allVariants = [];
  if (_sidebarData.length > 0) {
    _sidebarData.forEach(function(s) {
      if (s.variants) {
        s.variants.forEach(function(v) {
          allVariants.push({id: v.id, name: v.name, strategyName: s.name});
        });
      }
    });
  } else {
    var strategies = await API.get('/strategies');
    for (var i = 0; i < strategies.length; i++) {
      var variants = await API.get('/variants?strategy_id=' + strategies[i].id);
      variants.forEach(function(v) {
        allVariants.push({id: v.id, name: v.name, strategyName: strategies[i].name});
      });
    }
  }

  var optionsHtml = '<option value="">Ou sélectionner...</option>' +
    allVariants.map(function(v) {
      return '<option value="' + v.id + '">[' + esc(v.strategyName) + '] ' + esc(v.name) + '</option>';
    }).join('');
  document.getElementById('sel-a').innerHTML = optionsHtml;
  document.getElementById('sel-b').innerHTML = optionsHtml;

  if (_compareSlotA) document.getElementById('sel-a').value = _compareSlotA.id;
  if (_compareSlotB) document.getElementById('sel-b').value = _compareSlotB.id;

  // Drop zones
  setupCompareDropZone('drop-a', 'a');
  setupCompareDropZone('drop-b', 'b');

  // Clear buttons
  document.querySelectorAll('.clear-slot').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var slot = btn.getAttribute('data-slot');
      if (slot === 'a') { _compareSlotA = null; document.getElementById('sel-a').value = ''; }
      else { _compareSlotB = null; document.getElementById('sel-b').value = ''; }
      pageCompare();
    });
  });

  // Select change
  document.getElementById('sel-a').onchange = function() {
    var val = document.getElementById('sel-a').value;
    if (val) {
      var found = allVariants.find(function(v) { return v.id === val; });
      _compareSlotA = found || null;
    } else {
      _compareSlotA = null;
    }
    pageCompare();
  };
  document.getElementById('sel-b').onchange = function() {
    var val = document.getElementById('sel-b').value;
    if (val) {
      var found = allVariants.find(function(v) { return v.id === val; });
      _compareSlotB = found || null;
    } else {
      _compareSlotB = null;
    }
    pageCompare();
  };

  // Init flatpickr on all date inputs
  document.querySelectorAll('.flatpickr-date').forEach(function(el) {
    flatpickr(el, {
      locale: 'fr',
      dateFormat: 'Y-m-d',
      allowInput: true,
      theme: 'dark',
    });
  });

  // Period mode toggle
  document.getElementById('btn-period-common').onclick = function() {
    _comparePeriodMode = 'common';
    document.getElementById('period-common').classList.remove('hidden');
    document.getElementById('period-individual').classList.add('hidden');
    this.className = 'text-xs px-3 py-1 rounded-lg border transition bg-blue-600 border-blue-500 text-white';
    document.getElementById('btn-period-individual').className = 'text-xs px-3 py-1 rounded-lg border transition border-slate-600 text-slate-400 hover:text-white';
  };
  document.getElementById('btn-period-individual').onclick = function() {
    _comparePeriodMode = 'individual';
    document.getElementById('period-individual').classList.remove('hidden');
    document.getElementById('period-common').classList.add('hidden');
    this.className = 'text-xs px-3 py-1 rounded-lg border transition bg-blue-600 border-blue-500 text-white';
    document.getElementById('btn-period-common').className = 'text-xs px-3 py-1 rounded-lg border transition border-slate-600 text-slate-400 hover:text-white';
  };

  // Apply period filter
  document.getElementById('btn-apply-period').onclick = function() {
    if (_compareSlotA && _compareSlotB) {
      loadComparison(_compareSlotA.id, _compareSlotB.id, getComparePeriodParams());
    }
  };

  // Clear period filter
  document.getElementById('btn-clear-period').onclick = function() {
    ['date-start', 'date-end', 'date-start-a', 'date-end-a', 'date-start-b', 'date-end-b'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (_compareSlotA && _compareSlotB) {
      loadComparison(_compareSlotA.id, _compareSlotB.id);
    }
  };

  // Auto-load comparison
  if (_compareSlotA && _compareSlotB) {
    await loadComparison(_compareSlotA.id, _compareSlotB.id);
  }
}

function getComparePeriodParams() {
  var params = '';
  if (_comparePeriodMode === 'common') {
    var s = document.getElementById('date-start').value;
    var e = document.getElementById('date-end').value;
    if (s) params += '&start_date=' + s;
    if (e) params += '&end_date=' + e;
  } else {
    var sa = document.getElementById('date-start-a').value;
    var ea = document.getElementById('date-end-a').value;
    var sb = document.getElementById('date-start-b').value;
    var eb = document.getElementById('date-end-b').value;
    if (sa) params += '&start_date_a=' + sa;
    if (ea) params += '&end_date_a=' + ea;
    if (sb) params += '&start_date_b=' + sb;
    if (eb) params += '&end_date_b=' + eb;
  }
  return params;
}

function setupCompareDropZone(elementId, slot) {
  var el = document.getElementById(elementId);
  el.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', function() {
    el.classList.remove('drag-over');
  });
  el.addEventListener('drop', function(e) {
    e.preventDefault();
    el.classList.remove('drag-over');
    var variantId = e.dataTransfer.getData('application/x-variant-id');
    var variantName = e.dataTransfer.getData('application/x-variant-name');
    var stratName = e.dataTransfer.getData('application/x-strategy-name');
    if (!variantId) return;

    var data = { id: variantId, name: variantName, strategyName: stratName };
    if (slot === 'a') _compareSlotA = data;
    else _compareSlotB = data;

    // Navigate to compare page if not already there
    if (location.hash !== '#/compare') {
      location.hash = '#/compare';
    } else {
      pageCompare();
    }
  });
}

async function loadComparison(va, vb, periodParams) {
  var container = document.getElementById('compare-results');
  container.innerHTML = spinner();
  try {
    var url = '/compare?variant_a=' + va + '&variant_b=' + vb + (periodParams || '');
    var data = await API.get(url);
    var a = data.variant_a, b = data.variant_b;
    var ma = (a.latest_run && a.latest_run.metrics) || {};
    var mb = (b.latest_run && b.latest_run.metrics) || {};
    var diff = data.diff || {};

    // Évaluation comparative
    var compareEvalHtml = '';
    if (typeof Evaluation !== 'undefined' && (a.latest_run || b.latest_run)) {
      try {
        var _tradesA = (a.latest_run && a.latest_run.trades) || [];
        var _tradesB = (b.latest_run && b.latest_run.trades) || [];
        var _vmA = buildVariantMetricsForCompare(a, a.latest_run ? ma : null, _tradesA);
        var _vmB = buildVariantMetricsForCompare(b, b.latest_run ? mb : null, _tradesB);
        if (_vmA && _vmB) {
          var _compResult = Evaluation.evaluateVariantComparison({ variantA: _vmA, variantB: _vmB });
          compareEvalHtml = renderComparisonEvaluationPanel(_compResult, a.name, b.name);
        }
      } catch(e) {}
    }

    var metricRows = [
      {key: 'total_pnl', label: 'Total PnL'},
      {key: 'total_trades', label: 'Trades', fmt: 'int'},
      {key: 'win_rate', label: 'Win Rate', fmt: 'pct'},
      {key: 'profit_factor', label: 'Profit Factor', fmt: 'num'},
      {key: 'max_drawdown', label: 'Max Drawdown', fmt: 'dd'},
      {key: 'expectancy', label: 'Expectancy'},
      {key: 'avg_win', label: 'Avg Win'},
      {key: 'avg_loss', label: 'Avg Loss'},
      {key: 'best_trade', label: 'Best Trade'},
      {key: 'worst_trade', label: 'Worst Trade'},
      {key: 'sharpe_ratio', label: 'Sharpe (ann.)', fmt: 'num'},
    ];

    function fmtVal(val, fmt, ddPeak, avgLoss) {
      if (val == null) return '—';
      if (fmt === 'pct') return formatPercent(val);
      if (fmt === 'num') return val.toFixed(2);
      if (fmt === 'int') return String(val);
      _currentAvgLoss = avgLoss;
      if (fmt === 'dd') return formatDrawdown(val, _unitSettings.initial_balance + (ddPeak || 0));
      return formatPnl(val);
    }

    container.innerHTML =
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">' +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-4">' +
          '<div class="flex items-center gap-2 mb-1"><h3 class="font-semibold text-white">' + esc(a.name) + '</h3>' + statusBadge(a.status) + '</div>' +
          '<p class="text-xs text-slate-400 mb-1">Hypothèse: ' + (esc(a.hypothesis) || '—') + '</p>' +
          '<p class="text-xs text-slate-400">Décision: ' + (esc(a.decision) || '—') + '</p>' +
        '</div>' +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-4">' +
          '<div class="flex items-center gap-2 mb-1"><h3 class="font-semibold text-white">' + esc(b.name) + '</h3>' + statusBadge(b.status) + '</div>' +
          '<p class="text-xs text-slate-400 mb-1">Hypothèse: ' + (esc(b.hypothesis) || '—') + '</p>' +
          '<p class="text-xs text-slate-400">Décision: ' + (esc(b.decision) || '—') + '</p>' +
        '</div>' +
      '</div>' +
      ((!a.latest_run && !b.latest_run) ? '<p class="text-center text-slate-400 py-8">Aucun run disponible pour la comparaison</p>' :
      '<div class="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden mb-6">' +
        '<table class="w-full text-sm" style="table-layout:fixed"><thead><tr class="border-b border-slate-700 text-slate-400">' +
          '<th class="py-3 px-4 text-left bg-slate-800" style="width:20%">Métrique</th>' +
          '<th class="py-3 px-4 text-center bg-slate-800" style="width:35%">' + esc(a.name) + '</th>' +
          '<th class="py-3 px-4 text-center bg-slate-800" style="width:6%"></th>' +
          '<th class="py-3 px-4 text-center bg-slate-800" style="width:35%">' + esc(b.name) + '</th>' +
        '</tr></thead><tbody>' +
        metricRows.map(function(r) {
          var dpA = ma.dd_peak_equity, dpB = mb.dd_peak_equity;
          return '<tr class="border-b border-slate-700/50 hover:bg-slate-700/20">' +
            '<td class="py-2.5 px-4 text-slate-300">' + r.label + '</td>' +
            '<td class="py-2.5 px-4 text-center ' + (diff[r.key]==='A' ? 'bg-green-900/20' : '') + '">' + fmtVal(ma[r.key], r.fmt, dpA, ma.avg_loss) + (diff[r.key]==='A' ? ' <span class="text-green-400 text-xs">✓</span>' : '') + '</td>' +
            '<td class="py-2.5 px-4 text-center text-slate-600">vs</td>' +
            '<td class="py-2.5 px-4 text-center ' + (diff[r.key]==='B' ? 'bg-green-900/20' : '') + '">' + fmtVal(mb[r.key], r.fmt, dpB, mb.avg_loss) + (diff[r.key]==='B' ? ' <span class="text-green-400 text-xs">✓</span>' : '') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        compareEvalHtml +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
          '<h3 class="text-lg font-semibold text-white mb-4">Equity Curves</h3>' +
          '<div style="height:300px"><canvas id="compare-chart"></canvas></div>' +
        '</div>' +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<h3 class="text-lg font-semibold text-white">Analyse temporelle</h3>' +
            '<div class="flex gap-1" id="granularity-btns">' +
              '<button data-g="day" class="text-xs px-3 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-white transition">Jour</button>' +
              '<button data-g="week" class="text-xs px-3 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-white transition">Semaine</button>' +
              '<button data-g="month" class="text-xs px-3 py-1 rounded-lg border bg-blue-600 border-blue-500 text-white transition">Mois</button>' +
              '<button data-g="year" class="text-xs px-3 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-white transition">Année</button>' +
            '</div>' +
          '</div>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
            '<div><h4 class="text-xs text-slate-400 mb-2">Nombre de trades</h4><div style="height:250px"><canvas id="temporal-count-chart"></canvas></div></div>' +
            '<div><h4 class="text-xs text-slate-400 mb-2">PnL</h4><div style="height:250px"><canvas id="temporal-pnl-chart"></canvas></div></div>' +
          '</div>' +
        '</div>');

    // Equity curves chart
    var ecA = (a.latest_run && a.latest_run.equity_curve) || [];
    var ecB = (b.latest_run && b.latest_run.equity_curve) || [];
    if (ecA.length > 0 || ecB.length > 0) {
      if (_compareChart) _compareChart.destroy();
      var dateSet = {};
      ecA.forEach(function(p) { dateSet[p.date] = true; });
      ecB.forEach(function(p) { dateSet[p.date] = true; });
      var allDates = Object.keys(dateSet).sort();

      var mapA = {}, mapB = {};
      ecA.forEach(function(p) { mapA[p.date] = p.cumulative_pnl; });
      ecB.forEach(function(p) { mapB[p.date] = p.cumulative_pnl; });

      var ctx = document.getElementById('compare-chart').getContext('2d');
      _compareChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: allDates.map(function(d) { return formatDate(d); }),
          datasets: [
            { label: a.name, data: allDates.map(function(d) { return mapA[d] != null ? mapA[d] : null; }), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, pointRadius: 2, spanGaps: true },
            { label: b.name, data: allDates.map(function(d) { return mapB[d] != null ? mapB[d] : null; }), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.3, pointRadius: 2, spanGaps: true },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } }
        }
      });
    }

    // Temporal analysis charts (with granularity selector)
    _temporalTradesA = (a.latest_run && a.latest_run.trades) || [];
    _temporalTradesB = (b.latest_run && b.latest_run.trades) || [];
    _temporalNameA = a.name;
    _temporalNameB = b.name;

    if (_temporalTradesA.length > 0 || _temporalTradesB.length > 0) {
      renderTemporalCharts('month');

      document.querySelectorAll('#granularity-btns button').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('#granularity-btns button').forEach(function(b) {
            b.className = 'text-xs px-3 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-white transition';
          });
          btn.className = 'text-xs px-3 py-1 rounded-lg border bg-blue-600 border-blue-500 text-white transition';
          renderTemporalCharts(btn.getAttribute('data-g'));
        });
      });
    }
  } catch (err) {
    console.error('Compare error:', err);
    container.innerHTML = '<p class="text-red-400 text-center">' + esc(err.message) + '</p>';
  }
}
