import type { LanguageServerStatus, WorkspaceInfo } from "@studio/contracts";

interface StatusBarProps {
  workspace: WorkspaceInfo | null;
  language: string | null;
  cursor: { line: number; column: number } | null;
  dirtyCount: number;
  message: string;
  languageServer: LanguageServerStatus;
}

function OriginItem({ workspace }: { workspace: WorkspaceInfo | null }) {
  const origin = workspace?.origin;
  if (!origin || origin.feature === "off") {
    return (
      <span className="status-item" data-origin="off" title="Everything runs locally. No ORIGIN account or internet connection is needed.">
        Local
      </span>
    );
  }
  if (origin.link === "linked") {
    const { project } = origin;
    const revision = origin.sync?.phase === "linked" ? origin.sync.revision : project.revision;
    return (
      <span
        className="status-item"
        data-origin="linked"
        title={`Linked to ORIGIN project ${project.id} (revision ${revision}, ${project.permissions.join("/")}). Read-only: Origin Studio reads the link and never writes to ORIGIN.\n${origin.detail}`}
      >
        <span className="codicon codicon-link" aria-hidden="true" /> ORIGIN: {project.name}
      </span>
    );
  }
  if (origin.link === "none") {
    return (
      <span className="status-item" data-origin="none" title={origin.detail}>
        ORIGIN: not linked
      </span>
    );
  }
  return (
    <span className="status-item warning" data-origin="error" title={origin.detail}>
      <span className="codicon codicon-warning" aria-hidden="true" /> ORIGIN: link invalid
    </span>
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

export function StatusBar({ workspace, language, cursor, dirtyCount, message, languageServer }: StatusBarProps) {
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
        <OriginItem workspace={workspace} />
      </div>
    </footer>
  );
}
