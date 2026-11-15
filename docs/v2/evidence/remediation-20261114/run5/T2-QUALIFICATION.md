# T-2 — `awards-reload-links` restores pre-existing award rows (run 5; affected-scope qualification)

**Scope.** One test file, `tests/integration/awards-reload-links.test.ts`; no `src/`, `tools/`, `data/`, `deploy/`, migration or package change.
Commits: `96573534` (Coleman-only restore, superseded) and **`f6af6da9`** (every `award_winners` row and award span) = executable revision Q⁗.
Authority: ISSUE-363 test remediation (363-C covered this file); the owner's run-5 instruction to prefer isolation and restoration over
accepting persistent fixture side effects. Broad qualification was not repeated.

**Host.** DEV host, new run-owned workspace `/mnt/ssd/afldb-rem5-t2-20261115` (checkout cloned from the run-4 coleman276 checkout, commits
fetched from bundles, `npm ci`, no `.env`). The run-4 coleman276 cluster (port 55684) and its two read-only templates were reused:
`rb` = accepted rebuild (dump sha256 `d8397aab…65c63`), `sn` = 4 Nov production-derived snapshot (sha256 `e77c307d…826d`). Every run used a
fresh `--template` copy, dropped afterwards; the cluster was stopped at the start and is stopped again at the end. Scripts: `host-scripts/`
(`t2-qual.sh`, `aw-diag.sh`, `b1a-rehearsal.sh`, `run5-host.sh`, `run5-host2.sh`); state = per-table row counts plus content fingerprints
(`award_winners` whole rows, Coleman family, award spans; at Q⁗ also `awards`, `award_nominations`, `hall_of_fame`,
`honour_team_members`, `captaincies`).

## 1. Red (before)

| Revision | Base / mode | Result | State diff vs untouched template |
|---|---|---|---|
| C `7088f2a1` | sn / shared | 109/109 | `award_winners` 3,712 → 3,713; Coleman family 46 → 47 (span unchanged 1980–2025); `import_batches` 75 → 197 |
| `96573534` (Coleman-only restore) | sn / shared | 109/109 | Coleman family and span **equal**; `award_winners` count equal but content differs; `import_batches` 75 → 197 |
| `96573534` | rb / shared | 109/109 | Coleman equal; `award_winners` content differs; `import_batches` 26 → 148 |

Characterisation at `96573534` (`aw-diag.sh`, column-level diff of every `award_winners` row): **rb** 3,666 rows changed, `import_batch_id`
only (re-stamped to the newest reload batch: All-Australian 1,244, squad 358, 22 Under 22 330, club and named medals ...); **sn** the same
3,666 `import_batch_id` re-stamps **plus 22 "22 Under 22" rows relinked** (`link_status_value` `implausible` → `unique`, `player_id` NULL →
a player). Both are persistent real-data side effects of the file's real reloads, so the restore was widened to every row and span (`f6af6da9`).

## 2. Green (at Q⁗ `f6af6da9`)

| Check | Result |
|---|---|
| checkout | HEAD `f6af6da9`, porcelain 0; `git diff --name-only 96573534 f6af6da9` = the one test file |
| `npm run typecheck` | rc 0 |
| `npm run lint:gate` | rc 0, **338 errors in 43 files** = the ratchet baseline (unchanged); `eslint` on the file rc 0 |
| per-file, rb | 109/109 |
| per-file, sn | 109/109 |
| shared, rb | 109/109; diff vs template: `import_batches` 26 → 148 only among row counts; `award_winners` content, Coleman family, award spans and `awards` content **equal** |
| shared, sn | 109/109; `import_batches` 75 → 197 only among row counts; `award_winners` content (3,712 rows), Coleman family (46), award spans and `awards` content **equal** |

**T-2 as reported (the +1 Coleman row and the uncovered span) is fixed, and so are the other `award_winners` side effects found on the way.**

## 3. Residue that remains (measured, disclosed, not accepted on the owner's behalf)

- `import_batches` grows by 122 rows per shared run (both bases): tests read it only relatively; the restored winner rows point at batch
  ids that still exist. Unchanged from run 4.
- **Newly measured:** the content fingerprints of `award_nominations`, `hall_of_fame`, `honour_team_members` and `captaincies` differ from the
  template after a shared run on both bases (row counts equal). Their column-level cause was not characterised in this run; for
  `award_winners` the same reloads changed `import_batch_id` only on the rebuild and, on the snapshot, also 22 links. Recommended next test
  step (routine maintenance, not an owner decision): extend the same capture/restore to those four tables after a column-level
  characterisation like `aw-diag.sh`. Per-file mode (each file its own database copy) is unaffected.

## 4. Evidence

`host-evidence/t2-host-evidence.tgz` (sha256 `22f23692a9891aec939f131b90cf9a9fa47854559c15b52c766461e7d0009640`): host logs `run.out` (C red,
static and the four runs at `96573534`), `run2.out` (characterisation and the failed first B1a load), `run3.out` (Q⁗), per-label
`state.diff` and `vitest.log` (the Q⁗ runs overwrote same-named `96573534` labels; their summaries are in `run.out`), `rows-summary.txt` per
base, typecheck/lint logs. Aggregates only; no row data leaves the host.

## 5. Process

All host work in the new run-owned workspace and the run-4 coleman276 cluster (port 55684), started and stopped by these scripts; no other
port, cluster, workspace, the shared `afldb_test`, DEV services, RB-1 or production touched. Waits were bounded loops; no host process was killed. One duplicate local wait loop of this session was stopped by its own task id.
