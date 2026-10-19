import { describe, it, expect } from 'vitest';
import { bindApi } from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

describe('bindApi', () => {
  it('binds every client function to the given host', async () => {
    const { host, request } = fakeHost();
    const api = bindApi(host);
    await api.deleteConfig('a b.yaml');
    expect(request).toHaveBeenCalledWith('DELETE', '/config/delete/a%20b.yaml', undefined);
    expect(api.operationLogStreamUrl('x')).toBe('/proxy/backend/api/operations/x/logstream');
  });

  it('exposes exactly the client functions, so pages cannot reach host.request through it', () => {
    const api = bindApi(fakeHost().host);
    expect(Object.keys(api).sort()).toEqual([
      'cleanupCache', 'configDownloadUrl', 'createMirrorFolder', 'deleteCatalogSyncData', 'deleteConfig',
      'deleteOperation', 'deletePullSecret', 'deleteRegistryCredential', 'getCatalogSyncStatus',
      'getOperationDetails', 'getOperationHistory', 'getOperationLogs', 'getOperatorChannels',
      'getOperatorDependencies', 'getOperatorVersions', 'getPullSecretContent', 'getPullSecretStatus',
      'getRecentOperations', 'getStats', 'getSystemInfo', 'getSystemStatus', 'listCatalogs', 'listConfigs',
      'listDetailedOperators', 'listMirrorFolders', 'listOperations', 'listRegistries', 'listRegistryCredentials',
      'operationLogStreamUrl', 'saveConfig', 'savePullSecret', 'saveRegistryCredential', 'startCatalogSync',
      'startOperation', 'stopOperation', 'verifyRegistry', 'verifyRegistryCredential',
    ]);
  });
});
