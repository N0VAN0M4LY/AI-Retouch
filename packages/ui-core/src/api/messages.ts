import {
  type SendMessageRequest,
  type SendMessageResponse,
  type GenerationResult,
} from '@ai-retouch/shared';
import { markConnected, markDisconnected } from '../hooks/useBackendConnection';
import { getBaseUrl } from './baseUrl';
import { request } from './client';
import { type StreamCallbacks, type StreamHandle } from './types';

// ─── Documents ───────────────────────────────────────────

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

// ─── Message Deletion ────────────────────────────────────

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

// ─── SSE Helpers ─────────────────────────────────────────

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

  try {
    const parsed = JSON.parse(eventData);
    switch (eventType) {
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
    // Ignore unparseable SSE events
  }
}

function createXHRStream(url: string, body: unknown, callbacks: StreamCallbacks): StreamHandle {
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
        if (sseBuffer.trim()) {
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
    xhr.send(JSON.stringify(body));
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      xhr.abort();
    },
  };
}

// ─── Chat Messages (SSE Streaming) ───────────────────────

export function sendMessageStream(
  sessionId: string,
  docPath: string,
  data: SendMessageRequest,
  callbacks: StreamCallbacks,
): StreamHandle {
  const params = new URLSearchParams({ stream: 'true', docPath });
  const url = `${getBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`;
  return createXHRStream(url, data, callbacks);
}

export function regenerateStream(
  sessionId: string,
  userMsgId: string,
  docPath: string,
  data: Partial<SendMessageRequest> & { modelRef?: string; imageSize?: string },
  callbacks: StreamCallbacks,
): StreamHandle {
  const params = new URLSearchParams({ stream: 'true', docPath });
  const url = `${getBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(userMsgId)}/regenerate?${params}`;
  return createXHRStream(url, data, callbacks);
}

// ─── Context Preview URLs ─────────────────────────────────

export function getContextPreviewUrl(messageId: string, docPath: string, sessionId: string): string {
  const params = new URLSearchParams({ docPath, sessionId });
  return `${getBaseUrl()}/api/messages/${encodeURIComponent(messageId)}/context-preview?${params}`;
}

export function getContextImageUrl(messageId: string, filename: string, docPath: string, sessionId: string): string {
  const params = new URLSearchParams({ docPath, sessionId });
  return `${getBaseUrl()}/api/messages/${encodeURIComponent(messageId)}/context-images/${encodeURIComponent(filename)}?${params}`;
}
