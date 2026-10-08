# Portable UI: Design

Date: 2026-10-08
Branch: `feature/console-plugin`
Status: Draft, awaiting review

## Context and goal

Mirror-GUI will ship in two forms:

1. **Standalone container** (today's product), for bastion hosts and pre-install mirror-to-disk work where no OpenShift cluster exists yet.
2. **OpenShift Console dynamic plugin**, for users who already have a connected cluster (for example, a hub that mirrors content for disconnected spokes).

Both forms share the PatternFly UI and the backend logic, each wrapped in a thin host-specific shell.

A migration to Next.js was considered and rejected. The app is an interactive client-side tool backed by a stateful process manager (long-running `oc-mirror` child processes, in-memory operation state, SSE log streams, cron jobs). SSR, React Server Components, and serverless deployment add little to it, and the backend does not fit Next.js route handlers.

### Overall decomposition

Each sub-project gets its own spec, plan, and implementation cycle.

| # | Sub-project | Summary |
|---|---|---|
| 1 | **Portable UI (this spec)** | Move pages into a shared workspace package behind a host adapter and API client. No visible change. |
| 2 | Backend restructure | Split `server/index.ts` into route modules; put oc-mirror execution behind an interface (local child process now, Kubernetes Jobs later); make storage and pull-secret handling configurable. |
| 3 | Console plugin | `packages/console-plugin` using `@openshift-console/dynamic-plugin-sdk` (webpack, Module Federation, `console-extensions.json`), plugin host adapter, nginx image. |
| 4 | Cluster deployment | Helm chart or OLM bundle: plugin Deployment, `ConsolePlugin` CR, backend Deployment with PVC, pull-secret Secret, RBAC, egress requirements. |

Decisions already made for later sub-projects:

- In the plugin deployment, the backend runs as a pod and spawns `oc-mirror` as a child process, as it does today. The execution engine is hidden behind an interface so Kubernetes Jobs can be added later (sub-project 2).

## Scope of this sub-project

In scope:

- npm workspaces with one new package, `packages/ui` (`@mirror-gui/ui`).
- A host adapter interface and its standalone implementation.
- A typed API client built on the adapter.
- Moving the five pages and `YamlHighlighter` into `packages/ui`, rewired to the adapter and client.
- An ESLint rule that enforces the package boundary.
- Unit tests for the adapter and the client.

Out of scope:

- Any change under `server/`.
- Any change to existing tests.
- The console plugin package, its build, or its adapter implementation.
- Sharing TypeScript types between server and UI.
- Changes to data-fetching patterns (caching, polling, TanStack Query).
- Splitting the large page components.

## Section 1: Package layout and boundaries

The repo root remains the standalone app. Moving the server now would rewrite import paths in existing tests (forbidden by AGENTS.md) and would be redone in sub-project 2.

```
/                         workspace root AND standalone app
  package.json            adds "workspaces": ["packages/*"]
  index.html, vite.config.ts, Dockerfile, ...   unchanged locations
  server/                 unchanged
  tests/                  unchanged files; new unit tests added
  src/                    standalone shell
    main.tsx              global PatternFly CSS imports, renders App
    App.tsx               masthead, sidebar, router, providers (adds HostProvider)
    ThemeContext.tsx, AlertContext.tsx, app.css
    components/ThemeToggle.tsx
    host/standaloneHost.ts   NEW: standalone MirrorGuiHost implementation
  packages/ui/            NEW: @mirror-gui/ui
    package.json
    tsconfig.json
    src/
      index.ts            public exports: pages, HostProvider, useHost, MirrorGuiHost, ApiError
      host/               MirrorGuiHost interface, HostProvider, useHost, ApiError
      api/                API client (Section 3)
      pages/              Dashboard, MirrorConfig, MirrorOperations, History, Settings
      components/         YamlHighlighter
```

Rules:

- `packages/ui` is consumed as TypeScript source through the workspace symlink. It has no build step and no `dist/`. Vite (standalone) and, later, webpack (plugin) compile it.
- `react`, `react-dom`, `react-router-dom`, and `@patternfly/*` are `peerDependencies` of `packages/ui`. Both hosts provide a single copy; the console shares them as Module Federation singletons.
- `packages/ui` must not import `axios`, anything under `src/`, or anything under `server/`. An ESLint `no-restricted-imports` rule scoped to `packages/ui/**` enforces this.
- Global CSS (PatternFly base, addons, `app.css`) stays in the standalone shell, because the console supplies its own.

Changes outside `src/` and `packages/`: root `package.json` (`workspaces`), root `tsconfig.json` include list, ESLint config globs (`packages/**`), lint script globs, and the Dockerfile builder stage (copy `packages/` before `npm ci` so the workspace resolves).

## Section 2: The host adapter

Pages currently depend on their host for four things:

| Need | Today | Pages |
|---|---|---|
| HTTP calls | `axios` with hardcoded `/api/...` | all 5 |
| Raw URLs | `new EventSource('/api/.../logstream')`, `<a href="/api/config/download/...">` | History, MirrorOperations |
| Notifications | `useAlerts()` from `AlertContext` | all 5 |
| Navigation | `navigate('/settings?tab=pull-secret')`, `useSearchParams()` | Dashboard, Settings |

No page reads the theme. Client-side `Blob` downloads (CSV export, YAML download) work the same in both hosts.

Interface (`packages/ui/src/host/`):

```ts
type PageId = 'dashboard' | 'config' | 'operations' | 'history' | 'settings';

interface RequestOptions {
  body?: unknown;
  params?: Record<string, string>;
  formData?: FormData;
}

interface MirrorGuiHost {
  /** Request to the mirror-gui backend. `path` is relative to the API root, e.g. '/operations/start'. */
  request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, options?: RequestOptions): Promise<T>;
  /** Absolute URL for resources the browser loads itself (EventSource, download links). */
  apiUrl(path: string): string;
  notify(variant: 'success' | 'danger' | 'warning' | 'info', title: string): void;
  /** Host route for an app page, e.g. '/settings' standalone or '/mirror-gui/settings' in the console. */
  pagePath(page: PageId): string;
}

class ApiError extends Error {
  status: number;   // HTTP status, or 0 when no response was received
  body: unknown;    // parsed response body, if any
}
```

- `HostProvider` supplies the host through React context; `useHost()` reads it and throws if no provider is present.
- `request` always rejects with `ApiError`. `message` is the server's `error` field when present, otherwise a generic message. Pages replace their reads of axios's `error.response?.data?.error` with `ApiError.message` and `ApiError.status`.
- Pages do not call `host.request` directly; they use the API client.

Standalone implementation (`src/host/standaloneHost.ts`):

- `request`: axios with base `/api`; maps axios errors to `ApiError`.
- `apiUrl(path)`: `/api` + `path`.
- `notify`: delegates to the existing `AlertContext`. Because it needs that context, the adapter is created inside `AlertProvider` (for example, with a small `StandaloneHostProvider` component in the shell).
- `pagePath`: `dashboard` to `/`, `config` to `/config`, `operations` to `/operations`, `history` to `/history`, `settings` to `/settings`.

Plugin implementation (sub-project 3, recorded here only to validate the interface): `request` through `consoleFetchJSON` (adds the CSRF header), API base `/api/proxy/plugin/mirror-gui/backend/api`, `notify` through plugin-local PatternFly toasts, pages under `/mirror-gui/...`.

Navigation: pages keep `useNavigate` and `useSearchParams` from `react-router-dom`, but every path they build comes from `host.pagePath()`.

## Section 3: The API client

The pages call about 30 distinct endpoints through about 45 axios calls. The client replaces those calls one for one.

```
packages/ui/src/api/
  operations.ts   start, stop, remove, list, history, recent, details, logs, logStreamUrl
  config.ts       list, save, remove, downloadUrl
  catalogs.ts     catalogs, operators, operatorChannels, dependencies, sync, syncStatus, deleteSyncData
  system.ts       stats, systemStatus, systemInfo, mirrorFolders, addMirrorFolder, cacheCleanup
  settings.ts     pullSecretStatus, pullSecretContent, savePullSecret, removePullSecret, registries, verifyRegistry
  types.ts        request and response types
  index.ts        useApi(): all functions bound to useHost()
```

The function list above is indicative. The implementation plan derives the exact list from the axios calls present in the pages, and each call maps to exactly one client function.

- Each function takes the host as its first argument, so it can be tested without React. `useApi()` returns the same functions with the host bound.
- Path segments built from user data (operation ids, operator names, config filenames) are encoded with `encodeURIComponent`, matching current behavior.
- `logStreamUrl` and `downloadUrl` return `host.apiUrl(...)` strings for `EventSource` and `<a href>`.
- Interfaces currently declared in page files that describe API payloads move to `types.ts`. Interfaces that describe UI state stay in their pages. The server keeps its own types.
- The client adds no caching, retries, or polling. Pages keep their existing `useEffect` and `setInterval` logic unchanged.
- No endpoint, request shape, or response shape changes, so `API.md` needs no update.

## Section 4: Testing, migration order, success criteria

### New tests

In `tests/unit/` (Vitest, node environment, no new dependencies):

- **Standalone adapter:** an axios 4xx or 5xx response becomes `ApiError` with the server's `error` message and the HTTP status; a network failure becomes `ApiError` with status 0; `apiUrl` prefixes `/api`. Why: every page's user-facing error message depends on this mapping.
- **API client:** each function is called with a recording fake host; the test asserts the exact method, path, query params, and body. Why: this is the guard for "no server changes"; if a function drifts from the route the server exposes, the test fails. Includes encoding cases for ids and filenames containing spaces, slashes, and other reserved characters.
- Coverage `include` is extended with `packages/ui/src/api/**` and `packages/ui/src/host/**` and `src/host/**`.

The adapter test imports axios-related code from `src/host/`; if mocking axios is needed, use Vitest's built-in `vi.mock`.

### Existing tests

No existing unit, integration, or E2E file is modified, skipped, or excluded. The 12 Playwright specs are the primary evidence that the standalone app behaves the same. E2E runs locally with `CI=1`, so Playwright starts its own server against a temporary storage directory.

### Migration order

Each step leaves the app building and the test suites passing.

1. Workspace scaffolding: `packages/ui` (`package.json`, `tsconfig.json`), root `workspaces`, tsconfig includes, ESLint and lint-script globs, Dockerfile `COPY packages/`.
2. Host interface, `ApiError`, `HostProvider`, `useHost`, standalone adapter, and adapter tests. Wire the provider into `App.tsx`.
3. API client and client tests.
4. Move pages one at a time: Dashboard, History, Settings, MirrorOperations, MirrorConfig. For each page, move the file, replace axios calls with `useApi`, replace `useAlerts` with `host.notify`, replace hardcoded routes with `host.pagePath`, then run lint, unit tests, and the related E2E specs.
5. Add the ESLint boundary rule.
6. Container smoke test: `podman build -t localhost/mirror-gui .`, run with `IMAGE_NAME=localhost/mirror-gui ./mirror-gui.sh`, load every page, start and stop an operation, and confirm the log stream displays.

### Success criteria

All must hold:

- `npm run lint`, `npm run build`, `npm test`, and `CI=1 npm run test:e2e` pass with no existing test modified, skipped, or excluded.
- `packages/ui` contains no `axios` import and no `'/api` or `` `/api `` string literal, and the ESLint rule fails the build if one is added.
- `git diff --stat main -- server/` is empty.
- The container image builds and the step 6 smoke test passes.

## Risks for later sub-projects

Recorded here because the adapter design depends on them; none affects the standalone app.

1. **Console router version.** Pages use react-router v6 hooks. The console version targeted by the plugin must expose v6-compatible APIs to plugins (older consoles used `react-router-dom-v5-compat`). If not, navigation and query-param reads move fully into the host adapter. The change is limited to Dashboard and Settings.
2. **SSE through the console plugin proxy.** Log streaming requires the proxy to pass `text/event-stream` without buffering. If it buffers, the plugin adapter falls back to polling `/operations/:id/logs`.
3. **Download links through the proxy.** Native `<a download>` links to `/config/download/:filename` must work through the proxy with the console session. If not, downloads switch to fetch plus `Blob` in the plugin.
