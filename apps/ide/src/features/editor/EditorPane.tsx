import { useEffect, useRef, type KeyboardEvent } from "react";
import type { RelativePath } from "@studio/contracts";
import { isDirty, type EditorDocument } from "@studio/editor";
import { monaco } from "./monaco";

interface EditorPaneProps {
  documents: EditorDocument[];
  activePath: RelativePath | null;
  model: monaco.editor.ITextModel | null;
  onActivate(path: RelativePath): void;
  onClose(path: RelativePath): void;
  onCursor(position: { line: number; column: number } | null): void;
  editorRef: { current: monaco.editor.IStandaloneCodeEditor | null };
  emptyHint: React.ReactNode;
}

export function EditorPane(props: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewStates = useRef(new Map<monaco.editor.ITextModel, monaco.editor.ICodeEditorViewState | null>());
  const { editorRef, model, onCursor } = props;

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current!, {
      model: null,
      theme: "origin-dark",
      automaticLayout: true,
      fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: 14,
      lineNumbers: "on",
      minimap: { enabled: true },
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
      tabSize: 2,
      ariaLabel: "Code editor"
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, [editorRef]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const previous = editor.getModel();
    if (previous === model) return;
    if (previous && !previous.isDisposed()) {
      viewStates.current.set(previous, editor.saveViewState());
    }
    editor.setModel(model);
    if (model) {
      const saved = viewStates.current.get(model);
      if (saved) editor.restoreViewState(saved);
      editor.focus();
    }
    // Forget view state of closed models.
    for (const key of [...viewStates.current.keys()]) {
      if (key.isDisposed()) viewStates.current.delete(key);
    }
  }, [editorRef, model]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const report = () => {
      const position = editor.getPosition();
      onCursor(position && editor.getModel() ? { line: position.lineNumber, column: position.column } : null);
    };
    report();
    const subscription = editor.onDidChangeCursorPosition(report);
    return () => subscription.dispose();
  }, [editorRef, model, onCursor]);

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = props.documents.findIndex((d) => d.path === props.activePath);
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : null;
    if (next !== null) {
      const target = props.documents[(next + props.documents.length) % props.documents.length];
      if (target) {
        props.onActivate(target.path);
        document.getElementById(`tab-${encodeURIComponent(target.path)}`)?.focus();
      }
      event.preventDefault();
    }
  }

  return (
    <section className="editor-area" aria-label="Editor">
      {props.documents.length > 0 ? (
        <div className="tabs" role="tablist" aria-label="Open files" onKeyDown={onTabKeyDown}>
          {props.documents.map((document) => {
            const active = document.path === props.activePath;
            const dirty = isDirty(document);
            return (
              <div
                key={document.path}
                id={`tab-${encodeURIComponent(document.path)}`}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={`tab${active ? " active" : ""}${dirty ? " dirty" : ""}`}
                title={document.path + (dirty ? " (unsaved changes)" : "")}
                data-path={document.path}
                onClick={() => props.onActivate(document.path)}
                onAuxClick={(event) => {
                  if (event.button === 1) props.onClose(document.path);
                }}
              >
                <span className="tab-label">{document.name}</span>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Close ${document.name}${dirty ? " (unsaved changes)" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onClose(document.path);
                  }}
                >
                  <span className={`codicon ${dirty ? "codicon-circle-filled" : "codicon-close"}`} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="editor-host">
        <div ref={containerRef} className="monaco-container" style={{ visibility: model ? "visible" : "hidden" }} />
        {model ? null : <div className="editor-empty">{props.emptyHint}</div>}
      </div>
    </section>
  );
}
