# AFLDB-ISSUE-092 — `external_identities` reconciliation trusts an unproven-complete source population

**This file is the durable source of truth for ISSUE-092.** A fresh session must be able to
execute from `CLAUDE.md`, `docs/development/WORKFLOW.md`, this file, `issues.md` and `IssuesIndex.md` alone.
Do not rely on chat history.

## Status

```
Planning:       COMPLETE (§4 gate + §5 containment authorised for implementation via the
                AFLDB-ISSUE-093 Phase-3 session, 2026-08-25)
Implementation: §4 + §5 + §11 IMPLEMENTED (2026-08-25, ISSUE-093 Phase 3); re-verified
                against the working tree on 2026-08-28 — see §17.1.
Recovery:       SUPERSEDED BY REBUILD, with positive evidence (§17.2), not merely
                "obsolete because a rebuild starts empty". The canonical rebuild
                repopulated afltables external_identities itself, to 13,275.
Validation:     COMPLETE 2026-08-28 — 27/27, no skips, user-run against the rebuilt
                afldb_test (§17.5). Tests 24-27 executed and green.
ISSUE STATUS:   RESOLVED 2026-08-28.
Production:     NOT TOUCHED
Blocks:         NOTHING. AFLDB-ISSUE-090 is UNBLOCKED as of 2026-08-28 and remains OPEN
                for its own validation (§17.4).
```

**Implementation record (2026-08-25, ISSUE-093 Phase-3 session):**

- §4 gate: reusable `check_population_drop()` / `PopulationDropRefused` /
  `POPULATION_DROP_THRESHOLD = 0.10` added to `tools/migration/common.py` (reusable by
  the future fitzRoy importer per ISSUE-093 §9);
  `tools/migration/enrich_birth_dates.py` computes `stored_count` /
  `asserted_count` / `candidate_delete_count` in-transaction immediately before the
  `external_identities` DELETE and calls the gate. Check 1 (empty asserted population
  against stored rows) is refused unconditionally — deliberately NOT bypassable, per
  §4's "never legitimate; refuse unconditionally". Check 2 (>10% drop) is bypassable
  only via the new per-invocation `--acknowledge-population-drop`, logged via
  `Reporter.warn`.
- §5 containment: `--source-key` flag (default `afltables`) threaded through the
  sources lookup and `import_batch`; `dob-enrichment-issues.test.ts` seeds the
  `afltables_issue090_fixture` sources row idempotently at runtime, `runRegister()`
  always passes `--source-key`, and `cleanupIssue090Fixtures()` also clears the
  fixture source's `external_identities` rows.
- §11 tests added as tests 24–27 in `dob-enrichment-issues.test.ts` (containment;
  check-1 refusal incl. flag-does-not-bypass + batch marked failed; check-2
  refusal/acknowledgement; equal-or-larger and rebuild-from-empty no-false-positive).
- Static Phase-3 gate PASS 33/33 (user-run 2026-08-25) — proves the club-list wiring
  and that no existing static suite regressed; it does not exercise this issue's §11
  database tests.
- §12 validation NOT yet run *as at 2026-08-25*: at the time of writing the suite needed
  a live test database and there was no `afldb_test` (ISSUE-093 rebuild in progress).
  That constraint is GONE as of 2026-08-27, and the validation itself **completed on
  2026-08-28, 27/27 with no skips** — see §17.5. This bullet is preserved as the record
  of the state at implementation time only.

---

## 1. Confirmed root cause

`tools/migration/enrich_birth_dates.py:500-539` registers the AFL Tables profile URL as an
`external_identities` row for every player this run's register evidence resolves, and — to
stay re-runnable without accumulating stale rows under a since-changed key — deletes every
existing `external_identities` row for `(source_id, match_method='afltables_profile_url')`
whose `external_id` is **not** in the current run's asserted set (`:519-525`):

```python
cur.execute(
    """DELETE FROM external_identities
        WHERE source_id = %s
          AND match_method = 'afltables_profile_url'
          AND external_id <> ALL(%s)""",
    (source_id, [ext for _, ext, _ in identity_rows]),
)
```

This is correct **only if** the caller's supplied register (`AFLDB_LEGACY_SQLITE`) is the
**complete** current population. The importer never checks that assumption. It has no partial
mode (confirmed: `argparse` in `main()` offers only `--dry-run`/`--quiet`; unlike
`enrich_birth_dates_from_club_lists.py`'s `--csv-dir`, there is no scoped-population flag) and
`connect_legacy()` (`tools/migration/common.py:71-78`) only checks that the given SQLite file
*exists*, never that it is complete or plausibly sized.

`tests/integration/dob-enrichment-issues.test.ts` test 5 ("an existing club-list assertion
survives a real register run untouched", `:529-556`) invokes this exact code path for real —
`runRegister()` (`:216-224`) spawns `enrich_birth_dates.py --quiet` with no `--dry-run` —
against the **shared** `afldb_test` database, supplying a synthetic SQLite register built by
the test containing a single fixture row (`:541-545`). The DELETE's population predicate then
treats every real, non-fixture `afltables_profile_url` row as no-longer-asserted and removes
it. This is the only call site of `enrich_birth_dates.py` anywhere in the test suite (verified
by repository-wide search on the literal filename); no other test file can trigger this path.

**Not a migration 072 defect** (§2 below) and **not an `enrich_birth_dates_from_club_lists.py`
defect** — that importer never writes `external_identities` (verified: no reference to the
table anywhere in that file).

## 2. Blast radius

`afldb_test.external_identities` is currently **completely empty** (read-only grouped query by
`match_method`/`status` returned 0 rows, evidence recorded in `AFLDB-ISSUE-090.md`).

This is the *entire* table, not only the AFL-Tables scope, but investigation shows that is
expected rather than a wider mechanism: `external_identities` bridges third-party identities in
general (schema comment, `002_core_entities.sql:176-177`: "e.g. DraftGuru"), but **every other
identity-resolution path in the repository bypasses this table**:

- `docs/migration-inventory.md:52-53` lists the DraftGuru → `external_identities` bridge
  (`dg_people`/`person_links`) as **PLANNED**, not implemented.
- `tools/migration/import_awards.py`'s `load_person_links()` (`:1309-1321`) resolves
  `dg_person_id → player_id` directly from the DraftGuru SQLite staging table `person_links`
  into `award_winners`/etc., never touching PostgreSQL `external_identities`.
- `tools/migration/import_draft.py` resolves DraftGuru player identity through `draft_persons`
  directly (module docstring, `:15-17`), also never touching this table.
- A repository-wide search for `external_identities` returns exactly 8 files, none of which is
  another writer beyond `enrich_birth_dates.py` (`db-health.ts` only reads it for a link-quality
  dashboard; `044_schema_integrity.sql` only recreates an index).

**Therefore `enrich_birth_dates.py` is the table's sole writer today**, and its real population
in `afldb_test` was, in its entirety, the AFL-Tables profile-identity set the two newly-red
`release-gates.test.ts` gates expect (12,472 `unique`/`afltables_profile_url` rows). No other
feature's data was lost, because none existed yet. This has been proven by inspection, not
assumed from the empty-table count alone.

**Timeline (recorded in `AFLDB-ISSUE-090.md`):** the destructive DELETE first executed during
an earlier session's first genuine pre-migration ISSUE-090 validation run (the first run where
the psycopg dependency was present and the suite was not entirely `skipIf`-skipped), and again
during that session's later corrected green pre-migration rerun. Both predate this session's
19:45 pre-072 `afldb_test` dump, which was independently proven to already show
`COPY public.external_identities (...) FROM stdin; \.` with no data rows. **Migration 072 is
conclusively not implicated** — it never references `external_identities` or
`player_birth_evidence` anywhere in its SQL, and the destructive state predates its
application.

## 3. Two dimensions, both real, both required

### A. Integration-test isolation defect

`dob-enrichment-issues.test.ts` invokes a full-population-authoritative importer, for real,
against the shared `afldb_test` database, supplying a population that is a tiny strict subset
of the real one. Nothing in the test scopes the blast radius of that real invocation to the
test's own fixture data. This is a test-authoring defect: a deterministic regression suite must
never be able to destroy shared baseline state other tests and gates depend on.

### B. Importer fail-closed safety defect

Independent of the test: `enrich_birth_dates.py` has no explicit contract proving the source it
is given is complete before performing an authoritative deletion. A wrong path, a truncated
re-scrape, a partially-written file, or (as here) a synthetic/tiny file all produce the same
silent, total-population-loss outcome, in **any** environment including production. This is the
same defect class already named elsewhere in this repository as the `AFLDB-ISSUE-080` class
(an unscoped write that trusts its input as the authoritative full set) — `AFLDB-ISSUE-090`
already fixed this exact importer's `dob_conflict`/`dob_internal_conflict` reconciliation to be
evidence-based and population-scoped (§8/§10 of that runbook); this external-identity block
predates that fix and was never brought under the same discipline.

**Fixing only the test would leave a live production hazard. Fixing only the importer would
still let a shared test database go down every time this path is exercised without a completed
real source, which is not how a deterministic regression suite should behave.** Both dimensions
are in scope.

## 4. Approved safety contract (importer, §B)

Before the DELETE, inside the same transaction, compute:

- `stored_count` — existing `external_identities` rows for
  `(source_id, match_method = 'afltables_profile_url')`, read before this run's writes.
- `asserted_count` — `len(identity_rows)`, the population this run intends to assert as
  current.
- `candidate_delete_count` — stored rows whose `external_id` is not in this run's asserted set
  (the exact set the DELETE would remove).

**Fail closed (raise before any write; `import_batch`'s existing rollback-on-exception applies,
so nothing is left half-applied) when:**

1. `stored_count > 0 AND asserted_count == 0` — an authoritative pass asserting *nothing* for a
   source that already holds rows is never legitimate; refuse unconditionally.
2. `stored_count > 0 AND candidate_delete_count / stored_count > THRESHOLD` — protects against a
   partial/truncated/wrong source that still produces a non-zero but incomplete population.
   **Proposed default `THRESHOLD = 0.10` (10%)** — the AFL Tables historical register is
   effectively static/append-only, so legitimate run-to-run turnover should be far below this;
   flagged here as a decision for your approval, not silently assumed, and adjustable if you
   have better evidence of legitimate churn.
3. Bypass only via an explicit `--acknowledge-population-drop` CLI flag, required per-invocation
   (never a persisted default), and logged via the existing `Reporter.warn()` path so its use is
   visible in run output — for the rare genuine case (e.g. a corrected re-scrape legitimately
   dropping many stale profile URLs).

This check applies to **every** caller — dev, test, prod — identically. It is not test-specific,
so it protects production against the same class of accident (wrong/truncated
`AFLDB_LEGACY_SQLITE`) that caused this incident in `afldb_test`, satisfying the requirement
that the fix not merely relocate risk into production tooling.

**Recovery direction is unaffected by this gate by construction:** rebuilding from empty is a
pure insert (`asserted_count` large, `candidate_delete_count = 0`), so neither check fires.

## 5. Approved test containment design (§A)

1. **Fixture-scoped source identity.** `dob-enrichment-issues.test.ts` seeds a dedicated
   `sources` row at test runtime (not a migration — a plain idempotent
   `INSERT ... ON CONFLICT (key) DO NOTHING`, matching how the file already creates other
   fixture rows), e.g. `key = 'afltables_issue090_fixture'`. Because
   `external_identities_uq UNIQUE (source_id, external_id)` scopes uniqueness per source, this
   fixture source's rows can never collide with, shadow, or be confused for real `afltables`
   rows.
2. **`enrich_birth_dates.py` gains a `--source-key` override** (default `afltables`, the current
   hardcoded `SOURCE_KEY`), threaded into the existing `SELECT id FROM sources WHERE key = %s`
   lookup.
3. **`runRegister()` in the test passes `--source-key afltables_issue090_fixture`.** Its real
   invocation then only ever reads/writes/deletes rows scoped to the fixture `source_id` —
   structurally disjoint from the real population regardless of size, independent of the §4
   safety gate (which remains active as defense-in-depth, not as the only protection).
4. **`cleanupIssue090Fixtures()`** gets a narrow addition to also delete `external_identities`
   rows under the fixture `source_id` (in addition to its existing `player_id`-scoped delete),
   so the fixture source's own row count stays at or near zero between runs — cosmetic
   cleanliness, not a safety requirement, since the fixture source can never touch real data
   either way.

## 6. Recovery design — HISTORICAL; SUPERSEDED BY REBUILD, NEVER EXECUTED (see §17.2)

> **This recovery was never run and is NOT authorised. Do not execute any step below.** The
> 2026-08-27 canonical rebuild repopulated `afldb_test.external_identities` to **13,275** AFL
> Tables identities through `import_fitzroy_core.py` under this issue's own gate, which
> discharged the need for it (§17.2). The section is retained as the approved design of the
> day and as evidence of how the damage was to have been repaired — including the
> "unblocked" and HALT wording below, which reflects 2026-08-25 conditions and is not
> current. `AFLDB-ISSUE-090` is unblocked as of 2026-08-28 by §17.5, not by anything here.

The design as approved on 2026-08-25:

Recovery must not run until §4's importer fix is implemented and validated — otherwise recovery
would use the same vulnerable code path it is trying to repair the damage of.

```
0. Prove database identity: confirm AFLDB_IMPORT_DATABASE_URL for the recovery invocation
   resolves to afldb_test (the importer already prints `target: {safe_dsn(dsn)}` — review
   that line before proceeding; never assume).
1. Confirm the real, complete legacy source exists and is plausible on the execution host.
   .env.example:192 records AFLDB_LEGACY_SQLITE=/home/arm/projects/sports_data_lab/data/afl/afl.db
   as the documented convention, but this is a template default, not proof the live value on
   today's host is correct or that the file is complete — verify the live .env / file directly
   (read-only) before treating this path as authoritative, per your instruction.
2. --dry-run against afldb_test with the FIXED importer and the confirmed complete source;
   compare reported counts against the known expected shape (~15,310 register rows read,
   ~12,472 profile identities to register) before writing anything.
3. Real run (no --dry-run) once counts match expectation. The §4 gate should pass trivially —
   rebuilding from empty is pure insertion, not deletion, so neither fail-closed check fires and
   no --acknowledge-population-drop should be needed for this direction.
4. Validate via release-gates.test.ts's two external-identity gates specifically, then the full
   file.
```

**Recovery validation:** full `release-gates.test.ts` rerun. Expected: both external-identity
gates green again, net back to the pre-090 11 remaining failures (12 pre-090 minus the one
intended duplicate-issue fix), all pre-existing/unrelated parent-release drift. Only then does
`AFLDB-ISSUE-090`'s own next step (`tests/integration/privileges.test.ts`) become unblocked.

**Rollback/failure handling:** if dry-run counts do not match expectation, HALT — do not force a
real run. If the real run fails partway, `import_batch`'s existing rollback-on-exception
(`common.py:192-208`) already protects against a half-applied state inside one transaction; no
further mechanism is needed. No migration/down-migration is involved in recovery.

## 7. Does the 19:45 pre-072 dump still have value?

Yes, for its original purpose. It remains a valid `afldb_test` rollback point for what migration
072 actually changed (`data_issues`, `players.dob_disputed`) — migration 072 is confirmed not
implicated in this defect, and the dump correctly predates/matches state going into that
migration for those tables. It simply cannot serve a second purpose as an `external_identities`
recovery source, because it already reflects the emptied state (§2 timeline). No conflict: keep
it for its original role: §26 of `AFLDB-ISSUE-090.md`.

## 8. Schema/migration change required?

**No.** Every change identified is importer (`enrich_birth_dates.py`) or test
(`dob-enrichment-issues.test.ts`) code. `external_identities`'s table definition, unique
constraint and index are correct as they stand and are not implicated. The fixture `sources` row
in §5 is ordinary reference-data written by the test itself at runtime (the same pattern the
file already uses for fixture players), not a migration.

## 9. Other test files at risk

Confirmed by repository-wide search (literal filename match): `enrich_birth_dates.py` has
exactly one caller anywhere in `tests/` — `dob-enrichment-issues.test.ts` test 5. No other test
file invokes it, so no other test file is at risk of triggering this defect. (Other tests invoke
`enrich_birth_dates_from_club_lists.py` with synthetic data, but that importer never writes
`external_identities`, so it is out of scope for this specific defect — already established in
`AFLDB-ISSUE-090.md`'s own scoped fix for that importer's `data_issues` writes.)

## 10. Files expected to change (LANDED 2026-08-25; re-verified in-tree 2026-08-28 — §17.1)

| File | Change |
|---|---|
| `tools/migration/enrich_birth_dates.py` | §4 fail-closed population-sanity gate before the `external_identities` DELETE; new `--source-key` / `--acknowledge-population-drop` CLI flags |
| `tests/integration/dob-enrichment-issues.test.ts` | §5 fixture `sources` row + `--source-key` on `runRegister()`; `cleanupIssue090Fixtures()` addition |
| `AFLDB-ISSUE-092.md` | status/resolution update at close |
| `issues.md`, `IssuesIndex.md` | status/resolution update at close; `AFLDB-ISSUE-090` cross-reference already added when this issue opened |
| `CHANGELOG.md` | **not touched while this issue remains Open**, per instruction |

No migration file. No production file. No importer other than `enrich_birth_dates.py`.

## 11. Deterministic regression tests (IMPLEMENTED as tests 24–27; EXECUTED AND GREEN — §17.5)

Extend `dob-enrichment-issues.test.ts` (closest existing home; this file already owns real
register-pass coverage):

1. Real register run under the fixture source key does not touch any row under the real
   `afltables` source (seed a real-source-like row under the fixture's own isolated setup,
   confirm untouched — or simpler: assert `external_identities` row count under
   `source_id = afltables` is unchanged by a run that only ever uses the fixture key).
2. A run whose asserted population is empty against a source with existing rows is refused
   (§4 check 1) — no row deleted, non-zero exit, batch marked failed.
3. A run whose asserted population is a small fraction of the stored population is refused
   (§4 check 2) — construct stored rows exceeding `THRESHOLD`'s trip point under an isolated
   fixture source, then run with a tiny asserted set.
4. The same run succeeds when `--acknowledge-population-drop` is passed, and the drop is logged.
5. A run whose asserted population is legitimately the same size or larger than stored succeeds
   normally (no false positive) — covers ordinary re-runs and the recovery direction.
6. Existing test 5 continues to pass unmodified in intent (assertion-level content may need the
   new `--source-key` flag threaded through, but its proof — "an existing club-list assertion
   survives a real register run untouched" — is unchanged).

Exact fixture construction, table/column details, and threshold-boundary values are an
implementation-session task, not fixed here.

## 12. Validation sequence — HISTORICAL (as planned 2026-08-25); superseded by §17.5

> **This section is the plan as written in the planning session. It is retained as evidence of
> what was intended and is NOT live instruction. For what actually happened, and for the
> current state of ISSUE-090, read §17.5 and §17.4. Where this section and §17 disagree,
> §17 wins.**

The sequence as planned on 2026-08-25:

```
1. npm run typecheck (if the TS test-file change is non-trivial)
2. npm test -- tests/integration/dob-enrichment-issues.test.ts   (new regression tests + full file green)
3. Recovery sequence per §6, each step confirmed before the next
4. npm test -- tests/integration/release-gates.test.ts            (both external-identity gates green; net 11 remaining pre-existing failures)
5. npm test -- tests/integration/privileges.test.ts                (resumes AFLDB-ISSUE-090's own blocked step)
```

The original hold attached to that sequence — *"Do not run `privileges.test.ts` or resume
`AFLDB-ISSUE-090` release-gate work before step 4 is green"* — **applied only while ISSUE-092
was unvalidated. It was lifted on 2026-08-28 and must not be read as current.**

**What actually happened:**

- Step 2 ran and passed **27/27, no skips** (§17.5). That is this issue's acceptance result.
- Step 3 was **never run and is not authorised**: the §6 recovery was superseded by the
  2026-08-27 canonical rebuild, which repopulated the AFL Tables identities to 13,275 through
  the gated import path (§17.2).
- Steps 4 and 5 are **not ISSUE-092's to run**. They are `AFLDB-ISSUE-090`'s own remaining
  validation, and that issue is **unblocked as of 2026-08-28** and free to resume them (§17.4).
  Its two external-identity gates will read 13,275 against a stale pin of 12,472; that re-pin
  is an ISSUE-090 decision.

## 13. Non-goals

- Re-attempting, editing, or re-validating migration 072 — confirmed not implicated.
- `player_birth_evidence` — already idempotent/safe by unique-key upsert (`AFLDB-ISSUE-090.md`
  §17); not touched by this defect (upsert-only, no delete path).
- A general population-sanity-gate framework retrofitted onto every importer
  (`import_awards.py`, `import_draft.py`, `import_legacy_afl.py`, etc.) — scoped to
  `enrich_birth_dates.py`'s `external_identities` reconciliation only. The same defect class may
  exist elsewhere (c.f. `AFLDB-ISSUE-085`, already tracked separately for `import_captaincies`);
  a repository-wide sweep is explicitly out of scope here and not silently assumed safe
  elsewhere.
- Resolving the 11 pre-existing, unrelated `release-gates.test.ts` failures (draft/attendance/
  birth-date snapshot drift, 2026-snapshot-date) — parent-release scope, not ISSUE-090/092's.
- Re-pinning any release-gate expected value.
- Merging this issue back into `AFLDB-ISSUE-090`; each is resolved and recorded
  independently. (As written 2026-08-25 this bullet continued "`AFLDB-ISSUE-090` stays open,
  blocked on this issue". The *blocked* half expired on 2026-08-28: ISSUE-090 **stays open**
  but is **no longer blocked** — see §17.4. The separation of the two issues, which is what
  this non-goal is actually about, still holds.)
- Any production mutation, importer run, or backup restore in the planning session that produced
  this document.

## 14. Relationship to AFLDB-ISSUE-090

**Current (2026-08-28): `AFLDB-ISSUE-090` is UNBLOCKED and REMAINS OPEN.** It may resume its
own remaining validation — `release-gates.test.ts`, then `privileges.test.ts` — now. Nothing
in this issue gates it any longer. It is **not** resolved by this issue. See §17.4 for the
handover detail, including the 13,275-vs-12,472 re-pin decision that belongs to ISSUE-090.

**Historical — the blocking relationship as recorded 2026-08-25, now discharged:**

> `AFLDB-ISSUE-090` is blocked by this issue. Its own remaining validation
> (`release-gates.test.ts` full pass, then `privileges.test.ts`) cannot resume until:
>
> (a) this issue's importer + test fix is implemented and validated, and
> (b) `afldb_test.external_identities` is recovered per §6 and reverified via
>     `release-gates.test.ts`.

Condition (a) was met on 2026-08-28 (§17.5, 27/27 no skips). Condition (b) was **discharged by
supersession, not by execution**: the 2026-08-27 canonical rebuild repopulated the table to
13,275 through the gated import path, so the §6 recovery it referred to was never run and is
not authorised (§17.2).

`AFLDB-ISSUE-090`'s own scope (D1-D5, migration 072, the `dob_conflict`/`dob_internal_conflict`
lifecycle) is unchanged and unaffected by this issue.

## 15. Acceptance criteria

1. `enrich_birth_dates.py`'s external-identity reconciliation fails closed (no write, clear
   error, batch marked failed) when asked to treat an implausibly small or zero population as
   authoritative-complete, for any caller, without an explicit `--acknowledge-population-drop`.
2. `dob-enrichment-issues.test.ts` test 5 exercises the real register importer under a
   fixture-scoped source identity that cannot intersect real `afltables` data, independent of
   the safety gate.
3. Full `dob-enrichment-issues.test.ts` remains green (23/23 plus the new §11 tests) after the
   change.
4. ~~`afldb_test.external_identities` is restored to the expected population (12,472 `unique`
   `afltables_profile_url` rows) via §6, using the fixed importer only.~~
   **SUPERSEDED 2026-08-27 by the ISSUE-093 canonical rebuild (§17.2).** The population was
   restored by `import_fitzroy_core.py` under the `afltables` source during the rebuild, not
   by a §6 run of `enrich_birth_dates.py` against `AFLDB_LEGACY_SQLITE`. The count is
   consequently the canonical **13,275**, not the legacy-derived 12,472. No §6 recovery run
   is to be performed.
5. ~~`release-gates.test.ts` returns to 52 passed — the two external-identity gates green
   again, net 11 remaining pre-existing failures, none newly introduced.~~
   **NOT ISSUE-092-OWNED as written.** With the canonical population at 13,275, the
   `release-gates.test.ts` gate pinned at 12,472 measures the *rebuild's* dataset, not this
   issue's fix. Re-pinning a release-gate expected value is an explicit §13 non-goal here.
   That gate belongs to `AFLDB-ISSUE-090`'s own resumed validation; ISSUE-092 must not
   change it.
6. No schema/migration change introduced.
7. No production data touched at any point.
8. `privileges.test.ts` and `AFLDB-ISSUE-090`'s remaining validation sequence become unblocked.
   — **MET 2026-08-28.** They are unblocked and may resume; running them is ISSUE-090's work,
   not this issue's (§17.4).

## 16. HALT conditions — HISTORICAL (implementation/recovery session); none fired

> Retained as the safety contract the implementation and recovery sessions ran under. **None
> of these conditions fired.** The recovery-specific ones (dry-run counts, legacy source
> completeness, recovery database identity) were never reached, because the recovery was
> superseded rather than executed (§6 banner, §17.2). The issue is Resolved (§17.5), so this
> section is no longer an active stop list.

```
dry-run recovery counts do not match the expected shape (~15,310 read / ~12,472 registered);
the real legacy SQLite source cannot be confirmed complete/authoritative on the execution host;
the §4 threshold rejects a genuine legitimate production run (recalibrate, never bypass silently);
any evidence the fixture-source design does not fully prevent cross-population contamination;
any evidence player_birth_evidence or another table was also affected, contradicting current evidence;
database identity for the recovery run cannot be proven to be afldb_test;
any evidence migration 072 is, after all, implicated;
any other evidence materially invalidating this design.
```

Response to a material contradiction: stop, record the evidence in this file, report, wait for
review — same discipline as `AFLDB-ISSUE-090.md`.

---

## 17. Current truth (2026-08-28 verification session)

This section supersedes any earlier "not yet implemented" wording above. It was written after
reading the working tree, not chat history, and resolves the drift between the records that
said planning was complete-but-unimplemented and those that said §4/§5 already landed during
ISSUE-093 Phase 3. **The latter is correct.**

### 17.1 Implementation — present and complete, verified line by line

| Requirement | Where | Verified |
|---|---|---|
| §4 gate, reusable | `tools/migration/common.py:116-184` — `POPULATION_DROP_THRESHOLD = 0.10`, `PopulationDropRefused`, `check_population_drop()` | yes |
| §4 check 1 not bypassable | `common.py:160-166` raises on `asserted_count == 0` **before** `acknowledged` is consulted at `:167` | yes |
| §4 check 2 bypass + logged | `common.py:167-184`; `Reporter.warn` (`common.py:890-891`) prints unconditionally, so the acknowledgement is visible even under `--quiet` | yes |
| Gate called before the DELETE, in-transaction, on pre-write counts | `enrich_birth_dates.py:539-556` (single `SELECT count(*), count(*) FILTER (...)`) immediately preceding the DELETE at `:557-563` | yes |
| Deletion scoped to the rows this pass owns | `enrich_birth_dates.py:558-562` — `WHERE source_id = %s AND match_method = 'afltables_profile_url'`, with `source_id` resolved from `--source-key` at `:422-426` | yes |
| §5 `--source-key` containment | `enrich_birth_dates.py:389-390`, threaded into the `sources` lookup (`:422`) **and** `import_batch` (`:475`) | yes |
| §5 fixture source seeded at runtime | `dob-enrichment-issues.test.ts:305-314` — idempotent `INSERT ... ON CONFLICT (key) DO NOTHING` for `afltables_issue090_fixture`; no migration | yes |
| §5 every real register invocation contained | `runRegister()` (`:230-243`) always passes `--source-key FIXTURE_SOURCE_KEY`; it is the suite's only spawn of this importer, so test 5 (`:571-598`) is contained too | yes |
| §5.4 cleanup extension | `cleanupIssue090Fixtures()` (`:266-282`) also clears `external_identities` under `fixtureSourceId` | yes |
| §11 acceptance tests | tests 24–27, `dob-enrichment-issues.test.ts:605-735` | yes |
| §8 no schema change | no migration touches this; the fixture `sources` row is runtime data | yes |
| Fail-closed default | the gate runs on every invocation; only check 2 is bypassable, and only per-invocation | yes |

Two supporting facts that make tests 25/26 sound, both confirmed in `common.py`:

- `ImportBatch.__post_init__` **commits the batch row before the block runs** (`:210-223`), and
  `import_batch` rolls back and then marks `status='failed'` on exception (`:262-279`). Test
  25's `import_batches ... status = 'failed'` assertion therefore survives the rollback.
- `enrich_birth_dates.py` has **no early return for an empty register**, so test 25's zero-row
  fixture genuinely reaches the gate rather than exiting 0 beforehand.

Deliberately **not** changed: the `dob_conflict` details still record the literal
`"source": SOURCE_KEY` (`enrich_birth_dates.py:78`, `:217`) regardless of `--source-key`. That
string is an ISSUE-090 *pass label* and part of that issue's issue-identity/dedup contract
(tests 1/2 compare `details` for equality). Rewriting it to `args.source_key` would change
ISSUE-090 semantics for no ISSUE-092 benefit; §5 scoped `--source-key` to the sources lookup
and `import_batch` only, and it stays that way.

### 17.2 Recovery — superseded by the ISSUE-093 rebuild, with positive evidence

The Status block previously reasoned that §6 was obsolete because "a rebuilt database starts
empty". That reasoning was incomplete and is now replaced by direct evidence: **the canonical
rebuild repopulates this exact table itself.**

- `tools/migration/import_fitzroy_core.py` writes `external_identities` under
  `SOURCE_KEY_AFLTABLES = 'afltables'` with `MATCH_METHOD = 'afltables_profile_url'`
  (`:89`, `:100`, `:1497`) — reusing this issue's own `check_population_drop` gate at
  `:1473-1478`, per ISSUE-093 §9.
- `tools/db/rebuild-test.ts:521-523` defines the Stage 9 `players` gate as
  `SELECT count(*) FROM external_identities ei JOIN sources s ON s.id = ei.source_id WHERE s.key = 'afltables'`.
- That gate read **13,275** in the passing 2026-08-27 rebuild
  (`AFLDB-ISSUE-093.md` §H15.4, `AFLDB-FINAL-VALIDATION PASSED: 13 checks`).

So `afldb_test.external_identities` is populated again — canonically, by the frozen fitzRoy
source, through the gated importer. **No §6 recovery run is required or authorised.** The old
emptied database is preserved read-only as `afldb_test_pre_rebuild_20260825` and is never an
input. §2's incident record and the §1 root cause stand unchanged as historical evidence.

The count difference (13,275 canonical vs the old 12,472 legacy-derived) is expected: the
population now comes from a different, authoritative source. It is a release-gate pinning
question for `AFLDB-ISSUE-090`, not a defect of this issue — see the amended §15.4/§15.5.

### 17.3 What remained ISSUE-092-owned — DONE

Exactly one thing: **run the acceptance tests**. No code, no schema, no recovery, no
release-gate change. Executed 2026-08-28 — see §17.5.

```
npm test -- tests/integration/dob-enrichment-issues.test.ts
```

Preconditions were already satisfied by the rebuilt database: migrations 75/75 with 072
applied (the suite gates tests 15–18 on `afldb_meta.schema_migrations`); a `sources` row
keyed `afltables` (`data/reference/sources.json:12`); club organizations `University` and
`Brisbane Bears` (`:322-332`).

### 17.4 Effect on AFLDB-ISSUE-090

§17.3 is green, so ISSUE-092's acceptance conditions (§15.1–§15.3, §15.6–§15.7) are met, the
blocking hazard is gone, and **ISSUE-090 is UNBLOCKED for its own remaining validation**
(`release-gates.test.ts`, then `privileges.test.ts`). ISSUE-090 must expect its two
external-identity gates to read **13,275** against a stale pin of **12,472** and to decide
that re-pin under its own scope; 12,472 must not be silently reinstated. **ISSUE-090 remains
OPEN, is not resolved by this issue, and was not edited by it** beyond the one-line ledger
truthfulness update removing the now-false "blocked by ISSUE-092" statement.

### 17.5 Acceptance validation — PASSED 2026-08-28

User-run against the rebuilt `afldb_test`:

```
npm test -- tests/integration/dob-enrichment-issues.test.ts

Test Files  1 passed (1)
Tests      27 passed (27)
Duration   16.46s
no skips
```

The §11 acceptance block executed and passed — these tests are now **executed and green**,
not merely authored:

| Test | Proves |
|---|---|
| 24 | a fixture-source run cannot touch the real `afltables` population (§5 containment) |
| 25 | an empty asserted population is refused **unconditionally**, including with `--acknowledge-population-drop`; no row deleted; batch marked `failed` (§4 check 1) |
| 26 | an over-threshold drop is refused by default and permitted **only** with the explicit acknowledgement flag, which is logged (§4 check 2) |
| 27 | an equal-or-larger asserted population passes with no false positive — ordinary rerun and the rebuild-from-empty direction (§11.5) |

The remaining 23 tests in the file — ISSUE-090's own reconciliation suite, including test 5's
"an existing club-list assertion survives a real register run untouched" — stayed green under
the fixture-scoped source key, so §5 containment did not regress the existing contract.

An earlier run of this suite reported skips. That was a **worktree Python-environment
artefact** (the suite `skipIf`-skips without importable `psycopg` and the role-parity DSNs)
and is explicitly **not** validation evidence. This 27/27 run is the authoritative result.

**AFLDB-ISSUE-092 is RESOLVED as of 2026-08-28.** The safety invariant it existed to
establish now holds and is regression-covered: a partial or synthetic population cannot
delete unrelated real `external_identities`, the default fails closed, the only bypass is
per-invocation and logged, the zero-population case has no bypass at all, and a fixture
invoking the real importer is contained by source ownership rather than by mocking the
importer away.
