import type { Result } from "./result.js";
import type {
  ShellInfo,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSession
} from "./terminal.js";
import type {
  FileReadResult,
  RelativePath,
  SaveAsResult,
  WorkspaceChangeEvent,
  WorkspaceEntry,
  WorkspaceInfo,
  WriteFileOptions,
  WriteFileResult
} from "./workspace.js";

/** Commands the application menu can send to the interface. */
export const MENU_COMMANDS = [
  "open-folder",
  "new-project",
  "new-file",
  "new-folder",
  "save",
  "save-as",
  "save-all",
  "close-tab",
  "refresh-explorer",
  "toggle-panel",
  "new-terminal",
  "find",
  "about"
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

export interface AppInfo {
  productName: string;
  version: string;
  platform: string;
  versions: { electron: string; chrome: string; node: string };
}

export type Unsubscribe = () => void;

/**
 * Everything the editor interface may ask of its host. The Electron preload
 * implements it today; a browser or ORIGIN-hosted implementation can later
 * provide the same surface without changing the interface code.
 */
export interface StudioHostApi {
  app: {
    info(): Promise<AppInfo>;
    /** Answer to onCloseRequested: true lets the window close. */
    confirmClose(allow: boolean): Promise<void>;
    onCloseRequested(listener: () => void): Unsubscribe;
    onMenuCommand(listener: (command: MenuCommand) => void): Unsubscribe;
  };
  workspace: {
    /** Shows the native folder picker. Resolves to null when cancelled. */
    openFolderDialog(): Promise<Result<WorkspaceInfo | null>>;
    /**
     * Asks where to create a new project called `name` (native folder picker),
     * creates it with the same rules as `chaos init`, and opens it. Null when cancelled.
     */
    newProjectDialog(name: string): Promise<Result<WorkspaceInfo | null>>;
    current(): Promise<Result<WorkspaceInfo | null>>;
    refreshInfo(): Promise<Result<WorkspaceInfo>>;
    list(path: RelativePath): Promise<Result<WorkspaceEntry[]>>;
    readFile(path: RelativePath): Promise<Result<FileReadResult>>;
    writeFile(path: RelativePath, content: string, options: WriteFileOptions): Promise<Result<WriteFileResult>>;
    /** Shows the native save dialog, restricted to the workspace. Null when cancelled. */
    saveAsDialog(suggestedPath: RelativePath, content: string, bom: boolean): Promise<Result<SaveAsResult | null>>;
    createFile(parent: RelativePath, name: string): Promise<Result<WorkspaceEntry>>;
    createFolder(parent: RelativePath, name: string): Promise<Result<WorkspaceEntry>>;
    rename(path: RelativePath, newName: string): Promise<Result<WorkspaceEntry>>;
    /** Moves the entry to the system trash. confirmed must be true. */
    delete(path: RelativePath, confirmed: true): Promise<Result<void>>;
    /** Files in the open workspace changed on disk (from any program). */
    onChanged(listener: (event: WorkspaceChangeEvent) => void): Unsubscribe;
  };
  terminal: {
    shells(): Promise<Result<ShellInfo[]>>;
    create(options: TerminalCreateOptions): Promise<Result<TerminalSession>>;
    write(id: number, data: string): Promise<Result<void>>;
    resize(id: number, cols: number, rows: number): Promise<Result<void>>;
    kill(id: number): Promise<Result<void>>;
    onData(listener: (event: TerminalDataEvent) => void): Unsubscribe;
    onExit(listener: (event: TerminalExitEvent) => void): Unsubscribe;
  };
}
