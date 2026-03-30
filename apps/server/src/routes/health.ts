import { Router } from 'express';

import { HEALTH_ENDPOINT, type HealthResponse } from '@ai-retouch/shared';

const router = Router();
const startedAt = Date.now();

router.get('/', (_req, res) => {
  res.json({
    name: 'AI Retouch local server',
    phase: 'phase1',
    health: HEALTH_ENDPOINT,
  });
});

router.get(HEALTH_ENDPOINT, (_req, res) => {
  const payload: HealthResponse = {
    status: 'ok',
    service: 'ai-retouch-local-server',
    version: '0.0.1',
    environment: 'phase1',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  };
  res.json(payload);
});

router.get('/api/app-info', (_req, res) => {
  res.json({
    success: true,
    data: {
      execPath: process.execPath,
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
    },
  });
});

export default router;
