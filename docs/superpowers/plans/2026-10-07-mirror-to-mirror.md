# Mirror-to-Mirror and Disk-to-Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add oc-mirror v2 mirror-to-mirror and disk-to-mirror operations to Mirror-GUI, with separately managed destination registry credentials.

**Architecture:** `POST /api/operations/start` gains a `mode` field. Two new pure modules hold the risky logic: `server/operationModes.ts` (mode list, labels, destination validation; also imported by the React UI) and `server/ocMirrorArgs.ts` (argv per mode). `server/registryCredentials.ts` reads, writes, and merges container auth files. The existing spawn, log, SSE, and stop lifecycle in `server/index.ts` is reused.

**Tech Stack:** TypeScript, Express (Node 22), React 18 + PatternFly 6 (Vite), Vitest + supertest, Playwright, Helm.

**Spec:** `docs/superpowers/specs/2026-10-07-mirror-to-mirror-design.md`

## Global Constraints

- Mode values: `mirrorToDisk` (default when omitted), `mirrorToMirror`, `diskToMirror`.
- M2D argv must stay byte-for-byte what it is today (existing tests assert it).
- Credentials file format: `{ "auths": { "<host[:port]>": { "auth": "<base64 user:password>" } } }`, written with mode `0600`.
- App-managed credentials path: `STORAGE_DIR/registry-credentials.json`. External path env var: `OC_MIRROR_REGISTRY_CREDENTIALS` (read-only when set).
- Temporary merged authfile: `RUN_DIR/authfile-<operationId>.json`, mode `0600`, never returned by any API.
- No API response ever contains an `auth` value or a password.
- `--dest-tls-verify=true` for M2M/D2M unless `skipDestTlsVerify === true`. `--src-tls-verify=false` unchanged.
- Folder label text "Mirror Destination Folder" must stay for M2D (existing E2E asserts it).
- Do not modify or remove existing tests (AGENTS.md). Add new test files or append new cases.
- No new npm dependencies.
- Run `npm run lint` before each commit. Commit messages end with the attribution lines configured for this session.
- American English, no em dashes in new prose or UI copy.

## Review Focus

1. **Destination entered with a scheme or tag** (`docker://reg/ns`, `reg/ns:v1`): the server rejects it with a message that says what to remove; the UI shows the same message before submit. Pinned in Task 1 tests.
2. **Pull secret missing or emptied by DELETE (file contains `""`)**: M2M/D2M still start, with only destination credentials in the merged file. Pinned in Task 2 (`readAuthFile` empty content) and Task 4 (start succeeds with no pull secret).
3. **Two starts on the same folder in quick succession** (double click, or M2D while D2M reads the folder): the second gets 409, and the folder is released after the first finishes so a later start succeeds. Pinned in Task 4.
4. **Stopping an M2M run**: the temporary authfile is removed and the folder released, just like a normal exit. Pinned in Task 4.
5. **Credentials file edited by hand into invalid JSON**: Settings shows the error, start returns 500 naming the file; nothing silently pushes anonymously. Pinned in Task 3 and Task 4.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `server/operationModes.ts` | Create | Mode type/list/labels, `isRegistryTargetMode`, registry host and destination validation. No Node imports (the UI imports it). |
| `server/ocMirrorArgs.ts` | Create | `buildOcMirrorArgs()` pure argv builder. |
| `server/registryCredentials.ts` | Create | Auth file read/validate/write, credential list/upsert/remove, merge, location resolution. |
| `server/index.ts` | Modify | Optional flag `maxNestedPaths`; credentials endpoints; shared registry verify helper; start route modes; details fields. |
| `src/components/MirrorOperations.tsx` | Modify | Mode toggle, destination fields, warning, folder label, max nested paths flag, Mode column, copy cluster-resources path. |
| `src/components/Settings.tsx` | Modify | Destination registry credentials section in the Registry tab. |
| `src/components/History.tsx` | Modify | Mode column, details fields, CSV columns. |
| `charts/mirror-gui/values.yaml`, `charts/mirror-gui/templates/deployment.yaml` | Modify | `registryCredentials.existingSecret`/`key`. |
| `API.md`, `docs/dev/operations.md`, `README.md` | Modify | Document the new API, lifecycle, and Helm values. |
| `tests/unit/operationModes.test.ts`, `tests/unit/ocMirrorArgs.test.ts`, `tests/unit/registryCredentials.test.ts` | Create | Unit tests. |
| `tests/integration/registryCredentials.test.ts`, `tests/integration/operationModes.test.ts` | Create | API tests. |
| `tests/scripts/helmRegistryCredentials.test.ts` | Create | Chart render tests. |
| `tests/e2e/operationModes.spec.ts`, `tests/e2e/registryCredentials.spec.ts`, `tests/e2e/historyModes.spec.ts` | Create | UI tests. |

Note: the UI importing `../../server/operationModes` is a new pattern in this repo. It is safe because the Docker builder stage copies the whole tree (`COPY . .`) before `npm run build`, and the module has no Node imports. It avoids duplicating the validation regex in two places.

---

### Task 1: Operation modes and argv builder

**Files:**
- Create: `server/operationModes.ts`
- Create: `server/ocMirrorArgs.ts`
- Test: `tests/unit/operationModes.test.ts`, `tests/unit/ocMirrorArgs.test.ts`

**Interfaces:**
- Produces (`server/operationModes.ts`):
  - `type OperationMode = 'mirrorToDisk' | 'mirrorToMirror' | 'diskToMirror'`
  - `const OPERATION_MODES: readonly OperationMode[]`
  - `const OPERATION_MODE_LABELS: Record<OperationMode, string>`
  - `isOperationMode(value: unknown): value is OperationMode`
  - `isRegistryTargetMode(mode: OperationMode): boolean`
  - `isValidRegistryHost(value: string): boolean`
  - `getDestinationRegistryError(value: unknown): string | null`
  - `getRegistryHost(destination: string): string`
- Produces (`server/ocMirrorArgs.ts`):
  - `interface OcMirrorArgsInput { mode: OperationMode; configPath: string; folderPath: string; cacheDir: string; authfilePath: string; destinationRegistry?: string; skipDestTlsVerify?: boolean; additionalArgs: string[] }`
  - `buildOcMirrorArgs(input: OcMirrorArgsInput): string[]`

- [ ] **Step 1: Write the failing tests for `operationModes`**

Create `tests/unit/operationModes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  OPERATION_MODES,
  isOperationMode,
  isRegistryTargetMode,
  isValidRegistryHost,
  getDestinationRegistryError,
  getRegistryHost,
} from '../../server/operationModes.js';

describe('isOperationMode', () => {
  it('accepts exactly the three oc-mirror workflows', () => {
    expect(OPERATION_MODES).toEqual(['mirrorToDisk', 'mirrorToMirror', 'diskToMirror']);
    for (const mode of OPERATION_MODES) {
      expect(isOperationMode(mode)).toBe(true);
    }
  });

  it('rejects other values so typos do not silently fall back to mirror-to-disk', () => {
    expect(isOperationMode('mirrorToMirrors')).toBe(false);
    expect(isOperationMode('')).toBe(false);
    expect(isOperationMode(undefined)).toBe(false);
    expect(isOperationMode(1)).toBe(false);
  });
});

describe('isRegistryTargetMode', () => {
  it('is true only for modes that push to a registry', () => {
    expect(isRegistryTargetMode('mirrorToDisk')).toBe(false);
    expect(isRegistryTargetMode('mirrorToMirror')).toBe(true);
    expect(isRegistryTargetMode('diskToMirror')).toBe(true);
  });
});

describe('isValidRegistryHost', () => {
  it.each(['registry.example.com', 'localhost:6000', 'quay.io', 'my-reg.internal:5000', '10.0.0.5:443'])(
    'accepts %s',
    (host) => expect(isValidRegistryHost(host)).toBe(true),
  );

  it.each(['', 'https://quay.io', 'quay.io/ns', 'reg .com', 'reg:port', '-bad.com', 'reg.com:'])(
    'rejects %s',
    (host) => expect(isValidRegistryHost(host)).toBe(false),
  );
});

describe('getDestinationRegistryError', () => {
  it.each([
    'registry.example.com',
    'localhost:6000',
    'registry.example.com:5000/mirror',
    'registry.example.com/team/ocp-4.18',
    'quay.io/my_org/mirror-repo',
  ])('accepts %s', (value) => {
    expect(getDestinationRegistryError(value)).toBeNull();
  });

  it('requires a value', () => {
    expect(getDestinationRegistryError(undefined)).toMatch(/required/i);
    expect(getDestinationRegistryError('')).toMatch(/required/i);
    expect(getDestinationRegistryError(42)).toMatch(/required/i);
  });

  it('tells the user to drop the scheme, because the server adds docker:// itself', () => {
    expect(getDestinationRegistryError('docker://registry.example.com')).toMatch(/scheme/i);
    expect(getDestinationRegistryError('https://registry.example.com')).toMatch(/scheme/i);
  });

  it('rejects whitespace, digests, tags, and trailing slashes with specific messages', () => {
    expect(getDestinationRegistryError('registry.example.com/ my')).toMatch(/whitespace/i);
    expect(getDestinationRegistryError('registry.example.com/ns@sha256:abc')).toMatch(/digest/i);
    expect(getDestinationRegistryError('registry.example.com/ns:v1')).toMatch(/tag/i);
    expect(getDestinationRegistryError('registry.example.com/ns/')).toMatch(/end with/i);
  });

  it('rejects uppercase or malformed path segments', () => {
    expect(getDestinationRegistryError('registry.example.com/Team')).toMatch(/lowercase/i);
    expect(getDestinationRegistryError('registry.example.com//ns')).toMatch(/lowercase/i);
  });

  it('rejects an invalid host', () => {
    expect(getDestinationRegistryError('bad host/ns')).toMatch(/whitespace/i);
    expect(getDestinationRegistryError('reg:port/ns')).toMatch(/host/i);
  });
});

describe('getRegistryHost', () => {
  it('returns the host[:port] part used to look up credentials', () => {
    expect(getRegistryHost('registry.example.com:5000/team/ocp')).toBe('registry.example.com:5000');
    expect(getRegistryHost('localhost:6000')).toBe('localhost:6000');
  });
});
```

- [ ] **Step 2: Write the failing tests for `ocMirrorArgs`**

Create `tests/unit/ocMirrorArgs.test.ts`:

```ts
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

  it('throws when a registry-target mode has no destination, instead of building a broken command', () => {
    expect(() => buildOcMirrorArgs({ ...base, mode: 'mirrorToMirror' })).toThrow(/destinationRegistry/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/operationModes.test.ts tests/unit/ocMirrorArgs.test.ts`
Expected: FAIL, cannot resolve `../../server/operationModes.js` / `../../server/ocMirrorArgs.js`.

- [ ] **Step 4: Implement `server/operationModes.ts`**

```ts
// Shared by the server and the React UI, so it must not import Node modules.

export type OperationMode = 'mirrorToDisk' | 'mirrorToMirror' | 'diskToMirror';

export const OPERATION_MODES: readonly OperationMode[] = ['mirrorToDisk', 'mirrorToMirror', 'diskToMirror'];

export const OPERATION_MODE_LABELS: Record<OperationMode, string> = {
  mirrorToDisk: 'Mirror to disk',
  mirrorToMirror: 'Mirror to mirror',
  diskToMirror: 'Disk to mirror',
};

export function isOperationMode(value: unknown): value is OperationMode {
  return typeof value === 'string' && (OPERATION_MODES as readonly string[]).includes(value);
}

// Modes whose destination is a container registry rather than a local folder.
export function isRegistryTargetMode(mode: OperationMode): boolean {
  return mode === 'mirrorToMirror' || mode === 'diskToMirror';
}

const HOST_LABEL = '[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?';
const REGISTRY_HOST_PATTERN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::\\d{1,5})?$`);
const PATH_SEGMENT_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function isValidRegistryHost(value: string): boolean {
  return REGISTRY_HOST_PATTERN.test(value);
}

/** Returns a user-facing error for an invalid `host[:port][/namespace...]` value, or null when valid. */
export function getDestinationRegistryError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'destinationRegistry is required for this mode';
  }
  if (value.includes('://')) {
    return 'destinationRegistry must not include a scheme; enter host[:port]/namespace without docker://';
  }
  if (/\s/.test(value)) {
    return 'destinationRegistry must not contain whitespace';
  }
  if (value.includes('@')) {
    return 'destinationRegistry must not include a digest';
  }
  if (value.endsWith('/')) {
    return 'destinationRegistry must not end with "/"';
  }
  const [host, ...segments] = value.split('/');
  if (!isValidRegistryHost(host)) {
    return 'destinationRegistry host must be a hostname with an optional port, like registry.example.com:5000';
  }
  for (const segment of segments) {
    if (segment.includes(':')) {
      return 'destinationRegistry must not include a tag';
    }
    if (!PATH_SEGMENT_PATTERN.test(segment)) {
      return 'destinationRegistry namespace segments must be lowercase letters and digits, separated by ".", "_", or "-"';
    }
  }
  return null;
}

/** The `host[:port]` part of a destination, which is how auth files key credentials. */
export function getRegistryHost(destination: string): string {
  return destination.split('/')[0];
}
```

- [ ] **Step 5: Implement `server/ocMirrorArgs.ts`**

```ts
import { pathToFileURL } from 'url';
import { type OperationMode, isRegistryTargetMode } from './operationModes.js';

export interface OcMirrorArgsInput {
  mode: OperationMode;
  configPath: string;
  /** M2D output folder, M2M --workspace, or D2M --from. */
  folderPath: string;
  cacheDir: string;
  authfilePath: string;
  destinationRegistry?: string;
  skipDestTlsVerify?: boolean;
  additionalArgs: string[];
}

/**
 * Builds the oc-mirror v2 argv for one workflow. oc-mirror picks the workflow from the
 * arguments: file:// destination is mirror-to-disk; docker:// with --workspace is
 * mirror-to-mirror; docker:// with --from is disk-to-mirror.
 */
export function buildOcMirrorArgs(input: OcMirrorArgsInput): string[] {
  const folderUrl = pathToFileURL(input.folderPath).href;
  const sharedTail = [
    '--src-tls-verify=false',
    '--cache-dir', input.cacheDir,
    '--authfile', input.authfilePath,
    ...input.additionalArgs,
  ];

  if (!isRegistryTargetMode(input.mode)) {
    return ['--v2', '--config', input.configPath, '--dest-tls-verify=false', ...sharedTail, folderUrl];
  }

  if (!input.destinationRegistry) {
    throw new Error(`destinationRegistry is required for ${input.mode}`);
  }

  const folderFlag = input.mode === 'mirrorToMirror' ? '--workspace' : '--from';
  return [
    '--v2',
    '--config', input.configPath,
    folderFlag, folderUrl,
    `--dest-tls-verify=${input.skipDestTlsVerify === true ? 'false' : 'true'}`,
    ...sharedTail,
    `docker://${input.destinationRegistry}`,
  ];
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/operationModes.test.ts tests/unit/ocMirrorArgs.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add server/operationModes.ts server/ocMirrorArgs.ts tests/unit/operationModes.test.ts tests/unit/ocMirrorArgs.test.ts
git commit -m "feat: add operation modes and oc-mirror argv builder"
```

---

### Task 2: Registry credentials module

**Files:**
- Create: `server/registryCredentials.ts`
- Test: `tests/unit/registryCredentials.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface AuthEntry { auth?: string; [key: string]: unknown }`
  - `interface AuthFile { auths: Record<string, AuthEntry> }`
  - `class AuthFileError extends Error`
  - `interface CredentialsLocation { path: string; managedExternally: boolean }`
  - `resolveCredentialsLocation(env: NodeJS.ProcessEnv, storageDir: string): CredentialsLocation`
  - `readAuthFile(filePath: string, label: string, requireAuth: boolean): Promise<AuthFile>`
  - `writeAuthFile(filePath: string, file: AuthFile): Promise<void>`
  - `listCredentials(file: AuthFile): Array<{ registry: string; username: string }>`
  - `upsertCredential(filePath: string, registry: string, username: string, password: string): Promise<void>`
  - `removeCredential(filePath: string, registry: string): Promise<boolean>`
  - `mergeAuthFiles(pullSecret: AuthFile, destination: AuthFile): AuthFile`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/registryCredentials.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AuthFileError,
  resolveCredentialsLocation,
  readAuthFile,
  writeAuthFile,
  listCredentials,
  upsertCredential,
  removeCredential,
  mergeAuthFiles,
} from '../../server/registryCredentials.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');
let dir: string;

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reg-creds-'));
});
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

describe('resolveCredentialsLocation', () => {
  it('defaults to an app-managed file in the storage dir', () => {
    expect(resolveCredentialsLocation({}, '/data')).toEqual({
      path: path.join('/data', 'registry-credentials.json'),
      managedExternally: false,
    });
  });

  it('uses OC_MIRROR_REGISTRY_CREDENTIALS as a read-only external file', () => {
    expect(resolveCredentialsLocation({ OC_MIRROR_REGISTRY_CREDENTIALS: '/secrets/auth.json' }, '/data')).toEqual({
      path: '/secrets/auth.json',
      managedExternally: true,
    });
  });
});

describe('readAuthFile', () => {
  it('treats a missing file as no credentials', async () => {
    await expect(readAuthFile(path.join(dir, 'nope.json'), 'Creds', true)).resolves.toEqual({ auths: {} });
  });

  it('treats an empty file as no credentials (DELETE /api/pull-secret can leave one behind)', async () => {
    const file = path.join(dir, 'empty.json');
    await fs.promises.writeFile(file, '  \n');
    await expect(readAuthFile(file, 'Pull secret', false)).resolves.toEqual({ auths: {} });
  });

  it('fails loudly on invalid JSON instead of pretending there are no credentials', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.promises.writeFile(file, 'not json');
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(AuthFileError);
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(/Creds .*not valid JSON/);
  });

  it('requires a string auth per entry when requireAuth is true', async () => {
    const file = path.join(dir, 'noauth.json');
    await fs.promises.writeFile(file, JSON.stringify({ auths: { 'reg.example.com': { identitytoken: 'x' } } }));
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(/reg\.example\.com/);
    await expect(readAuthFile(file, 'Pull secret', false)).resolves.toEqual({
      auths: { 'reg.example.com': { identitytoken: 'x' } },
    });
  });

  it('rejects a non-object auths value', async () => {
    const file = path.join(dir, 'arr.json');
    await fs.promises.writeFile(file, JSON.stringify({ auths: [] }));
    await expect(readAuthFile(file, 'Creds', true)).rejects.toThrow(AuthFileError);
  });
});

describe('writeAuthFile / upsertCredential / removeCredential', () => {
  it('writes credentials readable only by the owner', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'reg.example.com:5000', 'alice', 'pw:with:colons');
    const mode = (await fs.promises.stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
    const saved = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    expect(saved).toEqual({ auths: { 'reg.example.com:5000': { auth: b64('alice:pw:with:colons') } } });
  });

  it('tightens permissions on an existing file that was too open', async () => {
    const file = path.join(dir, 'open.json');
    await fs.promises.writeFile(file, '{}', { mode: 0o644 });
    await writeAuthFile(file, { auths: {} });
    expect((await fs.promises.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('replaces an existing entry and keeps the others', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'a.example.com', 'u1', 'p1');
    await upsertCredential(file, 'b.example.com', 'u2', 'p2');
    await upsertCredential(file, 'a.example.com', 'u3', 'p3');
    const saved = await readAuthFile(file, 'Creds', true);
    expect(saved.auths['a.example.com'].auth).toBe(b64('u3:p3'));
    expect(saved.auths['b.example.com'].auth).toBe(b64('u2:p2'));
  });

  it('removes an entry and reports whether it existed', async () => {
    const file = path.join(dir, 'creds.json');
    await upsertCredential(file, 'a.example.com', 'u1', 'p1');
    await expect(removeCredential(file, 'a.example.com')).resolves.toBe(true);
    await expect(removeCredential(file, 'a.example.com')).resolves.toBe(false);
    expect((await readAuthFile(file, 'Creds', true)).auths).toEqual({});
  });
});

describe('listCredentials', () => {
  it('returns registry and username only, never the auth value', () => {
    const listed = listCredentials({ auths: { 'reg.example.com': { auth: b64('bob:secret') } } });
    expect(listed).toEqual([{ registry: 'reg.example.com', username: 'bob' }]);
    expect(JSON.stringify(listed)).not.toContain('secret');
    expect(JSON.stringify(listed)).not.toContain(b64('bob:secret'));
  });
});

describe('mergeAuthFiles', () => {
  it('keeps pull secret hosts and lets destination credentials win on the same host', () => {
    const merged = mergeAuthFiles(
      { auths: { 'registry.redhat.io': { auth: 'rh' }, 'reg.example.com': { auth: 'old' } } },
      { auths: { 'reg.example.com': { auth: 'new' } } },
    );
    expect(merged).toEqual({
      auths: { 'registry.redhat.io': { auth: 'rh' }, 'reg.example.com': { auth: 'new' } },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/registryCredentials.test.ts`
Expected: FAIL, cannot resolve `../../server/registryCredentials.js`.

- [ ] **Step 3: Implement `server/registryCredentials.ts`**

```ts
import fs from 'fs';
import path from 'path';

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

/** Destination credentials win over pull secret entries for the same host. */
export function mergeAuthFiles(pullSecret: AuthFile, destination: AuthFile): AuthFile {
  return { auths: { ...pullSecret.auths, ...destination.auths } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/registryCredentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add server/registryCredentials.ts tests/unit/registryCredentials.test.ts
git commit -m "feat: add destination registry credentials storage"
```

---

### Task 3: Credentials API and shared registry verification

**Files:**
- Modify: `server/index.ts` (imports near line 13; `POST /api/registries/verify` at ~2146-2212; add new routes right after it)
- Modify: `API.md` (add a "Destination Registry Credentials" section after "Registry Authentication", ~line 847)
- Test: `tests/integration/registryCredentials.test.ts`

**Interfaces:**
- Consumes (Task 1): `isValidRegistryHost`. (Task 2): `resolveCredentialsLocation`, `readAuthFile`, `listCredentials`, `upsertCredential`, `removeCredential`, `AuthFileError`.
- Produces:
  - `verifyRegistryAuth(registry: string, auth: string): Promise<{ status: 'authenticated' | 'failed'; error?: string }>` (module-private in `server/index.ts`)
  - `GET /api/registry-credentials` → `{ managedExternally: boolean; path: string | null; credentials: Array<{ registry; username; status; error? }>; error?: string }` (`path` only set when external)
  - `PUT /api/registry-credentials` body `{ registry, username, password }` → `{ message }`
  - `DELETE /api/registry-credentials/:registry` → `{ message }`
  - `POST /api/registry-credentials/verify` body `{ registry }` → `{ registry, status, error? }`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/registryCredentials.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getTestApp } from './helpers/testApp.js';

const storageDir = process.env.STORAGE_DIR!;
const appManagedFile = path.join(storageDir, 'registry-credentials.json');

describe('Destination registry credentials API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  afterEach(async () => {
    delete process.env.OC_MIRROR_REGISTRY_CREDENTIALS;
    await fs.promises.rm(appManagedFile, { force: true });
  });

  it('lists nothing when no credentials file exists', async () => {
    const res = await request.get('/api/registry-credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ managedExternally: false, path: null, credentials: [] });
  });

  it('saves a credential, lists it without the password, and stores it 0600', async () => {
    const put = await request
      .put('/api/registry-credentials')
      .send({ registry: 'mirror.example.com:5000', username: 'alice', password: 'Sup3rSecret' });
    expect(put.status).toBe(200);

    const res = await request.get('/api/registry-credentials');
    expect(res.body.credentials).toEqual([
      { registry: 'mirror.example.com:5000', username: 'alice', status: 'not_verified' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Sup3rSecret');
    expect(JSON.stringify(res.body)).not.toContain(Buffer.from('alice:Sup3rSecret').toString('base64'));
    expect((await fs.promises.stat(appManagedFile)).mode & 0o777).toBe(0o600);
  });

  it.each([
    [{ registry: 'https://mirror.example.com', username: 'a', password: 'b' }, /registry/i],
    [{ registry: 'mirror.example.com/ns', username: 'a', password: 'b' }, /registry/i],
    [{ registry: 'mirror.example.com', username: '', password: 'b' }, /username/i],
    [{ registry: 'mirror.example.com', username: 'a:b', password: 'b' }, /username/i],
    [{ registry: 'mirror.example.com', username: 'a', password: '' }, /password/i],
  ])('rejects invalid input %o', async (body, message) => {
    const res = await request.put('/api/registry-credentials').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('deletes a credential and returns 404 when it is already gone', async () => {
    await request
      .put('/api/registry-credentials')
      .send({ registry: 'mirror.example.com', username: 'a', password: 'b' });
    const del = await request.delete('/api/registry-credentials/mirror.example.com');
    expect(del.status).toBe(200);
    const again = await request.delete('/api/registry-credentials/mirror.example.com');
    expect(again.status).toBe(404);
  });

  it('reports a failed verification without network access when no credential exists', async () => {
    const res = await request.post('/api/registry-credentials/verify').send({ registry: 'unknown.example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      registry: 'unknown.example.com',
      status: 'failed',
      error: 'No credentials found for this registry',
    });
  });

  describe('externally managed file', () => {
    it('lists entries read-only and refuses writes with 409', async () => {
      const external = path.join(storageDir, 'external-auth.json');
      await fs.promises.writeFile(
        external,
        JSON.stringify({ auths: { 'ext.example.com': { auth: Buffer.from('ext:pw').toString('base64') } } }),
      );
      process.env.OC_MIRROR_REGISTRY_CREDENTIALS = external;

      const res = await request.get('/api/registry-credentials');
      expect(res.body.managedExternally).toBe(true);
      expect(res.body.path).toBe(external);
      expect(res.body.credentials).toEqual([
        { registry: 'ext.example.com', username: 'ext', status: 'not_verified' },
      ]);

      const put = await request
        .put('/api/registry-credentials')
        .send({ registry: 'x.example.com', username: 'a', password: 'b' });
      expect(put.status).toBe(409);
      expect(put.body.error).toMatch(/managed outside the application/);

      const del = await request.delete('/api/registry-credentials/ext.example.com');
      expect(del.status).toBe(409);
      expect(JSON.parse(await fs.promises.readFile(external, 'utf8')).auths).toHaveProperty('ext.example.com');
    });

    it('surfaces a malformed file as an error instead of an empty list', async () => {
      const external = path.join(storageDir, 'broken-auth.json');
      await fs.promises.writeFile(external, '{ not json');
      process.env.OC_MIRROR_REGISTRY_CREDENTIALS = external;

      const res = await request.get('/api/registry-credentials');
      expect(res.status).toBe(200);
      expect(res.body.credentials).toEqual([]);
      expect(res.body.error).toMatch(/not valid JSON/);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/registryCredentials.test.ts`
Expected: FAIL with 404 responses (routes do not exist).

- [ ] **Step 3: Add imports to `server/index.ts`**

After the `import { isPathAvailable } from './pathAvailability.js';` line add:

```ts
import { isValidRegistryHost } from './operationModes.js';
import {
  AuthFileError,
  listCredentials,
  readAuthFile,
  removeCredential,
  resolveCredentialsLocation,
  upsertCredential,
} from './registryCredentials.js';
```

- [ ] **Step 4: Extract `verifyRegistryAuth` and rewrite `POST /api/registries/verify` to use it**

Replace the whole `app.post('/api/registries/verify', ...)` handler with:

```ts
// Registries like registry.redhat.io and quay.io reject Basic auth on /v2/ and expect the
// OAuth2 token exchange advertised in WWW-Authenticate, so both steps are tried.
async function verifyRegistryAuth(
  registry: string,
  auth: string,
): Promise<{ status: 'authenticated' | 'failed'; error?: string }> {
  try {
    const response = await fetch(`https://${registry}/v2/`, {
      headers: { 'Authorization': `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      return { status: 'authenticated' };
    }
    if (response.status === 401) {
      const wwwAuth = response.headers.get('www-authenticate') || '';
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
      if (realmMatch) {
        const tokenUrl = new URL(realmMatch[1]);
        if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1]);
        const tokenRes = await fetch(tokenUrl.toString(), {
          headers: { 'Authorization': `Basic ${auth}` },
          signal: AbortSignal.timeout(10000),
        });
        if (tokenRes.ok) {
          return { status: 'authenticated' };
        }
        const body = await tokenRes.text().catch(() => '');
        return { status: 'failed', error: `Authentication failed (${tokenRes.status}): ${body.slice(0, 200)}` };
      }
    }
    return { status: 'failed', error: `HTTP ${response.status}` };
  } catch (error: unknown) {
    return { status: 'failed', error: (error as Error).message || 'Connection failed' };
  }
}

app.post('/api/registries/verify', async (req: Request, res: Response) => {
  try {
    const { registry } = req.body;
    if (!registry) {
      res.status(400).json({ error: 'Registry is required' });
      return;
    }
    if (!pullSecretDetected || !pullSecretPath) {
      res.json({ registry, status: 'failed', error: 'No pull secret configured' });
      return;
    }

    const content = await fsp.readFile(pullSecretPath, 'utf8');
    const pullSecret = JSON.parse(content);
    const authData = pullSecret.auths?.[registry];
    if (!authData?.auth) {
      res.json({ registry, status: 'failed', error: 'No credentials found for this registry' });
      return;
    }

    const result = await verifyRegistryAuth(registry, authData.auth);
    registryVerificationCache[registry] = result;
    res.json({ registry, ...result });
  } catch (error: unknown) {
    console.error(`Error verifying registry ${req.body?.registry}:`, error);
    const reg = req.body?.registry;
    const errMsg = (error as Error).message || 'Connection failed';
    if (reg) registryVerificationCache[reg] = { status: 'failed', error: errMsg };
    res.json({ registry: reg, status: 'failed', error: errMsg });
  }
});
```

Then run `npx vitest run tests/integration/settings.test.ts` and confirm the existing verify tests still pass.

- [ ] **Step 5: Add the credentials routes after `POST /api/registries/verify`**

```ts
const destinationCredentialStatus: Record<string, { status: 'authenticated' | 'failed'; error?: string }> = {};

function destinationCredentialsExternalMessage(filePath: string): string {
  return `Destination registry credentials are managed outside the application at ${filePath} and cannot be changed here.`;
}

app.get('/api/registry-credentials', async (_req: Request, res: Response) => {
  const location = resolveCredentialsLocation(process.env, STORAGE_DIR);
  const base = { managedExternally: location.managedExternally, path: location.managedExternally ? location.path : null };
  try {
    const file = await readAuthFile(location.path, 'Destination registry credentials', true);
    const credentials = listCredentials(file).map((entry) => ({
      ...entry,
      status: destinationCredentialStatus[entry.registry]?.status ?? 'not_verified',
      ...(destinationCredentialStatus[entry.registry]?.error
        ? { error: destinationCredentialStatus[entry.registry].error }
        : {}),
    }));
    res.json({ ...base, credentials });
  } catch (error: unknown) {
    if (error instanceof AuthFileError) {
      res.json({ ...base, credentials: [], error: error.message });
      return;
    }
    console.error('Error reading destination registry credentials:', error);
    res.status(500).json({ error: 'Failed to read destination registry credentials' });
  }
});

app.put('/api/registry-credentials', async (req: Request, res: Response) => {
  const { registry, username, password } = req.body || {};
  if (typeof registry !== 'string' || !isValidRegistryHost(registry)) {
    return res.status(400).json({ error: 'registry must be a hostname with an optional port, like registry.example.com:5000' });
  }
  if (typeof username !== 'string' || !username || username.includes(':')) {
    return res.status(400).json({ error: 'username is required and must not contain ":"' });
  }
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'password is required' });
  }

  const location = resolveCredentialsLocation(process.env, STORAGE_DIR);
  if (location.managedExternally) {
    return res.status(409).json({ error: destinationCredentialsExternalMessage(location.path) });
  }
  try {
    await upsertCredential(location.path, registry, username, password);
    delete destinationCredentialStatus[registry];
    res.json({ message: 'Registry credentials saved' });
  } catch (error: unknown) {
    console.error('Error saving destination registry credentials:', error);
    const message = error instanceof AuthFileError ? error.message : 'Failed to save registry credentials';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/registry-credentials/:registry', async (req: Request, res: Response) => {
  const { registry } = req.params;
  const location = resolveCredentialsLocation(process.env, STORAGE_DIR);
  if (location.managedExternally) {
    return res.status(409).json({ error: destinationCredentialsExternalMessage(location.path) });
  }
  try {
    const removed = await removeCredential(location.path, registry);
    if (!removed) {
      return res.status(404).json({ error: 'No credentials found for this registry' });
    }
    delete destinationCredentialStatus[registry];
    res.json({ message: 'Registry credentials removed' });
  } catch (error: unknown) {
    console.error('Error removing destination registry credentials:', error);
    const message = error instanceof AuthFileError ? error.message : 'Failed to remove registry credentials';
    res.status(500).json({ error: message });
  }
});

app.post('/api/registry-credentials/verify', async (req: Request, res: Response) => {
  const { registry } = req.body || {};
  if (typeof registry !== 'string' || !registry) {
    return res.status(400).json({ error: 'Registry is required' });
  }
  try {
    const location = resolveCredentialsLocation(process.env, STORAGE_DIR);
    const file = await readAuthFile(location.path, 'Destination registry credentials', true);
    const auth = file.auths[registry]?.auth;
    if (!auth) {
      return res.json({ registry, status: 'failed', error: 'No credentials found for this registry' });
    }
    const result = await verifyRegistryAuth(registry, auth);
    destinationCredentialStatus[registry] = result;
    res.json({ registry, ...result });
  } catch (error: unknown) {
    const message = error instanceof AuthFileError ? error.message : (error as Error).message;
    res.json({ registry, status: 'failed', error: message });
  }
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/registryCredentials.test.ts tests/integration/settings.test.ts`
Expected: PASS.

- [ ] **Step 7: Document the API**

In `API.md`, after the `POST /api/registries/verify` section (before `### Cache Management`), add:

````markdown
### Destination Registry Credentials

Credentials for registries that mirror-to-mirror and disk-to-mirror push to. They are stored separately from the pull secret in `STORAGE_DIR/registry-credentials.json` (mode `0600`). When `OC_MIRROR_REGISTRY_CREDENTIALS` points to a file (for example a mounted Secret), that file is used read-only and write endpoints return `409`. Passwords and `auth` values are never returned.

#### GET /api/registry-credentials

```json
{
  "managedExternally": false,
  "path": null,
  "credentials": [
    { "registry": "mirror.example.com:5000", "username": "alice", "status": "not_verified" }
  ]
}
```

`path` is set only when externally managed. When the file is malformed, `credentials` is empty and `error` describes the problem.

#### PUT /api/registry-credentials

Adds or replaces one entry. Body: `{ "registry": "host[:port]", "username": "alice", "password": "..." }`. Returns `400` for invalid input and `409` when externally managed.

#### DELETE /api/registry-credentials/:registry

Removes one entry. Returns `404` when absent and `409` when externally managed.

#### POST /api/registry-credentials/verify

Body: `{ "registry": "host[:port]" }`. Response: `{ "registry", "status": "authenticated" | "failed", "error"? }`.
````

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add server/index.ts API.md tests/integration/registryCredentials.test.ts
git commit -m "feat: add destination registry credentials API"
```

---

### Task 4: Start route modes, folder guard, merged authfile, details fields

**Files:**
- Modify: `server/index.ts`
  - `OperationRecord` (~line 32), `OptionalFlagsBody` and `OPTIONAL_FLAG_KEYS` (~45-57), `buildOptionalFlagArgs` (~72-158)
  - imports (from Task 3 block)
  - `POST /api/operations/start` (~1617-1868)
  - `GET /api/operations/:id/details` (~1946-2037)
- Modify: `API.md` (`POST /api/operations/start`, `GET /api/operations/:id/details`), `docs/dev/operations.md`
- Test: `tests/integration/operationModes.test.ts`

**Interfaces:**
- Consumes (Task 1): `OperationMode`, `OPERATION_MODES`, `isOperationMode`, `isRegistryTargetMode`, `getDestinationRegistryError`, `buildOcMirrorArgs`. (Task 2): `readAuthFile`, `writeAuthFile`, `mergeAuthFiles`, `resolveCredentialsLocation`, `AuthFileError`, `type AuthFile`.
- Produces:
  - `OperationRecord.mode?: OperationMode`, `OperationRecord.destinationRegistry?: string`
  - Start body fields `mode`, `destinationRegistry`, `skipDestTlsVerify`, `optionalFlags.maxNestedPaths`
  - Details response fields `mode: OperationMode`, `destinationRegistry?: string`, `clusterResourcesPath?: string`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/operationModes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTestApp } from './helpers/testApp.js';

const storageDir = process.env.STORAGE_DIR!;
const mirrorsDir = path.join(storageDir, 'mirrors');
const runDir = path.join(storageDir, 'run');
const b64 = (s: string) => Buffer.from(s).toString('base64');
const CONFIG = 'modes-config.yaml';

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition');
}

describe('Operation modes', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  let fakeDir: string;
  let origPath: string;
  let argsFile: string;
  let authCopy: string;

  const readArgs = () =>
    waitFor(async () => {
      try {
        const content = await fs.promises.readFile(argsFile, 'utf8');
        return content.includes('--v2') ? content.split('\n').filter(Boolean) : undefined;
      } catch {
        return undefined;
      }
    });

  const waitForCompletion = (operationId: string) =>
    waitFor(async () => {
      const res = await request.get('/api/operations');
      const op = res.body.find((o: { id: string }) => o.id === operationId);
      return op && op.status !== 'running' ? op : undefined;
    });

  beforeAll(async () => {
    request = await getTestApp();
    await request.post('/api/config/save').send({
      config:
        'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform: {}\n  operators: []\n  additionalImages: []',
      name: CONFIG,
    });

    fakeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oc-mirror-modes-'));
    argsFile = path.join(fakeDir, 'args.txt');
    authCopy = path.join(fakeDir, 'auth-copy.json');
    // Records argv, copies the --authfile it received, and can be held open with OC_MIRROR_SLEEP.
    await fs.promises.writeFile(
      path.join(fakeDir, 'oc-mirror'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" > "$OC_MIRROR_ARGS_FILE"',
        'prev=""',
        'for arg in "$@"; do',
        '  if [ "$prev" = "--authfile" ] && [ -n "$OC_MIRROR_AUTH_COPY" ]; then cp "$arg" "$OC_MIRROR_AUTH_COPY"; fi',
        '  prev="$arg"',
        'done',
        // exec so SIGTERM from the stop endpoint reaches sleep directly; a child sleep would
        // keep stdout open and delay the close event until it finished.
        'exec sleep "${OC_MIRROR_SLEEP:-0}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    origPath = process.env.PATH || '';
    process.env.PATH = `${fakeDir}:${origPath}`;
    process.env.OC_MIRROR_ARGS_FILE = argsFile;
    process.env.OC_MIRROR_AUTH_COPY = authCopy;
  });

  afterEach(async () => {
    delete process.env.OC_MIRROR_SLEEP;
    delete process.env.OC_MIRROR_REGISTRY_CREDENTIALS;
    await fs.promises.rm(argsFile, { force: true });
    await fs.promises.rm(authCopy, { force: true });
    await fs.promises.rm(process.env.OC_MIRROR_AUTHFILE!, { force: true });
    await fs.promises.rm(path.join(storageDir, 'registry-credentials.json'), { force: true });
  });

  afterAll(async () => {
    process.env.PATH = origPath;
    delete process.env.OC_MIRROR_ARGS_FILE;
    delete process.env.OC_MIRROR_AUTH_COPY;
    await fs.promises.rm(fakeDir, { recursive: true, force: true });
  });

  describe('validation', () => {
    it.each([
      [{ mode: 'mirrorToMirrors' }, /Unknown mode/],
      [{ mode: 'mirrorToMirror' }, /destinationRegistry is required/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'docker://reg.example.com' }, /scheme/],
      [{ mode: 'diskToMirror', destinationRegistry: 'reg.example.com/ns:v1' }, /tag/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com', skipDestTlsVerify: 'yes' }, /boolean/],
      [{ destinationRegistry: 'reg.example.com' }, /only valid for mirrorToMirror and diskToMirror/],
      [{ mode: 'mirrorToDisk', skipDestTlsVerify: true }, /only valid for mirrorToMirror and diskToMirror/],
      [{ optionalFlags: { maxNestedPaths: 2 } }, /maxNestedPaths is only valid/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com', optionalFlags: { maxNestedPaths: 0 } }, /positive integer/],
      [{ mode: 'mirrorToMirror', destinationRegistry: 'reg.example.com', optionalFlags: { maxNestedPaths: 1.5 } }, /positive integer/],
    ])('rejects %o', async (body, message) => {
      const res = await request.post('/api/operations/start').send({ configFile: CONFIG, ...body });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });

    it('returns 404 when the disk-to-mirror source folder does not exist', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: CONFIG,
        mode: 'diskToMirror',
        destinationRegistry: 'reg.example.com',
        mirrorDestinationSubdir: 'does-not-exist',
      });
      expect(res.status).toBe(404);
      expect(await fs.promises.access(path.join(mirrorsDir, 'does-not-exist')).then(() => true, () => false)).toBe(false);
    });

    it('returns 400 with help when the disk-to-mirror source has no archives', async () => {
      await fs.promises.mkdir(path.join(mirrorsDir, 'no-archives'), { recursive: true });
      const res = await request.post('/api/operations/start').send({
        configFile: CONFIG,
        mode: 'diskToMirror',
        destinationRegistry: 'reg.example.com',
        mirrorDestinationSubdir: 'no-archives',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mirror_\*\.tar/);
      expect(res.body.help).toBeDefined();
    });
  });

  it('runs mirror-to-mirror with the workspace, destination, TLS flag, and merged credentials', async () => {
    await fs.promises.writeFile(
      process.env.OC_MIRROR_AUTHFILE!,
      JSON.stringify({ auths: { 'registry.redhat.io': { auth: b64('rh:pw') }, 'reg.example.com:5000': { auth: b64('old:old') } } }),
    );
    await request.put('/api/registry-credentials').send({ registry: 'reg.example.com:5000', username: 'new', password: 'new' });

    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com:5000/ocp',
      mirrorDestinationSubdir: 'm2m-ws',
      optionalFlags: { maxNestedPaths: 2 },
    });
    expect(res.status).toBe(200);

    const args = await readArgs();
    expect(args[args.indexOf('--workspace') + 1]).toMatch(/^file:\/\/.*\/mirrors\/m2m-ws$/);
    expect(args).not.toContain('--from');
    expect(args).toContain('--dest-tls-verify=true');
    expect(args[args.indexOf('--max-nested-paths') + 1]).toBe('2');
    expect(args[args.length - 1]).toBe('docker://reg.example.com:5000/ocp');

    const authfile = args[args.indexOf('--authfile') + 1];
    expect(authfile).toBe(path.join(runDir, `authfile-${res.body.operationId}.json`));
    const merged = JSON.parse(await fs.promises.readFile(authCopy, 'utf8'));
    expect(merged.auths['registry.redhat.io'].auth).toBe(b64('rh:pw'));
    expect(merged.auths['reg.example.com:5000'].auth).toBe(b64('new:new'));

    const op = await waitForCompletion(res.body.operationId);
    expect(op.mode).toBe('mirrorToMirror');
    expect(op.destinationRegistry).toBe('reg.example.com:5000/ocp');
    expect(await fs.promises.access(authfile).then(() => true, () => false)).toBe(false);

    const details = await request.get(`/api/operations/${res.body.operationId}/details`);
    expect(details.body.mode).toBe('mirrorToMirror');
    expect(details.body.clusterResourcesPath).toBe(path.join(mirrorsDir, 'm2m-ws', 'working-dir', 'cluster-resources'));
  });

  it('runs disk-to-mirror from an archive folder with TLS verification skipped and no pull secret', async () => {
    const source = path.join(mirrorsDir, 'archive-src');
    await fs.promises.mkdir(source, { recursive: true });
    await fs.promises.writeFile(path.join(source, 'mirror_000001.tar'), '');

    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'diskToMirror',
      destinationRegistry: 'reg.example.com',
      skipDestTlsVerify: true,
      mirrorDestinationSubdir: 'archive-src',
    });
    expect(res.status).toBe(200);

    const args = await readArgs();
    expect(args[args.indexOf('--from') + 1]).toMatch(/^file:\/\/.*\/mirrors\/archive-src$/);
    expect(args).not.toContain('--workspace');
    expect(args).toContain('--dest-tls-verify=false');
    expect(args[args.length - 1]).toBe('docker://reg.example.com');
    expect(JSON.parse(await fs.promises.readFile(authCopy, 'utf8'))).toEqual({ auths: {} });
    await waitForCompletion(res.body.operationId);
  });

  it('keeps mirror-to-disk working when mode is omitted and records the mode', async () => {
    const res = await request.post('/api/operations/start').send({ configFile: CONFIG });
    expect(res.status).toBe(200);
    const args = await readArgs();
    expect(args[args.length - 1]).toMatch(/^file:\/\//);
    expect(args).toContain('--dest-tls-verify=false');
    const op = await waitForCompletion(res.body.operationId);
    expect(op.mode).toBe('mirrorToDisk');
    expect(op.destinationRegistry).toBeUndefined();

    const details = await request.get(`/api/operations/${res.body.operationId}/details`);
    expect(details.body.clusterResourcesPath).toBeUndefined();
  });

  it('rejects a second start on a folder in use, then releases it when the first finishes', async () => {
    process.env.OC_MIRROR_SLEEP = '1';
    const first = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com',
      mirrorDestinationSubdir: 'busy',
    });
    expect(first.status).toBe(200);

    const second = await request.post('/api/operations/start').send({ configFile: CONFIG, mirrorDestinationSubdir: 'busy' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/running operation/i);

    await waitForCompletion(first.body.operationId);
    delete process.env.OC_MIRROR_SLEEP;
    const third = await request.post('/api/operations/start').send({ configFile: CONFIG, mirrorDestinationSubdir: 'busy' });
    expect(third.status).toBe(200);
    await waitForCompletion(third.body.operationId);
  });

  it('removes the temporary authfile and releases the folder when a run is stopped', async () => {
    process.env.OC_MIRROR_SLEEP = '30';
    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com',
      mirrorDestinationSubdir: 'stopped-ws',
    });
    expect(res.status).toBe(200);
    const authfile = path.join(runDir, `authfile-${res.body.operationId}.json`);
    await readArgs();
    expect(await fs.promises.access(authfile).then(() => true, () => false)).toBe(true);

    await request.post(`/api/operations/${res.body.operationId}/stop`);
    const op = await waitForCompletion(res.body.operationId);
    expect(op.status).toBe('stopped');
    expect(await fs.promises.access(authfile).then(() => true, () => false)).toBe(false);

    delete process.env.OC_MIRROR_SLEEP;
    const again = await request.post('/api/operations/start').send({ configFile: CONFIG, mirrorDestinationSubdir: 'stopped-ws' });
    expect(again.status).toBe(200);
    await waitForCompletion(again.body.operationId);
  });

  it('returns 500 naming the file when destination credentials are malformed, without creating an operation', async () => {
    const broken = path.join(storageDir, 'broken-creds.json');
    await fs.promises.writeFile(broken, 'not json');
    process.env.OC_MIRROR_REGISTRY_CREDENTIALS = broken;
    const before = (await request.get('/api/operations')).body.length;

    const res = await request.post('/api/operations/start').send({
      configFile: CONFIG,
      mode: 'mirrorToMirror',
      destinationRegistry: 'reg.example.com',
      mirrorDestinationSubdir: 'bad-creds',
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain(broken);
    expect((await request.get('/api/operations')).body.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/operationModes.test.ts`
Expected: FAIL (validation cases return 200 or wrong messages; mode fields missing).

- [ ] **Step 3: Extend imports, `OperationRecord`, and optional flags in `server/index.ts`**

Replace the Task 3 import lines with:

```ts
import { buildOcMirrorArgs } from './ocMirrorArgs.js';
import {
  type OperationMode,
  OPERATION_MODES,
  getDestinationRegistryError,
  isOperationMode,
  isRegistryTargetMode,
  isValidRegistryHost,
} from './operationModes.js';
import {
  type AuthFile,
  AuthFileError,
  listCredentials,
  mergeAuthFiles,
  readAuthFile,
  removeCredential,
  resolveCredentialsLocation,
  upsertCredential,
  writeAuthFile,
} from './registryCredentials.js';
```

In `interface OperationRecord`, after `configFile: string;` add:

```ts
  /** Absent on records created before modes existed; read as 'mirrorToDisk'. */
  mode?: OperationMode;
  destinationRegistry?: string;
```

In `interface OptionalFlagsBody` add `maxNestedPaths?: number;`, and add `'maxNestedPaths',` to `OPTIONAL_FLAG_KEYS`.

Change the signature to `function buildOptionalFlagArgs(raw: unknown, mode: OperationMode): ...` and, just before `return { ok: true, args: additionalArgs };`, add:

```ts
  if (typed.maxNestedPaths != null) {
    if (!isRegistryTargetMode(mode)) {
      return { ok: false, error: 'optionalFlags.maxNestedPaths is only valid for mirrorToMirror and diskToMirror' };
    }
    if (
      typeof typed.maxNestedPaths !== 'number' ||
      !Number.isSafeInteger(typed.maxNestedPaths) ||
      typed.maxNestedPaths < 1
    ) {
      return { ok: false, error: 'optionalFlags.maxNestedPaths must be a positive integer' };
    }
    additionalArgs.push('--max-nested-paths', String(typed.maxNestedPaths));
  }
```

Next to `const runningProcesses` (search `runningProcesses = new Map`), add:

```ts
// Folders used by running operations. Checked and claimed synchronously so two starts
// cannot both pass the check; M2D deletes earlier archives in its folder, which would
// break a D2M run reading from it.
const foldersInUse = new Set<string>();
```

- [ ] **Step 4: Rewrite the top of `POST /api/operations/start` (body parsing through optional flags)**

Replace from `const { configFile, mirrorDestinationSubdir, optionalFlags } = req.body;` through `const additionalArgs = optionalFlagsResult.args;` with:

```ts
    const {
      configFile,
      mirrorDestinationSubdir,
      optionalFlags,
      mode: rawMode,
      destinationRegistry,
      skipDestTlsVerify,
    } = req.body;
    const operationId = uuidv4();
    const configPath = path.join(CONFIGS_DIR, configFile);

    const mode: unknown = rawMode ?? 'mirrorToDisk';
    if (!isOperationMode(mode)) {
      return res.status(400).json({
        error: `Unknown mode: ${String(rawMode)}`,
        help: `Use one of: ${OPERATION_MODES.join(', ')}`,
      });
    }

    const targetsRegistry = isRegistryTargetMode(mode);
    if (!targetsRegistry && (destinationRegistry !== undefined || skipDestTlsVerify !== undefined)) {
      return res.status(400).json({
        error: 'destinationRegistry and skipDestTlsVerify are only valid for mirrorToMirror and diskToMirror',
      });
    }
    if (targetsRegistry) {
      const destinationError = getDestinationRegistryError(destinationRegistry);
      if (destinationError) {
        return res.status(400).json({ error: destinationError });
      }
      if (skipDestTlsVerify !== undefined && typeof skipDestTlsVerify !== 'boolean') {
        return res.status(400).json({ error: 'skipDestTlsVerify must be a boolean' });
      }
    }

    const optionalFlagsResult = buildOptionalFlagArgs(optionalFlags, mode);
    if (!optionalFlagsResult.ok) {
      return res.status(400).json({ error: optionalFlagsResult.error });
    }
    const additionalArgs = optionalFlagsResult.args;
```

- [ ] **Step 5: Add the disk-to-mirror source check**

Immediately after `const mirrorPath = path.join(baseMirrorPath, subdirName);` insert:

```ts
    if (mode === 'diskToMirror') {
      let entries: string[];
      try {
        entries = await fsp.readdir(mirrorPath);
      } catch {
        return res.status(404).json({ error: 'Archive source folder not found', path: mirrorPath });
      }
      if (!entries.some((name) => /^mirror_.*\.tar$/.test(name))) {
        return res.status(400).json({
          error: 'Archive source folder contains no mirror_*.tar archives',
          path: mirrorPath,
          help: 'Copy the archives produced by a mirror-to-disk run into this folder first.',
        });
      }
    }
```

This runs before the existing directory create and write checks, so a missing D2M folder is never created.

- [ ] **Step 6: Read credentials, claim the folder, and record the mode**

Replace from `const operation: OperationRecord = {` through the closing `}` of the `saveOperation` try/catch with:

```ts
    let mergedAuth: AuthFile | null = null;
    if (targetsRegistry) {
      try {
        const credentialsLocation = resolveCredentialsLocation(process.env, STORAGE_DIR);
        const [pullSecretAuth, destinationAuth] = await Promise.all([
          readAuthFile(AUTHFILE_PATH, 'Pull secret', false),
          readAuthFile(credentialsLocation.path, 'Destination registry credentials', true),
        ]);
        mergedAuth = mergeAuthFiles(pullSecretAuth, destinationAuth);
      } catch (error: unknown) {
        if (error instanceof AuthFileError) {
          return res.status(500).json({ error: error.message });
        }
        throw error;
      }
    }

    // No await between this check and the add, so concurrent starts cannot both claim the folder.
    if (foldersInUse.has(mirrorPath)) {
      return res.status(409).json({
        error: 'Another running operation is using this folder',
        path: mirrorPath,
        help: 'Wait for it to finish or choose a different folder.',
      });
    }
    foldersInUse.add(mirrorPath);
    const releaseFolder = () => foldersInUse.delete(mirrorPath);

    const operation: OperationRecord = {
      id: operationId,
      name: `Mirror Operation ${operationId.slice(0, 8)}`,
      configFile,
      mode,
      ...(targetsRegistry ? { destinationRegistry } : {}),
      mirrorDestination: mirrorPath,
      status: 'running',
      startedAt: new Date().toISOString(),
      logs: [],
    };

    try {
      await saveOperation(operation);
    } catch (error: unknown) {
      releaseFolder();
      console.error(`Error saving operation ${operationId}:`, error);
      return res.status(500).json({
        error: 'Failed to create operation record',
        details: (error as Error).message,
      });
    }

    const tempAuthfilePath = targetsRegistry ? path.join(RUN_DIR, `authfile-${operationId}.json`) : null;
    const removeTempAuthfile = async () => {
      if (!tempAuthfilePath) return;
      try {
        await fsp.rm(tempAuthfilePath, { force: true });
      } catch (error: unknown) {
        console.error(`Failed to remove temporary authfile for ${operationId}:`, error);
      }
    };

    if (tempAuthfilePath && mergedAuth) {
      try {
        await fsp.mkdir(RUN_DIR, { recursive: true });
        await writeAuthFile(tempAuthfilePath, mergedAuth);
      } catch (error: unknown) {
        await removeTempAuthfile();
        releaseFolder();
        console.error(`Error writing temporary authfile for ${operationId}:`, error);
        await updateOperation(operationId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          errorMessage: 'Failed to prepare registry credentials',
        });
        return res.status(500).json({
          error: 'Failed to prepare registry credentials',
          details: (error as Error).message,
        });
      }
    }
```

- [ ] **Step 7: Spawn with the argv builder and clean up on every exit path**

Delete the line `const mirrorUrl = pathToFileURL(mirrorPath).href;` (and remove `pathToFileURL` from the `url` import if it is no longer used anywhere; check with `grep -n pathToFileURL server/index.ts`).

Replace the `const child = spawn('oc-mirror', [ ... ], { ... });` statement with:

```ts
    const ocMirrorArgs = buildOcMirrorArgs({
      mode,
      configPath,
      folderPath: mirrorPath,
      cacheDir,
      authfilePath: tempAuthfilePath ?? AUTHFILE_PATH,
      destinationRegistry: targetsRegistry ? destinationRegistry : undefined,
      skipDestTlsVerify: skipDestTlsVerify === true,
      additionalArgs,
    });

    let child: ChildProcess;
    try {
      child = spawn('oc-mirror', ocMirrorArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: RUN_DIR,
      });
    } catch (error: unknown) {
      finalizeLogStream();
      await removeTempAuthfile();
      releaseFolder();
      await updateOperation(operationId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: (error as Error).message,
      });
      throw error;
    }
```

In the `child.on('close', ...)` handler, right after `finalizeLogStream();`, add:

```ts
      releaseFolder();
      await removeTempAuthfile();
```

In the `child.on('error', ...)` handler, right after `finalizeLogStream();`, add the same two lines.

The stop endpoint kills the process, which fires `close`, so it needs no change.

- [ ] **Step 8: Add mode fields to `GET /api/operations/:id/details`**

Replace `const details = {` and its first line with:

```ts
    const mode = operation.mode ?? 'mirrorToDisk';
    const details = {
      mode,
      destinationRegistry: operation.destinationRegistry,
      // oc-mirror writes IDMS/ITMS/CatalogSource under <workspace or --from dir>/working-dir.
      clusterResourcesPath: isRegistryTargetMode(mode) && operation.mirrorDestination
        ? path.join(operation.mirrorDestination, 'working-dir', 'cluster-resources')
        : undefined,
      imagesMirrored: 0,
```

(keep the rest of the object unchanged).

- [ ] **Step 9: Run the new and existing operation tests**

Run: `npx vitest run tests/integration/operationModes.test.ts tests/integration/operations.test.ts tests/integration/operationsLifecycle.test.ts`
Expected: PASS. The existing lifecycle test that asserts flags come before the final `file:` URL must still pass unchanged.

- [ ] **Step 10: Update docs**

In `API.md`, under `#### POST /api/operations/start`, after the existing `mirrorDestinationSubdir` bullet list, add:

```markdown
- `mode` (string, optional): `mirrorToDisk` (default), `mirrorToMirror`, or `diskToMirror`.
- `destinationRegistry` (string, required for `mirrorToMirror` and `diskToMirror`): `host[:port]` with an optional lowercase namespace path, for example `registry.example.com:5000/ocp`. Do not include `docker://`, a tag, or a digest. Rejected for `mirrorToDisk`.
- `skipDestTlsVerify` (boolean, optional, `mirrorToMirror`/`diskToMirror` only): passes `--dest-tls-verify=false`. Defaults to verifying TLS.
- `optionalFlags.maxNestedPaths` (positive integer, `mirrorToMirror`/`diskToMirror` only): passes `--max-nested-paths`.

The meaning of `mirrorDestinationSubdir` depends on the mode: the archive output folder for `mirrorToDisk`, the `--workspace` folder for `mirrorToMirror` (created if missing), and the `--from` archive source for `diskToMirror` (must exist and contain `mirror_*.tar`; `404` when missing, `400` when it has no archives). A start returns `409` when a running operation already uses the folder.

For registry-target modes the server merges the pull secret with the destination registry credentials (destination entries win for the same host) into a temporary `0600` authfile that is deleted when the operation ends. A malformed pull secret or credentials file returns `500` naming the file.
```

Under `#### GET /api/operations/:id/details`, after the "Response Fields" list, add:

```markdown
- `mode`: The operation mode (`mirrorToDisk` for records created before modes existed)
- `destinationRegistry`: Present for `mirrorToMirror` and `diskToMirror`
- `clusterResourcesPath`: For `mirrorToMirror` and `diskToMirror`, the folder holding the generated IDMS, ITMS, and CatalogSource manifests (`<folder>/working-dir/cluster-resources`)
```

In `docs/dev/operations.md`, replace the first list item with:

```markdown
1. **Start**: The server validates the config file and the mode-specific inputs, prepares the folder (creating it for mirror-to-disk and mirror-to-mirror; requiring existing `mirror_*.tar` archives for disk-to-mirror), claims the folder so no other running operation can use it, saves an `OperationRecord` JSON file, and spawns `oc-mirror --v2`. Mirror-to-disk writes to `file://<folder>`; mirror-to-mirror uses `--workspace file://<folder> docker://<destination>`; disk-to-mirror uses `--from file://<folder> docker://<destination>`. Registry-target modes run with a temporary `0600` authfile that merges the pull secret with the destination registry credentials.
```

and append to item 3 (Completion): ` The folder claim is released and any temporary authfile is deleted on exit, error, or stop.`

- [ ] **Step 11: Lint and commit**

```bash
npm run lint
git add server/index.ts API.md docs/dev/operations.md tests/integration/operationModes.test.ts
git commit -m "feat: run mirror-to-mirror and disk-to-mirror operations"
```

---

### Task 5: Helm values for externally managed credentials

**Files:**
- Modify: `charts/mirror-gui/values.yaml` (after the `pullSecret` block, ~line 39)
- Modify: `charts/mirror-gui/templates/deployment.yaml`
- Modify: `README.md` ("Deploy on OpenShift with Helm" section)
- Test: `tests/scripts/helmRegistryCredentials.test.ts`

**Interfaces:**
- Consumes: env var name `OC_MIRROR_REGISTRY_CREDENTIALS` (Task 2).
- Produces: values `registryCredentials.existingSecret` (default `""`), `registryCredentials.key` (default `auth.json`).

- [ ] **Step 1: Write the failing chart tests**

Create `tests/scripts/helmRegistryCredentials.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

let helmAvailable = true;
try {
  execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
} catch {
  helmAvailable = false;
}

const render = (...sets: string[]) =>
  execFileSync(
    'helm',
    ['template', 't', 'charts/mirror-gui', ...sets.flatMap(s => ['--set-string', s])],
    { encoding: 'utf8' },
  );

// The app treats OC_MIRROR_REGISTRY_CREDENTIALS as a read-only external file, so the chart
// must only set it when a Secret is mounted, and must mount that Secret read-only.
describe.skipIf(!helmAvailable)('Helm chart destination registry credentials', () => {
  it('renders nothing by default so credentials stay app-managed', () => {
    const out = render();
    expect(out).not.toContain('OC_MIRROR_REGISTRY_CREDENTIALS');
    expect(out).not.toContain('registry-credentials');
  });

  it('mounts the Secret read-only and points the env var at the key', () => {
    const out = render('registryCredentials.existingSecret=dest-creds');
    expect(out).toMatch(/name: OC_MIRROR_REGISTRY_CREDENTIALS\n\s+value: \/app\/registry-credentials\/auth\.json/);
    expect(out).toMatch(/- name: registry-credentials\n\s+mountPath: \/app\/registry-credentials\n\s+readOnly: true/);
    expect(out).toMatch(/secretName: dest-creds\n\s+items:\n\s+- key: auth\.json\n\s+path: auth\.json/);
  });

  it('honors a custom key', () => {
    const out = render('registryCredentials.existingSecret=dest-creds', 'registryCredentials.key=config.json');
    expect(out).toContain('value: /app/registry-credentials/config.json');
    expect(out).toMatch(/- key: config\.json\n\s+path: config\.json/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scripts/helmRegistryCredentials.test.ts`
Expected: FAIL on the second and third cases (if `helm` is not installed the suite is skipped; report that rather than claiming a pass).

- [ ] **Step 3: Add the values**

In `charts/mirror-gui/values.yaml`, after the `pullSecret` block:

```yaml
# Optional Secret holding a container auth file (auth.json format) with credentials for the
# registries that mirror-to-mirror and disk-to-mirror push to. When set, the Settings form
# for destination credentials is read-only.
registryCredentials:
  existingSecret: ""
  key: auth.json
```

- [ ] **Step 4: Render env, mount, and volume**

In `charts/mirror-gui/templates/deployment.yaml`, after the `OC_MIRROR_AUTHFILE` `{{- end }}`:

```yaml
            {{- if (.Values.registryCredentials).existingSecret }}
            - name: OC_MIRROR_REGISTRY_CREDENTIALS
              value: /app/registry-credentials/{{ (.Values.registryCredentials).key }}
            {{- end }}
```

After the `pull-secret` volumeMount `{{- end }}`:

```yaml
            {{- if (.Values.registryCredentials).existingSecret }}
            - name: registry-credentials
              mountPath: /app/registry-credentials
              readOnly: true
            {{- end }}
```

After the `pull-secret` volume `{{- end }}`:

```yaml
        {{- if (.Values.registryCredentials).existingSecret }}
        - name: registry-credentials
          secret:
            secretName: {{ (.Values.registryCredentials).existingSecret }}
            items:
              - key: {{ (.Values.registryCredentials).key }}
                path: {{ (.Values.registryCredentials).key }}
        {{- end }}
```

- [ ] **Step 5: Run chart tests**

Run: `npx vitest run tests/scripts/helmRegistryCredentials.test.ts tests/scripts/helmProxy.test.ts tests/scripts/helmNaming.test.ts`
Expected: PASS (or SKIPPED if `helm` is unavailable; say so).

- [ ] **Step 6: Document in README**

In `README.md`, after the proxy paragraph of "Deploy on OpenShift with Helm", add:

````markdown
Mirror-to-mirror and disk-to-mirror push to a destination registry. Its credentials can be managed in **Settings > Registry**, or supplied from a Secret holding a container auth file (the `auth.json` format used by `podman login`). A Secret makes the Settings form read-only:

```bash
oc -n mirror-gui create secret generic mirror-gui-registry-credentials \
  --from-file=auth.json=/secure/path/auth.json

helm upgrade --install mirror-gui charts/mirror-gui \
  --set registryCredentials.existingSecret=mirror-gui-registry-credentials
```

oc-mirror only trusts the system certificate store. A destination registry signed by a private CA needs **Skip TLS verification for destination** when starting the operation.
````

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add charts/mirror-gui/values.yaml charts/mirror-gui/templates/deployment.yaml README.md tests/scripts/helmRegistryCredentials.test.ts
git commit -m "feat: mount destination registry credentials from a Secret"
```

---

### Task 6: Mirror Operations UI

**Files:**
- Modify: `src/components/MirrorOperations.tsx`
- Test: `tests/e2e/operationModes.spec.ts`

**Interfaces:**
- Consumes (Task 1): `OPERATION_MODES`, `OPERATION_MODE_LABELS`, `getDestinationRegistryError`, `getRegistryHost`, `isRegistryTargetMode`, `type OperationMode` from `../../server/operationModes`. (Task 3): `GET /api/registry-credentials`. Existing `GET /api/registries`. (Task 4): start body fields, `Operation.mode`, `Operation.destinationRegistry`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing E2E tests**

Create `tests/e2e/operationModes.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

async function mockNoCredentials(page: Page) {
  await page.route('**/api/registries', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registries: [] }) }));
  await page.route('**/api/registry-credentials', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ managedExternally: false, path: null, credentials: [] }),
    }));
}

test.describe('Operation modes', () => {
  test.beforeEach(async ({ page }) => {
    await mockNoCredentials(page);
    await page.goto('/operations');
  });

  test('mirror to disk is the default and shows no registry fields', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Mirror to disk' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Mirror Destination Folder')).toBeVisible();
    await expect(page.getByLabel('Destination registry')).toHaveCount(0);
  });

  test('mirror to mirror shows the workspace label, destination, and TLS opt-out', async ({ page }) => {
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await expect(page.getByText('Workspace Folder')).toBeVisible();
    await expect(page.getByLabel('Destination registry')).toBeVisible();
    await expect(page.getByLabel('Skip TLS verification for destination')).not.toBeChecked();

    await page.getByRole('button', { name: /Advanced Options/i }).click();
    await expect(page.getByLabel('Enable max nested paths')).toBeVisible();
  });

  test('max nested paths is hidden for mirror to disk', async ({ page }) => {
    await page.getByRole('button', { name: /Advanced Options/i }).click();
    await expect(page.getByLabel('Enable max nested paths')).toHaveCount(0);
  });

  test('invalid destination shows the server rule and disables start', async ({ page }) => {
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await page.getByLabel('Destination registry').fill('docker://reg.example.com');
    await expect(page.getByText(/must not include a scheme/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Operation' })).toBeDisabled();
  });

  test('warns when the destination host has no credentials and links to Settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await page.getByLabel('Destination registry').fill('mirror.example.com:5000/ocp');
    const warning = page.getByText('No credentials for mirror.example.com:5000');
    await expect(warning).toBeVisible();
    await expect(page.getByRole('link', { name: /add credentials in Settings/i })).toHaveAttribute(
      'href',
      '/settings?tab=registry',
    );
  });

  test('disk to mirror uses the archive label and offers no folder creation', async ({ page }) => {
    await page.getByRole('button', { name: 'Disk to mirror' }).click();
    await expect(page.getByText('Archive Source Folder')).toBeVisible();
    await page.getByText('default', { exact: true }).click();
    await expect(page.getByText('Create new folder...')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/operationModes.spec.ts`
Expected: FAIL (no mode toggle).

- [ ] **Step 3: Imports, types, and constants**

Add to the `@patternfly/react-core` import list: `ToggleGroup`, `ToggleGroupItem`, `Checkbox`, `FormHelperText`, `HelperText`, `HelperTextItem`.

Add after the `useAlerts` import:

```ts
import { Link } from 'react-router-dom';
import {
  OPERATION_MODES,
  OPERATION_MODE_LABELS,
  getDestinationRegistryError,
  getRegistryHost,
  isRegistryTargetMode,
  type OperationMode,
} from '../../server/operationModes';
```

In `interface Operation` add:

```ts
  mode?: OperationMode;
  destinationRegistry?: string;
```

In `interface OptionalFlags` add `maxNestedPathsEnabled: boolean; maxNestedPathsValue: string;`, in `interface OptionalFlagsPayload` add `maxNestedPaths?: number;`, and in `DEFAULT_OPTIONAL_FLAGS` add `maxNestedPathsEnabled: false, maxNestedPathsValue: '2',`.

After `DEFAULT_OPTIONAL_FLAGS` add:

```ts
const FOLDER_LABELS: Record<OperationMode, { text: string; help: string }> = {
  mirrorToDisk: {
    text: 'Mirror Destination Folder',
    help: 'Mirror output is saved to data/mirrors/<folder>. Defaults to "default" if unchanged. Select an existing folder or create a new one from the dropdown.',
  },
  mirrorToMirror: {
    text: 'Workspace Folder',
    help: 'oc-mirror keeps its working files in data/mirrors/<folder>, including the generated cluster resources (IDMS, ITMS, CatalogSource) under working-dir/cluster-resources.',
  },
  diskToMirror: {
    text: 'Archive Source Folder',
    help: 'Folder under data/mirrors that contains the mirror_*.tar archives to push. Generated cluster resources are written to its working-dir/cluster-resources.',
  },
};
```

- [ ] **Step 4: Make the optional flag helpers mode-aware**

Change `buildOptionalFlagsPayload` to `(flags: OptionalFlags, mode: OperationMode)` and add before `return payload;`:

```ts
  if (isRegistryTargetMode(mode) && flags.maxNestedPathsEnabled) {
    const value = parseNonNegativeInt(flags.maxNestedPathsValue);
    if (value === null || value < 1) {
      return null;
    }
    payload.maxNestedPaths = value;
  }
```

Change `getOptionalFlagsValidationError` to `(flags: OptionalFlags, mode: OperationMode)` and add before `return '';`:

```ts
  if (isRegistryTargetMode(mode) && flags.maxNestedPathsEnabled) {
    const value = parseNonNegativeInt(flags.maxNestedPathsValue);
    if (value === null || value < 1) {
      return 'Max nested paths must be a whole number of at least 1';
    }
  }
```

Update both call sites in `startOperation` to pass `mode`.

- [ ] **Step 5: State, credential hosts, and start payload**

After the `optionalFlags` state add:

```ts
  const [mode, setMode] = useState<OperationMode>('mirrorToDisk');
  const [destinationRegistry, setDestinationRegistry] = useState('');
  const [skipDestTlsVerify, setSkipDestTlsVerify] = useState(false);
  const [credentialHosts, setCredentialHosts] = useState<Set<string> | null>(null);

  const targetsRegistry = isRegistryTargetMode(mode);
  const trimmedDestination = destinationRegistry.trim();
  const destinationError = targetsRegistry ? getDestinationRegistryError(trimmedDestination) : null;
  const destinationHost = trimmedDestination && !destinationError ? getRegistryHost(trimmedDestination) : null;
  const missingCredentials = !!destinationHost && credentialHosts !== null && !credentialHosts.has(destinationHost);
```

Add a fetch function next to `fetchFolders`:

```ts
  // Hosts with credentials in either the pull secret or the destination credentials, used only
  // to warn before start; oc-mirror still decides whether the push is allowed.
  const fetchCredentialHosts = useCallback(async () => {
    try {
      const [pullSecretRes, credentialsRes] = await Promise.all([
        axios.get('/api/registries'),
        axios.get('/api/registry-credentials'),
      ]);
      const hosts = new Set<string>();
      for (const r of pullSecretRes.data.registries || []) hosts.add(r.registry);
      for (const c of credentialsRes.data.credentials || []) hosts.add(c.registry);
      setCredentialHosts(hosts);
    } catch (error) {
      console.error('Error fetching registry credentials:', error);
      setCredentialHosts(null);
    }
  }, []);
```

Add a mode change handler:

```ts
  const handleModeChange = (nextMode: OperationMode) => {
    setMode(nextMode);
    setFolderCreateMode(false);
    if (nextMode === 'diskToMirror' && mirrorDestinationSubdir && !availableFolders.includes(mirrorDestinationSubdir)) {
      setMirrorDestinationSubdir('');
    }
    if (isRegistryTargetMode(nextMode)) {
      void fetchCredentialHosts();
    }
  };
```

In `startOperation`, after the optional flags checks, add:

```ts
    if (destinationError) {
      addDangerAlert(destinationError);
      return;
    }
```

and replace the `axios.post('/api/operations/start', {...})` body with:

```ts
      const response = await axios.post('/api/operations/start', {
        configFile: selectedConfig,
        mode,
        mirrorDestinationSubdir: mirrorDestinationSubdir.trim() || undefined,
        ...(targetsRegistry ? { destinationRegistry: trimmedDestination, skipDestTlsVerify } : {}),
        ...(Object.keys(optionalFlagsPayload).length > 0
          ? { optionalFlags: optionalFlagsPayload }
          : {}),
      });
```

- [ ] **Step 6: Mode toggle and destination fields JSX**

At the start of the "Start New Operation" `<CardBody>`, before the ImageSetConfiguration `FormGroup`, add:

```tsx
          <FormGroup label="Mode" fieldId="operation-mode" className="pf-v6-u-mb-md">
            <ToggleGroup aria-label="Operation mode">
              {OPERATION_MODES.map((option) => (
                <ToggleGroupItem
                  key={option}
                  text={OPERATION_MODE_LABELS[option]}
                  buttonId={`mode-${option}`}
                  isSelected={mode === option}
                  onChange={() => handleModeChange(option)}
                />
              ))}
            </ToggleGroup>
          </FormGroup>
```

In the folder `FormGroup` label, replace the hardcoded `text`/`bodyContent` with `text={FOLDER_LABELS[mode].text}` and `bodyContent={FOLDER_LABELS[mode].help}`, and set `ariaLabel={`More info about ${FOLDER_LABELS[mode].text.toLowerCase()}`}`.

In the folder `SelectList`, wrap the divider and the create option so they are omitted in D2M:

```tsx
                      {mode !== 'diskToMirror' && availableFolders.length > 0 && <Divider />}
                      {mode !== 'diskToMirror' && (
                        <SelectOption
                          value="__create__"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderCreateMode(true);
                            setNewFolderName('');
                          }}
                        >
                          <PlusCircleIcon className="pf-v6-u-mr-xs" /> Create new folder...
                        </SelectOption>
                      )}
```

Change the Start button's `isDisabled` to `{!selectedConfig || loading || !!destinationError}`.

Between the closing `</Flex>` of the folder row and `<ExpandableSection`, add:

```tsx
          {targetsRegistry && (
            <>
              <FormGroup label="Destination registry" isRequired fieldId="destination-registry" className="pf-v6-u-mt-md">
                <TextInput
                  id="destination-registry"
                  aria-label="Destination registry"
                  placeholder="registry.example.com:5000/mirror"
                  value={destinationRegistry}
                  onChange={(_e, value) => setDestinationRegistry(value)}
                  validated={trimmedDestination && destinationError ? 'error' : 'default'}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem variant={trimmedDestination && destinationError ? 'error' : 'default'}>
                      {trimmedDestination && destinationError
                        ? destinationError
                        : 'Host, optional port, and optional namespace. Do not include docker://.'}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              {missingCredentials && (
                <Alert
                  variant="warning"
                  isInline
                  className="pf-v6-u-mt-sm"
                  title={`No credentials for ${destinationHost}`}
                >
                  Neither the pull secret nor the destination registry credentials have an entry for this
                  host, so oc-mirror will push anonymously.{' '}
                  <Link to="/settings?tab=registry">Add credentials in Settings</Link>.
                </Alert>
              )}
              <FormGroup fieldId="skip-dest-tls" className="pf-v6-u-mt-md">
                <Checkbox
                  id="skip-dest-tls"
                  label="Skip TLS verification for destination"
                  description="Sends credentials without checking the registry certificate. Use only for registries with a self-signed or private CA certificate."
                  isChecked={skipDestTlsVerify}
                  onChange={(_e, checked) => setSkipDestTlsVerify(checked)}
                />
              </FormGroup>
            </>
          )}
```

At the end of the `ExpandableSection` (after the "Retry times" `FormGroup`), add:

```tsx
            {targetsRegistry && (
              <FormGroup
                label={
                  <FormGroupInfoLabel
                    text="Max nested paths"
                    ariaLabel="More info about max nested paths"
                    bodyContent="Limits how many path levels oc-mirror uses for repositories in the destination registry. Set it when the registry rejects deeply nested repository names."
                  />
                }
                fieldId="flag-max-nested-paths"
                className="pf-v6-u-mt-md"
              >
                <Switch
                  id="flag-max-nested-paths"
                  isChecked={optionalFlags.maxNestedPathsEnabled}
                  onChange={(_e, checked) =>
                    setOptionalFlags((prev) => ({ ...prev, maxNestedPathsEnabled: checked }))
                  }
                  aria-label="Enable max nested paths"
                />
                {optionalFlags.maxNestedPathsEnabled && (
                  <div className="pf-v6-u-mt-sm">
                    <NumberInput
                      id="flag-max-nested-paths-value"
                      value={optionalFlags.maxNestedPathsValue ? Number(optionalFlags.maxNestedPathsValue) : 1}
                      min={1}
                      onMinus={() =>
                        setOptionalFlags((prev) => ({
                          ...prev,
                          maxNestedPathsValue: adjustDigitField(prev.maxNestedPathsValue, -1, 1),
                        }))
                      }
                      onPlus={() =>
                        setOptionalFlags((prev) => ({
                          ...prev,
                          maxNestedPathsValue: adjustDigitField(prev.maxNestedPathsValue, 1, 1),
                        }))
                      }
                      onChange={(e: React.FormEvent<HTMLInputElement>) => {
                        const val = (e.target as HTMLInputElement).value;
                        setOptionalFlags((prev) => ({ ...prev, maxNestedPathsValue: sanitizeDigitsInput(val) }));
                      }}
                      widthChars={4}
                      inputAriaLabel="Max nested paths"
                      minusBtnAriaLabel="Decrease max nested paths"
                      plusBtnAriaLabel="Increase max nested paths"
                    />
                  </div>
                )}
              </FormGroup>
            )}
```

- [ ] **Step 7: Mode column and cluster resources action in the operations table**

In the table header, after `<Th>Config</Th>` add `<Th>Mode</Th>`. In the row, after the Config `Td`, add:

```tsx
                    <Td dataLabel="Mode">
                      <Label isCompact>{OPERATION_MODE_LABELS[op.mode ?? 'mirrorToDisk']}</Label>
                      {op.destinationRegistry && (
                        <div className="pf-v6-u-font-size-sm pf-v6-u-mt-xs">{op.destinationRegistry}</div>
                      )}
                    </Td>
```

After the "Copy Location" `DropdownItem` block, add:

```tsx
                          {op.status === 'success' && op.mirrorDestination && isRegistryTargetMode(op.mode ?? 'mirrorToDisk') && (
                            <DropdownItem
                              key={`${op.id}-copy-cluster-resources`}
                              icon={<CopyIcon />}
                              onClick={() => {
                                setKebabOpen((prev) => ({ ...prev, [op.id]: false }));
                                // Same layout the server reports as clusterResourcesPath.
                                void copyMirrorPath(`${op.mirrorDestination}/working-dir/cluster-resources`);
                              }}
                            >
                              Copy Cluster Resources Path
                            </DropdownItem>
                          )}
```

- [ ] **Step 8: Run E2E tests (new and existing operations specs)**

Run: `npx playwright test tests/e2e/operationModes.spec.ts tests/e2e/mirrorOperations.spec.ts tests/e2e/startOperationErrors.spec.ts`
Expected: PASS. If a ToggleGroupItem does not expose `aria-pressed`, check the rendered markup and adjust only the new test's selector, never existing tests.

- [ ] **Step 9: Build, lint, and commit**

```bash
npm run build
npm run lint
git add src/components/MirrorOperations.tsx tests/e2e/operationModes.spec.ts
git commit -m "feat: select mirror mode and destination on the operations page"
```

---

### Task 7: Settings destination credentials section

**Files:**
- Modify: `src/components/Settings.tsx` (Registry tab, ~lines 473-538; state ~line 123; effects ~line 316)
- Test: `tests/e2e/registryCredentials.spec.ts`

**Interfaces:**
- Consumes (Task 3): the four `/api/registry-credentials` endpoints and their response shapes.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing E2E tests**

Create `tests/e2e/registryCredentials.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Destination registry credentials', () => {
  test.afterEach(async ({ request }) => {
    await request.delete('/api/registry-credentials/e2e-mirror.example.com:5000').catch(() => {});
  });

  test('adds, lists without the password, and deletes a credential', async ({ page }) => {
    await page.goto('/settings?tab=registry');
    await expect(page.getByRole('heading', { name: 'Destination Registry Credentials' })).toBeVisible();

    await page.getByLabel('Destination registry host').fill('e2e-mirror.example.com:5000');
    await page.getByLabel('Destination registry username').fill('e2e-user');
    await page.getByLabel('Destination registry password').fill('e2e-S3cret');
    await page.getByRole('button', { name: 'Save credentials' }).click();

    const table = page.getByRole('grid', { name: 'Destination registry credentials' });
    const row = table.getByRole('row', { name: /e2e-mirror\.example\.com:5000/ });
    await expect(row).toContainText('e2e-user');
    await expect(page.getByText('e2e-S3cret')).toHaveCount(0);
    await expect(page.getByLabel('Destination registry password')).toHaveValue('');

    await row.getByRole('button', { name: 'Delete credentials for e2e-mirror.example.com:5000' }).click();
    await expect(table.getByRole('row', { name: /e2e-mirror\.example\.com:5000/ })).toHaveCount(0);
  });

  test('shows a read-only notice when credentials are managed externally', async ({ page }) => {
    await page.route('**/api/registry-credentials', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          managedExternally: true,
          path: '/app/registry-credentials/auth.json',
          credentials: [{ registry: 'ext.example.com', username: 'ext', status: 'not_verified' }],
        }),
      }));
    await page.goto('/settings?tab=registry');
    await expect(page.getByText(/managed outside the application at \/app\/registry-credentials\/auth\.json/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save credentials' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete credentials for ext.example.com' })).toHaveCount(0);
  });

  test('shows a load error instead of an empty table', async ({ page }) => {
    await page.route('**/api/registry-credentials', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ managedExternally: false, path: null, credentials: [], error: 'Destination registry credentials at /x is not valid JSON' }),
      }));
    await page.goto('/settings?tab=registry');
    await expect(page.getByText(/is not valid JSON/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/registryCredentials.spec.ts`
Expected: FAIL (heading not found).

- [ ] **Step 3: Types and state**

After `interface RegistryEntry` add:

```ts
interface DestinationCredential {
  registry: string;
  username: string;
  status?: RegistryEntry['status'];
  error?: string;
}
```

After the `registries` state add:

```ts
  const [destinationCredentials, setDestinationCredentials] = useState<DestinationCredential[]>([]);
  const [credentialsManagedExternally, setCredentialsManagedExternally] = useState(false);
  const [credentialsPath, setCredentialsPath] = useState<string | null>(null);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [newCredential, setNewCredential] = useState({ registry: '', username: '', password: '' });
  const [savingCredential, setSavingCredential] = useState(false);
```

- [ ] **Step 4: Fetch, save, delete, verify**

After `verifyAllRegistries` add:

```ts
  const fetchDestinationCredentials = async () => {
    try {
      const response = await axios.get('/api/registry-credentials');
      setDestinationCredentials(response.data.credentials || []);
      setCredentialsManagedExternally(!!response.data.managedExternally);
      setCredentialsPath(response.data.path || null);
      setCredentialsError(response.data.error || null);
    } catch (error: any) {
      setCredentialsError(error.response?.data?.error || 'Failed to load destination registry credentials');
    }
  };

  const saveDestinationCredential = async () => {
    setSavingCredential(true);
    try {
      await axios.put('/api/registry-credentials', newCredential);
      addSuccessAlert(`Credentials saved for ${newCredential.registry}`);
      setNewCredential({ registry: '', username: '', password: '' });
      await fetchDestinationCredentials();
    } catch (error: any) {
      addDangerAlert(error.response?.data?.error || 'Failed to save credentials');
    } finally {
      setSavingCredential(false);
    }
  };

  const deleteDestinationCredential = async (registry: string) => {
    try {
      await axios.delete(`/api/registry-credentials/${encodeURIComponent(registry)}`);
      addSuccessAlert(`Credentials removed for ${registry}`);
      await fetchDestinationCredentials();
    } catch (error: any) {
      addDangerAlert(error.response?.data?.error || 'Failed to remove credentials');
    }
  };

  const verifyDestinationCredential = async (registry: string) => {
    setDestinationCredentials(prev => prev.map(c =>
      c.registry === registry ? { ...c, status: 'verifying' as const } : c,
    ));
    try {
      const response = await axios.post('/api/registry-credentials/verify', { registry });
      setDestinationCredentials(prev => prev.map(c =>
        c.registry === registry ? { ...c, status: response.data.status, error: response.data.error } : c,
      ));
    } catch {
      setDestinationCredentials(prev => prev.map(c =>
        c.registry === registry ? { ...c, status: 'failed' as const, error: 'Verification request failed' } : c,
      ));
    }
  };
```

Add `fetchDestinationCredentials();` to the mount `useEffect` after `fetchRegistries();`.

- [ ] **Step 5: Section JSX**

The status label markup is already used by the pull secret table. Extract it into a local component above `const Settings` so both tables share it:

```tsx
const RegistryStatusLabel = ({ status, error }: { status?: RegistryEntry['status']; error?: string }) => (
  <>
    {status === 'authenticated' && <Label status="success">Authenticated</Label>}
    {status === 'failed' && (
      <Popover bodyContent={error || 'Authentication failed'} position="left">
        <Label status="danger" style={{ cursor: 'pointer' }}>Failed</Label>
      </Popover>
    )}
    {status === 'verifying' && <Label status="info">Verifying...</Label>}
    {status === 'not_verified' && <Label color="grey">Not verified</Label>}
  </>
);
```

Replace the existing status `<Td>` contents in the pull secret registries table with `<RegistryStatusLabel status={r.status} error={r.error} />`.

In the Registry tab, after the closing `)}` of the `registries.length === 0 ? ... : ...` block and before the closing `</div>`, add:

```tsx
                <Title headingLevel="h3" className="pf-v6-u-mt-xl pf-v6-u-mb-md">Destination Registry Credentials</Title>
                <HelperText className="pf-v6-u-mb-md">
                  <HelperTextItem>
                    Credentials for the registries that mirror-to-mirror and disk-to-mirror push to. They are kept
                    separate from the pull secret and take precedence over it for the same host.
                  </HelperTextItem>
                </HelperText>

                {credentialsError && (
                  <Alert variant="danger" isInline title="Cannot read destination registry credentials" className="pf-v6-u-mb-md">
                    {credentialsError}
                  </Alert>
                )}
                {credentialsManagedExternally && (
                  <Alert variant="info" isInline title="Managed outside the application" className="pf-v6-u-mb-md">
                    Destination registry credentials are managed outside the application at {credentialsPath} and
                    cannot be changed here.
                  </Alert>
                )}

                {destinationCredentials.length > 0 && (
                  <Table aria-label="Destination registry credentials" variant="compact" className="pf-v6-u-mb-md">
                    <Thead>
                      <Tr>
                        <Th>Registry</Th>
                        <Th>Username</Th>
                        <Th>Status</Th>
                        <Th screenReaderText="Actions" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {destinationCredentials.map((c) => (
                        <Tr key={c.registry}>
                          <Td>{c.registry}</Td>
                          <Td>{c.username}</Td>
                          <Td><RegistryStatusLabel status={c.status} error={c.error} /></Td>
                          <Td isActionCell>
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={<SearchIcon />}
                              onClick={() => void verifyDestinationCredential(c.registry)}
                              aria-label={`Verify credentials for ${c.registry}`}
                            >
                              Verify
                            </Button>{' '}
                            {!credentialsManagedExternally && (
                              <Button
                                variant="plain"
                                icon={<TrashAltIcon />}
                                onClick={() => void deleteDestinationCredential(c.registry)}
                                aria-label={`Delete credentials for ${c.registry}`}
                              />
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}

                {!credentialsManagedExternally && (
                  <Flex alignItems={{ default: 'alignItemsFlexEnd' }} spaceItems={{ default: 'spaceItemsMd' }}>
                    <FormGroup label="Registry" fieldId="dest-cred-registry">
                      <TextInput
                        id="dest-cred-registry"
                        aria-label="Destination registry host"
                        placeholder="registry.example.com:5000"
                        value={newCredential.registry}
                        onChange={(_e, v) => setNewCredential(prev => ({ ...prev, registry: v.trim() }))}
                      />
                    </FormGroup>
                    <FormGroup label="Username" fieldId="dest-cred-username">
                      <TextInput
                        id="dest-cred-username"
                        aria-label="Destination registry username"
                        value={newCredential.username}
                        onChange={(_e, v) => setNewCredential(prev => ({ ...prev, username: v }))}
                      />
                    </FormGroup>
                    <FormGroup label="Password or token" fieldId="dest-cred-password">
                      <TextInput
                        id="dest-cred-password"
                        type="password"
                        aria-label="Destination registry password"
                        value={newCredential.password}
                        onChange={(_e, v) => setNewCredential(prev => ({ ...prev, password: v }))}
                      />
                    </FormGroup>
                    <Button
                      variant="primary"
                      icon={<SaveIcon />}
                      onClick={() => void saveDestinationCredential()}
                      isLoading={savingCredential}
                      isDisabled={savingCredential || !newCredential.registry || !newCredential.username || !newCredential.password}
                    >
                      Save credentials
                    </Button>
                  </Flex>
                )}
```

- [ ] **Step 6: Run E2E (new and existing settings specs)**

Run: `npx playwright test tests/e2e/registryCredentials.spec.ts tests/e2e/settings.spec.ts tests/e2e/pullSecret.spec.ts`
Expected: PASS. If PatternFly renders the table with `role="table"` rather than `grid`, adjust only the new test's role.

- [ ] **Step 7: Build, lint, and commit**

```bash
npm run build
npm run lint
git add src/components/Settings.tsx tests/e2e/registryCredentials.spec.ts
git commit -m "feat: manage destination registry credentials in Settings"
```

---

### Task 8: History mode column, details, and CSV

**Files:**
- Modify: `src/components/History.tsx` (types ~51-72; details list ~343-386; CSV ~459-470; table header ~601-605 and row cells)
- Test: `tests/e2e/historyModes.spec.ts`

**Interfaces:**
- Consumes (Task 1): `OPERATION_MODE_LABELS`, `isRegistryTargetMode`, `type OperationMode`. (Task 4): `mode`, `destinationRegistry` on records; `clusterResourcesPath` on details.
- Produces: nothing.

- [ ] **Step 1: Write the failing E2E tests**

Create `tests/e2e/historyModes.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const ops = [
  {
    id: 'm2m-op-0001',
    name: 'Mirror Operation m2m-op-0',
    configFile: 'isc.yaml',
    mode: 'mirrorToMirror',
    destinationRegistry: 'reg.example.com:5000/ocp',
    mirrorDestination: '/app/data/mirrors/ws',
    status: 'success',
    startedAt: '2026-10-01T10:00:00Z',
    completedAt: '2026-10-01T10:05:00Z',
    duration: 300,
  },
  {
    id: 'legacy-op-0001',
    name: 'Mirror Operation legacy-o',
    configFile: 'isc.yaml',
    status: 'success',
    startedAt: '2026-09-01T10:00:00Z',
    completedAt: '2026-09-01T10:05:00Z',
    duration: 300,
  },
];

test.describe('History modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/operations/history', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ops) }));
    await page.route('**/api/operations/m2m-op-0001/details', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'mirrorToMirror',
          destinationRegistry: 'reg.example.com:5000/ocp',
          clusterResourcesPath: '/app/data/mirrors/ws/working-dir/cluster-resources',
          configFile: 'isc.yaml',
        }),
      }));
    await page.goto('/history');
  });

  test('shows the mode for each operation, treating legacy records as mirror to disk', async ({ page }) => {
    await expect(page.getByRole('row', { name: /m2m-op-0/ })).toContainText('Mirror to mirror');
    await expect(page.getByRole('row', { name: /legacy-o/ })).toContainText('Mirror to disk');
  });

  test('details show the destination and cluster resources path', async ({ page }) => {
    await page.getByText('Mirror Operation m2m-op-0').click();
    await expect(page.getByText('reg.example.com:5000/ocp').first()).toBeVisible();
    await expect(page.getByText('/app/data/mirrors/ws/working-dir/cluster-resources')).toBeVisible();
  });

  test('CSV export includes mode and destination columns', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export CSV/i }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');
    const [header, ...rows] = csv.split('\n');
    expect(header).toBe('"Operation Name","Status","Started","Duration","Config File","Error Message","Mode","Destination Registry"');
    expect(rows.find((r) => r.includes('m2m-op-0'))).toMatch(/"Mirror to mirror","reg\.example\.com:5000\/ocp"$/);
    expect(rows.find((r) => r.includes('legacy-o'))).toMatch(/"Mirror to disk",""$/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/historyModes.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Types and import**

Add after the `useAlerts` import:

```ts
import { OPERATION_MODE_LABELS, isRegistryTargetMode, type OperationMode } from '../../server/operationModes';
```

In `interface Operation` add `mode?: OperationMode; destinationRegistry?: string;`. In `interface OperationDetails` add `mode?: OperationMode; destinationRegistry?: string; clusterResourcesPath?: string;`.

- [ ] **Step 4: Table column**

After `<Th>Config</Th>` add `<Th>Mode</Th>`. After the Config `Td` in each row add:

```tsx
                        <Td dataLabel="Mode">
                          <Label isCompact>{OPERATION_MODE_LABELS[op.mode ?? 'mirrorToDisk']}</Label>
                        </Td>
```

If `Label` is not yet imported from `@patternfly/react-core` in `History.tsx`, add it. If the table has an expanded-row `Td` with a `colSpan`, increase it by one.

- [ ] **Step 5: Details entries**

After the "Config File" `DescriptionListGroup`, add:

```tsx
            <DescriptionListGroup>
              <DescriptionListTerm>Mode</DescriptionListTerm>
              <DescriptionListDescription>
                {OPERATION_MODE_LABELS[selectedOperation.mode ?? 'mirrorToDisk']}
              </DescriptionListDescription>
            </DescriptionListGroup>
            {selectedOperation.destinationRegistry && (
              <DescriptionListGroup>
                <DescriptionListTerm>Destination Registry</DescriptionListTerm>
                <DescriptionListDescription>{selectedOperation.destinationRegistry}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {isRegistryTargetMode(selectedOperation.mode ?? 'mirrorToDisk') && operationDetails?.clusterResourcesPath && (
              <DescriptionListGroup>
                <DescriptionListTerm>Cluster Resources</DescriptionListTerm>
                <DescriptionListDescription>{operationDetails.clusterResourcesPath}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
```

- [ ] **Step 6: CSV columns**

Replace the CSV header array and row mapping with (new columns appended at the end so existing consumers keep their column positions):

```ts
      ['Operation Name', 'Status', 'Started', 'Duration', 'Config File', 'Error Message', 'Mode', 'Destination Registry'],
      ...filteredOperations.map(op => [
        op.name,
        op.status,
        new Date(op.startedAt).toLocaleString(),
        formatDuration(op.duration),
        op.configFile,
        op.errorMessage || '',
        OPERATION_MODE_LABELS[op.mode ?? 'mirrorToDisk'],
        op.destinationRegistry || '',
      ]),
```

- [ ] **Step 7: Run E2E (new and existing history specs)**

Run: `npx playwright test tests/e2e/historyModes.spec.ts tests/e2e/history.spec.ts`
Expected: PASS.

- [ ] **Step 8: Build, lint, and commit**

```bash
npm run build
npm run lint
git add src/components/History.tsx tests/e2e/historyModes.spec.ts
git commit -m "feat: show operation mode in history and CSV export"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run every suite**

Run: `npm run lint && npm run build && npm test && npm run test:e2e`
Expected: all pass. Report any skipped suites (for example Helm tests when `helm` is missing) explicitly.

- [ ] **Step 2: Manual smoke test of the real binary (optional, needs a registry)**

With a local registry (`podman run -d -p 5000:5000 registry:2`) and the container running, start a mirror-to-mirror operation with a small ImageSetConfiguration (one additional image), destination `localhost:5000/smoke`, and "Skip TLS verification" checked. Confirm it succeeds and that `working-dir/cluster-resources` exists in the workspace folder. If this step is not run, say so in the hand-off.
