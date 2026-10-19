import { useEffect, useRef, type KeyboardEvent } from "react";
import type { RelativePath, WorkspaceEntry } from "@studio/contracts";
import type { Explorer as ExplorerModel } from "./useExplorer";

interface ExplorerProps {
  title: string;
  explorer: ExplorerModel;
  dirtyPaths: ReadonlySet<RelativePath>;
  onOpenFile(path: RelativePath): void;
  onNewFile(): void;
  onNewFolder(): void;
  onRename(path: RelativePath): void;
  onDelete(path: RelativePath): void;
}

function nodeId(path: string): string {
  return `tree-${encodeURIComponent(path)}`;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function icon(entry: WorkspaceEntry, expanded: boolean): string {
  if (entry.kind === "directory") return expanded ? "codicon-folder-opened" : "codicon-folder";
  if (entry.kind === "symlink") return "codicon-file-symlink-file";
  return "codicon-file";
}

export function Explorer(props: ExplorerProps) {
  const { explorer } = props;
  const treeRef = useRef<HTMLDivElement>(null);
  const { rows, selected } = explorer;
  const selectedIndex = rows.findIndex((row) => row.entry.path === selected);

  useEffect(() => {
    if (selected !== null) {
      document.getElementById(nodeId(selected))?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  function activate(entry: WorkspaceEntry) {
    explorer.select(entry.path);
    if (entry.kind === "directory") {
      explorer.toggle(entry.path);
    } else if (entry.kind === "file") {
      props.onOpenFile(entry.path);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const row = rows[selectedIndex];
    const move = (index: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (target) explorer.select(target.entry.path);
    };
    switch (event.key) {
      case "ArrowDown":
        move(selectedIndex + 1);
        break;
      case "ArrowUp":
        move(selectedIndex <= 0 ? 0 : selectedIndex - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (row?.entry.kind === "directory") {
          if (!explorer.expanded.has(row.entry.path)) void explorer.expand(row.entry.path);
          else move(selectedIndex + 1);
        }
        break;
      case "ArrowLeft":
        if (row?.entry.kind === "directory" && explorer.expanded.has(row.entry.path)) {
          explorer.collapse(row.entry.path);
        } else if (row) {
          const parent = parentPath(row.entry.path);
          if (parent !== "") explorer.select(parent);
        }
        break;
      case "Enter":
      case " ":
        if (row) activate(row.entry);
        break;
      case "F2":
        if (row) props.onRename(row.entry.path);
        break;
      case "Delete":
        if (row) props.onDelete(row.entry.path);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <section className="explorer" aria-label="Explorer">
      <div className="pane-header">
        <span className="pane-title" title={props.title}>
          {props.title}
        </span>
        <div className="toolbar">
          <IconButton icon="codicon-new-file" label="New File (Ctrl+N)" onClick={props.onNewFile} />
          <IconButton icon="codicon-new-folder" label="New Folder" onClick={props.onNewFolder} />
          <IconButton
            icon="codicon-edit"
            label="Rename (F2)"
            disabled={selected === null}
            onClick={() => selected !== null && props.onRename(selected)}
          />
          <IconButton
            icon="codicon-trash"
            label="Delete (Del)"
            disabled={selected === null}
            onClick={() => selected !== null && props.onDelete(selected)}
          />
          <IconButton icon="codicon-refresh" label="Refresh Explorer" onClick={() => void explorer.refresh()} />
          <IconButton icon="codicon-collapse-all" label="Collapse All" onClick={explorer.collapseAll} />
        </div>
      </div>

      {explorer.errors[""] ? <p className="explorer-message error">{explorer.errors[""]}</p> : null}
      {explorer.rootLoaded && rows.length === 0 ? <p className="explorer-message">This folder is empty.</p> : null}

      <div
        ref={treeRef}
        className="tree"
        role="tree"
        aria-label="Files"
        tabIndex={0}
        aria-activedescendant={selected !== null && selectedIndex >= 0 ? nodeId(selected) : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (selected === null && rows[0]) explorer.select(rows[0].entry.path);
        }}
      >
        {rows.map(({ entry, depth }) => {
          const isExpanded = explorer.expanded.has(entry.path);
          const error = explorer.errors[entry.path];
          return (
            <div
              key={entry.path}
              id={nodeId(entry.path)}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={entry.path === selected}
              aria-expanded={entry.kind === "directory" ? isExpanded : undefined}
              className={`tree-row${entry.path === selected ? " selected" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={error ?? entry.path}
              data-path={entry.path}
              onClick={() => {
                treeRef.current?.focus();
                activate(entry);
              }}
            >
              <span className={`codicon ${entry.kind === "directory" ? (isExpanded ? "codicon-chevron-down" : "codicon-chevron-right") : "codicon-blank"}`} aria-hidden="true" />
              <span className={`codicon ${icon(entry, isExpanded)}`} aria-hidden="true" />
              <span className="tree-label">{entry.name}</span>
              {props.dirtyPaths.has(entry.path) ? <span className="dirty-dot" aria-label="unsaved changes">●</span> : null}
              {error ? <span className="codicon codicon-warning tree-error" aria-label={error} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function IconButton(props: { icon: string; label: string; onClick(): void; disabled?: boolean }) {
  return (
    <button type="button" className="icon-button" aria-label={props.label} title={props.label} disabled={props.disabled} onClick={props.onClick}>
      <span className={`codicon ${props.icon}`} aria-hidden="true" />
    </button>
  );
}
