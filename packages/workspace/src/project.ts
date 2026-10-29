import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  REQUIRED_PROJECT_FILES,
  checkProjectManifest,
  type ProjectConfigCheck
} from "@studio/core";

/**
 * Inspects a directory for a valid LIKHA project. Read-only.
 * Shared by `likha status` and the IDE.
 */
export function inspectProject(dir: string): ProjectConfigCheck {
  const manifestPath = path.join(dir, "package.json");

  if (!existsSync(manifestPath)) {
    return { state: "none" };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { state: "invalid", problems: [`package.json could not be read: ${detail}`] };
  }

  const check = checkProjectManifest(manifest);
  if (check.state !== "valid") {
    return check;
  }

  const missing = REQUIRED_PROJECT_FILES.filter(
    (file) => !existsSync(path.join(dir, file))
  );
  if (missing.length > 0) {
    return {
      state: "invalid",
      problems: missing.map((file) => `Missing expected file: ${file}`)
    };
  }

  return check;
}

const SAFE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;

/**
 * Returns package.json script names safe to type into a shell as
 * `npm run <name>`. Names with spaces or shell metacharacters are skipped.
 */
export function readSafeScriptNames(dir: string): string[] {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)) {
      return [];
    }
    const scripts = manifest.scripts;
    if (typeof scripts !== "object" || scripts === null) {
      return [];
    }
    return Object.keys(scripts).filter((name) => SAFE_SCRIPT_NAME.test(name));
  } catch {
    return [];
  }
}

/**
 * Reads the current Git branch without running git: follows .git/HEAD (and a
 * .git file pointing elsewhere, as used by worktrees). Returns a short commit
 * id when HEAD is detached and null when this is not a Git repository.
 */
export function readGitBranch(dir: string): string | null {
  try {
    let gitDir = path.join(dir, ".git");
    if (!existsSync(gitDir)) {
      return null;
    }
    const pointer = /^gitdir:\s*(.+)\s*$/m.exec(safeRead(gitDir) ?? "");
    if (pointer?.[1]) {
      gitDir = path.resolve(dir, pointer[1]);
    }
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref?.[1]) {
      return ref[1];
    }
    return /^[0-9a-f]{7,}$/i.test(head) ? head.slice(0, 7) : null;
  } catch {
    return null;
  }
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // .git is usually a directory, which cannot be read as a file.
    return null;
  }
}
