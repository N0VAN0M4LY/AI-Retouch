import { useEffect, useRef, useState } from 'react';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * UXP doesn't support CSS @keyframes or transition.
 * These hooks use setInterval + React state as a workaround.
 */

export function useSpinner(interval = 80): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % SPINNER_FRAMES.length), interval);
    return () => clearInterval(id);
  }, [interval]);
  return SPINNER_FRAMES[idx];
}

export function useBlink(interval = 530): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), interval);
    return () => clearInterval(id);
  }, [interval]);
  return visible;
}

/**
 * Track hover state since UXP has no CSS :hover transition.
 * Returns [hovered, { onMouseEnter, onMouseLeave }].
 */
export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hovered, setHovered] = useState(false);
  const handlers = useRef({
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  });
  return [hovered, handlers.current];
}
