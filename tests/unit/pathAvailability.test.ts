import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isPathAvailable } from '../../server/pathAvailability.js';

describe('isPathAvailable', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'path-avail-'));
  });

  afterAll(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('returns true for existing writable path', async () => {
    const writablePath = path.join(tempDir, 'writable');
    await fs.promises.mkdir(writablePath, { recursive: true });
    expect(await isPathAvailable(writablePath)).toBe(true);
  });

  it('returns true for non-existent path with writable parent', async () => {
    const nestedPath = path.join(tempDir, 'nested', 'does', 'not', 'exist');
    expect(await isPathAvailable(nestedPath)).toBe(true);
  });

  it('returns false when nearest existing ancestor is not writable', async () => {
    const accessSpy = vi.spyOn(fs.promises, 'access');
    accessSpy
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('read-only'), { code: 'EACCES' }));

    try {
      expect(await isPathAvailable(path.join(tempDir, 'read-only', 'sub'))).toBe(false);
    } finally {
      accessSpy.mockRestore();
    }
  });

  it('handles existing directory that is writable', async () => {
    const subDir = path.join(tempDir, 'subdir');
    await fs.promises.mkdir(subDir, { recursive: true });
    expect(await isPathAvailable(subDir)).toBe(true);
  });
});
