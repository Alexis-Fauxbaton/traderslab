import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js';

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
export function UnderwaterChart({ underwater, equityCurve }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!underwater || !equityCurve || underwater.length === 0) return;
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const labels = equityCurve.map(p => {
      const d = new Date(p.date);
      return d.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
    });

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Underwater',
          data: underwater,
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
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' }, max: 0 },
        },
      },
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [underwater, equityCurve]);

  if (!underwater || underwater.length < 2) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Underwater (Drawdown)</h3>
      <div style={{ height: 200 }}><canvas ref={canvasRef} /></div>
    </div>
  );
}

/**
 * Distribution Histogram — PnL trade distribution.
 * Props: distribution = { skewness, kurtosis, histogram: [{ bin_start, bin_end, count }, ...] }
 */
export function DistributionHistogram({ distribution }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!distribution?.histogram?.length) return;
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const bins = distribution.histogram;
    const labels = bins.map(b => `${b.bin_start.toFixed(0)}`);
    const data = bins.map(b => b.count);
    const colors = bins.map(b => {
      const mid = (b.bin_start + b.bin_end) / 2;
      return mid >= 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)';
    });

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Trades',
          data,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 15 }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
        },
      },
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [distribution]);

  if (!distribution?.histogram?.length) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Distribution des PnL</h3>
        <div className="flex gap-3 text-xs text-slate-500">
          {distribution.skewness != null && <span>Skew: <span className="text-slate-300">{distribution.skewness.toFixed(2)}</span></span>}
          {distribution.kurtosis != null && <span>Kurt: <span className="text-slate-300">{distribution.kurtosis.toFixed(2)}</span></span>}
        </div>
      </div>
      <div style={{ height: 200 }}><canvas ref={canvasRef} /></div>
      <div className="mt-2 text-[11px] text-slate-600">
        {distribution.skewness != null && distribution.skewness > 0.5 && '📈 Distribution asymétrique positive (queue de gains longs)'}
        {distribution.skewness != null && distribution.skewness < -0.5 && '⚠️ Distribution asymétrique négative (queue de pertes longues)'}
        {distribution.kurtosis != null && distribution.kurtosis > 1 && ' · Fat tails détectées (risque de valeurs extrêmes)'}
      </div>
    </div>
  );
}

/**
 * Pro Metrics Grid — 2x3 grid of extra metric cards.
 * Props: metrics = the backend metrics object
 */
export function ProMetricsGrid({ metrics }) {
  if (!metrics) return null;
  const m = metrics;
  const cards = [
    { label: 'Sortino Ratio', value: m.sortino_ratio, fmt: v => v?.toFixed(2) ?? '—' },
    { label: 'Calmar Ratio', value: m.calmar_ratio, fmt: v => v?.toFixed(2) ?? '—' },
    { label: 'Recovery Factor', value: m.recovery_factor, fmt: v => v?.toFixed(2) ?? '—' },
    { label: 'Risk/Reward', value: m.risk_reward_ratio, fmt: v => v?.toFixed(2) ?? '—' },
    { label: 'Max Win Streak', value: m.max_consecutive_wins, fmt: v => v ?? '—' },
    { label: 'Max Loss Streak', value: m.max_consecutive_losses, fmt: v => v ?? '—' },
    { label: 'Consistance', value: m.consistency_score, fmt: v => v != null ? `${v}/100` : '—' },
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
