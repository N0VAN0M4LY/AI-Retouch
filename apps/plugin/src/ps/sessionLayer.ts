import {
  placeResultOnCanvas,
  replaceSmartObjectContent,
  type PlaceImageOptions,
} from './canvasWriter';

const psRequire = (globalThis as any).require as ((m: string) => any) | undefined;

function getPhotoshop() {
  const ps = psRequire?.('photoshop');
  if (!ps) throw new Error('Photoshop API not available');
  return ps;
}

export interface SessionLayerBinding {
  sessionId: string;
  layerId: number;
  layerName: string;
  currentResultId: string;
}

let currentBinding: SessionLayerBinding | null = null;

export function getSessionLayerBinding(): SessionLayerBinding | null {
  return currentBinding;
}

export function setSessionLayerBinding(binding: SessionLayerBinding | null): void {
  currentBinding = binding;
}

export function clearSessionLayerBinding(): void {
  currentBinding = null;
}

/**
 * Generate the standardized layer name for a session.
 * Format: [AI:xxxxxx] Result  (first 6 chars of sessionId)
 */
export function sessionLayerName(sessionId: string): string {
  return `[AI:${sessionId.slice(0, 6)}] Result`;
}

// ─── Layer search helpers ─────────────────────────────

function findLayerById(layers: any, targetId: number): any | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === targetId) return l;
    if (l.layers) {
      const found = findLayerById(l.layers, targetId);
      if (found) return found;
    }
  }
  return null;
}

function findLayerByName(layers: any, name: string): any | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.name === name) return l;
    if (l.layers) {
      const found = findLayerByName(l.layers, name);
      if (found) return found;
    }
  }
  return null;
}

function isLayerAlive(layerId: number): boolean {
  try {
    const ps = getPhotoshop();
    const doc = ps.app.activeDocument;
    if (!doc) return false;
    return findLayerById(doc.layers, layerId) !== null;
  } catch {
    return false;
  }
}

function scanLayerByName(layerName: string): number | null {
  try {
    const ps = getPhotoshop();
    const doc = ps.app.activeDocument;
    if (!doc) return null;
    const layer = findLayerByName(doc.layers, layerName);
    return layer ? layer.id : null;
  } catch {
    return null;
  }
}

/**
 * Apply a result to the session's working layer using a three-level lookup chain:
 *
 * Level 1: Memory cache → binding.layerId → isLayerAlive → replace content
 * Level 2: ID failed → scan layers by name pattern → found → update cache, replace
 * Level 3: Name not found → layer truly doesn't exist → create new
 */
export async function applyResultToSessionLayer(
  sessionId: string,
  resultId: string,
  options: PlaceImageOptions,
): Promise<SessionLayerBinding> {
  const binding = currentBinding;
  const layerName = sessionLayerName(sessionId);

  // ── Level 1: Memory cache with layerId check ──
  if (binding && binding.sessionId === sessionId && isLayerAlive(binding.layerId)) {
    if (binding.currentResultId === resultId) return binding;

    try {
      const newLayerId = await replaceSmartObjectContent(binding.layerId, resultId, options.docPath, options.sessionId);
      const updated: SessionLayerBinding = { ...binding, layerId: newLayerId, currentResultId: resultId };
      currentBinding = updated;
      console.log(`[sessionLayer] L1 hit: replaced layer #${binding.layerId} → #${newLayerId}, result ${resultId.slice(0, 8)}`);
      return updated;
    } catch (err) {
      console.warn('[sessionLayer] L1 replaceSmartObjectContent failed, trying L2:', err);
    }
  }

  // ── Level 2: Name scan ──
  const foundLayerId = scanLayerByName(layerName);
  if (foundLayerId !== null) {
    try {
      const newLayerId = await replaceSmartObjectContent(foundLayerId, resultId, options.docPath, options.sessionId);
      const recovered: SessionLayerBinding = {
        sessionId,
        layerId: newLayerId,
        layerName,
        currentResultId: resultId,
      };
      currentBinding = recovered;
      console.log(`[sessionLayer] L2 hit: found layer "${layerName}" #${foundLayerId} → #${newLayerId}, result ${resultId.slice(0, 8)}`);
      return recovered;
    } catch (err) {
      console.warn('[sessionLayer] L2 replaceSmartObjectContent failed, falling through to L3:', err);
    }
  }

  // ── Level 3: Create new layer ──
  const optionsWithName = { ...options, layerName };
  const { layerId } = await placeResultOnCanvas(optionsWithName);
  const newBinding: SessionLayerBinding = {
    sessionId,
    layerId,
    layerName,
    currentResultId: resultId,
  };
  currentBinding = newBinding;
  console.log(`[sessionLayer] L3: created new layer "${layerName}" #${layerId} → result ${resultId.slice(0, 8)}`);
  return newBinding;
}
