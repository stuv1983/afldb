# AFLDB-ISSUE-254 — Full derived rebuild diverges from the targeted player-derived recompute

**Status:** Resolved 2026-09-30 on `code_test_db` / `afldb_test` evidence. Committed on its own
branch after final review (§12); awaiting integration into the ISSUE-238 line. **Severity:** Medium. Derived statistics
were wrong on every rebuilt database: frees totals were empty corpus-wide, and zero-games career rows
the product had created were erased. No source fact was lost. **Opened:** 2026-09-30.
**Area:** Derived statistics — `tools/migration/rebuild_derived.py` (the full rebuild) against
`src/db/queries/player-derived.ts` (`recomputePlayerDerivedStats`, the targeted recompute).
**Worktree:** `D:\dev\afldb-issue-254`, branch `issue/254-derived-rebuild-parity`, created with
`git worktree add` from ISSUE-238 HEAD `d279c8e0`.
- **Why that base.** The same reasoning as AFLDB-ISSUE-253:
  - the integration target is the ISSUE-238 line;
  - `worktree:bootstrap` bases only on `main`;
  - the three files this defect concerns are byte-identical between `d279c8e0` and the ISSUE-238
    working tree (`rebuild_derived.py`, `player-derived.ts`, `common.py`).
- **No migration and no schema change.** The fix is Python rebuild SQL plus tests. It does not
  depend on migrations 108/109, and it conflicts with no ISSUE-238 or ISSUE-253 file.

> **Discovered by AFLDB-ISSUE-238 case 47, but not caused by ISSUE-238.** Case 47 compares the
> derived state after a real identity correction (its targeted recompute) with a real committed
> `rebuild_derived.py`. They differed in four fixture rows, and nothing else differed. Both
> components reproduce with no ISSUE-238 code involved (§2). This issue changes no correction,
> planner, Q2, fingerprint or identity code. ISSUE-238 stays at 54 / 55 until case 47 is re-run
> from a fresh fixture after integration.

## 1. The two components

`recomputePlayerDerivedStats()` documents itself as the "targeted counterpart of
tools/migration/rebuild_derived.py … keep the statistical definitions in lockstep". Its callers are:
- every admin match mutation;
- the AFL API settle;
- the ISSUE-238 correction.

The full rebuild runs:
- as a stage of `db:test:rebuild` (`tools/db/rebuild-test.ts`);
- to build a rebuilt promotion database;
- as the documented follow-up to a data import.

The AFL Tables settle does **not** run it. The comment in `tests/data-overrides-source-contract.test.ts`
("which the nightly settle runs") is stale; see Follow-up.

### A. Frees aggregation missing from the full rebuild
- **What 065 added.** Migration 065 (`c53e6a3c`, 2026-08-21) added `frees_for`, `frees_against` and
  `frees_recorded_games` to `player_club_season_stats`, `player_season_stats` and
  `player_career_stats`, "so they are available for global records and career totals".
- **Only the targeted side was updated.** The same commit taught `player-derived.ts`. `rebuild_derived.py`
  never learned the columns, so every full rebuild left them NULL / NULL / 0.
- **Evidence on both test databases:**

  | Measure | Value |
  |---|---|
  | `player_match_stats` rows carrying frees | 435,715 of 685,471 |
  | Frees recorded on one side only | 0 rows |
  | Derived rows with frees populated, in all three tables | 0 |
  | Rows disagreeing with their own match rows on `code_test_db`, before the fix | 5,950 career, 33,082 season, 33,167 club-season |

### B. Zero-games `player_career_stats` row dropped by the full rebuild
- **What the targeted recompute does.** It gives a match-less player a zero-games career row
  (AFLDB-ISSUE-018): additive totals 0, era-limited totals NULL, recorded-game counts 0, Brownlow
  from `brownlow_season_votes`.
- **What the full rebuild did.** `TRUNCATE` + aggregate over `player_match_stats` erased it.
- **On `afldb_test`:** all 92 AFLDB-ISSUE-224 S9 registered players have **no** career row. Each was
  created by `createPlayerInTransaction()` with one, and a later full rebuild (2026-09-28) removed it.

## 2. Independent reproduction (no ISSUE-238 code path)

- **Harness:** the scratch `D:\tmp\issue254\parity-proof.mts` (not repository code), run through
  `D:\tmp\issue254\pin-env.mjs`.
- **Fixture (committed, namespaced, torn down):** season 2082, match keys and player slugs
  `issue254-2082-*`, and two real clubs READ only.
  - **F:** frees 2/1 in one of two games; NULL in the other.
  - **Z:** one match row, deleted after a targeted recompute. That is the ISSUE-018 path, and it
    leaves Z the zero-games row. A season Brownlow total of 4 rides on that row.
  - **X:** a shell with no career row, at the settled `search_rank` 0 (see §5).
- **State B:** the product settles 2082 (`recomputeSeasonMetadata`, `recomputeClubSeasons`), then
  the REAL `recomputePlayerDerivedStats` runs.
- **Target proof, before the rebuild runs:** the DSN is resolved through the script's own
  `load_env` / `require_env` / `connect_pg`, and must be `afldb_import@127.0.0.1:55432/code_test_db`
  with `current_database()` `code_test_db`.
- **State C:** after the REAL `python tools/migration/rebuild_derived.py`, committed.
- **Unfixed script:** the ISSUE-238 working-tree copy, byte-identical to `d279c8e0`, sha256
  `a0c13e4d…`. Log: `D:\tmp\issue254\repro-unfixed.log`.

| Fixture row | B (targeted) | C (unfixed full rebuild) |
|---|---|---|
| F `player_club_season_stats` | frees 2 / 1 / recorded 1 | NULL / NULL / 0 |
| F `player_season_stats` | 2 / 1 / 1 | NULL / NULL / 0 |
| F `player_career_stats` | 2 / 1 / 1 | NULL / NULL / 0 |
| Z `player_career_stats` | zero-games row (votes 4) | **row removed** |

- **Non-fixture drift: 0.** The corpus already sat at the unfixed script's own fixed point.
- **Fifth difference, a fixture artefact:** X's `players.search_rank` went NULL → 0, because X was a
  raw insert. It is classified in §5.

## 3. Frees contract (ported, not re-invented)

The targeted definitions, in `player-derived.ts`:
- `frees_for = sum(frees_for)` and `frees_against = sum(frees_against)`. There is no COALESCE, so
  the result is NULL when no game recorded them.
- `frees_recorded_games = count(frees_for)`: games in which `frees_for` was recorded.
- The grouping is by (player, season, club), (player, season) and player, as for every other
  statistic.
- A zero-games career row carries NULL / NULL / 0.

`rebuild_derived.py` now carries exactly these:
- `pg_ctx` gains `pms.frees_for` and `pms.frees_against`;
- each of the three statements adds the two sums and `count(frees_for)`;
- there is no other change to any definition.

`count(frees_for)` versus a both-sides count is not a live question today: 0 corpus rows record one
side only. The targeted rule is kept as written.

## 4. Zero-games career row: contract analysis and decision

| Evidence | Says |
|---|---|
| AFLDB-ISSUE-018 (2026-08-20, `efe328a4`) | Player creation **and** last-match deletion seed a zero-games career row; era totals stay NULL. A deliberate, resolved design. |
| `createPlayerInTransaction` (`players.ts:366`) | Every admin-created player gets the row. |
| `replay_admin_overrides(players)` (`common.py:1298`) | The durable replay re-creates it: "The derived rebuild regenerates the real figures; this is the same zero row createPlayerInTransaction() seeds". It **expects the row to survive** the rebuild. |
| `recomputePlayerDerivedStats` (`player-derived.ts:300`) | "A listed player remains discoverable after their last erroneous match is removed." |
| AFLDB-ISSUE-108 §9 row E; `db-health.ts` check #5 | Two DraftGuru canonical shells legitimately have **no** row: "No synthetic rows created". The health check accepts both states. |
| `draftguru-import.test.ts` | The DraftGuru importer gives a shell no row. |
| Consumers | Profiles, search, NL resolve and draft use LEFT JOIN. Lists, records, advanced search, Grid Solver and `listMostViewedPlayers` use INNER JOIN, so row existence decides whether a match-less player appears there at all. |

The answers to the seven questions:
1. **Is there a row for every player?** No. ISSUE-108 shells legitimately have none.
2. **Only for players with matches?** No. ISSUE-018 players keep one.
3. **Why does the targeted path create one?** So a created player, or one whose last match was
   deleted, keeps the career row the product made for them, "not recorded" era values included.
4. **Do consumers rely on it existing?** Yes, the INNER JOIN list and record surfaces do.
5. **Last game deleted:** the targeted recompute leaves the zero-games row.
6. **What `deleteMatch` expects:** exactly that; it calls the targeted recompute.
7. **Is it asserted anywhere?** No test asserted it before this issue. The Python replay's comment
   states the expectation.

**Decision.** The targeted behaviour is canonical, so no live writer changes. The full rebuild now
**preserves** the rule:
- Before its TRUNCATE, it records every match-less player that already holds a career row.
- It re-derives each of those to the targeted zero row, with Brownlow from `brownlow_season_votes`.
- It invents none, so an ISSUE-108 shell still has no row.

This is the only rule consistent with ISSUE-018, ISSUE-108, ISSUE-160 and the targeted recompute
together:
- "a row for every player" would contradict ISSUE-108;
- "rows only with matches" would reverse three live writers, which is out of scope here and a stop
  for operator review.

## 5. Fixture classification: `players.search_rank` of an unsettled shell

- **What the rebuild does.** Its `search_rank` target sets `search_rank = 0 WHERE search_rank IS NULL`
  for every player. That is its own normalisation of a player no derive writer has settled.
- **What the targeted path owns.** `search_rank` for the players it recomputes, which always hold a
  row afterwards.
- **Measured.** Neither test database has a NULL `search_rank`, and every career-rowless player
  holds 0 (2 on `code_test_db`, 94 on `afldb_test`).
- **Classification.** X's NULL was an unsettled fixture row, not a targeted-versus-full
  disagreement. The fixture now starts X settled at 0; the harness and the regression test say why.

## 6. Implementation

- `tools/migration/rebuild_derived.py`:
  - frees in `pg_ctx`, `player_club_season_stats`, `player_season_stats` and `player_career_stats`;
  - `player_career_stats` gains `matchless_career` (an `ON COMMIT DROP` temporary taken before the
    TRUNCATE) and the zero-row INSERT. Its values are copied from `player-derived.ts:302-332`.
- No other rebuild target, definition or file changed.
  - Unchanged: `seasons`, `player_clubs`, `club_seasons`, `search_rank`, the `players` columns and
    `player_match_stats.career_game_no`.
  - No TypeScript production file changed.

## 7. Real committed rebuild parity (`code_test_db`)

- **Fixed script:** sha256 `54bce517…`, the same harness and fixture as §2.
- **Rebuild-local exclusions:** only the two ISSUE-238 case 47 proved (`club_seasons.id`,
  `player_career_stats.rebuilt_at`). No other exclusion was added.

- **Run 1, `fixed-run1.log`** (8/9; the one FAIL is the strict drift check on the frees repair below).
  - **Fixture:** B == C on every business key and every semantic column.
  - **Non-fixture drift:** confined to the three frees columns.
    - Exactly 33,167 club-season, 33,082 season and 5,950 career rows changed. Those are exactly the
      pre-run mismatch counts.
    - With the frees columns left out, drift is 0 in all 7 relations: no row added, removed or
      otherwise changed.
  - **Frees mismatches after the run:** 0 / 0 / 0.
  - **Zero-games rows:** the real shells still have none (none invented).
  - **Historical values:** the frees change was expected, and the only rows it touched are the
    ones whose own match rows carry frees.
- **Run 2, `fixed-run2.log` (9/9 PASS).** A fresh fixture.
  - Fixture B == C.
  - Zero drift in every relation; corpus digest `8ca97c80…` → `8ca97c80…`.
  - The fixed script is at its own fixed point.
- **Every run:**
  - no other session on the database;
  - 7 `derived_rebuilds` rows, all completed;
  - fixture residue 0;
  - the post-teardown corpus equals C;
  - ISSUE-238 fixture residue 0 afterwards.
- **Retained state.** `code_test_db` now holds the fixed rebuild's derived state, frees populated.
  - Running the **unfixed** script there again would null them.
  - The `club_seasons` id sequence and `derived_rebuilds` ids advanced (log ids 15–35). They were
    not wound back; they are sequence state, not semantic state.

## 8. Regression coverage

- **`tests/integration/derived-rebuild-parity.test.ts` (new).** No suite ran `rebuild_derived.py`
  against PostgreSQL.
  - It reads the rebuild's REAL SQL text from the Python module (`PLAYER_GAME_CONTEXT`, `REBUILDS`,
    `ORDER`) and runs it target by target on `afldb_test`.
  - Everything happens in one always-rolled-back transaction, with each target's temporaries dropped
    as its commit would. Nothing is committed.
  - It asserts the targeted contract first (F's frees, Z's zero row, X rowless), then key-for-key
    and column-for-column equality. Finally it asserts both halves of the zero-games rule outright
    on the rebuilt state: Z's row exists, and shell X has none.
  - It lifts `statement_timeout` for its own transaction: the rebuild's statements are whole-table.
  - **It discriminates.** On the unfixed script it FAILS: Z's `player_career_stats` key is missing.
    On the fixed script it passes, 1/1 in about 47 s.
  - `afldb_test` was untouched afterwards: `derived_rebuilds` still 7 rows, frees still 0.
- **`tests/data-overrides-source-contract.test.ts`.** A DB-free pin beside the ISSUE-160 replay
  contract:
  - the zero row is preserved before the TRUNCATE;
  - it is sourced from `matchless_career`, never `players`;
  - the frees recorded-game rule is in lockstep in all three grains.
- **`tests/integration/draftguru-import.test.ts`.** A stale comment is corrected; the assertion is
  unchanged. A shell still gets no row, and the rebuild never invents one.

## 9. Validation (2026-09-30)

- **Parity test:** `derived-rebuild-parity` 1/1 on `afldb_test`. Before the fix it failed as
  intended.
- **DB-free suites:** `data-overrides-source-contract` 66/66. Together with
  `finals-semantics-contract`, `db-test-rebuild` and `admin-match-mutations`: 602/603.
  - The one failure is `finals-semantics-contract` "adds the enum value in its own migration", the
    known Windows CRLF comparison.
  - It fails identically on the untouched ISSUE-238 tree, and is unrelated.
- **Checks:**
  - `python -m py_compile tools/migration/rebuild_derived.py` passes;
  - `tsc --noEmit` is clean;
  - ESLint on the three touched test files is clean;
  - `git diff --check` is clean.
- **Python tests:** no `tests/python` suite covers `rebuild_derived.py`.
- **Deliberately not run:**
  - match-admin/delete, settle and correction suites: no targeted writer changed;
  - ISSUE-238 case 47: that happens after integration.

## 10. Boundaries (held)

- **ISSUE-238:** case 47 not re-run; no Slice 11/12 work.
- **Environments and schema:** no DEV or PROD; no migration 110; no privilege change.
- **Code left alone:** no correction, planner, Q2, fingerprint or identity code; no live writer
  (targeted recompute, `createPlayerInTransaction`, replay) changed.
- **Git and repository:** no stage, commit or merge; `second` untouched.
- **Mutations:** `code_test_db` only (committed rebuilds, namespaced fixtures) and `afldb_test`
  rolled back. Target verified before every run.

## 11. Follow-up

- **Integration and re-run.** Integrate into the ISSUE-238 line. Then re-run ISSUE-238 case 47 from
  a fresh fixture with the fixed script.
- **Deploy consequence.** The next full rebuild of any database fills the frees columns
  corpus-wide. Records and career totals that read them start showing values.
  - It restores **no** zero-games row a previous rebuild already erased (for example the 92
    ISSUE-224 S9 players on `afldb_test`).
  - A targeted recompute of those players, or a fresh `db:test:rebuild` (whose replay re-creates
    them), restores them. Neither was run here.
  - DEV/PROD state was not inspected.
- **INFO, not fixed.** These are outside the parity comparison (B == C held for them) and are
  recorded only:
  - The full rebuild does not re-derive `players.debut_season`/`final_season`,
    `player_match_stats.career_game_no`, or `seasons.first_match_date`/`last_match_date`/`match_count`/`club_count`,
    all of which the targeted helpers write.
  - The stale "the nightly settle runs" comment in `tests/data-overrides-source-contract.test.ts`.

## 12. Final review and commit (2026-09-30)

- **Production diff** matches the approved design (§3, §4) and is unchanged by the review.
- **Regression gate.** The preserve-existing half was asserted by the per-key parity check. The
  do-not-synthesise half was asserted only before the rebuild and implied after it by key-set
  equality. Two explicit post-rebuild assertions were added: Z's row exists, and X has none.
  - Re-run on `afldb_test`: 1/1 (about 47 s).
  - Residue before and after is identical: season 2082, its matches, `issue254-*` players and
    club-seasons all 0; `derived_rebuilds` 7; career rows 13,271; frees-populated career rows 0.
- **Not re-run:** the global `code_test_db` rebuild (proven twice, §7); ISSUE-238 case 47.
  `draftguru-import` was not run either: it commits a real importer run on `afldb_test`, and its
  change here is a comment.
- Committed on `issue/254-derived-rebuild-parity` with ISSUE-254 files only; not yet integrated.
