/*
 * Versioned contracts for the ORIGIN sectors and Origin Pocket (Phase 7).
 *
 * Each interface carries a contract version. Implementations today are mock
 * adapters with documented fixtures: no ORIGIN sector exposes an endpoint a
 * desktop client can reach yet (see docs/integration/README.md for what was
 * verified). The shapes follow what the sector repositories define for
 * themselves (ORIGIN's Aithusa proposals, the AGOS workflow contract v1, the
 * LIYAB sandbox contract, BINHI's ORIGIN integration plan), so a real adapter
 * is a transport change, not a contract change.
 */
import type { Result } from "../result.js";
import type { RelativePath } from "../workspace.js";
import type { OriginProjectId } from "./index.js";

export interface SectorContract {
  readonly contractVersion: number;
}

/* ---------- BINHI: website project metadata and editor handoff ---------- */

export const BINHI_CONTRACT_VERSION = 1 as const;

export interface BinhiSiteSummary {
  siteId: string;
  projectId: OriginProjectId;
  name: string;
  status: "draft" | "published" | "unpublished";
  /** Live URL when published. */
  publishedUrl: string | null;
  /** Revision of BINHI's canonical document. */
  revision: number;
  updatedAt: string;
}

/** A request to open a site in BINHI's editor from LIKHA. BINHI decides and answers with where to go. */
export interface BinhiEditorHandoff {
  handoffId: string;
  siteId: string;
  /** Opened by the user, never followed automatically. */
  editorUrl: string;
  expiresAt: string;
}

export interface BinhiAdapterV1 extends SectorContract {
  readonly contractVersion: typeof BINHI_CONTRACT_VERSION;
  listSites(projectId: OriginProjectId): Promise<Result<BinhiSiteSummary[]>>;
  getSite(siteId: string): Promise<Result<BinhiSiteSummary>>;
  /** Future editor handoff; a mock answers with a fixture URL, a real adapter asks BINHI. */
  requestEditorHandoff(siteId: string): Promise<Result<BinhiEditorHandoff>>;
}

/* ---------- TALA: authorized AI capabilities and approval requests ---------- */

export const TALA_CONTRACT_VERSION = 1 as const;

export interface TalaCapability {
  id: string;
  label: string;
  description: string;
  /** Every capability that changes anything needs an approved request first. */
  requiresApproval: boolean;
  /** False until ORIGIN has switched the capability on; mocks report their fixture value. */
  enabled: boolean;
}

export type TalaApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export interface TalaApprovalRequest {
  id: string;
  projectId: OriginProjectId;
  capabilityId: string;
  /** What the user asked for, in their words. */
  intent: string;
  /** Files the request may touch; empty means none. */
  paths: RelativePath[];
  status: TalaApprovalStatus;
  requestedAt: string;
  decidedAt: string | null;
  /** Who decided: ORIGIN records the actor; the IDE never decides for the user. */
  decidedBy: string | null;
}

export interface TalaAdapterV1 extends SectorContract {
  readonly contractVersion: typeof TALA_CONTRACT_VERSION;
  capabilities(projectId: OriginProjectId): Promise<Result<TalaCapability[]>>;
  requestApproval(request: { projectId: OriginProjectId; capabilityId: string; intent: string; paths: RelativePath[] }): Promise<Result<TalaApprovalRequest>>;
  getApproval(requestId: string): Promise<Result<TalaApprovalRequest>>;
  /** Only the requester may withdraw, and only while pending. */
  cancelApproval(requestId: string): Promise<Result<TalaApprovalRequest>>;
  listApprovals(projectId: OriginProjectId): Promise<Result<TalaApprovalRequest[]>>;
}

/* ---------- AGOS: workflow and execution status ---------- */

export const AGOS_CONTRACT_VERSION = 1 as const;

export type AgosRunState = "pending" | "running" | "completed" | "rejected" | "failed";

export interface AgosWorkflowSummary {
  workflowId: string;
  name: string;
  /** AGOS's own contract version for the definition (`AGOS_WORKFLOW_CONTRACT_VERSION`). */
  definitionVersion: number;
  stepCount: number;
}

export interface AgosRunStatus {
  runId: string;
  workflowId: string;
  state: AgosRunState;
  idempotencyKey: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Present when `state` is rejected or failed. */
  reason: string | null;
}

export interface AgosAdapterV1 extends SectorContract {
  readonly contractVersion: typeof AGOS_CONTRACT_VERSION;
  listWorkflows(projectId: OriginProjectId): Promise<Result<AgosWorkflowSummary[]>>;
  listRuns(projectId: OriginProjectId, options?: { workflowId?: string; limit?: number }): Promise<Result<AgosRunStatus[]>>;
  getRun(runId: string): Promise<Result<AgosRunStatus>>;
}

/* ---------- LIYAB: build, test and runtime status ---------- */

export const LIYAB_CONTRACT_VERSION = 1 as const;

export type LiyabOutcome = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export interface LiyabBuildStatus {
  buildId: string;
  pipelineId: string;
  commit: string | null;
  outcome: LiyabOutcome;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface LiyabTestStatus {
  runId: string;
  buildId: string | null;
  outcome: LiyabOutcome;
  passed: number;
  failed: number;
  skipped: number;
  finishedAt: string | null;
}

export interface LiyabRuntimeStatus {
  runtimeId: string;
  name: string;
  environment: "development" | "staging" | "production";
  health: "unknown" | "healthy" | "degraded" | "unhealthy";
  lifecycle: "pending" | "provisioning" | "active" | "updating" | "deleting" | "deleted" | "failed";
  url: string | null;
  deployedImage: string | null;
}

export interface LiyabStatusSnapshot {
  projectId: OriginProjectId;
  observedAt: string;
  builds: LiyabBuildStatus[];
  tests: LiyabTestStatus[];
  runtimes: LiyabRuntimeStatus[];
  /** Simulated means a sandbox produced these, not real infrastructure. */
  simulated: boolean;
}

export interface LiyabAdapterV1 extends SectorContract {
  readonly contractVersion: typeof LIYAB_CONTRACT_VERSION;
  snapshot(projectId: OriginProjectId): Promise<Result<LiyabStatusSnapshot>>;
  /** Log lines for one build or runtime; read-only. */
  logs(target: { kind: "build" | "runtime"; id: string }, options?: { limit?: number }): Promise<Result<string[]>>;
}

/* ---------- ORIGIN POCKET: project summaries, activity and notifications ---------- */

export const POCKET_CONTRACT_VERSION = 1 as const;

export interface PocketProjectSummary {
  projectId: OriginProjectId;
  name: string;
  health: "unknown" | "healthy" | "attention" | "failing";
  lastActivityAt: string | null;
  openApprovals: number;
  failedBuilds: number;
  publishedSites: number;
}

export interface PocketActivityEvent {
  id: string;
  projectId: OriginProjectId;
  /** Dotted, sector-prefixed type, e.g. "binhi.site.published", "liyab.build.failed". */
  type: string;
  occurredAt: string;
  actor: { kind: "user" | "system" | "tala"; id: string };
  summary: string;
}

export interface PocketNotification {
  id: string;
  projectId: OriginProjectId | null;
  level: "info" | "warning" | "action-required";
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface OriginPocketAdapterV1 extends SectorContract {
  readonly contractVersion: typeof POCKET_CONTRACT_VERSION;
  projectSummary(projectId: OriginProjectId): Promise<Result<PocketProjectSummary>>;
  activity(projectId: OriginProjectId, options?: { since?: string; limit?: number }): Promise<Result<PocketActivityEvent[]>>;
  notifications(options?: { unreadOnly?: boolean }): Promise<Result<PocketNotification[]>>;
  /** Pushed events; the returned function stops them. */
  subscribe(listener: (event: PocketActivityEvent | PocketNotification) => void): () => void;
}
