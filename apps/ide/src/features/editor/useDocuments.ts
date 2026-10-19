import { useCallback, useReducer, useRef } from "react";
import type { RelativePath, StudioHostApi } from "@studio/contracts";
import {
  closeNeedsConfirmation,
  dirtyDocuments,
  editorReducer,
  findDocument,
  initialEditorState,
  isDirty,
  isSameOrInside,
  languageForPath,
  type EditorState
} from "@studio/editor";
import type { Dialogs } from "../dialogs/useDialogs";
import { monaco } from "./monaco";

interface ModelEntry {
  model: monaco.editor.ITextModel;
  /** Mutable so the change listener follows the document through renames. */
  holder: { path: RelativePath };
  listener: monaco.IDisposable;
}

export interface Documents {
  state: EditorState;
  models: ReadonlyMap<RelativePath, ModelEntry>;
  modelFor(path: RelativePath): monaco.editor.ITextModel | null;
  pathForUri(uri: monaco.Uri): RelativePath | null;
  openFile(path: RelativePath): Promise<boolean>;
  activate(path: RelativePath): void;
  save(path: RelativePath): Promise<boolean>;
  saveAs(path: RelativePath): Promise<RelativePath | null>;
  saveAll(): Promise<boolean>;
  requestClose(path: RelativePath): Promise<boolean>;
  /** Resolves unsaved changes (save, discard or cancel). True when it is safe to continue. */
  resolveUnsaved(action: string): Promise<boolean>;
  closeAll(): void;
  renamed(from: RelativePath, to: RelativePath): void;
  deleted(path: RelativePath): void;
}

interface Deps {
  host: StudioHostApi;
  dialogs: Dialogs;
  log(level: "info" | "error", message: string): void;
}

let modelCounter = 0;

/**
 * Owns open documents: Monaco text models plus the shared editor state that
 * tracks disk versions and unsaved changes.
 */
export function useDocuments({ host, dialogs, log }: Deps): Documents {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const models = useRef(new Map<RelativePath, ModelEntry>()).current;

  const disposeModel = useCallback(
    (path: RelativePath) => {
      const entry = models.get(path);
      if (entry) {
        entry.listener.dispose();
        entry.model.dispose();
        models.delete(path);
      }
    },
    [models]
  );

  const createModel = useCallback(
    (path: RelativePath, content: string): ModelEntry => {
      disposeModel(path);
      const name = path.slice(path.lastIndexOf("/") + 1);
      // Model URIs are stable for the life of the tab (paths can change on rename).
      const uri = monaco.Uri.from({ scheme: "file", path: `/model-${++modelCounter}/${name}` });
      const model = monaco.editor.createModel(content, languageForPath(path), uri);
      const holder = { path };
      const listener = model.onDidChangeContent(() =>
        dispatch({ type: "edited", path: holder.path, editVersion: model.getAlternativeVersionId() })
      );
      const entry = { model, holder, listener };
      models.set(path, entry);
      return entry;
    },
    [disposeModel, models]
  );

  const openFile = useCallback(
    async (path: RelativePath): Promise<boolean> => {
      if (findDocument(stateRef.current, path)) {
        dispatch({ type: "activate", path });
        return true;
      }
      const result = await host.workspace.readFile(path);
      if (!result.ok) {
        log("error", result.error.message);
        await dialogs.notify("Could not open file", result.error.message);
        return false;
      }
      const file = result.value;
      if (file.kind === "binary") {
        await dialogs.notify(
          "File not opened",
          `"${path}" is a binary file or is not UTF-8 text.`,
          "Origin Studio edits UTF-8 text files. The file was not opened, so it cannot be changed by accident."
        );
        return false;
      }
      if (file.kind === "too-large") {
        await dialogs.notify(
          "File not opened",
          `"${path}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, larger than the ${(file.limit / 1024 / 1024).toFixed(0)} MB editing limit.`
        );
        return false;
      }
      const entry = createModel(path, file.content);
      dispatch({ type: "open", path, diskVersion: file.version, hasBom: file.hasBom, editVersion: entry.model.getAlternativeVersionId() });
      return true;
    },
    [createModel, dialogs, host, log]
  );

  const reloadFromDisk = useCallback(
    async (path: RelativePath): Promise<boolean> => {
      const entry = models.get(path);
      const result = await host.workspace.readFile(path);
      if (!entry || !result.ok || result.value.kind !== "text") {
        await dialogs.notify("Could not reload", result.ok ? `"${path}" can no longer be opened as text.` : result.error.message);
        return false;
      }
      entry.model.setValue(result.value.content);
      dispatch({ type: "saved", path, diskVersion: result.value.version, editVersion: entry.model.getAlternativeVersionId() });
      log("info", `Reloaded ${path} from disk`);
      return true;
    },
    [dialogs, host, log, models]
  );

  const save = useCallback(
    async (path: RelativePath): Promise<boolean> => {
      const document = findDocument(stateRef.current, path);
      const entry = models.get(path);
      if (!document || !entry) {
        return false;
      }
      const editVersion = entry.model.getAlternativeVersionId();
      const content = entry.model.getValue();
      const write = (overwrite: boolean) =>
        host.workspace.writeFile(path, content, { expectedVersion: document.diskVersion, bom: document.hasBom, overwrite });

      let result = await write(false);
      if (!result.ok && result.error.code === "CONFLICT") {
        const choice = await dialogs.choose({
          title: "File changed on disk",
          message: result.error.message,
          detail: "Overwrite replaces the file on disk with your version. Reload discards your unsaved changes and loads the version on disk.",
          buttons: [
            { id: "overwrite", label: "Overwrite", variant: "danger" },
            { id: "reload", label: "Reload from Disk" },
            { id: "cancel", label: "Cancel", variant: "primary" }
          ],
          cancelId: "cancel"
        });
        if (choice === "overwrite") {
          result = await write(true);
        } else {
          if (choice === "reload") {
            await reloadFromDisk(path);
          }
          return false;
        }
      }
      if (!result.ok) {
        log("error", `Could not save ${path}: ${result.error.message}`);
        await dialogs.notify("Could not save", result.error.message);
        return false;
      }
      dispatch({ type: "saved", path: entry.holder.path, diskVersion: result.value.version, editVersion });
      log("info", `Saved ${path}`);
      return true;
    },
    [dialogs, host, log, models, reloadFromDisk]
  );

  const saveAs = useCallback(
    async (path: RelativePath): Promise<RelativePath | null> => {
      const document = findDocument(stateRef.current, path);
      const entry = models.get(path);
      if (!document || !entry) {
        return null;
      }
      const editVersion = entry.model.getAlternativeVersionId();
      const result = await host.workspace.saveAsDialog(path, entry.model.getValue(), document.hasBom);
      if (!result.ok) {
        log("error", `Save As failed: ${result.error.message}`);
        await dialogs.notify("Could not save", result.error.message);
        return null;
      }
      if (result.value === null) {
        return null;
      }
      const target = result.value.path;
      if (target !== path) {
        disposeModel(target);
        models.delete(path);
        entry.holder.path = target;
        models.set(target, entry);
        monaco.editor.setModelLanguage(entry.model, languageForPath(target));
      }
      dispatch({ type: "saved-as", fromPath: path, toPath: target, diskVersion: result.value.version, editVersion });
      log("info", `Saved ${path} as ${target}`);
      return target;
    },
    [dialogs, disposeModel, host, log, models]
  );

  const saveAll = useCallback(async (): Promise<boolean> => {
    for (const document of dirtyDocuments(stateRef.current)) {
      if (!(await save(document.path))) {
        return false;
      }
    }
    return true;
  }, [save]);

  const close = useCallback(
    (path: RelativePath) => {
      disposeModel(path);
      dispatch({ type: "close", path });
    },
    [disposeModel]
  );

  const requestClose = useCallback(
    async (path: RelativePath): Promise<boolean> => {
      if (closeNeedsConfirmation(stateRef.current, path)) {
        dispatch({ type: "activate", path });
        const choice = await dialogs.choose({
          title: "Unsaved changes",
          message: `Do you want to save the changes you made to "${path}"?`,
          detail: "Your changes will be lost if you don't save them.",
          buttons: [
            { id: "save", label: "Save", variant: "primary" },
            { id: "discard", label: "Don't Save" },
            { id: "cancel", label: "Cancel" }
          ],
          cancelId: "cancel"
        });
        if (choice === "cancel" || (choice === "save" && !(await save(path)))) {
          return false;
        }
      }
      close(path);
      return true;
    },
    [close, dialogs, save]
  );

  const resolveUnsaved = useCallback(
    async (action: string): Promise<boolean> => {
      const dirty = dirtyDocuments(stateRef.current);
      if (dirty.length === 0) {
        return true;
      }
      const names = dirty.map((d) => d.path).join(", ");
      const choice = await dialogs.choose({
        title: "Unsaved changes",
        message: `${dirty.length === 1 ? "1 file has" : `${dirty.length} files have`} unsaved changes: ${names}.`,
        detail: `Save them before you ${action}?`,
        buttons: [
          { id: "save", label: "Save All", variant: "primary" },
          { id: "discard", label: "Don't Save" },
          { id: "cancel", label: "Cancel" }
        ],
        cancelId: "cancel"
      });
      if (choice === "cancel") {
        return false;
      }
      return choice === "discard" || (await saveAll());
    },
    [dialogs, saveAll]
  );

  const closeAll = useCallback(() => {
    for (const document of stateRef.current.documents) {
      close(document.path);
    }
  }, [close]);

  const renamed = useCallback(
    (from: RelativePath, to: RelativePath) => {
      for (const [path, entry] of [...models]) {
        if (isSameOrInside(path, from)) {
          const next = to + path.slice(from.length);
          models.delete(path);
          entry.holder.path = next;
          models.set(next, entry);
          monaco.editor.setModelLanguage(entry.model, languageForPath(next));
        }
      }
      dispatch({ type: "renamed", from, to });
    },
    [models]
  );

  const deleted = useCallback(
    (path: RelativePath) => {
      for (const open of [...models.keys()]) {
        if (isSameOrInside(open, path)) {
          disposeModel(open);
        }
      }
      dispatch({ type: "deleted", path });
    },
    [disposeModel, models]
  );

  return {
    state,
    models,
    modelFor: (path) => models.get(path)?.model ?? null,
    pathForUri: (uri) => {
      for (const entry of models.values()) {
        if (entry.model.uri.toString() === uri.toString()) return entry.holder.path;
      }
      return null;
    },
    openFile,
    activate: (path) => dispatch({ type: "activate", path }),
    save,
    saveAs,
    saveAll,
    requestClose,
    resolveUnsaved,
    closeAll,
    renamed,
    deleted
  };
}

export { isDirty };
