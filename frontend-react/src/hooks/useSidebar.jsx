import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import API from '../lib/api';
import { useAuth } from './useAuth';

const SidebarContext = createContext();

const STRAT_ORDER_KEY = 'strategyOrder';

function getSavedOrder() {
  try { return JSON.parse(localStorage.getItem(STRAT_ORDER_KEY)) || []; } catch { return []; }
}

function sortData(data) {
  const order = getSavedOrder();
  if (!order.length) return data;
  return [...data].sort((a, b) => {
    let ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia === -1) ia = 9999;
    if (ib === -1) ib = 9999;
    return ia - ib;
  });
}

export function SidebarProvider({ children }) {
  const { user } = useAuth();
  const [sidebarData, setSidebarData] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) { setSidebarData([]); setLoading(false); return; }
    try {
      const strategies = await API.get('/strategies');
      // Fetch all strategy details in parallel
      const details = await Promise.all(strategies.map(s => API.get('/strategies/' + s.id)));
      setSidebarData(sortData(details));
    } catch {
      setSidebarData([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const toggleExpand = useCallback((id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const reorder = useCallback((fromId, toId) => {
    setSidebarData(prev => {
      const data = [...prev];
      const srcIdx = data.findIndex(s => String(s.id) === String(fromId));
      if (srcIdx === -1) return prev;
      const [moved] = data.splice(srcIdx, 1);
      if (toId === null) {
        data.push(moved);
      } else {
        const tgtIdx = data.findIndex(s => String(s.id) === String(toId));
        if (tgtIdx !== -1) data.splice(tgtIdx, 0, moved);
        else data.push(moved);
      }
      localStorage.setItem(STRAT_ORDER_KEY, JSON.stringify(data.map(s => s.id)));
      return data;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ sidebarData, expanded, loading, reload, toggleExpand, reorder }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
