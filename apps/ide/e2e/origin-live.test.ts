// Live read-only integration of the built LIKHA against a REAL ORIGIN
// server over the HTTP transport (no mocks). Runs only when the environment
// names the server and the credentials; otherwise it is skipped.
//
//   ORIGIN_STUDIO_LIVE_URL            e.g. http://127.0.0.1:5055 (https elsewhere)
//   ORIGIN_STUDIO_LIVE_KEY_FILE       file holding a valid ORIGIN API key (never pass the key itself)
//   ORIGIN_STUDIO_LIVE_PROJECT_ID     a project the key may read
//   ORIGIN_STUDIO_LIVE_FOREIGN_PROJECT_ID   optional: a project the key may NOT read
//   ORIGIN_STUDIO_LIVE_REVOKED_KEY_FILE     optional: file holding a revoked key
//   ORIGIN_STUDIO_LIVE_UNSCOPED_KEY_FILE    optional: file holding a valid key issued WITHOUT the
//                                           project.read scope (a legacy key); it must be refused
//   ORIGIN_STUDIO_LIVE_EVIDENCE       optional: file to append a JSON evidence record to
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { getStarterFiles } from "@studio/core";

const liveUrl = process.env.ORIGIN_STUDIO_LIVE_URL ?? null;
const keyFile = process.env.ORIGIN_STUDIO_LIVE_KEY_FILE ?? null;
const projectId = process.env.ORIGIN_STUDIO_LIVE_PROJECT_ID ?? null;
const foreignProjectId = process.env.ORIGIN_STUDIO_LIVE_FOREIGN_PROJECT_ID ?? null;
const revokedKeyFile = process.env.ORIGIN_STUDIO_LIVE_REVOKED_KEY_FILE ?? null;
const unscopedKeyFile = process.env.ORIGIN_STUDIO_LIVE_UNSCOPED_KEY_FILE ?? null;
const evidenceFile = process.env.ORIGIN_STUDIO_LIVE_EVIDENCE ?? null;
const configured = liveUrl !== null && keyFile !== null && projectId !== null;

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "origin-studio-live-"));
const workspace = path.join(tempRoot, "live-project");
const userData = path.join(tempRoot, "user-data");
const launched: ElectronApplication[] = [];
after(async () => {
  for (const app of launched) {
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))]);
    try {
      app.process().kill();
    } catch {
      // Already gone.
    }
  }
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

mkdirSync(workspace);
for (const file of getStarterFiles("live-project")) {
  const target = path.join(workspace, ...file.path.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.contents);
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { NODE_TEST_CONTEXT: _context, NODE_OPTIONS: _options, ...env } = process.env;
  const app = await electron.launch({
    args: [appDir, `--folder=${workspace}`],
    env: { ...env, ORIGIN_STUDIO_USER_DATA: userData, ORIGIN_STUDIO_FEATURES: "origin-core", ORIGIN_STUDIO_ORIGIN_TRANSPORT: "http", ORIGIN_STUDIO_ORIGIN_URL: liveUrl! } as Record<string, string>
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

const menu = (app: ElectronApplication, command: string) =>
  app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0]?.webContents.send("menu:command", c), command);

async function connectWith(app: ElectronApplication, page: Page, secret: string) {
  await menu(app, "origin-connect");
  await page.getByRole("dialog").locator("input[type=password]").fill(secret);
  await page.keyboard.press("Enter");
}

async function closeApp(app: ElectronApplication) {
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await closed;
}

test("live ORIGIN: a scoped key connects, the linked project is verified by ORIGIN, foreign projects, revoked keys and unscoped keys are refused", { timeout: 180_000, skip: !configured && "set ORIGIN_STUDIO_LIVE_URL, ORIGIN_STUDIO_LIVE_KEY_FILE and ORIGIN_STUDIO_LIVE_PROJECT_ID" }, async () => {
  const key = readFileSync(keyFile!, "utf8").trim();
  const linkDir = path.join(workspace, ".origin");
  mkdirSync(linkDir, { recursive: true });
  writeFileSync(path.join(linkDir, "project.json"), JSON.stringify({ projectId, name: "hint from file" }));
  const record: Record<string, unknown> = { at: new Date().toISOString(), origin: liveUrl, projectId, transport: "http" };

  const { app, page, errors } = await launch();
  await page.locator('.tree-row[data-path="src"]').waitFor();
  await page.locator('.status-bar [data-origin-connection="disconnected"]').waitFor();
  await page.locator('.status-bar [data-origin="unverified"]').waitFor({ timeout: 30_000 });

  await connectWith(app, page, key);
  await page.locator('.status-bar [data-origin-connection="connected"]').waitFor({ timeout: 30_000 });
  const connected = await page.locator('.status-bar [data-origin-connection="connected"]').innerText();
  assert.match(connected, /^ORIGIN: .+/);
  record.connectedAs = connected.replace(/^ORIGIN: /, "");
  await page.locator('.status-bar [data-origin="verified"]').waitFor({ timeout: 30_000 });
  const verified = await page.locator('.status-bar [data-origin="verified"]').innerText();
  assert.match(verified, /✓$/);
  assert.doesNotMatch(verified, /hint from file/, "ORIGIN's project name replaces the file hint");
  record.verifiedProject = verified.replace(/ ✓$/, "");
  record.verifiedTitle = await page.locator('.status-bar [data-origin="verified"]').getAttribute("title");

  // The credential is stored encrypted and never logged.
  const credentialFile = path.join(userData, "origin-credential.bin");
  assert.ok(existsSync(credentialFile));
  assert.ok(!readFileSync(credentialFile).toString("latin1").includes(key));
  assert.ok(!readFileSync(path.join(userData, "logs", "main.log"), "utf8").includes(key));

  if (foreignProjectId) {
    writeFileSync(path.join(linkDir, "project.json"), JSON.stringify({ projectId: foreignProjectId }));
    await page.locator('.status-bar [data-origin="unauthorized"]').waitFor({ timeout: 30_000 });
    record.foreignProject = await page.locator('.status-bar [data-origin="unauthorized"]').getAttribute("title");
    writeFileSync(path.join(linkDir, "project.json"), JSON.stringify({ projectId }));
    await page.locator('.status-bar [data-origin="verified"]').waitFor({ timeout: 30_000 });
  }

  await menu(app, "origin-disconnect");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.locator('.status-bar [data-origin-connection="disconnected"]').waitFor();
  assert.ok(!existsSync(credentialFile));

  if (revokedKeyFile) {
    await connectWith(app, page, readFileSync(revokedKeyFile, "utf8").trim());
    await page.getByRole("heading", { name: "Could not connect to ORIGIN" }).waitFor();
    await page.getByRole("button", { name: "OK" }).click();
    await page.locator('.status-bar [data-origin-connection="unauthorized"]').waitFor();
    record.revokedKey = await page.locator('.status-bar [data-origin-connection="unauthorized"]').innerText();
    assert.match(record.revokedKey as string, /revoked/);
    assert.ok(!existsSync(credentialFile));
  }

  if (unscopedKeyFile) {
    // A key without the project.read scope is a valid, active key whose holder
    // may own the project; ORIGIN must still refuse it and Studio must not keep it.
    await connectWith(app, page, readFileSync(unscopedKeyFile, "utf8").trim());
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Could not connect to ORIGIN" }) });
    await dialog.waitFor();
    record.unscopedKeyDialog = (await dialog.innerText()).replace(/\s+/g, " ").trim();
    assert.match(record.unscopedKeyDialog as string, /project\.read|read access/i);
    await page.getByRole("button", { name: "OK" }).click();
    await page.locator('.status-bar [data-origin-connection="unauthorized"]').waitFor();
    record.unscopedKey = await page.locator('.status-bar [data-origin-connection="unauthorized"]').innerText();
    assert.match(record.unscopedKey as string, /forbidden/);
    assert.ok(!existsSync(credentialFile), "an unscoped key is never stored");
  }

  await closeApp(app);
  assert.deepEqual(errors, []);
  record.consoleErrors = 0;
  if (evidenceFile) appendFileSync(evidenceFile, `${JSON.stringify(record)}\n`);
  console.log(`live evidence: ${JSON.stringify(record)}`);
});
