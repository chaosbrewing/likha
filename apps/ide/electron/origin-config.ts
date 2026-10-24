import { readFileSync } from "node:fs";
import { fail, ok, type OriginTransport, type OriginTransportKind, type Result } from "@studio/contracts";
import { HttpOriginTransport, MockOriginTransport, validateOriginBaseUrl } from "@studio/origin-adapter";

/**
 * Where the ORIGIN connection talks to. Read from origin.json in the settings
 * folder, overridden by environment variables (used by tests):
 *   { "transport": "http", "baseUrl": "https://origin.example" }
 *   { "transport": "mock" }            fixtures only, nothing leaves the machine
 * Without a file the transport is "none": the connection refuses to connect
 * and says that no ORIGIN server is configured.
 */
export interface OriginConfig {
  transport: OriginTransportKind;
  baseUrl: string | null;
  /** Mock only: start offline (every call fails with UNAVAILABLE). */
  mockOffline: boolean;
  /** Why the transport is "none" when a configuration was present but unusable. */
  problem: string | null;
}

export const DEFAULT_ORIGIN_CONFIG: OriginConfig = { transport: "none", baseUrl: null, mockOffline: false, problem: null };

export function parseOriginConfig(text: string | null, env: NodeJS.ProcessEnv): OriginConfig {
  let transport: unknown;
  let baseUrl: unknown;
  if (text !== null) {
    try {
      const raw: unknown = JSON.parse(text);
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        transport = (raw as Record<string, unknown>).transport;
        baseUrl = (raw as Record<string, unknown>).baseUrl;
      } else {
        return { ...DEFAULT_ORIGIN_CONFIG, problem: "origin.json must contain a JSON object." };
      }
    } catch (error) {
      return { ...DEFAULT_ORIGIN_CONFIG, problem: `origin.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (env.ORIGIN_STUDIO_ORIGIN_TRANSPORT) transport = env.ORIGIN_STUDIO_ORIGIN_TRANSPORT.trim().toLowerCase();
  if (env.ORIGIN_STUDIO_ORIGIN_URL) baseUrl = env.ORIGIN_STUDIO_ORIGIN_URL.trim();
  const mockOffline = env.ORIGIN_STUDIO_ORIGIN_MOCK_OFFLINE === "1";

  if (transport === undefined || transport === "none") {
    return { ...DEFAULT_ORIGIN_CONFIG, mockOffline };
  }
  if (transport === "mock") {
    return { transport: "mock", baseUrl: null, mockOffline, problem: null };
  }
  if (transport === "http") {
    if (typeof baseUrl !== "string" || !baseUrl) {
      return { ...DEFAULT_ORIGIN_CONFIG, problem: 'origin.json: "transport": "http" needs a "baseUrl".' };
    }
    const valid = validateOriginBaseUrl(baseUrl);
    if (!valid.ok) return { ...DEFAULT_ORIGIN_CONFIG, problem: `origin.json: ${valid.error.message}` };
    return { transport: "http", baseUrl: valid.value, mockOffline: false, problem: null };
  }
  return { ...DEFAULT_ORIGIN_CONFIG, problem: `origin.json: unknown transport "${String(transport)}" (use "mock", "http" or "none").` };
}

export function loadOriginConfig(file: string, env: NodeJS.ProcessEnv): OriginConfig {
  let text: string | null = null;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    text = null;
  }
  return parseOriginConfig(text, env);
}

/** The transport of a build without an ORIGIN server: refuses everything, honestly. */
export const NONE_ORIGIN_TRANSPORT: OriginTransport = {
  kind: "none",
  target: "none",
  whoAmI: async () => fail("NOT_CONNECTED", "No ORIGIN server is configured."),
  getProject: async () => fail("NOT_CONNECTED", "No ORIGIN server is configured.")
};

export function createOriginTransport(config: OriginConfig): Result<OriginTransport> {
  switch (config.transport) {
    case "mock":
      return ok(new MockOriginTransport({ offline: config.mockOffline }));
    case "http":
      try {
        return ok(new HttpOriginTransport({ baseUrl: config.baseUrl ?? "" }));
      } catch (error) {
        return fail("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error));
      }
    default:
      return ok(NONE_ORIGIN_TRANSPORT);
  }
}
