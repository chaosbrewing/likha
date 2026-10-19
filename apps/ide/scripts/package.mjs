// Packages the built IDE as a Windows installer (NSIS) and an unpacked folder.
//
// Everything the app runs is already bundled into dist/ except node-pty (a
// native module), so the package is assembled in release/app with only that
// dependency, rather than letting the packager walk the monorepo.
//
// Usage: npm run build, then npm run package (from the repo root).
// Signing happens only when CSC_LINK / WIN_CSC_LINK point at a certificate.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, Platform } from "electron-builder";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(appDir, "release");
const stageDir = path.join(releaseDir, "app");
const require = createRequire(path.join(appDir, "package.json"));
const manifest = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"));
const electronVersion = JSON.parse(readFileSync(require.resolve("electron/package.json"), "utf8")).version;

for (const required of ["dist/electron/main.js", "dist/electron/preload.cjs", "dist/renderer/index.html"]) {
  if (!existsSync(path.join(appDir, required))) {
    throw new Error(`Missing ${required}. Run "npm run build" first.`);
  }
}

// 1. Stage the app: built output, a minimal manifest, and node-pty with its runtime dependency.
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
cpSync(path.join(appDir, "dist"), path.join(stageDir, "dist"), {
  recursive: true,
  filter: (source) => !source.endsWith(".map")
});
for (const dependency of ["node-pty", "node-addon-api"]) {
  const source = path.dirname(require.resolve(`${dependency}/package.json`));
  cpSync(source, path.join(stageDir, "node_modules", dependency), {
    recursive: true,
    // Skip development-only folders and binaries for other platforms.
    filter: (file) => {
      const relative = path.sep + path.relative(source, file);
      return !/[\\/](src|deps|scripts|test|third_party)([\\/]|$)/.test(relative) && !/[\\/]prebuilds[\\/](?!win32-x64)/.test(relative);
    }
  });
}
const nodePty = JSON.parse(readFileSync(require.resolve("node-pty/package.json"), "utf8"));
writeFileSync(
  path.join(stageDir, "package.json"),
  `${JSON.stringify(
    {
      name: "origin-studio-ide",
      productName: "Origin Studio",
      version: manifest.version,
      description: "Origin Studio desktop IDE",
      author: "Chaos Origins",
      type: "module",
      main: "dist/electron/main.js",
      dependencies: { "node-pty": nodePty.version }
    },
    null,
    2
  )}\n`
);

// 2. Package.
const artifacts = await build({
  targets: Platform.WINDOWS.createTarget(["nsis", "dir"], Arch.x64),
  publish: "never",
  projectDir: stageDir,
  config: {
    appId: "dev.chaosorigins.originstudio",
    productName: "Origin Studio",
    copyright: "Copyright © Chaos Origins",
    electronVersion,
    directories: { output: path.join(releaseDir, "dist"), buildResources: path.join(appDir, "build") },
    files: ["dist/**", "package.json", "node_modules/**"],
    asar: true,
    // Native binaries and the ConPTY helpers must be real files on disk.
    asarUnpack: ["node_modules/node-pty/**"],
    npmRebuild: false,
    // Release hardening: no ELECTRON_RUN_AS_NODE, NODE_OPTIONS or --inspect, and only
    // the integrity-checked app.asar may be loaded.
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
      grantFileProtocolExtraPrivileges: false
    },
    nodeGypRebuild: false,
    win: { icon: path.join(appDir, "build", "icon.ico"), executableName: "OriginStudio" },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "Origin Studio",
      artifactName: "OriginStudio-Setup-${version}.exe",
      uninstallDisplayName: "Origin Studio"
    }
  }
});

console.log("\nPackaged:");
for (const artifact of artifacts) console.log(`  ${path.relative(appDir, artifact)}`);
console.log(`  ${path.relative(appDir, path.join(releaseDir, "dist", "win-unpacked", "OriginStudio.exe"))}`);
