import { useState, useEffect } from 'react';
import API from '../lib/api';

/**
 * MT5 connection form modal.
 * @param {string|null} variantId - If set, hides variant selector and uses this ID directly.
 * @param {Function} onSuccess - Called after successful connection.
 * @param {Function} onCancel - Called when user closes the modal.
 */
export default function MT5ConnectForm({ variantId = null, onSuccess, onCancel }) {
  const [form, setForm] = useState({
    mt5_login: '', mt5_server: '', investor_password: '',
    variant_id: variantId || '', platform: 'mt5',
    sync_scope: 'all', sync_from: '', sync_to: '',
  });
  const [servers, setServers] = useState([]);
  const [variants, setVariants] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load servers (always) + variants (only when no variantId pinned)
  useEffect(() => {
    (async () => {
      try {
        const srvs = await API.get('/mt5/servers');
        setServers(srvs);
      } catch { setServers([]); }

      if (!variantId) {
        try {
          const strats = await API.get('/strategies');
          const all = [];
          for (const s of strats) {
            try {
              const vars = await API.get(`/variants?strategy_id=${s.id}`);
              for (const v of vars) all.push({ ...v, strategyName: s.name });
            } catch { /* skip */ }
          }
          // Load all variants (no filtering — multiple connections allowed)
          setVariants(all);
        } catch { /* skip */ }
      }
    })();
  }, [variantId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const vid = variantId || form.variant_id;
    if (!vid) { setError('Sélectionnez une version'); return; }
    if (!form.mt5_login || !form.mt5_server || !form.investor_password) {
      setError('Tous les champs sont requis'); return;
    }
    setSubmitting(true);
    try {
      const payload = {
        mt5_login: form.mt5_login,
        mt5_server: form.mt5_server,
        investor_password: form.investor_password,
        variant_id: vid,
        platform: form.platform,
      };
      if (form.sync_scope === 'from' || form.sync_scope === 'range') {
        if (form.sync_from) payload.sync_from = form.sync_from;
      }
      if (form.sync_scope === 'range') {
        if (form.sync_to) payload.sync_to = form.sync_to;
      }
      await API.post('/mt5/connect', payload);
      onSuccess?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-detect run type hint
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
        <h2 className="text-lg font-bold text-slate-200 mb-4">Connecter un compte MT5</h2>

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
            <label className="text-xs text-slate-400 font-medium mb-1 block">Login MT5</label>
            <input
              type="text"
              value={form.mt5_login}
              onChange={e => setForm(f => ({ ...f, mt5_login: e.target.value }))}
              placeholder="Ex: 12345678"
              className="w-full text-sm bg-transparent border border-slate-600 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500 transition"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Serveur</label>
            <input
              type="text"
              list="mt5-servers-form"
              value={form.mt5_server}
              onChange={e => setForm(f => ({ ...f, mt5_server: e.target.value }))}
              placeholder="Tapez pour rechercher… Ex: FundedNext"
              className="w-full text-sm bg-transparent border border-slate-600 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500 transition"
              required
            />
            <datalist id="mt5-servers-form">
              {servers.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Investor Password</label>
            <input
              type="password"
              value={form.investor_password}
              onChange={e => setForm(f => ({ ...f, investor_password: e.target.value }))}
              placeholder="Mot de passe investisseur (lecture seule)"
              className="w-full text-sm bg-transparent border border-slate-600 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500 transition"
              autoComplete="off"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              L'investor password est en lecture seule — aucun trade ne peut être exécuté.
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium mb-1 block">Plateforme</label>
            <select
              value={form.platform}
              onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
              className="select-ghost w-full text-sm py-2 px-3"
            >
              <option value="mt5">MetaTrader 5</option>
              <option value="mt4">MetaTrader 4</option>
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

          {/* Run type hint */}
          <div className={`text-xs px-3 py-1.5 rounded-lg border ${runTypeHint.cls}`}>
            {runTypeHint.label}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost text-sm text-slate-400 hover:text-slate-200 px-4 py-2"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition disabled:opacity-50"
          >
            {submitting ? 'Connexion…' : 'Connecter'}
          </button>
        </div>
      </form>
    </div>
  );
}
