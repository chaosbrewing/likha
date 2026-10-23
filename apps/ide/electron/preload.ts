/*
 * Runs in the sandboxed renderer before the interface loads. It exposes
 * exactly the StudioHostApi as window.studio: fixed IPC channels, no Node.js
 * APIs, and listeners that never receive the raw IPC event object.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IpcChannel,
  MENU_COMMANDS,
  type LanguageServerStatus,
  type MenuCommand,
  type ProjectProblemsEvent,
  type StudioHostApi,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type WorkspaceChangeEvent
} from "@studio/contracts";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer);

const api: StudioHostApi = {
  app: {
    info: () => invoke(IpcChannel.AppInfo).then((result) => result.value),
    confirmClose: (allow) => invoke(IpcChannel.AppConfirmClose, allow).then(() => undefined),
    onCloseRequested: (listener) => subscribe<void>(IpcChannel.AppCloseRequested, () => listener()),
    onMenuCommand: (listener) =>
      subscribe<MenuCommand>(IpcChannel.MenuCommand, (command) => {
        if ((MENU_COMMANDS as readonly string[]).includes(command)) {
          listener(command);
        }
      })
  },
  workspace: {
    openFolderDialog: () => invoke(IpcChannel.WorkspaceOpenDialog),
    newProjectDialog: (name) => invoke(IpcChannel.WorkspaceNewProject, name),
    current: () => invoke(IpcChannel.WorkspaceCurrent),
    refreshInfo: () => invoke(IpcChannel.WorkspaceRefreshInfo),
    list: (path) => invoke(IpcChannel.WorkspaceList, path),
    readFile: (path) => invoke(IpcChannel.WorkspaceRead, path),
    writeFile: (path, content, options) => invoke(IpcChannel.WorkspaceWrite, path, content, options),
    saveAsDialog: (suggestedPath, content, bom) => invoke(IpcChannel.WorkspaceSaveAsDialog, suggestedPath, content, bom),
    createFile: (parent, name) => invoke(IpcChannel.WorkspaceCreateFile, parent, name),
    createFolder: (parent, name) => invoke(IpcChannel.WorkspaceCreateFolder, parent, name),
    rename: (path, newName) => invoke(IpcChannel.WorkspaceRename, path, newName),
    delete: (path, confirmed) => invoke(IpcChannel.WorkspaceDelete, path, confirmed),
    onChanged: (listener) => subscribe<WorkspaceChangeEvent>(IpcChannel.WorkspaceChanged, listener)
  },
  terminal: {
    shells: () => invoke(IpcChannel.TerminalShells),
    create: (options) => invoke(IpcChannel.TerminalCreate, options),
    write: (id, data) => invoke(IpcChannel.TerminalWrite, id, data),
    resize: (id, cols, rows) => invoke(IpcChannel.TerminalResize, id, cols, rows),
    kill: (id) => invoke(IpcChannel.TerminalKill, id),
    onData: (listener) => subscribe<TerminalDataEvent>(IpcChannel.TerminalData, listener),
    onExit: (listener) => subscribe<TerminalExitEvent>(IpcChannel.TerminalExit, listener)
  },
  language: {
    status: () => invoke(IpcChannel.LanguageStatus),
    open: (path, languageId, version, text) => invoke(IpcChannel.LanguageOpen, path, languageId, version, text),
    change: (path, version, changes) => invoke(IpcChannel.LanguageChange, path, version, changes),
    close: (path) => invoke(IpcChannel.LanguageClose, path),
    hover: (path, position) => invoke(IpcChannel.LanguageRequest, { kind: "hover", path, position }),
    completion: (path, position, context) => invoke(IpcChannel.LanguageRequest, { kind: "completion", path, position, context }),
    resolveCompletion: (token, index) => invoke(IpcChannel.LanguageRequest, { kind: "resolve", token, index }),
    definition: (path, position) => invoke(IpcChannel.LanguageRequest, { kind: "definition", path, position }),
    references: (path, position) => invoke(IpcChannel.LanguageRequest, { kind: "references", path, position }),
    signatureHelp: (path, position) => invoke(IpcChannel.LanguageRequest, { kind: "signature-help", path, position }),
    diagnostics: (path) => invoke(IpcChannel.LanguageRequest, { kind: "diagnostics", path }),
    onStatus: (listener) => subscribe<LanguageServerStatus>(IpcChannel.LanguageStatusChanged, listener),
    onProblems: (listener) => subscribe<ProjectProblemsEvent>(IpcChannel.LanguageProblems, listener)
  }
};

contextBridge.exposeInMainWorld("studio", api);
