// ============ Backend Defaults ============

export const DEFAULT_BACKEND_PORT = 5341;
export const DEFAULT_BACKEND_HOST = '127.0.0.1';
export const DEFAULT_BACKEND_URL = `http://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`;

// ============ Health ============

export const HEALTH_ENDPOINT = '/api/health' as const;

export interface HealthResponse {
  status: 'ok';
  service: 'ai-retouch-local-server';
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
}

export type BackendConnectionState = 'idle' | 'checking' | 'success' | 'error';

// ============ Provider & Model ============

export type ModelCapability = 'image_generation' | 'image_generation_tool' | 'vision' | 'function_calling';
export type FcMode = 'native' | 'xml_prompt' | 'json_prompt' | 'none';
export type UrlMode = 'auto' | 'full';
export type ApiProtocol = 'openai' | 'openai_responses' | 'gemini';

export const DEFAULT_BASE_URLS: Record<ApiProtocol, string> = {
  openai: 'https://api.openai.com',
  openai_responses: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};
export type KeyStrategy = 'round_robin' | 'fallback';
export type ImageHistoryStrategy = 'attach_to_user' | 'embed_in_assistant' | 'native_server_state';
export type ModelSource = 'fetched' | 'manual';

// ─── Advanced Settings Types ────────────────────────────

export interface AdvancedParamToggle<V = number> {
  enabled: boolean;
  value: V;
}

export type GeminiImageSize = '1K' | '2K' | '4K';

export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
export type OaiReasoningEffort = 'low' | 'medium' | 'high';
export type OaiReasoningSummary = 'auto' | 'concise' | 'detailed';

export interface ThinkingConfig {
  thinkingLevel: AdvancedParamToggle<GeminiThinkingLevel>;
  thinkingBudget: AdvancedParamToggle<number>;
  includeThoughts: AdvancedParamToggle<boolean>;
  reasoningEffort: AdvancedParamToggle<OaiReasoningEffort>;
  reasoningSummary: AdvancedParamToggle<OaiReasoningSummary>;
}

export interface AdvancedSettings {
  temperature: AdvancedParamToggle<number>;
  maxOutputTokens: AdvancedParamToggle<number>;
  topP: AdvancedParamToggle<number>;
  topK: AdvancedParamToggle<number>;
  thinking: ThinkingConfig;
  imageSize: AdvancedParamToggle<GeminiImageSize>;
}

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  temperature: { enabled: false, value: 1.0 },
  maxOutputTokens: { enabled: false, value: 4096 },
  topP: { enabled: false, value: 0.95 },
  topK: { enabled: false, value: 40 },
  thinking: {
    thinkingLevel: { enabled: false, value: 'high' },
    thinkingBudget: { enabled: false, value: -1 },
    includeThoughts: { enabled: true, value: true },
    reasoningEffort: { enabled: false, value: 'medium' },
    reasoningSummary: { enabled: true, value: 'auto' },
  },
  imageSize: { enabled: false, value: '1K' },
};

// ─── Provider ───────────────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  urlMode: UrlMode;
  apiProtocol: ApiProtocol;
  keyStrategy: KeyStrategy;
  streamEnabled: boolean;
  maxContextTokens: number;
  useAuthorizationFormat: boolean;
  imageHistoryStrategy: ImageHistoryStrategy;
  advancedSettings: AdvancedSettings;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderApiKey {
  id: string;
  providerId: string;
  apiKey: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ProviderModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  source: ModelSource;
  capabilities: ModelCapability[];
  fcMode: FcMode;
  enabled: boolean;
  sortOrder: number;
}

export interface ProviderWithDetails extends Provider {
  apiKeys: ProviderApiKey[];
  models: ProviderModel[];
}

// ============ API Request / Response ============

export interface CreateProviderRequest {
  name: string;
  baseUrl: string;
  urlMode?: UrlMode;
  apiProtocol: ApiProtocol;
  keyStrategy?: KeyStrategy;
  streamEnabled?: boolean;
  maxContextTokens?: number;
  useAuthorizationFormat?: boolean;
  imageHistoryStrategy?: ImageHistoryStrategy;
  advancedSettings?: AdvancedSettings;
  apiKeys?: string[];
  models?: CreateModelInput[];
}

export interface UpdateProviderRequest {
  name?: string;
  baseUrl?: string;
  urlMode?: UrlMode;
  apiProtocol?: ApiProtocol;
  keyStrategy?: KeyStrategy;
  streamEnabled?: boolean;
  maxContextTokens?: number;
  useAuthorizationFormat?: boolean;
  imageHistoryStrategy?: ImageHistoryStrategy;
  advancedSettings?: AdvancedSettings;
  sortOrder?: number;
}

export interface FetchedRemoteModel {
  id: string;
  name?: string;
  owned_by?: string;
}

export interface CreateModelInput {
  modelId: string;
  displayName: string;
  source?: ModelSource;
  capabilities?: ModelCapability[];
  fcMode?: FcMode;
  enabled?: boolean;
  sortOrder?: number;
}

export interface UpdateModelInput {
  displayName?: string;
  capabilities?: ModelCapability[];
  fcMode?: FcMode;
  enabled?: boolean;
  sortOrder?: number;
}

export interface CreateApiKeyInput {
  apiKey: string;
  sortOrder?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============ Chat & Session ============

export type ChatMode = 'direct' | 'agent';

export interface PersistedLayerBinding {
  layerName: string;
  lastResultId: string;
  lastLayerId?: number;
}

export interface ChatSession {
  id: string;
  mode: ChatMode;
  title: string;
  modelRef: string | null;
  documentPath: string | null;
  layerBinding: PersistedLayerBinding | null;
  activeLeafId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MessageMetadata {
  sentImages?: {
    count: number;
    sourceMode: SourceMode;
  };
  /** Prompt prefix generated from image descriptions (for history reconstruction) */
  promptPrefix?: string;
  /** Marks this assistant message as an error (failed generation) */
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  parentId: string | null;
  childIds: string[];
  role: 'user' | 'assistant';
  content: string;
  thinking: string;
  timestamp: number;
  metadata?: MessageMetadata;
  requestConfig?: RequestConfig;
  contextImageFiles?: string[];
}

// ============ Generation Results ============

export type ResultSourceType = 'direct' | 'agent' | 'comfyui';

export interface GenerationResult {
  id: string;
  messageId: string | null;
  sessionId?: string | null;
  thumbnailData: string;
  previewPath: string | null;
  fullPath: string;
  mimeType: string;
  sourceType: ResultSourceType;
  sourceDetail: string | null;
  textResponse: string | null;
  modelRef: string | null;
  elapsedMs: number | null;
  width: number | null;
  height: number | null;
  appliedToCanvas: boolean;
  bookmarked: boolean;
  createdAt: number;
  /** The request config from the user message that produced this result (for accurate placement). */
  requestConfig?: RequestConfig;
}

// ============ Image Extraction ============

export type SourceMode = 'activeLayer' | 'visibleMerged';

export interface SendPolicy {
  sendFullImage: boolean;
  sendRegionImage: boolean;
  sendHighlightImage: boolean;
  sendMask: boolean;
}

export const DEFAULT_SEND_POLICY_NO_SELECTION: SendPolicy = {
  sendFullImage: true,
  sendRegionImage: false,
  sendHighlightImage: false,
  sendMask: false,
};

export const DEFAULT_SEND_POLICY_WITH_SELECTION: SendPolicy = {
  sendFullImage: false,
  sendRegionImage: true,
  sendHighlightImage: false,
  sendMask: false,
};

export interface SelectionInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtraImage {
  data: string;
  mimeType: string;
  name?: string;
}

export interface ImageContext {
  fullImage?: string;
  regionImage?: string;
  mask?: string;
  selection?: SelectionInfo;
  canvasSize: { width: number; height: number };
  sourceMode: SourceMode;
  mimeType?: string;
  rawFloat32?: {
    width: number;
    height: number;
    channels: number;
  };
  extraImages?: ExtraImage[];
}

// ============ Chat API Request / Response ============

export interface CreateSessionRequest {
  mode: ChatMode;
  title?: string;
  modelRef?: string;
  documentPath?: string;
}

export interface UpdateSessionRequest {
  title?: string;
  layerBinding?: PersistedLayerBinding | null;
}

export interface RequestConfig {
  sourceMode?: SourceMode;
  sendPolicy?: SendPolicy;
  modelRef?: string;
  selectionBounds?: SelectionInfo;
  canvasSize?: { width: number; height: number };
}

export interface SendMessageRequest {
  content: string;
  modelRef: string;
  /** Explicit parent message ID for branching. null = root (sibling of first msg). Omitted = append to active path end. */
  parentId?: string | null;
  imageContext?: ImageContext;
  userMetadata?: MessageMetadata;
  requestConfig?: RequestConfig;
  imageSize?: GeminiImageSize;
  /** Base64-encoded preview thumbnail to persist for session reload */
  previewImageData?: string;
  /** If true, reuse the context images from the specified sourceUserMsgId instead of extracting new ones. */
  reuseContextFrom?: string;
}

export interface SendMessageResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  results: GenerationResult[];
}

export interface SessionWithMessages extends ChatSession {
  messages: ChatMessage[];
  results: GenerationResult[];
}

// ============ Results API ============

export interface ResultsListQuery {
  page?: number;
  limit?: number;
  source?: ResultSourceType | 'all';
  bookmarked?: boolean;
}

export interface ResultsListResponse {
  items: GenerationResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UpdateResultRequest {
  appliedToCanvas?: boolean;
  bookmarked?: boolean;
}

// ============ Streaming Events (Backend → Frontend SSE) ============

export interface StreamThinkingDelta {
  type: 'thinking_delta';
  text: string;
}

export interface StreamTextDelta {
  type: 'text_delta';
  text: string;
}

export interface StreamImageResult {
  type: 'image_result';
  result: GenerationResult;
}

export interface StreamDone {
  type: 'done';
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  results: GenerationResult[];
}

export interface StreamError {
  type: 'error';
  error: string;
}

export type StreamEvent =
  | StreamThinkingDelta
  | StreamTextDelta
  | StreamImageResult
  | StreamDone
  | StreamError;

// ============ ComfyUI ============

export type ComfyUIConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ComfyUISystemStats {
  system: { os: string; ram_total: number; ram_free: number };
  devices: Array<{
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
  }>;
}

export interface ComfyUIStatus {
  state: ComfyUIConnectionState;
  address: string;
  wsConnected?: boolean;
  systemStats?: ComfyUISystemStats;
  error?: string;
}

export interface ComfyUIWorkflow {
  id: string;
  name: string;
  category: string;
  source: 'imported' | 'synced';
  workflowJson: Record<string, unknown>;
  exposedParams: ExposedParam[];
  lastUsedParams?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ExposedParam {
  nodeId: string;
  nodeTitle: string;
  nodeType: string;
  paramName: string;
  displayName: string;
  type: 'int' | 'float' | 'string' | 'enum' | 'boolean' | 'image';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  source: 'auto' | 'config';
}

export interface WorkflowNodeInfo {
  nodeId: string;
  nodeType: string;
  title: string;
  rawTitle: string;
  hasExposedTag: boolean;
  isImageInput: boolean;
  isOutput: boolean;
  params: ExposedParam[];
}

export interface ComfyUIQueuePromptRequest {
  workflowId: string;
  paramOverrides?: Record<string, unknown>;
  inputImages?: Array<{
    nodeId: string;
    imageData: string;
    filename?: string;
  }>;
}

export interface ComfyUITaskProgress {
  promptId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentNode?: string;
  currentNodeTitle?: string;
  progress?: { value: number; max: number };
  elapsedMs?: number;
}

export interface ComfyUITaskResult {
  promptId: string;
  images: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
}

export type ComfyUITaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ComfyUITaskState {
  promptId: string;
  status: ComfyUITaskStatus;
  currentNode?: string;
  progress?: { value: number; max: number };
  startedAt?: number;
  completedAt?: number;
  outputs?: Array<{ filename: string; subfolder: string; type: string }>;
  error?: string;
}

export type ComfyUISSEEvent =
  | { type: 'progress'; promptId: string; node: string; value: number; max: number; percentage: number }
  | { type: 'executing'; promptId: string; node: string }
  | { type: 'executed'; promptId: string; node: string; output: unknown }
  | { type: 'complete'; promptId: string; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { type: 'error'; promptId: string; message: string }
  | { type: 'queue'; queueRemaining: number }
  | { type: 'status'; wsConnected: boolean };

// ============ PS Bridge Protocol ============

// --- Message Envelopes ---

export interface BridgeCommand {
  id: string;
  command: BridgeCommandType;
  params: Record<string, unknown>;
  timeout?: number;
}

export interface BridgeCommandResult {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface BridgeEvent {
  event: BridgeEventType;
  data: Record<string, unknown>;
  timestamp: number;
}

export type BridgeWSMessage =
  | { type: 'command'; payload: BridgeCommand }
  | { type: 'commandResult'; payload: BridgeCommandResult }
  | { type: 'event'; payload: BridgeEvent }
  | { type: 'ping' }
  | { type: 'pong' };

// --- Command Types ---

export type BridgeCommandType =
  | 'extractImage'
  | 'placeResult'
  | 'smartApply'
  | 'getDocumentInfo'
  | 'getSelection'
  | 'setSelection'
  | 'getLayerList'
  | 'ping';

export interface ExtractImageParams {
  sourceMode: SourceMode;
  sendPolicy: SendPolicy;
  overrideSelection?: SelectionInfo;
  saveSelectionAlphaChannel?: boolean;
  maxResolution?: number;
  preserveBitDepth?: boolean;
  rawFloat32?: boolean;
}

export interface PlaceResultParams {
  resultId: string;
  imageWidth: number;
  imageHeight: number;
  targetBounds?: { x: number; y: number; width: number; height: number };
  needsMask?: boolean;
  restoreSelection?: SelectionInfo;
  layerName?: string;
  docPath?: string;
  sessionId?: string;
}

export interface SmartApplyParams {
  resultId: string;
  width: number;
  height: number;
  sessionId?: string;
  documentPath?: string;
  requestConfig?: RequestConfig;
  fallbackSendPolicy?: SendPolicy;
}

export interface SetSelectionParams {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Command Param Map (for type-safe dispatch) ---

export interface BridgeCommandParamMap {
  extractImage: ExtractImageParams;
  placeResult: PlaceResultParams;
  smartApply: SmartApplyParams;
  getDocumentInfo: Record<string, never>;
  getSelection: Record<string, never>;
  setSelection: SetSelectionParams;
  getLayerList: Record<string, never>;
  ping: Record<string, never>;
}

// --- Command Result Map ---

export interface DocumentInfo {
  id: number;
  path: string;
  title: string;
  width: number;
  height: number;
}

export interface LayerInfo {
  id: number;
  name: string;
  kind: string;
  visible: boolean;
  opacity: number;
  children?: LayerInfo[];
}

export interface BridgeCommandResultMap {
  extractImage: ImageContext;
  placeResult: { layerId?: number };
  smartApply: { layerId?: number; layerName?: string; resultId: string };
  getDocumentInfo: DocumentInfo | null;
  getSelection: SelectionInfo | null;
  setSelection: { success: boolean };
  getLayerList: LayerInfo[];
  ping: { alive: boolean };
}

// --- Event Types ---

export type BridgeEventType =
  | 'documentChanged'
  | 'selectionChanged'
  | 'dataChanged'
  | 'bridgeReady'
  | 'bridgeDisconnecting'
  | 'comfyui:status'
  | 'comfyui:queue'
  | 'comfyui:progress'
  | 'comfyui:executing'
  | 'comfyui:executed'
  | 'comfyui:complete'
  | 'comfyui:error';

export interface DocumentChangedData {
  document: { id: number; path: string; title: string } | null;
}

export interface SelectionChangedData {
  selection: SelectionInfo | null;
}

export interface ComfyUIImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export type DataChangedScope = 'sessions' | 'results' | 'all';

export interface DataChangedData {
  scope: DataChangedScope;
  documentPath?: string;
}

export interface BridgeEventDataMap {
  documentChanged: DocumentChangedData;
  selectionChanged: SelectionChangedData;
  dataChanged: DataChangedData;
  bridgeReady: Record<string, never>;
  bridgeDisconnecting: { reason?: string };
  'comfyui:status': { wsConnected: boolean };
  'comfyui:queue': { queueRemaining: number };
  'comfyui:progress': { promptId: string; node: string; value: number; max: number; percentage: number };
  'comfyui:executing': { promptId: string; node: string };
  'comfyui:executed': { promptId: string; node: string; output: unknown };
  'comfyui:complete': { promptId: string; images: ComfyUIImageRef[] };
  'comfyui:error': { promptId: string; message: string };
}

// --- Bridge Status ---

export type BridgeConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface BridgeStatus {
  uxpConnected: boolean;
  clientCount: number;
  lastHeartbeat: number | null;
}

// ============ Tree Utilities ============

interface TreeNode {
  id: string;
  parentId: string | null;
  childIds: string[];
}

/**
 * From a given node, follow the last child at each level to reach a leaf.
 * Returns the leaf node's ID (or startId itself if it's already a leaf).
 */
export function findDefaultLeaf<T extends TreeNode>(
  messages: T[],
  startId: string,
): string {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let current = byId.get(startId);
  if (!current) return startId;
  while (current.childIds.length > 0) {
    const lastChild = byId.get(current.childIds[current.childIds.length - 1]);
    if (!lastChild) break;
    current = lastChild;
  }
  return current.id;
}

/**
 * Compute the active path (root → leaf) through a message tree.
 * If leafId is null or not found, follows the last child at each level.
 */
export function computeActivePath<T extends TreeNode>(
  messages: T[],
  leafId: string | null,
): T[] {
  if (messages.length === 0) return [];

  const byId = new Map(messages.map((m) => [m.id, m]));

  let leaf: T | undefined;
  if (leafId) leaf = byId.get(leafId);

  if (!leaf) {
    const roots = messages.filter((m) => m.parentId === null);
    if (roots.length === 0) return [];
    let current = roots[roots.length - 1];
    while (current.childIds && current.childIds.length > 0) {
      const lastChildId = current.childIds[current.childIds.length - 1];
      const child = byId.get(lastChildId);
      if (!child) break;
      current = child;
    }
    leaf = current;
  }

  const path: T[] = [];
  let current: T | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path;
}
