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
// Without a project-wide language server, imports of files and packages that
// are not open cannot be resolved; hide those errors instead of flagging every import.
const diagnosticsOptions = {
  noSemanticValidation: false,
  noSyntaxValidation: false,
  diagnosticCodesToIgnore: [2307, 2792, 7016, 2580, 2591]
};
for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  defaults.setCompilerOptions(compilerOptions);
  defaults.setDiagnosticsOptions(diagnosticsOptions);
  defaults.setEagerModelSync(true);
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
