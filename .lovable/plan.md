# Electron desktop shell

## Goal
Prepare the current Agzos Browser interface to run as a local desktop application while preserving the mocked, local-only experience.

## Changes
- Add an isolated Electron main process that opens the packaged interface in a secure desktop window.
- Configure the production bundle for local `file://` loading so styles and assets work offline.
- Add desktop development, build, run, and Linux packaging commands.
- Keep all existing state in browser `localStorage`; do not add Cloud, authentication, APIs, or a database.
- Document the desktop workflow and generated package location.

## Technical details
- Electron uses CommonJS for its main process, with context isolation enabled and Node integration disabled.
- Desktop packaging uses Electron Packager and excludes source/dependency folders from the distributable.
- The web preview remains available through the existing development command.

## Verification
- Build the desktop bundle.
- Package a Linux x64 application.
- Inspect the package contents and verify the generated page uses relative asset paths.
