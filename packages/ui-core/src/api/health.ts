import { HEALTH_ENDPOINT, type HealthResponse } from '@ai-retouch/shared';
import { markConnected, markDisconnected } from '../hooks/useBackendConnection';
import { getBaseUrl } from './baseUrl';
import { request } from './client';

// ─── Health ──────────────────────────────────────────────

export async function fetchBackendHealth(overrideUrl?: string): Promise<HealthResponse> {
  const url = overrideUrl ? overrideUrl.trim().replace(/\/$/, '') : getBaseUrl();
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

export async function fetchAppInfo(): Promise<{ execPath: string }> {
  return request<{ execPath: string }>('/api/app-info');
}
