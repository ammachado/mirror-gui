import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { MirrorGuiHost } from './types';

const HostContext = createContext<MirrorGuiHost | null>(null);

export function HostProvider({ host, children }: { host: MirrorGuiHost; children?: ReactNode }) {
  return createElement(HostContext.Provider, { value: host }, children);
}

export function useHost(): MirrorGuiHost {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error('useHost() must be used inside a HostProvider');
  }
  return host;
}
