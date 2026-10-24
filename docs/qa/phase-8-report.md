# Phase 8 integration checkpoint — Desktop connectivity enablement (2026-10-24, finalized 2026-10-25)

**Overall: PARTIAL.** Desktop authentication, authorized project metadata, rejection of
invalid, revoked, expired, unauthorized and **unscoped** access, unchanged browser sessions,
offline behaviour and regression tests are all **demonstrated against a real ORIGIN server**, but
that server was a **local development instance** of ORIGIN's branch, started for this checkpoint
and torn down afterwards. No reachable ORIGIN deployment carries the change yet; deploying it
needs the owner's approval (see "Finalization" and the stop point). Every claim here is backed by
a recorded run. Implementation and **local verification** are complete; **deployed verification**
has not happened.

Repositories: ORIGIN `C:\Users\User\ORIGIN`, branch `desktop/api-key-read-access` (from
`origin/main` `0e99e11`): commit `45698cf` plus the finalization commit; Origin Studio branch
`phase-8-live-connectivity`: commit `3b627b2` plus the finalization commit. After the owner
approved on 2026-10-25, the ORIGIN branch was pushed and opened as
[chaosbrewing/ORIGIN#53](https://github.com/chaosbrewing/ORIGIN/pull/53), and this repository was
published privately at github.com/chaosbrewing/origin-studio. Merge and deployment still need
approval.

## Finalization (2026-10-25)

**Workflow document.** `chaos_origins_workflow.pdf` was not found anywhere on this machine; the
finalization followed the brief's own checkpoints. This is reported as a limitation, not as the
document having been replaced (the installed Sulit Sequence plugin claims to replace the "Chaos
Origins App Development Workflow"; that claim was not relied upon).

**Security finding (critical) and correction.** ORIGIN's `apiKeys` table had no permission
model, so the 2026-10-24 branch turned **every existing active key** into a read credential for
its holder's projects: a silent widening of legacy keys. Fixed in ORIGIN with the smallest
backward-compatible mechanism: a nullable `apiKeys.scopes` column (JSON array; today only
`project.read` is assignable), an optional `scopes` input on `apiKeys.create` with an opt-in
checkbox on the API keys page (default off), and a resolver that refuses any key without the
scope (HTTP 403 `FORBIDDEN`, reason `unscoped`, before the user is loaded, without spending the
per-client failure budget), re-checked inside `desktopReadProcedure`. **A schema change is
required**: MySQL migration `0018_api_key_scopes` and PostgreSQL `0003_api_key_scopes`, both
additive; applied only to a disposable local MySQL container, **not** to the Replit development
or production databases. Legacy keys therefore keep exactly the access they had: none. Details:
ORIGIN `docs/DESKTOP_API_KEY_ACCESS.md` ("Authorization model").

**Test matrix.** All sixteen required cases plus the no-disclosure requirement are proven in
ORIGIN's `server/desktop-auth.test.ts` (15 tests), `server/desktop-auth.integration.test.ts`
(10 tests on a real MySQL), the redacted live probes and the Studio live test; the case-by-case
table is in ORIGIN `docs/verification/desktop-api-key-access-2026-10-25.md` §2. Studio's own
cases: safe credential storage (`apps/ide/test/origin-host.test.ts`, live test: file not plain
text, key absent from the log), removal after rejection and retention during outages
(`packages/origin-adapter/test/connection.test.ts`, smoke e2e, live test). ORIGIN's whole unit
phase: 641 passed, 94 skipped, 0 failed.

**Baseline reconciliation.** The three 5-second timeouts (`aithusa-explain`,
`aithusa-integration-boundary`, `steward-verdict` "enforces project ownership") were re-run three
times each on the unchanged base `origin/main` `0e99e11` and on the branch, same machine, same
dependencies: the base failed all three in one of three runs, the branch failed one in one of
three runs, and every run passes with a 30 s budget. Classification: **pre-existing,
environment/timing (intermittent)**, not introduced. Evidence:
[phase-8-evidence/desktop-baseline-reconciliation-2026-10-25.txt](phase-8-evidence/desktop-baseline-reconciliation-2026-10-25.txt).

**Live re-verification (local).** Fresh `mysql:8.0` with 19 migrations, ORIGIN `pnpm dev` on
`http://127.0.0.1:5055`, dev-login accounts, keys issued through `apiKeys.create` (scoped,
legacy/unscoped, revoked, expired). Probes:
[phase-8-evidence/desktop-api-key-probes-2026-10-25.txt](phase-8-evidence/desktop-api-key-probes-2026-10-25.txt)
(legacy key → 403 on both procedures; scoped key → 200; mutations → 401; cookie unchanged).
Studio `npm run test:e2e:live` with the new `ORIGIN_STUDIO_LIVE_UNSCOPED_KEY_FILE` case:
[phase-8-evidence/desktop-origin-studio-live-2026-10-25.jsonl](phase-8-evidence/desktop-origin-studio-live-2026-10-25.jsonl):

```json
{"origin":"http://127.0.0.1:5055","projectId":"4","connectedAs":"Desktop Test Owner","verifiedProject":"origin-studio-desktop-test","foreignProject":"Project not found The link file is not trusted until ORIGIN confirms it.","revokedKey":"ORIGIN: sign in again (revoked)","unscopedKeyDialog":"Could not connect to ORIGIN API key does not grant project.read. Issue a key with Origin Studio read access. OK","unscopedKey":"ORIGIN: sign in again (forbidden)","consoleErrors":0}
```

Four runs: one passed with a test-side regex bug that mangled the recorded dialog text (fixed),
one timed out waiting for the status bar after the link file switched to the foreign project
(intermittent e2e file-watcher timing; the other three runs passed that step), two passed; the
last is the evidence above. The environment was torn down afterwards (server stopped, container
removed, secrets and key files deleted).

**Studio suites re-run after the teardown (2026-10-25):** `npm run typecheck` 0 errors;
`npm test` 129 / 129; `npm run test:e2e` 8 / 8.

**Studio changes in this finalization:** `apps/ide/e2e/origin-live.test.ts` (unscoped-key case),
`README.md` and `docs/integration/README.md` (scope requirement), this report and the evidence
copies. No Studio product code changed; the Phase 8 transport already handled 403 as "forbidden"
and never stores a refused key.

**Review and staging.** ORIGIN `docs/DESKTOP_API_KEY_REVIEW_PACKAGE.md` (PR text, security
summary, files, tests, compatibility, deployment, rollback, reviewer checklist) and
`docs/DESKTOP_API_KEY_STAGING_READINESS.md` with `deploy/staging/docker-compose.staging.yml` and
`staging.env.example` (validated with `docker compose config`, never started). Recommended smallest
path: the Replit development workspace on the branch. Nothing was deployed or exposed.

## What was established (Steps 1–2)

| Question | Finding |
|---|---|
| Authoritative deployment | ORIGIN is hosted on Replit (Autoscale, `.replit`); the only recorded publish failed at start-up and `origin-porscharyder.replit.app` answers "This app isn't live yet". `mychaos.today` is a parked domain (every path 200 with a parking page). `chaosorigins.today` does not resolve. The self-hosted Cloudflare Tunnel path is documented as historical. **No usable environment exists elsewhere** |
| Authentication on `main` | Session JWT cookie (Manus OAuth, Replit OIDC, dev login); `sdk.authenticateRequest` also accepts a session JWT as a bearer token. API keys are issued and managed (`apiKeys.*`) but **validated nowhere** |
| Routes relevant to the desktop | `auth.me` (public, returns the session user or null), `projects.get` (session, `requireProjectPermission(... "project.read")`) |

## What was built in ORIGIN (Steps 3–6)

`server/_core/desktopAuth.ts`, `context.ts`, `trpc.ts` (`desktopReadProcedure`) and `routers.ts`
(`auth.me`, `projects.get`); design in ORIGIN `docs/DESKTOP_API_KEY_ACCESS.md`.

- A bearer token that is a 64-hex ORIGIN API key is resolved: per-client failure budget →
  format → SHA-256 lookup → status (revoked, expired) → expiry → user. A database failure is
  "unavailable", never an acceptance. The key is never logged.
- `ctx.user` stays null for API-key requests, so every mutation and every other procedure
  still requires a browser session (no second authentication system; no widening).
- `auth.me` answers the key holder plus scope (or the refusal reason); `projects.get` applies
  the same ownership rule as a session, then the key's project/organisation scope, then
  returns the holder's permissions. Read-only by construction.
- Contract mismatches with Studio's Phase 7 transport were documented and resolved on both
  sides (identity `permissions`/`expiresAt`, project `permissions`, error reasons on 401/403/404,
  numeric project ids). See ORIGIN `docs/DESKTOP_API_KEY_ACCESS.md`, "Contract".

## Tests (Step 7, 2026-10-24 run; the finalization numbers are in the section above)

| Suite | Result |
|---|---|
| ORIGIN `server/desktop-auth.test.ts` (no database) | 12 / 12: valid key, malformed, unknown, revoked, expired by status and by date, missing user, server failure → unavailable, failure budget and bound, bearer classification, scope rule, `auth.me`/`projects.get` per principal, mutations refused for keys |
| ORIGIN `server/desktop-auth.integration.test.ts` (real MySQL) | 7 / 7: owner, organisation viewer (read only), outsider, project-scoped key on another project, revoked / expired / unknown / malformed with reasons, per-client rate limit, mutations refused, sessions unchanged |
| ORIGIN full unit phase (`vitest run`) | 634 passed, 91 skipped (database suites), **3 failed: pre-existing** 5-second timeouts in `aithusa-explain`, `aithusa-integration-boundary`, `steward-verdict` ("enforces project ownership"), reproduced on `main` with the changes stashed; pass with `--testTimeout=30000` |
| ORIGIN `pnpm check`, Prettier | clean |
| Studio `npm run typecheck`, `npm test` | 0 errors; 129 / 129 |
| Studio `npm run test:e2e` | 8 / 8 (mock transport suite unchanged) |
| Studio `npm run test:e2e:live` against the local ORIGIN | 1 / 1 (details below); skipped by default without `ORIGIN_STUDIO_LIVE_*` |
| Studio `npm run package`, `npm run test:package` | OK; packaged smoke test 1 / 1, exit code 0 |

## Live integration evidence (Steps 8–10)

Environment (disposable, local, not production): ORIGIN branch `desktop/api-key-read-access`
run with `pnpm dev` on `http://127.0.0.1:5055` against a fresh `mysql:8.0` container
(`pnpm db:migrate`, 63 tables); dedicated test accounts `desktop-test-owner` and
`desktop-test-other` via ORIGIN's dev login; disposable projects 9 (owner) and 10 (other);
keys issued through `apiKeys.create` (project-scoped, unscoped, revoked, expired). Removed
afterwards. Full records: ORIGIN `docs/verification/desktop-api-key-access-2026-10-24.md`,
copies in [phase-8-evidence/](phase-8-evidence/).

Direct probes (keys redacted): valid key → `auth.me` 200 with `principal: "api-key"` and
`projects.get` 200 for project 9 with permissions; other user's project 10 → 404; unknown id →
404; no credential → 401; revoked → 401 "not active (revoked)"; expired → 401 "has expired";
unknown 64-hex key → 401; `projects.list` / `projects.create` / `apiKeys.create` with a key →
401; session cookie → `auth.me` and `projects.get` 200 exactly as before.

Origin Studio 0.4.0, `transport: "http"`, `npm run test:e2e:live`:

```json
{"origin":"http://127.0.0.1:5055","projectId":"9","transport":"http","connectedAs":"Desktop Test Owner","verifiedProject":"origin-studio-desktop-test","foreignProject":"Project not found The link file is not trusted until ORIGIN confirms it.","revokedKey":"ORIGIN: sign in again (revoked)","consoleErrors":0}
```

The credential was stored encrypted, absent from the log, forgotten on disconnect and after
the revoked key; the file hint was replaced by ORIGIN's project name.

## Definition of done, item by item

| Item | Status |
|---|---|
| Desktop authentication functions against a reachable ORIGIN environment | **PARTIAL**: works against a local development ORIGIN; no deployed environment carries the branch |
| Authorized project metadata is retrieved successfully | Yes (live and tests) |
| Invalid and revoked credentials are rejected | Yes (live and tests) |
| Unauthorized projects cannot be accessed | Yes (live and tests, including scope narrowing) |
| Existing browser authentication remains functional | Yes (live cookie probes; ORIGIN suites) |
| Automated regression tests pass | Yes; the 3 historical timeouts are intermittent on the unchanged base as well (reproduced 2026-10-25, see Finalization) |
| Legacy API keys gain no access they did not have | Yes (finalization): keys without the `project.read` scope are refused with 403; proven by unit, integration, probes and the Studio live test |
| Origin Studio remains functional offline | Yes (Phase 7 offline e2e unchanged; flag off → "Local") |
| Real integration evidence is recorded | Yes, in both repositories |

## Stop point — the exact proposed change for review

1. **Review and merge** ORIGIN pull request chaosbrewing/ORIGIN#53 (`desktop/api-key-read-access`,
   `45698cf` + the finalization commit; review package in ORIGIN `docs/DESKTOP_API_KEY_REVIEW_PACKAGE.md`).
   Impact: an ORIGIN API key issued **with the `project.read` scope** becomes a read credential
   for `auth.me` and `projects.get` only; every key already issued keeps granting nothing.
   One additive nullable column (migration 0018 MySQL / 0003 PostgreSQL). No behaviour change
   for sessions. Keys remain revocable in ORIGIN.
2. **Apply the migration and deploy** to a reachable, non-production environment (the Replit
   development workspace on the branch is the smallest path; the Docker Compose staging stack is
   prepared as the alternative, see ORIGIN `docs/DESKTOP_API_KEY_STAGING_READINESS.md`), and
   confirm `/live` answers over https.
3. **Provision** one project-scoped, expiring key with the scope for a dedicated Origin Studio
   test account there, run `npm run test:e2e:live` from Origin Studio, revoke the key and run the
   refusal case. That completes the checkpoint as PASS without further code.

Not done, by instruction: pushing either branch, opening a pull request, merging, publishing
ORIGIN, DNS, production or shared-database migrations, exposing endpoints publicly, provisioning
credentials, remote writes, AI agents, Phase 9.
