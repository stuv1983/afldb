# Remediation run 4, scope `rbfail`: integration ids that fail on the accepted rebuild

Worker: afldb-worker (Sonnet 5.5). Branch `claude/rem4-rbfail-20261115` from B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`.
Test-only scope: eight files under `tests/integration/` changed, nothing in `src/`, `tools/` or data. Nothing pushed.
Host: DEV `streamanator`, my workspace `/mnt/ssd/afldb-rem4-rbfail-20261115` (checkout `cand`), own cluster, port 55690.

## Bases (both restored/cloned on my cluster; aggregates and ids only, no rows left the host)

| Base | How | Identity measured 2026-11-15 |
|---|---|---|
| accepted rebuild ("rb") | `RESTORE.md` recipe, dump sha256 `d8397aab...8c63`, 83-table count diff vs published EMPTY, then the bridge child (`1200e702...b9d`) | ledger 118, matches 17056, seasons 1897..2026 plus 2027 `in_progress`, players 13365, `auth_users` 0, `match_coaches` 32470 (436 in 2026) |
| 4 Nov snapshot ("snap") | restored | ledger 118, seasons max 2026 (no 2027 row), `auth_users` 4, `match_coaches` 32034 (0 in 2026) |

Fixture seasons 2073/2074 and synthetic prefix `CD_I4060` were proved unused on both bases (0 seasons, 0 matches, 0 external identities, 0 players).
No fixture season is committed by any suite in this scope; the two committed fixture rows (below) use season 2026 / 1897 and a `CD_I4060` source key,
are created inside the suite and removed in the same suite. No `leaked-fixtures.ts` entry is needed for this scope.

## Per-id table

Class: 1 product defect, 2 rebuild defect, 3 stale/defective test (this scope fixes), 4 base data difference (bounded in test), 5 order/cross-file leak,
6 environment. All "rb RED" texts are from per-file runs at B4 (`cand-red`), logs `evidence/red_*`.

| Test file (ids) | Mechanism | Class | Action | Evidence |
|---|---|---|---|---|
| nl-answers-relationships (11) | Pinned `players.id` literals. The rebuild numbers people differently: Brent Harvey is 2164 on snap and 2172 on rb (2164 is Brent Crosswell there), Gary Ablett 4700/4701 vs 4720/4721, Rhyce Shaw 10974 vs 11043; every assertion asked about a different player. | 3 | Resolve each pinned player by afltables profile path (stable key; each has exactly one `unique` identity on both bases) in `beforeAll`. | red `red_pf_nl_answers_relationships`, green `g_*_rel` |
| nl-answers-cross-domain (6) | Same surrogate-id literals (Richmond coaches/players, lineage traps, Aaron Black pair). | 3 | Path maps resolved in `beforeAll`; lineage-trap loop keyed by profile. | `red_pf_nl_answers_cross_domain`, `g_*_xd` |
| nl-answers-first-kick-goal (4) | Pinned 330 linked of 334. The 4 unlinked rows (fkg-331..334, 2026 debutants) are unlinked on snap only because snap has no player/match rows for 2026 debuts; rb links all 334 (and their 2026 matches). Whether a 2026 row links is a property of the base's 2026 data. | 4 | Pins bounded to through 2025 (330 of 330, both bases); 2026 rows (4) asserted in [0,4]; W13 creates its own unlinked row (`CD_I4060`, 1897) and removes it in `finally`. | `red_pf_nl_answers_first_kick_goal`, `g_*_fkg` |
| nl-answers-coaching (1) | Richmond coaches with >= 50 games pinned at 14; rb holds 2026 coaching (436 `match_coaches` rows) which lifts Adem Yze past 50 (15). | 4 | Pins bounded `seasonMax: 2025` (owner decision 363-W), compared to hand-written SQL; the unbounded NL answer is compared to hand-written HAVING with no pin. | `red_pf_nl_answers_coaching`, `g_*_coach` |
| admin-season-lists (2, +1 file-level in per-file) | `maxYear` (=2027 on rb, a real `in_progress` season) was assumed to be below `FIRST_LIST_SEASON`; the refused-season loop then wrote real 2027 membership/overrides, leaving rows that reference the throwaway admin, so teardown hit `data_overrides_admin_user_id_fkey`. Also borrowed the first real `auth_users` row (rb has 0). | 3 | Suite-owned admin (`CD_I4060-admin-season-lists@example.invalid`) removed with its overrides/edits; refused seasons are `FIRST_LIST_SEASON-1`, `-2`, 1990, never the real open season. Shared mode left `auth_users +1`, `data_overrides +1` at B4. | `red_pf_admin_season_lists`, `red_sh_sl`, `g_*_sl` |
| special-records-lifecycle (1) | `SELECT min(id) FROM auth_users` is NULL on rb (0 users). | 3 | Rolled-back transaction inserts a suite-owned `auth_users` row. | `red_pf_special_records_lifecycle`, `g_*_life` |
| special-records-public-suppression (1, file-level) | `no fixture found for "unlinked"`: rb has no unmatched first-kick row, because rb links all 334. | 4 | If none exists, the suite creates one (source key `cd_i4060_suppression_fixture_source`, season 2026, `imported_at` 1970-01-01 so it cannot be the newest-import fixture) and removes it in `afterAll` (try/finally). | `red_pf_sup`, `g_*_sup` |
| v2-coleman-publication (baseline F-001, MED) | The suite refuses to run when a real Coleman 2001 row exists (correct), but its teardown then deleted the real `award_winners` row (and `import_batches` above a baseline of 0): rb `award_winners 3713 -> 3712`, snap `3712 -> 3711`. | 3 | `purge()` deletes only suite-created rows (suite players/source_record_id, suite user's projections/results) and import batches only when the baseline was captured. The refusal itself stays: the suite is documented for a schema-only base. | `colred1`, `red_sh_coleman` (rows deleted); `colgreen1`, `g_sh_*_col` (0 rows changed); schema-only base `colcs_final` 28/28 |
| afl-api-c7-observation (3, shared only) | Not a defect of this file. `match-admin-delete.test.ts` takes `max(year)` of `seasons` (2027 on rb) as its fixture season and leaves 2 committed `club_seasons` rows for it; c7's rolled-back `DELETE FROM seasons WHERE year=2027` then violates `club_seasons_season_fkey`. | 5 | NOT FIXED (not my file): finding F-001 below. c7 alone passes on rb and snap, both modes. | `pair-1/2/3*` (two single-file runs back to back on one rb copy: step 1 match-admin-delete passes and leaves `club_seasons 2027 = 2`; steps 2 and 3 c7 fails 3 of 6 with the FK text), `red_sh_c7alone` (passes alone) |
| settle-afl-api-state-b (1, brownlow scope) | `afldb_test has no auth_users row; this file will not create one.` (`tests/integration/settle-afl-api-state-b.test.ts:366-367`): rb has 0 `auth_users`. | 3 / 6 | Classify only, not edited. Needs the same fix as the lifecycle suite (suite-owned user) or a base with a user. | baseline `raw/c1-failures.tsv` |
| nl-answers-after-siren (3, shared scope) | Data difference, not defective code: snap has 6 unlinked after-siren kicks (5 are 2026 kicks whose players snap lacks), rb has 1. rb therefore has an extra most-recent 2026 kick (Tim Membrey vs Nasiah Wanganeen-Milera), a different tie list in "most kicks after the siren" (the baseline TSV shows one more name than pinned) and `noPlayerLink` 1 vs the pinned 6. | 4 | Classify only, not edited (`nl-answers-after-siren.test.ts:348,379` and the tie list). Same fix pattern as first-kick-goal: bound the pins to through 2025. | baseline `raw/c1-failures.tsv`; `p3` counts (126 rows both, unlinked 6 vs 1, from-2026 5 vs 5) |
| club-comparison / gridley (clubcmp), release-gates, match-admin-delete | Not in this scope (release-gates done elsewhere; match-admin-delete belongs to another scope, see F-001). | - | none | - |

## Red/green matrix (every changed file; accepted rebuild "rb" and 4 Nov snapshot "snap")

RED = pristine B4 in `cand-red`, GREEN = HEAD `c5ca485a1d9dc2a0d177f9e066149dc16c238fca` in `cand`. Per-file = `AFLDB_TEST_PER_FILE_DB=all` on a fresh template copy; shared = one copy,
single file, with a before/after count of every public table ("rows changed" must be 0).

| File | rb RED (per-file) | snap at B4 | rb GREEN pf / sh | snap GREEN pf / sh |
|---|---|---|---|---|
| nl-answers-relationships | 11 failed / 49 | passes (baseline) | 49 pass / 49 pass, 0 rows | 49 / 49, 0 rows |
| nl-answers-cross-domain | 6 failed / 22 | passes (baseline) | 22 / 22, 0 rows | 22 / 22, 0 rows |
| nl-answers-first-kick-goal | 4 failed / 20 | passes (baseline) | 20 / 20, 0 rows | 20 / 20, 0 rows |
| nl-answers-coaching | 1 failed / 23 | passes (baseline) | 23 / 23, 0 rows | 23 / 23, 0 rows |
| admin-season-lists | 1 failed + file-level FK / 42 | passes (baseline) | 42 / 42, 0 rows (RED shared: +1 auth_users, +1 data_overrides) | 42 / 42, 0 rows |
| special-records-lifecycle | 1 failed / 16 | passes (baseline) | 15 + 1 skipped / same, 0 rows | same |
| special-records-public-suppression | file-level fixture missing, 23 skipped | passes (baseline) | 23 / 23, 0 rows | 23 / 23, 0 rows |
| v2-coleman-publication | refusal + real row deleted (rb 3713 -> 3712, snap 3712 -> 3711) | row deleted at B4 | refusal, 0 rows changed (both modes, both bases); schema-only base 28/28 | same |
| afl-api-c7-observation (unchanged) | passes alone | passes | passes alone, pf and sh; fails only after match-admin-delete (F-001) | passes |

The v2-coleman-publication refusal remains by design on any base that already holds a real Coleman 2001 row; only its collateral damage is fixed.

## Provenance corrected from my own earlier claims
Verified on the rebuild before keeping any comment in a test: Brent Harvey 2172 (2164 is Brent Crosswell); first-kick-goal 334 of 334 linked (325 unique, 9 resolved), 330 of 330 through 2025,
4 of 4 in 2026 with matches; rb has 0 `auth_users`, a 2027 `seasons` row (`in_progress`), 436 2026 `match_coaches` rows; snap has none of those.

## Gate (exit)
Run on the host checkout at HEAD `c5ca485a1d9dc2a0d177f9e066149dc16c238fca` (porcelain empty), under one hold of the heavy lock (`gate.sh gate1`):

- `npm run typecheck`: rc 0 (`evidence/gate1-typecheck.log`).
- `npm run lint:gate` (never `--update`): PASSED, 338 errors in 43 files now against a ratchet baseline of 338 in 43, so no increase (`evidence/gate1-lintgate.log`).

A queued multi-file shared run of match-admin-delete plus afl-api-c7-observation (`red_sh_c7pair`) was cancelled while it waited for the heavy lock;
the same proof was obtained with two single-file shared runs on one copy (`pair.sh`), so no multi-file group ran outside the lock.
`evidence/runs/run-reds.out` is therefore truncated at that line, and `evidence/runs/run-reds-aborted-hyphen.out` is a first attempt that failed on an
invalid database name (hyphens) before any test ran. `colred1`/`colgreen1` (Coleman, snapshot) are from an earlier session of this worker using the same fix.

## Layout
`evidence/` logs, JSON reports, failure TSVs, table-count before/after; `scripts/` the host runners (`rf.sh`, `greens.sh`, `reds.sh`, `pair.sh`, `cs.sh`, `gate.sh`, probes). `SHA256SUMS` covers every file here except itself.
