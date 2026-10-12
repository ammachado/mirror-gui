import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import {
  RegistryHttpError,
  createRegistryClient,
  insecureFetch,
  type RegistryGet,
} from './registryAuth.js';
import type { CatalogOperator, DiscoveredCatalog, ReleaseTag } from './imagesetFromRegistry.js';

const fsp = fs.promises;
const execFileAsync = promisify(execFile);

// oc-mirror v2 layout constants. Kept together so a layout mismatch is a one-line fix.
export const RELEASE_IMAGES_REPO = 'openshift/release-images';
export const RELEASE_TAG_RE = /^(\d+\.\d+\.\d+)-(x86_64|aarch64|ppc64le|s390x)$/;
export const STANDARD_CATALOG_NAMES = [
  'redhat-operator-index',
  'certified-operator-index',
  'community-operator-index',
  'redhat-marketplace-index',
];
export const CATALOG_REPO_RE = /-index$/;
const COSIGN_TAG_RE = /^sha256-|\.(sig|att|sbom)$/;

export const MAX_PARALLEL_EXTRACTIONS = 3;
const EXTRACT_TIMEOUT_MS = 120000;
const METADATA_TIMEOUT_MS = 60000;
const MAX_PAGES = 100;
const MAX_MANUAL_CATALOGS = 50;

// ---------------------------------------------------------------- request

export interface FromRegistryRequest {
  registry: string;
  namespace: string;
  catalogs: string[];
  sourceCatalogPrefix?: string;
}

const PATH_COMPONENT = '[a-z0-9]+(?:[._-][a-z0-9]+)*';
const REGISTRY_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::\d{1,5})?$/;
const NAMESPACE_RE = new RegExp(`^${PATH_COMPONENT}(?:/${PATH_COMPONENT})*$`);
const CATALOG_REF_RE = new RegExp(
  `^${PATH_COMPONENT}(?:/${PATH_COMPONENT})*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$`,
);
const SOURCE_PREFIX_RE = new RegExp(`^[a-zA-Z0-9.-]+(?::\\d{1,5})?(?:/${PATH_COMPONENT})*$`);

type ParseResult = { ok: true; value: FromRegistryRequest } | { ok: false; error: string };

export function parseFromRegistryRequest(body: unknown): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('Request body must be a JSON object');
  }
  const { registry, namespace, catalogs, sourceCatalogPrefix } = body as Record<string, unknown>;

  if (typeof registry !== 'string' || !REGISTRY_RE.test(registry)) {
    return fail('registry must be a host or host:port, without scheme or path');
  }

  let ns = '';
  if (namespace !== undefined && namespace !== '') {
    if (typeof namespace !== 'string' || !NAMESPACE_RE.test(namespace)) {
      return fail('namespace must be a lowercase repository path such as "ocp4" or "team/ocp4"');
    }
    ns = namespace;
  }

  let manualCatalogs: string[] = [];
  if (catalogs !== undefined) {
    if (
      !Array.isArray(catalogs) ||
      catalogs.length > MAX_MANUAL_CATALOGS ||
      !catalogs.every((c) => typeof c === 'string' && CATALOG_REF_RE.test(c))
    ) {
      return fail('catalogs must be an array of "<repository>:<tag>" strings (relative to the registry)');
    }
    manualCatalogs = catalogs as string[];
  }

  let prefix: string | undefined;
  if (sourceCatalogPrefix !== undefined && sourceCatalogPrefix !== '') {
    if (typeof sourceCatalogPrefix !== 'string' || !SOURCE_PREFIX_RE.test(sourceCatalogPrefix)) {
      return fail('sourceCatalogPrefix must look like "registry.redhat.io/redhat" (no scheme)');
    }
    prefix = sourceCatalogPrefix;
  }

  return {
    ok: true,
    value: { registry, namespace: ns, catalogs: manualCatalogs, sourceCatalogPrefix: prefix },
  };
}

// ---------------------------------------------------------------- registry listing

type PagedResult = { ok: true; items: string[] } | { ok: false; status: number };

function parseNextLink(header: string | null): string | null {
  const match = header?.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  return match ? match[1] : null;
}

async function listPaged(get: RegistryGet, firstPath: string, key: 'tags' | 'repositories'): Promise<PagedResult> {
  const items: string[] = [];
  let next: string | null = firstPath;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const res = await get(next);
    if (!res.ok) {
      if (page === 0) return { ok: false, status: res.status };
      throw new RegistryHttpError(res.status, `Registry returned HTTP ${res.status} while listing ${firstPath}`);
    }
    const body = JSON.parse(await res.text()) as Record<string, string[] | null>;
    items.push(...(body[key] ?? []));
    next = parseNextLink(res.header('link'));
  }
  return { ok: true, items };
}

/** Tags of a repository, or null when the repository does not exist. */
export async function listTags(get: RegistryGet, repo: string): Promise<string[] | null> {
  const result = await listPaged(get, `/v2/${repo}/tags/list?n=1000`, 'tags');
  if (result.ok) return result.items;
  if (result.status === 404) return null;
  throw new RegistryHttpError(result.status, `Registry returned HTTP ${result.status} for ${repo}`);
}

export function parseReleaseTags(tags: string[]): { releases: ReleaseTag[]; ignored: string[] } {
  const releases: ReleaseTag[] = [];
  const ignored: string[] = [];
  for (const tag of tags) {
    const match = tag.match(RELEASE_TAG_RE);
    if (match) releases.push({ version: match[1], arch: match[2] });
    else ignored.push(tag);
  }
  return { releases, ignored };
}

function isCatalogTag(tag: string): boolean {
  return !COSIGN_TAG_RE.test(tag);
}

/** Catalog index repositories: from /v2/_catalog when allowed, else by probing standard names. */
export async function discoverCatalogRepos(get: RegistryGet, namespace: string): Promise<string[]> {
  const prefix = namespace ? `${namespace}/` : '';

  const listing = await listPaged(get, '/v2/_catalog?n=1000', 'repositories');
  if (listing.ok) {
    const repos = listing.items.filter((repo) => repo.startsWith(prefix) && CATALOG_REPO_RE.test(repo));
    if (repos.length > 0) return repos.sort();
  }

  const prefixes = namespace ? [`${namespace}/redhat`, namespace] : ['redhat', ''];
  const found: string[] = [];
  for (const base of prefixes) {
    for (const name of STANDARD_CATALOG_NAMES) {
      const repo = base ? `${base}/${name}` : name;
      if ((await listTags(get, repo)) !== null) found.push(repo);
    }
  }
  return found.sort();
}

// ---------------------------------------------------------------- catalog extraction

export interface DiscoveryDeps {
  get: RegistryGet;
  runOc(args: string[], timeoutMs: number): Promise<void>;
  generateMetadata(catalogDir: string, catalogType: string, ocpVersion: string): Promise<CatalogOperator[]>;
  tmpRoot: string;
  registryConfigPath: string | null;
}

export async function extractCatalogOperators(
  deps: DiscoveryDeps,
  ref: string,
  repo: string,
  tag: string,
): Promise<CatalogOperator[]> {
  const catalogDir = await fsp.mkdtemp(path.join(deps.tmpRoot, 'catalog-'));
  try {
    const configsDir = path.join(catalogDir, 'configs');
    await fsp.mkdir(configsDir);
    const args = ['image', 'extract'];
    if (deps.registryConfigPath) args.push(`--registry-config=${deps.registryConfigPath}`);
    args.push('--insecure', `--path=/configs/:${configsDir}`, ref);
    await deps.runOc(args, EXTRACT_TIMEOUT_MS);

    const catalogType = repo.split('/').pop() ?? repo;
    return await deps.generateMetadata(catalogDir, catalogType, tag);
  } finally {
    await fsp.rm(catalogDir, { recursive: true, force: true });
  }
}

export function createDefaultDeps(opts: {
  registry: string;
  authBase64?: string;
  appRootDir: string;
  registryConfigPath: string | null;
}): DiscoveryDeps {
  const script = path.join(opts.appRootDir, 'scripts', 'catalog_metadata.py');
  return {
    get: createRegistryClient(opts.registry, opts.authBase64, insecureFetch),
    runOc: async (args, timeoutMs) => {
      await execFileAsync('oc', args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    },
    generateMetadata: async (catalogDir, catalogType, ocpVersion) => {
      const operatorsFile = path.join(catalogDir, 'operators.json');
      const dependenciesFile = path.join(catalogDir, 'dependencies.json');
      await execFileAsync(
        'python3',
        [
          script, 'generate',
          '--catalog-dir', catalogDir,
          '--catalog-type', catalogType,
          '--ocp-version', ocpVersion,
          '--operators-file', operatorsFile,
          '--dependencies-file', dependenciesFile,
        ],
        { timeout: METADATA_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      );
      return JSON.parse(await fsp.readFile(operatorsFile, 'utf8')) as CatalogOperator[];
    },
    tmpRoot: os.tmpdir(),
    registryConfigPath: opts.registryConfigPath,
  };
}

// ---------------------------------------------------------------- orchestration

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface DiscoveryResult {
  releases: ReleaseTag[];
  catalogs: DiscoveredCatalog[];
  warnings: string[];
}

export async function discoverRegistryContents(
  deps: DiscoveryDeps,
  input: FromRegistryRequest,
): Promise<DiscoveryResult> {
  const { registry, namespace } = input;
  const warnings: string[] = [];
  const withNamespace = (repo: string) => (namespace ? `${namespace}/${repo}` : repo);

  // Releases
  const releaseRepo = withNamespace(RELEASE_IMAGES_REPO);
  const releaseTags = await listTags(deps.get, releaseRepo);
  let releases: ReleaseTag[] = [];
  if (releaseTags === null) {
    warnings.push(`No release images repository found at ${registry}/${releaseRepo}`);
  } else {
    const parsed = parseReleaseTags(releaseTags);
    releases = parsed.releases;
    if (parsed.ignored.length > 0) {
      warnings.push(
        `Ignored ${parsed.ignored.length} tag(s) in ${releaseRepo} that are not release versions (for example: ${parsed.ignored.slice(0, 3).join(', ')})`,
      );
    }
    if (releases.length === 0) warnings.push(`No release versions found in ${registry}/${releaseRepo}`);
  }

  // Catalogs
  const targets = new Map<string, { repo: string; tag: string }>();
  for (const repo of await discoverCatalogRepos(deps.get, namespace)) {
    const tags = (await listTags(deps.get, repo)) ?? [];
    for (const tag of tags.filter(isCatalogTag)) targets.set(`${repo}:${tag}`, { repo, tag });
  }
  for (const manual of input.catalogs) {
    const split = manual.lastIndexOf(':');
    targets.set(manual, { repo: manual.slice(0, split), tag: manual.slice(split + 1) });
  }
  if (targets.size === 0) warnings.push(`No operator catalogs found in ${registry}`);

  const outcomes = await mapLimit(
    [...targets.values()].sort((a, b) => `${a.repo}:${a.tag}`.localeCompare(`${b.repo}:${b.tag}`)),
    MAX_PARALLEL_EXTRACTIONS,
    async ({ repo, tag }): Promise<DiscoveredCatalog | null> => {
      const ref = `${registry}/${repo}:${tag}`;
      try {
        const operators = await extractCatalogOperators(deps, ref, repo, tag);
        return { repo, tag, ref, operators };
      } catch (error: unknown) {
        warnings.push(`Skipped catalog ${ref}: ${(error as Error).message}`);
        return null;
      }
    },
  );

  const catalogs = outcomes.filter((c): c is DiscoveredCatalog => c !== null);
  return { releases, catalogs, warnings };
}
