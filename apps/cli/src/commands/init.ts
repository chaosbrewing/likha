import { scaffoldProject } from "@studio/workspace";
import { CliError, ExitCode, usageError } from "../errors.js";

export function initCommand(args: string[], cwd: string): void {
  const [rawName, ...extra] = args;

  if (rawName === undefined) {
    throw usageError('Missing project name. Usage: likha init <name>');
  }
  if (extra.length > 0) {
    throw usageError(`Unexpected arguments: ${extra.join(" ")}. Usage: likha init <name>`);
  }

  const result = scaffoldProject(cwd, rawName);
  if (!result.ok) {
    switch (result.error.code) {
      case "INVALID_NAME":
        throw new CliError(`Invalid project name "${rawName}". ${result.error.message}`, ExitCode.Usage);
      case "OUTSIDE_WORKSPACE":
        throw new CliError(result.error.message, ExitCode.Usage);
      default:
        throw new CliError(result.error.message);
    }
  }

  const { root, name, files } = result.value;
  console.log(`Created LIKHA project "${name}" in ${root}

Files:
${files.map((file) => `  ${file}`).join("\n")}

Next steps:
  cd ${name}
  npm install
  npm run build
  npm start`);
}
