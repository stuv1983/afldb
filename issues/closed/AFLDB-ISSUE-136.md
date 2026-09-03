# AFLDB-ISSUE-136 — fitzRoy canonical player identity split on blank ID + renumbered AFL Tables URL

**Status:** **RESOLVED 2026-09-04** on `claude/issue-136` — core fix implemented, register
amendment ratified (§6), **canonical database rebuild and ISSUE-113 V5 witness GREEN on the shared
`afldb_test` (§13)**, split HALT exercised against the real database. Committed on
`claude/issue-136`; not merged, not deployed. Production still holds the split — tracked separately
as `AFLDB-ISSUE-137`.
**Severity:** High — data integrity. Four real careers are split across two canonical players
each in every canonically rebuilt database, **including production**.
**Area:** Data acquisition / Import architecture / Data integrity
**Branch / worktree:** `claude/issue-136` — `D:\dev\afldb-issue-136`
**Migration:** none. No schema change; `external_identities` already permits several
`(source_id, external_id)` rows per `player_id`.
**Found:** 2026-09-04, while validating the `AFLDB-ISSUE-113` Brownlow restoration (V5).
**Related:** `AFLDB-ISSUE-113` (the consumer that exposed it; its V5 identity condition is
satisfiable only after this fix reaches the database), `AFLDB-ISSUE-093` (the importer and
its identity rules), `AFLDB-ISSUE-099` P5 (measured the same five blank-ID urls in-season and
correctly made `ID` enrichment-only — but did not ask *why* they were blank), `AFLDB-ISSUE-112`
(the accepted baseline whose record is amended here), `AFLDB-ISSUE-122` (the settle resolves
urls through the identities this fix registers), `AFLDB-ISSUE-110`/`-111` (awards census keyed
on the live urls).

---

## 1. Symptom

The accepted fitzRoy snapshot `full-history-20260902` contains 83 `player_stats` rows with a
blank fitzRoy `ID` under five profile urls that carry no ID anywhere in the snapshot, all in
season 2025. For four of them the url is a **renumbered** AFL Tables profile of a player whose
2014–2024 rows sit under a different url with a populated ID. The importer keys identity on
the url, so it seeded a second canonical player for each:

| Player | Continuing profile (fitzRoy ID, seasons, rows) | Renumbered profile (2025 only, no ID, rows) | Career game at the boundary |
|---|---|---|---|
| Charlie Cameron | `players/C/Charlie_Cameron.html` (12277, 2014–2024, 229) | `players/C/Charlie_Cameron3.html` (25) | 229 → 230 |
| Jack Graham | `players/J/Jack_Graham.html` (12576, 2017–2024, 131) | `players/J/Jack_Graham2.html` (18) | 131 → 132 |
| Jack Ross | `players/J/Jack_Ross.html` (12712, 2019–2024, 70) | `players/J/Jack_Ross3.html` (23) | 70 → 71 |
| Jack Williams | `players/J/Jack_Williams.html` (12962, 2022–2024, 29) | `players/J/Jack_Williams3.html` (13) | 29 → 30 |

79 rows. The fifth blank-ID profile is **not** a split: `players/B/Billy_Wilson2.html` (4 rows,
DOB 16-Jun-2005) debuts on 2025-06-26 as **career game 1**. The two older Billy Wilson profiles
(1913–1914, 1932–1935) are different footballers. He is a genuine new player.

Downstream, in a rebuilt database (measured by ISSUE-113 V5 on `afldb_test`, and the same
shape on production): Charlie Cameron's 2019–2024 and Jack Graham's 2019–2022 Brownlow round
votes sit on the career player while the season rows keyed on the live url resolve to the
2025-only duplicate — ten player-seasons, 34 votes, the entire 79,113 vs 79,079 discrepancy.
The awards census (`data/awards/player-identity.csv`) maps bootstrap 12277 → `Charlie_Cameron3`
and 12576 → `Jack_Graham2`, so his All-Australian (2019, 2023), AA squad (2021, 2022) and
Rising Star (2015) rows and Graham's Larke Medal also attach to the duplicates. The 2026
settle's rows for these four arrive under the renumbered urls and land the same way.

## 2. Root cause (mechanism, proven from the snapshot)

fitzRoy 1.8.0 `fetch_player_stats_afltables` serves completed seasons from its cached
release data (profile url and numeric `ID` as they stood when the cache was cut) and scrapes
the newest season live from afltables.com. AFL Tables renumbers same-name profiles when a new
same-name player enters its database, so an existing player's live url can gain a new numeric
suffix. The live rows then carry the NEW url; fitzRoy joins its ID from a table keyed on the
cached url, finds nothing, and emits a blank `ID`. The snapshot therefore says, for the same
footballer, "url A, ID 12277, through 2024" and "url B, no ID, 2025".

`tools/migration/import_fitzroy_core.py` (pre-fix): `scan_player_stats()` keyed `PlayerFact`
on the url alone and tolerated a blank ID (correctly — the ID never reaches a column), so url B
became a new fact; `import_players()` inserted a `players` row per fact and registered one
`external_identities` row per fact. Nothing asked whether a blank-ID url continued an
ID-bearing url's career, although the source states it directly: AFL Tables' per-row
`Career.Games` runs 229 on url A's last row and 230 on url B's first.

**Measured generality** (whole 1897–2025 snapshot, 13,275 urls): blank-ID urls whose first row
is career game > 1: exactly the four above; blank-ID url at career game 1: Billy Wilson only.
ID-bearing urls starting above career game 1 (or at 0, a 1911-era source quirk): 41 — those
are settled by their ID and must never be examined by this rule.

## 3. Resolution rule (chosen), and the alternatives rejected

**Chosen — tracked, fail-closed continuity rules bound to source evidence.** A new
`profile_url_continuity` block in `tools/rebuild/fitzroy/fitzroy-contract.json` names, per
player, `continuing_url` (the ID-bearing profile), `renumbered_url`, the artefact (`file`)
that carries the renumbered rows, and an `expect` block the snapshot must reproduce exactly:
`continuing_id`, `continuing_last_season`, `continuing_last_career_game`,
`renumbered_first_season`, `renumbered_last_season`, `renumbered_first_career_game`
(= continuing + 1, enforced at load), `renumbered_rows`. Each rule carries `authority` and
`reason`. Four rules ship; none for Billy Wilson (`not_a_rule` records why).

The importer (`apply_profile_continuity`) folds the renumbered profile into the continuing
player only when every bound fact holds, and refuses when: either profile is absent from the
snapshot; the renumbered profile carries any ID; the continuing profile's ID differs; the
structured name fields (`First.name`/`Surname`) disagree; both carry DOBs and they disagree;
seasons overlap or are out of order; the row count or seasons drift; a boundary `Career.Games`
is unrecorded; or the numbering does not continue by exactly one. The name check is a
consistency guard that must hold — never evidence.

**Fail-closed default (`refuse_unresolved_renumbering`).** After the rules, any remaining
blank-ID profile whose first row is not career game 1 is refused before a player is seeded: the
source asserts earlier appearances the profile does not cover, and no rule accounts for them.
A blank-ID profile debuting at career game 1 is accepted as a new player. ID-bearing profiles
are never examined. Rule scope follows `source_row_corrections`: in scope only when the named
artefact is in the snapshot (a 2024-only fixture folds nothing); in scope with the continuing
profile absent (a 2025-only partial) refuses.

**Never in-season.** `main()` passes `continuity=None` under `--require-in-season`, so neither
the fold nor the refusal runs against a single live-scraped season. The settle
(`settle-afltables.ts` `loadRefs`) resolves every url through registered identities and leaves
an unregistered url unresolved — never a new player — so registering the renumbered urls at
rebuild time is what fixes 2026 as well.

**Both urls, one player.** `import_players()` registers every path in `fact.urls` against the
one `players.id`; the renumbered path's `notes` names the rule and the continuing path. DOB
evidence stays keyed on the continuing path. A database that already registers the two paths
to **different** players (the split, i.e. every currently rebuilt database and production)
HALTs with `external-identity split` before the reconciliation DELETE and before any identity
upsert — no merge, no choice, rolled back.

Rejected:

- *Automatic continuity inference* (same base name + same DOB + non-overlapping seasons +
  career-game continuity, no tracked rule). Deterministic, but it is inference over names and
  the repository's identity contract is explicit that a name is never identity and that
  re-linking is a curator decision, not a parser rule (`player_identity.py`, ISSUE-093). The
  same evidence is instead bound per rule and re-proved on every run, and the detector uses it
  only in the refusing direction.
- *A one-off merge/rekey of the duplicates on the live databases.* Repairs symptoms in one
  database and leaves every rebuild reproducing the split; also outside the stage goal. The
  production consequence is recorded in §10 as a supervised next action, not done here.
- *Requiring the ID.* Discards the 83 real rows (rejected already by ISSUE-093/099).
- *Bumping `contract_version` and re-accepting.* Bytes, hashes and every identity-scan figure
  are unchanged; only an importer transformation was added, exactly the class the register's
  `accepted_corrections.import_transformation` already records. Recorded as a dated amendment
  instead (§6); ratifying it, or choosing a re-acceptance under a bumped version, is the
  operator's decision.

## 4. Files changed (all on `claude/issue-136`, uncommitted)

- `tools/rebuild/fitzroy/fitzroy-contract.json` — new `profile_url_continuity` block: four rules,
  `not_a_rule` (Billy Wilson), scope and fail-closed statements. `contract_version` unchanged (1).
- `tools/migration/import_fitzroy_core.py` — `load_profile_continuity_rules()` (shape
  validation, chains refused), `PlayerFact.rows/first_appearance/last_appearance/
  continuity_rule_ids`, `Career.Games` tracked per row, `apply_profile_continuity()`,
  `refuse_unresolved_renumbering()`, `scan_player_stats(..., continuity=)` returning the
  applied list, `summarise()` `players_with_renumbered_profile`, `enforce_accepted_fingerprint`
  pins it, `import_players()` multi-path registration + split HALT, `main()` wiring and plan
  report, docstring.
- `data/reference/fitzroy-accepted-baselines.json` — accepted entry `full-history-20260902`
  amended (§6). Retired entry untouched.
- `tools/db/rebuild-test.ts` — final validation: `players` counted as DISTINCT players behind the
  AFL Tables identities; new `players_with_renumbered_profile` gate.
- `tests/fitzroy-core-import.test.ts` — one existing test narrowed (blank-ID acceptance is now
  the debut case), new `renumbered profile URL continuity (AFLDB-ISSUE-136)` block (16 cases).
- `tests/python/fitzroy_profile_continuity_contract.py` — NEW: the driver-free write contract of
  `import_players()` (one row, both identities, split HALT) plus fold/refusal unit checks.
- `tests/db-test-rebuild.test.ts`, `tests/season-rollover.test.ts`,
  `tests/python/settle_emit_contract.py` — pins updated for the amended register, the fifth
  contract read site and the fourth `scan_player_stats` return.
- `CHANGELOG.md`, `issues.md`, `IssuesIndex.md`, this runbook.

## 5. Refusal / ambiguity behaviour (summary)

| Situation | Behaviour |
|---|---|
| Blank-ID profile, first row career game 1, no rule | Accepted as a NEW player (Billy Wilson) |
| Blank-ID profile, first row career game > 1 or unrecorded, no rule | **Refused** before any player is seeded; message names the profile, the career game and the missing rule |
| Rule in scope, every bound fact reproduced | Renumbered profile folded; both urls registered to one player; reported in the plan |
| Rule in scope, any bound fact differs (ID present, ID mismatch, seasons, rows, DOB, name fields, career-game gap/unrecorded) | **Refused**, naming the fact |
| Rule in scope, continuing profile absent (partial snapshot) | **Refused** |
| Rule's artefact absent from the snapshot | Rule out of scope (nothing to fold); the blank-ID refusal still runs |
| Malformed rule (same path both sides, raw url, chain, gap ≠ 1, wrong file/season, missing fact) | **Refused** at load, before any row is read |
| `--require-in-season` | Neither fold nor refusal runs; settle semantics unchanged |
| Database already holds the split (two paths → two players) | `import_players()` **HALTs** (`external-identity split`) before DELETE/upsert, rolled back |
| Accepted register not amended | `--require-accepted-baseline` refuses on fingerprint drift (`players` 13275 vs 13271) — observed before the amendment |

## 6. Acceptance-record amendment (operator decision point)

`data/reference/fitzroy-accepted-baselines.json`, entry `full-history-20260902`: new
`amendments[0]` (2026-09-04, `AFLDB-ISSUE-136`, `import_transformation_added`);
`measured.players` 13275 → **13271**; new `measured.players_with_renumbered_profile: 4`;
`identity_scan` values unchanged (comment amended: 5 blank-ID paths = 4 renumbered + 1 debut);
new `accepted_corrections.identity_continuity[0]` bound to the four rule ids (79 rows, 4
players, Billy Wilson explicitly not folded). The retired `full-history-20260827` entry is
untouched (its `players: 13275` is now the historical pre-fix figure; `tests/db-test-rebuild`
pins the difference explicitly).

The operator must either **ratify** this amendment or direct a re-acceptance under a bumped
`contract_version`. Nothing else in the fix depends on which.

**Operator decision — 2026-09-04: RATIFIED.** The accepted-baseline amendment stands as
written. The canonical player population changes from 13,275 to 13,271 because the four AFL
Tables profile renumberings are proven continuing careers, not new players. The external
identity population remains 13,275 (`distinct_urls`, one `external_identities` row per
profile url). **No `contract_version` bump is required** (`contract_version` stays 1). The
register file is final for this issue; the retired `full-history-20260827` entry keeps its
historical `players: 13275`.

## 7. Tests (all run 2026-09-04 on the workstation, Python 3.12, vitest via a junctioned
`node_modules`)

- `tests/python/fitzroy_profile_continuity_contract.py` — **33/33**.
- `tests/python/fitzroy_corrections_contract.py` — 23/23; `settle_emit_contract.py` — 48/48;
  `ladder_identity_contract.py` — 42/42.
- vitest `tests/fitzroy-core-import.test.ts` — 108 passed / 5 skipped (the 5 are pre-existing
  DB-gated skips); ISSUE-136 block 16/16.
- vitest final run over `fitzroy-core-import`, `db-test-rebuild`, `season-rollover`,
  `reference-data`, `fitzroy-acquisition`, `current-season-import` — **6 files, 786 passed /
  5 skipped / 0 failed**.
- `tsc --noEmit` — clean.
- `tests/finals-semantics-contract.test.ts` — 1 pre-existing Windows CRLF artefact
  (ISSUE-129, dispositioned by the operator in ISSUE-132; passes on Linux). Not this issue.

## 8. Validation evidence (offline, no database)

```
python tools/migration/import_fitzroy_core.py --label full-history-20260902 \
  --snapshot-dir D:/dev/afldb-issue-102/data/sources/afltables/fitzroy_core/full-history-20260902 \
  --validate-only --require-accepted-baseline
```

Before the register amendment (fix applied): refused —
`players: accepted 13275, measured 13271` (fail-closed drift, as designed).

After the amendment:

```
  players                      13271
  players_with_dob             855
  players_with_dob_conflict    0
  players_with_renumbered_profile 4
profile URL continuity applied (AFLDB-ISSUE-136)
  2025-charlie-cameron-renumbered-profile  players/C/Charlie_Cameron3.html -> players/C/Charlie_Cameron.html (25 rows, 2025-2025, career games 229 -> 230)
  2025-jack-graham-renumbered-profile      players/J/Jack_Graham2.html -> players/J/Jack_Graham.html (18 rows, 2025-2025, career games 131 -> 132)
  2025-jack-ross-renumbered-profile        players/J/Jack_Ross3.html -> players/J/Jack_Ross.html (23 rows, 2025-2025, career games 70 -> 71)
  2025-jack-williams-renumbered-profile    players/J/Jack_Williams3.html -> players/J/Jack_Williams.html (13 rows, 2025-2025, career games 29 -> 30)
full-history gates PASSED — identity coverage: rows 685473, missing_id 83, missing_url 0, distinct_ids 13270, distinct_urls 13275
accepted canonical baseline VERIFIED   (19.4 s, no database access)
```

The snapshot bytes were read from `D:\dev\afldb-issue-102\data\sources` (the staged accepted
artefacts; this worktree has no `data/sources`). SHA-256 of all 131 artefacts re-verified.

## 9. What was NOT validated — stop point (superseded 2026-09-04 by §13)

*(Historical. Every item below was validated against PostgreSQL in §13.)* **The canonical database rebuild had not been run.** `npm run db:test:rebuild` targets
`AFLDB_TEST_DATABASE_URL` = the shared `afldb_test` that `AFLDB-ISSUE-113`'s in-flight
validation state lives in, the credential model cannot create a scratch database
(`rebuild-test.ts` header), and this worktree carries no `.env`. Rebuilding would destroy
ISSUE-113's loaded `brownlow_season_votes` state, so it is deliberately left to the operator.
**2026-09-04 (operator instruction):** the shared `afldb_test` must NOT be overwritten while
ISSUE-113's V1–V8 state is in flight, and `D:\dev\afldb-issue-113` must not be touched. The
repository-supported routes to an *isolated* target were inspected in §12: there is none that
can be provisioned without operator action, so the rebuild is **blocked**, not merely deferred.
Until it runs, the following are proven only by the driver-free contract test (§7) and not by
PostgreSQL: the two-identity registration, the DOB-evidence keying, the split HALT, and the
new final-validation SQL (`players` DISTINCT = 13,271; folded = 4).

## 10. Exact next actions

1. ~~**Operator decision:** ratify the §6 register amendment (or direct a re-acceptance).~~
   **DONE 2026-09-04 — ratified, no contract-version bump** (§6).
2. ~~**Canonical rebuild on an `afldb_test` that ISSUE-113 is not using**~~ **DONE 2026-09-04 —
   option S, shared `afldb_test` released by the operator; GREEN (§13.3).** Originally: either the shared
   one *after* ISSUE-113 releases it, or an isolated one provisioned per §12 option A/B by
   the operator. **Not before.** (Its worktree and database state must not be disturbed
   mid-validation.) From this worktree with the
   snapshots staged (`afltables/fitzroy_core/full-history-20260902`, `ladder-20260828`,
   `draftguru/annual-html-20260902` copied under `data/sources/`), `.env` present, tunnel up:
   ```
   npm run db:test:rebuild -- --allow-owner-import-dsn --draftguru-label annual-html-20260902
   ```
   Expect PRECHECK `accepted canonical baseline VERIFIED` with the four rules applied, and the
   final validation green on `players = 13271` and `players_with_renumbered_profile = 4`.
3. ~~**Prove the fold in PostgreSQL**~~ **DONE 2026-09-04 — exactly four rows, `modern_four = 4` (§13.4).** Originally (read-only):
   ```sql
   SELECT ei.player_id, array_agg(ei.external_id ORDER BY ei.external_id)
     FROM external_identities ei JOIN sources s ON s.id = ei.source_id
    WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
    GROUP BY ei.player_id HAVING count(*) > 1 ORDER BY 1;
   ```
   Expect exactly four rows, each pairing a continuing path with its renumbered path; and
   `SELECT count(*) FROM players p WHERE p.display_name IN ('Charlie Cameron','Jack Graham','Jack Ross','Jack Williams') AND p.debut_season >= 2014` = 4.
4. ~~**ISSUE-113 V5 rerun**~~ **DONE 2026-09-04 — gap 0 rows / 0 votes, derived total 79,113 (§13.5).** Originally, on that rebuilt database: Brownlow round rows (2019–2024 Cameron,
   2019–2022 Graham) and the season rows now resolve to the same `player_id` (the season
   writer resolves `Charlie_Cameron3.html` → the career player); the derived
   `player_season_stats` Brownlow total must equal the authoritative 79,113 — the 34-vote gap
   disappears. Any residual gap is a different cause and stays with ISSUE-113.
5. **Production** still holds the split — **tracked as `AFLDB-ISSUE-137` (allocated 2026-09-04, not
   started); nothing was done to production in this issue.** Original statement: (two `players` rows each for the four, identities
   registered to different players). Running this importer against it HALTs by design. The
   repair is either the normal canonical rebuild-and-promote path (`AFLDB-ISSUE-125` governs
   preserving production-only state) or a supervised identity reconciliation that re-points the
   renumbered identity, `player_match_stats`, awards and any settle-written rows to the career
   player and retires the duplicate — a separate, reviewed step; **no production mutation is
   authorised by this issue.** Until then, every 2026 settle keeps writing these four players'
   rows to the duplicates.
6. ~~Then resolve~~ **DONE 2026-09-04** — evidence recorded in §13, runbook moved to
   `issues/closed/`, `issues.md` / `IssuesIndex.md` / `CHANGELOG.md` synchronised, committed on
   `claude/issue-136`.

## 11. Stage record

- 2026-09-04 — Investigation, root cause, rule design, implementation, regression tests and
  offline validation complete on `claude/issue-136`. Stopped before the database rebuild (§9).
  No commit (the issue's own validation is not fully green until §10 step 2–4 pass). No deploy,
  no production access, `D:\dev\afldb-issue-113` untouched.
- 2026-09-04 (second session) — Operator **ratified** the §6 register amendment (13,275 →
  13,271 canonical players, 13,275 external identities, no contract-version bump). Removed the
  cross-worktree `node_modules` junction to `D:\dev\afldb-issue-132` (`rmdir` on the mount
  point; ISSUE-132's own `node_modules` verified intact, 331 entries). This worktree now has
  **no `node_modules`**; any further vitest/tsc run here needs its own `npm ci` first (not run —
  nothing in this session changed code). Inspected the repository-supported ways to obtain an
  isolated PostgreSQL validation target (§12): **none is available without operator
  provisioning**, so the rebuild stays blocked. No commit — the acceptance boundary above still
  requires §10 steps 2–4 green first. No deploy, no PROD contact, no `afldb_test` contact,
  `D:\dev\afldb-issue-113` untouched.

- 2026-09-04 (third session) — **Operator decision: option S.** ISSUE-113's `afldb_test` physical
  state discarded (its V1–V8 evidence and V5 failure are persisted in its own runbook); the shared
  repository-standard `afldb_test` released for this issue; no second cluster provisioned. This
  worktree got its own `npm ci` (no junction); the three accepted snapshot dirs were copied under
  the ignored `data/sources/`; `.env` created with the 55432 tunnel DSN. Canonical
  `db:test:rebuild` run, **GREEN**; §10 steps 2–4 proven in PostgreSQL; split HALT exercised
  against the real database and rolled back; ISSUE-113 V5 witness re-measured at 79,113 with a
  zero identity gap. Evidence in §13. Resolved and committed on `claude/issue-136`. No merge, no
  deploy, no PROD contact, no `afldb_dev` contact, `D:\devfldb-issue-113` untouched.
  Production follow-up allocated as `AFLDB-ISSUE-137`.

## 12. Isolated validation target — inspection result and blocker (2026-09-04)

Question: is there a repository-supported way to run `npm run db:test:rebuild` for this issue
against a PostgreSQL database that is **not** the shared `afldb_test` holding ISSUE-113's
V1–V8 state, without inventing credentials and without using PROD?

Repository facts (read from current code; nothing was measured against a live host this
session):

1. **The runner accepts exactly one database name.** `tools/db/rebuild-test.ts`
   `assertRebuildTargetName()` refuses any name that is not literally `afldb_test`
   (`SUPPORTED_TARGET`), on top of refusing `afldb_dev`/`afldb_prod`, anything matching
   `/prod/i`, anything not ending in `_test`, and anything matching `/pre_rebuild/i`. There is
   no `--target` override. So `afldb_restore_test`, `afldb_issue136_test` or any other renamed
   scratch database is refused by name — isolation can only come from a **different server or
   cluster** whose database is still called `afldb_test`.
2. **No credential in the model can create a database.** `afldb_test` is created once at host
   bootstrap by `sudo -u postgres createdb -O afldb_owner`
   (`tools/maintenance/00_install_postgres.sh:88`), which also creates the
   `afldb_owner/app/import/backup/auth` roles with generated passwords and installs `pg_trgm` +
   `unaccent`. `sudo` is password-gated on both `streamanator` and `afldb-prod`, so every
   provisioning route is operator work.
3. **The install script is not cluster-parameterised.** It calls `sudo -u postgres psql` and
   writes `localhost:5432` into the `.env` it emits, so a second cluster on `streamanator`
   (e.g. `pg_createcluster 16 afldb136 -p 5433`) would need the script run with
   `PGPORT`/`PGCLUSTER` set, or its role/database/extension SQL applied by hand. Not documented.
4. **No containerised PostgreSQL exists in the repository** (no `docker-compose*`,
   `Dockerfile`, or `initdb`/`pg_ctl` scaffolding under `tools/`, `tests/` or `docs/`), and
   the workstation has no `docker`/`podman` on PATH.
5. **The workstation cannot host a scratch cluster as installed.**
   `C:\Program Files\PostgreSQL\16\bin` does ship `initdb.exe`/`pg_ctl.exe`/`postgres.exe`
   (so a local cluster on a private port is mechanically possible), but `share\extension\`
   has **no `pg_trgm.control` or `unaccent.control`** — the contrib extensions the bootstrap
   creates are absent, so the migration set could not be applied. Installing contrib and
   choosing role passwords is operator provisioning, not something this issue may invent.
6. **PROD is excluded** by instruction, and independently unsuitable: it holds no `afldb_test`
   and no full-history fitzRoy/DraftGuru snapshots (only `settle-*` dirs).
7. **`afldb_restore_test`** (dev host, `tools/maintenance/restore-test.sh`) exists only for
   backup-restore verification and is refused by the rebuild runner by name (fact 1).

Conclusion: **no safe isolated target exists today.** The only repository-standard rebuild
target is the shared `afldb_test` on `streamanator:5432`, and it is reserved by ISSUE-113.

Exact validation plan, in operator-preference order:

- **Option S (sequence, no provisioning) — recommended:** wait for ISSUE-113 to reach a
  checkpoint that releases `afldb_test`, then run §10 step 2 exactly as written from this
  worktree: stage the three snapshot dirs under `data/sources/`, a `.env` whose
  `AFLDB_TEST_DATABASE_URL` is the 55432 tunnel DSN, `npm ci` here, `AFLDB_PYTHON` + PG16
  `bin` on PATH, `--allow-owner-import-dsn --draftguru-label annual-html-20260902`, ~21 min.
  ISSUE-113's V5 rerun (§10 step 4) then runs on the same rebuilt database, which is the
  sequencing both issues need anyway.
- **Option A (second cluster on the dev host, operator sudo):** `pg_createcluster 16 <name>
  -p 5433` (or equivalent), then apply `00_install_postgres.sh`'s role/database/extension SQL
  to that cluster (roles are cluster-global, so the existing `afldb_*` roles do not carry
  over), and give this worktree a `.env` whose `AFLDB_TEST_DATABASE_URL` reaches that port
  through its own tunnel (e.g. `127.0.0.1:55433`). Database name must remain `afldb_test`.
  Passwords come from the operator's provisioning, never from this issue.
- **Option B (workstation scratch cluster):** operator installs PostgreSQL 16 contrib
  (`pg_trgm`, `unaccent`) into the local install, `initdb` a data directory outside the
  repository, `pg_ctl start` on a private port, create the roles + `afldb_test`, and hand the
  DSN to this worktree's `.env`. Same name constraint; same "no invented credentials" rule.

Whatever the option, the acceptance boundary is unchanged: **no commit until §10 steps 2–4
are green on a real PostgreSQL rebuild.** Nothing in this issue is deployed or touches PROD.

## 13. Database validation — shared `afldb_test`, 2026-09-04 (option S) — ALL GREEN

Operator decision (2026-09-04, third session): option S from §12. ISSUE-113's `afldb_test` state
was discardable (its V1–V8 evidence and V5 failure are persisted in its own runbook), so the
shared repository-standard `afldb_test` (`streamanator:5432`, reached through the existing DEV SSH
tunnel on `127.0.0.1:55432`) was released for this validation. No second cluster was provisioned.
`D:\dev\afldb-issue-113` untouched; `afldb_dev` and PROD not contacted.

### 13.1 Environment

- This worktree's own `npm ci` (419 packages; no `node_modules` junction to any other worktree).
- Snapshots copied from the staged accepted artefacts in `D:\dev\afldb-issue-102\data\sources`
  into this worktree's ignored `data/sources/`: `afltables/fitzroy_core/full-history-20260902`
  (257 MB), `afltables/fitzroy_core/ladder-20260828`, `draftguru/annual-html-20260902` (350 files;
  every importer re-verified SHA-256 during the rebuild).
- `.env` (ignored) with `AFLDB_TEST_DATABASE_URL` = the 55432 tunnel DSN as `afldb_owner`;
  `AFLDB_PYTHON` = the Python 3.12 interpreter with psycopg; PostgreSQL 16 `bin` on PATH.
- Connection proved read-only first: `current_database() = afldb_test`, PostgreSQL 16.15 (Ubuntu).

### 13.2 State before the reset (ISSUE-113's, measured read-only, then discarded)

| Measure | Value |
|---|---|
| `players` | 13,277 (13,275 AFL Tables + 2 DraftGuru-only, see §13.4) |
| AFL Tables identities (`afltables_profile_url`) | 13,275 — five Charlie Cameron rows, four Jack Graham, five Jack Ross, five Jack Williams (the split) |
| `brownlow_season_votes` | 16,120 rows, 79,113 votes, source `afltables` (ISSUE-113's load) |
| `brownlow_round_votes` | 320,861 |
| `player_season_stats` Brownlow sum | **79,079** |
| **V5 identity gap** | **10 player-seasons, 34 votes** — Cameron 2019–2024 (11, 1, 1, 3, 8, 1) and Graham 2019–2022 (1, 3, 3, 2) round votes on players 2604 / 6293, season rows on the duplicates 2608 / 6296 |

Because the canonical rebuild has no `brownlow_season_votes` stage (its only committed writer is
the legacy SQLite path; the 16,120 rows were ISSUE-113's uncommitted load), the rows were exported
first, **keyed by AFL Tables profile url** (the identity ISSUE-113's season writer resolves):
16,120 rows, 0 without a url, 10 on the two duplicate urls. Used only for the §13.5 witness.

### 13.3 Canonical rebuild

```
npm run db:test:rebuild -- --acknowledge-destroy afldb_test --allow-owner-import-dsn --draftguru-label annual-html-20260902
```

23:16:20Z → 23:37:49Z (21 min 29 s). Stages in order: PRECHECK, DATABASE RESET, MIGRATIONS,
PRIVILEGES, REFERENCE DATA, FITZROY CORE, DRAFTGURU, AWARDS & HONOURS, DERIVED, COLEMAN, LADDER
WITNESS, FINAL VALIDATION — `Rebuild complete.`

PRECHECK and FITZROY CORE both printed `players 13271`, `players_with_renumbered_profile 4`,
the four `profile URL continuity applied (AFLDB-ISSUE-136)` lines exactly as in §8 (25/18/23/13
rows; career games 229→230, 131→132, 70→71, 29→30), `full-history gates PASSED` (rows 685473,
missing_id 83, distinct_ids 13270, distinct_urls 13275) and `accepted canonical baseline
VERIFIED`. FINAL VALIDATION: **`AFLDB-FINAL-VALIDATION PASSED: 39 checks`**, including
`players = 13271 (expected 13271)`, `players_with_renumbered_profile = 4 (expected 4)`,
`player_match_rows = 685471`, `brownlow_round_vote_rows = 320861`, `matches = 16838`,
`draft_persons = 5057`, `draft_picks = 6810`, `club_seasons_rows = 1622`, `coleman_rows = 46`.

### 13.4 Fold proven in PostgreSQL (read-only)

- §10.3 SQL (players with more than one AFL Tables identity): **exactly four rows** —
  2607 Charlie Cameron `{Charlie_Cameron3.html, Charlie_Cameron.html}`, 6295 Jack Graham
  `{Jack_Graham2.html, Jack_Graham.html}`, 6522 Jack Ross `{Jack_Ross3.html, Jack_Ross.html}`,
  6622 Jack Williams `{Jack_Williams3.html, Jack_Williams.html}`. `modern_four = 4`.
- Counts: AFL Tables identities **13,275**; DISTINCT players behind them **13,271**;
  `count(*) FROM players` = 13,273. The two extra rows are DraftGuru explicit-admin-decision
  players with no AFL Tables identity, no match rows and one draft pick each (ids 13275 Fred
  Rodriguez, 13276 Riley Onley) — pre-existing (the pre-reset count was likewise 13,275 + 2),
  written by the DRAFTGURU stage, not by this issue.
- The four career players: 2607 (2014–2025, DOB 1994-07-05, 254 match rows, 12 season rows),
  6295 (2017–2025, 1998-02-25, 149 / 9), 6522 (2019–2025, 2000-09-03, 93 / 7), 6622 (2022–2025,
  2003-12-01, 42 / 4). Their 2025 match rows — 25, 18, 23, 13 — sit on those ids. The renumbered
  paths' `notes` read `AFLDB-ISSUE-136 profile_url_continuity <rule>: AFL Tables renumbered this
  player's profile; same player as <continuing path>`.
- **Billy Wilson** 1790 is a separate 2025 player (`Billy_Wilson2.html`, DOB 2005-06-16, first
  match 2025-06-26, 4 games); the 1913–1914 and 1932–1935 Billy Wilsons are untouched.
- Awards now on the career player: Cameron All-Australian 2019 and 2023, AA squad 2021 and 2022,
  Rising Star nomination 2015; Graham Larke Medal 2016.

### 13.5 ISSUE-113 V5 witness — GREEN (79,113, zero identity gap)

Method (witness only — this is not ISSUE-113's loader and nothing here is committed): the §13.2
export was staged in a temp table and inserted into `brownlow_season_votes` resolving each url
through the **rebuilt** `external_identities`, preserving `votes`, ranks, eligibility, winner,
game counts, `link_status_value`, `source_id` (afltables) and `source_record_id`;
`import_batch_id` NULL (the old batch no longer exists). Then `tools/migration/rebuild_derived.py`
was re-run with `AFLDB_IMPORT_DATABASE_URL` set explicitly to the test DSN (43.1 s).

| Check | Result |
|---|---|
| Staged / resolved / unresolved / club-id drift | 16,120 / 16,120 / **0** / 0 |
| The 10 duplicate-url rows | all resolve to the career players (2608→**2607**, 6296→**6295**) |
| Loaded | 16,120 rows, 79,113 votes, 112 winners, 1924–2025 |
| **V5: player-seasons with positive round votes lacking a season row under the same player** | **0 rows, 0 votes** (was 10 / 34) |
| **Derived `player_season_stats` Brownlow total** | **79,113** = `brownlow_season_votes` 79,113 (was 79,079) |
| Cameron 2019–2024, Graham 2019–2022 | round-vote sum and season row on the **same** `player_id` in every season, values equal |
| `player_career_stats.brownlow_votes` | Cameron 25, Graham 9, Ross 0, Williams 0 |

### 13.6 Fail-closed split HALT exercised against the real database

The production-shaped split was reproduced on `afldb_test` by re-pointing the
`Charlie_Cameron3.html` identity at the 1897 Charlie Cameron (2608), then
`import_fitzroy_core.py --label full-history-20260902 --groups players` was run against the test
DSN. It exited **1** with
`RuntimeError: external-identity split: profile paths ['players/C/Charlie_Cameron.html',
'players/C/Charlie_Cameron3.html'] of one player (profile_url_continuity
['2025-charlie-cameron-renumbered-profile']) are registered to different players [2607, 2608] in
this database — refusing to merge or choose; …`. The identity was restored to 2607. Fingerprints
before and after: `players` 13,273 md5 `e0baf011…` identical; `external_identities` 18,332 md5
`7bda6090…` identical; `player_match_stats` 685,471; `brownlow_season_votes` 16,120 / 79,113;
`player_season_stats` 79,113 — unchanged. The only residue is `import_batches` row 17
(`import_fitzroy_core.py`, `players`, `failed`, the message above), the batch audit the HALT
records after rolling back.

### 13.7 Tests re-run in this worktree (own `node_modules`)

- Python contracts: `fitzroy_profile_continuity_contract`, `fitzroy_corrections_contract`,
  `settle_emit_contract`, `ladder_identity_contract` — all pass.
- vitest `fitzroy-core-import`, `db-test-rebuild`, `season-rollover`, `reference-data`,
  `fitzroy-acquisition`, `current-season-import` — **6 files, 787 passed / 4 skipped / 0 failed**
  (one more test executes than in §7 because the real snapshot is now staged here).
- `tsc --noEmit` not re-run: no source changed after the §7 clean run.

### 13.8 `afldb_test` posture after this session

Canonical rebuild of `full-history-20260902` + `annual-html-20260902` with the ISSUE-136 fold,
plus the §13.5 witness `brownlow_season_votes` rows (source afltables, `import_batch_id` NULL)
and the §13.6 failed batch row. ISSUE-113's previous physical state is gone, per the operator's
decision; its next load should expect this baseline.
