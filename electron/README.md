# Agzos Browser desktop

The desktop shell wraps the current mocked interface without adding accounts, Cloud services, or a database. Tabs and theme preferences continue to use local browser storage.

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