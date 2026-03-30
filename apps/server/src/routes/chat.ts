import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type {
  ApiResponse,
  ChatSession,
  CreateSessionRequest,
  GeminiImageSize,
  GenerationResult,
  SendMessageRequest,
  SendMessageResponse,
  SessionWithMessages,
  DataChangedScope,
} from '@ai-retouch/shared';
import { broadcastToAll } from '../services/ps-bridge.js';

import type { AdapterImage, ConversationTurn, ResponsePartMeta } from '../adapters/types.js';
import { callModel, callModelStream, resolveModelRef } from '../adapters/index.js';
import { buildImagesFromContext } from '../services/prompt.js';
import { saveGenerationImage } from '../services/image.js';
import {
  ensureDocumentOpen,
  listSessions,
  getSession,
  createSession,
  deleteSession as deleteSessionFromStore,
  updateSession,
  readMessages,
  updateMessage,
  markDirty,
  getResultFilePath,
  getContextDir,
  computeActivePath,
  deleteMessageSubtree,
  type MessageData,
  type ResultData,
} from '../stores/document-store.js';
import {
  sessionMetaToApi,
  messageDataToApi,
  resultDataToApi,
  findRequestConfigForMessage,
  validateSession,
  saveUserMessage,
  saveAssistantMessageWithId,
  saveAssistantMessagePlaceholder,
  updateAssistantMessageContent,
  getMessageAsApi,
  persistImage,
  saveUserContextImages,
  loadUserContextImages,
  resolveContextPreviewPath,
  resolveContextImagePath,
  SessionNotFoundError,
} from '../services/chat.js';

const router = Router();

function notifyDataChanged(scope: DataChangedScope, documentPath?: string): void {
  broadcastToAll({
    event: 'dataChanged',
    data: { scope, documentPath },
    timestamp: Date.now(),
  });
}

// ─── Sessions CRUD ────────────────────────────────────

router.get('/api/sessions', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath query parameter is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const mode = req.query.mode as string | undefined;
    const sessions = listSessions(workDir, mode);

    const data: ApiResponse<ChatSession[]> = {
      success: true,
      data: sessions.map((s) => sessionMetaToApi(s, docPath)),
    };
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/api/sessions', async (req, res) => {
  try {
    const body = req.body as CreateSessionRequest;
    const docPath = body.documentPath;
    if (!docPath) {
      res.status(400).json({ success: false, error: 'documentPath is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const session = createSession(workDir, {
      mode: body.mode,
      title: body.title,
      modelRef: body.modelRef,
    });

    markDirty(docPath);
    notifyDataChanged('sessions', docPath);

    const data: ApiResponse<ChatSession> = {
      success: true,
      data: sessionMetaToApi(session, docPath),
    };
    res.status(201).json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/api/sessions/:id', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath query parameter is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const sessionMeta = getSession(workDir, req.params.id);

    if (!sessionMeta) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const messages = readMessages(workDir, req.params.id);
    const allResults: GenerationResult[] = [];

    for (const msg of messages) {
      const reqConfig = findRequestConfigForMessage(messages, msg);
      for (const r of msg.results) {
        allResults.push(resultDataToApi(r, msg.id, workDir, req.params.id, reqConfig));
      }
    }

    const session: SessionWithMessages = {
      ...sessionMetaToApi(sessionMeta, docPath),
      messages: messages.map((m) => messageDataToApi(m, req.params.id)),
      results: allResults,
    };

    const data: ApiResponse<SessionWithMessages> = { success: true, data: session };
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

router.delete('/api/sessions/:id', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath query parameter is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const ok = deleteSessionFromStore(workDir, req.params.id);

    if (!ok) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    markDirty(docPath);
    notifyDataChanged('sessions', docPath);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

router.patch('/api/sessions/:id', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath query parameter is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const body = req.body as { title?: string; layerBinding?: unknown; activeLeafId?: string | null; modelRef?: string | null };

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.layerBinding !== undefined) patch.layerBinding = body.layerBinding;
    if (body.activeLeafId !== undefined) patch.activeLeafId = body.activeLeafId;
    if (body.modelRef !== undefined) patch.modelRef = body.modelRef;

    const updated = updateSession(workDir, req.params.id, patch);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    markDirty(docPath);
    const data: ApiResponse<ChatSession> = { success: true, data: sessionMetaToApi(updated, docPath) };
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Send Message (core pipeline) ────────────────────

router.post('/api/sessions/:id/messages', async (req, res) => {
  const wantsStream = req.query.stream === 'true';
  const sessionId = req.params.id;
  const body = req.body as SendMessageRequest & { documentPath?: string };
  const docPath = (req.query.docPath as string) || body.documentPath;

  console.log(`[Chat] Send message session=${sessionId} model=${body.modelRef} stream=${wantsStream} prompt="${body.content.slice(0, 80)}"`);

  if (!docPath) {
    const errPayload = { success: false, error: 'docPath is required' };
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`event: error\ndata: ${JSON.stringify(errPayload)}\n\n`);
      res.end();
    } else {
      res.status(400).json(errPayload);
    }
    return;
  }

  try {
    const workDir = await ensureDocumentOpen(docPath);

    let sessionMeta;
    try {
      sessionMeta = validateSession(workDir, sessionId);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        const errPayload = { success: false, error: 'Session not found' };
        if (wantsStream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.write(`event: error\ndata: ${JSON.stringify(errPayload)}\n\n`);
          res.end();
        } else {
          res.status(404).json(errPayload);
        }
        return;
      }
      throw err;
    }

    const allMessages = readMessages(workDir, sessionId);

    let userParentId: string | null;
    let previousMessages: typeof allMessages;

    if (body.parentId !== undefined) {
      userParentId = body.parentId ?? null;
      previousMessages = userParentId
        ? computeActivePath(allMessages, userParentId)
        : [];
    } else {
      const activePath = computeActivePath(allMessages, sessionMeta.activeLeafId);
      const lastInPath = activePath.length > 0 ? activePath[activePath.length - 1] : null;
      userParentId = lastInPath?.id ?? null;
      previousMessages = activePath;
    }

    const { userMsgId } = saveUserMessage(workDir, sessionId, body.content, body.modelRef, userParentId, body.userMetadata, body.requestConfig);
    const assistantMsgId = uuidv4();

    let providerStreamEnabled = false;
    try {
      const { provider } = resolveModelRef(body.modelRef);
      providerStreamEnabled = provider.streamEnabled;
    } catch { /* will fail later in callModel */ }

    const useStreaming = wantsStream && providerStreamEnabled;

    const history: ConversationTurn[] = [];
    for (const m of previousMessages) {
      if (m.metadata && (m.metadata as Record<string, unknown>).isError) continue;

      const turn: ConversationTurn = {
        role: m.role,
        content: m.content,
      };

      if (m.role === 'user') {
        const userImages = loadUserContextImages(workDir, sessionId, m);
        if (userImages.length > 0) {
          turn.images = userImages;
          if (m.metadata) {
            const meta = m.metadata as Record<string, unknown>;
            if (meta.promptPrefix) {
              turn.content = (meta.promptPrefix as string) + m.content;
            }
          }
          console.log(`[Chat] History: user msg ${m.id.slice(0, 8)} includes ${userImages.length} context image(s)`);
        }
      }

      if (m.role === 'assistant') {
        const images: AdapterImage[] = [];
        for (const r of m.results) {
          const previewPath = getResultFilePath(workDir, sessionId, r.id, 'preview');
          const fullPath = getResultFilePath(workDir, sessionId, r.id, 'full');
          const filePath = fs.existsSync(previewPath) ? previewPath : fullPath;
          try {
            if (fs.existsSync(filePath)) {
              const buf = fs.readFileSync(filePath);
              images.push({
                data: buf.toString('base64'),
                mimeType: filePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
              });
            }
          } catch (e) {
            console.warn(`[Chat] Failed to read history image for result ${r.id}:`, e);
          }
        }

        if (images.length > 0) {
          turn.images = images;
          console.log(`[Chat] History: assistant msg ${m.id.slice(0, 8)} includes ${images.length} image(s)`);
        }

        if (m.responsePartsMeta) {
          turn.responsePartsMeta = m.responsePartsMeta as ResponsePartMeta[];
        }
      }

      history.push(turn);
    }

    let previousResponseId: string | undefined;
    for (let i = previousMessages.length - 1; i >= 0; i--) {
      if (previousMessages[i].role === 'assistant' && previousMessages[i].providerResponseId) {
        previousResponseId = previousMessages[i].providerResponseId;
        break;
      }
    }

    let contextImages: AdapterImage[] | undefined;
    let promptToSend = body.content;

    if (body.reuseContextFrom) {
      const sourceMsg = allMessages.find((m) => m.id === body.reuseContextFrom);
      if (sourceMsg) {
        const reusedImages = loadUserContextImages(workDir, sessionId, sourceMsg);
        if (reusedImages.length > 0) {
          contextImages = reusedImages;
          const srcMeta = sourceMsg.metadata as Record<string, unknown> | undefined;
          const promptPrefix = (srcMeta?.promptPrefix as string) ?? '';
          promptToSend = promptPrefix + body.content;

          saveUserContextImages(workDir, sessionId, userMsgId, reusedImages, undefined);

          const existingMeta = body.userMetadata ?? {};
          const srcSentImages = srcMeta?.sentImages;
          const updatedMeta = {
            ...existingMeta,
            promptPrefix,
            ...(srcSentImages ? { sentImages: srcSentImages } : {}),
          };
          updateMessage(workDir, sessionId, userMsgId, (msg) => ({
            ...msg,
            metadata: updatedMeta as Record<string, unknown>,
            requestConfig: sourceMsg.requestConfig,
            hasContextPreview: sourceMsg.hasContextPreview,
          }));

          if (sourceMsg.hasContextPreview) {
            const srcPreview = resolveContextPreviewPath(workDir, sessionId, sourceMsg.id);
            if (srcPreview) {
              const destCtxDir = getContextDir(workDir, sessionId, userMsgId);
              const destPreview = path.join(destCtxDir, 'preview.jpg');
              try { fs.copyFileSync(srcPreview, destPreview); } catch {}
            }
          }

          console.log(`[Chat] Reused ${reusedImages.length} context image(s) from ${body.reuseContextFrom.slice(0, 8)}`);
        }
      }
    } else if (body.imageContext) {
      const wantHighlight = !!body.imageContext.selection && !!body.imageContext.fullImage;
      const { images: builtImages, promptPrefix } = await buildImagesFromContext(
        body.imageContext,
        wantHighlight,
      );
      if (builtImages.length > 0) {
        contextImages = builtImages;
        promptToSend = promptPrefix + body.content;
        console.log(`[Chat] ImageContext: ${builtImages.length} image(s), prompt prefix ${promptPrefix.length} chars`);

        saveUserContextImages(workDir, sessionId, userMsgId, builtImages, body.previewImageData);

        const existingMeta = body.userMetadata ?? {};
        const updatedMeta = { ...existingMeta, promptPrefix };
        updateMessage(workDir, sessionId, userMsgId, (msg) => ({
          ...msg,
          metadata: updatedMeta as Record<string, unknown>,
        }));
      }
    }

    if (useStreaming) {
      // ═══ STREAMING PATH (SSE) ═══
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      saveAssistantMessagePlaceholder(workDir, sessionId, assistantMsgId, userMsgId);

      const sendSSE = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const results: GenerationResult[] = [];
      let accumulatedText = '';
      let accumulatedThinking = '';
      let errorSentViaCallback = false;

      try {
        const adapterResponse = await callModelStream(body.modelRef, { prompt: promptToSend, images: contextImages, history, previousResponseId, imageSize: body.imageSize }, {
          onThinking: (text) => {
            accumulatedThinking += text;
            sendSSE('thinking_delta', { text });
          },
          onText: (text) => {
            accumulatedText += text;
            sendSSE('text_delta', { text });
          },
          onImage: async (image) => {
            const ts = Date.now();
            const { result } = await persistImage(
              image, workDir, sessionId, assistantMsgId, body.modelRef,
              accumulatedText, body.content, 0, ts,
            );
            results.push(result);
            sendSSE('image_result', { result });
          },
          onError: (error) => {
            errorSentViaCallback = true;
            sendSSE('error', { error });
          },
        });

        for (const r of results) {
          r.elapsedMs = adapterResponse.elapsedMs;
        }

        const afterCall = Date.now();
        const assistantText = adapterResponse.text ?? accumulatedText ?? '';
        const assistantThinking = adapterResponse.thinking ?? accumulatedThinking ?? '';

        updateAssistantMessageContent(
          workDir, sessionId, assistantMsgId,
          assistantText, assistantThinking, afterCall,
          adapterResponse.responsePartsMeta,
          adapterResponse.providerResponseId,
        );

        if (adapterResponse.images.length > results.length) {
          for (let i = results.length; i < adapterResponse.images.length; i++) {
            const { result } = await persistImage(
              adapterResponse.images[i], workDir, sessionId, assistantMsgId,
              body.modelRef, assistantText, body.content,
              adapterResponse.elapsedMs, afterCall,
            );
            results.push(result);
            sendSSE('image_result', { result });
          }
        }

        const userMessage = getMessageAsApi(workDir, sessionId, userMsgId);
        const assistantMessage = getMessageAsApi(workDir, sessionId, assistantMsgId);

        updateSession(workDir, sessionId, { activeLeafId: assistantMsgId });
        sendSSE('done', { userMessage, assistantMessage, results });
        markDirty(docPath);
        console.log(`[Chat] Stream done: text=${assistantText.length} chars, images=${results.length}, elapsed=${adapterResponse.elapsedMs}ms`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Chat] Stream error:', msg);
        try {
          updateMessage(workDir, sessionId, assistantMsgId, (m) => ({
            ...m,
            content: msg,
            metadata: { ...(m.metadata ?? {}), isError: true },
            timestamp: Date.now(),
          }));
          updateSession(workDir, sessionId, { activeLeafId: assistantMsgId });
          markDirty(docPath);
        } catch (saveErr) {
          console.error('[Chat] Failed to persist error message:', saveErr);
        }
        if (!errorSentViaCallback) {
          sendSSE('error', { error: msg });
        }
      }

      res.end();
    } else {
      // ═══ NON-STREAMING PATH (JSON) ═══
      const adapterResponse = await callModel(body.modelRef, { prompt: promptToSend, images: contextImages, history, previousResponseId, imageSize: body.imageSize });

      const afterCall = Date.now();
      const assistantText = adapterResponse.text ?? '';
      const assistantThinking = adapterResponse.thinking ?? '';

      console.log(`[Chat] Adapter returned: text=${assistantText.length} chars, thinking=${assistantThinking.length} chars, images=${adapterResponse.images.length}, elapsed=${adapterResponse.elapsedMs}ms`);

      const resultDatas: ResultData[] = [];
      const results: GenerationResult[] = [];
      for (const img of adapterResponse.images) {
        const saved = await saveGenerationImage(img.data, img.mimeType, workDir, sessionId);
        const rd: ResultData = {
          id: saved.id,
          fullFile: saved.fullFile,
          previewFile: saved.previewFile,
          thumbFile: saved.thumbFile,
          mimeType: 'image/png',
          sourceType: 'direct',
          sourceDetail: JSON.stringify({ modelRef: body.modelRef }),
          textResponse: assistantText || null,
          modelRef: body.modelRef,
          elapsedMs: adapterResponse.elapsedMs,
          width: saved.width,
          height: saved.height,
          promptUsed: body.content,
          appliedToCanvas: false,
          bookmarked: false,
          fileSize: saved.fileSize,
          createdAt: afterCall,
        };
        resultDatas.push(rd);
        results.push(resultDataToApi(rd, assistantMsgId, workDir, sessionId));
      }

      saveAssistantMessageWithId(
        workDir, sessionId, assistantMsgId, userMsgId,
        assistantText, assistantThinking, afterCall, resultDatas,
        adapterResponse.responsePartsMeta, adapterResponse.providerResponseId,
      );

      const userMessage = getMessageAsApi(workDir, sessionId, userMsgId);
      const assistantMessage = getMessageAsApi(workDir, sessionId, assistantMsgId);

      updateSession(workDir, sessionId, { activeLeafId: assistantMsgId });

      const response: ApiResponse<SendMessageResponse> = {
        success: true,
        data: { userMessage, assistantMessage, results },
      };

      markDirty(docPath);
      console.log(`[Chat] JSON response: results=${results.length}`);
      res.json(response);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Chat] Send message error:', msg);
    if (wantsStream) {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      } catch { /* response might already be closed */ }
    } else {
      res.status(500).json({ success: false, error: msg });
    }
  }
});

// ─── Regenerate (re-run model on an existing user message) ────

router.post('/api/sessions/:id/messages/:userMsgId/regenerate', async (req, res) => {
  const wantsStream = req.query.stream === 'true';
  const sessionId = req.params.id;
  const userMsgId = req.params.userMsgId;
  const docPath = req.query.docPath as string;
  const body = req.body as { modelRef?: string; imageSize?: GeminiImageSize };

  console.log(`[Chat] Regenerate session=${sessionId} userMsg=${userMsgId.slice(0, 8)} stream=${wantsStream}`);

  if (!docPath) {
    const errPayload = { success: false, error: 'docPath is required' };
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`event: error\ndata: ${JSON.stringify(errPayload)}\n\n`);
      res.end();
    } else {
      res.status(400).json(errPayload);
    }
    return;
  }

  try {
    const workDir = await ensureDocumentOpen(docPath);
    const sessionMeta = validateSession(workDir, sessionId);

    const allMessages = readMessages(workDir, sessionId);
    const userMsg = allMessages.find((m) => m.id === userMsgId);
    if (!userMsg || userMsg.role !== 'user') {
      const errPayload = { success: false, error: 'User message not found' };
      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`event: error\ndata: ${JSON.stringify(errPayload)}\n\n`);
        res.end();
      } else {
        res.status(404).json(errPayload);
      }
      return;
    }

    const modelRef = body.modelRef
      || (userMsg.requestConfig as Record<string, unknown> | undefined)?.modelRef as string
      || sessionMeta.modelRef
      || '';

    if (!modelRef) {
      const errPayload = { success: false, error: 'No model available for regeneration' };
      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`event: error\ndata: ${JSON.stringify(errPayload)}\n\n`);
        res.end();
      } else {
        res.status(400).json(errPayload);
      }
      return;
    }

    const assistantMsgId = uuidv4();

    let providerStreamEnabled = false;
    try {
      const { provider } = resolveModelRef(modelRef);
      providerStreamEnabled = provider.streamEnabled;
    } catch { /* will fail later in callModel */ }

    const useStreaming = wantsStream && providerStreamEnabled;

    const historyPath = userMsg.parentId
      ? computeActivePath(allMessages, userMsg.parentId)
      : [];

    const history: ConversationTurn[] = [];
    for (const m of historyPath) {
      if (m.metadata && (m.metadata as Record<string, unknown>).isError) continue;

      const turn: ConversationTurn = { role: m.role, content: m.content };

      if (m.role === 'user') {
        const userImages = loadUserContextImages(workDir, sessionId, m);
        if (userImages.length > 0) {
          turn.images = userImages;
          const meta = m.metadata as Record<string, unknown> | undefined;
          if (meta?.promptPrefix) {
            turn.content = (meta.promptPrefix as string) + m.content;
          }
        }
      }

      if (m.role === 'assistant') {
        const images: AdapterImage[] = [];
        for (const r of m.results) {
          const previewPath = getResultFilePath(workDir, sessionId, r.id, 'preview');
          const fullPath = getResultFilePath(workDir, sessionId, r.id, 'full');
          const filePath = fs.existsSync(previewPath) ? previewPath : fullPath;
          try {
            if (fs.existsSync(filePath)) {
              const buf = fs.readFileSync(filePath);
              images.push({
                data: buf.toString('base64'),
                mimeType: filePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
              });
            }
          } catch (e) {
            console.warn(`[Chat] Regen: failed to read history image for result ${r.id}:`, e);
          }
        }
        if (images.length > 0) turn.images = images;
        if (m.responsePartsMeta) {
          turn.responsePartsMeta = m.responsePartsMeta as ResponsePartMeta[];
        }
      }

      history.push(turn);
    }

    const contextImages = loadUserContextImages(workDir, sessionId, userMsg);
    let promptToSend = userMsg.content;
    const userMeta = userMsg.metadata as Record<string, unknown> | undefined;
    if (userMeta?.promptPrefix) {
      promptToSend = (userMeta.promptPrefix as string) + userMsg.content;
    }

    if (useStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      saveAssistantMessagePlaceholder(workDir, sessionId, assistantMsgId, userMsgId);

      const sendSSE = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const results: GenerationResult[] = [];
      let accumulatedText = '';
      let accumulatedThinking = '';
      let errorSentViaCallback = false;

      try {
        const adapterResponse = await callModelStream(
          modelRef,
          {
            prompt: promptToSend,
            images: contextImages.length > 0 ? contextImages : undefined,
            history,
            imageSize: body.imageSize,
          },
          {
            onThinking: (text) => { accumulatedThinking += text; sendSSE('thinking_delta', { text }); },
            onText: (text) => { accumulatedText += text; sendSSE('text_delta', { text }); },
            onImage: async (image) => {
              const ts = Date.now();
              const { result } = await persistImage(
                image, workDir, sessionId, assistantMsgId, modelRef,
                accumulatedText, userMsg.content, 0, ts,
              );
              results.push(result);
              sendSSE('image_result', { result });
            },
            onError: (error) => { errorSentViaCallback = true; sendSSE('error', { error }); },
          },
        );

        for (const r of results) r.elapsedMs = adapterResponse.elapsedMs;

        const afterCall = Date.now();
        const assistantText = adapterResponse.text ?? accumulatedText ?? '';
        const assistantThinking = adapterResponse.thinking ?? accumulatedThinking ?? '';

        updateAssistantMessageContent(
          workDir, sessionId, assistantMsgId,
          assistantText, assistantThinking, afterCall,
          adapterResponse.responsePartsMeta,
          adapterResponse.providerResponseId,
        );

        if (adapterResponse.images.length > results.length) {
          for (let i = results.length; i < adapterResponse.images.length; i++) {
            const { result } = await persistImage(
              adapterResponse.images[i], workDir, sessionId, assistantMsgId,
              modelRef, assistantText, userMsg.content,
              adapterResponse.elapsedMs, afterCall,
            );
            results.push(result);
            sendSSE('image_result', { result });
          }
        }

        const userMessage = getMessageAsApi(workDir, sessionId, userMsgId);
        const assistantMessage = getMessageAsApi(workDir, sessionId, assistantMsgId);
        updateSession(workDir, sessionId, { activeLeafId: assistantMsgId });
        sendSSE('done', { userMessage, assistantMessage, results });
        markDirty(docPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Chat] Regen stream error:', msg);
        try {
          updateMessage(workDir, sessionId, assistantMsgId, (m) => ({
            ...m,
            content: msg,
            metadata: { ...(m.metadata ?? {}), isError: true },
            timestamp: Date.now(),
          }));
          updateSession(workDir, sessionId, { activeLeafId: assistantMsgId });
          markDirty(docPath);
        } catch (saveErr) {
          console.error('[Chat] Failed to persist regen error message:', saveErr);
        }
        if (!errorSentViaCallback) sendSSE('error', { error: msg });
      }

      res.end();
    } else {
      const adapterResponse = await callModel(
        modelRef,
        {
          prompt: promptToSend,
          images: contextImages.length > 0 ? contextImages : undefined,
          history,
          imageSize: body.imageSize,
        },
      );

      const afterCall = Date.now();
      const assistantText = adapterResponse.text ?? '';
      const assistantThinking = adapterResponse.thinking ?? '';

      const resultDatas: ResultData[] = [];
      const results: GenerationResult[] = [];
      for (const img of adapterResponse.images) {
        const saved = await saveGenerationImage(img.data, img.mimeType, workDir, sessionId);
        const rd: ResultData = {
          id: saved.id,
          fullFile: saved.fullFile,
          previewFile: saved.previewFile,
          thumbFile: saved.thumbFile,
          mimeType: 'image/png',
          sourceType: 'direct',
          sourceDetail: JSON.stringify({ modelRef }),
          textResponse: assistantText || null,
          modelRef,
          elapsedMs: adapterResponse.elapsedMs,
          width: saved.width,
          height: saved.height,
          promptUsed: userMsg.content,
          appliedToCanvas: false,
          bookmarked: false,
          fileSize: saved.fileSize,
          createdAt: afterCall,
        };
        resultDatas.push(rd);
        results.push(resultDataToApi(rd, assistantMsgId, workDir, sessionId));
      }

      saveAssistantMessageWithId(
        workDir, sessionId, assistantMsgId, userMsgId,
        assistantText, assistantThinking, afterCall, resultDatas,
        adapterResponse.responsePartsMeta, adapterResponse.providerResponseId,
      );

      const userMessage = getMessageAsApi(workDir, sessionId, userMsgId);
      const assistantMessage = getMessageAsApi(workDir, sessionId, assistantMsgId);

      updateSession(workDir, sessionId, { activeLeafId: assistantMsgId });
      markDirty(docPath);
      res.json({
        success: true,
        data: { userMessage, assistantMessage, results } as SendMessageResponse,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Chat] Regenerate error:', msg);
    if (wantsStream) {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      } catch { /* response might already be closed */ }
    } else {
      res.status(500).json({ success: false, error: msg });
    }
  }
});

// ─── Context preview ──────────────────────────────────

router.get('/api/messages/:id/context-preview', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    const sessionId = req.query.sessionId as string;

    if (!docPath || !sessionId) {
      res.status(400).json({ success: false, error: 'docPath and sessionId query params required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const previewPath = resolveContextPreviewPath(workDir, sessionId, req.params.id);

    if (!previewPath) {
      res.status(404).json({ success: false, error: 'Context preview not found' });
      return;
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(previewPath).pipe(res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/api/messages/:id/context-images/:filename', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    const sessionId = req.query.sessionId as string;

    if (!docPath || !sessionId) {
      res.status(400).json({ success: false, error: 'docPath and sessionId query params required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const imagePath = resolveContextImagePath(workDir, sessionId, req.params.id, req.params.filename);

    if (!imagePath) {
      res.status(404).json({ success: false, error: 'Context image not found' });
      return;
    }

    const ext = path.extname(imagePath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(imagePath).pipe(res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Delete message branch ──────────────────────────────
import { findDefaultLeaf } from '@ai-retouch/shared';

router.delete('/api/sessions/:id/messages/:msgId', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    if (!docPath) { res.status(400).json({ success: false, error: 'docPath required' }); return; }

    const workDir = await ensureDocumentOpen(docPath);
    const sessionId = req.params.id;
    const msgId = req.params.msgId;

    const messages = readMessages(workDir, sessionId);
    const target = messages.find((m) => m.id === msgId);
    if (!target) { res.status(404).json({ success: false, error: 'Message not found' }); return; }

    const deletedIds = deleteMessageSubtree(workDir, sessionId, msgId);

    const session = getSession(workDir, sessionId);
    let newActiveLeaf = session?.activeLeafId ?? null;

    if (newActiveLeaf && deletedIds.includes(newActiveLeaf)) {
      const remaining = readMessages(workDir, sessionId);
      if (remaining.length === 0) {
        newActiveLeaf = null;
      } else if (target.parentId) {
        const parent = remaining.find((m) => m.id === target.parentId);
        if (parent && parent.childIds.length > 0) {
          const lastSiblingId = parent.childIds[parent.childIds.length - 1];
          newActiveLeaf = findDefaultLeaf(remaining, lastSiblingId);
        } else {
          newActiveLeaf = target.parentId;
        }
      } else {
        const roots = remaining.filter((m) => m.parentId === null);
        if (roots.length > 0) {
          newActiveLeaf = findDefaultLeaf(remaining, roots[roots.length - 1].id);
        } else {
          newActiveLeaf = null;
        }
      }
      updateSession(workDir, sessionId, { activeLeafId: newActiveLeaf });
    }

    markDirty(docPath);
    res.json({
      success: true,
      data: { deletedIds, activeLeafId: newActiveLeaf },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Chat] Delete message error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
