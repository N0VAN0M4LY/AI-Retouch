import { useEffect, useRef, useState, useCallback } from 'react';
import { onBridgeEvent } from '../bridge/bridgeAgent';
import type { BridgeEvent, ComfyUIImageRef } from '@ai-retouch/shared';

export interface ComfyUIProgress {
  promptId: string;
  node: string;
  value: number;
  max: number;
  percentage: number;
}

interface PendingResult {
  resolve: (images: ComfyUIImageRef[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function useComfyUIEvents() {
  const [wsConnected, setWsConnected] = useState(false);
  const [progressInfo, setProgressInfo] = useState<ComfyUIProgress | null>(null);
  const [executingNode, setExecutingNode] = useState<string | null>(null);
  const [queueRemaining, setQueueRemaining] = useState(0);

  const pendingRef = useRef<Map<string, PendingResult>>(new Map());
  const activePromptRef = useRef<string | null>(null);
  const completedCacheRef = useRef<Map<string, ComfyUIImageRef[]>>(new Map());
  const errorCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const unsubs = [
      onBridgeEvent('comfyui:status', (e: BridgeEvent) => {
        setWsConnected((e.data as any).wsConnected ?? false);
      }),
      onBridgeEvent('comfyui:queue', (e: BridgeEvent) => {
        setQueueRemaining((e.data as any).queueRemaining ?? 0);
      }),
      onBridgeEvent('comfyui:progress', (e: BridgeEvent) => {
        const d = e.data as any;
        if (activePromptRef.current && d.promptId === activePromptRef.current) {
          setProgressInfo({
            promptId: d.promptId,
            node: d.node,
            value: d.value,
            max: d.max,
            percentage: d.percentage,
          });
        }
      }),
      onBridgeEvent('comfyui:executing', (e: BridgeEvent) => {
        const d = e.data as any;
        if (activePromptRef.current && d.promptId === activePromptRef.current) {
          setExecutingNode(d.node || null);
          setProgressInfo(null);
        }
      }),
      onBridgeEvent('comfyui:complete', (e: BridgeEvent) => {
        const d = e.data as { promptId: string; images: ComfyUIImageRef[] };
        console.log(`[ComfyUI WS] ✅ complete received: ${d.promptId.slice(0, 8)} images=${d.images?.length}`);

        const pending = pendingRef.current.get(d.promptId);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(d.images);
          pendingRef.current.delete(d.promptId);
        } else {
          completedCacheRef.current.set(d.promptId, d.images);
          if (completedCacheRef.current.size > 20) {
            const first = completedCacheRef.current.keys().next().value;
            if (first) completedCacheRef.current.delete(first);
          }
        }
        if (activePromptRef.current === d.promptId) {
          activePromptRef.current = null;
          setProgressInfo(null);
          setExecutingNode(null);
        }
      }),
      onBridgeEvent('comfyui:error', (e: BridgeEvent) => {
        const d = e.data as { promptId: string; message: string };
        const pending = pendingRef.current.get(d.promptId);
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(d.message));
          pendingRef.current.delete(d.promptId);
        } else {
          errorCacheRef.current.set(d.promptId, d.message);
        }
        if (activePromptRef.current === d.promptId) {
          activePromptRef.current = null;
          setProgressInfo(null);
          setExecutingNode(null);
        }
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      for (const [, p] of pendingRef.current) {
        clearTimeout(p.timer);
        p.reject(new Error('ComfyUI events disconnected'));
      }
      pendingRef.current.clear();
    };
  }, []);

  const waitForResult = useCallback((
    promptId: string,
    timeoutMs = 300000,
  ): Promise<ComfyUIImageRef[]> => {
    activePromptRef.current = promptId;
    setProgressInfo(null);
    setExecutingNode(null);

    const cached = completedCacheRef.current.get(promptId);
    if (cached) {
      completedCacheRef.current.delete(promptId);
      activePromptRef.current = null;
      return Promise.resolve(cached);
    }

    const cachedErr = errorCacheRef.current.get(promptId);
    if (cachedErr) {
      errorCacheRef.current.delete(promptId);
      activePromptRef.current = null;
      return Promise.reject(new Error(cachedErr));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(promptId);
        activePromptRef.current = null;
        setProgressInfo(null);
        setExecutingNode(null);
        reject(new Error('timeout'));
      }, timeoutMs);

      pendingRef.current.set(promptId, { resolve, reject, timer });
    });
  }, []);

  const clearProgress = useCallback(() => {
    activePromptRef.current = null;
    setProgressInfo(null);
    setExecutingNode(null);
  }, []);

  return {
    wsConnected,
    progressInfo,
    executingNode,
    queueRemaining,
    waitForResult,
    clearProgress,
  };
}
