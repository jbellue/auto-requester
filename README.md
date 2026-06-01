# Auto Requester Browser Extension

Automatically sends HTTP requests to configured endpoints at regular intervals (e.g., to prevent session expiration).

**Compatible with:** Firefox, Chrome, and Edge

## Build instructions (for Mozilla reviewers)

### Requirements

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 18.x | Tested with 22.x. Download from https://nodejs.org |
| npm | 8.x | Bundled with Node.js |

**Operating system:** Linux, macOS, or Windows. No OS-specific build steps.

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Build the extension into dist/
npm run build
```

The `dist/` folder produced by step 2 is the extension that was packaged into the submitted XPI.

### Verification

```bash
# Type-check the source
npm run typecheck

# Run the test suite (138 tests)
npm test
```

### Build tooling used

| Tool | Purpose |
|------|---------|
| TypeScript 5.x (`tsc`) | Type checking |
| esbuild | Bundles and minifies `src/background.ts` and `src/popup.ts` into `dist/` |

No HTML or CSS template engines are used. HTML and CSS files in `src/` are copied to `dist/` verbatim by `scripts/build.cjs`.

---

## Development

```bash
# Watch mode — rebuilds on every save
npm run dev

# Run tests in watch mode
npm run test:watch

# Full pipeline watcher (typecheck → test → build → xpi)
npm run pipeline:watch
```

## Features

- Multi-endpoint configuration with independent settings
- Enable/disable individual endpoints without deleting
- Only sends requests when a matching tab is open
- Configurable check intervals (1–60 minutes)
- Custom HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Custom headers and request body support
- Persistent configuration via `browser.storage.sync`
- Cross-browser support (Firefox, Chrome, Edge)
