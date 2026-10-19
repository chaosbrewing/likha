// Smoke test of the PACKAGED app (release/dist/win-unpacked/OriginStudio.exe).
// Run `npm run build` and `npm run package` first.
//
// The release build has Electron fuses that disable Node's --inspect and
// ELECTRON_RUN_AS_NODE, so Playwright's Electron launcher cannot attach. The
// test starts the executable itself and drives the window over the Chrome
// DevTools Protocol instead, which exercises exactly what a user installs.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { getStarterFiles } from "@studio/core";

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const exe = path.join(appDir, "release", "dist", "win-unpacked", "OriginStudio.exe");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "origin-studio-packaged-"));
const workspace = path.join(tempRoot, "packaged-project");
const userData = path.join(tempRoot, "user-data");
let child: ChildProcess | null = null;

after(() => {
  if (child && child.exitCode === null && child.pid) {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

mkdirSync(workspace);
for (const file of getStarterFiles("packaged-project")) {
  const target = path.join(workspace, ...file.path.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.contents);
}

test("the packaged executable starts, opens a project, edits a file and runs a shell", { timeout: 180_000, skip: !existsSync(exe) && `missing ${exe}: run npm run package` }, async () => {
  child = spawn(exe, ["--remote-debugging-port=0", `--folder=${workspace}`], {
    env: { ...process.env, ORIGIN_STUDIO_USER_DATA: userData },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let stderr = "";
    child!.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (match) resolve(match[1]!);
    });
    child!.on("exit", (code) => reject(new Error(`exited early with code ${code}: ${stderr}`)));
    setTimeout(() => reject(new Error(`no DevTools endpoint after 30s: ${stderr}`)), 30_000);
  });

  const browser = await chromium.connectOverCDP(wsUrl);
  try {
    const page = browser.contexts()[0]?.pages()[0] ?? (await browser.contexts()[0]!.waitForEvent("page"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    // Loaded from the packaged app:// origin with the project open.
    await page.locator('.tree-row[data-path="src"]').waitFor({ timeout: 30_000 });
    assert.equal(await page.evaluate(() => location.origin), "app://studio");
    assert.match(await page.title(), /packaged-project - Origin Studio/);
    assert.match(await page.locator(".status-bar").innerText(), /Origin Studio project/);
    assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), "undefined");

    // Edit and save through the real file service.
    await page.locator('.tree-row[data-path="src"]').click();
    await page.locator('.tree-row[data-path="src/index.ts"]').click();
    await page.locator(".monaco-editor .view-lines").filter({ hasText: "greet" }).waitFor({ timeout: 30_000 });
    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n// packaged");
    await page.keyboard.press("Control+S");
    await page.waitForFunction(() => !document.querySelector('.tab[data-path="src/index.ts"]')?.classList.contains("dirty"));
    assert.match(readFileSync(path.join(workspace, "src", "index.ts"), "utf8"), /\/\/ packaged\n?$/);

    // node-pty is unpacked from the asar and a real shell runs.
    await page.keyboard.press("Control+Shift+Backquote");
    await page.locator(".terminal-instance .xterm").waitFor({ timeout: 30_000 });
    await page.locator(".terminal-instance .xterm-helper-textarea").focus();
    await page.waitForTimeout(1500);
    await page.keyboard.type('node -e "console.log(\'packaged-ok-\' + (2 + 3))"\r');
    await page.locator(".terminal-instance .xterm-rows").filter({ hasText: "packaged-ok-5" }).waitFor({ timeout: 30_000 });

    assert.deepEqual(errors, []);

    // Closing the window ends the process (nothing unsaved, so no prompt).
    const exited = new Promise<number | null>((resolve) => child!.once("exit", resolve));
    await page.evaluate(() => window.close());
    assert.equal(await exited, 0);
    const state = JSON.parse(readFileSync(path.join(userData, "app-state.json"), "utf8"));
    assert.equal(path.resolve(state.lastWorkspace), path.resolve(workspace));
  } finally {
    await browser.close().catch(() => undefined);
  }
});
