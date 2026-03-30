import { Router, type Request, type Response } from 'express';
import type {
  ExtractImageParams,
  PlaceResultParams,
  SmartApplyParams,
  SetSelectionParams,
} from '@ai-retouch/shared';
import { executeCommand, getBridgeStatus } from '../services/ps-bridge.js';

const router = Router();

function bridgeErrorStatus(message: string): number {
  return message.includes('not connected')
    ? 503
    : message.includes('timed out')
      ? 504
      : 500;
}

router.get('/api/ps/status', (_req: Request, res: Response) => {
  try {
    const status = getBridgeStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

router.post('/api/ps/extract-image', async (req: Request, res: Response) => {
  try {
    const body = req.body as ExtractImageParams;
    const result = await executeCommand('extractImage', body, 60000);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

router.post('/api/ps/apply-result', async (req: Request, res: Response) => {
  try {
    const body = req.body as PlaceResultParams;
    const result = await executeCommand('placeResult', body);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

router.post('/api/ps/smart-apply', async (req: Request, res: Response) => {
  try {
    const body = req.body as SmartApplyParams;
    const result = await executeCommand('smartApply', body);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

router.get('/api/ps/document', async (_req: Request, res: Response) => {
  try {
    const result = await executeCommand('getDocumentInfo', {});
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

router.get('/api/ps/selection', async (_req: Request, res: Response) => {
  try {
    const result = await executeCommand('getSelection', {});
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

router.post('/api/ps/selection', async (req: Request, res: Response) => {
  try {
    const body = req.body as SetSelectionParams;
    const result = await executeCommand('setSelection', body);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

router.get('/api/ps/layers', async (_req: Request, res: Response) => {
  try {
    const result = await executeCommand('getLayerList', {});
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(bridgeErrorStatus(message)).json({ success: false, error: message });
  }
});

export default router;
