/*
 * ORIGIN integration boundaries. Phase 7 adds a connection lifecycle and
 * versioned sector contracts; what is real and what is mocked is recorded in
 * docs/integration/README.md. The IDE's local workflow never depends on any
 * of this.
 */
import type { Result } from "../result.js";
import type { RelativePath } from "../workspace.js";
import type { OriginCredential, OriginProjectLink, OriginProjectResolution, OriginTransportKind } from "./connection.js";

export * from "./connection.js";
export * from "./services.js";

export interface IntegrationStatus {
  system: "origin-core" | "binhi" | "tala" | "agos" | "liyab" | "pocket";
  connected: boolean;
  /** Human-readable explanation, e.g. why it is offline. */
  detail: string;
  /** What the adapter talks to. Mocks say so; nothing pretends to be real. */
  transport: OriginTransportKind;
  contractVersion: number;
}

export interface IntegrationAdapter {
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
  /** Permissions the connected credential holds on this project. */
  permissions: OriginPermission[];
  /** Monotonic revision of ORIGIN's structured project state. */
  revision: number;
}

export type SyncState =
  | { phase: "local-only" }
  | { phase: "linked"; revision: number }
  | { phase: "syncing"; fromRevision: number }
  | { phase: "conflict"; localRevision: number; remoteRevision: number };

export const ORIGIN_CORE_CONTRACT_VERSION = 2 as const;

/**
 * ORIGIN Core, version 2: the link file names a project; ORIGIN (through the
 * connection) is the only source of its metadata and of whether the
 * credential may read it. Nothing here writes to ORIGIN or to the workspace.
 */
export interface OriginCoreAdapter extends IntegrationAdapter {
  /** Reads the workspace's link file, if any. INVALID_ARGUMENT when it is malformed. */
  findLink(workspaceRoot: string): Promise<Result<OriginProjectLink | null>>;
  /** Asks ORIGIN about the linked project with the given credential (null when not connected). */
  resolveProject(link: OriginProjectLink, credential: OriginCredential | null): Promise<Result<OriginProjectResolution>>;
  syncState(projectId: OriginProjectId): Promise<Result<SyncState>>;
}

/* ---------- Tala, phase 6 proposal contract (kept; tested) ---------- */

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

export interface TalaProposalAdapter extends IntegrationAdapter {
  /** Tala may only propose. Applying is a separate, user-approved step. */
  propose(request: { path: RelativePath; instruction: string }): Promise<Result<ProposedEdit>>;
  decide(proposalId: string, decision: ProposalDecision): Promise<Result<void>>;
  /** Fails unless the proposal was approved by the user. */
  markApplied(proposalId: string): Promise<Result<void>>;
  auditLog(): Promise<Result<AuditRecord[]>>;
}

/* ---------- Agos and Liyab, phase 6 event contract (kept) ---------- */

export type WorkflowEvent =
  | { type: "file-saved"; path: RelativePath }
  | { type: "workspace-opened"; root: string }
  | { type: "command-finished"; command: string; exitCode: number };

export interface DeploymentHandoff {
  projectId: OriginProjectId;
  /** Origin Studio prepares the request; ORIGIN governs approval and execution. */
  requestedBy: string;
  sourceRevision: string;
}

/* ---------- The adapter set the host assembles ---------- */

import type { AgosAdapterV1, BinhiAdapterV1, LiyabAdapterV1, OriginPocketAdapterV1, TalaAdapterV1 } from "./services.js";

export interface OriginAdapters {
  core: OriginCoreAdapter;
  binhi: BinhiAdapterV1 & IntegrationAdapter;
  tala: TalaAdapterV1 & TalaProposalAdapter;
  agos: AgosAdapterV1 & IntegrationAdapter & { publish(event: WorkflowEvent): Promise<Result<void>> };
  liyab: LiyabAdapterV1 & IntegrationAdapter & { handOffDeployment(request: DeploymentHandoff): Promise<Result<{ ticketId: string }>> };
  pocket: OriginPocketAdapterV1 & IntegrationAdapter;
}
