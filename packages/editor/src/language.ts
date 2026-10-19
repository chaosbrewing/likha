const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "shell",
  bash: "shell",
  ps1: "powershell",
  psm1: "powershell",
  bat: "bat",
  cmd: "bat",
  sql: "sql",
  ini: "ini",
  toml: "ini",
  dockerfile: "dockerfile"
};

const BY_FILE_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  "tsconfig.json": "json",
  ".prettierrc": "json",
  ".eslintrc": "json"
};

/** Maps a file path to a Monaco language id. Unknown types use plain text. */
export function languageForPath(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
  const byName = BY_FILE_NAME[name];
  if (byName) {
    return byName;
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "plaintext";
  }
  return BY_EXTENSION[name.slice(dot + 1)] ?? "plaintext";
}

/** Display label for the status bar. */
export function languageLabel(languageId: string): string {
  const labels: Record<string, string> = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    json: "JSON",
    markdown: "Markdown",
    css: "CSS",
    scss: "SCSS",
    less: "Less",
    html: "HTML",
    xml: "XML",
    yaml: "YAML",
    python: "Python",
    rust: "Rust",
    go: "Go",
    java: "Java",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    shell: "Shell",
    powershell: "PowerShell",
    bat: "Batch",
    sql: "SQL",
    ini: "INI",
    dockerfile: "Dockerfile",
    plaintext: "Plain Text"
  };
  return labels[languageId] ?? languageId;
}
