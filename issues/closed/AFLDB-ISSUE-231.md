# AFLDB-ISSUE-231 — AFL API source-integrity hardening: retired-identity rekey and match-family absence sweep

**Status:** Open. **Severity:** Low. **Opened:** 2026-09-23 (ISSUE-228 S10 successor).
**This runbook:** created 2026-09-26 in the bulk successor pass (229/231/232/233/234) on
`opus/afl-api-successors-229-234`, base `main` `2e587415`. Uncommitted.

**State after pass 1 (2026-09-26, first half):**
- Residual 1 (rekey): **IMPLEMENTED / DB-FREE VALIDATED / NEEDS REHEARSAL.**
- Residual 2 (absence sweep): **BLOCKED ON OPERATOR DECISION** (D-231-1, D-231-2). The carrier it
  needs now exists.

**State after pass 2 (2026-09-26, second half; still uncommitted):**
- **Decisions recorded:** D-231-1 = **0** (any record disappearing from an otherwise complete
  season enumeration HALTs the settle; no positive tolerance). D-231-2 = **(a)** (clear
  `absent_since` when the `external_record_id` is present again in a complete season feed, even
  if the nightly CONCLUDED filter did not select it).
- **Carrier defect found and fixed (§2a):** the enumeration read `pagination.numEntries` at the top
  level. Authentic bytes put it at `meta.pagination.numEntries`, so every real feed would have read
  `pagination_missing` (incomplete) and residual 1 would never have activated. Now proven
  DB-free against the real 2026 feed.
- Residual 1: **IMPLEMENTED / DB-FREE VALIDATED / REHEARSAL WRITTEN, NOT RUN** (§6a; needs operator
  authorisation for `code_test_db`).
- Residual 2: the DB-free decision (`planAflApiAbsenceSweep()`) is **IMPLEMENTED AND TESTED**. The
  write path is **NOT WIRED: STOPPED ON A CONTRACT CONTRADICTION** (§4a). Under D-231-1 = 0 the
  HALT rolls back the very `absent_since` stamp meant to be the review signal, and it also makes
  residual 1 unreachable in any committed run. Operator decision D-231-3 is needed before any
  weakening or redesign.

**State after pass 3 (2026-09-26; still uncommitted):**
- **D-231-3 = A** (operator), acknowledgement surface **CLI only** for v1 (no admin action/UI).
- Residual 2: **IMPLEMENTED / DB-FREE VALIDATED / REHEARSAL WRITTEN, NOT RUN** (§4b, §6b).
- Residual 1 is now reachable in a committed run, after a human acknowledges the disappearance.
- Open sub-question (per the decision): recording a HUMAN actor on the acknowledgement (§4b.6).

**State after pass 3b (2026-09-26; still uncommitted):**
- Actor decision **(c)** applied (§4b.6). The database actor is operational attribution, not
  authenticated human identity.
- **code_test_db rehearsal RUN under operator authorisation: 62/62 PASS, exit 0.** Residue was
  zero before and after (§6c).
- Residuals 1 and 2: **IMPLEMENTED / REHEARSED ON REAL POSTGRESQL**. DEV acceptance has not run
  (§6c, "Readiness").

**State after DEV acceptance (2026-09-26): RESOLVED.** Deployed `dd7e28a6`; `--validate-only` and
`--dry-run` both PASS on real DEV; no disappearance detected; no acknowledgement performed or
required; `--apply` not run (§8).

---

## 1. The successor contract, reconstructed

Sources (all read in this pass): ISSUE-228 runbook §6.1, §7.3 "Enumeration and absence", §13.2
item 3, §13.3, §13.5, §14 (HALT list), §22.20 rows 1a/1b; `src/lib/acquisition/match-rekey.ts`
rules 1–4; ISSUE-244 F010 (identity withholding) and F030 (`possible_existing_match`).

| Rule | Where decided | Effect here |
|---|---|---|
| Resolver order is provider id → `match_key` → retired-identity search, for every `afl_api` target | ISSUE-228 §6.1, §13.2 item 3 | Step 3 must run once a retirement proof exists |
| Retirement needs a scope THIS run proved complete, and the old id absent from what it published | `match-rekey.ts` rule 2 (ISSUE-131) | The proof must be a complete enumeration, never the run's selection |
| Only a row already owned by the promoting source is a candidate | `match-rekey.ts` rule 3 | Only `afl_api`-owned rows (0 exist today, ISSUE-244 F031 census) |
| Ambiguity refuses | `match-rekey.ts` rule 4 | `rekey_ambiguous` / `rekey_would_merge` → the existing identity-refusal finding |
| Identity-bearing corrections on an `afl_api`-owned match are WITHHELD, not applied; no rekey, no migration | ISSUE-244 F010 (§13.5 annotation) | A retired-identity hit never moves `match_key`, season, round, date or clubs |
| Nothing re-owns a row | ISSUE-228 Q1 (§7.5) | The provider link `matches.source_record_id` is never rewritten |
| Absence is a review signal only, never a DELETE | §7.3, §13.3 | Spine `absent_since` only; no canonical write |
| A season enumeration shrinking by more than a declared tolerance HALTs the run | §13.5, §14 | The tolerance has never been declared (D-231-1) |

## 2. The shared primitive: the season enumeration

`src/lib/acquisition/afl-api-season-enumeration.ts` (new). One representation, reused by the
settle, the fixtures-only settle and (later) ISSUE-229.

- **Source.** The `00-season-matches.json` bytes every acquisition already retains and hash-binds
  in its manifest (`acquire-afl-api.ts`, full and `--fixtures-only`). No request, no database.
  Entries are read by the existing `parseAflApiSeasonMatchesEnvelope()`; no second parser.
- **Complete only when every check passes:** integer `pagination.numEntries` (the §2.1 measured
  envelope), equal to the entries returned, below the requested page size
  (`AFL_API_SEASON_PAGE_SIZE` = 1000, now exported by `afl-api-client.ts`), not empty, every entry
  naming the expected `compSeason.providerId`, no duplicate provider id. Any failure is a named
  gap (`pagination_missing`, `pagination_mismatch`, `page_limit_reached`, `empty_season_feed`,
  `foreign_comp_season`, `duplicate_provider_id`, `season_feed_not_in_snapshot`).
- **Whole feed, not selection.** `providerMatchIds` is every match the feed published. A nightly
  acquisition selects only `CONCLUDED` matches; a scheduled match it did not select is still
  published and can never read as retired or absent.
- **Status observed, not mapped.** `statusCounts` records each provider `status` verbatim. This is
  ISSUE-229's evidence surface; nothing here interprets a status.
- **Not season discovery.** ISSUE-233 discovery asks which seasons exist. This asks whether one
  response for an already-registered season listed every match. Neither proves the other.

Wiring:
- `AflApiSettleBundle.seasonFeed` (required on the type; `buildAflApiSettleBundle()` takes it as
  an optional input and defaults to the incomplete `season_feed_not_in_snapshot` enumeration, so
  existing callers keep today's behaviour).
- The bundle refuses, before any connection, an acquired match its own feed does not list, and a
  feed for another season.
- `tools/current-season/settle-afl-api.ts` reads the feed through the verified manifest
  (`aflApiSeasonFeedTextFrom()`, `afl-api-snapshot.ts`) and logs one line, for example
  `Season feed CD_S2026014: 218 match(es), complete; statuses observed: CONCLUDED 218.`
- New counters `seasonFeedMatches`, `seasonFeedComplete`, `seasonFeedStatusCounts`, persisted in
  `import_batches.validation_result` with the rest. They are informational: they never move the
  source-completeness verdict or `--require-complete-source`.
- `tools/current-season/settle-afl-api-fixtures.ts` logs the same line (no gate).

## 2a. Envelope correction from authentic bytes (pass 2)

ISSUE-228 §2.1 recorded the season feed envelope as `{meta, pagination{numEntries}, matches[]}`.
The authentic 2026 capture says otherwise:

```
{"meta":{"code":200,"pagination":{"page":0,"numPages":1,"pageSize":1000,"numEntries":218}},"matches":[…]}
```

- Source: `D:\dev\testAFLGrab\AFLGamesSamples\00-season-matches.raw.json`, retrieved
  2026-09-19T10:29:29Z from
  `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=85&pageSize=1000`
  (its `README.txt` lines 2 and 9–10, `source-manifest.json`), written verbatim from
  `Invoke-WebRequest .Content` by `grab-afl-current-sample.ps1`. Read-only inspection, operator-authorised.
- Original captured response: 318,555 bytes, sha256
  `9c358984f5d6d29d65af96e24207968b733d56a4f4103947da9382e7b11475ee`, single line, no BOM.
- Committed as `tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json`, a **sanitised
  derivative** of that response (2026-09-26, pre-commit): 318,269 bytes, sha256
  `4f8235e08f438ee533b2d9c504b105b3bfce2449a807362dff10d074f7f1babb`, single line, no BOM.
  - Exactly one change: the value of the `enqueuetoken=` query parameter inside one Ticketek
    `ticket_link` URL is replaced by the literal `REDACTED`. That value was an expired third-party
    Queue-it queue token that embedded a third-party IP address. It is not AFL match or season
    data.
  - Every other byte is unchanged. A parsed comparison with that one `ticket_link` restored is
    identical to the original. No AFLDB code reads `ticket_link`.
  - The hash-bound tests pin the committed (sanitised) bytes.
- The enumeration now reads `meta.pagination` only. It also requires `page` 0 of `numPages` 1
  (else `page_limit_reached`). A top-level `pagination` is refused as `pagination_missing` (the
  shape §2.1 described was never measured).
- Real-bytes result: `Season feed CD_S2026014: 218 match(es), complete; statuses observed:
  CONCLUDED 217, SCHEDULED 1.`

## 3. Residual 1 — retired-identity rekey (implemented)

`runSettleAflApi()` now passes `aflApiMatchRekeyScope(bundle.seasonFeed)` instead of
`NO_MATCH_REKEY_SCOPE`. A complete feed yields `{completeScopeKeys: ['season=<Y>'],
publishedRecordIds: <whole feed>}`; anything else yields the empty scope (today's behaviour).

The exact case it covers: an `afl_api`-owned `matches` row whose provider id (`source_record_id`
= `CD_M_old`) is absent from a complete season feed, while a record with a new provider id
(`CD_M_new`) arrives for the same fixture (same season and clubs, at most one of round/date
different) and misses both provider-id and `match_key` lookup.

| Before (NO scope) | After (enumeration scope) |
|---|---|
| Unresolved → the F030 guard finds the plausible fixture → `possible_existing_match` refusal, no write | Resolved via `retired_identity` to the old row → F010 withholds every identity-bearing difference into the `…|matches:identity` finding; non-identity fields (scores, venue, time) may auto-apply as ordinary corrections; the provider link stays `CD_M_old`; nothing is re-owned |
| — | Two retired candidates → `rekey_ambiguous`; a `match_key` hit plus a retired hit → `rekey_would_merge`; both refuse through the existing identity-refusal finding |

Not changed, deliberately:
- **Brownlow** (`afl-api-brownlow.ts:470`) keeps `NO_MATCH_REKEY_SCOPE`. A Brownlow snapshot has
  no season feed, and it never creates a match. Once D-231-1 enables the sweep, it could use the
  existing `{ kind: 'absent_observation' }` evidence (spine `absent_since`) without an
  enumeration of its own; that is a later, separate change.
- The provider-link relink (`source_record_id` `CD_M_old` → `CD_M_new`) is **not** done. It is an
  identity change, so under F010 it is a human decision.

## 4. Residual 2 — absence sweep (designed; blocked on D-231-1 / D-231-2)

The carrier now distinguishes complete from partial enumeration, so the stop condition in the
brief does not apply. What remains is policy.

**Design (ready to implement once decided):**
1. Sweep only the `afl_api` `match` family in scope `season=<Y>`, only when `seasonFeed.complete`.
2. **Id-list semantics, not batch semantics.** AFL Tables' `markMissingObservationsAbsent()` marks
   records whose `last_batch_id` is not this batch. That is wrong here: a nightly `afl_api` run
   observes only the selected `CONCLUDED` matches, so it would stamp every previously observed
   match it merely did not re-select. The `afl_api` sweep must stamp exactly the scope records whose
   `external_record_id` is **not in `providerMatchIds`**.
3. Spine only: `staging.source_records.absent_since`. No DELETE, no version, no canonical write,
   no `fixtures`/`matches` status change. A human cancels or voids through `admin-fixtures.ts`.
4. Shrink HALT (§13.5/§14): if the number of records newly stamped absent exceeds the declared
   tolerance, throw the existing `AflApiSettleHalt` (whole run rolled back, exit non-zero,
   `AFLDB_SETTLE_FAILURE`).
5. Once stamped, the existing `{ kind: 'absent_observation' }` retirement evidence becomes usable
   by `repair-match-rekeys.ts` and Brownlow.

**Operator decisions:**
- **D-231-1 — shrink tolerance.** The maximum number of matches one complete feed may drop
  before the run HALTs. `0` means any disappearance stops the nightly chain until a human looks.
  That is the most conservative option, and it is loud during a genuine cancellation. A small
  positive number lets a lone cancellation through as a review signal. Nothing in the repository
  declares a value. Where it lives (registry family contract vs a CLI flag) is part of the
  decision.
- **D-231-2 — reappearance without re-selection.** `persistSourceObservation()` clears
  `absent_since` only when it observes the record again. A match that returns to the feed as
  non-`CONCLUDED` is not re-selected, so it would stay stamped. Either: (a) the sweep also clears
  `absent_since` for scope records the complete feed lists again (presence in a complete feed is
  observation of presence), or (b) absence clears only on re-observation, as today. (a) is
  recommended.

## 4a. Pass 2: D-231-1 = 0 contradicts the HALT mechanism (STOP, operator decision D-231-3)

**Implemented (DB-free, no write):** `planAflApiAbsenceSweep(enumeration, spineRecords)` and
`AFL_API_ABSENCE_TOLERANCE = 0` in `afl-api-season-enumeration.ts`. Id-list semantics: a scope
record is newly absent only when the complete feed omits its provider id. It is never absent merely
because the run did not select it. The planner also returns `stillAbsent`, `reappeared` (D-231-2)
and `exceedsTolerance`. An incomplete feed decides nothing. There is deliberately no flag or
registry field that could raise the tolerance.

**Not wired, and why.** The only HALT this settle has (`AflApiSettleHalt`, §14) is a thrown error
inside the ONE settle transaction (`runSettleAflApi()`, `settle-afl-api.ts`). `runSettleAflApi()`
catches it after `sql.begin()` has rolled everything back, the batch row included. Applied
literally, D-231-1 = 0 therefore means:

1. **No `absent_since` stamp can ever commit.** The first newly absent row makes
   `exceedsTolerance` true, the HALT fires, and the stamp rolls back with the rest. The "review
   signal" never exists in the database. The only trace is the run's non-zero exit and the halt
   detail in the journal.
2. **The nightly chain wedges until the record returns.** Next night the record is still unstamped,
   so it is "newly" absent again, and the run HALTs again. `admin-fixtures.ts` cancel/void does not
   touch the spine, so no human action inside the product clears it. Only the provider re-listing
   the id, or a hand edit of `staging.source_records`, ends it. Meanwhile no match, stat or
   correction for the season settles.
3. **Residual 1 becomes unreachable in any committed run.** A retired-identity rekey begins,
   by definition, with the old provider id leaving a complete feed. That is a disappearance, so
   under tolerance 0 every rekey run HALTs before its `retired_identity` resolution can commit
   (DB-free test: "the rekey case IS a disappearance"). Residual 1 only works today because the
   sweep is not wired.
4. D-231-2 is inert under (1): with no committed stamp, nothing can ever reappear.

This is exactly the situation the pass-2 brief said to stop on. Nothing was weakened.

**D-231-3 (operator decision needed).** Options, none implemented:

| | Mechanism | Committed signal | Nightly chain | Residual 1 |
|---|---|---|---|---|
| **A. Detect, then refuse, with a durable finding** | The HALT still rolls the settle back. A second, separate transaction then writes ONE operator-visible `data_issues` finding (for example `afl_api|match|season=<Y>|absence`) listing the absent ids, and nothing else. A human acknowledges specific ids on it, and the sweep counts only unacknowledged ids against tolerance 0. | Finding plus acknowledgement; `absent_since` stamped only once acknowledged | Stops until acknowledged, as D-231-1 intends | Runs after acknowledgement |
| **B. Stamp, then stop** | The spine stamp and the finding commit. Every canonical/unit write of that run is refused (the run exits non-zero, `AFLDB_SETTLE_FAILURE`). The next run sees the id as already absent, not newly absent, and proceeds. | `absent_since` plus finding | Stops for exactly one run per disappearance | Runs from the second night |
| **C. Keep literal HALT** | As today's HALT: nothing commits. | None (journal only) | Wedged until the provider re-lists the id | Never |

Recommendation: **A**. It is the only option that keeps D-231-1's "stop until a human looks" and
leaves a durable, queryable signal, and it needs no schema change (`data_issues` already carries
keyed findings). Choosing it defines the acknowledgement surface (admin action vs a CLI), which is
part of the decision.

## 4b. Pass 3: D-231-3 = A, implemented

Operator decision (2026-09-26): option A. The acknowledgement surface is CLI-only for v1. The
tolerance stays exactly 0, and the in-transaction HALT still rolls back every ordinary settle
write. The refusal gets durable evidence outside that transaction. No schema change.

**4b.1 Architecture.** New `src/lib/acquisition/afl-api-match-absence.ts`, wired into
`runSettleAflApi()`.

| Step | Where | Writes |
|---|---|---|
| 1. `sweepAflApiMatchAbsence()` | Inside the settle transaction, after the batch row, before any unit. Complete feed only (else `not_applicable`, no DB touch). Reads the `(afl_api, match, season=<Y>)` spine and decides with `planAflApiAbsenceSweep()` | Nothing when it halts |
| 2. Any `newlyAbsent` id → `AflApiMatchAbsenceHalt` (subclass of `AflApiSettleHalt`, reason `afl_api_match_absence`) | Thrown from inside `sql.begin()` | Whole transaction rolled back: batch, spine, versions, projections, candidates, canonical rows, findings |
| 3. `recordAflApiMatchAbsenceFindings()` | In `runSettleAflApi()`'s `catch`, i.e. AFTER `sql.begin()` returned the rollback; only for this halt and only on `--apply` | One `data_issues` row per newly absent id, nothing else |
| 4. No halt → D-231-2 | Inside the settle transaction | `absent_since = NULL` for `reappeared` ids (`observationsReappeared`); open absence findings whose id the complete feed lists → resolved `source_reappeared` (`dataIssuesResolved`) |

"Unacknowledged" is simply "spine `absent_since` IS NULL". Acknowledgement is the only thing that
stamps it, so an acknowledged id is `stillAbsent` and never blocks. The planner is unchanged.

**4b.2 The separate-transaction boundary (exact).**
- It is opened by `sql.begin()` on the settle's own client (`AFLDB_IMPORT_DATABASE_URL`,
  `afldb_import`). That happens after the settle's `sql.begin()` has already rejected, so the
  settle transaction is rolled back before it starts.
- Each statement is one `INSERT … SELECT … FROM staging.source_records` that requires the spine row
  to still exist in the same scope with `absent_since IS NULL`. The statement ends with
  `ON CONFLICT (issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS NULL DO
  NOTHING`, the existing `uq_data_issues_open_by_key`.
- Each result is reported as `opened`, `alreadyOpen` (a repeat detection, with first detection
  kept) or `notRecorded` (the spine row moved in between).
- A failure here throws. The run already exits non-zero because of the halt.
- `AFLDB_SETTLE_FAILURE` behaviour is unchanged: `settle-afl-api.ts` `main()` sets exit code 1 on
  any halt.
- A `--dry-run` writes no finding.
- No other settle failure was moved out of the settle transaction.

**4b.3 The finding.** It uses `issue_type = 'afl_api_match_absence'`, entity `matches` (`entity_id`
= the afl_api-owned canonical row for that provider id, if any) and severity `error`.
- **Key:** `afl_api|match|season=<Y>|<CD_M…>|absence`. This names the source, family, scope and
  id.
- **`details`:**
  - `owner` (`settle-afl-api.ts`), `source_key`, `family`, `season`, `scope_key`,
    `external_record_id`, `comp_season_provider_id`;
  - `first_detected_at` (the halted run's `observedAt`), `first_detected_snapshot_label`,
    `first_detected_season_feed_sha256` (new `AflApiSeasonEnumeration.sourceSha256`, the sha256 of
    exactly the bytes assessed, which equals the manifest hash), `first_detected_season_feed_matches`;
  - `halt_reason`, `tolerance: 0`, `reason` (the explicit "tolerance 0 halted the settle" text);
  - `spine_first_seen_at`, `spine_last_seen_at`.
- A repeat detection writes nothing, so first-detection provenance (including `detected_at`) is
  never overwritten.

**4b.4 Acknowledgement CLI.** `tools/current-season/acknowledge-afl-api-match-absence.ts`, with
its core in `acknowledgeAflApiMatchAbsence()`.

```
npx tsx tools/current-season/acknowledge-afl-api-match-absence.ts \
  --label <full afl_api snapshot> --season 2026 --external-record-id CD_M… --finding-id <data_issues.id>
# validate-only (default; --validate-only is accepted). Then, to commit exactly that:
… --apply --acknowledge <the database printed by the validate run>
```

- **Input.** `--label`, `--season`, `--external-record-id` and `--finding-id` are all required.
  There is no blanket mode, and an unknown or repeated flag is refused. `--apply` needs
  `--acknowledge`, and `--acknowledge` needs `--apply`.
- **Offline, before any connection:**
  - `verifyAflApiSnapshotManifest()` re-hashes the snapshot. It must be a full snapshot;
    fixtures-only snapshots are refused, as the settle refuses them.
  - `manifest.season` must equal `--season`, and the snapshot must list `00-season-matches.json`.
  - `proveAflApiMatchAbsenceFeed()` checks, with the same `assessAflApiSeasonEnumeration()` the
    settle uses, that the text hashes to the manifest's sha256, the feed is complete, and it
    **omits** the id. A feed that lists the id again is refused (stale acknowledgement).
- **In one transaction, re-proved every time (validate-only runs the same reads and rolls back):**
  - `current_database()` and `current_user` are printed. On apply the database must equal
    `--acknowledge`.
  - `sources.key = 'afl_api'` exists.
  - The finding exists and is open. Its type, key, owner, `source_key`, `family`, `scope_key` and
    `external_record_id` must all match (`FOR UPDATE` on apply).
  - The spine row exists in that scope with `absent_since IS NULL` (`FOR UPDATE` on apply).
  - `first_detected_at >= first_seen_at` (`source_records_absent_ck`). If not, the run refuses.
- **Apply, same transaction:**
  - `absent_since = first_detected_at`.
  - The finding is resolved `source_absence_acknowledged`, and `details.acknowledgement` is added.
    The exact shape is in §4b.6.
  - Each UPDATE must touch exactly one row, or the transaction refuses.
  - No canonical row, `source_record_id`, other finding or batch is written, and nothing is
    rekeyed.

**4b.5 Reappearance and new episodes.**
- An id present in a complete feed has `absent_since` cleared, whether or not the run selected it
  (D-231-2).
- An UNACKNOWLEDGED finding whose id is listed again stops blocking at once, because the planner
  does not count it as absent. The first run that does not halt resolves it `source_reappeared`,
  and no stamp is ever made.
  - If that run halts for a different id, the resolution rolls back with it. The settle retries it
    on the next non-halting run.
- A later disappearance is a new episode. The spine row is unstamped, so the id is `newlyAbsent`
  and the run HALTs. The old finding is resolved, so the partial unique index admits a new open
  row. Resolved history is never consulted as an allowlist.

**4b.6 The actor: decision (c), 2026-09-26.** The operator chose option (c). The acknowledgement
records the PostgreSQL role (`current_user`) as the DATABASE ACTOR.

**Database actor is operational attribution, not authenticated human identity.**

- There is no `--operator` flag; the parser refuses it as an unknown argument.
- There is no actor column and no migration.
- No `import_batches` row is written to manufacture attribution.
- The role is shared (`afldb_import`), so it never names a person.
- A future authenticated Admin Centre acknowledgement may add human attribution if this becomes a
  routine workflow. That is out of scope.

What is stored: `data_issues.resolved_at = now()` and `data_issues.resolution =
'source_absence_acknowledged'`. The finding's `details` gains one key, `acknowledgement`, built by
`aflApiMatchAbsenceAcknowledgementRecord()`; the SQL adds `acknowledged_at`.

| Key | Value |
|---|---|
| `database_actor` | `current_user`, for example `afldb_import` |
| `database_actor_kind` | `postgresql_role` |
| `actor_note` | `database actor is operational attribution, not authenticated human identity` |
| `database` | `current_database()` |
| `tool` | `acknowledge-afl-api-match-absence.ts` |
| `finding_id`, `issue_key` | the finding |
| `season`, `external_record_id` | the record |
| `proved_by_snapshot_label`, `proved_by_season_feed_sha256`, `proved_by_season_feed_matches` | the proving retained feed |
| `first_detected_at`, `absent_since` | the first-detected absence time, which is also the stamp |
| `resolution` | `source_absence_acknowledged` |
| `acknowledged_at` | the transaction's `now()`, the same instant as `resolved_at` |

First-detection evidence is preserved unchanged. `details || jsonb_build_object('acknowledgement',
…)` adds that single top-level key and never rewrites another, and `detected_at` is untouched. The
rehearsal proves this (S5).

Everything the decision listed has a durable home, so nothing is left unrepresented.

## 5. Validation (this pass)

- `npx tsc --noEmit`: exit 0.
- `tests/afl-api-match.test.ts`: 149 passed, 18 of them new (`AFL API season enumeration
  (AFLDB-ISSUE-231)`: completeness checks, verbatim status vocabulary, rekey scope from the whole
  feed, snapshot reading, bundle wiring and its two refusals).
- `tests/afl-api-ingestion-safety.test.ts`: 95 passed (typed counter literals extended; the F004
  rollback test now also proves the season-feed counters are retained on a full rollback).
- The existing DB-free resolver suite already proves `retired_identity`, `rekey_ambiguous` and
  `rekey_would_merge` for a non-empty scope. It is unchanged and passes.
- ESLint on the changed files: clean. The three `no-explicit-any` errors in
  `tests/afl-api-match.test.ts` are identical at HEAD, on untouched lines.

**Not run (DB boundary):** `tests/integration/settle-afl-api.test.ts`. No new integration case was
written in this pass.

## 6. Rehearsal required before resolution

1. **Snapshot proof (no DB).** On DEV, `npx tsx tools/current-season/settle-afl-api.ts --label
   <an existing 2026 snapshot> --validate-only`. Expect `Season feed CD_S2026014: <n> match(es),
   complete; …`. This proves the §2.1 `pagination.numEntries` reading against real retained bytes.
   If it reports `pagination_missing`, the carrier stays incomplete and inert, which is safe, but
   the envelope reading must then be corrected from evidence.
2. **`afldb_test` / `code_test_db` integration case** (to be written and run under a separate
   authorisation): seed an `afl_api`-owned match with spine record `CD_M_old` in `season=<Y>`;
   settle a bundle whose complete feed omits `CD_M_old` and carries `CD_M_new` for the same
   fixture with a one-component date change. Expect: resolution `retired_identity`, the identity
   finding withheld, `source_record_id` unchanged, no second `matches` row. Repeat with an
   incomplete feed; expect `possible_existing_match` and no write.
3. The existing `tests/integration/settle-afl-api.test.ts` must stay green (its bundles supply no
   feed, so they exercise the unchanged default path).

## 6a. Pass 2: the code_test_db rehearsal (written, NOT run; operator authorisation required)

`tools/db/afl-api-season-rekey-rehearsal.ts`. **Rollback-only:** each scenario runs in one outer
transaction on the import connection that is always rolled back. The real `runSettleAflApi()` runs
inside it through `savepointSql()` (its `sql.begin()` becomes a SAVEPOINT), so nothing commits.
Target guard: `resolveRehearsalDsns()` (the ISSUE-237 fixture guard) plus `current_database() =
'code_test_db'` in every transaction. Namespace `CD_M2026231R*`, batch notes
`snapshot=issue231-rekey-rehearsal-*`. The old rows are seeded through the real writer (a first
settle with no feed), never by hand. The feed is the authentic 2026 feed plus the incoming record.

Preflight refuses if any rehearsal fixture (June 2026, api Rd 1/Rd 2, Hawthorn v Brisbane Lions,
from the tracked unit) already has a canonical neighbour or a `match_key` hit in code_test_db, or
if the namespace has residue.

| Scenario | Proves |
|---|---|
| S1 complete feed, `…OLD` (06-02) absent, `…NEW` (06-03) same fixture | `resolveAflApiMatch` → `retired_identity` onto the old row; settle applies with no HALT; exactly one `matches` row, still `source_record_id = …OLD`, still 06-02 and its old `match_key`; no row under the new rendering; the `afl_api|apply|match|…NEW|matches:identity` finding is open |
| S2 the same with no feed retained (incomplete) | `unresolved`; `unresolvedIdentityMatch` 1, 0 inserts; the `afl_api|match|…NEW|matches` finding is `possible_existing_match` naming the old row; old row byte-identical; no second row |
| S3 two retired afl_api-owned candidates (`…AMA` Rd 1 06-09, `…AMB` Rd 2 06-10), incoming `…AMN` Rd 1 06-10 | `rekey_ambiguous` naming both; no insert; one refusal finding; both candidates untouched |
| after each | zero namespace residue across matches, spine, versions, `staging.afl_api_match`, player stats, ledger, candidates, findings, batches |
| S4 reappearance / S5 disappearance | **not written:** blocked on D-231-3 (§4a) |

DB-free guard (runs in `tests/afl-api-match.test.ts`): every rehearsal unit builds, the feed is
complete with 219 ids and never lists an old id, the S3 geometry holds, and `savepointSql` routes
`begin` into a savepoint.

**Exact commands (operator, after authorising a code_test_db run):**

```
# PowerShell, workstation tunnel to code_test_db. DSNs are the code_test_db owner and afldb_import DSNs.
$env:AFLDB_CODE_TEST_DATABASE_URL = '<owner DSN naming code_test_db>'
$env:AFLDB_CODE_TEST_IMPORT_DATABASE_URL = '<afldb_import DSN naming code_test_db>'
npx tsx tools/db/afl-api-season-rekey-rehearsal.ts residue
npx tsx tools/db/afl-api-season-rekey-rehearsal.ts run --acknowledge code_test_db
npx tsx tools/db/afl-api-season-rekey-rehearsal.ts residue
```

Expected: `residue` prints all zeros before and after. `run` ends `…: N/N checks PASS`, exit 0.
Sequences advanced inside the rolled-back transactions stay advanced (PostgreSQL never winds one
back). That is the only lasting effect, and code_test_db is the disposable database.

## 6b. Pass 3: the rehearsal extended to S1–S10 (written, NOT run; operator authorisation required)

The same file and the same commands as §6a. The run now prints the pre-run residue, and its last
line reads `… rekey + absence rehearsal: N/N checks PASS`. It is still rollback-only.
- Both `sql.begin()` calls, the settle's and the post-HALT finding transaction, and the
  acknowledgement's own, are savepoints of the always-rolled-back outer transaction.
- The halted settle is therefore a ROLLBACK TO SAVEPOINT, and the durable finding a RELEASED
  savepoint. That proves the D-231-3 boundary without committing anything.
- No committed subtransaction is used.
- Sequence advancement is the one known exception to zero residue.

New preflight refusal: code_test_db holds an unstamped `afl_api` `season=2026` match spine row
outside the namespace that the authentic feed omits. Every complete-feed settle would halt on it.

| Scenario | Proves |
|---|---|
| S1 | complete feed: `resolveAflApiMatch` → `retired_identity` onto the old row; the unacknowledged settle now **HALTs** `afl_api_match_absence` naming exactly OLD (supersedes pass 2's "applies, no HALT"; the applied rekey is S6) |
| S2 | incomplete feed: unchanged (`possible_existing_match`, no second row), plus no absence finding and no stamp |
| S3 | two retired candidates: settle 1 HALTs naming both; both acknowledged; settle 2 applies with `rekey_ambiguous`, both candidates untouched, no new row |
| S4 | first disappearance: HALT, no batch id; every non-absence census value unchanged (the ordinary transaction left zero state); `absenceFindings = {opened:[OLD]}`; exactly one keyed open finding with source/family/scope/id, label, feed sha256, `first_detected_at = t1`, `tolerance 0`; no stamp. Repeat: halts again, `alreadyOpen:[OLD]`, same finding id, `first_detected_at` and `detected_at` unchanged |
| S5 | validate-only: reports `absent_since = t1`, writes nothing; apply naming `afldb_dev`: refused, no write; apply: `absent_since = t1`, finding `source_absence_acknowledged` with its acknowledgement record, matches rows and ledger unchanged |
| S6 | next settle: `retired_identity` reached, applied, no HALT, no new finding; one matches row, still OLD / 06-02 / old `match_key`; nothing under the new rendering; the F010 `…NEW|matches:identity` finding open; `absent_since` still `t1` |
| S7a | acknowledged, then a complete feed lists OLD while the run selects nothing: applied, `absent_since` cleared |
| S9 | (continues S7a) OLD disappears again: HALT, a NEW open finding; the acknowledged one stays resolved; no stamp |
| S7b | unacknowledged finding, then OLD listed again: applied, finding `source_reappeared`, no stamp ever made |
| S8 | a complete feed listing OLD offered to validate-only and to apply: both refused, finding open, no stamp |
| S10 | incomplete feed (`pagination_mismatch`): acknowledgement refused; a settle omitting OLD neither halts nor opens a finding; after a real acknowledgement, a settle listing OLD does not clear the stamp |
| after each | zero namespace residue (matches, spine and stamps, versions, typed projection, player stats, ledger, candidates, findings, batches) |

## 6c. Pass 3b: the code_test_db rehearsal, RUN (2026-09-26, operator-authorised)

**Target.** code_test_db only, over the established local tunnel (127.0.0.1:55432). The DSNs were
built in memory from the main `.env` by swapping the database name to `code_test_db`. The `.env`
still names port 5432, so the port was pointed at the tunnel. The DSNs were passed only in the
child's environment and never printed.
- Owner DSN: `afldb_test` → `code_test_db`. Import DSN: `afldb_dev` → `code_test_db`, role
  `afldb_import`.
- The database-name guard was active (`resolveRehearsalDsns()` plus `current_database()` in every
  transaction).
- No afldb_test, afldb_dev, PROD or SSH database action.

| Step | Result |
|---|---|
| `residue` (before) | all 10 counters 0, exit 0 |
| Preflight | no residue; no plausible canonical neighbour; no unstamped foreign 2026 `afl_api` match record the feed omits. No STOP |
| `run --acknowledge code_test_db` | **62/62 checks PASS, exit 0** |
| `residue` (after) | all 10 counters 0, exit 0 |

Per scenario (checks passed / total):
- **S1** 6/6: the resolver reaches `retired_identity`; the unacknowledged settle HALTs naming
  exactly OLD; zero residue.
- **S2** 7/7: incomplete feed; `possible_existing_match`; no finding, no stamp.
- **S3** 8/8: HALT naming AMA+AMB; both acknowledged; settle 2 `rekey_ambiguous`; candidates
  untouched.
- **S4–S6** 22/22:
  - HALT with no batch id; the ordinary state is identical before and after (every non-absence
    census counter); `{opened:[OLD]}`; one keyed finding with the full first-detection evidence;
    no stamp.
  - The repeat halts with `alreadyOpen`, the same id and the same `first_detected_at`.
  - Validate-only writes nothing; naming the wrong database is refused.
  - Apply stamps `absent_since = first_detected_at` and resolves the finding with the database
    actor record. The first-detection keys are unchanged, and nothing canonical changes.
  - S6 reaches `retired_identity`, applies with no HALT, leaves one row still OLD/06-02, and keeps
    the F010 identity finding open; the stamp is kept.
- **S7a + S9** 7/7: reappearance clears the stamp (`observationsReappeared = 1`); a second
  disappearance HALTs and opens a NEW finding (ids 30 resolved, 31 open).
- **S7b** 4/4: the unacknowledged finding closes `source_reappeared`; no stamp.
- **S8** 3/3: validate-only and apply are both refused (the feed lists the id); no write.
- **S10** 5/5: `pagination_mismatch`; acknowledgement refused; no halt, finding or stamp; no clear.

The stored actor record (S5, verbatim keys) is `database_actor: "afldb_import"`,
`database_actor_kind: "postgresql_role"` and `actor_note: "database actor is operational
attribution, not authenticated human identity"`, plus the database, tool, finding id, issue key,
season, id, proving label and sha256, `first_detected_at`, `absent_since`, `resolution` and
`acknowledged_at`.

**Two harness artefacts, not product behaviour:**
- **`now()` is frozen at the outer transaction's start.** Inside the rollback-only harness,
  `acknowledged_at`, `resolved_at` and `detected_at` all read that instant. `acknowledged_at`
  (04:01:09.29Z) therefore reads earlier than the JS-clock `first_detected_at` (04:01:12.886Z). In
  production each acknowledgement is its own transaction.
- **Only sequences moved.** Identity values consumed inside the rolled-back transactions stayed
  consumed: `matches.id` reached 16843, `data_issues.id` 31, plus `import_batches`,
  `source_record_versions` and ledger ids. That is PostgreSQL's non-transactional sequence
  exception, and it is the only lasting effect. The namespace census is zero.

**Fixture bytes the rehearsal used.** The rehearsal ran on 2026-09-26 against the original,
unsanitised feed bytes (sha256 `9c358984…75ee`). Before commit, that fixture became the sanitised
derivative described in §2a (sha256 `4f8235e0…babb`). The only change is one `ticket_link` query
value that no AFLDB code reads, so the rehearsal was not re-run, per the operator's instruction.
The feed's computed `sourceSha256` (the proving hash a finding records) now reads the sanitised
value.

**Readiness.** ISSUE-231's code is proven on real PostgreSQL. It is ready for DEV acceptance
**once committed and deployed**. DEV acceptance still needs:
- (1) the operator commit and a DEV sync;
- (2) the §6 item 1 snapshot proof (`--validate-only` on a real DEV 2026 snapshot reads the feed
  complete);
- (3) a DEV `--dry-run`, which shows whether the real 2026 DEV spine has any disappearance. A
  dry-run halt records no finding;
- (4) nothing else is gated on a decision.

Resolution waits on that DEV evidence.

## 7. Files changed (this pass, for this issue)

- **N** `src/lib/acquisition/afl-api-season-enumeration.ts`
- **M** `src/lib/acquisition/afl-api-client.ts` (`AFL_API_SEASON_PAGE_SIZE`)
- **M** `src/lib/acquisition/afl-api-snapshot.ts` (`aflApiSeasonFeedTextFrom()`)
- **M** `src/lib/acquisition/settle-afl-api.ts` (bundle `seasonFeed`, rekey scope, counters)
- **M** `tools/current-season/settle-afl-api.ts`, `tools/current-season/settle-afl-api-fixtures.ts`
- **M** `tests/afl-api-match.test.ts`, `tests/afl-api-ingestion-safety.test.ts`

Pass 2:
- **M** `src/lib/acquisition/afl-api-season-enumeration.ts` (`meta.pagination` from the measured
  envelope; page 0 of 1; `planAflApiAbsenceSweep()`, `AFL_API_ABSENCE_TOLERANCE`)
- **N** `tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json` (a sanitised derivative of
  the authentic response; both hashes are in §2a)
- **N** `tools/db/afl-api-season-rekey-rehearsal.ts` (rollback-only rehearsal, not run at pass 2; subsequently executed
  successfully in pass 3, §6c)
- **M** `tests/afl-api-match.test.ts` (measured envelope helper; real-bytes, sweep-planner and
  rehearsal-fixture tests)
- **M** `.gitattributes` (`-text` for the new raw fixtures, so their hashed bytes never convert)

Pass 3 (D-231-3):
- **N** `src/lib/acquisition/afl-api-match-absence.ts` (sweep, post-HALT finding, acknowledgement core)
- **N** `tools/current-season/acknowledge-afl-api-match-absence.ts` (the CLI)
- **M** `src/lib/acquisition/afl-api-season-enumeration.ts` (`sourceSha256`)
- **M** `src/lib/acquisition/settle-afl-api.ts` (`AflApiMatchAbsenceHalt`, sweep call, post-rollback
  finding write, `absenceFindings` on the result, module doc)
- **M** `tools/current-season/settle-afl-api.ts` (halt output names the findings)
- **M** `tools/db/afl-api-season-rekey-rehearsal.ts` (S1–S10; feed-text helpers; preflight)
- **M** `tests/afl-api-match.test.ts` (17 new DB-free tests: binding, key, halt, inert sweep, feed
  proof, CLI parse and offline refusals)

**Pass 3 validation:**
- `npx tsc --noEmit`: exit 0.
- Vitest, 351/351: `tests/afl-api-match.test.ts` 199, `tests/afl-api-ingestion-safety.test.ts` 103,
  `tests/admin-current-season-settle.test.ts` 49.
- Regression, other importers of the settle module: `afl-api-settle-cli-gate` 35/35,
  `afl-api-player-bridge-cli` 28/28, `player-link-mutations` 112/112.
- `tests/reference-data.test.ts`: 50/51. The one failure is `afl_api_identity_adjudications`, which
  is absent from the post-045 list. That table comes from a committed migration. No migration or
  privilege file is in this diff, so the failure is outside this pass.
- ESLint on every changed TS/TSX: only the three `no-explicit-any` errors in
  `tests/afl-api-match.test.ts`. Linting the HEAD blob shows the same three.
- `sh -n` passes on both AFL API wrappers. `git diff --check` is clean.
- **Not run:** code_test_db, `tests/integration/*`.

## 8. DEV acceptance and resolution (2026-09-26, operator-run)

**Deployed revision:** `dd7e28a6` (`feat(afl-api): season-feed integrity, absence sweep and ops
wiring (229/231/232/233)`), branch `main`. Migrations 104/104 already applied, nothing to apply.
Next.js build, including TypeScript, passed. The service restarted successfully. `/api/health`
reported `{"status":"ok","database":"ok",...}`.

**Not acceptance evidence.** An earlier SSH invocation used malformed PowerShell backtick syntax
and did not execute correctly. It is excluded from the record below; only the successful
`--validate-only` and `--dry-run` runs count.

**`--validate-only`** (snapshot label `afl-api-2026-2026-09-25-235854`, revision `dd7e28a6`, Node
`v22.23.2`, exit 0):
- bundle: 217 match units, 0 build failures;
- season feed `CD_S2026014`: 218 matches, complete;
- status counts: CONCLUDED 217, UNCONFIRMED_TEAMS 1;
- output states verbatim: "--validate-only: manifest, registry and bundle contract verified. No
  connection opened."

(The real DEV feed's non-`CONCLUDED` status is `UNCONFIRMED_TEAMS`, not the `SCHEDULED` used in the
§2a fixture and the §6c rehearsal. The enumeration records both verbatim without interpreting
either; this does not change any check.)

**`--dry-run`** (same snapshot and revision, exit 0, control database `afldb_dev`, writer database
`afldb_dev`):
- snapshotMatches 217, snapshotPlayerMatchRows 9983, buildFailures 0;
- seasonFeedMatches 218, seasonFeedComplete 1, seasonFeedStatusCounts
  `{"CONCLUDED":217,"UNCONFIRMED_TEAMS":1}`;
- observationsSeen 10417, payloadsCreated 10417, versionsAppended 10417;
- unresolvedIdentityMatch 0, unresolvedIdentityPlayer 0;
- foreignOwnedCollision 0, corroboratedForeignOwned 217, sourceDisagreement 0;
- manualAuthorityRefusals 0;
- candidatesCreated 9983;
- dataIssuesOpened 0, dataIssuesRefreshed 0, dataIssuesResolved 0;
- canonicalRowsInserted 0, canonicalRowsUpdated 0, canonicalApplicationsLogged 0,
  canonicalApplyRefusals 0, canonicalApplyFailures 0;
- source completeness: COMPLETE; all 10,200 acquired records were represented, none dropped, every
  scope proven sweepable;
- the dry-run executed the full write path against real DEV constraints/privileges and rolled the
  entire transaction back; nothing was retained, including the `import_batches` row.

**Reading against §4b/§6c.** `dataIssuesOpened = 0` and no HALT occurred:
- the real 2026 DEV spine has no disappearance relative to the complete feed, so no
  `afl_api_match_absence` finding exists and none was opened;
- consequently no acknowledgement was required or performed, and
  `acknowledge-afl-api-match-absence.ts` was not invoked;
- residual 1 (retired-identity rekey) had no candidate case in this feed either, consistent with
  the ISSUE-244 F031 census of 0 `afl_api`-owned matches;
- `--apply` was explicitly **not** run as part of this acceptance.

**Prior evidence retained, not re-run.** The `code_test_db` rehearsal (§6c) stays 62/62 PASS,
residue 0 before and after. Actor decision (c) (§4b.6) is unchanged.

**Verdict: PASS.** The required DEV acceptance sequence (`--validate-only`, then `--dry-run`) is
satisfied. **ISSUE-231 is RESOLVED.**

**Not authorised / not performed by this closure pass:** `--apply`; any acknowledgement; any PROD
action; any change to ISSUE-229, ISSUE-232 or ISSUE-233 lifecycle state; no code or test change;
the PostgreSQL rehearsal was not rerun.
