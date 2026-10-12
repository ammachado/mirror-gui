# Registry ImageSetConfiguration discovery (phase 1: backend)

## Goal

Given an existing oc-mirror v2 registry, discover which OpenShift release
versions and operators it holds and reconstruct an `ImageSetConfiguration`
that describes them.

Out of scope for this spec: the "Import from registry" UI (phase 2, own design).

## Decisions made

| Question | Decision |
|---|---|
| Mirror source | A live registry (URL plus optional namespace), not a local folder |
| Registry population | oc-mirror v2 layout only |
| Approach | Hybrid: registry HTTP API for tags, `oc image extract` for catalog content |
| New dependencies | None (`oc`, `jq`, `python3` already ship in the image) |
| Auth helper | Extract from `/api/registries/verify` and share; verify behavior unchanged |

## API

`POST /api/config/from-registry`

Request:

```json
{
  "registry": "mirror.example.com:8443",
  "namespace": "ocp4",
  "catalogs": ["ocp4/redhat/redhat-operator-index:v4.16"],
  "sourceCatalogPrefix": "registry.redhat.io/redhat"
}
```

- `registry` required; `namespace`, `catalogs`, `sourceCatalogPrefix` optional.
- `sourceCatalogPrefix` rewrites emitted `catalog:` refs from the mirror back to
  the source registry. Default: emit the mirror's own refs.
- Input validation follows the folder-name checks: no scheme, spaces, `..`,
  backslashes; invalid input returns 400.

Response (200, nothing is saved; the caller may pass `yaml` to `/api/config/save`):

```json
{
  "yaml": "...",
  "config": { },
  "discovered": { "releases": [], "catalogs": [], "warnings": [] }
}
```

## Discovery algorithm

1. **Auth.** Read the pull-secret entry for `registry`; Basic then bearer-token
   flow as in verify. No credentials: try anonymous. Auth failure: 401 passthrough.
2. **Releases.** `GET /v2/<ns>/openshift/release-images/tags/list` (follow `Link`
   pagination). Accept tags matching `^(\d+\.\d+\.\d+)-(x86_64|aarch64|ppc64le|s390x)$`.
   Group by `major.minor` into a channel `stable-<major.minor>` with
   `minVersion`/`maxVersion`/`architectures`. Non-matching tags go to `warnings`.
3. **Catalogs.** Try `GET /v2/_catalog`. On failure or empty, probe standard index
   names (`redhat-operator-index`, `certified-operator-index`,
   `community-operator-index`, `redhat-marketplace-index`) under `<ns>/redhat/`
   and `<ns>/`. Entries in `catalogs[]` are added as given.
4. **Operators.** Per catalog tag: `oc image extract --registry-config <pull-secret>
   --path /configs/:<tmp>/configs <ref>`, then
   `python3 scripts/catalog_metadata.py generate`. Each package becomes
   `{ name, channels: [{ name, minVersion, maxVersion }] }`. Concurrency 3,
   120s timeout per extraction, 10s per HTTP call. Temp dirs removed in `finally`.

## Output mapping

Matches the builder shape (`MirrorConfig.tsx`, `apiVersion: mirror.openshift.io/v2alpha1`).

- Arch map: `x86_64` -> `amd64`, `aarch64` -> `arm64`, `ppc64le`, `s390x` unchanged.
- Channel name `stable-<major.minor>` is an assumption and is stated in `warnings`.
- Version gaps inside a min/max range are reported in `warnings`; the range is
  still emitted (oc-mirror ranges are inclusive, so a sparse mirror is over-approximated).
- A channel with no versions is emitted with `name` only.
- One `operators` entry per catalog tag. Unfiltered catalogs emit all packages.

## Errors

| Case | Behavior |
|---|---|
| No credentials and registry requires auth | 401 with clear message |
| `release-images` repo missing | `platform` omitted, warning |
| No catalogs found | `operators` omitted, warning; 404 only if nothing at all found |
| One catalog extraction fails | Skip it, warning, keep the rest |
| Invalid input | 400 |

## Code layout

| File | Change | Responsibility |
|---|---|---|
| `server/registryAuth.ts` | new | Basic/bearer flow extracted from verify route |
| `server/registryDiscovery.ts` | new | `listTags`, `discoverReleases`, `discoverCatalogs`, `extractCatalogOperators`; injected `fetch` and `runOc` |
| `server/imagesetFromRegistry.ts` | new | Pure `buildImageSetConfig` (arch map, grouping, gap warnings) |
| `server/index.ts` | edit | New route; verify route uses shared auth helper |
| `API.md` | edit | Document endpoint |

Notes:

- `oc` is invoked with `execFile` and an args array (no shell), so `registry` and
  `namespace` cannot inject commands.
- TLS: mirrors `--src-tls-verify=false` already used for mirror runs. This is a
  security tradeoff and is called out for review.
- Discovery constants (repo names, tag regex, standard catalog names) live in one
  place so a layout mismatch is a one-line fix.

## Testing

- Unit: tag parsing and grouping, arch mapping, gap detection, YAML shape for
  empty, partial and full inputs.
- Integration (`tests/integration/fromRegistry.test.ts`): injected fake registry
  and `oc`; 400 on bad input, 401 passthrough, partial-failure warnings, output
  accepted by the `/api/config/save` validation and round-trips via `/api/config/upload`.
- Fixture: trimmed catalog `configs/` tree under `tests/fixtures`.
- Existing verify-route tests are not modified.
- E2E deferred to phase 2.

## Non-goals

- oc-mirror v1 layouts, arbitrary registries.
- `additionalImages`, helm charts.
- Bundle-level precision (`minBundle`, `full`, `selectedBundles`).
- Auto-saving the result.
- Verifying that every image in a range exists.

## Success criteria

- A fake v2-layout registry yields an `ImageSetConfiguration` that passes
  `/api/config/save` validation and round-trips through `/api/config/upload`.
- Releases and operators in the output equal the registry's tags and catalog
  content (asserted by value).
- Partial failures produce warnings, not 500s.
- `npm run lint`, `npm test`, `npm run build` pass.

## Open risks

- **Unverified layout.** Repo names and tags are from knowledge of oc-mirror v2;
  no real mirrored registry was available. First implementation task is to
  validate against one.
- **Catalog enumeration** depends on `/v2/_catalog` or on standard names; custom
  catalog names need the manual `catalogs[]` override.
