import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { validateEntryName } from "@studio/core";
import {
  fail,
  ok,
  type FileReadResult,
  type FileVersion,
  type RelativePath,
  type Result,
  type StudioErrorCode,
  type WorkspaceEntry,
  type WorkspaceInfo,
  type WriteFileOptions,
  type WriteFileResult
} from "@studio/contracts";
import { baseName, isInside, joinRelative, parseRelativePath, toRelative } from "./paths.js";
import { inspectProject, readGitBranch, readSafeScriptNames } from "./project.js";

export interface WorkspaceServiceOptions {
  /**
   * Removes an entry. The desktop host passes the system trash (Recycle Bin)
   * so deletions are recoverable.
   */
  trash: (absolutePath: string) => Promise<void>;
  /** Files larger than this are not opened as text. Default 5 MB. */
  maxTextFileSize?: number;
}

const DEFAULT_MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024;
const BINARY_SNIFF_LENGTH = 8000;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
/** Entries never shown in the explorer. */
const HIDDEN_ENTRIES = new Set([".git"]);

export function fileVersion(bytes: Uint8Array): FileVersion {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Maps a Node.js filesystem error to a user-facing Result error. */
export function fsFailure<T = never>(error: unknown, displayPath: string): Result<T> {
  const where = displayPath === "" ? "the workspace folder" : `"${displayPath}"`;
  const table: Record<string, [StudioErrorCode, string]> = {
    ENOENT: ["NOT_FOUND", `${where} no longer exists.`],
    EACCES: ["PERMISSION_DENIED", `Permission denied for ${where}.`],
    EPERM: ["PERMISSION_DENIED", `Permission denied for ${where}. It may be read-only or in use.`],
    EBUSY: ["PERMISSION_DENIED", `${where} is in use by another program.`],
    EEXIST: ["ALREADY_EXISTS", `${where} already exists.`],
    ENOTDIR: ["NOT_A_DIRECTORY", `${where} is not a folder.`],
    EISDIR: ["NOT_A_FILE", `${where} is a folder, not a file.`],
    ENOTEMPTY: ["ALREADY_EXISTS", `${where} already exists and is not empty.`],
    ENOSPC: ["UNKNOWN", `Not enough disk space to write ${where}.`]
  };
  const mapped = table[errorCode(error) ?? ""];
  if (mapped) {
    return fail(mapped[0], mapped[1]);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return fail("UNKNOWN", `Could not access ${where}: ${detail}`);
}

function decodeText(bytes: Buffer): { content: string; hasBom: boolean } | null {
  const sniff = bytes.subarray(0, BINARY_SNIFF_LENGTH);
  if (sniff.includes(0)) {
    return null;
  }
  const hasBom = bytes.subarray(0, 3).equals(UTF8_BOM);
  try {
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return { content, hasBom };
  } catch {
    // Not valid UTF-8: treat as unsupported rather than risk corrupting it on save.
    return null;
  }
}

/**
 * All filesystem access for one opened workspace. Every path argument is an
 * untrusted workspace-relative path; every resolved path, including symbolic
 * link targets, must stay inside the workspace root.
 */
export class WorkspaceService {
  readonly root: string;
  private readonly trash: (absolutePath: string) => Promise<void>;
  private readonly maxTextFileSize: number;

  private constructor(root: string, options: WorkspaceServiceOptions) {
    this.root = root;
    this.trash = options.trash;
    this.maxTextFileSize = options.maxTextFileSize ?? DEFAULT_MAX_TEXT_FILE_SIZE;
  }

  static async open(rootPath: string, options: WorkspaceServiceOptions): Promise<Result<WorkspaceService>> {
    if (typeof rootPath !== "string" || rootPath.length === 0 || !path.isAbsolute(rootPath)) {
      return fail("INVALID_PATH", "Workspace folder must be an absolute path.");
    }
    try {
      const real = await realpath(rootPath);
      if (!(await stat(real)).isDirectory()) {
        return fail("NOT_A_DIRECTORY", `"${rootPath}" is not a folder.`);
      }
      return ok(new WorkspaceService(real, options));
    } catch (error) {
      return fsFailure(error, rootPath);
    }
  }

  info(): WorkspaceInfo {
    const project = inspectProject(this.root);
    return {
      name: path.basename(this.root) || this.root,
      rootPath: this.root,
      project:
        project.state === "valid"
          ? { state: "valid", name: project.name }
          : project.state === "invalid"
            ? { state: "invalid", problems: project.problems }
            : { state: "none" },
      branch: readGitBranch(this.root),
      scripts: readSafeScriptNames(this.root),
      // The host replaces this with the ORIGIN Core adapter's answer when that feature is on.
      origin: { feature: "off" }
    };
  }

  /** Resolves an existing entry, following links, and checks it stays inside the root. */
  private async resolveExisting(relPath: unknown): Promise<Result<{ abs: string; rel: string }>> {
    const parsed = parseRelativePath(relPath);
    if (!parsed.ok) {
      return parsed;
    }
    const rel = parsed.value.join("/");
    try {
      const abs = await realpath(path.join(this.root, ...parsed.value));
      if (!isInside(this.root, abs)) {
        return fail("OUTSIDE_WORKSPACE", `"${rel}" links to a location outside the workspace.`);
      }
      return ok({ abs, rel });
    } catch (error) {
      return fsFailure(error, rel);
    }
  }

  /**
   * Resolves the parent folder of an entry and returns the entry's absolute
   * path without following the entry itself (so links are renamed or removed,
   * never their targets).
   */
  private async resolveEntryInParent(relPath: unknown): Promise<Result<{ abs: string; rel: string; parentAbs: string }>> {
    const parsed = parseRelativePath(relPath);
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.value.length === 0) {
      return fail("INVALID_PATH", "This operation is not allowed on the workspace folder itself.");
    }
    const segments = parsed.value;
    const parent = await this.resolveDirectory(segments.slice(0, -1).join("/"));
    if (!parent.ok) {
      return parent;
    }
    const name = segments[segments.length - 1] as string;
    return ok({
      abs: path.join(parent.value, name),
      rel: segments.join("/"),
      parentAbs: parent.value
    });
  }

  private async resolveDirectory(relPath: RelativePath): Promise<Result<string>> {
    const resolved = await this.resolveExisting(relPath);
    if (!resolved.ok) {
      return resolved;
    }
    try {
      if (!(await stat(resolved.value.abs)).isDirectory()) {
        return fail("NOT_A_DIRECTORY", `"${resolved.value.rel}" is not a folder.`);
      }
    } catch (error) {
      return fsFailure(error, resolved.value.rel);
    }
    return ok(resolved.value.abs);
  }

  async list(relPath: unknown): Promise<Result<WorkspaceEntry[]>> {
    const parsed = parseRelativePath(relPath);
    if (!parsed.ok) {
      return parsed;
    }
    const rel = parsed.value.join("/");
    const dir = await this.resolveDirectory(rel);
    if (!dir.ok) {
      return dir;
    }

    let dirents;
    try {
      dirents = await readdir(dir.value, { withFileTypes: true });
    } catch (error) {
      return fsFailure(error, rel);
    }

    const entries: WorkspaceEntry[] = [];
    for (const dirent of dirents) {
      if (HIDDEN_ENTRIES.has(dirent.name)) {
        continue;
      }
      const entryPath = joinRelative(rel, dirent.name);
      let kind: WorkspaceEntry["kind"] = dirent.isDirectory() ? "directory" : "file";
      if (dirent.isSymbolicLink()) {
        // Links are shown as what they point to only when the target is inside the workspace.
        kind = "symlink";
        try {
          const target = await realpath(path.join(dir.value, dirent.name));
          if (isInside(this.root, target)) {
            kind = (await stat(target)).isDirectory() ? "directory" : "file";
          }
        } catch {
          // Broken link: leave as "symlink".
        }
      } else if (!dirent.isDirectory() && !dirent.isFile()) {
        continue; // Sockets, devices and pipes are not editable.
      }
      entries.push({ name: dirent.name, path: entryPath, kind });
    }

    entries.sort((a, b) => {
      const aDir = a.kind === "directory" ? 0 : 1;
      const bDir = b.kind === "directory" ? 0 : 1;
      return aDir - bDir || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
    return ok(entries);
  }

  async readFile(relPath: unknown): Promise<Result<FileReadResult>> {
    const resolved = await this.resolveExisting(relPath);
    if (!resolved.ok) {
      return resolved;
    }
    const { abs, rel } = resolved.value;
    try {
      const info = await stat(abs);
      if (info.isDirectory()) {
        return fail("NOT_A_FILE", `"${rel}" is a folder, not a file.`);
      }
      if (info.size > this.maxTextFileSize) {
        return ok({ kind: "too-large", size: info.size, limit: this.maxTextFileSize });
      }
      const bytes = await readFile(abs);
      const text = decodeText(bytes);
      if (text === null) {
        return ok({ kind: "binary", size: bytes.length });
      }
      return ok({ kind: "text", content: text.content, hasBom: text.hasBom, version: fileVersion(bytes) });
    } catch (error) {
      return fsFailure(error, rel);
    }
  }

  async writeFile(relPath: unknown, content: unknown, options: WriteFileOptions): Promise<Result<WriteFileResult>> {
    if (typeof content !== "string") {
      return fail("INVALID_ARGUMENT", "File content must be text.");
    }
    const entry = await this.resolveEntryInParent(relPath);
    if (!entry.ok) {
      return entry;
    }
    const { rel } = entry.value;
    let target = entry.value.abs;

    // Read what is on disk now, following an in-workspace link to its target.
    let current: Buffer | null = null;
    let currentMode: number | undefined;
    try {
      const linkInfo = await lstat(target);
      if (linkInfo.isSymbolicLink()) {
        const real = await realpath(target);
        if (!isInside(this.root, real)) {
          return fail("OUTSIDE_WORKSPACE", `"${rel}" links to a location outside the workspace.`);
        }
        target = real;
      }
      const info = await stat(target);
      if (info.isDirectory()) {
        return fail("NOT_A_FILE", `"${rel}" is a folder, not a file.`);
      }
      currentMode = info.mode;
      current = await readFile(target);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        return fsFailure(error, rel);
      }
    }

    if (!options.overwrite) {
      if (options.expectedVersion === null && current !== null) {
        return fail("CONFLICT", `"${rel}" already exists.`);
      }
      if (options.expectedVersion !== null) {
        if (current === null) {
          return fail("CONFLICT", `"${rel}" was deleted or moved outside LIKHA.`);
        }
        if (fileVersion(current) !== options.expectedVersion) {
          return fail("CONFLICT", `"${rel}" was changed outside LIKHA since it was opened.`);
        }
      }
    }

    const body = Buffer.from(content, "utf8");
    const bytes = options.bom ? Buffer.concat([UTF8_BOM, body]) : body;
    const written = await this.atomicWrite(target, bytes, currentMode, rel);
    if (!written.ok) {
      return written;
    }
    return ok({ version: fileVersion(bytes) });
  }

  /**
   * Writes to a temporary file in the same folder and renames it over the
   * target, so a crash never leaves a half-written file. Falls back to a
   * direct write when the rename is refused (e.g. the file is open elsewhere).
   */
  private async atomicWrite(target: string, bytes: Buffer, mode: number | undefined, rel: string): Promise<Result<void>> {
    const temp = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${randomBytes(6).toString("hex")}.origin-tmp`
    );
    try {
      await writeFile(temp, bytes, { flag: "wx" });
    } catch (error) {
      return fsFailure(error, rel);
    }
    try {
      if (mode !== undefined) {
        await chmod(temp, mode).catch(() => undefined);
      }
      await rename(temp, target);
      return ok(undefined);
    } catch (renameError) {
      await unlink(temp).catch(() => undefined);
      const code = errorCode(renameError);
      if (mode !== undefined && (code === "EPERM" || code === "EACCES" || code === "EBUSY")) {
        try {
          await writeFile(target, bytes);
          return ok(undefined);
        } catch (directError) {
          return fsFailure(directError, rel);
        }
      }
      return fsFailure(renameError, rel);
    }
  }

  /** Converts an absolute path chosen in a native dialog to a workspace path. */
  async relativePathFor(absolutePath: string): Promise<Result<RelativePath>> {
    try {
      const parentReal = await realpath(path.dirname(absolutePath));
      const rel = toRelative(this.root, path.join(parentReal, path.basename(absolutePath)));
      if (rel === null || rel === "") {
        return fail("OUTSIDE_WORKSPACE", "Files can only be saved inside the open workspace folder.");
      }
      const name = validateEntryName(path.basename(absolutePath));
      if (!name.valid) {
        return fail("INVALID_NAME", name.reason);
      }
      return ok(rel);
    } catch (error) {
      return fsFailure(error, path.dirname(absolutePath));
    }
  }

  private async prepareCreate(parentRel: unknown, name: unknown): Promise<Result<{ abs: string; rel: string }>> {
    if (typeof name !== "string") {
      return fail("INVALID_NAME", "Name must be text.");
    }
    const checked = validateEntryName(name);
    if (!checked.valid) {
      return fail("INVALID_NAME", checked.reason);
    }
    const parsed = parseRelativePath(parentRel);
    if (!parsed.ok) {
      return parsed;
    }
    const parentPath = parsed.value.join("/");
    const parent = await this.resolveDirectory(parentPath);
    if (!parent.ok) {
      return parent;
    }
    return ok({ abs: path.join(parent.value, checked.name), rel: joinRelative(parentPath, checked.name) });
  }

  async createFile(parentRel: unknown, name: unknown): Promise<Result<WorkspaceEntry>> {
    const target = await this.prepareCreate(parentRel, name);
    if (!target.ok) {
      return target;
    }
    try {
      await writeFile(target.value.abs, "", { flag: "wx" });
    } catch (error) {
      return fsFailure(error, target.value.rel);
    }
    return ok({ name: baseName(target.value.rel), path: target.value.rel, kind: "file" });
  }

  async createFolder(parentRel: unknown, name: unknown): Promise<Result<WorkspaceEntry>> {
    const target = await this.prepareCreate(parentRel, name);
    if (!target.ok) {
      return target;
    }
    try {
      await mkdir(target.value.abs);
    } catch (error) {
      return fsFailure(error, target.value.rel);
    }
    return ok({ name: baseName(target.value.rel), path: target.value.rel, kind: "directory" });
  }

  async rename(relPath: unknown, newName: unknown): Promise<Result<WorkspaceEntry>> {
    if (typeof newName !== "string") {
      return fail("INVALID_NAME", "Name must be text.");
    }
    const checked = validateEntryName(newName);
    if (!checked.valid) {
      return fail("INVALID_NAME", checked.reason);
    }
    const source = await this.resolveEntryInParent(relPath);
    if (!source.ok) {
      return source;
    }
    const { abs, rel, parentAbs } = source.value;
    const targetAbs = path.join(parentAbs, checked.name);
    const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const targetRel = joinRelative(parentRel, checked.name);

    let sourceInfo;
    try {
      sourceInfo = await lstat(abs);
    } catch (error) {
      return fsFailure(error, rel);
    }

    try {
      const existing = await lstat(targetAbs);
      // Allow case-only renames (a.ts -> A.ts) on case-insensitive filesystems.
      const sameEntry = existing.ino === sourceInfo.ino && existing.dev === sourceInfo.dev;
      if (!sameEntry || abs === targetAbs) {
        return fail("ALREADY_EXISTS", `"${targetRel}" already exists. Nothing was renamed.`);
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        return fsFailure(error, targetRel);
      }
    }

    try {
      await rename(abs, targetAbs);
    } catch (error) {
      return fsFailure(error, rel);
    }
    const kind: WorkspaceEntry["kind"] = sourceInfo.isSymbolicLink()
      ? "symlink"
      : sourceInfo.isDirectory()
        ? "directory"
        : "file";
    return ok({ name: checked.name, path: targetRel, kind });
  }

  /**
   * Moves an entry to the trash. `confirmed` must be exactly true, which the
   * interface only sends after the user confirms in a dialog.
   */
  async delete(relPath: unknown, confirmed: unknown): Promise<Result<void>> {
    if (confirmed !== true) {
      return fail("CONFIRMATION_REQUIRED", "Deleting requires confirmation.");
    }
    const entry = await this.resolveEntryInParent(relPath);
    if (!entry.ok) {
      return entry;
    }
    try {
      await lstat(entry.value.abs);
      await this.trash(entry.value.abs);
      return ok(undefined);
    } catch (error) {
      return fsFailure(error, entry.value.rel);
    }
  }

  /** True when the path exists (without following links). For tests and diagnostics. */
  async exists(relPath: RelativePath): Promise<boolean> {
    const parsed = parseRelativePath(relPath);
    if (!parsed.ok) {
      return false;
    }
    try {
      await lstat(path.join(this.root, ...parsed.value));
      return true;
    } catch {
      return false;
    }
  }
}

