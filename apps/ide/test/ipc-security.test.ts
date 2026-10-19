import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IpcChannel } from "@studio/contracts";
import {
  ArgumentError,
  MAX_FILE_CONTENT_LENGTH,
  parseConfirmClose,
  parseCreate,
  parseDelete,
  parseNoArgs,
  parsePath,
  parseRename,
  parseSaveAs,
  parseTerminalCreate,
  parseTerminalId,
  parseTerminalResize,
  parseTerminalWrite,
  parseWrite
} from "../electron/ipc-validation.ts";
import { PRODUCTION_CSP, developmentCsp, isTrustedRendererUrl, parseDevServerUrl } from "../electron/security.ts";

function rejects(fn: () => unknown, label: string) {
  assert.throws(fn, ArgumentError, label);
}

test("IPC parsers accept well-formed arguments", () => {
  parseNoArgs([]);
  assert.equal(parseConfirmClose([true]), true);
  assert.equal(parsePath(["src/a.ts"]), "src/a.ts");
  assert.deepEqual(parseWrite(["a.ts", "text", { expectedVersion: null }]), { path: "a.ts", content: "text", options: { expectedVersion: null } });
  assert.deepEqual(parseWrite(["a.ts", "", { expectedVersion: "abc", overwrite: true, bom: false }]).options, {
    expectedVersion: "abc",
    overwrite: true,
    bom: false
  });
  assert.deepEqual(parseSaveAs(["a.ts", "x", true]), { suggestedPath: "a.ts", content: "x", bom: true });
  assert.deepEqual(parseCreate(["src", "b.ts"]), { parent: "src", name: "b.ts" });
  assert.deepEqual(parseRename(["a.ts", "b.ts"]), { path: "a.ts", newName: "b.ts" });
  assert.deepEqual(parseDelete(["a.ts", true]), { path: "a.ts", confirmed: true });
  assert.deepEqual(parseTerminalCreate([{ cols: 80, rows: 24 }]), { cols: 80, rows: 24 });
  assert.deepEqual(parseTerminalCreate([{ shell: "pwsh", cols: 80, rows: 24 }]), { shell: "pwsh", cols: 80, rows: 24 });
  assert.deepEqual(parseTerminalWrite([1, "ls\r"]), { id: 1, data: "ls\r" });
  assert.deepEqual(parseTerminalResize([1, 120, 30]), { id: 1, cols: 120, rows: 30 });
  assert.equal(parseTerminalId([3]), 3);
});

test("IPC parsers reject malformed, oversized and unexpected arguments", () => {
  rejects(() => parseNoArgs(["extra"]), "extra argument");
  rejects(() => parseConfirmClose(["yes"]), "non-boolean");
  rejects(() => parsePath([42]), "number path");
  rejects(() => parsePath([]), "missing path");
  rejects(() => parsePath(["a", "b"]), "too many args");
  rejects(() => parsePath(["x".repeat(5000)]), "long path");
  rejects(() => parseWrite(["a.ts", { toString: () => "x" }, { expectedVersion: null }]), "object content");
  rejects(() => parseWrite(["a.ts", "x", null]), "null options");
  rejects(() => parseWrite(["a.ts", "x", { expectedVersion: 5 }]), "numeric version");
  rejects(() => parseWrite(["a.ts", "x", { expectedVersion: null, overwrite: "true" }]), "string overwrite");
  rejects(() => parseWrite(["a.ts", "x".repeat(MAX_FILE_CONTENT_LENGTH + 1), { expectedVersion: null }]), "huge content");
  rejects(() => parseCreate(["", "x".repeat(300)]), "long name");
  rejects(() => parseDelete(["a.ts", false]), "unconfirmed delete");
  rejects(() => parseDelete(["a.ts", "true"]), "string confirmation");
  rejects(() => parseDelete(["a.ts"]), "missing confirmation");
  rejects(() => parseTerminalCreate([{ shell: "C:\\evil.exe", cols: 80, rows: 24 }]), "arbitrary executable");
  rejects(() => parseTerminalCreate([{ shell: "pwsh", cols: 0, rows: 24 }]), "zero cols");
  rejects(() => parseTerminalCreate([{ cols: 80.5, rows: 24 }]), "fractional cols");
  rejects(() => parseTerminalCreate([{ cols: 80, rows: 100000 }]), "huge rows");
  rejects(() => parseTerminalCreate(["pwsh"]), "string options");
  rejects(() => parseTerminalWrite([0, "x"]), "id zero");
  rejects(() => parseTerminalWrite([1, "x".repeat(70000)]), "huge write");
  rejects(() => parseTerminalWrite(["1", "x"]), "string id");
});

test("only the app's own pages are trusted IPC senders", () => {
  assert.equal(isTrustedRendererUrl("app://studio/index.html", null), true);
  assert.equal(isTrustedRendererUrl("app://studio/assets/x.js", null), true);
  assert.equal(isTrustedRendererUrl("app://evil/index.html", null), false);
  assert.equal(isTrustedRendererUrl("https://example.com/", null), false);
  assert.equal(isTrustedRendererUrl("file:///C:/index.html", null), false);
  assert.equal(isTrustedRendererUrl("not a url", null), false);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/", null), false, "dev server is untrusted in production");
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/src/main.tsx", "http://127.0.0.1:5173"), true);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5174/", "http://127.0.0.1:5173"), false);
});

test("the dev server URL is only accepted on the local machine", () => {
  assert.equal(parseDevServerUrl(undefined), null);
  assert.equal(parseDevServerUrl("http://localhost:5173/"), "http://localhost:5173");
  assert.equal(parseDevServerUrl("http://127.0.0.1:5173"), "http://127.0.0.1:5173");
  assert.equal(parseDevServerUrl("https://evil.example.com"), null);
  assert.equal(parseDevServerUrl("http://192.168.1.5:5173"), null);
  assert.equal(parseDevServerUrl("javascript:alert(1)"), null);
});

test("the production content security policy allows no remote or inline code", () => {
  assert.match(PRODUCTION_CSP, /default-src 'self'/);
  assert.match(PRODUCTION_CSP, /script-src 'self';/);
  assert.doesNotMatch(PRODUCTION_CSP, /unsafe-eval|https?:|\*/);
  assert.doesNotMatch(PRODUCTION_CSP.split(";").find((d) => d.trim().startsWith("script-src")) ?? "", /unsafe-inline/);
  assert.match(developmentCsp("http://127.0.0.1:5173"), /connect-src 'self' ws:\/\/127\.0\.0\.1:5173/);
});

test("every channel the preload uses has a main-process handler, and nothing else is exposed", () => {
  const read = (file: string) => readFileSync(new URL(`../electron/${file}`, import.meta.url), "utf8");
  const used = (source: string) => new Set([...source.matchAll(/IpcChannel\.(\w+)/g)].map((m) => m[1]));
  const preload = used(read("preload.ts"));
  const handled = used(read("ipc.ts"));
  const pushed = used(read("main.ts"));
  for (const name of preload) {
    assert.ok(handled.has(name) || pushed.has(name), `${name} is used by the preload but never handled or sent`);
  }
  for (const name of Object.keys(IpcChannel)) {
    assert.ok(preload.has(name), `${name} is defined but not exposed`);
  }
  assert.doesNotMatch(read("preload.ts"), /require\(|process\.|ipcRenderer\.send\(|exposeInMainWorld\("(?!studio")/);
});
