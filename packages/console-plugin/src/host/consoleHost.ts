import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import { ApiError, type HttpMethod, type MirrorGuiHost, type PageId, type RequestOptions } from '@mirror-gui/ui/host';

/** The ConsolePlugin CR proxies this alias to the plugin's nginx, which forwards /api to the backend. */
const API_BASE = '/api/proxy/plugin/oc-mirror-ui/backend/api';

const PAGE_PATHS: Record<PageId, string> = {
  dashboard: '/oc-mirror-ui',
  config: '/oc-mirror-ui/config',
  operations: '/oc-mirror-ui/operations',
  history: '/oc-mirror-ui/history',
  settings: '/oc-mirror-ui/settings',
};

function stringField(body: unknown, field: 'error' | 'message'): string | undefined {
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** Converts the HttpError consoleFetch throws (code, json) into ApiError. */
function toApiError(error: unknown): ApiError {
  const { code, json, message } = (error ?? {}) as { code?: number; json?: unknown; message?: string };
  const text = stringField(json, 'error') ?? stringField(json, 'message') ?? (message || 'Request failed');
  return new ApiError(text, code ?? 0, json);
}

function withParams(path: string, params?: Record<string, string>): string {
  const query = params ? new URLSearchParams(params).toString() : '';
  return `${API_BASE}${path}${query ? `?${query}` : ''}`;
}

export function createConsoleHost(options: { notify: MirrorGuiHost['notify'] }): MirrorGuiHost {
  return {
    async request<T>(method: HttpMethod, path: string, requestOptions: RequestOptions = {}) {
      const url = withParams(path, requestOptions.params);
      try {
        switch (method) {
          case 'GET':
            return (await consoleFetchJSON(url)) as T;
          case 'POST':
            return (await consoleFetchJSON.post(url, requestOptions.body ?? {})) as T;
          case 'PUT':
            return (await consoleFetchJSON.put(url, requestOptions.body ?? {})) as T;
          case 'DELETE':
            return (await consoleFetchJSON.delete(url, requestOptions.body)) as T;
        }
      } catch (error) {
        throw toApiError(error);
      }
    },
    apiUrl: path => `${API_BASE}${path}`,
    notify: options.notify,
    pagePath: page => PAGE_PATHS[page],
  };
}
