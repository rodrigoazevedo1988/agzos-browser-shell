# Agzos Browser desktop

The desktop shell wraps the current mocked interface without adding accounts or Cloud services. Tabs, preferences and quick links are stored in a local SQLite database (`userData/agzos.db`, see `db.cjs`); the Agzos Key vault stays in a `safeStorage`-encrypted file. On first launch after 1.3.x, the state left in the app's localStorage is migrated into SQLite.

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
