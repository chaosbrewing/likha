import {
  ORIGIN_CORE_CONTRACT_VERSION,
  fail,
  ok,
  type IntegrationStatus,
  type OriginCoreAdapter,
  type OriginCredential,
  type OriginProjectId,
  type OriginProjectLink,
  type OriginProjectResolution,
  type OriginTransport,
  type Result,
  type SyncState
} from "@studio/contracts";

/**
 * Workspace-relative location of the link file, with "/" separators. A folder
 * is linked to an ORIGIN project when this file names one.
 */
export const ORIGIN_LINK_FILE = ".origin/project.json";

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_NAME_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a link file. Only `projectId` is required; `name` is an optional
 * display hint. Phase 6 files that also carried ownerId, permissions and
 * revision are accepted, but those fields are ignored: ORIGIN is the source of
 * truth for them, and the IDE never copies them back.
 */
export function parseOriginLink(text: string): Result<OriginProjectLink> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail("INVALID_ARGUMENT", `${ORIGIN_LINK_FILE} is not valid JSON: ${detail}`);
  }
  if (!isRecord(raw)) {
    return fail("INVALID_ARGUMENT", `${ORIGIN_LINK_FILE} must contain a JSON object.`);
  }
  const { projectId, name } = raw;
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
    return fail("INVALID_ARGUMENT", `${ORIGIN_LINK_FILE} is invalid: "projectId" must be a short identifier (letters, numbers, ".", "_", ":" and "-").`);
  }
  let nameHint: string | null = null;
  if (name !== undefined) {
    if (typeof name !== "string" || name.length > MAX_NAME_LENGTH) {
      return fail("INVALID_ARGUMENT", `${ORIGIN_LINK_FILE} is invalid: "name" must be text of at most ${MAX_NAME_LENGTH} characters.`);
    }
    nameHint = name.trim() || null;
  }
  return ok({ projectId: projectId as OriginProjectId, nameHint });
}

export interface LinkFileAdapterOptions {
  /**
   * Reads a file inside the workspace by workspace-relative path. Resolves to
   * null when it does not exist. Injected so the adapter stays platform-neutral
   * and so the host can apply its usual path confinement.
   */
  readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string | null>;
  /** Where project records come from. */
  transport: OriginTransport;
  now?: () => Date;
}

/**
 * ORIGIN Core v2: the link file names the project, ORIGIN (through the
 * transport) confirms it. Read-only: nothing is written to ORIGIN or the file.
 */
export function createLinkFileCoreAdapter(options: LinkFileAdapterOptions): OriginCoreAdapter {
  const now = options.now ?? (() => new Date());
  const verified = new Map<string, number>();
  return {
    status(): IntegrationStatus {
      const transport = options.transport.kind;
      return {
        system: "origin-core",
        connected: transport !== "none",
        transport,
        contractVersion: ORIGIN_CORE_CONTRACT_VERSION,
        detail:
          transport === "none"
            ? `Reads the project link from ${ORIGIN_LINK_FILE}; no ORIGIN server is configured, so links stay unverified.`
            : `Reads the project link from ${ORIGIN_LINK_FILE} and verifies it with ORIGIN (${transport}: ${options.transport.target}). Read-only.`
      };
    },
    async findLink(workspaceRoot: string): Promise<Result<OriginProjectLink | null>> {
      let text: string | null;
      try {
        text = await options.readWorkspaceFile(workspaceRoot, ORIGIN_LINK_FILE);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return fail("UNKNOWN", `Could not read ${ORIGIN_LINK_FILE}: ${detail}`);
      }
      return text === null ? ok(null) : parseOriginLink(text);
    },
    async resolveProject(link: OriginProjectLink, credential: OriginCredential | null): Promise<Result<OriginProjectResolution>> {
      if (options.transport.kind === "none") {
        return ok({ status: "unverified", reason: "disconnected", detail: "No ORIGIN server is configured; the link cannot be verified." });
      }
      if (!credential) {
        return ok({ status: "unverified", reason: "disconnected", detail: "Connect to ORIGIN to verify this link." });
      }
      const result = await options.transport.getProject(credential, link.projectId);
      if (result.ok) {
        verified.set(link.projectId, result.value.revision);
        return ok({ status: "verified", project: result.value, verifiedAt: now().toISOString() });
      }
      switch (result.error.code) {
        case "FORBIDDEN":
          return ok({ status: "unauthorized", reason: "forbidden", detail: result.error.message });
        case "NOT_FOUND":
          return ok({ status: "unauthorized", reason: "not-found", detail: result.error.message });
        case "UNAUTHORIZED":
          return ok({ status: "unauthorized", reason: "credential", detail: result.error.message });
        default:
          return ok({ status: "unverified", reason: "unavailable", detail: result.error.message });
      }
    },
    async syncState(projectId: OriginProjectId): Promise<Result<SyncState>> {
      const revision = verified.get(projectId);
      if (revision === undefined) {
        return fail("NOT_FOUND", "That ORIGIN project has not been verified in this session.");
      }
      // Phase 7 is read-only: the verified revision is the known state; nothing is synchronised.
      return ok({ phase: "linked", revision });
    }
  };
}
