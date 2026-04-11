import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Chart } from 'chart.js';
import API from '../lib/api';
import {
  formatDate, formatDateTime, formatPercent, setCurrentAvgLoss, getUnitSettings,
} from '../lib/utils';
import { Breadcrumb, Spinner, PnlSpan, DrawdownCard, MetricCardLarge } from '../components/UI';
import { EvaluationPanel } from '../components/EvaluationPanel';
import { ProMetricsGrid, MonthlyHeatmap, UnderwaterChart } from '../components/ProCharts';

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
  const [variantName, setVariantName] = useState('Version');
  const [stratId, setStratId] = useState('');
  const [isZoomed, setIsZoomed] = useState(false);
  const [ddHighlight, setDdHighlight] = useState('off'); // 'off' | 'amount' | 'pct'
  const [equityMode, setEquityMode] = useState('trade'); // 'trade' | 'day'
  const [equityDataMode, setEquityDataMode] = useState('pnl'); // 'pnl' | 'equity'
  const [runEval, setRunEval] = useState(null);
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
      let sn = 'Stratégie', vn = 'Version', sid = '';
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

    // Aggregate by day if needed
    let chartPoints;
    if (equityMode === 'day') {
      const byDay = new Map();
      for (const p of ec) {
        const day = p.date.slice(0, 10); // YYYY-MM-DD
        byDay.set(day, p.cumulative_pnl);
      }
      chartPoints = Array.from(byDay, ([date, cumulative_pnl]) => ({ date, cumulative_pnl }));
    } else {
      chartPoints = ec;
    }

    const labels = equityMode === 'trade'
      ? chartPoints.map((p, i) => p.trade_index ?? i + 1)
      : chartPoints.map(p => formatDate(p.date));
    const initialBalance = equityDataMode === 'equity' ? (data.initial_balance || 10000) : 0;
    const values = chartPoints.map(p => p.cumulative_pnl + initialBalance);
    const lastVal = values[values.length - 1];
    const color = (equityDataMode === 'equity' ? lastVal > initialBalance : lastVal >= 0) ? '#22c55e' : '#ef4444';
    const bgColor = (equityDataMode === 'equity' ? lastVal > initialBalance : lastVal >= 0) ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

    // Running peak per point (for per-point DD tooltip)
    const _balanceForPct = data.initial_balance || 10000;
    const toEquityVal = (v) => equityDataMode === 'equity' ? v : v + _balanceForPct;
    const peaks = [];
    let _runningPeak = values[0];
    for (const v of values) { _runningPeak = Math.max(_runningPeak, v); peaks.push(_runningPeak); }

    // DD zone calculation — different zone for $ vs %
    const ddData = values.map(() => null);
    let ddStartIdx = -1, ddEndIdx = 0;

    if (ddHighlight === 'pct') {
      // Max % DD: find peak-to-trough maximizing (peak - val) / peak_equity
      let ddMaxPct = 0, peakVal = values[0], peakIdx = 0;
      for (let i = 0; i < values.length; i++) {
        const eqPeak = toEquityVal(peakVal);
        if (values[i] > peakVal) { peakVal = values[i]; peakIdx = i; }
        if (eqPeak > 0) {
          const pct = (toEquityVal(peakVal) - toEquityVal(values[i])) / toEquityVal(peakVal);
          if (pct > ddMaxPct) { ddMaxPct = pct; ddStartIdx = peakIdx; ddEndIdx = i; }
        }
      }
    } else {
      // Max $ DD: find peak-to-trough maximizing absolute drawdown
      let ddMax = 0, peakVal = 0, peakIdx = -1;
      for (let i = 0; i < values.length; i++) {
        if (values[i] > peakVal) { peakVal = values[i]; peakIdx = i; }
        const dd = peakVal - values[i];
        if (dd > ddMax) { ddMax = dd; ddStartIdx = peakIdx; ddEndIdx = i; }
      }
    }

    if (ddStartIdx >= 0 && ddEndIdx > ddStartIdx) {
      for (let j = ddStartIdx; j <= ddEndIdx; j++) ddData[j] = values[j];
    }

    chartInstanceRef.current = new Chart(chartRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: equityDataMode === 'equity' ? 'Capital' : 'Résultat cumulé', data: values, borderColor: color, backgroundColor: bgColor, fill: true, tension: 0.3, pointRadius: equityMode === 'day' ? 3 : (values.length > 200 ? 0 : 2), pointHoverRadius: 6 },
          { label: 'Perte max', data: ddData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.25)', fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#ef4444', borderWidth: 2, borderDash: [4, 2], hidden: ddHighlight === 'off' },
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
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                if (ctx.datasetIndex === 1) {
                  const peak = peaks[ctx.dataIndex];
                  if (ddHighlight === 'pct') {
                    const eqVal = toEquityVal(v), eqPeak = toEquityVal(peak);
                    return eqPeak > 0 ? `DD: ${(100 * (eqVal - eqPeak) / eqPeak).toFixed(2)}%` : '—';
                  }
                  return `DD: ${(v - peak).toFixed(2)}`;
                }
                return equityDataMode === 'equity'
                  ? `Capital: ${v.toFixed(2)}`
                  : `Résultat: ${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#94a3b8', maxTicksLimit: equityMode === 'day' ? 15 : undefined }, grid: { color: '#1e293b' } },
          y: { beginAtZero: false, ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
        },
      },
    });

    return () => { if (chartInstanceRef.current) chartInstanceRef.current.destroy(); };
  }, [data, equityMode, equityDataMode, ddHighlight]);

  // Fetch V1 analysis from backend
  useEffect(() => {
    if (!data?.metrics?.total_trades) { setRunEval(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const analysis = await API.get('/analysis/run/' + id);
        if (!cancelled) setRunEval(analysis);
      } catch { if (!cancelled) setRunEval(null); }
    })();
    return () => { cancelled = true; };
  }, [id, data?.metrics?.total_trades]);

  if (!data) return <Spinner />;

  const m = data.metrics || {};
  const _unitSettings = getUnitSettings();
  setCurrentAvgLoss(m.avg_loss);
  const _ddPeak = _unitSettings.initial_balance + (m.dd_peak_equity || 0);

  // True max DD% from backend (computed on full curve with real initial_balance)
  const _maxDdPct = m.max_drawdown_pct_true != null ? -m.max_drawdown_pct_true * 100 : null;

  const handleDelete = async () => {
    if (!confirm('Supprimer ce test ?')) return;
    try {
      await API.del('/runs/' + id);
      navigate('/variant/' + data.variant_id);
    } catch (err) {
      alert('Erreur lors de la suppression : ' + (err.message || err));
    }
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
        <MetricCardLarge label="Résultat net"><PnlSpan value={m.total_pnl} /></MetricCardLarge>
        <MetricCardLarge label="Trades">{m.total_trades || 0}</MetricCardLarge>
        <MetricCardLarge label="Taux de réussite">{formatPercent(m.win_rate)}</MetricCardLarge>
        <MetricCardLarge label="Ratio gains/pertes">{m.profit_factor != null ? m.profit_factor.toFixed(2) : '—'}</MetricCardLarge>
        <DrawdownCard value={m.max_drawdown} ddPeak={_ddPeak} pctTrue={m.max_drawdown_pct_true} size="lg" />
        <MetricCardLarge label="Gain moyen/trade"><PnlSpan value={m.expectancy} /></MetricCardLarge>
        <MetricCardLarge label="Gain moyen"><PnlSpan value={m.avg_win} /></MetricCardLarge>
        <MetricCardLarge label="Perte moyenne"><PnlSpan value={m.avg_loss} /></MetricCardLarge>
        <MetricCardLarge label="Meilleur trade"><PnlSpan value={m.best_trade} /></MetricCardLarge>
        <MetricCardLarge label="Pire trade"><PnlSpan value={m.worst_trade} /></MetricCardLarge>
        <MetricCardLarge label="Sharpe">{m.sharpe_ratio != null ? m.sharpe_ratio.toFixed(2) : '—'}</MetricCardLarge>
      </div>

      {/* Evaluation */}
      {runEval && <EvaluationPanel result={runEval} title="Évaluation du test" />}

      {/* Pro metrics */}
      <ProMetricsGrid metrics={m} />

      {/* Monthly heatmap */}
      <MonthlyHeatmap monthlyBreakdown={m.monthly_breakdown} />

      {/* Equity chart */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Courbe de capital</h2>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
              <button onClick={() => setEquityDataMode('pnl')}
                className={`px-3 py-1 transition ${equityDataMode === 'pnl' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
              >Résultat</button>
              <button onClick={() => setEquityDataMode('equity')}
                className={`px-3 py-1 transition ${equityDataMode === 'equity' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
              >Capital</button>
            </div>
            <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
              <button onClick={() => setEquityMode('trade')}
                className={`px-3 py-1 transition ${equityMode === 'trade' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
              >Par trade</button>
              <button onClick={() => setEquityMode('day')}
                className={`px-3 py-1 transition ${equityMode === 'day' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
              >Par jour</button>
            </div>
            {m.max_drawdown > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Perte max</span>
                <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
                  <button onClick={() => setDdHighlight('off')}
                    className={`px-2.5 py-1 transition ${ddHighlight === 'off' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>Off</button>
                  <button onClick={() => setDdHighlight('amount')}
                    className={`px-2.5 py-1 transition ${ddHighlight === 'amount' ? 'bg-red-900/50 text-red-300' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>Montant</button>
                  <button onClick={() => setDdHighlight('pct')}
                    className={`px-2.5 py-1 transition ${ddHighlight === 'pct' ? 'bg-red-900/50 text-red-300' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>%</button>
                </div>
                {ddHighlight !== 'off' && (
                  <span className="text-xs font-medium text-red-400">
                    {ddHighlight === 'pct'
                      ? (_maxDdPct != null ? `-${_maxDdPct.toFixed(2)}%` : '—')
                      : `-${m.max_drawdown.toFixed(2)}`}
                  </span>
                )}
              </div>
            )}
            {isZoomed && (
              <button onClick={resetZoom} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition">Reset zoom</button>
            )}
          </div>
        </div>
        <div style={{ height: 300 }}><canvas key={equityDataMode} ref={chartRef} /></div>
      </div>

      {/* Underwater */}
      <UnderwaterChart underwater={m.underwater} underwaterPct={m.underwater_pct} equityCurve={m.equity_curve} />

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
                    <th className="py-2 px-3 bg-slate-800">Ouverture</th>
                    <th className="py-2 px-3 bg-slate-800">Fermeture</th>
                    <th className="py-2 px-3 bg-slate-800">Actif</th>
                    <th className="py-2 px-3 bg-slate-800">Sens</th>
                    <th className="py-2 px-3 bg-slate-800">Entrée</th>
                    <th className="py-2 px-3 bg-slate-800">Sortie</th>
                    <th className="py-2 px-3 bg-slate-800">Lots</th>
                    <th className="py-2 px-3 bg-slate-800">Résultat</th>
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
