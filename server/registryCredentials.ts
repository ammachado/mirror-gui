import fs from 'fs';
import path from 'path';
import { getRegistryHost, isValidRegistryHost } from './operationModes.js';

const fsp = fs.promises;

export interface AuthEntry {
  auth?: string;
  [key: string]: unknown;
}

/** Container auth file format shared by podman, docker, and the OpenShift pull secret. */
export interface AuthFile {
  auths: Record<string, AuthEntry>;
}

/** A credentials or pull secret file exists but cannot be used as-is. */
export class AuthFileError extends Error {}

export interface CredentialsLocation {
  path: string;
  managedExternally: boolean;
}

/** Resolved per call so tests and operators can change the env var without a restart. */
export function resolveCredentialsLocation(env: NodeJS.ProcessEnv, storageDir: string): CredentialsLocation {
  const external = env.OC_MIRROR_REGISTRY_CREDENTIALS?.trim();
  if (external) {
    return { path: path.resolve(external), managedExternally: true };
  }
  return { path: path.join(storageDir, 'registry-credentials.json'), managedExternally: false };
}

/**
 * Reads an auth file. A missing or blank file means "no credentials"; anything else that is
 * not a valid auth file throws AuthFileError so callers never silently drop credentials.
 */
export async function readAuthFile(filePath: string, label: string, requireAuth: boolean): Promise<AuthFile> {
  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { auths: {} };
    }
    throw new AuthFileError(`${label} at ${filePath} could not be read: ${(error as Error).message}`);
  }
  if (!content.trim()) {
    return { auths: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AuthFileError(`${label} at ${filePath} is not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AuthFileError(`${label} at ${filePath} must be a JSON object`);
  }

  const auths = (parsed as { auths?: unknown }).auths ?? {};
  if (typeof auths !== 'object' || auths === null || Array.isArray(auths)) {
    throw new AuthFileError(`${label} at ${filePath} must have an "auths" object`);
  }
  for (const [registry, entry] of Object.entries(auths)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new AuthFileError(`${label} entry "${registry}" must be an object`);
    }
    if (requireAuth && typeof (entry as AuthEntry).auth !== 'string') {
      throw new AuthFileError(`${label} entry "${registry}" must have a string "auth" value`);
    }
  }
  return { auths: auths as Record<string, AuthEntry> };
}

/**
 * Writes to a new 0600 file next to the target and renames it into place, so readers never
 * see a partial file and the content is never readable through an older, looser mode.
 */
export async function writeAuthFile(filePath: string, file: AuthFile): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(tempPath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fsp.rename(tempPath, filePath);
  } catch (error: unknown) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

// Serializes read-modify-write cycles per file so concurrent saves do not drop entries.
const fileQueues = new Map<string, Promise<unknown>>();

function withFileLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = fileQueues.get(filePath) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(task);
  const tail = result.catch(() => {});
  fileQueues.set(filePath, tail);
  void tail.then(() => {
    if (fileQueues.get(filePath) === tail) {
      fileQueues.delete(filePath);
    }
  });
  return result;
}

export function listCredentials(file: AuthFile): Array<{ registry: string; username: string }> {
  return Object.entries(file.auths).map(([registry, entry]) => {
    let username = '';
    if (typeof entry.auth === 'string') {
      username = Buffer.from(entry.auth, 'base64').toString('utf8').split(':')[0] || '';
    }
    return { registry, username };
  });
}

export async function upsertCredential(
  filePath: string,
  registry: string,
  username: string,
  password: string,
): Promise<void> {
  if (!isValidRegistryHost(registry)) {
    throw new Error(`Invalid registry "${registry}": expected a hostname with an optional port`);
  }
  await withFileLock(filePath, async () => {
    const file = await readAuthFile(filePath, 'Destination registry credentials', true);
    file.auths[registry] = { auth: Buffer.from(`${username}:${password}`).toString('base64') };
    await writeAuthFile(filePath, file);
  });
}

export async function removeCredential(filePath: string, registry: string): Promise<boolean> {
  return withFileLock(filePath, async () => {
    const file = await readAuthFile(filePath, 'Destination registry credentials', true);
    if (!Object.hasOwn(file.auths, registry)) {
      return false;
    }
    delete file.auths[registry];
    await writeAuthFile(filePath, file);
    return true;
  });
}

/**
 * Destination credentials win over pull secret entries for the same host.
 *
 * Exception: when the destination has a namespace and the pull secret also
 * has its host, the destination credentials are keyed by the full destination
 * path instead. oc-mirror uses one authfile for both pulling and pushing, and
 * auth lookup picks the most specific key, so pushes get the destination
 * credentials while source pulls from the same host keep the pull secret.
 */
export function mergeAuthFiles(pullSecret: AuthFile, destination: AuthFile, destinationRegistry?: string): AuthFile {
  const merged: AuthFile = { auths: { ...pullSecret.auths, ...destination.auths } };
  if (!destinationRegistry) {
    return merged;
  }
  const host = getRegistryHost(destinationRegistry);
  if (destinationRegistry !== host && pullSecret.auths[host] && destination.auths[host]) {
    merged.auths[host] = pullSecret.auths[host];
    merged.auths[destinationRegistry] = destination.auths[host];
  }
  return merged;
}
