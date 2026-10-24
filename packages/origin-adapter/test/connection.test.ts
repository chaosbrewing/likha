import test from "node:test";
import assert from "node:assert/strict";
import { fail, ok, type CredentialVault, type OriginConnectionState, type OriginTransport, type Result } from "@studio/contracts";
import { MOCK_ORIGIN_KEYS, MockOriginTransport, OriginConnection } from "../src/index.ts";

class MemoryVault implements CredentialVault {
  readonly description = "memory";
  stored: string | null = null;
  saves = 0;
  clears = 0;
  failSave = false;
  async load() {
    return this.stored;
  }
  async save(secret: string): Promise<Result<void>> {
    this.saves++;
    if (this.failSave) return fail("UNKNOWN", "secure storage unavailable");
    this.stored = secret;
    return ok(undefined);
  }
  async clear() {
    this.clears++;
    this.stored = null;
  }
}

function harness(transport: OriginTransport = new MockOriginTransport(), vault = new MemoryVault()) {
  const states: OriginConnectionState["state"][] = [];
  const logs: string[] = [];
  const connection = new OriginConnection({
    transport,
    vault,
    onChange: (state) => states.push(state.state),
    log: (message) => logs.push(message),
    now: () => new Date("2026-10-24T00:00:00.000Z")
  });
  return { connection, vault, states, logs };
}

function assertNoSecret(texts: string[]) {
  for (const text of texts) {
    for (const key of Object.values(MOCK_ORIGIN_KEYS)) assert.ok(!text.includes(key), `secret leaked: ${text}`);
  }
}

test("connect verifies the key with ORIGIN before storing it, and reports the identity", async () => {
  const { connection, vault, states, logs } = harness();
  const initial: OriginConnectionState = connection.state;
  assert.equal(initial.state, "disconnected");
  const result = await connection.connect(MOCK_ORIGIN_KEYS.owner);
  assert.ok(result.ok);
  assert.equal(result.value.displayName, "Mock Owner");
  assert.equal(vault.stored, MOCK_ORIGIN_KEYS.owner);
  assert.deepEqual(states, ["connecting", "connected"]);
  const state: OriginConnectionState = connection.state;
  assert.ok(state.state === "connected" && state.identity.userId === "user_owner" && state.transport === "mock");
  assertNoSecret(logs);
  assert.ok(!JSON.stringify(connection.state).includes(MOCK_ORIGIN_KEYS.owner), "the state the interface sees carries no secret");
});

test("malformed, invalid, expired, revoked and read-less keys are refused and never stored", async () => {
  for (const [secret, expectedCode, expectedState] of [
    ["not-a-key", "INVALID_ARGUMENT", "disconnected"],
    ["f".repeat(64), "UNAUTHORIZED", "unauthorized"],
    [MOCK_ORIGIN_KEYS.expired, "UNAUTHORIZED", "unauthorized"],
    [MOCK_ORIGIN_KEYS.revoked, "UNAUTHORIZED", "unauthorized"],
    [MOCK_ORIGIN_KEYS.noRead, "FORBIDDEN", "unauthorized"]
  ] as const) {
    const { connection, vault } = harness();
    const result = await connection.connect(secret);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, expectedCode, secret.slice(0, 4));
    assert.equal(vault.stored, null);
    assert.equal(vault.saves, 0);
    assert.equal(connection.state.state, expectedState);
    assert.equal(connection.credentialForRequests(), null);
  }
  const { connection } = harness();
  await connection.connect(MOCK_ORIGIN_KEYS.expired);
  const state = connection.state;
  assert.ok(state.state === "unauthorized" && state.reason === "expired");
  await connection.connect(MOCK_ORIGIN_KEYS.revoked);
  const revoked = connection.state;
  assert.ok(revoked.state === "unauthorized" && revoked.reason === "revoked");
});

test("when ORIGIN is unreachable the key is not stored, and an existing session becomes unavailable but keeps its credential", async () => {
  const transport = new MockOriginTransport({ offline: true });
  const { connection, vault } = harness(transport);
  const result = await connection.connect(MOCK_ORIGIN_KEYS.owner);
  assert.equal(!result.ok && result.error.code, "UNAVAILABLE");
  assert.equal(vault.stored, null);
  assert.equal(connection.state.state, "unavailable");

  transport.offline = false;
  assert.ok((await connection.connect(MOCK_ORIGIN_KEYS.owner)).ok);
  transport.offline = true;
  const refreshed = await connection.refresh();
  assert.ok(refreshed.state === "unavailable" && refreshed.lastConnectedAt === "2026-10-24T00:00:00.000Z");
  assert.equal(vault.stored, MOCK_ORIGIN_KEYS.owner, "offline does not forget the credential");
  assert.ok(connection.credentialForRequests());
  transport.offline = false;
  assert.equal((await connection.refresh()).state, "connected");
});

test("a stored credential is restored at start-up; a revoked one is forgotten on the next check", async () => {
  const transport = new MockOriginTransport();
  const vault = new MemoryVault();
  vault.stored = MOCK_ORIGIN_KEYS.reader;
  const { connection, states } = harness(transport, vault);
  await connection.restore();
  assert.equal(connection.state.state, "connected");
  assert.deepEqual(states, ["connecting", "connected"]);

  transport.revoked.add(MOCK_ORIGIN_KEYS.reader);
  const after = await connection.refresh();
  assert.ok(after.state === "unauthorized" && after.reason === "revoked");
  assert.equal(vault.stored, null, "a rejected credential is removed from storage");
  assert.equal(connection.credentialForRequests(), null);

  const garbage = new MemoryVault();
  garbage.stored = "corrupted";
  const restored = harness(transport, garbage);
  await restored.connection.restore();
  assert.equal(restored.connection.state.state, "disconnected");
  assert.equal(garbage.stored, null);
});

test("disconnect forgets the credential; a build without an ORIGIN server refuses to connect", async () => {
  const { connection, vault } = harness();
  await connection.connect(MOCK_ORIGIN_KEYS.owner);
  await connection.disconnect();
  assert.equal(connection.state.state, "disconnected");
  assert.equal(vault.stored, null);
  assert.equal(vault.clears, 1);
  assert.equal((await connection.refresh()).state, "disconnected");

  const none: OriginTransport = { kind: "none", target: "none", whoAmI: async () => fail("NOT_CONNECTED", "x"), getProject: async () => fail("NOT_CONNECTED", "x") };
  const noServer = harness(none);
  await noServer.connection.restore();
  assert.match((noServer.connection.state as { detail: string }).detail, /No ORIGIN server is configured/);
  const result = await noServer.connection.connect(MOCK_ORIGIN_KEYS.owner);
  assert.equal(!result.ok && result.error.code, "NOT_CONNECTED");
});

test("a credential that verified but could not be stored works for the session and says so", async () => {
  const vault = new MemoryVault();
  vault.failSave = true;
  const { connection, logs } = harness(new MockOriginTransport(), vault);
  assert.ok((await connection.connect(MOCK_ORIGIN_KEYS.owner)).ok);
  assert.equal(connection.state.state, "connected");
  assert.ok(connection.credentialForRequests());
  assert.ok(logs.some((l) => /not stored|this session only/.test(l)));
  assertNoSecret(logs);
});

test("a disconnect during verification wins over the late answer", async () => {
  const transport = new MockOriginTransport({ delayMs: 30 });
  const { connection } = harness(transport);
  const pending = connection.connect(MOCK_ORIGIN_KEYS.owner);
  await connection.disconnect();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(connection.state.state, "disconnected");
  assert.equal(connection.credentialForRequests(), null);
});
