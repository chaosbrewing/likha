/*
 * Conversions between what the TypeScript language server speaks (LSP, with
 * file:// URIs) and the contracts the interface sees (workspace-relative
 * paths, plain data). Pure functions; no Electron.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  CompletionEntry,
  CompletionResult,
  Diagnostic,
  DiagnosticSeverity,
  FileLocation,
  HoverInfo,
  RelativePath,
  SignatureHelpInfo,
  TextEdit,
  TextRange
} from "@studio/contracts";
import { isInside, toRelative } from "@studio/workspace";

export function pathToUri(root: string, relativePath: RelativePath): string {
  return pathToFileURL(path.join(root, ...relativePath.split("/").filter(Boolean))).href;
}

/**
 * Maps a server URI back to a workspace-relative path, or null when it points
 * outside the workspace (the bundled lib.*.d.ts files, for example). Windows
 * paths compare case-insensitively; `known` restores the spelling of paths the
 * interface already uses, so the same file never appears under two names.
 */
export function uriToPath(root: string, uri: string, known: Iterable<RelativePath> = []): RelativePath | null {
  let absolute: string;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return null;
    absolute = fileURLToPath(parsed);
  } catch {
    return null;
  }
  if (!isInside(root, absolute)) return null;
  const relative = toRelative(root, absolute);
  if (relative === null || relative === "") return null;
  if (process.platform === "win32") {
    const lower = relative.toLowerCase();
    for (const candidate of known) {
      if (candidate.toLowerCase() === lower) return candidate;
    }
  }
  return relative;
}

interface LspPosition {
  line: number;
  character: number;
}
interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

function isPosition(value: unknown): value is LspPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isInteger((value as LspPosition).line) &&
    Number.isInteger((value as LspPosition).character)
  );
}

export function toRange(value: unknown): TextRange | null {
  const range = value as LspRange | null | undefined;
  if (!range || !isPosition(range.start) || !isPosition(range.end)) return null;
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character }
  };
}

function toTextEdit(value: unknown): TextEdit | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const edit = value as { range?: unknown; insert?: unknown; newText?: unknown };
  const range = toRange(edit.range ?? edit.insert);
  return range && typeof edit.newText === "string" ? { range, newText: edit.newText } : undefined;
}

const SEVERITIES: Record<number, DiagnosticSeverity> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

export function toDiagnostics(items: unknown): Diagnostic[] {
  if (!Array.isArray(items)) return [];
  const result: Diagnostic[] = [];
  for (const item of items as Record<string, unknown>[]) {
    const range = toRange(item.range);
    if (!range || typeof item.message !== "string") continue;
    const diagnostic: Diagnostic = {
      range,
      severity: SEVERITIES[item.severity as number] ?? "error",
      message: item.message
    };
    if (typeof item.code === "string" || typeof item.code === "number") diagnostic.code = String(item.code);
    if (typeof item.source === "string") diagnostic.source = item.source;
    result.push(diagnostic);
  }
  return result;
}

/** MarkupContent | MarkedString | MarkedString[] | string -> markdown. */
export function toMarkdown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toMarkdown).filter(Boolean).join("\n\n");
  if (typeof value === "object" && value !== null) {
    const content = value as { kind?: unknown; language?: unknown; value?: unknown };
    if (typeof content.value !== "string") return "";
    if (typeof content.language === "string") return `\`\`\`${content.language}\n${content.value}\n\`\`\``;
    if (content.kind === "plaintext") return escapeMarkdown(content.value);
    return content.value;
  }
  return "";
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+!<>-])/g, "\\$1");
}

export function toHover(value: unknown): HoverInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const hover = value as { contents?: unknown; range?: unknown };
  const contents = toMarkdown(hover.contents);
  if (!contents) return null;
  const info: HoverInfo = { contents };
  const range = toRange(hover.range);
  if (range) info.range = range;
  return info;
}

export function toCompletionEntry(item: unknown, index: number): CompletionEntry | null {
  if (typeof item !== "object" || item === null) return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.label !== "string") return null;
  const entry: CompletionEntry = { index, label: raw.label, kind: typeof raw.kind === "number" ? raw.kind : 1 };
  if (typeof raw.detail === "string") entry.detail = raw.detail;
  const documentation = toMarkdown(raw.documentation);
  if (documentation) entry.documentation = documentation;
  if (typeof raw.sortText === "string") entry.sortText = raw.sortText;
  if (typeof raw.filterText === "string") entry.filterText = raw.filterText;
  if (typeof raw.insertText === "string") entry.insertText = raw.insertText;
  if (raw.insertTextFormat === 2) entry.insertTextFormat = 2;
  const textEdit = toTextEdit(raw.textEdit);
  if (textEdit) entry.textEdit = textEdit;
  if (Array.isArray(raw.additionalTextEdits)) {
    const edits = raw.additionalTextEdits.map(toTextEdit).filter((edit): edit is TextEdit => edit !== undefined);
    if (edits.length > 0) entry.additionalTextEdits = edits;
  }
  if (Array.isArray(raw.commitCharacters) && raw.commitCharacters.every((c) => typeof c === "string")) {
    entry.commitCharacters = raw.commitCharacters as string[];
  }
  if (raw.preselect === true) entry.preselect = true;
  return entry;
}

/** The server's raw items are kept by the caller for completionItem/resolve. */
export function toCompletionResult(value: unknown, token: number, maxItems: number): { result: CompletionResult; rawItems: unknown[] } | null {
  if (value === null || value === undefined) return null;
  const rawItems: unknown[] = Array.isArray(value) ? value : Array.isArray((value as { items?: unknown }).items) ? ((value as { items: unknown[] }).items) : [];
  const isIncomplete = !Array.isArray(value) && (value as { isIncomplete?: unknown }).isIncomplete === true;
  const limited = rawItems.slice(0, maxItems);
  const items: CompletionEntry[] = [];
  limited.forEach((item, index) => {
    const entry = toCompletionEntry(item, index);
    if (entry) items.push(entry);
  });
  return { result: { token, isIncomplete: isIncomplete || rawItems.length > limited.length, items }, rawItems: limited };
}

/** Location | Location[] | LocationLink[] -> locations inside the workspace. */
export function toLocations(value: unknown, root: string, known: Iterable<RelativePath>): FileLocation[] {
  const list = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
  const result: FileLocation[] = [];
  const knownPaths = [...known];
  for (const item of list as Record<string, unknown>[]) {
    if (typeof item !== "object" || item === null) continue;
    const uri = typeof item.uri === "string" ? item.uri : typeof item.targetUri === "string" ? item.targetUri : null;
    const range = toRange(item.range ?? item.targetSelectionRange ?? item.targetRange);
    if (!uri || !range) continue;
    const relative = uriToPath(root, uri, knownPaths);
    if (relative === null) continue;
    result.push({ path: relative, range });
  }
  return result;
}

export function toSignatureHelp(value: unknown): SignatureHelpInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const help = value as { signatures?: unknown; activeSignature?: unknown; activeParameter?: unknown };
  if (!Array.isArray(help.signatures)) return null;
  const signatures = help.signatures
    .map((signature: Record<string, unknown>) => {
      if (typeof signature?.label !== "string") return null;
      const parameters = Array.isArray(signature.parameters)
        ? signature.parameters.map((parameter: Record<string, unknown>) => {
            const label = parameter?.label;
            const info: SignatureHelpInfo["signatures"][number]["parameters"][number] = {
              label:
                Array.isArray(label) && label.length === 2 && label.every((n) => Number.isInteger(n))
                  ? [label[0] as number, label[1] as number]
                  : typeof label === "string"
                    ? label
                    : ""
            };
            const documentation = toMarkdown(parameter?.documentation);
            if (documentation) info.documentation = documentation;
            return info;
          })
        : [];
      const result: SignatureHelpInfo["signatures"][number] = { label: signature.label, parameters };
      const documentation = toMarkdown(signature.documentation);
      if (documentation) result.documentation = documentation;
      return result;
    })
    .filter((s): s is SignatureHelpInfo["signatures"][number] => s !== null);
  if (signatures.length === 0) return null;
  return {
    signatures,
    activeSignature: typeof help.activeSignature === "number" ? help.activeSignature : 0,
    activeParameter: typeof help.activeParameter === "number" ? help.activeParameter : 0
  };
}
