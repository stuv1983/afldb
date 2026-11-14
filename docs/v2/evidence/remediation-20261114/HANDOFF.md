# Remediation run 2026-11-14 — handoff (runs 1, 2 and 3 complete; candidate local, not published)

## Run 3 (2026-11-14/15, read this first)

**Start from `run3/APPROVAL-PACKET-3.md`** (it supersedes packet 2 and packet 1). Records: `run3/QUALIFICATION-3.md` (Q′ **`692b1902`**),
`run3/RESIDUALS-3.md` (with `run2/RESIDUALS.md` for unchanged rows), `run3/RUN-PLAN-3.md`, `run3/PLAN-REVIEW-3.md` (PROCEED, 0 CRIT/HIGH),
`run3/AGENT-BRIEF-COMMON-3.md`, `run3/CLOSURE-3.md` (independent verification: 0 CRIT/HIGH/MED), and the scope READMEs `run3/{stateb,rebuild,integ,integb,qualification-3}/README.md`.

**Nothing was pushed, merged, deployed, installed, restarted or written on production or DEV; there was no production contact.**

| Issue | State after run 3 |
|---|---|
| 363 | open, **partially resolved locally and qualified**: T363-1, the `settle-afl-api` snapshot-row deletion, the war-years contamination and the issue276 collision fixed; 4 `database` witnesses re-pinned; isolated accepted-baseline rebuild PASS; 53 ids classified. Remaining: shared-mode T363-2/T363-3 and owner decisions 363-W/G/C/B/3 (packet 3 §C1) |
| 365 (new, Medium) | open: Brownlow coverage recompute of a completed season; **awaiting owner D-365-1**; production rows unread (B0) |
| all others | unchanged from run 2 (table below) |

**Run-3 commits** (`git log --reverse 6d5388ea..claude/remediation-20261114`): plan `38b08a2a`; stateb `18cbde7b`, `69168858`, `5270f678`;
rebuild `a6532ec2`; integ `aae066c4`; integb `a38f98f5`, `6edf4f99`, `532e234d`, `bb81cbc9`, `0c66f3e3`, `ed256295`; qualification `692b1902` (**Q′**,
last executable change), `9cb06c53`, `6575bc95`; records `b9a43343`; packet 3 `3465fd97`; closure record and LOW corrections `5cef810b` (**publication candidate**); then the commit updating packet 3
and this section (records only). Scope commits were cherry-picked (`-x`) from `claude/rem3-<scope>-20261114`; the qualification branch was fast-forwarded.

**Successor record:** candidate `5cef810b88c1cd1e880e6eb5d9fb09322f8db618`; Q′ `692b1902cbcc321cea76a30857a03e15f02db6b7`; `origin/main`
`de640826` (re-fetched 2026-11-15); `git diff --stat 692b1902 5cef810b` lists only `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`
and `docs/…`. Next actions, in order: owner approval A (publication); B0 read-only production probe; B1; owner decisions §C1 (D-365-1 first, then
363-W/G/C/B), each implemented and qualified in a new run; B2 before 2027-03-10.

**Housekeeping (run 3):** host workspaces `/mnt/ssd/afldb-rem3-{stateb,rebuild,integ,integb,qual}-20261114` (+ `-pg` clusters, all stopped; no listener on
55671–55677) and `/mnt/ssd/afldb-rem3-base` (bundle, heavy lock, the rebuilt dump and bridge child under `rebuilt/`) are left in place (sizes in
`RESIDUALS-3.md` §4). Worktrees `D:\dev\afldb-rem3-{stateb,rebuild,integ,integb,qual}` and scratch `D:\tmp\afldb-rem3-*` are left for the owner to remove.
Agent returns are persisted (gitignored) under `.phaneslight/returns/rem3-20261114/` of the integration worktree. DEV unchanged:
`run3/DEV-STATE-BEFORE-3.txt` vs `run3/DEV-STATE-AFTER-3.txt`.

---

## Run 2 (2026-11-14)

**Start from `run2/APPROVAL-PACKET-2.md`** (it supersedes `APPROVAL-PACKET.md`). Records:
- `run2/QUALIFICATION-2.md` (final checks at executable revision **`f10e47ad`**);
- `run2/RESIDUALS.md` (every residual, none accepted on the owner's behalf);
- `run2/REVIEW-C.md` and `run2/REVIEW-D.md` (independent reviews, all MED fixed);
- `run2/RUN-PLAN-2.md`, `run2/PLAN-REVIEW-2.md`;
- scope READMEs under `run2/<scope>/`;
- corrections appended to `QUALIFICATION.md` §7.

**Nothing was pushed, merged, deployed, installed, restarted or written on production or DEV.**

| Issue | State after run 2 |
|---|---|
| 353, 356, 359, 360, 361 | resolved locally (run 1). Run-2 residual fixes are **fixed locally and qualified**, awaiting publication. 353 has owner decision O-A05-1 (recommended: leave); 361 has O-B06-1/2 |
| 357 | open: **fixed locally** (Caddy deny), qualified, **awaiting publication and installation** (B7); MED residual; operational acceptance is the owner's |
| 362 | open: fixed locally (B-05, redaction in any spelling and in the redirect headers); **awaiting publication, installation (B7) and the owner's log decision (B8)** |
| 363 | open: decisions (1)+(2) **fixed locally and qualified**; decision (3) **awaiting a rebuilt `afldb_test`**; `state-b` follow-up |
| 364 | open: gate wired as a ratchet, **fixed locally and qualified**; **awaiting owner acceptance** of the merge-time ratchet as O-2 |
| 332 | open: pull check prepared; **awaiting owner decision** (D-332-1 option A, G0b/G0c) and installation (B3) |
| 350, 351, 352 | open: procedures written; **awaiting publication, release and the owner's operations** B2, B4, B5, B6 |
| 348 | open: unchanged by run 2 |

**Run-2 commits** (dependency order, `git log --reverse e8666c17..claude/remediation-20261114`):
1. Plan: `d380cc7c`.
2. lint364: `c79d7d06`, `c2c57443`, `bb78fae7`.
3. Fixtures: `3234875e`.
4. Ops: `eecea3b7`, `87615e80`, `c78ead61`.
5. Evidence: `3cda9127` … `697c6f55`.
6. Public: `f06cb3c8`, `a7c04ea7`, `bb0ad0d9`, `5497cbd5`, `66376ac4`.
7. Admin: `c0e7e9a7`, `8015f590`, `7f6ce0f6`, `628c215c`.
8. caddy357: `e9554f81`, `52efe47e`.
9. REVIEW-C and its fixes: `378f7d75`, `547444c6`, `8bbe7b62`, `e03d0d5b`, `c3984b99`, `42637e58`, `a563320a`, `3e158e14`, `8e65d0ec`.
10. ISSUE-363: `fb9e94a6`, `20280244`, `acd3a8c9`.
11. REVIEW-D and its fixes: `cdf2bce5`, `48cc4af3`, `88e14e6a`, `26844758`, `0efb276d`, `ade11cc6`, `2e95612f`, `f10e47ad` (**Q**, last code change).
12. Records only after Q: `0f5ca7ee`, then the commits adding `QUALIFICATION-2.md`, the ledger sync and this packet.

Scope commits were cherry-picked from `claude/rem2-<scope>-20261114`.

**Housekeeping (run 2):**
- Host workspaces `/mnt/ssd/afldb-rem2-<scope>-20261114` and `/mnt/ssd/afldb-rem2-int-20261114` are **left in place**, with their clusters stopped. Sizes: public about 23 G, tests363 about 7 G, int and caddy357 also present. Scratch `D:\tmp\afldb-rem2-<scope>\` and the worktrees `D:\dev\afldb-rem2-<scope>` are left in place.
- The heavy lock file `/mnt/ssd/afldb-rem2-base/heavy.lock` and the base bundle are kept.
- DEV is unchanged: `run2/DEV-STATE-AFTER-2.txt` against `run2/DEV-STATE-BEFORE-2.txt`.

---

## Run 1 (as recorded at `e8666c17`)

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
