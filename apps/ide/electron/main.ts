import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, app, dialog, safeStorage, screen, session } from "electron";
import pty from "node-pty";
import {
  IpcChannel,
  fail,
  ok,
  type AppInfo,
  type MenuCommand,
  type OriginAdapters,
  type OriginConnectionState,
  type OriginLinkState,
  type OriginWorkspaceState,
  type Result,
  type WorkspaceInfo
} from "@studio/contracts";
import { OriginConnection, createLinkFileCoreAdapter, createMockSectorAdapters, createOfflineAdapters } from "@studio/origin-adapter";
import { resolveUserDataDir } from "./user-data.js";
import { NONE_ORIGIN_TRANSPORT, createOriginTransport, loadOriginConfig, type OriginConfig } from "./origin-config.js";
import { createSafeStorageVault } from "./origin-vault.js";
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

app.setName("LIKHA");
// ORIGIN_STUDIO_USER_DATA lets automated tests run with isolated settings; otherwise the
// settings folder keeps its pre-rename name so existing settings and credentials survive.
app.setPath("userData", resolveUserDataDir(app.getPath("appData"), process.env));
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
  dialog.showErrorBox("LIKHA encountered an error", `${error.message}\n\nDetails were written to the log in ${app.getPath("userData")}.`);
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

let adapters: OriginAdapters = createOfflineAdapters();
let originConfig: OriginConfig = { transport: "none", baseUrl: null, mockOffline: false, problem: null };
/** The ORIGIN connection; null while the origin-core feature is off. */
let connection: OriginConnection | null = null;

/**
 * Assembles the ORIGIN side for this run: the transport named in origin.json,
 * the encrypted credential vault, the connection and the sector adapters.
 * With the feature off everything stays offline and nothing is read.
 */
function setUpOrigin(flags: FeatureFlags): void {
  if (!flags.originCore) {
    adapters = createOfflineAdapters();
    connection = null;
    return;
  }
  originConfig = loadOriginConfig(path.join(app.getPath("userData"), "origin.json"), process.env);
  if (originConfig.problem) log(`ORIGIN configuration: ${originConfig.problem}`);
  const transport = createOriginTransport(originConfig);
  if (!transport.ok) log(`ORIGIN transport unavailable: ${transport.error.message}`);
  const wire = transport.ok ? transport.value : NONE_ORIGIN_TRANSPORT;
  const vault = createSafeStorageVault({ file: path.join(app.getPath("userData"), "origin-credential.bin"), cipher: safeStorage, log });
  connection = new OriginConnection({
    transport: wire,
    vault,
    log,
    onChange: (state) => {
      send(IpcChannel.OriginConnectionChanged, state);
      // The link's verification depends on the connection; recompute it for the next workspace query.
      originState = null;
    }
  });
  adapters = {
    core: createLinkFileCoreAdapter({ readWorkspaceFile, transport: wire }),
    ...createMockSectorAdapters()
  };
  log(`ORIGIN Core: transport ${wire.kind} (${wire.target}); credential storage ${vault.description}; sector adapters are mocks`);
}

async function describeOrigin(current: WorkspaceService): Promise<OriginWorkspaceState> {
  if (!features.originCore || !connection) {
    return { feature: "off" };
  }
  const found = await adapters.core.findLink(current.root);
  let link: OriginLinkState;
  if (!found.ok) {
    link = { kind: "error", detail: found.error.message };
  } else if (found.value === null) {
    link = { kind: "none", detail: `This folder has no .origin/project.json link. ${adapters.core.status().detail}` };
  } else {
    const resolved = await adapters.core.resolveProject(found.value, connection.credentialForRequests());
    const resolution = resolved.ok ? resolved.value : { status: "unverified" as const, reason: "unavailable" as const, detail: resolved.error.message };
    const sync = resolution.status === "verified" ? await adapters.core.syncState(found.value.projectId) : null;
    link = { kind: "linked", link: found.value, resolution, sync: sync?.ok ? sync.value : null };
  }
  return { feature: "on", connection: connection.state, link };
}

const originApi = {
  connection: (): OriginConnectionState => connection?.state ?? { state: "disconnected", detail: "The origin-core feature is off." },
  connect: async (secret: string) => (connection ? connection.connect(secret) : fail("NOT_CONNECTED", "The origin-core feature is off.")),
  disconnect: async (): Promise<Result<void>> => {
    if (!connection) return fail("NOT_CONNECTED", "The origin-core feature is off.");
    await connection.disconnect();
    return ok(undefined);
  },
  refresh: async (): Promise<Result<OriginConnectionState>> => (connection ? ok(await connection.refresh()) : fail("NOT_CONNECTED", "The origin-core feature is off."))
};

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
    mainWindow?.setTitle(`${path.basename(workspace.root)} - LIKHA`);
    log(`Opened workspace ${workspace.root}`);
    const state = await describeOrigin(workspace);
    if (workspace === opened.value) {
      originState = state;
      if (state.feature === "on") {
        const { link } = state;
        log(
          `ORIGIN link: ${
            link.kind === "linked"
              ? `${link.link.projectId} ${link.resolution.status}${link.resolution.status === "verified" ? ` as "${link.resolution.project.name}"` : ` (${link.resolution.reason})`}`
              : link.kind
          }`
        );
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
        const result = await dialog.showMessageBox(mainWindow ?? undefined!, { title: "LIKHA", noLink: true, ...options });
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
    title: "LIKHA",
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
    terminals.killAll({ wait: true });
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
      title: "LIKHA",
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
    dialog.showErrorBox("LIKHA could not start", `The interface failed to load (${description}).${isDev ? " Is the dev server running?" : " Try running npm run build again."}`);
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
    terminals.killAll({ wait: true });
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
    setUpOrigin(features);
    const shells = detectShells();
    const enabled = enabledFeatureNames(features);
    log(
      `Starting LIKHA ${app.getVersion()} (${isDev ? "development" : "production"}); shells: ${shells.map((s) => s.id).join(", ") || "none"}; features: ${enabled.join(", ") || "none"}`
    );

    const appInfo: AppInfo = {
      productName: "LIKHA",
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
      origin: originApi,
      confirmClose: (allow) => {
        if (allow && mainWindow) {
          closeAllowed = true;
          mainWindow.close();
        }
      },
      log
    });

    // A stored credential is verified in the background; the interface hears about the outcome.
    void connection?.restore();

    const initial = initialWorkspaceFolder();
    if (initial) {
      const opened = await openWorkspace(initial);
      if (!opened.ok) {
        log(`Could not reopen ${initial}: ${opened.error.message}`);
      }
    }

    mainWindow = createWindow();
    if (workspace) {
      mainWindow.setTitle(`${path.basename(workspace.root)} - LIKHA`);
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
