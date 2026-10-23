# Origin Studio

Origin Studio is a development platform and desktop IDE being built under Chaos Origins.
This npm-workspaces monorepo contains:

- **Origin Studio IDE**: a Windows desktop editor (Electron, React, Monaco, xterm.js). It
  opens a local project, edits and saves files, manages files and folders, runs commands
  in an integrated terminal, and understands the whole project through a TypeScript
  language server.
- **`chaos`**: the command-line tool that creates and inspects Origin Studio projects.
- Shared packages that both apps build on.

Everything runs locally. No ORIGIN account or internet connection is needed.

## Origin Studio IDE

### Install it (Windows)

```powershell
npm install
npm run build
npm run package
```

This produces `apps/ide/release/dist/OriginStudio-Setup-<version>.exe`, a per-user installer
(no administrator rights needed), and `apps/ide/release/dist/win-unpacked/OriginStudio.exe`,
a portable copy. The installer puts the app in `%LocalAppData%\Programs\OriginStudio`, adds Start Menu and
desktop shortcuts, and registers an uninstaller in **Settings > Apps** ("Origin Studio").
Settings and logs live in `%AppData%\Origin Studio`; the uninstaller leaves them in place. It is
not code-signed, so Windows SmartScreen shows a warning on first run; see
[Code signing](#code-signing).

### Start it from the checkout

```powershell
npm install
npm run build
npm run ide
```

`npm run ide` starts the built app. It reopens the last folder you had open; otherwise it
shows a welcome screen with **Open Folder…**. To open a specific folder at launch:

```powershell
npm run ide -- --folder=C:\path\to\project
```

For development with hot reload of the interface:

```powershell
npm run ide:dev
```

Changes under `apps/ide/electron` need a restart of `ide:dev`.

### What it does

| Area | Features |
|---|---|
| Workspace | Open Folder (Ctrl+O) and **New Project** (File menu or the welcome screen), which creates the same starter as `chaos init` and opens it. Reopens the last folder. The status bar shows the folder, whether it is a valid Origin Studio project, and the Git branch |
| Watching | Changes made by other programs are picked up: the explorer updates by itself, an open file without unsaved edits follows the disk, and a file with unsaved edits shows a notice with **Reload from Disk** / **Keep My Version**. A file deleted outside the IDE is reported in its tab |
| Explorer | Folder tree with expand/collapse and keyboard navigation (arrows, Enter, F2 to rename, Del to delete). New File, New Folder, Rename, Delete, Refresh and Collapse All. Unsaved files are marked |
| Editor | Monaco: tabs, syntax highlighting, line numbers, find (Ctrl+F), unsaved-change indicators. Save (Ctrl+S), Save As (Ctrl+Shift+S), Save All, Close Tab (Ctrl+W), Ctrl+Tab to switch tabs |
| TypeScript intelligence | A project-wide TypeScript language server (see [below](#typescript-intelligence)) for TypeScript and JavaScript files: errors across files, completion with details, hover, Go to Definition (F12), Peek (Alt+F12), Find All References (Shift+F12), signature help. The status bar shows the server's state |
| Safety | Saves are checked against the version on disk. If another program changed the file, you choose Overwrite, Reload from Disk or Cancel. Binary, non-UTF-8 and >5 MB files are not opened. Closing a tab or the app with unsaved changes asks first. Deletes ask first and go to the Recycle Bin. Names are validated (Windows-reserved names and characters are rejected), and create or rename never overwrites anything |
| Terminal | Real shells through node-pty: PowerShell 7, Windows PowerShell and Command Prompt. Multiple sessions, resize and kill. Terminals open in the project folder. **Run** executes a `package.json` script (`npm run <name>`). All shells end when the app closes |
| Panels | Terminal, Output (activity log) and Problems (diagnostics for the whole project, open or not; click one to jump to it) |
| ORIGIN (preview) | Behind the `origin-core` feature flag: a folder is linked to an ORIGIN project through a read-only link file, and the status bar shows the link. See [Feature flags](#feature-flags) |
| Updates | **Help > Check for Updates…** checks a release feed only when you ask, and only for builds packaged with one. See [Updates](#updates) |
| Window | Size, position and maximized state are remembered and kept on a visible screen |

The `chaos` CLI works in the integrated terminal as in any other terminal. In a Windows
PowerShell 5.1 terminal, use `chaos.cmd` if the execution policy blocks `chaos` (the
terminal prints this hint). PowerShell 7 terminals are not affected. Origin Studio never
changes the execution policy.

### TypeScript intelligence

When a folder opens, Origin Studio starts the native TypeScript 7 compiler as a language
server (`tsc --lsp`) for it, in a separate process that ends with the window. The server
reads the project's `tsconfig.json` and files from disk, and the editor keeps it informed
about the files you have open, so:

- Errors are reported for every source file in the project, not only open ones. The Problems
  view lists them all; "Cannot find module" and other cross-file errors are real errors again.
- Completion, hover, Go to Definition (F12), Peek Definition (Alt+F12), Find All References
  (Shift+F12) and signature help work across files and into `node_modules` types.
- The status bar shows **TypeScript <version>** while the server runs. If it is not
  available (another platform, or the process stopped), the status bar says so and the editor
  falls back to Monaco's built-in worker, which only sees open files.

The server is the TypeScript build Origin Studio ships with, not the one in the project's
`node_modules`. Project-wide checks cover up to 2000 source files (`node_modules`, build
output and hidden folders are skipped); larger projects are told that only the first files
were checked.

### Feature flags

Work that is not part of the default experience yet is off unless you turn it on. Create
`%AppData%\Origin Studio\features.json`:

```json
{ "origin-core": true }
```

or set `ORIGIN_STUDIO_FEATURES=origin-core` (a comma-separated list) when starting the app.
The log line `Starting Origin Studio …; features: …` shows what is on.

**`origin-core`** — the first ORIGIN Core adapter. A folder is linked to an ORIGIN project
when it contains `.origin/project.json`:

```json
{ "projectId": "proj_42", "name": "Binhi Site", "ownerId": "user_1", "permissions": ["read"], "revision": 7 }
```

The status bar then shows **ORIGIN: <name>** (hover for the id and revision), **ORIGIN: not
linked** without a link file, or **ORIGIN: link invalid** when the file cannot be read. The
link is read-only: Origin Studio never writes to ORIGIN, never changes the link file, and
needs no account or network for it. A link file that appears or changes while the folder is
open is picked up at once. Without the flag the status bar shows **Local**, as before. The
adapter contract and what a real ORIGIN transport must do are in
[docs/integration/README.md](docs/integration/README.md).

### Updates

**Help > Check for Updates…** is the only time Origin Studio contacts the network, and it
does nothing unless you choose it. It needs an update feed baked into the build:

```powershell
$env:ORIGIN_STUDIO_UPDATE_URL = "https://releases.example.com/origin-studio"
npm run package
```

The build then contains `resources/app-update.yml`, and `apps/ide/release/dist` contains
`latest.yml`, which must be uploaded next to the installer at that URL. The check compares
versions, asks before downloading, verifies the download's SHA-512 against `latest.yml`, and
asks again before installing; the installer runs when Origin Studio quits (after the usual
unsaved-changes prompt). Without a feed, the menu item says that this build has no update
feed configured. Development runs (`npm run ide`) cannot update.

Updates should only be enabled together with [code signing](#code-signing): with
`ORIGIN_STUDIO_PUBLISHER_NAME` set at packaging time, the updater refuses installers not
signed by that publisher. An unsigned feed relies on HTTPS and the checksum alone.

### App icon

The logo source is `apps/ide/build/logo.webp`. `npm run icon -w @studio/ide` regenerates
`build/icon.png`, `build/icon.ico` (16–256 px, for the executable and installer) and
`src/assets/logo.png` (shown in the title bar and welcome screen) from it. The outputs are
committed, so a normal build needs no image tooling. Replace `logo.webp` and re-run the
script to change the icon.

### Code signing

`npm run package` signs the installer and executables only when a certificate is configured
through electron-builder's standard variables (`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`,
or a certificate in the Windows certificate store selected with `WIN_CSC_SUBJECT_NAME`).
Without one, the build is unsigned and SmartScreen warns on first run. Signing needs a
publisher certificate that only Chaos Origins can obtain; nothing in the repository
contains or needs a key.

### Architecture and security

[docs/architecture.md](docs/architecture.md) describes the package boundaries, the process
model (including the language-server process), the security controls (sandboxed renderer,
isolated preload, validated IPC, workspace path confinement, strict CSP) and the release
hardening (Electron fuses, integrity-checked `app.asar`). ORIGIN connection points, and
the one adapter that exists, are in [docs/integration/README.md](docs/integration/README.md).

## The `chaos` CLI

`chaos` is the Origin Studio command-line tool. It can:

| Command | What it does |
|---|---|
| `chaos init <name>` | Creates a new folder `<name>` containing a minimal, runnable TypeScript project |
| `chaos status` | Shows the product, CLI version, Node.js version, current folder, and whether that folder is a valid Origin Studio project |
| `chaos help`, `chaos --help`, `chaos -h` | Shows available commands |
| `chaos version`, `chaos --version`, `chaos -v` | Prints the CLI version (read from `apps/cli/package.json`) |

Running `chaos` with no arguments shows help.

### `chaos init`

```powershell
chaos init my-project
```

creates:

```text
my-project/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

Then:

```powershell
cd my-project
npm install
npm run build
npm start      # prints: Hello from my-project!
```

Safety rules:

- Names must be a single folder name: lowercase letters, numbers, `-` and `_`, starting
  with a letter or number, at most 214 characters. Paths (`..\x`, `a/b`, `C:\x`) and Windows
  reserved names (`con`, `nul`, `com1`, …) are rejected.
- The project is always created directly inside the current folder.
- An existing folder is only used if it is empty. A non-empty folder or an existing file is
  never touched. Individual files are written with "create only" semantics, so nothing is
  ever overwritten.
- `chaos` never deletes files. If a write fails partway (for example, permission denied),
  the error lists what was created so you can decide what to do with it.

### Project configuration

A folder is an Origin Studio project when its `package.json` contains a valid
`originStudio` section and the expected files exist:

```json
"originStudio": { "schemaVersion": 1, "language": "typescript" }
```

`chaos status` and the IDE's status bar validate that section and check for
`package.json`, `tsconfig.json` and `src/index.ts`. Having a `package.json` is not enough.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (including `status` in a folder that isn't a project) |
| `1` | The command couldn't be completed, e.g. the target folder already exists or a filesystem error occurred |
| `2` | Usage error: unknown command or option, missing or invalid argument |

Errors are written to stderr and start with `Error:`.

### Installing the `chaos` command

Global link (recommended for development):

```powershell
npm install
npm run build
npm link -w @studio/cli
chaos --version
```

`npm link` adds `chaos`, `chaos.cmd` and `chaos.ps1` to your global npm folder
(`npm config get prefix`, usually `%AppData%\npm`) and points them at this checkout, so
rebuilding updates the command immediately. To remove it: `npm unlink -g @studio/cli`.

Project-local, with no global changes: after `npm install` and `npm run build`, run
`npm install` once more so npm links the newly built bin, then use `npx chaos status` or
`.\node_modules\.bin\chaos.cmd --version`.

### Windows PowerShell 5.1 and execution policy

npm creates a `chaos.ps1` shim, and PowerShell prefers it over `chaos.cmd`. Under
Windows' default `Restricted` execution policy, **Windows PowerShell 5.1** refuses to run it
(npm's own `npm.ps1` hits the same restriction). Any one of these works:

- Use **PowerShell 7** (`pwsh`), whose default policy (`RemoteSigned`) allows it.
- Run `chaos.cmd` instead of `chaos`, e.g. `chaos.cmd status`.
- Allow local scripts for your user account. This is your decision, because it changes a
  security setting: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

`cmd.exe` is not affected.

## Repository layout

```text
origin-studio/
├── apps/
│   ├── cli/                  @studio/cli: the `chaos` command
│   └── ide/                  @studio/ide: desktop IDE
│       ├── electron/         main process: window, menu, IPC, protocol, terminals, language server, updates, preload
│       ├── src/              interface (React): components/, features/ (editor, explorer, language, terminal, dialogs), hooks/, styles/
│       ├── scripts/          build and dev launchers (Vite + esbuild)
│       ├── test/             host unit tests
│       └── e2e/              end-to-end test of the built app (Playwright)
├── packages/
│   ├── contracts/            @studio/contracts: host API, IPC channels, shared types, ORIGIN interfaces
│   ├── core/                 @studio/core: validation, project config, starter templates
│   ├── workspace/            @studio/workspace: safe file operations, project inspection
│   ├── editor/               @studio/editor: tab and unsaved-change state, languages
│   └── origin-adapter/       @studio/origin-adapter: offline ORIGIN adapters, the link-file ORIGIN Core adapter, test mocks
├── docs/
│   ├── architecture.md
│   ├── integration/README.md
│   └── qa/                   acceptance test reports
├── .github/workflows/ci.yml  Windows CI: typecheck, unit tests, end-to-end, package, packaged smoke test
├── package.json              origin-studio (workspace root)
└── tsconfig.json             typecheck config for packages, CLI and IDE host
```

## Requirements

- Windows 10/11. The IDE and CLI are verified on Windows 11; other platforms are untested.
- Node.js 22.12 or newer for development (verified with Node.js 24.18.0 and npm 11.16.0).
- Network access for the first `npm install`, which downloads Electron (`install-electron`
  runs as the root `postinstall`).
- No global TypeScript, tsx or Electron needed.

## Development commands

From the repository root in PowerShell:

```powershell
npm install             # dependencies, workspace links, Electron binary
npm run build           # all packages, the CLI and the IDE (apps/ide/dist)
npm run typecheck       # packages, CLI, IDE host and IDE interface
npm test                # builds, then runs all unit tests (packages, CLI, IDE host)
npm run test:e2e        # end-to-end tests of the built IDE (opens app windows briefly)
npm run package         # Windows installer + portable folder in apps/ide/release/dist
npm run test:package    # smoke test of the packaged OriginStudio.exe
npm run ide             # start the built IDE
npm run ide:dev         # start the IDE with hot reload
npm run cli -- status   # run the CLI from source via tsx
```

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request on a
Windows runner: `npm ci`, `npm run typecheck`, `npm test`, `npm run test:e2e`,
`npm run package` and `npm run test:package`, and keeps the unsigned installer as a build
artifact for 14 days. Signing and an update feed are not configured in CI.

## Known limitations

IDE:

- The installer is unsigned until a publisher certificate is configured (see
  [Code signing](#code-signing)). Updates are manual and need a feed configured at packaging
  time (see [Updates](#updates)); no feed is published yet.
- Only a 64-bit Windows build is produced. The code is platform-neutral, but macOS and
  Linux packages have not been built or tested.
- One window and one workspace at a time. A second launch focuses the existing window.
- File watching relies on Windows change notifications; a large burst of changes (for
  example `npm install`) is reported as "refresh everything" rather than file by file.
- The language server ships for 64-bit Windows only (the platform the app is built for); on
  other platforms the editor uses Monaco's open-files-only worker, which suppresses "Cannot
  find module" errors.
- Language-server features are completion, hover, definition, references, signature help and
  diagnostics. Rename across files, quick fixes and organize imports are not offered yet;
  formatting and rename within one file still come from Monaco's worker. Definitions inside
  TypeScript's own `lib.*.d.ts` files (outside the workspace) are not shown.
- A project with more than 2000 source files is only partly checked project-wide (open files
  are always checked).
- Renaming a file to a different extension keeps the original type-checking mode until the
  tab is reopened.
- Text files must be UTF-8 (with or without BOM) and at most 5 MB.
- Terminal: no shell integration (command exit codes are not tracked) and no split panes.
- `npm run test:e2e` moves one temporary file to the Recycle Bin per run, because it tests
  the real delete.
- Monaco 0.57 pins DOMPurify 3.4.15, which has low-severity advisories. The root
  `overrides` entry upgrades it to 3.4.17, and `npm audit` reports 0 vulnerabilities.

CLI:

- `chaos init` has a single TypeScript starter, with no templates, options or prompts.
- `chaos init` does not run `npm install` or `git init` for you.
- Starter dependencies (`typescript ^7.0.2`, `@types/node ^26.6.5`) follow this repository's
  toolchain, and `npm install` in a new project needs network access or a warm npm cache.
- The CLI is not published to a registry; it is installed from this checkout.
- `npm run cli -- <command>` runs inside `apps/cli` (npm workspace behaviour), so `status`
  and `init` act on that folder. Use the installed `chaos` command for real work.

General:

- `npm install` warns that `esbuild`, `node-pty` and `electron-winstaller` have install
  scripts not approved with `npm approve-scripts`. None is needed here: esbuild ships its
  binary as a package, node-pty ships prebuilt Windows binaries, and electron-winstaller
  (a dependency of electron-builder) is not used because the installer is NSIS.
- `npm audit` reported 0 vulnerabilities when Phase 6 was completed (2026-10-23). Earlier
  phases saw moderate findings in `sprintf-js`, development tooling reached only through
  electron-builder's proxy support; nothing in the shipped app or the CLI depends on it.

## Phase 6 (this milestone)

1. Project-wide TypeScript intelligence through the native TypeScript 7 language server, run
   by the host for the open workspace; the Problems view covers the whole project.
2. The ORIGIN Core adapter started behind the `origin-core` feature flag: a read-only link
   file ties a folder to an ORIGIN project id and the status bar shows the link state.
3. Manual, user-confirmed updates through electron-updater, enabled per build by an update
   feed URL; signing remains a prerequisite for enabling a feed (no certificate yet).
4. A Windows CI workflow for typecheck, unit tests, end-to-end tests, packaging and the
   packaged smoke test.

## Future milestones

AI coding agents, cloud workspaces, remote deployment, an extension marketplace,
collaborative editing, debugger integration, ORIGIN account synchronization, and live
Binhi, Tala, Agos and Liyab connections. Their boundaries are defined in
[docs/integration/README.md](docs/integration/README.md); none of them is connected.

## Next milestone (Phase 7 recommendation)

1. Obtain a publisher certificate, sign releases in CI, publish `latest.yml` and the installer
   to a feed, and package with `ORIGIN_STUDIO_UPDATE_URL` and `ORIGIN_STUDIO_PUBLISHER_NAME`.
2. Replace the link-file transport of the ORIGIN Core adapter with a real ORIGIN query
   (credentials in the main process only), keeping the contract and the status bar as they are.
3. Rename across files, quick fixes and organize imports from the language server, applied
   through the save path so a file changed elsewhere is a conflict, not an overwrite.
4. Tala proposals as diffs in the editor, using the approval and audit contract already tested.
