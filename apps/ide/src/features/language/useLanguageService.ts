import { useEffect, useRef, useState } from "react";
import type { LanguageId, LanguageServerStatus, ProjectProblemsEvent, RelativePath, StudioHostApi } from "@studio/contracts";
import { languageForPath } from "@studio/editor";
import { monaco, setBuiltinTypeScriptEnabled } from "../editor/monaco";
import type { Documents } from "../editor/useDocuments";
import { MARKER_OWNER, applyCompletionDetails, toCompletionItem, toMarker, toMonacoRange, toPosition, toSignatureHelp, toTextChange, type ServerCompletionItem } from "./convert";

/** URI scheme for files the server points at that are not open in a tab. */
const SHADOW_SCHEME = "origin-file";
const MAX_SHADOWS = 40;
const DIAGNOSTICS_DELAY_MS = 300;
const LANGUAGES: readonly LanguageId[] = ["typescript", "javascript"];

interface Tracked {
  model: monaco.editor.ITextModel;
  listener: monaco.IDisposable;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface LanguageService {
  status: LanguageServerStatus;
  /** Latest project-wide check from the host, or null when none has run. */
  projectProblems: ProjectProblemsEvent | null;
}

interface Deps {
  host: StudioHostApi;
  documents: Documents;
  /** Opens a file (in a tab) and reveals a range or position in it. */
  openLocation(path: RelativePath, target: monaco.IRange | monaco.IPosition | undefined): Promise<void>;
}

function shadowUri(path: RelativePath): monaco.Uri {
  return monaco.Uri.from({ scheme: SHADOW_SCHEME, path: `/${path}` });
}

function shadowPath(uri: monaco.Uri): RelativePath | null {
  return uri.scheme === SHADOW_SCHEME ? uri.path.replace(/^\//, "") : null;
}

function languageIdOf(model: monaco.editor.ITextModel): LanguageId | null {
  const id = model.getLanguageId();
  return (LANGUAGES as readonly string[]).includes(id) ? (id as LanguageId) : null;
}

/**
 * Connects Monaco to the host's project-wide language server: keeps the
 * server informed of open documents, shows its diagnostics as markers, and
 * registers completion, hover, navigation and signature-help providers.
 * While no server is ready, Monaco's own worker (open files only) is used.
 */
export function useLanguageService({ host, documents, openLocation }: Deps): LanguageService {
  const [status, setStatus] = useState<LanguageServerStatus>({ state: "off", detail: "Not started." });
  const [projectProblems, setProjectProblems] = useState<ProjectProblemsEvent | null>(null);
  const ready = status.state === "ready";
  const tracked = useRef(new Map<RelativePath, Tracked>()).current;
  const shadows = useRef(new Map<RelativePath, monaco.editor.ITextModel>()).current;
  const openLocationRef = useRef(openLocation);
  openLocationRef.current = openLocation;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  useEffect(() => {
    let active = true;
    void host.language.status().then((result) => {
      if (active && result.ok) setStatus(result.value);
    });
    const unsubscribe = host.language.onStatus(setStatus);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [host]);

  useEffect(() => host.language.onProblems(setProjectProblems), [host]);

  /* ---------- document sync ---------- */

  useEffect(() => {
    setBuiltinTypeScriptEnabled(!ready);
    if (ready) return;
    for (const entry of tracked.values()) {
      entry.listener.dispose();
      if (entry.timer) clearTimeout(entry.timer);
      if (!entry.model.isDisposed()) monaco.editor.setModelMarkers(entry.model, MARKER_OWNER, []);
    }
    tracked.clear();
    for (const model of shadows.values()) model.dispose();
    shadows.clear();
    setProjectProblems(null);
  }, [ready, shadows, tracked]);

  useEffect(() => {
    if (!ready) return;
    const pullDiagnostics = (path: RelativePath) => {
      const entry = tracked.get(path);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void host.language.diagnostics(path).then((result) => {
          const current = tracked.get(path);
          if (!result.ok || !current || current.model !== entry.model || entry.model.isDisposed()) return;
          monaco.editor.setModelMarkers(entry.model, MARKER_OWNER, result.value.map(toMarker));
        });
      }, DIAGNOSTICS_DELAY_MS);
    };
    const track = (path: RelativePath, model: monaco.editor.ITextModel, languageId: LanguageId) => {
      void host.language.open(path, languageId, model.getVersionId(), model.getValue());
      const listener = model.onDidChangeContent((event) => {
        void host.language.change(path, event.versionId, event.changes.map(toTextChange));
        pullDiagnostics(path);
      });
      tracked.set(path, { model, listener, timer: null });
      pullDiagnostics(path);
    };
    const untrack = (path: RelativePath) => {
      const entry = tracked.get(path);
      if (!entry) return;
      entry.listener.dispose();
      if (entry.timer) clearTimeout(entry.timer);
      if (!entry.model.isDisposed()) monaco.editor.setModelMarkers(entry.model, MARKER_OWNER, []);
      tracked.delete(path);
      void host.language.close(path);
    };

    const seen = new Set<RelativePath>();
    for (const [path, entry] of documents.models) {
      const languageId = languageIdOf(entry.model);
      if (!languageId) continue;
      seen.add(path);
      const existing = tracked.get(path);
      if (existing?.model === entry.model) continue;
      if (existing) untrack(path);
      track(path, entry.model, languageId);
    }
    for (const path of [...tracked.keys()]) {
      if (!seen.has(path)) untrack(path);
    }
  }, [ready, documents.models, documents.state.documents, host, tracked]);

  /* ---------- providers ---------- */

  useEffect(() => {
    if (!ready) return;
    const pathOf = (model: monaco.editor.ITextModel): RelativePath | null => documentsRef.current.pathForUri(model.uri) ?? shadowPath(model.uri);

    /** A model for a file that is not open in a tab, so navigation and peek previews can show it. */
    const ensureShadow = async (path: RelativePath): Promise<monaco.Uri | null> => {
      const open = documentsRef.current.modelFor(path);
      if (open) return open.uri;
      const result = await host.workspace.readFile(path);
      if (!result.ok || result.value.kind !== "text") return null;
      const existing = shadows.get(path);
      if (existing && !existing.isDisposed()) {
        if (existing.getValue() !== result.value.content) existing.setValue(result.value.content);
        shadows.delete(path);
        shadows.set(path, existing); // Most recently used last.
        return existing.uri;
      }
      const uri = shadowUri(path);
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(result.value.content, languageForPath(path), uri);
      shadows.set(path, model);
      while (shadows.size > MAX_SHADOWS) {
        const [oldestPath, oldest] = shadows.entries().next().value as [RelativePath, monaco.editor.ITextModel];
        shadows.delete(oldestPath);
        oldest.dispose();
      }
      return uri;
    };

    const toMonacoLocations = async (locations: { path: RelativePath; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[]) => {
      const result: monaco.languages.Location[] = [];
      for (const location of locations) {
        const uri = await ensureShadow(location.path);
        if (uri) result.push({ uri, range: toMonacoRange(location.range) });
      }
      return result;
    };

    const disposables: monaco.IDisposable[] = [
      monaco.languages.registerCompletionItemProvider([...LANGUAGES], {
        triggerCharacters: [".", '"', "'", "`", "/", "@", "<", "#"],
        async provideCompletionItems(model, position, context) {
          const path = pathOf(model);
          if (!path) return null;
          const result = await host.language.completion(path, toPosition(position), {
            triggerKind: (context.triggerKind + 1) as 1 | 2 | 3,
            ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {})
          });
          if (!result.ok || !result.value) return null;
          const word = model.getWordUntilPosition(position);
          const defaultRange: monaco.IRange = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn };
          const { token, items, isIncomplete } = result.value;
          return { suggestions: items.map((entry) => toCompletionItem(entry, token, defaultRange)), incomplete: isIncomplete };
        },
        async resolveCompletionItem(item) {
          const data = (item as ServerCompletionItem).data;
          if (!data) return item;
          const result = await host.language.resolveCompletion(data.token, data.index);
          if (result.ok && result.value) applyCompletionDetails(item, result.value);
          return item;
        }
      }),
      monaco.languages.registerHoverProvider([...LANGUAGES], {
        async provideHover(model, position) {
          const path = pathOf(model);
          if (!path) return null;
          const result = await host.language.hover(path, toPosition(position));
          if (!result.ok || !result.value) return null;
          return { contents: [{ value: result.value.contents }], ...(result.value.range ? { range: toMonacoRange(result.value.range) } : {}) };
        }
      }),
      monaco.languages.registerDefinitionProvider([...LANGUAGES], {
        async provideDefinition(model, position) {
          const path = pathOf(model);
          if (!path) return null;
          const result = await host.language.definition(path, toPosition(position));
          return result.ok ? toMonacoLocations(result.value) : null;
        }
      }),
      monaco.languages.registerReferenceProvider([...LANGUAGES], {
        async provideReferences(model, position) {
          const path = pathOf(model);
          if (!path) return null;
          const result = await host.language.references(path, toPosition(position));
          return result.ok ? toMonacoLocations(result.value) : null;
        }
      }),
      monaco.languages.registerSignatureHelpProvider([...LANGUAGES], {
        signatureHelpTriggerCharacters: ["(", ",", "<"],
        signatureHelpRetriggerCharacters: [")"],
        async provideSignatureHelp(model, position) {
          const path = pathOf(model);
          if (!path) return null;
          const result = await host.language.signatureHelp(path, toPosition(position));
          if (!result.ok || !result.value) return null;
          return { value: toSignatureHelp(result.value), dispose() {} };
        }
      }),
      monaco.editor.registerEditorOpener({
        openCodeEditor(_source, resource, selectionOrPosition) {
          const path = documentsRef.current.pathForUri(resource) ?? shadowPath(resource);
          if (!path) return false;
          void openLocationRef.current(path, selectionOrPosition);
          return true;
        }
      })
    ];
    return () => {
      for (const disposable of disposables) disposable.dispose();
    };
  }, [ready, host, shadows]);

  return { status, projectProblems };
}
