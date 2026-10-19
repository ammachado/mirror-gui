import { describe, it, expect } from 'vitest';
import {
  listCatalogs, listDetailedOperators, getOperatorChannels, getOperatorVersions, getOperatorDependencies,
  getCatalogSyncStatus, startCatalogSync, deleteCatalogSyncData,
} from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

const CATALOG = 'registry.redhat.io/redhat/redhat-operator-index:v4.19';

describe('catalogs client', () => {
  it('lists catalogs and reads sync status', async () => {
    const { host, request } = fakeHost();
    await listCatalogs(host);
    await getCatalogSyncStatus(host);
    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/catalogs', undefined);
    expect(request).toHaveBeenNthCalledWith(2, 'GET', '/catalogs/sync/status', undefined);
  });

  it('starts a sync and clears synced data', async () => {
    const { host, request } = fakeHost({ message: 'cleared' });
    await startCatalogSync(host);
    await expect(deleteCatalogSyncData(host)).resolves.toEqual({ message: 'cleared' });
    expect(request).toHaveBeenNthCalledWith(1, 'POST', '/catalogs/sync', undefined);
    expect(request).toHaveBeenNthCalledWith(2, 'DELETE', '/catalogs/sync/data', undefined);
  });

  // Catalog URLs contain '/' and ':'. They go in params as raw values; the host's
  // HTTP layer encodes them. Pre-encoding here would double-encode.
  it('passes catalog URLs as raw query params', async () => {
    const { host, request } = fakeHost([]);
    await listDetailedOperators(host, CATALOG);
    await getOperatorChannels(host, 'web-terminal', CATALOG);
    await getOperatorVersions(host, 'web-terminal', CATALOG, 'fast');
    await getOperatorDependencies(host, 'web-terminal', CATALOG);
    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/operators', { params: { catalog: CATALOG, detailed: 'true' } });
    expect(request).toHaveBeenNthCalledWith(2, 'GET', '/operator-channels/web-terminal', { params: { catalogUrl: CATALOG } });
    expect(request).toHaveBeenNthCalledWith(3, 'GET', '/operators/web-terminal/versions', { params: { catalog: CATALOG, channel: 'fast' } });
    expect(request).toHaveBeenNthCalledWith(4, 'GET', '/operators/web-terminal/dependencies', { params: { catalogUrl: CATALOG } });
  });

  it('encodes operator names in path segments (no-op for valid package names)', async () => {
    const { host, request } = fakeHost();
    await getOperatorVersions(host, 'odf-operator', CATALOG, 'stable');
    await getOperatorVersions(host, 'bad/name', CATALOG, 'stable');
    expect(request.mock.calls[0][1]).toBe('/operators/odf-operator/versions');
    expect(request.mock.calls[1][1]).toBe('/operators/bad%2Fname/versions');
  });
});
