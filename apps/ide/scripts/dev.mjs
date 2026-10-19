// Development mode: Vite dev server with hot reload for the interface, plus Electron.
// Changes to electron/*.ts need a restart of this script.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { createServer } from "vite";
import { bundleElectron } from "./bundle-electron.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await bundleElectron({ dev: true });
const server = await createServer({ configFile: path.join(appDir, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "http://localhost:5173";
console.log(`Interface dev server: ${url}`);

const child = spawn(String(electronPath), [appDir, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ORIGIN_STUDIO_DEV_SERVER_URL: url }
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
