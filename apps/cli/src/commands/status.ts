import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  PRODUCT_NAME,
  REQUIRED_PROJECT_FILES,
  checkProjectManifest,
  type ProjectConfigCheck
} from "@studio/core";
import { getCliVersion } from "../version.js";

/** Inspects a directory for a valid Origin Studio project. Reads only. */
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

export function statusCommand(cwd: string): void {
  const project = inspectProject(cwd);

  const lines = [
    `Product:    ${PRODUCT_NAME}`,
    `CLI:        chaos v${getCliVersion()}`,
    `Node.js:    ${process.version}`,
    `Directory:  ${cwd}`
  ];

  switch (project.state) {
    case "none":
      lines.push("Project:    No Origin Studio project in this directory");
      lines.push('            Run "chaos init <name>" to create one.');
      break;
    case "invalid":
      lines.push("Project:    Origin Studio configuration found, but it is invalid:");
      for (const problem of project.problems) {
        lines.push(`            - ${problem}`);
      }
      break;
    case "valid":
      lines.push(`Project:    ${project.name} (valid Origin Studio project)`);
      break;
  }

  console.log(lines.join("\n"));
}
