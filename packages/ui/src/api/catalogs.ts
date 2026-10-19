import type { MirrorGuiHost } from '../host/types';
import type { CatalogInfo, CatalogSyncStatus, DetailedOperator, OperatorDependency } from './types';

const operatorPath = (name: string) => `/operators/${encodeURIComponent(name)}`;

export const listCatalogs = (host: MirrorGuiHost) =>
  host.request<CatalogInfo[]>('GET', '/catalogs', undefined);

export const listDetailedOperators = (host: MirrorGuiHost, catalogUrl: string) =>
  host.request<DetailedOperator[]>('GET', '/operators', { params: { catalog: catalogUrl, detailed: 'true' } });

/**
 * The server has returned both a bare channel array and an object with `channels`
 * and `allChannels`; MirrorConfig normalizes either shape, so the result stays untyped.
 */
export const getOperatorChannels = (host: MirrorGuiHost, operatorName: string, catalogUrl: string) =>
  host.request<any>('GET', `/operator-channels/${encodeURIComponent(operatorName)}`, { params: { catalogUrl } });

export const getOperatorVersions = (host: MirrorGuiHost, operatorName: string, catalogUrl: string, channel: string) =>
  host.request<{ versions?: string[] }>('GET', `${operatorPath(operatorName)}/versions`, {
    params: { catalog: catalogUrl, channel },
  });

export const getOperatorDependencies = (host: MirrorGuiHost, operatorName: string, catalogUrl: string) =>
  host.request<{ dependencies?: OperatorDependency[] }>('GET', `${operatorPath(operatorName)}/dependencies`, {
    params: { catalogUrl },
  });

export const getCatalogSyncStatus = (host: MirrorGuiHost) =>
  host.request<CatalogSyncStatus>('GET', '/catalogs/sync/status', undefined);

export const startCatalogSync = (host: MirrorGuiHost) =>
  host.request<unknown>('POST', '/catalogs/sync', undefined);

export const deleteCatalogSyncData = (host: MirrorGuiHost) =>
  host.request<{ message: string }>('DELETE', '/catalogs/sync/data', undefined);
