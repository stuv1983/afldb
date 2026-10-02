# AFLDB-ISSUE-230 — `afldb_test` 2099 AFL Tables observation clock

**RESOLVED 2026-10-02, with no repair.** The operator-run read-only census (§3) measured
the whole `afldb_test` observation spine as empty. The contaminated 2099 lineage is
absent. No re-stamp, rebuild, code change or regression test was needed, and none was
executed for this issue.

Base `main` @ `2940cdb2`, branch `sonnet/issue-230-test-clock-hygiene`.
- The investigation pass and this closure pass were documentation only.
- Neither pass contacted any database or ran any Git operation.
- The only database contact was the operator's guarded read-only census (§3a), which
  ended with ROLLBACK.

## 0. Resolution

- **Disposition.** Resolved with no repair. The contaminated historical test lineage is
  measured absent (§3a). That subsequent destructive `afldb_test` reset/rebuild activity
  removed it is historical inference from repository history, which strongly supports it;
  the census does not identify which reset did so.
- **What the census measures.** Every C1–C4 result was reviewed together (§3a):
  - all three staging observation tables hold 0 rows;
  - there is no source/family/scope lineage (C2);
  - there is no `season=2026` AFL Tables lineage (C3);
  - there are 0 canonical 2026 matches (C4).

  So the problematic lineage is absent. There is no 2093/2094 synthetic future-clock
  residue either, because every staging observation table is empty.
- **What the census does not measure.** It does not identify *which* event removed the
  lineage. The attribution to the 2026-09-24 (I18) and 2026-09-25 (ISSUE-237 L3)
  `db:test:rebuild` resets comes from repository history (§1), not from the census. A
  later reset (§1, 2026-10-01 row) may also have contributed.
- **Not done, by design.** Nothing was repaired: no re-stamp, no rebuild for this issue,
  no database mutation, no code or test change. §4 stays as reference only.
- **Out of scope.** Benchmark hardening and future-clock prevention are out of scope:
  - benchmarks would run in a rolled-back transaction or a disposable database;
  - a guard would refuse a future `observedAt`.

  This closure does not open a successor issue.

## 1. Repository-history context (inference, superseded by the §3a measurement)

The 2026-10-02 investigation inferred the following from the tracker before any
measurement. The census in §3a has since replaced the inference "very probably already
gone" with a measured result: the lineage is absent. The causal attribution below
remains inference.

| Date | Event | Effect on the 2099 lineage | Source |
|---|---|---|---|
| 2026-09-06 | Settle benchmark, batches 103–105, injected `observedAt` 2099-01-02..04 | created | `issues.md` "Stage 5 handoff" |
| 2026-09-23 | ISSUE-228 S9 continues the clock: batches 2421 (2099-01-05) and 2422 (2099-01-06) | extended | `issues/closed/AFLDB-ISSUE-228.md` §22.14 |
| 2026-09-24 | I18 `db:test:rebuild` of `afldb_test` | **would have dropped it** (inferred, not measured): `RESET_SQL` drops every non-public schema, `staging` included (`tools/db/rebuild-test.ts:2058-2067`) | `issues.md` ISSUE-245/237 |
| 2026-09-25 | ISSUE-237 L3 `db:test:rebuild` of `afldb_test` | reset again; afterwards "max season 2025, 0 matches and 0 `player_match_stats` for 2026" | `issues/closed/AFLDB-ISSUE-237.md` §11a.6; `issues.md` ISSUE-237 |
| 2026-09-27 | ISSUE-252 fresh rebuild + `db:promotion:prepare-source --apply`: AFL Tables first apply, batch 29, 11,935 inserted | new 2026 lineage on the **real clock**: `prepare-promotion-source.ts:607-613` calls the unmodified `runSettleCli` argv path; `settle-afltables.ts` CLI never sets `observedAt`, so `runSettleAfltables` uses `new Date()` (`src/lib/acquisition/settle-afltables.ts:1818`) | `issues.md` ISSUE-252 eighth pass |
| 2026-09-28 | ISSUE-237 L5: rebuilt source dump `afldb_test_rebuilt_20260928-101642.dump` | — | `issues/closed/AFLDB-ISSUE-237.md` §16.2 |
| 2026-10-01 | ISSUE-233 passes 7–9: "`afldb_test` bridge 0/669 (no 2026 matches)" | `afldb_test` holds no 2026 canonical matches, which implies a further reset after the 09-27/28 preparation. This pass did not itemise that reset. | `issues.md` Open Issues row, ISSUE-233 |

Search check (investigation pass):
- `issues.md` and `issues/` record no injected `observedAt` anywhere after ISSUE-228
  §22.14.
- No tracked tool in `tools/` injects `observedAt` into an AFL Tables settle.
- Four tools do pass an `observedAt`, none of them into an AFL Tables settle: the AFL API
  rehearsals, the DEV ISSUE-225 probe, and `settle-afl-api-fixtures.ts`.

The 2026-10-02 census agrees with this history. It finds an empty spine and 0 canonical
2026 matches, consistent with the 2026-10-01 ISSUE-233 record.

## 2. Invariant and root cause (reference)

- `staging.source_records_seen_ck CHECK (last_seen_at >= first_seen_at)` and
  `source_records_absent_ck CHECK (absent_since IS NULL OR absent_since >= first_seen_at)`
  (`src/db/migrations/074_source_observation_spine.sql:127-128`).
- `staging.source_record_versions_interval_ck CHECK (observed_to IS NULL OR observed_to > observed_from)`
  (`:83`). A *changed* payload at a real clock behind a 2099 head would close the open
  version with `observed_to < observed_from`. That fails here too, not only on `seen_ck`.
- **How it failed.** `persistSourceObservation`
  (`src/lib/acquisition/observation-store.ts:104-175`) writes `last_seen_at = observedAt`
  on every observed key, and `observed_to = observedAt` on a change. With
  `first_seen_at`/`observed_from` = 2099 and `observedAt` = now, the row violates the
  CHECK.
- **Timestamps are not identity.**
  - The `payload_hash` is content-only. `decideObservation`
    (`src/lib/acquisition/observations.ts:254-299`) uses `observedAt` only as a presence
    check.
  - Version identity is `version_seq`. The keys are
    `(source_id, family, external_record_id[, version_seq])`.
  - `import_batches.started_at` is always the DB `now()` (`settle-afltables.ts:1838`,
    default in `001_foundations.sql:59`), never `observedAt`.
- **The complete set of `observedAt`-derived columns:**
  - `source_records.{first_seen_at,last_seen_at,absent_since}`;
  - `source_record_versions.{observed_from,observed_to}`;
  - `source_payloads.first_stored_at`.
- The CHECKs are correct. The defect was an operational injection of a future clock on a
  test database, not a code defect.

## 3. Confirming census (operator-run, read-only, `afldb_test` only)

Run as `afldb_import` or `afldb_owner` against a DSN whose path names `afldb_test`. The
guard aborts on any other database and on a read-write session.

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database() AS db, current_user AS role,
       current_setting('transaction_read_only') AS ro, now() AS db_now;
DO $$ BEGIN
  IF current_database() <> 'afldb_test' THEN
    RAISE EXCEPTION 'STOP: % is not afldb_test', current_database(); END IF;
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'STOP: session is not read-only'; END IF;
END $$;

-- C1. Headline: any future-dated observation timestamp anywhere on the spine.
SELECT 'source_records' AS tbl,
       count(*) FILTER (WHERE first_seen_at > now() OR last_seen_at > now()
                           OR absent_since > now()) AS future_rows,
       count(*) AS all_rows
  FROM staging.source_records
UNION ALL
SELECT 'source_record_versions',
       count(*) FILTER (WHERE observed_from > now() OR observed_to > now()), count(*)
  FROM staging.source_record_versions
UNION ALL
SELECT 'source_payloads',
       count(*) FILTER (WHERE first_stored_at > now()), count(*)
  FROM staging.source_payloads;

-- C2. Per source / family / scope (shows any non-2026 or non-afltables implication).
SELECT s.key AS source, r.family, r.scope_key, count(*) AS heads,
       count(*) FILTER (WHERE r.first_seen_at > now() OR r.last_seen_at > now()
                           OR r.absent_since > now()) AS future_heads,
       min(r.first_seen_at) AS min_first_seen, max(r.last_seen_at) AS max_last_seen,
       count(DISTINCT r.last_batch_id) AS last_batches,
       min(r.last_batch_id) AS min_last_batch, max(r.last_batch_id) AS max_last_batch
  FROM staging.source_records r JOIN sources s ON s.id = r.source_id
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- C3. 2026 AFL Tables lineage: observation clock vs the batches' real start times.
SELECT v.opened_by_batch_id AS batch, b.tool, b.status, b.started_at,
       min(v.observed_from) AS min_observed_from, max(v.observed_from) AS max_observed_from,
       count(*) AS versions
  FROM staging.source_record_versions v
  JOIN sources s ON s.id = v.source_id AND s.key = 'afltables'
  JOIN staging.source_records r
    ON r.source_id = v.source_id AND r.family = v.family
   AND r.external_record_id = v.external_record_id
  JOIN import_batches b ON b.id = v.opened_by_batch_id
 WHERE r.scope_key = 'season=2026'
 GROUP BY 1, 2, 3, 4 ORDER BY 1;

-- C4. Canonical context (corroborates the ISSUE-233 "no 2026 matches" record).
SELECT count(*) AS matches_2026 FROM matches WHERE season = 2026;

ROLLBACK;
```

Acceptance reading, as applied at closure: C1–C4 are reviewed **together**. C1 alone is
not the gate.
- C1 shows no future-dated row.
- C2 and C3 show whether any lineage exists, and if so which population and clock it
  carries.
- C4 gives the canonical context.

The investigation drafted this branching for a non-empty result (not needed at closure):
- Future rows in the `season=2094`/`issue099-` integration-fixture namespace are
  test-suite residue on a non-real season, not ISSUE-230.
  `tests/integration/settle-afltables.test.ts:174-194` uses 2093/2094 clocks.
- Future rows on a real season's `afltables` keys would have pointed to §4.

### 3a. Recorded census result (operator-run, 2026-10-02)

The operator ran the census through the existing `127.0.0.1:55432` SSH tunnel.

**Connection and guard:**
- database `afldb_test`, role `afldb_owner`, `transaction_read_only` = `on`;
- `db_now` = `2026-10-02 12:49:05.776327+10`;
- `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
- the server-side database/read-only `DO` guard passed;
- the transaction ended with `ROLLBACK`.

**C1:**

| Table | `future_rows` | `all_rows` |
|---|---|---|
| `staging.source_records` | 0 | 0 |
| `staging.source_record_versions` | 0 | 0 |
| `staging.source_payloads` | 0 | 0 |

**C2:** 0 rows. No source/family/scope observation lineage is present.

**C3:** 0 rows. No `season=2026` AFL Tables observation lineage is present.

**C4:** `matches_2026` = 0.

**Conclusion:**
- The contaminated 2099 lineage is absent from `afldb_test`.
- So is any 2093/2094 synthetic future-clock residue, because all three staging
  observation tables are empty.
- ISSUE-230 is resolved with no repair.

## 4. Contingency (reference only; NOT executed)

The §3a census found no lineage at all, so neither option below was used. They stay here
as the analysis for any future recurrence.

**Option B: real-clock rebuild (preferred contingency).** The existing supported path is
`npm run db:test:rebuild -- --target afldb_test --acknowledge-destroy afldb_test ...`.
- It is the §11c sequence of the ISSUE-237 runbook, with its DSN, marker and
  pending-capture pre-checks.
- It can continue with `npm run db:promotion:prepare-source -- --apply ...` (ISSUE-252).
  That re-acquires 2026 offline, on the real clock, from a retained hash-bound snapshot.
- It needs no network and no new code.
- Blast radius: the whole database.
  - Human state is carried only by the ISSUE-235/237/245 capture stages.
  - `data_edits` is not carried.
  - Batch ids restart.

**Option A: re-stamp (only if a rebuild is unacceptable).** It must be a guarded tool,
never ad-hoc SQL.

Changing `source_records` alone is **insufficient**. The versions' `interval_ck` and
`source_payloads.first_stored_at` carry the same clock.

The design that does not falsify provenance maps every `observedAt`-derived value to the
**real** start time of the batch that wrote it:
- `observed_from` → `started_at(opened_by_batch_id)`;
- `observed_to` → `started_at(closed_by_batch_id)`;
- `first_seen_at` → `started_at` of the opener of `version_seq = 1`;
- `last_seen_at` → `started_at(last_batch_id)`;
- `first_stored_at` → min re-stamped `observed_from` of the versions that reference the
  payload.

The tool refuses unless every precondition holds:
- the target is `afldb_test` and read-write, both proven, and an owner-role dump was taken
  first;
- the affected batches' `started_at` values increase strictly in batch order. This keeps
  relative order and `interval_ck`'s strict `>`;
- every future `absent_since` maps unambiguously, because the absent-stamping batch is not
  stored;
- every re-stamped value is ≤ `now()`.

Its safety contract:
- The pre/post fingerprint is sha256 over every non-timestamp column of the three tables,
  keyed by PK. It must be identical.
- Only the six columns may change, and only on the census rows.
- It runs in one transaction, and a rerun finds 0 rows.
- Rollback is the dump.

**Test.** No regression test was needed or added: the CHECKs are correct, and the defect
was an operational injection, not code. If Option A is ever built, extend
`tests/integration/settle-afltables.test.ts`:
1. In a rolled-back transaction, seed a key at a future `observedAt`. A later
   earlier-clock observation must refuse on `source_records_seen_ck`.
2. Re-stamp, and the same observation must succeed.
3. `version_seq`, `payload_hash` and the batch ids must be unchanged.
