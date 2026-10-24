# Phase 7 audit and baseline (2026-10-24)

Steps 1 and 2 of the Phase 7 brief: what the repository, the desktop app and ORIGIN actually
are before any connectivity work. Machine: Windows 11 Pro 10.0.26300, Node.js 24.18.0,
npm 11.16.0, TypeScript 7.0.2.

## Git state

| Item | Observed |
|---|---|
| HEAD at start | `4c98e4d` on `phase-6-intelligence-origin-ci`, working tree clean |
| Branches | `phase-3-chaos-cli`, `phase-4-ide-foundation`, `phase-5-release-readiness`, `phase-6-intelligence-origin-ci`; no `main` |
| Remotes | none; nothing has ever been pushed |
| Identity | `chaosbrewing <johnpoyy028@gmail.com>`; `gh` signed in as `chaosbrewing` |
| Line endings | `core.autocrlf=true` (system); index is LF |
| Phase 7 branch | `phase-7-origin-connectivity` created from `4c98e4d` |

The remote and CI plan, not executed, is [REMOTE_SETUP.md](../REMOTE_SETUP.md).

## Baseline verification of 0.3.0 (before any Phase 7 change)

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` | 111/111 |
| `npm run test:e2e` | 7/7, including project-wide Problems for an unopened file, live diagnostics, hover, completion and cross-file Go to Definition |
| `npm run package` | OK |
| `npm run test:package` | **FAILED**: the packaged app exited with `0xC0000409` on close |
| `chaos --version`, `chaos status` | 0.1.0; reports "No Origin Studio project in this directory" for the repository root, as expected |

TypeScript intelligence was verified by the unit test that runs the real server
(`apps/ide/test/language-server.test.ts`: cross-file diagnostics, hover, definition into another
file, references including an unopened file, completion with resolve, signature help, project
check of unopened files) and by the end-to-end test.

### Defect found in the baseline: crash on close after a terminal

`0xC0000409` is Windows' fail-fast code for `abort()`. Event log: faulting module
`OriginStudio.exe`, offset `0x3217805`, `P9: 7` (`FAST_FAIL_FATAL_APP_EXIT`), twice (2026-10-23
and 2026-10-24). Measured with `apps/ide/e2e/_debug-exit-loop.mts` against the 0.3.0 package:

| Scenario (6 runs each) | Crashes |
|---|---|
| Open, wait for the language server, close | 0 / 12 |
| Edit and save, close | 0 / 12 |
| Edit, save, open a terminal, run a command, close | 3 / 6 |

Cause: `TerminalManager.killAll()` ended shells with an asynchronous `taskkill` whose process
request was still pending when Electron tore down its event loop. Fix (Phase 7): quit-time
kills run synchronously (`killAll({ wait: true })`, and the language server is ended at once
in `terminate()`). The result after the fix is in [phase-7-report.md](phase-7-report.md).

## ORIGIN capabilities (Step 1, "identify actual ORIGIN API capabilities")

Verified against the ORIGIN source checkout `C:\Users\User\ORIGIN` (branch
`docs/handoff-2026-10-20`, clean; GitHub `chaosbrewing/ORIGIN` pushed 2026-10-23) and by
unauthenticated probes of public hosts. Full table in
[integration/README.md](../integration/README.md), "What was verified".

- **No reachable ORIGIN deployment.** `mychaos.today` is parked (every path answers the parking
  page), `chaosorigins.today` does not resolve, `origin-porscharyder.replit.app` shows "This app
  isn't live yet". ORIGIN's `replit.md` says "Do not publish yet."
- **Browser-session authentication only.** tRPC resolves the user from a JWT cookie; API keys
  exist as records and management procedures but `validateApiKey` is never mounted.
- **Project data**: `projects.get` and `projects.list` behind `project.read`.
- **Sectors**: TALA = Aithusa proposals (real procedures); AGOS = contract v1 only, planned;
  LIYAB = sandbox on a draft branch, production refuses everything; BINHI = standalone product
  with an integration specification; Origin Pocket = not defined anywhere.
- **Process**: the "Chaos Origins App Development Workflow" is recorded as missing in ORIGIN's
  own docs; the installed Sulit Sequence plugin states it replaces that workflow. Phase 7
  therefore follows the repository's established practice (phase branch, contracts first,
  tests, docs, QA report) and Sulit Sequence's honesty rules (nothing unverified is claimed).

Conclusion for the design: the connection lifecycle, credential handling, link verification
and sector contracts are built and tested against mocks; the HTTP transport is written to
ORIGIN's actual tRPC shapes but cannot be verified live until ORIGIN mounts API-key
authentication and publishes a deployment.
