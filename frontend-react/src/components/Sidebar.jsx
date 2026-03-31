import { useRef, useCallback, useEffect, useState } from 'react';
import { useSidebar } from '../hooks/useSidebar';
import { STATUS_LABELS } from '../lib/utils';

export default function Sidebar({ onNewStrategy }) {
  const { sidebarData, expanded, loading, toggleExpand, reorder } = useSidebar();
  const sidebarRef = useRef(null);
  const handleRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('sidebar_width'), 10);
    return (saved && saved >= 160 && saved <= 520) ? saved : 280;
  });
  const dragSrcRef = useRef(null);

  // Resize handle
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current?.offsetWidth || width;
    const sidebar = sidebarRef.current;
    if (sidebar) sidebar.classList.add('resizing');

    const onMove = (e) => {
      const w = Math.min(520, Math.max(160, startW + e.clientX - startX));
      setWidth(w);
    };
    const onUp = () => {
      if (sidebar) sidebar.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar_width', width);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  const toggleCollapse = useCallback(() => {
    setCollapsed(c => !c);
  }, []);

  return (
    <>
      <aside
        ref={sidebarRef}
        className={`sidebar bg-[#161b22] flex-shrink-0 overflow-y-auto ${collapsed ? 'collapsed' : ''}`}
        style={collapsed ? {} : { width: width + 'px' }}
      >
        <div className="p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Stratégies</span>
            <button onClick={onNewStrategy} className="text-xs text-blue-400 hover:text-blue-300 transition" title="Nouvelle stratégie">+ Ajouter</button>
          </div>
          <div className="space-y-1 flex flex-col flex-1">
            {loading ? (
              <div className="text-xs text-slate-500 italic py-4 text-center">Chargement...</div>
            ) : sidebarData.length === 0 ? (
              <div className="text-xs text-slate-500 italic py-4 text-center">Aucune stratégie</div>
            ) : (
              <>
                {sidebarData.map(s => (
                  <StrategyItem
                    key={s.id} strategy={s}
                    isOpen={!!expanded[s.id]}
                    onToggle={() => toggleExpand(s.id)}
                    dragSrcRef={dragSrcRef}
                    onReorder={reorder}
                  />
                ))}
                <div
                  className="strat-dnd-bottom"
                  onDragOver={e => { if (dragSrcRef.current) { e.preventDefault(); e.currentTarget.classList.add('dnd-over'); } }}
                  onDragLeave={e => e.currentTarget.classList.remove('dnd-over')}
                  onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('dnd-over'); if (dragSrcRef.current) reorder(dragSrcRef.current, null); }}
                />
              </>
            )}
          </div>
        </div>
      </aside>
      {!collapsed && (
        <div
          ref={handleRef}
          className="sidebar-resize-handle"
          onMouseDown={onMouseDown}
        />
      )}
    </>
  );
}

export { Sidebar };
export function useSidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);
  return { collapsed, toggle: () => setCollapsed(c => !c) };
}

function StrategyItem({ strategy: s, isOpen, onToggle, dragSrcRef, onReorder }) {
  const varCount = s.variants ? s.variants.length : 0;
  const listRef = useRef(null);

  return (
    <div
      className="mb-1 strat-dnd-item select-none"
      draggable
      data-strat-id={s.id}
      onDragStart={(e) => {
        dragSrcRef.current = s.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(s.id));
        e.currentTarget.classList.add('dragging');
        e.stopPropagation();
      }}
      onDragEnd={(e) => {
        e.currentTarget.classList.remove('dragging');
        dragSrcRef.current = null;
        e.stopPropagation();
      }}
      onDragOver={(e) => {
        if (!dragSrcRef.current || String(dragSrcRef.current) === String(s.id)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.stopPropagation();
        e.currentTarget.classList.add('dnd-over');
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        e.currentTarget.classList.remove('dnd-over');
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('dnd-over');
        if (dragSrcRef.current && String(dragSrcRef.current) !== String(s.id)) {
          onReorder(dragSrcRef.current, s.id);
        }
      }}
    >
      <div
        className={`strat-toggle ${isOpen ? 'open' : ''} flex items-center gap-2 px-2 py-1.5 rounded-md text-sm select-none`}
        onClick={(e) => { if (e.target.tagName !== 'A') onToggle(); }}
      >
        <span className="text-slate-600 cursor-grab hover:text-slate-400 transition text-base leading-none pointer-events-auto">⠿</span>
        <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <a href={`#/strategy/${s.id}`} className="flex-1 text-slate-200 hover:text-white truncate font-medium" draggable="false" title={s.name}>{s.name}</a>
        <span className="text-xs text-slate-500">{varCount}</span>
      </div>
      <div
        ref={listRef}
        className="variant-list pl-5"
        style={{ maxHeight: isOpen ? (varCount * 40 + 10) + 'px' : '0' }}
      >
        {s.variants?.map(v => (
          <VariantItem key={v.id} variant={v} strategyName={s.name} />
        ))}
      </div>
    </div>
  );
}

function VariantItem({ variant: v, strategyName }) {
  const dotColor = (v.status === 'active' || v.status === 'validated')
    ? 'bg-emerald-400'
    : (v.status === 'testing' || v.status === 'ready_to_test')
      ? 'bg-yellow-400'
      : v.status === 'rejected'
        ? 'bg-red-400'
        : 'bg-slate-500';

  return (
    <div
      className="sidebar-variant group px-3 py-2.5 text-xs"
      draggable
      data-variant-id={v.id}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-variant-id', String(v.id));
        e.dataTransfer.setData('application/x-variant-name', v.name);
        e.dataTransfer.setData('application/x-strategy-name', strategyName);
        e.dataTransfer.effectAllowed = 'copy';
        e.stopPropagation();
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-slate-500 cursor-grab group-active:cursor-grabbing transition opacity-0 group-hover:opacity-100">⠿</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
          <a href={`#/variant/${v.id}`} className="flex-1 text-slate-300 hover:text-white truncate font-medium transition" title={v.name}>{v.name}</a>
        </div>
        <span className={`status-${v.status} text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0`}>
          {STATUS_LABELS[v.status] || v.status}
        </span>
      </div>
    </div>
  );
}
