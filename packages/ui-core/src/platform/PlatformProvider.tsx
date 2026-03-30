import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { PlatformContext } from './types';

const Ctx = createContext<PlatformContext | null>(null);

export function PlatformProvider({ platform, children }: { platform: PlatformContext; children: ReactNode }) {
  return <Ctx.Provider value={platform}>{children}</Ctx.Provider>;
}

export function usePlatform(): PlatformContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider');
  return ctx;
}
