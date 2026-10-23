/*
 * Runs the TypeScript language server (the native compiler in `--lsp` mode)
 * for the open workspace and answers the interface's questions about it.
 *
 * The server is a separate process the host owns: it starts when a workspace
 * opens, is replaced when another opens, and is ended when the window
 * closes. The interface never sees absolute paths or the process; it sends
 * workspace-relative paths and receives plain data.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  LANGUAGE_LIMITS,
  ok,
  type CompletionContext,
  type CompletionEntry,
  type CompletionResult,
  type Diagnostic,
  type FileLocation,
  type FileProblem,
  type HoverInfo,
  type LanguageId,
  type LanguageServerStatus,
  type ProjectProblemsEvent,
  type RelativePath,
  type Result,
  type SignatureHelpInfo,
  type TextChange,
  type TextPosition
} from "@studio/contracts";
import { parseRelativePath, type SourceFileListing } from "@studio/workspace";
import { LspConnection, LspRequestError } from "./lsp-connection.js";
import { pathToUri, toCompletionEntry, toCompletionResult, toDiagnostics, toHover, toLocations, toSignatureHelp } from "./lsp-convert.js";
import type { LanguageServerBinary } from "./typescript-binary.js";

export interface LanguageServerDeps {
  /** Where the executable is, or null when this platform has none. */
  binary(): LanguageServerBinary | null;
  listSourceFiles(root: string, limit: number): Promise<SourceFileListing>;
  onStatus(status: LanguageServerStatus): void;
  onProblems(event: ProjectProblemsEvent): void;
  log(message: string): void;
  /** Replaceable for tests. */
  spawn?: (exe: string, args: string[]) => ChildProcess;
  /** Delay before the whole project is (re)checked. */
  projectCheckDelayMs?: number;
}

interface Session {
  root: string;
  child: ChildProcess;
  connection: LspConnection;
  generation: number;
}

const CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: { didSave: true },
    hover: { contentFormat: ["markdown", "plaintext"] },
    completion: {
      completionItem: {
        snippetSupport: true,
        insertReplaceSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] }
      },
      contextSupport: true
    },
    definition: { linkSupport: false },
    references: {},
    signatureHelp: {
      signatureInformation: { documentationFormat: ["markdown", "plaintext"], parameterInformation: { labelOffsetSupport: true } },
      contextSupport: false
    },
    diagnostic: { dynamicRegistration: false }
  },
  workspace: { workspaceFolders: true, configuration: false }
};

/** Completion responses kept for completionItem/resolve (the newest few). */
const COMPLETION_CACHE_SIZE = 4;

export class LanguageServerManager {
  private session: Session | null = null;
  private generation = 0;
  private currentStatus: LanguageServerStatus = { state: "off", detail: "No workspace is open." };
  private readonly openDocuments = new Map<RelativePath, LanguageId>();
  private readonly completions = new Map<number, unknown[]>();
  private completionToken = 0;
  private projectCheckTimer: NodeJS.Timeout | null = null;
  private projectCheckRun = 0;
  private readonly spawnProcess: (exe: string, args: string[]) => ChildProcess;
  private readonly projectCheckDelayMs: number;

  constructor(private readonly deps: LanguageServerDeps) {
    this.spawnProcess = deps.spawn ?? ((exe, args) => spawn(exe, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }));
    this.projectCheckDelayMs = deps.projectCheckDelayMs ?? 1500;
  }

  get status(): LanguageServerStatus {
    return this.currentStatus;
  }

  /** Workspace-relative paths of the documents the interface has told the server about. */
  get documents(): ReadonlySet<RelativePath> {
    return new Set(this.openDocuments.keys());
  }

  private setStatus(status: LanguageServerStatus): void {
    this.currentStatus = status;
    this.deps.onStatus(status);
  }

  private queue: Promise<void> = Promise.resolve();

  /** Starts and stops happen one at a time, in the order they were asked for. */
  private serial(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Starts a server for `root`, replacing any running one. Resolves once the server answered initialize. */
  start(root: string): Promise<void> {
    return this.serial(() => this.startNow(root));
  }

  /** Ends the server, if any, after a shutdown handshake. Resolves once the process is gone. */
  stop(reason = "Origin Studio is closing."): Promise<void> {
    return this.serial(() => this.stopNow(reason));
  }

  /**
   * Ends the server without waiting, for quitting: tells it to exit and closes its
   * input (it exits on end-of-input), and only kills it if it is still there a
   * little later. Nothing here blocks the app's own shutdown.
   */
  terminate(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.clearProjectCheck();
    this.openDocuments.clear();
    this.completions.clear();
    const { child, connection } = session;
    const alive = () => child.exitCode === null && child.signalCode === null;
    if (alive()) {
      connection.notify("shutdown");
      connection.notify("exit");
    }
    connection.dispose("Origin Studio is closing.");
    try {
      child.stdin?.end();
    } catch {
      // Already closed.
    }
    child.unref();
    const fallback = setTimeout(() => {
      if (alive()) child.kill();
    }, 1500);
    fallback.unref();
    this.currentStatus = { state: "off", detail: "Origin Studio is closing." };
  }

  private async startNow(root: string): Promise<void> {
    await this.stopNow("Workspace changed.");
    const generation = ++this.generation;
    const binary = this.deps.binary();
    if (!binary) {
      this.setStatus({ state: "unavailable", detail: "The TypeScript language server is not available on this platform." });
      return;
    }
    this.setStatus({ state: "starting" });
    let child: ChildProcess;
    try {
      child = this.spawnProcess(binary.exe, ["--lsp", "--stdio"]);
    } catch (error) {
      this.setStatus({ state: "unavailable", detail: `Could not start the TypeScript language server: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (!child.stdin || !child.stdout) {
      child.kill();
      this.setStatus({ state: "unavailable", detail: "The TypeScript language server has no standard streams." });
      return;
    }
    const connection = new LspConnection(child.stdin, child.stdout, {
      onNotification: (method, params) => this.onNotification(method, params),
      onRequest: (method, params) => this.onServerRequest(method, params),
      onProtocolError: (error) => this.deps.log(`Language server protocol error: ${error.message}`)
    });
    const session: Session = { root, child, connection, generation };
    this.session = session;
    // A pipe error (the server died mid-write, or a write after it closed) must never take the app down.
    child.stdin.on("error", (error) => this.deps.log(`Language server input error: ${error.message}`));
    child.stdout.on("error", (error) => this.deps.log(`Language server output error: ${error.message}`));
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", (error) => {
      if (this.session === session) {
        this.deps.log(`Language server error: ${error.message}`);
        this.endSession(session, { state: "unavailable", detail: `Could not start the TypeScript language server: ${error.message}` });
      }
    });
    child.on("exit", (code, signal) => {
      if (this.session === session) {
        const detail = `The TypeScript language server stopped unexpectedly (${signal ?? `exit code ${code}`}).${stderr ? ` ${stderr.trim().split("\n").pop()}` : ""}`;
        this.deps.log(detail);
        this.endSession(session, { state: "stopped", detail });
      }
    });

    try {
      const rootUri = pathToUri(root, "");
      await connection.request("initialize", {
        processId: process.pid,
        rootUri,
        capabilities: CLIENT_CAPABILITIES,
        workspaceFolders: [{ uri: rootUri, name: root.split(/[\\/]/).filter(Boolean).pop() ?? "workspace" }],
        initializationOptions: {}
      });
      if (this.session !== session) return; // Replaced while initializing.
      connection.notify("initialized", {});
      this.deps.log(`TypeScript language server ${binary.version} started for ${root}`);
      this.setStatus({ state: "ready", version: binary.version });
      this.scheduleProjectCheck(200);
    } catch (error) {
      if (this.session === session) {
        const detail = `The TypeScript language server did not start: ${error instanceof Error ? error.message : String(error)}`;
        this.deps.log(detail);
        this.endSession(session, { state: "unavailable", detail });
      }
    }
  }

  private async stopNow(reason: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.clearProjectCheck();
    this.openDocuments.clear();
    this.completions.clear();
    const { child, connection } = session;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
    try {
      await Promise.race([connection.request("shutdown"), new Promise((resolve) => setTimeout(resolve, 1500))]);
      connection.notify("exit");
    } catch {
      // The process is ended below regardless.
    }
    connection.dispose(reason);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
    }
    this.setStatus({ state: "off", detail: reason });
  }

  private endSession(session: Session, status: LanguageServerStatus): void {
    if (this.session === session) {
      this.session = null;
      this.clearProjectCheck();
      this.openDocuments.clear();
      this.completions.clear();
      session.connection.dispose(status.state === "stopped" || status.state === "unavailable" ? status.detail : "Stopped.");
      this.setStatus(status);
    }
  }

  /* ---------- document sync ---------- */

  private ready(): Session | null {
    return this.session && this.currentStatus.state === "ready" ? this.session : null;
  }

  /** The server only ever hears about paths inside the workspace. */
  private static validPath(path: RelativePath): boolean {
    return parseRelativePath(path).ok && path !== "";
  }

  /** A ready session, and only for a document the interface has opened. */
  private readyFor(path: RelativePath): Session | null {
    const session = this.ready();
    return session && this.openDocuments.has(path) ? session : null;
  }

  open(path: RelativePath, languageId: LanguageId, version: number, text: string): void {
    const session = this.ready();
    if (!session || !LanguageServerManager.validPath(path)) return;
    this.openDocuments.set(path, languageId);
    session.connection.notify("textDocument/didOpen", {
      textDocument: { uri: pathToUri(session.root, path), languageId, version, text }
    });
  }

  change(path: RelativePath, version: number, changes: TextChange[]): void {
    const session = this.ready();
    if (!session || !this.openDocuments.has(path)) return;
    session.connection.notify("textDocument/didChange", {
      textDocument: { uri: pathToUri(session.root, path), version },
      contentChanges: changes.map((change) => ({ range: change.range, text: change.text }))
    });
  }

  close(path: RelativePath): void {
    const session = this.ready();
    if (!session || !this.openDocuments.has(path)) return;
    this.openDocuments.delete(path);
    session.connection.notify("textDocument/didClose", { textDocument: { uri: pathToUri(session.root, path) } });
  }

  /** Files changed on disk (saved by the interface or by another program): re-check the project soon. */
  workspaceChanged(): void {
    if (this.ready()) this.scheduleProjectCheck(this.projectCheckDelayMs);
  }

  /* ---------- queries ---------- */

  private async query<T>(method: string, params: unknown, convert: (raw: unknown, session: Session) => T, empty: T): Promise<Result<T>> {
    const session = this.ready();
    if (!session) return ok(empty);
    try {
      const raw = await session.connection.request(method, params);
      return ok(this.session === session ? convert(raw, session) : empty);
    } catch (error) {
      if (!(error instanceof LspRequestError) || error.code !== -32000) {
        this.deps.log(`Language server request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return ok(empty);
    }
  }

  private textDocumentPosition(session: Session, path: RelativePath, position: TextPosition) {
    return { textDocument: { uri: pathToUri(session.root, path) }, position };
  }

  hover(path: RelativePath, position: TextPosition): Promise<Result<HoverInfo | null>> {
    const session = this.readyFor(path);
    if (!session) return Promise.resolve(ok(null));
    return this.query("textDocument/hover", this.textDocumentPosition(session, path, position), toHover, null);
  }

  completion(path: RelativePath, position: TextPosition, context: CompletionContext): Promise<Result<CompletionResult | null>> {
    const session = this.readyFor(path);
    if (!session) return Promise.resolve(ok(null));
    return this.query(
      "textDocument/completion",
      { ...this.textDocumentPosition(session, path, position), context },
      (raw) => {
        const token = ++this.completionToken;
        const converted = toCompletionResult(raw, token, LANGUAGE_LIMITS.maxCompletionItems);
        if (!converted) return null;
        this.completions.set(token, converted.rawItems);
        for (const key of this.completions.keys()) {
          if (this.completions.size <= COMPLETION_CACHE_SIZE) break;
          this.completions.delete(key);
        }
        return converted.result;
      },
      null
    );
  }

  resolveCompletion(token: number, index: number): Promise<Result<CompletionEntry | null>> {
    const raw = this.completions.get(token)?.[index];
    if (raw === undefined) return Promise.resolve(ok(null));
    return this.query("completionItem/resolve", raw, (resolved) => toCompletionEntry(resolved, index), null);
  }

  definition(path: RelativePath, position: TextPosition): Promise<Result<FileLocation[]>> {
    const session = this.readyFor(path);
    if (!session) return Promise.resolve(ok([]));
    return this.query("textDocument/definition", this.textDocumentPosition(session, path, position), (raw, s) => toLocations(raw, s.root, this.openDocuments.keys()), []);
  }

  references(path: RelativePath, position: TextPosition): Promise<Result<FileLocation[]>> {
    const session = this.readyFor(path);
    if (!session) return Promise.resolve(ok([]));
    return this.query(
      "textDocument/references",
      { ...this.textDocumentPosition(session, path, position), context: { includeDeclaration: true } },
      (raw, s) => toLocations(raw, s.root, this.openDocuments.keys()),
      []
    );
  }

  signatureHelp(path: RelativePath, position: TextPosition): Promise<Result<SignatureHelpInfo | null>> {
    const session = this.readyFor(path);
    if (!session) return Promise.resolve(ok(null));
    return this.query("textDocument/signatureHelp", this.textDocumentPosition(session, path, position), toSignatureHelp, null);
  }

  diagnostics(path: RelativePath): Promise<Result<Diagnostic[]>> {
    const session = this.ready();
    if (!session || !LanguageServerManager.validPath(path)) return Promise.resolve(ok([]));
    return this.query("textDocument/diagnostic", { textDocument: { uri: pathToUri(session.root, path) } }, (raw) => toDiagnostics((raw as { items?: unknown })?.items), []);
  }

  /* ---------- project-wide problems ---------- */

  private clearProjectCheck(): void {
    if (this.projectCheckTimer) {
      clearTimeout(this.projectCheckTimer);
      this.projectCheckTimer = null;
    }
    this.projectCheckRun++;
  }

  private scheduleProjectCheck(delayMs: number): void {
    if (this.projectCheckTimer) clearTimeout(this.projectCheckTimer);
    this.projectCheckTimer = setTimeout(() => {
      this.projectCheckTimer = null;
      void this.checkProject();
    }, delayMs);
  }

  /** Pulls diagnostics for every source file, open or not, and reports them in one event. */
  private async checkProject(): Promise<void> {
    const session = this.ready();
    if (!session) return;
    const run = ++this.projectCheckRun;
    const listing = await this.deps.listSourceFiles(session.root, LANGUAGE_LIMITS.maxProjectFiles);
    const problems: FileProblem[] = [];
    let checked = 0;
    for (const file of listing.files) {
      if (run !== this.projectCheckRun || this.session !== session) return; // Superseded.
      const result = await this.diagnostics(file);
      if (run !== this.projectCheckRun || this.session !== session) return;
      checked++;
      if (result.ok) {
        for (const diagnostic of result.value) problems.push({ ...diagnostic, path: file });
      }
    }
    this.deps.onProblems({ problems, filesChecked: checked, truncated: listing.truncated });
  }

  /* ---------- server-initiated traffic ---------- */

  private onNotification(method: string, params: unknown): void {
    if (method === "window/logMessage" || method === "window/showMessage") {
      const message = params as { type?: number; message?: string };
      // 1 = error, 2 = warning; the server's info-level traffic is too chatty for the log.
      if (typeof message.type === "number" && message.type <= 2 && typeof message.message === "string") {
        this.deps.log(`Language server: ${message.message}`);
      }
    }
    // publishDiagnostics is ignored: diagnostics are pulled per document instead.
  }

  private onServerRequest(method: string, params: unknown): unknown {
    switch (method) {
      case "workspace/configuration":
        return ((params as { items?: unknown[] })?.items ?? []).map(() => null);
      case "workspace/applyEdit":
        return { applied: false }; // The server never changes files; edits only come from the user.
      case "window/showMessageRequest":
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
      default:
        return null;
    }
  }
}
