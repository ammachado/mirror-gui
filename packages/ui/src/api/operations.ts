import type { MirrorGuiHost } from '../host/types';
import type { Operation, OperationDetails, OperationLogs, StartOperationRequest } from './types';

const operationPath = (id: string) => `/operations/${encodeURIComponent(id)}`;

export const listOperations = (host: MirrorGuiHost) =>
  host.request<Operation[]>('GET', '/operations', undefined);

export const getOperationHistory = (host: MirrorGuiHost) =>
  host.request<Operation[]>('GET', '/operations/history', undefined);

export const getRecentOperations = (host: MirrorGuiHost) =>
  host.request<Operation[]>('GET', '/operations/recent', undefined);

export const getOperationLogs = (host: MirrorGuiHost, id: string) =>
  host.request<OperationLogs>('GET', `${operationPath(id)}/logs`, undefined);

export const getOperationDetails = (host: MirrorGuiHost, id: string) =>
  host.request<OperationDetails>('GET', `${operationPath(id)}/details`, undefined);

export const startOperation = (host: MirrorGuiHost, request: StartOperationRequest) =>
  host.request<Operation>('POST', '/operations/start', { body: request });

export const stopOperation = (host: MirrorGuiHost, id: string) =>
  host.request<unknown>('POST', `${operationPath(id)}/stop`, undefined);

export const deleteOperation = (host: MirrorGuiHost, id: string) =>
  host.request<unknown>('DELETE', operationPath(id), undefined);

/** URL for the server-sent events log stream of a running operation. */
export const operationLogStreamUrl = (host: MirrorGuiHost, id: string) =>
  host.apiUrl(`${operationPath(id)}/logstream`);
