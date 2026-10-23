/*
 * Conversions between the host's language contracts (LSP-style, zero-based)
 * and Monaco's one-based editor types.
 */
import type { CompletionEntry, Diagnostic, SignatureHelpInfo, TextEdit, TextPosition, TextRange } from "@studio/contracts";
import { monaco } from "../editor/monaco";

export const MARKER_OWNER = "typescript-server";

export function toPosition(position: monaco.IPosition): TextPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

export function toMonacoRange(range: TextRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  };
}

export function toTextChange(change: monaco.editor.IModelContentChange): { range: TextRange; text: string } {
  return {
    range: {
      start: { line: change.range.startLineNumber - 1, character: change.range.startColumn - 1 },
      end: { line: change.range.endLineNumber - 1, character: change.range.endColumn - 1 }
    },
    text: change.text
  };
}

const SEVERITY: Record<Diagnostic["severity"], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint
};

export function toMarker(diagnostic: Diagnostic): monaco.editor.IMarkerData {
  const range = toMonacoRange(diagnostic.range);
  const marker: monaco.editor.IMarkerData = {
    ...range,
    severity: SEVERITY[diagnostic.severity],
    message: diagnostic.message
  };
  if (diagnostic.code !== undefined) marker.code = diagnostic.code;
  if (diagnostic.source !== undefined) marker.source = diagnostic.source;
  return marker;
}

/** LSP CompletionItemKind (1..25) to Monaco's CompletionItemKind. */
const COMPLETION_KINDS: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter
};

function toMonacoTextEdit(edit: TextEdit): monaco.languages.TextEdit {
  return { range: toMonacoRange(edit.range), text: edit.newText };
}

/** Extra data carried on Monaco items so the host can resolve details later. */
export interface CompletionItemData {
  token: number;
  index: number;
}

export type ServerCompletionItem = monaco.languages.CompletionItem & { data: CompletionItemData };

export function toCompletionItem(entry: CompletionEntry, token: number, defaultRange: monaco.IRange): ServerCompletionItem {
  const item: ServerCompletionItem = {
    label: entry.label,
    kind: COMPLETION_KINDS[entry.kind] ?? monaco.languages.CompletionItemKind.Text,
    insertText: entry.textEdit?.newText ?? entry.insertText ?? entry.label,
    range: entry.textEdit ? toMonacoRange(entry.textEdit.range) : defaultRange,
    data: { token, index: entry.index }
  };
  if (entry.insertTextFormat === 2) item.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  applyCompletionDetails(item, entry);
  if (entry.sortText !== undefined) item.sortText = entry.sortText;
  if (entry.filterText !== undefined) item.filterText = entry.filterText;
  if (entry.commitCharacters !== undefined) item.commitCharacters = entry.commitCharacters;
  if (entry.preselect) item.preselect = true;
  return item;
}

/** Copies the fields completionItem/resolve may add onto an existing item. */
export function applyCompletionDetails(item: monaco.languages.CompletionItem, entry: CompletionEntry): void {
  if (entry.detail !== undefined) item.detail = entry.detail;
  if (entry.documentation !== undefined) item.documentation = { value: entry.documentation };
  if (entry.additionalTextEdits !== undefined) item.additionalTextEdits = entry.additionalTextEdits.map(toMonacoTextEdit);
}

export function toSignatureHelp(info: SignatureHelpInfo): monaco.languages.SignatureHelp {
  return {
    signatures: info.signatures.map((signature) => ({
      label: signature.label,
      documentation: signature.documentation !== undefined ? { value: signature.documentation } : undefined,
      parameters: signature.parameters.map((parameter) => ({
        label: parameter.label,
        documentation: parameter.documentation !== undefined ? { value: parameter.documentation } : undefined
      }))
    })),
    activeSignature: info.activeSignature,
    activeParameter: info.activeParameter
  };
}
