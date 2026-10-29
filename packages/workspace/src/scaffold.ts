import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getStarterFiles, validateProjectName } from "@studio/core";
import { fail, ok, type Result } from "@studio/contracts";

export interface ScaffoldResult {
  /** Absolute path of the created project folder. */
  root: string;
  name: string;
  /** Files written, relative to root, in creation order. */
  files: string[];
}

function describeFsError(error: unknown, target: string): Result<never> {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  switch (code) {
    case "EACCES":
    case "EPERM":
      return fail("PERMISSION_DENIED", `Permission denied while writing to ${target}.`);
    case "ENOSPC":
      return fail("UNKNOWN", `Not enough disk space to write ${target}.`);
    case "EEXIST":
      return fail("ALREADY_EXISTS", `${target} already exists. It was left unchanged.`);
    default:
      return fail("UNKNOWN", `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Fails unless the target folder is missing or empty. Never modifies anything. */
function checkTargetIsUsable(target: string): Result<void> {
  let stats;
  try {
    stats = statSync(target);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return ok(undefined);
    }
    return describeFsError(error, target);
  }
  if (!stats.isDirectory()) {
    return fail("ALREADY_EXISTS", `${target} already exists and is not a folder. Nothing was changed.`);
  }
  if (readdirSync(target).length > 0) {
    return fail(
      "ALREADY_EXISTS",
      `${target} already exists and is not empty. Nothing was changed.\nChoose a different name or remove the folder yourself.`
    );
  }
  return ok(undefined);
}

/**
 * Creates a new LIKHA project folder `name` directly inside
 * `parentDir`, used by both `likha init` and the IDE's New Project.
 * Never overwrites: an existing folder is used only when empty, and each file
 * is written with create-only semantics. Never deletes partial output.
 */
export function scaffoldProject(parentDir: string, name: string): Result<ScaffoldResult> {
  const checked = validateProjectName(name);
  if (!checked.valid) {
    return fail("INVALID_NAME", checked.reason);
  }

  const parent = path.resolve(parentDir);
  const target = path.resolve(parent, checked.name);
  // Defence in depth: the validated name must resolve to a direct child of parentDir.
  if (path.dirname(target) !== parent) {
    return fail("OUTSIDE_WORKSPACE", `Refusing to create a project outside ${parent}.`);
  }

  const usable = checkTargetIsUsable(target);
  if (!usable.ok) {
    return usable;
  }

  const written: string[] = [];
  try {
    mkdirSync(target, { recursive: true });
    for (const file of getStarterFiles(checked.name)) {
      const filePath = path.join(target, ...file.path.split("/"));
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.contents, { encoding: "utf8", flag: "wx" });
      written.push(file.path);
    }
  } catch (error) {
    const failure = describeFsError(error, target);
    if (!failure.ok && written.length > 0) {
      failure.error.message += `\nFiles already created in ${target}: ${written.join(", ")}. They were not removed.`;
    }
    return failure;
  }

  return ok({ root: target, name: checked.name, files: written });
}
