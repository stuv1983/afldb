# AFLDB-ISSUE-272 — Legacy `match_results` builds the match key from the raw round code and creates duplicate matches

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. **Area:** legacy CSV intake / match identity.
- **Key file:** `src/lib/ingest/datasets.ts` (`match_results`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-007; partition note R5a-F05).
- **Classification:** reproduced (DB-free witness W3).
- **Status update (2026-10-10, appended; the lines above are the review's record):** implemented together with
  AFLDB-ISSUE-271 in worktree `D:\dev\afldb-issue-271`, branch `sonnet/issue-271`, intended base `41cbf730` (operator-stated).
  **Uncommitted, unvalidated** (no test, typecheck, lint, build or database command was run), not deployed, nothing repaired;
  the read-only duplicate census is prepared but **unrun and not syntax-checked**. Still Open. See §17. *(Historical: the
  "unvalidated / no command run" wording here and in §17's first two passes is superseded by the operator's results in
  §17.12.)*
- **Revision (2026-10-10, second pass; still uncommitted and UNVALIDATED):** promotion now refuses a whole submission in
  which two retained rows resolve to one canonical match key (an older `R1`/`1` or `gf`/`GF` pair, or one spelling twice),
  before the gate, any lock, any write or the import batch (§17.3, §17.4, §17.11). §17.7 is restated as the derived
  implementation basis; §17.8 no longer defers that collision to ISSUE-306.
- **Revision (2026-10-10, third pass: review corrections; still uncommitted):** operator validation of the second-pass tree
  recorded (DB-free 246/246, TypeScript, five-file ESLint and `git diff --check` passed; integration and census
  outstanding); one integration fixture date moved; census attribution and round-contract checks revised; historical
  identity, deployment-order and residual wording corrected. No production code changed. See §17.12.
- **Revision (2026-10-10, fourth pass: integration window result; corrections uncommitted and UNRUN):** the operator's
  window (`D:\tmp\issue271\apply-20261010-120323-16676`) **failed full integration validation**:
  `match-results-promotion.test.ts` 44 passed / 1 failed / 45, `datasets.test.ts` 16/16. **All six ISSUE-271/272 cases
  passed.** The failure (ISSUE-264 F-002 `deleteMatch`, 23505 `club_seasons_uq`) is a fixture interaction with this batch's
  two decided 2073 Grand Finals. Schema restored to the captured State A; the runner's final report then failed separately
  (`Argument types do not match`). The test fixture and the runner were corrected, both **unrun**; a fresh Preflight is
  required. No production code changed. See §17.13. *(Historical: "failed", "unrun" and "fresh Preflight required" are
  superseded by the fifth pass.)*
- **Revision (2026-10-10, fifth pass: successful validation window; implementation still uncommitted):** Preflight
  `D:\tmp\issue271\preflight-20261010-122730-18800` and Apply `D:\tmp\issue271\apply-20261010-122808-24240` passed:
  `match-results-promotion.test.ts` 45/45, `datasets.test.ts` 16/16, **61/61, 0 failed, 0 skipped, 0 todo**; State A
  restored and verified; final report completed. Both issues stay Open. The census is still **unrun and not
  syntax-checked**; review, commit, merge, DEV census, DEV deployment and acceptance are outstanding. Documentation only.
  See §17.14.

## 1. Summary

Canonical match keys use the bare number for home-and-away rounds and upper-case codes for finals. `match_results` accepts any non-empty `round_code` and builds the key from the raw string. So `R1`, `gf` or `Round 1` produce a key that matches no existing match. The stored-row lookup and the lock find nothing, and `ON CONFLICT (match_key)` does not fire, so a second `matches` row is inserted for the same fixture.

## 2. Evidence

- `src/lib/ingest/datasets.ts`:
  - `:640-662`: any non-empty `round_code` is accepted when `round_number` is present; finals codes are upper-cased only for the type lookup (`:643`).
  - The raw `row.round_code` is used for the stored-breakdown lookup (`:716`), the lock set (`:778-783`) and the insert (`:806-809`, `:819`).
- The canonical recipe: `tools/migration/import_fitzroy_core.py:1213-1221` (`R(\d+)` → bare number) and `:1880-1884`. `public/samples/match-results.csv:2-3` uses the bare number.
- `src/db/migrations/003_matches.sql:23`: `matches` has no other natural-key uniqueness.

## 3. Trigger

A row such as `season=2024, round_code=R1, round_number=1, match_date=2024-03-15, home_club=Richmond, away_club=Carlton, …` (fitzRoy's own round spelling), or `round_code=gf` for an existing Grand Final.

## 4. Expected invariant

The round code is normalised to the canonical form at validation, or refused, and the normalised code is used for the key, lookup, lock and insert.

## 5. Actual behaviour

The row validates `ok`, and promotion inserts a duplicate canonical match. Downstream, `resolveMatch` (`datasets.ts:290-295`) matches `round_code` exactly, so a `player_match_stats` file with the same spelling attaches to the duplicate.

## 6. First wrong layer

`src/lib/ingest/datasets.ts:640-662` (no normalisation), used at `:716`, `:778-783` and `:806-809`.

## 7. Impact

- Duplicate canonical matches, which double-count season, ladder, head-to-head and club pages.
- Player statistics split between the two rows.
- Nothing appears on the review page.

## 8. Reproduction / witness

W3 (DB-free, the `lockSql` stub pattern from `tests/ingest-datasets.test.ts:751`), output `D:\tmp\review-20261008-full\witness\w2.out`: `W3 match_results lock keys -> [["2024|R1|2024-03-15|Richmond|Carlton"]]`. The expected key is `2024|1|…`.

## 9. Disproof attempts

- There is no DB uniqueness on the natural key.
- `resolveMatch` and `matchResultsKey` do no normalisation.

## 10. Existing-issue search

- ISSUE-185 (provenance on this upsert), ISSUE-258 F-258-I4 (a different INFO), ISSUE-264 F-002 (lock order).
- Classification: **new**.

## 11. Scope

`match_results` round-code normalisation and its four key-building call sites.

## 12. Out of scope

Duplicate detection by club alias (AFLDB-ISSUE-306).

## 13. Proposed fix boundary

- One helper in `validateRow`: strip a leading `R` from a home-and-away code, upper-case finals codes, refuse anything else.
- Carry it as `resolved.round_code` and use it everywhere the key is built.

## 14. Proposed validation

1. DB-free: W3 must yield `2024|1|…`; add `validateRow` cases for `R1` / `gf` / `Round 1`.
2. Integration: promote `R1` against an existing `1` match and assert there is still one row.

## 15. Decisions / unresolved questions

- Whether any DEV or PROD promotion has already created such a duplicate. Read-only census: `matches` grouped by `(season, match_date, home_club_id, away_club_id)` having `count > 1`.

## 16. Next action

Implement together with AFLDB-ISSUE-271, then run the census.

## 17. Implementation notes (2026-10-10, appended; §0–§16 above are the review's record at `20a7a4bb`)

Worktree `D:\dev\afldb-issue-271`, branch `sonnet/issue-271`, intended base `41cbf730` (operator-stated; not checked, no Git
command was run). **Uncommitted. UNVALIDATED:** the agent ran no command of any kind (no test, typecheck, lint, build, Git,
SQL, SSH or network). Nothing was deployed or repaired. The issue stays **Open**. *(Historical for §17.1–§17.11: the
operator has since run the DB-free tests, typecheck, lint and diff check, §17.12. The agent still runs no command.)*

### 17.1 Re-check against the current files

The review's line numbers predate ISSUE-264/265/268; the defect itself was still present at the base: `match_results`
`validateRow` accepted any non-empty `round_code` when `round_number` was supplied (finals codes were upper-cased only for
the type lookup), and the raw cell built the key for the stored-breakdown lookup, the `preparePromotion` lock set, the
INSERT's `match_key`/`source_record_id`/`round_code` and so `ON CONFLICT (match_key)`. The existing DB-free lock test
asserted the raw key (`2073|R1|…`), the review's W3 witness.

### 17.2 The canonical contract, as derived (no new round policy)

- `tools/migration/import_fitzroy_core.py` `normalise_results_round`: `R(\d+)` → the digits for home-and-away; the six
  `FINALS_CODES` exactly; anything else refused. `interpret_results_row` then requires `str(round_number) == round_code`.
- `src/lib/acquisition/afl-api-rounds.ts` `translateAflRound`: a home-and-away code is `String(roundNumber)`.
- `public/samples/match-results.csv`: `1` with round_number `1`; `GF` with no round_number.
- `FINALS_ROUND_TYPES` in `datasets.ts` (kept in step with `FINALS_CODES`): EF, QF, SF, PF, GF, WF.

### 17.3 Behaviour implemented (`src/lib/ingest/datasets.ts`)

One pure reader, `readMatchResultsRound(rawCode, roundNumber)`, used by `validateRow`, `fileKey` and promotion:

| Cell (trimmed) | round_number | Result |
|---|---|---|
| `1`, `R1` | `1` | canonical `1` (home-and-away) |
| `R1`, `1` | empty, or a different number (`2`) | refused (the importer's `str(round_number) == round_code` rule) |
| `01`, `R01` | `1` | refused (not the canonical decimal spelling; never guessed) |
| `gf`, `GF`, `Qf`, `wf` | empty | canonical upper case (`GF`, `QF`, `WF`); case-folding of finals codes is what the validator already did |
| a finals code | supplied | refused (as before) |
| `Round 1`, `r1`, `Rd 1`, `OR`, empty | any | refused |

- `validateRow` carries the canonical code as **`resolved.round_code`** and uses it for the stored-breakdown lookup key and
  for the ISSUE-271 authority read. The uploaded cell is retained unchanged in `data_submission_rows.payload` (evidence).
- `fileKey` uses the canonical code, so `R1` and `1` (or `gf` and `GF`) for one fixture in one file are reported as
  duplicates; a refused round keeps its raw text (the row is an error row anyway). Club text is still compared raw
  (ISSUE-306, not implemented).
- **Promotion** never reads the raw cell for identity. `storedRowRoundCode(payload, resolved)` re-reads the retained cell
  with the same reader against the **stored** `resolved.round_number` and `resolved.round_type`, and, when present, requires
  `resolved.round_code` to equal the result. `preparePromotion` runs it for the whole file **before the gate, any lock or
  any read**; one failing row refuses the submission (`Nothing was promoted: N of M rows fail the round-code check applied
  at promotion …`). It then builds every row's canonical key (`matchResultsKey` over the stored season, the canonical round,
  the retained date and the stored resolved club names: the one construction validation, the lock and `promoteRow` use) and,
  still before the gate, refuses the whole submission if any key is claimed by more than one row (§17.11). The lock
  statement, the authority read, and `promoteRow`'s INSERT (`match_key`, `round_code`,
  `source_record_id`) and `ON CONFLICT (match_key)` all use the canonical key. `promoteRow` re-derives the same code
  itself (it receives the stored row, not the hook's result) and throws if it cannot.

### 17.4 Submissions validated before this fix

A pre-fix row has no `resolved.round_code`; its retained cell may be `R1`, `gf` or unsupported text the old validator
accepted alongside a round number. **Chosen behaviour: normalise when the stored row is consistent, otherwise refuse.**
An `R1` row whose stored round number is 1 and type `home_and_away` promotes onto `…|1|…` exactly as a fresh validation
would key it, so deploying the fix cannot recreate the duplicate-key path from a queued submission. A row with `Round 1`,
`r1`, `R01`, `R1` stored with round number 2, or a finals code stored as home-and-away, refuses the whole submission
before any lock or write; the submission is then `failed` (the refusal is thrown inside the promotion savepoint), and,
per the undecided ISSUE-268 D-268-3, a `failed` submission cannot be rejected or re-validated, so the operator uploads a
corrected file as a new submission. Rationale: the derivation is pure and identical to validation's, so normalising adds
no judgement; refusing every pre-fix submission instead would also be safe but would block correct `1`/`GF` files for no
gain.

Normalising a pre-fix submission includes today's duplicate rule. The old `fileKey` compared raw round text, so a pre-fix
submission can hold two `ok` rows for one fixture (`R1` and `1`, `gf` and `GF`); normalised, both name one canonical match
and would each write it in turn. Promotion therefore refuses the whole submission when two rows resolve to one canonical key
(§17.11), with the same outcome as above (`failed`, nothing written, no batch).

### 17.5 Tests added or changed (UNRUN when written; DB-free file since passed, §17.12)

- `tests/ingest-datasets.test.ts`: a new *AFLDB-ISSUE-272 match_results canonical round codes* block (reader table for
  `R1`→`1`, `gf`→`GF`, canonical inputs, and refusals of `Round 1`, `r1`, `01`, `R01`, mismatched numbers; `resolved.round_code`
  and the canonical key at the stored-breakdown lookup and the authority read; the retained cell unchanged; duplicate
  detection of `R1`/`1` and `gf`/`GF`); the `match_results promotion lock` block now asserts the **canonical** lock keys
  (W3's expected `2073|1|…`), and a nested *AFLDB-ISSUE-271/272 promotion re-check* block covers an older prevalidated `R1`
  row and an older `gf` row (canonical lock and authority-read keys), whole-file refusal of unsupported or inconsistent
  stored rounds before any query, and `promoteRow` binding the canonical key (as `match_key` and `source_record_id`)
  and the canonical `round_code` while the payload keeps `R1`.
- `tests/integration/match-results-promotion.test.ts`: new *AFLDB-ISSUE-271/272* block inside the ISSUE-258 block (fixture
  clubs, season 2073): an `R<n>` row and a lower-case `gf` promote onto existing canonical name-keyed matches (created by
  this file's own earlier `match_results` promotion) leaving **one row each**,
  with the retained cells unchanged; an older prevalidated `R<n>` row (validated, then stripped of `resolved.round_code`)
  promotes onto the canonical match leaving one row; a pre-fix row with `Round <n>` refuses whole and leaves the submission
  `failed` with no batch and no match change. **Harness change:** match_results now refuses this file's long-standing
  synthetic round labels (`R185A`, `R258X`, `R258L3`, …), so each label is mapped to its own canonical round number by a
  new `fixtureRound()` helper used by every payload, key and lookup; the ISSUE-185 helper's stored `round_number` follows the
  code. No assertion was weakened.
- `tests/integration/datasets.test.ts`: the two synthetic `R258V`/`R258D` codes became `R1`/`1` on a date no 1989 match
  used, plus `resolved.round_code` asserted.

### 17.6 Census (prepared; UNRUN; NOT syntax-checked)

`issues/open/AFLDB-ISSUE-272-duplicate-match-census.sql`, following the ISSUE-267/269 census conventions (read-only
repeatable-read transaction, 30 s statement / 5 s lock timeout, `\echo` sections, `ROLLBACK`, `== Done.`; no
INSERT/UPDATE/DELETE/DDL). *(Section list revised in the third pass, §17.12; the file header is authoritative.)*
Sections: (0) target; (1) candidate groups per `(season, match_date, home_club_id, away_club_id)` with more than one
match, how many contain a round-contract breach or a noncanonical spelling, and the group and row counts per provenance
class; (1b) per season; (1c) the whole table by provenance class × round-contract result × spelling; (2) unrestricted
row total, then every row of every group with key, the four round checks, scores, venue, provenance class and raw
provenance columns, creating batch, player-stat row count and active `matches` override count (LIMIT 500); (3)
round-contract breach totals, including **singletons** (no other row on that season/date/pairing) and singletons with
no provenance; (3b) breaches by check combination with example spellings; (3c) the breaches listed (LIMIT 200);
(4) supplementary, totals then listing: same season/date/pairing with home and away swapped.

**Round contract checked (§17.12):** spelling (bare decimal number for home-and-away; exactly upper-case
EF/QF/SF/PF/GF/WF otherwise; `gf`, `R1`, `01` are reported as recognised-but-noncanonical, not accepted), type (the code's
reading equals `round_type`), number (home-and-away digits equal `round_number`; other rounds NULL) and `is_final`.

**Provenance classes:** `match_results_upload_batch` (batch tool `admin-upload`, target `match_results`: the only positive
upload signal); `no_provenance_unknown_origin` (`source_id`, `source_record_id` and `import_batch_id` all NULL: origin
unknown; older uploads may have stored none of the three, but so may other writers; **not** labelled upload-created or
confirmed damage); `other_provenance`. The absence of the batch signal does **not** exclude historical upload involvement.
No retained-submission attribution is used: a retained `data_submission_rows` row records what a file said, not which
match a promotion created or updated, so tying one to a match would rest on a fixture that merely looks alike.

Run (operator), DEV, as the ISSUE-267 census was (single quotes keep PowerShell from expanding `$…`):

```powershell
scp D:\dev\afldb-issue-271\issues\open\AFLDB-ISSUE-272-duplicate-match-census.sql dev:/tmp/issue272-census.sql
ssh dev 'cd ~/projects/afldb && set -a && . ./.env && set +a && psql $AFLDB_IMPORT_DATABASE_URL -X -v ON_ERROR_STOP=1 -f /tmp/issue272-census.sql; echo psql exit status: $?; rm /tmp/issue272-census.sql'
```

PROD only if the operator chooses, with the ISSUE-265 §16.2 pattern (`scp` to `afldb:/tmp/issue272-census.sql`,
`ssh -t afldb`, then on the host `sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d afldb_prod -f - < /tmp/issue272-census.sql`,
then remove the file). Section 0 must name the intended database with `transaction_read_only = on`; the last lines must be
`== Done.` and exit status 0.

**A candidate is not confirmed ISSUE-272 damage.** A second row for a season/date/pairing can be a genuine second fixture,
a source that numbers a round differently (the AFL API Opening Round offset), a club identity or alias difference in the
key (ISSUE-306), a date or rekey correction that left an older row, an admin-created match, or test-fixture residue. A
non-canonical code with a `match_results` upload batch is the strongest signal; each group needs review. **Historical
impact remains unknown until the census is run and reviewed. No repair is proposed.**

**Run on DEV and review before DEV deployment (third pass, §17.12).** The fix normalises *future* uploads; it does not
repair an existing non-canonical match. Where only an old `R1`-keyed row exists for a fixture, a corrected upload keys it
`…|1|…`, finds no row and inserts a **canonical twin** beside the old one. So the DEV census, **including the singleton
non-canonical rows** (§3 `singleton_breaches_no_same_fixture_row`, listed in §3c with `same_fixture_rows = 0`), is to be
run and reviewed before the DEV deployment. Any candidate found needs its disposition reviewed by the operator; nothing is
to be repaired, rekeyed, deleted or merged automatically.

### 17.7 Implementation basis (derived from the existing contracts; not operator decisions)

The labels D-272-1…4 are kept so earlier references stay valid. Each point below follows from a contract already in the
repository; none was an operator decision and none needs one. Revised 2026-10-10 (second pass).

- **D-272-1 (round spelling, letter case).** The canonical importer reads a results round with `^R(\d+)$` and finals with
  `code in FINALS_CODES` (`tools/migration/import_fitzroy_core.py` `normalise_results_round`), both exact-case; the stored
  home-and-away form is the bare digits (`normalise_stats_round` `^\d+$`, `translateAflRound` `String(roundNumber)`, the
  sample CSV). So `R1` and `1` are canonical spellings and `r1` is not. Finals differ for one reason: this validator already
  recognised finals codes case-insensitively (`FINALS_ROUND_TYPES[code.toUpperCase()]` chose the round type before the fix),
  so `gf` already *meant* the Grand Final here and only its key was wrong; keeping that reading and upper-casing it is the
  fix, not a new alias. The pre-fix validator never interpreted a home-and-away code at all (any text passed with a
  round_number), so there is no earlier reading of `r1` to preserve, and accepting it would be a new alias. Consequence: a
  file spelling `r1`, `Round 1` or `Rd 1` is an error row; a pre-fix submission holding one refuses whole at promotion.
- **D-272-2 (leading zeros).** The importer requires `str(round_number) == round_code` after stripping `R`, so `R01` with
  Round.Number 1 is refused there; `01` is never a stored code. The reader applies the same equality, so `01`/`R01` are
  refused rather than normalised. The round_number cell keeps its existing reading (`toIntOrNull`), so `1.0` still reads
  as 1; numeric-format policy was not changed.
- **D-272-3 (pre-fix submissions).** Normalised at promotion exactly as validation now normalises (the same pure reader
  against the stored round number and type), refused whole when inconsistent, **and refused whole when two rows resolve to
  one canonical key** (§17.4, §17.11): normalisation includes today's duplicate rule, so it cannot let two spellings of one
  fixture both write.
- **D-272-4 (round 0).** The importer's contract admits `R0` with Round.Number 0 (`^R(\d+)$`, then `str(0) == "0"`), and
  the reader follows it: `0`/`R0` with round_number 0 is the canonical `0`. Nothing in the canonical contract singles out
  0. The declared vocabularies show why a `0` is *numbering*, not spelling: AFL Tables numbers the 2026 Opening Round 1,
  Squiggle and Kali number it 0, one lower from 2024 (`data/reference/source-families.json` `afltables_2026`,
  `squiggle_2026`, `kali_2026`), and `translateAflRound` maps the AFL API onto the canonical number. A file in a 0-based
  vocabulary is off by one on **every** round, so refusing `0` alone would not stop it; that is the residual in §17.8,
  outside a spelling fix. Whether any stored match carries round 0 was not checked (no database read).

### 17.8 Residuals (not fixed here)

- `player_match_stats` `resolveMatch` still matches `round_code` exactly (`round_code = ${roundCode}`). A stats row spelt
  `R1` finds no match **written by the fixed** `match_results` (which writes `1`) and is then refused as unmatched; it is
  not normalised. *(Corrected, third pass: the earlier wording implied an `R1` stats row can no longer find any match.)*
  It still attaches to an **existing** old `R1`-keyed row for that season and pairing, so historical non-canonical
  matches stay reachable by an exact-spelling stats upload. Not in this scope.
- **Existing non-canonical matches are not repaired** by this fix, and normalising future uploads can make them worse: a
  corrected upload for a fixture held only under an old non-canonical key inserts a canonical twin (§17.6). Census review
  precedes DEV deployment (§17.10).
- **Key-scheme compatibility (pre-existing; ISSUE-182 context, not implemented here).** `ON CONFLICT (match_key)` updates
  an existing match only when it is held under the compatible canonical **name-keyed** identity
  (`season|round|date|home name|away name`, era-appropriate names). Admin match creation (`createMatch`,
  `src/db/queries/match-admin.ts`) keys by club **IDs**, and `canonical-apply.ts` writes its bundle's own key verbatim
  (per the `createMatch` comment); a `match_results` row for a real fixture held under a key it does not reproduce
  exactly, an admin-created club-ID key in particular, does not conflict and inserts a second row. ISSUE-182 added
  identity-based duplicate detection to `createMatch` only; `match_results` has no equivalent. Recorded, not changed.
- **Absent matches.** When the canonical key names no stored match, there is no Data Editor authority to check, and
  protection against a concurrent creator of the same fixture depends on the existing settle/promotion gate the
  name-keyed creators take (`withLegacyLockTimeout`); this batch added nothing there and no test covers it.
- A `match_results` file numbered in another source's vocabulary (Squiggle/Kali, 0-based from 2024) keys every row one
  round low, finds no match and inserts a second one. Round text cannot reveal this; the census (§17.6, grouped by season,
  date and pairing, not by round) is the detector. Not in this scope; no issue opened (no evidence it has happened).
- ISSUE-306 is unchanged: validation-time duplicate detection (`fileKey`) still compares raw club text, and
  `player_match_stats` is untouched. Because the promotion collision check uses the full canonical key, which carries the
  resolved club names, it also refuses a `match_results` pair that names one fixture through two club aliases **at
  promotion**; the report still shows them as two `ok` rows until ISSUE-306 is implemented.

### 17.9 Operator validation (not run when written; DB-free part since passed, §17.12; integration since passed, §17.14)

```powershell
npx vitest run tests/ingest-datasets.test.ts
npx tsc --noEmit
npx eslint src/lib/ingest/datasets.ts src/lib/ingest/pipeline.ts tests/ingest-datasets.test.ts tests/integration/match-results-promotion.test.ts tests/integration/datasets.test.ts
git diff --check
```

Then from `D:\dev\afldb-issue-271` against `afldb_test` only, with the session variables the operator normally sets for
this file (ISSUE-268 runbook §17.5: `AFLDB_TEST_DATABASE_URL`; `AFLDB_AUTH_DATABASE_URL` targeting the same `_test`
database, or the file's first `beforeAll` refuses before any write; `AFLDB_TEST_IMPORT_DATABASE_URL` for the restricted
import-role path, which the new validation reader also uses), the **whole** two files, because the label mapping touches
every case in the first:

```powershell
npx vitest run tests/integration/match-results-promotion.test.ts tests/integration/datasets.test.ts
```

The worktree needs `node_modules` and must not receive a copied `.env` (repository practice). The integration file refuses,
writing nothing, if season 2073 or another reserved fixture row already exists on `afldb_test`.

### 17.10 Next action

*(Historical. Order revised in the third pass, §17.12: the DEV census now precedes DEV deployment. The integration run has
since passed; the current next action is §17.14.)* Operator review; the
integration run (§17.9, §17.12); commit, `merge:ready`, merge; the read-only DEV census (§17.6) and its review,
including singleton non-canonical rows, with any candidate's disposition decided by the operator (no automatic repair,
rekey, delete or merge); then DEV deployment. PROD census only if chosen. PROD installation rides on the ISSUE-265 hold
(unchanged). No operator decision
is outstanding for this issue (§17.7); ISSUE-268 D-268-3 (a `failed` submission cannot be rejected or re-validated) still
governs what happens to a refused submission.

### 17.11 Whole-submission canonical collision refusal (2026-10-10, second pass; uncommitted, UNVALIDATED)

**Behaviour.** In `match_results` `preparePromotion` (`src/lib/ingest/datasets.ts`), after every retained row has passed
the round-code check (`storedRowRoundCode`) and been given its canonical key, the keys are grouped across the **whole**
submission. If any key is claimed by more than one row, the hook throws before `withLegacyLockTimeout`, so before the
settle/promotion gate, the match lock, the authority read and any write; `promoteSubmission` calls the hook before it
creates the import batch, so no batch is created either. The refusal is unconditional: identical values refuse too,
consistent with the fresh-validation duplicate rule, and no row is chosen as the winner. Message (up to ten groups, then a
count):

```
Nothing was promoted: 1 canonical match key(s) are claimed by more than one row (rows 1, 2 are all
2073|1|2073-04-21|Home FC|Away FC). A match may appear once per file, whatever its round spelling and even with identical
values; the stored verdicts did not catch it. Upload a corrected file as a new submission.
```

Through the pipeline it is `Promotion failed and was rolled back: …`; the savepoint rolls back, the submission is recorded
`failed` with that error, `import_batch_id` stays NULL. The uploaded cells are never rewritten. The round-code refusal
(§17.3) is checked first; the two never combine into one message. The authority reader's per-key cache (`pipeline.ts`
`matchSheetAuthorityReader().readMatchResults`) is local to one `validateSubmission` call and closed with it; promotion
never receives it (its hook context is `{ sql }` only) and reads authority itself with `loadMatchResultsAuthority(…, { lock:
true })` after the `FOR NO KEY UPDATE`, so promotion authority is always current under the lock.

**Tests added or changed (UNRUN when written; the DB-free file since passed, the integration file has not run: §17.12).**
- `tests/ingest-datasets.test.ts`, *match_results promotion lock*: the canonical-lock-key test now uses three distinct
  matches (it previously relied on `R2`/`2` sharing a key, which now refuses); *admits identical protected values … checks
  every row* now spreads its rows over three matches for the same reason (same assertions). New nested block *two older
  prevalidated rows on one canonical match*: `R1`+`1` with different values, `gf`+`GF` with identical values, and `R1`
  twice, each refused whole with the rows and canonical key named and **no query at all** (no gate, lock, read or write;
  hence no batch), the cells unchanged and no `resolved.round_code`; a file with two colliding groups names both, in file
  order; the round-code refusal comes first; the same fixture on another date is admitted.
- `tests/integration/match-results-promotion.test.ts`, *AFLDB-ISSUE-271/272* block, two cases through the real
  `validateSubmission()` → `promoteSubmission()` path: an `R<n>`/`<n>` pair with different scores, and a `gf`/`GF` pair with
  identical values, each against an existing fixture match. Each submission is validated today (asserting today's
  validator already counts the duplicate), then rewritten to the pre-fix stored shape (both rows `ok`, no duplicate reason,
  no `resolved.round_code`). Promotion refuses with the collision naming rows 1 and 2 and the existing match's own key;
  the submission is `failed` with no `import_batch_id` and no surviving `admin-upload` batch; the matches on that day are
  unchanged and the existing row is byte-identical (`m::text`); the retained cells are as uploaded. Fixtures follow the
  file's ownership rules (season 2073, matches claimed only from this run's own batches, submissions recorded).

### 17.12 Review corrections and operator validation (2026-10-10, third pass; uncommitted)

Agent: Read, Grep and Edit only; no command, Git, test, database, network or host operation; no subagent; nothing staged
or committed. No production code changed in this pass. The issue stays **Open**; the PROD hold is unchanged.

**Operator validation, 10 October 2026 (the second-pass tree, before this pass's corrections).**
- `npx vitest run tests/ingest-datasets.test.ts`: **246/246 passed**, start 09:40:51 AEDT.
- `npx tsc --noEmit`: passed.
- ESLint over the five files in §17.9: passed.
- `git diff --check`: passed.

These validate the tree as it was before this pass. This pass changed one integration fixture date, the census SQL and
tracking text only; the DB-free suite was not affected but none of the above was re-run after it. **Outstanding:** the two
integration files (never run) and the census (never run, not syntax-checked). Earlier "no command run / UNRUN" statements
in §0 and §17.1–§17.11 are historical. *(The integration files have since run and passed, §17.14; the census is still
unrun.)*

**Corrections made.**
- **B1, integration fixture collision.** The `gf`/`GF` collision case (*prevalidated before the fix, refuses whole*) used
  April 11, which the ISSUE-268 `R258SA` stale-attendance case also uses for the same two fixture clubs, so `rowsOnDay`
  could see two rows and fail `toHaveLength(1)`. Every April day in the file was checked: 01–18 and 20–24 are taken (24 by
  the ISSUE-264 rekey of `R258Z`); **19** is unused. The case now uses day 19 (`tests/integration/match-results-promotion.test.ts`,
  with a comment naming the constraint). No assertion changed: exactly one existing fixture, the collision message,
  byte-identical preservation, `failed` with no batch, the retained cells and the cleanup are all as before.
- **F1, census attribution.** Three provenance classes replace the single batch signal (§17.6); all-NULL rows are counted
  and listed separately and are never labelled upload-created or confirmed damage. No retained-submission signal (§17.6).
- **F6, census completeness.** Every capped listing is preceded by an unrestricted total (section 2 row total; section 3
  breach total; section 4 pairing and row totals; section 1 `seasons_with_candidates` for 1b). The round check is the
  writers' contract as four separate checks (spelling, type, number, `is_final`); a recognised finals spelling such as `gf`
  is reported as noncanonical, not accepted. Two of the checks are also schema constraints (`matches_round_number_ck`,
  `matches_is_final_ck`), so their counts should be 0. The SQL remains read-only, **unrun and not syntax-checked**.
- **F2/F3, historical identity and deployment.** §17.8: an `R1` stats row still attaches to an existing old `R1` match;
  normalising future uploads repairs no existing non-canonical match and can create a canonical twin; "updates the
  existing match" holds only for the compatible canonical name-keyed identity (admin-created club-ID-keyed matches are
  not reached; ISSUE-182/ISSUE-306 not implemented); absent-match protection depends on the existing gate. §17.6/§17.10:
  DEV census review, including singleton non-canonical rows, precedes DEV deployment; candidates need an operator
  disposition, with no automatic repair, rekey, delete or merge.
- Remaining review findings (F4, F5, race coverage, restricted-role and manual-citation evidence) are recorded in
  ISSUE-271 §17.10.

**Integration environment, derived from the test guards** (no value is reproduced here):
- `AFLDB_TEST_DATABASE_URL`: **required** (`tests/integration/guard.ts` throws without it); its database name must end in
  `_test` (`tests/setup.ts`); it must accept a connection within 5 s (`guard.ts` preflight `connect_timeout: 5`).
  `setup.ts` points `DATABASE_URL` at it. The match-results file connects with it as the owner role.
- `AFLDB_AUTH_DATABASE_URL`: **required** (`src/db/authClient.ts` throws without it; `validateSubmission` writes verdicts
  through it and `datasets.test.ts` reads through it). The match-results file's first `beforeAll` (`assertTestTarget`)
  refuses unless it reaches the **same** database name, server address and port as `AFLDB_TEST_DATABASE_URL` and that name
  ends in `_test`.
- `AFLDB_TEST_IMPORT_DATABASE_URL`: optional. If set, it must name a `_test` database on the same endpoint and database as
  `AFLDB_TEST_DATABASE_URL` (`validateImportRoleParityDsnTargets`, called from `setup.ts` and `guard.ts`). The
  match-results file sets `AFLDB_IMPORT_DATABASE_URL` to it, **or to `AFLDB_TEST_DATABASE_URL` when unset**: without it,
  promotion and the new validation authority reader run as the owner role, so the restricted import-role path is not
  exercised. `datasets.test.ts` does not need it (it stubs the authority reader).
- `.env`: `setup.ts` loads `.env` from the worktree root only to fill unset variables; the worktree must not receive a
  copied `.env` (repository practice), so set the variables in the session.
- Data preconditions (match-results file preflight, read-only, before any write): no `seasons`, `matches` or
  `club_seasons` row for season 2073; no `clubs`/`club_organizations` slug starting `afldb-issue-258-fixture-`; none of
  the reserved fixture player names; `issue-185-promotion-test-fixture@afldb.test`, if present, must be `super_admin`. Also
  needed: at least two existing club identities, `sources.key = 'afltables'` seeded, `sports_data_lab` resolvable or
  seedable, and migration 110 applied (player_match_stats authority). `datasets.test.ts` additionally reads 1989 matches
  (real data) and expects no 1989 round-1 match on 1 January.

### 17.13 Integration window result and corrections (2026-10-10, fourth pass; corrections uncommitted and UNRUN) *(historical: the failed window and its corrections; the corrections were since run and passed, §17.14)*

Agent: Read, Grep and Edit only; no command, Git, test, database, network or host operation; no subagent; nothing staged
or committed. Nothing was re-run and no recovery was performed. Both issues stay **Open**; the DEV census-before-deployment
order (§17.10) and the ISSUE-265 PROD hold are unchanged.

**Earlier State A precondition failure (historical, preserved; operator-confirmed).** Before this run, the direct Vitest run
at 10:10:37 AEDT on 10 October 2026 (operator-provided console evidence) failed its precondition: 39 passed, 22 skipped; the
ISSUE-264 `beforeAll` refused because migration 110 was absent. It was a direct invocation, **not** a runner window, so no
runner evidence directory was supplied or exists for it (hence none under `D:\tmp\issue271`). See §17.14, *Historical runs*,
item 1.

**The authorised window (operator-run, 10 October 2026).** Runner `D:\tmp\issue271\Invoke-Issue271Window.ps1` (sha256
`8e7a3333…5af040` for this run); Preflight `D:\tmp\issue271\preflight-20261010-115354-6484` (PASSED, 11:54:01 AEDT); Apply
evidence **`D:\tmp\issue271\apply-20261010-120323-16676`** (12:03:23–12:08:55 AEDT). Target `afldb_test` through the
55432 tunnel; branch `sonnet/issue-271` at `41cbf730` plus the uncommitted implementation (hashes in `inputs-manifest.json`,
unchanged from the preflight). Migration 110 was applied and State B was verified before any test. The suite environment
was the three restricted connections on `afldb_test`: owner, `afldb_auth`, and `afldb_import` as both
`AFLDB_TEST_IMPORT_DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL` (`summary.txt`).

| Item | Result |
|---|---|
| `tests/integration/match-results-promotion.test.ts` (complete file) | **FAILED**, exit 1: **44 passed, 1 failed**, 0 skipped, 0 todo, **45 total** (45 expected) |
| The six ISSUE-271/272 cases (§17.5, §17.11; ISSUE-271 §17.5) | **all 6 passed** |
| Failed case | ISSUE-264 F-002 *blocks deleteMatch until the promotion finishes*: PostgreSQL 23505 `club_seasons_uq`, key `(season, club_id)=(2073, 59)`, in `recomputeClubSeasons` (`src/db/queries/player-derived.ts:449`) |
| `tests/integration/datasets.test.ts` (complete file) | **PASSED**, exit 0: 16/16 |
| Censuses after each suite, before restoration, and final (`85-final-census`) | **ACCOUNTED**: targeted fixture residue counters all zero; only the permitted append-only `admin-upload` batches (`match_attendance` ×2, `match_results` ×35, `player_match_stats` ×19); no other finding |
| Schema restoration | **RESTORED**: the guarded rollback committed and State A was verified against the capture |
| Isolation (06, 82, 86) and owned processes | 0 other sessions each time; no owned process running at the end |
| Final report | **threw** `Argument types do not match`; `OVERALL: FAIL`, exit 1 (State A verified); `summary.json` `verdicts` empty, `reportError` recorded |

**Verdict.** Full integration validation **FAILED** (60 of the 61 expected tests passed, one failed). The six new cases passing
is evidence for those cases only, not for the files. They ran with `afldb_import` set, so the validation authority reader
and promotion ran as the restricted import role for those cases. The report failure is **separate**: the test, census,
isolation and restoration results above were all recorded before it ran, and none depends on it.

**Cause 1: fixture interaction, not a production defect (confirmed by code reading).** `recomputeClubSeasons` LEFT JOINs a
`gf` subquery with **one row per decided Grand Final** in the season (`round_type = 'grand_final' AND winner_club_id IS NOT
NULL`, `player-derived.ts:513-520`). Two decided Grand Finals won by the same club therefore duplicate that club's ranked row,
and the INSERT hits `club_seasons_uq`. This batch added the first Grand Finals to season 2073. Both are promoted as
`grand_final` (`datasets.ts` maps `GF`), and both are home wins for the fixture home club (`matchPayload` defaults 86–70):
- `R272F` (April 6; re-promoted as 90–70) in *an R-code row and a lower-case final …*;
- `R272G` (April 19, 86–70; the collision submission is refused, so it stays as created) in *a gf/GF pair with identical values …*.

Every pre-batch block uses only `fixtureRound()` home-and-away codes, so season 2073 had no Grand Final before this batch. In
this file only `deleteMatch` reaches `recomputeClubSeasons` (`match-admin.ts:661-662`); the promotion pipeline and the Match
Sheet do not. So the F-002 `deleteMatch` case is the first rebuild of 2073 club seasons that sees both finals. Real data has
at most one decided Grand Final per season; a drawn one has no winner, as in 1948, 1977 and 2010.

**Cause 2: the runner's final report (location bounded by the evidence; mechanism inferred).** `finishedAt` was set and the
`== Final report` header was written, but no suite line followed and `verdicts` stayed empty. The exception was therefore
thrown in the Apply branch before its first `Write-Note`, at `$suites = @($R.suites)` (runner line 1727 before this pass;
that branch had never run before). `R.suites`, `R.censuses` and `R.isolationChecks` are `New-Object List[object]` values
held PSObject-wrapped in the ordered report. Windows PowerShell 5.1's `@()` throws this message on such a list. Every other
list in the runner is converted with `.ToArray()` first (e.g. line 518), and the only three bare `@()` uses on these lists
are in this branch (1727, 1757, 1787). The runner's catch kept only the message, without a line number, so the exact line is
inferred from the evidence rather than recorded. The optional host-only check below confirms the mechanism.

**Counter wording.** `failed-files=4` was Vitest's `numFailedTestSuites`. That counts the file **and** each describe block
enclosing a failed test; the failed case sits three describes deep (ISSUE-258 > ISSUE-264 > F-002), giving 4. Vitest reported
one failed file (`testResults[0].status = "failed"`).

**Corrections made (UNRUN).**
- `tests/integration/match-results-promotion.test.ts`, the *gf/GF pair with identical values* variant: its final is now a
  **drawn** Grand Final (80–80), so `winner_club_id` is NULL and `R272F` stays the season's only decided Grand Final. The pair
  keeps identical values apart from `gf`/`GF` (the first row is `{ ...finals, round_code: 'gf' }`). Unchanged: every
  assertion (one existing match, `duplicates` 1, the collision message and key, `failed` with no batch, byte-identical
  existing row, cells as uploaded), the `R272F` canonical `gf`→`GF` identity case, the F-002 locking case, and fixture
  ownership and cleanup.
- Runner (outside the repository): `@($R.suites.ToArray())`, `@($R.censuses.ToArray())` and
  `@($R.isolationChecks.ToArray())`. The report catch now records `(script line N)` with the message. `numFailedTestSuites`
  is kept as `failedSuites`, and `failedFiles` is now the count of `testResults` whose status is not `passed`. Both are
  printed (`failed-files=… failed-suites=… (file + describe blocks)`). A suite is FAILED if the exit code, `failed`,
  `failedSuites` **or** `failedFiles` is non-zero, which keeps the old check and adds one. No test, census, isolation,
  restoration or exit-code check was removed or relaxed. Helpers are unchanged.

**Not changed (production; a separate decision if wanted).** `recomputeClubSeasons` assumes at most one decided Grand Final
per season. If a season held two won by the same club, a rebuild would fail closed with 23505 (the calling transaction rolls
back). If they had different winners, both clubs would be marked `is_premier`. Whether any writer can create a second
decided Grand Final in one season was not investigated.

**Remaining evidence gaps.** The full integration files have never passed. The corrected fixture and runner are unrun. The
runner mechanism is inferred, not observed. The earlier State A precondition failure is console evidence only (the 10:10:37
direct Vitest run, no runner directory). The census is unrun and
not syntax-checked. Nothing is committed or deployed. The ISSUE-271 §17.10 follow-ups remain open.

**Next action.** Static checks (`npx tsc --noEmit`; `npx eslint tests/integration/match-results-promotion.test.ts`;
`git diff --check`) and a parse check of the runner in Windows PowerShell 5.1. The runner change alters its manifest hash,
so the existing Preflight no longer matches: a **fresh Preflight** is required before any further Apply window, then the
Apply window. Then, as §17.10: commit, `merge:ready`, the DEV census and its review before DEV deployment. PROD rides on
the ISSUE-265 hold. *(Historical: carried out; see §17.14.)*

### 17.14 Successful integration window (2026-10-10, fifth pass; implementation still uncommitted)

Agent: Read, Grep and Edit only; no command, Git, test, database, network or host operation; no subagent; nothing staged or
committed; nothing re-run. The evidence directories were **not** re-read: this section records the operator's report.
Documentation only: no source, test, census SQL, runner or helper changed. Both issues stay **Open**; the DEV
census-before-deployment order (§17.10) and the ISSUE-265 PROD hold are unchanged.

**Evidence (operator-run, 10 October 2026).**

| Item | Value |
|---|---|
| Preflight | `D:\tmp\issue271\preflight-20261010-122730-18800` |
| Apply | `D:\tmp\issue271\apply-20261010-122808-24240` |
| Runner SHA-256 | `35E4085F20C7E273853C5294793A5F9C998D9604BD4EB33FA8BB021C0EE641E6` |
| Branch / HEAD | `sonnet/issue-271` / `41cbf7309ebb32501c731afa314f86dd1ec57746`; the implementation is **uncommitted** |

**Static and DB-free checks.** Before the fresh Preflight the operator reported the runner parse, TypeScript, ESLint on the
corrected integration file and `git diff --check` all passed. The earlier DB-free result stands: `tests/ingest-datasets.test.ts`
**246/246** (§17.12; taken on the second-pass tree and not re-run in this window; the fourth-pass corrections touched an
integration fixture and the runner, §17.13).

**Result.**

| Suite | Result |
|---|---|
| `tests/integration/match-results-promotion.test.ts` (complete file) | **45/45 passed**, started 12:28:20 AEDT, 260.15 s, exit 0 |
| `tests/integration/datasets.test.ts` (complete file) | **16/16 passed**, started 12:32:44 AEDT, 3.46 s, exit 0 |
| Total | **61/61 passed**, 0 failed, 0 skipped, 0 todo; overall window exit 0 |

The previously failing ISSUE-264 F-002 *blocks deleteMatch until the promotion finishes* case passed with the drawn-final
fixture (§17.13). The corrected runner's final report completed successfully. Together with the all-six pass of §17.13 this
is database evidence for the new cases and for both complete files, in this window only.

**Database scope and restoration.**
- `afldb_test` only, through `127.0.0.1:55432`. A read-only target proof verified `afldb_owner`, `afldb_auth` and `afldb_import`
  on the same server **before** the suites; the suites inherited those connections, including
  `AFLDB_TEST_IMPORT_DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL`. The roles were proved and the connection strings supplied;
  `current_user` was **not** asserted inside every application connection.
- Migration 110 was applied temporarily and State B verified before any test. The guarded rollback committed, and State A was
  verified independently against the capture: 109 ledger rows, the original validated 13-literal CHECK and the original
  358-character comment; zero `player_match_stats` authority rows; the original 92 `data_overrides` rows retained.
- All 14 reported fixture-residue counters were zero. New append-only batches accounted for: `match_results` 35,
  `player_match_stats` 19, `match_attendance` 2. The legacy probe labels the `match_attendance` growth
  UNEXPLAINED/DIRTY; the runner explicitly accounts for those two expected ISSUE-268 batches, with zero other findings.
- Final isolation: zero other sessions. No tracked owned process survived. Inputs were unchanged throughout the window.
  The process environment was restored.

**Census coverage limitation (preserved).** The legacy probe fingerprints its listed tables and fixture counters. It does
**not** inspect every database table or every row written under the new batches. The database is therefore **not** described
as wholly unchanged or residue-free; the statement is only that the listed counters and fingerprints matched.

**Working-tree hygiene (operator-reported).** The operator removed seven stray files, each verified empty before removal.
Their origin is **not known**, and it is not established that all of them predated the latest session. No repository file
named in this record depends on them.

**Historical runs (preserved, not overwritten).**
1. *Direct Vitest run, 10:10:37 AEDT (operator-provided console evidence; the earlier State A precondition failure
   referred to in §17.13, operator-confirmed).* 39 passed, 22 skipped; the promotion suite failed its ISSUE-264 `beforeAll`
   because migration 110 was absent. A direct invocation, **not** a runner window: no runner evidence directory was
   supplied. Preserved as a failed attempt; the 61/61 window above is the current result.
2. *Apply `D:\tmp\issue271\apply-20261010-120323-16676` (§17.13).* 44/45 promotion tests and 16/16 datasets tests passed.
   The synthetic decided Grand Final fixture interaction caused the `club_seasons_uq` failure; the final report separately
   failed with `Argument types do not match`; State A restoration succeeded. Its corrections are the fixture and runner
   changes in §17.13, which this window exercised.

**Validation status now.** The recorded static, DB-free and full integration checks have passed for the current
implementation. This is not acceptance, not a merge-readiness result, and not DEV or PROD evidence.

**Remaining evidence gaps and follow-ups (unchanged).**
- No real Data Editor `saveEdit`-versus-promotion concurrency test (ISSUE-271 §17.10).
- No dedicated PostgreSQL case for the `manual_admin_edit` attendance citation.
- Roles proved before the suites, not asserted per connection (above).
- Orphaned overrides (F4), validation-reader timeouts (F5), the name-key versus club-ID-key limitation (§17.8; ISSUE-182 and
  ISSUE-306 not implemented), and the existing ISSUE-268 D-268-3 failed-submission recovery decision are unchanged.
- ISSUE-306 is not implemented.
- The assumption that production data holds at most one decided Grand Final per season (§17.13) is **not** repaired or fully
  investigated by the fixture correction: `recomputeClubSeasons` is unchanged.
- The duplicate census is **unrun and not syntax-checked**. Historical candidates, when found, need review; no damage or
  repair is established.

**Next action.**
1. Operator review of the implementation, then commit (Git is operator-run).
2. Merge readiness on a fresh ref, fast-forward `main`, push `main`.
3. Run and review the read-only DEV duplicate census (§17.6) **before** DEV deployment, including singleton non-canonical
   rows; any candidate's disposition is the operator's, with no automatic repair, rekey, delete or merge.
4. DEV deployment and the applicable acceptance.
5. PROD installation and applicable acceptance remain behind the unchanged ISSUE-265 hold; PROD census only if chosen.
6. DEV acceptance alone does **not** close either issue.
