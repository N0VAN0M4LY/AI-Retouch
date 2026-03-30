import type {
  BridgeWSMessage,
  BridgeCommand,
  BridgeCommandResult,
  BridgeEvent,
  BridgeEventType,
  BridgeEventDataMap,
} from '@ai-retouch/shared';

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;
type EventHandler = (event: BridgeEvent) => void;

let ws: WebSocket | null = null;
let wsUrl: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let intentionalClose = false;

const MAX_RECONNECT_DELAY = 15000;
const commandHandlers = new Map<string, CommandHandler>();
const eventListeners = new Map<string, Set<EventHandler>>();

export function registerCommandHandler(command: string, handler: CommandHandler): void {
  commandHandlers.set(command, handler);
}

export function onBridgeEvent(eventType: string, handler: EventHandler): () => void {
  if (!eventListeners.has(eventType)) eventListeners.set(eventType, new Set());
  eventListeners.get(eventType)!.add(handler);
  return () => {
    eventListeners.get(eventType)?.delete(handler);
  };
}

export function startBridge(backendUrl: string): void {
  wsUrl = backendUrl.replace(/^http/, 'ws') + '/ws/bridge';
  intentionalClose = false;
  connect();
}

export function stopBridge(): void {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

export function isBridgeConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function sendEvent<E extends BridgeEventType>(
  event: E,
  data: BridgeEventDataMap[E],
): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg: BridgeWSMessage = {
    type: 'event',
    payload: {
      event,
      data: data as Record<string, unknown>,
      timestamp: Date.now(),
    },
  };
  ws.send(JSON.stringify(msg));
}

function connect(): void {
  if (!wsUrl) return;
  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    console.warn('[Bridge] WebSocket constructor failed:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[Bridge] Connected to backend');
    reconnectDelay = 1000;
    sendEvent('bridgeReady', {});
  };

  ws.onmessage = (e: MessageEvent) => {
    try {
      const raw = String(e.data);
      // verbose raw-message log removed — was flooding console
      const msg = JSON.parse(raw) as BridgeWSMessage;
      handleMessage(msg);
    } catch (err) {
      console.warn('[Bridge] Failed to parse message:', err);
    }
  };

  ws.onclose = () => {
    console.log('[Bridge] Disconnected from backend');
    ws = null;
    if (!intentionalClose) {
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
}

async function handleMessage(msg: BridgeWSMessage): Promise<void> {
  if (msg.type === 'command') {
    await dispatchCommand(msg.payload);
  } else if (msg.type === 'event') {
    const event = msg.payload;
    const listenerCount = eventListeners.get(event.event)?.size ?? 0;
    console.log(`[Bridge DIAG] event="${event.event}" listenerCount=${listenerCount} dataKeys=${Object.keys(event.data ?? {}).join(',')}`);
    eventListeners.get(event.event)?.forEach((fn) => fn(event));
  } else if (msg.type === 'ping') {
    ws?.send(JSON.stringify({ type: 'pong' }));
  }
}

async function dispatchCommand(cmd: BridgeCommand): Promise<void> {
  const handler = commandHandlers.get(cmd.command);
  if (!handler) {
    sendResult({ id: cmd.id, success: false, error: `Unknown command: ${cmd.command}` });
    return;
  }
  try {
    const data = await handler(cmd.params);
    sendResult({ id: cmd.id, success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Bridge] Command '${cmd.command}' failed:`, message);
    sendResult({ id: cmd.id, success: false, error: message });
  }
}

function sendResult(result: BridgeCommandResult): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg: BridgeWSMessage = { type: 'commandResult', payload: result };
  ws.send(JSON.stringify(msg));
}
