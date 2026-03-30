import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { unpackAir, packAir, airPathForPsd, repairAndUnpackAir } from './air-archive.js';
import { getDataDir } from '../utils/paths.js';

const DATA_DIR = getDataDir();
const TEMP_DIR = path.join(DATA_DIR, 'temp');

// ─── Active document tracking ─────────────────────────

interface ActiveDocument {
  psdPath: string;
  workDir: string;
  dirty: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
  lastAirMtime: number;
}

const activeDocuments = new Map<string, ActiveDocument>();
const openLocks = new Map<string, Promise<string>>();

const SAVE_DEBOUNCE_MS = 5000;

function hashPath(p: string): string {
  return crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
}

/**
 * Open a document: unpack its .air file (if exists) into a temp work directory.
 * Serialized per-path to prevent concurrent unpacks corrupting the workDir.
 * If already open, checks whether the .air file was externally modified and re-unpacks if so.
 */
export async function openDocument(psdPath: string): Promise<string> {
  const pending = openLocks.get(psdPath);
  if (pending) return pending;

  const promise = openDocumentImpl(psdPath);
  openLocks.set(psdPath, promise);
  try {
    return await promise;
  } finally {
    openLocks.delete(psdPath);
  }
}

async function openDocumentImpl(psdPath: string): Promise<string> {
  const workDir = path.join(TEMP_DIR, hashPath(psdPath));
  const airPath = airPathForPsd(psdPath);

  const existing = activeDocuments.get(psdPath);
  if (existing) {
    if (fs.existsSync(airPath)) {
      const airMtime = fs.statSync(airPath).mtimeMs;
      if (airMtime !== existing.lastAirMtime) {
        console.log(`[DocStore] .air changed externally for ${psdPath}, re-unpacking`);
        if (existing.saveTimer) {
          clearTimeout(existing.saveTimer);
          existing.saveTimer = null;
        }
        if (fs.existsSync(existing.workDir)) {
          fs.rmSync(existing.workDir, { recursive: true, force: true });
        }
        try {
          await unpackAir(airPath, existing.workDir);
          existing.dirty = false;
          existing.lastAirMtime = airMtime;
          console.log(`[DocStore] Re-unpacked ${airPath} → ${existing.workDir}`);
        } catch (unpackErr) {
          console.warn(`[DocStore] Re-unpack failed for ${airPath}, attempting repair...`, unpackErr);
          try {
            const result = await repairAndUnpackAir(airPath, existing.workDir);
            existing.dirty = false;
            existing.lastAirMtime = fs.existsSync(airPath) ? fs.statSync(airPath).mtimeMs : 0;
            console.log(`[DocStore] Re-unpack repair succeeded (strategy: ${result.strategy})`);
          } catch {
            console.warn(`[DocStore] Re-unpack repair also failed, resetting workDir`);
            if (fs.existsSync(existing.workDir)) {
              fs.rmSync(existing.workDir, { recursive: true, force: true });
            }
            fs.mkdirSync(existing.workDir, { recursive: true });
            const manifest = { version: 1, createdAt: Date.now(), lastModified: Date.now() };
            fs.writeFileSync(path.join(existing.workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
            existing.dirty = false;
            existing.lastAirMtime = 0;
          }
        }
      }
    }
    return existing.workDir;
  }

  let lastAirMtime = 0;
  if (fs.existsSync(airPath)) {
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    try {
      await unpackAir(airPath, workDir);
      lastAirMtime = fs.statSync(airPath).mtimeMs;
      console.log(`[DocStore] Unpacked ${airPath} → ${workDir}`);
    } catch (unpackErr) {
      console.warn(`[DocStore] Normal unpack failed for ${airPath}, attempting repair...`, unpackErr);
      try {
        const result = await repairAndUnpackAir(airPath, workDir);
        lastAirMtime = fs.existsSync(airPath) ? fs.statSync(airPath).mtimeMs : 0;
        console.log(`[DocStore] Repair succeeded (strategy: ${result.strategy})${
          result.recovered != null ? `, recovered ${result.recovered} entries, skipped ${result.skipped}` : ''
        }`);
      } catch (repairErr) {
        console.warn(`[DocStore] Repair also failed for ${airPath}, creating fresh workDir:`, repairErr);
        const corruptedPath = airPath + '.corrupted';
        try { fs.renameSync(airPath, corruptedPath); } catch {}
        if (fs.existsSync(workDir)) {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
        fs.mkdirSync(workDir, { recursive: true });
        const manifest = { version: 1, createdAt: Date.now(), lastModified: Date.now() };
        fs.writeFileSync(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
    }
  } else {
    fs.mkdirSync(workDir, { recursive: true });
    const manifest = { version: 1, createdAt: Date.now(), lastModified: Date.now() };
    fs.writeFileSync(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[DocStore] Created new workDir for ${psdPath}`);
  }

  activeDocuments.set(psdPath, { psdPath, workDir, dirty: false, saveTimer: null, lastAirMtime });
  return workDir;
}

/**
 * Save (pack) a document's work directory back to its .air file.
 */
export async function saveDocument(psdPath: string): Promise<void> {
  const doc = activeDocuments.get(psdPath);
  if (!doc) return;

  if (doc.saveTimer) {
    clearTimeout(doc.saveTimer);
    doc.saveTimer = null;
  }

  const airPath = airPathForPsd(psdPath);
  // Update manifest lastModified
  const manifestPath = path.join(doc.workDir, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.lastModified = Date.now();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch {}

  try {
    await packAir(doc.workDir, airPath);
    doc.dirty = false;
    doc.lastAirMtime = fs.statSync(airPath).mtimeMs;
    console.log(`[DocStore] Saved ${airPath}`);
  } catch (packErr) {
    console.error(`[DocStore] Failed to pack ${airPath}:`, packErr);
  }
}

/**
 * Close a document: save and clean up its work directory.
 */
export async function closeDocument(psdPath: string): Promise<void> {
  const doc = activeDocuments.get(psdPath);
  if (!doc) return;

  if (doc.saveTimer) {
    clearTimeout(doc.saveTimer);
    doc.saveTimer = null;
  }

  // Only save if we have sessions (non-empty doc)
  const sessionsDir = path.join(doc.workDir, 'sessions');
  const hasSessions = fs.existsSync(sessionsDir) &&
    fs.readdirSync(sessionsDir).length > 0;

  if (hasSessions) {
    await saveDocument(psdPath);
  }

  fs.rmSync(doc.workDir, { recursive: true, force: true });
  activeDocuments.delete(psdPath);
  console.log(`[DocStore] Closed document ${psdPath}`);
}

/**
 * Close all active documents. Called on server shutdown.
 */
export async function closeAllDocuments(): Promise<void> {
  for (const psdPath of activeDocuments.keys()) {
    try {
      await closeDocument(psdPath);
    } catch (e) {
      console.warn(`[DocStore] Failed to close ${psdPath}:`, e);
    }
  }
}

/**
 * Get the work directory for an active document.
 * Throws if the document is not open.
 */
export function getWorkDir(psdPath: string): string {
  const doc = activeDocuments.get(psdPath);
  if (!doc) throw new Error(`Document not open: ${psdPath}`);
  return doc.workDir;
}

/**
 * Ensure a document is open. If not already open, opens it (through the
 * serialized openDocument which prevents concurrent unpacks).
 */
export async function ensureDocumentOpen(psdPath: string): Promise<string> {
  const doc = activeDocuments.get(psdPath);
  if (doc) return doc.workDir;
  return openDocument(psdPath);
}

/**
 * Mark a document as dirty and schedule an auto-save.
 */
export function markDirty(psdPath: string): void {
  const doc = activeDocuments.get(psdPath);
  if (!doc) return;
  doc.dirty = true;

  if (doc.saveTimer) clearTimeout(doc.saveTimer);
  doc.saveTimer = setTimeout(() => {
    saveDocument(psdPath).catch((e) =>
      console.warn(`[DocStore] Auto-save failed for ${psdPath}:`, e)
    );
  }, SAVE_DEBOUNCE_MS);
}

// ─── Session CRUD ─────────────────────────────────────

function sessionsDir(workDir: string): string {
  return path.join(workDir, 'sessions');
}

function sessionDir(workDir: string, sessionId: string): string {
  return path.join(workDir, 'sessions', sessionId);
}

function sessionJsonPath(workDir: string, sessionId: string): string {
  return path.join(workDir, 'sessions', sessionId, 'session.json');
}

function messagesJsonPath(workDir: string, sessionId: string): string {
  return path.join(workDir, 'sessions', sessionId, 'messages.json');
}

function sessionResultsDir(workDir: string, sessionId: string): string {
  return path.join(workDir, 'sessions', sessionId, 'results');
}

function sessionContextsDir(workDir: string, sessionId: string): string {
  return path.join(workDir, 'sessions', sessionId, 'contexts');
}

export interface SessionMeta {
  id: string;
  mode: string;
  title: string;
  modelRef: string | null;
  layerBinding: LayerBindingData | null;
  activeLeafId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LayerBindingData {
  layerName: string;
  lastResultId: string;
  lastLayerId?: number;
}

export interface MessageData {
  id: string;
  parentId: string | null;
  childIds: string[];
  role: 'user' | 'assistant';
  content: string;
  thinking: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  requestConfig?: Record<string, unknown>;
  responsePartsMeta?: unknown[];
  providerResponseId?: string;
  contextImageFiles?: string[];
  hasContextPreview?: boolean;
  results: ResultData[];
}

export interface ResultData {
  id: string;
  fullFile: string;
  previewFile: string;
  thumbFile: string;
  mimeType: string;
  sourceType: string;
  sourceDetail: string | null;
  textResponse: string | null;
  modelRef: string | null;
  elapsedMs: number | null;
  width: number | null;
  height: number | null;
  promptUsed: string | null;
  appliedToCanvas: boolean;
  bookmarked: boolean;
  fileSize: number;
  createdAt: number;
}

function ensureSessionDefaults(data: SessionMeta): SessionMeta {
  if ((data as unknown as Record<string, unknown>).activeLeafId === undefined) {
    data.activeLeafId = null;
  }
  return data;
}

export function listSessions(workDir: string, mode?: string): SessionMeta[] {
  const dir = sessionsDir(workDir);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const sessions: SessionMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = sessionJsonPath(workDir, entry.name);
    try {
      const data = ensureSessionDefaults(
        JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as SessionMeta,
      );
      if (!mode || data.mode === mode) {
        sessions.push(data);
      }
    } catch {}
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(workDir: string, sessionId: string): SessionMeta | null {
  const jsonPath = sessionJsonPath(workDir, sessionId);
  try {
    return ensureSessionDefaults(
      JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as SessionMeta,
    );
  } catch {
    return null;
  }
}

export function createSession(workDir: string, data: {
  mode: string;
  title?: string;
  modelRef?: string;
}): SessionMeta {
  const id = uuidv4();
  const now = Date.now();
  const dir = sessionDir(workDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'results'), { recursive: true });

  const session: SessionMeta = {
    id,
    mode: data.mode,
    title: data.title ?? '',
    modelRef: data.modelRef ?? null,
    layerBinding: null,
    activeLeafId: null,
    createdAt: now,
    updatedAt: now,
  };

  fs.writeFileSync(sessionJsonPath(workDir, id), JSON.stringify(session, null, 2));
  fs.writeFileSync(messagesJsonPath(workDir, id), '[]');
  return session;
}

export function updateSession(workDir: string, sessionId: string, patch: Partial<SessionMeta>): SessionMeta | null {
  const session = getSession(workDir, sessionId);
  if (!session) return null;
  Object.assign(session, patch, { updatedAt: Date.now() });
  fs.writeFileSync(sessionJsonPath(workDir, sessionId), JSON.stringify(session, null, 2));
  return session;
}

export function deleteSession(workDir: string, sessionId: string): boolean {
  const dir = sessionDir(workDir, sessionId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ─── Messages migration & tree utilities ──────────────

/**
 * Migrate old linear messages to tree structure.
 * Old format: user parentId = null, assistant parentId = userMsgId, no childIds.
 * New format: user parentId = previous assistant (null for first), all messages have childIds.
 */
function migrateMessagesToTree(messages: MessageData[]): MessageData[] {
  if (messages.length === 0) return messages;

  const needsMigration = (messages[0] as unknown as Record<string, unknown>).childIds === undefined;
  if (!needsMigration) return messages;

  console.log(`[DocStore] Migrating ${messages.length} messages to tree structure`);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && msg.parentId === null && i > 0) {
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'assistant') {
          msg.parentId = messages[j].id;
          break;
        }
      }
    }
    msg.childIds = [];
  }

  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const msg of messages) {
    if (msg.parentId) {
      const parent = byId.get(msg.parentId);
      if (parent && !parent.childIds.includes(msg.id)) {
        parent.childIds.push(msg.id);
      }
    }
  }

  return messages;
}

// Re-export for convenience
export { computeActivePath } from '@ai-retouch/shared';

// ─── Messages CRUD ────────────────────────────────────

export function readMessages(workDir: string, sessionId: string): MessageData[] {
  const jsonPath = messagesJsonPath(workDir, sessionId);
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as MessageData[];
    return migrateMessagesToTree(raw);
  } catch {
    return [];
  }
}

export function writeMessages(workDir: string, sessionId: string, messages: MessageData[]): void {
  const jsonPath = messagesJsonPath(workDir, sessionId);
  fs.writeFileSync(jsonPath, JSON.stringify(messages, null, 2));
}

export function appendMessage(workDir: string, sessionId: string, message: MessageData): void {
  const messages = readMessages(workDir, sessionId);

  if (!message.childIds) message.childIds = [];

  if (message.parentId) {
    const parent = messages.find((m) => m.id === message.parentId);
    if (parent) {
      if (!parent.childIds) parent.childIds = [];
      if (!parent.childIds.includes(message.id)) {
        parent.childIds.push(message.id);
      }
    }
  }

  messages.push(message);
  writeMessages(workDir, sessionId, messages);
}

export function updateMessage(
  workDir: string,
  sessionId: string,
  messageId: string,
  updater: (msg: MessageData) => MessageData,
): MessageData | null {
  const messages = readMessages(workDir, sessionId);
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return null;
  messages[idx] = updater(messages[idx]);
  writeMessages(workDir, sessionId, messages);
  return messages[idx];
}

export function findMessage(workDir: string, sessionId: string, messageId: string): MessageData | null {
  const messages = readMessages(workDir, sessionId);
  return messages.find((m) => m.id === messageId) ?? null;
}

/**
 * Delete a message and its entire subtree. Updates parent's childIds.
 * Returns the IDs of all deleted messages.
 */
export function deleteMessageSubtree(
  workDir: string,
  sessionId: string,
  messageId: string,
): string[] {
  const messages = readMessages(workDir, sessionId);
  const byId = new Map(messages.map((m) => [m.id, m]));

  const toDelete = new Set<string>();
  function collectDescendants(id: string) {
    toDelete.add(id);
    const msg = byId.get(id);
    if (msg?.childIds) {
      for (const childId of msg.childIds) {
        collectDescendants(childId);
      }
    }
  }
  collectDescendants(messageId);

  const target = byId.get(messageId);
  if (target?.parentId) {
    const parent = byId.get(target.parentId);
    if (parent) {
      parent.childIds = parent.childIds.filter((id) => id !== messageId);
    }
  }

  const remaining = messages.filter((m) => !toDelete.has(m.id));
  writeMessages(workDir, sessionId, remaining);

  // Clean up context directories for deleted user messages
  for (const id of toDelete) {
    const msg = byId.get(id);
    if (msg?.role === 'user') {
      const ctxDir = getContextDir(workDir, sessionId, id);
      if (fs.existsSync(ctxDir)) {
        fs.rmSync(ctxDir, { recursive: true, force: true });
      }
    }
    if (msg?.role === 'assistant') {
      for (const r of msg.results) {
        for (const type of ['full', 'preview', 'thumb'] as const) {
          const fp = getResultFilePath(workDir, sessionId, r.id, type);
          try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
        }
      }
    }
  }

  return Array.from(toDelete);
}

// ─── Result file paths ────────────────────────────────

export function getResultFilePath(
  workDir: string,
  sessionId: string,
  resultId: string,
  type: 'full' | 'preview' | 'thumb',
): string {
  const dir = sessionResultsDir(workDir, sessionId);
  switch (type) {
    case 'full': return path.join(dir, `${resultId}.png`);
    case 'preview': return path.join(dir, `${resultId}_preview.jpg`);
    case 'thumb': return path.join(dir, `${resultId}_thumb.jpg`);
  }
}

export function getContextDir(workDir: string, sessionId: string, userMsgId: string): string {
  return path.join(sessionContextsDir(workDir, sessionId), userMsgId);
}

// ─── Startup recovery ─────────────────────────────────

/**
 * On server startup, check for stale temp directories from crashed sessions.
 * If a workDir exists but the document is not active, attempt to pack it.
 */
export async function recoverStaleTempDirs(): Promise<void> {
  if (!fs.existsSync(TEMP_DIR)) return;

  const entries = fs.readdirSync(TEMP_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workDir = path.join(TEMP_DIR, entry.name);
    console.log(`[DocStore] Found stale temp dir: ${workDir} (will be cleaned on next use)`);
  }
}
