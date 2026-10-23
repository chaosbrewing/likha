import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { AppUpdater, UpdateInfo } from "electron-updater";
import { UPDATE_MESSAGES, checkForUpdates, type UpdateDialogOptions } from "../electron/updates.ts";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  checks = 0;
  downloads = 0;
  constructor(
    private readonly remote: string | Error,
    private readonly downloadFails = false
  ) {
    super();
  }
  async checkForUpdates() {
    this.checks++;
    if (this.remote instanceof Error) throw this.remote;
    const updateInfo = { version: this.remote } as UpdateInfo;
    return { updateInfo, isUpdateAvailable: this.remote !== "0.3.0" };
  }
  async downloadUpdate() {
    this.downloads++;
    setTimeout(() => (this.downloadFails ? this.emit("error", new Error("network down")) : this.emit("update-downloaded", { version: this.remote })), 5);
    return [];
  }
}

function harness(updater: FakeUpdater | null, answers: number[], packaged = true) {
  const dialogs: UpdateDialogOptions[] = [];
  const logs: string[] = [];
  let closeRequests = 0;
  const deps = {
    currentVersion: "0.3.0",
    packaged,
    loadUpdater: async () => updater as unknown as AppUpdater | null,
    ask: async (options: UpdateDialogOptions) => {
      dialogs.push(options);
      return answers.shift() ?? options.cancelId;
    },
    requestClose: () => {
      closeRequests++;
    },
    log: (message: string) => logs.push(message)
  };
  return { deps, dialogs, logs, closeRequests: () => closeRequests };
}

test("development runs and builds without a feed explain themselves instead of contacting anything", async () => {
  const dev = harness(new FakeUpdater("9.9.9"), [], false);
  assert.equal(await checkForUpdates(dev.deps), "unsupported");
  assert.equal(dev.dialogs[0]?.message, UPDATE_MESSAGES.unsupported);

  const none = harness(null, []);
  assert.equal(await checkForUpdates(none.deps), "not-configured");
  assert.equal(none.dialogs[0]?.message, UPDATE_MESSAGES.notConfigured);

  const missingYml = harness(new FakeUpdater(new Error("ENOENT: no such file or directory, open 'C:\\\\app\\\\resources\\\\app-update.yml'")), []);
  assert.equal(await checkForUpdates(missingYml.deps), "not-configured");
});

test("an up-to-date install is told so, and a failed check never downloads", async () => {
  const same = new FakeUpdater("0.3.0");
  const current = harness(same, []);
  assert.equal(await checkForUpdates(current.deps), "up-to-date");
  assert.equal(current.dialogs[0]?.message, UPDATE_MESSAGES.upToDate("0.3.0"));
  assert.equal(same.autoDownload, false, "the updater never downloads on its own");
  assert.equal(same.autoInstallOnAppQuit, false);
  assert.equal(same.downloads, 0);

  const failing = new FakeUpdater(new Error("getaddrinfo ENOTFOUND updates.example"));
  const failed = harness(failing, []);
  assert.equal(await checkForUpdates(failed.deps), "failed");
  assert.equal(failed.dialogs[0]?.type, "error");
  assert.match(failed.logs[0] ?? "", /ENOTFOUND/);
});

test("the user decides about download and install; the install happens only when the app closes", async () => {
  const declined = harness(new FakeUpdater("0.4.0"), [1]);
  assert.equal(await checkForUpdates(declined.deps), "declined");
  assert.match(declined.dialogs[0]?.message ?? "", /0\.4\.0 is available/);

  const later = new FakeUpdater("0.4.0");
  const deferred = harness(later, [0, 1]);
  assert.equal(await checkForUpdates(deferred.deps), "downloaded");
  assert.equal(later.downloads, 1);
  assert.equal(later.autoInstallOnAppQuit, true, "a downloaded update installs on the next quit");
  assert.equal(deferred.closeRequests(), 0);

  const now = new FakeUpdater("0.4.0");
  const installing = harness(now, [0, 0]);
  assert.equal(await checkForUpdates(installing.deps), "installing");
  assert.equal(installing.closeRequests(), 1, "closing goes through the normal unsaved-changes guard");
  assert.equal(now.autoInstallOnAppQuit, true);

  const broken = new FakeUpdater("0.4.0", true);
  const failedDownload = harness(broken, [0]);
  assert.equal(await checkForUpdates(failedDownload.deps), "failed");
  assert.equal(failedDownload.dialogs.at(-1)?.message, "The update could not be downloaded.");
  assert.equal(broken.autoInstallOnAppQuit, false);
});
