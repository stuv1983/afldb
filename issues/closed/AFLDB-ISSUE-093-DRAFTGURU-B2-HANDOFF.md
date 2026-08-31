# AFLDB-ISSUE-093 — DraftGuru **Stage B2 HANDOFF** (now the B2 + full-history execution record)

> ## SUPERSEDED HEADER — READ THIS FIRST (2026-08-27)
>
> The line below ("PLANNING ONLY … NOT started") was true when this file was written on
> **2026-08-26**. It is **no longer true** and must not be acted on.
>
> **Stages B2-1 through B2-8 are COMPLETE**, and so is the full-history fitzRoy acquisition,
> validation and freeze. This document grew into the execution record for all of it:
> **PART I–XV** = Stage B2; **PART XVI–XVIII** = the full-history source work, ending at
> **PART XVIII — CANONICAL FULL-HISTORY SOURCE FROZEN**.
>
> **The authoritative current-state summary for a new session is
> `AFLDB-ISSUE-093.md` §19.** Start there; use this file for the detailed evidence behind
> any single decision. Nothing here is a live instruction to plan or re-run Stage B2.
>
> Historical planning text, rejected options and failed approaches are kept deliberately —
> they record why the settled decisions are what they are. Read them as history.

**Original 2026-08-26 header, retained verbatim as history:**

**Status: PLANNING ONLY. Stage B2 is NOT approved, NOT started, and must not be self-approved.**

This document is self-sufficient: a fresh session can plan Stage B2 from it without the Stage B1
conversation. Execution evidence lives in `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md`
(§18–§32); this file carries forward everything a B2 plan needs.

**Written 2026-08-26, immediately after Stage B1 was marked COMPLETE (acquisition handoff §32).**

---

## 1. Objective context

The overall ISSUE-093 objective is unchanged:

> **Rebuild AFLDB from tracked, reproducible canonical sources with zero `AFLDB_LEGACY_SQLITE`
> dependency.**

DraftGuru's durable person identity is **`player_url`**, in the accepted canonical form:

```text
https://www.draftguru.com.au/players/<slug>/<ordinal>
regex: ^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$
```

Non-negotiable identity rules (settled in Stage A/B1, must not be reopened):

- **preserve percent-encoding byte-exactly** — `%20`, `%C3%A1` and friends are significant and are
  never decoded, space-normalised or NFC-folded for identity;
- **never collapse ordinals** — `/brad_miller/1` and `/brad_miller/2` are proven different people;
- **never infer identity from a name** — rendered display text is evidence only, never identity;
- a **filename is never identity** (`http/persons_index.json` maps storage names to `player_url`);
- page metadata does not redefine identity: every real person page's `<link rel="canonical">` uses
  the **http** scheme while AFLDB identity is the **https** `player_url`.

---

## 2. Stage A evidence (accepted, immutable)

| Fact | Value |
|---|---|
| Snapshot label | `annual-html-20260826` |
| Manifest | `docs/rebuild-manifests/draftguru/annual-html-20260826.json` |
| Manifest sha256 | `d06bf6be358663ad3c44a56066c9096fbc4bdf4760349ed181a642476d374652` |
| Annual pages | **42** (1981, 1982, 1986–2025) |
| Draft rows | **6,810** |
| Distinct `player_url` identities | **5,057** |
| NULL/non-ordered pick numbers | 1,686 |
| Intentional coverage gaps | **1983, 1984, 1985** (no draft held) |
| CSV corpus | `full-history-20260826` — parity oracle only, `identity_complete:false`, `import_capable:false`, never an import source |
| Legacy dependency | **zero** `AFLDB_LEGACY_SQLITE` |

Stage A passed full CSV parity, canonical `player_url` validation, positive-ordinal validation and
fail-closed schema validation, with the manifest written LAST. **It is immutable: B2 reads it and
never writes it.**

---

## 3. Stage B1 evidence (accepted, complete)

### 3.1 Accepted artifacts and hashes

| Artifact | Value |
|---|---|
| Snapshot label | `person-html-20260826` |
| Manifest | `docs/rebuild-manifests/draftguru/person-html-20260826.json` |
| Manifest sha256 | `bca69a59b1492ae81c180119789bf2fd751e3888945fa325f51955b0b1bf43a7` |
| Manifest declares | `identity_complete: false`, `import_capable: false`, `immutable: true` |
| Frozen sample | `data/sources/draftguru/person-html-20260826/sample.json` |
| Sample sha256 | `d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28` |
| Residual census input | 68 lines, 3,580 bytes, sha256 `df6c9a7559bceb649e8e28e457fbe91d3351d8c1737a9042f233b1f1e3c5e841` |
| `parsed/person_profile.jsonl` | sha256 `2a40399a9e5d74765c9a134b68743a319d0c20655b25d753a3c48cb68825aca2`, **120 records** |
| `parsed/afltables_link_profile.json` | sha256 `d608e6f2291bba5d9c2cb0308d15674be7db81ed8145fbffa688f7113ef3ed60` |
| robots.txt | sha256 `d3bdd06996b60f3806e7ebe732d8c12951b9a4b640706bbbfb77d258a695413b` |
| Acquisition | requested **120**, fetched **120**, failed **0**; window `2026-08-26T09:20:10Z → 09:23:12Z` |
| Test baseline | `tests/draftguru-acquisition.test.ts` **87/87 PASS** |

### 3.2 Frozen 120-person sample

Deterministic, timestamp-free, rebuildable byte-identically; cohorts drawn in fixed order so every
person carries exactly one `primary_cohort`; controls ordered by `sha256(player_url utf-8)` ascending.

| Cohort | Size | Basis |
|---|---:|---|
| `convergence` | 8 | the four proven historical convergence pairs, both ordinals |
| `residual` | 68 | **complete census** of Residual-A persons (from one bounded read-only `afldb_dev` query) |
| `decade_control` | 30 | 6 per decade 1980s–2020s, DraftGuru games > 0 |
| `zero_game_control` | 14 | every row reports games `"0"` |

### 3.3 Bridge measurements

| Measure | Value |
|---|---:|
| With reducible AFL Tables identity | **100 / 120 = 83.33%** |
| Without any AFL Tables link | **20** |
| Malformed / multiple-candidate / non-reducing-host | **0 / 0 / 0** |
| Parse errors / collisions / failures / redirects / self-link disagreements | **0 / 0 / 0 / 0 / 0** |
| Distinct reduced identities | **100 of 100** |
| Observed URL form | **one only**: `http://afltables.com/afl/stats/players/<A>/<Name>.html` |

By cohort: `convergence` **4/8 (50%)**, `residual` **66/68 (97.06%)**,
`decade_control` **30/30 (100%)**, `zero_game_control` **0/14 (0%)**.

### 3.4 Residual result — the population AFLDB lacks

**66 of the exact 68** historical residual DraftGuru persons gain a deterministic AFL Tables
identity. The **two plain absences** (no link at all, no ambiguity) are:

```text
https://www.draftguru.com.au/players/fred_rodriguez/1
https://www.draftguru.com.au/players/riley_onley/1
```

### 3.5 Historical convergence pairs

| Pair | `/1` | `/2` |
|---|---|---|
| Adam Houlihan | `players/A/Adam_Houlihan.html` | **no link** |
| Andrew Hill | **no link** | `players/A/Andrew_Hill.html` |
| Brad Miller | `players/B/Brad_Miller.html` | **no link** |
| Michael Brown | `players/M/Michael_Brown.html` | **no link** |

**No pair exposes the same AFL Tables identity on both sides**, and **exactly one side of every
pair is bridged**. DraftGuru never asserts the two members are the same person — it is silent about
one of them. The unresolved side of every pair is a DraftGuru `games = 0` person.

### 3.6 Games mechanism (measured across all 120)

| DraftGuru reported games | bridge | no bridge |
|---|---:|---:|
| `> 0` | **96** | **0** |
| `= 0` | 4 | 20 |

**DraftGuru games remains parity-only source enrichment and MUST NOT become identity evidence.** It
is coerced to 0 at source (Stage A contract, `fields.Games`), which is exactly why 4 `games = 0`
persons still carry a bridge.

### 3.7 External-host vocabulary observed

`en.wikipedia.org` **54**, `www.footywire.com` **19**. **Evidence only — neither is an identity
source.** No real `www.afltables.com` case appeared, so the `non_reducing_host` finding path remains
covered by synthetic tests only; **the canonicaliser was not broadened**.

### 3.8 Real page structure

**0 / 120** pages use `<h1>`; all use `<h2 class="heading">`. Display-name evidence is descriptive
only. Trimmed **real-source** fixtures exist and are labelled distinctly from synthetic ones:
`tests/fixtures/draftguru/person_brad_miller_{1,2}_real_excerpt.html`.

### 3.9 Final reconciliation (bounded, read-only `afldb_dev`, ROLLBACK, aggregate-only)

Runner: `tools/rebuild/draftguru/reconcile_person_bridge.py`
(`.venv/Scripts/python.exe`, psycopg 3.3.4; `psql` is not installed on the dev host).

| Category | Persons | Meaning |
|---|---:|---|
| `same` | **33** | AFLDB held an identity and the bridge matched it exactly |
| `contradicts` | **0** | — |
| `absent` | **66** | linked person, AFLDB holds no AFL Tables identity — **new information** |
| `not_linked` | **15** | AFLDB knows the DraftGuru person but has no canonical player |
| `no_bridge_observed_afldb_has_identity` | **4** | DraftGuru silent, AFLDB already holds one |
| `no_bridge_observed` | **2** | neither side has one |
| **TOTAL** | **120** | |

**Comparable 33 / agreement 33 / contradictions 0 → contradiction rate 0.00%; 66 new identities.**

Provenance split (automatic history kept separate from explicit decisions):

| Category | Provenance | `link_status` | Persons |
|---|---|---|---:|
| `same` | automatic_only | `unique` | 30 |
| `same` | automatic_only | `resolved` | 3 |
| `absent` | automatic_only | `unique` | 60 |
| `absent` | automatic_only | `resolved` | 5 |
| `absent` | explicit_admin_decision | `resolved` | 1 |
| `no_bridge_observed` | explicit_admin_decision | `resolved` | 2 |
| `no_bridge_observed_afldb_has_identity` | automatic_only | `unique` | 4 |
| `not_linked` | automatic_only | `unmatched` | 14 |
| `not_linked` | automatic_only | `implausible` | 1 |

---

## 4. Final Stage B1 decision

**B — the bridge is useful but incomplete: use it where present, and require another deterministic
path for the identities it does not cover.**

**Proved:** a deterministic bridge exists where a link is present, in one uniform reducible form;
availability is effectively total for people who actually played (96/96 with games > 0); 66/68
residual persons gain the missing external identity; every independently comparable case agreed
(33/33, 0.00% contradiction); no ambiguity, collision or contradiction anywhere in the sample.

**Not proved:** complete identity for every DraftGuru person; identity for never-played draftees
(structurally impossible — AFL Tables profiles only players who played); identity for the no-link
side of any convergence pair; the correctness of historical automatic DraftGuru links **as a
class**; any permission to replay old automatic links; any permission to implement or import
anything.

---

## 5. Historical automatic-link warning (carry forward verbatim)

**Historical automatic DraftGuru links are NOT authoritative identity truth.** The old system
incorrectly converged distinct people — the proven case is Brad Miller `/1` vs `/2`, and the same
shape exists for Adam Houlihan, Andrew Hill and Michael Brown.

**B2 must never rebuild identity by replaying historical automatic links.** They are
audit/reconciliation evidence that must be independently re-earned. The Stage B1 reconciliation
deliberately reported them as a separate provenance class for exactly this reason, and the 33
agreements are a bounded sample — **not** a clearance of the automatic-link population.

---

## 6. Human/admin resolution preservation

Explicit decisions live in `player_link_resolutions` (`target_table = 'draft_picks'`,
`target_id → draft_picks.id`, `draft_picks.draft_person_id → draft_persons.id`), with
`action IN ('linked','confirmed_unlinked')` and an `admin_user_id`. They are a **separate
provenance class from automatic history and carry higher authority.**

Known historical state before Stage B1: **6 explicit human/admin resolutions — 5 `linked`,
1 `confirmed_unlinked`.** Stage B1's bounded sample observed explicit-admin provenance on 3 of its
120 persons (1 `absent`, 2 `no_bridge_observed`).

**B2 must define how explicit decisions survive a fresh rebuild** without treating automatic history
as equivalent authority — including how a resolution keyed to a `draft_picks` row survives a rebuild
that regenerates those rows.

---

## 7. Questions Stage B2 planning must answer from evidence

**Do not assume the answer is "write an importer."** B2 must choose the **smallest
evidence-supported implementation**, and may legitimately conclude that a different deterministic
identity mechanism, or a narrower change, is what is actually required.

1. Can the **100 measured DraftGuru → AFL Tables bridges** be accepted as canonical rebuild identity
   evidence, and under exactly what conditions?
2. What **validation and provenance** must be stored alongside any bridge-derived identity
   (source snapshot label, manifest sha256, observed href, normalised path, observation date,
   match method), so it is auditable and re-derivable?
3. How should Stage B2 **scale beyond the 120-person sample**, if scaling is needed at all — and
   what would justify the request volume?
4. Is **another person-page crawl required**, or can identity be derived deterministically from the
   already-accepted Stage A acquisition plus a bounded extension? (Stage A holds 5,057 identities;
   B1 profiled 120 of them.)
5. How are the **two residual no-bridge persons** handled (`fred_rodriguez/1`, `riley_onley/1`)?
6. How should **never-played DraftGuru persons** be represented, given that an AFL Tables profile
   cannot exist for them — is a person without any external identity a first-class citizen of the
   rebuilt model?
7. How does the **no-link side of each convergence pair remain distinct** from its partner without
   name matching, when it has no external identity of its own?
8. How are **explicit admin/human resolutions replayed or preserved** across the rebuild?
9. Which **historical automatic links must be discarded** rather than replayed, and by what
   deterministic rule?
10. What replaces the legacy **`tools/migration/import_draft.py`** identity behaviour?
11. What **schema or import-adapter changes**, if any, are actually required?
12. What **test gates** must pass before any database write or import is attempted?
13. How will the fresh rebuild **prove**: no collisions; no ordinal collapse; no name-only identity;
    no population loss (6,810 rows / 5,057 persons); explicit-resolution preservation; idempotency;
    and zero `AFLDB_LEGACY_SQLITE` dependency?

**If additional external acquisition would not answer these questions, say so explicitly.** On the
evidence so far, questions 1, 2, 5, 6, 7, 8, 9, 10, 11, 12 and 13 appear answerable **without any
new crawling** — they are decisions about AFLDB's model and provenance contract, not about
DraftGuru. Only questions 3 and 4 could plausibly require further acquisition, and that requires
explicit approval. **Do not self-approve further acquisition.**

---

## 8. Hard B2 boundaries (until a fresh planning session explicitly approves otherwise)

- **no new acquisition** — no crawl, no fetch, no network;
- **no PostgreSQL writes** — read-only only, under the §30.4/§31.17 safety envelope
  (`.env` parsed not sourced, `/afldb_dev` guard, `default_transaction_read_only=on`,
  `REPEATABLE READ READ ONLY`, in-session verification, `ROLLBACK`, aggregate-only egress);
- **no importer**, **no migration**, **no `src/` changes**;
- **no replay of automatic historical links**;
- **no name-based matching**, ever;
- **no `AFLDB_LEGACY_SQLITE`**, and no access to `afldb_test_pre_rebuild_20260825`;
- **no Stage B2 execution** — planning output only;
- Stage A and Stage B1 snapshots and manifests are **immutable**;
- the AFL Tables canonicaliser (`^https?://afltables\.com/afl/stats/` strip, mirroring
  `tools/migration/import_fitzroy_core.py normalise_profile_url()`) **must not be broadened**; a
  `www.` host that does not reduce stays a **finding**.

---

## 9. Existing Stage B1 tooling a B2 plan can build on (read-only inventory)

| File | Role |
|---|---|
| `tools/rebuild/draftguru/acquire_draft.py` | Stage A annual acquisition (HTTP primitives reused by B1) |
| `tools/rebuild/draftguru/parse_draft_snapshot.py` | Stage A parser/validator/parity |
| `tools/rebuild/draftguru/stage_b1_sample.py` | deterministic frozen-sample freezer |
| `tools/rebuild/draftguru/acquire_persons.py` | person acquisition + full-run orchestration, terminal classification, resume |
| `tools/rebuild/draftguru/profile_person_pages.py` | offline person-page profiler (stdlib only) |
| `tools/rebuild/draftguru/reconcile_person_bridge.py` | bounded read-only reconciliation runner |
| `tools/rebuild/draftguru/draftguru-contract.json` | Stage A contract + additive `person_stage` block |
| `tests/draftguru-acquisition.test.ts` | 87/87 semantic home for all DraftGuru acquisition tests |

Deferred operational items carried forward: **U3** (off-host archive of the accepted Stage A `raw/`)
remains open and is not a blocker; `IssuesIndex.md` and `CHANGELOG.md` updates for ISSUE-093 remain
deferred per acquisition handoff §28.

---

## 10. Recommended B2 planning session profile

| | |
|---|---|
| **Model** | Opus |
| **Reasoning** | High |
| **Mode** | Plan (no execution) |
| **Read first** | this file, then `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md` §30–§32, then `AFLDB-ISSUE-093.md` §13.5–§16 as needed |
| **First action** | decide question 4 (is any further acquisition required?) before anything else — it bounds the whole plan |

**Stage B2 must be approved by the user before any implementation begins.**

---

# PART II — APPROVED STAGE B2 PLAN (2026-08-26)

**Plan status: APPROVED DESIGN, with the 12 amendments below incorporated. NOT APPROVED TO
EXECUTE.** No importer exists, no SQL has been run, no acquisition has occurred, no
implementation file has been changed. The first approved execution step is §21 (B2-1 evidence
gathering only).

Sections 1–10 above are the Stage A/B1 evidence record and are unchanged.

---

## 11. What the fresh rebuild is missing after Stage B1

Established by bounded read-only inspection of `tools/migration/import_draft.py`, migrations
002/006/019/056/069, `tools/migration/import_fitzroy_core.py`, `tools/migration/common.py`,
`tools/rebuild/draftguru/draftguru-contract.json`, the Stage A/B1 parsed snapshots and
`src/search/grid-solver-spec.ts`.

| Missing | Detail | Status |
|---|---|---|
| Draft adapter | No Stage A → PostgreSQL path exists at all. | PROVEN |
| Legacy dependency of the only draft importer | `import_draft.py` uses `connect_legacy()` + `DRAFT_QUERY` over legacy `draft` / `draft_links`, and maps links through `players.legacy_player_id` — a column `import_fitzroy_core.py` never populates. On a fresh build both its **facts** and its **links** are unavailable. | PROVEN |
| Bridge coverage | Mechanism proven; evidence exists for **120 of 5,057** persons (2.4%). | PROVEN |
| Link resolver | Nothing turns bridge evidence into `draft_persons.player_id` / `link_status`. | PROVEN |
| Legacy-supplied columns | `name_key` (NOT NULL), `dg_person_id` (NOT NULL), `draft_type`, `draft_kind` (part of the reload key), `source_record_id`, era-aware `club_id`. | PROVEN |
| Columns with **no Stage A source** | `weight_kg`, `competition`, `signing_kind` are absent from `parsed/rows.jsonl` (22 keys: `age_raw, club_href_raw, club_name_raw, club_slug, detail_raw, draft_year, event_type_raw, height_raw, original_club_raw, parity_only, pick_note_raw, pick_number, player_href_raw, player_name_raw, player_ordinal, player_slug, player_url, row_index, signing_raw, source_url, trade_column_present, trade_raw`). `grade` exists only inside `parity_only`. | PROVEN |
| Grid Solver exposure | `signing_kind` feeds `GRID_SIGNING_KINDS` (18 values) and `draft_kind` is queried literally as `'trade'` in `src/db/queries/grid-solver.ts:889`. A derivation change is user-visible. | PROVEN |
| Explicit-decision survival | `player_link_resolutions.target_id` is a `draft_picks.id` surrogate and `player_id` is a `players.id` surrogate. Both regenerate on a fresh build, so the 6 historical decisions cannot survive as stored. | PROVEN |

---

## 12. Approved architecture — bridge through `external_identities`

**APPROVED DESIGN (subject to §19 G2–G7).** One adapter. Coverage is a *data* property, not a
*code* property.

```text
Stage A  annual-html-<label>        parsed/rows.jsonl      6,810 transactions
                                    parsed/persons.jsonl   5,057 identities      ─┐
[future] complete person snapshot   bridge evidence (NOT APPROVED — §18)          ├─► tools/migration/import_draftguru.py
data/reference/draftguru-event-kinds.json      event_type_raw → draft_type/kind   │
data/reference/draftguru-link-decisions.json   6 explicit admin decisions         ─┘
```

Writes `draft_persons`, `draft_picks`, `external_identities` (source `draftguru`),
`data_issues`, `import_batches`. Never opens a network socket. Never opens SQLite.

**Why `external_identities` rather than a new table.** Its own migration-002 comment states it
exists to bridge third-party person IDs "(e.g. DraftGuru)", and it is currently unused for
DraftGuru. `UNIQUE (source_id, external_id)` keyed on `player_url` makes ordinal collapse
structurally impossible; `status` / `match_method` / `player_id` already carry the required
semantics; and `check_population_drop()` applies verbatim, exactly as `import_fitzroy_core.py`
uses it. Bridge findings go to `data_issues`, which `import_draft.py` already uses for this
class of problem. The bridge's audit record is the tracked snapshot + manifest sha256 — the
same arrangement by which the fitzRoy snapshot is the audit record for AFL Tables identity.

**Rejected competing design — "import unlinked, link in a second pass."** Genuinely attractive
(it ships the draft import before any bridge exists, and mirrors the
`import_fitzroy_core.py` → `enrich_birth_dates.py` layering). Rejected as the primary because
`draft_persons.link_status` is NOT NULL under a CHECK and `draft_picks.link_status_value`
propagates from the person: an unlinked-first import writes 5,057 `unmatched` rows that a
second pass must then flip, re-run the decision replay over, and re-file `data_issues` for.
That is **two writers of one invariant**, precisely what migration 019 and the ISSUE-078 reload
exist to prevent. Its coverage virtue is preserved instead by §23 (deterministic behaviour with
no bridge snapshot present).

**Rejected competing design — a typed `draft_person_bridge` evidence table.**
`parsed/person_profile.jsonl` already holds every field, hashed in the manifest and tracked;
`data_issues` is already the findings channel; and a new migration moves the rebuild's
tracked-migration baseline for no capability the manifest does not already provide. Revisit
only if §19 G-closure shows the current schema cannot represent the contract safely — in which
case **HALT** rather than force the design into it (§17).

---

## 13. Identity authority hierarchy (Amendment 11 — approved)

DraftGuru `player_url` is the durable third-party identity. A bridge may resolve that person to
an existing AFL Tables player **only** through the observed person-page AFL Tables href and the
existing AFL Tables external identity.

1. **Explicit human/admin decision** — from the tracked ledger (§16). Overrides a contradicting
   bridge and warns in run output, exactly as `replay_decisions()` does today.
2. **Admissible DraftGuru person-page → AFL Tables bridge** resolving to a registered
   `external_identities (afltables, afltables_profile_url)` row. The only automatic source.
3. **Unmatched** — `player_id NULL`, `link_status = 'unmatched'`.

There is no fourth path. Explicitly excluded, permanently:

- name matching of any kind;
- games-based identity;
- fuzzy candidates or similarity thresholds;
- historical automatic-link replay;
- ordinal collapse.

**DraftGuru `reported_games` may influence backlog triage only, never identity.**

---

## 14. Bridge admissibility contract

ALL of the following must hold, else **no link is written**:

- terminal classification `fetched`, HTTP 200;
- `distinct_afltables_identity_count == 1`;
- `reduces` and `path_shape_ok` true, host `afltables.com`, path matching
  `^players/[A-Za-z]/[^/]+\.html$`;
- every flag false: `malformed_afltables_link`, `multiple_afltables_candidates`,
  `non_reducing_host`, `parse_error`, `self_link_disagreement`, `missing_or_dead_page`,
  `no_afltables_link`;
- the normalised path exists in `external_identities` as
  `(afltables, afltables_profile_url, status IN ('unique','resolved'), player_id NOT NULL)`;
- the path is claimed by **exactly one** `player_url` in this run.

Admissible → `link_status = 'unique'`,
`match_method = 'draftguru_person_page_afltables_bridge'`, `confidence_notes` naming the
snapshot label and the observed href. **`'unique'`, not `'resolved'`** — `resolved` stays
reserved for a human decision, preserving the provenance split the Stage B1 reconciliation
established.

**Collision rule.** Two `player_url` values resolving to one AFL Tables path is a **HALT**,
downgradable to withhold-the-link-and-file-`data_issues` only via an explicit
`--acknowledge-bridge-collisions`, mirroring the existing `--acknowledge-population-drop` and
`--allow-link-loss` idioms. It is **never** an instruction to merge.

**Stored provenance per person.** `external_identities`: `source_id = draftguru`,
`external_id = <player_url>` (byte-exact, percent-encoding preserved), `external_url`,
`external_name = display_name_raw`, `player_id`, `status`, `match_method`, and `notes`
carrying snapshot label + manifest sha256 + observed href + normalised path. Unbridged persons
are stored with `status = 'unmatched'`, `player_id NULL` — the table carries no CHECK
forbidding it (unlike `draft_persons`).

---

## 15. Case treatments

| Case | Treatment |
|---|---|
| **Bridged persons** | `player_id` resolved through `external_identities(afltables)`; `link_status = 'unique'`; propagated to every pick of that person, person-grained as today. |
| **`fred_rodriguez/1`, `riley_onley/1`** | Ordinary unmatched persons. Not defects, never repaired. If DraftGuru reports `games > 0` for them they surface as `is_matching_backlog` plus one `data_issues` row each — a genuine two-person human queue, which is the correct home. |
| **Never-played persons** | First-class citizens: own `draft_persons` row, picks render, `player_id NULL`, `'unmatched'`, `is_matching_backlog = false` because `reported_games = 0`. This is exactly the model migration 019 documents. |
| **Convergence pairs** | Distinctness is **structural, not inferential**: two `player_url` values → two rows under `draft_persons_source_uq` → two `external_identities` rows. Nothing merges them because nothing compares names. The silent side simply carries no `player_id`. |
| **Explicit resolutions** | Exported once to a tracked natural-key ledger (§16), replayed after the source facts are written, inside the same transaction. |
| **Historical automatic mappings** | **All discarded, without exception** — not by a filter but by the absence of any code path that can read them. The legacy connection is gone. B1's 33/33 agreement is retained as a *validation expectation*, never as an input. |

**Why `reported_games` in backlog triage is not a rule violation.** `is_matching_backlog` uses
DraftGuru `reported_games`. That selects **whether a human should look**, never **which player**
anything is; identity comes from the href alone. Migration 019 already licenses precisely this
use ("Used only to tell a genuine non-player from a matching backlog; never displayed as a
career total"). The adapter must carry this reasoning as a code comment so it is not later
"corrected" into an actual violation.

---

## 16. Explicit-decision ledger

**APPROVED DESIGN. Export NOT APPROVED to run until G5 closes (Amendment 9).**

`data/reference/draftguru-link-decisions.json`:

```json
{ "target":   { "source_key": "draftguru", "player_url": "...", "draft_year": 2001, "draft_kind": "..." },
  "action":   "linked" | "confirmed_unlinked",
  "player_identity": { "source": "afltables", "external_id": "players/B/Brad_Miller.html" } | null,
  "previous_status": "...", "decided_at": "...", "note": "..." }
```

- natural-keyed on migration 069's own reload key `(source_id, player_url, draft_year,
  draft_kind)`;
- the player is named by its **AFL Tables profile path**, never by `players.id`;
- **never export numeric surrogate ids as durable ledger identity** — not `draft_picks.id`, not
  `players.id`, not `auth_users.id`;
- replay reuses `import_draft.py`'s `replay_decisions()` almost verbatim; only its *input*
  changes from a live DB read to the tracked ledger;
- a decision whose natural key the source no longer carries, or whose player identity does not
  resolve, is a **HALT** unless `--allow-link-loss` (existing idiom);
- two picks of one person carrying contradictory decisions always HALT — `--allow-link-loss`
  does not apply, exactly as `classify_decisions()` already enforces.

`player_link_resolutions` audit rows are **not** re-inserted: ISSUE-093 §7 declares them
disposable, and `admin_user_id` references `auth_users`, which a fresh build has not seeded.
Recorded as an accepted, stated consequence rather than an oversight.

**Approval boundary (Amendment 9).** The one-time export is a *controlled natural-key export*
whose purpose is to emit the six approved decision records into the tracked ledger. That is
deliberately different from the earlier aggregate-only reconciliation egress boundary, and the
two must not be conflated. It still runs only under the §21 read-only envelope, and only after
separate user approval.

---

## 17. Decisions register

| Claim | Status |
|---|---|
| The bridge mechanism is deterministic, uniform and collision-free **within the measured B1 sample** | **PROVEN** — 100/100 distinct identities, one URL form, 0 malformed / 0 multiple-candidate / 0 non-reducing-host / 0 parse errors |
| Strongest correctness evidence: **33 comparable, 33 same, 0 contradicts, 0.00% contradiction rate** — within the measured B1 sample | **PROVEN** |
| The deliberately adversarial 120-person B1 sample is sufficient to justify **IMPLEMENTING** a fail-closed bridge resolver under the §14 admissibility contract | **PROVEN** |
| Population-wide bridge coverage | **OPEN — population-scale question** |
| Population-wide absence of collisions | **OPEN — population-scale question** |
| Population-wide absence of malformed / multiple-candidate links | **OPEN — population-scale question** |
| Full 5,057-person correctness | **OPEN — population-scale question** |
| The bridge alone cannot cover never-played persons | **PROVEN** — structural: AFL Tables profiles only players who played |
| The 120-person sample is **not** sufficient coverage for a rebuild | **PROVEN** — 2.4% |
| No deterministic alternative to person-page acquisition exists | **INFERRED** (§18) |
| No schema change and no migration are required | **INFERRED — remains conditional (Amendment 5)**; freezes only when §19 G2–G7 close, current `external_identities` semantics are confirmed sufficient for the proposed DraftGuru rows, unmatched DraftGuru identities with `player_id NULL` are proven compatible with schema *and* application semantics, and no further provenance requirement emerges. If evidence shows the current schema cannot represent the contract safely, **HALT** rather than force the design into it. |
| `signing_kind` / `weight_kg` / `competition` / `grade` survive the rebuild | **OPEN** — G3/G4 |
| Club mapping is deterministic for all 6,810 rows | **OPEN** — G7 |
| Collisions occur at 5,057 scale | **REQUIRES EXPERIMENT** — 0 at sample scale, unmeasured at population scale |

**Amendment 3 is binding:** never state without qualification that the 120-person sample
"proves the bridge rule". It justifies implementation of a fail-closed resolver. It does not
establish population-scale coverage, collision-freedom, malformed-link-freedom, or 5,057-person
correctness.

---

## 18. Stage B3 — PROPOSED / NOT APPROVED / NOT STARTED

**Approval of this B2 plan authorises no network request of any kind.** B2 may design and
validate the adapter entirely independently of B3. No complete person snapshot may be acquired
until the user separately approves it.

Every alternative to person-page acquisition was tested against the evidence and rejected:

| Alternative | Rejected because |
|---|---|
| Derive from Stage A alone | `parsed/rows.jsonl` carries no AFL Tables href — verified; 22 keys, `player_href_raw` only. |
| Reverse direction (AFL Tables → DraftGuru) | AFL Tables pages carry no DraftGuru link, and it would itself require acquisition. |
| Replay legacy automatic links | Forbidden, and proven wrong (Brad Miller). |
| Name matching | Forbidden, unconditionally. |
| Scope acquisition by DraftGuru `games > 0` | Would drop real identities: **4 of 24** sampled `games = 0` persons carried a bridge (16.7%). It also re-admits games as a de-facto identity gate. |
| Lazy / on-demand fetch at import time | Breaks the importer's no-network boundary and makes the import non-reproducible. |

**Candidate shape, if and only if separately approved:**

- population: the 5,057 distinct `player_url` values in Stage A `parsed/persons.jsonl`;
- one request per person at the existing policy (concurrency 1, 1.5 s pacing, 20 s timeout,
  3 retries at 2/4/8 s, same-host redirects only, robots.txt respected), resumable under the
  existing terminal-classification contract;
- a **new label** — Stage B1's `person-html-20260826` is `immutable: true`,
  `identity_complete: false`, `import_capable: false` and **must never be promoted in place**;
- the decision it would answer: *what is the bridge coverage and the collision count over the
  whole DraftGuru person population?* Existing evidence cannot answer it — 120 persons drawn
  deliberately non-representatively (68 of them a residual census) do not estimate a
  5,057-person rate.

**Manifest semantics are NOT pre-approved (Amendment 4).** B2 does not and cannot freeze that a
future complete person snapshot declares `identity_complete: true` / `import_capable: true`.
Those states must be **earned** by an eventual approved B3 contract and its validation. For now
the durable record says only: *a future complete person snapshot would need an explicit contract
defining the conditions under which it could become admissible as an import input.*

**Regression expectation across acquisition dates is SEMANTIC, not byte-level (Amendment 2).**
Live HTML may legitimately change between acquisition dates. For the frozen B1 anchors a future
acquisition should reproduce the same DraftGuru `player_url` identity, the same terminal
classification, the same AFL Tables href / normalised external identity where still present, and
the same absence classification where still absent — **or report any drift explicitly as a
finding**. Raw-byte equality may be *recorded* when it happens but must never be a correctness
gate across acquisition dates. The accepted B1 raw bytes themselves remain immutable.

---

## 19. Evidence gaps G1–G7

| | Gap | How it closes |
|---|---|---|
| **G1** | Population-scale bridge coverage / collisions / malformed links | **Stage B3 only** (§18, NOT APPROVED). Not closable by SQL or by tracked data. |
| **G2** | `draft_type` / `draft_kind` vocabulary, including the 113 `__no_draft_column__` rows (1981, 1982, 1987) | `SELECT draft_type, draft_kind, count(*) FROM draft_picks GROUP BY 1,2 ORDER BY 1,2` — pins the tracked mapping exactly and protects `GRID_DRAFT_TYPES` (11 values) and `grid-solver.ts:889`'s literal `draft_kind = 'trade'`. |
| **G3** | Is `signing_kind` derivable from Stage A `signing_raw`, or was it upstream-only? | `SELECT signing_kind, count(*) FROM draft_picks GROUP BY 1`, plus a sampled `signing` / `signing_kind` pairing. If upstream-only, the Grid Solver's signing dimension loses its data on rebuild — a real regression that must be **stated and quantified**, never silently absorbed. |
| **G4** | Quantify the loss on `weight_kg`, `competition`, `grade` | one `count(*) FILTER (...)` row per column. |
| **G5** | Do all five `linked` explicit decisions' players hold an `afltables_profile_url` external identity? | If any does not, it cannot be natural-keyed → **HALT before the ledger is frozen**, and §16's export must not run. |
| **G6** | `name_key` derivation | compare stored `name_key` against `afldb_normalise_name(display_name_raw)`. |
| **G7** | **DraftGuru Club → canonical AFLDB `club_id` mapping** (Amendment 6) | See below. |

### G7 — club mapping (new, Amendment 6)

The plan identified era-aware `club_id` as legacy-supplied but did not close the deterministic
replacement. B2 must determine, before the adapter may write:

- exactly what the Stage A club values represent — `club_name_raw`, `club_href_raw`,
  `club_slug` — noting the contract states **"DESTINATION club under DraftGuru's modern
  identity — era-aware AFLDB resolution required downstream, failing closed on 'Brisbane'"**;
- whether that is historical club identity or modernised destination text;
- which tracked reference source (`data/reference/clubs.json`, `club_aliases`) maps every Stage A
  value to an AFLDB `club_id`;
- whether organization lineage / era containment is relevant, and how — the same problem
  `import_fitzroy_core.py` already solves for fitzRoy club strings (era-aware resolution within
  one `organization_id`, mergers never silently collapsed);
- whether all 6,810 rows map deterministically;
- what happens on an unknown club value.

**No name-fuzzy fallback.** An unknown or unmapped club value must fail closed, or receive an
explicitly approved NULL / source-fact treatment. Note `import_draft.py`'s current behaviour is
best-effort (`clubs.get(...)` falling back to `club_name_raw`); that is **not** automatically
carried forward and must be an explicit decision.

**Prefer closing G7 from tracked Stage A + reference data without PostgreSQL.** Add a bounded
read-only DB comparison only if it answers something the tracked sources cannot.

---

## 20. Column derivation obligations (Amendment 7)

The adapter may not be approved to write until every required target column has a
deterministic, stated derivation. For each, the final B2 plan must record **exactly one** of:

- **A** — derived deterministically from accepted Stage A data;
- **B** — supplied by a tracked reference mapping;
- **C** — deliberately NULL because the target permits absence and the source has no
  authoritative fact;
- **D** — deliberately not imported, with quantified accepted loss;
- **E** — HALT, because current evidence is insufficient.

**No field may silently inherit legacy semantics.**

| Column | Current provisional classification | Blocked on |
|---|---|---|
| `name_key` | A (candidate: `afldb_normalise_name(display_name_raw)`) — **not yet frozen** | G6 |
| `dg_person_id` | A — **not yet frozen** (see below) | — |
| `source_record_id` | A — **not yet frozen** (see below) | — |
| `draft_type` | A/B — source wording verbatim, `unknown` for the 113 no-`Draft`-column rows | G2 |
| `draft_kind` | B — tracked vocabulary mapping, fail-closed on an unknown `event_type_raw` | G2 |
| `club_id` | B — **not yet frozen** | G7 |
| `signing_kind` | Undetermined: A if derivable from `signing_raw`, else D with quantified loss, else E | G3 |
| `weight_kg` | C or D — no Stage A source | G4 |
| `competition` | C or D — no Stage A source | G4 |
| `grade` | D — present only under `parity_only`, whose contract role is `parity-only` | G4 |

**`dg_person_id` — specific obligation.** It is **not** durable identity: it is a per-load rank
(`p.index + 1` over a person frame sorted by `player_url`), which is exactly why migration 069
exists. Before implementation, define **one** deterministic per-load assignment algorithm and
prove it (a) does not affect `player_url` identity, and (b) does not affect either reload key.
The `SET CONSTRAINTS draft_persons_source_id_dg_person_id_key DEFERRED` requirement remains,
because a bulk UPDATE that permutes the column fails row-by-row under a non-deferrable unique
constraint.

**`source_record_id` — specific obligation.** **Do not reuse legacy SQLite row ids** — the
legacy table is written `to_sql(if_exists="replace")`, so every rowid is reissued on every
source rebuild. Define a deterministic replacement derived from accepted Stage A data (candidate:
`source_url` + `row_index`), or leave it absent only if schema semantics permit that. It is
provenance, never a key.

---

## 21. Manifest admission gates (Amendment 8)

The earlier blanket gate "both manifests verified … `import_capable`" was too broad. The actual
accepted manifest semantics are:

| Snapshot | Declared | Admissible for |
|---|---|---|
| Stage A `annual-html-20260826` | `identity_complete: true`, `import_capable: true` (verified in the tracked manifest) | consumption **as its own accepted contract allows** — the draft-fact and person-population import source |
| Stage B1 `person-html-20260826` | `identity_complete: false`, `import_capable: false`, `immutable: true` | **profiling and fixture/sample validation oracle only** |

Binding rules:

- **do not silently reinterpret an existing manifest's `import_capable` flag**;
- the B1 person snapshot **cannot** become a production import source merely because Stage B2
  exists; it may be used as a fixture / sample validation oracle;
- a future production bridge snapshot requires its own approved contract (§18);
- the Stage A annual snapshot may be consumed **only** according to its actual accepted
  contract. If that contract needs an additive B2 admission rule, design it explicitly as an
  additive contract block — never by rewriting historical manifest meaning.

---

## 22. Implementation sequence

Each step: **purpose · files · evidence dependency · validation gate · needs user-run
SQL/network/tests**. Steps B2-2 onward are NOT APPROVED to start; approval covers the design.

**B2-1 — Close G2–G6, plus G7 if it cannot be closed entirely offline. [NEXT APPROVED STEP]**
Purpose: pin the vocabulary and derivation facts the adapter encodes. · Files: one small
reviewable read-only runner under `tools/rebuild/draftguru/`, reusing
`reconcile_person_bridge.py`'s envelope — **not** a large shell heredoc. · Evidence: current
`afldb_dev`. · Gate: the G2–G6 results returned, `ROLLBACK` confirmed, zero writes. ·
**User-run SQL: YES. Claude must not run it.**

**B2-2 — Tracked event-kind vocabulary.**
Purpose: deterministic `event_type_raw` → (`draft_type`, `draft_kind`), fail-closed on an unknown
value, covering the 113 `__no_draft_column__` rows. · Files:
`data/reference/draftguru-event-kinds.json`. · Evidence: G2 + contract `event_type_baseline`
(11 values) + `GRID_DRAFT_TYPES`. · Gate: the mapping reproduces G2's distinct pairs exactly. ·
User-run: tests only.

**B2-2b — Club mapping decision.**
Purpose: close G7 into a stated rule (B, or an explicitly approved fail-closed/NULL treatment). ·
Files: reference mapping or an additive contract block. · Evidence: G7. · Gate: all 6,810 rows
map deterministically, or the unmapped population is enumerated and its treatment explicitly
approved. · User-run: only if the tracked sources cannot answer it.

**B2-3 — Explicit-decision ledger export.** *(Blocked on G5 and on separate user approval.)*
Purpose: convert the 6 surrogate-keyed decisions to natural keys. · Files:
`tools/rebuild/draftguru/export_link_decisions.py` (read-only),
`data/reference/draftguru-link-decisions.json`. · Evidence: G5. · Gate: 6 records out
(5 `linked`, 1 `confirmed_unlinked`), every `linked` carrying a resolvable AFL Tables path;
anything else HALTs. · **User-run SQL: YES**, same read-only envelope.

**B2-4 — `tools/migration/import_draftguru.py`.**
Purpose: the adapter. Reads Stage A + an optional person snapshot + both reference files;
verifies manifests fail-closed per §21 **before** connecting to PostgreSQL; reuses
`reload_keyed`, `import_batch`, `check_population_drop`, `analyze` and a lifted
`replay_decisions`. · Evidence: B2-1 … B2-3. · Gate: `--validate-only` then `--dry-run` clean. ·
User-run: tests.

**B2-5 — Bridge resolution inside B2-4.**
Purpose: §14 admissibility → `draft_persons.player_id` + `external_identities(draftguru)`. ·
Evidence: §14. · Gate: sample-scale replay against the B1 snapshot as a validation oracle
reproduces 100 links, 0 collisions, 0 name matches, and the four convergence pairs as eight
distinct persons. · User-run: tests.

**B2-6 — Tests.** Extend `tests/draftguru-acquisition.test.ts` (the established semantic home,
87/87 baseline); create `tests/draftguru-import.test.ts` only if that suite is not a sensible
home. · Gate: §24 gates pass with **no** network and **no** database. · **User-run tests: YES.**

**B2-7 — GATED retirement of `import_draft.py` (Amendment 10).**
The existing legacy importer **remains untouched** until *all* of: `import_draftguru.py` exists;
offline validation passes; fresh-PostgreSQL integration passes; idempotency passes; explicit
decisions are preserved; population gates pass; rebuild orchestration successfully uses the
replacement; and repository references to `import_draft.py` have been audited. Only then decide
whether retirement means deletion, removal from orchestration, or explicit legacy-only
quarantine, per repository workflow. **The objective is zero `AFLDB_LEGACY_SQLITE` dependency on
the supported rebuild path — it does not require deleting a legacy file before the replacement
is proven.**

**B2-8 — Orchestrator wiring** (§6.9(d), after the fitzRoy core import and the reference
loader). Gate: a `--require-complete-bridge` mode refuses unless an approved complete person
snapshot exists whose contract admits it as an import input (§18/§21) and whose population
equals Stage A's 5,057. · User-run: rebuild.

**Stage order.** reference loader → fitzRoy/AFL Tables core (establishes `players` +
`external_identities(afltables)`) → **Stage A read** → **bridge evidence read (if any)** →
**draft import** → **explicit-resolution replay, same transaction** → derived rebuild.

---

## 23. B2/B3 separation (Amendment 12)

**Stage B2's definition of done is the deterministic fresh-rebuild ADAPTER and the
identity/provenance contract.** Population-scale bridge acquisition is a separate
data-acquisition decision.

B2 must therefore behave deterministically when **no** complete bridge snapshot exists:

- persons remain distinct;
- source facts import in full (6,810 rows / 5,057 persons);
- unbridged persons remain `unmatched` with `player_id NULL`;
- explicit decisions replay where authoritative;
- **no automatic fallback occurs** — no name match, no games heuristic, no legacy replay.

A future approved complete bridge snapshot then adds deterministic positive links **without
changing any identity rule**.

---

## 24. Gates that must pass before the first PostgreSQL write

| # | Gate | Mechanism |
|---|---|---|
| 1 | Manifests verified and admitted per §21 (sha256, row counts, declared flags, permitted use) | fail-closed, before `connect_pg` |
| 2 | 6,810 rows / 5,057 persons present | count assertion |
| 3 | Every `player_url` matches the canonical regex, byte-exact, percent-encoding preserved | regex + round-trip |
| 4 | **No ordinal collapse** — `/1` and `/2` remain two persons | Brad Miller anchor plus all four convergence pairs |
| 5 | **No name-only matching** — every link traces to an href | no code path reads a name for identity; asserted by source pin + fixture |
| 6 | **No bridge collision** — each AFL Tables path claimed once | group-by check, HALT |
| 7 | **No automatic-link replay** — no legacy read path exists | `AFLDB_LEGACY_SQLITE` / `connect_legacy` absent from the module |
| 8 | Every reload key unique | `reload_keyed`'s existing duplicate-key check |
| 9 | Population-drop gate armed on `external_identities(draftguru)` | `check_population_drop()` |
| 10 | Explicit decisions classified **before** any write | `classify_decisions()` semantics; HALT on contradiction |
| 11 | Unknown `event_type_raw` → HALT | tracked vocabulary lookup |
| 12 | Unknown club value → fail closed or explicitly approved treatment | §19 G7 rule |
| 13 | Every §20 column carries a stated A/B/C/D/E classification | plan pin + test |
| 14 | Idempotency: a second `--dry-run` over identical input is byte-identical | fixture replay |

---

## 25. Database safety, idempotency, population preservation, HALT, rollback

**Database safety.** One `import_batch` transaction. Every write scoped `source_id = draftguru`.
Admin-created picks (`source_id IS NULL`) stay outside the reload's UPDATE, INSERT and DELETE
alike, as the migration-069 partial index already guarantees. `draft_persons` is upserted with
`delete_missing=False`, and childless persons are deleted only after their picks — the NO ACTION
FK ordering migration 069 requires.

**Idempotency.** Every table reconciled by its natural reload key, so row ids survive a reload —
which matters because those ids *are* durable application identity
(`player_link_resolutions.target_id`, `player_link_match_candidates`, draft-person
`data_issues`). `dg_person_id` is a per-load rank, so the deferred-constraint step remains
mandatory (§20).

**Population preservation.** `check_population_drop()` on `external_identities(draftguru)`; hard
assertions on 6,810 / 5,057; unlinked rows always retained, never dropped — a draft row is a fact
about the draft whether or not the person ties to an AFLDB player.

**HALT conditions.** Manifest mismatch or inadmissible manifest use · unknown `event_type_raw` ·
unknown club value (absent an approved treatment) · unkeyable row (no `player_url` or no
`draft_kind`) · duplicate reload key · bridge collision · contradictory explicit decisions · a
decision that cannot be carried · an AFL Tables path resolving to a player that does not exist ·
asserted population of zero · schema proven unable to represent the contract safely (§17).

**Rollback.** Every HALT raises before, or inside, the transaction that `import_batch` rolls back
and marks failed. Both snapshots are immutable and read-only throughout.

---

## 26. Definition of done — Stage B2

`import_draftguru.py` imports 6,810 picks / 5,057 persons into a fresh database from tracked
snapshots alone; every link traces to a person-page href; the four convergence pairs remain eight
distinct persons; the six explicit decisions replay from the tracked ledger; a rerun is a no-op;
every §20 column carries a stated derivation; `import_draft.py` retirement is gated per §22 B2-7;
**zero** `AFLDB_LEGACY_SQLITE` on the supported rebuild path; `IssuesIndex.md` and `CHANGELOG.md`
updated.

**Full bridge coverage is Stage B3's definition of done, not B2's.**

---

## 27. Exact next execution boundary

The next approved step is **evidence gathering only: B2-1 — close G2–G6, plus G7 if it cannot be
closed entirely offline.** No importer implementation is approved before those results are
evaluated.

The user-run database work must retain the existing envelope:

- `AFLDB_OWNER_DATABASE_URL` parsed explicitly from `.env` — **never source `.env`**;
- hard guard on `/afldb_dev`;
- refuse the preserved pre-rebuild database (`afldb_test_pre_rebuild_20260825`);
- `default_transaction_read_only = on`;
- `REPEATABLE READ READ ONLY`;
- verify database / read-only / isolation in-session;
- `ROLLBACK`;
- **zero PostgreSQL writes**.

Prefer one small reviewable runner over a large shell heredoc. **Claude does not run it.**

---

# PART III — B2-1 EXECUTION STATE (2026-08-26)

**Step: B2-1 evidence gathering ONLY. No importer exists. No SQL has been run. No network
request has occurred. No `src/` file has been changed. Stage B3 remains PROPOSED / NOT
APPROVED / NOT STARTED.**

Everything in §28 below was measured **offline** from the accepted, immutable Stage A
snapshot `annual-html-20260826` (`parsed/rows.jsonl`, `parsed/persons.jsonl`) and from
tracked reference data. No database was contacted. §29 is the prepared runner; §30 records
what remains pending user execution.

---

## 28. Offline findings (measured, not assumed)

### 28.1 G7 — DraftGuru Club → canonical AFLDB `club_id`: **OPEN, not closable offline**

**What Stage A actually records.** Every one of the **6,810** rows carries all three club
fields with **zero NULLs**: `club_name_raw`, `club_slug`, `club_href_raw`. `club_href_raw`
is `/clubs` on every row and the durable value is `club_slug`, taken from DraftGuru's own
club path — so the destination club is a **stable DraftGuru club identity, not free text**.
There are exactly **19 distinct `(club_name_raw, club_slug)` pairs**, and the pair is
1-to-1 in both directions.

| `club_slug` | rows | year span | maps to `data/reference/clubs.json` |
|---|---:|---|---|
| collingwood, sydney, carlton, st-kilda, hawthorn, essendon, melbourne, north-melbourne, richmond, geelong, western-bulldogs, west-coast, adelaide, fremantle, port-adelaide, gold-coast, greater-western-sydney, fitzroy | **6,388** | 1981–2025 | **yes — exact `slug` equality, 18 of 19** |
| **`brisbane`** | **422** | 1986–2025 | **NO — no such identity exists** |

Counts sum to exactly 6,810. Coverage of the exact-slug rule is **93.80%**.

**Why `brisbane` cannot be mapped from tracked data.** `clubs.json` holds
`brisbane-bears` (1987–1996, `succession: merged`) and `brisbane-lions` (1997–,
`succession: current`) as **two distinct organizations**, joined only by
`organization_relations` `merged_into` (1997), whose own note says *"Statistics are not
combined: each organization keeps its own record."* One DraftGuru label therefore spans two
AFLDB identities across a **merger** boundary. Per the club-lineage rule a merger is
link-only and must never be silently collapsed, so `brisbane` **must fail closed** unless an
era rule can split it — and no tracked source supplies one.

**The era problem is broader than Brisbane, and is genuinely unresolved.** DraftGuru
modernises some historical identities and not others. Measured against `clubs.json` season
spans, four labels conflict:

| `club_slug` | rows in the conflicting era | AFLDB identity for that era | succession class |
|---|---:|---|---|
| `brisbane` | 422 (all) | Brisbane Bears **or** Brisbane Lions | **merged** |
| `western-bulldogs` | 113 (`draft_year` ≤ 1995) | Footscray | renamed |
| `north-melbourne` | 93 (`draft_year` 1998–2006) | Kangaroos | renamed |
| `sydney` | 2 (`draft_year` = 1981) | South Melbourne | relocated |

DraftGuru is internally inconsistent here: it modernises Footscray, Kangaroos and South
Melbourne away, but **retains Fitzroy** (131 rows, 1981–1995) as its own label while
collapsing Bears and Lions into one.

**A `draft_year + 1 = destination season` offset would resolve all four**, and three
independent boundary observations are consistent with it:

- `brisbane` first appears in **1986** though Brisbane Bears' first season is **1987**;
- `fitzroy`'s last rows are **1995** though Fitzroy played the **1996** season — there is no
  1996 Fitzroy row because the club merged before the next season;
- `sydney` appears in **1981** though the relocation from South Melbourne took effect in
  **1982**.

**This is an inference, not a tracked fact, and it is not universally true.** The 280
`Mid-Season` rows (2019+) take effect in the **same** season by construction, so the offset
is event-type dependent. No mid-season row falls near an era boundary, so nothing is
currently mis-derived by it — but the rule would encode an unstated assumption about a
source semantic, which §19 forbids doing silently.

**G7 = OPEN. Exactly what is missing:** a tracked, stated rule for (a) which *season* a
`draft_year` row's destination club belongs to, and (b) whether AFLDB wants **era-aware
historical** club identity or DraftGuru's **modern destination** label. Both are AFLDB
modelling decisions, not facts about DraftGuru.

**A database lookup cannot supply either.** What `afldb_dev` holds is `import_draft.py`'s
best-effort `clubs.get(club_raw.lower())` over `club_aliases` / `clubs.name` /
`clubs.short_name`, which §19 states is **not automatically carried forward**. It is
nevertheless worth one bounded aggregate view, because it quantifies the user-visible
regression envelope for each label — so the runner includes it as an explicitly labelled
**G7 supplement**, prior-behaviour evidence only, never authority. The decision itself
belongs to step **B2-2b** and to the user.

### 28.2 G2 — two material corrections to the plan's assumptions

1. **The 113 rows store JSON `null`, not the string `__no_draft_column__`.** The contract's
   `event_type_baseline` uses `__no_draft_column__` as a *reporting label*; in
   `parsed/rows.jsonl` the field is literally `"event_type_raw": null`. Confirmed by year:
   **1981 × 24, 1982 × 24, 1987 × 65 = 113**, exactly the contract's variant-A years. The
   B2-2 vocabulary file must key on the **absence** of a value, not on that sentinel string.
2. **`GRID_DRAFT_TYPES` is not a 1-to-1 image of the Stage A vocabulary.** It carries **11**
   values including *both* `'National'` **and** `'National Draft'`, while Stage A observes
   only `'National'`. G2's DB measurement must pin which spellings are actually stored
   before any `event_type_raw → draft_type` mapping is frozen.

The Stage A vocabulary itself reproduces the contract baseline exactly: National 2976,
Rookie 1209, Trade 990, Pre-Season 541, Pre-Draft 370, Mid-Season 280, Post-Draft 188,
Free Agency 138, *(null)* 113, Mini-Draft 4, Training Squad Selection 1 = 6,810.

### 28.3 G3 — `signing_kind` is very likely **derivable (A)**; DB run is now a confirmation

Measured on Stage A `signing_raw`:

| Measure | Value |
|---|---:|
| Rows carrying a `signing_raw` | **995 / 6,810 = 14.61%** |
| Distinct non-null values | **165** |
| Years present | 1988–1996, 1999–2025 (**0 in 1997 and 1998**, where `Detail` replaces `Signing`) |

Removing the **first parenthetical qualifier** — `btrim(regexp_replace(v, '\s*\(.*$', ''))`
— reduces those 165 values to **exactly 18 heads**, and that head set is **set-equal to
`GRID_SIGNING_KINDS`**: no residue in either direction.

```text
Academy  Compensation  Concession  Concessional  DFA  FA  Father-Son  Foundation
International  SSP  Scholarship  Special Cat B  Supplementary  Top-Up
Uncontracted  Underage  Unregistered  Zone
```

**Egress hazard, binding:** `signing_raw` embeds player names — `Father-Son (David␠Cloke)`,
NBSP-separated — so it is never identity and its source text is **never dumped**. The
runner prints `signing_kind` (categorical vocabulary) and counts only.

The remaining question is whether the **stored** `signing_kind` agrees row-by-row, and in
particular whether any row holds a `signing_kind` that Stage A cannot reproduce (a row with
`signing_kind` but no `signing`, e.g. the 345 rows of 1997–1998).

### 28.4 G4 — Stage A side, measured

| Column | Stage A source | Coverage |
|---|---|---|
| `weight_kg` | **none** — no such field in the 22-key row schema | 0 / 6,810 |
| `competition` | **none** — no such field | 0 / 6,810 |
| `grade` | `parity_only.grade` | **6,093 / 6,810 = 89.47%**, **7** distinct values (D 1911, C+ 1286, C 1169, B 868, A 389, B+ 361, A+ 109; 717 absent) |

`grade` therefore *is* reproducible in principle — but only out of the `parity_only` block,
whose contract role is `parity-only`. Importing it would be a **deliberate promotion of a
parity-only field to a canonical fact** and requires explicit approval; it must not be
approved merely because the values exist. The DB counts quantify what is lost if it is not.

Other Stage A field coverage, for completeness: `age_raw` 6,780 · `height_raw` 6,324 ·
`original_club_raw` 6,549 · `pick_note_raw` 101 (matches the contract's 101 special-pick
labels) · `pick_number` 5,124 (→ **1,686** blank, matching the baseline) · `detail_raw`
**12** rows / 7 distinct (1986, 1997, 1998 — includes `'Brisbane'` and father-son player
names) · `trade_raw` **0 / 6,810**.

### 28.5 Three offline results that de-risk §20 and §24

- **`display_name_raw` is deterministic (A).** All **5,057** persons carry **exactly one**
  distinct raw spelling across all their rows (`persons.jsonl.display_names_raw` is a list,
  but its distinct count is 1 for every person, before any folding). There is no
  "which spelling wins" decision to make, and `name_key` therefore has a single input.
- **`dg_person_id` has a proven deterministic per-load rule.** `persons.jsonl` is **already
  sorted by `player_url` ascending** (verified byte-wise over all 5,057 records), so
  `dg_person_id = index + 1` is reproducible without any sort of its own. It remains a
  per-load rank and **never** durable identity; the `SET CONSTRAINTS … DEFERRED` obligation
  in §20 stands unchanged.
- **Gate #8 (every reload key unique) passes offline, in advance.**
  `(player_url, draft_year, event_type_raw)` is **unique across all 6,810 rows — 6,810
  distinct, 0 duplicates**. Since the migration-069 reload key is
  `(source_id, player_url, draft_year, draft_kind)`, the key holds **provided `draft_kind`
  is a total function of `event_type_raw`** — which is precisely what G2 must establish.
  If G2 shows `draft_kind` collapses two `event_type_raw` values together, this guarantee
  is void and must be re-measured.
- **`source_record_id` candidate is proven unique.** `(source_url, row_index)` is unique
  across all 6,810 rows. Both fields are present on every row. Legacy SQLite rowids remain
  forbidden.

---

## 29. The B2-1 evidence runner

**File created: `tools/rebuild/draftguru/b2_evidence.py`** (new; the only implementation
file touched by B2-1). It extends the Stage B1 safety envelope from
`reconcile_person_bridge.py` rather than overloading that file, because its questions are
schema/vocabulary questions and share none of its inputs.

**Safety envelope — identical to §27:** `AFLDB_OWNER_DATABASE_URL` parsed out of `.env`
(never sourced, never printed); DSN path hard-guarded to `/afldb_dev`; the preserved
pre-rebuild database refused by name substring; `psycopg` connect with
`-c default_transaction_read_only=on`; `conn.read_only = True`; `REPEATABLE READ`;
in-session verification of `current_database()`, `transaction_read_only`,
`default_transaction_read_only` and `transaction_isolation`, each a hard refusal; **SELECT
only**; explicit `ROLLBACK` in a `finally` on both success and failure, then close. No
`psql`, no SQLite, no `AFLDB_LEGACY_SQLITE`, no network.

**Egress rules enforced by construction:** aggregate counts plus low-cardinality
*categorical* vocabulary only. No player name, no display text, no `signing` source text,
and **no surrogate id of any kind** — not `players.id`, not `draft_picks.id`, not
`draft_persons.id`, not `auth_users.id`. `grade` and `competition` vocabularies print only
while their cardinality stays ≤ 30; above that the runner reports the cardinality and
**declines to dump source text**.

**What it measures**

| Section | Measurement |
|---|---|
| SCOPE | `draft_picks` by source key, so admin-created rows (`source_id IS NULL`) are visible and excluded from every other section |
| **G2** | distinct `(draft_type, draft_kind)` with counts and year span; then the same restricted to 1981/1982/1987 — the 113 no-`Draft`-column rows |
| **G3** | `signing` / `signing_kind` presence, both one-sided cases, head-rule matches vs mismatches, distinct `signing` **cardinality only**, `signing_detail` presence; `signing_kind` vocabulary with counts; mismatches broken down **by `signing_kind`, never by source text** |
| **G4** | `weight_kg` / `competition` / `grade` non-null-non-empty counts and percentages, plus each column's distinct cardinality and (bounded) vocabulary |
| **G5** | aggregate only: `explicit_decisions_total`, `linked_explicit_total`, `linked_with_stable_afltables_identity`, `linked_without_stable_afltables_identity`, `confirmed_unlinked_total`, `natural_key_complete` / `natural_key_incomplete`, `target_row_has_person`. Stability is tested as an `external_identities` row with `sources.key='afltables'`, `match_method='afltables_profile_url'`, `status IN ('unique','resolved')` and `external_id ~ '^players/[A-Za-z]/[^/]+\.html$'`. Prints an explicit **HALT** line if the 5 / 5 / 0 gate is not met, or if any decision's target row cannot be natural-keyed |
| **G6** | the canonical normaliser is **discovered from `pg_proc`**, not assumed; then persons compared, matches, mismatches, source null/blank, normaliser-returned-null, and a names-free diagnostic counting mismatches that are explained purely by folding U+00A0 to a space |
| **G7 supp.** | `club_name_raw` → resolved `clubs.slug` (or `<UNRESOLVED>`), counts and year span. Club slugs are tracked reference data, not identity surrogates; `clubs.id` is never selected. Labelled **prior behaviour only** |

Automatic-only historical link mappings are **not** consulted anywhere in this runner; the
G5 authority check reads `player_link_resolutions` alone.

---

## 30. B2-1 MEASURED RESULTS (user-run, 2026-08-26)

**Command:** `cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/b2_evidence.py`

**Safety verified in-session:** `db=afldb_dev  user=afldb_owner  txn_ro=on  default_ro=on
isolation=repeatable read` — **`ROLLBACK completed — nothing was written.`**

### 30.1 G2 = **CLOSED**

Current PostgreSQL vocabulary, all 6,810 rows:

| `draft_type` | `draft_kind` | picks |
|---|---|---:|
| National | `national` | 2976 |
| Rookie | `rookie` | 1209 |
| Trade | `trade` | 990 |
| Pre-Season | `preseason` | 541 |
| Pre-Draft | `pre_draft` | 370 |
| Mid-Season | `midseason` | 280 |
| Post-Draft | `post_draft` | 188 |
| Free Agency | `free_agency` | 138 |
| **National Draft** | `national` | **113** |
| Mini-Draft | `mini_draft` | 4 |
| Training Squad Selection | `training_squad_selection` | 1 |

The 113 are exactly the no-`Draft`-column rows: **1981 × 24, 1982 × 24, 1987 × 65**, all
stored as `National Draft` / `national`.

**Resolution.** The Stage A **absence** of a `Draft` column is a real, deterministic input
category that maps to `draft_type = 'National Draft'`, `draft_kind = 'national'`. The
tracked vocabulary must key on that absence directly — **no synthetic
`__no_draft_column__` source value is to be introduced**.

**Consequence for gate #8.** `draft_kind` is *not* injective over `event_type_raw`:
`'National'` and the null case both map to `national`. §28.5's offline uniqueness proof used
`(player_url, draft_year, event_type_raw)`, so it does **not** transfer automatically. It
still holds in fact, because `National` and the null case never co-occur in one year — the
null case exists only in 1981/1982/1987, which are exactly the years with no `Draft` column
and therefore no `'National'` value. Reload-key uniqueness must nevertheless be **asserted
at import time**, not assumed.

`GRID_DRAFT_TYPES`' two `National` spellings are now explained: both are live values.

### 30.2 G3 = **CLOSED**

| Measure | Value |
|---|---:|
| picks | 6810 |
| `signing` present | 995 |
| `signing_kind` present | 995 |
| `signing` without `signing_kind` | **0** |
| `signing_kind` without `signing` | **0** |
| head-rule matches | **995** |
| head-rule mismatches | **0** |
| distinct `signing` values | 165 |
| `signing_detail` present | 593 |

**Frozen rule:** `signing_kind = btrim(regexp_replace(signing_raw, '\s*\(.*$', ''))`,
applied only where `signing_raw` is present; **absence stays NULL**. The derived head set is
exactly the 18-value `GRID_SIGNING_KINDS`. Stage A's 995 rows and the database's 995 rows
agree exactly, and no player identity or name participates in the rule.

`signing_detail` (593 rows) is the parenthetical remainder and is a separate derivation not
yet classified.

### 30.3 G4 = **PARTIAL — measurement done, policy open**

| Column | current PostgreSQL | accepted Stage A |
|---|---|---|
| `weight_kg` | **0 / 6,810 = 0.00%** | no source field |
| `competition` | **6,810 / 6,810 = 100.00%** — 2 values: `AFL` 6206, `VFL` 604 | no source field |
| `grade` | 6,093 / 6,810 = 89.47% — D 1911, C+ 1286, C 1169, B 868, A 389, B+ 361, A+ 109 | `parity_only.grade`, 6,093 / 6,810, **same 7-value vocabulary** |

`weight_kg` is **empty in the current database as well as absent from Stage A** — there is
no loss to accept, and no evidence it was ever populated.

`competition` is the material finding: it is **fully populated today and has no Stage A
source at all**. It must not be silently reproduced from legacy data. Whether it is
deterministically derivable from tracked reference facts is the open question (§32.C).

`grade` reproduces the legacy vocabulary exactly — which is **not** a reason to promote a
`parity-only` field to canonical import semantics. It stays **D** pending an explicit policy
decision informed by consumer inspection.

### 30.4 G5 = **OPEN / HALT ON THE CURRENT LEDGER DESIGN**

| Measure | Value |
|---|---:|
| `explicit_decisions_total` | 6 |
| `linked_explicit_total` | 5 |
| **`linked_with_stable_afltables_identity`** | **2** |
| **`linked_without_stable_afltables_identity`** | **3** |
| `confirmed_unlinked_total` | 1 |
| `natural_key_complete` | 6 |
| `natural_key_incomplete` | **0** |
| `target_row_has_person` | 6 |

The approved gate was **5 / 5 / 0**. Actual is **5 / 2 / 3**.

**§16's ledger design is therefore invalidated as written.** `player_identity` cannot be
hard-coded to `{ source: "afltables", external_id: <profile path> }`, because three of the
five linked decisions name a canonical player that holds no
`afltables_profile_url` external identity.

The **target-side** natural key is unaffected and fully intact: all 6 decisions have a
complete `(player_url, draft_year, draft_kind)` and a resolvable person. **Only the
player-side identity is unsolved.**

Binding while G5 is open: **do not export the ledger; do not weaken explicit-decision
preservation; do not fall back to player names; do not use `players.id` as durable identity;
do not replay historical automatic mappings.**

### 30.5 G6 = **OPEN / HALT — the assumed derivation is REJECTED**

| Measure | Value |
|---|---:|
| persons | 5057 |
| `source_null_or_blank` | 0 |
| `normaliser_returned_null` | 0 |
| matches | 4926 |
| **mismatches** | **131** |
| `mismatch_explained_by_nbsp` | **0** |

Canonical function confirmed present: `public.afldb_normalise_name(input text)`.

`name_key = afldb_normalise_name(display_name_raw)` is false for **131 of 5,057** persons,
and NBSP folding explains **none** of them. §20's candidate derivation is **rejected**. The
SQL normaliser must not be encoded as the B2 `name_key` rule, and the unexplained legacy
values must not be copied.

### 30.6 G7 = **OPEN** (unchanged; §28.1 stands)

The prior-behaviour supplement confirms the offline reading: **`Brisbane` resolves to
`club_id IS NULL` in the current database** — `import_draft.py`'s best-effort alias lookup
never had an entry for it either. That behaviour is **not** inherited on its own authority.

G7 stays OPEN: the transaction-season / club-identity semantics must be resolved before any
`club_id` derivation is frozen.

---

## 31. Column-derivation register — after B2-1 measurement

| Column | Class | State | Blocked on |
|---|---|---|---|
| `display_name_raw` | **A — frozen** | one distinct raw spelling per person, all 5,057 (§28.5) | — |
| `draft_type` | **A — frozen** | verbatim `event_type_raw`; **absence → `'National Draft'`** (§30.1) | — |
| `draft_kind` | **B — frozen vocabulary, file not yet written** | tracked 11-entry mapping incl. the absence case; fail-closed on an unknown value; **not injective** — reload-key uniqueness must be asserted, not assumed | B2-2 (not started) |
| `signing_kind` | **A — frozen** | `btrim(regexp_replace(signing_raw, '\s*\(.*$', ''))`; NULL where absent (§30.2) | — |
| `dg_person_id` | A — rule identified, **not implemented** | `index + 1` over `persons.jsonl`, already `player_url`-sorted; per-load rank, never identity; deferred unique constraint still required | — |
| `source_record_id` | A — candidate proven unique | `(source_url, row_index)`, unique over all 6,810; legacy SQLite rowids remain forbidden | encoding approval |
| `signing_detail` | **unclassified** | 593 rows; the parenthetical remainder of `signing_raw` | derivation not yet stated |
| `name_key` | **E — HALT** | `afldb_normalise_name(display_name_raw)` **rejected**: 131 / 5,057 mismatches, 0 NBSP-explained | **G6** |
| `club_id` | **E — HALT** | 18/19 slugs map exactly (6,388 rows, 93.80%); `brisbane` (422) spans a merger; three further labels era-ambiguous; DB currently stores NULL for Brisbane | **G7** |
| `competition` | **OPEN** | 100% populated in PostgreSQL (AFL 6206 / VFL 604), **no Stage A source** | **G4.C** |
| `weight_kg` | **C — provisionally** | 0 / 6,810 in PostgreSQL *and* no Stage A source: nothing is lost | confirm no consumer requires it |
| `grade` | **D — default** | reproducible from `parity_only.grade` (same 7 values), but promotion of a `parity-only` field needs explicit approval | policy + consumer evidence |

**§17 amendment.** "No schema change and no migration are required" stays **INFERRED** and
is now *less* supported than at plan time: G5 proves the explicit-decision ledger cannot be
represented as designed, and until its replacement is proven the representation requirement
is unmet.

---

## 32. B2-1 FOLLOW-UP — approved scope (evidence only)

Four bounded investigations, **no importer implementation**:

**A. G5** — find a stable, reproducible, **non-surrogate** identity for each of the five
explicit `linked` decision targets. AFL Tables is not assumed to be the only permissible
source. If even one target has no stable reproducible natural identity → **HALT**. The
ledger may need `player_identity = { source: <stable source key>, external_id: <stable
external id> }` instead of a hard-coded `afltables`, but that change is **not approved**
until all five are proven representable.

**B. G6** — derive `name_key` exactly, from a deterministic algorithm over accepted Stage A
data. The legacy SQLite value is not authority. Candidates must be compared against all
5,057 stored values with **aggregate counts only**. 5,057 / 0 → G6 CLOSED; anything else →
G6 stays OPEN and HALTs. `name_key` never becomes part of player identity.

**C. G4 `competition`** — establish whether `AFL` / `VFL` is a total deterministic function
of `draft_year` or another tracked reference attribute (`data/reference/seasons.json`,
competition/season metadata, the reference loader). Report first/last `draft_year` per
value and whether any year carries both. Tracked derivation → A or B; legacy-only → stays
**D / OPEN**. Also report which supported application / search / Grid Solver paths actually
consume `weight_kg`, `competition` and `grade` — **report consumers only, modify nothing**.

**D. G7** — determine the required *semantic* of `draft_picks.club_id` from its supported
consumers, schema comments and tests, then test whether a deterministic
`effective_season = f(draft_year, event_type_raw)` can be **proven** from tracked sources
across every event type. Timing must not be inferred from historical outcomes alone.
Candidate designs to weigh (none pre-selected): keep `club_name_raw` / `club_slug` as the
authoritative source fact; populate `club_id` only where the tracked mapping is unambiguous;
leave modernised/ambiguous labels NULL; or introduce a tracked explicit mapping keyed by
source club slug plus transaction semantics. Report the **smallest defensible** design.

---

## 33. B2-1 FOLLOW-UP — offline findings (2026-08-26)

All of §33 was established **offline** from tracked reference data, the accepted Stage A
snapshot and `src/` inspection. No database was contacted. §34 is the prepared follow-up
runner; the DB items it confirms are marked *pending*.

### 33.1 G4 `competition` — **CLOSED offline, class B**

`data/reference/seasons.json` carries a tracked `league_eras` block:

```json
"league_eras": [
  { "league": "VFL", "first_season": 1897, "last_season": 1989 },
  { "league": "AFL", "first_season": 1990, "last_season": null }
]
```

Cumulative Stage A rows by `draft_year`: **1981 24 · 1982 24 · 1986 71 · 1987 65 · 1988 182
· 1989 238 → cumulative through 1989 = 604**. Remaining 6,810 − 604 = **6,206**.

Those are **exactly** the measured PostgreSQL values (`VFL = 604`, `AFL = 6206`).

**Rule:** `competition = league_era(draft_year)` from `data/reference/seasons.json` — a
**total, exact, tracked-reference derivation**, class **B**, covering 6,810 / 6,810 rows
with no ambiguity. It is *not* recreated from legacy PostgreSQL data; the reference file is
the authority and the stored column merely agrees with it.

**And it settles a semantic question G7 needs.** The boundary lands on `draft_year`, not on
a destination season: had the model used `draft_year + 1`, the 1989 draft would be AFL and
`VFL` would be 366, not 604. **The existing model anchors `competition` on the transaction's
own year.** DraftGuru's club label, by contrast, observably follows the *destination*
(Brisbane appears in 1986, Sydney in 1981). The two fields anchor on different things — that
clash is the substance of G7, not an incidental detail.

### 33.2 G4 `weight_kg` / `grade` — consumer inspection

| Column | Consumers in `src/` |
|---|---|
| `draft_picks.weight_kg` | `src/db/queries/draft.ts:178` (player draft-history render) and the admin data editor (`src/db/queries/data-edits.ts:70`, `src/lib/edit/spec.ts:160,173`). **0 / 6,810 populated**, so it renders nothing today. Note `players.weight_kg` is a *different* column and *is* used by search (`src/search/query-builder-spec.ts:76` binds `p.weight_kg`) — the draft column is not. |
| `draft_picks.competition` | **none** — no `src/` path selects it. The `competition` hits in `src/db/queries/awards.ts` and `search.ts` are `awards.competition`, a different table. |
| `draft_picks.grade` | **none** — no `src/` path selects it. |

So `weight_kg` is **class C**: absent from Stage A, empty in PostgreSQL, nothing lost.
`competition` and `grade` have **zero application consumers**, which materially lowers the
stakes of both decisions — but `competition` now has an exact tracked derivation anyway, so
there is no reason to drop it.

`grade` stays **D** by default. It remains a `parity-only` field, and reproducing the legacy
values is not a reason to promote it; with no consumer, promoting it buys nothing.

### 33.3 G6 `name_key` — the mechanism is identified (pending DB confirmation)

Measured offline over the accepted Stage A persons frame (all 5,057 display names, which all
contain U+00A0 as their separator):

| Class | Persons |
|---|---:|
| display name contains a hyphen `-` | **55** |
| display name contains an ASCII apostrophe `'` | **72** |
| display name contains a non-ASCII letter (excluding NBSP) | **4** |
| **total, and the three classes are disjoint** | **131** |

**131 is exactly the measured mismatch count**, and those three classes are precisely the
inputs `afldb_normalise_name` rewrites: it unaccents, deletes apostrophes, and turns hyphens
into spaces. Every other name is untouched by it, which is why the other 4,926 agree.

**Hypothesis:** `name_key` applies **no unaccenting and no punctuation handling** — it is
lowercase plus whitespace folding only. The follow-up runner tests five candidates against
all 5,057 stored values and cross-tabulates the baseline mismatches against those three
classes, so the mechanism is *confirmed* rather than curve-fitted.

A rejected alternative, measured and discarded: deriving `name_key` from the `player_url`
slug gives **157** disagreements, not 131, and the slug retains apostrophes and
percent-encoding (`alex van%20wyk`, `ciar%C3%A1n byrne`). It is not the rule.

`name_key` remains a search/index key and **never** becomes part of player identity.

### 33.4 G5 — a reframing that changes what the 2 / 5 result means

`import_fitzroy_core.py` resolves player identity **through** the AFL Tables profile-URL
path: *"Player identity is the AFL Tables profile URL … registered in external_identities
under (source `afltables`, match_method `afltables_profile_url`)"*, and it is the **only**
writer of player identity on the rebuild path. In the **rebuilt** database a player
therefore exists *because* it has that identity.

`afldb_dev` is not that database — it is the **legacy-built** one, populated by
`import_legacy_afl.py`, where AFL Tables identities were registered only for the subset a
later pass touched. The Stage B1 reconciliation already saw this shape from the other side:
**66 of 99 linked persons in the sample had no AFL Tables identity in `afldb_dev`** (§3.9,
category `absent`), recorded then as "new information".

So `linked_with_stable_afltables_identity = 2 / 5` may be a property of **this database's
registration coverage**, not of the identity model. That does not dismiss the HALT — it
changes what evidence resolves it. The follow-up runner therefore measures the **population
base rate** alongside the five targets, plus every external identity those five hold from
any source, and whether they played senior football (a player with senior games is in
fitzRoy and would be minted with an identity by the rebuild).

*(For completeness: the known `external_identities` depopulation incident, AFLDB-ISSUE-092,
is confined to `afldb_test` — now preserved as `afldb_test_pre_rebuild_20260825` — and is
**not** an explanation for what `afldb_dev` shows.)*

**G5 remains OPEN / HALT.** No ledger is exported, and the `player_identity` shape is not
changed, until all five linked decisions are proven representable.

### 33.5 G7 — the required semantic, from the consumers

`draft_picks.club_id` has exactly two supported consumer shapes, and they disagree about
grain:

| Consumer | Grain | Consequence |
|---|---|---|
| `src/db/queries/grid-solver.ts:851` (`drafted_by_club`) and `:874` (`drafted_by_club_never_played`) | **organization** — `dp.club_id IN (SELECT id FROM clubs WHERE organization_id = $1)` | an era choice *within* one organization is **invisible**; one that *crosses* organizations changes answers |
| `src/db/queries/draft.ts:90` (filter `c.slug = $1`), `:119,127,176,181` (render `c.name` / `c.slug`) | **identity** | the era choice is user-visible on `/draft/[year]` and on the player page |

Migration 017 fixes the lineage: **South Melbourne→Sydney, Footscray→Western Bulldogs and
North Melbourne→Kangaroos→North Melbourne each share ONE organization**, while *"Fitzroy,
Brisbane Bears and University stay SEPARATE organizations. Fitzroy and the Bears combined
into Brisbane Lions in 1997, but a merger is not a rename."*

**This collapses G7 to a single hard case.**

- `western-bulldogs` (113 rows ≤1995), `north-melbourne` (93 rows 1998–2006) and `sydney`
  (2 rows in 1981) are **organizationally equivalent** under either era treatment. The Grid
  Solver is unaffected; only the rendered/filterable identity label differs, and DraftGuru's
  own assertion is the modern label. Low stakes, and decidable without new evidence.
- **`brisbane` (422 rows) crosses an organization boundary.** Brisbane Bears and Brisbane
  Lions are different organizations, so choosing wrong silently attributes Bears draftees to
  the Lions or vice versa **in Grid Solver answers**. It is the one genuinely undecidable
  case, and the `draft_year + 1` hypothesis is not approved as its resolver.

**Smallest defensible design (proposed, NOT self-approved):**

1. `club_name_raw` and `club_slug` are retained verbatim as the authoritative DraftGuru
   source facts, exactly as `draft.ts` already falls back to `clubNameRaw`.
2. `club_id` is populated **only** where the tracked mapping is unambiguous: exact
   `club_slug` → `clubs.slug` equality, **18 of 19 slugs, 6,388 / 6,810 rows (93.80%)**,
   under a tracked reference mapping (class **B**), fail-closed on any unknown slug.
3. `brisbane` (422 rows) resolves to `club_id NULL` — which is **exactly what the current
   database already stores**, so this is a no-change outcome, not a regression, and it
   preserves the merger boundary rather than guessing across it.
4. No era rewriting of the three rename/relocation labels, because they are organizationally
   equivalent and DraftGuru's modern label is what the source asserts. This is recorded as a
   **stated accepted consequence**: `/draft/1990` filtered by `footscray` will not return
   those rows; filtering by `western-bulldogs` will.
5. If Brisbane must be resolved later, it needs a **tracked explicit mapping keyed by source
   club slug plus transaction semantics** — never an inferred season offset.

This needs **your approval**; it is not adopted here. It is the smallest option that keeps
every source fact, adds no unproven rule, and changes no current stored value.

**A deterministic `effective_season = f(draft_year, event_type_raw)` is NOT proven and is
not proposed.** No tracked source in the repository states when each event type takes
effect; `Mid-Season` (280 rows) demonstrably takes effect in the same season while the
off-season events do not; and §33.1 shows the existing model anchors on `draft_year`
itself. Timing must not be inferred from historical outcomes alone, so this stays unproven.

---

## 34. The B2-1 follow-up runner

**File created: `tools/rebuild/draftguru/b2_evidence_followup.py`.** Separate from
`b2_evidence.py` because it queries different tables for different questions; §30's results
stand and are not re-measured. Identical safety envelope (`.env` parsed not sourced, DSN
never printed, `/afldb_dev` guard, pre-rebuild database refused, `default_transaction_read_only=on`,
`REPEATABLE READ` read-only, in-session verification, SELECT only, explicit `ROLLBACK`, safe
close). Aggregate counts and tracked vocabulary only — **no names, no surrogate ids**.

| Section | Measures |
|---|---|
| **FU-A / G5** | the five linked targets: stable-AFL-Tables count, any-AFL-Tables-row-but-not-stable, any-external-identity, none-at-all, and whether they played senior football; every `external_identities` row they hold by `(source, match_method, status)`; the **population base rate** over `players`; and the whole `external_identities` population by `(source, match_method, status)` |
| **FU-B / G6** | five `name_key` candidates against all 5,057 (`afldb_normalise_name` baseline; lower+NBSP-fold+trim; +whitespace-run collapse; lower+trim only; lower+unaccent without punctuation handling) — matches / mismatches / nulls each — plus the baseline-mismatch cross-tab against hyphen / apostrophe / non-ASCII, and an explicit HALT line if nothing reproduces all 5,057 |
| **FU-C / G4** | `competition` by value with first/last `draft_year`, and the count of draft years carrying more than one value — confirming the §33.1 offline derivation |
| **FU-D / G7** | `club_name_raw` → resolved `clubs.slug` → `club_organizations.slug`, with counts and year span, so the organization-grain argument in §33.5 is evidenced rather than asserted |

---

## 35. APPROVED DECISIONS (user, 2026-08-26) — G4, G6, G7 CLOSED

The follow-up evidence was accepted and the following are now **frozen**.

### 35.1 G4 = **CLOSED**

**`competition` — class B.** Canonical derivation `competition = league_era(draft_year)`
from tracked `data/reference/seasons.json`. Measured: VFL 1981–1989 = **604**, AFL
1990–2025 = **6,206**, draft years carrying more than one competition = **0**. Reproduces all
6,810 current rows exactly. **The tracked reference is the authority; legacy PostgreSQL is
corroboration only.**

**`weight_kg` — unavailable / NULL.** No Stage A source, 0/6,810 currently populated; there
is no material rebuild data to preserve. Revisit only if later source evidence appears.

**`grade` — NOT promoted.** `parity_only.grade` covers 6,093/6,810 and reproduces the legacy
vocabulary exactly, but no supported `src/` path consumes `draft_picks.grade`. It is
**left unpopulated / NULL** by the canonical importer. Reproducibility is not a justification
for promoting a `parity-only` field; only an explicit consumer requirement would be.

### 35.2 G6 = **CLOSED by explicit B2 rule** (not by discovery)

The DB run returned **C1 = C2 = C3 = 5,057 / 5,057**. Three candidates reproduce the stored
population, so **the evidence does not uniquely identify the historical implementation and no
such claim is made.**

**Frozen B2 canonical rule for `name_key`:**

1. replace NBSP (U+00A0) with an ordinary ASCII space;
2. collapse whitespace runs to a single ASCII space;
3. trim leading/trailing whitespace;
4. lowercase;
5. **preserve** apostrophes;
6. **preserve** hyphens;
7. **preserve** non-ASCII letters;
8. **do not** unaccent.

Equivalent orderings of the lowercase and whitespace steps are acceptable where semantically
identical. This corresponds to candidate **C2** and reproduces **5,057 matches / 0 mismatches
/ 0 null**.

It deliberately differs from `public.afldb_normalise_name()`, which produced **4,926 / 131**.
The 131 are exactly **55 hyphen + 72 apostrophe + 4 non-ASCII, 0 outside those classes** —
precisely the inputs that function rewrites.

**Why step 1 is mandatory even though C1/C2/C3 are indistinguishable against the stored
column.** The three candidates differ only in NBSP handling, so their agreeing at 5,057
means the *stored* `draft_persons.display_name_raw` carries ordinary ASCII spaces. The
**Stage A** input does not: all 5,057 `persons.jsonl` display names use U+00A0 as their
separator (measured offline). The B2 importer reads Stage A, so the NBSP fold is required for
the rule to reproduce the population from the accepted source — it is not redundant.

**`name_key` is a search/index key only and MUST NOT participate in player identity.**

**Status wording, binding:** G6 is closed on an *explicit deterministic canonicalisation that
exactly reproduces the accepted population*. It is **not** claimed to be uniquely proven as
the historical implementation.

### 35.3 G7 = **CLOSED** — smallest fail-closed design APPROVED

Canonical source facts retained verbatim: **`club_name_raw`, `club_slug`, `club_href_raw`**.

`draft_picks.club_id` is populated **only** by exact tracked `club_slug` → `clubs.slug`
equality — **18 of 19 source slugs, 6,388 / 6,810 rows = 93.80%**. Explicitly forbidden:
historical era rewriting; the `draft_year + 1` inference; `import_draft.py`'s alias
heuristics; crossing an organization merger boundary.

**`club_slug = 'brisbane'` → `club_id = NULL`** (422 rows, 1986–2025). It spans Brisbane
Bears and Brisbane Lions, separate AFLDB organizations joined by **merger, not rename**. This
is **intentional fail-closed behaviour, not missing implementation**, and it matches what the
current database already stores. It stands until a future tracked rule or source can
distinguish the organization safely.

The three modernised rename/relocation labels — `western-bulldogs`, `north-melbourne`,
`sydney` — keep exact source-slug mapping to the corresponding **current** AFLDB identity and
are **not** era-rewritten.

**Accepted consequence, recorded explicitly:** identity-grain historical draft filtering may
not reproduce an old historical club label for those renamed organizations (e.g. `/draft/1990`
filtered by `footscray` will not return those rows; `western-bulldogs` will), while
organization-grain Grid Solver semantics stay within the same organization and are unchanged.
That consequence is preferable to inventing untracked transaction-effective season semantics.

**No schema change is implied by this decision.**

---

## 36. Status after the approved decisions

| Gap | Status |
|---|---|
| G1 | OPEN — Stage B3 only (NOT APPROVED) |
| **G2** | **CLOSED** |
| **G3** | **CLOSED** |
| **G4** | **CLOSED** |
| **G5** | **OPEN — SOLE B2-1 HALT** |
| **G6** | **CLOSED** (by explicit B2 rule; §35.2) |
| **G7** | **CLOSED** (§35.3) |

**"No schema change and no migration are required" remains INFERRED** until G5's
representation question is settled (§17 amendment stands).

No importer exists. No reference JSON has been written. No ledger has been exported. No
`src/` file, migration or PostgreSQL write has occurred. No network request has been made.
B2-2, B2-3 and Stage B3 have not begun.

**Stage B3 remains NOT APPROVED / NOT STARTED.**

---

## 37. G5 investigation — clean-rebuild representability (offline, 2026-08-26)

### 37.1 The rebuild's player-existence rule — decisive, and it reframes G5 again

`tools/migration/import_fitzroy_core.py` builds `players` **only** from fitzRoy
`player_stats` rows — one row per player per match — and every such row must carry both an ID
and a profile URL or the import **fails closed**:

```python
afl_id   = clean(row["ID"])
url_path = normalise_profile_url(row["url"])
if afl_id is None or url_path is None:
    raise PlayerIdentityError(... "player row has no stable ID/profile URL — "
                                  "identity cannot be registered deterministically")
```
(`import_fitzroy_core.py:711-716`; it is the **only** writer of player identity on the
rebuild path.)

Two consequences follow, and together they decide G5:

1. **On a clean rebuild a player exists if and only if they played at least one senior
   game.**
2. **Every player that exists necessarily holds an `afltables_profile_url` identity.** There
   is no such thing, in the rebuilt model, as a player with senior games and no AFL Tables
   identity.

So a linked explicit decision whose target **played** is representable by §16's original
design with no change at all — its current absence in `afldb_dev` is a **legacy registration
gap**, not a model gap. A linked decision whose target **never played** is a different and
much larger problem: that player would not be created by the rebuild at all, so the ledger
could not link to it — it would have to **seed** it.

**The whole of G5 therefore reduces to one measurement: do all five linked targets have
senior games?** That is what the runner in §38 answers first.

### 37.2 Schema representability, if a fallback ever were needed

Established by inspection; recorded so the option is understood, **not** because it is
adopted.

| Requirement | Finding |
|---|---|
| Is `draftguru` a tracked source able to own external identities? | **Yes, already.** `data/reference/sources.json` registers `key: "draftguru"`, loaded by `load_reference_data.py` and upserted by key so `sources.id` is stable across reloads. No schema or migration change would be needed for that alone. |
| Can `(draftguru, player_url)` be a unique identity? | **Yes.** `external_identities` has `UNIQUE (source_id, external_id)` (migration 002:189), `player_id` is nullable and `status` is NOT NULL — the same shape §14 already proposed for DraftGuru rows. |
| What would seeding a player require? | `players` NOT NULL columns are `display_name`, `sort_name`, `search_name`, `slug` (migration 002:113-150). All four are **display attributes derivable from Stage A `display_name_raw`**, not identity. `slug` carries only a non-unique index (`ix_players_slug`, 002:160), so a seeded slug cannot collide structurally. |
| Precedent for creating a player from a draft row? | `createPlayerInTransaction` (`src/db/queries/players.ts:350-412`) already does exactly this for admins, writing the player, zero `player_career_stats`, and a `resolved` `draft_picks` row. It registers **no external identity**, which is why such players are invisible to any identity-keyed rebuild. |

**The circularity question, answered honestly.** If the ledger's natural key is the DraftGuru
`player_url` *and* the target identity is also `draftguru:player_url`, the decision asserts
nothing about *which pre-existing* player is meant — it is self-referential. That is harmless
**only** when the ledger is itself the creator of that player, in which case it reads: *"a
canonical player exists for this draft person, seeded from this decision, identified by
`draftguru:player_url`."* Deterministic on a clean rebuild, and it uses no name, no legacy
numeric id, no SQLite rowid and no automatic mapping.

**But its safety gate is not proven.** Seeding is only safe when the same human does not also
exist as a fitzRoy-created player — otherwise the rebuild mints a duplicate person. The
natural gate ("the person never played") is a **DraftGuru-reported** fact, and §13/§15 permit
`reported_games` for backlog triage only, **never** as identity evidence. Using it as the
seeding gate would sit uncomfortably close to that line. A bridge-based gate is stronger but
Stage B1 covers only 120 of 5,057 persons.

**Therefore: the fallback is representable but NOT approved, and it is not needed at all if
§37.1's measurement returns 5 / 5 played.** That outcome is strictly preferable — it closes
G5 with the *original* ledger design, no fallback, no seeding, no schema change.

### 37.3 What the runner measures

`tools/rebuild/draftguru/b2_g5_evidence.py` (new, narrowly scoped to G5).

- **G5-A joint cross-tab** over all six explicit decisions, reduced to booleans and grouped
  with counts: stable AFL Tables identity (A) · senior games (B) · `players.legacy_player_id
  IS NOT NULL`, i.e. *not* admin-created (a clean proxy, emitting no value) · canonical
  `player_url` present on the decision's pick (C) · Stage B1 bridge agreement (F/G, from the
  accepted 120-person oracle passed in from the local file). D and E are covered by the gates
  below. The joint form is what makes five decisions interpretable without naming anyone.
- **Clean-rebuild verdict**, printed explicitly: if every linked target played, it states that
  §16 stands unchanged and no fallback is required; otherwise it **HALTs** and says the ledger
  would have to seed a player.
- **G5-C gates:** one `player_url` claimed by multiple canonical players (**unsafe**);
  one player claimed by multiple `player_url`s (*not* automatically unsafe — needs a stated
  deterministic representation if seen); linked / confirmed-unlinked decisions with no
  `player_url` (**unsafe** — would need a surrogate); existing `external_identities` rows
  under source `draftguru` and whether any already sits on these URLs (**collision check for a
  hypothetical fallback**). A Stage B1 bridge that **contradicts** an explicit decision is
  surfaced as its own HALT — explicit human authority wins, but never silently.
- **Population context:** total players, stable-identity rate, senior-games rate, and
  `played_but_unregistered` — the exact size of the `afldb_dev` legacy registration gap, a
  category a clean rebuild cannot have by construction.

Egress: aggregate counts and booleans only. **No names, no `players.id` / `draft_picks.id` /
`draft_persons.id` / `auth_users.id`, and no `player_url` or AFL Tables path is printed.**

---

## 38. G5 MEASURED RESULT (user-run, 2026-08-26)

**Command:** `cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/b2_g5_evidence.py`

**Safety verified in-session:** `db=afldb_dev  user=afldb_owner  txn_ro=on  default_ro=on
isolation=repeatable read` — **`ROLLBACK completed — nothing was written.`**

### 38.1 The five linked decisions, jointly

| # | stable AFL Tables identity | senior games | from legacy import | Stage B1 evidence | clean-rebuild fate |
|---:|---|---|---|---|---|
| **2** | true | true | true | — | created by `import_fitzroy_core.py`, identity already registered |
| **1** | false | true | true | bridge present, target holds no registered identity | created by `import_fitzroy_core.py`, **identity minted by the rebuild** — a legacy registration gap that closes itself |
| **2** | false | **false** | **false (admin-created)** | B1 observed **no bridge** | **NOT created by `import_fitzroy_core.py` at all** |

All 5 carry a canonical DraftGuru `player_url`. **Stage B1 contradictions = 0.**

**3 / 5 are guaranteed representable through the clean fitzRoy/AFL Tables player path.**

**2 / 5 are zero-senior-game, admin-created canonical players.** They are **not** a
registration gap — `import_fitzroy_core.py` will never create them, because it builds
`players` only from fitzRoy `player_stats` rows. Preserving those two human decisions across
a clean rebuild genuinely requires a **player-seeding design**. This wording is binding: do
not describe the remaining problem as an AFL Tables registration gap.

### 38.2 Collision / equivalence gates — all clean

| Gate | Value |
|---|---:|
| `url_claimed_by_multiple_players` | **0** |
| `player_claimed_by_multiple_urls` | **0** |
| `linked_without_player_url` | **0** |
| `unlinked_without_player_url` | **0** |
| `existing_draftguru_identity_rows` | **0** |
| `draftguru_rows_already_on_these_urls` | **0** |
| Stage B1 bridge contradictions | **0** |

### 38.3 Population context

| Measure | Value |
|---|---:|
| `players_total` | 13,363 |
| `with_stable_afltables` | 12,472 |
| `with_senior_games` | 13,361 |
| `played_but_unregistered` | 889 |
| **`not_from_legacy_import`** | **2** |

`with_stable_afltables = 12,472` is exactly the release-gate population named in
AFLDB-ISSUE-092/090 — this database's AFL Tables registration is intact and the 889
played-but-unregistered players are the ordinary legacy gap the rebuild closes.

**`not_from_legacy_import = 2` across the entire table**, and those two are precisely the two
zero-game linked targets. The whole of the remaining G5 problem is therefore **exactly two
rows in `players`** — the only admin-created canonical players in the database.

### 38.4 G5 — how the question moved (superseded assumptions, recorded explicitly)

| Stage | Claim | Status |
|---|---|---|
| 1 | §16's design assumed **5 / 5** linked targets carry an AFL Tables identity | **SUPERSEDED** — never measured, only assumed |
| 2 | `afldb_dev` measured **2 / 5** stable AFL Tables identities | **SUPERSEDED as a conclusion** — true of this database, but not the rebuild's model |
| 3 | §37.1's rebuild rule proved **3 / 5** are fitzRoy-representable (2 already registered + 1 whose identity the rebuild mints) | **CURRENT** |
| 4 | Final unresolved scope: **exactly 2 zero-game, admin-created linked targets** | **CURRENT — the sole open G5 question** |

Also superseded: §33.4's framing that the 2/5 result was *wholly* a registration artefact. It
was **partly** so — that accounts for exactly one of the three — and the other two are a real
model gap.

---

## 39. Status

| Gap | Status |
|---|---|
| G1 | OPEN — Stage B3 only (NOT APPROVED) |
| **G2** | **CLOSED** |
| **G3** | **CLOSED** |
| **G4** | **CLOSED** |
| **G5** | **OPEN — SOLE HALT**, scoped to two zero-game admin-created linked targets |
| **G6** | **CLOSED** |
| **G7** | **CLOSED** |

**"No schema change and no migration are required" remains INFERRED.**

**Stage B3 remains NOT APPROVED / NOT STARTED.**

---

## 40. Zero-game player seeding — bounded investigation (offline, 2026-08-26)

Scope: **only** the two observed zero-game admin-created linked targets, and the smallest
general rule that preserves them safely. This is not a generic player-import design.

### 40.1 (B) Minimum deterministic fields for one canonical player

`players` NOT NULL columns (migration 002:113-150, plus 008/018 additions):
`display_name`, `sort_name`, `search_name`, `slug`, `dob_confidence` (default `'unknown'`),
`birth_year_confidence` (default `'unknown'`), `dob_disputed` (default `false`). Everything
else is nullable. `CHECK (dob IS NULL OR dob_confidence <> 'unknown')` (018:76-78) is
satisfied by a NULL `dob`. `legacy_player_id` is `UNIQUE` but nullable, and NULLs do not
collide.

**The rebuild already contains the exact recipe.** `import_fitzroy_core.py:935-952` inserts
`display_name, sort_name, search_name, slug, given_name, surname, debut_season, final_season`
with `search_name`/`slug` as empty strings, then immediately derives them **in SQL**:

```sql
UPDATE players
   SET search_name = afldb_normalise_name(display_name),
       slug        = regexp_replace(afldb_normalise_name(display_name), '\s+', '-', 'g')
```

with the stated reason *"derived in SQL so they can never drift from the normalisation the
search queries use."* `sort_name` is `f"{surname}, {given_name}"` or bare surname (`:917-918`).

| Field | Source class | Detail |
|---|---|---|
| `display_name` | **A** — accepted Stage A fact | `persons.jsonl.display_names_raw[0]` with NBSP→space. §28.5 proved every person carries exactly one distinct spelling, so there is no "which one" decision. **Payload, never identity.** |
| `search_name` | **B** | `afldb_normalise_name(display_name)`, in SQL, mirroring the rebuild exactly |
| `slug` | **B** | `regexp_replace(afldb_normalise_name(display_name), '\s+', '-', 'g')`, in SQL, mirroring the rebuild exactly |
| `sort_name` | **B, with a stated imprecision** | fitzRoy reads a dedicated `Surname` column; **DraftGuru has none**. A deterministic last-token split (as `import_legacy_afl.py:469-471` already does) is wrong for `Ah Chee`, `van Wyk`, `Ó hAilpín`. `sort_name` is ordering payload only, so the safer option is to set it to the display name itself. **This is a small open choice, flagged not buried.** |
| `given_name`, `surname` | **C** — deliberately NULL | both nullable; DraftGuru asserts neither |
| `dob`, `birth_year`, `height_cm`, `weight_kg`, `debut_season`, `final_season`, `notes` | **C** — deliberately NULL | the person never played; `players.height_cm` is a career attribute, not the draft-day `height_raw` |
| `dob_confidence`, `birth_year_confidence`, `dob_disputed` | **B** | schema defaults |

`player_career_stats`: `createPlayerInTransaction` seeds an all-zero row
(`src/db/queries/players.ts:368-382`). A seeded player should mirror that, so listing queries
that join it behave identically. `player_name_aliases`: `import_fitzroy_core.py:953-958`
writes a `source_string` alias per player; mirroring it is consistent but optional.

**Slug collisions** are not structurally prevented — `ix_players_slug` is a plain index
(002:160), not unique — but `import_fitzroy_core.py` derives slugs the same way with the same
exposure, so seeding introduces **no new class of problem**.

### 40.2 (C) The proposed identity model, assessed

> For an explicit human `linked` decision whose target is not created by the fitzRoy/AFL
> Tables rebuild: the ledger is keyed by canonical DraftGuru `player_url`; the human decision
> is authority that this DraftGuru person **is** a canonical AFLDB player; the rebuild creates
> one minimal player row from accepted Stage A display attributes and registers
> `(source = draftguru, external_id = player_url)` against it; the decision resolves the
> DraftGuru person to that player; a rerun resolves the same external identity and reuses the
> player.

| Property | Verdict |
|---|---|
| Deterministic | **Yes.** Every input is either the tracked ledger or accepted Stage A; every derivation is the rebuild's own SQL. |
| Non-circular | **Yes.** The authority is the human decision, which is external to both the DraftGuru person and the player. The shared URL is not a circularity: it is a *minting* statement, not a lookup that presupposes its own answer. |
| Idempotent | **Yes.** `external_identities UNIQUE (source_id, external_id)` makes the second run a lookup, not an insert. |
| Schema-compatible | **Yes, subject to §40.5.** `draftguru` is already a registered source in `data/reference/sources.json`, upserted by key so `sources.id` is stable; `external_identities.player_id` is nullable and `status`/`match_method` already carry the needed semantics; `draft_persons.link_status = 'resolved'` with a non-NULL `player_id` satisfies `draft_persons_link_ck`. |
| Collision-safe | **Yes at the observed scale** — all §38.2 gates are 0 — and structurally guarded by the unique constraint. See §40.3 for the one case that is *not* fully guarded. |
| Independent of legacy SQLite | **Yes.** No `connect_legacy`, no `AFLDB_LEGACY_SQLITE`. |
| Independent of numeric ids | **Yes.** No `players.id`, no `draft_picks.id`, no SQLite rowid. |
| Independent of names as identity | **Yes.** `display_name_raw` populates display columns only. The identity is the `player_url`. |

**Consistency with existing admin-created-player semantics.** `createPlayerInTransaction`
(`src/db/queries/players.ts:350-412`) already implements exactly this judgement: an admin
declares that a canonical player exists for a draft row carrying no match evidence, writes the
player, seeds zero career stats, and writes `link_status_value = 'resolved'`. The seeding
model changes **nothing** about that meaning. Its one difference is that it *registers an
external identity*, which the admin path does not — and that omission is precisely why those
two players are invisible to an identity-keyed rebuild today. The model therefore repairs a
known weakness rather than inventing a new semantic.

So the interpretation *"this DraftGuru person is a canonical AFLDB player"* is the correct
reading for the zero-game case, and it is the reading AFLDB's own admin flow already uses.

### 40.3 (D) Idempotence and collision gates

| # | Case | Rule | Guard strength |
|---|---|---|---|
| 1 | `player_url` already attached to another canonical player | `UNIQUE (source_id, external_id)` returns the existing row; if its `player_id` is not the one the ledger implies → **HALT** | **Structural** |
| 2 | Same decision replayed | identity lookup finds the player; no insert. `classify_decisions()` already collapses repeats and HALTs on contradiction | **Structural** |
| 3 | Several linked URLs targeting one player | Currently **0**. If it occurred, exactly one URL may mint; the others must resolve to the already-minted player, so the ledger must name which URL mints. Rule stated, not needed today | Rule (unexercised) |
| 4 | A later B3 bridge appears for a seeded player | §40.6 | Rule |
| 5 | **A later fitzRoy import discovers the same real player** | see below | **PARTIAL — stated limitation** |
| 6 | Explicit decision contradicts a B3 bridge | human authority wins, but the contradiction is written to `data_issues` and **HALTs**; never a silent override | Rule |

**Case #5 is the honest weak point and must not be glossed.** If a seeded zero-game draftee
later plays, fitzRoy creates a *separate* player keyed on the AFL Tables URL, and the database
then holds two canonical rows for one human.

- **With B3 evidence** the convergence rule is clean and fully deterministic: the DraftGuru
  phase runs after fitzRoy, so if an admissible bridge for that `player_url` resolves to an
  existing player, **the seed does not happen** — the decision links to that player instead.
  If the ledger names a `draftguru` target but a bridge resolves to a *different* player →
  **HALT**.
- **With B2 alone there is no such signal**, because no bridge evidence exists for persons
  outside B1's 120. B2 therefore **cannot detect case #5 automatically**.

What B2 *can* offer: the ledger is a tracked file of six reviewed records, and the seeded
player carries an `external_identities(draftguru, …)` row whose `match_method` names the
explicit decision — so a later duplicate is **findable and auditable**, not silent drift. That
is a mitigation, not a guarantee. **Recorded as an accepted, stated limitation of B2-only
operation, closed properly only by an approved Stage B3.**

### 40.4 (E) Ledger target representation

A **typed** target is now required, because the two populations genuinely differ:

```json
{ "target":   { "source_key": "draftguru", "player_url": "…", "draft_year": 2001, "draft_kind": "…" },
  "action":   "linked",
  "player_identity": { "source": "afltables",  "external_id": "players/B/Brad_Miller.html" },
  "previous_status": "…", "decided_at": "…", "note": "…" }
```

and for the two zero-game targets, `player_identity` becomes
`{ "source": "draftguru", "external_id": "<canonical player_url>" }`.

**`seed_player` is NOT needed as stored data.** The target's `source` key already carries the
declaration: an `afltables` target that fails to resolve is a **HALT** (the rebuild should have
created that player), while a `draftguru` target that fails to resolve is **by definition** the
seed instruction — that is the only thing such an entry can mean. Storing a separate boolean
would be redundant state that could contradict the source key. Prefer less ledger state.

`confirmed_unlinked` keeps `player_identity: null` and **creates no player**. Unchanged.

Expected ledger contents: **6 records — 3 `linked` with an `afltables` identity, 2 `linked`
with a `draftguru` identity, 1 `confirmed_unlinked` with none.**

### 40.5 (F) Schema implication — **conditionally none**

`players`, `sources`, `external_identities`, `draft_persons`, `draft_picks` and
`player_link_resolutions` all carry the required representation as they stand. **No missing
representation has been found.**

**But `NO SCHEMA CHANGE REQUIRED` is NOT yet stated**, because §40 question (A) is unmeasured:
if either target carries canonical state beyond the players row, the explicit decision and the
draft references, rebuilding them means reconstructing more than a shell, and that could
demand representation this design does not have. §41's runner answers it. Until then
"no schema change / no migration" stays **INFERRED**.

### 40.6 (G) Stage B3 interaction (rule only — B3 remains NOT APPROVED)

For a DraftGuru-seeded player that later receives an admissible AFL Tables bridge:

1. **No conflicting AFL Tables identity on that player** → the rebuild **may** attach the AFL
   Tables identity to the existing seeded player. The player is unchanged; it simply gains a
   second external identity. This is the intended convergence path.
2. **The bridge resolves to a different canonical player** → **HALT and audit**. Never merge,
   never re-point the decision.
3. **Automatic B3 evidence never overwrites the human decision.** Explicit authority stays
   strictly above bridge evidence, exactly as §13's hierarchy states; any contradiction is a
   `data_issues` row plus a HALT, not a silent correction.

---

## 41. The seed-scope runner

**File created: `tools/rebuild/draftguru/b2_g5_seed_scope.py`** (new, narrowly scoped).

It answers §40 question (A) and finalises (B):

- **Population guard.** Selects the two targets structurally as `players.legacy_player_id IS
  NULL` — §38.3 established that is exactly this set — and **refuses to run** unless the count
  is still 2, so it can never silently measure a different population.
- **(A) Canonical-state scope.** Discovers **every** foreign key referencing `players(id)` from
  the catalogue (nothing hard-coded, so a table added later cannot be missed) and counts each
  against the two targets. Prints the referencing tables with counts, summarises the zero
  tables by name, and explicitly declares **Outcome A** (minimal shell) or **Outcome B**
  (canonical state beyond the draft/decision footprint → **HALT**).
- **(B) Field requirements.** For every `players` column, reports its type, whether it is NOT
  NULL, and **how many of the two carry a non-NULL value** — never the value. A nullable column
  reading `0 / 2` needs no source and is deliberately absent (class C).

Egress: table names, column names and counts only. **No names, no values, no surrogate ids.**
Same mandatory safety envelope as every other Stage B2 runner.

---

## 42. SEED-SCOPE MEASURED RESULT (user-run, 2026-08-26)

**Command:** `cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/b2_g5_seed_scope.py`

**Safety verified in-session:** `db=afldb_dev  user=afldb_owner  txn_ro=on  default_ro=on
isolation=repeatable read` — **`ROLLBACK completed — nothing was written.`**

### 42.1 Target population

| Measure | Value |
|---|---:|
| admin-created players (`legacy_player_id IS NULL`) | **2** |
| `linked` decisions on those targets | 2 |
| `confirmed_unlinked` decisions on those targets | **0** |
| distinct DraftGuru `player_url` | 2 |
| distinct `draft_year` | **1** |

The one `confirmed_unlinked` decision therefore belongs to a *different*, legacy-imported
target and needs no player creation — confirming §40.4.

### 42.2 (A) Canonical-state scope — **Outcome A, with a correction**

Foreign-key references to the two targets exist in **four** tables only:

| Table | Rows |
|---|---:|
| `draft_persons` | 2 |
| `draft_picks` | 2 |
| `player_career_stats` | 2 |
| `player_link_resolutions` | 2 |

**All other 21 player-referencing supported tables hold zero rows for these targets.** There
is no match, honours, achievement, club-season, alias, relationship, external-identity or
birth-evidence graph to reconstruct.

**Correction, binding:** the targets must **not** be described as empty or minimal shells. The
`players` rows themselves carry populated optional metadata (§42.3), and that metadata — not
the FK graph — is what remains to be classified.

### 42.3 (B) `players` column population across the two targets

| Column | non-NULL | Column | non-NULL |
|---|---:|---|---:|
| `id` | 2/2 | `birth_year_confidence` | 2/2 |
| `legacy_player_id` | **0/2** | `height_cm` | 2/2 |
| `display_name` | 2/2 | `weight_kg` | **1/2** |
| `sort_name` | 2/2 | `debut_season` | **0/2** |
| `search_name` | 2/2 | `final_season` | **0/2** |
| `slug` | 2/2 | `notes` | 2/2 |
| `given_name` | 2/2 | `search_rank` | **0/2** |
| `surname` | 2/2 | `dob_evidence_id` | **0/2** |
| `dob` | 2/2 | `dob_disputed` | 2/2 |
| `dob_confidence` | 2/2 | | |
| `birth_year` | 2/2 | | |
| `birth_year_min` | **1/2** | `birth_year_max` | **1/2** |

`debut_season` / `final_season` / `search_rank` empty is consistent with zero senior games.
`dob_evidence_id` empty means the DOB carries **no evidence row** — it was entered directly.

### 42.4 G5 progression — the complete trail

| # | Claim | Status |
|---|---|---|
| 1 | §16 assumed **5 / 5** linked targets carry an AFL Tables identity | **SUPERSEDED** — assumed, never measured |
| 2 | `afldb_dev` measured **2 / 5** stable AFL Tables identities | **SUPERSEDED as a conclusion** — true of this database only |
| 3 | §33.4 framed the whole 2/5 result as a registration artefact | **SUPERSEDED** — that accounts for exactly **one** of the three |
| 4 | Clean-rebuild rule proves **3 / 5** fitzRoy-representable | **CURRENT** |
| 5 | Exactly **2** zero-game / admin-created targets require seeding | **CURRENT** |
| 6 | FK graph for those two is limited to draft / link tables plus a derived career row | **CURRENT** (§42.2) |
| 7 | §40's "minimal shell" reading | **SUPERSEDED** — the players rows carry populated optional metadata |
| 8 | Remaining question: provenance and preservation class of that metadata | **OPEN — the sole G5 question** |

---

## 43. Seed metadata — provenance investigation (offline, 2026-08-26)

### 43.1 (G5-G) `player_career_stats` — **class D, and the seed must NOT create it**

`rebuild_derived.py` `REBUILDS["player_career_stats"]` (`:243-297`) is
`TRUNCATE player_career_stats;` followed by `INSERT … SELECT … FROM (… FROM pg_ctx GROUP BY
player_id) g`, where `pg_ctx` derives from `player_match_stats`. **A player with zero match
rows produces no group and therefore no row.** The script's own docstring calls itself *"the
required follow-up to any data import."*

Consequences:

- the row those two players hold exists **only** because `createPlayerInTransaction` seeds an
  all-zero row for convenience (`src/db/queries/players.ts:368-382`);
- **the next `rebuild_derived.py` run deletes it.** It is transient, not authoritative;
- the canonical steady state for a zero-game player is therefore **no career-stats row**, and
  the application already has to tolerate that state today;
- **the seed must not create one** — it would write state the authoritative derived pass
  removes immediately, which is exactly the "two writers of one invariant" problem §12 rejects.

Classification: **D — derived, regenerated by the authoritative pass, safely omitted.**
Pending confirmation that neither row holds material non-zero state (§44); if either does,
something other than the admin seed wrote it and that is a **HALT**.

### 43.2 (G5-F) Provenance of the populated `players` metadata

Each candidate derivation below is the **exact rule from tracked code**, not an assumption
about what looks derivable. `createPlayerInTransaction` (`src/db/queries/players.ts:299-320`)
is the only writer that could have produced these rows.

| Field | Class | Basis |
|---|---|---|
| `display_name` | **A** | Stage A `display_names_raw[0]`, NBSP→space; one distinct spelling per person (§28.5) |
| `search_name` | **B** | `afldb_normalise_name(display_name)` — derived in SQL by the rebuild itself |
| `slug` | **B, with a flagged divergence** | the rebuild uses `regexp_replace(afldb_normalise_name(display_name), '\s+','-','g')` (`import_fitzroy_core.py:947-952`); the **admin** path uses `display_name.toLowerCase().replace(/[^a-z0-9]+/g,'-')` (`players.ts:313-316`). **These differ on apostrophes and accents.** A seed should use the rebuild rule for consistency with all 13,361 other players — but that may change the existing player-page URL. Measured in §44. |
| `given_name`, `surname` | **B if reproduced, else C** | `players.ts:302-310` fills them by naive last-token split when the admin supplies neither. If the stored values match that split they are derived (**B**); if not, the admin curated them and they are human-authored (**C**). Measured in §44. |
| `sort_name` | **B** | `surname, given_name` per `players.ts:312`; see §43.4 |
| `birth_year` | **B, given `dob`** | `players.ts:320` takes the first four characters of `dob` |
| **`dob`** | **C — must be persisted** | **Stage A has no date field of any kind.** `age_raw` (`'NNyr'`) gives age at the transaction, which yields a birth year only to ±1 and never a date. `dob_evidence_id` is **0/2**, so there is no `player_birth_evidence` row behind it either — the value was entered directly and has no tracked origin. **Materially consumed:** `src/search/query-builder-spec.ts:66,72` exposes `p.dob` as a display column *and* a date filter, and `src/lib/structured-data.ts:126` emits it as JSON-LD `birthDate`. |
| `dob_confidence`, `birth_year_confidence` | **D** | defaults; `dob_confidence` becomes `'sourced'` automatically whenever a `dob` is supplied (`players.ts:319`) |
| `birth_year_min`, `birth_year_max` (**1/2**) | **C** | not written by `createPlayerInTransaction` at all. The admin data editor exposes them (`src/lib/edit/spec.ts:80,103`), so the one populated pair came from a manual edit. No tracked source reproduces it. |
| `height_cm` (**2/2**) | **A or C — measured in §44** | Stage A carries `height_raw` for 6,324/6,810 rows. If the stored value equals the person's own Stage A draft-day height it is reproducible (**A**); otherwise it is human-authored (**C**). **Materially consumed** — `query-builder-spec.ts:66` lists `height_cm` as a display column. |
| `weight_kg` (**1/2**) | **C — must be persisted** | **Stage A has no weight field at all** (the 22-key row schema, §11). **Materially consumed** — `query-builder-spec.ts:76` binds `p.weight_kg` as a searchable integer. |
| `notes` (**2/2**) | **C — must be persisted** | free text authored by an admin; no tracked source. **Consumed** — `src/db/queries/players.ts:221` selects `p.notes` in the player detail query. |
| `dob_disputed` | **D** | `NOT NULL DEFAULT false`; "2/2 non-null" only reflects the default. Measured in §44 in case either is actually `true`. |
| `debut_season`, `final_season`, `search_rank`, `dob_evidence_id`, `legacy_player_id` | **D** | 0/2 — correct and expected for a zero-game, non-legacy player |

**The rule the plan must respect, stated plainly:** *"optional" is a schema property, not a
preservation policy.* `dob`, `weight_kg`, `notes` and the one `birth_year_min`/`max` pair are
supported canonical state, are user-visible or searchable, and **no tracked source can
regenerate them**. Dropping them because the columns are nullable would be silent data loss.

### 43.3 (G5-H) Smallest durable seed payload

Derived and default fields are **not** stored. Only human-authored, materially-consumed,
non-reproducible facts are:

```json
{ "target": { "source_key": "draftguru", "player_url": "…", "draft_year": 2001, "draft_kind": "…" },
  "action": "linked",
  "player_identity": { "source": "draftguru", "external_id": "<canonical player_url>" },
  "seed": {
    "display_name": "…",
    "dob": "YYYY-MM-DD",
    "height_cm": 000,
    "weight_kg": 000,
    "birth_year_min": 0000,
    "birth_year_max": 0000,
    "notes": "…"
  },
  "previous_status": "…", "decided_at": "…", "note": "…" }
```

**Deliberately NOT stored, because each is a deterministic function or a default:**
`search_name`, `slug`, `sort_name`, `given_name`, `surname` (if §44 confirms the split
reproduces them), `birth_year` (from `dob`), `dob_confidence`, `birth_year_confidence`,
`dob_disputed`, `debut_season`, `final_season`, `search_rank`, and **no `player_career_stats`
row at all** (§43.1). `height_cm` drops out of the payload too if §44 shows it equals the
Stage A value.

**`seed` is present only on `draftguru`-sourced targets.** As §40.4 established, no
`seed_player` boolean is needed: the target's `source` key already carries the declaration,
and adding a flag would be redundant state that could contradict it. The `confirmed_unlinked`
decision keeps `player_identity: null`, no `seed`, and creates no player — §42.1 confirmed it
belongs to a legacy-imported target anyway.

**The durable identity remains the DraftGuru `player_url`.** Nothing in `seed` is ever used
as identity, for matching, or for resolution — it is payload that populates display columns
after the player has already been minted by the URL.

### 43.4 `sort_name` — resolved

`sort_name` is NOT NULL, is ordering/display payload, and participates in no identity or
match path. DraftGuru supplies **no surname field**, and naive last-token splitting is wrong
for `Ah Chee`, `van Wyk` and `Ó hAilpín` — all of which occur in the Stage A population.

**Rule: `sort_name = display_name` for seeded players.** It is schema-compatible (plain
NOT NULL text), deterministic, needs no source DraftGuru does not have, and cannot affect
identity. `createPlayerInTransaction:312` already uses exactly this fallback when no surname
is available, so it is the existing behaviour, not a new one.

**Conditional exception:** if §44 shows the stored `sort_name` is *not* the tracked split's
output — i.e. an admin curated a surname ordering — then that curation is human-authored
canonical state and `sort_name` moves into the `seed` payload alongside `notes`. §44 measures
this rather than assuming it.

### 43.5 Future fitzRoy convergence — a real gap, not hand-waved

**The specific hazard:** a player seeded today has zero games; in a future season they play;
`import_fitzroy_core.py` then creates a player.

**What the importer actually checks** (`:904-906`, `:912-941`): it resolves existing players
**only** through `external_identities` where `source = afltables` and
`match_method = 'afltables_profile_url'`, keyed on the profile-URL path. It has **no knowledge
of any other source's identities**, and it runs **before** the DraftGuru phase.

**Therefore the duplicate is real and unavoidable under the current design.** fitzRoy would
mint a second canonical player before anything consults the existing
`external_identities(draftguru, player_url)` row. This is **not** covered by §40.3's ordering
argument, which only addresses the *first* rebuild.

**Smallest future-safe rule (a requirement, not an implementation):** the DraftGuru phase,
which already runs after fitzRoy and already holds both the ledger and the bridge evidence,
must **detect and fail closed** rather than silently proceeding. Concretely: before minting or
reusing a seeded player, it must check whether an admissible AFL Tables bridge for that
`player_url` now resolves to a *different* canonical player; if so it **HALTs** with a
`data_issues` row naming the convergence, and a human decides whether to retire the seed and
re-point the decision. Automatic evidence never merges the two on its own authority, and never
overrides the human decision.

**Two honest limitations, recorded rather than papered over:**

1. **That gate needs bridge evidence, which B2 alone does not have** for persons outside
   Stage B1's 120. Under B2-only operation the duplicate is *findable* — the seeded player
   carries an `external_identities(draftguru, …)` row whose `match_method` names the explicit
   decision — but not *automatically detectable*. **Full convergence safety requires an
   approved Stage B3.**
2. **Idempotence is therefore complete for the rebuild-as-specified but not across future
   source growth.** §40.2's "idempotent: yes" is scoped to re-running the rebuild over the same
   snapshots; it must not be read as a guarantee that a later fitzRoy season cannot introduce
   a duplicate.

**This is recorded as a known B2/B3 requirement.** It does not block the seeding design — the
same exposure exists today, silently, because the admin-created players carry no external
identity at all, so registering one is a strict improvement.

### 43.6 A decision that is yours, not mine

The `seed` payload would place an individual's **date of birth**, height, weight and admin
notes into `data/reference/draftguru-link-decisions.json` — a **git-tracked repository file**.
These two people are zero-game draftees who never played senior football, i.e. private
individuals rather than public figures. The values already exist in the database, but
committing them to version control is a materially different exposure (permanent history,
wider distribution).

Options, none adopted here: carry the full payload as designed; carry only the fields with a
proven consumer and drop `notes`; or keep the ledger identity-only and accept the loss of the
biographical fields with that loss stated explicitly. **This needs your decision before the
ledger is designed further** — it is a privacy/governance call, not a technical one.

---

## 44. The seed-payload provenance runner

**File created: `tools/rebuild/draftguru/b2_g5_seed_payload.py`** (new, narrowly scoped).
Same mandatory safety envelope; refuses unless exactly 2 admin-created players are present.

| Section | Measures |
|---|---|
| **G5-F derivations** | whether the stored `given_name` / `surname` reproduce the tracked `players.ts:302-310` split; whether `sort_name` is `surname, given_name` or the display name; whether `search_name` reproduces `afldb_normalise_name`; whether `slug` matches the **rebuild** rule or the **admin** rule (both counted separately); whether `birth_year` is the year of `dob`; whether `birth_year_min`/`max` equal `birth_year`; whether `dob_disputed` is actually true; whether any `dob_evidence_id` exists; `notes` reduced to a **length bucket**; and the `dob_confidence` / `birth_year_confidence` enum vocabulary |
| **height / weight provenance** | joins the accepted, immutable Stage A `rows.jsonl` `(player_url, height_cm)` pairs to the targets' own draft rows and reports whether `players.height_cm` equals the Stage A draft-day height and whether it equals `draft_picks.height_cm` — **agreement counts only, never a measurement** |
| **G5-G career stats** | whether either `player_career_stats` row holds material non-zero state or a career span, plus the targets' `player_match_stats` row count (expected 0), confirming `rebuild_derived.py` would drop the row |

Egress: booleans, counts and enum vocabulary only. **No names, no dates of birth, no heights,
no weights, no notes text, no surrogate ids.**

---

## 45. Status

| Gap | Status |
|---|---|
| G2 / G3 / G4 / G6 / G7 | **CLOSED** |
| **G5** | **OPEN — sole HALT.** Scope is now exactly the provenance of the two seed targets' player metadata (§43.2) plus the §43.6 governance decision |

**A schema/migration change is still NOT required on current evidence** — `players`,
`sources`, `external_identities`, `draft_persons`, `draft_picks` and the tracked ledger carry
every representation the design needs. **But `NO SCHEMA CHANGE REQUIRED` is deliberately NOT
yet stated**, because it depends on §44's confirmation that the human-authored fields are the
only unreproducible state and that no career-stats row holds material content.

**Newly recorded requirement:** future fitzRoy convergence safety (§43.5) — idempotence is
complete for the rebuild as specified, **not** across future source growth.

**Stage B3 remains NOT APPROVED / NOT STARTED.**

## 46. FINAL G5 MEASUREMENT (user-run, 2026-08-26)

**Command:** `cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/b2_g5_seed_payload.py`

**Safety verified in-session:** `db=afldb_dev  user=afldb_owner  txn_ro=on  default_ro=on
isolation=repeatable read` — **`ROLLBACK completed — nothing was written.`**

Population: the **2** admin-created / zero-game linked canonical players.

### 46.1 Reproducible fields — all confirmed

| Measure | Result |
|---|---|
| `given_name_reproduced` | **2 / 2** |
| `surname_reproduced` | **2 / 2** |
| `search_name_reproduced` | **2 / 2** |
| `slug_matches_rebuild_rule` | **2 / 2** |
| `slug_matches_admin_rule` | **2 / 2** |
| `birth_year_from_dob` | **2 / 2** |
| `sort_name_is_surname_given` | **2 / 2** |
| `sort_name_is_display_name` | **0 / 2** |

**§43.4's proposed `sort_name = display_name` is SUPERSEDED.** The tracked admin-creation
derivation (`src/db/queries/players.ts:302-312`) reproduces the stored `given_name`,
`surname` **and** `sort_name` exactly, so the seed uses that derivation.

**Scope limit, binding:** this is proven **only for the two currently approved seed targets**.
It is **not** a universal surname parser and must never be described as one — the naive
last-token split remains wrong for `Ah Chee`, `van Wyk` and `Ó hAilpín`. Any future seed
target must re-measure before relying on it.

Both slug rules agree for these two, so the divergence flagged in §43.2 is moot here: seeding
changes no player-page URL.

### 46.2 Manual / unreproducible metadata — confirmed

| Measure | Result |
|---|---|
| `dob` present | 2 / 2 |
| `dob_evidence_id` rows | **0 / 2** |
| `dob_confidence` | `sourced` / `sourced` |
| `birth_year_min` = `birth_year` | 1 / 2 |
| `birth_year_max` = `birth_year` | 1 / 2 |
| `notes` empty | 0 / 2 |
| `notes` short (1–120 chars) | 2 / 2 |
| `players.height_cm` present | 2 |
| Stage A height present for both | 2 |
| **`players.height_cm` == Stage A height** | **1 / 2** |
| `players.weight_kg` present | 1 |
| Stage A weight source | **0 — no such field** |

So **one height is reproducible from accepted Stage A and one is human-authored**, and
**weight is unreproducible**. `dob` carries `dob_confidence = 'sourced'` while having **no
evidence row at all** — the confidence value reflects `createPlayerInTransaction:319`'s
automatic default, not a tracked source.

### 46.3 `player_career_stats` — class D confirmed

| Measure | Result |
|---|---:|
| rows present | 2 |
| `rows_with_material_state` | **0** |
| `rows_with_career_span` | **0** |
| `player_match_stats_rows` | **0** |

Nothing material is held. The authoritative derived rebuild TRUNCATEs and regenerates the
table from `player_match_stats`, and a zero-game player produces no row. **The existing rows
are transient admin-seed artefacts, correctly removed by the derived rebuild. The seed must
not create one.**

---

## 47. GOVERNANCE DECISION — APPROVED (user, 2026-08-26)

**Private and manual canonical metadata for these two zero-game players is deliberately NOT
carried into the Git-tracked rebuild corpus.**

Explicitly **not** committed:

- `dob`
- `weight_kg`
- manually entered `birth_year_min` / `birth_year_max`
- admin `notes`
- the one manually entered (non-Stage-A) `height_cm`

These are internal, manually entered facts about people who **never played senior AFL
football**. Placing them in a durable, Git-tracked rebuild ledger would materially expand
their exposure — permanent version history and wider distribution — beyond the database they
currently sit in.

**Recorded loss, stated plainly:** after a clean rebuild those five values will be **absent**
for the two seeded players. `dob` is a search display column *and* a date filter
(`query-builder-spec.ts:66,72`) and JSON-LD `birthDate` (`structured-data.ts:126`);
`weight_kg` is a searchable integer (`:76`); `notes` is selected by the player detail query
(`players.ts:221`). Those fields will read empty for these two players. **This is a deliberate
governance decision, not an accidental data-loss defect.**

If AFLDB later needs such metadata preserved across rebuilds, that requires a **separate
private / non-Git persistence mechanism or an explicit governance decision**. **No such
mechanism is to be invented under ISSUE-093 B2.**

---

## 48. APPROVED SEED MODEL

### 48.1 Identity and authority

| | |
|---|---|
| **Stable identity** | `external_identities(source = draftguru, external_id = <canonical DraftGuru player_url>)` |
| **Authority to mint** | the explicit human `linked` decision in the tracked ledger |
| **Never identity** | `display_name`, `name_key`, `search_name`, `slug`, `sort_name`, or any other name-derived value |

### 48.2 Tracked ledger payload — identity/decision state only

**The ledger carries no copy of DraftGuru payload.** `display_name` is **not** duplicated into
it: Stage A is already the authoritative lookup source, keyed by the same `player_url`, and
the importer **fails closed** if the person is missing from the accepted snapshot.

```json
{ "target":   { "source_key": "draftguru", "player_url": "…", "draft_year": 0000, "draft_kind": "…" },
  "action":   "linked",
  "player_identity": { "source": "draftguru", "external_id": "<canonical player_url>" },
  "previous_status": "…", "decided_at": "…", "note": "…" }
```

No `seed` block. No `seed_player` boolean.

### 48.3 Derived player fields for a seeded player

| Field | Source |
|---|---|
| `display_name` | accepted Stage A person record, looked up by `player_url` (NBSP→space); **fail closed if absent** |
| `given_name`, `surname`, `sort_name` | the tracked admin-creation derivation (`players.ts:302-312`) — proven 2/2 for these targets only (§46.1) |
| `search_name` | `afldb_normalise_name(display_name)` |
| `slug` | the deterministic slug rule (both rules agree for these two) |
| `dob`, `weight_kg`, `birth_year_min`, `birth_year_max`, `notes`, manual `height_cm` | **NULL / absent** — §47 governance decision |
| `birth_year` | **NULL** — it is a function of `dob`, which is intentionally not carried |
| `dob_confidence`, `birth_year_confidence`, `dob_disputed` | schema defaults (`'unknown'`, `'unknown'`, `false`) |
| `debut_season`, `final_season`, `search_rank`, `dob_evidence_id`, `legacy_player_id` | absent — correct for a zero-game, non-legacy player |
| `player_career_stats` | **no seeded row** (§46.3) |

**`players.height_cm` policy — the simpler deterministic option, chosen and stated.**
**Both seeded players get `players.height_cm = NULL`.**

The evidence is decisive: `import_fitzroy_core.py` **never writes `players.height_cm` or
`players.weight_kg` at all** — neither column appears anywhere in that file. On a clean
rebuild every one of the 13,361 fitzRoy-created players therefore has NULL height and weight
until a separate admin ingest supplies one (`src/lib/ingest/datasets.ts:724-784`). Populating
height for the two seeded players — even the one that is Stage A-reproducible — would make
them **inconsistent with every other player in the rebuilt database**, and would mix a
draft-day measurement into a biographical column. The Stage A draft-day height continues to
land in `draft_picks.height_cm` through the ordinary draft import, which is where it belongs.

This also avoids partial manual/source mixing entirely: neither seeded player gets a height,
so there is no rule of the form "source value for one, nothing for the other".

### 48.4 Typed explicit-decision target — APPROVED

| Population | `player_identity` |
|---|---|
| **3** clean-rebuild fitzRoy/AFL Tables targets | `{ source: "afltables", external_id: "<canonical AFL Tables profile path>" }` |
| **2** zero-game human-seeded targets | `{ source: "draftguru", external_id: "<canonical player_url>" }` |
| **1** `confirmed_unlinked` | `null` |

**No `seed_player` boolean.** Semantics are implied by the target's source key:

- an **`afltables`** target **must already resolve** after the fitzRoy import → otherwise
  **HALT**;
- a **`draftguru`** target **may mint** a minimal canonical player if that DraftGuru identity
  is not already registered;
- **`confirmed_unlinked`** creates no canonical player.

### 48.5 Collision / idempotence gates (measured, all clean)

`url_claimed_by_multiple_players` 0 · `player_claimed_by_multiple_urls` 0 ·
`linked_without_player_url` 0 · `unlinked_without_player_url` 0 ·
`existing_draftguru_identity_rows` 0 · `draftguru_rows_already_on_these_urls` 0 ·
Stage B1 contradictions 0.

The seeded player registers `external_identities(source = draftguru, external_id =
<canonical player_url>)`. A re-run resolves that exact identity under
`UNIQUE (source_id, external_id)` and **reuses** the player rather than creating another. **No
name participates in identity at any point.**

---

## 49. FUTURE fitzRoy CONVERGENCE — known limitation and required future gate

`import_fitzroy_core.py` resolves existing players **only** through AFL Tables external
identity (`source = afltables`, `match_method = 'afltables_profile_url'`, `:904-906`), and it
runs **before** the DraftGuru phase. It has no knowledge of any other source's identities.

**Therefore, if one of these DraftGuru-seeded zero-game players later becomes a senior AFL
player, a future fitzRoy import could create a second canonical player before the DraftGuru
phase sees the existing DraftGuru identity. This is a real future-convergence exposure.**

**Cross-source idempotence across future source growth is NOT solved, and must not be claimed
as solved.** For the rebuild scope currently specified:

- **idempotence on the same accepted source snapshot IS proven** — by the DraftGuru external
  identity plus its unique constraint;
- **future source-growth convergence requires** Stage B3 person-page bridge evidence, or
  another explicit cross-source equivalence gate;
- if an admissible future bridge resolves the DraftGuru identity to a **different** canonical
  player → **HALT / audit**, never a silent merge;
- **automatic evidence never overrides the human decision.**

Recorded as a **required future B3 / convergence gate** — and explicitly **not** as a reason to
copy private metadata into the tracked corpus.

---

## 50. G5 CONCLUSION AND B2-1 COMPLETION

With the §47 governance decision, the remaining manual/private metadata is intentionally
excluded from the Git-tracked rebuild corpus. It is required neither for identity nor for
recreating the supported minimal canonical player shell.

| Gap | Status |
|---|---|
| G1 | OPEN — Stage B3 only (NOT APPROVED) |
| **G2** | **CLOSED** |
| **G3** | **CLOSED** |
| **G4** | **CLOSED** |
| **G5** | **CLOSED** |
| **G6** | **CLOSED** |
| **G7** | **CLOSED** |

### **B2-1 = COMPLETE.**

### Schema conclusion

Every element of the approved design is representable by the schema as it stands:

| Requirement | Representation |
|---|---|
| seeded canonical player | `players` — NOT NULL columns `display_name`, `sort_name`, `search_name`, `slug` all deterministically derived; every withheld field is nullable |
| durable DraftGuru identity | `external_identities` `UNIQUE (source_id, external_id)`, `player_id` nullable, `status` / `match_method` / `notes` already carry the semantics |
| `draftguru` as an identity-owning source | already registered in `data/reference/sources.json`, upserted by key so `sources.id` is stable |
| person + transaction facts | `draft_persons`, `draft_picks`, reload keys from migration 069 |
| explicit decisions | the tracked ledger file — **not** schema |
| findings / audit | `data_issues`, already used by `import_draft.py` for this class of problem |
| `resolved` link with a player | `draft_persons_link_ck` and `draft_picks_link_ck` are satisfied by `link_status = 'resolved'` + non-NULL `player_id` |

**NO SCHEMA CHANGE REQUIRED FOR B2-1 DESIGN.**

This supersedes §17's "INFERRED — remains conditional" entry: the condition is now met.
`player_link_resolutions` audit rows are still **not** re-inserted (§16), which remains an
accepted, stated consequence rather than a missing representation.

### Column-derivation register — final

| Column | Class | Rule |
|---|---|---|
| `name_key` | **A** | NBSP→space, collapse whitespace, trim, lowercase; preserve apostrophes/hyphens/non-ASCII; no unaccent (§35.2) |
| `display_name_raw` | **A** | Stage A, one distinct spelling per person |
| `dg_person_id` | **A** | `index + 1` over `player_url`-sorted `persons.jsonl`; per-load rank, never identity; deferred unique constraint required |
| `source_record_id` | **A** | `(source_url, row_index)` — unique over all 6,810 |
| `draft_type` | **A** | verbatim `event_type_raw`; **absence → `'National Draft'`** |
| `draft_kind` | **B** | tracked 11-entry vocabulary incl. the absence case; fail-closed on unknown; **not injective**, so reload-key uniqueness is asserted at import time |
| `club_id` | **B** | exact `club_slug` → `clubs.slug`, 18/19 slugs, 6,388/6,810; **`brisbane` → NULL**, fail-closed |
| `signing_kind` | **A** | `btrim(regexp_replace(signing_raw, '\s*\(.*$', ''))`; NULL where absent |
| `competition` | **B** | `league_era(draft_year)` from `data/reference/seasons.json` |
| `weight_kg` | **C** | no Stage A source, 0/6,810 in PostgreSQL — nothing lost |
| `grade` | **D** | reproducible from `parity_only.grade` but **not promoted**; no `src/` consumer |

**Stage B3 remains NOT APPROVED / NOT STARTED.**

---

## 51. Stage boundary

**B2-1 is complete. Nothing beyond it is approved.**

Not started, and awaiting explicit user approval: **B2-2** (tracked event-kind vocabulary),
**B2-2b** (club mapping file), **B2-3** (ledger export), **B2-4/5** (`import_draftguru.py` and
bridge resolution), **B2-6** (tests), **B2-7** (gated `import_draft.py` retirement), **B2-8**
(orchestrator wiring), and **Stage B3**.

No importer exists. No ledger has been exported. No `src/` file, migration or PostgreSQL write
has occurred. No network request has been made. *(As of PART IV, B2-2 has been approved and
`data/reference/draftguru-event-kinds.json` now exists — see §53.)*

Deferred operational items still open: **U3** (off-host archive of the accepted Stage A
`raw/`), and the `IssuesIndex.md` / `CHANGELOG.md` updates for ISSUE-093.

---

# PART IV — STAGE B2-2 (event-kind mapping contract)

**Started 2026-08-26 on user approval of B2-1. Scope: B2-2 only. B2-3, the importer and
Stage B3 remain NOT APPROVED / NOT STARTED.**

## 52. B2-2 findings

### 52.1 Stage A label hygiene — measured, not assumed

Measured over all 6,810 accepted Stage A rows:

| Property | Result |
|---|---:|
| distinct `event_type_raw` (10 labels + JSON null) | 11 |
| empty-string values | **0** |
| leading/trailing-whitespace-padded values | **0** |
| values containing NBSP or ZWSP | **0** |
| case-variant collisions | **0** |
| null rows | **113** — 1981 × 24, 1982 × 24, 1987 × 65 |
| total | **6,810** |

There is no blank-value case to handle: the field is either one of ten exact labels or JSON
null. **Matching is therefore byte-exact — no trim, no case fold, no Unicode fold.**
Normalising would silently admit a future label differing only in whitespace or case, which
is precisely what this contract exists to prevent.

### 52.2 `draft_kind` is NOT mechanically derivable — the decisive finding

The stored vocabulary is internally inconsistent:

| `draft_type` | stored `draft_kind` | a lowercase+underscore rule would give |
|---|---|---|
| `Pre-Season` | **`preseason`** | `pre_season` ✗ |
| `Mid-Season` | **`midseason`** | `mid_season` ✗ |
| `Pre-Draft` | `pre_draft` | `pre_draft` ✓ |
| `Post-Draft` | `post_draft` | `post_draft` ✓ |

**No algorithm reproduces the vocabulary.** A mechanical rule would emit `pre_season` /
`mid_season`, silently breaking migration 069's reload key
`(source_id, player_url, draft_year, draft_kind)` and any literal kind comparison.
**Enumeration is the only safe representation** — this settles question 9 below, and it is why
"lowercase an unseen label and accept it" must be forbidden rather than merely discouraged.

### 52.3 Consumer analysis — both columns are material, and differently so

| Column | Consumers | Grain |
|---|---|---|
| **`draft_type`** | `draft.ts:96` filter · `:45` sort key · **`:148` `SELECT DISTINCT draft_type` populates the `/draft/[year]` filter dropdown from live data** · `/draft/[year]/page.tsx:156` and `players/[slug]/page.tsx:292,302` render it · `data-edits.ts:82` edit title · `player-match-candidates.ts:248,874`, `player-links.ts:147`, `describe.ts:130` build candidate/evidence descriptions · `grid-solver.ts:868` `draft_type = $1` · `GRID_DRAFT_TYPES` populates the Grid Solver dropdown (`GridSolverForm.tsx:259`) | user-facing display text |
| **`draft_kind`** | **`grid-solver.ts:889` literal `draft_kind = 'trade'`** and migration 069's reload key. `draft.ts` selects and types it, but **no page renders it** — `draftKind` appears nowhere under `src/app/`. No `draft_kind` value literal exists anywhere in `src/` except `'trade'`. | query / key field |

**Both must be preserved explicitly**, and the approved B2-1 rule already does: `draft_type`
keeps the source's own distinction, `draft_kind` collapses it.

**`GRID_DRAFT_TYPES` is set-equal to the 11 observed `draft_type` values** — verified in both
directions. The Grid Solver can offer nothing the importer cannot write, and vice versa.

### 52.4 `National` vs `National Draft` — the collapse is correct, and it is checked

`draft_kind` collapses both onto `national`; `draft_type` does not. Verified semantically
rather than inherited:

- the three no-`Draft`-column years are contract `csv_schema_variants` **A** — the page has no
  `Draft` column *because* it describes a single event, so the absence is a determinate fact,
  not missing data;
- 1986 (variant **B**) *does* carry a `Draft` column, so the absence is specific to
  1981/1982/1987 and is not a general parsing shortfall;
- `detail_raw` is empty for all three of those years (it appears only in 1986/1997/1998), so
  nothing else in the source disambiguates them;
- a national draft in 1981 is the same *kind* of event as one in 1988. Collapsing at
  `draft_kind` while preserving `draft_type` is exactly the distinction the two columns exist
  to express.

**Observed UI consequence, unchanged by the rebuild and deliberately not "fixed":** because
`draft.ts:148` builds the `/draft/[year]` filter from `SELECT DISTINCT draft_type`, and
`GRID_DRAFT_TYPES` lists both, a user sees **two** options — "National" (2,976 rows) and
"National Draft" (113 rows) — for what is one kind. That is pre-existing behaviour; B2's job
is to reproduce it exactly, not to redesign it. Recorded as an observation and a candidate for
a separate tracked issue if the user wants it changed. **No issue has been raised and no
consumer has been modified.**

Note also `createPlayerInTransaction` defaults admin-created picks to `draft_type =
'National Draft'` (`players.ts:388`, `CreatePlayerForm.tsx:250`) with **`draft_kind` NULL** —
the INSERT at `players.ts:391-394` omits the column. Those rows carry `source_id IS NULL` and
sit outside migration 069's partial reload index, so they are unaffected by, and must remain
outside, the importer's identity space.

### 52.5 Signing — contract confirmed from Stage A

| Field | Rule | Evidence |
|---|---|---|
| `signing` | Stage A `signing_raw`, **verbatim, byte-exact** | 995 rows; none whitespace-padded, none empty after strip |
| `signing_kind` | `btrim(regexp_replace(signing_raw, '\s*\(.*$', ''))` — the head, first parenthetical removed | 995/995 reproduce the stored value, **0 mismatches**; the 165 distinct raw values reduce onto exactly the 18 `GRID_SIGNING_KINDS`, set-equal both ways |
| absence | `signing_raw` absent → `signing_kind` **NULL**. Never coerced. | 5,815 rows, including **every** row of 1997 and 1998, where the page carries `Detail` instead of `Signing` |

**Egress rule, binding:** 123 `signing_raw` values embed an NBSP-separated player name inside a
`Father-Son (...)` qualifier. Measured: **0 heads contain NBSP** — the name is always inside
the parenthetical the head rule strips. `signing_raw` is source payload only: never identity,
never a matching input, and its text is never printed to a terminal.

### 52.6 `signing_detail` — the one open item

Known: stored population **593**; Stage A `signing_raw` values containing a parenthetical
**593** — the same count; **44** of them carry a *second* parenthetical
(`Academy (NG) (Fremantle)`); **zero consumers in `src/`** — only `signing_kind` is read.

**A matching count is not a matching rule.** The candidate derivations agree on the 549
single-parenthetical values and diverge on the 44, and the stored text has not been compared
against any of them. It is therefore recorded **OPEN** in the reference file rather than frozen
on a guess, and §55's runner settles it. If none of the four candidates reproduces the column,
`signing_detail` becomes class **D — not imported**, which costs nothing given it has no
consumer.

### 52.7 Where the mapping lives — decision and rejected alternatives

**Accepted: (B) tracked reference JSON — `data/reference/draftguru-event-kinds.json`.**

- The label→kind mapping exists **nowhere today**, so this file is the single source of truth
  for it, not a second one.
- The importer is Python and the application vocabulary is TypeScript; no shared constant is
  possible across that boundary.
- `data/reference/*.json` is explicitly tracked by `.gitignore` (`!/data/reference/*.json`),
  and `load_reference_data.py` reads an **explicit five-file list** (`sources`, `seasons`,
  `clubs`, `stat-definitions`, `stat-availability`) with no globbing — so adding this file
  cannot affect the reference load. `venue-canonical.json` is existing precedent for a tracked
  reference file that loader does not consume.
- The one duplication it creates — the 11 labels also listed in `GRID_DRAFT_TYPES` — is made
  **checked rather than drifting** by a DB-free set-equality test in both directions (§53).

**Rejected — (A) a fixed constant inside the importer.** It buries the contract in code where
it is neither reviewable as data nor diffable, and a TypeScript test cannot cross-check a
Python constant without fragile parsing. Drift between `GRID_DRAFT_TYPES` and the importer
would then be undetectable.

**Rejected — (C) an existing canonical application vocabulary.** None carries `draft_kind`.
`GRID_DRAFT_TYPES` holds display labels only, and §52.3 established that no `draft_kind`
literal exists anywhere in `src/` except `'trade'`. There is nothing to reuse.

---

## 53. Files written for B2-2

| File | Role |
|---|---|
| `data/reference/draftguru-event-kinds.json` | **new** — the one authoritative mapping: 10 labels + the absent-column case, byte-exact matching policy, fail-closed unknown-label policy, the non-derivability counter-examples, the deliberate `national` collapse, reconciliation totals, and the signing contract |
| `tests/draftguru-acquisition.test.ts` | **extended** — a new `Stage B2-2 event-kind mapping contract` describe block (13 tests) in the established semantic home |
| `tools/rebuild/draftguru/b2_signing_detail_evidence.py` | **new** — bounded read-only runner for the single open item (§52.6) |

The tests are DB-free and network-free. They reconcile the file's counts to 6,810; classify
every observed Stage A label with nothing left over in either direction; assert the source
stores JSON `null` and that no sentinel string is invented; pin the absent-column mapping;
assert byte-exact matching and label hygiene; assert the fail-closed policy; **prove a
mechanical rule disagrees** (Pre-Season/Mid-Season); prove `national` is the *only* collapsed
kind and that it collapses exactly those two labels; hold the mapping set-equal to
`GRID_DRAFT_TYPES` and the signing vocabulary set-equal to `GRID_SIGNING_KINDS`, both
directions; reproduce all 995 signing heads from Stage A onto the closed vocabulary; and
assert `signing_detail` is **not** presented as settled. Snapshot-dependent assertions skip
cleanly when the gitignored Stage A snapshot is absent, matching the suite's existing pattern.

---

## 54. B2-2 acceptance criteria

| Criterion | Status |
|---|---|
| all 6,810 Stage A rows classify | **PASS** (pending the user's test run) |
| source-label counts reconcile to 6,810 | **PASS** — 6,697 labelled + 113 absent-column |
| zero unmapped observed labels | **PASS** — checked in both directions |
| zero ambiguous mappings | **PASS** — one label → exactly one `(draft_type, draft_kind)` |
| the 113 become `National Draft` / `national` | **PASS** |
| signing derivation reproduces all 995 | **PASS** — 995/995, 0 mismatches |
| no unsupported sentinel/category introduced | **PASS** — asserted by test |
| future unknown categories fail closed | **PASS** — policy pinned and asserted |
| existing consumers remain representable | **PASS** — §52.3; both vocabularies set-equal |
| no schema migration required | **PASS** — `draft_type text NOT NULL`, `draft_kind text` (migration 006:14-15) hold every value; no new column, type, constraint or enum |

**One item remains open inside B2-2: `signing_detail` (§52.6).** It is the only field the
tracked evidence cannot settle.

**NO SCHEMA CHANGE REQUIRED FOR B2-2.**

---

## 55. Exact user commands

```bash
npx vitest run tests/draftguru-acquisition.test.ts
```

Then, to settle `signing_detail`:

```bash
cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/b2_signing_detail_evidence.py
```

---

## 56. Next boundary — B2-2b (club mapping), NOT STARTED

B2-2b converts the **already-approved** G7 decision (§35.3) into a tracked artefact. The
decision itself is settled and must not be reopened: exact `club_slug` → `clubs.slug`
equality, 18 of 19 slugs, 6,388 / 6,810 rows; `brisbane` → `club_id NULL`, fail-closed; no era
rewriting; no `draft_year + 1` inference; no alias heuristics.

Its scope is only: where the 18-entry mapping lives (a block in
`draftguru-event-kinds.json`, a sibling reference file, or derivation from `clubs.json` at
import time — the last may need no new file at all, since 18 of 19 slugs are already exactly
`clubs.slug`), the fail-closed treatment of an unknown slug, and DB-free tests reconciling
6,388 + 422 = 6,810.

**Not approved, not started.** B2-3, `import_draftguru.py` and Stage B3 likewise.

---

## 57. B2-2 FINAL VALIDATION (user-run, 2026-08-26) — **B2-2 COMPLETE**

### 57.1 Contract suite

**`npx vitest run tests/draftguru-acquisition.test.ts` → Test Files 1 passed (1), Tests
99 passed (99).** All Stage B2-2 contract tests green.

One representation defect was found and fixed by the suite itself: `on_unknown_head` carried
explanatory prose as its value. The machine-action field is now the bare token `"HALT"`, with
the sentence moved to a sibling `unknown_head_note`. **The assertion was kept strict — the
test was not relaxed to accept prose.** The same convention is now applied throughout:
**policy/action is a bare token; reason/procedure lives in a `*_note` sibling.**

### 57.2 `signing_detail` — measured, and classified **D — NOT IMPORTED**

Runner: `tools/rebuild/draftguru/b2_signing_detail_evidence.py`, read-only, `db=afldb_dev
user=afldb_owner txn_ro=on default_ro=on isolation=repeatable read`, **`ROLLBACK completed —
nothing written.`**

| Scope | Value |
|---|---:|
| `picks_with_parenthetical` | 593 |
| `signing_detail_present` | 593 |
| `signing_detail_null` | 0 |
| `multi_parenthetical` | 44 |
| `detail_present_without_parenthetical` | **0** |

| Candidate | exact | whitespace-insensitive |
|---|---:|---:|
| **D1** first `(` .. final `)`, inner text | 426 / 593 | 549 / 593 |
| **D2** first `(` onward, verbatim | 0 / 593 | 0 / 593 |
| **D3** last parenthetical, inner text | 426 / 593 | 549 / 593 |
| **D4** first parenthetical, inner text | **470 / 593** | **593 / 593** |

**No candidate reproduces the stored column exactly.**

**Why D4's whitespace-insensitive 593/593 is NOT sufficient to create a rule.** A comparison
that ignores whitespace is not a derivation — it is a weaker equality applied to hide a
residual difference. Adopting it would require inventing a whitespace-normalisation
transformation that no tracked source defines, and that transformation would immediately
become a new, unsupported source-of-truth rule the rebuild had to carry forever. It would buy
nothing: `signing_detail` has **zero consumers in `src/`** — only `signing_kind` is read
(`grid-solver.ts:884`). Matching a row count, or matching under a relaxed comparison, is not
evidence of the rule that produced the values.

**Recorded as a deliberate omission, not an unresolved defect.** Nothing about the *source* is
lost: `signing` preserves Stage A `signing_raw` verbatim, so any future derivation can still
be defined and applied without re-acquiring anything.

### 57.3 The supported signing contract — final

| Field | Contract |
|---|---|
| `signing` | accepted Stage A `signing_raw`, **verbatim**; NULL when absent |
| `signing_kind` | `btrim(regexp_replace(signing_raw, '\s*\(.*$', ''))` — **proven 995/995**, 0 mismatches; NULL when `signing_raw` is absent |
| `signing_detail` | **NULL / not imported.** Legacy and current column contents are **not part of the supported rebuild contract** |

### 57.4 B2-2 status

**B2-2 = COMPLETE.** All ten acceptance criteria met; the one previously open item is now
settled by measurement and classified D.

**NO SCHEMA CHANGE REQUIRED FOR B2-2.**

The frozen event mapping and the `signing_kind` derivation are **unchanged** by this section.
No `signing_detail` transformation logic exists anywhere.

---

# PART V — STAGE B2-2b (club resolution contract)

**Representation/freeze step for the already-approved G7 decision (§35.3). G7 semantics are
settled and were not reopened; no contradictory evidence appeared.**

## 58. B2-2b findings

### 58.1 Is a new artefact needed? — measured first

Offline, against `data/reference/clubs.json` and the accepted Stage A snapshot:

| Measure | Value |
|---|---:|
| `clubs.json` identities | 24 |
| distinct Stage A `club_slug` | **19** |
| slugs equal to a `clubs.slug` **exactly** | **18** |
| rows they cover | **6,388** |
| slugs with no `clubs.slug` match | **1** — `brisbane` |
| rows | **422** |
| total | **6,810** |
| Stage A rows with a null/blank club field | **0** |

**`brisbane` matches nothing tracked** — not a `slug`, `name`, `short_name`, `hist` or
`abbreviation` value anywhere in `clubs.json`. It is genuinely unresolvable, not merely
un-aliased.

The six `clubs.json` slugs DraftGuru never uses are exactly the historical identities
`brisbane-bears`, `brisbane-lions`, `footscray`, `kangaroos`, `south-melbourne`, `university`
— consistent with DraftGuru labelling by modern identity (Fitzroy excepted, which it retains).

**Conclusion: exact lookup against `clubs.json` is sufficient for 18 of 19 slugs, so no
mapping table is needed — but one datum still must be represented.** Without it the importer
would **HALT on 422 rows**, because a fail-closed rule cannot distinguish *"unknown slug"*
from *"known slug, reviewed, deliberately NULL"*. That distinction is the entire artefact.

### 58.2 Where it lives — decision and rejected alternatives

**Accepted: an additive `club_resolution` block in
`tools/rebuild/draftguru/draftguru-contract.json`.**

- The contract's `fields.Club` **already** states the requirement — *"DESTINATION club under
  DraftGuru's modern identity — era-aware AFLDB resolution required downstream, failing closed
  on 'Brisbane'"* — naming Brisbane and declaring fail-closed, but leaving the resolution
  unresolved. B2-2b completes that same sentence in the same file: one story, one place.
- **Precedent and permission**: the contract was already extended additively with the
  `person_stage` block for Stage B1, and §21 explicitly allows "an additive contract block".
  No Stage A key, manifest or historical meaning is changed.
- **Zero duplication**: the block records the *rule*, the *one exception* and the measured
  reconciliation. It deliberately does **not** restate the 18 working mappings —
  `clubs.json` already holds them, and copying a slug list would create the second source of
  truth this step exists to avoid. A test asserts the block contains no club slug other than
  the exception.

**Rejected — a new `data/reference/draftguru-clubs.json`.** A whole tracked file for one
exception. Listing all 19 would duplicate `clubs.json`; listing only the exception would be a
file containing a single object, with no advantage over the contract block that already owns
the surrounding statement.

**Rejected — a block inside `data/reference/draftguru-event-kinds.json`.** Wrong scope: that
file is the event vocabulary, and its name would stop describing its contents.

### 58.3 The frozen contract

| | |
|---|---|
| **Rule** | exact string equality: `stage_a.club_slug == clubs.slug` |
| **Source of truth** | `data/reference/clubs.json`, projected to the `clubs` table by `load_reference_data.py`; the runtime key is `clubs.slug` |
| **Preserved source facts** | `club_name_raw`, `club_slug`, `club_href_raw` — always retained verbatim |
| **Deliberate NULL** | `club_slug = 'brisbane'` → `club_id = NULL`, 422 rows, 1986–2025 |
| **Unknown slug** | **`HALT`** — never resolved by alias, name, similarity or year, and **never silently written as NULL**, so an unknown slug and a reviewed exception stay distinguishable |
| **Forbidden by name** | `club_aliases` lookup · `clubs.name` / `clubs.short_name` lookup · `import_draft.py`'s best-effort `clubs.get(club_name_raw.lower())` fallback · era rewriting · `draft_year + 1` inference · any fuzzy/name matching |
| **Not era-rewritten** | `western-bulldogs`, `north-melbourne`, `sydney` map to the **current** identity; never Footscray / Kangaroos / South Melbourne |

The Brisbane reason is recorded in full: one label spans two **separate organizations** joined
by merger not rename (migration 017: *"a merger is not a rename"*), Grid Solver resolves
`club_id` at organization grain, so a wrong choice would silently attribute Bears draftees to
the Lions. It is **intentional fail-closed behaviour, identical to what `afldb_dev` already
stores**, and stands until a tracked rule or source can distinguish the organization safely.

## 59. Files written for B2-2b

| File | Role |
|---|---|
| `tools/rebuild/draftguru/draftguru-contract.json` | **extended** — additive `club_resolution` block (§58.3). No existing key changed. |
| `tests/draftguru-acquisition.test.ts` | **extended** — a new `Stage B2-2b club resolution contract` describe block (8 tests) |

The tests are DB-free and network-free. They assert the exact-equality rule and
`new_mapping_table_required: false`; that the block contains no restated club slug; the
reconciliation 6,388 + 422 = 6,810 and 18 + 1 = 19; that exactly one deliberate NULL exists
and it is `brisbane`, absent from `clubs.json` while `brisbane-bears`/`brisbane-lions` are
present; that `brisbane` matches **no** `clubs.json` field at all; that every fallback
mechanism is forbidden **by name** and that no exception is year-conditional; that the three
modernised labels map to current identities and never target their historical partners; that
`on_unknown_club_slug` is the bare token `HALT`; and — against the real snapshot when present
— that Stage A carries exactly 19 slugs, 18 mapped covering 6,388 rows and `brisbane` alone
unmapped at 422.

## 60. B2-2b acceptance criteria

| Criterion | Status |
|---|---|
| 6,810 rows reconcile | **PASS** — 6,388 + 422 |
| 6,388 exact mappings | **PASS** |
| 422 intentional `brisbane` NULL mappings | **PASS** |
| 18 exact mapped slugs | **PASS** |
| one intentional unmatched slug | **PASS** |
| zero fuzzy / alias / year-based mappings | **PASS** — forbidden by name, asserted, and measured 0/0 |

**B2-2b = COMPLETE, pending the user's test run.**

**NO SCHEMA CHANGE REQUIRED FOR B2-2b.** `draft_picks.club_id integer REFERENCES clubs(id)`
is nullable as defined (migration 006:26); the deliberate NULL needs no constraint change, and
`club_name_raw` / `original_club_raw` already retain the source facts.

## 61. Exact user command

```bash
npx vitest run tests/draftguru-acquisition.test.ts
```

## 62. Next boundary — B2-3, NOT STARTED

B2-3 is the **explicit-decision ledger export**: converting the six surrogate-keyed decisions
into `data/reference/draftguru-link-decisions.json` under the typed target model approved in
§48.4 — 3 × `afltables`, 2 × `draftguru`, 1 × `null` — with **no `seed` block and no
`seed_player` boolean**, and with the §47 governance decision binding (no DOB, weight,
birth-year bounds, notes or manual height in Git).

It requires a **read-only export runner** under the standard envelope and **separate user
approval**, because §16 marks its egress boundary as deliberately different from the
aggregate-only reconciliation boundary: it is a controlled natural-key export.

**Not approved, not started.** `import_draftguru.py`, bridge resolution, Stage B3,
orchestrator wiring and `import_draft.py` retirement likewise.

---

## 63. B2-2b FINAL VALIDATION (user-run, 2026-08-26)

**`npx vitest run tests/draftguru-acquisition.test.ts` → Test Files 1 passed (1), Tests
107 passed (107).** The Stage B2-2b club resolution block is **8/8**.

| Stage | Status |
|---|---|
| **B2-2** (event-kind mapping contract) | **COMPLETE** |
| **B2-2b** (club resolution contract) | **COMPLETE** |

**Neither contract is to be reopened** unless genuinely contradictory evidence appears.

---

# PART VI — STAGE B2-3 (explicit-decision ledger export)

**PREPARED, NOT EXECUTED.** The exporter has been written and inspected; the controlled
export has **not** been run, and `data/reference/draftguru-link-decisions.json` does **not**
yet exist. B2-3 is **not** complete until the user-run export is inspected and its ledger
validated.

## 64. Ledger schema

```json
{
  "$comment": "...",
  "schema_version": 1,
  "source_key": "draftguru",
  "decisions": [
    { "player_url": "<canonical DraftGuru player_url>",
      "decision": "linked",
      "target": { "source": "afltables", "external_id": "players/A/Name.html" } },

    { "player_url": "<canonical DraftGuru player_url>",
      "decision": "linked",
      "target": { "source": "draftguru", "external_id": "<the same canonical player_url>" } },

    { "player_url": "<canonical DraftGuru player_url>",
      "decision": "confirmed_unlinked",
      "target": null }
  ]
}
```

**Fields deliberately omitted, each with its justification:**

| Omitted | Why |
|---|---|
| `draft_year`, `draft_kind` | §16 originally keyed on the *pick* reload key. The settled model keys on the **person**: migration 019 resolves identity once per person and propagates it to every pick, and `import_draft.py`'s own `read_decisions()` already normalises "from the pick it names to its person". Pick-grain fields have no function here. |
| `previous_status` | It exists to detect that a row's status changed since the decision. A fresh rebuild has no previous status — every row is new — so it has **no rebuild function**. |
| `decided_at`, `note` | No rebuild function, and a timestamp would make the file's bytes non-deterministic. |
| `admin_user_id` / any admin identity | No rebuild requirement; `auth_users` is not seeded by a fresh build (§16). Personal data with no purpose. |
| `seed_player` | The target's `source` key already carries the declaration (§40.4). A boolean could contradict it. |
| DOB, weight, birth-year bounds, notes, manual height | **§47 governance decision** — never in Git. |
| Stage A display payload (`display_name`) | Stage A is already the authoritative lookup, keyed by the same `player_url`; the importer fails closed if the person is absent. Copying it would duplicate a source of truth. |
| Any surrogate id | `players.id`, `draft_picks.id`, `draft_persons.id` all regenerate. Carrying them is the exact defect this ledger exists to remove. |

**The one conditional field:** `identity_evidence: "stage_b1_person_page_bridge"` is written
**only** on an entry whose AFL Tables identity did not come from `external_identities` (§65.3).
It is justified because it makes visible, in the ledger itself, which entry crossed a
documented admissibility boundary. It is non-sensitive and absent from every other entry.

## 65. Exporter design

**File: `tools/rebuild/draftguru/export_link_decisions.py`.**

### 65.1 Safety envelope and egress

Identical mandatory envelope to every Stage B2 runner: `AFLDB_OWNER_DATABASE_URL` parsed out
of `.env` (never sourced, never printed); DSN hard-guarded to `/afldb_dev`; the preserved
pre-rebuild database refused by name; `default_transaction_read_only=on` at connect;
`conn.read_only = True`; `REPEATABLE READ`; in-session verification of database / user /
read-only / isolation; **SELECT only**; explicit `ROLLBACK` in a `finally` on success and
failure alike. Statically verified: the source contains no `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, `COPY`, `COMMIT`, `ALTER` or `CREATE` of any kind.

**This is a controlled natural-key export and its egress boundary is deliberately different**
from the aggregate-only boundary every other runner obeys (§16). It writes `player_url` values
and AFL Tables profile paths into the tracked ledger — that is its purpose. **Terminal output
stays aggregate**: counts, the distribution, and the output path. No identifying value is
printed, and problems are reported by decision *ordinal* only.

### 65.2 Natural-key conversion path, per target class

Operative decisions are selected exactly as `import_draft.py:198-211` does —
`DISTINCT ON (r.target_id) … ORDER BY r.target_id, r.created_at DESC, r.id DESC` — because the
audit trail is append-only and the newest row for a target is the one that stands. The join is
restricted to picks whose `source_id` is the `draftguru` source, so **legacy/automatic
resolutions and any other target table are structurally excluded**.

| Class | Conversion |
|---|---|
| `confirmed_unlinked` | `target: null`. Creates no canonical player. |
| `linked`, target player **has senior games** | `source: "afltables"`, `external_id` from `external_identities` where `sources.key='afltables'`, `match_method='afltables_profile_url'`, `status IN ('unique','resolved')`. |
| `linked`, target player has **zero senior games** | `source: "draftguru"`, `external_id` = the decision's own canonical `player_url`. |

**The classifier is the rebuild's own player-existence rule, not this database's registration
state.** `import_fitzroy_core.py:711-716` builds `players` only from fitzRoy `player_stats`
rows and fails closed without an ID/profile URL, so *played ⇒ will exist with an AFL Tables
identity* and *never played ⇒ will not exist at all*. Senior games is therefore the correct
discriminator; the current `external_identities` population is not.

### 65.3 The known admissibility boundary — expect a HALT on the first run

§38.1 measured the three `afltables` targets as **2 with a registered identity, 1 without** —
that third is one of the 889 played-but-unregistered players. Its AFL Tables path **is**
observable in the accepted Stage B1 snapshot, but §21 admits that snapshot as a **profiling /
validation oracle only, never an import source**.

The exporter therefore **fails closed by default** on that decision rather than quietly
authoring durable tracked state from an inadmissible source. **The first run is expected to
HALT**, reporting `2 of 3` resolvable and naming nothing.

`--admit-b1-bridge-identity` is the explicit, reviewed opt-in. When used, that one entry is
authored from the Stage B1 observation **and carries `identity_evidence:
"stage_b1_person_page_bridge"`**, so the ledger records which entry crossed the boundary.
**This is a decision for the user, not for the exporter to make silently.** The alternative is
to resolve that identity another way before exporting.

### 65.4 Fail-closed gates

Every gate is fatal, all are evaluated before anything is written, and the file is written
**last**:

| # | Gate |
|---|---|
| 1 | database is `afldb_dev`; transaction read-only; `REPEATABLE READ`; pre-rebuild database refused |
| 2 | exactly **6** operative decisions |
| 3 | exactly **5 `linked` + 1 `confirmed_unlinked`** |
| 4 | target distribution exactly **3 `afltables` / 2 `draftguru` / 1 `null`** |
| 5 | every decided pick carries a DraftGuru person identity — a decision with no `player_url` HALTs |
| 6 | every `player_url` matches the canonical regex, byte-exact, percent-encoding preserved |
| 7 | **6 distinct `player_url` keys** — two decisions on one person HALT |
| 8 | every `afltables` identity matches `^players/[A-Za-z]/[^/]+\.html$` |
| 9 | a target player holding **more than one** AFL Tables identity HALTs — ambiguous, never chosen between |
| 10 | **no AFL Tables identity claimed by two decisions** — refusing to merge two people |
| 11 | every `draftguru` target's `external_id` equals its own decision key |
| 12 | an unknown `action` value HALTs |
| 13 | an unresolvable `afltables` identity HALTs unless `--admit-b1-bridge-identity` is passed |

**Determinism:** decisions are sorted byte-ascending on `player_url`; JSON is written with
`ensure_ascii=False`, `indent=2`, LF newlines and a trailing newline; **no timestamp is
recorded**, so a re-run over unchanged data reproduces the file byte-for-byte.

## 66. Frozen future-importer semantics

| Ledger entry | Importer behaviour |
|---|---|
| `target.source = "afltables"` | the identity **must already resolve** after the fitzRoy import; otherwise **HALT** |
| `target.source = "draftguru"` | **may mint** the approved minimal zero-game player shell; the stable identity becomes `external_identities(source = draftguru, external_id = player_url)` |
| `target = null` (`confirmed_unlinked`) | creates **no** canonical player |

**Automatic evidence never overrides one of these decisions.** Ordinals are never collapsed,
names never participate in identity, and historical automatic links are never replayed —
they cannot even be read, since the exporter's join admits only explicit resolutions on
draftguru-sourced picks.

## 67. Files written for B2-3 (preparation only)

| File | Role |
|---|---|
| `tools/rebuild/draftguru/export_link_decisions.py` | **new** — the bounded read-only exporter (§65). Compiles clean; passes its own static pins. |
| `tests/draftguru-acquisition.test.ts` | **extended** — a `Stage B2-3 explicit-decision ledger contract` describe block (11 tests) |

**`data/reference/draftguru-link-decisions.json` does NOT yet exist** and must not be
hand-authored.

The tests split deliberately. Four **exporter pins always run**: no write statement of any
kind; the full safety envelope; the population/distribution constants and canonical regexes as
hard gates; and the Stage B1 oracle as opt-in rather than default. Seven **ledger assertions
skip until the controlled export produces the file** — schema shape and exact key set; six
decisions on six distinct persons; 5 + 1 and 3/2/1; the closed decision/source vocabulary;
canonical target forms with no AFL Tables identity claimed twice; **no surrogate id and no
private or seed metadata** (a recursive walk asserting `schema_version` is the only number in
the document); byte-ascending order with no timestamp; and `identity_evidence` present only on
an `afltables` entry.

**The six decision values are never fabricated in tests**, so these assertions cannot pass by
agreeing with a fixture this suite wrote itself.

## 68. B2-3 status

**PREPARED — NOT COMPLETE.** Awaiting the user-run export and validation of its ledger.

## 69. Exact user command

```bash
cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/export_link_decisions.py
```

**Expect this to fail closed** at gate 13 (§65.3), reporting 2 of 3 `afltables` identities
resolvable. That is the designed behaviour, not a defect. The reviewed opt-in, only if the
user accepts crossing the §21 boundary, is:

```bash
cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/export_link_decisions.py --admit-b1-bridge-identity
```

---

## 70. Default export run + APPROVED one-entry promotion (2026-08-26)

### 70.1 The default run failed closed exactly as designed

| Observed | Value |
|---|---:|
| audit rows on draftguru picks | 6 |
| operative decisions | 6 |
| decisions built | **5** |
| `afltables` targets | 2 |
| `draftguru` targets | 2 |
| `null` targets | 1 |

**No ledger was written.** The single missing decision is `linked`, its target played senior
football (so it belongs to the `afltables` class under the settled clean-rebuild rule),
`afldb_dev` registers no `afltables_profile_url` identity for it, and the accepted Stage B1
snapshot contains an observable AFL Tables path.

### 70.2 The approval, and its exact limit

**The user approved promoting THAT ONE Stage B1 bridge identity into the tracked ledger.**

**This is NOT approval to make Stage B1 generally import-capable.** Stage B1 remains
`identity_complete = false`, `import_capable = false`, **profiling/validation evidence only**
(§21 unchanged). The exception is a **reviewed promotion of one specific observed identity**,
needed to express an already-existing explicit human link using a stable natural key. It is a
one-entry promotion, **not a reclassification of Stage B1**, and it must never be cited as
precedent for admitting the B1 snapshot as an import source.

The promoted entry carries the non-sensitive marker `"identity_evidence":
"stage_b1_person_page_bridge"`. **No other decision carries it**, because no other decision's
identity comes from that source.

### 70.3 Gate audit against the 14 approval conditions

Nine were already enforced; **five were missing and have been added**. Nothing else changed.

| # | Condition | Before | Now |
|---:|---|---|---|
| 1 | `player_url` exists in the accepted frozen B1 sample | implicit via the bridge map | **explicit** — map built only from the manifest-verified 120-record file |
| 2 | evidence is the accepted snapshot/manifest, not an arbitrary local page | **MISSING** | **ADDED** — chain of custody pinned in code: `B1_MANIFEST_SHA256` → manifest → the manifest's own declared sha256 for `parsed/person_profile.jsonl` → record count 120. Label and `immutable` checked; `identity_complete`/`import_capable` asserted still **false/false**, so the promotion cannot quietly depend on a reclassification |
| 3 | exactly one admissible AFL Tables identity on that page | **MISSING** | **ADDED** — `distinct_afltables_identity_count == 1`, all seven `flags` false, `terminal_classification == "fetched"`, `http_status == 200`, `profiled` true |
| 4 | reduces to the canonical profile form | present | present — now also enforced at load time |
| 5 | no multiple-candidate ambiguity | **MISSING** | **ADDED** — `multiple_afltables_candidates` is one of the seven flags, plus the count check; the href must have `reduces`, `path_shape_ok` and host `afltables.com` |
| 6 | no Stage B1 collision — another person claiming the same identity | **MISSING** (only checked within the 6 decisions) | **ADDED** — collision detected across the **whole 120-person sample**; a contested identity is dropped for both sides, never chosen between |
| 7 | the decision is `linked` | present | present |
| 8 | the target played senior football → `afltables` class | present | present |
| 9 | the database provides no conflicting identity | present | present — the path is reached only when the DB identity is absent, and `>1` identity already HALTs |
| 10 | exactly one decision requires promotion | **MISSING** | **ADDED** — `EXPECTED_PROMOTIONS = 1`; more exceeds the approval, none means the flag should not have been used |
| 11 | post-promotion distribution 3 / 2 / 1 | present | present |
| 12 | six unique `player_url` keys | present | present |
| 13 | no automatic/legacy resolution admitted | present | present — the SQL admits only explicit resolutions on draftguru-sourced picks |
| 14 | no name matching anywhere | present | present — no name column is read at all |

**Verified locally, without a database:** the admissibility loader accepts **100 of 100**
Stage B1 bridges, all in canonical form, all keys canonical `player_url`, and **zero
collisions** across the sample. So the one approved promotion will resolve, and the added
gates do not accidentally block it.

### 70.4 Bounded changes made

| File | Change |
|---|---|
| `tools/rebuild/draftguru/export_link_decisions.py` | `load_b1_bridges()` replaced with an admissibility-checked loader (gates 2, 3, 5, 6); `EXPECTED_PROMOTIONS` gate added (gate 10); `hashlib` imported. No other logic touched. |
| `tests/draftguru-acquisition.test.ts` | three added exporter pins covering the new gates (chain of custody, §14 admissibility, one-promotion cap) |

The static safety pins still hold: no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `COPY`,
`COMMIT`, `ALTER` or `CREATE` anywhere in the exporter; it compiles clean.

### 70.5 Status

The opt-in export is **safe to execute**. B2-3 remains **NOT COMPLETE** until the user runs it
and the resulting ledger is validated.

---

## 71. B2-3 FINAL VALIDATION — **B2-3 COMPLETE**

The opt-in export was run under the read-only `REPEATABLE READ` envelope and produced
`data/reference/draftguru-link-decisions.json` (2,024 bytes).

**Final exported population: 6 decisions — 5 `linked` + 1 `confirmed_unlinked`; typed targets
3 `afltables` / 2 `draftguru` / 1 `null`.** One entry carries
`identity_evidence: "stage_b1_person_page_bridge"` — the single reviewed promotion.

`npx vitest run tests/draftguru-acquisition.test.ts` was run **twice with the real ledger
present**: **Test Files 1 passed, Tests 122 passed / 122**, both times. Every B2-3 ledger
assertion executed against the real exported artefact, not a fixture.

The ledger carries **no** surrogate id, admin identity, DOB, weight, birth-year bound, note,
height, timestamp, `seed_player` boolean or copied display-name payload.

**Stage B1 remains profiling-only overall.** The one promotion is not precedent.

| Stage | Status |
|---|---|
| B2-1 · B2-2 · B2-2b · **B2-3** | **COMPLETE** |

---

# PART VII — STAGE B2-4/5 (the supported importer)

**Implementation stage. Stage B3 acquisition, B2-7 retirement and B2-8 orchestrator wiring
remain NOT STARTED.**

## 72. Legacy importer mechanics — useful vs retired

Established by direct inspection of `tools/migration/import_draft.py`,
`tools/migration/common.py` (`reload_keyed` :410-703, `import_batch`, `check_population_drop`),
migrations 002/006/019/045/069, `tools/rebuild/draftguru/parse_draft_snapshot.py` and
`tools/migration/import_fitzroy_core.py`.

### 72.1 KEEP — table and reload semantics that are still correct

| Mechanic | Why it survives |
|---|---|
| `PERSON_KEY = (source_id, player_url)` · `PICK_KEY = (source_id, player_url, draft_year, draft_kind)` | migration 069's reload keys. Row ids are durable application identity, so keyed reconciliation is mandatory. |
| `reload_keyed(..., link_columns=None, scope_column="source_id", scope_values=[draftguru])` | Ownership scoping. Admin-created picks (`source_id IS NULL`) sit outside the reload's UPDATE, INSERT **and** DELETE, exactly as migration 069's partial index guarantees. `link_columns=None` is deliberate: `reload_keyed`'s own decision machinery is pick-grained, and DraftGuru identity is **person**-grained. |
| `delete_missing=False` on `draft_persons`, then an explicit childless-person DELETE **after** the picks | `draft_picks.draft_person_id` is a NO ACTION FK; a person can only be deleted once its picks are gone (ISSUE-078). |
| `SET CONSTRAINTS draft_persons_source_id_dg_person_id_key DEFERRED` | `dg_person_id` is a per-load rank, so a reload can permute it; a non-deferrable unique constraint fails row by row. |
| `import_batch(...)` | One transaction, batch provenance, rollback-and-mark-failed on error. |
| Person-grained decision replay **after** the source facts are written, same transaction | `replay_decisions()`'s shape: update the person, then propagate to every pick of that person. Anything pick-grained lets one pick take a link the admin rejected on another. |
| `check_population_drop()` | ISSUE-092 §4 fail-closed gate, applied to `external_identities(draftguru)`. |
| `Reporter` / `report_reload` / `analyze` | Existing run-report and post-load conventions. |

### 72.2 RETIRE — legacy-source assumptions that must not be carried forward

| Assumption | Replacement |
|---|---|
| `connect_legacy()` / `AFLDB_LEGACY_SQLITE` / `DRAFT_QUERY` — the entire input | Accepted Stage A snapshot + manifest, re-parsed by the tested `parse_draft_snapshot.py`. **Zero legacy dependency.** |
| `source_record_id = str(d.rowid)` — a SQLite rowid reissued on every upstream rebuild | `f"{source_url}#{row_index}"`, proven unique over all 6,810 (§28.5). Provenance, never a key. |
| `players.legacy_player_id` link mapping | Retired outright — `import_fitzroy_core.py` never populates that column, so on a fresh build it resolves nothing. |
| `clubs.get(club_raw.lower())` best-effort alias fallback | Exact `club_slug == clubs.slug` equality; `brisbane` → NULL; unknown → **HALT** (§35.3). |
| `clean_text(row["draft_type"]) or "unknown"` — a silent sentinel | Frozen event mapping; an unknown `event_type_raw` **HALTs** (§35.1 / B2-2). |
| Legacy-supplied `name_key`, `dg_person_id`, `link_status`, `match_method`, `candidate_count`, `confidence_notes` | All derived deterministically (§35.2 name_key rule; rank for `dg_person_id`; authority-derived link state). |
| `signing_detail`, `grade`, `weight_kg` from legacy | **Not imported** — §57.3, §35.1, §31. |
| `read_decisions()` reading the live database as the **only** decision source | The tracked ledger is the primary input. Live `player_link_resolutions` is retained **additively** — see §73.5. |

## 73. Importer architecture

**File: `tools/rebuild/draftguru/import_draftguru.py`** — kept beside the other DraftGuru
rebuild tooling rather than scattered into `tools/migration/`, because every one of its inputs
(contract, snapshot, parser, ledger) already lives there. It imports the shared
`tools/migration/common.py` helpers rather than reimplementing them.

### 73.1 Phase A — validate every artefact before any database access

`--validate-only` performs this whole phase and **needs no psycopg**, mirroring
`import_fitzroy_core.py`. Fail-closed checks, all before `connect_pg`:

- Stage A manifest present; `snapshot_label` matches; `identity_complete` and `import_capable`
  both **true** (§21 — this is the one snapshot whose accepted contract admits it as an import
  source); `parser_contract_version` and `adapter_schema_version` match the contract.
- **Every one of the 42 raw year pages verified by sha256 against the manifest** before it is
  parsed. The manifest hashes the raw bytes, not the parsed output, so the raw files are the
  anchor and the tested parser is re-run over them — no second interpretation of the HTML, and
  no reliance on an unhashed `parsed/*.jsonl`.
- `parse_snapshot(require_complete=True)` + `validate_identity(...)` — the same tested code the
  acquisition gate uses.
- **6,810 rows / 5,057 distinct `player_url`** asserted exactly.
- Every `player_url` matches the canonical regex, byte-exact, percent-encoding preserved.
- Event mapping reconciles: every observed `event_type_raw` is in the tracked file and every
  mapped label was observed; the absence case is JSON `null`, never a sentinel.
- Club mapping reconciles: 18 exact slugs + the reviewed `brisbane` NULL = 19; unknown → HALT.
- Signing heads all inside the closed 18-value vocabulary.
- Ledger satisfies its frozen contract: schema version, 6 decisions, 6 distinct canonical
  keys, 5+1, 3/2/1, canonical target forms, `draftguru` targets self-keyed.
- Reload keys unique: `(player_url, draft_year, draft_kind)` over all 6,810.

### 73.2 Phase B — resolve reference identity at runtime

`sources.key` → id for `draftguru` and `afltables`; `clubs.slug` → id. **No surrogate id is
ever hard-coded in a tracked file.** A missing or non-unique source/club row is a HALT.

### 73.3 Phases C/D — link authority

Per person, in strict precedence order:

1. **explicit human decision** — ledger, or a live `player_link_resolutions` row (§73.5);
2. **admissible bridge** (§74) — only when an approved bridge dataset is supplied;
3. **unmatched**.

`afltables` target → resolve the existing canonical player through
`external_identities(afltables, afltables_profile_url, unique/resolved)`; **absent or ambiguous
→ HALT**, never a replacement player. `draftguru` target → reuse the existing
`external_identities(draftguru, player_url)` player if present, else mint the approved minimal
shell. `confirmed_unlinked` → `player_id NULL`, `link_status = 'unmatched'`, no player.

Names, game counts, birth years, fuzzy matching, ordinal collapse and legacy automatic links
are used nowhere — the importer never reads a name column for identity.

### 73.4 Column derivations (final, from the frozen contracts)

| Column | Value |
|---|---|
| `draft_persons.display_name_raw` · `draft_picks.player_name_raw` | Stage A **verbatim, NBSP preserved** — see §73.6 |
| `draft_persons.name_key` | frozen §35.2 rule: NBSP→space, collapse, trim, lowercase; apostrophes, hyphens and non-ASCII preserved; **no unaccent** |
| `dg_person_id` | `index + 1` over `player_url`-sorted persons; per-load rank, never identity |
| `source_record_id` | `"<source_url>#<row_index>"` |
| `draft_type` / `draft_kind` | tracked event mapping; absence → `National Draft` / `national` |
| `club_id` / `club_name_raw` / `original_club_raw` | exact slug map (brisbane → NULL); raw facts verbatim |
| `signing` / `signing_kind` / `signing_detail` | verbatim / frozen head rule / **NULL** |
| `competition` | `league_era(draft_year)` from `seasons.json` — VFL ≤1989, AFL ≥1990 |
| `height_cm` / `draft_age` | Stage A `height_raw` / `age_raw`, digits parsed |
| `weight_kg` / `grade` | **NULL** |
| `pick_number` / `pick_note` / `detail` | Stage A `pick_number` / `pick_note_raw` / `detail_raw` |
| `reported_games` / `reported_goals` | Stage A `parity_only.games` / `goals` — **newly classified, see §73.7** |
| `is_matching_backlog` | `player_id IS NULL AND reported_games > 0`, satisfying `draft_persons_backlog_ck` |

### 73.5 AMENDMENT to §16 — live decisions are replayed additively

§16 said the replay's input simply "changes from a live DB read to the tracked ledger". Taken
literally that **regresses ISSUE-078**: `reload_keyed` is called with `link_columns=None`, so
`player_id`/`link_status_value` come from the incoming rows and would overwrite any admin
decision made *after* the rebuild.

**Amended design:** the importer replays **both** — the tracked ledger (the six pre-rebuild
decisions) **and** any live `player_link_resolutions` rows on draftguru-owned picks, normalised
to their person exactly as `import_draft.py:198-211` does. **A live decision wins** where both
name one person, because it is strictly newer, and the override is reported. On a fresh rebuild
the live set is empty and this is a no-op; on a live database it is precisely the ISSUE-078
invariant Phase H requires. When a live decision overrides a ledger entry, the ledger should be
re-exported — reported, never silently reconciled.

### 73.6 STATED DIFFERENCE from the legacy value — `display_name_raw` keeps its NBSP

§35.2 established that afldb_dev's stored `display_name_raw` carries **ASCII spaces**, while
Stage A uses **U+00A0** throughout. Two tracked rules point the other way:

- the Stage A contract's `comparison_normalisation` block: NBSP→space is applied *"ONLY when
  comparing values for parity — **never to raw/ bytes, never to stored raw text fields**"*;
- migration 019's own comment on `player_name_raw`: *"the name exactly as the source printed
  it"*.

So the rebuilt `display_name_raw` / `player_name_raw` will **differ from afldb_dev** by that one
character class. This is a **deliberate, contract-directed difference, flagged not buried** —
`name_key` still folds NBSP (frozen rule step 1), so search and keying are unaffected. If the
user prefers legacy-identical raw text, that is a one-line change and a decision to record.

### 73.7 NEWLY CLASSIFIED — `reported_games` / `reported_goals` = class A, triage-only

Not previously in the §31 register. Stage A carries both under `parity_only` (6,810/6,810), and
the contract labels Games `parity-only-never-fact`. Migration 019 nevertheless defines
`reported_games` precisely for backlog triage — *"Used only to tell a genuine non-player from a
matching backlog; never displayed as a career total"* — and §15 already licenses exactly that
use. They are therefore imported **solely** to compute `is_matching_backlog`, and are **never**
identity evidence and never a career statistic.

## 74. Bridge-resolution interface (Phase E)

A separate, explicitly-supplied dataset — **never** Stage B1's profiling snapshot, which the
importer cannot read at all.

```json
{ "schema_version": 1, "snapshot_label": "<approved bridge snapshot>",
  "manifest_sha256": "<sha256 of that snapshot's manifest>",
  "bridges": [ { "player_url": "https://www.draftguru.com.au/players/<slug>/<n>",
                 "afltables_external_id": "players/A/Name.html" } ] }
```

Supplied by `--bridge <path>`; **absent by default**, in which case no automatic link is made
anywhere and every unbridged person is `unmatched` (§23's deterministic no-bridge behaviour).

Admissibility, all fail-closed: canonical `player_url` only · canonical AFL Tables path only ·
duplicate `player_url` → HALT · one AFL Tables identity claimed by two persons → HALT · the
identity must resolve to exactly one existing canonical player after the fitzRoy phase, else
HALT · a bridge contradicting an explicit human decision → **HALT with a `data_issues` row**;
automatic evidence never overrides human authority · zero or multiple candidates are never
guessed. An admitted link is written `link_status = 'unique'`,
`match_method = 'draftguru_person_page_afltables_bridge'` — **`'unique'`, not `'resolved'`**,
which stays reserved for human decisions.

Stage B3 can populate this file later **without changing any importer semantics**. Synthetic
fixtures exercise the interface now; **no fake production bridge data is created.**

## 75. Transaction, ownership and idempotence

One `import_batch` transaction; a failure rolls back and marks the batch failed, leaving no
partially rebuilt DraftGuru state. Every write is scoped `source_id = draftguru`. Ownership
collisions are refused by `reload_keyed`'s `ReloadOwnershipCollision` before any write —
foreign rows sharing a natural key are never adopted or deleted.

A second import over identical inputs reconciles by natural key, so: no duplicate persons or
picks; no duplicate external identities (`UNIQUE (source_id, external_id)`); **no new seed
player** (the DraftGuru external identity resolves the existing one); stable row ids; identical
counts and values.

## 76. Schema and privilege conclusions

**No schema change** — every column, constraint and index the design needs already exists.

**No privilege change.** Migration 045 registers every public table except a named
auth/beta/settings deny-list as import-writable, so `afldb_import` already holds write access to
`players`, `draft_persons`, `draft_picks`, `external_identities`, `data_issues`,
`import_batches` and the relevant sequences. The importer connects through
`AFLDB_IMPORT_DATABASE_URL` (`common.connect_pg`'s default) and **never** falls back to owner
access. ISSUE-083's role-parity work is **not** absorbed here.

---

## 77. B2-4/5 implementation state

### 77.1 Files written

| File | Role |
|---|---|
| `tools/rebuild/draftguru/import_draftguru.py` | **new** — the supported importer (§73) |
| `tests/draftguru-import.test.ts` | **new** — 28 DB-free contract tests |
| `tests/integration/draftguru-import.test.ts` | **new** — DB-backed behavioural proofs, **prepared, not run** |

`tests/draftguru-import.test.ts` is a sibling of `tests/draftguru-acquisition.test.ts` on the
precedent that `tests/fitzroy-core-import.test.ts` is a sibling of
`tests/fitzroy-acquisition.test.ts`: acquisition and import are different subsystems with
different contracts. The integration file is likewise a sibling of
`tests/integration/draft-reload-links.test.ts` rather than an addition to it, because that
suite's `canRunImporter` guard **requires `AFLDB_LEGACY_SQLITE`** — coupling the supported
path's proofs to the legacy database is precisely what ISSUE-093 exists to remove.

### 77.2 DB-free validation — RUN AND GREEN

| Check | Result |
|---|---|
| `import_draftguru.py --validate-only` (Phase A end to end, no database) | **PASS** — 42 year pages sha256-verified against the accepted manifest, re-parsed, **5,057 persons / 6,810 picks**, event/club/signing/ledger contracts all reconciled |
| `npx vitest run tests/draftguru-import.test.ts` | **28 / 28 PASS** |
| `npx vitest run tests/draftguru-acquisition.test.ts` (regression) | **122 / 122 PASS**, unchanged |

The contract tests pin: zero `AFLDB_LEGACY_SQLITE` / `connect_legacy` / `sqlite3`; no CSV
parity oracle; no Stage B1 profiling output; no network primitive; `AFLDB_IMPORT_DATABASE_URL`
and never the owner URL; migration 069's reload keys and the deferred `dg_person_id`
constraint; two source-scoped reloads plus `refuse_out_of_scope_key`; the frozen `name_key`
rule with `name_key` never assigned from `afldb_normalise_name`; the frozen signing rule with
`signing_detail`/`weight_kg`/`grade` never written; fail-closed unknown event, club and signing
values; the ledger vocabulary and its HALTs; minimal-seed content; and bridge admissibility.
Four spawn tests exercise the bridge interface with **synthetic** fixtures — a well-formed
bridge is accepted, and double-claimed, non-canonical and non-canonically-keyed bridges are
each refused. **No fake production bridge data was created.**

### 77.3 Two defects found and fixed during implementation

1. **`--dry-run` raised `SystemExit` inside the `import_batch` context manager.** `SystemExit`
   derives from `BaseException`, so `import_batch`'s `except Exception` would not see it and
   `batch.finish()` would never run, leaving the `import_batches` row stuck in `running`.
   Replaced with a dedicated `DryRunComplete(Exception)` that the context manager sees, rolls
   back and closes out.
2. **A `data_issues` row was filed for a bridge/decision contradiction and then immediately
   rolled back** with the rest of the transaction — a promise the importer could not keep. The
   audit trail is now the **failed `import_batches` row**, whose `error` column carries the
   message and is committed by `import_batch` *after* the rollback.

### 77.4 Remaining validation — DB-backed, awaiting the user

`tests/integration/draftguru-import.test.ts` is written but **not executed**: it writes to
`afldb_test` and is therefore user-run. It holds the shared draft advisory lock, and **skips
with an explicit reason** rather than failing when its prerequisites are absent (psycopg, the
gitignored Stage A snapshot, or reference data loaded).

**Known prerequisite gap:** per `IssuesIndex.md`, `afldb_test` currently has migrations and
privileges only — **no reference data and no fitzRoy core import have been run against it**.
The suite therefore has a first assertion that fails with the exact remedy
(`python tools/migration/load_reference_data.py`), and it **provisions the three AFL Tables
players the real tracked ledger names itself** — created only when absent, and removed
afterwards — so it does not depend on a completed fitzRoy import. It never fabricates the six
ledger values; it reads the real tracked ledger.

Proofs covered: Stage A population (5,057 / 6,810) · one DraftGuru external identity per person
with the convergence pair intact · explicit `afltables` decisions resolved to the existing
canonical player · exactly one minimal seed per `draftguru` decision with no DOB/weight/notes/
height and **no career-stats row** · `confirmed_unlinked` genuinely unlinked · no automatic
fallback without a bridge · frozen column contracts (`signing_detail`/`weight_kg`/`grade` all
zero; Brisbane 422/422 NULL; VFL 604 / AFL 6,206) · `name_key` differing from
`afldb_normalise_name` where the two rules disagree · idempotent rerun with stable ids and no
second seed · an admin-created pick surviving the reload · an admissible bridge linking at
`'unique'` with the bridge match method · and a contradicting bridge halting with the human
decision intact.

### 77.5 DB-BACKED VALIDATION — RUN AND GREEN

`npx vitest run tests/integration/draftguru-import.test.ts` → **Test Files 1 passed, Tests
13 passed / 13**, against `afldb_test`.

All thirteen behavioural proofs hold: prerequisite/reference check · accepted Stage A
population (5,057 / 6,810) · one DraftGuru external identity per person with the convergence
pair intact · explicit `afltables` targets resolved to the existing canonical player · exactly
one minimal `draftguru` seed each with no private metadata and no career-stats row ·
`confirmed_unlinked` genuinely unlinked · no automatic fallback without a bridge · frozen
column contracts (`signing_detail`/`weight_kg`/`grade` all zero, Brisbane 422/422 NULL,
VFL 604 / AFL 6,206) · frozen `name_key` rule · identical-input idempotence with stable row
ids and no second seed · admin-created pick untouched · admissible bridge linking at
`'unique'` · contradicting bridge halting and rolling back with the human decision intact.

### 77.6 Teardown defect found and repaired (test fixture only)

The first run passed all 13 tests and then **failed during file teardown**:

```text
PostgresError: update or delete on table "players" violates foreign key constraint
"draft_picks_player_id_fkey" on table "draft_picks"
```

**Root cause — three faults in the fixture teardown, none in the importer.** It tried to
`DELETE FROM draft_persons WHERE player_id = ANY(provisioned)`, which would have destroyed
**source-owned** rows this suite does not own and which failed anyway on
`draft_picks.draft_person_id` — silently swallowed by a blanket `.catch(() => undefined)`,
which is what hid the problem. It then deleted **all** `external_identities` for those players,
including the importer's own `draftguru` rows. Finally it deleted the players while 6,810
imported picks still carried `player_id` for the three ledger-linked persons. The comment
"only once nothing references it" was aspirational; nothing enforced it.

**Repair — release the references, do not destroy the rows.** A shared
`releaseAndDeletePlayers(ids)` helper, scoped strictly to the fixture player ids: null out
`draft_picks.player_id` and `draft_persons.player_id`, each paired with the `'unmatched'`
status its CHECK constraint requires; unlink (never delete) the importer's `draftguru` identity
rows; delete only the `afltables` identity rows this suite inserted; then delete the players.
The source-owned population is left intact and unlinked — exactly the state the next run
re-provisions from. Nothing is CASCADEd, no constraint is disabled, and the blanket `catch` is
gone so an unknown reference surfaces as a foreign-key error naming its table.

Two robustness fixes came with it: teardown is wrapped in `try/finally` so the session-held
draft advisory lock is released even if cleanup throws; and `beforeAll` now sweeps any fixture
player left behind by a previously failed run, identified by this suite's own
`b2-4-fixture-` slug marker and released the same ownership-safe way. That sweep was needed —
the failed run had orphaned three fixture players.

**No production importer code changed.**

### 77.7 Status

**B2-4/5 = COMPLETE.**

Every completion criterion is met: the replacement importer exists; the supported path has zero
`AFLDB_LEGACY_SQLITE` dependency; Stage A's 5,057 persons / 6,810 picks are represented; the
frozen event/signing/club contracts are enforced; the six explicit human decisions apply
correctly; the two DraftGuru seeds are deterministic and idempotent; `afltables` targets fail
closed when absent; `confirmed_unlinked` is represented correctly; the bridge interface exists
and is authority-lower than human decisions; Stage B1 was not promoted into a general import
source; source-ownership and link-preservation behaviour is retained; DB-free tests pass
(28 + 122); DB-backed validation is user-run green (13/13); and **no schema change was
required**.

**Not started:** Stage B3 acquisition, B2-7 `import_draft.py` retirement, B2-8 orchestrator
wiring, production deployment.

`ISSUE-093` remains **open**.

---

# PART VIII — STAGE B2-6 (test completion)

**Scope: complete the behavioural proof matrix. The importer was not redesigned.**

## 78. Coverage audit against the 18 completion gates

| # | Gate | Before B2-6 | Action |
|---:|---|---|---|
| 1 | 5,057 persons / 6,810 picks | **PROVEN** — `imports the accepted Stage A population` | none |
| 2 | exact explicit decisions | **PROVEN** — `applies every explicit afltables decision…` + seed + unlinked tests | none |
| 3 | minimal seeds | **PROVEN** — `creates exactly one minimal seed per draftguru decision, with nothing private` | none |
| 4 | `confirmed_unlinked` | **PROVEN** — `leaves the confirmed_unlinked person genuinely unlinked` | none |
| 5 | unmatched behaviour | **PROVEN** — `leaves every unbridged person unmatched — no automatic fallback` | none |
| 6 | admissible bridge | **PROVEN** — `links a person through an admissible bridge` (asserts `'unique'` + bridge match method) | none |
| 7 | bridge contradiction | **PROVEN** — `halts and rolls back when a bridge contradicts an explicit decision` (also satisfies B2-6 Gate 4; not duplicated) | none |
| 8 | missing `afltables` target HALT | **MISSING** | **test added** |
| 9 | ownership collision HALT | **MISSING**, and see §79.2 | **test added** |
| 10 | newer live human decision outranks baseline | **MISSING** | **test added** |
| 11 | identical-input idempotence | **PROVEN** — `is idempotent over identical inputs` | none |
| 12 | foreign/admin row preservation | **PROVEN but weak** — `does not touch an admin-created pick it does not own` used an *unrelated* row | **strengthened by the gate-9 test** |
| 13 | failed run leaves no partial mutation | **NOT PROVEN** — the contradiction test halts *before* any write | **test added** |
| 14 | failed `import_batches` audit survives rollback | **MISSING** | **test added** |
| 15 | importer subprocess hard-gated to `*_test` | **GAP — see §79.1** | **fixed + guarded** |
| 16 | ownership-safe cleanup | **PROVEN** — repaired in §77.6 | retained unchanged |
| 17 | no schema change | **PROVEN** — no migration exists | none |
| 18 | zero `AFLDB_LEGACY_SQLITE` | **PROVEN** — DB-free suite | none |

## 79. Findings

### 79.1 Test-safety gap in this suite — found by Gate 6, fixed before running anything

`tests/setup.ts` redirects **`DATABASE_URL`** to `afldb_test` and refuses any value not
matching `/_test$/`. It does **not** touch `AFLDB_IMPORT_DATABASE_URL`, and this repository's
`.env` sets that to **`afldb_dev`** (user `afldb_import`).

`tests/integration/draftguru-import.test.ts` overrode the variable **only in the `spawnSync`
environment**. That was sufficient while the suite spawned a subprocess and nothing more — but
Gate 3 requires a live admin decision through the production path, and `resolveLink` opens its
own connection from `process.env.AFLDB_IMPORT_DATABASE_URL` directly
(`src/db/queries/player-links.ts:481`). **An in-process admin mutation would therefore have
been written to `afldb_dev`.**

Fixed by adopting the established convention already used by
`awards-reload-links.test.ts:39`, `draft-reload-links.test.ts:50`,
`first-kick-goal-reload-links.test.ts:46` and `data-editor.test.ts:9` — a module-level
redirect — plus a `requireTestDsn()` helper that asserts the resolved database name ends in
`_test` before every importer spawn. Three layers now stand between this suite and
`afldb_dev`: `guard.ts` (set), `setup.ts` (`_test` suffix), `requireTestDsn()` (asserted at
use).

### 79.2 `refuse_out_of_scope_key=True` is structurally unreachable here

Traced through `common.reload_keyed:506-540`: the check joins incoming rows to existing ones
on **all** key columns — and `source_id` is one of them (migration 069) — then filters
`WHERE (e.source_id = ANY([draftguru])) IS NOT TRUE`. Any row the join can match already has
`source_id = draftguru`, so the predicate excludes it. **The check can never fire.**

That is not a defect: cross-ownership collision is prevented **structurally** instead.
`draft_picks_source_uq` is PARTIAL on `source_id IS NOT NULL`, so an admin row
(`source_id NULL`) sharing a natural key is outside both the unique index and this reload's
scope, and coexists by design.

**Production change: comment only.** The flag is retained as defence should the key ever
change, but the code now states why it cannot fire and names the test that proves the real
guarantee — asserting only its presence would have locked in a false sense of safety. The
DB-free test was changed accordingly, and the new integration test proves the actual boundary
with a **deliberate natural-key collision** rather than an unrelated admin row.

### 79.3 The "live decision contradicts the ledger" variant is unreachable through the
supported path

`resolveLockedLink` refuses a target that is already decided —
*"This target was already linked by another admin"* (`src/db/queries/player-links.ts:463`),
reached via `lockUnresolvedTarget`. A ledger-derived link leaves the pick
`link_status_value = 'resolved'`, so **an admin cannot contradict it through the admin UI at
all.**

Gate 3 is therefore proven in the shape production can actually produce: an admin links a
person the source leaves **unmatched**, and a later reload must not discard it. That is
precisely the ISSUE-078 invariant and it exercises the live-wins branch of the authority merge
(§73.5). The test also asserts the decision propagates to every pick of that person
(person-grained identity) and that removing it lets the source reassert `unmatched`.

### 79.4 Privilege verification — static, not runtime

`import_draftguru.py` reads `player_link_resolutions` as `afldb_import`
(`read_live_decisions`). That table is deliberately **outside**
`afldb_meta.import_writable_tables`, and `privileges.sql`'s reconciler REVOKEs everything not
in the registry — so this needed checking. **It is granted:** migration
`068_import_reads_link_resolutions.sql` grants `SELECT ON player_link_resolutions TO
afldb_import`, and `tools/maintenance/privileges.sql:302` mirrors it after the revoke loop.
**No defect, no privilege change required.**

**Stated limitation:** `AFLDB_TEST_DATABASE_URL` connects as **`afldb_owner`**, so this suite
does **not** prove the grant at runtime — a missing `afldb_import` grant would pass here and
fail in production. That is exactly **AFLDB-ISSUE-083**, which is tracked separately and
**deliberately not absorbed** into this work. §76's privilege conclusion should be read as
proven by registry inspection, not by execution.

## 80. Tests added

All four are in `tests/integration/draftguru-import.test.ts`, each with an ownership marker and
a scoped cleanup, and none removes source-owned population.

| Gate | Test | Proof |
|---|---|---|
| 8 | `missing afltables target › halts, creates no replacement player, and changes nothing` | isolates one fixture identity (`status='unmatched'`, `player_id=NULL` — no delete), runs the real importer, requires exit 1 and the refusal text, asserts `count(players)` is unchanged and the person's row is byte-identical, then restores **exactly** the captured `(status, player_id)` and proves a clean rerun |
| 9 / 12 | `ownership boundary › leaves an admin-owned row sharing a source row's natural key untouched` | inserts an admin-owned pick carrying a **real source row's** `(player_url, draft_year, draft_kind)`, runs the importer, and asserts it is not deleted, not adopted (`source_id` still NULL), not relinked — and that the source-owned twin still exists exactly once |
| 10 | `live human decision authority › preserves an admin link across a source reload` | creates a fixture `auth_users` row, links an unmatched person through the production `resolveLink`, reloads, and asserts the link survives with `link_status='resolved'` and propagates to every pick; then removes the decision and proves the source reasserts `unmatched` |
| 13 / 14 | `failed run: rollback and durable audit › rolls back partial source mutations and records a failed batch` | writes a sentinel into a source-owned pick, trips the ISSUE-092 population-drop gate (which fires in `reconcile_draftguru_identities`, **after both keyed reloads have written**), then asserts exit 1, the **sentinel survives** (the reload's UPDATE rolled back), the latest `import_batches` row is `failed` with an error, **no** batch is left `running`, and a rerun after cleanup repairs the sentinel and completes |

Gate 4 was **not** given a new test: the existing bridge-contradiction test already proves
automatic evidence cannot override explicit human state, asserting both the refusal message and
that the person's `player_id` is unchanged.

The static/offline contract checks were re-verified as already explicit and were **not**
duplicated: zero `AFLDB_LEGACY_SQLITE`, no CSV, no B1 profiling input, fail-closed
event/signing/club, `signing_detail` not imported, `grade`/`weight_kg` not promoted, names
never identity, frozen ledger vocabulary, bridge below human authority.

## 81. Files changed in B2-6

| File | Change |
|---|---|
| `tests/integration/draftguru-import.test.ts` | module-level import-DSN redirect + `requireTestDsn()` guard; four new gate tests; Gate 1 restore fixed to replay the captured identity rather than an arbitrary fixture player |
| `tests/draftguru-import.test.ts` | ownership assertion rewritten so it documents the unreachable check instead of implying protection |
| `tools/rebuild/draftguru/import_draftguru.py` | **comment only** (§79.2). No behaviour change. |

## 82. Validation

**DB-free, run and green:** `tests/draftguru-import.test.ts` **29/29** ·
`tests/draftguru-acquisition.test.ts` **122/122** (**151 total**) ·
`import_draftguru.py --validate-only` PASS · importer compiles.

**DB-backed: AWAITING USER EXECUTION** — `npx vitest run tests/integration/draftguru-import.test.ts`
(previously 13/13; now 17 tests).

## 83. Status

**B2-6 is AWAITING DB-BACKED VALIDATION.** Gates 1–7, 11, 16–18 are proven; 8, 9, 10, 13, 14
have tests written but not yet executed; 15 is fixed and guarded.

**Not started:** B2-7 `import_draft.py` retirement, B2-8 orchestrator wiring, Stage B3.
`ISSUE-093` remains **open**.

---

## 84. B2-6 FINAL VALIDATION — **B2-6 COMPLETE**

| Suite | Result |
|---|---|
| `tests/draftguru-import.test.ts` | **29 / 29** |
| `tests/draftguru-acquisition.test.ts` | **122 / 122** |
| `tests/integration/draftguru-import.test.ts` | **17 / 17** |

All 18 completion gates are proven, including the four tests added in B2-6 (missing afltables
target HALT, ownership boundary, live human decision authority, failed-run rollback + durable
`import_batches` audit) and the `*_test` hard gate. **B2-1 … B2-6 are CLOSED** and must not be
reopened without contradictory evidence.

---

# PART IX — STAGE B2-7 (retire the legacy draft importer)

## 85. Phase 1 — complete legacy-reference inventory

Repository-wide search for `import_draft.py`, `AFLDB_LEGACY_SQLITE` and `connect_legacy`.

### 85.1 `import_draft.py` — operational (non-markdown) references

| Reference | Class | Note |
|---|---|---|
| `tools/migration/import_draft.py` | **subject** | the legacy implementation itself |
| `tests/integration/draft-reload-links.test.ts:80` | **C — active test of supported behaviour** | spawns the legacy importer; guarded by `AFLDB_LEGACY_SQLITE` |
| `tools/rebuild/draftguru/import_draftguru.py:4,497` | F — descriptive comment | names it as the thing replaced / mirrored |
| `tools/rebuild/draftguru/export_link_decisions.py:93` | F — descriptive comment | cites its decision-selection SQL |
| `tools/rebuild/draftguru/b2_evidence.py:432` | F — descriptive comment | labels prior behaviour |
| `tools/rebuild/draftguru/draftguru-contract.json:183` | F — descriptive | names its alias fallback as a **forbidden** mechanism |
| `src/db/migrations/022:17,82` · `041:110` | **D — migration history** | permanent schema commentary; must not be rewritten |

**No `package.json` script, no `deploy/` script, no `tools/maintenance/` script and no CI
workflow invokes it.** Verified by direct inspection of all 18 npm scripts and by grep over
`deploy/`, `tools/maintenance/` and `.github/`.

### 85.2 `import_draft.py` — documentation

| Reference | Class | Disposition |
|---|---|---|
| `docs/deployment.md:155` — "Data refresh" runnable block | **B — ACTIVE operator doc** | must be updated |
| `docs/production-cutover.md:160` — production load sequence | **B — ACTIVE operator doc** | must be updated |
| `docs/migration-report.md:21,235` | **D/E — dated historical report** (2026-08-15), already self-labelled *"a dated result, not the current loader inventory"* | record preserved; a pointer to the replacement added |
| `issues.md`, `CHANGELOG.md`, `AFLDB-ISSUE-0**.md` | **E — historical record** | **left exactly as written** |

### 85.3 `AFLDB_LEGACY_SQLITE` consumers — **category G, all retained**

DraftGuru is **not** the last consumer. These are unrelated, still-unmigrated paths and are
**out of B2-7's scope**:

| Consumer | Domain |
|---|---|
| `tools/migration/import_legacy_afl.py:1021,1024` | legacy core import |
| `tools/migration/import_awards.py:1353,1361` | awards / honours |
| `tools/migration/enrich_birth_dates.py:406` | DOB enrichment |
| `tools/validation/validate_migration.py:340` | legacy→PG parity validation (verified: **contains no draft check at all**) |
| `tools/migration/common.py:71-73` | the shared `connect_legacy()` helper |
| `.env.example:192` · `tools/maintenance/00_install_postgres.sh:158` · `00_install_postgres_prod.sh:262` | environment/config |
| `tests/integration/awards-reload-links.test.ts:54` · `tests/integration/dob-enrichment-issues.test.ts:234` | tests of the above |

**Therefore the B2-7 claim is narrow and stays narrow:** *the supported DraftGuru
rebuild/import no longer depends on `AFLDB_LEGACY_SQLITE` or `tools/migration/import_draft.py`.*
**No claim is made that the repository as a whole is free of `AFLDB_LEGACY_SQLITE`, because it
is not.** The variable stays in `.env.example`, environment validation, docs and deployment
configuration.

## 86. Phase 2 — retirement mechanism: **Option B, tombstone**

**Chosen on the callers, not aesthetics.**

Deletion (Option A) was rejected for one concrete reason: two **active** operator documents
still print `python tools/migration/import_draft.py` as a runnable step, and an operator with
an old shell history or an old checkout could run it against the **rebuilt** database. That is
not a no-op — it would:

* read draft facts from legacy SQLite and reload `draft_persons` / `draft_picks` scoped to
  `source_id = draftguru`, **replacing the accepted Stage A-derived population**; and
* resolve links through `players.legacy_player_id`, a column `import_fitzroy_core.py` **never
  populates** on a fresh build — so every link would be wiped.

A deterministic fail-fast is therefore strictly safer than either silent execution *or*
`File Not Found`. Option C was rejected because it would leave an ambiguous second production
implementation of the same reload.

The tombstone performs **no** database mutation, **no** legacy SQLite read, names the
replacement, and exits non-zero. **The legacy implementation is not retained behind it.**
Verified: `python tools/migration/import_draft.py` → exit **2**, message naming the
replacement.

## 87. Phase 3 — the legacy test, and a production defect it exposed

`tests/integration/draft-reload-links.test.ts` was the ISSUE-078 regression harness and the
only active caller of the legacy importer. Mapping its seven assertions onto the replacement
suite (Phase 7) exposed **two genuine gaps**, one of which is a production defect.

### 87.1 DEFECT — contradictory live decisions were resolved silently, not refused

**Failing behaviour first.** `import_draft.py`'s `classify_decisions()` HALTs when two picks
of one person carry disagreeing decisions, and §16 froze that rule: *"two picks of one person
carrying contradictory decisions always HALT — `--allow-link-loss` does not apply."*

`import_draftguru.py`'s `read_live_decisions()` selected the operative decision per **pick**,
then keyed the result by `player_url` — so for a person whose picks disagreed, **whichever row
came last in iteration order silently won.** Identity is person-grained (migration 019), so
that lets one pick's decision override another's: exactly the failure the frozen rule forbids.

**Root cause:** the per-pick → per-person reduction had no conflict check.

**Bounded repair** (`read_live_decisions`, ~15 lines): group the operative decisions by person
and raise `ImportFailure` when any person's picks disagree on action or on `player_id`, naming
up to five and writing nothing. No identity, authority or schema decision changed.

**Proof:** new integration test *"halts when one person carries contradictory decisions across
two picks"* — writes the contradiction directly (the admin UI refuses to create it, so the
importer must not assume the audit trail is self-consistent), requires exit 1, and asserts the
person is untouched.

### 87.2 GAP — a live `confirmed_unlinked` surviving a reload was untested

The importer handled it; nothing proved it. Covered by extending the existing live-decision
test to apply a link **and** a veto to two different persons before **one** reload — no extra
6,810-row import.

### 87.3 Retirement

`tests/integration/draft-reload-links.test.ts` was **deleted**. Its subject was the legacy
importer, it could only run when `AFLDB_LEGACY_SQLITE` was present, and every invariant it held
is now carried against the supported importer (§89). Stale references in `draft-lock.ts`,
`email-intake.test.ts`, `first-kick-goal-reload-links.test.ts` and `release-gates.test.ts` were
repointed to the successor suite; `IssuesIndex.md`'s ISSUE-083 key-file list was corrected the
same way, with a note that the successor carries the identical owner-DSN gap.

## 88. Phase 4/5 — documentation and environment

| File | Class | Change |
|---|---|---|
| `docs/deployment.md:155` | B — active | now runs `tools/rebuild/draftguru/import_draftguru.py`, with a paragraph naming `--validate-only` / `--dry-run` and stating the legacy command is retired |
| `docs/production-cutover.md:160` | B — active | production load step now runs the supported importer |
| `docs/migration-report.md` | D/E — dated 2026-08-15 report | **record preserved**; a blockquote marks the reproduce-block historical and names the replacement, and the loader-inventory note records the retirement |
| `issues.md`, `CHANGELOG.md`, ISSUE-078/079/080/084/087/090 runbooks | E — history | **untouched**, deliberately |

**Environment: `AFLDB_LEGACY_SQLITE` is retained everywhere.** DraftGuru is **not** its last
consumer (§85.3), so it stays in `.env.example`, both bootstrap scripts, environment validation
and documentation. **No global removal is proposed or performed.**

## 89. Phase 7 — replacement proof for every legacy invariant

| Legacy guarantee | Replacement proof |
|---|---|
| 5,057 persons | `integration › imports the accepted Stage A population` |
| 6,810 picks | same |
| migration-069 stable **person** identity | `is idempotent over identical inputs` (row ids compared before/after) |
| migration-069 stable **pick** identity | same, plus Phase A's duplicate-reload-key assertion |
| manual link preservation | `live human decision authority › preserves an admin link across a source reload` |
| `confirmed_unlinked` | ledger case: `leaves the confirmed_unlinked person genuinely unlinked`; **live** case: the veto half of the live-decision test (§87.2) |
| contradictory decisions refused | **new** `halts when one person carries contradictory decisions across two picks` (§87.1) |
| decision lost when the source drops the key | `apply_authority` HALTs — *"an explicit decision names a DraftGuru person the accepted snapshot no longer carries"*; covers ledger and live decisions alike |
| source ownership | `ownership boundary › leaves an admin-owned row sharing a source row's natural key untouched` — a deliberate natural-key collision, stronger than the legacy unrelated-row test |
| foreign/admin row preservation | same test, plus `does not touch an admin-created pick it does not own` |
| idempotence | `is idempotent over identical inputs` |
| explicit human decisions | the three afltables + two draftguru + one unlinked ledger tests |
| club / event / signing semantics | `enforces the frozen column contracts` (Brisbane 422/422 NULL, VFL 604 / AFL 6,206, `signing_detail`/`weight_kg`/`grade` zero) + the DB-free contract suite |
| the disagreement **warning** when the source names another player | Not reproduced: the legacy warning came from `reload_keyed`'s decision machinery, which the supported importer does not use (`link_columns=None`). The supported importer instead warns when a **live** decision overrides the tracked ledger. **Stated behavioural difference, not a lost invariant** — no link is silently changed in either design. |

## 90. Phase 6 — static retirement guarantees

Seven new tests in `tests/draftguru-import.test.ts`, under `legacy draft importer retirement`:
the tombstone cannot import (no `connect_legacy`, no `require_env("AFLDB_LEGACY_SQLITE")`, no
`sqlite3`, no `psycopg`/`reload_keyed`/`import_batch`, no `subprocess`/`exec`/`runpy`); it
exits non-zero and names the replacement without delegating; the legacy implementation is not
hidden behind it; **it actually fails when invoked** (spawn test); supported operator docs no
longer print it as a command and do name the replacement; the canonical importer still exists;
and no active DraftGuru suite spawns it, with the retired suite confirmed absent.

As with the importer, absence assertions run against the source **with the module docstring
removed**, and the `AFLDB_LEGACY_SQLITE` check is on the **use** forms rather than the mention —
the tombstone's operator message legitimately says "zero AFLDB_LEGACY_SQLITE dependency". This
follows the precedent already set at `tests/reference-data.test.ts:191-195`.

## 91. Validation

**DB-free, run and green:** `tests/draftguru-import.test.ts` **36/36** ·
`tests/draftguru-acquisition.test.ts` **122/122** (**158 total**) ·
`import_draftguru.py --validate-only` PASS · tombstone exits **2** · both files compile.

**DB-backed: RERUN REQUIRED.** B2-7 changed production behaviour (§87.1) and added two
integration assertions, so `tests/integration/draftguru-import.test.ts` must be re-run:
previously 17 tests, now **18**.

## 92. Status

**B2-7 is AWAITING DB-BACKED REVALIDATION.**

Narrow claim, proven: *the supported DraftGuru rebuild/import no longer depends on
`AFLDB_LEGACY_SQLITE` or `tools/migration/import_draft.py`.* **No broader claim is made** —
`AFLDB_LEGACY_SQLITE` remains legitimately required by `import_legacy_afl.py`,
`import_awards.py`, `enrich_birth_dates.py` and `validate_migration.py`.

**Not started:** B2-8 orchestrator wiring, Stage B3. `ISSUE-093` remains **open**.

---

## 93. B2-7 FINAL VALIDATION — **B2-7 COMPLETE**

`npx vitest run tests/integration/draftguru-import.test.ts` → **Test Files 1 passed, Tests
18 passed / 18**. The new *"halts when one person carries contradictory decisions across two
picks"* passed, proving the §87.1 `read_live_decisions()` repair.

**B2-1 … B2-7 are CLOSED.**

---

# PART X — STAGE B2-8 (orchestrator wiring) — **HALTED**

## 94. Phase 1 — the current orchestration graph

Established by repository-wide search: every `*.sh` / `*.ps1` / `*.mjs`, `package.json`'s 18
scripts, `deploy/`, `tools/maintenance/`, and every caller of `load_reference_data.py`,
`import_fitzroy_core.py`, `rebuild_derived.py` and `import_draftguru.py`.

### 94.1 Supported rebuild stages (class A)

| # | Stage | Command | Entry point | Credential | Writes DB | Legacy SQLite |
|---|---|---|---|---|---|---|
| 1 | schema / migrations | `AFLDB_MIGRATE_TARGET=test npm run db:migrate:test` → `tools/db/migrate.ts` | **package.json script** | `AFLDB_TEST_DATABASE_URL` via `migrate.ts`'s explicit target map (`dev`→owner, `test`, `prod`; unknown target refused) | yes (DDL) | no |
| 1b | privileges | `npm run db:privileges:test` → `psql -f tools/maintenance/privileges.sql` | **package.json script** | `AFLDB_TEST_DATABASE_URL` | yes (GRANT/REVOKE) | no |
| 2 | tracked reference data | `python tools/migration/load_reference_data.py` | **none — manual command** | `AFLDB_IMPORT_DATABASE_URL` | yes | no |
| 3 | fitzRoy / AFL Tables core | `python tools/migration/import_fitzroy_core.py --label <label>` | **none — manual command** | `AFLDB_IMPORT_DATABASE_URL` | yes | no |
| 4 | **DraftGuru** | `python tools/rebuild/draftguru/import_draftguru.py` | **none — manual command** | `AFLDB_IMPORT_DATABASE_URL` | yes | **no** |
| 5 | derived summaries | `python tools/migration/rebuild_derived.py` | **none — manual command** | `AFLDB_IMPORT_DATABASE_URL` | yes | no |

**Stage dependencies:** 1 → 1b → 2 → 3 → 4 → 5. Stage 2's cascade guard makes it
non-rerunnable once core data exists (core-import handoff §11), and stage 4 depends on stage 3
for the three explicit AFL Tables identities.

### 94.2 Other references

| Item | Class | Note |
|---|---|---|
| `docs/deployment.md` §7 "Data refresh" | **C — operator helper** | the **legacy dev refresh**, not the clean rebuild: `import_legacy_afl.py` → `enrich_birth_dates.py` → `import_draftguru.py` → `import_awards.py` → `rebuild_derived.py` → `validate_migration.py`. Only the DraftGuru step is migrated; the rest are class E. |
| `docs/production-cutover.md` | **C — operator helper** | production load sequence, same mixed state |
| `tools/maintenance/00_install_postgres*.sh`, `01_setup_service.sh`, `02_add_auth_role.sh` | **C** | host/role/service bootstrap, no data stages |
| `tools/maintenance/restore-test.sh`, `backup.sh` | **C** | backup/restore validation |
| `tools/migration/import_legacy_afl.py`, `import_awards.py`, `enrich_birth_dates.py`, `tools/validation/validate_migration.py` | **E** | still legitimately use `AFLDB_LEGACY_SQLITE` — **not DraftGuru, not in scope** |
| `tools/migration/import_draft.py` | **D — retired** | B2-7 tombstone, exit 2 |

### 94.3 The decisive finding

**There is no rebuild orchestrator, and no script chains stages 2–5.** `docs/` does not mention
`load_reference_data.py` or `import_fitzroy_core.py` **at all** — the supported clean-rebuild
sequence exists only as prose in the ISSUE-093 handoffs.

`AFLDB-ISSUE-093.md` **§10 specifies** the intended entry point — `npm run db:test:rebuild` —
and states in its own heading that it is **"not implemented yet"**. §10 also puts *"Building the
`db:test:rebuild` orchestrator script itself"* explicitly out of that document's scope.

## 95. HALT — stop condition met

> *"HALT if: there is no single identifiable supported rebuild entry point."*

There is **nothing to wire DraftGuru into**. Building `db:test:rebuild` is not a wiring change:
§10 requires it to carry a substantial, **non-DraftGuru-specific** safety contract —

1. explicit named-target map, refusing anything unrecognised (`migrate.ts` pattern);
2. destination-must-equal-known-safe-name (`restore-test.sh` pattern);
3. refuse every target except `afldb_test`, rejecting `afldb_prod` and `afldb_dev` **by name**;
4. full preflight **before** any destructive acknowledgement or database contact;
5. an explicit **destructive-acknowledgement flag before any drop/reset of `afldb_test`**;
6. apply the complete tracked migration set via `tools/db/migrate.ts`, with no hard-coded
   terminal migration number;
7. fixed dependency order, failing closed on a missing source;
8. per-domain source fingerprints and row counts;
9. never reference `AFLDB_LEGACY_SQLITE`.

Requirement 5 alone means **destructive database recreation**, which the B2-8 brief separately
forbids me from performing and which is owned by ISSUE-093's broader rebuild scope, not
Stage B2. Writing it here would also breach *"Do not create another competing rebuild path"* if
`db:test:rebuild` is later built to §10's own design.

**Nothing was changed for B2-8.** No orchestrator was created, no script was added, no
speculative test asserting the behaviour of a non-existent orchestrator was written.

## 96. What is already satisfied without an orchestrator

Three of B2-8's DraftGuru-specific requirements are **already met by the importer itself**, and
would remain true under any orchestrator:

| Requirement | Already proven |
|---|---|
| **Restricted credential** | All four data stages already resolve `AFLDB_IMPORT_DATABASE_URL` and nothing else. **No owner substitution exists anywhere in the data path** — so the Phase 4 stop condition is *not* met. Pinned by `tests/draftguru-import.test.ts` → *"connects as afldb_import, never as owner"*. |
| **fitzRoy-before-DraftGuru** | Enforced by the importer, not merely by running order: a ledger `afltables` target that does not resolve to exactly one existing player **HALTs**, and the importer never invents a replacement. Proven by `tests/integration/draftguru-import.test.ts` → *"missing afltables target › halts, creates no replacement player, and changes nothing"*. An orchestrator that ran DraftGuru first would fail closed rather than corrupt. |
| **Zero legacy dependency for DraftGuru** | `tests/draftguru-import.test.ts` → *"has zero AFLDB_LEGACY_SQLITE dependency"*, *"never reads the frozen browser-export CSV parity oracle"*, *"never consumes Stage B1 profiling output as a bridge source"*, plus the seven B2-7 retirement tests. |

**Stage B3 remains cleanly optional:** the importer runs with **no** `--bridge` by default and
leaves unbridged persons `unmatched` — proven by *"leaves every unbridged person unmatched — no
automatic fallback"*. Absence of B3 data is not a B2-8 failure.

## 97. Phase 11 — guarded clean-`afldb_test` validation plan (PREPARED, NOT RUN)

Ordered, one stage per command. Every stage targets `afldb_test` only; `afldb_dev` is never
touched and the preserved `afldb_test_pre_rebuild_20260825` is never a source.

| # | Stage | Command |
|---|---|---|
| 1 | schema/migration | `AFLDB_MIGRATE_TARGET=test npm run db:migrate:test` |
| 1b | privileges | `npm run db:privileges:test` |
| 2 | reference load | `AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_DATABASE_URL" .venv/Scripts/python.exe tools/migration/load_reference_data.py` |
| 3 | fitzRoy core | `AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_DATABASE_URL" .venv/Scripts/python.exe tools/migration/import_fitzroy_core.py --label <accepted-label>` |
| 4a | DraftGuru preflight | `.venv/Scripts/python.exe tools/rebuild/draftguru/import_draftguru.py --validate-only` *(no database)* |
| 4b | DraftGuru import | `AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_DATABASE_URL" .venv/Scripts/python.exe tools/rebuild/draftguru/import_draftguru.py` |
| 5 | derived | `AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_DATABASE_URL" .venv/Scripts/python.exe tools/migration/rebuild_derived.py` |

**Caveats, stated rather than assumed:** stage 2 is *not* safely rerunnable once core data
exists (its cascade guard refuses; core-import handoff §11), so this sequence assumes a
freshly-migrated `afldb_test`. **Recreating that database is destructive and is deliberately
outside this stage.** Stage 3's `--label` must be an accepted fitzRoy manifest label; the only
one tracked today is `trial-2024`, which is a **trial** snapshot, not a full-history
acquisition — so a complete clean rebuild is additionally gated on fitzRoy full-history
acquisition, which is not an ISSUE-093 Stage B2 deliverable.

## 98. Recommendation — the smallest next step, for the user to authorise

Build `npm run db:test:rebuild` to `AFLDB-ISSUE-093.md` §10's existing contract as its **own
bounded stage**, because it is a rebuild-wide concern (destructive `afldb_test` recreation,
target refusal, preflight, fingerprints) of which DraftGuru is one phase. Wiring DraftGuru into
it is then a three-line addition between the fitzRoy and derived phases, and §96 shows every
DraftGuru-specific guarantee is already in place and independently tested.

## 99. Status

**B2-8 is HALTED — blocked, not failed.** The blocker is stated exactly in §95: no supported
rebuild entry point exists to wire into, and creating one requires destructive-recreation
semantics outside this stage's authority.

**Not started:** Stage B3. `ISSUE-093` remains **open**.

---

# PART XI — B2-8 ORCHESTRATOR — IMPLEMENTED / AWAITING CLEAN-DB VALIDATION

The §95 HALT is lifted: the user authorised building the rebuild-wide orchestrator, including
its destructive semantics. **No destructive operation was executed.**

## 100. First gate — the two questions, answered from repository evidence

### 100.1 What is authorised to drop/create `afldb_test`? — **nothing in the DSN model**

`afldb_test` is created **once, at host bootstrap**, by `sudo -u postgres createdb -O
afldb_owner` (`tools/maintenance/00_install_postgres.sh:88`). **No DSN in `.env` — owner
included — can `CREATE`/`DROP DATABASE`.**

§10's own cited pattern, `tools/maintenance/restore-test.sh`, does **not** drop or create
either: it refuses unless the DSN names the exact safe target (`:65-67`), requires the database
to already exist (`:91-93`), then **clears it in place** (`:104-118`) by dropping every table
`CASCADE` — deliberately *not* `DROP SCHEMA public CASCADE`, because *"pg_trgm and unaccent
live in public and are owned by another role"*.

**Resolution:** "DATABASE RECREATE" is implemented as an **in-place RESET over the existing
test DSN**, satisfying §10's *"drop/**reset**"* wording. It goes further than
`restore-test.sh` — non-public schemas, tables, views/matviews, routines and types, all
`CASCADE` — because the migrations must re-run from nothing, while keeping the same
extension-preserving discipline (objects with `pg_depend.deptype = 'e'` are skipped). It is
**not** a truncation: `RESET_SQL` contains no `TRUNCATE`, asserted by test.

### 100.2 Canonical full-history fitzRoy contract — **DOES NOT EXIST**

`tools/rebuild/fitzroy/fitzroy-contract.json` carries only `$comment`, `contract_version`,
`datasets`, `pinned_version`, `pinned_version_evidence` — **no label policy, no scope or
coverage contract, no full-history definition**. The single tracked manifest,
`trial-2024.json`, declares `mode: "acquire"` (the adapter's run mode, not scope) and no
`full_history`, `seasons` or `identity_complete` field.

**No criterion was invented.** The gate requires the manifest to declare `full_history: true`
**and** the label not to be a known trial; otherwise it refuses, **naming the missing
contract**. `--acknowledge-partial-fitzroy` is the explicit, logged opt-in (the
`--acknowledge-population-drop` idiom), and `trial-2024` can **never** satisfy full-history
mode even if a manifest claimed it — both asserted by test.

**Consequence: a genuine full-history clean rebuild is blocked on fitzRoy full-history
acquisition and its contract, neither of which is a Stage B2 deliverable.**

## 101. Stage graph, credentials and failure semantics

| # | Stage | Kind | Command | Credential |
|---|---|---|---|---|
| 1 | PRECHECK | precheck | in-process | **none — no database contact** |
| 2 | DATABASE RESET | destructive | `RESET_SQL` | `AFLDB_TEST_DATABASE_URL` (owner) |
| 3 | MIGRATIONS | schema | `npm run db:migrate:test` | `AFLDB_TEST_DATABASE_URL` |
| 4 | PRIVILEGES | privileges | `npm run db:privileges:test` | `AFLDB_TEST_DATABASE_URL` |
| 5 | REFERENCE DATA | data | `load_reference_data.py` | **`AFLDB_TEST_IMPORT_DATABASE_URL`** |
| 6 | FITZROY CORE | data | `import_fitzroy_core.py --label <label>` | **`AFLDB_TEST_IMPORT_DATABASE_URL`** |
| 7 | **DRAFTGURU** | data | `tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826` | **`AFLDB_TEST_IMPORT_DATABASE_URL`** |
| 8 | DERIVED | data | `rebuild_derived.py` | **`AFLDB_TEST_IMPORT_DATABASE_URL`** |
| 9 | FINGERPRINTS | validation | in-process | `AFLDB_TEST_DATABASE_URL` |

**Credential boundary.** Every data stage receives `AFLDB_IMPORT_DATABASE_URL` as an
**explicit child-process overlay** set to the test import DSN. The runner **fails closed**
when `AFLDB_TEST_IMPORT_DATABASE_URL` is absent rather than substituting owner access, and
**never inherits** the development value (`.env` sets it to `afldb_dev`) — asserted by test.
`--allow-owner-import-dsn` is the explicit escape and prints a warning naming ISSUE-083.

**Failure semantics.** `executeRebuild` returns at the **first** non-zero stage; there is no
catch-and-continue and no swallowed exit code. Six ordering proofs assert that migration,
privilege, reference, fitzRoy, DraftGuru and derived failures each leave every later stage
unexecuted — in particular **fitzRoy failure means DraftGuru never runs**, and **DraftGuru
failure means derived and the success report never run**.

**Preflight before destruction.** `runPreflight` checks the three tracked DraftGuru inputs and
runs `import_draftguru.py --validate-only`, asserting **42 sha256-verified year pages, 5,057
persons, 6,810 picks**, all before `--acknowledge-destroy` is consumed. A missing input or a
wrong count refuses while the database is still intact.

**DraftGuru wiring.** Exactly one DraftGuru phase, invoking only
`tools/rebuild/draftguru/import_draftguru.py`, placed after fitzRoy because three tracked
explicit decisions target canonical AFL Tables identities. `import_draft.py` appears nowhere in
the plan, and no stage carries `AFLDB_LEGACY_SQLITE`. **Stage B3 stays optional**: no bridge
file is required or referenced.

## 102. Files changed

| File | Change |
|---|---|
| `tools/db/rebuild-test.ts` | **new** — the orchestrator; safety, planning and execution are pure or dependency-injected |
| `tests/db-test-rebuild.test.ts` | **new** — 41 DB-free tests |
| `package.json` | **new script** `db:test:rebuild` → `tsx tools/db/rebuild-test.ts` |
| `docs/deployment.md` | **new §6a** — canonical clean test rebuild: destructive semantics, preflight-before-destruction, per-stage credentials, full-history requirement, DraftGuru Stage A source, no legacy dependency |
| `docs/production-cutover.md` | note distinguishing the legacy load from the canonical rebuild; states there is deliberately **no** production rebuild entry point |

## 103. Validation

**DB-free, run and green: 199/199** — `db-test-rebuild` **41/41**, `draftguru-import`
**36/36**, `draftguru-acquisition` **122/122**.

The CLI was exercised in `--plan` mode only (no database contact): the default run **refuses**
with the missing-restricted-credential message, and with explicit acknowledgements it prints
the nine stages in the fixed order.

**Not executed:** the orchestrator itself, any migration, any privilege reconcile, any
importer, and the reset SQL. **`RESET_SQL` has never been run** — its correctness against a
live schema is unproven and will first be exercised by the user's run.

## 104. Exact future destructive command

```bash
npm run db:test:rebuild -- --fitzroy-label <full-history-label> \
                           --acknowledge-destroy afldb_test
```

Blocked on three things, each fail-closed and each reported rather than worked around:
**(1)** no full-history fitzRoy snapshot or contract exists; **(2)**
`AFLDB_TEST_IMPORT_DATABASE_URL` is not defined in `.env`; **(3)** `afldb_test` must already
exist, since no credential can create it.

A non-destructive dry inspection is available now:

```bash
npm run db:test:rebuild -- --plan --fitzroy-label trial-2024 --acknowledge-partial-fitzroy --allow-owner-import-dsn
```

## 105. Status

**B2-8 orchestrator: IMPLEMENTED / AWAITING CLEAN-DB VALIDATION.** DraftGuru is wired
reference → fitzRoy → DraftGuru → derived. `ISSUE-093` is **not** resolved. Stage B3 remains
optional and **not started**.

---

# PART XII — FULL-HISTORY FITZROY CONTRACT + ACQUISITION TOOLING

Rebuild-wide blocker from §104(1). **Not** DraftGuru Stage B3, which remains untouched.

## 106. What "full history" means for AFLDB — derived, not remembered

| Question | Answer | Evidence |
|---|---|---|
| Earliest required season | **1897** | `data/reference/seasons.json` `first_season` |
| Latest required season | **2025** | `seasons.json` `last_season` (2026) minus `in_progress_seasons` ([2026]) — i.e. the latest **completed** season |
| Does the current season belong here? | **No — 2026 is excluded** | 2026 is declared in-progress and is owned by `npm run current-season:update` → `tools/current-season/update-current-season.ts` → `src/lib/external-afl/current-season-import`. Including it would give two writers one set of facts. |
| Is AFLW part of this stage? | **No** | Different source and pipeline entirely: `tools/aflw/parse_aflw.py` parses an **aflwstats.com** scrape into `staging_aflw` (migration 025), loaded by `tools/aflw/load_staging.py`. fitzRoy is not involved. |
| Which datasets | **`player_stats`, `player_details`, `results`** | the contract's own `datasets` block |
| Are results alone sufficient? | **No** | `import_fitzroy_core.py` builds `players` only from `player_stats`, and matches from `results` |
| Authoritative from tracked reference instead | seasons, clubs, venues canon, stat definitions/availability | `data/reference/*.json` via `load_reference_data.py` |

**Coverage matrix** (competition: VFL/AFL men's senior):

| Dataset | Seasons | Grain | Required | Completeness rule |
|---|---|---|---|---|
| `player_stats` | 1897–2025, one artefact per season | player-match | **yes** | exactly one file per required season; none outside the range; no duplicates; non-zero rows |
| `player_details` | whole-source, one call | player | **yes** | present, non-zero rows |
| `results` | 1897–2025, one call | match | **yes** | present, non-zero rows |

## 107. Source capability — the adapter already reaches full history

`tools/rebuild/fitzroy/acquire_core.R` already accepts `--from`/`--to` (defaulting `1897`),
writes **one CSV per season** for `player_stats` so long ranges are restartable, fetches
`player_details` and `results` once, refuses to overwrite an existing manifest label, and
**writes the manifest last**. **No second acquisition implementation was created and no
acquisition extension was needed.**

What it lacked was the *completeness contract*, which is what this stage adds.

**Unmeasured risk, stated rather than assumed:** the contract's `player_stats` probe covered
**season 2024 only**. Whether early-era rows carry the `url` column is **unverified**, and
`import_fitzroy_core.py:711-716` fails closed on any row without an ID or profile URL. The new
validator therefore measures identity coverage across every acquired season **before** any
import is attempted (§109).

## 108. Manifest contract and completeness gates

Added as `full_history` in `tools/rebuild/fitzroy/fitzroy-contract.json`: competition,
required datasets, season range **with its derivation rule**, the current-season and AFLW
exclusions with reasons, `approved_source_gaps` (**empty** — while empty, any missing season
is a failure, never an absence), per-season vs whole-range datasets, ten completeness gates,
the three completeness verdicts, known trial labels, and the identity requirement.

`acquire_core.R` now records measured facts — `seasons_requested`, `seasons_acquired`,
`intentional_gaps`, `missing_seasons`, `completeness_gates` — and **computes**
`completeness` and `full_history`. **`adapter_schema_version` stays 1**: every field is
additive, so `trial-2024` still validates unchanged (verified).

A snapshot is distinguishable as **A** trial/partial, **B** full history, or **C** failed
without opening the raw data: a failed acquisition writes no manifest at all.

## 109. Re-proving the claim — `--require-full-history`

`import_fitzroy_core.py --validate-only --require-full-history` re-derives every gate from the
contract and the artefacts, so a hand-edited flag, a renamed label or a partial acquisition
cannot pass: claim present · not a known trial label · `requested_range` equals the contract
range · required datasets present · every required season present · no duplicate season
artefact · nothing outside the range · no zero-row artefact · **identity coverage measured
across every player_stats row** (missing ID, missing URL, malformed URL, distinct counts).

Verified now: `trial-2024` still validates normally, and is **refused** under
`--require-full-history` with *"does not claim full history"*.

## 110. Orchestrator integration

`resolveFitzroySource` now requires **both** `full_history === true` **and**
`completeness === 'full_history'`, and still refuses known trial labels outright. The
orchestrator's PRECHECK runs `import_fitzroy_core.py --validate-only`, adding
`--require-full-history` when the snapshot claims it — so the claim is re-proved **before any
destruction**. `--acknowledge-partial-fitzroy` remains an explicit opt-in and is never the
default.

## 111. Files changed

| File | Change |
|---|---|
| `tools/rebuild/fitzroy/fitzroy-contract.json` | **new `full_history` block** |
| `tools/rebuild/fitzroy/acquire_core.R` | measured completeness accounting; computes `completeness`/`full_history`; manifest still written last (R parse-checked) |
| `tools/migration/import_fitzroy_core.py` | **new** `enforce_full_history()` + `--require-full-history`; additive, `trial-2024` unaffected |
| `tools/db/rebuild-test.ts` | two-field full-history rule; `fitzroyValidateArgv()`; fitzRoy preflight |
| `tests/db-test-rebuild.test.ts` | 54 tests |
| `tests/fitzroy-core-import.test.ts` | full-history gate refusals via synthetic fixtures; opt-in `withPlayerDetails` |

## 112. Tests — 265/265 DB-free

`db-test-rebuild` 54 · `fitzroy-core-import` 28 · `fitzroy-acquisition` · `draftguru-import` 36
· `draftguru-acquisition` 122 · `reference-data`.

**Stated limitation:** every Python-side full-history proof is a **refusal**. The positive path
is deliberately not faked — a passing snapshot needs all 129 seasons and their matching
results — so it is earned and measured by the real acquisition, not asserted by a fixture.

## 113. Acquisition command (NOT RUN)

```bash
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire \
  --label full-history-20260827 --from 1897 --to 2025 \
  --datasets player_stats,player_details,results
```

**Size:** 129 seasons → **131 fetches** (129 per-season `player_stats`, 1 `player_details`,
1 `results`) and **131 CSV artefacts**. Restartable under the same label until a manifest
exists. No PostgreSQL, no `AFLDB_LEGACY_SQLITE`.

Then, offline:

```bash
.venv/Scripts/python.exe tools/migration/import_fitzroy_core.py \
  --label full-history-20260827 --validate-only --require-full-history
```

## 114. Status

**CONTRACT + ACQUISITION TOOLING READY / AWAITING USER ACQUISITION.** Nothing is predeclared:
whether the snapshot earns `full_history: true` is decided by the measured manifest after the
run. **Stage B3 was not started.** `ISSUE-093` remains **open**.

---

# PART XIII — FULL-HISTORY ACQUISITION: MEASURED, VALIDATED, HALTED

## 115. Acquisition result

`full-history-20260827` — 1897–2025, **131 artefacts, 719,042 rows** (685,473 of them
`player_stats`). The manifest claimed `completeness: full_history`, `full_history: true`.

**Independent validation correctly REJECTED it:** *"identity incomplete: 83 row(s) without a
stable ID and 0 without a profile URL."* The validator did exactly what it was built to do.

## 116. Phase 1 — the 83 rows, measured

| Measure | Value |
|---|---|
| rows with a blank `ID` | **83** |
| seasons containing them | **2025 only** |
| distinct profile URLs among them | **5** |
| blank URLs | **0** |
| non-canonical URLs | **0** |
| rows per affected player | 2–25 (every one of the 5 contributes several) |
| any of those URLs seen elsewhere WITH an ID | **0** — the ID is missing for the whole player, not some rows |
| URLs carrying two different IDs | **0** (across all 685,473 rows) |
| IDs carrying two different URLs | **0** |
| distinct canonical URLs overall | 13,270 |
| `player_details` able to supply the ID | **No** — its columns are `Player, Team, Cap, #, HT, WT, Games, Wins, Draws, Losses, Goals, Seasons, Debut, Last, date_accessed`: **no `url`, no `ID`**, so it could only be joined by name, which is forbidden |

**The identity graph is perfectly self-consistent.** fitzRoy simply has no numeric id for five
2025 players.

## 117. Phase 2 — what identity the importer actually requires

| Question | Answer |
|---|---|
| Canonical durable identity | **The AFL Tables profile URL**, normalised to `players/A/Name.html` |
| Where it is stored | `external_identities(source=afltables, match_method=afltables_profile_url, external_id=<url>)` |
| Purpose of the fitzRoy `ID` | in-run grouping key, duplicate detection, insert ordering, error messages |
| Tables/keys depending on it | **none** |
| Is it persisted? | **No — `afl_id` never reaches a database column.** Players are resolved by `existing_by_url`, keyed `player_ids[url]`, and registered by URL |
| Can a row with URL and no ID import safely? | **Yes**, without names, fuzzy matching, legacy data or guessing |

The module docstring already said so: *"The fitzRoy numeric `ID` is used only as the in-run
grouping key and must map 1:1 to the URL."* The **validator**, not the schema, was
over-constrained.

## 118. Phase 3 — **OUTCOME B**: the profile URL is sufficient

Adopted on the schema semantics, not on the inconvenience of 83 rows. Requiring `ID` would
discard five real players and all their matches for a value the database never keeps.

Smallest correction, in `scan_player_stats`:

- **URL mandatory, `ID` optional.** A row without a URL still fails closed, and the message
  says a name is never identity.
- **Identity keyed on the URL**, so `players` is a `url -> PlayerFact` map.
- `pm_key` is now `(url_path, key)` — **strictly safer**: the old `(afl_id, key)` would have
  keyed two ID-less players in one match as `(None, key)`.
- Contradiction detection **retained in both directions**: a URL carrying two different IDs
  fails, and an ID appearing under two URLs fails (*"refusing to collapse two players"*).
- Deterministic ordering now sorts by `url` instead of `int(afl_id)`, which cannot be
  evaluated when the ID is absent.

`trial-2024` validates unchanged.

## 119. Phase 4 — root cause of the false `full_history: true`

The acquisition manifest recorded exactly **seven** gates —
`datasets_complete, seasons_complete, no_duplicate_seasons, no_seasons_outside_range,
all_rows_non_zero, version_pinned, requested_range_matches_contract`.

**Identity completeness was never among them.** The contract declares ten gates plus a
separate `identity_requirement`; `acquire_core.R` implemented a smaller set and then
adjudicated on it. **Two implementations of one contract drifted** — the exact failure mode
the single-source rule exists to prevent. The manifest did not even carry the measured
83-row count, so nothing could have gated on it.

**Fix — the acquirer no longer adjudicates.** It records measured facts, now including
identity coverage (`rows`, `rows_without_id`, `rows_without_url`, `seasons_with_missing_id`),
writes `completeness: "unvalidated"`, `full_history: false`, and names its adjudicator. The
validator is the single authority, and the orchestrator no longer consults the manifest's
claim in either direction — it always runs `--require-full-history` in full mode.
**A snapshot can no longer certify itself.**

## 120. Phase 5 — immutable snapshot handling

**No raw bytes were touched and no reacquisition is needed.** The 131 artefacts are sound;
only the *verdict* was wrong.

`full-history-20260827.json` is left exactly as written, including its false claim, as the
audit record of the defect. It is now inert: the manifest's `full_history` field is no longer
consulted by anything. The snapshot is revalidated in place by the corrected adjudicator, so
its acceptance depends on the artefacts alone. A future acquisition under the corrected
acquirer will publish `completeness: "unvalidated"` from the start.

## 121. NEW BLOCKER — measured, and not mine to decide

With the identity gates satisfied, the scan proceeds and stops on a **different** gap:

```
ERROR: club string 'Brisbane Lions' has no unambiguous identity for season 1987: era candidates []
```

Measured across the full results file (1,622 distinct club-string/season pairs):

| Club string | Seasons | Match-sides |
|---|---|---|
| `Brisbane Lions` | **1987–1996 (10)** | **222** |

**Every other club string in 129 seasons resolves.** fitzRoy labels the **Brisbane Bears**
era with the modern *Brisbane Lions* name, and `ClubResolver` correctly refuses: `clubs.json`
models them as **separate organizations** joined by a merger, and migration 017 states that
*"folding them into the Lions' record would invent a history the club does not have."*

**This is a club-lineage policy decision, not a defect to patch.** Accepting it would
attribute 222 Brisbane Bears match-sides — and every player-match row in them — to the
Brisbane Lions. It is the same merger boundary that made `brisbane` a fail-closed NULL in the
DraftGuru club mapping (§35.3). **HALTED for review rather than resolved by an era-scoped
alias I would be inventing.**

## 122. Files changed

| File | Change |
|---|---|
| `tools/migration/import_fitzroy_core.py` | Outcome B identity model; identity gate now URL-mandatory/ID-optional; manifest claim no longer consulted |
| `tools/rebuild/fitzroy/acquire_core.R` | stops adjudicating; measures identity coverage; `completeness: "unvalidated"` |
| `tools/db/rebuild-test.ts` | validator is the sole verdict; manifest flag ignored |
| `tests/fitzroy-core-import.test.ts` | identity-policy tests incl. missing-ID accepted, missing-URL refused, both contradiction directions |
| `tests/db-test-rebuild.test.ts` | acquirer-never-adjudicates and manifest-is-not-the-verdict |

**Line endings:** several files were converted LF→CRLF by a Python `write_text` round-trip on
Windows earlier in this session. All were restored to LF; no content was affected.

## 123. Tests

**265/265 DB-free.** Live: `trial-2024` unchanged; `full-history-20260827` now passes every
identity gate and stops on the club-era gap.

## 124. Status

**HALTED ON A SOURCE/REFERENCE GAP** — Brisbane Bears 1987–1996. Identity is resolved; the
full-history snapshot is **not yet accepted**. No PostgreSQL was touched and Stage B3 was not
started.

---

# PART XIV — fitzRoy SOURCE CLUB NORMALISATION (option a, approved)

## 125. Policy decision

**fitzRoy-specific, era-scoped SOURCE normalisation — not club identity collapse.**

fitzRoy emits the modern string `"Brisbane Lions"` for historical Brisbane Bears seasons.
AFLDB keeps the organizations distinct: a merger is not a rename (migration 017), so the
resolver's organization walk cannot bridge them and correctly failed closed. The correction
belongs to the **source**, not to the club model.

## 126. Where the rule lives, and why there

`tools/rebuild/fitzroy/fitzroy-contract.json` → **`source_club_normalisation`**, the contract
for this source. Deliberately **not** `clubs.json`: an alias there would make Bears and Lions
interchangeable everywhere in AFLDB, which is exactly what is forbidden.

```json
{ "raw": "Brisbane Lions", "first_season": 1987, "last_season": 1996,
  "resolves_to_hist": "Brisbane Bears" }
```

`ClubResolver` takes these rules as a second, optional argument and consults them **first**,
matching on an exact raw string inside an exact season range. They **never enter
`alias_to_hist`**, so no global equivalence is created. Anything not covered falls through to
the ordinary era resolution and still fails closed.

The resolver also **validates the tracked rule itself**: an unknown target identity, or a
season range outside that identity's own era, is refused at construction — a bad contract
cannot mis-resolve silently.

## 127. Measured result

| Measure | Before | After |
|---|---|---|
| distinct (club string, season) pairs | 1,622 | 1,622 |
| unresolved match-sides | **222** | **0** |
| `"Brisbane Lions"` → Brisbane **Bears** | — | **222** (1987–1996) |
| `"Brisbane Lions"` → Brisbane **Lions** | 677 | **677** (1997+) |

Spot checks: **1986 → still REFUSED** (neither club existed); 1987 → Bears; 1996 → Bears;
1997 → Lions; 2025 → Lions. **Nothing was discarded** — the 222 match-sides now resolve to
Bears, and player-match rows inherit that identity through the same resolver
(`clubs.resolve(row["Playing.for"], season)`).

## 128. Tests

`tests/fitzroy-core-import.test.ts`, new `fitzRoy source club normalisation` block: 1987 and
1996 → Bears; 1997 and 2024 → Lions; Bears/Lions remain distinct with `successor_hist: null`
on both and a `merged_into` relation; **no global alias** (only one identity answers to each
name, and no generic `Brisbane`/`brisbane` mapping exists); the rule is scoped to one string
and one range whose bounds sit inside the target's own era; an inconsistent tracked rule is
refused. The pre-existing merger-boundary test was **retargeted to 1986**, which is still
correctly refused, rather than deleted.

**273/273 DB-free** across all six suites.

## 129. NEXT BLOCKER — 1909 duplicate player-match rows

With clubs resolving, the scan proceeds and stops on a different, **pre-existing** source
contradiction:

```
ERROR: player_stats_1909.csv line 1710: duplicate player-match row for players/J/Jim_Stewart0.html
```

Measured: **exactly 2 occurrences, both in 1909**, both in the same match
(1909-07-03, St Kilda v Essendon, round 10). Two same-named St Kilda players
(`Jim_Stewart0`, `Jim_Stewart1`) each appear **twice**, and in both cases the two rows carry
the **same fitzRoy ID and identical match statistics** but **contradictory `Career.Games`
(68 vs 1)** and `Age`.

**This is not a regression from the URL-keyed identity change**: both rows share one fitzRoy
ID, so the previous `(afl_id, match)` key would have raised the same duplicate error.

**It cannot be deduplicated silently.** `Career.Games` **is imported** (`:1441`, into
`player_match_stats.career_game_no`) and is materially consumed — `import-first-kick-goal.ts`
matches on `pms.career_game_no = 1`. Choosing between 68 and 1 would be guessing which
player's career counter belongs to which row. **HALTED for a decision rather than resolved.**

## 130. Status

Club normalisation **COMPLETE and measured**. The full-history snapshot is **not yet
accepted**: it now clears identity and club resolution and stops on the 1909 duplicate pair.
No PostgreSQL was touched; Stage B3 not started.

---

# PART XV — 1909 JIM STEWART: SOURCE ROW CORRECTION

## 131. Audit — the whole snapshot, not just the duplicate pair

154 rows across the snapshot carry a `Jim_Stewart*` profile. Measured:

| Player | URL | fitzRoy ID | Appearances | Career games |
|---|---|---|---|---|
| older Jim Stewart | `players/J/Jim_Stewart0.html` | 5230 | 1905–1912 | 1 → 85, contiguous |
| younger Jim Stewart | `players/J/Jim_Stewart1.html` | 5685 | 1909 R10, 1909 R11, 1911 R5 | 1, 2, 3 |
| (two unrelated players) | `Jim_Stewart2/3` | 6354 / 8158 | 1915–1920, 1938–1941 | consistent |

**Exactly 2 rows are affected — both in 1909 Round 10 — and NO row anywhere needs
re-attribution.** The younger player's R11 and 1911 appearances already carry
`Jim_Stewart1` with ID 5685 and career games 2 and 3; the older player's 85 appearances
already carry `Jim_Stewart0` with ID 5230. **Both fitzRoy IDs are internally consistent with
their own careers, so no ID had to be discarded, nulled or invented.**

## 132. The upstream corruption

fitzRoy emitted the **cartesian product** of the two identities and the two biographies for
St Kilda v Essendon, Round 10, 1909 — 2 urls × 2 (Age, Career.Games) pairs = **4 rows where
AFL Tables has 2**:

| line | url | ID | Age | Career.Games | Goals | verdict |
|---:|---|---|---|---:|---:|---|
| 1709 | Jim_Stewart0 | 5230 | 25.2135523613963 | 68 | 2 | **genuine (older)** |
| 1710 | Jim_Stewart0 | 5230 | 20.6652977412731 | 1 | 2 | **spurious** |
| 1711 | Jim_Stewart1 | 5685 | 25.2135523613963 | 68 | 0 | **spurious** |
| 1712 | Jim_Stewart1 | 5685 | 20.6652977412731 | 1 | 0 | **genuine (younger)** |

The acquired ages match the AFL Tables authority to ten decimal places
(25y 78d = 25.2135523614, 20y 243d = 20.6652977413). In the spurious rows the **statistics
follow the URL correctly** and only the **biography is crossed**, so the two genuine rows
need no field repair — the match statistics were never copied between players.

**Correction: drop the two spurious rows.** No URL rewrite, no ID change, no merge, no
invention.

## 133. The tracked correction

`tools/rebuild/fitzroy/fitzroy-contract.json` → **`source_row_corrections`**. Each rule names
one dataset, one artefact, one exact field fingerprint (`Season, Round, Date, Home.team,
Away.team, url, ID, Age, Career.Games, Goals`), an `expect_rows` count, and its AFL Tables
authority. **No name field appears in any fingerprint.**

Applied in `iter_player_stats` — the single choke point all three passes share, so the scan
and both database passes see identical rows. A rule is **in scope only when its artefact is
part of the snapshot**, so a trial covering other seasons is unaffected. Every in-scope rule
must match **exactly** `expect_rows`, otherwise the import **fails visibly**: if a later
fitzRoy release fixes this upstream, the fingerprint stops matching and the run halts, telling
the operator to remove the rule deliberately rather than silently double-correcting or
silently doing nothing.

## 134. Tests — 280/280 DB-free

New `fitzRoy source row corrections` block: each rule is fingerprint-bound with an authority
and no name field; no name-based matching is introduced; the expected-count fail-closed exists;
neither rule rewrites a URL or ID, and the two canonical URLs stay distinct. Against the **real
snapshot**: after correction 1909 R10 holds exactly two Jim Stewart rows — older `Jim_Stewart0`
career game 68 / 2 goals / age 25.21355…, younger `Jim_Stewart1` career game 1 / 0 goals /
age 20.66529… — with distinct URLs and IDs; the younger player's R10 and R11 rows survive
untouched with ID 5685 and career games 1 and 2; and exactly **two** rows are removed from the
file.

A defect found and fixed in my own first implementation: the expected-count check initially
ran for rules whose artefact was absent, which refused every synthetic fixture. It is now
scoped to artefacts actually present.

## 135. NEXT BLOCKER — the two fitzRoy datasets disagree about club strings

```
ERROR: player_stats_1999.csv line 46: no results.csv match for 1999-03-26 Geelong v Kangaroos
```

Measured across the whole snapshot: **9,196 player_stats rows, 198 match combinations,
seasons 1999–2007** — the Kangaroos era, exactly.

| Dataset | strings used 1999–2007 |
|---|---|
| `player_stats` | **Kangaroos**, Western Bulldogs |
| `results` | **North Melbourne**, Footscray |

The Bulldogs pair converges correctly (`Footscray` in 1999 is outside Footscray's 1925–1996
era, so the org walk remaps it to Western Bulldogs). **North Melbourne does not**: `clubs.json`
gives it `first_season 1925, last_season null`, which *overlaps* the Kangaroos era 1999–2007,
so the era check passes and no remap happens — `results` resolves to North Melbourne while
`player_stats` resolves to Kangaroos, and the match join fails.

The club competed as the Kangaroos in those seasons and migration 017 models the lineage as
*North Melbourne (1925-) → Kangaroos (1999-2007) → North Melbourne*, so the era identity for
1999–2007 is **Kangaroos** and `results` is the dataset using a label from the wrong era.

**Not resolved here.** The already-approved `source_club_normalisation` mechanism fits this
case exactly — a rule mapping `"North Melbourne"` in 1999–2007 to `Kangaroos` — but that is a
new club and a new era decision, and extending an approved rule to a different club without
review is exactly what these gates exist to prevent.

## 136. Status

1909 correction **COMPLETE and validated against the real artefacts**. The full-history
snapshot now clears identity, club era resolution and the 1909 defect, and halts on the
1999–2007 dataset disagreement. No PostgreSQL; Stage B3 not started.

---

# PART XVI — KANGAROOS-ERA NORMALISATION + BLOCKER OWNERSHIP METHODOLOGY

## 137. Methodology now in force

For every remaining ISSUE-093 discrepancy, **classify ownership before proposing a change**:
**SOURCE DATA · SOURCE NORMALISATION · CANONICAL MODEL · IMPORT TRANSFORMATION · VALIDATOR.**
Never bend data to satisfy a validator constraint before establishing which layer owns it.

## 138. The measured disagreement

**9,196 player_stats rows across 198 (season, home, away) match combinations, seasons
1999–2007** could not join `results`.

| Dataset | strings used 1999–2007 |
|---|---|
| `player_stats` | **Kangaroos**, Western Bulldogs |
| `results` | **North Melbourne**, Footscray |

The Bulldogs pair needed no rule: Footscray's era ends 1996, so the ordinary organization
remap already converges both to Western Bulldogs. North Melbourne does not converge, because
`clubs.json` gives it `1925–null`, which **overlaps** the Kangaroos era — era containment
succeeds, so no remap is attempted.

**Ownership: SOURCE NORMALISATION.** The club competed as the Kangaroos in those seasons and
migration 017 models *North Melbourne (1925-) → Kangaroos (1999-2007) → North Melbourne*, so
`results` is the dataset carrying a label from the wrong era.

## 139. Dataset scope added to `source_club_normalisation`

A rule may now name a `dataset`. **Without one it applies to every dataset** — so the
validated Brisbane rule is untouched and still applies to both. **With one it applies only
there**, so a results correction can never rewrite a player_stats row carrying the same
string. The dataset is part of the resolver's cache key, so a results answer can never be
served to a player_stats lookup. Every call site now declares its dataset.

```json
{ "dataset": "results", "raw": "North Melbourne",
  "first_season": 1999, "last_season": 2007, "resolves_to_hist": "Kangaroos" }
```

**Fail-closed validation at construction:** target identity must exist; `dataset`, when
present, must be one of `player_stats`/`player_details`/`results`; the season range must sit
entirely inside the target identity's canonical era; and **two rules for one raw string whose
ranges overlap with compatible dataset scope are refused**. `clubs.json` and the canonical
eras are unchanged, and no alias was added.

## 140. Measured outcome

| | Before | After |
|---|---|---|
| player_stats rows failing to join | **9,196** | **0** of 685,473 |
| affected match combinations | 198 | **0** |

Spot checks — `results` 1999 → Kangaroos, 2007 → Kangaroos, 1998 → North Melbourne,
2008 → North Melbourne; `player_stats` "North Melbourne" → **North Melbourne in every
season tested**; `player_stats` "Kangaroos" → Kangaroos; Brisbane 1990 → Bears in **both**
datasets; Brisbane 1986 → still refused. **No match or row was discarded.**

## 141. Tests — 286/286 DB-free

New `dataset-scoped club normalisation` block exercising the **real** `ClubResolver` with the
**real** tracked rules: era boundaries on both sides; the results rule never touching
player_stats; the Brisbane rule still unscoped and still applying to both; the rule pinned to
one dataset/string/era matching the Kangaroos identity exactly; North Melbourne and Kangaroos
distinct with the rename chain intact and no global equivalence; and three invalid tracked
rules refused (era overrun, unknown dataset, unknown identity).

## 142. NEXT BLOCKER — blank `Player` for four 2025 players

```
ERROR: players/C/Charlie_Cameron3.html has no usable name
```

Measured: **79 rows across 4 players, all 2025** — `Charlie_Cameron3`, `Jack_Graham2`,
`Jack_Ross3`, `Jack_Williams3`. In every one, `First.name` and `Surname` are **present and
correct**; only the concatenated `Player` column is blank. These are the same recent-2025
players as the missing-ID finding (79 of those 83 rows).

**Ownership: IMPORT TRANSFORMATION** (with a SOURCE DATA contribution). The importer derives
`display_name` from the source's convenience column `Player` and fails when it is blank —
even though it already reads `First.name` and `Surname` separately and uses them for
`given_name`, `surname` and `sort_name`. The name is not missing from the source; only the
derived column is.

**Proposed, not applied:** fall back to `f"{First.name} {Surname}"` when `Player` is blank.
That uses data the importer already has, needs no external authority, involves no inference or
name matching, and changes nothing for the 685,394 rows that do carry `Player`. **Awaiting
approval.**

## 143. Status

Kangaroos normalisation **COMPLETE and measured**. The snapshot now clears identity, club era
resolution in both datasets, the 1909 correction and the full match join, and halts on the
blank-`Player` condition. No PostgreSQL; Stage B3 not started.

---

# PART XVII — BLANK `Player` FALLBACK · FULL-HISTORY SNAPSHOT VALIDATES

## 144. The condition

**79 player_stats rows, 4 players, all season 2025:** `Charlie_Cameron3`, `Jack_Graham2`,
`Jack_Ross3`, `Jack_Williams3`. In every row `First.name` and `Surname` are **present and
correct**; only fitzRoy's own concatenated convenience column `Player` is blank. 79 of the 83
missing-`ID` rows are these same rows — the same recent-2025 source incompleteness.

**Ownership: IMPORT TRANSFORMATION**, with a SOURCE DATA contribution. The name was never
missing from the source; only the derived column was, and the importer preferred that derived
column over the structured fields it already reads on the same row.

## 145. The transformation (`import_fitzroy_core.py:974-988`)

```python
        fact.given_name = clean(row["First.name"]) or fact.given_name
        fact.surname = clean(row["Surname"]) or fact.surname
        display = clean(row["Player"])
        if display is None:
            first, last = clean(row["First.name"]), clean(row["Surname"])
            if first and last:
                display = f"{first} {last}"
        fact.display_name = display or fact.display_name
```

Semantics: **non-blank `Player` wins verbatim** — the fallback is unreachable for the other
685,394 rows. Blank `Player` **and both components present** → `"First Surname"`. Blank
`Player` **and either component absent** → `display_name` stays `None` and the row still
**fails closed** with `has no usable name`. Whitespace handling is the importer's existing
`clean()` (strip, empty → `None`); no second naming policy was introduced.

`given_name`, `surname` and `sort_name` are untouched — they already came from the structured
columns. **Canonical identity is unchanged**: the AFL Tables profile URL. No name matching, no
fuzzy matching, no inference of missing components, no legacy or DraftGuru consultation, no
`external_identities` change, and **no special-casing of the four URLs** — the rule is
structural and applies to any row in any season.

## 146. Tests — 293/293 DB-free (7 new)

Blank `Player` + components present validates; non-blank `Player` still wins even when it
disagrees with the parts; blank + missing `First.name` **fails closed**; blank + missing
`Surname` **fails closed**; `given_name`/`surname`/`sort_name` derivation pinned unchanged; no
name-keyed player lookup introduced (identity lookup is still `players.get(url_path)`).

The tenth proof runs against the **real** snapshot: `player_stats_2025.csv` contains exactly
**79** blank-`Player` rows across exactly those four URLs; **every one** carries non-blank
`First.name` and `Surname`; and **no `source_row_corrections` rule targets 2025**, so none of
the 79 can be dropped.

## 147. VALIDATOR RESULT — FULL-HISTORY SNAPSHOT VALIDATES

`--label full-history-20260827 --validate-only --require-full-history`, 40.7s, **no database
access**:

```
matches                    16838        seasons                1897-2025
matches_with_player_rows   16838        venues                 52
attendance_known           15187        club_identities        24
players                    13275        brownlow_round_vote_rows 320861
players_with_dob           855          players_with_dob_conflict 0
player_match_rows          685471
full-history gates PASSED - identity coverage
  rows 685473   missing_id 83   missing_url 0   malformed_url 0
  distinct_ids 13270   distinct_urls 13275
```

Cross-checks: `matches_with_player_rows == matches` (**every** match joins);
`player_match_rows 685471 = 685473 - 2`, the two tracked 1909 Jim Stewart drops and nothing
else, so **all 79 rows are retained**; `distinct_urls 13275 == players`, so identity is
one-player-per-URL; `13275 - 13270 = 5`, exactly the five players carrying no fitzRoy ID —
consistent with the ID-optional/URL-mandatory policy; and the 24 identities keep
Brisbane Bears/Brisbane Lions, Kangaroos/North Melbourne, Footscray/Western Bulldogs,
Fitzroy, South Melbourne and University all **distinct**.

**No next blocker.** The validator ran to completion.

## 148. Status

The **full-history fitzRoy source (1897–2025) is validated end to end offline** and is ready
to be frozen as the canonical core rebuild source. Nothing has been written to PostgreSQL;
`db:test:rebuild` has never been executed; no Git operation; DraftGuru Stage B3 not started.

---

# PART XVIII — CANONICAL FULL-HISTORY SOURCE FROZEN

## 149. Accepted label

**`full-history-20260827`** — VFL/AFL men's senior competition, **1897–2025**, 131 immutable
raw artefacts, 719,042 acquired rows. It is the only accepted baseline.

## 150. The acceptance mechanism

A **separate tracked promotion register**, `data/reference/fitzroy-accepted-baselines.json`
(`contract: afldb.fitzroy.accepted_baselines`, `schema_version: 1`). It is deliberately not
an edit to the acquisition manifest: acquisition evidence stays immutable, and acceptance is
a distinct later decision recorded separately.

**It binds; it never blesses.** Hand-editing it cannot make a snapshot acceptable — see §152.

Selection is `exactly_one_accepted`. **Zero accepted and more than one accepted are both
refusals.** There is no latest-label, filename-ordering or date tiebreak anywhere: selection
among several accepted baselines is not tracked policy, so the rebuild fails closed and a
human decides. Both the importer and the orchestrator implement the rule independently.

## 151. What the record binds to

| Binding | Value |
|---|---|
| acquisition manifest sha256 | `cc8aaf0946fc59003dc4e5d6803410383db975e2f5bf58e9d510c31dc781e3b6` |
| artefact-set sha256 | `8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125` |
| raw artefacts / acquired rows | 131 / 719,042 |
| fitzRoy contract version | 1 |
| full-history contract version | 1 |
| adapter schema version / pinned fitzRoy | 1 / 1.8.0 |
| required range · datasets | 1897–2025 · player_stats, player_details, results |
| validator verdict | PASSED, no database access |

The artefact-set digest is `sha256` over sorted `"<filename> <sha256> <row_count>"` lines
from the manifest's `files[]` — a **second, independent** binding to the same bytes, so
covering one does not cover the other. Also pinned: every measured count and the identity
scan (§147), and the accepted corrections by contract version (Brisbane, Kangaroos, the two
1909 drops, the blank-`Player` fallback).

## 152. The critical invariant — five independent preflight gates

1. **acceptance → manifest bytes** — the manifest is re-hashed and compared.
2. **manifest → artefact list** — the artefact-set digest is recomputed, plus file count and
   total rows.
3. **manifest → raw bytes** — `validate_snapshot()` re-hashes **every** artefact on disk
   against its manifest entry.
4. **artefacts → gates** — `--require-accepted-baseline` **implies**
   `--require-full-history`, which re-derives every completeness gate from the artefacts.
5. **artefacts → fingerprint** — the freshly measured counts must equal the accepted ones,
   or acceptance is declared drifted.

So a tampered artefact breaks (3); a manifest edited to cover it breaks (1) and (2); an
acceptance record edited to cover **that** still faces (4) and (5), which never read the
record as a verdict. **The independent validator remains the sole authority.**

`manifest.full_history` and `manifest.completeness` remain **inert**, named as such in the
register's `inert_acquisition_fields`.

## 153. The acquisition manifest is preserved byte-for-byte

`docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260827.json` — **246,282
bytes, sha256 `cc8aaf09…`, unchanged**. It still self-declares `full_history: true` and
`completeness: "full_history"` — the claim the independent validator rejected — and is kept
verbatim as the record of that mistake. A test asserts it.

## 154. Orchestrator default selection

`npm run db:test:rebuild` now resolves the accepted baseline itself:

```
fitzRoy label : full-history-20260827 (ACCEPTED canonical full-history baseline)
```

**No `--fitzroy-label`, no `--acknowledge-partial-fitzroy`.** Preflight runs
`--validate-only --require-accepted-baseline` before any destructive stage. Partial/trial
mode survives for bounded testing but only as `--fitzroy-label <label>
--acknowledge-partial-fitzroy`; a bare `--acknowledge-partial-fitzroy` is refused, and a
label that is not the accepted baseline is refused rather than honoured.

## 155. Tests — 321/321 DB-free

`db-test-rebuild` 70 (12 new selection tests + preflight ordering + a 12-test acceptance
block) and `fitzroy-core-import` 68 (9 new refusal tests spawning the **real** importer
against synthetic snapshots and synthetic registers). Proven: the accepted baseline is
exactly `full-history-20260827` from the **real** register; acceptance is bound to both
hashes; a modified artefact and a modified manifest each break the chain; an acceptance
record with **entirely honest bindings still cannot bless** a one-season snapshot; trial-2024
is never selected normally; partial mode stays explicit; no latest-label selection exists in
the runner's code; the acquisition manifest is unchanged; zero `AFLDB_LEGACY_SQLITE`.

## 156. Remaining gates before the first clean rebuild

1. **ISSUE-083** — no restricted `afldb_import` test credential exists, so
   `AFLDB_TEST_IMPORT_DATABASE_URL` is unset and the runner fails closed (or must be forced
   to owner via `--allow-owner-import-dsn`, which would leave import grants unproven).
2. **`RESET_SQL` has never been executed** against a live database and needs a safe proof.
3. **The first clean `afldb_test` rebuild** itself.

None started. No PostgreSQL, no Git, no reacquisition, no Stage B3.
