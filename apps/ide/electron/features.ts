import { readFileSync } from "node:fs";

/**
 * Feature flags for work that is not part of the default experience yet.
 * Each flag is off unless the user turns it on in features.json (in the
 * settings folder) or the ORIGIN_STUDIO_FEATURES environment variable lists it.
 */
export interface FeatureFlags {
  /** ORIGIN Core adapter: link the open folder to an ORIGIN project (read-only). */
  originCore: boolean;
}

export const FEATURE_NAMES: Record<keyof FeatureFlags, string> = {
  originCore: "origin-core"
};

export const DEFAULT_FEATURES: FeatureFlags = { originCore: false };

/** Parses the comma-separated ORIGIN_STUDIO_FEATURES value. Unknown names are ignored. */
export function parseFeatureList(value: string | undefined): Partial<FeatureFlags> {
  const flags: Partial<FeatureFlags> = {};
  if (!value) {
    return flags;
  }
  const names = new Set(value.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean));
  for (const [key, name] of Object.entries(FEATURE_NAMES) as [keyof FeatureFlags, string][]) {
    if (names.has(name)) {
      flags[key] = true;
    }
  }
  return flags;
}

/** Parses features.json: an object whose keys are flag names (either spelling) and values booleans. */
export function parseFeatureFile(text: string): Partial<FeatureFlags> {
  const flags: Partial<FeatureFlags> = {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return flags;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return flags;
  }
  const record = raw as Record<string, unknown>;
  for (const [key, name] of Object.entries(FEATURE_NAMES) as [keyof FeatureFlags, string][]) {
    const value = record[name] ?? record[key];
    if (typeof value === "boolean") {
      flags[key] = value;
    }
  }
  return flags;
}

/** Environment variables win over the file so tests can force a flag. */
export function loadFeatureFlags(file: string, env: NodeJS.ProcessEnv): FeatureFlags {
  let fromFile: Partial<FeatureFlags> = {};
  try {
    fromFile = parseFeatureFile(readFileSync(file, "utf8"));
  } catch {
    // No file: every flag stays at its default.
  }
  return { ...DEFAULT_FEATURES, ...fromFile, ...parseFeatureList(env.ORIGIN_STUDIO_FEATURES) };
}

export function enabledFeatureNames(flags: FeatureFlags): string[] {
  return (Object.keys(FEATURE_NAMES) as (keyof FeatureFlags)[]).filter((key) => flags[key]).map((key) => FEATURE_NAMES[key]);
}
