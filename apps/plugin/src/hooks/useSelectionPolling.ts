import { useCallback, useEffect, useRef, useState } from 'react';

import type { SelectionInfo } from '@ai-retouch/shared';

import { getActiveSelectionInfo } from '../ps/imageExtractor';

const POLL_INTERVAL = 2000;

export function selectionEquals(
  a: SelectionInfo | null | undefined,
  b: SelectionInfo | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= 1
    && Math.abs(a.y - b.y) <= 1
    && Math.abs(a.width - b.width) <= 1
    && Math.abs(a.height - b.height) <= 1;
}

export interface UseSelectionPollingOptions {
  psAvailable: boolean;
  /**
   * Fired whenever the live PS selection changes (only while unlocked).
   * Useful for switching SendPolicy when selection appears/disappears.
   */
  onSelectionChange?: (newSel: SelectionInfo | null, prevSel: SelectionInfo | null) => void;
}

export interface UseSelectionPollingReturn {
  /** Current live PS selection (updated by polling while unlocked). */
  liveSelection: SelectionInfo | null;
  /** Frozen selection after lock() is called. */
  lockedSelection: SelectionInfo | null;
  /** liveSelection when unlocked, lockedSelection when locked. */
  effectiveSelection: SelectionInfo | null;
  hasSelection: boolean;
  isLocked: boolean;
  /** Freeze the selection and stop polling. Pass explicit selection or defaults to current live value. */
  lock: (selection?: SelectionInfo | null) => void;
  /** Resume polling and clear the locked selection. */
  unlock: () => void;
  /** Monotonically increasing counter, bumped on every selection change. */
  refreshToken: number;
}

export function useSelectionPolling({
  psAvailable,
  onSelectionChange,
}: UseSelectionPollingOptions): UseSelectionPollingReturn {
  const [liveSelection, setLiveSelection] = useState<SelectionInfo | null>(null);
  const [lockedSelection, setLockedSelection] = useState<SelectionInfo | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const prevLiveSelRef = useRef<SelectionInfo | null>(null);
  const liveSelectionRef = useRef<SelectionInfo | null>(null);
  const onChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onSelectionChange;

  const effectiveSelection = isLocked ? lockedSelection : liveSelection;
  const hasSelection = !!effectiveSelection;

  useEffect(() => {
    if (!psAvailable || isLocked) return;
    function check() {
      const psSel = getActiveSelectionInfo();
      if (!selectionEquals(psSel, prevLiveSelRef.current)) {
        const prev = prevLiveSelRef.current;
        setLiveSelection(psSel);
        liveSelectionRef.current = psSel;
        setRefreshToken((t) => t + 1);
        onChangeRef.current?.(psSel, prev);
      }
      prevLiveSelRef.current = psSel;
    }
    check();
    const timer = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [psAvailable, isLocked]);

  const lock = useCallback((selection?: SelectionInfo | null) => {
    const selToLock = selection !== undefined ? selection : liveSelectionRef.current;
    setLockedSelection(selToLock);
    setIsLocked(true);
  }, []);

  const unlock = useCallback(() => {
    const psSel = psAvailable ? getActiveSelectionInfo() : null;
    setLockedSelection(null);
    setIsLocked(false);
    setLiveSelection(psSel);
    liveSelectionRef.current = psSel;
    prevLiveSelRef.current = psSel;
  }, [psAvailable]);

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
