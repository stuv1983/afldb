# AFLDB-ISSUE-108 — `afldb_test` guarded integration is not green

- **Status:** Open — Path A complete, all 33 stable failures classified; awaiting the
  serial guarded re-run on Linux dev
- **Severity:** Medium
- **Area:** Test database / Data integrity / Tooling
- **Found:** 2026-08-29 (AFLDB-ISSUE-107 Linux Next 16 validation gate G2)
- **Owner runbook:** this file
- **Blocks:** `AFLDB-ISSUE-107` G2 (guarded database-integration leg)
- **Do not touch:** `AFLDB-ISSUE-068` (resolved), `AFLDB-ISSUE-109` (separate)
- **Resolution path:** **A — correct the stale test contract to the accepted canonical
  baseline `full-history-20260827`; run the guarded gate serially.** `afldb_test` is
  NOT rebuilt (§2: it already matches the baseline). See §9 for the implementation.

---

## 1. Carried-over findings from AFLDB-ISSUE-107

From the ISSUE-107 Linux development gate on `arm@10.0.40.100:/home/arm/projects/afldb`
(Next 16.3.1 / React 19.2.8 / Node v22.23.2), guarded `vitest run` against the
`afldb_test` DSN:

| Run | Files | Tests |
|---|---|---|
| Default (parallel) | 7 failed / 82 passed / 5 skipped | 36 failed / 2,497 passed / 85 skipped |
| `--no-file-parallelism` | 6 failed / 83 passed / 5 skipped | 33 failed / 2,500 passed / 85 skipped |

- `afldb_test` schema is current: **77/77 migrations**, no checksum drift.
- The 3 parallel-only failures are cross-file interference on the one shared
  `afldb_test` (a transient `2094` season asserted by `release-gates` while another
  suite held it; `settle-afltables` seeing canonical counts move underneath it).
- The 33 stable failures import nothing from `next`, `react` or `src/app`; every
  assertion is PostgreSQL content or on-disk corpus state. **Not framework
  attributable.**

Representative stable failures (expected vs observed on `afldb_test`):

| Assertion (test) | Expected | Observed |
|---|---:|---:|
| `sum(brownlow_season_votes.votes)` (`release-gates`, `database`) | 79,113 | 0 / null |
| `player_match_stats` row count (`database` :146) | 694,210 | 685,471 |
| players with `dob IS NOT NULL` (`release-gates` :604) | 12,478 | 855 |
| players honestly without a date (`release-gates` :692) | 883 | 12,422 |
| DraftGuru identity links resolved once per person (`release-gates` :439) | 3,459 | 5 |
| advanced-search cohort "50–199 goals, 0 Brownlow" (`release-gates` :206) | 269 | 1,690 |
| `tests/draftguru-acquisition.test.ts` | corpus present | `ENOENT data/sources/draftguru/full-history-20260826` |

---

## 2. Root cause (diagnosis — no rebuild required or run)

**`afldb_test` is not stale relative to the canonical baseline. It already *matches*
it.** The failing assertions encode figures from the retired **legacy SQLite import**
era that the canonical legacy-free rebuild (`AFLDB-ISSUE-093`) deliberately does not
reproduce.

Evidence — `data/reference/fitzroy-accepted-baselines.json`, the single accepted
baseline `full-history-20260827`, `measured` block (re-derived from the snapshot on
every validate, the authoritative expectation for a canonical rebuild):

| `measured` key | Accepted value | Current `afldb_test` | Failing test wants |
|---|---:|---:|---:|
| `player_match_rows` | **685,471** | 685,471 | 694,210 |
| `players_with_dob` | **855** | 855 | 12,478 |
| `players_with_dob_conflict` | 0 | 0 | — |
| `brownlow_round_vote_rows` | 320,861 | — | — (tests read `brownlow_season_votes`) |
| `players` (AFL Tables ext identities) | 13,275 | 13,275 (+2 DraftGuru shells = 13,277) | — |

`tools/db/rebuild-test.ts` further confirms the canonical rebuild **does not** produce
the tested figures:

- `MEASURED_NOT_DB_GATED` explicitly excludes `players_with_dob` /
  `players_with_dob_conflict` from FINAL VALIDATION — "birth dates arrive via
  `player_birth_evidence` and DOB enrichment (ISSUE-090), so a raw count is not this
  baseline's claim". 855 is the contracted figure.
- There is no `brownlow_season_votes` writer in the canonical stage graph
  (reference → fitzRoy → DraftGuru → derived). `AFLDB-ISSUE-090.md` §27.5 records
  "no legacy-free writer for `brownlow_season_votes`". A canonical rebuild leaves the
  table empty → `sum(votes)` is `0`/`null`.
- DraftGuru Stage B3 (person-page → AFL Tables identity bridge) "is optional and
  absent by default; unbridged persons stay `unmatched`" (`docs/deployment.md` §6a).
  Without it, DraftGuru identity links resolve to **5**, not 3,459.
- The full DOB population (12,478) needs `enrich_birth_dates.py` /
  `import_awards.py` register passes that require `AFLDB_LEGACY_SQLITE` plus the
  gitignored club-list CSVs — none present, all outside the canonical rebuild.

The guarded suite has **not been green on a canonically-rebuilt `afldb_test` at any
point**: `release-gates.test.ts` was 42→**45/64** after ISSUE-095 (2026-08-28), with
the remaining ~19 failures already attributed to "Brownlow acquisition, DraftGuru
Stage B3, DOB enrichment, attendance baseline, current-season 2026" — i.e. exactly
this set. ISSUE-090 already **retired the five `gate: birth dates` population
assertions as acceptance** for the same reason; the equivalent `IMMUTABLE`-labelled
pins in `release-gates.test.ts` / `database.test.ts` / `db-health.test.ts` were not
carried through the same retirement.

### Classification (per the failure-handling taxonomy)

- **C — stale test expectation** (primary): the `IMMUTABLE` legacy-era pins
  (694,210 `player_match_stats`; 79,113 `brownlow_season_votes`; 46,979 per-game
  votes; 12,478 / 883 DOB; 3,459 DraftGuru links; 269 advanced-search cohort) do not
  describe the canonical legacy-free dataset.
- **B — missing authoritative input** (contributing): the legacy-free acquisition
  paths for season-grain Brownlow votes, full DOB enrichment and DraftGuru B3
  identity linking do not exist yet and are tracked as separate open work
  (`AFLDB-ISSUE-090` §27.5 observations, `AFLDB-ISSUE-102`, DraftGuru B3).
- **Not A** (rebuild/import defect): the canonical rebuild's own accepted `measured`
  fingerprint equals the current `afldb_test` content on every gated key.
- `tests/draftguru-acquisition.test.ts` ENOENT is a genuine **absent-input** case
  (the gitignored `full-history-20260826` CSV parity oracle), independent of the
  data baseline.
- 3 parallel-only failures are a known vitest-file-parallelism-vs-shared-DB quirk,
  cleared by `--no-file-parallelism`.

**Conclusion:** `npm run db:test:rebuild` would reproduce the identical "failing"
numbers (855 DOB, 685,471 `player_match_stats`, empty `brownlow_season_votes`, 5
DraftGuru links) and resolve none of the 33 failures. A destructive rebuild is
therefore **not the fix** and was not run.

---

## 3. Investigation of the two previously-cited blockers

### 3.1 `AFLDB_TEST_IMPORT_DATABASE_URL`

- Project contract (`.env.example` :62–66): "Optional restricted credential for
  importer role-parity integration tests. It MUST target the same `*_test` database
  as `AFLDB_TEST_DATABASE_URL` but log in as `afldb_import`. When absent, restricted
  importer-role tests skip explicitly; they never fall back to the owner credential."
- Used by `tools/db/rebuild-test.ts` `resolveTarget()` for data stages 5–8; the
  runner **fails closed** without it and never inherits the dev
  `AFLDB_IMPORT_DATABASE_URL` (which points at `afldb_dev`).
- **Legitimate source:** a DSN on the dev host's own PostgreSQL 16 instance, role
  `afldb_import`, database `afldb_test`, e.g.
  `postgresql://afldb_import:<pw>@localhost:5432/afldb_test`. The `afldb_import`
  role already exists on the host (it is used for `afldb_dev` imports); only a
  `_test`-scoped DSN string is missing from `.env`. It is **not** a separate
  database and must **not** be `afldb_dev`.
- Only required if a rebuild is actually run. Given §2, it is not needed to resolve
  this issue.

### 3.2 DraftGuru corpora (two distinct artefacts, often conflated)

| Artefact | Path (gitignored) | Consumed by | Needed for the rebuild? |
|---|---|---|---|
| Stage A accepted snapshot `annual-html-20260826` | `data/sources/draftguru/annual-html-20260826/` (`raw/` + `parsed/`) | rebuild stage 7 `import_draftguru.py --label annual-html-20260826`; preflight `--validate-only` (must report 42 year pages, 5,057 persons, 6,810 picks) | **yes** |
| CSV parity oracle `full-history-20260826` | `data/sources/draftguru/full-history-20260826/` (42 `*_Draft_and_Trade_Period_Table_1.csv`) | `tests/draftguru-acquisition.test.ts` only — "independent validation/parity oracle only, read-only, import-incapable" (`draftguru-contract.json` `csv_artifact`) | no |

- Tracked manifests exist for both: `docs/rebuild-manifests/draftguru/annual-html-20260826.json`
  and `docs/rebuild-manifests/draftguru/csv-export-20260826.json`. Raw bytes are
  gitignored by convention (`.gitignore` :45) and reproduced by acquisition.
- Neither is present on this Windows worktree (`data/sources/` does not exist — a
  fresh worktree never has it). Whether they survive on the Linux dev host is a
  read-only check for the operator (see §5).
- The ISSUE-107 gate reported `ENOENT .../full-history-20260826` — that is the CSV
  **oracle**, i.e. only `tests/draftguru-acquisition.test.ts` is affected by its
  absence, not the rebuild.

### 3.3 fitzRoy core

- Accepted canonical baseline: **`full-history-20260827`**, snapshot dir
  `data/sources/afltables/fitzroy_core/full-history-20260827/` (131 files, 719,042
  rows), manifest tracked and SHA-256-bound. Resolved automatically by the rebuild
  from the acceptance register — `--fitzroy-label` is optional and, if given, must
  equal `full-history-20260827`.
- Ladder witness: `ladder-20260828` (`fitzroy-contract.json`
  `datasets.ladder.accepted_witness`), also gitignored raw / tracked manifest.

---

## 4. Safety gate (designed; to be executed by the operator only *if* a rebuild is
later authorised)

`tools/db/rebuild-test.ts` already enforces the structural half. Before any
destructive run the operator must additionally prove, read-only, on the dev host:

1. `AFLDB_TEST_DATABASE_URL` resolves to database `afldb_test`
   (`SELECT current_database()` over that DSN returns `afldb_test`).
2. The target name ends in `_test` and is exactly `afldb_test`
   (`assertRebuildTargetName` — enforced in code).
3. `AFLDB_PROD_DATABASE_URL` is absent from `.env` and the shell, and the systemd
   unit's `UnsetEnvironment=` drops it (already confirmed under ISSUE-107).
4. `AFLDB_TEST_IMPORT_DATABASE_URL`, if set, resolves to the **same** `afldb_test`
   database as `AFLDB_TEST_DATABASE_URL`, role `afldb_import`
   (`resolveTarget` refuses a mismatch; `guard.ts` /
   `validateImportRoleParityDsnTargets` cross-checks).
5. The rebuild command carries `--acknowledge-destroy afldb_test`; the runner's
   `_test` refusal guard (`assertRebuildTargetName`, `FORBIDDEN_DATABASES`) is
   unmodified.
6. `--plan` first, to print the 9-stage graph and confirm no stage targets
   `afldb_dev` or production (data stages carry an explicit
   `AFLDB_IMPORT_DATABASE_URL` overlay = the test import DSN).

Canonical command (only if authorised):

```bash
npm run db:test:rebuild -- --acknowledge-destroy afldb_test        # --plan first
```

Destruction is authorised for `afldb_test` only. It must not mutate `afldb_dev` or
production.

---

## 5. Operator read-only confirmation of the diagnosis (no writes)

Run on `arm@10.0.40.100`, `/home/arm/projects/afldb`, against the **test** DSN.
This confirms §2 without touching any database:

```bash
# identity + schema
psql "$AFLDB_TEST_DATABASE_URL" -Atc "select current_database(), count(*) from schema_migrations"

# the values the guarded suite pins vs the accepted baseline's measured block
psql "$AFLDB_TEST_DATABASE_URL" -Atc "
  select 'player_match_stats', count(*) from player_match_stats
  union all select 'players_with_dob', count(*) from players where dob is not null
  union all select 'players_no_dob', count(*) from players where dob is null
  union all select 'brownlow_season_votes_sum', coalesce(sum(votes),0) from brownlow_season_votes
  union all select 'draft_persons', count(*) from draft_persons
  union all select 'afltables_ext_identities', count(*)
    from external_identities ei join sources s on s.id=ei.source_id where s.key='afltables'"

# corpora presence on the host
ls -d data/sources/afltables/fitzroy_core/full-history-20260827 \
      data/sources/draftguru/annual-html-20260826 \
      data/sources/draftguru/full-history-20260826 2>&1
```

Expected (diagnosis holds if): `current_database()` = `afldb_test`, `77`
migrations; `player_match_stats` = 685,471; `players_with_dob` = 855;
`brownlow_season_votes_sum` = 0; `afltables_ext_identities` = 13,275. These equal
the accepted `full-history-20260827` `measured` fingerprint — i.e. the data is
already canonical and a rebuild changes nothing relevant.

---

## 6. Decision point (needs operator / authoritative project call)

A rebuild cannot resolve ISSUE-108. The legitimate resolutions are:

- **(A) Re-pin the guarded suite to the canonical legacy-free baseline** — extend
  the `AFLDB-ISSUE-090` retirement to the remaining `IMMUTABLE` legacy-era pins in
  `tests/integration/release-gates.test.ts`, `database.test.ts`, `db-health.test.ts`:
  `player_match_stats` 694,210 → 685,471; `brownlow_season_votes` 79,113 →
  documented gap (0 until a legacy-free season-grain writer exists); DraftGuru
  links 3,459 → 5 (until Stage B3); DOB 12,478/883 → 855/12,422; advanced-search
  cohort 269 → re-measured. Each change cites the accepted `measured` block or the
  owning open issue. The genuine data gaps stay tracked as
  `AFLDB-ISSUE-090` §27.5 / `AFLDB-ISSUE-102` / DraftGuru B3 — **not** closed by
  weakening a test.
- **(B) Land the legacy-free acquisition paths first** — season-grain Brownlow
  writer, full DOB enrichment, DraftGuru B3 — then the existing pins pass
  unmodified. This is substantial multi-issue work and contradicts nothing, but it
  is not an ISSUE-108-scoped change.
- **(C) Split the guarded gate** — mark the legacy-parity assertions `SNAPSHOT`
  (re-pin, not bug) rather than `IMMUTABLE`, and adopt `--no-file-parallelism` for
  the guarded run so the 3 shared-DB flakes stop counting.

Recommended: **(A) + `--no-file-parallelism`**, with (B) as separate tracked work.
Not actioned here pending the operator's confirmation that the legacy-era figures
are accepted as obsolete under the canonical rebuild.

---

## 7. What was NOT done, and why

- **No destructive rebuild.** It is blocked (no `AFLDB_TEST_IMPORT_DATABASE_URL`,
  corpora unverified on host) *and*, decisively, it would reproduce the same failing
  numbers (§2). Running it would destroy `afldb_test` for no benefit.
- **No test-expectation edits.** Per the runbook contract, expectations change only
  on an authoritative call that the legacy-era figures are obsolete — brought to the
  operator in §6, not made unilaterally on `IMMUTABLE`-labelled gates.
- **No `afldb_dev` or production mutation.** No database was written. No SSH, psql,
  npm, migration or deployment command was executed from this session.
- **No Git operations.**
- `AFLDB-ISSUE-107` G2 stays blocked; `AFLDB-ISSUE-107` remains Open. `AFLDB-ISSUE-068`
  and `AFLDB-ISSUE-109` untouched.

---

## 9. Path A implementation — 2026-08-30

Operator authorised Path A + serial guarded execution. `afldb_test` was **not**
rebuilt. Confirmed read-only baseline (dev host, test DSN): `current_database` =
`afldb_test`; 77 migrations; `player_match_stats` 685,471; `players_with_dob` 855
(disputed 0, evidence 855, evidence-linked 855); `players` without a date 12,422;
`brownlow_season_votes` sum 0 (`player_career_stats` / `player_season_stats`
Brownlow sums 0; `player_match_stats` Brownlow sum 46,970); `brownlow_round_votes`
320,861; `draft_persons` 5,057 (linked 5); `draft_picks` 6,810; AFL Tables external
identities 13,275; `clubs` 24; `club_organizations` 21. Every gated value equals the
accepted `full-history-20260827` `measured` fingerprint.

### 9.1 Adjudicated non-A findings

| # | Failure | Bucket | Finding / action |
|---|---|---|---|
| D | `db-test-rebuild.test.ts` "binds acceptance to the acquisition manifest bytes" | **Cross-platform line-ending defect** | The register's `manifest_sha256` was bound to the **Windows CRLF working-tree** bytes (`cc8aaf09…`). Canonical repository/LF content hashes to `a42c6d5f…` (confirmed: `sha256(bytes.replace(CRLF,LF))` = `a42c6d5f…`). Repaired to be platform-independent: register `manifest_sha256` → `a42c6d5f…`; `db-test-rebuild.test.ts` normalises CRLF→LF before hashing; `season-rollover.test.ts` literal updated; new `.gitattributes` forces `eol=lf` on `docs/rebuild-manifests/**`, `data/reference/*.json`, `tools/rebuild/**/*.json` so `import_fitzroy_core.py:sha256_file()` is byte-identical on every platform. The Linux manifest was **not** touched. `import_fitzroy_core.py` unchanged — on Linux it already reads LF = `a42c6d5f…` = new register. Historical evidence docs (`AFLDB-ISSUE-093*.md`, `issues.md`) keep the `cc8aaf09…` value as the record of what was measured then. |
| E | `db-health.test.ts` "no drift … source fact tables" — 2 players with no `player_career_stats` | **Intentional canonical shells** | The two rows are `13276 Fred Rodriguez` and `13277 Riley Onley` — DraftGuru-seeded canonical player shells, 0 `player_match_stats`, 1 `draft_person` each, no match history. `reconcileCareerTotals()` check #5 in `src/db/queries/db-health.ts` narrowed: a career row is required only for players **with** `player_match_stats`. No synthetic rows created. |
| C | `data-editor.test.ts` "derives the ladder … following a score correction" | **Test-fixture defect** | The fixture reversed a result by swapping only `home_score`/`away_score`, which now violates `matches_score_components_ck` (each total must equal 6·goals + behinds). Production constraint is correct. Fixed the fixture to swap goals and behinds as well, keeping the mutation internally consistent. |
| B | `draftguru-acquisition.test.ts` "the frozen CSV corpus itself is intact" | **Missing gitignored parity oracle** | `data/sources/draftguru/full-history-20260826/` is a gitignored, import-incapable parity oracle reproduced by acquisition; not part of any rebuild. Guarded with `existsSync` → `it.skip` when absent, mirroring the file's existing `itPy` python-spawn guard. Corpus not manufactured. |

### 9.2 Class-A stale-contract changes (test expectations only)

Two sub-classes, per the operator's test-contract rule:

**Re-pinned to the accepted baseline `full-history-20260827`** (canonical value exists):

| Assertion | Legacy → canonical | Source |
|---|---|---|
| `database.test.ts` player_match_stats count | 694,210 → **685,471** | `measured.player_match_rows` |
| `release-gates.test.ts` "records why each attendance is missing" — `complete` | 15,376 → **15,187** | `measured.attendance_known` (16,838 − 15,187 = 1,651 not_collected) |
| `release-gates.test.ts` "gate: birth dates" — players with DOB / disputed | 12,478 / 2 → **855 / 0** | `measured.players_with_dob`; renamed to "populates 855 canonical dates with no conflicts" |
| `release-gates.test.ts` "gate: birth dates" — evidence rows / evidence-linked | 12,472 / 11,533 → **855 / 855** | confirmed baseline |
| `release-gates.test.ts` "gate: birth dates" — players with no date | 883 → **12,422** | confirmed baseline (855 + 12,422 = 13,277) |

**Skipped with a tracked-gap reference** (no canonical writer; zero/minimal is a
missing-acquisition gap, not an authoritative value — re-enable when the path lands):

| Assertion(s) | Owning gap |
|---|---|
| `release-gates` "gate: Brownlow authority" — season/career total 79,113 (4 `it`s); `database.test.ts` "Brownlow correctness" (3 `it`s); the two "50–199 goals & 0 Brownlow" cohort gates (269) | No legacy-free `brownlow_season_votes` / season-grain Brownlow writer — `AFLDB-ISSUE-090` §27.5 |
| `release-gates` "resolves identity once per person …" — `linked` 3,459; "separates genuine non-players from a real matching backlog" — backlog 100 | DraftGuru Stage B3 person-page identity bridge, not in the canonical default rebuild (`docs/deployment.md` §6a). A new `it` "retains exactly 5,057 draft persons" keeps the population guard. |
| `release-gates` "records the backlog as open data issues" — 100 | No canonical writer for `unlinked_player_with_games` — `AFLDB-ISSUE-090` §27.5 |
| `release-gates` "gate: 2026 is provisional" — as-at date / 2026 `player_season_stats` / `staging.team_seasons` (3 `it`s) | Current-season import pipeline (`AFLDB-ISSUE-099`) + retired legacy ladder load — not produced by `db:test:rebuild`; belongs to a post-current-season-import gate. The 2026 structural guarantees stay live. |
| `release-gates` "gate: birth dates" — conflict-adjudication (2 `it`s) | DOB-enrichment passes (`AFLDB_LEGACY_SQLITE` + gitignored club-list CSVs) — already retired-as-acceptance by `AFLDB-ISSUE-090` |

### 9.3 Serial guarded execution

`vitest.config.mts` now sets `test.fileParallelism: false`. Every integration suite
shares the one mutable `afldb_test`; under file parallelism one suite's fixture
mutations (a transient season, in-flight draft links, moving canonical counts) are
read by another suite's assertions — the 3 failures that appear only in parallel
(36 vs 33) and vanish under `--no-file-parallelism`. Making it the config default,
not a flag, keeps the guarded gate deterministic; DB-free suites pay a small
wall-clock cost.

### 9.4 The final seven — adjudicated 2026-08-30

The §9.4 shortlist as first drafted was partly wrong. Two of the listed assertions
(`release-gates` "does not infer empty pandemic crowds as zero"; `database`
"debuted in the 1960s and played for exactly two clubs") **passed** and were not
changed. The actual seven, and the evidence that settled them, follow.

#### 9.4.1 Root cause of five of the seven: `players.id` is a re-seeded surrogate

`import_fitzroy_core.py:import_players()` inserts players as
`INSERT INTO players (display_name, sort_name, search_name, slug, given_name,
surname, debut_season, final_season)` — **no `legacy_player_id`** — and resolves
identity by the AFL Tables profile URL through `external_identities`
(`match_method = 'afltables_profile_url'`). The canonical legacy-free rebuild
therefore lets the identity sequence assign every `players.id` afresh. Measured
read-only on `afldb_test`:

| Check | Value |
|---|---:|
| `players` | 13,277 |
| `players` with `legacy_player_id` populated | **0** |

Every `players.id` pinned in the guarded suite is a **retired legacy surrogate**
that now addresses an unrelated person:

| Pinned ID | Legacy meaning | Canonical `afldb_test` |
|---:|---|---|
| 788 | Brent Harvey | Arthur Ford |
| 2520 / 2521 | Ron Barassi Sr / Jr | Campbell Gray / Campbell Heath |
| 1105 / 567 | Gary Ablett Jr / Sr | Ben King / Andrew Foster |
| 3702 / 3578 | Bob Skilton / Dick Reynolds | David Stark / Des Field |

This is **obsolete addressing, not identity corruption**. Every person the gates
exist to protect is present and correct:

| Person | Canonical record |
|---|---|
| Brent Harvey | id 2164, 432 games, `clubs_played` 1, stints `Kangaroos:200 + North Melbourne:232` |
| Ron Barassi Sr | id 11248, 58 games, 1936–1940 |
| Ron Barassi Jr | id 11247, 254 games, 1953–1969 |
| Gary Ablett Jr | id 4702, 357 games, 2002–2020 |
| Gary Ablett Sr | id 4701, 248 games, 1982–1996 |

**Repair:** re-anchor each gate to the data instead of to a surrogate — surname
lookup through `search_name`/`afldb_normalise_name`, discriminated by the career
facts (games, debut/final season, stint count). The gates get *stronger*: they now
fail if the person is wrong, and they survive the next rebuild. New surrogate IDs
were deliberately **not** substituted for old ones; that would only reset the same
trap. The two still-skipped Brownlow blocks carry a note so a future re-enable
re-addresses 3702/3578 rather than reintroducing the bug.

#### 9.4.2 Item-by-item

| # | Assertion | Verdict | Action |
|---|---|---|---|
| 1 | `release-gates` "debuted in the 1960s with exactly two clubs returns the exact 110 players" — count 110 **passed**, `idHash` `42d5dd22…` vs `8cebc4aa…` | **Surrogate-ID hash, not a membership change.** The digest was taken over `players.id`, which §9.4.1 shows is re-seeded, so it necessarily changes on a rebuild even for identical membership — and the count is unchanged at exactly 110. | Digest re-based on the durable AFL Tables identity (`external_identities.external_id`, source `afltables`, `afltables_profile_url`, status `unique`/`resolved`): **110 cohort players → 110 identity keys → `4b4c6a2aa975cc17`**. The key-count assertion means a dropped identity cannot hide behind a matching digest. Still an exact-membership gate, now rebuild-stable. |
| 2 | `release-gates` "records a genuine zero for a player who polled none in a decided season" — 0 qualifying rows, expected > 0 | **Structurally unreachable, not numerically low.** `rebuild_derived.py` sets `brownlow_status = 'complete'` only where `brownlow_season_votes` holds a row for that season; the canonical rebuild writes none, so no season is `complete`. Measured: `brownlow_season_votes` 0 rows, `player_season_stats` `complete` 0 rows. | Retired under `AFLDB-ISSUE-090` §27.5 with the other Brownlow gates. **Not pinned to 0** — 0 would assert the absence of the semantics the gate exists to protect. Re-enable unchanged when the legacy-free season-grain path lands. |
| 3 | `database` "counts a renamed club once in `clubs_played`" — `career.clubs` 1 **passed**, stints 1 vs 2 | **Obsolete surrogate ID.** 788 is Arthur Ford, a one-stint player; the first assertion passed by coincidence. Brent Harvey's canonical record is exactly what the gate claims: `clubs_played` 1 across `Kangaroos` + `North Melbourne`. | Witness resolved as the highest-games player named Harvey (Harvey holds the all-time games record); asserts 432 games, `clubs_played` 1, 2 `player_clubs` stints. |
| 4 | `database` "keeps players who share a name distinct" — first `games` 3 vs 58 | **Obsolete surrogate ID.** 2520/2521 are Campbell Gray/Heath. The Barassis are intact and distinct. | Resolved by surname, ordered by `debut_season`; asserts two distinct rows and both careers: 1936–1940 / 58 games and 1953–1969 / 254 games. The sibling `release-gates` "keeps the two Ron Barassis distinct" was **passing on the same wrong pair** and is re-anchored identically — it was proving nothing. |
| 5 | `database` "finds both Gary Abletts and ranks the more prominent first" — IDs 4702, 4701, 4770, … ; expected 1105/567 | **Obsolete surrogate IDs; ranking semantics are correct.** Both canonical Ablett careers are present and the son sorts ahead of the father on games, exactly as the gate requires. | Assertions moved off IDs onto the two careers: rank 1 = 357 games from 2002, rank 2 = 248 games from 1982, distinct players. |
| 6 | `database` "200-249 games with 16 or more finals" — 115 vs 117 | **Class-A re-pin, entailed by the accepted baseline.** | → **115** |
| 7 | `database` "200+ games, 100+ goals and 15+ finals" — 219 vs 222 | **Class-A re-pin, entailed by the accepted baseline.** | → **219** |

#### 9.4.3 Why 115 and 219 follow from the accepted data rather than from current output

`player_career_stats` is a pure aggregate of `player_match_stats` joined to
`matches` (`rebuild_derived.py` `REBUILDS["player_career_stats"]` over `pg_ctx`);
`games`, `goals` and `finals` have no other input. Measured read-only on
`afldb_test`:

| Fact table | Derived table | Agree |
|---|---|---|
| `player_match_stats` rows 685,471 | `sum(player_career_stats.games)` 685,471 | ✔ |
| player rows in `is_final` matches 29,318 | `sum(player_career_stats.finals)` 29,318 | ✔ |
| `sum(player_match_stats.goals)` 407,963 | `sum(player_career_stats.goals)` 407,963 | ✔ |

685,471 is the accepted baseline's own `measured.player_match_rows`, and
`db-health.test.ts`'s drift gate asserts the same three agreements continuously.
Any cohort defined over `games`/`goals`/`finals` is therefore **entailed** by the
accepted `full-history-20260827` fingerprint, not merely equal to whatever the
database currently returns. The retired 117 and 222 were entailed by the
694,210-row legacy SQLite set — a different, retired input.

#### 9.4.4 Follow-up recorded, not actioned here

`tools/validation/validate_migration.py` and its oracle
`tests/fixtures/oracle_baseline.json` are still bound to the retired legacy dataset
(`_aggregates.games_rows` 694,210, `players_rows` 13,361, legacy-ID cohort lists and
`_representative_players` keyed by legacy ID). That tool is **not** part of the
guarded vitest gate, so it does not affect this issue's validation, but it cannot
pass against a canonically rebuilt database and its ID-set oracle has the same
surrogate-addressing defect repaired above. Re-basing it belongs with the canonical
rebuild's own validation work, not with ISSUE-108.

## 10. Files changed (Path A)

- `data/reference/fitzroy-accepted-baselines.json` — `manifest_sha256` → canonical LF hash `a42c6d5f…`.
- `.gitattributes` (new) — `eol=lf` for hash-bound artefacts.
- `vitest.config.mts` — `fileParallelism: false` for the shared-`afldb_test` gate.
- `src/db/queries/db-health.ts` — `reconcileCareerTotals()` "missing career row" check scoped to players with match history.
- `tests/db-test-rebuild.test.ts` — LF-normalised manifest-hash comparison.
- `tests/season-rollover.test.ts` — `manifest_sha256` literal → `a42c6d5f…`.
- `tests/integration/db-health.test.ts` — comment only.
- `tests/integration/data-editor.test.ts` — score-reversal fixture swaps goals & behinds.
- `tests/draftguru-acquisition.test.ts` — CSV parity-oracle test guarded with `existsSync`.
- `tests/integration/release-gates.test.ts` — Class-A re-pins + skips (§9.2); the
  1960s/two-club membership digest re-based on the durable AFL Tables identity and
  the Ron Barassi collision gate re-anchored by name (§9.4); the decided-season
  Brownlow genuine-zero gate retired (§9.4.2 #2).
- `tests/integration/database.test.ts` — Class-A re-pins + skips (§9.2); the club
  identity, name-collision and Gary Ablett search gates re-anchored from retired
  surrogate IDs to the data (§9.4.1); cohort counts re-pinned 117 → 115 and
  222 → 219 (§9.4.3).

## 11. Log

- **2026-08-30** — Issue investigated from the AFLDB-ISSUE-107 handoff. Established
  that `afldb_test` already matches the accepted `full-history-20260827` `measured`
  fingerprint; the 33 stable failures are legacy-era `IMMUTABLE` test pins the
  canonical legacy-free rebuild does not reproduce, plus one absent CSV parity
  oracle and 3 shared-DB parallelism flakes. **This supersedes the original
  "stale afldb_test data" hypothesis** (kept in §1/§2 as lineage): the data is
  canonical; the test contract was stale. Rebuild not run.
- **2026-08-30** — Operator authorised Path A. D/E/C/B adjudicated (§9.1); Class-A
  changes applied (§9.2); guarded gate made serial (§9.3). 26 of 33 failures
  addressed with established ownership; 7 cohort/recent-season assertions pending
  the Received values from the existing serial baseline log (§9.4). Awaiting the
  serial guarded re-run on Linux dev after the changes are pushed.
- **2026-08-30** — Final seven adjudicated against read-only `afldb_test` evidence
  (§9.4). Five were one defect: the canonical rebuild re-seeds `players.id` (0 of
  13,277 players carry a `legacy_player_id`), so every pinned legacy surrogate now
  addresses a different person — obsolete addressing, not identity corruption. Those
  gates are re-anchored to the data and are now rebuild-stable, including the
  1960s/two-club membership digest, which moves from an ID-set hash to the durable
  AFL Tables identity hash `4b4c6a2aa975cc17` over 110 identity keys. The
  decided-season Brownlow genuine-zero gate is structurally unreachable without a
  season-grain writer and is retired under `AFLDB-ISSUE-090` §27.5 rather than
  pinned to 0. The two cohort counts re-pin to 115 and 219, proven entailed by the
  accepted baseline via exact fact→derived aggregate agreement (§9.4.3). Two
  assertions on the original shortlist were already passing and were left alone. All
  33 stable failures are now classified. **`afldb_test` was not rebuilt; no
  `afldb_dev`, production, database-write or Git command was run.** ISSUE-108 stays
  **Open** until the Linux serial suite is actually green.
