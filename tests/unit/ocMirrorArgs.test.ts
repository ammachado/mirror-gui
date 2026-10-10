import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'url';
import { buildOcMirrorArgs } from '../../server/ocMirrorArgs.js';

const base = {
  configPath: '/data/configs/isc.yaml',
  folderPath: '/data/mirrors/prod',
  cacheDir: '/data/cache',
  authfilePath: '/data/run/authfile-123.json',
  additionalArgs: ['--retry-times', '3'],
};
const folderUrl = pathToFileURL('/data/mirrors/prod').href;

describe('buildOcMirrorArgs', () => {
  it('keeps the mirror-to-disk argv identical to the pre-existing command', () => {
    expect(buildOcMirrorArgs({ ...base, mode: 'mirrorToDisk' })).toEqual([
      '--v2',
      '--config', '/data/configs/isc.yaml',
      '--dest-tls-verify=false',
      '--src-tls-verify=false',
      '--cache-dir', '/data/cache',
      '--authfile', '/data/run/authfile-123.json',
      '--retry-times', '3',
      folderUrl,
    ]);
  });

  it('builds mirror-to-mirror with --workspace and a docker:// destination, verifying TLS by default', () => {
    expect(
      buildOcMirrorArgs({ ...base, mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com:5000/ocp' }),
    ).toEqual([
      '--v2',
      '--config', '/data/configs/isc.yaml',
      '--workspace', folderUrl,
      '--dest-tls-verify=true',
      '--src-tls-verify=false',
      '--cache-dir', '/data/cache',
      '--authfile', '/data/run/authfile-123.json',
      '--retry-times', '3',
      'docker://reg.example.com:5000/ocp',
    ]);
  });

  it('builds disk-to-mirror with --from and honors the TLS opt-out', () => {
    expect(
      buildOcMirrorArgs({
        ...base,
        mode: 'diskToMirror',
        destinationRegistry: 'reg.example.com',
        skipDestTlsVerify: true,
      }),
    ).toEqual([
      '--v2',
      '--config', '/data/configs/isc.yaml',
      '--from', folderUrl,
      '--dest-tls-verify=false',
      '--src-tls-verify=false',
      '--cache-dir', '/data/cache',
      '--authfile', '/data/run/authfile-123.json',
      '--retry-times', '3',
      'docker://reg.example.com',
    ]);
  });

  it('never passes both --from and --workspace, which oc-mirror rejects', () => {
    for (const mode of ['mirrorToMirror', 'diskToMirror'] as const) {
      const args = buildOcMirrorArgs({ ...base, mode, destinationRegistry: 'reg.example.com' });
      expect(args.includes('--from') && args.includes('--workspace')).toBe(false);
    }
  });

  it('ignores destination settings in mirror-to-disk so a stale form value cannot change the M2D command', () => {
    const plain = buildOcMirrorArgs({ ...base, mode: 'mirrorToDisk' });
    const withDestination = buildOcMirrorArgs({
      ...base,
      mode: 'mirrorToDisk',
      destinationRegistry: 'reg.example.com/ocp',
      skipDestTlsVerify: false,
    });
    expect(withDestination).toEqual(plain);
  });

  it('verifies destination TLS when skipDestTlsVerify is explicitly false', () => {
    const args = buildOcMirrorArgs({ ...base, mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com', skipDestTlsVerify: false });
    expect(args).toContain('--dest-tls-verify=true');
    expect(args).not.toContain('--dest-tls-verify=false');
  });

  it('throws when a registry-target mode has no destination, instead of building a broken command', () => {
    expect(() => buildOcMirrorArgs({ ...base, mode: 'mirrorToMirror' })).toThrow(/destinationRegistry/);
  });
});
