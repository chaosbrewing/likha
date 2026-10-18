import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getStarterFiles, validateProjectName } from "@studio/core";
import { CliError, ExitCode, usageError } from "../errors.js";

function describeFsError(error: unknown, target: string): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;

  switch (code) {
    case "EACCES":
    case "EPERM":
      return `Permission denied while writing to ${target}.`;
    case "ENOSPC":
      return `Not enough disk space to write ${target}.`;
    case "EEXIST":
      return `${target} already exists. It was left unchanged.`;
    default:
      return `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Throws unless the target folder is missing or empty. Never modifies anything. */
function ensureTargetIsUsable(target: string): void {
  let stats;
  try {
    stats = statSync(target);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw new CliError(describeFsError(error, target));
  }

  if (!stats.isDirectory()) {
    throw new CliError(`${target} already exists and is not a folder. Nothing was changed.`);
  }

  if (readdirSync(target).length > 0) {
    throw new CliError(
      `${target} already exists and is not empty. Nothing was changed.\n` +
        "Choose a different name or remove the folder yourself."
    );
  }
}

export function initCommand(args: string[], cwd: string): void {
  const [rawName, ...extra] = args;

  if (rawName === undefined) {
    throw usageError('Missing project name. Usage: chaos init <name>');
  }
  if (extra.length > 0) {
    throw usageError(`Unexpected arguments: ${extra.join(" ")}. Usage: chaos init <name>`);
  }

  const result = validateProjectName(rawName);
  if (!result.valid) {
    throw new CliError(`Invalid project name "${rawName}". ${result.reason}`, ExitCode.Usage);
  }

  const parent = path.resolve(cwd);
  const target = path.resolve(parent, result.name);

  // Defence in depth: the validated name must resolve to a direct child of cwd.
  if (path.dirname(target) !== parent) {
    throw new CliError(`Refusing to create a project outside ${parent}.`, ExitCode.Usage);
  }

  ensureTargetIsUsable(target);

  const written: string[] = [];
  try {
    mkdirSync(target, { recursive: true });
    for (const file of getStarterFiles(result.name)) {
      const filePath = path.join(target, ...file.path.split("/"));
      mkdirSync(path.dirname(filePath), { recursive: true });
      // "wx" fails instead of overwriting if the file somehow appeared meanwhile.
      writeFileSync(filePath, file.contents, { encoding: "utf8", flag: "wx" });
      written.push(file.path);
    }
  } catch (error) {
    const partial =
      written.length > 0
        ? `\nFiles already created in ${target}: ${written.join(", ")}. They were not removed.`
        : "";
    throw new CliError(describeFsError(error, target) + partial);
  }

  console.log(`Created Origin Studio project "${result.name}" in ${target}

Files:
${written.map((file) => `  ${file}`).join("\n")}

Next steps:
  cd ${result.name}
  npm install
  npm run build
  npm start`);
}
