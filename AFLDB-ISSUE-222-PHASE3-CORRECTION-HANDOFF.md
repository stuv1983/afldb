# AFLDB-ISSUE-222 Phase 3 — correction handoff (written 2026-09-18, Fable 5.1, High; revised the same day for decision O-4 revision 2)

**EXECUTED 2026-09-18 (Sonnet 5, High).** Every correction in §6 A–K and the offline tool (§I/§J)
were implemented and run over all 997 real sample rows. Full results: `AFLDB-ISSUE-222.md` §11.8,
`issues.md`. **Phase 3 remains PENDING** — the operator's rechecks and 30-row audit confirmation
are still outstanding, and 9 `offline_contradict` rows require adjudication before acceptance. The
design/spec content below is retained as the record of what was implemented; it was not re-edited
to describe outcomes, which live in §11.8 instead.

**Status: Phase 3 remains PENDING. Nothing in this document authorises an import, a network
request, a database connection, a DEV or PROD action, or Phase 4.** This file is the self-contained
brief for one fresh correction/offline-review session (Sonnet 5, High) that fixes the defects an
independent review found in the Phase 3 evidence, builds the deterministic offline review tool, and
executes the offline comparison. The review's operating contract is
**`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md`** (decision O-4 revision 2, §0). The earlier
Playwright-for-all-997 runbook (O-4 revision 1) was withdrawn before any execution and no longer exists.

Written in governance-only mode: no code, dataset, browser, network, database, importer, exporter
or Git action was taken to produce it. Every count below was independently reproduced by the
reviewer from the tracked artefacts and the local snapshot files, without a database. The evidence
inventory in §9 and the join feasibility in §10 were measured on 2026-09-18 with read-only scripts
over local files only (including a hash-verified off-tree copy of the accepted fitzRoy snapshot);
no per-row review outcome was recorded by that measurement.

---

## 0. Governance decision O-4 — revision history (both revisions recorded 2026-09-18, before any review execution)

Decision O-4 replaces, **prospectively only**, the §3.5 wording that had the operator personally open
the AFL Tables page named by the href and the DraftGuru page for every sampled person. It applies to
reviews executed after 2026-09-18, is not part of the original gate, and is never described as having
applied retroactively. Two revisions exist; **revision 2 is in force**.

### O-4 revision 1 — SUPERSEDED, never executed

Recorded earlier on 2026-09-18. It approved a Playwright browser-evidence review of all 997 rows
(Sonnet 5 High, Playwright MCP: load the cached DraftGuru page and the live AFL Tables page for every
row, record visible-page evidence and a structured machine verdict), with the operator inspecting
every contradiction, undetermined result, page/redirect/tooling anomaly, known numbering/spelling/
name-change exception and ledger overlap, plus a deterministic 30-row audit of clean agreements under
salt `AFLDB-ISSUE-222/audit-v1`; any failed audit row or genuine contradiction stopped acceptance; the
outcome wording was "Playwright browser-evidence review plus operator exception/audit review". Its
runbook (`AFLDB-ISSUE-222-PLAYWRIGHT-REVIEW-RUNBOOK.md`, uncommitted) was withdrawn when revision 2
was recorded. **No page was opened, no row was reviewed and no artefact was produced under revision
1.** Its checkpointing, operator-audit, exception-handling, acceptance and safety requirements are
carried into the revision 2 runbook; its browser-conduct rules survive as the minimum conduct for any
later bounded fetch (offline runbook §9).

### O-4 revision 2 — IN FORCE (supersedes revision 1 before review execution)

- **Retained fitzRoy/AFLDB evidence is the primary review source.** Every one of the 997 rows is
  compared offline: the captured DraftGuru snapshot (href, visible name, birth evidence, draft rows,
  games) against the accepted fitzRoy full-history snapshot (`full-history-20260902`, hash-verified
  131/131) and AFLDB's registered identities (the `afldb_test` child). Contract:
  **`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md`**.
- **Live AFL Tables acquisition is allowed only for a measured residual** that genuinely lacks
  sufficient offline evidence, only after that residual is reported to the operator by category,
  count and URL, and only under a new explicit authorisation naming the exact URL count and scope.
  **No such authorisation exists.**
- **Playwright MCP is an exception/clarification tool**, not the default review mechanism.
- The immutable **399-person census and 598-person random sample remain unchanged** (membership,
  order, salt `AFLDB-ISSUE-222/v1`, n = 598, zero overlap).
- The operator reviews **every exception plus a deterministic 30-row audit** of clean offline
  agreements (salt `AFLDB-ISSUE-222/audit-v1`, unchanged; never redrawn).
- **D-9 remains unchanged. Name-only matching remains prohibited.** Wikipedia and Footywire remain
  unused corroborating links, never authority.
- **Phase 3 remains PENDING.** No import, network request, database connection, DEV/PROD action or
  Phase 4 is authorised by this revision.
- Outcome wording: **"retained fitzRoy/AFLDB comparison plus operator exception/audit review"**,
  never "997 manually reviewed by the operator" and never "verified against AFL Tables live".

**Why revision 2 was adopted (recorded with the decision).**

- DraftGuru already supplies the exact AFL Tables href for every bridge candidate (3,564 single
  identities, zero ambiguous URLs, zero collisions); these are not name-matcher suggestions. The
  review asks whether that asserted identity consistently resolves to the canonical AFLDB player,
  not whether two independent websites happen to share a name.
- AFLDB resolved 3,463 child rows through registered AFL Tables external identities. Its canonical
  player data was populated by the accepted historical rebuild, substantially through fitzRoy 1.8.0,
  which reads AFL Tables player details; fitzRoy supports historical AFL Tables player details.
- The accepted snapshot's `player_stats` rows already carry, per profile URL, the name, DOB (sparse)
  and age (dense), debut, career span, games, goals and club history that a new AFL Tables scrape
  would collect (§9). Downloading the same pages again would duplicate evidence, not add a source.
- Existing evidence had to be inventoried before any further network acquisition was approved. The
  inventory (§9) found the accepted bytes retained locally and the join (§10) sufficient for every
  registered sampled row.
- **Limitation stated honestly:** fitzRoy/AFLDB data derived from AFL Tables is **not an independent
  source from AFL Tables**. DraftGuru's captured outbound AFL Tables href is the independent
  source-side assertion; the retained snapshot is the target-side description of the identity that
  href names (§11).
- The existing automated name/age/DOB analysis (ledger entry, 2026-09-18) remains supporting evidence
  only; it is not the review and satisfies no row.

---

## 1. Phase and commit state

| Item | State |
|---|---|
| Phase 2 (acquisition, label `person-html-20260918`) | committed at `ebea0d4c` |
| Phase 3 artefacts (parent, `afldb_test` child, review sample) | present, **uncommitted** |
| Phase 3 documentation (`AFLDB-ISSUE-222.md` §11.5, `issues.md`, `IssuesIndex.md`) | modified, **uncommitted** |
| Phase 3 status | **PENDING** overall; **operator adjudication of the 83-row pack COMPLETE and independently validated (2026-09-18)** — see §13; bridge v2 not yet generated |
| Phase 3 review method | **O-4 revision 2**: offline retained-evidence comparison first (`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md`); revision 1 (Playwright for all 997) superseded, never executed |
| Live AFL Tables acquisition for the review | **not authorised** (residual reported first, §K / runbook §9) |
| Bridge imported anywhere | **no** — `draft_persons` on every target still carries 5 human links and 0 bridge links |
| DEV or PROD action | **none** |

Immutable inputs and their sha256 as reproduced on 2026-09-18:

| File | sha256 |
|---|---|
| `data/reference/draftguru-person-bridge-20260918-v1.json` (parent) | `92ff142ef71d175046b4949b0a85d5925bc396d3586b5b1fc3f44e51f097320e` |
| `data/reference/draftguru-person-bridge-20260918-v1.afldb_test.json` (child) | `596bbb684424b40f43c22368f1b77aa4198eec8b56a1109a7bb587c5c7a9a27f` |
| `docs/rebuild-manifests/draftguru/bridge-review-20260918-v1.json` (sample) | `036cc0826428c03a622448d299b803c23bac011bd5cd92eea86c4283e445ba84` |
| `docs/rebuild-manifests/draftguru/person-html-20260918.json` (B3 manifest) | `5e944d0e57985593cbe35f15d5b46613d1d8e0843895a47db3dcd99f1f2538a7` |
| `data/sources/draftguru/person-html-20260918/parsed/person_profile.jsonl` | `bad43909112aae4b318336ca4de8576e67608202dd077fdc2f89188b7a04aa37` |
| `docs/rebuild-manifests/draftguru/annual-html-20260826.json` (Stage A manifest) | `d06bf6be358663ad3c44a56066c9096fbc4bdf4760349ed181a642476d374652` |
| `data/sources/draftguru/annual-html-20260826/parsed/rows.jsonl` | `06936baca3b37133949847e7589008a06be76bbc8f1fb5b4d2fef8b743838a64` |
| `data/sources/draftguru/annual-html-20260826/parsed/persons.jsonl` | `95c98f2aa272b598543357908c91f8b104b5ff501a66405fb1da0a50a4ebcb9d` |
| `data/reference/fitzroy-accepted-baselines.json` (accepted-baseline register) | `c68083aed64e894566054404b93032698e9664d79db377080ad795724d032eef` |
| `docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json` (accepted fitzRoy manifest, LF bytes) | `2bd66e3df5ce80411363da9e15c6dddadc9eefe5c5c9eca3f5b7bd7106b0a0c1` |
| `tools/rebuild/fitzroy/fitzroy-contract.json` | `e4001a8d3a9ec3afb936f9c09cabf5921cd203978c4061465655d2b756e7a466` |
| `data/reference/draftguru-link-decisions.json` (human ledger) | `13ea051e6620a1320e3e60cc34d58ece9c7f08be3205d248c93787edc9a931a1` |
| `data/reference/player-name-aliases.json` | `c77ccbf8b995c56dd9f33b53bb1907115acefe7b090facf6760b200e1d491ee0` |
| `data/awards/player-identity.csv` (LF bytes; the CRLF working copy hashes `17d5eb82b67f82b150e4284e4021c9a078fbdce4ac41785288f732df2fb40b03`) | `128b5b99e3b715a870e2b364efb8a8f9ee21ab9fd94a20a2e40d19e9145079de` |

The child's `parent_sha256` equals the parent's sha256; the parent's `provenance.manifest_sha256`
equals the B3 manifest's sha256; the B3 manifest's `sample_basis` hashes equal the Stage A
manifest, rows and persons files above. The accepted fitzRoy manifest's hash equals the register's
`manifest_sha256`; the child's `target_registration.count` (13,275) equals the register's
`identity_scan.distinct_urls` (13,275). All verified. The accepted snapshot **bytes** are absent
from every repository checkout on the workstation; a retained off-tree copy hash-matches the
manifest 131/131 (§9.1).

## 2. Parent and child results (reproduced exactly)

| Dataset | Unit | Count |
|---|---|---|
| Source population | persons | 5,057 |
| Parent bridges | persons | 3,564 |
| Parent withheld, all `U-no-href` | persons | 1,493 |
| Parent collisions / inadmissible / page-failed | persons | 0 / 0 / 0 |
| `afldb_test` child bridges | persons | 3,463 |
| `afldb_test` child withheld | persons | 1,594 |
| of which `target_not_registered` | persons | 101 |
| of which `target_ambiguous` | persons | 0 |

Every bridged person has exactly one canonical AFL Tables href, HTTP 200, no redirect, no
self-link disagreement; no withheld person has any AFL Tables href. Bridges and withheld
partition the 5,057 exactly, in both files. The parent's withheld list is carried verbatim into
the child. No credential, DSN or absolute local path appears in any artefact.

## 3. Correct import projection (PROJECTION, not applied database state)

**The importer is expected to apply 3,460 net-new bridge links, not 3,463.** Three child rows
(`matt_rendell/1`, `nathan_fyfe/1`, `ryan_o'keefe/1`) belong to people with an agreeing existing
human decision: the ledger's AFL Tables target path equals the bridge href in all three cases.
`import_draftguru.py` `apply_authority()` step 2 keeps the human decision, verifies agreement,
and `continue`s without incrementing its bridge-applied counter for those rows.

Projected **person** outcomes on `afldb_test` after import of the current child:

| Outcome | Persons |
|---|---|
| net-new bridge links (`B-linked`, `unique`) | 3,460 |
| existing human-linked, remain authoritative (`H-linked`) | 5 |
| projected unresolved | **1,592** |
| of which human-unlinked (`H-unlinked`) | 1 |
| of which `target_not_registered` (`W-unregistered`) | 101 |
| of which no usable href (`U-no-href`) | 1,490 |
| total | 5,057 |

Played breakdown (reported games > 0, from Stage A rows; breakdown only, never an outcome
criterion): `B-linked` 3,415 played / 45 not; `H-linked` 3 / 2; `H-unlinked` 0 / 1;
`W-unregistered` 101 / 0; `U-no-href` 0 / 1,490.

Projected **pick** outcomes:

| Outcome | Picks |
|---|---|
| existing human-linked picks | 5 |
| bridge-covered picks | 5,101 |
| unresolved picks | 1,704 |
| total | 6,810 |

Projected pick capability 74.98%. The `draftLinks` 50% probe would be crossed; that is context,
not acceptance.

## 4. National Draft top-10 reconciliation, both units

| Quantity | Picks | People |
|---|---|---|
| National Draft picks 1–10, 1981–2025 (42 drafts, 10 per year) | 420 | 418 |
| `B-linked` | 389 | 387 |
| `W-unregistered` (`target_not_registered` on `afldb_test`) | 12 | 12 |
| `U-no-href` | 19 | 19 |
| `H-linked` | 0 | 0 |

Two people (`richard_cousins/1`, `allen_jakovich/1`) each hold two top-10 national picks, which
is why 389 picks map to 387 people. Pick coverage **389 / 420 = 92.62%**. Person coverage
**387 / 418 = 92.58%**. All 19 no-href people have zero recorded games. The 12 unregistered are
the entire 2025 top-10, Jagga Smith (2024 pick 3) and Joel Smith (1994 pick 5).

## 5. Review-sample reconciliation

| Quantity | People |
|---|---|
| Census stratum | 399 |
| of which bridged National Draft top-10 people, registered on `afldb_test` | 387 |
| of which bridged National Draft top-10 people, `target_not_registered` on `afldb_test` | 12 |
| Random-stratum population (parent bridges minus census) | 3,165 |
| Random stratum | 598 |
| Total | 997 |
| Census ∩ random | 0 |
| Duplicate URLs anywhere | 0 |
| Sample people overlapping the human ledger | 0 |
| Sample people `target_not_registered` on `afldb_test` (12 census + 16 random) | 28 |

The census is every parent-bridged person holding a national top-10 pick, sorted by URL. The
random stratum is the first 598 of the 3,165 remaining parent-bridged people under the exact
ordering `sha256(salt + "|" + player_url)` hex ascending, ties by URL, with salt
`AFLDB-ISSUE-222/v1`. **The formula is not simple salt prepending**: `sha256(salt + player_url)`
does not reproduce the file. Zero-failure one-sided 95% upper bound at n = 598: 0.4997%.

The review sample was drawn on the **parent** (per §4.5), so the 28 `afldb_test`-unregistered
people are in scope and are reviewed like every other row.

## 6. Independent-review findings requiring correction

### A. Import acceptance identity (runbook §6.1 lines 660–661, §7.2 lines 833–834)

The runbook requires the importer's `authority: bridge` to equal the child's `bridges.length`
(3,463). For this child that identity cannot hold (see §3). **Correction:** restate the
acceptance as two separately asserted values — expected applied bridge count **3,460** and
expected agreeing human-decision rows **3** — in `AFLDB-ISSUE-222.md` §6.1, §7.2 and §11.5, and
in the `issues.md` Phase 3 entry. `--dry-run` must report `bridge = 3,460` and `ledger = 6`
(5 linked + 1 unlinked) with 0 HALTs; the importer already halts on any disagreement.

### B. Exporter/importer target-resolution divergence

`export_person_bridge.py` `REGISTRATION_SQL` (lines 308–314) counts `DISTINCT player_id` over
`external_identities` for `sources.key = 'afltables'`, `status IN ('unique','resolved')`,
`player_id IS NOT NULL`, with **no** `match_method` filter. `import_draftguru.py`
`resolve_afltables_players()` (lines 497–505) additionally filters
`match_method = 'afltables_profile_url'` and appends **every** returned row, so an identity
registered twice for the same player resolves to 2 and HALTs the importer while passing the
exporter; an identity registered under another `match_method` passes the exporter and resolves
to 0 at import. **Correction:** align the exporter's resolution semantics with the importer
before Phase 4 (same filters, same cardinality rule, or a shared definition), add explicit test
coverage (§C), and regenerate the affected child (and, if membership changes, the review
presentation) **only** if the correction changes their contents or hashes — as a new version,
never an overwrite (see §7).

### C. Missing tests (extend `tests/draftguru-acquisition.test.ts` and
`tests/integration/draftguru-import.test.ts`; no new file unless no semantic home exists)

Required regression coverage:

1. duplicate identity registrations resolving to the same player — exporter and importer agree;
2. `target_ambiguous` (> 1 distinct player) — withheld with that reason;
3. the exact `sha256(salt + "|" + player_url)` digest against a pinned known result, and that a
   different salt produces a different order;
4. `--review-sample` rejects a deployment child (`kind: "deployment"`) as input;
5. `admissibility_reason` requires `distinct_afltables_identity_count == 1` in addition to a
   non-null `afltables_identity` (the contract's `canonical_required`);
6. a test exercising the real B3 artefact shape (a record with every `person_profile.jsonl` key,
   not the minimal fixture) through `--source-evidence`;
7. agreeing human-decision rows versus the bridge-applied counter (`stats["bridge"]` excludes
   them; `stats["ledger"]` includes them; no HALT).

### D. DB-free child validation

Run `python tools/rebuild/draftguru/import_draftguru.py --validate-only --bridge <child>` against
the real (corrected, if regenerated) child. Per the module docstring this mode performs Phase A
only, needs no psycopg and **must not connect to or write to any database**. Record the exact
output line. It was listed as Phase 3 command 4 in the runbook and has not yet been run.

### E. Unsupported registration-lag narrative (`issues.md` Phase 3 entry, `IssuesIndex.md`)

Remove or correct: "91 of the 93 fall in draft years 2023–2025"; "2 older cases (1989/1992)";
"both `reported_games` ≤ 2"; and the blanket treatment of the residual 93 as registration lag.
From the tracked `rows.jsonl`, by first draft year the residual splits 88 (2023–2025) / 5 older;
by latest row 90 / 3; no residual person has 2 games or fewer; no 1992 case exists.

Replace with this evidence-strength language:

- 101 `target_not_registered` in total.
- Six numbering/disambiguation cases (`Aaron_Black`, `Alwyn_Davey`, `Joel_Smith`, `Josh_Smith`,
  `Sam_Butler`, `Tom_Murphy`). Five have **strong retained sibling evidence**: the `/2` DraftGuru
  person of the same name is bridged to the `1`-suffixed AFL Tables path and is registered on the
  child. **Aaron Black's case remains inferred** (no sibling in the parent).
- Two spelling/name-change cases (`Dean_Laidley` → `Dani_Laidley`, `Matthew_Capuano` →
  `Mathew_Capuano`) were identified by an untracked fuzzy search and are **not fully proven by
  retained tracked evidence**.
- `stephen_schwerdt/1` → `players/S/Steven_Schwerdt.html` (1989 pick 78, 25 games) is a **likely
  third spelling case** and must not be labelled registration lag.
- Registration lag is **plausible** for many recent people (2023–2025 drafts with 1–25 games)
  but is **not proven** by the retained artefacts.
- Whether the cause is `afldb_test` staleness or a missing canonical-player registration
  **remains unresolved** without retained target evidence; a tracked, read-only registration
  extract for at least the 12 top-10 gaps and the 9 named cases would settle it.
- No name-only resolution is allowed for any of the 101; they remain withheld pending a curator.

**Update (2026-09-18, offline measurement, §10.3):** the "staleness versus missing registration"
question above is now settled without a database read — 0 of the 101 paths appear in the accepted
snapshot's URL set and all 3,463 bridged paths do, so `afldb_test` is not stale relative to its
source and "not registered" means no appearance in the accepted 1897–2025 source. The correction
session writes §10.3's wording into `issues.md`/`IssuesIndex.md`, not "registration lag". Note that
§10.3's per-year buckets cover **all 101** (the eight named cases included) and therefore differ from
the residual-93 split stated in this section; both are correct for their own populations.

### F. Verdict storage contradiction

Runbook §3.5 item 1 says the sample list **and results** are preserved in
`bridge-review-<label>-v<N>.json`; the artefact's own `$comment` says verdicts are recorded
separately and the file is never edited. **Correction:** keep the sample immutable; define a
separate versioned verdict artefact `docs/rebuild-manifests/draftguru/bridge-review-verdicts-20260918-v1.json`
(schema in `AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md` §4; `review_method`
`offline-retained-evidence+operator-exception-audit`); hash-link it to the sample, parent and child;
never edit or overwrite the sample. Amend §3.5 item 1 to say so.

### G. Review evidence presentation

The sample carries only `player_url` and a `verdict: null` placeholder per row. **Correction
(as revised for O-4 revision 2):** the per-row `evidence` block of the offline verdict artefact
(`bridge-review-verdicts-20260918-v1.json`, runbook §3–§4) is the derived review presentation; no
separate presentation file is required. It is generated **without changing sample membership or
order**, one entry per sample row in sample order, joining: stratum,
ordinal, `player_url`, expected AFL Tables href (parent `bridges[]`), `afldb_test` child status
(`bridged` / `target_not_registered`), DraftGuru `display_names_raw`, every Stage A row (year,
`event_type_raw`, pick, club, `age_raw`, games), the earliest original-recruitment event (see §H),
`raw_filename` and `raw_sha256` of the locally captured DraftGuru page, and a flag for each known
exception class (six numbering, two spelling, Schwerdt, ledger overlap). In this sample the
flags fall on `joel_smith/1` (census), `josh_smith/1`, `tom_murphy/1` and `stephen_schwerdt/1`
(random); the other five named cases and every ledger person are outside the sample. Also flag
the 34 numeric-suffix identities (8 census, 26 random), the 2 continuity-rule identities
(`jack_graham/3`, `jack_ross/3`) and the 12 in-sample name variants (§10.2). The retained
target-side facts (§9.1) are joined into the same block.

### H. Debut criterion

Replace the literal "AFL Tables debut season not earlier than the draft year" comparison against
every draft row with: compare against the person's **earliest original-recruitment event** (their
first `National`, `Rookie`, `Pre-Season`, `Mid-Season`, `Mini-Draft`, `Pre-Draft` or `Post-Draft`
row as a recruit, not a `Trade` or `Free Agency` movement of an established player). Later
trades, pre-season selections, rookie re-listings and other subsequent events do not invalidate
an earlier career. Record this in §3.5 and in the presentation's `earliest_original_recruitment`
field so the offline review applies it uniformly. The 53 false flags of the 2026-09-18 automated
pass are the evidence for this correction. **Further refinement from the offline feasibility
measurement (§10.4):** even against the earliest original-recruitment event, 40 random-stratum rows
(0 census) have a retained debut season earlier than that event's year — the expected shape for
players first listed before DraftGuru's 1981 coverage or before the modern draft and later re-listed
through a pre-season or pre-draft event, and 15 further random rows carry only trade rows. A debut
before the earliest original-recruitment year is therefore an **informational** code, never a
contradiction by itself; only a career that **ended** before that year contradicts (runbook §5).

### I. Deterministic offline review tool (new; runbook §3–§6)

Implement `tools/rebuild/draftguru/review_person_bridge_offline.py` (beside
`reconcile_person_bridge.py`). It: consumes the immutable 997-row sample; joins each row's DraftGuru
captured evidence (profile + Stage A rows) to the retained target evidence — parent identity, child
status, the accepted fitzRoy `player_stats` rows for that path collapsed from player-match grain
(continuity pairs merged; the two tracked 1909 Jim Stewart Cartesian rows dropped exactly as the
contract's `source_row_corrections` fingerprints say), plus ledger, aliases and awards-census names;
produces exactly one of the six outcomes for every row with reason codes; preserves sample order and
strata; writes the LF CSV and structured JSON, the recheck queue and the residual report with hashes
and provenance; checkpoints atomically under a lock; **never** connects to a database (no `psycopg`,
no `*DATABASE_URL*` read), **never** performs a network request, **never** modifies the parent, child
or sample. `player_details.csv` is hash-verified but never joined (no URL, no ID; name+club grain).

### J. Tests for the offline tool (extend `tests/draftguru-acquisition.test.ts`, which already spawns the DraftGuru Python tools; a Python contract file under `tests/python/` only if a fixture suite is materially clearer)

Required coverage: one fixture row per outcome (`offline_strong`, `offline_limited`,
`offline_contradict`, `target_unregistered`, `offline_unavailable`, `tooling_or_schema_error`);
name-only equality yields `offline_limited`; a club difference alone never contradicts;
`DEBUT_BEFORE_EARLIEST_RECRUITMENT` alone never contradicts while
`CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT` does; the earliest-original-recruitment selection skips
`Trade`/`Free Agency`, handles the 1981/1982/1987 absent-column rows (`event_type_raw` null = National
Draft) and trade-only persons; the listed name-variant table (including Stephen/Steven) and the
unlisted-variant path; numeric-suffix and continuity-path rows require club overlap for
`offline_strong`; birth-year tolerance (|Δ| ≤ 1 consistent, ≥ 2 conflict; DOB preferred over `Age`);
the games consistency rule; the audit ordering `sha256("AFLDB-ISSUE-222/audit-v1" + "|" +
player_url)` against a pinned result and its exclusion of recheck classes 1–10; deterministic
`rows_sha256` across two runs; refusal on any input-hash mismatch, on ≠ 997 rows, and on a
`deployment` child passed as the parent; no socket opened and no database module imported.

### K. Measured residual report (runbook §9)

After the offline run, write `docs/rebuild-manifests/draftguru/bridge-review-residual-20260918-v1.json`
listing every row that lacks sufficient offline evidence, by category, with counts, URLs and the
recommended next evidence. **Stop before any external fetch.** No network acquisition is authorised
by this handoff; any later authorisation must name the exact URL count and scope.

## 7. Correction-session gates (1–7 must hold before the offline comparison runs; 8–10 before its result is relied on)

1. Exporter and importer target-resolution semantics aligned (§B).
2. The §C and §J tests added and the DB-free ladder green: `npx vitest run tests/draftguru-acquisition.test.ts tests/match-backtest-compare.test.ts`
   (the known `AFLDB-ISSUE-223` failure excepted) and `npx tsc --noEmit -p .`; the isolated
   integration suite `tests/integration/draftguru-import.test.ts` green if the operator supplies
   the isolated test database (it is the only database that suite may touch).
3. `--validate-only` passes on the real child (§D), output recorded.
4. Documentation arithmetic corrected (§A, §E) in `AFLDB-ISSUE-222.md`, `issues.md` and
   `IssuesIndex.md`; units stated on every top-10 figure (§4 above); the "registration lag"
   wording replaced by the measured statement in §10.3.
5. Verdict schema declared (§F; offline runbook §4) and the salt formula recorded exactly (§5).
6. The accepted fitzRoy bytes placed by the operator at
   `data/sources/afltables/fitzroy_core/full-history-20260902/` and verified 131/131 against the
   tracked manifest (offline runbook §1.1); **no acquisition run**.
7. Immutable input hashes recorded (table in §1) and re-verified at the start and the end of the run.
8. The offline tool run twice with equal `rows_sha256`; verdict CSV/JSON, recheck queue and residual
   report written and hashed; the 30-row audit drawn once and never redrawn.
9. If any parent, child or sample content changes: a **new version** (`-v2`) carrying
   `parent_sha256` of v1 and the reason; v1 retained; every dependent count, hash and artefact
   regenerated and reconciled; the review sample is redrawn **only** if the parent's `bridges[]`
   changed. **Correction (independent review, 2026-09-18): this gate's "using the same salt"
   clause conflicted with `AFLDB-ISSUE-222.md` §3.5 item 4, which governs revalidation after a
   review failure and requires a NEW salt (`"AFLDB-ISSUE-222/v<N+1>"`) so the redraw is disjoint
   from the previous one where the population allows. §3.5 item 4 is authoritative; this gate no
   longer specifies a salt for that case. A downstream artefact that cited "runbook §7 item 9" as
   the redraw rule was citing the wrong document (this is handoff §7, not the runbook) and the
   wrong salt policy; any future citation must point to §3.5 item 4.**
10. Phase 3 remains **PENDING** until the operator completes every recheck and all 30 audit rows;
    no importer run beyond `--validate-only`; no network request; no database connection; no
    DEV/PROD action.

## 8. Fresh session prompt

The single copy of the fresh Sonnet correction/offline-review prompt is
**`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md` §10** (correction work first, then the offline
comparison, then stop before any external fetch). It replaces the correction-only prompt recorded
here earlier, which was never used.

## 9. Retained evidence inventory (measured 2026-09-18, offline, read-only; nothing modified)

Method: tracked manifests and the accepted-baseline register were read first; bytes were located by
exact path (this worktree, the main checkout, sibling worktrees of this repository, and the
operator's local backup root by exact directory name); every claim below about a file's contents
comes from reading that file. No database was connected, no page fetched, no importer or exporter run.

### 9.1 Accepted fitzRoy core snapshot — `full-history-20260902` (the only `accepted` entry in `data/reference/fitzroy-accepted-baselines.json`)

| Item | Value |
|---|---|
| Tracked manifest | `docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json`, sha256 `2bd66e3d…` (= register `manifest_sha256`); `artefact_set_sha256` `15ba5dc6…`; extraction 2026-09-02T01:00:04Z, fitzRoy 1.8.0 pinned = installed |
| Declared bytes location | `data/sources/afltables/fitzroy_core/full-history-20260902/` (gitignored: `/data/sources/afltables/*`) |
| Bytes found | **not** in this worktree; **not** in the main checkout (which holds only the empty retired `full-history-20260827`, `trial-2024` and `_probe`); **not** in any other `afldb*` worktree; **found** in the operator's backup root as the AFLDB-ISSUE-112 Pass 19 staging copy (`issue-112-staging-20260902/stage-fitzroy/data/sources/afltables/fitzroy_core/`, directory still named `full-history-20260827`), **131 ok / 0 mismatch / 0 missing / 0 extra** against the accepted manifest |
| `player_stats_<season>.csv` × 129 (1897–2025) | 685,473 rows total; one column set (81 columns) across all 129 files; grain **player-match** |
| — AFL Tables player URL | yes, `url` (absolute `https://afltables.com/afl/stats/players/<L>/<Name>.html`); register scan: 0 missing, 0 malformed, 13,275 distinct |
| — AFL Tables numeric identity | yes, `ID` (fitzRoy's); 83 rows blank across 5 paths (4 renumbered 2025 profiles + Billy Wilson) |
| — canonical AFLDB player id | **no** (surrogate, re-seeded by the rebuild; no retained artefact carries it) |
| — name | yes: `First.name`, `Surname`, `Player` |
| — aliases | no (aliases live in `data/reference/player-name-aliases.json`, 2 entries) |
| — DOB | yes but **sparse**: `DOB` column; register measured 855 players with a DOB; in the sample 268 of the 969 registered rows |
| — age / implied birth year | yes, `Age` (decimal years at match date) on every sampled registered row → birth year ± 1 for all 969 |
| — debut date / year, career span | yes: earliest `Date`/`Season`, latest `Season` per url |
| — games | yes: max `Career.Games` per url (career games **to season 2025**) |
| — goals | yes: per-match `Goals` summed per url (NA cells kept as NA, never 0) |
| — club history | yes: `Playing.for` set per url (modernised club strings; contract `source_club_normalisation`) |
| — provenance | manifest + register; every file hash-bound |
| Duplicate handling | collapse player-match rows per url; drop the two tracked 1909 Jim Stewart Cartesian rows (contract `source_row_corrections`); merge the 4 tracked renumbered-profile pairs (contract `profile_url_continuity`: Charlie_Cameron/3, Jack_Graham/2, Jack_Ross/3, Jack_Williams/3) |
| Known fitzRoy limitations | cached completed seasons vs live-scraped 2025 (renumbering, blank IDs); DOB coverage limited; club labels modernised; `player_details.csv` drops DOB/URL/ID |
| 2023–2026 coverage | seasons 2023, 2024 and 2025 complete per the full-history gates; **2026 absent by contract** (in-progress season excluded), so 2025 draftees and any 2026 debutant have no rows |
| `player_details.csv` | 16,731 rows, 15 columns (`Player, Team, Cap, #, HT, WT, Games, Wins, Draws, Losses, Goals, Seasons, Debut, Last, date_accessed`); **no URL, no ID, no DOB**; Player+Team+Cap grain (12,816 distinct name strings, 3,208 repeated) → **not joinable on identity; unused** |
| `results.csv` | 16,838 match rows; not player evidence |

### 9.2 AFL Tables all-time club player lists — `club-lists-20260905` (rebuild's DOB stage, ISSUE-118 D1)

Tracked manifest `docs/rebuild-manifests/afltables_club_lists/club-lists-20260905.json`: 21 parsed
CSVs, 16,731 rows, `dob_present` 16,731, columns `team_label, team_slug, cap, guernsey, player_raw,
dob, ht, wt, games_wdl, goals, seasons, debut, last, profile_href, profile_path`; club-player grain
(a multi-club player has one row per club, DOB must agree across them); captured 2026-09-05, so it
includes 2026 appearances. Bytes: **not found anywhere on the workstation** (declared path
`data/sources/afltables/club_lists/club-lists-20260905/`). Optional for the review (exact DOB); not
required because `Age` covers every registered sampled row.

### 9.3 `afldb_test` registered identities (retained through the child, no database read)

`draftguru-person-bridge-20260918-v1.afldb_test.json`: for each of the 3,564 parent identities,
registered-exactly-once (3,463 `bridges[]`) or `target_not_registered` (101; `target_ambiguous` 0);
`target_registration.count` 13,275 = the accepted snapshot's `distinct_urls`. Carries **no** player
facts (no name, DOB, games or `players.id`).

### 9.4 Captured DraftGuru snapshot — `person-html-20260918` (source side)

`person_profile.jsonl`, 5,057 records, sha256 `bad43909…`; per record: `afltables_hrefs[]` with the
verbatim href and normalised path, `afltables_identity`, `distinct_afltables_identity_count`,
`page.h2` (visible name), `page.title` (`"<Name> (born YYYY) - Draftguru"`),
`heuristic_fields.dob_candidates` / `height_candidates`, `labelled_fields`, `wikipedia_url`,
`raw_filename` + `raw_sha256`. In the sample: 997/997 have exactly one href equal to the parent
identity, an `h2`, a title birth year and a DOB candidate; 590 carry a Wikipedia link (unused).

### 9.5 Stage A — `annual-html-20260826` (source side)

`rows.jsonl` 6,810 rows (per draft event: `draft_year`, `event_type_raw` (null = 1981/1982/1987
National Draft), `pick_number`, `club_name_raw`, `age_raw`, `parity_only.games/goals`,
`player_url`); `persons.jsonl` 5,057 (`display_names_raw`, `years`). In the sample: 997/997 have
rows; 982 have an earliest original-recruitment event with `age_raw`, games and goals present on
it; **15 random rows have only `Trade` rows** (none census).

### 9.6 Other retained AFLDB identity evidence

| Artefact | Rows | What it gives | In-sample hits |
|---|---|---|---|
| `data/awards/player-identity.csv` | 1,851 with a path (bootstrap-era `player_id` → path + display name; bootstrap ids are **not** target ids) | name-only corroboration per path | 425 (253 census, 172 random) |
| `data/brownlow/player-identity.csv` | 179 | same, Brownlow subset | 2 |
| `data/reference/player-name-aliases.json` | 2 | curated aliases by path | 0 |
| `data/reference/draftguru-link-decisions.json` | 6 decisions (5 linked, 1 unlinked) | human decisions | 0 |
| `tools/rebuild/fitzroy/fitzroy-contract.json` `profile_url_continuity` | 4 rules (8 paths) | renumbered ↔ continuing pairs | 2 (`jack_graham/3`, `jack_ross/3`) |

### 9.7 Code, migrations and tests that define the identity fields

`tools/migration/import_fitzroy_core.py` (players built from `player_stats` only; identity = URL;
`external_identities` under source `afltables`, `match_method` `afltables_profile_url`; DOB evidence
type `fitzroy_player_stats`; continuity fold); `tools/migration/enrich_birth_dates_afltables.py`
(club lists → `players.dob`, joined on `profile_path` only); `src/db/migrations/002_core_entities.sql`
(`external_identities`: `source_id`, `external_id`, `status`, `match_method`, unique on
`(source_id, external_id)`); `tools/migration/player_identity.py`; `tests/fitzroy-core-import.test.ts`,
`tests/player-identity-source.test.ts`, `tests/python/fitzroy_profile_continuity_contract.py`,
`tests/python/fitzroy_corrections_contract.py`, `tests/draftguru-import.test.ts`,
`tests/integration/draftguru-import.test.ts`.

### 9.8 Not retained locally

fitzRoy bytes inside any repository checkout; club-lists bytes; the in-season 2026 snapshot bytes
(`issue129-t7-20260903`); the legacy SQLite register. No database was read.

## 10. Offline join feasibility (measured 2026-09-18 over the immutable 997 rows; aggregate counts only, no per-row outcome recorded)

### 10.1 The join

DraftGuru captured href → normalised path → parent identity (997/997 equal) → child status (969
`bridged`: 387 census + 582 random; 28 `target_not_registered`: 12 + 16) → accepted-snapshot
`player_stats` rows for that path (present for **969/969** registered rows, **0/28** unregistered
rows; continuity pairs merged) → retained facts.

| Category | Count | Notes |
|---|---|---|
| exact offline joins (registered, snapshot rows present) | **969** | name, implied birth year, debut, span, career games, goals, clubs available for all 969 (three corroborating signals beyond name) |
| missing target identity (`target_unregistered`) | **28** | 12 census (the 2025 top-10, Jagga Smith, Joel Smith) + 16 random |
| multiple target identities | **0** | child `target_ambiguous` 0; no sampled path carries > 1 fitzRoy `ID` |
| missing retained player facts among the 969 | **0** for name/age/debut/span/games/goals/clubs; DOB string absent for 701 (present 268) — birth year from `Age` covers all 969 |
| insufficient identity evidence | **0** rows lack a single captured href; 15 trade-only rows lack an original-recruitment event (debut criterion inapplicable; birth year and span still available) |
| known spelling / name-change | **12** in-sample `h2`-vs-path variants: `dan_curtin`, `matthew_scharenberg`, `ed_allan`, `harrison_jones/1`, `harrison_jones/2`, `lachlan_fogarty`, `mitch_edwards`, `ollie_hanrahan`, `lachie_bramble`, `lachie_sullivan`, `matt_cottrell` (diminutive/formal) and `stephen_schwerdt` (`Steven_Schwerdt`); Laidley/Capuano are outside the sample |
| numeric-disambiguation | **34** in-sample suffix paths (8 census, 26 random); 115 in the parent population; of the six named cases `joel_smith/1`, `josh_smith/1`, `tom_murphy/1` are in-sample and already `target_not_registered` |
| recent-player coverage gap | the snapshot ends at season 2025; see §10.3 |
| rows requiring a database read | **0** for the review (registration already measured 2026-09-18 and cross-confirmed by the identity set); optional if the operator wants `players.id` values recorded |
| rows requiring a live AFL Tables fetch | **0 identified before the run**; determined only by the residual report after it |
| rows requiring Playwright clarification | **0 by default**; exception tool only |

### 10.2 Evidence-strength feasibility (availability, not verdicts)

969 rows have every retained fact the `offline_strong` rule needs and can reach `offline_strong`,
`offline_limited` or `offline_contradict` from retained evidence alone; 28 rows are terminal
`target_unregistered`; 0 rows are `offline_unavailable` once the bytes are in place; 0 rows need a
network request before the run. An aggregate screen (informational; rows not identified, nothing
recorded): birth year available on both sides for 969/969; |Δ| ≤ 1 for 967, |Δ| ≥ 2 for **2** (1
census, 1 random — candidates for `offline_contradict` or recheck, not pre-judged); retained debut
season earlier than the earliest original-recruitment year for 40 random rows (§H); 15 trade-only
rows have span evidence only.

### 10.3 `target_not_registered` — measured statement replacing "registration lag"

3,463 of the 3,564 parent paths appear in the accepted snapshot's 13,275-URL set and they are
**exactly** the child's bridged set; **0 of the 101 `target_not_registered` paths appear in it**;
`target_registration.count` = `distinct_urls` = 13,275. `afldb_test`'s registered AFL Tables identity
set is therefore the accepted snapshot's URL set, and "not registered" means **no appearance in
seasons 1897–2025 in the accepted source** (a 2026 debutant, a listed player yet to debut, or a
numbering/spelling case whose captured path differs from the snapshot's path). The 101 by first
DraftGuru draft year: 2025: 60, 2024: 14, 2023: 14, 2022: 2, 2021: 2, 2009: 1, 2007: 1, 2006: 1,
2004: 1, 2003: 1, 1994: 1, 1992: 2, 1989: 1. `afldb_test` staleness relative to its source is
**refuted**; the correct wording is "not in the accepted 2025-season baseline", never "registration
lag". Whether a live AFL Tables page exists for a path is a different fact and is not needed for
Phase 3.

### 10.4 Consequences for the rules

Birth year is the primary corroborator (dense on both sides); games and debut/span are secondary;
club overlap is positive-only; a debut before the earliest original-recruitment year is informational
(40 rows measured); numeric-suffix and continuity paths need club overlap in addition; every rule is
in the offline runbook §5.

## 11. Independence statement

- **DraftGuru's captured AFL Tables href** — independent, source-side identity assertion.
- **fitzRoy/AFLDB player details** — retained target-side evidence ultimately derived from AFL Tables
  (fitzRoy 1.8.0 reads AFL Tables; the rebuild is built from that snapshot); **not** an independent
  source from AFL Tables, and never to be described as one. A live AFL Tables fetch would compare AFL
  Tables to itself at two dates.
- **AFLDB `external_identities`** — the canonical registration of that AFL Tables identity on a target.
- **Wikipedia / Footywire** — unused corroborating links, never automatic authority.
- The review question: does DraftGuru's asserted identity consistently resolve to the canonical AFLDB
  player the accepted source describes — not whether two independent websites share a name.

## 12. Local operator-adjudication GUI helper (build task, 2026-09-18, Sonnet 5, High)

A local, dependency-free Tkinter helper was built to let the operator work the 83-row
`bridge-operator-adjudication-pack-20260918-v1.json` (see `AFLDB-ISSUE-222.md` §11.11/§11.12
and `issues.md`) without hand-editing JSON:
`tools/rebuild/draftguru/review_bridge_operator.py`. It reads the pack (and its hash-linked
inputs) read-only, sets no verdict itself, checkpoints to a gitignored local file, and on
finalisation writes a new versioned `bridge-operator-verdicts-20260918-v1.{json,csv,md}`
artefact — never touching the pack, parent, child or sample. **No operator verdict has been
recorded by this build pass; the GUI has not been launched by Sonnet. Phase 3 remains PENDING**
until the operator completes the adjudication pack, the existing 997-row recheck queue and the
population-scan decision table.

## 13. Operator adjudication — COMPLETE and independently validated (2026-09-18, operator)

**Phase 3 operator adjudication COMPLETE and independently validated.** The operator reported
completing all 83 rows of `bridge-operator-adjudication-pack-20260918-v1.{json,csv,md}` and an
independent verification pass (`py_compile`, the complete DraftGuru operator-review contract
suite, `--validate-final-output`, all PASS; final line "All DraftGuru operator-adjudication-review
checks hold."), review window 2026-09-18T05:19:18Z–2026-09-18T08:43:12Z, with no source or verdict
artefact modified. Full decision totals, hashes, event-club totals and validation results are
recorded in `AFLDB-ISSUE-222.md` §11.13 and `issues.md` (not duplicated here). This record reflects
the operator's own report; Claude did not execute or independently re-run these commands this pass.

**Not done by this pass:** the two `different_person_wrong_href` rows (Craig Somerville, David
Sullivan) remain withheld; bridge v2 has not been generated; target resolution against
`afldb_test` has not been rerun; the disjoint new-salt (`AFLDB-ISSUE-222/v2`) validation sample
(§7 gate 9 / Phase F) has not been generated; no database import has occurred; `afldb_test`, DEV
and PROD are unchanged. **AFLDB-ISSUE-222 remains in progress; Phase 3 acceptance and Phase 4 are
not authorised by this pass.**

## 14. Bridge v2 source-evidence parent generated — DB-free (2026-09-18, operator-executed)

**The v2 SOURCE-EVIDENCE parent now exists; the `afldb_test` deployment child does not.**
`tools/rebuild/draftguru/build_person_bridge_v2.py` applied the 83 completed §13 verdicts, and
nothing else, to the frozen v1 parent: 5,057 persons, accepted 3,564 → 3,562, withheld
1,493 → 1,495, unchanged 3,481, confirmed 74, corrected 7, removed/withheld 2, added 0,
unaccounted 0, `child_status = "requires --resolve-against afldb_test"`. The operator reported
`py_compile`, the bridge-v2 contract and the four existing contracts all PASS, a pre-write
`--validate-only`, a first `--write` creating all six artefacts, a post-write `--validate-only`
reproducing the counts and hashes, a second `--write` reporting all six `identical`, and
independent `Get-FileHash` agreement. Full hashes are in `AFLDB-ISSUE-222.md` §11.14 and
`issues.md` (not duplicated here). This record reflects the operator's own report; Claude executed
none of these commands.

**Closes from §6 of this handoff:** item **D** (DB-free child validation) is satisfied for the
*parent*: the generator is DB-free by construction, asserted by an AST contract that it imports no
database, network, subprocess or GUI module and performs no environment-variable read. Item **B**
(exporter/importer resolution agreement) remains as previously corrected and is now additionally
pinned by a SELECT-only AST proof in `tests/python/draftguru_bridge_resolution_contract.py` §8.

**Not done by this pass:** the deployment child has not been resolved; the seven corrected targets
have never been measured against any database (all seven were `target_not_registered` in the v1
child); the disjoint new-salt (`AFLDB-ISSUE-222/v2`) validation sample (§7 gate 9 / Phase F) has
not been generated; no import has occurred; `afldb_test`, DEV and PROD are unchanged.
**Phase 3 acceptance and Phase 4 remain unauthorised.**

## 15. v2 `afldb_test` child resolved (operator) — validation and Phase F tooling prepared, not run (2026-09-18)

The operator resolved the v2 deployment child read-only (sha256 `b996c60e…`, accepted 3,468 /
withheld 1,589, registration 13,275, `measured_at` 2026-09-18T09:59:26Z). A file-level reading of
the artefacts agrees with the expected transition (7 corrected persons accepted through their
structured targets, 2 rejected persons withheld `different_person_wrong_href`, `target_not_registered`
101 → 94, `U-no-href` unchanged); the per-row proof, the child hash and the absence of any other
state change are asserted by `tools/rebuild/draftguru/validate_person_bridge_child.py`, which the
operator has **not yet run**. The Phase F generator `tools/rebuild/draftguru/build_validation_sample.py`
(§3.5 item 4 contract; gated on that validator; DB-free) and both contracts exist and have **not
been run**; the real Phase F sample has **not been generated**. Item **D** of §6 for the child
(`import_draftguru.py --validate-only --bridge <child>`) is still outstanding. Operator decisions
O-5/O-6/O-7, the exact command order and the transition table live in `AFLDB-ISSUE-222.md` §11.15.
**Phase 3 acceptance and Phase 4 remain unauthorised; nothing was imported.**

## 16. Phase F ACCEPTED (operator-reported); pre-import gates built, import NOT run (2026-09-18)

Operator-reported final evidence: operator artefact
`docs/rebuild-manifests/draftguru/bridge-validation-operator-verdicts-20260918-v2.json`
(`b8cf98bb9329a5ea2d6d065d556adbd2f8f6d1cc7c75d596dc7053ceb7b68758`); final validator
`summary_sha256` `63c89265565f8c1cb73b99f91e668cc3bb7e8af6b46187188ef29a37c7e516c9`, ACCEPTANCE:
ACCEPTED — 598 sampled, 582 identity-evaluable, 16 `target_not_registered` terminally withheld,
69/69 operator verdicts `agree`, 0 `contradict`, 0 `undetermined`, 0 failures; one-sided 95% upper
error bound 0.4997% (n 598) / 0.5134% (n 582). This satisfies §6.5 / §3.5 item 4 of the runbook and
gate 8–10 of §7 above. The deployment child is unchanged (`b996c60e…`, 3,468 / 1,589).

The §3 projection above was written for the v1 child (3,463 bridges → 3,460 net-new). For the v2
child the same rule gives **3,468 − 3 agreeing ledger persons = 3,465 net-new bridge links**,
1,587 unresolved (1 `H-unlinked` + 94 `target_not_registered` + 1,490 `U-no-href` + 2
`different_person_wrong_href`), 5 `H-linked`; the read-only plan gate computes the exact pick
totals. The pre-import import-scope/rollback assessment, the importer commit-order correction,
the read-only `bridge_import_gate.py plan|verify` gates, the `afldb_test` backup script and the
exact operator sequence are recorded in `AFLDB-ISSUE-222.md` §11.19. The 94 / 16
`target_not_registered` persons are tracked as `AFLDB-ISSUE-224`. **Backup, import, §7.4
database acceptance, DEV and Phase 4 have NOT been performed.**

## 17. `afldb_test` import COMPLETE and verified twice (operator-reported, 2026-09-19)

Backup `afldb_test-20260919-051022.dump` (23,744,832 bytes, sha256 `aa4f1cac…`, catalogue-readable,
not restore-proven); plan after the dry-run `966897b9…` (`import_batches` 191 before the
dry-run, 192 after its retained `failed` row, 193 after the import; hashes `4f0a2cc5…`
/ `ffa7fd60…` / `3ff56047…` / `71178a54…`); import as `afldb_import|afldb_test` with authority
ledger 6 / bridge 3,465 / unmatched 1,587 / seeded 0; verify twice, `32cf72a5…`, VERIFY: OK —
3,470 linked persons, 5,115 linked picks (75.11%), `resolved|ledger` 5, `unique|bridge` 3,465,
`unmatched|ledger` 1, `unmatched|` 1,586, zero remaining changes, all 1,589 withheld unlinked,
the two rejected identities absent, baseline unchanged. The §3 projection is superseded by
these measured figures. Phase 3 is accepted on evidence pending the operator's commit; Phase 4a
database acceptance is NOT yet satisfied (§6.1 pick level, §6.2, §6.3, remaining §6.4, §6.8
items 2–4, §7.4 outstanding) — decision, read-only next steps and the remaining Phase 4 / DEV
order in `AFLDB-ISSUE-222.md` §11.19.9. No DEV or PROD action. ISSUE-224 stays open.

Read-only application validation (2026-09-19, operator): SQL checks PASS; `draft-linkage.test.ts`
10/11 with all six draft builders and the ISSUE-221 cell populated (388 eligible); the one failure
was a query fan-out onto the continuing path of the four ISSUE-136 renumbered players (Charlie
Cameron, Jack Graham, Jack Ross, Jack Williams — one human each, two registered paths by tracked
rule), not a wrong link; corrected in test code with a DB-free regression; the Gridley corpus did
not run. `AFLDB-ISSUE-222.md` §11.19.10.
