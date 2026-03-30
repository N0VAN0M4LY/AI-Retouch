import type { BridgeEvent, BridgeWSMessage } from '@ai-retouch/shared';

type EventHandler = (event: BridgeEvent) => void;
type ConnectionHandler = (connected: boolean) => void;

const eventListeners = new Map<string, Set<EventHandler>>();
const connectionListeners = new Set<ConnectionHandler>();

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 15000;

export function connectClientWS(backendUrl: string): void {
  const wsUrl = backendUrl.replace(/^http/, 'ws') + '/ws/client';
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  doConnect(wsUrl);
}

function doConnect(url: string): void {
  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectDelay = 1000;
    connectionListeners.forEach((fn) => fn(true));
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as BridgeWSMessage;
      if (msg.type === 'event') {
        const event = msg.payload;
        eventListeners.get(event.event)?.forEach((fn) => fn(event));
      } else if (msg.type === 'ping') {
        ws?.send(JSON.stringify({ type: 'pong' }));
      }
    } catch {
      // ignore parse errors
    }
  };

  ws.onclose = () => {
    connectionListeners.forEach((fn) => fn(false));
    scheduleReconnect(url);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(url: string): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    doConnect(url);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
}

export function disconnectClientWS(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  ws?.close();
  ws = null;
}

export function onBridgeEvent(eventType: string, handler: EventHandler): () => void {
  if (!eventListeners.has(eventType)) eventListeners.set(eventType, new Set());
  eventListeners.get(eventType)!.add(handler);
  return () => {
    eventListeners.get(eventType)?.delete(handler);
  };
}

export function onConnectionChange(handler: ConnectionHandler): () => void {
  connectionListeners.add(handler);
  return () => {
    connectionListeners.delete(handler);
  };
}
