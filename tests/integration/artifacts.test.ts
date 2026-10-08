import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getTestApp } from './helpers/testApp.js';

const fsp = fs.promises;
const storageDir = process.env.STORAGE_DIR!;
const opsDir = path.join(storageDir, 'operations');
const mirrorDir = path.join(storageDir, 'mirrors', 'artifacts-test');
const dottedMirrorDir = path.join(storageDir, 'mirrors', '.dotted-parent', 'dest');
const outsideFile = path.join(storageDir, 'outside-secret.txt');
const OUTSIDE_SECRET = 'outside-secret-content';

// 4 KiB of non-repeating bytes: above compression's 1 KiB threshold, and
// Range assertions can tell different offsets apart.
const archiveBytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

function seedOp(id: string, data: Record<string, unknown>) {
  return fsp.writeFile(path.join(opsDir, `${id}.json`), JSON.stringify({
    id,
    name: `Mirror Operation ${id}`,
    configFile: 'artifacts.yaml',
    startedAt: new Date().toISOString(),
    logs: [],
    ...data,
  }, null, 2));
}

function binaryParser(res: NodeJS.ReadableStream, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Artifacts API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  const originalOverride = process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS;

  beforeAll(async () => {
    request = await getTestApp();
    await fsp.mkdir(path.join(mirrorDir, 'working-dir'), { recursive: true });
    await fsp.writeFile(path.join(mirrorDir, 'mirror_000002.tar'), 'second');
    await fsp.writeFile(path.join(mirrorDir, 'mirror_000001.tar'), archiveBytes);
    await fsp.writeFile(path.join(mirrorDir, '.test-write'), 'probe');
    await fsp.writeFile(path.join(mirrorDir, 'working-dir', 'history.log'), 'history');
    await fsp.writeFile(outsideFile, OUTSIDE_SECRET);
    await fsp.symlink(outsideFile, path.join(mirrorDir, 'leak.tar'));
    await fsp.mkdir(dottedMirrorDir, { recursive: true });
    await fsp.writeFile(path.join(dottedMirrorDir, 'mirror_000001.tar'), 'dotted');

    await seedOp('artifacts-success', { status: 'success', mirrorDestination: mirrorDir });
    await seedOp('artifacts-failed', { status: 'failed', mirrorDestination: mirrorDir });
    await seedOp('artifacts-missing-dir', {
      status: 'success',
      mirrorDestination: path.join(storageDir, 'mirrors', 'deleted-by-cleanup'),
    });
    await seedOp('artifacts-dotted', { status: 'success', mirrorDestination: dottedMirrorDir });
  });

  // Set explicitly per test: CI may run inside a pod where KUBERNETES_SERVICE_HOST is set.
  beforeEach(() => {
    process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS = 'true';
  });

  afterEach(() => {
    if (originalOverride === undefined) delete process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS;
    else process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS = originalOverride;
  });

  describe('GET /api/operations/:id/artifacts', () => {
    it('lists only the top-level archives, sorted, with sizes and the source folder', async () => {
      const res = await request.get('/api/operations/artifacts-success/artifacts');
      expect(res.status).toBe(200);
      expect(res.body.mirrorDestination).toBe(mirrorDir);
      expect(res.body.artifacts).toEqual([
        { name: 'mirror_000001.tar', size: 4096, modifiedAt: expect.any(String) },
        { name: 'mirror_000002.tar', size: 6, modifiedAt: expect.any(String) },
      ]);
    });

    it('returns 404 when downloads are disabled, even for a successful operation', async () => {
      process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS = 'false';
      const res = await request.get('/api/operations/artifacts-success/artifacts');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Artifact downloads are not enabled');
    });

    it('returns 404 for an unknown operation', async () => {
      const res = await request.get('/api/operations/does-not-exist/artifacts');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Operation not found');
    });

    it('returns 404 for an operation id that tries to escape the operations folder', async () => {
      const res = await request.get(`/api/operations/${encodeURIComponent('../operations/artifacts-success')}/artifacts`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Operation not found');
    });

    it('returns 409 for a failed operation, whose output is incomplete', async () => {
      const res = await request.get('/api/operations/artifacts-failed/artifacts');
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Artifacts are only available for successful operations');
    });

    it('returns an empty list when the destination folder no longer exists', async () => {
      const res = await request.get('/api/operations/artifacts-missing-dir/artifacts');
      expect(res.status).toBe(200);
      expect(res.body.artifacts).toEqual([]);
    });
  });

  describe('GET /api/operations/:id/artifacts/:filename', () => {
    it('streams the exact file as an attachment with its length', async () => {
      const res = await request
        .get('/api/operations/artifacts-success/artifacts/mirror_000001.tar')
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="mirror_000001.tar"');
      expect(res.headers['content-length']).toBe('4096');
      expect(Buffer.compare(res.body as Buffer, archiveBytes)).toBe(0);
    });

    it('is not gzipped by the compression middleware, so Range and resume keep working', async () => {
      const res = await request
        .get('/api/operations/artifacts-success/artifacts/mirror_000001.tar')
        .set('Accept-Encoding', 'gzip')
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('answers a Range request with 206 and exactly the requested bytes (resume)', async () => {
      const res = await request
        .get('/api/operations/artifacts-success/artifacts/mirror_000001.tar')
        .set('Range', 'bytes=1000-1009')
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 1000-1009/4096');
      expect(Buffer.compare(res.body as Buffer, archiveBytes.subarray(1000, 1010))).toBe(0);
    });

    it('downloads from a destination under a dot-directory', async () => {
      const res = await request
        .get('/api/operations/artifacts-dotted/artifacts/mirror_000001.tar')
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      expect((res.body as Buffer).toString()).toBe('dotted');
    });

    it.each([
      ['parent traversal', encodeURIComponent('../../outside-secret.txt')],
      ['encoded backslash', encodeURIComponent('..\\outside-secret.txt')],
      ['dotfile', '.test-write'],
    ])('rejects %s with 400 and leaks nothing', async (_label, filename) => {
      const res = await request.get(`/api/operations/artifacts-success/artifacts/${filename}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid artifact filename');
      expect(res.text).not.toContain(OUTSIDE_SECRET);
    });

    it('returns 404 for a symlink pointing outside the destination', async () => {
      const res = await request.get('/api/operations/artifacts-success/artifacts/leak.tar');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Artifact not found');
      expect(res.text).not.toContain(OUTSIDE_SECRET);
    });

    it('returns 404 for a directory or a missing file', async () => {
      const dirRes = await request.get('/api/operations/artifacts-success/artifacts/working-dir');
      expect(dirRes.status).toBe(404);
      const missingRes = await request.get('/api/operations/artifacts-success/artifacts/mirror_999999.tar');
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.error).toBe('Artifact not found');
    });

    it('applies the same enabled and status checks as the listing', async () => {
      const failed = await request.get('/api/operations/artifacts-failed/artifacts/mirror_000001.tar');
      expect(failed.status).toBe(409);

      process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS = 'false';
      const disabled = await request.get('/api/operations/artifacts-success/artifacts/mirror_000001.tar');
      expect(disabled.status).toBe(404);
      expect(disabled.body.error).toBe('Artifact downloads are not enabled');
    });
  });
});
