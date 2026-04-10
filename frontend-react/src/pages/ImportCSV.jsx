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

const MT5_MAPPING = [
  { field: 'Open Time', mt5col: 'Heure (1ère occurrence)' },
  { field: 'Close Time', mt5col: 'Heure (2ème occurrence)' },
  { field: 'Symbol', mt5col: 'Symbole' },
  { field: 'Side (Type)', mt5col: 'Type (buy/sell)' },
  { field: 'Entry Price', mt5col: 'Prix (1ère occurrence)' },
  { field: 'Exit Price', mt5col: 'Prix (2ème occurrence)' },
  { field: 'Lot Size', mt5col: 'Volume' },
  { field: 'PnL (Profit)', mt5col: 'Profit + Commission + Swap' },
  { field: 'Capital initial', mt5col: 'Transactions → Initial Deposit' },
  { field: 'Devise', mt5col: 'En-tête du rapport (USD, EUR…)' },
];

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
  const [mt5Preview, setMt5Preview] = useState(null);
  const [mt5Loading, setMt5Loading] = useState(false);
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
    const name = file?.name?.toLowerCase() || '';
    const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls');
    const isCsv = name.endsWith('.csv');
    if (!file || (!isCsv && !isXlsx)) { alert('Fichier CSV ou Excel (.xlsx) requis'); return; }

    // Auto-select MT5 format for Excel files
    if (isXlsx && selectedFormat !== 'mt5') {
      setSelectedFormat('mt5');
    }

    setCsvFile(file);
    setResult(null);

    // Excel files: server-side preview
    if (isXlsx) {
      setColumns([]);
      setMapping({});
      setPreviewRows([]);
      setMt5Preview(null);
      setMt5Loading(true);
      const fd = new FormData();
      fd.append('file', file);
      API.upload('/runs/preview', fd)
        .then(data => setMt5Preview(data))
        .catch(() => setMt5Preview(null))
        .finally(() => setMt5Loading(false));
      return;
    }

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
    const timeframeInput = document.querySelector('[name=timeframe]')?.value?.trim();
    if (!label) return alert('Le label est requis');
    if (!csvFile) return alert('Aucun fichier sélectionné');

    const hasMapping = Object.values(mapping).some(v => v);
    const fd = new FormData();
    fd.append('variant_id', variantId);
    fd.append('label', label);
    fd.append('type', runType);
    if (balanceInput) fd.append('initial_balance', balanceInput);
    if (timeframeInput) fd.append('timeframe', timeframeInput);
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
    setMt5Preview(null);
    setMt5Loading(false);
    setPreviewRows([]);
    setResult(null);
  };

  const switchFormat = (fmt) => {
    setSelectedFormat(fmt);
    // Clear file when switching between Excel and CSV formats
    if (csvFile) {
      const isXlsx = csvFile.name?.toLowerCase().endsWith('.xlsx') || csvFile.name?.toLowerCase().endsWith('.xls');
      if ((fmt === 'mt5' && !isXlsx) || (fmt !== 'mt5' && isXlsx)) {
        clearFile();
        return;
      }
      handleFile(csvFile);
    }
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
            <InputField name="timeframe" label="Timeframe (optionnel)" placeholder="Ex: M15, H1, H4, D1" />
          </div>

          {/* Format selector */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
            <label className="text-sm text-slate-400 block mb-3">Format d&apos;import</label>
            <div className="grid grid-cols-3 gap-3">
              <div onClick={() => switchFormat('manual')} className={`format-card cursor-pointer rounded-xl border-2 ${selectedFormat === 'manual' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-slate-700/50'} p-4 text-center transition`}>
                <div className="mb-2"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block text-blue-400"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
                <div className="text-sm font-semibold text-white">Manuel</div>
                <p className="text-xs text-slate-400 mt-1">Mapping personnalisé</p>
              </div>
              <div onClick={() => switchFormat('fxreplay')} className={`format-card cursor-pointer rounded-xl border-2 ${selectedFormat === 'fxreplay' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-600 bg-slate-700/50'} p-4 text-center transition`}>
                <div className="mb-2">
                  <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="inline-block"><rect width="32" height="32" rx="6" fill="#F59E0B" /><path d="M13 9l10 7-10 7V9z" fill="white" /></svg>
                </div>
                <div className="text-sm font-semibold text-white">FX Replay</div>
                <p className="text-xs text-slate-400 mt-1">CSV auto-mappé</p>
              </div>
              <div onClick={() => switchFormat('mt5')} className={`format-card cursor-pointer rounded-xl border-2 ${selectedFormat === 'mt5' ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-600 bg-slate-700/50'} p-4 text-center transition`}>
                <div className="mb-2"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block text-emerald-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
                <div className="text-sm font-semibold text-white">MT5 Report</div>
                <p className="text-xs text-slate-400 mt-1">Report History (.xlsx)</p>
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
              <div className="mb-3"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block text-slate-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
              <p className="text-slate-300 mb-1">{selectedFormat === 'mt5' ? 'Glisser-déposer un fichier Excel (.xlsx)' : 'Glisser-déposer un fichier CSV'}</p>
              <p className="text-slate-500 text-sm">ou cliquer pour sélectionner</p>
              <input ref={fileInputRef} type="file" accept={selectedFormat === 'mt5' ? '.xlsx,.xls' : '.csv'} className="hidden" onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
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
          {/* Mapping CSV */}
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

          {/* Mapping MT5 — dynamic from preview */}
          {selectedFormat === 'mt5' && !result && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-4">
              <h3 className="text-sm font-semibold text-white mb-3">Colonnes mappées automatiquement</h3>
              {mt5Loading && <p className="text-xs text-slate-400 animate-pulse">Analyse du fichier en cours…</p>}
              {!mt5Loading && !mt5Preview && (
                <>
                  <p className="text-xs text-slate-500 mb-4">Le parser MT5 détecte automatiquement les colonnes depuis la section Positions du rapport.</p>
                  <div className="border border-slate-700/60 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-400 bg-slate-900/30">
                          <th className="py-2 px-3 text-left font-semibold">Champ TradersLab</th>
                          <th className="py-2 px-3 text-left font-semibold">Colonne MT5</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MT5_MAPPING.map((row, i) => (
                          <tr key={i} className="border-b border-slate-700/30">
                            <td className="py-1.5 px-3 text-slate-300">{row.field}</td>
                            <td className="py-1.5 px-3 text-emerald-400 font-mono text-[11px]">{row.mt5col}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {!mt5Loading && mt5Preview && (
                <>
                  <div className="border border-slate-700/60 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-400 bg-slate-900/30">
                          <th className="py-2 px-3 text-left font-semibold w-6"></th>
                          <th className="py-2 px-3 text-left font-semibold">Champ</th>
                          <th className="py-2 px-3 text-left font-semibold">Colonne détectée</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mt5Preview.columns?.map((col, i) => (
                          <tr key={i} className="border-b border-slate-700/30">
                            <td className="py-1.5 px-3">
                              {col.found
                                ? <span className="text-green-400">✓</span>
                                : col.required
                                  ? <span className="text-red-400">✗</span>
                                  : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="py-1.5 px-3 text-slate-300">
                              {col.label}
                              {col.required && !col.found && <span className="text-red-400 text-[10px] ml-1">requis</span>}
                              {!col.required && <span className="text-slate-600 text-[10px] ml-1">optionnel</span>}
                            </td>
                            <td className="py-1.5 px-3 font-mono text-[11px]">
                              {col.found
                                ? <span className="text-emerald-400">{col.source_column}</span>
                                : <span className="text-slate-600">Non trouvé</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {mt5Preview.total > 0 && (
                    <p className="text-xs text-slate-400 mt-3">
                      {mt5Preview.total} trade{mt5Preview.total > 1 ? 's' : ''} détecté{mt5Preview.total > 1 ? 's' : ''}
                      {mt5Preview.currency ? ` · Devise : ${mt5Preview.currency}` : ''}
                      {mt5Preview.initial_balance != null
                        ? <span className="text-green-400"> · Capital initial : {mt5Preview.initial_balance.toLocaleString()}{mt5Preview.currency ? ` ${mt5Preview.currency}` : ''}</span>
                        : <span className="text-amber-400"> · Capital initial non détecté</span>}
                    </p>
                  )}
                  {mt5Preview.errors?.length > 0 && (
                    <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mt-3">
                      <p className="text-yellow-400 text-xs font-medium mb-1">⚠️ Warnings de parsing</p>
                      <ul className="text-[11px] text-yellow-300 list-disc list-inside">
                        {mt5Preview.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* CSV Preview */}
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

      {/* MT5 Trades Preview */}
      {mt5Preview?.trades?.length > 0 && !result && (
        <div className="mt-6 bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-3">
            Aperçu des trades
            <span className="text-slate-500 font-normal ml-2">({mt5Preview.trades.length} sur {mt5Preview.total})</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700 bg-slate-900/30">
                  <th className="py-2 px-2 text-left">Open Time</th>
                  <th className="py-2 px-2 text-left">Close Time</th>
                  <th className="py-2 px-2 text-left">Symbol</th>
                  <th className="py-2 px-2 text-left">Side</th>
                  <th className="py-2 px-2 text-right">Entry</th>
                  <th className="py-2 px-2 text-right">Exit</th>
                  <th className="py-2 px-2 text-right">Lots</th>
                  <th className="py-2 px-2 text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {mt5Preview.trades.map((t, i) => (
                  <tr key={i} className="border-b border-slate-700/30">
                    <td className="py-1.5 px-2 text-slate-400 font-mono text-[11px]">{t.open_time}</td>
                    <td className="py-1.5 px-2 text-slate-400 font-mono text-[11px]">{t.close_time}</td>
                    <td className="py-1.5 px-2 text-slate-300">{t.symbol}</td>
                    <td className="py-1.5 px-2">
                      <span className={t.side === 'long' ? 'text-green-400' : 'text-red-400'}>{t.side}</span>
                    </td>
                    <td className="py-1.5 px-2 text-slate-300 text-right font-mono">{t.entry_price}</td>
                    <td className="py-1.5 px-2 text-slate-300 text-right font-mono">{t.exit_price}</td>
                    <td className="py-1.5 px-2 text-slate-300 text-right">{t.lot_size}</td>
                    <td className={`py-1.5 px-2 text-right font-semibold ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.pnl >= 0 ? '+' : ''}{t.pnl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mt5Preview.total > mt5Preview.trades.length && (
            <p className="text-[11px] text-slate-500 mt-2 text-center">… et {mt5Preview.total - mt5Preview.trades.length} autres trades</p>
          )}
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
