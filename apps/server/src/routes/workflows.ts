import { Router, type Request, type Response } from 'express';
import sharp from 'sharp';
import {
  fetchObjectInfo,
  invalidateObjectInfoCache,
  fetchRemoteWorkflow,
  queuePrompt,
  uploadImage,
  pollPromptResult,
} from '../services/comfyui.js';
import { parseExposedParams, findImageInputNodes, findOutputNodes, parseAllNodes, convertUIToAPI } from '../services/workflow-parser.js';
import { getSetting, putSetting } from '../stores/config-store.js';

const router = Router();

// ─── Exposed state helpers ──────────────────────────────

function getExposedNodeIds(workflowPath: string): string[] {
  return getSetting<string[]>(`comfyui_exposed:${workflowPath}`) ?? [];
}

function setExposedNodeIds(workflowPath: string, nodeIds: string[]): void {
  putSetting(`comfyui_exposed:${workflowPath}`, nodeIds);
}

function getNodeOrder(workflowPath: string): string[] {
  return getSetting<string[]>(`comfyui_order:${workflowPath}`) ?? [];
}

function setNodeOrder(workflowPath: string, order: string[]): void {
  putSetting(`comfyui_order:${workflowPath}`, order);
}

// ─── Parse a remote workflow (fetch from ComfyUI + extract exposed params) ─

router.get('/api/comfyui/workflows/parse/:path(*)', async (req: Request, res: Response) => {
  try {
    const filePath = req.params.path as string;
    console.log(`[Workflows] Parse request for: "${filePath}"`);
    const workflowJson = await fetchRemoteWorkflow(filePath);
    const isUIFormat = Array.isArray((workflowJson as any).nodes);
    console.log(`[Workflows] Format: ${isUIFormat ? 'UI' : 'API'}, keys: ${Object.keys(workflowJson).slice(0, 8).join(', ')}`);

    let objectInfo: Record<string, unknown> = {};
    try { objectInfo = await fetchObjectInfo(); } catch { /* proceed without */ }

    const exposedParams = parseExposedParams(workflowJson, objectInfo);
    const imageInputNodes = findImageInputNodes(workflowJson);
    const outputNodes = findOutputNodes(workflowJson);
    const allNodes = parseAllNodes(workflowJson, objectInfo);

    const savedExposedIds = getExposedNodeIds(filePath);
    const hasLocalExposed = savedExposedIds.length > 0;

    let exposedNodeIds: string[];
    if (hasLocalExposed) {
      exposedNodeIds = savedExposedIds;
    } else {
      exposedNodeIds = allNodes.filter(n => n.hasExposedTag).map(n => n.nodeId);
      if (exposedNodeIds.length > 0) {
        setExposedNodeIds(filePath, exposedNodeIds);
      }
    }

    const nodeOrder = getNodeOrder(filePath);

    res.json({
      success: true,
      data: { exposedParams, imageInputNodes, outputNodes, allNodes, exposedNodeIds, nodeOrder },
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to parse workflow',
    });
  }
});

// ─── Get exposed node IDs for a workflow ─

router.get('/api/comfyui/workflows/exposed/:path(*)', async (req: Request, res: Response) => {
  const filePath = req.params.path as string;
  res.json({ success: true, data: { nodeIds: getExposedNodeIds(filePath) } });
});

// ─── Set exposed node IDs for a workflow ─

router.put('/api/comfyui/workflows/exposed/:path(*)', async (req: Request, res: Response) => {
  const filePath = req.params.path as string;
  const { nodeIds } = req.body as { nodeIds: string[] };
  if (!Array.isArray(nodeIds)) {
    res.status(400).json({ success: false, error: 'nodeIds must be an array' });
    return;
  }
  setExposedNodeIds(filePath, nodeIds);
  res.json({ success: true });
});

// ─── Get node order for a workflow ─

router.get('/api/comfyui/workflows/order/:path(*)', async (req: Request, res: Response) => {
  const filePath = req.params.path as string;
  res.json({ success: true, data: { order: getNodeOrder(filePath) } });
});

// ─── Set node order for a workflow ─

router.put('/api/comfyui/workflows/order/:path(*)', async (req: Request, res: Response) => {
  const filePath = req.params.path as string;
  const { order } = req.body as { order: string[] };
  if (!Array.isArray(order)) {
    res.status(400).json({ success: false, error: 'order must be an array' });
    return;
  }
  setNodeOrder(filePath, order);
  res.json({ success: true });
});

// ─── Analyze an inline workflow JSON (for manual file upload preview) ─

router.post('/api/comfyui/workflows/analyze', async (req: Request, res: Response) => {
  try {
    const { workflowJson } = req.body as { workflowJson: Record<string, unknown> };
    if (!workflowJson) {
      res.status(400).json({ success: false, error: 'workflowJson is required' });
      return;
    }

    let objectInfo: Record<string, unknown> = {};
    try { objectInfo = await fetchObjectInfo(); } catch { /* proceed without */ }

    const exposedParams = parseExposedParams(workflowJson, objectInfo);
    const imageInputNodes = findImageInputNodes(workflowJson);
    const outputNodes = findOutputNodes(workflowJson);

    res.json({
      success: true,
      data: { exposedParams, imageInputNodes, outputNodes },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to analyze workflow',
    });
  }
});

// ─── Execute: fetch workflow from ComfyUI, apply overrides, queue ─

router.post('/api/comfyui/workflows/execute', async (req: Request, res: Response) => {
  const t0 = Date.now();
  const timings: string[] = [];
  function lap(label: string) {
    const elapsed = Date.now() - t0;
    timings.push(`${label}: ${elapsed}ms`);
    console.log(`[Workflows] ⏱ ${label} (+${elapsed}ms total)`);
  }

  try {
    const { workflowPath, workflowJson: inlineJson, paramOverrides, inputImages } = req.body as {
      workflowPath?: string;
      workflowJson?: Record<string, unknown>;
      paramOverrides?: Record<string, unknown>;
      inputImages?: Array<{
        nodeId: string;
        imageData: string;
        filename?: string;
        rawFloat32?: { width: number; height: number; channels: number };
      }>;
    };

    if (inputImages) {
      const totalB64Len = inputImages.reduce((s, i) => s + (i.imageData?.length ?? 0), 0);
      console.log(`[Workflows] Execute request: ${inputImages.length} image(s), total base64 size: ${(totalB64Len / 1024 / 1024).toFixed(1)}MB`);
    }

    let sourceJson: Record<string, unknown>;

    if (workflowPath) {
      sourceJson = await fetchRemoteWorkflow(workflowPath);
      lap('fetchRemoteWorkflow');
    } else if (inlineJson) {
      sourceJson = inlineJson;
      lap('inlineWorkflow (no fetch)');
    } else {
      res.status(400).json({ success: false, error: 'workflowPath or workflowJson is required' });
      return;
    }

    const isUI = Array.isArray((sourceJson as any).nodes);
    let prompt: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;

    if (isUI) {
      let objectInfo: Record<string, unknown> = {};
      let objectInfoStatus = 'empty';
      try {
        objectInfo = await fetchObjectInfo();
        const keyCount = Object.keys(objectInfo).length;
        objectInfoStatus = `ok (${keyCount} node types)`;
      } catch (err) {
        objectInfoStatus = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
        console.warn('[Workflows] ⚠ fetchObjectInfo failed, converting WITHOUT node definitions — widget values will be LOST');
      }
      lap(`fetchObjectInfo [${objectInfoStatus}]`);

      prompt = convertUIToAPI(sourceJson as any, objectInfo);
      lap(`convertUIToAPI (${Object.keys(prompt).length} nodes)`);

      if (objectInfoStatus.startsWith('FAILED') || objectInfoStatus === 'empty') {
        console.warn('[Workflows] ⚠ Prompt was converted without objectInfo — checkpoint/sampler/seed values may be missing, potentially causing model reload in ComfyUI');
      }
    } else {
      prompt = JSON.parse(JSON.stringify(sourceJson));
      lap('cloneAPIFormat');
    }

    if (paramOverrides) {
      for (const [compoundKey, value] of Object.entries(paramOverrides)) {
        const colonIdx = compoundKey.indexOf(':');
        if (colonIdx === -1) continue;
        const nodeId = compoundKey.slice(0, colonIdx);
        const paramName = compoundKey.slice(colonIdx + 1);

        if (prompt[nodeId]?.inputs) {
          if (typeof value === 'string' && value.startsWith('__ps_')) continue;
          prompt[nodeId].inputs[paramName] = value;
        }
      }
      lap('applyParamOverrides');
    }

    if (inputImages) {
      const uploadTasks = await Promise.all(inputImages.map(async (img, i) => {
        const base64Data = img.imageData.replace(/^data:image\/\w+;base64,/, '');
        const rawBuf = Buffer.from(base64Data, 'base64');

        let buffer: Buffer;
        let fname: string;
        let contentType = 'image/png';

        if (img.rawFloat32) {
          const { width, height, channels } = img.rawFloat32;
          const ch = channels as 1 | 2 | 3 | 4;
          buffer = await sharp(rawBuf, {
            raw: { width, height, channels: ch, premultiplied: false },
          }).tiff({ compression: 'deflate' }).toBuffer();
          fname = (img.filename ?? `ps_input_${img.nodeId}_${Date.now()}`).replace(/\.\w+$/, '') + '.tiff';
          contentType = 'image/tiff';
          console.log(`[Workflows] Converted raw Float32 (${width}x${height}x${channels}) to TIFF: ${(buffer.length / 1024).toFixed(0)}KB`);
        } else {
          buffer = rawBuf;
          fname = img.filename ?? `ps_input_${img.nodeId}_${Date.now()}.png`;
        }

        console.log(`[Workflows] Uploading image ${i + 1}/${inputImages.length}: ${fname} (${(buffer.length / 1024).toFixed(0)}KB)`);
        return { nodeId: img.nodeId, buffer, fname, contentType };
      }));

      const uploadResults = await Promise.all(
        uploadTasks.map(({ buffer, fname, contentType }) => uploadImage(buffer, fname, '', true, contentType)),
      );

      for (let i = 0; i < uploadTasks.length; i++) {
        const { nodeId } = uploadTasks[i];
        if (prompt[nodeId]?.inputs) {
          prompt[nodeId].inputs.image = uploadResults[i].name;
        }
      }
      lap(`uploadImages (${inputImages.length} parallel, total ${(uploadTasks.reduce((s, t) => s + t.buffer.length, 0) / 1024).toFixed(0)}KB)`);
    }

    const nodeSample = Object.entries(prompt).slice(0, 3).map(([id, n]) => ({
      id,
      class_type: (n as any).class_type,
      inputKeys: Object.keys((n as any).inputs),
      inputSample: Object.fromEntries(
        Object.entries((n as any).inputs).slice(0, 4).map(([k, v]) => [k, Array.isArray(v) ? `[link→${v[0]}]` : typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '...' : v]),
      ),
    }));
    console.log('[Workflows] Submitting prompt, node sample:', JSON.stringify(nodeSample, null, 0));

    const result = await queuePrompt(prompt);
    lap('queuePrompt');

    console.log(`[Workflows] ✅ Prompt queued: ${result.prompt_id} — Total: ${Date.now() - t0}ms [${timings.join(' | ')}]`);
    res.json({ success: true, data: { promptId: result.prompt_id } });
  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error(`[Workflows] ❌ Execute failed after ${totalMs}ms [${timings.join(' | ')}]:`, err instanceof Error ? err.message : err);
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to execute workflow',
    });
  }
});

// ─── Poll for prompt result ─

router.get('/api/comfyui/workflows/result/:promptId', async (req: Request, res: Response) => {
  try {
    const promptId = req.params.promptId as string;
    const rawTimeout = req.query.timeout;
    const timeoutMs = rawTimeout ? Number(String(rawTimeout)) : undefined;
    const result = await pollPromptResult(promptId, timeoutMs);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to poll prompt result';
    if (message.includes('Timeout')) {
      res.status(408).json({ success: false, error: message });
    } else {
      res.status(502).json({ success: false, error: message });
    }
  }
});

export default router;
