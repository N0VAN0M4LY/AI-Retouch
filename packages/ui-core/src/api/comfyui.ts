import { type ComfyUIStatus } from '@ai-retouch/shared';
import { markConnected, markDisconnected } from '../hooks/useBackendConnection';
import { getBaseUrl } from './baseUrl';
import { request } from './client';
import {
  type ComfyUISSECallbacks,
  type ComfyUITasksData,
  type CuiHistoryEntry,
  type ParsedWorkflow,
  type PromptResult,
  type RemoteWorkflowEntry,
} from './types';

// ─── ComfyUI Status ──────────────────────────────────────

export async function getComfyUIStatus(): Promise<ComfyUIStatus> {
  return request<ComfyUIStatus>('/api/comfyui/status');
}

export async function testComfyUIConnection(): Promise<ComfyUIStatus> {
  return request<ComfyUIStatus>('/api/comfyui/test', { method: 'POST' });
}

export async function getComfyUIObjectInfo(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/comfyui/object-info');
}

// ─── ComfyUI Image Upload / View ─────────────────────────

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

// ─── ComfyUI Remote Workflows ────────────────────────────

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

export async function pollWorkflowResult(promptId: string, timeoutMs?: number): Promise<PromptResult> {
  const params = new URLSearchParams();
  if (timeoutMs != null) params.set('timeout', String(timeoutMs));
  const qs = params.toString();
  const url = `${getBaseUrl()}/api/comfyui/workflows/result/${encodeURIComponent(promptId)}${qs ? `?${qs}` : ''}`;

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

// ─── ComfyUI SSE Events (deprecated) ────────────────────

/** @deprecated Dead code — SSE endpoint replaced by WebSocket. Only consumer was useComfyUISSE (removed). */
export function subscribeComfyUIEvents(callbacks: ComfyUISSECallbacks): { abort: () => void } {
  const es = new EventSource(`${getBaseUrl()}/api/comfyui/events`);

  es.addEventListener('progress', (e) => {
    try { callbacks.onProgress?.(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  es.addEventListener('executing', (e) => {
    try { callbacks.onExecuting?.(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  es.addEventListener('executed', (e) => {
    try { callbacks.onExecuted?.(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  es.addEventListener('complete', (e) => {
    try { callbacks.onComplete?.(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  es.addEventListener('error', (e) => {
    if (e instanceof MessageEvent && e.data) {
      try { callbacks.onError?.(JSON.parse(e.data)); } catch { /* ignore */ }
    }
  });
  es.addEventListener('queue', (e) => {
    try { callbacks.onQueue?.(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  es.addEventListener('status', (e) => {
    try { callbacks.onStatus?.(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });

  return { abort: () => es.close() };
}

// ─── ComfyUI History ─────────────────────────────────────

export async function getComfyUIRecentHistory(maxItems?: number): Promise<CuiHistoryEntry[]> {
  const params = new URLSearchParams();
  if (maxItems != null) params.set('maxItems', String(maxItems));
  const qs = params.toString();
  return request<CuiHistoryEntry[]>(`/api/comfyui/history/recent${qs ? `?${qs}` : ''}`);
}

// ─── ComfyUI Save Result to Library ──────────────────────

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

// ─── ComfyUI Tasks & Cancel ──────────────────────────────

export async function getComfyUITasks(): Promise<ComfyUITasksData> {
  return request<ComfyUITasksData>('/api/comfyui/tasks');
}

export async function cancelComfyUIExecution(promptId?: string): Promise<void> {
  await request<void>('/api/comfyui/cancel', {
    method: 'POST',
    body: JSON.stringify({ promptId }),
  });
}
