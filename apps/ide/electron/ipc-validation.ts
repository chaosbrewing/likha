import {
  TERMINAL_LIMITS,
  type ShellId,
  type TerminalCreateOptions,
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
