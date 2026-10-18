
import test from "node:test";
import assert from "node:assert/strict";

import {
  createProject,
  getStudioInfo,
  getWelcomeMessage
} from "../src/index.ts";

test("studio reports ready", () => {
  const info = getStudioInfo();

  assert.equal(info.status, "ready");
  assert.equal(info.version, "0.1.0");
});

test("welcome message is available", () => {
  assert.match(
    getWelcomeMessage(),
    /Welcome/
  );
});

test("valid project can be configured", () => {
  const project = createProject("demo-app");

  assert.equal(project.name, "demo-app");
  assert.equal(project.language, "typescript");
  assert.ok(project.createdAt);
});

test("invalid project name is rejected", () => {
  assert.throws(
    () => createProject("Invalid Project Name"),
    /Project name/
  );
});
