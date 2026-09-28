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

- Keep this MVP frontend-only with mocked browser data persisted in localStorage, because real sync, accounts, and desktop SQLite will be integrated later.
- Keep Electron isolated under `electron/`, load a prepared static bundle from `dist/`, and preserve context isolation with Node integration disabled for desktop security.
