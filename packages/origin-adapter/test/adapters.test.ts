import test from "node:test";
import assert from "node:assert/strict";
import type { OriginAdapters, OriginProjectId, PocketNotification } from "@studio/contracts";
import { MockTalaAdapter, createMockSectorAdapters, createOfflineAdapters, mockSectorHooks } from "../src/index.ts";

const P42 = "proj_42" as OriginProjectId;
const P7 = "proj_7" as OriginProjectId;

test("every ORIGIN system reports offline in local mode, with its contract version", () => {
  const adapters: OriginAdapters = createOfflineAdapters();
  for (const [key, adapter] of Object.entries(adapters)) {
    const status = adapter.status();
    assert.equal(status.connected, false, key);
    assert.equal(status.transport, "none", key);
    assert.ok(status.contractVersion >= 1, key);
    assert.match(status.detail, /local mode/);
  }
  assert.deepEqual(
    Object.values(adapters).map((a) => a.status().system).sort(),
    ["agos", "binhi", "liyab", "origin-core", "pocket", "tala"]
  );
});

test("offline adapters fail every call with NOT_CONNECTED instead of throwing", async () => {
  const { core, binhi, tala, agos, liyab, pocket } = createOfflineAdapters();
  const results = await Promise.all([
    core.findLink("C:\\project"),
    core.resolveProject({ projectId: P42, nameHint: null }, null),
    core.syncState(P42),
    binhi.listSites(P42),
    binhi.requestEditorHandoff("site_1"),
    tala.propose({ path: "a.ts", instruction: "x" }),
    tala.capabilities(P42),
    tala.requestApproval({ projectId: P42, capabilityId: "propose-edit", intent: "x", paths: [] }),
    agos.listRuns(P7),
    agos.publish({ type: "file-saved", path: "a.ts" }),
    liyab.snapshot(P7),
    liyab.handOffDeployment({ projectId: P7, requestedBy: "me", sourceRevision: "abc" }),
    pocket.projectSummary(P42),
    pocket.notifications()
  ]);
  for (const result of results) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "NOT_CONNECTED");
  }
  assert.equal(typeof pocket.subscribe(() => undefined), "function");
});

test("Tala contract: proposed edits cannot be applied without user approval, and every step is audited", async () => {
  const tala = new MockTalaAdapter(() => ({ baseVersion: "v1", newContent: "new" }), () => "2026-01-01T00:00:00.000Z");

  const first = await tala.propose({ path: "src/a.ts", instruction: "rename variable" });
  assert.ok(first.ok);
  const blocked = await tala.markApplied(first.value.id);
  assert.equal(!blocked.ok && blocked.error.code, "CONFIRMATION_REQUIRED");

  assert.ok((await tala.decide(first.value.id, "approved")).ok);
  assert.ok((await tala.markApplied(first.value.id)).ok);
  const twice = await tala.decide(first.value.id, "rejected");
  assert.equal(!twice.ok && twice.error.code, "CONFLICT", "a decision cannot be changed after the fact");

  const second = await tala.propose({ path: "src/b.ts", instruction: "x" });
  assert.ok(second.ok);
  assert.ok((await tala.decide(second.value.id, "rejected")).ok);
  const rejected = await tala.markApplied(second.value.id);
  assert.equal(!rejected.ok && rejected.error.code, "CONFIRMATION_REQUIRED");

  const log = await tala.auditLog();
  assert.ok(log.ok);
  assert.deepEqual(
    log.value.map((r) => `${r.actor}:${r.action}:${r.path}`),
    ["tala:proposed:src/a.ts", "user:approved:src/a.ts", "user:applied:src/a.ts", "tala:proposed:src/b.ts", "user:rejected:src/b.ts"]
  );
});

test("Tala v1: capabilities are declared, approval requests are pending until ORIGIN decides, and decisions are final", async () => {
  const tala = new MockTalaAdapter(undefined, () => "2026-10-24T00:00:00.000Z");
  assert.equal(tala.contractVersion, 1);
  const capabilities = await tala.capabilities(P42);
  assert.ok(capabilities.ok);
  assert.deepEqual(capabilities.value.map((c) => `${c.id}:${c.requiresApproval}:${c.enabled}`), ["propose-edit:true:true", "explain-code:false:true", "run-workflow:true:false"]);

  const disabled = await tala.requestApproval({ projectId: P42, capabilityId: "run-workflow", intent: "run", paths: [] });
  assert.equal(!disabled.ok && disabled.error.code, "NOT_CONNECTED");
  const unknown = await tala.requestApproval({ projectId: P42, capabilityId: "nope", intent: "x", paths: [] });
  assert.equal(!unknown.ok && unknown.error.code, "NOT_FOUND");
  const empty = await tala.requestApproval({ projectId: P42, capabilityId: "propose-edit", intent: "  ", paths: [] });
  assert.equal(!empty.ok && empty.error.code, "INVALID_ARGUMENT");

  const request = await tala.requestApproval({ projectId: P42, capabilityId: "propose-edit", intent: "Rename greet", paths: ["src/index.ts"] });
  assert.ok(request.ok && request.value.status === "pending" && request.value.decidedBy === null);
  const explain = await tala.requestApproval({ projectId: P42, capabilityId: "explain-code", intent: "Explain", paths: [] });
  assert.ok(explain.ok && explain.value.status === "approved" && explain.value.decidedBy === "policy:no-approval-needed");

  const decided = tala.simulateDecision(request.value.id, "approved", "user_owner");
  assert.ok(decided.ok && decided.value.decidedAt === "2026-10-24T00:00:00.000Z");
  assert.equal(!tala.simulateDecision(request.value.id, "rejected", "user_owner").ok, true, "a decision is final");
  const cancelLate = await tala.cancelApproval(request.value.id);
  assert.equal(!cancelLate.ok && cancelLate.error.code, "CONFLICT");

  const another = await tala.requestApproval({ projectId: P42, capabilityId: "propose-edit", intent: "Other", paths: [] });
  assert.ok(another.ok);
  const cancelled = await tala.cancelApproval(another.value.id);
  assert.ok(cancelled.ok && cancelled.value.status === "cancelled");
  const list = await tala.listApprovals(P42);
  assert.ok(list.ok);
  assert.deepEqual(list.value.map((a) => a.status), ["approved", "approved", "cancelled"]);
  assert.deepEqual(await tala.listApprovals(P7), { ok: true, value: [] });
});

test("mock BINHI, AGOS, LIYAB and Pocket answer with fixtures and say they are mocks", async () => {
  const adapters = createMockSectorAdapters({ now: () => "2026-10-24T00:00:00.000Z" });
  for (const key of ["binhi", "agos", "liyab", "pocket", "tala"] as const) {
    const status = adapters[key].status();
    assert.equal(status.transport, "mock", key);
    assert.match(status.detail, /[Mm]ock/, key);
  }

  const sites = await adapters.binhi.listSites(P42);
  assert.ok(sites.ok && sites.value.length === 2 && sites.value[0]?.status === "published");
  assert.deepEqual(await adapters.binhi.listSites(P7), { ok: true, value: [] });
  const handoff = await adapters.binhi.requestEditorHandoff("site_2");
  assert.ok(handoff.ok && handoff.value.editorUrl.startsWith("https://") && handoff.value.expiresAt > "2026-10-24T00:00:00.000Z");
  assert.equal(!(await adapters.binhi.getSite("nope")).ok, true);

  const workflows = await adapters.agos.listWorkflows(P7);
  assert.ok(workflows.ok && workflows.value[0]?.definitionVersion === 1);
  const runs = await adapters.agos.listRuns(P7, { limit: 1 });
  assert.ok(runs.ok && runs.value.length === 1 && runs.value[0]?.state === "completed");
  const rejectedRun = await adapters.agos.getRun("run_2");
  assert.ok(rejectedRun.ok && rejectedRun.value.state === "rejected" && rejectedRun.value.reason === "invalid_input");
  assert.ok((await adapters.agos.publish({ type: "workspace-opened", root: "C:\\p" })).ok);
  assert.equal(mockSectorHooks(adapters).agosEvents.length, 1);

  const snapshot = await adapters.liyab.snapshot(P7);
  assert.ok(snapshot.ok && snapshot.value.simulated === true && snapshot.value.builds.length === 2);
  const logs = await adapters.liyab.logs({ kind: "build", id: "build_9" }, { limit: 2 });
  assert.ok(logs.ok && logs.value.length === 2);
  const handoffDeploy = await adapters.liyab.handOffDeployment({ projectId: P7, requestedBy: "me", sourceRevision: "abc" });
  assert.equal(!handoffDeploy.ok && handoffDeploy.error.code, "CONFIRMATION_REQUIRED", "the IDE never deploys by itself");

  const summary = await adapters.pocket.projectSummary(P7);
  assert.ok(summary.ok);
  assert.deepEqual(summary.value, { projectId: P7, name: "Agos Pipeline", health: "attention", lastActivityAt: "2026-10-23T11:54:00.000Z", openApprovals: 0, failedBuilds: 1, publishedSites: 0 });
  const activity = await adapters.pocket.activity(P7, { since: "2026-10-22T12:00:00.000Z" });
  assert.ok(activity.ok && activity.value.map((e) => e.id).join() === "evt_3");
  const unread = await adapters.pocket.notifications({ unreadOnly: true });
  assert.ok(unread.ok && unread.value.length === 1 && unread.value[0]?.level === "action-required");

  const received: { id: string }[] = [];
  const stop = adapters.pocket.subscribe((event) => received.push(event));
  const notification: PocketNotification = { id: "ntf_3", projectId: P42, level: "info", title: "Hi", body: "x", createdAt: "2026-10-24T00:00:00.000Z", readAt: null };
  mockSectorHooks(adapters).emitPocket(notification);
  stop();
  mockSectorHooks(adapters).emitPocket({ ...notification, id: "ntf_4" });
  assert.deepEqual(received.map((e) => e.id), ["ntf_3"]);
  const all = await adapters.pocket.notifications();
  assert.ok(all.ok && all.value.length === 4);
});
