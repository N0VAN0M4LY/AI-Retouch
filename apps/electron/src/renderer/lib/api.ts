import {
  DEFAULT_BACKEND_URL,
  HEALTH_ENDPOINT,
  type ApiResponse,
  BridgeStatus,
  HealthResponse,
  ChatSession,
  CreateSessionRequest,
  SessionWithMessages,
  PersistedLayerBinding,
  SendMessageRequest,
  SendMessageResponse,
  GenerationResult,
  ProviderWithDetails,
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderApiKey,
  CreateApiKeyInput,
  ProviderModel,
  CreateModelInput,
  UpdateModelInput,
  FetchedRemoteModel,
  ResultsListResponse,
  UpdateResultRequest,
  ComfyUIStatus,
  ExposedParam,
  WorkflowNodeInfo,
  RequestConfig,
  ExtractImageParams,
  PlaceResultParams,
  SmartApplyParams,
  SetSelectionParams,
  ImageContext,
  DocumentInfo,
  SelectionInfo,
  LayerInfo,
  GeminiImageSize,
} from '@ai-retouch/shared';

import { markConnected, markDisconnected } from './backendConnection';

// ─── Local Types ────────────────────────────────────────

export interface RemoteWorkflowEntry {
  path: string;
  name: string;
  modified: number;
  size: number;
}

export interface ParsedWorkflow {
  exposedParams: ExposedParam[];
  imageInputNodes: Array<{ nodeId: string; nodeType: string; title: string }>;
  outputNodes: Array<{ nodeId: string; nodeType: string; title: string }>;
  allNodes: WorkflowNodeInfo[];
  exposedNodeIds: string[];
  nodeOrder: string[];
}

export interface PromptResult {
  promptId: string;
  status: 'completed' | 'failed';
  outputs: Array<{
    nodeId: string;
    images: Array<{ filename: string; subfolder: string; type: string }>;
  }>;
}

export interface ComfyUISSECallbacks {
  onProgress?: (data: { promptId: string; node: string; value: number; max: number; percentage: number }) => void;
  onExecuting?: (data: { promptId: string; node: string }) => void;
  onExecuted?: (data: { promptId: string; node: string; output: unknown }) => void;
  onComplete?: (data: { promptId: string; images: Array<{ filename: string; subfolder: string; type: string }> }) => void;
  onError?: (data: { promptId: string; message: string }) => void;
  onQueue?: (data: { queueRemaining: number }) => void;
  onStatus?: (data: { wsConnected: boolean }) => void;
}

export interface CuiHistoryEntry {
  promptId: string;
  filename: string;
  subfolder: string;
  type: string;
  thumbnailUrl: string;
  timestamp: number;
}

export interface ComfyUITasksData {
  active: {
    promptId: string;
    status: string;
    currentNode?: string;
    progress?: { value: number; max: number };
  } | null;
  queued: Array<{ promptId: string; status: string }>;
  recent: Array<{ promptId: string; status: string; completedAt?: number }>;
}

export interface StreamCallbacks {
  onThinkingDelta: (text: string) => void;
  onTextDelta: (text: string) => void;
  onImageResult: (result: GenerationResult) => void;
  onDone: (response: SendMessageResponse) => void;
  onError: (error: string) => void;
}

export interface StreamHandle {
  promise: Promise<void>;
  abort: () => void;
}

// ─── Base URL ───────────────────────────────────────────

import { getBaseUrl, setBaseUrl } from '@ai-retouch/ui-core/api/baseUrl';
export { getBaseUrl, setBaseUrl };

// ─── Core Request ───────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    markDisconnected();
    throw err;
  }
  markConnected();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

// ─── SSE Parsing ────────────────────────────────────────

function parseSSEChunk(buffer: string): { events: Array<{ type: string; data: string }>; remaining: string } {
  const events: Array<{ type: string; data: string }> = [];
  const blocks = buffer.split('\n\n');
  const remaining = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) continue;
    let type = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    }
    if (data) events.push({ type, data });
  }

  return { events, remaining };
}

function dispatchSSEEvent(event: { type: string; data: string }, callbacks: StreamCallbacks) {
  try {
    const parsed = JSON.parse(event.data);
    switch (event.type) {
      case 'thinking_delta':
        callbacks.onThinkingDelta(parsed.text ?? '');
        break;
      case 'text_delta':
        callbacks.onTextDelta(parsed.text ?? '');
        break;
      case 'image_result':
        callbacks.onImageResult(parsed.result ?? parsed);
        break;
      case 'done':
        callbacks.onDone(parsed);
        break;
      case 'error':
        callbacks.onError(parsed.error ?? 'Unknown stream error');
        break;
    }
  } catch {
    callbacks.onError(`Failed to parse SSE event: ${event.data}`);
  }
}

function createSSEStream(url: string, body: unknown, callbacks: StreamCallbacks): StreamHandle {
  const controller = new AbortController();

  const promise = (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        markDisconnected();
        callbacks.onError(err instanceof Error ? err.message : 'Network error');
      }
      return;
    }
    markConnected();

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      callbacks.onError((errBody as any).error || `HTTP ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No readable stream');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEChunk(buffer);
        buffer = remaining;
        for (const event of events) {
          dispatchSSEEvent(event, callbacks);
        }
      }
      if (buffer.trim()) {
        const { events } = parseSSEChunk(buffer + '\n\n');
        for (const event of events) {
          dispatchSSEEvent(event, callbacks);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        callbacks.onError(err instanceof Error ? err.message : 'Stream read error');
      }
    } finally {
      reader.releaseLock();
    }
  })();

  return { promise, abort: () => controller.abort() };
}

// ─── Health ─────────────────────────────────────────────

export async function fetchBackendHealth(overrideUrl?: string): Promise<HealthResponse> {
  const url = overrideUrl ? overrideUrl.replace(/\/$/, '') : getBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${url}${HEALTH_ENDPOINT}`, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (!overrideUrl) markDisconnected();
    throw err;
  }
  if (!res.ok) {
    if (!overrideUrl) markDisconnected();
    throw new Error(`HTTP ${res.status}`);
  }
  if (!overrideUrl) markConnected();
  const json = await res.json();
  if (json.success !== undefined && !json.success) {
    throw new Error(json.error || 'Health check failed');
  }
  const data: HealthResponse = json.data ?? json;
  if (data.status !== 'ok') throw new Error(`Unexpected health status: ${data.status}`);
  return data;
}

// ─── Settings ───────────────────────────────────────────

export async function getSettings(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/settings');
}

export async function getSetting<V>(key: string): Promise<V> {
  return request<V>(`/api/settings/${encodeURIComponent(key)}`);
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await request<void>(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await request<void>(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}

// ─── Providers ──────────────────────────────────────────

export async function getProviders(): Promise<ProviderWithDetails[]> {
  return request<ProviderWithDetails[]>('/api/providers');
}

export async function getProvider(id: string): Promise<ProviderWithDetails> {
  return request<ProviderWithDetails>(`/api/providers/${encodeURIComponent(id)}`);
}

export async function createProvider(data: CreateProviderRequest): Promise<ProviderWithDetails> {
  return request<ProviderWithDetails>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProvider(id: string, data: UpdateProviderRequest): Promise<ProviderWithDetails> {
  return request<ProviderWithDetails>(`/api/providers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await request<void>(`/api/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── API Keys ───────────────────────────────────────────

export async function addApiKey(providerId: string, data: CreateApiKeyInput): Promise<ProviderApiKey> {
  return request<ProviderApiKey>(`/api/providers/${encodeURIComponent(providerId)}/api-keys`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteApiKey(providerId: string, keyId: string): Promise<void> {
  await request<void>(`/api/providers/${encodeURIComponent(providerId)}/api-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
  });
}

// ─── Fetch Remote Models ────────────────────────────────

export async function fetchRemoteModels(providerId: string): Promise<FetchedRemoteModel[]> {
  return request<FetchedRemoteModel[]>(`/api/providers/${encodeURIComponent(providerId)}/fetch-models`, {
    method: 'POST',
  });
}

export async function fetchRemoteModelsDirect(params: {
  baseUrl: string;
  apiProtocol: string;
  urlMode: string;
  useAuthorizationFormat: boolean;
  apiKey: string;
}): Promise<FetchedRemoteModel[]> {
  return request<FetchedRemoteModel[]>('/api/fetch-models-direct', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ─── Models ─────────────────────────────────────────────

export async function addModel(providerId: string, data: CreateModelInput): Promise<ProviderModel> {
  return request<ProviderModel>(`/api/providers/${encodeURIComponent(providerId)}/models`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateModel(providerId: string, modelId: string, data: UpdateModelInput): Promise<ProviderModel> {
  return request<ProviderModel>(
    `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    { method: 'PUT', body: JSON.stringify(data) },
  );
}

export async function deleteModel(providerId: string, modelId: string): Promise<void> {
  await request<void>(
    `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    { method: 'DELETE' },
  );
}

// ─── Documents ──────────────────────────────────────────

export async function openDocument(psdPath: string): Promise<{ workDir: string }> {
  return request<{ workDir: string }>('/api/documents/open', {
    method: 'POST',
    body: JSON.stringify({ psdPath }),
  });
}

export async function closeDocument(psdPath: string): Promise<void> {
  await request<void>('/api/documents/close', {
    method: 'POST',
    body: JSON.stringify({ psdPath }),
  });
}

export async function saveDocument(psdPath: string): Promise<void> {
  await request<void>('/api/documents/save', {
    method: 'POST',
    body: JSON.stringify({ psdPath }),
  });
}

// ─── Sessions ───────────────────────────────────────────

export async function getSessions(docPath?: string | null, mode?: string): Promise<ChatSession[]> {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (mode) params.set('mode', mode);
  const qs = params.toString();
  return request<ChatSession[]>(`/api/sessions${qs ? `?${qs}` : ''}`);
}

export async function createSession(data: CreateSessionRequest): Promise<ChatSession> {
  return request<ChatSession>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getSessionDetail(id: string, docPath: string): Promise<SessionWithMessages> {
  const params = new URLSearchParams({ docPath });
  return request<SessionWithMessages>(`/api/sessions/${encodeURIComponent(id)}?${params}`);
}

export async function deleteSession(id: string, docPath: string): Promise<void> {
  const params = new URLSearchParams({ docPath });
  await request<void>(`/api/sessions/${encodeURIComponent(id)}?${params}`, {
    method: 'DELETE',
  });
}

export async function updateSessionBinding(
  sessionId: string,
  docPath: string,
  layerBinding: PersistedLayerBinding | null,
): Promise<ChatSession> {
  const params = new URLSearchParams({ docPath });
  return request<ChatSession>(`/api/sessions/${encodeURIComponent(sessionId)}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify({ layerBinding }),
  });
}

export async function updateSessionActiveLeaf(
  sessionId: string,
  docPath: string,
  activeLeafId: string | null,
): Promise<ChatSession> {
  const params = new URLSearchParams({ docPath });
  return request<ChatSession>(`/api/sessions/${encodeURIComponent(sessionId)}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify({ activeLeafId }),
  });
}

export async function updateSessionModelRef(
  sessionId: string,
  docPath: string,
  modelRef: string | null,
): Promise<ChatSession> {
  const params = new URLSearchParams({ docPath });
  return request<ChatSession>(`/api/sessions/${encodeURIComponent(sessionId)}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify({ modelRef }),
  });
}

export async function updateSessionTitle(
  sessionId: string,
  docPath: string,
  title: string,
): Promise<ChatSession> {
  const params = new URLSearchParams({ docPath });
  return request<ChatSession>(`/api/sessions/${encodeURIComponent(sessionId)}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteMessage(
  sessionId: string,
  msgId: string,
  docPath: string,
): Promise<{ deletedIds: string[]; activeLeafId: string | null }> {
  const params = new URLSearchParams({ docPath });
  return request<{ deletedIds: string[]; activeLeafId: string | null }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(msgId)}?${params}`,
    { method: 'DELETE' },
  );
}

// ─── Chat Messages (SSE Streaming) ──────────────────────

export function sendMessageStream(
  sessionId: string,
  docPath: string,
  data: SendMessageRequest,
  callbacks: StreamCallbacks,
): StreamHandle {
  const params = new URLSearchParams({ stream: 'true', docPath });
  const url = `${getBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`;
  return createSSEStream(url, data, callbacks);
}

export function regenerateStream(
  sessionId: string,
  userMsgId: string,
  docPath: string,
  data: Partial<SendMessageRequest>,
  callbacks: StreamCallbacks,
): StreamHandle {
  const params = new URLSearchParams({ stream: 'true', docPath });
  const url = `${getBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(userMsgId)}/regenerate?${params}`;
  return createSSEStream(url, data, callbacks);
}

// ─── Context Preview ────────────────────────────────────

export function getContextPreviewUrl(messageId: string, docPath: string, sessionId: string): string {
  const params = new URLSearchParams({ docPath, sessionId });
  return `${getBaseUrl()}/api/messages/${encodeURIComponent(messageId)}/context-preview?${params}`;
}

export function getContextImageUrl(messageId: string, filename: string, docPath: string, sessionId: string): string {
  const params = new URLSearchParams({ docPath, sessionId });
  return `${getBaseUrl()}/api/messages/${encodeURIComponent(messageId)}/context-images/${encodeURIComponent(filename)}?${params}`;
}

// ─── Results ────────────────────────────────────────────

export function getResultPreviewUrl(resultId: string, docPath?: string, sessionId?: string): string {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (sessionId) params.set('sessionId', sessionId);
  const qs = params.toString();
  return `${getBaseUrl()}/api/results/${encodeURIComponent(resultId)}/preview${qs ? `?${qs}` : ''}`;
}

export function getResultFullUrl(resultId: string, docPath?: string, sessionId?: string): string {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (sessionId) params.set('sessionId', sessionId);
  const qs = params.toString();
  return `${getBaseUrl()}/api/results/${encodeURIComponent(resultId)}/full${qs ? `?${qs}` : ''}`;
}

export async function getResults(query?: {
  page?: number;
  limit?: number;
  source?: string;
  bookmarked?: boolean;
  docPath?: string;
  sessionId?: string;
}): Promise<ResultsListResponse> {
  const params = new URLSearchParams();
  if (query?.page != null) params.set('page', String(query.page));
  if (query?.limit != null) params.set('limit', String(query.limit));
  if (query?.source) params.set('source', query.source);
  if (query?.bookmarked != null) params.set('bookmarked', String(query.bookmarked));
  if (query?.docPath) params.set('docPath', query.docPath);
  if (query?.sessionId) params.set('sessionId', query.sessionId);
  const qs = params.toString();
  return request<ResultsListResponse>(`/api/results${qs ? `?${qs}` : ''}`);
}

export async function updateResult(
  id: string,
  data: UpdateResultRequest,
  docPath?: string,
  sessionId?: string,
): Promise<GenerationResult> {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (sessionId) params.set('sessionId', sessionId);
  const qs = params.toString();
  return request<GenerationResult>(`/api/results/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteResultById(id: string, docPath?: string, sessionId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (sessionId) params.set('sessionId', sessionId);
  const qs = params.toString();
  await request<void>(`/api/results/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, {
    method: 'DELETE',
  });
}

// ─── PS Bridge ──────────────────────────────────────────

export async function fetchBridgeStatus(): Promise<BridgeStatus> {
  return request<BridgeStatus>('/api/ps/status');
}

export async function extractImageFromPS(params: ExtractImageParams): Promise<ImageContext> {
  return request<ImageContext>('/api/ps/extract-image', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function applyResultToPS(params: PlaceResultParams): Promise<{ layerId?: number }> {
  return request<{ layerId?: number }>('/api/ps/place-result', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function smartApplyToPS(
  params: SmartApplyParams,
): Promise<{ layerId?: number; layerName?: string; resultId: string }> {
  return request<{ layerId?: number; layerName?: string; resultId: string }>('/api/ps/smart-apply', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getPSDocument(): Promise<DocumentInfo | null> {
  return request<DocumentInfo | null>('/api/ps/document');
}

export async function getPSSelection(): Promise<SelectionInfo | null> {
  return request<SelectionInfo | null>('/api/ps/selection');
}

export async function setPSSelection(params: SetSelectionParams): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/api/ps/selection', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getPSLayers(): Promise<LayerInfo[]> {
  return request<LayerInfo[]>('/api/ps/layers');
}

// ─── ComfyUI ────────────────────────────────────────────

export async function getComfyUIStatus(): Promise<ComfyUIStatus> {
  return request<ComfyUIStatus>('/api/comfyui/status');
}

export async function testComfyUIConnection(): Promise<ComfyUIStatus> {
  return request<ComfyUIStatus>('/api/comfyui/test', { method: 'POST' });
}

export async function getComfyUIObjectInfo(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/comfyui/object-info');
}

export async function uploadImageToComfyUI(
  imageData: string,
  filename?: string,
): Promise<{ name: string; subfolder: string; type: string }> {
  return request<{ name: string; subfolder: string; type: string }>('/api/comfyui/upload-image', {
    method: 'POST',
    body: JSON.stringify({ imageData, filename }),
  });
}

export function getComfyUIViewUrl(filename: string, subfolder?: string, type?: string): string {
  const params = new URLSearchParams();
  if (subfolder) params.set('subfolder', subfolder);
  if (type) params.set('type', type);
  const qs = params.toString();
  return `${getBaseUrl()}/api/comfyui/view/${encodeURIComponent(filename)}${qs ? `?${qs}` : ''}`;
}

export async function listRemoteWorkflows(): Promise<RemoteWorkflowEntry[]> {
  return request<RemoteWorkflowEntry[]>('/api/comfyui/remote-workflows');
}

export async function parseRemoteWorkflow(filePath: string): Promise<ParsedWorkflow> {
  return request<ParsedWorkflow>(
    `/api/comfyui/workflows/parse/${encodeURIComponent(filePath)}`,
  );
}

export async function analyzeWorkflowJson(json: Record<string, unknown>): Promise<ParsedWorkflow> {
  return request<ParsedWorkflow>('/api/comfyui/workflows/analyze', {
    method: 'POST',
    body: JSON.stringify({ workflowJson: json }),
  });
}

export async function getExposedNodeIds(workflowPath: string): Promise<string[]> {
  const data = await request<{ nodeIds: string[] }>(
    `/api/comfyui/workflows/exposed/${encodeURIComponent(workflowPath)}`,
  );
  return data.nodeIds;
}

export async function setExposedNodeIds(workflowPath: string, nodeIds: string[]): Promise<void> {
  await request(`/api/comfyui/workflows/exposed/${encodeURIComponent(workflowPath)}`, {
    method: 'PUT',
    body: JSON.stringify({ nodeIds }),
  });
}

export async function getNodeOrder(workflowPath: string): Promise<string[]> {
  const data = await request<{ order: string[] }>(
    `/api/comfyui/workflows/order/${encodeURIComponent(workflowPath)}`,
  );
  return data.order;
}

export async function setNodeOrder(workflowPath: string, order: string[]): Promise<void> {
  await request(`/api/comfyui/workflows/order/${encodeURIComponent(workflowPath)}`, {
    method: 'PUT',
    body: JSON.stringify({ order }),
  });
}

export async function sendImagesOnlyWorkflow(opts: {
  workflowPath: string;
  imageNodeMappings: Array<{ nodeId: string; uploadedFilename: string }>;
}): Promise<{ savedPath: string }> {
  return request<{ savedPath: string }>('/api/comfyui/workflows/send-only', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function executeWorkflow(opts: {
  workflowJson: Record<string, unknown>;
  paramOverrides?: Record<string, unknown>;
  inputImages?: Array<{ nodeId: string; imageData: string; filename?: string }>;
}): Promise<{ promptId: string }> {
  return request<{ promptId: string }>('/api/comfyui/workflows/execute', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function pollWorkflowResult(promptId: string, timeoutMs?: number): Promise<PromptResult> {
  const params = new URLSearchParams();
  if (timeoutMs != null) params.set('timeout', String(timeoutMs));
  const qs = params.toString();
  return request<PromptResult>(`/api/comfyui/workflows/result/${encodeURIComponent(promptId)}${qs ? `?${qs}` : ''}`);
}

/** @deprecated Dead code — SSE endpoint replaced by WebSocket. Only consumer was useComfyUISSE (removed). */
export function subscribeComfyUIEvents(callbacks: ComfyUISSECallbacks): { abort: () => void } {
  const es = new EventSource(`${getBaseUrl()}/api/comfyui/events`);

  es.addEventListener('progress', (e) => {
    try { callbacks.onProgress?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.addEventListener('executing', (e) => {
    try { callbacks.onExecuting?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.addEventListener('executed', (e) => {
    try { callbacks.onExecuted?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.addEventListener('complete', (e) => {
    try { callbacks.onComplete?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.addEventListener('error', (e) => {
    if (e instanceof MessageEvent && e.data) {
      try { callbacks.onError?.(JSON.parse(e.data)); } catch { /* ignore */ }
    }
  });
  es.addEventListener('queue', (e) => {
    try { callbacks.onQueue?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.addEventListener('status', (e) => {
    try { callbacks.onStatus?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });

  return { abort: () => es.close() };
}

export async function getComfyUIRecentHistory(maxItems?: number): Promise<CuiHistoryEntry[]> {
  const params = new URLSearchParams();
  if (maxItems != null) params.set('maxItems', String(maxItems));
  const qs = params.toString();
  return request<CuiHistoryEntry[]>(`/api/comfyui/history/recent${qs ? `?${qs}` : ''}`);
}

export async function saveComfyUIResultToLibrary(data: {
  docPath: string;
  filename: string;
  subfolder?: string;
  type?: string;
  workflowName?: string;
  workflowPath?: string;
  promptId?: string;
}): Promise<{ resultId: string; thumbnailBase64: string }> {
  return request<{ resultId: string; thumbnailBase64: string }>('/api/comfyui/results/save', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getComfyUITasks(): Promise<ComfyUITasksData> {
  return request<ComfyUITasksData>('/api/comfyui/tasks');
}

export async function cancelComfyUIExecution(promptId?: string): Promise<void> {
  await request<void>('/api/comfyui/cancel', {
    method: 'POST',
    body: JSON.stringify({ promptId }),
  });
}
