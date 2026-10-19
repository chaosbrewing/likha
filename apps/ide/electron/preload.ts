/*
 * Runs in the sandboxed renderer before the interface loads. It exposes
 * exactly the StudioHostApi as window.studio: fixed IPC channels, no Node.js
 * APIs, and listeners that never receive the raw IPC event object.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IpcChannel,
  MENU_COMMANDS,
  type MenuCommand,
  type StudioHostApi,
  type TerminalDataEvent,
  type TerminalExitEvent
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
    current: () => invoke(IpcChannel.WorkspaceCurrent),
    refreshInfo: () => invoke(IpcChannel.WorkspaceRefreshInfo),
    list: (path) => invoke(IpcChannel.WorkspaceList, path),
    readFile: (path) => invoke(IpcChannel.WorkspaceRead, path),
    writeFile: (path, content, options) => invoke(IpcChannel.WorkspaceWrite, path, content, options),
    saveAsDialog: (suggestedPath, content, bom) => invoke(IpcChannel.WorkspaceSaveAsDialog, suggestedPath, content, bom),
    createFile: (parent, name) => invoke(IpcChannel.WorkspaceCreateFile, parent, name),
    createFolder: (parent, name) => invoke(IpcChannel.WorkspaceCreateFolder, parent, name),
    rename: (path, newName) => invoke(IpcChannel.WorkspaceRename, path, newName),
    delete: (path, confirmed) => invoke(IpcChannel.WorkspaceDelete, path, confirmed)
  },
  terminal: {
    shells: () => invoke(IpcChannel.TerminalShells),
    create: (options) => invoke(IpcChannel.TerminalCreate, options),
    write: (id, data) => invoke(IpcChannel.TerminalWrite, id, data),
    resize: (id, cols, rows) => invoke(IpcChannel.TerminalResize, id, cols, rows),
    kill: (id) => invoke(IpcChannel.TerminalKill, id),
    onData: (listener) => subscribe<TerminalDataEvent>(IpcChannel.TerminalData, listener),
    onExit: (listener) => subscribe<TerminalExitEvent>(IpcChannel.TerminalExit, listener)
  }
};

contextBridge.exposeInMainWorld("studio", api);
