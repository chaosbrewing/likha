import test from "node:test";
import assert from "node:assert/strict";
import type { OriginAdapters, OriginProjectId } from "@studio/contracts";
import { MockTalaAdapter, createOfflineAdapters } from "../src/index.ts";

test("every ORIGIN system reports offline in local mode", () => {
  const adapters: OriginAdapters = createOfflineAdapters();
  for (const [key, adapter] of Object.entries(adapters)) {
    const status = adapter.status();
    assert.equal(status.connected, false, key);
    assert.match(status.detail, /local mode/);
  }
  assert.deepEqual(
    Object.values(adapters).map((a) => a.status().system).sort(),
    ["agos", "binhi", "liyab", "origin-core", "tala"]
  );
});

test("offline adapters fail every call with NOT_CONNECTED instead of throwing", async () => {
  const { core, binhi, tala, agos, liyab } = createOfflineAdapters();
  const id = "p1" as OriginProjectId;
  const results = await Promise.all([
    core.findLinkedProject("C:\\project"),
    core.syncState(id),
    binhi.importSite(id, "C:\\project"),
    tala.propose({ path: "a.ts", instruction: "x" }),
    tala.markApplied("x"),
    agos.publish({ type: "file-saved", path: "a.ts" }),
    liyab.startPreview(id),
    liyab.handOffDeployment({ projectId: id, requestedBy: "me", sourceRevision: "abc" })
  ]);
  for (const result of results) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "NOT_CONNECTED");
  }
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
