import type { MirrorGuiHost } from '../host/types';
import type { Stats, SystemInfo, SystemStatus } from './types';

export const getStats = (host: MirrorGuiHost) =>
  host.request<Stats>('GET', '/stats', undefined);

export const getSystemStatus = (host: MirrorGuiHost) =>
  host.request<SystemStatus>('GET', '/system/status', undefined);

export const getSystemInfo = (host: MirrorGuiHost) =>
  host.request<SystemInfo>('GET', '/system/info', undefined);

export const listMirrorFolders = (host: MirrorGuiHost) =>
  host.request<{ folders?: string[] }>('GET', '/mirror-folders', undefined);

export const createMirrorFolder = (host: MirrorGuiHost, name: string) =>
  host.request<unknown>('POST', '/mirror-folders', { body: { name } });

export const cleanupCache = (host: MirrorGuiHost) =>
  host.request<unknown>('POST', '/cache/cleanup', undefined);
