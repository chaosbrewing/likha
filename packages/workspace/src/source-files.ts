import { readdir } from "node:fs/promises";
import path from "node:path";
import { joinRelative } from "./paths.js";

/** Folders never searched for source files (generated output, dependencies, VCS). */
const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "build", "out", "coverage", ".git", "release"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

export interface SourceFileListing {
  /** Workspace-relative "/" paths, sorted. */
  files: string[];
  /** True when the walk stopped at `limit` files. */
  truncated: boolean;
}

/**
 * Lists the TypeScript and JavaScript files of a workspace for project-wide
 * checks. Hidden folders, dependencies and build output are skipped, symbolic
 * links are not followed, and the walk stops after `limit` files so a huge
 * folder cannot stall the host.
 */
export async function listSourceFiles(root: string, limit: number): Promise<SourceFileListing> {
  const files: string[] = [];
  let truncated = false;
  const walk = async (relative: string): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(path.join(root, ...relative.split("/").filter(Boolean)), { withFileTypes: true });
    } catch {
      return; // Unreadable folders are simply not checked.
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(joinRelative(relative, entry.name));
        }
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith(".d.ts")) {
        if (files.length >= limit) {
          truncated = true;
          return;
        }
        files.push(joinRelative(relative, entry.name));
      }
    }
  };
  await walk("");
  return { files, truncated };
}
