import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js';

export default function MiniChart({ data, height = 60 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data || data.length === 0) return;
    if (chartRef.current) chartRef.current.destroy();

    const values = data.map(p => p.cumulative_pnl);
    const color = values[values.length - 1] >= 0 ? '#22c55e' : '#ef4444';
    const bgColor = values[values.length - 1] >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(() => ''),
        datasets: [{ data: values, borderColor: color, backgroundColor: bgColor, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: 0 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        interaction: { enabled: false },
      },
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data]);

  return <div style={{ height }}><canvas ref={canvasRef} /></div>;
}
