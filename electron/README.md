# Agzos Browser desktop

The desktop shell wraps the current mocked interface without adding accounts or Cloud services. Tabs, preferences and quick links are stored in a local SQLite database (`userData/agzos.db`, see `db.cjs`); the Agzos Key vault stays in a `safeStorage`-encrypted file. On first launch after 1.3.x, the state left in the app's localStorage is migrated into SQLite.

Since 1.5 the main process also runs:

- `adblock.cjs` + `adblock-worker.cjs`: real ad/tracker blocking with `@ghostery/adblocker` (EasyList, EasyPrivacy, EasyList Brasil), compiled in a worker thread and cached in `userData/adblock/`. The engine is bundled into `adblocker.vendor.cjs` by `bun run desktop:build` (no `node_modules` in the app). Blocking uses only `onBeforeRequest`; the Chrome-identity handlers keep `onBeforeSendHeaders`/`onHeadersReceived` (one listener per event per session).
- `downloads.cjs`: `will-download` for every session, unique names in the Downloads folder, progress events, history in SQLite (private-tab downloads stay in memory).
- `zoom.cjs`: Chrome zoom steps; per-host zoom persisted in `site_settings`.

Since 1.7 (app 1.5.0):

- `windows.cjs`: several windows; each window's tabs and bounds are saved continuously in `meta:windows`, plus a run marker (`meta:running`) that detects an unclean exit (restore notice, safe mode when it crashed during the first minute).
- `hibernate.cjs`: rules for hibernating hidden tabs (the page is closed and later restored with its navigation history).

Test-only environment variables: `AGZOS_USER_DATA`, `AGZOS_DOWNLOADS_DIR`, `AGZOS_FILTER_LISTS` (JSON `{ "ads": [url], "privacy": [url] }`), `AGZOS_HIBERNATE_AFTER_MS`, `AGZOS_HIBERNATE_CHECK_MS`, `AGZOS_STABLE_AFTER_MS`.

## Development

Run the web preview, then open a second terminal:

```bash
bun run dev
bun run desktop:dev
```

## Local production build

```bash
bun run desktop:build
bun run desktop:start
```

## Linux x64 package

```bash
bun run desktop:package:linux
```

The unpacked application is created under `electron-release/Agzos Browser-linux-x64/`.
