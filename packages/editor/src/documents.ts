import type { FileVersion, RelativePath } from "@studio/contracts";
import { languageForPath } from "./language.js";

/**
 * Framework-independent state for open editor tabs. Text lives in the editor
 * component (Monaco models); this state tracks identity, disk version and
 * whether the text differs from what was last saved.
 *
 * `editVersion` is any counter that returns to the same value when an edit is
 * undone (Monaco's alternative version id), so undoing back to the saved text
 * clears the unsaved indicator.
 */
export interface EditorDocument {
  path: RelativePath;
  name: string;
  language: string;
  /** Version of the file on disk when last loaded or saved; null if never saved. */
  diskVersion: FileVersion | null;
  hasBom: boolean;
  savedEditVersion: number;
  editVersion: number;
}

export interface EditorState {
  documents: EditorDocument[];
  activePath: RelativePath | null;
}

export type EditorAction =
  | { type: "open"; path: RelativePath; diskVersion: FileVersion | null; hasBom: boolean; editVersion: number }
  | { type: "activate"; path: RelativePath }
  | { type: "edited"; path: RelativePath; editVersion: number }
  | { type: "saved"; path: RelativePath; diskVersion: FileVersion; /** Edit version that was written. */ editVersion: number }
  | { type: "saved-as"; fromPath: RelativePath; toPath: RelativePath; diskVersion: FileVersion; editVersion: number }
  | { type: "close"; path: RelativePath }
  | { type: "renamed"; from: RelativePath; to: RelativePath }
  | { type: "deleted"; path: RelativePath };

export const initialEditorState: EditorState = { documents: [], activePath: null };

export function isDirty(document: EditorDocument): boolean {
  return document.editVersion !== document.savedEditVersion;
}

export function dirtyDocuments(state: EditorState): EditorDocument[] {
  return state.documents.filter(isDirty);
}

export function findDocument(state: EditorState, path: RelativePath): EditorDocument | undefined {
  return state.documents.find((document) => document.path === path);
}

export function activeDocument(state: EditorState): EditorDocument | undefined {
  return state.activePath === null ? undefined : findDocument(state, state.activePath);
}

/** Closing a tab with unsaved changes must ask the user first. */
export function closeNeedsConfirmation(state: EditorState, path: RelativePath): boolean {
  const document = findDocument(state, path);
  return document !== undefined && isDirty(document);
}

/** True when `path` is `prefix` or inside the folder `prefix`. */
export function isSameOrInside(path: RelativePath, prefix: RelativePath): boolean {
  return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
}

function nameOf(path: RelativePath): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function withoutDocuments(state: EditorState, remove: (document: EditorDocument) => boolean): EditorState {
  const index = state.documents.findIndex((document) => document.path === state.activePath);
  const documents = state.documents.filter((document) => !remove(document));
  let activePath = state.activePath;
  if (activePath !== null && !documents.some((document) => document.path === activePath)) {
    // Activate the neighbour of the closed tab, as most editors do.
    const neighbour = documents[Math.min(Math.max(index, 0), documents.length - 1)];
    activePath = neighbour ? neighbour.path : null;
  }
  return { documents, activePath };
}

function updateDocument(
  state: EditorState,
  path: RelativePath,
  update: (document: EditorDocument) => EditorDocument
): EditorState {
  let changed = false;
  const documents = state.documents.map((document) => {
    if (document.path !== path) {
      return document;
    }
    changed = true;
    return update(document);
  });
  return changed ? { ...state, documents } : state;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "open": {
      if (findDocument(state, action.path)) {
        return { ...state, activePath: action.path };
      }
      const document: EditorDocument = {
        path: action.path,
        name: nameOf(action.path),
        language: languageForPath(action.path),
        diskVersion: action.diskVersion,
        hasBom: action.hasBom,
        savedEditVersion: action.editVersion,
        editVersion: action.editVersion
      };
      return { documents: [...state.documents, document], activePath: action.path };
    }

    case "activate":
      return findDocument(state, action.path) ? { ...state, activePath: action.path } : state;

    case "edited":
      return updateDocument(state, action.path, (document) => ({ ...document, editVersion: action.editVersion }));

    case "saved":
      return updateDocument(state, action.path, (document) => ({
        ...document,
        diskVersion: action.diskVersion,
        // Edits typed while the save was in flight stay unsaved.
        savedEditVersion: action.editVersion
      }));

    case "saved-as": {
      // The tab now refers to the new file; any other tab already showing it is replaced.
      const cleared = withoutDocuments(
        state,
        (document) => document.path === action.toPath && action.toPath !== action.fromPath
      );
      const documents = cleared.documents.map((document) =>
        document.path === action.fromPath
          ? {
              ...document,
              path: action.toPath,
              name: nameOf(action.toPath),
              language: languageForPath(action.toPath),
              diskVersion: action.diskVersion,
              savedEditVersion: action.editVersion
            }
          : document
      );
      return { documents, activePath: action.toPath };
    }

    case "close":
      return withoutDocuments(state, (document) => document.path === action.path);

    case "renamed": {
      const move = (path: RelativePath) =>
        isSameOrInside(path, action.from) ? action.to + path.slice(action.from.length) : path;
      return {
        documents: state.documents.map((document) => {
          if (!isSameOrInside(document.path, action.from)) {
            return document;
          }
          const path = move(document.path);
          return { ...document, path, name: nameOf(path), language: languageForPath(path) };
        }),
        activePath: state.activePath === null ? null : move(state.activePath)
      };
    }

    case "deleted":
      return withoutDocuments(state, (document) => isSameOrInside(document.path, action.path));
  }
}
