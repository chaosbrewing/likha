import { appendFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, app, dialog, screen, session } from "electron";
import pty from "node-pty";
import { IpcChannel, type AppInfo, type MenuCommand, type Result } from "@studio/contracts";
import { WorkspaceService, watchWorkspace, type WorkspaceWatcher } from "@studio/workspace";
import { loadAppState, saveAppState, type AppState } from "./app-state.js";
import { registerAppScheme, serveRenderer } from "./app-protocol.js";
import { moveToTrash, registerIpc } from "./ipc.js";
import { buildMenu } from "./menu.js";
import { APP_ORIGIN, developmentCsp, parseDevServerUrl } from "./security.js";
import { detectShells } from "./shells.js";
import { TerminalManager, type SpawnPty } from "./terminal-manager.js";

const here = path.dirname(fileURLToPath(import.meta.url));
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
const stateFile = () => path.join(app.getPath("userData"), "app-state.json");

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

const spawnPty: SpawnPty = (file, args, options) => pty.spawn(file, args, options);
const terminals = new TerminalManager(spawnPty, {
  data: (id, data) => send(IpcChannel.TerminalData, { id, data }),
  exit: (id, exitCode) => send(IpcChannel.TerminalExit, { id, exitCode })
});

async function openWorkspace(folder: string): Promise<Result<WorkspaceService>> {
  const opened = await WorkspaceService.open(folder, { trash: moveToTrash });
  if (opened.ok) {
    workspace = opened.value;
    watcher?.close();
    const root = workspace.root;
    watcher = watchWorkspace(root, (event) => send(IpcChannel.WorkspaceChanged, event), {
      onError: (error) => log(`Stopped watching ${root}: ${error.message}`)
    });
    appState.lastWorkspace = workspace.root;
    persistState();
    mainWindow?.setTitle(`${path.basename(workspace.root)} - Origin Studio`);
    log(`Opened workspace ${workspace.root}`);
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
    const shells = detectShells();
    log(`Starting Origin Studio ${app.getVersion()} (${isDev ? "development" : "production"}); shells: ${shells.map((s) => s.id).join(", ") || "none"}`);

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
      openWorkspace,
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
        quit: () => mainWindow?.close()
      })
    );
  });
}
