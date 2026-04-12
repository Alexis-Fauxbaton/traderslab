import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import API from '../lib/api';
import { useSidebar } from '../hooks/useSidebar';
import {
  formatDate, formatPercent, setCurrentAvgLoss, getUnitSettings,
  STATUS_LABELS, normalizeRichValue, richTextPlain,
} from '../lib/utils';
import { Breadcrumb, Spinner, StatusBadge, PnlSpan, DrawdownCard, RichDisplay, MetricCard, EmptyState } from '../components/UI';
import { EvaluationPanel } from '../components/EvaluationPanel';
import { MonthlyHeatmap, UnderwaterChart, EquityChart } from '../components/ProCharts';
import Modal, { InputField, TextareaField, SelectField, RichTextField, getRichValue } from '../components/Modal';
import MT5ConnectForm from '../components/MT5ConnectForm';

function LineageTree({ node, currentId, depth = 0 }) {
  const isCurrent = node.id === currentId;
  return (
    <>
      <div style={{ marginLeft: depth * 24 }} className="flex items-center gap-2 py-1">
        {depth > 0 && <span className="text-slate-600">└─</span>}
        <Link to={'/variant/' + node.id} className={(isCurrent ? 'text-blue-400 font-semibold' : 'text-slate-300 hover:text-white') + ' transition'}>
          {node.name}
        </Link>
        <StatusBadge status={node.status} />
      </div>
      {node.children?.map(c => <LineageTree key={c.id} node={c} currentId={currentId} depth={depth + 1} />)}
    </>
  );
}

function InlineRichEditor({ value, onSave, onCancel }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.innerHTML = normalizeRichValue(value) || '';
      contentRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(contentRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const handleCmd = (cmd) => (e) => {
    e.preventDefault();
    contentRef.current.focus();
    document.execCommand(cmd, false, null);
  };

  const doSave = useCallback(() => {
    const html = contentRef.current?.innerHTML?.trim() || '';
    const text = contentRef.current?.textContent?.trim() || '';
    onSave(!text ? '' : html);
  }, [onSave]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); doSave(); }
    if (e.key === 'Tab') {
      const node = window.getSelection()?.anchorNode;
      const el = node?.nodeType === 3 ? node.parentElement : node;
      if (el?.closest('li')) { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null); }
    }
  };

  return (
    <div className="inline-rich-editor">
      <div className="rich-toolbar inline-rich-toolbar">
        <button type="button" onMouseDown={handleCmd('bold')} title="Gras"><strong>G</strong></button>
        <button type="button" onMouseDown={handleCmd('italic')} title="Italique"><em>I</em></button>
        <button type="button" onMouseDown={handleCmd('underline')} title="Souligné"><u>S</u></button>
        <span className="rich-sep"></span>
        <button type="button" onMouseDown={handleCmd('insertUnorderedList')} title="Puces">• ≡</button>
        <button type="button" onMouseDown={handleCmd('insertOrderedList')} title="Numérotée">1.</button>
      </div>
      <div ref={contentRef} className="rich-content inline-rich-content" contentEditable="true" onKeyDown={handleKeyDown} data-placeholder="Saisissez du texte…" />
      <div className="inline-rich-footer px-2 py-1 flex items-center justify-between border-t border-slate-700">
        <span className="text-xs text-slate-500">Ctrl+↵ · Échap pour annuler</span>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); doSave(); }} className="inline-save-btn text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition">Valider ✓</button>
      </div>
    </div>
  );
}

function EditableCard({ label, field, value, data, variantId, onUpdate, isRich = true }) {
  const [editing, setEditing] = useState(false);
  const noValue = <span className="text-slate-600 italic">non renseigné</span>;

  const handleSave = async (newVal) => {
    setEditing(false);
    const patch = { [field]: newVal };
    try { await API.put('/variants/' + variantId, patch); onUpdate(field, newVal); } catch {}
  };

  if (editing && isRich) {
    return (
      <div className="bg-slate-700/30 rounded-lg px-4 py-3">
        <div className="text-slate-500 text-xs mb-1">{label}</div>
        <InlineRichEditor value={value} onSave={handleSave} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  if (editing && !isRich) {
    return (
      <div className="bg-slate-700/30 rounded-lg px-4 py-3">
        <div className="text-slate-500 text-xs mb-1">{label}</div>
        <InlineTextInput value={richTextPlain(value)} onSave={handleSave} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  const extraClass = field === 'key_change' ? 'bg-blue-900/20 border border-blue-700/40' : 'bg-slate-700/30';

  return (
    <div className={`${extraClass} rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-600/30 transition group`} onClick={() => setEditing(true)}>
      <div className="text-slate-500 text-xs mb-1 flex items-center gap-1.5">
        {label}
        <span className="opacity-0 group-hover:opacity-60 text-[9px] transition">✎</span>
      </div>
      <div>
        {isRich ? (value ? <RichDisplay value={value} /> : noValue)
          : (value ? <span className="text-blue-200 font-medium">{richTextPlain(value)}</span> : noValue)}
      </div>
    </div>
  );
}

function InlineTextInput({ value, onSave, onCancel }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) { inputRef.current.focus(); inputRef.current.setSelectionRange(value?.length || 0, value?.length || 0); }
  }, []);
  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={value || ''}
      className="inline-input w-full bg-slate-700 text-slate-200 text-sm rounded px-2 py-1 outline-none border border-blue-500"
      onBlur={(e) => onSave(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

export default function VariantDetail({ setCompareSlotA }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { reload, sidebarData } = useSidebar();
  const [data, setData] = useState(null);
  const [aggMetrics, setAggMetrics] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [stratName, setStratName] = useState('Stratégie');
  const [parentName, setParentName] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [textFieldsOpen, setTextFieldsOpen] = useState(false);
  const [variantEval, setVariantEval] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPromoteConfirm, setShowPromoteConfirm] = useState(false);
  const [mt5Conns, setMt5Conns] = useState([]);
  const [showImportChoice, setShowImportChoice] = useState(false);
  const [showMT5Form, setShowMT5Form] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener('unitchange', handler);
    return () => window.removeEventListener('unitchange', handler);
  }, []);

  useEffect(() => {
    (async () => {
      const varData = await API.get('/variants/' + id);
      setData(varData);
      setAggMetrics(varData.aggregate_metrics || null);
      setStratName(varData.strategy_name || 'Stratégie');
      setParentName(varData.parent_variant_name || null);
      setLineage(varData.lineage || null);

      const hasContent = !!(varData.change_reason || varData.changes || varData.hypothesis || varData.decision || varData.description);
      setTextFieldsOpen(hasContent);

      try {
        localStorage.setItem('lastVisit', JSON.stringify({
          hash: '/variant/' + id, ts: Date.now(),
          crumbs: [{ label: 'Stratégies', href: '#/' }, { label: varData.strategy_name || 'Stratégie', href: '#/strategy/' + varData.strategy_id }, { label: varData.name }],
        }));
      } catch {}
    })();
    (async () => {
      try {
        const conns = await API.get('/mt5/connections');
        setMt5Conns(conns.filter(c => c.variant_id === id && c.status !== 'disconnected'));
      } catch { setMt5Conns([]); }
    })();
  }, [id]);

  const reloadMt5 = useCallback(async () => {
    try {
      const conns = await API.get('/mt5/connections');
      setMt5Conns(conns.filter(c => c.variant_id === id && c.status !== 'disconnected'));
    } catch { setMt5Conns([]); }
  }, [id]);

  // Fetch V1 analysis from backend
  useEffect(() => {
    if (!aggMetrics || !aggMetrics.total_trades) { setVariantEval(null); return; }
    (async () => {
      try {
        const analysis = await API.get('/analysis/variant/' + id);
        setVariantEval(analysis);
      } catch { setVariantEval(null); }
    })();
  }, [id, aggMetrics]);

  if (!data) return <Spinner />;

  const isRoot = !data.parent_variant_id;
  const _unitSettings = getUnitSettings();

  // Update field locally
  const handleFieldUpdate = (field, newVal) => {
    setData(prev => ({ ...prev, [field]: newVal }));
  };

  if (aggMetrics) setCurrentAvgLoss(aggMetrics.avg_loss);
  const ddPeak = _unitSettings.initial_balance + (aggMetrics?.dd_peak_equity || 0);
  const rr = (aggMetrics?.avg_win && aggMetrics?.avg_loss && aggMetrics.avg_loss !== 0) ? Math.abs(aggMetrics.avg_win / aggMetrics.avg_loss) : null;

  const handleEdit = async (fd) => {
    await API.put('/variants/' + id, {
      name: fd.get('name'),
      key_change: fd.get('key_change') || '',
      change_reason: fd.get('change_reason') || '',
      description: getRichValue('description'),
      hypothesis: getRichValue('hypothesis'),
      changes: getRichValue('changes'),
      decision: getRichValue('decision'),
      status: fd.get('status'),
    });
    await reload();
    setShowEdit(false);
    const updated = await API.get('/variants/' + id);
    setData(updated);
  };

  const handleDuplicate = async (fd) => {
    await API.post('/variants', {
      strategy_id: data.strategy_id,
      name: fd.get('name'),
      key_change: fd.get('key_change') || '',
      change_reason: fd.get('change_reason') || '',
      description: data.description || '',
      hypothesis: data.hypothesis || '',
      changes: data.changes || '',
      decision: '',
      parent_variant_id: data.id,
      status: 'idea',
    });
    await reload();
    setShowDuplicate(false);
    const updated = await API.get('/variants/' + id);
    setData(updated);
  };

  const handlePromote = async () => {
    setShowPromoteConfirm(true);
  };

  const confirmPromote = async () => {
    setShowPromoteConfirm(false);
    await API.put('/variants/' + id, { status: 'active' });
    await reload();
    const updated = await API.get('/variants/' + id);
    setData(updated);
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    await API.del('/variants/' + id);
    await reload();
    navigate('/strategy/' + data.strategy_id);
  };

  const handleCompare = () => {
    setCompareSlotA({ id: data.id, name: data.name, strategyName: stratName });
    navigate('/compare');
  };

  const statusOpts = [
    { value: 'idea', label: 'Idée' }, { value: 'ready_to_test', label: 'Prêt à tester' },
    { value: 'testing', label: 'En test' }, { value: 'active', label: 'Active' },
    { value: 'validated', label: 'Validée' }, { value: 'rejected', label: 'Rejetée' },
    { value: 'archived', label: 'Archivée' }, { value: 'abandoned', label: 'Abandonnée' },
  ];

  return (
    <div className="fade-in">
      <Breadcrumb items={[
        { label: 'Stratégies', href: '#/' },
        { label: stratName, href: '#/strategy/' + data.strategy_id },
        { label: data.name },
      ]} />

      {/* Variant header */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white">{data.name}</h1>
              <StatusBadge status={data.status} />
              {mt5Conns.map(c => (
                <span key={c.id}>
                  {c.status === 'connected' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live Sync
                    </span>
                  )}
                  {c.status === 'syncing' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" /> Sync en cours…
                    </span>
                  )}
                  {(c.status === 'pending' || c.status === 'deploying') && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                      Connexion MT5…
                    </span>
                  )}
                  {c.status === 'error' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20" title={c.error_message || ''}>
                      Sync erreur
                    </span>
                  )}
                </span>
              ))}
            </div>
            <div className="text-slate-400 text-sm"><RichDisplay value={data.description} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleCompare} className="text-sm text-blue-400 hover:text-blue-300 px-3 py-1.5 rounded-lg border border-blue-900 hover:border-blue-700 transition">⚖ Comparer</button>
            {data.status !== 'active' && (
              <button onClick={handlePromote} className="text-sm text-emerald-400 hover:text-emerald-300 px-3 py-1.5 rounded-lg border border-emerald-900 hover:border-emerald-700 transition">↑ Promouvoir en active</button>
            )}
            <button onClick={() => setShowDuplicate(true)} className="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Dupliquer</button>
            <button onClick={() => setShowEdit(true)} className="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Modifier</button>
            <button onClick={handleDelete} className="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>
          </div>
        </div>

        {/* Always-visible info cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm mt-4">
          {data.key_change && (
            <EditableCard label="Δ Changement clé" field="key_change" value={data.key_change} data={data} variantId={id} onUpdate={handleFieldUpdate} isRich={false} />
          )}
          <div className="bg-slate-700/30 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-1">Créée le</div>
            <span className="text-slate-300">{formatDate(data.created_at)}</span>
          </div>
          {!isRoot && (
            <div className="bg-slate-700/30 rounded-lg px-4 py-3">
              <div className="text-slate-500 text-xs mb-1">Version de base</div>
              {parentName ? <Link to={'/variant/' + data.parent_variant_id} className="text-blue-400 hover:text-blue-300">{parentName}</Link> : <span className="text-slate-600 italic">aucune (racine)</span>}
            </div>
          )}
          {isRoot && <EditableCard label="Hypothèse testée" field="hypothesis" value={data.hypothesis} data={data} variantId={id} onUpdate={handleFieldUpdate} />}
          {isRoot && <EditableCard label="Conclusion après test" field="decision" value={data.decision} data={data} variantId={id} onUpdate={handleFieldUpdate} />}
        </div>

        {/* Collapsible fields */}
        <div className="mt-3">
          <button onClick={() => setTextFieldsOpen(!textFieldsOpen)} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition mb-2">
            <span className="text-[10px]">{textFieldsOpen ? '▼' : '▶'}</span> Annotations &amp; détails
          </button>
          <div style={{ maxHeight: textFieldsOpen ? '2000px' : '0', opacity: textFieldsOpen ? 1 : 0, overflow: 'hidden', transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              {isRoot && <EditableCard label="Pourquoi ce test" field="change_reason" value={data.change_reason} data={data} variantId={id} onUpdate={handleFieldUpdate} />}
              {isRoot && <EditableCard label="Changements techniques" field="changes" value={data.changes} data={data} variantId={id} onUpdate={handleFieldUpdate} />}
              {!isRoot && (
                <>
                  <EditableCard label="Pourquoi ce test" field="change_reason" value={data.change_reason} data={data} variantId={id} onUpdate={handleFieldUpdate} />
                  <EditableCard label="Hypothèse testée" field="hypothesis" value={data.hypothesis} data={data} variantId={id} onUpdate={handleFieldUpdate} />
                  <EditableCard label="Changements techniques" field="changes" value={data.changes} data={data} variantId={id} onUpdate={handleFieldUpdate} />
                  <EditableCard label="Conclusion après test" field="decision" value={data.decision} data={data} variantId={id} onUpdate={handleFieldUpdate} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lineage */}
      {lineage && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">Historique des versions</h2>
          <div className="text-sm"><LineageTree node={lineage} currentId={id} /></div>
        </div>
      )}

      {/* Aggregated metrics */}
      {aggMetrics && aggMetrics.total_trades > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
              Résultats globaux — {data.runs?.length || 0} test{(data.runs?.length || 0) > 1 ? 's' : ''}
            </h2>
            <div className="flex items-center gap-2">
              {aggMetrics.mixed_currencies && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/50">
                  Devises mixtes
                </span>
              )}
              {aggMetrics.currency && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                  {aggMetrics.currency}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <MetricCard label="Résultat net"><PnlSpan value={aggMetrics.total_pnl} /></MetricCard>
            <MetricCard label="Rendement %">{aggMetrics.total_return_pct != null ? (aggMetrics.total_return_pct * 100).toFixed(2) + '%' : '—'}</MetricCard>
            <MetricCard label="Trades">{aggMetrics.total_trades}</MetricCard>
            <MetricCard label="Taux de réussite">{formatPercent(aggMetrics.win_rate)}</MetricCard>
            <MetricCard label="Ratio gains/pertes">{aggMetrics.profit_factor != null ? aggMetrics.profit_factor.toFixed(2) : '—'}</MetricCard>
            <MetricCard label="Gain moyen/trade"><PnlSpan value={aggMetrics.expectancy} /></MetricCard>
            <MetricCard label="Ratio R/R">{rr != null ? rr.toFixed(2) : '—'}</MetricCard>
            <DrawdownCard value={aggMetrics.max_drawdown} ddPeak={ddPeak} pctTrue={aggMetrics.max_drawdown_pct_true} size="sm" />
            <MetricCard label="Sharpe">{aggMetrics.sharpe_ratio != null ? aggMetrics.sharpe_ratio.toFixed(2) : '—'}</MetricCard>
            <MetricCard label="Sortino">{aggMetrics.sortino_ratio != null ? aggMetrics.sortino_ratio.toFixed(2) : '—'}</MetricCard>
            <MetricCard label="Récupération">{aggMetrics.recovery_factor != null ? aggMetrics.recovery_factor.toFixed(2) : '—'}</MetricCard>
            <MetricCard label="Gain moyen"><PnlSpan value={aggMetrics.avg_win} /></MetricCard>
            <MetricCard label="Perte moyenne"><PnlSpan value={aggMetrics.avg_loss} /></MetricCard>
            <MetricCard label="Gains consécutifs max">{aggMetrics.max_consecutive_wins ?? '—'}</MetricCard>
            <MetricCard label="Pertes consécutives max">{aggMetrics.max_consecutive_losses ?? '—'}</MetricCard>
          </div>
        </div>
      )}

      {/* Evaluation */}
      {variantEval && <EvaluationPanel result={variantEval} title="Évaluation de la version" />}

      {/* Charts */}
      {aggMetrics && aggMetrics.total_trades > 0 && (
        <>
          <EquityChart equityCurve={aggMetrics.equity_curve} initialBalance={data.runs?.[0]?.initial_balance ?? getUnitSettings().initial_balance} />
          <MonthlyHeatmap monthlyBreakdown={aggMetrics.monthly_breakdown} />
          <UnderwaterChart underwater={aggMetrics.underwater} underwaterPct={aggMetrics.underwater_pct} equityCurve={aggMetrics.equity_curve} />
        </>
      )}

      {/* Runs */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Tests ({data.runs?.length || 0})</h2>
        <button onClick={() => setShowImportChoice(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">
          + Importer des trades
        </button>
      </div>
      {!data.runs?.length ? (
        <EmptyState message="Aucun test importé" actionLabel="Importer des trades" onAction={() => setShowImportChoice(true)} />
      ) : (
        <div className="space-y-3">
          {data.runs.map(r => {
            if (r.metrics?.avg_loss) setCurrentAvgLoss(r.metrics.avg_loss);
            return (
              <Link key={r.id} to={'/run/' + r.id} className="block bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-blue-500/50 transition group">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-white group-hover:text-blue-400 transition">{r.label}</h3>
                    <div className="flex gap-3 text-xs text-slate-400 mt-1">
                      <span className="uppercase bg-slate-700 px-2 py-0.5 rounded">{r.type}</span>
                      {r.currency && <span className="bg-slate-700 px-2 py-0.5 rounded">{r.currency}</span>}
                      <span>{formatDate(r.start_date)} → {formatDate(r.end_date)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    {r.metrics ? (
                      <>
                        <div className="text-lg font-semibold"><PnlSpan value={r.metrics.total_pnl} /></div>
                        <div className="text-xs text-slate-400">{r.metrics.total_trades} trades · WR {formatPercent(r.metrics.win_rate)}</div>
                      </>
                    ) : <span className="text-slate-500 text-sm">Pas de résultats</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {showEdit && (
        <Modal title="Modifier la version" onClose={() => setShowEdit(false)} onSubmit={handleEdit} wide richText>
          <InputField name="name" label="Nom" required defaultValue={data.name} />
          <InputField name="key_change" label="Changement clé" defaultValue={data.key_change} placeholder="Ex : Entrée après close M15 au lieu de wick touch" />
          <TextareaField name="change_reason" label="Pourquoi ce test" defaultValue={richTextPlain(data.change_reason)} />
          <RichTextField name="description" label="Description" defaultValue={data.description} />
          <RichTextField name="hypothesis" label="Hypothèse testée" defaultValue={data.hypothesis} />
          <RichTextField name="changes" label="Changements techniques" defaultValue={data.changes} />
          <RichTextField name="decision" label="Conclusion après test" defaultValue={data.decision} />
          <SelectField name="status" label="Statut" options={statusOpts} defaultValue={data.status} />
        </Modal>
      )}

      {/* Duplicate modal */}
      {showDuplicate && (
        <Modal title="Dupliquer cette version" onClose={() => setShowDuplicate(false)} onSubmit={handleDuplicate}>
          <InputField name="name" label="Nom de la nouvelle version" required defaultValue={'Copie — ' + data.name} />
          <InputField name="key_change" label="Changement clé" placeholder="Qu'est-ce qui change par rapport à la version précédente ?" />
          <TextareaField name="change_reason" label="Pourquoi tu le testes" />
        </Modal>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <Modal title="Supprimer cette version" onClose={() => setShowDeleteConfirm(false)} customFooter={
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition">Annuler</button>
            <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition font-semibold">Supprimer</button>
          </div>
        }>
          <div className="text-slate-300 mb-4">
            <p className="mb-3">Êtes-vous sûr de vouloir supprimer la version <span className="font-semibold text-white">"{data.name}"</span> ?</p>
            <p className="text-sm text-slate-400">Cette action est irréversible et supprimera :</p>
            <ul className="text-sm text-slate-400 list-disc list-inside mt-2 ml-1">
              <li>Tous les tests associés à cette version</li>
              <li>Tous les trades de ces tests</li>
              <li>Toutes les versions enfants (si applicable)</li>
            </ul>
          </div>
        </Modal>
      )}

      {/* Promote confirmation modal */}
      {showPromoteConfirm && (
        <Modal title="Promouvoir en version active" onClose={() => setShowPromoteConfirm(false)} customFooter={
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowPromoteConfirm(false)} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition">Annuler</button>
            <button onClick={confirmPromote} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition font-semibold">Promouvoir</button>
          </div>
        }>
          <div className="text-slate-300">
            <p className="mb-2">Promouvoir la version <span className="font-semibold text-white">"{data.name}"</span> comme version active de la stratégie <span className="font-semibold text-white">"{stratName}"</span> ?</p>
            <p className="text-sm text-slate-400 mt-4">Une seule version peut être la version active à la fois.</p>
          </div>
        </Modal>
      )}

      {/* Import source choice modal */}
      {showImportChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-200 mb-4">Importer des trades</h2>
            <div className="grid grid-cols-2 gap-4">
              {/* CSV / File import */}
              <Link
                to={'/import/' + id}
                className="bg-slate-700/50 hover:bg-slate-700 border border-slate-600 hover:border-blue-500 rounded-xl p-5 transition group text-left"
              >
                <div className="text-2xl mb-2">
                  <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="9" y1="15" x2="12" y2="12" />
                    <line x1="15" y1="15" x2="12" y2="12" />
                  </svg>
                </div>
                <div className="font-semibold text-slate-200 group-hover:text-blue-400 transition text-sm">Import fichier</div>
                <p className="text-xs text-slate-400 mt-1">CSV, Excel, MT5 Report, FX Replay</p>
              </Link>

              {/* MT5 live account */}
              <button
                onClick={() => { setShowImportChoice(false); setShowMT5Form(true); }}
                className="text-left rounded-xl p-5 transition group border bg-slate-700/50 hover:bg-slate-700 border-slate-600 hover:border-blue-500"
              >
                <div className="text-2xl mb-2">
                  <svg className="w-8 h-8 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <div className="font-semibold text-slate-200 group-hover:text-blue-400 transition text-sm">
                  Compte MT5
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Synchroniser un compte live ou historique
                </p>
              </button>
            </div>
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setShowImportChoice(false)}
                className="btn-ghost text-sm text-slate-400 hover:text-slate-200 px-4 py-2"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MT5 connect form */}
      {showMT5Form && (
        <MT5ConnectForm
          variantId={id}
          onSuccess={() => {
            setShowMT5Form(false);
            API.invalidate();
            reloadMt5();
            // Reload variant data to update runs list
            (async () => {
              try {
                const d = await API.get('/variants/' + id);
                setData(d);
              } catch {}
            })();
          }}
          onCancel={() => setShowMT5Form(false)}
        />
      )}
    </div>
  );
}
