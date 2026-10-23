import {
  LANGUAGE_LIMITS,
  TERMINAL_LIMITS,
  type CompletionContext,
  type LanguageId,
  type ShellId,
  type TerminalCreateOptions,
  type TextChange,
  type TextPosition,
  type TextRange,
  type WriteFileOptions
} from "@studio/contracts";

/** Thrown by parsers; turned into an INVALID_ARGUMENT result by the IPC layer. */
export class ArgumentError extends Error {}

const MAX_PATH_LENGTH = 4096;
const MAX_NAME_LENGTH = 255;
/** Largest text the interface may ask to save (matches the 5 MB read limit with headroom). */
export const MAX_FILE_CONTENT_LENGTH = 20 * 1024 * 1024;
const SHELL_IDS: readonly ShellId[] = ["pwsh", "powershell", "cmd", "bash", "zsh", "sh"];

function expectCount(args: unknown[], count: number): void {
  if (args.length !== count) {
    throw new ArgumentError(`Expected ${count} argument(s), received ${args.length}.`);
  }
}

function string(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ArgumentError(`${name} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new ArgumentError(`${name} is too long.`);
  }
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ArgumentError(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArgumentError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new ArgumentError(`${name} must be true or false.`);
  }
  return value;
}

/* Parsers, one per channel that takes arguments. Paths are only checked for
   type and length here; WorkspaceService enforces the workspace boundary. */

export const parseNoArgs = (args: unknown[]): void => expectCount(args, 0);

export function parseConfirmClose(args: unknown[]): boolean {
  expectCount(args, 1);
  if (typeof args[0] !== "boolean") {
    throw new ArgumentError("allow must be true or false.");
  }
  return args[0];
}

export function parseProjectName(args: unknown[]): string {
  expectCount(args, 1);
  return string(args[0], "name", 214);
}

export function parsePath(args: unknown[]): string {
  expectCount(args, 1);
  return string(args[0], "path", MAX_PATH_LENGTH);
}

export function parseWrite(args: unknown[]): { path: string; content: string; options: WriteFileOptions } {
  expectCount(args, 3);
  const path = string(args[0], "path", MAX_PATH_LENGTH);
  const content = string(args[1], "content", MAX_FILE_CONTENT_LENGTH);
  const raw = record(args[2], "options");
  const expectedVersion = raw.expectedVersion === null ? null : string(raw.expectedVersion, "expectedVersion", 128);
  const options: WriteFileOptions = { expectedVersion };
  const overwrite = optionalBoolean(raw.overwrite, "overwrite");
  const bom = optionalBoolean(raw.bom, "bom");
  if (overwrite !== undefined) options.overwrite = overwrite;
  if (bom !== undefined) options.bom = bom;
  return { path, content, options };
}

export function parseSaveAs(args: unknown[]): { suggestedPath: string; content: string; bom: boolean } {
  expectCount(args, 3);
  return {
    suggestedPath: string(args[0], "suggestedPath", MAX_PATH_LENGTH),
    content: string(args[1], "content", MAX_FILE_CONTENT_LENGTH),
    bom: optionalBoolean(args[2], "bom") ?? false
  };
}

export function parseCreate(args: unknown[]): { parent: string; name: string } {
  expectCount(args, 2);
  return { parent: string(args[0], "parent", MAX_PATH_LENGTH), name: string(args[1], "name", MAX_NAME_LENGTH) };
}

export function parseRename(args: unknown[]): { path: string; newName: string } {
  expectCount(args, 2);
  return { path: string(args[0], "path", MAX_PATH_LENGTH), newName: string(args[1], "newName", MAX_NAME_LENGTH) };
}

export function parseDelete(args: unknown[]): { path: string; confirmed: true } {
  expectCount(args, 2);
  if (args[1] !== true) {
    throw new ArgumentError("Deleting requires confirmed to be true.");
  }
  return { path: string(args[0], "path", MAX_PATH_LENGTH), confirmed: true };
}

export function parseTerminalCreate(args: unknown[]): TerminalCreateOptions {
  expectCount(args, 1);
  const raw = record(args[0], "options");
  const options: TerminalCreateOptions = {
    cols: integer(raw.cols, "cols", 1, TERMINAL_LIMITS.maxCols),
    rows: integer(raw.rows, "rows", 1, TERMINAL_LIMITS.maxRows)
  };
  if (raw.shell !== undefined) {
    if (typeof raw.shell !== "string" || !SHELL_IDS.includes(raw.shell as ShellId)) {
      throw new ArgumentError("shell is not a supported shell.");
    }
    options.shell = raw.shell as ShellId;
  }
  return options;
}

export function parseTerminalWrite(args: unknown[]): { id: number; data: string } {
  expectCount(args, 2);
  return {
    id: integer(args[0], "id", 1, Number.MAX_SAFE_INTEGER),
    data: string(args[1], "data", TERMINAL_LIMITS.maxWriteLength)
  };
}

export function parseTerminalResize(args: unknown[]): { id: number; cols: number; rows: number } {
  expectCount(args, 3);
  return {
    id: integer(args[0], "id", 1, Number.MAX_SAFE_INTEGER),
    cols: integer(args[1], "cols", 1, TERMINAL_LIMITS.maxCols),
    rows: integer(args[2], "rows", 1, TERMINAL_LIMITS.maxRows)
  };
}

export function parseTerminalId(args: unknown[]): number {
  expectCount(args, 1);
  return integer(args[0], "id", 1, Number.MAX_SAFE_INTEGER);
}

/* ---------- language server ---------- */

const LANGUAGE_IDS: readonly LanguageId[] = ["typescript", "javascript"];
const MAX_LINE = 10_000_000;
const MAX_TOKEN = Number.MAX_SAFE_INTEGER;

function position(value: unknown, name: string): TextPosition {
  const raw = record(value, name);
  return { line: integer(raw.line, `${name}.line`, 0, MAX_LINE), character: integer(raw.character, `${name}.character`, 0, MAX_LINE) };
}

function range(value: unknown, name: string): TextRange {
  const raw = record(value, name);
  return { start: position(raw.start, `${name}.start`), end: position(raw.end, `${name}.end`) };
}

export function parseLanguageOpen(args: unknown[]): { path: string; languageId: LanguageId; version: number; text: string } {
  expectCount(args, 4);
  const languageId = args[1];
  if (typeof languageId !== "string" || !LANGUAGE_IDS.includes(languageId as LanguageId)) {
    throw new ArgumentError("languageId must be typescript or javascript.");
  }
  return {
    path: string(args[0], "path", MAX_PATH_LENGTH),
    languageId: languageId as LanguageId,
    version: integer(args[2], "version", 0, MAX_TOKEN),
    text: string(args[3], "text", LANGUAGE_LIMITS.maxDocumentLength)
  };
}

export function parseLanguageChange(args: unknown[]): { path: string; version: number; changes: TextChange[] } {
  expectCount(args, 3);
  const path = string(args[0], "path", MAX_PATH_LENGTH);
  const version = integer(args[1], "version", 0, MAX_TOKEN);
  const raw = args[2];
  if (!Array.isArray(raw) || raw.length > LANGUAGE_LIMITS.maxChangesPerEvent) {
    throw new ArgumentError("changes must be a list of edits.");
  }
  const changes: TextChange[] = raw.map((change, index) => {
    const entry = record(change, `changes[${index}]`);
    return { range: range(entry.range, `changes[${index}].range`), text: string(entry.text, `changes[${index}].text`, LANGUAGE_LIMITS.maxDocumentLength) };
  });
  return { path, version, changes };
}

export type LanguageRequest =
  | { kind: "hover" | "definition" | "references" | "signature-help"; path: string; position: TextPosition }
  | { kind: "completion"; path: string; position: TextPosition; context: CompletionContext }
  | { kind: "resolve"; token: number; index: number }
  | { kind: "diagnostics"; path: string };

export function parseLanguageRequest(args: unknown[]): LanguageRequest {
  expectCount(args, 1);
  const raw = record(args[0], "request");
  switch (raw.kind) {
    case "hover":
    case "definition":
    case "references":
    case "signature-help":
      return { kind: raw.kind, path: string(raw.path, "path", MAX_PATH_LENGTH), position: position(raw.position, "position") };
    case "completion": {
      const context = record(raw.context, "context");
      const triggerKind = integer(context.triggerKind, "context.triggerKind", 1, 3) as 1 | 2 | 3;
      const result: Extract<LanguageRequest, { kind: "completion" }> = {
        kind: "completion",
        path: string(raw.path, "path", MAX_PATH_LENGTH),
        position: position(raw.position, "position"),
        context: { triggerKind }
      };
      if (context.triggerCharacter !== undefined) {
        result.context.triggerCharacter = string(context.triggerCharacter, "context.triggerCharacter", 1);
      }
      return result;
    }
    case "resolve":
      return { kind: "resolve", token: integer(raw.token, "token", 1, MAX_TOKEN), index: integer(raw.index, "index", 0, LANGUAGE_LIMITS.maxCompletionItems) };
    case "diagnostics":
      return { kind: "diagnostics", path: string(raw.path, "path", MAX_PATH_LENGTH) };
    default:
      throw new ArgumentError("request.kind is not a known language request.");
  }
}
