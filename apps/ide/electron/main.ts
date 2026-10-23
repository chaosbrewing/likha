import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, app, dialog, screen, session } from "electron";
import pty from "node-pty";
import {
  IpcChannel,
  type AppInfo,
  type MenuCommand,
  type OriginAdapters,
  type OriginWorkspaceState,
  type Result,
  type WorkspaceInfo
} from "@studio/contracts";
import { createLinkFileCoreAdapter, createOfflineAdapters } from "@studio/origin-adapter";
import { WorkspaceService, listSourceFiles, watchWorkspace, type WorkspaceWatcher } from "@studio/workspace";
import { loadAppState, saveAppState, type AppState } from "./app-state.js";
import { registerAppScheme, serveRenderer } from "./app-protocol.js";
import { enabledFeatureNames, loadFeatureFlags, type FeatureFlags } from "./features.js";
import { moveToTrash, registerIpc } from "./ipc.js";
import { LanguageServerManager } from "./language-server.js";
import { buildMenu } from "./menu.js";
import { APP_ORIGIN, developmentCsp, parseDevServerUrl } from "./security.js";
import { detectShells } from "./shells.js";
import { TerminalManager, killProcessTree, type SpawnPty } from "./terminal-manager.js";
import { resolveTypeScriptServer } from "./typescript-binary.js";
import { checkForUpdates } from "./updates.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const devServerUrl = parseDevServerUrl(process.env.ORIGIN_STUDIO_DEV_SERVER_URL);
const isDev = devServerUrl !== null;

app.setName("Origin Studio");
if (process.env.ORIGIN_STUDIO_USER_DATA) {
  // Lets automated tests run with isolated settings.
  app.setPath("userData", path.resolve(process.env.ORIGIN_STUDIO_USER_DATA));
}
app.enableSandbox();
registerAppScheme();

/* ---------- logging and error reporting ---------- */

let logFile: string | null = null;
function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (isDev) {
    process.stdout.write(line);
  }
  try {
    if (logFile === null) {
      const dir = path.join(app.getPath("userData"), "logs");
      mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "main.log");
    }
    appendFileSync(logFile, line);
  } catch {
    // Logging must never take the app down.
  }
}

process.on("uncaughtException", (error) => {
  log(`Uncaught exception: ${error.stack ?? error.message}`);
  dialog.showErrorBox("Origin Studio encountered an error", `${error.message}\n\nDetails were written to the log in ${app.getPath("userData")}.`);
});
process.on("unhandledRejection", (reason) => {
  log(`Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});

/* ---------- state ---------- */

let mainWindow: BrowserWindow | null = null;
let workspace: WorkspaceService | null = null;
let watcher: WorkspaceWatcher | null = null;
let closeAllowed = false;
let appState: AppState;
let features: FeatureFlags = { originCore: false };
let originState: OriginWorkspaceState | null = null;
const stateFile = () => path.join(app.getPath("userData"), "app-state.json");
const featuresFile = () => path.join(app.getPath("userData"), "features.json");

function persistState(): void {
  try {
    saveAppState(stateFile(), appState);
  } catch (error) {
    log(`Could not save app state: ${String(error)}`);
  }
}

function send(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// useConptyDll: node-pty's bundled ConPTY. Its kill path needs no child_process.fork(),
// which the packaged app's runAsNode fuse forbids.
const spawnPty: SpawnPty = (file, args, options) =>
  pty.spawn(file, args, { ...options, ...(process.platform === "win32" ? { useConptyDll: true } : {}) });
const terminals = new TerminalManager(
  spawnPty,
  {
    data: (id, data) => send(IpcChannel.TerminalData, { id, data }),
    exit: (id, exitCode) => send(IpcChannel.TerminalExit, { id, exitCode })
  },
  process.env,
  killProcessTree
);

/* ---------- language server ---------- */

const language = new LanguageServerManager({
  binary: () =>
    resolveTypeScriptServer({
      resourcesPath: app.isPackaged ? process.resourcesPath : null,
      resolve: (id) => require.resolve(id)
    }),
  listSourceFiles,
  onStatus: (status) => send(IpcChannel.LanguageStatusChanged, status),
  onProblems: (event) => send(IpcChannel.LanguageProblems, event),
  log
});

/* ---------- ORIGIN adapters ---------- */

/** Reads a workspace file for the ORIGIN Core adapter through the usual path confinement. */
async function readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string | null> {
  const current = workspace;
  if (!current || current.root !== workspaceRoot) {
    return null;
  }
  const result = await current.readFile(relativePath);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") return null;
    throw new Error(result.error.message);
  }
  if (result.value.kind !== "text") {
    throw new Error(`${relativePath} is not a text file.`);
  }
  return result.value.content;
}

function createAdapters(flags: FeatureFlags): OriginAdapters {
  const adapters = createOfflineAdapters();
  if (flags.originCore) {
    adapters.core = createLinkFileCoreAdapter({ readWorkspaceFile });
  }
  return adapters;
}

let adapters: OriginAdapters = createOfflineAdapters();

async function describeOrigin(current: WorkspaceService): Promise<OriginWorkspaceState> {
  if (!features.originCore) {
    return { feature: "off" };
  }
  const status = adapters.core.status();
  const found = await adapters.core.findLinkedProject(current.root);
  if (!found.ok) {
    return { feature: "on", link: "error", detail: found.error.message };
  }
  if (found.value === null) {
    return { feature: "on", link: "none", detail: `Not linked to an ORIGIN project. ${status.detail}` };
  }
  const sync = await adapters.core.syncState(found.value.id);
  return { feature: "on", link: "linked", detail: status.detail, project: found.value, sync: sync.ok ? sync.value : null };
}

async function workspaceInfo(refresh: boolean): Promise<WorkspaceInfo | null> {
  const current = workspace;
  if (!current) {
    return null;
  }
  if (refresh || originState === null) {
    const state = await describeOrigin(current);
    if (workspace === current) originState = state;
  }
  return { ...current.info(), origin: originState ?? { feature: "off" } };
}

async function openWorkspace(folder: string): Promise<Result<WorkspaceService>> {
  const opened = await WorkspaceService.open(folder, { trash: moveToTrash });
  if (opened.ok) {
    workspace = opened.value;
    originState = null;
    watcher?.close();
    const root = workspace.root;
    watcher = watchWorkspace(
      root,
      (event) => {
        send(IpcChannel.WorkspaceChanged, event);
        language.workspaceChanged();
      },
      { onError: (error) => log(`Stopped watching ${root}: ${error.message}`) }
    );
    appState.lastWorkspace = workspace.root;
    persistState();
    mainWindow?.setTitle(`${path.basename(workspace.root)} - Origin Studio`);
    log(`Opened workspace ${workspace.root}`);
    const state = await describeOrigin(workspace);
    if (workspace === opened.value) {
      originState = state;
      if (state.feature === "on") {
        log(`ORIGIN Core: ${state.link === "linked" ? `linked to "${state.project.name}" (${state.project.id}, revision ${state.project.revision})` : state.detail}`);
      }
    }
    void language.start(root);
  }
  return opened;
}

function initialWorkspaceFolder(): string | null {
  const argument = process.argv.find((arg) => arg.startsWith("--folder="));
  const candidate = argument ? argument.slice("--folder=".length) : appState.lastWorkspace;
  if (!candidate) {
    return null;
  }
  try {
    return statSync(candidate).isDirectory() ? path.resolve(candidate) : null;
  } catch {
    return null;
  }
}

/* ---------- updates (manual, user-driven) ---------- */

let updateCheckRunning = false;
async function runUpdateCheck(): Promise<void> {
  if (updateCheckRunning) return;
  updateCheckRunning = true;
  try {
    const outcome = await checkForUpdates({
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      loadUpdater: async () => {
        try {
          const { autoUpdater } = await import("electron-updater");
          autoUpdater.logger = {
            info: (message: unknown) => log(`Updater: ${String(message)}`),
            warn: (message: unknown) => log(`Updater warning: ${String(message)}`),
            error: (message: unknown) => log(`Updater error: ${String(message)}`),
            debug: () => undefined
          };
          return autoUpdater;
        } catch (error) {
          log(`electron-updater could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      },
      ask: async (options) => {
        const result = await dialog.showMessageBox(mainWindow ?? undefined!, { title: "Origin Studio", noLink: true, ...options });
        return result.response;
      },
      requestClose: () => mainWindow?.close(),
      log
    });
    log(`Update check: ${outcome}`);
  } finally {
    updateCheckRunning = false;
  }
}

/* ---------- window ---------- */

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...appState.window.bounds,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: "Origin Studio",
    icon: path.join(here, "icon.png"),
    backgroundColor: "#1b1d23",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev || process.env.ORIGIN_STUDIO_DEVTOOLS === "1"
    }
  });
  if (appState.window.maximized) {
    win.maximize();
  }
  win.once("ready-to-show", () => win.show());

  win.on("close", (event) => {
    if (!closeAllowed && !win.webContents.isCrashed() && !win.webContents.isLoading()) {
      // Ask the interface first: it may hold unsaved changes.
      event.preventDefault();
      send(IpcChannel.AppCloseRequested);
      return;
    }
    appState.window = {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized()
    };
    persistState();
    terminals.killAll();
    language.terminate();
  });
  win.on("closed", () => {
    mainWindow = null;
  });

  win.webContents.on("render-process-gone", async (_event, details) => {
    log(`Renderer process gone: ${details.reason}`);
    closeAllowed = true; // Nothing left to ask; never trap the user.
    const choice = await dialog.showMessageBox(win, {
      type: "error",
      title: "Origin Studio",
      message: "The editor window stopped unexpectedly.",
      detail: "Files saved before this point are safe on disk. Unsaved changes in open tabs may be lost.",
      buttons: ["Reload", "Close"],
      defaultId: 0
    });
    if (choice.response === 0 && !win.isDestroyed()) {
      closeAllowed = false;
      win.reload();
    } else if (!win.isDestroyed()) {
      win.close();
    }
  });
  win.webContents.on("did-finish-load", () => log(`Interface loaded from ${win.webContents.getURL()}`));
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    log(`Failed to load ${url}: ${code} ${description}`);
    dialog.showErrorBox("Origin Studio could not start", `The interface failed to load (${description}).${isDev ? " Is the dev server running?" : " Try running npm run build again."}`);
  });

  void win.loadURL(isDev ? `${devServerUrl}/` : `${APP_ORIGIN}/index.html`);
  return win;
}

/* ---------- lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  app.on("before-quit", () => {
    terminals.killAll();
    language.terminate();
    watcher?.close();
  });
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    if (isDev && devServerUrl) {
      session.defaultSession.webRequest.onHeadersReceived({ urls: [`${devServerUrl}/*`] }, (details, callback) => {
        callback({
          responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [developmentCsp(devServerUrl)] }
        });
      });
    } else {
      serveRenderer(path.join(here, "..", "renderer"));
    }

    appState = loadAppState(stateFile(), screen.getAllDisplays().map((display) => display.workArea));
    features = loadFeatureFlags(featuresFile(), process.env);
    adapters = createAdapters(features);
    const shells = detectShells();
    const enabled = enabledFeatureNames(features);
    log(
      `Starting Origin Studio ${app.getVersion()} (${isDev ? "development" : "production"}); shells: ${shells.map((s) => s.id).join(", ") || "none"}; features: ${enabled.join(", ") || "none"}`
    );

    const appInfo: AppInfo = {
      productName: "Origin Studio",
      version: app.getVersion(),
      platform: process.platform,
      versions: {
        electron: process.versions.electron ?? "",
        chrome: process.versions.chrome ?? "",
        node: process.versions.node
      }
    };

    registerIpc({
      window: () => mainWindow,
      devServerUrl,
      appInfo,
      shells,
      terminals,
      workspace: () => workspace,
      workspaceInfo,
      openWorkspace,
      language,
      confirmClose: (allow) => {
        if (allow && mainWindow) {
          closeAllowed = true;
          mainWindow.close();
        }
      },
      log
    });

    const initial = initialWorkspaceFolder();
    if (initial) {
      const opened = await openWorkspace(initial);
      if (!opened.ok) {
        log(`Could not reopen ${initial}: ${opened.error.message}`);
      }
    }

    mainWindow = createWindow();
    if (workspace) {
      mainWindow.setTitle(`${path.basename(workspace.root)} - Origin Studio`);
    }
    Menu.setApplicationMenu(
      buildMenu((command: MenuCommand) => send(IpcChannel.MenuCommand, command), {
        dev: isDev,
        quit: () => mainWindow?.close(),
        checkForUpdates: () => void runUpdateCheck()
      })
    );
  });
}
