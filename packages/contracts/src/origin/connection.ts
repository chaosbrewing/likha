/*
 * ORIGIN connection lifecycle (Phase 7). The desktop host owns the credential
 * and the connection; the interface only ever sees the states below, never a
 * secret. See docs/integration/README.md.
 */
import type { Result } from "../result.js";
import type { OriginPermission, OriginProjectId, OriginProjectRecord } from "./index.js";

export const ORIGIN_CONNECTION_CONTRACT_VERSION = 1 as const;

/**
 * An ORIGIN API key: 64 lowercase hex characters, the format ORIGIN issues
 * (`apiKeys.create`) and validates (`validateApiKey`). Origin Studio uses it
 * for read access only.
 */
export const ORIGIN_API_KEY_PATTERN = /^[a-f0-9]{64}$/;

export interface OriginCredential {
  kind: "api-key";
  /** Host-only. Never sent to the interface, written to a project, or logged. */
  secret: string;
}

/** Who ORIGIN says the credential belongs to, and what it may read. */
export interface OriginIdentity {
  userId: string;
  displayName: string;
  /** Organisation the credential is scoped to, when any. */
  organisationId: string | null;
  /** Project the credential is scoped to, when it was issued for one project only. */
  projectId: OriginProjectId | null;
  /** The coarse view Origin Studio needs; always contains "read" for a usable credential. */
  permissions: OriginPermission[];
  /** When the credential stops working, if ORIGIN told us. ISO 8601. */
  expiresAt: string | null;
}

export type OriginUnauthorizedReason = "invalid" | "expired" | "revoked" | "forbidden";

export type OriginConnectionState =
  /** No credential is stored (never connected, or the user disconnected). */
  | { state: "disconnected"; detail: string }
  | { state: "connecting" }
  | { state: "connected"; identity: OriginIdentity; verifiedAt: string; transport: OriginTransportKind }
  /** ORIGIN rejected the credential. It has been forgotten; the user must connect again. */
  | { state: "unauthorized"; reason: OriginUnauthorizedReason; detail: string }
  /** ORIGIN could not be reached (offline, DNS, server error). The credential is kept; work continues locally. */
  | { state: "unavailable"; detail: string; lastConnectedAt: string | null };

export type OriginTransportKind = "mock" | "http" | "none";

/**
 * The wire to ORIGIN Core. Implementations: an HTTP client for ORIGIN's tRPC
 * procedures (not yet usable against a live ORIGIN, see docs), and a mock with
 * documented fixtures. Every method returns a Result:
 *   UNAUTHORIZED  the credential is invalid, expired or revoked (message says which)
 *   FORBIDDEN     the credential is valid but may not see that project
 *   NOT_FOUND     no such project
 *   UNAVAILABLE   ORIGIN could not be reached or answered with a server error
 */
export interface OriginTransport {
  readonly kind: OriginTransportKind;
  /** Where this transport talks to, for display (an origin, or a fixture name). Never a secret. */
  readonly target: string;
  whoAmI(credential: OriginCredential): Promise<Result<OriginIdentity>>;
  getProject(credential: OriginCredential, projectId: OriginProjectId): Promise<Result<OriginProjectRecord>>;
}

/** Where the host keeps the credential between runs. The desktop host encrypts it with the OS user's key. */
export interface CredentialVault {
  /** Human-readable description of the storage, for the status bar and logs. */
  readonly description: string;
  load(): Promise<string | null>;
  save(secret: string): Promise<Result<void>>;
  clear(): Promise<void>;
}

/* ---------- project link and resolution ---------- */

/**
 * What a workspace may say about its ORIGIN project: the id, plus optional
 * display hints. Hints are shown as unverified until ORIGIN confirms them;
 * ORIGIN's record is the only source of truth for name, owner and permissions.
 */
export interface OriginProjectLink {
  projectId: OriginProjectId;
  /** Display name hint from the link file; replaced by ORIGIN's name once verified. */
  nameHint: string | null;
}

export type OriginProjectResolution =
  /** ORIGIN confirmed the credential may read this project; `project` is ORIGIN's record. */
  | { status: "verified"; project: OriginProjectRecord; verifiedAt: string }
  /** Not connected, or ORIGIN unreachable: only the link's id (and hint) are known. */
  | { status: "unverified"; reason: "disconnected" | "unavailable"; detail: string }
  /** Connected, but this credential may not read the project, or ORIGIN has no such project. */
  | { status: "unauthorized"; reason: "forbidden" | "not-found" | "credential"; detail: string };
