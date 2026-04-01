import { useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getUnit, getUnitSettings, setUnitSettings } from '../lib/utils';
import Modal, { InputField } from './Modal';

export default function Navbar({ onToggleSidebar }) {
  const location = useLocation();
  const [unit, setUnitState] = useState(() => getUnit());
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  const handleUnitChange = useCallback((e) => {
    const val = e.target.value;
    localStorage.setItem('unitMode', val);
    setUnitState(val);
    // Force re-render by triggering a custom event
    window.dispatchEvent(new Event('unitchange'));
  }, []);

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
    pct: 'PnL, expectancy, avg… → % du capital initial. Drawdown → % du pic equity. Trade → % du solde avant le trade.',
    R: 'R = valeur / |avg loss|. Le risque moyen est calculé automatiquement depuis le avg_loss du run affiché.',
  };

  return (
    <>
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
            <div className="flex items-center gap-1 ml-2 pl-3 border-l border-white/[0.08]">
              <select value={unit} onChange={handleUnitChange} className="select-ghost text-xs" title="Unité d'affichage">
                <option value="cash">$ Cash</option>
                <option value="pct">%</option>
                <option value="R">R</option>
              </select>
              {infoTexts[unit] && (
                <span className="text-slate-500 text-xs cursor-help" title={infoTexts[unit]}>ℹ</span>
              )}
              <button onClick={() => setShowSettings(true)} className="btn-ghost text-slate-500 hover:text-slate-300" title="Paramètres unités">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.4"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.636 2.636l1.06 1.06M10.304 10.304l1.06 1.06M11.364 2.636l-1.06 1.06M3.696 10.304l-1.06 1.06" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              <button onClick={toggleTheme} className="btn-ghost text-slate-500 hover:text-slate-300" title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}>
                {theme === 'dark' ? (
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.697 2.697l1.06 1.06M11.243 11.243l1.06 1.06M12.303 2.697l-1.06 1.06M3.757 11.243l-1.06 1.06" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.5 9A5.5 5.5 0 0 1 5 1.5a5.5 5.5 0 1 0 7.5 7.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {showSettings && (
        <Modal title="Paramètres des unités" onClose={() => setShowSettings(false)} onSubmit={(fd) => {
          const settings = getUnitSettings();
          settings.initial_balance = parseFloat(fd.get('initial_balance')) || 10000;
          setUnitSettings(settings);
          window.dispatchEvent(new Event('unitchange'));
        }}>
          <InputField name="initial_balance" label="Capital initial ($)" type="number" required value={getUnitSettings().initial_balance} />
        </Modal>
      )}
    </>
  );
}
