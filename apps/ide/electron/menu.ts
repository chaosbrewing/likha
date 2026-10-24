import { Menu, type MenuItemConstructorOptions } from "electron";
import type { MenuCommand } from "@studio/contracts";

/**
 * Builds the application menu. Shortcuts the interface handles itself are
 * shown in the menu but not registered natively (registerAccelerator: false),
 * so they behave the same whether triggered from the keyboard or a test.
 */
export function buildMenu(send: (command: MenuCommand) => void, options: { dev: boolean; quit: () => void; checkForUpdates: () => void }): Menu {
  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    click: () => send(command),
    ...(accelerator ? { accelerator, registerAccelerator: false } : {})
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        item("New Project…", "new-project"),
        item("Open Folder…", "open-folder", "CmdOrCtrl+O"),
        { type: "separator" },
        item("New File…", "new-file", "CmdOrCtrl+N"),
        item("New Folder…", "new-folder"),
        { type: "separator" },
        item("Save", "save", "CmdOrCtrl+S"),
        item("Save As…", "save-as", "CmdOrCtrl+Shift+S"),
        item("Save All", "save-all"),
        { type: "separator" },
        item("Close Tab", "close-tab", "CmdOrCtrl+W"),
        { type: "separator" },
        { label: "Exit", accelerator: "Alt+F4", registerAccelerator: false, click: options.quit }
      ]
    },
    {
      label: "&Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        item("Find", "find", "CmdOrCtrl+F")
      ]
    },
    {
      label: "&View",
      submenu: [
        item("Refresh Explorer", "refresh-explorer"),
        item("Toggle Panel", "toggle-panel", "CmdOrCtrl+`"),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
        ...(options.dev ? ([{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[]) : [])
      ]
    },
    {
      label: "&Terminal",
      submenu: [item("New Terminal", "new-terminal", "CmdOrCtrl+Shift+`")]
    },
    {
      label: "&ORIGIN",
      submenu: [item("Connect to ORIGIN…", "origin-connect"), item("Disconnect from ORIGIN", "origin-disconnect"), { type: "separator" }, item("Refresh ORIGIN Status", "origin-refresh")]
    },
    {
      label: "&Help",
      submenu: [{ label: "Check for Updates…", click: options.checkForUpdates }, { type: "separator" }, item("About Origin Studio", "about")]
    }
  ];
  return Menu.buildFromTemplate(template);
}
