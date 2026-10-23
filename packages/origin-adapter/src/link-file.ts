import {
  fail,
  ok,
  type IntegrationStatus,
  type OriginCoreAdapter,
  type OriginPermission,
  type OriginProjectId,
  type OriginProjectRecord,
  type Result,
  type SyncState
} from "@studio/contracts";

/**
 * Workspace-relative location of the link file, with "/" separators. A folder
 * is linked to an ORIGIN project when this file holds a valid record.
 */
export const ORIGIN_LINK_FILE = ".origin/project.json";

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PERMISSIONS: readonly OriginPermission[] = ["read", "write", "admin"];
const MAX_NAME_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the content of a link file. Strict on purpose: anything the IDE
 * would later act on (id, permissions, revision) must be well-formed, and an
 * unreadable link is reported, never guessed.
 */
export function parseOriginLink(text: string): Result<OriginProjectRecord> {
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
  const problems: string[] = [];
  const { projectId, name, ownerId, permissions, revision } = raw;
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
    problems.push('"projectId" must be a short identifier (letters, numbers, ".", "_", ":" and "-").');
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME_LENGTH) {
    problems.push(`"name" must be text of at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (typeof ownerId !== "string" || ownerId.length === 0 || ownerId.length > MAX_NAME_LENGTH) {
    problems.push('"ownerId" must be text.');
  }
  let parsedPermissions: OriginPermission[] = ["read"];
  if (permissions !== undefined) {
    if (!Array.isArray(permissions) || !permissions.every((p) => PERMISSIONS.includes(p as OriginPermission))) {
      problems.push('"permissions" must be a list of "read", "write" or "admin".');
    } else {
      parsedPermissions = [...new Set(permissions as OriginPermission[])];
    }
  }
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || revision > Number.MAX_SAFE_INTEGER) {
    problems.push('"revision" must be a whole number of 0 or more.');
  }
  if (problems.length > 0) {
    return fail("INVALID_ARGUMENT", `${ORIGIN_LINK_FILE} is invalid: ${problems.join(" ")}`);
  }
  return ok({
    id: projectId as OriginProjectId,
    name: (name as string).trim(),
    ownerId: ownerId as string,
    permissions: parsedPermissions,
    revision: revision as number
  });
}

export interface LinkFileAdapterOptions {
  /**
   * Reads a file inside the workspace by workspace-relative path. Resolves to
   * null when it does not exist. Injected so the adapter stays platform-neutral
   * and so the host can apply its usual path confinement.
   */
  readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string | null>;
}

export const LINK_FILE_DETAIL = `ORIGIN Core (link file). Reads the project link from ${ORIGIN_LINK_FILE} in the workspace; read-only, no ORIGIN server connection yet.`;

/**
 * The first ORIGIN Core adapter: a folder is linked to an ORIGIN project by a
 * link file that ORIGIN (or a developer) places in it. The adapter only reads.
 * A real transport will replace the file lookup with an ORIGIN query while
 * keeping this contract, so the wiring in the IDE does not change.
 */
export function createLinkFileCoreAdapter(options: LinkFileAdapterOptions): OriginCoreAdapter {
  const links = new Map<string, OriginProjectRecord>();
  return {
    status(): IntegrationStatus {
      return { system: "origin-core", connected: true, detail: LINK_FILE_DETAIL };
    },
    async findLinkedProject(workspaceRoot: string): Promise<Result<OriginProjectRecord | null>> {
      let text: string | null;
      try {
        text = await options.readWorkspaceFile(workspaceRoot, ORIGIN_LINK_FILE);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return fail("UNKNOWN", `Could not read ${ORIGIN_LINK_FILE}: ${detail}`);
      }
      if (text === null) {
        return ok(null);
      }
      const parsed = parseOriginLink(text);
      if (parsed.ok) {
        links.set(parsed.value.id, parsed.value);
      }
      return parsed;
    },
    async syncState(projectId: OriginProjectId): Promise<Result<SyncState>> {
      const record = links.get(projectId);
      if (!record) {
        return fail("NOT_FOUND", "That ORIGIN project is not linked to an open workspace.");
      }
      // With no server to compare against, the revision in the link is the known state.
      return ok({ phase: "linked", revision: record.revision });
    }
  };
}
