import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import API from '../lib/api';
import { Spinner } from '../components/UI';
import { formatDateTime } from '../lib/utils';
import MT5ConnectForm from '../components/MT5ConnectForm';

const STATUS_CONFIG = {
  pending:       { label: 'En attente',   bg: 'bg-slate-500/15',  text: 'text-slate-400', border: 'border-slate-500/30', spin: false, pulse: true },
  deploying:     { label: 'Déploiement…', bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-700', spin: true, pulse: false },
  connected:     { label: 'Connecté',     bg: 'bg-green-900/30',  text: 'text-green-400',  border: 'border-green-700', spin: false, pulse: false, dot: true },
  syncing:       { label: 'Sync…',        bg: 'bg-blue-900/30',   text: 'text-blue-400',   border: 'border-blue-700', spin: true, pulse: false },
  error:         { label: 'Erreur',       bg: 'bg-red-900/30',    text: 'text-red-400',    border: 'border-red-700', spin: false, pulse: false, svgIcon: 'error' },
  disconnected:  { label: 'Déconnecté',   bg: 'bg-slate-700/40',  text: 'text-slate-500',  border: 'border-slate-600', spin: false, pulse: false, svgIcon: 'disconnected' },
};

function SpinnerIcon({ className = '' }) {
  return (
    <svg className={`w-3.5 h-3.5 animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.spin && <SpinnerIcon />}
      {cfg.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {cfg.dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {cfg.svgIcon === 'error' && (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )}
      {cfg.svgIcon === 'disconnected' && (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="6" y1="12" x2="18" y2="12" />
        </svg>
      )}
      {cfg.label}
    </span>
  );
}

function ConnectionCard({ conn, onSync, onDisconnect, onRetry, onDelete, syncing, servers, isAdmin }) {
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    mt5_login: conn.mt5_login,
    mt5_server: conn.mt5_server,
    investor_password: '',
    platform: conn.platform,
  });
  const [retrying, setRetrying] = useState(false);
  const canEdit = conn.status === 'error' || conn.status === 'disconnected';

  const handleRetryWithEdits = async () => {
    setRetrying(true);
    const body = {};
    if (editForm.investor_password) body.investor_password = editForm.investor_password;
    if (editForm.mt5_login !== conn.mt5_login) body.mt5_login = editForm.mt5_login;
    if (editForm.mt5_server !== conn.mt5_server) body.mt5_server = editForm.mt5_server;
    if (editForm.platform !== conn.platform) body.platform = editForm.platform;
    await onRetry(conn.id, body);
    setRetrying(false);
    setShowEdit(false);
    setEditForm(f => ({ ...f, investor_password: '' }));
  };
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-900/30 border border-blue-700 flex items-center justify-center text-blue-400 text-sm font-bold">
            MT5
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-200">{conn.mt5_login}</div>
            <div className="text-xs text-slate-400">{conn.mt5_server}</div>
          </div>
        </div>
        <StatusBadge status={conn.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div>
          <span className="text-slate-500">Devise</span>
          <div className="text-slate-200 font-medium">{conn.currency || '—'}</div>
        </div>
        <div>
          <span className="text-slate-500">Balance initiale</span>
          <div className="text-slate-200 font-medium">
            {conn.initial_balance != null ? conn.initial_balance.toLocaleString() : '—'}
          </div>
        </div>
        <div>
          <span className="text-slate-500">Dernière sync</span>
          <div className="text-slate-200 font-medium">
            {conn.last_sync_at ? formatDateTime(conn.last_sync_at.endsWith('Z') ? conn.last_sync_at : conn.last_sync_at + 'Z') : 'Jamais'}
          </div>
        </div>
        <div>
          <span className="text-slate-500">Plage de sync</span>
          <div className="text-slate-200 font-medium">
            {conn.sync_from || conn.sync_to
              ? `${conn.sync_from || '…'} → ${conn.sync_to || 'en cours'}`
              : 'Tout'}
          </div>
        </div>
        <div>
          <span className="text-slate-500">Version</span>
          <div>
            <Link to={`/variant/${conn.variant_id}`} className="text-blue-400 hover:text-blue-300 font-medium transition">
              Voir →
            </Link>
          </div>
        </div>
      </div>

      {conn.error_message && (
        <div className="text-xs text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 mb-3 break-words">
          {conn.error_message}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {isAdmin && (conn.status === 'connected' || conn.status === 'syncing') && (
          <button
            onClick={() => onSync(conn.id)}
            disabled={syncing || conn.status === 'syncing'}
            className="btn-ghost text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            {syncing || conn.status === 'syncing' ? '⟳ Sync…' : '⟳ Forcer sync'}
          </button>
        )}
        {canEdit && (
          <button
            onClick={handleRetryWithEdits}
            disabled={retrying}
            className={`btn-ghost text-xs disabled:opacity-50 ${conn.status === 'error' ? 'text-yellow-400 hover:text-yellow-300' : 'text-blue-400 hover:text-blue-300'}`}
          >
            {retrying ? '↻ Connexion…' : conn.status === 'error' ? '↻ Réessayer' : '↻ Reconnecter'}
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => setShowEdit(s => !s)}
            className="btn-ghost text-xs text-slate-500 hover:text-slate-400"
          >
            {showEdit ? 'Annuler' : '✎ Modifier'}
          </button>
        )}
        {conn.status === 'connected' && (
          <button
            onClick={() => onDisconnect(conn.id)}
            className="btn-ghost text-xs text-red-400 hover:text-red-300 ml-auto"
          >
            Déconnecter
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => onDelete(conn.id)}
            className="btn-ghost text-xs text-red-400 hover:text-red-300 ml-auto"
          >
            Supprimer
          </button>
        )}
      </div>

      {showEdit && (
        <div className="mt-3 space-y-2 border-t border-slate-700 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Login MT5</label>
              <input
                type="text"
                value={editForm.mt5_login}
                onChange={e => setEditForm(f => ({ ...f, mt5_login: e.target.value }))}
                className="w-full text-xs bg-transparent border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Serveur</label>
              <input
                type="text"
                list="mt5-servers-edit"
                value={editForm.mt5_server}
                onChange={e => setEditForm(f => ({ ...f, mt5_server: e.target.value }))}
                className="w-full text-xs bg-transparent border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 outline-none focus:border-blue-500 transition"
              />
              <datalist id="mt5-servers-edit">
                {servers.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Investor Password</label>
              <input
                type="password"
                value={editForm.investor_password}
                onChange={e => setEditForm(f => ({ ...f, investor_password: e.target.value }))}
                placeholder="Laisser vide = garder l'actuel"
                className="w-full text-xs bg-transparent border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500 transition"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Plateforme</label>
              <select
                value={editForm.platform}
                onChange={e => setEditForm(f => ({ ...f, platform: e.target.value }))}
                className="select-ghost w-full text-xs py-1.5 px-3"
              >
                <option value="mt5">MetaTrader 5</option>
                <option value="mt4">MetaTrader 4</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MT5Sync() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [servers, setServers] = useState([]);
  const [syncingId, setSyncingId] = useState(null);

  const isAdmin = (() => {
    try { return JSON.parse(localStorage.getItem('user'))?.is_admin === true; } catch { return false; }
  })();

  const loadData = useCallback(async () => {
    try {
      try {
        const conns = await API.get('/mt5/connections');
        setConnections(conns);
      } catch { setConnections([]); }

      try {
        const srvs = await API.get('/mt5/servers');
        setServers(srvs);
      } catch { setServers([]); }
    } catch (e) {
      console.error('loadData error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll for status updates every 10s
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const conns = await API.get('/mt5/connections');
        setConnections(conns);
      } catch { /* silent */ }
    }, 10_000);
    return () => clearInterval(iv);
  }, []);

  const handleSync = async (id) => {
    setSyncingId(id);
    try {
      await API.post(`/mt5/connections/${id}/sync`);
      setTimeout(loadData, 2000);
    } catch (e) {
      alert(e.message);
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async (id) => {
    if (!confirm('Déconnecter ce compte MT5 ? Le run Live Sync sera conservé.')) return;
    try {
      await API.del(`/mt5/connections/${id}`);
      API.invalidate();
      loadData();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRetry = async (id, body) => {
    try {
      await API.post(`/mt5/connections/${id}/retry`, body);
      API.invalidate();
      loadData();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette connexion ? Cette action est irréversible.')) return;
    try {
      await API.del(`/mt5/connections/${id}`);
      API.invalidate();
      loadData();
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-200 tracking-tight">MT5 Live Sync</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Connectez votre compte MetaTrader 5 pour synchroniser vos trades automatiquement.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          + Connecter un compte
        </button>
      </div>

      {/* How it works */}
      {connections.length === 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Comment ça marche ?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-400">
            <div className="flex gap-3">
              <span className="text-2xl">🔑</span>
              <div>
                <div className="font-medium text-slate-200 mb-0.5">1. Investor password</div>
                Entrez votre mot de passe investisseur (lecture seule, aucun risque de trading).
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-2xl">☁️</span>
              <div>
                <div className="font-medium text-slate-200 mb-0.5">2. Connexion cloud</div>
                MetaApi se connecte à votre broker depuis le cloud — aucun logiciel à installer.
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-2xl">🔄</span>
              <div>
                <div className="font-medium text-slate-200 mb-0.5">3. Sync automatique</div>
                Vos trades sont synchronisés une fois par jour dans un run "Live Sync".
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connection cards */}
      <div className="space-y-4">
        {connections.map(c => (
          <ConnectionCard
            key={c.id}
            conn={c}
            onSync={handleSync}
            onDisconnect={handleDisconnect}
            onRetry={handleRetry}
            onDelete={handleDelete}
            syncing={syncingId === c.id}
            servers={servers}
            isAdmin={isAdmin}
          />
        ))}
      </div>

      {/* Connect form modal */}
      {showForm && (
        <MT5ConnectForm
          variantId={null}
          onSuccess={() => { setShowForm(false); API.invalidate(); loadData(); }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
