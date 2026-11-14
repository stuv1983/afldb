# Remediation run 2026-11-14 — handoff (run complete; candidate local, not published)

Integration branch `claude/remediation-20261114` in worktree `D:\dev\afldb-rem-20261114`. It is based on review commit
`5035ed96`, which sits on `origin/main` `de640826`. **Nothing was pushed, merged, deployed, installed, restarted or written on
production or DEV.** Read `APPROVAL-PACKET.md` (the next decisions) and `QUALIFICATION.md` (all results) first.
Earlier records here: `AGENT-PROTOCOL.md`, `RUN-PLAN.md`, `PLAN-REVIEW.md`, `REVIEW-A.md`, `REVIEW-B.md`, `DEV-STATE-BEFORE.txt`.

## State

| Issue | State after this run |
|---|---|
| 353, 354, 355, 356, 358, 359, 360, 361 | **Resolved locally** (qualified, not published) |
| 350 | Open: I350 operation prepared and rehearsed; production opening needs publication, release and D-350-1 |
| 351 | Open: release gate implemented; host policy prepared, not installed; reboot pending (separate owner op) |
| 352 | Open: backup/verify units, off-host pull and DR runbook prepared, not installed |
| 348 | Open: reload guard implemented; reconciliation and three REPLACE_CLUB rulings at the acquisition |
| 357 | Open (narrowed): residual ~50 KB per distinct 404 path; owner O-1 |
| 362 | Open: Caddy filter prepared, not installed; pre-fix logs (O-3, O-1) |
| 363 | Open: shared-DB committed-fixture leaks (per-file disposable DB recommended) |
| 364 | Open: lint gate not wired (O-2) |
| 332 | Open: notifier prepared, not installed; gates G0/G0b proposed in the operating record |

## Commit sequence (dependency order; `git log --reverse de640826..claude/remediation-20261114`)

1. Review and run records: `5035ed96`, `6ac66949`, `3ca215e3`.
2. Pins and tests (358, 363): `220e6522`, `4c61301d`, `30905c7f`, `ad8d92d5`, `f2ae03ea`, `b8c8759e`, `0d330c3c`, `4043b3ed`,
   `d796d195`, `dd21624f`, `894c2356`.
3. Admin (353, 354): `cd371c0a`, `85b73c53`, `4c44bcc4`, `f5b81172`.
4. DraftGuru (348): `773182ea`, `102c4226`.
5. NL (356, 359, 360): `b85393aa`, `0f4856ed`, `c86a2e00`, `5c1e8c1a`.
6. Answers (355, 360): `b3c3e303`, `e118e033`, `7e734a4c`.
7. Routes (357, 359, 360, 364): `2797d8ad`, `38e532b7`, `5033b26a`, `64a81ed0`.
8. Performance (361): `6f6ddd14`, `73c32c3e`, `e4ec689b`, `14efb9a5`.
9. Auth and lint (362, 364): `5a354cb9`, `a3238c96`, `71f6ca78`, `c517732a`, `70cd45b8`.
10. Rollover (350, 332): `68f8c0da`, `a434a4a4`, `f5bebcb1`, `d974078c`, `cb025bbd`, `b44090cf`.
11. Host operations (351, 352, 364): `c3364559`, `b607d09f`, `e51df369`, `19164095`, `be514d47`.
12. Integration and review fixes: `5394aff8`, `a119a999`, `48286d7a`, `e905915a`, `fb6ac276`, `3aa82166` (last code change).
13. Records: `b110555b` (reviews A/B), `6c8b02cd` (ledger, index, blockers, changelog, operating-record proposal), then the
    commit adding this handoff, `QUALIFICATION.md`, `APPROVAL-PACKET.md` and `qualification/`.

Scope commits were cherry-picked with `-x` from `claude/rem-<scope>-20261114` branches (worktrees `D:\dev\afldb-rem-<scope>`).

## Next actions (in order)

1. Owner reviews `APPROVAL-PACKET.md` A and approves publication (fast-forward of `origin/main` from `de640826`).
2. Owner approves B1 (release) and then the production operations B2–B7 individually.
3. The ISSUE-332 G0 gate (season open) must close by 2027-03-10.

## Housekeeping

- Host (streamanator): the workspaces `/mnt/ssd/afldb-rem-*-20261114` had their clusters stopped and checkouts, clusters and
  build trees removed at the end of the run; each workspace's `evidence/` directory was kept. The heavy-job lock file was removed.
- DEV state after the run equals `DEV-STATE-BEFORE.txt` (see `DEV-STATE-AFTER.txt`).
- The `D:\dev\afldb` worktree (branch `claude/issue-339-deploy-preflight`) has unrelated uncommitted edits to 12 files this
  candidate also changes; untouched by this run (conflict list in `APPROVAL-PACKET.md` A).

## Incidents (disclosed)

- **Shared scratchpad collisions between scope agents.** The routes agent executed the answers agent's `build.sh`, which re-applied an
  idempotent `site_settings` INSERT in answers' own `_test` database; the duplicate build was killed. The pins agent overwrote
  a `setup.sh`. Every agent reports that its results came from its own host copy. Integration re-qualified everything centrally.
- **hostops scratch files left in `D:\tmp`:** `backup-tests.ts`, `br-tail*.md`, `dep.new`, `newblock.md`, `grants-para.md`,
  `br-new.md`, `fix351.mjs`. They are not in the repository; not deleted by this run (owner may remove).
- **Missed classification:** the admin agent's new Match Sheet read was not classified under the ISSUE-167 special-record
  contract; caught by the integrated unit run and fixed in `fb6ac276`.
- **Orchestrator corrections during qualification:** the first integration comparison counted only per-test failures and
  reported 13 "now passing" (10 were files that did not run); the first visual capture was viewport-only and could not
  distinguish S2 from S2b; the final unit command omitted the integration exclude. Each was caught, corrected and
  documented in `QUALIFICATION.md`.
