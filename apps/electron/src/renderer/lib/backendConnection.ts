import { useState, useEffect } from 'react';
import { emitDataChange } from './dataEvents';

export type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

let status: ConnectionStatus = 'checking';
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 2000;
let retryAt: number | null = null;

const MIN_BACKOFF = 2000;
const MAX_BACKOFF = 30000;
const MIN_CHECKING_MS = 1500;

const statusListeners = new Set<(s: ConnectionStatus) => void>();

function setStatus(next: ConnectionStatus) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((fn) => fn(next));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkHealth(): Promise<boolean> {
  try {
    const { fetchBackendHealth } = await import('./api');
    await fetchBackendHealth();
    return true;
  } catch {
    return false;
  }
}

async function checkHealthWithMinDuration(): Promise<boolean> {
  const [ok] = await Promise.all([checkHealth(), delay(MIN_CHECKING_MS)]);
  return ok;
}

function scheduleHealthPoll() {
  if (pollTimer !== null) return;
  retryAt = Date.now() + backoff;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    retryAt = null;
    setStatus('checking');
    const ok = await checkHealthWithMinDuration();
    if (ok) {
      setStatus('connected');
      backoff = MIN_BACKOFF;
      emitDataChange('all');
    } else {
      setStatus('disconnected');
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      scheduleHealthPoll();
    }
  }, backoff);
}

export function markDisconnected(): void {
  if (status === 'disconnected') return;
  setStatus('disconnected');
  backoff = MIN_BACKOFF;
  scheduleHealthPoll();
}

export function markConnected(): void {
  if (status === 'connected') return;
  const wasDisconnected = status === 'disconnected';
  setStatus('connected');
  backoff = MIN_BACKOFF;
  retryAt = null;
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (wasDisconnected) {
    emitDataChange('all');
  }
}

export async function startConnectionMonitor(): Promise<void> {
  setStatus('checking');
  const ok = await checkHealthWithMinDuration();
  if (ok) {
    setStatus('connected');
  } else {
    setStatus('disconnected');
    scheduleHealthPoll();
  }
}

export function stopConnectionMonitor(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  retryAt = null;
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

export function useBackendStatus(): ConnectionStatus {
  const [s, setS] = useState<ConnectionStatus>(status);
  useEffect(() => {
    const handler = (next: ConnectionStatus) => setS(next);
    statusListeners.add(handler);
    setS(status);
    return () => { statusListeners.delete(handler); };
  }, []);
  return s;
}

export function useRetryCountdown(): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    function tick() {
      if (retryAt === null || status !== 'disconnected') {
        setSeconds(null);
        return;
      }
      setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return seconds;
}
