/*
 * Minimal JSON-RPC 2.0 client over Language Server Protocol framing
 * (Content-Length headers on stdio). Independent of Electron so it can be
 * tested with in-memory streams.
 */

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

const HEADER_END = "\r\n\r\n";
/** A frame larger than this is treated as a protocol failure rather than buffered forever. */
const MAX_FRAME_LENGTH = 256 * 1024 * 1024;

export function encodeFrame(message: JsonRpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_END}`, "ascii"), body]);
}

/** Splits a byte stream into JSON-RPC messages; keeps partial frames between pushes. */
export class FrameParser {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): JsonRpcMessage[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: JsonRpcMessage[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END, 0, "ascii");
      if (headerEnd === -1) {
        if (this.buffer.length > 64 * 1024) {
          throw new Error("Language server sent a malformed frame header.");
        }
        return messages;
      }
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /^content-length:\s*(\d+)\s*$/im.exec(header);
      if (!match) {
        throw new Error("Language server frame has no Content-Length header.");
      }
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length > MAX_FRAME_LENGTH) {
        throw new Error("Language server frame is too large.");
      }
      const bodyStart = headerEnd + HEADER_END.length;
      if (this.buffer.length < bodyStart + length) {
        return messages;
      }
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      messages.push(JSON.parse(body) as JsonRpcMessage);
    }
  }
}

export class LspRequestError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string
  ) {
    super(`${method}: ${message}`);
  }
}

export interface LspConnectionOptions {
  /** Notifications from the server (window/logMessage, publishDiagnostics, ...). */
  onNotification?(method: string, params: unknown): void;
  /** Requests from the server. The return value is sent back as the result. */
  onRequest?(method: string, params: unknown): Promise<unknown> | unknown;
  onProtocolError?(error: Error): void;
  requestTimeoutMs?: number;
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class LspConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly parser = new FrameParser();
  private disposed = false;
  private readonly timeoutMs: number;

  constructor(
    private readonly input: NodeJS.WritableStream,
    output: NodeJS.ReadableStream,
    private readonly options: LspConnectionOptions = {}
  ) {
    this.timeoutMs = options.requestTimeoutMs ?? 15_000;
    output.on("data", (chunk: Buffer | string) => {
      let messages: JsonRpcMessage[];
      try {
        messages = this.parser.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      } catch (error) {
        this.options.onProtocolError?.(error instanceof Error ? error : new Error(String(error)));
        this.dispose("The language server sent data LIKHA could not read.");
        return;
      }
      for (const message of messages) {
        this.handle(message);
      }
    });
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new LspRequestError(method, -32000, "The language server is not running."));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LspRequestError(method, -32001, `No answer after ${this.timeoutMs} ms.`));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.disposed) {
      this.write({ jsonrpc: "2.0", method, params });
    }
  }

  /** Fails every pending request. Safe to call more than once. */
  dispose(reason = "The language server stopped."): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new LspRequestError(entry.method, -32000, reason));
      this.pending.delete(id);
    }
  }

  private write(message: JsonRpcMessage): void {
    // Answers to server requests arrive asynchronously; after dispose (or once the
    // input closed) they must be dropped rather than written to a closed pipe.
    if (this.disposed || (this.input as { writable?: boolean }).writable === false) return;
    try {
      this.input.write(encodeFrame(message));
    } catch (error) {
      this.options.onProtocolError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handle(message: JsonRpcMessage): void {
    if (message.method !== undefined) {
      if (message.id === undefined || message.id === null) {
        this.options.onNotification?.(message.method, message.params);
        return;
      }
      const id = message.id;
      const method = message.method;
      Promise.resolve()
        .then(() => this.options.onRequest?.(method, message.params) ?? null)
        .then(
          (result) => this.write({ jsonrpc: "2.0", id, result }),
          (error: unknown) =>
            this.write({ jsonrpc: "2.0", id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })
        );
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new LspRequestError(entry.method, message.error.code, message.error.message));
    } else {
      entry.resolve(message.result);
    }
  }
}
