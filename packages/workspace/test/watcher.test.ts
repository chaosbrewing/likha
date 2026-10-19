import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceChangeEvent } from "@studio/contracts";
import { isIgnoredChange, watchWorkspace } from "../src/index.ts";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "studio-watcher-test-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

function collect(root: string, debounceMs = 50) {
  const events: WorkspaceChangeEvent[] = [];
  const watcher = watchWorkspace(root, (event) => events.push(event), { debounceMs });
  const next = async (timeoutMs = 5000): Promise<WorkspaceChangeEvent> => {
    const started = Date.now();
    const seen = events.length;
    while (events.length === seen) {
      if (Date.now() - started > timeoutMs) throw new Error("no change event");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return events[events.length - 1]!;
  };
  return { events, watcher, next };
}

test("reports created and changed files as batched workspace-relative paths", async () => {
  const root = path.join(tempRoot, "ws1");
  mkdirSync(path.join(root, "src"), { recursive: true });
  const { watcher, next } = collect(root);
  await new Promise((resolve) => setTimeout(resolve, 200)); // let the watcher attach
  try {
    writeFileSync(path.join(root, "src", "a.ts"), "1");
    writeFileSync(path.join(root, "b.txt"), "2");
    const event = await next();
    assert.equal(event.overflow, false);
    assert.ok(event.paths.includes("src/a.ts"), JSON.stringify(event));
    assert.ok(event.paths.includes("b.txt"), JSON.stringify(event));
    assert.ok(event.paths.every((p) => !p.includes("\\")), "paths use forward slashes");
  } finally {
    watcher.close();
  }
});

test("ignores Git internals except HEAD, and the editor's own temp files", () => {
  assert.equal(isIgnoredChange(".git/objects/ab/cdef"), true);
  assert.equal(isIgnoredChange(".git/index"), true);
  assert.equal(isIgnoredChange(".git"), true);
  assert.equal(isIgnoredChange(".git/HEAD"), false);
  assert.equal(isIgnoredChange("src/.a.ts.1a2b3c.origin-tmp"), true);
  assert.equal(isIgnoredChange("src/a.ts"), false);
  assert.equal(isIgnoredChange(".gitignore"), false);
});

test("reports overflow instead of a huge path list", async () => {
  const root = path.join(tempRoot, "ws2");
  mkdirSync(root, { recursive: true });
  const events: WorkspaceChangeEvent[] = [];
  const watcher = watchWorkspace(root, (event) => events.push(event), { debounceMs: 100, maxPaths: 3 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    for (let i = 0; i < 10; i++) writeFileSync(path.join(root, `file-${i}.txt`), String(i));
    const started = Date.now();
    while (events.length === 0 && Date.now() - started < 5000) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(events.length > 0, "an event arrived");
    assert.equal(events[0]!.overflow, true);
    assert.deepEqual(events[0]!.paths, []);
  } finally {
    watcher.close();
  }
});

test("stops reporting after close", async () => {
  const root = path.join(tempRoot, "ws3");
  mkdirSync(root, { recursive: true });
  const { events, watcher } = collect(root);
  await new Promise((resolve) => setTimeout(resolve, 200));
  watcher.close();
  watcher.close(); // idempotent
  writeFileSync(path.join(root, "late.txt"), "x");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(events.length, 0);
});

test("a missing folder reports an error instead of throwing", () => {
  let reported: Error | null = null;
  const watcher = watchWorkspace(path.join(tempRoot, "does-not-exist"), () => undefined, { onError: (e) => (reported = e) });
  watcher.close();
  assert.ok(reported !== null);
});
