import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ORIGIN_API_KEY_PATTERN, type OriginConnectionState, type RelativePath, type StudioHostApi, type WorkspaceInfo } from "@studio/contracts";
import { validateEntryName, validateProjectName } from "@studio/core";
import { activeDocument, dirtyDocuments, isDirty, isSameOrInside, languageLabel } from "@studio/editor";
import { BottomPanel, type OutputEntry, type PanelTab, type Problem } from "./components/BottomPanel";
import { StatusBar } from "./components/StatusBar";
import { useDialogs } from "./features/dialogs/useDialogs";
import { EditorPane } from "./features/editor/EditorPane";
import { monaco } from "./features/editor/monaco";
import { useDocuments } from "./features/editor/useDocuments";
import { Explorer, IconButton } from "./features/explorer/Explorer";
import { useExplorer } from "./features/explorer/useExplorer";
import { useLanguageService } from "./features/language/useLanguageService";
import { TerminalPanel, type TerminalPanelApi } from "./features/terminal/TerminalPanel";
import { useShortcuts, type ShortcutCommand } from "./hooks/useShortcuts";
import logo from "./assets/logo.png";

let outputId = 0;

function parentOf(path: RelativePath): RelativePath {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function App({ host }: { host: StudioHostApi }) {
  const dialogs = useDialogs();
  const [output, setOutput] = useState<OutputEntry[]>([]);
  const [status, setStatus] = useState("Ready");
  const log = useCallback((level: "info" | "error", message: string) => {
    setOutput((entries) => [...entries.slice(-499), { id: ++outputId, time: new Date().toLocaleTimeString(), level, message }]);
    setStatus(message);
  }, []);

  const documents = useDocuments({ host, dialogs, log });
  const explorer = useExplorer(host);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [started, setStarted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [panelHeight, setPanelHeight] = useState(260);
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [originConnection, setOriginConnection] = useState<OriginConnectionState | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const terminalApi = useRef<TerminalPanelApi | null>(null);

  const active = activeDocument(documents.state);
  const dirtyPaths = useMemo(() => new Set(dirtyDocuments(documents.state).map((d) => d.path)), [documents.state]);

  /** Opens a file and moves the cursor to a range or position in it (used by Go to Definition and Problems). */
  const openLocation = useCallback(
    async (path: RelativePath, target: monaco.IRange | monaco.IPosition | undefined) => {
      if (!(await documents.openFile(path))) return;
      // The editor switches to the file's model in a later render; wait for that before moving the cursor.
      const reveal = (attempts: number) => {
        const editor = editorRef.current;
        const model = documents.modelFor(path);
        if (!editor || !model) return;
        if (editor.getModel() !== model) {
          if (attempts > 0) requestAnimationFrame(() => reveal(attempts - 1));
          return;
        }
        if (target) {
          if ("startLineNumber" in target) {
            editor.setSelection(target);
            editor.revealRangeInCenter(target);
          } else {
            editor.setPosition(target);
            editor.revealLineInCenter(target.lineNumber);
          }
        }
        editor.focus();
      };
      reveal(60);
    },
    [documents]
  );
  const languageService = useLanguageService({ host, documents, openLocation });

  const applyWorkspace = useCallback(
    (info: WorkspaceInfo) => {
      setWorkspace(info);
      document.title = `${info.name} - Origin Studio`;
      void explorer.reset();
    },
    [explorer]
  );

  const refreshInfo = useCallback(async () => {
    const result = await host.workspace.refreshInfo();
    if (result.ok) setWorkspace(result.value);
  }, [host]);

  /* ---------- ORIGIN connection (origin-core feature) ---------- */

  useEffect(() => {
    let active = true;
    void host.origin.connection().then((result) => {
      // "off" leaves the status bar at "Local"; any other answer means the feature is on.
      if (active && result.ok && !(result.value.state === "disconnected" && /feature is off/.test(result.value.detail))) setOriginConnection(result.value);
    });
    const unsubscribe = host.origin.onConnectionChanged((state) => {
      setOriginConnection(state);
      log("info", state.state === "connected" ? `Connected to ORIGIN as ${state.identity.displayName}` : `ORIGIN: ${state.state}${"detail" in state ? ` (${state.detail})` : ""}`);
      void refreshInfo();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [host, log, refreshInfo]);

  const originConnect = useCallback(async () => {
    const secret = await dialogs.prompt({
      title: "Connect to ORIGIN",
      label: "ORIGIN API key (64 hexadecimal characters). It is verified with ORIGIN, then stored encrypted on this computer. Origin Studio only reads from ORIGIN.",
      initialValue: "",
      confirmLabel: "Connect",
      secret: true,
      validate: (value) => (ORIGIN_API_KEY_PATTERN.test(value.trim()) ? null : "An ORIGIN API key is 64 hexadecimal characters.")
    });
    if (secret === null) return;
    const result = await host.origin.connect(secret);
    if (!result.ok) {
      log("error", `Could not connect to ORIGIN: ${result.error.message}`);
      await dialogs.notify("Could not connect to ORIGIN", result.error.message, result.error.code === "NOT_CONNECTED" ? "Configure an ORIGIN server in origin.json (see the README) before connecting." : undefined);
      return;
    }
    await refreshInfo();
  }, [dialogs, host, log, refreshInfo]);

  const originDisconnect = useCallback(async () => {
    const choice = await dialogs.choose({
      title: "Disconnect from ORIGIN",
      message: "Forget the stored ORIGIN credential on this computer?",
      detail: "Linked projects show as unverified until you connect again. The key itself stays valid in ORIGIN; revoke it there if it should stop working.",
      buttons: [
        { id: "disconnect", label: "Disconnect", variant: "danger" },
        { id: "cancel", label: "Cancel", variant: "primary" }
      ],
      cancelId: "cancel"
    });
    if (choice !== "disconnect") return;
    const result = await host.origin.disconnect();
    if (!result.ok) await dialogs.notify("Could not disconnect", result.error.message);
    await refreshInfo();
  }, [dialogs, host, refreshInfo]);

  const originRefresh = useCallback(async () => {
    const result = await host.origin.refresh();
    if (!result.ok) {
      await dialogs.notify("ORIGIN", result.error.message);
      return;
    }
    await refreshInfo();
  }, [dialogs, host, refreshInfo]);

  useEffect(() => {
    void host.workspace.current().then((result) => {
      if (result.ok && result.value) {
        applyWorkspace(result.value);
        log("info", `Opened ${result.value.rootPath}`);
      }
      setStarted(true);
    });
    // Run once on start-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- problems: open files from Monaco markers, the rest of the project from the language server ---------- */

  const projectProblems = languageService.projectProblems;
  useEffect(() => {
    const update = () => {
      const list: Problem[] = [];
      const openPaths = new Set<RelativePath>();
      for (const [path, entry] of documents.models) {
        openPaths.add(path);
        for (const marker of monaco.editor.getModelMarkers({ resource: entry.model.uri })) {
          if (marker.severity === monaco.MarkerSeverity.Hint) continue;
          list.push({
            path,
            line: marker.startLineNumber,
            column: marker.startColumn,
            message: marker.message,
            severity: marker.severity === monaco.MarkerSeverity.Error ? "error" : marker.severity === monaco.MarkerSeverity.Warning ? "warning" : "info"
          });
        }
      }
      for (const problem of projectProblems?.problems ?? []) {
        if (openPaths.has(problem.path) || problem.severity === "hint") continue;
        list.push({
          path: problem.path,
          line: problem.range.start.line + 1,
          column: problem.range.start.character + 1,
          message: problem.message,
          severity: problem.severity
        });
      }
      list.sort((x, y) => x.path.localeCompare(y.path) || x.line - y.line || x.column - y.column);
      setProblems(list);
    };
    update();
    const subscription = monaco.editor.onDidChangeMarkers(update);
    return () => subscription.dispose();
  }, [documents.models, documents.state.documents, projectProblems]);

  /* ---------- workspace operations ---------- */

  const requireWorkspace = useCallback(async () => {
    if (!workspace) {
      await dialogs.notify("No folder open", "Open a folder first (File > Open Folder, or Ctrl+O).");
      return false;
    }
    return true;
  }, [dialogs, workspace]);

  const targetFolder = useCallback((): RelativePath => {
    const selected = explorer.selected;
    if (selected === null) return "";
    const entry = explorer.entry(selected);
    return entry?.kind === "directory" ? selected : parentOf(selected);
  }, [explorer]);

  const openFolder = useCallback(async () => {
    if (!(await documents.resolveUnsaved("open another folder"))) return;
    const result = await host.workspace.openFolderDialog();
    if (!result.ok) {
      log("error", result.error.message);
      await dialogs.notify("Could not open folder", result.error.message);
      return;
    }
    if (result.value === null) return;
    documents.closeAll();
    applyWorkspace(result.value);
    log("info", `Opened ${result.value.rootPath}`);
  }, [applyWorkspace, dialogs, documents, host, log]);

  const newProject = useCallback(async () => {
    if (!(await documents.resolveUnsaved("create a new project"))) return;
    const name = await dialogs.prompt({
      title: "New Project",
      label: "Project name (lowercase letters, numbers, - and _). Next, choose where to create it.",
      initialValue: "my-project",
      confirmLabel: "Choose Location…",
      validate: (value) => {
        const result = validateProjectName(value);
        return result.valid ? null : result.reason;
      }
    });
    if (name === null) return;
    const result = await host.workspace.newProjectDialog(name);
    if (!result.ok) {
      log("error", result.error.message);
      await dialogs.notify("Could not create project", result.error.message);
      return;
    }
    if (result.value === null) return;
    documents.closeAll();
    applyWorkspace(result.value);
    log("info", `Created project ${result.value.rootPath}`);
    await documents.openFile("src/index.ts");
  }, [applyWorkspace, dialogs, documents, host, log]);

  const createEntry = useCallback(
    async (kind: "file" | "folder") => {
      if (!(await requireWorkspace())) return;
      const parent = targetFolder();
      const name = await dialogs.prompt({
        title: kind === "file" ? "New File" : "New Folder",
        label: `Name (in ${parent === "" ? "the workspace root" : parent})`,
        initialValue: "",
        confirmLabel: "Create",
        validate: (value) => {
          const result = validateEntryName(value);
          return result.valid ? null : result.reason;
        }
      });
      if (name === null) return;
      const result = kind === "file" ? await host.workspace.createFile(parent, name) : await host.workspace.createFolder(parent, name);
      if (!result.ok) {
        log("error", result.error.message);
        await dialogs.notify(`Could not create ${kind}`, result.error.message);
        return;
      }
      if (parent === "") await explorer.reload("");
      else await explorer.expand(parent);
      explorer.select(result.value.path);
      log("info", `Created ${result.value.path}`);
      if (kind === "file") await documents.openFile(result.value.path);
    },
    [dialogs, documents, explorer, host, log, requireWorkspace, targetFolder]
  );

  const renameEntry = useCallback(
    async (path: RelativePath) => {
      const oldName = path.slice(path.lastIndexOf("/") + 1);
      const name = await dialogs.prompt({
        title: "Rename",
        label: `New name for "${oldName}"`,
        initialValue: oldName,
        confirmLabel: "Rename",
        validate: (value) => {
          const result = validateEntryName(value);
          return result.valid ? null : result.reason;
        }
      });
      if (name === null || name === oldName) return;
      const result = await host.workspace.rename(path, name);
      if (!result.ok) {
        log("error", result.error.message);
        await dialogs.notify("Could not rename", result.error.message);
        return;
      }
      documents.renamed(path, result.value.path);
      explorer.collapse(path);
      await explorer.reload(parentOf(path));
      explorer.select(result.value.path);
      log("info", `Renamed ${path} to ${result.value.path}`);
    },
    [dialogs, documents, explorer, host, log]
  );

  const deleteEntry = useCallback(
    async (path: RelativePath) => {
      const entry = explorer.entry(path);
      const unsaved = [...dirtyPaths].filter((p) => isSameOrInside(p, path)).length;
      const what = entry?.kind === "directory" ? `the folder "${path}" and everything in it` : `"${path}"`;
      const choice = await dialogs.choose({
        title: "Delete",
        message: `Move ${what} to the Recycle Bin?`,
        detail:
          (unsaved > 0 ? `${unsaved} open file(s) with unsaved changes will be closed and those changes lost. ` : "") +
          "You can restore it from the Recycle Bin.",
        buttons: [
          { id: "delete", label: "Move to Recycle Bin", variant: "danger" },
          { id: "cancel", label: "Cancel", variant: "primary" }
        ],
        cancelId: "cancel"
      });
      if (choice !== "delete") return;
      const result = await host.workspace.delete(path, true);
      if (!result.ok) {
        log("error", result.error.message);
        await dialogs.notify("Could not delete", result.error.message);
        return;
      }
      documents.deleted(path);
      explorer.collapse(path);
      explorer.select(null);
      await explorer.reload(parentOf(path));
      log("info", `Moved ${path} to the Recycle Bin`);
    },
    [dialogs, dirtyPaths, documents, explorer, host, log]
  );

  const openFile = useCallback(
    async (path: RelativePath) => {
      if (await documents.openFile(path)) setStatus(path);
    },
    [documents]
  );

  const showTerminal = useCallback(async () => {
    setPanelVisible(true);
    setPanelTab("terminal");
    // Let the panel render so the terminal can measure itself.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }, []);

  /* ---------- commands (menu, shortcuts, buttons) ---------- */

  const runCommand = useCallback(
    async (command: ShortcutCommand) => {
      const path = documents.state.activePath;
      switch (command) {
        case "open-folder":
          return openFolder();
        case "new-project":
          return newProject();
        case "new-file":
          return createEntry("file");
        case "new-folder":
          return createEntry("folder");
        case "save":
          if (path !== null && (await documents.save(path)) && path === "package.json") await refreshInfo();
          return;
        case "save-as":
          if (path !== null) {
            const target = await documents.saveAs(path);
            if (target) await explorer.reload(parentOf(target));
          }
          return;
        case "save-all":
          await documents.saveAll();
          return;
        case "close-tab":
          if (path !== null) await documents.requestClose(path);
          return;
        case "next-tab":
        case "previous-tab": {
          const list = documents.state.documents;
          const index = list.findIndex((d) => d.path === path);
          const next = list[(index + (command === "next-tab" ? 1 : -1) + list.length) % list.length];
          if (next) documents.activate(next.path);
          return;
        }
        case "refresh-explorer":
          await explorer.refresh();
          await refreshInfo();
          return;
        case "toggle-panel":
          setPanelVisible((visible) => !visible);
          return;
        case "new-terminal":
          await showTerminal();
          await terminalApi.current?.newTerminal();
          return;
        case "find":
          editorRef.current?.focus();
          await editorRef.current?.getAction("actions.find")?.run();
          return;
        case "origin-connect":
          return originConnect();
        case "origin-disconnect":
          return originDisconnect();
        case "origin-refresh":
          return originRefresh();
        case "about": {
          const info = await host.app.info();
          await dialogs.notify(
            info.productName,
            `Version ${info.version}`,
            `Electron ${info.versions.electron} · Chromium ${info.versions.chrome} · Node.js ${info.versions.node}\nRuns locally. No ORIGIN account or internet connection is required.`
          );
          return;
        }
      }
    },
    [createEntry, dialogs, documents, explorer, host, newProject, openFolder, originConnect, originDisconnect, originRefresh, refreshInfo, showTerminal]
  );

  const commandRef = useRef(runCommand);
  commandRef.current = runCommand;
  useShortcuts((command) => void commandRef.current(command), !dialogs.isOpen);

  useEffect(() => host.app.onMenuCommand((command) => void commandRef.current(command)), [host]);

  // Files changed on disk by any program: refresh what is visible and check open tabs.
  const onDiskChange = useCallback(
    (event: { paths: RelativePath[]; overflow: boolean }) => {
      if (event.overflow) {
        void explorer.refresh();
        void refreshInfo();
        void documents.checkDisk(null);
        return;
      }
      const folders = new Set<RelativePath>();
      for (const path of event.paths) {
        folders.add(parentOf(path));
        if (explorer.expanded.has(path)) folders.add(path);
      }
      for (const folder of folders) {
        if (folder === "" || explorer.expanded.has(folder)) void explorer.reload(folder);
      }
      if (event.paths.some((p) => p === "package.json" || p === ".git/HEAD" || p === ".origin/project.json" || p === ".origin")) void refreshInfo();
      void documents.checkDisk(event.paths);
    },
    [documents, explorer, refreshInfo]
  );
  const diskChangeRef = useRef(onDiskChange);
  diskChangeRef.current = onDiskChange;
  useEffect(() => host.workspace.onChanged((event) => diskChangeRef.current(event)), [host]);

  const resolveRef = useRef(documents.resolveUnsaved);
  resolveRef.current = documents.resolveUnsaved;
  const dirtyRef = useRef(dirtyPaths);
  dirtyRef.current = dirtyPaths;
  // Set once the user has decided (saved or discarded) so the window may unload.
  const unloadAllowed = useRef(false);
  const closing = useRef(false);
  const decideClose = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      const allow = await resolveRef.current("close Origin Studio");
      unloadAllowed.current = allow;
      await host.app.confirmClose(allow);
    } finally {
      closing.current = false;
    }
  }, [host]);
  useEffect(() => host.app.onCloseRequested(() => void decideClose()), [host, decideClose]);
  // Defence in depth: a close that starts in the page (window.close(), a reload)
  // must go through the same decision instead of discarding unsaved work.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unloadAllowed.current || dirtyRef.current.size === 0) return;
      event.preventDefault();
      void decideClose();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [decideClose]);

  const openProblem = useCallback((problem: Problem) => openLocation(problem.path, { lineNumber: problem.line, column: problem.column }), [openLocation]);

  const emptyHint = (
    <div className="hint">
      <p>Select a file in the Explorer to open it.</p>
      <dl className="shortcut-list">
        <dt>Ctrl+N</dt>
        <dd>New file</dd>
        <dt>Ctrl+S</dt>
        <dd>Save</dd>
        <dt>Ctrl+W</dt>
        <dd>Close tab</dd>
        <dt>Ctrl+`</dt>
        <dd>Toggle panel</dd>
        <dt>Ctrl+Shift+`</dt>
        <dd>New terminal</dd>
      </dl>
    </div>
  );

  return (
    <div className="app" style={{ gridTemplateRows: `40px 1fr ${panelVisible ? `${panelHeight}px` : "0px"} 24px` }}>
      <header className="title-bar">
        <span className="brand">
          <img src={logo} alt="" className="brand-logo" />
          ORIGIN STUDIO
        </span>
        <span className="title-workspace">{workspace ? workspace.name : ""}</span>
        <div className="toolbar">
          <IconButton icon="codicon-folder-opened" label="Open Folder (Ctrl+O)" onClick={() => void runCommand("open-folder")} />
          <IconButton icon="codicon-save" label="Save (Ctrl+S)" disabled={!active || !isDirty(active)} onClick={() => void runCommand("save")} />
          <IconButton icon="codicon-terminal" label="New Terminal (Ctrl+Shift+`)" onClick={() => void runCommand("new-terminal")} />
          <IconButton icon="codicon-layout-panel" label="Toggle Panel (Ctrl+`)" onClick={() => void runCommand("toggle-panel")} />
        </div>
      </header>

      {workspace ? (
        <main className="workbench">
          <Explorer
            title={workspace.name}
            explorer={explorer}
            dirtyPaths={dirtyPaths}
            onOpenFile={(path) => void openFile(path)}
            onNewFile={() => void createEntry("file")}
            onNewFolder={() => void createEntry("folder")}
            onRename={(path) => void renameEntry(path)}
            onDelete={(path) => void deleteEntry(path)}
          />
          <EditorPane
            documents={documents.state.documents}
            activePath={documents.state.activePath}
            model={active ? documents.modelFor(active.path) : null}
            onActivate={documents.activate}
            onClose={(path) => void documents.requestClose(path)}
            onCursor={setCursor}
            editorRef={editorRef}
            emptyHint={emptyHint}
            notice={
              active && documents.external[active.path] ? (
                <div className="editor-notice" role="alert">
                  <span className="codicon codicon-warning" aria-hidden="true" />
                  {documents.external[active.path] === "deleted" ? (
                    <>
                      <span>This file was deleted or moved outside Origin Studio. Saving will create it again.</span>
                      <button type="button" className="button small" onClick={() => void documents.requestClose(active.path)}>
                        Close Tab
                      </button>
                    </>
                  ) : (
                    <>
                      <span>This file changed on disk. Your unsaved edits are kept until you choose.</span>
                      <button type="button" className="button small" onClick={() => void documents.reloadFromDisk(active.path)}>
                        Reload from Disk
                      </button>
                    </>
                  )}
                  <button type="button" className="button small" onClick={() => documents.dismissExternal(active.path)}>
                    Keep My Version
                  </button>
                </div>
              ) : null
            }
          />
        </main>
      ) : (
        <main className="welcome">
          {started ? (
            <div className="welcome-card">
              <img src={logo} alt="" className="welcome-logo" />
              <h1>Origin Studio</h1>
              <p>Open a project folder to browse, edit and run it, or start a new one.</p>
              <div className="welcome-actions">
                <button type="button" className="button primary large" onClick={() => void runCommand("open-folder")}>
                  Open Folder…
                </button>
                <button type="button" className="button large" onClick={() => void runCommand("new-project")}>
                  New Project…
                </button>
              </div>
              <p className="welcome-note">Everything runs on this computer. No account or internet connection is needed.</p>
              <p className="welcome-note">
                New Project creates the same starter as <code>chaos init</code>.
              </p>
            </div>
          ) : null}
        </main>
      )}

      <div className="panel-slot">
        <BottomPanel
          tab={panelTab}
          onTab={setPanelTab}
          onHide={() => setPanelVisible(false)}
          height={panelHeight}
          onResize={setPanelHeight}
          output={output}
          problems={problems}
          problemsScope={projectProblems ? { filesChecked: projectProblems.filesChecked, truncated: projectProblems.truncated } : null}
          onOpenProblem={(problem) => void openProblem(problem)}
          terminal={<TerminalPanel host={host} visible={panelVisible && panelTab === "terminal"} scripts={workspace?.scripts ?? []} apiRef={terminalApi} log={log} />}
        />
      </div>

      <StatusBar
        workspace={workspace}
        language={active ? languageLabel(active.language) : null}
        cursor={active ? cursor : null}
        dirtyCount={dirtyPaths.size}
        message={status}
        languageServer={languageService.status}
        originConnection={originConnection}
      />
      {dialogs.element}
    </div>
  );
}
