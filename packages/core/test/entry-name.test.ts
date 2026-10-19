import test from "node:test";
import assert from "node:assert/strict";

import { validateEntryName } from "../src/index.ts";

test("accepts ordinary file and folder names", () => {
  for (const name of ["index.ts", "README.md", ".gitignore", "my folder", "Ünïcode.txt", "a.b.c"]) {
    assert.deepEqual(validateEntryName(name), { valid: true, name }, name);
  }
  assert.deepEqual(validateEntryName("  padded.ts "), { valid: true, name: "padded.ts" });
});

test("rejects paths, traversal and characters Windows forbids", () => {
  for (const name of ["", "  ", ".", "..", "a/b", "a\b", "../x", "x:y", "a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "tab\there", "dot."]) {
    assert.equal(validateEntryName(name).valid, false, JSON.stringify(name));
  }
  assert.equal(validateEntryName("x".repeat(256)).valid, false);
});

test("rejects Windows reserved device names with or without an extension", () => {
  for (const name of ["con", "CON", "nul.txt", "Aux.md", "com1", "LPT9.log", "prn"]) {
    const result = validateEntryName(name);
    assert.equal(result.valid, false, name);
    if (!result.valid) assert.match(result.reason, /reserved by Windows/);
  }
  assert.equal(validateEntryName("console.ts").valid, true);
});
