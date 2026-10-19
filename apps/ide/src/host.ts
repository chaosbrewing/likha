import type { StudioHostApi } from "@studio/contracts";

declare global {
  interface Window {
    /** Provided by the desktop host's preload script. Absent in a plain browser. */
    studio?: StudioHostApi;
  }
}

/**
 * The interface only talks to its host through StudioHostApi, never through
 * Electron directly, so it can later run on another host (browser, ORIGIN).
 */
export function getHost(): StudioHostApi | null {
  return window.studio ?? null;
}
