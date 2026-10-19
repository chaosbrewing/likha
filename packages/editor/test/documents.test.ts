import test from "node:test";
import assert from "node:assert/strict";
import {
  activeDocument,
  closeNeedsConfirmation,
  dirtyDocuments,
  editorReducer,
  initialEditorState,
  isDirty,
  languageForPath,
  languageLabel,
  type EditorAction,
  type EditorState
} from "../src/index.ts";

function apply(...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, initialEditorState);
}

const open = (path: string, editVersion = 1): EditorAction => ({ type: "open", path, diskVersion: `v-${path}`, hasBom: false, editVersion });

test("opening files creates tabs and activates the latest", () => {
  const state = apply(open("src/a.ts"), open("README.md"));
  assert.deepEqual(state.documents.map((d) => d.path), ["src/a.ts", "README.md"]);
  assert.equal(state.activePath, "README.md");
  assert.equal(activeDocument(state)?.language, "markdown");
  assert.equal(state.documents[0]?.name, "a.ts");
});

test("opening an already open file only activates it", () => {
  const state = apply(open("a.ts"), open("b.ts"), open("a.ts", 99));
  assert.equal(state.documents.length, 2);
  assert.equal(state.activePath, "a.ts");
  assert.equal(state.documents[0]?.editVersion, 1);
});

test("edits mark a document dirty; undoing back to the saved version clears it", () => {
  let state = apply(open("a.ts", 1), { type: "edited", path: "a.ts", editVersion: 2 });
  assert.equal(isDirty(state.documents[0]!), true);
  assert.deepEqual(dirtyDocuments(state).map((d) => d.path), ["a.ts"]);
  state = editorReducer(state, { type: "edited", path: "a.ts", editVersion: 1 });
  assert.equal(isDirty(state.documents[0]!), false);
});

test("saving records the disk version and clears the unsaved indicator", () => {
  const state = apply(
    open("a.ts", 1),
    { type: "edited", path: "a.ts", editVersion: 2 },
    { type: "saved", path: "a.ts", diskVersion: "v2", editVersion: 2 }
  );
  assert.equal(isDirty(state.documents[0]!), false);
  assert.equal(state.documents[0]?.diskVersion, "v2");
});

test("edits typed while a save is in flight stay unsaved", () => {
  const state = apply(
    open("a.ts", 1),
    { type: "edited", path: "a.ts", editVersion: 2 },
    { type: "edited", path: "a.ts", editVersion: 3 },
    { type: "saved", path: "a.ts", diskVersion: "v2", editVersion: 2 }
  );
  assert.equal(isDirty(state.documents[0]!), true);
});

test("closing a dirty tab needs confirmation; closing activates a neighbour", () => {
  let state = apply(open("a.ts"), open("b.ts"), open("c.ts"), { type: "activate", path: "b.ts" }, { type: "edited", path: "b.ts", editVersion: 5 });
  assert.equal(closeNeedsConfirmation(state, "b.ts"), true);
  assert.equal(closeNeedsConfirmation(state, "a.ts"), false);
  assert.equal(closeNeedsConfirmation(state, "missing.ts"), false);
  state = editorReducer(state, { type: "close", path: "b.ts" });
  assert.deepEqual(state.documents.map((d) => d.path), ["a.ts", "c.ts"]);
  assert.equal(state.activePath, "c.ts");
  state = apply(open("only.ts"), { type: "close", path: "only.ts" });
  assert.equal(state.activePath, null);
});

test("renaming a folder moves every open document inside it", () => {
  const state = apply(open("src/a.ts"), open("src/sub/b.ts"), open("srcx/c.ts"), { type: "renamed", from: "src", to: "lib" });
  assert.deepEqual(state.documents.map((d) => d.path), ["lib/a.ts", "lib/sub/b.ts", "srcx/c.ts"]);
  assert.equal(state.activePath, "srcx/c.ts");
});

test("renaming a file updates its name and language", () => {
  const state = apply(open("notes.txt"), { type: "renamed", from: "notes.txt", to: "notes.md" });
  assert.equal(state.documents[0]?.name, "notes.md");
  assert.equal(state.documents[0]?.language, "markdown");
  assert.equal(state.activePath, "notes.md");
});

test("deleting a folder closes the documents inside it", () => {
  const state = apply(open("src/a.ts"), open("src/b.ts"), open("README.md"), { type: "deleted", path: "src" });
  assert.deepEqual(state.documents.map((d) => d.path), ["README.md"]);
});

test("save as moves the tab to the new path and replaces a tab already showing it", () => {
  const state = apply(
    open("a.ts", 1),
    open("b.ts", 1),
    { type: "edited", path: "a.ts", editVersion: 2 },
    { type: "saved-as", fromPath: "a.ts", toPath: "b.ts", diskVersion: "vb", editVersion: 2 }
  );
  assert.deepEqual(state.documents.map((d) => d.path), ["b.ts"]);
  assert.equal(state.activePath, "b.ts");
  assert.equal(isDirty(state.documents[0]!), false);
});

test("maps file paths to editor languages", () => {
  const cases: Record<string, string> = {
    "a.ts": "typescript",
    "App.tsx": "typescript",
    "x.mjs": "javascript",
    "package.json": "json",
    "README.md": "markdown",
    "style.css": "css",
    "script.ps1": "powershell",
    Dockerfile: "dockerfile",
    ".gitignore": "plaintext",
    "LICENSE": "plaintext",
    "archive.unknownext": "plaintext"
  };
  for (const [file, language] of Object.entries(cases)) {
    assert.equal(languageForPath(`dir/${file}`), language, file);
  }
  assert.equal(languageLabel("typescript"), "TypeScript");
  assert.equal(languageLabel("plaintext"), "Plain Text");
});
