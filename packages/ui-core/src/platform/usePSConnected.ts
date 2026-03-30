import { useEffect, useState } from 'react';
import { usePlatform } from './PlatformProvider';

export function usePSConnected(): boolean {
  const { ps, events } = usePlatform();
  const [connected, setConnected] = useState(() => ps.isConnected);

  useEffect(() => {
    setConnected(ps.isConnected);
    const unsubs = [
      events.onBridgeEvent('bridgeReady', () => setConnected(true)),
      events.onBridgeEvent('bridgeDisconnecting', () => setConnected(false)),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [ps, events]);

  return connected;
}
