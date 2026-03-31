export const STATUS_LABELS = {
  idea: 'Idée',
  ready_to_test: 'Prêt à tester',
  testing: 'En test',
  active: 'Active',
  validated: 'Validée',
  rejected: 'Rejetée',
  archived: 'Archivée',
  abandoned: 'Abandonnée',
};

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60); if (m < 60) return 'il y a ' + m + ' min';
  const h = Math.floor(m / 60); if (h < 24) return 'il y a ' + h + 'h';
  const days = Math.floor(h / 24); if (days < 7) return 'il y a ' + days + 'j';
  const weeks = Math.floor(days / 7); if (weeks < 5) return 'il y a ' + weeks + 'sem';
  const months = Math.floor(days / 30); if (months < 12) return 'il y a ' + months + ' mois';
  return 'il y a ' + Math.floor(months / 12) + ' an(s)';
}

export function formatPercent(n) {
  if (n == null) return '—';
  return (n * 100).toFixed(1) + '%';
}

// --- Unit system ---

let _unitSettings = JSON.parse(localStorage.getItem('unitSettings') || 'null') || { initial_balance: 10000 };
let _currentAvgLoss = null;

export function getUnitSettings() { return _unitSettings; }
export function setUnitSettings(s) { _unitSettings = s; localStorage.setItem('unitSettings', JSON.stringify(s)); }
export function getCurrentAvgLoss() { return _currentAvgLoss; }
export function setCurrentAvgLoss(v) { _currentAvgLoss = v; }

export function getUnit() {
  return localStorage.getItem('unitMode') || 'cash';
}

export function convertMetric(value, ctx) {
  if (value == null) return null;
  const unit = getUnit();
  if (unit === 'cash') return value;
  if (unit === 'pct') {
    const d = ctx && ctx.denom != null ? ctx.denom : _unitSettings.initial_balance;
    return d > 0 ? (value / d) * 100 : null;
  }
  if (unit === 'R') {
    const r = _currentAvgLoss != null ? Math.abs(_currentAvgLoss) : 0;
    return r > 0 ? value / r : null;
  }
  return value;
}

export function unitSuffix() {
  const unit = getUnit();
  if (unit === 'pct') return '%';
  if (unit === 'R') return 'R';
  return '';
}

export function formatPnlRaw(n, denom) {
  if (n == null) return { text: '—', cls: '' };
  const v = convertMetric(n, { denom: denom != null ? denom : _unitSettings.initial_balance });
  if (v == null) return { text: '—', cls: '' };
  const cls = v >= 0 ? 'text-green-400' : 'text-red-400';
  const sign = v >= 0 ? '+' : '';
  const suffix = unitSuffix();
  return { text: sign + v.toFixed(2) + suffix, cls };
}

export function formatDrawdownRaw(n, ddPeak) {
  if (n == null) return { text: '—', cls: '' };
  const v = convertMetric(n, { denom: ddPeak || 0 });
  if (v == null) return { text: '—', cls: '' };
  const suffix = unitSuffix();
  return { text: '-' + v.toFixed(2) + suffix, cls: 'text-red-400' };
}

// Rich text helpers
export function normalizeRichValue(val) {
  if (!val) return '';
  try {
    const data = typeof val === 'string' ? JSON.parse(val) : val;
    if (data && typeof data === 'object' && data.blocks) {
      return editorjsBlocksToHtml(data.blocks);
    }
    if (typeof data === 'string') return data;
  } catch(e) { /* not JSON */ }
  return val;
}

function editorjsBlocksToHtml(blocks) {
  let html = '';
  blocks.forEach(function(b) {
    switch(b.type) {
      case 'paragraph': html += '<p>' + (b.data.text || '') + '</p>'; break;
      case 'header': html += '<h' + b.data.level + '>' + (b.data.text || '') + '</h' + b.data.level + '>'; break;
      case 'list': {
        const tag = b.data.style === 'ordered' ? 'ol' : 'ul';
        html += '<' + tag + '>';
        (b.data.items || []).forEach(function(item) {
          const text = typeof item === 'string' ? item : (item.content || item.text || '');
          html += '<li>' + text + '</li>';
        });
        html += '</' + tag + '>'; break;
      }
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

export function richTextPlain(val, maxLen) {
  if (!val) return '';
  const html = normalizeRichValue(val);
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  let text = tmp.textContent || tmp.innerText || '';
  if (maxLen && text.length > maxLen) text = text.substring(0, maxLen) + '…';
  return text;
}

// Evaluation helpers
export function buildRunMetrics(data) {
  const m = data.metrics || {};
  const ib = _unitSettings.initial_balance || 10000;
  const ddPeak = ib + (m.dd_peak_equity || 0);
  const maxDDRatio = ddPeak > 0 ? (m.max_drawdown || 0) / ddPeak : null;
  const totalTrades = m.total_trades || 0;
  const winCount = Math.round((m.win_rate || 0) * totalTrades);
  const lossCount = totalTrades - winCount;
  const totalPositivePnl = (m.avg_win || 0) * winCount;
  const totalNegativePnl = (m.avg_loss || 0) * lossCount;
  let coveredDays = null;
  if (data.start_date && data.end_date) {
    coveredDays = Math.round((new Date(data.end_date) - new Date(data.start_date)) / 86400000);
  }
  return {
    id: data.id, name: data.label, runType: data.type || 'backtest',
    tradeCount: totalTrades, pnl: m.total_pnl ?? null, winRate: m.win_rate ?? null,
    profitFactor: m.profit_factor ?? null, expectancy: m.expectancy ?? null,
    maxDrawdown: maxDDRatio, avgWin: m.avg_win ?? null, avgLoss: m.avg_loss ?? null,
    bestTrade: m.best_trade ?? null, worstTrade: m.worst_trade ?? null,
    sharpeRatio: m.sharpe_ratio ?? null, totalPositivePnl, totalNegativePnl,
    periodStart: data.start_date || null, periodEnd: data.end_date || null, coveredDays,
  };
}

export function buildVariantMetrics(variantData, aggMetrics, runs) {
  if (!aggMetrics) return null;
  const m = aggMetrics;
  const ib = _unitSettings.initial_balance || 10000;
  const ddPeak = ib + (m.dd_peak_equity || 0);
  const maxDDRatio = ddPeak > 0 ? (m.max_drawdown || 0) / ddPeak : null;
  const totalTrades = m.total_trades || 0;
  const winCount = Math.round((m.win_rate || 0) * totalTrades);
  const lossCount = totalTrades - winCount;
  const totalPositivePnl = (m.avg_win || 0) * winCount;
  const totalNegativePnl = (m.avg_loss || 0) * lossCount;
  const allDates = [];
  (runs || []).forEach(r => {
    if (r.start_date) allDates.push(new Date(r.start_date));
    if (r.end_date) allDates.push(new Date(r.end_date));
  });
  let coveredDays = null;
  if (allDates.length >= 2) {
    const minDate = allDates.reduce((a, b) => a < b ? a : b);
    const maxDate = allDates.reduce((a, b) => a > b ? a : b);
    coveredDays = Math.round((maxDate - minDate) / 86400000);
  }
  const runTypes = [...new Set((runs || []).map(r => r.type))];
  return {
    id: variantData.id, name: variantData.name, tradeCount: totalTrades,
    pnl: m.total_pnl ?? null, winRate: m.win_rate ?? null, profitFactor: m.profit_factor ?? null,
    expectancy: m.expectancy ?? null, maxDrawdown: maxDDRatio, avgWin: m.avg_win ?? null,
    avgLoss: m.avg_loss ?? null, bestTrade: m.best_trade ?? null, worstTrade: m.worst_trade ?? null,
    sharpeRatio: m.sharpe_ratio ?? null, totalPositivePnl, totalNegativePnl,
    coveredDays, runTypes, runsCount: (runs || []).length,
  };
}

export function buildVariantMetricsForCompare(variantData, metricsData, trades) {
  if (!metricsData) return null;
  const m = metricsData;
  const ib = _unitSettings.initial_balance || 10000;
  const ddPeak = ib + (m.dd_peak_equity || 0);
  const maxDDRatio = ddPeak > 0 ? (m.max_drawdown || 0) / ddPeak : null;
  const totalTrades = m.total_trades || 0;
  const winCount = Math.round((m.win_rate || 0) * totalTrades);
  const lossCount = totalTrades - winCount;
  const totalPositivePnl = (m.avg_win || 0) * winCount;
  const totalNegativePnl = (m.avg_loss || 0) * lossCount;
  let coveredDays = null;
  if (trades && trades.length >= 2) {
    const t0 = new Date(trades[0].date);
    const tN = new Date(trades[trades.length - 1].date);
    coveredDays = Math.round((tN - t0) / 86400000);
  }
  return {
    id: variantData.id, name: variantData.name, tradeCount: totalTrades,
    pnl: m.total_pnl ?? null, winRate: m.win_rate ?? null, profitFactor: m.profit_factor ?? null,
    expectancy: m.expectancy ?? null, maxDrawdown: maxDDRatio, avgWin: m.avg_win ?? null,
    avgLoss: m.avg_loss ?? null, bestTrade: m.best_trade ?? null, worstTrade: m.worst_trade ?? null,
    sharpeRatio: m.sharpe_ratio ?? null, totalPositivePnl, totalNegativePnl,
    coveredDays, runTypes: [], runsCount: null,
  };
}
