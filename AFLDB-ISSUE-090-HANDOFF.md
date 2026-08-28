# AFLDB-ISSUE-090 — Resume Handoff (2026-08-28)

> **CLOSED — `AFLDB-ISSUE-090` is Resolved (2026-08-28). See §13.** This file is now a
> historical record with no resume point and no next action. Sections 1-9 describe
> pre-resolution state and are retained as lineage; §8 is superseded by
> `AFLDB-ISSUE-090.md` §27.4.

**Purpose.** This file is the durable resume point for `AFLDB-ISSUE-090` as of
2026-08-28, capturing the **verified current state of the tree and database**, not the
original plan. A fresh session should read `CLAUDE.md`, this file, the `AFLDB-ISSUE-090`
entries in `issues.md` / `IssuesIndex.md`, and only then `AFLDB-ISSUE-090.md` for design
detail.

**Standing relationship to the old runbook (§10 below is the formal statement):** for
*resume purposes* this file supersedes the stale `Status / handoff` and HALT sections at
the top of `AFLDB-ISSUE-090.md`. The approved design — §5 ownership model, §6 D1
fingerprints, §7/§8 processed populations, §9 D3, §10 reconciliation, §11 D2 index,
§12 migration order/preconditions, §13 D5, §22 HALT conditions, §25 acceptance criteria —
remains authoritative and unchanged.

---

## 1. Worktree / Git

| Item | Value |
|---|---|
| Working directory | `D:\dev\afldb-issue-090` (isolated worktree — do **not** work in `D:\dev\afldb`) |
| Branch | `claude/issue-090` |
| Base / current HEAD | `c4659ac` — *docs: close out ISSUE-096 and repair issues index* |
| `git status --short` | **empty — clean working tree, nothing staged, nothing untracked** |
| Session changes | **None.** No implementation, test, migration, ledger or expectation file was modified in the session that wrote this handoff. Inspection only. |

All ISSUE-090 implementation artefacts are **already committed** (the ISSUE-090 code first
appears in `cc9b6f7`, *chore: checkpoint validated AFLDB work through ISSUE-093*). Nothing
has been committed, merged, pushed or deployed by this session.

---

## 2. Current implementation facts (verified in source, 2026-08-28)

### 2.1 Ownership discriminator

Ownership is expressed by the **pass key inside `data_issues.details.disputed_by`** —
`club_list` vs `register` — inside a `version: 2` payload. It is **not** the source key:
both passes set `SOURCE_KEY = 'afltables'`, so `details->>'source'` cannot discriminate
them (runbook §3.3). One unresolved `dob_conflict` row per player aggregates every current
assertion, keyed by pass.

Payload shape (runbook §5.1): `{ "version": 2, "disputed_by": { "club_list": [...],
"register": [...] }, "resolution": "manual review required" }`, each assertion carrying
`source`, `external_id`, `asserted`, `existing_at_detection` (and `club` for club-list).
Keys serialised sorted so a rerun writes a byte-identical payload.

### 2.2 Club-list pass — `tools/migration/enrich_birth_dates_from_club_lists.py:202-327`

- `reconcile_club_list_conflicts(...)` runs inside the caller's already-open `import_batch`
  transaction and returns only the affected player ids (for the D5 recompute — never a
  global sweep).
- **Owned population** (`:263-272`): players with fresh evidence this run (`mine`) **plus**
  any existing unresolved row whose `club_list` assertion names a file this run actually
  processed (`a.get("club") in processed_file_keys`).
- Per-file evidence sets `conflicts_by_file` / `agreements_by_file` / `fills_by_file` /
  `rejected_by_file` (`:219-230`) drive the §7 outcome table at `:285-297`: unprocessed
  file → retain; fresh conflict → replaced; rejected (present but unmatchable) → retain;
  agreed / filled / vanished → delete.
- **Foreign ownership is copied through untouched:** `register_assertions` are read at
  `:283` and re-attached verbatim at `:302-303`. The club-list pass can never remove a
  register assertion.
- D1 suppression (`:239-251`): resolved `dob_conflict` rows are expanded into fingerprints
  and an identical previously-adjudicated assertion is not refiled.
- Empty `disputed_by` after reconciliation → the row is deleted (`:305-309`); otherwise
  `UPDATE` in place, preserving `id` and `detected_at` (`:313-317`).

### 2.3 Register pass — `tools/migration/enrich_birth_dates.py:172-295`

- **Owned population** (`:189-195`): exactly the players this run produced evidence for —
  `to_fill ∪ source_conflicts ∪ internal_conflicts ∪ agreements`. A player carrying a
  register assertion but touched by none of those is left alone (§8: absence from the
  resolved population is not authoritative cessation).
- The unresolved-row read is scoped: `... AND resolved_at IS NULL AND entity_id = ANY(%s)
  FOR UPDATE` (`:221-228`).
- **Foreign ownership is copied through untouched:** `club_list_assertions` read at `:241`
  (commented *"never touched by this pass"*) and re-attached at `:245-246`.
- D1 suppression with the documented shape-A asymmetry (`:206-219`): a legacy shape-A
  resolved row carries no `external_id`, so suppression ignores `external_id` on both sides
  via `r_register_partial`. This asymmetry is deliberate (runbook §6.2) — do not "tidy" it.
- `dob_internal_conflict` is a **scoped** delete-then-refile over the same owned population
  (`:275-292`, `entity_id = ANY(%s)`).

### 2.4 The old unscoped delete is gone

The historical defect — `DELETE FROM data_issues WHERE entity_type='player' AND issue_type
IN ('dob_conflict','dob_internal_conflict') AND resolved_at IS NULL` with **no** ownership
or population predicate (`enrich_birth_dates.py:407-412` as it stood) — no longer exists in
either importer. Every delete is now either row-scoped by `id` after reconciliation decided
the payload was empty, or population-scoped by `entity_id = ANY(owned)`.

### 2.5 Plain `INSERT`, and why migration 072 is the structural backstop

Runbook §10 step 5 specified `INSERT ... ON CONFLICT (entity_type, entity_id, issue_type)
WHERE ... DO UPDATE`. **Both importers instead issue a plain `INSERT`** (club-list
`:319-324`, register `:263-269`). This is the recorded deviation at `AFLDB-ISSUE-090.md`
lines 56-71, and it is **not** a contract change:

- `ON CONFLICT` against a *partial* index requires that index to already exist, but the
  approved validation sequence runs the new suite's pre-migration subset **before**
  migration 072 creates `uq_data_issues_open_dob_per_player`; an `ON CONFLICT` insert would
  have raised *"no unique or exclusion constraint matching the ON CONFLICT specification"*
  on the very first pre-migration test.
- The guarantee actually relied upon is the `SELECT ... FOR UPDATE` over the owned
  population followed by an in-transaction INSERT-vs-UPDATE decision — that is the
  mechanism §10's guarantees table depends on.
- **Migration 072's partial unique index is therefore the structural duplicate backstop**,
  not the active write-path mechanism:

  ```sql
  CREATE UNIQUE INDEX uq_data_issues_open_dob_per_player
    ON data_issues (entity_type, entity_id, issue_type)
    WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict')
      AND resolved_at IS NULL;
  ```

  It permits one open `dob_conflict` *and* one open `dob_internal_conflict` per player,
  leaves resolved history unbounded, and does not constrain any other `data_issues` writer.

Migration 072 also performed the one-off repair: normalise legacy shapes A/B to v2, merge
duplicate unresolved groups losslessly (survivor `MIN(id)`, so first-detection is kept),
recompute `players.dob_disputed` for the affected players only, then create the index —
behind the §12.2 fail-closed preconditions.

---

## 3. What is already proven

| Fact | Evidence |
|---|---|
| Migration **072 applied** to `afldb_test` | applied 2026-08-25 per runbook; `db:status` 72/72, 0 pending at the time |
| Migration state now **through 075** | `src/db/migrations/` holds `072_dob_conflict_ownership.sql`, `073_data_overrides.sql`, `074_source_observation_spine.sql`, `075_data_overrides_fk_index.sql`; `AFLDB-ISSUE-096` recorded **75/75 applied, 0 pending, no drift** on `afldb_test` (2026-08-28), fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227` |
| Focused DOB enrichment suite **27/27** | `npm test -- tests/integration/dob-enrichment-issues.test.ts` — 27 passed, no skips, user-run 2026-08-28 against the rebuilt `afldb_test` (tests 1-23 ISSUE-090, tests 24-27 ISSUE-092) |
| **ISSUE-092 Resolved, no longer blocks ISSUE-090** | fail-closed `check_population_drop()` + `--source-key` containment validated 2026-08-28; the `external_identities` population was repopulated to 13,275 by the 2026-08-27 canonical rebuild; the release-gates halt is **lifted** |
| `afldb_test` was **canonically rebuilt** 2026-08-27 | `AFLDB-ISSUE-093` §H15: nine stages, Stage 9 `AFLDB-FINAL-VALIDATION PASSED: 13 checks` |
| The register test path can no longer wipe the real population | `tests/integration/dob-enrichment-issues.test.ts:237` passes `--source-key FIXTURE_SOURCE_KEY` to the real register importer |

### What the 27/27 suite actually proves (test titles as implemented)

Club-list: **1/2** rerun idempotent + stable issue identity · **3** two club files retain
distinct assertions · **6** unprocessed file scope untouched by a partial run · **7**
authoritative agreement removes the assertion · **8** present-but-unmatchable record
retained (failed match ≠ cessation) · **9** record deleted from a processed file is cleaned
up.
Cross-pass isolation: **4** register assertion survives a club-list run · **5** club-list
assertion survives a **real** register run.
ISSUE-092 gate: **24** fixture-source run cannot touch the real afltables population ·
**25** empty asserted population refused · **26** over-threshold drop refused, permitted
only with `--acknowledge-population-drop` · **27** equal-or-larger population passes.
D1: **10** identical legacy shape-B resolved assertion not refiled · **11** identical v2
resolved not refiled · **12** changed `asserted` filed as new · **13** changed
`players.dob` baseline filed as new · **14** suppression is assertion-specific.
Migration 072: **15** normalises shapes A/B to v2 · **16** merges duplicate groups
losslessly · **17** every §12.2 precondition aborts · **17b** duplicate unresolved
`dob_internal_conflict` group aborts · **18** unique index rejects a second unresolved DOB
row while permitting resolved history and a coexisting `dob_internal_conflict`.
D5: **19** clears · **20** stays true · **21** becomes true.
Harness: **22** the real global release-gate duplicate invariant (deliberately **not**
fixture-scoped — never weaken it) · **23** no fixture residue.

**Not yet run in the current sequence:** `tests/integration/release-gates.test.ts` and
`tests/integration/privileges.test.ts`.

---

## 4. Ledger / runbook contradictions found (documentation-side only)

No source defect is implied by any of these. Each is stale text that a resuming session
must not read as current.

1. **`issues.md:6324` — "### Fix — Not yet implemented".** False. The §10 reconciliation is
   implemented in both importers (§2 above) and migration 072 exists and is applied. The
   same entry's own header bullets already say so.
2. **`issues.md:6333` — "### Validation — Not yet performed. Step 0 ... has not been run."**
   False. Step 0 PASSED on 2026-08-25 (evidence retained in `AFLDB-ISSUE-090.md`), the
   pre-migration subset passed, and the focused suite is 27/27.
3. **`AFLDB-ISSUE-090.md:51` — "Nothing has been committed or staged"**, and the §20.1
   *"Working-tree state at handoff"* list of modified files. Both stale: the ISSUE-090
   implementation is committed and the worktree is clean at `c4659ac`.
4. **`AFLDB-ISSUE-090.md` `Status / handoff` block and the HALT sections** are frozen at
   2026-08-25 (`Post-migration validation: HALT`, `Parent release: HALTED`,
   `release-gates.test.ts` blocked on ISSUE-092). **Superseded by the 2026-08-28 unblock**
   recorded in `issues.md` and `IssuesIndex.md`. The historical HALT narrative is correct
   as lineage and must be preserved, not rewritten.

**Consistent, verified, no contradiction:** the plain-`INSERT`-instead-of-`ON CONFLICT`
deviation recorded at `AFLDB-ISSUE-090.md:56-71` matches the current source exactly.

---

## 5. 12,472 vs 13,275

### 5.1 The three `12_472` pins currently in `tests/integration/release-gates.test.ts`

| Line | Assertion | Scope owner |
|---|---|---|
| `:632` | `player_birth_evidence` count `= 12_472` (and `players WHERE dob_evidence_id IS NOT NULL = 11_533`), inside `gate: birth dates` → *"keeps the evidence behind every recovered date"* | **NOT ISSUE-090.** One of the pre-existing `gate: birth dates` snapshot/count failures that were already red in the §2.1 baseline; broader release-baseline scope. Shares the legacy 12,472 lineage but is a different table and a different claim. Record it; do not re-pin it here. |
| `:642` | `external_identities WHERE match_method = 'afltables_profile_url' AND status = 'unique'` `= 12_472` — *"matches players on the profile URL rather than the name"* | **ISSUE-090's re-pin decision** (explicit ISSUE-092 non-goal, handed to this issue). |
| `:655-656` | `external_identities WHERE match_method = 'afltables_profile_url'`: `total > 0` and `numeric = 0` — *"stores the profile URL it matched on, not a legacy row id"* | **ISSUE-090's.** Note this one pins no count; it needs `total > 0` and zero numeric `external_id`s. It went red only because the table was emptied; with the population restored it should pass **unchanged**. |

The ledger (`IssuesIndex.md`, `issues.md`) describes "two external-identity gates"; that is
correct, and the third `12_472` at `:632` is a separate, pre-existing failure that must be
classified as such rather than folded into ISSUE-090.

### 5.2 Tracked provenance predicting 13,275 (source-side, database-independent)

- **Accepted baseline `full-history-20260827`** in `data/reference/fitzroy-accepted-baselines.json`
  — hash-bound, `exactly_one_accepted`, no latest-label fallback:
  - `measured.players = 13275`
  - `identity_scan.distinct_urls = 13275`
  - `identity_scan.missing_url = 0`, `malformed_url = 0` (so every source row carries a
    canonical profile URL; `distinct_ids = 13270` differs only because 5 players have no
    fitzRoy numeric `ID` anywhere in the snapshot — the ID never reaches a database column)
- **`tools/db/rebuild-test.ts:507-523`** — the Stage 9 gate counts the `players` measured key
  as `SELECT count(*) FROM external_identities ei JOIN sources s ON s.id = ei.source_id
  WHERE s.key = 'afltables'`, precisely because the canonical identity is the AFL Tables
  profile URL and the `players` table also holds DraftGuru-minted shells. An unrecognised
  measured key is a refusal, so this gate cannot silently shrink.
- **Stage 9 PASSED** on the 2026-08-27 clean rebuild of `afldb_test`
  (`AFLDB-FINAL-VALIDATION PASSED: 13 checks`, `AFLDB-ISSUE-093.md` §H15), which means that
  count was exactly **13,275** in `afldb_test` at the end of the rebuild.
- **`tools/migration/import_fitzroy_core.py`** writes that population and nothing else does:
  - `MATCH_METHOD = 'afltables_profile_url'` (`:100`);
  - one identity row per player fact, `status = 'unique'`, `external_id` = the normalised
    URL path `players/A/Name.html` (never a numeric legacy id), `external_url` the full
    afltables URL (`:1442-1498`);
  - it **reconciles absent rows**: `DELETE FROM external_identities WHERE source_id = ...
    AND match_method = ... AND external_id <> ALL(asserted)` (`:1481-1485`), behind
    ISSUE-092's `check_population_drop()` gate (`:1466-1480`);
  - an asserted URL already mapped to a *different* player is a hard `RuntimeError` identity
    HALT before any delete or upsert (`:1454-1465`).
  - Therefore the expected shape is **13,275 rows, all `status='unique'`, all with
    non-numeric `external_id`** — satisfying `:642`'s count and `:655-656` unchanged.
- **`tools/rebuild/draftguru/import_draftguru.py`** writes `external_identities` only under
  `SOURCE_KEY = 'draftguru'` (`:687-725`); it *reads* the afltables identities but never
  writes them. It cannot perturb the afltables count.

### 5.3 Where 12,472 came from, and the rule

12,472 is the **legacy-derived** population produced by the old register path,
`tools/migration/enrich_birth_dates.py` reading `AFLDB_LEGACY_SQLITE`
(`afltables_player_index`). The canonical clean rebuild is deliberately legacy-free and
never runs that pass, so 12,472 is **not reproducible** from the current canonical source
contract.

**12,472 must not be silently reinstated** to make a gate pass. Equally, **13,275 must not
be written into the test from this analysis alone** — the source contract *predicts* it;
only the live `afldb_test` can *prove* it. Change an expectation only after the live count
is observed and matches the tracked provenance above, and record it explicitly as a
**test-baseline repair caused by the canonical rebuild**, not as a product-data change.

---

## 6. Exact remaining validation sequence

**Gate 1 — first, and not yet run:**

```
npm test -- tests/integration/release-gates.test.ts
```

Then **classify every failure** into exactly one of:

- (a) **ISSUE-090's** — the duplicate-issue invariant (`gate: draft links` → *"does not
  stack duplicate issues when a pass is re-run"*, `:497-507`), and the two
  external-identity gates (`:637-643`, `:645-657`);
- (b) **canonical-rebuild baseline drift** — a pin that described the old legacy-derived
  database (snapshot counts, attendance, draft, birth-date evidence counts, 2026 snapshot
  date, etc.). Record ownership; do **not** repair under ISSUE-090;
- (c) **an unrelated existing issue** — record the ownership and leave it there.

**Gate 2 — only after the ISSUE-090-relevant release gates are green:**

```
npm test -- tests/integration/privileges.test.ts
```

ISSUE-090's stake in Gate 2 is the runbook §10 privileges conclusion: `data_issues` is in
`afldb_meta.import_writable_tables`, so `afldb_import` already holds the DML (including
`UPDATE`) the reconciliation needs, and **no privilege migration is required**. The relevant
coverage is the `afldb_import is confined to the statistical tables` block
(`tests/integration/privileges.test.ts:431`, `:474+`, `:601`). The suite is 24 tests;
`AFLDB-ISSUE-096` recorded 24/24 on 2026-08-28, but ISSUE-090 still owns running it in its
own sequence.

Do **not** run the full suite or `npm run build`; neither application nor framework
behaviour changes here (runbook §23).

---

## 7. Failure-handling rules

1. **Do not blindly re-pin 12,472.** Prove the live `afldb_test` count first.
2. **Prove before editing.** No expectation changes until the live value is observed and
   reconciled against §5.2's tracked provenance.
3. **Separate ISSUE-090 failures from canonical-rebuild baseline drift.** The database was
   fully rebuilt on 2026-08-27; broad pin drift across the suite is expected and is not
   this issue's defect.
4. **Do not repair unrelated release-gate drift under ISSUE-090.** Record ownership and
   return to scope. Create a new issue only if a genuinely separate defect is proven and
   cannot reasonably sit as an observation under an existing owner.
5. **Do not widen privileges to make a test pass.** If privilege behaviour is wrong,
   classify the actual first-wrong layer and stop before touching grants or
   `privileges.sql`.
6. **`afldb_test` only.** Never `afldb_dev`, never production, never a production-like
   database. Use the guarded `AFLDB_TEST_DATABASE_URL`; the database name must end `_test`.
7. **Do not edit an applied migration.** 072, 073, 074 and 075 are applied and
   checksum-frozen. Do not renumber. Migration state is expected coherent at 75/75; if drift
   appears, STOP — that is not ISSUE-090's to repair.
8. **Do not rebuild `afldb_test` to satisfy a gate.**
9. **Do not weaken or fixture-scope test 22** (the global duplicate invariant), and do not
   delete/skip regression coverage to go green.
10. Do not absorb ISSUE-068, ISSUE-076, ISSUE-095, ISSUE-097+ or general rebuild tooling.
11. Git is user-operated: no commit, merge, push, rebase, stash or reset. Read-only Git
    inspection is fine. Never `git add .`; never touch `D:\dev\afldb`.

**STOP conditions:** `afldb_test` unavailable or not the intended target · migration drift ·
a failure belonging to another issue · a fix requiring dev/production mutation · the
authoritative external-identity population cannot be established · privilege widening
appears necessary without a proven ISSUE-090 requirement · current source materially
contradicts the ledger.

---

## 8. Resolution standard

> **SUPERSEDED 2026-08-28 by `AFLDB-ISSUE-090.md` §27.4 (Option 1 approved). Retained as
> lineage — do not apply this list as the current standard.** Item 2's requirement that the
> `gate: birth dates` population assertions go green is **retired**: they describe a
> post-DOB-enrichment snapshot the canonical legacy-free rebuild cannot produce (§27.3).
> Item 7's external-identity re-pin is **done** (12,472 → 13,275). See §12 below.

ISSUE-090 may be marked Resolved **only** when all of the following hold. 27/27 on the
focused suite is necessary and explicitly **not** sufficient.

1. Focused DOB enrichment suite green (27/27 or the current equivalent).
2. The ISSUE-090-relevant release gates green — duplicate-issue invariant and both
   external-identity gates.
3. `tests/integration/privileges.test.ts` green, with no grant widened.
4. Rerunning the club-list pass does not stack duplicate unresolved `dob_conflict` rows —
   one row per player, same `id`, unchanged `detected_at`, byte-identical payload.
5. Neither pass can delete unresolved conflicts owned by the other (both directions, proven
   against the real importers with no optional skip).
6. Reconciliation remains deterministic and idempotent.
7. The authoritative external-identity count is explained, with its provenance recorded —
   and any expectation change documented as a test-baseline repair, not a data change.
8. No unrelated regression is hidden by an expectation edit; unrelated drift is classified
   and left with its owner.
9. Migration/database state coherent, no drift, no production or `afldb_dev` mutation, no
   applied migration edited.
10. `issues.md`, `IssuesIndex.md` and `AFLDB-ISSUE-090.md` synchronised on resolution;
    `CHANGELOG.md` `Unreleased` entry only if repo precedent requires it for the retained
    code/data-integrity change. Decide at resolution whether the
    `external_identity_conflict` follow-up (runbook §18, D4) warrants a Low tracked issue.

---

## 9. Exact next action

**Operator-run, one command, nothing before it:**

```
npm test -- tests/integration/release-gates.test.ts
```

Return the full pass/fail summary and the failing assertion names with their expected and
received values. Nothing in the tree should be edited before that output exists.

---

## 10. Standing statements

- **This handoff supersedes the stale `Status / handoff` and HALT sections of
  `AFLDB-ISSUE-090.md` for resume purposes only.** Where the two disagree about *current
  state*, this file is correct.
- **It does not rewrite historical lineage.** Every HALT, failed validation, checksum
  diagnosis, ISSUE-091/ISSUE-092 interaction and incident record in `AFLDB-ISSUE-090.md`,
  `issues.md` and `IssuesIndex.md` is retained as written and must be preserved. Stale
  intermediate states are marked superseded, never deleted.
- **`AFLDB-ISSUE-090` remains OPEN.** No status change has been made.
- **No commit, merge, push, rebase, stash, deployment or database mutation has occurred**
  in the session that produced this file. The worktree is clean at `c4659ac` on
  `claude/issue-090`, and Gate 1 has not been run.

---

## 11. GATE 1 RESULT AND CLASSIFICATION (2026-08-28)

`npm test -- tests/integration/release-gates.test.ts` — operator-run against `afldb_test`.

**64 tests · 42 passed · 22 failed.**

Nothing was edited, no importer was run, no database was written, and Gate 2
(`privileges.test.ts`) was deliberately **not** run: §6 requires classification first.

### 11.1 Live evidence returned

| Probe | Live `afldb_test` | Historical pin |
|---|---|---|
| `external_identities` `match_method='afltables_profile_url' AND status='unique'` | **13,275** | 12,472 |
| `players` with `dob` | **855** | 12,478 |
| open `dob_conflict` rows | **0** | 2 |
| `player_birth_evidence` | **855** | 12,472 |
| `players` without `dob` | **12,422** | 883 |

### 11.2 The three `12_472` pins — resolved separately, as §5.1 required

| Pin | Live | Verdict |
|---|---|---|
| `:642` external identities `unique` | 13,275 | **Stale. Conclusively.** Live evidence now matches the tracked provenance in §5.2 exactly (`measured.players = 13275`, `identity_scan.distinct_urls = 13275`, Stage 9 gated and PASSED). This is the one re-pin ISSUE-090 owns. |
| `:655-656` external identities URL-shape | total 13,275, numeric 0 | **PASSES unchanged**, exactly as §5.1 predicted. No edit. |
| `:632` `player_birth_evidence` count | **855** | **NOT re-pinned to 13,275.** Different population, different claim. 855 is not a *stale pin* problem at all — see §11.4. |

The three were never one fact. Only `:642` is a stale external-identity pin.

### 11.3 Classification of all 22 failures

`I90` = ISSUE-090-owned · `RB` = canonical-rebuild baseline drift · `OI` = other existing issue · `UN` = unowned

| # | Gate → test | Actual | Expected | First-wrong layer | Class | Blocks ISSUE-090? |
|---|---|---|---|---|---|---|
| 1 | Brownlow authority → `season votes total exactly 79,113` | NULL/0 | 79,113 | acquisition: `brownlow_season_votes` never written | UN (§11.7) | No |
| 2 | Brownlow authority → `career totals sum to the authoritative total` | 0/NULL | 79,113 | derived from #1 | UN | No |
| 3 | Brownlow authority → `season-grain table cannot inflate the total` | 0/NULL | 79,113 | derived from #1 | UN | No |
| 4 | Brownlow authority → `reports representative career totals` | absent/0 | 154 / 180 | #1 + player ids reminted by the rebuild | UN + RB | No |
| 5 | Brownlow coverage → `records a genuine zero ... in a decided season` | 0 | > 0 | `brownlow_status` needs `EXISTS(brownlow_season_votes)` → never `complete` | UN | No |
| 6 | Advanced Search → `50-199 goals and zero Brownlow votes returns 269` | ≠269 / hash | 269 / `ae1eb8ef…` | #1 + `idHash` pinned to legacy player ids | RB | No |
| 7 | Advanced Search → `debuted in the 1960s with exactly two clubs returns 110` | ≠110 / hash | 110 / `8cebc4aa…` | `idHash` pinned to legacy player ids | RB | No |
| 8 | Club organizations → `records the merger as a navigable link` | `club_seasons` empty | Lions from 1997 | `staging.team_seasons` has no legacy-free writer | **OI — ISSUE-095** | No |
| 9 | Club organizations → `attaches every ladder row to the identity trading that season` | no rows | era spans 102/129/102 | same | **OI — ISSUE-095** | No |
| 10 | Draft links → `resolves identity once per person across 5,057 people` | people 5,057 ✓, linked **5** | 3,459 | link resolution: the DraftGuru ledger holds 6 decisions / 2 seeded; Stage B3 person-page crawl **not started** | **OI — ISSUE-093 / DraftGuru B3** | No |
| 11 | Draft links → `separates genuine non-players from a real matching backlog` | ≠1,498 / ≠100 | 1,498 / 100 | derived from #10 | **OI — ISSUE-093 / B3** | No |
| 12 | Draft links → `records the backlog as open data issues` | 0 | 100 | **no writer exists** for `unlinked_player_with_games` — the only historical writer was the tombstoned `import_draft.py` | UN (§11.7) | No |
| 13 | Absence is never zero → `records why each attendance is missing` | `complete` 15,187 | 15,376 | 2026 excluded by the accepted baseline (17,027 − 16,838 = the 189 matches of 2026) | RB | No |
| 14 | Birth dates → `populates 12,478 players with two visible conflicts` | 855 / 0 | 12,478 / 2 | **DOB enrichment never ran** (§11.4) | **I90 (acceptance)** | **YES** |
| 15 | Birth dates → `retains the existing date wherever a source disagrees` | 0 rows | 2 rows | same | **I90 (acceptance)** | **YES** |
| 16 | Birth dates → `opens a data issue for every disputed date` | 0 | 2 | same | **I90 (acceptance)** | **YES** |
| 17 | Birth dates → `keeps the evidence behind every recovered date` | 855 / n/a | 12,472 / 11,533 | same | **I90 (acceptance)** | **YES** |
| 18 | Birth dates → `matches players on the profile URL rather than the name` | **13,275** | 12,472 | **stale legacy-derived pin** | **I90 — the re-pin** | **YES (repairable)** |
| 19 | Birth dates → `leaves 883 players honestly without a date` | 12,422 | 883 | same as #14 | **I90 (acceptance)** | **YES** |
| 20 | 2026 provisional → `marks the season in progress with an explicit as-at date` | no 2026 snapshot state | `2026-08-09` | current-season acquisition never ran | **OI — ISSUE-096/-098/-099** | No |
| 21 | 2026 provisional → `reports 2026 Brownlow as pending, never as zero` | 0 rows | 1 row `pending` | no 2026 `player_season_stats` | **OI — ISSUE-096/-099** | No |
| 22 | 2026 provisional → `preserves the raw ladder untouched in staging` | 0 | 1 | `staging.team_seasons` empty | **OI — ISSUE-095** | No |

*(A fourth 2026 assertion — `is the only season still in progress` — sits in the same `OI`
bucket if the operator's failing list names it in place of one of #20/#21. The
classification, owner and non-blocking verdict are identical either way.)*

**Passing by design, worth recording:**

- **ISSUE-090's own duplicate-issue invariant — `gate: draft links` → `does not stack
  duplicate issues when a pass is re-run` (`:497-507`) — is GREEN.** This is the global,
  deliberately un-fixture-scoped assertion the whole issue exists to protect (test 22 of the
  focused suite is its sibling). The §10 reconciliation holds against the real database.
- `:655-656` external-identity URL shape — green, unchanged, as §5.1 predicted.
- `resolves a season to exactly one identity per organization` and `awards no premier and no
  wooden spoon for 2026` pass **vacuously** over an empty `club_seasons`. They are not
  evidence of anything while ISSUE-095 is open.
- All three `gate: Grand Final replays` and all six `gate: Match Search` tests pass: they read
  only `matches` / `seasons` / `clubs`, which the rebuild populated in full.

### 11.4 THE KEY DECISION — how DOB is populated in the current canonical architecture

Traced in source, not assumed.

**Three writers of `player_birth_evidence` + `players.dob` / `dob_evidence_id` / `dob_disputed`:**

| Writer | Evidence | DOB fill | Legacy-free? | In the canonical rebuild? |
|---|---|---|---|---|
| `tools/migration/import_fitzroy_core.py` (`:1386`, `:1419-1427`) | yes | yes | **yes** | **YES — stage 6 `fitzroy`** |
| `tools/migration/enrich_birth_dates.py` — register pass (`:501`, `:632-639`) | yes | yes | **NO** | **no** |
| `tools/migration/enrich_birth_dates_from_club_lists.py` — club-list pass (`:629`, `:648-655`) | yes | yes | yes | **no** |

**The canonical rebuild's nine stages** (`tools/db/rebuild-test.ts:370-445`): `precheck` →
`recreate` → `migrations` → `privileges` → `reference` → `fitzroy` → `draftguru` → `derived`
→ `fingerprints`. **Neither DOB enrichment pass appears.** The rebuild's only DOB writer is
fitzRoy core.

**855 is the contracted output, not a shortfall.** The tracked accepted baseline
`data/reference/fitzroy-accepted-baselines.json` → `full-history-20260827.measured` states:

```
"players": 13275,
"players_with_dob": 855,
"players_with_dob_conflict": 0,
```

and `tools/db/rebuild-test.ts` `MEASURED_NOT_DB_GATED` records verbatim why Stage 9 does not
gate it in the database:

> `players_with_dob`: *"birth dates arrive via player_birth_evidence and DOB enrichment
> (ISSUE-090), so a raw count is not this baseline's claim; gated offline by the importer and
> register."*

So **855 DOBs / 855 evidence rows / 0 conflicts is exactly what the accepted contract says a
canonical rebuild produces.** The live database matches its own contract on all three
figures. The answer to the question posed is **(a)**, with a hard consequence:

**(a) — an expected consequence of the canonical rebuild pipeline not running the DOB
enrichment stage.** Not (c): the release-gate architecture is not stale in its *intent* —
`gate: birth dates` describes a real post-enrichment state that genuinely used to exist. Not
(d): nothing in ISSUE-090's reconciliation logic is implicated; #14-#17 and #19 describe an
*unpopulated* database, not a mis-reconciled one. And **it cannot currently be (b)** — see
§11.5.

### 11.5 Can the enrichment be run safely against `afldb_test`? NO. Both passes are blocked.

**Register pass — `enrich_birth_dates.py` — doubly blocked:**

1. **Hard legacy dependency.** `main()` (`:406`) calls `connect_legacy()` →
   `tools/migration/common.py:73` → `require_env("AFLDB_LEGACY_SQLITE")`. Unconditional,
   before any work. It reads `afltables_player_index` from the legacy SQLite file (`:340`).
2. **Structurally dead even *with* that file.** It maps legacy ids to AFLDB ids via
   `SELECT legacy_player_id, id, dob FROM players WHERE legacy_player_id IS NOT NULL`
   (`:417-420`). The **only writer of `players.legacy_player_id` is
   `tools/migration/import_legacy_afl.py`** — a repo-wide grep confirms
   `import_fitzroy_core.py`, `import_draftguru.py` and `load_reference_data.py` never touch
   the column. It is therefore **NULL for every row** in a canonically rebuilt database, the
   map is empty, and the pass would resolve **zero** players. Running it could not produce
   12,472 even if the legacy artefact were supplied.

**Club-list pass — `enrich_birth_dates_from_club_lists.py` — source artefacts not tracked:**

- It is legacy-free, and its canonical mode is correctly fail-closed (`CANONICAL_CSV_DIR`,
  all five files required, `--csv-dir` omitted ⇒ `--require-complete`).
- But `CANONICAL_CSV_DIR = data/sources/afltables/club_lists` **does not exist in this
  worktree and is not in Git**. `.gitignore:45` — *"Only JSON opts in; raw/large data under
  `data/` (incl. `data/sources/`) stays ignored."* `git ls-files data/sources/` returns
  nothing; `data/` holds only `awards/`, `records/`, `reference/`.
- It would `sys.exit("ERROR: club-list source directory not found")` before any DB access.
- And it covers **five clubs**, so it could never reach 12,478 regardless.

**Answers to the specific questions asked:**

- *Does the canonical legacy-free rebuild invoke either DOB enrichment pass?* **No.**
- *Is running the current enrichment against `afldb_test` part of normal supported
  reconstruction?* **No.** It is not a stage, has no orchestrator entry, and no tracked
  invocation.
- *Does it require `AFLDB_LEGACY_SQLITE`?* **The register pass: yes, unconditionally** — and
  that is still not sufficient, because of `legacy_player_id`. The club-list pass: no.
- *Are all required current source artefacts tracked/reproducible?* **No.** The register's
  legacy SQLite is outside the canonical contract by design; the club-list CSVs are
  gitignored and absent.

**No importer was run.** §7 rule and the standing instruction both hold: provenance and
supported architectural place are not proven, so nothing was executed to turn a test green.

### 11.6 STOP — the exact remaining ISSUE-090 blocker

> **ISSUE-090's reconciliation logic is fixed and proven. Its *old release acceptance gate*
> cannot currently be satisfied by the canonical rebuild.**

Proven fixed and green:

- focused DOB enrichment suite **27/27** (§3);
- the global duplicate-issue invariant `:497-507` — **green against the real database**;
- both-direction cross-pass ownership isolation, D1 suppression, D5, migration 072 and the
  partial unique index.

Blocked, and **not** by any defect in ISSUE-090's code:

- `gate: birth dates` failures **#14-#17, #19** assert a **post-DOB-enrichment release
  snapshot that the canonical legacy-free rebuild does not and cannot produce**. Making them
  green requires either the legacy path (excluded by architecture) or untracked source
  artefacts (excluded by the repository contract).

The only ISSUE-090 failure repairable within this issue's scope is **#18** — re-pin `:642`
from `12_472` to `13_275`, recorded as a **test-baseline repair caused by the canonical
rebuild**, never as a product-data change, with the §5.2 provenance cited and now
corroborated by live evidence.

**Decision required from the operator before any edit — ISSUE-090 cannot resolve itself
here.** The §8 resolution standard, written against the pre-rebuild world, is now
unsatisfiable as literally stated. The options:

1. **Re-pin #18 only; hand #14-#17/#19 to a DOB-enrichment-acquisition owner**, and amend the
   §8 standard so ISSUE-090 resolves on its *reconciliation* contract (27/27 + the duplicate
   invariant + privileges) rather than on a legacy-derived population snapshot. This is the
   only option that neither reinstates 12,472 nor fabricates a population.
2. Keep ISSUE-090 open indefinitely behind a DOB acquisition path that does not exist. Not
   recommended: it makes a fixed defect hostage to unrelated acquisition work.

**Not decided here, and no edit made.**

### 11.7 Unowned gaps proven by this run — recorded, NOT created as issues

Two are the same architectural class as `AFLDB-ISSUE-095` (ladder/team-season) and
`AFLDB-ISSUE-102` (awards): a domain whose only acquisition path was legacy.

1. **`brownlow_season_votes` has no canonical legacy-free writer** (failures #1-#5). Its only
   writer is `import_legacy_afl.py:721`. `import_fitzroy_core.py` writes
   `brownlow_round_votes` (320,861 — Stage-9 gated, PASSED), but the ISSUE-093 record states
   verbatim that *"`brownlow_season_votes` deliberately NOT written — its authoritative
   fields are not derivable from this snapshot"* (`issues.md:6770`). `rebuild_derived.py`
   only **reads** it, so every derived Brownlow total is 0/NULL. This is recorded as a
   deliberate importer decision inside the now-**Resolved** ISSUE-093; it is **not** tracked
   as an open acquisition gap the way ISSUE-095 and ISSUE-102 are. ISSUE-102 explicitly
   excludes it (*"Brownlow is the exception via the AFL Tables path"*) — but that path is not
   implemented. **Candidate for a new tracked issue; the direct third sibling of ISSUE-095
   and ISSUE-102.**
2. **`unlinked_player_with_games` has no writer at all** (failure #12). A repo-wide grep over
   `tools/` and `src/` finds none. `import_draftguru.py` writes `is_matching_backlog` but
   files no `data_issues` row; the historical writer was the tombstoned `import_draft.py`.
   Plausibly absorbed by DraftGuru Stage B3, which is *optional and not started* — **this
   needs a deliberate owner decision, not an assumption.**

Neither issue was created. Per §7 rule 4 and the standing instruction, a new ID is not minted
from a single test run without an owner decision. **Neither blocks ISSUE-090.**

### 11.8 State at the end of this session

- **No implementation edit. No test edit. No expectation re-pinned. No importer run. No
  database write. No commit, stage, stash or push.**
- Only this file was modified.
- Gate 2 (`tests/integration/privileges.test.ts`) **not run** — §6 gates it on the
  ISSUE-090-relevant release gates being green, and #14-#17/#19 are not.
- `AFLDB-ISSUE-090` remains **OPEN**. `issues.md` and `IssuesIndex.md` are unchanged, pending
  the §11.6 decision.

---

## 12. CLOSE-OUT PASS (2026-08-28) — Option 1 approved and executed

Operator decision: **Option 1.** ISSUE-090 is not held open behind the missing legacy-free
DOB acquisition path. It resolves on its actual owned contract — the DOB-conflict
reconciliation lifecycle — which is implemented and proven.

### 12.1 The single repair

`tests/integration/release-gates.test.ts`, `gate: birth dates` → `matches players on the
profile URL rather than the name`:

```
-    expect(row.n).toBe(12_472);
+    expect(row.n).toBe(13_275);
```

with an adjacent comment recording that this is a **test-baseline repair caused by the
2026-08-27 canonical rebuild, not a product-data change**, and that the
`player_birth_evidence` pin above it is a different population and deliberately unchanged.

**Nothing else in that file, or in any other test, was altered.** The
`player_birth_evidence` `12_472` pin at `:632` stands untouched (live value 855). The five
`gate: birth dates` population assertions stand untouched. The 16 unrelated failures stand
untouched.

### 12.2 Acceptance standard amended — see `AFLDB-ISSUE-090.md` §27

**§8 of this handoff is superseded by `AFLDB-ISSUE-090.md` §27.4.** The requirement that
ISSUE-090 recreate the old 12,478-player enriched DOB snapshot is **removed**, and preserved
as lineage at §27.3 with the source proof of why it is no longer satisfiable:

- the nine-stage canonical rebuild invokes **neither** enrichment pass;
- `players_with_dob: 855` / `players_with_dob_conflict: 0` are the **accepted baseline's own
  contracted figures**, and `MEASURED_NOT_DB_GATED` records that a raw DOB count is
  deliberately not that baseline's claim;
- the register pass requires `AFLDB_LEGACY_SQLITE` **and** would resolve zero players,
  because nothing canonical writes `players.legacy_player_id`;
- the club-list pass's `CANONICAL_CSV_DIR` is gitignored and absent.

Revised standard (§27.4): focused suite 27/27 · no stacked duplicate `dob_conflict` rows ·
register cannot delete club-list-owned assertions · club-list cannot delete register-owned
assertions · migration 072 backstop valid · external identities pinned at 13,275 ·
`privileges.test.ts` passes with no grant widened · no production or `afldb_dev` mutation.

`release-gates.test.ts` is **not** required to be wholly green.

### 12.3 Validation — BLOCKED IN THIS SESSION, not attempted further

`npm test -- tests/integration/release-gates.test.ts -t "matches players on the profile URL
rather than the name"` and `npm test -- tests/integration/dob-enrichment-issues.test.ts` were
both invoked and both **refused before reaching PostgreSQL**:

```
Error: AFLDB_TEST_DATABASE_URL must be set to run integration tests.
  tests/integration/guard.ts:15
```

Cause, confirmed and benign: this worktree has **no `.env`** — only `.env.example`.
`tests/setup.ts:24-30` loads `.env` from the repository root, and `package.json` `"test":
"vitest run"` supplies no DSN. The operator runs Gate 1/Gate 2 with
`AFLDB_TEST_DATABASE_URL` exported in their own shell.

**No `.env` was created, no DSN was searched for, and no credential was written or printed.**
The three validation runs are therefore outstanding and are the operator's to execute
(§12.6).

### 12.4 Observations recorded, not implemented, no ID minted

Per instruction, the two gaps proven in §11.7 are recorded as close-out evidence only and
carried into `AFLDB-ISSUE-090.md` §27.5. **Neither is implemented under ISSUE-090 and no new
issue ID was created during this pass.** Triage separately after close-out:

1. `brownlow_season_votes` — no canonical legacy-free writer (only `import_legacy_afl.py`).
2. `unlinked_player_with_games` — no writer anywhere in `tools/` or `src/`.

### 12.5 Files changed in this pass

| File | Change |
|---|---|
| `tests/integration/release-gates.test.ts` | the one pin, `12_472` → `13_275`, plus its provenance comment |
| `AFLDB-ISSUE-090.md` | new §27 amendment; §25 header note pointing to it |
| `AFLDB-ISSUE-090-HANDOFF.md` | §11 Gate 1 classification; this §12 |
| `issues.md` | Open Issues row; `### Fix` and `### Validation` blocks corrected from stale "not yet" text, with the Gate 1 result and the repair recorded |
| `IssuesIndex.md` | Open Issues row; ISSUE-090 detail block — Gate 1 result, the repair, the amended acceptance, new next action |
| `CHANGELOG.md` | `Unreleased` entry for the retained reconciliation/data-integrity fix |

**No importer run. No database write. No migration touched. No grant touched. No commit, no
merge, no push, no stash.**

### 12.6 Outstanding — operator-run, in this order

```
npm test -- tests/integration/dob-enrichment-issues.test.ts
npm test -- tests/integration/release-gates.test.ts -t "matches players on the profile URL rather than the name"
npm test -- tests/integration/privileges.test.ts
```

Expected: **27/27** · **1 passed** · **24/24**.

STOP and classify before changing anything if: `privileges.test.ts` fails for a genuine
ISSUE-090 reason (do **not** widen a grant), the focused suite regresses below 27/27, or the
13,275 assertion does not pass.

When all three are green, ISSUE-090 meets `AFLDB-ISSUE-090.md` §27.4 in full and may be
marked **Resolved** — with the §18/D4 `external_identity_conflict` follow-up decided at that
point, per §8.10.

---

## 13. CLOSED — `AFLDB-ISSUE-090` Resolved 2026-08-28

**This handoff is now a historical record. There is no resume point and no next action.**

### 13.1 Final validation evidence (operator-run, canonically rebuilt `afldb_test`)

| Gate | Result |
|---|---|
| `tests/integration/dob-enrichment-issues.test.ts` | **27/27 PASS** |
| `release-gates.test.ts -t "matches players on the profile URL rather than the name"` | **1/1 PASS**, 63 skipped; pin reads **13,275** |
| `tests/integration/privileges.test.ts` | **24/24 PASS**, no grant widened |

This supersedes §12.3, where those three runs were outstanding because this worktree carries
no `.env` and the session had no `AFLDB_TEST_DATABASE_URL`.

### 13.2 Close-out statements

- **13,275 is the canonical AFL Tables profile-identity population.**
- **The old 12,472 external-identity pin is retired**, not reinstated.
- **`player_birth_evidence` was NOT re-pinned to 13,275** — different population, live 855.
- **The five historical DOB-population release assertions remain unchanged**, and are
  superseded snapshot assumptions outside ISSUE-090's reconciliation contract.
- **No privilege widening. No legacy SQLite path reintroduced. No importer, rebuild,
  migration, `afldb_dev` or production mutation during close-out.**

### 13.3 What is retained, and what must not be misread

**§11's Gate 1 classification — 64 tests, 42 passed, 22 failed — is retained as historical
evidence.** The complete `release-gates.test.ts` suite is **not** green and this closure does
not claim it is. ISSUE-090 resolved against `AFLDB-ISSUE-090.md` §27.4, its own
reconciliation contract, not against a wholly green release-gate suite.

The 16 unrelated failures keep their owners and were left untouched: `AFLDB-ISSUE-095` (3),
`AFLDB-ISSUE-093`/DraftGuru B3 (2), `AFLDB-ISSUE-096`/`-098`/`-099` (2), rebuild-baseline
drift (4), and the two unowned observations (5).

**The two unowned observations stand, and no issue was created for them in this close-out:**

1. **`brownlow_season_votes` has no canonical legacy-free writer** — only
   `import_legacy_afl.py:721`. Same class as `AFLDB-ISSUE-095` and `AFLDB-ISSUE-102`.
2. **`unlinked_player_with_games` has no writer at all** — plausibly DraftGuru Stage B3,
   optional and not started.

Triage both separately.

### 13.4 Ledger state

- `issues.md` — `AFLDB-ISSUE-090` **Status: Resolved**, **Resolved: 2026-08-28**, with the
  actual root cause, the fix as shipped, the three validation results and the close-out
  statements; removed from the Open Issues table; **Open issues: 10 → 9**.
- `IssuesIndex.md` — index row and detail block **RETIRED** under the repository's
  commented-lineage convention; table header repeated after the retired row, matching the
  ISSUE-096 precedent.
- `AFLDB-ISSUE-090.md` — §27.6 records the resolution.
- `CHANGELOG.md` — `Unreleased` entry as planned; no further change.

### 13.5 Not done, deliberately

No commit, no merge, no push, no stash, no tag. The working tree carries the change set for
the operator to review and commit.
