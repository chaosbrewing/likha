/** Shells are chosen from a fixed allowlist; the renderer never names an executable. */
export type ShellId = "pwsh" | "powershell" | "cmd" | "bash" | "zsh" | "sh";

export interface ShellInfo {
  id: ShellId;
  label: string;
  /** True for Windows PowerShell 5.1, where npm's .ps1 shims may be blocked. */
  restrictedScriptPolicyLikely: boolean;
}

export interface TerminalSession {
  id: number;
  shell: ShellInfo;
  cwd: string;
}

export interface TerminalCreateOptions {
  shell?: ShellId;
  cols: number;
  rows: number;
}

export interface TerminalDataEvent {
  id: number;
  data: string;
}

export interface TerminalExitEvent {
  id: number;
  exitCode: number;
}

export const TERMINAL_LIMITS = {
  maxSessions: 8,
  maxWriteLength: 64 * 1024,
  maxCols: 1000,
  maxRows: 500
} as const;
