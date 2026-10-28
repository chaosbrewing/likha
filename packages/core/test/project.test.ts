import test from "node:test";
import assert from "node:assert/strict";

import {
  checkProjectManifest,
  getStarterFiles,
  validateProjectName
} from "../src/index.ts";

test("accepts simple project names", () => {
  for (const name of ["my-project", "app_1", "x", "2fast"]) {
    const result = validateProjectName(name);
    assert.equal(result.valid, true, name);
  }
});

test("trims surrounding whitespace from names", () => {
  assert.deepEqual(validateProjectName("  demo  "), { valid: true, name: "demo" });
});

test("rejects invalid project names", () => {
  for (const name of ["", "   ", "My Project", "UPPER", "-lead", "_lead", "has.dot", "a".repeat(215)]) {
    assert.equal(validateProjectName(name).valid, false, JSON.stringify(name));
  }
});

test("rejects paths and traversal", () => {
  for (const name of ["../escape", "..\\escape", "a/b", "a\\b", "C:\\temp\\x", "C:x", "/abs", ".", ".."]) {
    const result = validateProjectName(name);
    assert.equal(result.valid, false, name);
    if (!result.valid) {
      assert.match(result.reason, /single folder name|lowercase/);
    }
  }
});

test("rejects Windows reserved device names", () => {
  for (const name of ["con", "nul", "aux", "com1", "lpt9"]) {
    const result = validateProjectName(name);
    assert.equal(result.valid, false, name);
    if (!result.valid) {
      assert.match(result.reason, /reserved by Windows/);
    }
  }
});

test("manifest without LIKHA section is not a project", () => {
  assert.deepEqual(checkProjectManifest({ name: "plain" }), { state: "none" });
});

test("manifest with a malformed LIKHA section is invalid", () => {
  const cases: unknown[] = [
    { name: "x", originStudio: true },
    { name: "x", originStudio: { schemaVersion: 2, language: "typescript" } },
    { name: "x", originStudio: { schemaVersion: 1, language: "python" } },
    { originStudio: { schemaVersion: 1, language: "typescript" } },
    [],
    "text"
  ];
  for (const manifest of cases) {
    assert.equal(checkProjectManifest(manifest).state, "invalid", JSON.stringify(manifest));
  }
});

test("starter files are complete and produce a valid manifest", () => {
  const files = getStarterFiles("demo");
  assert.deepEqual(
    files.map((file) => file.path).sort(),
    [".gitignore", "README.md", "package.json", "src/index.ts", "tsconfig.json"]
  );

  const manifest: unknown = JSON.parse(files.find((f) => f.path === "package.json")!.contents);
  const check = checkProjectManifest(manifest);
  assert.equal(check.state, "valid");
  if (check.state === "valid") {
    assert.equal(check.name, "demo");
  }

  JSON.parse(files.find((f) => f.path === "tsconfig.json")!.contents);
});
