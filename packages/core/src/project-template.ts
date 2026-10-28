import {
  PROJECT_CONFIG_KEY,
  PROJECT_SCHEMA_VERSION
} from "./project-config.js";

export interface ProjectFile {
  /** Path relative to the project root, always with forward slashes. */
  path: string;
  contents: string;
}

// Kept in step with the toolchain LIKHA itself is built and tested with.
const STARTER_DEV_DEPENDENCIES = {
  "@types/node": "^26.6.5",
  typescript: "^7.0.2"
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Returns the files for a minimal runnable TypeScript project. The name must
 * already have passed validateProjectName.
 */
export function getStarterFiles(name: string): ProjectFile[] {
  const packageJson = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      build: "tsc",
      start: "node dist/index.js",
      typecheck: "tsc --noEmit"
    },
    devDependencies: STARTER_DEV_DEPENDENCIES,
    [PROJECT_CONFIG_KEY]: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      language: "typescript"
    }
  };

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      rootDir: "src",
      outDir: "dist",
      types: ["node"],
      skipLibCheck: true
    },
    include: ["src"]
  };

  const indexTs = [
    "export function greet(name: string): string {",
    "  return `Hello from ${name}!`;",
    "}",
    "",
    `console.log(greet(${JSON.stringify(name)}));`,
    ""
  ].join("\n");

  const readme = [
    `# ${name}`,
    "",
    "Created with LIKHA (`likha init`).",
    "",
    "## Getting started",
    "",
    "```powershell",
    "npm install",
    "npm run build",
    "npm start",
    "```",
    ""
  ].join("\n");

  const gitignore = ["node_modules/", "dist/", "*.log", ""].join("\n");

  return [
    { path: "package.json", contents: json(packageJson) },
    { path: "tsconfig.json", contents: json(tsconfig) },
    { path: "src/index.ts", contents: indexTs },
    { path: "README.md", contents: readme },
    { path: ".gitignore", contents: gitignore }
  ];
}
