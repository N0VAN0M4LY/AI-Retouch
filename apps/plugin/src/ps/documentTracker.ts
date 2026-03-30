const psRequire = (globalThis as any).require as ((m: string) => any) | undefined;

export interface DocumentInfo {
  id: number;
  path: string;
  title: string;
}

let lastDocId: number | null = null;
let listener: ((event: string, descriptor: unknown) => void) | null = null;
let onChangeCallback: ((doc: DocumentInfo | null) => void) | null = null;

function getPhotoshopAction() {
  const ps = psRequire?.('photoshop');
  if (!ps) return null;
  return ps.action;
}

export function getActiveDocumentInfo(): DocumentInfo | null {
  try {
    const ps = psRequire?.('photoshop');
    if (!ps) return null;
    const doc = ps.app.activeDocument;
    if (!doc) return null;
    return {
      id: doc.id,
      path: doc.path ?? '',
      title: doc.title ?? '',
    };
  } catch {
    return null;
  }
}

function handleEvent() {
  try {
    const info = getActiveDocumentInfo();
    const currentId = info?.id ?? null;
    console.log(`[docTracker] event: currentId=${currentId} lastDocId=${lastDocId} path=${info?.path}`);
    if (currentId !== lastDocId) {
      lastDocId = currentId;
      onChangeCallback?.(info);
    }
  } catch (err) {
    console.warn('[docTracker] handleEvent error:', err);
  }
}

export function startDocumentTracking(onChange: (doc: DocumentInfo | null) => void): void {
  stopDocumentTracking();

  onChangeCallback = onChange;
  const info = getActiveDocumentInfo();
  lastDocId = info?.id ?? null;
  console.log(`[docTracker] Started tracking. Initial doc: id=${lastDocId} path=${info?.path}`);

  const action = getPhotoshopAction();
  if (!action) return;

  listener = () => handleEvent();

  try {
    action.addNotificationListener(
      [
        { event: 'select' },
        { event: 'open' },
        { event: 'close' },
      ],
      listener,
    );
  } catch (err) {
    console.warn('[documentTracker] Failed to register notification listener:', err);
    listener = null;
  }
}

export function stopDocumentTracking(): void {
  if (listener) {
    try {
      const action = getPhotoshopAction();
      action?.removeNotificationListener(
        [
          { event: 'select' },
          { event: 'open' },
          { event: 'close' },
        ],
        listener,
      );
    } catch {
      // ignore
    }
    listener = null;
  }
  onChangeCallback = null;
  lastDocId = null;
}
