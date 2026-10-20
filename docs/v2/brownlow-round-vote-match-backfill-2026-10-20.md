# `brownlow_round_votes.match_id` backfill — rehearsal and production proposal (2026-10-20)

Status: **rehearsed on disposable clones; the production correction is a PROPOSAL and was not
executed.** All counts are from a clone of the migration-only copy of the archive (inputs identical to
the archived data; no production database was read). Detailed exports stay outside Git.

## 1. Why migration 094's ledger row does not prove the backfill occurred

- `afldb_meta.schema_migrations` records `094_brownlow_admin_workflow.sql` applied at
  2026-09-27T20:53:32.82Z (121 ms), in the same sub-second batch as migrations 090–105.
- Those migrations ran against an **empty** schema. The round votes were loaded roughly three minutes
  later by the older importer, which did not populate `match_id` (the importer predates the column;
  ISSUE-263 was not resolved by it).
- So the ledger proves only that 094's statements executed. Its backfill statement therefore had
  nothing to update, and every archived `brownlow_round_votes.match_id` is NULL (330,383 of 330,383
  rows, 43 seasons, 1984–2026). Migration ledger entries are untouched and must not be deleted or the
  migration rerun: the table is repaired by the targeted module below.

## 2. Rule (unchanged from 094, never loosened)

A NULL row `(season, player, round)` maps to the single home-and-away match of that season and round in
which the player has a `player_match_stats` row. Excluded and named, never guessed: `no_candidate`,
`ambiguous_candidates`, `mirror_votes_disagree` (the mirror `player_match_stats.brownlow_votes`, when
recorded, disagrees with the row), `target_pair_taken`, `target_vote_slot_taken` (would breach
`ux_brownlow_round_votes_match_player` / `…_match_value`). A NULL mirror is "not recorded" (all of 2026:
9,522 rows), not zero, and never an exclusion.

## 3. Rehearsal results (clone `afldb_v2_rb_backfill_test`, from the migration-only copy)

| Item | Result |
|---|---|
| NULL rows / repairable | 330,383 / **330,383** (positive-vote rows 22,860; zero-vote rows 307,523) |
| Excluded (all five classes) | **0** |
| Mirror not recorded | 9,522 (season 2026 only); no season has a mirror disagreement |
| Duplicate `(match, player)` or positive `(match, votes)` slots | none |
| Cross-check against the staged API match ids (2025) | 621 staged positive rows: 621 agree on match, 621 agree on vote value, 0 disagree, 0 ambiguous |
| Export digest | `38f2a9cae4f2d795f60c08536a9d5ba4f8e098fd43c64b4010b1ebcd813aa648` |
| Apply | 330,383 applied in 6.7 s (one transaction, locks held) |
| Idempotent replay | applied 0, already applied 330,383 |
| Fingerprints before to after | differ **only** in `mapped_rows` 0 to 330,383. Unchanged: public round-vote hash, `brownlow_season_votes`, brownlow `award_winners`, raw vote-value hash, all-columns-but-`match_id` hash, index validity, FK validity (0 orphans, 0 duplicates) |
| Reversal | reverted 330,383; replay 0 / 330,383; fingerprints **identical** to before |
| Re-apply after reversal | applied 330,383; fingerprints identical to the first apply |
| Refusals demonstrated | wrong digest, tampered export (content no longer matches its own digest), wrong database |

Public query paths (`getBrownlowWinners`, `getSeasonRoundVotes`) do not read `match_id`, so no public
result moved.

A performance defect found during the rehearsal is fixed: after a bulk NULL to value change (the module's
own apply or reverse) stale planner statistics made the candidate query take minutes. The query is now
set-based and apply/reverse/plan refresh statistics (`ANALYZE`, no data change) first; the re-apply and a
re-plan then took 6 s and 1 s.

## 4. Mechanism

`src/db/queries/brownlow-round-vote-match-backfill.ts`; CLI `tools/v2/brownlow-round-vote-match-backfill.ts`
(`plan | apply | reverse`, isolated runner only). `plan` is read-only and writes a reviewable export
(row id to match id, digest over rule, scope and every pair). `apply` needs the export, the digest the
reviewer read and the database name; it locks the settle gate, the Brownlow admin lock and the table,
updates only `match_id IS NULL` rows, and proves afterwards that no other column, no earlier mapping and
no row count moved (otherwise it rolls back). `reverse` is the exact inverse and refuses if a mapped row
changed since. There is no force flag. Tests: `tests/v2-brownlow-round-vote-match-backfill.test.ts`
(16, including slot clash, mirror disagreement, drift, partial failure, postcondition failure, scope,
replay and reversal).

## 5. Production correction proposal (NOT executed; separately reviewable)

Scope: every production `brownlow_round_votes` row with `match_id IS NULL` (expected: all archived rows).

1. **Gate.** Owner approves this document and names the maintenance window. No timer, deployment or
   settle runs during it (the module itself takes the settle gate exclusively).
2. **Backup.** Take and verify a restorable backup of the production database.
3. **Rehearse on that backup.** Restore it to an isolated copy and run `plan`. The counts must match
   section 3 exactly where the data is the same (repairable = NULL rows, 0 excluded, same digest for the
   same inputs). Any exclusion or count difference stops the proposal for review.
4. **Review the export** (not committed). The owner signs the digest.
5. **Apply** with the signed digest in a transaction against production through a **separately reviewed
   target arrangement**: the CLI is deliberately isolated-only, so a production runner is a new, reviewed
   step (it must reuse `applyRoundVoteMatchBackfill` unchanged; no relaxed pin).
6. **Verify**: the section 3 fingerprints (only `mapped_rows` changes), indexes valid, FKs validated,
   a public Brownlow page spot check.
7. **Rollback**: `reverse` with the same export; the fingerprints must return to the pre-apply values.

Residual risks: a production-only row outside the archive population (would surface as an exclusion at
step 3, by design); concurrent writers (the table lock and settle gate prevent them during apply).
