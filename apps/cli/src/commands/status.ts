import { PRODUCT_NAME } from "@studio/core";
import { inspectProject } from "@studio/workspace";
import { getCliVersion } from "../version.js";

export function statusCommand(cwd: string): void {
  const project = inspectProject(cwd);

  const lines = [
    `Product:    ${PRODUCT_NAME}`,
    `CLI:        likha v${getCliVersion()}`,
    `Node.js:    ${process.version}`,
    `Directory:  ${cwd}`
  ];

  switch (project.state) {
    case "none":
      lines.push("Project:    No LIKHA project in this directory");
      lines.push('            Run "likha init <name>" to create one.');
      break;
    case "invalid":
      lines.push("Project:    LIKHA configuration found, but it is invalid:");
      for (const problem of project.problems) {
        lines.push(`            - ${problem}`);
      }
      break;
    case "valid":
      lines.push(`Project:    ${project.name} (valid LIKHA project)`);
      break;
  }

  console.log(lines.join("\n"));
}
