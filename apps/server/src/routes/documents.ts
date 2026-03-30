import { Router } from 'express';
import type { ApiResponse } from '@ai-retouch/shared';
import {
  openDocument,
  saveDocument,
  closeDocument,
} from '../stores/document-store.js';

const router = Router();

// POST /api/documents/open
router.post('/api/documents/open', async (req, res) => {
  try {
    const { psdPath } = req.body as { psdPath: string };
    if (!psdPath) {
      res.status(400).json({ success: false, error: 'psdPath is required' });
      return;
    }

    const workDir = await openDocument(psdPath);
    const data: ApiResponse<{ workDir: string }> = { success: true, data: { workDir } };
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/documents/save
router.post('/api/documents/save', async (req, res) => {
  try {
    const { psdPath } = req.body as { psdPath: string };
    if (!psdPath) {
      res.status(400).json({ success: false, error: 'psdPath is required' });
      return;
    }

    await saveDocument(psdPath);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/documents/close
router.post('/api/documents/close', async (req, res) => {
  try {
    const { psdPath } = req.body as { psdPath: string };
    if (!psdPath) {
      res.status(400).json({ success: false, error: 'psdPath is required' });
      return;
    }

    await closeDocument(psdPath);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
