import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getTestApp } from './helpers/testApp.js';

const storageDir = process.env.STORAGE_DIR!;
const appManagedFile = path.join(storageDir, 'registry-credentials.json');

describe('Destination registry credentials API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  afterEach(async () => {
    delete process.env.OC_MIRROR_REGISTRY_CREDENTIALS;
    await fs.promises.rm(appManagedFile, { force: true });
  });

  it('lists nothing when no credentials file exists', async () => {
    const res = await request.get('/api/registry-credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ managedExternally: false, path: null, credentials: [] });
  });

  it('saves a credential, lists it without the password, and stores it 0600', async () => {
    const put = await request
      .put('/api/registry-credentials')
      .send({ registry: 'mirror.example.com:5000', username: 'alice', password: 'Sup3rSecret' });
    expect(put.status).toBe(200);

    const res = await request.get('/api/registry-credentials');
    expect(res.body.credentials).toEqual([
      { registry: 'mirror.example.com:5000', username: 'alice', status: 'not_verified' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Sup3rSecret');
    expect(JSON.stringify(res.body)).not.toContain(Buffer.from('alice:Sup3rSecret').toString('base64'));
    expect((await fs.promises.stat(appManagedFile)).mode & 0o777).toBe(0o600);
  });

  it.each([
    [{ registry: 'https://mirror.example.com', username: 'a', password: 'b' }, /registry/i],
    [{ registry: 'mirror.example.com/ns', username: 'a', password: 'b' }, /registry/i],
    [{ registry: 'mirror.example.com', username: '', password: 'b' }, /username/i],
    [{ registry: 'mirror.example.com', username: 'a:b', password: 'b' }, /username/i],
    [{ registry: 'mirror.example.com', username: 'a', password: '' }, /password/i],
  ])('rejects invalid input %o', async (body, message) => {
    const res = await request.put('/api/registry-credentials').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('deletes a credential and returns 404 when it is already gone', async () => {
    await request
      .put('/api/registry-credentials')
      .send({ registry: 'mirror.example.com', username: 'a', password: 'b' });
    const del = await request.delete('/api/registry-credentials/mirror.example.com');
    expect(del.status).toBe(200);
    const again = await request.delete('/api/registry-credentials/mirror.example.com');
    expect(again.status).toBe(404);
  });

  it('reports a failed verification without network access when no credential exists', async () => {
    const res = await request.post('/api/registry-credentials/verify').send({ registry: 'unknown.example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      registry: 'unknown.example.com',
      status: 'failed',
      error: 'No credentials found for this registry',
    });
  });

  describe('externally managed file', () => {
    it('lists entries read-only and refuses writes with 409', async () => {
      const external = path.join(storageDir, 'external-auth.json');
      await fs.promises.writeFile(
        external,
        JSON.stringify({ auths: { 'ext.example.com': { auth: Buffer.from('ext:pw').toString('base64') } } }),
      );
      process.env.OC_MIRROR_REGISTRY_CREDENTIALS = external;

      const res = await request.get('/api/registry-credentials');
      expect(res.body.managedExternally).toBe(true);
      expect(res.body.path).toBe(external);
      expect(res.body.credentials).toEqual([
        { registry: 'ext.example.com', username: 'ext', status: 'not_verified' },
      ]);

      const put = await request
        .put('/api/registry-credentials')
        .send({ registry: 'x.example.com', username: 'a', password: 'b' });
      expect(put.status).toBe(409);
      expect(put.body.error).toMatch(/managed outside the application/);

      const del = await request.delete('/api/registry-credentials/ext.example.com');
      expect(del.status).toBe(409);
      expect(JSON.parse(await fs.promises.readFile(external, 'utf8')).auths).toHaveProperty('ext.example.com');
    });

    it('surfaces a malformed file as an error instead of an empty list', async () => {
      const external = path.join(storageDir, 'broken-auth.json');
      await fs.promises.writeFile(external, '{ not json');
      process.env.OC_MIRROR_REGISTRY_CREDENTIALS = external;

      const res = await request.get('/api/registry-credentials');
      expect(res.status).toBe(200);
      expect(res.body.credentials).toEqual([]);
      expect(res.body.error).toMatch(/not valid JSON/);
    });
  });
});
