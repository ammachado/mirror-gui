# Mirror-to-Mirror and Disk-to-Mirror Design

## Goal

Let Mirror-GUI push content into a destination container registry, in addition to the existing mirror-to-disk workflow. Two new oc-mirror v2 workflows are added:

- **Mirror-to-mirror (M2M)**: copy images directly from source registries to a destination registry, for partially disconnected environments.
- **Disk-to-mirror (D2M)**: push a previously created `mirror_*.tar` archive to a destination registry, completing the air-gapped workflow.

## Scope

- A `mode` on operations: `mirrorToDisk` (existing, default), `mirrorToMirror`, `diskToMirror`.
- A destination registry, a destination TLS opt-out, and a `--max-nested-paths` option for registry-targeted modes.
- Destination registry credentials managed separately from the pull secret, through a Settings form or an externally managed file (Helm Secret).
- UI for selecting the mode and its inputs on the Mirror Operations page; mode display in operation lists, details, and History.
- Helm chart values for an optional externally managed credentials Secret.
- Documentation updates in `API.md`, `docs/dev/operations.md`, and the Helm chart docs.

## Non-goals

- Custom CA bundles for destination registries (see Known limitations).
- Uploading archives through the browser. D2M sources are folders already present under the mirror base directory.
- `oc-mirror delete` workflows.
- Exposing `--since`, `--strict-archive`, or `--dry-run`.
- Changing source TLS behavior (`--src-tls-verify=false` stays as is).

## Reference: oc-mirror v2 workflows

From the oc-mirror repository (`docs/features/mirroring-workflows.md`, `README.md`):

| Workflow | Command pattern |
| --- | --- |
| M2D | `oc-mirror --v2 -c <config> file://<path>` |
| D2M | `oc-mirror --v2 -c <config> --from file://<path> docker://<registry>` |
| M2M | `oc-mirror --v2 -c <config> --workspace file://<path> docker://<registry>` |

- `--from` and `--workspace` are mutually exclusive; a `docker://` destination requires exactly one of them.
- `-c` is still required for D2M; it selects a subset of the archive.
- Cluster resources (IDMS, ITMS, CatalogSource, etc.) are written to `<workspace or --from dir>/working-dir/cluster-resources/`.
- `--dest-tls-verify` defaults to `true` in oc-mirror.
- `--cache-dir` is valid in all workflows (D2M uses the cache to unpack archives; M2M barely uses it).
- M2D deletes previous `mirror_*.tar` files in its destination directory before writing new ones.
- `--max-nested-paths` limits nested repository paths for destination registries that restrict path depth.
- oc-mirror trusts only the system certificate store; there is no CA flag.

## Architecture

The existing `POST /api/operations/start` endpoint gains a `mode` field. The shared lifecycle (operation record, log file, SSE streaming, stop, completion detection) is unchanged. Two new focused modules keep the risky logic out of `server/index.ts` and make it unit-testable:

| Module | Responsibility |
| --- | --- |
| `server/ocMirrorArgs.ts` | Pure function `buildOcMirrorArgs()` returning the oc-mirror argv for a mode. No I/O. |
| `server/registryCredentials.ts` | Load, validate, save, and list destination credentials; build the merged temporary authfile. |

`buildOptionalFlagArgs()` gains mode awareness so it can reject mode-specific flags for the wrong mode.

### Argument building

`buildOcMirrorArgs({ mode, configPath, folderPath, cacheDir, authfilePath, destinationRegistry, skipDestTlsVerify, additionalArgs })` returns:

- **M2D** (unchanged from today):
  `--v2 --config <cfg> --dest-tls-verify=false --src-tls-verify=false --cache-dir <cache> --authfile <pull secret> ...additional file://<folder>`
- **M2M**:
  `--v2 --config <cfg> --workspace file://<folder> --dest-tls-verify=<!skip> --src-tls-verify=false --cache-dir <cache> --authfile <merged> ...additional docker://<destination>`
- **D2M**:
  `--v2 --config <cfg> --from file://<folder> --dest-tls-verify=<!skip> --src-tls-verify=false --cache-dir <cache> --authfile <merged> ...additional docker://<destination>`

`file://` URLs are built with `pathToFileURL`, as today. The server adds the `docker://` prefix; clients never send it.

### Folder semantics

`mirrorDestinationSubdir` keeps its name and validation rules (letters, digits, `-`, `_`; no separators or traversal). Its meaning depends on the mode:

| Mode | Folder role | Must exist? |
| --- | --- | --- |
| M2D | Archive output directory | Created if missing (today's behavior) |
| M2M | Workspace (`--workspace`) | Created if missing |
| D2M | Archive source (`--from`) | Must exist and contain at least one `mirror_*.tar` |

The resolved path is stored as `mirrorDestination` on the operation record for all modes, so existing UI that copies the path keeps working.

### Folder conflict guard

Because M2D deletes prior archives in its folder, the server rejects a start (409) when another **running** operation uses the same folder. This applies to every mode pair, which also prevents two runs sharing one oc-mirror `working-dir`.

## Destination credentials

### Storage

Credentials are stored in the standard container auth file format, so a podman `auth.json` can be used directly as the external file:

```json
{ "auths": { "registry.example.com:5000": { "auth": "<base64 user:password>" } } }
```

- **App-managed (default)**: `STORAGE_DIR/registry-credentials.json`, written with mode `0600`.
- **Externally managed**: when `OC_MIRROR_REGISTRY_CREDENTIALS` is set, the server reads that path and treats it as read-only. Write endpoints return 409 with a "managed outside the application" message, matching the pull secret behavior.

A missing file means "no credentials". A file that exists but is not valid JSON, or whose `auths` entries are not objects with a string `auth`, is an error: Settings shows it and M2M/D2M starts return 500. The server never silently treats a malformed file as empty.

### API

| Method and path | Purpose |
| --- | --- |
| `GET /api/registry-credentials` | List `{ registry, username, status, error? }` entries plus `{ managedExternally, error? }`. Never returns passwords or `auth` values. |
| `PUT /api/registry-credentials` | Body `{ registry, username, password }`. Adds or replaces one entry. 409 when externally managed. |
| `DELETE /api/registry-credentials/:registry` | Removes one entry. 409 when externally managed; 404 when absent. |
| `POST /api/registry-credentials/verify` | Body `{ registry }`. Runs the existing `/v2/` Basic plus Bearer token flow with the stored credentials. |

`registry` must match `host[:port]` (no scheme, path, or whitespace). The verification logic is extracted from `POST /api/registries/verify` into a shared helper so both endpoints use one implementation.

### Merged authfile

For M2M and D2M, the server builds a temporary authfile before spawning:

1. Read the pull secret `auths` (required; missing pull secret fails as it does today).
2. Read the destination credentials `auths`.
3. Merge; on a host present in both, the destination credentials entry wins.
4. Write to `RUN_DIR/authfile-<operationId>.json` with mode `0600`.

The file is removed on process `close`, on process `error`, and when spawning or any step after writing it throws. The stop endpoint relies on the `close` handler. The temporary path is never included in API responses or operation records. M2D keeps passing the pull secret path directly.

### Missing credentials for the destination host

Not a hard error, since some registries accept anonymous pushes. The UI shows a warning before start when the destination host (`host[:port]` portion of `destinationRegistry`) has no entry in either the destination credentials or the pull secret. Authentication failures surface through oc-mirror's logs and the existing failed-status detection.

## API changes to `POST /api/operations/start`

New body fields:

| Field | Type | Modes | Notes |
| --- | --- | --- | --- |
| `mode` | `'mirrorToDisk' \| 'mirrorToMirror' \| 'diskToMirror'` | all | Optional; defaults to `mirrorToDisk`. Unknown values return 400. |
| `destinationRegistry` | string | M2M, D2M | Required for these modes; 400 if sent with M2D. |
| `skipDestTlsVerify` | boolean | M2M, D2M | Optional; default `false`. 400 if not a boolean or sent with M2D. |
| `optionalFlags.maxNestedPaths` | positive integer | M2M, D2M | 400 for M2D, non-integers, or values below 1. |

`destinationRegistry` validation: `host[:port]` optionally followed by `/`-separated lowercase path segments matching `[a-z0-9]+([._-][a-z0-9]+)*`. Rejected: schemes (`docker://`, `https://`), whitespace, tags (`:tag` after a path), digests (`@sha256:`), trailing `/`.

Error responses for D2M sources: 404 when the folder does not exist; 400 with help text when it contains no `mirror_*.tar`.

## Operation record

```ts
interface OperationRecord {
  // existing fields...
  mode?: 'mirrorToDisk' | 'mirrorToMirror' | 'diskToMirror';
  destinationRegistry?: string;
}
```

Records without `mode` are treated as `mirrorToDisk` everywhere they are read. `GET /api/operations/:id/details` adds `clusterResourcesPath` (`<folder>/working-dir/cluster-resources`) for M2M and D2M operations.

## UI

### Mirror Operations page

- A PatternFly `ToggleGroup` selects the mode: "Mirror to disk", "Mirror to mirror", "Disk to mirror". The default is "Mirror to disk".
- The folder picker label changes with the mode: "Mirror destination", "Workspace", "Archive source". In D2M it lists existing folders only and does not offer creating one.
- For M2M and D2M:
  - "Destination registry" text input with inline validation matching the server rules.
  - "Skip TLS verification for destination" checkbox, unchecked by default, with helper text explaining the risk.
  - "Max nested paths" number input in the optional flags area.
  - An inline warning when the destination host has no credentials, linking to Settings.
- Operation rows and details show the mode and, for M2M and D2M, the destination registry and cluster resources path (with the existing copy-path behavior).

### Settings page

A "Destination registry credentials" section following the existing registry list patterns: a table of `registry`, `username`, verification status, and actions (verify, delete), plus an add/replace form (registry, username, password). When externally managed, the form and delete actions are disabled and an info alert names the managing path. A load error renders as a danger alert.

### History

A "Mode" column is added, and the CSV export includes `mode` and `destinationRegistry`.

## Helm chart

New values, following the `pullSecret` pattern:

| Value | Default | Purpose |
| --- | --- | --- |
| `registryCredentials.existingSecret` | `""` | Existing Secret holding a container auth file for destination registries |
| `registryCredentials.key` | `auth.json` | Secret key to mount |

When `existingSecret` is set, the chart mounts the key read-only and sets `OC_MIRROR_REGISTRY_CREDENTIALS` to its path. No secret data is rendered from values.

## Testing

**Unit tests**

- `buildOcMirrorArgs`: assert the full argv array for each mode, including the `--workspace` and `--from` placement, `docker://` prefixing, `--dest-tls-verify` true/false, and appended optional flags. Full-array assertions make a dropped or reordered flag fail.
- Optional flags: `maxNestedPaths` accepted for M2M and D2M, rejected for M2D, rejected for 0, negatives, and non-integers.
- `destinationRegistry` validation: accepted and rejected examples for each rule above.
- `registryCredentials`: merge precedence (destination entry replaces the pull secret entry for the same host and keeps other pull secret hosts); list output contains no `auth` or password; malformed files raise errors; writes produce mode `0600`; external mode rejects writes.

**Integration tests** (Vitest with the existing server harness)

- Start validation per mode: missing or invalid `destinationRegistry`, M2M/D2M-only fields sent with M2D, D2M folder missing (404) or without archives (400), folder conflict with a running operation (409), unknown `mode` (400), omitted `mode` behaves as M2D.
- Credentials CRUD and the 409 responses in external mode.
- Using the fake `oc-mirror` on `PATH` from `tests/integration/operationsLifecycle.test.ts` (it records argv to `OC_MIRROR_ARGS_FILE`): the spawned argv for M2M and D2M contains the expected `--workspace`/`--from`, `docker://` destination, and `--dest-tls-verify` value; the `--authfile` it received contains the merged entries while the process runs; and that file no longer exists after the operation completes.

**E2E tests** (Playwright)

- The mode toggle shows and hides the M2M/D2M fields and changes the folder label.
- The D2M folder picker lists only existing folders.
- The missing-credentials warning appears and links to Settings.
- Settings: add, list, and delete a destination credential; the password is never displayed after saving.

No test pushes to a real registry. The argv unit tests cover the oc-mirror contract.

## Known limitations

- **Private CAs.** oc-mirror only trusts the system certificate store, and the restricted, non-root container cannot update it at runtime. Destination registries with a private CA require "Skip TLS verification" until a CA bundle feature is designed.
- **Folder reuse.** Running M2D into a folder later used as a D2M source is supported, but M2D replaces that folder's archives. The conflict guard only covers concurrent runs.
