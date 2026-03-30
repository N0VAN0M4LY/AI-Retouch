import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

import type {
  ApiResponse,
  GenerationResult,
  ResultsListResponse,
  UpdateResultRequest,
} from '@ai-retouch/shared';

import {
  ensureDocumentOpen,
  listSessions,
  readMessages,
  updateMessage,
  getResultFilePath,
  type ResultData,
} from '../stores/document-store.js';
import { resultDataToApi, findRequestConfigForMessage } from '../services/chat.js';

const router = Router();

// ─── Results list ─────────────────────────────────────

router.get('/api/results', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath query parameter is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const sessionId = req.query.sessionId as string | undefined;
    const bookmarkedOnly = req.query.bookmarked === 'true';
    const source = (req.query.source as string) || 'all';

    const allResults: Array<{ result: ResultData; messageId: string; sessionId: string; requestConfig?: import('@ai-retouch/shared').RequestConfig }> = [];

    const sessions = sessionId
      ? [{ id: sessionId }]
      : listSessions(workDir).map((s) => ({ id: s.id }));

    for (const s of sessions) {
      const messages = readMessages(workDir, s.id);
      for (const msg of messages) {
        const reqConfig = findRequestConfigForMessage(messages, msg);
        for (const r of msg.results) {
          if (bookmarkedOnly && !r.bookmarked) continue;
          if (source !== 'all' && r.sourceType !== source) continue;
          allResults.push({ result: r, messageId: msg.id, sessionId: s.id, requestConfig: reqConfig });
        }
      }
    }

    allResults.sort((a, b) => b.result.createdAt - a.result.createdAt);

    const total = allResults.length;
    const offset = (page - 1) * limit;
    const pageResults = allResults.slice(offset, offset + limit);

    const items: GenerationResult[] = pageResults.map((r) =>
      resultDataToApi(r.result, r.messageId, workDir, r.sessionId, r.requestConfig),
    );

    const data: ApiResponse<ResultsListResponse> = {
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Update result (bookmark, applied) ────────────────

router.patch('/api/results/:id', async (req, res) => {
  try {
    const body = req.body as UpdateResultRequest & { docPath?: string; sessionId?: string };
    const docPath = (req.query.docPath as string) || body.docPath;
    let sessionId = (req.query.sessionId as string) || body.sessionId;

    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const resultId = req.params.id;

    const sessionsToSearch = sessionId
      ? [sessionId]
      : listSessions(workDir).map((s) => s.id);

    let found = false;
    let updatedResult: GenerationResult | null = null;

    for (const sid of sessionsToSearch) {
      const messages = readMessages(workDir, sid);
      for (const msg of messages) {
        const idx = msg.results.findIndex((r) => r.id === resultId);
        if (idx !== -1) {
          const r = { ...msg.results[idx] };
          if (body.appliedToCanvas !== undefined) r.appliedToCanvas = body.appliedToCanvas;
          if (body.bookmarked !== undefined) r.bookmarked = body.bookmarked;

          updateMessage(workDir, sid, msg.id, (m) => {
            const results = [...m.results];
            results[idx] = r;
            return { ...m, results };
          });

          updatedResult = resultDataToApi(r, msg.id, workDir, sid);
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      res.status(404).json({ success: false, error: 'Result not found' });
      return;
    }

    res.json({ success: true, data: updatedResult });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Preview image ────────────────────────────────────

router.get('/api/results/:id/preview', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    let sessionId = req.query.sessionId as string | undefined;

    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath query param is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);

    if (!sessionId) {
      const sessions = listSessions(workDir);
      for (const s of sessions) {
        const candidate = getResultFilePath(workDir, s.id, req.params.id, 'preview');
        const candidateFull = getResultFilePath(workDir, s.id, req.params.id, 'full');
        if (fs.existsSync(candidate) || fs.existsSync(candidateFull)) {
          sessionId = s.id;
          break;
        }
      }
    }

    if (!sessionId) {
      res.status(404).json({ success: false, error: 'Result not found in any session' });
      return;
    }

    const previewPath = getResultFilePath(workDir, sessionId, req.params.id, 'preview');
    const fullPath = getResultFilePath(workDir, sessionId, req.params.id, 'full');
    const filePath = fs.existsSync(previewPath) ? previewPath : fullPath;

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: 'Preview file not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Full image ───────────────────────────────────────

router.get('/api/results/:id/full', async (req, res) => {
  try {
    const docPath = req.query.docPath as string;
    let sessionId = req.query.sessionId as string | undefined;

    if (!docPath) {
      res.status(400).json({ success: false, error: 'docPath query param is required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);

    if (!sessionId) {
      const sessions = listSessions(workDir);
      for (const s of sessions) {
        const candidate = getResultFilePath(workDir, s.id, req.params.id, 'full');
        if (fs.existsSync(candidate)) {
          sessionId = s.id;
          break;
        }
      }
    }

    if (!sessionId) {
      res.status(404).json({ success: false, error: 'Result not found in any session' });
      return;
    }

    const filePath = getResultFilePath(workDir, sessionId, req.params.id, 'full');

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: 'Full image file not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${req.params.id}${ext}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── Delete a result ──────────────────────────────────

router.delete('/api/results/:id', async (req, res) => {
  try {
    const docPath = (req.query.docPath as string) || (req.body as Record<string, unknown>)?.docPath as string;
    const sessionId = (req.query.sessionId as string) || (req.body as Record<string, unknown>)?.sessionId as string;

    if (!docPath || !sessionId) {
      res.status(400).json({ success: false, error: 'docPath and sessionId are required' });
      return;
    }

    const workDir = await ensureDocumentOpen(docPath);
    const resultId = req.params.id;

    const messages = readMessages(workDir, sessionId);
    let found = false;

    for (const msg of messages) {
      const idx = msg.results.findIndex((r) => r.id === resultId);
      if (idx !== -1) {
        for (const type of ['full', 'preview', 'thumb'] as const) {
          const fp = getResultFilePath(workDir, sessionId, resultId, type);
          try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
        }

        updateMessage(workDir, sessionId, msg.id, (m) => ({
          ...m,
          results: m.results.filter((r) => r.id !== resultId),
        }));

        found = true;
        break;
      }
    }

    if (!found) {
      res.status(404).json({ success: false, error: 'Result not found' });
      return;
    }

    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
