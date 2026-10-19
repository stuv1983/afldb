# ADR 0006 — Coleman Medal is derived, never ingested

- Status: Accepted; implemented (Stage 4: pure derivation and comparison report, then the audited
  transactional publisher and migration 112)
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

Stage 4 delivers the pure derivation and comparison report, and then the audited, transactional
publisher on top of the plain JSON-serialisable result type (below, "The publisher").

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

### The publisher

- `packages/derived/src/coleman-publication.ts` (export anchor `// @v2-stage4:coleman-publication`).
  `publishColemanResult(executor, request)` takes the DERIVATION INPUT (never a ready-made result,
  so a caller cannot hand in a forged one), the audited correction, `publishedBy` and a capability
  viewer, and derives inside. It never reads a clock, the network or a file; `published_at` is the
  database default.
  - **Every publication is an audited operation through the season seal.** A derivable season is a
    complete season and a complete season is a sealed one, so the write always targets sealed
    history. The publisher calls `evaluateSeasonWrite` with the sealed range built from the SAME
    registry the derivation used: `correction: null` is refused (`season_sealed`), an invalid
    correction is refused (`correction_invalid`). One workflow id was added to
    `AUDITED_CORRECTION_WORKFLOWS`: `derived_award_publication`, with its own row in
    `docs/v2/historical-baseline.md` §2. The publisher accepts no other workflow. `open_season` cannot
    happen after a successful derivation and is refused defensively (`season_not_sealed`).
  - **Typed refusals, all before any SQL**: `capability_denied` (needs `data.awards.edit`, i.e. super
    admin; checked first so a forbidden viewer learns nothing), `invalid_actor` (`publishedBy` not a
    positive integer), `derivation_refused` (the derivation's own `ColemanRefusal` passed through:
    `season_not_complete`, `season_not_settled`, `incomplete_rounds`, `goals_not_recorded`, identity
    refusals ...), `correction_invalid`, `season_sealed`, `actor_mismatch` (`publishedBy` must equal
    the correction's `actorUserId`: one accountable user) and `season_not_sealed`. An incomplete or
    unsettled season can never be published.
  - **One transaction** (`executor.transaction`): lock the (award, season) with
    `pg_advisory_xact_lock(hashtext('derived_award_results:coleman'), season)` (the import role has no
    UPDATE privilege, so `SELECT ... FOR UPDATE` is unavailable by design), read the CURRENT row (the
    one no other row supersedes), then `planColemanPublication`: no row -> `published`; same input
    checksum AND derivation version AND winners -> `unchanged` (an idempotent recompute writes
    nothing and returns the existing id); anything else -> `superseded`, inserting a NEW row whose
    `supersedes_id` names the current one (a recompute after an authorised correction to the goal
    facts; the correction record says why). Any SQL error rolls back everything.
  - **It does not write `award_winners`.** The Coleman `award_winners` rows remain owned by the
    offline `tools/migration/import_awards.py` coleman group. A future projection of a published
    result into `award_winners` must call `assertSeasonWritable` with a correction and supply
    `player_name_raw` (divergence 8). It is not built here.
- Migration `src/db/migrations/112_derived_award_results.sql`: the append-only ledger
  `derived_award_results` (award slug, season, method version, derivation version, input checksum,
  the full `serialiseColemanDerivation` result, winners, `derived_at`, `published_at`,
  `published_by`, `basis` = `audited_correction`, the seal's `correction` record,
  `supersedes_id`). No role gets UPDATE, DELETE or TRUNCATE, so "current" is derived rather than
  flagged: a partial unique index allows one first publication per (award, season), a second unique
  index allows each row at most one successor, a composite foreign key keeps a successor in the same
  (award, season), and `supersedes_id < id` forbids a cycle; the current row is the one nothing
  supersedes. CHECKs tie the scalar columns and `winners` to the stored result, and the audit record
  to this workflow, season and actor. No foreign key into players, clubs, matches, awards or
  `award_winners` (a rebuild `TRUNCATE ... CASCADE` must not empty the ledger): only `auth_users` and
  itself. `result.inputs` and the leaderboard embed database ids a rebuild renumbers; the durable
  winner identity is the profile path in `winners[].key`. Grants: `afldb_import` SELECT, INSERT and
  the sequence; `afldb_auth` SELECT; nothing for `afldb_app`; not registered with `grant_app_read` or
  `grant_import_write`. Mirrored in `tools/maintenance/privileges.sql`; classified `reinstate`
  (production-only) in `tools/db/promotion-inventory.ts`.
- `tests/v2-coleman-publication.test.ts` (refusals, the pure plan, the exact statements against a
  fake executor, static no-I/O / no-`award_winners` proofs) and
  `tests/v2-coleman-publication-pglite.test.ts` (migration 112 verbatim and the real publisher SQL on
  in-memory PGlite). Fixtures are SYNTHETIC (`tests/v2-coleman-publication-fixtures.ts`).

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
ownership, admin-override replay and every write to `award_winners`. The loader remains the only
writer of the Coleman `award_winners` rows; the V2 publisher writes only `derived_award_results`.

## Consequences

`@afldb/derived` exports the Coleman derivation, the comparison report and the audited publisher.
The derivation and the publisher have been exercised on SYNTHETIC inputs only: there is no
committed per-match goal data in the repository, so no real season has been derived, compared or
published in V2.

Migration 112, its grants and the publisher's SQL were EXECUTED ONLY ON IN-MEMORY PGLITE over
labelled stub prerequisites (`auth_users`, `players`, `award_winners`, three stub roles); they are
UNEXECUTED ON POSTGRESQL (no database is reachable from the V2 workstation). The real roles,
`afldb_meta`, `npm run db:privileges` and the promotion inventory have not seen migration 112; the
new case in `tests/integration/privileges.test.ts` is unexecuted (it needs a database migrated
through 112). Deploy order, when the owner takes this to a database: apply 112, then
`npm run db:privileges`, then deploy code.

No admin route, server action or package script calls the publisher: a server-only production
wiring (a postgres.js executor from `postgresExecutor`) and the admin surface are Stage 5. Until
then nothing publishes.
