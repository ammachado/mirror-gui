import fs from 'fs';
import path from 'path';
import { getRegistryHost } from './operationModes.js';

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

export async function writeAuthFile(filePath: string, file: AuthFile): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
  // writeFile only applies mode when it creates the file.
  await fsp.chmod(filePath, 0o600);
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
  const file = await readAuthFile(filePath, 'Destination registry credentials', true);
  file.auths[registry] = { auth: Buffer.from(`${username}:${password}`).toString('base64') };
  await writeAuthFile(filePath, file);
}

export async function removeCredential(filePath: string, registry: string): Promise<boolean> {
  const file = await readAuthFile(filePath, 'Destination registry credentials', true);
  if (!(registry in file.auths)) {
    return false;
  }
  delete file.auths[registry];
  await writeAuthFile(filePath, file);
  return true;
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
