import { createServer } from 'node:http';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';

import { DEFAULT_BACKEND_PORT, DEFAULT_BACKEND_HOST } from '@ai-retouch/shared';
import { getDataDir } from './utils/paths.js';
import { initSettings } from './stores/config-store.js';
import healthRouter from './routes/health.js';
import providersRouter from './routes/providers.js';
import settingsRouter from './routes/settings.js';
import chatRouter from './routes/chat.js';
import resultsRouter from './routes/results.js';
import documentsRouter from './routes/documents.js';
import comfyuiRouter from './routes/comfyui.js';
import workflowsRouter from './routes/workflows.js';
import psBridgeRouter from './routes/ps-bridge.js';
import { closeAllDocuments, recoverStaleTempDirs } from './stores/document-store.js';
import { disconnectWebSocket, testConnection as testComfyUI } from './services/comfyui.js';
import { initBridgeWebSocket, shutdownBridge } from './services/ps-bridge.js';

export const DATA_DIR = getDataDir();

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT ?? DEFAULT_BACKEND_PORT);
const host = process.env.HOST ?? DEFAULT_BACKEND_HOST;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use(healthRouter);
app.use(providersRouter);
app.use(settingsRouter);
app.use(chatRouter);
app.use(resultsRouter);
app.use(documentsRouter);
app.use(comfyuiRouter);
app.use(workflowsRouter);
app.use(psBridgeRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

initBridgeWebSocket(server);

async function startServer(): Promise<void> {
  initSettings();
  console.log('[Config] Settings initialized');

  await recoverStaleTempDirs();
  console.log('[DocStore] Startup recovery complete');

  server.listen(port, host, () => {
    console.log(`AI Retouch local server listening at http://${host}:${port}`);
    console.log(`[Bridge] WebSocket endpoints: ws://${host}:${port}/ws/bridge, /ws/client`);

    testComfyUI()
      .then((s) => console.log(`[ComfyUI] Auto-test: ${s.state}`))
      .catch(() => console.log('[ComfyUI] Auto-test: unreachable'));
  });
}

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection (kept alive):', reason);
});

// ─── Unified graceful shutdown ───────────────────────

let isShuttingDown = false;

async function gracefulShutdown(reason: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Shutting down (${reason})...`);
  shutdownBridge();
  disconnectWebSocket();
  await closeAllDocuments();
  server.close();
  console.log('[Server] Cleanup complete, exiting.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// IPC-based shutdown (reliable on Windows, sent by Electron main process)
process.on('message', (msg: unknown) => {
  if (msg && typeof msg === 'object' && (msg as Record<string, unknown>).type === 'shutdown') {
    gracefulShutdown('IPC shutdown');
  }
});

startServer();
