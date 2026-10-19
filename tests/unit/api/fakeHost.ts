import { vi } from 'vitest';
import type { MirrorGuiHost } from '@mirror-gui/ui/host';

/**
 * Records every request so tests can assert the exact route a client function hits.
 * apiUrl uses a non-/api base on purpose: it proves URL helpers go through the host
 * instead of hardcoding the standalone prefix.
 */
export function fakeHost(response: unknown = {}) {
  const request = vi.fn().mockResolvedValue(response);
  const host: MirrorGuiHost = {
    request: request as MirrorGuiHost['request'],
    apiUrl: path => `/proxy/backend/api${path}`,
    notify: vi.fn(),
    pagePath: page => `/${page}`,
  };
  return { host, request };
}
