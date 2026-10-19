# Portable UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the five mirror-gui pages into a shared `@mirror-gui/ui` workspace package that reaches the backend, notifications, and routes only through a host adapter, with no visible change to the standalone app.

**Architecture:** The repo root stays the standalone app (Express server, Vite shell, tests, Dockerfile). A new npm workspace `packages/ui` holds the pages, a `MirrorGuiHost` interface with a React context, and a typed API client made of plain functions that take the host as their first argument. A second workspace, `packages/shared`, holds `operationModes.ts`, which the server and the pages both use. The standalone shell supplies an axios-backed host; a later console plugin will supply a `consoleFetch`-backed one.

**Tech Stack:** TypeScript 5.8, React 18, PatternFly 6, react-router-dom 6, axios (standalone shell only), Vite 8, Vitest 5, Playwright, ESLint 9 flat config, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-08-portable-ui-design.md`

## Global Constraints

- All "before" comparisons use the local tag `portable-ui-base`, created in the Prerequisites section, not `main`. This branch can carry commits that are not on `main` (for example dependency upgrades), and a local `main` branch may not exist.
- The only file under `server/` that changes is `server/operationModes.ts`, which becomes a re-export of `@mirror-gui/shared` (Task 0). `git diff --stat portable-ui-base -- server/` must list only that file at the end.
- No existing test file under `tests/` is modified, skipped, or excluded. New test files may be added under `tests/unit/`.
- No new external npm dependencies. The only `package-lock.json` changes allowed relative to `portable-ui-base` are the workspace links for `@mirror-gui/shared` and `@mirror-gui/ui`.
- `packages/ui` must not import `axios`, must not import anything outside its own directory except `@mirror-gui/shared`, and must contain no string literal or template starting with `/api`.
- `react`, `react-dom`, `react-router-dom`, `@patternfly/react-core`, `@patternfly/react-icons`, `@patternfly/react-table` are `peerDependencies` of `packages/ui`.
- `packages/ui` is consumed as TypeScript source (`"exports"` map to `.ts`/`.tsx` files: `.` for everything, `./host` and `./api` for the page-free subsets, `./pages/*` for one page each). No build step, no `dist/`.
- The standalone shell lazy-loads each page from `@mirror-gui/ui/pages/<Page>`, never from the barrel, so Vite keeps one chunk per page as it does today.
- The standalone shell's host code and all unit tests import from `@mirror-gui/ui/host` and `@mirror-gui/ui/api`, never from the `@mirror-gui/ui` barrel: the barrel re-exports the pages, which would pull PatternFly and page code into node-environment unit tests.
- Global CSS imports (`@patternfly/react-core/dist/styles/base.css`, `patternfly-addons.css`, `app.css`) stay in `src/main.tsx`.
- No endpoint, request shape, or response shape changes; `API.md` is not edited.
- No changes to data-fetching patterns: keep every existing `useEffect`, `setInterval`, polling, and `Promise.all` exactly as it is; only the call expression changes.
- Code style (ESLint-enforced): single quotes, semicolons, trailing commas on multiline, `prefer-template`, `eol-last`.
- American English; no em dashes in comments or docs.
- Commits end with the attribution lines configured for this session.

## Review Focus

1. **Error responses without a JSON `error` field** (HTML 502 from a proxy, empty body, plain string): users should see the transport message such as `Request failed with status code 502`, never `undefined` or `[object Object]`. Pinned in Task 1 (`toApiError` tests).
2. **Server unreachable** (container stopped, network drop): pages must still show their existing danger alerts; `ApiError.status` is `0` and the message is axios's `Network Error`. Pinned in Task 1.
3. **Config filenames and operation ids with reserved characters** (spaces, `#`, `?`, `%`, `/`) in download links and delete calls: they must stay encoded exactly once, as today. Pinned in Task 2 (`config` and `operations` tests).
4. **Catalog URLs in query strings** (`registry.redhat.io/redhat/redhat-operator-index:v4.19` contains `/` and `:`): they move from hand-built query strings to `params`, and must arrive at the server decoded to the same value. Pinned in Task 1 (params passed through to axios) and Task 2 (client passes the raw URL, not a pre-encoded one, so it is not double-encoded).
5. **Host identity stability**: if the host object changed on every render, every `useCallback`/`useEffect` that now depends on `api` would re-fire and pages would refetch in a loop. `StandaloneHostProvider` memoizes the host on the `AlertContext` callbacks (already stable via `useCallback`), and `useApi` memoizes on the host. Pinned in Task 1 (`bindApi` returns functions bound to the given host; `useMemo` requirement written into the code) and observable in every page task's E2E run (a refetch loop makes specs time out).

---

## File Structure

```
package.json                              MODIFY: workspaces (Task 0), lint globs, @mirror-gui/* dependencies
tsconfig.json                             MODIFY: include packages/ui/src
eslint.config.js                          MODIFY: lint packages/ui; boundary rule (Task 8)
vitest.config.ts                          MODIFY: coverage include
Dockerfile                                MODIFY: copy workspace manifests before both npm ci runs; copy packages/shared into the runtime stage
packages/shared/package.json              CREATE (Task 0)
packages/shared/src/operationModes.ts     MOVED from server/operationModes.ts (Task 0)
server/operationModes.ts                  REPLACED by a one-line re-export (Task 0)
src/App.tsx                               MODIFY: wrap with StandaloneHostProvider; import pages from @mirror-gui/ui
src/host/standaloneHost.ts                CREATE: createStandaloneHost, toApiError
src/host/StandaloneHostProvider.tsx       CREATE: memoized host from AlertContext
packages/ui/package.json                  CREATE
packages/ui/tsconfig.json                 CREATE
packages/ui/src/index.ts                  CREATE: public exports (host + api + pages)
packages/ui/src/host/index.ts             CREATE: host subpath exports
packages/ui/src/host/types.ts             CREATE: MirrorGuiHost, PageId, RequestOptions, NotifyVariant, HttpMethod
packages/ui/src/host/ApiError.ts          CREATE
packages/ui/src/host/HostContext.ts       CREATE: HostProvider, useHost
packages/ui/src/api/types.ts              CREATE: request/response types
packages/ui/src/api/operations.ts         CREATE
packages/ui/src/api/config.ts             CREATE
packages/ui/src/api/catalogs.ts           CREATE
packages/ui/src/api/system.ts             CREATE
packages/ui/src/api/settings.ts           CREATE
packages/ui/src/api/index.ts              CREATE: api subpath exports, bindApi, useApi, Api type
packages/ui/src/pages/*.tsx               MOVED from src/components/ (Tasks 3-7)
packages/ui/src/components/YamlHighlighter.tsx   MOVED (Task 7)
tests/unit/standaloneHost.test.ts         CREATE
tests/unit/hostContext.test.ts            CREATE
tests/unit/api/fakeHost.ts                CREATE: recording fake host
tests/unit/api/*.test.ts                  CREATE
```

`src/components/ThemeToggle.tsx`, `src/AlertContext.tsx`, `src/ThemeContext.tsx`, `src/main.tsx`, `src/app.css` stay where they are.

## How to run E2E specs locally

Playwright only starts its own server when `CI` is set; otherwise it expects one on port 3000. Always run E2E as:

```bash
CI=1 npx playwright test tests/e2e/<spec>.spec.ts
```

With `CI=1` the server runs from `npx tsx server/index.ts` (Vite dev middleware, so no build needed) on port 3001 with a temporary `STORAGE_DIR`. First time only: `npx playwright install chromium` (browser binaries, not an npm dependency).

## Prerequisites

Do not start Task 0 until all of these hold. If one does not, stop and report.

1. This branch contains the mirror-to-mirror work. Check: `test -f server/operationModes.ts && echo ok` prints `ok`.
2. This branch is rebased onto the newest upstream for that work: `git fetch origin`, then `git rebase origin/main` if `git ls-tree --name-only origin/main server/ | grep operationModes.ts` prints `server/operationModes.ts` (mirror-to-mirror is merged), otherwise `git rebase feature/mirrorToMirror` (stacked until the merge). Resolve nothing by guessing; if the rebase conflicts outside `docs/superpowers/`, stop and report. Commits already contained in the new base (for example dependency upgrades) are skipped, not merged by hand.
3. The baseline is tagged: `git tag -f portable-ui-base HEAD`. Every "before" comparison in this plan uses this tag.
4. Baseline suites pass: `npm ci && npm run lint && npm run build && npm test && npm run server:build`. Record the `server:build` result; Task 0 must not change it.

**Line numbers.** The call-site tables in Tasks 3 to 7 were taken before the mirror-to-mirror merge. Dashboard and MirrorConfig did not change in that merge, so their line numbers still hold. For History, Settings, and MirrorOperations, locate each row by its **Before** text, not its line number. The rows marked *(m2m)* cover call sites the merge added.

---

### Task 0: Shared operation modes package

**Files:**
- Create: `packages/shared/package.json`
- Move: `server/operationModes.ts` to `packages/shared/src/operationModes.ts`
- Create: `server/operationModes.ts` (re-export)
- Modify: `package.json`, `package-lock.json`, `Dockerfile`
- Test: existing `tests/unit/operationModes.test.ts` and the server importers (`server/index.ts`, `server/ocMirrorArgs.ts`, `server/registryCredentials.ts`), all unchanged

**Interfaces:**
- Produces: `@mirror-gui/shared/operationModes`, exporting everything `server/operationModes.ts` exported before (`OperationMode`, `OPERATION_MODES`, `OPERATION_MODE_LABELS`, `isOperationMode`, `isRegistryTargetMode`, `isValidRegistryHost`, `getRegistryHost`, and the rest).

- [ ] **Step 1: Create the package and move the module**

`packages/shared/package.json`:

```json
{
  "name": "@mirror-gui/shared",
  "version": "1.0.0",
  "private": true,
  "description": "Code shared by the mirror-gui server and UI; must not import Node or browser modules",
  "license": "Apache-2.0",
  "type": "module",
  "exports": {
    "./operationModes": "./src/operationModes.ts"
  }
}
```

```bash
mkdir -p packages/shared/src
git mv server/operationModes.ts packages/shared/src/operationModes.ts
```

New `server/operationModes.ts` (keeps every existing `./operationModes.js` and `../../server/operationModes` import working, including `tests/unit/operationModes.test.ts`):

```ts
// Moved to @mirror-gui/shared so the UI package can use it without importing from server/.
export * from '@mirror-gui/shared/operationModes';
```

- [ ] **Step 2: Register the workspace**

In `package.json`:
- Add after `"type": "module",`: `"workspaces": ["packages/*"],`
- Add to `dependencies` (alphabetical position, first entry): `"@mirror-gui/shared": "1.0.0",`

Run: `npm install`
Expected: `git diff package-lock.json` shows only the `packages/shared` and `node_modules/@mirror-gui/shared` entries. `ls -l node_modules/@mirror-gui/shared` is a symlink to `../../packages/shared`. If any other package version changes, stop and report.

- [ ] **Step 3: Make the container include the package**

In `Dockerfile`, both the builder and the production stage have a `COPY package*.json ./` line followed by `npm ci`. Directly after **each** of those two lines add:

```dockerfile
COPY packages/shared/package.json ./packages/shared/package.json
```

In the production stage, directly after `COPY server ./server`, add:

```dockerfile
COPY packages/shared ./packages/shared
```

(The production server runs `npx tsx server/index.ts`, and the re-export resolves `@mirror-gui/shared` through the workspace symlink `npm ci` creates, so the source must be in the image.) If the production stage applies ownership or permission changes to `server/`, apply the same ones to `packages/shared`.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm test && npm run server:build`
Expected: all pass, and `server:build` gives the same result recorded in Prerequisite 4. If `server:build` newly fails with `TS6059` (file not under `rootDir`), stop and report: fixing it needs a change to `server/tsconfig.json`, which this plan does not authorize.

Run: `npx tsx -e "import('./server/operationModes.ts').then(m => console.log(Object.keys(m).sort().join(',')))"`
Expected: the same export names as `git show portable-ui-base:server/operationModes.ts | grep -oE '^export (const|function|type) [A-Za-z_]+' | awk '{print $3}' | sort` (type-only exports do not appear at runtime; compare the value exports).

Run: `CI=1 npx playwright test tests/e2e/operationModes.spec.ts tests/e2e/mirrorToMirror.spec.ts`
Expected: PASS.

Run: `podman build -t localhost/mirror-gui .`
Expected: build succeeds. Then `podman run --rm --entrypoint npx localhost/mirror-gui tsx -e "import('./server/operationModes.ts').then(() => console.log('ok'))"` prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared server/operationModes.ts package.json package-lock.json Dockerfile
git commit -m "refactor: move operation modes to @mirror-gui/shared

The UI package needs the mode labels and registry-host validators but
must not import from server/. server/operationModes.ts re-exports the
moved module, so server code and tests are unchanged."
```

---

### Task 1: Workspace, host adapter, and standalone host

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts`, `packages/ui/src/host/index.ts`, `packages/ui/src/host/types.ts`, `packages/ui/src/host/ApiError.ts`, `packages/ui/src/host/HostContext.ts`
- Create: `src/host/standaloneHost.ts`, `src/host/StandaloneHostProvider.tsx`
- Modify: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `Dockerfile`, `src/App.tsx:33-34,152-159`
- Test: `tests/unit/standaloneHost.test.ts`, `tests/unit/hostContext.test.ts`

**Interfaces:**
- Consumes: `AlertProvider`, `useAlerts` from `src/AlertContext.tsx` (`addAlert(title: string, variant: AlertVariant)`).
- Produces (exported from `@mirror-gui/ui/host` and re-exported from `@mirror-gui/ui`):
  - `type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'`
  - `type NotifyVariant = 'success' | 'danger' | 'warning' | 'info'`
  - `type PageId = 'dashboard' | 'config' | 'operations' | 'history' | 'settings'`
  - `interface RequestOptions { body?: unknown; params?: Record<string, string> }`
  - `interface MirrorGuiHost { request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>; apiUrl(path: string): string; notify(variant: NotifyVariant, title: string): void; pagePath(page: PageId): string }`
  - `class ApiError extends Error { readonly status: number; readonly body: unknown }`
  - `HostProvider({ host, children })`, `useHost(): MirrorGuiHost`
- Produces (standalone shell): `createStandaloneHost(options: { notify: MirrorGuiHost['notify']; http?: AxiosInstance }): MirrorGuiHost`, `toApiError(error: unknown): ApiError`, `StandaloneHostProvider({ children })`.

- [ ] **Step 1: Create the workspace package skeleton**

`packages/ui/package.json`:

```json
{
  "name": "@mirror-gui/ui",
  "version": "1.0.0",
  "private": true,
  "description": "Host-independent mirror-gui pages shared by the standalone app and the OpenShift Console plugin",
  "license": "Apache-2.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./host": "./src/host/index.ts",
    "./api": "./src/api/index.ts",
    "./pages/*": "./src/pages/*.tsx"
  },
  "dependencies": {
    "@mirror-gui/shared": "1.0.0"
  },
  "peerDependencies": {
    "@patternfly/react-core": "^6",
    "@patternfly/react-icons": "^6",
    "@patternfly/react-table": "^6",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.30.6"
  }
}
```

`packages/ui/tsconfig.json` (editor support; the root `tsc -b` compiles these files through the root `tsconfig.json`):

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src"]
}
```

`packages/ui/src/host/types.ts`:

```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type NotifyVariant = 'success' | 'danger' | 'warning' | 'info';

/** Pages the app exposes; each host decides the route each one lives at. */
export type PageId = 'dashboard' | 'config' | 'operations' | 'history' | 'settings';

export interface RequestOptions {
  body?: unknown;
  params?: Record<string, string>;
}

/**
 * Everything a page needs from the environment it runs in.
 * The standalone app and the OpenShift Console plugin each provide one.
 */
export interface MirrorGuiHost {
  /** Request to the mirror-gui backend. `path` is relative to the API root, e.g. '/operations/start'. Rejects with ApiError. */
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  /** Absolute URL for resources the browser loads itself (EventSource, download links). */
  apiUrl(path: string): string;
  notify(variant: NotifyVariant, title: string): void;
  /** Host route for an app page, e.g. '/settings' standalone or '/mirror-gui/settings' in the console. */
  pagePath(page: PageId): string;
}
```

`packages/ui/src/host/ApiError.ts`:

```ts
/** The only error type MirrorGuiHost.request rejects with, whatever the transport. */
export class ApiError extends Error {
  /** HTTP status, or 0 when no response was received. */
  readonly status: number;
  /** Parsed response body, if any. */
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}
```

`packages/ui/src/host/index.ts`:

```ts
export type { HttpMethod, MirrorGuiHost, NotifyVariant, PageId, RequestOptions } from './types';
export { ApiError } from './ApiError';
export { HostProvider, useHost } from './HostContext';
```

`packages/ui/src/index.ts`:

```ts
export * from './host';
```

- [ ] **Step 2: Register the workspace in the root config**

In `package.json` (`"workspaces"` already exists from Task 0):
- Add to `dependencies` (alphabetical position, right after `@mirror-gui/shared`): `"@mirror-gui/ui": "1.0.0",`
- Change the `lint` and `lint:fix` globs to include the package:

```json
"lint": "eslint \"src/**/*.{ts,tsx}\" \"server/**/*.ts\" \"packages/ui/src/**/*.{ts,tsx}\"",
"lint:fix": "eslint \"src/**/*.{ts,tsx}\" \"server/**/*.ts\" \"packages/ui/src/**/*.{ts,tsx}\" --fix",
```

In `tsconfig.json`, change `"include": ["src", "vite-env.d.ts"]` to `"include": ["src", "packages/ui/src", "vite-env.d.ts"]`.

In `eslint.config.js`, change the first block's `files: ['src/**/*.{ts,tsx}']` to `files: ['src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}']`.

In `vitest.config.ts`, change `include: ['server/**/*.ts'],` under `coverage` to:

```ts
      include: ['server/**/*.ts', 'src/host/**/*.ts', 'packages/ui/src/host/**/*.ts', 'packages/ui/src/api/**/*.ts'],
```

In `Dockerfile`, directly after **each** of the two `COPY packages/shared/package.json ./packages/shared/package.json` lines added in Task 0, add:

```dockerfile
COPY packages/ui/package.json ./packages/ui/package.json
```

(npm workspaces need every workspace's `package.json` present for `npm ci`. The builder stage later copies the full `packages/` via `COPY . .`; the runtime stage only needs the manifest because the server never imports the UI.)

Run: `npm install`
Expected: completes; `git diff package-lock.json` shows only the `@mirror-gui/ui` workspace entries (`"packages/ui"`, its `@mirror-gui/shared` dependency, and a `node_modules/@mirror-gui/ui` link). `ls -l node_modules/@mirror-gui/ui` shows a symlink to `../../packages/ui`. If any other package version changes in the lockfile, stop and report.

- [ ] **Step 3: Write the failing tests for the standalone host**

`tests/unit/standaloneHost.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '@mirror-gui/ui/host';
import { createStandaloneHost, toApiError } from '../../src/host/standaloneHost';

type Reply = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

/** Real axios instance with a fake transport, so request building and error creation are axios's own. */
function httpWith(reply: Reply) {
  return axios.create({ baseURL: '/api', adapter: reply });
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown): Promise<AxiosResponse> {
  const response = { data, status, statusText: '', headers: {}, config };
  if (status >= 400) {
    return Promise.reject(new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, null, response));
  }
  return Promise.resolve(response);
}

describe('createStandaloneHost.request', () => {
  it('sends method, /api-prefixed path, params and JSON body, and resolves with the response data unchanged', async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    const http = httpWith(config => {
      seen.push(config);
      return respond(config, 200, { id: 'op-1', status: 'running' });
    });
    const host = createStandaloneHost({ notify: vi.fn(), http });

    const result = await host.request('POST', '/operations/start', {
      body: { configFile: 'a.yaml' },
      params: { catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.19' },
    });

    expect(result).toEqual({ id: 'op-1', status: 'running' });
    expect(seen[0].method).toBe('post');
    expect(seen[0].baseURL).toBe('/api');
    expect(seen[0].url).toBe('/operations/start');
    // Raw value: axios encodes params itself, so the client must not pre-encode.
    expect(seen[0].params).toEqual({ catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.19' });
    expect(JSON.parse(seen[0].data as string)).toEqual({ configFile: 'a.yaml' });
  });

  it('returns non-object bodies verbatim so pages keep their own Array.isArray guards', async () => {
    const http = httpWith(config => respond(config, 200, null));
    const host = createStandaloneHost({ notify: vi.fn(), http });
    await expect(host.request('GET', '/operations/history')).resolves.toBeNull();
  });

  it('sends PUT with a JSON body (destination registry credentials use it)', async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    const http = httpWith(config => {
      seen.push(config);
      return respond(config, 200, { message: 'Registry credentials saved' });
    });
    const host = createStandaloneHost({ notify: vi.fn(), http });

    await host.request('PUT', '/registry-credentials', { body: { registry: 'quay.example.com', username: 'u', password: 'p' } });

    expect(seen[0].method).toBe('put');
    expect(JSON.parse(seen[0].data as string)).toEqual({ registry: 'quay.example.com', username: 'u', password: 'p' });
  });

  it('rejects with ApiError carrying the server error message and status', async () => {
    const http = httpWith(config => respond(config, 404, { error: 'Configuration file not found' }));
    const host = createStandaloneHost({ notify: vi.fn(), http });

    const error = await host.request('POST', '/operations/start').catch(e => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Configuration file not found');
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ error: 'Configuration file not found' });
  });
});

describe('toApiError', () => {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const axiosErrorWith = (status: number, data: unknown) =>
    new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, null,
      { data, status, statusText: '', headers: {}, config });

  it('prefers body.error, then body.message, then the transport message', () => {
    expect(toApiError(axiosErrorWith(500, { error: 'E', message: 'M' })).message).toBe('E');
    expect(toApiError(axiosErrorWith(500, { message: 'M' })).message).toBe('M');
    expect(toApiError(axiosErrorWith(500, {})).message).toBe('Request failed with status code 500');
  });

  it('falls back to the transport message for non-JSON bodies such as a proxy HTML page', () => {
    const error = toApiError(axiosErrorWith(502, '<html>Bad Gateway</html>'));
    expect(error.message).toBe('Request failed with status code 502');
    expect(error.status).toBe(502);
    expect(error.body).toBe('<html>Bad Gateway</html>');
  });

  it('ignores non-string error fields instead of showing [object Object]', () => {
    expect(toApiError(axiosErrorWith(500, { error: { code: 1 } })).message).toBe('Request failed with status code 500');
  });

  it('maps a network failure (no response) to status 0 with the axios message', () => {
    const error = toApiError(new AxiosError('Network Error', 'ERR_NETWORK', config));
    expect(error.status).toBe(0);
    expect(error.message).toBe('Network Error');
    expect(error.body).toBeUndefined();
  });

  it('wraps non-axios errors without losing their message', () => {
    const error = toApiError(new TypeError('boom'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('boom');
    expect(error.status).toBe(0);
  });
});

describe('createStandaloneHost URLs, routes and notifications', () => {
  const notify = vi.fn();
  const host = createStandaloneHost({ notify });

  it('prefixes browser-loaded URLs with /api', () => {
    expect(host.apiUrl('/operations/abc/logstream')).toBe('/api/operations/abc/logstream');
  });

  it('maps pages to the routes the standalone app already uses', () => {
    expect(host.pagePath('dashboard')).toBe('/');
    expect(host.pagePath('config')).toBe('/config');
    expect(host.pagePath('operations')).toBe('/operations');
    expect(host.pagePath('history')).toBe('/history');
    expect(host.pagePath('settings')).toBe('/settings');
  });

  it('forwards notifications to the provided notify function', () => {
    host.notify('danger', 'Failed to load dashboard data');
    expect(notify).toHaveBeenCalledWith('danger', 'Failed to load dashboard data');
  });
});
```

`tests/unit/hostContext.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { HostProvider, useHost, type MirrorGuiHost } from '@mirror-gui/ui/host';

const fakeHost: MirrorGuiHost = {
  request: vi.fn(),
  apiUrl: path => `/base${path}`,
  notify: vi.fn(),
  pagePath: page => `/p/${page}`,
};

function ShowSettingsPath() {
  return createElement('span', null, useHost().pagePath('settings'));
}

describe('HostProvider / useHost', () => {
  it('gives pages the host supplied by the shell', () => {
    const html = renderToString(createElement(HostProvider, { host: fakeHost }, createElement(ShowSettingsPath)));
    expect(html).toContain('/p/settings');
  });

  it('fails loudly when a page renders outside a HostProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderToString(createElement(ShowSettingsPath))).toThrow(/HostProvider/);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/standaloneHost.test.ts tests/unit/hostContext.test.ts`
Expected: FAIL. `standaloneHost.test.ts` fails to resolve `../../src/host/standaloneHost`; `hostContext.test.ts` fails to resolve `./HostContext` from `packages/ui/src/host/index.ts`.

- [ ] **Step 5: Implement HostContext**

`packages/ui/src/host/HostContext.ts` (plain `.ts` with `createElement` so the unit tests do not depend on a JSX transform):

```ts
import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { MirrorGuiHost } from './types';

const HostContext = createContext<MirrorGuiHost | null>(null);

export function HostProvider({ host, children }: { host: MirrorGuiHost; children?: ReactNode }) {
  return createElement(HostContext.Provider, { value: host }, children);
}

export function useHost(): MirrorGuiHost {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error('useHost() must be used inside a HostProvider');
  }
  return host;
}
```

- [ ] **Step 6: Implement the standalone host**

`src/host/standaloneHost.ts`:

```ts
import axios, { type AxiosInstance } from 'axios';
import { ApiError, type HttpMethod, type MirrorGuiHost, type PageId, type RequestOptions } from '@mirror-gui/ui/host';

const API_BASE = '/api';

const PAGE_PATHS: Record<PageId, string> = {
  dashboard: '/',
  config: '/config',
  operations: '/operations',
  history: '/history',
  settings: '/settings',
};

function stringField(body: unknown, field: 'error' | 'message'): string | undefined {
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** Converts anything axios throws into ApiError, preferring the server's own error text. */
export function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data;
    const message = stringField(body, 'error') ?? stringField(body, 'message') ?? error.message;
    return new ApiError(message, error.response?.status ?? 0, body);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError(message, 0, undefined);
}

export function createStandaloneHost(options: {
  notify: MirrorGuiHost['notify'];
  http?: AxiosInstance;
}): MirrorGuiHost {
  const http = options.http ?? axios.create({ baseURL: API_BASE });

  return {
    async request<T>(method: HttpMethod, path: string, requestOptions: RequestOptions = {}) {
      try {
        const response = await http.request<T>({
          method,
          url: path,
          params: requestOptions.params,
          data: requestOptions.body,
        });
        return response.data;
      } catch (error) {
        throw toApiError(error);
      }
    },
    apiUrl: path => `${API_BASE}${path}`,
    notify: options.notify,
    pagePath: page => PAGE_PATHS[page],
  };
}
```

`src/host/StandaloneHostProvider.tsx`:

```tsx
import React, { useMemo } from 'react';
import type { AlertVariant } from '@patternfly/react-core';
import { HostProvider } from '@mirror-gui/ui/host';
import { useAlerts } from '../AlertContext';
import { createStandaloneHost } from './standaloneHost';

/**
 * Supplies the standalone host to the shared pages. Must render inside AlertProvider.
 * The host is memoized: pages use it in useCallback/useEffect dependencies, so a new
 * object on every render would make them refetch in a loop.
 */
export const StandaloneHostProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addAlert } = useAlerts();
  const host = useMemo(
    () => createStandaloneHost({ notify: (variant, title) => addAlert(title, variant as AlertVariant) }),
    [addAlert],
  );
  return <HostProvider host={host}>{children}</HostProvider>;
};
```

(PatternFly's `AlertVariant` enum values are the strings `'success' | 'danger' | 'warning' | 'info' | 'custom'`, so the cast is exact.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/standaloneHost.test.ts tests/unit/hostContext.test.ts`
Expected: PASS, all tests.

- [ ] **Step 8: Wire the provider into the shell**

In `src/App.tsx`, add the import after line 34 (`import { ThemeProvider, useTheme } from './ThemeContext';`):

```ts
import { StandaloneHostProvider } from './host/StandaloneHostProvider';
```

and wrap the content inside `<AlertProvider>` (lines 154-158) so it reads:

```tsx
  <ThemeProvider>
    <AlertProvider>
      <StandaloneHostProvider>
        {/* existing children of AlertProvider, unchanged */}
      </StandaloneHostProvider>
    </AlertProvider>
  </ThemeProvider>
```

Keep whatever is currently between `<AlertProvider>` and `</AlertProvider>` exactly as it is, just indented one level inside `StandaloneHostProvider`.

- [ ] **Step 9: Full verification**

Run: `npm run lint && npm run build && npm test`
Expected: lint reports no errors (pre-existing warnings are acceptable, but no new ones in files this task touched), build succeeds, all Vitest tests pass.

Run: `CI=1 npx playwright test tests/e2e/navigation.spec.ts tests/e2e/dashboard.spec.ts`
Expected: PASS (the shell still renders and alerts still work).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.js vitest.config.ts Dockerfile \
  packages/ui src/host src/App.tsx tests/unit/standaloneHost.test.ts tests/unit/hostContext.test.ts
git commit -m "feat(ui): add @mirror-gui/ui workspace with host adapter and standalone host"
```

---

### Task 2: API client

**Files:**
- Create: `packages/ui/src/api/types.ts`, `operations.ts`, `config.ts`, `catalogs.ts`, `system.ts`, `settings.ts`, `index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `tests/unit/api/fakeHost.ts`, `tests/unit/api/operations.test.ts`, `tests/unit/api/config.test.ts`, `tests/unit/api/catalogs.test.ts`, `tests/unit/api/systemAndSettings.test.ts`, `tests/unit/api/bindApi.test.ts`

**Interfaces:**
- Consumes: `MirrorGuiHost`, `HttpMethod`, `RequestOptions`, `useHost` from Task 1.
- Produces (each function's first parameter is `host: MirrorGuiHost`, omitted below because `useApi()` binds it):
  - operations: `listOperations(): Promise<Operation[]>`, `getOperationHistory(): Promise<Operation[]>`, `getRecentOperations(): Promise<Operation[]>`, `getOperationLogs(id: string): Promise<OperationLogs>`, `getOperationDetails(id: string): Promise<OperationDetails>`, `startOperation(request: StartOperationRequest): Promise<Operation>`, `stopOperation(id: string): Promise<unknown>`, `deleteOperation(id: string): Promise<unknown>`, `operationLogStreamUrl(id: string): string`
  - config: `listConfigs(): Promise<ConfigFile[]>`, `saveConfig(name: string, config: string): Promise<unknown>`, `deleteConfig(filename: string): Promise<unknown>`, `configDownloadUrl(filename: string): string`
  - catalogs: `listCatalogs(): Promise<CatalogInfo[]>`, `listDetailedOperators(catalogUrl: string): Promise<DetailedOperator[]>`, `getOperatorChannels(operatorName: string, catalogUrl: string): Promise<any>`, `getOperatorVersions(operatorName: string, catalogUrl: string, channel: string): Promise<{ versions?: string[] }>`, `getOperatorDependencies(operatorName: string, catalogUrl: string): Promise<{ dependencies?: OperatorDependency[] }>`, `getCatalogSyncStatus(): Promise<CatalogSyncStatus>`, `startCatalogSync(): Promise<unknown>`, `deleteCatalogSyncData(): Promise<{ message: string }>`
  - system: `getStats(): Promise<Stats>`, `getSystemStatus(): Promise<SystemStatus>`, `getSystemInfo(): Promise<SystemInfo>`, `listMirrorFolders(): Promise<{ folders?: string[] }>`, `createMirrorFolder(name: string): Promise<unknown>`, `cleanupCache(): Promise<unknown>`
  - settings: `getPullSecretStatus(): Promise<PullSecretStatus>`, `getPullSecretContent(): Promise<{ content?: string }>`, `savePullSecret(content: string): Promise<unknown>`, `deletePullSecret(): Promise<unknown>`, `listRegistries(): Promise<{ registries?: RegistryEntry[] }>`, `verifyRegistry(registry: string): Promise<{ status: RegistryEntry['status']; error?: string }>`, `listRegistryCredentials(): Promise<RegistryCredentialsList>`, `saveRegistryCredential(credential: NewRegistryCredential): Promise<unknown>`, `deleteRegistryCredential(registry: string): Promise<unknown>`, `verifyRegistryCredential(registry: string): Promise<{ registry: string; status: RegistryEntry['status']; error?: string }>`
  - All of the above exported from `@mirror-gui/ui/api` and re-exported from `@mirror-gui/ui`.
  - `type Api` (all of the above with `host` removed), `bindApi(host: MirrorGuiHost): Api`, `useApi(): Api`
  - Types: `Operation`, `OperationLogs`, `OperationDetails`, `StartOperationRequest`, `OptionalFlagsPayload`, `ConfigFile`, `CatalogInfo`, `DetailedOperator`, `OperatorDependency`, `CatalogSyncStatus`, `CatalogSyncDiffEntry`, `Stats`, `SystemStatus`, `SystemInfo`, `PullSecretStatus`, `RegistryEntry`, `DestinationCredential`, `RegistryCredentialsList`, `NewRegistryCredential`

The registry-credentials routes come from the mirror-to-mirror merge (`app.get/put('/api/registry-credentials'`, `app.delete('/api/registry-credentials/:registry'`, `app.post('/api/registry-credentials/verify'` in `server/index.ts`). As with every route below, if the server disagrees with this plan, the server is right.

- [ ] **Step 1: Write the shared fake host**

`tests/unit/api/fakeHost.ts`:

```ts
import { vi } from 'vitest';
import type { MirrorGuiHost } from '@mirror-gui/ui/host';

/**
 * Records every request so tests can assert the exact route a client function hits.
 * apiUrl uses a non-/api base on purpose: it proves URL helpers go through the host
 * instead of hardcoding the standalone prefix.
 */
export function fakeHost(response: unknown = {}) {
  const request = vi.fn().mockResolvedValue(response);
  const host: MirrorGuiHost = {
    request: request as MirrorGuiHost['request'],
    apiUrl: path => `/proxy/backend/api${path}`,
    notify: vi.fn(),
    pagePath: page => `/${page}`,
  };
  return { host, request };
}
```

- [ ] **Step 2: Write the failing client tests**

These assert the route table against the server routes in `server/index.ts` (for example `app.get('/api/operations/:id/logs'` at line 1892). If any expectation below disagrees with the server, the server is right: fix the expectation and the client.

`tests/unit/api/operations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  listOperations, getOperationHistory, getRecentOperations, getOperationLogs, getOperationDetails,
  startOperation, stopOperation, deleteOperation, operationLogStreamUrl,
} from '@mirror-gui/ui/api';
import type { MirrorGuiHost } from '@mirror-gui/ui/host';
import { fakeHost } from './fakeHost';

type Call = (host: MirrorGuiHost) => Promise<unknown>;

describe('operations client routes', () => {
  it.each<[string, Call, string, string]>([
    ['listOperations', h => listOperations(h), 'GET', '/operations'],
    ['getOperationHistory', h => getOperationHistory(h), 'GET', '/operations/history'],
    ['getRecentOperations', h => getRecentOperations(h), 'GET', '/operations/recent'],
    ['getOperationLogs', h => getOperationLogs(h, 'op-1'), 'GET', '/operations/op-1/logs'],
    ['getOperationDetails', h => getOperationDetails(h, 'op-1'), 'GET', '/operations/op-1/details'],
    ['stopOperation', h => stopOperation(h, 'op-1'), 'POST', '/operations/op-1/stop'],
    ['deleteOperation', h => deleteOperation(h, 'op-1'), 'DELETE', '/operations/op-1'],
  ])('%s hits %s %s', async (_name, call, method, path) => {
    const { host, request } = fakeHost();
    await call(host);
    expect(request).toHaveBeenCalledWith(method, path, undefined);
  });

  it('startOperation posts the request body unchanged, including mode and destination', async () => {
    const { host, request } = fakeHost({ id: 'op-1', status: 'running' });
    const body = {
      configFile: 'a.yaml',
      mode: 'mirrorToMirror' as const,
      destinationRegistry: 'quay.example.com:5000/mirror',
      skipDestTlsVerify: true,
      optionalFlags: { retryTimes: 3 },
    };
    const result = await startOperation(host, body);
    expect(request).toHaveBeenCalledWith('POST', '/operations/start', { body });
    expect(result).toEqual({ id: 'op-1', status: 'running' });
  });

  it('encodes operation ids exactly once in paths and stream URLs', async () => {
    const { host, request } = fakeHost();
    await deleteOperation(host, 'a b/c#d');
    expect(request).toHaveBeenCalledWith('DELETE', '/operations/a%20b%2Fc%23d', undefined);
    expect(operationLogStreamUrl(host, 'a b')).toBe('/proxy/backend/api/operations/a%20b/logstream');
  });

  it('returns the server payload unchanged', async () => {
    const { host } = fakeHost({ logs: 'line1\nline2' });
    await expect(getOperationLogs(host, 'op-1')).resolves.toEqual({ logs: 'line1\nline2' });
  });
});
```

`tests/unit/api/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listConfigs, saveConfig, deleteConfig, configDownloadUrl } from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

describe('config client', () => {
  it('lists configurations', async () => {
    const { host, request } = fakeHost([]);
    await listConfigs(host);
    expect(request).toHaveBeenCalledWith('GET', '/config/list', undefined);
  });

  it('saves with the same body shape the server reads ({ config, name })', async () => {
    const { host, request } = fakeHost();
    await saveConfig(host, 'my-config.yaml', 'kind: ImageSetConfiguration');
    expect(request).toHaveBeenCalledWith('POST', '/config/save', {
      body: { config: 'kind: ImageSetConfiguration', name: 'my-config.yaml' },
    });
  });

  it('encodes filenames with reserved characters exactly once', async () => {
    const { host, request } = fakeHost();
    await deleteConfig(host, 'my config #1?.yaml');
    expect(request).toHaveBeenCalledWith('DELETE', '/config/delete/my%20config%20%231%3F.yaml', undefined);
    expect(configDownloadUrl(host, '100%.yaml')).toBe('/proxy/backend/api/config/download/100%25.yaml');
  });
});
```

`tests/unit/api/catalogs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  listCatalogs, listDetailedOperators, getOperatorChannels, getOperatorVersions, getOperatorDependencies,
  getCatalogSyncStatus, startCatalogSync, deleteCatalogSyncData,
} from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

const CATALOG = 'registry.redhat.io/redhat/redhat-operator-index:v4.19';

describe('catalogs client', () => {
  it('lists catalogs and reads sync status', async () => {
    const { host, request } = fakeHost();
    await listCatalogs(host);
    await getCatalogSyncStatus(host);
    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/catalogs', undefined);
    expect(request).toHaveBeenNthCalledWith(2, 'GET', '/catalogs/sync/status', undefined);
  });

  it('starts a sync and clears synced data', async () => {
    const { host, request } = fakeHost({ message: 'cleared' });
    await startCatalogSync(host);
    await expect(deleteCatalogSyncData(host)).resolves.toEqual({ message: 'cleared' });
    expect(request).toHaveBeenNthCalledWith(1, 'POST', '/catalogs/sync', undefined);
    expect(request).toHaveBeenNthCalledWith(2, 'DELETE', '/catalogs/sync/data', undefined);
  });

  // Catalog URLs contain '/' and ':'. They go in params as raw values; the host's
  // HTTP layer encodes them. Pre-encoding here would double-encode.
  it('passes catalog URLs as raw query params', async () => {
    const { host, request } = fakeHost([]);
    await listDetailedOperators(host, CATALOG);
    await getOperatorChannels(host, 'web-terminal', CATALOG);
    await getOperatorVersions(host, 'web-terminal', CATALOG, 'fast');
    await getOperatorDependencies(host, 'web-terminal', CATALOG);
    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/operators', { params: { catalog: CATALOG, detailed: 'true' } });
    expect(request).toHaveBeenNthCalledWith(2, 'GET', '/operator-channels/web-terminal', { params: { catalogUrl: CATALOG } });
    expect(request).toHaveBeenNthCalledWith(3, 'GET', '/operators/web-terminal/versions', { params: { catalog: CATALOG, channel: 'fast' } });
    expect(request).toHaveBeenNthCalledWith(4, 'GET', '/operators/web-terminal/dependencies', { params: { catalogUrl: CATALOG } });
  });

  it('encodes operator names in path segments (no-op for valid package names)', async () => {
    const { host, request } = fakeHost();
    await getOperatorVersions(host, 'odf-operator', CATALOG, 'stable');
    await getOperatorVersions(host, 'bad/name', CATALOG, 'stable');
    expect(request.mock.calls[0][1]).toBe('/operators/odf-operator/versions');
    expect(request.mock.calls[1][1]).toBe('/operators/bad%2Fname/versions');
  });
});
```

`tests/unit/api/systemAndSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  getStats, getSystemStatus, getSystemInfo, listMirrorFolders, createMirrorFolder, cleanupCache,
  getPullSecretStatus, getPullSecretContent, savePullSecret, deletePullSecret, listRegistries, verifyRegistry,
  listRegistryCredentials, saveRegistryCredential, deleteRegistryCredential, verifyRegistryCredential,
} from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

describe('system and settings client', () => {
  it.each([
    ['getStats', getStats, 'GET', '/stats'],
    ['getSystemStatus', getSystemStatus, 'GET', '/system/status'],
    ['getSystemInfo', getSystemInfo, 'GET', '/system/info'],
    ['listMirrorFolders', listMirrorFolders, 'GET', '/mirror-folders'],
    ['cleanupCache', cleanupCache, 'POST', '/cache/cleanup'],
    ['getPullSecretStatus', getPullSecretStatus, 'GET', '/pull-secret/status'],
    ['getPullSecretContent', getPullSecretContent, 'GET', '/pull-secret/content'],
    ['deletePullSecret', deletePullSecret, 'DELETE', '/pull-secret'],
    ['listRegistries', listRegistries, 'GET', '/registries'],
    ['listRegistryCredentials', listRegistryCredentials, 'GET', '/registry-credentials'],
  ] as const)('%s hits %s %s', async (_name, fn, method, path) => {
    const { host, request } = fakeHost();
    await fn(host);
    expect(request).toHaveBeenCalledWith(method, path, undefined);
  });

  it('sends the bodies the server reads', async () => {
    const { host, request } = fakeHost();
    await createMirrorFolder(host, 'run-2026');
    await savePullSecret(host, '{"auths":{}}');
    await verifyRegistry(host, 'registry.redhat.io');
    expect(request).toHaveBeenNthCalledWith(1, 'POST', '/mirror-folders', { body: { name: 'run-2026' } });
    expect(request).toHaveBeenNthCalledWith(2, 'POST', '/pull-secret', { body: { content: '{"auths":{}}' } });
    expect(request).toHaveBeenNthCalledWith(3, 'POST', '/registries/verify', { body: { registry: 'registry.redhat.io' } });
  });

  it('manages destination registry credentials with the routes and bodies the server reads', async () => {
    const { host, request } = fakeHost();
    const credential = { registry: 'quay.example.com:5000', username: 'mirror', password: 's3cret' };
    await saveRegistryCredential(host, credential);
    await verifyRegistryCredential(host, 'quay.example.com:5000');
    await deleteRegistryCredential(host, 'quay.example.com:5000');
    expect(request).toHaveBeenNthCalledWith(1, 'PUT', '/registry-credentials', { body: credential });
    expect(request).toHaveBeenNthCalledWith(2, 'POST', '/registry-credentials/verify', { body: { registry: 'quay.example.com:5000' } });
    // The registry is a path segment: ':' must be encoded exactly once, as the page does today.
    expect(request).toHaveBeenNthCalledWith(3, 'DELETE', '/registry-credentials/quay.example.com%3A5000', undefined);
  });
});
```

`tests/unit/api/bindApi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bindApi } from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

describe('bindApi', () => {
  it('binds every client function to the given host', async () => {
    const { host, request } = fakeHost();
    const api = bindApi(host);
    await api.deleteConfig('a b.yaml');
    expect(request).toHaveBeenCalledWith('DELETE', '/config/delete/a%20b.yaml', undefined);
    expect(api.operationLogStreamUrl('x')).toBe('/proxy/backend/api/operations/x/logstream');
  });

  it('exposes exactly the client functions, so pages cannot reach host.request through it', () => {
    const api = bindApi(fakeHost().host);
    expect(Object.keys(api).sort()).toEqual([
      'cleanupCache', 'configDownloadUrl', 'createMirrorFolder', 'deleteCatalogSyncData', 'deleteConfig',
      'deleteOperation', 'deletePullSecret', 'deleteRegistryCredential', 'getCatalogSyncStatus',
      'getOperationDetails', 'getOperationHistory', 'getOperationLogs', 'getOperatorChannels',
      'getOperatorDependencies', 'getOperatorVersions', 'getPullSecretContent', 'getPullSecretStatus',
      'getRecentOperations', 'getStats', 'getSystemInfo', 'getSystemStatus', 'listCatalogs', 'listConfigs',
      'listDetailedOperators', 'listMirrorFolders', 'listOperations', 'listRegistries', 'listRegistryCredentials',
      'operationLogStreamUrl', 'saveConfig', 'savePullSecret', 'saveRegistryCredential', 'startCatalogSync',
      'startOperation', 'stopOperation', 'verifyRegistry', 'verifyRegistryCredential',
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/api`
Expected: FAIL; `@mirror-gui/ui/api` cannot be resolved (`packages/ui/src/api/index.ts` does not exist yet).

- [ ] **Step 4: Write the API types**

`packages/ui/src/api/types.ts`. Shapes follow the server (`server/index.ts`: `OperationRecord` line 31, `SystemInfo` line 155, `/api/system/status` line 929, `/api/pull-secret/status` line 943) and the interfaces currently declared in the pages:

```ts
/** API payload types. Shapes mirror what server/index.ts returns. */

import type { OperationMode } from '@mirror-gui/shared/operationModes';

export type OperationStatus = 'running' | 'success' | 'failed' | 'stopped';

export interface Operation {
  id: string;
  name: string;
  configFile: string;
  /** Absent on records created before modes existed; read as 'mirrorToDisk'. */
  mode?: OperationMode;
  destinationRegistry?: string;
  status: OperationStatus;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  mirrorDestination?: string;
  errorMessage?: string | null;
}

export interface OperationLogs {
  logs?: string;
}

export interface OperationDetails {
  imagesMirrored?: number;
  operatorsMirrored?: number;
  totalSize?: number;
  platformImages?: number;
  additionalImages?: number;
  helmCharts?: number;
  configFile?: string;
  status?: string;
}

export interface OptionalFlagsPayload {
  removeSignatures?: boolean;
  imageTimeout?: string;
  retryDelay?: string;
  retryTimes?: number;
}

export interface StartOperationRequest {
  configFile: string;
  mode?: OperationMode;
  mirrorDestinationSubdir?: string;
  destinationRegistry?: string;
  skipDestTlsVerify?: boolean;
  optionalFlags?: OptionalFlagsPayload;
}

export interface ConfigFile {
  name: string;
  size: string;
}

export interface CatalogInfo {
  name: string;
  url: string;
  description: string;
  digest?: string | null;
  syncedAt?: string | null;
}

export interface DetailedOperator {
  name: string;
  defaultChannel: string;
  allChannels: string[];
}

export interface OperatorDependency {
  packageName: string;
  defaultChannel?: string;
}

export interface CatalogSyncDiffEntry {
  catalog: string;
  newOperators: string[];
  removedOperators: string[];
  updatedOperators: { name: string; addedVersions: string[] }[];
}

export interface CatalogSyncStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  lastSyncTime: string | null;
  syncStartTime: string | null;
  successCount: number;
  failedCount: number;
  totalCount: number;
  completedCatalogs: number;
  currentCatalog: string | null;
  error: string | null;
  logs: string[];
  diff: CatalogSyncDiffEntry[];
  /** True when runtime synced catalog data exists (same probe as clear sync). */
  hasRuntimeSyncData?: boolean;
}

export interface Stats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  runningOperations: number;
}

export interface SystemStatus {
  ocMirrorVersion: string;
  systemHealth: string;
  pullSecretDetected: boolean;
}

export interface SystemInfo {
  ocMirrorVersion: string;
  systemArchitecture: string;
  availableDiskSpace: number;
  totalDiskSpace: number;
  hostDataDir: string;
  cacheDir: string;
  hostCacheDir: string;
  cacheSizeBytes: number;
}

export interface PullSecretStatus {
  detected: boolean;
  path: string | null;
}

export interface RegistryEntry {
  registry: string;
  username: string;
  hasAuth: boolean;
  status?: 'authenticated' | 'failed' | 'verifying' | 'not_verified';
  error?: string;
}

export interface DestinationCredential {
  registry: string;
  username: string;
  status?: RegistryEntry['status'];
  error?: string;
}

export interface RegistryCredentialsList {
  /** True when the credentials file is mounted from a Secret and cannot be edited in the UI. */
  managedExternally: boolean;
  path: string | null;
  credentials: DestinationCredential[];
  error?: string;
}

export interface NewRegistryCredential {
  registry: string;
  username: string;
  password: string;
}
```

Before moving on, check `StartOperationRequest`, `DestinationCredential`, and `RegistryCredentialsList` against the merged `server/index.ts` (`/api/operations/start` and `/api/registry-credentials` handlers) and the merged Settings page's local `DestinationCredential` interface. Then check the `DetailedOperator`, `OperatorDependency` and `CatalogInfo` shapes against what the server's `/api/operators?detailed=true`, `/api/operators/:operator/dependencies`, and `/api/catalogs` handlers return (`server/index.ts` lines 1266-1358 and 1511-1565). If a field the pages read is named differently, follow the server.

- [ ] **Step 5: Write the client modules**

`packages/ui/src/api/operations.ts`:

```ts
import type { MirrorGuiHost } from '../host/types';
import type { Operation, OperationDetails, OperationLogs, StartOperationRequest } from './types';

const operationPath = (id: string) => `/operations/${encodeURIComponent(id)}`;

export const listOperations = (host: MirrorGuiHost) =>
  host.request<Operation[]>('GET', '/operations', undefined);

export const getOperationHistory = (host: MirrorGuiHost) =>
  host.request<Operation[]>('GET', '/operations/history', undefined);

export const getRecentOperations = (host: MirrorGuiHost) =>
  host.request<Operation[]>('GET', '/operations/recent', undefined);

export const getOperationLogs = (host: MirrorGuiHost, id: string) =>
  host.request<OperationLogs>('GET', `${operationPath(id)}/logs`, undefined);

export const getOperationDetails = (host: MirrorGuiHost, id: string) =>
  host.request<OperationDetails>('GET', `${operationPath(id)}/details`, undefined);

export const startOperation = (host: MirrorGuiHost, request: StartOperationRequest) =>
  host.request<Operation>('POST', '/operations/start', { body: request });

export const stopOperation = (host: MirrorGuiHost, id: string) =>
  host.request<unknown>('POST', `${operationPath(id)}/stop`, undefined);

export const deleteOperation = (host: MirrorGuiHost, id: string) =>
  host.request<unknown>('DELETE', operationPath(id), undefined);

/** URL for the server-sent events log stream of a running operation. */
export const operationLogStreamUrl = (host: MirrorGuiHost, id: string) =>
  host.apiUrl(`${operationPath(id)}/logstream`);
```

`packages/ui/src/api/config.ts`:

```ts
import type { MirrorGuiHost } from '../host/types';
import type { ConfigFile } from './types';

export const listConfigs = (host: MirrorGuiHost) =>
  host.request<ConfigFile[]>('GET', '/config/list', undefined);

export const saveConfig = (host: MirrorGuiHost, name: string, config: string) =>
  host.request<unknown>('POST', '/config/save', { body: { config, name } });

export const deleteConfig = (host: MirrorGuiHost, filename: string) =>
  host.request<unknown>('DELETE', `/config/delete/${encodeURIComponent(filename)}`, undefined);

/** URL for a native <a download> link to a saved configuration. */
export const configDownloadUrl = (host: MirrorGuiHost, filename: string) =>
  host.apiUrl(`/config/download/${encodeURIComponent(filename)}`);
```

`packages/ui/src/api/catalogs.ts`:

```ts
import type { MirrorGuiHost } from '../host/types';
import type { CatalogInfo, CatalogSyncStatus, DetailedOperator, OperatorDependency } from './types';

const operatorPath = (name: string) => `/operators/${encodeURIComponent(name)}`;

export const listCatalogs = (host: MirrorGuiHost) =>
  host.request<CatalogInfo[]>('GET', '/catalogs', undefined);

export const listDetailedOperators = (host: MirrorGuiHost, catalogUrl: string) =>
  host.request<DetailedOperator[]>('GET', '/operators', { params: { catalog: catalogUrl, detailed: 'true' } });

/**
 * The server has returned both a bare channel array and an object with `channels`
 * and `allChannels`; MirrorConfig normalizes either shape, so the result stays untyped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getOperatorChannels = (host: MirrorGuiHost, operatorName: string, catalogUrl: string) =>
  host.request<any>('GET', `/operator-channels/${encodeURIComponent(operatorName)}`, { params: { catalogUrl } });

export const getOperatorVersions = (host: MirrorGuiHost, operatorName: string, catalogUrl: string, channel: string) =>
  host.request<{ versions?: string[] }>('GET', `${operatorPath(operatorName)}/versions`, {
    params: { catalog: catalogUrl, channel },
  });

export const getOperatorDependencies = (host: MirrorGuiHost, operatorName: string, catalogUrl: string) =>
  host.request<{ dependencies?: OperatorDependency[] }>('GET', `${operatorPath(operatorName)}/dependencies`, {
    params: { catalogUrl },
  });

export const getCatalogSyncStatus = (host: MirrorGuiHost) =>
  host.request<CatalogSyncStatus>('GET', '/catalogs/sync/status', undefined);

export const startCatalogSync = (host: MirrorGuiHost) =>
  host.request<unknown>('POST', '/catalogs/sync', undefined);

export const deleteCatalogSyncData = (host: MirrorGuiHost) =>
  host.request<{ message: string }>('DELETE', '/catalogs/sync/data', undefined);
```

(`no-explicit-any` is off for these globs, so the disable comment is only documentation of intent; drop it if ESLint reports it as unused.)

`packages/ui/src/api/system.ts`:

```ts
import type { MirrorGuiHost } from '../host/types';
import type { Stats, SystemInfo, SystemStatus } from './types';

export const getStats = (host: MirrorGuiHost) =>
  host.request<Stats>('GET', '/stats', undefined);

export const getSystemStatus = (host: MirrorGuiHost) =>
  host.request<SystemStatus>('GET', '/system/status', undefined);

export const getSystemInfo = (host: MirrorGuiHost) =>
  host.request<SystemInfo>('GET', '/system/info', undefined);

export const listMirrorFolders = (host: MirrorGuiHost) =>
  host.request<{ folders?: string[] }>('GET', '/mirror-folders', undefined);

export const createMirrorFolder = (host: MirrorGuiHost, name: string) =>
  host.request<unknown>('POST', '/mirror-folders', { body: { name } });

export const cleanupCache = (host: MirrorGuiHost) =>
  host.request<unknown>('POST', '/cache/cleanup', undefined);
```

`packages/ui/src/api/settings.ts`:

```ts
import type { MirrorGuiHost } from '../host/types';
import type { NewRegistryCredential, PullSecretStatus, RegistryCredentialsList, RegistryEntry } from './types';

export const getPullSecretStatus = (host: MirrorGuiHost) =>
  host.request<PullSecretStatus>('GET', '/pull-secret/status', undefined);

export const getPullSecretContent = (host: MirrorGuiHost) =>
  host.request<{ content?: string }>('GET', '/pull-secret/content', undefined);

export const savePullSecret = (host: MirrorGuiHost, content: string) =>
  host.request<unknown>('POST', '/pull-secret', { body: { content } });

export const deletePullSecret = (host: MirrorGuiHost) =>
  host.request<unknown>('DELETE', '/pull-secret', undefined);

export const listRegistries = (host: MirrorGuiHost) =>
  host.request<{ registries?: RegistryEntry[] }>('GET', '/registries', undefined);

export const verifyRegistry = (host: MirrorGuiHost, registry: string) =>
  host.request<{ status: RegistryEntry['status']; error?: string }>('POST', '/registries/verify', { body: { registry } });

/** Credentials oc-mirror uses to push to a destination registry (mirror-to-mirror, disk-to-mirror). */
export const listRegistryCredentials = (host: MirrorGuiHost) =>
  host.request<RegistryCredentialsList>('GET', '/registry-credentials', undefined);

export const saveRegistryCredential = (host: MirrorGuiHost, credential: NewRegistryCredential) =>
  host.request<unknown>('PUT', '/registry-credentials', { body: credential });

export const deleteRegistryCredential = (host: MirrorGuiHost, registry: string) =>
  host.request<unknown>('DELETE', `/registry-credentials/${encodeURIComponent(registry)}`, undefined);

export const verifyRegistryCredential = (host: MirrorGuiHost, registry: string) =>
  host.request<{ registry: string; status: RegistryEntry['status']; error?: string }>(
    'POST', '/registry-credentials/verify', { body: { registry } });
```

`packages/ui/src/api/index.ts`:

```ts
import { useMemo } from 'react';
import { useHost } from '../host/HostContext';
import type { MirrorGuiHost } from '../host/types';
import * as catalogs from './catalogs';
import * as config from './config';
import * as operations from './operations';
import * as settings from './settings';
import * as system from './system';

const endpoints = { ...operations, ...config, ...catalogs, ...system, ...settings };

type Endpoints = typeof endpoints;

type BoundToHost<F> = F extends (host: MirrorGuiHost, ...args: infer A) => infer R ? (...args: A) => R : never;

/** The client with the host argument already supplied. */
export type Api = { [K in keyof Endpoints]: BoundToHost<Endpoints[K]> };

export function bindApi(host: MirrorGuiHost): Api {
  const bound = Object.entries(endpoints).map(([name, fn]) => [
    name,
    (...args: unknown[]) => (fn as (h: MirrorGuiHost, ...rest: unknown[]) => unknown)(host, ...args),
  ]);
  return Object.fromEntries(bound) as Api;
}

/** The API client for the current host. Stable as long as the host object is stable. */
export function useApi(): Api {
  const host = useHost();
  return useMemo(() => bindApi(host), [host]);
}

export * from './types';
export * from './operations';
export * from './config';
export * from './catalogs';
export * from './system';
export * from './settings';
```

Append to `packages/ui/src/index.ts`:

```ts
export * from './api';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/api`
Expected: PASS, all tests.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm run build && npm test`
Expected: no lint errors, build succeeds, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src tests/unit/api
git commit -m "feat(ui): add typed API client bound to the host adapter"
```

---

## Page migration rules (apply in Tasks 3-7)

Every page task follows the same mechanical recipe. The tables in each task list every call site with its exact replacement.

1. `git mv src/components/<Page>.tsx packages/ui/src/pages/<Page>.tsx`
2. Remove `import axios from 'axios';` and `import { useAlerts } from '../AlertContext';`.
3. Add `import { useApi } from '../api';` and `import { useHost } from '../host';` (add `ApiError` to the `'../host'` import where rule 6 applies). Import payload types from `'../api/types'` and delete the page's local duplicates listed in the task.
4. Replace `const { addXAlert, ... } = useAlerts();` with:
   ```ts
   const api = useApi();
   const host = useHost();
   ```
   and each `addSuccessAlert(x)` / `addDangerAlert(x)` / `addWarningAlert(x)` / `addInfoAlert(x)` with `host.notify('success' | 'danger' | 'warning' | 'info', x)`.
5. Each `const response = await axios.get(...)` becomes `const data = await api.fn(...)`, and the following `response.data` becomes `data`. Keep surrounding logic (guards like `Array.isArray`, `|| ''`, `?? []`) byte-for-byte.
6. Error messages: `error.response?.data?.error`, `err.response?.data?.message`, and `err.response?.data?.error || err.response?.data?.message || err.message` all become `(error as ApiError).message` (import `ApiError` from `'../host'`). `ApiError.message` is already `body.error ?? body.message ?? transport message` and is never empty. Where the original had a literal fallback (`error.response?.data?.error || 'Failed to start catalog sync'`), drop the literal: it can no longer be reached, so keeping it would be dead code. This is an accepted, user-visible change (the spec records it): when a response has no `error` field, the user sees the transport message (for example `Request failed with status code 500`) instead of the literal. List every dropped literal in the task's commit message.
7. Dependency arrays: wherever an alert function (`addDangerAlert`, etc.) appears in a `useCallback`/`useEffect` dependency list, replace it with `host`; wherever a callback now calls `api.*`, add `api` to its dependency list if the list is non-empty. Do not add dependencies to lists that are `[]` with an `eslint-disable-next-line react-hooks/exhaustive-deps` comment; leave those as they are.
8. In `src/App.tsx`, change the page's `lazy(() => import('./components/<Page>'))` to `lazy(() => import('@mirror-gui/ui/pages/<Page>'))`. Importing from the page subpath, not the `@mirror-gui/ui` barrel, keeps Vite's one-chunk-per-page split. Also add `export { default as <Page> } from './pages/<Page>';` to `packages/ui/src/index.ts`; the console plugin will use the barrel.
9. Imports of `'../../server/operationModes'` (added by the mirror-to-mirror merge) become `'@mirror-gui/shared/operationModes'`, with the same imported names.
10. Verify with `npm run lint && npm run build && npm test` and the task's E2E specs. Search the moved file: `grep -n "axios\|/api\|useAlerts\|server/" packages/ui/src/pages/<Page>.tsx` must print nothing. Check the split: `ls dist/assets | grep -c '^<Page>-.*\.js$'` prints `1`.

---

### Task 3: Migrate Dashboard

**Files:**
- Move: `src/components/Dashboard.tsx` to `packages/ui/src/pages/Dashboard.tsx`
- Modify: `src/App.tsx:39`, `packages/ui/src/index.ts`
- Test: existing `tests/e2e/dashboard.spec.ts`, `tests/e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `useApi` (`getStats`, `getRecentOperations`, `getSystemStatus`, `getSystemInfo`), `useHost` (`notify`, `pagePath`), types `Stats`, `Operation`, `SystemStatus`, `SystemInfo`.
- Produces: `Dashboard` default export re-exported from `@mirror-gui/ui` as `Dashboard`.

- [ ] **Step 1: Baseline the E2E specs before touching the page**

Run: `CI=1 npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/navigation.spec.ts`
Expected: PASS. If anything fails here, stop and report; the failure predates this task.

- [ ] **Step 2: Move and rewire the page**

Apply the page migration rules. Delete local interfaces `Stats`, `Operation`, `SystemStatus`, `SystemInfo` (lines 38-66) and import them from `'../api/types'`. Keep `LabelStatus`.

| Line | Before | After |
|---|---|---|
| 144 | `const { addDangerAlert } = useAlerts();` | `const api = useApi();` and `const host = useHost();` |
| 179-182 | `axios.get('/api/stats'), axios.get('/api/operations/recent'), axios.get('/api/system/status'), axios.get('/api/system/info'),` | `api.getStats(), api.getRecentOperations(), api.getSystemStatus(), api.getSystemInfo(),` |
| 183-187 | `const [statsRes, operationsRes, statusRes, infoRes] = ...; setStats(statsRes.data); ...` | `const [stats, recentOperations, status, info] = ...; setStats(stats); setRecentOperations(recentOperations); setSystemStatus(status); setSystemInfo(info);` (rename locals if they shadow state variables, e.g. `statsData`) |
| 190 | `addDangerAlert('Failed to load dashboard data');` | `host.notify('danger', 'Failed to load dashboard data');` |
| 227 | `navigate('/settings?tab=pull-secret')` | ``navigate(`${host.pagePath('settings')}?tab=pull-secret`)`` |

If TypeScript reports a mismatch because Dashboard's old `Operation.duration` was `number | null` and the shared type is `duration?: number`, adjust only the local display expression (for example `op.duration ?? null`), not the shared type.

- [ ] **Step 3: Point the shell at the package**

`src/App.tsx` line 39 becomes:

```ts
const Dashboard = lazy(() => import('@mirror-gui/ui/pages/Dashboard'));
```

Append to `packages/ui/src/index.ts`:

```ts
export { default as Dashboard } from './pages/Dashboard';
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm test`
Expected: no lint errors, build succeeds, tests pass.

Run: `grep -n "axios\|/api\|useAlerts" packages/ui/src/pages/Dashboard.tsx`
Expected: no output.

Run: `CI=1 npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/navigation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/Dashboard.tsx packages/ui src/App.tsx
git commit -m "refactor(ui): move Dashboard to @mirror-gui/ui"
```

---

### Task 4: Migrate History

**Files:**
- Move: `src/components/History.tsx` to `packages/ui/src/pages/History.tsx`
- Modify: `src/App.tsx` (History lazy import), `packages/ui/src/index.ts`
- Test: existing `tests/e2e/history.spec.ts`, `tests/e2e/historyModes.spec.ts`

**Interfaces:**
- Consumes: `useApi` (`getOperationHistory`, `getOperationLogs`, `operationLogStreamUrl`, `getOperationDetails`, `deleteOperation`, `configDownloadUrl`), `useHost` (`notify`), types `Operation`, `OperationDetails`; `OPERATION_MODE_LABELS`, `isRegistryTargetMode`, `OperationMode` from `@mirror-gui/shared/operationModes`.
- Produces: `History` export from `@mirror-gui/ui`.

- [ ] **Step 1: Baseline**

Run: `CI=1 npx playwright test tests/e2e/history.spec.ts tests/e2e/historyModes.spec.ts`
Expected: PASS.

- [ ] **Step 2: Move and rewire the page**

Apply the page migration rules. Delete local interfaces `Operation` and `OperationDetails` (lines 51-71); import both from `'../api/types'`.

| Line | Before | After |
|---|---|---|
| 74 | `const { addSuccessAlert, addDangerAlert } = useAlerts();` | `const api = useApi();` and `const host = useHost();` |
| 94-95 | `const response = await axios.get('/api/operations/history'); setOperations(Array.isArray(response.data) ? response.data : []);` | `const data = await api.getOperationHistory(); setOperations(Array.isArray(data) ? data : []);` |
| 98 | `addDangerAlert('Failed to load operation history');` | `host.notify('danger', 'Failed to load operation history');` |
| 116-117 | ``axios.get(`/api/operations/${selectedOperation.id}/logs`).then(res => { setLiveLog(res.data.logs \|\| ''); })`` | `api.getOperationLogs(selectedOperation.id).then(data => { setLiveLog(data.logs \|\| ''); })` |
| 125 | ``new EventSource(`/api/operations/${selectedOperation.id}/logstream`)`` | `new EventSource(api.operationLogStreamUrl(selectedOperation.id))` |
| 193-194 | ``const response = await axios.get(`/api/operations/${operationId}/details`); setOperationDetails(response.data);`` | `const data = await api.getOperationDetails(operationId); setOperationDetails(data);` |
| 261 | ``ids.map(id => axios.delete(`/api/operations/${id}`))`` | `ids.map(id => api.deleteOperation(id))` |
| 270 | ``addSuccessAlert(`Deleted ...`)`` | ``host.notify('success', `Deleted ...`)`` (same template) |
| 273 | `addDangerAlert('Failed to delete some operations');` | `host.notify('danger', 'Failed to delete some operations');` |
| 380 | ``href={`/api/config/download/${encodeURIComponent(configName)}`}`` | `href={api.configDownloadUrl(configName)}` |
| 655 | ``href={`/api/config/download/${encodeURIComponent(op.configFile)}`}`` | `href={api.configDownloadUrl(op.configFile)}` |
| *(m2m)* | `import { OPERATION_MODE_LABELS, isRegistryTargetMode, type OperationMode } from '../../server/operationModes';` | same names from `'@mirror-gui/shared/operationModes'` |

The merged page's local `Operation` interface also has `mode` and `destinationRegistry`; the shared `Operation` type has both, so delete the local one as planned.

Operation ids in `deleteOperation` and the log URLs are now passed through `encodeURIComponent`. Server ids are generated UUIDs, which it leaves unchanged.

If `errorMessage` now being `string | null` causes a type error where it is rendered or passed, use `op.errorMessage ?? undefined` at that use site.

- [ ] **Step 3: Point the shell at the package**

In `src/App.tsx`, the History lazy import becomes:

```ts
const History = lazy(() => import('@mirror-gui/ui/pages/History'));
```

Append to `packages/ui/src/index.ts`:

```ts
export { default as History } from './pages/History';
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm test`
Expected: no lint errors, build succeeds, tests pass.

Run: `grep -n "axios\|/api\|useAlerts" packages/ui/src/pages/History.tsx`
Expected: no output.

Run: `CI=1 npx playwright test tests/e2e/history.spec.ts tests/e2e/historyModes.spec.ts tests/e2e/navigation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/History.tsx packages/ui src/App.tsx
git commit -m "refactor(ui): move History to @mirror-gui/ui"
```

---

### Task 5: Migrate Settings

**Files:**
- Move: `src/components/Settings.tsx` to `packages/ui/src/pages/Settings.tsx`
- Modify: `src/App.tsx` (Settings lazy import), `packages/ui/src/index.ts`
- Test: existing `tests/e2e/settings.spec.ts`, `tests/e2e/pullSecret.spec.ts`, `tests/e2e/registryCredentials.spec.ts`

**Interfaces:**
- Consumes: `useApi` (`listCatalogs`, `getCatalogSyncStatus`, `startCatalogSync`, `deleteCatalogSyncData`, `listRegistries`, `verifyRegistry`, `getPullSecretStatus`, `getPullSecretContent`, `deletePullSecret`, `savePullSecret`, `getSystemInfo`, `cleanupCache`, `listRegistryCredentials`, `saveRegistryCredential`, `deleteRegistryCredential`, `verifyRegistryCredential`), `useHost` (`notify`), types `RegistryEntry`, `DestinationCredential`, `SystemInfo`, `CatalogSyncDiffEntry`, `CatalogSyncStatus`, `CatalogInfo`, `PullSecretStatus`, `ApiError`.
- Produces: `Settings` export from `@mirror-gui/ui`.

- [ ] **Step 1: Baseline**

Run: `CI=1 npx playwright test tests/e2e/settings.spec.ts tests/e2e/pullSecret.spec.ts tests/e2e/registryCredentials.spec.ts`
Expected: PASS.

- [ ] **Step 2: Move and rewire the page**

Apply the page migration rules. Delete local `RegistryEntry`, `DestinationCredential`, `SystemInfo`, `CatalogSyncDiffEntry`, `CatalogSyncStatus` interfaces; keep `shellSingleQuote`. Import the types from `'../api/types'`. Keep `useSearchParams` from `react-router-dom` as is.

State type adjustments (needed because the shared types follow the server):
- Line 103-111: initial `systemInfo` state becomes `{ ocMirrorVersion: '', systemArchitecture: '', availableDiskSpace: 0, totalDiskSpace: 0, hostDataDir: '', cacheDir: '', hostCacheDir: '', cacheSizeBytes: 0 }`. Settings never renders the disk-space fields (`grep -n "availableDiskSpace\|totalDiskSpace"` only matches the type and this initializer), so `''` to `0` has no visible effect.
- Line 122: `useState<{ detected: boolean; path: string | null }>` becomes `useState<PullSecretStatus>`.
- Line 141: `useState<{ name: string; url: string; digest: string | null; syncedAt: string | null }[]>` becomes `useState<CatalogInfo[]>`. Rendering code that checks `digest`/`syncedAt` for falsiness treats `undefined` like `null`; if TypeScript flags a use that requires `string | null`, write `entry.digest ?? null` at that use site.

| Line | Before | After |
|---|---|---|
| 101 | `const { addSuccessAlert, addDangerAlert } = useAlerts();` | `const api = useApi();` and `const host = useHost();` |
| 147-148 | `const response = await axios.get('/api/catalogs'); setCatalogDigests(response.data);` | `const data = await api.listCatalogs(); setCatalogDigests(data);` |
| 157-159 | `const response = await axios.get('/api/catalogs/sync/status'); setCatalogSyncStatus(response.data); if (response.data.status === 'running' ...` | `const data = await api.getCatalogSyncStatus(); setCatalogSyncStatus(data); if (data.status === 'running' ...` |
| 162-164 | `const r = await axios.get('/api/catalogs/sync/status'); setCatalogSyncStatus(r.data); if (r.data.status !== 'running' ...` | `const r = await api.getCatalogSyncStatus(); setCatalogSyncStatus(r); if (r.status !== 'running' ...` |
| 186 | `await axios.post('/api/catalogs/sync');` | `await api.startCatalogSync();` |
| 194 | `const msg = error.response?.data?.error \|\| 'Failed to start catalog sync';` | `const msg = (error as ApiError).message;` (rule 6: literal dropped) |
| 195, 238, 309 | `addDangerAlert(msg);` | `host.notify('danger', msg);` |
| 216, 220 | `addSuccessAlert(...)` / `addDangerAlert(...)` (sync completed/failed) | `host.notify('success', ...)` / `host.notify('danger', ...)`, same template strings |
| 232-233 | `const response = await axios.delete('/api/catalogs/sync/data'); addSuccessAlert(response.data.message);` | `const data = await api.deleteCatalogSyncData(); host.notify('success', data.message);` |
| 237 | `const msg = error.response?.data?.error \|\| 'Failed to clear sync data';` | `const msg = (error as ApiError).message;` (rule 6: literal dropped) |
| 250-251 | `const response = await axios.get('/api/registries'); setRegistries(response.data.registries \|\| []);` | `const data = await api.listRegistries(); setRegistries(data.registries \|\| []);` |
| 262-264 | `const response = await axios.post('/api/registries/verify', { registry }); ... status: response.data.status, error: response.data.error` | `const data = await api.verifyRegistry(registry); ... status: data.status, error: data.error` |
| 281-287 | `const [statusRes, contentRes] = await Promise.all([axios.get('/api/pull-secret/status'), axios.get('/api/pull-secret/content')]); setPullSecretStatus(statusRes.data); if (contentRes.data.content) { setPullSecretContent(contentRes.data.content); }` | `const [status, content] = await Promise.all([api.getPullSecretStatus(), api.getPullSecretContent()]); setPullSecretStatus(status); if (content.content) { setPullSecretContent(content.content); }` |
| 298-299 | `await axios.delete('/api/pull-secret'); addSuccessAlert('Pull secret removed successfully!');` | `await api.deletePullSecret(); host.notify('success', 'Pull secret removed successfully!');` |
| 301-302 | `await axios.post('/api/pull-secret', { content: pullSecretContent }); addSuccessAlert('Pull secret saved successfully!');` | `await api.savePullSecret(pullSecretContent); host.notify('success', 'Pull secret saved successfully!');` |
| 308 | `const msg = error.response?.data?.error \|\| 'Failed to save pull secret';` | `const msg = (error as ApiError).message;` (rule 6: literal dropped) |
| 326-327 | `const response = await axios.get('/api/system/info'); setSystemInfo(response.data);` | `const data = await api.getSystemInfo(); setSystemInfo(data);` |
| 336, 347, 357, 359, 824 | `addDangerAlert(...)` / `addSuccessAlert(...)` (clipboard, validation) | `host.notify('danger' \| 'success', ...)`, same strings |
| 368-369 | `await axios.post('/api/cache/cleanup'); addSuccessAlert('Cache cleaned up successfully!');` | `await api.cleanupCache(); host.notify('success', 'Cache cleaned up successfully!');` |
| 373 | `addDangerAlert('Failed to cleanup cache');` | `host.notify('danger', 'Failed to cleanup cache');` |
| *(m2m)* | `const response = await axios.get('/api/registry-credentials');` then `response.data.credentials`, `response.data.managedExternally`, `response.data.path`, `response.data.error` | `const data = await api.listRegistryCredentials();` then `data.credentials`, `data.managedExternally`, `data.path`, `data.error` (keep the existing `\|\| []`, `!!`, `\|\| null` guards) |
| *(m2m)* | `await axios.put('/api/registry-credentials', newCredential); addSuccessAlert(...)` | `await api.saveRegistryCredential(newCredential); host.notify('success', ...)`, same template |
| *(m2m)* | `addDangerAlert(error.response?.data?.error \|\| 'Failed to save credentials');` | `host.notify('danger', (error as ApiError).message);` (rule 6: literal dropped) |
| *(m2m)* | ``await axios.delete(`/api/registry-credentials/${encodeURIComponent(registry)}`); addSuccessAlert(...)`` | `await api.deleteRegistryCredential(registry); host.notify('success', ...)`, same template |
| *(m2m)* | `addDangerAlert(error.response?.data?.error \|\| 'Failed to remove credentials');` | `host.notify('danger', (error as ApiError).message);` (rule 6: literal dropped) |
| *(m2m)* | `const response = await axios.post('/api/registry-credentials/verify', { registry });` then `response.data.status`, `response.data.error` | `const data = await api.verifyRegistryCredential(registry);` then `data.status`, `data.error` |

The *(m2m)* rows were read from `feature/mirrorToMirror` before the merge. After the merge, run `grep -n "axios\|addSuccessAlert\|addDangerAlert\|addWarningAlert\|addInfoAlert" packages/ui/src/pages/Settings.tsx` once the table is applied. Any remaining hit is a call site this table missed: convert it with the same rules and list it in the commit message.

Note on line 262: the page has its own function named `verifyRegistry`; calling `api.verifyRegistry(...)` through the `api` object avoids the name clash. Do not destructure `api`.

Catch-clause typing: where a catch currently declares `error: any` or casts to an axios-like shape, change it to `catch (error)` with the `(error as ApiError)` cast at the use site.

- [ ] **Step 3: Point the shell at the package**

```ts
const Settings = lazy(() => import('@mirror-gui/ui/pages/Settings'));
```

Append to `packages/ui/src/index.ts`:

```ts
export { default as Settings } from './pages/Settings';
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm test`
Expected: no lint errors, build succeeds, tests pass.

Run: `grep -n "axios\|/api\|useAlerts" packages/ui/src/pages/Settings.tsx`
Expected: no output. (The `https://console.redhat.com/...` link at line 454 does not match `/api`.)

Run: `CI=1 npx playwright test tests/e2e/settings.spec.ts tests/e2e/pullSecret.spec.ts tests/e2e/registryCredentials.spec.ts tests/e2e/dashboard.spec.ts`
Expected: PASS (dashboard included because its pull-secret link navigates to Settings with `?tab=pull-secret`).

- [ ] **Step 5: Commit**

```bash
git add -A src/components/Settings.tsx packages/ui src/App.tsx
git commit -m "refactor(ui): move Settings to @mirror-gui/ui

When a failed response has no JSON error field, these alerts now show
the transport message (ApiError.message) instead of a fixed text:
'Failed to start catalog sync', 'Failed to clear sync data',
'Failed to save pull secret', 'Failed to save credentials',
'Failed to remove credentials'."
```

---

### Task 6: Migrate MirrorOperations

**Files:**
- Move: `src/components/MirrorOperations.tsx` to `packages/ui/src/pages/MirrorOperations.tsx`
- Modify: `src/App.tsx` (MirrorOperations lazy import), `packages/ui/src/index.ts`
- Test: existing `tests/e2e/mirrorOperations.spec.ts`, `operationLifecycle.spec.ts`, `startOperationErrors.spec.ts`, `stopOperation.spec.ts`, `configToOperations.spec.ts`, `operationModes.spec.ts`, `mirrorToMirror.spec.ts`

**Interfaces:**
- Consumes: `useApi` (`getOperationLogs`, `operationLogStreamUrl`, `listConfigs`, `listMirrorFolders`, `createMirrorFolder`, `listOperations`, `getSystemInfo`, `startOperation`, `deleteConfig`, `stopOperation`, `deleteOperation`, `configDownloadUrl`, `listRegistries`, `listRegistryCredentials`), `useHost` (`notify`), types `ConfigFile`, `Operation`, `OptionalFlagsPayload`, `ApiError`; mode helpers from `@mirror-gui/shared/operationModes`.
- Produces: `MirrorOperations` export from `@mirror-gui/ui`.

- [ ] **Step 1: Baseline**

Run: `CI=1 npx playwright test tests/e2e/mirrorOperations.spec.ts tests/e2e/operationLifecycle.spec.ts tests/e2e/startOperationErrors.spec.ts tests/e2e/stopOperation.spec.ts tests/e2e/configToOperations.spec.ts tests/e2e/operationModes.spec.ts tests/e2e/mirrorToMirror.spec.ts`
Expected: PASS.

- [ ] **Step 2: Move and rewire the page**

Apply the page migration rules. Delete local `ConfigFile`, `Operation`, `OptionalFlagsPayload` interfaces; keep `OptionalFlags` and `DEFAULT_OPTIONAL_FLAGS` (UI state). Import the three types from `'../api/types'`.

| Line | Before | After |
|---|---|---|
| 303 | `const { addSuccessAlert, addDangerAlert, addWarningAlert } = useAlerts();` | `const api = useApi();` and `const host = useHost();` |
| 351-352 | ``const response = await axios.get(`/api/operations/${operationId}/logs`); setLogs(response.data.logs \|\| 'No logs available for this operation');`` | `const data = await api.getOperationLogs(operationId); setLogs(data.logs \|\| 'No logs available for this operation');` |
| 354-356 | `const err = error as { response?: ...; message?: string }; ... setLogs(\`Error loading logs: ${err.response?.data?.message \|\| err.message}\`);` | ``setLogs(`Error loading logs: ${(error as ApiError).message}`);`` (delete the `err` cast) |
| 372, 374, 376 | `addSuccessAlert('Mirror Operation Completed!')`, `addDangerAlert('Mirror Operation Failed')`, `addWarningAlert('Mirror Operation Stopped')` | `host.notify('success', ...)`, `host.notify('danger', ...)`, `host.notify('warning', ...)` |
| 386 | ``new EventSource(`/api/operations/${operationId}/logstream`)`` | `new EventSource(api.operationLogStreamUrl(operationId))` |
| 424-425 | `const response = await axios.get('/api/config/list'); setAvailableConfigs(response.data);` | `const data = await api.listConfigs(); setAvailableConfigs(data);` |
| 433-434 | `const response = await axios.get<{ folders: string[] }>('/api/mirror-folders'); setAvailableFolders(response.data.folders ?? []);` | `const data = await api.listMirrorFolders(); setAvailableFolders(data.folders ?? []);` |
| 445, 448 | `await axios.post('/api/mirror-folders', { name: trimmed }); ... addSuccessAlert(\`Folder "${trimmed}" created\`);` | `await api.createMirrorFolder(trimmed); ... host.notify('success', \`Folder "${trimmed}" created\`);` |
| 451 | ``addDangerAlert(`Failed to create folder: ${err.response?.data?.error \|\| err.message}`);`` | ``host.notify('danger', `Failed to create folder: ${(error as ApiError).message}`);`` |
| 460-462 | `const response = await axios.get('/api/operations'); ... setOperations(response.data);` (and any later `response.data` in that callback) | `const data = await api.listOperations(); ... setOperations(data);` |
| 504 | `axios.get('/api/system/info').then(res => setHostDataDir(res.data.hostDataDir \|\| '')).catch(() => {});` | `api.getSystemInfo().then(info => setHostDataDir(info.hostDataDir \|\| '')).catch(() => {});` |
| 550, 556, 562 | `addDangerAlert(...)` (validation) | `host.notify('danger', ...)`, same strings |
| 568-574 | `const response = await axios.post('/api/operations/start', { ... });` | `const started = await api.startOperation({ ... });` (same object literal) |
| 576 | `addSuccessAlert('Operation started successfully!');` | `host.notify('success', 'Operation started successfully!');` |
| 582, 585-586 | `if (response.data.status === 'running')`, ``const logResponse = await axios.get(`/api/operations/${response.data.id}/logs`); setLogs(logResponse.data.logs \|\| '');`` | `if (started.status === 'running')`, `const logData = await api.getOperationLogs(started.id); setLogs(logData.logs \|\| '');` |
| 595-599 | `const err = error as {...}; ... addDangerAlert(\`Failed to start operation: ${err.response?.data?.error \|\| err.response?.data?.message \|\| err.message}\`);` | ``host.notify('danger', `Failed to start operation: ${(error as ApiError).message}`);`` (delete the `err` cast; keep the `console.error`) |
| 613-614 | ``await axios.delete(`/api/config/delete/${encodeURIComponent(deleteFilename)}`); addSuccessAlert(...)`` | `await api.deleteConfig(deleteFilename); host.notify('success', ...)` |
| 626 | ``addDangerAlert(`Failed to delete configuration: ${err.response?.data?.message \|\| err.message}`);`` | ``host.notify('danger', `Failed to delete configuration: ${(error as ApiError).message}`);`` |
| 632 | ``await axios.post(`/api/operations/${operationId}/stop`);`` | `await api.stopOperation(operationId);` |
| 636, 668, 726, 779 | `addDangerAlert(...)` | `host.notify('danger', ...)`, same strings |
| 661-662 | ``await axios.delete(`/api/operations/${deleteOperationId}`); addSuccessAlert('Operation deleted successfully!');`` | `await api.deleteOperation(deleteOperationId); host.notify('success', 'Operation deleted successfully!');` |
| 714, 724, 776 | `addSuccessAlert(...)` | `host.notify('success', ...)`, same strings |
| 770 | ``ids.map(id => axios.delete(`/api/operations/${id}`))`` | `ids.map(id => api.deleteOperation(id))` |
| 1360 | ``href={`/api/config/download/${encodeURIComponent(op.configFile)}`}`` | `href={api.configDownloadUrl(op.configFile)}` |
| *(m2m)* | the multi-line `import { ... } from '../../server/operationModes';` | same names from `'@mirror-gui/shared/operationModes'` |
| *(m2m)* | `axios.get('/api/registries'), axios.get('/api/registry-credentials'),` inside a `Promise.all`, then `.data` reads on each result | `api.listRegistries(), api.listRegistryCredentials(),` in the same `Promise.all`; drop `.data` from each result read |
| *(m2m)* | `addDangerAlert(destinationError);` | `host.notify('danger', destinationError);` |
| *(m2m)* | the `axios.post('/api/operations/start', { configFile, mode, mirrorDestinationSubdir, ...destinationRegistry/skipDestTlsVerify spread, ...optionalFlags spread })` | `api.startOperation({ ... })` with the same object literal, spreads included (this replaces row 568-574) |

The *(m2m)* rows were read from `feature/mirrorToMirror` before the merge. After applying the table, run `grep -n "axios\|addSuccessAlert\|addDangerAlert\|addWarningAlert\|addInfoAlert\|server/" packages/ui/src/pages/MirrorOperations.tsx`. Any remaining hit is a call site this table missed: convert it with the same rules and list it in the commit message.

`deleteOperationId` may be typed `string | null`; keep the existing null guard before the call.

Behavior notes (intended, record them in the commit message):
- Lines 356 and 626 used `body.message || transport message`. They now show `body.error ?? body.message ?? transport message`, so when the server sends `{ error: '...' }` the user sees the server's text instead of `Request failed with status code 404`.
- Line 451 used `body.error || transport message`; unchanged unless the server sends only `message`.

`startOperationErrors.spec.ts` asserts the alert contains `Failed to start operation` and, in its second test, the server's error detail; both are preserved because `ApiError.message` prefers `body.error`.

- [ ] **Step 3: Point the shell at the package**

```ts
const MirrorOperations = lazy(() => import('@mirror-gui/ui/pages/MirrorOperations'));
```

Append to `packages/ui/src/index.ts`:

```ts
export { default as MirrorOperations } from './pages/MirrorOperations';
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm test`
Expected: no lint errors, build succeeds, tests pass.

Run: `grep -n "axios\|/api\|useAlerts" packages/ui/src/pages/MirrorOperations.tsx`
Expected: no output.

Run: `CI=1 npx playwright test tests/e2e/mirrorOperations.spec.ts tests/e2e/operationLifecycle.spec.ts tests/e2e/startOperationErrors.spec.ts tests/e2e/stopOperation.spec.ts tests/e2e/configToOperations.spec.ts tests/e2e/operationModes.spec.ts tests/e2e/mirrorToMirror.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/MirrorOperations.tsx packages/ui src/App.tsx
git commit -m "refactor(ui): move MirrorOperations to @mirror-gui/ui

Log-loading and config-delete errors now prefer the server's error text
(ApiError.message) over the generic axios status message."
```

---

### Task 7: Migrate MirrorConfig and YamlHighlighter

**Files:**
- Move: `src/components/MirrorConfig.tsx` to `packages/ui/src/pages/MirrorConfig.tsx`
- Move: `src/components/YamlHighlighter.tsx` to `packages/ui/src/components/YamlHighlighter.tsx`
- Modify: `src/App.tsx` (MirrorConfig lazy import), `packages/ui/src/index.ts`
- Test: existing `tests/e2e/mirrorConfig.spec.ts`, `configToOperations.spec.ts`, `fullMirrorWorkflow.spec.ts`

**Interfaces:**
- Consumes: `useApi` (`listCatalogs`, `listDetailedOperators`, `getOperatorChannels`, `getOperatorVersions`, `getOperatorDependencies`, `saveConfig`), `useHost` (`notify`), types `CatalogInfo`, `DetailedOperator`, `OperatorDependency`.
- Produces: `MirrorConfig` export from `@mirror-gui/ui`.

- [ ] **Step 1: Baseline**

Run: `CI=1 npx playwright test tests/e2e/mirrorConfig.spec.ts tests/e2e/configToOperations.spec.ts tests/e2e/fullMirrorWorkflow.spec.ts`
Expected: PASS.

- [ ] **Step 2: Move both files and rewire the page**

```bash
mkdir -p packages/ui/src/components
git mv src/components/YamlHighlighter.tsx packages/ui/src/components/YamlHighlighter.tsx
git mv src/components/MirrorConfig.tsx packages/ui/src/pages/MirrorConfig.tsx
```

Change line 5 `import YamlHighlighter from './YamlHighlighter';` to `import YamlHighlighter from '../components/YamlHighlighter';`.

Apply the page migration rules. Delete local `CatalogInfo` and `DetailedOperator` interfaces and import them from `'../api/types'`. All other interfaces in this file (`PlatformChannel`, `OperatorChannel`, `OperatorPackage`, `OperatorCatalog`, `ImageSetConfig`, `CleanChannel`, `CleanOperatorChannel`, `CleanConfig`, `VersionField`) describe the YAML document being edited, not API payloads; leave them.

| Line | Before | After |
|---|---|---|
| 431 | `const { addSuccessAlert, addDangerAlert, addInfoAlert } = useAlerts();` | `const api = useApi();` and `const host = useHost();` |
| 537-538 | `const catalogsRes = await axios.get('/api/catalogs'); setAvailableCatalogs(catalogsRes.data);` | `const catalogs = await api.listCatalogs(); setAvailableCatalogs(catalogs);` |
| 541 | `addDangerAlert('Failed to load available channels and operators');` | `host.notify('danger', 'Failed to load available channels and operators');` |
| 545 | `}, [addDangerAlert]);` (the `fetchAvailableData` dependency list) | `}, [api, host]);` |
| 553-556 | ``const response = await axios.get(`/api/operators?catalog=${encodeURIComponent(catalogUrl)}&detailed=true`); const detailedOps: DetailedOperator[] = response.data;`` | `const detailedOps: DetailedOperator[] = await api.listDetailedOperators(catalogUrl);` |
| 573-575 and following `response.data` reads (576-585) | ``const response = await axios.get(`/api/operator-channels/${operatorName}?catalogUrl=${encodeURIComponent(catalogUrl)}`);`` then `response.data?.channels`, `response.data`, `response.data?.allChannels` | `const data = await api.getOperatorChannels(operatorName, catalogUrl);` then `data?.channels`, `data`, `data?.allChannels` (every `response.data` in that function becomes `data`) |
| 604 | ``addDangerAlert(`Failed to load channels for ${operatorName}`);`` | ``host.notify('danger', `Failed to load channels for ${operatorName}`);`` |
| 615-618 | ``const response = await axios.get(`/api/operators/${operatorName}/versions`, { params: { catalog: catalogUrl, channel: channelName } }); if (response.data?.versions?.length > 0) return response.data.versions;`` | `const data = await api.getOperatorVersions(operatorName, catalogUrl, channelName); if (data?.versions && data.versions.length > 0) return data.versions;` |
| 731 | `addInfoAlert('Platform Channel: ...');` | `host.notify('info', 'Platform Channel: ...');` |
| 871-879 | ``const depRes = await axios.get(`/api/operators/${value}/dependencies`, { params: { catalogUrl: operator.catalog } }); if (depRes.data?.dependencies?.length > 0) { const deps = depRes.data.dependencies as { packageName: string; defaultChannel?: string; }[];`` | `const depData = await api.getOperatorDependencies(value, operator.catalog); if (depData?.dependencies && depData.dependencies.length > 0) { const deps: OperatorDependency[] = depData.dependencies;` |
| 904, 1259, 1432, 1516, 2040 | `addSuccessAlert(...)` | `host.notify('success', ...)`, same strings |
| 1258 | `await axios.post('/api/config/save', { config: yamlString, name: configName });` | `await api.saveConfig(configName, yamlString);` (argument order is name, then config) |
| 1264 | `addDangerAlert('Failed to save configuration');` | `host.notify('danger', 'Failed to save configuration');` |

The `versions` and `dependencies` conditions are rewritten (instead of `?.length > 0`) only because the typed result makes `undefined > 0` a type error; the truth table is the same.

Operator names are now passed through `encodeURIComponent` in path segments. Valid operator package names (lowercase letters, digits, `-`, `.`) are unchanged by it, so requests are identical for every real operator.

- [ ] **Step 3: Point the shell at the package**

```ts
const MirrorConfig = lazy(() => import('@mirror-gui/ui/pages/MirrorConfig'));
```

Append to `packages/ui/src/index.ts`:

```ts
export { default as MirrorConfig } from './pages/MirrorConfig';
```

After this step `src/components/` contains only `ThemeToggle.tsx`.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm test`
Expected: no lint errors, build succeeds, tests pass.

Run: `grep -rn "axios\|/api\|useAlerts" packages/ui/src/pages packages/ui/src/components`
Expected: no output.

Run: `CI=1 npx playwright test tests/e2e/mirrorConfig.spec.ts tests/e2e/configToOperations.spec.ts tests/e2e/fullMirrorWorkflow.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components packages/ui src/App.tsx
git commit -m "refactor(ui): move MirrorConfig and YamlHighlighter to @mirror-gui/ui"
```

---

### Task 8: Boundary rule and final verification

**Files:**
- Modify: `eslint.config.js`
- Test: ESLint against a temporary violating file (deleted before commit); full suites; container build

**Interfaces:**
- Consumes: everything above.
- Produces: an ESLint config block that fails the build if `packages/ui` imports axios, reaches outside the package by relative path (package imports such as `@mirror-gui/shared/operationModes` stay allowed), or hardcodes `/api`.

- [ ] **Step 1: Write the violating probe file (the "failing test")**

`packages/ui/src/__boundary_probe__.ts`:

```ts
import axios from 'axios';
import { useAlerts } from '../../../src/AlertContext';

export const probeUrl = '/api/operations';
export const probeTemplate = (id: string) => `/api/operations/${id}`;
export const probe = [axios, useAlerts];
```

Run: `npx eslint packages/ui/src/__boundary_probe__.ts`
Expected: no boundary errors yet (the rule does not exist). This shows the probe is not caught today.

- [ ] **Step 2: Add the boundary rule**

In `eslint.config.js`, add this block at the end of the `defineConfig(...)` arguments (after the `server/**/*.ts` block):

```js
  {
    // @mirror-gui/ui runs inside both the standalone app and the OpenShift Console.
    // It may only reach the backend, alerts, and routes through the host adapter.
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'axios', message: 'Use useApi() from the host adapter instead of axios.' }],
        patterns: [{
          regex: '^(\\.\\./){2,}',
          message: '@mirror-gui/ui must not import from outside its own package (standalone shell or server).',
        }],
      }],
      'no-restricted-syntax': ['error',
        {
          selector: 'Literal[value=/^\\/api(\\/|$)/]',
          message: 'Do not hardcode /api paths; add a client function in packages/ui/src/api.',
        },
        {
          selector: 'TemplateLiteral > TemplateElement:first-child[value.raw=/^\\/api(\\/|$)/]',
          message: 'Do not hardcode /api paths; add a client function in packages/ui/src/api.',
        },
      ],
    },
  },
```

(Inside the package, the deepest legitimate relative import is one level, for example `'../api'` from `pages/`. Two or more `../` always leaves `packages/ui/src`.)

- [ ] **Step 3: Verify the rule catches every violation**

Run: `npx eslint packages/ui/src/__boundary_probe__.ts`
Expected: FAIL with exactly four errors: `no-restricted-imports` on the axios import, `no-restricted-imports` on the `../../../src/AlertContext` import, and `no-restricted-syntax` on `'/api/operations'` and on the template literal.

If the template-literal selector does not fire (esquery attribute paths on `TemplateElement` can differ between parser versions), replace the second selector with `TemplateElement[value.raw=/^\\/api(\\/|$)/]` and re-run until four errors are reported.

- [ ] **Step 4: Remove the probe and verify the real code is clean**

```bash
rm packages/ui/src/__boundary_probe__.ts
```

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Full suite**

Run: `npm run build && npm test && npm run test:coverage && npm run server:build`
Expected: all pass (`server:build` with the same result as Prerequisite 4); coverage report lists `src/host/standaloneHost.ts` and the `packages/ui/src/api/*.ts` files.

Run: `for p in Dashboard MirrorConfig MirrorOperations History Settings; do printf '%s ' $p; ls dist/assets | grep -c "^$p-.*\.js$"; done`
Expected: every page prints `1` (one chunk per page, as before the move).

Run: `CI=1 npm run test:e2e`
Expected: every spec under `tests/e2e/` passes with none skipped (`ls tests/e2e/*.spec.ts | wc -l` gives the count to match). If a spec is flaky, re-run that spec alone once; if it fails again, stop and report the output rather than retrying further.

- [ ] **Step 6: Verify the global constraints**

Run: `git diff --stat portable-ui-base -- server/`
Expected: only `server/operationModes.ts`.

Run: `git diff --stat portable-ui-base -- tests/ | grep -v "tests/unit/standaloneHost.test.ts\|tests/unit/hostContext.test.ts\|tests/unit/api/"`
Expected: only the summary line, meaning no pre-existing test file changed.

Run: `git diff portable-ui-base -- package-lock.json | grep '^[+-] *"version"'`
Expected: only the `@mirror-gui/shared` and `@mirror-gui/ui` `1.0.0` entries (no external package version changes).

Run: `ls src/components`
Expected: `ThemeToggle.tsx` only.

- [ ] **Step 7: Container smoke test**

Run: `podman build -t localhost/mirror-gui .`
Expected: build succeeds.

Run: `IMAGE_NAME=localhost/mirror-gui ./mirror-gui.sh` and open the printed URL. Check, in order:
1. Dashboard loads with stats and system status (no danger alert).
2. Navigate to Mirror Configuration, History, Settings, Mirror Operations; each renders.
3. On Dashboard, if the pull-secret link is shown, it opens Settings on the pull-secret tab.
4. On Mirror Operations, start an operation with any saved configuration; the log panel shows streamed lines; stop it; a warning toast `Mirror Operation Stopped` appears.
5. On History, the stopped operation is listed and its config download link downloads the YAML.

Expected: all five checks pass. Report each one's result. If no pull secret is configured, step 4 may fail at the oc-mirror level; that is acceptable only if the danger toast shows the server's error text (which itself verifies the error mapping), and say so in the report.

Stop the container afterwards (`podman stop` the container `mirror-gui.sh` started).

- [ ] **Step 8: Commit**

```bash
git add eslint.config.js
git commit -m "build(ui): enforce @mirror-gui/ui boundary with ESLint"
```
