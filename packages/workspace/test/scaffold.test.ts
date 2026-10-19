import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStarterFiles } from "@studio/core";
import { inspectProject, scaffoldProject } from "../src/index.ts";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "studio-scaffold-test-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

test("creates a complete, valid project directly inside the parent folder", () => {
  const result = scaffoldProject(tempRoot, "demo-app");
  assert.ok(result.ok, result.ok ? "" : result.error.message);
  assert.equal(result.value.root, path.join(tempRoot, "demo-app"));
  assert.equal(result.value.name, "demo-app");
  assert.deepEqual(result.value.files, getStarterFiles("demo-app").map((f) => f.path));
  for (const file of getStarterFiles("demo-app")) {
    assert.equal(readFileSync(path.join(result.value.root, ...file.path.split("/")), "utf8"), file.contents, file.path);
  }
  assert.deepEqual(inspectProject(result.value.root), { state: "valid", name: "demo-app", config: { schemaVersion: 1, language: "typescript" } });
});

test("trims the name and rejects invalid names without creating anything", () => {
  const trimmed = scaffoldProject(tempRoot, "  spaced  ");
  assert.ok(trimmed.ok && trimmed.value.name === "spaced");

  const before = readdirSync(tempRoot).length;
  for (const name of ["", "Bad Name", "../escape", "C:\\abs", "con", "a".repeat(215)]) {
    const result = scaffoldProject(tempRoot, name);
    assert.equal(!result.ok && result.error.code, "INVALID_NAME", JSON.stringify(name));
  }
  assert.equal(readdirSync(tempRoot).length, before, "nothing was created");
  assert.ok(!existsSync(path.join(path.dirname(tempRoot), "escape")));
});

test("uses an empty folder but never a non-empty one or a file", () => {
  mkdirSync(path.join(tempRoot, "empty"));
  assert.ok(scaffoldProject(tempRoot, "empty").ok);

  mkdirSync(path.join(tempRoot, "taken"));
  writeFileSync(path.join(tempRoot, "taken", "keep.txt"), "original");
  const taken = scaffoldProject(tempRoot, "taken");
  assert.equal(!taken.ok && taken.error.code, "ALREADY_EXISTS");
  if (!taken.ok) assert.match(taken.error.message, /Nothing was changed/);
  assert.deepEqual(readdirSync(path.join(tempRoot, "taken")), ["keep.txt"]);

  writeFileSync(path.join(tempRoot, "afile"), "x");
  const file = scaffoldProject(tempRoot, "afile");
  assert.equal(!file.ok && file.error.code, "ALREADY_EXISTS");
  assert.equal(readFileSync(path.join(tempRoot, "afile"), "utf8"), "x");
});

test("a second run over the same project changes nothing", () => {
  const first = scaffoldProject(tempRoot, "twice");
  assert.ok(first.ok);
  writeFileSync(path.join(tempRoot, "twice", "src", "index.ts"), "// edited");
  const second = scaffoldProject(tempRoot, "twice");
  assert.equal(!second.ok && second.error.code, "ALREADY_EXISTS");
  assert.equal(readFileSync(path.join(tempRoot, "twice", "src", "index.ts"), "utf8"), "// edited");
});
