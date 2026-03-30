import { useState, useEffect, useCallback } from 'react';

type PinMode = 'auto' | 'always' | 'never';

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        setLayoutSize?: (layout: 'classic' | 'v2') => Promise<void>;
      };
      pin: {
        getMode: () => Promise<PinMode>;
        setMode: (mode: PinMode) => Promise<void>;
      };
    };
  }
}

const PIN_CYCLE: PinMode[] = ['auto', 'always', 'never'];
const PIN_LABELS: Record<PinMode, string> = {
  auto: '自动置顶（跟随 PS）',
  always: '始终置顶',
  never: '从不置顶',
};

interface TitlebarProps {
  backendConnected?: boolean;
  bridgeConnected?: boolean;
}

export default function Titlebar({ backendConnected = false, bridgeConnected = false }: TitlebarProps) {
  const [pinMode, setPinMode] = useState<PinMode>('auto');

  useEffect(() => {
    window.electronAPI?.pin?.getMode?.().then(setPinMode).catch(() => {});
  }, []);

  const cyclePinMode = useCallback(() => {
    const idx = PIN_CYCLE.indexOf(pinMode);
    const next = PIN_CYCLE[(idx + 1) % PIN_CYCLE.length];
    setPinMode(next);
    window.electronAPI?.pin?.setMode?.(next).catch(() => {});
  }, [pinMode]);

  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-title">AI Retouch</span>
        <div className="titlebar-status">
          <span
            className={`status-dot ${backendConnected ? 'connected' : 'disconnected'}`}
            title={`Backend: ${backendConnected ? 'Connected' : 'Disconnected'}`}
          />
          <span
            className={`status-dot ${bridgeConnected ? 'connected' : 'disconnected'}`}
            title={`PS Bridge: ${bridgeConnected ? 'Connected' : 'Disconnected'}`}
          />
        </div>
      </div>
      <div className="titlebar-controls">
        <button
          className={`titlebar-btn titlebar-btn-pin ${pinMode !== 'never' ? 'active' : ''}`}
          onClick={cyclePinMode}
          title={PIN_LABELS[pinMode]}
        >
          <PinIcon mode={pinMode} />
        </button>
        <button className="titlebar-btn" onClick={() => window.electronAPI.window.minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 1" fill="none">
            <rect width="11" height="1.2" rx="0.6" fill="currentColor" />
          </svg>
        </button>
        <button className="titlebar-btn" onClick={() => window.electronAPI.window.maximize()}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.75" y="0.75" width="9.5" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
          </svg>
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={() => window.electronAPI.window.close()}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function PinIcon({ mode }: { mode: PinMode }) {
  if (mode === 'never') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45 }}>
        <line x1="2" y1="2" x2="22" y2="22" />
        <path d="M12 17v5" />
        <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V9" />
        <line x1="9.31" y1="4" x2="14.69" y2="4" />
      </svg>
    );
  }
  const isAuto = mode === 'auto';
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={isAuto ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: isAuto ? 0.7 : 1 }}>
      <path d="M12 17v5" />
      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V9" />
      <line x1="9.31" y1="4" x2="14.69" y2="4" />
      {isAuto && <text x="12" y="15" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="bold">A</text>}
    </svg>
  );
}
