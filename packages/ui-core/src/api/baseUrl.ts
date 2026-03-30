import { DEFAULT_BACKEND_URL } from '@ai-retouch/shared';

// ─── Base URL State ──────────────────────────────────────

let _baseUrl: string = DEFAULT_BACKEND_URL;

export function setBaseUrl(url: string): void {
  _baseUrl = url.trim().replace(/\/$/, '');
}

export function getBaseUrl(): string {
  return _baseUrl;
}
