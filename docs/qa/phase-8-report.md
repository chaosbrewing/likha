# Phase 8 integration checkpoint — Desktop connectivity enablement (2026-10-24)

**Overall: PARTIAL.** Desktop authentication, authorized project metadata, rejection of
invalid, revoked, expired and unauthorized access, unchanged browser sessions, offline
behaviour and regression tests are all **demonstrated against a real ORIGIN server**, but that
server was a **local development instance** of ORIGIN's new branch, started for this checkpoint
and torn down afterwards. No reachable ORIGIN deployment carries the change yet; deploying it
is the owner's decision (stop point below). Every claim here is backed by a recorded run.

Repositories: ORIGIN `C:\Users\User\ORIGIN`, branch `desktop/api-key-read-access`, commit
`45698cf` (from `main` `0e99e11`); Origin Studio branch `phase-8-live-connectivity` (this commit).
Neither branch was pushed.

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

## Tests (Step 7)

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
| Automated regression tests pass | Yes, except 3 pre-existing timeouts unrelated to this change |
| Origin Studio remains functional offline | Yes (Phase 7 offline e2e unchanged; flag off → "Local") |
| Real integration evidence is recorded | Yes, in both repositories |

## Stop point — the exact proposed change for review

1. **Merge** ORIGIN branch `desktop/api-key-read-access` (one commit, `45698cf`: 4 source
   files, 2 test files, 1 design doc, 3 evidence files; no route, table or migration; no
   behaviour change for sessions). Impact: an ORIGIN API key becomes a working read credential
   for `auth.me` and `projects.get` only; every key already issued (`apiKeys` table) gains that
   read capability for its holder's own projects, which the holder could already read in the
   browser. Keys remain revocable in ORIGIN. Nothing else changes.
2. **Deploy** it to a reachable, non-production environment (a Replit deployment of the
   branch, or staging), set `FRONTEND_URL`, and confirm `/live` answers.
3. **Provision** one project-scoped, expiring key for a dedicated Origin Studio test account
   there, and run `npm run test:e2e:live` from Origin Studio. That completes the checkpoint
   as PASS without further code.

Not done, by instruction: pushing either branch, publishing ORIGIN, DNS, production
migrations, exposing endpoints publicly, remote writes, AI agents, Phase 9.
