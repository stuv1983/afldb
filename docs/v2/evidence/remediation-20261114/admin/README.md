# Admin remediation 2026-11-14: ISSUE-353 and ISSUE-354

Branch `claude/rem-admin-20261114`, base `5035ed96` (review records of `de640826`). Worker: afldb-worker (Sonnet).
No production/DEV database was read or written. No migration (R-6). Aggregates and ids only; no row extracts.

## Commits (in order)

| SHA | Subject |
|---|---|
| `2decc71c` | ISSUE-354: merge an admin edit only into an ACTIVE override, and audit what is carried or dropped |
| `33728416` | ISSUE-353: refuse Match Sheet line-up row removal, club change and return-to-source while dependents exist |
| `e0c36ce7` | ISSUE-353/354: host helper scripts used to qualify the admin remediation (qualification HEAD) |
| (this README) | docs only, no code |

## ISSUE-353 (validated, amended)

Finding: `saveMatchSheet` deleted `player_match_stats` rows for plan `remove` items and `returnMatchSheetToSource`
(`withdraw_delete_row`) deleted a manual addition's row with no dependent check; Brownlow votes, vote-entry slots and
first-kick-goal / after-the-siren records were left naming a non-participant. `deleteMatch` already refuses these at match level.

Fix: `src/lib/match-sheet-dependents.ts` (pure refusal wording) and `src/db/queries/match-sheet.ts` (reads inside the
match transaction after the plan is accepted, before any write). Refuses on: Brownlow round votes > 0 for that player in
that match; the match's `brownlow_vote_entry_state` slots (3/2/1) naming the player; `player_achievements` /
`after_siren_kicks` rows (active or suppressed) by match + player. The same check refuses a club change (the records carry
`club_id`) and a Return-to-source that would delete the row. Stat-only edits and dependent-free players are unaffected.
The refusal names each player, each fact, and where to clear it (Brownlow administration / Special records).

Plan-review amendments:
- A-1: keyed to the player's OWN round-vote rows, not the match. Tests: voted player refused and an unvoted player of the same
  match removable. Match-level rule stays only in `deleteMatch`.
- A-2: Brownlow vote entry (`admin-brownlow.ts lockMatch`) takes the same `matches ... FOR UPDATE` lock as the Match Sheet.
  Special-record creation took NO lock and read the line-up row unlocked (TOCTOU). Fixed: `FOR SHARE` on that read in
  `validateSpecialRecordMatchLink` (`admin-special-records.ts`). It conflicts with the Match Sheet's FOR UPDATE, so both
  interleavings close. Residual (LOW): creation has no `lock_timeout`; record update/reassign paths do not re-validate the link.
- A-3: refusal text names where to clear each dependent; suite proves a dependent-free player is removable.
- A-6: period stats not implemented (see Owner decisions).

Snapshot aggregates behind the Brownlow-zero decision (counts only): `brownlow_round_votes` 330,383 rows (307,523 zero,
22,860 > 0, 9,522 NULL `match_id`); 320,861 line-up rows have a round row, 298,622 of them zero. Refusing on any round row
would block nearly every removal in 1984-2025, so only `votes > 0` is a dependent ("published zero" is not).
Rows with NULL `match_id` cannot be attributed and are not fuzzily matched (INFO).

## ISSUE-354 (validated)

Finding: `saveCoachMetadata` (`admin-coaches.ts`), `saveSourcePickFields` (`admin-draft.ts`) and `saveEdit` (`data-edits.ts`)
read the `data_overrides` row without `is_active`, merged it and upserted `is_active = true`, so editing another field of
the group re-activated values the admin had retired. Other `is_active = true` upserts (special records, season lists,
fixtures, club leadership, awards, match sheet, linkage/assignment, draft manual pick) overwrite the whole payload: not
affected. `player-identity.ts` already merges active-only.

Fix: `src/lib/override-merge.ts` `mergeOverrideDelta` merges only into an ACTIVE stored row; a retired row starts from `{}`
(a no-change edit against a retired row writes nothing). `data_edits.new_values` gains `override_carried_keys` /
`override_retired_keys_dropped` only when non-empty (precedent: match_sheet `authorityKeys`); an ordinary first edit's audit
shape is unchanged.
- A-4: retire paths record the retired payload in `data_edits` (`retireCoachOverride`: old_values = payload, new_values
  `{..., retired:true}`; `retireSourcePickOverride`: old_values = retired payload), so starting from `{}` loses nothing.
  No retire path exists for players/matches (`saveEdit`); the test retires by direct UPDATE.
- A-5: `saveEdit` callers: `src/app/admin/data-editor/actions.ts`, `tools/v2/apply-gap029-match-events.ts` and `-production.ts`.
  Suites reaching it were all run (below).
- The existing source pin "Delta-only override payload behaviour" in `tests/data-overrides-source-contract.test.ts` matched
  the old code shape; it was updated to the new shape (still pins delta-only, now also the `is_active` read). This is a
  pin of a refactored statement, not a weakened assertion; flagged for the reviewer.

## Tests (extended existing suites; all synthetic subjects, R-4)

Host: streamanator, workspace `/mnt/ssd/afldb-rem-admin-20261114`, isolated cluster port 55613, template restored from the
approved snapshot (sha256 `e77c307d...2826d`), each integration run on a fresh disposable copy. Heavy jobs under the
run-wide flock with `nice`/`ionice`. Logs stay on the host under `/mnt/ssd/afldb-rem-admin-20261114/evidence/`.

RED (unfixed src of `de640826`, new tests only; `red1/red2/red-unit`):
- red1 `admin-coaches` + `admin-draft`: 3 failed, 67 passed. `expected { notes: 'decision A', ... } to deeply equal { given_name: 'Changed' }`;
  `expected true to be false` (a no-change edit after retire re-activated the row); draft: received payload included the
  retired `pick_note`.
- red2 `data-editor` + `admin-special-records`: 13 failed, 92 passed, 1 skipped. 8 are mine: six ISSUE-353 cases fail with
  `AssertionError: expected true to be false` (`result.ok` was true, i.e. the removal/club change was accepted), the saveEdit
  ISSUE-354 case `expected { birth_year: 1990, ... } to deeply equal { birth_year_confidence: 'sourced' }`, and the lock test
  `expected 'completed' to be 'waiting'`. The other 5 are baseline (below).
- red-unit `match-sheet` + `data-overrides-source-contract`: 8 failed. Unit red is module absence
  (`Cannot find package '@/lib/match-sheet-dependents'` / `'@/lib/override-merge'`) plus the static guards; the DB tests are
  the behavioural red.

GREEN on the final checkout `e0c36ce7d6c2d26cecd03b20a6816cc94fc31f93`, `git status --porcelain` empty (`final-*`):
- `final-tsc` (`next typegen` + `tsc --noEmit -p .`): exit 0.
- `final-unit` match-sheet, data-overrides-source-contract, admin-coach-actions, admin-draft-actions, v2-season-seal,
  player-link-mutations, awards-admin: 521 passed.
- `final-int-a` (prep variant, see below) data-editor, match-admin-create, sealed-editor-guard: 3 files, 93 passed, 1 skipped.
- `final-int-b` admin-coaches, admin-draft, admin-special-records, admin-audit, match-admin-delete, admin-lifecycle:
  6 files, 178 passed.
- `final-int-c` other `saveMatchSheet` / `returnMatchSheetToSource` callers (admin-brownlow, match-results-promotion,
  settle-afl-api-state-b, settle-afl-api, settle-afltables): 251 passed, 2 failed, both unrelated environment/snapshot
  failures that stop before any code I changed: `admin-brownlow` "resolved every historical round row to exactly one match
  (preflight P2)" `expected 9522 to be +0` (the snapshot's 9,522 NULL `match_id` rows) and `settle-afl-api` OD-5 reinstate
  `Refusing to rebuild 'afldb_v2_remadmin_finc_test'` (rebuild targets are name-pinned). Neither assertion reads any
  touched code; re-run against the real `afldb_test` rebuild target is the owner's call.

Baseline failures (identical on unfixed and fixed code, not caused by this change): five data-editor "Durable Match Sheet
authority" replay tests (2a, 2b, 2c, 3a, 3b) fail with `afldb_test must hold no player_match_stats authority before this suite
(the replay would apply it): expected 1 to be +0`, because the restored snapshot already holds one active
`player_match_stats` override (`2026|4|2026-03-28|Essendon|North Melbourne` key). The review run skipped them (`canReplay`
false). They ran green in `final-int-a` on a disposable copy with that single row removed by `prep-authority.mjs`
(`*_test` guard). Recommend the owner decide whether the real `afldb_test` should hold that row.

sha256 of host logs: final-tsc `fe701291...`, final-unit `4d194e05...`, final-int-a `a351c112...`, final-int-b `97f52eb2...`,
final-int-c `58cf1824...`, red1 `ede9c2b4...`, red2 `683eb0e5...`, red-unit `5efbe46c...`, green1 `e6004a74...`,
green2 `5781865e...`, green-unit `e8c74891...`. Qualification bundle `admin-rem-final.bundle` sha256 `d7acc233...`.
Full hashes are in the worker report.

Scripts: `host-setup.sh`, `host-env.sh`, `run-suite.sh`, `run-suite-prep.sh`, `unit.sh`, `tsc.sh`, `prep-authority.mjs`,
`probe-*.mjs`. Each was copied from this directory to the host `in/` folder and hash-verified identical before use (the
run-wide notice about overwritten shared scratch scripts does not apply: no result here came from a shared-scratch script).

## Owner decisions

1. Period stats (`player_match_period_stats`): not checked. 0 rows, no writer, no FK to `player_match_stats`. Option A (recommended,
   current): leave until a writer exists. Option B: add a count query to `matchSheetDependentsRefusalFor` and a "player
   period statistics" part mirroring `deleteMatch` (ISSUE-180 wording), fail-closed now.
2. Brownlow zero rows: only `votes > 0` is a dependent (recommended). Alternative: refuse any round row (blocks ~93% of removals).
3. Audit shape: extra keys inside `data_edits.new_values`. Alternative: a separate audit column (would need a migration; not recommended).
4. `afldb_test` baseline holding one `player_match_stats` override (above).

## Residual findings (LOW/INFO)

- Special-record creation has no `lock_timeout`; it can wait behind a settle holding line-up locks.
- Special-record update/reassign paths (`manualLinkIdentity`) do not re-validate the line-up link.
- `D:\dev\afldb` carries unrelated uncommitted edits to `admin-draft.ts` and its test: merge-conflict risk for the orchestrator.
- Commit trailer follows the run protocol (`Claude Opus 5.5`); the harness reminder names Sonnet 5.5. Orchestrator may normalise.
