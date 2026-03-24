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

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatPnl(n) {
  if (n == null) return '—';
  var cls = n >= 0 ? 'text-green-400' : 'text-red-400';
  var sign = n >= 0 ? '+' : '';
  return '<span class="' + cls + '">' + sign + n.toFixed(2) + '</span>';
}

function formatPercent(n) {
  if (n == null) return '—';
  return (n * 100).toFixed(1) + '%';
}

function statusBadge(status) {
  return '<span class="status-' + esc(status) + ' text-xs font-medium px-2.5 py-0.5 rounded-full">' + esc(status) + '</span>';
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

function showModal(title, bodyHtml, onSubmit) {
  var overlay = document.getElementById('modal-overlay');
  var content = document.getElementById('modal-content');
  content.innerHTML = '<h3 class="text-lg font-semibold text-white mb-4">' + esc(title) + '</h3>' +
    '<form id="modal-form">' + bodyHtml +
      '<div class="flex justify-end gap-3 mt-6">' +
        '<button type="button" id="modal-cancel" class="px-4 py-2 text-sm text-slate-300 hover:text-white transition">Annuler</button>' +
        '<button type="submit" class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Confirmer</button>' +
      '</div>' +
    '</form>';
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
  document.getElementById('modal-cancel').onclick = closeModal;
  overlay.onclick = function(e) { if (e.target === overlay) closeModal(); };
  document.getElementById('modal-form').onsubmit = async function(e) {
    e.preventDefault();
    try { await onSubmit(new FormData(e.target)); closeModal(); }
    catch (err) { alert(err.message); }
  };
}

function closeModal() {
  var overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('flex');
}

function inputField(name, label, type, required, value) {
  type = type || 'text'; required = required !== false; value = value || '';
  return '<div class="mb-3"><label class="block text-sm text-slate-300 mb-1">' + esc(label) + '</label>' +
    '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + (required ? 'required' : '') +
    ' class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"></div>';
}

function textareaField(name, label, required, value) {
  return '<div class="mb-3"><label class="block text-sm text-slate-300 mb-1">' + esc(label) + '</label>' +
    '<textarea name="' + name + '" ' + (required ? 'required' : '') + ' rows="2"' +
    ' class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">' + esc(value || '') + '</textarea></div>';
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

async function loadSidebar() {
  var tree = document.getElementById('sidebar-tree');
  try {
    var strategies = await API.get('/strategies');
    _sidebarData = [];
    for (var i = 0; i < strategies.length; i++) {
      var detail = await API.get('/strategies/' + strategies[i].id);
      _sidebarData.push(detail);
    }
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
    html += '<div class="mb-1">' +
      '<div class="strat-toggle ' + (isOpen ? 'open' : '') + ' flex items-center gap-2 px-2 py-1.5 rounded-md text-sm" data-strat-id="' + s.id + '">' +
        '<span class="chevron text-slate-500">▶</span>' +
        '<a href="#/strategy/' + s.id + '" class="flex-1 text-slate-200 hover:text-white truncate font-medium" title="' + esc(s.name) + '">' + esc(s.name) + '</a>' +
        '<span class="text-xs text-slate-500">' + varCount + '</span>' +
      '</div>';

    html += '<div class="variant-list pl-5 ' + (isOpen ? '' : 'collapsed') + '" style="max-height:' + (isOpen ? (varCount * 40 + 10) + 'px' : '0') + '">';
    if (s.variants) {
      s.variants.forEach(function(v) {
        html += '<div class="sidebar-variant flex items-center gap-2 px-2 py-1 text-xs" draggable="true" data-variant-id="' + v.id + '" data-variant-name="' + esc(v.name) + '" data-strategy-name="' + esc(s.name) + '">' +
          '<span class="text-slate-600 cursor-grab">⠿</span>' +
          '<a href="#/variant/' + v.id + '" class="flex-1 text-slate-300 hover:text-white truncate" title="' + esc(v.name) + '">' + esc(v.name) + '</a>' +
          statusBadge(v.status) +
        '</div>';
      });
    }
    html += '</div></div>';
  });

  tree.innerHTML = html;

  // Bind expand/collapse
  tree.querySelectorAll('.strat-toggle').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.tagName === 'A') return;
      var stratId = el.getAttribute('data-strat-id');
      _expandedStrategies[stratId] = !_expandedStrategies[stratId];
      renderSidebar();
    });
  });

  // Bind drag start on variants
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
}

function setupSidebar() {
  document.getElementById('btn-toggle-sidebar').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
  document.getElementById('btn-new-strat-sidebar').addEventListener('click', function() {
    showNewStrategyModal();
  });
}

function showNewStrategyModal() {
  showModal('Nouvelle Stratégie',
    inputField('name', 'Nom') +
    textareaField('description', 'Description') +
    inputField('market', 'Marché', 'text', true, 'XAUUSD') +
    selectField('timeframe', 'Timeframe', [
      {value:'M1',label:'M1'},{value:'M5',label:'M5'},{value:'M15',label:'M15'},
      {value:'M30',label:'M30'},{value:'H1',label:'H1'},{value:'H4',label:'H4'},
      {value:'D1',label:'D1'},{value:'W1',label:'W1'}
    ], 'M15'),
    async function(fd) {
      await API.post('/strategies', {
        name: fd.get('name'), description: fd.get('description'),
        market: fd.get('market'), timeframe: fd.get('timeframe'),
      });
      await loadSidebar();
      route();
    }
  );
}

// ===== ROUTER =====

var APP = document.getElementById('app');

async function route() {
  var hash = location.hash.slice(1) || '/';
  APP.innerHTML = spinner();
  try {
    var m;
    if (hash === '/') return await pageDashboard();
    if ((m = hash.match(/^\/strategy\/(.+)$/))) return await pageStrategy(m[1]);
    if ((m = hash.match(/^\/variant\/(.+)$/))) return await pageVariant(m[1]);
    if ((m = hash.match(/^\/run\/(.+)$/))) return await pageRun(m[1]);
    if ((m = hash.match(/^\/import\/(.+)$/))) return await pageImport(m[1]);
    if (hash === '/compare') return await pageCompare();
    APP.innerHTML = '<p class="text-center mt-20 text-slate-400">Page introuvable</p>';
  } catch (err) {
    APP.innerHTML = '<div class="text-center mt-20"><p class="text-red-400 text-lg">Erreur</p><p class="text-slate-400 mt-2">' + esc(err.message) + '</p></div>';
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', function() {
  setupSidebar();
  loadSidebar();
  route();
});

// ===== PAGE: DASHBOARD =====

var _dashboardCharts = [];

async function pageDashboard() {
  var strategies = await API.get('/strategies/dashboard');

  APP.innerHTML = '<div class="fade-in">' +
    '<div class="flex items-center justify-between mb-6">' +
      '<h1 class="text-2xl font-bold text-white">Mes Stratégies</h1>' +
      '<button id="btn-new-strat" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">+ Nouvelle Stratégie</button>' +
    '</div>' +
    (strategies.length === 0 ? emptyState('Aucune stratégie créée') :
    '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">' +
      strategies.map(function(s, idx) {
        var m = s.aggregate_metrics;
        var hasMet = m && m.total_trades > 0;
        var rr = (hasMet && m.avg_win && m.avg_loss && m.avg_loss !== 0) ? Math.abs(m.avg_win / m.avg_loss) : null;
        var desc = s.description || '';
        if (desc.length > 120) desc = desc.substring(0, 120) + '…';
        return '<a href="#/strategy/' + s.id + '" class="block bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/50 transition group">' +
          '<div class="flex items-start justify-between mb-2">' +
            '<h3 class="font-semibold text-white group-hover:text-blue-400 transition">' + esc(s.name) + '</h3>' +
            '<span class="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">' + esc(s.timeframe) + '</span>' +
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
            '<span>📈 ' + esc(s.market) + '</span>' +
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

async function pageStrategy(id) {
  var data = await API.get('/strategies/' + id);
  var variantsSummary = await API.get('/strategies/' + id + '/variants-summary');

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
            '<span>📈 ' + esc(data.market) + '</span>' +
            '<span>⏱ ' + esc(data.timeframe) + '</span>' +
            '<span>📅 ' + formatDate(data.created_at) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex gap-2">' +
          '<button id="btn-edit-strat" class="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Modifier</button>' +
          '<button id="btn-del-strat" class="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="flex items-center justify-between mb-4">' +
      '<h2 class="text-lg font-semibold text-white">Variantes (' + data.variants.length + ')</h2>' +
      '<button id="btn-new-var" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">+ Nouvelle Variante</button>' +
    '</div>' +
    (data.variants.length === 0 ? emptyState('Aucune variante créée') :
    '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">' +
      data.variants.map(function(v, idx) {
        var m = varMetrics[v.id];
        var hasMet = m && m.total_trades > 0;
        var rr = (hasMet && m.avg_win && m.avg_loss && m.avg_loss !== 0) ? Math.abs(m.avg_win / m.avg_loss) : null;
        var desc = v.description || '';
        if (desc.length > 120) desc = desc.substring(0, 120) + '…';
        return '<a href="#/variant/' + v.id + '" class="block bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/50 transition group">' +
          '<div class="flex items-start justify-between mb-2">' +
            '<h3 class="font-semibold text-white group-hover:text-blue-400 transition">' + esc(v.name) + '</h3>' +
            statusBadge(v.status) +
          '</div>' +
          '<p class="text-xs text-slate-400 mb-2">' + (esc(desc) || '<span class="italic">Pas de description</span>') + '</p>' +
          (hasMet ?
            '<div style="height:60px" class="mb-2"><canvas id="var-chart-' + idx + '"></canvas></div>' +
            '<div class="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mb-2">' +
              '<span>PnL ' + formatPnl(m.total_pnl) + '</span>' +
              '<span>Profit Factor <span class="text-white">' + (m.profit_factor != null ? m.profit_factor.toFixed(2) : '—') + '</span></span>' +
              '<span>RR Moyen <span class="text-white">' + (rr != null ? rr.toFixed(2) : '—') + '</span></span>' +
            '</div>'
          : '') +
          '<div class="flex items-center gap-3 text-xs text-slate-500">' +
            '<span>📅 ' + formatDate(v.created_at) + '</span>' +
            (hasMet ? '<span>' + m.total_trades + ' trades</span>' : '') +
          '</div>' +
        '</a>';
      }).join('') +
    '</div>') +
  '</div>';

  // Render mini equity charts for variants
  _strategyCharts.forEach(function(c) { c.destroy(); });
  _strategyCharts = [];
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

  document.getElementById('btn-edit-strat').onclick = function() {
    showModal('Modifier la Stratégie',
      inputField('name', 'Nom', 'text', true, data.name) +
      textareaField('description', 'Description', false, data.description) +
      inputField('market', 'Marché', 'text', true, data.market) +
      selectField('timeframe', 'Timeframe', [
        {value:'M1',label:'M1'},{value:'M5',label:'M5'},{value:'M15',label:'M15'},
        {value:'M30',label:'M30'},{value:'H1',label:'H1'},{value:'H4',label:'H4'},
        {value:'D1',label:'D1'},{value:'W1',label:'W1'}
      ], data.timeframe),
      async function(fd) {
        await API.put('/strategies/' + id, {
          name: fd.get('name'), description: fd.get('description'),
          market: fd.get('market'), timeframe: fd.get('timeframe'),
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

  document.getElementById('btn-new-var').onclick = function() {
    var parentOpts = [{value:'', label:'— Aucun (variante racine) —'}]
      .concat(data.variants.map(function(v) { return {value: v.id, label: v.name}; }));
    showModal('Nouvelle Variante',
      inputField('name', 'Nom') +
      textareaField('description', 'Description') +
      textareaField('hypothesis', 'Hypothèse') +
      selectField('parent_variant_id', 'Variante parente', parentOpts) +
      selectField('status', 'Statut', [
        {value:'active',label:'Active'},{value:'testing',label:'Testing'},
        {value:'archived',label:'Archivée'},{value:'abandoned',label:'Abandonnée'}
      ]),
      async function(fd) {
        await API.post('/variants', {
          strategy_id: id, name: fd.get('name'),
          description: fd.get('description'), hypothesis: fd.get('hypothesis'),
          parent_variant_id: fd.get('parent_variant_id') || null,
          status: fd.get('status'),
        });
        await loadSidebar();
        route();
      }
    );
  };
}

// ===== PAGE: VARIANT DETAIL =====

async function pageVariant(id) {
  var data = await API.get('/variants/' + id);
  var lineage = null;
  try { lineage = await API.get('/variants/' + id + '/lineage'); } catch(e) {}
  var stratName = 'Stratégie';
  try { stratName = (await API.get('/strategies/' + data.strategy_id)).name; } catch(e) {}

  APP.innerHTML = '<div class="fade-in">' +
    breadcrumb([
      {label:'Stratégies', href:'#/'},
      {label: stratName, href:'#/strategy/' + data.strategy_id},
      {label: data.name}
    ]) +
    '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
      '<div class="flex items-start justify-between mb-4">' +
        '<div>' +
          '<div class="flex items-center gap-3 mb-2">' +
            '<h1 class="text-2xl font-bold text-white">' + esc(data.name) + '</h1>' +
            statusBadge(data.status) +
          '</div>' +
          '<p class="text-slate-400 text-sm">' + (esc(data.description) || 'Pas de description') + '</p>' +
        '</div>' +
        '<div class="flex gap-2">' +
          '<button id="btn-edit-var" class="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Modifier</button>' +
          '<button id="btn-del-var" class="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">' +
        '<div class="bg-slate-700/50 rounded-lg p-3"><span class="text-slate-400 block mb-1">Hypothèse</span><span class="text-white">' + (esc(data.hypothesis) || '—') + '</span></div>' +
        '<div class="bg-slate-700/50 rounded-lg p-3"><span class="text-slate-400 block mb-1">Décision</span><span class="text-white">' + (esc(data.decision) || '—') + '</span></div>' +
      '</div>' +
    '</div>' +
    (lineage ? '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
      '<h2 class="text-lg font-semibold text-white mb-3">Lignée</h2>' +
      '<div class="text-sm">' + renderLineageTree(lineage, id) + '</div>' +
    '</div>' : '') +
    '<div class="flex items-center justify-between mb-4">' +
      '<h2 class="text-lg font-semibold text-white">Runs (' + data.runs.length + ')</h2>' +
      '<a href="#/import/' + id + '" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition inline-block">📥 Importer CSV</a>' +
    '</div>' +
    (data.runs.length === 0 ? emptyState('Aucun run importé', 'Importer un CSV', '#/import/' + id) :
    '<div class="space-y-3">' +
      data.runs.map(function(r) {
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

  document.getElementById('btn-edit-var').onclick = function() {
    showModal('Modifier la Variante',
      inputField('name', 'Nom', 'text', true, data.name) +
      textareaField('description', 'Description', false, data.description) +
      textareaField('hypothesis', 'Hypothèse', false, data.hypothesis) +
      textareaField('decision', 'Décision', false, data.decision) +
      selectField('status', 'Statut', [
        {value:'active',label:'Active'},{value:'testing',label:'Testing'},
        {value:'archived',label:'Archivée'},{value:'abandoned',label:'Abandonnée'}
      ], data.status),
      async function(fd) {
        await API.put('/variants/' + id, {
          name: fd.get('name'), description: fd.get('description'),
          hypothesis: fd.get('hypothesis'), decision: fd.get('decision'),
          status: fd.get('status'),
        });
        await loadSidebar();
        route();
      }
    );
  };

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
    stratName = (await API.get('/strategies/' + stratId)).name;
  } catch(e) {}

  var metrics = [
    {label: 'Total PnL', value: formatPnl(m.total_pnl)},
    {label: 'Trades', value: m.total_trades || 0},
    {label: 'Win Rate', value: formatPercent(m.win_rate)},
    {label: 'Profit Factor', value: m.profit_factor != null ? m.profit_factor.toFixed(2) : '—'},
    {label: 'Max Drawdown', value: m.max_drawdown != null ? '<span class="text-red-400">-' + m.max_drawdown.toFixed(2) + '</span>' : '—'},
    {label: 'Expectancy', value: formatPnl(m.expectancy)},
    {label: 'Avg Win', value: formatPnl(m.avg_win)},
    {label: 'Avg Loss', value: formatPnl(m.avg_loss)},
    {label: 'Best Trade', value: formatPnl(m.best_trade)},
    {label: 'Worst Trade', value: formatPnl(m.worst_trade)},
  ];

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
    '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">' +
      '<h2 class="text-lg font-semibold text-white mb-4">Equity Curve</h2>' +
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
          data.trades.map(function(t) {
            return '<tr class="border-b border-slate-700/50 hover:bg-slate-700/30">' +
              '<td class="py-2 px-3 text-slate-300">' + formatDateTime(t.open_time) + '</td>' +
              '<td class="py-2 px-3 text-slate-300">' + formatDateTime(t.close_time) + '</td>' +
              '<td class="py-2 px-3">' + esc(t.symbol) + '</td>' +
              '<td class="py-2 px-3"><span class="' + (t.side === 'long' ? 'text-green-400' : 'text-red-400') + '">' + esc(t.side) + '</span></td>' +
              '<td class="py-2 px-3">' + t.entry_price + '</td>' +
              '<td class="py-2 px-3">' + t.exit_price + '</td>' +
              '<td class="py-2 px-3">' + t.lot_size + '</td>' +
              '<td class="py-2 px-3">' + formatPnl(t.pnl) + '</td>' +
              '<td class="py-2 px-3">' + (t.pips != null ? t.pips : '—') + '</td>' +
            '</tr>';
          }).join('') +
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
    new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: [{ label: 'PnL Cumulé', data: values, borderColor: color, backgroundColor: bgColor, fill: true, tension: 0.3, pointRadius: 3, pointHoverRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } } }
    });
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
  var stratName = 'Stratégie';
  try { stratName = (await API.get('/strategies/' + variant.strategy_id)).name; } catch(e) {}

  var fields = ['open_time','close_time','symbol','side','entry_price','exit_price','lot_size','pnl','pips'];
  var fieldLabels = {
    open_time: 'Open Time', close_time: 'Close Time', symbol: 'Symbol',
    side: 'Side (Type)', entry_price: 'Entry Price', exit_price: 'Exit Price',
    lot_size: 'Lot Size', pnl: 'PnL (Profit)', pips: 'Pips (optionnel)'
  };

  APP.innerHTML = '<div class="fade-in">' +
    breadcrumb([
      {label:'Stratégies', href:'#/'},
      {label: stratName, href:'#/strategy/' + variant.strategy_id},
      {label: variant.name, href:'#/variant/' + variantId},
      {label: 'Import CSV'}
    ]) +
    '<h1 class="text-2xl font-bold text-white mb-6">Importer un CSV</h1>' +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
      '<div>' +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">' +
          inputField('label', 'Label du run') +
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

  // Auto-load comparison
  if (_compareSlotA && _compareSlotB) {
    await loadComparison(_compareSlotA.id, _compareSlotB.id);
  }
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

async function loadComparison(va, vb) {
  var container = document.getElementById('compare-results');
  container.innerHTML = spinner();
  try {
    var data = await API.get('/compare?variant_a=' + va + '&variant_b=' + vb);
    var a = data.variant_a, b = data.variant_b;
    var ma = (a.latest_run && a.latest_run.metrics) || {};
    var mb = (b.latest_run && b.latest_run.metrics) || {};
    var diff = data.diff || {};

    var metricRows = [
      {key: 'total_pnl', label: 'Total PnL'},
      {key: 'total_trades', label: 'Trades', fmt: 'int'},
      {key: 'win_rate', label: 'Win Rate', fmt: 'pct'},
      {key: 'profit_factor', label: 'Profit Factor', fmt: 'num'},
      {key: 'max_drawdown', label: 'Max Drawdown'},
      {key: 'expectancy', label: 'Expectancy'},
      {key: 'avg_win', label: 'Avg Win'},
      {key: 'avg_loss', label: 'Avg Loss'},
      {key: 'best_trade', label: 'Best Trade'},
      {key: 'worst_trade', label: 'Worst Trade'},
    ];

    function fmtVal(val, fmt) {
      if (val == null) return '—';
      if (fmt === 'pct') return formatPercent(val);
      if (fmt === 'num') return val.toFixed(2);
      if (fmt === 'int') return String(val);
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
        '<table class="w-full text-sm"><thead><tr class="border-b border-slate-700 text-slate-400">' +
          '<th class="py-3 px-4 text-left bg-slate-800">Métrique</th>' +
          '<th class="py-3 px-4 text-right bg-slate-800">' + esc(a.name) + '</th>' +
          '<th class="py-3 px-4 text-center bg-slate-800 w-12"></th>' +
          '<th class="py-3 px-4 text-left bg-slate-800">' + esc(b.name) + '</th>' +
        '</tr></thead><tbody>' +
        metricRows.map(function(r) {
          return '<tr class="border-b border-slate-700/50 hover:bg-slate-700/20">' +
            '<td class="py-2.5 px-4 text-slate-300">' + r.label + '</td>' +
            '<td class="py-2.5 px-4 text-right ' + (diff[r.key]==='A' ? 'bg-green-900/20' : '') + '">' + fmtVal(ma[r.key], r.fmt) + (diff[r.key]==='A' ? ' <span class="text-green-400 text-xs">✓</span>' : '') + '</td>' +
            '<td class="py-2.5 px-4 text-center text-slate-600">vs</td>' +
            '<td class="py-2.5 px-4 ' + (diff[r.key]==='B' ? 'bg-green-900/20' : '') + '">' + fmtVal(mb[r.key], r.fmt) + (diff[r.key]==='B' ? ' <span class="text-green-400 text-xs">✓</span>' : '') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="bg-slate-800 border border-slate-700 rounded-xl p-6">' +
          '<h3 class="text-lg font-semibold text-white mb-4">Equity Curves</h3>' +
          '<div style="height:300px"><canvas id="compare-chart"></canvas></div>' +
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
  } catch (err) {
    container.innerHTML = '<p class="text-red-400 text-center">' + esc(err.message) + '</p>';
  }
}
