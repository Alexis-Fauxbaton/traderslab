import { STATUS_LABELS, formatPnlRaw, formatDrawdownRaw, formatPercent, normalizeRichValue } from '../lib/utils';

export function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  return <span className={`status-${status} text-xs font-medium px-2.5 py-0.5 rounded-full`}>{label}</span>;
}

export function Breadcrumb({ items }) {
  return (
    <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6 flex-wrap">
      {items.map((item, i) => {
        if (i < items.length - 1) {
          return (
            <span key={i}>
              <a href={item.href} className="hover:text-white transition">{item.label}</a>
              <span className="text-slate-600 ml-2">›</span>
            </span>
          );
        }
        return <span key={i} className="text-slate-200">{item.label}</span>;
      })}
    </nav>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}

export function EmptyState({ message, actionLabel, actionHref }) {
  return (
    <div className="text-center py-16 text-slate-400">
      <p className="text-lg mb-4">{message}</p>
      {actionLabel && (
        <a href={actionHref} className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition">
          {actionLabel}
        </a>
      )}
    </div>
  );
}

export function PnlSpan({ value, denom }) {
  const { text, cls } = formatPnlRaw(value, denom);
  return <span className={cls}>{text}</span>;
}

export function DrawdownSpan({ value, ddPeak }) {
  const { text, cls } = formatDrawdownRaw(value, ddPeak);
  return <span className={cls}>{text}</span>;
}

export function RichDisplay({ value }) {
  if (!value) return <span className="text-slate-600 italic">non renseigné</span>;
  const html = normalizeRichValue(value);
  if (!html || !html.trim()) return <span className="text-slate-600 italic">non renseigné</span>;
  return <div className="rich-display" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MetricCard({ label, children }) {
  return (
    <div className="metric-card bg-slate-700/40 rounded-lg px-3 py-2 text-center">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-white">{children}</div>
    </div>
  );
}

export function MetricCardLarge({ label, children }) {
  return (
    <div className="metric-card bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-semibold">{children}</div>
    </div>
  );
}
