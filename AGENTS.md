## Project Overview

This is the `mirror-gui` repository — a web-based interface for managing OpenShift Container Platform mirroring operations using oc-mirror v2. It provides a visual configuration builder, operation execution with real-time monitoring, and environment management.

Mirror-GUI is a TypeScript application with two layers:
- **Frontend**: React 18 single-page application using PatternFly 6, built with Vite
- **Backend**: Express server (Node.js 22) that wraps the oc-mirror v2 CLI and serves the REST API

### How it works

The backend spawns `oc-mirror` as a child process to perform mirror-to-disk operations. Operator catalog metadata is pre-fetched at build time (via `sync-catalogs.sh`) and bundled into the container image, enabling offline browsing of operators, channels, and dependencies. The frontend communicates with the backend via a REST API, and live operation logs are streamed via Server-Sent Events (SSE).

### Key components

| Component | Location | Purpose |
|-----------|----------|---------|
| Express API server | `server/index.ts` | REST API, operation management, catalog data serving |
| Server utilities | `server/utils.ts` | Shared helpers (version parsing, catalog name resolution, channel normalization) |
| Catalog channel parser | `server/catalogChannels.ts` | Extracts channel objects from pre-fetched catalog metadata |
| Path availability checker | `server/pathAvailability.ts` | Validates filesystem paths for mirror destinations |
| Operation modes | `server/operationModes.ts` | Mirror modes, labels, and destination registry validation (shared with the UI, so no Node imports) |
| oc-mirror argv builder | `server/ocMirrorArgs.ts` | Builds the oc-mirror command line for mirror-to-disk, mirror-to-mirror, and disk-to-mirror |
| Registry credentials | `server/registryCredentials.ts` | Destination registry credential storage, auth file validation, and pull secret merging |
| React app entrypoint | `src/App.tsx` | App shell with PatternFly layout, routing, theme/alert providers |
| Dashboard | `src/components/Dashboard.tsx` | System overview, stats, recent operations |
| Mirror Configuration | `src/components/MirrorConfig.tsx` | Visual ImageSetConfiguration builder |
| Mirror Operations | `src/components/MirrorOperations.tsx` | Operation execution and monitoring |
| History | `src/components/History.tsx` | Past operation review and CSV export |
| Settings | `src/components/Settings.tsx` | Pull secret, registry, cache, and catalog sync management |
| Catalog sync script | `sync-catalogs.sh` | Fetches operator catalog metadata from registry.redhat.io |
| Local build script | `local-build.sh` | Container build and run orchestration |

### Local container workflow

```bash
podman build -t localhost/mirror-gui .
IMAGE_NAME=localhost/mirror-gui ./mirror-gui.sh
```

`local-build.sh` wraps both steps; the manual path above is useful when iterating on the image or passing custom flags.

## Common Development Commands

### Setup

```bash
npm ci          # install dependencies
npm run dev     # start development server (Express + Vite HMR)
```

### Building

```bash
npm run build   # TypeScript compile + Vite production build
```

### Testing

```bash
npm test              # unit and integration tests (Vitest)
npm run test:coverage # tests with coverage report
npm run test:e2e      # end-to-end tests (Playwright)
npm run test:all      # all tests
```

### Linting

```bash
npm run lint      # ESLint check
npm run lint:fix  # ESLint auto-fix
```

## Contributing

1. Write understandable code. Always prefer clarity over other things.
2. Write comments and documentation in English.
3. Write tests for your code — unit/integration tests for backend, E2E tests for UI workflows.
4. When instructed to fix tests, do not remove or modify existing tests.
5. Run `npm run lint` before committing files.
6. Follow existing PatternFly patterns for UI components.
7. API changes should be reflected in [API.md](API.md).
