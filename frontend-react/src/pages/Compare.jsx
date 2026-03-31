import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chart, registerables } from 'chart.js';
import flatpickr from 'flatpickr';
import { French } from 'flatpickr/dist/l10n/fr.js';
import API from '../lib/api';
import { useSidebar } from '../hooks/useSidebar';
import {
  formatDate, formatPercent, setCurrentAvgLoss, getUnitSettings,
  STATUS_LABELS, buildVariantMetricsForCompare,
} from '../lib/utils';
import { Spinner, StatusBadge, PnlSpan, DrawdownSpan } from '../components/UI';
import { ComparisonEvaluationPanel } from '../components/EvaluationPanel';
import { Evaluation } from '../evaluation';

Chart.register(...registerables);

// Temporal analysis helpers
function getBucketKey(dateStr, granularity) {
  const d = new Date(dateStr);
  if (granularity === 'day') return d.toISOString().slice(0, 10);
  if (granularity === 'week') {
    const tmp = new Date(d.getTime());
    const day = tmp.getDay() || 7;
    tmp.setDate(tmp.getDate() + 4 - day);
    const yearStart = new Date(tmp.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    return tmp.getFullYear() + '-W' + String(weekNo).padStart(2, '0');
  }
  if (granularity === 'month') return dateStr.slice(0, 7);
  if (granularity === 'year') return dateStr.slice(0, 4);
  return dateStr.slice(0, 7);
}

function formatBucketLabel(key, granularity) {
  const months = ['janv', 'fév', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  if (granularity === 'day') {
    const p = key.split('-');
    return parseInt(p[2], 10) + ' ' + months[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2);
  }
  if (granularity === 'week') return key;
  if (granularity === 'month') {
    const p = key.split('-');
    return months[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2);
  }
  return key;
}

function aggregateTrades(trades, granularity) {
  const buckets = {};
  trades.forEach(t => {
    const key = getBucketKey(t.date, granularity);
    if (!buckets[key]) buckets[key] = { count: 0, pnl: 0 };
    buckets[key].count += 1;
    buckets[key].pnl += t.pnl;
  });
  return buckets;
}

function DropZone({ slot, label, data, onDrop, onClear }) {
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; e.currentTarget.classList.add('drag-over'); };
  const handleDragLeave = (e) => e.currentTarget.classList.remove('drag-over');
  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const variantId = e.dataTransfer.getData('application/x-variant-id');
    const variantName = e.dataTransfer.getData('application/x-variant-name');
    const stratName = e.dataTransfer.getData('application/x-strategy-name');
    if (variantId) onDrop({ id: variantId, name: variantName, strategyName: stratName });
  };

  return (
    <div>
      <label className="text-sm text-slate-400 block mb-2">{label}</label>
      <div
        className={`compare-drop ${data ? 'has-variant' : ''} bg-slate-800 rounded-xl p-4 flex items-center justify-center`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      >
        {data ? (
          <div className="flex items-center justify-between w-full">
            <div>
              <span className="text-xs text-slate-500">{data.strategyName}</span><br />
              <span className="text-white font-medium">{data.name}</span>
            </div>
            <button onClick={onClear} className="text-xs text-red-400 hover:text-red-300">✕</button>
          </div>
        ) : (
          <span className="text-slate-500 text-sm">Déposez une variante ici</span>
        )}
      </div>
    </div>
  );
}

export default function Compare({ slotA, slotB, setSlotA, setSlotB }) {
  const { sidebarData } = useSidebar();
  const [allVariants, setAllVariants] = useState([]);
  const [compData, setCompData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [periodMode, setPeriodMode] = useState('common');
  const [granularity, setGranularity] = useState('month');
  // Refs for charts
  const compareChartRef = useRef(null);
  const compareChartInstance = useRef(null);
  const countChartRef = useRef(null);
  const countChartInstance = useRef(null);
  const pnlChartRef = useRef(null);
  const pnlChartInstance = useRef(null);

  // Date refs
  const dateStartRef = useRef(null);
  const dateEndRef = useRef(null);
  const dateStartARef = useRef(null);
  const dateEndARef = useRef(null);
  const dateStartBRef = useRef(null);
  const dateEndBRef = useRef(null);

  // Build variant list from sidebar data
  useEffect(() => {
    const vars = [];
    if (sidebarData.length > 0) {
      sidebarData.forEach(s => {
        s.variants?.forEach(v => {
          vars.push({ id: v.id, name: v.name, strategyName: s.name });
        });
      });
    }
    setAllVariants(vars);
  }, [sidebarData]);

  // Init flatpickr
  useEffect(() => {
    const opts = { locale: French, dateFormat: 'Y-m-d', allowInput: true, theme: 'dark' };
    [dateStartRef, dateEndRef, dateStartARef, dateEndARef, dateStartBRef, dateEndBRef].forEach(ref => {
      if (ref.current) flatpickr(ref.current, opts);
    });
  }, []);

  const getPeriodParams = useCallback(() => {
    let params = '';
    if (periodMode === 'common') {
      const s = dateStartRef.current?.value;
      const e = dateEndRef.current?.value;
      if (s) params += '&start_date=' + s;
      if (e) params += '&end_date=' + e;
    } else {
      const sa = dateStartARef.current?.value, ea = dateEndARef.current?.value;
      const sb = dateStartBRef.current?.value, eb = dateEndBRef.current?.value;
      if (sa) params += '&start_date_a=' + sa;
      if (ea) params += '&end_date_a=' + ea;
      if (sb) params += '&start_date_b=' + sb;
      if (eb) params += '&end_date_b=' + eb;
    }
    return params;
  }, [periodMode]);

  const loadComparison = useCallback(async (periodParams) => {
    if (!slotA || !slotB) return;
    setLoading(true);
    try {
      const url = '/compare?variant_a=' + slotA.id + '&variant_b=' + slotB.id + (periodParams || '');
      setCompData(await API.get(url));
    } catch (err) {
      setCompData(null);
      alert(err.message);
    }
    setLoading(false);
  }, [slotA, slotB]);

  // Auto-load on slot change
  useEffect(() => {
    if (slotA && slotB) loadComparison();
  }, [slotA?.id, slotB?.id]);

  // Render charts when comparison data changes
  useEffect(() => {
    if (!compData) return;
    const a = compData.variant_a, b = compData.variant_b;
    const ecA = a.latest_run?.equity_curve || [];
    const ecB = b.latest_run?.equity_curve || [];

    // Equity curves chart
    if ((ecA.length > 0 || ecB.length > 0) && compareChartRef.current) {
      if (compareChartInstance.current) compareChartInstance.current.destroy();
      const dateSet = {};
      ecA.forEach(p => { dateSet[p.date] = true; });
      ecB.forEach(p => { dateSet[p.date] = true; });
      const allDates = Object.keys(dateSet).sort();
      const mapA = {}, mapB = {};
      ecA.forEach(p => { mapA[p.date] = p.cumulative_pnl; });
      ecB.forEach(p => { mapB[p.date] = p.cumulative_pnl; });

      compareChartInstance.current = new Chart(compareChartRef.current.getContext('2d'), {
        type: 'line',
        data: {
          labels: allDates.map(d => formatDate(d)),
          datasets: [
            { label: a.name, data: allDates.map(d => mapA[d] ?? null), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, pointRadius: 2, spanGaps: true },
            { label: b.name, data: allDates.map(d => mapB[d] ?? null), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.3, pointRadius: 2, spanGaps: true },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } },
        },
      });
    }

    // Temporal charts
    renderTemporalCharts(a, b, granularity);

    return () => {
      if (compareChartInstance.current) compareChartInstance.current.destroy();
      if (countChartInstance.current) countChartInstance.current.destroy();
      if (pnlChartInstance.current) pnlChartInstance.current.destroy();
    };
  }, [compData]);

  // Re-render temporal charts when granularity changes
  useEffect(() => {
    if (compData) renderTemporalCharts(compData.variant_a, compData.variant_b, granularity);
  }, [granularity]);

  const renderTemporalCharts = (a, b, g) => {
    if (countChartInstance.current) countChartInstance.current.destroy();
    if (pnlChartInstance.current) pnlChartInstance.current.destroy();
    if (!countChartRef.current || !pnlChartRef.current) return;

    const tradesA = a.latest_run?.trades || [];
    const tradesB = b.latest_run?.trades || [];
    if (!tradesA.length && !tradesB.length) return;

    const bucketsA = aggregateTrades(tradesA, g);
    const bucketsB = aggregateTrades(tradesB, g);
    const keySet = {};
    Object.keys(bucketsA).forEach(k => { keySet[k] = true; });
    Object.keys(bucketsB).forEach(k => { keySet[k] = true; });
    const allKeys = Object.keys(keySet).sort();
    if (!allKeys.length) return;

    const labels = allKeys.map(k => formatBucketLabel(k, g));
    const cA = allKeys.map(k => bucketsA[k]?.count || 0);
    const cB = allKeys.map(k => bucketsB[k]?.count || 0);
    const pA = allKeys.map(k => bucketsA[k] ? Math.round(bucketsA[k].pnl * 100) / 100 : 0);
    const pB = allKeys.map(k => bucketsB[k] ? Math.round(bucketsB[k].pnl * 100) / 100 : 0);

    const chartOpts = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } } },
      scales: {
        x: { ticks: { color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 30 }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
      },
    };

    countChartInstance.current = new Chart(countChartRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: a.name, data: cA, backgroundColor: 'rgba(59,130,246,0.7)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3 },
          { label: b.name, data: cB, backgroundColor: 'rgba(245,158,11,0.7)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: chartOpts,
    });

    pnlChartInstance.current = new Chart(pnlChartRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: a.name, data: pA, backgroundColor: pA.map(v => v >= 0 ? 'rgba(59,130,246,0.7)' : 'rgba(59,130,246,0.3)'), borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3 },
          { label: b.name, data: pB, backgroundColor: pB.map(v => v >= 0 ? 'rgba(245,158,11,0.7)' : 'rgba(245,158,11,0.3)'), borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: chartOpts,
    });
  };

  const handleSelectA = (e) => {
    const val = e.target.value;
    setSlotA(val ? allVariants.find(v => String(v.id) === val) || null : null);
  };
  const handleSelectB = (e) => {
    const val = e.target.value;
    setSlotB(val ? allVariants.find(v => String(v.id) === val) || null : null);
  };

  const _unitSettings = getUnitSettings();

  // Metric formatting helpers
  const fmtVal = (val, fmt, ddPeak, avgLoss) => {
    if (val == null) return '—';
    if (fmt === 'pct') return formatPercent(val);
    if (fmt === 'num') return val.toFixed(2);
    if (fmt === 'int') return String(val);
    setCurrentAvgLoss(avgLoss);
    if (fmt === 'dd') return <DrawdownSpan value={val} ddPeak={_unitSettings.initial_balance + (ddPeak || 0)} />;
    return <PnlSpan value={val} />;
  };

  const metricRows = [
    { key: 'total_pnl', label: 'Total PnL' },
    { key: 'total_trades', label: 'Trades', fmt: 'int' },
    { key: 'win_rate', label: 'Win Rate', fmt: 'pct' },
    { key: 'profit_factor', label: 'Profit Factor', fmt: 'num' },
    { key: 'max_drawdown', label: 'Max Drawdown', fmt: 'dd' },
    { key: 'expectancy', label: 'Expectancy' },
    { key: 'avg_win', label: 'Avg Win' },
    { key: 'avg_loss', label: 'Avg Loss' },
    { key: 'best_trade', label: 'Best Trade' },
    { key: 'worst_trade', label: 'Worst Trade' },
    { key: 'sharpe_ratio', label: 'Sharpe (ann.)', fmt: 'num' },
  ];

  // Comparison evaluation
  let compEval = null;
  if (compData && Evaluation) {
    const a = compData.variant_a, b = compData.variant_b;
    const ma = a.latest_run?.metrics || {}, mb = b.latest_run?.metrics || {};
    try {
      const _tA = a.latest_run?.trades || [], _tB = b.latest_run?.trades || [];
      const _vmA = buildVariantMetricsForCompare(a, a.latest_run ? ma : null, _tA);
      const _vmB = buildVariantMetricsForCompare(b, b.latest_run ? mb : null, _tB);
      if (_vmA && _vmB) compEval = Evaluation.evaluateVariantComparison({ variantA: _vmA, variantB: _vmB });
    } catch {}
  }

  return (
    <div className="fade-in">
      <h1 className="text-2xl font-bold text-white mb-2">Comparer des Variantes</h1>
      <p className="text-sm text-slate-400 mb-6">Glissez des variantes depuis la sidebar ou sélectionnez-les ci-dessous.</p>

      {/* Drop zones + selects */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <DropZone slot="a" label="Variante A" data={slotA} onDrop={setSlotA} onClear={() => setSlotA(null)} />
          <select value={slotA?.id || ''} onChange={handleSelectA} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white mt-2">
            <option value="">Ou sélectionner...</option>
            {allVariants.map(v => <option key={v.id} value={v.id}>[{v.strategyName}] {v.name}</option>)}
          </select>
        </div>
        <div>
          <DropZone slot="b" label="Variante B" data={slotB} onDrop={setSlotB} onClear={() => setSlotB(null)} />
          <select value={slotB?.id || ''} onChange={handleSelectB} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white mt-2">
            <option value="">Ou sélectionner...</option>
            {allVariants.map(v => <option key={v.id} value={v.id}>[{v.strategyName}] {v.name}</option>)}
          </select>
        </div>
      </div>

      {/* Period filter */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Filtrer par période</h3>
          <div className="flex gap-2">
            <button onClick={() => setPeriodMode('common')} className={`text-xs px-3 py-1 rounded-lg border transition ${periodMode === 'common' ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white'}`}>Période commune</button>
            <button onClick={() => setPeriodMode('individual')} className={`text-xs px-3 py-1 rounded-lg border transition ${periodMode === 'individual' ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white'}`}>Par variante</button>
          </div>
        </div>

        {periodMode === 'common' && (
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs text-slate-400 block mb-1">Début</label><input ref={dateStartRef} type="text" placeholder="AAAA-MM-JJ" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" /></div>
            <div><label className="text-xs text-slate-400 block mb-1">Fin</label><input ref={dateEndRef} type="text" placeholder="AAAA-MM-JJ" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" /></div>
          </div>
        )}

        {periodMode === 'individual' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-700 rounded-lg p-3">
              <span className="text-xs text-blue-400 font-medium block mb-2">Variante A</span>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-slate-400 block mb-1">Début</label><input ref={dateStartARef} type="text" placeholder="AAAA-MM-JJ" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" /></div>
                <div><label className="text-xs text-slate-400 block mb-1">Fin</label><input ref={dateEndARef} type="text" placeholder="AAAA-MM-JJ" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" /></div>
              </div>
            </div>
            <div className="border border-slate-700 rounded-lg p-3">
              <span className="text-xs text-amber-400 font-medium block mb-2">Variante B</span>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-slate-400 block mb-1">Début</label><input ref={dateStartBRef} type="text" placeholder="AAAA-MM-JJ" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" /></div>
                <div><label className="text-xs text-slate-400 block mb-1">Fin</label><input ref={dateEndBRef} type="text" placeholder="AAAA-MM-JJ" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none" /></div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-3">
          <button onClick={() => loadComparison(getPeriodParams())} className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg transition">Appliquer</button>
          <button onClick={() => {
            [dateStartRef, dateEndRef, dateStartARef, dateEndARef, dateStartBRef, dateEndBRef].forEach(r => { if (r.current) r.current.value = ''; });
            if (slotA && slotB) loadComparison();
          }} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 ml-2 transition">Réinitialiser</button>
        </div>
      </div>

      {/* Results */}
      {loading && <Spinner />}

      {compData && !loading && (() => {
        const a = compData.variant_a, b = compData.variant_b;
        const ma = a.latest_run?.metrics || {}, mb = b.latest_run?.metrics || {};
        const diff = compData.diff || {};

        return (
          <>
            {/* Variant info cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1"><h3 className="font-semibold text-white">{a.name}</h3><StatusBadge status={a.status} /></div>
                <p className="text-xs text-slate-400 mb-1">Hypothèse: {a.hypothesis || '—'}</p>
                <p className="text-xs text-slate-400">Décision: {a.decision || '—'}</p>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1"><h3 className="font-semibold text-white">{b.name}</h3><StatusBadge status={b.status} /></div>
                <p className="text-xs text-slate-400 mb-1">Hypothèse: {b.hypothesis || '—'}</p>
                <p className="text-xs text-slate-400">Décision: {b.decision || '—'}</p>
              </div>
            </div>

            {(!a.latest_run && !b.latest_run) ? (
              <p className="text-center text-slate-400 py-8">Aucun run disponible pour la comparaison</p>
            ) : (
              <>
                {/* Metrics table */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden mb-6">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400">
                        <th className="py-3 px-4 text-left bg-slate-800" style={{ width: '20%' }}>Métrique</th>
                        <th className="py-3 px-4 text-center bg-slate-800" style={{ width: '35%' }}>{a.name}</th>
                        <th className="py-3 px-4 text-center bg-slate-800" style={{ width: '6%' }}></th>
                        <th className="py-3 px-4 text-center bg-slate-800" style={{ width: '35%' }}>{b.name}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metricRows.map(r => (
                        <tr key={r.key} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="py-2.5 px-4 text-slate-300">{r.label}</td>
                          <td className={`py-2.5 px-4 text-center ${diff[r.key] === 'A' ? 'bg-green-900/20' : ''}`}>
                            {fmtVal(ma[r.key], r.fmt, ma.dd_peak_equity, ma.avg_loss)}
                            {diff[r.key] === 'A' && <span className="text-green-400 text-xs ml-1">✓</span>}
                          </td>
                          <td className="py-2.5 px-4 text-center text-slate-600">vs</td>
                          <td className={`py-2.5 px-4 text-center ${diff[r.key] === 'B' ? 'bg-green-900/20' : ''}`}>
                            {fmtVal(mb[r.key], r.fmt, mb.dd_peak_equity, mb.avg_loss)}
                            {diff[r.key] === 'B' && <span className="text-green-400 text-xs ml-1">✓</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Comparison evaluation */}
                {compEval && <ComparisonEvaluationPanel result={compEval} nameA={a.name} nameB={b.name} />}

                {/* Equity curves */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Equity Curves</h3>
                  <div style={{ height: 300 }}><canvas ref={compareChartRef} /></div>
                </div>

                {/* Temporal analysis */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-white">Analyse temporelle</h3>
                    <div className="flex gap-1">
                      {['day', 'week', 'month', 'year'].map(g => (
                        <button key={g} onClick={() => setGranularity(g)}
                          className={`text-xs px-3 py-1 rounded-lg border transition ${granularity === g ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white'}`}>
                          {g === 'day' ? 'Jour' : g === 'week' ? 'Semaine' : g === 'month' ? 'Mois' : 'Année'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs text-slate-400 mb-2">Nombre de trades</h4>
                      <div style={{ height: 250 }}><canvas ref={countChartRef} /></div>
                    </div>
                    <div>
                      <h4 className="text-xs text-slate-400 mb-2">PnL</h4>
                      <div style={{ height: 250 }}><canvas ref={pnlChartRef} /></div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        );
      })()}
    </div>
  );
}
