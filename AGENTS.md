<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Project architecture

- Keep this MVP frontend-only with mocked browser data (AI, tracker counts), because real sync and accounts will be integrated later.
- Persist browser state only through `src/features/browser/persistence/` (`BrowserStore`): the web preview uses localStorage (`agzos-state`), the desktop app uses SQLite in the main process (`electron/db.cjs`, `node:sqlite`, no native modules). Schema changes go in as new entries of `MIGRATIONS`; never edit an applied migration.
- Browser actions live in `src/features/browser/commands.ts`; shortcuts, the web context menu and the native Electron menu (`electron/main.cjs`) all use those command IDs. Tab state changes go through the pure reducer in `store/reducer.ts`.
- Every file the main process `require`s must be listed in `ELECTRON_FILES` in `scripts/build-all.sh`, which ships `electron/*.cjs` without `node_modules`.
- Before pushing, run `bun run lint`, `bun run typecheck`, `bun run test` and the e2e suites (`bun run test:e2e:web`; `xvfb-run -a bun run test:e2e:desktop` on Linux without a display). Plans per version live in `docs/prd/`.
- Keep Electron isolated under `electron/`, load a prepared static bundle from `dist/`, and preserve context isolation with Node integration disabled for desktop security.
- Network interception goes through the single per-session pipeline in `electron/main.cjs` (`session-created`): Electron keeps only one listener per `webRequest` event, so never register a second `onBeforeSendHeaders`/`onHeadersReceived`/`onBeforeRequest`; extend the existing ones. Adblock lives in `electron/adblock.cjs`; its engine is bundled into `electron/adblocker.vendor.cjs` by `bun run desktop:build`.
- Keep the Chrome identity in `electron/main.cjs` (`applyChromeIdentity`, `chromePageShim`, session Client Hints): without it Google rejects sign-in inside tabs. Read `docs/login-google-desktop.md` before changing it.
