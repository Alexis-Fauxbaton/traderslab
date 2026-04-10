import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import API from '../lib/api';
import { useSidebar } from '../hooks/useSidebar';
import { formatDate, richTextPlain, setCurrentAvgLoss, STATUS_LABELS, formatPercent } from '../lib/utils';
import { Breadcrumb, Spinner, StatusBadge, PnlSpan } from '../components/UI';
import MiniChart from '../components/MiniChart';
import MetricCard from '../components/MetricCard';
import Modal, { InputField, TextareaField, SelectField, RichTextField, getRichValue, TagInput, ChipSelect } from '../components/Modal';

const TF_OPTIONS = [
  { value: 'M1', label: 'M1' }, { value: 'M5', label: 'M5' }, { value: 'M15', label: 'M15' },
  { value: 'M30', label: 'M30' }, { value: 'H1', label: 'H1' }, { value: 'H4', label: 'H4' },
  { value: 'D1', label: 'D1' }, { value: 'W1', label: 'W1' },
];

function StrategyGraph({ variants, varMetrics }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !variants || variants.length === 0) return;
    import('vis-network/standalone').then(({ Network, DataSet }) => {
      if (networkRef.current) networkRef.current.destroy();

      const nodes = [];
      const edges = [];

      variants.forEach(v => {
        const m = varMetrics[v.id];
        const hasMet = m && m.total_trades > 0;
        let label = v.name;
        if (hasMet) {
          const pnlVal = m.total_pnl != null ? (m.total_pnl >= 0 ? '+' : '') + m.total_pnl.toFixed(2) : '—';
          const wrVal = m.win_rate != null ? (m.win_rate * 100).toFixed(1) + '%' : '—';
          label += '\n' + m.total_trades + ' trades | WR ' + wrVal + '\nPnL ' + pnlVal;
        } else {
          label += '\nPas de données';
        }

        let borderColor = '#475569', bgColor = '#1e293b', fontColor = '#e2e8f0';
        if (hasMet && m.total_pnl != null) {
          if (m.total_pnl > 0) { borderColor = '#22c55e'; bgColor = '#0f3a24'; }
          else if (m.total_pnl < 0) { borderColor = '#ef4444'; bgColor = '#3b1111'; }
        }

        const statusEmoji = v.status === 'active' ? '🟢 ' : v.status === 'validated' ? '✅ ' : v.status === 'testing' ? '🟡 ' : v.status === 'ready_to_test' ? '🔵 ' : v.status === 'idea' ? '💡 ' : v.status === 'rejected' ? '🔴 ' : v.status === 'archived' ? '⚪ ' : '';

        nodes.push({
          id: v.id, label: statusEmoji + label, shape: 'box',
          margin: { top: 12, bottom: 12, left: 16, right: 16 },
          font: { multi: false, color: fontColor, size: 13, face: 'ui-sans-serif, system-ui, sans-serif', align: 'center' },
          color: { background: bgColor, border: borderColor, highlight: { background: '#334155', border: '#60a5fa' }, hover: { background: '#334155', border: '#60a5fa' } },
          borderWidth: 2, borderWidthSelected: 3,
          shadow: { enabled: true, color: 'rgba(0,0,0,0.4)', size: 8, x: 0, y: 3 },
          chosen: true, variantId: v.id,
        });

        if (v.parent_variant_id) {
          edges.push({
            from: v.parent_variant_id, to: v.id,
            arrows: { to: { enabled: true, scaleFactor: 0.7, type: 'arrow' } },
            color: { color: '#475569', highlight: '#60a5fa', hover: '#60a5fa' },
            width: 2, smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.4 },
          });
        }
      });

      const data = { nodes: new DataSet(nodes), edges: new DataSet(edges) };
      const options = {
        layout: { hierarchical: { enabled: true, direction: 'UD', sortMethod: 'directed', levelSeparation: 100, nodeSpacing: 180, treeSpacing: 200, blockShifting: true, edgeMinimization: true, parentCentralization: true } },
        physics: { enabled: false },
        interaction: { hover: true, tooltipDelay: 200, zoomView: true, dragView: true, navigationButtons: false, keyboard: false },
        nodes: { shapeProperties: { borderRadius: 8 } },
      };

      networkRef.current = new Network(containerRef.current, data, options);
      networkRef.current.on('doubleClick', params => {
        if (params.nodes?.length > 0) window.location.hash = '#/variant/' + params.nodes[0];
      });
      networkRef.current.on('hoverNode', () => { containerRef.current.style.cursor = 'pointer'; });
      networkRef.current.on('blurNode', () => { containerRef.current.style.cursor = 'default'; });
      networkRef.current.once('afterDrawing', () => {
        networkRef.current.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
      });
    });

    return () => { if (networkRef.current) networkRef.current.destroy(); };
  }, [variants, varMetrics]);

  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', flex: 1, borderRadius: 12, overflow: 'hidden' }} 
      className="bg-slate-800 border border-slate-700" 
    />
  );
}

export default function StrategyDetail({ setCompareSlotA, setCompareSlotB }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { reload } = useSidebar();
  const [data, setData] = useState(null);
  const [varMetrics, setVarMetrics] = useState({});
  const [varExtra, setVarExtra] = useState({});   // pairs + timeframes per variant
  const [varVerdicts, setVarVerdicts] = useState({}); // verdict per variant
  const [view, setView] = useState('grid');
  const [showEdit, setShowEdit] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const [showNewVar, setShowNewVar] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener('unitchange', handler);
    return () => window.removeEventListener('unitchange', handler);
  }, []);

  useEffect(() => {
    (async () => {
      const [stratData, summary] = await Promise.all([
        API.get('/strategies/' + id),
        API.get('/strategies/' + id + '/variants-summary'),
      ]);
      const metrics = {};
      const extra = {};
      summary.forEach(vs => {
        metrics[vs.id] = vs.aggregate_metrics;
        extra[vs.id] = { pairs: vs.pairs || [], timeframes: vs.timeframes || [] };
      });
      setData(stratData);
      setVarMetrics(metrics);
      setVarExtra(extra);
      try { localStorage.setItem('lastVisit', JSON.stringify({ hash: '/strategy/' + id, ts: Date.now(), crumbs: [{ label: 'Stratégies', href: '#/' }, { label: stratData.name }] })); } catch {}
      // Fetch verdicts (non-blocking)
      API.get('/analysis/verdicts/' + id).then(v => setVarVerdicts(v || {})).catch(() => {});
    })();
  }, [id]);

  if (!data) return <Spinner />;

  const activeVar = data.variants.find(v => v.status === 'active');
  const lastVar = data.variants.length > 0 ? data.variants[0] : null;
  const importTarget = activeVar || lastVar;

  const handleEdit = async (fd) => {
    await API.put('/strategies/' + id, {
      name: fd.get('name'), description: fd.get('description'),
      pairs: JSON.parse(fd.get('pairs') || '[]'),
      timeframes: JSON.parse(fd.get('timeframes') || '[]'),
    });
    await reload();
    setShowEdit(false);
    const updated = await API.get('/strategies/' + id);
    setData(updated);
  };

  const handleDelete = async () => {
    if (!confirm('Supprimer cette stratégie et toutes ses variantes ?')) return;
    await API.del('/strategies/' + id);
    await reload();
    navigate('/');
  };

  const handleNewVariant = async (fd, submitBtn) => {
    const action = submitBtn?.value || 'create';
    const defaultParentId = activeVar ? activeVar.id : '';
    const resp = await API.post('/variants', {
      strategy_id: id,
      name: fd.get('name'),
      key_change: fd.get('key_change') || '',
      change_reason: fd.get('change_reason') || '',
      description: getRichValue('description'),
      hypothesis: getRichValue('hypothesis'),
      changes: getRichValue('changes'),
      decision: getRichValue('decision'),
      parent_variant_id: fd.get('parent_variant_id') || defaultParentId || null,
      status: fd.get('status') || 'idea',
    });
    await reload();
    setShowNewVar(false);
    if (action === 'import' && resp?.id) {
      navigate('/import/' + resp.id);
    } else {
      const [updated, summary] = await Promise.all([
        API.get('/strategies/' + id),
        API.get('/strategies/' + id + '/variants-summary'),
      ]);
      const metrics = {};
      const extra = {};
      summary.forEach(vs => {
        metrics[vs.id] = vs.aggregate_metrics;
        extra[vs.id] = { pairs: vs.pairs || [], timeframes: vs.timeframes || [] };
      });
      setData(updated);
      setVarMetrics(metrics);
      setVarExtra(extra);
      API.get('/analysis/verdicts/' + id).then(v => setVarVerdicts(v || {})).catch(() => {});
    }
  };

  const handleFirstImport = async () => {
    const v = await API.post('/variants', {
      strategy_id: id, name: 'Itération 1', status: 'active', key_change: '',
    });
    await reload();
    navigate('/import/' + v.id);
  };

  const handleCompareQuick = () => {
    if (activeVar) setCompareSlotA({ id: activeVar.id, name: activeVar.name, strategyName: data.name });
    if (lastVar && lastVar.id !== activeVar?.id) setCompareSlotB({ id: lastVar.id, name: lastVar.name, strategyName: data.name });
    navigate('/compare');
  };

  const iterCount = data.variants.length + 1;
  const parentOpts = [{ value: '', label: '— Aucune (racine) —' }]
    .concat(data.variants.map(v => ({ value: v.id, label: (STATUS_LABELS[v.status] ? '[' + STATUS_LABELS[v.status] + '] ' : '') + v.name })));
  const statusOpts = [
    { value: 'idea', label: 'Idée' }, { value: 'ready_to_test', label: 'Prêt à tester' },
    { value: 'testing', label: 'En test' }, { value: 'active', label: 'Active' },
    { value: 'validated', label: 'Validée' }, { value: 'rejected', label: 'Rejetée' },
    { value: 'archived', label: 'Archivée' },
  ];

  return (
    <div className="fade-in">
      <Breadcrumb items={[{ label: 'Stratégies', href: '#/' }, { label: data.name }]} />

      {/* Strategy info card */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{data.name}</h1>
            <p className="text-slate-400 text-sm mb-3">{data.description || 'Pas de description'}</p>
            <div className="flex gap-4 text-sm text-slate-400">
              <span className="flex items-center gap-1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> {(data.pairs || []).join(', ') || '—'}</span>
              <span className="flex items-center gap-1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> {(data.timeframes || []).join(', ') || '—'}</span>
              <span className="flex items-center gap-1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> {formatDate(data.created_at)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setEditKey(k => k + 1); setShowEdit(true); }} className="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">Modifier</button>
            <button onClick={handleDelete} className="text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 transition">Supprimer</button>
          </div>
        </div>
      </div>

      {/* Active variant banner */}
      {(activeVar || lastVar) && importTarget && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl px-5 py-4 mb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            {activeVar ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Version active</span>
                <Link to={'/variant/' + activeVar.id} className="text-sm font-medium text-white hover:text-blue-400 transition">{activeVar.name}</Link>
                <StatusBadge status={activeVar.status} />
              </div>
            ) : (
              <div className="flex items-center gap-2"><span className="text-xs text-slate-500">Version active</span><span className="text-sm text-slate-500 italic">aucune</span></div>
            )}
            {lastVar && (!activeVar || lastVar.id !== activeVar.id) && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-500">Dernière itération</span>
                <Link to={'/variant/' + lastVar.id} className="text-sm text-slate-300 hover:text-white transition">{lastVar.name}</Link>
                <StatusBadge status={lastVar.status} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowNewVar(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">+ Tester une modification</button>
            {importTarget && <Link to={'/import/' + importTarget.id} className="text-sm text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">📥 Importer un run</Link>}
            {activeVar && lastVar && lastVar.id !== activeVar.id && (
              <button onClick={handleCompareQuick} className="text-sm text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">⚖ Comparer active vs dernier test</button>
            )}
          </div>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-400">Historique des itérations ({data.variants.length})</h2>
        <div className="flex gap-2">
          <button onClick={() => setView('grid')} className={`text-sm px-3 py-1.5 rounded-lg border transition ${view === 'grid' ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white'}`}>Grille</button>
          {data.variants.length >= 2 && (
            <button onClick={() => setView('tree')} className={`text-sm px-3 py-1.5 rounded-lg border transition ${view === 'tree' ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white'}`}>Arborescence</button>
          )}
          <button onClick={() => setShowNewVar(true)} className="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition">+ Nouvelle itération</button>
        </div>
      </div>

      {/* Variants grid */}
      {view === 'grid' && (
        data.variants.length === 0 ? (
          <div className="text-center py-16 bg-slate-800/40 border border-dashed border-slate-700 rounded-xl">
            <div className="text-5xl mb-4">📥</div>
            <h3 className="text-base font-semibold text-white mb-2">Importez vos premiers résultats</h3>
            <p className="text-sm text-slate-400 mb-6">Créez une itération et importez vos trades pour commencer à analyser cette stratégie.</p>
            <button onClick={handleFirstImport} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">📥 Créer et importer un run</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 [&>a]:h-full">
            {data.variants.map(v => {
              const m = varMetrics[v.id];
              const ex = varExtra[v.id] || {};
              const vd = varVerdicts[v.id];
              const desc = richTextPlain(v.description, 100);

              return (
                <MetricCard
                  key={v.id}
                  to={'/variant/' + v.id}
                  title={v.name}
                  badge={<StatusBadge status={v.status} />}
                  description={desc}
                  metrics={m}
                  pairs={ex.pairs}
                  timeframes={ex.timeframes}
                  verdict={vd}
                  footer={<span className="flex items-center gap-1"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> {formatDate(v.created_at)}</span>}
                />
              );
            })}
          </div>
        )
      )}

      {/* Variants tree */}
      {view === 'tree' && data.variants.length >= 2 && (
        <div style={{ minHeight: 400, height: '60vh', maxHeight: 700 }} className="w-full flex flex-col">
          <StrategyGraph variants={data.variants} varMetrics={varMetrics} />
        </div>
      )}

      {/* Edit strategy modal */}
      {showEdit && (
        <Modal key={editKey} title="Modifier la Stratégie" onClose={() => setShowEdit(false)} onSubmit={handleEdit}>
          <InputField name="name" label="Nom" required defaultValue={data.name} />
          <TextareaField name="description" label="Description" defaultValue={data.description} />
          <TagInput name="pairs" label="Paires" defaultValue={data.pairs || []} placeholder="Ex: EURUSD, GBPUSD…" />
          <ChipSelect name="timeframes" label="Timeframes" options={TF_OPTIONS} defaultValue={data.timeframes || []} />
        </Modal>
      )}

      {/* New iteration modal */}
      {showNewVar && (
        <Modal title="Tester une modification" onClose={() => setShowNewVar(false)} onSubmit={handleNewVariant} wide richText
          customFooter={
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowNewVar(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white transition">Annuler</button>
              <button type="submit" name="_action" value="create" className="px-4 py-2 text-sm border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg transition">Créer</button>
              <button type="submit" name="_action" value="import" className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Créer et importer un run →</button>
            </div>
          }
        >
          <InputField name="name" label="Nom de l'itération" required defaultValue={'Itération ' + iterCount} />
          <InputField name="key_change" label="Changement clé" placeholder="Ex : Entrée après close M15 au lieu de wick touch" />
          <TextareaField name="change_reason" label="Pourquoi tu le testes" />
          <AdvancedFields parentOpts={parentOpts} statusOpts={statusOpts} defaultParentId={activeVar ? activeVar.id : ''} />
        </Modal>
      )}
    </div>
  );
}

function AdvancedFields({ parentOpts, statusOpts, defaultParentId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 pt-3 border-t border-slate-700/60">
      <button type="button" onClick={() => setOpen(!open)} className="text-xs text-slate-500 hover:text-slate-300 transition flex items-center gap-1.5 mb-3">
        <span className="text-[10px]">{open ? '▼' : '▶'}</span> Options avancées
      </button>
      {open && (
        <div className="space-y-0">
          <RichTextField name="description" label="Description" />
          <RichTextField name="hypothesis" label="Hypothèse détaillée" />
          <RichTextField name="changes" label="Changements techniques" />
          <RichTextField name="decision" label="Conclusion après test" />
          <SelectField name="parent_variant_id" label="Variante de base" options={parentOpts} defaultValue={defaultParentId} />
          <SelectField name="status" label="Statut" options={statusOpts} defaultValue="idea" />
        </div>
      )}
    </div>
  );
}
