# AFLDB-ISSUE-224 — Runbook (PLANNING ONLY, not approved for execution)

**DraftGuru persons whose AFL Tables identity is not registered on the target
(`target_not_registered`): post-baseline debutants and numbering/ordinal/spelling cases cannot link
until the identity is registered.**

> **DECISION STATE — 2026-09-22 (read §16 first; it supersedes the stale statements noted below).**
> **D-7 APPROVED**, **D-8 APPROVED (sequence only)**, **D-9b RESOLVED** (option B, ISSUE-228 §20).
> The 92 Category A players are authorised registration **candidates** via the new immutable artefact
> `docs/rebuild-manifests/draftguru/issue224-d7-registration-decision-20260922.json`
> (sha256 `a795c987…`, `rows_sha256 0a3d1338…`); the 2026-09-19 Phase 3 verdict artefact is retained
> **unchanged**. **No database execution has occurred.** The AFL Tables timer remains **OFF on DEV and
> PROD**. ISSUE-224 is **not complete**; ISSUE-228 S9 is **not accepted**; DEV is **not** claimed
> deployed.
>
> **PRE-REGISTRATION SNAPSHOT VALIDATION PASSED 2026-09-22 — see §17** (operator-run
> `--validate-only --require-in-season`, exit 0, no database access). §16.5 prerequisite (a) is
> satisfied and D-10 is answered by execution; the only remaining gate before D-8 step 1 is explicit
> operator authorisation for DEV database writes (§9).
>
> Superseded by §16: §13.9's "D-7/D-8 open"; §13.10's "nothing after that is executable until D-7 and
> D-8 are answered"; §13.5 and §14.6's "D-9b unresolved / `-011148` bytes are a live obstacle";
> §14.7's decisions-put-to-the-operator wording. All are retained as dated lineage.

- **Status:** Open. Planning **pass 2**, 2026-09-19 (Opus 5 `afldb-orchestrator`, PhanesLight T3).
  Pass 1 was interrupted before its mandatory plan review; its output was retained as a draft but
  **not trusted**. Pass 2 re-verified every load-bearing claim against current source with two
  independent `afldb-worker` verifications plus the orchestrator's own re-reading and offline
  recomputation, then ran the mandatory `afldb-reviewer` plan review. Eleven corrections resulted,
  including two HIGH defects in the safety enumeration (§11).
- **Worktree / branch / HEAD:** `D:\dev\afldb-issue-224`, `sonnet/issue-224`, `77456b04`.
- **Commands executed during this planning pass:** repository file reads, `git`-free offline JSON/CSV
  analysis of tracked artefacts, and code search. **No database was contacted. No network fetch was
  made. No import, migration, registration or mutation command was run. Nothing was committed.**
- **Predecessors:** AFLDB-ISSUE-221 (resolved 2026-09-18), AFLDB-ISSUE-222 (resolved 2026-09-19,
  Phase F deferral that created this issue), AFLDB-ISSUE-093 (the frozen 1897–2025 canonical core).
- **Deliberately out of scope:** AFLDB-ISSUE-223 (resolved, test-only), AFLDB-ISSUE-225 (37 non-draft
  Gridley cells), AFLDB-ISSUE-226 (stale `docs/architecture.md`). None of their evidence is used here
  and none of their scope is folded in.
- **Phase 5 executed 2026-09-19** (Sonnet 5, operator read-only approval), against a v3 parent
  correcting Laidley/Capuano offline: 5.1 COMPLETE/PASS, 5.2 and 5.3 BLOCKED by the two toolchain
  scripts' v2-pinned constants. See the Phase 5 execution record after the Phase 5 plan table, and
  **AFLDB-ISSUE-227** (new, tooling baseline, not folded into this issue).

---

## 1. Root-cause summary

**ISSUE-224 is not a defect. It is the cost of a deliberate architectural boundary plus one
never-built rollover stage.** Three established facts compose it.

**1.1 The canonical player register is frozen at season 2025.** The accepted fitzRoy/AFL Tables
snapshot is `full-history-20260902`
(`docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json`):
`requested_range {"from": 1897, "to": 2025}`, `seasons_acquired` 1897..2025 (129 seasons), 131 files,
`identity_observations.rows` 685,473 with `rows_without_url` 0. `AFLDB-ISSUE-093` Stage 9 asserts
`matches_after_accepted_last_season = 0` and 2026 is *deliberately excluded* from that core
(`docs/acquisition/AFLDB-2026-API-ACQUISITION.md:41-45`).

**1.2 Four writers can register an AFL Tables identity, and none of them runs in-season
automatically.** (Corrected **twice**: pass 1 said "only two"; a pass-2 draft said "exactly three".
The plan review then found a fourth — see findings F-224-10 and **F-R02**. The repeated undercount is
itself recorded in §11 as a methodology finding.)

- `tools/migration/import_fitzroy_core.py:2666-2673` (`INSERT INTO players`) and `:2817-2829`
  (`INSERT INTO external_identities`, `source_id='afltables'`,
  `match_method='afltables_profile_url'`, upserted `ON CONFLICT (source_id, external_id) DO UPDATE`
  at `:2822`) — the only routine writer that does both. Its own docstring (`:52`) states
  **"Never applied in-season."**
- `src/db/queries/admin-draft.ts:1492-1502` (`attachAflTablesIdentity`) — a super_admin, one-person-at-
  a-time action. See §3.2.
- `tools/migration/common.py:1327-1341` (`replay_admin_overrides`, AFLDB-ISSUE-160 §8.1) — **not a new
  decision, a replay of an existing one.** During a rebuild it re-creates each admin-created player
  from its durable `data_overrides` record (`INSERT INTO players` `:1267-1297`, zero
  `player_career_stats` row `:1300-1309`, `manual_admin_edit` identity `:1311-1319`) and then
  re-registers that player's attached AFL Tables path with `status='resolved'`,
  `match_method='afltables_profile_url'` — **the same tuple `REGISTRATION_SQL` measures**. It is
  doubly guarded: only when `bound_player_id IS NULL` (`:1326`) and only `WHERE NOT EXISTS` another
  holder of that path (`:1336-1339`).

- `tools/migration/enrich_birth_dates.py:565-577` — **a bulk writer, and the one this plan twice
  missed.** `SOURCE_KEY = "afltables"` (`:78`); it `executemany`-INSERTs
  `status='unique', match_method='afltables_profile_url'` with a non-null `player_id` — *precisely the
  tuple `REGISTRATION_SQL` measures* — for players resolved through `players.legacy_player_id`
  (`:418-421`), **not** through an existing AFL Tables identity. Immediately before that it
  **DELETEs** every `afltables` / `afltables_profile_url` row whose `external_id` is not in the
  asserted set (`:557-563`), making it also the only bulk *deleter* of registrations outside the
  fitzRoy importer. It is dormant on a legacy-free target (a rebuilt database has
  `legacy_player_id IS NULL` throughout, so the asserted population is empty and
  `check_population_drop` check 1 refuses unconditionally, `common.py:158-166`) and it is not in the
  rebuild pipeline (`tools/db/rebuild-test.ts:218` pins the different script
  `enrich_birth_dates_afltables.py`). **Dormant is not absent.** No ISSUE-224 phase invokes it, and
  §5/§6 now say so explicitly.

**Why the replay writer matters to this issue, and why it is reassuring rather than alarming.** It is
the mechanism that makes the §3.2 per-person admin route (Track 2) **durable across a rebuild**: a
person registered through the admin surface is not silently lost the next time the core is rebuilt.
Better still, its `bound_player_id IS NOT NULL` branch (`:1255-1262`) exists precisely to prevent the
collision Track 2 would otherwise create with Track 1 — *"The player ALREADY exists in this database
under their AFL Tables profile, because they debuted and the rebuild created them from the source.
Bind the token onto that row instead of creating a twin."* So a person registered by hand in 2026 and
then legitimately created by the season-2026 rollover ends up as **one** player, not two, by design.

**1.3 The in-season settle path structurally cannot register an identity.**
`deploy/afldb-settle-afltables.sh` runs three steps; only step 3 opens PostgreSQL (script comment
lines 9, 152-153). Step 2 (`import_fitzroy_core.py --require-in-season --emit-observations`) returns
before any DB-writing code is reached — *"Emission complete ... (no database access)"*
(`tools/migration/import_fitzroy_core.py:3480-3481`); its own comment at `:1716-1717` states *"In-season
`continuity` is None and nothing here runs: ... the settle resolves urls through registered
identities."* Step 3 delegates to `src/lib/acquisition/settle-afltables.ts`, which at `:2664-2673`
does:

```
const playerId = refs.playerIdsByUrl.get(projection.url);
if (playerId === undefined) {
  // §17.3: participation is never created from unresolved identity, and a
  // player name never stands in for the url.
  counters.unresolvedIdentityPlayer += 1;
  return null;
}
```

A grep of that file for `INSERT INTO players` / `INSERT INTO external_identities` returns **zero
matches**. This is intentional design, restated in the architecture document
(`docs/acquisition/AFLDB-2026-API-ACQUISITION.md:904-905`): *"A row whose `url` is unknown to AFLDB is
`unresolved_identity` and goes to a human — never an auto-created player."*

**1.3a A third, independent confirmation — from the machine-readable contract itself.**
`tools/rebuild/fitzroy/fitzroy-contract.json`, `profile_url_continuity.in_season_scope`, states the
boundary without reference to either the docstring or the settle code:

> *"Historical (full-history / accepted-baseline / trial) validation and import only. An in-season
> snapshot (`--require-in-season`) is a single live-scraped season, so it cannot contain the continuing
> profile's rows; the settle resolves every url through the identities the rebuild registered, and an
> **unregistered url stays unresolved there — never a new player**."*

The same block's `fail_closed` clause is the reason the boundary exists rather than being an oversight:
the machinery that decides whether a blank-`ID` profile is a genuine debutant or a **renumbered**
profile needs the *continuing* profile's historical rows to be present in the same snapshot, and an
in-season snapshot by definition cannot carry them. Registering in-season would therefore mean
registering without the one check that prevents duplicate players. §5 Phase 1 turns this same clause
into the plan's primary classification discriminator.

**1.4 Therefore the withholding is correct and mechanical.**
`tools/rebuild/draftguru/export_person_bridge.py:351-358` measures registration with:

```sql
SELECT ei.external_id, count(*) AS registered_rows
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
 WHERE ei.player_id IS NOT NULL AND ei.status IN ('unique', 'resolved')
   AND ei.match_method = 'afltables_profile_url'
 GROUP BY ei.external_id
```

Zero rows for an identity ⇒ `withheld.reason = 'target_not_registered'`
(`export_person_bridge.py:442-443`). The `COUNT(*)` (not `COUNT(DISTINCT player_id)`) is deliberate:
comment `:337-350` records that it must mirror `import_draftguru.apply_authority()`'s
`len(candidates) != 1` HALT exactly. **The measurement and the HALT are one contract; neither may be
loosened independently.**

**Root cause, one sentence:** the 2026 season's *matches* reach the database through the settle path
while the 2026 season's *players* cannot, because player registration is owned exclusively by a
full-history fitzRoy import that is frozen at 2025 and forbidden in-season, and the end-of-season
rollover that would extend it (`docs/acquisition/AFLDB-2026-API-ACQUISITION.md:388`, proposed issue F)
has never been opened or built.

---

## 2. Reconciled category table and counts

### 2.1 The population is exactly 94 and identical on both targets

| Fact | Value | Evidence |
|---|---|---|
| Parent v2 admissible pairs | 3,562 | `data/reference/draftguru-person-bridge-20260918-v2.json`, `counts.parent_bridges` |
| `afldb_test` child accepted | 3,468 | `…-v2.afldb_test.json`, `counts.bridges` |
| `afldb_test` child withheld (all reasons) | 1,589 | `counts.withheld` |
| ↳ `U-no-href` | 1,493 | inherited from parent |
| ↳ `different_person_wrong_href` | 2 | inherited from parent (Craig Somerville, David Sullivan) |
| ↳ **`target_not_registered`** | **94** | assigned by `--resolve-against` |
| ↳ `target_ambiguous` | 0 | the only *other* reason `--resolve-against` can assign (`export_person_bridge.py:442-445`: `count == 0` ⇒ `target_not_registered`, `count > 1` ⇒ `target_ambiguous`); every other withheld reason in this file is inherited from the parent's source-evidence vocabulary (`U-page-failed`, `U-inadmissible:*`, `U-no-href`, `collision:*`, `review_failure:*`) |
| `afldb_dev` child, same figures | identical | `…-v2.afldb_dev.json` |
| `target_not_registered` set difference test ∖ dev | **0** | computed |
| `target_not_registered` set difference dev ∖ test | **0** | computed |
| `target_registration.count` on both targets | 13,275 | both child files |

3,468 + 94 = 3,562 reconciles exactly. **The two targets withhold the same 94 identities**, so one
classification and one remediation serve both.

### 2.2 Every one of the 94 is unclassified by the existing tooling

All 94 rows in `docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v2.csv` carry
identically: `base_outcome=target_unregistered`, `population_outcome=insufficient_evidence`,
`population_reason=TARGET_NOT_REGISTERED_NO_EVIDENCE`, `reason_codes=TARGET_NOT_REGISTERED`,
`recommended_disposition=withhold`, `corrected_identity` blank, every `retained_*` column blank,
`ledger_status=none`. The 16 that reached `bridge-validation-verdicts-20260918-v2.csv` additionally
carry `identity_evaluable=False` and `operator_review_required=True`.

**Finding F-224-1 (INFO — reason CORRECTED at review, conclusion unchanged and strengthened).**
An earlier draft of this runbook asserted that the population scanner *short-circuits* on
`target_unregistered` and performs no further classification. **That is wrong, and the truth is better
evidence.** `classify_population_row` (`scan_person_bridge_population.py:342`) does not short-circuit:
for `base_outcome == 'target_unregistered'` it calls `probe_same_person_alternate_identity`
(`:370-371`, defined `:299-335`), a bounded, fail-closed probe that:

- generates **numeric-suffix renumbering candidates** for the captured identity — suffixes 0–19,
  `numbered_candidates` (`:214-218`, `NUMBERED_CANDIDATE_RANGE = range(0, 20)` at `:133`);
- generates **one spelling candidate** from the DraftGuru visible name normalised into AFL Tables
  filename form (`spelling_candidate`, `:221-229`);
- looks each candidate up in the **fitzRoy retained index built from the accepted 1897–2025 snapshot**
  (`base.build_fitzroy_index`, `:509`);
- scores any hit at the full `offline_strong` corroboration bar — surname-suffix match, birth-year
  tolerance, at least one games/debut/span signal, and club overlap for a numeric-suffix candidate
  (`evaluate_candidate`, `:232-246`);
- returns a match **only if exactly one candidate qualifies** (`:333-335`); zero or more-than-one both
  yield `None` — *"never forces an ambiguous result"* (`:300-302`).

A single qualifying candidate would have produced `population_outcome = 'source_discrepancy_same_person'`,
`population_reason = 'ALTERNATE_REGISTERED_IDENTITY_CORROBORATED'` and a populated `corrected_identity`
(`:372-375`).

**It produced none.** Measured directly from the produced artefact in this pass: of the 94 rows,
`corrected_identity` is blank on **94/94** and `population_reason` is
`TARGET_NOT_REGISTERED_NO_EVIDENCE` on **94/94**.

So the conclusion stands for the **scan artefacts** — no tracked *scan* row distinguishes one of the
94 from another — and it rests on a positive result rather than an absence of effort: the renumbering
and spelling hypotheses were mechanically tested for all 94 at the `offline_strong` bar and
corroborated for none.

**But two limits on that statement are essential, and an earlier pass-2 draft stated neither
(F-R04, F-R01).**

1. **The probe's candidate space is bounded** — suffixes 0–19 plus one visible-name spelling, with the
   captured href discarded (`:319`). Non-corroboration inside a bounded space is **not**
   disconfirmation.
2. **The scan artefacts are not the only tracked artefacts.** The AFLDB-ISSUE-222 *ledger entry* names
   two of the 94 explicitly, with their registered paths and player ids (§2.4). "No tracked artefact
   distinguishes them" was true of the CSV and false of the issue record — and the issue record is
   authoritative under CLAUDE.md §5.

Re-running the scanner would still add nothing. But **reading ISSUE-222's own entry adds a great
deal**, and this plan failed to do so until the plan review forced it.

Every category below is derived from DraftGuru-side attributes plus arithmetic, and is marked
**PROVISIONAL** until Phase 1 supplies the discriminating evidence. Nothing in this section may be
treated as established classification.

### 2.3 Provisional categories (100% reconciled to 94)

The discriminator available offline is **DraftGuru career games**. The 2026 AFL Tables season is
proven to run to Round 25, completed 2026-08-23 (`docs/acquisition/AFLDB-2026-API-ACQUISITION.md:209-219`,
P5 at `:880-916`), so no player debuting in 2026 can have more than ~25 career games.

| Cat | Description | Count | Basis | Status |
|---|---|---|---|---|
| **A** | **Consistent with a post-2025 (2026) senior debut.** DraftGuru career games 1–23, first DraftGuru recruitment 2021–2025. | **92** | games ≤ 23 for all 92; recruitment years 2025×60, 2024×14, 2023×14, 2022×2, 2021×2 | PROVISIONAL |
| **B** | **Already registered under a different AFL Tables path.** Not unregistered people at all: the DraftGuru-captured href diverges from the path AFLDB registers them under. **Established, not provisional** — ISSUE-222 names both target paths (§2.4). | **2** | Laidley → `players/D/Dani_Laidley.html` (player 3208); Capuano → `players/M/Mathew_Capuano.html` (player 9198) | **ESTABLISHED as to mechanism**; the two corrected identities still require operator D-9 adjudication |
| | **Total** | **94** | | |

**Category B needs no registration and no 2026 evidence.** It is excluded from Phase 1 entirely and
routed to the parent-correction mechanism of §2.4a. Only **Category A's 92** are an ISSUE-224
registration question.

Requested taxonomy mapped onto the evidence:

| Requested category | Provisional count | Note |
|---|---|---|
| Genuine post-baseline AFL debutants | ≤ 92 (Cat A) | Confirmed only by 2026 `Career.Games` evidence (Phase 1) |
| Valid AFL Tables identities missing from the registration baseline | **0** | Superseded by F-R01: Category B is not "missing from the baseline", it is *present under a different path* |
| **Captured href ≠ registered path, same person (already registered)** | **2 (Cat B), established** | Laidley, Capuano. The v2 parent correction already resolved seven such cases (§2.4a) |
| Profile renumbering / ordinal change | **0 among the current 94** — but **6 such cases existed at v1 and were corrected into v2** | The six numeric-disambiguation cases (§2.4a) are gone from the population precisely because the parent correction fixed them. Among the remaining 94, 5 surface candidates exist (4 DraftGuru URLs with ordinal ≠ `/1` — `jack_dalton/2`, `jack_watkins/2`, `lachlan_smith/4`, `luke_kennedy/2` — plus 1 AFL Tables numeric suffix, `players/J/Jack_Dalton1.html`), none corroborated by the scanner probe |
| Spelling / punctuation / suffix / Unicode | **2 established (Category B)** | Laidley (`Dean`→`Dani`, a public name change) and Capuano (`Matthew`→`Mathew`). Further surface candidates among Category A: Mitch Edwards→`Mitchell_Edwards`, Harry Oliver→`Harrison_Oliver`, Ollie Hannaford→`Oliver_Hannaford`, Cam Nairn→`Cameron_Nairn`, Balyn O'Brien→`Balyn_OBrien`; plus percent-encoded spaces in two DraftGuru URLs (`alex_van%20wyk`, `hussien_el%20achkar`). **ISSUE-222 D4 separately excluded NBSP/encoding as a database-side cause** (0 players with a no-break space) |

> **Correction (F-R04, accepted).** An earlier pass-2 draft called the renumbering and spelling
> categories *"actively disconfirmed against the 1897–2025 register"*. That **overclaims**. The
> scanner probe searches a **bounded** candidate space — suffixes 0–19 of the captured stem
> (`scan_person_bridge_population.py:214-218`) plus **one** candidate built from the DraftGuru visible
> name (`:221-229`), with the captured href itself discarded (`:319`). Neither `Dean`→`Dani` nor
> `Matthew`→`Mathew` lies inside that space, which is exactly why ISSUE-222 records that the probe
> *"correctly declined"* both. **Category B proves the candidate space is incomplete.** The correct
> statement is: *not corroborated within a bounded probe space* — which is not disconfirmation, and
> must not be read as one.
| Identity collision / ambiguity | **0** | `target_ambiguous` count is 0 on both targets; all 94 identity strings are distinct (94 distinct of 94) |
| DraftGuru source errors | 0 established | Cat B is the only place one could hide; the 2 known source-error cases (`different_person_wrong_href`) are a *separate* withheld reason and are **not** part of the 94 |
| Non-players / no valid AFL Tables identity | 0 established | Every one of the 94 has a captured AFL Tables href and non-zero DraftGuru games |

**Finding F-224-2 (INFO).** All 94 captured identity paths pass
`AFLTABLES_PROFILE_PATH_RE = /^players\/[A-Z]\/[A-Za-z0-9_'.-]+\.html$/`
(`src/db/queries/admin-draft.ts:180`) — verified programmatically, 0 failures, 94 distinct. The admin
registration path in §3.2 would not reject any of them on shape.

### 2.3a — Dated evidence addendum (2026-09-19): independent DraftGuru cross-reference audit of Category A's 92

**This is corroborating evidence only. It does NOT satisfy, replace, or substitute for D-1 or Phase 1's
designed discriminator (§5 Phase 1, AFL Tables' own `Career.Games` on the profile's first row). D-1
remains the next formal gate**, precisely because this addendum's evidence is DraftGuru/club-name based
rather than the source-stable, name-free test Phase 1 was deliberately built around
(`AFLDB-2026-API-ACQUISITION.md`'s "never match on name" principle, restated at runbook §5's
discriminator table). Absence of anomalies in a name/club cross-reference is not the same evidence class
as AFL Tables' own career-game-number continuity test, and must not be read as satisfying it.

**Source (operator-produced, outside this session, reviewed here read-only):**
`artifacts/issue224-2026-debutants-audit.csv` (93 lines: header + 92 rows — count independently verified),
`artifacts/issue224-2026-debutants-draftguru-enriched.csv` (93 lines, same population plus DraftGuru
enrichment columns), `artifacts/issue224-2026-debutants-draftguru-events.csv` (96 lines: header + 95
DraftGuru recruitment/draft events across the same 92 people). Spot-checked against the already-tracked
Hussien El Achkar example (issues.md's ISSUE-224 entry, "Strong example" paragraph): all fields agree
exactly (2025 National Draft pick 53, Essendon, DraftGuru 9 games/10 goals) plus new corroboration —
AFL Tables' own 2026-08-08 snapshot also shows 9 career games (exact match to DraftGuru), current 2026
club Essendon matches the DraftGuru-recorded draft club, age 18yr/171cm at draft.

**Findings across the 92 (independently spot-checked, not re-derived in full this pass):**

| Measure | Result |
|---|---|
| Population | 92 unique AFL Tables identities, 92 DraftGuru people, 95 DraftGuru recruitment/draft events total (3 people have 2 events each: Hugo Hall-Kahan, Patrick Retschko, Wade Derksen) |
| Club coverage | All 18 AFL clubs represented; after normalising club aliases (Brisbane→Brisbane Lions, GWS→Greater Western Sydney), **92/92** current 2026 clubs match a DraftGuru-recorded recruitment club |
| First DraftGuru recruitment year | 2021: 2, 2022: 2, 2023: 14, 2024: 14, 2025: 60 |
| DraftGuru event type (of 95) | National Draft 55, Mid-Season 21, Post-Draft 13, Rookie 3, Pre-Draft 2, Trade 1 |
| DraftGuru games vs. the newer AFL Tables snapshot | 75 exact match, 10 AFL Tables ahead by 1, 7 AFL Tables ahead by 2, **0 DraftGuru ahead** (consistent with reporting lag, not a data conflict — AFL Tables is always the same or further along, never behind) |
| Games played (2026-08-08 AFL Tables snapshot) | average ≈9, median 8, only 3 players on 1 game, 37 on 10+ games, 9 on 20+ games, maximum 25 |

**Assessment.** This independently strengthens — but does not newly establish — the runbook's existing
**PROVISIONAL** Category A classification (§2.3): all 92 read as coherent, real people with sane
recruitment-to-2026-club continuity and a games trajectory consistent with a single 2026 season, and the
"0 DraftGuru ahead" pattern is exactly what a genuine post-baseline debutant population should show
against a later, more complete source. No anomaly surfaced that would suggest a numbering, spelling, or
non-player case hiding inside the 92 (Category B, §2.4, remains exactly the 2 people already identified
by other means). **Root cause (§1) is unchanged.** This addendum upgrades confidence in Category A's
classification; it does not resolve D-1, does not authorise Phase 1, Phase 6, or any registration, and
creates no new operator decision beyond those already listed in §8.

### 2.4 Category B — the two cases that contradict the post-baseline story

| Person | DraftGuru URL | Captured identity | DG games | Title birth year | First DG recruitment |
|---|---|---|---|---|---|
| Dean Laidley | `players/dean_laidley/1` | `players/D/Dean_Laidley.html` | **99** | 1967 | **(none)** |
| Matthew Capuano | `players/matthew_capuano/1` | `players/M/Matthew_Capuano.html` | **107** | 1975 | 1992 |

Every other one of the 94 has 1–23 games. These two cannot be 2026 debutants.

> **RETRACTION (plan review, finding F-R01 — verified and accepted).** An earlier draft of this
> runbook stated that *"Dean Laidley appears nowhere in the ISSUE-222 record"* and that Category B was
> unexplained. **Both statements are false**, and the false novelty claim was propagated into
> `issues.md`. It has been corrected in both places. The correction is recorded rather than quietly
> removed, because the plan's own standard (F-224-13) is that a claim which cannot be pointed at is
> not a finding.

**What the ISSUE-222 record actually says** (`issues.md`, within the AFLDB-ISSUE-222 entry, the
`target_not_registered` mechanism paragraph):

> *"2 are spelling/name-change cases, found by an **untracked** fuzzy name search in `players` and
> **not fully proven by retained tracked evidence**: Dean Laidley's bridge target
> `players/D/Dean_Laidley.html` has 0 rows in `external_identities`, but **player 3208 is registered
> under `players/D/Dani_Laidley.html`** (a well-documented public name change); Matthew Capuano's
> bridge target similarly has 0 rows, but **player 9198 is registered under
> `players/M/Mathew_Capuano.html`** (a one-letter spelling variant). Both are correctly withheld, not
> mis-linked."*

**This changes Category B's nature completely.** These two are **not unregistered people**. They are
**already-registered players whose DraftGuru-captured href differs from the path AFLDB registers them
under**. They are therefore not registration candidates at all — no player needs creating, no identity
needs registering — and routing them to a registration phase, or to H1.2's "source error" verdict,
would be wrong in both directions.

### 2.4a The v1 → v2 reconciliation proves the mechanism, and names the remedy

ISSUE-222 investigated **101** `target_not_registered` paths at v1 and named nine cases by mechanism:
six AFL Tables numeric-disambiguation mismatches (`Aaron_Black`, `Alwyn_Davey`, `Joel_Smith`,
`Josh_Smith`, `Sam_Butler`, `Tom_Murphy`) and three spelling/name-change cases (Laidley, Capuano, and
`stephen_schwerdt/1` → registered `players/S/Steven_Schwerdt.html`).

The current v2 population is **94**. Measured directly in this pass against the 94: **none of the six
numeric-disambiguation cases and not Schwerdt remain — only Laidley and Capuano do.**

**101 − 94 = 7 = the six numeric cases + Schwerdt.** The v2 parent correction already fixed seven of
the nine by exactly the mechanism that fits: a **corrected identity on the parent source evidence**
(`build_person_bridge_v2.py`'s `ACTION_CORRECTED` / `corrected_identity_candidate` path; precedent row
`bridge-v2-parent-20260918-v1.csv:2`, `Aaron_Black.html → Aaron_Black0.html`, `corrected`,
`approve_manual_curation`). **Laidley and Capuano are the two that were not corrected**, because
ISSUE-222 recorded their evidence as untracked and not D-9-proven.

So the remedy for Category B is already built, already used seven times, and is **not** a
registration: it is a parent-evidence correction whose only open question is operator adjudication of
the two candidate identities against the D-9 evidence standard.

**Finding F-224-3 (superseded by F-R01).** The finding that the 94 are not homogeneous stands and is
the most important structural fact in this section. Its explanation was wrong.

---

## 3. Existing registration and authority flow

### 3.1 The canonical authority — `import_fitzroy_core.py`

| Aspect | Established behaviour | Evidence |
|---|---|---|
| Input | An accepted, versioned, immutable, manifest-verified offline fitzRoy snapshot; never a live scrape | docstring `:1-32` |
| In-season | **Never applied in-season** | docstring `:52` |
| Identity key | The normalised AFL Tables profile URL path only; **never a name** | `:36-42` |
| "Already registered" lookup | `existing_by_url` — `external_identities` rows for source `afltables`, `match_method='afltables_profile_url'`, status `unique`/`resolved` | `:2602-2608` |
| Creates players | Yes — `INSERT INTO players` | `:2666-2673` |
| Registers identities | Yes — one `external_identities` row **per URL**, upserted `ON CONFLICT (source_id, external_id) DO UPDATE` | `:2817-2829`, the `ON CONFLICT` clause at `:2822` |
| Conflicting owner | Explicit check; raises and rolls back | `:2785-2796` (raise at `:2791-2796`) |
| D-2 guard (anti-duplicate) | Before any new-player INSERT, compares against admin-created players still awaiting an AFL Tables identity (`MANUAL_CANDIDATES_SQL` `:2497-2509`); verdict `manual_insert_verdict` `:2512-2529` — unknown DOB either side ⇒ refuse; any DOB match ⇒ refuse; all DOBs differ ⇒ allow. Refusal raises `RuntimeError` | `:2456-2577` |
| Transaction | Whole body inside `import_batch(...)`; any `RuntimeError` rolls back the **entire** players batch | `:2599`, `:2488-2495` |
| Delete safety | `check_population_drop` before any DELETE | `:2804-2811` |
| Registered-set size for the accepted baseline | `data/reference/fitzroy-accepted-baselines.json` records `players 13275` / `distinct_urls 13275` for `full-history-20260902`, later amended `players 13275 -> 13271` (four 2025 profiles folded under ISSUE-136 continuity) while `distinct_urls` stays 13,275 | `:160`, `:178`, `:330-383` |

`target_registration.count = 13275` in both deployment children matches that manifest exactly
(verified directly from both child files in pass 2).

**One inherited figure is deliberately NOT re-verified here, and it matters.** AFLDB-ISSUE-222's
handoff §10.3 measured that **0 of the 94 withheld paths appear in the accepted `full-history-20260902`
13,275-URL set**. That measurement requires the accepted snapshot *bytes*, which live outside the
repository (the repository holds only the manifest), so it could not be reproduced in this
repository-only planning pass and is carried on ISSUE-222's authority, not asserted as this plan's own
evidence. **Phase 1.4 re-derives it independently**, and that re-derivation is a gate: if the accepted
set turns out to contain any of the 94, the root-cause analysis in §1 is wrong for that person and
Phase 1 HALTs rather than proceeding. This is the single most consequential inherited fact in the
plan, which is why it is named rather than absorbed.

### 3.2 The reviewed per-person authority — the super_admin admin path

**This is the pivotal verified fact of this plan.** `attachAflTablesIdentity`
(`src/db/queries/admin-draft.ts:1438-1520`) writes, at `:1492-1502`:

```
INSERT INTO external_identities
      (source_id, external_id, external_name, external_url, player_id,
       status, candidate_count, match_method, notes)
VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
        ${path}, ${player.displayName},
        ${`https://afltables.com/afl/stats/${path}`}, ${player.id},
        'resolved', 0, 'afltables_profile_url', …)
```

`source.key='afltables'` ∧ `player_id IS NOT NULL` ∧ `status='resolved'` ∧
`match_method='afltables_profile_url'` — **exactly the tuple `REGISTRATION_SQL`
(`export_person_bridge.py:351-358`) requires.** A person registered this way is seen as registered
exactly once by a subsequent `--resolve-against`, and `apply_authority()`'s `len(candidates) != 1`
HALT is satisfied. The route is real, not assumed.

Its guards, all verified:

| Guard | Behaviour | Evidence |
|---|---|---|
| Path shape | `AFLTABLES_PROFILE_PATH_RE` | `:180`, `:1442-1445` |
| J-16 tracked continuity | Refuses any path named by a tracked ISSUE-136 profile-continuity rule — "changed in the repository contract, never from the admin surface" | `:1446-1451` |
| Manual-player-only | `readManualPlayerToken` must return a token; a source-owned player is refused | `:1461-1466` |
| J-15 collision | Refuses if the path already belongs to another player ("that is a merge") | `:1477-1483` |
| Duplicate | Refuses if this player already holds an AFL Tables identity | `:1484-1490` |
| Audit mandatory | If the `data_overrides` UPDATE affects 0 rows, throws `RollbackRefusal` and rolls the whole attach back rather than attach without an audit row | `:1515-1521` |
| Data edit record | `recordDataEdit(... fieldGroup: 'source_identity' ...)` | `:1523-1529` |
| Authorisation | `requireCapability('data.draft.edit')` = `SUPER_ADMIN_ONLY` | `src/app/admin/draft/actions.ts:422`, `src/lib/auth/capabilities.ts:45,104` |
| Row lock | `SELECT ... FOR UPDATE` on the player | `:1456-1458` |

The player must first exist, created through the single player-creation primitive
`createPlayerInTransaction` (`src/db/queries/players.ts:272-308`), which is `data.dataEditor` =
`SUPER_ADMIN_ONLY` (`capabilities.ts:38,80`), requires a non-null `adminUserId` (`:318-320`), and in
the **same transaction** mints a `manual_admin_edit` identity (`:385-393`) plus a `data_overrides`
audit row. The design comment at `admin-draft.ts:1432-1436` states the intent explicitly: *"Attaching
FIRST is what makes the future safe: the very next settle resolves the debutant's stats onto this
player, and the next operator fitzRoy import UPDATEs this player instead of inserting a second one."*

### 3.3 The ISSUE-092 population-drop gate (mechanic finding F-001, resolved here)

`docs/acquisition/AFLDB-2026-API-ACQUISITION.md:311/461` names the gate but never defines it. The
definition is `tools/migration/common.py:129-184`, `check_population_drop`, docstring *"Fail-closed
population-sanity gate for authoritative reconciliation deletes (AFLDB-ISSUE-092 Sec 4)"* —
Check 1 (`:158-166`): asserting an empty population against existing rows is refused
**unconditionally, not bypassable**; Check 2 (`:167-184`): a drop beyond
`POPULATION_DROP_THRESHOLD` is refused unless the caller passes an explicit per-invocation
acknowledgement, which is then reported via `reporter.warn`. (Line range corrected at review; an
earlier draft said `:129-159`, which cuts off the whole of Check 2.) It governs
**deletes**, not additive registration, so it is not the operative safeguard for ISSUE-224 — but it is
implemented, current, and already wired into `import_fitzroy_core.py:2804-2811`. **F-001 is resolved,
downgraded to INFO, and creates no work.**

### 3.4 The complete writer enumeration

**Corrected at review (findings F-224-10, F-224-11).** An earlier draft of this runbook asserted a
shorter list and mischaracterised two entries. The enumeration below was re-derived repo-wide by
exhaustive grep of `INSERT INTO players`, `INSERT INTO external_identities` and
`UPDATE external_identities` across `src/`, `tools/` and `src/db/migrations/`, with every non-test hit
read individually. `src/db/migrations/**` contains **zero** such writes (DDL only).

**Writers that can register an AFL Tables identity — three, all named in §1.2.**

**Writers that create a `players` row but can NEVER register an AFL Tables identity — three:**

| Path | What it creates | Why it cannot register an `afltables` identity |
|---|---|---|
| `src/db/queries/players.ts:309-…` (`createPlayerInTransaction`, docblock `:272-308`) | The canonical admin player-creation primitive; mints a `manual_admin_edit` identity in the same transaction (`:385-393`) | Writes `manual_admin_edit` only. An AFL Tables path is attached afterwards, separately, by §3.2's audited action |
| `tools/rebuild/draftguru/import_draftguru.py:646-686` (`seed_player`) | A **minimal zero-game canonical player shell** — *"Only for a ledger decision whose target is a DraftGuru identity — a person the fitzRoy import will never create because they played no senior football"* (`:647-650`) | It writes `players` and maps the person to the **draftguru** source only; it writes no `external_identities` row at all, and certainly none for `afltables` |
| `tools/migration/common.py:1267-1297` (`replay_admin_overrides`) | A replayed admin player | It *can* also register an AFL Tables path — which is why it is counted in §1.2, not here. Listed in both places deliberately |

**Writers that touch `external_identities` but never `players` and never register an AFL Tables path:**
`tools/migration/enrich_birth_dates.py:565-577` (upserts only for already-resolved `player_id`s);
`src/db/queries/admin-draft.ts:1325-1335` (`manual_admin_edit` only);
`src/db/queries/players.ts:385-393` (`manual_admin_edit` only);
`tools/rebuild/draftguru/import_draftguru.py:1183-1195` (`IDENTITY_LINK_UPDATE_SQL`, a bulk
`UPDATE … FROM unnest(…)` scoped `WHERE t.source_id = %s` bound to the **draftguru** source).

**`seed_player` is the one path this plan must actively fence off — and it does.** It is reached only
from `apply_authority()` step 1, on an **explicit human ledger decision** whose target is a
DraftGuru-only identity (`:781-787`); bridge evidence never reaches it, because step 2 raises
`ImportFailure` on `len(candidates) != 1` (`:802-805`) instead. But `seeds_allowed` defaults to
**True** in the importer's full mode (`not args.no_seed`, `:1420`) and is forced False only under
`--link-only` (`:1299`) — so the protection is *modal*, not absolute. Every ISSUE-224 phase that runs
this importer therefore specifies `--link-only`, and Phase 6 carries an explicit HALT on a non-zero
`seeded` counter. This is exactly how ISSUE-222's DEV import behaved in practice: **seeded players 0**.

**No bulk AFL Tables registration path exists anywhere.** All three registering writers are either a
full-history import from an accepted snapshot, a one-person-at-a-time audited admin action, or a
replay of an already-durable admin record.

---

## 4. Recommended solution and rejected alternatives

### 4.1 Recommended — a two-track solution, tracks strictly ordered

**Track 1 (primary, durable, correct): execute the end-of-season rollover for season 2026.**
This is the architecture's own designed answer
(`docs/acquisition/AFLDB-2026-API-ACQUISITION.md:388`; §5 "Rollover (Dec–Feb) — season promotion
[DECISION]"): once the 2026 season completes, re-acquire it through the standard full-history fitzRoy
path, extend `data/reference/fitzroy-accepted-baselines.json`, supersede the in-season provenance,
advance `seasons.json.in_progress_seasons`, and re-point the Stage-9
`matches_after_accepted_last_season` gate. Running `import_fitzroy_core.py` against that new accepted
snapshot registers every genuine 2026 debutant **with canonical stat evidence behind each one**, under
the D-2 guard, the identity-conflict check and the ISSUE-136 continuity machinery, with no new tool
and no new trust. Then re-run `export_person_bridge.py --resolve-against` per target and import the
delta.

Track 1's cost: it cannot run before the 2026 season completes. **Today is 2026-09-19; AFL Tables
carries the season to Round 25, completed 2026-08-23 — finals are in progress.** Track 1 is therefore
**not executable now**, and its earliest date is an operator decision (§8, D-3).

**Track 2 (interim, reviewed, per-person, optional): the super_admin admin path of §3.2**, used only
for a small operator-chosen subset the operator needs linked before rollover, and only for people whose
Phase 1 evidence is unambiguous. Each person is two super_admin actions
(`createPlayerAction` → `attachAflTablesIdentityAction`), each audited, each individually reversible.

**This plan does NOT recommend Track 2 for all 94.** 94 people × 2 manual actions is a large,
error-prone manual surface whose only benefit is earlier draft-link coverage on a test/dev database, and
whose D-2 interaction with the eventual Track 1 import must be individually correct for each person.
The recommendation is: **classify now (Phases 1–3), then wait for Track 1**, with Track 2 held in
reserve for a named subset if the operator requires it.

### 4.2 Rejected alternatives

| # | Alternative | Why rejected |
|---|---|---|
| R1 | Hand-edit a deployment child to admit the 94 | Explicitly forbidden by the ISSUE-222 constraint; `validate_person_bridge_child.py` pins the child by `--expect-sha256` under `--target dev` (`:760-763`) and by a fixed default hash under `test`; and the importer would HALT anyway at `apply_authority()` `:801-805` because the identity still resolves to 0 canonical players. |
| R2 | Relax / flag-off `apply_authority()`'s `len(candidates) != 1` HALT | **No such flag exists** — the full argparse surface (`import_draftguru.py:1526-1552`) has no `--skip-*`/`--force`/`--ignore-*`. The HALT is the fail-closed contract and is not to be changed (ISSUE-222 constraint). |
| R3 | Build a bulk tool that writes `external_identities(afltables)` rows for the 94 directly | Violates *"a new player is always a human decision"* (`AFLDB-2026-API-ACQUISITION.md:311`) and bypasses `createPlayerInTransaction`'s single-writer discipline (`players.ts:272-308`), the `data_overrides` audit requirement and the D-2 guard. It would create 94 player shells with **no canonical statistical evidence** behind them — exactly the failure mode the architecture is built to prevent. |
| R4 | Loosen `REGISTRATION_SQL` (accept `unmatched`, or a NULL `player_id`, or `COUNT(DISTINCT player_id)`) | `export_person_bridge.py:337-350` records that the predicate must mirror `apply_authority()` exactly. Loosening the exporter moves the failure from a clean export-time withholding to an import-time HALT — strictly worse. |
| R5 | Register from the settle's `unresolvedIdentityPlayer` observations | `settle-afltables.ts` contains no player-creation or identity-creation code at all, and its own §17.3 rule forbids it (`:2664-2673`). |
| R6 | Run `import_fitzroy_core.py` in-season against a partial 2026 snapshot to register early | Docstring `:52` "Never applied in-season"; `:1716-1717` confirms the continuity machinery is inert in-season. This would register 2026 debutants without the continuity/renumbering rules that the full-history path applies, and is the single most likely way to create duplicate players. |
| R7 | Treat the 94 as one homogeneous "2026 debutants" set and remediate in one action | Refuted by §2.4: two of the 94 provably are not. |

---

## 5. Phased implementation and validation plan

Every phase below is **proposed, not authorised**. Each names its own approval requirement. Production
is out of scope in every phase; no phase may target production, and no phase may use SSH.

### Phase 1 — Evidence acquisition (NETWORK, no database) — **requires operator approval**

**Purpose:** obtain the single discriminating fact the repository does not hold — which of the 94
captured AFL Tables identity paths appear in AFL Tables' **2026** player-statistics URL set, and which
appear in the accepted **1897–2025** snapshot under a different URL.

> ## ⚠ PHASE 1 REQUIRES REVISION BEFORE IT IS PROPOSED TO THE OPERATOR (finding F-R03, HIGH, verified)
>
> **The evidence this phase proposes to acquire has already been acquired, twice, and is
> contract-pinned.** Two tracked `in_season_partial` manifests for season 2026 exist in the repository:
>
> | Manifest | Extracted | `player_stats` rows | `results` rows | `Career.Games` column | `rows_without_url` |
> |---|---|---|---|---|---|
> | `docs/rebuild-manifests/afltables_fitzroy_core/issue129-t7-20260903.json` | **2026-09-03** | **9,614** | 209 | **present** | 0 |
> | `docs/rebuild-manifests/afltables_fitzroy_core/issue099-t8-20260829.json` | 2026-08-29 | 9,522 | 207 | present | 0 |
>
> Both carry `acquisition_kind: in_season_partial`, `requested_range {from: 2026, to: 2026}`, and
> per-file SHA-256 hashes. The later one covers the complete home-and-away season and **already
> carries the exact `Career.Games` column this plan's discriminator needs.**
>
> **Consequence:** §8's D-1 as originally worded — *"without it the 94 cannot be classified at
> all"* — is **false**, and asking the operator to authorise a network acquisition as the first step
> asks for something the repository already holds. A plan that re-acquires a contract-pinned artefact
> is the exact pattern the immutability rules exist to prevent.
>
> **Revised Phase 1 shape (NOT yet elaborated — this is the operator's call, see D-1):**
> **(a)** re-verify the `issue129-t7-20260903` bytes against its manifest hashes; **(b)** classify
> Category A's 92 against it on `Career.Games`; **(c)** a fresh finals-inclusive acquisition becomes a
> *conditional* step, justified only for persons absent from a snapshot that predates the 2026 finals
> (extracted 2026-09-03; finals began after). **(d)** Step 1.4 is dropped — AFLDB-ISSUE-222 already
> measured, hash-verified 131/131, that 0 of these paths appear in the accepted 1897–2025 URL set.
>
> **Caveat the operator must resolve:** the snapshot *bytes* live under the gitignored
> `data/sources/afltables/fitzroy_core/<label>/` of the **main checkout**, not this worktree, and
> their presence could not be confirmed from here without a command (§9). If the bytes are gone, (c)
> becomes the primary path and D-1 reverts to its original form.
>
> The text below is the **superseded** acquisition-first design, retained so the reviewer's finding
> and the correction are both auditable.

**The acquisition is a tracked, contract-governed act with its own kind — it is NOT an ad hoc scrape,
and NOT a core snapshot.** `fitzroy-contract.json`'s `in_season` block (AFLDB-ISSUE-099) defines
`acquisition_kind = "in_season_partial"` as a third kind with its own adjudicator. Season 2026 is
already declared in progress (`data/reference/seasons.json:9`, `"in_progress_seasons": [2026]`), which
is the precondition `acquire_core.R` enforces at `:228-232`.

| Step | Action | Target | Writes |
|---|---|---|---|
| 1.1 | `Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label <new-in-season-label> --from 2026 --to 2026 --in-season` — produces an `in_season_partial` snapshot plus a SHA-256 manifest under `docs/rebuild-manifests/afltables_fitzroy_core/`. Datasets are fixed by the contract to `player_stats,results`; `player_details` and `ladder` are **refused** in-season (`acquire_core.R:243-249`) | none (files only) | new snapshot files + manifest, no DB |
| 1.2 | `python tools/migration/import_fitzroy_core.py --validate-only --require-in-season --label <label>` — the contract's own declared `verdict_authority`. **DB-free**: it re-derives all twelve `in_season.completeness_gates` from the contract and the artefacts on disk. **`--label` is mandatory** (`:3250-3251`, `required=True`); an earlier draft omitted it and would have failed at argparse (F-R06) | none | nothing; verdict only |
| 1.3 | Extract, per `player_stats` row, the triple **(`url`, `ID`, career-game number)** for the 2026 season (offline) | none | offline artefact only |
| 1.4 | Extract the distinct `url` set from the **already-accepted** `full-history-20260902` snapshot bytes (the operator's retained copy; the repository holds only the manifest) | none | offline artefact only |
| 1.5 | Classify each of the 94 against 1.3 and 1.4 (see the discriminator below) | none | offline artefact only |

**The discriminator — already defined by the contract, not invented here.**
`profile_url_continuity.fail_closed` and its `not_a_rule` precedent give a binary, source-stable test
that does not depend on names at all:

> *"A blank-`ID` profile whose first snapshot row is **not career game 1**, and which no rule here
> names, is refused before any player is seeded."* … *"a blank-`ID` profile that debuts at career game
> 1 is a genuine new player (Billy Wilson, `players/B/Billy_Wilson2.html`, 2025 — deliberately NO
> rule)."*

So, for each of the 94 found in the 2026 set:

| First 2026 row's career-game number | Meaning | Route |
|---|---|---|
| **= 1** | Genuine post-baseline debutant. AFL Tables itself asserts no earlier appearance. | Category A confirmed. Registered automatically and correctly by the Track 1 rollover; **no continuity rule needed and none may be written** |
| **> 1** | The footballer has earlier appearances under a **different** profile: a renumbering. | **Not an ISSUE-224 registration.** Requires a reviewed `profile_url_continuity` rule under the ISSUE-136 contract, binding the continuing profile's ID/last season/last career game and the renumbered profile's first career game. HALT H1.3 |
| **present, but `Career.Games` blank** | Undecidable on this evidence. | **Phase 2 `unresolved` bucket**, excluded from every later phase. Added at review (F-R07); the earlier draft had no bucket for this and would have reported a complete classification while silently dropping such a person |
| **absent from the 2026 set** | The person did not play senior AFL in 2026 up to the snapshot's extraction date. | HALT H1.1 — not a debutant on this evidence. **Note the snapshot's date**: absence from a 2026-09-03 snapshot does not exclude a finals debut |

**"First row" has a defined meaning, and it is the importer's, not the file's.**
`import_fitzroy_core.py:1674-1678` builds each appearance as
`(season, match_date, to_int(row["Career.Games"]))` and takes the minimum by `(season, match_date)` —
**not** by position in the file. A blank `Career.Games` yields `None` there. Phase 1 must order
identically; a file-order "first row" can mis-bucket a mid-season row (F-R07).

**The datum exists and is already consumed by the importer — this is not a new measurement.** AFL
Tables publishes its own running career-game counter, and fitzRoy carries it as the `Career.Games`
column:

- `import_fitzroy_core.py:228` lists `"Career.Games"` among the required `player_stats` columns;
- `:1203` describes it as *"AFL Tables' own running"* counter, keyed with `(season, match_date)`;
- `:1676` reads it per row — `appearance = (season, match_date, to_int(row["Career.Games"]))`;
- `:1422-1424` enforces `renumbered_first_career_game == continuing_last_career_game + 1` on every
  continuity rule, and `:1823-1827` refuses a rule whose bound career-game boundary the snapshot does
  not reproduce;
- `:50-51` states the rule this plan uses, in the importer's own words: *"A blank-ID URL whose first
  row is not career game 1 and which no rule names is refused; a blank-ID URL that debuts at career
  game 1 is a genuine new player"*;
- `:1856` states why it is the right discriminator: *"own `Career.Games` on the profile's first row
  separates the two without any name"* evidence.

**Why this matters more than mere URL presence.** Presence in the 2026 URL set proves only that
*somebody* played under that URL. The career-game number is what separates a genuine debutant from a
renumbered veteran, and it is the exact fact `import_fitzroy_core.py` will itself demand at rollover
(`:1821-1827`). Classifying on it now means Phase 1 **predicts the rollover's verdict** instead of
discovering it at Phase 6, when a database is involved.

**HALT H1.5 — a missing `Career.Games` is a HALT, never an assumption.** The importer itself refuses
when the column is not recorded on the rows it needs (`:1821-1822`, *"Career.Games is not recorded on
the boundary rows"*). If any of the 94 appears in the 2026 set with a null or absent `Career.Games`,
that person is moved to Phase 2's explicit `unresolved` bucket and excluded from every later phase.
Neither a row count nor a debut date may be substituted for it.

**Expected counts — extract on `url`, never on `ID`.** The in-season contract's
`identity_requirement` sets `required_columns: ["url"]` and `enrichment_columns: ["ID"]`, with the
rule *"every player_stats row must carry a non-empty url … identity is never inferred from a name"*.
Probe P5 (2026-08-23) measured **663 distinct `(ID, url)` pairs, 1:1**, *plus* **82 rows across 5
further profile URLs carrying no `ID` at all** — so the 2026 distinct-**URL** count at that date was
**668**, not 663, and a fresh acquisition including finals will exceed it.
**An extraction keyed on `ID` would silently lose exactly the blank-`ID` rows that matter most here** —
the debutants and renumbered profiles are disproportionately the blank-`ID` population. This is a
correction to an earlier draft of this plan, which stated 663.

**No contradiction with AFLDB-ISSUE-222 §9.** That issue's standing rule — *"`target_unregistered`
rows get continued withholding and NO network fetch"* — governs **per-person residual href fetches
during ISSUE-222's own Phase 3 review**. Phase 1 here is a **season-level, contract-governed,
manifest-hashed acquisition of an already-tracked source**, adjudicated by the contract's declared
verdict authority. It fetches nothing per person and re-opens no ISSUE-222 verdict; every one of those
`agree` verdicts remains what §9 says it is — a terminal deployment status, not an identity
contradiction.

**The Phase 1 artefact structurally cannot become a registration source.** `in_season.never_admissible_for`
names both gates explicitly: an `in_season_partial` snapshot must be refused by `--require-full-history`
and by `--require-accepted-baseline`, and *"it can never be accepted as a rebuild baseline"*. Phase 1
therefore cannot be escalated into Phase 6 by accident or by pressure; registering from it is not a
policy we decline, it is a path the toolchain refuses.

**Immutable hashes.** 1.1 must record the acquisition manifest's own SHA-256 and every file hash, in
the tracked `docs/rebuild-manifests/afltables_fitzroy_core/` shape, and 1.3 must re-verify the accepted
`full-history-20260902` bytes against the 131 file hashes already recorded in
`docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json`. **If any accepted file hash
fails to reproduce, HALT — the retained copy is not the accepted bytes.**

**Expected counts.** (Stale duplicate corrected at review, F-R11 — the authoritative figure is the
**668** derived above, not 663.) P5 (`AFLDB-2026-API-ACQUISITION.md:880-916`) measured the 2026
player-stats frame at 9,522 × 81 as at 2026-08-23: **663 distinct `(ID, url)` pairs plus 5 URLs with no
`ID` = 668 distinct URLs.** The pinned `issue129-t7-20260903` snapshot (9,614 rows) is larger still,
and a finals-inclusive acquisition larger again. **Expected result: Category A's 92 appear in the 2026
set, each with a first-appearance `Career.Games` of 1.**

**HALTs.**
- **H1.1** If any Category A person is **absent** from the 2026 set: the "2026 debutant" hypothesis is
  unsupported *for that snapshot's date range*. HALT and reclassify; do not register. Check the
  snapshot's extraction date before concluding anything — a finals debutant is absent from a
  2026-09-03 snapshot for an innocent reason.
- **H1.2** *(rewritten at review — F-R01.)* **Category B is excluded from Phase 1 entirely**, so H1.2
  no longer applies to it. The earlier form of this HALT would have classified Laidley and Capuano —
  two **already-registered** players — as `different_person_wrong_href` source errors, and Phase 4
  would then have regenerated the parent with a false withholding reason for two real players. H1.2 is
  retained only for a Category A person found in **neither** the 2026 set nor the accepted set, which
  is a genuine source-evidence question.
- **H1.3** *(split at review — F-R05.)* Two different situations were conflated:
  - **(i) Two AFL Tables profiles of one footballer, both present in the snapshot, with career-game
    continuity** (`renumbered_first_career_game == continuing_last_career_game + 1`) → a genuine
    AFLDB-ISSUE-136 `profile_url_continuity` matter. HALT and route there.
  - **(ii) One AFL Tables profile whose path simply differs from the DraftGuru-captured href** (the
    Laidley / Capuano / Schwerdt shape) → **not** a continuity rule; no rule can be written for it,
    because there is no second profile to bind. This is a **parent-evidence correction** (§2.4a), and
    `attachAflTablesIdentity`'s J-16 guard is irrelevant to it.
  Conflating the two would either stall (no writable rule) or produce a bogus continuity rule.
- **H1.4** If the 2026 set contains an identity resolving to **more than one** DraftGuru person, HALT:
  that is a collision, not a registration.
- **H1.5** A missing/blank `Career.Games` → Phase 2 `unresolved`, never an assumption (see above).

**Rollback.** None needed; nothing is written but files.

**Verification.** The classification must reconcile to exactly **92** Category A rows, each in exactly
one bucket, with Category B's 2 accounted for separately under §2.4a — 92 + 2 = 94.

**Approval required:** operator authorisation to run a network acquisition and to read the retained
accepted-snapshot bytes from outside the repository boundary. **Not granted by this plan.**

### Phase 2 — Population classification (fully offline, no database, no network)

Reclassify all 94 from Phase 1's diff into the final taxonomy of §2.3, with **one row per person and
one bucket per row**, published as a tracked artefact alongside the existing scan artefacts. This phase
must **not** reuse `population_reason=TARGET_NOT_REGISTERED_NO_EVIDENCE`; every row gets a real reason.

- Reconciliation gate: bucket counts sum to 94, no person in two buckets, no bucket empty-by-accident.
- Determinism gate: the artefact carries a `rows_sha256` in the style of
  `scan_person_bridge_population.py` (`:1-68`).
- HALT: any person Phase 1 leaves ambiguous stays in an explicit `unresolved` bucket and is **excluded
  from every later phase** rather than guessed.

### Phase 3 — Reviewed registration decisions (offline artefact, operator-authored)

For each person Phase 2 places in a registerable bucket, the operator records a decision: `register`,
`defer-to-rollover`, `route-to-ISSUE-136`, `route-to-parent-evidence-correction`, or `reject`, with a
verbatim justification and the evidence reference. Shape follows the existing
`docs/rebuild-manifests/draftguru/bridge-operator-verdicts-*.json` pattern, including a
`decided_utc` per row and a file-level SHA-256.

- **No decision file, no registration.** Phase 6 reads only this artefact.
- The existing `data/reference/draftguru-link-decisions.json` ledger and the live
  `player_link_resolutions` table are **human authority and outrank everything**
  (`import_draftguru.py:810-818`, `AFLDB-2026-API-ACQUISITION.md:341-343`). Phase 3 must not contradict
  either; a contradiction HALTs.

### Phase 4 — Offline artefact generation (no database)

Only if Phase 2 finds Category B / source-error cases: correct the **parent source evidence** through
its own tracked generator (`build_person_bridge_v2.py`, DB-free, `:61`), producing a **new parent with
a new SHA-256** and a reconciliation report against `ad25d965…`. Never edit a child; never edit a
parent in place.

- HALT: any parent regeneration that changes a bridge **other than** the ones Phase 3 names.
- Verification: `validate_person_bridge_child.py` (offline, `:49-52`) plus a byte-level diff report.

### Phase 5 — Test-database READ-ONLY plan — **requires operator approval**

| Step | Command shape | Guarantees |
|---|---|---|
| 5.1 | `export_person_bridge.py --resolve-against afldb_test --parent <parent> --out <new child>` | One connection (`:366`); `default_transaction_read_only=on` passed as a connection option **and independently re-verified at runtime** by `SELECT current_setting(...)`, raising `BridgeExportError` if the server does not report `on` (`:371-375`); unconditional `rollback()` then `close()` in nested `finally` blocks (`:378-382`); *"Zero writes to any database, ever."* (`:28-29`). **Precision corrected at review:** REPEATABLE READ is *set* on the connection object (`:369`) but, unlike read-only, is **not** re-asserted by a runtime query — and **two** SELECTs execute (the read-only verification and `REGISTRATION_SQL`), not one. Both are reads; the earlier draft's "asserted … single SELECT" overstated the guarantee |
| 5.2 | `validate_person_bridge_child.py --target test` | Fully offline; no psycopg, no DSN read (`:49-52`) |
| 5.3 | `bridge_import_gate.py plan --target test --bridge <new child>` | Read-only + REPEATABLE READ asserted; every cursor wrapped to refuse anything but SELECT; always rolled back; nothing written to disk; DSN never printed (`:35-67`) |

**Expected:** 5.1 produces a child whose `target_not_registered` count has fallen by exactly the number
of people Phase 6 will have registered, and whose `bridges` count has risen by the same number, with
**no other change** against the current child. 5.3's plan must show link changes only — no INSERT of any
`draft_persons`/`draft_picks` row, no `players` write, no `afltables` identity write.

**HALT:** any figure that does not reconcile exactly; any `target_ambiguous` appearing where there was
none; any planned change outside the link columns.

**No mutation is authorised by this phase.**

### Phase 5 — Execution record (2026-09-19, Sonnet 5, operator read-only approval)

**Trigger.** The parent was corrected from v2 to **v3** offline (`build_person_bridge_v3_issue224.py`,
outside this session): the two Category B rows (Dean Laidley, Matthew Capuano) moved from the v2
withheld set into `parent_v3`'s bridges under their already-registered identities
(`docs/rebuild-manifests/draftguru/bridge-v3-reconciliation-issue224-20260919-v1.json`:
`parent_v3.path = data/reference/draftguru-person-bridge-20260918-v3.json`,
`sha256 = 1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b`; `changed_rows = 2`,
exactly Laidley/Capuano; every invariant `PASS`). The operator then authorised Phase 5.1–5.3
read-only against `afldb_test` using this v3 parent. Phase 6 (mutation) was **not** authorised and did
not run.

**Environment handling.** No `.env` exists in this worktree; the DSN was read from the main checkout's
`.env` (operator-authorised fallback), corrected in-process from port 5432 to the tunnel's 55432, and
never written to disk or printed. The bounded read-only probe passed:
`database=afldb_test transaction_read_only=on default_read_only=on statement_timeout=5000ms
connect_time=0.454s`.

| Step | Result | Detail |
|---|---|---|
| **5.1** | **COMPLETE / PASS** | `export_person_bridge.py --resolve-against afldb_test --parent <v3 parent> --out data/reference/draftguru-person-bridge-20260918-v3.afldb_test.json`. Read-only connection confirmed; one rolled-back transaction. Result: `bridges=3470 parent_bridges=3562 withheld=1587`, sha256 `94aeac74422bea17dbb14913d480055991db4ac79546a2860383e669b5bbdac4` — independently recomputed from the file bytes and confirmed identical to the exporter's self-report. Counts move by exactly +2/-2 against the v2 child (3468/1589), i.e. exactly the Laidley/Capuano transition. No database mutation. |
| **5.2** | **BLOCKED BY STALE V2 PINS** | `validate_person_bridge_child.py --target test --child <v3 child> --expect-sha256 <above>` (offline, no DSN). 7 checks FAILED: 2.5 (`parent_sha256` vs the pinned v2 hash), 2.7 (provenance), 3.4 (population counts: expected child_bridges 3468/withheld 1589, observed 3470/1587), 4.1 (Laidley/Capuano not present in the v2 parent by construction), 5.4 (`persons newly accepted` expected to be exactly the 7 v1→v2 corrections; two more appear), 5.9 (`v1 target_not_registered` surviving set expected 94, observed 92), 5.11 (`no other person changed state`, flags exactly Laidley/Capuano). **Every failure names only Laidley and Capuano; nothing else in the 5,048/5,057-person population moved.** All schema/partition/uniqueness/sort checks (3.1–3.7 except 3.4) passed; hygiene checks (7.1–7.3, including "no DSN/credential/secret appears") passed. **No evidence of a defect in the v3 export** — the validator's constants (`CHILD_REL`, `EXPECTED_CHILD_SHA256`, `PINNED_INPUTS["parent_v2"]`, the `EXPECT` dict's counts, the 7-entry `CORRECTED` map) are pinned to the v2 lineage and were not touched this session (see AFLDB-ISSUE-227). |
| **5.3** | **BLOCKED FAIL-CLOSED BY STALE V2 PINS** | `bridge_import_gate.py plan --target test --bridge <v3 child> --parent <v3 parent> --expect-child-sha256 <above> --expect-parent-sha256 <v3 hash>`. **REFUSED before any database connection was opened**: `REFUSED: child count bridges is 3470, expected 3468` — `load_child()`'s hard-coded `EXPECTED_CHILD_COUNTS` (module-level, target="test", no CLI override) refused before `resolve_dsn`'s connection was ever used by the gate. No DB mutation and no DB connection was opened for this step (the read-only probe above used a separate, already-closed connection). |

**Phase 5 status: BLOCKED — v3 validator/import-gate baseline update required.** Not fully complete.
5.1 is proven end-to-end; 5.2 and 5.3 cannot complete against the v3 lineage without updating the two
tools' pinned v2 constants, which is **out of scope for this session** and tracked separately as
**AFLDB-ISSUE-227** (a reusable-tooling baseline gap, not a data or registration defect — the 94/92
reconciliation and the root cause in §1–§4 are unaffected).

**Active test child artefact (unvalidated by 5.2/5.3, not yet a replacement for the v2 pinned child):**
`data/reference/draftguru-person-bridge-20260918-v3.afldb_test.json`,
sha256 `94aeac74422bea17dbb14913d480055991db4ac79546a2860383e669b5bbdac4`. Untracked; not committed;
not authorised as the new pinned `afldb_test` deployment child until AFLDB-ISSUE-227 is resolved and
Phase 5.2/5.3 pass against it cleanly.

**No mutation. No staging. No commit. No production. No Git command run.**

### Phase 6 — Test-database MUTATION — **SEPARATELY AUTHORISED, not covered by any earlier approval**

Two mutually exclusive variants; the operator chooses one (§8, D-3).

**6-T1 (Track 1, preferred):** the season-2026 rollover — accept a full-history snapshot extended to
2026, then `import_fitzroy_core.py` on `afldb_test`.
**6-T2 (Track 2, interim):** for each person named `register` in Phase 3, two super_admin admin actions
on `afldb_test` — create the player (with DraftGuru DOB supplied, never blank, so the D-2 guard has a
DOB on the manual side), then attach the AFL Tables path.

Common requirements for whichever variant runs:

- **Dry run / preview first.** 6-T1: `import_fitzroy_core.py --validate-only` (no DB driver needed,
  the `--validate-only` branch at `:3484-3487`, which precedes the DB-driver import at `:3503`) then
  the real run. 6-T2: one person first, end to end, verified, before
  any second person.
- **Immutable hashes** recorded before and after: the accepted-baseline manifest SHA-256, the parent
  SHA-256, the child SHA-256.
- **Expected row counts** stated *before* execution and asserted after: exact number of new `players`
  rows, exact number of new `external_identities(afltables)` rows, and `target_registration.count`
  moving from 13,275 to 13,275 + N.
- **Idempotence proof.** 6-T1: re-run and assert zero new rows (`import_fitzroy_core.py`'s upsert is
  keyed on `(source_id, external_id)`; `:2767-2778`). 6-T2: re-attaching refuses with `duplicate`
  (`admin-draft.ts:1484-1490`) — that refusal *is* the idempotence proof.
- **Rollback.** 6-T1: any `RuntimeError` rolls back the entire players batch inside `import_batch`
  (`common.py:262-289`, `import_fitzroy_core.py:2488-2495`); the `import_batches` row records
  `status='failed'` with the error in a separate committed transaction. 6-T2: each attach is one
  transaction with `RollbackRefusal` on a missing audit row (`admin-draft.ts:1515-1521`); reversal of a
  completed attach is a super_admin data-edit with its own audit trail. **Before either, a verified
  `afldb_test` backup must exist.**
- **HALTs:** D-2 refusal; identity-owner conflict (`:2785-2796`); ISSUE-136 split check (`:2634-2641`);
  the ISSUE-136 `fail_closed` refusal of any blank-`ID` profile whose first row is not career game 1;
  J-15 collision; J-16 tracked path; any contradiction of a human decision.
- **HALT H6.1 — `seeded` must be 0.** Every invocation of `import_draftguru.py` in this issue passes
  `--link-only`, which forces `seeds_allowed = False` (`:1299`). If any run reports a non-zero
  `seeded` counter (`:787`), a canonical player shell was minted — HALT and roll back. ISSUE-222's
  DEV import is the precedent: **seeded players 0**. The importer's full mode defaults
  `seeds_allowed = True` (`:1420`), so this HALT is checking a real, reachable condition, not a
  theoretical one.
- **Explicit operator approval required, per variant, per target.**

Then re-run Phase 5 to produce the **new deployment child** against the changed registration, and
import the delta with `import_draftguru.py --link-only --label <Stage A label> --bridge <new child>`
first with `--dry-run`, then for real, then `bridge_import_gate.py verify`.

**Note (INFO, carried from the toolchain; file attribution corrected at review — F-224-12):** a
`--dry-run` deliberately leaves an `import_batches` row with
`status='failed', error='DryRunComplete: '`. That is a rehearsal marker, not a failure. Do not misread
it when auditing provenance. The `DRY_RUN_MESSAGE` constant (`import_draftguru.py:199-203`) and the
`DryRunComplete` exception (`:210`) belong to **the DraftGuru importer, not to `common.py`** — an
earlier draft cited `common.py:199-203`, which is unrelated `ImportBatch` dataclass code, and
`common.py` contains no `DryRunComplete` reference anywhere. The distinction matters: shared
`import_batch()` (`common.py:262-289`) guarantees rollback-and-record on *any* raised exception; it
does not itself define or require a dry-run marker. Each importer opts in by raising inside that
context.

**Note (mechanism, `--link-only`):** link-only writes are pure
`UPDATE ... WHERE ... IS DISTINCT FROM (...)` (`import_draftguru.py:1150-1195`), never INSERT, and
`check_stored_population` (`:1291`) requires the stored Stage A population to already equal the child's.
`seeds_allowed=False` on this path (`:1299`), so **no player can be created by it**. Migration 019's
`draft_persons_backlog_ck` (`src/db/migrations/019_draft_persons.sql:73-76`) forces
`is_matching_backlog` into every person link write; `PERSON_LINK_UPDATE_SQL` already does so
(`:1156`, `:1159`).

### Phase 7 — Verification

1. `bridge_import_gate.py verify --target test` — re-reads post-import state and refuses on any
   difference from the plan.
2. `validate_person_bridge_child.py` on the new child with its `--expect-sha256`.
3. The draft-linkage checks in `tools/rebuild/draftguru/afldb_test_draft_linkage_checks.sql`
   (read-only), reconciling the pick-link count upward by exactly the expected delta from ISSUE-222's
   5,115/6,810.
4. The Gridley corpus suite (`tests/integration/gridley-corpus.test.ts`) — **expected: zero new
   `incorrect known answer` cells, and the 37 AFLDB-ISSUE-225 cells unchanged.** A change to those 37
   means this work touched something it should not have.
5. DB-free suites: `tests/draftguru-acquisition.test.ts`, `tests/grid-solver-spec.test.ts`,
   `tsc --noEmit`.

### Phase 8 — DEV rollout — **SEPARATELY AUTHORISED**

`afldb_dev` withholds the identical 94 (§2.1), so the same classification and decisions apply. DEV's
accepted Stage A DraftGuru snapshot bytes (`annual-html-20260902`) can no longer be re-acquired, so the
**only** gate-checked DEV route is link-only:
`bridge_import_gate.py plan --target dev --link-only --label annual-html-20260902 --bridge <child>`
(`bridge_import_gate.py:69-96`).

Two DEV-specific traps, both already recorded and both still live:

- **The exporter's target is a LABEL, not a database name.** `--resolve-against dev` stamps
  `"target": "dev"` (verified on disk at
  `data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json:13900`) even though the filename
  says `afldb_dev`; `--resolve-against afldb_test` stamps `"target": "afldb_test"`. Under
  `validate_person_bridge_child.py --target dev`, `--child` and `--expect-sha256` are **mandatory**
  (`:760-763`).
- **Stage A label mismatch.** `afldb_dev` holds the accepted `annual-html-20260902`, while the CLI
  default `STAGE_A_LABEL` names the superseded `annual-html-20260826` — and the current children's
  `provenance.stage_a_label` is `annual-html-20260826`. `--label` must be passed **explicitly** on
  every DEV invocation. (§8, D-5.)

Order for DEV: registration change → new child → validate → gate plan → dry run → real link-only
import → gate verify. Same HALTs, same approval requirement.

### Phase 9 — Closure

Only when Phases 6–8 have passed for both targets: record in `issues.md` the actual root cause, the
final category table with real counts, the registration route taken per person, the validation
evidence, and the new `target_registration.count`; remove ISSUE-224 from `IssuesIndex.md` and the Open
Issues table; add a `CHANGELOG.md` entry (draft-link coverage and player-register behaviour materially
changed); move this runbook to `issues/closed/`. If only part of the 94 is resolved, **the issue stays
open** with the residue named.

---

## 6. Database safety and rollback plan

| Required protection | How this plan proves it |
|---|---|
| **False registration** | No identity is registered without (a) that person's URL appearing in an acquired AFL Tables snapshot (Phase 1) and (b) an operator decision naming them (Phase 3). Identity is keyed on the URL, never a name (`import_fitzroy_core.py:36-42`; `AFLDB-2026-API-ACQUISITION.md:311` "Never match on name"). |
| **Player-shell creation** | **Corrected at review — the earlier draft named only two player-creation paths and there are four (§3.4).** Track 1 creates a player only where the accepted snapshot carries real `player_stats` rows for that URL, and the ISSUE-136 `fail_closed` clause refuses to seed any blank-`ID` profile whose first row is not career game 1. Track 2 routes through `createPlayerInTransaction` (`players.ts:309-…`), which requires a non-null `adminUserId` and mints a `manual_admin_edit` identity + a `data_overrides` audit row in the same transaction. `common.py:1267-1297` replays only an already-durable admin record, and binds onto an existing source-created player rather than creating a twin when one exists (`:1255-1262`). **The one genuine shell-minting path is `import_draftguru.py:646-686` (`seed_player`)**, reachable only from an explicit human ledger decision naming a DraftGuru-only identity, never from bridge evidence — and `seeds_allowed` defaults **True** in full mode (`:1420`), so every ISSUE-224 phase invoking this importer specifies `--link-only` (`seeds_allowed=False`, `:1299`) and Phase 6 HALTs on a non-zero `seeded` counter. Alternative R3 (a bulk direct writer) is rejected precisely because it would create 94 shells. |
| **Duplicate / conflicting identity ownership** | `external_identities_uq UNIQUE (source_id, external_id)` (migration `002_core_entities.sql:189`); the importer's explicit conflict check (`import_fitzroy_core.py:2785-2796`); the ISSUE-136 external-identity split check (`:2634-2641`); the D-2 guard (`:2456-2577`); admin J-15 (`admin-draft.ts:1477-1483`) and the already-attached refusal (`:1484-1490`); and, for the Track 1 / Track 2 interaction specifically, `common.py:1255-1262`'s bind-onto-the-existing-player branch, which exists to stop exactly this duplication. |
| **Overwriting human decisions** | `apply_authority()` step 1 (explicit ledger + live `player_link_resolutions`) precedes bridge evidence, and an admissible bridge that contradicts a human decision **HALTs** rather than overriding (`import_draftguru.py:810-818`). Standing rule `AFLDB-2026-API-ACQUISITION.md:341-343`: a promotion that would revert a manual decision fails closed. Phase 3 must not contradict either store. |
| **Reviving rejected identities** | The two `different_person_wrong_href` rejections (Craig Somerville, David Sullivan) are a **separate** withheld reason and are explicitly **not** in the 94; no phase touches them. Phase 3's `reject` disposition is durable and re-read by every later phase. J-16 refuses any path a tracked ISSUE-136 rule names (`admin-draft.ts:1446-1451`). |
| **Modifying unrelated person or draft-pick fields** | `link_only_write_set()` (`import_draftguru.py:1211-1217`) derives the write set structurally from the SQL constants themselves: `draft_persons`(player_id, link_status, match_method, confidence_notes, is_matching_backlog), `draft_picks`(player_id, link_status_value, match_method, confidence_notes), `external_identities`(player_id, status, match_method — draftguru source only), plus one `import_batches` row. `bridge_import_gate.py`'s `plan`/`verify` independently re-prove it. All writes are `IS DISTINCT FROM`-guarded UPDATEs; no INSERT. |
| **Database damage** | No phase targets production. No phase uses SSH. Every read-only phase asserts `default_transaction_read_only=on` + REPEATABLE READ in-session and rolls back unconditionally. Every mutation runs inside `import_batch`, whose failure path rolls back all DML before recording the failure in a separate transaction (`common.py:262-289`). A verified backup precedes Phase 6. `check_population_drop` (`common.py:129-184`) refuses an empty-population assertion unconditionally and a threshold-exceeding drop unless explicitly acknowledged. (Read-only precision: the exporter *re-verifies* `default_transaction_read_only` at runtime and *sets* REPEATABLE READ without re-verifying it — see Phase 5.1.) |

**Tool exclusions, stated explicitly rather than assumed (F-R02, F-R09).**

- **No phase of this issue invokes `tools/migration/enrich_birth_dates.py`.** It is the fourth AFL
  Tables registering writer and the only bulk *deleter* of registrations outside the fitzRoy importer
  (`:557-563`). On a legacy-free target it is dormant (empty asserted population ⇒
  `check_population_drop` check 1 refuses unconditionally), but run against a target still carrying
  `legacy_player_id` values it would register in bulk outside every HALT here and could delete
  admin-attached Track-2 registrations absent from its own register.
- **No phase of this issue invokes `import_draftguru.py` without `--link-only`** (see H6.1).
- **Track 1 / 6-T1 is the end-of-season rollover's work, not ISSUE-224's** (D-4). Its blast radius
  extends well past this issue: it moves the single accepted baseline, the heights-supplement binding
  (`fitzroy-contract.json:293-306`, `exactly_one_accepted`), the Stage-9 gate and `seasons.json`; and
  an incremental run on an existing database can DELETE `afltables` identities outside the asserted
  set (`import_fitzroy_core.py:2812-2816`, threshold-gated) and flip a Track-2 `resolved` row to
  `unique` via the upsert (`:2822-2827`). **ISSUE-224 consumes the rollover's result; it does not own
  or execute it.**

**Recovery.** Track 1: a failed import leaves the database unchanged (whole-batch rollback) plus one
`import_batches` row with `status='failed'`; recovery is diagnosis, not restore. A *successful but
wrong* import is reversed by restoring the pre-phase backup — which is why Phase 6 requires one. Track 2:
each attach is individually reversible by a super_admin data edit, with the original `data_overrides`
row naming exactly what was attached.

---

## 7. Exact permissions required for the next phase

The next phase is **Phase 1** only. It requires:

1. **Network access** to `afltables.com` via the tracked adapter, run as
   `Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label <new-in-season-label>
   --from 2026 --to 2026 --in-season`. Requires an R runtime with fitzRoy at the contract's pinned
   version (the adapter fails closed on a version mismatch unless `--allow-version-mismatch` is
   passed, which this phase does **not** authorise). No database. No SSH.
2. **Execution of one DB-free Python validator**,
   `import_fitzroy_core.py --validate-only --require-in-season` — the contract's declared
   `verdict_authority`. It imports no database driver on this branch (`:3484-3487` precedes `:3503`).
   No DSN, no connection.
3. **Filesystem read** of the retained accepted `full-history-20260902` snapshot bytes, which live
   **outside the repository boundary** in the operator's backup tree. CLAUDE.md §2 confines work to
   the repository, so this read must be operator-performed or explicitly authorised.
4. **Write access** limited to a new snapshot directory under the tracked snapshot layout and a new
   manifest under `docs/rebuild-manifests/afltables_fitzroy_core/`.

**What the new label must NOT be.** The in-season snapshot takes its own new label and must never
reuse or overwrite `full-history-20260902` or any accepted label. `acquire_core.R:200-204` anchors
immutability on the manifest, so a retry under the same label regenerates working files — which is
safe for a *new* label and destructive for an accepted one.

**Not required and not requested for Phase 1:** any database connection, any DSN, any credential, any
SSH session, any migration, any import, any registration, any commit.

Database permissions become relevant only at Phase 5 (read-only, `AFLDB_TEST_DATABASE_URL` /
`AFLDB_DEV_DATABASE_URL`, server-enforced read-only) and Phase 6 (write, `AFLDB_IMPORT_DATABASE_URL`,
separately authorised). **This plan requests neither now.**

---

## 8. Operator decisions requiring answers

| # | Decision | Why it cannot be decided here |
|---|---|---|
| **D-1** *(rewritten after the plan review, F-R03)* | **Are the `issue129-t7-20260903` snapshot bytes still on disk in the main checkout?** If **yes**, Phase 1 needs no network at all: re-hash those bytes against the manifest and classify Category A's 92 on `Career.Games`, entirely offline. If **no**, authorise a fresh `in_season_partial` acquisition under a **new** label. Either way the second command is `import_fitzroy_core.py --validate-only --require-in-season --label <label>`. **No database, no DSN, no SSH is requested in any variant.** The earlier claim that "without a network acquisition the 94 cannot be classified at all" was **false** and is withdrawn. | The bytes are under a gitignored path in the main checkout, not this worktree; confirming their presence requires a command, and §9 reserves that to the operator. |
| **D-1a** | **Is a finals-inclusive acquisition wanted regardless?** `issue129-t7-20260903` was extracted **2026-09-03**; the 2026 finals began after. Any Category A person who debuted in a final is absent from it for an innocent reason, and H1.1 would fire on them wrongly. | Timing/completeness judgement the operator owns. |
| **D-2** *(rewritten after the plan review, F-R01)* | **Approve the two corrected identities for Dean Laidley and Matthew Capuano?** These are **not** registration candidates: both are already-registered players (3208 under `players/D/Dani_Laidley.html`; 9198 under `players/M/Mathew_Capuano.html`) whose DraftGuru-captured href differs from the registered path. The remedy is a **parent-evidence correction**, the mechanism already applied to seven such cases between v1 and v2 (§2.4a). The only open question is whether the evidence meets the **D-9** standard — AFLDB-ISSUE-222 recorded it as found by an *untracked* fuzzy name search and *"not fully proven by retained tracked evidence"*. | D-9 adjudication is an operator judgement on evidence quality, and ISSUE-222 deliberately declined to make it. This plan must not make it either. |
| **D-3** | **Track 1 or Track 2, and when?** Track 1 (season-2026 rollover) is correct but cannot run until the 2026 season completes. Track 2 registers people now at the cost of 2 super_admin actions each. Is any subset needed before rollover, and if so which? | Timing and risk appetite; this plan recommends classify-now / wait-for-rollover. |
| **D-4** *(strengthened after the plan review, F-R09)* | **Open the end-of-season rollover as its own issue.** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md:388` proposes it (issue F) and it was never opened. The review established that its blast radius — accepted baseline, heights-supplement binding, Stage-9 gate, `seasons.json`, plus identity DELETE/status-flip behaviour on an existing database — is **much larger than ISSUE-224**, so Track 1 / 6-T1 should be **removed from this issue's execution scope** and consumed as a dependency instead. This plan now recommends opening it rather than merely asking whether to. | §5 issue-creation criteria; opening an issue is a tracked operator decision. |
| **D-5** | **Stage A label for any DEV work.** The CLI default names the superseded `annual-html-20260826` while `afldb_dev` holds the accepted `annual-html-20260902`. Confirm that every DEV invocation passes `--label annual-html-20260902` explicitly. | Known trap; a mismatch fails closed but wastes a run. |
| **D-6** | **Backup requirement for Phase 6.** Confirm a verified `afldb_test` backup (and later `afldb_dev`) exists immediately before any mutation. | Operator-owned; no agent holds a DB capability. |

---

## 9. Files read, created, or modified

**Created across the two planning passes:**
- `issues/open/AFLDB-ISSUE-224.md` (this runbook)
- `.phaneslight/returns/issue-224-plan/R01-worker-registration-authority.md`
- `.phaneslight/returns/issue-224-plan/R02-worker-bridge-import-contract.md`
- `.phaneslight/returns/issue-224-plan/R03-mechanic-2026-acquisition-digest.md`
- `.phaneslight/returns/issue-224-plan-v2/R01-worker-registration-authority-verification.md` (pass 2)
- `.phaneslight/returns/issue-224-plan-v2/R02-worker-bridge-toolchain-verification.md` (pass 2)
- `.phaneslight/returns/issue-224-plan-v2/R03-reviewer-plan-review.md` (pass 2)
- `documentation/session-summaries/SS00004_issue-224-planning_2026-09-19.md`

**Note on the two passes.** A first planning pass on 2026-09-19 was interrupted by the operator before
its mandatory plan review completed. Its runbook was retained but **not trusted**: this second pass
re-verified every load-bearing claim against current source before accepting it, which is how findings
F-224-6, F-224-7, F-224-9 through F-224-17 were found. `.phaneslight/returns/` is gitignored
(`.gitignore:40`) by design, so the returns are durable on disk but will not be committed.

**Additional evidence read in pass 2** (beyond the pass-1 list below):
`tools/rebuild/fitzroy/fitzroy-contract.json` (`in_season`, `profile_url_continuity`,
`datasets.player_stats`); `tools/rebuild/fitzroy/acquire_core.R:195-250`, `:539`;
`data/reference/seasons.json`; `tools/rebuild/draftguru/scan_person_bridge_population.py:133`,
`:214-246`, `:295-384`, `:509`; `tools/migration/common.py:1240-1344`;
`tools/rebuild/draftguru/import_draftguru.py:640-700`, `:775-805`;
`tools/migration/import_fitzroy_core.py:50-51`, `:228`, `:1203`, `:1422-1424`, `:1676`, `:1821-1856`;
and offline recomputation of the 94-row reconciliation directly from
`data/reference/draftguru-person-bridge-20260918-v2{,.afldb_test,.afldb_dev}.json` and
`docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v2.csv`.

**Modified:** `issues.md` (ISSUE-224 entry updated with the planning outcome and a runbook pointer);
`IssuesIndex.md` (ISSUE-224 state and next action updated). **No source file, test, migration, tool,
manifest or reference dataset was modified.**

**Read (evidence base):**
`IssuesIndex.md`; `issues.md` (ISSUE-223 and ISSUE-224 entries only, targeted ranges);
`data/reference/draftguru-person-bridge-20260918-v2.json`, `…-v2.afldb_test.json`,
`…-v2.afldb_dev.json`; `docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v1.csv` and
`-v2.csv`, `bridge-validation-verdicts-20260918-v2.csv`, `bridge-v2-withheld-20260918-v1.csv`;
`docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json`;
`docs/acquisition/AFLDB-2026-API-ACQUISITION.md`; `src/db/queries/admin-draft.ts` (§6.5 range and the
path regex); `src/db/queries/players.ts` (`createPlayerInTransaction` range);
`tools/migration/common.py` (`check_population_drop`, `Reporter`, `import_batch`);
`tools/migration/import_fitzroy_core.py`; `src/lib/acquisition/settle-afltables.ts`;
`deploy/afldb-settle-afltables.sh`; `tools/rebuild/draftguru/export_person_bridge.py`,
`validate_person_bridge_child.py`, `bridge_import_gate.py`, `import_draftguru.py`,
`scan_person_bridge_population.py`, `reconcile_person_bridge.py`;
`src/db/migrations/001_foundations.sql`, `002_core_entities.sql`, `019_draft_persons.sql`,
`044_schema_integrity.sql`; `src/lib/auth/capabilities.ts`; `src/app/admin/draft/actions.ts`;
`data/reference/fitzroy-accepted-baselines.json`; `documentation/_index.md`.

---

## 10. Git status and diff stat

Recorded at the **start** of this pass (supplied by the primary session, not re-derived by an
unauthorised command): branch `sonnet/issue-224`, upstream `origin/main`, HEAD
`77456b04b445312111443d3e7c5cd9ee84c80c1a`, **working tree clean**.

Changes introduced by this pass are the four created files and the two modified tracking files listed
in §9 — all Markdown, all untracked-or-documentation, **no source, test, tool, migration, manifest or
data file touched**. Nothing has been committed, staged, pushed, merged or deployed; Git remains
operator-owned per CLAUDE.md §12.

**Disclosed drift (not part of this plan, for operator removal).** `git status --porcelain` during
this pass showed three stray **zero-byte** untracked files at the worktree root, created 16:45–16:57
on 2026-09-19 — i.e. during this session's read-only investigation, by an unquoted shell redirection
inside a subagent's search command:

```
?? afldb_normalise_name(display_name)
?? normalised
?? {'
```

**UPDATED at the end of pass 2 (finding F-R08, verified and extended).** The plan review found the
disclosure incomplete, and a fresh `git status --porcelain` confirms **seven** stray untracked paths,
not three. Four more accumulated during pass 2's own verification greps, by the same unquoted-shell
mechanism:

```
?? [(player_id
?? afldb_normalise_name(display_name)
?? canonical
?? draft_picks
?? normalised
?? registered-row
?? {'
```

All seven are **zero-byte artefacts of unquoted shell redirection inside search commands**, carry no
content, and are named after fragments of SQL and Python source that were being grepped. They are
this work's own drift, **disclosed rather than hidden**, and deliberately **not deleted**: deleting a
file is a shell mutation and no such authorisation was granted (§9). **Recommended operator action:
delete all seven.** None of this plan's artefacts depends on any of them, and none is tracked.

All three are empty, carry no content and have no value. They are **the planning session's own drift
and are disclosed rather than hidden**. They were deliberately **not** deleted: removing a file is a
shell mutation and no such authorisation was granted for this task (CLAUDE.md §9). Recommended
operator action: delete all three. They were confirmed still present and still zero-byte at the start
of pass 2. No other untracked or modified path existed at the start of either pass, and none of this
plan's own artefacts depends on them.

**Working-tree state at the end of pass 2** (from a read-only `git status --porcelain` / `git diff
--stat`, the only Git commands run, both non-mutating):

```
 M IssuesIndex.md          (ISSUE-224 state, runbook pointer, next action)
 M issues.md               (ISSUE-224 planning outcome appended under the existing entry)
?? issues/open/AFLDB-ISSUE-224.md
?? documentation/session-summaries/SS00004_issue-224-planning_2026-09-19.md
?? afldb_normalise_name(display_name)   <- zero-byte drift, for deletion
?? normalised                            <- zero-byte drift, for deletion
?? {'                                    <- zero-byte drift, for deletion
```

Diff stat at the start of pass 2: `IssuesIndex.md | 29 ++++-`, `issues.md | 53 +++++`, 2 files
changed, 78 insertions(+), 4 deletions(-). **No source, test, tool, migration, manifest or
reference-data file is modified by either pass.** Nothing has been committed, staged, pushed, merged
or deployed; Git remains operator-owned per CLAUDE.md §12.

*A `git status --porcelain` / `git diff --stat` at hand-back is the operator's to run; this plan does
not execute Git.*

---

## 11. Reviewer verdict and disposition of every finding

### 11.0 Mandatory plan review — VERDICT: **REVISE**

The CLAUDE.md §15 plan review was performed by `afldb-reviewer` (Fable 5, read-only; no file written,
no command, no database, no network) against the fully corrected pass-2 runbook. **Verdict: REVISE**,
on **three HIGH findings**, six MED, two LOW and one INFO.

**Per CLAUDE.md §15, a HIGH in plan review stops the run and goes to the operator. It has.** This
runbook is **not** approved for execution and no phase of it has been proposed as authorised.

**Every reviewer finding below was independently re-verified against source by the orchestrator before
acceptance** — the same standard applied to the worker findings. All three HIGHs reproduced; one LOW
(F-R10) proved that a finding *of mine* was wrong, and is recorded as a retraction.

| ID | Grade | Location | Finding | Orchestrator verification | Disposition |
|---|---|---|---|---|---|
| **F-R01** | **HIGH** | `issues.md` AFLDB-ISSUE-222 entry, `target_not_registered` mechanism paragraph | Category B is **already explained**: player **3208** is registered under `players/D/Dani_Laidley.html` (public name change) and player **9198** under `players/M/Mathew_Capuano.html` (one-letter spelling variant). The runbook's "Dean Laidley appears nowhere in the ISSUE-222 record" is **false**, and was propagated into `issues.md`. Phase 1's H1.2 would have labelled two real, registered players as `different_person_wrong_href` source errors, and Phase 4 would have regenerated the parent with a false withholding reason for both | **CONFIRMED** — passage read directly. Further: measured that of ISSUE-222's nine named cases only Laidley and Capuano remain among the 94, and **101 − 94 = 7** reconciles exactly to the six numeric-disambiguation cases plus Schwerdt that the v2 parent correction already fixed | **ACCEPTED.** §2.4 rewritten with an explicit retraction, new §2.4a added, category table rewritten (A = 92, B = 2 *already registered*), H1.2 and H1.3 rewritten, D-2 rewritten, `issues.md` corrected. Category B is removed from Phase 1 entirely and routed to the parent-correction mechanism that has already been used seven times |
| **F-R02** | **HIGH** | `tools/migration/enrich_birth_dates.py:78`, `:418-421`, `:557-563`, `:565-577` | "Exactly three writers" is wrong. This script bulk-`executemany`-INSERTs `status='unique', match_method='afltables_profile_url'` with a non-null `player_id` — the exact tuple `REGISTRATION_SQL` measures — for players resolved via `legacy_player_id`, **not** via an existing AFL Tables identity; and it **DELETEs** every `afltables_profile_url` row outside its asserted set. So a bulk registering *and deleting* path does exist | **CONFIRMED** — `SOURCE_KEY = "afltables"` at `:78`, the DELETE at `:557-563` and the INSERT at `:565-577` all read directly | **ACCEPTED.** §1.2 now lists **four** registering writers with this one described honestly, including its dormancy on a legacy-free target (`check_population_drop` check 1) and the fact that the rebuild pipeline pins a *different* script. §5/§6 gain an explicit "no ISSUE-224 phase invokes it" |
| **F-R03** | **HIGH** | `docs/rebuild-manifests/afltables_fitzroy_core/issue129-t7-20260903.json`, `issue099-t8-20260829.json` | Two tracked, hash-pinned `in_season_partial` 2026 snapshots already exist — the later with **9,614** `player_stats` rows, `rows_without_url` 0, and the **`Career.Games` column present**. Phase 1's network acquisition is therefore not the first step, and D-1's "without it the 94 cannot be classified at all" is false. Step 1.4 is also already answered | **CONFIRMED** — both manifests parsed directly; `acquisition_kind`, range, row counts and `Career.Games` presence all verified | **ACCEPTED.** A prominent revision banner heads Phase 1; D-1 is rewritten to ask first whether the pinned bytes are still on disk, with a fresh acquisition as the fallback; new D-1a covers finals coverage (the snapshot predates the 2026 finals). The superseded design is retained beneath the banner for auditability |
| F-R04 | MED | `scan_person_bridge_population.py:214-229`, `:319` | "Actively disconfirmed" overclaims a **bounded** probe: suffixes 0–19 plus one visible-name candidate, captured href discarded. Neither `Dean`→`Dani` nor `Matthew`→`Mathew` lies in that space | **CONFIRMED** — candidate generators re-read; `NUMBERED_CANDIDATE_RANGE = range(0, 20)` at `:133` | **ACCEPTED.** §2.2 and §2.3 reworded to "not corroborated within a bounded candidate space", with Category B cited as proof that the space is incomplete |
| F-R05 | MED | H1.3; `build_person_bridge_v2.py:154`, `:189` | Spelling/href divergence was misrouted to AFLDB-ISSUE-136 continuity rules. A continuity rule binds **two** profiles of one footballer with career-game continuity; an href divergence involves **one** profile, so no rule can be written | **CONFIRMED** against the contract's `profile_url_continuity` semantics | **ACCEPTED.** H1.3 split into (i) genuine two-profile continuity → ISSUE-136, and (ii) href divergence → parent correction |
| F-R06 | MED | `import_fitzroy_core.py:3250-3251` | Phase 1.2's command omits the mandatory `--label` and would fail at argparse — the same class of defect as my own F-224-6 | **CONFIRMED** | **ACCEPTED.** `--label <label>` added |
| F-R07 | MED | `import_fitzroy_core.py:1674-1678` | The discriminator had no bucket for "present but `Career.Games` blank", and "first row" was undefined — the importer orders by `(season, match_date)`, not file order | **CONFIRMED** | **ACCEPTED.** Fourth bucket added (→ Phase 2 `unresolved`); the ordering rule stated explicitly |
| F-R08 | MED | worktree root | Drift disclosure named three stray files; more exist | **CONFIRMED and EXTENDED** — a fresh `git status` shows **seven**, four of them created by pass 2's own verification greps | **ACCEPTED.** All seven disclosed; all zero-byte; operator to delete |
| F-R09 | MED | `fitzroy-contract.json:293-306`; `import_fitzroy_core.py:2812-2827` | Track 1's blast radius is understated: a 2026-inclusive baseline also moves the heights-supplement binding, Stage 9 and `seasons.json`; and an incremental import can DELETE admin-attached paths outside the snapshot and flip a Track-2 `resolved` row to `unique` | **ACCEPTED AS STATED** on the reviewer's citations; the DELETE at `:2812-2816` and upsert at `:2822-2827` were verified, the supplement-binding breadth was not independently re-derived | **ACCEPTED with disclosure.** Recorded here and in D-4: **6-T1 is the rollover issue's work, not ISSUE-224's**, and ISSUE-224 consumes its result. Flagged for the operator rather than silently absorbed |
| F-R10 | LOW | `fitzroy-contract.json:188-192` | **My own F-224-15 was wrong** — `current_season_excluded` exists under `full_history`; the acquisition document cites it correctly | **CONFIRMED — the reviewer is right and I was wrong.** My check inspected only the JSON's top level | **ACCEPTED.** F-224-15 retracted in place rather than deleted |
| F-R11 | LOW | §5 "Expected counts" | A second expected-counts block still said 663 after F-224-7 corrected it to 668 | **CONFIRMED** | **ACCEPTED.** Blocks reconciled on 668 |
| F-R12 | INFO | `settle-afltables.ts:3508-3515` | DEV `import_rejections` already holds `unresolved_identity` URLs and could corroborate 2026 appearances | Not verified; unnecessary if F-R03 is adopted | Recorded only. No work. |

### 11.1 A methodology finding about this plan itself

**F-224-18 (MED, orchestrator, self-assessed).** The registering-writer enumeration was wrong **three
times running** — "two" (pass 1), "three" (pass 2 after a worker found the replay path), "four" (after
the plan review found `enrich_birth_dates.py`). Each pass asserted completeness and each was
incomplete. Two root causes, both recorded so the next pass does not repeat them:

1. **Grep-based enumeration was treated as exhaustive when it was not.** One worker's `semble` search
   was blocked by the environment's permission classifier and it fell back to Grep, which is the
   documented fallback — but a fallback enumeration should have been *labelled provisional*, not
   asserted complete.
2. **The AFLDB-ISSUE-222 ledger entry was never read in full.** Pass 1 and pass 2 both read the
   *artefacts* (JSON, CSV, manifests) and the *code*, and reasoned from them — while the answer to
   Category B was sitting in prose in `issues.md`, which CLAUDE.md §5 makes authoritative. **This is
   the single most instructive failure of the exercise**: measurable evidence was over-weighted
   because it was measurable, and the authoritative narrative record was under-read because reading it
   is discouraged in bulk (§3). The correct discipline is a *narrow targeted search of the related
   issue entry*, which §5 explicitly prescribes and which neither pass performed for ISSUE-222.

### 11.2 Orchestrator findings (pass 2), carried forward

**Orchestrator-held findings before review:**

| ID | Grade | Location | Summary | Disposition |
|---|---|---|---|---|
| F-224-1 | INFO | `bridge-population-scan-20260918-v2.csv` (all 94 rows) | The population scanner short-circuits on `target_unregistered`; no tracked artefact distinguishes one of the 94 from another | Recorded; drives Phase 1's existence. No work created. |
| F-224-2 | INFO | `src/db/queries/admin-draft.ts:180` | All 94 identity paths pass `AFLTABLES_PROFILE_PATH_RE`; 94 distinct of 94 | Recorded; removes a shape objection to Track 2. |
| F-224-3 | **MED — half SUPERSEDED, half FALSE** | §2.4 (Dean Laidley, Matthew Capuano) | Claimed two of the 94 are not post-baseline debutants (**true, and important**) *and* that they are unexplained, with "Dean Laidley appears nowhere in the ISSUE-222 record" (**false**) | **Superseded by F-R01.** The structural half stands; the explanatory half was wrong and was propagated into `issues.md` before the plan review caught it. Both places corrected. |
| F-001 (mechanic) | MED → **INFO** | `docs/acquisition/AFLDB-2026-API-ACQUISITION.md:311,461` | The document names the ISSUE-092 population-drop gate but never defines it | **Resolved by the orchestrator**: the definition is `tools/migration/common.py:129-184`, implemented and wired into `import_fitzroy_core.py:2804-2811`. Downgraded to INFO; creates no work. |

**Findings raised by the second planning pass's independent verification (2026-09-19).** Two
`afldb-worker` agents re-verified every load-bearing code claim of the first pass against current
source. **Each finding below was then re-verified by the orchestrator against source directly before
acceptance** — one of them was accepted as to code and *rejected* as to consequence on measured
evidence.

| ID | Grade | Location | Summary | Disposition |
|---|---|---|---|---|
| F-224-10 | **HIGH** | `tools/migration/common.py:1327-1341` | §1.2's "only two writers can register an AFL Tables identity" is **wrong**. `replay_admin_overrides` (ISSUE-160 §8.1) is a third: it registers an `afltables` path with `status='resolved'`, `match_method='afltables_profile_url'` — the exact tuple `REGISTRATION_SQL` measures — after creating the player at `:1267-1297` | **Verified by the orchestrator against source and ACCEPTED. §1.2 and §3.4 rewritten.** Materially *improves* the plan: it is the mechanism by which a Track 2 admin registration survives a rebuild, and its `bound_player_id IS NOT NULL` branch (`:1255-1262`) is the designed defence against the Track 1/Track 2 duplicate-player collision. Added to the §6 duplicate-ownership row. |
| F-224-11 | **HIGH** | `tools/rebuild/draftguru/import_draftguru.py:646-686`, called `:785` | §3.4 characterised the DraftGuru importer as "draftguru source only"; it contains its own `INSERT INTO players` (`seed_player`). `seeds_allowed` defaults **True** in full mode (`:1420`) and is forced False only under `--link-only` (`:1299`) | **Verified and ACCEPTED, with a correction to its characterisation.** `seed_player` writes no `external_identities` row at all, so it cannot register an AFL Tables identity and §1.2 is unaffected — but the §6 *player-shell* protection was materially incomplete. §3.4 rewritten, §6 rewritten, and **new HALT H6.1** added to Phase 6 requiring a zero `seeded` counter. The protection is modal (`--link-only`), so the plan now states the mode explicitly on every invocation instead of relying on it silently. |
| F-224-12 | MED | claimed `common.py:199-203`; true `import_draftguru.py:199-203`, `:210` | The `--dry-run` / `DryRunComplete` note cited the wrong file; `common.py` contains no `DryRunComplete` reference at all | **Verified and ACCEPTED.** Phase 6 note corrected, with the substantive distinction spelled out: shared `import_batch()` guarantees rollback-and-record on any exception but neither defines nor requires a dry-run marker. |
| F-224-13 | MED → **ACCEPTED as to code, REJECTED as to consequence** | `scan_person_bridge_population.py:299-335`, `:370-378` | A worker reported that the scanner does **not** short-circuit on `target_unregistered` (correct), and concluded that *"some of the 94 may already carry a `source_discrepancy_same_person` classification with a specific `corrected_identity`"* | **The code claim is confirmed; the consequence is refuted by direct measurement.** The orchestrator read the classifier itself (`:370-378`) and independently measured the produced artefact: of the 94 rows, `corrected_identity` is blank **94/94** and `population_reason` is `TARGET_NOT_REGISTERED_NO_EVIDENCE` **94/94**. The probe ran and corroborated nobody. §2.2/F-224-1's *reason* is rewritten; its *conclusion* stands and is now **stronger** — the renumbering and spelling hypotheses are not merely untested, they are **mechanically tested and disconfirmed** against the accepted 1897–2025 register at the `offline_strong` bar. §2.3's two category rows upgraded accordingly. |
| F-224-6 | MED | §5 Phase 1.1 (as previously drafted) | The proposed Phase 1 command was **not executable**: it omitted the mandatory `--acquire` and `--label`, and ignored the tracked `--in-season` mode the contract requires for a single in-progress season | **Found and handled by the orchestrator.** Phase 1 rewritten around `acquisition_kind = in_season_partial`, its twelve `completeness_gates`, its declared `verdict_authority`, and the `never_admissible_for` clause that stops the evidence snapshot ever becoming a registration source. §7 rewritten. This was the operator's literal next command, so an unexecutable form was not a cosmetic defect. |
| F-224-7 | MED | `AFLDB-2026-API-ACQUISITION.md:886-896`; contract `in_season.identity_requirement` | The expected 2026 distinct-URL count was stated as **663**. The true figure at that probe date is **668**: 663 ID-bearing `(ID, url)` pairs *plus* 5 further URLs carrying no `ID` at all (82 rows) | **Found and handled by the orchestrator.** Phase 1 now extracts on `url` (the contract's sole `required_column`; `ID` is `enrichment_columns`) and states 668. An `ID`-keyed extraction would have silently dropped exactly the blank-`ID` rows that matter most — debutants and renumbered profiles — and could have fired HALT H1.1 falsely for up to five people. |
| F-224-9 | **Improvement, not a defect** | contract `profile_url_continuity.fail_closed`, `not_a_rule`, `in_season_scope` | The plan's discriminator was mere presence in the 2026 URL set. The contract already defines a better, source-stable, name-free one: **the career-game number of the profile's first row** | **Found and handled by the orchestrator.** Phase 1 rebuilt around it (career game 1 ⇒ genuine debutant, Billy Wilson precedent; > 1 ⇒ renumbering requiring a reviewed ISSUE-136 rule ⇒ HALT H1.3). Phase 1 now predicts the rollover's own verdict rather than discovering it at Phase 6. `in_season_scope` also supplied a third independent confirmation of the root cause (§1.3a). |
| F-224-14 | LOW | `export_person_bridge.py:361-383` | Phase 5.1 claimed "REPEATABLE READ asserted in-session, single SELECT". REPEATABLE READ is *set* but not runtime-verified (read-only *is* verified, `:371-375`), and two SELECTs execute | **Verified and ACCEPTED.** Phase 5.1 and the §6 database-damage row reworded. A safety table that overstates a guarantee is a defect in a safety table. |
| F-224-15 | **RETRACTED — the finding was wrong** | `fitzroy-contract.json:188-192` | I recorded that `AFLDB-2026-API-ACQUISITION.md:44` cites a contract key `current_season_excluded` that does not exist. **It does exist**, as `full_history.current_season_excluded`; my check looked only at the top level of the JSON. The document cites it correctly | **Withdrawn (F-R10).** No documentation drift, no AFLDB-ISSUE-226 implication, no work. Retained here rather than deleted because a retracted finding that silently vanishes is indistinguishable from one that was never checked. |
| F-224-16 | INFO | AFLDB-ISSUE-222 §9 | ISSUE-222's standing rule is that `target_unregistered` rows get **no network fetch** — superficially in tension with Phase 1 | Addressed in Phase 1 explicitly: §9's rule governs *per-person residual href fetches* inside ISSUE-222's own review, not a season-level contract-governed acquisition of an already-tracked source. No ISSUE-222 verdict is reopened. |
| F-224-17 | INFO | line citations throughout | Independent verification corrected ~10 line ranges from the first pass (`check_population_drop` `:129-159`→`:129-184`; conflict check `:2779`→`:2785`; `ON CONFLICT` `:2767-2778`→`:2822`; `external_identities_uq` `:190`→`:189`; `createPlayerInTransaction` docblock `:272-308`, body from `:309`; `--validate-only` `:3453-3482`→`:3484-3487`; `attachAflTablesIdentity` span `:1438-1520`→`:1438-1539`) | All corrected in place. Every other first-pass claim verified **CONFIRMED** against current source. |
| F-224-4 | INFO | `tools/migration/common.py:199-203` | `--dry-run` deliberately leaves an `import_batches` row `status='failed', error='DryRunComplete: '` | Noted in Phase 6 so a future operator does not misread a rehearsal as a failure. |
| F-224-5 | INFO | `…-v2.afldb_test.json` `provenance.stage_a_label` | Children carry Stage A label `annual-html-20260826` while `afldb_dev` holds the accepted `annual-html-20260902` | Raised as operator decision D-5; Phase 8 mandates an explicit `--label`. |

---

## 12. Implementation-readiness recommendation

**NOT READY TO IMPLEMENT, and NOT YET READY TO PROCEED TO PHASE 1.** The mandatory plan review
returned **REVISE** on three HIGH findings (§11.0). All three reproduced under the orchestrator's own
verification. Under CLAUDE.md §15 that stops the run and refers the decision to the operator, which is
what this document now does.

**What the operator is being handed is a corrected analysis and a set of decisions — not an approved
plan.** Phase 1 in particular must be re-shaped around the already-pinned 2026 snapshot (F-R03) before
it is proposed, and that re-shaping turns on a fact no agent may establish here: whether the snapshot
bytes are still on disk in the main checkout (D-1).

Three things are established beyond doubt and change nothing about the database:

1. **The withholding is correct.** The export predicate, the importer HALT and the settle's §17.3 rule
   are one coherent fail-closed contract. Nothing in the bridge toolchain is defective, and no part of
   it should be loosened.
2. **The registration authority exists and is enumerable — but this plan proved bad at enumerating
   it** (§11.1). `import_fitzroy_core.py` is the bulk canonical route; the super_admin
   `createPlayer` → `attachAflTablesIdentity` pair is the reviewed per-person route, verified at
   `admin-draft.ts:1492-1502` to write exactly the tuple the exporter measures; `common.py`'s replay
   makes an admin registration survive a rebuild; and `enrich_birth_dates.py` is a legacy-era bulk
   writer, dormant on a legacy-free target. No parallel identity table is needed and none may be
   built. **The count went 2 → 3 → 4 across three passes, so treat any future "complete enumeration"
   in this issue as provisional until independently re-derived.**
3. **The population is bounded exactly: 94, identical on `afldb_test` and `afldb_dev`** — and it
   **splits 92 + 2**, not 94 homogeneous. The 2 are already-registered players needing a parent
   correction, not registration (§2.4a).

One thing is decisively **not** established: **why each of Category A's 92 is unregistered.** Every
scan artefact stamps them identically as `insufficient_evidence`. Implementing any registration now
would mean registering people on a guess — the precise failure the whole architecture exists to
prevent.

The honest next step is small, cheap, reversible, and touches no database: **acquire the 2026 AFL
Tables evidence under the existing in-season contract and classify the 94 on `Career.Games`.**
Everything after that is a decision the operator makes with real evidence in hand, and the preferred
durable answer (the season-2026 rollover) is not executable before the season ends in any case.

**What pass 2 changed about that recommendation.** Pass 1 proposed classifying on *presence in the
2026 URL set*. That is a weaker test, and its command was not executable as written. Phase 1 now uses
the discriminator the importer itself will apply at rollover — AFL Tables' own `Career.Games` on the
profile's first row — inside the tracked `in_season_partial` acquisition kind, whose artefact the
toolchain **structurally refuses** to accept as a registration baseline
(`fitzroy-contract.json`, `in_season.never_admissible_for`). The result is that Phase 1 predicts the
rollover's verdict per person, cannot be escalated into a registration by accident, and leaves every
fail-closed gate in the toolchain exactly as it found it.

**Nothing in this plan loosens a HALT, weakens the unattended-linking suspension, or edits a
deployment child.** ISSUE-224 is unblocked by *registering identities through the existing
authority*, not by teaching the bridge to accept unregistered ones — which is why AFLDB-ISSUE-222's
withholding, and AFLDB-ISSUE-221's honest "No data" squares, both remain correct throughout.

---

# 13. CONTINUATION — 2026-09-22 (S9 unblock pass, Opus 5, documentation + offline analysis only)

> **Scope of this section.** Everything above (§1–§12) is the **2026-09-19 historical planning and
> Phase 5 execution record** and is retained unaltered. This section is the **2026-09-22
> continuation**. Where the two conflict, **this section governs** and says so explicitly.
>
> **Commands run in this pass:** repository file reads, read-only filesystem search outside the
> worktree (operator-authorised for Task 3), and offline JSON/CSV analysis of tracked artefacts and
> hash-verified snapshot bytes. **No database. No network. No Git mutation. No test, typecheck or
> build. No code edit. No evidence artefact rewritten. Nothing registered.**

## 13.1 What this pass changes about §12's verdict

§12 concluded **"NOT READY TO PROCEED TO PHASE 1"** and named the unestablished fact as *"why each of
Category A's 92 is unregistered"*. **Both statements are now superseded by retained tracked
evidence produced later on 2026-09-19, after §12 was written.** Phases 1, 2 and 3 all completed.

| Phase | 2026-09-19 status per §5/§12 | Actual retained status (measured this pass) |
|---|---|---|
| 1 — evidence acquisition | proposed, blocked on D-1/D-1a | **COMPLETE.** `docs/rebuild-manifests/afltables_fitzroy_core/issue224-inseason-20260919.json` — `in_season_partial`, season 2026, extracted `2026-09-19T07:46:42Z`, **rounds 1–27 including Finals**, 215 matches, 9,890 player-match rows, `rows_without_url` 0, fitzRoy 1.8.0 = pinned. Supersedes `issue129-t7-20260903` and answers D-1a affirmatively (it *is* finals-inclusive). |
| 2 — population classification | proposed | **COMPLETE.** `docs/rebuild-manifests/draftguru/issue224-population-classification-20260919.json`, `rows_sha256 ef7f4ed0…`, 94 rows, `unresolved 0`, `absent 0`, `continuity 0`. |
| 3 — operator decisions | proposed | **COMPLETE.** `docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-20260919-v1.json`, `completion_status complete`, operator "Stu", `review_completed_utc 2026-09-19T08:02:24Z`, 94 rows, `rows_sha256 1fc8ff22…`, bound to Phase 2 by `source_adjudication_pack.sha256 0765392a…`. |

**Phase 2's result, measured directly from the artefact this pass:** all **92** Category A rows carry
`classification = genuine_post_baseline_afl_debutant`, `reason =
FIRST_2026_APPEARANCE_CAREER_GAMES_1` and **`first_2026_career_games = 1`** — 92/92, no exceptions.
The discriminator §5 Phase 1 was designed around (AFL Tables' own `Career.Games` on the profile's
first chronological 2026 row) was applied and returned a clean unanimous verdict. The two Category B
rows carry `ALREADY_REGISTERED_UNDER_DIFFERENT_AFLTABLES_PATH` with `player_id_evidence` 3208
(`players/D/Dani_Laidley.html`) and 9198 (`players/M/Mathew_Capuano.html`).

**§12's "one thing decisively not established" is therefore established.** §2.3's Category A is no
longer PROVISIONAL: it is classified on the designed, source-stable, name-free discriminator, and
§2.3a's DraftGuru cross-reference addendum is now corroboration of a settled result rather than a
substitute for it.

## 13.2 The Phase 3 verdicts CONTRADICT the ISSUE-228 Route A decision — operator adjudication required

This is the single most important finding of this pass, and it is **not** resolvable by an agent.

`bridge-operator-verdicts-issue224-20260919-v1.json`'s `totals` are:

```
register                            : 0
defer-to-rollover                   : 92
route_to_parent_evidence_correction : 2
reject / route_to_issue_136         : 0
unresolved                          : 0
```

Every one of Category A's 92 carries `operator_decision = "defer-to-rollover"`, justified verbatim as
*"Use the canonical end-of-season rollover rather than in-season registration."* That is §4.1's
recommendation, faithfully executed, and under §5 Phase 3's own rule — **"No decision file, no
registration. Phase 6 reads only this artefact"** — it authorises **zero** registrations.

**The ISSUE-228 Route A decision of 2026-09-22 requires the opposite.** Route A requires the *same
immutable snapshot* `afl-api-2026-2026-09-21-011148` to settle with `unresolvedIdentityPlayer = 0`,
which cannot happen while the 92 canonical players do not exist. Route A therefore requires a
Phase 3 **re-decision** from `defer-to-rollover` to `register` for the S9 target set.

**This is a live contradiction between two dated operator decisions, three days apart, and it is
recorded rather than silently resolved.** Nothing in this pass re-decides it; the 2026-09-19
verdict artefact is byte-bound and was not touched. See §13.7, decision **D-7**.

## 13.3 Population A and Population B are the SAME 92 people — now on strong, name-free evidence

§13's predecessor annotations (and ISSUE-228's own record) correctly insisted that **92 == 92 is not
identity evidence** and that the 83/9 normalised-name overlap is **diagnostic correlation only**.
That caution was right and is not withdrawn. **It has now been discharged by evidence of a different
and much stronger class**, computed offline in this pass.

**Method — the project's own accepted evidence class, applied source-to-source.** The AFL API bridge
links a provider to a canonical player on **club + jumper number + exact core-stat-vector equality**,
with `name_based_candidate_discovery: false` and `surname_equality_is_validation_only: true`
(`data/reference/afl-api-player-bridge-2026-full-2026-09-21.json`, `acceptance_rule`). The same join
was run with the **AFL Tables 2026 snapshot in place of the canonical database**: the 13 `core_stat_columns`
were mapped onto the AFL Tables `player_stats_2026.csv` columns (`Kicks`, `Handballs`, `Marks`,
`Tackles`, `Goals`, `Behinds`, `Hit.Outs`, `Frees.For`, `Frees.Against`, `Inside.50s`,
`clearances.totalClearances`→`Clearances`, `rebound50s`→`Rebounds`, `Goal.Assists`), keyed by
`Playing.for` + `Jumper.No.`, with the AFL API `teamId` mapped through
`data/reference/afl-api-identities.json`'s `teams` (`CD_T…` → `hist`).

**Soundness of the key, measured:** across all 9,890 AFL Tables 2026 rows, the number of
`(club, jumper, core-vector)` keys resolving to more than one profile URL is **0**. The
discriminator is globally unique within the season; it is not a heuristic.

**Result over Population B's 92 unresolved providers:**

| Measure | Value |
|---|---|
| Providers resolving to **exactly one** AFL Tables profile URL | **92 of 92** |
| Distinct AFL Tables URLs claimed | **92** (a bijection — no collision, no sharing) |
| Claimed URLs lying inside ISSUE-224 Category A's 92 | **92 of 92** |
| Category A paths claimed by **no** provider | **0** |
| **Unanimous** (every one of the provider's matches agrees on the exact 13-stat vector) | **87** |
| Single candidate with one non-agreeing match, **zero** competing candidates | **5** |
| Providers with no vector hit anywhere | **0** |
| Linked paths whose minimum 2026 `Career.Games` is 1 | **92 of 92** |

The last row independently reproduces Phase 2's discriminator from a different direction, on the
same bytes, for every person.

**The five non-unanimous cases, individually diagnosed** — all five retain a single candidate and
zero competing candidates, so all five clear the artefact's own `min_matches_for_link: 2` bar by a
wide margin:

| Provider | Name | API rows / agreeing | Linked path | Nature of the one disagreement |
|---|---|---|---|---|
| `CD_I1007053` | Billy Cootee | 11 / 10 | `players/B/Billy_Cootee.html` | `CD_M20260142802` (Preliminary Final) has **no AFL Tables row at all** — absence, not contradiction: the AFL Tables extraction is 2026-09-19, the AFL API acquisition 2026-09-21. |
| `CD_I1037405` | Harry Kyle | 12 / 11 | `players/H/Harry_Kyle.html` | same fixture `CD_M20260142802`; absence. |
| `CD_I1029417` | Max Beattie | 4 / 3 | `players/M/Max_Beattie.html` | `CD_M20260142801` (Preliminary Final); absence. |
| `CD_I1036426` | Talor Byrne | 20 / 19 | `players/T/Talor_Byrne.html` | genuine single-stat discrepancy on the **same** fixture (AFL Tables round 12, 2026-05-23): **12 of 13** stats identical, `Frees.Against` 1 vs 0. |
| `CD_I1023273` | Hugo Hall-Kahan | 13 / 12 | `players/H/Hugo_Hall-Kahan.html` | genuine discrepancy on the **same** fixture (Semi Final, 2026-09-12): **11 of 13** identical, `Kicks` 17 vs 16 and `Clearances` 1 vs 0. |

Surname agreement — **validation only, never a discovery signal** — holds on 92/92. Two apparent
mismatches (`Hussien El Achkar`, `Alex Van Wyk`) are an artefact of taking the last whitespace token
of a multi-token surname, not real disagreements.

**Population-level corroboration, independent of any join:** the AFL Tables 2026 snapshot carries
**669 distinct profile URLs**; the AFL API snapshot census records
`snapshotDistinctProviderPlayers: 669`. Two unrelated sources independently see exactly the same
number of players in season 2026, and 577 + 92 = 669 partitions it exactly.

**Conclusion.** Population A Category A and Population B are the **same 92 footballers**, established
on club + jumper + exact-stat-vector identity evidence and never on a name. The earlier "diagnostic
correlation only" framing was the correct statement of what was then known; it is now superseded for
all 92. **§2.3's `Jack_Dalton1` numeric-suffix surface candidate and the five short/formal given-name
surface candidates are resolved as the same-person cases they appeared to be — but by stat evidence,
not by the name resemblance that raised them.**

## 13.4 Snapshot byte verdict (Task 3)

| Snapshot | Tracked manifest | Raw bytes on disk | Verdict |
|---|---|---|---|
| **`issue224-inseason-20260919`** (AFL Tables, 2026) | yes | **`D:\dev\afldb-issue-224\data\sources\afltables\fitzroy_core\issue224-inseason-20260919\`** — the sibling ISSUE-224 worktree, not the main checkout | **A — PRESENT AND MATCHES.** `player_stats_2026.csv` sha256 `d150d4bc…` ✓, 9,890 rows ✓; `results.csv` sha256 ✓, 215 rows ✓. Both files byte-exact against the manifest. |
| `issue129-t7-20260903` (AFL Tables, 2026) | yes | **absent** everywhere searched | **B — ABSENT.** Inspected as instructed; **not substituted.** Superseded in any case: it predates the 2026 finals, has 9,614 rows to `issue224-inseason`'s 9,890, and Phase 2 already used the newer snapshot. |
| `issue099-t8-20260829` (AFL Tables, 2026) | yes | **absent** | **B — ABSENT.** Secondary; not substituted. |
| **`afl-api-2026-2026-09-21-011148`** (AFL API — the Route A acceptance snapshot) | referenced by the bridge artefact (`snapshot_manifest_sha256 dcbd0626…`) | **ABSENT from every local root** | **B — ABSENT.** See §13.5. |
| `afl-api-2026-2026-09-21-031725` (AFL API, later lineage) | own manifest, sha256 `5018a3d6…` | **present**, `D:\dev\afldb\data\sources\afl_api\matches\` | present but is a **different** snapshot; used in §13.3 **declared, never as a substitute for `-011148`**. |

`issue224-inseason-20260919`'s manifest records `completeness: "unvalidated"` — its declared
`verdict_authority`, `import_fitzroy_core.py --label issue224-inseason-20260919 --validate-only
--require-in-season`, has never been run. That is a DB-free, network-free gate and it is named in
§13.8 as a prerequisite, not waived.

Roots searched read-only: this worktree, `D:\dev\afldb` (main checkout), `D:\dev\afldb-issue-224`,
`D:\dev\afldb-issue-227`, `D:\dev\afldb-issue-228`, `D:\dev\afldb-issue-228-s9`,
`D:\dev\afldb-evidence-archive`, `D:\dev\afldb-local-artifacts`,
`D:\dev\afldb-local-cleanup-quarantine-20260919`, `D:\backups\afldb`, `D:\tmp`.

## 13.5 The Route A acceptance snapshot's bytes are gone — a structural obstacle ISSUE-228 owns

A whole-drive read-only search for `*011148*` returns **nothing**. The only 2026 AFL API match
snapshot present anywhere is `afl-api-2026-2026-09-21-031725`, whose manifest hash `5018a3d6…`
differs from the `dcbd0626…` the accepted bridge artefact pins.

**Consequence.** ISSUE-228's own stated next prerequisite — *"AFL API bridge rebuilt/re-resolved on
the same snapshot"* — requires `emit-afl-api-player-bridge.ts` to read those bytes. They are not
present locally. Either they exist on the DEV host, or `-011148` is no longer re-derivable and
**Route A's "same immutable snapshot" condition needs an operator ruling** on whether `-031725` is
promoted to the acceptance snapshot (with its own hash, label and provenance) or `-011148` is
recovered.

**This is ISSUE-228's decision, not ISSUE-224's, and no ISSUE-224 phase depends on it.** It is
recorded here only because Task 5 required building the target set against that named snapshot.
Evidence that the two snapshots are *substantively* equivalent for player-identity purposes, but not
byte-identical: `-031725` contains 217 match directories, 669 distinct provider players and **9,983**
player-stat rows — matching the `-011148`-built artefact's `matchesEvaluated 217`,
`snapshotDistinctProviderPlayers 669` and `snapshotPlayerMatchRows 9983` exactly. All 92 unresolved
providers are present in it. **Substantive equivalence is not byte identity and is not being treated
as such.**

## 13.6 Registration contract, and the sequencing defect it exposes (Tasks 4 and 6)

### 13.6.1 An AFL Tables identity does NOT satisfy the S9 end condition

**This corrects a load-bearing assumption in the ownership annotations of both issues.** The AFL API
settle resolves a player through `resolveAflApiPlayer()`
(`src/lib/acquisition/afl-api-player-resolver.ts:52-79`), which is exactly:

```sql
SELECT player_id FROM external_identities
 WHERE source_id = <afl_api> AND external_id = <CD_I…>
   AND status IN ('unique','resolved') AND player_id IS NOT NULL
```

*"No hit is `unresolved` — never a guess, never a fallback to name, jumper number, club/team, match
participation, statistics, **or an AFL Tables profile URL**"* (`:14-17`). So
`unresolvedIdentityPlayer = 0` needs an **`afl_api`-source** identity row per provider. Registering
the 92 players and their `afltables` paths — the whole of ISSUE-224's classical scope — **does not by
itself move that counter at all.**

### 13.6.2 The circular dependency, and the order that breaks it

The only writer of `afl_api` player identities is
`tools/migration/import_afl_api_player_bridge.py`, reading a bridge artefact built by
`emit-afl-api-player-bridge.ts`, which links on club + jumper + exact core-stat-vector equality
against **canonical `player_match_stats` rows** (`canonicalPmsRowsRead: 9063`). A freshly registered
player has **no** `player_match_stats` rows — `createPlayerInTransaction`
(`src/db/queries/players.ts:309-…`) seeds exactly one **zero** `player_career_stats` row and nothing
else. So a bridge rebuilt straight after registration still reports
`no_matching_evidence`/`no_canonical_row_at_jumper` for all 92, and the counter stays at 92.

The canonical 2026 stat rows arrive from the **AFL Tables settle**, which resolves participation
through `refs.playerIdsByUrl` — i.e. through precisely the `afltables_profile_url` registration
ISSUE-224 creates (§1.3). Hence the only order that terminates:

```
1. register 92 canonical players + their afltables_profile_url identities   (ISSUE-224)
2. AFL Tables settle of season 2026  -> creates canonical player_match_stats  (ISSUE-224 hands off)
3. rebuild the AFL API stat-vector bridge -> now matches club+jumper+vector   (ISSUE-228)
4. import the 92 afl_api identity links                                      (ISSUE-228)
5. re-settle the AFL API snapshot -> unresolvedIdentityPlayer = 0            (ISSUE-228)
```

**Step 2 is newly identified and is in nobody's plan.** Neither issue's ownership annotation names
it, and Route A's prerequisite list omits it. It is the load-bearing middle of the chain: without
canonical stat rows there is no stat vector to bridge on. Whether step 2 is the AFL Tables in-season
settle or the §4.1 Track 1 rollover is **decision D-8**.

### 13.6.3 The contract for registering one missing 2026 player

**Mandatory canonical fields** (`players`, migration `002_core_entities.sql`): `display_name`,
`sort_name`, `search_name`, `slug` — all `NOT NULL`. Only `display_name` is operator-supplied;
`createPlayerInTransaction` derives `sort_name` in SQL and `search_name`/`slug` via
`afldb_normalise_name()` **in SQL**, deliberately using the same expressions
`import_fitzroy_core.import_players()` and the §8.1 replay use, *"so a replayed twin of this row is
byte-identical to it"* (`players.ts:296-299`). `adminUserId` is mandatory — non-negotiable, because
the durable `data_overrides` record requires attribution.

**Nullable / unknown-safe:** `dob` (NULL = unknown, never a default date; `dob_confidence` then
`'unknown'`), `birth_year*`, `given_name`, `surname` (both derived from `display_name` when absent),
`height_cm`, `weight_kg`, `notes`, `debut_season`, `final_season`, `legacy_player_id`.

**Evidence required per field.** Only `display_name` and the AFL Tables path are identity-bearing and
both are carried by the Phase 2/Phase 3 artefacts plus §13.3's join. Everything else is biography:
supply it or leave it NULL, but **never default it** — `NULL` means "not recorded", which is the
project's standing modelling rule.

**The required stable AFL Tables external identity:** one `external_identities` row,
`source.key='afltables'`, `external_id` = the normalised profile path, `player_id` non-null,
`status='resolved'`, `match_method='afltables_profile_url'` — exactly the tuple `REGISTRATION_SQL`
(`export_person_bridge.py:351-358`) measures, written by `attachAflTablesIdentity`
(`admin-draft.ts:1492-1502`). All 92 paths pass `AFLTABLES_PROFILE_PATH_RE` (§2.3, F-224-2).

**Immediate dependent rows:** one zero `player_career_stats` row; one `manual_admin_edit`
`external_identities` row carrying a `randomUUID()` token; one `data_overrides` identity row holding
the whole player; one `data_edits` audit row; then the `afltables` identity row and its own
`data_overrides` update — whose absence throws `RollbackRefusal` and rolls the attach back
(`:1515-1521`).

**Derived data requiring recompute: none, by hand.** Registration creates no statistics to derive
from. The settle that later creates participation calls `recomputePlayerDerivedStats()` itself
(`settle-afltables.ts:1910`; `settle-afl-api.ts:1770`), scoped to the players that run touched.

**Ambiguity / HALT conditions:** path-shape refusal; J-16 tracked ISSUE-136 continuity path; J-15
collision (path already held by another player); duplicate (this player already holds an AFL Tables
identity); missing audit row; non-super_admin actor. And at the eventual rollover: the D-2 guard, the
identity-owner conflict check, and the ISSUE-136 `fail_closed` blank-`ID` refusal.

**How registration survives a rebuild:** `replay_admin_overrides` (`common.py:1267-1341`) re-creates
the admin player from its durable `data_overrides` record and re-registers the attached AFL Tables
path with `status='resolved'`, doubly guarded (`bound_player_id IS NULL`, and `WHERE NOT EXISTS`
another holder).

**How a later rollover avoids duplicating the player — a correction to §5 Phase 6-T2.** §6 advises
supplying a DOB "never blank, so the D-2 guard has a DOB on the manual side". Measured against
source, that is defensive but mis-states the mechanism: `MANUAL_CANDIDATES_SQL`
(`import_fitzroy_core.py:2497-2509`) selects only manual players holding **no AFL Tables identity**
(`WHERE NOT EXISTS … asrc.key='afltables'`). A player created **and attached** is therefore **never a
D-2 candidate**; the rollover finds the path in `existing_by_url` and UPDATEs that player instead of
inserting a twin — which is exactly what `admin-draft.ts:1432-1436` promises. `manual_insert_verdict`
(`:2512-2529`) refuses on an unknown DOB **either** side, so **DOB only matters for a player left
created-but-unattached**. Practical rule: **attach in the same operator sitting as the create**, and
a DOB is belt-and-braces rather than the load-bearing guard.

## 13.7 The S9 target set (Task 5) and its disposition

The full 92-row provider → path mapping is the §13.3 join; the five non-unanimous rows are tabulated
there individually. Summary disposition:

| Rows | Evidence grade | Already registered? | Required action |
|---|---|---|---|
| 87 | **STRONG IDENTITY EVIDENCE** — unanimous club + jumper + exact 13-stat vector across every match, single candidate, unique key | No | **REGISTER** (pending D-7) |
| 3 (Cootee, Kyle, Beattie) | **STRONG IDENTITY EVIDENCE** — 10/11, 11/12, 3/4 matches exact; the residue is a September final **absent** from the 2026-09-19 AFL Tables extraction, with zero competing candidates | No | **REGISTER** (pending D-7) |
| 2 (Byrne, Hall-Kahan) | **STRONG IDENTITY EVIDENCE** — 19/20 and 12/13 matches exact; the residue is the **same** fixture agreeing on 12/13 and 11/13 stats, zero competing candidates | No | **REGISTER** (pending D-7); the per-stat discrepancy is a source-to-source reconciliation note, **not** an identity doubt |
| 0 | SUPPORTING / DIAGNOSTIC ONLY | — | — |
| 0 | NO EVIDENCE | — | **WITHHOLD / HALT** |
| 2 (Laidley, Capuano — Category B, **not** in Population B) | already-registered players under a different path | **Yes** (3208, 9198) | **CORRECT EVIDENCE** — parent-evidence correction, still gated on D-2/D-9 |

**Nothing is withheld for want of identity evidence. Everything is withheld for want of an
authorising decision.** That is a materially different blocker from the one §12 described.

**One honest caveat on all 92.** §13.3's AFL API side was read from `-031725`, not the Route A
acceptance snapshot `-011148`, whose bytes are absent (§13.5). For formal acceptance the join must be
re-derived on `-011148` (or on whichever snapshot D-7/§13.5 makes authoritative) and published as a
tracked artefact with its own hash. The identity conclusions are not expected to move — the two
snapshots agree on 217/669/9,983 exactly — but **expected is not verified**, and the re-derivation is
a named step in §13.8, not an assumption.

## 13.8 Execution-route comparison and the recommended smallest route (Task 6)

| Route | Mutation scope | Evidence required | Refusal / rollback | Rebuild durability | Duplicate risk | Covers all 92? | Before rollover? | Size | Owner |
|---|---|---|---|---|---|---|---|---|---|
| **R-a. Track 1 rollover** (`import_fitzroy_core.py` on a 2026-extended accepted baseline) | Very large: accepted baseline, heights binding, Stage-9 gate, `seasons.json`; can DELETE `afltables` identities and flip `resolved`→`unique` | A full-history accepted snapshot for 1897–2026 | Whole-batch rollback in `import_batch` | Native | Lowest | Yes | **No** — needs the season complete and a new accepted baseline | Very large | **Successor issue (D-4)**, not ISSUE-224 |
| **R-b. Track 2 admin pair** (`createPlayerAction` → `attachAflTablesIdentityAction`, ×92) | Smallest possible: 92 players + 92 `afltables` identities + audit rows | Phase 2 + Phase 3 + §13.3 | Per-person transaction; `RollbackRefusal` on a missing audit row; each attach individually reversible | **Yes** — via `replay_admin_overrides` | Low **provided create and attach are paired** (§13.6.3) | Yes | **Yes** | 184 super_admin UI actions — large manual surface, no new code | **ISSUE-224** |
| **R-c. Offline registration artefact + a new fail-closed writer** | Same 92+92 rows, but driven from a hash-pinned tracked artefact | Same, published as one artefact | Designed fail-closed; whole-batch rollback | Needs to write the same `data_overrides` records R-b writes, or it is not replay-durable | Low, and *uniformly* enforced rather than per-click | Yes | Yes | New tool + contract test; must not become §4.2's rejected **R3** | **ISSUE-224** |
| **R-d. Do nothing; wait for R-a** | None | None | n/a | n/a | None | n/a | n/a | None | status quo — **this is what Phase 3 currently authorises** |

**Recommendation — R-b, scripted-in-sequence but not re-implemented.** It is the only route that is
simultaneously available today, already reviewed, replay-durable, individually reversible, and adds
**no new writer** to a subsystem whose whole design premise is that *"a new player is always a human
decision"*. R-c is attractive at 92 rows and is the right shape *if* the operator wants one
hash-pinned artefact instead of 184 clicks — but it must reuse `createPlayerInTransaction` and
`attachAflTablesIdentity` rather than writing `players`/`external_identities` directly, or it
degenerates into the already-rejected R3. **R-a remains the correct durable answer and remains the
successor issue's work (D-4); ISSUE-224 consumes its result and does not execute it.**

**What must NOT be done, restated:** no loosening of `REGISTRATION_SQL`, of
`apply_authority()`'s `len(candidates) != 1` HALT, or of the settle's §17.3 rule; no edited
deployment child; no `import_draftguru.py` without `--link-only`; no invocation of
`enrich_birth_dates.py`; no bypass of `--require-complete-source` (Route A, operator, 2026-09-22).

## 13.9 Operator decisions added by this pass

| # | Decision | Why it cannot be decided here |
|---|---|---|
| **D-7** | **Re-decide Phase 3 for the 92: `defer-to-rollover` → `register`?** The 2026-09-19 verdict artefact authorises zero registrations; ISSUE-228 Route A (2026-09-22) requires them. Two dated operator decisions conflict. A re-decision means a **new** verdict artefact with a new `rows_sha256` — the 2026-09-19 one is byte-bound and must not be rewritten. | §5 Phase 3: "No decision file, no registration." Only the operator authors that file. |
| **D-8** | **How do the 92's canonical 2026 `player_match_stats` rows get created (§13.6.2 step 2)?** The AFL Tables in-season settle of 2026, or the Track 1 rollover? Without this step the AFL API bridge cannot link on a stat vector and `unresolvedIdentityPlayer` stays at 92 **even after registration succeeds**. | Newly identified; in neither issue's plan. It is a settle/rollover sequencing decision spanning ISSUE-224, ISSUE-228 and the D-4 successor. |
| **D-9b** | **Which AFL API snapshot is authoritative for S9 acceptance?** `-011148`'s bytes are absent locally (§13.5). Recover them, or promote `-031725` with its own hash and provenance. | ISSUE-228's decision; ISSUE-224 only reports the fact. Not to be resolved by silent substitution. |
| **D-10** | **Run the DB-free `--validate-only --require-in-season` gate on `issue224-inseason-20260919`?** Its manifest says `completeness: "unvalidated"`, yet Phase 2 classified 94 people on its bytes. No database, no network, no DSN. | §9 reserves command execution to the operator. |

D-1 and D-1a are **answered and closed** by §13.1/§13.4. D-2 (Laidley/Capuano) and D-3/D-4/D-5/D-6
remain open as written.

## 13.10 Verdict and the smallest next executable phase

**Verdict: C — BLOCKED ON OPERATOR IDENTITY ADJUDICATION**, where "adjudication" means **the
authorising decision, not the identity evidence.** The identity question this pass was asked to
settle is settled: 92 of 92 on strong, name-free, source-to-source stat-vector evidence, zero
withheld for want of evidence. What blocks execution is D-7 — a Phase 3 artefact that currently
authorises zero registrations while Route A requires 92 — compounded by D-8, a sequencing step in
nobody's plan.

**Smallest next executable phase (offline, no database, no network, no Git):** publish the §13.3 join
as a tracked artefact — `docs/rebuild-manifests/draftguru/issue224-s9-target-set-<date>.json`, one
row per provider carrying `CD_I…`, the AFL Tables path, per-match agreeing-stat counts, the
unanimous/non-unanimous grade, the declared AFL API snapshot label, and a `rows_sha256` in the
established style — so that D-7 is decided against a hash-pinned artefact rather than against a
transcript. **Nothing after that is executable until D-7 and D-8 are answered.**

## 13.11 Boundary statement for this pass

Documentation edits only: this file, `issues.md`, `IssuesIndex.md`. **No Git mutation. No SQL or
PostgreSQL connection. No network fetch. No deployment or `systemctl`. No code edit. No test,
typecheck or build. No subagent. No evidence artefact modified** — the two byte-bound artefacts were
read and their hashes confirmed unchanged (`bridge-operator-verdicts-issue224-20260919-v1.json`
79,486 bytes / `3C7B5AFF…`; `issue224-population-classification-20260919.json` 52,845 bytes /
`0765392A…`). `.gitattributes` untouched. ISSUE-228's reconciled content is untouched.

---

# 14. The S9 target set is now a hash-pinned artefact (2026-09-22, target-set pass)

§13.10's "smallest next executable phase" is **DONE**. The §13.3 join no longer lives only in a
console transcript: it is a tracked, deterministic, independently re-derived artefact, and a
committed builder reproduces it from source bytes.

## 14.1 The artefact

| Field | Value |
|---|---|
| Path | `docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json` |
| Size | 152,460 bytes |
| `sha256` | `e087baf706effdda8034a37cc184311687dee3c49f3e3e23a1e746beb347dcb0` |
| `rows_sha256` | `75bd9576ab3d33f19f2e148dffa22642c429a54b932f3e64ec87a9e6aa147f9c` |
| `kind` | `issue224_s9_target_set` |
| Builder | `tools/rebuild/draftguru/build_issue224_s9_target_set.py` v1.0.0 |
| `generated_at` | `2026-09-22T00:00:00Z` — a **frozen argument**, not a wall-clock time, so the output is byte-reproducible |
| `database_access` / `network_access` | `NOT_PERFORMED` / `NOT_PERFORMED` |

**This artefact did not re-use §13.3's numbers.** The builder re-derives the whole join from source
bytes and every count reproduced independently and exactly, including the per-stat detail of the two
same-fixture discrepancies (Byrne `Frees.Against` 1 vs 0; Hall-Kahan `Kicks` 17 vs 16 and
`Clearances` 1 vs 0), which were *not* given to it.

## 14.2 Counts, as measured by the builder and re-verified independently

| Measure | Value |
|---|---|
| AFL API unresolved providers in the accepted bridge | **92** |
| Target rows | **92** |
| Unique AFL API providers | **92** |
| Unique AFL Tables profile paths | **92** (a bijection) |
| Unanimous (every match agrees on the exact 13-stat vector) | **87** |
| Single candidate, one non-agreeing match, zero competing candidates | **5** |
| Ambiguous | **0** |
| Unmatched (no vector hit anywhere) | **0** |
| Rows with a competing candidate | **0** |
| Population A Category A total / covered / Population A-only | **92 / 92 / 0** |
| Population B-only | **0** |
| `Career.Games` first-2026 discriminator = 1 | **92 of 92** |
| `(club, jumper, core-vector)` keys resolving to >1 profile, over all 9,890 AFL Tables rows | **0** |
| `evidence_grade` | `STRONG_IDENTITY_EVIDENCE` x 92 |
| `disposition` | `REGISTER` x 92 |
| `WITHHOLD` / `HALT` | **0 / 0** |

`name_based_candidate_discovery` is **false** in the artefact and in the builder: names never
discover, propose or break a tie. They are retained per row (`afl_api_observed_name`,
`afltables_observed_names`) as human-readable metadata only.

**One honest refinement of §13.3.** §13.3 recorded surname agreement as holding "92/92" with two
explained artefacts. Measured mechanically by the naive last-whitespace-token rule the builder uses,
it is **89 of 92**, with **three** explained artefacts, not two: `Alex Van Wyk` and
`Hussien El Achkar` (multi-token surnames) and **`Balyn O'Brien` -> `Balyn OBrien`** (AFL Tables
strips the apostrophe). All three resolve on inspection. This changes nothing: surname agreement is
`surname_equality_is_validation_only` in the bridge's own acceptance rule, it is recorded per row as
`surname_agreement_validation_only`, and **no row's identity rests on it**. §13.3's "92/92" is
corrected to "89/92 by the mechanical rule, 92/92 after the three multi-token/apostrophe artefacts
are read".

## 14.3 The five non-unanimous rows, re-derived

All five retain **exactly one** candidate and **zero** competing candidates.

| Provider | Name | API rows / agreeing | AFL Tables rows at target | Path | Diagnosis, derived not asserted |
|---|---|---|---|---|---|
| `CD_I1007053` | Billy Cootee | 11 / 10 | 10 | `players/B/Billy_Cootee.html` | `CD_M20260142802` -> `no_afltables_row_for_this_fixture`. The target profile has **no unaccounted AFL Tables row**, so this is **absence, not contradiction** |
| `CD_I1037405` | Harry Kyle | 12 / 11 | 11 | `players/H/Harry_Kyle.html` | `CD_M20260142802` -> same absence |
| `CD_I1029417` | Max Beattie | 4 / 3 | 3 | `players/M/Max_Beattie.html` | `CD_M20260142801` -> same absence |
| `CD_I1036426` | Talor Byrne | 20 / 19 | 20 | `players/T/Talor_Byrne.html` | `CD_M20260141107` -> `core_vector_disagreement_same_fixture`, AFL Tables round 12 / 2026-05-23, **12 of 13** core columns identical, `Frees.Against` API 1 vs AFL Tables 0 |
| `CD_I1023273` | Hugo Hall-Kahan | 13 / 12 | 13 | `players/H/Hugo_Hall-Kahan.html` | `CD_M20260142702` -> `core_vector_disagreement_same_fixture`, AFL Tables SF / 2026-09-12, **11 of 13** identical, `Kicks` API 17 vs 16 and `Clearances` API 1 vs 0 |

The absence/disagreement split is **computed**, not stated: a non-agreeing API row is a same-fixture
disagreement only when the target profile carries an AFL Tables row that no API row accounts for; if
it carries none, the AFL Tables extraction simply has no row for that game. Three absences and two
disagreements fall out of that test with no input from §13.3's prose.

## 14.4 Builder contract

`tools/rebuild/draftguru/build_issue224_s9_target_set.py` — offline, no DB, no network, no `.env`.

**Fail-closed on:** duplicate AFL API provider; duplicate AFL Tables target; zero candidates; more
than one candidate; a target outside Category A; Population A coverage != 92; Population B coverage
!= 92; any ambiguous `(club, jumper, core-vector)` key anywhere in the season; a Category A path
claimed by no provider; a failed `Career.Games` discriminator; a non-integral statistic on either
side; an AFL API team id absent from `afl-api-identities.json`; a snapshot file whose hash does not
match the snapshot's own manifest; a byte-bound evidence file whose size or hash has moved; and an
existing output whose bytes differ (it **refuses**, it does not overwrite).

**Hash-verified before use:** the two byte-bound ISSUE-224 artefacts (size **and** sha256, as
constants in the tool); `player_stats_2026.csv` against the tracked
`issue224-inseason-20260919.json` manifest (hash **and** row count); and every
`CD_M*/player-stats.json` against the AFL API snapshot's own `manifest.json`.

**Snapshot-neutral by construction.** `--afl-api-snapshot-dir` is required and the tool records
whatever label that snapshot's manifest declares. It asserts **nothing** about which snapshot is the
S9 acceptance snapshot, and it re-runs unchanged against the `-011148` bytes if they are recovered.
The artefact carries `acceptance_snapshot_pinned_by_bridge: afl-api-2026-2026-09-21-011148`,
`acceptance_snapshot_manifest_sha256_pinned_by_bridge: dcbd0626...`,
`acceptance_snapshot_bytes_available: false`, and an `acceptance_snapshot_note` stating in the
artefact itself that `-031725` is **not** offered as proof of `-011148` and that promotion or
recovery is **ISSUE-228 decision D-9b**.

Command as run:

```
python tools/rebuild/draftguru/build_issue224_s9_target_set.py \
  --afl-api-snapshot-dir "D:/dev/afldb/data/sources/afl_api/matches/afl-api-2026-2026-09-21-031725" \
  --player-stats-dir "D:/dev/afldb-issue-224/data/sources/afltables/fitzroy_core/issue224-inseason-20260919"
```

## 14.5 Validation performed (offline only; no PostgreSQL)

| # | Check | Result |
|---|---|---|
| 1 | Build the artefact | 92 rows written |
| 2 | Recompute the file `sha256` with `sha256sum`, independently of the tool | `e087baf7...` — matches |
| 3 | Recompute `rows_sha256` in a separate process from the artefact's own `rows` | `75bd9576...` — matches |
| 4 | Re-assert every count from the written file (rows, unique providers, unique paths, dispositions, grades, agreement, competing, discriminator, Category A classification) | 92 / 92 / 92 / `REGISTER` x92 / `STRONG_IDENTITY_EVIDENCE` x92 / 87+5 / competing 0 / discriminator 92 / `genuine_post_baseline_afl_debutant` x92 |
| 5 | Re-run the builder; build again to a second path; `cmp` the two | **byte-identical**; on-disk artefact hash unchanged |
| 6 | Fail-closed: point `--out` at a file with different bytes | **REFUSED**, exit 2, target left untouched |
| 7 | Fail-closed: run against a scratch root holding a tampered classification artefact | **REFUSED**, exit 2, naming the size drift |
| 8 | Re-verify the two byte-bound evidence files after the pass | `bridge-operator-verdicts-issue224-20260919-v1.json` 79,486 / `3C7B5AFF...` OK; `issue224-population-classification-20260919.json` 52,845 / `0765392A...` OK — **unchanged** |
| 9 | Re-verify the source inputs | `player_stats_2026.csv` `d150d4bc...` OK; AFL API snapshot `manifest.json` `5018a3d6...` OK |

No PostgreSQL test, no integration test, no typecheck, no build. None is needed: the builder touches
no application code path and the artefact is inert evidence.

## 14.6 What this artefact does and does not authorise

**Does:** it establishes, on retained hash-pinned evidence rather than a transcript, that the 92 AFL
API unresolved providers and ISSUE-224 Category A's 92 AFL Tables profiles are the **same 92
footballers**, on club + jumper + exact-13-stat-vector evidence with a season-unique key and no name
input. From an identity-evidence perspective there are **92 REGISTER candidates and 0 withheld**.

**Does not:** authorise registration. The Phase 3 operator disposition (`register 0`,
`defer-to-rollover 92`) is **unchanged** and the byte-bound verdict artefact was not touched. The
artefact records this in its own `phase3_disposition_not_superseded` block and sets
`authorisation.registration_authorised: false` with `blocking_decisions: ["D-7", "D-8"]`.

**D-9b remains ISSUE-228's.** The authoritative `-011148` snapshot bytes are absent from local disk
while `-031725` is present. `-031725` is **not** claimed here to prove `-011148`, and it has **not**
been substituted for it in ISSUE-228. Nothing in this pass resolves D-9b.

## 14.7 Decisions still open, restated verbatim for operator approval

See §13.9 for D-7's and D-8's rationale. The wording put to the operator by this pass:

> **D-7.** Should the earlier ISSUE-224 Phase 3 disposition — `register = 0`,
> `defer_to_rollover = 92`, recorded in
> `docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-20260919-v1.json`
> (79,486 bytes, sha256 `3C7B5AFF...`, operator "Stu", 2026-09-19T08:02:24Z) — be **superseded for
> the ISSUE-228 S9 unblock**, now that the hash-pinned target set
> `docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json` (sha256 `e087baf7...`,
> `rows_sha256 75bd9576...`) establishes **92 of 92 strong, name-free identities** with 0 ambiguous,
> 0 unmatched and 0 competing candidates?
>
> Approving D-7 means authoring a **new** Phase 3 verdict artefact with its own `rows_sha256`. The
> 2026-09-19 artefact is byte-bound and must not be rewritten. Declining D-7 leaves ISSUE-228 S9
> blocked and is a legitimate answer.

> **D-8.** If D-7 is approved, do you also approve the sequencing requirement below as the **only**
> order that terminates — noting that step 2 is in neither issue's current plan, and that
> registering the 92 AFL Tables identities does **not** by itself move `unresolvedIdentityPlayer` at
> all (§13.6.1)?
>
> ```
> 1. register 92 canonical players + their afltables profile identities   [ISSUE-224]
> 2. DEV AFL Tables 2026 settle -> creates canonical player_match_stats   [NEW, currently unowned]
> 3. rebuild the AFL API stat-vector bridge                              [ISSUE-228]
> 4. import the 92 afl_api identity links                                [ISSUE-228]
> 5. AFL API settle with --require-complete-source                       [ISSUE-228]
> ```
>
> Approving D-8 authorises the **order only**. It does not authorise any step to run, and no step was
> run in this pass.

## 14.8 Boundary statement for this pass

**Written:** `tools/rebuild/draftguru/build_issue224_s9_target_set.py` (new),
`docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json` (new), this file,
`issues.md`, `IssuesIndex.md`.

**Executed:** the new offline builder, `sha256sum`, `cmp`, and offline Python validation, all
operator-authorised for this task.

**NOT done:** no Git command of any kind (nothing staged, committed, reset or stashed); no SQL or
PostgreSQL connection; no network fetch; no acquisition; no `systemctl` or deployment; no edit to any
ISSUE-228 implementation file; no registration; no AFL Tables settle; no AFL API bridge import; no
AFL API settle; no change to either byte-bound historical evidence file (both re-verified unchanged);
no ISSUE-227 implementation; no subagent; no test, typecheck or build.

**Read outside this worktree, read-only, as declared in §13.4:**
`D:\dev\afldb\data\sources\afl_api\matches\afl-api-2026-2026-09-21-031725\` and
`D:\dev\afldb-issue-224\data\sources\afltables\fitzroy_core\issue224-inseason-20260919\`. Both hold
gitignored source bytes that exist in no worktree of their own; nothing in either was modified.

---

# 16. Operator decisions D-7 and D-8 — RECORDED APPROVED 2026-09-22

> **Nothing in this section was executed.** It records two operator authorisations and creates one
> new immutable artefact. No database write, no registration, no settle, no import, no network, no
> Git mutation occurred.

## 16.1 D-7 — APPROVED

**Decision (operator Stu, 2026-09-22).** The 2026-09-19 Phase 3 disposition — `register = 0`,
`defer_to_rollover = 92` — is **SUPERSEDED FOR THE SPECIFIC PURPOSE OF ISSUE-228 S9 UNBLOCKING AND
FOR NO OTHER PURPOSE**. The 92 Category A players identified by
`docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json` are **authorised
registration candidates**.

The 2026-09-19 verdict artefact
`docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-20260919-v1.json` is **byte-bound
and was NOT modified.** It remains the authoritative historical record of what was decided that day.
It was re-verified unchanged after this pass.

### 16.1.1 The new immutable decision artefact

A **new** artefact was created rather than the historical one edited:

| Field | Value |
|---|---|
| Path | `docs/rebuild-manifests/draftguru/issue224-d7-registration-decision-20260922.json` |
| sha256 | `a795c987ca62cf879cb2ecc3bb61d9e1533eae84882956c442ff252de307be3d` |
| `rows_sha256` (92 row-level decisions) | `0a3d13387352c610782330058c889456c3f3ca57ab1143aee88766144711e083` |
| Builder | `tools/rebuild/draftguru/build_issue224_d7_decision.py` (new) |
| Reproducibility | deterministic — frozen decision date, sorted keys, ASCII-escaped, LF newlines, `--check` mode compares on-disk bytes; two independent runs produced identical bytes |
| Byte protection | `.gitattributes` `-text -diff !eol`, matching the convention already used for the two 2026-09-19 byte-bound artefacts |

It records: operator `Stu`; decision date `2026-09-22`; `register = 92`; `defer_to_rollover = 0`
(for this S9-specific path); `identity_withheld = 0`; `halt = 0`; the target-set path, sha256 and
`rows_sha256`; the superseded artefact's own sha256; and an explicit
`historical_artefact_retained_unchanged: true` / `superseded_for_any_other_purpose: false`.

The builder **fail-closes**: it refuses unless the target set matches both pinned hashes, recomputes
the target set's `rows_sha256` rather than trusting it, and refuses any row the target set did not
itself disposition `REGISTER`, or any duplicate provider or AFL Tables path.

### 16.1.2 The evidence D-7 rests on

92/92 strong identity evidence; bijective AFL API provider → AFL Tables profile mapping (92 unique
providers, 92 unique paths); 87 unanimous; 5 single-candidate non-unanimous; **0 ambiguous, 0
unmatched, 0 competing candidates**; `name_based_candidate_discovery = false`.

**Surname validation is recorded as the measured 89/92, corrected from an earlier 92/92 statement,
and is VALIDATION-ONLY.** It carries **no identity consequence**: candidate discovery is name-free
and surname equality is never a matching key. The artefact records the correction and the reason
explicitly so the count is not later read as an identity weakening.

### 16.1.3 What D-7 does not do

**D-7 does NOT authorise a database write.** It authorises the *population*, not any execution. The
artefact states this in `authorises`: `database_write: false`,
`player_registration_execution: false`, `afltables_settle: false`, `afl_api_bridge_rebuild: false`,
`afl_api_bridge_import: false`, `afl_api_settle: false`.

## 16.2 D-8 — APPROVED (sequence only)

**Recorded wording.** The following is approved as the **required DEV-only execution order**:

```text
1. Register the 92 canonical players and their AFL Tables profile identities   [ISSUE-224]
2. Perform ONE deliberate DEV AFL Tables 2026 settle                           [ISSUE-224]
     purpose: populate canonical player_match_stats for the newly registered players
3. Rebuild the AFL API stat-vector bridge                                      [ISSUE-228]
4. Import the newly resolved AFL API identity links                            [ISSUE-228]
5. Re-run the AFL API settle with --require-complete-source                    [ISSUE-228]
     required: unresolvedIdentityPlayer = 0
```

**D-8 approves the SEQUENCE ONLY. It does NOT authorise execution of steps 1–5 in this pass, and
none of them was run.**

**The automatic AFL Tables timer remains OFF on both DEV and PROD. Neither timer is to be enabled.**
The step 2 DEV AFL Tables settle is a **single controlled manual operation**, not a timer
installation and not a recurring job.

Steps 3–5 are ISSUE-228's and, per D-9b (ISSUE-228 §20), must run against
`afl-api-2026-2026-09-21-031725` as **one coherent 669-provider population**. Carrying the existing
577 links forward into step 4 is forbidden (ISSUE-228 §20.5.1).

## 16.3 D-9b — RESOLVED by ISSUE-228, recorded here for reference

**Option B.** `-011148` is formally superseded as the S9 acceptance snapshot by the retained,
hash-verified `-031725` (manifest sha256 `5018a3d6…`). Full analysis, the A/B/C comparison and the
evidence: **ISSUE-228 §20**.

**Effect on ISSUE-224:** none adverse. The 92-row target set was already built against `-031725` and
hash-verifies, so it **remains directly applicable and needs no rebuild**. The §13.5 obstacle is
therefore cleared, and §14.6's "D-9b remains ISSUE-228's / unresolved" statement is superseded.

## 16.4 Status after this pass

| Item | State |
|---|---|
| D-7 | **APPROVED**, artefact created and hash-verified |
| D-8 | **APPROVED**, sequence only, nothing executed |
| D-9b | **RESOLVED** (option B, ISSUE-228 §20) |
| Blocking decisions remaining | **none** — the next phase is executable work, separately authorised |
| Database execution | **NONE has occurred** |
| AFL Tables timer, DEV and PROD | **OFF**, unchanged, not to be enabled |
| ISSUE-224 | **OPEN — not complete** |
| ISSUE-228 S9 | **NOT accepted** |
| DEV | **NOT claimed deployed** |

**Note on the target set's own `authorisation` block.** The target-set artefact records
`registration_authorised: false` with `blocking_decisions: ["D-7", "D-8"]`. That artefact is
hash-pinned and is deliberately **not** edited; D-7 and D-8 being approved is recorded here and in
the new decision artefact, which is the later evidence. Read together: the population is authorised,
the execution is not yet.

## 16.5 Exact next executable phase

**D-8 step 1 — register the 92 canonical players and their AFL Tables profile identities on DEV**,
per the §13.6.3 registration contract, gated on the two prerequisites already named in §13.8:

1. Run the AFL Tables snapshot's own declared verdict authority, which is DB-free and network-free:
   `tools/migration/import_fitzroy_core.py --label issue224-inseason-20260919 --validate-only
   --require-in-season`. The `issue224-inseason-20260919` manifest still records
   `completeness: "unvalidated"` and this gate is **not waived**.
2. Obtain explicit operator authorisation to execute database writes on DEV (§9).

Nothing before that requires a further operator decision.

## 16.6 Boundary statement for this pass

**Written:** `tools/rebuild/draftguru/build_issue224_d7_decision.py` (new),
`docs/rebuild-manifests/draftguru/issue224-d7-registration-decision-20260922.json` (new),
`.gitattributes`, this file, `issues/open/AFLDB-ISSUE-228.md`, `issues.md`, `IssuesIndex.md`,
`docs/acquisition/AFLDB-2026-API-ACQUISITION.md`.

**Executed:** the new offline builder (write and `--check`), `sha256sum`, `git check-attr`,
`git status --porcelain` (read-only inspection), and offline Python hash/census verification — all
operator-authorised for this task.

**NOT done:** no SQL or PostgreSQL connection; no network fetch or acquisition; no player
registration; no AFL Tables settle; no AFL API bridge rebuild or import; no AFL API settle; no
`systemctl`, timer installation or timer enablement; no deployment; no Git mutation of any kind
(nothing staged, committed, reset or stashed); no modification of any byte-bound historical evidence
file (both 2026-09-19 artefacts and the target set re-verified unchanged); no ISSUE-227 work; no
subagent; no test, typecheck or build.

**Read outside this worktree, read-only:**
`D:\dev\afldb\data\sources\afl_api\matches\afl-api-2026-2026-09-21-031725\` (652 manifested files
hash-verified; nothing modified).

---

# 17. PRE-REGISTRATION SNAPSHOT VALIDATION — **PASSED** (operator-run, 2026-09-22)

**This section records operator-executed evidence only. It authorises nothing further than it
states, and it does not close ISSUE-224 or accept ISSUE-228 S9.**

## 17.1 What was run

The §16.5 / §13.8 prerequisite (a) — the AFL Tables snapshot's own declared, DB-free, network-free
verdict authority — was executed by the operator:

```text
python tools/migration/import_fitzroy_core.py \
  --label issue224-inseason-20260919 \
  --validate-only \
  --require-in-season
```

**Exit code `0`.** Importer output: `in-season gates PASSED — identity coverage`;
`Validation complete in 0.3s (no database access)`.

## 17.2 Snapshot scan summary, as reported

| Metric | Value |
|---|---|
| `matches` | 215 |
| `matches_with_player_rows` | 215 |
| `attendance_known` | 215 |
| `players` | 669 |
| `players_with_dob` | 665 |
| `players_with_dob_conflict` | **0** |
| `players_with_renumbered_profile` | **0** |
| `player_match_rows` | 9,890 |
| `venues` | 17 |
| `seasons` | 2026–2026 |
| `brownlow_round_vote_rows` | 0 |

## 17.3 In-season identity gates, as reported

| Gate metric | Value |
|---|---|
| `rows` | 9,890 |
| `missing_id` | 86 |
| `missing_url` | **0** |
| `malformed_url` | **0** |
| `distinct_ids` | 664 |
| `distinct_urls` | **669** |

**`missing_id = 86` is NOT a failed gate.** The importer — the declared verdict authority — accepted
the snapshot and returned exit code `0` with `missing_url = 0` and `malformed_url = 0`. The identity
that ISSUE-224 registration and the §13.6.3 contract turn on is the **profile URL**, and URL coverage
is complete: 669 distinct URLs for 669 distinct players, exactly the population both sources
independently see (§13.3, §14.2). No re-interpretation of this result is offered here.

## 17.4 Snapshot provenance for this run

Before validation the raw snapshot was copied **read-only** from

```text
D:\dev\afldb-issue-224\data\sources\afltables\fitzroy_core\issue224-inseason-20260919
```

into this worktree's **gitignored** `data/sources` tree, and verified byte-identical:

| File | Bytes | SHA256 |
|---|---|---|
| `player_stats_2026.csv` | 4,452,274 | `D150D4BCC736C345F9E2D884EB3B57E25F1D6D0497EA1223CD8AF3773AD08C36` |
| `results.csv` | 21,405 | `EC767923DA6803B7C62788843E6BBEBA69DCEA4EF618406BBD452A9AF52D39CB` |

This is the same snapshot given verdict **A — PRESENT AND MATCHES** in §13.4, now resident in the
working worktree rather than only in the sibling one. Nothing in `docs/rebuild-manifests/` was
touched.

## 17.5 Consequences

- **Pre-registration snapshot validation: PASSED.**
- **D-10 is ANSWERED by execution** — the gate was run and passed; it is **not waived**. Note that
  the tracked manifest `docs/rebuild-manifests/afltables_fitzroy_core/issue224-inseason-20260919.json`
  still records `completeness: "unvalidated"` on disk; it is byte-bound evidence and was deliberately
  **not** edited. The passing run recorded here is the later evidence. See §17.7.
- **§16.5 prerequisite (a) is SATISFIED.** Prerequisite (b) — explicit operator authorisation to
  execute database writes on DEV (§9) — **remains outstanding**.
- **D-7 and D-8 remain APPROVED** (§16.1, §16.2); this run changes neither.
- **D-9b remains RESOLVED** (option B): the authoritative S9 snapshot is `-031725`
  (manifest sha256 `5018a3d6…`); `-011148` is formally superseded (§16.3, ISSUE-228 §20).

## 17.6 What did NOT happen

- **No database access occurred** (the importer itself states this; `--validate-only`).
- **No player registration has occurred** — the 92 authorised candidates are unregistered.
- **No settle has occurred**, AFL Tables or AFL API. Both AFL Tables timers remain **OFF** on DEV
  and PROD.
- **ISSUE-224 is NOT complete. ISSUE-228 S9 is NOT accepted. DEV is NOT claimed deployed.**

## 17.7 Contradiction noted, not resolved

The manifest's `completeness: "unvalidated"` field and this passing validation now disagree on the
face of the record. The disagreement is **recorded, not silently reconciled**: the manifest is
byte-bound evidence and this pass does not edit byte-bound artefacts. Superseding that field, if the
operator wants it superseded, is a separate authored-artefact decision of the same kind as D-7.

## 17.8 Exact next executable phase

**D-8 step 1 — register the 92 canonical players and their AFL Tables profile identities on DEV**,
per the §13.6.3 registration contract, via route **R-b** (the reviewed Track 2 admin pair
`createPlayerAction` → `attachAflTablesIdentityAction`), against the hash-pinned target set
`docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json` and the D-7 decision artefact
`docs/rebuild-manifests/draftguru/issue224-d7-registration-decision-20260922.json`.

**Gate remaining: explicit operator authorisation to execute database writes on DEV (§9).** No
further operator *decision* is required.

## 17.9 Boundary statement for this pass

**Written:** this file (§17), `issues.md`, `IssuesIndex.md`. Nothing else.

**Executed by Claude:** nothing. No shell, Git, SQL, network, test, typecheck, build, deployment or
script execution; no subagent. The validation above was run by the operator and is transcribed, not
reproduced.

**NOT done:** no code change; no modification of any evidence artefact, manifest, decision artefact
or target set; no registration; no settle; no timer change; no Git mutation of any kind.

## 18.1 D-8 step 1 implemented and proven on `afldb_test` (this pass)

Worktree `D:\dev\afldb-issue-224-s9`, branch `sonnet/issue-224-s9-unblock`, HEAD `81fd2bb7` at
start. Uncommitted.

### 18.1.1 Implementation

- **`src/db/queries/admin-draft.ts`** — `attachAflTablesIdentity`'s transaction body extracted
  unchanged into a new exported `attachAflTablesIdentityInTransaction(tx, input)`;
  `attachAflTablesIdentity` is now a thin wrapper over it (opens its own connection exactly as
  before). Byte-behaviour of every existing caller is unchanged; this is the ONE code change to
  a production module.
- **`tools/rebuild/draftguru/register_issue224_s9_players.ts`** (new) — the batch registration
  runner. Reuses `createPlayerInTransaction` (`src/db/queries/players.ts`, unchanged) and the new
  `attachAflTablesIdentityInTransaction` — the SAME primitives `/admin/draft`'s manual-player
  route R-b uses (§17.8). No ad-hoc `INSERT` was written. The AFL API provider id is read from the
  artefacts only for the audit note; nothing writes an AFL API `external_identities` row (D-8 step
  2 remains untouched, per the §17.8 gate).

### 18.1.2 Safety gates implemented

- Both retained artefacts re-hashed and compared against the pinned SHA256 the operator supplied
  before any content is trusted; refuses on any byte difference.
- Row count == 92, all `disposition`/`decision` == `REGISTER`, no duplicate AFL API provider id, no
  duplicate AFL Tables path, target-set/D-7 rows cross-checked 1:1 by `afltables_external_id`
  (provider id and `draftguru_player_url` must agree), exactly one distinct
  `afltables_observed_names` value per row (display-name source — AFL Tables is the registration
  authority, never AFL API).
- Classification (CREATE / ALREADY_SATISFIED / CONFLICT) computed from `external_identities`
  inside the SAME transaction the writes run in; an AFLDB-ISSUE-160 D-2-style guard also refuses a
  CREATE that collides by name with an existing manual player shell that has no AFL Tables identity
  yet (translated from `import_fitzroy_core.load_manual_identity_candidates` /
  `refuse_unsafe_manual_insert`).
- One outer transaction for the whole batch: a single CONFLICT refuses all 92 writes before any of
  them lands (Task 6 — no partial-batch cleanup path exists or is needed).
- Closed two-entry target list (`test` -> `afldb_test`, `dev` -> `afldb_dev`; no PROD entry).
  `--apply` combined with `--target dev` is refused at argument-parsing time, before any DSN is
  even read. DEV connects with `default_transaction_read_only` as a STARTUP parameter (never a
  post-connect `SET`) and the live session is re-proven read-only before any query runs.
  `current_database()` (and, added during this pass, `current_user`) is asserted against the
  expected value before the first statement on every connection.

### 18.1.3 `afldb_test` results

Reached via the operator-provided tunnel `127.0.0.1:55432`; `AFLDB_TEST_IMPORT_DATABASE_URL`
derived by swapping the host/port of the existing `AFLDB_IMPORT_DATABASE_URL` (role
`afldb_import`, unchanged password) onto database `afldb_test`, per the operator's explicit
instruction. `--admin-user-id 79` (an existing `auth_users` `super_admin` row on `afldb_test`,
looked up read-only; `data_overrides.admin_user_id` FK requires a real row).

**BEFORE:** `players` = 13,338; AFL-Tables-resolved `external_identities` = 13,275.

**Dry-run (no `--apply`):** `CREATE=92 ALREADY_SATISFIED=0 CONFLICT=0 TOTAL=92`.

**First `--apply`:** `current_database()='afldb_test'`, `current_user='afldb_import'` proven before
writing. 92 players created (ids 21875–21966) and attached to their AFL Tables identity; 0
conflicts.

**Post-apply integrity (afldb_test owner role, read-only queries):**

| Check | Result |
|---|---|
| `players` count | 13,430 (13,338 + 92 ✓) |
| AFL-Tables-resolved `external_identities` | 13,367 (13,275 + 92 ✓) |
| A player_id claimed by >1 AFL Tables identity | 0 |
| Duplicate `slug` among the 92 new players | 0 |
| New player with no AFL Tables identity attached | 0 |
| `player_career_stats` rows for the 92 | 92 (zero-game shells, as `createPlayerInTransaction` seeds) |
| `data_overrides('players','identity')` rows carrying `afltables_profile_path`, `admin_user_id=79` | 92 |
| `data_edits` rows, `table_name='players'`, `field_group='source_identity'`, `admin_user_id=79` | 92 |

**Second `--apply` (idempotency):** `CREATE=0 ALREADY_SATISFIED=92 CONFLICT=0`; 0 players created;
`players` count unchanged at 13,430 — proven zero writes.

### 18.1.4 DEV read-only preflight (no write attempted or possible)

`AFLDB_DEV_DATABASE_URL` derived from the existing `DATABASE_URL` (role `afldb_app`, already the
low-privilege app/read role — no import-role DSN was used or considered for DEV) via the same
tunnel. `current_database()='afldb_dev'`, `current_user='afldb_app'` proven.

`CREATE=92 ALREADY_SATISFIED=0 CONFLICT=0 TOTAL=92` — operational goal (`CONFLICT=0`) met. One
caveat: the D-2 manual-shell name-collision guard could not run under `afldb_app` (`data_overrides`
has no `grant_app_read`, migration 073) and is reported as a WARNING rather than silently skipped;
it DID run, and passed, in every `afldb_test` classification above.

**No `--apply` was passed for `--target dev`; the tool refuses that combination before opening a
connection. No write occurred or was possible against `afldb_dev` in this pass.**

### 18.1.5 Exact next command that WOULD apply the batch to `afldb_dev` — NOT RUN

```
AFLDB_DEV_IMPORT_DATABASE_URL=<afldb_import role, /afldb_dev, via the operator's own tunnel/host> \
npx tsx --conditions=react-server tools/rebuild/draftguru/register_issue224_s9_players.ts \
  --admin-user-id <a real afldb_dev auth_users id> --target dev --apply
```

This command does not exist as a runnable path today: `resolveTarget('dev')` reads
`AFLDB_DEV_DATABASE_URL` (the read-only app DSN) and `parseArgs` refuses `--apply` with
`--target dev` unconditionally. Enabling a DEV write is a deliberate follow-up code change (a
distinct import-role DEV target), not a flag — consistent with the boundary that DEV writes need
their own explicit operator authorisation.

### 18.1.6 Status

**ISSUE-224 is still NOT complete. S9 acceptance claims are unchanged.** D-8 step 1 is proven safe
and idempotent on `afldb_test` only. D-8 step 2 (AFL API identity attach + bridge rebuild) has not
started. Nothing was committed to Git.

### 18.1.7 Repository-level validation of the S9 implementation (2026-09-22)

Static/DB-free validation of the uncommitted S9 change, run at the pre-DEV checkpoint. No database
write, no network call, no deployment and no `systemctl` action was taken.

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **PASS** (`next typegen` + `tsc --noEmit`, no diagnostics) |
| Targeted DB-free suites covering the modified module | `npx vitest run tests/admin-draft-actions.test.ts tests/data-overrides-source-contract.test.ts tests/player-link-mutations.test.ts tests/afl-api-match.test.ts` | **PASS** — 4 files, 274/274 assertions |
| Whole DB-free gate | `npx vitest run --exclude "tests/integration/**"` | 152/158 files pass, 5,784 passed / 7 failed / 37 skipped |
| Whitespace | `git diff --check` | clean |

**The 6 failing DB-free files are pre-existing and unrelated to this change.** None of
`special-records-replay-parity`, `draftguru-acquisition`, `finals-semantics-contract`,
`fitzroy-core-import`, `honours-lifecycle-public-contract` or `site-settings` imports
`src/db/queries/admin-draft.ts` (the only source file this pass modifies) or reads `issues.md` /
`IssuesIndex.md`. Known causes on record: `finals-semantics-contract` is the Windows CRLF contract
failure that passes on Linux; `draftguru-acquisition` fails on the absent
`data/sources/draftguru/annual-html-20260826` snapshot directory (the known Stage A label
mismatch); `site-settings` expects the `aflApiBrownlowEnabled` / `aflApiCurrentSeasonEnabled`
defaults added by the already-committed AFL API work.

**Coverage gap, stated rather than papered over.** The only automated coverage of
`attachAflTablesIdentity` — and therefore of the extracted
`attachAflTablesIdentityInTransaction` — is `tests/integration/admin-draft.test.ts`, which mutates
the real `afldb_test`. It was deliberately NOT run at this checkpoint (the operator brief forbids a
further `afldb_test` apply in this pass). No new test file was added: the extraction is a pure
refactor with no behavioural delta, and the database-level proof for it is §18.1.3, which exercised
the extracted function 92 times inside one transaction plus a second idempotent pass. Running
`tests/integration/admin-draft.test.ts` against `afldb_test` remains a cheap, worthwhile check
before any DEV apply.

**Standing gates, unchanged by this section.** `afldb_test` (§18.1.3) remains the database-level
proof; `afldb_dev` remains read-only with no write attempted or possible; and the AFLDB-ISSUE-160
D-2 manual-shell name-collision sub-check remains **mandatory under the DEV import role before any
DEV apply** — it is NOT waived by its `afldb_test` pass or by the `afldb_app` privilege warning in
§18.1.4.

## §18.2 — DEV import-role connection: blocker and code-level resolution (2026-09-22)

### 18.2.1 Blocker

An attempted privileged DEV preflight (to run the AFLDB-ISSUE-160 D-2 manual-shell
name-collision guard under `afldb_import` against `afldb_dev`, as §18.1.4/§18.1.7 require before
any DEV apply) found that **no DEV import-role DSN exists at all.** `AFLDB_DEV_DATABASE_URL` is
the only DEV variable the runner reads (`resolveTarget('dev')` at the time), and its own
documented contract (`.env.example`, then lines 75–84) explicitly forbids it from ever being
`afldb_import`: "log in as afldb_app ... never as afldb_owner or afldb_import." No DEV connection
was attempted with a guessed or substitute credential; nothing was read as a fallback. No database
connection occurred at any point in this discovery.

### 18.2.2 Resolution (code only — no DEV connection in this pass)

Added a second, purpose-built environment variable, `AFLDB_DEV_IMPORT_DATABASE_URL`
(`afldb_dev` / `afldb_import`, maintenance/import tooling only, never read by application/runtime
code, never a PROD connection, no fallback either direction with `AFLDB_DEV_DATABASE_URL`) and a
new `--dev-import-role` flag on
`tools/rebuild/draftguru/register_issue224_s9_players.ts`:

- `--target dev` (unchanged default): `AFLDB_DEV_DATABASE_URL`, now positively asserts
  `current_user = afldb_app` (previously only `current_database` was checked).
- `--target dev --dev-import-role`: `AFLDB_DEV_IMPORT_DATABASE_URL`, positively asserts
  `current_user = afldb_import`. Refuses if the variable is unset — no substitution of
  `AFLDB_DEV_DATABASE_URL`. Still read-only preflight only (`cfg.canApply = false`); the D-2 guard
  (`register_issue224_s9_players.ts` `classify()`) now runs for real in this mode instead of
  degrading to the `afldb_app` privilege warning.
- The existing hard refusal of `--target dev` + `--apply` is untouched and applies regardless of
  `--dev-import-role` (`parseArgs`'s check is on `target === 'dev'` alone) — proven in §18.2.3.
- `--dev-import-role` with `--target test` refuses (`"only valid with --target dev"`).
- No PROD target exists; unchanged.

`.env.example` documents both variables' contracts side by side, with no real credential
(`CHANGE_ME` placeholder, matching the existing convention).

### 18.2.3 Validation (no database connection, per this pass's boundaries)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **PASS**, no diagnostics |
| Isolated re-implementation of `resolveTarget`/`parseArgs`'s decision surface (7 cases: default DEV selects `AFLDB_DEV_DATABASE_URL`/`afldb_app`; `--dev-import-role` selects `AFLDB_DEV_IMPORT_DATABASE_URL`/`afldb_import`; missing privileged variable refuses with no fallback; `--target dev --dev-import-role --apply` refuses; `--target dev --apply` (no flag) still refuses; `--dev-import-role` + `--target test` refuses; no PROD target) | **7/7 PASS** |

The real module was not executed for this proof: importing it eagerly constructs the shared
`src/db/client.ts` singleton from `DATABASE_URL` (unrelated to `--target dev`), and running it
would require setting that variable even to reach argument parsing — avoided entirely to keep this
pass's "no DB connection" boundary literal rather than merely lazy-safe.

### 18.2.4 Status

Still **not** the D-2 preflight itself — this section is the connection path only. Next executable
step: operator supplies `AFLDB_DEV_IMPORT_DATABASE_URL` (or confirms it should stay unset for now),
then an explicitly authorised run of
`npx tsx --conditions=react-server tools/rebuild/draftguru/register_issue224_s9_players.ts --admin-user-id <n> --target dev --dev-import-role` (no `--apply`) to obtain the real D-2 census.
`afldb_dev` remains unwritten. ISSUE-224 remains BLOCKED per §18.1.6.

## §18.3 — Privileged DEV import-role preflight executed (2026-09-22)

Operator-run command (worktree `D:\dev\afldb-issue-224-s9`, branch `sonnet/issue-224-s9-unblock`,
HEAD `517f058b` at run time):

```
npx tsx --conditions=react-server \
  tools/rebuild/draftguru/register_issue224_s9_players.ts \
  --admin-user-id 4 --target dev --dev-import-role
```

**Connection proof (operator-reported console output):** `current_database()='afldb_dev'`,
`current_user='afldb_import'`, `mode=READ-ONLY PREFLIGHT`. No `--apply` was supplied, and
`--apply` remains refused outright for `--target dev` regardless of `--dev-import-role`
(`parseArgs`, §18.2.2) — a DEV write was not possible in this invocation, not merely unattempted.

**Audit identity:** `auth_users.id = 4`, role `super_admin`, active `true` — operator-selected for
this preflight's `--admin-user-id`; not independently re-queried in this pass (no DB access outside
the runner's own connection, per this pass's boundaries).

**Classification:** `CREATE=92 ALREADY_SATISFIED=0 CONFLICT=0 TOTAL=92`. No DEV write occurred.

**Guard results — verified from `classify()`'s control flow at
`register_issue224_s9_players.ts:223-334`, not inferred from the absence of console warnings:**

- **AFLDB-ISSUE-160 D-2 manual-shell name-collision guard: ran for real and passed.**
  `--dev-import-role` connects as `afldb_import`, which holds SELECT on `data_overrides`
  (migration 073), so the guard's query (lines 250-257) does not hit the `42501
  insufficient_privilege` catch (lines 263-270) that degraded it to a WARNING under the plain
  `afldb_app` DEV connection in §18.1.4. All 92 CREATE targets' normalised names were compared
  against pending manual-shell rows; 0 collisions found.
- **Multi-claimant "duplicate target identity" guard (lines 318-331): executed, but vacuous.**
  This is the in-code counterpart of §18.1.3's post-apply "player_id claimed by >1 AFL Tables
  identity" integrity check. It only reclassifies `ALREADY_SATISFIED` rows, and this run has none
  (`ALREADY_SATISFIED=0`), so the claimants map built at line 281 is empty and the loop at line 318
  has nothing to act on. Accurate framing: **the guard ran and found nothing to flag because there
  was nothing eligible for it to check**, not "checked N candidate identities and passed."
- **"Duplicate slug" guard: does not apply to this pass; not run.** §18.1.3's "Duplicate `slug`
  among the 92 new players | 0" is a post-`--apply` database query against real `players` rows on
  `afldb_test`, not part of `classify()`. This DEV preflight created no players (`--apply` refused
  for `--target dev` unconditionally), so there are no new rows for a slug-duplication check to run
  against on DEV in this pass. The `afldb_test` §18.1.3 result does not stand in for a DEV result.

**Existing DEV backup (as reported by the operator; not independently verified — no DB or shell
access taken in this pass):**

- `afldb_dev-pre-issue224-20260922-141700.dump`
- sha256 `4458ed98d73de64ee28e5042aaf56ca5274a9e5b056499f844c290e65eee9e25` (64 hex chars, correct
  length for SHA-256)
- `pg_restore --list` exit 0

### 18.3.1 Status

**Not a DEV write and does not authorise one.** The real D-2 census under the privileged role is
now on record: `CREATE=92/ALREADY_SATISFIED=0/CONFLICT=0`, D-2 guard passed for real. The remaining
gate before D-8 step 1 can write `afldb_dev` is unchanged: **explicit operator authorisation to
execute the `--apply` code path against DEV**, which does not exist today — `parseArgs` refuses
`--apply` for `--target dev` unconditionally (§18.2.2) and enabling it is a deliberate, separate
code change, not a flag on this command. ISSUE-224 remains BLOCKED per §18.1.6. `afldb_dev` remains
unwritten.
