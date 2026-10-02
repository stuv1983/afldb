# AFLDB Code Review

Review and defect-bookkeeping pass only. No fix was implemented, no runtime behaviour changed, and
nothing was staged or committed.

## 1. Review baseline

- **Review date:** 2026-10-02.
- **Checkout:** `D:\dev\afldb`.
- **Branch:** `main`.
- **HEAD:** `1c1a48053480513fd885e00cab6ecbf39e38e2bc` (`1c1a4805`).
- **origin/main:** `1c1a48053480513fd885e00cab6ecbf39e38e2bc`; `main...origin/main` is 0 ahead, 0 behind.
- **Worktrees:** exactly one, `D:/dev/afldb [main]`.
- **Tracked working tree at the start:** clean.
- **Untracked at the start:** the seven known evidence PNGs only (`admin-settings.png`,
  `player-links-post-reload.png`, `player-links-pre-recompute.png`, `smoke-aflw.png`,
  `smoke-player-dustin-martin.png`, `smoke-search.png`, `smoke-season-2025.png`). Not touched.
- **Local branches other than `main`:** sixteen `archive/*` branches (historical, not touched), and
  six older non-archive branches: `dev` and one workflow branch (both merged into `main`), one
  `backup/*` branch, and three unmerged feature branches. Their last commits are dated 2026-08-19 to
  2026-09-19. None follows the `<agent>/issue-NNN` naming and none was treated as an active issue
  branch. The names are in the operator report for this pass.
- **Open issues at the start:** AFLDB-ISSUE-229 and AFLDB-ISSUE-233, as expected. `IssuesIndex.md`
  and `issues.md` both said 2.
- **`playbooks/issue.md`:** did not exist before this pass.

### 1.1 Working-tree anomaly observed during the pass

Seven zero-byte untracked files appeared in the repository root while the review was reading
source: `0`, `Done`, `manualAuthorityVerdict(snapshot`, `'display_name'`, `${Y}`, `({` and `{})`.

- Each name is the text that follows a `>` character in a source line that had just been read
  (for example `==> Done.` in `tools/maintenance/backup.sh`, and
  `=> manualAuthorityVerdict(snapshot, query)` in `src/lib/acquisition/manual-authority.ts`).
- Each file's timestamp matches the moment that source file was read. No review command names any
  of them, and the repository's own tool settings define no hook.
- The pattern is that of a workstation-level automation passing tool output through `cmd.exe` in the
  repository directory, where `>` becomes a redirect. That attribution is an inference; the
  automation itself was not inspected because it lives outside the repository.
- They were **left in place, not deleted, not staged**. They are not part of this review's output.
- Their later investigation and removal are recorded in §9.1.

## 2. Review scope

### 2.1 Areas inspected

| Boundary | Files read (whole, or the ranges that carry the logic) |
|---|---|
| Admin Data Editor → canonical rows → audit → revalidation | `src/app/admin/data-editor/actions.ts`, `MatchBrowser.tsx`, `page.tsx`; `src/db/queries/match-admin.ts`, `match-sheet.ts`, `data-edits.ts`; `src/lib/admin-match.ts`, `src/lib/edit/spec.ts` |
| Manual authority → automatic settle → canonical apply | `src/lib/acquisition/manual-authority.ts`; `canonical-apply.ts` (ownership, fresh-target read, unit apply, writers); `settle-afltables.ts` (proposed fields, invitation, record apply, outcome) |
| Settle chains and units | `deploy/afldb-settle-afltables.sh`, `afldb-settle-afl-api.sh`, `afldb-settle-afl-api-brownlow.sh`; the three `.service` units and `afldb-email-intake.service` |
| Post-settle and admin cache invalidation | `src/app/api/internal/revalidate-season/route.ts`, `src/lib/acquisition/season-revalidation.ts`, `src/lib/admin/revalidate-route.ts`, `src/app/admin/brownlow/actions.ts` (revalidation) |
| AFL API ingestion control and absence handling | `src/lib/acquisition/afl-api-ingestion-control.ts`, `afl-api-match-absence.ts` (contract and sweep), `src/app/admin/current-season/actions.ts` |
| Season rollover | `src/lib/rollover/season-rollover.ts` (`planSeasonRollover`) |
| Fixture lifecycle | `src/db/queries/admin-fixtures.ts` (round rendering, played resolution) |
| Legacy file intake | `src/lib/ingest/pipeline.ts`, `datasets.ts` (match results, player match stats, biography, attendance), `csv.ts`; `src/app/admin/submissions/[id]/actions.ts`; `src/app/api/admin/email-intake/route.ts` |
| NL search validate → compile → explain | `src/search/nl/plan.ts` (metric registry, period, club-scope and career guards, `describePlan`); `src/db/queries/nl/player-career.ts`, `player-season.ts`, `player-game.ts`; `src/db/queries/nl/answer.ts` and `src/components/NlAnswerSection.tsx` (use of the explanation) |
| Public season queries | `src/db/queries/seasons.ts`, `rounds.ts` |
| Administrator lifecycle | `src/db/queries/admin-users.ts` |
| Migrations, backup, restore, deployment | `tools/db/migrate.ts`, `tools/db/migration-safety.ts`, `tools/maintenance/backup.sh`, `restore-test.sh`, `deploy/sync-dev.ps1`, `deploy/sync-dev-remote.sh`, migration `062` |
| Reload replay | `tools/migration/common.py` (`replay_admin_overrides`, entry) |
| Tracking | `AGENTS.md`, `IssuesIndex.md`, the `issues.md` Open Issues table and the entries for ISSUE-086, 186, 229, 232, 255, 256; `issues/open/AFLDB-ISSUE-229.md` and `-233.md` (section structure); closed runbooks 086, 099, 122, 155, 159, 220, 238 (targeted) |

### 2.2 Commands run

- Read-only Git: branch, HEAD, `origin/main`, status, worktree list, branch list, ahead/behind,
  ancestry of `1111ab19`, history searches for issue IDs 257 and above, read of `git config`.
- Two DB-free witnesses, run with Node's built-in type stripping from a scratch directory outside the
  repository. They import repository modules, open no connection and write nothing:
  - the manual-authority, ownership and field-diff functions (F-001);
  - `parseNlQuestion` → `validatePlan` → `describePlan` with an in-memory club directory (F-003, F-004).

### 2.3 Validations considered but not run

- **TypeScript typecheck, ESLint and the DB-free Vitest suites.** `node_modules` in this checkout is an
  empty directory, so `tsc`, `eslint`, `vitest` and `tsx` are absent. Installing dependencies is a
  package-manager action outside this pass.
- **Every DB-backed test and tool** (`tests/integration/*`, settle, rebuild, promotion). Not run: the
  pass must not connect to or mutate `afldb_test`, `afldb_dev` or PROD.
- **Network acquisition.** Not run.

### 2.4 Areas deliberately not inspected

`tools/db/promotion-check.ts`, `promotion-inventory.ts`, `promotion-source-dependencies.ts` and
`rebuild-test.ts`; `src/lib/acquisition/settle-afl-api.ts`, `afl-api-adjudication.ts`,
`afl-api-brownlow.ts` and `afl-api-identity-correction.ts` beyond targeted lookups;
`src/db/queries/grid-solver.ts` and `src/search/grid-solver-spec.ts`; the NL parser beyond the two
executed probes; `src/db/queries/player-derived.ts`; awards, coaches, draft, season-list,
club-leadership and special-record administration; authentication and session code; public pages
other than the season queries; `tools/migration/*` importers other than the replay entry point;
AFLW. No defect-free claim is made for any of these.

## 3. Findings

### F-001 — Match Sheet edits to source-owned player statistics are reverted by the next automatic settle

- **Severity:** MEDIUM.
- **Confidence:** HIGH. Every gate was traced in source and the three deciding pure functions were
  executed. The end-to-end write was not run against a database.
- **AFLDB issue:** newly allocated **AFLDB-ISSUE-257**.
- **Existing issue search:** `IssuesIndex.md`; `issues.md` for `match_sheet`, `saveMatchSheet`,
  "match sheet" near "settle", "overwrit" and `data_overrides`; closed runbooks 086, 096, 099, 122,
  155, 159, 238, 255; `docs/`. Related history: ISSUE-086 (resolved; the same defect class for the
  generic editor, which listed the editable surface as `players`, `matches`, `draft_picks`),
  ISSUE-099 prerequisite A4, ISSUE-122 §8 (which declared A4 satisfied). None names the Match Sheet.
- **Affected path:** `/admin/data-editor` Match Sheet → `saveMatchSheet` → `player_match_stats`, then
  the nightly or on-demand `afldb-settle-afltables` unit.
- **Expected invariant:** an administrator's correction to a canonical fact is not silently replaced
  by an unattended source run. ISSUE-086 established this for the generic editor, and
  `canonical-apply.ts` states it as rule 1 ("an override an administrator commits ... must still be
  able to stop the write").
- **First wrong layer:** the manual-authority proof. `src/lib/acquisition/manual-authority.ts:108-110`
  and `:194-197` answer `clear` for `player_match_stats` on the ground that a human override for it
  is unrepresentable. The proof (`:259-276`) inspects only the `data_overrides` CHECK and
  `EDITABLE_ENTITIES`. The Match Sheet is a second human writer of that table and appears in neither.
- **Evidence:**
  - `src/db/queries/match-sheet.ts:106-137` upserts ten statistics, `club_id` and `jumper_number`.
    The column list does not include `source_id`, so an edited row keeps its source owner.
    `:98-104` deletes removed players. `:149-157` writes one `data_edits` row
    (`matches` / `match_sheet`) and no `data_overrides` row.
  - `src/lib/acquisition/settle-afltables.ts:308-314` proposes those same columns.
    `invitationFor` (`:2166-2197`) offers a `retry` whenever the source payload is unchanged but the
    canonical row differs from the proposal. `:2344-2356` computes the baseline hash from the row as
    read in the same run.
  - `src/lib/acquisition/canonical-apply.ts`: `autoApplyOwnership` (`:126-148`) answers `updateable`
    when the row's owner is the promoting source; the baseline check (`:1052-1063`) therefore passes;
    the authority question (`:1083-1103`) answers `clear`; `writePlayerMatchStats` (`:830-853`)
    updates the row. A removed row is a `new_target` (`:586-592`) and is re-inserted.
  - `data/reference/seasons.json` declares `in_progress_seasons: [2026]`, and
    `deploy/afldb-settle-afltables.sh:178-179` runs `--apply --auto-apply`.
- **Execution/data path:** administrator saves a Match Sheet correction on a current-season,
  `afltables`-owned row → the row now differs from AFL Tables → the next settle finds an unchanged
  observation and a differing target → `retry` → ownership `updateable` → authority `clear` → UPDATE
  back to the source values, with a `canonical_applications` row and no finding.
- **Impact:** an administrator's statistic correction, club correction, jumper correction or lineup
  removal on a settle-owned current-season row lasts until the next settle (nightly). The reversal
  is recorded in the ledger as an ordinary update and nothing alerts the administrator. Because no
  durable record of the decision exists, the same edit on any season is also not replayed by a
  source reload or rebuild. A row the Match Sheet *inserts* has no owner and is refused by the
  settle, so it is not affected.
- **Reproduction/witness:** executed, DB-free. With the live editor entity set
  (`draft_picks`, `matches`, `players`) the proof returns `overrideScopeProven: true`; for an
  `afltables`-owned row whose canonical `goals` is 3 and whose proposal is 2 the changed fields are
  `["goals"]`, ownership is `updateable` and the authority verdict is `clear`. The same question for
  a `matches` score group carrying an active override answers `conflict`.
- **Disproof attempts:** checked whether the baseline check, the unchanged-observation path, an
  ownership re-stamp, or a documented "Match Sheet edits are provisional" rule prevents or excuses
  the write. None does. Checked that the Match Sheet is still a supported route for a source-owned
  row. It is.
- **Recommended fix boundary:** the Match Sheet writer and the manual-authority contract. Either a
  Match Sheet edit leaves a durable, readable human-authority record that the settle and the reload
  honour, or the editor refuses to edit a settle-owned row. Which one is an operator decision.
- **Suggested validation:** DB-free tests for the authority verdict and the invitation; an
  `afldb_test` integration case (Match Sheet edit, then an unchanged-source settle, then assert the
  edit survives or the edit was refused); a reload case if the durable-record option is chosen.
- **Blocking:** no. It does not corrupt source data and the source value is restored, not lost.
  It should be decided before the Match Sheet is relied on for a current-season correction.

### F-002 — Legacy CSV intake blanks existing statistics when an optional column is absent or malformed

- **Severity:** LOW.
- **Confidence:** HIGH from source. Not executed: the dataset tests are DB-backed.
- **AFLDB issue:** newly allocated **AFLDB-ISSUE-258**.
- **Existing issue search:** `issues.md` headings and text for upload, submission, CSV, intake,
  dataset, "partial file", `toIntOrNull`; ISSUE-013, 026, 074, 175, 185, 186; ISSUE-155 §27. Related:
  ISSUE-186 (resolved for Phase A; the pipeline is deprecated and its retirement, Phases B and C, is
  deferred with no issue ID), ISSUE-185 (provenance on promotion). None covers this.
- **Affected path:** `/admin/upload` or emailed CSV → validate → Super Admin approval → promotion of
  the `player_match_stats` and `match_results` datasets.
- **Expected invariant:** a validation report that says `ok` means the row will be applied as
  written, and a file that is silent about a figure does not erase it. The `player_bio` dataset in
  the same file states and implements exactly this.
- **First wrong layer:** validation. `toIntOrNull` (`src/lib/ingest/datasets.ts:80-84`) returns
  `null` for a missing column and for any non-integer text, and the statistic columns are never
  checked for "present but unparseable".
- **Evidence:**
  - `datasets.ts:666` requires only the six identifying columns for `player_match_stats`.
    `:737` maps every statistic through `toIntOrNull`; `:728` and `:734` do the same for
    `career_game_no` and `jumper_number`; `:719-722` validates `brownlow_votes` only for range.
  - `:760-786` overwrites every one of those columns with the incoming value on conflict.
  - `match_results`: `:544-551` reads goals and behinds through `toIntOrNull` with no error for a
    malformed value; `:621-637` overwrites goals, behinds, attendance and attendance status.
  - Contrast `:838-853`: `player_bio` uses `COALESCE` so that "a partial file can never blank a
    figure it did not mention".
  - `src/lib/ingest/pipeline.ts:44-51` checks required columns only.
- **Execution/data path:** a file with the identifying columns and, say, only `goals` validates `ok`
  for every row; on promotion each matched existing row has every other statistic, its jumper
  number, its career game number and its `brownlow_votes` mirror set to NULL. A cell such as `1O`
  becomes NULL the same way.
- **Impact:** silent loss of canonical statistics on existing rows, including source-owned
  historical rows, behind a report that showed no warning. Bounded by the path being the deprecated
  "Legacy file intake" and by Super Admin approval. Current-season rows are restored by the next
  settle; completed seasons are restored only by a reload or a backup.
- **Reproduction/witness:** by inspection: `Number(undefined)` and `Number('1O')` are `NaN`, so
  `toIntOrNull` returns `null`, `validateRow` returns `ok`, and the upsert writes `EXCLUDED` NULLs.
  A database rehearsal on `afldb_test` is described in the runbook and was not run.
- **Disproof attempts:** looked for a header check beyond required columns, a per-column parse error,
  a `COALESCE` in the upsert, a database constraint that would refuse the NULLs, and a test pinning
  the behaviour as intended. Found none. The stale-derived-data consequence of promotion is
  documented on the review page and is not part of this finding.
- **Recommended fix boundary:** `datasets.ts` validation and the two fact-table upserts, or
  retirement of the datasets under the deferred ISSUE-186 phases.
- **Suggested validation:** validator unit cases for malformed and absent columns; an `afldb_test`
  promotion case asserting an unmentioned statistic survives.
- **Blocking:** no.

### F-003 — NL club-scoped career rankings accept a career condition that is evaluated across the whole career

- **Severity:** LOW.
- **Confidence:** HIGH. The parser and validator were executed; the compiled SQL was read, not run.
- **AFLDB issue:** newly allocated **AFLDB-ISSUE-259**.
- **Existing issue search:** `issues.md` and `IssuesIndex.md` for "totalled for one club",
  "club-scoped", `careerConditions`; ISSUE-110, 215, 256. Related: ISSUE-110 (scope discarded at
  compile time), ISSUE-215 (records that the guard fails closed for club-scoped career conditions).
  Neither covers a ranked plan.
- **Affected path:** NL search, validate stage, `player_career` grain with a club.
- **Expected invariant:** a club-scoped career plan is answered only when every part of it can be
  scoped to the club; otherwise it declines. `tests/nl-semantic-mapping.test.ts:221-229` pins this
  for the unranked form ("refuses club-scoped unranked conditions whose scope is not fully typed").
- **First wrong layer:** `validatePlan`, `src/search/nl/plan.ts:2430-2439`. The all-conditions-are-
  `games` test applies only when the plan has no ranking metric. A plan with a club-scopable metric
  passes whatever its conditions are.
- **Evidence:** `src/db/queries/nl/player-career.ts:84-95` club-scopes the ranked metric and
  `:107-109` club-scopes a `games` condition, but `:110-111` and `:113-118` evaluate every other
  column condition and every award condition on the whole-career row.
- **Execution/data path:** "most games for Collingwood without a premiership" parses to
  `player_career`, metric `games`, club Collingwood, condition `premierships = 0`, and validates. The
  answer ranks Collingwood appearances among players with no premiership anywhere.
- **Impact:** a mixed-scope answer where the unranked form of the same question declines. The
  explanation shows "Club: Collingwood." beside the condition and does not say the condition is
  career-wide. For "most games for Carlton with at least 2 brownlow medals" a player with one medal
  at Carlton and one elsewhere qualifies.
- **Reproduction/witness:** executed, DB-free. "players with at least 200 games and no premierships
  for Collingwood" → refused with "This career statistic cannot currently be totalled for one club."
  "most games for Collingwood without a premiership", "... with no premierships" and "most games for
  Carlton with at least 2 brownlow medals" → `VALID`.
- **Disproof attempts:** searched `plan.ts` for any other guard on `careerConditions` with a club;
  checked the compiler for a per-club condition path; checked for a test that pins the ranked form
  as accepted. None exists.
- **Recommended fix boundary:** the one guard in `validatePlan`. Whether a whole-career condition
  beside a club-scoped ranking should decline or be answered and labelled is an operator decision.
- **Suggested validation:** `tests/nl-plan.test.ts` and `tests/nl-semantic-mapping.test.ts` cases for
  the ranked form; the frozen corpus rerun for regression.
- **Blocking:** no.

### F-004 — NL answer explanation prints internal column markers for career conditions

- **Severity:** LOW.
- **Confidence:** HIGH. Executed.
- **AFLDB issue:** newly allocated **AFLDB-ISSUE-260**.
- **Existing issue search:** `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` for "Condition: c.",
  "c.premierships", "c.games at least"; `tests/` for a pinned "Condition:" string. No match.
- **Affected path:** NL search, describe/render stage, any `player_career` answer with a column
  condition.
- **Expected invariant:** the explanation panel is reader-facing text that states what was answered.
- **First wrong layer:** `describePlan`, `src/search/nl/plan.ts:2719-2725`. It prints
  `NL_CAREER_COLUMNS[cond.column]`, which is the compiler's SQL marker (`plan.ts:1003-1024`,
  for example `c.premierships`), instead of a label.
- **Evidence:** `src/db/queries/nl/answer.ts:237` puts `describePlan(plan)` in the answer as
  `explain`; `src/components/NlAnswerSection.tsx:62` renders each line.
- **Execution/data path:** "players with 300 games and no premierships" → explanation lines
  "Condition: c.premierships exactly 0." and "Condition: c.games at least 300."
- **Impact:** every career-condition answer shows a database alias to the public reader. Cosmetic;
  no data or result is affected.
- **Reproduction/witness:** executed, DB-free: the two lines above, plus "Condition: c.clubs_played
  at least 3." for "players with at least 3 clubs".
- **Disproof attempts:** checked whether the explanation is admin-only (it is rendered by the public
  answer component) and whether another describer rewrites the lines (none found).
- **Recommended fix boundary:** the condition label in `describePlan`.
- **Suggested validation:** a `tests/nl-plan.test.ts` case asserting no explanation line contains
  `c.`.
- **Blocking:** no.

## 4. Rejected candidate findings

1. **Admin mutations invalidate cached pages on one cluster worker only.**
   Inspected the Data Editor, player-link, settings and Brownlow actions and the loopback
   revalidation route. The limitation is real but known and documented: ISSUE-134 records that page
   invalidation is per process, and the Brownlow actions cite it as a "Known limitation" bounded by
   the ISR window. Not a new defect.
2. **`createMatch` stores a missing score as zero.** `Number(null)` is 0, but
   `validateAdminMatchNumbers` requires an explicit score or both goals and behinds, and
   `matches.home_score` is NOT NULL. Unreachable.
3. **NL player-grain period-split compilers reference columns that do not exist.** The compilers
   contain those branches, but `validatePlan` refuses a period split on any grain other than
   `team_match`. Unreachable.
4. **The ISSUE-256 crash class on the season and game grains.** Their metric sets are generated from
   the Grid statistic keys, so no unstored statistic is admitted. The ISSUE-256 fix covers the
   career grain.
5. **`saveEdit` reactivates a deactivated override on a no-change save.** It re-upserts the existing
   row with `is_active = true`. The only deactivations of a `players` or `matches` override are the
   rekey carry, whose old key is never read again, and a one-off maintenance tool. No realistic path.
6. **Fixture played-resolution cannot match settle-written matches.** It matches on exact
   `round_code`, but fixtures render the code in the `matches` vocabulary. Consistent.
7. **CSV promotion leaves derived tables stale.** True and intentional: the review page tells the
   administrator to run `rebuild_derived.py`.
8. **The legacy `player_match_stats` dataset writes `brownlow_votes`.** Recorded by ISSUE-155 as a
   compatibility writer left unchanged pending the retirement decision. Deferred by decision.
9. **Data Editor quick-jump chips are hard-coded to 2023–2026.** A convenience shortcut beside a full
   season selector. Informational; no issue.
10. **The AFL API ingestion-switch Server Actions accept an unvalidated argument.** Super Admin only,
    and the reader fails closed on anything but a stored `true`. No practical impact.
11. **The email-intake route is not loopback-gated.** It relies on a shared secret with a failure
    limiter and reaches staging only. Reviewed without defect on 2026-09-17; unchanged.

Read without a candidate arising: the migration runner and its safety checks, backup and restore
verification, the DEV sync scripts, administrator lifecycle, season and round queries, the rollover
planner, and the AFL API absence sweep.

## 5. Existing issue observations

- **AFLDB-ISSUE-229.** Statements in the brief verified against `IssuesIndex.md`, the Open Issues
  table and the runbook structure: Option B, B1 complete, the writer held for B2. Nothing in this
  review touches its boundary. State unchanged.
- **AFLDB-ISSUE-233.** Verified: implementation merged, the remaining item is the promotion gate's
  first live read. Nothing in this review touches its boundary. State unchanged.
- **Settle and email-intake unit credential deny-lists (no issue allocated).**
  `deploy/afldb-settle-afltables.service` does not unset the seven later-added DSNs
  (`AFLDB_TEST_IMPORT_`, `AFLDB_TEST_AUTH_`, `AFLDB_CODE_TEST_`, `AFLDB_CODE_TEST_IMPORT_`,
  `AFLDB_DEV_IMPORT_`, `AFLDB_PROD_IMPORT_`, `AFLDB_PROD_AUTH_DATABASE_URL`), the IMAP login or the
  Kali key. This is already recorded in the ISSUE-232 entry as "Out of scope, recorded" and
  "Follow-up, not an issue ... (separate decision)", so no ID is allocated. One fact that record does
  not carry: `deploy/afldb-email-intake.service` has the same drift (it also leaves the session
  secret, SMTP login and revalidation secret set) while its comment says it "drops everything else
  .env carries", and neither unit is covered by the `.env.example`-derived test that guards the web
  and AFL API units. The pending operator decision should cover both units.

## 6. New issue allocation

IDs 257–260 were proven unused: no file under `issues/open` or `issues/closed`, no heading or text
reference in `issues.md`, `IssuesIndex.md` or `CHANGELOG.md`, no commit subject and no added or
removed text for any of them in any ref. The only higher numbers in the repository are test
fixture strings (`AFLDB-ISSUE-900`, `AFLDB-ISSUE-999`). The highest allocated ID was 256.

| Finding | AFLDB issue | Severity | Title |
|---|---|---|---|
| F-001 | AFLDB-ISSUE-257 | Medium | Match Sheet edits to source-owned player statistics are reverted by the next automatic settle |
| F-002 | AFLDB-ISSUE-258 | Low | Legacy CSV intake blanks existing statistics when an optional column is absent or malformed |
| F-003 | AFLDB-ISSUE-259 | Low | NL club-scoped career rankings accept a career condition that is evaluated across the whole career |
| F-004 | AFLDB-ISSUE-260 | Low | NL answer explanation prints internal column markers for career conditions |

## 7. Review disposition

- CRITICAL: 0.
- HIGH: 0.
- MEDIUM: 1 (F-001).
- LOW: 3 (F-002, F-003, F-004).
- Rejected candidates: 11.
- Findings mapped to existing issues: 0. One observation is already recorded as a deferred
  follow-up under ISSUE-232 and received no ID.
- Newly allocated issues: 4 (AFLDB-ISSUE-257 to 260).
- **Blocks normal development:** nothing.
- **Blocks deployment:** nothing. F-001 describes behaviour already live in production; deploying
  current `main` neither introduces nor worsens it.
- **Coverage caveat:** this pass read a bounded part of the repository (§2.4) and could not run the
  typecheck, lint or test suites (§2.3). It is not a project-wide pass.

## 8. Recommended implementation order

1. **AFLDB-ISSUE-257.** The only data-integrity finding, and it needs an operator decision first
   (durable record versus refusing the edit). Decide before the next season's in-season corrections.
2. **AFLDB-ISSUE-259.** One guard in `validatePlan`; needs the decline-or-label decision.
3. **AFLDB-ISSUE-260.** One label in `describePlan`. Independent of 259, but both touch the same
   explanation lines, so doing them in one NL session avoids two corpus reruns.
4. **AFLDB-ISSUE-258.** Last, because the cheaper resolution may be to retire the two fact-table
   datasets under the deferred ISSUE-186 phases; that is an operator decision, not a dependency.

## 9. Closeout (2026-10-02, after the review)

Sections 1–8 are the review as it stood. Nothing in them was rewritten for what follows, apart from
the one pointer added to §1.1. This section records what happened afterwards. It is tracking only:
no code, test, migration or configuration was changed, no database was contacted, and nothing was
staged or committed.

### 9.1 The seven stray files

**Observed.**

- Exactly seven, all in the repository root: `0`, `Done`, `manualAuthorityVerdict(snapshot`,
  `'display_name'`, `${Y}`, `({` and `{})`.
- Each was zero bytes. Each had identical creation and last-write times, between 20:00:31 and
  20:07:52 on 2026-10-02, inside the review session.
- Each was untracked and not ignored, and no commit on any ref has ever touched a path of that name.
- They were absent from `git status` at the start of the review.
- The repository has no active Git hook (`.git/hooks` holds only samples), no `core.hooksPath` and no
  `core.fsmonitor`, and its own tool settings define no hook.
- The workstation's user-level settings for the review tool register a hook that runs after every
  file read (`cbm-code-discovery-gate.cmd`, launched through `cmd.exe`), with the read's result
  supplied to it as input, in the repository directory.
- The same family of hook, at session start, visibly ran `cmd.exe` interactively and echoed its
  input at a command prompt.

**Inferred.** `cmd.exe` treated the text of each file read as command input, so a `>` in a source
line became an output redirect and created an empty file named by the text after it. This fits every
name and every timestamp, and only file reads were affected. The redirect itself was not reproduced
deliberately, because reproducing it would create another stray file.

**Disposition.** All seven were confirmed zero-byte, untracked and without any repository purpose,
and were deleted. Nothing else was deleted. The seven evidence PNGs were not touched.

**Not done.** The hook was not changed. Until it is, reading a file whose text contains `>` can
create another such file, in any session.

### 9.2 Operator decisions recorded

| Issue | Decision | Where recorded |
|---|---|---|
| AFLDB-ISSUE-257 | Option A, durable authority. A Match Sheet correction must survive settles and be replayable across rebuild/reload until deliberately superseded or removed. | Runbook §15.2; design proposed in §17 |
| AFLDB-ISSUE-258 | Fix the two reachable datasets. Absent or blank optional column preserves the existing value; malformed value is a validation error; no implicit clear. | Runbook §15.2–§15.3 |
| AFLDB-ISSUE-259 | Fail closed: decline a club-scoped career ranking carrying a condition that cannot be evaluated at club scope. No new compiler capability; no parser change intended. | Runbook §15.2–§15.3 |
| AFLDB-ISSUE-260 | Approved for implementation, in the same NL session as 259 unless evidence says otherwise. | Runbook §15, §16 |

The allocations F-001–F-004 → AFLDB-ISSUE-257–260 were accepted provisionally by the operator.

### 9.3 What the decisions changed in the review's own recommendations

- §8 said AFLDB-ISSUE-257 and AFLDB-ISSUE-259 each needed a decision first. Both are now decided.
  For 257 the decision is made but the design (runbook §17) still awaits approval.
- §8 item 4 suggested retirement might be the cheaper resolution for AFLDB-ISSUE-258. The operator
  chose the fix.

### 9.4 Found while recording the decisions

- **AFLDB-ISSUE-257, deploy order.** The current manual-authority proof requires the
  `data_overrides` CHECK to admit none of the three settle targets. Admitting `player_match_stats`
  before the new code is live would make the deployed settle refuse all three targets. Option A
  therefore cannot be "add the entity to the CHECK, then ship the code". Recorded in the runbook
  §17.10.
- **AFLDB-ISSUE-257, grants.** `afldb_import` already holds the read and column write grants on
  `data_overrides` that Option A needs, so the decision's "no broader access than necessary" is met
  without a new grant.
- **AFLDB-ISSUE-259, corpora.** Whether a corpus row of the declined shape currently expects an
  answer is unknown. Not checked; it belongs to the implementation session.
- No decision contradicts the review's evidence.

### 9.5 Still not executed

Typecheck, lint and every test suite; any database command; the AFLDB-ISSUE-257 historical census;
the AFLDB-ISSUE-258 check of past promotions; any implementation.

### 9.6 AFLDB-ISSUE-257 design decisions (2026-10-02, after §9.1–§9.5)

§9.2 and §9.3 say the AFLDB-ISSUE-257 design was proposed and awaiting approval. That was the state
when they were written. The operator has since approved its direction (runbook §15.3):

- D-257-1: the source continues settling uncorrected fields;
- D-257-2: additions are durable;
- D-257-3: authority ends only by an explicit return-to-source action;
- D-257-4: replay refuses an authority record whose player or match does not resolve.

The Option A decision itself is now numbered D-257-0. The natural key, the schema representation,
promotion/rebuild transport, the tombstone and addition forms, replay ordering and UI are not
approved; they are implementation and rehearsal work (runbook §17.13). The historical census is
still not run. Nothing was implemented.

The opening of §9 says nothing was staged or committed. That described the closeout before this
record; the review and tracking documents were committed after it, as documentation only.
