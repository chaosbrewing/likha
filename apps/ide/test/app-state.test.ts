import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_WINDOW, loadAppState, sanitizeWindowState, saveAppState } from "../electron/app-state.ts";
import { commandForKey } from "../src/hooks/useShortcuts.ts";

const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const dir = mkdtempSync(path.join(os.tmpdir(), "studio-app-state-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("restores a window that is visible on a current display", () => {
  assert.deepEqual(sanitizeWindowState({ bounds: { x: 100, y: 50, width: 1000, height: 700 }, maximized: true }, screen), {
    bounds: { x: 100, y: 50, width: 1000, height: 700 },
    maximized: true
  });
});

test("drops the position of a window saved on a disconnected monitor", () => {
  const state = sanitizeWindowState({ bounds: { x: 3000, y: 0, width: 1000, height: 700 } }, screen);
  assert.deepEqual(state.bounds, { width: 1000, height: 700 });
});

test("enforces a minimum size and ignores garbage", () => {
  assert.deepEqual(sanitizeWindowState({ bounds: { width: 10, height: 10 } }, screen).bounds, { width: 640, height: 400 });
  assert.deepEqual(sanitizeWindowState("nonsense", screen), DEFAULT_WINDOW);
  assert.deepEqual(sanitizeWindowState({ bounds: { width: "big", x: NaN, y: 1 } }, screen).bounds, { width: 1280, height: 800 });
});

test("app state round-trips through an atomic write, and a corrupt file falls back to defaults", () => {
  const file = path.join(dir, "app-state.json");
  saveAppState(file, { window: { bounds: { x: 10, y: 10, width: 900, height: 600 }, maximized: false }, lastWorkspace: "C:\\code\\demo" });
  assert.deepEqual(readdirSync(dir), ["app-state.json"], "no temporary file left");
  const loaded = loadAppState(file, screen);
  assert.equal(loaded.lastWorkspace, "C:\\code\\demo");
  assert.deepEqual(loaded.window.bounds, { x: 10, y: 10, width: 900, height: 600 });

  writeFileSync(file, "{ not json");
  assert.deepEqual(loadAppState(file, screen), { window: DEFAULT_WINDOW, lastWorkspace: null });
});

test("keyboard shortcuts map to commands", () => {
  const key = (k: string, code: string, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) =>
    commandForKey({ key: k, code, ctrlKey: mods.ctrl ?? true, metaKey: false, shiftKey: mods.shift ?? false, altKey: mods.alt ?? false });
  assert.equal(key("s", "KeyS"), "save");
  assert.equal(key("S", "KeyS", { shift: true }), "save-as");
  assert.equal(key("o", "KeyO"), "open-folder");
  assert.equal(key("n", "KeyN"), "new-file");
  assert.equal(key("w", "KeyW"), "close-tab");
  assert.equal(key("`", "Backquote"), "toggle-panel");
  assert.equal(key("~", "Backquote", { shift: true }), "new-terminal");
  assert.equal(key("Tab", "Tab"), "next-tab");
  assert.equal(key("s", "KeyS", { ctrl: false }), null, "plain typing is never a shortcut");
  assert.equal(key("s", "KeyS", { alt: true }), null);
  assert.equal(key("f", "KeyF"), null, "find is left to the editor");
});
