import { useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getUnit, getCurrencySymbol } from '../lib/utils';

export default function Navbar({ onToggleSidebar, onLogout, user, onUpdateUser }) {
  const location = useLocation();
  const [unit, setUnitState] = useState(() => getUnit());
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  const handleUnitChange = useCallback((e) => {
    const val = e.target.value;
    localStorage.setItem('unitMode', val);
    setUnitState(val);
    window.dispatchEvent(new Event('unitchange'));
  }, []);

  const handleCurrencyChange = useCallback((e) => {
    const val = e.target.value;
    onUpdateUser?.({ currency: val });
    // Force refresh of currency-dependent displays
    window.dispatchEvent(new Event('unitchange'));
  }, [onUpdateUser]);

  const toggleTheme = useCallback(() => {
    const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
    if (next === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('theme', next);
    setTheme(next);
  }, []);

  const infoTexts = {
    pct: 'Résultat, gain moyen, etc. → % du capital initial. Perte max → % du pic.',
    R: 'R = valeur / |perte moyenne|. Calculé automatiquement depuis la perte moyenne du test affiché.',
  };

  return (
    <nav className="nav-glass border-b border-white/[0.06] sticky top-0 z-40">
      <div className="px-5 flex items-center justify-between h-[52px]">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold text-white tracking-tight hover:opacity-80 transition">
            <span className="text-base">📊</span> TradersLab
          </Link>
          <button onClick={onToggleSidebar} className="btn-ghost text-slate-500 hover:text-slate-300" title="Toggle sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect y="2" width="16" height="1.5" rx=".75" fill="currentColor"/><rect y="7.25" width="16" height="1.5" rx=".75" fill="currentColor"/><rect y="12.5" width="16" height="1.5" rx=".75" fill="currentColor"/></svg>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/" className="nav-link">Dashboard</Link>
          <Link to="/compare" className="nav-link">Comparer</Link>
          <Link to="/mt5-sync" className="nav-link">Connexion Live</Link>
          <div className="flex items-center gap-1 ml-2 pl-3 border-l border-white/[0.08]">
            <select value={unit} onChange={handleUnitChange} className="select-ghost text-xs" title="Unité d'affichage">
              <option value="cash">{getCurrencySymbol()} Montant</option>
              <option value="pct">%</option>
              <option value="R">R</option>
            </select>
            {infoTexts[unit] && (
              <span className="text-slate-500 text-xs cursor-help" title={infoTexts[unit]}>ℹ</span>
            )}
            <button onClick={toggleTheme} className="btn-ghost text-slate-500 hover:text-slate-300" title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}>
              {theme === 'dark' ? (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.697 2.697l1.06 1.06M11.243 11.243l1.06 1.06M12.303 2.697l-1.06 1.06M3.757 11.243l-1.06 1.06" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.5 9A5.5 5.5 0 0 1 5 1.5a5.5 5.5 0 1 0 7.5 7.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
              )}
            </button>
            {user && (
              <div className="flex items-center gap-1 ml-1 pl-2 border-l border-white/[0.08]">
                <select value={user.currency || 'USD'} onChange={handleCurrencyChange} className="select-ghost text-xs" title="Devise du compte">
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="JPY">JPY</option>
                  <option value="CHF">CHF</option>
                  <option value="CAD">CAD</option>
                  <option value="AUD">AUD</option>
                </select>
                <span className="text-xs text-slate-400 hidden sm:inline">{user.username}</span>
                <button onClick={onLogout} className="btn-ghost text-slate-500 hover:text-red-400" title="Se déconnecter">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 1H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
