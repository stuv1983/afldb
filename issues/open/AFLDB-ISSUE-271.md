# AFLDB-ISSUE-271 — Legacy `match_results` promotion overwrites Data Editor corrections on `matches`

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. **Area:** legacy CSV intake / admin authority.
- **Key files:** `src/lib/ingest/datasets.ts` (`match_results` `validateRow`, `preparePromotion`, `promoteRow`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-006; partition note R5a-F04). The main session re-read `datasets.ts:805-861`.
- **Classification:** code-proven.
- **Status update (2026-10-10, appended; the lines above are the review's record):** implemented together with
  AFLDB-ISSUE-272 in worktree `D:\dev\afldb-issue-271`, branch `sonnet/issue-271`, intended base `41cbf730` (operator-stated).
  **Uncommitted, unvalidated** (no test, typecheck, lint, build or database command was run), not deployed, nothing repaired.
  Still Open. See §17. (Revised 2026-10-10, second pass: §15 "None" stands; §17.7 records the implementation basis derived
  from the existing contracts, not open decisions. The shared promotion hook now also refuses an ISSUE-272 canonical
  collision before the lock, so authority is never read for such a submission: ISSUE-272 §17.11.) *(Historical: the
  "unvalidated / no command run" wording here and in §17.1–§17.9 is superseded by the operator's results in §17.10.)*
- **Revision (2026-10-10, third pass: review corrections; still uncommitted):** operator validation recorded (DB-free
  246/246, TypeScript, five-file ESLint and `git diff --check` passed on the second-pass tree; integration outstanding);
  the `match_attendance` consequence of D-271-2 made explicit; remaining review findings recorded as open follow-ups, not
  tested or resolved. No production code changed. See §17.10.
- **Revision (2026-10-10, fourth pass: integration window result; corrections uncommitted and UNRUN):** full integration
  validation **failed** (44/45 in `match-results-promotion.test.ts`, the failure an ISSUE-264 F-002 fixture interaction with
  the new 2073 Grand Finals; `datasets.test.ts` 16/16). **Both ISSUE-271 cases passed**, with the four ISSUE-272 cases. Schema
  restored to State A; the runner's report failure is separate. Fixture and runner corrected, unrun. No production code
  changed. See §17.11 and ISSUE-272 §17.13. *(Historical: "failed", "corrections unrun" and "fresh Preflight required" are
  superseded by the fifth pass.)*
- **Revision (2026-10-10, fifth pass: successful validation window; implementation still uncommitted):** the corrected
  fixture and runner were run in a fresh Preflight and Apply window (`D:\tmp\issue271\preflight-20261010-122730-18800`,
  `D:\tmp\issue271\apply-20261010-122808-24240`): `match-results-promotion.test.ts` 45/45 and `datasets.test.ts` 16/16
  (**61/61 passed, 0 failed, 0 skipped, 0 todo**), State A restored and verified, final report completed. Both issues stay
  Open: review, commit, merge, the ISSUE-272 DEV census, DEV deployment and acceptance are outstanding. Documentation only;
  no production code, test, census SQL or runner changed. See §17.12 and ISSUE-272 §17.14.

## 1. Summary

A Data Editor correction on a match (score, attendance, venue and so on) writes an active `data_overrides` row. Manual-authority treats that row as a human decision, so the settles honour it. The legacy `match_results` promotion overwrites the same columns with the file's values, unconditionally, and neither validation nor promotion reads `data_overrides`. Afterwards the override row stays active, and it now shields the CSV value from source correction.

## 2. Evidence

- `src/lib/ingest/datasets.ts:811-861`: `ON CONFLICT (match_key) DO UPDATE SET round_number, round_type, is_final, venue_id, venue_raw, home_score, away_score, result, winner_club_id, margin …` (goals, behinds and attendance when supplied).
- Neither `validateRow` (`:621-766`) nor `preparePromotion` (`:774-794`) reads `data_overrides`.
- `src/db/queries/data-edits.ts:235-258` writes the override "so importers can replay it".
- `src/lib/acquisition/manual-authority.ts:714-719` treats active `matches` overrides as manual authority.
- The established refusal pattern:
  - `award_winners`: ISSUE-165 D-12, `datasets.ts:473-490`.
  - `player_match_stats`: ISSUE-264, `datasets.ts:901-949, :1087-1162`.

## 3. Trigger

1. An administrator corrects a match score in the Data Editor.
2. A super admin later promotes a `match_results` file that carries the old score for that match.

## 4. Expected invariant

A supplied value that differs from an active human override is refused, at validation for the report and again under the match lock at promotion. An identical value passes.

## 5. Actual behaviour

The reviewed correction is reverted silently. The override stays active, and the settles then leave the reverted value alone.

## 6. First wrong layer

`src/lib/ingest/datasets.ts:811-861`, together with the absence of an override read in `:621-794`.

## 7. Impact

Silent reversal of durable admin corrections on canonical `matches`. The wrong value is then protected indefinitely. ISSUE-264 graded the same class Medium for `player_match_stats`.

## 8. Reproduction / witness

Not executed (DB-backed). See §14.

## 9. Disproof attempts

- `afldb_import` can read `data_overrides`, as the 264 path already does.
- No replay runs after promotion.
- ISSUE-264's exclusion of `match_results` was reasoned on Match Sheet authority only (`issues.md:48506`). Data Editor overrides on `matches` were not considered.

## 10. Existing-issue search

- ISSUE-264 scope (`issues.md:48502-48507`), ISSUE-258 (`:47400`), ISSUE-185 (provenance only).
- Classification: **new**. Cross-references AFLDB-ISSUE-264, ISSUE-165 D-12 and ISSUE-261.

## 11. Scope

The `match_results` dataset: validation report and promotion refusal.

## 12. Out of scope

The `player_match_stats` dataset (already ISSUE-264), and the `match_attendance` dataset (its override semantics are a separate decision).

## 13. Proposed fix boundary

- Under the existing match lock in `preparePromotion`, read the active `data_overrides` for the target `match_key`s and refuse any row whose supplied value for a field in an active group differs from the override.
- Mirror the check in `validateRow` for the report.
- Enumerate the `matches` field groups from `src/lib/edit/spec.ts`.

## 14. Proposed validation

1. DB-free: `preparePromotion` with a stub `sql` that returns an override → refusal naming the field.
2. Integration: edit a score, promote the old figure, then assert the score is unchanged and the submission failed with the refusal.

## 15. Decisions / unresolved questions

- None. The precedent is ISSUE-264 D-264-*.

## 16. Next action

Implement together with AFLDB-ISSUE-272 (the same dataset functions).

## 17. Implementation notes (2026-10-10, appended; §0–§16 above are the review's record at `20a7a4bb`)

Worktree `D:\dev\afldb-issue-271`, branch `sonnet/issue-271`, intended base `41cbf730` (operator-stated; not checked, no Git
command was run). **Uncommitted. UNVALIDATED:** the agent ran no command of any kind (no test, typecheck, lint, build, Git,
SQL, SSH or network). Nothing was deployed or repaired. The issue stays **Open**. *(Historical for §17.1–§17.9: the
operator has since run the DB-free tests, typecheck, lint and diff check, §17.10. The agent still runs no command.)*

### 17.1 Re-check against the current files

At the base, `match_results` `validateRow` and `preparePromotion` still read no `data_overrides`, and `promoteRow`'s
`ON CONFLICT (match_key) DO UPDATE` still wrote round, venue, the score components (`COALESCE`), both scores, result,
winner, margin and attendance (`COALESCE`, status coupled). The ISSUE-264 refusal (`legacyStatsAuthorityRefusal`, the
FOR SHARE re-read under the lock) and ISSUE-165 D-12 remain the precedents. ISSUE-268's `match_attendance` changes and
`match_results`' own zero-attendance refusal are untouched.

### 17.2 The protected fields, derived from the contracts

- **Editor spec** (`src/lib/edit/spec.ts`, `EDITABLE_ENTITIES.matches`): groups `attendance` [attendance], `score`
  [home_goals, home_behinds, away_goals, away_behinds; scores, result, winner and margin are derived, never typed],
  `match_time`, `match_event`, `notes`. Round, venue and fixture identity are deliberately not editable.
- **Writer** (`saveEdit`, `src/db/queries/data-edits.ts`): locks the match `FOR UPDATE`, applies the group, then upserts
  ONE active row per `(entity_type, entity_key = match_key, field_group)` whose `override_values` holds the fields that
  save changed, merged with the row's earlier keys. A rekey carries the rows (`carryMatchOverrides`).
- **Replay** (`tools/migration/common.py`, `replay_admin_overrides(matches)`): merges every active row per key; refuses two
  rows that disagree on a field; re-derives totals, margin, result and winner of a `score`-overridden match from the merged
  components (override where the key is present, otherwise the loaded value); `attendance` by key presence, with status and
  source moving together.
- **Settles** (`manualAuthorityVerdict`): any active group protects all its fields; an override in a group the editor no
  longer defines is indeterminate; an attendance cited to `manual_admin_edit` is authority even without an override row.
- **What this dataset writes** decides which of those can conflict: the four components (only when supplied), both scores,
  result/winner/margin (always), attendance (only when supplied, status coupled). `match_time`, `match_event` and `notes`
  are never written; round, round type, `is_final` and venue belong to no editor group.

### 17.3 Behaviour implemented (`src/lib/ingest/datasets.ts`)

`legacyMatchResultsAuthorityRefusal({ authority, write })` (pure) against the resolved values `promoteRow` writes:

- **Score.** An active `score` row (or a score component in any active row) protects all four components. Each protected
  value is the override's where its key is present, otherwise the stored value. A supplied component must equal it; a blank
  or omitted component keeps the stored value (ISSUE-258) and passes when that stored value is the protected one. Because
  `home_score`/`away_score` are always written, each must equal goals × 6 + behinds of the protected components, so a file
  that changes only the score cells (components blank) is still refused. Result, winner and margin are derived from the two
  scores, so equal scores cannot move them.
- **Attendance.** An active `attendance` row (or an `attendance` key in any active row), or an attendance cited to
  `manual_admin_edit`, protects attendance. A supplied figure must equal it (a protected "not recorded" refuses any
  figure); a blank cell keeps the stored value. `attendance_status` follows the figure.
- **Identical values pass. Omitted optional cells keep their existing ISSUE-258 preservation.**
- **Fails closed** (refused with a reason): an active override in a field group the editor does not define; a payload that
  is not a JSON object (including a double-encoded one: it is read as `::text` and decoded once, as the ISSUE-264 reader
  does); a value of a type the field cannot hold, or a key that is not an editor field; two active rows that disagree on a
  field; a protected score whose stored component is not recorded; an active override under a key no match carries; a
  query error or unreadable result shape.
- Messages are field-specific, e.g. `Data Editor authority: the Data Editor protects home_goals (file 13, Data Editor 14),
  home_score (file 86, Data Editor 92); promoting would overwrite it. Resolve it in the Data Editor
  (/admin/data-editor?entity=matches&id=…) or correct the file, then re-validate.`

**Where.** *Validation* (advisory, for the report): `validateRow` asks a new `ValidationContext.matchResultsAuthority`
reader for the **canonical** key (ISSUE-272), so `R1`/`gf` cannot miss authority recorded under `1`/`GF`. `afldb_auth`
cannot read `data_overrides`, so `src/lib/ingest/pipeline.ts` answers it from the existing short-lived import-role
connection inside a READ ONLY transaction, once per key (the ISSUE-264 reader's pattern). No reader, or an unreadable
answer, is an error row. *Promotion* (authoritative): `preparePromotion`, inside `withLegacyLockTimeout` (exclusive
settle/promotion gate, 5 s bound), takes the existing ONE ascending `FOR NO KEY UPDATE` lock on the target matches, which
now also returns their stored values, and only then reads the active overrides and the manual-attendance citations for
those keys. `saveEdit` takes `FOR UPDATE` on the match before writing its override, so a correction committed before the
lock is seen and one attempted afterwards waits for the promotion. Every row is checked; any conflict refuses the whole
submission before the import batch or the first write.

### 17.4 Submission-status outcome (existing pipeline, unchanged)

- A row refused at **validation** is an error row; `promoteSubmission` refuses an error-row submission with no write and no
  status change.
- A refusal at **promotion** is thrown inside the promotion savepoint: the savepoint rolls back (no `matches` change, no
  `import_batches` row), and the pipeline records the submission as **`failed`** with the refusal text, in the same
  transaction as its row lock. A retry from `failed` re-reads the authority and refuses again until the operator resolves
  it in the Data Editor (or uploads a corrected file). Per the undecided ISSUE-268 **D-268-3**, a `failed` submission
  cannot be rejected or re-validated. A lock timeout or deadlock stays the existing retryable refusal (also `failed`).

### 17.5 Tests added (UNRUN when written; DB-free file since passed, §17.10; integration files since passed, §17.12)

- `tests/ingest-datasets.test.ts`, new *AFLDB-ISSUE-271 match_results against active Data Editor authority* block: the
  pure decision (no authority; a differing supplied component, named; identical and omitted values; a component the
  override does not name; a derived `home_score`/`away_score` change with silent components; totals from the override, not
  a drifted stored total; attendance differing, identical, silent; a protected "not recorded"; the manual-edit citation;
  groups the dataset never writes; nine fail-closed shapes) and validation (field-specific reason and link; identical and
  omitted values; the canonical key for an `R1` row; no or failing reader; the malformed-cell and zero-attendance refusals
  still come first). The nested *promotion re-check* block (shared with ISSUE-272) covers the lock-then-read order, an
  older `R1` row against a conflicting override, authority recorded after validation, identical/silent rows, a refusal
  naming several rows, a derived score change, an override under a key no match carries, an unreadable payload, and a lock
  timeout reading no authority. The ISSUE-265 order test now expects lock → overrides → citations before the restore.
- `tests/integration/match-results-promotion.test.ts`, new *AFLDB-ISSUE-271/272* block: a score correction (emulated as
  `saveEdit`'s end state: the corrected canonical values plus its active `matches` override row, inserted with
  `RETURNING id` and deleted by those ids) recorded **after validation** refuses a two-row submission whole; the submission
  is `failed` with no import batch; the correction, the override and the other row's match are unchanged; a retry refuses
  again; a fresh validation (canonical and `R<n>` spellings) reports the conflict with the Data Editor link; the identical
  corrected figures still promote, one row.
- **Not covered by tests:** a real `saveEdit` call (its derived club-season, period-score and audit writes are avoided),
  the manual-attendance citation against PostgreSQL, and the restricted `afldb_auth`/`afldb_import` grants unless the
  operator runs with the import-role DSN. DB-free stubs cannot establish PostgreSQL locking or conflict behaviour.

### 17.6 Operator validation (not run when written; DB-free part since passed, §17.10)

As ISSUE-272 §17.9 (the same files and commands); results and the integration environment in ISSUE-272 §17.12.

### 17.7 Implementation basis (derived from the existing contracts; not operator decisions)

The labels D-271-1…4 are kept so earlier references stay valid. Each point follows from a contract already in the
repository; none was an operator decision and none needs one. Revised 2026-10-10 (second pass).

- **D-271-1 (the whole score group is protected).** The editor defines `score` as one group of four non-nullable
  components (`EDITABLE_ENTITIES.matches.groups.score`: "Scores, result, winner and margin are derived from goals and
  behinds — they are never typed by hand"). A save submits all four: `applyMatchEdit` (`src/db/queries/data-edits.ts`,
  case `'score'`) writes every component, then both totals, result, winner, margin and the final-period
  `match_period_scores` from them. The human therefore confirmed the whole score, including the components they left
  unchanged; `override_values` records only the changed keys because key presence is how the *replay* knows what to
  reapply, not because the others were unreviewed. The live authority contract reads it the same way:
  `manualAuthorityVerdict` (`src/lib/acquisition/manual-authority.ts`) returns `conflict` for any proposed field of a group
  with an active row. This writer is a live writer like the settles, so it uses that contract. Two further reasons from the
  writer itself: `home_score`/`away_score` are always written and are a function of both components of a side, so a change
  to an unnamed behind moves the confirmed total; and refusing is reversible (the operator re-saves in the Data Editor or
  corrects the file). The rebuild replay's key-presence reading (`tools/migration/common.py`) is a pre-existing difference
  between the rebuild and the live settles, not introduced or decided here. Consequence: a file cannot change any component
  of a score the Data Editor has corrected unless it matches the protected score.
- **D-271-2 (an attendance cited to `manual_admin_edit` is protected).** Precedent: the settles treat the citation itself
  as authority, "whether or not the override row survived" (`manualAuthorityVerdict`, the `manualAttendanceMatches`
  check). Three writers cite it: the Data Editor attendance group (`applyMatchEdit`), admin match creation
  (`createMatch`, `src/db/queries/match-admin.ts`) and the `match_attendance` upload (its `promoteRow`). Effect on
  `match_results`: its `ON CONFLICT … DO UPDATE` writes `attendance` (when supplied) and `attendance_status`, but **never**
  `attendance_source_id` (provenance is stamped on INSERT only, ISSUE-185). Overwriting a cited figure would therefore leave
  the file's number carrying the `manual_admin_edit` citation, and the settles would then protect a CSV figure as if a human
  had typed it. So a supplied figure that differs refuses; a blank cell keeps the stored figure (passes when it is the
  protected one); an identical figure passes. Consequence: a figure entered through any of the three writers is changed
  through the Data Editor or a `match_attendance` upload (both re-cite), not through `match_results`. `match_attendance`'s
  own policy is unchanged (runbook §12). **Acknowledged consequence (third pass):** because a `match_attendance` upload
  cites `manual_admin_edit`, this protection also stops `match_results` from replacing an attendance figure previously
  supplied through `match_attendance` (a different figure refuses; an identical or blank one passes). That is a behaviour
  change for `match_results` only; the `match_attendance` writer itself is unchanged.
- **D-271-3 (inconsistent stored authority fails closed).** The cases: an active override under a key no match carries;
  two active rows disagreeing on a field (the replay refuses the same); a group the editor does not define (the settles
  answer `indeterminate`); an unreadable or double-encoded payload; a protected score component not recorded; and a stored
  value that already disagrees with its active override (for example a pre-fix promotion reverted it) under a silent cell.
  In each, the writer cannot establish what the protected value is, or that the canonical row still holds it, so it cannot
  prove the write leaves the human decision intact. The repository's rule for that is to refuse: "Every answer it cannot
  fully justify is `'indeterminate'`, which refuses" and "Unreadable authority is not absent authority"
  (`manual-authority.ts`). For the drifted-value case there is a second reason: a silent cell keeps the drifted component
  (`COALESCE`) while `home_score` is always written, so the row could only fail `matches_score_components_ck` (protected
  total) or ratify the drift in this promotion's batch (drifted total). Supplying the protected component passes and
  repairs the drift. Consequence: the operator re-saves the match in the Data Editor (restoring the canonical
  values) or corrects the override, then promotes; nothing is lost.
- **D-271-4 (a missing authority reader fails closed).** Validation without a reader (or with a failing one) is an error
  row, exactly as `player_match_stats` does for ISSUE-264 (`matchSheetAuthority` absent → `no authority reader was
  supplied`). The only production caller, `validateSubmission`, always supplies it; a caller that does not cannot answer
  the authority question, and an `ok` verdict would assert something unchecked. Promotion re-checks regardless, so this
  costs only an honest report. The reader cannot stand in for promotion's check: its per-key cache lives for one
  `validateSubmission` call, and the promotion hook receives only `{ sql }` and reads authority itself after the match lock
  (ISSUE-272 §17.11).

### 17.8 Not done

No historical assessment of past `match_results` promotions that may already have reverted a correction (a present-state
comparison of active overrides against canonical values would be a separate read-only census; none was prepared). No
change to `match_attendance`, the shared submission lifecycle, numeric formats or the schema.

### 17.9 Next action

*(Historical. Order revised in the third pass: see ISSUE-272 §17.10. The integration run has since passed: §17.12; the
current next action is ISSUE-272 §17.14.)* Operator review; the integration run; commit,
`merge:ready`, merge; the ISSUE-272 DEV census and its review; then DEV deployment; resolve only after the applicable
acceptance. PROD installation rides on the ISSUE-265 hold (unchanged). No operator decision is outstanding for this issue
(§17.7); ISSUE-268 D-268-3 still governs what happens to a refused (`failed`) submission. The §17.10 follow-ups are open.

### 17.10 Review corrections, operator validation and open follow-ups (2026-10-10, third pass; uncommitted)

Agent: Read, Grep and Edit only; no command of any kind; no subagent; nothing staged or committed. No production code
changed. The issue stays **Open**; the PROD hold is unchanged.

**Operator validation, 10 October 2026 (the second-pass tree, before this pass).** `tests/ingest-datasets.test.ts`
**246/246 passed** (start 09:40:51 AEDT); `npx tsc --noEmit` passed; ESLint over the five §17.6 files passed;
`git diff --check` passed. The integration files have **not** run; their environment is listed in ISSUE-272 §17.12.
Earlier "no command run / UNRUN" statements in this runbook are historical.
*(Further superseded: "The integration files have **not** run" above and the "Database evidence outstanding" bullet below
are historical; the integration files have since passed (§17.12). What §17.12 does not close is listed there.)*

**Recorded, not tested, not accepted by the operator, not resolved** (no production-code change in this batch):
- **F4, orphaned overrides.** An active `matches` override whose key no match carries refuses promotion (D-271-3, fail
  closed), and the refusal's Data Editor link (`/admin/data-editor?entity=matches&id=…`) cannot reach a match that does
  not exist, so the operator has no in-app path to clear it. How such rows arise and how they should be resolved needs
  investigation. No repair was performed.
- **F5, validation-reader bounds.** The validation authority reader (`matchSheetAuthorityReader` in
  `src/lib/ingest/pipeline.ts`) opens its import-role connection with `{ max: 1 }` and no `connect_timeout`, and its READ
  ONLY transactions set no `statement_timeout` or `lock_timeout`. The connection predates this batch (the ISSUE-264
  reader); ISSUE-271 added a second query on it. Bounding it is a follow-up.
- **Race coverage.** No test drives a real Data Editor save (`saveEdit`) concurrently with a promotion; the integration
  case emulates `saveEdit`'s end state between validation and promotion. The lock ordering argument (§17.3) is untested
  against PostgreSQL.
- **Database evidence outstanding.** The restricted import-role reader path (only exercised when
  `AFLDB_TEST_IMPORT_DATABASE_URL` is set; otherwise the owner role runs it) and the `manual_admin_edit` attendance citation
  against PostgreSQL have no database evidence yet.
- **Absent matches.** Where the canonical key names no stored match there is no authority to check; protection against a
  concurrent creator depends on the existing settle/promotion gate the name-keyed creators take (ISSUE-272 §17.8).
- **Key-scheme limit.** The authority read and the update apply only to a match held under the compatible canonical
  name-keyed identity; an admin-created club-ID-keyed match for the same fixture is not reached (ISSUE-272 §17.8;
  ISSUE-182/ISSUE-306 not implemented).

### 17.11 Integration window result (2026-10-10, fourth pass; corrections uncommitted and UNRUN) *(historical: the failed window; the corrections were since run and passed, §17.12)*

Agent: Read, Grep and Edit only; no command of any kind; no subagent; nothing staged or committed; nothing re-run or
recovered. The full record (run, causes, corrections, gaps, next action) is **ISSUE-272 §17.13**. This issue stays **Open**;
the PROD hold is unchanged.

- **Earlier State A precondition failure (historical, preserved; operator-confirmed):** the direct Vitest run at 10:10:37
  AEDT on 10 October 2026 (operator-provided console evidence): 39 passed, 22 skipped; the ISSUE-264 `beforeAll` refused
  because migration 110 was absent. It was a direct invocation, **not** a runner window, so no runner evidence directory
  exists for it. Full record: ISSUE-272 §17.14, *Historical runs*, item 1.
- **Run:** operator, 10 October 2026, evidence `D:\tmp\issue271\apply-20261010-120323-16676` (Preflight
  `preflight-20261010-115354-6484`, PASSED). `match-results-promotion.test.ts` **44 passed, 1 failed, 0 skipped, 45 total**;
  `datasets.test.ts` **16/16**. Full integration validation **failed**.
- **This issue's cases:** *a correction recorded after validation wins …* and *validation reports the conflict under the
  canonical key …* **both passed**, with the suite's import connection set to `afldb_import` on `afldb_test`. That is
  database evidence for those two cases only. The §17.10 "restricted-role" gap is narrowed for them, not closed: the
  manual-attendance-citation path, the race, F4 and F5 remain open.
- **Failure:** ISSUE-264 F-002 *blocks deleteMatch until the promotion finishes*, 23505 `club_seasons_uq` (2073, 59). This
  is a fixture interaction, not a defect in this issue's code (ISSUE-272 §17.13, cause 1). The fixture is corrected, unrun.
- **Restoration and reporting:** State A verified against the capture; censuses ACCOUNTED with all fixture residue
  counters zero. The runner's final report then threw `Argument types do not match`. That failure is separate; the runner is
  corrected, unrun, and needs a fresh Preflight. *(Historical: since run; see §17.12.)*

### 17.12 Successful validation window (2026-10-10, fifth pass; implementation still uncommitted)

Agent: Read, Grep and Edit only; no command of any kind; no subagent; nothing staged or committed; nothing re-run. The
evidence directories were not re-read: this is recorded from the operator's report. Documentation only; no source, test,
census SQL, runner or helper changed. The full record (run, scope, restoration, coverage limit, historical runs, gaps, next
action) is **ISSUE-272 §17.14**. Both issues stay **Open**; the PROD hold is unchanged.

- **Run:** Preflight `D:\tmp\issue271\preflight-20261010-122730-18800`; Apply `D:\tmp\issue271\apply-20261010-122808-24240`;
  runner SHA-256 `35E4085F20C7E273853C5294793A5F9C998D9604BD4EB33FA8BB021C0EE641E6`; branch `sonnet/issue-271`, HEAD
  `41cbf7309ebb32501c731afa314f86dd1ec57746`, implementation uncommitted.
- **Result:** `match-results-promotion.test.ts` **45/45** (started 12:28:20 AEDT, 260.15 s); `datasets.test.ts` **16/16**
  (started 12:32:44 AEDT, 3.46 s); **61/61 passed**, 0 failed, 0 skipped, 0 todo; both suite exits 0; window exit 0. The
  previously failing ISSUE-264 F-002 `deleteMatch` case passed. The final report completed.
- **This issue's cases:** both ISSUE-271 cases (*a correction recorded after validation wins …* and *validation reports the
  conflict under the canonical key …*) passed again, with the restricted import role proved on the same server and its
  connection strings supplied to the suites (`AFLDB_TEST_IMPORT_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`). The roles were
  **proved before the suites**; `current_user` was **not** asserted inside every application connection.
- **Scope:** `afldb_test` only (`127.0.0.1:55432`). State A restored and verified (see ISSUE-272 §17.14). The census coverage
  limitation applies: the database is **not** claimed wholly unchanged or residue-free.

**Still open for this issue (unchanged by the pass):** no real Data Editor `saveEdit`-versus-promotion concurrency test (the
integration case emulates the end state); no dedicated PostgreSQL case for the `manual_admin_edit` attendance citation; F4
(orphaned overrides refuse with an unreachable editor link); F5 (validation-reader connection and statement bounds); the
name-key versus club-ID-key limitation (ISSUE-182/ISSUE-306 not implemented); the existing ISSUE-268 D-268-3 failed-submission recovery decision.
No past promotion has been assessed for a reverted correction.

**Next action.** Operator review and commit; merge readiness on a fresh ref, fast-forward `main`, push `main`; the ISSUE-272
read-only DEV census (unrun, not syntax-checked) run and reviewed **before** DEV deployment; then DEV deployment and the
applicable acceptance. PROD installation and acceptance stay behind the unchanged ISSUE-265 hold. DEV acceptance alone does
not close this issue.
