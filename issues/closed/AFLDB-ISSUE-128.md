# AFLDB-ISSUE-128 — Current Season Refresh: legacy Kali controls, and a settle chain that reported success while dropping rows

> Implementation runbook and evidence ledger.
> Session: 2026-09-03, Opus 5 / High, worktree `D:\dev\afldb-issue-127`,
> branch `codex/issue-127`, base `02ed5f7`.
>
> **[MEASURED]** = evidence produced by running the real thing in this worktree today.
> **[CONFIRMED]** = repository evidence read in this worktree.
> **[BUILT]** = what this session implemented.
>
> **STATUS: RESOLVED 2026-09-03.** Closeout, final validation and the acceptance verdict are
> in **§13**; the operator validation on dev that precedes it is in **§12**. §11 and §12.10
> are superseded. `AFLDB-ISSUE-129` (Wildcard Final enum + finals semantics) and the
> production deployment of `--require-complete-source` deliberately remain outstanding —
> see §13.5.

---

## 1. Problem as reported

Two symptoms, reported together, assumed to be one defect. They were two.

1. `/admin/current-season` showed **"Auto update from API"** and the banner *"Auto update
   uses Kali AFL Stats, stages fresh API rows, and inserts completed matches that AFLDB can
   resolve unambiguously…"*, with manual source options `Kali AFL Stats` / `Squiggle` and no
   fitzRoy anywhere. That contradicts `AFLDB-ISSUE-122`, under which AFL Tables via fitzRoy
   is the only automatic canonical source.
2. Recently completed AFL matches visible on AFL Tables had not appeared in AFLDB.

A third hypothesis was supplied as a lead, not a finding: output resembling
`Fetching cached data from github.com/jimmyday12/fitzRoy_data` / `No new data found!
Returning cached data` suggested fitzRoy might be serving a stale cache.

---

## 2. Issue identity [CONFIRMED]

`AFLDB-ISSUE-128` is a **new** issue and the next free ID (`IssuesIndex.md:47` declares
*"Next free issue ID is `AFLDB-ISSUE-128`"*).

No open issue owns this scope. `AFLDB-ISSUE-122` is Resolved; `-123` (settle performance),
`-124` (`StartLimitIntervalSec`), `-125` (production-only state), `-126` (post-cutover
rows) and `-127` (Super Admin on-demand trigger) are each unrelated. **ISSUE-127 is
deliberately not absorbed:** it owns the trigger control and is awaiting operator host
validation; this issue only extends its result projection.

**No migration number is claimed.** ISSUE-128 adds no schema. One follow-up,
`AFLDB-ISSUE-129`, is routed out of it and *will* need one.

---

## 3. Symptom 1 — the legacy admin UI [CONFIRMED]

**Already largely fixed before this session, and not on the branch the operator saw.**

`git show f0ea8f1` ("Retire ISSUE-122 fallback canonical writes", 2026-09-02 19:11) removed
`Auto update from API` and the Kali banner. `main` carries it (`250caa2`). The reported UI is
the pre-`f0ea8f1` build:

| Evidence | Result |
|---|---|
| `git show f0ea8f1^:src/app/admin/current-season/CurrentSeasonControls.tsx` | `:217` `'Auto update from API'` |
| `git show f0ea8f1^:src/app/admin/current-season/page.tsx` | `:41` `Auto update uses Kali AFL Stats…` |
| `git show main:src/app/admin/current-season/page.tsx` | neither string present |

**But the architecture was not fully retired — only its wording.** Three structural
remnants survived and are fixed here:

1. `actions.ts` still carried `mode === 'auto'` ⇒ `['kali'] as const` with `apply` forced
   on. That is the retired automatic writer's exact shape, still reachable by name.
2. `CurrentSeasonControls.tsx` still rendered that mode as the page's **primary** button
   (`Refresh Kali fallback staging`), above the manual controls.
3. `parseCurrentSeasonSources('')` **defaulted to `kali`** — the last place in the codebase
   asserting Kali is what an unspecified current-season source means.

So symptom 1 was a stale deployment *plus* a genuinely incomplete retirement.

---

## 4. Symptom 2 — the missing matches. Root cause [MEASURED]

### 4.1 The stale-cache lead is FALSE

fitzRoy 1.8.0 installed, pinned version matches the contract. Two acquisition functions,
two different mechanisms, both measured live on 2026-09-03:

| Call | Mechanism | Result |
|---|---|---|
| `fetch_results_afltables(2026)` | **live** fixed-width read of `https://afltables.com/afl/stats/biglists/bg3.txt`; no cache anywhere in the function | **209 rows**, max date **2026-08-29** |
| `fetch_player_stats_afltables(2026)` | cached parquet from `fitzroy_data` releases, then scrapes only matches newer than the cache | **9,614 rows**, max date **2026-08-29**, incl. **92 rows** with `Round = "Wildcard Final"` |

`No new data found! Returning cached data` is emitted when `get_afltables_urls(max_date,
end_date)` returns zero URLs — which here is because **the cache is already current through
2026-08-29**, not because it is stale. The message is a red herring. Both datasets carry
every completed 2026 match, the two 28/29-Aug Wildcard Finals included.

`curl https://afltables.com/afl/stats/biglists/bg3.txt | tail -2` independently confirms the
source itself:

```text
17046. 28-Aug-2026  WF  Western Bulldogs  14.12.96  Collingwood  14.9.93   M.C.G.
17047. 29-Aug-2026  WF  Melbourne          7.13.55  Carlton      10.14.74  M.C.G.
```

**The acquisition layer is healthy. Nothing here needs fixing, and the freshness defence
must therefore not be built around fitzRoy caching.**

### 4.2 The rows are lost at AFLDB's round vocabulary

AFL Tables publishes the 2026 Wildcard Round in two vocabularies, neither of which AFLDB
knows:

| Artefact | Column | Value |
|---|---|---|
| `results.csv` | `Round` | `WF` |
| `results.csv` | `Round.Type` / `Round.Number` | `Regular` / **empty** — fitzRoy's own `round_levels` factor has no `WF` level, so `dense_rank()` yields `NA` |
| `player_stats_2026.csv` | `Round` | `Wildcard Final` |

`tools/migration/import_fitzroy_core.py:136` `FINALS_CODES` holds exactly
`EF, QF, SF, PF, GF`. Therefore:

- `normalise_results_round('WF')` raises `MatchIdentityError`;
- `results_identity()` catches it and returns `None` → the row has **no provable identity**,
  so it is not even representable as *present*; it becomes an **unkeyed rejection**;
- `normalise_stats_round('Wildcard Final')` raises → the 92 player rows do the same;
- `enumeration_of()` sets `complete: false` for both scopes, which correctly makes the
  absence sweep refuse.

`--on-record-error reject` is irrelevant to this path: the failure is at *identity*, before
projection, so the rows are lost under either policy.

### 4.3 The end-to-end measurement [MEASURED]

Real chain, real network, this worktree, 2026-09-03:

```text
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --in-season \
  --label probe-issue128-20260903 --from 2026 --to 2026
  -> results.csv 209 rows | player_stats_2026.csv 9614 rows
  -> manifest in_season: matches 209, player_match_rows 9614,
     rounds_observed [1..25], round_types_observed ["Regular"]

python tools/migration/import_fitzroy_core.py --label probe-issue128-20260903 \
  --require-in-season --on-record-error reject --emit-observations …
  -> "in-season gates PASSED"
  -> matches 207 | player_match_rows 9522 | rejections 0 | unkeyed_rejections 94
  -> afltables.match              207 record(s), complete=False
  -> afltables.player_match_stats 9522 record(s), complete=False
  -> EXIT 0
```

Unkeyed rejection breakdown: `afltables.match/no_match_identity` **2**,
`afltables.player_match_stats/no_player_match_identity` **92**.

`209 − 207 = 2`. `9,614 − 9,522 = 92`. `2 + 92 = 94`.

**These are the same figures the production `AFLDB-ISSUE-122` run recorded on snapshot
`settle-2026-09-02-1958`: "207 matches, 9522 player-match rows".** Production therefore
dropped exactly the Wildcard Round and reported a clean, successful pass.

### 4.4 The defect this issue owns

Not the dropped rows — AFLDB genuinely cannot represent them (§4.5). **The defect is that
the run could drop them and still report success.** Every stage behaved correctly and
fail-closed; not one of them was audible:

| Stage | Behaviour | Audible? |
|---|---|---|
| `acquire_core.R` | writes both rows; `rounds_observed` omits them (`na.omit` over `Round.Number`) | no |
| `import_fitzroy_core.py` | 94 unkeyed rejections, both enumerations `complete: false` | printed among healthy counters; **exit 0** |
| `settle-afltables.ts` | counts `snapshotUnkeyedRejections`, skips the sweep, counts `absenceSweepSkipped` | **exit 0** |
| `/admin/current-season` (ISSUE-127) | counter whitelist did **not** project any of them | no |
| `deploy/afldb-settle-afltables.{sh,service}` | chain exits 0 | unit green |

### 4.5 Why the rows are not simply imported [CONFIRMED]

`src/db/migrations/003_matches.sql:8` — `round_type` is a PostgreSQL **enum** with exactly
six members. `matches_round_number_ck` forbids `home_and_away` with a NULL `round_number`,
so a wildcard final cannot be modelled as a home-and-away round either. Representing it
needs a new enum value **and** an AFLDB-wide decision on whether it counts as a final
(34 files reference `is_final`).

Split out as **`AFLDB-ISSUE-129`** by explicit operator decision this session: *"Do not
silently classify Wildcard Final as a normal final or non-final in this issue. That needs an
explicit AFLDB-wide semantic decision and regression coverage. Do not implement migration
084 here."*

---

## 5. Answers to the Stage 1 architecture questions [CONFIRMED]

1. **Is `/admin/current-season` still invoking an older ingestion system?** Yes for the
   fallback half — `runCurrentSeasonRefresh()` is the pre-ISSUE-122 Squiggle/Kali stager. It
   no longer writes canonically (§11.2 retired that), but its `mode=auto` shape survived.
2. **Does ISSUE-122 bypass that admin refresh entirely?** Yes, completely. The settle chain
   is R → Python → tsx CLI, invoked by systemd; it shares no code with the Next.js path.
3. **Is fitzRoy already primary in ISSUE-122 but absent from the old UI?** Yes. The absence
   was cosmetic; the precedence was already real.
4. **Would adding fitzRoy to the old dispatcher create a second canonical writer?** Yes —
   `runCurrentSeasonRefresh()` would have to acquire, normalise and resolve AFL Tables
   independently inside Next.js. **Refused.** fitzRoy's manual surface is ISSUE-127's
   button, which starts the one approved chain.
5. **Who owns what:** automatic acquisition → the settle chain, exclusively. Manual
   fitzRoy → ISSUE-127's trigger, same chain. Canonical insertion → `canonical-apply.ts`
   under `--auto-apply`, exclusively. Final-score overwrite → nothing automatic; the
   Squiggle/Kali path hardcodes `insertMissingMatches = false`.

---

## 6. What was built [BUILT]

### 6.1 The source-completeness defence

`src/lib/acquisition/source-completeness.ts` (new, pure, no I/O). Reads five counters the
settle **already writes** to `import_batches.validation_result` and returns a verdict:

- `unknown` — no counters; the run did not prove anything and must not read as healthy;
- `incomplete` — any of `snapshotUnkeyedRejections`, `snapshotRejections`,
  `absenceSweepSkipped` is non-zero;
- `complete` — otherwise.

**The evidence is the source's own.** No calendar heuristic: a bye, the pre-finals gap and
five months of off-season all acquire nothing, produce zero unrepresentable rows, and read
`complete`. A red state therefore always means a real coverage gap.

### 6.2 The fail-closed exit code

`tools/current-season/settle-afltables.ts` gains `--require-complete-source`, evaluated in
`main()` **after `runSettleCli()` returns** — so the transaction has committed, every
representable record has landed, and the rerun is still idempotent. What the exit code costs
the run is only its claim to have imported the season.
`deploy/afldb-settle-afltables.sh` passes it on step 3.

### 6.3 Reporting at every layer

- `import_fitzroy_core.py` → `render_source_completeness()` prints a
  `SOURCE COMPLETENESS: INCOMPLETE` block naming family, reason, count and source lines.
  Still exits 0: the representable rows must reach the settle.
- `src/db/queries/settle-runs.ts` → whitelist extended with the five snapshot counters;
  the verdict is **derived on read**, so a pre-ISSUE-128 batch row still gets a reading.
- `SettleRunPanel.tsx` → the verdict renders as a verdict (`role="alert"`) above the
  counters, not as another column.

### 6.4 Provider precedence

- `mode=auto` **removed**, and an unknown mode is now **refused** rather than reinterpreted,
  so a stale client cannot resurrect it by name.
- `parseCurrentSeasonSources()` has **no default**; an empty source throws.
- The fallback control is manual-only, source-required, both options marked *deprecated
  fallback*, defaulting to Squiggle rather than Kali.
- `page.tsx` states the precedence and says explicitly why AFL Tables is **not** in the
  fallback source list.

---

## 7. Files changed [BUILT]

| File | Change |
|---|---|
| `src/lib/acquisition/source-completeness.ts` | **new** — the pure verdict + renderer |
| `tools/current-season/settle-afltables.ts` | `--require-complete-source`; verdict rendered on every run; exit code in `main()` only |
| `deploy/afldb-settle-afltables.sh` | step 3 passes the flag |
| `tools/migration/import_fitzroy_core.py` | `render_source_completeness()` + its call in the emit branch |
| `src/db/queries/settle-runs.ts` | five snapshot counters whitelisted; `sourceCompleteness` derived on read |
| `src/app/admin/current-season/SettleRunPanel.tsx` | verdict block + snapshot counter columns |
| `src/app/admin/current-season/actions.ts` | `mode=auto` removed and unknown modes refused; source required |
| `src/app/admin/current-season/CurrentSeasonControls.tsx` | legacy auto form replaced by the manual fallback form |
| `src/app/admin/current-season/page.tsx` | provider precedence wording |
| `src/lib/external-afl/current-season-import.ts` | no default source |
| `tests/fitzroy-core-import.test.ts` | ISSUE-128 fixture suite (real WF vocabulary) |
| `tests/current-season-import.test.ts` | verdict unit tests, CLI/shell gate pins, superseded assertions updated |
| `tests/admin-current-season-settle.test.ts` | admin projection + precedence pins |
| `docs/deployment.md`, `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` | stale claims corrected |

**Not changed:** any migration, `privileges.sql`, `settle-afltables.ts` (library),
`canonical-apply.ts`, `FINALS_CODES`, `normalise_*_round`, the timer cadence, any unit
file other than the chain script, `deploy/afldb.service`.

---

## 8. Validation [MEASURED]

| Check | Command | Result |
|---|---|---|
| Fixture suite | `npx vitest run tests/fitzroy-core-import.test.ts` | **87 passed / 5 skipped**, 7.16 s |
| Focused + related | `npx vitest run tests/current-season-import.test.ts tests/admin-current-season-settle.test.ts tests/fitzroy-core-import.test.ts tests/fitzroy-acquisition.test.ts tests/auth.test.ts` | **5 files, 405 passed / 5 skipped, 0 failed**, 8.48 s |
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npx eslint` over the 10 changed/added TS/TSX files (excluding the pre-existing `tests/fitzroy-core-import.test.ts`) | clean |
| Pre-existing lint | `tests/fitzroy-core-import.test.ts` | 35 `no-explicit-any` errors **before and after** — none added |
| Shell | `sh -n deploy/afldb-settle-afltables.sh` | OK |
| Python | `python -m py_compile tools/migration/import_fitzroy_core.py` | OK |
| Whitespace | `git diff --check` | clean |
| Build | `npx next build --webpack` | **compiled 4.8 s, TypeScript 3.7 s**, then stops at page-data collection with `DATABASE_URL is not set` on `/sitemap/[__metadata_id__]` — pre-existing, environmental, identical to the ISSUE-127 session |

### 8.1 Three superseded assertions, updated not deleted

1. `current-season-import.test.ts` pinned `mode === 'auto'` and `? ['kali'] as const`. Both
   now assert the opposite plus the refusal. The old text is quoted in the replacement.
2. `parseSettleArgs` shape gained `requireCompleteSource`.
3. The counter whitelist gained the five snapshot counters.

No regression coverage was weakened, skipped or removed.

### 8.2 Blockers — environmental, recorded not worked around

**No DB-backed acceptance test could run in this worktree.** `127.0.0.1:5432` times out,
there is no `.env`, no `psql`, and `AFLDB_TEST_DATABASE_URL` is unset, so
`tests/integration/settle-afltables.test.ts` cannot execute. This is the same environmental
state ISSUE-127 recorded. It is not a code failure and nothing was mocked to hide it.

**What was proven without a database, from live data:** a recently completed AFL Tables
match — `2026|25|2026-08-23|Essendon|Port Adelaide` — travelled acquisition → adjudication →
observation bundle and carries a complete canonical projection (`home_score` 95,
`away_score` 105, `round_type` `home_and_away`, `is_final` false, eight `period_scores`,
`attendance` 29,200, `attendance_status` complete), with `rejection: null`. Nothing in that
path was mocked.

**What remains unproven here:** the final canonical apply. Its evidence is
`AFLDB-ISSUE-122`'s supervised production ladder — 10,582 canonical rows / 9,133 ledger rows
on the first apply, **0/0/0** on the identical rerun (SC3). ISSUE-128 changed no code on
that path.

### 8.3 Operator validation still required

1. On dev, run the chain and confirm the unit now goes **failed** while the batch still
   commits, and that `journalctl … | grep -A 12 'SOURCE COMPLETENESS'` names the Wildcard
   Final rows.
2. Confirm `/admin/current-season` shows the INCOMPLETE verdict above the counters.
3. Run `tests/integration/settle-afltables.test.ts` against `afldb_test` on a host that has
   one. ISSUE-128 touches no settle-library or canonical-apply code, so no behavioural
   change is expected there.

---

## 9. Rejected approaches

| Approach | Why not |
|---|---|
| Add `WF`/`Wildcard Final` to `FINALS_CODES` here | Needs a `round_type` enum value and an AFLDB-wide `is_final` decision across 34 files. Operator-directed to `AFLDB-ISSUE-129`. |
| Expose fitzRoy in the Squiggle/Kali source selector | Would require a second AFL Tables acquisition/normalisation implementation inside Next.js. Forbidden by the brief and by ISSUE-122 §19. |
| Fail the emission step on an incomplete enumeration | `set -eu` would abort before the settle, so the 207 representable matches would not land either. The gate belongs after the commit. |
| A "no game in the last N days" freshness heuristic | Wrong for byes, the pre-finals gap and the off-season. The verdict uses the source's own counters instead. |
| Fill AFL Tables gaps from Squiggle/Kali | Explicitly forbidden; would grant a deprecated provider canonical authority by the back door. |
| Open a `data_issues` finding per unrepresentable row | `data_issues.issue_key` requires an `external_record_id`, which an unkeyed rejection by definition has not got. Would need a new `issue_type` and a scope-level key — larger than this defect warrants, and the counters already carry the fact. |

---

## 10. Safety contracts preserved [CONFIRMED]

- Existing final scores: untouched. The Squiggle/Kali action still hardcodes
  `insertMissingMatches = false`, asserted by test.
- Idempotence: unchanged; re-emission over identical input produces an identical bundle
  (asserted by test), and the settle library was not modified.
- No fuzzy identity, no guessed match, no duplicate match, no machine
  `promotion_decisions`, no ownership adoption, no new force/bypass flag.
- The **historical** rebuild path still **aborts** on the same vocabulary
  (`--on-record-error reject` remains in-season only) — asserted by test.
- Squiggle and Kali gained nothing: still deprecated, still non-writing, still never
  invoked automatically.

---

## 11. Exact next action (superseded by §12 — operator validation is complete)

**Operator validation on dev (§8.3), then close.** Do not deploy to production before
`AFLDB-ISSUE-129` is decided: with the flag in place the nightly unit will report `failed`
every night the Wildcard Round is in the acquired window — which is true, and is the point,
but the operator should know it before it happens rather than after.

**Repository state:** all work is **uncommitted** on `codex/issue-127`. Nothing was
committed, pushed, merged or deployed; no production or `afldb_dev` state was touched. The
probe snapshot and its manifest (`probe-issue128-20260903`) were removed after measurement.

---

## 12. Operator validation on dev — 2026-09-03 [MEASURED]

Executed by the operator on `streamanator` (`arm@10.0.40.100`), against **`afldb_dev` only**.
Everything recorded here was verified read-only after the run; **no application or database
state was changed by this verification**, and no second settle was run.

### 12.1 Environment

| Fact | Value |
|---|---|
| Host | `streamanator`, dev only. Production untouched. |
| Database | `afldb_dev` (shared development DB) |
| Checkout | `/home/arm/projects/afldb-issue-128` |
| Unit | `afldb-settle-afltables.service`, **temporary drop-in** overriding `WorkingDirectory=` and `EnvironmentFile=` onto `/home/arm/projects/afldb-issue-128`. The permanent `/home/arm/projects/afldb` unit was not edited. |
| R | `R version 4.3.3 (2024-02-29)` |
| fitzRoy | **1.8.0** (`/home/arm/R/library/fitzRoy/DESCRIPTION`) — the pinned contract version |
| Migration | **`083_canonical_auto_apply.sql` applied 2026-09-03 11:11:55+10**, immediately before the run |
| `db:privileges` | **Deliberately NOT run.** `afldb_meta.schema_migrations` on `afldb_dev` carries two migrations this checkout does not have — `079_access_code_delete.sql` (2026-08-31 18:40) and `080_external_grids.sql` (2026-08-31 23:01). `privileges.sql` is a reconciler with a hand-typed grant list, so running it from this checkout would **strip the grants those two orphan migrations created**. ISSUE-128 adds no table and needs no grant, so skipping it is correct and carries no risk to this validation. |

### 12.2 Source counters — the acquisition snapshot

Snapshot `data/sources/afltables/fitzroy_core/settle-2026-2026-09-03-1112/` (in the
issue-128 checkout):

| Artefact | Rows |
|---|---|
| `results.csv` | **209** (210 lines incl. header) |
| `player_stats_2026.csv` | **9,614**, of which **92** carry `Round = "Wildcard Final"` |

Emitted bundle: **207** matches, **9,522** player-match rows.
Unkeyed rejections **94** = `no_match_identity` **2** + `no_player_match_identity` **92**.
Both scopes `complete: false`; absence sweep skipped for both.

Exactly the §4.3 figures, now measured through the real systemd chain rather than a probe.

### 12.3 Batch counters — `import_batches` id **87**

`notes = AFLDB-ISSUE-099 settle; snapshot=settle-2026-2026-09-03-1112; season=2026; mode=apply`,
`status = completed`, `started_at/completed_at = 2026-09-03 11:12:41.726479+10`,
`records_read = 9729`, `records_rejected = 18`.

`validation_result` (the counters ISSUE-128's verdict reads are in **bold**):

| Counter | Value |
|---|---|
| **`snapshotMatches`** | **207** |
| **`snapshotPlayerMatchRows`** | **9,522** |
| **`snapshotRejections`** | **0** |
| **`snapshotUnkeyedRejections`** | **94** |
| **`absenceSweepSkipped`** | **2** |
| `canonicalRowsInserted` | 980 |
| `canonicalRowsUpdated` | 0 |
| `canonicalApplicationsLogged` | 854 |
| `canonicalApplyRefusals` | 189 |
| `canonicalApplyFailures` | **0** |
| `foreignOwnedCollision` | 8,686 |
| `unresolvedIdentityPlayer` | 18 |
| `unresolvedIdentityMatch` | 18 |
| `unresolvedIdentityClub` / `unresolvedIdentityVenue` | 0 / 0 |
| `sourceDisagreement` / `advisoryDisagreement` | 0 / 0 |
| `manualAuthorityRefusals` | 0 |
| `observationsSeen` / `versionsAppended` / `payloadsCreated` | 9,729 / 9,729 / 9,729 |
| `observationsCorrected` | 1,025 |
| `observationsHistoryOnly` | 189 |
| `candidatesCreated` / `candidatesMootLeftPending` | 8,893 / 189 |
| `derivedRecomputeRuns` / `derivedRecomputePlayers` | 1 / 449 |
| `dataIssuesOpened` / `dataIssuesResolved` | 0 / 0 |

`canonical_applications` for batch 87 reconciles the 854:
`player_match_stats` insert **818** + `matches` insert **18** + `match_period_scores`
insert **18** = **854**; with the eight period rows per match the 980 canonical rows follow.

### 12.4 Completeness verdict

`assessSourceCompleteness()` over those counters: `unrepresentableRows` 94,
`rejectedRecords` 0, `scopesNotSwept` 2, `enumeratedRecords` 9,729 => **`incomplete`**,
with reason codes `unrepresentable_rows` (94) and `scopes_not_swept` (2).

Journal headline, verbatim:

```text
--require-complete-source: Source INCOMPLETE: 94 unrepresentable row(s), 2 unswept
scope(s). This run must not be read as a complete import of AFL Tables current-season
data. Records that could be represented were still applied and the run remains
idempotent; this exit code reports that the import was not complete.
```

### 12.5 The systemd exit code is intentional [MEASURED]

```text
systemctl show afldb-settle-afltables.service
  ActiveState=failed
  Result=exit-code
  ExecMainStatus=1
  ExecMainExitTimestamp=Thu 2026-09-03 11:21:08 AEST
```

**This is the fix working, not a failure.** The batch still committed (`status = completed`,
counters stamped, 980 canonical rows applied, `canonicalApplyFailures = 0`). The exit code
withdraws only the run's *claim* to have imported the season. §8.3 item 1 is satisfied:
the unit goes `failed` while the batch commits.

### 12.6 The 8,686 `foreign_owned_collision` refusals are pre-existing shared-dev state

Ownership of every 2026 `player_match_stats` row on `afldb_dev`:

| Owner source | Rows | Written by |
|---|---|---|
| `fitzroy_afldata` | **8,694** | `import_batches` id **28**, tool `import_legacy_afl.py`, started **2026-08-15 02:34** |
| `afltables` | **818** | `import_batches` id **87** — this run |

- **Owner:** `fitzroy_afldata`, a *different* source key from the settle's `afltables`.
- **Pre-dates this run:** by ~19 days, from a legacy bulk import, not from any ISSUE-122/128 path.
- **Expected:** yes. `evaluateOwnership()` (`src/lib/acquisition/observations.ts:363`) returns
  `foreign_owned_collision` for any target row owned by a source other than the promoting
  one. Refusing 8,686 rows already owned by `fitzroy_afldata` is the source-containment
  contract behaving exactly as designed — it never adopts and never deletes another
  source's authority.
- **ISSUE-128 changed no ownership behaviour.** `observations.ts`, `reconciliation.ts`,
  `canonical-apply.ts` and `settle-afltables.ts` (library) are all untouched by this issue
  (§7 "Not changed"). The collisions would be identical on `be4dd7e^`.

The 2026 match rows tell the same story: 189 matches unowned (legacy), 18 owned by
`afltables` (this run), 10 by `squiggle_api` (batch 69), 7 by `kali_afl_stats` (batch 80) —
i.e. **`afldb_dev` carries residue from three superseded ingestion paths.** That is shared
development contamination, not an ISSUE-128 defect.

### 12.7 The Wildcard matches were NOT guessed into canonical data [MEASURED]

Source rows, from the run's own `results.csv` (last two lines):

```text
17046,2026-08-28,"WF","Footscray",14,12,96,"Collingwood",14,9,93,"M.C.G.",3,2026,"Regular",
17047,2026-08-29,"WF","Melbourne",7,13,55,"Carlton",10,14,74,"M.C.G.",-19,2026,"Regular",
```

Canonical proof, `afldb_dev`, read-only:

| Query | Result |
|---|---|
| 2026 matches with `match_date >= 2026-08-26` | **0 rows** |
| 2026 `round_type` distribution | `home_and_away` **224**, min `2026-03-05`, **max `2026-08-23`** — no `finals` row of any kind exists for 2026 |
| 2026 matches pairing Footscray/Western Bulldogs–Collingwood or Melbourne–Carlton | **1 row**: id 16942, **2026-05-30**, round **13**, `home_and_away`, 97–93, owner NULL |

That single hit is the Round 13 home-and-away game (different date, different score,
legacy-owned) — **not** a Wildcard representation. Neither 28-Aug nor 29-Aug produced a
canonical match under any round type, from this run or any other source. The chain refused
at identity and stayed refused: **no guessed match, no misfiled round, no duplicate.**

### 12.8 The admin projection reports INCOMPLETE [MEASURED]

Executed `getLatestSettleRun()` from `src/db/queries/settle-runs.ts` directly — the same
function `/admin/current-season` consumes, not a re-implementation:

```json
{
  "batchId": "87",
  "snapshotLabel": "settle-2026-2026-09-03-1112",
  "season": 2026,
  "status": "completed",
  "recordsRead": 9729,
  "recordsRejected": 18,
  "counters": {
    "snapshotMatches": 207, "snapshotPlayerMatchRows": 9522,
    "snapshotRejections": 0, "snapshotUnkeyedRejections": 94,
    "absenceSweepSkipped": 2,
    "canonicalRowsInserted": 980, "canonicalRowsUpdated": 0,
    "canonicalApplicationsLogged": 854, "canonicalApplyRefusals": 189,
    "canonicalApplyFailures": 0, "unresolvedIdentity": 36,
    "advisoryDisagreement": 0,
    "derivedRecomputeRuns": 1, "derivedRecomputePlayers": 449
  },
  "sourceCompleteness": {
    "status": "incomplete",
    "unrepresentableRows": 94, "rejectedRecords": 0,
    "scopesNotSwept": 2, "enumeratedRecords": 9729,
    "reasons": [
      { "code": "unrepresentable_rows", "count": 94 },
      { "code": "scopes_not_swept",     "count": 2  }
    ],
    "headline": "Source INCOMPLETE: 94 unrepresentable row(s), 2 unswept scope(s). ..."
  }
}
```

§8.3 item 2 is satisfied at the data layer: the projection the panel renders returns
`incomplete` with both reason codes. The remaining piece is purely visual — an operator
looking at the rendered `role="alert"` block in a browser.

### 12.9 Verdict — what this validation does and does not prove

**PROVES (the ISSUE-128 acceptance condition):** a run can no longer silently report success
while source rows are unrepresentable. Identical input to the pre-fix run — 209/9,614
acquired, 207/9,522 represented, 94 dropped — previously exited **0** with a clean counter
table. It now emits a named `SOURCE INCOMPLETE` verdict at the importer, the settle CLI and
the admin projection, and exits **1**, while still committing every representable record
idempotently.

**DOES NOT PROVE, and does not need to:** that `afldb_dev` is a clean canonical database. It
is not. It carries `fitzroy_afldata`, `squiggle_api` and `kali_afl_stats` residue from three
superseded paths, which is why 8,686 rows collided. Those collisions are **orthogonal** to
this issue — they are the source-containment contract working, on code ISSUE-128 did not
touch, against rows that pre-date it by 19 days. Requiring a pristine database would test
`AFLDB-ISSUE-122`'s canonical apply, whose evidence is its own supervised production ladder
(§8.2), not this defect.

**STILL OUTSTANDING (unchanged by this validation):**
`tests/integration/settle-afltables.test.ts` against an `afldb_test` host (§8.3 item 3);
no behavioural change is expected there, since ISSUE-128 touches no settle-library or
canonical-apply code.

**OPERATOR VALIDATION: PASSED.**

### 12.10 Exact next action (superseded by §13 — closeout complete)

1. Eyeball `/admin/current-season` on dev and confirm the INCOMPLETE alert block renders
   above the counter table (§12.8 proves the data; this proves the pixels).
2. Run `tests/integration/settle-afltables.test.ts` against `afldb_test` (§8.3 item 3).
3. Remove the temporary systemd drop-in that repoints
   `afldb-settle-afltables.service` at `/home/arm/projects/afldb-issue-128`, so the unit
   returns to `/home/arm/projects/afldb`.
4. **Do not deploy to production until `AFLDB-ISSUE-129` is decided.** With the flag in
   place the nightly unit will report `failed` every night the Wildcard Round is in the
   acquired window. That is true and is the point — but the operator should know before it
   happens, not after.
5. Then close ISSUE-128 and start ISSUE-129 in a fresh session.

---

## 13. Closeout — 2026-09-03 [MEASURED]

All three residual steps from §12.10 are now accounted for. Two passed on the operator host.
One was not performed, and is recorded here as unverified rather than claimed.

### 13.1 Integration acceptance on `afldb_test` — §8.3 item 3 / §12.10 item 2 PASSED

Run by the operator on `streamanator`, from `/home/arm/projects/afldb-issue-128`:

| Suite | Result |
|---|---|
| `tests/integration/settle-afltables.test.ts` | **44 passed / 1 skipped / 0 failed** |

The single skip is the pre-existing restricted `afldb_import`-role validation, gated on
`AFLDB_TEST_IMPORT_DATABASE_URL`, which is unset on that host. It is not an ISSUE-128 skip,
and nothing was skipped, weakened or disabled to reach this result.

This **closes the §8.2 environmental blocker**, which was the only outstanding item in §12.9.
The expectation recorded there held: ISSUE-128 changed no settle-library and no
canonical-apply code, and the DB-backed acceptance shows no behavioural change on that path.

### 13.2 Temporary systemd override removed — §12.10 item 3 PASSED

The drop-in that repointed the unit at this worktree —
`/etc/systemd/system/afldb-settle-afltables.service.d/issue-128-validation.conf` — has been
deleted and `systemctl daemon-reload` completed. `systemctl cat` now proves the installed
unit is restored to the deployed checkout:

```ini
WorkingDirectory=/home/arm/projects/afldb
ExecStart=/bin/sh /home/arm/projects/afldb/deploy/afldb-settle-afltables.sh
EnvironmentFile=/home/arm/projects/afldb/.env
```

No ISSUE-128 worktree override remains on the host. The nightly `AFLDB-ISSUE-122` timer will
run against `/home/arm/projects/afldb`, not against this branch.

### 13.3 The rendered admin alert — §12.10 item 1 NOT PERFORMED

**Not verified, and not claimed.** Nobody loaded `/admin/current-season` in a browser to look
at the rendered alert block. §12.8 remains the strongest evidence for this item.

What is proven in its place, and why the issue closes without it:

- `getLatestSettleRun()` — the exact function the page consumes, executed directly, not
  re-implemented — returns `sourceCompleteness.status = "incomplete"` with both reason codes
  and the headline (§12.8).
- `tests/admin-current-season-settle.test.ts:521-522` asserts that `SettleRunPanel` reads
  `run.sourceCompleteness` and carries the `Source INCOMPLETE` copy.
- `src/app/admin/current-season/SettleRunPanel.tsx:240` renders
  `<SourceCompleteness verdict={run.sourceCompleteness} />` above the counter table, and
  `:59` carries the incomplete headline.

Those are source-text and data-layer assertions, **not** a rendered-DOM assertion, so a purely
cosmetic render fault would not be caught by them. The residual risk is therefore real but
cosmetic: it cannot make a run silently report success, which is the condition this issue
owns and which §12.9 proves is closed. The check is carried forward to `AFLDB-ISSUE-129`,
whose work must load this page in any case.

### 13.4 Acceptance verdict — RESOLVED

| Acceptance condition | Evidence | State |
|---|---|---|
| A run with unrepresentable source rows can no longer exit 0 / report success | §12.5, §12.9 — unit exited **1** with `Source INCOMPLETE: 94 unrepresentable row(s), 2 unswept scope(s)` | **PASSED** |
| Every representable record still commits, idempotently | §12.3 — batch **87** `completed`, 980 canonical rows, `canonicalApplyFailures = 0` | **PASSED** |
| The verdict is derived from the source's own counters, never a calendar | §6.1, `src/lib/acquisition/source-completeness.ts`; byes/off-season read `complete` | **PASSED** |
| The importer names the offending rows | §12.5, `SOURCE COMPLETENESS` block | **PASSED** |
| The admin projection carries the verdict | §12.8 — `sourceCompleteness.status = incomplete` from `getLatestSettleRun()` | **PASSED (data layer; render not eyeballed — §13.3)** |
| The legacy Kali `auto` path is removed, not relabelled | §6.4, §8.1 — `mode=auto` gone, unknown modes refused, no default source | **PASSED** |
| No data is guessed into canonical storage to satisfy the verdict | §12.7 — zero 2026 canonical matches on/after 2026-08-26; 2026 has no `finals` row | **PASSED** |
| DB-backed acceptance on a real host | §13.1 — 44/1/0 | **PASSED** |
| Host left clean | §13.2 — override removed, unit restored | **PASSED** |

**ISSUE-128 is RESOLVED 2026-09-03.**

### 13.5 What deliberately stays open

1. **`AFLDB-ISSUE-129` is the blocker that remains** — the `round_type` enum value, the
   AFLDB-wide finals-semantics decision, and the two source vocabularies. ISSUE-128 made the
   loss audible; it cannot make the rows land, and closing it does not make them land.
   **Not started here.**
2. **Production deployment is NOT authorised by this closeout and was not performed.** With
   `--require-complete-source` in place the nightly unit will report `failed` every night the
   2026 Wildcard Round is inside the acquired window. That is correct behaviour and is the
   whole point of the fix, but the operator should decide `AFLDB-ISSUE-129` first rather than
   meet a red timer unprepared. `db:privileges` was likewise not run.
3. **The cosmetic render check** (§13.3), carried to ISSUE-129.
4. `AFLDB-ISSUE-127` remains open on its own terms — its trigger control still awaits operator
   host validation. ISSUE-128 extended its result projection and touched nothing else of it.
