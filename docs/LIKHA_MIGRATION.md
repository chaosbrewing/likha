# Origin Studio to LIKHA migration (Founder Amendment 001)

Status: implemented on branch `likha-rename-amendment-001`; not pushed, not released.

LIKHA is the canonical name of the desktop IDE (formerly Origin Studio) and of the
command-line tool (formerly `chaos`, now `likha`). LIKHA stays a standalone development
environment that integrates with ORIGIN.

## What changed

| Area | Before | Now |
|---|---|---|
| CLI command | `chaos` | `likha` (canonical) |
| Temporary alias | n/a | `chaos` runs `dist/chaos-alias.js`: same behavior, one notice on stderr |
| Product name (UI, help, errors, installer, shortcut, uninstaller) | Origin Studio | LIKHA |
| Windows executable / installer | `OriginStudio.exe`, `OriginStudio-Setup-<v>.exe` | `LIKHA.exe`, `LIKHA-Setup-<v>.exe` |
| Terminal `TERM_PROGRAM`, HTTP `user-agent` to ORIGIN | `OriginStudio` | `LIKHA` |

## What deliberately did not change

| Item | Why |
|---|---|
| Settings folder `%AppData%\Origin Studio` | Pinned in `apps/ide/electron/user-data.ts`. Electron derives the folder from the app name, so renaming alone would orphan `app-state.json`, `features.json`, `origin.json` and the encrypted ORIGIN credential (its key lives in the same folder). |
| `originStudio` key in project `package.json` | Existing projects stay valid and are never rewritten. `likha status` and the IDE validate the same key. |
| `appId` `dev.chaosorigins.originstudio` | Keeps the installed-app identity so the installer upgrades in place. |
| `ORIGIN_STUDIO_*` environment variables | Existing scripts and CI keep working. |
| `@studio/*` package names and the `origin-studio` repo/root package | Internal; renaming them is a separate proposal (D03). |
| ORIGIN integration contracts | Only comments and user-facing messages changed; no schema, route or identifier changed. |
| Historical records (`docs/qa/*`, `docs/REMOTE_SETUP.md`) | They describe what was true when written. |

## Existing users

1. Install the LIKHA build. Settings, credential and last folder are read from the same
   folder as before.
2. Use `likha` from now on. `chaos` keeps working in this release and prints
   `Notice: the "chaos" command is now "likha"...` on **stderr** (stdout and exit codes are
   unchanged). Silence it with `LIKHA_NO_ALIAS_NOTICE=1`.
3. Nothing edits your files: neither command rewrites project files, scripts or configuration.
   Update scripts and docs that call `chaos` yourself.
4. Global shims are not removed automatically. Running `npm link -w @studio/cli` again
   registers `likha` and `chaos`. `npm unlink -g @studio/cli` removes both. An old
   `chaos` shim that points at a previous checkout keeps running that old build until it is
   unlinked or relinked.

## Removal plan for the alias

Remove the `chaos` entry from `apps/cli/package.json` `bin`, delete
`apps/cli/src/chaos-alias.ts` and its tests in the release after the first LIKHA release,
only on founder approval.
