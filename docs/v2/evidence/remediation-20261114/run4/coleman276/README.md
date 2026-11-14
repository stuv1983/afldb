# ISSUE-363 run 4, scope `coleman276`: record

Worker `afldb-worker` (Sonnet 5.5), 2026-11-15, DEV host workspace `/mnt/ssd/afldb-rem4-coleman276-20261115`, port 55684 only.
Branch `claude/rem4-coleman276-20261115`, base B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`. Code commit
`fef79cbcbf9958f6dc85900da7526fb086416ae7` (two test files; nothing else under `src/`, `tools/`, `data/`). This record is a
second, docs-only commit on top; the host checkout was fast-forwarded to it at the end.

Bases (fresh `--template` copies of two templates, every experiment on its own copy, dropped afterwards):

- `rb` = accepted rebuild dump (sha256 `d8397aab...65c63`, ledger 118).
- `sn` = production-derived 4 Nov snapshot (ledger 118). Aggregates only here; nothing copied off host.

"per-file" = `AFLDB_TEST_PER_FILE_DB=all` (each file its own database copy). "shared" = variable unset, one database, one
`vitest run <file>` invocation per file in sequence. Raw vitest output is `evidence/<label>/vitest*.log`; the scripts that
produced it are `evidence/host-scripts/`.

## 1. Finding validation

### 1a. `awards-reload-links.test.ts`: two describe-level errors (VALIDATED, class: test/fixture assumption wrong)

Red at B4, both bases, per-file (`evidence/b4awrb`, `b4awsn`) and shared (`evidence/b4awsh_rb`, `b4awsh_sn`): `Tests 97 passed |
10 skipped`, one file failed, two describe-level errors, identical on all four runs:

- `Coleman legacy to derived ownership transition (AFLDB-ISSUE-111)`: "afldb_test holds 47 Coleman winner row(s); the
  tracked contract declares exactly 46 and the transition's preflight refuses any other count. ..."
- `Coleman derived reload preserves human link decisions (AFLDB-ISSUE-111)`: "afldb_test holds 47 Coleman winner row(s); the
  tracked contract declares exactly 46. The reload signal asserted below is that count ..."

Provenance (read-only SQL on fresh copies of both bases; `evidence/prov/prov-rb.txt`, `prov-sn.txt`, queries
`host-scripts/prov.sql`). Everything below is measured, not inferred:

| fact | rebuild `rb` | snapshot `sn` |
|---|---|---|
| seasons 2025 / 2026 status | complete / complete | complete / complete |
| `awards.coleman` first/last season | 1980 / 2026 | 1980 / 2025 |
| Coleman family stored before any loader run | 47 rows, 1980-2026, all `afltables`, derived key form | 46 rows, 1980-2025, all `afltables`, derived key form |
| of which season <= 2025 / > 2025 | 46 / 1 | 46 / 0 |
| independent oracle (contract `derivation_method`) | 47 (46 <= 2025, 1 in 2026) | 47 (46 <= 2025, 1 in 2026) |
| oracle vs stored, season:player_id symmetric difference | 0 / 0 | 1 in oracle not stored / 0 |
| 2026 winner (public fact) | Charlie Curnow, 69 goals | same |
| null-goal home-and-away rows from 1980 | 0 | 0 |

Mechanism: the contract (`data/reference/coleman-derivation.json`, `expected_rows` 46) is the measured 1980-2025 LEGACY size and
is also the guard of `import_awards.py --rekey-coleman`. The derivation (`completed_seasons_only`) yields a winner for every
`seasons.status = 'complete'` season; 2026 became complete after the contract was written, so the derived family is 47. The
rebuild stage `coleman` materialises the 2026 row (rebuild holds 47). The snapshot holds the 46 legacy rows and the file's
first describe (its derived load) inserts the 2026 winner, so the family is 47 there too by the time the transition block
runs. `--rekey-coleman` is not run by the rebuild. Therefore the old precondition (family size == `expected_rows`) was a wrong
assumption about the TEST'S BASE, never a defect in the loader or the contract: both are correct and frozen.

### 1b. `settle-afl-api-issue276.test.ts`: finals coverage lost in run 3 (VALIDATED)

Run 3 (532e234d) moved the four fixture cases from `PF` to home-and-away round `6` because the fixture's Hawthorn-home v
Brisbane Lions Preliminary Final collides with the REAL 2026 PF (matches.id 17055 on `rb`, 17266 on `sn`; the only
Hawthorn(home) v Brisbane Lions match of 2026, `evidence/prov/prov2-*.txt`): `sameFixtureIdentity` is same season + oriented
clubs with at most one of round code / match date differing. The move removed every `preliminary_final` / `is_final` /
`finals_played` assertion from the suite. That coverage loss is proven below (section 4): a finals-only defect passes the
home-and-away-only suite.

## 2. What changed (test files only)

### `tests/integration/awards-reload-links.test.ts`

- The expected family is an INDEPENDENT raw-SQL oracle of the contract's `derivation_method` (`independentColemanFamily()`:
  `player_match_stats` x `matches` x `seasons`, `round_type = 'home_and_away'`, `seasons.status = 'complete'`, `season >=
  first_season`, `goals >= minimum_goals`, no higher total in the season). It neither calls nor copies the loader SQL, so a
  loader that drifts from the contract is caught, not echoed.
- Preconditions: family key set equals the oracle (not a hard-coded count); the legacy scope (season <= `LEGACY_LAST_SEASON`
  2025, a literal checked against `first_season`/`expected_rows`) is exactly `expected_rows` (46), one row per season.
- The legacy state is manufactured for the legacy scope only. Later-season winners are captured, set aside (`removeLaterRows`)
  and restored by original id (`restoreLaterRows`, `OVERRIDING SYSTEM VALUE`, `award_winners.id` is `GENERATED ALWAYS`).
- New permanent regression: "refuses an all-legacy family that also carries a later-season row: the legacy scope is bounded"
  (rekey must refuse "expected exactly 46 legacy row(s) in scope, found 47" and write nothing) and "is manufactured for the
  legacy scope only ...". The first-load test is renamed "reports 46 updated / 0 inserted / 0 deleted for the legacy scope on
  the first derived load" and now asserts the in-scope ids unchanged and `inserted` equal to the oracle's later-season count.
- Decision-survival describe: counts come from the oracle length, never from a pin. Comment in `independentColemanFamily`
  corrected to the measured facts above.
- The frozen contract and its test are untouched: `git diff 7cfbe186 -- data/reference/coleman-derivation.json
  tests/coleman-derivation.test.ts` is empty (0 bytes, `evidence/final-tests.out`).

### `tests/integration/settle-afl-api-issue276.test.ts`

- The four original cases stay on the real 2026 season at home-and-away round 6 (they exercise real-season shared-state capture
  and restore, so they are not redundant).
- The SAME four case bodies (`registerCases(ids)`) now also run on a Preliminary Final (`round_code PF`, `round_type
  preliminary_final`, `is_final`) in the SUITE-OWNED season 2069. A real 2026 match can never collide with it.
- 2069 safety: proved empty at module start and again in the finals describe (no `seasons` row, and no row in any table that
  references `seasons(year)`, found by a catalogue FK scan, 34 referencing columns); created by the suite; the writer's
  `club_seasons` leftovers are the only derived rows allowed; removal deletes by exact season in one transaction and the final
  footprint must be empty. The synthetic season provider id is `CD_I4040S2069`; match ids stay in the file's existing
  `CD_M2026ISSUE276` namespace because the file's ownership proofs key on it.
- The round vocabulary and identity map for 2069 are in-memory copies of the real 2026 ones (never written anywhere).
- New assertions: the stored fresh match's season / round_code / round_number / round_type / is_final / is_finals_series against
  literals, and `club_seasons.finals_played` = 1 for both clubs on the finals set.
- Season 2069 is the only season committed by this scope (2070 unused). Collision proof: `prov/prov2-*.txt` shows no row citing
  2069 or 2070 in any table referencing `seasons` and no `CD_I4040` / `CD_M2026ISSUE276` rows on either base; the repository
  grep for `2069`, `2070`, `CD_I4040` finds only this file plus unrelated data files.

## 3. Results at the code commit `fef79cbc` (final matrix: `evidence/fin_*`, `final-tests.out`)

| run | base | mode | result |
|---|---|---|---|
| `awards-reload-links` | rb | per-file | 109 passed (`fin_aw_rb`) |
| `awards-reload-links` | sn | per-file | 109 passed (`fin_aw_sn`) |
| `settle-afl-api-issue276` | rb | per-file | 8 passed (`fin_i276_rb`) |
| `settle-afl-api-issue276` | sn | per-file | 8 passed (`fin_i276_sn`) |
| issue276 then awards | rb | shared | 8 passed, 109 passed (`fin_sh_rb`) |
| awards then issue276 | sn | shared | 109 passed, 8 passed (`fin_sh_sn`) |
| issue276 alone | rb / sn | shared | 8 passed each; per-table row counts identical to the template, 0 diff lines (`fin_leak_rb`, `fin_leak_sn`) |
| `v2-coleman-publication`, schema-only base | fresh, 118 migrations + privileges | per-file and shared | 28 passed each (`fin_cole_all`, `fin_cole_sh`), expected 28/28; unaffected |

B4 for comparison: awards 97 passed | 10 skipped, 2 describe-level errors on all four rb/sn x per-file/shared runs; issue276 8
passed (H&A only). Typecheck and lint gate: section 5.

Shared-mode residue (not caused by this change, recorded for the orchestrator): `awards-reload-links` is already a COMMITTING
suite. After it, a shared database differs from the template by `import_batches` (rb 26 -> 148, sn 75 -> 197; B4 was 26 -> 144
and 75 -> 193, the new refusal case adds 4 ledger rows) and, on `sn` only, `award_winners` 3712 -> 3713 (the 2026 winner the
first derived load inserts, also the B4 behaviour). `settle-afl-api-issue276` alone leaves no row behind on either base.

## 4. Mutation proofs (each applied to a byte-copy-restored file, run per-file on a fresh copy; `evidence/m_*`)

`mut.sh` restores from a byte copy taken before the mutation, never `git checkout` (its first version used a checkout and
silently reverted the uncommitted test edits to B4 for part of one aborted batch; the aborted batch's later runs were discarded
and re-run, see section 6).

| mutation | suite | base | result |
|---|---|---|---|
| later-season winners left in the legacy scope (`removeLaterRows()` disabled) | new awards | rb, sn | RED: "no later-season winner takes part in the legacy transition: expected [2026 row] to deeply equal []" plus a unique-key error in the transition block |
| loader excludes completed 2026 (`AND m.season < 2026` in `COLEMAN_DERIVATION_SQL`) | new awards | rb | RED: oracle disagrees ("holds 46 Coleman winner row(s) that are not the 47 the contract's derivation_method yields ..."), 10 tests failed incl. the G2 oracle reproduction |
| finals round code written `QF` (`afl-api-rounds.ts`) | B4 issue276 (H&A only) | rb | GREEN, 4 passed: the lost coverage |
| same | new issue276 | rb | RED: 4 failed (all finals cases) |
| writer's `club_seasons.finals_played` forced to 0 (`player-derived.ts`) | B4 issue276 | rb | GREEN, 4 passed: the lost coverage |
| same | new issue276 | rb, sn | RED: 1 failed, "expected [0, 0] to deeply equal [1, 1]" |

All mutated files were restored (sha256 printed by `mut.sh` after each run); `git status` of the checkout showed only the
two uncommitted test files (no `src/` or `tools/` change) when the batch ended (`exp2.out`), and the final matrix ran from a
checkout with `porcelain=0` at the code commit.

## 5. Static checks

From the committed checkout (HEAD `fef79cbc`, porcelain 0), under the shared heavy lock (`evidence/final-static.out`,
`evidence/final/`): `npm run typecheck` rc 0; `npm run lint:gate` rc 0, "338 error(s) in 43 file(s) now; the ratchet baseline
allows 338 in 43 ... PASSED". The lint allowance was not touched and `lint:gate --update` was never run.

## 6. Disclosures

- A first version of `mut.sh` restored with `git checkout`, which reverted the uncommitted awards test in the host checkout to
  B4 during a mutation batch (`evidence/exp1-ABORTED-restore-bug.out`). Detected from a "MUTATION DID NOT CHANGE THE FILE"
  line; the batch was killed (own PIDs), the file re-copied, the script fixed, and every affected run repeated in
  `evidence/exp2.out`. Of the aborted batch only parts (a) B4-shared reds, (b) shared green runs and the first mutation
  (`m_keep2026_rb`, run before any revert) are used above; its later lines are not evidence. The committed code was never
  affected.
- A `pkill -f` attempt was refused by the permission layer and not retried; own processes were stopped by PID.
- Transient files outside the workspace, removed: `/tmp/coleman276-setup.sh` and `/tmp/c276.list` on the DEV host.
- Development runs before the commit (`awrb1`, `awsn1`, `i276a`, `leak276rb`, `newsh_*`) used the same test code except for a
  comment-only edit to the awards file; the authoritative results are the `fin_*` runs above.
