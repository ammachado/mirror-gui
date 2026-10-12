import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverCatalogRepos,
  discoverRegistryContents,
  listTags,
  parseFromRegistryRequest,
  parseReleaseTags,
  type DiscoveryDeps,
} from '../../server/registryDiscovery.js';
import { RegistryHttpError, type RegistryGet } from '../../server/registryAuth.js';
import type { CatalogOperator } from '../../server/imagesetFromRegistry.js';
import { createFakeRegistry } from '../helpers/fakeRegistry.js';

describe('parseFromRegistryRequest', () => {
  it('accepts a full request', () => {
    const result = parseFromRegistryRequest({
      registry: 'mirror.example.com:8443',
      namespace: 'ocp4',
      catalogs: ['ocp4/redhat/redhat-operator-index:v4.16'],
      sourceCatalogPrefix: 'registry.redhat.io/redhat',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        registry: 'mirror.example.com:8443',
        namespace: 'ocp4',
        catalogs: ['ocp4/redhat/redhat-operator-index:v4.16'],
        sourceCatalogPrefix: 'registry.redhat.io/redhat',
      },
    });
  });

  it('defaults optional fields', () => {
    expect(parseFromRegistryRequest({ registry: 'mirror.example.com' })).toEqual({
      ok: true,
      value: { registry: 'mirror.example.com', namespace: '', catalogs: [], sourceCatalogPrefix: undefined },
    });
  });

  it.each([
    ['non-object body', 'nope'],
    ['missing registry', {}],
    ['registry with scheme', { registry: 'https://mirror.example.com' }],
    ['registry with path', { registry: 'mirror.example.com/ocp4' }],
    ['registry with whitespace', { registry: 'mirror example.com' }],
    ['namespace traversal', { registry: 'm.example.com', namespace: 'a/../b' }],
    ['namespace leading slash', { registry: 'm.example.com', namespace: '/ocp4' }],
    ['catalog without tag', { registry: 'm.example.com', catalogs: ['ocp4/redhat/index'] }],
    ['catalogs not an array', { registry: 'm.example.com', catalogs: 'x' }],
    ['bad source prefix', { registry: 'm.example.com', sourceCatalogPrefix: 'https://registry.redhat.io' }],
  ])('rejects %s', (_label, body) => {
    expect(parseFromRegistryRequest(body).ok).toBe(false);
  });
});

describe('parseReleaseTags', () => {
  it('keeps release tags and reports everything else, including cosign signatures', () => {
    const { releases, ignored } = parseReleaseTags([
      '4.16.1-x86_64',
      '4.16.2-aarch64',
      'latest',
      'sha256-0123abcd.sig',
      '4.16.3',
    ]);
    expect(releases).toEqual([
      { version: '4.16.1', arch: 'x86_64' },
      { version: '4.16.2', arch: 'aarch64' },
    ]);
    expect(ignored).toEqual(['latest', 'sha256-0123abcd.sig', '4.16.3']);
  });
});

describe('listTags', () => {
  it('follows Link pagination', async () => {
    const get = createFakeRegistry({
      repos: { 'ns/repo': ['a', 'b', 'c', 'd', 'e'] },
      pageSize: 2,
    });
    expect(await listTags(get, 'ns/repo')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns null when the repository does not exist', async () => {
    const get = createFakeRegistry({ repos: {} });
    expect(await listTags(get, 'ns/missing')).toBeNull();
  });

  it('throws RegistryHttpError on other failures', async () => {
    const get: RegistryGet = async () => ({
      ok: false,
      status: 500,
      header: () => null,
      text: async () => '',
    });
    await expect(listTags(get, 'ns/repo')).rejects.toBeInstanceOf(RegistryHttpError);
  });
});

describe('discoverCatalogRepos', () => {
  const repos = {
    'ocp4/openshift/release-images': ['4.16.1-x86_64'],
    'ocp4/redhat/redhat-operator-index': ['v4.16'],
    'other/redhat/redhat-operator-index': ['v4.16'],
    'ocp4/something-else': ['x'],
  };

  it('uses the catalog listing, scoped to the namespace and to index repos', async () => {
    const get = createFakeRegistry({ repos });
    expect(await discoverCatalogRepos(get, 'ocp4')).toEqual(['ocp4/redhat/redhat-operator-index']);
  });

  it('probes standard names when the listing is forbidden', async () => {
    const get = createFakeRegistry({ repos, catalogListing: false });
    const found = await discoverCatalogRepos(get, 'ocp4');
    expect(found).toEqual(['ocp4/redhat/redhat-operator-index']);
    expect(get.calls).toContain('/v2/ocp4/redhat/certified-operator-index/tags/list?n=1000');
  });
});

describe('discoverRegistryContents', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'discovery-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  const odf: CatalogOperator = {
    name: 'odf-operator',
    channels: ['stable-4.16'],
    channelVersionRanges: { 'stable-4.16': { minVersion: '4.16.2', maxVersion: '4.16.8' } },
  };

  function makeDeps(overrides: Partial<DiscoveryDeps> = {}) {
    const ocCalls: string[][] = [];
    const deps: DiscoveryDeps = {
      get: createFakeRegistry({
        repos: {
          'ocp4/openshift/release-images': ['4.16.1-x86_64', '4.16.2-x86_64', 'sha256-aa.sig', 'latest'],
          'ocp4/redhat/redhat-operator-index': ['v4.16', 'sha256-bb.sig'],
          'ocp4/redhat/certified-operator-index': ['v4.16'],
        },
      }),
      runOc: async (args) => {
        ocCalls.push(args);
      },
      generateMetadata: async (_dir, catalogType) => {
        if (catalogType === 'certified-operator-index') throw new Error('boom');
        return [odf];
      },
      tmpRoot,
      registryConfigPath: '/pull/secret.json',
      ...overrides,
    };
    return { deps, ocCalls };
  }

  it('returns releases and catalogs and keeps going when one catalog fails', async () => {
    const { deps } = makeDeps();
    const result = await discoverRegistryContents(deps, {
      registry: 'mirror.example.com:8443',
      namespace: 'ocp4',
      catalogs: [],
    });

    expect(result.releases).toEqual([
      { version: '4.16.1', arch: 'x86_64' },
      { version: '4.16.2', arch: 'x86_64' },
    ]);
    expect(result.catalogs).toEqual([
      {
        repo: 'ocp4/redhat/redhat-operator-index',
        tag: 'v4.16',
        ref: 'mirror.example.com:8443/ocp4/redhat/redhat-operator-index:v4.16',
        operators: [odf],
      },
    ]);
    expect(result.warnings).toContain(
      'Skipped catalog mirror.example.com:8443/ocp4/redhat/certified-operator-index:v4.16: boom',
    );
    expect(result.warnings.some((w) => w.includes('Ignored 2 tag(s)') && w.includes('ocp4/openshift/release-images'))).toBe(true);
  });

  it('extracts with the pull secret and insecure flag, then removes temp dirs', async () => {
    const { deps, ocCalls } = makeDeps();
    await discoverRegistryContents(deps, { registry: 'mirror.example.com:8443', namespace: 'ocp4', catalogs: [] });

    const call = ocCalls.find((args) => args.includes('mirror.example.com:8443/ocp4/redhat/redhat-operator-index:v4.16'));
    expect(call).toBeDefined();
    expect(call).toEqual(expect.arrayContaining(['image', 'extract', '--insecure', '--registry-config=/pull/secret.json']));
    expect(call?.some((a) => a.startsWith('--path=/configs/:') && a.endsWith('/configs'))).toBe(true);
    expect(await fs.promises.readdir(tmpRoot)).toEqual([]);
  });

  it('adds manual catalogs and does not duplicate discovered ones', async () => {
    const { deps } = makeDeps();
    const result = await discoverRegistryContents(deps, {
      registry: 'mirror.example.com:8443',
      namespace: 'ocp4',
      catalogs: ['ocp4/redhat/redhat-operator-index:v4.16', 'ocp4/custom/my-index:v1'],
    });
    const refs = result.catalogs.map((c) => c.ref).sort();
    expect(refs).toEqual([
      'mirror.example.com:8443/ocp4/custom/my-index:v1',
      'mirror.example.com:8443/ocp4/redhat/redhat-operator-index:v4.16',
    ]);
  });

  it('still succeeds with a warning when there is no release-images repository', async () => {
    const { deps } = makeDeps({
      get: createFakeRegistry({ repos: { 'ocp4/redhat/redhat-operator-index': ['v4.16'] } }),
    });
    const result = await discoverRegistryContents(deps, {
      registry: 'mirror.example.com:8443',
      namespace: 'ocp4',
      catalogs: [],
    });
    expect(result.releases).toEqual([]);
    expect(result.catalogs).toHaveLength(1);
    expect(result.warnings).toContain(
      'No release images repository found at mirror.example.com:8443/ocp4/openshift/release-images',
    );
  });

  it('runs at most three extractions at once', async () => {
    const repos: Record<string, string[]> = {};
    for (let i = 0; i < 7; i++) repos[`ocp4/redhat/c${i}-index`] = ['v1'];
    let active = 0;
    let peak = 0;
    const { deps } = makeDeps({
      get: createFakeRegistry({ repos }),
      generateMetadata: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return [odf];
      },
    });
    await discoverRegistryContents(deps, { registry: 'm.example.com', namespace: 'ocp4', catalogs: [] });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
