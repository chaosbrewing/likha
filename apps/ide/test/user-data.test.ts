import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { SETTINGS_DIRNAME, resolveUserDataDir } from "../electron/user-data.js";

test("settings stay in the pre-rename folder so they survive the LIKHA rename", () => {
  assert.equal(SETTINGS_DIRNAME, "Origin Studio");
  assert.equal(resolveUserDataDir(path.join("C:", "Users", "a", "AppData", "Roaming"), {}), path.join("C:", "Users", "a", "AppData", "Roaming", "Origin Studio"));
});

test("the test override wins and is resolved to an absolute path", () => {
  assert.equal(resolveUserDataDir("/appdata", { ORIGIN_STUDIO_USER_DATA: "rel/dir" }), path.resolve("rel/dir"));
});
