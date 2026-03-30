import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  BridgeWSMessage,
  BridgeCommand,
  BridgeCommandResult,
  BridgeEvent,
  BridgeEventType,
  BridgeEventDataMap,
  BridgeCommandType,
  BridgeStatus,
  BridgeCommandParamMap,
  BridgeCommandResultMap,
} from '@ai-retouch/shared';
import { getComfyEventEmitter, type ComfyUIEvent } from './comfyui.js';

let wss: WebSocketServer | null = null;
let boundServer: Server | null = null;
let bridgeSocket: WebSocket | null = null;
const clientSockets = new Set<WebSocket>();

type PendingEntry = {
  resolve: (value: BridgeCommandResult) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingCommands = new Map<string, PendingEntry>();

let lastHeartbeat: number | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function isUxpBridgeOpen(): boolean {
  return bridgeSocket !== null && bridgeSocket.readyState === WebSocket.OPEN;
}

function clearBridgeHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function startBridgeHeartbeat(ws: WebSocket): void {
  clearBridgeHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const ping: BridgeWSMessage = { type: 'ping' };
      ws.send(JSON.stringify(ping));
    }
  }, 15_000);
}

function rejectAllPending(reason: Error): void {
  const snapshot = [...pendingCommands.values()];
  pendingCommands.clear();
  for (const entry of snapshot) {
    clearTimeout(entry.timer);
    entry.reject(reason);
  }
}

function parseBridgeIncoming(raw: WebSocket.RawData): unknown {
  const text = typeof raw === 'string' ? raw : raw.toString();
  return JSON.parse(text) as unknown;
}

function handleBridgeMessage(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const msg = data as { type?: string; payload?: unknown };

  if (msg.type === 'commandResult' && msg.payload && typeof msg.payload === 'object') {
    const payload = msg.payload as BridgeCommandResult;
    const id = payload.id;
    if (!id) return;
    const entry = pendingCommands.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingCommands.delete(id);
    entry.resolve(payload);
    return;
  }

  if (msg.type === 'event' && msg.payload && typeof msg.payload === 'object') {
    broadcastToClients(msg.payload as BridgeEvent);
    return;
  }

  if (msg.type === 'pong') {
    lastHeartbeat = Date.now();
  }
}

function handleBridgeConnection(ws: WebSocket): void {
  if (bridgeSocket && bridgeSocket !== ws) {
    const old = bridgeSocket;
    old.removeAllListeners();
    old.close();
    rejectAllPending(new Error('UXP bridge replaced'));
    clearBridgeHeartbeat();
    bridgeSocket = null;
  }

  bridgeSocket = ws;
  lastHeartbeat = Date.now();
  console.log('[Bridge] UXP bridge connected');

  broadcastToClients({
    event: 'bridgeReady',
    data: {},
    timestamp: Date.now(),
  });

  ws.on('message', (raw) => {
    try {
      const data = parseBridgeIncoming(raw);
      handleBridgeMessage(data);
    } catch (err) {
      console.error('[Bridge] Invalid message from UXP:', err);
    }
  });

  ws.on('close', () => {
    if (bridgeSocket === ws) {
      bridgeSocket = null;
      clearBridgeHeartbeat();
      console.log('[Bridge] UXP bridge disconnected');
      broadcastToClients({
        event: 'bridgeDisconnecting',
        data: {},
        timestamp: Date.now(),
      });
      rejectAllPending(new Error('UXP bridge disconnected'));
    }
  });

  startBridgeHeartbeat(ws);
}

function sendClientStatus(ws: WebSocket): void {
  const status = { type: 'status', payload: { uxpConnected: isUxpBridgeOpen() } };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(status));
  }
}

function handleClientConnection(ws: WebSocket): void {
  clientSockets.add(ws);
  console.log(`[Bridge] Client connected (total: ${clientSockets.size})`);

  ws.on('message', (raw) => {
    try {
      const data = parseBridgeIncoming(raw);
      if (data && typeof data === 'object' && (data as { type?: string }).type === 'pong') {
        return;
      }
    } catch {
      /* ignore */
    }
  });

  ws.on('close', () => {
    clientSockets.delete(ws);
    console.log(`[Bridge] Client disconnected (total: ${clientSockets.size})`);
  });

  sendClientStatus(ws);
}

function onHttpUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
  if (!wss) return;

  const host = request.headers.host ?? 'localhost';
  const url = request.url ?? '/';
  let pathname: string;
  try {
    pathname = new URL(url, `http://${host}`).pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname === '/ws/bridge') {
    wss.handleUpgrade(request, socket, head, handleBridgeConnection);
    return;
  }
  if (pathname === '/ws/client') {
    wss.handleUpgrade(request, socket, head, handleClientConnection);
    return;
  }
  socket.destroy();
}

export function initBridgeWebSocket(server: Server): void {
  if (wss && boundServer) {
    return;
  }
  boundServer = server;
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', onHttpUpgrade);
  startComfyUIEventForwarding();
}

export async function executeCommand<C extends BridgeCommandType>(
  command: C,
  params: BridgeCommandParamMap[C],
  timeoutMs = 30_000,
): Promise<BridgeCommandResultMap[C]> {
  if (!isUxpBridgeOpen() || !bridgeSocket) {
    throw new Error('UXP bridge not connected');
  }

  const id = randomUUID();
  const ws = bridgeSocket;

  const result = await new Promise<BridgeCommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      const entry = pendingCommands.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingCommands.delete(id);
      reject(new Error('Bridge command timed out'));
    }, timeoutMs);

    pendingCommands.set(id, {
      resolve(value) {
        clearTimeout(timer);
        pendingCommands.delete(id);
        resolve(value);
      },
      reject(reason) {
        clearTimeout(timer);
        pendingCommands.delete(id);
        reject(reason);
      },
      timer,
    });

    const payload: BridgeCommand = {
      id,
      command,
      params: params as Record<string, unknown>,
    };
    const outbound: BridgeWSMessage = { type: 'command', payload };

    try {
      ws.send(JSON.stringify(outbound));
    } catch (err) {
      const entry = pendingCommands.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        pendingCommands.delete(id);
        entry.reject(err);
      } else {
        reject(err);
      }
    }
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Command failed');
  }
  return result.data as BridgeCommandResultMap[C];
}

export function broadcastToClients(event: BridgeEvent): void {
  const outbound: BridgeWSMessage = { type: 'event', payload: event };
  const raw = JSON.stringify(outbound);
  for (const client of clientSockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

export function broadcastToAll(event: BridgeEvent): void {
  const outbound: BridgeWSMessage = { type: 'event', payload: event };
  const raw = JSON.stringify(outbound);
  const evtName = event.event;
  if (evtName.startsWith('comfyui:')) {
    const bridgeOpen = bridgeSocket ? bridgeSocket.readyState === WebSocket.OPEN : false;
    console.log(`[Bridge DIAG] broadcastToAll ${evtName} — bridge=${bridgeOpen ? 'OPEN' : bridgeSocket ? `state=${bridgeSocket.readyState}` : 'NULL'}, clients=${clientSockets.size}, msgLen=${raw.length}`);
  }
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    bridgeSocket.send(raw);
  }
  for (const client of clientSockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

function emitBridgeEvent<E extends BridgeEventType>(
  event: E,
  data: BridgeEventDataMap[E],
): void {
  broadcastToAll({
    event,
    data: data as Record<string, unknown>,
    timestamp: Date.now(),
  });
}

const COMFYUI_EVENT_MAP: Record<string, BridgeEventType> = {
  status: 'comfyui:status',
  queue: 'comfyui:queue',
  progress: 'comfyui:progress',
  executing: 'comfyui:executing',
  executed: 'comfyui:executed',
  complete: 'comfyui:complete',
  error: 'comfyui:error',
};

function startComfyUIEventForwarding(): void {
  const emitter = getComfyEventEmitter();
  emitter.on('comfyui-event', (event: ComfyUIEvent) => {
    const bridgeEventType = COMFYUI_EVENT_MAP[event.type];
    if (!bridgeEventType) return;

    const { type: _type, ...payload } = event;
    emitBridgeEvent(bridgeEventType as any, payload as any);
  });
}

export function getBridgeStatus(): BridgeStatus {
  return {
    uxpConnected: isUxpBridgeOpen(),
    clientCount: clientSockets.size,
    lastHeartbeat,
  };
}

export function shutdownBridge(): void {
  clearBridgeHeartbeat();
  if (boundServer) {
    boundServer.off('upgrade', onHttpUpgrade);
    boundServer = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
  rejectAllPending(new Error('Bridge shutting down'));
  if (bridgeSocket) {
    bridgeSocket.removeAllListeners();
    if (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING) {
      bridgeSocket.close();
    }
    bridgeSocket = null;
  }
  for (const client of clientSockets) {
    client.removeAllListeners();
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close();
    }
  }
  clientSockets.clear();
  lastHeartbeat = null;
}
