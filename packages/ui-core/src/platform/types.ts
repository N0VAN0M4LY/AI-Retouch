import type {
  ExtractImageParams,
  ImageContext,
  SmartApplyParams,
  PlaceResultParams,
  DocumentInfo,
  SelectionInfo,
} from '@ai-retouch/shared';

export interface PSOperations {
  /** Non-reactive snapshot — use usePSConnected() for reactive subscription. */
  readonly isConnected: boolean;
  getDocument(): Promise<DocumentInfo | null>;
  getSelection(): Promise<SelectionInfo | null>;
  extractImage(params: ExtractImageParams): Promise<ImageContext>;
  extractPreviewImage(): Promise<string | null>;
  applyResult(params: SmartApplyParams): Promise<{ layerId?: number; layerName?: string }>;
  placeResult(params: PlaceResultParams): Promise<{ layerId?: number }>;
}

export interface EventBus {
  onBridgeEvent(eventType: string, handler: (event: any) => void): () => void;
}

export interface PlatformCapabilities {
  supportsThemeToggle: boolean;
  hasNativeTitlebar: boolean;
  isPlugin: boolean;
  platform: 'electron' | 'plugin';
}

export interface PlatformContext {
  ps: PSOperations;
  events: EventBus;
  capabilities: PlatformCapabilities;
}
