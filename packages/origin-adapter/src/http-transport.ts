import {
  fail,
  ok,
  type OriginCredential,
  type OriginIdentity,
  type OriginPermission,
  type OriginProjectId,
  type OriginProjectRecord,
  type OriginTransport,
  type Result
} from "@studio/contracts";

/*
 * HTTP transport for ORIGIN Core: tRPC `auth.me` and `projects.get` with a
 * bearer API key, the desktop read access ORIGIN added in its Phase 8
 * (`server/_core/desktopAuth.ts`, `desktopReadProcedure`). Verified against a
 * local ORIGIN development server; no public ORIGIN deployment exists yet.
 * The unit tests run it against an in-process fake with the same shapes. See
 * docs/integration/README.md, "What was verified".
 */

export interface HttpTransportOptions {
  /** https origin of ORIGIN (http only for localhost / 127.0.0.1 development). */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function validateOriginBaseUrl(value: string): Result<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("INVALID_ARGUMENT", "The ORIGIN URL is not a valid URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return fail("INVALID_ARGUMENT", "The ORIGIN URL must use https (http is allowed for localhost only).");
  }
  if (url.username || url.password || url.search || url.hash) {
    return fail("INVALID_ARGUMENT", "The ORIGIN URL must not contain credentials, a query or a fragment.");
  }
  return ok(url.origin + url.pathname.replace(/\/+$/, ""));
}

interface TrpcEnvelope {
  result?: { data?: { json?: unknown } | unknown };
  error?: { json?: { message?: string; data?: { code?: string } }; message?: string; data?: { code?: string } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The message inside a tRPC error envelope, if the body is one. */
function trpcErrorMessage(body: unknown): string | null {
  const raw = Array.isArray(body) ? body[0] : body;
  if (!isRecord(raw)) return null;
  const error = (raw as TrpcEnvelope).error;
  const message = error?.json?.message ?? error?.message;
  return typeof message === "string" && message ? message : null;
}

/** Maps ORIGIN's permission vocabulary to the IDE's coarse view. */
export function toPermissions(value: unknown): OriginPermission[] {
  const set = new Set<OriginPermission>();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    if (item === "read" || item.endsWith(".read") || item === "project.read") set.add("read");
    if (item === "write" || item.endsWith(".execute") || item.endsWith(".write")) set.add("write");
    if (item === "admin" || item.endsWith(".manage")) set.add("admin");
  }
  if (set.has("admin")) {
    set.add("read");
    set.add("write");
  }
  return [...set];
}

export class HttpOriginTransport implements OriginTransport {
  readonly kind = "http" as const;
  readonly target: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpTransportOptions) {
    const base = validateOriginBaseUrl(options.baseUrl);
    if (!base.ok) throw new Error(base.error.message);
    this.target = base.value;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async call(procedure: string, input: unknown, credential: OriginCredential): Promise<Result<unknown>> {
    const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.target}/api/trpc/${procedure}${query}`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${credential.secret}`, "user-agent": "OriginStudio" },
        signal: controller.signal,
        redirect: "manual"
      });
    } catch (error) {
      clearTimeout(timer);
      const detail = controller.signal.aborted ? `No answer from ORIGIN after ${this.timeoutMs / 1000} s.` : error instanceof Error ? error.message : String(error);
      return fail("UNAVAILABLE", `ORIGIN could not be reached: ${detail}`);
    }
    clearTimeout(timer);
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    // tRPC answers errors with the HTTP status of the error code and a JSON
    // envelope carrying the message (e.g. "API key has expired."). Prefer the
    // message, fall back to the status.
    const envelopeMessage = trpcErrorMessage(body);
    if (response.status === 401) return fail("UNAUTHORIZED", envelopeMessage ?? "ORIGIN rejected the credential.");
    if (response.status === 403) return fail("FORBIDDEN", envelopeMessage ?? "ORIGIN refused access.");
    if (response.status === 404) return fail("NOT_FOUND", envelopeMessage ?? "ORIGIN has no such procedure or record.");
    if (response.status === 429) return fail("UNAVAILABLE", envelopeMessage ?? "ORIGIN is rate limiting requests; try again later.");
    if (response.status >= 300) return fail("UNAVAILABLE", envelopeMessage ?? `ORIGIN answered with HTTP ${response.status}.`);
    if (body === null) {
      return fail("UNAVAILABLE", "ORIGIN answered with something other than JSON.");
    }
    const raw = Array.isArray(body) ? body[0] : body;
    if (!isRecord(raw)) return fail("UNAVAILABLE", "ORIGIN answered with an unexpected shape.");
    const envelope = raw as TrpcEnvelope;
    if (envelope.error) {
      const error = envelope.error;
      const code = error.json?.data?.code ?? error.data?.code ?? "";
      const message = error.json?.message ?? error.message ?? "ORIGIN reported an error.";
      if (code === "UNAUTHORIZED") return fail("UNAUTHORIZED", message);
      if (code === "FORBIDDEN") return fail("FORBIDDEN", message);
      if (code === "NOT_FOUND") return fail("NOT_FOUND", message);
      return fail("UNAVAILABLE", message);
    }
    const data = isRecord(envelope.result) ? envelope.result.data : undefined;
    return ok(isRecord(data) && "json" in data ? data.json : data);
  }

  async whoAmI(credential: OriginCredential): Promise<Result<OriginIdentity>> {
    const result = await this.call("auth.me", undefined, credential);
    if (!result.ok) return result;
    const user = result.value;
    if (user === null || user === undefined) {
      // auth.me is public and answers null for an unauthenticated request: the key was not accepted.
      return fail("UNAUTHORIZED", "ORIGIN did not accept the credential (this ORIGIN may not accept API keys yet).");
    }
    if (!isRecord(user) || (typeof user.id !== "string" && typeof user.id !== "number")) {
      return fail("UNAVAILABLE", "ORIGIN's identity answer had an unexpected shape.");
    }
    return ok({
      userId: String(user.id),
      displayName: typeof user.name === "string" && user.name ? user.name : typeof user.email === "string" ? user.email : `user ${String(user.id)}`,
      organisationId: typeof user.organisationId === "number" || typeof user.organisationId === "string" ? String(user.organisationId) : null,
      projectId: typeof user.projectId === "number" || typeof user.projectId === "string" ? (String(user.projectId) as OriginProjectId) : null,
      permissions: Array.isArray(user.permissions) ? toPermissions(user.permissions) : ["read"],
      expiresAt: typeof user.expiresAt === "string" ? user.expiresAt : null
    });
  }

  async getProject(credential: OriginCredential, projectId: OriginProjectId): Promise<Result<OriginProjectRecord>> {
    const numeric = /^\d+$/.test(projectId) ? Number(projectId) : projectId;
    const result = await this.call("projects.get", { projectId: numeric }, credential);
    if (!result.ok) return result;
    const project = result.value;
    if (!isRecord(project) || (typeof project.id !== "string" && typeof project.id !== "number") || typeof project.name !== "string") {
      return fail("UNAVAILABLE", "ORIGIN's project answer had an unexpected shape.");
    }
    return ok({
      id: String(project.id) as OriginProjectId,
      name: project.name,
      ownerId: typeof project.userId === "number" || typeof project.userId === "string" ? String(project.userId) : "",
      permissions: Array.isArray(project.permissions) ? toPermissions(project.permissions) : ["read"],
      revision: typeof project.revision === "number" ? project.revision : typeof project.updatedAt === "string" ? Date.parse(project.updatedAt) || 0 : 0
    });
  }
}
