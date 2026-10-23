import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { enabledFeatureNames, loadFeatureFlags, parseFeatureFile, parseFeatureList } from "../electron/features.ts";

test("feature flags are off by default and only known names turn them on", () => {
  assert.deepEqual(parseFeatureList(undefined), {});
  assert.deepEqual(parseFeatureList("origin-core"), { originCore: true });
  assert.deepEqual(parseFeatureList(" Origin-Core , bogus,,"), { originCore: true });
  assert.deepEqual(parseFeatureList("bogus"), {});
  assert.deepEqual(parseFeatureFile('{"origin-core": true}'), { originCore: true });
  assert.deepEqual(parseFeatureFile('{"originCore": false}'), { originCore: false });
  assert.deepEqual(parseFeatureFile('{"origin-core": "yes"}'), {});
  assert.deepEqual(parseFeatureFile("not json"), {});
  assert.deepEqual(parseFeatureFile("[]"), {});
});

test("the environment overrides features.json, and a missing file means defaults", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "origin-features-"));
  try {
    const file = path.join(dir, "features.json");
    assert.deepEqual(loadFeatureFlags(file, {}), { originCore: false });
    writeFileSync(file, '{"origin-core": true}');
    assert.deepEqual(loadFeatureFlags(file, {}), { originCore: true });
    assert.deepEqual(loadFeatureFlags(file, { ORIGIN_STUDIO_FEATURES: "" }), { originCore: true });
    writeFileSync(file, '{"origin-core": false}');
    assert.deepEqual(loadFeatureFlags(file, { ORIGIN_STUDIO_FEATURES: "origin-core" }), { originCore: true });
    assert.deepEqual(enabledFeatureNames({ originCore: true }), ["origin-core"]);
    assert.deepEqual(enabledFeatureNames({ originCore: false }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
