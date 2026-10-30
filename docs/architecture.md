# LIKHA architecture (Phase 6)

## Packages

| Package | Runs in | Purpose | Depends on |
|---|---|---|---|
| `@studio/contracts` | anywhere | Shared types and constants: `StudioHostApi`, IPC channel names, workspace/terminal/language types, `Result`/error codes, ORIGIN integration interfaces | — |
| `@studio/core` | anywhere | Pure logic: project-name and file-name validation, project configuration checks, starter templates | — |
| `@studio/workspace` | Node.js | Safe filesystem access for one workspace (`WorkspaceService`), project scaffolding (`scaffoldProject`, shared by `likha init` and New Project), change watching (`watchWorkspace`), project inspection, Git branch, safe npm script names, source-file listing for project-wide checks | contracts, core |
| `@studio/editor` | anywhere | Editor state independent of React, Monaco and Electron: open tabs, unsaved changes, disk versions, language mapping | contracts |
| `@studio/origin-adapter` | anywhere | ORIGIN adapters: the offline set used by default; the connection lifecycle (`OriginConnection`), the mock and HTTP transports, the link-file ORIGIN Core adapter v2 and the mock sector adapters (behind the `origin-core` flag) | contracts |
| `@studio/cli` (`apps/cli`) | Node.js | The `likha` command | core, workspace |
| `@studio/ide` (`apps/ide`) | Electron | Desktop IDE: `electron/` (host) and `src/` (interface) | all of the above |

Rules:

- The interface (`apps/ide/src`) never imports Electron or Node.js. It talks to its host only through `StudioHostApi` (`window.studio`), so it can later run on a different host (browser, ORIGIN).
- Filesystem and process work happens only in the Electron main process, through `@studio/workspace`, the terminal manager and the language-server manager.
- The CLI and the IDE share validation, templates and project inspection; the IDE does not call `likha` for its own operations.

## Process model

```text
┌──────────────────────── Electron main process (trusted) ────────────────────────┐
│ main.ts        lifecycle, window, state persistence, logging, close guard,       │
│                feature flags, ORIGIN adapters, manual update check               │
│ app-protocol   serves the built interface at app://studio with a strict CSP      │
│ ipc.ts         one handler per channel: sender check → argument parser → service │
│ WorkspaceService (@studio/workspace)   all file access, bounded to the workspace │
│ TerminalManager + node-pty             shells from an allowlist only             │
│ LanguageServerManager                  owns the TypeScript server process        │
└───────────▲──────────────────────────────────────────────▲──────────────────────┘
            │ ipcRenderer.invoke / webContents.send         │ JSON-RPC over stdio (LSP)
            │ (fixed channels)                              │
┌───────────┴─────── preload.cjs (sandboxed) ──────┐  ┌─────┴──────────────────────┐
│ contextBridge.exposeInMainWorld("studio", api)    │  │ tsc.exe --lsp --stdio      │
└───────────▲──────────────────────────────────────┘  │ (native TypeScript 7)      │
┌───────────┴────── Renderer (sandboxed, no Node.js) ─────┐  one per workspace;     │
│ React app: Explorer · EditorPane (Monaco) · Terminal     │  ended with the window │
│ BottomPanel (Terminal | Output | Problems) · StatusBar   └────────────────────────┘
│ useLanguageService: document sync, markers, providers    │
└──────────────────────────────────────────────────────────┘
```

## Security model

| Boundary | Control |
|---|---|
| Renderer privileges | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (and `app.enableSandbox()`), `webSecurity: true`; DevTools only in development |
| Loaded content | Production interface served from `app://studio` by a protocol handler confined to `dist/renderer`; CSP `script-src 'self'`, no remote origins, no `unsafe-eval` |
| Navigation | `will-navigate` and `will-attach-webview` blocked, `window.open` denied, all permission requests denied |
| IPC senders | Every handler checks the sender is the main window's main frame at `app://studio` (or the local dev server in development) |
| IPC arguments | Each channel has a parser (`ipc-validation.ts`): exact argument count, types, lengths, integer ranges, tagged request kinds; anything else is `INVALID_ARGUMENT` |
| Paths | Only workspace-relative `/` paths cross IPC. `WorkspaceService` rejects `..`, absolute, drive-letter, UNC, NUL and `:` (NTFS stream) paths, resolves symbolic links and junctions with `realpath`, and refuses anything outside the workspace. The language-server manager applies the same path rules before building a `file://` URI, and maps every URI the server returns back to a workspace path (locations outside the workspace, such as the bundled `lib.*.d.ts`, are dropped) |
| Overwrites | Saves carry the file version the editor loaded; a different file on disk is a `CONFLICT` the user must resolve. New files are created with "create only" semantics |
| Corruption | Saves write a temporary file and rename it over the target; app settings are written the same way |
| Deletes | Require `confirmed === true` (sent only after a confirmation dialog) and go to the Recycle Bin via `shell.trashItem` |
| Terminal | The interface picks a shell id from an allowlist (`pwsh`, `powershell`, `cmd`; `bash`/`zsh`/`sh` elsewhere); no executable path or arguments come from the interface. Commands only run when the user types them or clicks **Run** on a package script (names with shell metacharacters are not offered). All shells are ended when the window closes |
| Language server | Started by the host from a fixed location with fixed arguments; the interface never names an executable. It only ever hears about documents the interface opened; server-internal completion data (which holds absolute paths) stays in the host and is referenced by token and index. Server requests to change files (`workspace/applyEdit`) are refused: edits only come from the user. The process is ended when the window closes |
| ORIGIN | Off by default. With the `origin-core` flag: the credential is typed once in the interface, crosses IPC as one bounded line (`origin:connect`), is verified with ORIGIN before it is stored, and is stored encrypted with the OS user key (`safeStorage`) in the settings folder, never in a project. The interface only ever receives connection states (no secret), and the log never contains the key. A rejected key is forgotten; an unreachable ORIGIN keeps it. Every adapter call is a read. The link file is read through `WorkspaceService` (same confinement as any file), validated, and never written; ORIGIN's record, not the file, is the source of truth. The HTTP transport accepts https only (http for localhost) and sends the key as a bearer header, never in a URL |
| Updates | Only on **Help > Check for Updates…**, only in the installed app, and only when a feed was baked in at packaging time (`ORIGIN_STUDIO_UPDATE_URL`, https). Download and install each need a confirmation; the install runs when the app quits, after the usual unsaved-changes guard |
| Network | None by default. Monaco workers, fonts and grammars are bundled; no telemetry. The only network call LIKHA can make is the update check the user asks for |

## Language server

`apps/ide/electron/language-server.ts` runs the native TypeScript compiler as a language
server (`tsc --lsp --stdio`, TypeScript 7) in a child process of the main process:

- One server per workspace, started after the folder opens, replaced when another folder opens,
  ended with the window (`terminate()` on close and quit; a graceful shutdown handshake when
  switching). Starts and stops are serialized so two folders opened in quick succession never
  leave two servers running.
- `lsp-connection.ts` is a small JSON-RPC client (Content-Length framing, request timeouts,
  server-initiated requests). `lsp-convert.ts` turns LSP answers into the plain contract types
  the interface understands (`@studio/contracts` `language.ts`): zero-based positions, relative paths.
- Document sync: the interface sends `didOpen` with the full text when a TypeScript or
  JavaScript tab opens, Monaco's incremental changes as `didChange`, and `didClose`. Files
  that are not open are read by the server from disk; it watches the folder itself.
- Diagnostics are pulled (`textDocument/diagnostic`): for an open file 300 ms after an edit,
  shown as Monaco markers; for the whole project after start-up and 1.5 s after any change on
  disk (`listSourceFiles` walks the workspace, skipping `node_modules`, build output and
  hidden folders, up to 2000 files). The Problems view shows open files from markers and all
  other files from the latest project check.
- Providers registered in the interface (`useLanguageService.ts`): completion with resolve,
  hover, Go to Definition, references, signature help. Results in files that are not open use
  read-only "shadow" models (`origin-file:` URIs, at most 40) so peek views can show them;
  opening such a location goes through the normal tab flow.
- While the server is ready, Monaco's own TypeScript worker keeps only formatting, symbols,
  highlights and rename; when it is not (platform without the binary, crash), the worker
  returns to full service with the open-files-only behaviour of Phase 4.
- The server is the one LIKHA was built with, shipped with the app
  (`resources/typescript`: `tsc.exe` plus its `lib.*.d.ts`), not the project's own `typescript`.

## External changes

`watchWorkspace` (main process, `fs.watch` recursive) batches change notifications and sends
workspace-relative paths over `workspace:changed`, and tells the language-server manager to
re-check the project. The interface reloads only the explorer folders that are visible and
affected, refreshes project info when `package.json`, `.git/HEAD` or `.origin/project.json`
changed, and compares each open tab's `diskVersion` with the file on disk:

| Open tab state | Disk changed | Disk deleted |
|---|---|---|
| No unsaved edits | Replaced with the disk content | Notice: "deleted or moved", with Close Tab |
| Unsaved edits | Notice: Reload from Disk / Keep My Version; Save still runs the conflict check | Notice; Save recreates the file |

A save in progress is never treated as an external change.

## ORIGIN connection

With the `origin-core` flag, `setUpOrigin` in `main.ts` assembles: the transport named in
`origin.json` (`mock`, `http`, or `none`), the credential vault (`origin-vault.ts`), one
`OriginConnection` (`@studio/origin-adapter`) and the adapter set (ORIGIN Core v2 over the
transport; mock sector adapters). The connection restores a stored credential in the
background at start-up; every state change is pushed to the interface over
`origin:connection-changed`, which re-reads the workspace description so the link's
verification follows the connection. Menu commands `origin-connect`, `origin-disconnect` and
`origin-refresh` are handled by the interface (prompt, confirmation) and call the host's
`origin:*` channels. Details, states, fixtures and what was verified about ORIGIN are in
[integration/README.md](integration/README.md).

## Shutdown

Quitting must leave nothing asynchronous in flight: a child-process request still pending
when Electron tears down its event loop aborts the process (Windows exit code 0xC0000409, seen
in about half of the closes after a terminal had been used). `TerminalManager.killAll({ wait:
true })` therefore runs `taskkill` synchronously, and `LanguageServerManager.terminate()` ends
the server process at once instead of scheduling a kill. Normal terminal tab closes keep the
asynchronous path.

## Feature flags

`apps/ide/electron/features.ts` reads `%AppData%\Origin Studio\features.json` (an object of
booleans keyed by flag name) and the `ORIGIN_STUDIO_FEATURES` environment variable (a
comma-separated list that turns flags on, used by tests). Every flag is off by default. The
only flag today is `origin-core`.

## Release packaging

`apps/ide/scripts/package.mjs` stages `dist/` plus `node-pty` (the only runtime dependency
that is not bundled) in `release/app`, then runs electron-builder for the NSIS installer and
a portable folder. Hardening applied to the packaged executable:

| Control | Setting |
|---|---|
| Electron fuses | `runAsNode` off, `NODE_OPTIONS` ignored, `--inspect` disabled, `onlyLoadAppFromAsar` on, `embeddedAsarIntegrityValidation` on, `cookieEncryption` on, file:// extra privileges off |
| Native code | `node-pty` is unpacked from the asar (`asarUnpack`); only `win32-x64` prebuilds ship |
| Language server | `tsc.exe` and its `lib.*.d.ts` files are copied to `resources/typescript` (`extraResources`), outside the asar, with the TypeScript license and notice |
| Installer | NSIS, per-user (`%LocalAppData%\Programs\LIKHA`), no elevation, uninstaller registered under HKCU |
| Signing | Only when electron-builder's `WIN_CSC_*` variables are set; never from the repository. `ORIGIN_STUDIO_PUBLISHER_NAME` additionally makes the updater accept only updates signed by that publisher |
| Update feed | Only when `ORIGIN_STUDIO_UPDATE_URL` (https) is set: electron-builder writes `resources/app-update.yml` into the app and `latest.yml` next to the installer. Nothing is uploaded by the build |

The packaged executable is smoke-tested over the Chrome DevTools Protocol
(`apps/ide/e2e/packaged.test.ts`), because the fuses block Playwright's normal Electron attach.
That test also checks that the shipped language server starts under the fuses.

## Persistence

`%AppData%\Origin Studio\app-state.json` stores window bounds/maximized state and the last workspace folder (validated against current displays on start). `features.json` in the same folder holds feature flags, `origin.json` the ORIGIN transport, and `origin-credential.bin` the encrypted ORIGIN credential (present only while connected). Logs are in `%AppData%\Origin Studio\logs\main.log`.

## Continuous integration

`.github/workflows/ci.yml` runs on a Windows runner: `npm ci`, `npm run typecheck`, `npm test`,
`npm run test:e2e`, `npm run package` and `npm run test:package`, and uploads the unsigned
installer as a build artifact.

## Testing layers

| Layer | Location | What it proves |
|---|---|---|
| Core, workspace, editor, adapters | `packages/*/test` | Validation, path safety, symbolic links, conflicts, permissions, editor state, source-file listing, ORIGIN contracts and the link-file adapter |
| CLI | `apps/cli/test` | The compiled `likha` command (Phase 3) still works |
| IDE host | `apps/ide/test` | IPC parsers and sender trust, CSP, preload/handler coverage, terminal lifecycle (including a real shell through node-pty), the language server (JSON-RPC framing, LSP conversions, and the real `tsc --lsp` on a temporary project: cross-file diagnostics, hover, definition, references, completion, project check, clean stop), feature flags, the update flow (with a fake updater), window state, shortcuts |
| End-to-end | `apps/ide/e2e` | The built desktop app: open project, edit and save, conflict guard, binary refusal, create/rename/delete, terminal command, unsaved-changes close prompt, reopen after restart, project-wide Problems and Go to Definition across files, the ORIGIN link through the feature flag |
