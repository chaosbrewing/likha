import { useCallback, useMemo, useState } from "react";
import type { RelativePath, StudioHostApi, WorkspaceEntry } from "@studio/contracts";

export interface TreeRow {
  entry: WorkspaceEntry;
  depth: number;
}

export interface Explorer {
  rows: TreeRow[];
  expanded: ReadonlySet<RelativePath>;
  selected: RelativePath | null;
  errors: Record<RelativePath, string>;
  rootLoaded: boolean;
  select(path: RelativePath | null): void;
  toggle(path: RelativePath): void;
  expand(path: RelativePath): Promise<void>;
  collapse(path: RelativePath): void;
  collapseAll(): void;
  reload(path: RelativePath): Promise<void>;
  refresh(): Promise<void>;
  reset(): Promise<void>;
  entry(path: RelativePath): WorkspaceEntry | undefined;
}

function flatten(children: Record<string, WorkspaceEntry[]>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (path: string, depth: number) => {
    for (const entry of children[path] ?? []) {
      rows.push({ entry, depth });
      if (entry.kind === "directory" && expanded.has(entry.path)) {
        walk(entry.path, depth + 1);
      }
    }
  };
  walk("", 0);
  return rows;
}

/** Lazily loaded folder tree: a folder's contents are listed when it is expanded. */
export function useExplorer(host: StudioHostApi): Explorer {
  const [children, setChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reload = useCallback(
    async (path: string) => {
      const result = await host.workspace.list(path);
      if (result.ok) {
        setChildren((current) => ({ ...current, [path]: result.value }));
        setErrors((current) => {
          const { [path]: _removed, ...rest } = current;
          return rest;
        });
      } else if (result.error.code === "NOT_FOUND" && path !== "") {
        // The folder disappeared: forget it rather than show a stale error.
        setChildren((current) => {
          const { [path]: _removed, ...rest } = current;
          return rest;
        });
        setExpanded((current) => new Set([...current].filter((p) => p !== path)));
      } else {
        setErrors((current) => ({ ...current, [path]: result.error.message }));
      }
    },
    [host]
  );

  const expand = useCallback(
    async (path: string) => {
      setExpanded((current) => new Set(current).add(path));
      await reload(path);
    },
    [reload]
  );

  const collapse = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (path: string) => {
      if (expanded.has(path)) {
        collapse(path);
      } else {
        void expand(path);
      }
    },
    [collapse, expand, expanded]
  );

  const refresh = useCallback(async () => {
    await Promise.all(["", ...expanded].map((path) => reload(path)));
  }, [expanded, reload]);

  const reset = useCallback(async () => {
    setChildren({});
    setExpanded(new Set());
    setSelected(null);
    setErrors({});
    await reload("");
  }, [reload]);

  const rows = useMemo(() => flatten(children, expanded), [children, expanded]);
  const byPath = useMemo(() => new Map(rows.map((row) => [row.entry.path, row.entry])), [rows]);

  return {
    rows,
    expanded,
    selected,
    errors,
    rootLoaded: children[""] !== undefined,
    select: setSelected,
    toggle,
    expand,
    collapse,
    collapseAll: () => setExpanded(new Set()),
    reload,
    refresh,
    reset,
    entry: (path) => byPath.get(path)
  };
}
