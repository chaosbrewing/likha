import type { OriginProjectRecord, SyncState } from "./origin/index.js";

/**
 * Paths crossing the host boundary are always workspace-relative, use "/" as
 * the separator, and "" means the workspace root. Absolute paths never leave
 * the trusted host except for display (WorkspaceInfo.rootPath).
 */
export type RelativePath = string;

export type EntryKind = "file" | "directory" | "symlink";

export interface WorkspaceEntry {
  name: string;
  path: RelativePath;
  kind: EntryKind;
}

export type ProjectStatus =
  | { state: "none" }
  | { state: "invalid"; problems: string[] }
  | { state: "valid"; name: string };

/**
 * What the ORIGIN Core adapter knows about the open folder. "off" when the
 * origin-core feature flag is not set, so the status bar shows "Local".
 */
export type OriginWorkspaceState =
  | { feature: "off" }
  /** The link file names an ORIGIN project. Read-only: the IDE never writes to ORIGIN. */
  | { feature: "on"; link: "linked"; detail: string; project: OriginProjectRecord; sync: SyncState | null }
  /** The feature is on but this folder has no link file. */
  | { feature: "on"; link: "none"; detail: string }
  /** The link file exists but could not be read or is invalid; `detail` says why. */
  | { feature: "on"; link: "error"; detail: string };

export interface WorkspaceInfo {
  /** Folder name, for display. */
  name: string;
  /** Absolute path, for display only. */
  rootPath: string;
  project: ProjectStatus;
  /** Current Git branch, or null when the folder is not a Git repository. */
  branch: string | null;
  /** package.json script names that are safe to offer as "Run" actions. */
  scripts: string[];
  origin: OriginWorkspaceState;
}

/** Opaque content fingerprint used to detect changes made outside the IDE. */
export type FileVersion = string;

export type FileReadResult =
  | { kind: "text"; content: string; version: FileVersion; hasBom: boolean }
  | { kind: "binary"; size: number }
  | { kind: "too-large"; size: number; limit: number };

export interface WriteFileOptions {
  /**
   * Version the editor last loaded or saved. When the file on disk no longer
   * matches it, the write fails with CONFLICT. null means "the file must not
   * exist yet".
   */
  expectedVersion: FileVersion | null;
  /** Skip the conflict check. Only after the user explicitly chose to overwrite. */
  overwrite?: boolean;
  /** Write a UTF-8 byte order mark, preserving the original file's encoding. */
  bom?: boolean;
}

export interface WriteFileResult {
  version: FileVersion;
}

export interface SaveAsResult {
  path: RelativePath;
  version: FileVersion;
}

/** Batched notification that files changed on disk, from any program. */
export interface WorkspaceChangeEvent {
  /** Changed workspace-relative paths (files or folders). Empty when overflow is true. */
  paths: RelativePath[];
  /** Too many changes, or the platform could not say which: refresh everything. */
  overflow: boolean;
}
