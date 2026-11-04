# ISSUE-333 (O1) and O2: consolidated approval package (2026-11-04)

**Status: PREPARED, NOT APPLIED.** Nothing in this package has written to production except the one authorised backup directory
(`/home/arm/backups/afldb/issue333-o2-20261104T021037Z`, mode 700) and the private ops workspace `/home/arm/ops/issue333-o2-50ed6e4f/`
(checkout, plan files, one staging directory). No apply, grant, deploy, restart, timer or setting change was made. Open issues: 2 (ISSUE-332, ISSUE-333).
Every figure below traces to a retained output in `docs/v2/evidence/issue333-o2-20261104/` (README lists each file and its sha256).

This package replaces the withdrawn `docs/v2/evidence/coach2026-20261104/prod-coach2026.sh` (now `exit 9`) and the O1 commands of
`docs/v2/post-release-closeout-2026-11-04.md` section 8. The broad importer `tools/migration/import_match_coaches.py` is not run and not modified.

## 1. What is bound

| Item | Value | Evidence |
|---|---|---|
| Revision R | `50ed6e4f4a697160ef263ade293792363e52e975` (local commit, not pushed) | `git log`; `prod-plans/prod-prep.txt` |
| Ops checkout package | `cand.tar.gz` sha256 `dfef496c53c647b2a55c038e59585e80fb97ec7416169c86f8a42f348ef12d8b`, HEAD = R, 4,415 tracked, dirty 0 | HEAD, tracked count and dirty 0: `prod-plans/prod-prep.txt`. The tarball sha256 was measured on the workstation at build time and is not in the retained evidence; the checkout is proven by HEAD = R, a clean tree and the plans' `toolSha256` maps. |
| Source package (O1) | `core.tar` sha256 `9a989fdcf7177cff24bbedcd0ee4559b772ebc452c05dab331e128859e4db080` (fitzRoy core `c2-2026-final-core-v1`, manifest sha256 `02bbcf93...9988`) | `prod-plans/prod-prep.txt`, `f002-stage-fold-workstation.txt` |
| Production identity | `afldb_prod`, system id `7674454702926115004`, database oid `66668`, cluster `16/main`, PG `160015`; read role `afldb_backup` (transaction_read_only on) | `backup/capture.txt`, `prod-plans/prod-plans.txt` |
| Tool bytes | `toolSha256` maps inside each plan (18 files for O1, 6 for O2: ceremony, writer, shared modules, importer libraries, contracts, manifests, parsed coach CSVs) | `prod-plans/plan-*.json` |
| **O1 plan digest** | **`4de5368c7b4dfff00550b5ec60bb8596d1e84804534a94d0b7f6836a3dbc515e`** created 2026-11-04T02:16:51.682Z, expires 2026-11-05T02:16:51.682Z | `prod-plans/plan-i333-20261104T021651Z.json` (sha256 `10d2f825...83ad`) |
| **O2 plan digest** | **`c29d148d17af1cdc94ecae547a8026365dee5ade66def278dba9b49a84f7ea03`** created 2026-11-04T02:17:15.032Z, expires 2026-11-05T02:17:15.032Z | `prod-plans/plan-o2-20261104T021714Z.json` (sha256 `7e421ac3...0c9e`) |

Both production plans ran read-only (REPEATABLE READ, `transaction_read_only=on`, SELECT-only cursor, no temporary schema, `track_counts=on`), at R, from a clean
ops checkout that was still clean afterwards; the serving checkout stayed at `d00e07e3` with 0 status lines.

## 2. Backup and restore evidence (ONE backup, shared by O1 and O2)

| Item | Value |
|---|---|
| Capture | `issue333-o2-20261104T021037Z`; pg_dump 16.15 custom format, start 2026-11-04T02:10:38.102Z, end 02:10:48.166Z, exit 0, stderr 0 bytes |
| Archive | `afldb_prod-20261104T021037Z.dump`, 30,141,895 bytes, sha256 `e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d`, 1,651 TOC entries |
| Ledger | 118 rows, last `118_fixtures_unconfirmed_participants.sql`, digest `573594e9...af57`, unchanged across the capture |
| Writers at capture | AFL Tables timer disabled/inactive, AFL API timer enabled (not running), no settle/migrate/dump process; app active |
| Restore | streamanator fresh workspace `/mnt/ssd/afldb-issue333-o2-20261104`, guarded cluster `afldb_v2_isolated` 127.0.0.1:55493, database `afldb_v2_i333o2_b20261104t021037z_rst_test`; pg_restore exit 0, 0 stderr lines; restored 2026-11-04T02:13:31.072Z; restored ledger `118_...`, 17,056 matches |
| Restore evidence | `restore-evidence.json` sha256 `07e1f6942df51dff90e045b942d5c35cf3585f35d6b36c53d09489c3e987c6f1` |
| Sealed stage I333 | `backup-I333.json` sha256 `43a8c339ee76aa38343a31348fe7ce2647cdf51962bce67606790ee971157e98`, seal `35cdcab5...85a9`, operation digest `d5ddb146...c2de`, new-row digest `33f5b466...dd99`, import_batches prefix 75 rows / max id 82 |
| Sealed stage O2 | `backup-O2.json` sha256 `6f74095d6b2bcda12ab7dac56e2f5ee88fbeb0416bc7e1f2b8d9d91e83c1fcf3`, seal `2ff179dd...aaff`, operation digest `1286f940...7551`, comparison digest `8cbcb720...a4e`, other findings 4 rows / max id 4 |
| Equality with live | Both production plans: the live operation digest and new-row / comparison digest EQUAL the restored copy's; 0 import_batches rows and 0 other findings appended since the backup |
| DEV services (streamanator) | `afldb.service` MainPID 1677 and `postgresql@16-main.service` MainPID 1536 before and after every phase |

**Backup deadline: 2026-11-05T02:10:38Z (13:10:38 AEDT, 5 November)** = capturedAt + 24 h. After it every apply refuses ("backup no longer fresh").

**Refresh.** A refresh is a SECOND production backup and needs fresh owner authorisation: run `scripts/capture-prod-issue333-o2.sh` again (new stamp),
transfer it privately, `scripts/restore-assemble-i333-o2.sh` with a new TAG, upload the new `backup-*.json` / `restore-evidence.json`, re-plan with
`scripts/prod-ops-i333-o2.sh plan-i333|plan-o2 <R> <new stamp>`, and approve the NEW plan digests. A tool change after the backup needs re-review, a new
commit R', a new ops checkout and re-assembly (the seal binds R and the tool bytes); no new backup is needed while the old one is fresh.

## 3. Baselines and exact expected effects

**O1 (ISSUE-333).** Live and restored baseline: `match_coaches` 32,034; `coaches` 386; 218 matches in 2026 with 436 coachless sides and 0 2026 assignments;
`import_batches` 75 rows (max id 82); `import_rejections` 681 (max 681); coach `data_overrides` 0; only trigger on the touched tables is
`match_coaches_club_in_match_trg` (BEFORE, validation only). Source: 695,499 rows read, 34,112 team-match groups, 436 of them in 2026 (0 blank), 386 coaches.
Effect of one apply, in ONE transaction: exactly **436 new `match_coaches` rows** (every 2026 side of all 218 matches; plain INSERT, no ON CONFLICT) and
**one `import_batches` row** (`tool = add_match_coaches_2026.py`, `target_table = match_coaches`, status `completed`, `records_inserted = 436`;
`records_read = 695,499` is the all-seasons source row count, review F-009). No coach row inserted or updated, no existing assignment updated, nothing
deleted, no override replayed. The writer COMMITs only if, inside its transaction, every pre-existing row of `match_coaches`, `coaches` and `import_batches`
is unchanged in every column, the added rows equal the planned 436, and `pg_stat_xact_user_tables` shows exactly `import_batches [1 ins, 1 upd]` and
`match_coaches [436 ins]`.

**O2.** 36 open `canonical_apply_failed` / `foreign_source_owner` findings, ids 41-76 (owner AFLDB-ISSUE-122, detected 2026-09-28), 53 flagged field
instances, all 53 equal and non-NULL (staged AFL API value = canonical `player_match_stats` value, same version_seq, same player/club/match); 4 other
findings (ids 1-4, `player_achievements`); no trigger on `data_issues`. Effect: one UPDATE of exactly those 36 rows setting `resolved_at = now()` and
`resolution = 'canonical_apply_not_needed'`; every other column of the 36, every other finding, the canonical and staged rows unchanged; write set exactly
`data_issues [36 upd]`. No import batch, no canonical write, no ownership change. Correction carried: the earlier record's "50" was an arithmetic error (53).

The two plans are **order-independent**: O1 writes nothing O2's plan binds (data_issues, player_match_stats, staging), and O2 writes nothing O1's plan binds.

## 4. Public coaching figures (application queries on the rehearsal clone, not production)

Read through `src/db/queries/coaches.ts` (`getCoachCareer`, `getClubCoachRecords`, `listCoaches`) as `afldb_app` on clone `afldb_v2_r1_i333_happy_test`,
before and after the rehearsal apply (`scripts/coach-figures.mts`; outputs in the rehearsal evidence):

| Coach | Before | After |
|---|---|---|
| Josh Carr (id 243) | 0 games | 23 games, 7 W 0 D 16 L, Port Adelaide 2026 (club record row: Josh Carr 2026-2026, 23 games) |
| Josh Fraser (id 293) | 0 games | 16 games, 12 W 1 D 3 L, 1 final, Carlton 2026 (club record: Josh Fraser 16 games; Michael Voss 2022-2026 103 games) |
| `/coaches` index | 386 coaches, 32,034 games in total | 386 coaches, 32,470 games; 20 coaches changed, +436 in total |

**Not measured: when production pages show the change.** Season and player pages were observed (closeout record V2) to answer
`s-maxage=3600, stale-while-revalidate=31532400`; the coach and club pages' headers were NOT observed in this work. A header does not bound
time-to-visibility, and per-page/per-worker ISR regeneration (ISSUE-134) is unmeasured. After the apply, measure, do not assume (section 9).

## 5. Rehearsals (fresh production-derived clones of the restored backup, streamanator)

Harness `scripts/rehearse-i333-o2.sh` + `scripts/scn.sh` at revision R, one fresh clone (`afldb_v2_r<run>_<scenario>_test`) of the restored backup
`afldb_v2_i333o2_b20261104t021037z_rst_test` per scenario, isolated cluster under `/mnt/ssd/afldb-issue333-o2-20261104`, every plan in `--rehearsal` mode
(F-003). Each scenario also checks that the digests of everything outside its write set are unchanged (other seasons' assignments, coaches, import_batches
id <= 82, import_rejections, the other data_issues rows). DEV `afldb.service` MainPID 1677 and `postgresql@16-main` MainPID 1536 were unchanged across every run.
Evidence: `rehearsal/` (per-scenario `.txt` logs, `.out` outputs, digest and figure JSON; plans and staging omitted for size).

| Scenario | What it injects | Measured outcome | Checks |
|---|---|---|---|
| i333_happy | nothing | COMMITTED_VERIFIED (0); state PLANNED RESULT PRESENT; second apply REFUSED_BEFORE_MUTATION (1); Carr/Fraser figures section 4 | 9/9 |
| i333_conflict | one stored 2026 assignment with a different coach | plan refused: 1 pre-existing assignment conflict | 2/2 |
| i333_drift | one `coaches.notes` changed after the plan | apply REFUSED_BEFORE_MUTATION (1), baseline drift | 4/4 |
| i333_rollback_commit | deferred trigger raising at COMMIT | ROLLED_BACK (2); state BASELINE | 6/6 |
| i333_rollback_surplus | trigger adding a surplus import_batches row | ROLLED_BACK (2) (strict classify); state BASELINE | 6/6 |
| i333_rollback_preserve | trigger altering one 2025 assignment | ROLLED_BACK (2); state BASELINE | 6/6 |
| i333_commit_inflight | writer SIGKILLed during a 15 s deferred COMMIT | probe waited for the server session (F-001), then COMMITTED_VERIFIED (0) | 7/7 |
| i333_commit_inflight_long | same, 50 s COMMIT (longer than the 30 s wait) | OUTCOME_UNDETERMINED (5); state exit 6 while the session lived, then PLANNED RESULT PRESENT | 7/7 |
| i333_uncertain_committed | outcome file lost after a committed apply | state PLANNED RESULT PRESENT; re-apply REFUSED_BEFORE_MUTATION (1) | 7/7 |
| i333_uncertain_killed | ceremony process group SIGKILLed while its writer waited on a lock | no outcome record; state BASELINE; the same plan then applied COMMITTED_VERIFIED (0) | 8/8 (run 3) |
| o2_happy | nothing | COMMITTED_VERIFIED (0); state PLANNED RESULT PRESENT; second apply refused (1) | 8/8 |
| o2_drift | one canonical `one_percenters` changed after the plan | apply refused (1); a re-plan refused: 1 flagged field not equal | 6/6 |
| o2_already_resolved | data_issues 41 resolved by another actor after the plan | apply refused (1); a re-plan refused (not an unresolved finding) | 6/6 |
| o2_rollback_commit | deferred trigger raising at COMMIT | ROLLED_BACK (2); state BASELINE | 6/6 |
| o2_rollback_surplus | trigger changing one other data_issues row | ROLLED_BACK (2); state BASELINE | 6/6 |
| o2_commit_inflight_long | writer SIGKILLed during a 50 s COMMIT | OUTCOME_UNDETERMINED (5); state exit 6, then PLANNED RESULT PRESENT | 7/7 |
| o2_uncertain_committed | outcome file lost after a committed apply | state PLANNED RESULT PRESENT; re-apply refused (1) | 6/6 |
| o2_uncertain_killed | ceremony SIGKILLed while its writer waited on a lock | no outcome record; state BASELINE; the same plan then applied COMMITTED_VERIFIED (0) | 7/7 (run 3) |

**Runs.** Run 1 (all 18 scenarios): 104 checks passed and 8 failed. All 8 failures were in the two `*_uncertain_killed` scenarios. They came from a harness defect, not a tool defect.

- **The defect.** The harness backgrounded a shell function. Killing it did not stop the lock-holder process, which ran to its own end and printed `RELEASED` in `lock-holder.out`. So the SIGKILLed ceremony's server-side writer session stayed live, blocked on the held lock.
- **What the tools did in run 1.** During that time, `state` correctly answered UNDETERMINED (exit 6), and apply correctly refused with REFUSED_BEFORE_MUTATION (1) because a writer session was live.
- **Run 2.** Run 2 re-ran only the two scenarios with that interim state accepted. It passed 11 checks and failed 4. It measured the UNDETERMINED branch: the session ended 3.2 s after the holder's kill was signalled, consistent with the writer's 5 s `lock_timeout`. Then `state` said BASELINE. The recovery apply then hit the still-held lock (`LockNotAvailable`) and was correctly classified ROLLED_BACK (2), with the pre-run state proven.
- **Run 3.** For run 3 the harness backgrounds the Python holder itself. Run 3 passed all 15 of 15 checks.

No tool file changed between runs; only `scripts/scn.sh` did. Not rehearsed: either recovery (section 9), and the owner wrapper `scripts/prod-apply-i333-o2.sh`, which only calls the rehearsed ceremonies.

## 6. Tests (local, at R)

`python tests/python/issue333_o2_contract.py` 84 of 84 (staging refusals, additive-set refusals, classify, writer commit/rollback paths through a recording fake,
O2 comparison, approval binding, sealed evidence, live-writer probe); `npx vitest run tests/gap029-assembly.test.ts tests/v2-season-seal.test.ts` 95 of 95
(I333/O2 stage fields added; S1-S4 unchanged); `tsc --noEmit` clean; the real `stage_core` + `read_source` chain DB-free on core.tar (season2026Groups 436,
`f002-stage-fold-workstation.txt`).

## 7. Approval texts (separate; each is bound to one plan digest)

**O1 approval (ISSUE-333).** "I approve ONE production apply of plan `4de5368c7b4dfff00550b5ec60bb8596d1e84804534a94d0b7f6836a3dbc515e`
(operation `issue333-coach-assignments`, revision `50ed6e4f4a697160ef263ade293792363e52e975`, target `afldb_prod` system id 7674454702926115004 oid 66668,
package core.tar `9a989fdc...b080`), adding exactly 436 `match_coaches` rows for the 2026 season and one import batch row in one transaction, backed by the
restore-verified backup `issue333-o2-20261104T021037Z` (dump `e77c307d...826d`). Valid until the earlier of the plan's expiry, the backup deadline
2026-11-05T02:10:38Z and the expiry I write in approval-i333.json; outside 04:15-05:30 host time. Any refusal stops; I decide any retry."

**O2 approval.** "I approve ONE production apply of plan `c29d148d17af1cdc94ecae547a8026365dee5ade66def278dba9b49a84f7ea03` (operation
`o2-converged-findings`, revision `50ed6e4f...e975`, same target), setting `resolved_at = now()` and `resolution = 'canonical_apply_not_needed'` on exactly
data_issues ids 41-76 and nothing else, backed by the same backup. Same validity and window rules."

## 8. Owner command block (on production, as arm; the owner writes approval.json)

```bash
R=50ed6e4f4a697160ef263ade293792363e52e975; S=/home/arm/ops/issue333-o2-50ed6e4f/in/prod-apply-i333-o2.sh   # placed there 2026-11-04, sha256 ae456bdc...51c2 = scripts/prod-apply-i333-o2.sh; NOT run, NOT reviewed, NOT rehearsed (only statically cross-checked against the ceremonies' flags and approval fields); the ceremonies it calls were rehearsed and fail closed
P1=/home/arm/ops/issue333-o2-50ed6e4f/evidence/plan-i333-20261104T021651Z.json
P2=/home/arm/ops/issue333-o2-50ed6e4f/evidence/plan-o2-20261104T021714Z.json
bash $S state-i333 $R $P1                      # expect: STATE BASELINE (the plan has not been applied)
bash $S approve-i333 $R $P1 "owner approval O1 <date/channel>" 2026-11-04T17:00:00Z   # writes evidence/approval-i333.json (exclusive)
bash $S apply-i333 $R $P1 20261104T021037Z    # expect: OUTCOME COMMITTED_VERIFIED (exit 0)
bash $S state-i333 $R $P1                      # expect: STATE PLANNED RESULT PRESENT
bash $S state-o2 $R $P2
bash $S approve-o2 $R $P2 "owner approval O2 <date/channel>" 2026-11-04T17:00:00Z
bash $S apply-o2 $R $P2 20261104T021037Z      # expect exit 0
bash $S state-o2 $R $P2
```

Run each via `cmd /c "ssh -o BatchMode=yes afldb bash -s < ..."` or an interactive shell; one at a time. The approval expiry must be in the future, no later than
the plan's expiry; 17:00Z keeps it before the no-apply window. Exit codes: 0 COMMITTED_VERIFIED, 1 REFUSED_BEFORE_MUTATION, 2 ROLLED_BACK,
3 COMMITTED_VERIFICATION_FAILED, 4 COMMITTED_VERIFICATION_UNAVAILABLE, 5 OUTCOME_UNDETERMINED; `state` 0 = BASELINE or PLANNED RESULT PRESENT (the label is the
evidence, F-007), 6 = OTHER or a writer session still live. On any non-zero apply: run `state`, keep every output, do not retry without a new decision.

## 9. Recovery, limits and what is not measured

- **Recovery.** Neither tool retries, reverses or restores. O1: a committed result is removable only by an owner-decided DELETE of the 436 rows of that
  batch id (they carry `import_batch_id`); restoring the backup would discard every later write and is a separate owner decision. O2: the plan carries the exact
  pre-image of the 36 rows; re-opening them (`resolved_at = NULL, resolution = NULL`) is an owner decision and is blocked by `uq_data_issues_open_by_key` for any
  key a later settle re-opened as a new row. Neither recovery has been rehearsed or prepared as a script.
- **No-apply window** 04:15-05:30 host time (the AFL API timer 05:00 + up to 15 min, Persistent; AFL Tables timer disabled). The nightly batch row it appends
  makes the O1 plan stale (baseline drift, refused). **Practical window for these digests: now to 2026-11-04T17:15Z (04:15 AEDT, 5 November).** After 05:30 AEDT,
  a read-only re-plan with the same backup (fresh until 02:10:38Z) and a NEW approval are needed.
- **Admin coach edits** on production after the capture (coaches rows, coach overrides) invalidate the backup for O1 (they are in its operation digest; F-006).
- **Verification is immediate** (F-008): a later OTHER state after other writers act is not a defect of the apply.
- **Unmeasured, with read-only commands for after the apply:** time-to-visibility of `/coaches`, the two coaches' own pages and the Port Adelaide and
  Carlton club pages, per worker — for each page URL `U` on the public host: `curl -sI "$U" | grep -i -E 'cache-control|x-nextjs-cache|^age'` and a body check
  `curl -s "$U" | grep -o 'Josh Carr[^<]*'`, repeated at intervals and recorded with timestamps; production figures via `state` (expect PLANNED RESULT PRESENT)
  plus the read-only count `SELECT count(*) FROM match_coaches m JOIN matches x ON x.id = m.match_id WHERE x.season = 2026` (expect 436). Whether production's
  app queries return exactly the section 4 figures is unmeasured until then (they were measured on the clone only).

## 10. Reviews and deferrals

Plan review (`.phaneslight/returns/issue333-o2-20261104/01-plan-review.md`): PROCEED, F-001..F-005 MED folded in. Tools review before the backup (`03-tools-review.md`):
GO after fixes, 0 CRIT/HIGH; F-001 MED (probe vs an in-flight COMMIT) and F-002 MED (real source chain never executed) fixed or done before R; F-003/F-004 LOW
fixed; F-005..F-011 INFO adopted (see `documentation/plans/PLAN-issue333-o2-20261104.md`). No finding deferred.
