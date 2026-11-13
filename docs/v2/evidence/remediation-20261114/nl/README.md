# nl remediation evidence, 2026-11-14

Worker: nl (ISSUE-356, ISSUE-360 SRCH-5/SRCH-7, ISSUE-359 SRCH-6).
Branch `claude/rem-nl-20261114`, base `5035ed96` (review records on top of origin/main `de640826`).
Code commits (in order): `589e0443` ISSUE-356, `1ee9278d` ISSUE-360, `ecc3403e` ISSUE-359. This README and `raw/`
are a docs-only commit after `ecc3403e`.

Host workspace: `/mnt/ssd/afldb-rem-nl-20261114` on streamanator (`W`). Isolated cluster port **55615** (stopped at the end).
Template DB `afldb_v2_remnl_tmpl_test` restored from the approved snapshot (ledger 118, matches 17056, fixtures 218,
receipts 5); working copy `afldb_v2_remnl_work_test`; every integration run used a fresh `create-db --template` copy.
No production or DEV read, no migration (R-6), no push, no `D:\dev\afldb` edit.

## 1. Findings

| Finding | Verdict | Evidence |
|---|---|---|
| 356(a) bare "least" read as max | **validated** | base probe: "least goals in a season" -> Pratt/Hudson 150 (the maximum); fixed: agg `min`, plan equal to the "fewest" form ("Alb Thomas and 17,502 other player-seasons - 0 goals (1897), tied", i.e. the zero floor, the same answer "fewest goals in a season" gives). `at least N` unchanged (400 corpus questions identical). |
| 356(b) ranked metric + marquee predicate | **validated** | base: "most goals in a showdown" -> Wayne Carey 727 (career goals of anyone who played in a showdown, explanation "Condition: X+ matches between two clubs"). Fixed: matchup scope, single-match -> "Tony Modra and 3 others - 7 goals (tied)"; plural -> "Taylor Walker - 56 goals". Independent SQL on the same DB (`sd-check.sh`, orgs 1 and 17): single-match max 7 with 4 holders, career-total max 56 with 1 holder. Marquee events (Anzac Day) decline (see decision 2). Participation wording unchanged ("players who played in 3 showdowns" -> 257 players, predicate kept). Also fixed: the explanation line now fills "X+" and names the parameters. |
| 356(c) "quarter" resolves to Quartermain | **validated** | base: `quarter->Don Quartermain, Allan Quartermain@1`, 0 goals tied. Fixed: "most goals in a quarter" / "in a half" decline (status none, resolver never consulted); "quartermain goals" and "most goals by quartermain" still resolve. |
| 360 SRCH-7 tie headline | **validated** | headline counted capped rows ("... and 24 others"). Fixed: "Alb Thomas and 17,502 other player-seasons ... tied"; uncapped (`and 2 others`) and top_n unchanged. |
| 360 SRCH-5 "Richmond v Carlton" link | **validated, amended** | link now carries `club_match=both` and Match Search honours it (exactly two clubs, bound parameters, default stays either-club). Amendment: head-to-head matches on club **slugs** (explicit club identity), not organisation lineage, so a lineage-wide count (the review's) differs for renamed clubs; see decision 4. |
| 359 SRCH-6 token validation / cap | **validated** | missing `scope` -> TypeError, string `seasonMin` -> PostgreSQL 22P02, both HTTP 500; now `{error:'invalid_plan'}`, never throws. Drill-down lists at most 500 most recent games, `total` stays the true count, page says "Showing the N most recent of T qualifying games". |

## 2. Tests (red then green)

Unit, no DB variables: `env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL node node_modules/vitest/vitest.mjs run tests/nl-parser.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts tests/query-intent.test.ts tests/match-spec.test.ts tests/unit/qualifying-matches-gate.test.ts`

- **Red** (new tests on unfixed `src/`, raw: `raw/unit-red.txt`): 6 files failed, `26 failed | 1024 passed (1050)`. Representative text:
  `expected { kind: 'max' } to deeply equal { kind: 'min' }` (the five "least" cases);
  `expected [ { ... } ] to deeply equal []` (showdown keeps a career predicate);
  `most goals on anzac day: expected 'plan' to be 'none'`;
  `expected [ 'resolvePlayer:quarter' ] to deeply equal []`;
  `Expected: "Player 1 and 4,320 other player-seasons - 0 goals (1897), tied" Received: "Player 1 and 24 others - 0 goals (1897), tied"`;
  `TypeError: Cannot read properties of undefined (reading 'length')` at `validatePlan src/search/nl/plan.ts:2243` (token without careerConditions) and `... reading 'organizationId'` at `plan.ts:2544`;
  `expected undefined to be 'both'` (match-spec); the query-intent link lacks `club_match=both`.
- **Green** at `ecc3403e`: `Test Files 6 passed (6), Tests 1050 passed (1050)` (`raw/unit-qual.txt`).
- **Integration** (oracle-independent, R-4: each asserts a relational invariant or an independent SQL over the same DB, never a snapshot literal):
  - `tests/integration/nl-answers-team-club.test.ts` "drilldown caps the listed rows and discloses the true total": rows <= limit, `total` equals the uncapped total, capped rows are the newest prefix. Oracle: the uncapped call. Red with the three query files unfixed: `AssertionError: expected 2721 to be 5`. Green.
  - `tests/integration/release-gates.test.ts` "club_match=both returns only the games between the two clubs": oracle is an independent `count(*)` over the two slugs. Red unfixed: `expected 5123 to be 270` (either-club count returned). Green.
  - Raw: `raw/int-red-*.txt`, `raw/int-qual-green-*.txt`.
- Existing suites (fresh DB copy each, checkout `ecc3403e`): `tests/integration/nl-*` -> `2 failed | 272 passed` (`nl-answers-relationships` `expected 660 to be 658`); `release-gates` -> 8 failed (snapshot-pinned: Brownlow 183, 261 players 268, 2026 provisional ...). **Both failure sets are identical on the unfixed base checkout `de640826`** (`raw/int-base-rel.txt`, `raw/int-base-rg.txt`): pre-existing, pinned to a rebuilt `afldb_test`, classified not relabelled.
- Whole DB-free suite (integration/nl-ui/e2e excluded), base vs fixed: both `Test Files 11 failed | 204 passed`, `Tests 107 failed`; passed 11739 -> 11779 (+40 new tests); **failing test ids identical** (`raw/allunit-*-failing-ids.txt`; python/tool-pipeline suites needing the Linux Python env, none NL).
- `tsc --noEmit` rc 0; eslint on changed files 0 errors, 7 warnings (none on lines this work added) (`raw/tsc-qual.txt`).

## 3. N-1 corpus diff (same DB copy, V5 corpus sha256 `f8a7f42a...bff`, 12,000 questions)

| run | parse-only | parse + execute |
|---|---|---|
| unfixed v67 | 12000 pass / 0 soft / 0 fail | 11997 pass / 3 fail (3 WRONG_VERIFIED_ANSWER, the known ISSUE-219), noResults 2049, errors 0 |
| fixed v68 | 12000 / 0 / 0 | 11997 / 3 (same), noResults 2049, errors 0 |

Per-question diff of status, plan, confidence, unsupported terms, lead name/value, total and tie count: **0 of 12,000
changed in both modes** (`raw/corpus-diff-*.jsonl` empty). Classification: nothing intended, nothing regressed. The
corpus simply does not exercise the defects: it holds 0 bare "least" (400 "at least", all unchanged), 0
showdown/Anzac questions, and its "quarter" rows are "three quarter time" (club grain, unchanged). The three changes are therefore
proved by the targeted probes and tests above, not by the corpus. Raw results stay on the host with sha256:
base parse `9350aa89...306d`, fixed parse `96ea9588...a466`, base exec `59ad9cfc...f5eb`, fixed exec `458bef6f...c127`
(under `W/evidence/corpus-{base,fix1}/`). The 12,000-question execute ran under `flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3`.

## 4. Qualification checkout

`W/qual` is a fresh clone with the three commits fetched from `W/in/nl-code.bundle` (sha256 `e9237078...f6b`):
`git rev-parse HEAD` = `ecc3403e4a0f623e17a12f9a7a6e3fcdbdf24298`, `git status --porcelain` empty (before and after the
tsc run). `src/` and `tests/` were also diffed equal to the dirty `W/cand` tree the corpus ran on (only a
`tests/python/__pycache__` differs). The README commit changes docs only; the focused unit suite was re-run at the final HEAD (see the worker report).

## 5. Decisions for the owner

1. **describePlan parameter rendering** is limited to the marquee/rivalry builder group; rendering parameters for every builder would
   change the pinned E-D5 label-only test (`tests/nl-plan.test.ts` ~1188-1197). Recommend leaving as is.
2. **Marquee events in ranked reads** (Anzac Day etc.) decline: the plan grammar cannot rank within an event. Option: per-match event scope. Recommend deferring.
3. **Tie headline when capped** counts rows (performances / player-seasons), not distinct holders. Distinct holders would need a second query. Recommend leaving.
4. **Head-to-head uses club slugs**, not organisation lineage ("south melbourne v carlton" differs from an organisation-wide count). Option: switch to organisation ids. Recommend organisation ids if lineage reads are wanted; change is confined to `src/db/queries/match-search.ts`.
5. **UI**: `/match-search` gains a "Two clubs" select and a head-to-head note; the qualifying-matches page gains a cap note. **VISUAL: UNVERIFIED** (no build or Playwright permitted to this worker).
6. `NON_PLAYER_NAME_WORDS` (quarter, half, term, ... ) refuses a span made only of those words even if a player were so named.
7. "least X" now returns the zero floor for counting stats (as "fewest" already did); that is correct but noisy. Recommend no change.
8. Commits end with the protocol line `Co-Authored-By: Claude Opus 5.5` although the session attribution reminder names Sonnet 5.5; the protocol text was followed.

## 6. Files outside the strict `src/search/nl/**` + `src/search/query-intent.ts` list (finding scope)

`src/db/queries/nl/answer.ts`, `src/db/queries/nl/team-match.ts`, `src/search/match-spec.ts`, `src/db/queries/match-search.ts`,
`src/app/match-search/page.tsx`, `src/app/search/qualifying-matches/page.tsx`; tests `tests/query-intent.test.ts` (one pinned
href updated to include `club_match=both`: that expectation encoded the defect), `tests/match-spec.test.ts`,
`tests/unit/qualifying-matches-gate.test.ts`, `tests/integration/nl-answers-team-club.test.ts`, `tests/integration/release-gates.test.ts`.
