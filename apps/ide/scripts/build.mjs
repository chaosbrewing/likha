// Production build: interface (Vite) into dist/renderer, Electron code into dist/electron.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { bundleElectron } from "./bundle-electron.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await viteBuild({ configFile: path.join(appDir, "vite.config.ts"), logLevel: "warn" });
await bundleElectron();
console.log("Built LIKHA IDE into apps/ide/dist");
