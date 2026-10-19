import { readFile } from "node:fs/promises";
import path from "node:path";
import { protocol } from "electron";
import { isInside } from "@studio/workspace";
import { APP_HOST, APP_SCHEME, PRODUCTION_CSP } from "./security.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm"
};

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
    }
  ]);
}

/**
 * Serves the built interface from `rendererDir` at app://studio/. Requests
 * outside that folder, or for any other host, get 404.
 */
export function serveRenderer(rendererDir: string): void {
  const root = path.resolve(rendererDir);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) {
      return new Response("Not found", { status: 404 });
    }
    const pathname = decodeURIComponent(url.pathname);
    const target = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!isInside(root, target)) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const body = await readFile(target);
      return new Response(body, {
        headers: {
          "content-type": MIME_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
          "content-security-policy": PRODUCTION_CSP,
          "x-content-type-options": "nosniff"
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
