export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type NotifyVariant = 'success' | 'danger' | 'warning' | 'info';

/** Pages the app exposes; each host decides the route each one lives at. */
export type PageId = 'dashboard' | 'config' | 'operations' | 'history' | 'settings';

export interface RequestOptions {
  body?: unknown;
  params?: Record<string, string>;
}

/**
 * Everything a page needs from the environment it runs in.
 * The standalone app and the OpenShift Console plugin each provide one.
 */
export interface MirrorGuiHost {
  /** Request to the mirror-gui backend. `path` is relative to the API root, e.g. '/operations/start'. Rejects with ApiError. */
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  /** Absolute URL for resources the browser loads itself (EventSource, download links). */
  apiUrl(path: string): string;
  notify(variant: NotifyVariant, title: string): void;
  /** Host route for an app page, e.g. '/settings' standalone or '/oc-mirror-ui/settings' in the console. */
  pagePath(page: PageId): string;
}
