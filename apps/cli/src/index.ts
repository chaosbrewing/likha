#!/usr/bin/env node
import { helpCommand, versionCommand } from "./commands/help.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { CliError, ExitCode, usageError, type ExitCodeValue } from "./errors.js";

export function run(argv: string[], cwd: string): ExitCodeValue {
  const [command = "help", ...rest] = argv;

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      helpCommand();
      return ExitCode.Success;

    case "version":
    case "--version":
    case "-v":
      versionCommand();
      return ExitCode.Success;

    case "status":
      if (rest.length > 0) {
        throw usageError(`"status" takes no arguments.`);
      }
      statusCommand(cwd);
      return ExitCode.Success;

    case "init":
      if (rest.includes("--help") || rest.includes("-h")) {
        helpCommand();
        return ExitCode.Success;
      }
      initCommand(rest, cwd);
      return ExitCode.Success;

    default:
      throw usageError(
        command.startsWith("-") ? `Unknown option: ${command}` : `Unknown command: ${command}`
      );
  }
}

try {
  process.exitCode = run(process.argv.slice(2), process.cwd());
} catch (error) {
  if (error instanceof CliError) {
    console.error(`Error: ${error.message}`);
    process.exitCode = error.exitCode;
  } else {
    console.error(
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = ExitCode.Failure;
  }
}
