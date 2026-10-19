# ADR 0007 — Brownlow: AFL API authoritative, V2 adds pure reconciliation

- Status: Accepted; implemented (Stage 4, pure reconciliation and report)
- Plan decision: `docs/v2/plan.md` §3 D7

## Context

AFL API Brownlow acquisition, snapshot, staging and settle exist (`src/lib/acquisition/afl-api-brownlow.ts`,
`tools/current-season/{acquire,settle}-afl-api-brownlow.ts`, `deploy/afldb-settle-afl-api-brownlow.*`),
with timer and settlement conditions strengthened under AFLDB-ISSUE-232 and ISSUE-316.

## Decision

The AFL API stays the authoritative source. V2 adds a pure reconciliation module over the
existing snapshot/staging shapes: duplicate votes, per-player totals against the leaderboard,
round/match/club consistency, unresolved players, incomplete seasons, and ties reported without
inventing a winner rule. The strengthened timer and settlement conditions are preserved
byte-for-byte unless a test proves a change is required.

## Consequences

No Brownlow runtime behaviour changes in Stages 0-2 or in Stage 4: the reconciliation is pure
evidence. Nothing writes to the database, and `src/lib/acquisition/afl-api-brownlow.ts`, the
settle and acquire CLIs, `deploy/**` and `src/lib/brownlow/**` are unchanged.

## Implementation (Stage 4)

Files (all in `@afldb/derived`, no imports at all beyond each other, so the boundary rules hold
trivially; exported from `packages/derived/src/index.ts` below `// @v2-stage4:brownlow-reconciliation`):

- `packages/derived/src/brownlow-reconciliation.ts` — `reconcileBrownlowSeason(input)` returns the
  report; `validateBrownlowReconciliationInput(input)` returns the input's schema problems.
- `packages/derived/src/brownlow-reconciliation-report.ts` — the report type, finding-code table,
  `serialiseBrownlowReconciliationReport` (sorted keys, one trailing newline),
  `validateBrownlowReconciliationReport` (field types plus internal consistency: outcome versus
  finding severities, leaders versus award status, sort order, count totals) and the JSON Schema
  `BROWNLOW_RECONCILIATION_REPORT_JSON_SCHEMA`.
- `tests/v2-brownlow-reconciliation.test.ts`.

The report is a SIBLING of the Stage 3 settle-run report, not a reuse of it: format
`afldb.v2.brownlow-reconciliation-report`, version 1, caller-supplied `generatedAt`, no clock, no IO.
The Stage 3 report describes one settle RUN (counters, batches, refusal evidence); this one describes
one SEASON's vote evidence, so its shape does not fit.

Input (declared in the module; it mirrors the settle's own planned unit and the bundle's leaderboard
record without importing the writer side): the AFL API round votes per match with each vote's
RESOLVED stable `playerId` (null = unresolved) and provider ids; the AFL API leaderboard when
present; the stored authoritative season totals (`brownlow_season_votes` shape) when present; the
match/round/club context; the season state (`complete` | `in_progress`); `generatedAt`; and an
optional `eligibilityRule`. Player identity is by stable id, never by name; no name is an input.

Outcome (evidence only): `refused` when any finding has severity `refusal`; otherwise
`discrepancies` when any finding has severity `discrepancy`; otherwise `reconciled`. The award
determination can be refused WITHOUT making the outcome `refused` (see below).

Finding codes, by severity:

- `refusal` (whole-set; nothing is totalled, compared or determined): `input_schema_invalid`,
  `unresolved_player_identity` (round votes or leaderboard), `unresolved_match_identity`. Vote-set
  structure findings, which need no identity, are still reported beside a refusal.
- `discrepancy`: `duplicate_match_vote_record`, `invalid_vote_value` (not 3/2/1),
  `duplicate_player_in_match` (provider id, or two provider ids resolving to one player),
  `duplicate_vote_value_in_match`, `too_many_vote_getters_in_match`, `too_few_vote_getters_in_match`,
  `match_not_in_context`, `match_wrong_season`, `match_is_final`, `round_mismatch`,
  `vote_club_not_in_match` (by resolved club id, else by provider team id),
  `match_without_votes` (complete seasons only), `eligibility_flag_inconsistent`,
  `duplicate_leaderboard_entry`, `leaderboard_total_mismatch` (carries `leaderboardConcluded`, the
  settle's advisory-versus-blocking distinction), `leaderboard_only_player`, `round_votes_only_player`,
  `stored_total_mismatch`, `api_only_player`, `stored_only_player` (a total absent on one side is
  never read as 0), `stored_rank_inconsistent`, `stored_winner_flag_inconsistent`.
- `info`: `club_unverifiable` (no usable club identity on either side).
- `determination_refusal`: `eligibility_rule_unrecorded`.

API-versus-stored comparison runs only for a complete season that has API round votes; an
in-progress season reports `skipped_season_incomplete`. The stored table is also checked against
itself (competition ranks, eligible ranks, winner flags) whenever it is supplied.

Raw votes and the award-result presentation are separate sections (`rawVotes`,
`awardResultPresentation`). `rawVotes` carries the matches as supplied, per-player totals on the
chosen basis (`api_round_votes`, else `api_leaderboard`, else `stored_totals`), the highest raw
totals over ALL vote-getters with their eligibility flag, and each comparison's state.
`awardResultPresentation` carries a status, an optional refusal code, joint `leaders` (never a
`winner` field), a `tie` flag, and `providerClaims` (what the leaderboard and stored table CLAIM,
reported and never used to choose). Statuses, in priority order: `refused_whole_set`,
`season_incomplete` (no winner or leader of record is stated), `no_vote_evidence`,
`refused_eligibility_rule_unrecorded`, `refused_unreconciled_evidence`, `determined`. Ties are
joint leaders; no tie-break exists.

### Recorded rules about ineligible and retrospective winners — finding

Searched (docs, src, tools, tests, data/brownlow, packages) for `retrospective`, `vacat`, `ineligible`
and `is_winner`.

- No rule is recorded for retrospective or vacated awards: no match for `retrospective` or `vacat`
  in any Brownlow, winner, ineligible or medal context.
- No rule is recorded for how eligibility affects an API-sourced, current-season result:
  `src/db/migrations/005_brownlow_awards.sql:20-21` declares `is_ineligible` and `is_winner` with no
  semantics, and `docs/data-dictionary.md:181` only names the columns and counts 112 winners.
- ONE convention is recorded for the STORED table: `src/lib/brownlow/entry.ts:664-679` (measured on
  all 16,120 rows and 98 seasons: "`isWinner` means exactly `eligibleRank = 1` ... so tied eligible
  leaders are all winners"), implemented at `src/lib/brownlow/entry.ts:796`
  (`isWinner: !isIneligible && eligibleRank === 1`) with the tie comment at `:794`. The committed
  artefact `data/brownlow/season-votes.csv` shows it: its three ineligible rows (1996 player 775,
  21 votes; 1997 player 422, 27 votes; 2012 player 1461, 30 votes) each rank 1 on votes yet are not
  winners.

Decision: the module does NOT assume that convention. `eligibilityRule` defaults to `unrecorded`:
any ineligible vote-getter (in the round votes, the leaderboard or the stored table) refuses the
leader determination with `eligibility_rule_unrecorded` and status
`refused_eligibility_rule_unrecorded`, while the raw votes are still reported. A caller may select
`stored_eligible_rank_one` explicitly (the entry.ts convention: ineligible players excluded, tied
eligible leaders joint); the report records the rule used. Whether that convention governs current
or retrospective API seasons is a product decision this ADR does not make; it is raised with the
owner as an open decision.

### Eligibility-aware medal determination (Launch F) — see ADR 0014

The "unrecorded" default above is unchanged for reporting evidence, but it is no longer the end of the
road for naming a winner: [ADR 0014](0014-brownlow-eligibility.md) implements the owner's
eligibility-aware model on top of this reconciliation. It keeps the raw leaderboard for every player,
excludes a player only on authoritative stored eligibility evidence, reports `requires_review` instead of
inventing a winner when a leader's eligibility is missing or ambiguous, and lets a Super Admin resolve it
through an audited, append-only decision (`brownlow_eligibility_decisions`, migration 113). It writes no
raw vote. V2-GAP-016 is narrowed accordingly.

### Executed evidence

- On COMMITTED real data: `data/brownlow/season-votes.csv` (98 seasons, 1924-2025, 16,120 rows) is
  run through the reconciliation as stored-only evidence: every season is internally consistent
  (ranks and winner flags), the convention selected explicitly reproduces all 112 stored winners, and
  with no rule selected exactly 1996, 1997 and 2012 refuse the determination. The committed API
  fixtures (`tests/fixtures/afl_api/brownlow/01-brownlow-season-round.json`,
  `02-brownlow-leaderboard-sample.json`) are parsed by the production emitters and reconciled; their
  canonical player, club and match ids are synthetic test ids.
- On SYNTHETIC inputs only (season 2090): every multi-match API season, and therefore every
  API-versus-stored and API-versus-leaderboard comparison. No real player's votes are invented.
- NOT executed: an API season compared with the stored totals of the same real season. The committed
  API fixtures are season 2026 and the stored totals end at 2025; the 2012-2025 API snapshots are not
  committed (V2-GAP-010).
