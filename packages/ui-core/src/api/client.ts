import { type ApiResponse } from '@ai-retouch/shared';
import { markConnected, markDisconnected } from '../hooks/useBackendConnection';
import { getBaseUrl } from './baseUrl';

// ─── Core Request ────────────────────────────────────────

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data as T;
}
