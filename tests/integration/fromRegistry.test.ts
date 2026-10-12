import os from 'os';
import YAML from 'yaml';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { __routeTestHooks } from '../../server/index.js';
import { RegistryHttpError } from '../../server/registryAuth.js';
import type { DiscoveryDeps } from '../../server/registryDiscovery.js';
import { createFakeRegistry } from '../helpers/fakeRegistry.js';
import { getTestApp } from './helpers/testApp.js';

const REGISTRY = 'mirror.example.com:8443';

function depsFor(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    get: createFakeRegistry({
      repos: {
        'ocp4/openshift/release-images': ['4.16.1-x86_64', '4.16.2-x86_64', '4.16.2-aarch64'],
        'ocp4/redhat/redhat-operator-index': ['v4.16'],
        'ocp4/redhat/certified-operator-index': ['v4.16'],
      },
    }),
    runOc: async () => {},
    generateMetadata: async (_dir, catalogType) => {
      if (catalogType === 'certified-operator-index') throw new Error('extract failed');
      return [
        {
          name: 'odf-operator',
          channels: ['stable-4.16'],
          channelVersionRanges: { 'stable-4.16': { minVersion: '4.16.2', maxVersion: '4.16.8' } },
        },
      ];
    },
    tmpRoot: os.tmpdir(),
    registryConfigPath: null,
    ...overrides,
  };
}

describe('POST /api/config/from-registry', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  afterEach(() => {
    __routeTestHooks.registryDeps = undefined;
  });

  it('returns 400 for invalid input', async () => {
    const empty = await request.post('/api/config/from-registry').send({});
    expect(empty.status).toBe(400);

    const withScheme = await request
      .post('/api/config/from-registry')
      .send({ registry: 'https://mirror.example.com' });
    expect(withScheme.status).toBe(400);
    expect(withScheme.body.error).toMatch(/registry/);
  });

  it('reconstructs releases and operators and reports the skipped catalog', async () => {
    __routeTestHooks.registryDeps = depsFor();

    const res = await request
      .post('/api/config/from-registry')
      .send({ registry: REGISTRY, namespace: 'ocp4' });

    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({
      kind: 'ImageSetConfiguration',
      apiVersion: 'mirror.openshift.io/v2alpha1',
      mirror: {
        platform: {
          channels: [{ name: 'stable-4.16', type: 'ocp', minVersion: '4.16.1', maxVersion: '4.16.2' }],
          architectures: ['amd64', 'arm64'],
          graph: true,
        },
        operators: [
          {
            catalog: `${REGISTRY}/ocp4/redhat/redhat-operator-index:v4.16`,
            packages: [
              {
                name: 'odf-operator',
                channels: [{ name: 'stable-4.16', minVersion: '4.16.2', maxVersion: '4.16.8' }],
              },
            ],
          },
        ],
      },
    });
    expect(YAML.parse(res.body.yaml)).toEqual(res.body.config);
    expect(res.body.discovered.catalogs).toEqual([
      { ref: `${REGISTRY}/ocp4/redhat/redhat-operator-index:v4.16`, packageCount: 1 },
    ]);
    expect(res.body.discovered.warnings).toContain(
      `Skipped catalog ${REGISTRY}/ocp4/redhat/certified-operator-index:v4.16: extract failed`,
    );
  });

  it('produces YAML that the save and upload endpoints accept', async () => {
    __routeTestHooks.registryDeps = depsFor();
    const res = await request
      .post('/api/config/from-registry')
      .send({ registry: REGISTRY, namespace: 'ocp4' });

    const saved = await request
      .post('/api/config/save')
      .send({ config: res.body.yaml, name: 'from-registry-save' });
    expect(saved.status).toBe(200);

    const uploaded = await request
      .post('/api/config/upload')
      .send({ filename: 'from-registry-upload', content: res.body.yaml });
    expect(uploaded.status).toBe(200);
  });

  it('rewrites catalog refs when sourceCatalogPrefix is given', async () => {
    __routeTestHooks.registryDeps = depsFor();
    const res = await request.post('/api/config/from-registry').send({
      registry: REGISTRY,
      namespace: 'ocp4',
      sourceCatalogPrefix: 'registry.redhat.io/redhat',
    });
    expect(res.body.config.mirror.operators[0].catalog).toBe(
      'registry.redhat.io/redhat/redhat-operator-index:v4.16',
    );
  });

  it('returns 200 with a warning when the registry only has catalogs', async () => {
    __routeTestHooks.registryDeps = depsFor({
      get: createFakeRegistry({ repos: { 'ocp4/redhat/redhat-operator-index': ['v4.16'] } }),
    });
    const res = await request
      .post('/api/config/from-registry')
      .send({ registry: REGISTRY, namespace: 'ocp4' });
    expect(res.status).toBe(200);
    expect(res.body.config.mirror.platform).toBeUndefined();
    expect(res.body.discovered.warnings).toContain(
      `No release images repository found at ${REGISTRY}/ocp4/openshift/release-images`,
    );
  });

  it('returns 404 with warnings when nothing is found', async () => {
    __routeTestHooks.registryDeps = depsFor({ get: createFakeRegistry({ repos: {} }) });
    const res = await request
      .post('/api/config/from-registry')
      .send({ registry: REGISTRY, namespace: 'ocp4' });
    expect(res.status).toBe(404);
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('passes registry authorization failures through as 401', async () => {
    __routeTestHooks.registryDeps = depsFor({
      get: async () => {
        throw new RegistryHttpError(401, 'Registry returned HTTP 401 for ocp4/openshift/release-images');
      },
    });
    const res = await request
      .post('/api/config/from-registry')
      .send({ registry: REGISTRY, namespace: 'ocp4' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/401/);
  });
});
