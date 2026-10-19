import {
  fail,
  ok,
  type AuditRecord,
  type ProposalDecision,
  type ProposedEdit,
  type RelativePath,
  type Result,
  type TalaAdapter
} from "@studio/contracts";

type ProposalState = "proposed" | ProposalDecision | "applied";

/**
 * In-memory Tala used to exercise the approval contract in tests. It does not
 * generate real edits: `makeContent` supplies the proposed text.
 */
export class MockTalaAdapter implements TalaAdapter {
  private readonly proposals = new Map<string, { edit: ProposedEdit; state: ProposalState }>();
  private readonly log: AuditRecord[] = [];
  private nextId = 1;

  constructor(
    private readonly makeContent: (path: RelativePath, instruction: string) => { baseVersion: string; newContent: string },
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  status() {
    return { system: "tala" as const, connected: true, detail: "Mock adapter for contract tests." };
  }

  private audit(actor: AuditRecord["actor"], action: AuditRecord["action"], edit: ProposedEdit): void {
    this.log.push({ at: this.now(), actor, action, proposalId: edit.id, path: edit.path });
  }

  async propose(request: { path: RelativePath; instruction: string }): Promise<Result<ProposedEdit>> {
    const { baseVersion, newContent } = this.makeContent(request.path, request.instruction);
    const edit: ProposedEdit = {
      id: `proposal-${this.nextId++}`,
      path: request.path,
      baseVersion,
      newContent,
      rationale: request.instruction
    };
    this.proposals.set(edit.id, { edit, state: "proposed" });
    this.audit("tala", "proposed", edit);
    return ok(edit);
  }

  async decide(proposalId: string, decision: ProposalDecision): Promise<Result<void>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return fail("NOT_FOUND", `Unknown proposal ${proposalId}.`);
    }
    if (proposal.state !== "proposed") {
      return fail("CONFLICT", `Proposal ${proposalId} was already ${proposal.state}.`);
    }
    proposal.state = decision;
    this.audit("user", decision, proposal.edit);
    return ok(undefined);
  }

  async markApplied(proposalId: string): Promise<Result<void>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return fail("NOT_FOUND", `Unknown proposal ${proposalId}.`);
    }
    if (proposal.state !== "approved") {
      return fail("CONFIRMATION_REQUIRED", "A proposed edit can only be applied after the user approves it.");
    }
    proposal.state = "applied";
    this.audit("user", "applied", proposal.edit);
    return ok(undefined);
  }

  async auditLog(): Promise<Result<AuditRecord[]>> {
    return ok([...this.log]);
  }
}
