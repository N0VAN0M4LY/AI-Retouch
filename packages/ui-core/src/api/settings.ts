import { request } from './client';

// ─── Settings ────────────────────────────────────────────

export async function getSettings(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/settings');
}

export async function getSetting<V = unknown>(key: string): Promise<V> {
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
