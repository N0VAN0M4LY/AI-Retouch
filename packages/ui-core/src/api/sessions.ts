import {
  type ChatSession,
  type CreateSessionRequest,
  type SessionWithMessages,
  type PersistedLayerBinding,
} from '@ai-retouch/shared';
import { request } from './client';

// ─── Sessions ────────────────────────────────────────────

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
