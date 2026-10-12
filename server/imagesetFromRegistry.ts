import { compareVersionStrings, sortVersions } from './utils.js';

export interface ReleaseTag {
  version: string;
  arch: string;
}

export interface ChannelRange {
  minVersion: string | null;
  maxVersion: string | null;
}

export interface CatalogOperator {
  name: string;
  channels: string[];
  channelVersionRanges: Record<string, ChannelRange>;
}

export interface DiscoveredCatalog {
  repo: string;
  tag: string;
  ref: string;
  operators: CatalogOperator[];
}

export const ARCH_MAP: Record<string, string> = {
  x86_64: 'amd64',
  aarch64: 'arm64',
  ppc64le: 'ppc64le',
  s390x: 's390x',
};

interface PlatformChannel {
  name: string;
  type: 'ocp';
  minVersion: string;
  maxVersion: string;
}

export interface PlatformSection {
  channels: PlatformChannel[];
  architectures: string[];
  graph: true;
}

interface PackageChannel {
  name: string;
  minVersion?: string;
  maxVersion?: string;
}

interface PackageEntry {
  name: string;
  channels?: PackageChannel[];
}

export interface OperatorCatalogEntry {
  catalog: string;
  packages: PackageEntry[];
}

export interface ImageSetConfigFromRegistry {
  kind: 'ImageSetConfiguration';
  apiVersion: 'mirror.openshift.io/v2alpha1';
  mirror: {
    platform?: PlatformSection;
    operators?: OperatorCatalogEntry[];
  };
}

const MAX_LISTED_GAPS = 10;

function findMissingPatches(minor: string, versions: string[]): string[] {
  const patches = new Set(versions.map((version) => Number(version.split('.')[2])));
  const lowest = Math.min(...patches);
  const highest = Math.max(...patches);
  const missing: string[] = [];
  for (let patch = lowest; patch <= highest; patch++) {
    if (!patches.has(patch)) missing.push(`${minor}.${patch}`);
  }
  return missing;
}

function describeGaps(missing: string[]): string {
  if (missing.length <= MAX_LISTED_GAPS) return missing.join(', ');
  return `${missing.slice(0, MAX_LISTED_GAPS).join(', ')} and ${missing.length - MAX_LISTED_GAPS} more`;
}

export function buildPlatform(releases: ReleaseTag[]): { platform?: PlatformSection; warnings: string[] } {
  if (releases.length === 0) return { warnings: [] };

  const versionsByMinor = new Map<string, Set<string>>();
  const architectures = new Set<string>();
  for (const { version, arch } of releases) {
    const minor = version.split('.').slice(0, 2).join('.');
    if (!versionsByMinor.has(minor)) versionsByMinor.set(minor, new Set());
    versionsByMinor.get(minor)?.add(version);
    architectures.add(ARCH_MAP[arch] ?? arch);
  }

  const warnings = [
    'Channel names (stable-X.Y) are assumed; the registry does not record which channel a release came from.',
  ];

  const minors = [...versionsByMinor.keys()].sort((a, b) =>
    compareVersionStrings(`${a}.0`, `${b}.0`),
  );
  const channels = minors.map((minor): PlatformChannel => {
    const versions = sortVersions([...(versionsByMinor.get(minor) ?? [])]);
    const minVersion = versions[0];
    const maxVersion = versions[versions.length - 1];
    const missing = findMissingPatches(minor, versions);
    if (missing.length > 0) {
      warnings.push(
        `stable-${minor}: no release found for ${describeGaps(missing)} between ${minVersion} and ${maxVersion}`,
      );
    }
    return { name: `stable-${minor}`, type: 'ocp', minVersion, maxVersion };
  });

  return {
    platform: { channels, architectures: [...architectures].sort(), graph: true },
    warnings,
  };
}

function catalogRef(catalog: DiscoveredCatalog, sourceCatalogPrefix?: string): string {
  if (!sourceCatalogPrefix) return catalog.ref;
  const name = catalog.repo.split('/').pop();
  return `${sourceCatalogPrefix}/${name}:${catalog.tag}`;
}

export function buildOperators(
  catalogs: DiscoveredCatalog[],
  sourceCatalogPrefix?: string,
): { operators?: OperatorCatalogEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const entries: OperatorCatalogEntry[] = [];

  for (const catalog of [...catalogs].sort((a, b) => a.ref.localeCompare(b.ref))) {
    if (catalog.operators.length === 0) {
      warnings.push(`Skipped catalog ${catalog.ref}: no packages found`);
      continue;
    }
    const packages = [...catalog.operators]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((operator): PackageEntry => {
        if (operator.channels.length === 0) return { name: operator.name };
        const channels = [...operator.channels].sort().map((name): PackageChannel => {
          const range = operator.channelVersionRanges[name];
          const channel: PackageChannel = { name };
          if (range?.minVersion) channel.minVersion = range.minVersion;
          if (range?.maxVersion) channel.maxVersion = range.maxVersion;
          return channel;
        });
        return { name: operator.name, channels };
      });
    entries.push({ catalog: catalogRef(catalog, sourceCatalogPrefix), packages });
  }

  return { operators: entries.length > 0 ? entries : undefined, warnings };
}

export function buildImageSetConfig(input: {
  releases: ReleaseTag[];
  catalogs: DiscoveredCatalog[];
  sourceCatalogPrefix?: string;
}): { config: ImageSetConfigFromRegistry; warnings: string[] } {
  const { platform, warnings: platformWarnings } = buildPlatform(input.releases);
  const { operators, warnings: operatorWarnings } = buildOperators(
    input.catalogs,
    input.sourceCatalogPrefix,
  );

  const mirror: ImageSetConfigFromRegistry['mirror'] = {};
  if (platform) mirror.platform = platform;
  if (operators) mirror.operators = operators;

  return {
    config: { kind: 'ImageSetConfiguration', apiVersion: 'mirror.openshift.io/v2alpha1', mirror },
    warnings: [...platformWarnings, ...operatorWarnings],
  };
}
