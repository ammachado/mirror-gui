import { describe, it, expect } from 'vitest';
import {
  buildImageSetConfig,
  type DiscoveredCatalog,
  type ReleaseTag,
} from '../../server/imagesetFromRegistry.js';

const catalog = (overrides: Partial<DiscoveredCatalog> = {}): DiscoveredCatalog => ({
  repo: 'ocp4/redhat/redhat-operator-index',
  tag: 'v4.16',
  ref: 'mirror.example.com:8443/ocp4/redhat/redhat-operator-index:v4.16',
  operators: [
    {
      name: 'odf-operator',
      channels: ['stable-4.16', 'stable-4.15'],
      channelVersionRanges: {
        'stable-4.16': { minVersion: '4.16.2', maxVersion: '4.16.8' },
        'stable-4.15': { minVersion: null, maxVersion: null },
      },
    },
    { name: 'aaa-operator', channels: [], channelVersionRanges: {} },
  ],
  ...overrides,
});

describe('buildImageSetConfig platform', () => {
  const releases: ReleaseTag[] = [
    { version: '4.16.1', arch: 'x86_64' },
    { version: '4.16.1', arch: 'aarch64' },
    { version: '4.16.3', arch: 'x86_64' },
    { version: '4.16.10', arch: 'x86_64' },
    { version: '4.17.0', arch: 'x86_64' },
  ];

  it('groups releases by minor into stable channels with numeric min and max', () => {
    const { config } = buildImageSetConfig({ releases, catalogs: [] });
    expect(config.mirror.platform).toEqual({
      channels: [
        { name: 'stable-4.16', type: 'ocp', minVersion: '4.16.1', maxVersion: '4.16.10' },
        { name: 'stable-4.17', type: 'ocp', minVersion: '4.17.0', maxVersion: '4.17.0' },
      ],
      architectures: ['amd64', 'arm64'],
      graph: true,
    });
  });

  it('warns about missing z-streams inside a range and about the assumed channel name', () => {
    const { warnings } = buildImageSetConfig({ releases, catalogs: [] });
    expect(warnings).toContain(
      'stable-4.16: no release found for 4.16.2, 4.16.4, 4.16.5, 4.16.6, 4.16.7, 4.16.8, 4.16.9 between 4.16.1 and 4.16.10',
    );
    expect(warnings.some((w) => w.includes('stable-X.Y') && w.includes('assumed'))).toBe(true);
  });

  it('does not duplicate a version published for several architectures', () => {
    const { warnings } = buildImageSetConfig({
      releases: [
        { version: '4.16.1', arch: 'x86_64' },
        { version: '4.16.1', arch: 'aarch64' },
      ],
      catalogs: [],
    });
    expect(warnings.filter((w) => w.includes('no release found'))).toEqual([]);
  });
});

describe('buildImageSetConfig operators', () => {
  it('maps packages and channels with sorted, deterministic output', () => {
    const { config } = buildImageSetConfig({ releases: [], catalogs: [catalog()] });
    expect(config.mirror.operators).toEqual([
      {
        catalog: 'mirror.example.com:8443/ocp4/redhat/redhat-operator-index:v4.16',
        packages: [
          { name: 'aaa-operator' },
          {
            name: 'odf-operator',
            channels: [
              { name: 'stable-4.15' },
              { name: 'stable-4.16', minVersion: '4.16.2', maxVersion: '4.16.8' },
            ],
          },
        ],
      },
    ]);
  });

  it('rewrites catalog refs to the source registry when a prefix is given', () => {
    const { config } = buildImageSetConfig({
      releases: [],
      catalogs: [catalog()],
      sourceCatalogPrefix: 'registry.redhat.io/redhat',
    });
    expect(config.mirror.operators?.[0].catalog).toBe(
      'registry.redhat.io/redhat/redhat-operator-index:v4.16',
    );
  });

  it('skips a catalog with no packages, because an empty filter would mirror everything', () => {
    const { config, warnings } = buildImageSetConfig({
      releases: [],
      catalogs: [catalog({ operators: [] })],
    });
    expect(config.mirror.operators).toBeUndefined();
    expect(warnings).toContain(
      'Skipped catalog mirror.example.com:8443/ocp4/redhat/redhat-operator-index:v4.16: no packages found',
    );
  });
});

describe('buildImageSetConfig envelope', () => {
  it('emits the ImageSetConfiguration header and an empty mirror when nothing was found', () => {
    const { config } = buildImageSetConfig({ releases: [], catalogs: [] });
    expect(config).toEqual({
      kind: 'ImageSetConfiguration',
      apiVersion: 'mirror.openshift.io/v2alpha1',
      mirror: {},
    });
  });
});
