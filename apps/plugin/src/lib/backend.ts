import {
  DEFAULT_BACKEND_URL,
  HEALTH_ENDPOINT,
  type ApiResponse,
  type ChatSession,
  type ComfyUIStatus,
  type CreateApiKeyInput,
  type CreateModelInput,
  type CreateProviderRequest,
  type CreateSessionRequest,
  type ExposedParam,
  type WorkflowNodeInfo,
  type FetchedRemoteModel,
  type GenerationResult,
  type HealthResponse,
  type PersistedLayerBinding,
  type ProviderApiKey,
  type ProviderModel,
  type ProviderWithDetails,
  type ResultsListResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  type SessionWithMessages,
  type UpdateModelInput,
  type UpdateProviderRequest,
  type UpdateResultRequest,
} from '@ai-retouch/shared';
import { markDisconnected, markConnected } from './backendConnection';

let _baseUrl = DEFAULT_BACKEND_URL;

export function setBaseUrl(url: string): void {
  _baseUrl = url.trim().replace(/\/$/, '');
}

export function getBaseUrl(): string {
  return _baseUrl;
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${_baseUrl}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  } catch (err) {
    markDisconnected();
    throw err;
  }

  markConnected();

  const body = await res.json() as ApiResponse<T>;

  if (!res.ok || !body.success) {
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }

  return body.data as T;
}

// ─── Health ──────────────────────────────────────────────

export async function fetchBackendHealth(baseUrl?: string): Promise<HealthResponse> {
  const url = baseUrl?.trim().replace(/\/$/, '') ?? _baseUrl;
  const res = await fetch(`${url}${HEALTH_ENDPOINT}`);
  if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export async function fetchAppInfo(): Promise<{ execPath: string }> {
  return request<{ execPath: string }>('/api/app-info');
}

// ─── Settings ────────────────────────────────────────────

export async function getSettings(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/settings');
}

export async function getSetting<V = unknown>(key: string): Promise<V> {
  return request<V>(`/api/settings/${encodeURIComponent(key)}`);
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await request(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await request(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}

// ─── Providers ───────────────────────────────────────────

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
  await request(`/api/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── API Keys ────────────────────────────────────────────

export async function addApiKey(providerId: string, data: CreateApiKeyInput): Promise<ProviderApiKey> {
  return request<ProviderApiKey>(
    `/api/providers/${encodeURIComponent(providerId)}/api-keys`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function deleteApiKey(providerId: string, keyId: string): Promise<void> {
  await request(
    `/api/providers/${encodeURIComponent(providerId)}/api-keys/${encodeURIComponent(keyId)}`,
    { method: 'DELETE' },
  );
}

// ─── Fetch Remote Models ─────────────────────────────────

export async function fetchRemoteModels(providerId: string): Promise<FetchedRemoteModel[]> {
  return request<FetchedRemoteModel[]>(
    `/api/providers/${encodeURIComponent(providerId)}/fetch-models`,
    { method: 'POST' },
  );
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

// ─── Models ──────────────────────────────────────────────

export async function addModel(providerId: string, data: CreateModelInput): Promise<ProviderModel> {
  return request<ProviderModel>(
    `/api/providers/${encodeURIComponent(providerId)}/models`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function updateModel(providerId: string, modelId: string, data: UpdateModelInput): Promise<ProviderModel> {
  return request<ProviderModel>(
    `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    { method: 'PUT', body: JSON.stringify(data) },
  );
}

export async function deleteModel(providerId: string, modelId: string): Promise<void> {
  await request(
    `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    { method: 'DELETE' },
  );
}

// ─── Documents ────────────────────────────────────────

export async function openDocument(psdPath: string): Promise<{ workDir: string }> {
  return request<{ workDir: string }>('/api/documents/open', {
    method: 'POST',
    body: JSON.stringify({ psdPath }),
  });
}

export async function closeDocument(psdPath: string): Promise<void> {
  await request('/api/documents/close', {
    method: 'POST',
    body: JSON.stringify({ psdPath }),
  });
}

export async function saveDocument(psdPath: string): Promise<void> {
  await request('/api/documents/save', {
    method: 'POST',
    body: JSON.stringify({ psdPath }),
  });
}

// ─── Sessions ────────────────────────────────────────

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
  await request(`/api/sessions/${encodeURIComponent(id)}?${params}`, { method: 'DELETE' });
}

export async function updateSessionBinding(
  sessionId: string,
  docPath: string,
  layerBinding: PersistedLayerBinding | null,
): Promise<ChatSession> {
  const params = new URLSearchParams({ docPath });
  return request<ChatSession>(
    `/api/sessions/${encodeURIComponent(sessionId)}?${params}`,
    { method: 'PATCH', body: JSON.stringify({ layerBinding }) },
  );
}

export async function updateSessionActiveLeaf(
  sessionId: string,
  docPath: string,
  activeLeafId: string | null,
): Promise<ChatSession> {
  const params = new URLSearchParams({ docPath });
  return request<ChatSession>(
    `/api/sessions/${encodeURIComponent(sessionId)}?${params}`,
    { method: 'PATCH', body: JSON.stringify({ activeLeafId }) },
  );
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

// ─── Chat Messages (streaming via SSE) ──────────────

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

/**
 * Send a message and receive the response as an SSE stream via XHR.
 *
 * Returns a handle with the promise and an abort function.
 * Calling abort() cancels the XHR; the promise resolves silently
 * (no error thrown) so callers can distinguish abort from failure.
 */
export function sendMessageStream(
  sessionId: string,
  docPath: string,
  data: SendMessageRequest,
  callbacks: StreamCallbacks,
): StreamHandle {
  const params = new URLSearchParams({ stream: 'true', docPath });
  const url = `${_baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`;
  const xhr = new XMLHttpRequest();
  let lastParsedIndex = 0;
  let sseBuffer = '';
  let aborted = false;

  const promise = new Promise<void>((resolve, reject) => {
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        const fullText = xhr.responseText;
        const newText = fullText.slice(lastParsedIndex);
        lastParsedIndex = fullText.length;

        if (newText) {
          sseBuffer += newText;
          const events = sseBuffer.split('\n\n');
          sseBuffer = events.pop() ?? '';

          for (const eventRaw of events) {
            if (!eventRaw.trim()) continue;
            dispatchSSEEvent(eventRaw, callbacks);
          }
        }
      }

      if (xhr.readyState === 4) {
        if (aborted) {
          resolve();
          return;
        }

        console.log(`[SSE] readyState=4 status=${xhr.status} totalLen=${xhr.responseText?.length} bufferLen=${sseBuffer.length}`);
        if (sseBuffer.trim()) {
          console.log('[SSE] flushing remaining buffer:', sseBuffer.slice(0, 120));
          dispatchSSEEvent(sseBuffer, callbacks);
          sseBuffer = '';
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Request failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => {
      if (aborted) {
        resolve();
        return;
      }
      reject(new Error('Network error during streaming request'));
    };

    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(data));
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      xhr.abort();
    },
  };
}

function dispatchSSEEvent(raw: string, callbacks: StreamCallbacks): void {
  let eventType = '';
  let eventData = '';

  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      eventData += (eventData ? '\n' : '') + line.slice(6);
    } else if (line.startsWith('data:')) {
      eventData += (eventData ? '\n' : '') + line.slice(5).trimStart();
    }
  }

  if (!eventData) return;

  console.log(`[SSE] dispatch event="${eventType}" dataLen=${eventData.length}`);

  try {
    const parsed = JSON.parse(eventData);
    switch (eventType) {
      case 'thinking_delta':
        callbacks.onThinkingDelta(parsed.text);
        break;
      case 'text_delta':
        callbacks.onTextDelta(parsed.text);
        break;
      case 'image_result':
        callbacks.onImageResult(parsed.result);
        break;
      case 'done':
        console.log('[SSE] done payload: results=', parsed.results?.length,
          'assistantContent=', JSON.stringify(parsed.assistantMessage?.content)?.slice(0, 80),
          'firstThumbLen=', parsed.results?.[0]?.thumbnailData?.length);
        callbacks.onDone(parsed);
        break;
      case 'error':
        callbacks.onError(parsed.error ?? 'Unknown stream error');
        break;
    }
  } catch {
    console.warn('[backend] Failed to parse SSE event:', raw.slice(0, 200));
  }
}

/**
 * Regenerate: create a new assistant response for an existing user message.
 * Streams via SSE, reusing the same XHR approach as sendMessageStream.
 */
export function regenerateStream(
  sessionId: string,
  userMsgId: string,
  docPath: string,
  data: { modelRef?: string; imageSize?: string },
  callbacks: StreamCallbacks,
): StreamHandle {
  const params = new URLSearchParams({ stream: 'true', docPath });
  const url = `${_baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(userMsgId)}/regenerate?${params}`;
  const xhr = new XMLHttpRequest();
  let lastParsedIndex = 0;
  let sseBuffer = '';
  let aborted = false;

  const promise = new Promise<void>((resolve, reject) => {
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        const fullText = xhr.responseText;
        const newText = fullText.slice(lastParsedIndex);
        lastParsedIndex = fullText.length;

        if (newText) {
          sseBuffer += newText;
          const events = sseBuffer.split('\n\n');
          sseBuffer = events.pop() ?? '';

          for (const eventRaw of events) {
            if (!eventRaw.trim()) continue;
            dispatchSSEEvent(eventRaw, callbacks);
          }
        }
      }

      if (xhr.readyState === 4) {
        if (aborted) { resolve(); return; }
        if (sseBuffer.trim()) {
          dispatchSSEEvent(sseBuffer, callbacks);
          sseBuffer = '';
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Regenerate request failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => {
      if (aborted) { resolve(); return; }
      reject(new Error('Network error during regeneration'));
    };

    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(data));
  });

  return {
    promise,
    abort: () => { aborted = true; xhr.abort(); },
  };
}

// ─── Context Preview ─────────────────────────────────

export function getContextPreviewUrl(messageId: string, docPath: string, sessionId: string): string {
  const params = new URLSearchParams({ docPath, sessionId });
  return `${_baseUrl}/api/messages/${encodeURIComponent(messageId)}/context-preview?${params}`;
}

// ─── Results ─────────────────────────────────────────

export function getResultPreviewUrl(resultId: string, docPath?: string, sessionId?: string): string {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (sessionId) params.set('sessionId', sessionId);
  const qs = params.toString();
  return `${_baseUrl}/api/results/${encodeURIComponent(resultId)}/preview${qs ? `?${qs}` : ''}`;
}

export function getResultFullUrl(resultId: string, docPath?: string, sessionId?: string): string {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (sessionId) params.set('sessionId', sessionId);
  const qs = params.toString();
  return `${_baseUrl}/api/results/${encodeURIComponent(resultId)}/full${qs ? `?${qs}` : ''}`;
}

export async function getResults(query?: {
  page?: number;
  limit?: number;
  source?: string;
  bookmarked?: boolean;
  docPath?: string | null;
  sessionId?: string | null;
}): Promise<ResultsListResponse> {
  const params = new URLSearchParams();
  if (query?.page) params.set('page', String(query.page));
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.source) params.set('source', query.source);
  if (query?.bookmarked) params.set('bookmarked', 'true');
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
  return request<GenerationResult>(
    `/api/results/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ ...data, docPath, sessionId }) },
  );
}

export async function deleteResultById(id: string, docPath?: string, sessionId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (docPath) params.set('docPath', docPath);
  if (sessionId) params.set('sessionId', sessionId);
  const qs = params.toString();
  await request(`/api/results/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { method: 'DELETE' });
}

// ─── ComfyUI ──────────────────────────────────────────

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
  return request<{ name: string; subfolder: string; type: string }>(
    '/api/comfyui/upload-image',
    { method: 'POST', body: JSON.stringify({ imageData, filename }) },
  );
}

export function getComfyUIViewUrl(filename: string, subfolder = '', type = 'output'): string {
  const params = new URLSearchParams({ subfolder, type });
  return `${_baseUrl}/api/comfyui/view/${encodeURIComponent(filename)}?${params}`;
}

// ─── ComfyUI Remote Workflows (live from ComfyUI) ────

export interface RemoteWorkflowEntry {
  path: string;
  name: string;
  modified: number;
  size: number;
}

export async function listRemoteWorkflows(): Promise<RemoteWorkflowEntry[]> {
  return request<RemoteWorkflowEntry[]>('/api/comfyui/remote-workflows');
}

export interface ParsedWorkflow {
  exposedParams: ExposedParam[];
  imageInputNodes: Array<{ nodeId: string; nodeType: string; title: string }>;
  outputNodes: Array<{ nodeId: string; nodeType: string; title: string }>;
  allNodes: WorkflowNodeInfo[];
  exposedNodeIds: string[];
  nodeOrder: string[];
}

export async function parseRemoteWorkflow(filePath: string): Promise<ParsedWorkflow> {
  return request<ParsedWorkflow>(
    `/api/comfyui/workflows/parse/${encodeURIComponent(filePath)}`,
  );
}

export async function analyzeWorkflowJson(
  workflowJson: Record<string, unknown>,
): Promise<ParsedWorkflow> {
  return request<ParsedWorkflow>('/api/comfyui/workflows/analyze', {
    method: 'POST',
    body: JSON.stringify({ workflowJson }),
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
  workflowPath?: string;
  workflowJson?: Record<string, unknown>;
  paramOverrides?: Record<string, unknown>;
  inputImages?: Array<{ nodeId: string; imageData: string; filename?: string }>;
}): Promise<{ promptId: string }> {
  return request<{ promptId: string }>('/api/comfyui/workflows/execute', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export interface PromptResult {
  promptId: string;
  status: 'completed' | 'failed';
  outputs: Array<{
    nodeId: string;
    images: Array<{ filename: string; subfolder: string; type: string }>;
  }>;
}

export async function pollWorkflowResult(
  promptId: string,
  timeoutMs?: number,
): Promise<PromptResult> {
  const params = new URLSearchParams();
  if (timeoutMs != null) params.set('timeout', String(timeoutMs));
  const qs = params.toString();

  const url = `${_baseUrl}/api/comfyui/workflows/result/${encodeURIComponent(promptId)}${qs ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout((timeoutMs ?? 120000) + 10000),
    });
  } catch (err) {
    markDisconnected();
    throw err;
  }

  markConnected();

  const body = (await res.json()) as { success: boolean; data?: PromptResult; error?: string };
  if (!res.ok || !body.success) {
    throw new Error(body.error ?? `Poll failed with status ${res.status}`);
  }

  return body.data as PromptResult;
}

// ComfyUI SSE removed — events now delivered via WebSocket bridge

// ─── ComfyUI History ─────────────────────────────────

export interface CuiHistoryEntry {
  promptId: string;
  filename: string;
  subfolder: string;
  type: string;
  thumbnailUrl: string;
  timestamp: number;
}

export async function getComfyUIRecentHistory(maxItems?: number): Promise<CuiHistoryEntry[]> {
  const params = new URLSearchParams();
  if (maxItems != null) params.set('maxItems', String(maxItems));
  const qs = params.toString();
  return request<CuiHistoryEntry[]>(`/api/comfyui/history/recent${qs ? `?${qs}` : ''}`);
}

// ─── ComfyUI Save Result to Library ──────────────────

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

// ─── ComfyUI Tasks & Cancel ──────────────────────────

export interface ComfyUITasksData {
  active: { promptId: string; status: string; currentNode?: string; progress?: { value: number; max: number } } | null;
  queued: Array<{ promptId: string; status: string }>;
  recent: Array<{ promptId: string; status: string; completedAt?: number }>;
}

export async function getComfyUITasks(): Promise<ComfyUITasksData> {
  return request<ComfyUITasksData>('/api/comfyui/tasks');
}

export async function cancelComfyUIExecution(promptId?: string): Promise<void> {
  await request('/api/comfyui/cancel', {
    method: 'POST',
    body: JSON.stringify({ promptId }),
  });
}
