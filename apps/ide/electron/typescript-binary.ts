import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface LanguageServerBinary {
  /** Absolute path of the native TypeScript executable (tsc.exe). */
  exe: string;
  version: string;
}

/** Folder under the packaged app's resources that holds the TypeScript executable and its lib files. */
export const PACKAGED_TYPESCRIPT_DIR = "typescript";
const PLATFORM_PACKAGE = `@typescript/typescript-${process.platform}-${process.arch}`;

function readVersion(packageJson: string): string {
  try {
    const manifest = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Finds the native TypeScript compiler, which also serves as the language
 * server (`tsc --lsp --stdio`). Packaged builds carry it in resources/typescript;
 * development runs use the platform package installed with the repository.
 * Returns null when it is not available for this platform.
 */
export function resolveTypeScriptServer(options: { resourcesPath: string | null; resolve: (id: string) => string }): LanguageServerBinary | null {
  const exeName = process.platform === "win32" ? "tsc.exe" : "tsc";
  if (options.resourcesPath) {
    const dir = path.join(options.resourcesPath, PACKAGED_TYPESCRIPT_DIR);
    const exe = path.join(dir, exeName);
    if (existsSync(exe)) {
      return { exe, version: readVersion(path.join(dir, "package.json")) };
    }
  }
  try {
    const packageJson = options.resolve(`${PLATFORM_PACKAGE}/package.json`);
    const exe = path.join(path.dirname(packageJson), "lib", exeName);
    return existsSync(exe) ? { exe, version: readVersion(packageJson) } : null;
  } catch {
    return null;
  }
}
