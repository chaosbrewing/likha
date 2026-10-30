# GitHub remote and CI setup plan (Phase 7, historical)

> **Update (2026-10-29):** this plan has since been carried out. The repository was renamed
> to `chaosbrewing/likha` (GitHub redirects the old `origin-studio` URLs), `main` is the
> default branch, and `main` is protected as in step 4. The commands below use the current
> repository name. Step 4's original command failed in PowerShell (`-f` sends the text
> "true", not a boolean); it is replaced by a JSON body that works.

**Status: plan only.** The repository has no remote and nothing has been pushed. Creating the
repository and pushing branches need the owner's go-ahead; the steps below are what to run
once that is given. Nothing in this document was executed.

## Observed state (2026-10-24)

| Item | Value |
|---|---|
| Remotes | none (`git remote -v` prints nothing) |
| Branches | `phase-3-chaos-cli`, `phase-4-ide-foundation`, `phase-5-release-readiness`, `phase-6-intelligence-origin-ci`, `phase-7-origin-connectivity` (each phase builds on the previous; there is no `main`) |
| Git identity | `chaosbrewing <johnpoyy028@gmail.com>` |
| `core.autocrlf` | `true` (system). Files are LF in the index; Git normalizes on commit |
| `init.defaultBranch` | `master` (system). The plan uses `main`, matching the sibling repositories |
| `gh` | signed in as `chaosbrewing` (https) |
| Sibling repositories | `chaosbrewing/ORIGIN` (private), `chaosbrewing/Tala` (private), `chaosbrewing/binhi` (public) |
| CI | `.github/workflows/ci.yml` present (Windows runner); never run |

## Plan

1. **Create the repository** (owner decision: private, matching ORIGIN):

   ```powershell
   gh repo create chaosbrewing/likha --private --description "LIKHA: Windows desktop IDE and likha CLI for ORIGIN" --disable-wiki
   ```

2. **Add the remote and push the lineage**, oldest first, so each phase branch is
   reviewable on its own:

   ```powershell
   git remote add origin https://github.com/chaosbrewing/likha.git
   git push -u origin phase-3-chaos-cli phase-4-ide-foundation phase-5-release-readiness phase-6-intelligence-origin-ci
   git push -u origin phase-7-origin-connectivity
   ```

3. **Create `main`** from the last accepted phase and make it the default:

   ```powershell
   git branch main phase-6-intelligence-origin-ci
   git push -u origin main
   gh repo edit chaosbrewing/likha --default-branch main
   ```

   Phase 7 then becomes a pull request from `phase-7-origin-connectivity` into `main`, which
   is where CI runs it.

4. **Protect `main`** (owner): require the `Build, test and package (Windows)` check, require a
   pull request, no force pushes:

   ```powershell
   @'
   {
     "required_status_checks": { "strict": true, "contexts": ["Build, test and package (Windows)"] },
     "enforce_admins": false,
     "required_pull_request_reviews": { "required_approving_review_count": 0 },
     "restrictions": null,
     "allow_force_pushes": false
   }
   '@ | gh api -X PUT repos/chaosbrewing/likha/branches/main/protection --input -
   ```

5. **Secrets** (later, owner): `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` for signing and
   `ORIGIN_STUDIO_UPDATE_URL` / `ORIGIN_STUDIO_PUBLISHER_NAME` for an update feed. The workflow
   does not use them yet; the unsigned installer is uploaded as an artifact.

## Why CI should run as-is once a remote exists

- The workflow uses `actions/checkout@v4`, `actions/setup-node@v4` (Node 24, npm cache) and
  `actions/upload-artifact@v4` only, on `windows-latest`.
- Every step is a script that exists in the root `package.json` and runs on this machine:
  `npm ci`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run package`,
  `npm run test:package`. The lockfile is committed, so `npm ci` is reproducible.
- `npm ci` downloads Electron in `postinstall` (network access is available on hosted runners)
  and `node-pty` ships prebuilt Windows binaries, so no native toolchain is needed.
- The end-to-end tests drive a real Electron window; hosted Windows runners have an interactive
  desktop session, which is what Playwright's Electron launcher needs. One temporary file goes
  to the Recycle Bin per run.
- Known risks on a runner, to check on the first run: the packaged smoke test and the e2e
  suite start several Electron instances in sequence (about 3 minutes locally); the job
  timeout is 60 minutes. If the hosted runner lacks ConPTY (Windows Server 2022 has it), the
  terminal step of the e2e test would fail; that is a finding, not something to work around.

## Not done, on purpose

No repository was created, no remote added, nothing pushed, no branch protection or secrets
configured. The Phase 7 brief reserves these for the owner.
