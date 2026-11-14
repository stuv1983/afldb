# Remediation run 2026-11-14 - scope `answers` (ISSUE-355, ISSUE-360 FE-4, Gridley corpus)

Branch `claude/rem-answers-20261114`, base `5035ed96` (origin/main `de640826` + review records).
Code commits: `c08c3e51` (ISSUE-355), `92377e5e` (ISSUE-360 FE-4). This README and the files beside it are a third,
docs-only commit. Host workspace `/mnt/ssd/afldb-rem-answers-20261114`, isolated PostgreSQL port 55616, databases
`afldb_v2_remanswers*_test`, all copies of the restore-verified 2026-11-04 production snapshot (ledger 118, no migration added).
No production or DEV access was made. `codebase-memory-mcp` was not connected; Grep/Read were used.

## 1. Findings: validated

### ISSUE-355 (SRCH-1): validated, exactly as reviewed
- Source: `src/db/queries/grid-solver.ts` `ledSeasonRows` live-only branch compared `t2.total > t.total` with no NULL guard; a
  player-season whose every row is NULL for the statistic sums to NULL, `t2.total > NULL` is never true, so it "led" its club.
  The precomputed branch (`WHERE pcs.col IS NOT NULL`), `league_season_stat_rank_top` and `player-season.ts:119` were already guarded.
- Reproduced on the snapshot copy before the fix (`red-int-grid.txt`): clearances 10,966 vs 178 guarded, rebounds 11,023 vs 259,
  inside 50s 11,008 vs 223, goal assists 11,436 vs 273, 5-times clearances 3,360 vs 31, and 200 of 200 sampled players whose whole
  career pre-dates recording were "leaders" (the review's numbers, to the digit).
- Fix: `HAVING sum(...) IS NOT NULL` on both aggregates (outer and the comparison side).
- Other live-only builders checked for the same pattern (read every `sum(`/`avg(`/comparison over a live-only stat in the file):
  `careerStatAtLeast`, `seasonStatAtLeast`, `finals_stat_total_min`, `venue_stat_total_min`, `career_stat_exceeds`,
  `league_season_stat_rank_top` (already guarded), `*_avg_min` (filter `IS NOT NULL`). Each compares an aggregate with `>=`/`>`
  against a bound parameter or another aggregate; a NULL aggregate makes the predicate NULL (false). Only the leader builder uses
  `NOT EXISTS (... > t.total)`, where NULL means "nobody beat me". `venue_goals_max` coalesces goals, which are recorded for every
  game. No other defect proven, none changed.

### ISSUE-360 FE-4: validated
- Source: `src/app/page.tsx:82` asks for 5; every provider in `src/db/queries/home-records.ts` is `LIMIT 5`; the panel cannot see a tie.
- Reproduced on the snapshot copy (`red-int-home.txt`): after-siren-most-attempts shows 5 of 9 holders of the record value (expected 9),
  after-siren-most-goals 3 of 64 on the fifth value, coach-most-premierships 1 of 8. (Review: 8 of 22 catalogue entries truncate a
  boundary tie, 1 a top tie.)

## 2. What changed

| Commit | File | Change |
|---|---|---|
| `c08c3e51` | `src/db/queries/grid-solver.ts` | NULL guard in `ledSeasonRows` (+ comment) |
| `c08c3e51` | `tests/integration/grid-solver.test.ts` | new `describe` ISSUE-355 (6 tests) + `axisPlayerIds` import |
| `92377e5e` | `src/lib/home-records.ts` | pure `selectHomeRecordRows`, `HOME_RECORD_TIE_WINDOW` (200), `HOME_RECORD_MAX_ROWS` (10), `HomeRecordMoreTied` |
| `92377e5e` | `src/db/queries/home-records.ts` | `getHomeRecord` reads the provider through the window and applies the selection; `moreTied` on the result |
| `92377e5e` | `src/components/HomeRecordPanel.tsx` | "and N more tied on V - see the full record" line |
| `92377e5e` | `src/styles/globals.css` | `.meter-more` (8 lines, existing tokens only) |
| `92377e5e` | `tests/home-records.test.ts` | 12 new tests; one existing assertion changed (see below) |
| `92377e5e` | `tests/integration/home-records.test.ts` | 3 new DB tests |

Behaviour (FE-4): the panel still names the top five places. Every holder tied on the fifth value is listed when the whole group fits
in 10 rows (nine co-holders of the after-siren record: 9 rows); a longer tie lists the first five rows and states how many more
are tied on that value ("and 61 more tied on 1 Goals"), saying "at least" if the 200-row window itself ends inside the tie, and links
the full record page when the record has one (`definition.destination`). A catalogue entry with no destination (venue records) shows
the count without a link. Rows are never relabelled or reordered.

Existing assertion changed: `tests/home-records.test.ts` "falls back before dispatching..." asserted
`career` was called with `('most-goals', 5)`; it now asserts the tie window (200). This is the intended contract change, not a
weakening: the provider must be read wider than the panel limit for a tie to be visible.

Oracle-independence (plan review R-4/W-1): no snapshot-derived literal was added. Grid tests compare the builder with a guarded
reference query on the same database and assert relational invariants (no leader without a recorded value; no pre-recording
career is a leader); they hold on the snapshot and on a rebuilt `afldb_test`. The home DB tests compute holder counts from the same
queries without a LIMIT and assert `shown + moreTied == holders at the cutoff`; they hold with or without ties (ties exist on the
snapshot; the unit tests cover them synthetically on every database).

## 3. Tests (all on the host; commands run from the checkout with the isolated-pg launcher)

Red = the new tests against the base source, green = with the fix; each on a fresh snapshot copy.

| Suite | Red (base source) | Green |
|---|---|---|
| `tests/home-records.test.ts` (unit) | 9 failed / 12 passed: `expected [ {...} x5 ] to have a length of 9 but got 5`; `expected [6,5,4,3,3] to deeply equal [6,5,4,3,3,3,3]`; `expected undefined to deeply equal { count: 61, exact: true, value: 1 }`; `selectHomeRecordRows is not a function`; panel lacks `and 61 more tied on 1 Goals` (`red-unit-home.txt`) | 21/21 (`green-unit-home.txt`) |
| `tests/integration/home-records.test.ts` | 3 failed: `expected 5 to be 9`, `expected 3 to be 64`, `expected 1 to be 8` (`red-int-home.txt`) | 7/7 (`green-int-home.txt`) |
| `tests/integration/grid-solver.test.ts` ISSUE-355 block | 6 failed: `expected 10966 to be 178`, `11023 to be 259`, `11008 to be 223`, `11436 to be 273`, `3360 to be 31`, `expected [ {id:23}, {id:24}, ...(198) ] to deeply equal []` (`red-int-grid.txt`) | 6/6; whole file 222/222 |

Final qualification (`final/`): checkout `/mnt/ssd/afldb-rem-answers-20261114/final`, `git rev-parse HEAD` =
`92377e5e78337998c70fd8dab1b09fa186e058c3` (the code head; this docs commit follows it), `git status --porcelain` empty before and after
(`final/checkout.txt`, `final/summary.txt`), `npm ci` from the lockfile.
- `tsc --noEmit`: rc 0. `eslint` on the 8 changed ts/tsx files: rc 0, no output.
- Unit (no DB variables) `tests/home-records.test.ts tests/site-settings.test.ts tests/v2-acquisition-pipeline.test.ts tests/grid-solver-spec.test.ts`:
  100 passed, 1 failed. The failure is `tests/v2-acquisition-pipeline.test.ts` (e) "docs/v2/architecture.md section 9 equals
  renderAflApiStageMap output" - the review's TST-3 / ISSUE-358 baseline failure, owned by `pins`; this scope does not touch
  `settle-afl-api.ts` or the architecture document. The same file's closure rule (acquire CLIs reach `src/lib/home-records.ts`
  only as a pure leaf) still passes: the new helper has no imports.
- Integration on fresh snapshot copies: `grid-solver.test.ts` 222/222, `home-records.test.ts` 7/7.

## 4. Gridley corpus before and after (`gridley-compare.txt`)

`tests/integration/gridley-corpus.test.ts`, strict (non-diagnostic) mode, one fresh snapshot copy each, base `grid-solver.ts` vs fixed,
under the host heavy lock with `nice`/`ionice`: both runs `1 failed | 1211 passed (1212)` - the single failure is the documented
"writes the run report and has no failing cells" test listing the accepted unsupported/criterion cells (the first 40 are shown in
`gridley-before.log` on the host). Compared structurally (timings ignored): 10,209 solved cells identical, 25,422 findings
identical (0 only before, 0 only after), 839 criteria identical, category counts identical
(time of board 23,530; list membership 1,232; external source disagreement 425; unsupported 78; adjudicated source conflict 63;
adjudicated key disagreement 54; criterion disagreement 40). Reason there is no delta: the corpus uses
`club_season_stat_leader` for goals, marks and disposals only (`clubLeadingGoalKicker`, `...2x`, `...3x`, `marksClubLeader`,
`disposalsClubLeader`), all precomputed statistics on the unchanged branch, so no corpus cell reads a live-only leader.
Host raw: `/mnt/ssd/afldb-rem-answers-20261114/evidence/gridley-{before,after}.{json,log}` (sha256 in `raw-sha256.txt`).
Run note: the `rc=` echo in `gridley.sh` printed 0 for both runs because `$(date)` reset `$?` before it was read; the verdicts above are
from the Vitest summaries (`gridley-*.summary.txt`).

## 5. FE-4 visual evidence

Declared before applying: viewports 1280x800 (desktop) and 390x844 (mobile); screen `/` (home), the "Record of the week" panel;
states: after-siren-most-attempts (nine tied on the record: top tie), after-siren-most-goals (64 tied on the fifth value: long tie,
marker), coach-most-premierships (8 tied on the fifth value: marker with a different destination), most-goals (control: no tie, must
be unchanged).

Method (one production build allowed): one `next build --webpack` of the final commit (BUILD_ID `pPxbtsXi4xR-V7-Y7kzkH`,
`build-next.tail.txt`) on the snapshot-copy database `afldb_v2_remanswersbuild_test`, served from `.next/standalone/server.js` on
`127.0.0.1:3161` only. Every probe recorded the BUILD_ID the page hit (`fe4/probes.txt`: every probe line, across the aborted first launch, the JS-on run and the JS-off re-capture, served
`pPxbtsXi4xR-V7-Y7kzkH`).
The home page is ISR, so for each state the `home.record_of_the_week` setting in the disposable database was set, the prerendered
`index.*` files in my own build output deleted and the server restarted. "After" = the real built page. "Before" = the same real
page with the Record-of-the-week `<section>` replaced by the base commit's own server render of the same snapshot data
(`fe4/before-<record>.html`, rendered by `zz-render-panel.test.ts` in a base checkout), so the stylesheet, layout and everything else are identical
and only the panel differs. This is honest about being a swap, not a second build. JavaScript is disabled in both tags: the hydrated page
adds a fixed cookie-consent bar that covered the panel in element screenshots (the first, JS-on capture run is kept on the host as
`evidence/fe4-js-on/`; its metrics agree: same row counts and marker text, no horizontal overflow).

Results (`fe4/*.json`; panel images `fe4/<record>-{before,after}-{desktop,mobile}-panel.png` are kept in the repo, the full-viewport
`-page.png` images stay on the host under `evidence/fe4/` with sha256 in `raw-sha256.txt`):

| State | Before rows | After rows | After marker | Panel height desktop/mobile (px) after |
|---|---|---|---|---|
| after-siren-most-attempts | 5 | 9 | none (all nine shown) | 615 / 609 |
| after-siren-most-goals | 5 | 5 | "and 61 more tied on 1 Goals - see the full record" -> `/records/after-the-siren` | 434 / 431 |
| coach-most-premierships | 5 | 5 | "and 7 more tied on 4 Premierships - see the full record" -> `/records/coaches` | 349 / 346 |
| most-goals (control) | 5 | 5 | none | 404 / 401 (equal to before) |

Checklist and verdict. Automated (from `fe4/*.json`, both viewports, all four states): HTTP 200; meter row counts and marker text
as in the table; `horizontalOverflow: false` everywhere; control panel height identical before/after (404/401). Manual (images viewed by
me, listed so the gap is visible): after-siren-most-attempts after desktop and mobile (nine rows, none clipped, footnote intact);
after-siren-most-goals after mobile (marker on one line, link underlined, within the column); coach-most-premierships after desktop
(marker on one line); most-goals after mobile (unchanged); after-siren-most-attempts before desktop (five rows). The remaining images
(other before/after pairs, desktop long-tie, mobile coach) were captured and measured but not individually eyeballed. Verdict: PASS on
the stated checklist; the nine-row top tie is 190 px taller than before (615 vs 425 desktop), the intended cost of not hiding four
co-holders of a record; the long-tie panel grows by one short line (about 30 px). The panel is a narrow column (about 320 px) at both
viewports, so desktop and mobile layouts are near-identical.

## 6. Owner decisions (recommendations; nothing blocked)

1. **Tie display policy** (`HOME_RECORD_MAX_ROWS` 10, window 200, marker beyond). Recommended as implemented: it shows every holder of a short
   tie, stays compact on a long one, and never implies fewer holders than exist. Alternatives: always list ties in full (a 64-row tie would
   make the panel unusable) or always show five plus a marker (simpler, but hides co-holders of the record itself). Change = the two
   constants in `src/lib/home-records.ts`.
2. None for ISSUE-355.

## 7. Not done / residual

- The home page keeps ISR (`revalidate = 3600`); the setting change takes effect at the next revalidation as before.
- The provider is now read for 200 rows instead of 5 (career/match/season/coach/venue/curated queries are LIMIT-bounded and sorted before
  the limit; extra cost is at most the per-row club-name aggregation for 200 rows on the career query). Not measured under load (no
  perf budget was stated for this scope); `perf` owns `/players` and `/clubs/compare` timings.
- Hydration smoke of the changed page and a mobile interaction check were not run: the change is server-rendered markup plus one CSS rule.

## 8a. Teardown

Server on 127.0.0.1:3161 stopped; `isolated-pg stop` run; no listener on 55616 or 3161; no process left with a working directory in the
workspace; workspace left in place, `du -sh` 11G (cluster with the template and eleven snapshot copies, two checkouts, one build). The final checkout still
reports `HEAD 92377e5e78337998c70fd8dab1b09fa186e058c3` with an empty `git status --porcelain` after the build, tests and captures.
The DEV service and port 3000 were never probed.

## 8. Host scripts (mine, all inside the workspace; sha256 in `host-scripts-sha256.txt`)

`host-answers.sh` (clone/cluster/template/mkdb/stop), `vt.sh` + `sum.sh` (Vitest wrappers), `gridley.sh`, `final.sh`, `build.sh`,
`ans-serve.sh`, `ans-fe4.sh`, `ans-fe4-run.sh`, `ans-qual.sh`, `in/fe4-shoot.mjs`, `in/zz-render-panel.test.ts` (scratch renderer, never committed to the repo),
`gdiff3.mjs`. Local copies of the helpers are under the scratchpad `answers\` directory. The shared-scratchpad overwrite reported by the
orchestrator affected only a local file named `final.sh`; every script that produced a result here ran from my own host workspace copy,
whose content and hashes were verified to reference only this workspace and port (`ans-verify-scripts.sh`).
