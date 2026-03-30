import type { CSSProperties } from 'react';

export const T = {
  bg: '#0d0d0f',
  glass: 'rgba(255,255,255,0.04)',
  glass2: 'rgba(255,255,255,0.07)',
  glass3: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.08)',
  border2: 'rgba(255,255,255,0.14)',
  text: 'rgba(255,255,255,0.92)',
  text2: 'rgba(255,255,255,0.55)',
  text3: 'rgba(255,255,255,0.30)',
  accent: '#6c8aff',
  accent2: '#4a6aff',
  green: '#3dd68c',
  orange: '#ff9f43',
  purple: '#a87cff',
  red: '#ff6b6b',
} as const;

export const glass: CSSProperties = {
  background: T.glass,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  position: 'relative',
  flexShrink: 0,
};

export const glass2: CSSProperties = {
  ...glass,
  background: T.glass2,
};

export const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  borderRadius: 8,
  fontSize: 11,
  background: T.glass2,
  border: `1px solid ${T.border}`,
  color: T.text2,
  cursor: 'pointer',
};

export const pillActive: CSSProperties = {
  ...pill,
  background: 'rgba(108,138,255,0.18)',
  border: '1px solid rgba(108,138,255,0.35)',
  color: T.accent,
};

export const inputStyle: CSSProperties = {
  fontSize: 12,
  width: '100%',
};

export const btnPrimary: CSSProperties = {
  ...pill,
  background: 'rgba(108,138,255,0.15)',
  border: '1px solid rgba(108,138,255,0.35)',
  color: T.accent,
  fontWeight: 500,
  justifyContent: 'center',
};

export const btnDanger: CSSProperties = {
  ...pill,
  background: 'rgba(255,107,107,0.12)',
  border: '1px solid rgba(255,107,107,0.30)',
  color: T.red,
};

export const btnSuccess: CSSProperties = {
  ...pill,
  background: 'rgba(61,214,140,0.12)',
  border: '1px solid rgba(61,214,140,0.25)',
  color: T.green,
};
