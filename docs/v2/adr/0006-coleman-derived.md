# ADR 0006 — Coleman Medal is derived, never ingested

- Status: Accepted; implemented (Stage 4, pure derivation and comparison report)
- Plan decision: `docs/v2/plan.md` §3 D6

## Context

The owner's instruction says Coleman results must be derived from promoted player goal
statistics rather than ingested as a primary external dataset where they can be derived.

## Decision

`@afldb/derived` holds a pure derivation over promoted player goal facts: home-and-away
matches only, using the project's existing competition definition (ISSUE-111, as recorded in
`data/reference/coleman-derivation.json`, `tools/migration/award_definitions.py` and
`tools/migration/import_awards.py`; a different scope is not invented). It requires a complete
and settled season, supports tied leaders, preserves the leaderboard and its inputs, records a
derivation version, timestamp and input checksum, refuses to publish an incomplete season and
recomputes idempotently. Publication goes through an explicit audited operation.

## Implementation

Stage 4 delivers the PURE half only: no database writer exists yet. A later step builds the
transactional, audited publisher on top of the result type, which is plain JSON-serialisable.

- `packages/derived/src/coleman.ts`
  - `parseColemanContract(json)` validates the same required keys as the Python loader
    (`COLEMAN_REQUIRED_CONTRACT_KEYS`) and refuses drift; every value (first season, minimum
    goals, identity method and statuses, key separator, source key) is read from
    `data/reference/coleman-derivation.json`, nothing is hard-coded.
  - `deriveColeman(input)` returns `{ ok: false, refusal }` or `{ ok: true, result }`. The
    result carries the full home-and-away leaderboard (goals descending, then profile path),
    every winner (all players tied on the maximum, `minimum_goals` respected, no tiebreak), each
    winner's club per the club rule (single distinct club, else `null`), the durable key
    `coleman:<season>:<profile path>`, `methodVersion` (the contract's), `derivationVersion`
    (`COLEMAN_DERIVATION_VERSION`, distinct), the caller-supplied `derivedAt`, `inputChecksum`
    (sha256 over the canonical, row-order-independent `result.inputs`), `tie`, and the counts
    including finals rows excluded. A season whose maximum is below `minimum_goals` has no
    winner: reported, not an error.
  - Refusals are whole-season and never partial. In gate order: `invalid_input`,
    `season_before_contract`, `season_not_complete`, `season_not_settled`, `invalid_input` (rows),
    `incomplete_rounds`, `goals_not_recorded`, `identity_missing`, `identity_ambiguous`,
    `unsafe_key`.
  - Season state: complete means the season is sealed in `data/reference/seasons.json`
    (`sealedSeasonsFrom` / `isSealedSeason`); settled is an explicit caller attestation that every
    promotion and settle for the season has concluded and nothing is pending.
  - NULL goals are "not recorded": any NULL in a home-and-away row refuses the season; a recorded
    0 is a real zero. NULL in a finals row is out of scope and does not refuse.
- `packages/derived/src/coleman-comparison.ts`: `buildColemanComparisonReport` compares derivation
  outcomes with the STORED Coleman `award_winners` rows and emits the machine-readable
  `afldb.v2.coleman-comparison-report` (version 1). Per season exactly one of `agree`,
  `disagree` (`missing` / `extra` / `duplicates`) or `not_derivable` (with the refusal code).
  Only `active` stored rows are compared; rows with any other status (today `void`) are listed
  under `ignored`, never dropped and never judged. Matching is by durable key, then by player id.
  The report decides and writes nothing; `validateColemanComparisonReport` validates it.
- `tests/v2-coleman.test.ts`: contract parser, every refusal, winners and ties, finals exclusion,
  NULL versus 0, checksum, idempotence under shuffled input, corrected statistics, the comparison
  report and its validator.

## Divergences from the ISSUE-111 loader

The winner rules (home-and-away only, sum of goals per player, every player tied on the maximum
wins, `minimum_goals`, the single-distinct-club rule, the identity rule, the key format, the
separator refusal, the NULL-goals refusal) are the same. The differences are:

1. Eligibility. The loader treats any `seasons.status = 'complete'` as eligible. V2 requires the
   season to be sealed in `seasons.json` AND an explicit `settled` attestation
   (`season_not_settled`). The registry and the database status can disagree; V2 reads the
   registry.
2. Incomplete rounds. The loader has no such check. V2 refuses a season whose input has no
   home-and-away match, a match from another season, a fact for an unknown match, or a
   home-and-away match with no goal rows for a club (`incomplete_rounds`).
3. Scope of refusal. The loader derives every complete season in one pass and a single NULL goal
   anywhere (from `first_season` on) refuses the whole load. V2 derives ONE season per call and
   a NULL refuses only that season.
4. Input validation. V2 adds `invalid_input` (unknown `round_type`, duplicate matches or
   (match, player) rows, negative or fractional goals, a fact for a club that did not play,
   malformed header). The loader relies on database constraints.
5. Home-and-away test. The loader uses `NOT matches.is_final`; V2 uses `round_type =
   'home_and_away'`. They are identical by the migration 003 CHECK constraint; an unknown
   `round_type` is refused rather than assumed.
6. Key collision. V2 also refuses two winners sharing one profile path (`identity_ambiguous`);
   the database unique index makes that unreachable for the loader.
7. Contract strictness. V2 additionally requires `method_version` to be a positive integer,
   `minimum_goals` an integer of at least 1, and non-empty string `source_key`,
   `identity_match_method` and `key_separator`. The loader checks only `award_slug`,
   `first_season`, `completed_seasons_only` and `identity_statuses`.
8. No display name. The loader joins `players` for `display_name` (stored as `player_name_raw`).
   The pure derivation has no player table; the later publisher must supply names.
9. Additions with no loader counterpart: the full leaderboard (including players with no
   identity), `derivationVersion`, `derivedAt`, `inputChecksum` with the canonical `inputs`,
   string-normalised ids, and the comparison report.

Unchanged and untouched: the one-time legacy rekey (`--rekey-coleman`), `reload_keyed`
ownership, admin-override replay and every database write. The loader remains the writer until
the V2 publisher exists.

## Consequences

`@afldb/derived` now exports the Coleman derivation and comparison report. The derivation has
been exercised on SYNTHETIC inputs only: there is no committed per-match goal data in the
repository, so no real season has been derived or compared in V2 yet. Publication (the audited,
transactional write) is a later step and is not implemented here.
