// The HTTP transport against an in-process fake that answers with ORIGIN's tRPC
// shapes. This proves the client's handling of every answer; it does not prove
// a live ORIGIN accepts API keys (it does not yet, see docs/integration).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OriginCredential, OriginProjectId } from "@studio/contracts";
import { HttpOriginTransport, toPermissions, validateOriginBaseUrl } from "../src/index.ts";

const GOOD = "1".repeat(64);
const credential = (secret: string): OriginCredential => ({ kind: "api-key", secret });
const requests: { url: string; authorization: string | undefined }[] = [];
let mode: "ok" | "null-user" | "trpc-error" | "html" | "500" | "slow" | "expired" | "429" = "ok";

const server: Server = createServer((req: IncomingMessage, res) => {
  requests.push({ url: req.url ?? "", authorization: req.headers.authorization });
  const send = (status: number, body: unknown, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (mode === "slow") return; // never answers
  if (mode === "html") return send(200, "<html>parking</html>", "text/html");
  if (mode === "500") return send(500, { error: "boom" });
  if (mode === "expired") return send(401, { error: { json: { message: "API key has expired.", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } } });
  if (mode === "429") return send(429, { error: { json: { message: "Too many failed API key attempts. Try again later.", code: -32029, data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } } } });
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.endsWith("/auth.me")) {
    if (mode === "null-user") return send(200, { result: { data: { json: null } } });
    if (req.headers.authorization !== `Bearer ${GOOD}`) return send(401, { error: "Invalid API key" });
    return send(200, { result: { data: { json: { id: 12, name: "Ada", email: "ada@example.test", organisationId: 3, permissions: ["project.read", "deploy.read"] } } } });
  }
  if (url.pathname.endsWith("/projects.get")) {
    if (mode === "trpc-error") return send(200, { error: { json: { message: "You do not have access to this project", code: -32003, data: { code: "FORBIDDEN", httpStatus: 403 } } } });
    const input = JSON.parse(url.searchParams.get("input") ?? "{}") as { json?: { projectId?: number } };
    if (input.json?.projectId === 404) return send(200, { error: { json: { message: "Project not found", code: -32004, data: { code: "NOT_FOUND" } } } });
    return send(200, { result: { data: { json: { id: input.json?.projectId, name: "Ada's project", userId: 12, permissions: ["project.read", "project.manage"], updatedAt: "2026-10-01T00:00:00.000Z" } } } });
  }
  return send(404, "not found", "text/plain");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test("only https (or localhost http) ORIGIN URLs are accepted, without credentials or queries", () => {
  assert.deepEqual(validateOriginBaseUrl("https://origin.example.test/"), { ok: true, value: "https://origin.example.test" });
  assert.deepEqual(validateOriginBaseUrl("http://localhost:5000"), { ok: true, value: "http://localhost:5000" });
  for (const bad of ["http://origin.example.test", "ftp://x", "https://user:pw@origin.example.test", "https://origin.example.test/?x=1", "not a url"]) {
    assert.equal(validateOriginBaseUrl(bad).ok, false, bad);
  }
  assert.throws(() => new HttpOriginTransport({ baseUrl: "http://origin.example.test" }), /https/);
});

test("ORIGIN's permission names map to the IDE's coarse view", () => {
  assert.deepEqual(toPermissions(["project.read"]), ["read"]);
  assert.deepEqual(toPermissions(["project.manage"]).sort(), ["admin", "read", "write"]);
  assert.deepEqual(toPermissions(["deploy.execute"]), ["write"]);
  assert.deepEqual(toPermissions("nope"), []);
});

test("identity and project answers are mapped, and the key travels only as a bearer header", async () => {
  mode = "ok";
  requests.length = 0;
  const transport = new HttpOriginTransport({ baseUrl, timeoutMs: 2000 });
  assert.equal(transport.kind, "http");
  const me = await transport.whoAmI(credential(GOOD));
  assert.deepEqual(me, { ok: true, value: { userId: "12", displayName: "Ada", organisationId: "3", projectId: null, permissions: ["read"], expiresAt: null } });
  const project = await transport.getProject(credential(GOOD), "42" as OriginProjectId);
  assert.ok(project.ok);
  assert.equal(project.value.name, "Ada's project");
  assert.deepEqual(project.value.permissions.sort(), ["admin", "read", "write"]);
  assert.ok(requests.every((r) => r.authorization === `Bearer ${GOOD}` && !r.url.includes(GOOD)), "the secret is never in the URL");
  const notFound = await transport.getProject(credential(GOOD), "404" as OriginProjectId);
  assert.equal(!notFound.ok && notFound.error.code, "NOT_FOUND");
});

test("rejections, errors, outages and non-JSON answers become the right result codes", async () => {
  const transport = new HttpOriginTransport({ baseUrl, timeoutMs: 300 });
  mode = "ok";
  const bad = await transport.whoAmI(credential("2".repeat(64)));
  assert.equal(!bad.ok && bad.error.code, "UNAUTHORIZED");

  mode = "null-user";
  const anonymous = await transport.whoAmI(credential(GOOD));
  assert.ok(!anonymous.ok && anonymous.error.code === "UNAUTHORIZED" && /may not accept API keys/.test(anonymous.error.message));

  mode = "expired";
  const expired = await transport.whoAmI(credential(GOOD));
  assert.ok(!expired.ok && expired.error.code === "UNAUTHORIZED" && /expired/.test(expired.error.message), "the reason in a 401 envelope is kept");

  mode = "429";
  const limited = await transport.whoAmI(credential(GOOD));
  assert.ok(!limited.ok && limited.error.code === "UNAVAILABLE" && /Too many/.test(limited.error.message));

  mode = "trpc-error";
  const forbidden = await transport.getProject(credential(GOOD), "42" as OriginProjectId);
  assert.ok(!forbidden.ok && forbidden.error.code === "FORBIDDEN" && /access/.test(forbidden.error.message));

  mode = "500";
  const failed = await transport.whoAmI(credential(GOOD));
  assert.equal(!failed.ok && failed.error.code, "UNAVAILABLE");

  mode = "html";
  const parked = await transport.whoAmI(credential(GOOD));
  assert.ok(!parked.ok && parked.error.code === "UNAVAILABLE" && /JSON/.test(parked.error.message));

  mode = "slow";
  const timeout = await transport.whoAmI(credential(GOOD));
  assert.ok(!timeout.ok && timeout.error.code === "UNAVAILABLE" && /No answer/.test(timeout.error.message));

  const unreachable = new HttpOriginTransport({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
  const refused = await unreachable.whoAmI(credential(GOOD));
  assert.ok(!refused.ok && refused.error.code === "UNAVAILABLE");
  mode = "ok";
});
