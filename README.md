# Origin Studio

Origin Studio is a development platform and desktop IDE being built under Chaos Origins.
This npm-workspaces monorepo contains:

- **Origin Studio IDE**: a Windows desktop editor (Electron, React, Monaco, xterm.js). It
  opens a local project, edits and saves files, manages files and folders, and runs commands
  in an integrated terminal.
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
| Editor | Monaco: tabs, syntax highlighting, line numbers, completion, TypeScript/JavaScript diagnostics, find (Ctrl+F), unsaved-change indicators. Save (Ctrl+S), Save As (Ctrl+Shift+S), Save All, Close Tab (Ctrl+W), Ctrl+Tab to switch tabs |
| Safety | Saves are checked against the version on disk. If another program changed the file, you choose Overwrite, Reload from Disk or Cancel. Binary, non-UTF-8 and >5 MB files are not opened. Closing a tab or the app with unsaved changes asks first. Deletes ask first and go to the Recycle Bin. Names are validated (Windows-reserved names and characters are rejected), and create or rename never overwrites anything |
| Terminal | Real shells through node-pty: PowerShell 7, Windows PowerShell and Command Prompt. Multiple sessions, resize and kill. Terminals open in the project folder. **Run** executes a `package.json` script (`npm run <name>`). All shells end when the app closes |
| Panels | Terminal, Output (activity log) and Problems (diagnostics from open files; click one to jump to it) |
| Window | Size, position and maximized state are remembered and kept on a visible screen |

The `chaos` CLI works in the integrated terminal as in any other terminal. In a Windows
PowerShell 5.1 terminal, use `chaos.cmd` if the execution policy blocks `chaos` (the
terminal prints this hint). PowerShell 7 terminals are not affected. Origin Studio never
changes the execution policy.

### Code signing

`npm run package` signs the installer and executables only when a certificate is configured
through electron-builder's standard variables (`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`,
or a certificate in the Windows certificate store selected with `WIN_CSC_SUBJECT_NAME`).
Without one, the build is unsigned and SmartScreen warns on first run. Signing needs a
publisher certificate that only Chaos Origins can obtain; nothing in the repository
contains or needs a key.

### Architecture and security

[docs/architecture.md](docs/architecture.md) describes the package boundaries, the process
model, the security controls (sandboxed renderer, isolated preload, validated IPC,
workspace path confinement, strict CSP) and the release hardening (Electron fuses,
integrity-checked `app.asar`). Future ORIGIN connection points are in
[docs/integration/README.md](docs/integration/README.md).

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
│       ├── electron/         main process: window, menu, IPC, protocol, terminals, preload
│       ├── src/              interface (React): components/, features/, hooks/, styles/
│       ├── scripts/          build and dev launchers (Vite + esbuild)
│       ├── test/             host unit tests
│       └── e2e/              end-to-end test of the built app (Playwright)
├── packages/
│   ├── contracts/            @studio/contracts: host API, IPC channels, shared types, ORIGIN interfaces
│   ├── core/                 @studio/core: validation, project config, starter templates
│   ├── workspace/            @studio/workspace: safe file operations, project inspection
│   ├── editor/               @studio/editor: tab and unsaved-change state, languages
│   └── origin-adapter/       @studio/origin-adapter: offline ORIGIN adapters and test mocks
├── docs/
│   ├── architecture.md
│   └── integration/README.md
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
npm run test:e2e        # end-to-end test of the built IDE (opens app windows briefly)
npm run package         # Windows installer + portable folder in apps/ide/release/dist
npm run test:package    # smoke test of the packaged OriginStudio.exe
npm run ide             # start the built IDE
npm run ide:dev         # start the IDE with hot reload
npm run cli -- status   # run the CLI from source via tsx
```

## Known limitations

IDE:

- The installer is unsigned until a publisher certificate is configured (see
  [Code signing](#code-signing)). There is no auto-update.
- Only a 64-bit Windows build is produced. The code is platform-neutral, but macOS and
  Linux packages have not been built or tested.
- One window and one workspace at a time. A second launch focuses the existing window.
- File watching relies on Windows change notifications; a large burst of changes (for
  example `npm install`) is reported as "refresh everything" rather than file by file.
- TypeScript/JavaScript intelligence covers open files only (there is no project-wide
  language server), so "Cannot find module" errors are suppressed.
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
- `npm audit` reports moderate findings that are all one advisory in `sprintf-js`, counted
  once per package in the chain that reaches it (electron-builder's proxy support,
  `global-agent`). It is development tooling for packaging; nothing in the shipped app or
  the CLI depends on it, and no fixed version is available yet.

## Future milestones (out of scope for Phase 4)

AI coding agents, cloud workspaces, remote deployment, an extension marketplace,
collaborative editing, debugger integration, ORIGIN account synchronization, and live
Binhi, Tala, Agos and Liyab connections. Their boundaries are defined in
[docs/integration/README.md](docs/integration/README.md); none of them is connected.

## Next milestone (Phase 6 recommendation)

1. Obtain a publisher certificate and sign releases; then add auto-update (electron-updater
   works with the NSIS target already produced).
2. Start the ORIGIN Core adapter behind a feature flag: link a local folder to an ORIGIN
   project id, read-only, with the status bar showing the connection state.
3. Project-wide TypeScript intelligence (a language server in a utility process), so
   imports between files resolve and the Problems panel covers the whole project.
4. A CI workflow that runs `npm test`, `npm run test:e2e`, `npm run package` and
   `npm run test:package` on a Windows runner.
