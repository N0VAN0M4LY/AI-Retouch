import type { GenerationResult, RequestConfig, SendPolicy, SelectionInfo } from '@ai-retouch/shared';

import { updateResult } from '../lib/backend';
import { placeResultOnCanvas, type PlaceImageOptions } from './canvasWriter';
import { getActiveSelectionInfo } from './imageExtractor';
import {
  applyResultToSessionLayer,
  type SessionLayerBinding,
} from './sessionLayer';

// ─── Placement computation (extracted from DirectChat) ──

type PlacementParams = Omit<PlaceImageOptions, 'resultId' | 'imageWidth' | 'imageHeight'>;

/**
 * Determine how to place a result image on the canvas based on the send policy
 * and the selection that was active when the request was made.
 *
 * - fullImage + selection → full-canvas placement with mask at selection area
 * - regionImage + selection → scale to selection bounds with mask
 * - no selection → full-canvas placement, no mask
 */
export function computePlacementParams(
  policy: SendPolicy,
  selBounds?: SelectionInfo,
): PlacementParams {
  if (selBounds && policy.sendFullImage) {
    return { needsMask: true, restoreSelection: selBounds, layerName: 'AI Result' };
  }
  if (selBounds) {
    return { targetBounds: selBounds, needsMask: true, restoreSelection: selBounds, layerName: 'AI Result' };
  }
  return { layerName: 'AI Result' };
}

// ─── Unified apply-to-canvas ────────────────────────────

export interface SmartApplyOptions {
  sessionId?: string | null;
  documentPath?: string | null;
  /** Used when the result has no persisted sendPolicy. */
  fallbackSendPolicy?: SendPolicy;
}

export interface SmartApplyResult {
  binding: SessionLayerBinding | null;
}

/**
 * Unified "apply to canvas" that replicates Chat-quality placement from any UI
 * location (ResultDrawer, LibraryTab, etc.).
 *
 * Priority chain for placement data:
 *   1. result.requestConfig (persisted from the original generation request)
 *   2. fallbackSendPolicy + current PS selection (graceful degradation)
 *   3. current PS selection as simple targetBounds (last resort)
 */
export async function smartApplyToCanvas(
  result: GenerationResult,
  options: SmartApplyOptions,
): Promise<SmartApplyResult> {
  if (!result.width || !result.height) {
    throw new Error('Result has no dimensions');
  }

  const { documentPath, fallbackSendPolicy } = options;
  const sessionId = options.sessionId ?? result.sessionId;
  const reqConfig: RequestConfig | undefined = result.requestConfig;

  const placement = resolvePlacement(reqConfig, fallbackSendPolicy);

  const baseOptions: PlaceImageOptions = {
    resultId: result.id,
    imageWidth: result.width,
    imageHeight: result.height,
    ...placement,
    docPath: documentPath ?? undefined,
    sessionId: sessionId ?? undefined,
  };

  let binding: SessionLayerBinding | null = null;

  if (sessionId) {
    binding = await applyResultToSessionLayer(sessionId, result.id, baseOptions);
  } else {
    await placeResultOnCanvas(baseOptions);
  }

  await updateResult(
    result.id,
    { appliedToCanvas: true },
    documentPath ?? undefined,
    sessionId ?? undefined,
  );

  return { binding };
}

// ─── Internal helpers ───────────────────────────────────

function resolvePlacement(
  reqConfig: RequestConfig | undefined,
  fallbackPolicy: SendPolicy | undefined,
): PlacementParams {
  if (reqConfig) {
    const policy = reqConfig.sendPolicy;
    const sel = reqConfig.selectionBounds;
    if (policy) {
      return computePlacementParams(policy, sel);
    }
    if (sel) {
      return { targetBounds: sel, needsMask: true, restoreSelection: sel, layerName: 'AI Result' };
    }
  }

  if (fallbackPolicy) {
    const sel = getActiveSelectionInfo();
    if (sel) {
      return computePlacementParams(fallbackPolicy, sel);
    }
  }

  const currentSel = getActiveSelectionInfo();
  if (currentSel) {
    return { targetBounds: currentSel, needsMask: true, restoreSelection: currentSel, layerName: 'AI Result' };
  }

  return { layerName: 'AI Result' };
}
