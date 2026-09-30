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
- Site permissions live in `electron/permissions.cjs` (SQLite `site_settings`, per origin). The permission _check_ handler must keep answering "allowed" for anything the user did not explicitly block: Google sign-in depends on it (see `docs/login-google-desktop.md`).
- The main process supports several windows: per-window state lives in a `ctx` (views, active tab, panel, fullscreen) found through `event.sender` in every IPC handler, and tab ids are per window (`tabOfContents` maps a page's `webContents.id` to its window and tab). Never reintroduce a global "main window"; broadcast app-wide events (downloads, adblock stats, updates) to every window. Window sessions and bounds live in `electron/windows.cjs` (`meta:windows`), not in the renderer's `session` section; shared sections are relayed to the other windows (`agzos:state-sync`).
- Toolbar panels (⋯ menu, downloads, privacy, site, bookmark, key) render in a transparent per-window `WebContentsView` above the page (`electron/chrome-overlay.cjs`, `dist/overlay.html`, `src/features/browser/overlay/`), so the page keeps painting; never hide the tab or `capturePage` for them. The shell sends a `PanelSpec` (data + function names) and the layer calls the shell back. The snapshot path is only the fallback, and it is still used for the omnibox list, the what's-new dialog and the non-layer switcher.
- 2.0 (workspaces, tab groups, split view, side panels): tabs carry `groupId`/`workspaceId` and the per-window session also stores `groups`, `workspaces` and `split` (`electron/windows.cjs` `validSession` passes them through; the renderer validates in `persistence/snapshot.ts`). The tab strip, Ctrl+Tab, Ctrl+1…9 and "close others" only see the active workspace (`workspaceTabs`). Split view: the main shows the two tabs of `ctx.split` with per-pane rects (`tab:bounds` with an id, `tab:split`); focusing the other pane emits a `focused` tab event. Side panels are per-window `WebContentsView`s in the default session (`sidepanel:*` IPC, `sidePanelOwner` for `ownerCtx`), laid out with the tabs and hidden with the snapshot fallback or fullscreen.
- Tab hibernation (`electron/hibernate.cjs`) closes a hidden tab's `WebContentsView` and restores it with `navigationHistory.restore`; keep its skip rules (audio, capture, pending permission, edited forms) when touching it.
- Every release adds an entry at the top of `src/features/browser/changelog.ts` with the version `scripts/build-all.sh` publishes: the "Atualizado com sucesso" dialog shows it after the update.
- Auto-update lives in `electron/updater.cjs` and reads the `latest.json` written by `scripts/release-browser.sh`; it never deletes files in the install folder (copies over it) and only runs packaged or with `AGZOS_UPDATE_URL`.
