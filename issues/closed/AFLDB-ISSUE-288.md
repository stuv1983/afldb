# AFLDB-ISSUE-288 — `createCoach` casts an unvalidated `dob` outside its error handling

## 0. Status

- **Status:** **RESOLVED, DEV-scoped (2026-10-14).** Opened 2026-10-08. Implemented 2026-10-12 in batch worktree `afldb-batch-315-281-312-288` (branch
  `opus/batch-315-281-312-288`, base `80f86c39`); DB-free validated; both `afldb_test` integration refusal cases passed (§17.7);
  committed as `44ea8ce2`; merged to `main` by `01976be7` on 2026-10-13 (pushed: an ancestor of the live `origin/main`, verified 2026-10-14); installed on DEV 2026-10-14 13:52 AEDT (TARGET `17514052`, runbook 275 §30; installation checks PASS); DEV refusal smoke with visual evidence done 2026-10-14 and graded PASS by the owner under the revised paired-evidence criterion (§18); DEV-scoped closure authorised. `VISUAL: UNVERIFIED` no longer applies, but the original same-screen visual criterion was **not** met (§18). **PROD installation and PROD acceptance are PENDING** (the ISSUE-265-specific PROD hold was released by `a862d192`; PROD still needs its own reviewed procedure, `blockers.md` R6). The closure is DEV-scoped and says nothing about PROD (§17, §18).
- **Severity:** Low. **Area:** admin coaches.
- **Key files:** `src/db/queries/admin-coaches.ts` (`createCoach`, `saveCoachMetadata`), `src/app/admin/coaches/actions.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-023; partition note R2c-F04).
- **Classification:** code-proven. The user-visible rendering of a thrown Server Action is framework-defined.

## 1. Summary

`createCoachAction` only trims and slices `dob`. `createCoach` runs its duplicate checks on the public pool with `${input.dob}::date` before the import transaction's try/catch. A non-date such as `2026-02-30`, `31/12/1980` or `x` therefore throws an uncaught PostgreSQL error out of the Server Action, instead of returning `{ error }`. `saveCoachMetadata` performs the same cast inside its try and surfaces the raw PostgreSQL message.

## 2. Evidence

- `src/db/queries/admin-coaches.ts:362-375`, `:409` (casts before the try at `:427-463`) and `:486-545`.
- `src/app/admin/coaches/actions.ts:75` (`optionalText(dob, 10)`).
- Contrast: real-calendar-date validation in `admin-fixtures.ts:299-307` and `admin-club-leadership.ts:218-226`.

## 3. Trigger

A direct POST, a browser without `type=date` support, or a pasted value.

## 4. Expected invariant

A validation refusal sentence. The date is checked as a real calendar day before any SQL.

## 5. Actual behaviour

An uncaught Server Action error. Lenient forms such as `2027-2-3` are accepted and stored in a different form from what was typed.

## 6. First wrong layer

`src/db/queries/admin-coaches.ts:362-375`.

## 7. Impact

Operational only (Super Admin input). No integrity effect.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no date guard in `coaches/validation.ts`, and the pre-transaction queries are not wrapped.

## 10. Existing-issue search

`issues.md` was searched for `createCoach` and `dob::date`. The only hit is ISSUE-159's family list. Classification: **new**.

## 11. Scope

Coach `dob` validation.

## 12. Out of scope

The duplicate-name TOCTOU (recorded as INFO in the review).

## 13. Proposed fix boundary

A real-date check (`YYYY-MM-DD` plus round-trip) in `createCoach` and `saveCoachMetadata` before any SQL.

## 14. Proposed validation

1. DB-free unit test of the date helper.
2. An integration case posting a bad dob.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Superseded by §17.5.

## 17. Implementation and DB-free validation (2026-10-12, batch with ISSUE-315/281/312; solo, no agents)

Worktree `D:\dev\afldb-batch-315-281-312-288`, branch `opus/batch-315-281-312-288`, base
`80f86c39baf65e04921148c166d9b2c6791b06bf`. No database, host, commit, merge, push or deployment.

### 17.1 Change

- `src/db/queries/admin-coaches.ts`: new exported pure helper `coachDobError(dob)`; `createCoach` and `saveCoachMetadata`
  call it after their existing length checks and **before any SQL** (both coach actions, `createCoachAction` and
  `saveCoachMetadataAction`, reach SQL only through these two functions). Refusal sentence:
  `Date of birth "<value>" is not a real date. Use YYYY-MM-DD.` The action returns it as `{ error }` and audits it as
  `admin.coaches_refused`, like every other refusal.
- The check is strict `YYYY-MM-DD` plus plain proleptic-Gregorian arithmetic (year ≥ 1, month 1-12, day within the
  month, leap year = divisible by 4 and not by 100 unless by 400), the operator's string stored unchanged. **Correction
  pass r2:** r1 used the fixture/leadership helpers' `Date.UTC` round-trip, but `Date.UTC` remaps years 0-99 to
  1900-1999, so r1 refused real dates such as `0001-01-01` and `0004-02-29`. Every positive four-digit year 0001-9999 is
  now checked as itself; **year `0000` is refused explicitly**, because PostgreSQL's date input rejects it. No age,
  plausibility or future-date rule was added. (`admin-fixtures.ts` and `admin-club-leadership.ts` keep their own helpers,
  unchanged and out of scope.)
- **Preserved:** `null` (a blank field; `optionalText` turns `''` into `null`) is still allowed and still means
  "unrecorded"; the `optionalText(dob, 10)` trim/slice in `actions.ts` is unchanged; the other modules' date helpers are
  untouched. **Changed on purpose:** a lenient form such as `2027-2-3`, which PostgreSQL used to accept and store as
  `2027-02-03`, is now refused (§5).

### 17.2 Tests

- `tests/admin-coach-actions.test.ts` (existing DB-free coach suite): `coachDobError` accepts `null`, ordinary dates and
  the leap days `2024-02-29`, `2000-02-29`, `1896-02-29`; refuses `2023-02-29`, `1900-02-29`, `2100-02-29`; refuses
  `2026-02-30`, `2025-04-31`, `-06-31`, `-09-31`, `-11-31`, `2025-01-32`, `2025-13-01`, `2025-00-10`, `2025-01-00`; refuses
  non-strict shapes (`31/12/1980`, `x`, `2027-2-3`, `1980-1-01`, `''`, a leading space, `19800101`). **r2 boundary
  cases:** accepts `0001-01-01`, `0050-06-15`, `0099-12-31`, `0004-02-29`, `0400-02-29`, `9999-12-31`; refuses
  `0050-02-29`, `0099-02-29`, `0100-02-29`, `0001-02-29` (not leap in their own right) and `0000-01-01`, `0000-02-29`,
  `0000-12-31`. `createCoach` and
  `saveCoachMetadata` **resolve** to exactly that refusal for impossible dates; without the guard they reach SQL, so this
  is strict against a placeholder DSN (connection refused) and against `afldb_test` (cast error, or a different sentence).
- `tests/integration/admin-coaches.test.ts` (existing suite, **written, not run**): `createCoach` refuses four bad dobs and
  no coach row with that name exists afterwards; `saveCoachMetadata` refuses three bad dobs on the sourced fixture coach,
  whose **complete `getCoachAdminDetail` result** (r2; r1 compared only the display name) and `data_edits` count are
  unchanged afterwards. The suite's existing cases already cover a valid dob
  (`1950-01-01`, `1960-06-06`, `1970-07-07`) and `null` on PostgreSQL.

### 17.3 Results

- `tests/admin-coach-actions.test.ts` with a placeholder `DATABASE_URL` (port 1 on loopback, nothing listening; the
  file cannot load without one): **23 passed** (16 existing + 7 new).
- Mutation check: with both guard returns removed, **2 failed** (the two mutation cases; each attempted a connection to
  the placeholder and was refused), 21 passed; restored.
- Batch-wide typecheck exit 0; lint: no error in a changed file (the late integration-test edit was re-checked with `tsc`
  and ESLint on that file, both clean).
- **r2 (correction pass, 2026-10-12):** `tests/admin-coach-actions.test.ts` **25 passed** (16 existing + 9 new). Mutation
  check: with r1's `Date.UTC` round-trip restored, **1 failed** (the 0001-0099 case), 24 passed; restored byte-identical.
  Typecheck exit 0; ESLint on every changed file, 0 errors.

### 17.4 Fixture effects of the proposed checks

- `afldb_test` (§17.5 step 2): the file-level `beforeAll`/`afterAll` still run under `-t`, so the run creates and removes
  the suite's own fixtures: marker `AFLDB-ISSUE-159-TEST` sourced coach, season 2091, one match on it, one player
  (slug `afldb-issue-159-test-player`) and its external identity, a throwaway `auth_users` admin **only if the table is
  empty** (otherwise the first existing user is borrowed, not changed), and the test function
  `issue159_test_force_data_edits_failure()` plus trigger `issue159_test_force_data_edits_failure_trg` on `data_edits`.
  The `afltables` `sources` row and the clubs are read, never written. The two selected cases write nothing.
- DEV smoke: each refusal writes one `auth_audit_log` row (`admin.coaches_refused`); retained by design, no cleanup. No
  coach, override or `data_edits` row.

### 17.5 Remaining criteria and next action

1. **Done 2026-10-12:** operator review of the batch diff, then a separate local commit for this issue. Committed
   locally (`44ea8ce2`); merged to main 2026-10-13 (`01976be7`; pushed: an ancestor of the live `origin/main`, verified 2026-10-14).
2. **Done 2026-10-12, PASSED (§17.7).** `afldb_test` (operator, tunnel, `AFLDB_TEST_DATABASE_URL` in the child environment only, `current_database()` proved
   first). **r2 plan, replacing r1's whole-file run** (r1 would also have run the §10.2 gate 9 case, which replays the
   importer's override SQL; that is not needed for this issue):
   1. **Before**, run the census in §17.6 and require: every cleanup-selector column (`coaches` through `fn`) = 0, which
      includes fixture season 2091 absent and the test trigger **and** function absent. Record `users_n`, `users_fp`,
      `sources_n`, `sources_fp`. If any selector is non-zero, **stop**: the suite's `afterAll` would delete those rows
      (its selectors are marker-, season- and id-based), and season 2091 would be deleted even though the suite's
      `INSERT ... ON CONFLICT DO NOTHING` did not create it.
   2. Run only the two new cases:
      `node node_modules/vitest/vitest.mjs run tests/integration/admin-coaches.test.ts -t "AFLDB-ISSUE-288" --reporter=verbose`.
      Accept: **2 passed**, every other case in the file skipped, exit 0. (The DB-free `tests/admin-coach-actions.test.ts`
      is not part of this run; it is covered in §17.3.)
   3. **After**, run the same census and require: every cleanup-selector column = 0 again, and `users_n`, `users_fp`,
      `sources_n`, `sources_fp` identical to the before values (shared users and sources preserved).
3. Merge/push and DEV deploy, **held until ISSUE-274's first-nightly evidence is captured** (captured: ISSUE-274 runbook §33). **Merged to main 2026-10-13 (merge `01976be7`) and pushed (verified 2026-10-14); the DEV deploy happened 2026-10-14 13:52 AEDT (runbook 275 §30); the smoke and its visual evidence were done and graded the same day (§18).**
4. DEV smoke as Super Admin on `/admin/coaches`: submit an impossible dob (`2026-02-30`) on Create and on an existing
   coach's metadata form (the browser's date picker blocks it, so change the input's type to text in devtools or paste
   the value); expect the sentence above, no error page, no new coach, metadata unchanged. Leave the form blank once and
   confirm a blank dob is still accepted only if a real edit is wanted (it writes canonical data; not required, the
   `afldb_test` suite covers it).
5. Then the issue may be **closed DEV-scoped**, recording PROD shipping as pending behind the unchanged ISSUE-265 hold. **Done 2026-10-14 (§18):** graded PASS and closure authorised by the owner; the wording "behind the unchanged ISSUE-265 hold" is superseded: that hold was released by `a862d192`, and PROD installation and acceptance are still PENDING, needing PROD's own reviewed procedure.

### 17.6 `afldb_test` census for §17.5 step 2 (read-only)

```sql
SELECT current_database() AS db,
  (SELECT count(*) FROM coaches
    WHERE display_name LIKE '%AFLDB-ISSUE-159-TEST%' OR afltables_coach_path LIKE '%AFLDB-ISSUE-159-TEST%') AS coaches,
  (SELECT count(*) FROM data_edits
    WHERE (table_name = 'coaches' AND row_id IN (SELECT id FROM coaches
             WHERE display_name LIKE '%AFLDB-ISSUE-159-TEST%' OR afltables_coach_path LIKE '%AFLDB-ISSUE-159-TEST%'))
       OR (table_name = 'matches' AND row_id IN (SELECT id FROM matches WHERE season = 2091))) AS data_edits,
  (SELECT count(*) FROM data_overrides WHERE entity_key LIKE '%AFLDB-ISSUE-159-TEST%') AS data_overrides,
  (SELECT count(*) FROM match_coaches WHERE match_id IN (SELECT id FROM matches WHERE season = 2091)) AS match_coaches,
  (SELECT count(*) FROM matches WHERE season = 2091) AS matches_2091,
  (SELECT count(*) FROM seasons WHERE year = 2091) AS season_2091,
  (SELECT count(*) FROM players
    WHERE slug = 'afldb-issue-159-test-player' OR display_name LIKE '%AFLDB-ISSUE-159-TEST%') AS players,
  (SELECT count(*) FROM external_identities WHERE external_id LIKE '%AFLDB-ISSUE-159-TEST%') AS external_identities,
  (SELECT count(*) FROM auth_users WHERE email = 'issue-159-coach-test@example.test') AS throwaway_admin,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'issue159_test_force_data_edits_failure_trg') AS trg,
  (SELECT count(*) FROM pg_proc WHERE proname = 'issue159_test_force_data_edits_failure') AS fn,
  (SELECT count(*) FROM auth_users) AS users_n,
  (SELECT md5(string_agg(id::text || ':' || coalesce(email, '') || ':' || role::text, ',' ORDER BY id)) FROM auth_users) AS users_fp,
  (SELECT count(*) FROM sources) AS sources_n,
  (SELECT md5(string_agg(id::text || ':' || key, ',' ORDER BY id)) FROM sources) AS sources_fp;
```

The `data_overrides` selector for manual coaches (`manual_admin_edit:<uuid>`) is derived from the marker coaches, so
`coaches = 0` covers it.

### 17.7 `afldb_test` integration run: PASSED (2026-10-12, owner-authorised, run once)

Authorisation: one `afldb_test` window for the two reviewed batch-r2 selections (this one and ISSUE-315's O1), run
solo, separately, once each. Artefacts (logs, censuses, comparisons, harness): `D:\tmp\batch-315-281-312-288\run-20261012-db\`.

- **Provenance (before any connection; no Git command).** `batch-r2.diff` SHA-256 `7364edc4ea9e4c15…` (matches the
  reviewed value); every one of its 17 files' working blob id equals the diff's post-image id (computed in-process,
  `00-blobs.json`). The run therefore exercised base `80f86c39` plus exactly batch-r2, uncommitted.
- **Connection.** One tunnel `ssh -N -L 127.0.0.1:55432:127.0.0.1:5432` to the `streamanator` alias (`BatchMode=yes`,
  `ExitOnForwardFailure=yes`; no listener before; PID 27876; only that PID stopped afterwards, no listener remains).
  Only the `AFLDB_OWNER_DATABASE_URL` line of the main checkout's `.env` was read (role `afldb_owner`, no query options),
  rebuilt in process to `127.0.0.1:55432/afldb_test`, and handed to the child in its environment only; every
  `AFLDB_*`/`*DATABASE_URL`/`PG*` shell variable was dropped first, so the child's only database variable was
  `AFLDB_TEST_DATABASE_URL` (logged) and the restricted-role variables were unset. No `.env` in the worktree; no
  `postgres://` string in any artefact.
- **Before** (`10-census-288-before.json`, read-only session): server-reported `afldb_test`, `current_user` and
  `session_user` `afldb_owner`, not in recovery. Every §17.6 selector 0 (`trg` = `fn` = 0, season 2091 absent), the
  ISSUE-315 selectors 0, seasons 2091/2093/2094 absent; the 12 historical S6 `import_batches` (66–68, 325–327, 543–545,
  639–641) present with the whole-row md5 prefixes ISSUE-274 recorded. `users_n` 5 `users_fp` `6ddb112f…`, `sources_n` 14
  `sources_fp` `4c350adc…`, plus per-row `md5(t::text)` of every `auth_users` and `sources` row (hashes only). No other
  session on the database.
- **Run** (`11-run-288.log`): `node node_modules/vitest/vitest.mjs run tests/integration/admin-coaches.test.ts -t "AFLDB-ISSUE-288" --reporter=verbose`.
  **Exit 0; 2 passed, 13 skipped (15)**: "refuses an impossible date of birth with a sentence and writes nothing
  (AFLDB-ISSUE-288)" (75 ms) and "refuses an impossible date of birth before the transaction, not with a PostgreSQL
  message (AFLDB-ISSUE-288)" (303 ms). The §10.2 gate 9 importer-replay case was skipped (not run). The one NOTICE is the
  suite's own `DROP TRIGGER IF EXISTS` on a clean database.
- **After** (`12-census-288-after.json`, `13-compare-288.json`): gate passed; every selector 0 again, trigger and
  function absent; `auth_users` and `sources` per-row hashes and fingerprints identical; the 12 S6 batches identical
  (ids and row hashes); every recorded total identical (`import_batches` 729 with an identical whole-table row hash,
  `coaches` 386, `data_edits` 2, `data_overrides` 92, `matches` 16 838, `players` 13 365, `seasons` 130,
  `auth_audit_log` 203). No other session.
- **Sequence advances (fixture setup, informational):** `coaches_id_seq` 386→387, `external_identities_id_seq`
  20689→20690, `matches_id_seq` 18472→18473, `players_id_seq` 15752→15753 (the `beforeAll` fixture inserts, removed by
  `afterAll`). `data_edits_id_seq` did not advance: the two selected cases wrote no audit row.
- **Not covered:** the restricted roles (unset by design); DEV behaviour (step 4); the whole file.

## 18. DEV acceptance record, independent grading and closure (2026-10-14; DEV only)

**Authority and scope.** Owner instructions 2026-10-14: Playwright authorised for this task only (overriding the repository's browser-tool restriction; no policy file changed); the two invalid-date submissions and their two refusal audit rows authorised; the owner entered credentials directly in the Playwright browser window (none passed through chat or tools). DEV `http://10.0.40.100:8090`; deployed revision `17514052b5fce1326e24a786564dce4c7eee807b` (unchanged). `SMOKE_START` 20261014T151733. No deployment, restart, repair, retry, cleanup or PROD action. The browser run has not been repeated and was not repeated to build the grading package.

**What was done.** The first request to `/admin/coaches` redirected to `/admin/login` (the Playwright browser held no admin session; so the earlier ISSUE-281 browser context was not an admin session). After the owner signed in (audit `admin.login` 2026-10-14 04:24:55 UTC), the admin shell showed "Super admin" (a UI label; no cookie or token was inspected). Before: 386 coaches over 8 pages; Mick Malthouse `/admin/coaches/1` with display name `Mick Malthouse`, given name `Mick`, surname `Malthouse`, dob `1953-08-17`, notes `snapshot coaches-20260905`. Each form was submitted exactly once with the DOB input switched from `type=date` to `type=text` by script (a date control cannot hold `2026-02-30`): **Create** (name `Zzsmoke Testcoach288`, dob `2026-02-30`, nothing else) and **existing metadata** (Mick Malthouse, only the dob changed to `2026-02-30`). Both returned the alert `Date of birth "2026-02-30" is not a real date. Use YYYY-MM-DD.` (exact); no error page or stack trace (DOM checks false). Neither succeeded and no stop condition occurred.

**Facts recorded.**
- **One POST per form:** `v288-create-network.txt` entry 70 `[POST] /admin/coaches => 200` and `v288-metadata-network.txt` entry 71 `[POST] /admin/coaches/1 => 200`; each is the only POST in its log.
- **Two refusal audit rows** (`/admin/audit`): `admin.coaches_refused` at 04:26:31 UTC (create, displayName `Zzsmoke Testcoach288`) and 04:27:19 UTC (save_metadata, coachId 1), each with the exact reason; no creation row and no metadata-saved row among the 50 newest. The two rows are expected, are **retained**, and were **not** cleaned up.
- **Unchanged state (fresh loads, nothing submitted):** 386 coaches over 8 pages, all HTTP 200, no row matching `Zzsmoke` or `Testcoach288`, and the 386 valid list rows compared before and after as unchanged (compared in memory, canonical text SHA-256 `5ae4525d35a8222d2766918a80030134d3243497f80d0f5168097072848a4e27` on both sides; the owner also compared them directly); all captured Malthouse metadata (display name, given name, surname, dob `1953-08-17`, notes) unchanged.
- **Journal:** post-browser `smoke-journal.sh` (reviewed, true-array `-Command`, new log): window since 15:17:33 AEDT, run 15:28:27, exit **0 = PASS**, 466 lines, every counter 0 including `Failed to log administrative audit` and `ERROR`.
- **Console and network:** no console error in the 288 phase (the session-cumulative log holds only the earlier ISSUE-281 checklist 404 and 8 benign CSS-preload warnings); no non-2xx request in the create, metadata and final network logs; no credential, cookie, authorization header or token captured (network logs list method, URL and status only). The package does contain the owner's e-mail address and IP as the audit trail shows them: identifying details, not credentials.

**Independent grading (owner, 2026-10-14).**
- All **nine screenshots inspected**.
- Archive `D:\tmp\issue288-grading-pack-20261014.zip`, SHA-256 `72f90905c844332befa782ee2486c5eba445e54fca97166c537d67de446ad3b9`, 31 entries; **package manifest 30/30** and **saved evidence manifest `SHA256SUMS-288-browser-evidence.txt` 27/27** verified from a fresh extraction (the extracted `post\` files are byte-identical to the originals). The saved evidence manifest's own SHA-256 is `477686c60fef740c6c64f906b2a2be63c8b948df1fe4c914a2105c48461d3f98`; the journal log's is `bf8582d52abb094cb4ac7072aa06e3fb3dc25a9c0eed26f4b102e463173b8b2f`.
- **V-1 through V-4: PASS** under the **revised paired-evidence and screenshot-plus-URL criteria**: V-1 (Create) `v288-01a` before-submit, POST 70, audit 04:26:31, `v288-01b` refusal; V-2 (metadata) `v288-02a`, POST 71, audit 04:27:19, `v288-02b`; V-3 no error page, stack or other toast; V-4 no new coach (386, identical) and Malthouse unchanged (`v288-03a`, `v288-03b`).
- **The original same-screen criterion was NOT met** (PROCEDURE section 8 V-1/V-2 asked for the entered value and the sentence in one image). It is not described as met anywhere. The bounded amendment (owner-approved): unaltered page screenshots with exact requested/final URL records (`*-before-submit.json`, `*-after-submit.json`) stand in for a visible browser address bar; no address bar was drawn into any image.
- **Screenshot dimensions** are 958 x 888 px (the viewport captures), accepted as readable evidence.

**Limitations (recorded, not repaired).**
- **DOB controls reset after refusal.** In both refusal screenshots the DOB control shows an empty `dd/mm/yyyy` date control: the form was switched to `type=text` by script and the framework re-rendered it as `type=date` with an empty value after the Server Action returned. That is client-side state, not the stored value (the stored value is shown by the fresh-load evidence). So the entered `2026-02-30` is visible only in the before-submit images and the sentence only in the refusal images.
- **Saved canonical-text encoding damage (evidence-format limitation).** `v288-initial-rows-canonical.txt` (file SHA-256 `6d9c4e8cb8b7c5e9feb80e167984ec1f35f904f61dd038b3a07f3ce3794a364b`) was written with a UTF-8 byte-order mark and, by inference (the JSON was read with Windows PowerShell 5.1's default decoding), after the rows were read through the wrong decode path: six em-dash characters in it appear as mojibake (`â€”`). The initial and final comparison used the same decode path on both sides, so the equality result stands, but that file is not a faithful UTF-8 rendering of the rows and its content hash is not the hash of the true page text. The originals were **not** rewritten. `v288-initial-coach-list.json` also over-fetched past page 8; only its first 386 rows are the list.
- The Super Admin session is evidenced by the UI label and the audit `admin.login` row, not by token inspection; a blank-dob submission was deliberately not exercised (it writes canonical data and `afldb_test` covers it, §17.7).

**Root cause, fix, validation, closure.** Root cause: `createCoach` cast an unvalidated `dob` outside its error handling (§1). Fix: `coachDobError` runs in both mutations before any SQL (§17.1). Validation: DB-free 25/25 with a mutation check, `afldb_test` 2/2 (§17.7), and the DEV browser acceptance above. The owner graded the DEV evidence PASS and authorised DEV-scoped closure on 2026-10-14. **Not claimed:** PROD installation, PROD acceptance, the original same-screen visual criterion, or token-level proof of the admin session. **PROD installation and PROD acceptance remain PENDING.** DEV stays at `17514052`. The evidence lives outside the repository (`D:\tmp\dev-deploy-275-281-288\run-20261014-1333\post\` and the archive above); no in-repository artefact accompanied this runbook.
