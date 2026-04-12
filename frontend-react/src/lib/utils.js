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
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: 'CHF', CAD: 'C$', AUD: 'A$' };

export function getCurrencySymbol() {
  try {
    const u = JSON.parse(localStorage.getItem('user'));
    return CURRENCY_SYMBOLS[u?.currency] || '$';
  } catch { return '$'; }
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

export function cashPrefix() {
  return getUnit() === 'cash' ? getCurrencySymbol() : '';
}

export function formatPnlRaw(n, denom) {
  if (n == null) return { text: '—', cls: '' };
  const v = convertMetric(n, { denom: denom != null ? denom : _unitSettings.initial_balance });
  if (v == null) return { text: '—', cls: '' };
  const cls = v >= 0 ? 'text-green-400' : 'text-red-400';
  const sign = v >= 0 ? '+' : '';
  const prefix = cashPrefix();
  const suffix = unitSuffix();
  return { text: sign + prefix + v.toFixed(2) + suffix, cls };
}

export function formatDrawdownRaw(n, ddPeak) {
  if (n == null) return { text: '—', cls: '' };
  const v = convertMetric(n, { denom: ddPeak || 0 });
  if (v == null) return { text: '—', cls: '' };
  const prefix = cashPrefix();
  const suffix = unitSuffix();
  return { text: '-' + prefix + v.toFixed(2) + suffix, cls: 'text-red-400' };
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
