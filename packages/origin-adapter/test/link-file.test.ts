import test from "node:test";
import assert from "node:assert/strict";
import type { OriginCredential, OriginProjectId, OriginTransport } from "@studio/contracts";
import { MOCK_ORIGIN_KEYS, MockOriginTransport, ORIGIN_LINK_FILE, createLinkFileCoreAdapter, parseOriginLink } from "../src/index.ts";

const owner: OriginCredential = { kind: "api-key", secret: MOCK_ORIGIN_KEYS.owner };
const reader: OriginCredential = { kind: "api-key", secret: MOCK_ORIGIN_KEYS.reader };

test("a link file needs only a project id; hints are optional and phase 6 fields are ignored", () => {
  assert.deepEqual(parseOriginLink(JSON.stringify({ projectId: "proj_42" })), { ok: true, value: { projectId: "proj_42", nameHint: null } });
  assert.deepEqual(parseOriginLink(JSON.stringify({ projectId: "proj_42", name: "  Binhi Site " })), { ok: true, value: { projectId: "proj_42", nameHint: "Binhi Site" } });
  const phase6 = parseOriginLink(JSON.stringify({ projectId: "proj_42", name: "X", ownerId: "someone", permissions: ["admin"], revision: 99 }));
  assert.ok(phase6.ok);
  assert.deepEqual(Object.keys(phase6.value).sort(), ["nameHint", "projectId"], "ownership and permissions never come from the file");
});

test("malformed link files are reported, never guessed", () => {
  for (const [text, expected] of [
    ["{", /not valid JSON/],
    ["[]", /JSON object/],
    [JSON.stringify({ projectId: "../x" }), /projectId/],
    [JSON.stringify({ projectId: "" }), /projectId/],
    [JSON.stringify({ name: "no id" }), /projectId/],
    [JSON.stringify({ projectId: "proj_42", name: 5 }), /name/],
    [JSON.stringify({ projectId: "proj_42", name: "x".repeat(201) }), /name/]
  ] as const) {
    const parsed = parseOriginLink(text);
    assert.equal(parsed.ok, false, text);
    if (!parsed.ok) {
      assert.equal(parsed.error.code, "INVALID_ARGUMENT");
      assert.match(parsed.error.message, expected, text);
    }
  }
});

function adapter(transport: OriginTransport = new MockOriginTransport(), files = new Map<string, string>()) {
  const reads: string[] = [];
  const core = createLinkFileCoreAdapter({
    transport,
    now: () => new Date("2026-10-24T00:00:00.000Z"),
    readWorkspaceFile: async (root, rel) => {
      reads.push(`${root}|${rel}`);
      return files.get(`${root}|${rel}`) ?? null;
    }
  });
  return { core, reads, transport };
}

test("the link is read from the workspace and resolved through ORIGIN: verified, unverified, unauthorized", async () => {
  const files = new Map([
    ["C:\\linked|.origin/project.json", JSON.stringify({ projectId: "proj_42", name: "stale hint" })],
    ["C:\\other|.origin/project.json", JSON.stringify({ projectId: "proj_7" })],
    ["C:\\missing|.origin/project.json", JSON.stringify({ projectId: "proj_nope" })],
    ["C:\\broken|.origin/project.json", "{"]
  ]);
  const transport = new MockOriginTransport();
  const { core, reads } = adapter(transport, files);
  assert.equal(core.status().contractVersion, 2);
  assert.equal(core.status().transport, "mock");

  const link = await core.findLink("C:\\linked");
  assert.ok(link.ok && link.value);
  assert.deepEqual(await core.findLink("C:\\plain"), { ok: true, value: null });
  const broken = await core.findLink("C:\\broken");
  assert.equal(!broken.ok && broken.error.code, "INVALID_ARGUMENT");
  assert.deepEqual([...new Set(reads.map((r) => r.split("|")[1]))], [ORIGIN_LINK_FILE], "only the link file is ever read");

  // Not connected: the id is known, nothing else is claimed.
  const unverified = await core.resolveProject(link.value, null);
  assert.deepEqual(unverified, { ok: true, value: { status: "unverified", reason: "disconnected", detail: "Connect to ORIGIN to verify this link." } });
  assert.equal(!(await core.syncState("proj_42" as OriginProjectId)).ok, true, "nothing is synced before verification");

  // Connected: ORIGIN's record wins over the file's hint.
  const verified = await core.resolveProject(link.value, owner);
  assert.ok(verified.ok && verified.value.status === "verified");
  if (verified.value.status === "verified") {
    assert.equal(verified.value.project.name, "Binhi Site");
    assert.deepEqual(verified.value.project.permissions, ["read", "write", "admin"]);
    assert.equal(verified.value.verifiedAt, "2026-10-24T00:00:00.000Z");
  }
  assert.deepEqual(await core.syncState("proj_42" as OriginProjectId), { ok: true, value: { phase: "linked", revision: 7 } });

  // A reader scoped to proj_42 may not see proj_7; nobody sees proj_nope.
  const other = await core.findLink("C:\\other");
  assert.ok(other.ok && other.value);
  const forbidden = await core.resolveProject(other.value, reader);
  assert.ok(forbidden.ok && forbidden.value.status === "unauthorized" && forbidden.value.reason === "forbidden");
  const missing = await core.findLink("C:\\missing");
  assert.ok(missing.ok && missing.value);
  const notFound = await core.resolveProject(missing.value, owner);
  assert.ok(notFound.ok && notFound.value.status === "unauthorized" && notFound.value.reason === "not-found");

  // A rejected credential and an unreachable ORIGIN are distinguished.
  const rejected = await core.resolveProject(link.value, { kind: "api-key", secret: MOCK_ORIGIN_KEYS.revoked });
  assert.ok(rejected.ok && rejected.value.status === "unauthorized" && rejected.value.reason === "credential");
  transport.offline = true;
  const offline = await core.resolveProject(link.value, owner);
  assert.ok(offline.ok && offline.value.status === "unverified" && offline.value.reason === "unavailable");
  assert.deepEqual(Object.keys(core).sort(), ["findLink", "resolveProject", "status", "syncState"], "the adapter exposes no write operation");
});

test("without an ORIGIN server every link stays unverified and the status says so", async () => {
  const none = { kind: "none" as const, target: "none", whoAmI: async () => ({ ok: false as const, error: { code: "NOT_CONNECTED" as const, message: "x" } }), getProject: async () => ({ ok: false as const, error: { code: "NOT_CONNECTED" as const, message: "x" } }) };
  const { core } = adapter(none, new Map([["C:\\w|.origin/project.json", JSON.stringify({ projectId: "proj_42" })]]));
  assert.equal(core.status().connected, false);
  assert.match(core.status().detail, /no ORIGIN server/);
  const link = await core.findLink("C:\\w");
  assert.ok(link.ok && link.value);
  const resolution = await core.resolveProject(link.value, owner);
  assert.ok(resolution.ok && resolution.value.status === "unverified" && resolution.value.reason === "disconnected");
});
