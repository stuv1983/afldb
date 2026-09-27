# AFLDB-ISSUE-252 — Production promotion cannot reinstate production-owned state that references current-season rebuilt entities absent from `afldb_test`

## 0. Status

Open. Discovered 2026-09-27 by a fresh AFLDB-ISSUE-237 L5 PROD promotion attempt, stamp
`20260927-142540`. Severity High. Area: production promotion / current-season lifecycle / lineage
reinstatement. **Blocks AFLDB-ISSUE-237 L5 PROD.** Number verified free by read-only repository
search before allocation. **2026-09-27:** D-252-1..5 decided (§18.1); revised implementation plan
in §19; implementation held on three newly discovered design points D-252-6..8 (§20).
**2026-09-27 (later):** D-252-6..8 decided and D-252-2 amended (§18.2); §21 supersedes §19 where
they differ. The pure DB-free core (dependency manifest, ownership-parity judge, proof binding,
preparation guards) is implemented with DB-free tests, uncommitted; CLI wiring, docs and the
rehearsal are not. No database was contacted. Blockers in §21.8.
**2026-09-27 (third pass):** Q-252-9 decided (D-252-9a/9b, §22.1); both manifest layouts verified
and the preparation input contract made source-specific (§22.2); B1 read-only host inventory done —
retained source located, semantic/key acceptance pending the gate (§22.3); preparation CLI
`tools/db/prepare-promotion-source.ts` + `db:promotion:prepare-source` written with DB-free tests
(§22.4). Still not written: `promotion-check.ts` wiring, docs, rehearsal. No database contacted.
**2026-09-28 (eighth pass, §27):** the real DEV preparation's 36 AFL API `foreign_source_owner`
refusals, classified by D-252-12, and D-252-13's mandatory retained player bridge. Both are
implemented and DB-free validated (375/375), uncommitted. **2026-09-28 (later, eighth pass
acceptance):** the operator-run fresh-rebuild DEV rehearsal (§27.7) PASSED — the final fresh rebuild
preserved `CD_I297354` through the existing importer identity capture/reinstate mechanism, and the
D-252-13 bridge replay was idempotent (669/669 already linked). The real PROD manifest A and the
schema-3 source gate (§27.8) also PASSED, 16/16 gates. **2026-09-28 (operator acceptance):** the
operator explicitly accepted D-252-12 and D-252-13 on this evidence — the fresh DEV rebuild/
preparation rehearsal PASS, the D-252-12 36-row classified refusal census PASS, the D-252-13 669/669
bridge PASS, the real PROD manifest A PASS, and the schema-3 source gate PASS 16/16 (§27.10).
Implementation remains uncommitted; **ISSUE-252 itself is not yet resolved** and ISSUE-237 L5 PROD
has not been attempted again. Next action: §27.9.

## 1. Origin

The fresh ISSUE-237 L5 PROD attempt, run after AFLDB-ISSUE-251 was implemented and after
AFLDB-ISSUE-250's freeze mechanism was already proven in the earlier real PROD execution. This
attempt reached the `--phase restored` lineage gate and was correctly refused there.

## 2. Problem

The production promotion contract reinstates production-owned tables into a candidate built from
`afldb_test`. Some production-owned rows carry foreign keys into rebuilt football data. Promotion
does not carry the database-local integer ID directly: it resolves the old target row through a
stable identity and requires that same stable identity to exist in the candidate.

The fresh L5 attempt exposed a case where that invariant cannot currently be satisfied, because
`afldb_test` contains no current-season matches:

- PROD holds `brownlow_vote_entry_state.match_id = 17795`, whose durable match identity is
  `2026|1|2026-03-05|Sydney|Carlton`.
- The fresh candidate `afldb_prod_candidate_20260927-142540` had `candidate_match_key_count = 0`,
  `candidate_max_match_season = 2025`, `candidate_2026_matches = 0`.
- The `--phase restored` lineage gate correctly REFUSED:
  `brownlow_vote_entry_state.match_id = 17795: identity_absent_in_candidate`.
- No lineage-remap file and no AFL API supersede file was published. No reinstatement ran. No swap
  occurred.

## 3. Root cause

The production-promotion procedure currently assumes current-season football data can be
reacquired **after** promotion. That is only safe while no production-owned durable state depends
on current-season rebuilt entities before the swap.

`brownlow_vote_entry_state` is production-owned administrative authority and must be reinstated
before candidate acceptance. Its `match_id` references rebuilt `matches`, whose stable identity is
`matches.match_key`. Once PROD holds a Brownlow workflow row for a current-season match, the
referenced match must therefore already exist in the promotion candidate — post-swap current-season
reacquisition is too late.

This is a general lifecycle problem, not a special case for the Sydney v Carlton match.

## 4. Required invariant

Before `--phase restored` may PASS:

> Every rebuilt entity referenced by production-owned state must exist in the candidate under the
> stable identity declared by the promotion contract.

For `brownlow_vote_entry_state.match_id`, the candidate must contain the corresponding
`matches.match_key` before reinstatement. The same principle must be reviewed for every
production-owned foreign key into rebuilt/current-season data.

## 5. Safety boundary

- Do **not** resolve this by inserting individual missing rows directly into the promotion
  candidate.
- Do **not** delete, void, rewrite or otherwise weaken valid production-owned administrative state
  merely to make promotion pass.
- Do **not** permit fallback matching by date, round, club, display name or database-local integer
  ID.
- Do **not** weaken the existing lineage gate or mark the missing reference historical-only.
- The candidate promoted to PROD must remain derived from an evidenced, repeatable source
  lifecycle.

## 6. Investigation direction

- Determine which current-season entities can be referenced by production-owned state, and
  therefore must exist in the rebuild/promotion source before candidate restoration.
- Determine the supported mechanism for supplying that required current-season corpus to
  `afldb_test` before a production promotion. Reuse the canonical acquisition/import path rather
  than inventing a promotion-only row copier.
- Determine whether the complete 2026 match corpus is required, or whether a formally defined
  dependency closure can be populated safely and reproducibly. Prefer a design where promotion
  behaviour does not depend on whatever production-owned rows happen to exist on a particular day.
- Update the production-promotion contract so this prerequisite is proven before PROD is frozen for
  a future L5 attempt, rather than discovered after production has already been taken offline.

## 7. Evidence from L5 `20260927-142540`

- ISSUE-251's intended lifecycle PASSED in the same restored run: all 92 manual registrations
  planned `rebind B → A`; A4.2 reported 92 replayable creation records, 92 present, 0 bind, 0
  create, 0 candidate-only tokens.
- AFLDB-ISSUE-237 G2 passed.
- AFLDB-ISSUE-237 G3 passed, with the candidate's 802 importer identities classified as gained
  coverage.
- First-kick-goal lineage passed at 334/334.
- The only failed restored-phase gate was lineage identity for the missing 2026 Brownlow match
  dependency.
- The failed candidate is retained as `afldb_prod_candidate_20260927-142540` for evidence and must
  not be mutated into a passing candidate.
- PROD was token-bound unfrozen after the refusal and returned healthy: `afldb.service` active;
  `afldb-settle-afltables.timer` and service remained inactive.

## 8. Acceptance criteria

ISSUE-252 is complete only when:

1. the production promotion source lifecycle guarantees the required rebuilt dependencies before
   candidate restoration;
2. the missing-current-season condition is covered by automated fail-closed tests;
3. an isolated rehearsal demonstrates the dependency survives rebuild/promotion;
4. a completely fresh ISSUE-237 L5 PROD attempt passes the restored lineage gate without
   candidate-specific manual repair.

The failed `20260927-142540` attempt must not be resumed.

## 9. Next action (superseded by §10–§18 below)

*(2026-09-27, investigation complete — see §10 onward. This line is kept for history.)*
Investigate and design per §6, against current code (`docs/production-promotion.md`, the
`afl_api`/AFL Tables acquisition and import paths, `tools/db/promotion-check.ts`'s lineage gate).
No implementation yet.

---

## 10. Investigation (2026-09-27) — scope and method

Investigation and planning only, per operator instruction. **Nothing in §10–§18 was implemented,
run, or committed.** No database was mutated (`afldb_prod`, both retained candidates
`afldb_prod_candidate_20260926-213225` and `afldb_prod_candidate_20260927-142540` untouched). All
findings below are read-only inspection of the tracked repository at the current checkout.

## 11. Enumeration — every production-owned dependency on rebuilt data (Q1/Q2)

The contract's *only* authority for this is `tools/db/promotion-inventory.ts`: every table
declaration's `lineageRefs` (the columns the `--phase restored` gate resolves through a stable
identity) and `footballRefs` (the columns that meet an immediate FK on a plain restore). Grepping
every `entity: 'matches' | 'players' | 'coaches'` target across the file gives the complete,
current set — not a partial sample:

| # | Table.column | Referenced rebuilt entity | Stable identity | Mechanism | Current-season exposure |
|---|---|---|---|---|---|
| 1 | `brownlow_vote_entry_state.match_id` | `matches` | `match_key` | **STAGED** (`promotion-inventory.ts:956-1021`) — NOT NULL PRIMARY KEY, immediate FK, no deferred path exists | **Confirmed FAILING** — this is the `20260927-142540` refusal |
| 2 | `brownlow_vote_entry_state.{three,two,one}_player_id` | `players` | `afltables_profile_url` | Staged (nullable, rides the same staged row) | Not the observed failure this run (all three resolved); a brand-new current-season debutant with no AFL Tables profile page yet would hit the same class of failure |
| 3 | `data_edits.row_id` (`table_name = 'matches'`) | `matches` | `match_key` | Lineage-bound, **not** a real FK (`promotion-inventory.ts:405-424`; doc `docs/production-promotion.md:69`) | **Latent** — `historicalOnly` is declared for `data_edits` on **DEV only** (`docs/production-promotion.md:1302,1316-1320`); PROD has no such declaration, so a PROD `data_edits` audit row about editing a current-season match would refuse identically. None exists yet only by luck, not by contract |
| 4 | `data_overrides` rows for `matches`/`match_coaches` (A4.3) | `matches` | `match_key` | Reinstated + replayed (`docs/production-promotion.md:537-543`) | **Already documented and already deferred by operational convention**: *"the promotion waits until no such override is active"* — this is the same defect class, previously met and worked around rather than fixed |
| 5 | `afl_api_identity_adjudications.player_id` | `players` | `afltables_profile_url` | Staged (`promotion-inventory.ts:690-748`) | Player identity, not match identity; not exercised by this failure (ISSUE-251/237 both PASSed this run) |
| 6 | `player_link_resolutions.player_id` | `players` | `afltables_profile_url` | Reinstated, lineage-bound (`promotion-inventory.ts:589-596`) | Same class as #2, not observed failing |
| 7 | `external_grid_sources.ingest_source_id` | `sources` | `sources.key` | Staged (`AFLDB-ISSUE-151`) | Unrelated to current season (Grid Solver corpus) |
| 8 | `external_grids.import_batch_id` | `import_batches` | none (operator-chosen disposition) | §7.4b | Unrelated to current season |

**Conclusion for Q1/Q2.** The *general* defect is: **any production-owned table with a
lineage-bound or staged reference into `matches` (rows #1, #3, #4) fails identically once the
production-owned row names a match later than the rebuild's accepted baseline season.** It is not
unique to `brownlow_vote_entry_state`. Row #4 (`data_overrides`) already hit this and the
*existing, tracked* answer was an operational avoidance ("don't promote with an active override on
an unrebuilt season"), not a fix. Row #3 (`data_edits`) is exposed on PROD today with no contract
declaration to fall back on. `--phase source` already enumerates every table via
`assertContractCoherent()` (`promotion-inventory.ts`), so extending Q1's enumeration into an
automated gate (§16) is a natural fit, not a new taxonomy.

## 12. Why `afldb_test` stops at season 2025 (Q3)

`npm run db:test:rebuild` (`tools/db/rebuild-test.ts`) loads from **the accepted fitzRoy/AFL
Tables baseline** — a single tracked acquisition manifest selected from
`data/reference/fitzroy-accepted-baselines.json` (`ACCEPTED_BASELINES`, `rebuild-test.ts:246`) via
`selectAcceptedBaseline()` (`:577-684`). This is deliberate, not incidental:

- `rebuild-test.ts:1330-1334` (`brownlowSeasonChecks`) enforces, as a rebuild acceptance
  invariant: *"A pending season must never read as decided (§8.2 coverage semantics): the current
  season belongs to the settle pipeline and has no season total yet"* — `season >
  acceptedLastSeason` must be **zero** rows, or the rebuild itself refuses.
- `docs/production-promotion.md:1182-1189` (§9 "Current season") states the same boundary from the
  promotion side: *"The rebuild carries the seasons it was built from... Re-acquire with the
  standard supervised ladder in `docs/deployment.md` §7b."*
- The reason is provenance, not laziness: fitzRoy/AFL Tables data for a season is only
  authoritative once the season has **finished** (its pages stop changing). An in-progress season
  has a fundamentally different, live-updating source — the AFL API — acquired and settled by an
  entirely separate lifecycle (`tools/current-season/`). The rebuild's accepted-baseline invariant
  exists precisely so a rebuild can never silently present an in-progress season as decided
  historical fact.

So: `afldb_test` stopping at 2025 is **correct, intentional behaviour of the rebuild**, not a
defect to fix. The defect is that the *promotion contract* assumes (§9) this gap is always
harmless because the current season is "re-acquired after the swap" — true for ordinary football
data, but false for the production-owned rows in §11 that must resolve **before** the swap.

## 13. The canonical current-season population mechanism (Q4)

`tools/current-season/` is the existing, tracked AFL API acquisition/settle lifecycle — the same
one that populates `afldb_prod`/`afldb_dev` after every swap (§9) and the same one ISSUE-228/232/233
built out:

- `acquire-afl-api.ts` — fetches and writes a **tracked, labelled snapshot** under
  `data/sources/afl_api/...` (offline artefact, not a live call at settle time).
- `settle-afl-api-fixtures.ts` (ISSUE-228 S7 follow-up, ISSUE-229) — settles a
  `--fixtures-only` snapshot into the spine identity only; never touches `matches`.
- `settle-afl-api.ts` — the full match/roster/stats settle, run `--label <snapshot>
  (--validate-only|--dry-run|--apply)`; writes through `AFLDB_IMPORT_DATABASE_URL`
  (`settle-afl-api.ts:159-161`) — **not hard-coded to any one database**.
- `settle-afl-api-brownlow.ts` — the Brownlow-specific settle, same shape, same
  `AFLDB_IMPORT_DATABASE_URL` targeting; already carries an explicit, guarded
  **`afldb_test`-only** code path (`--allow-completed-season-backtest`,
  `settle-afl-api-brownlow.ts:19-35`, proved by `current_database()`, never a DSN string) — i.e.
  the codebase already treats `afldb_test` as a legitimate, deliberately-guarded settle target,
  just for a different purpose (completed-season backtesting) than the one this issue needs
  (in-progress-season population).
- `settle-afltables.ts` — the ordinary AFL Tables settle; its own comment
  (`settle-afltables.ts:333`) confirms it already runs "end to end against `afldb_test`... by the
  integration suite."

**Finding for Q4.** There is **no existing single command** that populates a rebuilt `afldb_test`
with the real, currently in-progress season before a promotion — that exact use has never been
run. But every piece it would need already exists and is already proven safe against `afldb_test`
specifically: `AFLDB_IMPORT_DATABASE_URL` can be pointed at `afldb_test`'s import DSN (exactly as
`AFLDB_TEST_IMPORT_DATABASE_URL` already is elsewhere, per the derivable-DSN pattern this
repository already uses), and the settle CLIs would run the identical, already-audited code path
used against `afldb_prod`/`afldb_dev`, from the **same tracked snapshot** already captured for the
live settle — no new fetch, no new provenance. This is a genuine gap in *procedure* (it has never
been assembled into one documented step), not a gap in *mechanism*.

ISSUE-224/228 do not define this step either: ISSUE-228 built the acquisition/settle pipeline
itself; ISSUE-224 is the manual-registration lifecycle (already the subject of ISSUE-242/245/251)
and is orthogonal — it never touches `matches`.

## 14. Solution models compared (Q5)

| | **A. Full current-season corpus in `afldb_test`** | **B. Referenced-only dependency closure** | **C. Reacquire into the candidate during promotion** | **D. Other** |
|---|---|---|---|---|
| Mechanism | Run the canonical settle pipeline (§13) against `afldb_test`'s import DSN as a required step after `db:test:rebuild`, before it is used as a promotion source | Compute the exact set of match_keys production-owned state references (read-only against the live target), acquire/settle only those matches into `afldb_test` | Add a promotion-transcript step, after §7.2's restore but before `--phase restored`, that reacquires/settles the current season directly into the candidate database | No better existing mechanism was found (§13) |
| Reproducibility | High — deterministic settle from a tracked, labelled snapshot; re-running gives the same rows | High for the closure computation, but the *set of matches required* changes every time a new production-owned row is created — a rehearsal proves last week's closure, not necessarily today's | Same settle mechanism, but now run under time pressure inside the promotion window | — |
| Provenance | Same AFL API source as production, unchanged | Same source, narrower selection | Same source, but acquired/settled onto a candidate database that is about to become production, raising the bar on what "restored" means | — |
| Candidate stays a faithful restore of an evidenced source | Yes — the *source* (`afldb_test`) is the evidenced artefact; the candidate is still a plain restore of it | Yes, with the same caveat as above | **No** — the candidate would gain rows that were never in `afldb_test`, breaking "the candidate is exactly the rebuilt/reinstated source" (§0, §11 of the existing doc) | — |
| Interaction with ISSUE-250 freeze/F0 | None — happens entirely on the source side, before `--freeze-plan` ever runs; does not touch PROD | None, same reason | Runs *inside* the frozen/candidate-preparation window, adding a live acquisition step (network, external API) to a sequence ISSUE-250 was built specifically to keep short and quiescent | — |
| Provable before PROD downtime | **Yes** — a read-only `--phase source`-style check can assert `afldb_test` already covers whatever the live target currently references, entirely pre-freeze (§16) | Yes, but only for *today's* references; a row created between the check and the freeze is invisible to it | **No** — the gap is only discovered (or fixed) after the candidate already exists, i.e. after PROD is already mid-promotion | — |
| FK/dependency closure depth | Full (whatever `settle-afl-api.ts` normally builds: matches, rosters, stats) | Partial by construction — only the referenced matches, deliberately minimal | Full, but assembled ad hoc during the promotion | — |
| Effect on G1/G2/G3 / lineage gates | None of the existing AFL API gates change; `matches` simply already contains the needed rows when `--phase restored` runs | Same | Would need new gates to validate the ad hoc reacquisition itself before trusting it | — |
| Operational complexity | One new, documented, scriptable step between rebuild and promotion; reuses existing tooling unmodified | Requires a new "what does the target currently reference" query plus a new narrow-import mode most current-season tooling doesn't have (it acquires *rounds*, not "the closure of these specific match_keys") | Adds a live, network-dependent stage to the most safety-critical, time-pressured part of the whole procedure | — |
| Failure modes | Settle fails or is stale → caught by a pre-freeze gate, before anything is scheduled | Closure query wrong or stale → same risk as A, but harder to audit because "correct" is a moving target | Settle fails *after* PROD is already frozen and offline → exactly the failure mode ISSUE-252 exists to eliminate | — |
| Creates a promotion-only data path | **No** — reuses the exact settle CLIs unmodified, just retargeted by DSN, the same way `AFLDB_TEST_IMPORT_DATABASE_URL` is already a retargeted DSN elsewhere | Would likely need a new, narrower import mode = a promotion-only path | **Yes** — a bespoke candidate-only acquisition step nothing else in the system exercises | — |

**Assessment.** Model C is rejected outright: it violates the "candidate is a faithful restore of
an evidenced source" invariant the whole procedure is built on (§0/§11 of the existing doc), adds a
live network dependency inside the ISSUE-250 freeze window, and cannot be proven before PROD
downtime — it fails the issue's own acceptance criterion 4/§8. Model B is attractive for
minimalism but directly conflicts with the issue's own stated preference ("avoid promotion
behaviour depending on whatever production-owned rows happen to exist on a particular day") — a
closure computed today can be invalidated by a single new Brownlow vote entry created tomorrow,
and there is no existing "acquire exactly these match_keys" tool, so it would require *new*
promotion-only machinery rather than reusing the canonical path. **Model A is the only one that is
simultaneously reproducible, provable before downtime, reuses existing mechanism unmodified, and
does not create a promotion-only data path.**

## 15. Classification of the defect (Q6)

**A combination, precisely:**

- **Not a rebuild lifecycle defect.** `db:test:rebuild`'s season boundary (§12) is intentional and
  correct; it must not change.
- **A promotion lifecycle defect.** §9's assumption ("current season is re-acquired after the
  swap") is incomplete: it does not account for the production-owned, pre-swap-reinstated rows
  enumerated in §11 that require current-season identity *before* the swap. This gap was already
  met once (A4.3, `data_overrides`, §11 row #4) and worked around by operational convention rather
  than fixed.
- **Which manifests as a missing source-data prerequisite.** The concrete, actionable fix is that
  `afldb_test`, as the promotion source, needs a documented and enforced prerequisite it does not
  currently have: current-season coverage sufficient for whatever the live target's staged/
  lineage-bound production-owned state references.

## 16. Proposed architecture (Q7) — for review, not implemented

1. **New mandatory promotion-source prerequisite.** After `db:test:rebuild`, before `afldb_test`
   is used as a promotion source, run the canonical AFL API current-season settle (§13) against
   `afldb_test`'s import DSN, from the same tracked snapshot(s) already captured for the live
   target's own settle. This is Model A (§14). It is a new **documented step**
   (`docs/production-promotion.md`, new §3a, before §4's backup) plus a **new automated gate**
   (below) that proves it happened, rather than trusting operator memory.
2. **New pre-freeze, read-only cross-database gate**, extending `--phase source`
   (`promotion-check.ts:2794` already runs `gateAflApiG1` at this phase against `afldb_test`
   alone). The new gate additionally accepts an optional, read-only `--old-database` (the live
   target) purely to enumerate every contract-declared `entity: 'matches'` reference currently
   held there (§11 rows #1/#3/#4, generated from `promotion-inventory.ts`'s own `lineageRefs`
   declarations — never a hand-maintained table list) and assert every one resolves against the
   source's own `matches.match_key`. This runs **before `--freeze-plan` ever touches PROD** — it
   answers the issue's own acceptance requirement (§8/Q8): *"a future L5 must not first discover
   this after PROD has been frozen."*
3. **No change to `--phase restored`'s lineage mechanism.** `resolveLineageRemap()`
   (`promotion-inventory.ts:2085-2133`) stays exactly as strict, evidence-only, no-fallback as it
   is today (safety boundary, §5/§18 of the original report). The fix is upstream: make sure the
   source already has what the gate needs, not weaken the gate.
4. **Retires the A4.3 operational workaround**, §11 row #4: once `afldb_test` reliably carries the
   current season before promotion, "the promotion waits until no such override is active"
   (`docs/production-promotion.md:541-543`) is no longer the only answer, and that section should
   be revisited (not necessarily removed — see D-252-4 below).
5. **Closes the `data_edits` latent gap**, §11 row #3, the same way, without inventing a
   PROD-side `historicalOnly` declaration that §7.4d's own text (`docs/production-promotion.md:877-881`)
   says was deliberately never implemented for PROD.

This is a general fix at the source-prerequisite level, not a `brownlow_vote_entry_state`-specific
or match-17795-specific patch, and it touches no lineage-matching logic.

## 17. Proposed acceptance gates and rehearsal requirements (Q8)

1. **Pre-freeze proof.** The new gate (§16.2) must be run and PASS, against the real live target,
   as a named, separate step **before** `--freeze-plan` — recorded in the promotion record as its
   own line item, the same way the source gate already is.
2. **Automated fail-closed tests.** DB-free/fake-tx coverage proving: (a) the new gate FAILS when
   the target holds a staged/lineage-bound `matches` reference absent from the source; (b) it
   PASSES once that match exists in the source; (c) it is generated from `promotion-inventory.ts`'s
   own contract (so a future table with an `entity: 'matches'` reference is picked up automatically,
   not missed the way this issue was).
3. **Isolated rehearsal.** On `afldb_test`/`code_test_db`: rebuild, run the current-season settle
   step against it from a real tracked snapshot, seed (on a disposable copy of the "live target")
   a `brownlow_vote_entry_state` row referencing that same match, and prove the new gate PASSes
   pre-freeze and `--phase restored` PASSes downstream, with no candidate-specific manual repair.
   Also prove the negative: a deliberately-uncovered match still REFUSES.
4. **A completely fresh ISSUE-237 L5 PROD attempt**, only after the above, must pass the restored
   lineage gate for `brownlow_vote_entry_state.match_id = 17795` (and any other 2026 Brownlow rows
   PROD holds by then) without touching the retained failed candidates.

## 18. Operator decisions required before implementation

*(2026-09-27: all five are now DECIDED, operator-approved — see §18.1 below. The option text is
kept for history.)*

No code will be written until these are decided. Each is a genuine architecture/policy choice, not
something safe to default silently:

- **D-252-1 — population scope.** Model A (full current-season corpus, recommended, §14) vs Model
  B (referenced-only closure) vs a hybrid (full population, closure-based gate). Model A is
  recommended for reproducibility and to avoid promotion behaviour depending on which
  production-owned rows happen to exist on a given day.
- **D-252-2 — snapshot provenance.** Whether the `afldb_test` settle (§16.1) must reuse the
  **same, already-captured tracked snapshot** used for the live target's own settle (recommended —
  no new external fetch, already-evidenced), or may run its own independent AFL API acquisition.
- **D-252-3 — gate enforcement.** Whether the new pre-freeze cross-database gate (§16.2) is
  wired into `db:promotion:check` as a mandatory, blocking check (recommended, given acceptance
  criterion 4/§8), or documented as an operator runbook step only. The former changes a
  safety-critical shared tool and needs its own review.
- **D-252-4 — retroactive scope.** Whether resolving ISSUE-252 also formally closes the §11 row #4
  (`data_overrides`/A4.3, already documented) and row #3 (`data_edits`, latent on PROD) gaps under
  this same issue, updating `docs/production-promotion.md`'s existing "the promotion waits..."
  language, or whether those stay separate follow-up issues once the general mechanism exists.
- **D-252-5 — where the new step lives.** Whether the `afldb_test` current-season settle becomes
  part of `db:test:rebuild` itself (auto-chained, affecting every rebuild including ordinary
  integration-test rebuilds), or a separate, explicitly-run, documented pre-promotion step only
  (recommended — most `afldb_test` uses, e.g. `code_test_db` rehearsals, have no need for
  current-season data and no reason to carry its extra acquisition time/complexity).

**Nothing above has been implemented, run, or committed.** No PROD, candidate, or `afldb_test`
write occurred during this investigation.

### 18.1 Decisions recorded (2026-09-27, operator-approved)

- **D-252-1 = FULL CURRENT-SEASON CORPUS (Model A).** Populate `afldb_test` with the complete
  current-season AFL API corpus the existing settle pipeline builds, not only the rows
  production-owned state happens to reference today. **No referenced-only closure mechanism is
  built.** Reasons: the defect is general, not Brownlow-specific; a referenced-only set moves every
  time a production-owned row is created; the existing settle pipeline already owns this corpus.
- **D-252-2 = RETAINED, HASH-BOUND SNAPSHOT INPUT.** Preparation consumes an already-retained AFL
  API snapshot named by label AND bound by the sha256 of its `manifest.json`. Promotion **never**
  performs a network acquisition. If the retained snapshot cannot satisfy the source gate: STOP,
  report the missing stable identities; the operator may separately acquire a newer snapshot,
  retain and hash-bind it first, then re-run preparation and the gate explicitly. Every promotion
  is reproducible from named retained source bytes.
- **D-252-3 = MANDATORY BLOCKING GATE.** The source-phase dependency gate is mandatory, runs
  **before** the production freeze / source acceptance, and any production-owned dependency whose
  stable match identity does not resolve in the prepared source is a hard STOP. No warning-only or
  documentation-only mode on the real path. `resolveLineageRemap()` stays exactly as it is:
  evidence-only, no fallback, no candidate-side reacquisition, no guessing by surrogate id.
- **D-252-4 = ISSUE-252 OWNS ALL THREE KNOWN DEPENDENCY CLASSES:** (1)
  `brownlow_vote_entry_state.match_id`; (2) ACTIVE `data_overrides` whose `entity_type` is
  `matches` / `match_coaches`; (3) `data_edits.row_id` where `table_name = 'matches'` — and
  **only** that `data_edits` kind (the one the contract declares with `entity: 'matches'`). The
  gate reports each family separately (rows inspected, identities derived, resolved, unresolved,
  ambiguous); one family passing never closes another. The `data_overrides` / `data_edits` gaps
  close under this issue only after their own acceptance cases pass.
- **D-252-5 = SEPARATE MANDATORY PRE-PROMOTION STEP.** `db:test:rebuild` is **not** changed: it
  stays completed/historical baseline only, in-progress season excluded. A distinct
  promotion-source preparation step runs after the rebuild and before the source gate/freeze.

**Implementation requirements recorded with the decisions:** reuse the existing current-season
settle pipeline unmodified (no promotion-only importer); add only orchestration/guarding needed to
target `afldb_test` safely; fail closed on wrong database, unbound/unverified snapshot, incomplete
source, settle failure/refusal, unresolved player/match identity, and any gate unresolved or
ambiguity; no production/candidate network acquisition; extend `--phase source` with a read-only
gate, one shared implementation for the three families; derive source targets by stable identity
and never compare database-local ids across databases; candidate = faithful restore of the
already-evidenced prepared source (Model C stays rejected); tests and rehearsal before any real
database operation. **STOP-and-report triggers:** weakening stable identity; changing the
historical rebuild boundary; automatic network access inside promotion; a new schema migration not
implied by the existing lineage model; any fallback from stable identity to numeric row ids.

### 18.2 Decisions recorded (2026-09-27, later, operator-approved) — D-252-6..8, D-252-2 amended

- **D-252-6 = TWO-PHASE HASH-BOUND DEPENDENCY MANIFEST, MANDATORY.** The checker never opens a
  cross-host PROD → `afldb_test` connection. A read-only target-side phase emits a deterministic
  manifest from PROD carrying F1/F2/F3 separately; per dependency: family, target row identity
  (audit only), stable `match_key`, the target match's owning source key, and the identity
  evidence `resolveLineageRemap()` needs. A target numeric match id is never a source lookup key.
  `dependency_set_sha256` is over canonical dependency content only (`captured_at` is metadata and
  never moves it); the file also has a transport sha256. **Workflow:** pre-freeze, PROD emits A
  (read-only) → transfer → the `afldb_test` source gate proves the prepared source against A.
  Freeze by the existing procedure → PROD emits B from the frozen database; **B is
  authoritative**. A and B `dependency_set_sha256` equal → the prior proof may stand if every other
  binding agrees; different → transfer B and rerun the source gate against B while PROD stays
  frozen. No dump/candidate/cutover progression until B passes. A dependency created between
  preflight and freeze is therefore caught.
- **D-252-7 = EXPLICIT TEMPORARY AFL API SWITCH ON `afldb_test`.** The preparation tool never
  writes `site_settings`. It refuses unless `DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL` both
  resolve to `afldb_test`, the two sessions agree on `current_database()`, and
  `acquisition.afl_api_current_season_enabled` is explicitly enabled. **Operator lifecycle:** read
  and record the current `afldb_test` value → enable explicitly → run preparation → restore the
  exact previous value even if preparation fails → record the restoration. Not reliant on the
  candidate's `site_settings` later being replaced from the target. Never enabled on PROD as part
  of ISSUE-252.
- **D-252-8 = OWNERSHIP PARITY; NO PROMOTION-TIME REOWNERSHIP.** The §19 AFL API-only preparation
  is **rejected**: it would make AFL Tables-owned PROD matches `afl_api`-owned after promotion.
  ISSUE-228/Q7 doctrine binds (co-sources corroborate, never silently re-own; ownership transfer
  is never an incidental consequence of source order or promotion). For 2026, preparation
  establishes the current-season matches from the **retained AFL Tables current-season source
  first**, then runs the **retained AFL API** settle so it corroborates rather than becoming first
  writer. No network acquisition inside preparation; every source is retained and hash-bound. If
  the retained AFL Tables snapshot/manifest is unavailable or cannot reproduce PROD's stable match
  identities: **STOP and report; never fall back to AFL API ownership.** The gate proves, per
  dependency: the stable identity resolves exactly once in the prepared source; prepared
  `match_key` equals the PROD manifest's exactly; prepared owner source key equals PROD's; no
  ambiguity; no fallback to database-local ids. Any mismatch is a hard STOP. The known
  `2026|1|2026-03-05|Sydney|Carlton` reproduces exactly or stops — never normalised to pass. A
  mixed current-season ownership set the existing pipelines cannot faithfully reconstruct = STOP
  and open/extend an ownership-replay design; processing order is never chosen silently as
  ownership policy.
- **D-252-2 AMENDED.** Promotion preparation consumes **named, retained, hash-bound current-season
  source snapshots** (plural). For 2026 at least: the retained AFL Tables current-season source
  needed to reproduce target match ownership, and the retained AFL API snapshot used for the AFL
  API current-season corpus/stat preparation. No fresh network request is part of promotion.
- **Revised five stages.** (1) Historical rebuild — unchanged. (2) Current-season
  promotion-source preparation on `afldb_test` from retained source evidence, ownership-preserving
  order. (3) Mandatory source dependency + ownership gate using the target dependency manifest. (4)
  Candidate restore / existing lineage-remap — unchanged. (5) Existing post-swap reacquisition —
  unchanged except the documentation states it is refresh/corroboration, not repair for missing
  pre-swap dependencies.
- **Rehearsal additions M–T** — §21.6.

---

## 19. Revised implementation plan (2026-09-27) — NOT implemented

**State at the end of this planning pass:** nothing implemented, run or committed; no database
contacted. Implementation is **held** on the three newly discovered design points in §20, two of
which change how the gate as literally approved can be built. None of them trips a §18.1
STOP-and-report trigger; each has a recommended answer that stays inside the decisions.

### 19.1 The five lifecycle stages (kept separate)

| # | Stage | Host / database | Changed by ISSUE-252? |
|---|---|---|---|
| 1 | **Rebuild** — `npm run db:test:rebuild` | DEV, `afldb_test` | **No.** Historical baseline only; `rebuild-test.ts:1330-1334`'s pending-season invariant untouched |
| 2 | **Promotion-source preparation** — settle the current season into `afldb_test` from one retained, hash-bound AFL API snapshot | DEV, `afldb_test` only | **New orchestration CLI**, the settle itself unmodified |
| 3 | **Source dependency gate** — the target's production-owned match dependencies (§19.3) must each resolve by `match_key` in the prepared source | target host (read) + DEV (judge) | **New read-only gate**, mandatory |
| 4 | **Candidate restore** — `pg_dump` of the *prepared* `afldb_test`, restore into `afldb_prod_candidate_<stamp>`, `--phase restored` | PROD | **No.** Lineage gate, `resolveLineageRemap()`, A4.3 unchanged; now expected to PASS |
| 5 | **Post-swap current-season reacquisition** — `docs/production-promotion.md` §9 | PROD | **Procedure text only** (§20 D-252-8): the season now pre-exists, `afl_api`-owned |

### 19.2 Stage 2 — promotion-source preparation

New CLI `tools/db/prepare-promotion-source.ts` (npm: `db:promotion:prepare-source`). It is
orchestration and guards only; every write is made by the unmodified
`runAflApiSettleCli()` (`tools/current-season/settle-afl-api.ts:221`).

```bash
# DEV: streamanator — after db:test:rebuild, before the source gate
LABEL=<retained afl_api matches snapshot label>              # data/sources/afl_api/matches/$LABEL/
MSHA=<sha256 of $LABEL/manifest.json recorded when it was retained>
DATABASE_URL="$AFLDB_TEST_DATABASE_URL" AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_IMPORT_DATABASE_URL" \
  npm run db:promotion:prepare-source -- --acknowledge afldb_test \
    --label "$LABEL" --expect-manifest-sha256 "$MSHA" --validate-only
# ... then --dry-run, then --apply --record-out ~/backups/afldb/promotion-source-prep-$STAMP.json
```

Fail-closed sequence, in order, each a STOP with exit 1:

1. **Offline, before any connection.** `--acknowledge afldb_test` present; `aflApiSnapshotManifestSha256()`
   (`src/lib/acquisition/afl-api-snapshot.ts:129`) equals `--expect-manifest-sha256` (D-252-2);
   the per-file re-hash (`verifyAflApiSnapshotManifest()`, same file :52) passes; the manifest's
   season is exactly the one in-progress season in `data/reference/seasons.json` (a completed or
   other season refuses — this step populates the current season only).
2. **Database identity.** Both the writer (`AFLDB_IMPORT_DATABASE_URL`) and the control
   (`DATABASE_URL`) sessions report `current_database() = 'afldb_test'` exactly — proved live,
   never from a DSN string (the `settle-afl-api-brownlow.ts:19-35` pattern). Anything else refuses
   before the settle is called (rehearsal case J).
3. **Ingestion switch** (§20 D-252-7): `acquisition.afl_api_current_season_enabled` must already
   read `true` on `afldb_test`; the tool reports it and never writes it.
4. **The settle**, in-process: `runAflApiSettleCli(['--label', L, <--dry-run|--apply>,
   '--auto-apply', '--require-complete-source'])` — the exact flags of the scheduled chain
   (`deploy/afldb-settle-afl-api.sh:7-9`).
5. **Post-conditions**, all required: no `halt`; no `require_complete_source` rollback; the
   completeness verdict complete; and zero `buildFailures`, `unresolvedIdentityMatch`,
   `unresolvedIdentityPlayer`, `foreignOwnedCollision`, `venueProviderUnmapped`, `venueUnmapped`,
   `manualAuthorityRefusals`, `canonicalApplyRefusals`, `canonicalApplyFailures`. `recordsDeferred`
   (unplayed fixtures) is informational, as in the scheduled chain.
6. **Record** (`--record-out`, `--apply` only, refuses to overwrite): label, manifest sha256,
   season, live database/role, batch id, the counters and the completeness verdict — the
   promotion record's evidence for stage 2 and the input stage 3 names.

A re-run of the same label is idempotent by the settle's own contract (observations unchanged, 0
inserted, 0 updated), reported as such (rehearsal case K). Only the matches/stats chain runs: the
fixtures-only settle and the Brownlow settle are **not** part of preparation, because none of the
three dependency families reads their output. No network call exists anywhere in this path.

### 19.3 Stage 3 — the source dependency gate (one implementation, three families)

**Families**, derived from the contract, never a hand list:

| Family | Rows read on the TARGET | Row anchor | Stable identity derived on the TARGET |
|---|---|---|---|
| F1 `brownlow_vote_entry_state.match_id` | every row | `match_id` (`rowIdColumnOf`) | `LINEAGE_IDENTITY_SQL.match_key.byId` |
| F2 `data_overrides` (`matches`, `match_coaches`) | `is_active` rows of those two types (`PROMOTION_REPLAY_OVERRIDES_SQL`) | `data_overrides.id` | `entity_key`, or `decodeMatchCoachKey(entity_key).matchKey`; undecodable = no identity |
| F3 `data_edits.row_id` (`table_name = 'matches'`) | rows of that kind only | `data_edits.id` | `LINEAGE_IDENTITY_SQL.match_key.byId`; a row whose match no longer exists = no identity |

F1 and F3 are enumerated as every `lineageTargetsOf()` target with `entity: 'matches'` over
`lineageBoundTables()` — so a future contract table with a match reference joins the gate
automatically; F2 is the A4.3 replay's own row set. A family the contract withholds in the
environment (`historicalOnlyFor()`: today `data_edits` on **dev** only) is reported `withheld by
contract` and not judged; on **prod** all three are judged.

**Judgement.** One pure function, `judgeSourceMatchDependencies()`, calls the **unchanged**
`resolveLineageRemap()` per family with `referencedIds` = the target row anchors'
old values, `replacedIdentities` = the target-derived `(anchor, match_key)` pairs, and
`candidateIdentities` = the SOURCE's `(id, match_key)` rows for exactly those keys
(`LINEAGE_IDENTITY_SQL.match_key.byIdentity`). It consumes only `mapped` and `unresolved`; it
ignores `unchanged` and `merges`, which compare integers across databases and mean nothing here.
Per family it reports: rows inspected, identities derived, resolved, unresolved by reason
(`no_identity_in_replaced`, `identity_absent_in_candidate`) and ambiguous
(`ambiguous_in_replaced`, `ambiguous_in_candidate`), naming every unresolved `match_key` (D-252-2's
"report the missing stable identities"). Any unresolved or ambiguous row in any family = FAIL;
families never offset each other. Source-local ids are never printed as evidence and never
compared with target ids.

**Where it runs** — see §20 D-252-6 (the source and PROD target are on different hosts). The
recommended shape is a hash-bound two-sided artefact:

```bash
# (a) PROD: afldb-prod — read-only, BEFORE --freeze-plan, the target's dependencies by identity
npm run db:promotion:check -- --phase dependencies --database afldb_prod \
    --dependencies-out ~/backups/afldb/promotion-dependencies-$STAMP.json
sha256sum ~/backups/afldb/promotion-dependencies-$STAMP.json          # copy to DEV, re-hash there
# (b) DEV: streamanator — the gate, now mandatory at --phase source
npm run db:promotion:check -- --phase source --database afldb_test \
    --dsn-env AFLDB_TEST_DATABASE_URL \
    --target-dependencies promotion-dependencies-$STAMP.json --target-dependencies-sha256 <hex> \
    --source-dependency-proof-out promotion-source-dependency-proof-$STAMP.json
# (c) PROD, after the freeze: --phase pre-cutover adds --source-dependency-proof <file> and
#     re-derives the FROZEN target's dependencies; every one must be in the proven manifest
```

The manifest holds, per family, rows of `{anchor, identities[]}` plus `environment`,
`targetDatabase` (must equal the environment's live name), the target's database OID, a schema
version and `generatedAt` — `match_key` strings and target-local anchors only, no credentials.
`--phase source` refuses without it (no opt-out flag exists); the proof file binds the manifest
sha256, the source database identity and the PASS verdict, and is written only when every gate of
the run passed (the F-L4-4 rule). Step (c) closes the window between (a) and the freeze without
moving the gate after it: a dependency created in that window refuses at `pre-cutover`, minutes
into the freeze and before the candidate is built, instead of at `--phase restored`.

### 19.4 Stages 4 and 5

Stage 4 is §6 of `docs/production-promotion.md` unchanged, except that the dumped `afldb_test` is
the prepared one and the `--phase source` line gains the manifest (§19.3). `--phase restored`'s
lineage gate and A4.3 are untouched and now expected to PASS; they remain the backstop. Stage 5
(§9) still re-acquires the season after the swap, but the candidate already holds the prepared
2026 matches — see D-252-8.

### 19.5 Files to change (when implementation is released)

| File | Change |
|---|---|
| `tools/db/promotion-inventory.ts` | Pure: `matchDependencyFamilies()` (contract-derived), manifest type/parse/validate, `judgeSourceMatchDependencies()` over the unchanged `resolveLineageRemap()`; `ACCEPTANCE_CHECKLIST` source line; the `data_edits` remediation text's "apply after the post-promotion settle" sentence, once F3's acceptance cases pass (D-252-4) |
| `tools/db/promotion-check.ts` | `parseArgs`: phase `dependencies`, `--dependencies-out`, `--target-dependencies(-sha256)`, `--source-dependency-proof(-out)`; mandatory manifest at `--phase source`; target reader; source gate; pre-cutover subset re-proof; publish-after-all-gates |
| `tools/db/prepare-promotion-source.ts` (new) | §19.2 orchestration and guards only |
| `package.json` | `db:promotion:prepare-source` |
| `tools/db/promotion-source-dependency-rehearsal.ts` (new) | §19.6 |
| `tests/db-promotion-check.test.ts` | extend (closest semantic suite; no new test file) |
| `docs/production-promotion.md` | new §3a (prepare) / §3b (dependency gate) before §4; §9 rewritten; A4.3 "the promotion waits until no such override is active" replaced once F2's cases pass; checklist |

No migration, no change to `rebuild-test.ts`, `settle-afl-api.ts` / `src/lib/acquisition/*`, or
`resolveLineageRemap()`.

### 19.6 `code_test_db` rehearsal design (not run; needs its own authorisation)

`tools/db/promotion-source-dependency-rehearsal.ts run|residue|teardown --acknowledge code_test_db`,
modelled on `promotion-convergence-rehearsal.ts` (target = a schema `issue252_rehearsal_target`
inside `code_test_db`, read through a search_path-only connection so the checker's own target SQL
runs unchanged) and `afl-api-season-rekey-rehearsal.ts` (the real `runSettleAflApi()` over the
tracked `tests/fixtures/afl_api/match/*` units renamed into a `CD_M2026252R*` provider namespace,
written as a retained snapshot with a real `manifest.json` under a namespaced label). DEV, PROD and
`afldb_test` are never contacted; no DSN printed.

| Case | Proves |
|---|---|
| A | Preparation from retained fixture bytes: hash-bound label accepted, real settle `--apply --auto-apply --require-complete-source`, every §19.2 post-condition zero, record written |
| B | F1: a target `brownlow_vote_entry_state` row on a fixture match resolves after preparation |
| C | The same dependency REFUSES (`identity_absent_in_candidate`, key named) when the gate runs before preparation |
| D | F2: an active `matches` and a `match_coaches` override on fixture matches resolve after preparation |
| E | F3: a `data_edits` `matches` row resolves after preparation |
| F | A target dependency on a key no retained unit carries = hard STOP, key named, other families still reported separately |
| G | Ambiguity = hard STOP: a target anchor with two identities (`ambiguous_in_replaced`, synthetic target reader) and an undecodable `match_coaches` key |
| H | Historical dependencies (2025 fixture matches in the target) resolve identically before and after preparation; preparation touches no pre-2026 row |
| I | Target ids deliberately disjoint from source ids (target sequence offset); resolution succeeds by `match_key` alone |
| J | Wrong-database guard: the writer or control session on anything but the acknowledged database refuses before the settle; `--phase source` refuses a manifest whose `targetDatabase`/`environment` disagree or whose sha256 is not the one supplied; a tampered snapshot file refuses offline |
| K | Idempotent preparation: a second `--apply` of the same label = 0 inserted, 0 updated, gate verdict unchanged |
| L | Zero fixture residue after teardown (the one documented exception: sequences advanced by the real writer) |

### 19.7 Tests to add (DB-free, `tests/db-promotion-check.test.ts`)

`parseArgs` (phase `dependencies`; `--phase source` without a manifest refuses; flag/phase
pairings); manifest parse/validate (schema, environment/target mismatch, sha mismatch);
`matchDependencyFamilies()` equals exactly {F1, F3} from the contract plus F2, and a synthetic
contract table with an `entity: 'matches'` ref is picked up; `judgeSourceMatchDependencies()` —
resolve, absent, ambiguous both sides, undecodable F2 key, families independent, disjoint ids;
`prepare-promotion-source` argument parsing, manifest-sha refusal, season refusal, post-condition
refusal per counter (fake `runAflApiSettleCli` outcome), database-identity refusal (fake sessions).

---

## 20. Newly discovered design points (2026-09-27) — operator decisions needed before code

- **D-252-6 — the source and the PROD target are on different hosts (design blocker as
  literally approved).** `--phase source` runs on DEV against `afldb_test`
  (`docs/production-promotion.md:245-250`); `afldb_prod` lives on `afldb-prod`, which has no
  `afldb_test` (and the checker only swaps the database *name* on one DSN, `withDatabase()`), so a
  single-process `--phase source --old-database afldb_prod` cannot exist for PROD. **Recommended:**
  the hash-bound two-sided manifest of §19.3 — identities derived on the target, judged on the
  source, a proof file carried back, and a frozen-time subset re-proof at `pre-cutover`. Every
  judgement still happens before the freeze; only the window-closing re-proof is after it.
  *Alternative:* restore the prepared source dump on PROD into a scratch database and run a
  same-host cross-database gate there, pre-freeze — heavier, and it competes with
  `afldb_restore_test`, which §4.1 needs.
- **D-252-7 — the AFL API ingestion switch on `afldb_test`.** The unmodified settle refuses unless
  `site_settings.acquisition.afl_api_current_season_enabled` is `true` on the database it writes
  (`settle-afl-api.ts:274-283`; default `false`, `src/lib/site-settings.ts:247`), and its
  preflight also requires the control session (`DATABASE_URL`) to name that same database
  (`afl-api-ingestion-safety.ts:25-35`). A rebuilt `afldb_test` will almost certainly read
  `false`: preparation would refuse — correctly. **Recommended:** the operator sets the switch on
  `afldb_test` explicitly (one owner-role statement, recorded in the promotion record); the
  preparation tool verifies it and never writes it. It cannot leak: `site_settings` is truncated
  and reinstated from the target in the candidate (`promotion-inventory.ts:386-392`). *Rejected:*
  the settle's test-only `ingestionControls` override (it exists for tests only).
- **D-252-8 — post-swap ownership of the current season.** Prepared 2026 matches are inserted by
  the AFL API settle as `new_target`, so they are `afl_api`-owned in the candidate; PROD's own
  2026 rows today may be `afltables`-owned (the scheduled `afldb-settle-afltables` timer). After the
  swap, `settle-afltables` meeting an `afl_api`-owned row writes nothing when values agree
  (`history_only`) and refuses with `foreign_owned_collision` when any field differs
  (`src/lib/acquisition/reconciliation.ts:545-555`). This matches the co-source direction already
  in the code (AFL API replaces AFL Tables in season, `reconciliation.ts:557-567`), but it is a
  behaviour change in PROD's 2026 lineage the operator must accept. Separately: both settles render
  `match_key` with the same `renderMatchKey()` (`settle-core.ts:174`), but a round/date component
  disagreement between the retained AFL API snapshot and whatever created PROD's row renders a
  different key — the gate then STOPs on it (correct, no fallback). Whether PROD's
  `2026|1|2026-03-05|Sydney|Carlton` is reproduced exactly by the AFL API bundle is only provable
  on real data; the first real preparation + gate run answers it before any freeze.

**Next action:** *(superseded 2026-09-27 — D-252-6..8 decided in §18.2; see §21.)* operator
answers D-252-6, D-252-7 and D-252-8 (accept or amend the recommended answers); then implement §19
in a fresh session (this one ended planning near its context ceiling), DB-free tests first, then
the §19.6 rehearsal under its own authorisation.

---

## 21. Revised plan after D-252-6..8 (2026-09-27) — supersedes §19 where they differ

### 21.1 Retained AFL Tables 2026 source — what the repository shows

Searched before any edit (repository only; no host contacted):

- **Nothing tracked.** AFL Tables settle bundles live at
  `data/sources/afltables/fitzroy_core/<label>/observations.json` and their manifests at
  `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`; both are host-local
  (`.gitignore:122-137`; no `settle-*` manifest is tracked — the tracked ones are historical
  baselines). No 2026 settle manifest sha256 is recorded anywhere in the repository.
- **Host-local candidates, by record only.** `deploy/afldb-settle-afltables.sh:100-136` makes every
  scheduled/supervised settle label an immutable snapshot and deletes only a failed, manifest-less
  partial one; no tracked script prunes completed snapshots. Recorded labels:
  - DEV (streamanator, the `afldb_test` host): `settle-2026-2026-09-26-0941` — 217 matches, 9,982
    player-stat rows, no rejections, applied clean to `afldb_dev` as batch 86, completeness
    COMPLETE (ISSUE-237 runbook §11d.15). Its manifest sha256 is not recorded.
  - PROD (afldb-prod): whatever labels its settle timer/supervised runs wrote. PROD's 2026 matches
    were created by one of them; **none is named in the repository**.
  - AFL API pair, DEV: `afl-api-2026-2026-09-25-235854`, manifest sha256
    `afb2a754943fba59a48eabf0bf01dbae7e64046e012318864dc84f68c96907c7` (218 in feed, 217
    selected, selection CONCLUDED).
- **Reproduction is unproven.** Whether any retained AFL Tables bundle renders PROD's exact 2026
  `match_key` set (including `2026|1|2026-03-05|Sydney|Carlton`) can only be shown on the hosts.
  Ownership itself reproduces by construction: `matches.source_id` → `sources.key = 'afltables'`
  for any AFL Tables-inserted row (`SETTLE_SOURCE_KEY`, `src/lib/acquisition/settle-afltables.ts:123`).
- **AFL API second never re-owns** (verified in code): meeting a resolved AFL Tables-owned match,
  equal values are `history_only` and differing values refuse `foreign_owned_collision`
  (`src/lib/acquisition/reconciliation.ts:537-555`, `canonical-apply.ts:126-148`). AFL Tables-first
  therefore preserves ownership; a disagreement surfaces as a refusal, which §21.2 makes a STOP.

**Verdict:** candidate material exists on record but no retained, hash-recorded AFL Tables 2026
snapshot is established. This is blocker **B1** (§21.8). It gates the rehearsal on real bytes and
any real preparation, **not** the DB-free core, which takes the snapshot as a named, hash-bound
input and fails closed without one. No AFL API-only workaround was implemented.

### 21.2 Stage 2 — ownership-preserving source preparation (replaces §19.2)

`tools/db/prepare-promotion-source.ts` (npm `db:promotion:prepare-source`; **not yet written**).
Orchestration and guards only; every write is made by the unmodified settle CLIs.

```bash
# DEV: streamanator — after db:test:rebuild; the operator has ENABLED the switch (§21.7)
DATABASE_URL="$AFLDB_TEST_DATABASE_URL" AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_IMPORT_DATABASE_URL" \
  npm run db:promotion:prepare-source -- --acknowledge afldb_test \
    --afltables-label "$AT_LABEL" --expect-afltables-manifest-sha256 "$AT_MSHA" \
    --afl-api-label "$API_LABEL" --expect-afl-api-manifest-sha256 "$API_MSHA" \
    (--validate-only | --dry-run | --apply --record-out ~/backups/afldb/promotion-source-prep-$STAMP.json)
```

1. **Offline:** `retainedSnapshotProblems()` — exactly one in-progress season; bindings in the
   order `afltables` then `afl_api` (`PREPARATION_SOURCE_ORDER`); each manifest re-hashed from disk
   equals the operator-recorded sha256; each snapshot's season is the in-progress season. The AFL
   Tables bundle is additionally validated by the settle's own `validateSettleBundle()`.
2. **Database:** `preparationDatabaseProblems()` — both sessions `current_database() = 'afldb_test'`,
   agreeing; the switch read (never written) and `true`.
3. **AFL Tables settle** (`--label AT --apply --auto-apply --require-complete-source`, the scheduled
   chain's flags) — establishes the 2026 matches, `afltables`-owned, first writer. **Q-252-10
   (§25):** this first apply alone may carry `unresolvedIdentityMatch` > 0, provisionally,
   bounded by its own `canonicalRowsInserted`. Every other step-5 counter must be 0 here too.
3a. **AFL Tables closure dry run** (Q-252-10, mandatory, same label, `--dry-run`, same flags). This
   is the authoritative proof. It must pass every step-5 post-condition with NO tolerance
   (`unresolvedIdentityMatch` = 0), and also show `canonicalRowsInserted`, `canonicalRowsUpdated`
   and `canonicalApplicationsLogged` = 0. It is an expected rolled-back dry run. Otherwise STOP;
   the AFL API phase never starts.
4. **AFL API settle** (`--label API --apply --auto-apply --require-complete-source`) — corroborates.
5. **Post-conditions**, each a STOP: no halt/rollback; completeness COMPLETE for both; zero build
   failures, unresolved identities, `foreign_owned_collision`, venue unmapped, manual-authority /
   canonical-apply refusals or failures, for **both** runs. An AFL API `foreign_owned_collision`
   against an AFL Tables-owned match is a real source disagreement: STOP and report, never re-own.
   The only exception is step 3's provisional `unresolvedIdentityMatch`, which step 3a must
   discharge.
6. **Record** (`--apply` only, no overwrite): both labels + manifest sha256s, season, live
   database/role, both batch ids, counters, completeness verdicts. Schema 2 adds the two AFL Tables
   results as separate objects, `afltables_initial_apply` and `afltables_closure_dry_run`.

The fixtures-only and Brownlow AFL API settles stay out of preparation unless the operator decides
otherwise (**Q-252-9**, §21.8): none of F1–F3 reads their output.

### 21.3 Dependency manifest schema (implemented, `tools/db/promotion-source-dependencies.ts`)

```jsonc
{
  "kind": "afldb_promotion_target_dependency_manifest",
  "schema_version": 1,
  "environment": "prod",                  // hashed
  "target_database": "afldb_prod",        // hashed; must equal environmentNames(env).live
  "captured_at": "<ISO>",                 // metadata, NOT hashed
  "target_database_oid": 16385,           // metadata, NOT hashed
  "families": {                           // hashed
    "F1": { "status": "judged", "rows": 1 },             // brownlow_vote_entry_state.match_id
    "F2": { "status": "judged", "rows": 0 },             // active data_overrides matches/match_coaches
    "F3": { "status": "judged" | "withheld_by_contract", "rows": 0 }  // data_edits table_name='matches'
  },
  "dependencies": [                       // hashed, sorted by (family, target_row)
    { "family": "F1",
      "target_row": "brownlow_vote_entry_state:match_id=17795",   // audit only, never a lookup key
      "match_keys": ["2026|1|2026-03-05|Sydney|Carlton"],          // 0 = none, >1 = ambiguous
      "owner_state": "owned" | "unowned" | "indeterminate",
      "owner_source_key": "afltables" }                             // non-null iff owned
  ],
  "dependency_set_sha256": "<sha256 of the canonical hashed content>"
}
```

- Families come from the contract: `contractMatchDependencyRefs()` maps every `entity: 'matches'`
  lineage ref to F1/F3 and **refuses** an unclassified one; F2 is the A4.3 replay set, identity by
  `overrideMatchKeyOf()` (`decodeMatchCoachKey()` for `match_coaches`). `familyStatusesFor()` marks
  a family withheld only where the contract's `historicalOnly` says so (F3 on dev today).
- `buildTargetDependencies()` keeps a target row with several identities as ONE dependency so the
  ambiguity is judged, never picked. Owner: `source_id IS NULL` → `unowned`; set but unreadable →
  `indeterminate`.
- `parseDependencyManifest()` refuses: transport sha256 ≠ the operator-recorded one; recomputed
  `dependency_set_sha256` ≠ recorded (edits re-hashed by an attacker still fail); wrong
  environment/target; family row-count lies; owner fields inconsistent; duplicates; malformed rows.
- `compareDependencyManifests(A, B)` → `identical` + named `added` / `removed` / `changed`.

### 21.4 Ownership-parity gate (implemented, pure)

`judgeSourceDependencies({ manifest, sourceMatches })`. The source side is read **by
`match_key` only** (`SELECT m.id, m.match_key, m.source_id IS NOT NULL, s.key FROM matches m LEFT
JOIN sources s …  WHERE m.match_key = ANY($keys)`). Per family, through the **unchanged**
`resolveLineageRemap()` with synthetic ordinals as the target anchors (a target integer never
enters), then per mapped dependency: target `owned`, source `owned`, same `sources.key`. Refusal
reasons: the resolver's own (`no_identity_in_replaced`, `ambiguous_in_replaced`,
`identity_absent_in_candidate`, `ambiguous_in_candidate`) plus `target_owner_not_owned`,
`source_owner_not_owned`, `owner_mismatch`. Exact-string resolution is the `match_key` equality
check (a round/date/team difference is `identity_absent_in_candidate`, key named). Families are
reported separately and never offset each other; any refusal = FAIL.
`buildSourceDependencyProof()` writes only on PASS and only for `afldb_test`;
`sourceProofBindingProblems(proof, frozenB)` is empty only when the proof binds B's exact
`dependency_set_sha256`, environment, target and source.

### 21.5 CLI wiring still to do (next session)

- `promotion-check.ts`: `--phase dependencies --database afldb_prod --dependencies-out <file>`
  (read-only target reader for F1/F2/F3 + owner; publishes only on success); `--phase source`
  **requires** `--target-dependencies <file> --target-dependencies-sha256 <hex>` and writes
  `--source-dependency-proof-out` only when every gate passed; the frozen step: after
  `--freeze-plan`, `--phase dependencies` again → B; `--phase pre-cutover` (or a dedicated
  `--phase frozen-dependencies`) takes `--source-dependency-proof` + B and refuses unless
  `sourceProofBindingProblems()` is empty — otherwise the operator reruns `--phase source` against
  B on DEV while PROD stays frozen. Dump/candidate steps refuse without that PASS.
- `prepare-promotion-source.ts` + `package.json` script (§21.2).
- `docs/production-promotion.md`: §3a preparation (incl. the §21.7 switch lifecycle), §3b manifest
  A/B + gate, §9 wording (refresh/corroboration, not repair), A4.3 convention retired only after F2
  acceptance; `ACCEPTANCE_CHECKLIST` lines.

### 21.6 Rehearsal additions M–T (to §19.6 A–L; `code_test_db`, own authorisation)

| Case | Proves | DB-free cover now |
|---|---|---|
| M | Target dependency AFL Tables-owned; preparation AFL Tables-first then AFL API leaves the source match `afltables`-owned; gate PASSes | judge PASS |
| N | Same stable match prepared AFL API-first → gate REFUSES `owner_mismatch` although `match_key` resolves | judge refusal |
| O | Target/source `match_key` differ by round, date or team → hard STOP, target key named | judge, 3 variants |
| P | Pre-freeze and frozen manifests identical → proof stands | hash + comparison + binding |
| Q | Dependency added between manifests → set sha changes; frozen manifest requires a fresh source gate | hash + comparison + binding |
| R | Frozen manifest adds a dependency absent from the prepared source → hard STOP | judge |
| S | File tampering → transport sha refusal; content edit re-hashed → set-sha refusal | parse |
| T | Switch disabled → refuses; explicitly enabled → allowed; `DATABASE_URL`/import database disagreement → refuses; the CLI never mutates the switch | guard function (CLI not yet written) |

In the real rehearsal M/N need two tracked fixture bundles for the same synthetic match — an AFL
Tables observation bundle and an AFL API unit — whose rendered keys agree.

### 21.7 Operator switch lifecycle (D-252-7), to go into `docs/production-promotion.md` §3a

```sql
-- afldb_test, owner role, recorded in the promotion record
SELECT value FROM site_settings WHERE key = 'acquisition.afl_api_current_season_enabled';  -- record V0 (or "absent")
-- enable explicitly, run preparation, then ALWAYS restore V0 (or delete the row if it was absent),
-- even when preparation fails; re-read and record the restored value.
```

Exact statements to be fixed against `src/lib/site-settings.ts` when §3a is written.

### 21.8 Blockers and open questions

- **B1 — retained AFL Tables 2026 snapshot not established (§21.1).** Needs a read-only operator
  step on both hosts: list the `settle-2026-*` bundles and manifests, record the chosen label's
  manifest sha256, and (if the chosen one is on PROD) transfer the bundle + manifest to DEV and
  re-hash there. Whether it reproduces PROD's exact keys is then proved by the gate itself
  (stage 3) before any freeze; a failure is a STOP (D-252-8), never an AFL API fallback.
- **B2 — AFL API corroboration may disagree.** Any value difference between the retained AFL API
  snapshot and an AFL Tables-owned match refuses `foreign_owned_collision`; §21.2 makes that a
  STOP. Only a real preparation run shows whether it occurs.
- **Q-252-9** — *(DECIDED 2026-09-27: neither is part of preparation — D-252-9a/9b, §22.1.)* Are
  the AFL API fixtures-only and Brownlow settles part of preparation? The
  amended D-252-2 mentions "Brownlow preparation"; §21.2 keeps them out pending an answer.
- **B1** — *(2026-09-27: retained source located, key/ownership acceptance pending the gate — §22.3.)*
- `in_progress_seasons` must still list 2026 (`data/reference/seasons.json:9` does today); once
  2026 is closed there, both in-season settles refuse and this preparation path cannot run.

### 21.9 Next action

Operator: run the §21.10 focused test, then resolve B1 (read-only host listing + sha record) and
Q-252-9. Then, in a fresh session: §21.5 CLI wiring with its DB-free tests, docs, and the §19.6 +
§21.6 rehearsal under its own authorisation.

### 21.10 Focused verification

```bash
npx vitest run tests/db-promotion-check.test.ts -t "AFLDB-ISSUE-252"
npx tsc --noEmit -p tsconfig.json
```

---

## 22. Third pass (2026-09-27) — Q-252-9, manifest layouts, B1 inventory, preparation CLI

Validation at entry: §21.10 ran on the workstation (operator-authorised) — 24/24 ISSUE-252 tests
passed, `tsc` exit 0. (The worktree had no `node_modules`; it was junctioned to
`D:\dev\afldb-issue-251\node_modules`, identical `package-lock.json` sha256. Gitignored.)

### 22.1 Q-252-9 — DECIDED (operator, 2026-09-27)

- **D-252-9a = NO separate AFL API fixtures-only settle in mandatory promotion-source preparation.**
- **D-252-9b = NO AFL API Brownlow settle in mandatory promotion-source preparation.**
- Required chain: (1) retained AFL Tables current-season source → canonical current-season matches
  first; (2) retained full AFL API match/stat source → corroboration/enrichment under existing
  ownership rules; (3) mandatory dependency + ownership-parity gate.
- Reason: F1 `brownlow_vote_entry_state.match_id`, F2 `data_overrides` and F3 match `data_edits`
  each need only their referenced match identity in the prepared source; none needs AFL API
  Brownlow votes in `afldb_test`; fixtures-only observations are not the canonical corpus ISSUE-252
  repairs; adding either would widen ISSUE-252 into unrelated operational/count-window semantics.
  Not added defensively. If the full AFL API settle cannot corroborate the AFL Tables-first corpus
  without fixtures-only, STOP with code/test evidence before changing D-252-9.
- Enforced: `parsePrepareArgs()` refuses any flag it does not know (a `--fixtures-only` is pinned
  refused by test); the CLI calls exactly `runSettleCli()` then `runAflApiSettleCli()`.

### 22.2 Manifest layouts — verified against code; not rewritten

| | AFL Tables (`fitzroy_core`, in-season) | AFL API (matches) |
|---|---|---|
| Snapshot | `data/sources/afltables/fitzroy_core/<label>/` (raw CSVs) | `data/sources/afl_api/matches/<label>/` (per-match JSON + season feed) |
| Manifest | `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`, written LAST by `acquire_core.R:434-490` | `<label>/manifest.json` beside its payloads (`afl-api-snapshot.ts:52-82`) |
| Manifest binds | `files[] = {dataset, filename, row_count, sha256, columns}` under `working_directory` | `files[] = {file, sha256, status?}` — every payload the settle reads |
| Kind / season | `acquisition_kind = 'in_season_partial'`, `in_season.season`, `completeness = 'unvalidated'` always (the acquirer never adjudicates) | `source_key = 'afl_api'`, `season`; `afl_api_fixture_snapshot` refused |
| What the settle reads | `<label>/observations.json` (emitted afterwards by `import_fitzroy_core.py:2262-2288`) — **NOT listed in the manifest**; it only names `manifest_sha256` + an absolute `manifest_path` the settle re-hashes (`settle-afltables.ts:146-181`) | the manifest-listed payloads, re-hashed |

**Consequence (implemented):** an AFL Tables binding is `{label, manifest sha256, observations.json
sha256}` — the manifest alone does not pin the bytes the settle consumes. `retainedSnapshotProblems()`
now takes a source-discriminated `RetainedSnapshotBinding` (`AflTablesSnapshotBinding` carries the
bundle binding; `AflApiSnapshotBinding` does not) plus per-source `integrityProblems`. The readers
are source-specific (`verifyAflTablesRetainedSnapshot()`, `verifyAflApiRetainedSnapshot()` — the
latter is the settle's own `verifyAflApiSnapshotManifest()`); both return the one common binding.
The AFL Tables reader also requires the bundle's `manifest_path` to resolve to **this checkout's**
manifest (the file the settle re-hashes), the manifest's `working_directory` to be the label's own
directory, every CSV to re-hash, and the settle's own `validateSettleBundle()` to pass.
**Transfer note:** a PROD-origin bundle's `manifest_path` is `/home/arm/projects/afldb/docs/…`, so
on DEV it must be placed in, and prepared from, `/home/arm/projects/afldb` — any other checkout
refuses (by design; no path rewriting).

### 22.3 B1 — read-only host inventory (2026-09-27; filesystem only, script over stdin, nothing written)

Criteria per label: snapshot dir + manifest present; manifest sha256 from current bytes; manifest
`snapshot_label`/`mode`/`acquisition_kind`/`in_season`; every manifest-named file present and
re-hashing; `observations.json` present, sha256, and naming this manifest's digest.

**DEV (streamanator), `/home/arm/projects/afldb`, 12 labels.** 9 are **unusable**: bundle present but
**no manifest** (`settle-2026-2026-09-03-1513`, `-09-04-1354`, `-09-04-1405`, `-09-04-1416`,
`-09-04-1847`, `-09-04-1849`, `-09-06-1145`, `-09-06-1634`, `-09-11-1148`). 3 validate:

| Label | Matches / player rows | Rounds | Manifest sha256 | `observations.json` sha256 |
|---|---|---|---|---|
| `settle-2026-2026-09-15-2201` | 215 / 9,890 | 1–27 | `2ce861e8…4cddb21` | `f68ed36a…cc238f6d` |
| `settle-2026-2026-09-15-2203` | 215 / 9,890 | 1–27 | `106358b5…4d9fb9d4` | `22b4429b…4d238c77` |
| **`settle-2026-2026-09-26-0941`** | **217 / 9,982** | **1–28** | `c46fc69329acf261c9c3e2a3687b97b2df224ce0a58e69630005112ed33a8dc6` | `5d1580682baf1f516dc5a26665b156a27a8e9d723c623b9b06627cd81adf1680` |

DEV worktrees `afldb-issue-128` (3 labels, 207-match bundles with 94 unkeyed rejections) and
`afldb-issue-130` (2 labels, 209 matches) validate but are older/partial; not candidates.

**PROD (afldb-prod), `/home/arm/projects/afldb`, 24 labels — all 24 validate** (2/2 files present
and re-hashing, bundle names its manifest, `in_season_partial`, season 2026, no failed acquisition
observations). Oldest `settle-2026-09-02-1958` (bundle 207 matches, 94 unkeyed rejections); from
`settle-2026-09-03-2230` onward 0 rejections / 0 unkeyed. Latest four:

| Label | Matches / player rows | Rounds | Manifest mtime (UTC) | Manifest sha256 | `observations.json` sha256 |
|---|---|---|---|---|---|
| `settle-2026-2026-09-19-0440` | 215 / 9,890 | 1–27 | 2026-09-18T18:40Z | `deefffe8…b9726fc` | `9107fecd…54aff542` |
| `settle-2026-2026-09-20-0435` | 215 / 9,890 | 1–27 | 2026-09-19T18:35Z | `123543fd…4a122a2` | `6de9e8e9…5b63f7c8` |
| `settle-2026-2026-09-21-0435` | 217 / 9,982 | 1–28 | 2026-09-20T18:35Z | `02ee3d50…1fde9c009` | `6ef3e2b8…6817892` |
| **`settle-2026-2026-09-22-0444`** | **217 / 9,982** | **1–28** | 2026-09-21T18:44Z | `9ff2928f598ed64bc5fc21ebd84e4e5f6e50949555840877b87daa9008f26f7e` | `a62a566fc4fd1aefae5bfc9780a4d8ea3973c13b131e0289e93dd9b3f5eec1bd` |

(Full per-label hashes for all 36 labels are in this session's inventory output; only the
candidates are carried here.)

**B1 outcome: retained source located; semantic/key acceptance pending the gate.** Candidate
retained evidence, by the selection rule (PROD-origin preferred; origin is never acceptance):

- **Primary:** PROD `settle-2026-2026-09-22-0444` — manifest sha256
  `9ff2928f598ed64bc5fc21ebd84e4e5f6e50949555840877b87daa9008f26f7e`, `observations.json` sha256
  `a62a566fc4fd1aefae5bfc9780a4d8ea3973c13b131e0289e93dd9b3f5eec1bd`; file hashes validate.
- **Fallback:** DEV `settle-2026-2026-09-26-0941` — manifest sha256
  `c46fc69329acf261c9c3e2a3687b97b2df224ce0a58e69630005112ed33a8dc6`, `observations.json` sha256
  `5d1580682baf1f516dc5a26665b156a27a8e9d723c623b9b06627cd81adf1680`; file hashes validate. Usable
  only if it independently satisfies the same gate proofs.

Neither is accepted until the gate proves every required PROD `match_key` exists in prepared
`afldb_test` with exact `match_key` and owner-source parity. No PROD query was made to discover ids.
The primary needs its bundle + manifest transferred to DEV and re-hashed there (not authorised yet).
The AFL API snapshot (`afl-api-2026-2026-09-25-235854`, `afb2a754…907c7`) was not re-inventoried in
this pass (out of the authorised scope); preparation re-verifies it offline before any connection.

### 22.4 Implementation after B1 (uncommitted, DB-free)

- `tools/db/promotion-source-dependencies.ts`: source-discriminated `RetainedSnapshotBinding`
  (§22.2); `preexistingSeasonOwnershipProblems()` — refuses when any in-progress-season match is
  already owned by anything but `afltables` (an `afl_api`-first source cannot be repaired by order,
  only by rebuild); `PREPARATION_ZERO_COUNTERS` + `settleStepProblems()` — §21.2 step 5 per settle
  (halt, rollback, completeness ≠ `complete`, applied ≠ mode, any listed counter non-zero **or
  missing**).
- `tools/db/prepare-promotion-source.ts` (new) + npm `db:promotion:prepare-source`. Flags:
  `--acknowledge afldb_test --afltables-label L --expect-afltables-manifest-sha256 H
  --expect-afltables-bundle-sha256 H --afl-api-label L --expect-afl-api-manifest-sha256 H
  (--validate-only | --dry-run | --apply --record-out <new file>)`. Order: offline verify both →
  `proveAflApiIngestionPreflight()` (control + writer `current_database()`, switch READ only) →
  `preparationDatabaseProblems()` → season ownership pre-check → AFL Tables settle
  (`--auto-apply --require-complete-source`, `env: {}` so the settle's ISR revalidation never
  fires against a site) → **AFL API dry run, post-conditions** → AFL API apply → record (`wx`, never
  overwrites). All writes go through the one proved import session. `--dry-run` dry-runs AFL Tables
  only: before the AFL Tables apply commits, an AFL API dry run would describe first-writer inserts,
  not corroboration.
- `tests/db-promotion-check.test.ts`: +16 ISSUE-252 tests (40 total): binding (bundle sha,
  integrity problems), ownership pre-check, post-conditions, argument parsing (unknown flag incl.
  `--fixtures-only`, label traversal), both source readers on temp-dir layouts (tampered CSV,
  foreign `manifest_path`, missing snapshot, tampered AFL API payload, fixtures-only kind), and the
  run with fake settles: validate-only opens nothing; dry-run order; **M** apply order + record;
  **T** disabled switch / wrong database refuse before any settle; the source never writes
  `site_settings`; an `afl_api`-owned season refuses; an AFL API dry-run collision stops before the
  apply with no record; unverified inputs refuse before connecting.
- Validation: `npx vitest run tests/db-promotion-check.test.ts -t "AFLDB-ISSUE-252"` → 40 passed;
  whole file 304/304; `npx tsc --noEmit -p tsconfig.json` exit 0.

### 22.5 Still to do (next session), and blockers

- `promotion-check.ts` wiring (§21.5 first bullet, unchanged): `--phase dependencies`
  (read-only target reader + `--dependencies-out`), mandatory manifest at `--phase source` +
  `--source-dependency-proof-out`, the frozen re-check, dump/candidate refusal without it.
- `docs/production-promotion.md` §3a/§3b/§9/A4.3 + `ACCEPTANCE_CHECKLIST`; the §21.7 switch
  statements fixed against `src/lib/site-settings.ts`.
- `tools/db/promotion-source-dependency-rehearsal.ts` (A–T), written but NOT run.
- **B1 transfer:** copying the PROD primary's bundle dir + manifest to DEV `/home/arm/projects/afldb`
  and re-hashing there needs its own authorisation. *(Done 2026-09-27, §23.1.)*
- **B2** (§21.8) unchanged: only a real preparation shows whether the AFL API corroborates cleanly.

---

## 23. Fourth pass (2026-09-27) — B1 transfer, `promotion-check.ts` wiring, docs, A–T rehearsal script

Authorised: DB-free implementation; PROD → DEV file copy of the selected AFL Tables snapshot.
Not authorised and not done: any database contact (DEV, PROD, `afldb_test`, `code_test_db`),
running preparation or the rehearsal, a promotion, network acquisition, a commit.

### 23.1 B1 transfer — PROD `settle-2026-2026-09-22-0444` copied to DEV, byte-identical

Read-only verification script piped over stdin (`python3 -`) to each host; nothing written on
PROD; no DB, service, settle, acquisition or build on either host. Copy path: PROD → workstation
scratch (`scp -r`, one connection) → DEV (`scp`), then the scratch copy deleted.

| Check | PROD (before) | DEV (after) |
|---|---|---|
| host | `afldb-prod` | `streamanator` |
| manifest sha256 | `9ff2928f598ed64bc5fc21ebd84e4e5f6e50949555840877b87daa9008f26f7e` OK | same, OK |
| `observations.json` sha256 | `a62a566fc4fd1aefae5bfc9780a4d8ea3973c13b131e0289e93dd9b3f5eec1bd` OK | same, OK |
| manifest files | 2/2 re-hash: `player_stats_2026.csv` 4,483,241 B `80a7e9f2…3245ca8de`; `results.csv` 21,378 B `7b1482d5…2e4ab1` | 2/2 re-hash, same |
| snapshot dir | 3 files, 36,399,879 bytes, 0 symlinks, listing sha256 `533bdd0d…264b8bf6` | 3 files, 36,399,879 bytes, 0 symlinks, listing sha256 `533bdd0d…264b8bf6` |
| manifest file | 4,494 bytes | 4,494 bytes |
| `observations.json` `manifest_path` | `/home/arm/projects/afldb/docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-2026-09-22-0444.json` | same |
| `observations.json` `manifest_sha256` | = manifest sha256 | = manifest sha256 |
| manifest | `snapshot_label` = label, `mode acquire`, `in_season_partial`, `working_directory data/sources/afltables/fitzroy_core/settle-2026-2026-09-22-0444`, season 2026 | same |

DEV pre-copy: both destination paths **ABSENT**, both parent directories present. No edit to any
byte, line ending or path. File mtimes on DEV are the copy time (content, not timestamps, is the
binding). The preparation CLI was **not** run.

### 23.2 `promotion-check.ts` wiring (implemented, DB-free tested)

- **`--phase dependencies`** (new standalone read-only phase, live target only —
  `afldb_prod`/`afldb_dev`): `--dependencies-out <file>` required. Optional `--freeze-record`
  first re-proves frozen/quiescent/F0 (`gateFrozenTarget`) and stamps `freeze_token` into the
  manifest (B). F1/F3 readers are generated from the contract's own match refs
  (`contractFamilyReaders()`: F1 every `brownlow_vote_entry_state` row, anchor `match_id`; F3
  `data_edits WHERE table_name = 'matches'`, anchor `id`; LEFT JOIN so a dangling row is a
  dependency with no identity), F2 is the A4.3 set (`F2_OVERRIDES_SQL`) with owners read by key
  (`MATCHES_BY_KEY_SQL`); every family is cross-checked against `count(*)` and a disagreement
  refuses without writing. Written via the no-clobber atomic writer; prints file sha256 and
  `dependency_set_sha256`. With `--source-dependency-proof` (+ sha256; under prod also needs
  `--freeze-record`) it performs the **frozen re-check** after writing B.
- **`--phase source`** now REQUIRES, in both environments, `--target-dependencies` +
  `--target-dependencies-sha256`, `--preparation-record` + `--preparation-record-sha256`, and
  `--source-dependency-proof-out`; no opt-out flag exists. Both files are parsed before any
  connection. After the existing source gates: one INFO manifest gate, one gate **per family**
  (rows inspected, stable identities, resolved, unresolved, ambiguous, owner mismatch, other
  refusals, owner parity; every refusal names `target_row`, reason, `match_key`, owners), and
  "preparation record belongs to this source" (both import batches present). The proof is
  published after the `finally`, only when **no gate of the run** failed, never over an existing
  file.
- **`--phase pre-cutover`**: `--source-dependency-proof` (+ sha256) required under prod, optional
  under dev; after the freeze gate it re-derives the frozen dependency set live (no file) and runs
  the same binding gate — a stale proof cannot reach the snapshot, candidate or swap.
- Flag hygiene: every ISSUE-252 flag is refused outside its phases (incl. `--plan`); file/sha
  pairs go together; every sha must be 64 lowercase hex. `Phase` gains `dependencies`
  (`assertDatabaseForPhase`: live name only). `ACCEPTANCE_CHECKLIST` gains two lines (preparation
  + gate; frozen re-check).
- No numeric target id is ever a source lookup key: the source is read by `match_key` only, and
  target row ids appear only as audit strings.

### 23.3 Final dependency-manifest schema (v1)

```jsonc
{
  "kind": "afldb_promotion_target_dependency_manifest", "schema_version": 1,
  "environment": "prod", "target_database": "afldb_prod",          // hashed; target = live name
  "captured_at": "<ISO>",                                          // metadata, NOT hashed
  "target_database_oid": 16385,                                     // metadata, NOT hashed
  "freeze_token": null | "<32 hex>",                                // metadata, NOT hashed (A = null, B = token)
  "families": { "F1": {"status": "judged", "rows": n}, "F2": {...}, "F3": {"status": "judged"|"withheld_by_contract", "rows": n} },
  "dependencies": [ { "family": "F1", "target_row": "brownlow_vote_entry_state:match_id=17795",
                      "match_keys": ["2026|1|2026-03-05|Sydney|Carlton"],
                      "owner_state": "owned"|"unowned"|"indeterminate", "owner_source_key": "afltables"|null } ],
  "dependency_set_sha256": "<sha256 of canonical [kind, schema, environment, target, families, sorted dependencies]>"
}
```

`owner_state` is `indeterminate` also when the identity names no target match
(`target_match_present: false`, e.g. an F2 key the target does not hold). The parser refuses: a
transport sha mismatch; a recomputed set sha ≠ recorded (re-hashed tampering); wrong
environment/target; a malformed `freeze_token`; family row-count lies; withheld families with
rows; owner field inconsistencies; duplicates.

### 23.4 Source-proof schema (v1)

```jsonc
{
  "kind": "afldb_promotion_source_dependency_proof", "schema_version": 1, "verdict": "PASS",
  "environment": "prod", "target_database": "afldb_prod",
  "dependency_set_sha256": "<A's (or B's) set sha>", "manifest_file_sha256": "<file sha>", "manifest_captured_at": "<ISO>",
  "source_database": "afldb_test", "source_database_oid": 12345, "judged_at": "<ISO>",
  "preparation": {
    "record_sha256": "<sha of the preparation record file>", "prepared_at": "<ISO>", "season": 2026,
    "source_database": "afldb_test", "batches": { "afltables": 501, "afl_api": 502 },
    "afltables": { "label": "...", "manifest_sha256": "...", "observations_sha256": "..." },
    "afl_api":   { "label": "...", "manifest_sha256": "..." }
  },
  "families": [ { "family": "F1", "status": "judged", "rows_inspected": 1, "stable_identities": 1, "resolved": 1,
                  "unresolved": 0, "ambiguous": 0, "owner_mismatch": 0, "other_refusals": 0, "ownership_matched": 1 } ]
}
```

`parsePreparationRecord()` refuses a sha mismatch, another kind/schema, a record for any database
but `afldb_test`, order ≠ afltables→afl_api, a missing input hash, or no committed complete apply
for either source. `parseSourceDependencyProof()` refuses a sha mismatch, another
kind/schema/environment, verdict ≠ PASS, an unbound preparation, or any family reporting a refusal.

### 23.5 Frozen re-check behaviour

`sourceProofBindingProblems(proof, B)` is empty only when B's `dependency_set_sha256`, environment,
target and family statuses equal the proof's and the proof's source is `afldb_test`; the checker
adds "B was captured under this freeze token". Identical → PASS. Different → FAIL naming both
hashes and the STALE instruction: stay frozen, carry B to DEV, rerun `--phase source` against B,
re-check. B is still written (it is the rerun's input). A dependency in B absent from the prepared
source then STOPs at `--phase source` (`identity_absent_in_candidate`). `--phase pre-cutover`
repeats the check from a live re-derivation.

### 23.6 Docs

`docs/production-promotion.md`: §3 points to §3b; new **§3a** (why; manifest A; the switch
lifecycle SQL fixed against `site_settings(key, value jsonb, updated_at, updated_by)`; preparation
commands and STOP conditions), **§3b** (the gate, what the proof binds), **§4.2** (frozen re-check,
stale-proof procedure), §5 (`--source-dependency-proof` on pre-cutover), A4.3 note (rule unchanged;
rewritten only after F2 rehearsal cases pass), **§9** (refresh/corroboration, not repair), §13 DEV
commands. `CHANGELOG.md` Unreleased entry (Open, DB-free only). `package.json`: new
`db:code-test:issue252-rehearsal` (`db:promotion:prepare-source` is from §22).

### 23.7 `code_test_db` A–T(+U) rehearsal — WRITTEN, NOT RUN

`tools/db/promotion-source-dependency-rehearsal.ts` (1,489 lines), `run --acknowledge code_test_db
--out <new dir> | residue | teardown --acknowledge code_test_db`, DSNs from
`AFLDB_CODE_TEST_DATABASE_URL` + `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` (import DSN mandatory; the
settles run as the import role). The target is the schema `issue252_rehearsal_target` inside
`code_test_db`, read through a search_path-only connection so the checker's unqualified readers run
unchanged; target ids offset above 910,000,000. The names `afldb_prod` / `afldb_test` are passed as
LABELS only; every read and write is on `code_test_db` (`assertDatabase` in every write
transaction). Two worlds: AFL Tables-first (main) and AFL API-first (N/U), each torn down before
the next; namespace `CD_M2026252R*`, `CD_I9252*`, `issue252-rehearsal*`, `players/Z/Zz252_Rehearsal_*`.

| Case | How |
|---|---|
| A | real `runPreparePromotionSource --apply` over real `runSettleCli` + `runAflApiSettleCli`; the ONLY substitution is `prove`: the real `proveAflApiIngestionPreflight`, presented as `afldb_test` only after both sessions answered `code_test_db`; record parsed by `parsePreparationRecord`, proof written and parsed |
| B / D / E | F1 row, F2 `matches` + `match_coaches` overrides, F3 `data_edits` row resolve with owner parity after preparation (real `gateSourceDependencies`) |
| C | the same rows before preparation refuse `identity_absent_in_candidate`, key named |
| F | an F2 key no unit carries is a STOP; F1/F3 gates still PASS separately |
| G | two target matches sharing an id → `ambiguous_in_replaced`; undecodable `match_coaches` key → `no_identity_in_replaced` |
| H | a real afltables-owned 2025 match resolves before/after both preparations; a hash of pre-2026 matches is unchanged |
| I | disjoint ids; resolution by `match_key` only |
| J | wrong acknowledgement, wrong target/source names, foreign preparation record, control session ≠ source (settles counted, none run), manifest env/target/sha refusals, tampered AFL API payload / `observations.json` / CSV refused under `--validate-only` |
| K | second `--apply` = 0 inserted / 0 updated both sources; identical per-family counts |
| L | zero namespace residue, target schema dropped, switch restored, 2026 derived state = recomputed baseline (sequences excepted) |
| M | AFL API apply `corroboratedForeignOwned ≥ 1`, `foreignOwnedCollision = 0`, source stays `afltables`-owned, gate PASS |
| N | AFL API settle alone first → `afl_api`-owned → gate `owner_mismatch` although the key resolves |
| O | round / date / team variants each a STOP naming the target key |
| P | B of the unchanged target = A's set sha; `compareDependencyManifests` identical; binding PASS |
| Q | a new F3 row changes the hash, is named, old proof refused as stale |
| R | B adds an F1 dependency on an absent key → `identity_absent_in_candidate` |
| S | changed bytes + old sha → transport refusal; edited + re-hashed → set-sha refusal |
| T | real `runPreparePromotionSource --dry-run`: switch disabled → refused; enabled → passes the guard; control ≠ writer → refused; the unsubstituted real guard → refused (both sessions are `code_test_db`); the CLI never writes the switch (the rehearsal records, sets and restores it on `code_test_db` only) |
| U | after the AFL API-first settle, preparation refuses "already 'afl_api'-owned" before any settle |

**Unverified until the first run** (also in the script header): the AFL Tables projection derived
from the AFL API fixture unit auto-applies cleanly with every zero-counter 0; the June fixture
dates are not "plausible" matches of any real row (preflight checks with the real
`findPlausibleCanonicalFixtures`); the seeded player links make `unresolvedIdentityPlayer = 0`; an
AFL API snapshot without a season feed skips the absence sweep without making the run incomplete;
`matches.source_record_id` of the AFL Tables insert; every settle-written row is attributable
through a single-column FK or a namespaced `data_issues` / `staging.source_payloads` row (teardown
otherwise refuses, never guesses); recompute reproduces the 2026 baseline; `site_settings` carries
no audit trigger. Expect a debugging iteration on the first authorised run.

### 23.8 Two real-run defects found while writing the rehearsal (fixed, DB-free tested)

- `settleStepProblems()` refused every rollback, but the real AFL API dry run reports
  `rollbackReason: 'dry_run'` (`src/lib/acquisition/settle-afl-api.ts:1908`), so every real
  `--apply` would have STOPPED at its AFL API dry run. Now `'dry_run'` is accepted only on a dry
  run; on an apply, or any other reason, it is still a STOP.
- The settles report batch ids as decimal text (`ImportBatchId`), so `parsePreparationRecord()`
  read both as null and the "preparation record belongs to this source" gate could never pass. The
  parser now accepts a positive decimal string (safe-integer range) or an integer.
- The §22 test fakes (numeric ids, `rollbackReason: null`) hid both; they now return what the real
  settles return, and the record the fake `--apply` writes is round-tripped through
  `parsePreparationRecord`.

### 23.9 Validation (DB-free, workstation)

`npx vitest run tests/db-promotion-check.test.ts -t "AFLDB-ISSUE-252"` → **68 passed**; whole file
→ **332/332**; `npx tsc --noEmit -p tsconfig.json` exit 0; ESLint on the six changed/new TS files:
0 errors, 1 pre-existing warning (`_dropped`, the §22 destructure-to-omit in the post-conditions
test); `git diff --check` clean; the untracked files carry no trailing whitespace.

### 23.10 Blockers and next action

- **B2** unchanged: only a real preparation shows whether the retained AFL API snapshot
  corroborates the AFL Tables-first corpus without `foreign_owned_collision`.
- The AFL API snapshot `afl-api-2026-2026-09-25-235854` (`afb2a754…907c7`) is on DEV by record
  only; it has not been re-verified this pass (preparation re-verifies it offline first).
- Whether the retained AFL Tables bundle reproduces PROD's exact keys (incl.
  `2026|1|2026-03-05|Sydney|Carlton`) and owners is proven only by the real gate.

**Next action (needs its own authorisation):** run the `code_test_db` rehearsal
(`npm run db:code-test:issue252-rehearsal -- run --acknowledge code_test_db --out <dir>`), iterate
on its first-run assumptions, then `residue`. After that: operator commit; then the real sequence —
PROD `--phase dependencies` (A), DEV rebuild + switch + preparation, `--phase source`.

## 24. Fifth pass (2026-09-27) — `code_test_db` rehearsal, attempts 1–2: STOPPED on an operator decision

Authorised: `code_test_db` only; the rehearsal's own `run` / `residue` / `teardown`. No other
database was contacted. The two DSNs are the workstation `.env` owner (`AFLDB_TEST_DATABASE_URL`)
and import (`AFLDB_IMPORT_DATABASE_URL`) DSNs, with the port changed to the operator's
`127.0.0.1:55432` tunnel and the database to `code_test_db`. They were built in memory and passed
to the child process only, never printed. A read-only probe proved `owner` = `afldb_owner` and
`import` = `afldb_import`, both on `code_test_db`, with 0 other sessions.

### 24.1 Pre-run baseline

`residue` → all twelve namespace counters 0, target schema absent. 2026 on `code_test_db`: **0
matches, 0 `club_seasons`, 0 `player_season_stats`**; `seasons` row `status in_progress`,
`match_count`/`club_count`/dates NULL. 62 `public`/`staging` sequences recorded
(`D:\tmp\issue252-rehearsal\sequences-before.json`). The AFL API switch row was absent.

### 24.2 Attempt 1 — HARNESS_FIXTURE_ASSUMPTION (header assumption 7)

`recomputeClubSeasons()` refuses a season with no home-and-away match, by design
(`src/db/queries/player-derived.ts:413-423`). The baseline recompute threw before any fixture
write, so every case was unreached. Nothing was written (the recompute rolled back; the switch was
never written). Residue afterwards was 0. Correction: an **empty** 2026 is not recomputable (and
`recomputeSeasonMetadata()` would also turn its NULL counts into 0), so its baseline is now the
as-found state. `restoreDerived()` restores the as-found `seasons` row verbatim and removes the
fixture's `club_seasons` rows. That is allowed ONLY when the run found 0 matches, 0 `club_seasons`
and 0 `player_season_stats` for 2026. A season that holds matches is still recomputed by the real
functions. The as-found state is written to `<out>/evidence/season-as-found.json`, and `teardown`
takes `--season-as-found <file>`. L now also asserts the season row and counts are exactly as found.

### 24.3 Attempt 2 — two findings

Per-case result: **C, F, G, H, J, M, N, O, R, S, T, U PASS**; A, B, D, E, I, K, P, Q, L FAIL.
- **HARNESS_BUG (mine, attempt-1 correction).** `restoreDerived()` bound the as-found row as a
  `::jsonb`-typed parameter, and postgres.js JSON-encoded the string a second time ("cannot call
  populate_composite on a scalar"). Every namespace table was still 0, but 2026 kept 2
  `club_seasons` rows and a changed `seasons` row (`match_count 1`, `club_count 2`, dates
  `2026-06-23`, `last_loaded_round '3'`). Fixed by binding as `::text::jsonb`. Repaired with
  `teardown --acknowledge code_test_db --season-as-found …attempt-2-season-as-found.json` (the
  attempt's own header line, identical to the read-only census taken before attempt 2). Afterwards:
  residue 0, 2026 exactly as found, switch row absent.
- **CONTRACT/OPERATOR_DECISION_REQUIRED — see §24.4.** Case A: the AFL Tables `--apply` refused
  `afltables apply: unresolvedIdentityMatch = 1, must be 0`. Everything downstream of A (B, D, E,
  I, K, P, Q) failed because no record/proof exists.

### 24.4 Decision needed — Q-252-10: AFL Tables `unresolvedIdentityMatch` on a first settle

**Mechanism (code-verified).** For a match with no canonical row yet, the AFL Tables settle plans
its `match_period_scores` target as `unresolved('no canonical match exists for this match_key
yet', pending=true)` and increments `unresolvedIdentityMatch`
(`src/lib/acquisition/settle-afltables.ts:2983-2986`). The same run then applies that target
through the `'pending_match'` invitation once the match is invited (`:2182-2188`). So the counter
equals the number of NEW matches with period scores, not a failure. The rehearsal is consistent
with this: the second `--apply` of the same labels (K) reported AFL Tables
`unresolvedIdentityMatch 0`, `observationsUnchanged 2`, `canonicalRowsInserted 0`, `canonicalRowsUpdated 0`.
(The AFL API settle does not count its own `pending_match` period scores this way.)

**Consequence.** §21.2 step 5 ("zero … unresolved identities … for **both** runs") and
`PREPARATION_ZERO_COUNTERS.afltables` (`tools/db/promotion-source-dependencies.ts:996-1001`) can
**never pass on a freshly rebuilt `afldb_test`**, which is the only real preparation: every 2026
match is new there. Relaxing or re-defining that counter changes a §21.2 gate, which this pass is
not authorised to do.

**Options.**
1. **(Recommended) Verification re-run.** The first AFL Tables `--apply` keeps every other zero
   counter. Its `unresolvedIdentityMatch` becomes informational, bounded by the matches that same
   apply inserted. A mandatory AFL Tables `--dry-run` of the same label follows before any AFL API
   step. It must show EVERY AFL Tables zero counter at 0 (including `unresolvedIdentityMatch`), plus
   `canonicalRowsInserted = 0` and `canonicalRowsUpdated = 0`. That proves with the settle's own
   counter that no match identity is left unresolved or unapplied. It needs no settle change and is
   recorded in the preparation record.
2. Add a settle counter for `pending_match` applies and require `unresolvedIdentityMatch` = that
   counter. Exact, but changes `settle-afltables.ts` (the scheduled path) for a promotion-only need.
3. Drop `unresolvedIdentityMatch` from the AFL Tables apply's zero list. Not recommended: it
   loses the only proof that no identity stayed unresolved.

### 24.5 Evidence (operator evidence, not tracked)

| Path | sha256 |
|---|---|
| `D:\tmp\issue252-rehearsal\attempt-1.log` | `b1f3de308a7fd922ff4ddc8fc3ca60f17e1a7c320dc8f38c20b6cff984a7da23` |
| `D:\tmp\issue252-rehearsal\attempt-1\evidence\summary.txt` | `11710ff96e52698be71283f812d77a4b2b5c744825e7dd843631301d4580d632` |
| `D:\tmp\issue252-rehearsal\attempt-2.log` | `6bbc7f086d19b6932391856fe31061f4e5eae4da4ebc37e21cefd326f8273e4f` |
| `D:\tmp\issue252-rehearsal\attempt-2\evidence\summary.txt` | `b43a088759786810fde49538efebe31308e0366c3df501dbad40736b0e22e4e7` |

**Sequence-only lasting effect** (the documented exception), before → after attempt 2 and repair:
`canonical_applications_id_seq` 18→28, `club_seasons_id_seq` 1640→1648,
`external_identities_id_seq` 19406→19414, `import_batches_id_seq` 62→67, `matches_id_seq`
16847→16849, `player_match_stats_id_seq` 685471→685477, `players_id_seq` 13764→13768. No other
sequence moved.

### 24.6 Next action

*(Superseded by §25.)* Operator decides Q-252-10. Under option 1: implement the verification re-run in
`prepare-promotion-source.ts` + §21.2 + tests (DB-free), then a fresh attempt directory, rerun,
`residue`. A, B, D, E, I, K, P, Q still await their first real outcome. Not ready for commit.

## 25. Sixth pass (2026-09-27) — Q-252-10 decided and implemented; `code_test_db` attempt 3 PASS

### 25.1 Decision (operator, 2026-09-27): Q-252-10 option 1

The first AFL Tables apply in preparation may carry a non-zero `unresolvedIdentityMatch`. It is
informational for that one apply only: the settle plans period-score rows before the new match
exists, then satisfies them through `pending_match` in the same run. The settle is NOT changed,
`unresolvedIdentityMatch` stays in the final zero requirements, and the scheduled settle contract
is untouched. A same-label AFL Tables `--dry-run` straight after the apply is mandatory. It is the
authoritative closure proof and must pass before any AFL API step. Both AFL Tables results are
recorded separately and never collapsed.

### 25.2 Implementation (uncommitted)

- `tools/db/promotion-source-dependencies.ts`
  - `AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER = 'unresolvedIdentityMatch'`.
  - `afltablesFirstApplyProblems()` runs every §21.2 post-condition except that one counter. The
    counter must be a non-negative integer, and a positive value must be ≤ `canonicalRowsInserted`
    (pending period scores exist only for matches the same apply inserted). Any other non-zero
    counter refuses.
  - `afltablesClosureDryRunProblems()` runs every post-condition with no tolerance, plus
    `AFLTABLES_CLOSURE_NO_WRITE_COUNTERS` (`canonicalRowsInserted`, `canonicalRowsUpdated`,
    `canonicalApplicationsLogged`) = 0. `rollbackReason 'dry_run'` counts as expected.
  - `settleStepProblems()` is unchanged in behaviour.
  - `PREPARATION_RECORD_SCHEMA_VERSION` 2: `parsePreparationRecord()` requires both
    `afltables_initial_apply` and `afltables_closure_dry_run`. It re-judges each with the guards
    above, requires the step order `afltables:apply, afltables:dry-run, afl_api:dry-run,
    afl_api:apply`, the initial apply's batch = `batches.afltables`, and a null closure batch.
  - `PreparationBinding.afltables_closure` carries both results' counts.
    `SOURCE_DEPENDENCY_PROOF_SCHEMA_VERSION` 2: `parseSourceDependencyProof()` refuses a proof
    without a clean closure (0/0/0).
- `tools/db/prepare-promotion-source.ts`: `--apply` = AFL Tables apply (first-apply contract;
  logs the transient value) → same-label AFL Tables `--dry-run` (closure contract) → AFL API dry
  run → AFL API apply → record, built with `aflTablesStepEvidence()`. The record gives each result
  its batch id, inserted, updated, applications logged, `unresolved_identity_match`, the §21.2
  zero-list counters, a result line and the full counters. `--dry-run` is unchanged and carries
  NO tolerance (§25.6).
- `tests/db-promotion-check.test.ts`: first-apply tolerance and bound; another non-zero counter
  refuses; closure all-zero/no-write/`dry_run` expected; CLI order; negative control (closure
  still `unresolvedIdentityMatch` 1 → refused before AFL API, no record); closure that would write
  → refused; other counter on the initial apply → refused before the closure; `--dry-run` without
  tolerance; record v2 refusals (missing result, skipped closure, unclean closure, batch mismatch,
  schema 1); proof refusals (unclean or missing closure).
- `tools/db/promotion-source-dependency-rehearsal.ts`
  - Case A proves the lifecycle: fresh source (fixture match absent), then the first apply with
    measured `unresolvedIdentityMatch` > 0 and every other zero counter 0, then the closure dry
    run with 0/0/0 and every zero counter 0. It also checks that the AFL API `rollbackReason
    'dry_run'` was accepted, and that the record carries both results separately.
  - Live negative controls, run after K over the REAL settles with one reported counter
    simulated: an unclean closure refuses before the AFL API phase with no record, and
    `venueUnmapped` 1 on the initial apply refuses before the closure.
  - K stays the independent idempotence proof.

### 25.3 Pre-attempt-3 baseline (read-only)

`residue` all twelve counters 0, target schema absent. 2026: 0 matches / 0 `club_seasons` / 0
`player_season_stats`, and the `seasons` row is byte-identical to
`attempt-2-season-as-found.json`. The switch row is absent. The 62-sequence census is in
`sequences-before-attempt-3.json`, with 0 other sessions. Both sessions were proved on
`code_test_db` (`afldb_owner` / `afldb_import`).

### 25.4 Attempt 3 — REHEARSAL PASS

`D:\tmp\issue252-rehearsal\attempt-3`, exit 0. No other database was contacted.

| Case | Result | Checks |
|---|---|---|
| A | PASS | 15/15 |
| B | PASS | 1/1 |
| C | PASS | 5/5 |
| D | PASS | 1/1 |
| E | PASS | 1/1 |
| F | PASS | 2/2 |
| G | PASS | 3/3 |
| H | PASS | 5/5 |
| I | PASS | 2/2 |
| J | PASS | 12/12 |
| K | PASS | 3/3 |
| L | PASS | 8/8 |
| M | PASS | 3/3 |
| N | PASS | 3/3 |
| O | PASS | 4/4 |
| P | PASS | 3/3 |
| Q | PASS | 3/3 |
| R | PASS | 1/1 |
| S | PASS | 2/2 |
| T | PASS | 14/14 |
| U | PASS | 2/2 |

That is 21/21 cases and 93/93 checks.

- **First AFL Tables apply** (batch 68): `unresolvedIdentityMatch` **1**, `canonicalRowsInserted`
  3, `canonicalRowsUpdated` 0. Every other zero-list counter was 0, and completeness was `complete`.
- **Closure dry run** (no batch): `unresolvedIdentityMatch` **0**, inserted 0, updated 0,
  applications logged 0, every zero-list counter 0, `complete`, rolled back.
- **AFL API**: dry run `rollbackReason 'dry_run'` accepted; apply batch 71.
- **Negative controls**: both refused, as expected.
- **After the run**: residue 0, the switch back to absent, and 2026 exactly as found.

### 25.5 Evidence (operator evidence, not tracked)

| Path | sha256 |
|---|---|
| `D:\tmp\issue252-rehearsal\attempt-3.log` | `e813b35b77377d025b8d4a9901fd2790f8a47075efe7cdb3c174ff0d51a46ab8` |
| `D:\tmp\issue252-rehearsal\attempt-3\evidence\summary.txt` | `52d10857e6dcec26c6ac451f9d8b950b0d2a6d0c55128b355358623b507f9be0` |
| `D:\tmp\issue252-rehearsal\attempt-3\evidence\A.txt` | `c3627ef1f39155a31a173cf19ad93d04f0dd8a87ebde6ecd08b91711ef5492ba` |
| `D:\tmp\issue252-rehearsal\attempt-3\preparation\main-1.record.json` | `2b855ea18527ed782236487aa6a957b018a63b73641e73f0d69418c520a9b79a` |
| `D:\tmp\issue252-rehearsal\attempt-3\proofs\main-A.proof.json` | `d65e2cc89b148d5baaff57080c1ae037cba7b449fdf7d260faabc52360ef53bf` |
| `D:\tmp\issue252-rehearsal\sequences-before-attempt-3.json` | `e4c84da68aca4be895b4e71526437f07abdeadb2c463549e20ff89d36cd24f94` |
| `D:\tmp\issue252-rehearsal\sequences-after-attempt-3.json` | `b6ef2951395505528ea78881b472d9eaf521da713ea7c2d26ee880ce8481413b` |

**Sequence-only lasting effect** (the documented exception), before → after attempt 3:

| Sequence | Before | After |
|---|---|---|
| `canonical_applications_id_seq` | 28 | 38 |
| `club_seasons_id_seq` | 1648 | 1656 |
| `external_identities_id_seq` | 19414 | 19422 |
| `import_batches_id_seq` | 67 | 79 |
| `matches_id_seq` | 16849 | 16851 |
| `player_match_stats_id_seq` | 685477 | 685483 |
| `players_id_seq` | 13768 | 13772 |

No other of the 62 sequences moved.

**Validation.** `tests/db-promotion-check.test.ts` 340/340 (76 in the ISSUE-252 blocks); `tsc
--noEmit` clean. ESLint on the four changed files: 0 errors, 0 warnings (one earlier ISSUE-252
unused-var warning removed). `git diff --check` is operator-run (§12).

### 25.6 Open question — Q-252-11: should the preparation `--dry-run` preview share the first-pass tolerance?

As built, `--dry-run` judges the AFL Tables dry run with the plain §21.2 guard. On a freshly
rebuilt `afldb_test` it plans exactly what the first apply would, so it reports
`unresolvedIdentityMatch` = the number of new matches and **refuses**. Q-252-10 allowed the
tolerance for the first APPLY only, so the preview was deliberately left strict. The consequence
is that `docs/production-promotion.md` §3a's `--dry-run` line always refuses on a real
preparation.

The options:

1. Leave it strict, and have the operator skip `--dry-run` on a fresh rebuild.
2. Apply the same provisional, bounded tolerance to the preview, clearly logged as unproven. The
   `--apply` closure dry run stays the only proof.

Not needed for the rehearsal or for `--apply`.

### 25.7 Next action (superseded by §26)

Operator review, then `git diff --check`, then commit. After that:

1. Decide Q-252-11.
2. Run the real DEV preparation (rebuild `afldb_test` → switch enabled → `--validate-only` →
   `--apply`).
3. Run the gate.
4. Make a completely fresh ISSUE-237 L5 PROD attempt.

## 26. Seventh pass (2026-09-27) — Q-252-11 decided and implemented; `code_test_db` attempt 4 PASS

### 26.1 Decision (operator, 2026-09-27): Q-252-11 option 2, limited

The standalone preparation `--dry-run` may succeed on a freshly rebuilt `afldb_test` when:

- the source is complete;
- the dry run rolled back as expected;
- `unresolvedIdentityMatch` ≤ `canonicalRowsInserted`;
- every other counter is 0.

It is an **UNPROVEN PREVIEW**. The bound is a sanity check only. It does not show that the
unresolved identities were satisfied. A preview writes no preparation record and no source proof,
never satisfies `--phase source`, and is not promotion-ready evidence. `--apply` and its
mandatory closure dry run (§25) are unchanged and remain the only proof. The scheduled settle
contract and `settle-afltables.ts` are unchanged.

### 26.2 Implementation (uncommitted)

- `tools/db/promotion-source-dependencies.ts`
  - `afltablesPreviewDryRunProblems()` accepts the AFL Tables dry run only. It shares one private
    helper, `transientUnresolvedMatchProblems()`, with `afltablesFirstApplyProblems()`, so the
    tolerance and bound are identical and every other post-condition stays strict.
  - `PREPARATION_PREVIEW_STATUS` holds the `PREVIEW ONLY — UNPROVEN: transient same-run match
    dependencies are not yet proven resolved …` line.
- `tools/db/prepare-promotion-source.ts`
  - `--dry-run` judges with the preview guard and logs the measured counters and the status line.
  - `PrepareOutcome.status` is `offline-verified`, `preview-unproven` or `prepared`. Only
    `prepared` has a record.
  - `--record-out` is still refused on `--dry-run`.
- `docs/production-promotion.md` §3a gives the sequence `--validate-only` → `--dry-run` (preview,
  unproven) → `--apply` (with the closure). It states that the internal closure dry run, not the
  preview, is the proof.
- `tests/db-promotion-check.test.ts`
  - Guard tests: the bounded tolerance; above-bound refused; another counter, incompleteness, a
    halt or an unexpected rollback refused; an apply step refused; a prepared source clean.
  - CLI tests: a fresh preview passes and is labelled unproven; above-bound refused; another
    counter refused; no record, no file, and no proof code in the CLI; a prepared source previews
    0/0/0; `--apply` stays strict when the closure returns an accepted preview's counters.
  - The harness test now expects A–V.
- `tools/db/promotion-source-dependency-rehearsal.ts` adds case V.
  - V runs on the fresh source before A: the real CLI in `--dry-run`, with the real settle.
  - It checks the transient counter and bound, the unproven status, that no record or proof was
    written, and that the database state is unchanged.
  - Two live negative controls use the counter seam: `venueUnmapped` 1, and
    `unresolvedIdentityMatch` = inserted + 1.
  - After K, a preview over the prepared source must be 0/0/0 and write nothing.

### 26.3 Pre-attempt-4 baseline (read-only)

- Residue: all 0.
- 2026: 0 matches, 0 `club_seasons`, 0 `player_season_stats`; the row is identical to
  `attempt-2-season-as-found.json`.
- 0 other sessions; both sessions proved on `code_test_db`.
- The 62-sequence census `sequences-before-attempt-4.json` is identical to
  `sequences-after-attempt-3.json`.

### 26.4 Attempt 4 — REHEARSAL PASS

`D:\tmp\issue252-rehearsal\attempt-4`, exit 0, first try. No other database was contacted.

A–U all PASS with the same per-case counts as attempt 3 (§25.4). **V PASS 11/11.** That is 22/22
cases and 104/104 checks.

- **Standalone preview (fresh source).** Real settle: `unresolvedIdentityMatch` **1**,
  `canonicalRowsInserted` 3, updated 0, applications logged 2, every other zero-list counter 0,
  `complete`, rolled back. The status was `preview-unproven` and the PREVIEW ONLY line was logged.
  `preparation/` and `proofs/` were both empty afterwards.
- **Database unchanged.** These were all identical before and after the preview: 2026 match count,
  the fixture match (absent), `import_batches`, `canonical_applications`, `players`,
  `external_identities`, namespace residue, 2026 derived hash, pre-2026 hash, and the switch row.
- **Negative controls.** `venueUnmapped` 1 → refused. `unresolvedIdentityMatch` 4 against 3
  inserted → refused. Neither wrote anything.
- **Preview after preparation.** 0 / 0 / 0, still `preview-unproven`, and nothing written.
- **A.** First apply `unresolvedIdentityMatch` 1 (3 inserted, batch 83); closure 0/0/0.
- **After the run.** Residue 0, the switch back to absent, and 2026 exactly as found.

### 26.5 Evidence (operator evidence, not tracked)

| Path | sha256 |
|---|---|
| `D:\tmp\issue252-rehearsal\attempt-4.log` | `3e632bf2629eaf47a5f4f430f1d28318b65cb6021cc7d90f1126fb51f1a923c9` |
| `D:\tmp\issue252-rehearsal\attempt-4\evidence\summary.txt` | `aa5ce9f3ad86b511564e50d2e90771d1cef8e58830b1d8b22e32ff1057c1f13f` |
| `D:\tmp\issue252-rehearsal\attempt-4\evidence\A.txt` | `b2e16f3854f42551c218452d0c7db86f35869d3bff99a0d8014912d03dcf496a` |
| `D:\tmp\issue252-rehearsal\attempt-4\evidence\V.txt` | `73345578da0284e2faf23b1aa94576370baf5c581a4da69d72ea531d4955fb4a` |
| `D:\tmp\issue252-rehearsal\attempt-4\preparation\main-1.record.json` | `5e71119bc0b48b15055742a83c6b968f6c3f9bed724597a40c044911a4200e61` |
| `D:\tmp\issue252-rehearsal\attempt-4\proofs\main-A.proof.json` | `76c9b666e02aa1a770d9d4009b7f6ea1882eda742bae210177a78198a0d0ead2` |
| `D:\tmp\issue252-rehearsal\sequences-before-attempt-4.json` | `b6ef2951395505528ea78881b472d9eaf521da713ea7c2d26ee880ce8481413b` |
| `D:\tmp\issue252-rehearsal\sequences-after-attempt-4.json` | `1777541ffbaf7413541cc6560bd916b1f146d3adbcedf863fbfce9c26b62b961` |

**Sequence-only lasting effect** (the documented exception), before → after attempt 4:

| Sequence | Before | After |
|---|---|---|
| `canonical_applications_id_seq` | 38 | 54 |
| `club_seasons_id_seq` | 1656 | 1670 |
| `external_identities_id_seq` | 19422 | 19430 |
| `import_batches_id_seq` | 79 | 95 |
| `matches_id_seq` | 16851 | 16856 |
| `player_match_stats_id_seq` | 685483 | 685489 |
| `players_id_seq` | 13772 | 13776 |

No other of the 62 sequences moved.

**Validation.** `tests/db-promotion-check.test.ts` 346/346 (82 in the ISSUE-252 blocks). `tsc
--noEmit` is clean. ESLint on the six ISSUE-252 TS files: 0 errors, 0 warnings.

### 26.6 Next action

1. Operator review, then commit.
2. Run the real DEV preparation: rebuild `afldb_test` → enable the switch → `--validate-only` →
   `--dry-run` (preview) → `--apply`.
3. Run the gate.
4. Make a completely fresh ISSUE-237 L5 PROD attempt.

*(Superseded by §27: steps 1–2 ran — commits `4bda2107`/`077f9ca8` and a real DEV preparation —
and exposed the two blockers §27 fixes.)*

## 27. Eighth pass (2026-09-28) — D-252-12 refusal census, D-252-13 mandatory player bridge

### 27.1 What the real DEV preparation showed (operator evidence, `/home/arm/backups/afldb/`)

- **The AFL API refused 36 updates.** Before the bridge, 35 AFL API `player_match_stats` updates
  were refused. After the manual test bridge
  `issue252-player-bridge-20260927-211024.json` (sha256 `47bfadbe…f41f`, 669 providers, 669 linked,
  0 unresolved / contradictory / collisions, all 9,983 player-match rows covered), a supported AFL
  API dry run showed:
  - `canonicalApplyRefusals` 36, all ordinary: 0 identity refusals, reason `foreign_source_owner`
    ×36, family and target `player_match_stats` ×36;
  - `foreignOwnedCollision`, `sourceDisagreement`, `manualAuthorityRefusals`,
    `canonicalApplyFailures` and both unresolved-identity counters all 0;
  - `corroboratedForeignOwned` 217, 1 row inserted, completeness `COMPLETE`.
- **Every one of the 36 rows is AFL Tables-owned.** Field-diff trace
  `issue252-foreign-owner-field-diff-20260928-060322.log`: 36 rows, 53 differing values, owners
  `afltables: 36`. The 36th is Karl Amon (`CD_M20260141101|CD_T80|CD_I297354`,
  `2026|12|2026-05-21|Hawthorn|Adelaide`, `one_percenters` AFL Tables 3 vs AFL API 2). The 35→36
  change came from resolving his identity, not from a new failure class.
- **Root cause 1 (contract).** E3 (`autoApplyOwnership()`) is correct: a different owner is
  refused, never adopted. The defect was preparation's aggregate `canonicalApplyRefusals = 0`
  rule. It could not tell an expected cross-source disagreement from a real failure, because the
  counter says neither which targets were refused nor why.
- **Root cause 2 (reproducibility).** A fresh historical `db:test:rebuild` restores the captured
  historical AFL API identities. It did not hold `CD_I297354`, which the retained snapshot needs.
  Only a manual one-off bridge import repaired that, so the next fresh rebuild would regress.

### 27.2 Decisions (implementation validated by the fresh rehearsal, §27.7–§27.8; operator-accepted 2026-09-28, §27.10; D-252-10/11 are left to the Q-252-10/11 outcomes)

- **D-252-12.** An AFL API `player_match_stats` disagreement against an AFL Tables-owned row is an
  expected corroborating-source condition. It qualifies only when proven row by row: the canonical
  applier refused it as `foreign_source_owner`, against the owner `afltables` that it read inside
  its savepoint.
  - It remains a durable `data_issues` finding. It never changes canonical ownership or values.
  - Preparation binds the exact refusal census and requires dry-run/apply parity.
  - Every other canonical refusal remains fatal.
  - This replaces an unsafe aggregate-zero rule with a stronger classified-evidence rule. It does
    not "allow refusals".
- **D-252-13.** After a historical rebuild, current-season provider bridge coverage is a mandatory,
  hash-bound preparation prerequisite.
  - **Consume, don't regenerate.** Preparation consumes a retained artefact. The emitter reads the
    current season's canonical `player_match_stats`, which a fresh rebuild does not hold before the
    AFL Tables settle. Its output also carries a generation timestamp. A retained file bound by its
    recorded sha256 matches the retained-source model (D-252-2) exactly.
  - **Bound to the snapshot.** The bridge must name the retained AFL API snapshot label and manifest
    sha256, and its provider set must equal that snapshot's provider census exactly.
  - **Stable identity only.** Every provider is `linked` through its stable identity; numeric
    `candidate_player_id` values are ignored hints.
  - **Before any settle.** It is validated, applied through the restricted loader and read back
    before any settle. Settles never create players, so every identity it needs already exists
    after the rebuild.

### 27.3 Implementation (uncommitted)

**Canonical writer and settle.**
- `src/lib/acquisition/canonical-apply.ts`
  - `CanonicalApplyTargetResult.ownerSourceKey?`: evidence only, set on an E3 refusal from the
    identity E3 just judged (`judgedOwnerSourceKey()`).
  - E3, every other gate and the write paths are unchanged.
- `src/lib/acquisition/afl-api-refusal-evidence.ts` (new)
  - Evidence type, canonical entry form, deterministic order and canonical sha256.
- `src/lib/acquisition/settle-afl-api.ts`
  - `refusalEvidence` on `AflApiSettleRunResult`, collected beside **both**
    `canonicalApplyRefusals` increments: `unitRefusalEvidence()` for applier refusals (the actual
    machine reason, `nothing_to_write` included) and `matchIdentityRefusalEvidence()` for the
    I244-F010 identity withholding.
  - Returned sorted. It survives a dry run exactly as the counter does.
- `tools/current-season/settle-afl-api.ts`
  - `loadBundle` is exported as `loadAflApiSettleBundle`, so preparation derives the required
    provider census from the settle's own bundle build.

**Preparation judges** (`tools/db/promotion-source-dependencies.ts`).
- **Census.** `AFL_API_ACCEPTED_REFUSAL_CLASS` (`player_match_stats_foreign_source_owner_afltables`),
  `aflApiRefusalEntryProblems()`, `aflApiRefusalCensusProblems()` (count = counter, canonical
  order, no repeat), `aflApiPreparationStepProblems()` (every §21.2 post-condition, with only
  `canonicalApplyRefusals` judged by census; `PREPARATION_ZERO_COUNTERS` unchanged),
  `aflApiRefusalCensusParityProblems()` and `aflApiRefusalCensusBindingOf()`.
- **Bridge.** `playerBridgeArtefactProblems()`, `playerBridgeImportProblems()`,
  `playerBridgePostApplyProblems()` (human `resolved` links only up to the loader's own
  pre-count) and `playerBridgeBindingOf()`.
- **Schemas.** Record and proof are now schema 3. `parsePreparationRecord()` re-judges the census
  (recomputed sha256, class, order, count = the apply counter, dry-run and apply digests = the
  census) and the bridge (bound to the record's own AFL API label and manifest).
  `parseSourceDependencyProof()` re-judges the census and requires a whole bridge binding. Schema 2
  is refused.

**Preparation CLI** (`tools/db/prepare-promotion-source.ts`).
- New mandatory `--afl-api-player-bridge` and `--expect-afl-api-player-bridge-sha256`.
- Offline: `verifyAflApiPlayerBridge()` checks the hash, snapshot, season and exact provider
  census, then the restricted loader's own `loadBridgeArtefact(…, 'afldb_test')`.
- `--dry-run`: the bridge is validated read-only.
- `--apply` order: bridge validate → bridge apply → read-back → AFL Tables apply → closure dry run →
  AFL API dry run (census judged) → AFL API apply (census judged, then parity) → record.
- If the census changed between the two AFL API runs, it STOPs. The apply has already committed,
  so no record is written and `afldb_test` must be rebuilt.

**Everything else.**
- `tools/db/promotion-source-dependency-rehearsal.ts`: its placeholder binding gains the two
  fields; nothing else. **The `code_test_db` A–V harness predates the bridge argument and cannot
  rerun unchanged** (it builds no bridge fixture). That is a follow-up, not a blocker: acceptance
  is the fresh `afldb_test` rehearsal.
- `docs/production-promotion.md` §3a/§3b, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md`.
- **Not changed, by decision.** `autoApplyOwnership()`, `applyCanonicalUnit()`'s gates, the 36 rows,
  the loader and `promotion-check.ts`. An additional source-gate line binding the bridge's import
  batch was attempted in `promotion-check.ts`, but the session's permission classifier refused the
  edit. The record parse already re-judges both new sections, and the proof binds them, so this is
  an optional follow-up.

### 27.4 Validation (workstation, DB-free, 2026-09-28)

- `npx tsc --noEmit`: clean.
- `tests/db-promotion-check.test.ts`: **375/375**. The ISSUE-252 blocks hold 111 tests, 29 of them
  new:
  - D-252-12 mechanics, class, parity and CLI;
  - D-252-13 judges and CLI;
  - schema 3 record and proof, and the refusal of schema 2.
- `tests/afl-api-ingestion-safety`, `afl-api-match`, `afl-api-player-bridge-cli`,
  `current-season-import` and `afl-api-settle-cli-gate`: **630/630**.
- ESLint on the eight TS files: 0 errors, 0 warnings. `git diff --check`: clean.
- Not run: the DB-backed `tests/integration/settle-afl-api*.test.ts`. The fresh rehearsal exercises
  the same path on real data, and its census judge enforces count = counter.

### 27.5 Tests added (all DB-free)

**Census, and the mechanics behind it.**
- Evidence for an ordinary refusal and for an identity refusal, with the owner E3 judged.
- A source-pinned test: every counter increment pushes evidence at the same site, and E3's table is
  unchanged.
- Order and field-order independence, and the digest.

**The narrow class.**
- PASS: 0, 1, many, and the 36-row shape.
- FAIL on any single property:
  - table `matches`; family `match`;
  - owner `afl_api`, `manual_admin_edit` or null;
  - `ownership_indeterminate`, `manual_authority_conflict`, `stale_canonical_target`,
    `nothing_to_write` or `possible_existing_match`;
  - empty or unsorted fields, or an identity refusal.
- FAIL on the census as a whole: missing; counter above or below the evidence; extra keys;
  reordered; repeated.
- Every other counter stays strict.

**Parity.** An added, removed or changed entry (reason, owner, fields, table, family, match or
record) is refused, at both the judge and the CLI.

**Record and proof.**
- Schema 3 is accepted and schema 2 refused.
- The census is refused when its hash mismatches, it is reordered, its count or class is wrong, an
  entry is unapproved, the apply counter mismatches, or the dry-run digest mismatches.
- An `accepted: true` claim with no entries is refused.
- A zero census is accepted.
- The bridge section is refused when absent, when built for another snapshot or manifest, with a
  contradiction, when unlinked after apply, or with a census or outcome mismatch.
- A proof is refused when it tampers with or lacks either section.

**Bridge.**
- A missing required provider, or another snapshot, STOPs before any connection.
- A contradiction, collision or stop STOPs before any settle, as does an unlinked provider after
  the apply or a new human link.
- An idempotent replay passes.
- A numeric-id-only link is refused, as are an extra, unresolved or contradictory provider.
- Hints are counted and never bound; the record never carries a numeric player id.

### 27.6 Stop conditions still in force

Any of these STOPs the run, and none is weakened:
- any of the census rows is not AFL Tables-owned on the applier's savepoint read;
- the census is incomplete;
- the dry-run and apply censuses differ;
- the bridge needs name-only matching or introduces human authority;
- a provider is still unresolved after the bridge;
- a re-own would be needed;
- the source is incomplete;
- any other refusal, or any write failure;
- a retained hash differs;
- the DSNs are not both `afldb_test`;
- the switch cannot be restored exactly.

### 27.7 Fresh-rebuild DEV rehearsal (operator-run; PASSED)

Run by the operator, because this session has no SSH access to DEV (`Permission denied
(publickey,password)`), using `D:\tmp\issue252\issue252-fresh-rehearsal.sh` against the `077f9ca8`
checkout. All steps PASSed.

**Preparation record.** `/home/arm/backups/afldb/issue252-fresh-20260927-205159-preparation.json`,
sha256 `50de2e93e46e878969bb367ee9a9eb470b0dfb2a0ca096071207cc61adba0fec`, prepared
`2026-09-27T21:12:53.233Z`, season 2026.

**Fresh `db:test:rebuild`.** 89/89 validation checks PASS; 803 AFL API importer identities
captured/reinstated; baseline `season_2026_matches=0`; baseline `afl_api_player_identities=803`;
baseline `CD_I297354_rows=1`.

**Correction to §27.1's root cause 2.** The final fresh rebuild **did preserve `CD_I297354`**
through the existing importer identity capture/reinstate mechanism. Earlier testing had shown that
identity could be absent and the bridge could add it, but in this final acceptance rehearsal the
bridge replay was idempotent: required providers 669, newly linked 0, already linked 669, all 669
linked after read-back. `CD_I297354` was not missing after this fresh rebuild.

**D-252-13 retained player bridge.** Bridge sha256
`47bfadbe7d7f565c0aaea4c956be6d7825ec888a8bb780271548f17546f5e41f`; snapshot
`afl-api-2026-2026-09-25-235854`; snapshot manifest sha256
`afb2a754943fba59a48eabf0bf01dbae7e64046e012318864dc84f68c96907c7`; provider census 669/669; import
batch 28. The bridge remains a mandatory, hash-bound prerequisite because it proves exact
retained-snapshot provider coverage, even when replay is idempotent.

**AFL Tables preparation.** First apply: inserted 11935, updated 0, provisional
`unresolvedIdentityMatch` 217, batch 29. Mandatory same-label closure dry run immediately
afterwards: inserted 0, updated 0, `unresolvedIdentityMatch` 0, no write.

**D-252-12 AFL API refusal census.** Accepted class
`player_match_stats_foreign_source_owner_afltables`, count 36, census sha256
`53d09b41a709e2c4c200aecdd2441bfad955690ee37f22ab8c496ddcdcc7e435`, dry-run/apply census digest
parity PASS. Every one of the 36 entries: family `player_match_stats`, target table
`player_match_stats`, refusal `foreign_source_owner`, owner `afltables`. All other failure/refusal
classes remained zero/fatal.

Karl Amon census entry: external record `CD_M20260141101|CD_T80|CD_I297354`, match key
`2026|12|2026-05-21|Hawthorn|Adelaide`, rendered field `one_percenters`, owner `afltables`.

Independent static-import `parsePreparationRecord()` re-parse: PASS. (The original rehearsal step
using a dynamic file-URL import under `tsx -e` failed because the export was not surfaced through
that interop path — a rehearsal-script invocation issue, not an invalid preparation record.)

**Post-preparation ownership verification.** PASS: refusal census entries 36; census rows resolved
exactly once 36; census rows owned by AFL Tables 36; 2026 matches owned by AFL Tables 217; 2026
`player_match_stats` owned by AFL Tables 9982; 2026 `player_match_stats` owned by AFL API 1. The
current-season ingestion switch was restored exactly to its prior state: absent.

**Code transport.** The operator's choice recorded above (patch applied to the `077f9ca8` checkout;
the rehearsal's own step 1 file hashes prove which code ran).

### 27.8 Real PROD manifest A and the schema-3 source gate (PASSED)

Captured read-only on actual host `afldb-prod` against database `afldb_prod`, role `afldb_owner`.

**Manifest.** `/home/arm/backups/afldb/issue252-prod-dependencies-A-20260927-232620.json`, sha256
`3965df5391970d7ae7eaf6f7bba5dc4b21fcf8c4afcf1c5b2f0802d8e8ef8dca`; dependency-set sha256
`f23da3d80f03bc2796b4381fc27b1bc70c4eec8a7a127381343fd7855e3ab704`. Properties: kind
`afldb_promotion_target_dependency_manifest`, schema version 1, environment `prod`, target
`afldb_prod`, pre-freeze, `freeze_token = null`, F1 rows 1, F2 rows 0, F3 rows 0. The sole F1
dependency was `brownlow_vote_entry_state:match_id=17795`, stable match identity
`2026|1|2026-03-05|Sydney|Carlton`, target owner `afltables`. The file was copied from PROD to DEV
and re-hashed byte-identically.

**Schema-3 source gate.** Source proof
`/home/arm/backups/afldb/issue252-source-proof-20260927-232620.json`, sha256
`6c15b3b656236c083da57bf5c1439a35c7434bd06386b49875b341d697fc8abd`. Properties: kind
`afldb_promotion_source_dependency_proof`, schema version 3, verdict PASS, environment `prod`,
target database `afldb_prod`, source database `afldb_test`, dependency-set sha256
`f23da3d80f03bc2796b4381fc27b1bc70c4eec8a7a127381343fd7855e3ab704`, preparation record sha256
`50de2e93e46e878969bb367ee9a9eb470b0dfb2a0ca096071207cc61adba0fec`. Family result: F1 1 inspected /
1 stable identity / 1 resolved / 1 ownership parity; F2 0; F3 0. Overall:
`PROMOTION CHECK (prod/source): PASS — 16 gate(s) evaluated, none failed.`

No freeze, candidate creation, reinstatement, swap or other PROD mutation occurred in this
acceptance run. This closes §27.7's prior source-gate dependency: the fresh rehearsal, the manifest-A
capture and the source gate have all now PASSed.

**Not run.** The frozen manifest B (§18.2 D-252-6's step (c), `--phase pre-cutover`). **Not
attempted.** A fresh AFLDB-ISSUE-237 L5 PROD attempt.

### 27.9 Next action

1. Final diff/documentation review.
2. Commit/merge ISSUE-252.
3. Deploy/synchronise the committed schema-3 implementation through the normal procedure.
4. A completely fresh ISSUE-237 L5 PROD attempt, under separate authorisation. That future real L5
   must create its own attempt-scoped manifest A/source proof and frozen manifest B.

The retained failed candidate `afldb_prod_candidate_20260927-142540` is evidence only and must not
be mutated or resumed.

### 27.10 Operator acceptance (2026-09-28)

**D-252-12 and D-252-13 are explicitly accepted by the operator on 2026-09-28**, on the evidence
assembled in §27.7–§27.8: the fresh DEV rebuild/preparation rehearsal PASS; the D-252-12 36-row
classified refusal census PASS; the D-252-13 669/669 bridge PASS; the real PROD manifest A PASS; and
the schema-3 source gate PASS 16/16. This closes the "operator acceptance remains to be recorded"
step for D-252-12/D-252-13 specifically. **ISSUE-252 itself is not yet resolved** and AFLDB-ISSUE-237
L5 PROD has not passed — both remain open pending commit/merge, deployment, and a fresh L5 attempt.
