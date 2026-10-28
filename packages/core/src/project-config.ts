/** Key inside a project's package.json that marks it as a LIKHA project. */
export const PROJECT_CONFIG_KEY = "originStudio";
export const PROJECT_SCHEMA_VERSION = 1;

/** Files every LIKHA project is expected to contain. */
export const REQUIRED_PROJECT_FILES = [
  "package.json",
  "tsconfig.json",
  "src/index.ts"
] as const;

export interface ProjectConfig {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  language: "typescript";
}

export type ProjectConfigCheck =
  | { state: "none" }
  | { state: "invalid"; problems: string[] }
  | { state: "valid"; name: string; config: ProjectConfig };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates parsed package.json content. Returns "none" when the manifest has
 * no LIKHA section, so ordinary Node.js projects are not reported as
 * broken LIKHA projects.
 */
export function checkProjectManifest(manifest: unknown): ProjectConfigCheck {
  if (!isRecord(manifest)) {
    return { state: "invalid", problems: ["package.json must contain a JSON object."] };
  }

  if (!(PROJECT_CONFIG_KEY in manifest)) {
    return { state: "none" };
  }

  const problems: string[] = [];
  const config = manifest[PROJECT_CONFIG_KEY];

  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    problems.push('package.json is missing a "name".');
  }

  if (!isRecord(config)) {
    problems.push(`"${PROJECT_CONFIG_KEY}" in package.json must be an object.`);
  } else {
    if (config.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      problems.push(
        `"${PROJECT_CONFIG_KEY}.schemaVersion" must be ${PROJECT_SCHEMA_VERSION}.`
      );
    }
    if (config.language !== "typescript") {
      problems.push(`"${PROJECT_CONFIG_KEY}.language" must be "typescript".`);
    }
  }

  if (problems.length > 0) {
    return { state: "invalid", problems };
  }

  return {
    state: "valid",
    name: manifest.name as string,
    config: { schemaVersion: PROJECT_SCHEMA_VERSION, language: "typescript" }
  };
}
