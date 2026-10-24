import {
  AGOS_CONTRACT_VERSION,
  BINHI_CONTRACT_VERSION,
  LIYAB_CONTRACT_VERSION,
  POCKET_CONTRACT_VERSION,
  fail,
  ok,
  type AgosRunStatus,
  type AgosWorkflowSummary,
  type BinhiEditorHandoff,
  type BinhiSiteSummary,
  type DeploymentHandoff,
  type IntegrationStatus,
  type LiyabStatusSnapshot,
  type OriginAdapters,
  type OriginProjectId,
  type PocketActivityEvent,
  type PocketNotification,
  type PocketProjectSummary,
  type Result,
  type WorkflowEvent
} from "@studio/contracts";
import { MockTalaAdapter } from "./mock-tala.js";

/*
 * Mock sector adapters with documented fixtures. They stand in for ORIGIN
 * sectors that have no endpoint a desktop client can reach today. Every
 * status() says "mock"; nothing here claims to be real.
 */

const P42 = "proj_42" as OriginProjectId;
const P7 = "proj_7" as OriginProjectId;

export interface MockSectorOptions {
  now?: () => string;
}

function mockStatus(system: IntegrationStatus["system"], contractVersion: number, detail: string): IntegrationStatus {
  return { system, connected: true, transport: "mock", contractVersion, detail };
}

export const MOCK_BINHI_SITES: BinhiSiteSummary[] = [
  { siteId: "site_1", projectId: P42, name: "Binhi Site", status: "published", publishedUrl: "https://example.test/s/binhi-site/", revision: 12, updatedAt: "2026-10-20T10:00:00.000Z" },
  { siteId: "site_2", projectId: P42, name: "Landing draft", status: "draft", publishedUrl: null, revision: 3, updatedAt: "2026-10-22T08:30:00.000Z" }
];

export const MOCK_AGOS_WORKFLOWS: AgosWorkflowSummary[] = [{ workflowId: "wf_build_notify", name: "Build and notify", definitionVersion: 1, stepCount: 2 }];

export const MOCK_AGOS_RUNS: AgosRunStatus[] = [
  { runId: "run_1", workflowId: "wf_build_notify", state: "completed", idempotencyKey: "k1", startedAt: "2026-10-21T09:00:00.000Z", finishedAt: "2026-10-21T09:00:03.000Z", reason: null },
  { runId: "run_2", workflowId: "wf_build_notify", state: "rejected", idempotencyKey: "k2", startedAt: null, finishedAt: "2026-10-22T09:00:00.000Z", reason: "invalid_input" }
];

export const MOCK_LIYAB_SNAPSHOT: LiyabStatusSnapshot = {
  projectId: P7,
  observedAt: "2026-10-23T12:00:00.000Z",
  builds: [
    { buildId: "build_9", pipelineId: "pipe_1", commit: "4c98e4d", outcome: "succeeded", startedAt: "2026-10-23T11:50:00.000Z", finishedAt: "2026-10-23T11:54:00.000Z" },
    { buildId: "build_8", pipelineId: "pipe_1", commit: "1e36976", outcome: "failed", startedAt: "2026-10-22T11:50:00.000Z", finishedAt: "2026-10-22T11:52:00.000Z" }
  ],
  tests: [{ runId: "test_9", buildId: "build_9", outcome: "succeeded", passed: 111, failed: 0, skipped: 0, finishedAt: "2026-10-23T11:53:00.000Z" }],
  runtimes: [{ runtimeId: "rt_1", name: "web", environment: "development", health: "healthy", lifecycle: "active", url: "https://example.test/", deployedImage: "build_9" }],
  simulated: true
};

export const MOCK_POCKET_ACTIVITY: PocketActivityEvent[] = [
  { id: "evt_1", projectId: P42, type: "binhi.site.published", occurredAt: "2026-10-20T10:00:00.000Z", actor: { kind: "user", id: "user_owner" }, summary: "Binhi Site published revision 12" },
  { id: "evt_2", projectId: P7, type: "liyab.build.failed", occurredAt: "2026-10-22T11:52:00.000Z", actor: { kind: "system", id: "liyab" }, summary: "Build build_8 failed" },
  { id: "evt_3", projectId: P7, type: "liyab.build.succeeded", occurredAt: "2026-10-23T11:54:00.000Z", actor: { kind: "system", id: "liyab" }, summary: "Build build_9 succeeded" }
];

export const MOCK_POCKET_NOTIFICATIONS: PocketNotification[] = [
  { id: "ntf_1", projectId: P7, level: "warning", title: "Build failed", body: "build_8 failed on pipe_1.", createdAt: "2026-10-22T11:52:00.000Z", readAt: "2026-10-22T12:00:00.000Z" },
  { id: "ntf_2", projectId: P42, level: "action-required", title: "Approval requested", body: "Tala asks to propose an edit to src/index.ts.", createdAt: "2026-10-23T09:00:00.000Z", readAt: null }
];

export function createMockSectorAdapters(options: MockSectorOptions = {}): Omit<OriginAdapters, "core"> {
  const now = options.now ?? (() => new Date().toISOString());
  const pocketListeners = new Set<(event: PocketActivityEvent | PocketNotification) => void>();
  const activity = MOCK_POCKET_ACTIVITY.map((e) => ({ ...e }));
  const notifications = MOCK_POCKET_NOTIFICATIONS.map((n) => ({ ...n }));
  const tala = new MockTalaAdapter(undefined, now);
  const agosEvents: WorkflowEvent[] = [];

  const binhi: OriginAdapters["binhi"] = {
    contractVersion: BINHI_CONTRACT_VERSION,
    status: () => mockStatus("binhi", BINHI_CONTRACT_VERSION, "Mock BINHI: fixture sites; editor handoff answers with a fixture URL."),
    async listSites(projectId) {
      return ok(MOCK_BINHI_SITES.filter((s) => s.projectId === projectId).map((s) => ({ ...s })));
    },
    async getSite(siteId) {
      const site = MOCK_BINHI_SITES.find((s) => s.siteId === siteId);
      return site ? ok({ ...site }) : fail("NOT_FOUND", `BINHI has no site "${siteId}".`);
    },
    async requestEditorHandoff(siteId) {
      const site = MOCK_BINHI_SITES.find((s) => s.siteId === siteId);
      if (!site) return fail("NOT_FOUND", `BINHI has no site "${siteId}".`);
      const handoff: BinhiEditorHandoff = { handoffId: `handoff_${siteId}`, siteId, editorUrl: `https://example.test/editor/${siteId}`, expiresAt: new Date(Date.parse(now()) + 10 * 60_000).toISOString() };
      return ok(handoff);
    }
  };

  const agos: OriginAdapters["agos"] = {
    contractVersion: AGOS_CONTRACT_VERSION,
    status: () => mockStatus("agos", AGOS_CONTRACT_VERSION, "Mock AGOS: fixture workflow and runs; published events are recorded in memory only."),
    async listWorkflows(projectId) {
      return ok(projectId === P7 ? MOCK_AGOS_WORKFLOWS.map((w) => ({ ...w })) : []);
    },
    async listRuns(projectId, listOptions) {
      if (projectId !== P7) return ok([]);
      const limit = listOptions?.limit ?? 50;
      return ok(MOCK_AGOS_RUNS.filter((r) => !listOptions?.workflowId || r.workflowId === listOptions.workflowId).slice(0, limit).map((r) => ({ ...r })));
    },
    async getRun(runId) {
      const run = MOCK_AGOS_RUNS.find((r) => r.runId === runId);
      return run ? ok({ ...run }) : fail("NOT_FOUND", `AGOS has no run "${runId}".`);
    },
    async publish(event) {
      agosEvents.push(event);
      return ok(undefined);
    }
  };

  const liyab: OriginAdapters["liyab"] = {
    contractVersion: LIYAB_CONTRACT_VERSION,
    status: () => mockStatus("liyab", LIYAB_CONTRACT_VERSION, "Mock LIYAB: simulated builds, tests and runtimes (snapshot.simulated = true)."),
    async snapshot(projectId) {
      return projectId === P7 ? ok({ ...MOCK_LIYAB_SNAPSHOT, observedAt: now() }) : ok({ ...MOCK_LIYAB_SNAPSHOT, projectId, observedAt: now(), builds: [], tests: [], runtimes: [] });
    },
    async logs(target, logOptions) {
      const lines = target.kind === "build" ? [`[${target.id}] npm ci`, `[${target.id}] npm run build`, `[${target.id}] done`] : [`[${target.id}] listening on :3000`];
      return ok(lines.slice(0, logOptions?.limit ?? lines.length));
    },
    async handOffDeployment(request: DeploymentHandoff) {
      if (!request.sourceRevision) return fail("INVALID_ARGUMENT", "A deployment handoff needs a source revision.");
      return fail("CONFIRMATION_REQUIRED", "Deployments are approved and executed in ORIGIN; Origin Studio only prepares the request (not implemented in the mock).");
    }
  };

  const pocket: OriginAdapters["pocket"] = {
    contractVersion: POCKET_CONTRACT_VERSION,
    status: () => mockStatus("pocket", POCKET_CONTRACT_VERSION, "Mock Origin Pocket: fixture summaries, activity and notifications."),
    async projectSummary(projectId) {
      const project = projectId === P42 ? { name: "Binhi Site" } : projectId === P7 ? { name: "Agos Pipeline" } : null;
      if (!project) return fail("NOT_FOUND", `ORIGIN has no project "${projectId}".`);
      const events = activity.filter((e) => e.projectId === projectId);
      const approvalsResult = await tala.listApprovals(projectId);
      const approvals = approvalsResult.ok ? approvalsResult.value : [];
      const failedBuilds = projectId === P7 ? MOCK_LIYAB_SNAPSHOT.builds.filter((b) => b.outcome === "failed").length : 0;
      const openApprovals = approvals.filter((a) => a.status === "pending").length;
      const summary: PocketProjectSummary = {
        projectId,
        name: project.name,
        health: failedBuilds > 0 ? "attention" : "healthy",
        lastActivityAt: events.map((e) => e.occurredAt).sort().at(-1) ?? null,
        openApprovals,
        failedBuilds,
        publishedSites: MOCK_BINHI_SITES.filter((s) => s.projectId === projectId && s.status === "published").length
      };
      return ok(summary);
    },
    async activity(projectId, activityOptions) {
      const since = activityOptions?.since ?? "";
      const limit = activityOptions?.limit ?? 50;
      return ok(activity.filter((e) => e.projectId === projectId && e.occurredAt > since).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit).map((e) => ({ ...e })));
    },
    async notifications(notificationOptions) {
      return ok(notifications.filter((n) => !notificationOptions?.unreadOnly || n.readAt === null).map((n) => ({ ...n })));
    },
    subscribe(listener) {
      pocketListeners.add(listener);
      return () => {
        pocketListeners.delete(listener);
      };
    }
  };

  return {
    binhi,
    tala,
    agos,
    liyab,
    pocket,
    /** Test hooks, not part of the contract. */
    ...({
      __mock: {
        emitPocket(event: PocketActivityEvent | PocketNotification) {
          if ("type" in event) activity.push({ ...event });
          else notifications.push({ ...event });
          for (const listener of pocketListeners) listener(event);
        },
        agosEvents
      }
    } as Record<string, unknown>)
  } as Omit<OriginAdapters, "core">;
}

export interface MockSectorHooks {
  emitPocket(event: PocketActivityEvent | PocketNotification): void;
  agosEvents: WorkflowEvent[];
}

/** The test hooks attached by createMockSectorAdapters. */
export function mockSectorHooks(adapters: Omit<OriginAdapters, "core">): MockSectorHooks {
  return (adapters as unknown as { __mock: MockSectorHooks }).__mock;
}
