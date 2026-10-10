import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AuthFileError,
  resolveCredentialsLocation,
  readAuthFile,
  writeAuthFile,
  listCredentials,
  upsertCredential,
  removeCredential,
  mergeAuthFiles,
} from '../../server/registryCredentials.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');
let dir: string;

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reg-creds-'));
});
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

describe('resolveCredentialsLocation', () => {
  it('defaults to an app-managed file in the storage dir', () => {
    expect(resolveCredentialsLocation({}, '/data')).toEqual({
      path: path.join('/data', 'registry-credentials.json'),
      managedExternally: false,
    });
  });

  it('uses OC_MIRROR_REGISTRY_CREDENTIALS as a read-only external file', () => {
    expect(resolveCredentialsLocation({ OC_MIRROR_REGISTRY_CREDENTIALS: '/secrets/auth.json' }, '/data')).toEqual({
      path: '/secrets/auth.json',
      managedExternally: true,
    });
  });
});

describe('readAuthFile', () => {
  it('treats a missing file as no credentials', async () => {
    await expect(readAuthFile(path.join(dir, 'nope.json'), 'Creds', true)).resolves.toEqual({ auths: {} });
  });

  it('treats an empty file as no credentials (DELETE /api/pull-secret can leave one behind)', async () => {
    const file = path.join(dir, 'empty.json');
    await fs.promises.writeFile(file, '  \n');
    await expect(readAuthFile(file, 'Pull secret', false)).resolves.toEqual({ auths: {} });
  });

  it('fails loudly on invalid JSON instead of pretending there are no credentials', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.promises.writeFile(file, 'not json');
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(AuthFileError);
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(/Creds .*not valid JSON/);
  });

  it('requires a string auth per entry when requireAuth is true', async () => {
    const file = path.join(dir, 'noauth.json');
    await fs.promises.writeFile(file, JSON.stringify({ auths: { 'reg.example.com': { identitytoken: 'x' } } }));
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(/reg\.example\.com/);
    await expect(readAuthFile(file, 'Pull secret', false)).resolves.toEqual({
      auths: { 'reg.example.com': { identitytoken: 'x' } },
    });
  });

  it('rejects a non-object auths value', async () => {
    const file = path.join(dir, 'arr.json');
    await fs.promises.writeFile(file, JSON.stringify({ auths: [] }));
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(AuthFileError);
  });
});

describe('writeAuthFile / upsertCredential / removeCredential', () => {
  it('writes credentials readable only by the owner', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'reg.example.com:5000', 'alice', 'pw:with:colons');
    const mode = (await fs.promises.stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
    const saved = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    expect(saved).toEqual({ auths: { 'reg.example.com:5000': { auth: b64('alice:pw:with:colons') } } });
  });

  it('tightens permissions on an existing file that was too open', async () => {
    const file = path.join(dir, 'open.json');
    await fs.promises.writeFile(file, '{}', { mode: 0o644 });
    await writeAuthFile(file, { auths: {} });
    expect((await fs.promises.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('replaces an existing entry and keeps the others', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'a.example.com', 'u1', 'p1');
    await upsertCredential(file, 'b.example.com', 'u2', 'p2');
    await upsertCredential(file, 'a.example.com', 'u3', 'p3');
    const saved = await readAuthFile(file, 'Creds', true);
    expect(saved.auths['a.example.com'].auth).toBe(b64('u3:p3'));
    expect(saved.auths['b.example.com'].auth).toBe(b64('u2:p2'));
  });

  it('removes an entry and reports whether it existed', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'a.example.com', 'u1', 'p1');
    await expect(removeCredential(file, 'a.example.com')).resolves.toBe(true);
    await expect(removeCredential(file, 'a.example.com')).resolves.toBe(false);
    expect((await readAuthFile(file, 'Creds', true)).auths).toEqual({});
  });
});

describe('listCredentials', () => {
  it('returns registry and username only, never the auth value', () => {
    const listed = listCredentials({ auths: { 'reg.example.com': { auth: b64('bob:secret') } } });
    expect(listed).toEqual([{ registry: 'reg.example.com', username: 'bob' }]);
    expect(JSON.stringify(listed)).not.toContain('secret');
    expect(JSON.stringify(listed)).not.toContain(b64('bob:secret'));
  });
});

describe('mergeAuthFiles', () => {
  it('keeps pull secret hosts and lets destination credentials win on the same host', () => {
    const merged = mergeAuthFiles(
      { auths: { 'registry.redhat.io': { auth: 'rh' }, 'reg.example.com': { auth: 'old' } } },
      { auths: { 'reg.example.com': { auth: 'new' } } },
    );
    expect(merged).toEqual({
      auths: { 'registry.redhat.io': { auth: 'rh' }, 'reg.example.com': { auth: 'new' } },
    });
  });

  // Mirror-to-mirror pulls and pushes with one authfile. When the destination
  // host is also a source host (quay.io/myorg vs quay.io/openshift-release-dev),
  // a host-wide override would replace the pull secret and break source pulls.
  it('scopes destination credentials to the destination path when the pull secret also has that host', () => {
    const merged = mergeAuthFiles(
      { auths: { 'quay.io': { auth: 'rh' } } },
      { auths: { 'quay.io': { auth: 'robot' } } },
      'quay.io/myorg/mirror',
    );
    expect(merged).toEqual({
      auths: { 'quay.io': { auth: 'rh' }, 'quay.io/myorg/mirror': { auth: 'robot' } },
    });
  });

  it('keeps the host-wide override when the destination is a bare host', () => {
    const merged = mergeAuthFiles(
      { auths: { 'reg.example.com:5000': { auth: 'old' } } },
      { auths: { 'reg.example.com:5000': { auth: 'new' } } },
      'reg.example.com:5000',
    );
    expect(merged).toEqual({ auths: { 'reg.example.com:5000': { auth: 'new' } } });
  });
});
