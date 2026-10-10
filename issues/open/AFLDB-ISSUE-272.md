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
- **Revision (2026-10-10, sixth pass: DEV census recorded; documentation only):** the read-only duplicate census ran
  on **DEV** (`afldb_dev` as `afldb_import`) and finished **COMPLETE** (runner and psql exit 0; evidence
  `D:\tmp\issue272\run-20261010-155649-1780`): 17,056 matches examined, **0 duplicate candidate groups, 0 round-contract
  breaches, 0 home/away disagreements**. This supersedes the "census unrun, not syntax-checked" and "uncommitted" wording
  above: the runner's Git evidence shows `refs/heads/main` at `d37c1422…` (push and `merge:ready` not evidenced there; the
  push is since verified against the live remote, §17.16). It
  establishes the current DEV data state only: not that the upload defect is fixed, not that historical damage never
  occurred, not that PROD is clean. **Closure assessed: NOT closed** (DEV deployment and acceptance, PROD installation and
  acceptance, and the PROD data state are outstanding). See §17.15.
- **Revision (2026-10-10, eighth pass: DEV acceptance proposal revised; documentation only):** operator decisions
  recorded (no `merge:ready` waiver; no PROD census now; no deployment or acceptance yet; validation-only is insufficient).
  The "fast-forward" claim is withdrawn (only the tip agreement is evidenced). A fresh readiness procedure for `d37c1422`
  in a clean isolated worktree, a deployed-build identity requirement, a traced promotion side-effect inventory with
  before/after checks and stop rules, and revised cases are proposed in §17.17. **Nothing run; still Open.**
- **Revision (2026-10-10, ninth pass: readiness rebuilt around a documentation-only descendant; documentation only):**
  operator decisions recorded (no `merge:ready` waiver for either issue; no dirty-main deployment or preflight bypass; the
  tracking documentation is committed first; `-Issue107Gate` preferred with the documented DEV tracing configuration, no
  host setting changed yet; no PROD census; identical-value promotion provisional). §17.17 is revised in place: the
  documentation commit D0–D5, fresh readiness R0–R7 of that exact revision (the eighth-pass R8 with pre-declared
  `merge:ready` FAILs is withdrawn), read-only host prechecks H-1–H-4 that stop before deploying if tracing is not
  configured, gated build identity I-1–I-4, and the `afldb_backup` read path for the auth evidence. **Nothing run; still
  Open.**

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

### 17.6 Census (prepared; UNRUN; NOT syntax-checked) *(historical heading: run on DEV 10 Oct 2026, result in §17.15)*

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

### 17.15 DEV duplicate census recorded; closure assessment (2026-10-10, sixth pass; documentation only)

Agent: Read, Grep and Edit only; no command, Git, SQL, SSH, network or host operation, no `.env` read, no subagent; nothing
staged or committed; the census was **not** re-run. No source, test, census SQL, runner or helper changed. This pass read
`summary.txt`, `result.json`, `credential-scan.txt`, `30-psql-census.stdout.log` / `.stderr.log`, `census.sql`, `guard.sql` and
the `10`–`16` Git logs in the evidence directory and cross-checked the reports against the raw output. SHA-256 values were
**not recomputed** (no command can be run); they are as the runner recorded them, and `summary.txt`, `result.json` and the
operator's identifiers agree.

**Run (operator, 10 October 2026, 15:56:49–15:56:52 +11:00; the 1.9 s is the psql step).**

| Item | Value |
|---|---|
| Evidence | `D:\tmp\issue272\run-20261010-155649-1780` |
| Target | `afldb_dev` as `afldb_import`, through `127.0.0.1:55432`; read-only enforced in the census connection |
| Verdict | **COMPLETE**; runner exit 0; psql exit 0; capture clean; ended `== Done.`; in-session guard passed |
| Commit pinned | `d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f` (`rev-parse` of `refs/heads/main` in `D:/dev/afldb`) |
| Runner SHA-256 | `d513de99aa602376f3e5ea86ee772d4b4747254d9a2eb1f386c8e1b7f743538b` |
| Census SQL | blob `67820d85005b6d0bbd43b64c44fd850dcca39db6`, 30,332 bytes; execution copy SHA-256 `60aafc149f4cdbb4ba3276707ff7b4c60806cbcbb9732222249fcb365b4302dd`; guard SHA-256 `dfaa08a046b907cfefda62d973a958618650d61dd7b64ea0933ef784939c769f`; both copies verified unchanged before and after |
| psql | 16.15; server 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), recorded but **not** identity proof |
| Credential scan | CLEAN (21 files, 2 secret forms); the DSN is reported by shape only (user, database, saved host and port) and no password appears in anything read |

**Operator verification of the target (operator-reported; not in the evidence directory).** The tunnel listener was
`ssh.exe`, PID 13568, with a command line forwarding `127.0.0.1:55432` to `127.0.0.1:5432` through `arm@10.0.40.100`; a
separate SSH hostname check returned `streamanator`, the DEV host. The runner does **not** prove server identity (it says so
in `summary.txt` and `result.json`; it checked TCP reachability, database and role names and server settings only), so the
claim that the answering server was DEV rests on this operator verification, taken at a point in time before the run.

**Result (all unrestricted counts, one `REPEATABLE READ, READ ONLY` snapshot).**

| Measure | Value |
|---|---|
| Matches examined (section 0 and 1c) | **17,056** (both agree) |
| Duplicate candidate groups / candidate rows (sections 1, 2) | **0 / 0** |
| Round-contract breaches (sections 1c, 3, 3b, 3c): spelling, type, number, `is_final`, singleton, with-twin | **0** in every one |
| Home/away disagreement pairings / rows (section 4) | **0 / 0** |
| Whole table (section 1c) | one row: `other_provenance`, `round_contract_ok = t`, `canonical`, **17,056**: every match has a canonical round value and satisfies the round contract |
| Provenance counts | `match_results_upload_batch` 0, `no_provenance_unknown_origin` 0, `other_provenance` 17,056 |
| Capped listings (1b, 2, 3c, 4) | all four **FULL** (0 of 0 shown) |
| Cross-checks | all **11** OK |
| Guard | passed: database `afldb_dev`, session and current user `afldb_import`, not a superuser, default and transaction read-only on, `search_path` and effective schemas `pg_catalog,public`, statement timeout 30 s, lock timeout 5 s, idle-in-transaction 120000 ms, write probe refused |
| Execution copies / stderr / environment | both copies unchanged; all stderr logs empty (0 bytes); 23 watched variables unchanged |
| Repair | none performed; none indicated by this census |

**Cross-check against the raw output (done in this pass).** Every figure in `summary.txt` and `result.json` matches
`30-psql-census.stdout.log`, section by section; the section order, the `GUARD PASSED` line and the final `== Done.` are present.
`census.sql` was read in full: 15 statements and 11 read queries as the runner counted, `BEGIN … READ ONLY` … `ROLLBACK`,
no INSERT, UPDATE, DELETE or DDL. `guard.sql`'s only write is a `CREATE TEMPORARY TABLE` probe inside an exception handler
that must be refused by the read-only session; the guard output shows it was. The Git logs agree with the reports
(`refs/heads/main`, `d37c1422…`, blob `67820d85…`, 30,332 bytes).

**Inconsistencies and gaps found (none changes the verdict).**
1. `summary.txt` opens with the banner "(REVISED, UNRUN DRAFT)" although its mode is Run and its verdict COMPLETE: a stale
   label in the runner, outside the repository.
2. The committed `census.sql` header still says "UNRUN and NOT syntax-checked". It is now run and executed cleanly. The file
   is pinned by blob id (`67820d85…`) and was **not** edited, because editing it would change the recorded identity; correct
   the header only in a later change, if wanted.
3. ~~The credential scan reports 21 files; 20 non-report files are present in the directory (23 in all, including the three
   reports). The one-file difference is unreconciled.~~ **Reconciled, seventh pass (§17.16): not an inconsistency.** The
   runner's `Complete-RunCore` closes the running summary, then lists the run directory with `GetFiles` and scans what is
   there: the 20 non-report files plus `summary.txt`, which exists at that moment; `result.json` and `credential-scan.txt`
   are written afterwards. 21 is correct. The scan result is CLEAN and no secret appears in anything read here.
4. The tunnel PID, command line and hostname check are operator statements, not captured evidence (above).
5. This tracking said the implementation was "uncommitted" and the census "unrun". The Git evidence shows `d37c1422…` on
   `refs/heads/main` in `D:/dev/afldb`. That is **commit** evidence only: this directory does not show a push, a `merge:ready`
   result or a DEV deployment. *(Seventh pass, §17.16: the push is now verified against the live remote; the `merge:ready`
   result is still not evidenced; no DEV deployment is evidenced.)*
6. Provenance carries little signal on DEV: no match has a `match_results` upload batch or all-NULL provenance. As the census
   header says, the absence of the batch signal does not exclude historical upload involvement.

**What this establishes, and what it does not.** It establishes that, at that snapshot, `afldb_dev` held no pair of matches
sharing a season, date and home/away club pairing, no match with a non-canonical round spelling, type, number or `is_final`,
and no pairing with swapped home and away. It does **not** establish that the upload defect is fixed (the census reads stored
rows, not code); that no duplicate was ever created and later removed, rekeyed or overwritten, or lost in a database rebuild
or refresh; that the census's grouping (season, date, home club, away club) catches a duplicate whose club identity, date or
alias differs (ISSUE-306; a source numbered in a 0-based vocabulary); or anything about PROD. No candidate exists, so no
disposition is owed and the §17.6 requirement to review singleton non-canonical rows is satisfied (there are none). Historical
impact on PROD remains unknown.

**Acceptance criteria assessed.** Criteria are those in §4, §14, §15, §17.6, §17.10 and §17.14, and the closure procedure in
`CLAUDE.md` §5. "Met" means demonstrated by the evidence named; nothing is marked met on inference.

| # | Criterion | Supporting evidence | Status | Outstanding work |
|---|---|---|---|---|
| 1 | §4/§13 invariant: the round code is normalised or refused and the normalised code is used for the key, lookup, lock and insert | §17.3 implementation; commit `d37c1422` on `main` | **Implemented, committed** | none for the code itself; see 2 and 3 for proof |
| 2 | §14.1 DB-free: W3 yields `2024|1|…`; `validateRow` cases for `R1`, `gf`, `Round 1` | `tests/ingest-datasets.test.ts` **246/246** (operator, 09:40:51 AEDT, second-pass tree), TypeScript, five-file ESLint, `git diff --check` (§17.12) | **Met** on the tested tree | not recorded as re-run on the committed tree `d37c1422`; ~~confirm through the `merge:ready` result~~ re-run on the exact deployment revision in fresh readiness R5 (§17.17.2; ninth pass) |
| 3 | §14.2 integration: promoting `R1` against an existing `1` match leaves one row | `D:\tmp\issue271\apply-20261010-122808-24240`: **61/61**, `afldb_test` only, State A restored (§17.14) | **Met** for that window | roles proved before the suites, `current_user` not asserted per connection; the database is not claimed wholly unchanged |
| 4 | §15/§17.6/§17.10 DEV duplicate census run and reviewed, including singleton non-canonical rows, before DEV deployment | this run: **COMPLETE**, 0 candidates, 0 breaches, 0 singletons, all listings FULL (§17.15) | **Met** (DEV, one snapshot) | none for DEV. Not evidence of the fix, of history, or of PROD |
| 5 | §15 open question for **PROD** (a PROD census, "only if chosen"; §17.6, §17.10 and §17.14 step 5 say the same) | none | ~~Not met; undecided~~ **Optional, not chosen; not a closure gate** (corrected, seventh pass, §17.16) | none unless the operator chooses one (ISSUE-265 §16.2 pattern); the PROD data state stays unknown and closure must say so |
| 6 | Review, commit, `merge:ready` on a fresh ref, fast-forward and push `main` (§17.14 step 1–2) | runner Git evidence: `refs/heads/main` = `d37c1422…`; seventh pass: local `main` = `origin/main` = live remote `refs/heads/main` = `d37c1422…`, parent `41cbf730` (§17.16) | ~~Commit present; push and `merge:ready` not evidenced~~ ~~**Commit, fast-forward and push VERIFIED; `merge:ready` result NOT EVIDENCED** (corrected, seventh pass)~~ **Local `main`, recorded `origin/main` and the live remote tip all equal `d37c1422` (VERIFIED); how `main` was advanced is not evidenced; the historical pre-merge `merge:ready` result is NOT EVIDENCED and NOT WAIVED** (corrected, eighth pass, §17.17.1) | ~~the operator's recorded `merge:ready` result for this commit, or an explicit waiver (§17.16)~~ the fresh readiness validation of `d37c1422` in a clean isolated worktree (§17.17.2); the missing historical result stays recorded as missing |
| 7 | DEV deployment, after the census | none recorded | **Not done** | `deploy/sync-dev.ps1` and smoke (operator-run) |
| 8 | DEV acceptance of the fixed behaviour (§17.14 step 4) | none run; a concrete procedure is **drafted for review** in §17.16 (ISSUE-270 §20 was the pattern for the deployment record) | ~~Not done; procedure undefined~~ **Not done; procedure drafted, not yet approved** (corrected, seventh pass) | operator reviews and approves §17.16, then DEV deployment and the run. The census is a data-state check and does not stand in for it |
| 9 | PROD installation | none; behind the ISSUE-265 hold | **Not done (blocked)** | after the hold lifts |
| 10 | PROD acceptance (and, if chosen, the PROD data state of criterion 5) | none | **Not done (blocked)** | as 8 and 9; separate from the optional PROD census |
| 11 | Closure procedure (`CLAUDE.md` §5): resolved date, actual root cause, fix and validation recorded; removed from `IssuesIndex.md` and the Open Issues table; runbook moved to `issues/closed/`; `CHANGELOG.md` | not performed | **Not performed** (preconditions 6–10 unmet) | on closure only |
| 12 | Follow-ups that are not gates | ISSUE-306; a 0-based-vocabulary file (§17.8); the name-key versus club-ID-key limit; ISSUE-268 D-268-3; the one-decided-Grand-Final assumption in `recomputeClubSeasons` (§17.13); the ISSUE-271 follow-ups (§17.10 there) | **Recorded, not gates** | tracked separately; ISSUE-271's own open items do not gate this issue |

**Closure verdict: do NOT close ISSUE-272; it stays Open.**
1. The code and its DB-free and integration validation are done (criteria 1–3), and the DEV census is complete and clean
   (criterion 4).
2. The documented acceptance sequence is not complete: DEV deployment and DEV acceptance have not happened (7, 8); a DEV
   acceptance procedure is now drafted for review (§17.16) but not approved or run. The census itself says it does not show
   the defect fixed.
3. PROD installation and acceptance are behind the ISSUE-265 hold (9, 10). The PROD data state is unknown (5), but a PROD
   census is optional and not chosen, so it is not a gate; the §15 question is answered for DEV only and closure must say so.
4. ~~Push and `merge:ready` are not evidenced here (6).~~ The push is verified; the `merge:ready` result is not evidenced
   (6; seventh pass, §17.16).
5. Closure steps could not be completed in this scope (11): the closure edits would be unsupported.

**Smallest next step.** *(Superseded by §17.16.)* The operator confirms criterion 6 (the `merge:ready` result and the push of
`d37c1422…`), then writes down what DEV acceptance means for this issue (criterion 8) so DEV deployment has a pass/fail
test. Nothing is repaired or proposed for repair.

### 17.16 Seventh pass: reconciliation, verified Git and gate state, and a DEV acceptance procedure for review (2026-10-10)

Agent: Read, Grep and Edit only for repository files; no sub-agent, orchestrator, test, merge-readiness, fetch, commit,
merge, push, build, deployment, database, network or DEV/PROD host contact, no `.env` read. Read-only Git commands were
**explicitly authorised for this pass** (`git status`, `rev-parse`, `show`, `cat-file`, `diff --stat`, `branch --contains`,
`ls-files --eol`, `config --get`, and `git ls-remote origin refs/heads/main`, the only command that contacts the remote). The
original evidence directories were not modified. The stale worktree copies in `D:\dev\afldb-issue-271` were not touched. No
source, test, census SQL or runner changed. The issue stays **Open**.

#### 17.16.1 Credential-scan count reconciled (§17.15 item 3 corrected)

`Invoke-Issue272DevCensus.ps1`, `Complete-RunCore` (lines 1763–1830): the running summary is closed, `summary.txt` is
read back, and the run directory is then listed with `[IO.Directory]::GetFiles($script:RunDir)` and scanned
(`Invoke-CredentialScan`, one count per path). At that moment the directory holds the 20 non-report files plus
`summary.txt`; `result.json` and `credential-scan.txt` are written afterwards. So **21 is correct** (20 + `summary.txt`), and
the 23 files now present are those 21 plus the two reports written later (`result.json`, `credential-scan.txt`). The reports
are scanned again after they are written (`Complete-RunCore` step 3), which is the separate result printed on the console.
Confirmed by code reading and by counting the directory; no evidence file was altered. Not an inconsistency.

#### 17.16.2 PROD census requirement read

Every statement of it is conditional: §17.6 "PROD only if the operator chooses"; §17.10 "PROD census only if chosen"; §17.14
step 5 "PROD census only if chosen"; the §17.15 table cited the same. No requirement anywhere makes it mandatory. §15's
"whether any DEV or PROD promotion has already created such a duplicate" is an **open question, not a gate**: it is answered
for DEV (§17.15) and left unanswered for PROD. Classification: **optional, not chosen; not a closure gate** (criterion 5
corrected). Closure must still record that the PROD data state was not assessed. **PROD installation (9) and PROD acceptance
(10) remain separate blockers behind the unchanged ISSUE-265 hold** and are not affected by this reclassification.

#### 17.16.3 Git state, verified (read-only, 10 October 2026)

| Check | Result |
|---|---|
| `git status --short --branch` in `D:\dev\afldb` | `## main...origin/main`; the only modified files are the four documentation files edited in this and the previous pass (`CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-272.md`); nothing staged or untracked. The documentation edits were preserved |
| Local `main` (`rev-parse HEAD main`) | `d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f` |
| Recorded `origin/main` (local tracking ref) | `d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f` |
| **Live remote** (`git ls-remote origin refs/heads/main`; remote `https://github.com/stuv1983/afldb.git`) | **`d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f`** |
| Commit | `fix(ingest): protect match authority and canonicalise round keys (AFLDB-ISSUE-271, AFLDB-ISSUE-272)`, author time 10 Oct 2026 14:36:19 +1100 (after the 12:28–12:33 integration window); parent `41cbf7309ebb32501c731afa314f86dd1ec57746` (the previous `main` tip); ~~so `main` advanced by a fast-forward~~ *(corrected, eighth pass, §17.17.1: the parent is consistent with a fast-forward but does not evidence how `main` was advanced; no merge or push transcript exists)*; the commit's root tree is `345f88da8b95d07818bbbceda8be658771c2b6f6` |
| Contained by | `main`, `origin/main` and `sonnet/issue-271` (the latter is the same commit) |
| Files in the commit (12) | `CHANGELOG.md`, `IssuesIndex.md`, `blockers.md`, `issues.md`, `issues/open/AFLDB-ISSUE-271.md`, `issues/open/AFLDB-ISSUE-272.md`, the census SQL, `src/lib/ingest/datasets.ts`, `src/lib/ingest/pipeline.ts`, `tests/ingest-datasets.test.ts`, `tests/integration/datasets.test.ts`, `tests/integration/match-results-promotion.test.ts`. No migration; no other source or test file. (`blockers.md` is changed by the commit but is not named in this record's tracking.) |

`origin/main` is the local tracking ref, which only a fetch updates; the **live** tip was read by `ls-remote`, so the push is
verified as of this check. Nothing was fetched.

**Tested commit versus committed bytes.** The Apply window `D:\tmp\issue271\apply-20261010-122808-24240` recorded SHA-256
and byte counts for its inputs (`inputs-manifest.json`). For each of the five files the commit changed, the committed blob
(read with `git show`, hashed here) with Windows line endings applied (`core.autocrlf=true`; the index is LF, the worktree
CRLF, as `git ls-files --eol` shows) reproduces the manifest hash **and** byte count exactly:

| File | Committed blob (LF bytes) | CRLF bytes | SHA-256 (CRLF form) = manifest |
|---|---|---|---|
| `src/lib/ingest/datasets.ts` | 89,776 | 91,633 | `92c63cd2…14bb` ✓ |
| `src/lib/ingest/pipeline.ts` | 20,033 | 20,523 | `0a6d760d…960c` ✓ |
| `tests/ingest-datasets.test.ts` | 87,508 | 89,100 | `c0513e93…845f` ✓ |
| `tests/integration/match-results-promotion.test.ts` | 110,072 | 112,145 | `d9ddad18…db0e` ✓ |
| `tests/integration/datasets.test.ts` | 9,724 | 9,942 | `cb8aa201…994b` ✓ |

So the two integration files and the changed source the 61/61 window exercised are, byte for byte, what `d37c1422`
contains. `git diff --stat 41cbf730 d37c1422` over `src`, `tools`, `tests`, `package.json`, `package-lock.json`,
`vitest.config.mts` and `tsconfig.json` shows exactly these five files, so every other manifest input (config, helpers,
migrations 001–110) is unchanged between the base and the commit; those were **not** individually re-hashed (inferred from
the empty diff, not measured). Not covered by this match: the DB-free run (246/246, 09:40:51) recorded no file hashes, so it
is **not** shown to have run on these exact bytes (the later passes touched only an integration fixture, the census and
text, per §17.12–§17.14, but that is the record's statement, not a measurement); and the static checks (TypeScript, ESLint,
`git diff --check`) are operator-reported before the 12:27 Preflight, not hash-bound.

**`merge:ready` gate: NOT EVIDENCED.** Looked for and not found:
- `tools/dev/merge-readiness.ts` is console-only: it writes no file, and its source says it "does not fetch, stage, commit,
  merge, push, migrate or run tests"; so no artefact exists to be found, and no `*readiness*` result file exists under `D:\tmp`
  other than copies of the tool itself;
- neither `issues/open/AFLDB-ISSUE-271.md` nor `AFLDB-ISSUE-272.md` carries an `afldb-merge-readiness` JSON block (so the
  gate would have warned that scope, issue status and test evidence need operator review);
- no tracking text for ISSUE-271/272 records a READY/BLOCKED result (compare ISSUE-270 §20.1, which recorded "READY, 0
  blockers, 2 warnings").

**Exact missing check:** the operator's `npm run merge:ready -- --issue 272` (and `--issue 271`) console output for this
change, taken from the issue worktree before the merge, showing READY or BLOCKED, the blockers and warnings, and the tested
HEAD; or an explicit operator statement that the gate was run and its result, or waived. It cannot be regenerated now: it
checks branch/`main` relationships that no longer hold after the merge, and running it was not authorised. **The commit's
presence on `main` is not treated as a passing gate.** The gate is a pre-merge check, so its absence does not by itself block
a DEV deployment of an already-pushed commit, but the record must say it is unevidenced (or waived) and not imply it passed.
*(Corrected by the eighth and ninth passes, §17.17.2: the operator decided there is **no waiver**, for ISSUE-271 or
ISSUE-272. The historical result is recorded as not evidenced and not waived; the "or waived" alternatives above no longer
apply.)*

#### 17.16.4 DEV acceptance procedure (DRAFT for operator review; not approved, not run)

> **Superseded by §17.17 (eighth pass).** Kept unchanged below as the record of the seventh-pass draft. Known defects
> corrected in §17.17: the F1 selection reads `v.name`, a column `venues` does not have (it has `canonical_name` and
> `legacy_name`), so it would error; the validation-only alternative is described as writing nothing (it writes
> submissions, row verdicts and audit rows); behavioural wording is offered as build proof; the DB-free re-run is optional;
> a `merge:ready` waiver is offered; the side-effect inventory is incomplete. Do not execute this draft.

**Purpose.** Show, on the deployed DEV build, that (a) the running code is `d37c1422`; (b) a `match_results` row spelt `R<n>`
or lower-case `gf` promotes onto the existing canonical match, leaving one row; (c) unsupported or inconsistent round
spellings are refused at validation and cannot be approved; (d) `R<n>` and `<n>` for one fixture in one file are duplicates;
and (e) the DEV data afterwards still has no duplicate or non-canonical match. Everything operator-run (CLAUDE.md §9);
nothing here has been run. Uses the web admin workflow and the existing census; creates no fixture rows.

**What existing automated evidence covers, and what this adds.**

| Case | Existing automated evidence (not acceptance of DEV) | What the DEV run adds |
|---|---|---|
| Reader: `R1`→`1`, `gf`→`GF`, refusals (`Round 1`, `r1`, `01`, `R01`, mismatch, missing number, finals with number, `OR`) | `ingest-datasets.test.ts` 246/246 (stub `sql`) | The same strings produced by the **deployed** build through the real UI, validator and DB (also a build fingerprint: the old code accepted any non-empty round code) |
| `R<n>` row onto an existing canonical match, one row | integration case in `match-results-promotion.test.ts`, 45/45 (`afldb_test`, season 2073 fixture) | The same on the real DEV database, a real match, the real roles |
| `gf` onto an existing canonical Grand Final, one row | same file, `R272F` case | Same, on a real Grand Final |
| `R<n>`/`<n>` duplicate in one file | `ingest-datasets.test.ts` duplicate-detection cases | The report as an operator sees it |
| Pre-fix submissions normalised or refused whole; whole-file collision at promotion | `ingest-datasets.test.ts` and two integration cases | **Not accepted on DEV.** A pre-fix submission cannot be produced on the deployed build without rewriting stored rows (a write outside the app), which this procedure will not do. Remains test-evidenced only |
| ISSUE-271 Data Editor authority | its own cases | **Not covered here**; ISSUE-271 needs its own DEV acceptance if wanted |

**Target, role, revision and how each is verified.**

| What | Required value | How verified |
|---|---|---|
| Host | DEV `streamanator` (`arm@10.0.40.100`, `/home/arm/projects/afldb`, service `afldb`) | operator SSH `hostname`; for database reads the tunnel check used for the census (listener PID and command line, then hostname). Operator-verified, not machine-proved |
| Database | `afldb_dev` | the census runner's section 0 / guard (names, read-only), and the acceptance rows (submissions, batches) being found **in `afldb_dev`** through that tunnel: they prove the app and the census session see one database |
| Deployed revision | `d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f` | on the host after the deploy: `git rev-parse HEAD` equals it; `git status --porcelain` empty; `git diff --quiet d37c1422 -- src/lib/ingest/datasets.ts src/lib/ingest/pipeline.ts` succeeds; the deploy log's `[deploy] after:` line and built `BUILD_ID` captured; `systemctl` shows `afldb` active with a start time after the pull; `/api/health` `status=ok`, `database=ok` |
| Running build | the process serves that build | **Without `-Issue107Gate` the BUILD_ID is not matched to the live `x-afldb-build` header** (ISSUE-270 §20.3 limit). Choice 3 below. Behavioural proof is case C3: the refusal wording exists only in the new code |
| Migrations | none to apply | the commit has no migration; the deploy's migration step should report all 110 applied and nothing new |
| Acting user | one named super admin (upload needs `acquisition.legacyIntake`, validate `requireAdmin`, approve/reject/promote `requireSuperAdmin`) | audit rows `upload.staged`, `submission.validated`, `submission.approved`, `submission.promoted`, `submission.rejected` carry the user id and label; read-only |
| DB roles | staging and validation through `afldb_auth`; promotion and the validation authority read through `afldb_import` (read-only) | **Not asserted per connection** (same limit as §17.14). Indirect: promotion writes an `import_batches` row (`tool='admin-upload'`, `target_table='match_results'`, `notes='submission <id>'`) which only the import-role path creates |

**Fixture ownership and cleanup.**
- **No fixture rows are created** in `matches`, `seasons`, `clubs`, `venues` or aliases. The integration suite's season-2073
  fixtures cannot be reused (its guards refuse any non-`_test` database, and a fake season would appear in public lists).
- The only rows written are: the submissions and their `data_submission_rows`; two import batches; and two `UPDATE`s of two
  **real** DEV matches that carry **identical values** (`ON CONFLICT … DO UPDATE` does not reassign `source_id`,
  `source_record_id` or `import_batch_id`; the dataset code says so). Chosen-match ids, submission ids, batch ids and filenames
  are recorded before and after. Files are named `issue272-dev-accept-<yyyymmdd>-<case>.csv`; the fixtures are owned by the
  operator-designated super admin.
- Cleanup: C3 and C4 submissions end as `rejected` (super admin, from `validated`), so none stays in the review queue; C1 and
  C2 stay `promoted`. Promoted submissions, import batches and audit rows are append-only history and are **left** as the
  accepted residue. **No `matches` cleanup is needed** because nothing new is inserted and the two updates change no value
  (checked by the byte comparison below).
- **Stop rules.** If any "before" check differs from expectation, or a result differs from "Expect", stop; do not retry with a
  changed file, delete a row or edit a match. A duplicate or non-canonical row appearing is a **FAIL of the fix**: record it,
  stop, and treat any repair as a separate operator decision (nothing here repairs). A `failed` submission cannot be rejected or
  re-validated (ISSUE-268 D-268-3); record it and upload a new file if a re-run is wanted.

**Steps (all operator-run; record each output).**

*P. Before deploying (record the results; none is run by this document).*
1. `merge:ready` result for `d37c1422`: supplied, or waived in writing (§17.16.3).
2. Optional but recommended: `npx vitest run tests/ingest-datasets.test.ts` on clean `main` at `d37c1422`, so the 246/246 is
   shown on the committed bytes.
3. Run the committed census (blob `67820d85…`, existing runner `Invoke-Issue272DevCensus.ps1`) for a fresh **baseline**:
   expect COMPLETE, 0 candidates, 0 breaches, and record `matches` (17,056 on 10 October; DEV may have moved since).
4. Choose the fixtures with the read-only selection below (a `BEGIN READ ONLY` session through the census tunnel). **Unrun
   and not syntax-checked.** Record the chosen rows and the `m::text` snapshot of each.

```sql
-- F1: a home-and-away match whose stored values a re-upload can reproduce exactly.
SELECT m.id, m.season, m.round_code, m.round_number, m.match_date, hc.name AS home_club, ac.name AS away_club,
       m.venue_raw, m.home_goals, m.home_behinds, m.home_score, m.away_goals, m.away_behinds, m.away_score,
       m.match_key, m::text AS row_text
  FROM matches m
  JOIN clubs hc ON hc.id = m.home_club_id
  JOIN clubs ac ON ac.id = m.away_club_id
  JOIN venues v ON v.id = m.venue_id
 WHERE m.round_type = 'home_and_away' AND m.round_number BETWEEN 2 AND 20 AND m.round_code = m.round_number::text
   AND m.season >= 2000
   AND m.match_key = m.season || '|' || m.round_code || '|' || m.match_date || '|' || hc.name || '|' || ac.name
   AND v.name = m.venue_raw
   AND m.home_goals IS NOT NULL AND m.home_behinds IS NOT NULL AND m.away_goals IS NOT NULL AND m.away_behinds IS NOT NULL
   AND m.home_score = m.home_goals * 6 + m.home_behinds AND m.away_score = m.away_goals * 6 + m.away_behinds
   AND NOT EXISTS (SELECT 1 FROM matches o WHERE o.id <> m.id AND o.season = m.season AND o.match_date = m.match_date
                     AND o.home_club_id = m.home_club_id AND o.away_club_id = m.away_club_id)
   AND NOT EXISTS (SELECT 1 FROM data_overrides d WHERE d.entity_type = 'matches' AND d.entity_key = m.match_key AND d.is_active)
 ORDER BY m.season DESC, m.id LIMIT 5;
-- F2: the same for a Grand Final (round_type 'grand_final', round_code 'GF', round_number NULL, match_key with '|GF|').
```

*D. Deploy (operator).* `powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1` from clean `main` at `d37c1422`;
then the revision checks in the table above.

*C. Cases, in this order, as the acting super admin on the DEV site (`/admin/upload`, dataset `match_results`, then
`/admin/submissions/<id>`: Run validation → Approve/Reject → Promote). The CSV header is
`season,round_code,round_number,match_date,venue,home_club,away_club,home_goals,home_behinds,home_score,away_goals,away_behinds,away_score`
(no `attendance` column, so the stored figure is kept). Cell values come from F1/F2 exactly as stored; `<n>` is F1's round
number.*

| # | File content | Expect | Evidence |
|---|---|---|---|
| **C3** invalid rounds (validation only, first, so the fingerprint is seen before any write) | 8 rows, all for F1 with the round cells: `Round <n>`/`<n>`; `r<n>`/`<n>`; `0<n>`/`<n>`; `R0<n>`/`<n>`; `R<n>`/`<n+1>`; `R<n>`/empty; `GF`/`1`; `OR`/empty | Validated, **8 errors, 0 ok**. Row reasons: `round_code "Round <n>" is not a recognised round code: use the round number (or R and the number) for a home-and-away round, or EF/QF/SF/PF/GF/WF`; the same form for `r<n>` and `OR`; `round_code "0<n>" does not match round_number <n>`; likewise `R0<n>`; `round_code "R<n>" does not match round_number <n+1>`; `round_code "R<n>" is a home-and-away round and round_number is empty`; `round_code "GF" is a non-home-and-away round code; round_number must be empty`. The two raw `R<n>` rows share a file key, so the second also carries `duplicate of row … (key …)` (expected, not a defect). Approve is refused (`Only a validated submission with no error rows can be approved.`); then **Reject** | review-page capture; `data_submission_rows.verdict/reasons` read-only; submission `rejected`; audit rows |
| **C4** duplicate | 2 rows for F1: `R<n>`/`<n>` then `<n>`/`<n>` | Validated, **1 ok, 1 error, duplicates 1**; row 2: `duplicate of row 1 (key "<season>\|<n>\|<date>\|<home>\|<away>")`; row 1's `resolved.round_code` is `<n>`. Cannot be approved; **Reject** | capture; rows read-only; `rejected` |
| **C1** `R<n>` onto the canonical match | 1 row for F1 with `R<n>`/`<n>` | Validated **1 ok** (0 warnings if the venue resolves); Approve; Promote: `Promoted: 1 rows applied as import batch <id>.` Afterwards: `matches` total **unchanged**; exactly **1** row for F1's season/date/pairing; F1 `m::text` **byte-identical** to the "before" capture (same `match_key`, `round_code` `<n>`, `import_batch_id`); no `matches` row in that season with `round_code = 'R<n>'`; the submission payload still reads `R<n>` (cell kept) and `resolved.round_code` is `<n>` (use `reasons::text` if `->` returns null); one new `admin-upload` `match_results` batch, `notes = 'submission <id>'` | captures; before/after SQL; batch row; audit rows |
| **C2** `gf` onto the canonical Grand Final | 1 row for F2 with `gf` and an empty round_number | Validated 1 ok; Approve; Promote as C1; one Grand Final row for that season/date/pairing, `m::text` byte-identical, `round_code` `GF`, none lower-case | as C1 |

*V. After.*
1. Re-run the committed census (existing runner): expect **COMPLETE**, 0 candidate groups, 0 breaches, 0 disagreements,
   all listings FULL, and `matches` equal to the baseline.
2. Reconcile: total `matches` unchanged; two new `match_results` batches; four new submissions (two `promoted`, two
   `rejected`); the audit trail names the one acting user.

**Pass criteria.** The deployed revision, host and database checks hold; C3 and C4 give the stated refusals and the
submissions end `rejected`; C1 and C2 promote, leave the match count and each match's row text unchanged and no non-canonical
row; the post census equals the baseline. **Any other result is a FAIL or an INCONCLUSIVE, recorded as found.**

**What a PASS shows, and what it does not.** It is DEV acceptance of the deployed `d37c1422` for the canonical-round and
duplicate behaviour in cases C1–C4. It is **not** PROD acceptance (criteria 9–10 stay open), not acceptance of ISSUE-271, not
proof of the pre-fix-submission paths, not proof the running process serves the built `BUILD_ID` unless the Issue-107 gate is
used, not proof of per-connection roles, and not an assessment of history or of PROD data. It also changes two real DEV
matches' rows in no value but does add an import batch and submissions to DEV.

**Choices for the operator before this is approved.**
1. **Fixture strategy.** Proposed: identical-value re-upload on two real DEV matches (above). Alternative: validation-only
   (C3, C4 and an `ok` validation of C1/C2 without approval), which writes no match and no batch but then does **not**
   demonstrate "no duplicate created", so criterion 8 would be only partly met.
2. **`merge:ready`:** supply the earlier result or record a waiver (§17.16.3).
3. **`-Issue107Gate`:** proposed off, as for ISSUE-270, with C3 as the behavioural fingerprint; on needs the DEV host's
   `AFLDB_TRACE_REQUESTS=on`, `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`.
4. **Acting super admin** and the evidence directory (proposed `D:\tmp\issue272\accept-<timestamp>\`).
5. Whether to run the optional DB-free re-run (P2).

#### 17.16.5 Criteria and verdict after this pass

*(Eighth pass: the blockers below are restated in §17.17.8; there is no `merge:ready` waiver, and the procedure is §17.17.)*

Corrections to the §17.15 table are made in place (rows 5, 6, 8, 10). Criterion 4 (DEV census) stays **Met**. Criterion 7 (DEV
deployment) stays **Not done**: nothing in the evidence shows `d37c1422` deployed to DEV. Everything else is as §17.15. **Closure
verdict: ISSUE-272 stays Open.** Blockers, exactly: the unevidenced `merge:ready` result (or a waiver); approval of the
acceptance procedure above; DEV deployment of `d37c1422`; the DEV acceptance run; PROD installation and PROD acceptance behind
the ISSUE-265 hold. The PROD census is optional and not chosen. Nothing was deployed, run or repaired in this pass.

### 17.17 Eighth pass: revised DEV acceptance proposal (2026-10-10; documentation only; supersedes §17.16.4; readiness and build identity revised in place by the ninth pass)

Agent (eighth pass): Read, Grep and Edit only, in the main checkout `D:\dev\afldb` (where the preserved documentation edits
live); no sub-agent or orchestrator; no command, test, Git, SQL, SSH, build, deployment, network or host contact; no `.env`
read. Nothing staged or committed. Sources read for this pass: `CLAUDE.md`, `docs/development/WORKFLOW.md` (lifecycle and
readiness block), `docs/deployment.md`, `deploy/sync-dev.ps1`, `deploy/sync-dev-remote.sh`, `deploy/server-cluster.mjs`,
`tools/dev/merge-readiness.ts`, `tools/dev/preflight.ts`, `tools/dev/preflight-core.ts`, `tools/dev/bootstrap-worktree.ts`,
`tests/setup.ts`, `vitest.config.mts`, `src/lib/ingest/pipeline.ts`, `src/lib/ingest/datasets.ts` (`match_results`, resolvers,
lock helper), `src/app/admin/upload/actions.ts`, `src/app/admin/submissions/[id]/actions.ts`, `src/lib/auth/session.ts`
(`audit`, role guards), `src/lib/auth/capabilities.ts`, `src/middleware.ts`, migrations 001, 002, 003, 023, 033, 085 and a trigger search of all migrations,
`tools/maintenance/privileges.sql`, Next 16.3.1 `node_modules/next/dist/server/app-render/app-render.js`, and ISSUE-270 §20.

Agent (ninth pass, 2026-10-10): Read, Grep and Edit of the four tracking files only, in `D:\dev\afldb`; read-only local Git
authorised and used (`status`, `rev-parse`, `diff --stat`, `diff --check`, `worktree list`; no fetch, no `ls-remote`); no
commit, push, worktree, install, test, host, database or deployment action; no `.env` read; no sub-agent or orchestrator.
Additionally read: `deploy/afldb.service` (`EnvironmentFile`), `.env.example` (service and tracing block),
`docs/deployment.md` (gate section and environment table), `docs/backup-restore.md`, `docs/production-promotion.md`
(preflight target examples), `tools/maintenance/backup.sh`, `tools/db/migration-safety.ts` (migration source scan), and the
five input hashes in `D:\tmp\issue271\apply-20261010-122808-24240\inputs-manifest.json`. **What the ninth pass changed in this
section:** readiness is rebased from `d37c1422` to the documentation-only descendant that will be deployed (§17.17.2); the
direct `git worktree add` is replaced by `worktree:bootstrap`, which a clean `main` permits; the eighth-pass R8 (an
informational `merge:ready` with two pre-declared structural FAILs) is **withdrawn**, and no FAIL is pre-declared as
acceptable anywhere; `preflight --mode merge` and `--mode deploy` are added; the build-identity route is the gate
(§17.17.3), with read-only host prechecks and a stop before deploying if tracing is not configured; the gate-off route is
removed from the plan; the S-B credential is identified (§17.17.5); U-1, U-2 and U-6 are settled or identified (§17.17.8).
Sections 17.17.4 and the case table are unchanged except where they cite those items.

Agent (tenth pass, 2026-10-10): Read, Grep and Edit only, in `D:\dev\afldb`; nothing executed (no command, Git, test,
worktree, credential access, host or database contact, deployment or acceptance step); no sub-agent or orchestrator.
Additionally read: `D:\tmp\issue272\Invoke-Issue272DevCensus.ps1` (header and constants `:1-175`, `Confirm-GitPin` and
`Save-CensusCopy` `:900-946`, guard template `:1020-1091`) and `tools/maintenance/privileges.sql:225-284`, `:362-381`.
**What the tenth pass corrected in this section, and nothing else:** (1) the S-B invocation no longer passes a DSN through
`psql -d`; it runs in a separate child session with the password only in that child's environment and an in-session
refusal before any `auth_*` query (§17.17.5); (2) the post census V no longer uses the original runner, which refuses at
`<DOC_SHA>`; a minimal, reviewed descendant-pinned copy is specified and the original runner and its evidence are preserved
(§17.17.6); (3) environment isolation is moved into a separate child session opened before D0, so it precedes `npm ci`
and every readiness command (§17.17.2); (4) snapshot coverage is reconciled with every "unchanged" claim: partial hashes
and count/max checks are replaced by whole-row fingerprints for the named tables, and what the snapshots do not cover is
stated (§17.17.4, §17.17.5); (5) the superseded gate-off and `afldb_auth` alternatives are removed from U-1, U-2 and
§17.17.3 and kept only as marked history (§17.17.8). No acceptance case was added and no scope changed.

Agent (eleventh pass, 2026-10-10): Read, Grep and Edit only, in `D:\dev\afldb`; nothing executed. One correction (B-1 of
the final read-only review): the S-A1 listings of new `import_batches` and `data_submissions` rows now select
`validation_result` and `error`, and `uploaded_at` and a server-computed `content_sha256_actual`; the coverage table no
longer says "listed in full"; the output-encoding limit of redirected psql text is stated (§17.17.5). No case, step or
scope changed. **Draft frozen (10 October 2026):** §17.17 is the documentation to be committed at D2; any later change is
a new, recorded pass.

**Operator decisions recorded (10 October 2026).** *Eighth pass:* no `merge:ready` waiver; no PROD census at this stage; no
deployment and no DEV acceptance execution yet; validation-only cases are insufficient to show that promotion creates no
duplicate. *Ninth pass:* no `merge:ready` waiver for **either** issue (ISSUE-271's tracking no longer offers one); no
dirty-main deployment and no preflight bypass; the documentation is committed first, so the intended deployment revision is
a documentation-only descendant of `d37c1422`; `-Issue107Gate` is preferred with the documented DEV tracing configuration,
and **no host setting is changed yet**; no PROD census. Identical-value promotion onto existing DEV matches remains
**provisional** (U-5) and is not executed.

#### 17.17.1 Git evidence (corrected)

Verified on 10 October 2026 (§17.16.3, read-only, operator-authorised): local `main`, the recorded `origin/main` tracking ref
and the live remote tip (`git ls-remote origin refs/heads/main`) all equal
`d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f`. That is the whole of the Git evidence. The commit's parent is `41cbf730`, the
previous tip, which is **consistent with** a fast-forward but does not show how `main` was advanced or pushed (no merge or
push transcript exists). The earlier "fast-forward" wording is withdrawn wherever it appeared (§17.15 row 6, §17.16.3,
`IssuesIndex.md`, `issues.md`, `CHANGELOG.md`). Ninth pass, read-only re-check: local `main` and the recorded `origin/main`
in `D:\dev\afldb` are still `d37c1422…`, and the only modifications there are the four tracking files (the live remote was
not re-read). After the documentation commit the expected tip becomes `<DOC_SHA>`; it is re-read before every later step,
never assumed (D0, R0, H-2).

#### 17.17.2 Readiness: missing historical evidence versus fresh validation

**Missing historical evidence (stays missing).** No pre-merge `npm run merge:ready -- --issue 272` (or `--issue 271`)
result exists for `d37c1422` (§17.16.3). It is **not evidenced and not waived**, for both issues, and it cannot be
regenerated: the tool checks the branch-to-`main` relationship that a merge consumes. Nothing below is a substitute for it,
a regeneration of it, or described as a passing `merge:ready`; the fresh results are recorded under their own name.

**Intended deployment revision.** `<DOC_SHA>`: one commit on `main` whose parent is
`d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f` and whose difference from it is exactly the four tracking files
(`CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-272.md`). The deployment pulls the host branch with
`git pull --ff-only` (`sync-dev.ps1:133-141`), so what is deployed is the live remote `main` tip at deploy time; readiness
therefore validates `<DOC_SHA>` itself, and the tip is re-read immediately before the deploy (H-2, H-4).

| Readiness check | Where it is covered |
|---|---|
| Credential-bearing variables absent from the session that runs every D and R step; operator's own session untouched; no `.env` in the readiness worktree | E1–E3 (before D0 and `npm ci`), R2, R3, R7 |
| The documentation commit holds exactly the four tracking files; parent `d37c1422`; `main` clean afterwards | D1, D3 |
| Merge-mode preflight on the clean primary `main` checkout, before the push | D4 |
| Tip agreement: local `main` = recorded `origin/main` = live remote = `<DOC_SHA>` | D5, R0 |
| Application, test, tool, deploy and dependency files unchanged from `d37c1422` | R0 (whole-tree name diff, pathspec-excluded quiet diff, subtree ids) |
| Isolated worktree created from fetched, clean, exact `main` by the supported tool | R1 (`worktree:bootstrap`) |
| Revision under test is exactly `<DOC_SHA>`; worktree clean | R2 |
| Implementation-mode preflight (Git and migration checks for a linked worktree) | R4 |
| DB-free `tests/ingest-datasets.test.ts` | R5 |
| TypeScript, five-file ESLint, `git diff --check` on both commit ranges | R6 |
| Declared scope of `d37c1422` (12 files, no migration) and byte binding to the 61/61 window | R7 |
| Deploy-mode preflight (clean `main`, ahead 0 / behind 0, `afldb_dev` identity and migration parity, read-only) | H-4 |
| `merge:ready` | **Not run.** It is a pre-merge branch gate; neither `d37c1422` nor the documentation commit has a branch ahead of `main` to evaluate. Not substituted and not described as passed |
| Integration suites (`afldb_test`) | Not re-run: they need a database; their bytes are bound to the 61/61 window (§17.16.3) and R0 shows they are unchanged in `<DOC_SHA>` |

**Procedure E: isolated readiness session (operator-run; opened before D0; every D and R step runs inside it).**
*(Tenth pass: moved here from R4, where it followed `npm ci` and the R0–R3 commands and modified the operator's own
session.)* Each step's output is saved to `<EVIDENCE_DIR>\readiness\NN-<step>.log` (for example
`... 2>&1 | Tee-Object -FilePath <file>`).

- **E1. Separate child session.** From the operator's PowerShell, start `powershell -NoProfile -NoLogo`. E2 to R7 are typed
  into that child only. The child receives a **copy** of the parent's environment, so nothing below changes the operator's
  session, the user or machine environment, or any file. `-NoProfile` keeps a profile from re-adding variables.
- **E2. Remove credential-bearing variables from the child.** The pattern is the census runner's child-environment rule
  (`Invoke-Issue272DevCensus.ps1:153`):
  `$rx = '^(PG|PSQL|AFLDB_)|DATABASE_URL'`;
  `$names = @(Get-ChildItem Env: | Where-Object { $_.Name.ToUpperInvariant() -match $rx } | ForEach-Object { $_.Name })`;
  `$names` (the **names** only are recorded; no value is printed);
  `$names | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_) }`;
  `@(Get-ChildItem Env: | Where-Object { $_.Name.ToUpperInvariant() -match $rx }).Count` (expect `0`). **Stop** otherwise.
- **E3. Tools without the profile.** `Get-Command git, node, npm, npx | Format-Table Name, Source -AutoSize`;
  `Set-Location D:\dev\afldb`. A tool that does not resolve stops readiness; the profile is not loaded to fix it.
- **E4. Scope.** D0–D5 and R0–R7 run in this child; it is closed with `exit` after R7 or at any stop. H-1 to H-4, the
  deployment and the S-A/S-B snapshot sessions are **not** run in it (H-4 legitimately needs `D:\dev\afldb\.env`, F-3).
  No `.env` is copied into the readiness worktree at any point: the tools read only the `.env` of their own checkout
  (`preflight.ts:280-284` reads `PROJECT_ROOT\.env`; `tests/setup.ts:24-33` reads the worktree's own and tolerates its
  absence), and `.env` absence there is checked at R2, R3 and R7.

**Procedure D: documentation commit (operator-run, PowerShell, in `D:\dev\afldb`, inside the Procedure E child, after this
document is reviewed).** Output is saved as in Procedure E.

- **D0. Before staging.** `git status --porcelain=v1 --untracked-files=all` (expect exactly ` M CHANGELOG.md`,
  ` M IssuesIndex.md`, ` M issues.md`, ` M issues/open/AFLDB-ISSUE-272.md`); `git diff --check` (expect exit 0, no output);
  `git rev-parse HEAD refs/remotes/origin/main` (expect `d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f` twice);
  `git ls-remote origin refs/heads/main` (expect the same). **Stop** on any other path or SHA.
- **D1. Stage the four files only.** `git add -- CHANGELOG.md IssuesIndex.md issues.md issues/open/AFLDB-ISSUE-272.md`;
  `git diff --cached --name-status` (expect exactly four `M` lines, those files); `git diff --cached --check` (exit 0);
  `git status --porcelain=v1 --untracked-files=all` (expect the four as `M ` only).
- **D2. Commit** with the reviewed message (title `docs(issues): record ISSUE-272 DEV census and ISSUE-271/272 readiness
  plan`): `git commit -F <message file>`. No hook is skipped.
- **D3. Verify the commit.** `git rev-parse HEAD` (record as `<DOC_SHA>`); `git rev-parse "HEAD^"` (expect
  `d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f`); `git diff --name-status d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f HEAD` (expect
  exactly the four `M` lines); `git status --porcelain=v1 --untracked-files=all` (expect empty).
- **D4. Merge-mode preflight:** `npm run preflight -- --mode merge --issue 272`. Required: `Preflight result: READY` with 0
  blockers. Its Git lines are expected to PASS: repository root; `branch main is valid for merge`; `working tree is clean`;
  `merge uses the primary checkout`; `branch contains current local main` (behind 0); relationship to recorded `origin/main`
  ahead 1, behind 0 (ahead is allowed outside deploy mode, `preflight.ts:165-173`); migration names collision-free across the
  relevant refs and worktrees. Every WARN is recorded and read; a WARN other than `.env file presence`, `psql` or
  `pg_restore` availability is assessed before continuing. **Any FAIL stops: no push.**
- **D5. Push** (normal, non-force): `git push origin main`; then `git ls-remote origin refs/heads/main` and
  `git rev-parse refs/remotes/origin/main` (expect `<DOC_SHA>` from both). This publishes documentation only (D3).

This is a direct documentation commit on `main`: no branch and no `merge:ready` result will exist for it either, and none is
claimed (factual input F-1, §17.17.8).

**Procedure R: fresh readiness of `<DOC_SHA>` (operator-run, PowerShell, in order, inside the Procedure E child).**

- **R0. Tip and unchanged application (read-only, `D:\dev\afldb`).**
  `git status --porcelain=v1 --untracked-files=all` (expect empty);
  `git rev-parse refs/heads/main refs/remotes/origin/main` and `git ls-remote origin refs/heads/main` (expect `<DOC_SHA>`
  from all three); `git rev-parse "<DOC_SHA>^"` (expect `d37c1422…`);
  `git diff --name-only d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f <DOC_SHA>` (expect exactly the four tracking files);
  `git diff --quiet d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f <DOC_SHA> -- . ':(exclude)CHANGELOG.md' ':(exclude)IssuesIndex.md' ':(exclude)issues.md' ':(exclude)issues/open/AFLDB-ISSUE-272.md'; $LASTEXITCODE`
  (expect `0`);
  `git rev-parse d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f:src <DOC_SHA>:src d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f:tests <DOC_SHA>:tests d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f:tools <DOC_SHA>:tools d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f:deploy <DOC_SHA>:deploy d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f:package-lock.json <DOC_SHA>:package-lock.json`
  (expect each consecutive pair identical); `git worktree list --porcelain` and `Test-Path D:\dev\afldb-272-readiness`
  (expect no such worktree and `False`). This is the proof that the application and test files are those of `d37c1422`.
  **Stop** on any difference.
- **R1. Create the readiness worktree with the supported tool** (from `D:\dev\afldb`):
  `npm run worktree:bootstrap -- --issue 272 --branch readiness/issue-272-<DOC_SHA8> --path afldb-272-readiness`.
  The tool refuses unless it runs from the clean primary `main` checkout, fetches `origin main` (a remote-tracking ref update
  only), refuses unless local `main` equals the fetched `origin/main`, refuses an existing branch or path, and creates the
  branch and worktree at that exact SHA (`bootstrap-worktree.ts:121-172`). Expect `Worktree bootstrap: CREATED`,
  `Base SHA: <DOC_SHA>`, `Worktree: D:\dev\afldb-272-readiness`. `BLOCKED` stops readiness and is recorded; nothing is
  cleaned up automatically.
- **R2. Revision under test,** in `D:\dev\afldb-272-readiness`: `git rev-parse HEAD "HEAD^{tree}"` (expect `<DOC_SHA>`; record
  the tree); `git branch --show-current` (expect the R1 branch); `git status --porcelain=v1 --untracked-files=all` (expect
  empty); `git config --get core.autocrlf` (expect `true`, as in §17.16.3); `git -C D:\dev\afldb status --porcelain=v1
  --untracked-files=all` (expect still empty); and `Test-Path D:\dev\afldb-272-readiness\.env` (expect `False`).
- **R3. Dependencies:** re-run E2's final count (expect `0`), then `npm ci` in the readiness worktree (`package.json` and
  `package-lock.json` unchanged since `41cbf730`, §17.16.3, and in `<DOC_SHA>`, R0). **No `.env` is copied**;
  `tests/setup.ts` tolerates its absence. Re-check `status` (expect empty) and `Test-Path .env` (expect `False`).
- **R4. Implementation-mode preflight** (isolation is already in force from E2; ~~`Remove-Item Env:…` here~~ *moved to
  E2, tenth pass*): `npm run preflight -- --mode implementation --issue 272`. Required: `Preflight result: READY` with 0 blockers. Its Git lines are expected to PASS: repository root; branch valid for
  implementation; clean tree; linked worktree; contains local `main` (behind 0); ahead 0 / behind 0 against recorded
  `origin/main`; migration names collision-free. `.env file presence` is expected to WARN (absent by design); `psql` and
  `pg_restore` PASS or WARN (not required in this mode). **Any FAIL**, including a migration-name collision reported from
  another worktree (`migration-safety.ts:231-289` scans every registered worktree), **stops readiness** and is recorded, not
  fixed here.
- **R5. DB-free tests:** `npx vitest run tests/ingest-datasets.test.ts`. Required: 246 passed, 0 failed, 0 skipped (the
  §17.12 count). Any failure is a FAIL; a different count with no failure is INCONCLUSIVE; either stops readiness and is
  recorded, not explained away.
- **R6. Static checks:** `npm run typecheck`; `npx eslint src/lib/ingest/datasets.ts src/lib/ingest/pipeline.ts
  tests/ingest-datasets.test.ts tests/integration/datasets.test.ts tests/integration/match-results-promotion.test.ts`;
  `git diff --check 41cbf7309ebb32501c731afa314f86dd1ec57746 d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f`;
  `git diff --check d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f <DOC_SHA>`. Required: exit 0 and no findings from each. Re-check
  `status` (expect empty: `next typegen` writes only ignored output).
- **R7. Scope and byte binding:** `git diff --name-status 41cbf730 d37c1422` (expect exactly the 12 files of §17.16.3, none
  under `src/db/migrations/`); `Get-FileHash -Algorithm SHA256` and `(Get-Item <file>).Length` on the five files in the
  readiness worktree. Required, exactly (the CRLF working-tree form, as the 61/61 window recorded it):

  | File | Bytes | SHA-256 |
  |---|---|---|
  | `src/lib/ingest/datasets.ts` | 91,633 | `92c63cd2cb763c4c20ed106e39383ad934fe524919db458631e9595cae4a14bb` |
  | `src/lib/ingest/pipeline.ts` | 20,523 | `0a6d760d986911895b159bd2ab6e49991afb28c9fc5c9daadd31423417e8960c` |
  | `tests/ingest-datasets.test.ts` | 89,100 | `c0513e931e272039ca507ae1d681887295128b50e38b86e44c16f9b919d0845f` |
  | `tests/integration/match-results-promotion.test.ts` | 112,145 | `d9ddad18d9a3515a376c9a7543d6c6f7d99fbe3d553c6e5101dabbd1605bdb0e` |
  | `tests/integration/datasets.test.ts` | 9,942 | `cb8aa2011c9a50711b467106c6dea84ebe6a737c837383a44edb89b50e7b994b` |

  This binds R5 and R6 to the bytes the 61/61 integration window tested. Finally `Test-Path .env` (expect `False`) and
  E2's final count (expect `0`); then `exit` closes the child (E4).
- **Verdict rule.** Fresh readiness PASSES only if E1–E3, D0–D5 and R0–R7 each meet their requirement. Any FAIL makes readiness
  **FAIL**, recorded as FAIL with its output; an undecidable check is recorded as INCONCLUSIVE; neither is re-labelled, and
  a re-run after any change is recorded as a new attempt beside the first. A PASS is recorded as "fresh post-merge
  readiness of `<DOC_SHA>` (application and test bytes identical to `d37c1422`)", never as "`merge:ready` passed"; the
  historical pre-merge result stays "not evidenced, not waived". The worktree and branch stay until the operator removes
  them (U-7); no automatic cleanup.

#### 17.17.3 DEV deployment and deployed-build identity (`-Issue107Gate`)

Route (U-1, ninth pass): the gate, with the documented DEV configuration `AFLDB_TRACE_REQUESTS=on`, `AFLDB_WORKERS=4`,
`AFLDB_POOL_MAX=10` in the DEV host's `.env` (`docs/deployment.md:121-131`, `.env.example:320-333`, `sync-dev.ps1:20-23`).
The service loads that file at every start (`afldb.service:33`, `EnvironmentFile=`), so the `.env` content at the deploy's
restart, not the current process, decides whether the header exists. All checks below are captured into
`<EVIDENCE_DIR>\deploy\`. The SSH target is the DEV host `arm@10.0.40.100`, the `sync-dev.ps1` default. Remote commands are
written for PowerShell: single-quoted, with `''` for each literal single quote and no double quotes, so nothing is expanded
on the workstation.

**H. Host prechecks (read-only; after readiness PASS, immediately before the deploy).**

- **H-1 Host identity:** `ssh arm@10.0.40.100 hostname` (expect `streamanator`).
- **H-2 Host checkout:** `ssh arm@10.0.40.100 'cd /home/arm/projects/afldb && git rev-parse HEAD && git branch --show-current && git status --porcelain=v1 --untracked-files=normal'`.
  Expect branch `main`; HEAD recorded as `<HOST_BEFORE_SHA>`; no tracked modification and no untracked path outside the known
  operational artefacts that `docs/deployment.md` lists (`sync-dev-remote.sh:4-17`). **Stop** if the branch is not `main`
  (`-RemoteRef` would be a separate decision) or any blocker exists (`-AllowDirtyServer` is not used).
- **H-3 Tracing configuration** (only these three keys are printed; no other `.env` line is read or shown):
  `ssh arm@10.0.40.100 'grep -nE ''^(AFLDB_TRACE_REQUESTS|AFLDB_WORKERS|AFLDB_POOL_MAX)='' /home/arm/projects/afldb/.env'`;
  `ssh arm@10.0.40.100 'systemctl show afldb -p MainPID -p ActiveEnterTimestamp'`; then
  `ssh arm@10.0.40.100 'tr ''\0'' ''\n'' < /proc/<MAIN_PID>/environ | grep -E ''^(AFLDB_TRACE_REQUESTS|AFLDB_WORKERS|AFLDB_POOL_MAX)='''`
  (the current process, for the record). Required for the gate: the `.env` holds exactly one each of
  `AFLDB_TRACE_REQUESTS=on`, `AFLDB_WORKERS=4` and `AFLDB_POOL_MAX=10`. **If `AFLDB_TRACE_REQUESTS=on` is absent** (it was on
  8 October 2026, when the ISSUE-259/260 gate exited 21), **or either other value differs: stop before deploying.** A gated
  run without the header still pulls, installs, migrates, builds and restarts before its readiness loop fails with exit 21
  (`sync-dev.ps1:140-191`, `sync-dev-remote.sh:111-114`, `:244`), which would leave the new build serving with no identity
  proof. Enabling tracing is a DEV host configuration change (one journald trace line per request,
  `server-cluster.mjs:173-180`) that needs its own authorisation and record (U-1b); this pass changes no host setting.
- **H-4 Deploy-mode preflight,** in `D:\dev\afldb` at `<DOC_SHA>`, clean:
  `npm run preflight -- --mode deploy --issue 272 --ssh-host arm@10.0.40.100`. It defaults to `AFLDB_OWNER_DATABASE_URL` and
  `afldb_dev` (`preflight-core.ts:141-145`), requires `.env` and `psql` (`preflight.ts:282-290`), requires `main`, a clean tree
  and ahead 0 / behind 0 against recorded `origin/main` (`preflight.ts:165-173`), opens one connection with
  `default_transaction_read_only = on` (`preflight.ts:196`), and checks database identity and migration parity against the
  110 local migrations. Required: `Preflight result: READY` with 0 blockers. It needs the DEV tunnel the census used, verified
  the same way (listener and hostname). Any FAIL stops; every WARN is recorded and read.

**Deploy (operator-run; only after readiness PASS and H-1 to H-4 met).** From `D:\dev\afldb`:
`powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -Issue107Gate *>&1 | Tee-Object -FilePath <EVIDENCE_DIR>\deploy\sync-dev.log`.
No `-AllowDirtyServer`, no skip switch (the gate refuses them, `sync-dev.ps1:89-91`), no `-RemoteRef`. Required in the
output: `ISSUE-107 gate: on`; `[deploy] host: streamanator`; `[deploy] before: <HOST_BEFORE_SHA short> main`; the remote
working tree with 0 tracked and 0 unknown blockers; `[deploy] after: <DOC_SHA short> main`; the migration step applying
nothing new (no migration in `41cbf730..<DOC_SHA>`); `[deploy] built BUILD_ID: <BUILD_ID>`; a restart line (`restarted
through sudo systemctl` or `systemd respawned the service: <old> -> <new>`); `AFLDB_POOL_MAX=10` and `AFLDB_WORKERS=4` from
the new main process (`sync-dev.ps1:193-195`); `[deploy] health ready …`; `[deploy] live BUILD_ID: <BUILD_ID>`
(`sync-dev-remote.sh:224-231`); exit 0. **Any non-zero exit is a FAIL** of the deployment or its identity gate (21 header
missing, 22 build mismatch, 23–25 restart, 26–27 readiness): record it and stop. A failure at or after the restart step
leaves the newly built revision serving; no rollback or redeploy is automatic, and any such action is a separate operator
decision.

**Identity checks after a successful gated deploy (read-only; all four required before any case).** Behavioural wording
(C3's refusal text exists only in the new code) is supporting evidence only and never substitutes for them.

- **I-1 Revision:** `ssh arm@10.0.40.100 'cd /home/arm/projects/afldb && git rev-parse HEAD && git status --porcelain=v1 --untracked-files=normal && git diff --name-only d37c14229a2d9913eb5672c7c73dcdf2e2ffd90f HEAD'`.
  Expect the full `<DOC_SHA>`; no tracked modification (known artefacts recorded); the four tracking files only. (The deploy
  log prints the short SHA only, `sync-dev.ps1:128`, `:141`.)
- **I-2 Built `BUILD_ID`:** `ssh arm@10.0.40.100 'cat /home/arm/projects/afldb/.next/standalone/.next/BUILD_ID; echo; stat -c ''%y %s'' /home/arm/projects/afldb/.next/standalone/.next/BUILD_ID'`.
  Expect the value printed as `built BUILD_ID` and an mtime within the deploy run.
- **I-3 Serving processes:** `ssh arm@10.0.40.100 'systemctl show afldb -p MainPID -p ActiveEnterTimestamp -p ExecMainStartTimestamp'`;
  `ssh arm@10.0.40.100 'ps -o pid,lstart,args -p <MAIN_PID>; ps -o pid,ppid,lstart,args --ppid <MAIN_PID>'`;
  `ssh arm@10.0.40.100 'tr ''\0'' ''\n'' < /proc/<MAIN_PID>/environ | grep -E ''^(AFLDB_TRACE_REQUESTS|AFLDB_WORKERS|AFLDB_POOL_MAX)='''`.
  Expect the primary and four workers all started after I-2's mtime, and `on`, `4`, `10`. A worker reads the `BUILD_ID` file
  once, when it starts (`server-cluster.mjs:146-153`), so a start after the file was written closes that gap.
- **I-4 Every worker serves that build.** The gate's success line proves one probe, which reached one of four workers.
  `ssh arm@10.0.40.100 'for i in $(seq 1 24); do curl -s -o /dev/null -D - http://127.0.0.1:3100/api/health | grep -iE ''^x-afldb-(worker|pid|build):''; done'`.
  Expect every `x-afldb-build` equal to `<BUILD_ID>` and every `x-afldb-pid` one of the four worker PIDs from I-3, with all
  four seen. If fewer than four distinct PIDs appear, repeat once with 48 probes and record both; still fewer is
  INCONCLUSIVE and stops before any case.

*(Superseded, historical only: the eighth-pass gate-off route, worker start times plus the build ID rendered in the RSC
payload, untried on DEV. It is not an option, fallback or alternative in this plan; tenth pass.)* The gated route above is
the only identity route. If H-3 fails and U-1b is declined, or the gated deploy or I-1 to I-4 fail, the result is **no
deployment / no case** (stop rules 1 and 2), never a switch of route.

#### 17.17.4 Promotion and validation side effects (traced from the code)

Every write each step can perform. "Canonical" means `matches` and the other statistical, authority or derived tables;
submissions, row verdicts, import batches and audit rows are history and bookkeeping, not canonical data.

| Step (role) | Writes | Source |
|---|---|---|
| Upload (`afldb_auth`) | `data_submissions` INSERT (dataset, filename ≤ 200 chars, the file **bytes**, SHA-256, `uploaded_by`, `row_count`; `status` `staged`); one `data_submission_rows` INSERT per CSV row (`payload`, verdict NULL); `auth_audit_log` `upload.staged` {dataset, filename, submissionId, rows}, actor id and email, request IP. A byte-identical file already `staged`/`validated` inserts nothing and audits `upload.duplicate`; a header/parse refusal audits `upload.rejected` only | `pipeline.ts:36-136`, `upload/actions.ts:14-38`, `session.ts:404-416` |
| Validate (`afldb_auth`; authority read through a separate **read-only** `afldb_import` transaction) | `data_submission_rows` UPDATE `verdict`, `reasons` {reasons, resolved}; `data_submissions` UPDATE `status` `validated`, `validation_report`; audit `submission.validated` {ok, warnings, errors, duplicates}. **No canonical write.** | `pipeline.ts:156-291`, `actions.ts:15-31` |
| Approve (`afldb_auth`) | `data_submissions` UPDATE `status` `approved`, `reviewed_by`, `reviewed_at`, only from `validated` with no error or NULL verdict; audit `submission.approved`. A refused approval writes **nothing**, not even an audit row | `actions.ts:47-63` |
| Reject (`afldb_auth`) | `data_submissions` UPDATE `status` `rejected`, `reviewed_by`, `reviewed_at`; audit `submission.rejected` | `actions.ts:64-76` |
| Promote (`afldb_import`, one transaction) | Row lock on the submission; inside a savepoint: in-memory round and collision checks, a transaction-local `lock_timeout`, the settle/promotion advisory lock, `FOR NO KEY UPDATE` on the target matches and reads of `data_overrides` and `sources` (locks only); `import_batches` INSERT (`source_id` = `sports_data_lab`, `tool` `admin-upload`, `target_table` `match_results`, `notes` `submission <id>`) then UPDATE `completed_at`, `status` `completed`, `records_read` = rows, `records_inserted` = rows (`records_updated` stays 0 even when the row is an update: existing bookkeeping, not changed by this issue); per row, `matches` `INSERT … ON CONFLICT (match_key) DO UPDATE`; `data_submissions` UPDATE `status` `promoted`, `promoted_at`, `import_batch_id`, `error` NULL. After commit: audit `submission.promoted` {applied, batchId}; `revalidatePath` of the admin submission page only (no public page is revalidated) | `pipeline.ts:336-490`, `datasets.ts:669-681`, `:840-914`, `:1112-1254`, `actions.ts:85-108` |
| Promote, failure inside the savepoint | Rolled back to the savepoint (no batch row, no `matches` change; identity values already drawn stay consumed); `data_submissions` `status` `failed`, `error`; audit `submission.promote_failed` | `pipeline.ts:459-467`, `actions.ts:93-98` |
| Promote, refused before the savepoint, or the retryable lock refusal | No database write except audit `submission.promote_failed` | `pipeline.ts:353-381`, `datasets.ts:646-654`, `actions.ts:94-98` |

**The `matches` UPDATE on an existing key** sets `round_number`, `round_type`, `is_final`, `venue_id`, `venue_raw`,
`home_score`, `away_score`, `result`, `winner_club_id`, `margin`, and (keeping the stored value when the file is blank)
the four goals/behinds and `attendance`, with `attendance_status`. It never sets `match_key`, `season`, `round_code`,
`match_date`, the club ids, `match_time`, `scheduled_at`, `match_event`, `notes`, `legacy_match_id`,
`attendance_source_id`, `source_id`, `source_record_id` or `import_batch_id`; `is_finals_series` is generated (085). There
is no `updated_at` column (003). Even with every value equal, PostgreSQL writes a new row version, so the row's `xmin`
changes: that is the **expected** trace of the update path, and the positive evidence that the existing row, not a new one,
was written. Two consequences for the fixtures: `venue_id` is set to the **resolved** venue (`resolveVenue`, normalised
name or alias with season bounds, `LIMIT 1` without ordering, `datasets.ts:251-277`), so an unresolved or differently
resolved venue would change or null it; and `winner_club_id` comes from the **resolved** club, so a club resolving to a
different id than the stored one would fail `matches_winner_ck` and leave the submission `failed`. Gate G (§17.17.6)
checks both before approval.

**Not written by any step (traced).** `data_overrides`, `data_edits`, `canonical_applications`, `external_identities`,
`player_match_stats`, `club_seasons` or any other derived table, `sources`, `clubs`, `club_aliases`, `venues`,
`venue_aliases`, `seasons`. Promotion runs no derived rebuild or recomputation. No migration installs a trigger on `matches`
(the only trigger in the migrations is `match_coaches_club_in_match_trg`, 087); S-A0 confirms that on DEV. *(Tenth pass:
this list is a code trace. The snapshots verify it for the 12 tables named in S-A2 only; "any other derived table" is not
snapshot-verified, §17.17.5.)*

**Expected changes for one identical-value promotion (C1 or C2).** One new submission ending `promoted` (with its one row,
verdict `ok`); one new `import_batches` row exactly as above; one `matches` row version replaced with **identical column
values**, its `xmin` changed; four audit rows by the acting super admin (`upload.staged`, `submission.validated`,
`submission.approved`, `submission.promoted` with `applied` 1 and the new `batchId`). Transient locks only.

**Prohibited changes (any one is a FAIL or INCONCLUSIVE, §17.17.6).** A new, deleted or rekeyed `matches` row; any changed
column value on the fixture or on any other match (an unchanged fixture row alone is **not** sufficient: the whole table is
fingerprinted); a change to provenance (`source_id`, `source_record_id`, `import_batch_id`, `attendance_source_id`); any
change to an S-A2 table (the "not written" tables, as far as S-A2 covers them); an import batch other than the two
expected, or a change to any column of an earlier batch, submission or submission row; an acceptance submission, review or audit row attributed to anyone but the acting super admin.

#### 17.17.5 Before/after checks (UNRUN; not syntax-checked)

Two read-only sessions through the census tunnel, each `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` … `ROLLBACK`:
**S-A** as `afldb_import` (it holds SELECT on the canonical tables and on `data_submissions`, `data_submission_rows`,
`data_edits`, `canonical_applications` and `data_overrides`: `privileges.sql:283-288`, `:301`, `:313`, `:324`); **S-B** for
`auth_users` and `auth_audit_log`, which `afldb_import` cannot read. ~~the credential is undecided (U-2)~~ *(Ninth pass,
U-2 identified.)* S-B uses the documented read-only credential **`AFLDB_BACKUP_DATABASE_URL`, role `afldb_backup`**
(`pg_read_all_data`, no write access: `docs/backup-restore.md:19`, `docs/deployment.md:1399`; already used read-only against
`afldb_dev` by `tools/maintenance/backup.sh` and the promotion-target preflight, `docs/production-promotion.md:252-253`).
`afldb_auth` is not used: it is a writer (`SELECT, INSERT` on `auth_audit_log`, `SELECT, INSERT, UPDATE` on `auth_users`,
`privileges.sql:468-470`). Because `pg_read_all_data` can also read secret columns, every S-B query names its columns: never
`SELECT *`, a row-text cast or a row hash on an `auth_*` table, and never `password_hash` or `totp_secret`. ~~The DSN is
passed by variable name only (`psql -X -v ON_ERROR_STOP=1 -f <file> -d $env:<BACKUP_DSN_VAR>`, flags before `-d`), never
printed.~~ *(Withdrawn, tenth pass: PowerShell expands the variable before psql starts, so the whole DSN, password
included, would be a psql command-line argument, visible to any process listing or command-line audit.)* Whether an
`afldb_backup` login reaching `afldb_dev` through the workstation tunnel exists, and is accepted by the server, is
**unverified** (F-5, §17.17.8). This document does not retrieve or read the credential. If none is available, the access
requirement is: a read-only login to `afldb_dev` holding SELECT on `auth_users (id, email, role, disabled_at,
must_change_password)` and `auth_audit_log`, as `afldb_backup` or another operator-provisioned read-only role (whose name
then replaces `afldb_backup` in the guard and `-U`, recorded before use), reachable through the census tunnel.
Snapshots: **B0** before C3, **B1** after C4, **B2** after C1, **B3** after C2. `<B_SUB>`, `<B_BATCH>` and `<B_AUDIT>` are
B0's maxima: in the B0 files they are written as `(SELECT max(id) FROM data_submissions)`, `(SELECT max(id) FROM
import_batches)` and `(SELECT max(id) FROM auth_audit_log)` (same snapshot); from B1 on, as B0's recorded literals.

**Session method (tenth pass; credential-safe; operator-run, PowerShell).** It follows the census runner's model
(`Invoke-Issue272DevCensus.ps1:38-48`: password only in the child's `PGPASSWORD`, never an argument or file; refusal inside
the session before any read). Written for S-B; S-A uses the same method with `afldb_import` in the prompt, `-U` and its
guard, so that both sessions run under the same fixed settings (the S-A fingerprints depend on them, below).

1. **Session files, no credential.** For snapshot `<Bn>` the operator writes `<EVIDENCE_DIR>\snapshots\s-b-<Bn>.sql`: the
   S-B guard, then the S-B queries, then `ROLLBACK;` (placeholders filled; no password, DSN or connection string), and
   records its SHA-256. S-A likewise (`s-a-<Bn>.sql`).
2. **Separate child session.** From the operator's PowerShell: `powershell -NoProfile -NoLogo`. Steps 3 to 5 run in the
   child only; the operator's own environment is never modified. No transcript is running in the child.
3. **Strip, then give the password to the child only.** Procedure E's E2 removal and count (expect `0`), then:
   `$s = Read-Host -AsSecureString -Prompt 'afldb_backup password'`;
   `$p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)`;
   `try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }`;
   `Remove-Variable s, p`.
   The typed value is not echoed and is not saved in command history (only the command text, which holds variable names,
   is). The password then exists only in the child's environment, inherited by psql; it is in no argument, file,
   `.pgpass`, log or evidence file.
4. **Fixed settings, explicit target, names only.**
   `$env:PGOPTIONS = '-c default_transaction_read_only=on -c search_path=pg_catalog,public -c statement_timeout=300s -c lock_timeout=5s -c TimeZone=UTC -c DateStyle=ISO,YMD -c IntervalStyle=postgres -c extra_float_digits=1 -c bytea_output=hex'`;
   `$env:PGCONNECT_TIMEOUT = '15'`;
   `psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U afldb_backup -d afldb_dev -f <EVIDENCE_DIR>\snapshots\s-b-<Bn>.sql 1> <EVIDENCE_DIR>\snapshots\s-b-<Bn>.out 2> <EVIDENCE_DIR>\snapshots\s-b-<Bn>.err; $LASTEXITCODE`.
   Every argument is a name (host, port, role, database, file); none is a credential. `-w` makes a missing or refused
   password fail instead of prompting; `-X` skips `psqlrc`. The tunnel is the census tunnel, verified the same way
   (listener and hostname) before each snapshot.
5. **Clear and close.** `Remove-Item Env:PGPASSWORD, Env:PGOPTIONS, Env:PGCONNECT_TIMEOUT`; `exit`.
6. **Result.** Required: exit `0`, an empty `.err`, and `S-B GUARD PASSED` in `.out` before the first query result. Exit `3`
   with `S-B REFUSED:` in `.err` means the guard stopped the session **before any `auth_*` query**: record it and stop (stop
   rule 3). A statement timeout makes that snapshot INCONCLUSIVE (stop rule 5). The evidence holds only the guard line and
   named-column results.

```sql
-- S-A0 (once, at B0): identity and trigger check. Expect afldb_dev / afldb_import / on, and ZERO trigger rows.
SELECT current_database(), current_user, current_setting('transaction_read_only');
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.matches'::regclass AND NOT tgisinternal;
SELECT id, key FROM sources WHERE key IN ('sports_data_lab', 'manual_admin_edit') ORDER BY key;

-- S-A1 (B0..B3): matches, every column of every row (values, not row versions).
SELECT count(*) AS matches, max(id) AS max_id,
       md5(string_agg(m::text, E'\n' ORDER BY m.id)) AS matches_md5 FROM matches m;
-- Fixture rows, B1..B3 only (the B0 baseline is the fixture selection output, run in the B0 S-A session).
SELECT m.id, m.xmin::text AS xmin, md5(m::text) AS row_md5, m::text AS row_text
  FROM matches m WHERE m.id IN (<F1_ID>, <F2_ID>) ORDER BY m.id;
-- Tables a step is expected to write: rows that existed at B0 are fingerprinted whole (every column,
-- tenth pass; the ninth-pass concat_ws hashes omitted columns); later rows are listed in full.
SELECT count(*) AS batches, max(id) AS max_batch FROM import_batches;
SELECT count(*) AS old_batches, md5(string_agg(md5(b::text), '' ORDER BY b.id)) AS old_batches_md5
  FROM import_batches b WHERE b.id <= <B_BATCH>;
SELECT id, source_id, tool, target_table, status, records_read, records_inserted, records_updated, records_rejected,
       notes, started_at, completed_at, validation_result::text, error FROM import_batches WHERE id > <B_BATCH> ORDER BY id;
SELECT count(*) AS submissions, max(id) AS max_sub FROM data_submissions;
SELECT count(*) AS old_submissions, md5(string_agg(md5(s::text), '' ORDER BY s.id)) AS old_submissions_md5
  FROM data_submissions s WHERE s.id <= <B_SUB>;
SELECT count(*) AS old_submission_rows,
       md5(string_agg(md5(r::text), '' ORDER BY r.submission_id, r.row_no)) AS old_submission_rows_md5
  FROM data_submission_rows r WHERE r.submission_id <= <B_SUB>;
SELECT id, dataset, filename, content_sha256, encode(sha256(content), 'hex') AS content_sha256_actual, uploaded_by,
       uploaded_at, status, row_count, validation_report::text, reviewed_by, reviewed_at, promoted_at, import_batch_id, error
  FROM data_submissions WHERE id > <B_SUB> ORDER BY id;
SELECT submission_id, row_no, payload::text, verdict, reasons::text
  FROM data_submission_rows WHERE submission_id > <B_SUB> ORDER BY submission_id, row_no;

-- S-A2 (B0..B3; tenth pass, replaces the count/max and fixture-only lines): every table §17.17.4 says no step
-- writes, every column of every row, as an order-independent fingerprint. A table this role cannot read, or
-- that does not exist, is reported as such and is then NOT covered (§17.17.5, "What the snapshots establish").
SELECT t.name,
       CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'MISSING'
            WHEN NOT has_table_privilege(to_regclass('public.' || t.name), 'SELECT') THEN 'UNCHECKED: no SELECT'
            ELSE (xpath('/row/f/text()', query_to_xml(format(
                   $q$SELECT count(*)::text || ':' || coalesce(md5(string_agg(h, '' ORDER BY h)), 'empty') AS f
                        FROM (SELECT md5(x::text) AS h FROM public.%I x) s$q$, t.name), false, true, '')))[1]::text
       END AS rows_and_fingerprint
  FROM unnest(ARRAY['canonical_applications', 'club_aliases', 'club_seasons', 'clubs', 'data_edits',
                    'data_overrides', 'external_identities', 'player_match_stats', 'seasons', 'sources',
                    'venue_aliases', 'venues']) AS t(name)
 ORDER BY t.name;

-- S-B guard (first statements of every s-b-<Bn>.sql; tenth pass). Refuses before any auth_* query.
-- S-A uses the same guard with 'afldb_import' for 'afldb_backup' and 'S-A' for 'S-B'.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $g$
DECLARE
  v_refused boolean := false;
BEGIN
  IF current_database() <> 'afldb_dev' THEN
    RAISE EXCEPTION 'S-B REFUSED: database is %, expected afldb_dev', current_database();
  END IF;
  IF session_user <> 'afldb_backup' OR current_user <> 'afldb_backup' THEN
    RAISE EXCEPTION 'S-B REFUSED: session role % / current role %, expected afldb_backup', session_user, current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'S-B REFUSED: % is a superuser', current_user;
  END IF;
  IF current_setting('default_transaction_read_only') <> 'on' OR current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'S-B REFUSED: the session is not read-only';
  END IF;
  IF current_setting('TimeZone') <> 'UTC' OR current_setting('DateStyle') <> 'ISO, YMD'
     OR current_setting('IntervalStyle') <> 'postgres' OR current_setting('extra_float_digits') <> '1'
     OR current_setting('bytea_output') <> 'hex' THEN
    RAISE EXCEPTION 'S-B REFUSED: output settings differ from the fixed PGOPTIONS';
  END IF;
  BEGIN
    EXECUTE 'CREATE TEMPORARY TABLE s_b_write_probe (x integer)';
  EXCEPTION WHEN read_only_sql_transaction THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'S-B REFUSED: the write probe was not refused';
  END IF;
END
$g$;
\echo 'S-B GUARD PASSED'

-- S-B (B0..B3; B0 also verifies the acting account). Never select password_hash or totp_secret.
-- Expect afldb_dev / afldb_backup / on. The file ends with ROLLBACK;
SELECT current_database(), current_user, current_setting('transaction_read_only');
SELECT id, email, role, disabled_at, must_change_password FROM auth_users WHERE id = <ACTING_SUPER_ADMIN_ID>;
SELECT max(id) AS max_audit FROM auth_audit_log;
SELECT id, at, actor_user_id, actor_label, action, detail::text FROM auth_audit_log WHERE id > <B_AUDIT> ORDER BY id;
```

**File composition (tenth pass).** `s-a-B0.sql`: S-A guard, S-A0, S-A1 (without the fixture-rows query), S-A2, the two
fixture selections below, `ROLLBACK;`. `s-a-B1.sql` to `s-a-B3.sql`: S-A guard, S-A1, S-A2, `ROLLBACK;`. `s-b-<Bn>.sql`:
S-B guard, S-B queries, `ROLLBACK;`.

**Fixture selection (S-A, once, inside the B0 S-A session; corrected: `venues` has no `name` column; tenth pass: `xmin` and
`row_text` added so that the output is the fixture baseline B1 is compared with).** F1, home-and-away:

```sql
SELECT m.id, m.season, m.round_code, m.round_number, m.round_type, m.is_final,
       to_char(m.match_date, 'YYYY-MM-DD') AS match_date, m.venue_id, m.venue_raw,
       hc.name AS home_club, ac.name AS away_club, m.home_club_id, m.away_club_id,
       m.home_goals, m.home_behinds, m.home_score, m.away_goals, m.away_behinds, m.away_score,
       m.result, m.winner_club_id, m.margin, m.attendance, m.attendance_status,
       m.source_id, m.source_record_id, m.import_batch_id, m.match_key, md5(m::text) AS row_md5,
       m.xmin::text AS xmin, m::text AS row_text
  FROM matches m
  JOIN clubs hc ON hc.id = m.home_club_id
  JOIN clubs ac ON ac.id = m.away_club_id
 WHERE m.round_type = 'home_and_away' AND m.round_number BETWEEN 2 AND 20
   AND m.round_code = m.round_number::text AND NOT m.is_final
   AND m.season >= 2000
   AND m.match_key = concat_ws('|', m.season, m.round_code, to_char(m.match_date, 'YYYY-MM-DD'), hc.name, ac.name)
   AND m.venue_id IS NOT NULL
   AND m.home_goals IS NOT NULL AND m.home_behinds IS NOT NULL AND m.away_goals IS NOT NULL AND m.away_behinds IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM matches o
                    WHERE o.id <> m.id AND o.season = m.season AND o.match_date = m.match_date
                      AND least(o.home_club_id, o.away_club_id) = least(m.home_club_id, m.away_club_id)
                      AND greatest(o.home_club_id, o.away_club_id) = greatest(m.home_club_id, m.away_club_id))
   AND NOT EXISTS (SELECT 1 FROM data_overrides d WHERE d.entity_type = 'matches' AND d.entity_key = m.match_key)
   AND (m.attendance_source_id IS NULL
        OR m.attendance_source_id <> (SELECT s.id FROM sources s WHERE s.key = 'manual_admin_edit'))
 ORDER BY m.season DESC, m.id
 LIMIT 5;
```

F2 is the same query with the first two `WHERE` lines replaced by `m.round_type = 'grand_final' AND m.round_code = 'GF'
AND m.round_number IS NULL AND m.is_final`. Any override row (active or not) and any manual attendance citation are excluded
so that ISSUE-271 authority plays no part. Whether the venue and clubs re-resolve to the stored ids cannot be shown by
this query (the resolvers use normalised names, aliases and season bounds); Gate G shows it from the validated row before
anything is approved. The operator picks F1 and F2 from the output (U-4) and saves the full rows.

**What the snapshots establish, and what they do not (tenth pass; every "unchanged" claim in §17.17.4 and §17.17.6 is
limited to this).**

| Claim | Snapshot coverage | Gap before the tenth pass |
|---|---|---|
| No `matches` row added, removed, rekeyed or changed in value | S-A1: count, max id, whole-table hash of every column of every row | none |
| Fixture written by the update path, values identical | fixture rows from B1 against the B0 selection output: `row_md5`, `row_text`, `xmin` | B0 had no fixture ids, so B1's "fixture `xmin` unchanged" had no B0 value |
| No change to an earlier batch | every column of every `import_batches` row with `id <= <B_BATCH>` | `source_id`, `tool`, `target_table`, `started_at` and others were outside the hash |
| No change to an earlier submission | every column of every `data_submissions` row with `id <= <B_SUB>`, and of every `data_submission_rows` row of those submissions | `dataset`, `filename`, `content_sha256`, the stored bytes, `uploaded_by`, `row_count` and `validation_report` were outside the hash; earlier submission rows were unchecked |
| No write to the "not written" tables | S-A2: every column of every row of the 12 named tables | `data_edits` and `canonical_applications` were count/max only (an update was invisible); `player_match_stats` covered the two fixtures only; `external_identities`, `sources`, `clubs`, `club_aliases`, `venues`, `venue_aliases` and `seasons` were unchecked |
| New history rows exactly as expected | listed by named columns (S-A1): new batches, every column; new submissions, every column except the stored file `content`, which is not listed and is represented only by the server-computed `content_sha256_actual` beside the stored `content_sha256`; new submission rows, every column; new audit rows (S-B), every column except `ip` | before the eleventh pass the batch listing omitted `validation_result` and `error`, and the submission listing omitted `uploaded_at` and any check of the stored bytes |

**Not established by the snapshots** (stated, not assumed): (1) any table outside S-A1 and S-A2, including the "any other
derived table" of §17.17.4 (for example `players`, `player_clubs`, `player_match_period_stats`, NL and settle tables): that
promotion does not write them rests on the code trace, not on this evidence; (2) a table S-A2 reports as `MISSING` or
`UNCHECKED: no SELECT`, which is named in the record as not covered; (3) `auth_audit_log` rows with `id <= <B_AUDIT>` and
every `auth_users` row except the acting account's (S-B reads named columns only, by design); (4) an identical-value
rewrite of a `matches` row other than the fixtures (the hash compares values; only the fixtures' `xmin` is read); (5) a
change made and reverted between two snapshots; (6) server identity, which rests on the operator's tunnel verification,
as for the census; (7) a faithful copy of non-ASCII text in the `.out` files (eleventh pass): under Windows PowerShell 5.1,
`1>`/`2>` redirection decodes psql's UTF-8 output through the console code page and writes UTF-16LE, so `row_text`, names,
`payload::text`, `detail::text` and other listed text containing non-ASCII characters may be altered in the evidence.
Comparisons between snapshots taken by the same method stay like-for-like, and every MD5 or SHA-256 value is computed by
the server and is ASCII, so the fingerprints are unaffected; the redirected text is not evidence of the stored non-ASCII
bytes. The fingerprints are change detectors for this comparison only; row text depends on the session's
output settings, which `PGOPTIONS` fixes and both guards verify, so a fingerprint taken any other way is not comparable.

#### 17.17.6 Revised acceptance cases (proposal; not approved, not run)

*(Ninth pass: identical-value promotion stays provisional. C1 and C2 run only if U-5 is approved; nothing here is executed
on the strength of this document alone. These cases are not ISSUE-271 acceptance.)*

As `<ACTING_SUPER_ADMIN>` on the DEV site (`/admin/upload`, dataset `match_results`; then `/admin/submissions/<id>`:
Run validation, Approve or Reject, Promote). Files are named `issue272-dev-accept-<yyyymmdd>-<case>.csv` and saved in
`<EVIDENCE_DIR>\files\`. Header
`season,round_code,round_number,match_date,venue,home_club,away_club,home_goals,home_behinds,home_score,away_goals,away_behinds,away_score`
(no `attendance` column, so the stored figure and status are kept). Cells are F1/F2's stored values exactly (`venue` =
`venue_raw`, clubs as selected), CSV-quoted where a value contains a comma or quote; `<n>` is F1's round number. Each
case's page result is captured.

| # | File | Expect (results) | Expect (writes) |
|---|---|---|---|
| — | B0, S-A0, fixture selection, S-B account check | S-A: `afldb_dev`, `afldb_import`, read-only on; S-B: `afldb_dev`, `afldb_backup`, read-only on; 0 triggers on `matches`; the acting account `super_admin`, not disabled, `must_change_password` false, email = `<ACTING_SUPER_ADMIN_EMAIL>` | none (read-only) |
| **C3** invalid rounds | 8 rows for F1, round cells: `Round <n>`/`<n>`; `r<n>`/`<n>`; `0<n>`/`<n>`; `R0<n>`/`<n>`; `R<n>`/`<n+1>`; `R<n>`/empty; `GF`/`1`; `OR`/empty | Validated **0 ok, 0 warnings, 8 errors, duplicates 1**; per-row reasons exactly as in §17.16.4's C3 row (the `readMatchResultsRound` texts, `datasets.ts:580-605`), and the second raw `R<n>` row also carries `duplicate of row … (key …)`. Approve refused with `Only a validated submission with no error rows can be approved.`; then **Reject** | submission + 8 rows (staged → validated → rejected), verdicts and reasons, audit `upload.staged`, `submission.validated`, `submission.rejected`; the refused approval writes nothing. **No canonical write** |
| **C4** in-file duplicate | 2 rows for F1: `R<n>`/`<n>` then `<n>`/`<n>` | Validated **1 ok, 1 error, duplicates 1**; row 2 `duplicate of row 1 (key "<season>\|<n>\|<date>\|<home>\|<away>")`; row 1 `resolved.round_code` = `"<n>"`. (A warning instead of `ok` on row 1 means F1's venue did not resolve: stop rule 4, and F1 is unusable.) Approve refused; **Reject** | as C3 (2 rows). **No canonical write** |
| — | **B1** | `matches` count, max id and whole-table MD5; every S-A2 line; batch count and the old-batch, old-submission and old-submission-row fingerprints **equal B0**; fixture `xmin`, `row_md5` and `row_text` equal the B0 fixture selection output; exactly two new submissions, both `rejected`; six new audit rows by the acting admin *(tenth pass: coverage and limits as §17.17.5)* | — |
| **C1** `R<n>` onto F1 | 1 row: F1 with `R<n>`/`<n>` | Validated **1 ok, 0 warnings, 0 errors**. **Gate G1, before Approve:** from `data_submission_rows`, verdict `ok` with no reasons; `resolved` has `round_code` `"<n>"`, `round_number` n, `round_type` `home_and_away`, and `season`, `home_club_id`, `away_club_id`, `venue_id` (non-null), the four goals/behinds, both scores, `result`, `winner_club_id`, `margin` **equal to F1's stored values**; `attendance` null; `<season>\|<n>\|<date>\|<home_club_name>\|<away_club_name>` from `resolved` equals F1's `match_key`; `payload.venue` equals F1's `venue_raw` and `payload.round_code` is `R<n>`. Then Approve, Promote: `Promoted: 1 rows applied as import batch <id>. Pages refresh as their caches expire.` | the expected changes of §17.17.4 |
| — | **B2** | `matches` count, max id and whole-table MD5 **equal B1**; F1 `row_md5` and `row_text` equal B1 and F1 `xmin` **differs** from B1 (the update path wrote the existing row); F2 untouched; one new batch (`admin-upload`, `match_results`, `submission <C1 id>`, `completed`, read 1, inserted 1, updated 0, rejected 0); C1 `promoted` with that `import_batch_id`, `error` NULL, `uploaded_by` = `reviewed_by` = acting id; four new audit rows by the acting admin; every other fingerprint equal B1 | — |
| **C2** `gf` onto F2 | 1 row: F2 with `gf` and empty `round_number` | As C1, with Gate G2: `resolved.round_code` `"GF"`, `round_type` `grand_final`, `round_number` null, the same value equalities against F2, and the key with `\|GF\|` equal to F2's `match_key` | the expected changes of §17.17.4 |
| — | **B3** | as B2, against B2, for F2 | — |
| **V** after | Re-run the committed census (blob `67820d85…`, bytes unchanged) with the **descendant-pinned copy** of the runner (below; ~~the existing runner~~, which refuses at `<DOC_SHA>`, tenth pass) | **COMPLETE**, 0 candidate groups, 0 breaches, 0 disagreements, all listings FULL, `matches` = B0; pin evidence as required below | none (read-only) |

**Totals at the end:** four new submissions (two `rejected`, two `promoted`), two new import batches, 14 new acceptance
audit rows by the acting super admin (3 + 3 + 4 + 4), `matches` count, max id and whole-table MD5 unchanged from B0, two
fixture `xmin` values changed, every S-A2 table unchanged (a table S-A2 reports as `MISSING` or `UNCHECKED` is named as not
covered; tables outside S-A2 are not claimed, §17.17.5). Any sign-in or session audit rows for the acting account are
recorded separately from the 14; other actors' rows in the window are recorded and assessed (stop rule 5).

**V: census on the documentation-only descendant (tenth pass).** The existing runner cannot be used as it is: it pins
`$PinCommit = 'd37c1422…'` with `$PinHeadRef = 'refs/heads/main'` and `$RepoRoot = 'D:\dev\afldb'`
(`Invoke-Issue272DevCensus.ps1:127-129`) and refuses unless `HEAD` there is that commit (`:909-912`), which stops being
true at D2. It is **not** run against the advanced `main`, and its commit check is **not** removed.

- **Preserved, unchanged:** `D:\tmp\issue272\Invoke-Issue272DevCensus.ps1` (SHA-256 `d513de99…`, §17.15) and its evidence
  `D:\tmp\issue272\run-20261010-155649-1780`. The operator records `Get-FileHash -Algorithm SHA256` of the original before
  writing the copy and again after V (expect `d513de99aa602376f3e5ea86ee772d4b4747254d9a2eb1f386c8e1b7f743538b` both
  times). The §17.15 record stays the record of the `d37c1422` run.
- **Adaptation:** a new file `D:\tmp\issue272\Invoke-Issue272DevCensusDescendant.ps1`, a byte copy of the original with
  only these changes, pure ASCII like the original (`:103`):
  1. `$PinCommit` = the full `<DOC_SHA>`. The existing checks then require `D:\dev\afldb` on `refs/heads/main` at exactly
     `<DOC_SHA>` and extract the SQL from `<DOC_SHA>:issues/open/AFLDB-ISSUE-272-duplicate-match-census.sql`.
  2. New constants: `$BaseCommit = 'd37c14229a2d9913eb5672c7c73dcdf2e2ffd90f'`,
     `$ExpectBlobId = '67820d85005b6d0bbd43b64c44fd850dcca39db6'`, `$ExpectBlobBytes = 30332`,
     `$ExpectCopySha256 = '60aafc149f4cdbb4ba3276707ff7b4c60806cbcbb9732222249fcb365b4302dd'`,
     `$ExpectGuardSha256 = 'dfaa08a046b907cfefda62d973a958618650d61dd7b64ea0933ef784939c769f'`, and `$AllowedDiff` = exactly
     `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-272.md`.
  3. In `Confirm-GitPin`, after the size check (`:926-928`) and before the blob id is recorded, `Stop-Run` unless: the
     blob id equals `$ExpectBlobId` and the size equals `$ExpectBlobBytes`; `rev-parse --verify <BaseCommit>:<SqlRelPath>`
     returns `$ExpectBlobId` (log `18a-git-base-blob`); `rev-list --parents -n 1 <PinCommit>` returns exactly
     `<PinCommit> <BaseCommit>`, one parent (log `18b-git-pin-parents`); `diff --name-only --no-renames <BaseCommit>
     <PinCommit>` returns exactly `$AllowedDiff` (log `18c-git-descendant-diff`). The three results are added to
     `$script:R['pin']` (`baseCommit`, `baseBlobId`, `descendantDiff`). Labels `18a`–`18c` do not collide with the existing
     `10`–`17` and `20` logs.
  4. In `Save-CensusCopy` (`:943`), `Stop-Integrity 'extraction'` unless the copy's SHA-256 equals `$ExpectCopySha256`;
     after the guard file is written (`:1086-1090`), `Stop-Run` unless its SHA-256 equals `$ExpectGuardSha256` (the guard
     is built only from unchanged constants, so its bytes must be those of the §17.15 run).
  5. The `.SYNOPSIS` names the descendant pin. Nothing else changes: DSN source, role, database, target `127.0.0.1:55432`,
     guard, timeouts, static review, parsing, verdicts, redaction, child-environment stripping and credential scan are
     the original's. The stale "(REVISED, UNRUN DRAFT)" banner (§17.15 item 1) is left as it is.
- **Review before use (F-8):** the operator saves `git diff --no-index -- <original> <copy>` (expect only items 1–5) and the
  copy's SHA-256, checks that the copy is ASCII-only and parses in Windows PowerShell 5.1, then runs
  `powershell -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue272\Invoke-Issue272DevCensusDescendant.ps1 -Mode Check`
  (no database contact). Required: `CHECK-PASSED`, pin `<DOC_SHA>`, blob `67820d85…`, 30,332 bytes, copy SHA-256
  `60aafc14…`, the three new Git checks passed. Any other result: V is not run and is recorded as not run.
- **V itself:** the same command with `-Mode Run`, through the census tunnel verified as in §17.15. It writes a new
  `<CENSUS_RUN_DIR>`; the result is recorded as "census blob `67820d85…` (bytes identical to the §17.15 run), run by the
  descendant-pinned runner `<copy SHA-256>` at `<DOC_SHA>`", never as a re-run of the original runner.

**Stop rules.**
1. Fresh readiness not PASS (§17.17.2, Procedure E included), any of H-1 to H-4 unmet (including `AFLDB_TRACE_REQUESTS=on` absent from the DEV
   host's `.env`), or the live remote tip no longer `<DOC_SHA>`: no deployment.
2. The gated deployment exits non-zero, or any of I-1 to I-4 is missing, mismatched or INCONCLUSIVE: no case runs.
3. The S-A or S-B guard refuses, S-A0 shows a trigger on `matches`, the acting account fails the S-B check, or the fixture
   selection returns no usable row:
   stop and re-plan; the selection is not widened ad hoc.
4. Any result different from "Expect": stop at that point and record it; no retry with a changed file, no row deletion, no
   match edit. If Gate G1 or G2 fails, **Reject** that submission (which writes `rejected` and an audit row, as expected)
   and stop; do not approve.
5. After a promotion, a new or changed `matches` row (other than the fixture's `xmin`), changed provenance, or a change in
   any prohibited table: **FAIL** if attributable to the acceptance submission, **INCONCLUSIVE** if concurrent DEV activity
   (another batch, submission, settle or actor in the window) could explain it. Record the before/after rows and stop.
6. **No automatic repair or rollback** of anything, acceptance rows included; unrelated data is never touched. Any repair is
   a separate, explicit operator decision tracked on its own.
7. `upload.duplicate` (a reused file) or a `failed` submission: stop and record (a `failed` submission's recovery is the
   ISSUE-268 D-268-3 question). The retryable lock refusal (`LEGACY_PROMOTION_LOCK_REFUSAL`) writes only an audit row; one
   retry of the **same** submission is allowed after recording it.

**What a PASS shows, and what it does not.** DEV acceptance of the deployed revision for C1–C4: unsupported and
inconsistent round spellings are refused at validation; `R<n>` and `<n>` are one fixture in a file; `R<n>` and `gf`
promote onto the existing canonical matches, creating no row and changing no value in the whole `matches` table or in the
S-A2 tables, with the expected history rows only (within the snapshot limits stated in §17.17.5). It is not PROD acceptance, not ISSUE-271 acceptance, not proof of the pre-fix-submission or
whole-file-collision promotion paths (test-evidenced only, §17.16.4 table), not proof of per-connection roles, and not an
assessment of history or of PROD data. Build identity rests on I-1 to I-4 of the gated route (§17.17.3).

#### 17.17.7 Operator values (placeholders; nothing inferred)

| Placeholder | Meaning | Verified by |
|---|---|---|
| `<ACTING_SUPER_ADMIN>` (`<ACTING_SUPER_ADMIN_ID>`, `<ACTING_SUPER_ADMIN_EMAIL>`) | the one DEV account that uploads, validates, approves, rejects and promotes | S-B at B0: `role` `super_admin` (upload needs `acquisition.legacyIntake`, `capabilities.ts:163`; validation `requireAdmin`; approve, reject and promote `requireSuperAdmin`, `session.ts:295-314`), `disabled_at` NULL, `must_change_password` false; the browser session shows that account; afterwards every acceptance audit row, `uploaded_by` and `reviewed_by` carry that id. No account is assumed |
| `<EVIDENCE_DIR>` | the operator's evidence directory, with `readiness\`, `deploy\`, `files\`, `snapshots\` and `census\` | chosen by the operator |
| `<DOC_SHA>` (`<DOC_SHA8>` = its first eight characters) | the documentation-only descendant of `d37c1422`, the intended deployment revision | D3, then R0 and I-1 |
| `D:\dev\afldb-272-readiness`, `readiness/issue-272-<DOC_SHA8>` | the readiness worktree and its branch (U-7) | R1, R2 |
| `<HOST_BEFORE_SHA>` | the DEV checkout's revision before the deploy | H-2, deploy log `before:` |
| `<BUILD_ID>`, `<MAIN_PID>` | from the deploy log and I-2; from I-3 | the deploy, I-2, I-3 |
| ~~`<BACKUP_DSN_VAR>`~~ | *(withdrawn, tenth pass: no DSN variable is used; the `afldb_backup` password is typed into the S-B child's `Read-Host -AsSecureString` prompt, §17.17.5)* | S-B guard and identity line (F-5) |
| `<CENSUS_RUN_DIR>` | the new run directory the descendant-pinned runner creates for V | V |
| `<F1_ID>`, `<F2_ID>` | the chosen fixtures | fixture selection |
| `<B_SUB>`, `<B_BATCH>`, `<B_AUDIT>` | B0's maxima | B0 |

#### 17.17.8 Decisions, factual inputs, criteria and verdict

Decisions:
- **U-1 Build identity route: SETTLED (ninth pass)** — `-Issue107Gate` with I-1 to I-4 (§17.17.3); there is no other
  route. **U-1b (open, conditional):** only if H-3 shows the DEV host's `.env` lacks `AFLDB_TRACE_REQUESTS=on` (or holds
  other `AFLDB_WORKERS`/`AFLDB_POOL_MAX` values), the operator decides whether to authorise that host configuration change.
  Until then no host setting is changed and nothing is deployed; declining it means no deployment, not another route.
- **U-2 Read path for S-B: IDENTIFIED (ninth pass)** — role `afldb_backup` (`pg_read_all_data`), run by the child-session
  method of §17.17.5 (tenth pass; no DSN on any command line). Its availability is F-5.
- *Superseded alternatives (historical record only; not options, fallbacks or open questions):* U-1, eighth pass: "gate off,
  with I-3a and I-3b captured and matching" (withdrawn ninth pass). U-2, eighth pass: "a read-only `afldb_auth` session
  through the tunnel" (withdrawn ninth pass: `afldb_auth` is a writer, `privileges.sql:468-470`). U-2, ninth pass: "the DSN
  passed by variable name through `psql -d $env:<BACKUP_DSN_VAR>`" (withdrawn tenth pass: the expanded DSN, password
  included, would sit on the psql command line).
- **U-3 (open)** `<ACTING_SUPER_ADMIN>` and `<EVIDENCE_DIR>`.
- **U-4 (open)** The F1 and F2 rows, from the selection output.
- **U-5 (open; provisional)** Approval of identical-value promotion onto F1 and F2 as the acceptance method, conditional on
  readiness PASS, H-1 to H-4, I-1 to I-4, S-A0 and Gates G1/G2. Not executed.
- **U-6 Deployment order: SETTLED (ninth pass)** — option (b): the documentation is committed and pushed first (D0–D5), the
  deploy-mode preflight runs on the clean `main` (H-4), and the documentation-only descendant `<DOC_SHA>` is deployed; I-1
  expects `<DOC_SHA>` and `git diff --name-only d37c1422 <DOC_SHA>` showing the four tracking files only. ~~(a) deploy
  `d37c1422` with `main` left as it is~~ (refused: no dirty-main deployment, no preflight bypass).
- **U-7 (open)** Proposed: worktree `D:\dev\afldb-272-readiness`, branch `readiness/issue-272-<DOC_SHA8>`, both kept until the
  acceptance record is written, then removed by the operator; or other names.

Factual inputs (none inferred; each is checked when its step runs, and a negative result stops that step):
- **F-1** Committing tracking documentation directly on `main` (no branch, no `merge:ready` for that commit) is accepted
  practice for this repository; otherwise the operator names the alternative before D1.
- **F-2** `D:\dev\afldb` has installed dependencies, so `npm run preflight` and `npm run worktree:bootstrap` (both `tsx`) run
  there (D4, R1, H-4).
- **F-3** `D:\dev\afldb\.env` holds `AFLDB_OWNER_DATABASE_URL` reaching `afldb_dev` through the DEV tunnel, and `psql` is on
  `PATH` (H-4; the deploy mode fails without either).
- **F-4** The DEV host's `.env` tracing keys (H-3); last observed absent on 8 October 2026 (ISSUE-259/260).
- **F-5** An `afldb_backup` login to `afldb_dev` through the tunnel (`127.0.0.1:55432`), accepted by the server, whose
  password the operator holds and can type into the S-B child session (§17.17.5). This document does not retrieve, read or
  locate that credential. If none, the access requirement in §17.17.5 applies.
- **F-8** The descendant-pinned census runner (§17.17.6, V) has been written, its difference from the original reviewed,
  and its `-Mode Check` returned `CHECK-PASSED`, before V runs. Otherwise V is not run and is recorded as not run.
- **F-6** `D:\dev\afldb-272-readiness` does not exist and the branch name is unused (R0; checked read-only on 10 October 2026:
  the path does not exist).
- **F-7** The DEV host checkout is on `main` with no blocker (H-2).

Criteria (§17.15 table): row 6 corrected in place (tip agreement verified; how `main` advanced not evidenced; historical
`merge:ready` not evidenced and not waived; fresh readiness of the documentation-only descendant planned). Rows 7 and 8
unchanged: **Not done**; criterion 8's procedure is §17.17, not yet approved. Rows 9 and 10 stay blocked behind the ISSUE-265
hold. No PROD census at this stage. **Closure verdict: ISSUE-272 stays Open** (ISSUE-271 likewise; its own DEV acceptance
procedure is not yet written). Next: §17.17 is frozen (eleventh pass); E1–E3, then D0–D5 (the documentation commit) and R0–R7 in the isolated child; H-1 to
H-4 (stop for U-1b if tracing is absent); the gated deployment with I-1 to I-4; then, only if U-5 is approved, the cases,
with V only after the descendant-pinned runner has passed review and `-Mode Check` (F-8). Nothing was run, created,
deployed or repaired in the eighth, ninth, tenth or eleventh pass.
