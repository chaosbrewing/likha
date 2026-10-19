import { useEffect, useRef } from "react";
import type { MenuCommand } from "@studio/contracts";

export type ShortcutCommand = MenuCommand | "next-tab" | "previous-tab";

/** Maps a keydown event to an application command, or null. */
export function commandForKey(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "key" | "code">): ShortcutCommand | null {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.code === "Backquote") return event.shiftKey ? "new-terminal" : "toggle-panel";
  if (event.code === "Tab") return event.shiftKey ? "previous-tab" : "next-tab";
  if (event.shiftKey) {
    return key === "s" ? "save-as" : null;
  }
  switch (key) {
    case "o":
      return "open-folder";
    case "n":
      return "new-file";
    case "s":
      return "save";
    case "w":
      return "close-tab";
    default:
      return null;
  }
}

/**
 * Handles application shortcuts in the capture phase so they work wherever
 * focus is (editor, explorer or terminal). Disabled while a dialog is open.
 */
export function useShortcuts(run: (command: ShortcutCommand) => void, enabled: boolean): void {
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandForKey(event);
      if (command) {
        event.preventDefault();
        event.stopPropagation();
        runRef.current(command);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
