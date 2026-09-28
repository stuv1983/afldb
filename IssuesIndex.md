# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.
>
> Runbooks live under `issues/`, not at the repository root: `issues/open/<ISSUE-ID>.md` while
> the issue is open, `issues/closed/<ISSUE-ID>.md` once it is resolved, together with any
> `-HANDOFF.md` companions and evidence artefacts. Historical entries below name a runbook by
> filename only; resolved ones are in `issues/closed/`.

**Open issues:** 11

### AFLDB-ISSUE-252 — Production promotion cannot reinstate production-owned state that references current-season rebuilt entities absent from `afldb_test`
- **Severity:** High. **Area:** production promotion / current-season lifecycle / lineage
  reinstatement — `docs/production-promotion.md`, `brownlow_vote_entry_state`, `matches.match_key`.
- **State:** Open (2026-09-27), from a fresh ISSUE-237 L5 PROD attempt (promotion stamp
  `20260927-142540`). **Blocks ISSUE-237 L5 PROD.**
  - PROD's `brownlow_vote_entry_state.match_id = 17795` (stable identity
    `2026|1|2026-03-05|Sydney|Carlton`) had no corresponding `matches.match_key` in the candidate:
    `afldb_test` currently holds no 2026 matches (`candidate_2026_matches = 0`).
  - `--phase restored` correctly REFUSED with `identity_absent_in_candidate`. No lineage-remap or
    AFL API supersede file was published; no reinstatement; no swap.
  - Root cause: the promotion procedure assumes current-season football data can be reacquired
    after promotion, which is unsafe once production-owned state (Brownlow workflow rows) already
    references a current-season match before the swap. General lifecycle gap, not match-specific.
  - Everything else in the same run PASSED: ISSUE-251's registration lifecycle, ISSUE-237 G2/G3,
    and first-kick-goal lineage (334/334).
  - Safety boundary: no inserting rows directly into the candidate; no weakening production-owned
    state, the lineage gate, or fallback matching by date/round/club/name/local ID.
  - The failed candidate `afldb_prod_candidate_20260927-142540` is retained as evidence and must not
    be mutated or resumed. PROD was token-bound unfrozen and returned healthy.
- **Key files:** `docs/production-promotion.md`, `tools/db/promotion-check.ts` (lineage gate),
  `tools/db/promotion-inventory.ts` (contract), `tools/db/rebuild-test.ts`,
  `tools/current-season/*` (AFL API acquire/settle).
- **Runbook:** `issues/open/AFLDB-ISSUE-252.md`.
- **Investigation (2026-09-27, §10–§18, nothing implemented/run/committed).** The defect is general,
  not Brownlow-specific: `data_overrides` on current-season matches already hit the same class and
  was worked around by docs convention ("the promotion waits..."), and `data_edits` has the same
  latent, undeclared exposure on PROD. Root cause: the rebuild's season boundary is intentional
  (fitzRoy is only authoritative for a finished season) and must not change; the promotion
  contract's assumption that current season is safely re-acquired *after* the swap doesn't hold for
  staged/lineage-bound production-owned rows that must resolve *before* it. The canonical AFL API
  settle pipeline already supports an arbitrary target DSN and is already proven safe against
  `afldb_test`; recommended fix is to make full current-season population of `afldb_test` a
  documented, gate-enforced promotion-source prerequisite (reusing that pipeline unmodified), proven
  pre-freeze — not any change to the strict lineage-matching logic itself. Four solution models
  compared (runbook §14); a live-network reacquisition into the candidate during promotion was
  rejected outright (breaks "candidate is a faithful restore of an evidenced source", cannot be
  proven before PROD downtime).
- **Decisions (2026-09-27, runbook §18.1):** D-252-1 full current-season corpus; D-252-2 retained,
  manifest-sha256-bound snapshot, no network in promotion; D-252-3 mandatory blocking source gate
  before the freeze, `resolveLineageRemap()` unchanged; D-252-4 this issue owns
  `brownlow_vote_entry_state.match_id`, active `matches`/`match_coaches` `data_overrides`, and
  `data_edits` `matches` rows, reported per family; D-252-5 separate pre-promotion step,
  `db:test:rebuild` unchanged. Revised plan in §19 (rebuild / preparation / gate / restore /
  post-swap kept separate). Nothing implemented.
- **Decisions (2026-09-27, later, runbook §18.2):** D-252-6 two-phase hash-bound PROD dependency
  manifest (A pre-freeze, frozen B authoritative, set sha excludes `captured_at`); D-252-7 the
  operator records/enables/restores the `afldb_test` AFL API switch, the tool never writes it;
  D-252-8 ownership parity — AFL Tables source first, AFL API second, gate requires exact
  `match_key` + equal owner per dependency; D-252-2 amended to plural retained sources. Revised
  plan §21. Pure DB-free core + 24 tests implemented, uncommitted, not yet run.
- **Third pass (2026-09-27, runbook §22, uncommitted):** Q-252-9 decided (D-252-9a/9b: no AFL API
  fixtures-only or Brownlow settle in preparation). AFL Tables input now bound by manifest AND
  `observations.json` sha256 (the manifest does not list the bundle). **B1: retained source
  located, key/ownership acceptance pending the gate** — primary PROD `settle-2026-2026-09-22-0444`
  (manifest `9ff2928f…9008f26f7e`), fallback DEV `settle-2026-2026-09-26-0941` (`c46fc693…a33a8dc6`).
  `tools/db/prepare-promotion-source.ts` + `db:promotion:prepare-source` written; ISSUE-252 tests
  40/40, `tsc` clean. No database contacted.
- **Fourth pass (2026-09-27, runbook §23, uncommitted):** PROD primary snapshot copied to DEV
  and re-hashed byte-identical. `promotion-check.ts` wired: `--phase dependencies` (manifest A/B +
  frozen re-check), mandatory manifest + preparation record at `--phase source` (proof only on
  full PASS), proof required at prod `pre-cutover`. Docs/CHANGELOG/npm updated; A–T(+U)
  rehearsal script written, NOT run. Two real-run defects fixed. Tests 332/332, `tsc` clean.
- **Fifth pass (2026-09-27, runbook §24, uncommitted):** `code_test_db` rehearsal attempts 1–2.
  Two harness defects were fixed (empty-2026 restore; jsonb double-encoding), and residue is 0 with
  2026 exactly as found. C/F/G/H/J/M/N/O/R/S/T/U PASS. **STOPPED at A:** the AFL Tables settle
  counts every NEW match's same-run `pending_match` period scores as `unresolvedIdentityMatch`, so
  the §21.2 zero post-condition can never pass on a fresh `afldb_test`.
- **Sixth pass (2026-09-27, runbook §25, uncommitted):** Q-252-10 decided (option 1) and
  implemented. The first AFL Tables apply may carry `unresolvedIdentityMatch` alone, provisionally,
  bounded by the rows it inserted. A mandatory same-label AFL Tables `--dry-run` closure must then
  be all zero with no write before the AFL API phase starts. The record and proof (both schema 2)
  keep the two results separate. `code_test_db` attempt 3: **A–U all PASS**. First apply
  `unresolvedIdentityMatch` 1 (3 inserted), closure 0/0/0. Residue 0, 2026 as found, only sequences
  advanced. Tests 340/340, `tsc` and ESLint clean.
- **Seventh pass (2026-09-27, runbook §26, uncommitted):** Q-252-11 decided and implemented. The
  standalone `--dry-run` is an unproven preview with the same bounded tolerance; it writes no
  record or proof. `code_test_db` attempt 4: **A–V all PASS** (104 checks), residue 0, 2026 as
  found. Tests 346/346, `tsc` and ESLint clean.
- **Eighth pass (2026-09-28, runbook §27, uncommitted, DB-free).** This pass fixes the two blockers
  the real DEV preparation found.
  - **D-252-12.** The 36 `foreign_source_owner` AFL API refusals against AFL Tables-owned
    `player_match_stats` rows are expected disagreements. The settle now returns a structured
    refusal census. Preparation accepts only that narrow class, with count = counter and dry-run =
    apply digest. E3 is unchanged.
  - **D-252-13.** The retained current-season player bridge (proves exact retained-snapshot provider
    coverage even when replay is idempotent) is now a mandatory, hash-bound preparation input.
  - Record and proof are schema 3. Tests 375/375 and 630/630; `tsc` and ESLint clean.
- **Eighth pass acceptance (2026-09-28, later, runbook §27.7–§27.9, uncommitted).** The operator-run
  fresh-rebuild DEV rehearsal PASSED: 89/89 rebuild checks, 803 identities captured/reinstated, and
  the final fresh rebuild **did preserve `CD_I297354`** (bridge replay idempotent, 669/669 already
  linked). D-252-12's 36-row refusal census PASSED with dry-run/apply digest parity. Real PROD
  manifest A and the schema-3 source gate both PASSED (16/16 gates); the sole F1 dependency
  (`brownlow_vote_entry_state.match_id=17795` → `2026|1|2026-03-05|Sydney|Carlton`) resolved. No
  freeze, candidate, reinstatement or swap occurred. Not run: frozen manifest B. Not attempted:
  ISSUE-237 L5. Implementation is acceptance-proven, still uncommitted.
- **Operator acceptance (2026-09-28):** D-252-12 and D-252-13 are explicitly accepted by the operator
  on this evidence — fresh DEV rebuild/preparation rehearsal PASS, D-252-12 36-row classified refusal
  census PASS, D-252-13 669/669 bridge PASS, real PROD manifest A PASS, schema-3 source gate PASS
  16/16 (runbook §27.10). **ISSUE-252 itself is not yet resolved** and ISSUE-237 L5 has not passed.
- **Next action:** final diff/documentation review; commit/merge; deploy/synchronise through the
  normal procedure; then a completely fresh ISSUE-237 L5 PROD attempt under separate authorisation
  (its own manifest A/source proof/frozen manifest B). The retained failed candidate
  `afldb_prod_candidate_20260927-142540` remains evidence-only.

### AFLDB-ISSUE-251 — Production promotion cannot converge candidate-only manual player registrations when PROD has never held their AFL Tables paths
- **Severity:** High. **Area:** production promotion / manual player registration lifecycle —
  `tools/db/promotion-check.ts` (ISSUE-242 convergence, ISSUE-237 A4.2 gates),
  `tools/rebuild/draftguru/register_issue224_s9_players.ts`.
- **State:** Open (2026-09-26), from the first real ISSUE-237 L5 PROD attempt (promotion stamp
  `20260926-213225`). **Blocks ISSUE-237 L5 PROD.**
  - The L5 restored gate reached the retained candidate
    (`afldb_prod_candidate_20260926-213225`, OID `49077`) and REFUSED on exactly the ISSUE-242
    token-convergence gate and the ISSUE-237 A4.2 players-replay gate. G2 and G3 PASSed.
  - 92 candidate-only `manual_admin_edit` registrations were refused: PROD neither held their AFL
    Tables paths nor had PROD-local creation records for them.
  - Retained-candidate census: all 92 have exactly one accepted AFL Tables path and one AFL API
    identity; 3 of the 92 are referenced by `award_winners`; zero football statistics. The only
    attribution actor is `afldb_test`'s disabled, credential-free recovery `super_admin`.
  - Direction: an explicit, separately guarded PROD adoption mode for the pinned ISSUE-224
    92-player set, minting PROD-local registration tokens under a real enabled + enrolled PROD
    `super_admin`. No `afldb_test` token or actor is copied and no AFL API identity is written. A
    completely fresh L5 should then plan the normal ISSUE-242 `rebind B → A`.
  - ISSUE-242's candidate-only-orphan STOP is unchanged.
  - PROD was released from the ISSUE-250 freeze (now RESOLVED) and is healthy. The retained
    candidate is evidence and must not be mutated or dropped.
  - `register_issue224_s9_players.ts` currently and deliberately refuses PROD. ISSUE-251 is an
    authorised design change to that boundary, not a loosening of `assertNotProdLike()` or a bare
    `prod` addition to the target enum: PROD support is its own separately guarded mode with
    stronger requirements than test/DEV, and no PROD write is authorised yet.
  - D-251-5: PROD adoption pins the exact tracked
    `docs/rebuild-manifests/draftguru/issue224-s9-name-parts-20260922.json` name-parts artefact by
    SHA-256, established during implementation/review; an arbitrary `--name-parts` file is refused
    in PROD mode. Test/DEV keep the existing operator-authored, non-pinned artefact unchanged.
  - The tool's post-write checks (currently DEV-only) are to be factored into shared
    target-independent postconditions used by both DEV and PROD; PROD adds its own stronger
    boundary checks (exact host/database/role/revision, verified backup acknowledgement, a real
    enabled+enrolled PROD `super_admin`, no recovery/test actor, no AFL API identity written).
- **Key files:** `tools/rebuild/draftguru/register_issue224_s9_players.ts` and its tests,
  `docs/production-promotion.md`.
- **Runbook:** `issues/open/AFLDB-ISSUE-251.md`.
- **Next action:** (1) inspect the existing registration tool/tests and finalise the PROD-mode
  design against current code; (2) implement the separately guarded PROD adoption mode; (3)
  DB-free validation; (4) isolated real-DB rehearsal; (5) full diff/review and operator procedure;
  (6) only then request separate live PROD adoption authorisation. **No PROD write is authorised.**

### AFLDB-ISSUE-238 — Correcting a consumed trusted `afl_api` player link with canonical reattribution
- **Severity:** Medium. **Area:** admin / player identity — `external_identities` (`afl_api`),
  `player_match_stats`, `brownlow_round_votes`, `canonical_applications` and derived dependents.
- **State:** Open. Triaged 2026-09-26 and deliberately NOT folded into the bulk pass. It moves
  canonical statistics, which needs:
  - a collision/merge policy;
  - superseding ledger entries;
  - a new human-ledger correction action.

  These are operator data-semantics decisions. The dependency closure is recorded.
- **Runbook:** `issues/open/AFLDB-ISSUE-238.md`.
- **Next action:** operator decisions §5 (a–c), then the plan and review.

### AFLDB-ISSUE-234 — Optional AFL API feed expansion (extended statistics, umpires, play-by-play)
- **Severity:** Low. **Area:** data acquisition, investigation only.
- **State:** Open (2026-09-23), ISSUE-228 S10 successor. Optional; not required by the supported
  ISSUE-228 architecture.
- **Triage (2026-09-26): REMAINS OPEN / DEFERRED.** Nothing was built. The following are already
  retained raw and never projected:
  - `extendedStats`;
  - roster `umpires`, `weather` and `milestones`;
  - `scoreWorm` scoring events.

  No play-by-play feed is acquired. There is no model, and terms-of-use (§15 Q8) is open.
- **Next action:** none scheduled; investigate when a product need arises.

### AFLDB-ISSUE-233 — AFL API season discovery and season rollover ownership
- **Severity:** Medium. **Area:** season lifecycle — `data/reference/afl-api-identities.json`, the
  rollover runbook, `stat-availability.json`.
- **State:** Open (2026-09-23), ISSUE-228 S10 successor. Replaces resolved ISSUE-101/F as owner of
  the rollover runbook change.
  - **2026-09-26 (pass 2):** decided D-233-1 = proposal JSON; D-233-2 = season-scoped AFL API
    Brownlow artefacts loaded beside the master, gated by `stat_availability`; D-233-3 = preserve
    `afl_api` ownership or refuse (fail closed while any `afl_api`-owned match is in a completed
    season being rebuilt; 2026 has 0).
  - Discovery is **IMPLEMENTED / DB-FREE VALIDATED** against the authentic `compseasons` sample
    (`tests/fixtures/afl_api/seasons/00-compseasons.raw.json`, sha256 `fe3f1641…d965`):
    `discover-afl-api-seasons.ts`, proposal-only; a registered mismatch is a refusing finding.
  - D-233-2/D-233-3 are planned (runbook §4.3), not implemented.
- **Runbook:** `issues/open/AFLDB-ISSUE-233.md`.
- **Next action:** implement D-233-3's rebuild census refusal and D-233-2's season-scoped
  Brownlow load (runbook §4.3); first real `--fetch` discovery on DEV.

### AFLDB-ISSUE-232 — AFL API operational wiring: systemd timers, Brownlow scheduled settle and admin status
- **Severity:** Medium. **Area:** deployment / operations — `deploy/afldb-settle-afl-api*`,
  `src/lib/acquisition/settle-status.ts`, `settle-trigger.ts`, `/admin/current-season`.
- **State:** Open (2026-09-23). The units ship and are not installed on any host.
  - **2026-09-26:** `/admin/current-season` now shows both AFL API units' systemd state and latest
    batch (`AflApiSettleUnitsPanel.tsx`, read-only). It is **IMPLEMENTED / NEEDS DEV OPERATOR
    ACCEPTANCE**, `VISUAL: UNVERIFIED`.
  - **2026-09-26 (pass 2):** decided D-232-1 = B (the wrapper passes `--use-fixture-identity`,
    the operator-approved reversal of ISSUE-244 §40), ordering O1, and D-232-3 = keep (no
    automatic revalidation).
  - The Brownlow wrapper now runs fixtures-only acquire → fixtures settle → Brownlow acquire →
    Brownlow settle: **IMPLEMENTED / DB-FREE VALIDATED**, not installed or enabled.
  - `settle-afl-api-fixtures.ts` moved to the shared F029 loader (its private loader would have
    restored stripped credentials under systemd).
  - The chain now also needs the current-season ingestion switch.
- **Runbook:** `issues/open/AFLDB-ISSUE-232.md`.
- **Next action:** DEV sync, eyeball the panel (`VISUAL: UNVERIFIED`), then the runbook §7
  installation pass with a first observed Brownlow firing.

### AFLDB-ISSUE-229 — AFL API fixture ingestion
- **Severity:** Medium. **Area:** acquisition / fixtures — `afl_api` season feed → `fixtures`,
  `canonical_applications`, `admin-fixtures.ts`.
- **State:** Open (2026-09-23). Fixture ingestion only.
  - **2026-09-26 (pass 2): PARTIALLY EVIDENCED, STILL BLOCKED.** One authentic `SCHEDULED`
    record (`CD_M20260142901`, the 2026 Grand Final, captured 7 days before the match) is now
    hash-bound (`tests/fixtures/afl_api/match/04-season-feed-scheduled.raw-slice.json`).
  - That record has no score block at all, and today's contract refuses it. It defines only the
    `SCHEDULED` row. Every other status, and postponement/cancellation, is unobserved.
  - No writer was built.
- **Runbook:** `issues/open/AFLDB-ISSUE-229.md`.
- **Next action:** operator decides whether D-229-1/D-229-2 may proceed on the single `SCHEDULED`
  citation (runbook §2a), or waits for more captures (§3).

### AFLDB-ISSUE-230 — `afldb_test` 2026 AFL Tables spine carries 2099 observation timestamps from the 2026-09-06 settle benchmark
- **Severity:** Low. **Area:** test database hygiene: `afldb_test` `staging.source_records`.
- **State:** Open (2026-09-23). A real-clock `settle-afltables.ts` touching any 2026 key on
  `afldb_test` refuses on `source_records_seen_ck`. Under ISSUE-228 S9 the operator authorised
  continuing the 2099 lineage there only (batches 2421/2422, up to 2099-01-06). It is not repaired.
  DEV and PROD are unaffected. It did not block ISSUE-228 S9, which was accepted 2026-09-23.
- **Next action:** pick a reviewed `afldb_test`-only re-stamp or a real-clock rebuild of the 2026
  lineage. S9 is now accepted, so either may be scheduled.

### AFLDB-ISSUE-226 — Stale `docs/architecture.md` §5/§6: documented application structure names `src/services/`, `src/db/schema/` (Drizzle) and `src/types/`, none of which exist
- **Severity:** Low. **Area:** documentation — `docs/architecture.md` §5 "Application structure",
  §6 "Shared statistical definitions".
- **State:** Open (2026-09-19). Found during the closure review of PhanesLight bootstrap commit
  `a59917a4`. Verified three ways against the tracked tree: `git ls-files src` returns exactly
  `app`, `components`, `db`, `lib`, `search`, `styles`, `middleware.ts` (no `services`, no
  `types`); `git ls-files src/db` returns exactly `authClient.ts`, `client.ts`, `migrations`,
  `queries` (no `schema/`); `package.json` carries no Drizzle dependency — PostgreSQL is accessed
  through `postgres` 3.4.9 (postgres.js) directly, and nothing imports `@/services` or `@/types`.
  Documentation only: no application, query, data or deployment behaviour affected, and
  `CLAUDE.md` §6's repository map (what agent routing actually reads) is correct and unaffected.
  Deliberately not corrected under the bootstrap — out of its scope.
- **Key files:** `docs/architecture.md` §5, §6.
- **Next action:** correct §5's directory tree and drop the Drizzle reference. Then **establish
  where the §6 shared statistical definitions actually live** before rewriting that claim — this
  issue asserts only that they are not in `src/services/`, and does not assert where they are.

### AFLDB-ISSUE-220 — Web service credential boundary contradicts the application's `afldb_import` requirement; owner-role code-test DSN and a complete `.env` copy reach the internet-facing process
- **Severity:** High. **Area:** deployment / runtime security.
- **State:** Open (2026-09-17). Implemented in worktree `afldb-issue-220` (Sonnet 5, uncommitted),
  pending operator DEV/PROD verification. §4b established: `writeStandaloneDirectory` in the
  installed Next 16.3.1's own `next/dist/build/index.js` copies `.env`/`.env.production` into
  `.next/standalone/` unconditionally, in a hardcoded loop with no `next.config.ts` knob to
  suppress it — `next.config.ts` correctly left untouched. `deploy/afldb.service` now unsets
  `AFLDB_OWNER_DATABASE_URL AFLDB_TEST_DATABASE_URL AFLDB_TEST_IMPORT_DATABASE_URL
  AFLDB_TEST_AUTH_DATABASE_URL AFLDB_CODE_TEST_DATABASE_URL AFLDB_CODE_TEST_IMPORT_DATABASE_URL
  AFLDB_BACKUP_DATABASE_URL AFLDB_PROD_DATABASE_URL` and keeps exactly `DATABASE_URL`,
  `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`; `tools/build/prepare-standalone.mjs`
  now deletes any `.env*` under the standalone tree and fails the build if one survives; new
  `tests/deploy-web-unit.test.ts` derives the full DSN name set from `.env.example` (found
  `docs/deployment.md`'s §9 table was itself missing 5 real DSN names — completed it rather than
  deriving from the incomplete table, see `issues.md` Implementation section). PROD still not
  inspected.
- **Runbook:** `issues/open/AFLDB-ISSUE-220.md` (relocated from the repository root 2026-09-19;
  the `afldb-issue-220` worktree still holds its uncommitted copy at the old root path).
- **Key files:** `deploy/afldb.service`, `docs/deployment.md` §9, `tools/build/prepare-standalone.mjs`,
  `tools/build/env-in-standalone.mjs` (new), `tests/deploy-web-unit.test.ts` (new).
- **Local validation (2026-09-17):** `vitest run tests/deploy-web-unit.test.ts` **15/15 passed**;
  `tsc --noEmit` **clean**. DEV/PROD not yet run.
- **Next action:** operator runs the Git/DEV rollout (commit → `merge:ready` → push/merge → `sync-dev.ps1`
  build → manual unit reinstall + restart → names-only checks + Admin Centre write/revert), then PROD
  read-only checks. Resolve only once DEV steps 1–5 and PROD steps 2–3/6 (runbook §8/§9) pass.

### AFLDB-ISSUE-225 — Gridley corpus: 37 pre-existing `incorrect known answer` cells on non-draft criteria, present on `afldb_test` before AFLDB-ISSUE-222 and untouched by it
- **Severity:** Medium. **Area:** Grid Solver / canonical data — `captaincies`,
  `player_club_season_stats`, club lineage; `tests/integration/gridley-corpus.test.ts`.
- **State:** Open (2026-09-19, ISSUE-222 decision D3). 37 cells, all "Gridley lists, AFLDB
  omits", identical in the 2026-09-17 pre-import run and the 2026-09-19 run (report
  `7f14ff2c…`): `captain` 20 (Cameron Bruce 2489 ×11, Steven May 12093 ×9), `teammates-150` 14
  (ten players, board #1024), `teammates-100` 1 (Angus Brayshaw 669), `games250sameclub` 1
  (David Swallow 3581), `games100clubs2` 1 (Dylan Shiel 4006). ISSUE-118 closed at 0; the cells
  arrived with the 2026-09-13 `afldb_test` baseline. Root cause not investigated; not a draft
  matter.
- **Key files:** `src/db/queries/grid-solver.ts` (`club_captain_any`, `career_teammates_min`,
  `games_at_*_incl_merged`), `captaincies`, `player_club_season_stats`, the corpus suite.
- **Next action:** targeted read-only queries on `afldb_test` (captaincies rows for 2489/12093;
  teammate recounts for the board-1024/993 players; lineage for 3581/4006), then classify each
  cell from canonical evidence — never by a blanket exception.

**AFLDB-ISSUE-237 resolved 2026-09-28** (implementation and DEV/afldb_test validation by Sonnet 5,
operator-run PROD promotions) — AFL API importer-created `unique` identities are now carried through
`db:test:rebuild` and database promotion. `afldb_test` (L3), DEV (L4, stamp `20260926-085511`) and
PROD (L5) all accepted. L5 needed three real attempts: `20260926-213225` refused on 92 candidate-only
manual player registrations PROD never held (opened AFLDB-ISSUE-251); `20260927-142540`, after
ISSUE-251's registration lifecycle passed in full, refused on a 2026 Brownlow lineage-dependency gap
(opened AFLDB-ISSUE-252); `20260928-101642`, after the ISSUE-252 fix was completed and deployed
(`8fc60404`), ran the full freeze-bound procedure end to end and PASSED — swap, post-promotion
replay (92 registrations resolved, AFL API invariant OK), current-season AFL Tables settle, SC3
idempotence and the scheduled settle-timer path all clean. `docs/deployment.md` §6a documentation
(S5) was verified current. Cleanup of the retained rollback database and the two failed candidates is
deliberately deferred per `docs/production-promotion.md` §10 and is not a resolution blocker.
AFLDB-ISSUE-251 and AFLDB-ISSUE-252 remain separately tracked and open; their own resolution is
unaffected by this closure. Full record: `issues.md`, `issues/closed/AFLDB-ISSUE-237.md` §16.

**AFLDB-ISSUE-221 resolved 2026-09-18** (implemented 2026-09-17 by Fable 5.1; committed, merged
and DEV-verified 2026-09-18 by Sonnet 5) — Grid Solver draft-criteria review: honest "No data"
squares for an axis matching nobody, `draft_type_is` reads `draft_kind`, trade/free-agency rows
excluded from the three "drafted" builders, Gridley `fatherson` remapped to
`father_son_selection`, bounded numeric parameters with a per-square "Invalid value", the form
keyed by the board token so Reset resets, two stale `is_final` test oracles corrected. Committed
`f1a8daca`, merged to `main` at `159518ec`, deployed to DEV (`sync-dev.ps1 -RemoteRef main`,
revision `159518e`; found and corrected the DEV host's Git checkout sitting on a stale `dev`
branch, fast-forwarded 62 commits including AFLDB-ISSUE-220 and the NL-search chain
AFLDB-ISSUE-204–219 that had not reached DEV via this path before). All four required DEV browser
checks plus a valid non-draft answer check passed in a real authenticated `super_admin` session
via Playwright MCP (the operator signed in directly; the audience gate was not bypassed). The
reported symptom's root cause (draft-pick linkage, 5 of 6,810) is unfixed by design and now
tracked as **AFLDB-ISSUE-222** (draft runbook, awaiting operator approval). See `issues.md` for
the full record.

**AFLDB-ISSUE-222 resolved 2026-09-19** (executed across 2026-09-18/19 by Sonnet 5/Opus 5/Fable
5.1, operator-run on `afldb_test`/`afldb_dev`; deployed at commit `19eb40c0`) — the DraftGuru
person-page bridge is complete on both `afldb_test` (3,470 linked persons, 5,115/6,810 picks,
75.11%, Gridley-proven: `incorrect known answer` 99 → 37, zero draft-criterion cells) and
`afldb_dev` (real fail-closed `--link-only` import, committed and twice independently verified,
`summary_sha256 6a89a1ba…`, identical figures). Build `uKIChkbyo_-A3PMi40aFi` (1,516 static pages,
102/102 migrations); DEV health `status=ok, database=ok, latencyMs=16`. Browser-verified: the
AFLDB-ISSUE-221 Grid Solver draft-axis regression is resolved on DEV, `/admin/draft` renders all
6,810 selections, and both linked and unlinked draft selections render correctly. An operational
environment-truncation incident during DEV diagnosis (an unsafe inline PowerShell/SSH command
truncated `.env` to 17 bytes) was recorded transparently, fully recovered from live process state
plus freshly rotated credentials, and followed by a fresh independently verified DEV backup
(parity 9/9). The 1,587 remaining unmatched persons (AFLDB-ISSUE-224) and manual link-approval/
pick-creation mutation checks (out of scope) are **not** claimed resolved by this closure.
AFLDB-ISSUE-223/224/225 remain open, untouched. Full record: `AFLDB-ISSUE-222.md` §11.19.22,
`issues.md`'s *Resolution (2026-09-19)*.

**Fable code review outside NL search — 2026-09-17 (Fable 5.1, review and planning only).**
Reviewed with native inspection: authentication/session/middleware/capabilities and every auth
Server Action (no defect); the admin `*-actions.ts` files the 2026-09-15 mutation audit's glob did
not match, content publish/upload, settle trigger, and the public writers (no defect); all seven
route handlers and every `sql.unsafe` sink traced to a module allowlist (no defect); the tracked
deploy units, cluster entry point, both Caddyfiles, settle chain, build wrapper, DB clients
(**AFLDB-ISSUE-220** opened). Not reviewed: `deploy/sync-dev.ps1` body, `tools/maintenance/*`,
migrations, the admin action modules already covered by the 2026-09-15 audit,
`tools/email_intake/`, page components beyond their query allowlists, `src/db/queries/admin-users.ts`.
Residual, no new ID: `/api/admin/email-intake` still admits `contributor` senders — deferred under
resolved AFLDB-ISSUE-186 Phase B. No project-wide PASS is claimed.

**Fable NL code review — FINAL: PASS (2026-09-17, Fable 5.1, operator-validated on streamanator).**
Lineage: Stage 1 found eight defects (F1–F8) → Stage 2 confirmed them as AFLDB-ISSUE-187..192,
hardening added 193..196, the corpus audit's 40 genuine fail-open rows became 197 (all resolved
2026-09-15/16) → the 168 stale `AMBIGUITY_NOT_DETECTED` expectations (112 team-streak + 56
coach-record, plus 5 Ablett = 173) were corrected under AFLDB-ISSUE-199, then V3/V4/V5 under
201/204/205 → 198..219 hardened further to parser v66. This acceptance pass re-verified every
187..197 fix in the current tree (not from issue status), confirmed the AFLDB-ISSUE-197 family
contract (complete candidates via `resolvePlayerFamily`, 2–12 ranks, >12 declines and is
reachable, direct resolution distinct), and reran the frozen V5 corpus parse+execute on v66:
11997/0/3. The three failures (`verified_finals_without_premiership`, rows 41–43) were adjudicated
`STALE/INVALID EXPECTATION` from current canonical data (Dane Rampe and Nick Dal Santo genuinely
tied at 24 finals, 0 premierships, nobody else at 24) and corrected V5 → V6 by the new fail-closed
script `tools/nl/fix-stale-finals-without-premiership-tie.ts` (3/3 targets, 0 non-targets).
**Final V6: 12000/12000 clean / 0 soft / 0 failed / 0 errors.** V6 is now the stable baseline. No
new issue opened; no production code changed. Volatility note: Rampe is active mid-2026-finals, so
another final would re-stale rows 41–43 honestly (see the script header / `issues.md` ISSUE-219).

**AFLDB-ISSUE-219 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
cross-family NL defect: a plural club/venue alias already ending in "s" takes a bare trailing
apostrophe for its possessive ("Bombers'", "Dogs'", "Lions'", the AFLDB-ISSUE-214 §10c residual's
"Suns'"/"Pies'"/"Bulldogs'"), which `canonicalise()`'s existing `'s\b` strip
(`src/search/nl/vocab.ts`) never matched (it requires a literal "s" after the apostrophe).
Club/venue matching itself already resolved these aliases correctly via word-boundary regexes;
only the final leftover-token comparison in `parseNlQuestion` (`src/search/nl/parser.ts`) ever
disagreed, because `meaningfulTokens`' whitespace split kept the apostrophe attached to the word
while the matched/consumed span did not. Confirmed a shared `canonicalise()` defect, not a
per-builder one, by tracing `tools/nl/generate-exploratory-corpus-v2.mjs`'s `possessive()` helper
(line 178) across five families: `team_match_result`, `team_checkpoint_collision`,
`q3_comeback_near_miss`, `club_season_rank` (the ISSUE-214 residual) and `team_streak`. Fixed with
one new generic trailing-apostrophe strip in `canonicalise()`, mirroring the existing `'s` rule
rather than special-casing any club — no apostrophe made globally ignorable (only a trailing one
immediately before whitespace/end-of-string; a mid-word apostrophe like `o'brien` is untouched).
`PARSER_VERSION` 65 → 66 (baseline corrected during reconciliation with `AFLDB-ISSUE-218`, which
already holds 64 → 65 on `dev`). `AFLDB-ISSUE-218` (below) **independently found and deliberately
deferred the identical defect** for its own `team_match_result/0` cluster (56 rows,
"Bombers'"/"Dogs'"/"Brisbane Lions'"), naming this exact cross-family issue as its recorded
follow-up candidate — confirming this issue's root-cause finding a second, independent way,
alongside AFLDB-ISSUE-214 §10c. Local: `tests/nl-parser.test.ts` **605/605**, broader gates
**402/402**, `typecheck` clean. **Host validation (streamanator):** no established mechanism
existed to transport uncommitted code to a host, so a temporary, isolated `git worktree`
(`/home/arm/nl-issue219-validation`, off `origin/dev` at `a98c3e42`) was created and a `git diff`
patch applied — a clean `git apply --check` itself served as the identity proof;
`/home/arm/projects/afldb` and the retained git stash were never touched, and the temp worktree
was removed after validation. Host suites reconfirmed 605/605 + 402/402 + clean typecheck.
Exploratory V2 (29,030 rows, the AFLDB-ISSUE-218-corrected corpus) moved **20512 → 20876 clean**
(+364 / -364 soft / 0 failed), reconciling exactly across five families (`club_season_rank` 210,
`team_streak` 75, `team_match_result` 56, `team_checkpoint_collision` 16,
`q3_comeback_near_miss` 7) — every one of the 364 improved rows confirmed to carry a
trailing-apostrophe alias, zero that don't. The frozen V1/"V5" corpus's three failing rows (a
stale `verified_finals_without_premiership` fact check, Nick Dal Santo → Dane Rampe tie count)
were proven via a decisive v65-vs-v66 control against the same current database to be pre-existing
data drift, **not** a regression — flagged as a stale-corpus-expectation candidate, not opened as
its own issue in this closeout. See `issues.md` and `AFLDB-ISSUE-219.md` §14 for the full record.

**AFLDB-ISSUE-218 resolved 2026-09-17** (Sonnet 5, operator-validated on
streamanator across two host-validation rounds) — `team_match_result/1` (522
rows, "at V, find the widest X win/loss to Y...") and `/2` (569 rows, "by how
much did X lose to Y in their most lopsided meeting...") shared one
wrapper-vocabulary-only mechanism (both already extracted clubs/direction
correctly); fixed with additive vocabulary only (`widest` in `AGG_WORDS`, a
leading scope-clause request-verb strip widened to `at` as well as `for`,
verb forms `lose`/`lost`/`beat` in `TEAM_METRIC_WORDS`, two narrowly-gated
wrapper consumers for "how much"/"lopsided meeting"), no grain-election or
club-role logic touched, `PARSER_VERSION` 64 → 65. Round-1 host validation
(commit `5bcc957`) found V5 green and `/1` fully cleared (522→0), but exposed
`/2` moving from an honest soft decline into a 569-row HARD FAILURE — worse
than the pre-fix state — so the issue was reopened rather than closed.
Re-investigation traced production SQL (`src/db/queries/nl/team-match.ts`'s
clubFor-relative `win_margin`/`loss_margin`) and the parser's pre-existing,
uniformly-applied `clubFor`=subject convention against every pre-issue
directional test, then found and confirmed (empirically, 0 mismatches across
every affected row) a genuine, isolated **exploratory V2 generator/oracle
defect**: `team_match_result`'s templates 0/1/3 all keep club `c` as the
sentence's grammatical subject, but template 2 alone renders `o` as subject
and `c` as object without a corresponding fix to its expected `club`/
`opponent`/`metric` triple. Parser v65 was confirmed correct and untouched;
only the generator's template-2 expectation construction was corrected
(commit `6ed227d`), `PARSER_VERSION` staying at 65 (corpus-only correction).
Round-2 host validation confirmed **0 failed**: frozen V5 stayed
12000/12000/0/0; exploratory V2 moved v64 baseline (19421 clean/8109
soft/0 failed) → v65-corrected (20512 clean/7018 soft/0 failed), net
**+1091 clean/-1091 soft/0 failed**, reconciling exactly to `522 + 569 =
1091`; a determinism/isolation diff confirmed 0 question-text/row-id changes
anywhere in the 29,030-row corpus, with all 569 changed rows confined to
`team_match_result/2`'s own expectation columns. `team_match_result/0` (56
rows, "Bombers'"/"Dogs'"/"Brisbane Lions'" possessive aliases) remains
unchanged at 56 honest declines throughout both rounds — a distinct,
already-known trailing-apostrophe plural possessive-alias defect (the same
mechanism AFLDB-ISSUE-214 already found and left unfixed for
`club_season_rank`), deliberately deferred as a future cross-family issue
candidate, not opened as its own tracked issue in this closeout.
Implementation commits `5bcc957` (parser) and `6ed227d` (exploratory oracle
correction) on `sonnet/issue-218-team-match-result-phrasing`, unmerged.
Local: `tests/nl-parser.test.ts` 595/595, broader gates (`nl-regression-corpus`
163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402),
`typecheck` clean. See `issues.md` and `AFLDB-ISSUE-218.md` for the full
record.

**AFLDB-ISSUE-217 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_game_single`'s three large exploratory clusters (`/0` 423 rows "biggest `<metric>` haul in one
match", `/4` 422 rows "peak single-game `<metric>`", `/3` 409 rows "which match saw `<player>` collect
the most `<metric>`", combined 1254 rows) share ONE root mechanism, not three, and it is NOT grain/mode
misrouting — a named player's per-game stat already defaults correctly to `grain='player_game',
mode='single'`. The defect was in `candidatePlayerSpan` (`src/search/nl/parser.ts`): it greedily takes
the first four remaining non-stopword alpha tokens with no notion of "stop at a non-name word", so
unconsumed wrapper vocabulary ("haul", "peak"/"single-game", "match"/"saw"/"collect" — none had any
vocabulary entry) got swept into the player-name candidate alongside the real name (e.g. "dustin martin
haul"), which then failed player resolution outright — the polluted span is exactly the reported
`unsupported_term`. The adjacent `player_game_scope_collision/3` (555 rows, "single-match `<metric>`
record for...") was inspected and confirmed to share the identical mechanism (bare "single-match" always
sat immediately before the player name) and was included. Fixed with one generic `IN_ONE_GAME` extension
(bare "single-game"/"single-match" adjective, not only "in ... game/match") plus three new gated
wrapper-word consumers (`WHICH_MATCH_SAW_RE`, `PLAYER_GAME_SINGLE_HAUL_RE`, `PLAYER_GAME_SINGLE_PEAK_RE`)
— no player, club, venue, or metric special-cased. `PARSER_VERSION` 63 → 64. Implementation commit
`879b0e1` ("Fix player game single match phrasing"),
`sonnet/issue-217-player-game-single-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 575/575 (554 +
21 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `879b0e1`): frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **17612 → 19421 clean (+1809)**, **9918 → 8109 soft (-1809)**,
0 failed throughout. All four target clusters fully cleared: `player_game_single/0` 423 → 0, `/4` 422 →
0, `/3` 409 → 0, `player_game_scope_collision/3` 555 → 0. A direct 29,030-row plan-level comparison (v63
vs. v64) found exactly **1809 changed plans, 0 missing rows**, reconciling exactly to the four target
clusters, zero unrelated movement. A separate, pre-existing `WRONG_PLAYER` scorer-identity artifact (the
already-tracked Gary Ablett Jnr/Snr display-name mismatch from AFLDB-ISSUE-206/210) remains present
across several rows in the affected template families, confirmed independent of this fix and left
untouched. See `issues.md` and `AFLDB-ISSUE-217.md` for the full record.

**AFLDB-ISSUE-216 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_season_leaderboard`'s two exploratory clusters (`/0` 576 rows "posted the highest season tally
of `<stat>` for `<club>` `<time>`", `/3` 559 rows "the best seasonal `<stat>` total `<time>`") do NOT
share one root mechanism: both left "posted"/"season"/"tally"/"seasonal" unconsumed as leftover wrapper
vocabulary (shared gap), but `/3` additionally carried an independent grain-election defect — its own
"total" collided with the generic `AGGREGATE_TOTAL_WORDS` scoped-running-total cue and silently
misrouted the unnamed-player question to `player_game`/`sum` instead of `player_season`. Fixed with
three new gated vocabulary entries (`PLAYER_SEASON_LEADERBOARD_TALLY_RE`,
`PLAYER_SEASON_LEADERBOARD_SEASONAL_RE`, `PLAYER_SEASON_LEADERBOARD_POSTED_RE`, all gated on an actual
player-stat `METRIC_WORDS` match) plus a narrow `playerSeasonLeaderboardCue` override on the
`aggregateTotal` grain-election guard — no club, player, or metric special-cased. `PARSER_VERSION` 62 →
63. Implementation commit `8de4a96` ("Fix player season leaderboard phrasing"),
`sonnet/issue-216-player-season-leaderboard-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
554/554 (541 + 13 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `8de4a96`):
frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **16477 → 17612 clean (+1135)**, **11053 →
9918 soft (-1135)**, 0 failed throughout. Both target clusters fully cleared: `/0` 576 → 0, `/3` 559 → 0.
A direct 29,030-row plan-level comparison (v62 vs. v63) found exactly **1135 changed plans, 0 missing
rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-216.md` for
the full record.

**AFLDB-ISSUE-215 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator, two
host-validation rounds) — `career_numeric_binding`'s two exploratory clusters (`/3` 700 rows "for CLUB,
find players with A plus B", `/2` 552 rows "who has the most career S among players with A and B") do
NOT share one root mechanism — `/3` is a pure wrapper-vocabulary gap ("find" behind a leading "for"
clause, "plus" as an unrecognised conjunction); `/2` shares that gap ("among") plus an independent,
genuine predicate-loss defect (a stat word's earliest occurrence was the only one ever tried, silently
dropping a same-column condition stated after the ranking mention). Both fixed; `PARSER_VERSION` 61 →
62. Round-1 host validation (commit `5eca839`): frozen V5 stayed 12000/12000/0/0; `/2` fully fixed
(552 → 0); `/3` split into 491 `coverage_unavailable` and 209 `unsupported_term: plus`. The 491 were
investigated and classified a **legitimate, currently-real coverage limitation, not a parser/guard
defect** — `conditionSql` (`src/db/queries/nl/player-career.ts`) has no per-club SQL path for any
career condition column except `games`, and `validatePlan`'s club-scoped-career-condition guard
(`src/search/nl/plan.ts`) correctly fails closed rather than silently answer with a whole-career total
— guard NOT weakened, no corpus/scorer file touched, recorded as a future SQL-compiler capability
candidate (see `AFLDB-ISSUE-215.md` §11, §15). The 209 were a second, residual "plus" ownership gap in
`extractCareerConditions` — a 20-character clause-boundary lookback too short for a long comparator
phrase like "no more than " (widened to 40, proven safe by a new three-clause regression control), and
the "no X" negative-condition loop never checking for a neighbouring "plus" — fixed the same session
under the same `PARSER_VERSION` 62 (a correction, not a new semantic feature). Round-2 host validation
(commit `6a341fd`) confirmed the fix: frozen V5 stayed 12000/12000/0/0 again; `career_numeric_binding/3`
final triage is 700 `coverage_unavailable` / 0 `unsupported_term` — **all 700 `/3` rows now produce
structurally valid plans**; a direct round-1-vs-round-2 plan comparison found exactly 209 changed
plans, 0 missing, zero unrelated movement. Implementation commits `5eca839` and `6a341fd` on
`sonnet/issue-215-career-numeric-binding-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
540/540, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. See `issues.md` and `AFLDB-ISSUE-215.md` for
the full record.

**AFLDB-ISSUE-214 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — `club_season_rank`'s "what season had the highest/lowest `<metric>`" and "`<club>`'s highest/lowest seasonal `<metric>`" phrasings declined with `unsupported_term: season`/`seasonal`: neither word was ever consumed by any extractor, so it survived as a leftover token even when the surrounding club-season construction was otherwise fully understood. Confirmed both failing clusters (`club_season_rank/1`, `club_season_rank/3`) are two English phrasings of one already-supported semantic construction, not two mechanisms. Fixed with two new gated vocabulary entries (`CLUB_SEASON_RANK_SEASON_CUE_RE`, `CLUB_SEASON_SEASONAL_ADJECTIVE_RE`) folded into the existing `clubSeasonCuePresent`/single-season-guard logic — no club name, corpus ID, or exact sample string special-cased. `PARSER_VERSION` 60 → 61. Implementation commit `731edd8` on `sonnet/issue-214-club-season-rank-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 519/519, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **14879 → 15925 clean (+1046)**, **12651 → 11605 soft (-1046)**, 0 failed throughout. The full `club_season_rank/3` cluster (642 rows) cleared; 404 of 614 `club_season_rank/1` rows cleared, 210 remaining on a separate, pre-existing possessive-club-alias defect (`Suns'`/`Pies'`/`Bulldogs'`) deliberately **not folded into this issue and not opened as its own tracked issue** — recorded as a follow-up candidate only. A direct 29,030-row plan-level comparison (v60 vs. v61) found exactly **1046 changed plans, 0 missing rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-214.md` for the full record.

**AFLDB-ISSUE-213 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — a pre-existing
`extractClubs` defect (`src/search/nl/parser.ts`) exposed by, not caused by, ISSUE-212's corrected
exploratory V2 oracle. `phrasePosition`/`phraseEnd` re-found a matched club's position with a bare
first-match `\b<name>\b` search of the whole original question, so a shorter club's name embedded,
word-bounded, inside a longer club's own name ("Melbourne" inside "North Melbourne") silently rebound
onto the longer club's own span instead of the real, later standalone mention — the computed gap
between the two clubs came out empty, the `versus`/`vs`/`v` separator was never recognised, and
`scope.matchup` never formed for wording like "North Melbourne versus Melbourne" (confirmed row
`#20609919`), falling back to directional `clubFor`/`clubAgainst` instead. Fixed with a new
`firstUnclaimedOccurrence` helper that excludes spans an earlier club match in the same call has
already claimed, generic across any overlapping-name pair — no club special-cased. `PARSER_VERSION`
59 → 60. `Port Adelaide`/`Adelaide` and `Greater Western Sydney`/`Sydney` confirmed to reproduce the
identical mechanism, first by source trace and then empirically by the host plan diff (see below). One
pre-existing negative-control test needed a fixture-only swap (`sydney derby` → `western derby`) after
this issue's new `Sydney`/`Melbourne`/`North Melbourne` fixtures invalidated its "absent club"
assumption — not a parser regression, no production code touched for that correction. Implementation
commit `4f0be951` on `sonnet/issue-213-overlapping-club-matchup`, unmerged. Local: `tests/nl-parser.test.ts`
509/509, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **1 → 0** hard failures (row `#20609919` confirmed clean); a
direct 29,030-row plan-level reconciliation (v59 vs. v60) found **exactly 1 changed plan**, the known
row, with **zero unrelated changes** elsewhere in the corpus. See `issues.md` and
`AFLDB-ISSUE-213.md` for the full record.

**AFLDB-ISSUE-212 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(4) of `AFLDB-ISSUE-206.md`'s six proposals: corrected the exploratory NL corpus/scorer's three
confirmed V1 oracle defects (496-row symmetric "versus" matchup, 283-row achievement-summary
aggregation, 351-row Gary Ablett Jnr/Snr identity, all at parser v54) in a new versioned
`tools/nl/generate-exploratory-corpus-v2.mjs` + `tools/nl/corpus.ts` scorer contract. Not a
parser-feature issue: `PARSER_VERSION` unchanged at 59, no `src/search/nl/{parser,vocab,
semantic-intents}.ts` file touched. Operator-validated on streamanator: V2 (29,030 rows, seed
`2060542026`, SHA256 `bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a`, deterministic
replay confirmed, V5 exact/normalized overlap 0/0, 1,500 audit-required) scored against parser v59:
**27530 scored / 14878 clean / 12651 soft / 1 failed**; the frozen V1 12,000-row corpus stayed
**12000/12000/0/0** under the updated scorer, no regression. A same-corpus, same-parser (v59)
reconciliation of the pre- vs. post-ISSUE-212 oracle found **1308 old false hard failures removed**
(545 `team_match_result` matchup + 320 `achievement_summary` aggregation + 443 player-identity, split
225 Gary Ablett Snr / 218 Jnr) **and 1 newly exposed genuine hard failure** — net failed count change
-1307, not "1307 fixed". The v54→v59 counts (496→545, 283→320, 351→443) grew because
AFLDB-ISSUE-207..211 landed in between and let more previously-declined rows reach a scored plan for
the first time, exposing more instances of the same three pre-existing defects — none of those five
fixes touched matchup detection, achievement aggregation, or player-identity resolution themselves.
The one newly exposed hard failure (row #20609919, "... margin for North Melbourne versus Melbourne at
Adelaide Oval ...") is a genuine, distinct, pre-existing `extractClubs` defect (`phrasePosition`/
`phraseEnd` re-finding a club's position via a bare word-boundary search of the whole original text can
find a shorter club's name embedded inside a longer club's own name, here "Melbourne" inside "North
Melbourne", instead of the real second mention, silently preventing the unordered matchup from
forming) — confirmed identical parser plan in V1 and V2, not a corpus/scorer defect and not introduced
by this issue, deliberately left unfixed and **not opened as its own tracked issue in this closeout**.
Two structurally similar pairs (`Port Adelaide`/`Adelaide`, `Greater Western Sydney`/`Sydney`) are
**unreproduced hypotheses only** — the actual host run found exactly one failure total, so neither is
confirmed to have been drawn by this seed or to reproduce the mechanism. See `issues.md` and
`AFLDB-ISSUE-212.md` (§6a, §8) for the full record.

**AFLDB-ISSUE-211 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(5) of `AFLDB-ISSUE-206.md`'s six proposals, the largest single unimplemented soft-decline vocabulary
family it found: `extractSeasons` (`src/search/nl/parser.ts`, `src/search/nl/vocab.ts` new `AFTER_RE`)
had no form for `after YEAR` as an exclusive lower season bound (`scope.seasonMin = YEAR + 1`,
deliberately distinct from inclusive `since YEAR`). Fix extends the existing single season extractor
with one new anchored regex and one new `else` branch alongside the existing `since` check — no second
parser, no vocabulary/stage reordering, `after the siren`/`AFTER_THE_ACHIEVEMENT` unaffected because
neither ever puts a literal year immediately after the word. `PARSER_VERSION` 58 → 59. Implementation
commit `c113e6a`, unmerged on `sonnet/issue-211-after-year-season-bound`. Operator-validated on
streamanator: frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v58 vs post-fix v59) found exactly
**1406 changed plans**, all genuine `after <4-digit year>` wording, 0 unrelated — reconciled in full:
**1262 `soft_fail→clean`** (the genuine usability gain), **136 `soft_fail→soft_fail`** (95
`career_boundary` / 23 `head_to_head` / 18 `unsupported_composition`, correctly declined under the
existing compiler/coverage contract once the temporal clause parses), **8 `audit→audit`**
(`malformed_input` rows, intentionally still manual-audit by corpus design), and **0 `soft_fail→fail`**.
118 changed rows compose `after the siren` with a separate genuine `after YEAR` clause; both meanings
coexist correctly in every one. See `issues.md` and `AFLDB-ISSUE-211.md` for the full record.

**AFLDB-ISSUE-210 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(6) of `AFLDB-ISSUE-206.md`'s six proposals: a leading imperative/request-wrapper verb ("find", bare
"show", "list", "give me" — "show me"/"tell me" already worked) survived `canonicalise()`
(`src/search/nl/vocab.ts`) as an unmatched leftover token and tripped the generic decline gate even when
the rest of the question was otherwise fully supported — the dominant soft-decline mechanism ISSUE-206
found (~10,000+ of 15,275 soft-decline exploratory rows). Fix: one new anchored
`LEADING_REQUEST_PREFIX_RE`, consumed at most once at the very start of the string; `find` carries a
negative lookahead protecting the pre-existing "find the (big) sticks" goals idiom, the one real
vocabulary collision found. `PARSER_VERSION` 57→58. Implementation commit `8324d2a`, unmerged on
`sonnet/issue-210-imperative-nl-phrasing`. Operator-validated on streamanator: frozen V5 stable-corpus
rerun stayed **12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row
exploratory corpus (pre-fix v57 vs post-fix v58) found exactly **1408 changed plans**
(`663 find / 378 list / 367 show / 0 other`, zero unrelated wording family), reconciled in full: **1288
`soft_fail→clean`** (the genuine usability gain), **48 `soft_fail→fail`** (all `show`-prefixed
`player_game_single` rows, all the pre-existing Gary Ablett Jnr/Snr canonical-display-name scorer
artifact from `AFLDB-ISSUE-206.md`, exposed by new reachability rather than caused by this fix), and
**72 audit-required `decline→success`** ("List sons of X with Y" `relationship_conditions` rows, now
valid typed `player_career` plans but still intentionally manual-audit by corpus design). See
`issues.md` and `AFLDB-ISSUE-210.md` for the full record.

**AFLDB-ISSUE-209 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(3) of `AFLDB-ISSUE-206.md`'s six proposals: `extractHeadToHeadCue`'s `compare_wins` family
(`src/search/nl/semantic-intents.ts`) recognized only past-tense "won more", so present-tense "has/have
more wins ... head to head" fell through to the generic `head to head` → `record` cue and answered with
a full record instead of naming the leader. Fix added a dedicated "has/have (more|the most) wins head to
head" pattern plus a trailing-"head to head" extension to the existing "won more" pattern, both checked
before the generic record families; `PARSER_VERSION` 56→57. Operator-validated on streamanator (commit
`f2e067f`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v56 vs post-fix v57) found exactly
**199 changed plans**, all `headToHead.kind: record→compare_wins` in the same wording family — 173
matching ISSUE-206's direct estimate, plus 26 that also carried a mechanically-linked `between YEAR and
YEAR` season/havingClause correction (the same atomic "wins" consumption fix incidentally resolved a
misread grouped-threshold on those 26 rows) — zero collateral movement elsewhere, so **the validated
affected surface is 199 rows, not 173**. Implementation commit `f2e067f`, unmerged on
`sonnet/issue-209-head-to-head-more-wins`. Two adjacent wordings ("has more wins between A/B", "has more
wins against the other") investigated and deliberately not fixed — claimed earlier by
`extractClubSeasonMetric`'s "most wins" club_season ranking cue, a different mechanism. See `issues.md`
and `AFLDB-ISSUE-209.md` for the full record.

**AFLDB-ISSUE-208 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(2) of `AFLDB-ISSUE-206.md`'s six proposals: `extractClubs`'s club-role lookback (`src/search/nl/parser.ts`)
tested "does an against-like token exist anywhere in a fixed 20-character window", not "what is the
nearest preposition governing this club" — losing the subject club on 134 after-siren rows ("to win FOR
Club" mis-read the earlier, unrelated "to" as governing) and 117 leading-opponent/checkpoint rows
("Against Opponent, ... Subject's ..." let the opponent's own stripped-out "against" leak into the
subject's shrunken window). One shared mechanism, fixed by a `nearestGoverningPreposition` helper
anchored to the immediately-preceding token, checked against the pre-mutation text — no vocabulary
added, no stage reordered, `scope.matchup` unchanged; `PARSER_VERSION` 55→56. Operator-validated on
streamanator (commit `70b72df`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct
structured-plan diff of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v55 vs post-fix
v56) found exactly **251 changed plans** (134 `after_siren` + 117 `team_checkpoint_collision`), zero
collateral movement elsewhere, clearing all 251 confirmed parser-defect hard failures (aggregate hard
failures 1381→1130, clean +251, soft unchanged). Implementation commit `70b72df`, unmerged on
`sonnet/issue-208-club-role-ownership`. One structurally similar, undisturbed finding in
`assignCrossDomainClubs` (its own fixed-window `AGAINST_PREPOSITION.test` for the played/coached
opponent refusal) documented but not fixed and not yet opened as its own issue. See `issues.md` and
`AFLDB-ISSUE-208.md` for the full record.

**AFLDB-ISSUE-207 resolved 2026-09-16** (Sonnet 5, operator-validated on streamanator) — follow-on item
(1) of `AFLDB-ISSUE-206.md`'s six proposals, the highest-severity finding (281 silently-wrong-answer
corpus rows). Root cause: `extractHavingClause`'s operator search used an unbounded `±20`-character
window that could reach past a grouped wins/losses/draws/games threshold's own count into an adjacent
margin clause's operator word, and separately let `COMPARE_OP_WORDS`' fixed vocabulary order outrank the
clause's own, correctly-positioned operator word. Both effects silently swapped the two clauses'
comparators while still passing `validatePlan`. Fix bounded the operator search to
`window.slice(0, countEnd)` — no vocabulary added, no stage reordered, no default changed;
`PARSER_VERSION` 54→55. Operator-validated on streamanator: frozen V5 stable-corpus rerun stayed
**12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row exploratory
corpus (pre-fix v54 vs post-fix v55) found exactly **281 changed plans**, all
`havingClause.op: gt->gte` paired with `matchFilter.op: gte->gt` (the intended pairing), zero collateral
movement elsewhere in the corpus. Implementation commit `4ecdd77a`, unmerged on
`sonnet/issue-207-numeric-operator-ownership`. One pre-existing, out-of-scope gap documented but not
fixed: `extractMatchFilter` has no form for trailing "by 50 or more/fewer points". See `issues.md` and
`AFLDB-ISSUE-207.md` for the full record.

**AFLDB-ISSUE-206 resolved 2026-09-16** (Sonnet 5) — final triage of the 29,030-row independent V1
exploratory corpus, re-verified against current branch source rather than taken on the first-pass
(Codex) scorer labels. All 1,381 hard failures reconcile exactly to five root causes: 496
(`team_match_result` symmetric "versus", confirmed corpus-oracle defect — parser already emits a correct
`matchup` scope, template wrongly asserts directional clubs), 283 (`achievement_summary` aggregation,
confirmed corpus/scorer defect — the grain's executor never reads `plan.agg`), 351 (Gary Ablett Jnr/Snr,
confirmed scorer defect — player ID resolves correctly, only display-name string comparison is wrong),
and **251 genuine parser defects** (`after_siren`/`team_checkpoint_collision` clubFor loss, one shared
root mechanism: `AGAINST_PREPOSITION`'s 20-character lookback window in `extractClubs` is not anchored to
the nearest preposition). Two further clusters are silent wrong answers scored `clean`, outside the
1,381: 281 rows (numeric operator ownership crossing between `extractHavingClause`/`extractMatchFilter`,
confirmed parser defect, highest severity) and 173 rows (head-to-head "has more wins" phrasing gap).
Soft declines (15,275) trace mainly to one mechanism (imperative/structural phrasing vocabulary gap,
~10,000+ rows) plus `after YEAR` (unimplemented, ~1,200+ rows) and a deliberate `career_boundary`
compiler restriction (907 rows, fails closed by design). Six follow-on proposals recorded in priority
order in `AFLDB-ISSUE-206.md`, no ISSUE-207+ IDs assigned yet. No parser behaviour, `PARSER_VERSION`, V5
row or production data changed. See `issues.md` and `AFLDB-ISSUE-206.md` for the full record.

**AFLDB-ISSUE-205 resolved 2026-09-16** (Sonnet 5, operator-validated) — AFLDB-ISSUE-200's
`TAXONOMY_DRIFT` disposition for the remaining 70 `WRONG_FAILURE_REASON` rows was incomplete: two
unrelated families, not one benign label mismatch. **Family A (42 rows,** "biggest three quarter time
comeback" **):** genuine parser-ordering defect — `extractScoreCheckpoint` consumed "three quarter time"
before `extractTeamMetric` could match the already-implemented `q3_deficit_overcome` team_match metric.
Fix required two rounds (a `'3QT'`-entry guard, then a `'QT'`-entry follow-up after the operator's first
run found the first guard incomplete — a second, independent fall-through matching the same nested
substring); `PARSER_VERSION` 53→54. **Family B (28 rows,** "comeback from quarter time" **):** genuine
Q1/quarter-time feature gap (no `q1_deficit_overcome` metric exists, and none was added — deliberate
scope decision); stays declined, `expected_failure_reason` corrected `unsupported_topic`→
`unsupported_term`. Two correction-tool validation defects found and fixed along the way (both
test/tooling-only, no parser/runtime defect): an over-broad candidacy design gated on old-state
(`decline`+`unsupported_topic`) before question-text identity, wrongly flagging an unrelated live
fantasy-score row; and a DB-free test fixture that leaked a filler-row default
(`expected_grain='player_game'`) into synthetic decline rows. Operator-validated end-to-end: 446/446
parser tests, 35/35 integration tests (incl. new `q3_deficit_overcome` SQL coverage), clean
`tsc --noEmit`, 15/15 correction-tool tests, real V4→V5 correction (70/70 targets, 0 non-targets
touched, independently re-verified), parser-v54 rerun against V5 = **12000 scored / 12000 clean / 0 soft
/ 0 failed**. V5 is now the stable regression-corpus baseline, superseding V4. Stage 2 remains closed,
not reopened. See `issues.md` and `AFLDB-ISSUE-205.md` §11 for the full record.

**AFLDB-ISSUE-204 resolved 2026-09-16** (Sonnet 5, operator-validated) — guarded V3→V4 corpus
correction for the 180-row `coverage_unavailable|fgf` stale pre-1965/1987 finals-stat coverage
expectations (disposals/marks/tackles, finals/Grand Finals, seasons 1897-1926). Three fail-closed
correction-tool defects were found and fixed across three operator runs before the fourth completed
end-to-end: (1) an over-broad category+template-only selector matched 996 rows, not 180, retargeted to
the row's full structural signature; (2) a singular-only `/\bfinal\b/i` question-text check rejected
real plural "finals" wording, widened to `/\bfinals?\b/i`; (3) a season-shape gate wrongly required
`expected_season_from === expected_season_to` for every row, fixed by branching on
`expected_match_type` (Grand Final rows carry a blank `expected_season_to`). All three were
correction-tool-only; no parser/runtime defect was found. Final run: 180/180 targets corrected, 0
non-targets touched, parser-v53 rerun against V4 = 12000 scored / 11930 clean / 70 soft / 0 failed
(down from 250 soft), the 180 `UNEXPECTED_DECLINE` rows removed with zero new soft rows and zero
semantic changes among the rest; `PARSER_VERSION` unchanged at 53. See `issues.md` and
`AFLDB-ISSUE-204.md` §11 for the full record. AFLDB-ISSUE-187..204 all now resolved. **Stage 2 (the
AFLDB-ISSUE-200 corpus audit and its four follow-ons) is now closed**; the remaining 70
`WRONG_FAILURE_REASON` taxonomy-drift rows are a separate, not-yet-opened cleanup/audit task (see
Stage 2 next task below).

AFLDB-ISSUE-202 (GWS club identity leaks into unsupported-term detection) resolved 2026-09-16
(Sonnet 5, operator-validated) -- see `issues.md` for the full record, including the additional 72
grain-equivalent GWS player-season rows normalized as a byproduct of the same fix.

AFLDB-ISSUE-203 (numeric word "zero" not bound as equality in `player_career` conditions) resolved
2026-09-16 (Sonnet 5, operator-validated) -- root cause was two cooperating gaps in
`extractCareerConditions` (missing `zero` vocabulary entry, and a comparator default wrong for a
bound zero); `PARSER_VERSION` 52→53; 15 zero-word soft findings cleared, 0 new soft rows, 0
semantic changes among the 250 remaining soft rows -- see `issues.md` for the full record.

AFLDB-ISSUE-187..192 were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1,
medium effort), re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search
(`src/search/nl/`, `src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-188 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-187 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-189 resolved 2026-09-15 (Sonnet 5, from the approved runbook, operator-validated);
AFLDB-ISSUE-191 resolved 2026-09-15 (Sonnet 5, operator-validated); see `issues.md`.
AFLDB-ISSUE-193 (opened 2026-09-15 during ISSUE-189 planning) resolved 2026-09-15 (Sonnet 5,
operator-validated); see `issues.md`.
AFLDB-ISSUE-192 resolved 2026-09-15 (Sonnet 5, operator-validated: 31/31 integration tests,
5/5 ISSUE-192 regression tests, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-187..193 all remain resolved; the Stage 2 closeout audit (2026-09-16, Sonnet 5 High)
found three neighbouring, unrelated defects while verifying the resolved fixes and opened
AFLDB-ISSUE-194..196. AFLDB-ISSUE-196 resolved 2026-09-16 (Sonnet 5 High, from the approved
runbook — one runbook correction to the `across` regression contract mid-implementation, see
`issues.md` — operator-validated: 389/389 `nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`,
clean `tsc --noEmit`). AFLDB-ISSUE-195 resolved 2026-09-16 (Sonnet 5 High, from the approved runbook
`AFLDB-ISSUE-195.md`, Option B — subject-gated "won the/a premiership" vocabulary plus a narrow
club-season ownership guard, no runbook correction needed — operator-validated: 398/398
`nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-194 resolved 2026-09-16 (Sonnet 5 Medium, `sonnet/issue-194-team-match-symmetric-matchup`,
unmerged — operator-validated: 34/34 `tests/integration/nl-answers-team-club.test.ts`, clean
`tsc --noEmit`); see `issues.md`. AFLDB-ISSUE-187..196 all now resolved. The Stage 2 corpus triage
of the 208 `AMBIGUITY_NOT_DETECTED` rows (2026-09-16) classified 40 as `GENUINE_FAIL_OPEN`, 168 as
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause).
**AFLDB-ISSUE-197 resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-197.md` —
Option C, a dedicated `resolvePlayerFamily` resolver mirroring the parser's whole-word-prefix
predicate in SQL; `PARSER_VERSION` 48 → 49; operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set,
clean `tsc --noEmit` — see `issues.md` for the full Implementation/Validation/Resolution record,
including one mid-session fixture correction and one integration-path control-flow investigation
that concluded fixture defect, not production defect). AFLDB-ISSUE-187..197 all now resolved.

Stage 2 status: **blocked again, narrowly.** ISSUE-197 resolving its one genuine fail-open root
cause cleared six of the seven generic-surname families (Johnson, Brown, Smith, Williams, Wilson,
Anderson). The v49 regression rerun (2026-09-16) found the seventh, Jones (rows 11626-11630,
5 rows), still hard-failing for a distinct-but-related reason: the parser's own defence-in-depth
`candidateNameWords` re-check does not tokenise hyphenated surnames (`Darcy Byrne-Jones`,
`David Rhys-Jones`) the same way SQL's `afldb_normalise_name` does, undercounting the real 13-member
Jones family to 11 and ranking a wrong answer instead of declining. **AFLDB-ISSUE-198 opened
2026-09-16, resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-198.md` — one
implementation-time deviation from its §5 Option C code sketch, found empirically: `candidatePlayerSpan`
widens its acceptance test via the new shared `splitNameWords` helper but keeps the original
punctuation-bearing token, rather than exploding it, to stay aligned with the confidence/leftover-token
accounting elsewhere in the parser — see `issues.md`'s Implementation section). `PARSER_VERSION` 49 →
50. Operator-validated 2026-09-16: `tests/integration/nl-semantic-mapping.test.ts` 29/29 (DB-backed,
`afldb_test`), combined focused suite 964/964 across 6 files (`nl-parser.test.ts` 413/413,
`nl-semantic-mapping.test.ts` 167/167, `nl-regression-corpus.test.ts` 163/163,
`nl-audit-acceptance.test.ts` 10/10, `nl-plan.test.ts` 182/182, plus the integration file above),
clean `tsc --noEmit`. AFLDB-ISSUE-187..198 all now resolved.

The unchanged V1 12k-row corpus re-run on parser v50 (post-merge Stage 2 step) has now been run: hard
failures 178 -> 173, confirmed to be exactly the five Jones rows (11626-11630) clearing with zero
collateral movement. **AFLDB-ISSUE-199 resolved 2026-09-16** (Sonnet 5, from the approved runbook
`AFLDB-ISSUE-199.md`, revised mid-implementation after two real-DEV validation failures — see
`issues.md`'s Implementation/Final-patch-revision sections — a self-verifying correction script,
`tools/nl/fix-issue-199-stale-expectations.ts`, corrected exactly the 173 stale-decline rows; operator-
validated: correction-tool summary 173/173 targets modified, 0 non-target rows touched, plus a parser-v50
`nl:stress` re-run showing `AMBIGUITY_NOT_DETECTED`/hard-fail 173 -> 0 with the three soft classes
unchanged at 72/921/70; DB-free unit suite 28/28; `PARSER_VERSION` unchanged at 50). AFLDB-ISSUE-187..199
all now resolved. Stage 2 is **not** closed by this: the three soft classes remain open and unaudited
(item 4 below), and the rest of the Stage 2 closeout sequence remains outstanding.

**AFLDB-ISSUE-200 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for item 4's soft-class
audit. Runbook `AFLDB-ISSUE-200.md` written (planning); `tools/nl/audit-issue-200-extract.ts` and
`tools/nl/audit-issue-200-cluster.ts` (plus a shared constants module) written with DB-free unit
tests (implementation); the operator ran both scripts against the real
`/home/arm/nl-stress-v50-cleaned/` artifacts and found exactly six auto-clusters covering all 1,063
rows, and evidence-backed dispositions for all six were recorded in a checked-in mapping
(`tools/nl/issue-200-dispositions.csv`); **operator-validated resolution:** the final
`audit-issue-200-cluster.ts --apply-dispositions` run against the real
`/home/arm/issue-200-soft-audit.csv` reconciled exactly -- 1063 rows in, 1063 classified, 0
unmapped, 0 stale, `PLANNER_VALIDATOR_BUG` 598 / `STALE_CORPUS_EXPECTATION` 180 / `PARSER_BUG` 143 /
`GRAIN_EQUIVALENT_LEGITIMATE` 72 / `TAXONOMY_DRIFT` 70; local `tsc --noEmit` clean,
37/37 DB-free tests passed. No parser/planner/scorer code changed; neither external corpus file
modified. The three candidate defect follow-ons and the one guarded corpus-correction task (named in
`issues.md`) are recorded but not opened as tracked issues in this closeout.

**AFLDB-ISSUE-201 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for the first of those
follow-ons: the `PLANNER_VALIDATOR_BUG` `coverage_unavailable|boundary` cluster (598 rows).
`validatePlan` now exempts a `raw.boundary` plan from the career season-range rejection;
`player-career.ts` compiles the range against `c.debut_season`/`c.final_season`; `PARSER_VERSION`
50 → 51. Operator-validated: 774/774 focused unit tests, 33/33
`tests/integration/nl-answers.test.ts`, clean `tsc --noEmit`; stable-corpus rerun cleared 596 of the
598 rows, and the remaining 2 (id 9907, id 10294 — both "... Grand Final before 1897", `seasonMax`
genuinely one season before `NL_LIMITS.minSeason`) were confirmed stale corpus expectations, not
implementation defects, and corrected by a new guarded, self-verifying script,
`tools/nl/fix-issue-201-stale-boundary-expectations.ts` (17/17 unit tests passed). Final stable-corpus
result: 12,000 scored / 11,535 clean / 465 soft / 0 failed, with an independent diff confirming zero
collateral movement anywhere else in the corpus. See `issues.md` and `AFLDB-ISSUE-201.md` for the full
record. AFLDB-ISSUE-187..201 all now resolved.

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 next task

1. **Done** (2026-09-16) — V1 regression corpus re-run against parser v49 (parse-only): hard
   failures 208 -> 178.
2. **Done** (2026-09-16) — fresh run's semantic rows compared against the retained v48 baseline:
   1271 -> 1241 non-clean rows, 30 rows became clean, 0 new non-clean rows, 0
   changed-but-still-non-clean rows. This comparison is what surfaced the Jones rows (§ above,
   AFLDB-ISSUE-198) as still-hard rather than clean.
3. **Done, resolved 2026-09-16** — the V1 12k corpus was re-run on parser v50: hard failures 178 ->
   173 (only the five Jones rows, 11626-11630, moved; confirmed clean via full semantic diff, zero
   collateral movement). The remaining 173 hard failures (5 Ablett + 112 team-streak + 56 coach-record)
   were all stale expected-decline rows predating shipped features. **AFLDB-ISSUE-199 resolved
   2026-09-16** — corrected via a checked-in, self-verifying script
   (`tools/nl/fix-issue-199-stale-expectations.ts`), operator-run against the real canonical CSV
   (`~/nl-stress-corpus.csv` on the dev host, which has no in-repo generator); `AMBIGUITY_NOT_DETECTED`
   173 -> 0, the three soft classes unchanged. See `issues.md` for full evidence.
4. **Done, resolved 2026-09-16 — AFLDB-ISSUE-200.** All 1,063 soft rows (`GRAIN_EQUIVALENT` 72,
   `UNEXPECTED_DECLINE` 921, `WRONG_FAILURE_REASON` 70) are classified into exactly six real
   clusters, operator-confirmed via the tool's own final `--apply-dispositions` run:
   `PLANNER_VALIDATOR_BUG` 598, `STALE_CORPUS_EXPECTATION` 180, `PARSER_BUG` 143,
   `GRAIN_EQUIVALENT_LEGITIMATE` 72, `TAXONOMY_DRIFT` 70 — no
   `intentional_conservative_decline`/`scorer_harness_artifact`/`duplicate_manifestation` clusters
   turned up in the real data. See `issues.md` for full evidence. Runbook: `AFLDB-ISSUE-200.md`.
5. **(a) done, resolved 2026-09-16 — AFLDB-ISSUE-201.** **(b) done, resolved 2026-09-16 —
   AFLDB-ISSUE-202**: a `PARSER_BUG` fix for "GWS"/"GWS Giants" leaking into unsupported-term
   detection on `team_match` margin questions (128 manifestations). Root cause was a missing
   combined alias (see `issues.md`/`AFLDB-ISSUE-202.md`); fix applied was the one-line
   `CLUB_NICKNAMES` addition, operator-validated against the retained V3 corpus (465 → 265 soft).
   The same fix also normalized all 72 `GRAIN_EQUIVALENT_LEGITIMATE` rows (GWS Giants player-season
   leading-goalkicker questions) to exact expected semantics as a byproduct, so that class is now 0.
   Stage 2 was **not yet** closed after (c): **(c) opened 2026-09-16 as AFLDB-ISSUE-203, resolved
   2026-09-16** (`PARSER_BUG` fix for the word "zero" not binding as numeric-zero in career conditions,
   15 manifestations, operator-validated, `PARSER_VERSION` 52→53); **(d) opened 2026-09-16 as
   AFLDB-ISSUE-204, resolved 2026-09-16** (guarded corpus correction for the 180
   `coverage_unavailable|fgf` disposals/marks/tackles finals/Grand Final rows that asserted a stale
   `expected_status=success` — two coverage floors, not one: disposals/marks before 1965, tackles
   before 1987 — retargeted after the first operator run failed closed on an over-broad 996-row
   selector, then two further fail-closed correction-tool bugs found and fixed; operator-validated:
   180/180 targets corrected, 0 non-targets touched, parser-v53 rerun 250→70 soft with the 180
   `UNEXPECTED_DECLINE` rows removed and zero new soft rows, `PARSER_VERSION` unchanged at 53).
   **Stage 2 is now closed** — (a)-(d) all resolved. The fresh exploratory Codex corpus sweep is now in
   scope, per the original Stage 2 boundary, as a separate not-yet-opened task.
6. **Opened 2026-09-16 as AFLDB-ISSUE-205, resolved 2026-09-16.** The 70 `TAXONOMY_DRIFT` rows were
   **not** accepted diagnostic drift after all — the audit found a real parser-ordering defect silencing
   an already-implemented team_match metric (42 rows, fixed, `PARSER_VERSION` 53→54) plus a genuine
   Q1-comeback feature gap (28 rows, stays declined with a corrected failure-reason label). Corrects, but
   does not reopen, Stage 2 itself. V5 corpus: 12000/12000 clean, 0 soft, 0 failed. See
   `AFLDB-ISSUE-205.md`.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
