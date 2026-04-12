import { useState, useEffect } from 'react';
import API from '../lib/api';

/**
 * Binance connection form modal.
 * @param {string|null} variantId - If set, hides variant selector.
 * @param {Function} onSuccess - Called after successful connection.
 * @param {Function} onCancel - Called when user closes the modal.
 */
export default function BinanceConnectForm({ variantId = null, onSuccess, onCancel }) {
  const [form, setForm] = useState({
    api_key: '', api_secret: '', variant_id: variantId || '',
    account_type: 'futures_usdm',
    sync_scope: 'all', sync_from: '', sync_to: '',
  });
  const [variants, setVariants] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load variants when no variantId pinned
  useEffect(() => {
    if (variantId) return;
    (async () => {
      try {
        const strats = await API.get('/strategies');
        const all = [];
        for (const s of strats) {
          try {
            const vars = await API.get(`/variants?strategy_id=${s.id}`);
            for (const v of vars) all.push({ ...v, strategyName: s.name });
          } catch { /* skip */ }
        }
        setVariants(all);
      } catch { /* skip */ }
    })();
  }, [variantId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const vid = variantId || form.variant_id;
    if (!vid) { setError('Sélectionnez une version'); return; }
    if (!form.api_key || !form.api_secret) {
      setError('API Key et Secret sont requis'); return;
    }
    setSubmitting(true);
    try {
      const payload = {
        api_key: form.api_key,
        api_secret: form.api_secret,
        variant_id: vid,
        account_type: form.account_type,
      };
      if (form.sync_scope === 'from' || form.sync_scope === 'range') {
        if (form.sync_from) payload.sync_from = form.sync_from;
      }
      if (form.sync_scope === 'range') {
        if (form.sync_to) payload.sync_to = form.sync_to;
      }
      await API.post('/binance/connect', payload);
      onSuccess?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const runTypeHint = (() => {
    if (form.sync_scope === 'range' && form.sync_from && form.sync_to) {
      const today = new Date().toISOString().slice(0, 10);
      if (form.sync_to < today) return { label: 'Ce run sera un backtest', cls: 'text-amber-400 bg-amber-900/30 border-amber-700' };
    }
    return { label: 'Ce run sera un live sync', cls: 'text-blue-400 bg-blue-900/30 border-blue-700' };
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
      >
        <h2 className="text-lg font-bold text-slate-200 mb-4">Connecter un compte Binance</h2>

        {error && (
          <div className="text-xs text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Variant selector — only if no variantId pinned */}
          {!variantId && (
            <div>
              <label className="text-xs text-slate-400 font-medium mb-1 block">Version cible</label>
              <select
                value={form.variant_id}
                onChange={e => setForm(f => ({ ...f, variant_id: e.target.value }))}
                className="select-ghost w-full text-sm py-2 px-3"
                required
              >
                <option value="">Sélectionnez…</option>
                {variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.strategyName} → {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">API Key</label>
            <input
              type="text"
              value={form.api_key}
              onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
              placeholder="Votre clé API Binance"
              className="w-full text-sm bg-transparent border border-slate-600 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500 transition"
              autoComplete="off"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">API Secret</label>
            <input
              type="password"
              value={form.api_secret}
              onChange={e => setForm(f => ({ ...f, api_secret: e.target.value }))}
              placeholder="Votre secret API Binance"
              className="w-full text-sm bg-transparent border border-slate-600 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500 transition"
              autoComplete="off"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Créez une clé API en lecture seule (sans permissions de trading).
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Type de compte</label>
            <select
              value={form.account_type}
              onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}
              className="select-ghost w-full text-sm py-2 px-3"
            >
              <option value="futures_usdm">Futures USDM</option>
              <option value="spot">Spot</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Plage de trades</label>
            <select
              value={form.sync_scope}
              onChange={e => setForm(f => ({ ...f, sync_scope: e.target.value }))}
              className="select-ghost w-full text-sm py-2 px-3"
            >
              <option value="all">Tous les trades disponibles</option>
              <option value="from">A partir d'une date</option>
              <option value="range">Plage de dates</option>
            </select>
          </div>

          {(form.sync_scope === 'from' || form.sync_scope === 'range') && (
            <div className={`grid gap-2 ${form.sync_scope === 'range' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label className="text-xs text-slate-400 font-medium mb-1 block">Date de début</label>
                <input
                  type="date"
                  value={form.sync_from}
                  onChange={e => setForm(f => ({ ...f, sync_from: e.target.value }))}
                  className="w-full text-sm bg-transparent border border-slate-600 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-blue-500 transition"
                  required
                />
              </div>
              {form.sync_scope === 'range' && (
                <div>
                  <label className="text-xs text-slate-400 font-medium mb-1 block">Date de fin</label>
                  <input
                    type="date"
                    value={form.sync_to}
                    onChange={e => setForm(f => ({ ...f, sync_to: e.target.value }))}
                    className="w-full text-sm bg-transparent border border-slate-600 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-blue-500 transition"
                    required
                  />
                </div>
              )}
            </div>
          )}

          <div className={`text-xs px-3 py-1.5 rounded-lg border ${runTypeHint.cls}`}>
            {runTypeHint.label}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="btn-ghost text-sm text-slate-400 hover:text-slate-200 px-4 py-2">
            Annuler
          </button>
          <button type="submit" disabled={submitting} className="bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition disabled:opacity-50">
            {submitting ? 'Connexion…' : 'Connecter'}
          </button>
        </div>
      </form>
    </div>
  );
}
