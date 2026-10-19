// Bundles the Electron main process (ESM) and the sandboxed preload (CommonJS).
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleElectron({ dev = false } = {}) {
  const common = {
    bundle: true,
    platform: "node",
    target: "node22",
    sourcemap: dev ? "inline" : true,
    logLevel: "warning",
    absWorkingDir: appDir
  };
  await build({
    ...common,
    entryPoints: ["electron/main.ts"],
    outfile: "dist/electron/main.js",
    format: "esm",
    // node-pty is a native module and must be loaded from node_modules at runtime.
    external: ["electron", "node-pty"]
  });
  await build({
    ...common,
    entryPoints: ["electron/preload.ts"],
    outfile: "dist/electron/preload.cjs",
    format: "cjs",
    external: ["electron"]
  });
  // Window icon for unpackaged runs (the packaged executable carries its own).
  mkdirSync(path.join(appDir, "dist", "electron"), { recursive: true });
  copyFileSync(path.join(appDir, "build", "icon.png"), path.join(appDir, "dist", "electron", "icon.png"));
}
