import type { PlatformContext, PSOperations, EventBus, PlatformCapabilities } from '@ai-retouch/ui-core/platform';
import {
  extractImageFromPS,
  smartApplyToPS,
  applyResultToPS,
  getPSDocument,
  getPSSelection,
  fetchBridgeStatus,
} from '@ai-retouch/ui-core/api/bridge';
import { onBridgeEvent } from '../lib/wsClient';

let _isConnected = false;

const ps: PSOperations = {
  get isConnected() { return _isConnected; },
  getDocument: () => getPSDocument(),
  getSelection: () => getPSSelection(),
  extractImage: (params) => extractImageFromPS(params),
  extractPreviewImage: () => Promise.resolve(null),
  applyResult: (params) => smartApplyToPS(params).then((r) => ({ layerId: r.layerId, layerName: r.layerName })),
  placeResult: (params) => applyResultToPS(params),
};

const events: EventBus = {
  onBridgeEvent: (eventType, handler) => onBridgeEvent(eventType, handler),
};

const capabilities: PlatformCapabilities = {
  supportsThemeToggle: true,
  hasNativeTitlebar: true,
  isPlugin: false,
  platform: 'electron',
};

export function createElectronPlatform(): PlatformContext {
  fetchBridgeStatus()
    .then((s) => { _isConnected = s.uxpConnected; })
    .catch(() => {});

  onBridgeEvent('bridgeReady', () => { _isConnected = true; });
  onBridgeEvent('bridgeDisconnecting', () => { _isConnected = false; });

  return { ps, events, capabilities };
}
