import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import process from 'process';

const catalogDataDir = path.join(process.cwd(), 'tests/fixtures/catalog-data');
const expectedCatalogTypes = [
  'redhat-operator-index',
  'certified-operator-index',
  'community-operator-index',
];

interface CatalogEntry {
  catalog_type: string;
  ocp_version: string;
  catalog_url: string;
  operator_count: number;
}

interface CatalogIndex {
  ocp_versions: string[];
  catalog_types: string[];
  catalogs: CatalogEntry[];
}

interface OperatorRecord {
  name: string;
  defaultChannel: string;
  channels: string[];
  channelVersions: Record<string, string[]>;
  channelVersionRanges: Record<string, { minVersion: string; maxVersion: string }>;
  catalog: string;
  ocpVersion: string;
  catalogUrl: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

describe('catalog metadata fixture integrity', () => {
  let catalogIndex: CatalogIndex;

  beforeAll(async () => {
    catalogIndex = await readJson<CatalogIndex>(path.join(catalogDataDir, 'catalog-index.json'));
  });

  it('declares the supported fixture versions and catalogs', () => {
    expect(catalogIndex.ocp_versions).toEqual(['4.21']);
    expect(catalogIndex.catalog_types).toEqual(expectedCatalogTypes);
    expect(catalogIndex.catalogs).toHaveLength(expectedCatalogTypes.length);
  });

  it.each(expectedCatalogTypes)('validates %s operator metadata', async (catalogType) => {
    const entry = catalogIndex.catalogs.find((catalog) => catalog.catalog_type === catalogType);
    expect(entry).toBeDefined();
    expect(entry!.ocp_version).toBe('v4.21');
    expect(entry!.catalog_url).toMatch(/^registry\.redhat\.io\//);

    const versionDir = path.join(catalogDataDir, catalogType, entry!.ocp_version);
    const operators = await readJson<OperatorRecord[]>(path.join(versionDir, 'operators.json'));
    expect(operators).toHaveLength(entry!.operator_count);
    expect(operators.length).toBeGreaterThan(0);

    for (const operator of operators) {
      expect(operator.name).toBeTruthy();
      expect(operator.catalog).toBe(catalogType);
      expect(operator.ocpVersion).toBe(entry!.ocp_version);
      expect(operator.catalogUrl).toBe(entry!.catalog_url);
      expect(operator.channels.length).toBeGreaterThan(0);
      expect(operator.channels).toContain(operator.defaultChannel);

      for (const channel of operator.channels) {
        expect(operator.channelVersions[channel]?.length).toBeGreaterThan(0);
        expect(operator.channelVersionRanges[channel]?.minVersion).toBeTruthy();
        expect(operator.channelVersionRanges[channel]?.maxVersion).toBeTruthy();
      }
    }

    if (catalogType === 'redhat-operator-index') {
      const dependencies = await readJson<Record<string, { packageName: string; versionRange: string }[]>>(
        path.join(versionDir, 'dependencies.json'),
      );
      expect(Object.keys(dependencies).length).toBeGreaterThan(0);
      for (const operatorDependencies of Object.values(dependencies)) {
        expect(operatorDependencies.length).toBeGreaterThan(0);
        for (const dependency of operatorDependencies) {
          expect(dependency.packageName).toBeTruthy();
          expect(dependency.versionRange).toBeTruthy();
        }
      }
    }
  });
});
