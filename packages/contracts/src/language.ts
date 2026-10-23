import type { RelativePath } from "./workspace.js";

/*
 * Project-wide language intelligence. The host runs a language server for
 * the open workspace; the interface asks it questions about files it has
 * open and receives problems for the whole project. Positions and ranges use
 * the Language Server Protocol convention: zero-based lines and UTF-16
 * character offsets.
 */

export type LanguageId = "typescript" | "javascript";

export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface TextEdit {
  range: TextRange;
  newText: string;
}

/** One edit the user made; `range` is relative to the document before this change. */
export interface TextChange {
  range: TextRange;
  text: string;
}

export interface FileLocation {
  path: RelativePath;
  range: TextRange;
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  range: TextRange;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  source?: string;
}

export interface FileProblem extends Diagnostic {
  path: RelativePath;
}

export interface HoverInfo {
  /** Markdown. */
  contents: string;
  range?: TextRange;
}

/** LSP CompletionItemKind, passed through so the interface can map icons. */
export type CompletionKind = number;

export interface CompletionEntry {
  /** Index into the server's response, used to resolve details later. */
  index: number;
  label: string;
  kind: CompletionKind;
  detail?: string;
  /** Markdown or plain text. */
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  /** 2 means the text is a snippet. */
  insertTextFormat?: 1 | 2;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
  commitCharacters?: string[];
  preselect?: boolean;
}

export interface CompletionResult {
  /** Identifies this response for resolveCompletion. */
  token: number;
  isIncomplete: boolean;
  items: CompletionEntry[];
}

export interface CompletionContext {
  /** 1 invoked, 2 trigger character, 3 re-trigger for incomplete results. */
  triggerKind: 1 | 2 | 3;
  triggerCharacter?: string;
}

export interface SignatureParameter {
  label: string | [number, number];
  documentation?: string;
}

export interface SignatureInfo {
  label: string;
  documentation?: string;
  parameters: SignatureParameter[];
}

export interface SignatureHelpInfo {
  signatures: SignatureInfo[];
  activeSignature: number;
  activeParameter: number;
}

export type LanguageServerStatus =
  | { state: "off"; detail: string }
  | { state: "starting" }
  | { state: "ready"; version: string }
  | { state: "unavailable"; detail: string }
  | { state: "stopped"; detail: string };

/** Problems for the whole project, sent whenever the host re-checked it. */
export interface ProjectProblemsEvent {
  problems: FileProblem[];
  /** Number of source files that were checked. */
  filesChecked: number;
  /** True when the project has more source files than the host checks. */
  truncated: boolean;
}

export const LANGUAGE_LIMITS = {
  /** Largest document the interface may sync to the server. */
  maxDocumentLength: 20 * 1024 * 1024,
  maxChangesPerEvent: 10_000,
  maxCompletionItems: 5000,
  /** Source files checked for project-wide problems. */
  maxProjectFiles: 2000
} as const;
