import { readFileSync } from "node:fs";

let cached: string | undefined;

/**
 * Reads the version from this package's package.json, which sits one level
 * above both src/ (development) and dist/ (installed build).
 */
export function getCliVersion(): string {
  if (cached === undefined) {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const manifest: unknown = JSON.parse(readFileSync(manifestUrl, "utf8"));
    const version =
      typeof manifest === "object" && manifest !== null && "version" in manifest
        ? manifest.version
        : undefined;

    if (typeof version !== "string") {
      throw new Error("Could not read the CLI version from package.json.");
    }
    cached = version;
  }
  return cached;
}
