import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectionInfo } from '@ai-retouch/shared';

const POLL_INTERVAL = 2000;

export function selectionEquals(
  a: SelectionInfo | null | undefined,
  b: SelectionInfo | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= 1 &&
    Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1
  );
}

export interface UseSelectionPollingOptions {
  enabled: boolean;
  getSelection: () => Promise<SelectionInfo | null>;
  /** Optional: subscribe to push events for faster response (e.g. bridgeReady selection events). */
  subscribeToEvents?: (handler: (sel: SelectionInfo | null) => void) => () => void;
  onSelectionChange?: (newSel: SelectionInfo | null, prevSel: SelectionInfo | null) => void;
}

export interface UseSelectionPollingReturn {
  liveSelection: SelectionInfo | null;
  lockedSelection: SelectionInfo | null;
  effectiveSelection: SelectionInfo | null;
  hasSelection: boolean;
  isLocked: boolean;
  lock: (selection?: SelectionInfo | null) => void;
  unlock: () => void;
  refreshToken: number;
}

export function useSelectionPolling({
  enabled,
  getSelection,
  subscribeToEvents,
  onSelectionChange,
}: UseSelectionPollingOptions): UseSelectionPollingReturn {
  const [liveSelection, setLiveSelection] = useState<SelectionInfo | null>(null);
  const [lockedSelection, setLockedSelection] = useState<SelectionInfo | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const prevSelRef = useRef<SelectionInfo | null>(null);
  const liveSelRef = useRef<SelectionInfo | null>(null);
  const onChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onSelectionChange;
  const getSelectionRef = useRef(getSelection);
  getSelectionRef.current = getSelection;

  const effectiveSelection = isLocked ? lockedSelection : liveSelection;
  const hasSelection = effectiveSelection !== null;

  const updateSelection = useCallback((sel: SelectionInfo | null) => {
    if (!selectionEquals(sel, prevSelRef.current)) {
      const prev = prevSelRef.current;
      prevSelRef.current = sel;
      liveSelRef.current = sel;
      setLiveSelection(sel);
      setRefreshToken((t) => t + 1);
      onChangeRef.current?.(sel, prev);
    }
  }, []);

  useEffect(() => {
    if (!enabled || isLocked) return;

    // Initial fetch
    getSelectionRef.current().then(updateSelection).catch(() => {});

    // Push events (optional)
    let unsubEvents: (() => void) | undefined;
    if (subscribeToEvents) {
      unsubEvents = subscribeToEvents((sel) => updateSelection(sel));
    }

    // Polling fallback
    const timer = setInterval(() => {
      getSelectionRef.current().then(updateSelection).catch(() => {});
    }, POLL_INTERVAL);

    return () => {
      unsubEvents?.();
      clearInterval(timer);
    };
  }, [enabled, isLocked, subscribeToEvents, updateSelection]);

  const lock = useCallback((selection?: SelectionInfo | null) => {
    setLockedSelection(selection !== undefined ? selection : liveSelRef.current);
    setIsLocked(true);
  }, []);

  const unlock = useCallback(() => {
    setLockedSelection(null);
    setIsLocked(false);
    getSelectionRef.current().then((sel) => {
      setLiveSelection(sel);
      liveSelRef.current = sel;
      prevSelRef.current = sel;
    }).catch(() => {});
  }, []);

  return {
    liveSelection,
    lockedSelection,
    effectiveSelection,
    hasSelection,
    isLocked,
    lock,
    unlock,
    refreshToken,
  };
}
