import type { MirrorGuiHost } from '../host/types';
import type { ConfigFile } from './types';

export const listConfigs = (host: MirrorGuiHost) =>
  host.request<ConfigFile[]>('GET', '/config/list', undefined);

export const saveConfig = (host: MirrorGuiHost, name: string, config: string) =>
  host.request<unknown>('POST', '/config/save', { body: { config, name } });

export const deleteConfig = (host: MirrorGuiHost, filename: string) =>
  host.request<unknown>('DELETE', `/config/delete/${encodeURIComponent(filename)}`, undefined);

/** URL for a native <a download> link to a saved configuration. */
export const configDownloadUrl = (host: MirrorGuiHost, filename: string) =>
  host.apiUrl(`/config/download/${encodeURIComponent(filename)}`);
