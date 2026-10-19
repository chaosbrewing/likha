# Origin Studio architecture (Phase 4)

## Packages

| Package | Runs in | Purpose | Depends on |
|---|---|---|---|
| `@studio/contracts` | anywhere | Shared types and constants: `StudioHostApi`, IPC channel names, workspace/terminal types, `Result`/error codes, ORIGIN integration interfaces | — |
| `@studio/core` | anywhere | Pure logic: project-name and file-name validation, project configuration checks, starter templates | — |
| `@studio/workspace` | Node.js | Safe filesystem access for one workspace (`WorkspaceService`), project scaffolding (`scaffoldProject`, shared by `chaos init` and New Project), change watching (`watchWorkspace`), project inspection, Git branch, safe npm script names | contracts, core |
| `@studio/editor` | anywhere | Editor state independent of React, Monaco and Electron: open tabs, unsaved changes, disk versions, language mapping | contracts |
| `@studio/origin-adapter` | anywhere | Offline ORIGIN adapters used today, plus test mocks | contracts |
| `@studio/cli` (`apps/cli`) | Node.js | The `chaos` command | core, workspace |
| `@studio/ide` (`apps/ide`) | Electron | Desktop IDE: `electron/` (host) and `src/` (interface) | all of the above |

Rules:

- The interface (`apps/ide/src`) never imports Electron or Node.js. It talks to its host only through `StudioHostApi` (`window.studio`), so it can later run on a different host (browser, ORIGIN).
- Filesystem and process work happens only in the Electron main process, through `@studio/workspace` and the terminal manager.
- The CLI and the IDE share validation, templates and project inspection; the IDE does not call `chaos` for its own operations.

## Process model

```text
┌──────────────────────── Electron main process (trusted) ────────────────────────┐
│ main.ts        lifecycle, window, state persistence, logging, close guard       │
│ app-protocol   serves the built interface at app://studio with a strict CSP      │
│ ipc.ts         one handler per channel: sender check → argument parser → service │
│ WorkspaceService (@studio/workspace)   all file access, bounded to the workspace │
│ TerminalManager + node-pty             shells from an allowlist only             │
└──────────────────────────────▲──────────────────────────────────────────────────┘
                               │ ipcRenderer.invoke / webContents.send (fixed channels)
┌──────────────────────────────┴── preload.cjs (sandboxed) ───────────────────────┐
│ contextBridge.exposeInMainWorld("studio", StudioHostApi)                         │
└──────────────────────────────▲──────────────────────────────────────────────────┘
┌──────────────────────────────┴── Renderer (sandboxed, no Node.js) ──────────────┐
│ React app: Explorer · EditorPane (Monaco) · TerminalPanel (xterm.js)             │
│            BottomPanel (Terminal | Output | Problems) · StatusBar · dialogs      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Security model

| Boundary | Control |
|---|---|
| Renderer privileges | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (and `app.enableSandbox()`), `webSecurity: true`; DevTools only in development |
| Loaded content | Production interface served from `app://studio` by a protocol handler confined to `dist/renderer`; CSP `script-src 'self'`, no remote origins, no `unsafe-eval` |
| Navigation | `will-navigate` and `will-attach-webview` blocked, `window.open` denied, all permission requests denied |
| IPC senders | Every handler checks the sender is the main window's main frame at `app://studio` (or the local dev server in development) |
| IPC arguments | Each channel has a parser (`ipc-validation.ts`): exact argument count, types, lengths, integer ranges; anything else is `INVALID_ARGUMENT` |
| Paths | Only workspace-relative `/` paths cross IPC. `WorkspaceService` rejects `..`, absolute, drive-letter, UNC, NUL and `:` (NTFS stream) paths, resolves symbolic links and junctions with `realpath`, and refuses anything outside the workspace |
| Overwrites | Saves carry the file version the editor loaded; a different file on disk is a `CONFLICT` the user must resolve. New files are created with "create only" semantics |
| Corruption | Saves write a temporary file and rename it over the target; app settings are written the same way |
| Deletes | Require `confirmed === true` (sent only after a confirmation dialog) and go to the Recycle Bin via `shell.trashItem` |
| Terminal | The interface picks a shell id from an allowlist (`pwsh`, `powershell`, `cmd`; `bash`/`zsh`/`sh` elsewhere); no executable path or arguments come from the interface. Commands only run when the user types them or clicks **Run** on a package script (names with shell metacharacters are not offered). All shells are ended when the window closes |
| Network | None. Monaco workers, fonts and grammars are bundled; no telemetry |

## External changes

`watchWorkspace` (main process, `fs.watch` recursive) batches change notifications and sends
workspace-relative paths over `workspace:changed`. The interface reloads only the explorer
folders that are visible and affected, refreshes project info when `package.json` or
`.git/HEAD` changed, and compares each open tab's `diskVersion` with the file on disk:

| Open tab state | Disk changed | Disk deleted |
|---|---|---|
| No unsaved edits | Replaced with the disk content | Notice: "deleted or moved", with Close Tab |
| Unsaved edits | Notice: Reload from Disk / Keep My Version; Save still runs the conflict check | Notice; Save recreates the file |

A save in progress is never treated as an external change.

## Release packaging

`apps/ide/scripts/package.mjs` stages `dist/` plus `node-pty` (the only runtime dependency
that is not bundled) in `release/app`, then runs electron-builder for the NSIS installer and
a portable folder. Hardening applied to the packaged executable:

| Control | Setting |
|---|---|
| Electron fuses | `runAsNode` off, `NODE_OPTIONS` ignored, `--inspect` disabled, `onlyLoadAppFromAsar` on, `embeddedAsarIntegrityValidation` on, `cookieEncryption` on, file:// extra privileges off |
| Native code | `node-pty` is unpacked from the asar (`asarUnpack`); only `win32-x64` prebuilds ship |
| Installer | NSIS, per-user (`%LocalAppData%\Programs\OriginStudio`), no elevation, uninstaller registered under HKCU |
| Signing | Only when electron-builder's `WIN_CSC_*` variables are set; never from the repository |

The packaged executable is smoke-tested over the Chrome DevTools Protocol
(`apps/ide/e2e/packaged.test.ts`), because the fuses block Playwright's normal Electron attach.

## Persistence

`%AppData%\Origin Studio\app-state.json` stores window bounds/maximized state and the last workspace folder (validated against current displays on start). Logs are in `%AppData%\Origin Studio\logs\main.log`.

## Testing layers

| Layer | Location | What it proves |
|---|---|---|
| Core, workspace, editor, adapters | `packages/*/test` | Validation, path safety, symbolic links, conflicts, permissions, editor state, ORIGIN contracts |
| CLI | `apps/cli/test` | The compiled `chaos` command (Phase 3) still works |
| IDE host | `apps/ide/test` | IPC parsers and sender trust, CSP, preload/handler coverage, terminal lifecycle (including a real shell through node-pty), window state, shortcuts |
| End-to-end | `apps/ide/e2e` | The built desktop app: open project, edit and save, conflict guard, binary refusal, create/rename/delete, terminal command, unsaved-changes close prompt, reopen after restart |
