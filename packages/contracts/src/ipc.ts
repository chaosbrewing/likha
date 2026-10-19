/** IPC channel names. Only these channels are registered or exposed. */
export const IpcChannel = {
  AppInfo: "app:info",
  AppConfirmClose: "app:confirm-close",
  AppCloseRequested: "app:close-requested",
  MenuCommand: "menu:command",

  WorkspaceOpenDialog: "workspace:open-dialog",
  WorkspaceNewProject: "workspace:new-project",
  WorkspaceChanged: "workspace:changed",
  WorkspaceCurrent: "workspace:current",
  WorkspaceRefreshInfo: "workspace:refresh-info",
  WorkspaceList: "workspace:list",
  WorkspaceRead: "workspace:read",
  WorkspaceWrite: "workspace:write",
  WorkspaceSaveAsDialog: "workspace:save-as-dialog",
  WorkspaceCreateFile: "workspace:create-file",
  WorkspaceCreateFolder: "workspace:create-folder",
  WorkspaceRename: "workspace:rename",
  WorkspaceDelete: "workspace:delete",

  TerminalShells: "terminal:shells",
  TerminalCreate: "terminal:create",
  TerminalWrite: "terminal:write",
  TerminalResize: "terminal:resize",
  TerminalKill: "terminal:kill",
  TerminalData: "terminal:data",
  TerminalExit: "terminal:exit"
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];
