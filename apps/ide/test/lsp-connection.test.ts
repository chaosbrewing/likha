import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { FrameParser, LspConnection, LspRequestError, encodeFrame, type JsonRpcMessage } from "../electron/lsp-connection.ts";

/** An in-memory language server: reads the client's frames and answers through `reply`. */
function fakeServer(options: { requestTimeoutMs?: number; onRequest?: LspConnection["request"] extends never ? never : (method: string, params: unknown) => unknown } = {}) {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const received: JsonRpcMessage[] = [];
  const parser = new FrameParser();
  const handlers: ((message: JsonRpcMessage) => void)[] = [];
  toServer.on("data", (chunk: Buffer) => {
    for (const message of parser.push(chunk)) {
      received.push(message);
      for (const handler of handlers) handler(message);
    }
  });
  const send = (message: JsonRpcMessage) => toClient.write(encodeFrame(message));
  const clientRequests: [string, unknown][] = [];
  const connection = new LspConnection(toServer, toClient, {
    requestTimeoutMs: options.requestTimeoutMs ?? 200,
    onNotification: (method, params) => clientRequests.push([`notification:${method}`, params]),
    onRequest: (method, params) => {
      clientRequests.push([`request:${method}`, params]);
      return options.onRequest ? options.onRequest(method, params) : { handled: method };
    }
  });
  return { connection, received, send, onMessage: (handler: (message: JsonRpcMessage) => void) => handlers.push(handler), clientRequests, toClient };
}

test("frames are parsed across chunk boundaries and several per chunk", () => {
  const parser = new FrameParser();
  const a = encodeFrame({ jsonrpc: "2.0", id: 1, result: "a" });
  const b = encodeFrame({ jsonrpc: "2.0", method: "n", params: { x: 1 } });
  const bytes = Buffer.concat([a, b]);
  const first = parser.push(bytes.subarray(0, 10));
  assert.deepEqual(first, []);
  const second = parser.push(bytes.subarray(10, a.length + 5));
  assert.deepEqual(second, [{ jsonrpc: "2.0", id: 1, result: "a" }]);
  const third = parser.push(bytes.subarray(a.length + 5));
  assert.deepEqual(third, [{ jsonrpc: "2.0", method: "n", params: { x: 1 } }]);
  assert.throws(() => parser.push(Buffer.from("Content-Type: text\r\n\r\n")), /Content-Length/);
});

test("requests resolve with the server's result and reject with its error", async () => {
  const { connection, send, onMessage } = fakeServer();
  onMessage((message) => {
    if (message.method === "textDocument/hover") send({ jsonrpc: "2.0", id: message.id, result: { contents: "hi" } });
    if (message.method === "fails") send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not supported" } });
  });
  assert.deepEqual(await connection.request("textDocument/hover", { a: 1 }), { contents: "hi" });
  await assert.rejects(connection.request("fails"), (error: unknown) => error instanceof LspRequestError && error.code === -32601 && /not supported/.test(error.message));
});

test("a request that gets no answer times out, and dispose fails everything pending", async () => {
  const { connection, received } = fakeServer({ requestTimeoutMs: 50 });
  await assert.rejects(connection.request("slow"), /No answer after 50 ms/);
  const pending = connection.request("never");
  connection.dispose("stopped for the test");
  await assert.rejects(pending, /stopped for the test/);
  await assert.rejects(connection.request("after"), /not running/);
  connection.notify("ignored-after-dispose");
  assert.equal(received.filter((m) => m.method === "ignored-after-dispose").length, 0);
});

test("notifications and server-initiated requests reach the handlers, and answers go back", async () => {
  const { connection, send, received, clientRequests } = fakeServer({
    onRequest: (method, params) => (method === "workspace/configuration" ? (params as { items: unknown[] }).items.map(() => null) : null)
  });
  connection.notify("initialized", {});
  send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message: "hello" } });
  send({ jsonrpc: "2.0", id: "srv-1", method: "workspace/configuration", params: { items: [{ section: "a" }, { section: "b" }] } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(received[0], { jsonrpc: "2.0", method: "initialized", params: {} });
  assert.deepEqual(clientRequests[0], ["notification:window/logMessage", { type: 3, message: "hello" }]);
  assert.deepEqual(received[1], { jsonrpc: "2.0", id: "srv-1", result: [null, null] });
});

test("unreadable data from the server ends the connection instead of crashing", async () => {
  const { connection, toClient } = fakeServer();
  const pending = connection.request("x");
  toClient.write(Buffer.from("garbage without a header".repeat(5000)));
  await assert.rejects(pending, /could not read/);
  assert.equal(connection.isDisposed, true);
});

test("after dispose, nothing is written to the server, including late answers to its requests", async () => {
  const { connection, send, received, toClient } = fakeServer({ onRequest: () => new Promise((resolve) => setTimeout(() => resolve("late"), 30)) });
  send({ jsonrpc: "2.0", id: "srv-2", method: "window/showMessageRequest", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 5));
  connection.dispose("closing");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(received.length, 0, "the answer was dropped instead of written to a closed pipe");
  toClient.end();
});
