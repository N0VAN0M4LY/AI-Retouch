import { Router } from 'express';

import type { ApiResponse } from '@ai-retouch/shared';

import {
  readAllSettings,
  getSetting,
  putSetting,
  deleteSetting,
} from '../stores/config-store.js';

const router = Router();

// GET /api/settings — all settings as { key: value } object
router.get('/api/settings', (_req, res) => {
  const body: ApiResponse<Record<string, unknown>> = { success: true, data: readAllSettings() };
  res.json(body);
});

// GET /api/settings/:key — single setting
router.get('/api/settings/:key', (req, res) => {
  const val = getSetting(req.params.key);

  if (val === undefined) {
    const body: ApiResponse = { success: false, error: `Setting "${req.params.key}" not found` };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse<unknown> = { success: true, data: val };
  res.json(body);
});

// PUT /api/settings/:key — upsert setting
router.put('/api/settings/:key', (req, res) => {
  const { value } = req.body;
  if (value === undefined) {
    const body: ApiResponse = { success: false, error: '"value" is required in request body' };
    res.status(400).json(body);
    return;
  }

  putSetting(req.params.key, value);

  const body: ApiResponse<{ key: string; value: unknown }> = {
    success: true,
    data: { key: req.params.key, value },
  };
  res.json(body);
});

// DELETE /api/settings/:key
router.delete('/api/settings/:key', (req, res) => {
  const ok = deleteSetting(req.params.key);

  if (!ok) {
    const body: ApiResponse = { success: false, error: `Setting "${req.params.key}" not found` };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse = { success: true };
  res.json(body);
});

export default router;
