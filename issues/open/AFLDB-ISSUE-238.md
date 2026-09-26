# AFLDB-ISSUE-238 — Correcting a consumed trusted `afl_api` player link with canonical reattribution

## 0. Status and fold-in decision

- **Triaged 2026-09-26 during the ISSUE-238–241 bulk pass. NOT folded in. No implementation.**
  ISSUE-239/240/241 were implemented on one shared identity contract (`AFLDB-ISSUE-241.md` §2).
  This issue is a different risk boundary (§3). It remains Open, Medium.
- **Operator decisions are required before implementation (§5).** They change data semantics: the
  merge policy against AFL Tables-owned rows, and how a human correction is recorded.

## 1. The question answered: the dependency closure of a consumed link

A consumed trusted link is one of two kinds:

- an importer `unique` row;
- an ISSUE-235 human `resolved` row, whose ledger is `afl_api_identity_adjudications`.

Either way, the provider `CD_I` resolved to player P, and the AFL API settles wrote facts
attributed to P. Correcting it to P′ touches the following. The classification comes from the
checked-in D10 manifest (`AFL_API_PLAYER_REFERENCE_MANIFEST`, `src/lib/acquisition/afl-api-adjudication.ts:369`,
which validates against the live catalogue) and its two ledger checks (`AFL_API_LEDGER_CHECKS`,
`:665`).

**A. Canonical/staging rows written THROUGH the link (LINK_DEPENDENT, bind by `player_id`):**

| Table | Key | Writer |
|---|---|---|
| `player_match_stats` | `UNIQUE (player_id, match_id)` (`004:59`); also carries `brownlow_votes` | match settle, `resolveAflApiPlayer()` (`afl-api-settle-plan.ts:417`) in the settle txn |
| `brownlow_round_votes` | `UNIQUE (season, player_id, round_number)` (`005:55`) | Brownlow settle (`afl-api-brownlow.ts:707`) |
| `staging.afl_api_player_match` | projection, resolved `player_id` | match settle upsert |
| `staging.afl_api_brownlow_vote` | projection, resolved `player_id` | Brownlow settle upsert |

**B. Append-only provenance ledgers that record the attribution (jsonb-keyed):**

| Table | Why it matters |
|---|---|
| `canonical_applications` (`083:76`) | `target_key` `{player_id, match_id}` / Brownlow match id. Append-only: the history cannot be rewritten, only superseded by correction entries. |
| `promotion_candidates` | `proposed_fields->>'player_id'` of pending or decided candidates |

**C. Derived tables recomputed from A (NOT_SOURCE_BEARING), with their targeted helpers in
`src/db/queries/player-derived.ts`:**

| Derived | Helper (called in-transaction by the settle, `settle-afl-api.ts:1768-1770`) |
|---|---|
| `player_match_stats.career_game_no` (per-player ordering) | `recomputePlayerDerivedStats(tx, ids, season)` |
| `player_season_stats`, `player_club_season_stats`, `player_career_stats` | `recomputePlayerDerivedStats`, `recomputeSeasonMetadata` |
| `player_clubs` | `recomputeClubSeasons` |
| Brownlow status, coverage and career totals | `recomputeSeasonBrownlowStatus`, `recomputeBrownlowCoverage`, `recomputeBrownlowCareerTotals` |
| Coleman `award_winners` (completed seasons only) | `import_awards.py --groups coleman` (the rebuild's `coleman` stage). It is not a targeted in-transaction helper. |

**D. Outside the database:** ISR-cached pages for both players, their seasons and the matches.
`/seasons/[year]` has a 1-hour ISR (see the operations notes). NL search and the Grid Solver read
live tables.

**E. The identity row itself:**

- An importer row: every writer of it (the loader) is append-only by contract, so correcting it
  needs a new audited writer.
- A human row: the ledger's `action` is `CHECK (linked|revoked)` (migration 104). D10 revoke refuses
  a used link by design, so a correction needs a new ledger action or a "consumed-correction"
  transition. D15 replay, the bijection, and the promotion G2/G3 gates must learn it.

## 2. Can the existing helpers do it in one transaction? Partly.

- **Yes:**
  - the targeted recompute helpers are transaction-scoped and already run inside the settle's
    single write transaction;
  - the D10 machinery can enumerate the closure (A + B) for a provider/player;
  - the lock discipline exists (`ACCESS EXCLUSIVE` on `external_identities` against in-flight
    settles; provider-then-player advisory locks, D7).
- **No, for three reasons, each a data-semantics decision rather than plumbing:**
  1. **Collision with the correct player's own rows.** P′ may already hold `player_match_stats` for
     the same match: AFL Tables-owned, or a second AFL API row. `UNIQUE (player_id, match_id)` makes
     a blind UPDATE fail, and a merge needs an ownership/precedence rule per field. The canonical
     ownership model (`canonical_applications`, settle owners) decides that for settles, not for a
     retroactive move.
  2. **Append-only history.** `canonical_applications` rows naming P cannot be rewritten. The
     correction must append superseding entries, and the settle's idempotency and self-heal must
     then treat P′ as the owner of those keys. That is new ledger semantics.
  3. **The human ledger has no correction action.** Adding one is a migration plus changes to the
     D15 replay, the bijection, the promotion gates and the admin UI. That is ISSUE-235's authority
     model, not a bulk-pass change.

**Idempotent and fail-closed: achievable,** once §5 is decided. A pure planner computes the closure
and STOPs on any collision the policy does not decide. One transaction then: identity change →
row moves/deletes → ledger corrections → targeted recomputes for {P, P′} × affected seasons →
invariant (the D13 combined invariant, plus "no LINK_DEPENDENT row of CD_I on P"). A rerun finds
nothing to move.

## 3. Why it is a separate risk boundary (the reason it was not folded in)

ISSUE-239/240/241 change **identity records and findings only**. They never move a canonical fact.
ISSUE-238 **moves canonical statistics and votes between players** and re-derives careers and awards.
Its blast radius is the public stats surface. It needs a merge policy and a new human-ledger
action, both operator decisions. Folding it into the identity contract would have made the bulk
pass depend on those decisions and widened it from identity bookkeeping to canonical mutation.

Nothing in 239–241 blocks it. It reuses their pieces:

- the reverse identity lookup, to prove P′;
- the ISSUE-240 finding key, to track a correction candidate;
- the ISSUE-239 audit pattern.

## 4. Implementation-ready next step

1. The operator decides §5.
2. Write a plan in this file with the D-numbered decisions and a reviewer pass. It needs a migration
   if §5-b chooses a new ledger action.
3. **A pure planner** (`afl-api-adjudication.ts`, beside the D10 manifest):
   - input: provider, P, P′, the closure rows (A + B) and P′'s colliding rows;
   - output: moves, deletes, ledger appends, the recompute set, STOPs.
4. **An adapter/CLI** `tools/migration/correct_afl_api_identity.ts`:
   - `--validate-only / --dry-run / --apply`;
   - the D10 lock, then the one transaction of §2, then the invariant;
   - an audit batch;
   - the targeted recomputes;
   - an ISR revalidation list reported for the operator.
5. **A `code_test_db` rehearsal:**
   - a synthetic provider settled for 2 matches and 1 Brownlow round;
   - corrected to P′, with and without a P′ collision;
   - a recompute parity check against `rebuild_derived.py`'s definitions.

## 5. Operator decisions required

- **(a) Collision policy.** When P′ already holds a row for the same match or round, choose one:
  1. refuse (the simplest; STOP and name the rows);
  2. keep P′'s row and delete the AFL API-owned P row;
  3. field-level precedence by canonical ownership.
- **(b) Human-link correction.** Choose one:
  1. a new ledger action `corrected` (migration 104 CHECK plus D15/bijection/gates);
  2. a revoke + relink pair allowed only through this tool, with a consumed-correction marker in
     evidence.
- **(c) Re-settle vs move.** Choose one:
  1. move rows in place;
  2. delete the AFL API-owned rows for the provider and re-run the settle for the affected matches
     under the corrected identity (the immutable snapshots re-derive them).

  Option 2 reuses the settle's own ownership rules and may make (a) moot for AFL API rows.
