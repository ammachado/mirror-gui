import axios, { type AxiosInstance } from 'axios';
import { ApiError, type HttpMethod, type MirrorGuiHost, type PageId, type RequestOptions } from '@mirror-gui/ui/host';

const API_BASE = '/api';

const PAGE_PATHS: Record<PageId, string> = {
  dashboard: '/',
  config: '/config',
  operations: '/operations',
  history: '/history',
  settings: '/settings',
};

function stringField(body: unknown, field: 'error' | 'message'): string | undefined {
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** Converts anything axios throws into ApiError, preferring the server's own error text. */
export function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data;
    const message = stringField(body, 'error') ?? stringField(body, 'message') ?? error.message;
    return new ApiError(message, error.response?.status ?? 0, body);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError(message, 0, undefined);
}

export function createStandaloneHost(options: {
  notify: MirrorGuiHost['notify'];
  http?: AxiosInstance;
}): MirrorGuiHost {
  const http = options.http ?? axios.create({ baseURL: API_BASE });

  return {
    async request<T>(method: HttpMethod, path: string, requestOptions: RequestOptions = {}) {
      try {
        const response = await http.request<T>({
          method,
          url: path,
          params: requestOptions.params,
          data: requestOptions.body,
        });
        return response.data;
      } catch (error) {
        throw toApiError(error);
      }
    },
    apiUrl: path => `${API_BASE}${path}`,
    notify: options.notify,
    pagePath: page => PAGE_PATHS[page],
  };
}
