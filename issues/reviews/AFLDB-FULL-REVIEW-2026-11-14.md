# AFLDB full review — 2026-11-14

**Reviewed revision:** `de640826d13489c58392563e7ae1ff62403ed293` (GitHub `origin/main`, verified by `git fetch` on the
workstation and `git ls-remote` on streamanator, 2026-11-14; equal to the last confirmed published revision).
**Deployed revisions (live read-only, 2026-11-14):** production serves release `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`
(`c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`, ledger 118); DEV serves `8b024098` (an ancestor of `c1c4b22e`).
**Mode:** review only. No executable code was changed; no production or DEV write, deployment, restart, configuration
change, migration, backup, push or merge; no credential minted and no sign-in bypassed; no `wsl` command; ISSUE-331
stores untouched.

Applicability rule used throughout: `c1c4b22e..de640826` changes only the four ISSUE-344 draft files, the DEV sync
scripts, `restore-test.sh`, the two fixture CLIs and GAP-029 ops tooling. A defect in any other `src/` file is
**present in the production build** ("source finding"); it is **demonstrated deployed behaviour** only where a live
observation is cited (live evidence: `docs/v2/evidence/full-review-20261114/live-checks/RESULTS.md`).

---

## 1. Findings (most severe first)

| # | Issue | Sev | Finding | Evidence | Deployed |
|---|---|---|---|---|---|
| 1 | **ISSUE-350** | **High** | No 2027 `seasons` row on production, and the AFL API settle never creates one: every nightly run from the first concluded 2027 match fails on a foreign key | Reproduced + **live** | Prod build + prod data |
| 2 | **ISSUE-351** | Medium | Unattended upgrades restart the production app **and PostgreSQL** outside any approval; `release.mjs promote`/`rollback` switch `current` before the owner's restart, so such a restart can activate an unapproved release | **Live** restart observed; activation source-traced | Prod |
| 3 | **ISSUE-352** | Medium | No scheduled production backup, restore verification or off-host copy; disaster-recovery doc stale for V2 | **Live** + source | Prod |
| 4 | **ISSUE-353** | Medium | Removing a player in the Match Sheet orphans that player's Brownlow round votes, first-kick-goal and after-the-siren records | Reproduced; live 0 | Prod build |
| 5 | **ISSUE-354** | Medium | A retired coach or draft override is silently re-activated by the next edit of the same field group, unaudited | Reproduced; live 0 | Prod build |
| 6 | **ISSUE-355** | Medium | Grid Solver "Led club in a stat" counts NULL (not recorded) seasons as club leads for all 13 live-only stats (clearances 10,966 vs 178) | Reproduced | Prod build (super-admin audience) |
| 7 | **ISSUE-356** | Medium | NL search answers a different question at confidence 1: "least" → maximum; "most X in a showdown/on Anzac Day" → whole-career totals; "in a quarter" → surname Quartermain | Reproduced; live 0 | Prod build (beta-gated) |
| 8 | **ISSUE-357** | Medium | ISR routes persist a full page to disk for every non-canonical id spelling and every 404 path, without bound | Reproduced; live latent | Prod build (beta-gated) |
| 9 | **ISSUE-358** | Medium | The Linux unit suite is red at `main` and the prod revision: stale `sibling-relationships.csv` pin makes every `afldb_test` rebuild refuse at preflight (21 tests), plus a stale architecture stage map and a stale restore-order test | Reproduced | Tooling |
| 10 | **ISSUE-348** (existing, raised Low→Medium) | Medium | A default-label full DraftGuru import deletes the 35 audited D-336-2 picks and 31 persons with no gate; the D-336-3 origin classifier is documentation only | Source + live sizing | Operator tooling |
| 11 | **ISSUE-359** | Low | Public parameter hardening: ids ≥ 2^31 → 500; AFLW `%` slugs get "not found" metadata and `noindex` (17 live); malformed escapes and crafted NL plan tokens → 500; NL drill-down uncapped | Reproduced; FE-3 live | Prod build |
| 12 | **ISSUE-360** | Low | Ties and links: home "Record of the week" truncates tied holders at rank 1; NL tie headline under-counts; "Richmond v Carlton" links to either-club games; sitemap lists 47 redirecting URLs | Reproduced | Prod build |
| 13 | **ISSUE-361** | Low | Performance: deep `/players` pages pay a per-skipped-row subquery (373 ms vs 28 ms); `/clubs/compare` fans ~22 queries onto a 10-connection pool and degrades other pages under concurrency | Reproduced | Prod build |
| 14 | **ISSUE-362** | Low | Auth hygiene: Caddy access logs record magic-link and admin-invite tokens (comment says otherwise); a revoked admin cookie still passes the beta gate ≤12 h and ignores `AFLDB_BETA_EPOCH` | Reproduced; SEC-1 config live | Prod |
| 15 | **ISSUE-363** | Low | Test reliability: vacuous passes (incl. a NULL-vs-zero test), uninvoked/failing Python contracts, `AFLDB_PYTHON` ignored (78 noise failures), untested public beta actions, host-matching `/beta` predicates in two runners, leaking `settle-afltables` fixtures | Reproduced | Tests |
| 16 | **ISSUE-364** | Low | Tooling drift: `next dev` cannot start (`/sitemap.xml` route vs metadata conflict); the serving checkout's `node_modules` (run by timers) is outside every release check; lint red (607 errors) and ungated | Reproduced / source | Tooling |
| 17 | **ISSUE-332** (existing, note) | — | A failed nightly settle is neither retried nor alerted; with ISSUE-351 a morning restart can cost a silent missed night in season | Source | Prod units |

No Critical finding. The authentication and authorisation boundary held under every probe (§3).

### 1.1 ISSUE-350 (High) — production has no 2027 `seasons` row; the AFL API settle never creates one
- **Consequence:** from the first CONCLUDED 2027 match (Opening Round 2027-03-17) the 05:00 nightly
  (`--apply --auto-apply --require-complete-source`) throws `23503 afl_api_match_season_fkey`, rolls back whole and exits 1,
  every night, until someone creates the row. No 2027 result is ingested; the C7 observer sees `NO_BATCH`; the
  ISSUE-332 G1 routine documents no remedy. The Brownlow chain would hit the same key. The obvious manual workaround
  also fails: all 18 current clubs have `last_season = 2026`, so `afldb_identity_for_season(org, 2027)` is NULL and admin
  `createMatch` refuses every club for 2027 (`src/db/queries/match-admin.ts:212-223`).
- **Location:** `src/lib/acquisition/settle-afl-api.ts:1973-2128` (`runSettleAflApi`, no season insert); contrast
  `src/db/queries/match-admin.ts:204-210` (`INSERT INTO seasons … ON CONFLICT DO NOTHING`); the only routine creator is
  `tools/migration/load_reference_data.py:220-240` (reference load, not a production operation); clubs `last_season`
  from `load_reference_data.py:268`; `tools/db/rollover-season.ts` never writes `seasons`. Foreign keys to
  `seasons(year)`: `staging.afl_api_match`, `matches`, `staging.afl_api_player_match`, `promotion_candidates`,
  `staging.afl_api_lineup`, `staging.afl_api_brownlow_vote`. The ledger assumes the opposite (`issues.md` ~24912).
- **Trigger and reproduction:** real `buildAflApiSettleBundle` + `runSettleAflApi` on the committed provider fixture
  renamed onto a season without a `seasons` row (as the state-B harness does, minus its `INSERT INTO seasons`), nightly
  options: run A `{"threw":true,"code":"23503","constraint":"afl_api_match_season_fkey","batchesRetained":0}`; control
  run B (row present) reaches the completeness gate. Host evidence `$W/agents/ingest/evidence/season-row-2.out`.
- **Live (2026-11-14):** production `seasons` stops at 2026; 218 fixtures for 2027; 18 current clubs `last_season = 2026`.
- **Why rehearsals missed it:** rebuilt databases load `seasons` 1897–2027 from `seasons.json`; integration tests insert
  their own season rows.
- **Protection:** fail-closed, no partial write. Nothing creates the row.
- **Fix:** an audited, idempotent `INSERT INTO seasons (2027, 'AFL', 'in_progress') ON CONFLICT DO NOTHING` plus a
  reviewed reconciliation of current clubs' `last_season`, as a rollover step (or the settle ensures the row the way
  `createMatch` does); add a read-only "season row and club identities exist" check to the ISSUE-332 gate register
  before Opening Round. **Verification:** run A of the reproduction reaches the completeness gate; a read-only
  production probe shows 2027 present and `afldb_identity_for_season(org, 2027)` non-NULL for the 18 clubs.
- **Confidence:** high (mechanism reproduced; state observed live). Uncertainty: none material; DEV state not read.

### 1.2 ISSUE-351 (Medium) — unattended restarts of the production app and database; promote/rollback activation window
- **Live (demonstrated deployed behaviour):** at 06:35:01–06:35:14 AEDT on 2026-11-14 `unattended-upgrade` upgraded libc6;
  the `afldb` primary received SIGTERM at 06:35:16 and `postgresql@16-main` re-entered active at 06:35:19, on the same
  release. `apt-daily-upgrade.timer` fires 06:00 + up to 60 min daily; `needrestart` is installed; a reboot is pending
  (kernel 6.8.0-137 since 2026-08-16, `/var/run/reboot-required`). No owner action, approval or record covered it.
- **Source mechanism:** `deploy/release.mjs:1029-1052` (`promote`, `switchLink` at :1046) and `:1068-1091` (`rollback`, :1079)
  switch `current` immediately; the unit runs from `WorkingDirectory=/home/arm/afldb-releases/current`
  (`deploy/afldb.service.d/release-route.conf:16`); `deploy/afldb.service:6` `Requires=postgresql.service`, `:91-92`
  `Restart=always`. Any non-owner start between promote (D3a) and the owner's restart (D3b), or between R3 and its
  restart — needrestart, a PostgreSQL restart propagated through `Requires=`, a crash restart, OOM, reboot — activates
  the switched (possibly abandoned) release with no D3c/post-install check. `rollback --to <older>` has no ledger
  compatibility check (prose only at `release.mjs:1020-1021`).
- **Procedure gap:** the r2 packet assigns every restart to the owner (`docs/v2/issue336-337-340-345-release-approval-r2-2026-11-09.md:109,113`),
  its timer gate inspects only `^afldb.*\.timer$` (`:115,173-176`); `docs/production-cutover.md:88` and
  `docs/deployment.md:222-235` assume owner-only restarts; the state probe
  (`docs/v2/evidence/gap006-release-package-20261101/state-probe.sh:29-30`) records no `ActiveEnterTimestamp`,
  `NRestarts` or `InvocationID`, so an unattended activation is indistinguishable from D3b.
- **Not a defect (checked):** workers re-forked by a running primary stay on the old release (path resolution), so a
  mixed-release cluster cannot arise.
- **Consequences today:** an unplanned ~5 s outage of app and database each morning an upgrade needs a restart; any
  in-flight request or job sees a dropped connection (see the ISSUE-332 note on the nightly).
- **Fix:** an owner decision on host patching (keep unattended upgrades but hold needrestart for `afldb`/`postgresql`
  and schedule restarts, or move upgrades into an owned window); add an apt/needrestart/reboot-required gate to P-A;
  make promote and restart adjacent in one attended step (R2 default otherwise); record `InvocationID` in the probe;
  amend the docs. **Verification:** ISSUE-329 S3/S4 systemd rehearsal — `promote B`, then kill the unit or restart
  PostgreSQL, then `release.mjs status --expect B` passes without D3b (proves the window); after the fix, the gate refuses.
- **Confidence:** high (live restart observed; activation path traced, not executed under systemd).

### 1.3 ISSUE-352 (Medium) — no scheduled production backup, restore verification or off-host copy
- **Evidence:** `docs/backup-restore.md:74-111` ("Not yet scheduled … backups are run manually"; off-host copies not done);
  `docs/production-cutover.md:331-336` unticked; no backup unit in `deploy/`. **Live:** no backup timer or cron entry
  visible to `arm` (root crontab unreadable); `~/backups/afldb` holds only per-operation dumps, newest 2026-11-12
  (D-336-2). No ledger decision accepts this.
- **Consequence:** data that cannot be re-derived — auth users/sessions/audit, `data_edits`, admin overrides,
  `site_settings`, the D-336-2 rows, and from 2027-03-17 the nightly AFL API settles — is lost back to the last ad-hoc
  operation backup on host/disk loss or logical corruption.
- **Also (OPS-3):** `docs/backup-restore.md` §6 is stale for V2: `:157` attributes `--no-privileges` to the dump (`backup.sh:98-102`
  does not pass it); step 2 is a bare `pg_restore --clean` with no identity guard or completion check (the acceptance
  ISSUE-342 removed from `restore-test.sh`); `:179-187` "fully reconstructible" via `import_legacy_afl.py` contradicts
  `docs/v2/legacy-disposition.md:58`.
- **Protection:** per-operation backups with off-host restore verification; `backup.sh` refuses the owner DSN and
  verifies with `pg_restore --list`; `restore-test.sh` (341/342) correct.
- **Fix:** owner decision before 2027 nightly writes: a reviewed backup unit + weekly restore-test + off-host copy
  (outside 05:00–05:30 and the apt window), or an explicit acceptance of per-operation backups with a stated maximum
  data-loss window; rewrite §6. **Verification:** the timer listed and a restore-test PASS record, or the recorded decision.
- **Confidence:** medium-high (root-owned schedules not inspectable as `arm`).

### 1.4 ISSUE-353 (Medium) — Match Sheet player removal orphans Brownlow round votes and curated special records
- **Location:** `src/db/queries/match-sheet.ts:243-250` (`DELETE FROM player_match_stats … player_id = ANY(removed)`,
  no dependent check); `src/lib/acquisition/match-sheet-authority.ts:704-720` (plans `remove` without dependents);
  `match-sheet.ts:662-666` (`returnMatchSheetToSource` `withdraw_delete_row`, same gap). Contrast `deleteMatch`
  (`src/db/queries/match-admin.ts:464-549`), which refuses on Brownlow entries and curated special records, and record
  creation, which requires a `player_match_stats` row (`src/db/queries/admin-special-records.ts:1135-1169`).
- **Consequence:** `brownlow_round_votes` keeps votes for a non-participant and the match stays "accounted"; the next
  Brownlow publish/correction (`admin-brownlow.ts:919-923`) carries them into season and career totals (Brownlow
  authority invariant). First-kick-goal and after-the-siren records keep naming the removed player (ISSUE-176
  invariant). The normal "replace a wrongly identified player" flow triggers it; a sealed season needs only a
  20-character note.
- **Reproduction (isolated snapshot copy, 4/4):** removing player 2561 from match 16407 (2024) → `ok:true`, round votes
  `{votes:3}` remain, match total still 6; removing 6378 from match 1103 → `player_achievements#1` still active; removing
  1774 from 1313 → `after_siren_kicks#1` still names him; control `deleteMatch(1103)` refuses. Host evidence
  `$W/agents/admin/evidence/adm1.out`. **Live:** 0 orphans of each kind (latent).
- **Fix:** under the existing locks, refuse a `remove` (or `club_id` change) while the player has round votes or a
  vote-entry state, `player_achievements`, `after_siren_kicks` or period stats in the match, with `deleteMatch`'s refusal
  shape; same for `withdraw_delete_row`. **Verification:** invert the reproduction (exact refusal text, dependents unchanged).
- **Confidence:** high. Uncertainty: whether period stats should block (product decision).

### 1.5 ISSUE-354 (Medium) — retired overrides are revived by the next edit, without audit
- **Location:** `src/db/queries/admin-coaches.ts:593-605` (`saveCoachMetadata`) and `src/db/queries/admin-draft.ts:767-788`
  (`saveSourcePickFields`) read the `data_overrides` row without `AND is_active`, merge its payload and upsert
  `is_active = true` (verified by the lead). Retire paths: `admin-coaches.ts:886-917`, `admin-draft.ts:826-865`.
  `src/db/queries/data-edits.ts:265-288` has the same latent pattern (no retire path reaches it today).
- **Consequence:** retiring is the documented hand-back to the source (and the reversibility mechanism for a manual
  coach, `admin-coaches.ts:880-885`); any later edit of any field in that group re-activates the retired values, the
  replay (`tools/migration/common.py` ~2102-2135, ~2271-2320) re-applies them, and neither the action's `changed`
  summary nor the `data_edits` row mentions them. Contradicts the ISSUE-160 resolution ("a retired selection is never
  resurrected").
- **Reproduction (2/2; two earlier runs 1/2 failed for a fixture query only):** coach 3: retired `{notes}` → given-name edit →
  active `{notes, given_name}`. Draft pick 6544: `height_cm` override retired, source value NULL, then a `weight_kg`
  edit reports `changed:{weight_kg}` and leaves an active `{height_cm:190, weight_kg:80}` override. Evidence
  `$W/agents/admin/evidence/adm2c.out`. **Live:** 0 inactive coach/draft overrides (latent).
- **Fix:** merge only from an active row; start from `{}` otherwise; record carried keys in `data_edits`; same for
  `data-edits.ts:266`. **Verification:** inverted reproduction shows only the newly changed field.
- **Confidence:** high.

### 1.6 ISSUE-355 (Medium) — Grid Solver club-lead builder treats NULL as a lead
- **Location:** `src/db/queries/grid-solver.ts:262-273` (`ledSeasonRows` live-only branch: no `total IS NOT NULL`; the
  precomputed branch :254-260 and `league_season_stat_rank_top` :605 have the guard); callers :558-567.
- **Consequence:** `t2.total > NULL` is NULL, so `NOT EXISTS` is true and every unrecorded player-season "led the
  club". On the snapshot: clearances 10,966 vs 178 correct (10,330 careers ended before 1998); rebounds 11,023 vs 259;
  inside 50s 11,008 vs 223; goal assists 11,436 vs 273; `_min_times(clearances,5)` 3,360 vs 31. Breaks NULL ≠ zero.
- **Reproduction:** 5/5 against a hand-written guarded query (`$W/agents/search/evidence/review-search-grid.log`).
- **Applicability:** prod build since `990fbc57` (2026-08-16); live `grid_solver.audience = "super_admin"`; NL does not
  reach this builder. **Fix:** `HAVING sum(...) IS NOT NULL` (as `player-season.ts:119`). **Verification:** a clearances
  case in `tests/integration/grid-solver.test.ts`. **Confidence:** high.

### 1.7 ISSUE-356 (Medium) — NL search answers a different question at confidence 1
- **(a) "least":** `src/search/nl/vocab.ts:251-254` excludes bare "least" from `min`; `:1141` lists it as an ignored
  connective; `parser.ts:4076` defaults to `max`. "least goals in a season" → "Bob Pratt and Peter Hudson — 150";
  "least brownlow votes in a career" → "Gary Ablett — 262". ("fewest" is correct.)
- **(b) marquee phrases:** `parser.ts:953` (`SUPERLATIVE_GOVERNS` checks only 12 characters), `:968-1035`
  (`extractMarqueeMatches` → `matchup_played_min`/`match_event_min` times=1), `src/db/queries/nl/player-career.ts:245-304`.
  "most goals in a showdown" → Wayne Carey 727 (career); "most goals on anzac day" → Matthew Lloyd 926 (career); the
  explain block prints an unfilled "X+" label and `describePlan` omits predicate parameters.
- **(c) "quarter":** `parser.ts:3075-3140`, `src/db/queries/nl/resolve.ts:181-245` accept "quarter" as a prefix of the
  surname Quartermain at certainty 1: "most goals in a quarter" → "Allan Quartermain and Don Quartermain — 0 goals (tied)".
- **Evidence:** NL probes mirroring `answerNlQuestion` without logging (`$W/agents/search/evidence/nl-b.jsonl`, `nl-c.jsonl`).
  **Live:** 54 logged questions since 2026-09-02, none matching (latent; beta-gated).
- **Fix:** map `(?<!\bat )\bleast\b` to `min` (or decline); decline or re-route ranked metrics combined with marquee
  predicates and render predicate parameters; refuse prefix-only surname matches for stat/period vocabulary.
  **Verification:** `tests/nl-parser.test.ts` cases for each phrasing plus the V5 parse-only corpus (12,000/0/0/0 today).
- **Confidence:** high.

### 1.8 ISSUE-357 (Medium) — unbounded ISR disk growth from non-canonical and not-found paths
- **Location:** `src/lib/format.ts:539-545` (`parseEntitySlug` accepts any digit run), `src/lib/params.ts:25-29`
  (`parseSeason` via `Number()`: `02024`, `2024.0`, `2.024e3`), `src/app/matches/[id]/page.tsx:81-82` (`0x1`, `1e0`),
  `src/app/players/[slug]/page.tsx:161-170` (only slug text compared), `seasons/[year]:87-92`, `brownlow/[year]:76-81`;
  ISR routes with `generateStaticParams` and default `dynamicParams` (players, matches, seasons, brownlow, clubs,
  venues, honour-teams). Next persists each rendered path on disk (`node_modules/next/dist/docs/01-app/02-guides/self-hosting.md:89,109`), including `notFound()` renders.
- **Reproduction (local production build):** 200 distinct 404 paths added 10.07 MB / 1,400 files; 9 new season spellings
  added 27.7 MB (≈360 requests per GB), each a 0.6 s render (`$W/agents/frontend/evidence/amp.out`, `p1.txt.out`).
- **Live:** serving ISR tree 767 MB / 11,052 files, 45 GB free; no non-canonical entries yet (latent, beta-gated; no
  Caddy rate limit). Growth is per release (fresh tree each release).
- **Fix:** accept ids only as `^[1-9]\d*$` within range and 404 or `permanentRedirect` other spellings; compare the
  whole `slug-id`; consider a cache handler that does not persist 404s. **Verification:** `/seasons/02024` → 308/404 and no
  file written. **Confidence:** high (multi-worker sharing untested).

### 1.9 ISSUE-358 (Medium) — the Linux unit suite is red at `main`; `afldb_test` cannot be rebuilt
- **TST-1:** `tools/db/rebuild-test.ts:3800` pins `data/players/sibling-relationships.csv` at `dc8d6180…`; since
  `c16d7fad` (2026-11-03, GAP-029 D4 McGovern pair) the file is `b1f0ff4e…` (verified by the lead). `assertReviewedInputPins()`
  (`:3656`) refuses every rebuild before any stage ("Nothing has been destroyed"); 21 `tests/db-test-rebuild.test.ts`
  cases fail. Related stale oracle `tests/integration/nl-answers-relationships.test.ts:52` (`hasBrother: 658`; snapshot 660).
- **TST-3:** `docs/v2/architecture.md` §9 cites `settle-afl-api.ts:356`, the function is at `:357` since `b08c8307`
  (2026-11-02); `tests/v2-acquisition-pipeline.test.ts:372-375` fails at both `c1c4b22e` and HEAD.
- **TST-2:** `tests/db-promotion-check.test.ts:7592-7606` looks for literals that the ISSUE-341/342 rewrite now emits
  via `printf` (`restore-test.sh:160,182,218,300,305`); the ISSUE-250 hash-before-clear order still holds in the script
  but is no longer pinned by Vitest.
- **Consequence:** the canonical rebuild route is blocked (fail-closed) and the full unit gate has not been green on
  Linux since about 2026-11-02/03, so real regressions are masked; recent qualifications ran named subsets.
- **Fix:** a reviewed pin update (plus a DB-free test recomputing every pin), regenerate §9, update the shape test.
  **Verification:** `vitest run tests/db-test-rebuild.test.ts tests/v2-acquisition-pipeline.test.ts tests/db-promotion-check.test.ts`.

### 1.10 ISSUE-348 (existing; raised Low → Medium) — next DraftGuru acquisition can delete audited rows; the origin gate is manual
- **ING-2:** `tools/rebuild/draftguru/import_draftguru.py:132` default label `annual-html-20260826` builds exactly
  6,810/5,057 (`:141-142`, `:557-560`); `:1481-1486` `reload_keyed` on `draft_picks` (source `draftguru`) with
  `delete_missing=True` (`common.py:439, 704-713`); `:1491-1498` deletes persons without picks; the drop guard
  (`:843-848`) checks only `external_identities`. The 35 D-336-2 rows were inserted as `draftguru` source rows and their
  31 persons have no identity rows (`tools/v2/issue336-predraft-insert-production.ts:20-24, 394-407`). A normal-mode run
  with the default label would delete them, leave 35 `data_edits` rows pointing at deleted ids, and trip no count
  gate. **Live:** 6,845 DraftGuru picks; 31 DraftGuru persons without identity rows. `--link-only` is safe (exact
  6,810/5,057 check, `:1035-1043`); a fresh acquisition is refused until the constants are edited.
- **ING-3:** the D-336-3 classifier exists only under `docs/v2/evidence/…/d3363-classification-20261111/scripts/`; once the
  constants are edited, a keyed reload overwrites `original_club_raw` on all 187 rows including 5961/6784/6626.
- **Fix:** refuse a full import when stored DraftGuru keys are not a subset of incoming keys (or when a deleted pick has
  `data_edits`) unless acknowledged; require an origin-review input; correct the I336 comment. **Verification:** an
  integration case seeding an extra DraftGuru pick with a `data_edits` row; `--dry-run` must refuse.
- **Confidence:** high (source); not reproduced (Stage A pages absent, no psycopg on host Python).

### 1.11 ISSUE-359 (Low) — public parameter hardening
- **FE-2:** ids 2^31…2^53 → HTTP 500 (`22003`) on `/players/x-<id>`, `/players/x-<id>/matches`, `/coaches/x-<id>`,
  `/matches/<id>`, `/api/coaches/<id>/opponent-record` (`src/lib/format.ts:542-543`, `matches/[id]/page.tsx:49-50,81-82`,
  `api/coaches/[id]/opponent-record/route.ts:24-25,33`); compare pages already bound to 2,147,483,647.
- **FE-3:** AFLW slugs containing a literal `%27` (17 of 960 live): the page decodes once but metadata over-decodes →
  title "AFLW player not found", `noindex`, no canonical; a malformed escape (`%E0%A4%A`) → `URIError` 500
  (`src/app/aflw/players/[slug]/page.tsx:52,74`; same pattern in `aflw/matches/[key]`, `aflw/seasons/[key]`, `aflw/clubs/[code]`).
- **SRCH-6:** `/search/qualifying-matches` crafted plan tokens → uncaught `TypeError` or `22P02` → 500 (values bound,
  no injection); drill-down has no LIMIT (2,721 rows) (`src/search/nl/qualifying-matches-gate.ts:25-31`,
  `plan.ts:1829-2610`, `src/db/queries/nl/team-match.ts:303-352`, `src/app/search/qualifying-matches/page.tsx:22-30`).
- Reproduced (local production build / function level). **Fix:** range-checked parsers, one safe-decode helper falling
  back to `notFound()`, plan shape validation and a row cap.

### 1.12 ISSUE-360 (Low) — ties and links
- **FE-4:** home "Record of the week" uses a plain `LIMIT 5` (`src/app/page.tsx:82`, `src/db/queries/home-records.ts:112-181`,
  `HomeRecordPanel.tsx:70-100`): `after-siren-most-attempts` has 9 holders of the record, 5 shown, no tie marker (tied
  holders invariant). Only when an admin selects such a record; the default is unaffected.
- **SRCH-7:** NL tie headline counts returned rows capped at 25 (`src/search/nl/describe.ts:37-71`): "and 24 others" for
  465,695 tied performances; the table footer discloses the total.
- **SRCH-5:** "Richmond v Carlton" intent links Match Search with `club=a,b`, i.e. either club: 4,879 games vs 231
  head-to-head (`src/search/query-intent.ts:163-172`, `src/db/queries/match-search.ts:72-76`).
- **FE-7:** the sitemap lists 47 URLs that 308 (`/awards/brownlow-medal` and 46 seasons) (`src/app/sitemap.ts:140,147-152`).

### 1.13 ISSUE-361 (Low) — public performance hot spots
- **FE-5:** `src/db/queries/players.ts:133-154` correlated club-names subquery runs for every skipped row: OFFSET 13,300 →
  372.7 ms vs 28.1 ms, also before the past-the-end redirect.
- **FE-6:** `/clubs/compare` issues ~22 queries per pair (`src/app/clubs/compare/state.ts:299-326`,
  `club-comparison.ts:1338-1440`) against a pool of 10 (`src/db/client.ts:33`); 8 concurrent clients: pair p50 2.0 s,
  unrelated `/clubs` p50 26 → 485 ms. Medium confidence (shared host).

### 1.14 ISSUE-362 (Low) — auth hygiene
- **SEC-1:** Caddy JSON access logs record the full URI: `/beta/verify?token=…` (magic link), `/admin/invite/<token>`
  (redeemer sets an admin password and TOTP; 7-day validity), `/search?q=…`; `deploy/Caddyfile.production:85-93,194-201`
  and `deploy/Caddyfile:55-62` say "Query strings stay out of the logs". Reproduced with Caddy 2.11.9. **Live:** Caddy
  2.11.4, same blocks installed, log files `caddy:caddy 600`. Mitigations: sha256 storage, single use, root/caddy-only logs.
- **SEC-2:** `src/middleware.ts:136-148` accepts a signed admin claim at the beta gate with no database session check
  and no epoch (`src/lib/auth/session.ts:182-202`, 12 h TTL `tokens.ts:148`), so a revoked/deactivated/password-reset
  admin cookie keeps public beta-site access ≤12 h and `AFLDB_BETA_EPOCH` does not cover it; `/admin` re-checks the
  database. Reproduced 2/2. **Fix:** filter Caddy logs (or keep tokens out of URLs); epoch admin claims or document
  secret rotation.

### 1.15 ISSUE-363 (Low) — test reliability and coverage
- **TST-4:** three integration tests pass vacuously on production-shaped data via `if (!subject) return;`
  (`venue-records.test.ts:209-221` — the NULL-vs-zero attendance case; `player-matching.test.ts:183-205`;
  `club-coach-records.test.ts:220-233`); converted to `throw`, exactly these 3 fail.
- **TST-5:** seven `tests/python` contracts are run by no suite; `fitzroy_profile_continuity_contract.py:77-78` fails
  (expects 79, contract now 150 since `c7e17da2`).
- **TST-6:** six Python-backed suites read `PYTHON` but not the documented `AFLDB_PYTHON`
  (`tests/{after-siren-normalisation:34,brownlow-season-artefact:32,coach-reconciliation:28,sibling-reconciliation:34,father-son-reconciliation:28,height-reconciliation:19}.test.ts`):
  78 of 107 unit failures are this environment noise; all six pass with a working interpreter.
- **TST-7:** `src/app/beta/actions.ts` (`safeDestination`, `redeemAccessCode`, `requestMagicLink`, join request),
  `src/app/consent-action.ts` and `src/app/player-link-suggestion-action.ts` have no tests (beta gate is ON in production).
- **TST-8:** two committed acceptance runners test the redirect with `/\/beta/` against an absolute Location
  (`…release-execution-20261111/scripts/prod-accept-headed.cjs:50`, `…dev-deploy-20261106/runners/dev-accept-headed.cjs:43`),
  which matches the host `beta.afldb.com` — the Step G defect class. Their recorded runs are not misreported (raw
  details show the correct target).
- **TST-9:** an interrupted `tests/integration/settle-afltables.test.ts` leaves committed season-2094 fixtures that
  break later suites (`admin-season-lists`, `release-gates`); its comment (`:63`) says 2094 is unique but
  `awards-reload-links.test.ts:4274` uses it too.

### 1.16 ISSUE-364 (Low) — developer and operations tooling drift
- `next dev` at the reviewed revision refuses to start: "Conflicting route and metadata at /sitemap.xml"
  (`src/app/sitemap.ts` + `src/app/sitemap.xml/route.ts`; both also at `c1c4b22e`; `next build` passes, so production is
  unaffected). Evidence `$W/agents/auth/evidence/next-dev-attempt1-sitemap-conflict.log`.
- The serving checkout's `node_modules`, which the nightly timers execute (`deploy/afldb-settle-afl-api.sh:44-45,121,142`),
  are never refreshed or lock-checked by the release route (`docs/deployment.md:258-262`); not exposed today (lockfile
  unchanged since `c1c4b22e`).
- `eslint .` fails: 607 errors / 149 warnings (319 `no-explicit-any`, 270 `no-require-imports`, 11
  `react-hooks/set-state-in-effect`; 226 under `issues/`, 276 `tests/`, 39 `tools/`, 37 `docs/`, 17 `src/`); lint is in
  no gate (merge-readiness, preflight, release). No correctness defect was demonstrated from the 17 `src/` errors.

### 1.17 ISSUE-332 (existing) — nightly failure is silent
`deploy/afldb-settle-afl-api.timer:16-21` (`05:00`, `RandomizedDelaySec=15min`, `Persistent=true`) and `.service`
(`TimeoutStartSec=3600`, no `OnFailure=`): a failed run (for example a PostgreSQL restart mid-transaction, ISSUE-351, or
the ISSUE-350 foreign key) fails closed but is neither retried nor alerted; `Persistent=` replays only missed elapses.
In season a round's results stay unpublished until someone checks by hand (`docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md:46`). Recorded under
ISSUE-332 as an operating risk with a recommended `OnFailure=` notifier or monitored marker.

---

## 2. Separated from findings

| Item | Classification |
|---|---|
| ISSUE-336 Step G runner FAIL 77/83 (six URL-check failures, `page.url().includes('/beta')`) | Existing, closed; still described as a documented assessment, not an automated pass. The same predicate class in two other runners is TST-8 (ISSUE-363). |
| ISSUE-332 gates G1–G7 | Existing, dated; ISSUE-350 is a new prerequisite; nothing executed |
| ISSUE-348 D-336-3 (A) | Existing decision kept; ING-2/ING-3 added as implications |
| ISSUE-338–347, 349 fixes | Re-read where in scope (340, 341/342, 343, 344, 345, 346, 347, 349): no regression found. ISSUE-344 re-verified in a browser-free HTTP probe. TST-2 is a stale *test*, not a 341/342 defect |
| Worker-local rate limits; per-worker ISR staleness (ISSUE-134/308, D-316-10) | Accepted limitations; not reopened |
| Beta code/email revocation leaves 90-day beta cookies valid | Deliberate (`src/app/admin/access/actions.ts:80`, `docs/admin-and-beta.md:402`) |
| Submission promotion without a seal note (`src/lib/ingest/pipeline.ts`) | Deliberate (historical-baseline §2) |
| Bulk writers on sealed seasons (GAP-006) | Accepted limitation (`docs/v2/historical-baseline.md:52-57`) |
| 3 `nl:stress` execute failures (ids 41–43 `verified_finals_without_premiership`) | Existing data drift, ISSUE-219 |
| Gridley corpus strict failure (40 cells, 7 §23.36 criteria) | Accepted (`issues/closed/AFLDB-ISSUE-118.md:5400`) |
| 2026 Brownlow unresolved rows / career totals excluding unadjudicated 2026 votes | Deliberate D-316 Route B state (`CHANGELOG.md:1210`) |
| `'unsafe-inline'` script CSP | Known, tracked |

**Unverified hypotheses / leads not promoted** (no reproduction or no concrete trigger): concurrent `createMatch`
duplicates with differing free-text round codes (`match-admin.ts:267-278`); concurrent manual draft picks sharing a pick
number (`admin-draft.ts:421-505`, no unique index); `deleteMatch` leaving data-editor `matches` overrides keyed by
`match_key`; misleading `staleDerived` message (`data-edits.ts:506-509`); `writeIngestionSwitch` setting and audit not in
one transaction (`src/app/admin/current-season/actions.ts:139-149`); `migrate.ts --target test|code-test` without a
`_test` name check (`tools/db/migrate.ts:92,199`) and no report of ledger rows unknown to the checkout; `CLAUDE.md:73-74`
monitoring block unreachable in `afldb-settle-afltables.sh` (exits at :165-166); `family_siblings.py:445-449` /
`father_son.py:322-327` `debut_season or 0`; a recurring single-match build failure refusing every night without
escalation; no unique id tiebreak in admin query-builder and Grid Solver drill-down ordering; `brownlow_votes_career_min`
reads `c.brownlow_votes` rather than `acceptedBrownlowRowsSql()`; invite redemption without a `used_at IS NULL` guard
(no privilege gain found); `middleware.ts` deprecation in Next 16 (add a built-server gate test); autocomplete
`Cache-Control: public` on a gated host (no shared cache today).

---

## 3. Tests and evidence

Workspace: streamanator `/mnt/ssd/afldb-review-20261114T0640Z` (clone of GitHub at the reviewed SHA, lock
`984b4422…8e86`, Node 22.23.2, PG16 isolated loopback cluster 127.0.0.1:55520, template `afldb_v2_rvtmpl_test` = the
approved restore-verified production snapshot `afldb_prod-20261104T021037Z.dump` sha256 `e77c307d…826d`, ledger 118;
databases `afldb_v2_rv*_test` only; cluster stopped at the end; DEV `afldb` MainPID 1732 and PostgreSQL 1531 unchanged).
Curated evidence: `docs/v2/evidence/full-review-20261114/baseline/` (harness `review-host.sh`, phase logs, failure
lists, checksums of the large JSON reports kept on the host).

### 3.1 Baseline (automated, raw)

| Phase | Result |
|---|---|
| Typecheck (`next typegen && tsc --noEmit`) | PASS |
| ESLint | FAIL rc=1: 607 errors, 149 warnings (ISSUE-364) |
| Unit (all non-integration Vitest, no DB) | **FAIL: 107 failed, 11,739 passed, 41 skipped (11,887); files 11 failed, 204 passed, 1 skipped** |
| Integration (all 99 files, serial, one snapshot copy) | **FAIL: 99 failed, 3,046 passed, 2 expected-fail, 408 skipped (3,578); files 19 failed, 71 passed, 9 skipped** |
| `tests/restore-test.test.sh` | PASS 24/0 |
| `tests/sync-dev-remote.test.sh` | PASS 42/0 (generated-payload cases NOT RUN: need `tests/sync-dev-static.test.ps1 -ExportDir`) |
| Production build (`next build --webpack` + `prepare-standalone`) | PASS, BUILD_ID `AKIbVkG8laqOyXNMYgvN0` |

**Unit failure characterisation (107):** 78 environment (host `python3` lacks psycopg; the six suites pass with a working
interpreter — TST-6); 6 environment (gitignored DraftGuru frozen sample and fitzRoy snapshot); **21 real** (stale pin,
ISSUE-358 TST-1); 1 stale test (TST-2); 1 doc drift (TST-3).

**Integration failure characterisation (99):** 47 load/hook timeouts under shared host load (settle-afl-api 20,
player-link-concurrency 4, player-matching 6, settle-afltables 17) — on fresh copies run alone: 73/74 (the 1 is a
rebuild-target-name environment refusal), 8/8, 23/23, 85/85; 3 order-dependent (leaked 2094 fixtures, TST-9, or an
unidentified earlier mutation; pass fresh); 42 data-snapshot oracles pinned to a rebuilt `afldb_test` rather than
production (2026 sealed/complete, 2026 matches, DraftGuru production links, Coleman 2001 row; the two Brownlow cases
match the deliberate D-316 Route B state); 5 performance ceilings under shared host load (not rerun); 1 Python
environment; 1 accepted Gridley limitation. Setup-hook skips: admin-draft (52, needs an empty draft year),
settle-afl-api-issue276, v2-coleman-publication (snapshot rows), two v2-brownlow files (dedicated clone by design).
**These are not relabelled as passes.** The 2026-11-04 snapshot is the wrong oracle for suites pinned to a rebuilt
`afldb_test`, and that rebuild is itself blocked (ISSUE-358).

### 3.2 Focused reproductions (each in its own isolated database copy; raw under `$W/agents/<scope>/evidence/`)

| Scope | Runs |
|---|---|
| admin | `review-admin-1` 4/4 (ADM-1); `review-admin-2` 1/2, 1/2 (fixture query error), 2/2 (ADM-2); probes 1–3 (Brownlow round sums = season totals 1984–2025, 0 mismatches) |
| search | DB-free NL/grid suites 1,019/1,019; `nl:stress` V5 parse-only 12,000/0/0/0 at PARSER_VERSION 67 (= v65 baseline); parse+execute 11,997 pass / 3 fail (ISSUE-219) / noResults 2,049; grid 5/5, qualifying-matches 6/6, matchup 3/3; NL probes 40/31/27 questions |
| ingest | season-row reproduction 2/2 (run A 23503, run B control; the cases log outcomes); read-only snapshot queries q1/q2 |
| frontend | local production build PASS; 74 parameter probes; 49 pages × 3 timings; 15 pages × 2 viewports Playwright hydration (0 console/page errors, no overflow); bundle scan (no server code, no DSN); EXPLAIN ANALYZE; 8-client load; sitemap 4,785 × 200, 47 × 308, 0 × 404 |
| auth | 36 anonymous gate probes on a loopback `next dev` (case, encoding, traversal, RSC/prefetch, `x-middleware-subrequest`, sitemap, OG image, APIs): all correct; cross-origin Server Action refused; isolated Caddy 2.11.9 log and apex-routing probes; middleware Vitest 2/2 |
| ops | `bash -n`/`sh -n` 19/19 scripts; `date -d` parsing of systemd local timestamps (AEDT/AEST) correct; `shellcheck` not installed (not run) |
| tests | single-file reruns with a working Python; 3 vacuous tests converted to `throw` → exactly 3 fail; 5 of 6 uninvoked Python contracts pass, fitzRoy fails rc=1; 19/19 and 6/6 for DB suites outside `tests/integration` |

### 3.3 Live read-only checks
See `docs/v2/evidence/full-review-20261114/live-checks/RESULTS.md` (identity, restart, backups, season rows, DraftGuru
sizing, orphans, overrides, Grid audience, NL log, Caddy, ISR tree, AFLW slugs).

### 3.4 Not verified / limits
- **Knowledge graph:** AGENTS.md at the reviewed revision has no graph section, and the `codebase-memory-mcp` server failed
  to connect this session (CLAUDE.md §15 also lists it as not granted). No project, index generation or coverage could be
  confirmed. `semble` hybrid search and targeted source reads were used instead. **No exhaustive-coverage claim is made.**
- Not run: Windows `*.ps1` tests (no pwsh on the host), Playwright e2e/nl-ui/admin-nav specs (reviewed only), the
  Gridley corpus, Python contracts under `tests/python/draftguru_*` that need psycopg against Stage A pages, any
  multi-worker production-mode server, any DEV database read (ISSUE-350 DEV state unknown), Caddy log token counts (root-only).
- Not reviewed in depth (time): ~16k lines of `admin-*.ts` beyond the mutation paths named; fixture-lifecycle business
  rules; Brownlow `runMatchMutation` internals and Coleman projection; most of `src/search/nl/parser.ts`/`vocab.ts`;
  Grid builders after ~line 1000; AFLW search; `promotion-check`, `promotion-inventory`, `prove-reset`, fingerprint tools,
  `merge-readiness`/`bootstrap`/`preflight-core` internals, `sync-dev.ps1`/`sync-dev-transport.sh` depth, Caddy beyond
  logging/forwarding, installers, `gap029-stage.ts`; migrations 116–117; the Brownlow settle (timer disabled).

---

## 4. Coverage matrix

| Scope | Reviewed (source) | Tested | Live read-only | Blocked / limited |
|---|---|---|---|---|
| Application correctness (public pages) | All public dynamic routes, params, ISR config, sitemap, home records | Local prod build probes, hydration, sitemap crawl | ISR tree, AFLW slugs | Multi-worker cache sharing |
| Data integrity / invariants | NULL vs zero, ties, club identity, player identity, Brownlow authority, provenance/overrides, audit, seals across admin, search, frontend, ingestion | Reproductions ADM-1/2, SRCH-1, FE-4; Brownlow sums | Orphans, overrides, season rows | — |
| Authentication / security | Middleware, sessions, TOTP, credentials, full authz inventory, CSRF, redirects, headers, injection, SSRF, email intake | 36 gate probes, CSRF probe, Caddy probes, middleware test | Caddy version/log mode | Log token counts (root-only) |
| Admin workflows | Data editor, match/match sheet, coaches, draft, player links, Brownlow, special records, audit map | Integration reproductions | — | Fixture lifecycle, awards rules, Coleman (depth) |
| Search / NL / Grid Solver | Typed search, NL pipeline stages, plan/describe, Grid helpers, qualifying matches | DB-free suites, nl:stress V5 (parse + execute), reproductions | Grid audience, NL log | Gridley corpus, most of parser/vocab |
| Frontend behaviour | Routes, components, client bundles | Hydration (Playwright), probes | — | Full visual review |
| Performance | Hot queries, pool fan-out | EXPLAIN ANALYZE, timings, load | ISR tree size | Production load |
| Ingestion | AFL API settle, fixtures CLIs (343), identity, TZ/DST, seals, DraftGuru importer, rebuild | Season-row reproduction | Seasons, clubs, DraftGuru sizing | Brownlow settle, python contracts needing psycopg |
| Deployment | release.mjs, units/timers, drop-in, sync-dev gates, settle wrappers | Shell harnesses, syntax checks | Release identity, timers, restart attribution | systemd rehearsal of the promote window |
| Backup / recovery | backup.sh, restore-test.sh (341/342), DR doc | restore-test harness 24/0 | Backup schedule, backup listing | Root crontab |
| Test coverage | All suites, Playwright configs/runners, python contracts, invariant pinning | Full unit + integration baseline, characterisation reruns | — | ps1 tests, e2e specs (not run) |
| ISSUE-332 / 348 implications | Operating record, gates, importer | Season-row reproduction | Seasons, DraftGuru sizing | Gated operations not executed (by instruction) |

---

## 5. Remediation batches (prioritised)

1. **Before Opening Round 2027 (ingestion survival) — ISSUE-350, ISSUE-332 note.** Season-row/club-identity rollover step
   (or settle ensure-row) with an audited production write under its own approval; add the pre-Opening-Round read-only
   check and an `OnFailure=` notifier to the ISSUE-332 register. Verification: reproduction run A reaches the
   completeness gate; read-only production probe.
2. **Production operations — ISSUE-351, ISSUE-352.** Patching/restart policy and release-window gate; backup schedule or
   accepted data-loss window; DR doc rewrite. Owner decisions first, then reviewed units.
3. **Data integrity in admin paths — ISSUE-353, ISSUE-354** (one admin regression pass, integration cases from the
   reproductions), then **ISSUE-348 ING-2/ING-3** before the Nov–Dec DraftGuru acquisition.
4. **Wrong public answers — ISSUE-355, ISSUE-356, ISSUE-360** (Grid NULL guard, NL parser cases with the V5 corpus,
   tie/links presentation).
5. **Restore a green gate — ISSUE-358, then ISSUE-363** (pin update, stage map, shape test; Python resolver,
   vacuous tests, beta-action tests, runner predicates, fixture isolation), so later batches are qualified by the full suite.
6. **Hardening before the beta gate is lifted — ISSUE-357, ISSUE-359, ISSUE-361, ISSUE-362, ISSUE-364.**

## 6. Decisions requiring the owner

1. **ISSUE-350:** approve the method and timing of creating the 2027 `seasons` row and reconciling the 18 clubs'
   `last_season` on production (a production write; also decide whether the settle should create future season rows itself).
2. **ISSUE-351:** host patching policy — keep unattended upgrades with needrestart held for `afldb`/`postgresql` and
   owner-scheduled restarts/reboot (the pending reboot included), or move upgrades into an owned window; and whether
   release packets must gate on apt/needrestart/reboot state.
3. **ISSUE-352:** scheduled backups with off-host copy and weekly restore verification, or an explicit acceptance of
   per-operation backups with a maximum data-loss window.
4. **ISSUE-348:** confirm the raised severity and whether the next acquisition must enforce the origin-review input and
   the subset check in code, or remain a manual gate by decision.
5. **ISSUE-358:** confirm the McGovern sibling row belongs in the canonical rebuild (the reviewed pin update follows from it).
6. Implementation authority for each batch above (this review implemented nothing).
