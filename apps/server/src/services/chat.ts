import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import type {
  ChatMessage,
  ChatSession,
  GenerationResult,
  MessageMetadata,
  RequestConfig,
} from '@ai-retouch/shared';

import type { AdapterImage, AdapterResultImage } from '../adapters/types.js';
import { saveGenerationImage, type SavedImage } from './image.js';
import {
  getSession,
  readMessages,
  appendMessage,
  updateMessage,
  findMessage,
  updateSession,
  getResultFilePath,
  getContextDir,
  type SessionMeta,
  type MessageData,
  type ResultData,
} from '../stores/document-store.js';

// ─── Converters: document-store types → API types ─────

export function sessionMetaToApi(meta: SessionMeta, docPath: string): ChatSession {
  return {
    id: meta.id,
    mode: meta.mode as ChatSession['mode'],
    title: meta.title,
    modelRef: meta.modelRef,
    documentPath: docPath,
    layerBinding: meta.layerBinding ?? null,
    activeLeafId: meta.activeLeafId ?? null,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

export function messageDataToApi(m: MessageData, sessionId: string): ChatMessage {
  let metadata: MessageMetadata | undefined;
  if (m.metadata) {
    metadata = m.metadata as MessageMetadata;
  }
  let requestConfig: RequestConfig | undefined;
  if (m.requestConfig) {
    requestConfig = m.requestConfig as RequestConfig;
  }
  return {
    id: m.id,
    sessionId,
    parentId: m.parentId,
    childIds: m.childIds ?? [],
    role: m.role,
    content: m.content,
    thinking: m.thinking,
    timestamp: m.timestamp,
    ...(metadata ? { metadata } : {}),
    ...(requestConfig ? { requestConfig } : {}),
    ...(m.contextImageFiles?.length ? { contextImageFiles: m.contextImageFiles } : {}),
  };
}

export function resultDataToApi(
  r: ResultData,
  messageId: string,
  workDir: string,
  sessionId: string,
  requestConfig?: RequestConfig,
): GenerationResult {
  const thumbPath = getResultFilePath(workDir, sessionId, r.id, 'thumb');
  let thumbnailData = '';
  try {
    if (fs.existsSync(thumbPath)) {
      thumbnailData = fs.readFileSync(thumbPath).toString('base64');
    }
  } catch {}

  return {
    id: r.id,
    messageId,
    sessionId,
    thumbnailData,
    previewPath: r.previewFile,
    fullPath: r.fullFile,
    mimeType: r.mimeType,
    sourceType: r.sourceType as GenerationResult['sourceType'],
    sourceDetail: r.sourceDetail,
    textResponse: r.textResponse,
    modelRef: r.modelRef,
    elapsedMs: r.elapsedMs,
    width: r.width,
    height: r.height,
    appliedToCanvas: r.appliedToCanvas,
    bookmarked: r.bookmarked,
    createdAt: r.createdAt,
    ...(requestConfig ? { requestConfig } : {}),
  };
}

/**
 * Given a list of messages and an assistant message, find the parent user
 * message's requestConfig. Results live on assistant messages; the
 * requestConfig lives on the preceding user message (its parent).
 */
export function findRequestConfigForMessage(
  messages: MessageData[],
  assistantMsg: MessageData,
): RequestConfig | undefined {
  if (assistantMsg.role !== 'assistant' || !assistantMsg.parentId) return undefined;
  const parent = messages.find((m) => m.id === assistantMsg.parentId);
  if (parent?.role === 'user' && parent.requestConfig) {
    return parent.requestConfig as RequestConfig;
  }
  return undefined;
}

// ─── Session Not Found Error ──────────────────────────

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

// ─── Service Functions ────────────────────────────────

export function validateSession(workDir: string, sessionId: string): SessionMeta {
  const session = getSession(workDir, sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  return session;
}

export function saveUserMessage(
  workDir: string,
  sessionId: string,
  content: string,
  modelRef: string,
  parentId: string | null,
  metadata?: MessageMetadata,
  requestConfig?: RequestConfig,
): { userMsgId: string; timestamp: number } {
  const now = Date.now();
  const userMsgId = uuidv4();

  const message: MessageData = {
    id: userMsgId,
    parentId,
    childIds: [],
    role: 'user',
    content,
    thinking: '',
    timestamp: now,
    metadata: metadata as Record<string, unknown> | undefined,
    requestConfig: requestConfig as Record<string, unknown> | undefined,
    results: [],
  };

  appendMessage(workDir, sessionId, message);
  updateSession(workDir, sessionId, { modelRef, updatedAt: now });

  return { userMsgId, timestamp: now };
}

export function saveAssistantMessage(
  workDir: string,
  sessionId: string,
  userMsgId: string,
  text: string,
  thinking: string,
  timestamp: number,
  results: ResultData[],
  responsePartsMeta?: unknown[],
  providerResponseId?: string | null,
): { assistantMsgId: string } {
  const assistantMsgId = uuidv4();

  const message: MessageData = {
    id: assistantMsgId,
    parentId: userMsgId,
    childIds: [],
    role: 'assistant',
    content: text,
    thinking,
    timestamp,
    results,
    responsePartsMeta,
    providerResponseId: providerResponseId ?? undefined,
  };

  appendMessage(workDir, sessionId, message);
  return { assistantMsgId };
}

export function saveAssistantMessageWithId(
  workDir: string,
  sessionId: string,
  assistantMsgId: string,
  userMsgId: string,
  text: string,
  thinking: string,
  timestamp: number,
  results: ResultData[],
  responsePartsMeta?: unknown[],
  providerResponseId?: string | null,
): void {
  const message: MessageData = {
    id: assistantMsgId,
    parentId: userMsgId,
    childIds: [],
    role: 'assistant',
    content: text,
    thinking,
    timestamp,
    results,
    responsePartsMeta,
    providerResponseId: providerResponseId ?? undefined,
  };

  appendMessage(workDir, sessionId, message);
}

export function saveAssistantMessagePlaceholder(
  workDir: string,
  sessionId: string,
  assistantMsgId: string,
  userMsgId: string,
): void {
  const message: MessageData = {
    id: assistantMsgId,
    parentId: userMsgId,
    childIds: [],
    role: 'assistant',
    content: '',
    thinking: '',
    timestamp: Date.now(),
    results: [],
  };
  appendMessage(workDir, sessionId, message);
}

export function updateAssistantMessageContent(
  workDir: string,
  sessionId: string,
  assistantMsgId: string,
  text: string,
  thinking: string,
  timestamp: number,
  responsePartsMeta?: unknown[],
  providerResponseId?: string | null,
): void {
  updateMessage(workDir, sessionId, assistantMsgId, (msg) => ({
    ...msg,
    content: text,
    thinking,
    timestamp,
    responsePartsMeta,
    providerResponseId: providerResponseId ?? undefined,
  }));
}

export function addResultToAssistantMessage(
  workDir: string,
  sessionId: string,
  assistantMsgId: string,
  result: ResultData,
): void {
  updateMessage(workDir, sessionId, assistantMsgId, (msg) => ({
    ...msg,
    results: [...msg.results, result],
  }));
}

export function getMessageAsApi(
  workDir: string,
  sessionId: string,
  messageId: string,
): ChatMessage {
  const msg = findMessage(workDir, sessionId, messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);
  return messageDataToApi(msg, sessionId);
}

export async function persistImage(
  image: AdapterResultImage,
  workDir: string,
  sessionId: string,
  assistantMsgId: string,
  modelRef: string,
  assistantText: string,
  promptUsed: string,
  elapsedMs: number,
  timestamp: number,
): Promise<{ result: GenerationResult; resultData: ResultData }> {
  const saved: SavedImage = await saveGenerationImage(image.data, image.mimeType, workDir, sessionId);

  const resultData: ResultData = {
    id: saved.id,
    fullFile: saved.fullFile,
    previewFile: saved.previewFile,
    thumbFile: saved.thumbFile,
    mimeType: 'image/png',
    sourceType: 'direct',
    sourceDetail: JSON.stringify({ modelRef }),
    textResponse: assistantText || null,
    modelRef,
    elapsedMs,
    width: saved.width,
    height: saved.height,
    promptUsed,
    appliedToCanvas: false,
    bookmarked: false,
    fileSize: saved.fileSize,
    createdAt: timestamp,
  };

  addResultToAssistantMessage(workDir, sessionId, assistantMsgId, resultData);

  const result = resultDataToApi(resultData, assistantMsgId, workDir, sessionId);

  console.log(`[Chat] Saved result image id=${saved.id} ${saved.width}x${saved.height} size=${saved.fileSize}`);

  return { result, resultData };
}

// ─── User Context Images ──────────────────────────────

export function saveUserContextImages(
  workDir: string,
  sessionId: string,
  userMsgId: string,
  images: AdapterImage[],
  previewImageData?: string,
): void {
  if (images.length === 0 && !previewImageData) return;

  const ctxDir = getContextDir(workDir, sessionId, userMsgId);
  fs.mkdirSync(ctxDir, { recursive: true });

  const filenames: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
    const filename = `${i}.${ext}`;
    fs.writeFileSync(path.join(ctxDir, filename), Buffer.from(img.data, 'base64'));
    filenames.push(filename);
  }

  if (previewImageData) {
    const raw = previewImageData.replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(path.join(ctxDir, 'preview.jpg'), Buffer.from(raw, 'base64'));
  }

  updateMessage(workDir, sessionId, userMsgId, (msg) => ({
    ...msg,
    contextImageFiles: filenames,
    hasContextPreview: !!previewImageData,
  }));

  console.log(`[Chat] Saved ${images.length} context image(s) for user msg ${userMsgId.slice(0, 8)}`);
}

export function loadUserContextImages(
  workDir: string,
  sessionId: string,
  msg: MessageData,
): AdapterImage[] {
  if (!msg.contextImageFiles || msg.contextImageFiles.length === 0) return [];

  const ctxDir = getContextDir(workDir, sessionId, msg.id);
  const images: AdapterImage[] = [];

  for (const filename of msg.contextImageFiles) {
    const absPath = path.join(ctxDir, filename);
    try {
      if (fs.existsSync(absPath)) {
        const buf = fs.readFileSync(absPath);
        const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
        images.push({ data: buf.toString('base64'), mimeType });
      }
    } catch (e) {
      console.warn(`[Chat] Failed to load context image ${filename}:`, e);
    }
  }

  return images;
}

export function resolveContextPreviewPath(
  workDir: string,
  sessionId: string,
  userMsgId: string,
): string | null {
  const ctxDir = getContextDir(workDir, sessionId, userMsgId);
  const previewPath = path.join(ctxDir, 'preview.jpg');
  return fs.existsSync(previewPath) ? previewPath : null;
}

export function resolveContextImagePath(
  workDir: string,
  sessionId: string,
  userMsgId: string,
  filename: string,
): string | null {
  if (/[/\\]/.test(filename)) return null;
  const ctxDir = getContextDir(workDir, sessionId, userMsgId);
  const filePath = path.join(ctxDir, filename);
  return fs.existsSync(filePath) ? filePath : null;
}
