import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
  align?: 'left' | 'right';
  delay?: number;
  style?: CSSProperties;
}

export default function Tooltip({ text, children, position = 'bottom', align = 'left', delay = 350, style }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible || !triggerRef.current) { setCoords(null); return; }
    const rect = triggerRef.current.getBoundingClientRect();
    const top = position === 'top' ? rect.top - 4 : rect.bottom + 4;
    const left = align === 'right' ? rect.right : rect.left;
    setCoords({ top, left });
  }, [visible, position, align]);

  if (!text) return <>{children}</>;

  const transformOrigin = position === 'top' ? 'bottom' : 'top';
  const translateY = position === 'top' ? '-100%' : '0';
  const translateX = align === 'right' ? '-100%' : '0';

  return (
    <div ref={triggerRef} onMouseEnter={show} onMouseLeave={hide} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      {children}
      {visible && coords && createPortal(
        <div className="tooltip-bubble" style={{
          position: 'fixed',
          top: coords.top,
          left: coords.left,
          transform: `translate(${translateX}, ${translateY})`,
          transformOrigin: `${transformOrigin} ${align}`,
          padding: '3px 8px', borderRadius: 6,
          background: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)',
          borderTop: '1px solid var(--tooltip-border)',
          color: '#FFFFFF', fontSize: 10, lineHeight: 1.3, letterSpacing: 0.2,
          whiteSpace: 'normal', maxWidth: 200, width: 'max-content', zIndex: 9999,
          pointerEvents: 'none',
        }}>
          {text}
        </div>,
        document.body,
      )}
    </div>
  );
}
