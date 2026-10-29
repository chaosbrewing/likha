import { PRODUCT_NAME } from "@studio/core";
import { getCliVersion } from "../version.js";

export function helpCommand(): void {
  console.log(`${PRODUCT_NAME} CLI v${getCliVersion()}

Usage:
  likha <command> [options]

Commands:
  init <name>      Create a new TypeScript project in a new folder <name>
  status           Show CLI, Node.js and current project information
  help             Show this help
  version          Show the CLI version

Options:
  -h, --help       Show this help
  -v, --version    Show the CLI version

Examples:
  likha init my-project
  likha status`);
}

export function versionCommand(): void {
  console.log(getCliVersion());
}
