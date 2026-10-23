import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pathToUri, toCompletionResult, toDiagnostics, toHover, toLocations, toMarkdown, toSignatureHelp, uriToPath } from "../electron/lsp-convert.ts";

const root = path.resolve(process.platform === "win32" ? "C:\\Users\\Dev\\My Project" : "/home/dev/my project");

test("paths and URIs round-trip and never leave the workspace", () => {
  const uri = pathToUri(root, "src/a b.ts");
  assert.equal(uri, pathToFileURL(path.join(root, "src", "a b.ts")).href);
  assert.equal(uriToPath(root, uri), "src/a b.ts");
  assert.equal(uriToPath(root, pathToFileURL(path.join(root, "..", "outside.ts")).href), null);
  assert.equal(uriToPath(root, pathToFileURL(root).href), null, "the root itself is not a file");
  assert.equal(uriToPath(root, "untitled:Untitled-1"), null);
  assert.equal(uriToPath(root, "not a uri"), null);
  if (process.platform === "win32") {
    const lower = pathToFileURL(path.join(root, "src", "Util.ts")).href.toLowerCase().replace("file:///c%3a", "file:///c%3A");
    assert.equal(uriToPath(root, lower, ["src/Util.ts"]), "src/Util.ts", "the spelling the interface uses wins");
    assert.equal(uriToPath(root, lower, []), "src/util.ts");
  }
});

test("diagnostics keep range, severity, code and source, and drop malformed entries", () => {
  const items = [
    { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, severity: 2, code: 6133, source: "ts", message: "unused" },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "no severity means error" },
    { range: { start: { line: 0 }, end: { line: 0, character: 1 } }, message: "bad range" },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 4, code: "X1", message: "hint" }
  ];
  assert.deepEqual(toDiagnostics(items), [
    { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, severity: "warning", message: "unused", code: "6133", source: "ts" },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: "error", message: "no severity means error" },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: "hint", message: "hint", code: "X1" }
  ]);
  assert.deepEqual(toDiagnostics(null), []);
});

test("hover and documentation content become markdown", () => {
  assert.equal(toMarkdown({ kind: "markdown", value: "**x**" }), "**x**");
  assert.equal(toMarkdown({ kind: "plaintext", value: "a *b*" }), "a \\*b\\*");
  assert.equal(toMarkdown({ language: "typescript", value: "let x" }), "```typescript\nlet x\n```");
  assert.equal(toMarkdown(["one", { language: "ts", value: "two" }]), "one\n\n```ts\ntwo\n```");
  assert.deepEqual(toHover({ contents: { kind: "markdown", value: "doc" }, range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } } }), {
    contents: "doc",
    range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }
  });
  assert.equal(toHover({ contents: "" }), null);
  assert.equal(toHover(null), null);
});

test("completion lists are converted, limited and keep the raw items for resolve", () => {
  const items = [
    { label: "greet", kind: 3, sortText: "11", textEdit: { newText: "greet", insert: { start: { line: 4, character: 0 }, end: { line: 4, character: 3 } }, replace: { start: { line: 4, character: 0 }, end: { line: 4, character: 9 } } }, data: { secret: "C:\\abs\\path" } },
    { label: "snippet", kind: 15, insertText: "for ($1)", insertTextFormat: 2, documentation: { kind: "markdown", value: "loop" }, commitCharacters: ["("], preselect: true },
    { label: "plain", kind: 6, textEdit: { newText: "plain", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } } }, additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "import x;\n" }] },
    { notALabel: true }
  ];
  const converted = toCompletionResult({ isIncomplete: false, items }, 7, 2);
  assert.ok(converted);
  assert.deepEqual(converted.result, {
    token: 7,
    isIncomplete: true,
    items: [
      { index: 0, label: "greet", kind: 3, sortText: "11", textEdit: { range: { start: { line: 4, character: 0 }, end: { line: 4, character: 3 } }, newText: "greet" } },
      { index: 1, label: "snippet", kind: 15, documentation: "loop", insertText: "for ($1)", insertTextFormat: 2, commitCharacters: ["("], preselect: true }
    ]
  });
  assert.equal(converted.rawItems.length, 2);
  assert.deepEqual(converted.rawItems[0], items[0], "raw items are kept for completionItem/resolve");
  assert.ok(!JSON.stringify(converted.result).includes("C:\\\\abs"), "server-internal data stays in the host");

  const asArray = toCompletionResult([items[2]], 8, 10);
  assert.ok(asArray);
  assert.deepEqual(asArray.result.items[0]?.additionalTextEdits, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "import x;\n" }]);
  assert.equal(asArray.result.isIncomplete, false);
  assert.equal(toCompletionResult(null, 9, 10), null);
});

test("locations inside the workspace are mapped; links and outside files are handled", () => {
  const inside = pathToFileURL(path.join(root, "src", "util.ts")).href;
  const outside = pathToFileURL(path.join(root, "..", "lib.d.ts")).href;
  const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 7 } };
  assert.deepEqual(toLocations([{ uri: inside, range }, { uri: outside, range }], root, []), [{ path: "src/util.ts", range }]);
  assert.deepEqual(toLocations({ uri: inside, range }, root, []), [{ path: "src/util.ts", range }]);
  assert.deepEqual(toLocations([{ targetUri: inside, targetRange: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } }, targetSelectionRange: range }], root, []), [{ path: "src/util.ts", range }]);
  assert.deepEqual(toLocations(null, root, []), []);
  assert.deepEqual(toLocations([{ uri: inside }], root, []), [], "a location without a range is dropped");
});

test("signature help keeps labels, offsets and documentation", () => {
  const help = toSignatureHelp({
    signatures: [
      { label: "greet(name: string): string", documentation: { kind: "plaintext", value: "Greets" }, parameters: [{ label: "name: string" }, { label: [6, 10], documentation: "offset" }] },
      { label: 5 }
    ],
    activeSignature: 0,
    activeParameter: 1
  });
  assert.deepEqual(help, {
    signatures: [{ label: "greet(name: string): string", documentation: "Greets", parameters: [{ label: "name: string" }, { label: [6, 10], documentation: "offset" }] }],
    activeSignature: 0,
    activeParameter: 1
  });
  assert.equal(toSignatureHelp({ signatures: [] }), null);
  assert.equal(toSignatureHelp(null), null);
});
