import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-mode';

function getSystemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveEffective(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (getSystemPrefersDark() ? 'dark' : 'light') : mode;
}

function applyTheme(effective: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', effective);
}

export function useTheme() {
  const [mode, setModeRaw] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return saved && ['light', 'dark', 'system'].includes(saved) ? saved : 'dark';
  });

  const effective = resolveEffective(mode);

  useEffect(() => {
    applyTheme(effective);
  }, [effective]);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(resolveEffective('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeRaw(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return { mode, effective, setMode };
}
