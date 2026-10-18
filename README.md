# Origin Studio

Origin Studio is a development platform and custom IDE being built under Chaos Origins.
This repository is an npm-workspaces monorepo containing its shared core, its desktop
IDE (not yet started) and its command-line interface, **`chaos`**.

## The `chaos` CLI

`chaos` is the Origin Studio command-line tool. In this first version it can:

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

`chaos status` validates that section and checks for `package.json`, `tsconfig.json` and
`src/index.ts`. Having a `package.json` is not enough.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (including `status` in a folder that isn't a project) |
| `1` | The command couldn't be completed, e.g. the target folder already exists or a filesystem error occurred |
| `2` | Usage error: unknown command or option, missing or invalid argument |

Errors are written to stderr and start with `Error:`.

## Repository layout

```text
origin-studio/
├── apps/
│   ├── cli/                    @studio/cli — the `chaos` command
│   │   ├── src/
│   │   │   ├── index.ts        entry point and command routing
│   │   │   ├── errors.ts       exit codes and user-facing errors
│   │   │   ├── version.ts      reads the version from package.json
│   │   │   └── commands/       help.ts, status.ts, init.ts
│   │   ├── test/cli.test.ts    tests that run the compiled CLI
│   │   ├── dist/               build output (git-ignored)
│   │   └── tsconfig.build.json
│   └── ide/                    @studio/ide — desktop IDE (placeholder)
├── packages/
│   └── core/                   @studio/core — shared logic, no filesystem access
│       ├── src/                name validation, project config checks, starter templates
│       ├── test/
│       └── tsconfig.build.json
├── package.json                origin-studio (workspace root)
└── tsconfig.json               editor/typecheck config for the whole repo
```

## Requirements

- Windows 10/11 (macOS and Linux should also work but haven't been verified)
- Node.js 20 or newer (verified with Node.js 24.18.0 and npm 11.16.0)
- No global TypeScript or `tsx` needed: both are local dev dependencies, and the
  installed CLI runs as plain compiled JavaScript.

## Local development

From the repository root in PowerShell:

```powershell
npm install          # installs dev tools and links the @studio/* workspaces
npm run build        # compiles packages/core and apps/cli to dist/
npm run typecheck    # type-checks everything without emitting
npm test             # builds, then runs core and compiled-CLI tests
npm run cli -- status   # runs the CLI from TypeScript source via tsx (no build needed)
```

`npm run build` must run before the compiled CLI can be used, because `@studio/cli`
imports `@studio/core` from `packages/core/dist`.

## Installing the `chaos` command

### Option A: global link (recommended for development)

```powershell
npm install
npm run build
npm link -w @studio/cli
chaos --version
```

`npm link` adds `chaos`, `chaos.cmd` and `chaos.ps1` to your global npm folder
(`npm config get prefix`, usually `%AppData%\npm`) and points them at this checkout, so
rebuilding (`npm run build`) updates the command immediately. To remove it:

```powershell
npm unlink -g @studio/cli
```

### Option B: project-local, no global changes

After `npm install` and `npm run build`, run `npm install` once more so npm links the
newly built bin, then:

```powershell
npx chaos status
.\node_modules\.bin\chaos.cmd --version
```

### Windows PowerShell 5.1 and execution policy

npm creates a `chaos.ps1` shim, and PowerShell prefers it over `chaos.cmd`. Under
Windows' default `Restricted` execution policy, **Windows PowerShell 5.1** refuses to run it:

```text
chaos : File ...\npm\chaos.ps1 cannot be loaded because running scripts is disabled on this system.
```

(npm's own `npm.ps1` hits the same restriction.) Any one of these works:

- Use **PowerShell 7** (`pwsh`), whose default policy (`RemoteSigned`) allows it.
- Run `chaos.cmd` instead of `chaos`, e.g. `chaos.cmd status`.
- Allow local scripts for your user account (your decision, it changes a security setting):
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

`cmd.exe` is not affected.

## Known limitations

- `chaos init` has a single TypeScript starter. There are no templates, options or prompts.
- `chaos init` does not run `npm install` or `git init` for you.
- Starter dependencies (`typescript ^7.0.2`, `@types/node ^26.6.5`) follow this repository's
  toolchain, and `npm install` in a new project needs network access or a warm npm cache.
- The CLI is not published to a registry; it is installed from this checkout.
- Only Windows has been verified. The code uses `node:path` throughout and is intended
  to be cross-platform.
- `npm run cli -- <command>` runs inside `apps/cli` (npm workspace behaviour), so
  `status` and `init` act on that folder. Use the installed `chaos` command for real work.
- `@studio/ide` is an empty placeholder.
- `npm install` warns that `esbuild` (used by `tsx`, development only) has install scripts
  not yet approved with `npm approve-scripts`. Builds and tests work without approving it.

## Next milestone

Connect the CLI to the desktop IDE through `@studio/core` rather than by shelling out:
the IDE's "New project" flow and project indicator should call the same
`validateProjectName`, `getStarterFiles` and `checkProjectManifest` functions used by
`chaos init` and `chaos status`. A sensible first step is to move the small filesystem
pieces (`inspectProject`, the safe write loop in `init.ts`) into a Node-only core module
both apps can import.
