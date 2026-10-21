# Phase 5 acceptance test and terminal isolation audit (2026-10-21)

Machine: Windows 11 Pro 10.0.26300, Node.js 24.18.0, npm 11.16.0, PowerShell 7.7 (Store), Windows PowerShell 5.1.
Builds: the user's installed **0.2.0** (`C:\Program Files\OriginStudio`, installed 2026-10-19 18:21, all users)
and the rebuilt **0.2.1** (`apps/ide/release/dist/win-unpacked`, same code as `OriginStudio-Setup-0.2.1.exe`).

The desktop tests were driven over the Chrome DevTools Protocol against the real executables, with an isolated
settings folder (`ORIGIN_STUDIO_USER_DATA`) so the user's own settings were not changed. Steps that need a native
dialog or a human eye are marked.

## 1. Disposable project

`chaos.cmd init qa-project` → `npm install` → `npm run build` → `npm start` printed `Hello from qa-project!`
(`%USERPROFILE%\origin-studio-qa\qa-project`). **Pass.**

## 2. Desktop tests (0.2.1 unless noted)

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Application launch | Pass (partly manual) | Launched from the all-users Start Menu shortcut: log shows `Starting Origin Studio 0.2.0`, workspace reopened, `Interface loaded` (0.3–1.3 s on the user's own launches). Window visibility and close-by-X could not be observed from the automated session; the user's log shows repeated clean launches on Oct 19–21. |
| 2 | Open a workspace | Pass | Explorer entries equal the folder's entries. Opened with `--folder`; the native folder picker needs a human click. |
| 3 | Open and edit a file | Pass | Unsaved dot shown; Ctrl+S cleared it; file on disk ends with the added `console.log`. |
| 4 | Persistence | Pass | Content present after closing/reopening the tab and after relaunching the app with no arguments (last project reopened). |
| 5 | Protect unsaved changes | Pass | Ctrl+W → Save / Don't Save / Cancel; Cancel kept the tab dirty. Title-bar close → "1 file has unsaved changes"; Cancel kept the app open; disk untouched. `window.close()` from the page is now guarded too. |
| 6 | File explorer operations | Pass | `qa-temp/` created, `example.txt` written and saved, renamed to `renamed.txt` (tab followed), delete asked for confirmation while the file still existed, then moved it to the Recycle Bin. |
| 7 | Integrated terminal | Pass | Prompt in the project folder; `node --version` → v24.18.0; `npm run build` then `npm start` → `Hello from qa-project!`; interface stayed responsive. |
| 8 | External change detection | Pass | Clean tab followed an external edit; with unsaved edits a notice appeared and Save showed the conflict dialog instead of overwriting; Reload from Disk restored a clean tab. External writer was the test script, not VS Code. |
| 9 | CLI independence | Pass | `chaos.cmd --version`, `help`, `status` worked from the project while the IDE was open. |
| 10 | Application restart | Pass | Terminal closed from its tab; exit code 0; `pwsh.exe` count returned to baseline; no `OriginStudio.exe` left; project files unchanged; relaunch reopened `qa-project`. |

## 3. Repository checks

`git status --short` empty (before the audit fixes), `npm run typecheck` 0, `npm test` 85/85 (86/86 after the audit's
new test), `npm run build` 0, `npm run test:e2e` 4/4, `npm run test:package` 1/1.

## 4. Installer and release validation

| Test | Result |
|---|---|
| Install | Pass. Silent per-user install and the user's own all-users install both completed (`installer exit=0`). |
| Start menu | Pass. `Origin Studio.lnk` present (all-users Start Menu for the user's install). |
| Desktop shortcut | Pass. `Public\Desktop\Origin Studio.lnk` → `OriginStudio.exe`. |
| Version information | Pass. ProductName "Origin Studio", FileVersion 0.2.0, Company "Chaos Origins"; Settings > Apps entry "Origin Studio 0.2.0". Not code-signed. |
| Clean installation | Pass. 0.2.1 ran with the repository's Electron, node-pty, Monaco, xterm, React and all build output renamed away: opened the project, started a shell, exited 0. |
| Uninstall | Pass for the per-user test install (folder, shortcuts and registry entry removed; a normal uninstall removes the folder completely). **Not run** against the user's working installation without their approval. |
| User projects | Pass. `qa-project` hashes unchanged across every exit. |

## 5. Terminal isolation audit

Report: Windows PowerShell and Command Prompt "launch empty or unusable windows while Origin Studio is running".

Evidence gathered:

- Static review: the only process spawns are user-initiated `pty.spawn` calls (nothing at start-up), no environment,
  registry, profile or Windows Terminal changes. Console delegation settings are Windows defaults.
- Controlled experiment, both builds: external `cmd.exe`, `powershell.exe` and `pwsh.exe` windows started, ran a
  command and exited in ~1.5 s at every stage (Studio off; running with 0, 1 and 3 terminals; after closing one;
  after exit). Process counts returned to baseline after exit. Studio's own Windows PowerShell and Command Prompt
  tabs showed a prompt within 1 s and ran commands, also when opened as the first terminal with a Start-menu-like
  environment. No orphaned `conhost`/`OpenConsole`/shell processes belong to Origin Studio.
- The symptom could **not** be reproduced. Window contents of external consoles cannot be observed from the
  automated session; a screenshot from the user is needed to go further.

Defects found with evidence and fixed in 0.2.1:

1. **Terminal kill under the release fuses.** node-pty's Windows `kill()` calls `child_process.fork()`, which the
   `runAsNode: false` fuse forbids; the user's log shows the unhandled rejection on every terminal close (Oct 19 ×3,
   Oct 21 ×1). The pseudoconsole still closed, but processes started from the shell were not cleaned up. Fix: spawn
   with node-pty's bundled ConPTY (`useConptyDll`, whose kill path does not fork) and end the shell's process tree
   explicitly (`taskkill /T`). Regression test: `apps/ide/test/terminal.test.ts` starts a shell and a `node` child,
   kills the session, and asserts both are gone with no unhandled rejection.
2. **Hint text written into the terminal.** The execution-policy hint was written straight into the Windows PowerShell
   xterm; text the shell did not produce confuses ConPTY's cursor position, and with the bundled ConPTY the typed
   command rendered over the hint. Fix: the hint is a panel message.
3. **Page-initiated close bypassed the unsaved-changes guard** (`window.close()`); not reachable from the UI, fixed
   with a `beforeunload` guard and covered by the end-to-end test.

Manual verification still needed: confirm in a real session that external consoles look normal while Studio runs,
or capture a screenshot of the "empty" window with Studio's state at the time.
