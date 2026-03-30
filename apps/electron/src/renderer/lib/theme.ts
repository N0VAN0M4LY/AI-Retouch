/**
 * Zen-iOS Hybrid Design Tokens
 *
 * Cold-gray palette with frosted-glass layering,
 * dual-stroke borders, and physical depth cues.
 */

export const Z = {
  // ── Base Layer ──────────────────────────────────────
  bg:           '#F2F2F7',
  bgSecondary:  '#E5E5EA',
  bgTertiary:   '#D1D1D6',

  // ── Glass Surfaces ─────────────────────────────────
  glass:        'rgba(255,255,255,0.55)',
  glassHover:   'rgba(255,255,255,0.70)',
  glassActive:  'rgba(255,255,255,0.80)',
  glassMuted:   'rgba(255,255,255,0.35)',
  glassInset:   'rgba(243,243,248,0.50)',

  // ── Text ───────────────────────────────────────────
  text:         '#1C1C1E',
  text2:        '#3C3C43',
  text3:        '#8E8E93',
  text4:        '#AEAEB2',
  textInverse:  '#FFFFFF',

  // ── Borders (Dual-stroke) ──────────────────────────
  borderInner:  'rgba(255,255,255,0.60)',
  borderOuter:  'rgba(209,209,214,0.45)',
  borderSubtle: 'rgba(60,60,67,0.08)',

  // ── Accent ─────────────────────────────────────────
  accent:       '#007AFF',
  accentSoft:   'rgba(0,122,255,0.10)',
  accentHover:  '#0056CC',

  // ── Semantic ───────────────────────────────────────
  green:        '#34C759',
  greenSoft:    'rgba(52,199,89,0.12)',
  orange:       '#FF9500',
  orangeSoft:   'rgba(255,149,0,0.12)',
  red:          '#FF3B30',
  redSoft:      'rgba(255,59,48,0.10)',

  // ── Button ─────────────────────────────────────────
  btnPrimary:   '#1C1C1E',
  btnPrimaryHover: '#2C2C2E',
  btnSecondary: '#FFFFFF',

  // ── Shadows ────────────────────────────────────────
  shadow: {
    float:   '0 24px 48px -12px rgba(0,0,0,0.08)',
    medium:  '0 8px 24px -4px rgba(0,0,0,0.06)',
    small:   '0 2px 8px -2px rgba(0,0,0,0.05)',
    glow:    '0 0 0 4px rgba(0,122,255,0.12)',
    inner:   'inset 0 1px 3px rgba(0,0,0,0.06)',
    innerDeep: 'inset 0 2px 6px rgba(0,0,0,0.08)',
  },

  // ── Blur ───────────────────────────────────────────
  blur:      '40px',
  blurHeavy: '60px',
  blurLight: '20px',

  // ── Radius (continuous curvature) ──────────────────
  radius: {
    xl:  '40px',
    lg:  '28px',
    md:  '16px',
    sm:  '12px',
    xs:  '8px',
    pill: '9999px',
  },

  // ── Animation ──────────────────────────────────────
  anim: {
    fast:   '0.12s ease',
    normal: '0.2s ease',
    slow:   '0.35s cubic-bezier(0.4, 0, 0.2, 1)',
    spring: '0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

/** Shorthand for common inline style patterns */
export const glassPanel = (level: 'base' | 'raised' | 'inset' = 'base'): React.CSSProperties => {
  const bg = level === 'inset' ? Z.glassInset
    : level === 'raised' ? Z.glassHover
    : Z.glass;
  return {
    background: bg,
    backdropFilter: `blur(${Z.blur}) saturate(180%)`,
    WebkitBackdropFilter: `blur(${Z.blur}) saturate(180%)`,
    border: `1px solid ${Z.borderInner}`,
    boxShadow: `0 0 0 1px ${Z.borderOuter}, ${level === 'raised' ? Z.shadow.medium : Z.shadow.small}`,
    borderRadius: Z.radius.md,
  };
};

export const insetField: React.CSSProperties = {
  background: Z.glassInset,
  border: `1px solid ${Z.borderOuter}`,
  boxShadow: Z.shadow.inner,
  borderRadius: Z.radius.xs,
  color: Z.text,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: Z.text3,
};
