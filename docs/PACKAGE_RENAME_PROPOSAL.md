# Proposal: internal package and repository renames (D03, not implemented)

Status: PROPOSAL. Nothing here is approved for implementation; each step needs its own
founder decision.

Current names: `@studio/contracts|core|workspace|editor|origin-adapter|cli|ide`, root
package `origin-studio`, repository `chaosbrewing/likha` (renamed by D21), env vars `ORIGIN_STUDIO_*`,
project config key `originStudio`, settings folder `Origin Studio`, `appId`
`dev.chaosorigins.originstudio`.

| Step | Change | Risk | Recommendation |
|---|---|---|---|
| 1 | Scope `@studio/*` to `@likha/*` | Pure workspace-internal; touches every import and the lockfile; no user impact | Do later, in one mechanical commit |
| 2 | Root package to `likha` (the repo itself is already renamed, D21) | Touches the workspace root and lockfile | Do with step 1 |
| 3 | `LIKHA_*` env vars, reading `ORIGIN_STUDIO_*` as a fallback for one release | Low if the fallback is kept | Do next release |
| 4 | Project key `likha` accepted alongside `originStudio` | Must keep reading the old key forever or write nothing automatically; never rewrite user files silently | Needs its own design |
| 5 | Settings folder copy-migration to `%AppData%\LIKHA` | Must copy, not move, and DPAPI-encrypted credentials must be verified on Windows | Only after Windows verification |
| 6 | `appId` change | Breaks in-place upgrade (a second app appears) | Do not change |
