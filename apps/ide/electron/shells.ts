import { lstatSync } from "node:fs";
import path from "node:path";
import type { ShellId, ShellInfo } from "@studio/contracts";

export interface ResolvedShell extends ShellInfo {
  file: string;
  args: string[];
}

function exists(file: string): boolean {
  try {
    // lstat: Microsoft Store app execution aliases (WindowsApps\pwsh.exe) are reparse points.
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(executable: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? env.Path ?? "";
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir && path.isAbsolute(dir)) {
      const candidate = path.join(dir, executable);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Detects the shells the terminal may start. This fixed list is the only way
 * an executable gets chosen: the interface can pick a ShellId, never a path.
 * The first entry is the default.
 */
export function detectShells(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): ResolvedShell[] {
  const shells: ResolvedShell[] = [];
  const add = (id: ShellId, label: string, file: string | null, args: string[], restricted = false) => {
    if (file) {
      shells.push({ id, label, file, args, restrictedScriptPolicyLikely: restricted });
    }
  };

  if (platform === "win32") {
    const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const pwshInstalled = path.join(programFiles, "PowerShell", "7", "pwsh.exe");
    add("pwsh", "PowerShell 7", exists(pwshInstalled) ? pwshInstalled : findOnPath("pwsh.exe", env), ["-NoLogo"]);

    const windowsPowerShell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    add("powershell", "Windows PowerShell", exists(windowsPowerShell) ? windowsPowerShell : null, ["-NoLogo"], true);

    const cmd = env.ComSpec ?? path.join(systemRoot, "System32", "cmd.exe");
    add("cmd", "Command Prompt", exists(cmd) ? cmd : null, []);
    return shells;
  }

  for (const [id, label, file] of [
    ["zsh", "zsh", "/bin/zsh"],
    ["bash", "bash", "/bin/bash"],
    ["sh", "sh", "/bin/sh"]
  ] as const) {
    add(id, label, exists(file) ? file : null, id === "sh" ? [] : ["-l"]);
  }
  const preferred = env.SHELL ? path.basename(env.SHELL) : null;
  shells.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  return shells;
}

export function publicShellInfo(shell: ResolvedShell): ShellInfo {
  return { id: shell.id, label: shell.label, restrictedScriptPolicyLikely: shell.restrictedScriptPolicyLikely };
}
