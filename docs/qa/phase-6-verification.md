# Phase 6 verification (2026-10-23)

Machine: Windows 11 Pro 10.0.26300, Node.js 24.18.0, npm 11.16.0, TypeScript 7.0.2 (native).
Build: 0.3.0 from branch `phase-6-intelligence-origin-ci`. Every check below was run on this machine
after the last code change; the CI workflow itself has not run yet (the repository has no remote).

## Scope delivered

| # | Phase 6 item | Delivered as |
|---|---|---|
| 1 | Signing and auto-update | Manual, user-confirmed update check through electron-updater (**Help > Check for Updates…**), enabled per build by `ORIGIN_STUDIO_UPDATE_URL`; `ORIGIN_STUDIO_PUBLISHER_NAME` pins updates to a signing publisher. **No certificate and no feed exist**, so shipped builds still say "no update feed configured". |
| 2 | ORIGIN Core adapter behind a flag | `origin-core` flag (`features.json` or `ORIGIN_STUDIO_FEATURES`); link-file adapter reads `.origin/project.json` read-only; status bar shows linked / not linked / link invalid |
| 3 | Project-wide TypeScript intelligence | The native TypeScript 7 compiler as a language server (`tsc --lsp`) in a host-owned process; Problems covers the whole project; completion, hover, definition, references, signature help across files |
| 4 | CI on a Windows runner | `.github/workflows/ci.yml`: typecheck, unit, e2e, package, packaged smoke test, installer artifact |

## Automated checks

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` | 111/111 (new: link-file adapter, source-file listing, feature flags, JSON-RPC framing, LSP conversions, the real language server on a temporary project, update flow with a fake updater, language IPC parsers) |
| `npm run test:e2e` | 7/7, including three new tests: project-wide Problems for an unopened file, live diagnostics and a cross-file Go to Definition, hover and completion from the server, the ORIGIN link through the flag (link appears, invalid link reported, file never written), and "Local" without the flag |
| `npm run package` | `OriginStudio-Setup-0.3.0.exe` and `win-unpacked`, with `resources/typescript` (tsc.exe, its `lib*.d.ts` files, license and notice; 28 MB) |
| `npm run test:package` | 1/1: the packaged app starts the shipped language server under the release fuses, edits, runs a shell, exits 0 |
| `npm audit` | 0 vulnerabilities |

## Defects found and fixed during verification

1. **Packaged server crashed at start** (`lib.d.ts does not exist`): the `extraResources` filter
   `lib.*.d.ts` did not match `lib.d.ts`. Filter is now `lib*.d.ts`; the packaged smoke test checks
   the server reaches "ready".
2. **Write after end**: late answers to server-initiated requests were written to the server's
   closed input after dispose, which crashes a Node process with an unhandled stream error.
   `LspConnection` now drops writes after dispose; the host logs pipe errors instead of dying.
   Regression test in `apps/ide/test/lsp-connection.test.ts`.
3. **Exit code 0xC0000409 from the packaged app** once, when the server was killed with
   `TerminateProcess` during window close. `terminate()` now sends shutdown/exit, closes the
   server's input (it exits on end-of-input) and only kills after 1.5 s; the packaged test
   passes with exit code 0 afterwards. Not reproduced since; kept under watch.
4. **Cursor placed before the editor switched models** (Problems click, Go to Definition):
   `openLocation` now waits for the target model to be active before moving the cursor.
5. **A failed e2e test could hang the whole suite**: Playwright's `app.close()` waits forever
   when the unsaved-changes guard refuses to quit, and a surviving app makes every later launch
   stall on the single-instance lock. Cleanup now force-kills after 3 s.

## Not verified / needs a human

- **Check for Updates…** end to end against a real feed (none exists). The decision flow is
  unit-tested with a fake updater; electron-updater is bundled and loads in the packaged app only
  when the menu item is used.
- The CI workflow on GitHub (no remote yet). It mirrors the commands run here.
- Signing: unchanged from Phase 5, unsigned.
- Peek Definition / Peek References widgets were exercised manually in Phase 6 development
  only through the automated Go to Definition; a human pass over peek previews of files that
  are not open (shadow models) is worthwhile.

## Manual acceptance suggestions

1. Open a project with several files; break a type in a file that is not open; the Problems
   view lists it within ~2 s and clicking it opens the file at the line.
2. In an open file, hover a symbol imported from another file, press F12, Shift+F12, Alt+F12.
3. Set `ORIGIN_STUDIO_FEATURES=origin-core`, add `.origin/project.json`, watch the status bar.
4. Help > Check for Updates… on the installed build: "no update feed configured".
