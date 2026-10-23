/*
 * "Check for Updates…": a manual, user-driven update check through
 * electron-updater. Nothing is contacted unless the user asks, nothing is
 * downloaded or installed without a confirmation, and a build without an
 * update feed (see scripts/package.mjs) simply says so.
 */
import type { AppUpdater, UpdateInfo } from "electron-updater";

export interface UpdateDialogOptions {
  type: "info" | "question" | "error";
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

export interface UpdateCheckerDeps {
  currentVersion: string;
  /** True for the installed/packaged app; development runs cannot update. */
  packaged: boolean;
  /** Loads electron-updater lazily (it is only needed on request). Null when it cannot be loaded. */
  loadUpdater(): Promise<AppUpdater | null>;
  /** Shows a dialog and resolves to the index of the chosen button. */
  ask(options: UpdateDialogOptions): Promise<number>;
  /** Closes the window; the update installs when the app quits. */
  requestClose(): void;
  log(message: string): void;
}

export type UpdateOutcome = "unsupported" | "not-configured" | "failed" | "up-to-date" | "declined" | "downloaded" | "installing";

export const UPDATE_MESSAGES = {
  unsupported: "Updates are available in the installed version of Origin Studio only.",
  notConfigured: "This build of Origin Studio has no update feed configured.",
  upToDate: (version: string) => `Origin Studio ${version} is the latest version.`
};

function looksUnconfigured(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /app-update\.yml|ENOENT|No publish|not configured|dev-app-update/i.test(text);
}

function waitForDownload(updater: AppUpdater): Promise<UpdateInfo> {
  return new Promise((resolve, reject) => {
    const done = (info: UpdateInfo) => {
      cleanup();
      resolve(info);
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      updater.removeListener("update-downloaded", done);
      updater.removeListener("error", failed);
    };
    updater.once("update-downloaded", done);
    updater.once("error", failed);
  });
}

/**
 * Runs one update check with the user in the loop at every step. Resolves
 * to what happened, mostly for tests and the log.
 */
export async function checkForUpdates(deps: UpdateCheckerDeps): Promise<UpdateOutcome> {
  const info = (message: string, detail = "") => deps.ask({ type: "info", message, detail, buttons: ["OK"], defaultId: 0, cancelId: 0 });

  if (!deps.packaged) {
    await info(UPDATE_MESSAGES.unsupported, "Run the installer from a release to get a version that can update itself.");
    return "unsupported";
  }
  const updater = await deps.loadUpdater();
  if (!updater) {
    await info(UPDATE_MESSAGES.notConfigured);
    return "not-configured";
  }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;

  let available: UpdateInfo | null;
  try {
    const result = await updater.checkForUpdates();
    const candidate = result?.updateInfo ?? null;
    available = candidate && result?.isUpdateAvailable !== false && candidate.version !== deps.currentVersion ? candidate : null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.log(`Update check failed: ${detail}`);
    if (looksUnconfigured(error)) {
      await info(UPDATE_MESSAGES.notConfigured);
      return "not-configured";
    }
    await deps.ask({
      type: "error",
      message: "Could not check for updates.",
      detail: `${detail}\n\nOrigin Studio keeps working; try again later.`,
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0
    });
    return "failed";
  }

  if (!available) {
    await info(UPDATE_MESSAGES.upToDate(deps.currentVersion));
    return "up-to-date";
  }

  const download = await deps.ask({
    type: "question",
    message: `Origin Studio ${available.version} is available.`,
    detail: `You have ${deps.currentVersion}. Download it now? Nothing changes until you choose to install it.`,
    buttons: ["Download", "Not Now"],
    defaultId: 0,
    cancelId: 1
  });
  if (download !== 0) {
    return "declined";
  }

  try {
    const downloaded = waitForDownload(updater);
    await updater.downloadUpdate();
    await downloaded;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.log(`Update download failed: ${detail}`);
    await deps.ask({ type: "error", message: "The update could not be downloaded.", detail, buttons: ["OK"], defaultId: 0, cancelId: 0 });
    return "failed";
  }
  deps.log(`Downloaded Origin Studio ${available.version}`);

  const install = await deps.ask({
    type: "question",
    message: `Origin Studio ${available.version} is ready to install.`,
    detail: "Origin Studio closes (asking about unsaved changes first) and the installer runs. Choose Later to keep working; the update then installs when you next close Origin Studio.",
    buttons: ["Restart and Install", "Later"],
    defaultId: 0,
    cancelId: 1
  });
  updater.autoInstallOnAppQuit = true;
  if (install !== 0) {
    return "downloaded";
  }
  deps.requestClose();
  return "installing";
}
