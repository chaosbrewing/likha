import path from "node:path";
import { fail, ok, type RelativePath, type Result } from "@studio/contracts";

/**
 * Parses a workspace-relative path from an untrusted caller into its segments.
 * Accepts only "/"-separated relative paths with no "." or ".." segments,
 * drive letters, UNC prefixes or NUL characters. "" is the workspace root.
 */
export function parseRelativePath(input: unknown): Result<string[]> {
  if (typeof input !== "string") {
    return fail("INVALID_PATH", "Path must be a string.");
  }
  if (input === "") {
    return ok([]);
  }
  if (input.length > 4096) {
    return fail("INVALID_PATH", "Path is too long.");
  }
  if (input.includes("\\") || input.includes("\u0000")) {
    return fail("INVALID_PATH", "Path contains characters that are not allowed.");
  }
  if (input.startsWith("/") || /^[a-zA-Z]:/.test(input) || path.isAbsolute(input)) {
    return fail("OUTSIDE_WORKSPACE", "Absolute paths are not allowed; paths must stay inside the workspace.");
  }

  const segments = input.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      return fail("INVALID_PATH", `Path "${input}" is not normalized.`);
    }
    if (segment === "..") {
      return fail("OUTSIDE_WORKSPACE", "Paths cannot leave the workspace.");
    }
    if (segment.includes(":")) {
      // Blocks NTFS alternate data streams such as "file.txt:hidden".
      return fail("INVALID_PATH", "Path contains characters that are not allowed.");
    }
  }
  return ok(segments);
}

export function joinRelative(parent: RelativePath, name: string): RelativePath {
  return parent === "" ? name : `${parent}/${name}`;
}

export function parentOf(relPath: RelativePath): RelativePath {
  const index = relPath.lastIndexOf("/");
  return index === -1 ? "" : relPath.slice(0, index);
}

export function baseName(relPath: RelativePath): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

/** True when `candidate` is `root` or inside it. Both must be absolute and resolved. */
export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Converts an absolute path inside root back to a workspace-relative path. */
export function toRelative(root: string, absolute: string): RelativePath | null {
  if (!isInside(root, absolute)) {
    return null;
  }
  const relative = path.relative(root, absolute);
  return relative.split(path.sep).join("/");
}
