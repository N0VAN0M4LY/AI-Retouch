import { useEffect, useState } from 'react';

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function useSpinner(intervalMs = 80): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % SPINNER_CHARS.length), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return SPINNER_CHARS[index];
}

export function useBlink(intervalMs = 530): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return visible;
}
