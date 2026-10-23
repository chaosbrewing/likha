import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSourceFiles } from "../src/index.ts";

test("listSourceFiles finds source files, skips dependencies, output and hidden folders, and honours the limit", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "origin-source-files-"));
  try {
    const write = (rel: string) => {
      const target = path.join(root, ...rel.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "");
    };
    for (const file of [
      "src/index.ts",
      "src/components/App.tsx",
      "src/types.d.ts",
      "lib/util.js",
      "scripts/run.mjs",
      "README.md",
      "node_modules/dep/index.ts",
      "dist/index.js",
      ".hidden/secret.ts",
      "src/data.json"
    ]) {
      write(file);
    }
    const listing = await listSourceFiles(root, 100);
    assert.deepEqual(listing, {
      files: ["lib/util.js", "scripts/run.mjs", "src/components/App.tsx", "src/index.ts"],
      truncated: false
    });

    const limited = await listSourceFiles(root, 2);
    assert.equal(limited.files.length, 2);
    assert.equal(limited.truncated, true);

    const missing = await listSourceFiles(path.join(root, "nope"), 10);
    assert.deepEqual(missing, { files: [], truncated: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
