import { useState, useCallback, useRef, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { SidebarProvider } from './hooks/useSidebar';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import StrategyDetail from './pages/StrategyDetail';
import VariantDetail from './pages/VariantDetail';
import RunDetail from './pages/RunDetail';
import ImportCSV from './pages/ImportCSV';
import Compare from './pages/Compare';
import Modal, { InputField, TextareaField, SelectField } from './components/Modal';
import API from './lib/api';
import { useSidebar } from './hooks/useSidebar';

function getPageDepth(path) {
  if (!path || path === '/') return 0;
  if (path.match(/^\/strategy\//)) return 1;
  if (path === '/compare') return 1;
  if (path.match(/^\/import\//)) return 2;
  if (path.match(/^\/variant\//)) return 2;
  if (path.match(/^\/run\//)) return 3;
  return 1;
}

function AppInner() {
  const { reload } = useSidebar();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNewStrat, setShowNewStrat] = useState(false);
  const [compareSlotA, setCompareSlotA] = useState(null);
  const [compareSlotB, setCompareSlotB] = useState(null);

  const location = useLocation();
  const [animClass, setAnimClass] = useState('');
  const prevDepthRef = useRef(getPageDepth(location.pathname));

  const toggleSidebar = useCallback(() => setSidebarCollapsed(c => !c), []);

  useEffect(() => {
    const newDepth = getPageDepth(location.pathname);
    const dir = newDepth >= prevDepthRef.current ? 'page-enter-right' : 'page-enter-left';
    prevDepthRef.current = newDepth;
    setAnimClass(dir);
    const t = setTimeout(() => setAnimClass(''), 280);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const handleNewStrategy = useCallback(async (fd) => {
    const strat = await API.post('/strategies', {
      name: fd.get('name'),
      description: fd.get('description'),
      market: fd.get('market'),
      timeframe: fd.get('timeframe'),
    });
    const v = await API.post('/variants', {
      strategy_id: strat.id,
      name: strat.name + ' V1',
      status: 'active',
      key_change: '',
    });
    await reload();
    window.location.hash = '#/import/' + v.id;
  }, [reload]);

  return (
    <div className="flex flex-col h-screen w-screen">
      <Navbar onToggleSidebar={toggleSidebar} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar collapsed={sidebarCollapsed} onNewStrategy={() => setShowNewStrat(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6">
          <div key={location.pathname} className={animClass} style={{ minHeight: '100%' }}>
            <Routes>
              <Route path="/" element={<Dashboard onNewStrategy={() => setShowNewStrat(true)} />} />
              <Route path="/strategy/:id" element={<StrategyDetail setCompareSlotA={setCompareSlotA} setCompareSlotB={setCompareSlotB} />} />
              <Route path="/variant/:id" element={<VariantDetail setCompareSlotA={setCompareSlotA} />} />
              <Route path="/run/:id" element={<RunDetail />} />
              <Route path="/import/:variantId" element={<ImportCSV />} />
              <Route path="/compare" element={<Compare slotA={compareSlotA} slotB={compareSlotB} setSlotA={setCompareSlotA} setSlotB={setCompareSlotB} />} />
              <Route path="*" element={<p className="text-center mt-20 text-slate-400">Page introuvable</p>} />
            </Routes>
          </div>
        </main>
      </div>

      {showNewStrat && (
        <Modal title="Nouvelle Stratégie" onClose={() => setShowNewStrat(false)} onSubmit={handleNewStrategy}>
          <InputField name="name" label="Nom" required />
          <TextareaField name="description" label="Description" />
          <InputField name="market" label="Marché" required defaultValue="XAUUSD" />
          <SelectField name="timeframe" label="Timeframe" defaultValue="M15" options={[
            { value: 'M1', label: 'M1' }, { value: 'M5', label: 'M5' }, { value: 'M15', label: 'M15' },
            { value: 'M30', label: 'M30' }, { value: 'H1', label: 'H1' }, { value: 'H4', label: 'H4' },
            { value: 'D1', label: 'D1' }, { value: 'W1', label: 'W1' },
          ]} />
        </Modal>
      )}
    </div>
  );
}

export default function App() {
  return (
    <SidebarProvider>
      <AppInner />
    </SidebarProvider>
  );
}
