import test from "node:test";
import assert from "node:assert/strict";
import type { OriginProjectId } from "@studio/contracts";
import { ORIGIN_LINK_FILE, createLinkFileCoreAdapter, parseOriginLink } from "../src/index.ts";

const valid = { projectId: "proj_42", name: "  Binhi Site  ", ownerId: "user_1", permissions: ["read", "read"], revision: 7 };

test("a well-formed link file yields a project record with defaults applied", () => {
  const parsed = parseOriginLink(JSON.stringify(valid));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, { id: "proj_42", name: "Binhi Site", ownerId: "user_1", permissions: ["read"], revision: 7 });

  const minimal = parseOriginLink(JSON.stringify({ projectId: "a", name: "A", ownerId: "o", revision: 0 }));
  assert.ok(minimal.ok);
  assert.deepEqual(minimal.value.permissions, ["read"], "permissions default to read-only");
});

test("malformed link files are reported, never guessed", () => {
  const cases: [string, RegExp][] = [
    ["{", /not valid JSON/],
    ["[]", /JSON object/],
    [JSON.stringify({ ...valid, projectId: "../x" }), /projectId/],
    [JSON.stringify({ ...valid, projectId: "" }), /projectId/],
    [JSON.stringify({ ...valid, name: "" }), /name/],
    [JSON.stringify({ ...valid, ownerId: 5 }), /ownerId/],
    [JSON.stringify({ ...valid, permissions: ["root"] }), /permissions/],
    [JSON.stringify({ ...valid, permissions: "read" }), /permissions/],
    [JSON.stringify({ ...valid, revision: -1 }), /revision/],
    [JSON.stringify({ ...valid, revision: 1.5 }), /revision/],
    [JSON.stringify({ ...valid, revision: "7" }), /revision/]
  ];
  for (const [text, expected] of cases) {
    const parsed = parseOriginLink(text);
    assert.equal(parsed.ok, false, text);
    if (!parsed.ok) {
      assert.equal(parsed.error.code, "INVALID_ARGUMENT");
      assert.match(parsed.error.message, expected, text);
    }
  }
});

test("the link-file adapter reads the link, reports its state honestly and never writes", async () => {
  const reads: string[] = [];
  const files = new Map<string, string>([
    ["C:\\linked|.origin/project.json", JSON.stringify(valid)],
    ["C:\\broken|.origin/project.json", "{"]
  ]);
  const adapter = createLinkFileCoreAdapter({
    readWorkspaceFile: async (root, rel) => {
      reads.push(`${root}|${rel}`);
      return files.get(`${root}|${rel}`) ?? null;
    }
  });
  assert.equal(adapter.status().system, "origin-core");
  assert.equal(adapter.status().connected, true);
  assert.match(adapter.status().detail, /read-only/);

  const linked = await adapter.findLinkedProject("C:\\linked");
  assert.ok(linked.ok && linked.value?.id === "proj_42");
  const sync = await adapter.syncState("proj_42" as OriginProjectId);
  assert.deepEqual(sync, { ok: true, value: { phase: "linked", revision: 7 } });

  const unlinked = await adapter.findLinkedProject("C:\\plain");
  assert.deepEqual(unlinked, { ok: true, value: null });

  const broken = await adapter.findLinkedProject("C:\\broken");
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.error.code, "INVALID_ARGUMENT");

  const unknown = await adapter.syncState("nope" as OriginProjectId);
  assert.equal(!unknown.ok && unknown.error.code, "NOT_FOUND");

  assert.deepEqual([...new Set(reads.map((r) => r.split("|")[1]))], [ORIGIN_LINK_FILE], "only the link file is ever read");
  assert.deepEqual(Object.keys(adapter).sort(), ["findLinkedProject", "status", "syncState"], "the adapter exposes no write operation");

  const failing = createLinkFileCoreAdapter({
    readWorkspaceFile: async () => {
      throw new Error("EACCES");
    }
  });
  const denied = await failing.findLinkedProject("C:\\x");
  assert.equal(!denied.ok && denied.error.code, "UNKNOWN");
});
