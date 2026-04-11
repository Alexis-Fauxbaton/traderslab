import { useEffect, useRef, useState } from 'react';
import { Chart } from 'chart.js';

/**
 * Equity Curve Chart — large PnL evolution line chart with zoom.
 * Props: equityCurve = [{ date, cumulative_pnl }, ...], initialBalance = number
 */
export function EquityChart({ equityCurve, initialBalance: propBalance = 10000 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [mode, setMode] = useState('trade'); // 'trade' | 'day'
  const [dataMode, setDataMode] = useState('pnl'); // 'pnl' | 'equity'

  useEffect(() => {
    if (!equityCurve?.length || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    // Aggregate by day if needed
    let chartPoints;
    if (mode === 'day') {
      const byDay = new Map();
      for (const p of equityCurve) {
        const day = p.date.slice(0, 10);
        byDay.set(day, p.cumulative_pnl);
      }
      chartPoints = Array.from(byDay, ([date, cumulative_pnl]) => ({ date, cumulative_pnl }));
    } else {
      chartPoints = equityCurve;
    }

    const labels = mode === 'trade'
      ? chartPoints.map((p, i) => p.trade_index ?? i + 1)
      : chartPoints.map(p => {
          const d = new Date(p.date);
          return d.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
        });
    const initialBalance = dataMode === 'equity' ? propBalance : 0;
    const values = chartPoints.map(p => p.cumulative_pnl + initialBalance);
    const lastVal = values[values.length - 1];
    const color = (dataMode === 'equity' ? lastVal > initialBalance : lastVal >= 0) ? '#22c55e' : '#ef4444';
    const bgColor = values[values.length - 1] >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Résultat cumulé',
          data: values,
          borderColor: color,
          backgroundColor: bgColor,
          fill: true,
          tension: 0.3,
          pointRadius: values.length > 80 ? 0 : 3,
          pointHoverRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
              label: (ctx) => dataMode === 'equity'
                ? `Capital: ${ctx.parsed.y.toFixed(2)}`
                : `Résultat: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#94a3b8', maxTicksLimit: 15 }, grid: { color: '#1e293b' } },
          y: { beginAtZero: false, ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
        },
      },
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [equityCurve, mode, dataMode]);

  const resetZoom = () => {
    if (chartRef.current) { chartRef.current.resetZoom(); setIsZoomed(false); }
  };

  if (!equityCurve || equityCurve.length < 2) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Évolution du capital</h3>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
            <button onClick={() => setDataMode('pnl')}
              className={`px-3 py-1 transition ${dataMode === 'pnl' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >Résultat</button>
            <button onClick={() => setDataMode('equity')}
              className={`px-3 py-1 transition ${dataMode === 'equity' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >Capital</button>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
            <button onClick={() => setMode('trade')}
              className={`px-3 py-1 transition ${mode === 'trade' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >Par trade</button>
            <button onClick={() => setMode('day')}
              className={`px-3 py-1 transition ${mode === 'day' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >Par jour</button>
          </div>
          {isZoomed && (
            <button onClick={resetZoom} className="text-xs text-blue-400 hover:text-blue-300 transition">Réinitialiser zoom</button>
          )}
        </div>
      </div>
      <div style={{ height: 280 }}><canvas key={dataMode} ref={canvasRef} /></div>
    </div>
  );
}

/**
 * Monthly PnL Heatmap — grille de mois colorée vert/rouge.
 * Props: monthlyBreakdown = [{ month: "2025-01", pnl: 700, trades: 20 }, ...]
 */
export function MonthlyHeatmap({ monthlyBreakdown }) {
  if (!monthlyBreakdown || monthlyBreakdown.length < 2) return null;

  // Group by year → month
  const years = {};
  monthlyBreakdown.forEach(m => {
    const [y, mo] = m.month.split('-');
    if (!years[y]) years[y] = {};
    years[y][parseInt(mo, 10)] = m;
  });

  const monthLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const maxPnl = Math.max(...monthlyBreakdown.map(m => Math.abs(m.pnl)), 1);
  const sortedYears = Object.keys(years).sort();

  const cellColor = (pnl) => {
    const intensity = Math.min(1, Math.abs(pnl) / maxPnl);
    if (pnl >= 0) return `rgba(34, 197, 94, ${0.15 + intensity * 0.6})`;
    return `rgba(239, 68, 68, ${0.15 + intensity * 0.6})`;
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Performance mensuelle</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="py-1 px-2 text-left text-slate-500"></th>
              {monthLabels.map((l, i) => <th key={i} className="py-1 px-1 text-center text-slate-500 font-normal">{l}</th>)}
              <th className="py-1 px-2 text-center text-slate-500 font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedYears.map(year => {
              const yearTotal = Object.values(years[year]).reduce((s, m) => s + m.pnl, 0);
              return (
                <tr key={year}>
                  <td className="py-1 px-2 text-slate-400 font-medium">{year}</td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = years[year][i + 1];
                    if (!m) return <td key={i} className="py-1 px-1"><div className="h-8 rounded bg-slate-700/30"></div></td>;
                    return (
                      <td key={i} className="py-1 px-1">
                        <div className="h-8 rounded flex flex-col items-center justify-center cursor-default"
                          style={{ backgroundColor: cellColor(m.pnl) }}
                          title={`${m.month}: ${m.pnl >= 0 ? '+' : ''}${m.pnl.toFixed(0)} (${m.trades} trades)`}>
                          <span className={`text-[10px] font-medium ${m.pnl >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                            {m.pnl >= 0 ? '+' : ''}{m.pnl.toFixed(0)}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="py-1 px-2 text-center">
                    <span className={`text-xs font-medium ${yearTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {yearTotal >= 0 ? '+' : ''}{yearTotal.toFixed(0)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Underwater Chart — drawdown over time.
 * Props: underwater = [-10, -5, -30, ...], equityCurve = [{ date, cumulative_pnl }, ...]
 */
export function UnderwaterChart({ underwater, underwaterPct, equityCurve }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [mode, setMode] = useState('prix'); // 'prix' | 'pct'

  useEffect(() => {
    if (!underwater || underwater.length === 0) return;
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const isPct = mode === 'pct';
    const hasPct = underwaterPct?.length > 0;
    const data = isPct && hasPct ? underwaterPct : underwater;

    const labels = equityCurve && equityCurve.length === underwater.length
      ? equityCurve.map(p => {
          const d = new Date(p.date);
          return d.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
        })
      : underwater.map((_, i) => i + 1);

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Underwater',
          data,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8', maxTicksLimit: 15 }, grid: { color: '#1e293b' } },
          y: {
            ticks: {
              color: '#94a3b8',
              callback: (isPct && hasPct) ? (v) => v.toFixed(1) + ' %' : undefined,
            },
            grid: { color: '#1e293b' },
            max: 0,
          },
        },
      },
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [underwater, underwaterPct, equityCurve, mode]);

  if (!underwater || underwater.length < 2) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Périodes de perte</h3>
        <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
          <button
            onClick={() => setMode('prix')}
            className={`px-3 py-1 transition ${mode === 'prix' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
          >Montant</button>
          <button
            onClick={() => setMode('pct')}
            className={`px-3 py-1 transition ${mode === 'pct' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
          >%</button>
        </div>
      </div>
      <div style={{ height: 200 }}><canvas ref={canvasRef} /></div>
    </div>
  );
}

/**
 * Pro Metrics Grid — key metric cards for traders.
 * Props: metrics = the backend metrics object
 */
export function ProMetricsGrid({ metrics }) {
  if (!metrics) return null;
  const m = metrics;
  const cards = [
    { label: 'Récupération', value: m.recovery_factor, fmt: v => v?.toFixed(2) ?? '—' },
    { label: 'Ratio risque/gain', value: m.risk_reward_ratio, fmt: v => v?.toFixed(2) ?? '—' },
    { label: 'Série de gains max', value: m.max_consecutive_wins, fmt: v => v ?? '—' },
    { label: 'Série de pertes max', value: m.max_consecutive_losses, fmt: v => v ?? '—' },
  ].filter(c => c.value != null);

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map((c, i) => (
        <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
          <div className="text-[11px] text-slate-500 mb-1">{c.label}</div>
          <div className="text-lg font-semibold text-white">{c.fmt(c.value)}</div>
        </div>
      ))}
    </div>
  );
}
