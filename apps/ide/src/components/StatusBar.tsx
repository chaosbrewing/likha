import type { LanguageServerStatus, OriginConnectionState, OriginLinkState, WorkspaceInfo } from "@studio/contracts";

interface StatusBarProps {
  workspace: WorkspaceInfo | null;
  language: string | null;
  cursor: { line: number; column: number } | null;
  dirtyCount: number;
  message: string;
  languageServer: LanguageServerStatus;
  /** App-level ORIGIN connection (shown even before a folder opens, when the feature is on). */
  originConnection: OriginConnectionState | null;
}

function connectionLabel(connection: OriginConnectionState): { text: string; title: string; warning: boolean; icon: string } {
  switch (connection.state) {
    case "connected":
      return { text: `ORIGIN: ${connection.identity.displayName}`, title: `Connected to ORIGIN (${connection.transport}) as ${connection.identity.displayName}; verified ${connection.verifiedAt}. Read-only.`, warning: false, icon: "codicon-plug" };
    case "connecting":
      return { text: "ORIGIN: connecting…", title: "Verifying the credential with ORIGIN.", warning: false, icon: "codicon-sync codicon-modifier-spin" };
    case "unauthorized":
      return { text: `ORIGIN: sign in again (${connection.reason})`, title: `${connection.detail} The credential has been forgotten; use ORIGIN > Connect to ORIGIN…`, warning: true, icon: "codicon-warning" };
    case "unavailable":
      return { text: "ORIGIN: unavailable", title: `${connection.detail}${connection.lastConnectedAt ? ` Last connected ${connection.lastConnectedAt}.` : ""} Work continues locally.`, warning: true, icon: "codicon-debug-disconnect" };
    default:
      return { text: "ORIGIN: not connected", title: `${connection.detail} Use ORIGIN > Connect to ORIGIN…`, warning: false, icon: "codicon-debug-disconnect" };
  }
}

function linkLabel(link: OriginLinkState): { text: string; title: string; warning: boolean; status: string } {
  switch (link.kind) {
    case "none":
      return { text: "not linked", title: link.detail, warning: false, status: "none" };
    case "error":
      return { text: "link invalid", title: link.detail, warning: true, status: "error" };
    default: {
      const { link: projectLink, resolution } = link;
      if (resolution.status === "verified") {
        const { project } = resolution;
        return {
          text: `${project.name} ✓`,
          title: `Linked to ORIGIN project ${project.id} (${project.permissions.join("/")}, revision ${project.revision}); verified by ORIGIN ${resolution.verifiedAt}. Read-only.`,
          warning: false,
          status: "verified"
        };
      }
      if (resolution.status === "unauthorized") {
        return { text: `${projectLink.projectId} (no access)`, title: `${resolution.detail} The link file is not trusted until ORIGIN confirms it.`, warning: true, status: "unauthorized" };
      }
      return { text: `${projectLink.nameHint ?? projectLink.projectId} (unverified)`, title: `${resolution.detail} The link file names ${projectLink.projectId}; nothing from it is trusted until ORIGIN confirms it.`, warning: false, status: "unverified" };
    }
  }
}

function OriginItem({ workspace, connection }: { workspace: WorkspaceInfo | null; connection: OriginConnectionState | null }) {
  const origin = workspace?.origin;
  const featureOn = (origin && origin.feature === "on") || connection !== null;
  if (!featureOn) {
    return (
      <span className="status-item" data-origin="off" title="Everything runs locally. No ORIGIN account or internet connection is needed.">
        Local
      </span>
    );
  }
  const current = origin && origin.feature === "on" ? origin.connection : connection!;
  const conn = connectionLabel(current);
  const link = origin && origin.feature === "on" ? linkLabel(origin.link) : null;
  return (
    <>
      <span className={`status-item${conn.warning ? " warning" : ""}`} data-origin-connection={current.state} title={conn.title}>
        <span className={`codicon ${conn.icon}`} aria-hidden="true" /> {conn.text}
      </span>
      {link ? (
        <span className={`status-item${link.warning ? " warning" : ""}`} data-origin={link.status} title={link.title}>
          <span className={`codicon ${link.status === "verified" ? "codicon-link" : link.warning ? "codicon-warning" : "codicon-link"}`} aria-hidden="true" /> {link.text}
        </span>
      ) : null}
    </>
  );
}

function LanguageServerItem({ status, hasWorkspace }: { status: LanguageServerStatus; hasWorkspace: boolean }) {
  if (!hasWorkspace || status.state === "off") return null;
  switch (status.state) {
    case "starting":
      return (
        <span className="status-item" data-language-server="starting" title="The TypeScript language server is starting.">
          <span className="codicon codicon-sync codicon-modifier-spin" aria-hidden="true" /> TypeScript
        </span>
      );
    case "ready":
      return (
        <span className="status-item" data-language-server="ready" title={`TypeScript ${status.version} language server: project-wide diagnostics, completion and navigation.`}>
          <span className="codicon codicon-check" aria-hidden="true" /> TypeScript {status.version}
        </span>
      );
    default:
      return (
        <span className="status-item warning" data-language-server={status.state} title={`${status.detail} Editing works; TypeScript intelligence covers open files only.`}>
          <span className="codicon codicon-warning" aria-hidden="true" /> TypeScript: {status.state}
        </span>
      );
  }
}

export function StatusBar({ workspace, language, cursor, dirtyCount, message, languageServer, originConnection }: StatusBarProps) {
  const project = workspace?.project;
  const projectLabel =
    project?.state === "valid"
      ? "Origin Studio project"
      : project?.state === "invalid"
        ? "Project configuration invalid"
        : workspace
          ? "Folder"
          : null;

  return (
    <footer className="status-bar" aria-label="Status bar">
      <div className="status-group">
        {workspace ? (
          <span className="status-item" title={workspace.rootPath}>
            <span className="codicon codicon-root-folder" aria-hidden="true" /> {workspace.name}
          </span>
        ) : (
          <span className="status-item">No folder open</span>
        )}
        {projectLabel ? (
          <span
            className={`status-item${project?.state === "invalid" ? " warning" : ""}`}
            title={project?.state === "invalid" ? project.problems.join("\n") : undefined}
          >
            {projectLabel}
          </span>
        ) : null}
        {workspace?.branch ? (
          <span className="status-item" title="Git branch">
            <span className="codicon codicon-git-branch" aria-hidden="true" /> {workspace.branch}
          </span>
        ) : null}
      </div>
      <div className="status-group">
        <span className="status-item" role="status" aria-live="polite">
          {message}
        </span>
        {dirtyCount > 0 ? <span className="status-item">{dirtyCount} unsaved</span> : null}
        {cursor ? (
          <span className="status-item">
            Ln {cursor.line}, Col {cursor.column}
          </span>
        ) : null}
        {language ? <span className="status-item">{language}</span> : null}
        <LanguageServerItem status={languageServer} hasWorkspace={workspace !== null} />
        <OriginItem workspace={workspace} connection={originConnection} />
      </div>
    </footer>
  );
}
