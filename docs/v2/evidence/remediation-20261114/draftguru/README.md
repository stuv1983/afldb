# draftguru remediation evidence, 2026-11-14 (AFLDB-ISSUE-348)

Worker: draftguru (Sonnet 5.5). Branch `claude/rem-draftguru-20261114`, base `5035ed96` (review commit; code
base `de640826`). Scope: findings ING-2 and ING-3 of the full review, and the I336 comment correction.
No production or DEV database was read or written; no migration; no deploy.

## 1. Findings validated against source

**ING-2 (validated).** A normal-mode `tools/rebuild/draftguru/import_draftguru.py` run reloads `draft_picks`
through `reload_keyed(..., PICK_KEY, delete_missing=True)` (`tools/migration/common.py`), deletes persons left
childless, and gates the population drop only on `external_identities`
(`reconcile_draftguru_identities` / `check_population_drop`). `EXPECTED_ROWS` 6810 and `EXPECTED_PERSONS` 5057
gate only the incoming snapshot. The D-336-2 audited inserts (I336 tool: `draft_type 'Pre-Draft'`,
`draft_kind 'pre_draft'`, `pick_number` NULL, one `data_edits` row per pick with `field_group 'source_insert'`)
are absent from the Stage A snapshot, so a full reload deletes them and their new persons with no refusal. The
tool's header comment claiming "a later keyed DraftGuru reload reproduces under the same key" was wrong and is
corrected (comment only).

**ING-3 (validated).** A full reload overwrites every non-key column, including `original_club_raw`, before any
origin review. The D-336-3 classifier existed only as docs evidence
(`d3363-classification-20261111/scripts/classify.py`).

## 2. Design (as implemented)

`tools/rebuild/draftguru/reload_guard.py` (new, pure plus SELECT-only) is called by `run_import` after the
connection opens and before `apply_authority` (which can mint player seeds) and before `import_batch` opens
(PLAN-REVIEW D-2). A refusal, `--dry-run` included, writes nothing, not even an `import_batches` row.

- "Same key" and "would delete" are computed by PostgreSQL with `common._key_match` / `common._scope_clause`,
  the predicates `reload_keyed` itself generates, with incoming keys passed as `unnest(...)` arrays (D-1,
  NULL-safe; `draft_picks`' unique index is `NULLS NOT DISTINCT`).
- "Audited" (D-4) = a `data_edits` row for the pick, an active `data_overrides` row, or an audited insert
  (`source_insert` group or I336 provenance note). Persons are protected through their picks.
- Refused unless empty or fully named by a reviewed reconciliation file: pick deletions, person deletions,
  protected pick source-column rewrites (override-covered columns excluded), protected person rewrites
  (`dg_person_id`, `display_name_raw`, `name_key`), and every `original_club_raw` change.
- **D-5 rank handling.** `dg_person_id` is a per-load rank. A retained audited person's rank is rewritten by a
  full reload whenever the incoming ranking differs, and that is a refused rewrite. The person keeps or receives
  the incoming rank only when listed in `acknowledged_protected_person_rewrites` (the reconciliation records the
  old and new rank in the report). Nothing in the guard renumbers.
- Origin changes are classified as the D-336-3 classifier does (port proven against all 187 committed
  `classification.json` rows). INSERT_SCHOOL, INSERT_CLUB, RENAME_EXPAND and WHITESPACE_ONLY are auto-accepted
  once an `origin_review` entry matches; REPLACE_CLUB, OTHER and INSERT_MIXED (including 5961, 6784, 6626) need an
  `owner_rulings` entry `{id, decision: "accept_incoming", reference}`. The guard never adjudicates them.
- `--acknowledge-population-drop` does not satisfy the guard (D-3). `--link-only` is unchanged and refuses the new
  flags. EXPECTED_ROWS/EXPECTED_PERSONS, `draftguru-contract.json`, `DRAFTGURU_EXPECTED` and the bridge constants
  are untouched (D-6).

Reconciliation file: `--reconciliation FILE --reconciliation-sha256 <sha256>`; first run `--dry-run
--guard-report <new.json>` to obtain the effect list and `effect_digest`. Format and procedure are in
`tools/rebuild/draftguru/README.md` (new section).

### Residuals
- The guard reads and the import writes in separate transactions (TOCTOU): run with the admin draft editor quiet.
- The Stage A snapshot is not in this workspace, so the existing real-snapshot integration cases and the
  Stage-A-dependent unit/contract checks skip or fail (section 4). The new DB case uses an identity frame built
  from the stored rows (`tests/python/draftguru_reload_guard_db_driver.py`).
- No decision made here about re-baselining the 6810/5057 contract; the 35 audited picks are exactly what a full
  reload with the current snapshot would refuse.

## 3. Production discriminator (aggregate only, for the orchestrator)

`docs/v2/evidence/remediation-20261114/draftguru/discriminator-aggregates.sql`. Expected on production:
`picks_audited_insert` 35, `persons_audited_only` 31, `persons_with_marker` 31,
`draftguru_persons_without_identity` 31. Run against the isolated restore of the production snapshot it returns
6810 / 0 / 0 / 0 / 0 / 0 / 0 (the snapshot predates the I336 inserts), which proves the query executes and that
the discriminator selects nothing in the unmodified population.

## 4. Verification (host streamanator, workspace `/mnt/ssd/afldb-rem-draftguru-20261114`, port 55614)

Code commit `a5bde87538c8cec02835e10c0d048935997f825e`. Clean clone at that SHA: `git rev-parse HEAD` =
`a5bde875…`, `git status --porcelain` empty (checked before and after tests and tsc).

| Check | Command (from the checkout) | Result | Log sha256 |
|---|---|---|---|
| All `tests/python/draftguru_*_contract.py` | `$PY tests/python/<file>` per file | all pass except gate 9.6 (below); atomicity 68 PASS, link-only 123 PASS | bba7fca3…a6f2 (`final-py.log`) |
| Vitest | `vitest run tests/draftguru-import.test.ts tests/draftguru-acquisition.test.ts tests/data-overrides-source-contract.test.ts tests/gap029-ops.test.ts tests/gap029-rookie-selections.test.ts tests/v2-season-seal.test.ts` | 445 passed, 7 skipped, 3 failed (below) | e01ce848…95ea (`final-unit.log`) |
| Integration | `isolated-pg run <fresh db copy> -- vitest run tests/integration/draftguru-import.test.ts` | 6 new guard tests pass, 1 skipped; existing real-snapshot cases skip (no Stage A snapshot) | b2433c04…1e11a (`final-int.log`) |
| Typecheck | `next typegen; tsc --noEmit -p .` | rc 0 | ebab33d5…24c8 |

Failures that are environmental and pre-existing (same three on the unmodified base `de640826`,
`base-unit.log` sha256 43535f48…b681e): `draftguru-acquisition.test.ts` "rebuilds byte-identically from the
accepted Stage A snapshot", "is the frozen 120/8/68/30/14 contract…", and the import-gate contract check 9.6
(`snapshot directory not found: data/sources/draftguru/annual-html-20260826`). They need the Stage A snapshot,
which exists only in workspaces outside this run's scope. Not caused by this change, not weakened, not skipped.

### Red / green (the importer alone reverted to `de640826`; new module and tests kept)
- Contract: 7 section-6 checks fail (6.2, 6.4, 6.5 normal and dry-run, 6.6 normal and dry-run, 6.7), including
  `6.5 (normal run) deleting an audited pick … is refused as ImportFailure -- None` (the unguarded reload
  completes) and `6.6 … offenders=['INSERT INTO ', 'SET CONSTRAI', 'DROP TABLE I']` (`red-py.log` 942a86da…a466).
  Green on the final checkout: 68 PASS, 0 FAIL.
- Vitest static pins: 4 fail (`red-unit.log` e422363f…675c); green on final.
- Integration: 6 fail (`red-int.log` 8fe833bc…5aca); the first cases fail on the missing guard output, later cases
  cascade from the shared fixture. Green on final: 6 pass.

## 5. Host state at close
Isolated cluster on 127.0.0.1:55614 stopped ("cluster stopped; no listener on 55614"; `ss -ltn` count 0; no
process whose command line names the workspace). Scratch clones `red/` and `base/` removed; `du -sh` of the
workspace 5.7G (cluster data, template database, `cand/` and `final/` checkouts, evidence logs). DEV unchanged:
`afldb` MainPID 1732 (ActiveEnter 2026-11-14 03:01:41 AEDT) and `postgresql@16-main` MainPID 1531, as at the
start of the run. Nothing outside the workspace was touched.
