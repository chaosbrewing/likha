import { watch, type FSWatcher } from "node:fs";
import type { RelativePath, WorkspaceChangeEvent } from "@studio/contracts";

export interface WorkspaceWatcher {
  close(): void;
}

export interface WatchOptions {
  /** Changes are batched for this long. Default 150 ms. */
  debounceMs?: number;
  /** Above this many paths a batch is reported as an overflow. Default 500. */
  maxPaths?: number;
  onError?(error: Error): void;
}

/** Paths that never matter to the interface: Git internals (except HEAD) and our own temp files. */
export function isIgnoredChange(relPath: RelativePath): boolean {
  if (relPath === ".git" || relPath.startsWith(".git/")) {
    return relPath !== ".git/HEAD";
  }
  return relPath.endsWith(".origin-tmp");
}

/**
 * Watches a workspace folder recursively and reports batched, workspace-
 * relative changed paths. The interface decides what to refresh; the watcher
 * never reads or changes files.
 */
export function watchWorkspace(
  root: string,
  onChange: (event: WorkspaceChangeEvent) => void,
  options: WatchOptions = {}
): WorkspaceWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const maxPaths = options.maxPaths ?? 500;
  let pending = new Set<RelativePath>();
  let overflow = false;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const flush = () => {
    timer = null;
    if (closed || (pending.size === 0 && !overflow)) return;
    const event: WorkspaceChangeEvent = { paths: overflow ? [] : [...pending].sort(), overflow };
    pending = new Set();
    overflow = false;
    onChange(event);
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (closed) return;
      if (filename === null) {
        overflow = true; // The platform did not say what changed.
      } else {
        const relPath = String(filename).split(/[\\/]/).join("/");
        if (isIgnoredChange(relPath)) return;
        pending.add(relPath);
        if (pending.size > maxPaths) overflow = true;
      }
      timer ??= setTimeout(flush, debounceMs);
    });
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
    return { close() {} };
  }

  watcher.on("error", (error) => {
    options.onError?.(error);
    close();
  });

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    watcher.close();
  }

  return { close };
}
