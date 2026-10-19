import test, { after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileVersion, inspectProject, parseRelativePath, readGitBranch, readSafeScriptNames, WorkspaceService } from "../src/index.ts";
import { getStarterFiles } from "@studio/core";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "studio-workspace-test-"));
after(() => {
  // Undo read-only flags so cleanup can remove everything.
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
        chmodSync(full, 0o777);
      } catch {}
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(tempRoot);
  rmSync(tempRoot, { recursive: true, force: true });
});

let counter = 0;
const trashed: string[] = [];

async function freshWorkspace(files: Record<string, string> = {}): Promise<WorkspaceService> {
  const root = path.join(tempRoot, `ws-${++counter}`);
  mkdirSync(root);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const opened = await WorkspaceService.open(root, {
    trash: async (abs) => {
      trashed.push(abs);
      rmSync(abs, { recursive: true, force: true });
    }
  });
  assert.ok(opened.ok);
  return opened.value;
}

function code<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): string {
  return result.ok ? "OK" : result.error.code;
}

/* ---------- opening ---------- */

test("opens a folder and rejects missing folders, files and relative paths", async () => {
  const ws = await freshWorkspace({ "a.txt": "x" });
  assert.equal(ws.info().name, path.basename(ws.root));
  assert.equal(code(await WorkspaceService.open(path.join(tempRoot, "missing"), { trash: async () => {} })), "NOT_FOUND");
  assert.equal(code(await WorkspaceService.open(path.join(ws.root, "a.txt"), { trash: async () => {} })), "NOT_A_DIRECTORY");
  assert.equal(code(await WorkspaceService.open("relative/path", { trash: async () => {} })), "INVALID_PATH");
});

test("reports project status, safe scripts and git branch", async () => {
  const files: Record<string, string> = {};
  for (const file of getStarterFiles("demo")) files[file.path] = file.contents;
  files[".git/HEAD"] = "ref: refs/heads/feature/x\n";
  const ws = await freshWorkspace(files);
  const info = ws.info();
  assert.deepEqual(info.project, { state: "valid", name: "demo" });
  assert.equal(info.branch, "feature/x");
  assert.deepEqual(info.scripts, ["build", "start", "typecheck"]);

  const plain = await freshWorkspace({ "package.json": JSON.stringify({ name: "x", scripts: { ok: "a", "rm -rf; x": "b", "a&b": "c" } }) });
  assert.deepEqual(plain.info().project, { state: "none" });
  assert.deepEqual(plain.info().scripts, ["ok"], "names with shell metacharacters are never offered");
  assert.equal(readGitBranch(plain.root), null);
  assert.deepEqual(readSafeScriptNames(path.join(tempRoot, "nope")), []);
  assert.deepEqual(inspectProject(path.join(tempRoot, "nope")), { state: "none" });
});

/* ---------- enumeration ---------- */

test("lists folders first, sorted, and hides .git", async () => {
  const ws = await freshWorkspace({ "b.txt": "", "A.txt": "", "src/index.ts": "", "lib/x.ts": "", ".git/HEAD": "" });
  const listed = await ws.list("");
  assert.ok(listed.ok);
  assert.deepEqual(
    listed.value.map((e) => `${e.kind}:${e.path}`),
    ["directory:lib", "directory:src", "file:A.txt", "file:b.txt"]
  );
  const nested = await ws.list("src");
  assert.ok(nested.ok);
  assert.deepEqual(nested.value, [{ name: "index.ts", path: "src/index.ts", kind: "file" }]);
  assert.equal(code(await ws.list("b.txt")), "NOT_A_DIRECTORY");
  assert.equal(code(await ws.list("missing")), "NOT_FOUND");
});

/* ---------- path safety ---------- */

test("rejects path traversal, absolute paths and malformed paths", async () => {
  const ws = await freshWorkspace({ "a.txt": "x" });
  writeFileSync(path.join(tempRoot, "secret.txt"), "secret");
  const attempts = [
    "../secret.txt",
    "src/../../secret.txt",
    "..",
    "C:/Windows/win.ini",
    "C:\\Windows\\win.ini",
    "/etc/passwd",
    "\\\\server\\share\\x",
    "a\\..\\..\\secret.txt",
    "./a.txt",
    "a//b",
    "a.txt:stream",
    "a\u0000.txt"
  ];
  for (const attempt of attempts) {
    const result = await ws.readFile(attempt);
    assert.ok(!result.ok, attempt);
    assert.ok(["OUTSIDE_WORKSPACE", "INVALID_PATH"].includes(result.error.code), `${attempt}: ${result.error.code}`);
  }
  assert.equal(code(await ws.writeFile("../escape.txt", "x", { expectedVersion: null })), "OUTSIDE_WORKSPACE");
  assert.equal(code(await ws.createFile("..", "x.txt")), "OUTSIDE_WORKSPACE");
  assert.equal(code(await ws.rename("a.txt", "../b.txt")), "INVALID_NAME");
  assert.equal(code(await ws.delete("../secret.txt", true)), "OUTSIDE_WORKSPACE");
  assert.ok(!existsSync(path.join(tempRoot, "escape.txt")));
  assert.equal(readFileSync(path.join(tempRoot, "secret.txt"), "utf8"), "secret");

  assert.deepEqual(parseRelativePath("src/a.ts"), { ok: true, value: ["src", "a.ts"] });
  assert.deepEqual(parseRelativePath(""), { ok: true, value: [] });
  assert.equal(code(parseRelativePath(42)), "INVALID_PATH");
});

test("symbolic links pointing outside the workspace are not followed", async (t) => {
  const ws = await freshWorkspace({ "inside.txt": "in" });
  const outsideDir = path.join(tempRoot, `outside-${counter}`);
  mkdirSync(outsideDir);
  writeFileSync(path.join(outsideDir, "data.txt"), "outside");
  try {
    // Junctions need no special privileges on Windows.
    symlinkSync(outsideDir, path.join(ws.root, "link-out"), "junction");
    symlinkSync(path.join(ws.root, "inside.txt"), path.join(ws.root, "link-in.txt"), "file");
  } catch (error) {
    t.skip(`cannot create links here: ${String(error)}`);
    return;
  }
  const listed = await ws.list("");
  assert.ok(listed.ok);
  const kinds = Object.fromEntries(listed.value.map((e) => [e.name, e.kind]));
  assert.equal(kinds["link-out"], "symlink", "outside link is not shown as a folder");
  assert.equal(kinds["link-in.txt"], "file", "inside link behaves like its target");

  assert.equal(code(await ws.list("link-out")), "OUTSIDE_WORKSPACE");
  assert.equal(code(await ws.readFile("link-out/data.txt")), "OUTSIDE_WORKSPACE");
  assert.equal(code(await ws.writeFile("link-out/data.txt", "pwned", { expectedVersion: null, overwrite: true })), "OUTSIDE_WORKSPACE");
  assert.equal(code(await ws.createFile("link-out", "new.txt")), "OUTSIDE_WORKSPACE");
  assert.equal(readFileSync(path.join(outsideDir, "data.txt"), "utf8"), "outside");
  assert.ok(!existsSync(path.join(outsideDir, "new.txt")));

  const viaLink = await ws.readFile("link-in.txt");
  assert.ok(viaLink.ok && viaLink.value.kind === "text" && viaLink.value.content === "in");
});

/* ---------- reading ---------- */

test("reads text with a version, and refuses binary and oversized files", async () => {
  const ws = await freshWorkspace({ "a.ts": "const a = 1;\r\n", "bom.txt": "\uFEFFhello" });
  writeFileSync(path.join(ws.root, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  writeFileSync(path.join(ws.root, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));

  const text = await ws.readFile("a.ts");
  assert.ok(text.ok && text.value.kind === "text");
  assert.equal(text.value.content, "const a = 1;\r\n", "line endings are preserved");
  assert.equal(text.value.version, fileVersion(readFileSync(path.join(ws.root, "a.ts"))));

  const bom = await ws.readFile("bom.txt");
  assert.ok(bom.ok && bom.value.kind === "text" && bom.value.hasBom && bom.value.content === "hello");

  const binary = await ws.readFile("image.png");
  assert.ok(binary.ok && binary.value.kind === "binary");
  const latin1 = await ws.readFile("latin1.txt");
  assert.ok(latin1.ok && latin1.value.kind === "binary", "non-UTF-8 text is not opened");

  const small = await WorkspaceService.open(ws.root, { trash: async () => {}, maxTextFileSize: 4 });
  assert.ok(small.ok);
  const large = await small.value.readFile("a.ts");
  assert.ok(large.ok && large.value.kind === "too-large");

  assert.equal(code(await ws.readFile("missing.txt")), "NOT_FOUND");
  assert.equal(code(await ws.readFile("")), "NOT_A_FILE");
});

/* ---------- writing ---------- */

test("saves with the expected version and returns the new version", async () => {
  const ws = await freshWorkspace({ "a.txt": "one" });
  const read = await ws.readFile("a.txt");
  assert.ok(read.ok && read.value.kind === "text");
  const saved = await ws.writeFile("a.txt", "two", { expectedVersion: read.value.version });
  assert.ok(saved.ok);
  assert.equal(readFileSync(path.join(ws.root, "a.txt"), "utf8"), "two");
  assert.equal(saved.value.version, fileVersion(Buffer.from("two")));
  assert.deepEqual(
    readdirSync(ws.root).filter((name) => name.endsWith(".origin-tmp")),
    [],
    "no temporary files are left behind"
  );

  const again = await ws.writeFile("a.txt", "three", { expectedVersion: saved.value.version });
  assert.ok(again.ok);
});

test("preserves a UTF-8 byte order mark when asked", async () => {
  const ws = await freshWorkspace({ "bom.txt": "\uFEFFhello" });
  const read = await ws.readFile("bom.txt");
  assert.ok(read.ok && read.value.kind === "text");
  await ws.writeFile("bom.txt", "bye", { expectedVersion: read.value.version, bom: true });
  assert.deepEqual([...readFileSync(path.join(ws.root, "bom.txt")).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("detects external changes and deletions instead of overwriting", async () => {
  const ws = await freshWorkspace({ "a.txt": "original" });
  const read = await ws.readFile("a.txt");
  assert.ok(read.ok && read.value.kind === "text");

  writeFileSync(path.join(ws.root, "a.txt"), "changed elsewhere");
  const conflict = await ws.writeFile("a.txt", "mine", { expectedVersion: read.value.version });
  assert.equal(code(conflict), "CONFLICT");
  assert.equal(readFileSync(path.join(ws.root, "a.txt"), "utf8"), "changed elsewhere");

  const forced = await ws.writeFile("a.txt", "mine", { expectedVersion: read.value.version, overwrite: true });
  assert.ok(forced.ok, "explicit overwrite after user confirmation");
  assert.equal(readFileSync(path.join(ws.root, "a.txt"), "utf8"), "mine");

  rmSync(path.join(ws.root, "a.txt"));
  assert.equal(code(await ws.writeFile("a.txt", "x", { expectedVersion: forced.value.version })), "CONFLICT");

  assert.equal(code(await ws.writeFile("b.txt", "new", { expectedVersion: null })), "OK");
  assert.equal(code(await ws.writeFile("b.txt", "newer", { expectedVersion: null })), "CONFLICT", "never clobbers an existing file");
  assert.equal(code(await ws.writeFile("", "x", { expectedVersion: null })), "INVALID_PATH");
  assert.equal(code(await ws.writeFile("a.txt", 5 as unknown as string, { expectedVersion: null })), "INVALID_ARGUMENT");
});

test("reports permission errors for read-only files", async () => {
  const ws = await freshWorkspace({ "locked.txt": "keep" });
  const read = await ws.readFile("locked.txt");
  assert.ok(read.ok && read.value.kind === "text");
  chmodSync(path.join(ws.root, "locked.txt"), 0o444);
  const result = await ws.writeFile("locked.txt", "changed", { expectedVersion: read.value.version });
  assert.equal(code(result), "PERMISSION_DENIED");
  if (!result.ok) assert.match(result.error.message, /Permission denied/);
  assert.equal(readFileSync(path.join(ws.root, "locked.txt"), "utf8"), "keep");
  assert.deepEqual(readdirSync(ws.root).filter((n) => n.endsWith(".origin-tmp")), []);
});

/* ---------- create, rename, delete ---------- */

test("creates files and folders without overwriting, and validates names", async () => {
  const ws = await freshWorkspace({ "src/existing.ts": "keep" });
  const file = await ws.createFile("src", "new.ts");
  assert.deepEqual(file, { ok: true, value: { name: "new.ts", path: "src/new.ts", kind: "file" } });
  assert.equal(readFileSync(path.join(ws.root, "src", "new.ts"), "utf8"), "");

  assert.equal(code(await ws.createFile("src", "existing.ts")), "ALREADY_EXISTS");
  assert.equal(readFileSync(path.join(ws.root, "src", "existing.ts"), "utf8"), "keep");

  const folder = await ws.createFolder("", "lib");
  assert.ok(folder.ok && folder.value.kind === "directory");
  assert.equal(code(await ws.createFolder("", "lib")), "ALREADY_EXISTS");

  for (const bad of ["", "a/b", "a\\b", "con", "nul.txt", "x?.ts", "trailing.", ".."]) {
    assert.equal(code(await ws.createFile("", bad)), "INVALID_NAME", bad);
  }
  assert.equal(code(await ws.createFile("missing-folder", "a.ts")), "NOT_FOUND");
});

test("renames entries, refuses to overwrite, and allows case-only renames", async () => {
  const ws = await freshWorkspace({ "a.ts": "A", "b.ts": "B", "dir/x.ts": "X" });
  const renamed = await ws.rename("a.ts", "c.ts");
  assert.deepEqual(renamed, { ok: true, value: { name: "c.ts", path: "c.ts", kind: "file" } });
  assert.ok(!existsSync(path.join(ws.root, "a.ts")));

  assert.equal(code(await ws.rename("c.ts", "b.ts")), "ALREADY_EXISTS");
  assert.equal(readFileSync(path.join(ws.root, "b.ts"), "utf8"), "B", "target untouched");

  const dir = await ws.rename("dir", "folder");
  assert.ok(dir.ok && dir.value.kind === "directory");
  assert.equal(readFileSync(path.join(ws.root, "folder", "x.ts"), "utf8"), "X");

  const caseOnly = await ws.rename("b.ts", "B.ts");
  assert.ok(caseOnly.ok);
  assert.ok(readdirSync(ws.root).includes("B.ts"));

  assert.equal(code(await ws.rename("", "x")), "INVALID_PATH", "cannot rename the workspace itself");
  assert.equal(code(await ws.rename("missing.ts", "y.ts")), "NOT_FOUND");
});

test("delete requires explicit confirmation and uses the trash", async () => {
  const ws = await freshWorkspace({ "a.txt": "A", "dir/b.txt": "B" });
  for (const confirmed of [false, undefined, "yes", 1]) {
    assert.equal(code(await ws.delete("a.txt", confirmed)), "CONFIRMATION_REQUIRED");
  }
  assert.ok(existsSync(path.join(ws.root, "a.txt")));

  const before = trashed.length;
  assert.ok((await ws.delete("a.txt", true)).ok);
  assert.ok((await ws.delete("dir", true)).ok);
  assert.deepEqual(trashed.slice(before), [path.join(ws.root, "a.txt"), path.join(ws.root, "dir")]);
  assert.ok(!existsSync(path.join(ws.root, "dir")));

  assert.equal(code(await ws.delete("", true)), "INVALID_PATH", "cannot delete the workspace itself");
  assert.equal(code(await ws.delete("missing", true)), "NOT_FOUND");
});

test("save-as paths chosen in a dialog must be inside the workspace", async () => {
  const ws = await freshWorkspace({ "src/a.ts": "" });
  assert.deepEqual(await ws.relativePathFor(path.join(ws.root, "src", "copy.ts")), { ok: true, value: "src/copy.ts" });
  assert.equal(code(await ws.relativePathFor(path.join(tempRoot, "elsewhere.ts"))), "OUTSIDE_WORKSPACE");
  assert.equal(code(await ws.relativePathFor(path.join(ws.root, "missing-dir", "x.ts"))), "NOT_FOUND");
});
