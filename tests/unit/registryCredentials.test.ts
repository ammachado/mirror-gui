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
  removeStaleAuthfiles,
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

  it('does not treat inherited object keys as stored credentials', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'a.example.com', 'u1', 'p1');
    await expect(removeCredential(file, 'constructor')).resolves.toBe(false);
    await expect(removeCredential(file, 'toString')).resolves.toBe(false);
  });

  // A "__proto__" key would be swallowed by the object prototype and never
  // reach the file, so the user would see "saved" but nothing was stored.
  it('rejects registry names that are not valid hosts, including __proto__', async () => {
    const file = path.join(dir, 'creds.json');
    await expect(upsertCredential(file, '__proto__', 'u', 'p')).rejects.toThrow(/registry/i);
    await expect(upsertCredential(file, 'https://reg.example.com', 'u', 'p')).rejects.toThrow(/registry/i);
    await expect(fs.promises.access(file)).rejects.toThrow();
  });

  // Concurrent Settings saves must not lose each other's entries.
  it('keeps every entry when upserts and removes run concurrently', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'gone.example.com', 'u0', 'p0');
    await Promise.all([
      upsertCredential(file, 'a.example.com', 'u1', 'p1'),
      upsertCredential(file, 'b.example.com', 'u2', 'p2'),
      upsertCredential(file, 'c.example.com', 'u3', 'p3'),
      removeCredential(file, 'gone.example.com'),
    ]);
    const saved = await readAuthFile(file, 'Creds', true);
    expect(Object.keys(saved.auths).sort()).toEqual(['a.example.com', 'b.example.com', 'c.example.com']);
  });

  // Replacing the file by rename means a reader never sees a half-written
  // file, and the new content is never briefly readable with the old,
  // looser permissions.
  it('replaces the file atomically and leaves no temporary files behind', async () => {
    const file = path.join(dir, 'open.json');
    await fs.promises.writeFile(file, '{"auths":{}}', { mode: 0o644 });
    const before = await fs.promises.stat(file);
    await writeAuthFile(file, { auths: { 'a.example.com': { auth: b64('u:p') } } });
    const after = await fs.promises.stat(file);
    expect(after.ino).not.toBe(before.ino);
    expect(after.mode & 0o777).toBe(0o600);
    expect(await fs.promises.readdir(dir)).toEqual(['open.json']);
  });

  it('leaves a malformed file untouched instead of overwriting it on upsert or remove', async () => {
    const file = path.join(dir, 'creds.json');
    await fs.promises.writeFile(file, '{not json');
    await expect(upsertCredential(file, 'a.example.com', 'u', 'p')).rejects.toBeInstanceOf(AuthFileError);
    await expect(removeCredential(file, 'a.example.com')).rejects.toBeInstanceOf(AuthFileError);
    expect(await fs.promises.readFile(file, 'utf8')).toBe('{not json');
  });
});

describe('readAuthFile edge cases', () => {
  it('rejects an entry that is not an object', async () => {
    const file = path.join(dir, 'creds.json');
    await fs.promises.writeFile(file, JSON.stringify({ auths: { 'a.example.com': 'b64' } }));
    await expect(readAuthFile(file, 'Creds', false)).rejects.toThrow(/entry "a\.example\.com" must be an object/);
  });

  it('reports read failures other than a missing file instead of returning no credentials', async () => {
    await expect(readAuthFile(dir, 'Creds', true)).rejects.toThrow(/could not be read/);
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

// Temporary authfiles hold the whole pull secret plus destination credentials.
// After a crash nothing removes them, so startup sweeps them.
describe('removeStaleAuthfiles', () => {
  it('deletes leftover temporary authfiles and keeps everything else', async () => {
    await fs.promises.writeFile(path.join(dir, 'authfile-1.json'), '{}');
    await fs.promises.writeFile(path.join(dir, 'authfile-2.json'), '{}');
    await fs.promises.writeFile(path.join(dir, 'keep.json'), '{}');
    await expect(removeStaleAuthfiles(dir)).resolves.toBe(2);
    expect(await fs.promises.readdir(dir)).toEqual(['keep.json']);
  });

  it('does nothing when the run folder does not exist yet', async () => {
    await expect(removeStaleAuthfiles(path.join(dir, 'missing'))).resolves.toBe(0);
  });
});
