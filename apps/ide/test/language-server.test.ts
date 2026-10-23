// Runs the real TypeScript language server (the native compiler in --lsp mode)
// against a temporary project, the way the app does.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LanguageServerStatus, ProjectProblemsEvent } from "@studio/contracts";
import { listSourceFiles } from "@studio/workspace";
import { LanguageServerManager } from "../electron/language-server.ts";
import { resolveTypeScriptServer } from "../electron/typescript-binary.ts";

const require = createRequire(import.meta.url);
const binary = resolveTypeScriptServer({ resourcesPath: null, resolve: (id) => require.resolve(id) });
const root = mkdtempSync(path.join(os.tmpdir(), "origin-language-server-"));
const children: ChildProcess[] = [];
after(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function write(relative: string, content: string) {
  const target = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
write("package.json", JSON.stringify({ name: "lsp-test", type: "module" }));
write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true }, include: ["src"] }));
write("src/util.ts", "/** Greets someone. */\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\nexport const answer: number = 42;\n");
write("src/index.ts", 'import { greet, answer } from "./util.js";\nimport { missing } from "./nope.js";\nconst n: number = greet("x");\nconsole.log(answer, n, missing);\n');
write("src/other.ts", 'import { answer } from "./util.js";\nconst s: string = answer;\n');
write("node_modules/dep/index.ts", "const bad: number = 'in node_modules';\n");

function createManager() {
  const statuses: LanguageServerStatus[] = [];
  const problems: ProjectProblemsEvent[] = [];
  const logs: string[] = [];
  const waiters: ((event: ProjectProblemsEvent) => void)[] = [];
  const manager = new LanguageServerManager({
    binary: () => binary,
    listSourceFiles,
    spawn: (exe, args) => {
      const child = spawn(exe, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      children.push(child);
      return child;
    },
    projectCheckDelayMs: 100,
    onStatus: (status) => statuses.push(status),
    onProblems: (event) => {
      problems.push(event);
      for (const waiter of waiters.splice(0)) waiter(event);
    },
    log: (message) => logs.push(message)
  });
  const nextProblems = () => new Promise<ProjectProblemsEvent>((resolve) => waiters.push(resolve));
  return { manager, statuses, problems, logs, nextProblems };
}

const indexText = 'import { greet, answer } from "./util.js";\nimport { missing } from "./nope.js";\nconst n: number = greet("x");\nconsole.log(answer, n, missing);\n';

test("the language server answers project-wide questions and stops cleanly", { timeout: 90_000, skip: binary === null && "no native TypeScript for this platform" }, async () => {
  const { manager, statuses, problems, logs, nextProblems } = createManager();
  const initial: LanguageServerStatus = manager.status;
  assert.equal(initial.state, "off");
  const firstCheck = nextProblems();
  await manager.start(root);
  assert.deepEqual(
    statuses.map((s) => s.state),
    ["starting", "ready"]
  );
  const ready: LanguageServerStatus = manager.status;
  assert.ok(ready.state === "ready" && ready.version === binary!.version, JSON.stringify(ready));

  // Nothing before the document is open: the server only hears about opened files.
  assert.deepEqual(await manager.hover("src/index.ts", { line: 2, character: 19 }), { ok: true, value: null });

  manager.open("src/index.ts", "typescript", 1, indexText);
  const diagnostics = await manager.diagnostics("src/index.ts");
  assert.ok(diagnostics.ok);
  assert.deepEqual(
    diagnostics.value.map((d) => [d.code, d.severity, d.range.start.line]),
    [
      ["2307", "error", 1],
      ["2322", "error", 2]
    ],
    "a missing module and a cross-file type mismatch are both reported"
  );

  const hover = await manager.hover("src/index.ts", { line: 2, character: 19 });
  assert.ok(hover.ok && hover.value);
  assert.match(hover.value.contents, /function greet\(name: string\): string/);
  assert.match(hover.value.contents, /Greets someone/);

  const definition = await manager.definition("src/index.ts", { line: 2, character: 19 });
  assert.deepEqual(definition, { ok: true, value: [{ path: "src/util.ts", range: { start: { line: 1, character: 16 }, end: { line: 1, character: 21 } } }] });

  const references = await manager.references("src/index.ts", { line: 0, character: 17 });
  assert.ok(references.ok);
  assert.deepEqual([...new Set(references.value.map((r) => r.path))].sort(), ["src/index.ts", "src/other.ts", "src/util.ts"], "references include files that are not open");
  assert.ok(!JSON.stringify(references.value).includes(root.replace(/\\/g, "\\\\")), "no absolute paths leave the host");

  // Type "\ngre" at the end, complete it, resolve the chosen item.
  manager.change("src/index.ts", 2, [{ range: { start: { line: 3, character: 32 }, end: { line: 3, character: 32 } }, text: "\ngre" }]);
  const completion = await manager.completion("src/index.ts", { line: 4, character: 3 }, { triggerKind: 1 });
  assert.ok(completion.ok && completion.value);
  const greet = completion.value.items.find((item) => item.label === "greet");
  assert.ok(greet, "greet from util.ts is offered");
  assert.deepEqual(greet.textEdit?.range, { start: { line: 4, character: 0 }, end: { line: 4, character: 3 } });
  assert.ok(!JSON.stringify(completion.value).includes("fileName"), "server-internal item data is not forwarded");
  const resolved = await manager.resolveCompletion(completion.value.token, greet.index);
  assert.ok(resolved.ok && resolved.value);
  assert.match(resolved.value.detail ?? "", /greet\(name: string\): string/);
  assert.deepEqual(await manager.resolveCompletion(999, 0), { ok: true, value: null });

  manager.change("src/index.ts", 3, [{ range: { start: { line: 4, character: 3 }, end: { line: 4, character: 3 } }, text: "et(" }]);
  const signature = await manager.signatureHelp("src/index.ts", { line: 4, character: 6 });
  assert.ok(signature.ok && signature.value);
  assert.equal(signature.value.signatures[0]?.label, "greet(name: string): string");

  // Paths are validated: nothing outside the workspace is ever sent to the server.
  manager.open("../outside.ts", "typescript", 1, "x");
  assert.equal(manager.documents.has("../outside.ts"), false);
  assert.deepEqual(await manager.diagnostics("C:/Windows/x.ts"), { ok: true, value: [] });
  assert.deepEqual(await manager.hover("src/util.ts", { line: 0, character: 0 }), { ok: true, value: null }, "unopened documents are not queried");

  // The project-wide check covers files that are not open, and skips node_modules.
  const event = await firstCheck;
  assert.equal(event.filesChecked, 3);
  assert.equal(event.truncated, false);
  const other = event.problems.filter((p) => p.path === "src/other.ts");
  assert.ok(other.some((p) => p.code === "2322" && p.severity === "error"), "other.ts has a type error although it was never opened");
  assert.ok(!event.problems.some((p) => p.path.startsWith("node_modules")));

  // A save (or any disk change) schedules another check.
  write("src/other.ts", 'import { answer } from "./util.js";\nconst s: number = answer;\nconsole.log(s);\n');
  const second = nextProblems();
  manager.workspaceChanged();
  const recheck = await second;
  assert.equal(recheck.problems.filter((p) => p.path === "src/other.ts").length, 0, "the fixed file has no problems on the next check");
  assert.ok(problems.length >= 2);

  manager.close("src/index.ts");
  assert.equal(manager.documents.size, 0);

  await manager.stop("test over");
  assert.equal(manager.status.state, "off");
  const child = children[0]!;
  assert.ok(child.exitCode !== null || child.signalCode !== null, "the server process has ended");
  assert.deepEqual(await manager.hover("src/index.ts", { line: 0, character: 0 }), { ok: true, value: null });
  assert.ok(logs.some((line) => /language server .* started/.test(line)));
});

test("terminate ends the server at once and a second start replaces the first", { timeout: 60_000, skip: binary === null && "no native TypeScript for this platform" }, async () => {
  const { manager } = createManager();
  const first = manager.start(root);
  const second = manager.start(root);
  await Promise.all([first, second]);
  assert.equal(manager.status.state, "ready");
  const alive = children.filter((child) => child.exitCode === null && child.signalCode === null);
  assert.equal(alive.length, 1, "exactly one server process is running");
  manager.terminate();
  assert.equal(manager.status.state, "off");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(children.every((child) => child.exitCode !== null || child.signalCode !== null));
});

test("a missing executable is reported as unavailable, not as a crash", async () => {
  const statuses: LanguageServerStatus[] = [];
  const manager = new LanguageServerManager({
    binary: () => null,
    listSourceFiles,
    onStatus: (status) => statuses.push(status),
    onProblems: () => undefined,
    log: () => undefined
  });
  await manager.start(root);
  assert.equal(statuses[0]?.state, "unavailable");
  assert.deepEqual(await manager.definition("src/index.ts", { line: 0, character: 0 }), { ok: true, value: [] });

  const broken = new LanguageServerManager({
    binary: () => ({ exe: path.join(root, "does-not-exist.exe"), version: "0" }),
    listSourceFiles,
    onStatus: (status) => statuses.push(status),
    onProblems: () => undefined,
    log: () => undefined
  });
  await broken.start(root);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(statuses.some((s) => s.state === "unavailable" && /Could not start|did not start/.test(s.detail)), JSON.stringify(statuses));
});
