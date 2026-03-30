import { useEffect, useRef } from 'react';

export type DataEvent = 'sessions' | 'results' | 'all';

type Listener = () => void;

const listeners = new Map<DataEvent, Set<Listener>>();

function getListeners(event: DataEvent): Set<Listener> {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  return set;
}

export function emitDataChange(event: DataEvent): void {
  getListeners(event).forEach((fn) => fn());
  if (event === 'all') {
    getListeners('sessions').forEach((fn) => fn());
    getListeners('results').forEach((fn) => fn());
  }
}

export function onDataChange(event: DataEvent, listener: Listener): () => void {
  getListeners(event).add(listener);
  return () => {
    getListeners(event).delete(listener);
  };
}

export function useDataRefresh(event: DataEvent, callback: () => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handler = () => callbackRef.current();
    return onDataChange(event, handler);
  }, [event]);
}
