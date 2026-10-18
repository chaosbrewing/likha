// These tests run the compiled CLI (dist/index.js) in a child process, exactly
// as the installed `chaos` command does. Run `npm run build` first; `npm test`
// does this automatically.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getStarterFiles } from "@studio/core";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const cliManifest = JSON.parse(readFileSync(path.join(cliRoot, "package.json"), "utf8")) as {
  version: string;
  bin: Record<string, string>;
};
const cliEntry = path.join(cliRoot, cliManifest.bin.chaos);

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "chaos-cli-test-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

let counter = 0;
function freshDir(): string {
  const dir = path.join(tempRoot, `case-${++counter}`);
  mkdirSync(dir);
  return dir;
}

function chaos(args: string[], cwd: string = freshDir()) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("bin entry points at the compiled, executable JavaScript", () => {
  assert.equal(cliManifest.bin.chaos, "dist/index.js");
  assert.ok(existsSync(cliEntry), `${cliEntry} is missing - run npm run build`);
  assert.match(readFileSync(cliEntry, "utf8"), /^#!\/usr\/bin\/env node\r?\n/);
});

test("help output", () => {
  for (const args of [["help"], ["--help"], ["-h"], []]) {
    const { code, stdout, stderr } = chaos(args);
    assert.equal(code, 0, args.join(" "));
    assert.equal(stderr, "");
    assert.match(stdout, /Origin Studio CLI/);
    assert.match(stdout, /init <name>/);
    assert.match(stdout, /status/);
  }
});

test("version output matches the CLI package version", () => {
  for (const args of [["--version"], ["version"], ["-v"]]) {
    const { code, stdout } = chaos(args);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), cliManifest.version);
  }
});

test("status outside a project", () => {
  const cwd = freshDir();
  const { code, stdout } = chaos(["status"], cwd);
  assert.equal(code, 0);
  assert.match(stdout, /Product:\s+Origin Studio/);
  assert.match(stdout, new RegExp(`CLI:\\s+chaos v${cliManifest.version.replaceAll(".", "\\.")}`));
  assert.match(stdout, new RegExp(`Node\\.js:\\s+${process.version.replaceAll(".", "\\.")}`));
  assert.ok(stdout.includes(cwd), "status shows the working directory");
  assert.match(stdout, /No Origin Studio project/);
});

test("status does not trust a package.json by name alone", () => {
  const plain = freshDir();
  writeFileSync(path.join(plain, "package.json"), JSON.stringify({ name: "plain" }));
  assert.match(chaos(["status"], plain).stdout, /No Origin Studio project/);

  const malformedJson = freshDir();
  writeFileSync(path.join(malformedJson, "package.json"), "{ not json");
  assert.match(chaos(["status"], malformedJson).stdout, /invalid/);

  const badConfig = freshDir();
  writeFileSync(path.join(badConfig, "package.json"), JSON.stringify({ name: "x", originStudio: true }));
  assert.match(chaos(["status"], badConfig).stdout, /invalid/);
});

test("status reports a valid project, and an incomplete one as invalid", () => {
  const parent = freshDir();
  assert.equal(chaos(["init", "status-demo"], parent).code, 0);
  const project = path.join(parent, "status-demo");

  assert.match(chaos(["status"], project).stdout, /status-demo \(valid Origin Studio project\)/);

  rmSync(path.join(project, "src", "index.ts"));
  const { stdout } = chaos(["status"], project);
  assert.match(stdout, /invalid/);
  assert.match(stdout, /Missing expected file: src\/index\.ts/);
});

test("init creates a project with the expected files", () => {
  const parent = freshDir();
  const { code, stdout, stderr } = chaos(["init", "my-project"], parent);
  assert.equal(code, 0, stderr);

  const project = path.join(parent, "my-project");
  assert.ok(stdout.includes(project), "success message names the project folder");
  assert.match(stdout, /Next steps:/);
  assert.match(stdout, /npm install/);

  assert.deepEqual(readdirSync(project).sort(), [
    ".gitignore",
    "README.md",
    "package.json",
    "src",
    "tsconfig.json"
  ]);
  assert.deepEqual(readdirSync(path.join(project, "src")), ["index.ts"]);
});

test("generated files are valid and match the shared core templates", () => {
  const parent = freshDir();
  assert.equal(chaos(["init", "gen-check"], parent).code, 0);
  const project = path.join(parent, "gen-check");

  const manifest = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
  assert.equal(manifest.name, "gen-check");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.scripts.build, "tsc");
  assert.deepEqual(manifest.originStudio, { schemaVersion: 1, language: "typescript" });

  const tsconfig = JSON.parse(readFileSync(path.join(project, "tsconfig.json"), "utf8"));
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.outDir, "dist");

  assert.match(readFileSync(path.join(project, "src", "index.ts"), "utf8"), /console\.log/);
  assert.match(readFileSync(path.join(project, ".gitignore"), "utf8"), /node_modules\//);
  assert.match(readFileSync(path.join(project, "README.md"), "utf8"), /# gen-check/);

  // Shared core integration: the CLI wrote exactly what @studio/core produces.
  for (const file of getStarterFiles("gen-check")) {
    assert.equal(
      readFileSync(path.join(project, ...file.path.split("/")), "utf8"),
      file.contents,
      file.path
    );
  }
});

test("compiled CLI resolves @studio/core to its compiled build", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "console.log(import.meta.resolve('@studio/core'))"],
    { cwd: cliRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const expected = pathToFileURL(
    path.resolve(cliRoot, "..", "..", "packages", "core", "dist", "index.js")
  ).href;
  assert.equal(result.stdout.trim().toLowerCase(), expected.toLowerCase());
});

test("init rejects invalid project names with a usage exit code", () => {
  for (const name of ["My Project", "UPPER", "-flag-like", "con", "has space", ""]) {
    const parent = freshDir();
    const { code, stderr } = chaos(["init", name], parent);
    assert.equal(code, 2, JSON.stringify(name));
    assert.match(stderr, /^Error: /);
    assert.deepEqual(readdirSync(parent), [], "nothing is created");
  }
});

test("init rejects path traversal and absolute paths", () => {
  const outer = freshDir();
  const cwd = path.join(outer, "work");
  mkdirSync(cwd);
  const absolute = path.join(outer, "abs-target");

  for (const name of ["../escape", "..\\escape", "nested/dir", "nested\\dir", absolute, "."]) {
    const { code, stderr } = chaos(["init", name], cwd);
    assert.equal(code, 2, name);
    assert.match(stderr, /single folder name/);
  }
  assert.deepEqual(readdirSync(outer), ["work"], "nothing escaped the working directory");
  assert.deepEqual(readdirSync(cwd), []);
});

test("init never overwrites an existing non-empty folder", () => {
  const parent = freshDir();
  const existing = path.join(parent, "taken");
  mkdirSync(existing);
  writeFileSync(path.join(existing, "keep.txt"), "original");

  const { code, stderr } = chaos(["init", "taken"], parent);
  assert.equal(code, 1);
  assert.match(stderr, /already exists and is not empty/);
  assert.deepEqual(readdirSync(existing), ["keep.txt"]);
  assert.equal(readFileSync(path.join(existing, "keep.txt"), "utf8"), "original");
});

test("init refuses when the name is an existing file", () => {
  const parent = freshDir();
  writeFileSync(path.join(parent, "a-file"), "data");
  const { code, stderr } = chaos(["init", "a-file"], parent);
  assert.equal(code, 1);
  assert.match(stderr, /not a folder/);
  assert.equal(readFileSync(path.join(parent, "a-file"), "utf8"), "data");
});

test("init may use an existing empty folder", () => {
  const parent = freshDir();
  mkdirSync(path.join(parent, "empty"));
  assert.equal(chaos(["init", "empty"], parent).code, 0);
  assert.ok(existsSync(path.join(parent, "empty", "package.json")));
});

test("error exit codes", () => {
  const cases: Array<[string[], number, RegExp]> = [
    [["bogus"], 2, /Unknown command: bogus/],
    [["--nope"], 2, /Unknown option: --nope/],
    [["init"], 2, /Missing project name/],
    [["init", "a", "b"], 2, /Unexpected arguments/],
    [["status", "extra"], 2, /takes no arguments/]
  ];
  for (const [args, expected, message] of cases) {
    const { code, stdout, stderr } = chaos(args);
    assert.equal(code, expected, args.join(" "));
    assert.equal(stdout, "", "errors go to stderr only");
    assert.match(stderr, message);
    assert.match(stderr, /chaos help/);
  }
});
