# Remediation run 2026-11-14 — plan and scope briefs

Base `5035ed96` (GitHub `origin/main` `de640826` + review records). Integration branch `claude/remediation-20261114`
(worktree `D:\dev\afldb-rem-20261114`). Protocol: `AGENT-PROTOCOL.md` (binding). Dependency order of integration:
1 verification (pins, tests) → 2 data/imports (admin, draftguru) → 3 public answers (nl, answers) → 4 routes/perf/auth/tooling
(routes, perf, auth) → 5 operations (rollover, hostops) → 6 integrated qualification and review (orchestrator).

| Scope | Issues / findings | Worktree / branch suffix | Host port | Build allowed | Prod/DEV read-only |
|---|---|---|---|---|---|
| pins | 358 (TST-1, TST-2, TST-3); 363 TST-5, TST-6 | `pins` | 55611 | no | no |
| tests | 363 TST-4, TST-7, TST-8, TST-9 | `tests` | 55612 | no | no |
| admin | 353, 354 | `admin` | 55613 | no | no |
| draftguru | 348 (ING-2, ING-3) | `draftguru` | 55614 | no | no |
| nl | 356; 360 SRCH-7, SRCH-5; 359 SRCH-6 | `nl` | 55615 | no | no |
| answers | 355; 360 FE-4; Gridley corpus | `answers` | 55616 | yes (one, for FE-4 visual) | no |
| routes | 357; 359 FE-2, FE-3; 360 FE-7; 364 `next dev` sitemap conflict | `routes` | 55617 | yes | no |
| perf | 361 FE-5, FE-6 | `perf` | 55621 | yes (one, for timing) | no |
| auth | 362 SEC-1, SEC-2; 364 lint | `auth` | 55618 | no | no |
| rollover | 350; 332 preparation (failure detection, pre-Opening-Round check, operator recovery) | `rollover` | 55619 | no | yes |
| hostops | 351; 352; 364 serving-checkout `node_modules` | `hostops` | 55620 | no | yes |

File ownership to avoid conflicts: only `routes` edits `src/app/sitemap*`; only `hostops` edits `deploy/release.mjs`,
`deploy/afldb-settle-afl-api.sh` and `docs/backup-restore.md`; only `rollover` edits `deploy/afldb-settle-afl-api.service`/`.timer`
and new failure-notifier units; only `auth` edits `deploy/Caddyfile*`, `src/middleware.ts`, `eslint.config.*`;
only `nl` edits `src/search/nl/**` and `src/search/query-intent.ts`; only `answers` edits `src/db/queries/grid-solver.ts`
and home-record files; only `pins` edits `tools/db/rebuild-test.ts` and the six Python-backed suites; only `tests` edits
the three vacuous integration suites, `settle-afltables`/`awards-reload-links` fixtures and new beta-action tests.
If you must touch another scope's file, keep the change minimal and name it in your report.

---

## pins — ISSUE-358 and ISSUE-363 TST-5/TST-6
- **TST-1 (pin):** establish the provenance of the McGovern sibling row added by `c16d7fad` (GAP-029 D4): which owner
  decision approved it, whether it is applied on production (the snapshot shows the production state), and whether the
  canonical rebuild is meant to include it. If established, update the pin in `tools/db/rebuild-test.ts` and add a
  DB-free test that recomputes **every** reviewed input pin from the tracked files (so no pin can go stale silently).
  Check every other pin while there. Fix the stale oracle `tests/integration/nl-answers-relationships.test.ts:52`
  (658 vs 660) only after establishing the correct value. If provenance is ambiguous, prepare both options (pin update
  vs. reverting the row) with consequences, and continue the rest.
  If the rebuild inputs are available on the host per the documented procedure, prove a disposable `afldb_test`-style
  rebuild now passes preflight (and as far as practical) on your own cluster; otherwise prove preflight passes the pin check.
- **TST-3:** `docs/v2/architecture.md` §9 stage map: find how it is produced/checked (`tests/v2-acquisition-pipeline.test.ts:372-375`)
  and correct it (regenerate if a generator exists).
- **TST-2:** `tests/db-promotion-check.test.ts:7592-7606`: re-pin the ISSUE-250 hash-before-clear order against the
  current `tools/maintenance/restore-test.sh` (the ISSUE-341/342 `printf` form) without weakening it.
- **TST-6:** six Python-backed suites read `PYTHON` but not the documented `AFLDB_PYTHON`; make them honour the documented
  resolver (reuse an existing helper if one exists). Prove: with only `AFLDB_PYTHON` set to the venv, the six pass.
- **TST-5:** seven `tests/python` contracts run by no suite: wire them into an existing Vitest wrapper (or the closest
  existing runner) and fix `fitzroy_profile_continuity_contract.py:77-78` only after verifying what `c7e17da2` changed
  (79 → 150) was intended. Name the seven.
- Qualification: `tests/db-test-rebuild.test.ts tests/v2-acquisition-pipeline.test.ts tests/db-promotion-check.test.ts`
  plus the six Python suites plus the new wrapper; then the whole unit gate once (no DB vars, with the venv Python):
  report counts and classify every remaining failure.

## tests — ISSUE-363 TST-4, TST-7, TST-8, TST-9
- **TST-4:** `tests/integration/venue-records.test.ts:209-221` (NULL-vs-zero attendance), `player-matching.test.ts:183-205`,
  `club-coach-records.test.ts:220-233` return early when their subject is missing. Make each test deterministic: seed
  its own synthetic subject (inside the test's transaction/cleanup conventions) so it runs on both a snapshot copy and a
  rebuilt DB, and fail loudly if the subject is absent. Prove each now actually asserts (red by breaking the assertion
  target temporarily, or by showing the early return before).
- **TST-7:** add tests for `src/app/beta/actions.ts` (`safeDestination`, `redeemAccessCode`, `requestMagicLink`, join
  request), `src/app/consent-action.ts`, `src/app/player-link-suggestion-action.ts`, in the closest existing suites
  (search `tests/` for beta/consent/suggestion tests first). Cover open-redirect refusal, rate limits/refusals, and success.
- **TST-8:** runners using `/\/beta/` against an absolute Location (`docs/v2/evidence/issue336-337-340-345-release-execution-20261111/scripts/prod-accept-headed.cjs:50`,
  `docs/v2/evidence/issue336-draft-categories-20261105/dev-deploy-20261106/runners/dev-accept-headed.cjs:43`). Historical
  evidence is preserved: do not rewrite those files; add an `ERRATA.md` beside each, and if any current procedure or tool
  reuses them as templates, provide a corrected, tested predicate (pathname-based) where future runners will take it from.
- **TST-9:** `tests/integration/settle-afltables.test.ts` leaks season-2094 fixtures when interrupted, and
  `awards-reload-links.test.ts:4274` also uses 2094. Give each suite a unique season, pre-clean in `beforeAll` and clean
  in `afterAll`; prove an interrupted run no longer breaks `admin-season-lists`/`release-gates`.
- Qualification: each touched suite on a fresh snapshot copy, run alone.

## admin — ISSUE-353 and ISSUE-354
- **353:** under the existing locks, refuse a Match Sheet `remove` (and a `club_id` change) while the player has
  Brownlow round votes or vote-entry state, `player_achievements`, `after_siren_kicks` in the match, using `deleteMatch`'s
  refusal shape (`src/db/queries/match-admin.ts:464-549`); same for `returnMatchSheetToSource` `withdraw_delete_row`.
  Period stats: establish from schema (FKs/cascade) and docs what happens today; if the right behaviour is not
  determinable from existing contracts, implement the refusal set above and present period stats as an owner decision.
  Re-use the review reproductions (`agents/admin/evidence/adm1.out`) inverted: exact refusal text, dependents unchanged.
- **354:** `saveCoachMetadata` (`src/db/queries/admin-coaches.ts:593-605`), `saveSourcePickFields` (`admin-draft.ts:767-788`)
  and `data-edits.ts:265-288`: merge only from an active override row (start from `{}` otherwise); record any carried keys
  in the `data_edits` row; keep the ISSUE-160 contract ("a retired selection is never resurrected"). Inverted
  reproductions (`adm2c.out`). Note: `D:\dev\afldb` has unrelated uncommitted edits to `admin-draft.ts`; ignore them.
- Qualification: the integration suites you touch (`tests/integration/admin-draft.test.ts` needs an empty draft year —
  seed one; see memory note on synthetic seeds), `tests/match-sheet.test.ts`, `tests/admin-match-mutations.test.ts`, the
  coach admin suite, each on a fresh snapshot copy.

## draftguru — ISSUE-348
- Implement a fail-closed guard in `tools/rebuild/draftguru/import_draftguru.py` (and `common.py` only if needed) so a
  normal-mode import refuses (also under `--dry-run`, which must report the refusal) when: stored DraftGuru pick keys are
  not a subset of incoming keys; or any pick/person to be deleted or rewritten has `data_edits`, active `data_overrides`
  or was inserted by an audited correction (the 35 D-336-2 picks ids 6819–6853 and their 31 persons, recognised by their
  audit/provenance, not by hard-coded ids alone); or `original_club_raw` would change for stored rows without an
  origin-review input. The only way past is an explicit, reviewed reconciliation/re-baseline input (a file naming the
  exact keys and their digest) — design it so the D-336-3 classifier output can be that input, and so REPLACE_CLUB rows
  (5961, 6784, 6626 at least) still require an explicit owner ruling: do not adjudicate them.
- `--link-only` behaviour unchanged. Correct the I336 comment named in the review.
- Tests: Python contract tests in the closest existing home (`tests/python/draftguru_*` or the Vitest wrapper that runs
  them) using synthetic in-repo fixtures, plus a DB case on your isolated snapshot copy (the snapshot holds 6,845 picks?
  verify — it was captured 2026-11-04, before D-336-2; seed the audited rows synthetically if absent) proving
  `--dry-run` refuses and nothing is written. Use the venv Python (has psycopg). Stage A pages are not needed for the guard.

## nl — ISSUE-356; ISSUE-360 SRCH-7, SRCH-5; ISSUE-359 SRCH-6
- **356(a)** bare "least" → `min` (not when part of "at least"); **(b)** ranked metric + marquee predicate ("most goals in
  a showdown/on anzac day") → answer the per-match question correctly if the plan grammar supports it, else decline
  honestly; fill the "X+" explain label and render predicate parameters in `describePlan`; **(c)** refuse prefix-only
  surname matches for stat/period vocabulary ("quarter" ≠ Quartermain) at certainty 1.
- **SRCH-7** tie headline must use the true tied count, not the capped rows (`src/search/nl/describe.ts:37-71`).
- **SRCH-5** "Richmond v Carlton" intent must link head-to-head, not either-club (`src/search/query-intent.ts:163-172`;
  check `src/db/queries/match-search.ts:72-76` supports head-to-head params; if not, smallest correct support).
- **SRCH-6** `/search/qualifying-matches`: validate the plan token shape (refuse → 400/notFound, not 500) and cap the
  drill-down with a disclosed total.
- Follow `CLAUDE.md` §8; bump `PARSER_VERSION` per the documented convention if parse output changes. Tests in
  `tests/nl-parser.test.ts`, `tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`, `tests/query-intent.test.ts`,
  NL PostgreSQL integration on a snapshot copy. Then the V5 parse-only corpus (baseline 12,000/0/0/0 at PARSER_VERSION 67)
  and parse+execute (baseline 11,997 pass / 3 fail ISSUE-219) on your snapshot copy: report deltas and explain each.

## answers — ISSUE-355; ISSUE-360 FE-4; Gridley
- **355:** `src/db/queries/grid-solver.ts:262-273` live-only `ledSeasonRows`: NULL guard (`HAVING sum(...) IS NOT NULL`
  pattern of `player-season.ts:119`); check the other live-only builders in that file for the same NULL-as-lead/zero
  pattern and fix any you prove. Clearances case in `tests/integration/grid-solver.test.ts` (10,966 → 178 on the snapshot).
- **FE-4:** home "Record of the week" must not hide tied holders at the cutoff (`src/app/page.tsx:82`,
  `src/db/queries/home-records.ts:112-181`, `src/components/HomeRecordPanel.tsx:70-100`). Keep the panel compact:
  include ties at the cutoff or show an explicit "and N more tied" marker linking to the full record — choose from
  existing UI conventions. UI change ⇒ Visual Evidence Mandate: declare viewports (1280×800, 390×844) and states before;
  capture before/after with the host Playwright against a production build on your cluster.
- **Gridley:** run the Gridley corpus (see `tests/` and docs; accepted limitation 40 cells per ISSUE-118) before and
  after your grid change and report deltas.

## routes — ISSUE-357; ISSUE-359 FE-2, FE-3; ISSUE-360 FE-7; ISSUE-364 `next dev` sitemap
- **357:** one strict id/season parser (`^[1-9]\d*$`, within int4 range) used by `parseEntitySlug`, `parseSeason`,
  `matches/[id]`, players/coaches/clubs/venues/honour-teams/seasons/brownlow routes; non-canonical spellings →
  `permanentRedirect` to the canonical URL or `notFound()` — decide per route from existing conventions; compare the whole
  `slug-id` on players. Investigate (Next 16 docs in `node_modules/next/dist/docs/`) whether `notFound()` renders are
  persisted by ISR and whether a supported setting avoids persisting them; implement only if supported and safe.
  Prove with a local production build on your cluster: `/seasons/02024` → 308/404 and no new ISR file; 200 random
  404 paths add no files (or record the residual precisely).
- **FE-2:** ids ≥ 2^31 → 404, not 500 (players, player matches, coaches, matches, `/api/coaches/<id>/opponent-record`).
- **FE-3:** one safe-decode helper for AFLW slugs/keys (players, matches, seasons, clubs): metadata and page decode
  identically; malformed escapes → `notFound()`. 17 live `%` slugs must get correct titles/canonicals.
- **FE-7:** sitemap must list canonical (non-redirecting) URLs only (`src/app/sitemap.ts:140,147-152`).
- **364:** `next dev` "Conflicting route and metadata at /sitemap.xml" (`src/app/sitemap.ts` vs
  `src/app/sitemap.xml/route.ts`): resolve keeping production output byte-equivalent (prove the sitemap response before/after).
- Tests in the closest existing suites; probes on a production build; Playwright hydration smoke on the changed pages
  (desktop + mobile), screenshots for any rendered change.

## perf — ISSUE-361
- **FE-5:** `src/db/queries/players.ts:133-154`: compute club names only for the returned page (e.g. a CTE that
  selects the page ids first), and keep ordering/tiebreaks and the past-the-end redirect identical. EXPLAIN ANALYZE on a
  snapshot copy before/after at OFFSET 13,300, and an equality test of page contents before/after across sorts.
- **FE-6:** `/clubs/compare` ~22 queries per pair on a pool of 10: reduce fan-out (combine queries or bound
  concurrency) without changing results; prove result equality and measure under the review's 8-client load
  (`agents/frontend/evidence/`). Do not change the pool size without evidence.

## auth — ISSUE-362; ISSUE-364 lint
- **SEC-1:** Caddy access logs must not record magic-link tokens (`/beta/verify?token=`), invite tokens
  (`/admin/invite/<token>`) or search queries, in `deploy/Caddyfile.production` and `deploy/Caddyfile`; correct the
  comments. Prove with a real Caddy (the review used an isolated Caddy 2.11.9 on the host; production runs 2.11.4 — check
  the filter syntax exists in 2.11.4) that the log lines are redacted and routing unchanged (`caddy validate` + probes).
  No live change: the installed `/etc/caddy/Caddyfile` stays as is; the packet will carry the install step.
- **SEC-2:** `src/middleware.ts:136-148` accepts a signed admin claim at the beta gate without DB session or epoch:
  make `AFLDB_BETA_EPOCH` (or an admin-claim epoch) invalidate admin claims issued before it, and/or shorten trust;
  middleware cannot hit the DB cheaply — choose the smallest sound fix, test in the existing middleware/auth suites,
  document the residual (≤ TTL) honestly.
- **364 lint:** `eslint .` 607 errors/149 warnings. Do not mechanically silence. Exclude only directories that are not
  source (archived evidence under `issues/`, `docs/**/evidence/**`) with a stated reason; fix the 17 `src/` errors
  properly; measure `tests/` and `tools/` debt; propose (implement if clean) a lint gate in the existing merge-readiness/preflight
  route scoped to what is green, with the debt baseline recorded.

## rollover — ISSUE-350; ISSUE-332 preparation (read-only prod/DEV checks granted)
- Establish the season-creation and active-club lifecycle from existing contracts: `seasons` columns and statuses,
  who creates/advances them (`tools/migration/load_reference_data.py`, `seasons.json` 2027 entry, `createMatch`'s ensure,
  `tools/db/rollover-season.ts`), `clubs.last_season` and club identity history (`afldb_identity_for_season`), how
  rebuilt databases represent 2027. Do not invent competition dates; do not modify historical club identity to bypass
  validation; extend only what the contracts define as the open era of a current club.
- Implement the smallest auditable, idempotent rollover operation (plan / apply / verify, dry-run default, target
  identity guard, single transaction, before/after digest, audit record consistent with existing ops audit patterns,
  explicit refusal on unexpected state). Decide with evidence whether the settle should also pre-check the season row
  and fail fast with an explicit message (do not make the nightly create seasons silently).
- Add a read-only "season row and current-club identities exist for <year>" check usable as an ISSUE-332 gate.
- Rehearse on a fresh snapshot copy: review reproduction run A (23503) before; plan → apply → verify; run A again reaches
  the completeness gate; second apply is a no-op; recovery/reversal procedure rehearsed if dependents absent. Raw logs.
- Read-only: production and DEV current state of `seasons`/`clubs` for the rows involved (aggregates), to populate the
  approval packet pins (expected before-state digest).
- **332 prep:** a failure notifier for `afldb-settle-afl-api.service` (`OnFailure=` unit or a monitored marker) using an
  existing channel (email via the app's configured mailer if reusable; else a marker file + documented check), prepared
  in `deploy/` but not installed/enabled; `systemd-analyze verify` it on the host (user-level, no install); an operator
  recovery runbook for a failed nightly (what to check, how to re-run safely). Do not edit `deploy/afldb-settle-afl-api.sh`
  (owned by hostops).

## hostops — ISSUE-351; ISSUE-352; ISSUE-364 serving `node_modules` (read-only prod checks granted)
- **351:** verify read-only on production which controls are effective: unattended-upgrades origins/Automatic-Reboot,
  `needrestart` mode (`/etc/needrestart/needrestart.conf`, `conf.d`), `apt-daily-upgrade.timer`, reboot-required, which
  services needrestart would restart. Prepare (not install) a policy: keep timely security updates; make `afldb` and
  PostgreSQL restarts and reboots explicit (needrestart override for those units; owned maintenance window); a release
  packet gate script (apt/needrestart/reboot-required/next timer) and a state probe that records
  `InvocationID`/`NRestarts`/`ActiveEnterTimestamp`; promote+restart adjacency in `deploy/release.mjs` (e.g. refuse
  promote/rollback without an explicit attended flag, or a combined attended step) plus a ledger-compatibility check on
  `rollback --to`, with tests in the existing release tests. Present the pending reboot and a maintenance window as a
  separate owner operation with procedure and recovery.
- **352:** prepare and rehearse on streamanator: scheduled backup (`tools/maintenance/backup.sh`) units/timer outside
  05:00–05:30 and the apt window, weekly `restore-test.sh` verification, off-host retention (propose destination;
  rehearse the copy+verify to a local stand-in), permissions, monitoring and failure handling; proposed RPO/RTO.
  Rehearse against your isolated cluster copy (never production). Rewrite `docs/backup-restore.md` §6 for V2. Do not
  claim certainty about root-only configuration you cannot read.
- **364:** the serving checkout's `node_modules` (run by timers) is outside every release check: add the smallest check
  (lock hash vs installed tree) in the settle wrapper preflight or `release.mjs status`, tested.
