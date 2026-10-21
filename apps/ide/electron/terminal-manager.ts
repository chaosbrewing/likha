import { execFile } from "node:child_process";
import {
  TERMINAL_LIMITS,
  fail,
  ok,
  type Result,
  type TerminalSession
} from "@studio/contracts";
import { publicShellInfo, type ResolvedShell } from "./shells.js";

/** The subset of node-pty's IPty the manager relies on (injectable for tests). */
export interface PtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }
) => PtyProcess;

export interface TerminalEvents {
  data(id: number, data: string): void;
  exit(id: number, exitCode: number): void;
}

interface Session {
  info: TerminalSession;
  pty: PtyProcess;
}

/**
 * Ends a shell and everything it started (a dev server, a watcher), so closing
 * a terminal or the app never leaves processes behind. Best effort: the
 * pseudoconsole is closed right after this regardless.
 */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => undefined);
    return;
  }
  try {
    process.kill(pid, "SIGHUP");
  } catch {
    // Already gone.
  }
}

/**
 * Owns every shell process started by the integrated terminal. Lives in the
 * trusted main process; the interface can only start allowlisted shells and
 * send keystrokes to sessions it created.
 */
export class TerminalManager {
  private readonly sessions = new Map<number, Session>();
  private nextId = 1;

  constructor(
    private readonly spawn: SpawnPty,
    private readonly events: TerminalEvents,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly killTree: (pid: number) => void = () => undefined
  ) {}

  get count(): number {
    return this.sessions.size;
  }

  create(shell: ResolvedShell, cwd: string, cols: number, rows: number): Result<TerminalSession> {
    if (this.sessions.size >= TERMINAL_LIMITS.maxSessions) {
      return fail("TERMINAL_LIMIT", `At most ${TERMINAL_LIMITS.maxSessions} terminals can be open at once.`);
    }

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    env.TERM_PROGRAM = "OriginStudio";

    let pty: PtyProcess;
    try {
      pty = this.spawn(shell.file, shell.args, { name: "xterm-256color", cols, rows, cwd, env });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail("SHELL_UNAVAILABLE", `Could not start ${shell.label}: ${detail}`);
    }

    const id = this.nextId++;
    const info: TerminalSession = { id, shell: publicShellInfo(shell), cwd };
    this.sessions.set(id, { info, pty });

    pty.onData((data) => {
      if (this.sessions.has(id)) {
        this.events.data(id, data);
      }
    });
    pty.onExit(({ exitCode }) => {
      // A session ended by kill() has already reported its exit.
      if (this.sessions.delete(id)) {
        this.events.exit(id, exitCode);
      }
    });
    return ok(info);
  }

  private session(id: number): Result<Session> {
    const session = this.sessions.get(id);
    return session ? ok(session) : fail("TERMINAL_NOT_FOUND", `Terminal ${id} is not running.`);
  }

  write(id: number, data: string): Result<void> {
    const session = this.session(id);
    if (!session.ok) {
      return session;
    }
    session.value.pty.write(data);
    return ok(undefined);
  }

  resize(id: number, cols: number, rows: number): Result<void> {
    const session = this.session(id);
    if (!session.ok) {
      return session;
    }
    try {
      session.value.pty.resize(cols, rows);
    } catch {
      // The process may have exited between the check and the resize.
    }
    return ok(undefined);
  }

  kill(id: number): Result<void> {
    const session = this.session(id);
    if (!session.ok) {
      return session;
    }
    this.terminate(session.value);
    return ok(undefined);
  }

  /** Ends every session. Called when the window closes or the app quits. */
  killAll(): void {
    for (const session of [...this.sessions.values()]) {
      this.terminate(session);
    }
  }

  private terminate(session: Session): void {
    this.sessions.delete(session.info.id);
    this.killTree(session.pty.pid);
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
    this.events.exit(session.info.id, -1);
  }
}
