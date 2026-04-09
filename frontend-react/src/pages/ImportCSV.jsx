import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import API from '../lib/api';
import { useSidebar } from '../hooks/useSidebar';
import { formatPercent, setCurrentAvgLoss } from '../lib/utils';
import { Breadcrumb, Spinner, PnlSpan } from '../components/UI';
import { InputField, SelectField } from '../components/Modal';

const FIELDS = ['open_time', 'close_time', 'symbol', 'side', 'entry_price', 'exit_price', 'lot_size', 'pnl', 'pips'];
const FIELD_LABELS = {
  open_time: 'Open Time', close_time: 'Close Time', symbol: 'Symbol',
  side: 'Side (Type)', entry_price: 'Entry Price', exit_price: 'Exit Price',
  lot_size: 'Lot Size', pnl: 'PnL (Profit)', pips: 'Pips (optionnel)',
};

const PRESETS = {
  manual: {
    open_time: 'Open Time', close_time: 'Close Time', symbol: 'Symbol',
    side: 'Type', entry_price: 'Entry', exit_price: 'Exit',
    lot_size: 'Lots', pnl: 'Profit', pips: 'Pips',
  },
  fxreplay: {
    open_time: 'dateStart', close_time: 'dateEnd', symbol: 'pair',
    side: 'side', entry_price: 'entryPrice', exit_price: 'avgClosePrice',
    lot_size: 'amount', pnl: 'rPnL',
  },
};

export default function ImportCSV() {
  const { variantId } = useParams();
  const navigate = useNavigate();
  const { reload } = useSidebar();
  const [variant, setVariant] = useState(null);
  const [stratName, setStratName] = useState('Stratégie');
  const [stratVariantsCount, setStratVariantsCount] = useState(2);
  const [selectedFormat, setSelectedFormat] = useState('manual');
  const [csvFile, setCsvFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const v = await API.get('/variants/' + variantId);
      setVariant(v);
      try {
        const strat = await API.get('/strategies/' + v.strategy_id);
        setStratName(strat.name);
        setStratVariantsCount(strat.variants?.length || 2);
      } catch {}
    })();
  }, [variantId]);

  const handleFile = useCallback((file) => {
    if (!file || !file.name.toLowerCase().endsWith('.csv')) { alert('Fichier CSV requis'); return; }
    setCsvFile(file);
    setResult(null);

    const defaults = PRESETS[selectedFormat] || PRESETS.manual;

    Papa.parse(file, {
      header: true,
      preview: 6,
      complete: (results) => {
        const cols = results.meta.fields || [];
        setColumns(cols);
        const autoMapping = {};
        FIELDS.forEach(f => {
          if (defaults[f] && cols.indexOf(defaults[f]) !== -1) autoMapping[f] = defaults[f];
        });
        setMapping(autoMapping);
        setPreviewRows(results.data.slice(0, 5));
      },
      error: (err) => alert('Erreur de parsing: ' + err.message),
    });
  }, [selectedFormat]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleImport = async () => {
    const label = document.querySelector('[name=label]')?.value?.trim();
    const runType = document.querySelector('[name=run_type]')?.value;
    const balanceInput = document.querySelector('[name=initial_balance]')?.value?.trim();
    const currencyInput = document.querySelector('[name=currency]')?.value?.trim();
    if (!label) return alert('Le label est requis');
    if (!csvFile) return alert('Aucun fichier sélectionné');

    const hasMapping = Object.values(mapping).some(v => v);
    const fd = new FormData();
    fd.append('variant_id', variantId);
    fd.append('label', label);
    fd.append('type', runType);
    if (balanceInput) fd.append('initial_balance', balanceInput);
    if (currencyInput) fd.append('currency', currencyInput);
    fd.append('file', csvFile);
    if (hasMapping) fd.append('column_mapping', JSON.stringify(mapping));

    setImporting(true);
    try {
      const res = await API.upload('/runs/import', fd);
      setResult(res);
      await reload();
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
    setImporting(false);
  };

  const clearFile = () => {
    setCsvFile(null);
    setColumns([]);
    setMapping({});
    setPreviewRows([]);
    setResult(null);
  };

  const switchFormat = (fmt) => {
    setSelectedFormat(fmt);
    if (csvFile) handleFile(csvFile);
  };

  if (!variant) return <Spinner />;

  const crumbs = stratVariantsCount <= 1
    ? [{ label: 'Stratégies', href: '#/' }, { label: stratName, href: '#/strategy/' + variant.strategy_id }, { label: 'Import CSV' }]
    : [{ label: 'Stratégies', href: '#/' }, { label: stratName, href: '#/strategy/' + variant.strategy_id }, { label: variant.name, href: '#/variant/' + variantId }, { label: 'Import CSV' }];

  return (
    <div className="fade-in">
      <Breadcrumb items={crumbs} />
      <h1 className="text-2xl font-bold text-white mb-6">Importer un CSV</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          {/* Label & type */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
            <InputField name="label" label="Nom de la run" />
            <SelectField name="run_type" label="Type" options={[
              { value: 'backtest', label: 'Backtest' },
              { value: 'forward', label: 'Forward Test' },
              { value: 'live', label: 'Live' },
            ]} />
            <InputField name="initial_balance" label="Capital initial" type="number" placeholder="Auto-détecté depuis le CSV" />
            <InputField name="currency" label="Devise du compte" placeholder="Auto-détecté (ex: USD, EUR)" />
          </div>

          {/* Format selector */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
            <label className="text-sm text-slate-400 block mb-3">Format d&apos;import</label>
            <div className="grid grid-cols-2 gap-3">
              <div onClick={() => switchFormat('manual')} className={`format-card cursor-pointer rounded-xl border-2 ${selectedFormat === 'manual' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-slate-700/50'} p-4 text-center transition`}>
                <div className="text-2xl mb-2">📝</div>
                <div className="text-sm font-semibold text-white">Manuel</div>
                <p className="text-xs text-slate-400 mt-1">Mapping personnalisé</p>
              </div>
              <div onClick={() => switchFormat('fxreplay')} className={`format-card cursor-pointer rounded-xl border-2 ${selectedFormat === 'fxreplay' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-600 bg-slate-700/50'} p-4 text-center transition`}>
                <div className="mb-2">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="inline-block"><rect width="32" height="32" rx="6" fill="#F59E0B" /><path d="M13 9l10 7-10 7V9z" fill="white" /></svg>
                </div>
                <div className="text-sm font-semibold text-white">FX Replay</div>
                <p className="text-xs text-slate-400 mt-1">Colonnes auto-mappées</p>
              </div>
            </div>
          </div>

          {/* Drop zone */}
          {!csvFile && (
            <div className="drop-zone bg-slate-800 rounded-xl p-12 text-center cursor-pointer mb-4"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
              onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
              onDrop={handleDrop}>
              <div className="text-4xl mb-3">📁</div>
              <p className="text-slate-300 mb-1">Glisser-déposer un fichier CSV ici</p>
              <p className="text-slate-500 text-sm">ou cliquer pour sélectionner</p>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
            </div>
          )}

          {/* File info */}
          {csvFile && !result && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white">{csvFile.name} ({(csvFile.size / 1024).toFixed(1)} Ko)</span>
                <button onClick={clearFile} className="text-xs text-red-400 hover:text-red-300">✕ Retirer</button>
              </div>
            </div>
          )}
        </div>

        <div>
          {/* Mapping */}
          {csvFile && columns.length > 0 && !result && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
              <h3 className="text-sm font-semibold text-white mb-3">Mapping des colonnes</h3>
              {FIELDS.map(f => (
                <div key={f} className="flex items-center gap-3 mb-2">
                  <label className="text-xs text-slate-400 w-28">{FIELD_LABELS[f]}</label>
                  <select value={mapping[f] || ''} onChange={e => setMapping(prev => ({ ...prev, [f]: e.target.value }))}
                    className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white">
                    <option value="">— Non mappé —</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview */}
      {previewRows.length > 0 && !result && (
        <div className="mt-6 bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-3">Aperçu (5 premières lignes)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  {columns.map(c => <th key={c} className="py-2 px-2 text-left bg-slate-800">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-700/50">
                    {columns.map(c => <td key={c} className="py-1.5 px-2 text-slate-300">{row[c]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import button */}
      {csvFile && !result && (
        <div className="mt-6">
          <button onClick={handleImport} disabled={importing} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {importing ? 'Import en cours...' : '📥 Importer les trades'}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-6 bg-green-900/30 border border-green-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-green-400 mb-3">✅ Import réussi</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
            <div><span className="text-slate-400">Trades importés</span><br /><span className="text-white font-semibold">{result.nb_trades_imported}</span></div>
            <div><span className="text-slate-400">Total PnL</span><br /><PnlSpan value={result.metrics?.total_pnl} /></div>
            <div><span className="text-slate-400">Win Rate</span><br /><span className="text-white">{formatPercent(result.metrics?.win_rate)}</span></div>
            <div><span className="text-slate-400">Profit Factor</span><br /><span className="text-white">{result.metrics?.profit_factor != null ? result.metrics.profit_factor : '—'}</span></div>
          </div>
          {result.warnings?.length > 0 && (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mt-3">
              <p className="text-yellow-400 text-sm font-medium mb-1">⚠️ Warnings</p>
              <ul className="text-xs text-yellow-300 list-disc list-inside">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <a href={'#/run/' + result.run_id} className="inline-block mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition">Voir le run →</a>
        </div>
      )}
    </div>
  );
}
