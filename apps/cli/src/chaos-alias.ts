#!/usr/bin/env node
// Temporary compatibility entry for the retired `chaos` command (first LIKHA release only).
// It behaves exactly like `likha`, after one notice on stderr (stdout is unchanged, so
// scripts that parse output keep working). It never touches user files or configuration.
// Set LIKHA_NO_ALIAS_NOTICE=1 to silence the notice.
if (process.env.LIKHA_NO_ALIAS_NOTICE !== "1") {
  console.error('Notice: the "chaos" command is now "likha". "chaos" still works in this release but will be removed; update your scripts.');
}
await import("./index.js");

export {};
