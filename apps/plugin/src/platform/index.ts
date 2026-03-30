import type { PlatformContext, PSOperations, EventBus, PlatformCapabilities } from '@ai-retouch/ui-core/platform';
import type { ExtractImageParams, SmartApplyParams, PlaceResultParams } from '@ai-retouch/shared';
import { extractImageContext } from '../ps/imageExtractor';
import { smartApplyToCanvas } from '../ps/applyHelper';
import { getActiveDocumentInfo } from '../ps/documentTracker';
import { getActiveSelectionInfo } from '../ps/imageExtractor';
import { onBridgeEvent } from '../bridge/bridgeAgent';

function extractImageFromPlugin(params: ExtractImageParams) {
  return extractImageContext(params.sourceMode, params.sendPolicy, {
    overrideSelection: params.overrideSelection,
    maxResolution: params.maxResolution,
    preserveBitDepth: params.preserveBitDepth,
    rawFloat32: params.rawFloat32,
  });
}

async function applyResultFromPlugin(params: SmartApplyParams): Promise<{ layerId?: number; layerName?: string }> {
  // Build a minimal GenerationResult-like object for smartApplyToCanvas
  const result = {
    id: params.resultId,
    width: params.width,
    height: params.height,
    sessionId: params.sessionId ?? undefined,
    requestConfig: params.requestConfig,
    bookmarked: false,
    appliedToCanvas: false,
    createdAt: new Date().toISOString(),
    source: 'chat' as const,
  };
  const r = await smartApplyToCanvas(result as any, {
    documentPath: params.documentPath ?? undefined,
    sessionId: params.sessionId ?? undefined,
    fallbackSendPolicy: params.fallbackSendPolicy,
  });
  return { layerId: r?.binding?.layerId, layerName: r?.binding?.layerName };
}

async function placeResultFromPlugin(params: PlaceResultParams): Promise<{ layerId?: number }> {
  // Plugin does not support bare placeResult without a session — use applyResult
  const { applyResultToSessionLayer } = await import('../ps/sessionLayer');
  if (params.sessionId) {
    const binding = await applyResultToSessionLayer(params.sessionId, params.resultId, params);
    return { layerId: binding?.layerId };
  }
  const { placeResultOnCanvas } = await import('../ps/canvasWriter');
  await placeResultOnCanvas(params);
  return {};
}

const ps: PSOperations = {
  get isConnected() { return true; }, // UXP plugin — PS is always available
  getDocument: () => {
    const info = getActiveDocumentInfo();
    if (!info) return Promise.resolve(null);
    // documentTracker.DocumentInfo lacks width/height — fill with zeros as placeholder
    return Promise.resolve({ ...info, width: 0, height: 0 });
  },
  getSelection: () => Promise.resolve(getActiveSelectionInfo()),
  extractImage: (params) => extractImageFromPlugin(params),
  extractPreviewImage: () => Promise.resolve(null),
  applyResult: (params) => applyResultFromPlugin(params),
  placeResult: (params) => placeResultFromPlugin(params),
};

const events: EventBus = {
  onBridgeEvent: (eventType, handler) => onBridgeEvent(eventType, handler),
};

const capabilities: PlatformCapabilities = {
  supportsThemeToggle: false,
  hasNativeTitlebar: false,
  isPlugin: true,
  platform: 'plugin',
};

export function createPluginPlatform(): PlatformContext {
  return { ps, events, capabilities };
}
