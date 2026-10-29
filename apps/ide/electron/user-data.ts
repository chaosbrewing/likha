import path from "node:path";

/**
 * The settings folder name used before the rename to LIKHA. Electron derives the
 * default folder from the app name, so renaming the app alone would orphan
 * app-state.json, features.json, origin.json and the encrypted ORIGIN credential
 * (whose key material lives in the same folder). The folder is pinned instead.
 */
export const SETTINGS_DIRNAME = "Origin Studio";

/** Where settings live: the test override if set, otherwise the pinned folder inside appData. */
export function resolveUserDataDir(appDataDir: string, env: NodeJS.ProcessEnv): string {
  const override = env.ORIGIN_STUDIO_USER_DATA;
  return override ? path.resolve(override) : path.join(appDataDir, SETTINGS_DIRNAME);
}
