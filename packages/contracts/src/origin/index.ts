/*
 * Future ORIGIN integration boundaries. Nothing here is connected yet: these
 * interfaces define what Origin Studio expects from each ORIGIN system so the
 * IDE can be wired to them later without reshaping its local workflow.
 * See docs/integration/README.md.
 */
import type { Result } from "../result.js";
import type { RelativePath } from "../workspace.js";

export interface IntegrationStatus {
  system: "origin-core" | "binhi" | "tala" | "agos" | "liyab";
  connected: boolean;
  /** Human-readable explanation, e.g. why it is offline. */
  detail: string;
}

interface IntegrationAdapter {
  status(): IntegrationStatus;
}

/* ---------- ORIGIN Core: canonical project identity and state ---------- */

/** ORIGIN's canonical project identifier. Opaque to Origin Studio. */
export type OriginProjectId = string & { readonly __brand: "OriginProjectId" };

export type OriginPermission = "read" | "write" | "admin";

export interface OriginProjectRecord {
  id: OriginProjectId;
  name: string;
  ownerId: string;
  /** Permissions the signed-in user holds on this project. */
  permissions: OriginPermission[];
  /** Monotonic revision of ORIGIN's structured project state. */
  revision: number;
}

export type SyncState =
  | { phase: "local-only" }
  | { phase: "linked"; revision: number }
  | { phase: "syncing"; fromRevision: number }
  | { phase: "conflict"; localRevision: number; remoteRevision: number };

export interface OriginCoreAdapter extends IntegrationAdapter {
  /** Looks up the ORIGIN project linked to a local workspace, if any. */
  findLinkedProject(workspaceRoot: string): Promise<Result<OriginProjectRecord | null>>;
  syncState(projectId: OriginProjectId): Promise<Result<SyncState>>;
}

/* ---------- Binhi: website project import / export ---------- */

export interface BinhiExportManifest {
  projectId: OriginProjectId;
  /** Files Binhi generated and Origin Studio may edit as ordinary source. */
  editableFiles: RelativePath[];
  /** Structured intent Binhi needs back unchanged (page model, design tokens). */
  intentFiles: RelativePath[];
}

export interface BinhiAdapter extends IntegrationAdapter {
  importSite(projectId: OriginProjectId, targetRoot: string): Promise<Result<BinhiExportManifest>>;
  /** Returns edited source to Binhi; intent files must be preserved. */
  exportSite(manifest: BinhiExportManifest, workspaceRoot: string): Promise<Result<void>>;
}

/* ---------- Tala: authorized intelligence with approval and audit ---------- */

export interface ProposedEdit {
  id: string;
  path: RelativePath;
  /** The file version the proposal was computed against. */
  baseVersion: string;
  newContent: string;
  rationale: string;
}

export type ProposalDecision = "approved" | "rejected";

export interface AuditRecord {
  at: string;
  actor: "user" | "tala";
  action: "proposed" | "approved" | "rejected" | "applied";
  proposalId: string;
  path: RelativePath;
}

export interface TalaAdapter extends IntegrationAdapter {
  /** Tala may only propose. Applying is a separate, user-approved step. */
  propose(request: { path: RelativePath; instruction: string }): Promise<Result<ProposedEdit>>;
  decide(proposalId: string, decision: ProposalDecision): Promise<Result<void>>;
  /** Fails unless the proposal was approved by the user. */
  markApplied(proposalId: string): Promise<Result<void>>;
  auditLog(): Promise<Result<AuditRecord[]>>;
}

/* ---------- Agos: development workflow events and tasks ---------- */

export type WorkflowEvent =
  | { type: "file-saved"; path: RelativePath }
  | { type: "workspace-opened"; root: string }
  | { type: "command-finished"; command: string; exitCode: number };

export interface WorkflowTask {
  id: string;
  title: string;
  trigger: WorkflowEvent["type"];
  state: "pending" | "running" | "done" | "failed";
}

export interface AgosAdapter extends IntegrationAdapter {
  publish(event: WorkflowEvent): Promise<Result<void>>;
  tasks(): Promise<Result<WorkflowTask[]>>;
}

/* ---------- Liyab: build, runtime, preview and deployment handoff ---------- */

export interface BuildCapability {
  id: string;
  label: string;
}

export interface PreviewSession {
  id: string;
  url: string;
  startedAt: string;
}

export interface DeploymentHandoff {
  projectId: OriginProjectId;
  /** Origin Studio prepares the request; ORIGIN governs approval and execution. */
  requestedBy: string;
  sourceRevision: string;
}

export interface LiyabAdapter extends IntegrationAdapter {
  capabilities(): Promise<Result<BuildCapability[]>>;
  startPreview(projectId: OriginProjectId): Promise<Result<PreviewSession>>;
  logs(sessionId: string): Promise<Result<string[]>>;
  handOffDeployment(request: DeploymentHandoff): Promise<Result<{ ticketId: string }>>;
}

export interface OriginAdapters {
  core: OriginCoreAdapter;
  binhi: BinhiAdapter;
  tala: TalaAdapter;
  agos: AgosAdapter;
  liyab: LiyabAdapter;
}
