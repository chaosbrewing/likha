import {
  TALA_CONTRACT_VERSION,
  fail,
  ok,
  type AuditRecord,
  type IntegrationStatus,
  type OriginProjectId,
  type ProposalDecision,
  type ProposedEdit,
  type RelativePath,
  type Result,
  type TalaAdapterV1,
  type TalaApprovalRequest,
  type TalaCapability,
  type TalaProposalAdapter
} from "@studio/contracts";

type ProposalState = "proposed" | ProposalDecision | "applied";

/**
 * Fixture capabilities. Mirrors what ORIGIN's Aithusa surface offers today
 * (proposals that a human approves or rejects) and what is only planned.
 */
export const MOCK_TALA_CAPABILITIES: TalaCapability[] = [
  { id: "propose-edit", label: "Propose a code edit", description: "Tala proposes an edit as a diff; nothing is applied until you approve it.", requiresApproval: true, enabled: true },
  { id: "explain-code", label: "Explain selected code", description: "Read-only explanation of code you select.", requiresApproval: false, enabled: true },
  { id: "run-workflow", label: "Run an AGOS workflow", description: "Planned: Tala may request a workflow run, which ORIGIN executes after approval.", requiresApproval: true, enabled: false }
];

/**
 * In-memory Tala: the Phase 6 proposal contract (propose, decide, apply) plus
 * the Phase 7 capability and approval contract. It does not generate real
 * edits: `makeContent` supplies the proposed text. Decisions arrive through
 * `simulateDecision`, standing in for ORIGIN's Aithusa approval procedures.
 */
export class MockTalaAdapter implements TalaProposalAdapter, TalaAdapterV1 {
  readonly contractVersion = TALA_CONTRACT_VERSION;
  private readonly proposals = new Map<string, { edit: ProposedEdit; state: ProposalState }>();
  private readonly approvals = new Map<string, TalaApprovalRequest>();
  private readonly log: AuditRecord[] = [];
  private nextId = 1;

  constructor(
    private readonly makeContent: (path: RelativePath, instruction: string) => { baseVersion: string; newContent: string } = () => ({ baseVersion: "", newContent: "" }),
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  status(): IntegrationStatus {
    return { system: "tala", connected: true, transport: "mock", contractVersion: TALA_CONTRACT_VERSION, detail: "Mock Tala: fixture capabilities; approvals decided only through simulateDecision (tests)." };
  }

  /* ---------- Phase 6 proposal contract ---------- */

  private audit(actor: AuditRecord["actor"], action: AuditRecord["action"], edit: ProposedEdit): void {
    this.log.push({ at: this.now(), actor, action, proposalId: edit.id, path: edit.path });
  }

  async propose(request: { path: RelativePath; instruction: string }): Promise<Result<ProposedEdit>> {
    const { baseVersion, newContent } = this.makeContent(request.path, request.instruction);
    const edit: ProposedEdit = { id: `proposal-${this.nextId++}`, path: request.path, baseVersion, newContent, rationale: request.instruction };
    this.proposals.set(edit.id, { edit, state: "proposed" });
    this.audit("tala", "proposed", edit);
    return ok(edit);
  }

  async decide(proposalId: string, decision: ProposalDecision): Promise<Result<void>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return fail("NOT_FOUND", `Unknown proposal ${proposalId}.`);
    if (proposal.state !== "proposed") return fail("CONFLICT", `Proposal ${proposalId} was already ${proposal.state}.`);
    proposal.state = decision;
    this.audit("user", decision, proposal.edit);
    return ok(undefined);
  }

  async markApplied(proposalId: string): Promise<Result<void>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return fail("NOT_FOUND", `Unknown proposal ${proposalId}.`);
    if (proposal.state !== "approved") return fail("CONFIRMATION_REQUIRED", "A proposed edit can only be applied after the user approves it.");
    proposal.state = "applied";
    this.audit("user", "applied", proposal.edit);
    return ok(undefined);
  }

  async auditLog(): Promise<Result<AuditRecord[]>> {
    return ok([...this.log]);
  }

  /* ---------- Phase 7 capability and approval contract ---------- */

  async capabilities(_projectId: OriginProjectId): Promise<Result<TalaCapability[]>> {
    return ok(MOCK_TALA_CAPABILITIES.map((c) => ({ ...c })));
  }

  async requestApproval(request: { projectId: OriginProjectId; capabilityId: string; intent: string; paths: RelativePath[] }): Promise<Result<TalaApprovalRequest>> {
    const capability = MOCK_TALA_CAPABILITIES.find((c) => c.id === request.capabilityId);
    if (!capability) return fail("NOT_FOUND", `Tala has no capability "${request.capabilityId}".`);
    if (!capability.enabled) return fail("NOT_CONNECTED", `"${capability.label}" is not enabled in ORIGIN yet.`);
    if (!request.intent.trim()) return fail("INVALID_ARGUMENT", "An approval request needs an intent.");
    const approval: TalaApprovalRequest = {
      id: `approval-${this.nextId++}`,
      projectId: request.projectId,
      capabilityId: request.capabilityId,
      intent: request.intent.trim(),
      paths: [...request.paths],
      status: capability.requiresApproval ? "pending" : "approved",
      requestedAt: this.now(),
      decidedAt: capability.requiresApproval ? null : this.now(),
      decidedBy: capability.requiresApproval ? null : "policy:no-approval-needed"
    };
    this.approvals.set(approval.id, approval);
    return ok({ ...approval });
  }

  async getApproval(requestId: string): Promise<Result<TalaApprovalRequest>> {
    const approval = this.approvals.get(requestId);
    return approval ? ok({ ...approval }) : fail("NOT_FOUND", `Unknown approval request ${requestId}.`);
  }

  async cancelApproval(requestId: string): Promise<Result<TalaApprovalRequest>> {
    const approval = this.approvals.get(requestId);
    if (!approval) return fail("NOT_FOUND", `Unknown approval request ${requestId}.`);
    if (approval.status !== "pending") return fail("CONFLICT", `Approval request ${requestId} is already ${approval.status}.`);
    approval.status = "cancelled";
    approval.decidedAt = this.now();
    approval.decidedBy = "requester";
    return ok({ ...approval });
  }

  async listApprovals(projectId: OriginProjectId): Promise<Result<TalaApprovalRequest[]>> {
    return ok([...this.approvals.values()].filter((a) => a.projectId === projectId).map((a) => ({ ...a })));
  }

  /** Test hook standing in for ORIGIN's approveProposal / rejectProposal: only pending requests can be decided, once. */
  simulateDecision(requestId: string, status: "approved" | "rejected" | "expired", decidedBy: string): Result<TalaApprovalRequest> {
    const approval = this.approvals.get(requestId);
    if (!approval) return fail("NOT_FOUND", `Unknown approval request ${requestId}.`);
    if (approval.status !== "pending") return fail("CONFLICT", `Approval request ${requestId} is already ${approval.status}.`);
    approval.status = status;
    approval.decidedAt = this.now();
    approval.decidedBy = decidedBy;
    return ok({ ...approval });
  }
}
