# Phase 7 release checkpoint — Secure ORIGIN connectivity and project integration (2026-10-24)

**Overall: PARTIAL.** Every piece of Origin Studio's side is built, tested and verified on this
machine, but read-only connectivity to a *real* ORIGIN is not demonstrated, because no ORIGIN a
desktop client can reach exists yet (no public deployment; browser-session authentication only).
Nothing in this report claims more than what ran.

Build 0.4.0, branch `phase-7-origin-connectivity`, Windows 11 Pro 10.0.26300, Node.js 24.18.0.
Baseline and ORIGIN findings: [phase-7-audit.md](phase-7-audit.md). Contracts, states, fixtures:
[../integration/README.md](../integration/README.md). Remote/CI plan: [../REMOTE_SETUP.md](../REMOTE_SETUP.md).

## 1. Read-only ORIGIN connectivity — PARTIAL

| Capability | Demonstrated | How |
|---|---|---|
| Connect with an ORIGIN API key, verify before storing, store encrypted (DPAPI via `safeStorage`) | Yes, against the **mock** transport | Unit tests (`connection.test.ts`, `origin-host.test.ts`) and the end-to-end test "ORIGIN connectivity (mock transport)", which also checks the key is not on disk in plain text and not in the log |
| Explicit disconnect; restore at start-up; refresh | Yes (mock) | Same tests; the e2e test restarts the app and sees the stored credential verified again |
| Expiry and revocation handling | Yes (mock) | Expired / revoked keys are refused and forgotten with the reason shown; a revocation noticed on refresh clears the stored key |
| Least privilege | Yes | Read-only use throughout; a key without read permission is refused; the HTTP transport maps ORIGIN's `project.read` / `.manage` / `.execute` to read / admin / write |
| No secrets in logs or project files | Yes | Asserted in unit and e2e tests; the interface never receives the key after typing it; the mock records 4 characters at most |
| Offline-safe | Yes | `unavailable` keeps the credential and the editor works (e2e with `ORIGIN_STUDIO_ORIGIN_MOCK_OFFLINE=1`) |
| Link verification: verified / unverified / unauthorized (forbidden, not-found, credential) / none / error | Yes (mock) | `link-file.test.ts`, e2e |
| Against a live ORIGIN | **No** | No reachable ORIGIN; ORIGIN's tRPC does not accept API keys (`validateApiKey` is unmounted). The `HttpOriginTransport` is tested against an in-process fake only |

## 2. Integration architecture — documented

`docs/integration/README.md` (what was verified, mocked vs real, lifecycle, configuration,
fixtures, ORIGIN Core v2 link rules, sector contracts v1), `docs/architecture.md` (ORIGIN
connection, security row, shutdown), README (feature flag, connecting, linking).

## 3. Regression tests — PASS

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` | 129 / 129 (18 new: connection lifecycle, link v2, HTTP transport against a fake ORIGIN, mock sectors, credential vault, origin config, credential IPC parser) |
| `npm run test:e2e` | 8 / 8 (new: ORIGIN connectivity with mock transport incl. restart and offline; no-server refusal; "Local" without the flag) |
| `npm run package` | OK (`OriginStudio-Setup-0.4.0.exe`) |
| `npm run test:package` | 1 / 1, exit code 0 |
| Close-after-terminal loop (packaged, 6 runs) | 6 / 6 exit code 0 (baseline: 3 / 6 crashed with `0xC0000409`) |
| `chaos --version`, `chaos status` | unchanged behaviour (CLI tests in `npm test`) |
| `npm audit` | 0 vulnerabilities after `npm audit fix` (Electron 44.9.0 → 44.9.3 for GHSA-jr5w-w6x2-84p9, high; fast-uri 3.1.8 → 3.1.9, moderate, development tooling). The chain above was re-run on the updated runtime |

Tests that exercise the brief's required states: authentication states (connected, connecting,
unauthorized ×4 reasons, unavailable, disconnected, no server), invalid project data (malformed
link file, bad project id, unknown project), expired credentials, unauthorized access
(forbidden project, credential scoped to another project, no read permission), network failures
(connection refused, timeout, HTTP 500, HTML instead of JSON, tRPC error envelopes), offline
operation (unavailable keeps the credential; editing continues), compatibility with local
projects (flag off → "Local", every ORIGIN call `NOT_CONNECTED`; the Phase 4–6 e2e journey
unchanged). Desktop terminal safety is unchanged (`terminal.test.ts` passes; the quit path now
waits for `taskkill`).

## 4. Offline behaviour — verified

With the flag off nothing ORIGIN-related runs. With the flag on and no server configured the
connection refuses to connect and says so. With a server that cannot be reached, the status
bar shows "unavailable", the stored credential is kept, link verification reports
"unverified (unavailable)", and opening, editing and saving files work as before.

## 5. CI — configured, not run

`.github/workflows/ci.yml` is in place and mirrors the commands above. It has never run because
the repository has no remote; creating one and pushing are owner actions (plan in
`docs/REMOTE_SETUP.md`). Status: **not executed**.

## 6. Mocked versus real

| Integration | Status |
|---|---|
| Connection lifecycle, credential vault, link reading, offline adapters | Real, tested |
| ORIGIN Core transport `mock` | Mock (documented fixtures) |
| ORIGIN Core transport `http` | Real client code; **unverified live**; cannot work until ORIGIN accepts API keys and is deployed |
| BINHI, TALA, AGOS, LIYAB adapters | Mock (shapes follow the sector repositories' own contracts) |
| Origin Pocket adapter | Mock; the contract is Origin Studio's proposal (ORIGIN defines no Pocket yet) |

## 7. Security findings and unresolved blockers

Findings (Origin Studio side, all addressed):

- The packaged app aborted on close after a terminal had been used (pending asynchronous
  `taskkill` at event-loop teardown). Fixed; measured 0/6 after 3/6.
- The credential must never cross IPC except once, when typed: enforced by the `origin:*`
  channel design and `parseSecret` (single bounded line); the interface only sees states.
- Credential at rest depends on OS encryption; without it nothing is stored and the tooltip
  says so (tested).
- The HTTP transport refuses non-https URLs (http for localhost only), credentials in URLs,
  redirects, and puts the key only in the `Authorization` header.
- Two advisories published after Phase 6 were fixed by patch bumps: Electron 44.9.3 (the
  shipped runtime; mitigation for compromised eMudhra intermediate certificates) and
  fast-uri 3.1.9 (packaging tooling). The installer was rebuilt and re-tested on 44.9.3.

Findings on the ORIGIN side (blockers, not fixable here):

1. **No reachable ORIGIN deployment** (parked legacy domain, unresolved new domain, Replit
   publish failed). Blocks any live verification.
2. **No API-key authentication on tRPC**: `validateApiKey` exists but is unmounted; a desktop
   client has no way to authenticate. ORIGIN must mount it for `auth.me` and `projects.get`
   (or provide a device flow) before `transport: "http"` can be enabled.
3. **API keys act as the user**, not with a reduced scope: ORIGIN's key records carry
   organisation/project scope but no permission list. Least privilege on the ORIGIN side
   means issuing a project-scoped key; Origin Studio additionally refuses to use a key for
   anything but reads.
4. **Origin Pocket is undefined** in ORIGIN. The contract here is a proposal to review.
5. **The "Chaos Origins App Development Workflow" document does not exist**; ORIGIN's own
   docs say so and the Sulit Sequence plugin replaces it. This phase followed the repository's
   established practice and Sulit Sequence's evidence rules.

## 8. Phase 8 recommendation

1. ORIGIN: mount API-key authentication for `auth.me` and `projects.get`, deploy a reachable
   instance (even a staging one), issue a project-scoped read key, set `origin.json` to
   `http`, and run the existing connection tests live. That turns this report's PARTIAL into PASS
   without changing Origin Studio's contracts.
2. Create the GitHub repository and push per `docs/REMOTE_SETUP.md`; confirm CI on the first run.
3. Sign releases and publish an update feed (unchanged from the Phase 6 recommendation).
4. Then the first user-visible ORIGIN feature: Tala proposals as diffs through the tested
   approval contract, and Pocket summaries in a panel, both read-only until ORIGIN executes.

## Stop point respected

No remote writes, no deployment infrastructure, no release published, no AI agent added, no
repository created, nothing pushed. Local changes are committed on `phase-7-origin-connectivity`.
