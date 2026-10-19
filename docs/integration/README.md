# ORIGIN integration readiness

**Status: none of these integrations are connected.** Origin Studio runs entirely locally and
needs no ORIGIN account or internet connection. This document defines the boundaries that
later phases will connect, so that the IDE's local workflow does not have to be reshaped.

- Interfaces: [`packages/contracts/src/origin/index.ts`](../../packages/contracts/src/origin/index.ts)
- Current adapters: [`packages/origin-adapter`](../../packages/origin-adapter) — `createOfflineAdapters()` (every
  call returns `NOT_CONNECTED`) and `MockTalaAdapter` (in-memory, for contract tests)
- Contract tests: [`packages/origin-adapter/test/adapters.test.ts`](../../packages/origin-adapter/test/adapters.test.ts)

## Principles

1. **Local first.** Opening, editing, saving and running a project never waits on ORIGIN. A
   missing or failing connection degrades to local mode; it never blocks editing.
2. **ORIGIN owns canonical state.** Project identity, ownership, permissions, AI orchestration
   and deployment governance belong to ORIGIN. Origin Studio does not keep its own copy; it
   reads and requests.
3. **Adapters, not imports.** The IDE depends only on the interfaces in `@studio/contracts`.
   Real adapters will be new implementations in `@studio/origin-adapter`, chosen at start-up.
4. **Every call returns a `Result`.** No adapter throws across the boundary; `NOT_CONNECTED`
   is an ordinary, displayable outcome.
5. **Nothing changes files without the user.** Edits from any ORIGIN system arrive as
   proposals that go through the same save path (version check, conflict dialog) as typing.

## Systems

### ORIGIN Core — project identity and state

| | |
|---|---|
| Interface | `OriginCoreAdapter`: `findLinkedProject(workspaceRoot)`, `syncState(projectId)` |
| Types | `OriginProjectId` (opaque, branded), `OriginProjectRecord` (owner, permissions, revision), `SyncState` (`local-only` → `linked` → `syncing` / `conflict`) |
| Connection point | After `WorkspaceService.open()` in `apps/ide/electron/main.ts` (`openWorkspace`): look up the linked project and surface it in `WorkspaceInfo` and the status bar (where "Local" is shown today) |
| Origin Studio owns | The local folder and its files |
| ORIGIN owns | Canonical project id, ownership, permissions, structured project state, sync lifecycle |
| Open questions | How a local folder is linked (marker file vs. ORIGIN-side record); offline edits reconciliation policy |

### Binhi — website projects

| | |
|---|---|
| Interface | `BinhiAdapter`: `importSite(projectId, targetRoot)`, `exportSite(manifest, workspaceRoot)` |
| Types | `BinhiExportManifest` separates `editableFiles` (generated source the developer may edit) from `intentFiles` (structured page/design intent that must round-trip unchanged) |
| Connection point | A future "Import from Binhi" command that writes into a new folder (never an existing non-empty one, matching `chaos init`), then opens it as a workspace |
| Rule | Intent files are read-only in the editor until Binhi defines an editable form; export fails rather than silently dropping intent |

### Tala — authorized intelligence

| | |
|---|---|
| Interface | `TalaAdapter`: `propose`, `decide(approved/rejected)`, `markApplied`, `auditLog` |
| Types | `ProposedEdit` carries `baseVersion` (the same `FileVersion` the editor uses), `AuditRecord` records actor and action |
| Contract (tested) | A proposal cannot be applied until the user approves it; a decision cannot be changed afterwards; every step is audited |
| Connection point | Proposals open as a diff in the editor; applying uses `workspace.writeFile` with `expectedVersion = baseVersion`, so a file changed since the proposal is a `CONFLICT`, not an overwrite |
| Not allowed | Tala never gets terminal access or direct filesystem access. The terminal stays behind explicit user input |

### Agos — workflow events and tasks

| | |
|---|---|
| Interface | `AgosAdapter`: `publish(event)`, `tasks()` |
| Events | `file-saved`, `workspace-opened`, `command-finished` |
| Connection point | The places the IDE already logs these events to the Output panel (`useDocuments.save`, `openWorkspace`); terminal command completion would need shell integration first |
| Rule | Publishing is fire-and-forget from the user's point of view; a failure is logged, never shown as a blocking error |

### Liyab — build, runtime, preview, deployment

| | |
|---|---|
| Interface | `LiyabAdapter`: `capabilities`, `startPreview`, `logs`, `handOffDeployment` |
| Connection point | A future "Preview" panel next to Terminal/Output/Problems; logs stream into it like terminal output |
| Rule | Origin Studio prepares a `DeploymentHandoff`; approval and execution stay in ORIGIN. The IDE never deploys by itself |

## What a real adapter must do

1. Implement the interface from `@studio/contracts` and return `Result` values only.
2. Pass the existing contract tests (extend them per system before connecting).
3. Run in the Electron main process (credentials never reach the renderer), exposed to the
   interface through new, validated IPC channels — the same pattern as `workspace:*`.
4. Report `status()` honestly so the status bar can show connected / offline.
