import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'onboarding_v2';

/* ─── Step definitions per page ─── */

const FLOWS = {
  // Dashboard — appears on first visit
  dashboard: [
    {
      title: 'Bienvenue sur TradersLab 👋',
      text: 'Votre journal de trading. Suivez vos stratégies, comparez vos versions et analysez vos performances en quelques clics.',
      position: 'center',
    },
    {
      selector: '[data-onboarding="sidebar"]',
      title: 'Vos stratégies',
      text: "Toutes vos stratégies sont accessibles ici. Cliquez sur l'une d'elles pour voir ses versions et ses résultats.",
      position: 'right',
    },
    {
      selector: '[data-onboarding="new-strategy"]',
      title: 'Créez votre première stratégie',
      text: "Commencez par créer une stratégie. Vous pourrez ensuite y ajouter des versions et importer vos trades.",
      position: 'bottom',
    },
  ],
  // Strategy detail
  strategy: [
    {
      selector: '[data-onboarding="new-version"]',
      title: 'Créer une version',
      text: 'Chaque fois que vous modifiez votre stratégie, créez une nouvelle version pour comparer les résultats avant / après.',
      position: 'bottom',
    },
    {
      selector: '[data-onboarding="import-trades"]',
      title: 'Importer vos trades',
      text: "Importez un fichier CSV ou les données de votre compte MT5 pour alimenter cette version avec vos résultats réels.",
      position: 'bottom',
    },
  ],
};

/* ─── Tooltip ─── */

function Tooltip({ step, rect, onNext, onSkip, current, total }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [arrowSide, setArrowSide] = useState('top');
  const [arrowOffset, setArrowOffset] = useState(null);

  useEffect(() => {
    if (!ref.current) return;
    const ttW = ref.current.offsetWidth;
    const ttH = ref.current.offsetHeight;
    const pad = 16;

    if (step.position === 'center' || !rect) {
      setPos({
        top: Math.max(pad, (window.innerHeight - ttH) / 2),
        left: Math.max(pad, (window.innerWidth - ttW) / 2),
      });
      setArrowSide('none');
      setArrowOffset(null);
      return;
    }

    let top, left;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    if (step.position === 'bottom') {
      top = rect.bottom + 14;
      left = cx - ttW / 2;
      setArrowSide('top');
    } else if (step.position === 'top') {
      top = rect.top - ttH - 14;
      left = cx - ttW / 2;
      setArrowSide('bottom');
    } else if (step.position === 'right') {
      top = cy - ttH / 2;
      left = rect.right + 14;
      setArrowSide('left');
    } else {
      top = cy - ttH / 2;
      left = rect.left - ttW - 14;
      setArrowSide('right');
    }

    // Clamp
    const clampedLeft = Math.max(pad, Math.min(window.innerWidth - ttW - pad, left));
    const clampedTop = Math.max(pad, Math.min(window.innerHeight - ttH - pad, top));

    // Arrow points at center of target element, relative to clamped tooltip
    if (step.position === 'bottom' || step.position === 'top') {
      setArrowOffset(Math.max(16, Math.min(ttW - 16, cx - clampedLeft)));
    } else {
      setArrowOffset(Math.max(16, Math.min(ttH - 16, cy - clampedTop)));
    }

    setPos({ top: clampedTop, left: clampedLeft });
  }, [rect, step.position]);

  return (
    <div
      ref={ref}
      className="onboarding-tooltip"
      style={{
        position: 'fixed', zIndex: 100002,
        top: pos ? pos.top : 0,
        left: pos ? pos.left : 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {arrowSide !== 'none' && arrowOffset != null && (
        <div
          className={`onboarding-arrow onboarding-arrow-${arrowSide}`}
          style={
            arrowSide === 'top' || arrowSide === 'bottom'
              ? { left: arrowOffset, marginLeft: -6 }
              : { top: arrowOffset, marginTop: -6 }
          }
        />
      )}
      <h3 className="text-sm font-semibold text-white mb-1.5">{step.title}</h3>
      <p className="text-xs text-slate-300 leading-relaxed mb-4">{step.text}</p>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">{current + 1} / {total}</span>
        <div className="flex gap-2">
          <button onClick={onSkip} className="text-xs text-slate-400 hover:text-white transition px-2 py-1">Passer</button>
          <button onClick={onNext} className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition font-medium">
            {current < total - 1 ? 'Suivant →' : 'Compris ✓'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Spotlight overlay (SVG mask with cutout) ─── */

function Overlay({ rect }) {
  // rect can be null for centered steps
  return (
    <svg
      className="onboarding-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 100000, width: '100vw', height: '100vh', pointerEvents: 'none' }}
    >
      <defs>
        <mask id="onboarding-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {rect && (
            <rect
              x={rect.left - 6}
              y={rect.top - 6}
              width={rect.width + 12}
              height={rect.height + 12}
              rx="10"
              fill="black"
            />
          )}
        </mask>
      </defs>
      <rect
        x="0" y="0" width="100%" height="100%"
        fill="rgba(0,0,0,0.55)"
        mask="url(#onboarding-mask)"
        style={{ pointerEvents: 'all' }}
      />
    </svg>
  );
}

/* ─── Main Onboarding component ─── */

export default function Onboarding({ flow }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [targetRect, setTargetRect] = useState(null);

  const steps = FLOWS[flow];
  if (!steps) return null;

  const flowKey = STORAGE_KEY + '_' + flow;

  useEffect(() => {
    // Check if already done
    try {
      if (localStorage.getItem(flowKey)) return;
    } catch {}

    // Small delay so DOM is rendered
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, [flowKey]);

  // Position target element
  useEffect(() => {
    if (!visible || !steps[step]) return;
    const s = steps[step];
    if (!s.selector) { setTargetRect(null); return; }

    const el = document.querySelector(s.selector);
    if (!el) { setTargetRect(null); return; }

    const rect = el.getBoundingClientRect();
    setTargetRect(rect);

    // Pulse ring on element
    el.classList.add('onboarding-highlight');
    return () => el.classList.remove('onboarding-highlight');
  }, [visible, step, steps]);

  const finish = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(flowKey, '1'); } catch {}
  }, [flowKey]);

  const next = useCallback(() => {
    if (step >= steps.length - 1) {
      finish();
    } else {
      setStep(s => s + 1);
    }
  }, [step, steps.length, finish]);

  if (!visible) return null;

  return createPortal(
    <div className="onboarding-root">
      <Overlay rect={targetRect} />
      {/* Click-catcher above overlay but below tooltip */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 100001 }}
        onClick={next}
      />
      <Tooltip
        step={steps[step]}
        rect={targetRect}
        onNext={next}
        onSkip={finish}
        current={step}
        total={steps.length}
      />
    </div>,
    document.body
  );
}

/* ─── Helper: reset onboarding for testing ─── */
export function resetOnboarding() {
  Object.keys(FLOWS).forEach(k => {
    try { localStorage.removeItem(STORAGE_KEY + '_' + k); } catch {}
  });
}
