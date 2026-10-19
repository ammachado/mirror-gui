import { describe, it, expect } from 'vitest';
import {
  getStats, getSystemStatus, getSystemInfo, listMirrorFolders, createMirrorFolder, cleanupCache,
  getPullSecretStatus, getPullSecretContent, savePullSecret, deletePullSecret, listRegistries, verifyRegistry,
  listRegistryCredentials, saveRegistryCredential, deleteRegistryCredential, verifyRegistryCredential,
} from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

describe('system and settings client', () => {
  it.each([
    ['getStats', getStats, 'GET', '/stats'],
    ['getSystemStatus', getSystemStatus, 'GET', '/system/status'],
    ['getSystemInfo', getSystemInfo, 'GET', '/system/info'],
    ['listMirrorFolders', listMirrorFolders, 'GET', '/mirror-folders'],
    ['cleanupCache', cleanupCache, 'POST', '/cache/cleanup'],
    ['getPullSecretStatus', getPullSecretStatus, 'GET', '/pull-secret/status'],
    ['getPullSecretContent', getPullSecretContent, 'GET', '/pull-secret/content'],
    ['deletePullSecret', deletePullSecret, 'DELETE', '/pull-secret'],
    ['listRegistries', listRegistries, 'GET', '/registries'],
    ['listRegistryCredentials', listRegistryCredentials, 'GET', '/registry-credentials'],
  ] as const)('%s hits %s %s', async (_name, fn, method, path) => {
    const { host, request } = fakeHost();
    await fn(host);
    expect(request).toHaveBeenCalledWith(method, path, undefined);
  });

  it('sends the bodies the server reads', async () => {
    const { host, request } = fakeHost();
    await createMirrorFolder(host, 'run-2026');
    await savePullSecret(host, '{"auths":{}}');
    await verifyRegistry(host, 'registry.redhat.io');
    expect(request).toHaveBeenNthCalledWith(1, 'POST', '/mirror-folders', { body: { name: 'run-2026' } });
    expect(request).toHaveBeenNthCalledWith(2, 'POST', '/pull-secret', { body: { content: '{"auths":{}}' } });
    expect(request).toHaveBeenNthCalledWith(3, 'POST', '/registries/verify', { body: { registry: 'registry.redhat.io' } });
  });

  it('manages destination registry credentials with the routes and bodies the server reads', async () => {
    const { host, request } = fakeHost();
    const credential = { registry: 'quay.example.com:5000', username: 'mirror', password: 's3cret' };
    await saveRegistryCredential(host, credential);
    await verifyRegistryCredential(host, 'quay.example.com:5000');
    await deleteRegistryCredential(host, 'quay.example.com:5000');
    expect(request).toHaveBeenNthCalledWith(1, 'PUT', '/registry-credentials', { body: credential });
    expect(request).toHaveBeenNthCalledWith(2, 'POST', '/registry-credentials/verify', { body: { registry: 'quay.example.com:5000' } });
    // The registry is a path segment: ':' must be encoded exactly once, as the page does today.
    expect(request).toHaveBeenNthCalledWith(3, 'DELETE', '/registry-credentials/quay.example.com%3A5000', undefined);
  });
});
