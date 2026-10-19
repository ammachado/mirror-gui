import { describe, it, expect } from 'vitest';
import {
  listOperations, getOperationHistory, getRecentOperations, getOperationLogs, getOperationDetails,
  startOperation, stopOperation, deleteOperation, operationLogStreamUrl,
} from '@mirror-gui/ui/api';
import type { MirrorGuiHost } from '@mirror-gui/ui/host';
import { fakeHost } from './fakeHost';

type Call = (host: MirrorGuiHost) => Promise<unknown>;

describe('operations client routes', () => {
  it.each<[string, Call, string, string]>([
    ['listOperations', h => listOperations(h), 'GET', '/operations'],
    ['getOperationHistory', h => getOperationHistory(h), 'GET', '/operations/history'],
    ['getRecentOperations', h => getRecentOperations(h), 'GET', '/operations/recent'],
    ['getOperationLogs', h => getOperationLogs(h, 'op-1'), 'GET', '/operations/op-1/logs'],
    ['getOperationDetails', h => getOperationDetails(h, 'op-1'), 'GET', '/operations/op-1/details'],
    ['stopOperation', h => stopOperation(h, 'op-1'), 'POST', '/operations/op-1/stop'],
    ['deleteOperation', h => deleteOperation(h, 'op-1'), 'DELETE', '/operations/op-1'],
  ])('%s hits %s %s', async (_name, call, method, path) => {
    const { host, request } = fakeHost();
    await call(host);
    expect(request).toHaveBeenCalledWith(method, path, undefined);
  });

  it('startOperation posts the request body unchanged, including mode and destination', async () => {
    const { host, request } = fakeHost({ id: 'op-1', status: 'running' });
    const body = {
      configFile: 'a.yaml',
      mode: 'mirrorToMirror' as const,
      destinationRegistry: 'quay.example.com:5000/mirror',
      skipDestTlsVerify: true,
      optionalFlags: { retryTimes: 3 },
    };
    const result = await startOperation(host, body);
    expect(request).toHaveBeenCalledWith('POST', '/operations/start', { body });
    expect(result).toEqual({ id: 'op-1', status: 'running' });
  });

  it('encodes operation ids exactly once in paths and stream URLs', async () => {
    const { host, request } = fakeHost();
    await deleteOperation(host, 'a b/c#d');
    expect(request).toHaveBeenCalledWith('DELETE', '/operations/a%20b%2Fc%23d', undefined);
    expect(operationLogStreamUrl(host, 'a b')).toBe('/proxy/backend/api/operations/a%20b/logstream');
  });

  it('returns the server payload unchanged', async () => {
    const { host } = fakeHost({ logs: 'line1\nline2' });
    await expect(getOperationLogs(host, 'op-1')).resolves.toEqual({ logs: 'line1\nline2' });
  });
});
