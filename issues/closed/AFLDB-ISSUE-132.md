# AFLDB-ISSUE-132 — Wildcard Final visibility on the public and admin UI

**Status:** Resolved 2026-09-03 — **no application change required.** Stage 2 regression
coverage (T1-T5, T6, T6b) is GREEN on the focused runs; `npx tsc --noEmit -p tsconfig.json`
is GREEN; the §4.3 command-3 red was dispositioned by the operator as the pre-existing
ISSUE-129 Windows CRLF checkout artefact it is (§6, §10). The runbook contract (§0, §4) is
fully satisfied. Closeout is on `claude/issue-132`, **uncommitted**. The production/runtime
discrepancy the operator flagged is recorded as a separate, not-started investigation in
**§11** and was deliberately not investigated here.
**Severity:** Medium — user-visible correctness of the first 2026 Wildcard Final rows on
every public surface, and the admin tooling that maintains them.
**Area:** Frontend/UI / Admin / Search / Tests
**Branch / worktree:** `claude/issue-132` — `D:\dev\afldb-issue-132`
**Migration:** none. No schema change is needed or proposed.
**Related:** `AFLDB-ISSUE-129` (the semantics this issue verifies at the UI — resolved,
merged, production-validated), `AFLDB-ISSUE-131` (rekey reconciliation — merged and
production-accepted; not touched here), `AFLDB-ISSUE-128` (source completeness).

---

## 0. Stage boundary and rules

Stage 1 is inspection and plan only. **No application code, test, migration, database,
Git or shell command was touched or run.** The only repository edits are this runbook and
the issue/index bookkeeping (§8).

Standing rules for every stage of this issue:

- ISSUE-129's semantics are the contract and are NOT reopened: `round_type =
  'wildcard_final'`, `is_final = true` (by `matches_is_final_ck`, unchanged),
  `is_finals_series = false` (generated column, migration `085`).
- Ordering contract: home-and-away first, then the Wildcard Final, then the traditional
  finals series.
- A Wildcard Final must never be counted as a traditional final anywhere that answers
  "did they play / win a final".
- The ladder, premiership points and Brownlow polling exclusions stay on `NOT is_final`
  and are not changed.
- Ingestion / rekey behaviour (ISSUE-122 / ISSUE-131) is out of scope unless a genuine
  blocker directly affects a UI surface. None was found.
- No refactors. No unrelated cleanup.

---

## 1. Context

Production holds **2 canonical 2026 `wildcard_final` matches and 0 duplicate fixtures**
(ISSUE-131 closeout). ISSUE-129 switched every affirmative finals consumer to
`is_finals_series` and proved the data layer (T1-T16), but its runbook explicitly deferred
a rendered-surface check. This issue is that check: every public and admin surface that
lists, labels, filters, orders or counts matches was traced from the route to its query.

---

## 2. Surface inventory and verdicts

Method: `Grep` for `is_final`, `is_finals_series`, `round_type`, `roundType`, `isFinal`,
`wildcard`, `finals` across `src/app`, `src/components`, `src/db/queries`, `src/search`
and `src/lib`, then a targeted read of each hit and its caller. AFLW surfaces are out of
scope (own `text` `round_type`, own CHECK — ISSUE-129 §9).

### 2.1 Public

| # | Surface | Path → query | What it does with a Wildcard Final | Verdict |
|---|---|---|---|---|
| P1 | Season page, Matches section | `src/app/seasons/[year]/page.tsx:128-134,648-668` → `getSeasonMatches` (`src/db/queries/matches.ts:23-39`) | Rows come back `ORDER BY m.match_date, m.id`; the page groups them by the `formatRound()` label in first-seen order, so the section order is chronological. The WF renders as its own "Wildcard Final" block with anchor id `wildcard-final`. The "Ladder after …" sub-table is emitted only for `roundType === 'home_and_away'`, so no ladder is claimed after the WF (the ladder after the last H&A round is the final H&A ladder). | **Visible, correctly labelled, correctly ordered.** There is no round-type rank anywhere — ordering is chronology, exactly as it already is for EF/QF/SF/PF/GF. The 2026 WF (28-29 Aug) sits after the last H&A round and before finals week 1, so H&A → WF → finals holds. Pinned by Stage 2 T1. |
| P2 | Season page in-progress notice | `seasons/[year]/page.tsx:798` ← `seasons.last_loaded_round` (`player-derived.ts:546-552`, the latest match's `round_code`) | Reads "(round WF)" while the WF is the latest loaded match. | **Cosmetic only, pre-existing shape** — it reads "(round GF)" for a grand final today. Observation O2, not changed. |
| P3 | Match page | `src/app/matches/[id]/page.tsx:55,68-69,92` → `getMatch` | Title/description/heading use `formatRound` → "Wildcard Final". Brownlow column appears only when a player row carries votes; a WF carries none. | **OK.** Label pinned by `tests/format.test.ts:92-94` (ISSUE-129). |
| P4 | Match Search | `src/app/match-search/page.tsx:187-192` → `MATCH_TYPES` (`src/search/match-spec.ts:70-78`) → `runMatchSearch` (`src/db/queries/match-search.ts:84-92`) | Select offers `Any match / Home-and-away / Finals only / Wildcard Final only`. `finals` → `m.is_finals_series` (WF excluded); `home_and_away` → `NOT m.is_final` (WF excluded); `wildcard_final` → `m.round_type = 'wildcard_final'`. Sorts are date / margin / score only (`MATCH_SORTS`) — no round-type ordering. | **OK.** Filter semantics pinned by Stage 2 T2. |
| P5 | Site search, round queries | `src/db/queries/search.ts:232-291` `searchRounds` | `FINALS_QUERY_RE` accepts "wildcard final" (with or without a year) and returns a `round` result with slug `YYYY#wildcard-final` — the same anchor P1 emits. "round N YYYY" stays `round_type = 'home_and_away'` so a WF can never be mistaken for a numbered round. | **OK.** Slug ↔ anchor agreement pinned by Stage 2 T3. |
| P6 | Player page + match log | `src/app/players/[slug]/page.tsx:658,748`, `players/[slug]/matches/page.tsx:145` → `getPlayerMatches` (`src/db/queries/players.ts:615-653`) | Rows pass `roundType` through to `formatRoundShort` → "WF". The `finals` headline figure is `player_career_stats.finals`, built from `is_finals_series` (`player-derived.ts:105,168,244`). | **OK.** Career figure already pinned by ISSUE-129 T9; the rendered row pinned by Stage 2 T4. |
| P7 | Player match-log sort by round | `players.ts:592` `rd: 'm.round_number'` | A WF has `round_number NULL`, so under "sort by round" it sits with the finals in the `NULLS LAST` tail (then by date desc). | **Pre-existing behaviour for every final; not WF-specific.** Observation O3, not changed. |
| P8 | Records | `src/db/queries/records.ts:69-70,148` `most-finals` → `c.finals` | Career finals, so `is_finals_series`. | **OK** (inherits ISSUE-129). |
| P9 | Club page | `src/db/queries/clubs.ts:224,244,292` `finals_played` / `finalsAppearances` from `club_seasons` | `recomputeClubSeasons` counts `is_finals_series` (`player-derived.ts:500-508`). | **OK.** Pinned by ISSUE-129 T10 / T11 (`nl-answers-team-club`). |
| P10 | Home page recent / vault | `src/app/page.tsx:136` → `getRecentMatches`, `getVaultMeetings` | Pass-through label. | **OK.** |
| P11 | Query Builder | `src/search/query-builder-spec.ts:233-237,357-361,536-540` | `round_type` (text), `is_final` labelled "Not home-and-away", `is_finals_series` labelled "Finals series". | **OK** (ISSUE-129 D-class decision already implemented). |
| P12 | NL search + answer rendering | `src/search/nl/vocab.ts`, `plan.ts`; `src/components/NlAnswerSection.tsx:121,332,427` | `wildcard_final` is its own `NlMatchType`; bare "finals" = `is_finals_series`; rendering is `formatRoundShort` pass-through. | **OK.** Pinned by `tests/nl-parser.test.ts:236`. |
| P13 | Grid Solver | `src/db/queries/grid-solver.ts` | Every finals criterion reads `is_finals_series`. | **OK.** Pinned by `tests/integration/grid-solver.test.ts:640`. |
| P14 | Structured data, sitemap, seasons index | `src/lib/structured-data.ts`, `src/app/sitemap.ts`, `src/app/seasons/page.tsx` | No round-type usage. | **N/A.** |

### 2.2 Admin

| # | Surface | Path → query | What it does with a Wildcard Final | Verdict |
|---|---|---|---|---|
| A1 | Data editor match browser | `src/app/admin/data-editor/MatchBrowser.tsx:166` → `searchAdminMatches` (`src/db/queries/match-admin.ts:51-99`) | Lists every match of a season/club/text query, `ORDER BY match_date DESC`; label "WF"; `roundCode` `WF`. The optional `roundNumber` filter excludes it exactly as it excludes every final. No round-type filter exists. | **Visible.** Pinned by Stage 2 T5. |
| A2 | Match sheet editor | `MatchSheetEditor.tsx:530,690` → `saveMatchSheet` (`src/db/queries/match-sheet.ts:63-87`) | Label pass-through. Brownlow votes are refused when `is_final` is true, so a WF cannot receive votes — the Brownlow exclusion is preserved on the admin write path. | **OK.** Pinned by Stage 2 T6. Message wording is observation O1. |
| A3 | Create match form / server action | `CreateMatchForm.tsx:143`, `data-editor/actions.ts:546`, `match-admin.ts:103,155` | `wildcard_final` selectable, defaults `round_code` to `WF`, `round_number` NULL. | **OK.** Pinned by ISSUE-129 T14 (`tests/admin-match-mutations.test.ts`). |
| A4 | `/admin/current-season` | `src/app/admin/current-season/*` | Renders settle counters only; no round rendering. | **N/A.** |

### 2.3 Query code that still reads `is_final` — all correct as exclusions

`rounds.ts:56,67` (round ladder, `round_type = 'home_and_away'`), `search.ts:251,310`
(numbered-round lookups), `player-derived.ts:416-443` (season Brownlow / ladder scoping),
`match-search.ts:89` (`home_and_away` filter), `match-sheet.ts:85` (Brownlow refusal),
`db-health.ts:249` (parity check on `is_finals_series`). Each is an exclusion that a
Wildcard Final is meant to fall on the excluded side of. **No site was found that uses
`is_final` affirmatively as "played a final".** The cross-cutting guard is already
`tests/finals-semantics-contract.test.ts`.

---

## 3. Findings

**No defect was found on any inspected public or admin surface.** The Wildcard Final is
visible, labelled "Wildcard Final" / "WF", ordered chronologically between the last
home-and-away round and the finals series, excluded from every finals count, every
"finals only" filter and every finals criterion, and excluded from the ladder,
premiership points and Brownlow polling. ISSUE-129 implemented every UI-facing decision
(D1-D4) and this pass confirms them from the route down.

What is missing is **regression coverage at the query surfaces the pages actually
call** — ISSUE-129 pinned the derived aggregates, the solver and NL, but not
`getSeasonMatches` ordering/grouping, `runMatchSearch`'s four match types,
`searchRounds`' anchor agreement, `getPlayerMatches`, `searchAdminMatches` or the
`saveMatchSheet` Brownlow refusal on a WF row. Stage 2 adds exactly those.

### Observations recorded, deliberately NOT changed (CLAUDE.md §13 scope)

- **O1** `src/db/queries/match-sheet.ts:86` — the refusal text "Brownlow votes cannot be
  recorded for finals." is behaviourally correct for a WF but names a match that is not a
  finals-series match. Wording only.
- **O2** `src/app/seasons/[year]/page.tsx:798` — "(round WF)" from `last_loaded_round`;
  same shape as "(round GF)" today. Wording only.
- **O3** `src/db/queries/players.ts:592` — "sort by round" places a WF in the NULL-round
  tail with the finals. Pre-existing for every final; not a wildcard assumption.

Any of the three can be adopted into Stage 2 by explicit operator instruction; none is
required by this issue's contract and none is a defect.

---

## 4. Stage 2 plan — regression tests only

No production code change is planned. If a test written to the §0 contract goes RED,
that is a finding to report, not a test to weaken.

### 4.1 Fixture

Reuse `tests/integration/wildcard-final-fixture.ts` (`seedWildcardFinalSeason`) — one H&A
round (A def B, C def D), a WF (A def B) and an EF (A def C), with `wildcardOnlyPlayerId`
and `finalsSeriesPlayerId`. Its shape already proves the ordering contract by date
(`03-05`, `03-06`, `08-28`, `09-04`).

Reserved fixture seasons in use: 2086, 2090-2099. **ISSUE-132 claims 2087
(`database.test.ts`) and 2088 (`data-editor.test.ts`)** so the two files stay
parallel-safe; the fixture file's season comment is updated to say so.

### 4.2 Tests — extend existing suites, no new file

**`tests/integration/database.test.ts`** — new describe
`AFLDB-ISSUE-132 wildcard final visibility (public and admin query surfaces)`, fixture
season 2087:

| # | Test | Asserts |
|---|---|---|
| T1 | `getSeasonMatches` orders H&A → WF → finals and groups like the season page | 4 rows in order `home_and_away, home_and_away, wildcard_final, elimination_final`; grouping by `formatRound()` in first-seen order yields exactly `['Round 1', 'Wildcard Final', 'Elimination Final']`; the WF group's anchor (`label.toLowerCase().replace(/\s+/g,'-')`) is `wildcard-final`. |
| T2 | `runMatchSearch` match types | With a `season` range filter pinned to the fixture: `all` → 4; `home_and_away` → 2 (no WF); `finals` → 1, the EF only; `wildcard_final` → 1, the WF only. |
| T3 | `searchRounds` anchor agreement | `'2087 wildcard final'` → one `round` result, slug `2087#wildcard-final`, title `Wildcard Final, 2087`; `'wildcard final 2087'` identical; `'round 1 2087'` → `2 matches` and unaffected by the WF. |
| T4 | `getPlayerMatches` for the wildcard-only player | one row, `roundType 'wildcard_final'`, `roundNumber null`, `formatRoundShort` → `'WF'`. |
| T5 | `searchAdminMatches` | `{ season }` → 4 rows including the WF with `roundCode 'WF'`; `{ season, roundNumber: 1 }` → 2 rows, WF absent. |

**`tests/integration/data-editor.test.ts`** — new describe
`AFLDB-ISSUE-132 wildcard final on the admin match sheet`, fixture season 2088:

| # | Test | Asserts |
|---|---|---|
| T6 | Brownlow votes are refused on a Wildcard Final | `saveMatchSheet` on `wildcardMatchId` with a player row carrying `brownlowVotes` is refused (`ok: false`, message contains "Brownlow votes cannot be recorded"), and the row's `player_match_stats.brownlow_votes` stays NULL. |

### 4.3 Verification (operator-run, smallest first)

```
npx vitest run tests/integration/database.test.ts -t "AFLDB-ISSUE-132"
npx vitest run tests/integration/data-editor.test.ts -t "AFLDB-ISSUE-132"
npx vitest run tests/integration/database.test.ts tests/integration/data-editor.test.ts tests/finals-semantics-contract.test.ts tests/format.test.ts
npx tsc --noEmit -p tsconfig.json
```

Prerequisites in this worktree: `node_modules` junction from a sibling worktree and a
local `.env` carrying `AFLDB_TEST_DATABASE_URL` (both gitignored). `afldb_test` must be at
migration `085` or later (it is — ISSUE-129/131 validated there).

### 4.4 Not planned

- No browser/E2E case: the E2E database is not guaranteed to hold a `wildcard_final`
  row, and a fixture-seeded E2E would need infrastructure this issue does not own.
- No `CHANGELOG.md` entry unless Stage 2 changes application behaviour (it is not expected
  to).
- No production or dev database access.

---

## 5. Risks

1. **Ordering is chronological, not typed.** If a future season ever scheduled a Wildcard
   Final on the same weekend as a home-and-away round (interleaved dates), the season page
   would interleave the groups too. That is the existing behaviour for every round and is
   not a 2026 concern; T1 pins the contract on the fixture's dates. A typed sort would be
   a product decision, not a fix.
2. **T6 requires `saveMatchSheet`'s refusal to fire before any write.** It does
   (`match-sheet.ts:84-87` runs before the player loop writes). If a future change moves
   the check, T6 goes RED for the right reason.

---

## 6. Evidence status

| Item | Status |
|---|---|
| Surface inventory (§2) | Complete from the repository, 2026-09-03. |
| §4.3 command 1 — `npx vitest run tests/integration/database.test.ts -t "AFLDB-ISSUE-132"` | **GREEN 2026-09-03** (vitest 4.1.10, `afldb_test`): `Tests 5 passed \| 41 skipped (46)`, 5.09s. T1-T5 all pass: season ordering/grouping/anchor, the four match-search types, `searchRounds` slug ↔ page anchor agreement, the player match-log WF row, admin match-list visibility and round-number exclusion. |
| §4.3 command 2 — `npx vitest run tests/integration/data-editor.test.ts -t "AFLDB-ISSUE-132"` (first run, original T6) | **RED 2026-09-03** (superseded): `Tests 1 failed \| 9 skipped (10)`. T6 failed at the message assertion. Expected the error to contain `Brownlow votes cannot be recorded`; received `A recorded Brownlow allocation requires exactly one player with 3 votes, one with 2, and one with 1.` Cause (from code, not inferred): `saveMatchSheet` calls `validateMatchSheetPayload` before opening any connection (`src/db/queries/match-sheet.ts:34-38`), and that validator requires a complete 3-2-1 Brownlow allocation across the submitted rows (`src/lib/match-sheet.ts:176-186`). T6 submitted a single row with `brownlowVotes: 3`, so it was refused by the validator and the transaction carrying the `is_final` refusal (`match-sheet.ts:84-87`) was never entered. **Test-design error in T6's payload, not an application defect.** Corrected in the second pass (next row). |
| §4.3 command 2 — same command, amended T6 + new T6b | **GREEN 2026-09-03** (vitest 4.1.10, `afldb_test`, this worktree's own `node_modules` from `npm ci`, 419 packages): `Tests 2 passed \| 9 skipped (11)`, 5.46s. **T6** now submits a complete 3-2-1 allocation (`wildcardOnlyPlayerId` 3 votes + a kick edit on `wildcardWinnerClubId`, `finalsSeriesPlayerId` 2 votes on `wildcardWinnerClubId`, one existing player id picked by query 1 vote on `wildcardLoserClubId`) and is refused with `Brownlow votes cannot be recorded for finals.` — the `is_final` refusal at `match-sheet.ts:84-87` is now what fires, and the no-write assertions (votes NULL, kicks unchanged, no `data_edits` row for the match) all pass. **T6b** retains the original single-row payload as a separate assertion that `validateMatchSheetPayload` refuses a partial allocation pre-write with the `requires exactly one player with 3 votes, one with 2, and one with 1` message and the same no-write assertions. |
| §4.3 command 3 — `npx vitest run tests/integration/database.test.ts tests/integration/data-editor.test.ts tests/finals-semantics-contract.test.ts tests/format.test.ts` | **RED 2026-09-03 for an environment reason outside ISSUE-132**: `Test Files 1 failed \| 3 passed (4)`, `Tests 1 failed \| 99 passed \| 6 skipped (106)`, 25.73s. `database.test.ts`, `data-editor.test.ts` and `format.test.ts` all passed in full (the 6 skips are the pre-existing conditional import-role-parity skips). The single failure is the **pre-existing ISSUE-129** test `tests/finals-semantics-contract.test.ts:49-60` "adds the enum value in its own migration": `expected [ Array(1) ] to deeply equal [ Array(1) ]` with the expected and received statements printing identically. Verified cause: this worktree has `core.autocrlf=true` and `git ls-files --eol` reports `i/lf w/crlf` for both `src/db/migrations/084_round_type_wildcard_final.sql` and the test file (`file` confirms "CRLF line terminators"; `od -c` shows `\r\n`); the test splits the migration on bare `\n` (`.split('\n')`, line 55) so the retained statement carries a trailing `\r` and `toEqual` fails. The repository content (index) is LF; the failure is a Windows checkout artefact and would not occur on the Linux runtime (CLAUDE.md §11: Windows inspection does not prove Linux behaviour). **Not an application defect, not caused by any ISSUE-132 change** (no ISSUE-132 edit touches migration 084 or the contract test), and not evidence that Stage 2's own tests are wrong. No file was changed in response. **Operator disposition 2026-09-03 (§7 option (a)):** the failing assertion is accepted as a Windows CRLF artefact. The ISSUE-129 test, migration `084`, Git configuration and line-ending behaviour are **not** modified under ISSUE-132. ISSUE-132's own regression coverage is treated as GREEN on the focused runs (commands 1 and 2) together with the combined run's 99 passes across the three other files; the unrelated artefact is recorded here explicitly and closes nothing else. |
| §4.3 command 4 — `npx tsc --noEmit -p tsconfig.json` | **GREEN 2026-09-03**: exit code 0, no diagnostics, run in this worktree against its own `node_modules` after the operator's command-3 disposition. The seven new test imports and the two new describes typecheck cleanly. |
| Existing ISSUE-129 coverage relied on | `tests/format.test.ts:92`, `tests/integration/database.test.ts:501`, `tests/integration/grid-solver.test.ts:640`, `tests/integration/nl-answers-team-club.test.ts:472`, `tests/nl-parser.test.ts:236`, `tests/admin-match-mutations.test.ts` (T14), `tests/finals-semantics-contract.test.ts`. All last reported GREEN in ISSUE-129 §17 / ISSUE-131 §14.8. |

---

## 7. Exact next action

**None under ISSUE-132 — the issue is resolved (§10).** The operator's 2026-09-03 decision on
the command-3 red took option (a) below; options (b) and the `core.autocrlf` prohibition are
retained for the record only. The only outstanding work is the **separate** production/runtime
discrepancy investigation whose starting point is recorded in **§11**; it is not ISSUE-132 work
and must not be started under this issue.

Record of the decision as it was put (2026-09-03):

1. Command-3 red — options offered, **(a) taken**:
   - (a) Accept the Windows artefact as such and treat command 3 as satisfied by the three
     passing files plus the contract test's own GREEN record on Linux (its supported
     runtime). **Taken.** The ISSUE-129 test, migration 084, Git config and line-ending
     behaviour were not modified.
   - (b) Harden `tests/finals-semantics-contract.test.ts:55` to split on `/\r?\n/`. **Not
     taken** (scope widening; would need its own instruction and possibly its own tracked
     issue for "contract tests are CRLF-sensitive on Windows checkouts").
   - `core.autocrlf` / re-normalisation: **not done**, as required.
2. §4.3 command 4 — **run, GREEN** (§6).
3. Resolution — **done**: §6, §9, §10, `issues.md`, `IssuesIndex.md` updated; runbook moved to
   `issues/closed/`. Nothing committed (operator instruction).

## 8. Stage 1 record

Repository files changed by Stage 1:

- `issues/open/AFLDB-ISSUE-132.md` — this runbook (new).
- `issues.md` — new ledger entry, Open Issues row, open-count line and allocation note.
- `IssuesIndex.md` — new index row, open-count line and allocation note.

No `CHANGELOG.md` entry (investigation only). No shell, Git, SQL, SSH, build, test or
deployment command was executed. No other worktree was inspected.

---

## 9. Stage 2 record (complete, 2026-09-03)

Repository files changed by Stage 2 (all uncommitted):

- `tests/integration/database.test.ts` — seven imports added
  (`searchAdminMatches`, `runMatchSearch`, `getSeasonMatches`, `getPlayerMatches`,
  `searchRounds`, `formatRound`/`formatRoundShort`, `MatchType`); new describe
  `AFLDB-ISSUE-132 wildcard final visibility (public and admin query surfaces)` with
  T1-T5 on fixture season **2087**.
- `tests/integration/data-editor.test.ts` — fixture import; one `TEST_NOTES` entry
  (`issue-132 wildcard brownlow refusal`); new describe
  `AFLDB-ISSUE-132 wildcard final on the admin match sheet` on fixture season **2088**
  with **T6** (complete 3-2-1 allocation → `is_final` refusal, no write) and **T6b**
  (single-row partial allocation → `validateMatchSheetPayload` refusal, no write). The
  describe's `beforeAll` also picks one existing `players.id` (excluding the two fixture
  players) for T6's third voted row and throws if none exists. Shared `readRow` /
  `expectNothingWritten` helpers inside the describe. Both GREEN (§6).
- `tests/integration/wildcard-final-fixture.ts` — season-claim comment only (2087 /
  2088 recorded).
- `issues/closed/AFLDB-ISSUE-132.md` — this runbook (status, §6, §7, §9, §10, §11), moved
  from `issues/open/` at closeout.
- `issues.md` — ISSUE-132 entry resolved (Stage 2, Resolution, Follow-up); Open Issues row
  removed; open-count line and allocation note updated.
- `IssuesIndex.md` — ISSUE-132 row removed; open-count line and allocation note updated.

**No application code was changed.** No `CHANGELOG.md` entry (tests only; no behaviour
change — §4.4). No observation (O1-O3) adopted. `tests/finals-semantics-contract.test.ts`
and migration 084 were **not** edited despite the command-3 red (§6, §7, operator
disposition).

Commands executed (operator-authorised for this stage), second pass 2026-09-03: `npm ci`
in this worktree (exit 0, 419 packages, no links to any other worktree); §4.3 command 2
(GREEN); §4.3 command 3 (RED, environment — §6); read-only diagnosis of that red (`file`,
`od -c`, `git config core.autocrlf`, `git ls-files --eol` on the two files involved).
Third pass (closeout) 2026-09-03: §4.3 command 4 (`npx tsc --noEmit -p tsconfig.json`,
GREEN, exit 0); read-only `git status --short` to confirm the changed-file list in §10. No
SQL, SSH, build, deployment or state-changing Git command was executed in any pass. No other
worktree was inspected. Nothing committed.

Local, gitignored, non-repository setup: a `.env` copy carrying `AFLDB_TEST_DATABASE_URL`
(`tests/setup.ts` loads it) and this worktree's own `node_modules`. Both fixture seasons
(2087, 2088) ran their `afterAll` cleanup in the passing/finished runs and are not expected
to be left behind in `afldb_test`; confirm with a count if a later seed refuses to run.

---

## 10. Closeout — Resolved 2026-09-03, no application change required

**Root cause:** none — there was no defect. ISSUE-129 already implemented every UI-facing
decision (D1-D4) for the Wildcard Final; this issue verified that from every public and admin
route down to its query (§2) and found no surface that mislabels, misorders, miscounts or
hides a `wildcard_final` row, and no `is_final` reader used affirmatively as "played a
final" (§2.3).

**Fix:** none to the application. What was missing was regression coverage at the query
surfaces the pages actually call; Stage 2 added it by extending two existing integration
suites (§4.2, §9): `getSeasonMatches` ordering/grouping/anchor (T1), the four
`runMatchSearch` match types (T2), `searchRounds` slug ↔ season-page anchor (T3), the
player match-log WF row (T4), `searchAdminMatches` visibility and round-number exclusion
(T5), and the `saveMatchSheet` Brownlow refusal on a WF with a complete 3-2-1 allocation (T6)
plus the pre-write validator refusal on a partial allocation (T6b).

**Validation (§6):** command 1 GREEN (5 passed), command 2 GREEN (2 passed), command 3
99 passed / 1 failed where the single failure is the pre-existing ISSUE-129 contract test
on this Windows CRLF checkout — operator-dispositioned as an environment artefact outside
ISSUE-132 — and command 4 (`tsc --noEmit`) GREEN. Linux is the supported runtime; the
contract test's own GREEN record there (ISSUE-129 §17 / ISSUE-131 §14.8) stands.

**Contract check against §0:** semantics unchanged (`round_type = 'wildcard_final'`,
`is_final = true`, `is_finals_series = false`); ordering H&A → WF → finals pinned (T1); WF
never counted as a traditional final (T2 `finals`, T4/T5 label and filter paths, ISSUE-129
aggregates); ladder / premiership / Brownlow exclusions untouched and the admin Brownlow
refusal pinned (T6); no ingestion/rekey change; no refactor; no migration. **Fully
satisfied.**

**Repository files changed by this issue in total (uncommitted on `claude/issue-132`):**
`tests/integration/database.test.ts`, `tests/integration/data-editor.test.ts`,
`tests/integration/wildcard-final-fixture.ts` (comment only), `issues/closed/AFLDB-ISSUE-132.md`
(new; was `issues/open/`), `issues.md`, `IssuesIndex.md`. No `CHANGELOG.md` entry.

**Not done, by design:** observations O1-O3 (§3) remain unadopted wording/behaviour notes;
no browser/E2E case (§4.4); no change to the ISSUE-129 contract test, migration 084 or Git
line-ending configuration.

---

## 11. Handoff — separate production/runtime discrepancy investigation (NOT started)

**Recorded 2026-09-03 at the operator's instruction. No evidence for this has been gathered
under ISSUE-132 and nothing below was investigated here.** It is the exact starting point for
a fresh session and a new issue; allocate **`AFLDB-ISSUE-133`** (next free ID per
`IssuesIndex.md`) when it opens.

**The discrepancy as reported:** production (`afldb-prod` / `afldb_prod`) currently holds
**two canonical 2026 `wildcard_final` matches** (ISSUE-131 closeout: 2 canonical, 0 duplicate
fixtures), yet the **public season UI observed in production did not show them**, even though
the repository's query and render paths (§2, P1) and the Stage 2 regression tests (T1-T5)
demonstrate that those paths list, label and order a Wildcard Final correctly against the
`afldb_test` fixture.

**What ISSUE-132 establishes, and therefore what the new investigation can take as given:**

- On the repository at `claude/issue-132` (and on the ISSUE-129/131 code it inherits),
  `getSeasonMatches` returns `wildcard_final` rows chronologically and the season page groups
  them into a "Wildcard Final" block with anchor `wildcard-final` (§2 P1, T1 GREEN).
- Match Search, site search, player match log and the admin browser all surface a WF row
  (T2-T5 GREEN). None of these was observed in production under this issue.
- Therefore the discrepancy is **not** explained by the repository's query/render code as
  it exists on this branch. The gap lies between that code and what production served.

**Starting point — establish these facts, read-only, before forming any hypothesis:**

1. **Pin the observation.** Which URL was observed (expected `/seasons/2026`), when, by whom,
   logged in or anonymous, and what exactly was seen: no "Wildcard Final" heading at all, the
   two matches missing from every group, or the two matches present under a different label.
   Capture a screenshot or saved HTML if it can be reproduced.
2. **Pin the deployed revision.** On `afldb-prod`, the commit the running service was built
   from versus `origin/main`, and whether that revision contains ISSUE-129 (migration `084`
   round-type enum value, `085` `is_finals_series`, `formatRound` "Wildcard Final") and the
   ISSUE-131 rekey reconciliation. A build older than ISSUE-129 cannot label a WF and may not
   even receive the rows (the enum value would not exist in its migrations — but see 3).
3. **Pin the data as served.** Read-only against `afldb_prod`, limited to season 2026:
   `id, season, round_type, round_code, round_number, match_date, is_final, is_finals_series,
   home/away club, source_record_id` for the two `wildcard_final` rows, plus
   `seasons.last_loaded_round` for 2026 and the count of 2026 rows per `round_type`. Confirm
   the two rows are the ones the page should show and that nothing about them (e.g. a NULL
   `match_date`, a season mismatch) would drop them from `getSeasonMatches`' `WHERE`/`ORDER BY`.
4. **Pin the render path in production.** Whether `/seasons/2026` is statically cached /
   revalidated in the deployed Next.js build (a `revalidate` / `dynamic` export on
   `src/app/seasons/[year]/page.tsx` or an ISR/fetch cache) such that a page rendered before the
   ISSUE-131 settle could still be served afterwards. Compare the page's rendered HTML with a
   fresh server render (e.g. a cache-busting request or an admin-only uncached route if one
   exists) rather than reasoning about it.
5. **Only then** classify: stale deploy, stale cache, data-shape mismatch, or a genuine
   render defect not reproduced by T1. If it is a genuine defect, it is a new issue with its
   own runbook; ISSUE-132 is not reopened unless T1's fixture is shown to differ materially from
   the production rows.

**Constraints carried over:** no production write, settle, migration or cache purge until
the fact-finding above is complete and the operator accepts a plan; all production access is
read-only and operator-executed (CLAUDE.md §9, §11); `afldb-settle-afltables.timer` state is
governed by the ISSUE-131 closeout and is not to be changed by this investigation.
