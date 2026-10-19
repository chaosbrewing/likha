import type { WorkspaceInfo } from "@studio/contracts";

interface StatusBarProps {
  workspace: WorkspaceInfo | null;
  language: string | null;
  cursor: { line: number; column: number } | null;
  dirtyCount: number;
  message: string;
}

export function StatusBar({ workspace, language, cursor, dirtyCount, message }: StatusBarProps) {
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
        <span className="status-item" title="Everything runs locally. No ORIGIN account or internet connection is needed.">
          Local
        </span>
      </div>
    </footer>
  );
}
