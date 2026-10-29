import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { ShellId, ShellInfo, StudioHostApi } from "@studio/contracts";

interface Session {
  id: number;
  shell: ShellInfo;
  term: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  exited: boolean;
}

export interface TerminalPanelApi {
  newTerminal(shell?: ShellId): Promise<void>;
  /** Types a command into the active terminal (starting one if needed) and runs it. */
  runCommand(command: string): Promise<void>;
}

interface TerminalPanelProps {
  host: StudioHostApi;
  visible: boolean;
  scripts: string[];
  apiRef: { current: TerminalPanelApi | null };
  log(level: "info" | "error", message: string): void;
}

const THEME = {
  background: "#16181d",
  foreground: "#d4d7dd",
  cursor: "#e8b04a",
  selectionBackground: "#3b4252"
};

export function TerminalPanel({ host, visible, scripts, apiRef, log }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessions = useRef(new Map<number, Session>());
  const pending = useRef(new Map<number, string[]>());
  const [tabs, setTabs] = useState<{ id: number; label: string; exited: boolean; policyHint: boolean }[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [script, setScript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const syncTabs = useCallback(() => {
    setTabs([...sessions.current.values()].map((s) => ({ id: s.id, label: s.shell.label, exited: s.exited, policyHint: s.shell.restrictedScriptPolicyLikely })));
  }, []);

  useEffect(() => {
    void host.terminal.shells().then((result) => {
      if (result.ok) setShells(result.value);
      else setError(result.error.message);
    });
    const offData = host.terminal.onData(({ id, data }) => {
      const session = sessions.current.get(id);
      if (session) session.term.write(data);
      else pending.current.set(id, [...(pending.current.get(id) ?? []), data]);
    });
    const offExit = host.terminal.onExit(({ id, exitCode }) => {
      const session = sessions.current.get(id);
      if (session && !session.exited) {
        session.exited = true;
        session.term.write(`\r\n\x1b[90m[Process exited${exitCode >= 0 ? ` with code ${exitCode}` : ""}]\x1b[0m\r\n`);
        syncTabs();
      }
    });
    return () => {
      offData();
      offExit();
    };
  }, [host, syncTabs]);

  // Keep the visible terminal sized to the panel.
  const fitActive = useCallback(() => {
    if (activeId === null) return;
    const session = sessions.current.get(activeId);
    if (session && session.element.offsetParent !== null) {
      try {
        session.fit.fit();
      } catch {
        // Not measurable yet.
      }
    }
  }, [activeId]);

  useEffect(() => {
    const target = hostRef.current;
    if (!target) return;
    const observer = new ResizeObserver(() => fitActive());
    observer.observe(target);
    return () => observer.disconnect();
  }, [fitActive]);

  useEffect(() => {
    for (const session of sessions.current.values()) {
      session.element.style.display = session.id === activeId ? "block" : "none";
    }
    if (visible) {
      fitActive();
      if (activeId !== null) sessions.current.get(activeId)?.term.focus();
    }
  }, [activeId, visible, fitActive]);

  const newTerminal = useCallback(
    async (shell?: ShellId) => {
      const container = hostRef.current;
      if (!container) return;
      setError(null);
      const element = document.createElement("div");
      element.className = "terminal-instance";
      container.appendChild(element);
      const term = new Terminal({
        fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        theme: THEME
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      try {
        fit.fit();
      } catch {
        // Use defaults below.
      }

      const created = await host.terminal.create({ ...(shell ? { shell } : {}), cols: term.cols || 80, rows: term.rows || 24 });
      if (!created.ok) {
        term.dispose();
        element.remove();
        setError(created.error.message);
        log("error", `Terminal: ${created.error.message}`);
        return;
      }
      const info = created.value;
      const session: Session = { id: info.id, shell: info.shell, term, fit, element, exited: false };
      sessions.current.set(info.id, session);

      // Nothing is written into the terminal by the interface itself: text the shell
      // did not produce confuses the pseudoconsole's cursor tracking. Hints are shown
      // as a panel message instead (see below).
      for (const chunk of pending.current.get(info.id) ?? []) term.write(chunk);
      pending.current.delete(info.id);

      term.onData((data) => {
        if (!session.exited) void host.terminal.write(info.id, data);
      });
      term.onResize(({ cols, rows }) => {
        if (!session.exited) void host.terminal.resize(info.id, cols, rows);
      });
      log("info", `Started ${info.shell.label} in ${info.cwd}`);
      syncTabs();
      setActiveId(info.id);
    },
    [host, log, syncTabs]
  );

  const closeTerminal = useCallback(
    async (id: number) => {
      const session = sessions.current.get(id);
      if (!session) return;
      if (!session.exited) await host.terminal.kill(id);
      session.term.dispose();
      session.element.remove();
      sessions.current.delete(id);
      syncTabs();
      setActiveId((current) => (current === id ? ([...sessions.current.keys()].pop() ?? null) : current));
    },
    [host, syncTabs]
  );

  const runCommand = useCallback(
    async (command: string) => {
      let session = activeId !== null ? sessions.current.get(activeId) : undefined;
      if (!session || session.exited) {
        await newTerminal();
        session = [...sessions.current.values()].pop();
      }
      if (!session) return;
      session.term.focus();
      await host.terminal.write(session.id, `${command}\r`);
    },
    [activeId, host, newTerminal]
  );

  useEffect(() => {
    apiRef.current = { newTerminal, runCommand };
  }, [apiRef, newTerminal, runCommand]);

  // Ends every session when the panel goes away (e.g. switching workspace is not one of them).
  useEffect(() => {
    const all = sessions.current;
    return () => {
      for (const session of all.values()) session.term.dispose();
    };
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <div className="terminal-tabs" role="tablist" aria-label="Terminals">
          {tabs.map((tab, index) => (
            <div key={tab.id} className={`terminal-tab${tab.id === activeId ? " active" : ""}`}>
              <button type="button" role="tab" aria-selected={tab.id === activeId} onClick={() => setActiveId(tab.id)}>
                {index + 1}: {tab.label}
                {tab.exited ? " (exited)" : ""}
              </button>
              <button type="button" className="icon-button" aria-label={`Close terminal ${index + 1}`} title="Kill terminal" onClick={() => void closeTerminal(tab.id)}>
                <span className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <div className="terminal-actions">
          {scripts.length > 0 ? (
            <form
              className="run-script"
              onSubmit={(event) => {
                event.preventDefault();
                const name = script || scripts[0];
                if (name) void runCommand(`npm run ${name}`);
              }}
            >
              <label>
                <span className="visually-hidden">npm script</span>
                <select value={script || scripts[0]} onChange={(event) => setScript(event.target.value)}>
                  {scripts.map((name) => (
                    <option key={name} value={name}>
                      npm run {name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="button small" title="Run the selected npm script in the terminal">
                Run
              </button>
            </form>
          ) : null}
          {shells.map((shell) => (
            <button key={shell.id} type="button" className="button small" onClick={() => void newTerminal(shell.id)} title={`New ${shell.label} terminal`}>
              + {shell.label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="panel-message error" role="alert">
          {error}
        </p>
      ) : null}
      {tabs.length === 0 && !error ? (
        <p className="panel-message">
          No terminal is running. Start one with a button above or Ctrl+Shift+`. Terminals open in the project folder.
        </p>
      ) : null}
      {tabs.find((tab) => tab.id === activeId)?.policyHint ? (
        <p className="panel-message">
          Windows PowerShell 5.1: if <code>likha</code> or <code>npm</code> is blocked by the execution policy, use <code>likha.cmd</code> / <code>npm.cmd</code>, or
          open a PowerShell 7 terminal.
        </p>
      ) : null}
      <div ref={hostRef} className="terminal-host" />
    </div>
  );
}
