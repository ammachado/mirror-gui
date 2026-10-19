import type { MirrorGuiHost } from '../host/types';
import type { NewRegistryCredential, PullSecretStatus, RegistryCredentialsList, RegistryEntry } from './types';

export const getPullSecretStatus = (host: MirrorGuiHost) =>
  host.request<PullSecretStatus>('GET', '/pull-secret/status', undefined);

export const getPullSecretContent = (host: MirrorGuiHost) =>
  host.request<{ content?: string }>('GET', '/pull-secret/content', undefined);

export const savePullSecret = (host: MirrorGuiHost, content: string) =>
  host.request<unknown>('POST', '/pull-secret', { body: { content } });

export const deletePullSecret = (host: MirrorGuiHost) =>
  host.request<unknown>('DELETE', '/pull-secret', undefined);

export const listRegistries = (host: MirrorGuiHost) =>
  host.request<{ registries?: RegistryEntry[] }>('GET', '/registries', undefined);

export const verifyRegistry = (host: MirrorGuiHost, registry: string) =>
  host.request<{ status: RegistryEntry['status']; error?: string }>('POST', '/registries/verify', { body: { registry } });

/** Credentials oc-mirror uses to push to a destination registry (mirror-to-mirror, disk-to-mirror). */
export const listRegistryCredentials = (host: MirrorGuiHost) =>
  host.request<RegistryCredentialsList>('GET', '/registry-credentials', undefined);

export const saveRegistryCredential = (host: MirrorGuiHost, credential: NewRegistryCredential) =>
  host.request<unknown>('PUT', '/registry-credentials', { body: credential });

export const deleteRegistryCredential = (host: MirrorGuiHost, registry: string) =>
  host.request<unknown>('DELETE', `/registry-credentials/${encodeURIComponent(registry)}`, undefined);

export const verifyRegistryCredential = (host: MirrorGuiHost, registry: string) =>
  host.request<{ registry: string; status: RegistryEntry['status']; error?: string }>(
    'POST', '/registry-credentials/verify', { body: { registry } });
