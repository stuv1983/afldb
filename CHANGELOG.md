# Changelog

All notable changes to AFLDB.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
project is pre-1.0 and has not cut a numbered release, so entries are grouped by
date. Versioned releases begin at the public launch of `afldb.com`.

Git history starts on 15 August 2026, part-way through the build. Entries dated
earlier than that are reconstructed from the development record and are marked
accordingly — they describe work that is in the tree but predates its first
commit.

---

## [Unreleased]

### AFLDB-ISSUE-101 — End-of-season promotion / baseline rollover - 29 August 2026

- **AFLDB can now move the completed-history boundary as one reviewed operation.** The
  boundary between completed history and the in-progress season is declared across four
  tracked JSON artefacts plus one TypeScript constant, and existing machinery cross-checks
  them against each other — so moving one and forgetting another failed the rebuild only
  after several files had been hand-edited. A new planner (`src/lib/rollover/
  season-rollover.ts`) computes the entire successor state and proves it coherent under the
  same rules the current state must satisfy, and a new CLI (`tools/db/rollover-season.ts`)
  applies it. The planner is pure — it imports only `node:crypto`, with no filesystem, clock,
  network or database — and the CLI owns all I/O.
- **Dry run is the default, and applying is an explicit acknowledgement.** With no `--apply`
  nothing reaches the filesystem; `--apply` additionally requires
  `--acknowledge-season-complete`. **There is no automatic or date-based completion
  detector**: the tool reads no clock and no calendar, `--rollover-date` is a required
  explicit input for every stamped date, and completion is established by an acknowledged
  operator decision backed by a validated full-history candidate.
- **The successor state is validated before any tracked file is written.** The computed
  successor contract and acceptance register are materialised in an OS temporary directory —
  never inside the repository — and the repository's own validators are executed against
  them. Each captured run is bound by the bytes read back from those files, so a gate that
  adjudicated some other state is refused rather than read. Any failure means zero tracked
  writes, and a dry run runs every gate and still writes nothing.
- **Three executed pre-apply authorities**, identical in dry run and apply:
  `import_fitzroy_core.py --validate-only --require-full-history` (re-hashes every artefact,
  checks every CSV shape, resolves club and player identity, measures identity coverage);
  the same importer with `--require-accepted-baseline` against the successor register (the
  acceptance binding and fingerprint-drift gate); and
  `validate_ladder_witness.py` offline (manifest binding, per-file hashes, per-season
  structure, identity resolution). The two importer runs must also agree with each other.
- **`measured` and `identity_scan` are derived from validator execution, never from an
  operator.** Both are read out of the executed full-history gate's own stdout. There is no
  flag that supplies a transcript, skips a run or asserts a verdict —
  `--skip-validation`, `--no-validate`, `--force`, `--core-validator-output`,
  `--assume-validated` and `--identity-scan` are all refused by name.
- **New backward-compatible, offline-only validator path overrides** make that possible:
  `--contract` and `--stat-availability` on `import_fitzroy_core.py` (both require
  `--validate-only`, so no run that can reach PostgreSQL is redirectable), and `--contract`
  and `--manifest-dir` on `validate_ladder_witness.py` (both refused with `--compare`).
  **Every default is unchanged**, so the rebuild orchestrator, the Python contract scripts
  and the in-season settle path behave exactly as before.
- **Retired-baseline lifecycle is declared, not invented.** `retired` is the status a
  previously accepted baseline takes, declared in the acceptance register as
  `selection_policy.retired_statuses`. `accepted` may never appear in that list, `candidate`
  is deliberately not valid for a baseline that *was* accepted, and a register declaring no
  vocabulary refuses with the remedy named.
- **`accepted_corrections` are reviewed per acquisition and never inherited.** Correction
  decisions record what a specific acquisition's bytes were examined for, so carrying the
  outgoing baseline's list forward would claim a review that never happened. The outgoing
  record supplies category names only; "no corrections" is stated explicitly as the same
  categories with empty arrays.
- **Stat availability is reviewed, never fabricated.** `stat-availability.json` describes real
  data availability, so a range mechanically dragged into a season nobody has played is
  refused, as is any loss of recorded coverage for a completed season. The reviewed bytes are
  written through verbatim, so the landed file is byte-identical to the file that was
  reviewed.
- **`CLUB_SEASONS_EXPECTED.rows` stays explicit reviewed evidence.** The operator states it
  and the planner refuses unless it equals the ladder witness manifest's own row total, so a
  rollover that advances the witness and forgets stage 9 fails loudly instead of agreeing
  with itself. The stage-9 accepted-season boundary itself is untouched: it already derives
  from `accepted.measured.seasons_last` and re-points itself.
- **No canonical database write and no migration.** The CLI opens no database connection and
  issues no SQL; completed-history supersession remains the existing clean rebuild from the
  newly accepted baseline. All rollover state is tracked JSON plus one TypeScript constant.
- **Only `validate_ladder_witness.py --compare` remains post-rebuild**, because it is the
  bidirectional set equality against a rebuilt `club_seasons` and genuinely requires the
  database. It was neither moved nor weakened.
- **No season has been rolled.** The 2026 season is still in progress and the tracked boundary
  is unchanged (accepted through 2025; `seasons.json` `last_season 2026`,
  `in_progress_seasons [2026]`). This entry describes a reusable mechanism; executing a real
  rollover is a future operator action once a season is formally complete and its
  full-history candidate and ladder witness have genuinely been acquired.

### AFLDB-ISSUE-100 — Staging-only AFL API lineup / team-announcement domain - 29 August 2026

- **AFLDB can now record announced teams before a match is played.** A new bounded acquisition
  path takes one explicit season and round from the AFL.com.au API via fitzRoy
  (`tools/rebuild/afl_api/acquire_lineups.R`), writes a SHA-256-bound raw JSON artefact and
  manifest, and emits a deterministic observation bundle
  (`src/lib/acquisition/lineup-bundle.ts`). There is no implicit current season and no implicit
  latest round: the adapter refuses rather than guessing a scope, because the scope is the
  absence boundary. The artefact is JSON rather than CSV so NULL, `false`, `0` and `""` remain
  four distinct values.
- **Lineups are STAGING-ONLY and never become canonical participation.** Announced or selected
  does not mean played; canonical participation remains the played match sheet
  (`player_match_stats`), which this path neither reads nor writes.
  `afl_api.lineup` carries `promotion_policy: never`, no promotion candidate is ever created,
  and no public surface was added.
- **New migration 077** registers the `afl_api` source **fail-closed** — idempotent on a
  semantically identical row, and refusing rather than silently rewriting the provenance of a
  conflicting pre-existing one — and creates `staging.afl_api_lineup`. Provider identity
  (`provider_match_id`, `provider_team_id`, `provider_player_id`) owns the row;
  `match_id`, `club_id` and `player_id` are nullable enrichment that participate in no key.
  `match_id` is nullable by necessity: `matches` requires NOT NULL scores/result/margin, so an
  unplayed fixture cannot exist there and a team announcement precedes it.
- **Persistence reuses the existing observation spine rather than duplicating it**
  (`src/lib/acquisition/lineup-store.ts`): every record goes through migration 074's
  version history via the shared `persistSourceObservation()`, and the typed projection is
  linked to the exact `version_seq` read back from PostgreSQL, all in one transaction. The
  projection is maintained by keyed upsert; the path issues no DELETE or TRUNCATE, which is a
  property of the code rather than of the grant, since `privileges.sql` gives `afldb_import`
  both across the whole staging schema.
- **Absence sweeping is disabled for this family, by decision.** Fixture-to-lineup match-set
  completeness is proven, but row-grain completeness is not, so every enumeration is
  `complete: false`, a missing player row is never read as a withdrawal, and `absent_since` is
  never written.
- **Validated against the real 2026 source.** Round 20 (468 rows × 20 columns, `lateChanges`
  present) and round 25 (104 rows × 19 columns, `lateChanges` absent) were acquired, emitted,
  and persisted under the restricted `afldb_import` role: 468 and 104 versions and projections
  inserted, 0 absent, 0 canonical writes. **Identical replay produced no semantic revision** —
  0 versions inserted, heads refreshed and projections updated in place, with version counts
  unchanged at min = max = 1. Every `match_id`, `club_id` and `player_id` is NULL, which is the
  expected staging state: no approved provider-ID mapping to a canonical match, club or player
  exists, and enrichment is deferred rather than guessed. `player.captain` (`false` on every
  observed row) and `lateChanges` (verbatim, never parsed or name-matched) are preserved as raw
  observation evidence with no typed projection.

### AFLDB-ISSUE-103 — Grid Solver finals-win predicates stay within the database timeout - 29 August 2026

- Re-shaped `won_a_final` and `never_won_a_final` around a distinct winning-player scalar-array InitPlan, preserving the exact winning-side participation semantics and complement while eliminating the timeout-producing nested-loop semi/anti joins over a materialized relation. The normal five-second statement timeout remains in force; no index, schema, or data change was required.
- Added an independent base-table SQL oracle for the exact three failing cells. The complete Grid Solver integration file now passes 131 / 131 under `AFLDB_STATEMENT_TIMEOUT_MS=5000`; post-fix analyzed execution times were 35.386 ms, 501.698 ms and 103.791 ms, and the resolved ISSUE-076 regression remained green.

### AFLDB-ISSUE-099 — In-season AFL Tables acquisition, observation bundle and settle projections - 29 August 2026

- **`acquire_core.R` gained an opt-in `--in-season` mode**, a third acquisition kind
  (`in_season_partial`) alongside `core_snapshot` and `validation_witness`. It acquires exactly
  one season, that season must be declared in-progress by `data/reference/seasons.json`, and it
  is measured against its own `in_season` contract block rather than the 1897–2025 full-history
  range. The full-history and validation-witness paths are unchanged.
- **`import_fitzroy_core.py` gained `enforce_in_season()` and `--require-in-season`**, the
  in-season adjudicator. It re-derives every gate from the contract, the season register and the
  raw artefacts, exactly as the full-history gate does. The two gate families now **refuse each
  other explicitly**: `--require-full-history` and `--require-accepted-baseline` reject an
  `in_season_partial` snapshot for what it is rather than incidentally for its range, and
  `--require-in-season` rejects anything that is not one. An in-season snapshot can therefore
  never enter the historical fail-closed contract or the accepted-baseline register.
  `--require-in-season` is also **offline-only**: it refuses before any database work, because
  the canonical writers in that tool upsert with no ownership predicate and delete by match and
  season.
- **New `--emit-observations` writes a deterministic, versioned observation bundle** — the one
  boundary between Python's AFL Tables interpretation and TypeScript's persistence. Presence is
  enumerated **independently of projection**, so a row that was observed and then rejected is
  still recorded as present and can never be mistaken for one the source withdrew; a row whose
  identity cannot be established at all is recorded separately and marks its scope incomplete,
  which disables absence sweeping there rather than guessing. New `--on-record-error` defaults
  to `abort`, keeping the historical rebuild path unchanged, with `reject` opt-in and in-season
  only.
- **Player identity keys on the AFL Tables profile URL.** The fitzRoy numeric `ID` is enrichment
  and is never required — 82 in-season rows carry none — and a name is never an identity key at
  any grain. NULL stays distinct from zero throughout: an absent statistic, an unpublished
  attendance and an NA Brownlow vote all remain NULL, and none can become a `0` or a fabricated
  row.
- **`data/reference/source-families.json` declares the two AFL Tables families** —
  `afltables.match` (new) and `afltables.player_match_stats` (upgraded from identity-only) — with
  proven column contracts and reviewed promotion. Their declared columns are pinned against the
  emitter's own constants, so the registry and the emitter cannot drift apart.
- **Migration 076** adds two typed staging projections, `staging.afltables_match` and
  `staging.afltables_player_match`, plus `data_issues.issue_key` and a partial unique index so a
  recurring disagreement refreshes one open row instead of stacking duplicates. Existing
  `data_issues` writers are unaffected: rows without an `issue_key` are outside the index
  entirely. Real foreign keys make resolved identity a database-enforced fact, and CHECK
  constraints hold the score, period and attendance invariants at the store.
- **The observation persistence layer was extracted, behaviour-preserving**, from the
  current-season importer into `src/lib/acquisition/observation-store.ts`. The SQL, the row lock,
  the decision call, the write order and the absence predicate are unchanged; only that one
  importer's row shape became parameters, so a second family importer reaches the migration-074
  spine through one contract instead of reimplementing it. Absence remains state, never a
  deletion.
- **New `src/lib/acquisition/settle-afltables.ts` and `tools/current-season/settle-afltables.ts`**
  consume the observation bundle. The bundle is validated fail-closed and its manifest re-hashed
  from disk **before any database connection is opened**, so an unverified snapshot cannot reach
  PostgreSQL. The settle pass then runs in **one transaction**: every keyed record reaches the
  observation spine whether or not it projects, a typed projection row is written only where
  identity fully resolved, both canonical targets of each family are reconciled, and the result
  is a `promotion_candidate` for a human. Absence is asserted only inside a scope the snapshot
  proved complete. Review-first is the default — `--dry-run` needs no flag, `--apply` must be
  explicit, and the dry run executes the identical write path against real constraints and
  privileges before deliberately rolling back.
- **No canonical data is written.** Migration 076 contains no DML, no trigger and no rule, and
  modifies exactly one existing table (`data_issues`, additively). The settle pass writes
  observations, typed staging projections, promotion candidates and import rejections, and
  **nothing in this issue writes** `matches`, `match_period_scores`, `player_match_stats`,
  `brownlow_round_votes` or any identity table — no player, club, venue or venue alias is ever
  created. That is now proved at runtime rather than asserted: an integration suite brackets
  every settle run with canonical fact-table row counts and then scans each of those tables for
  any surviving row written by one of the settle transactions, identified by the transaction id
  of the `import_batches` row it inserted. Both staging projections are maintained by upsert
  alone — no statement the settle path sends deletes or truncates either one.
- **A `data_issues` disagreement lifecycle, driven by evidence in both directions.** When AFL
  Tables and an independent current-season provider disagree on a comparable field, the settle
  pass opens one durable finding per record and target, keyed so a recurrence refreshes that same
  row and preserves when it was first detected rather than stacking duplicates. It closes a
  finding only on **positive current-run evidence** — the record present, its scope proven
  complete, corroboration re-evaluated this run, at least one comparable provider agreeing and
  none disagreeing. A disagreement that merely stops reappearing is never treated as resolved,
  silence is never agreement, and a finding another writer owns is never touched. Findings are
  resolved in place, never deleted.
- **`--report` shows the review queue read-only** — pending promotion candidates by target, and
  the open disagreements behind the ones that are blocked. It offers no path to accept, resolve
  or retire anything: every mutation happens inside the settle transaction, on evidence.
- **Validated end-to-end against the real 2026 season.** One bounded in-season acquisition (207
  matches, rounds 1–25, 9,522 player-match rows, **no row missing its profile URL**), then a
  first apply and an identical rerun on a test database under the restricted importer role. The
  rerun created no second version, no second candidate and no second finding, and **both runs
  wrote zero canonical rows**. Two defects were found by that run and fixed: an already-absolute
  manifest path was being joined onto the project root a second time, which made the operator
  path fail on Windows and would have resolved to the wrong file on Linux; and a target the
  source had never published was being proposed whenever identity failed to resolve, which
  raised 803 Brownlow candidates from a season whose Brownlow votes are entirely unpublished.
  **An unpublished vote now means no `brownlow_round_votes` target at all** — no candidate, no
  rejection, no projection and no invented value — while a published `0` remains a real vote.
  Whether a target exists is decided from what the source published, before identity is
  consulted, because it cannot depend on whether this database happens to know the player.
- **Nothing is scheduled.** No cron entry and no timer is added by this work; running the settle
  pass on a schedule is a separate decision.

### AFLDB-ISSUE-076 — Grid Solver winning-final venue queries stay within the database timeout - 28 August 2026

- Re-shaped `won_final_at_venue` membership so PostgreSQL computes the distinct winner-player IDs once as a scalar-array InitPlan instead of allowing an underestimated qualifying set to produce a repeatedly scanned materialised join shape. Venue, final and player-club winner semantics are unchanged; the normal five-second statement timeout remains intact, and no index or schema change was needed.
- Added the exact historical concurrent 3x3 Grid Solver workload as a performance regression plus a structurally independent base-table oracle for all three implicated MCG cells. The final focused `afldb_test` run completed in 380 ms, while the captured representative production query completed in 172.621 ms under `EXPLAIN (ANALYZE, BUFFERS)` with a one-loop InitPlan and no historical materialised join-filter pathology.

### AFLDB-ISSUE-097 — Current-season corroboration now counts independent evidence groups - 28 August 2026

- Reworked current-season disagreement/corroboration planning to consume ISSUE-096's tracked
  `(source_key, family) → independence.group` registry. Squiggle plus Kali's verbatim `/fixture`
  proxy is one fixture witness, while Squiggle plus authenticated Kali `/matches` remains two
  match witnesses; duplicate observations inside one group cannot manufacture agreement or
  outvote another group. Concrete observations are now collapsed to one coherent value per group
  before groups are compared; a group with internal proxy drift is reported and blocked but cannot
  fabricate an independent disagreement against a group matching one of its concrete rows.
- Dry-run and apply mode now share the same group-aware comparison for resolved updates and
  missing-match inserts. `--source all` retains concrete per-source/provenance counts, adds
  independence-group observation counts, reports proxy drift separately from genuine independent
  disagreement, and preserves single-source behaviour. Deterministic current-season coverage is
  green at 116/116, with the focused source-registry contract green at 1/1.

### AFLDB-ISSUE-098 — Current-season observations retain evidence and cannot create partial canonical matches - 28 August 2026

- Current-season venue absence now remains `null`; the importer no longer fabricates `venue_raw = 'Unknown'`. The unsafe missing-match INSERT has been removed because Squiggle/Kali do not own the complete canonical match family, so missing completed matches stay unresolved and requested promotion is rejected without absorbing attendance, period-score, lineup or player-stat acquisition.
- Applied source records now enter the existing migration-074 observation spine before the legacy current-state projection is refreshed. Corrections append immutable ordered versions, the newest version remains identifiable, later source omission sets `absent_since` without deleting history or canonical data, and reappearance clears the absence state. No migration or privilege change was required.
- Import results, CLI/admin output and batch validation now separate observations fetched/staged and observation versions from unique canonical matches resolved, canonical rows inserted/updated, unresolved observations, incomplete source records and rejected/conflicted work. Canonical counters no longer decrement, and ISSUE-097 independence-group disagreements still block unsafe missing-match work.
- Added deterministic venue, correction-wiring, absence, canonical-boundary and counter regressions;
  after layering the fix over ISSUE-097, the complete current-season importer suite passes 123/123,
  the focused ISSUE-098 slice passes 13/13 and the focused ISSUE-097 corroboration slice passes 9/9.

### AFLDB-ISSUE-095 — The season ladder is derived from canonical matches, not acquired from a legacy database - 28 August 2026

- `club_seasons` had no legacy-free acquisition path: `rebuild_derived.py` built it solely from `staging.team_seasons`, whose only writer was `import_legacy_afl.py` under `AFLDB_LEGACY_SQLITE`. A canonical rebuild therefore produced **zero ladder rows**, leaving ladders, premiership and wooden-spoon flags, finals counts and club-season natural-language answers unavailable — and `recomputeClubSeasons` failing closed on every match create, delete and score edit.
- The candidate external source was investigated rather than assumed. `fetch_ladder_afltables` was probed across every completed season (129/129, zero errors, 1,622 club-seasons) and the pinned fitzRoy 1.8.0 implementation was read: it does **not** scrape a published ladder. It calls `fetch_results_afltables`, keeps `Round.Type == "Regular"`, scores win=1/draw=0.5/loss=0, sets points = win*4, and sorts by points then percentage. Measured corroboration over its own output: percentage equals score_for/score_against exactly in all 129 seasons, and every season's points total is divisible by 4 with no bye, forfeit or deduction exception in 128 years. Importing those columns would have laundered a local recomputation into external-source provenance.
- **AFLDB now derives the whole ladder from its own canonical match set** (home-and-away only; `NOT is_final` is CHECK-equivalent to the source's "Regular" filter). `premiership_points` uses an explicitly declared 4/2/0 rule; `percentage` is stored x100; `ladder_rank` ranks on premiership points then the exact points-for/against ratio. The wooden-spoon completion gate, the drawn-Grand-Final exclusion and finals counting are preserved verbatim. Provenance moved from the retired `sports_data_lab` registry key to `afltables`.
- **Ties fail closed.** Two clubs exactly level on both points and ratio receive `ladder_rank = NULL` and no wooden spoon — never an order taken from club id, alphabet, insertion order or source row order. Audited by exact rational comparison across all 1,622 accepted club-seasons: **zero exact ties exist in 1897-2025**, so the branch is defence against a future score correction, and a Stage-9 gate turns any future tie into a loud rebuild failure.
- **`recomputeClubSeasons` is in lockstep**, with its fail-closed guard re-pointed from "no staging ladder rows" to "no canonical home-and-away matches". Match create/delete/score-edit no longer throw on a canonically rebuilt database. A corrected score now correctly moves the ladder, because there is one definition rather than a published tally the derivation could not touch.
- **Historical identity is proved, not forced.** The derivation reads `matches`, which already carry the historical identity, so it does not re-point through `afldb_identity_for_season`; a Stage-9 gate asserts the invariant instead, so a mis-attributed match fails the rebuild rather than being silently normalised away. A **fail-open** identity gap was found and closed: the existing `North Melbourne` 1999-2007 -> Kangaroos rule is scoped to the `results` dataset, and because North Melbourne's canonical span contains the Kangaroos era, a ladder-dataset lookup passed the era check and resolved silently to the modern identity. A `ladder`-scoped rule was added; Fitzroy, Brisbane Bears and Brisbane Lions remain three separate organizations.
- The acquired ladder is kept as a **validation witness, never a fact source**: `tools/rebuild/fitzroy/validate_ladder_witness.py` proves the manifest binding, per-file SHA-256, row counts, schema and per-season structure offline, resolves all 1,622 source labels through the real `ClubResolver`, and — as a new tenth *validation* stage — cross-checks every derived club-season against the witness on points for/against, premiership points and ladder rank. Percentage is compared by exact decimal reconstruction from the witness's integers, never float to float. The four-stage **data** topology is unchanged.
- Durability reuses the existing convention rather than inventing one: raw artefacts stay gitignored, the manifest is tracked and bound by SHA-256 in the source contract, and preflight refuses **before the destructive stage** when the bytes are absent or altered. Proven by execution.
- Also repaired: the acquirer measured a witness-only acquisition against the core full-history contract, reporting `missing_seasons: [all 129]` for a run that acquired all 129 of its own seasons and directing the operator to a validator that could only fail. It now distinguishes core-snapshot from validation-witness completeness without weakening either. And the rebuild harness resolved Python to a hard-coded in-tree `.venv`, which no git worktree has; it now honours `AFLDB_PYTHON` and refuses with the selected interpreter path instead of a bare "The system cannot find the path specified."
- Validated on a clean `afldb_test` rebuild: all stages passed, the 1,622-row witness comparison agreed on every compared field, and final validation passed **19/19** including six new `club_seasons` gates. Release gates went 42 -> **45/64** with **all nine club-organization/identity gates green**; the two ISSUE-095-owned failures are fixed and the remaining 19 are owned elsewhere (Brownlow acquisition, DraftGuru Stage B3, DOB enrichment, attendance baseline, current-season 2026) and were left untouched.

### AFLDB-ISSUE-090 — DOB conflict writes are now pass-scoped, idempotent and structurally deduplicated - 28 August 2026

- The two DOB enrichment passes had contradictory `dob_conflict` lifecycles. The club-list pass appended a fresh unresolved row on every rerun (entity 4347 held three copies of one logical conflict), and the register pass issued an unscoped `DELETE` over every unresolved `dob_conflict`/`dob_internal_conflict` row, destroying conflicts the other pass owned. Both passes write `SOURCE_KEY = 'afltables'`, so `details->>'source'` could not express ownership at all.
- Ownership is now carried by the pass key inside a versioned `data_issues.details.disputed_by` map (`club_list` vs `register`), with one unresolved row per player aggregating every current assertion and each assertion recording its own `source`, `external_id`, `asserted` and `existing_at_detection`. Keys are serialised sorted, so a rerun writes a byte-identical payload and preserves the row's `id` and `detected_at`.
- Each pass reconciles only the population it can prove it owns — the club-list pass by the source files it actually processed, the register pass by the players it produced evidence for in that run — under `SELECT ... FOR UPDATE` inside the caller's transaction. Every remaining delete is either row-scoped after reconciliation found the payload empty, or population-scoped by `entity_id = ANY(owned)`. **Neither pass can remove the other's assertions in either direction**, and absence from a run is no longer treated as authoritative cessation. Cleanup is evidence-based: a vanished record in a processed file is removed, a present-but-unmatchable record is retained, and an unprocessed file's scope is untouched.
- An identical, previously adjudicated assertion is not refiled; a materially changed one is. Suppression is assertion-specific — never player-wide and never cross-pass.
- Added `src/db/migrations/072_dob_conflict_ownership.sql`: it normalises legacy payload shapes to v2, merges duplicate unresolved groups losslessly (survivor `MIN(id)`, so first detection is kept), recomputes `players.dob_disputed` for the affected players only, and creates the partial unique index `uq_data_issues_open_dob_per_player` as the structural duplicate backstop — one open `dob_conflict` and one open `dob_internal_conflict` per player, resolved history unbounded, no other `data_issues` writer constrained. Fail-closed preconditions abort the migration on every unexpected shape.
- No privilege change was required: `data_issues` is already in `afldb_meta.import_writable_tables`, so `afldb_import` holds the DML the reconciliation needs.
- Validated against PostgreSQL on the canonically rebuilt `afldb_test`: `tests/integration/dob-enrichment-issues.test.ts` **27/27**, the canonical external-identity release assertion **1/1**, and `tests/integration/privileges.test.ts` **24/24** with no grant widened — `data_issues` was already in `afldb_meta.import_writable_tables`, so no privilege change was needed. The global duplicate-issue invariant in `tests/integration/release-gates.test.ts` — deliberately not fixture-scoped — is green.
- Test-baseline repair, not a data change: the release gate `matches players on the profile URL rather than the name` is re-pinned from `12_472` to `13_275`. The canonical legacy-free rebuild of 2026-08-27 replaced the retired `AFLDB_LEGACY_SQLITE` register population with the AFL Tables profile-URL identity population; live `afldb_test`, the accepted baseline `full-history-20260827` (`measured.players`, `identity_scan.distinct_urls`) and the rebuild's own Stage 9 gate all agree at 13,275, with no source row missing or malformed a URL. The `player_birth_evidence` count is a different population and was **not** re-pinned.

### AFLDB-ISSUE-092 — External-identity reconciliation now fails closed on an unproven-complete source - 28 August 2026

- An importer that reconciles `external_identities` by deleting rows absent from its input can only be correct if that input is the complete current population. `enrich_birth_dates.py` never checked that, so a truncated, wrong or synthetic source silently deleted the identities it failed to assert — in any environment, production included.
- Added the reusable fail-closed gate `check_population_drop()` / `PopulationDropRefused` / `POPULATION_DROP_THRESHOLD = 0.10` to `tools/migration/common.py`, called inside the transaction immediately before the destructive statement, on counts read prior to the run's own writes. Asserting an **empty** population against stored rows is refused unconditionally and has **no bypass**; a drop above the threshold is refused unless the caller passes the per-invocation `--acknowledge-population-drop`, which is logged as a warning so its use is visible in run output. The deletion is scoped to the rows the current source and pass own.
- `enrich_birth_dates.py` gained `--source-key`, so a test or partial run can be contained to its own `sources` row and cannot intersect the shared AFL Tables identity population. The DOB enrichment suite exercises the **real** importer under a runtime-seeded fixture source rather than a migration or a mock, keeping the existing acceptance contract intact while making the invocation structurally harmless.
- `import_fitzroy_core.py` reuses the same gate and flags for its own `external_identities` reconciliation, so the canonical rebuild imports under the same protection.
- Validated against PostgreSQL: `tests/integration/dob-enrichment-issues.test.ts` passes **27/27**, covering fixture-source containment, the unbypassable empty-population refusal, threshold refusal and explicit acknowledgement, and the no-false-positive case for equal-or-larger populations and rebuild-from-empty.

### AFLDB-ISSUE-086 — Durable admin overrides regain complete FK-index coverage (migration 075) - 28 August 2026

- Added `src/db/migrations/075_data_overrides_fk_index.sql`, which creates `ix_data_overrides_admin_user_id ON data_overrides (admin_user_id)` — unconditional, non-unique, non-partial, following the migration-041/071 shape for a `NOT NULL` foreign-key column.
- `data_overrides.admin_user_id` references `auth_users(id)` but had no index leading with that column, so a parent-side `auth_users` delete sequentially scanned the durable admin-override table. The table now has complete foreign-key index coverage.
- Repaired forward-only: migration 073, which introduced `data_overrides`, is applied and checksum-baselined and was not edited.
- Validated against the real PostgreSQL foreign-key catalogue: `tests/integration/fk-indexes.test.ts` passes 2/2, covering both every deletable-parent foreign key having a usable index and no stale exemption remaining.

### AFLDB-ISSUE-096 — 2026+ API-first acquisition foundation - 28 August 2026

- AFLDB now has a standing contract for acquiring a current or future season from external APIs, so each data family added later inherits one set of rules. A tracked source-family registry (`data/reference/source-families.json`) declares every family's column shape, hashing rules, identity keys and independence group, and a fail-closed typed parser refuses any payload that does not match the declared shape.
- New migration `074_source_observation_spine.sql` adds the three-grain source observation spine — immutable payloads, ordered record versions and current-key state. Repeated polling of unchanged data stays idempotent, while an A → B → A source correction is retained as three ordered versions over two payload bodies, with exactly one open version enforced by a unique index. Absence is recorded as state on the record and is never a deletion; reappearance clears it without rewriting history.
- The same migration adds the reviewed-promotion ledger: `promotion_candidates`, which permits one live proposal per record and target and supersedes rather than duplicates, and an append-only `promotion_decisions`. Its `SELECT`/`INSERT`-only grants are registered in `tools/maintenance/privileges.sql`, and the privileges suite now asserts that a reconcile cannot restore `UPDATE`, `DELETE` or `TRUNCATE` over the ledger.
- Reconciliation and promotion-review semantics land as pure modules under `src/lib/acquisition/`: the reconciliation verb set with an exported precedence, an ownership predicate that fails closed on foreign *and* unreadable ownership before authority is consulted, a fail-closed manual-authority interface, and a review baseline hashed over exactly the proposed fields, so an unrelated canonical change does not stale a review while a proposed-field change does. Provider agreement never substitutes for authority, and no force, override, bypass or consensus path exists.
- Migrations 074 and 075 are applied to `afldb_test` in that order (75 files, 75 applied, 0 pending, no drift) with privileges reconciled. Validation: DB-free contract 106/106, observation-spine schema suite 13/13, FK-index catalogue gate 2/2 — which also covers `AFLDB-ISSUE-086`'s `data_overrides(admin_user_id)` index added by migration 075 — and privileges 24/24; 145/145 in one combined run.
- Deliberately **not** delivered here: no family-specific importer, no persistence layer and no canonical acceptance/write transaction, no automatic canonical promotion, and no admin review screen. Migration 074 created the tables; nothing writes to them yet, so no user-visible application behaviour changes.

### AFLDB-ISSUE-059 — Safe qualifying-match drill-down - 28 August 2026

- Grouped NL `Qualifying matches` counts can now open a dedicated drill-down that faithfully replays the supported grouped predicates instead of approximating them through Match Search.
- The UI links only when the plan passes the qualifying-match safety gate and otherwise retains its plain-text fallback; the integration also preserves current head-to-head rendering.
- Focused validation passed, including the new PostgreSQL exact-set regression. Three unrelated `club_season` failures remain owned by `AFLDB-ISSUE-095`.


### AFLDB-ISSUE-094 — Typed real-user NL semantic mappings - 26 August 2026

- Parser version 26 adds first-class head-to-head record, win-comparison, draw-count and
  last-draw intents, with validated two-organization plans, an organization-lineage-aware
  PostgreSQL compiler, a structured answer payload and dedicated UI rendering.
- Grouped result thresholds now consume their full comparison phrase atomically and cover
  `at most`, `no more than`, `at least`, `no fewer than`, `more than`, `less/fewer than`
  and `exactly` without leaving `most` for player fallback.
- Club career-games leaders now count appearances for the named club organization rather
  than filtering players and ranking their whole-career totals. Player resolver suffix
  variants keep junior/senior identity while accepting Jr/Jnr/Junior and Sr/Snr/Senior.
- Rebound 50s now decline explicitly as unsupported in NL search and are no longer exposed
  through its metric catalogue; Grid Solver definitions are unchanged.
- Removed the five nonsensical generated `<player> most games in a game` rows from the
  realistic product corpus (1,440 to 1,435). The focused 480-case semantic corpus and the
  593-test NL unit gate pass. The initial PostgreSQL run's two failures were invalid
  assumptions that the rebuilt test database contained incidental Richmond career rows
  and both Gary Ablett identities, not implementation defects. The tests now use isolated
  deterministic fixtures, independent SQL truth and targeted cleanup; the user-run guarded
  `AFLDB_TEST_DATABASE_URL` gate passed 6/6 on 26 August 2026.

### AFLDB-ISSUE-088 — Playwright runs have finite, harness-specific timeout policies - 27 August 2026

- Ordinary E2E, the admin navigation diagnostic and the separate NL-UI stress harness now declare finite action, navigation, expect, test and whole-run timeouts instead of inheriting Playwright's zero action/navigation/global defaults. Each harness keeps limits derived from its own workload; NL batch timeouts and zero-retry observation semantics are unchanged.
- NL-UI now rejects non-positive or invalid `NL_UI_TIMEOUT_MS` overrides, count-guards the optional answer heading, manually deadlines response-body/probe/DOM/page-close promises that Playwright action timeouts do not own, and explicitly deadlines forensic screenshots with corpus-labelled diagnostics.
- New DB-free config/deadline coverage passes 6/6. Final real-browser liveness passes 2/2 in 5.2 seconds: both known-unanswerable rows complete promptly with no timeout, page error, client error or hydration error. ISSUE-088 is resolved; neither a full E2E run nor a full NL stress run is required for this tooling-only change.

### AFLDB-ISSUE-085 — Captaincy reloads reconcile only Wikipedia-owned rows - 26 August 2026

- `import_captaincies` now resolves the Wikipedia source through the fail-closed `require_source` helper and limits keyed reconciliation to that `source_id`, so foreign- and NULL-provenance captaincies remain outside its update/delete population while existing owned row ids and link decisions retain their stable keyed-reload semantics.
- Because `captaincies_natural_uq (season, club_id, player_name_raw, role)` is globally source-blind, an incoming fact already held outside the Wikipedia scope is now refused with an explicit ownership collision before writes instead of being adopted, overwritten, deleted, or left to a raw uniqueness error. No schema migration or `reload_keyed` redesign was required.
- Deterministic integration coverage uses a temporary captaincies-only SQLite fixture and explicitly seeded PostgreSQL rows, independent of historical `afldb_test` populations and the repository's legacy SQLite database. Focused validation passed 2/2 with 21 unrelated tests filtered/skipped.

### AFLDB-ISSUE-077 — The selected frontend theme stays stable across site navigation - 26 August 2026

- Saving site settings revalidated only `/`, `/aflw`, `/search` and `/admin/settings`, so every other statically generated page kept serving the previously cached root layout and its stale `data-site-theme`. Navigating between a revalidated and a stale page let the client router patch `<html>` from the older layout payload, so the theme appeared to change mid-session with no settings change.
- `saveSiteSettings` now issues `revalidatePath('/', 'layout')`, invalidating the whole root-layout cache boundary in one operation so every page resolves the same theme on its next render. The persisted database setting remains the authoritative value. Covered by `tests/admin-settings-actions.test.ts` 1/1, which asserts that exact call and that it is the only revalidation issued.

### AFLDB-ISSUE-093 — AFLDB rebuilds end to end from tracked sources, with no legacy database - 27 August 2026

- **The first complete clean rebuild of `afldb_test` succeeded.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` ran all nine stages — PRECHECK, DATABASE RESET, MIGRATIONS (72/72), PRIVILEGES, REFERENCE DATA, FITZROY CORE, DRAFTGURU, DERIVED, FINAL VALIDATION — and finished with `AFLDB-FINAL-VALIDATION PASSED: 13 checks`. AFLDB can now be reconstructed from tracked, hash-bound, reproducible sources with **zero `AFLDB_LEGACY_SQLITE` dependency**, which is the objective this issue was opened for.
- Every data stage ran under the **restricted `afldb_import` role**, not owner: no `--allow-owner-import-dsn`, no owner fallback. The rebuild therefore proves grant sufficiency rather than assuming it.
- Core source: accepted baseline `full-history-20260827` — men's VFL/AFL 1897–2025, 131 raw artefacts, 719,042 acquired rows, bound by manifest SHA256 `cc8aaf09…` and artefact-set SHA256 `8e14ce61…`. DraftGuru snapshot `annual-html-20260826`: 5,057 persons, 6,810 picks, 6 explicit ledger decisions.
- Imported: venues 52, players 13,275, matches 16,838, match_period_scores 134,704, player_match_stats 685,471, brownlow_round_votes 320,861. Final validation confirmed each against the tracked acceptance register, including `matches_after_accepted_last_season = 0` — 2026 was correctly kept out of the historical core and remains owned by current-season ingestion.
- **Two defects were exposed only by running the real thing under the real role**, and both are fixed: the reference loader's cascade guard demanded reads `afldb_import` is deliberately denied, and the fitzRoy importer's `stats` and `brownlow` phases had both lost the `corrections` parameter they still referenced. Each is described in its own entry below. No privilege was granted for either; `tools/maintenance/privileges.sql` is unchanged.
- **`club_seasons` came back empty, and that is the expected result of a legacy-free rebuild.** The only writer of `staging.team_seasons` — which the derived rebuild selects from — is the legacy importer, under `AFLDB_LEGACY_SQLITE`. The ladder/team-season domain therefore has no canonical acquisition path yet and was never part of the nine-stage contract. Ladders, premiership and wooden-spoon flags, finals counts and club-season natural-language answers stay unavailable until that domain is migrated, which is tracked as **`AFLDB-ISSUE-095` — canonical legacy-free ladder / team-season acquisition** (runbook `AFLDB-ISSUE-095.md`) rather than as a defect in this rebuild. Stage 9 deliberately does not gate `club_seasons` until then. `AFLDB-ISSUE-095` links `AFLDB-ISSUE-015` — the existing per-season `recomputeClubSeasons` parity work — without absorbing it; note that guard fails closed on an empty `staging.team_seasons`, so match create/delete/score-edit throws on a canonically rebuilt database until the domain lands.
- With that follow-up recorded, **`AFLDB-ISSUE-093` is Resolved — 27 August 2026**. AFLDB now has a deterministic, tracked, hash-bound rebuild path from upstream sources with no dependency on the legacy SQLite aggregation, which is the objective the issue was opened for.

### AFLDB-ISSUE-093 — The reference loader's cascade guard no longer demands reads the import role is denied - 27 August 2026

- **The first clean rebuild failed at the REFERENCE stage with `permission denied for table player_link_match_candidates`.** `guard_cascade()` in `tools/migration/load_reference_data.py` decided whether `TRUNCATE ... CASCADE` would destroy out-of-scope data by running `SELECT count(*)` over **every transitive foreign-key dependent** of its truncate roots. That closure is 30 relations and includes admin and link-review tables that `afldb_import` is deliberately denied, so the run died — after the destructive reset had already emptied the database.
- The denial is correct behaviour, not a privilege bug. `tools/maintenance/privileges.sql` grants `afldb_import` SELECT on a **base table** only through `afldb_meta.import_writable_tables`; the app-readable registry is consulted only for views and matviews. Migration 045 seeded the writable registry from the tables that existed then, so any base table created afterwards is revoked unless its migration calls `afldb_meta.grant_import_write()`. Migration 067 registers the match-candidate cache app-readable only, which migration 070's commentary shows was a deliberate choice.
- **A single grant would not have fixed it.** Two relations in that closure are unreadable to the import role — `player_link_match_candidates` (migration 067) and `player_match_period_stats` (migration 062, whose `club_id` references a truncate root directly) — and the guard iterates them in sorted order, so granting the first would simply have moved the failure to the second.
- **The guard now asks the catalogue instead of the tables.** New `common.selectable()` classifies relations with `has_table_privilege()`, which needs no privilege on its argument, in one round trip. `guard_cascade()` counts rows only in dependents it has proven readable and **refuses** on any unreadable dependent, because a table it cannot read is a table it cannot prove empty — strictly more fail-closed than the unhandled exception it replaces.
- **A truncate whose targets are already empty is now skipped.** `TRUNCATE a, b CASCADE` requires TRUNCATE privilege on the entire cascade set, not merely on the tables named, so the statement itself would have been denied on the same two relations even with the guard fixed. Truncating an empty table removes nothing, so new `reload_truncate()` skips it. On a clean rebuild the truncate roots are always empty, so no relation in the closure is read or locked and a table added by a future migration cannot reintroduce this failure.
- **No privilege was granted and `tools/maintenance/privileges.sql` is unchanged** — asserted by a test. No new migration. Data writes remain under `afldb_import`, with no owner fallback.
- 10 new DB-free tests in `tests/reference-data.test.ts` pin the failure class rather than the single table, including the complete list of post-045 tables that never registered import write, so a new one shows up as a source diff instead of a mid-rebuild surprise.
- No canonical data had been loaded when the run failed: the guard refuses before any write, so `afldb_test` holds the migrated schema, reconciled privileges and zero rows.
- **The first version of this fix was incomplete, and a bounded non-destructive proof caught it before any second rebuild.** It assumed a freshly migrated database is empty, so that the guard would short-circuit and read nothing. It is not: migrations 015 and 016 seed `stat_definitions` and `stat_availability`, and both are truncate roots of the loader's `coverage` group. The guard evaluated emptiness and took its cascade closure over the **union** of every group's truncate targets, while the truncate decision is made per group at call time — so the short circuit could never fire, and the closure of the *empty* `clubs`/`seasons` roots was adjudicated even though their truncates would have been skipped. The loader refused over a cascade that was never going to happen.
- **The cascade closure is now taken only from roots that actually hold rows**, because a truncate that will be skipped cascades into nothing. On a freshly migrated database that is `stat_definitions` and `stat_availability`, whose only dependent is `stat_availability` itself — a table the loader rebuilds — so no out-of-scope relation is classified and neither denied table is touched.
- **The guard and the truncate can no longer disagree about which roots are in play**, which was the underlying defect class. `guard_cascade()` records the roots whose cascade it adjudicated; `reload_truncate()` refuses to truncate anything outside that set, and refuses outright if the guard has not run.
- **New `tests/python/reference_cascade_contract.py`: 19 database-free behavioural scenarios** that drive the real `guard_cascade()` and `reload_truncate()` against a fake connection which raises if the guard reads a relation the role may not SELECT. The earlier tests were source-string contracts: they asserted the shape of the short circuit and passed while it never fired. These assert what the code does, including that the closure query is issued for the seeded roots and nothing else.

### AFLDB-ISSUE-093 — The clean test rebuild can now run on Windows, and its final validation stage actually validates - 27 August 2026

- **The MIGRATIONS and PRIVILEGES stages of `npm run db:test:rebuild` could not run on a Windows host.** `db:migrate:test` set its target with a POSIX inline env assignment (`AFLDB_MIGRATE_TARGET=test tsx …`) and `db:privileges`/`db:privileges:test` interpolated the DSN with `"$VAR"`. npm runs package scripts under `cmd.exe` on Windows, where the first fails outright with `'AFLDB_MIGRATE_TARGET' is not recognized …` and the second hands psql the literal string `$AFLDB_TEST_DATABASE_URL` as a database name. Both are fail-closed failures rather than silent mis-targeting, but the destructive DATABASE RESET is stage 2 and MIGRATIONS is stage 3 — an unremedied run would have emptied `afldb_test` and then failed immediately.
- `tools/db/migrate.ts` gained `--target <name>`, and `db:migrate:test` now uses it. `AFLDB_MIGRATE_TARGET` remains supported and unchanged for every documented invocation, including the production cutover; when both are supplied they must agree, and a disagreement is a refusal rather than a silent preference for one over the other.
- **New `tools/db/privileges.ts`** resolves the privileges DSN in Node from the same explicitly named targets and passes it to psql as an argument, so no shell is involved. The psql invocation is otherwise unchanged — same binary, same flags, same `-f tools/maintenance/privileges.sql`, same exit status — and it deliberately does not route through `runPsql`, whose `--single-transaction -f -` envelope belongs to the destructive reset and would change how `privileges.sql` executes. No DSN is printed on any path. The script names `npm run db:privileges` and `npm run db:privileges:test` are unchanged, so existing runbooks stay correct.
- **The rebuild's FINAL VALIDATION stage did nothing.** Stage 9 was declared `run: 'internal'` while `executeRebuild()` had no branch for `internal`: the loop logged the stage name, recorded it as executed and fell through, and the exported `FINGERPRINT_QUERIES` was never called by anything. `Rebuild complete.` was therefore printed on the strength of eight exit codes and nothing else, so a rebuild that produced the wrong dataset could not be detected by the rebuild.
- Stage 9 is now a real `validate` stage with its own `deps.runValidation`, kept distinct from the destructive `runSql` so no single-field edit can route a validation stream into the destructive runner or the reset into the read-only one. Its expected values are read from the same tracked acceptance register the fitzRoy preflight validates against, so the offline gate and the database gate cannot drift apart; the DraftGuru counts come from the one constant the DraftGuru preflight already uses. It asserts the one thing the offline validator structurally cannot — that the database actually received the accepted dataset — across 13 gates, including that no match later than the accepted baseline's last season was imported. An unrecognised `measured` key in the register is a refusal, so the gate cannot silently shrink. The stream is read-only, reports every measured value whether it passes or fails, collects all failures together, and ends in `RAISE EXCEPTION` so a mismatch is a non-zero psql exit and a failed stage.
- 16 new DB-free tests in `tests/db-test-rebuild.test.ts` (182 in the suite). The existing test asserting the repository's other psql callers keep off the `getopt_long` hazard was relocated to where the argv is now built, not weakened.
- No database was created, modified or destroyed by this change, and no rebuild has been executed.

### AFLDB-ISSUE-093 — The clean test rebuild's database reset now works, and can be proven without destroying anything - 27 August 2026

- **The rebuild's DATABASE RESET stage never sent its SQL to PostgreSQL.** `tools/db/rebuild-test.ts` ran the reset as `void client.unsafe(sql)`; a postgres.js `Query` only executes when `.then`, `.catch`, `.finally`, `.execute()` or `.forEach()` is called, so nothing reached the server, the surrounding `try`/`catch` could never observe a failure, and the stage would have reported success against an untouched database — leaving MIGRATIONS to find every migration already applied and every data stage to load on top of the old data. The reset now runs through `psql -v ON_ERROR_STOP=1 --single-transaction -f -` under `spawnSync`: synchronous (as the stage graph is), a real exit code, and all-or-nothing.
- **The reset's `pg_` internal-schema exclusion excluded nothing.** `NOT LIKE 'pg\\_%'` written inside a JavaScript template literal reaches PostgreSQL as `'pg\\_%'`, which matches only names beginning `pg\`. `pg_toast` is present in every database, so the first loop would have attempted `DROP SCHEMA IF EXISTS pg_toast CASCADE` and aborted on a pinned system schema. Now `!~ '^pg_'`.
- Extension-membership guards (`pg_depend.deptype = 'e'`) now cover the schema, table and view loops as well as routines and types, so an extension-owned object in `public` can never be dropped by the reset; a new loop removes standalone sequences and foreign tables.
- **`RESET_SQL` is now proven safe against live PostgreSQL — rebuild blocker 2 is closed.** The rollback-only proof passed against a reconstructed `afldb_test` (migrations 001–072, privileges reconciled, PostgreSQL 16.15): pre-reset and post-rollback catalog fingerprints identical at `a8a2a899…`, health 950 relations / 3 extensions, psql exit 3 (the deliberate abort), 1498 ms. Inside the aborted transaction every rebuild-owned object class was zero while the `public` schema, all 3 extensions and all 56 extension-owned objects survived. The full incident lineage that preceded it is retained in `AFLDB-ISSUE-093.md` §20 and summarised in the new FIRST CLEAN REBUILD HANDOFF §H3 — it is deliberately not tidied up.
- **The reset now has a single execution path** (`tools/db/psql.ts`). The destructive rebuild stage and the new rollback-only proof both call one `runPsql` helper with one `psqlArgv` — same binary, same flags, same error handling — so proving the proof proves the mechanism the rebuild will actually use. Neither caller assembles psql flags of its own.
- **New command `npm run db:test:prove-reset`** (`tools/db/prove-reset.ts`): sends the rebuild's exact `RESET_SQL` through that same psql path, inside psql's own single transaction, and always aborts. The stream's final statement is a deliberate `RAISE EXCEPTION`, reached only after every assertion has passed, so a commit is impossible twice over — psql does not commit an errored stream under `ON_ERROR_STOP=1`, and PostgreSQL rolls back an already-aborted transaction even if `COMMIT` were sent. A zero exit status is therefore reported as a failure.
- The proof refuses before the reset if the server reports a database other than `afldb_test`, if `current_user` or `session_user` is anything but a non-superuser `afldb_owner`, if any other client session is connected, or if psql cannot be launched or cannot reach the database. It snapshots the extensions and every extension-owned object into temp tables inside the transaction and requires them member-for-member afterwards, asserts a clean slate in SQL and again in Node, and requires the post-rollback catalog fingerprint to equal the pre-reset fingerprint exactly.
- **The first live rollback proof COMMITTED the reset and wiped `afldb_test` (2026-08-27).** The proof exited 0 without performing its deliberate abort, and read-only verification confirmed the database had been reset: pre-proof fingerprint `0229d62c…` → `f46ce34c…`, leaving `public` only, zero application relations, no migration bookkeeping, and all three extensions with all 56 extension-owned objects intact. That is exactly the intended clean slate, so `RESET_SQL`'s semantics are now validated against live PostgreSQL; the rollback containment is what failed. Production and `afldb_dev` were never targeted, and the loss was schema and privileges only — no import had ever been run against this database. **The psql argument vector now passes the DSN as `-d` rather than as a positional operand** (PostgreSQL's own non-permuting `getopt_long`, used on Windows, can otherwise swallow `--single-transaction` and `ON_ERROR_STOP=1` as operands, leaving psql to autocommit each statement and exit 0 regardless of errors); `db:privileges` and `db:privileges:test` were moved off the same shape. The proof also now detects autocommit and stops **before** the first destructive statement, and relays psql's output with connection strings redacted.
- **Earlier that day, the first proof attempt had already failed once and the proof was hardened.** psql exited 0 instead of performing the deliberate abort, and the refusal reported only the exit status — discarding the evidence. The availability probe could not have caught it either: it ran `SELECT 1` and accepted exit 0, which an undelivered stdin also produces. The proof now arms a **server-side commit trap before the reset** (a deferred unique violation in a temp table, checked at COMMIT, so a truncated stream cannot commit whatever psql does), emits a delivery marker as its first statement, distinguishes "never began" from "began and stopped", always reports psql's own output, and uses a probe that proves stdin delivery, `ON_ERROR_STOP` and diagnostic propagation.
- **New command `npm run db:test:fingerprint`** (`tools/db/fingerprint-test.ts`): read-only catalog fingerprint of `afldb_test`, optionally compared against a recorded digest with `--expect`. The fingerprint implementation moved to `tools/db/catalog-fingerprint.ts` so the verifier and the proof compute the same digest from one implementation. It puts the server into `default_transaction_read_only` before querying and can reach no reset path.
- **The proof was refusing because of its own observer connection.** After the incident fixes, the hardened proof failed twice with "1 other client session(s) connected to `afldb_test`" while a standalone `pg_stat_activity` check saw none. The CLI held a single postgres.js connection open across the entire proof, so the psql process counted it as another client backend; the Node-side gate could not see itself. The proof now runs in three phases — observation session opened and closed, then psql alone, then a fresh session for the post-rollback fingerprint — and its dependency interface exposes a scoped `withSession` rather than a connection handle, so nothing can span the reset. The exclusivity gate itself is unchanged and no session is exempted by name, PID or role.
- 96 new DB-free tests in `tests/db-test-rebuild.test.ts` cover execution-path parity (including a test that drives both callers through one recorded spawn and asserts identical argv), psql availability, every refusal, the absence of a commit path, and the proof's inability to continue into migrations, privileges, importers or the derived rebuild.
- No database was created, modified or destroyed by this change, and no rebuild has been executed.
### AFLDB-ISSUE-071 — V2 numeric-condition oracle keeps operators with their clauses - 27 August 2026

- Corrected the V2 corpus-oracle checker so explicit numeric operators are associated with their generated condition noun, preventing same-valued clauses such as `3+ goals and exactly 3 clubs` from exchanging operators invisibly and being reported as parser `DROPPED_FILTER`/`EXTRA_FILTER` defects.
- Added focused harness regressions for the stale swapped expectation and a correct same-valued control. Production NL parser, typed plan, confidence, coverage, and decline behaviour are unchanged; parser version remains 25.
- Corrected the NL stress documentation to state that the existing DB-free `--report-only` mode is V1-only. Final DB-free validation passed 3/3 focused files and 382/382 tests (`nl-stress-v2` 58/58, `nl-regression-corpus` 163/163, `nl-parser` 161/161). The unavailable historical 250k rerun is optional aggregate rebaseline measurement, not a correctness or resolution blocker.

### AFLDB-ISSUE-083 — Importer tests enforce production-role parity - 27 August 2026

- Added the optional `AFLDB_TEST_IMPORT_DATABASE_URL` contract and a shared,
  fail-closed integration harness that verifies the restricted credential uses
  the same `_test` database as owner fixtures, authenticates as `afldb_import`,
  and remains denied DELETE authority over `auth_users`.
- Supported Under-22 awards, first-kick-goal and DOB-enrichment production
  importer children now run with the restricted credential while setup,
  assertions and cleanup remain owner-backed. Data Editor gained a bounded
  restricted-role proof for the migration-066 transactional audit write path.
  During integration after ISSUE-093, the retired legacy Draft seam remained
  deleted and its restricted-role contract was ported to the supported canonical
  DraftGuru importer suite instead.
- Missing restricted credentials skip explicitly and never fall back to the
  owner DSN. No PostgreSQL privilege or importer semantics changed.
- The harness receives both DSNs through explicit dependency injection. Passing
  `undefined` deliberately therefore models an absent restricted credential
  even when the invoking shell has `AFLDB_TEST_IMPORT_DATABASE_URL` configured;
  it can no longer be repopulated by a default parameter from ambient state.
- Child-process callers supply partial environment overrides, which are merged
  over `process.env` before the validated restricted import DSN is applied;
  first-kick-goal parity uses one focused accepted-retirement execution so its
  role proof does not inherit the historical semantic test's three full reloads;
  focused import fixtures no longer need to fabricate unrelated required keys.
- Awards parity now uses the production `under_22` group, whose PostgreSQL
  identity resolution avoids the legacy honours loader's intentional coupling
  to SQLite player surrogate ids while still exercising real importer reads,
  upserts, batch/sequence writes, and completion accounting as `afldb_import`.
- First-kick-goal integration setup now loads its canonical source rows
  explicitly with the owner fixture credential and supplies one bounded linked
  row when sparse test data cannot resolve any automatically. Focused parity
  tests therefore no longer depend on an incidental prior FKG database load;
  the production subprocess under assertion remains `afldb_import`.
- Final validation against the privilege-reconciled rebuilt test database is
  green: live harness 2/2, DB-free harness 4/4, and focused Data Editor,
  first-kick-goal, Under-22 awards, club-list DOB and register DOB restricted
  paths all passed. ISSUE-083 is resolved; coverage is intentionally scoped to
  those supported paths rather than every historical importer in the tree.

### AFLDB-ISSUE-091 — Migration checksums are deterministic across LF/CRLF checkouts - 25 August 2026

- `tools/db/migrate.ts` checksum computation and drift comparison now use a new pure module (`tools/db/migration-checksum.ts`) that derives three bounded representations of a migration file's content — raw bytes, canonical all-LF, canonical all-CRLF — and accepts a stored ledger checksum matching any one of them.
- Fixes a false-positive "modified since they ran" refusal that blocked `db:migrate`/`db:status` from applying any pending migration whenever a Windows CRLF checkout materialized different bytes than the LF-based checksum recorded in `afldb_meta.schema_migrations`.
- A newly applied migration now always stores the canonical all-LF checksum, regardless of which platform applied it, so this checkout-dependence cannot recur going forward.
- No historical migration file or `afldb_meta.schema_migrations` row was modified; migration execution SQL is unchanged. Real content edits to an already-applied migration are still detected and refused.

### AFLDB-ISSUE-073 — FK-index gate now passes (migration 071) - 25 August 2026

- Four audit/link foreign keys introduced by migrations 056 and 057 now have supporting indexes (`src/db/migrations/071_audit_link_fk_indexes.sql`).
- `ix_data_edits_admin_user_id` and `ix_plr_admin_user_id` are unconditional indexes on `NOT NULL` columns; `ix_plr_player_id` and `ix_pls_resolved_by` use `WHERE col IS NOT NULL` partial indexes on nullable columns, following the migration-041/050 convention.
- No `DELETE_FREE_PARENTS` exemption was added; `auth_users` and `players` are both genuinely deletable parents.
- `tests/integration/fk-indexes.test.ts` (2 tests) now passes green.

### AFLDB-ISSUE-082 - 25 August 2026
- `confirmUnlinked` admin mutation now uses the `import`-role transaction and takes an authoritative row lock before writing.
- `previous_status` is derived securely from the locked database row, completely ignoring the form-supplied state.
- Draft sibling decisions are classified at the draft-person grain, mirroring the importer's effective latest-resolution-per-pick classification (`DISTINCT ON (target_id) ... ORDER BY created_at DESC, id DESC`).
- Stale resolve/confirm races, identical duplicate `confirmUnlinked` submissions, and consistent existing decisions are strictly rejected as stale state.
- Contradictory decisions (where effective sibling actions differ or point to different players) fail closed.
- `confirmUnlinked` remains an audit-only operation and does not participate in the ISSUE-080 honour-team advisory-lock protocol.
- A deterministic, database-backed PostgreSQL concurrency regression test (via `pg_blocking_pids`) covering all three interleavings has been permanently added to the integration suite.

### Production Deployment of Player-Link Protections (Schema 070) - 24 August 2026

- `AFLDB-ISSUE-084` (resolved) successfully rolled out the ISSUE-044/078/080 link-preserving loaders across all seven `LINK_TARGET_TABLES` families to the production database (`afldb_prod`). Production schema advanced from 057 to 070.
- Production role privileges were reconciled, stripping invalid legacy grants and enforcing explicit `afldb_import` restrictions on audit and link-decision tables.
- The one-time production first-kick-goal `--rekey` completed successfully (334 rows migrated in place, surrogate IDs preserved unchanged).
- Both the Profile-B reload-safety audit and the clean post-migration player-link integrity audit passed without collisions, exposed rows, or dangling identities.

### Validated Release Candidate Promoted to `main` - 24 August 2026

- `origin/main` was fast-forwarded (non-force) from `9be7f26` (migration 061) to the fully validated release candidate `0da44f9` (migration 070) under `AFLDB-ISSUE-087` (resolved). This promotes the accumulated, previously dev-only release state through migration 070 to `main`; ISSUE-087 itself was a release-validation and promotion gate, not the implementation issue for the individual features contained in that candidate.
- The promoted SHA was validated end-to-end on Linux before the push: provenance/topology proofs, full unit and integration gates with only the exact expected known-issue signatures, a fresh production-style standalone build, full E2E plus the nine-route matrix, and a complete 1,440-question NL UI acceptance sweep (hydration errors 8 = 0.56%, inside the frozen release band). Only the exact candidate SHA was promoted; the docs-only `dev` tip was not.
- **No production deployment occurred:** production remains at checkout `a32a0a1` (migration 057) and was verified undisturbed after the push. Deploying this state to production is owned by `AFLDB-ISSUE-084` (still HALTed at P0.2), whose `main`-promotion prerequisite is now satisfied.

### Award and Honours Reloads Reconcile Only Rows They Own - 23 August 2026

- Five reload paths in `tools/migration/import_awards.py` no longer delete rows they did not supply (`AFLDB-ISSUE-080`, resolved). Hall of Fame and honour-team reloads previously reconciled their **entire** table; the legacy-winner, All-Australian and Rising Star reloads reconciled by award domain alone. Any row inside those populations whose key the incoming extract could not produce — an admin-created `award_winners` row from the shipped `createAwardWinner` screen, an ingest-promoted `sports_data_lab` row, an admin honours row, or any provenance-unknown row — was classified as vanished and deleted (or, if it carried a manual player link, aborted the whole reload since `AFLDB-ISSUE-044`).
- Ownership is now the reconciliation scope, not the key shape: `reload_keyed` gained an AND-composed conjunctive scope, and every affected loader restricts its existing-row population to the source ids it owns **in addition to** its domain predicate — the model `import_under_22` and `import_draft.py` already used. Rows owned by another source (or none) are untouched by UPDATE, INSERT-suppression and DELETE alike, whether or not they carry a link decision. A missing `sources` row now fails closed by name instead of silently scoping to nothing.
- The Hall of Fame reload refuses, before any write, an incoming `(name, inducted_year)` key already held by a row it does not own, naming both sides instead of surfacing a raw `hall_of_fame_name_uq` violation; ownership is never adopted and the constraint is never weakened. The honour-team reload applies migration 059's identity semantics case by case: same-name collisions with unknown or duplicated identity refuse fail-closed, while two players positively linked to different ids may share a display name in one team (the `AFLDB-ISSUE-025` capability, preserved and regression-tested).
- Admin creation is now create-only and fail-closed: `createHallOfFameInductee` and `createHonourTeamMember` stamp `manual_admin_edit` provenance, and `createHonourTeamMember`'s silent `ON CONFLICT … DO UPDATE` over existing rows (which let an admin create overwrite a Wikipedia-owned row that the next reload then reverted) is replaced by an explicit both-axes duplicate refusal that names the existing entry. Because migration 059's partial indexes leave the two mixed linked/unlinked same-name collisions with no database backstop, the importer and the admin path serialise on one frozen transaction-scoped advisory lock `(717275, 1)` — blocking in the batch importer, fail-fast with a clear "reload in progress" error in the admin path — with the constants asserted identical across both languages by a contract test.
- No migration, no backfill of historical `source_id IS NULL` rows (they keep meaning "provenance unknown"), and no privilege change — the lock protocol was proven under the real `afldb_import` role and `tests/integration/privileges.test.ts` passed unchanged (24/24). `import_captaincies` is deliberately unchanged (no proven second owner; hardening raised as `AFLDB-ISSUE-085`).
- Validated 2026-08-23: a read-only Profile-A production audit (two-plane, keyset-fingerprinted) found zero foreign-owned, NULL-source or colliding rows in any affected population before implementation; `tests/awards-admin.test.ts` 33/33; `tests/integration/awards-reload-links.test.ts` isolated against `afldb_test` 21/21 with 0 skipped (amended suite rerun after review added a real-database §4.4 axis-2 admin-create test), covering ownership survival on all five paths, the full collision/refusal matrix, coexistence, idempotency and the §9.4b lock proofs; read-only `afldb_dev` inventory clean (wikipedia-only honours provenance 343/113, all foreign/NULL and duplicate counts zero); typecheck clean.
- **Production is not yet fixed:** the corrected `common.py`/`import_awards.py`/`awards-admin.ts` deploy via `AFLDB-ISSUE-084` as a prerequisite of its loader rollout, with a regenerated Profile-B audit gating the first post-migration awards/honours reload. The combined run with `release-gates.test.ts` is deferred to `AFLDB-ISSUE-081`, whose latent test race the new fixtures widen.

### First-Kick-Goal Records Gain Tracked Stable Identity - 22 August 2026

- Re-importing the "goal with their first kick" record no longer discards the identity decisions admins record in `/admin/player-links`, no longer deletes achievement rows belonging to another source, and now keeps a row's surrogate id across **any** descriptive correction - including a renamed player (`AFLDB-ISSUE-078`, first-kick-goal half; resolved 22 August 2026).
- Reproduced against `afldb_test` before the change: the integration suite failed 6 of 6 against the unmodified importer, row ids moved from 1-334 to 2674-3007 over repeated reloads (ids advance monotonically and are never reused, so decisions dangled rather than being reattributed), and a first-kick-goal row stamped with a different source was deleted outright.
- Identity is assigned, not derived. The extract is an untracked, hand-curated Wikipedia table with no identifier, and its clean names are not durable - one row's mojibake is guaranteed to change on a correct re-extract, and the importer's own override table records eight spelling divergences. Each logical record therefore receives an opaque, never-reused `fkg-NNN` id in the **tracked** manifest `data/records/first-kick-goal-ids.csv` (the `22-under-22.csv` opt-in pattern: replaceable raw material stays gitignored, curated reviewable identity is committed), stored as `source_record_id` and enforced by the existing `player_achievements_source_uq` - no migration needed.
- Because the extract carries no id, an unmatched extract name is never classified as new while an active manifest row is also unmatched - that pair is more likely one spelling correction, so the reload and `--assign-ids` both abort with the unmatched sets printed for curator classification, allocating nothing. A rename keeps its id via a manifest edit; a removal is `Status=retired`, which reserves the number forever; only then are genuinely new rows allocated, strictly above the highest number ever issued.
- A rename of a record carrying a human decision aborts until acknowledged per record with `--accept-rename fkg-NNN`, which keeps the row, the surrogate id and the decision; deleting a retired record that still carries durable references (adjudicated data issues, reader suggestions, match candidates) aborts until `--accept-retirement fkg-NNN`; a retired record carrying a link decision is a decision loss and requires the separate `--allow-link-loss`. Acknowledgements are validated against what the run actually detected - unknown or stale flags fail rather than no-op.
- The one-time database transition is `--rekey`: bridged by the current clean names, it prints a preflight report and rewrites `source_record_id` in place only on an exact 1:1 mapping (334/334/334/0/0/0 on the real transition), changing no surrogate id and nothing else. Retry-safe: an already-transitioned database verifies and no-ops, a mixed state aborts. It must run per target database before the extract is next corrected.
- Also corrected during final review: `player_link_resolutions.target_id` is `bigint`, which postgres.js returns as a string; a number-keyed lookup had silently dropped every decision, and an interim `::int` cast narrowed a bigint identity without a guard. The lookup now keeps the driver's representation and keys both sides as strings, with the representation pinned by a regression.
- Everything is one PostgreSQL transaction with every abort ahead of the first target write; a mid-reload failure rolls back even the early deletes, proven by a regression that forces a later insert to fail. An aborted run leaves no `import_batches` row - the batch record is created inside the same transaction, unlike the Python loaders, which commit theirs first and mark it failed.
- Retiring a source fact never silently strands an application reference. `player_achievements.id` is referenced without foreign keys by four things, and they are not alike: the importer's own unresolved data issues are disposable and are deleted with the row; the match-candidate cache is advisory and self-limiting, so an orphan there is never fetched; reader suggestions and adjudicated data issues are durable, and a retirement carrying either fails closed until the curator names that exact record with `--accept-retirement`, which then reports precisely what it leaves behind. A retiring row that also carries a link decision is a decision loss and additionally needs `--allow-link-loss`.
- Migration `070_import_reads_link_suggestions.sql` grants `afldb_import` SELECT - and only SELECT - on `player_link_suggestions`, mirrored in `tools/maintenance/privileges.sql`. The loader has to see the reader tips it might strand, and a dead tip is not harmless the way migration 056's column comment suggests: the "Reader suggestions" panel renders every open row unjoined, so an orphan sits in that queue permanently and can never be approved. **Deployment order is required, as for migrations 066 and 068:** apply migration 070 and run `npm run db:privileges` before the new importer code, or the first retirement fails closed on the read.
- Verified on the dev host against `afldb_test`: 14/14 integration tests in `tests/integration/first-kick-goal-reload-links.test.ts` (over temp copies - the tracked manifest and curated extract are never modified by tests), and a reload against the real committed manifest reports 334 updated, none inserted, none deleted with a byte-identical row-id fingerprint. The importer was also exercised end to end as the `afldb_import` role, which the test suite does not use. `tests/integration/awards-reload-links.test.ts` and `tests/integration/draft-reload-links.test.ts` still pass.

### Draft Reloads Preserve Manual Player Links and Admin-Created Rows - 22 August 2026

- A full draft reload no longer discards the identity decisions admins record in `/admin/player-links`, and no longer deletes draft picks an admin created (`AFLDB-ISSUE-078`, draft half). `tools/migration/import_draft.py` reconciles `draft_picks` and `draft_persons` by the source's own key instead of truncating and re-COPYing, so every row id survives - and with it `player_link_resolutions.target_id`, the `player_link_match_candidates` suggestion cache and the draft-person `data_issues` history, all of which name those ids without a foreign key.
- Reproduced against `afldb_test` before the change: the new integration suite failed 7 of 7 against the unmodified importer. Repeated reloads had already pushed `draft_picks` to ids 88,532-95,341 and `draft_persons` to 65,788-70,844 for the same 6,810 and 5,057 rows. Ids advance monotonically and are never reused, so a decision was left dangling rather than transferred to another person's row.
- The reload key is the source's real identity, established by reading the upstream generator rather than inferred from uniqueness. Two things that look like ids are not: `dg_person_id` is assigned as a rank over a person frame sorted by player URL and recomputed on every upstream load, and `source_record_id` holds a legacy SQLite rowid from a table written with `to_sql(if_exists="replace")`. What is durable is `player_url` - DraftGuru's own person page, whose trailing ordinal separates same-name people - already stored on both tables. `draft_persons` reloads on `(source_id, player_url)`; `draft_picks` on `(source_id, player_url, draft_year, draft_kind)`. `pick_number` is deliberately excluded, so a corrected pick number reconciles as an update to the same row.
- Migration `069_draft_source_identity.sql` adds those two keys as unique indexes and fails closed if the current data contains a duplicate; nothing is de-duplicated on its own authority. The `draft_picks` index is partial on `source_id IS NOT NULL`, so admin-created rows stay outside the importer's identity space and two admins can still create players drafted at the same year and pick. `draft_persons`'s existing `(source_id, dg_person_id)` constraint is re-declared `DEFERRABLE INITIALLY IMMEDIATE`: a reload permutes that column once the source renumbers, which a non-deferrable unique constraint rejects row by row.
- Every statement is scoped to `source_id = draftguru`. An admin-created pick (`source_id IS NULL`, and no draft-person identity, so it can never carry a link decision at all) is now outside the reload's UPDATE, INSERT and DELETE alike - previously it was destroyed silently on every run, the same ownership defect tracked as `AFLDB-ISSUE-080` on the honours tables.
- Draft decisions are replayed person-grained, matching how the product applies them: `applyLockedLink` writes the draft person and every pick belonging to it, while the audit row names only one pick. A `confirmed_unlinked` decision therefore keeps the whole person unlinked, so no sibling pick can take a source link an admin has already rejected. Where the source disagrees with the admin, the admin wins and the disagreement is reported by person, name and both player ids.
- Decisions are classified before the first write. One that cannot be carried - the source dropped the person, dropped the key, or renamed the row under it - aborts the reload with both tables untouched, with `--allow-link-loss` as the deliberate escape hatch that itemises each discarded decision. Two picks of one person carrying contradictory decisions abort unconditionally: identity is person-grained, so there is no safe decision to keep, and `--allow-link-loss` does not apply.
- The importer also refuses to run if the source supplies a row with no `player_url` or no `draft_kind`. A null kind means the upstream classification does not recognise a new draft-type wording yet, and keying on null would quietly merge distinct selections.
- Verified on the dev host against `afldb_test`: a full reload reports 5,057 people and 6,810 picks all updated, none inserted, none deleted, with the row-id fingerprint of both tables byte-identical before and after, and unchanged 3,459 linked / 100 backlog / 1,498 never-played counts. New `tests/integration/draft-reload-links.test.ts` drives the real importer against the database for seven cases; `tests/integration/awards-reload-links.test.ts` still passes, so `AFLDB-ISSUE-044` is intact.
- **Deployment order is required, not advisory:** apply migration `069_draft_source_identity.sql` before deploying the new importer, which defers a constraint the migration makes deferrable. No privilege reconciliation is needed.
- The first-kick-goal half was subsequently completed under `AFLDB-ISSUE-078`; see the stable-identity entry above.

### Honours Reloads Preserve Manual Player Links - 22 August 2026

- A full awards/honours reload no longer discards the identity decisions admins record in `/admin/player-links` (`AFLDB-ISSUE-044`). All six legacy loaders in `tools/migration/import_awards.py` now reload by the source's own key instead of truncating and re-COPYing, so every target row keeps its id - and with it the `player_link_resolutions.target_id` that points at it.
- Reproduced against `afldb_test` before the change: a Hall of Fame row linked to a player came back with `player_id NULL` under a new id, and its audit row pointed at an id that no longer existed. Ids are never reused (the loaders do not `RESTART IDENTITY`), so a decision was left dangling rather than transferred to another person's row.
- Reload keys are the source's own: `(source_id, source_record_id)` for `award_winners`, `award_nominations` and `captaincies`, `slug` for the award definitions, and migration 042/005's name-based natural keys for `hall_of_fame` and `honour_team_members`, which carry no source record id.
- Migration `068_import_reads_link_resolutions.sql` grants `afldb_import` SELECT - and only SELECT - on `player_link_resolutions`, mirrored in `tools/maintenance/privileges.sql`. The importer needs it because the honours row records only the outcome: the legacy vocabulary maps `from_draft` onto the same `resolved`, so a human link cannot otherwise be told from an import-derived one. The table stays append-only: no UPDATE, no DELETE, no TRUNCATE from any role.
- The latest decision per target is re-applied over the refreshed source facts. A `linked` decision restores the admin's player and `resolved`; a `confirmed_unlinked` decision keeps the row unlinked even when the source later supplies a link. Where the source disagrees with the admin, the admin wins and the disagreement is reported by row, name and both player ids rather than being applied silently.
- Every decision is classified before the first write, so a decision that cannot be carried safely - the source renamed the row under a name-based key, or the key vanished entirely - aborts the reload inside its own transaction with the target table untouched. `--allow-link-loss` is the deliberate escape hatch and itemises each discarded decision with its table, id, key, name, reason, action and player id.
- That same name check is what makes the positional `award_winners` source keys safe: if the legacy source shifts row numbering, the name under a key changes and the run stops instead of reattributing a link to the wrong person.
- The independently sourced `under_22` group is unchanged; it already upserted its own rows and is now simply out of the legacy loaders' scope rather than being deleted and rebuilt.
- Verified on the dev host against `afldb_test`: a full reload leaves every row count and every row-id fingerprint byte-identical, three consecutive reloads are idempotent, and four recorded decisions (including a source disagreement) survive intact. New `tests/integration/awards-reload-links.test.ts` drives the real importer against the database for six cases, including both name-key aborts and the full 64-second legacy awards group.
- **Deployment order is required, not advisory** — the same shape as migration 066: (1) apply migration `068_import_reads_link_resolutions.sql`, then (2) run the privilege reconciliation `npm run db:privileges`, then (3) deploy the importer/application code. Running the new importer before steps 1 and 2 makes the honours loaders fail closed on the resolution read.
- The same defect was subsequently fixed in the draft and first-kick-goal reloads under `AFLDB-ISSUE-078`; both now preserve stable identity and manual link decisions.
- Reloads run before this change may have left `player_link_resolutions` rows pointing at target ids that no longer exist. A read-only audit is tracked as `AFLDB-ISSUE-079`; `afldb_dev` was checked and is clean (75 resolutions, none dangling), and production has not yet been audited. Nothing is relinked or deleted automatically.

### Confidence-Scored Player-Link Suggestions - 22 August 2026

- Added deterministic, explainable match suggestions to `/admin/player-links`, so unmatched source names arrive with a ranked candidate, a 0-100 confidence score and the evidence behind it instead of having to be searched for by hand (`AFLDB-ISSUE-075`).
- Scoring is pure and shared by the page, the approval path and the offline backtest; no LLM takes part in candidate generation, scoring, ranking or approval.
- Candidate generation stays separate from scoring, honouring migration 019's rule that a name-similarity score is a candidate and never a link: exact normalised name, exact alias and a bounded trigram neighbourhood, all index-backed.
- At most one signal per evidence family may score, so an exact name is not also paid for as a trigram and a surname match.
- Temporal evidence is now typed by competition. A Hall of Fame induction year and a draft year are no longer read as playing seasons, and only AFLDB's own seasons may contradict a career range - state-league award seasons (Magarey, Sandover, Liston, U18) cannot.
- Contradictions are tracked separately from the score, cap the confidence band and always block bulk approval; a contradiction is only ever drawn from complete data.
- Suggestions are cached per resolution entity (migration 067), so a draft person with several picks is one decision rather than several near-duplicates that could disagree.
- Approving a suggestion locks the row, re-reads the evidence and rescores inside the same import transaction, requiring the fresh result to still name that player. A score supplied by the browser is never read, and stale or contradicted suggestions are refused.
- Bulk approval is available only for rows meeting stricter rules than the display band - exact-quality name evidence, two independent corroborating families, a wide candidate gap and no contradiction - and re-checks each row under its own lock. A failure on one row neither aborts the batch nor affects any other row.
- The queue can be filtered by confidence band or narrowed to bulk-ready rows, and is ordered so the clearest decisions and the genuinely ambiguous ones surface first.
- Player-link resolutions now record how a link was decided (`manual`, `suggested`, `bulk_suggested`), the score the server calculated and the algorithm version, so the model can be audited later.
- Calibrated against 9,356 confirmed links: 99.69% top-1 accuracy, 99.84% candidate recall, 99.99% precision in the `very_high` band, and 7,337 bulk-eligible rows at 99.99%. All 44 bulk-eligible proposals in the live dev queue were checked by hand and all were correct.
- Bulk eligibility is decided per source class from measured evidence, not from the aggregate. `award_winners` (2,750), `draft_person` (2,319), `award_nominations` (702) and `player_achievements` (253) showed no false positive; `captaincies` is excluded because a club's recorded captain and the player who actually led the side can legitimately differ, and `hall_of_fame`/`honour_team_members` are excluded for having no measured bulk population at all. Final bulk population 6,024 at 100% precision, zero false positives, with `very_high` unchanged at 7,558/99.99%.
- The queue is source-record-centric rather than name-centric: each row states what KIND of record it is in that source's own terms — an award and its season, a nomination and its round, an honour team and position, a draft's year, club, pick and source-reported totals, a Hall of Fame playing career shown separately from its induction year.
- The suggested player carries career context (clubs, span, games, goals) and the evidence behind the score appears as plain chips in the row itself, so the drawer is for detail rather than for discovering why a score exists.
- Repeated source names are grouped visually with a shared-suggestion summary, and a group whose records suggest different players is flagged and withheld from bulk approval. Grouping is presentation only: every record keeps its own identity, status, approval rules and audit trail.
- `BULK-READY` explains the four criteria that earn it, so it reads as a separate judgement from the confidence score rather than a louder version of it.
- A Hall of Fame career span that shares no season with a career AFLDB records in full is now treated as a contradiction — Bill Walker of Swan Districts (1961-1976) is no longer offered against Bill Walker of Fitzroy (1903-1914). Verified against all 228 confirmed Hall of Fame links with a stated span before being trusted: none would be contradicted, and it now flags 16 live queue rows.
- Draft records appear once per `draft_person` rather than once per pick, so one person named in several drafts is one decision rather than several near-identical rows.

### Dynamic Column Sorting for Statistical Tables - 22 August 2026

- Implemented standard dynamic column sorting across all primary application data tables (`AFLDB-ISSUE-XYZ`).
- Created a `SortableTable` component for client-side sorting of bounded record sets, and a `RouteSortHeader` component for scalable server-side table sorting using URL search parameters (`?sort=...&dir=...`).
- Audited the entire application routing tree to apply sorting strictly where semantically meaningful. 
- Integrated numeric, text, and date sorting with stable, deterministic behaviour, ensuring unrecorded values (`NULL`) remain anchored to the bottom.
- Applied client-side sorting to `/awards`, `/brownlow`, `/clubs`, `/hall-of-fame`, `/matches/[id]`, `/players/[slug]`, `/records`, and select admin dashboards (`/admin/access`, `/admin/admins`, `/admin/db-health`, `/admin/nl-search`).
- Applied URL-driven server-side sorting to paginated/live datasets: `/draft/[year]`, `/players/[slug]/matches`, and draft listings in the data editor (`/admin/data-editor`).
- Deliberately excluded structural/chronological layouts, such as Match Lineups, Search Results, Gridley, and specific workflow queues, preserving their innate semantic ordering.
- Resolved a column-alignment regression where sortable headers stretched (`width: 100%`) and ignored standard CSS `text-align`, and corrected column-header mapping on the `/draft/[year]` page.

### Required Mutation Audits Commit Atomically - 22 August 2026

- Every required statistical-mutation audit now commits inside the same import-role transaction as the mutation it records, so a mutation can no longer exist without its audit row and an audit failure rolls the whole mutation back (`AFLDB-ISSUE-027`). Migration 066 grants `afldb_import` INSERT-only on `data_edits` and `player_link_resolutions` (plus sequence USAGE), mirrored in the privileges reconciler; both audit tables stay append-only and outside the full-DML import registry. A shared `recordDataEdit` helper replaces the eight post-commit `authSql` audit writes across the data editor, match sheet, match creation/deletion, awards/Hall of Fame/honour-team creation, and player creation; player-link resolutions likewise audit inside the link transaction.
- Removed the now-unreachable "saved, but its audit snapshot failed — do not submit it again" success-with-warning states from the admin actions and forms; a required-audit failure now surfaces as a plain error with nothing committed. The intentionally best-effort administrative activity audit (`auth_audit_log`) and its warning are unchanged.
- Deployment note: migration 066 and `npm run db:privileges` must be applied before the new code serves traffic, or admin mutations fail closed on the audit insert.

### Match Mutations Refresh Stored Season Ladders - 22 August 2026

- Match creation, deletion, and score corrections now rebuild the affected season's stored `club_seasons` ladder rows inside the same import transaction, via a new targeted `recomputeClubSeasons` helper kept in lockstep with the canonical full rebuild in `tools/migration/rebuild_derived.py` (`AFLDB-ISSUE-015`). Ladder tallies remain sourced from the published `staging.team_seasons` ladder; only the match-derived premiership flag, finals count, and completion-gated wooden spoon are recomputed from match facts.
- The targeted rebuild fails closed: a season with no canonical staging ladder rows raises an error before any stored ladder row is deleted, rolling back the surrounding match mutation instead of silently emptying the ladder.

### Natural-Language Search Record Phrasing - 21 August 2026

- Fixed NL record/leader phrasing so `Grand Final record for goals` and `career goal leader against Collingwood` parse through the supported player-stat paths instead of declining as unsupported terms, while preserving the career-finals reading of `most finals played` (`AFLDB-ISSUE-062`). Parser version 23 records the outcome change, with focused parser regressions for Grand Final record variants and the finals collision guard.
- Fixed NL `record holder` phrasing so `record holder for goals against Collingwood` is consumed as the same max-record cue as `leader`, with parser version 24 and focused parser coverage (`AFLDB-ISSUE-064`).
- Fixed malformed NL career-condition wording so `players with most 10 games` declines instead of being accepted as a threshold condition, while preserving `at most 10 games` and `most games`; parser version 25 and focused regression coverage record the outcome change (`AFLDB-ISSUE-066`).
- Changed valid zero-result NL plans to render their existing no-match answer text instead of returning no NL panel, so self-opponent/impossible scopes such as `Dustin Martin most handballs against Richmond` explain the empty result while still logging `no_results` (`AFLDB-ISSUE-063`).
- Fixed the expanded NL UI corpus generator so metric labels that are already plural, such as `goals`, `marks`, and `handballs`, are not emitted as malformed `goalss`/`markss`/`handballss` questions; added generator regression coverage and regenerated the affected 501-row audit corpus (`AFLDB-ISSUE-067`).
- Recorded an open UI/runtime defect for intermittent React #418 hydration errors captured during NL UI sweeps, with failing server HTML, hydrated DOM, screenshots, console logs, clean controls, and exact replay queries preserved separately from NL semantic metrics (`AFLDB-ISSUE-068`).
- Corrected the expanded NL UI corpus oracle for `debut season` wording so it remains an unsupported/deferred scope rather than being expected to parse as the already-supported `on debut` game boundary (`AFLDB-ISSUE-069`).
- Recorded the live parser-v24 12,000-question `/search` UI audit classification: all rows observed with no HTTP/page/timeouts or malformed-answer detections; remaining scored failures classify as data-coverage limitations or stale corpus policy/oracles, with the separate hydration defect still open (`AFLDB-ISSUE-070`).
- Recorded the parser-v25 full V2 stress classification: verified football-answer rows and safe-decline rows passed completely, metamorphic groups stayed consistent, and residual findings were separated into stale/generated oracle-policy clusters, historical coverage expectations, wrong-decline-reason expectations, and numeric-condition oracle follow-up (`AFLDB-ISSUE-071`).
- Disabled eager Next.js prefetch on the persistent primary and mobile navigation links after React #418 captures showed `/search` hydration racing a burst of cross-worker RSC nav prefetches under varied parallel UI load (`AFLDB-ISSUE-068`).
- Expanded the NL UI Playwright stress harness to capture per-row and per-incident hydration forensics: previous/current answer shape, document-start/DOMContentLoaded/hydration-error/final DOM snapshots, structural fingerprints for the `/search` tree, SearchBox, and NL feedback form, first observed DOM mutation records, structured client-error timing, `_rsc` request start/finish order, RSC path/link class, traced worker/PID/build headers, same-query clean-control evidence, reduced transition corpora, and summary clustering for the remaining React #418 investigation (`AFLDB-ISSUE-068`).
- Moved the natural-language answer feedback Server Action form back to a Server Component boundary while keeping reveal/dismiss/pending controls client-side, after parallel `/search` hydration forensics isolated React #418 failures to feedback-present answer states; added focused feedback-boundary regression coverage (`AFLDB-ISSUE-068`).
- Rewrote live-only player-season NL metric leaderboards to pre-aggregate match stats once by player and season before ranking, fixing broad `inside 50s`/`rebound 50s`/`clearances`/`contested possessions` season queries that previously hit the statement timeout; added guarded integration coverage for the broad live-only season path (`AFLDB-ISSUE-065`).

### External Current-Season Data Sources - 20 August 2026

- Added Squiggle and Kali AFL Stats as provenance-tracked external sources for current-season match reconciliation (`AFLDB-ISSUE-060`).
- Added migration `063_external_current_match_sources.sql`, creating `staging.external_current_matches` so external API payloads are snapshotted before any local fact table is touched.
- Added migration `064_matches_external_provenance.sql`, adding match-row provenance for externally inserted current-season results.
- Added `npm run current-season:update`, which defaults to dry-run, can stage Squiggle or Kali current-season match rows, inserts missing completed matches only with `--apply --insert-missing-matches`, and updates existing completed match scores only when `--apply --update-matches` is explicitly supplied and the AFLDB match resolves unambiguously.
- Added `--report` for staged resolution counts and handled Squiggle's 2024+ Opening Round numbering (`R0`) against AFLDB's local convention that counts Opening Round as round `1`.
- Added source-name normalisation for current-season feeds so Kali's `Brisbane` rows resolve to AFLDB's active `Brisbane Lions` club identity.
- Kali match rows now parse human-readable dates such as `Friday, 14th August 2026` and infer `complete_percent = 100` only when both scores are present and the match date is not in the future, because Kali's match payload may carry final scores without a Squiggle-style completion field.
- Added a super-admin-only `/admin/current-season` refresh screen that calls the same server-side importer as the CLI, reads external API credentials from the environment, stages API rows automatically from Kali by default, and leaves existing final-score overwrites behind an explicit manual option (`AFLDB-ISSUE-061`).
- Documented `AFLDB_EXTERNAL_API_USER_AGENT`, `KALI_AFL_API_KEY`, and optional `KALI_AFL_API_BASE_URL`; credentials remain environment-only.
- Added source-contract tests for secret handling, server-side API usage, staging-first writes, opt-in match updates, and provenance stamping.

### Natural-Language Search Semantic Audit — 20 August 2026

- Corrected numbered-round plans so `Round N` is stored in the match scope consumed by SQL, defaults to home-and-away when no other match type is named, and elects a single-game player ranking instead of a scoped career sum (`AFLDB-ISSUE-047`). Parser versions 17-21 record this and the other audit behaviour changes separately.
- Reworked team quarter/half scoring around the schema's cumulative checkpoints: Q2-Q4 are boundary differences, H1 is half-time, H2 is final minus half-time, and missing checkpoints stay `NULL` (`AFLDB-ISSUE-048`).
- Replaced the broken HAVING-to-match fallback with organization-level grouped result rows and a dedicated compiler, description and UI table. Per-match win/loss margin filters now apply before grouped count thresholds, including `5 losses by more than 100 points` (`AFLDB-ISSUE-049`).
- Tightened plan validation so optional period, grouped, streak, margin-filter and debut fields are accepted only on compiler paths that consume them. Player-quarter requests now decline explicitly until authoritative quarter-player coverage is actually populated (`AFLDB-ISSUE-050`).
- Made answer prose grain-aware: team answers no longer use player tie wording, grouped lists cannot render a blank metric label, streak payloads have real headlines, and incompatible plan/payload combinations fail closed (`AFLDB-ISSUE-051`).
- Added narrow deterministic coverage for `winning strea`, `blowout win`, a club's superlative bare `margin`, and `on debut`, with collision coverage and a first-career-game SQL predicate (`AFLDB-ISSUE-052`).
- Computed team streak islands by club organization rather than historical club identity, preserving lineage across renames while keeping merger organizations separate (`AFLDB-ISSUE-053`).
- Added exact matchup scope for clean `A v B` NL queries so `Fitzroy v Richmond` ranks every player in the match while bare `v Richmond` remains opponent-scoped (`AFLDB-ISSUE-055`).
- Added checkpoint lead/margin handling for quarter-time, half-time and three-quarter-time wording, including `but won` final-result filtering and `lead` as a team margin synonym (`AFLDB-ISSUE-056`).
- Added a lead match link for single-row player-match NL answers, so the answer always links to the game where the performance occurred (`AFLDB-ISSUE-057`).
- Added plain matchup search handling for `A v B season` and `A v B round N season`, including direct match results and a Match Search link for all meetings (`AFLDB-ISSUE-058`).
- Recorded the remaining grouped-answer drill-down gap for clickable `Qualifying matches` counts (`AFLDB-ISSUE-059`).
- Added a 44-question parser/validation acceptance corpus plus independent database-backed regressions for round scope, debut, grouped result counts, margin-before-HAVING, cumulative period arithmetic, checkpoint margins and organization-lineage streaks.
- Verified the focused audit on the development Linux host: type checking passed and all 562 selected unit and `afldb_test` integration assertions passed before deployment.
- Updated `docs/search.md` to describe all seven current grains, grouped team payloads, cumulative period arithmetic, streak semantics, and the explicit player-quarter coverage decline.

### AFLPA 22 Under 22 Awards History — 20 August 2026

- Added the canonical 2012–2026 annual 22 Under 22 extract (330 selections, exactly 22 per season), preserving position, source club, captain and vice-captain markers. The supplied most-selections summary is intentionally excluded because those totals are derived from the annual teams and the file contains known omissions (`AFLDB-ISSUE-042`).
- Added migration `060_wikipedia_22_under_22_source.sql` and a dedicated `wikipedia_22under22` source so every imported selection carries source-record and import-batch provenance.
- Added a scoped `under_22` group to `tools/migration/import_awards.py`. It can run without the legacy SQLite database, upserts only its own award and rows, preserves deliberate manual player resolutions, and remains intact across legacy full awards reloads.
- Player links now require an exact canonical name or recorded alias plus corroborating match history for the source club and season. Ambiguous, unmatched and implausible candidates remain unlinked with their raw source names instead of being guessed.
- Added migration `061_award_winner_sort_order.sql`; the existing seasonal honour-team Awards UI now exposes `22 Under 22 Team` automatically after import, including season pages in the supplied formation order, positions, clubs and leadership markers (`AFLDB-ISSUE-045`). Updated deployment/admin guidance and added fail-closed source/import contract coverage.
- Added a linked-row-only **Selected in AFLPA 22Under22 team** Grid Solver criterion and a **22Under22** shortcut in the super-admin player-link queue. Untrusted source rows remain excluded from solver answers until they are resolved through the existing audited numeric-player workflow (`AFLDB-ISSUE-046`).
- Marked the dated migration inventory and first-run report as historical snapshots and pointed operators to the active loader documentation (`AFLDB-ISSUE-043`).
- Documented the pre-existing limitation that older destructive honours loaders do not yet replay later manual identity decisions; the new 22 Under 22 path is protected, while the general repair remains tracked as `AFLDB-ISSUE-044`.

### Admin Mutation Integrity, Identity, and Audit Repair — 20 August 2026

- **Match and player-stat correctness (AFLDB-ISSUE-001–009, 014–022, 029–036, 038, 041)**:
  - Added `src/lib/match-sheet.ts` and `src/lib/admin-match.ts` as shared server-boundary validators for match-sheet JSON, bounded statistics, exact Brownlow 3-2-1 allocations, new-match scores, attendance, and period totals.
  - Added `src/db/queries/player-derived.ts` as the single targeted rebuild path for career game numbers, club stints, club-season/player-season/career totals, nullable era statistics, career spans, search rank, season metadata, and season-wide Brownlow coverage.
  - Refactored match-sheet save and match deletion into supported one-command postgres.js queries, corrected match-FK deletion ordering, removed nonexistent coverage relations, and stopped all writes to authoritative `brownlow_season_votes` and independently sourced `brownlow_round_votes`.
  - Removed player-stat-to-team-score synchronization because rushed behinds are not attributable to players. Match Details remains the explicit official-score editor and now transactionally refreshes the final cumulative period, match outcome, season metadata, and affected player summaries.
  - Made score synchronization fail closed at the query boundary, made it permanently off in the UI, and documented the attribution limitation beside the match sheet.
  - Match creation now rejects duplicate natural keys, validates season-active club identities, requires finite consistent score inputs, cites `manual_admin_edit` for recorded attendance (including zero), and refreshes season metadata and coverage.
  - Match deletion now safely handles first/last-match foreign keys, zero-game players, empty latest seasons, and all affected derived player surfaces.
  - Previous-lineup prefill is now strictly relative to the edited match, and replacing a prefilled team correctly records dropped players for removal.
  - Removing a copied-lineup player now leaves an inline `+ Add replacement` slot in the same row and locks the replacement to the correct club. Multiple substitutions can be filled consecutively, while general player additions are now explicit per-team controls instead of a sticky shared Home/Away selector (`AFLDB-ISSUE-041`).
  - Official Match Details score edits now use a sparse-safe final-period policy (period four unless explicit extra time exists). `club_seasons` remains explicitly flagged for source reconciliation because the canonical ladder is source-derived and season-rule dependent.

- **Player, draft, and link identity integrity (AFLDB-ISSUE-007–008, 012–013, 018–020, 027–028)**:
  - Player creation and link resolution require `AFLDB_IMPORT_DATABASE_URL`; the application read URL is no longer a write fallback.
  - Optional draft history now requires an explicit 1981–2100 year and a club identity active in that season; no DOB or wall-clock year is invented.
  - Zero-game profiles preserve `NULL` for never-recorded era statistics while keeping recorded-game counts and always-recorded totals at zero.
  - Draft resolution follows only the durable numeric `draft_person_id`, propagates to picks for that exact identity, and no longer fans out by raw name.
  - “Create & link” now locks/rechecks the unresolved target and creates the player plus link in one import transaction, preventing stale-form orphan players.
  - Player-link audit failures now return visible success-with-warning results that explicitly say not to retry, and dynamic public link consumers are revalidated.

- **Awards and honours integrity (AFLDB-ISSUE-010–011, 019, 023–025, 027–028, 037)**:
  - Manual award winners now use the `manual_admin_edit` source with unique UUID-backed source record IDs.
  - Brownlow is excluded from the generic awards form and rejected in the lower helper because `brownlow_season_votes` is authoritative.
  - Club best-and-fairest winners derive their required historical club identity from the award definition; all optional award club contexts are season validated.
  - Added migration `058_data_edits_editor_entities.sql` to allow audit snapshots for every registered editor entity.
  - Added migration `059_honour_team_member_identity.sql` to replace name-only honour-team uniqueness with separate linked-player and unlinked-name partial unique indexes.
  - Hall of Fame categories/years, Legend years, award vote/stat values, and honour-team ordering now have action- and query-boundary validation rather than browser-only constraints.
  - Award, Hall of Fame, and honour-team audit failures are shown as committed-with-warning states and their forms invalidate affected dynamic public pages.

- **Workflow, cache, and audit safety (AFLDB-ISSUE-026–028)**:
  - Submission rejection is now a conditional compare-and-set transition with `RETURNING`; stale or missing rows cannot be reported or audited as successfully rejected.
  - Added dynamic path invalidation for player, match, season, club, record, award, Hall of Fame, honour-team, and draft consumers after their corresponding mutations.
  - Statistical writes that still require a separate-role audit now preserve the successful result and display a do-not-retry warning on audit failure. The remaining cross-role atomicity limitation is documented as open in `issues.md`.

- **Validation and maintenance (AFLDB-ISSUE-039)**:
  - Added focused regression suites for match input, match mutations, match-sheet semantics, lineup substitution state, awards/honours, draft/player links, and submission rejection.
  - Renamed `vitest.config.ts` to `vitest.config.mts` so its existing ESM syntax loads without Vite's CommonJS compatibility warning.
  - Created and maintained `issues.md` as the defect ledger: 38 repaired defects are marked resolved and three policy/architecture/tooling limitations remain open.

### Interactive Match Browser with Season & Club Filters — 20 August 2026

- **Comprehensive Match Browser in Data Editor (`/admin/data-editor`)**:
  - `src/db/queries/match-admin.ts`: Created `searchAdminMatches` with parameterized filtering across seasons, clubs, round numbers, and text queries, returning match details alongside player lineup counts (`playerCount`).
  - `src/app/admin/data-editor/MatchBrowser.tsx`: Built an interactive match browser component featuring:
    - Default view displaying recent matches with scores, venues, and lineup statuses.
    - Quick season jump chips (`2026`, `2025`, `2024`, `2023`).
    - Filter controls for Season (dropdown), Club (dropdown), Round # (number input), and Team/Venue Search.
    - Direct action buttons on each match row: **`📋 Match sheet`** (instant player stats editor), **`Edit details`** (scores/venue editor), and public match link.
  - `src/app/admin/data-editor/page.tsx`: Embedded `MatchBrowser` replacing the plain numeric season input.

### Quick Lineup Pre-Fill & Player Stats Entry Workflow — 20 August 2026

- **1-Click Roster Pre-Fill & Live Match Sheet Stats**:
  - `src/db/queries/matches.ts`: Added `getRecentClubLineup` to fetch the previous match lineup (players, names, and jumper numbers) for any club in the competition.
  - `src/app/admin/data-editor/page.tsx`: Loaded previous club lineups for both home and away teams when viewing the match sheet editor.
  - `src/app/admin/data-editor/MatchSheetEditor.tsx`: Added quick lineup helper buttons to instantly pre-fill all 23 players for home and away clubs with their jumper numbers, while retaining full individual player addition/removal (`PlayerPicker`, `✕` button) and live tabular stat entry (kicks, handballs, disposals, marks, goals, behinds, tackles, hitouts, frees, and Brownlow 3-2-1 votes).

### Fix Attendance Status Coverage Constraint on Match Creation — 20 August 2026

- **Attendance Status & Score Reconciliation in Match Creation**:
  - `src/db/queries/match-admin.ts`: Added `attendance_status` (`'complete'::coverage_status` when crowd attendance is provided, `'not_collected'::coverage_status` when absent) to satisfy the non-null `matches_attendance_status_ck` constraint in PostgreSQL migration 020. Also enforced strict score component reconciliation (`homeScore = 6*G + B`) to adhere to `matches_score_components_ck`.

### Super Admin Database Editing Security Governance — 20 August 2026

- **Strict Super Admin Access Enforcement**:
  - Confirmed and verified that all direct database editing tools, forms, and server actions are restricted exclusively to `super_admin` sessions via `requireSuperAdmin()`:
    - **Data Editor & Forms**: Match creation, Match Sheet Lineup & Stats Editor, Player Creation & Bio Details, Award Winners, Hall of Fame Inductees, Honour & Representative Teams, and Data Edits (`/admin/data-editor`).
    - **Entity Link Resolutions**: Resolving and linking unlinked player identities in draft and historical records (`/admin/player-links`).
    - **Data QA Search & Query Execution**: Raw SQL QA query builder (`/admin/query-builder`).
    - **Ingest Pipeline Decisions**: Elevated `decideSubmission` (approval/rejection) and `runPromotion` (applying ingested CSV data into production database) in `src/app/admin/submissions/[id]/actions.ts` from `requireAdmin` to `requireSuperAdmin()`.
    - **Navigation Visibility**: The admin sidebar model in `src/app/admin/nav-model.ts` hides all database editing links from regular `admin` and `contributor` accounts.

### Fix Seasons Generated Column in Match Creation — 20 August 2026

- **Fix Seasons Table Insert in Match Creation**:
  - `src/db/queries/match-admin.ts`: Updated `createMatch` to insert `status = 'in_progress'::season_status` into `seasons` instead of `is_complete`, resolving PostgreSQL error `cannot insert a non-DEFAULT value into column "is_complete"` (`is_complete` is a generated stored column mirroring `status = 'complete'`).

### Safe Match Deletion & Automatic Player Statistics Rollback — 20 August 2026

- **Transactional Match Deletion & Derived Stats Recomputation**:
  - `src/db/queries/match-admin.ts`: Created `deleteMatch` query helper to safely remove a match, its lineups (`player_match_stats`), period scores (`match_period_scores`), and any match achievements (`player_achievements`) using the `afldb_import` pool.
  - `src/db/queries/match-admin.ts`: Automatically recalculates `player_career_stats` and `player_season_stats` for all affected players across all statistics (games, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, Brownlow votes, best game records, debut/last match dates). If a player now has 0 remaining matches, a clean zero-game record is preserved so their biography remains intact.
  - `src/app/admin/data-editor/DeleteMatchButton.tsx`: Created interactive super admin button with warning dialog and reason prompt for safely deleting test or invalid matches.
  - `src/app/admin/data-editor/actions.ts`: Added `deleteMatchAction` with audit logging in `data_edits` and path revalidations.
  - `src/app/admin/data-editor/MatchSheetEditor.tsx` & `src/app/admin/data-editor/EditorForm.tsx`: Embedded `DeleteMatchButton` directly in the Match Sheet Editor and Match Detail Editor interfaces.

### Super Admin Match Creation, Grounds & Live Stats Workflow — 20 August 2026

- **Super Admin Match Creation GUI (`/admin/data-editor` → "+ Add new match")**:
  - `src/db/queries/match-admin.ts`: Created `createMatch` query layer to transactionally insert new match records and quarter scores (`match_period_scores`) into PostgreSQL using the `afldb_import` pool credentials. Automatically derives match result (`home_win`, `away_win`, `draw`), winner club, margin, is_final status, round codes, and stable natural match keys. Logs audit records to `data_edits`.
  - `src/app/admin/data-editor/CreateMatchForm.tsx`: Built interactive super admin GUI component for creating matches:
    - **Match Information**: Season, Round Type (Regular Season, Qualifying Final, Elimination Final, Semi Final, Preliminary Final, Grand Final), Round Number, Match Date, Start Time, Grounds/Venue dropdown selection (`listVenues`), Attendance (crowd), and Notes.
    - **Clubs & Scores**: Home & Away club selectors, real-time score calculation (`Goals * 6 + Behinds`).
    - **Quarter Breakdown**: Collapsible Q1, Q2, Q3, Q4 goals, behinds, and points inputs for both clubs.
    - **Seamless Workflow**: Direct submission transitions immediately into the **Match Sheet Editor** (`/admin/data-editor?mode=match-sheet&id=${id}`) to populate Home & Away 23-player lineups, in-game stats (goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, frees for/against, jumper numbers), and allocate 3-2-1 Brownlow votes.
  - `src/app/admin/data-editor/actions.ts`: Added `createMatchAction` with input validation, `data_edits` audit logging, and cache revalidations across `/matches`, `/matches/[id]`, `/seasons/[year]`, and `/admin/data-editor`.
  - `src/app/admin/data-editor/page.tsx`: Embedded `CreateMatchForm` into the Matches management section.

### Player Search & Listing Improvements for Listed / Un-debuted Players — 20 August 2026

- **Search & Listing Visibility for Listed / Un-debuted Players**:
  - `src/db/queries/search.ts`: Switched `searchPlayers` from `JOIN` to `LEFT JOIN player_career_stats` and set subtitle to `'Listed player (yet to debut)'` (or club name + `'Listed player'`) when `debut_season` is null. Enables newly created players or un-debuted draftees (e.g. Fred Rodriguez, Riley Onley) to be immediately discoverable in sitewide search, autocomplete, and `PlayerPicker`.
  - `src/db/queries/players.ts`: Switched `listPlayers` to `LEFT JOIN player_career_stats` with `COALESCE` on numeric totals to ensure players with 0 career games render properly in player directories and filter queries.
  - `src/db/queries/player-links.ts`: Updated `resolveLink` to ensure dual resolution across `draft_picks` and `draft_persons` matching by person ID or raw name.

### Draft & Recruitment Info on Player Creation, and Awards & Representative Teams Admin — 20 August 2026

- **Draft & Recruitment Selection during Player Profile Creation**:
  - `src/db/queries/players.ts`: Extended `CreatePlayerInput` and `createPlayer` to accept `draftInfo` (`recruitedFrom`, `draftYear`, `draftType`, `pickNumber`, `clubId`, `draftAge`, `pickNote`, `detail`). Automatically creates a linked `draft_picks` record with status `resolved` and associated `draft_persons` entry inside the creation transaction.
  - `src/app/admin/data-editor/CreatePlayerForm.tsx`: Added collapsible "Draft & recruitment details" section to the player creation form with inputs for junior/origin club, draft year, draft type (National, Rookie, Pre-Season, Mid-Season, Father-Son, Category B Rookie), pick number, drafted club selector, draft age, and pick note.
  - `src/app/admin/data-editor/actions.ts`: Updated `createPlayerAction` to parse and validate draft & recruitment fields and trigger path revalidations for `/draft`.
- **Super Admin Awards, Hall of Fame & Representative Teams Management**:
  - `src/db/queries/awards-admin.ts`: Created admin mutation layer with `createAwardWinner`, `createHallOfFameInductee`, and `createHonourTeamMember` running with `afldb_import` pool credentials and logging audit snapshots to `data_edits`.
  - `src/app/admin/data-editor/AwardWinnerForm.tsx`: Created GUI component allowing super admins to record award winners (Brownlow, Coleman, Rising Star, Norm Smith, All-Australian, Club Best & Fairest, AFLCA/AFLPA) with player lookup via `PlayerPicker`, season, club, votes/stats, position, captaincy, and citations.
  - `src/app/admin/data-editor/HallOfFameForm.tsx`: Created GUI component allowing super admins to record Australian Football Hall of Fame inductees with player links, categories (Player, Coach, Umpire, Media, Admin, Pioneer), induction year, Legend elevation status, state, and career summary.
  - `src/app/admin/data-editor/HonourTeamForm.tsx`: Created GUI component allowing super admins to add members to representative and honour teams (Teams of the Century, State of Origin, Indigenous / Multicultural teams) with player links, positions, roles (Captain, Coach), and lineup sort order.
  - `src/app/admin/data-editor/actions.ts`: Added `createAwardWinnerAction`, `createHallOfFameAction`, and `createHonourTeamMemberAction` with validation and revalidations across public awards, Hall of Fame, honour teams, and player profiles.
  - `src/app/admin/data-editor/page.tsx`: Embedded the new Awards & Honour Teams management section directly in the Data Editor GUI.

### Super Admin Match Sheet Editor & Live In-Game Player Stats Management — 20 August 2026

- **Interactive Super Admin Match Sheet & Lineup Editor**:
  - `src/db/queries/match-sheet.ts`: Created `saveMatchSheet` to perform transactional upserts of `player_match_stats` for all players in a match using `afldb_import` pool credentials. Supports player additions, deletions, jumper numbers, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, frees for/against, and Brownlow votes.
  - `src/db/queries/match-sheet.ts`: Added automated real-time recomputation of derived `player_career_stats` (games, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts, best game records, debut/last match dates) and `player_season_stats` for all affected players directly in SQL upon saving.
  - `src/db/queries/match-sheet.ts`: Added optional automated synchronization of match final scores, result, winner club, and margin on `matches` derived from player goals and behinds.
  - `src/app/admin/data-editor/MatchSheetEditor.tsx`: Created a full-featured client editor with team-by-team rosters (Home & Away), live team aggregate totals (score, disposals, marks, tackles), player removal, "+ Add player to lineup" search with `PlayerPicker`, and score synchronization toggle.
  - `src/app/admin/data-editor/actions.ts`: Added `saveMatchSheetAction` with payload validation, `data_edits` audit recording, and path revalidations across `/matches/[id]`, `/players/[slug]`, and `/admin/data-editor`.
  - `src/app/admin/data-editor/page.tsx`: Embedded Match Sheet Editor direct ID lookup, "Open match sheet" action buttons on season match lists, and direct launch from Match Details editor.
  - `src/app/admin/data-editor/EditorForm.tsx`: Added an "Open Match Sheet Editor →" action button on match detail edit forms.
  - `src/db/queries/matches.ts`: Expanded `MatchPlayerRow` and `getMatchPlayers` to query `jumper_number`, `frees_for`, and `frees_against`.

### Super Admin Player Creation, Bio Editing & Draft Pick Management — 20 August 2026

- **Super Admin Player Creation & Bio Information Management**:
  - `src/db/queries/players.ts`: Added `createPlayer` helper supporting creation of player profiles with display name, auto-split given/surname, canonical slug, search name normalisation (`afldb_normalise_name`), sort name, date of birth, DOB confidence, height (cm), weight (kg), and biographical notes. Executes via `AFLDB_IMPORT_DATABASE_URL` (`afldb_import` role) to strictly comply with PostgreSQL least-privilege write grants on statistical tables. Initialised empty zero-statistic record in `player_career_stats`.
  - `src/db/queries/players.ts`: Updated `fetchPlayer` to `LEFT JOIN` `player_career_stats` and `COALESCE` all career statistics to `0`, ensuring newly created or listed players who have yet to make their senior match debut load cleanly on `/players/[slug]`. Expanded `PlayerProfile` to include `heightCm`, `weightKg`, `givenName`, `surname`, and `notes`.
  - `src/app/admin/data-editor/CreatePlayerForm.tsx`: Created a new super admin component allowing administrators to create player profiles directly from the Data Editor GUI (`/admin/data-editor`).
  - `src/app/admin/data-editor/actions.ts`: Added `createPlayerAction` with full field validation, audit logging to `data_edits`, and path revalidations.
- **One-Click "Create & Link Player" in Player Links Queue**:
  - `src/app/admin/player-links/ResolveControls.tsx`: Added a dedicated "Create & link new" tab in the resolve drawer. Pre-fills player name from the raw source name and enables administrators to enter DOB, height, weight, and bio notes to create a player profile and link the unlinked record (e.g. rookie draft pick, honours entry) in a single action.
  - `src/app/admin/player-links/ResolvePanel.tsx`: Passed `playerName` and `context` attributes to `ResolveControls`.
  - `src/app/admin/player-links/actions.ts`: Added `createAndLinkPlayer` action linking created players to `draft_picks` (and corresponding `draft_persons` records) or honours records with audit logging.
  - `src/db/queries/player-links.ts`: Updated `resolveLink` to synchronize `draft_persons` when resolving `draft_picks` selections.
- **Draft Picks Management & Search in Data Editor**:
  - `src/lib/edit/spec.ts`: Added `draft_picks` to `EDITABLE_ENTITIES` allowing editing of `player_name_raw`, `original_club_raw`, `height_cm`, `weight_kg`, `draft_age`, `pick_note`, and `detail`.
  - `src/db/queries/data-edits.ts`: Added `draft_picks` row reader in `getEditableRow` and `applyDraftPickEdit` in `applyEdit`.
  - `src/app/admin/data-editor/page.tsx`: Added draft pick ID direct lookup and draft search by player name / year with inline edit links.
  - `tests/edit-spec.test.ts`: Added validation unit test coverage for `draft_picks` fields and integrity checks.
- **Player Profile Display for Listed & Drafted Players**:
  - `src/db/queries/draft.ts`: Added `getPlayerDraftHistory` query fetching all recorded draft selections for a player.
  - `src/app/players/[slug]/page.tsx`: Added height, weight, and bio notes to the Career & Biography table. Added a dedicated "Draft & recruitment" table section displaying draft year, pick, type, drafted club, recruited origin, and draft age. Handled 0-game draftees gracefully with an informative listing banner and refined metadata description sentence.

### Dynamic Search Box Placeholders, Fillout Animations & Coming-Soon Polish — 20 August 2026

- **Dynamic Rotating Search Placeholders & Animations for AFL & AFLW**:
  - `src/lib/site-settings.ts`: Added setting keys `searchPlaceholdersAfl`, `searchPlaceholdersAflw`, `searchPlaceholderInterval`, and `searchPlaceholderAnimation`. Added default sample queries for AFL and AFLW, interval parser (2–60s), and animation type parser (`typewriter` | `fade` | `slide` | `none`).
  - `src/components/SearchBox.tsx`: Added dynamic placeholder rotator supporting configurable placeholder lists, rotation intervals, and four animation fillout modes (`typewriter` typing/backspacing, `fade`, `slide`, `none`). Pauses animation cleanly on input focus and user entry.
  - `src/app/page.tsx`, `src/app/aflw/page.tsx`, `src/app/search/page.tsx`: Integrated dynamic search placeholders and animation settings across AFL home, AFLW home, and global search pages.
- **Super Admin Search Box Settings & Interactive Live Preview**:
  - `src/app/admin/settings/SearchPlaceholderSettings.tsx`: Created dedicated admin settings component allowing super administrators to configure AFL sample queries, AFLW sample queries, rotation interval (seconds), and placeholder animation styles. Included an interactive live animation preview box simulating AFL and AFLW placeholder cycling in real time.
  - `src/app/admin/settings/SettingsForm.tsx`: Embedded `SearchPlaceholderSettings` into the main settings form.
  - `src/app/admin/settings/actions.ts`: Added atomic saving of search placeholder settings with audit logging and page revalidations (`/`, `/aflw`, `/search`, `/admin/settings`).
  - `tests/site-settings.test.ts`: Added unit tests for search placeholder parsing, interval clamping, and animation mode validation.
- **Coming Soon Page Text & Media Polish**:
  - `deploy/coming-soon/index.html`: Refreshed feature texts, descriptions, and image alt captions for players, seasons/ladders, search, and honours/Brownlow medal history.
  - `src/lib/site-content.ts`: Updated `DEFAULT_APEX_CONTENT` to mirror the refined copy and alt text descriptions for the apex coming-soon page.
  - `deploy/coming-soon/style.css`: Added smooth image hover elevation transitions (`transform`, `box-shadow`, `border-color`) and subtle card polish.

### Non-AFL Club Unmatched Filtering & Admin Player Links Search — 20 August 2026

- **Non-AFL Club Unmatched Badge Filtering on Public UI**:
  - `src/lib/format.ts`: Added `isNonAflClub` and `shouldShowUnmatched` helpers recognizing state-league, regional, and non-VFL/AFL clubs (such as West Perth, West Adelaide, North Adelaide, Norwood, Sturt, East Brunswick Scorpions (VWFL), St Albans Spurs (VWFL), TFL, NTFL, etc.).
  - `src/app/hall-of-fame/page.tsx`, `src/app/honour-teams/[slug]/page.tsx`, `src/app/awards/[slug]/page.tsx`, `src/app/awards/[slug]/[season]/page.tsx`, `src/app/seasons/[year]/page.tsx`: Suppressed `<UnmatchedPlayer>` reader suggestion badges across all public frontend tables for footballers who played exclusively for non-VFL/AFL clubs, as AFLDB contains complete historical VFL/AFL/AFLW player records and these players will not have AFLDB player profiles.
- **Super Admin Name and Context Search in Player Links**:
  - `src/app/admin/player-links/page.tsx`: Added search input form and server-side filtering on `q` allowing super administrators to search unresolved records by player name or context across any table or across all tables. Maintained pagination, table filters, clear action, and empty query state.
  - Retained all unresolved non-AFL records in `/admin/player-links` so super administrators retain full review and resolution capabilities.

### AFLW Players in Hall of Fame & Non-Player Categories — 20 August 2026

- **AFLW player linking and club labeling**:
  - `src/db/queries/awards.ts`: Updated `HallOfFameRow`, `listHallOfFame`, and `getHallOfFameInductees` to left-join `aflw.players` and expose `aflwPlayerSlug` for AFLW inductees (e.g. Daisy Pearce, Erin Phillips).
  - `src/lib/format.ts`: Added `formatHallOfFameClub` to automatically append `(AFLW)` to the club column for AFLW inductees (e.g. `Melbourne (AFLW)`, `Adelaide, Port Adelaide (AFLW)`), while formatting non-player categories cleanly as `—`.
  - `src/app/hall-of-fame/page.tsx`: Linked AFLW inductees directly to their AFLW player profiles (`/aflw/players/[slug]`) across Legends and All Inductees tables, updated the stats strip to include AFLW players in "With an AFLDB record", and formatted club names with `(AFLW)`.
  - `src/app/seasons/[year]/page.tsx`: Linked AFLW inductees to their AFLW player pages in season Hall of Fame overviews and suppressed `<UnmatchedPlayer>` tags.
  - `src/db/queries/player-links.ts`: Excluded AFLW-matched Hall of Fame inductees from the unresolved men's player linking queue.
- **Hall of Fame non-player category presentation**:
  - `src/lib/format.ts`: Added `NON_PLAYER_HOF_CATEGORIES` and `isNonPlayerHallOfFameCategory` helper recognizing Media, Umpire, Administrator, and Pioneer categories.
  - `src/app/hall-of-fame/page.tsx`: For inductees in non-player categories, removed the `<UnmatchedPlayer>` tag and misleading "no playing record" tooltip. Displayed `—` (dash) for their Club column.
  - `src/app/seasons/[year]/page.tsx`: Suppressed `<UnmatchedPlayer>` tags for Hall of Fame inductees in non-player categories.
  - `src/db/queries/player-links.ts`: Filtered out non-player categories from the unresolved player links queue in `listUnresolvedLinks`.

### Security & Architecture Audit Remediation — 20 August 2026

Detailed remediation of findings identified during the full-stack architecture and security code review:

- **Runtime enforcement of `AFLDB_MAX_PAGE_SIZE` and `AFLDB_MAX_FILTERS`**:
  - `src/search/constants.ts`: Updated `MAX_PAGE_SIZE` to dynamically read `process.env.AFLDB_MAX_PAGE_SIZE` if set and positive, with a safe fallback to 100.
  - `src/search/advanced-spec.ts`: Updated `LIMITS.maxFilters` to dynamically read `process.env.AFLDB_MAX_FILTERS` if set and positive, with a safe fallback to 20; linked `LIMITS.maxPageSize` to `MAX_PAGE_SIZE`.
  - `src/lib/params.ts`: Updated documentation and parameter clamping to ensure URL parsing strictly honors configured limits.
- **Production Reverse Proxy & CSP Hardening**:
  - `deploy/Caddyfile.production`: Added `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`) and `Content-Security-Policy` to the `beta.afldb.com` reverse proxy block so that edge responses and proxy-generated error pages (such as 502/504 during restarts) enforce strict transport security and script boundaries.
  - `next.config.ts`: Documented build-time header evaluation requirements for `AFLDB_ENV=production`.
- **Standalone Build Environment Verification**:
  - `tools/build/prepare-standalone.mjs`: Added build-time verification logging `AFLDB_ENV` status so operators are notified whether standalone headers are being compiled for production or development.
- **SQL Query Parameterization Hardening**:
  - `src/db/queries/player-links.ts`: Replaced `sql.unsafe` array string concatenation in `listUnresolvedLinks` with native postgres.js array parameterization (`= ANY(${statusValues})`).
- **Dependency Version Pinning**:
  - `package.json`: Locked core runtime and dev dependencies to exact versions (removing `^` semver ranges) to guarantee reproducible, audit-locked builds.

### Fixed — 19 August 2026
- **Player links now appear on public pages immediately.** Linking a
  player in `/admin/player-links` (or vetting a row as genuinely
  unlinked) only revalidated the admin queue; the public pages that
  render those names — awards, clubs, honour teams, seasons — are
  statically generated with up to a 24-hour window, so a freshly linked
  Team of the Century member (Ted Whitten, Ron Barassi) vanished from
  the queue but kept showing as unmatched on the honour-team page for up
  to a day. Both actions now revalidate the whole public family.

### Birth-date enrichment from all-time club lists — 19 August 2026

DOB coverage rose from 12,472 to 13,356 of 13,361 players (100.0%) on the
dev database. The five clubs missing from the legacy club register —
Fitzroy (759 gaps), University (82), Brisbane Bears (44), Sydney/South
Melbourne (3) and North Melbourne (1) — had their AFL Tables all-time
player list pages captured as CSVs; a new pass
(`tools/migration/enrich_birth_dates_from_club_lists.py`) matches them by
name within each club's roster, corroborated by games/goals/seasons, and
fills only missing dates. 3,944 rows agreed with existing data, one
conflict (a 2-day discrepancy on an 1868 date) was flagged as a
data_issue rather than overwritten, and the 5 players still without a
date are blank in the source as well. Same-name pairs (two Fitzroy Tom
Meehans, two Sydney John Fogartys) disambiguate on exact games-at-club
with goals and span as non-blocking vetoes. Not yet run against prod.

### Grid solver: rivalries, marquee matches and more — 19 August 2026

Seven new builders (the catalogue is now 107 across 11 categories),
widening what a board can ask based on data already in the schema.

#### Added
- **Rivalries & marquee matches**, a new category. `match_event_played` /
  `match_event_min` read `matches.match_event`, whose complete tagged
  vocabulary is Anzac Day, Dreamtime at the 'G and King's Birthday.
  `matchup_played_min` ("X+ matches between two clubs") takes the two
  organizations as parameters, so any derby — Showdown, Western Derby,
  QClash — is expressible without a derby definition existing in the
  schema. Good Friday and Easter Monday fixtures are not tagged in the
  source data and are reachable only as a matchup.
- **`never_played_in_draw`** — the negation sibling of
  `drawn_matches_min`, following the `never_played_finals` pattern.
- **`debuted_in_decade`** — one-parameter convenience over
  `debuted_between`, matching `played_in_decade`'s shape.
- **`venue_stat_total_min`** ("X+ of a stat at venue, career") — the
  aggregated sibling of `venue_game_stat_min`, so "100+ goals at the MCG"
  is now askable.
- **`venue_goals_max`** ("X or fewer goals at venue, having played
  there") — goals only, because it is the one statistic recorded for
  every player-game; a career max over an era-limited stat would silently
  count unrecorded games as zero.
- **Natural-language wiring (parser v15).** "played on anzac day" /
  "3+ anzac day games", "played in 3 showdowns" (also western derby,
  qclash, sydney derby — organizations resolved through the club
  directory at parse time), and "debuted in the 1990s" / "debuted
  between 2000 and 2009" all compile to the new builders as
  `careerPredicates`. Guard rails: a superlative governing the phrase
  ("most anzac day games") declines rather than misreading as a 1+
  list; a marquee/rivalry predicate alongside a season range declines
  rather than silently dropping the seasons; and a max/min aggregation
  with no metric over structure-only content now normalises to a list,
  so "players WHO PLAYED on anzac day" (whose "who played" reads as the
  "who played the most…" idiom) returns the full list instead of a
  25-row truncation. `DECADE_RE` also accepts "during the 1990s".

### Schema and privilege review — 17 August 2026

A design review of the 43 migrations and the privilege reconciler. Nothing here
was a live defect; every item is a rule that existed only in prose, in a
comment, or in the habits of the one program that writes a table. Two
migrations: `044_schema_integrity.sql` and `045_import_write_is_fail_closed.sql`.

#### Fixed
- **Write privileges fail closed too.** Migration 039 inverted the schema-wide
  default privilege for `afldb_app` and left the identical mechanism running for
  `afldb_import`, so each new operational table was fully writable and
  `TRUNCATE`-able by the ETL role until someone ran the reconciler. Its scope is
  now `afldb_meta.import_writable_tables`, opted into with
  `afldb_meta.grant_import_write()` — the mirror of `grant_app_read()`. Both
  install scripts now revoke the defaults instead of re-granting them on every
  re-run.
- **`afldb_import` could reset the auth sequences.** 039 revoked the operational
  tables and not their identity sequences, and migration 011 had granted
  `UPDATE` on every sequence in `public` — which is what `setval()` needs. The
  ETL role could reset `auth_users_id_seq` and break every later insert on a
  duplicate key without touching the table itself.
- **`afldb_import` could truncate `site_settings`.** The reconciler inferred
  "operational" as the complement of what `afldb_app` may read, and
  `site_settings` is deliberately app-readable, so the ETL role held `DELETE`
  and `TRUNCATE` on the site's runtime configuration. Two registries, no
  inference.
- **The reconciler now reconciles `afldb_auth`.** It re-granted an enumerated
  spec and never revoked, so any grant added by hand or left behind by an
  abandoned migration survived every run. Anything outside the spec is now
  revoked, and its sequence grants are narrowed from the whole schema to the
  tables it writes.
- **Stale registry rows are cleared.** A registry entry outlived its dropped
  table, so a later table reusing the name would have been granted on the next
  reconcile with nothing deciding that afresh.
- **Source keys scoped by source.** `player_relationships` and
  `father_son_selections` keyed `source_record_id` on its own, which forbade a
  second source and — being a plain `UNIQUE` — exempted null-keyed rows
  entirely. Both now match migration 042's
  `UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)`.
- **Case-insensitive email uniqueness** on `auth_users`, `beta_allowed_emails`
  and pending `beta_join_requests`. Seven application write paths lowercase
  before storing; the database knew about none of them.
- **Foreign-key indexes the integrity check can use.** Four `player_id` indexes
  were partial on link status, which a `DELETE` from `players` cannot imply, so
  each of those tables was scanned instead. Re-predicated on
  `player_id IS NOT NULL`, the shape migration 041 established.

#### Added
- `CHECK` constraints for `data_submission_rows.verdict` (the only status column
  with no vocabulary behind it, and it gates approval) and for
  `site_media.byte_size = octet_length(bytes)`.
- `afldb_meta.revoke_app_read()` and `revoke_import_write()`, so un-registering
  a table is not a hand-written `DELETE` plus `REVOKE`.
- `afldb_meta.owned_sequences()`, which finds a table's identity sequences
  through the catalogue dependency rather than by guessing at a name.

#### Changed
- Comments recording three decisions that were previously unstated or wrong: the
  provenance foreign keys are unindexed deliberately (append-only parents), the
  awards tables keep both unique indexes because the two keys are not
  interchangeable, and `clubs_org_span_ck` checks a season span rather than the
  organization rule the comment above it in migration 017 describes.

### Housekeeping — 16 August 2026

#### Changed
- Trimmed the longest source docblocks to the constraint they exist to record,
  moving the incident narrative behind them into this changelog. Section
  dividers in the query and library modules compressed from three-line ASCII
  rules to one line.

#### Removed
- `tsconfig.tsbuildinfo` is no longer tracked. It is a host-specific
  incremental build cache, so a committed copy only ever reached the next host
  stale. Now ignored, along with `.claude/`.

---

## 16 August 2026 — Production infrastructure and the public apex

The day the project acquired real infrastructure: a dedicated host, a
production database, TLS, and a public front door.

### Added
- **Production droplet.** DigitalOcean `s-2vcpu-2gb` (2 vCPU, 2 GB, 60 GB) with
  PostgreSQL self-managed on the same host. A managed database cluster was
  costed and rejected: at roughly AUD 50/month more it bought failover and PITR
  for a workload whose writes all happen on dev before release, and which is
  backed up independently.
- **Host hardening.** SSH restricted to key auth for a single non-root user
  (`PermitRootLogin no`, `PasswordAuthentication no`, `AllowUsers arm`); `ufw`
  limited to 22/80/443; PostgreSQL bound to localhost only.
- **Production PostgreSQL bootstrap** (`tools/maintenance/00_install_postgres_prod.sh`)
  creating `afldb_prod`, the five roles, and `pg_trgm`/`unaccent`, writing
  credentials to a mode-600 `.env`.
- **`beta.afldb.com` live** behind Caddy with a Let's Encrypt certificate,
  served by `afldb.service` as a four-worker Next.js standalone cluster under
  systemd.
- **Coming-soon page at the apex** (`afldb.com`), static and indexable, served
  from disk by Caddy while the application itself stays `noindex` behind the
  beta gate. Carries an early-access request form.
- **`/admin/content`** — a super-admin editor for the coming-soon page and the
  site-wide footer: copy, images, cards, and search metadata, with media
  upload. The published apex page is rendered from the database; the files in
  `deploy/coming-soon/` are the reference copy it started from.
- **Runtime site settings** — home-page layout, record of the week, AFLW
  leaders panel, and grid-solver audience, all editable without a deploy.
- **Structured data and SEO** — JSON-LD, canonical URLs, and a segmented
  sitemap with a published index.
- **Admin password reset.** A super admin can issue a single-use temporary
  password that carries `must_change_password` and leaves the TOTP secret
  alone. Previously the only repair for a forgotten password was re-issuing an
  invite, which re-enrolled both factors.
- **Collapsible admin navigation.**
- **Email intake** for CSV submissions, polled by a systemd timer.

### Fixed
- **`AFLDB_INDEXING` split from `AFLDB_ENV`.** One flag had been deciding both
  search indexing and transport security. Holding the beta host out of search
  therefore also stripped `Secure` from its admin cookies on a live HTTPS site.
  Indexing is now its own flag and fails closed.
- **Read privileges fail closed.** `afldb_app` no longer inherits `SELECT` on
  new tables; a new public table must be granted explicitly via
  `afldb_meta.grant_app_read()`. `tools/maintenance/privileges.sql` reconciles
  the whole set and is mandatory after a restore.
- **Import privilege check** now uses `has_table_privilege` for `DELETE` and
  `TRUNCATE` rather than inferring them.
- **`.gitignore` was excluding `tools/build/prepare-standalone.mjs`.** An
  unanchored `build/` pattern matches at any depth, so the script `npm run
  build` invokes as its final step was never committed — and a fresh clone
  failed only there. Anchored to `/build/`.
- **`site_settings` jsonb read.** `postgres.js` returns jsonb as text, so the
  settings read had to parse rather than assume an object.
- Apex `ReadWritePaths` in the systemd unit now tolerates a host without that
  directory.
- Worker and pool sizing moved out of the unit file into per-host `.env`.

### Known issues
- Outbound SMTP on ports 25/465/587 is blocked by DigitalOcean. Titan can
  receive mail but cannot relay, so transactional mail goes through Brevo on
  port 2525.

---

## 15 August 2026 — Features, roles, and AFLW

### Added
- **AFLW as a separate competition.** Parsed and staged from the source scrape
  first so the real data could be inspected before committing to a schema, then
  exposed through a read-only `aflw` view schema (migration 026). AFLW is
  deliberately outside the normalised model: it played two seasons in calendar
  2022, and the core model keys a season by year. Seasons are identified by
  `season_key` and ordered by `ordinal`, never by year.
- **Grid Solver** — a 3x3 board of named questions, 93 builders across 10
  categories, modelled on the sports_data_lab original and checked against its
  generated criteria document. Family relationships, physical attributes, derby
  definitions and win-streaks are absent because the data does not exist.
- **Query builder** — a hidden super-admin tool for ad-hoc data QA. Table and
  column identifiers come from a curated allowlist rather than
  `information_schema` discovery, operators from a fixed vocabulary, and values
  are always bound as parameters.
- **Player comparison** with played-with and played-against drill-down.
- **Database Health** page for super admins.
- **Roles and delegation.** `super_admin` added above `admin`, plus a
  `contributor` role limited to CSV upload. Admin management is delegable via
  `can_manage_admins`. All roles require MFA.
- **Self-service admin invites** with QR-code TOTP enrolment, so a new admin
  scans rather than transcribes a secret.
- **CSV upload** for current and historical match results and player-match
  statistics, with sample files per dataset, plus an email-in channel as a
  second route.
- **Search-intent routing.** A query naming a club or season alongside a
  record, award or draft class now lands on that filtered view — "brownlow
  winner richmond" opens winners by season rather than career vote leaders.
- **AFLW-scoped global search and navigation.** Selecting AFLW switches the
  whole nav and the home-page search to that competition.
- **Collapsible tables and per-table filters** across the site, with applied
  filters carried in the URL.
- **Reorderable home-page sections**, dragged rather than stepped with arrows.
- **Brownlow Medal** queries, filters, and season/career views.
- **Draft origin filter** — filter the draft by drafting club and by
  feeder/state-league club.
- **Vitest** configuration and the first executable test suite; release-gate
  assertions separated into immutable and rolling-snapshot groups.

### Fixed
- `super_admin` could not actually log in.
- `afldb_app` had inherited read access to operational and auth tables;
  revoked, including `site_media`.
- Draft feeder club read from the raw query rather than the AFL club list, so
  state-league clubs resolve.
- `career_teammates_min` and the player-compare pair-discovery query were
  timing out against real data.
- Gate redirects were leaking the internal origin; middleware requires an
  absolute `Location`, so redirects are built from `AFLDB_BASE_URL`.
- Filtering a table below the first no longer jumps the page back to the top.
- Staged CSV row payloads were being double-encoded as JSON.
- `matches.attendance_status` is now set when promoting `match_results` rows.
- Single-use TOTP codes: a code cannot be replayed within its window.

---

## 14 August 2026 — Migration and foundations *(pre-git)*

### Added
- **Greenfield PostgreSQL 16 model** for VFL/AFL from 1897, replacing a legacy
  SQLite database that remains the read-only source. Bootstrap script creates
  `afldb_dev` and `afldb_test`, the `afldb_owner`/`app`/`import`/`backup` roles,
  and the `pg_trgm` and `unaccent` extensions.
- **Migration pipeline** in Python 3.12 with psycopg 3 and `COPY`, recording
  provenance and import batches, and a validation suite that reached 93/93
  parity checks with no rejected rows.
- **Next.js 15 application** — App Router, React 19, Server Components by
  default, with no separate API service.
- **Light and dark themes**, from the supplied mock UI.
- **Awards and honours** — Rising Star, All-Australian, club best-and-fairests
  and other competition awards, imported from the raw footywire and draftguru
  sources.
- **Global search beyond players** — rounds, years, grounds, awards and record
  categories.
- **Admin authentication** — `afldb_auth` role, `create-admin` tool, scrypt
  password hashing, and TOTP MFA.
- **Backup and tested restore procedure.**

### Changed
- **Brownlow totals do not come from match rows.** Per-game votes exist only
  for 1931–1934 and 1984–2025, so season and career totals use the
  season-level source. The legacy database's derived career totals were
  deliberately not copied forward.
- **`NULL` is not zero.** A missing historical statistic means "not recorded",
  tracked by season, statistic and grain, and preserved as such in the UI.
- **Historical club identity is explicit.** Renames and relocations share an
  organization without rewriting the historical club identity; mergers stay
  separate organizations and are linked, not combined. Neither club's
  statistics count toward a merged club.
- Deployment standardised on a single `main` branch, pulled from GitHub with a
  deploy key, rather than copying archives to hosts.

### Fixed
- `restore-test.sh` could leave the source DSN unchanged before `pg_restore
  --clean`, and a trailing `|| true` was suppressing every restore failure
  rather than only extension-owner warnings.

---

## Notes on scope

Family relationships are present in the legacy source but have not been
migrated, and are intentionally absent from the public site.

The core dataset was assembled from AFL Tables via
[fitzRoy](https://jimmyday12.github.io/fitzRoy/), with additional source
material for Brownlow voting, birth dates, and draft records.
