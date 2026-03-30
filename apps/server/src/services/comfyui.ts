import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ComfyUIConnectionState, ComfyUIStatus, ComfyUISystemStats } from '@ai-retouch/shared';
import { getSetting } from '../stores/config-store.js';

let cachedObjectInfo: Record<string, unknown> | null = null;
let objectInfoFetchedAt = 0;
const OBJECT_INFO_TTL_MS = 30 * 60 * 1000;

let connectionState: ComfyUIConnectionState = 'disconnected';
let lastSystemStats: ComfyUISystemStats | undefined;
let lastError: string | undefined;

function getComfyUIBaseUrl(): string {
  const addr = (getSetting<string>('comfyui_address') ?? 'localhost:8188').trim();
  return addr.startsWith('http') ? addr : `http://${addr}`;
}

// ─── WebSocket Connection Manager ─────────────────────

export interface TaskState {
  promptId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentNode?: string;
  progress?: { value: number; max: number };
  startedAt?: number;
  completedAt?: number;
  outputs?: Array<{ filename: string; subfolder: string; type: string }>;
  error?: string;
}

export type ComfyUIEvent =
  | { type: 'progress'; promptId: string; node: string; value: number; max: number; percentage: number }
  | { type: 'executing'; promptId: string; node: string }
  | { type: 'executed'; promptId: string; node: string; output: unknown }
  | { type: 'complete'; promptId: string; images: Array<{ filename: string; subfolder: string; type: string }> }
  | { type: 'error'; promptId: string; message: string }
  | { type: 'queue'; queueRemaining: number }
  | { type: 'status'; wsConnected: boolean };

const CLIENT_ID = randomUUID();
const comfyEvents = new EventEmitter();
comfyEvents.setMaxListeners(50);

let ws: WebSocket | null = null;
let wsConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let wsAddressSnapshot: string | undefined;

const activeTasks = new Map<string, TaskState>();
const recentTasks: TaskState[] = [];
const MAX_RECENT_TASKS = 50;

function getComfyUIWsUrl(): string {
  const addr = (getSetting<string>('comfyui_address') ?? 'localhost:8188').trim();
  const host = addr.replace(/^https?:\/\//, '');
  return `ws://${host}/ws?clientId=${CLIENT_ID}`;
}

export function getClientId(): string {
  return CLIENT_ID;
}

export function getComfyEventEmitter(): EventEmitter {
  return comfyEvents;
}

export function isWebSocketConnected(): boolean {
  return wsConnected;
}

function emitEvent(event: ComfyUIEvent): void {
  comfyEvents.emit('comfyui-event', event);
}

function archiveTask(task: TaskState): void {
  activeTasks.delete(task.promptId);
  recentTasks.unshift(task);
  if (recentTasks.length > MAX_RECENT_TASKS) {
    recentTasks.pop();
  }
}

function completeTask(promptId: string, source: string): void {
  const task = activeTasks.get(promptId);
  if (!task) {
    console.log(`[ComfyUI WS] ${source} for ${promptId.slice(0, 8)} — task already archived or not found, skipping`);
    return;
  }
  if (task.status === 'completed' || task.status === 'failed') {
    console.log(`[ComfyUI WS] ${source} for ${promptId.slice(0, 8)} — already ${task.status}, skipping`);
    return;
  }

  task.status = 'completed';
  task.completedAt = Date.now();
  const elapsed = task.startedAt ? `${Date.now() - task.startedAt}ms` : '?';

  if (!task.outputs || task.outputs.length === 0) {
    console.log(`[ComfyUI WS] ✅ ${source}: ${promptId.slice(0, 8)} completed (${elapsed}) but outputs empty — fetching from history`);
    fetchOutputsFromHistory(promptId).then((outputs) => {
      console.log(`[ComfyUI WS] ✅ Emitting complete for ${promptId.slice(0, 8)}: ${outputs.length} image(s) from history`);
      emitEvent({ type: 'complete', promptId, images: outputs });
      archiveTask(task);
    }).catch((err) => {
      console.error(`[ComfyUI WS] Failed to fetch outputs from history:`, err);
      emitEvent({ type: 'complete', promptId, images: [] });
      archiveTask(task);
    });
  } else {
    console.log(`[ComfyUI WS] ✅ Emitting complete for ${promptId.slice(0, 8)}: ${task.outputs.length} image(s) — ${elapsed}`);
    emitEvent({ type: 'complete', promptId, images: task.outputs });
    archiveTask(task);
  }
}

function handleWsMessage(raw: WebSocket.RawData): void {
  let data: any;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const msgType: string = data.type;
  const d = data.data;

  if (msgType !== 'status' && msgType !== 'progress') {
    console.log(`[ComfyUI WS] ← ${msgType}`, d?.prompt_id ? `prompt=${d.prompt_id.slice(0, 8)}` : '', d?.node != null ? `node=${d.node}` : '');
  }

  switch (msgType) {
    case 'status': {
      const remaining: number = d?.status?.exec_info?.queue_remaining ?? 0;
      emitEvent({ type: 'queue', queueRemaining: remaining });
      break;
    }

    case 'execution_start': {
      const promptId: string | undefined = d?.prompt_id;
      if (!promptId) break;
      let task = activeTasks.get(promptId);
      if (!task) {
        task = { promptId, status: 'queued', startedAt: Date.now() };
        activeTasks.set(promptId, task);
      }
      task.status = 'running';
      task.startedAt = task.startedAt ?? Date.now();
      break;
    }

    case 'execution_cached': {
      const promptId: string | undefined = d?.prompt_id;
      const cachedNodes: string[] = d?.nodes ?? [];
      if (promptId) {
        console.log(`[ComfyUI WS] Cached ${cachedNodes.length} nodes for ${promptId.slice(0, 8)}`);
      }
      break;
    }

    case 'executing': {
      const promptId: string | undefined = d?.prompt_id;
      if (!promptId) break;

      if (d?.node == null) {
        completeTask(promptId, 'executing(null)');
        break;
      }

      const node: string = d?.node ?? '';
      const task = activeTasks.get(promptId);
      if (task) {
        task.currentNode = node;
        task.progress = undefined;
      }
      emitEvent({ type: 'executing', promptId, node });
      break;
    }

    case 'progress': {
      const promptId: string | undefined = d?.prompt_id;
      const node: string = d?.node ?? '';
      const value: number = d?.value ?? 0;
      const max: number = d?.max ?? 1;
      if (!promptId) break;

      const task = activeTasks.get(promptId);
      if (task) {
        task.progress = { value, max };
        task.currentNode = node;
      }
      emitEvent({
        type: 'progress',
        promptId,
        node,
        value,
        max,
        percentage: max > 0 ? Math.round((value / max) * 100) : 0,
      });
      break;
    }

    case 'executed': {
      const promptId: string | undefined = d?.prompt_id;
      const node: string = d?.node ?? '';
      const output = d?.output;
      if (!promptId) break;

      if (output?.images && Array.isArray(output.images)) {
        const task = activeTasks.get(promptId);
        if (task) {
          if (!task.outputs) task.outputs = [];
          for (const img of output.images) {
            task.outputs.push({
              filename: img.filename,
              subfolder: img.subfolder ?? '',
              type: img.type ?? 'output',
            });
          }
        }
      }
      emitEvent({ type: 'executed', promptId, node, output });
      break;
    }

    case 'execution_success': {
      const promptId: string | undefined = d?.prompt_id;
      if (promptId) {
        completeTask(promptId, 'execution_success');
      }
      break;
    }

    case 'execution_error': {
      const promptId: string | undefined = d?.prompt_id;
      const message: string = d?.exception_message ?? d?.message ?? 'Unknown execution error';
      if (!promptId) break;

      const task = activeTasks.get(promptId);
      if (task) {
        task.status = 'failed';
        task.error = message;
        task.completedAt = Date.now();
        archiveTask(task);
      }
      emitEvent({ type: 'error', promptId, message });
      break;
    }
  }
}

async function fetchOutputsFromHistory(
  promptId: string,
): Promise<Array<{ filename: string; subfolder: string; type: string }>> {
  const baseUrl = getComfyUIBaseUrl();
  const res = await fetch(`${baseUrl}/history/${promptId}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as Record<string, any>;
  const entry = data[promptId];
  if (!entry?.outputs) return [];

  const images: Array<{ filename: string; subfolder: string; type: string }> = [];
  for (const [, nodeOutput] of Object.entries<any>(entry.outputs)) {
    if (nodeOutput?.images && Array.isArray(nodeOutput.images)) {
      for (const img of nodeOutput.images) {
        images.push({
          filename: img.filename,
          subfolder: img.subfolder ?? '',
          type: img.type ?? 'output',
        });
      }
    }
  }
  console.log(`[ComfyUI WS] Fetched ${images.length} output image(s) from history for ${promptId.slice(0, 8)}`);
  return images;
}

export function connectWebSocket(): void {
  const currentAddr = getSetting<string>('comfyui_address') ?? 'localhost:8188';

  if (ws && wsAddressSnapshot === currentAddr) {
    return;
  }

  if (ws) {
    disconnectWebSocket();
  }

  wsAddressSnapshot = currentAddr;
  const url = getComfyUIWsUrl();

  console.log(`[ComfyUI WS] Connecting to ${url}`);

  const socket = new WebSocket(url);
  ws = socket;

  socket.on('open', () => {
    wsConnected = true;
    connectionState = 'connected';
    reconnectAttempt = 0;
    console.log('[ComfyUI WS] Connected');
    emitEvent({ type: 'status', wsConnected: true });

    if (!cachedObjectInfo) {
      fetchObjectInfo()
        .then(() => console.log('[ComfyUI] Pre-cached objectInfo on WS connect'))
        .catch(() => { /* will be fetched lazily when needed */ });
    }
  });

  socket.on('message', (data) => {
    handleWsMessage(data);
  });

  socket.on('close', (code) => {
    wsConnected = false;
    console.log(`[ComfyUI WS] Disconnected (code: ${code})`);
    emitEvent({ type: 'status', wsConnected: false });
    ws = null;
    scheduleReconnect();
  });

  socket.on('error', (err) => {
    if (reconnectAttempt === 0) {
      console.error(`[ComfyUI WS] Error: ${err.message}`);
    }
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
  reconnectAttempt++;

  if (reconnectAttempt <= 3 || reconnectAttempt % 10 === 0) {
    console.log(`[ComfyUI WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (connectionState === 'connected') {
      connectWebSocket();
    }
  }, delay);
}

export function disconnectWebSocket(): void {
  connectionState = 'disconnected';
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  wsAddressSnapshot = undefined;

  if (ws) {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }

  if (wsConnected) {
    wsConnected = false;
    emitEvent({ type: 'status', wsConnected: false });
  }
}

export function registerTask(promptId: string): void {
  activeTasks.set(promptId, {
    promptId,
    status: 'queued',
    startedAt: Date.now(),
  });
}

export function getActiveTasks(): TaskState[] {
  return Array.from(activeTasks.values());
}

export function getRecentTasks(limit = 20): TaskState[] {
  return recentTasks.slice(0, limit);
}

export function getTaskState(promptId: string): TaskState | null {
  return activeTasks.get(promptId) ?? recentTasks.find((t) => t.promptId === promptId) ?? null;
}

export function getComfyUIStatus(): ComfyUIStatus {
  return {
    state: connectionState,
    address: getSetting<string>('comfyui_address') ?? 'localhost:8188',
    wsConnected,
    systemStats: lastSystemStats,
    error: lastError,
  };
}

export async function testConnection(): Promise<ComfyUIStatus> {
  const baseUrl = getComfyUIBaseUrl();
  connectionState = 'connecting';
  lastError = undefined;

  try {
    const res = await fetch(`${baseUrl}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`ComfyUI responded with status ${res.status}`);
    }
    const stats = (await res.json()) as ComfyUISystemStats;
    lastSystemStats = stats;
    connectionState = 'connected';
    lastError = undefined;
    connectWebSocket();
  } catch (err) {
    connectionState = 'error';
    lastError = err instanceof Error ? err.message : String(err);
    lastSystemStats = undefined;
    disconnectWebSocket();
  }

  return getComfyUIStatus();
}

export async function fetchObjectInfo(): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (cachedObjectInfo && now - objectInfoFetchedAt < OBJECT_INFO_TTL_MS) {
    console.log(`[ComfyUI] objectInfo cache HIT (age: ${((now - objectInfoFetchedAt) / 1000).toFixed(0)}s, ${Object.keys(cachedObjectInfo).length} types)`);
    return cachedObjectInfo;
  }

  const baseUrl = getComfyUIBaseUrl();
  const cacheStatus = cachedObjectInfo ? 'EXPIRED' : 'COLD';
  console.log(`[ComfyUI] objectInfo cache ${cacheStatus}, fetching from ${baseUrl}/object_info ...`);
  const fetchStart = Date.now();

  const res = await fetch(`${baseUrl}/object_info`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch object_info: ${res.status}`);
  }

  cachedObjectInfo = (await res.json()) as Record<string, unknown>;
  objectInfoFetchedAt = now;
  const elapsed = Date.now() - fetchStart;
  console.log(`[ComfyUI] objectInfo fetched: ${Object.keys(cachedObjectInfo).length} node types in ${elapsed}ms`);
  return cachedObjectInfo;
}

export function invalidateObjectInfoCache(): void {
  cachedObjectInfo = null;
  objectInfoFetchedAt = 0;
}

export async function getHistory(maxItems = 20): Promise<Record<string, unknown>> {
  const baseUrl = getComfyUIBaseUrl();
  const res = await fetch(`${baseUrl}/history?max_items=${maxItems}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch history: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function getQueue(): Promise<Record<string, unknown>> {
  const baseUrl = getComfyUIBaseUrl();
  const res = await fetch(`${baseUrl}/queue`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch queue: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function uploadImage(
  imageBuffer: Buffer,
  filename: string,
  subfolder = '',
  overwrite = true,
  contentType = 'image/png',
): Promise<{ name: string; subfolder: string; type: string }> {
  const baseUrl = getComfyUIBaseUrl();

  const boundary = `----FormBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  };

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  ));
  parts.push(imageBuffer);
  parts.push(Buffer.from('\r\n'));

  if (subfolder) addField('subfolder', subfolder);
  addField('overwrite', overwrite ? 'true' : 'false');

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const res = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return (await res.json()) as { name: string; subfolder: string; type: string };
}

export async function viewImage(
  filename: string,
  subfolder = '',
  type = 'output',
): Promise<{ buffer: Buffer; contentType: string }> {
  const baseUrl = getComfyUIBaseUrl();
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${baseUrl}/view?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Failed to view image: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'image/png';
  return { buffer, contentType };
}

export async function queuePrompt(
  prompt: Record<string, unknown>,
  clientId?: string,
): Promise<{ prompt_id: string }> {
  const baseUrl = getComfyUIBaseUrl();
  const body: Record<string, unknown> = {
    prompt,
    client_id: clientId ?? CLIENT_ID,
  };

  const res = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[ComfyUI] Queue prompt failed (${res.status}):`, text);
    try {
      const errJson = JSON.parse(text);
      if (errJson.node_errors) {
        for (const [nodeId, nodeErr] of Object.entries(errJson.node_errors as Record<string, any>)) {
          const ct = nodeErr.class_type ?? '?';
          for (const e of nodeErr.errors ?? []) {
            console.error(`[ComfyUI]   Node #${nodeId} (${ct}): ${e.details ?? e.message}`);
          }
        }
      }
    } catch { /* not JSON, already logged raw text */ }
    throw new Error(`Queue prompt failed (${res.status}): ${text}`);
  }

  const result = (await res.json()) as { prompt_id: string };
  registerTask(result.prompt_id);
  return result;
}

export interface PromptResult {
  promptId: string;
  status: 'completed' | 'failed';
  outputs: Array<{
    nodeId: string;
    images: Array<{ filename: string; subfolder: string; type: string }>;
  }>;
}

export async function pollPromptResult(
  promptId: string,
  timeoutMs: number = 120000,
): Promise<PromptResult> {
  const baseUrl = getComfyUIBaseUrl();
  const pollIntervalMs = 2000;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    console.log(`[ComfyUI] Polling result for ${promptId}, attempt ${attempt}...`);

    const res = await fetch(`${baseUrl}/history/${promptId}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch history for prompt ${promptId}: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, any>;
    const entry = data[promptId];

    if (entry?.status?.completed) {
      const statusStr: string = entry.status.status_str ?? 'unknown';
      const outputs: PromptResult['outputs'] = [];

      if (entry.outputs) {
        for (const [nodeId, nodeOutput] of Object.entries<any>(entry.outputs)) {
          if (nodeOutput.images && Array.isArray(nodeOutput.images)) {
            outputs.push({
              nodeId,
              images: nodeOutput.images.map((img: any) => ({
                filename: img.filename,
                subfolder: img.subfolder ?? '',
                type: img.type ?? 'output',
              })),
            });
          }
        }
      }

      return {
        promptId,
        status: statusStr === 'success' ? 'completed' : 'failed',
        outputs,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timeout waiting for prompt ${promptId} after ${timeoutMs}ms`);
}

export async function cancelTask(promptId: string): Promise<void> {
  const baseUrl = getComfyUIBaseUrl();
  await fetch(`${baseUrl}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] }),
    signal: AbortSignal.timeout(5000),
  });
}

export async function interruptExecution(): Promise<void> {
  const baseUrl = getComfyUIBaseUrl();
  await fetch(`${baseUrl}/interrupt`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  });
}

// ─── Userdata write (save workflow JSON to ComfyUI) ──

export async function saveToUserdata(filePath: string, content: string): Promise<void> {
  const baseUrl = getComfyUIBaseUrl();
  const encoded = encodeURIComponent(filePath);

  for (const prefix of ['/api', '']) {
    try {
      const res = await fetch(`${baseUrl}${prefix}/userdata/${encoded}`, {
        method: 'POST',
        body: content,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        console.log(`[ComfyUI] Saved to userdata: ${filePath}`);
        return;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Failed to save to ComfyUI userdata: ${filePath}`);
}

// ─── Remote workflow browsing (ComfyUI userdata API) ─

export interface RemoteWorkflowEntry {
  path: string;
  name: string;
  modified: number;
  size: number;
}

/**
 * List workflow files saved in ComfyUI's userdata storage.
 * Uses GET /api/userdata?dir=workflows (new ComfyUI frontend).
 * Falls back to GET /userdata?dir=workflows for older builds.
 */
export async function listRemoteWorkflows(): Promise<RemoteWorkflowEntry[]> {
  const baseUrl = getComfyUIBaseUrl();

  for (const prefix of ['/api', '']) {
    try {
      const res = await fetch(
        `${baseUrl}${prefix}/userdata?dir=workflows&recurse=true`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) continue;
      const files = (await res.json()) as string[];
      console.log(`[ComfyUI] Listed ${files.length} remote workflows:`, files.slice(0, 5));
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
          path: f,
          name: f.replace(/\.json$/i, '').replace(/^.*[\\/]/, ''),
          modified: 0,
          size: 0,
        }));
    } catch {
      continue;
    }
  }

  throw new Error('ComfyUI does not support userdata API. Use manual JSON import instead.');
}

/**
 * Fetch a single workflow JSON from ComfyUI's userdata storage.
 *
 * ComfyUI's aiohttp route is `GET /api/userdata/{file}` where {file} is a
 * single path segment. To access `workflows/xxx.json`, the slash must be
 * URL-encoded as `%2F` so aiohttp sees it as one segment:
 *   GET /api/userdata/workflows%2Ftext2img_basic.json
 *
 * The listing endpoint with `?dir=workflows` returns paths relative to the
 * workflows dir (e.g. "text2img_basic.json"), so we prepend "workflows/".
 */
export async function fetchRemoteWorkflow(
  filePath: string,
): Promise<Record<string, unknown>> {
  const baseUrl = getComfyUIBaseUrl();

  const fullPath = filePath.startsWith('workflows/')
    ? filePath
    : `workflows/${filePath}`;
  const encoded = encodeURIComponent(fullPath);

  const candidates = [
    `${baseUrl}/api/userdata/${encoded}`,
    `${baseUrl}/userdata/${encoded}`,
  ];

  const errors: string[] = [];

  for (const url of candidates) {
    try {
      console.log(`[ComfyUI] Trying to fetch workflow: ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        errors.push(`${url} → ${res.status}`);
        continue;
      }
      const json = (await res.json()) as Record<string, unknown>;
      console.log(`[ComfyUI] Successfully fetched workflow from: ${url}`);
      return json;
    } catch (err) {
      errors.push(`${url} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.error(`[ComfyUI] All fetch attempts failed for "${filePath}":`, errors);
  throw new Error(`Failed to fetch workflow "${filePath}" from ComfyUI.`);
}
