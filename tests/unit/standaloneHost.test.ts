import { describe, it, expect, vi } from 'vitest';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '@mirror-gui/ui/host';
import { createStandaloneHost, toApiError } from '../../src/host/standaloneHost';

type Reply = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

/** Real axios instance with a fake transport, so request building and error creation are axios's own. */
function httpWith(reply: Reply) {
  return axios.create({ baseURL: '/api', adapter: reply });
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown): Promise<AxiosResponse> {
  const response = { data, status, statusText: '', headers: {}, config };
  if (status >= 400) {
    return Promise.reject(new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, null, response));
  }
  return Promise.resolve(response);
}

describe('createStandaloneHost.request', () => {
  it('sends method, /api-prefixed path, params and JSON body, and resolves with the response data unchanged', async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    const http = httpWith(config => {
      seen.push(config);
      return respond(config, 200, { id: 'op-1', status: 'running' });
    });
    const host = createStandaloneHost({ notify: vi.fn(), http });

    const result = await host.request('POST', '/operations/start', {
      body: { configFile: 'a.yaml' },
      params: { catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.19' },
    });

    expect(result).toEqual({ id: 'op-1', status: 'running' });
    expect(seen[0].method).toBe('post');
    expect(seen[0].baseURL).toBe('/api');
    expect(seen[0].url).toBe('/operations/start');
    // Raw value: axios encodes params itself, so the client must not pre-encode.
    expect(seen[0].params).toEqual({ catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.19' });
    expect(JSON.parse(seen[0].data as string)).toEqual({ configFile: 'a.yaml' });
  });

  it('returns non-object bodies verbatim so pages keep their own Array.isArray guards', async () => {
    const http = httpWith(config => respond(config, 200, null));
    const host = createStandaloneHost({ notify: vi.fn(), http });
    await expect(host.request('GET', '/operations/history')).resolves.toBeNull();
  });

  it('sends PUT with a JSON body (destination registry credentials use it)', async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    const http = httpWith(config => {
      seen.push(config);
      return respond(config, 200, { message: 'Registry credentials saved' });
    });
    const host = createStandaloneHost({ notify: vi.fn(), http });

    await host.request('PUT', '/registry-credentials', { body: { registry: 'quay.example.com', username: 'u', password: 'p' } });

    expect(seen[0].method).toBe('put');
    expect(JSON.parse(seen[0].data as string)).toEqual({ registry: 'quay.example.com', username: 'u', password: 'p' });
  });

  it('rejects with ApiError carrying the server error message and status', async () => {
    const http = httpWith(config => respond(config, 404, { error: 'Configuration file not found' }));
    const host = createStandaloneHost({ notify: vi.fn(), http });

    const error = await host.request('POST', '/operations/start').catch(e => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Configuration file not found');
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ error: 'Configuration file not found' });
  });
});

describe('toApiError', () => {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const axiosErrorWith = (status: number, data: unknown) =>
    new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, null,
      { data, status, statusText: '', headers: {}, config });

  it('prefers body.error, then body.message, then the transport message', () => {
    expect(toApiError(axiosErrorWith(500, { error: 'E', message: 'M' })).message).toBe('E');
    expect(toApiError(axiosErrorWith(500, { message: 'M' })).message).toBe('M');
    expect(toApiError(axiosErrorWith(500, {})).message).toBe('Request failed with status code 500');
  });

  it('falls back to the transport message for non-JSON bodies such as a proxy HTML page', () => {
    const error = toApiError(axiosErrorWith(502, '<html>Bad Gateway</html>'));
    expect(error.message).toBe('Request failed with status code 502');
    expect(error.status).toBe(502);
    expect(error.body).toBe('<html>Bad Gateway</html>');
  });

  it('ignores non-string error fields instead of showing [object Object]', () => {
    expect(toApiError(axiosErrorWith(500, { error: { code: 1 } })).message).toBe('Request failed with status code 500');
  });

  it('maps a network failure (no response) to status 0 with the axios message', () => {
    const error = toApiError(new AxiosError('Network Error', 'ERR_NETWORK', config));
    expect(error.status).toBe(0);
    expect(error.message).toBe('Network Error');
    expect(error.body).toBeUndefined();
  });

  it('wraps non-axios errors without losing their message', () => {
    const error = toApiError(new TypeError('boom'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('boom');
    expect(error.status).toBe(0);
  });
});

describe('createStandaloneHost URLs, routes and notifications', () => {
  const notify = vi.fn();
  const host = createStandaloneHost({ notify });

  it('prefixes browser-loaded URLs with /api', () => {
    expect(host.apiUrl('/operations/abc/logstream')).toBe('/api/operations/abc/logstream');
  });

  it('maps pages to the routes the standalone app already uses', () => {
    expect(host.pagePath('dashboard')).toBe('/');
    expect(host.pagePath('config')).toBe('/config');
    expect(host.pagePath('operations')).toBe('/operations');
    expect(host.pagePath('history')).toBe('/history');
    expect(host.pagePath('settings')).toBe('/settings');
  });

  it('forwards notifications to the provided notify function', () => {
    host.notify('danger', 'Failed to load dashboard data');
    expect(notify).toHaveBeenCalledWith('danger', 'Failed to load dashboard data');
  });
});
