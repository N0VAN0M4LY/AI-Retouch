import {
  type GenerationResult,
  type ResultsListResponse,
  type UpdateResultRequest,
} from '@ai-retouch/shared';
import { getBaseUrl } from './baseUrl';
import { request } from './client';

// ─── Results ─────────────────────────────────────────────

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
  docPath?: string | null;
  sessionId?: string | null;
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
