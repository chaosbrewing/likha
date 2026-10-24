# ORIGIN integration (Phase 7)

**Status in one line (Phase 8):** Origin Studio connects read-only to an ORIGIN that carries
ORIGIN's `desktop/api-key-read-access` change: verified **live against a local ORIGIN
development server** on 2026-10-24 and again on 2026-10-25 after the Phase 8 finalization
added the scope requirement (a key must carry ORIGIN's `project.read` scope; see "What was
verified" and [`docs/qa/phase-8-report.md`](../qa/phase-8-report.md)). **No publicly reachable ORIGIN
deployment exists yet**, so a shipped build still runs against `mock` or `none` until the
owner deploys that branch. Sector adapters remain documented mocks. Nothing writes to ORIGIN.
Editing never depends on any of it.

- Contracts: [`packages/contracts/src/origin/`](../../packages/contracts/src/origin/) —
  `index.ts` (ORIGIN Core v2, adapter set), `connection.ts` (connection lifecycle, transport,
  vault, link resolution), `services.ts` (BINHI, TALA, AGOS, LIYAB, Origin Pocket, each with a
  contract version).
- Adapters: [`packages/origin-adapter`](../../packages/origin-adapter) — `OriginConnection`,
  `MockOriginTransport` (fixtures), `HttpOriginTransport` (ORIGIN's tRPC shapes, unverified
  live), `createLinkFileCoreAdapter`, `createMockSectorAdapters`, `createOfflineAdapters`.
- Host wiring: [`apps/ide/electron/main.ts`](../../apps/ide/electron/main.ts) (`setUpOrigin`),
  [`origin-config.ts`](../../apps/ide/electron/origin-config.ts),
  [`origin-vault.ts`](../../apps/ide/electron/origin-vault.ts).
- Tests: `packages/origin-adapter/test/*.test.ts`, `apps/ide/test/origin-host.test.ts`, and the
  "ORIGIN connectivity (mock transport)" end-to-end test in `apps/ide/e2e/ide.smoke.test.ts`.

## What was verified about ORIGIN (2026-10-24)

Checked against the ORIGIN source (`C:\Users\User\ORIGIN`, branch `docs/handoff-2026-10-20`,
clean, same as GitHub `chaosbrewing/ORIGIN`) and by probing public hosts without credentials.

| Question | Finding | Evidence |
|---|---|---|
| Is there a live ORIGIN endpoint? | **No.** `mychaos.today` answers every path with a domain-parking page (HTTP 200, `/lander`). `chaosorigins.today` does not resolve. The Replit deployment `origin-porscharyder.replit.app` shows Replit's "This app isn't live yet" page (ORIGIN's own domain contract records its last publish failing at start-up). `replit.md` on `main` says "Do not publish yet." | `curl` of `/healthz`, `/api/trpc/auth.me` on each host; `docs/ORIGIN_DOMAIN_CONTRACT.md` §observed |
| How does ORIGIN authenticate? | Browser sessions only: a JWT cookie issued after Manus OAuth (`/api/oauth/callback`), Replit OIDC, or the dev-only `/api/dev/login`. tRPC's `createContext` calls `sdk.authenticateRequest(req)`, which reads the cookie. | `server/_core/context.ts`, `server/_core/oauth.ts`, `server/_core/sdk.ts` |
| Do API keys exist? | As records and management procedures, yes: `apiKeys.list/create/revoke/delete` issue 64-hex keys (SHA-256 stored, 20-char prefix shown), scoped to user, organisation, project or service identity, with `active/revoked/expired` status and optional expiry. | `drizzle/schema.ts` `apiKeys`, `server/routers.ts` `apiKeys` |
| Can an API key call anything? | On `main`: **no** (`validateApiKey` exists but is never mounted; the tRPC context ignores bearer keys). On ORIGIN branch **`desktop/api-key-read-access`** (Phase 8, not merged, not deployed): **yes, read-only** — `auth.me` and `projects.get` accept `Authorization: Bearer <key>` through `server/_core/desktopAuth.ts` and `desktopReadProcedure`; every mutation and every other procedure still requires a browser session. **Finalization (2026-10-25):** the key must have been issued with the `project.read` scope (new nullable `apiKeys.scopes` column, MySQL migration 0018 / PostgreSQL 0003, opt-in checkbox on ORIGIN's API keys page); every key issued without it, including every pre-existing key, is refused with 403 `FORBIDDEN` and keeps granting nothing. Design: ORIGIN `docs/DESKTOP_API_KEY_ACCESS.md`. | ORIGIN `server/desktop-auth.test.ts` (15), `server/desktop-auth.integration.test.ts` (10, real MySQL), `docs/verification/desktop-api-key-probes-2026-10-25.txt` (copy in [`../qa/phase-8-evidence/`](../qa/phase-8-evidence/)) |
| Live read-only connection from Origin Studio | **Verified locally, 2026-10-24 and 2026-10-25**: ORIGIN branch above running with `pnpm dev` on `http://127.0.0.1:5055` against a disposable MySQL 8 container (19 migrations); a dedicated test account, a disposable project and a project-scoped key issued through `apiKeys.create` with `scopes: ["project.read"]`; Origin Studio 0.4.0 (`transport: "http"`) connected, showed the project verified with ORIGIN's name, refused another user's project, a revoked key and a key issued without the scope (status bar "sign in again (forbidden)", nothing stored). Not a production deployment; no reachable deployment carries the change. | Studio `apps/ide/e2e/origin-live.test.ts`, [`../qa/phase-8-evidence/`](../qa/phase-8-evidence/), ORIGIN `docs/verification/desktop-origin-studio-live-2026-10-25.jsonl` |
| Canonical project data | `projects.get({ projectId: number })` behind `requireProjectPermission(user, project, "project.read")`; `projects.list`; permissions come from organisation roles (`server/platform/iam.ts`). | `server/routers.ts` lines 173–232 |
| Sector surfaces | TALA = Aithusa router (`createProposal`, `approveProposal`, `rejectProposal`, `cancelProposal`, `getProposal`, …). AGOS: `shared/agosWorkflow.ts` contract v1, no routes, "planned". LIYAB: sandbox foundation on a draft branch, production refuses every operation. BINHI: standalone product with its own accounts, `docs/ORIGIN_INTEGRATION.md` is a specification. Origin Pocket: **not mentioned anywhere** in ORIGIN, Tala or binhi. | ORIGIN `server/aithusa/router.ts`, ORIGIN-liyab `docs/AGOS_WORKFLOW_CONTRACT.md`, `docs/LIYAB_SANDBOX_FOUNDATION.md`, binhi `docs/ORIGIN_INTEGRATION.md` |
| Process | ORIGIN's own docs record that the "Chaos Origins App Development Workflow" was not found; the installed Sulit Sequence plugin states it replaces that workflow. | `docs/ORIGIN_PRODUCT_DECISIONS.md` "Current blockers"; Sulit Sequence README |

Consequence after Phase 8: the ORIGIN-side change exists and is verified against a local
development ORIGIN; what is missing is a reachable deployment of it, which only the owner can
publish. Until then a shipped build is configured with `mock` or `none`.

## Mocked versus real

| Piece | Real or mock | Notes |
|---|---|---|
| Connection lifecycle (`OriginConnection`) | Real code, tested | connect / disconnect / restore / refresh; states `disconnected`, `connecting`, `connected`, `unauthorized` (invalid, expired, revoked, forbidden), `unavailable` |
| Credential storage (`origin-vault.ts`) | Real | Electron `safeStorage` (DPAPI) in `%AppData%\Origin Studio\origin-credential.bin`; nothing stored without OS encryption |
| Link file reading (`.origin/project.json`) | Real | Through `WorkspaceService` path confinement; validated; never written |
| ORIGIN Core transport `mock` | **Mock** | `MockOriginTransport` fixtures (below) |
| ORIGIN Core transport `http` | Real client, **verified live locally** (Phase 8) | Targets ORIGIN's `auth.me` and `projects.get` with a bearer key; unit-tested against an in-process fake and run against a local ORIGIN development server carrying the desktop-access change; keeps tRPC's error reason on 401/403/404; an ORIGIN without that change answers "null user", reported as unauthorized |
| BINHI, TALA, AGOS, LIYAB, Origin Pocket adapters | **Mock** | `createMockSectorAdapters()`; every `status()` says `transport: "mock"` |
| Offline adapter set | Real | Used whenever the `origin-core` flag is off |

## Connection lifecycle

```text
disconnected ──connect(key)──▶ connecting ──ORIGIN accepts──▶ connected ──refresh──▶ connected
     ▲                           │                                │
     │                           ├─ORIGIN rejects (401/403)──▶ unauthorized (key forgotten)
     │                           └─ORIGIN unreachable──────▶ unavailable (key kept, work continues)
     └──────disconnect()─────────────────────────────────────────┘
```

Rules the code enforces (and the tests check):

1. A key is stored only after ORIGIN accepted it. A malformed key never leaves the interface
   (format check), an invalid, expired or revoked one is reported with the reason and not stored.
2. A key is stored encrypted with the OS user's key; without OS encryption it lives for the
   session only and the status bar's tooltip says so.
3. Unauthorized means forgotten: a revocation noticed on refresh clears the stored key.
4. Unavailable means kept: a network failure changes nothing about the stored key.
5. The key crosses IPC once, when typed (`origin:connect`, a bounded single line). It is never
   sent to the interface afterwards, never logged, never written to a project file, and the
   mock records only its first four characters.
6. Origin Studio uses a credential for reads only. There is no write call in any adapter.
7. With no transport configured the connection refuses to connect and says why.

## Configuration

`%AppData%\Origin Studio\origin.json` (feature `origin-core` must be on, see the README):

```json
{ "transport": "mock" }
{ "transport": "http", "baseUrl": "https://origin.example" }
```

Environment overrides, used by tests: `ORIGIN_STUDIO_ORIGIN_TRANSPORT` (`mock`, `http`,
`none`), `ORIGIN_STUDIO_ORIGIN_URL`, `ORIGIN_STUDIO_ORIGIN_MOCK_OFFLINE=1`. `http` requires
https (http only for localhost). No file means `none`.

### Mock fixtures

| Key (64 chars) | Identity | Result |
|---|---|---|
| `a` × 64 | Mock Owner, org_1, read/write/admin on proj_42 and proj_7 | connected |
| `b` × 64 | Mock Reader, scoped to proj_42, read | connected; proj_7 is forbidden |
| `c` × 64 | — | unauthorized (expired) |
| `d` × 64 | — | unauthorized (revoked) |
| `e` × 64 | No Read | forbidden (no read permission) |

Projects: `proj_42` "Binhi Site" (revision 7), `proj_7` "Agos Pipeline" (revision 2). Any other
id is `NOT_FOUND`.

## ORIGIN Core v2: the project link

`.origin/project.json` needs only `{ "projectId": "…" }`; `"name"` is an optional display hint.
Phase 6 files with `ownerId`, `permissions` and `revision` still parse, but those fields are
ignored. ORIGIN's record is the only source of truth; the IDE never copies ORIGIN data into
the file and never updates it.

| Link resolution | When | Status bar |
|---|---|---|
| `verified` | connected and ORIGIN confirmed the credential may read the project | `<ORIGIN name> ✓` |
| `unverified` (`disconnected`) | not connected, or no server configured | `<hint or id> (unverified)` |
| `unverified` (`unavailable`) | connected but ORIGIN unreachable | same |
| `unauthorized` (`forbidden`, `not-found`, `credential`) | ORIGIN refused this project | `<id> (no access)`, warning |

The link is re-resolved whenever the connection state changes or the link file changes on disk.

## Sector contracts (version 1)

| Sector | Contract | Maps to | Mock behaviour |
|---|---|---|---|
| BINHI | `BinhiAdapterV1`: `listSites`, `getSite`, `requestEditorHandoff` | binhi `docs/ORIGIN_INTEGRATION.md` (identity, ownership, publishing seams); editor handoff is Origin Studio's proposal | Two fixture sites for proj_42; handoff returns a fixture URL the user may open |
| TALA | `TalaAdapterV1`: `capabilities`, `requestApproval`, `getApproval`, `cancelApproval`, `listApprovals`; plus the Phase 6 `TalaProposalAdapter` (propose / decide / markApplied / auditLog) | Aithusa proposals (`createProposal`, `approveProposal`, `rejectProposal`, `cancelProposal`) | Three capabilities (one disabled); approvals pending until `simulateDecision`; decisions final; only pending requests can be cancelled |
| AGOS | `AgosAdapterV1`: `listWorkflows`, `listRuns`, `getRun`; plus `publish(event)` | AGOS workflow contract v1 (`contractVersion`, idempotency key, `completed`/`rejected` outcomes) | One workflow, two runs; events recorded in memory |
| LIYAB | `LiyabAdapterV1`: `snapshot`, `logs`; plus `handOffDeployment` | LIYAB sandbox contract (`simulated` flag, lifecycle and health vocabularies from `shared/platform.ts`) | Simulated builds, tests, runtimes; deployment handoff answers `CONFIRMATION_REQUIRED` (the IDE never deploys) |
| Origin Pocket | `OriginPocketAdapterV1`: `projectSummary`, `activity`, `notifications`, `subscribe` | Nothing in ORIGIN yet; the shape follows binhi's event schema (typed, sector-prefixed, ids only) | Fixture activity and notifications; `subscribe` receives emitted events |

## What a real adapter must do (unchanged, now with precedent)

1. Implement the interface from `@studio/contracts` and return `Result` values only.
2. Pass the existing contract tests (extend them per system before connecting).
3. Run in the Electron main process (credentials never reach the renderer), exposed to the
   interface through new, validated IPC channels — the pattern `origin:*` now follows.
4. Report `status()` honestly, including `transport`.

For ORIGIN Core specifically, ORIGIN's branch `desktop/api-key-read-access` provides exactly
this shape (bearer API keys on `auth.me` and `projects.get`, read-only, scope-checked). The
remaining step is deploying it somewhere reachable and issuing a project-scoped key; then
`apps/ide/e2e/origin-live.test.ts` (`npm run test:e2e:live`) is the acceptance test.
