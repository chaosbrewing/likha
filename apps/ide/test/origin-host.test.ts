import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOriginTransport, parseOriginConfig } from "../electron/origin-config.ts";
import { createSafeStorageVault, type SecretCipher } from "../electron/origin-vault.ts";

/** Stands in for Electron safeStorage: reversible, and visibly not plain text. */
function cipher(available = true): SecretCipher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isEncryptionAvailable: () => available,
    encryptString: (text) => {
      calls.push("encrypt");
      return Buffer.from(Buffer.from(text, "utf8").map((b) => b ^ 0x5a));
    },
    decryptString: (bytes) => {
      calls.push("decrypt");
      return Buffer.from(bytes.map((b) => b ^ 0x5a)).toString("utf8");
    }
  };
}

test("the credential vault stores only ciphertext, round-trips, and clears", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "origin-vault-"));
  try {
    const file = path.join(dir, "origin-credential.bin");
    const logs: string[] = [];
    const vault = createSafeStorageVault({ file, cipher: cipher(), log: (m) => logs.push(m) });
    assert.equal(await vault.load(), null);
    const secret = "a".repeat(64);
    assert.ok((await vault.save(secret)).ok);
    assert.ok(existsSync(file));
    const stored = readFileSync(file);
    assert.ok(!stored.toString("latin1").includes(secret), "the secret is not on disk in plain text");
    assert.equal(stored.subarray(0, 4).toString("ascii"), "OSV1");
    assert.equal(await vault.load(), secret);
    await vault.clear();
    assert.ok(!existsSync(file));
    assert.equal(await vault.load(), null);
    await vault.clear(); // idempotent
    assert.match(vault.description, /encrypted/);

    writeFileSync(file, "garbage");
    assert.equal(await vault.load(), null);
    assert.ok(logs.some((l) => /unknown format/.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without OS encryption nothing is written and the vault says so", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "origin-vault-"));
  try {
    const file = path.join(dir, "origin-credential.bin");
    const vault = createSafeStorageVault({ file, cipher: cipher(false), log: () => undefined });
    const saved = await vault.save("b".repeat(64));
    assert.equal(!saved.ok && saved.error.code, "UNAVAILABLE");
    assert.ok(!existsSync(file));
    assert.match(vault.description, /unavailable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("origin.json and the environment select the transport; anything unusable falls back to none with a reason", () => {
  assert.deepEqual(parseOriginConfig(null, {}), { transport: "none", baseUrl: null, mockOffline: false, problem: null });
  assert.deepEqual(parseOriginConfig('{"transport":"mock"}', {}), { transport: "mock", baseUrl: null, mockOffline: false, problem: null });
  assert.deepEqual(parseOriginConfig('{"transport":"http","baseUrl":"https://origin.example.test/"}', {}), { transport: "http", baseUrl: "https://origin.example.test", mockOffline: false, problem: null });
  assert.match(parseOriginConfig('{"transport":"http"}', {}).problem ?? "", /needs a "baseUrl"/);
  assert.match(parseOriginConfig('{"transport":"http","baseUrl":"http://origin.example.test"}', {}).problem ?? "", /https/);
  assert.match(parseOriginConfig('{"transport":"carrier-pigeon"}', {}).problem ?? "", /unknown transport/);
  assert.match(parseOriginConfig("nope", {}).problem ?? "", /not valid JSON/);
  assert.match(parseOriginConfig("[]", {}).problem ?? "", /JSON object/);
  const env = parseOriginConfig('{"transport":"http","baseUrl":"https://origin.example.test"}', { ORIGIN_STUDIO_ORIGIN_TRANSPORT: "mock", ORIGIN_STUDIO_ORIGIN_MOCK_OFFLINE: "1" });
  assert.deepEqual(env, { transport: "mock", baseUrl: null, mockOffline: true, problem: null }, "the environment wins over the file");
  assert.equal(parseOriginConfig(null, { ORIGIN_STUDIO_ORIGIN_TRANSPORT: "http", ORIGIN_STUDIO_ORIGIN_URL: "http://localhost:5000" }).baseUrl, "http://localhost:5000");

  const none = createOriginTransport(parseOriginConfig(null, {}));
  assert.ok(none.ok && none.value.kind === "none");
  const mock = createOriginTransport(parseOriginConfig('{"transport":"mock"}', {}));
  assert.ok(mock.ok && mock.value.kind === "mock");
  const http = createOriginTransport(parseOriginConfig('{"transport":"http","baseUrl":"https://origin.example.test"}', {}));
  assert.ok(http.ok && http.value.kind === "http" && http.value.target === "https://origin.example.test");
});
