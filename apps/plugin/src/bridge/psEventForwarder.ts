import type { SelectionInfo } from '@ai-retouch/shared';
import { getActiveDocumentInfo } from '../ps/documentTracker';
import { getActiveSelectionInfo } from '../ps/imageExtractor';
import { sendEvent, isBridgeConnected } from './bridgeAgent';

const SELECTION_POLL_INTERVAL = 2000;

const psRequire = (globalThis as any).require as ((m: string) => any) | undefined;

let docListener: ((event: string, descriptor: unknown) => void) | null = null;
let selectionPollTimer: ReturnType<typeof setInterval> | null = null;
let lastSelectionJson: string | null = null;
let lastDocId: number | null = null;

function selectionToJson(sel: SelectionInfo | null): string {
  return sel ? `${sel.x},${sel.y},${sel.width},${sel.height}` : '';
}

function handleDocumentEvent(): void {
  if (!isBridgeConnected()) return;
  const info = getActiveDocumentInfo();
  const currentId = info?.id ?? null;
  if (currentId === lastDocId) return;
  lastDocId = currentId;
  sendEvent('documentChanged', {
    document: info ? { id: info.id, path: info.path, title: info.title } : null,
  });
}

function checkSelectionChange(): void {
  if (!isBridgeConnected()) return;
  const sel = getActiveSelectionInfo();
  const json = selectionToJson(sel);
  if (json === lastSelectionJson) return;
  lastSelectionJson = json;
  sendEvent('selectionChanged', { selection: sel });
}

export function startEventForwarder(): void {
  stopEventForwarder();

  const ps = psRequire?.('photoshop');
  if (!ps?.action) return;

  const info = getActiveDocumentInfo();
  lastDocId = info?.id ?? null;
  lastSelectionJson = selectionToJson(getActiveSelectionInfo());

  if (info) {
    sendEvent('documentChanged', {
      document: { id: info.id, path: info.path, title: info.title },
    });
  }

  docListener = () => handleDocumentEvent();
  try {
    ps.action.addNotificationListener(
      [{ event: 'select' }, { event: 'open' }, { event: 'close' }],
      docListener,
    );
  } catch (err) {
    console.warn('[Bridge EventForwarder] Failed to register doc listener:', err);
    docListener = null;
  }

  selectionPollTimer = setInterval(checkSelectionChange, SELECTION_POLL_INTERVAL);
}

export function stopEventForwarder(): void {
  if (docListener) {
    try {
      const ps = psRequire?.('photoshop');
      ps?.action?.removeNotificationListener(
        [{ event: 'select' }, { event: 'open' }, { event: 'close' }],
        docListener,
      );
    } catch { /* ignore */ }
    docListener = null;
  }

  if (selectionPollTimer) {
    clearInterval(selectionPollTimer);
    selectionPollTimer = null;
  }

  lastSelectionJson = null;
  lastDocId = null;
}
