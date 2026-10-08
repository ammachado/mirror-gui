import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTestApp } from './helpers/testApp.js';

const storageDir = process.env.STORAGE_DIR!;
const mirrorsDir = path.join(storageDir, 'mirrors');
const runDir = path.join(storageDir, 'run');
const b64 = (s: string) => Buffer.from(s).toString('base64');
const CONFIG = 'modes-config.yaml';

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition');
}

describe('Operation modes', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  let fakeDir: string;
  let origPath: string;
  let argsFile: string;
  let authCopy: string;

  const readArgs = () =>
    waitFor(async () => {
      try {
        const content = await fs.promises.readFile(argsFile, 'utf8');
        return content.includes('--v2') ? content.split('\n').filter(Boolean) : undefined;
      } catch {
        return undefined;
      }
    });

  const waitForCompletion = (operationId: string) =>
    waitFor(async () => {
      const res = await request.get('/api/operations');
      const op = res.body.find((o: { id: string }) => o.id === operationId);
      return op && op.status !== 'running' ? op : undefined;
    });

  beforeAll(async () => {
    request = await getTestApp();
    await request.post('/api/config/save').send({
      config:
        'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform: {}\n  operators: []\n  additionalImages: []',
      name: CONFIG,
    });

    fakeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oc-mirror-modes-'));
    argsFile = path.join(fakeDir, 'args.txt');
    authCopy = path.join(fakeDir, 'auth-copy.json');
    // Records argv, copies the --authfile it received, and can be held open with OC_MIRROR_SLEEP.
    await fs.promises.writeFile(
      path.join(fakeDir, 'oc-mirror'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" > "$OC_MIRROR_ARGS_FILE"',
        'prev=""',
        'for arg in "$@"; do',
        '  if [ "$prev" = "--authfile" ] && [ -n "$OC_MIRROR_AUTH_COPY" ]; then cp "$arg" "$OC_MIRROR_AUTH_COPY"; fi',
        '  prev="$arg"',
        'done',
        // exec so SIGTERM from the stop endpoint reaches sleep directly; a child sleep would
        // keep stdout open and delay the close event until it finished.
        'exec sleep "${OC_MIRROR_SLEEP:-0}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    origPath = process.env.PATH || '';
    process.env.PATH = `${fakeDir}:${origPath}`;
    process.env.OC_MIRROR_ARGS_FILE = argsFile;
    process.env.OC_MIRROR_AUTH_COPY = authCopy;
  });

  afterEach(async () => {
    delete process.env.OC_MIRROR_SLEEP;
    delete process.env.OC_MIRROR_REGISTRY_CREDENTIALS;
    await fs.promises.rm(argsFile, { force: true });
    await fs.promises.rm(authCopy, { force: true });
    await fs.promises.rm(process.env.OC_MIRROR_AUTHFILE!, { force: true });
    await fs.promises.rm(path.join(storageDir, 'registry-credentials.json'), { force: true });
  });

  afterAll(async () => {
    process.env.PATH = origPath;
    delete process.env.OC_MIRROR_ARGS_FILE;
    delete process.env.OC_MIRROR_AUTH_COPY;
    await fs.promises.rm(fakeDir, { recursive: true, force: true });
  });

  describe('validation', () => {
    it.each([
      [{ mode: 'mirrorToMirrors' }, /Unknown mode/],
      [{ mode: 'mirrorToMirror' }, /destinationRegistry is required/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'docker://reg.example.com' }, /scheme/],
      [{ mode: 'diskToMirror', destinationRegistry: 'reg.example.com/ns:v1' }, /tag/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com', skipDestTlsVerify: 'yes' }, /boolean/],
      [{ destinationRegistry: 'reg.example.com' }, /only valid for mirrorToMirror and diskToMirror/],
      [{ mode: 'mirrorToDisk', skipDestTlsVerify: true }, /only valid for mirrorToMirror and diskToMirror/],
      [{ optionalFlags: { maxNestedPaths: 2 } }, /maxNestedPaths is only valid/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com', optionalFlags: { maxNestedPaths: 0 } }, /positive integer/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com', optionalFlags: { maxNestedPaths: 1.5 } }, /positive integer/],
    ])('rejects %o', async (body, message) => {
      const res = await request.post('/api/operations/start').send({ configFile: CONFIG, ...body });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });

    it('returns 404 when the disk-to-mirror source folder does not exist', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: CONFIG,
        mode: 'diskToMirror',
        destinationRegistry: 'reg.example.com',
        mirrorDestinationSubdir: 'does-not-exist',
      });
      expect(res.status).toBe(404);
      expect(await fs.promises.access(path.join(mirrorsDir, 'does-not-exist')).then(() => true, () => false)).toBe(false);
    });

    it('returns 400 with help when the disk-to-mirror source has no archives', async () => {
      await fs.promises.mkdir(path.join(mirrorsDir, 'no-archives'), { recursive: true });
      const res = await request.post('/api/operations/start').send({
        configFile: CONFIG,
        mode: 'diskToMirror',
        destinationRegistry: 'reg.example.com',
        mirrorDestinationSubdir: 'no-archives',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mirror_\*\.tar/);
      expect(res.body.help).toBeDefined();
    });
  });

  it('runs mirror-to-mirror with the workspace, destination, TLS flag, and merged credentials', async () => {
    await fs.promises.writeFile(
      process.env.OC_MIRROR_AUTHFILE!,
      JSON.stringify({ auths: { 'registry.redhat.io': { auth: b64('rh:pw') }, 'reg.example.com:5000': { auth: b64('old:old') } } }),
    );
    await request.put('/api/registry-credentials').send({ registry: 'reg.example.com:5000', username: 'new', password: 'new' });

    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com:5000/ocp',
      mirrorDestinationSubdir: 'm2m-ws',
      optionalFlags: { maxNestedPaths: 2 },
    });
    expect(res.status).toBe(200);

    const args = await readArgs();
    expect(args[args.indexOf('--workspace') + 1]).toMatch(/^file:\/\/.*\/mirrors\/m2m-ws$/);
    expect(args).not.toContain('--from');
    expect(args).toContain('--dest-tls-verify=true');
    expect(args[args.indexOf('--max-nested-paths') + 1]).toBe('2');
    expect(args[args.length - 1]).toBe('docker://reg.example.com:5000/ocp');

    const authfile = args[args.indexOf('--authfile') + 1];
    expect(authfile).toBe(path.join(runDir, `authfile-${res.body.operationId}.json`));
    const merged = JSON.parse(await fs.promises.readFile(authCopy, 'utf8'));
    expect(merged.auths['registry.redhat.io'].auth).toBe(b64('rh:pw'));
    expect(merged.auths['reg.example.com:5000'].auth).toBe(b64('new:new'));

    const op = await waitForCompletion(res.body.operationId);
    expect(op.mode).toBe('mirrorToMirror');
    expect(op.destinationRegistry).toBe('reg.example.com:5000/ocp');
    expect(await fs.promises.access(authfile).then(() => true, () => false)).toBe(false);

    const details = await request.get(`/api/operations/${res.body.operationId}/details`);
    expect(details.body.mode).toBe('mirrorToMirror');
    expect(details.body.clusterResourcesPath).toBe(path.join(mirrorsDir, 'm2m-ws', 'working-dir', 'cluster-resources'));
  });

  it('runs disk-to-mirror from an archive folder with TLS verification skipped and no pull secret', async () => {
    const source = path.join(mirrorsDir, 'archive-src');
    await fs.promises.mkdir(source, { recursive: true });
    await fs.promises.writeFile(path.join(source, 'mirror_000001.tar'), '');

    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'diskToMirror',
      destinationRegistry: 'reg.example.com',
      skipDestTlsVerify: true,
      mirrorDestinationSubdir: 'archive-src',
    });
    expect(res.status).toBe(200);

    const args = await readArgs();
    expect(args[args.indexOf('--from') + 1]).toMatch(/^file:\/\/.*\/mirrors\/archive-src$/);
    expect(args).not.toContain('--workspace');
    expect(args).toContain('--dest-tls-verify=false');
    expect(args[args.length - 1]).toBe('docker://reg.example.com');
    expect(JSON.parse(await fs.promises.readFile(authCopy, 'utf8'))).toEqual({ auths: {} });
    await waitForCompletion(res.body.operationId);
  });

  it('keeps mirror-to-disk working when mode is omitted and records the mode', async () => {
    const res = await request.post('/api/operations/start').send({ configFile: CONFIG });
    expect(res.status).toBe(200);
    const args = await readArgs();
    expect(args[args.length - 1]).toMatch(/^file:\/\//);
    expect(args).toContain('--dest-tls-verify=false');
    const op = await waitForCompletion(res.body.operationId);
    expect(op.mode).toBe('mirrorToDisk');
    expect(op.destinationRegistry).toBeUndefined();

    const details = await request.get(`/api/operations/${res.body.operationId}/details`);
    expect(details.body.clusterResourcesPath).toBeUndefined();
  });

  it('rejects a second start on a folder in use, then releases it when the first finishes', async () => {
    process.env.OC_MIRROR_SLEEP = '1';
    const first = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com',
      mirrorDestinationSubdir: 'busy',
    });
    expect(first.status).toBe(200);

    const second = await request.post('/api/operations/start').send({ configFile: CONFIG, mirrorDestinationSubdir: 'busy' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/running operation/i);

    await waitForCompletion(first.body.operationId);
    delete process.env.OC_MIRROR_SLEEP;
    const third = await request.post('/api/operations/start').send({ configFile: CONFIG, mirrorDestinationSubdir: 'busy' });
    expect(third.status).toBe(200);
    await waitForCompletion(third.body.operationId);
  });

  it('removes the temporary authfile and releases the folder when a run is stopped', async () => {
    process.env.OC_MIRROR_SLEEP = '30';
    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com',
      mirrorDestinationSubdir: 'stopped-ws',
    });
    expect(res.status).toBe(200);
    const authfile = path.join(runDir, `authfile-${res.body.operationId}.json`);
    await readArgs();
    expect(await fs.promises.access(authfile).then(() => true, () => false)).toBe(true);

    await request.post(`/api/operations/${res.body.operationId}/stop`);
    const op = await waitForCompletion(res.body.operationId);
    expect(op.status).toBe('stopped');
    expect(await fs.promises.access(authfile).then(() => true, () => false)).toBe(false);

    delete process.env.OC_MIRROR_SLEEP;
    const again = await request.post('/api/operations/start').send({ configFile: CONFIG, mirrorDestinationSubdir: 'stopped-ws' });
    expect(again.status).toBe(200);
    await waitForCompletion(again.body.operationId);
  });

  it('returns 500 naming the file when destination credentials are malformed, without creating an operation', async () => {
    const broken = path.join(storageDir, 'broken-creds.json');
    await fs.promises.writeFile(broken, 'not json');
    process.env.OC_MIRROR_REGISTRY_CREDENTIALS = broken;
    const before = (await request.get('/api/operations')).body.length;

    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com',
      mirrorDestinationSubdir: 'bad-creds',
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain(broken);
    expect((await request.get('/api/operations')).body.length).toBe(before);
  });
});
