import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getComfyUIStatus,
  testConnection,
  fetchObjectInfo,
  invalidateObjectInfoCache,
  getHistory,
  getQueue,
  uploadImage,
  viewImage,
  queuePrompt,
  cancelTask,
  interruptExecution,
  listRemoteWorkflows,
  fetchRemoteWorkflow,
  saveToUserdata,
  getActiveTasks,
  getRecentTasks,
  getTaskState,
  getClientId,
} from '../services/comfyui.js';
import {
  ensureDocumentOpen,
  listSessions,
  createSession,
  appendMessage,
  markDirty,
  type MessageData,
  type ResultData,
} from '../stores/document-store.js';
import { saveGenerationImage } from '../services/image.js';
import { resultDataToApi } from '../services/chat.js';

const router = Router();

// ─── Connection status ────────────────────────────────

router.get('/api/comfyui/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: getComfyUIStatus() });
});

router.post('/api/comfyui/test', async (_req: Request, res: Response) => {
  try {
    const status = await testConnection();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection test failed',
    });
  }
});

// ─── Object info (node type schemas) ─────────────────

router.get('/api/comfyui/object-info', async (_req: Request, res: Response) => {
  try {
    const info = await fetchObjectInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch object info',
    });
  }
});

router.post('/api/comfyui/object-info/refresh', async (_req: Request, res: Response) => {
  try {
    invalidateObjectInfoCache();
    const info = await fetchObjectInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to refresh object info',
    });
  }
});

// ─── Queue & History ──────────────────────────────────

router.get('/api/comfyui/queue', async (_req: Request, res: Response) => {
  try {
    const queue = await getQueue();
    res.json({ success: true, data: queue });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch queue',
    });
  }
});

router.get('/api/comfyui/history', async (req: Request, res: Response) => {
  try {
    const maxItems = parseInt(req.query.maxItems as string) || 20;
    const history = await getHistory(maxItems);
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch history',
    });
  }
});

// ─── Queue prompt ─────────────────────────────────────

router.post('/api/comfyui/prompt', async (req: Request, res: Response) => {
  try {
    const { prompt, clientId } = req.body as {
      prompt: Record<string, unknown>;
      clientId?: string;
    };
    if (!prompt) {
      res.status(400).json({ success: false, error: 'prompt is required' });
      return;
    }
    const result = await queuePrompt(prompt, clientId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to queue prompt',
    });
  }
});

router.post('/api/comfyui/cancel', async (req: Request, res: Response) => {
  try {
    const { promptId } = req.body as { promptId?: string };
    if (promptId) {
      await cancelTask(promptId);
    } else {
      await interruptExecution();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to cancel',
    });
  }
});

// ─── Image transfer ───────────────────────────────────

router.post('/api/comfyui/upload-image', async (req: Request, res: Response) => {
  try {
    const { imageData, filename, subfolder, overwrite, rawFloat32 } = req.body as {
      imageData: string;
      filename?: string;
      subfolder?: string;
      overwrite?: boolean;
      rawFloat32?: { width: number; height: number; channels: number };
    };
    if (!imageData) {
      res.status(400).json({ success: false, error: 'imageData is required' });
      return;
    }

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const rawBuf = Buffer.from(base64Data, 'base64');

    let buffer: Buffer;
    let fname: string;
    let contentType = 'image/png';

    if (rawFloat32) {
      const sharp = (await import('sharp')).default;
      const { width, height, channels } = rawFloat32;
      const ch = channels as 1 | 2 | 3 | 4;
      buffer = await sharp(rawBuf, {
        raw: { width, height, channels: ch, premultiplied: false },
      }).tiff({ compression: 'deflate' }).toBuffer();
      fname = (filename ?? `ps_upload_${Date.now()}`).replace(/\.\w+$/, '') + '.tiff';
      contentType = 'image/tiff';
    } else {
      buffer = rawBuf;
      fname = filename ?? `ps_upload_${Date.now()}.png`;
    }

    const result = await uploadImage(buffer, fname, subfolder, overwrite, contentType);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to upload image',
    });
  }
});

router.get('/api/comfyui/view/:filename', async (req: Request, res: Response) => {
  try {
    const filename = req.params.filename as string;
    const subfolder = (req.query.subfolder as string) ?? '';
    const type = (req.query.type as string) ?? 'output';

    const { buffer, contentType } = await viewImage(filename, subfolder, type);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to view image',
    });
  }
});

// SSE events route removed — ComfyUI events now broadcast via WebSocket bridge

// ─── Tasks ───────────────────────────────────────────

router.get('/api/comfyui/tasks', (_req: Request, res: Response) => {
  const active = getActiveTasks();
  const running = active.find((t) => t.status === 'running') ?? null;
  const queued = active.filter((t) => t.status === 'queued');
  const recent = getRecentTasks(20);

  res.json({
    success: true,
    data: { active: running, queued, recent },
  });
});

router.get('/api/comfyui/tasks/:promptId', (req: Request, res: Response) => {
  const task = getTaskState(req.params.promptId as string);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }
  res.json({ success: true, data: task });
});

router.get('/api/comfyui/client-id', (_req: Request, res: Response) => {
  res.json({ success: true, data: { clientId: getClientId() } });
});

// ─── Remote workflow browsing ─────────────────────────

router.get('/api/comfyui/remote-workflows', async (_req: Request, res: Response) => {
  try {
    const files = await listRemoteWorkflows();
    res.json({ success: true, data: files });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list remote workflows',
    });
  }
});

router.get('/api/comfyui/remote-workflows/:path', async (req: Request, res: Response) => {
  try {
    const filePath = req.params.path as string;
    const json = await fetchRemoteWorkflow(filePath);
    res.json({ success: true, data: json });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch remote workflow',
    });
  }
});

// ─── Userdata save proxy ─────────────────────────────

router.post('/api/comfyui/userdata/save', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body as { path: string; content: string };
    if (!filePath || content == null) {
      res.status(400).json({ success: false, error: 'path and content are required' });
      return;
    }
    await saveToUserdata(filePath, content);
    res.json({ success: true, data: { path: filePath } });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save to ComfyUI userdata',
    });
  }
});

// ─── Send-only: upload images → modify workflow → save to userdata ─

router.post('/api/comfyui/workflows/send-only', async (req: Request, res: Response) => {
  try {
    const { workflowPath, imageNodeMappings } = req.body as {
      workflowPath: string;
      imageNodeMappings: Array<{ nodeId: string; uploadedFilename: string }>;
    };

    if (!workflowPath) {
      res.status(400).json({ success: false, error: 'workflowPath is required' });
      return;
    }

    const workflowJson = await fetchRemoteWorkflow(workflowPath) as any;
    const isUI = Array.isArray(workflowJson.nodes);

    if (imageNodeMappings?.length) {
      if (isUI) {
        for (const mapping of imageNodeMappings) {
          const node = workflowJson.nodes.find(
            (n: any) => String(n.id) === String(mapping.nodeId),
          );
          if (node?.widgets_values) {
            node.widgets_values[0] = mapping.uploadedFilename;
          }
        }
      } else {
        for (const mapping of imageNodeMappings) {
          if (workflowJson[mapping.nodeId]?.inputs) {
            workflowJson[mapping.nodeId].inputs.image = mapping.uploadedFilename;
          }
        }
      }
    }

    const savePath = 'workflows/_photoshop_bridge_temp.json';
    await saveToUserdata(savePath, JSON.stringify(workflowJson));

    console.log(`[ComfyUI] Send-only: saved modified workflow with ${imageNodeMappings?.length ?? 0} image(s)`);
    res.json({ success: true, data: { savedPath: savePath } });
  } catch (err) {
    console.error('[ComfyUI] Send-only failed:', err);
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to prepare and save workflow',
    });
  }
});

// ─── Result library integration ──────────────────────

async function getOrCreateComfyUISession(workDir: string): Promise<string> {
  const sessions = listSessions(workDir, 'comfyui');
  if (sessions.length > 0) return sessions[0].id;
  const session = createSession(workDir, { mode: 'comfyui', title: 'ComfyUI Results' });
  return session.id;
}

router.post('/api/comfyui/results/save', async (req: Request, res: Response) => {
  try {
    const { docPath, filename, subfolder, type, workflowName, workflowPath, promptId } = req.body as {
      docPath: string;
      filename: string;
      subfolder?: string;
      type?: string;
      workflowName?: string;
      workflowPath?: string;
      promptId?: string;
    };

    if (!docPath || !filename) {
      res.status(400).json({ success: false, error: 'docPath and filename are required' });
      return;
    }

    const { buffer, contentType } = await viewImage(filename, subfolder ?? '', type ?? 'output');

    const workDir = await ensureDocumentOpen(docPath);
    const sessionId = await getOrCreateComfyUISession(workDir);

    const saved = await saveGenerationImage(buffer, contentType, workDir, sessionId);

    const resultData: ResultData = {
      id: saved.id,
      fullFile: saved.fullFile,
      previewFile: saved.previewFile,
      thumbFile: saved.thumbFile,
      mimeType: 'image/png',
      sourceType: 'comfyui',
      sourceDetail: JSON.stringify({
        workflowName: workflowName ?? null,
        workflowPath: workflowPath ?? null,
        promptId: promptId ?? null,
        originalFilename: filename,
      }),
      textResponse: null,
      modelRef: null,
      elapsedMs: null,
      width: saved.width,
      height: saved.height,
      promptUsed: null,
      appliedToCanvas: false,
      bookmarked: false,
      fileSize: saved.fileSize,
      createdAt: Date.now(),
    };

    const msgId = uuidv4();
    const message: MessageData = {
      id: msgId,
      parentId: null,
      childIds: [],
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      results: [resultData],
    };
    appendMessage(workDir, sessionId, message);
    markDirty(docPath);

    const result = resultDataToApi(resultData, msgId, workDir, sessionId);

    console.log(`[ComfyUI] Saved result ${saved.id} (${saved.width}x${saved.height}) from ${filename}`);

    res.json({
      success: true,
      data: {
        resultId: saved.id,
        thumbnailBase64: saved.thumbnailBuffer.toString('base64'),
        result,
      },
    });
  } catch (err) {
    console.error('[ComfyUI] Failed to save result:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save ComfyUI result',
    });
  }
});

router.get('/api/comfyui/history/recent', async (req: Request, res: Response) => {
  try {
    const maxItems = parseInt(req.query.maxItems as string) || 20;
    const history = await getHistory(maxItems) as Record<string, any>;

    const images: Array<{
      promptId: string;
      filename: string;
      subfolder: string;
      type: string;
      thumbnailUrl: string;
      timestamp: number;
    }> = [];

    for (const [promptId, entry] of Object.entries<any>(history)) {
      if (!entry?.outputs) continue;

      let timestamp = 0;
      if (entry.status?.messages && Array.isArray(entry.status.messages)) {
        const startMsg = entry.status.messages.find(
          (m: unknown[]) => m[0] === 'execution_start',
        );
        if (startMsg?.[1]?.timestamp) timestamp = startMsg[1].timestamp;
      }

      for (const [, nodeOutput] of Object.entries<any>(entry.outputs)) {
        if (!nodeOutput?.images || !Array.isArray(nodeOutput.images)) continue;
        for (const img of nodeOutput.images) {
          const params = new URLSearchParams({
            subfolder: img.subfolder ?? '',
            type: img.type ?? 'output',
          });
          images.push({
            promptId,
            filename: img.filename,
            subfolder: img.subfolder ?? '',
            type: img.type ?? 'output',
            thumbnailUrl: `/api/comfyui/view/${encodeURIComponent(img.filename)}?${params}`,
            timestamp,
          });
        }
      }
    }

    res.json({ success: true, data: images });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch recent history',
    });
  }
});

export default router;
