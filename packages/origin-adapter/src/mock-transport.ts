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

/**
 * Documented fixtures for the mock ORIGIN transport. The keys are valid in
 * format only; they mean nothing to a real ORIGIN. Used by tests, by
 * `ORIGIN_STUDIO_ORIGIN_TRANSPORT=mock`, and described in docs/integration.
 */
export const MOCK_ORIGIN_KEYS = {
  /** Owner of proj_42 and proj_7 (read, write, admin). */
  owner: "a".repeat(64),
  /** Read-only member of proj_42 only. */
  reader: "b".repeat(64),
  /** Rejected: expired on 2026-01-01. */
  expired: "c".repeat(64),
  /** Rejected: revoked in ORIGIN. */
  revoked: "d".repeat(64),
  /** Accepted, but grants no read permission at all. */
  noRead: "e".repeat(64)
} as const;

export const MOCK_ORIGIN_PROJECTS: Record<string, { name: string; ownerId: string; revision: number; members: Record<string, OriginPermission[]> }> = {
  proj_42: { name: "Binhi Site", ownerId: "user_owner", revision: 7, members: { user_owner: ["read", "write", "admin"], user_reader: ["read"] } },
  proj_7: { name: "Agos Pipeline", ownerId: "user_owner", revision: 2, members: { user_owner: ["read", "write", "admin"] } }
};

interface MockKey {
  identity: OriginIdentity;
  rejection?: { code: "UNAUTHORIZED"; message: string };
}

const KEYS: Record<string, MockKey> = {
  [MOCK_ORIGIN_KEYS.owner]: {
    identity: { userId: "user_owner", displayName: "Mock Owner", organisationId: "org_1", projectId: null, permissions: ["read", "write", "admin"], expiresAt: null }
  },
  [MOCK_ORIGIN_KEYS.reader]: {
    identity: { userId: "user_reader", displayName: "Mock Reader", organisationId: "org_1", projectId: "proj_42" as OriginProjectId, permissions: ["read"], expiresAt: "2030-01-01T00:00:00.000Z" }
  },
  [MOCK_ORIGIN_KEYS.expired]: {
    identity: { userId: "user_expired", displayName: "Expired", organisationId: null, projectId: null, permissions: ["read"], expiresAt: "2026-01-01T00:00:00.000Z" },
    rejection: { code: "UNAUTHORIZED", message: "API key has expired." }
  },
  [MOCK_ORIGIN_KEYS.revoked]: {
    identity: { userId: "user_revoked", displayName: "Revoked", organisationId: null, projectId: null, permissions: ["read"], expiresAt: null },
    rejection: { code: "UNAUTHORIZED", message: "API key is not active (revoked)." }
  },
  [MOCK_ORIGIN_KEYS.noRead]: {
    identity: { userId: "user_noread", displayName: "No Read", organisationId: null, projectId: null, permissions: [], expiresAt: null }
  }
};

export interface MockTransportOptions {
  /** When true every call fails with UNAVAILABLE, like a lost network. Can be changed at run time. */
  offline?: boolean;
  /** Keys revoked after issue; `whoAmI` then rejects them. */
  revoked?: Set<string>;
  /** Simulated latency, for tests of concurrent state changes. */
  delayMs?: number;
}

/** An in-memory ORIGIN with the fixtures above. Nothing leaves the process. */
export class MockOriginTransport implements OriginTransport {
  readonly kind = "mock" as const;
  readonly target = "mock fixtures";
  offline: boolean;
  readonly revoked: Set<string>;
  private readonly delayMs: number;
  calls: { method: string; key: string }[] = [];

  constructor(options: MockTransportOptions = {}) {
    this.offline = options.offline ?? false;
    this.revoked = options.revoked ?? new Set();
    this.delayMs = options.delayMs ?? 0;
  }

  private async gate(method: string, credential: OriginCredential): Promise<Result<MockKey>> {
    this.calls.push({ method, key: credential.secret.slice(0, 4) }); // Never the whole key, even in a mock.
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.offline) return fail("UNAVAILABLE", "ORIGIN could not be reached (mock offline).");
    const entry = KEYS[credential.secret];
    if (!entry) return fail("UNAUTHORIZED", "Invalid API key.");
    if (entry.rejection) return fail(entry.rejection.code, entry.rejection.message);
    if (this.revoked.has(credential.secret)) return fail("UNAUTHORIZED", "API key is not active (revoked).");
    return ok(entry);
  }

  async whoAmI(credential: OriginCredential): Promise<Result<OriginIdentity>> {
    const entry = await this.gate("whoAmI", credential);
    return entry.ok ? ok({ ...entry.value.identity, permissions: [...entry.value.identity.permissions] }) : entry;
  }

  async getProject(credential: OriginCredential, projectId: OriginProjectId): Promise<Result<OriginProjectRecord>> {
    const entry = await this.gate("getProject", credential);
    if (!entry.ok) return entry;
    const project = MOCK_ORIGIN_PROJECTS[projectId];
    if (!project) return fail("NOT_FOUND", `ORIGIN has no project "${projectId}".`);
    const identity = entry.value.identity;
    if (identity.projectId && identity.projectId !== projectId) {
      return fail("FORBIDDEN", `This credential is limited to project ${identity.projectId}.`);
    }
    const permissions = project.members[identity.userId];
    if (!permissions) return fail("FORBIDDEN", `You are not a member of "${project.name}".`);
    return ok({ id: projectId, name: project.name, ownerId: project.ownerId, permissions: [...permissions], revision: project.revision });
  }
}
