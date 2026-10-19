import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import pty from "node-pty";
import { TERMINAL_LIMITS } from "@studio/contracts";
import { detectShells, type ResolvedShell } from "../electron/shells.ts";
import { TerminalManager, type PtyProcess, type SpawnPty } from "../electron/terminal-manager.ts";

class FakePty implements PtyProcess {
  pid = 1234;
  written: string[] = [];
  sizes: [number, number][] = [];
  killed = false;
  private dataListener: (data: string) => void = () => {};
  private exitListener: (event: { exitCode: number }) => void = () => {};
  onData(listener: (data: string) => void) {
    this.dataListener = listener;
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListener = listener;
  }
  write(data: string) {
    this.written.push(data);
  }
  resize(cols: number, rows: number) {
    this.sizes.push([cols, rows]);
  }
  kill() {
    this.killed = true;
    this.exitListener({ exitCode: 1 });
  }
  emitData(data: string) {
    this.dataListener(data);
  }
  emitExit(code: number) {
    this.exitListener({ exitCode: code });
  }
}

const shell: ResolvedShell = { id: "pwsh", label: "PowerShell 7", file: "pwsh.exe", args: ["-NoLogo"], restrictedScriptPolicyLikely: false };

function setup() {
  const ptys: FakePty[] = [];
  const spawned: Parameters<SpawnPty>[] = [];
  const events: string[] = [];
  const spawn: SpawnPty = (...args) => {
    spawned.push(args);
    const fake = new FakePty();
    ptys.push(fake);
    return fake;
  };
  const manager = new TerminalManager(spawn, {
    data: (id, data) => events.push(`data:${id}:${data}`),
    exit: (id, code) => events.push(`exit:${id}:${code}`)
  }, { PATH: "x", SECRET_UNDEFINED: undefined });
  return { manager, ptys, spawned, events };
}

test("terminal session lifecycle: create, data, input, resize, exit", () => {
  const { manager, ptys, spawned, events } = setup();
  const created = manager.create(shell, "C:\\project", 100, 30);
  assert.ok(created.ok);
  assert.deepEqual(created.value, {
    id: 1,
    shell: { id: "pwsh", label: "PowerShell 7", restrictedScriptPolicyLikely: false },
    cwd: "C:\\project"
  });
  const [file, args, options] = spawned[0]!;
  assert.equal(file, "pwsh.exe");
  assert.deepEqual(args, ["-NoLogo"]);
  assert.equal(options.cwd, "C:\\project");
  assert.equal(options.cols, 100);
  assert.equal(options.env.TERM_PROGRAM, "OriginStudio");
  assert.ok(!("SECRET_UNDEFINED" in options.env));

  ptys[0]!.emitData("PS> ");
  assert.ok(manager.write(1, "dir\r").ok);
  assert.deepEqual(ptys[0]!.written, ["dir\r"]);
  assert.ok(manager.resize(1, 120, 40).ok);
  assert.deepEqual(ptys[0]!.sizes, [[120, 40]]);

  ptys[0]!.emitExit(0);
  assert.deepEqual(events, ["data:1:PS> ", "exit:1:0"]);
  assert.equal(manager.count, 0);
  const afterExit = manager.write(1, "x");
  assert.equal(!afterExit.ok && afterExit.error.code, "TERMINAL_NOT_FOUND");
});

test("kill ends the process and reports exit exactly once", () => {
  const { manager, ptys, events } = setup();
  assert.ok(manager.create(shell, "C:\\p", 80, 24).ok);
  assert.ok(manager.kill(1).ok);
  assert.equal(ptys[0]!.killed, true);
  assert.deepEqual(events.filter((e) => e.startsWith("exit")), ["exit:1:-1"]);
  assert.equal(!manager.kill(1).ok && manager.kill(1).ok === false, true);
});

test("killAll ends every session (used when the window closes)", () => {
  const { manager, ptys } = setup();
  manager.create(shell, "C:\\p", 80, 24);
  manager.create(shell, "C:\\p", 80, 24);
  manager.killAll();
  assert.equal(manager.count, 0);
  assert.ok(ptys.every((p) => p.killed));
});

test("session limit and spawn failures are reported, not thrown", () => {
  const { manager } = setup();
  for (let i = 0; i < TERMINAL_LIMITS.maxSessions; i++) {
    assert.ok(manager.create(shell, "C:\\p", 80, 24).ok);
  }
  const over = manager.create(shell, "C:\\p", 80, 24);
  assert.equal(!over.ok && over.error.code, "TERMINAL_LIMIT");

  const failing = new TerminalManager(() => {
    throw new Error("File not found");
  }, { data() {}, exit() {} });
  const failed = failing.create(shell, "C:\\p", 80, 24);
  assert.equal(!failed.ok && failed.error.code, "SHELL_UNAVAILABLE");
});

test("only allowlisted shells are detected", () => {
  const windows = detectShells({ SystemRoot: process.env.SystemRoot ?? "C:\\Windows", ComSpec: process.env.ComSpec, PATH: "" }, "win32");
  for (const s of windows) {
    assert.ok(["pwsh", "powershell", "cmd"].includes(s.id));
  }
  const windowsPowerShell = windows.find((s) => s.id === "powershell");
  if (windowsPowerShell) assert.equal(windowsPowerShell.restrictedScriptPolicyLikely, true);
  const posix = detectShells({ SHELL: "/bin/bash" }, "linux");
  for (const s of posix) assert.ok(["bash", "zsh", "sh"].includes(s.id));
});

test("a real shell runs a command through node-pty and exits cleanly", { skip: process.platform !== "win32" && "Windows-specific shell check", timeout: 30_000 }, async () => {
  const shells = detectShells();
  const cmd = shells.find((s) => s.id === "cmd") ?? shells[0];
  assert.ok(cmd, "a shell is available");
  let output = "";
  let exitCode: number | null = null;
  const exited = new Promise<void>((resolve) => {
    const manager = new TerminalManager((file, args, options) => pty.spawn(file, args, options), {
      data: (_id, data) => {
        output += data;
      },
      exit: (_id, code) => {
        exitCode = code;
        resolve();
      }
    });
    const created = manager.create(cmd, os.tmpdir(), 80, 24);
    assert.ok(created.ok, created.ok ? "" : created.error.message);
    manager.write(created.value.id, "echo origin-terminal-%NUMBER_OF_PROCESSORS%-ok\r");
    const started = Date.now();
    const poll = setInterval(() => {
      if (/origin-terminal-\d+-ok/.test(output) || Date.now() - started > 15_000) {
        clearInterval(poll);
        manager.write(created.value.id, "exit 3\r");
      }
    }, 100);
  });
  await exited;
  assert.match(output, /origin-terminal-\d+-ok/, "the command was executed, not just echoed");
  assert.equal(exitCode, 3);
});
