import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isValidArtifactName, listArtifacts, resolveArtifactPath } from '../../server/artifacts.js';

const fsp = fs.promises;

describe('isValidArtifactName', () => {
  it('accepts plain archive names', () => {
    expect(isValidArtifactName('mirror_000001.tar')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['parent traversal', '../secret'],
    ['nested path', 'working-dir/history'],
    ['backslash', '..\\secret'],
    ['dotfile', '.test-write'],
    ['dot-dot', '..'],
    ['NUL byte', 'a\0b'],
  ])('rejects %s so no path outside the destination can be addressed', (_label, name) => {
    expect(isValidArtifactName(name)).toBe(false);
  });
});

describe('listArtifacts / resolveArtifactPath', () => {
  let root: string;
  let dest: string;
  let outside: string;

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'artifacts-unit-'));
    dest = path.join(root, 'dest');
    outside = path.join(root, 'outside.txt');
    await fsp.mkdir(path.join(dest, 'working-dir'), { recursive: true });
    await fsp.writeFile(path.join(dest, 'mirror_000002.tar'), 'bb');
    await fsp.writeFile(path.join(dest, 'mirror_000001.tar'), 'a');
    await fsp.writeFile(path.join(dest, '.test-write'), 'x');
    await fsp.writeFile(outside, 'secret');
    await fsp.symlink(outside, path.join(dest, 'leak.tar'));
  });

  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('lists only top-level regular non-dot files, sorted by name, with sizes', async () => {
    const artifacts = await listArtifacts(dest);
    expect(artifacts.map(a => [a.name, a.size])).toEqual([
      ['mirror_000001.tar', 1],
      ['mirror_000002.tar', 2],
    ]);
    expect(Number.isNaN(Date.parse(artifacts[0].modifiedAt))).toBe(false);
  });

  it('returns an empty list when the destination was deleted', async () => {
    expect(await listArtifacts(path.join(root, 'gone'))).toEqual([]);
  });

  it('resolves a listed archive to its absolute path', async () => {
    expect(await resolveArtifactPath(dest, 'mirror_000001.tar')).toBe(path.join(path.resolve(dest), 'mirror_000001.tar'));
  });

  it('refuses a symlink even though the name is valid, so it cannot leak files outside', async () => {
    expect(await resolveArtifactPath(dest, 'leak.tar')).toBeNull();
  });

  it('refuses directories and missing files', async () => {
    expect(await resolveArtifactPath(dest, 'working-dir')).toBeNull();
    expect(await resolveArtifactPath(dest, 'mirror_999999.tar')).toBeNull();
  });

  it('refuses invalid names', async () => {
    expect(await resolveArtifactPath(dest, '../outside.txt')).toBeNull();
  });
});
