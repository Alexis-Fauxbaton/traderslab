import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Chart } from 'chart.js';
import API from '../lib/api';
import {
  formatDate, formatDateTime, formatPercent, setCurrentAvgLoss, getUnitSettings,
  buildRunMetrics,
} from '../lib/utils';
import { Breadcrumb, Spinner, PnlSpan, DrawdownSpan, MetricCardLarge } from '../components/UI';
import { EvaluationPanel } from '../components/EvaluationPanel';
import { Evaluation } from '../evaluation';

export default function RunDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [data, setData] = useState(null);
  const [trades, setTrades] = useState(null);
  const [tradesPage, setTradesPage] = useState(1);
  const [tradesMeta, setTradesMeta] = useState(null);
  const [showTrades, setShowTrades] = useState(false);
  const [stratName, setStratName] = useState('Stratégie');
  const [variantName, setVariantName] = useState('Variante');
  const [stratId, setStratId] = useState('');
  const [isZoomed, setIsZoomed] = useState(false);
  const [ddHighlight, setDdHighlight] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener('unitchange', handler);
    return () => window.removeEventListener('unitchange', handler);
  }, []);

  // Load run summary (lightweight — no trades)
  useEffect(() => {
    (async () => {
      const runData = await API.get('/runs/' + id + '/summary');
      setData(runData);
      let sn = 'Stratégie', vn = 'Variante', sid = '';
      try {
        const variant = await API.get('/variants/' + runData.variant_id);
        vn = variant.name; sid = variant.strategy_id;
        sn = variant.strategy_name || sn;
        setVariantName(vn); setStratId(sid); setStratName(sn);
      } catch {}
      try {
        localStorage.setItem('lastVisit', JSON.stringify({
          hash: '/run/' + id, ts: Date.now(),
          crumbs: [{ label: 'Stratégies', href: '#/' }, { label: sn }, { label: vn }, { label: runData.label }],
        }));
      } catch {}
    })();
  }, [id]);

  // Load trades on demand (paginated)
  useEffect(() => {
    if (!showTrades) return;
    (async () => {
      const resp = await API.get('/runs/' + id + '/trades?page=' + tradesPage + '&per_page=100');
      setTrades(prev => tradesPage === 1 ? resp.items : [...(prev || []), ...resp.items]);
      setTradesMeta(resp);
    })();
  }, [showTrades, tradesPage, id]);

  // Equity chart
  useEffect(() => {
    if (!data?.metrics?.equity_curve?.length || !chartRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const m = data.metrics;
    const ec = m.equity_curve;
    const labels = ec.map(p => formatDate(p.date));
    const values = ec.map(p => p.cumulative_pnl);
    const color = values[values.length - 1] >= 0 ? '#22c55e' : '#ef4444';
    const bgColor = values[values.length - 1] >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

    // DD calculation
    const ddData = values.map(() => null);
    let ddStartIdx = -1, ddEndIdx = 0, ddMax = 0, peakVal = 0, peakIdx = -1;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > peakVal) { peakVal = values[i]; peakIdx = i; }
      const dd = peakVal - values[i];
      if (dd > ddMax) { ddMax = dd; ddStartIdx = peakIdx; ddEndIdx = i; }
    }
    if (ddMax > 0) {
      const from = ddStartIdx >= 0 ? ddStartIdx : 0;
      for (let j = from; j <= ddEndIdx; j++) ddData[j] = values[j];
    }

    chartInstanceRef.current = new Chart(chartRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'PnL Cumulé', data: values, borderColor: color, backgroundColor: bgColor, fill: true, tension: 0.3, pointRadius: 3, pointHoverRadius: 6 },
          { label: 'Max Drawdown', data: ddData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.25)', fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#ef4444', borderWidth: 2, borderDash: [4, 2], hidden: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          zoom: {
            zoom: {
              drag: { enabled: true, backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)', borderWidth: 1 },
              mode: 'x',
              onZoom: () => setIsZoomed(true),
            },
          },
        },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
        },
      },
    });

    return () => { if (chartInstanceRef.current) chartInstanceRef.current.destroy(); };
  }, [data]);

  // DD highlight toggle
  useEffect(() => {
    if (chartInstanceRef.current?.data?.datasets?.[1]) {
      chartInstanceRef.current.data.datasets[1].hidden = !ddHighlight;
      chartInstanceRef.current.update();
    }
  }, [ddHighlight]);

  if (!data) return <Spinner />;

  const m = data.metrics || {};
  const _unitSettings = getUnitSettings();
  setCurrentAvgLoss(m.avg_loss);
  const _ddPeak = _unitSettings.initial_balance + (m.dd_peak_equity || 0);

  // Evaluation
  let runEval = null;
  if (Evaluation && m.total_trades !== undefined) {
    try { runEval = Evaluation.evaluateRun(buildRunMetrics(data)); } catch {}
  }

  const handleDelete = async () => {
    if (!confirm('Supprimer ce run ?')) return;
    await API.del('/runs/' + id);
    navigate('/variant/' + data.variant_id);
  };

  const resetZoom = () => {
    chartInstanceRef.current?.resetZoom();
    setIsZoomed(false);
  };

  return (
    <div className="fade-in">
      <Breadcrumb items={[
        { label: 'Stratégies', href: '#/' },
        { label: stratName, href: '#/strategy/' + stratId },
        { label: variantName, href: '#/variant/' + data.variant_id },
        { label: data.label },
      ]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{data.label}</h1>
          <div className="flex gap-3 text-sm text-slate-400 mt-1">
            <span className="uppercase bg-slate-700 px-2 py-0.5 rounded text-xs">{data.type}</span>
            <span>{formatDate(data.start_date)} → {formatDate(data.end_date)}</span>
          </div>
        </div>
        <button onClick={handleDelete} className="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <MetricCardLarge label="Total PnL"><PnlSpan value={m.total_pnl} /></MetricCardLarge>
        <MetricCardLarge label="Trades">{m.total_trades || 0}</MetricCardLarge>
        <MetricCardLarge label="Win Rate">{formatPercent(m.win_rate)}</MetricCardLarge>
        <MetricCardLarge label="Profit Factor">{m.profit_factor != null ? m.profit_factor.toFixed(2) : '—'}</MetricCardLarge>
        <MetricCardLarge label="Max Drawdown"><DrawdownSpan value={m.max_drawdown} ddPeak={_ddPeak} /></MetricCardLarge>
        <MetricCardLarge label="Expectancy"><PnlSpan value={m.expectancy} /></MetricCardLarge>
        <MetricCardLarge label="Avg Win"><PnlSpan value={m.avg_win} /></MetricCardLarge>
        <MetricCardLarge label="Avg Loss"><PnlSpan value={m.avg_loss} /></MetricCardLarge>
        <MetricCardLarge label="Best Trade"><PnlSpan value={m.best_trade} /></MetricCardLarge>
        <MetricCardLarge label="Worst Trade"><PnlSpan value={m.worst_trade} /></MetricCardLarge>
        <MetricCardLarge label="Sharpe (ann.)">{m.sharpe_ratio != null ? m.sharpe_ratio.toFixed(2) : '—'}</MetricCardLarge>
      </div>

      {/* Evaluation */}
      {runEval && <EvaluationPanel result={runEval} title="Évaluation du run" />}

      {/* Equity chart */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Equity Curve</h2>
          <div className="flex items-center gap-3">
            {m.max_drawdown > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input type="checkbox" checked={ddHighlight} onChange={e => setDdHighlight(e.target.checked)} className="accent-red-500" /> Max Drawdown
              </label>
            )}
            {isZoomed && (
              <button onClick={resetZoom} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition">Reset zoom</button>
            )}
          </div>
        </div>
        <div style={{ height: 300 }}><canvas ref={chartRef} /></div>
      </div>

      {/* Trades table — lazy loaded */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Trades ({m.total_trades || 0})</h2>
          {!showTrades && (
            <button onClick={() => setShowTrades(true)} className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded transition">
              Charger les trades
            </button>
          )}
        </div>
        {showTrades && trades && (
          <>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="py-2 px-3 bg-slate-800">Open</th>
                    <th className="py-2 px-3 bg-slate-800">Close</th>
                    <th className="py-2 px-3 bg-slate-800">Symbol</th>
                    <th className="py-2 px-3 bg-slate-800">Side</th>
                    <th className="py-2 px-3 bg-slate-800">Entry</th>
                    <th className="py-2 px-3 bg-slate-800">Exit</th>
                    <th className="py-2 px-3 bg-slate-800">Lots</th>
                    <th className="py-2 px-3 bg-slate-800">PnL</th>
                    <th className="py-2 px-3 bg-slate-800">Pips</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => {
                    return (
                      <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                        <td className="py-2 px-3 text-slate-300">{formatDateTime(t.open_time)}</td>
                        <td className="py-2 px-3 text-slate-300">{formatDateTime(t.close_time)}</td>
                        <td className="py-2 px-3">{t.symbol}</td>
                        <td className="py-2 px-3"><span className={t.side === 'long' ? 'text-green-400' : 'text-red-400'}>{t.side}</span></td>
                        <td className="py-2 px-3">{t.entry_price}</td>
                        <td className="py-2 px-3">{t.exit_price}</td>
                        <td className="py-2 px-3">{t.lot_size}</td>
                        <td className="py-2 px-3"><PnlSpan value={t.pnl} /></td>
                        <td className="py-2 px-3">{t.pips != null ? t.pips : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {tradesMeta && tradesMeta.page < tradesMeta.pages && (
              <div className="mt-3 text-center">
                <button onClick={() => setTradesPage(p => p + 1)} className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded transition">
                  Charger plus ({tradesMeta.total - trades.length} restants)
                </button>
              </div>
            )}
          </>
        )}
        {showTrades && !trades && <Spinner />}
      </div>
    </div>
  );
}
