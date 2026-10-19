export const APP_SCHEME = "app";
export const APP_HOST = "studio";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Content Security Policy for the packaged interface: only code shipped with
 * the app may run, nothing may be loaded from the network.
 */
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

/** Development CSP: also allows the Vite dev server's inline preamble and HMR socket. */
export function developmentCsp(devServerUrl: string): string {
  const origin = new URL(devServerUrl).origin;
  const socket = origin.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self' ${socket}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
}

/**
 * True only for pages served by Origin Studio itself: the app:// protocol, or
 * the local Vite dev server in development mode. IPC from anything else is refused.
 */
export function isTrustedRendererUrl(url: string, devServerUrl: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST) {
    return true;
  }
  if (devServerUrl !== null) {
    try {
      return parsed.origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/** Dev server URLs are only accepted on the local machine. */
export function parseDevServerUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "http:" && local ? url.origin : null;
  } catch {
    return null;
  }
}
