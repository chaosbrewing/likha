import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: { x?: number; y?: number; width: number; height: number };
  maximized: boolean;
}

export interface AppState {
  window: WindowState;
  /** Folder that was open when the app last closed. */
  lastWorkspace: string | null;
}

export const DEFAULT_WINDOW: WindowState = { bounds: { width: 1280, height: 800 }, maximized: false };
const MIN_WIDTH = 640;
const MIN_HEIGHT = 400;
/** A restored window must overlap a display by at least this much to be reachable. */
const MIN_VISIBLE = 100;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates persisted window state against the current displays so a window
 * saved on a disconnected monitor never opens off-screen.
 */
export function sanitizeWindowState(raw: unknown, workAreas: Rect[]): WindowState {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_WINDOW;
  }
  const value = raw as { bounds?: Record<string, unknown>; maximized?: unknown };
  const bounds = value.bounds ?? {};
  const width = finite(bounds.width) ? Math.max(MIN_WIDTH, Math.round(bounds.width)) : DEFAULT_WINDOW.bounds.width;
  const height = finite(bounds.height) ? Math.max(MIN_HEIGHT, Math.round(bounds.height)) : DEFAULT_WINDOW.bounds.height;
  const result: WindowState = { bounds: { width, height }, maximized: value.maximized === true };

  if (finite(bounds.x) && finite(bounds.y)) {
    const x = Math.round(bounds.x);
    const y = Math.round(bounds.y);
    const visible = workAreas.some((area) => {
      const overlapX = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
      const overlapY = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
      return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE;
    });
    if (visible) {
      result.bounds.x = x;
      result.bounds.y = y;
    }
  }
  return result;
}

export function loadAppState(file: string, workAreas: Rect[]): AppState {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      window: sanitizeWindowState(value.window, workAreas),
      lastWorkspace: typeof value.lastWorkspace === "string" ? value.lastWorkspace : null
    };
  } catch {
    return { window: sanitizeWindowState(null, workAreas), lastWorkspace: null };
  }
}

/** Writes atomically so a crash mid-write cannot corrupt the settings file. */
export function saveAppState(file: string, state: AppState): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}
