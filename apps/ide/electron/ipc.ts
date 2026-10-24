import path from "node:path";
import { BrowserWindow, dialog, ipcMain, shell as electronShell, type IpcMainInvokeEvent } from "electron";
import {
  IpcChannel,
  fail,
  ok,
  type AppInfo,
  type OriginConnectionState,
  type OriginIdentity,
  type Result,
  type WorkspaceInfo
} from "@studio/contracts";
import { WorkspaceService, scaffoldProject } from "@studio/workspace";
import {
  ArgumentError,
  parseConfirmClose,
  parseCreate,
  parseDelete,
  parseLanguageChange,
  parseLanguageOpen,
  parseLanguageRequest,
  parseNoArgs,
  parsePath,
  parseProjectName,
  parseRename,
  parseSaveAs,
  parseSecret,
  parseTerminalCreate,
  parseTerminalId,
  parseTerminalResize,
  parseTerminalWrite,
  parseWrite
} from "./ipc-validation.js";
import type { LanguageServerManager } from "./language-server.js";
import { isTrustedRendererUrl } from "./security.js";
import { publicShellInfo, type ResolvedShell } from "./shells.js";
import type { TerminalManager } from "./terminal-manager.js";

export interface IpcContext {
  window(): BrowserWindow | null;
  devServerUrl: string | null;
  appInfo: AppInfo;
  shells: ResolvedShell[];
  terminals: TerminalManager;
  workspace(): WorkspaceService | null;
  /**
   * Describes the open workspace for the interface, including its ORIGIN
   * link. `refresh` re-reads the link; otherwise the state from opening is used.
   */
  workspaceInfo(refresh: boolean): Promise<WorkspaceInfo | null>;
  /** Opens a folder as the workspace and remembers it for the next launch. */
  openWorkspace(folder: string): Promise<Result<WorkspaceService>>;
  language: LanguageServerManager;
  /** The ORIGIN connection; every call answers NOT_CONNECTED when the origin-core feature is off. */
  origin: {
    connection(): OriginConnectionState;
    connect(secret: string): Promise<Result<OriginIdentity>>;
    disconnect(): Promise<Result<void>>;
    refresh(): Promise<Result<OriginConnectionState>>;
  };
  confirmClose(allow: boolean): void;
  log(message: string): void;
}

function trustedSender(event: IpcMainInvokeEvent, context: IpcContext): boolean {
  const win = context.window();
  const frame = event.senderFrame;
  return (
    win !== null &&
    event.sender === win.webContents &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    isTrustedRendererUrl(frame.url, context.devServerUrl)
  );
}

/**
 * Registers one handler per channel. Each handler checks the sender, parses
 * its arguments, and always resolves to a Result, never a thrown error.
 */
export function registerIpc(context: IpcContext): void {
  function handle<P>(channel: string, parse: (args: unknown[]) => P, run: (params: P) => Promise<Result<unknown>> | Result<unknown>) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!trustedSender(event, context)) {
        context.log(`Refused IPC "${channel}" from an untrusted sender.`);
        return fail("UNTRUSTED_SENDER", "Request refused.");
      }
      let params: P;
      try {
        params = parse(args);
      } catch (error) {
        if (error instanceof ArgumentError) {
          return fail("INVALID_ARGUMENT", error.message);
        }
        throw error;
      }
      try {
        return await run(params);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        context.log(`IPC "${channel}" failed: ${detail}`);
        return fail("UNKNOWN", `Something went wrong: ${detail}`);
      }
    });
  }

  function withWorkspace<T>(run: (workspace: WorkspaceService) => Promise<Result<T>> | Result<T>): Promise<Result<T>> | Result<T> {
    const workspace = context.workspace();
    return workspace ? run(workspace) : fail("NO_WORKSPACE", "Open a folder first.");
  }

  async function describe(refresh = true): Promise<Result<WorkspaceInfo>> {
    const info = await context.workspaceInfo(refresh);
    return info ? ok(info) : fail("NO_WORKSPACE", "Open a folder first.");
  }

  /* ---------- app ---------- */

  handle(IpcChannel.AppInfo, parseNoArgs, () => ok(context.appInfo));
  handle(IpcChannel.AppConfirmClose, parseConfirmClose, (allow) => {
    context.confirmClose(allow);
    return ok(undefined);
  });

  /* ---------- workspace ---------- */

  handle(IpcChannel.WorkspaceOpenDialog, parseNoArgs, async (): Promise<Result<WorkspaceInfo | null>> => {
    const win = context.window();
    if (!win) {
      return fail("UNKNOWN", "No window is open.");
    }
    const picked = await dialog.showOpenDialog(win, {
      title: "Open Folder",
      properties: ["openDirectory", "createDirectory"]
    });
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) {
      return ok(null);
    }
    const opened = await context.openWorkspace(folder);
    return opened.ok ? describe() : opened;
  });

  handle(IpcChannel.WorkspaceNewProject, parseProjectName, async (name): Promise<Result<WorkspaceInfo | null>> => {
    const win = context.window();
    if (!win) {
      return fail("UNKNOWN", "No window is open.");
    }
    const picked = await dialog.showOpenDialog(win, {
      title: `Choose where to create "${name}"`,
      buttonLabel: "Create Project Here",
      properties: ["openDirectory", "createDirectory"]
    });
    const parent = picked.filePaths[0];
    if (picked.canceled || !parent) {
      return ok(null);
    }
    const created = scaffoldProject(parent, name);
    if (!created.ok) {
      return created;
    }
    context.log(`Created project ${created.value.root}`);
    const opened = await context.openWorkspace(created.value.root);
    return opened.ok ? describe() : opened;
  });

  handle(IpcChannel.WorkspaceCurrent, parseNoArgs, async () => ok(await context.workspaceInfo(false)));
  handle(IpcChannel.WorkspaceRefreshInfo, parseNoArgs, () => describe(true));
  handle(IpcChannel.WorkspaceList, parsePath, (p) => withWorkspace((w) => w.list(p)));
  handle(IpcChannel.WorkspaceRead, parsePath, (p) => withWorkspace((w) => w.readFile(p)));
  handle(IpcChannel.WorkspaceWrite, parseWrite, ({ path: p, content, options }) =>
    withWorkspace((w) => w.writeFile(p, content, options))
  );
  handle(IpcChannel.WorkspaceCreateFile, parseCreate, ({ parent, name }) => withWorkspace((w) => w.createFile(parent, name)));
  handle(IpcChannel.WorkspaceCreateFolder, parseCreate, ({ parent, name }) => withWorkspace((w) => w.createFolder(parent, name)));
  handle(IpcChannel.WorkspaceRename, parseRename, ({ path: p, newName }) => withWorkspace((w) => w.rename(p, newName)));
  handle(IpcChannel.WorkspaceDelete, parseDelete, ({ path: p, confirmed }) => withWorkspace((w) => w.delete(p, confirmed)));

  handle(IpcChannel.WorkspaceSaveAsDialog, parseSaveAs, ({ suggestedPath, content, bom }) =>
    withWorkspace(async (w) => {
      const win = context.window();
      if (!win) {
        return fail("UNKNOWN", "No window is open.");
      }
      const segments = suggestedPath.split("/").filter((s) => s !== "" && s !== "." && s !== "..");
      const picked = await dialog.showSaveDialog(win, {
        title: "Save As",
        defaultPath: path.join(w.root, ...segments),
        properties: ["showOverwriteConfirmation", "createDirectory"]
      });
      if (picked.canceled || !picked.filePath) {
        return ok(null);
      }
      const relative = await w.relativePathFor(picked.filePath);
      if (!relative.ok) {
        return relative;
      }
      // The native dialog already asked before replacing an existing file.
      const written = await w.writeFile(relative.value, content, { expectedVersion: null, overwrite: true, bom });
      return written.ok ? ok({ path: relative.value, version: written.value.version }) : written;
    })
  );

  /* ---------- terminal ---------- */

  handle(IpcChannel.TerminalShells, parseNoArgs, () => ok(context.shells.map(publicShellInfo)));

  handle(IpcChannel.TerminalCreate, parseTerminalCreate, (options) => {
    const shell = options.shell ? context.shells.find((s) => s.id === options.shell) : context.shells[0];
    if (!shell) {
      return fail("SHELL_UNAVAILABLE", "That shell is not available on this computer.");
    }
    const cwd = context.workspace()?.root ?? process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
    return context.terminals.create(shell, cwd, options.cols, options.rows);
  });
  handle(IpcChannel.TerminalWrite, parseTerminalWrite, ({ id, data }) => context.terminals.write(id, data));
  handle(IpcChannel.TerminalResize, parseTerminalResize, ({ id, cols, rows }) => context.terminals.resize(id, cols, rows));
  handle(IpcChannel.TerminalKill, parseTerminalId, (id) => context.terminals.kill(id));

  /* ---------- language server ---------- */

  const language = context.language;
  handle(IpcChannel.LanguageStatus, parseNoArgs, () => ok(language.status));
  handle(IpcChannel.LanguageOpen, parseLanguageOpen, ({ path: p, languageId, version, text }) => {
    language.open(p, languageId, version, text);
    return ok(undefined);
  });
  handle(IpcChannel.LanguageChange, parseLanguageChange, ({ path: p, version, changes }) => {
    language.change(p, version, changes);
    return ok(undefined);
  });
  handle(IpcChannel.LanguageClose, parsePath, (p) => {
    language.close(p);
    return ok(undefined);
  });
  handle(IpcChannel.LanguageRequest, parseLanguageRequest, (request) => {
    switch (request.kind) {
      case "hover":
        return language.hover(request.path, request.position);
      case "completion":
        return language.completion(request.path, request.position, request.context);
      case "resolve":
        return language.resolveCompletion(request.token, request.index);
      case "definition":
        return language.definition(request.path, request.position);
      case "references":
        return language.references(request.path, request.position);
      case "signature-help":
        return language.signatureHelp(request.path, request.position);
      case "diagnostics":
        return language.diagnostics(request.path);
    }
  });

  /* ---------- ORIGIN connection ---------- */

  handle(IpcChannel.OriginConnection, parseNoArgs, () => ok(context.origin.connection()));
  handle(IpcChannel.OriginConnect, parseSecret, (secret) => context.origin.connect(secret));
  handle(IpcChannel.OriginDisconnect, parseNoArgs, () => context.origin.disconnect());
  handle(IpcChannel.OriginRefresh, parseNoArgs, () => context.origin.refresh());
}

/** The Recycle Bin / Trash, used for every delete. */
export async function moveToTrash(absolutePath: string): Promise<void> {
  await electronShell.trashItem(absolutePath);
}
