# AFLDB-ISSUE-264 — Legacy CSV promotion overwrites Match Sheet-protected `player_match_stats` fields and re-inserts players the Match Sheet removed

## 0. Status

- **Status:** Open. **Not implemented.**
- **Opened:** 2026-10-03 (operator decision, from ISSUE-258 finding F-258-I1).
- **Severity:** Medium.
- **Area:** legacy file intake / manual authority — `src/lib/ingest/datasets.ts`
  (`playerMatchStats.promoteRow`), `src/lib/acquisition/match-sheet-authority.ts`.
- **Decision outstanding:** refusal versus retirement (§8). **No approval has been given for either
  and none is implied by this document.**
- **Evidence basis:** code inspection only. **Not reproduced against a database**, on DEV, PROD or
  `afldb_test`. No submission has been checked for prior occurrence (§6).
- **Record:** the `issues.md` entry of the same ID stays authoritative; this runbook carries the
  detail for a later implementation session.

## 1. Summary

ISSUE-257 made every Match Sheet change durable `data_overrides` authority so that a settle, a fitzRoy
reload and a promotion do not revert it. The legacy CSV intake's `player_match_stats` promotion reads
none of that authority, so a file can:

1. overwrite a field an active `match_sheet` record protects, when the file supplies a value; and
2. re-insert a `(player, match)` row the Match Sheet removed, when the file names that player.

The submission's validation report says nothing about either, and promotion succeeds.

## 2. Evidence (code inspection; paths and lines as in the ISSUE-258 worktree)

- `src/lib/ingest/datasets.ts:833-882` — `playerMatchStats.promoteRow`. `INSERT … ON CONFLICT
  (player_id, match_id) DO UPDATE`. It reads no `data_overrides`. Line 856 sets
  `club_id = EXCLUDED.club_id` unconditionally; lines 857-880 are `COALESCE(EXCLUDED.x,
  player_match_stats.x)` (ISSUE-258), so a supplied value still wins.
- `src/lib/acquisition/match-sheet-authority.ts:35-37` — `PLAYER_MATCH_STATS_ENTITY =
  'player_match_stats'`, `MATCH_SHEET_FIELD_GROUP = 'match_sheet'`, `LINEUP_FIELD_GROUP = 'lineup'`.
  `:35-61` also defines the twelve protected fields and `COUPLED_DISPOSAL_FIELDS` (`:61`).
- `src/lib/acquisition/match-sheet-authority.ts:860-861` — a removal upserts a `lineup` record with
  payload `{ present: false }` and deactivates the `match_sheet` record. `:865` records
  `{ present: true }` for a (re)added player; `:873` records the `match_sheet` payload.
- `src/db/queries/match-sheet.ts:277-304` — the authority writes (upsert, or `is_active = false`), in
  the Match Sheet save's own transaction.
- `src/lib/ingest/datasets.ts:410-445` — `all_australian.promoteRow`, ISSUE-165 D-12: the closest
  existing pattern. It reads `data_overrides` for an active `lifecycle` or `correction` record and
  throws, refusing promotion. Its comment (`:421-427`) records why a refusal and not a replay.

Not in the evidence: any query result. No row, count or timing here comes from a database.

## 3. Execution path

legacy admin upload → dataset `player_match_stats` validation (`datasets.ts`, up to `:831`) →
approval → `promoteRow` (`:833`) → `player_match_stats`.

## 4. Expected invariant

A promotion of a legacy file never silently reverts a human decision recorded as durable authority.
ISSUE-165 D-12 states the same principle for `award_winners`; ISSUE-257 states it for
`player_match_stats`.

## 5. Actual behaviour

- A file that **supplies** a figure overwrites a field an active `match_sheet` record protects. This
  covers any of the twelve Match Sheet fields, and `club_id` too, because the upsert always sets
  `club_id = EXCLUDED.club_id`.
- A file naming a player whom the Match Sheet removed (active `lineup` record, `present: false`)
  re-inserts that `(player, match)` row.
- Neither case appears in the validation report. Promotion succeeds.

## 6. Not examined

- How the next settle or reload treats a protected field this intake has overwritten, or a
  re-inserted row whose `lineup` record says absent.
- Whether any submission has already done this on DEV or PROD. That is a read-only census and needs
  the operator's authorisation (§9, `CLAUDE.md` §9/§11).

## 7. Relationship to ISSUE-258

ISSUE-258 (uncommitted at the time of writing) stops a column the file is silent on — absent or blank —
from writing, via `COALESCE`. That **narrows** this defect to supplied figures and re-inserted rows.
It does **not** resolve it. ISSUE-258 §12 puts "manual authority or source ownership of rows a
promotion updates" out of its scope, and ISSUE-257 §12 put "the legacy CSV intake's writes to
`player_match_stats`" out of its scope and named ISSUE-258. Neither owns the defect; this issue does.
Ownership was confirmed by a narrow `issues.md` search that found only those two records.

## 8. Options (no decision recorded)

**Refusal versus retirement remains undecided.** Nothing below is approved.

- **Option A — refusal, modelled on `all_australian` D-12.** Refuse at validation and again at
  promotion a row whose `(match, player identity)` carries either an active `lineup` record with
  `present: false`, or an active `match_sheet` record protecting a field the row supplies with a
  different value. Operator resolves it in the Match Sheet before re-approving.
  - Rejected alternative: replaying authority inside the legacy writer. It would be a second,
    divergent implementation, as D-12 recorded.
  - Open question for the decision: whether "supplies a different value" or "supplies any value" for
    a protected field is the refusal test, and how identity is keyed (`<match_key>|<player
    identity>`) from a row that resolves by name.
- **Option B — retirement.** Retire the two legacy datasets under ISSUE-186 (pipeline deprecated;
  retirement Phases B and C deferred without an ID). That would also close this defect, and is a
  larger, separate decision.

## 9. Scope

- **In scope once decided:** `src/lib/ingest/datasets.ts` (`player_match_stats` validation and
  promotion) with focused tests, extending the closest existing suites rather than adding a file by
  default (`tests/ingest-datasets.test.ts`, `tests/integration/datasets.test.ts`).
- **Out of scope:** the ISSUE-258 implementation; `match_results` (no Match Sheet authority covers
  `matches`); any change to the ISSUE-257 authority model.
- Any census or reproduction against a database is user-executed and needs explicit authorisation.

## 10. Cross-references

- **AFLDB-ISSUE-257** — resolved; defines the authority model and put this writer out of scope.
- **AFLDB-ISSUE-258** — origin of F-258-I1 (runbook `issues/open/AFLDB-ISSUE-258.md` §17.7); narrows,
  does not close.
- **AFLDB-ISSUE-186** — legacy pipeline deprecation and deferred retirement; related, not an owner.
- **AFLDB-ISSUE-165 D-12** — the refusal pattern.

## 11. Next action

Operator decides refusal (Option A) versus retirement under ISSUE-186 (Option B). Implement only
after ISSUE-258 is committed, in its own session, against the decided option.
