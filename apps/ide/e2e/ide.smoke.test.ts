// UI-level smoke test of the primary journey, run against the built app
// (npm run build, then npm run test:e2e). It launches the real Electron app
// with an isolated settings folder and a temporary project.
//
// Note: the delete step moves one small temporary file to the system
// Recycle Bin, because that is what the app does.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import type { StudioHostApi } from "@studio/contracts";
import { getStarterFiles } from "@studio/core";

// path.resolve drops the trailing separator; "C:\app\" would escape the closing quote on Windows.
const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "origin-studio-e2e-"));
const workspace = path.join(tempRoot, "smoke-project");
const userData = path.join(tempRoot, "user-data");
const screenshots = process.env.E2E_SCREENSHOT_DIR ?? null;
const launched: ElectronApplication[] = [];
after(async () => {
  // A failed test may leave its app running (and watching the folder); end it before cleanup.
  for (const app of launched) await app.close().catch(() => undefined);
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

mkdirSync(workspace);
for (const file of getStarterFiles("smoke-project")) {
  const target = path.join(workspace, ...file.path.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.contents);
}
writeFileSync(path.join(workspace, "logo.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]));
writeFileSync(path.join(tempRoot, "outside.txt"), "secret");

const indexFile = path.join(workspace, "src", "index.ts");

async function launch(args: string[]): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  // The test runner's own variables (test context, tsx loader) must not leak into Electron's Node.
  const { NODE_TEST_CONTEXT: _context, NODE_OPTIONS: _options, ...env } = process.env;
  const app = await electron.launch({
    args: [appDir, ...args],
    env: { ...env, ORIGIN_STUDIO_USER_DATA: userData } as Record<string, string>
  });
  launched.push(app);
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { app, page, errors };
}

async function shot(page: Page, name: string) {
  if (screenshots) await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
}

async function closeWindow(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

test("primary development journey", { timeout: 240_000 }, async () => {
  const { app, page, errors } = await launch([`--folder=${workspace}`]);

  // 1. Launch with the project open.
  await page.locator('.tree-row[data-path="src"]').waitFor();
  assert.match(await page.title(), /smoke-project - Origin Studio/);
  assert.match(await page.locator(".status-bar").innerText(), /Origin Studio project/);
  await shot(page, "01-launched");

  // 2. Security boundary seen from the interface.
  const probe = await page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const studio = (window as unknown as { studio: StudioHostApi }).studio;
    return {
      require: typeof w.require,
      process: typeof w.process,
      traversal: await studio.workspace.readFile("../outside.txt"),
      absolute: await studio.workspace.readFile("C:/Windows/win.ini"),
      unconfirmedDelete: await studio.workspace.delete("src/index.ts", false as unknown as true),
      badShell: await studio.terminal.create({ shell: "evil" as never, cols: 80, rows: 24 })
    };
  });
  assert.equal(probe.require, "undefined");
  assert.equal(probe.process, "undefined");
  assert.equal(!probe.traversal.ok && probe.traversal.error.code, "OUTSIDE_WORKSPACE");
  assert.equal(!probe.absolute.ok && probe.absolute.error.code, "OUTSIDE_WORKSPACE");
  assert.equal(!probe.unconfirmedDelete.ok && probe.unconfirmedDelete.error.code, "INVALID_ARGUMENT");
  assert.equal(!probe.badShell.ok && probe.badShell.error.code, "INVALID_ARGUMENT");
  assert.ok(existsSync(indexFile));

  // 3. Browse and open a file.
  await page.locator('.tree-row[data-path="src"]').click();
  await page.locator('.tree-row[data-path="src/index.ts"]').click();
  const tab = page.locator('.tab[data-path="src/index.ts"]');
  await tab.waitFor();
  await page.locator(".monaco-editor .view-lines").filter({ hasText: "greet" }).waitFor();
  assert.match(await page.locator(".status-bar").innerText(), /TypeScript/);

  // 4. Edit and save.
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// edited by smoke test");
  await page.waitForFunction(() => document.querySelector('.tab[data-path="src/index.ts"]')?.classList.contains("dirty"));
  await shot(page, "02-edited");
  await page.keyboard.press("Control+S");
  await page.waitForFunction(() => !document.querySelector('.tab[data-path="src/index.ts"]')?.classList.contains("dirty"));
  assert.match(readFileSync(indexFile, "utf8"), /\/\/ edited by smoke test\n?$/);

  // 5. A change made outside the IDE is never silently overwritten.
  writeFileSync(indexFile, "// external change\n");
  await page.keyboard.type(" (mine)");
  await page.keyboard.press("Control+S");
  await page.getByRole("dialog").or(page.getByRole("alertdialog")).getByText("File changed on disk").waitFor();
  await shot(page, "03-conflict");
  await page.getByRole("button", { name: "Cancel" }).click();
  assert.equal(readFileSync(indexFile, "utf8"), "// external change\n");
  assert.ok(await tab.evaluate((el) => el.classList.contains("dirty")), "edit stays unsaved");

  // 6. Binary files are refused safely.
  await page.locator('.tree-row[data-path="logo.bin"]').click();
  await page.getByText("File not opened").waitFor();
  await page.getByRole("button", { name: "OK" }).click();
  assert.equal(await page.locator('.tab[data-path="logo.bin"]').count(), 0);

  // 7. Create, reject an invalid name, rename and delete.
  await page.locator('.tree-row[data-path="README.md"]').click();
  await page.keyboard.press("Control+N");
  const input = page.getByRole("dialog").locator("input");
  await input.fill("bad:name");
  assert.ok(await page.getByRole("button", { name: "Create" }).isDisabled());
  await input.fill("notes.md");
  await page.keyboard.press("Enter");
  await page.locator('.tab[data-path="notes.md"]').waitFor();
  assert.ok(existsSync(path.join(workspace, "notes.md")));

  await page.locator('.tree-row[data-path="notes.md"]').click();
  await page.keyboard.press("F2");
  await page.getByRole("dialog").locator("input").fill("renamed.md");
  await page.keyboard.press("Enter");
  await page.locator('.tab[data-path="renamed.md"]').waitFor();
  assert.ok(existsSync(path.join(workspace, "renamed.md")));
  assert.ok(!existsSync(path.join(workspace, "notes.md")));

  await page.locator('.tree-row[data-path="renamed.md"]').click();
  await page.keyboard.press("Delete");
  await page.getByText("Move \"renamed.md\" to the Recycle Bin?").waitFor();
  await shot(page, "04-delete-confirm");
  await page.getByRole("button", { name: "Move to Recycle Bin" }).click();
  await page.locator('.tree-row[data-path="renamed.md"]').waitFor({ state: "detached" });
  assert.ok(!existsSync(path.join(workspace, "renamed.md")));
  assert.equal(await page.locator('.tab[data-path="renamed.md"]').count(), 0);

  // 8. Integrated terminal runs a command in the project folder.
  await page.keyboard.press("Control+Shift+Backquote");
  await page.locator(".terminal-instance .xterm").waitFor();
  await page.locator(".terminal-instance .xterm-helper-textarea").focus();
  await page.waitForTimeout(1500); // let the shell print its prompt
  await page.keyboard.type('node -e "console.log(\'origin-smoke-\' + (6 * 7), process.cwd())"\r');
  await page.locator(".terminal-instance .xterm-rows").filter({ hasText: "origin-smoke-42" }).waitFor({ timeout: 30_000 });
  const terminalText = await page.locator(".terminal-instance .xterm-rows").innerText();
  assert.ok(terminalText.replace(/\s+/g, "").includes("smoke-project"), "terminal starts in the project folder");
  await shot(page, "05-terminal");

  // 9. Closing with unsaved changes asks first; Cancel keeps the window open.
  await closeWindow(app);
  await page.getByText("1 file has unsaved changes").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();
  assert.equal(await page.locator(".app").count(), 1);

  await closeWindow(app);
  await page.getByText("1 file has unsaved changes").waitFor();
  const closed = app.waitForEvent("close");
  await page.getByRole("button", { name: "Don't Save" }).click();
  await closed;

  assert.equal(readFileSync(indexFile, "utf8"), "// external change\n", "discarded edits never reach the disk");
  assert.deepEqual(errors, [], "no errors in the interface console");

  const state = JSON.parse(readFileSync(path.join(userData, "app-state.json"), "utf8"));
  assert.equal(path.resolve(state.lastWorkspace), path.resolve(workspace));
  assert.ok(state.window.bounds.width >= 640);
});

test("reopens the last project after a restart", { timeout: 120_000 }, async () => {
  const { app, page, errors } = await launch([]);
  await page.locator('.tree-row[data-path="src"]').waitFor();
  assert.match(await page.title(), /smoke-project/);
  const closed = app.waitForEvent("close");
  await closeWindow(app); // nothing unsaved: closes without asking
  await closed;
  assert.deepEqual(errors, []);
});

test("changes made outside the IDE are picked up", { timeout: 120_000 }, async () => {
  writeFileSync(indexFile, "// start\n");
  const { app, page, errors } = await launch([`--folder=${workspace}`]);
  await page.locator('.tree-row[data-path="src"]').waitFor();
  await page.locator('.tree-row[data-path="src"]').click();
  await page.locator('.tree-row[data-path="src/index.ts"]').click();
  await page.locator(".monaco-editor .view-lines").filter({ hasText: "start" }).waitFor();

  // A new file created by another program appears in the explorer.
  writeFileSync(path.join(workspace, "external.txt"), "from outside");
  await page.locator('.tree-row[data-path="external.txt"]').waitFor();

  // A clean open file follows the disk.
  writeFileSync(indexFile, "// changed outside\n");
  await page.locator(".monaco-editor .view-lines").filter({ hasText: "changed outside" }).waitFor();
  assert.equal(await page.locator(".editor-notice").count(), 0);

  // A file with unsaved edits is never replaced silently: the user chooses.
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" mine");
  await page.waitForFunction(() => document.querySelector('.tab[data-path="src/index.ts"]')?.classList.contains("dirty"));
  writeFileSync(indexFile, "// changed again\n");
  await page.locator(".editor-notice").getByText("This file changed on disk").waitFor();
  await shot(page, "06-external-change");
  await page.getByRole("button", { name: "Reload from Disk" }).click();
  await page.locator(".monaco-editor .view-lines").filter({ hasText: "changed again" }).waitFor();
  await page.locator(".editor-notice").waitFor({ state: "detached" });
  assert.ok(!(await page.locator('.tab[data-path="src/index.ts"]').evaluate((el) => el.classList.contains("dirty"))));

  // A deleted file is reported, and the tab can be closed from the notice.
  rmSync(indexFile);
  await page.locator(".editor-notice").getByText("deleted or moved").waitFor();
  await page.getByRole("button", { name: "Close Tab" }).click();
  await page.locator('.tab[data-path="src/index.ts"]').waitFor({ state: "detached" });

  const closed = app.waitForEvent("close");
  await closeWindow(app);
  await closed;
  assert.deepEqual(errors, []);
  writeFileSync(indexFile, "// restored\n");
});

test("New Project creates and opens a starter project with the chaos init rules", { timeout: 120_000 }, async () => {
  const parent = path.join(tempRoot, "projects");
  mkdirSync(parent);
  mkdirSync(path.join(parent, "taken"));
  writeFileSync(path.join(parent, "taken", "keep.txt"), "original");

  const { app, page, errors } = await launch([`--folder=${workspace}`]);
  await page.locator('.tree-row[data-path="src"]').waitFor();
  // Stand in for the native folder picker, which cannot be driven from a test.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, parent);
  const newProject = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send("menu:command", "new-project"));

  // A folder that already has content is refused and left alone.
  await newProject();
  const input = page.getByRole("dialog").locator("input");
  await input.fill("taken");
  await page.keyboard.press("Enter");
  await page.getByText("Could not create project").waitFor();
  await page.getByRole("button", { name: "OK" }).click();
  assert.deepEqual(readdirSync(path.join(parent, "taken")), ["keep.txt"]);

  // Invalid names cannot be submitted.
  await newProject();
  await page.getByRole("dialog").locator("input").fill("Bad Name");
  assert.ok(await page.getByRole("button", { name: "Choose Location…" }).isDisabled());
  await page.getByRole("button", { name: "Choose Location…" }).evaluate((el) => (el as HTMLButtonElement).form?.requestSubmit());
  await page.getByRole("dialog").locator("input").fill("fresh-app");
  await page.keyboard.press("Enter");

  // The project is created, opened, and its entry file is shown.
  await page.locator('.tab[data-path="src/index.ts"]').waitFor();
  assert.match(await page.title(), /fresh-app - Origin Studio/);
  assert.match(await page.locator(".status-bar").innerText(), /Origin Studio project/);
  await shot(page, "07-new-project");
  const root = path.join(parent, "fresh-app");
  for (const file of getStarterFiles("fresh-app")) {
    assert.equal(readFileSync(path.join(root, ...file.path.split("/")), "utf8"), file.contents, file.path);
  }

  const closed = app.waitForEvent("close");
  await closeWindow(app);
  await closed;
  assert.deepEqual(errors, []);
});
