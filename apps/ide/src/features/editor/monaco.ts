import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

// Workers are bundled with the app; Monaco never loads anything from a CDN.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case "typescript":
      case "javascript":
        return new TsWorker();
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      default:
        return new EditorWorker();
    }
  }
};

const ts = monaco.typescript;
const compilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  strict: true,
  skipLibCheck: true
};
// The built-in worker sees open files only, so imports of files and packages
// that are not open cannot be resolved; hide those errors instead of flagging every import.
const builtinDiagnostics = {
  noSemanticValidation: false,
  noSyntaxValidation: false,
  diagnosticCodesToIgnore: [2307, 2792, 7016, 2580, 2591]
};
const silentDiagnostics = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true };
const builtinFeatures: monaco.typescript.ModeConfiguration = {
  completionItems: true,
  hovers: true,
  documentSymbols: true,
  definitions: true,
  references: true,
  documentHighlights: true,
  rename: true,
  diagnostics: true,
  documentRangeFormattingEdits: true,
  signatureHelp: true,
  onTypeFormattingEdits: true,
  codeActions: true,
  inlayHints: true
};
// What stays with Monaco's worker while the project-wide server answers the rest.
const serverModeFeatures: monaco.typescript.ModeConfiguration = {
  ...builtinFeatures,
  completionItems: false,
  hovers: false,
  definitions: false,
  references: false,
  diagnostics: false,
  signatureHelp: false,
  codeActions: false,
  inlayHints: false
};

for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  defaults.setCompilerOptions(compilerOptions);
  defaults.setDiagnosticsOptions(builtinDiagnostics);
  defaults.setEagerModelSync(true);
}

/**
 * Switches Monaco's own TypeScript worker between full service (no language
 * server available: open files only) and a reduced role (the host's
 * project-wide server provides diagnostics, completion, hover, navigation).
 */
export function setBuiltinTypeScriptEnabled(enabled: boolean): void {
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setDiagnosticsOptions(enabled ? builtinDiagnostics : silentDiagnostics);
    defaults.setModeConfiguration(enabled ? builtinFeatures : serverModeFeatures);
  }
}

monaco.editor.defineTheme("origin-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1b1d23",
    "editorGutter.background": "#1b1d23"
  }
});

export { monaco };
