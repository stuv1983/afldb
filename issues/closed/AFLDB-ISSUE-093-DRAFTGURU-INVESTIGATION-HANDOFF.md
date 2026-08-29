# AFLDB-ISSUE-093 — DraftGuru Acquisition / Source-Contract INVESTIGATION HANDOFF

**This is an INVESTIGATION HANDOFF, not an approved importer design or runbook.**

Durable source of truth for ISSUE-093 remains `AFLDB-ISSUE-093.md` (§15–§18 phase records).
Predecessor: `AFLDB-ISSUE-093-CORE-IMPORT-DB-COMPLETE-HANDOFF.md` (§13 opened this boundary).
ISSUE-092 safety design is in `AFLDB-ISSUE-092.md` (§4/§5/§11).

`AFLDB-ISSUE-093-DRAFTGURU-HANDOFF.md` — the final acquisition/source contract — **has not
been written and must not be written until the Step 1 and Step 2 gates below both pass.**

---

## Status

| Item | State |
|---|---|
| ISSUE-093 | **Open** |
| DraftGuru acquisition/source-contract investigation | **IN PROGRESS** |
| Implementation | **NONE approved** |
| PostgreSQL importer design | **NONE approved** |
| Step 1 identity gate (`afldb_dev` read-only audit) | **COMPLETE** — executed by the user 2026-08-26; evidence in *Step 1 — afldb_dev identity/crosswalk audit* below |
| DraftGuru-side durable identity gate | **PASSED** — `player_url` complete and unique (5,057/5,057), 0 reload-key collisions, exact 6,810-row CSV parity, human resolution targets intact |
| AFL Tables identity uniqueness gate | **PASSED** — 12,472 identities, 12,472 distinct external ids, 0 orphans, 0 ids on multiple players, 0 players on multiple ids |
| Step 1 residual audit (`afldb_dev`, read-only, counts/categories only) | **COMPLETE** — executed by the user 2026-08-26; evidence in *Residual audit — COMPLETE* below |
| Complete DraftGuru → AFL Tables crosswalk coverage | **FAILED / INCOMPLETE — 68 gaps.** Not a blocker to source reacquisition; **is** a blocker to a canonical-side replay artifact anchored solely on AFL Tables identities |
| Residual A — 68 of 3,460 linked canonical players with no qualifying AFL Tables identity | **CHARACTERISED, NOT EXPLAINED** — 68/68 hold **no `external_identities` row from any source**; 66 of 68 are real match-playing players; shape is an enrichment/coverage gap at the 1981–1996 historical edge plus 3 current-edge players. Schema does not establish *why*. Carries a provenance residual: **8 `resolved` statuses, only 3 extant explicit decisions** |
| Residual B — 3,464 linked DraftGuru persons over 3,460 canonical players | **SUSPECT AUTOMATIC HISTORICAL CONVERGENCES — MUST BE RE-EARNED.** 4 players × exactly 2 persons; distinct `player_url` differing only at the same-name ordinal; shared `name_key`; differing `reported_games`; **0 human decisions**; automatic `unique` only |
| Old automatic convergence integrity | **NOT TRUSTED FOR REPLAY** |
| Step 2 target selection | **COMPLETE** — 4 pairs / 8 DraftGuru-public identities; Brad Miller selected as first probe |
| Step 2 identity gate (live DraftGuru source probe) | **COMPLETE — PASSED.** Durable `player_url` present in server-rendered annual HTML; same-name ordinal disambiguation proven on `/players/brad_miller/1` vs `/2` |
| Brad Miller convergence | **PROVEN INCORRECT AUTOMATIC HISTORICAL CONVERGENCE** — two distinct DraftGuru people on one canonical player |
| Houlihan / Hill / Brown convergences | **STILL SUSPECT — MUST BE RE-EARNED** (not proven wrong; live profiles not inspected) |
| Acquisition adapter/runbook | **NEXT** — `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md` |
| DraftGuru **CSV validation snapshot** (`data/sources/draftguru/full-history-20260826/`) | **ACQUIRED** — 42 files, 6,810 rows, 1981–2025, fully profiled (§1). Retained as a population/parity, field-vocabulary and reconciliation artifact (§2). **Immutable: do not rename, modify, combine, normalise, rewrite or delete.** |
| **Identity-complete / richer DraftGuru source preserving `player_url`** | **NOT YET ACQUIRED** — the browser-export CSV stripped every player hyperlink, so it carries no `player_url`, DraftGuru id, slug or href (§2). This is the acquisition the rebuild path actually needs, and Step 2 exists to prove it is still obtainable. |
| Code changed | **NONE** |
| Database mutated | **NONE** — every access read-only and rolled back |

Work completed in the investigation session (2026-08-26): full read-only profiling of the raw
CSV corpus (two user-approved read-only PowerShell commands scoped to the snapshot directory),
and a repository-evidence map of the existing DraftGuru/draft architecture. No Git, SQL, psql,
SSH, deployment, service or test command was run in that session. DraftGuru was not fetched.

Later the same day the user personally executed the Step 1 `afldb_dev` audit and returned its
output; that evidence and its conclusion are recorded in the Step 1 section below. Claude ran
no command in either session.

---

## 1. Raw CSV snapshot

**Path:** `data/sources/draftguru/full-history-20260826/`

**Provenance:** the files were produced by a **browser/extension rendered-table export** (user
confirmed). This is the single most consequential fact in this document — see §2.

Gitignored under the existing `/data/*` rule. **Treat as an immutable raw acquisition
snapshot: do not rename, modify, combine, normalise, rewrite or delete these files.**

### Measured corpus facts

| Metric | Value |
|---|---|
| Files | **42** |
| Total bytes | **695,733** (~679 KiB) |
| Total data rows | **6,810** |
| Year coverage | **1981, 1982, 1986–2025** |
| Missing years | **1983, 1984, 1985** |
| Exact duplicate rows | **0** |
| Malformed / short rows | **0** |
| Empty / zero-row files | **0** (smallest: 1982, 1,990 bytes, 24 rows) |
| Schema variants | **3** |
| Encoding | **UTF-8, no BOM, CRLF line endings — all 42 files** |
| Delimiter / quoting | comma; RFC4180 double-quoting only where a field contains a comma (`Awards`) |
| Filename pattern | `<YYYY>_<VFL\|AFL>_Draft_and_Trade_Period_Table_1.csv` (VFL 1981–1989, AFL 1990+) |

Per-file byte sizes, line counts, row counts and SHA-256 digests were computed and are
reproducible; they belong in the manifest emitted by the eventual acquisition adapter, not
hand-copied here.

### Missing years 1983–1985 — legitimately absent

Not an acquisition failure. Corroborated by AFLDB's own records: `docs/data-dictionary.md:217`
describes the legacy DraftGuru-sourced `draft` table as **"6,810 rows … 1981–2025 across 11
`draft_type` values"**. The CSV corpus is **6,810 rows, 1981–2025, 11 distinct event-type
groups** — all three figures match exactly. Historically the VFL held limited drafts in
1981–1982, none 1983–1985, and the first National Draft in 1986, which is also where the
`Draft` column first appears.

### Schema variants — exact headers

| Variant | Files | Years | Header |
|---|---|---|---|
| **A** (14 col) | 3 | 1981, 1982, 1987 | `Pick,# ↧,Club,Detail,Player,Age,Height,Original Club,Grade,Games,Goals,Coaches,Brownlow,Awards` |
| **B** (15 col) | 3 | 1986, 1997, 1998 | `Pick,Draft,# ↧,Club,Detail,Player,…` |
| **C** (15 col) | 36 | 1988–1996, 1999–2025 | `Pick,Draft,# ↧,Club,Signing,Player,…` |

Variant A has no `Draft` (event-type) column. B and C differ in whether column 5 is headed
`Detail` or `Signing` — **and these are NOT the same field semantically** (§1.5).

### Measured encoding / rendering artefacts

| Codepoint | Count | Location | Assessment |
|---|---:|---|---|
| U+00A0 NBSP | 9,143 | **`Player` in all 6,810 rows**; `Awards` 1,156; `Signing` 129; `Pick` 57 | Every player name uses NBSP, not a space. Must be normalised before any name comparison. |
| U+200B ZWSP | 6,621 | `Original Club`, following every `/` | Rendered-HTML wrap hint. Must be stripped. |
| U+21A7 ↧ | 42 | Header `# ↧`, one per file | Sort-arrow glyph baked into the column name. |
| U+00C3 / U+0093 / U+00A1 / U+00AD | 8 / 3 / 3 / 2 | 6 rows | **CP1252 mojibake** — UTF-8 bytes re-decoded as Latin-1. |

Affected rows (deterministically repairable, but corruption introduced by the export step, not
present in the source): `Setanta Ã hAilpÃ­n` (2003 Rookie, 2011 National), `CiarÃ¡n Sheehan`
(2013 Rookie, 2016 Pre-Draft), `CiarÃ¡n Byrne` (2013 Rookie), `Red Ãg Murphy` (2018
Pre-Draft) — i.e. Ó hAilpín, Ciarán, Ciarán, Óg.

### 1.4 Field catalogue (blank counts out of 6,810)

| Header | Years | Blank | Semantics | Verdict |
|---|---|---:|---|---|
| `Pick` | all | 6,709 (98.5%) | **Not a pick number** — a special-pick *label* | Import → `draft_picks.pick_note` |
| `Draft` | 1986+ | 0 | Event type (§1.5) | **Import — primary discriminator** |
| `# ↧` | all | 1,686 (24.8%) | Selection number within the event; sparse (passed picks absent); float-formatted (`1.0`) in all 15-col files, integer in the 3 14-col files | Import as int → `pick_number` |
| `Club` | all | 0 | **Destination** club — 19 modern-identity labels, **not era-correct** (§6) | Import with era resolution |
| `Signing` | 1988–96, 1999+ | 5,803 | Signing mechanism | Import → `signing`/`signing_kind`/`signing_detail` |
| `Detail` | 1981/82/86/87/97/98 | — | **Different field** — holds player names and `Brisbane` | Import **separately** → `draft_picks.detail` |
| `Player` | all | 0 | Name only. **No ID, no URL, no hyperlink.** NBSP-separated | Import as `player_name_raw`; **never identity** |
| `Age` | all | 30 | `NNyr` at transaction | Import → `draft_age` |
| `Height` | all | 486 | `NNNcm` | Import → `height_cm` |
| `Original Club` | all | 261 | `/`-separated **recruiting pathway**, up to 8 segments, ZWSP-delimited | Import verbatim → `original_club_raw`; **never an FK** |
| `Grade` | all | 717 | DraftGuru editorial career grade A+…D | Opaque source text only; not a fact about the player |
| `Games` | all | **0** | Career-since-transaction total; `N (M)` = M for the transacting club | **Do not import as fact** |
| `Goals` | all | **0** | as above | **Do not import as fact** |
| `Coaches` | all | **0** | Coaches Association votes | **Do not import** |
| `Brownlow` | all | **0** | Career Brownlow votes | **Do not import** — AFLDB holds the authoritative grain from fitzRoy |
| `Awards` | all | 5,654 | Denormalised display string | Defer to the awards domain (§13.6); not draft data |

**Critical null-semantics finding:** `Games`, `Goals`, `Coaches` and `Brownlow` are **0%
blank** — the source has already coerced "no games" and "not recorded" to `0`. They cannot
distinguish absence from zero and therefore violate AFLDB's NULL≠0 rule *at source*. They are
unusable as facts regardless of whether they are wanted.

By contrast `# ↧` blanks are **not-applicable, never not-recorded** (§1.5 table) — clean
semantics that must be preserved as NULL, never 0.

No `N/A`, `NULL`, `-` or `unknown` sentinel appears anywhere in the corpus. Blank is the only
absence marker.

### 1.5 Event / transaction type catalogue — complete, all 6,810 rows accounted for

| `Draft` value | Rows | Years | `#` blank | `#` float-fmt |
|---|---:|---|---:|---:|
| National | 2,976 | 1986–2025 | 0 | 2,976 |
| Rookie | 1,209 | 1996–2025 | 0 | 1,209 |
| Trade | 990 | 1988–2025 | **990 (all)** | 0 |
| Pre-Season | 541 | 1988–2025 | 0 | 541 |
| Pre-Draft | 370 | 1986–2025 | **370 (all)** | 0 |
| Mid-Season | 280 | 1989–2025 | 0 | 280 |
| Post-Draft | 188 | 2004–2025 | **188 (all)** | 0 |
| Free Agency | 138 | 2012–2025 | **138 (all)** | 0 |
| *(no `Draft` column)* | 113 | 1981, 1982, 1987 | 0 | 0 |
| Mini-Draft | 4 | 2011–2012 | 0 | 4 |
| Training Squad Selection | 1 | 2010 | 0 | 1 |

`#` is blank for **exactly and only** Trade, Pre-Draft, Post-Draft and Free Agency — the four
non-ordered event types. This confirms migration 069's note that `pick_number` is legitimately
NULL for trades, free agency and signings.

**Signing / Detail mechanisms** (25 groups over 1,007 populated rows): Academy 170
(2012–2025, incl. `Academy (NG) (Club)`), Foundation 124 (1990–1996), **Father-Son 118
(1988–2025, 100 distinct values — carries the father's name)**, SSP 107 (2018–2025), Zone 89
(1988–2017), FA 79 (`Restricted`/`Unrestricted`, 2012–2025), International 75 (2000–2024),
DFA 59 (2012–2024), Unregistered 42 (1999–2024), Uncontracted 28 (1993–2011), Scholarship 25
(2007–2011), Underage 24 (2009–2010), Concessional 21 (1989–2011), Top-Up 11 (2004–2015),
Compensation 8 (1994–1995), Supplementary 8 (1994), Concession 5 (2018), Special Cat B 2
(2014–2016), plus 7 `Detail`-era values (1986/1997/1998 — six player names and `Brisbane`).

**Special-pick labels (`Pick` column, 101 populated rows):** Priority 42 (1992–2016),
Compensation 23 (1996–2015), FA Compensation 21 (2012–2018), Inactive 13 (2018), Penalised 2
(2014, 2017). All of form `Label (parenthetical)`.

**Orthogonality:** `Draft` (event type), `Signing` (mechanism) and `Pick` (special-pick label)
are **three independent axes that coexist on one row** — e.g. `National` +
`Father-Son (Peter Dean)`, `Post-Draft` + `Academy (NG) (Collingwood)`, `National` +
`FA Compensation (Tom Lynch)`. AFLDB's existing `draft_picks` schema already models exactly
this three-axis shape (`draft_type`/`draft_kind`, `signing`/`signing_kind`/`signing_detail`,
`pick_note`).

**`Father-Son` is the highest-value relational fact in the corpus**; AFLDB has a dedicated
`father_son_selections` table (migration 006) with `father_player_id` and `father_link_status`.

---

## 2. Critical source-contract conclusion

**The current CSV snapshot is NOT identity-complete and NOT import-capable as the canonical
DraftGuru source.**

The rendered-table export **stripped DraftGuru's player hyperlinks — there is no `player_url`,
no DraftGuru ID, no slug, no href, no player identifier of any kind in these files.**
`player_url` is the key AFLDB's entire DraftGuru identity architecture is built on (§3).

The export step also explains every artefact measured in §1.3: the `↧` sort glyph, the `1.0`
float formatting, NBSP in 100% of names, ZWSP through `Original Club`, and the CP1252 mojibake.

### The CSVs remain valuable and must be retained

- an **independent population / parity baseline** (6,810 rows, 1981–2025, 11 event types —
  matching AFLDB's existing dataset exactly);
- a **field / schema validation artifact** (three header variants, complete field and
  event-type vocabularies);
- a **row-count and vocabulary reconciliation artifact**.

**They must not be deleted or modified.**

### Terminology — required

Do **not** describe the CSV reconciliation tuple as a durable natural or source key. Use:

> **CSV reconciliation key:**
> `(draft_year, event_type/draft_kind, destination_club, player_name)`

Measured: **unique across all 6,810 rows of this corpus, zero collisions, no dependence on row
ordering.** But it is built from **rendered/display-level values** that DraftGuru can re-render
at any time — club labels are already modern-identity rewrites (§6), and names carry NBSP and
mojibake (§1.3). **It is NOT the durable DraftGuru person identity and must never become a
reload key.**

Other candidate keys measured across the 6,810 rows, for the record:

| Candidate | Distinct | Colliding groups | Extra rows | Verdict |
|---|---:|---:|---:|---|
| `(year, Draft, #)` | 5,212 | 86 | 1,598 | Reject — `#` NULL for 1,686 rows |
| `(year, Draft, Player)` | 6,808 | 2 | 2 | Near-unique |
| **`(year, Draft, Club, Player)`** | **6,810** | **0** | **0** | The CSV reconciliation key |
| `(year, Player)` | 6,782 | 28 | 28 | Reject |
| `(Player)` global | 4,998 | 1,496 | 1,812 | Reject |

`#` is not required and must not be in the key.

---

## 3. Durable DraftGuru identity — repository evidence

Source: `src/db/migrations/069_draft_source_identity.sql`, `tools/migration/import_draft.py`.

- **`player_url` is the durable DraftGuru person key currently used by AFLDB.** Migration 069
  L25–26: *"What the source does carry is player_url — DraftGuru's own person page, whose
  trailing ordinal disambiguates same-name people."* Stored on **both** `draft_persons` and
  `draft_picks`.
- **`draft_persons` identity:** `UNIQUE (source_id, player_url)` — `draft_persons_source_uq`
  (069 L53–54).
- **`draft_picks` reload identity:**
  `UNIQUE (source_id, player_url, draft_year, draft_kind) NULLS NOT DISTINCT WHERE source_id
  IS NOT NULL` — `draft_picks_source_uq` (069 L56–59). Partial, so admin-created rows
  (`source_id IS NULL`) stay outside the importer's identity space.
- **`player_url` includes same-name disambiguation** via its trailing ordinal — this is
  precisely the mechanism that makes name-only identity unsafe.
- **`dg_person_id` is NOT durable:** assigned as `p.index + 1` over a person frame sorted by
  `player_url` — *"a RANK recomputed on every load, not DraftGuru's own id. A single new
  person renumbers everything after it"* (069 L18–21). Stored as provenance only.
- **`source_record_id` is NOT durable:** it holds the legacy SQLite `rowid`, and the upstream
  table is written with `to_sql(if_exists="replace")`, so *"every rowid is reissued on every
  source rebuild"* (069 L15–17). Stored as provenance only.
- **`draft_kind` vs `draft_type`:** 069 L34–37 — `draft_kind` separates *"the 23 people who
  appear twice on one year's board (Pre-Draft + Trade, National + Pre-Season, and so on)"* and
  *"unlike draft_type it already absorbs the source's own `National` / `National Draft`
  wording split"*. `draft_year` is not correctable: *"the year page IS the source_url, one to
  one"* (069 L33–34).
- **Name-only merging is PROHIBITED.** The corpus holds 4,998 distinct names over 6,810 rows
  against 5,057 draft persons — implying roughly **59 names belong to two different people**,
  exactly the cases the URL ordinal exists to separate. Fusing them is not acceptable.

### Repository-derived baseline expectations — NOT yet verified against `afldb_dev`

| Figure | Value | Source |
|---|---:|---|
| draft picks | **6,810** | 069 L41–42; `docs/data-dictionary.md:217` |
| draft persons | **5,057** | 069 L41–42; `tests/integration/release-gates.test.ts` |
| currently linked persons | **~3,459** | `tests/integration/release-gates.test.ts` |
| never-played / unlinked persons | **~1,498** | `tests/integration/release-gates.test.ts` |
| duplicate `player_url` | **0** | 069 L41–42 |
| NULL `draft_kind` | **0** | 069 L41–42 |

069 L41–42 records these as *"Verified clean on afldb_dev and afldb_test, 2026-08-22"*.

> **These are repository-derived expectations only. They must be treated as unverified until
> Step 1 directly measures `afldb_dev`.** `afldb_test` has since been rebuilt from scratch and
> holds no draft data; the old legacy-built database was renamed to
> `afldb_test_pre_rebuild_20260825` and is locked.

---

## 4. Existing-link carry-forward model

**Two distinct artifacts with different purposes and different provenance. They must not be
conflated.**

### A. Reconciliation / audit baseline (broad)

An exportable baseline of **all** existing DraftGuru person identities and their current
canonical player mappings where present. **This may include automatically linked mappings.**

Purpose:

- post-rebuild comparison;
- detect regressions;
- prove the new importer reproduces — or intentionally and visibly improves — the existing
  mapping.

It is **evidence, not instruction**. Nothing in it is replayed as a decision, and an automatic
mapping appearing in it **never acquires human provenance by being there**.

### B. Replayable human decisions (narrow)

**Only explicit `player_link_resolutions` rows** represent human/admin decisions eligible for
replay as historical decisions, carrying `action`, `match_method`, `match_score`,
`algorithm_version`, `admin_user_id`, `created_at`.

- `action = 'linked'` and `action = 'confirmed_unlinked'` are both human decisions and both
  must survive. `confirmed_unlinked` suppresses re-suggestion; losing it would re-surface
  every previously dismissed candidate.
- **Do not promote existing automatic `unique` matches into human provenance.** They are
  re-derivable and must be re-earned by the new importer on its own evidence.

### SCHEMA CORRECTION — record prominently

> **`player_link_resolutions` does NOT have an `entity_type` column.**
> A predicate such as `entity_type = 'draft_person'` is **invalid** and will error.

Migration `056_player_link_review.sql:54-69` defines the link target as:

- `target_table text NOT NULL` — CHECK list is `award_winners`, `award_nominations`,
  `hall_of_fame`, `honour_team_members`, `captaincies`, `player_achievements`,
  **`draft_picks`**. There is **no `draft_person` value.**
- `target_id bigint NOT NULL CHECK (target_id > 0)` — **deliberately not a foreign key**
  (056 L20–23: it points into seven different tables).

For draft decisions, `target_table = 'draft_picks'`, and `target_id` must be traversed:

```text
player_link_resolutions.target_id
  -> draft_picks.id
  -> draft_picks.draft_person_id
  -> draft_persons
  -> draft_persons.player_url        (the durable key)
```

`applyLockedLink` (`src/db/queries/player-links.ts:359-378`) propagates one decision to
`draft_persons` **and** to every sibling `draft_picks` row sharing that `draft_person_id`.
`lockUnresolvedTarget` (same file, L235–297) serialises through `draft_person_id` and throws
if it is NULL.

Note also that `player_link_match_candidates` (migration 067 L63–70) *does* use
`resolution_entity_type` with a `'draft_person'` value — **a different table with a different
column.** Do not carry that predicate across to `player_link_resolutions`.

---

## 5. Canonical-side crosswalk gate — NOT YET PROVEN

The intended durable crosswalk shape is:

```text
DraftGuru player_url
  -> canonical AFLDB player
  -> AFL Tables external identity / profile identifier
```

A source-URL ↔ source-URL crosswalk is required because **`players.id` will not survive the
rebuild** — surrogate ids will differ in the rebuilt database and must never be exported as
the canonical anchor.

**The canonical side of this crosswalk is an unproven premise.** It is viable only if the
currently linked draft persons' canonical players actually hold AFL Tables external identities
with sufficient coverage and uniqueness. Neither has been measured.

Step 1 must verify:

- AFL Tables identity **coverage** for linked DraftGuru persons (how many linked players have
  one);
- **missing** identities (how many have none);
- **multiple / conflicting** identities (players carrying more than one AFL Tables
  `external_id`);
- **uniqueness** of the AFL Tables identifier across the source.

**Do not claim this crosswalk is complete or design around it until Step 1 proves it.** If
coverage is partial, the crosswalk needs a documented secondary anchor or an explicit
partial-coverage contract — a decision to be taken deliberately, not assumed.

Relevant existing structure: `external_identities` (migration 002 L178–194) with
`UNIQUE (source_id, external_id)`; AFL Tables identities are registered by
`tools/migration/import_fitzroy_core.py` under source key `afltables` with
`match_method = 'afltables_profile_url'`, normalised to the `players/A/Name.html` path.

---

## 6. Club identity

19 distinct destination-club strings, all **present-day identity labels**:

`Adelaide, Brisbane, Carlton, Collingwood, Essendon, Fitzroy, Fremantle, Geelong, Gold Coast,
GWS, Hawthorn, Melbourne, North Melbourne, Port Adelaide, Richmond, St Kilda, Sydney,
West Coast, Western Bulldogs`

`data/reference/clubs.json` holds **24** identities keyed on `hist`, with **no `aliases` key**
(the loader derives aliases from `hist`/`name`/`short_name`/`abbreviation`), and treats mergers
as **separate organizations whose statistics are never combined**.

| DraftGuru string | Years present | Problem |
|---|---|---|
| `Brisbane` | 1986–2025 | **Collapses two separate AFLDB identities** — Brisbane Bears (≤1996) and Brisbane Lions (1997+). Ambiguous without era resolution. |
| `Western Bulldogs` | **1981**–2025 | Era-incorrect: the identity was Footscray until 1996 |
| `Sydney` | **1981**–2025 | Era-incorrect: South Melbourne until 1982 |
| `North Melbourne` | 1981–2025 | Era-incorrect: `Kangaroos` 1999–2002 |
| `GWS` | 2010–2025 | Abbreviation, not `Greater Western Sydney` |
| `Fitzroy` | 1981–1995 | Correct |

This is the **inverse** of the fitzRoy core importer's remap (fitzRoy says "Footscray" in 2024
and is remapped forward). DraftGuru gives the modern name for a historical season and must be
remapped **backward** to the identity whose era contains the draft year. The existing
`import_draft.py:458-463` resolves club strings best-effort against
`club_aliases ∪ clubs.name ∪ clubs.short_name` with a raw-string fallback — **not era-aware**,
and would mis-resolve `Brisbane`.

**`Original Club` is a different thing entirely:** 6,549 populated, 4,241 containing `/`, up to
8 segments, holding junior clubs, schools, state leagues, VFL affiliates and countries (`USA`,
`County Cork`). **Not a `clubs` FK. Store verbatim in `original_club_raw`.**

---

## 7. Trade-origin — wording correction

Record only:

> **"The current CSV/table export does not represent trade-origin AFL club information."**

Measured: of 990 `Trade` rows, **0** carry an AFL club in `Original Club` (every value is the
player's junior/state-league recruiting pathway, not the previous AFL club).

**Do NOT state that DraftGuru itself lacks trade-origin information.** Whether richer
HTML/source data exposes it — a second cell, a link, an attribute — **remains unresolved until
the Step 2 live-source probe.**

---

## 8. Existing CSV manifest status

The current CSV snapshot should eventually receive a **retrospective manifest**, following the
proven fitzRoy pattern (`docs/rebuild-manifests/<domain>/<label>.json`, written and validated
by an adapter, immutability anchored on the manifest — an existing label aborts the run).

Suggested label: `csv-export-20260826`.

**That manifest must explicitly make clear that this snapshot is not suitable as the
identity-complete import source**, via a single field the validator can refuse on — without
having to inspect the files.

Intended semantic flag (**field name NOT locked** — settled when the manifest schema is
designed):

```text
identity_complete = false
and/or
import_capable   = false
```

with `identity_fields_present: []` as supporting detail.

The DraftGuru manifest schema also needs, beyond the fitzRoy field set
(`source`, `adapter`, `adapter_schema_version`, `extraction_date`,
`extraction_timestamp_utc`, `mode`, `snapshot_label`, `requested_range`,
`files[]{dataset,filename,row_count,sha256,columns[]}`, `total_rows`):

- `source_urls[] {year, url, fetched_at, http_status}` — the year page *is* the identity of
  `draft_year` (069 L33–34);
- `schema_fingerprint` — the three header variants must be pinned so a silent upstream change
  fails closed;
- `known_coverage_gaps[]` — must record `1983, 1984, 1985 — no draft held` as a **positive
  assertion**, not an absence;
- `identity_fields_present[]` — must assert `player_url` was captured.

**The final manifest schema remains to be designed.**

---

## 9. Safety requirements already established

Carried into the eventual design, non-negotiable:

- **ZERO `AFLDB_LEGACY_SQLITE` dependency in the new rebuild path.**
  `tools/migration/import_draft.py:423` (`connect_legacy()`) is the **last draft-path consumer**
  of the legacy SQLite database. The new adapter must be test-pinned the way
  `import_fitzroy_core.py`, `load_reference_data.py` and `acquire_core.R` already are.
- **Acquisition and PostgreSQL import remain separate stages** — mirror the proven fitzRoy
  split (`acquire_core.R` → manifest → `--validate-only` → import).
- **The validation-only stage must require no database access** (and no psycopg import), as
  `import_fitzroy_core.py --validate-only` already demonstrates.
- **No name-only player merging**, ever.
- **No manufacturing of canonical players for DraftGuru-only people** — ~1,498 draft persons
  legitimately never played. They stay unlinked `draft_person` rows.
- **Era-aware destination-club resolution**, failing closed on ambiguity (notably `Brisbane`).
- **`Original Club` remains raw text, not a `clubs` FK.**
- **Null / not-applicable semantics must be preserved** — blank `#` is not-applicable, never 0;
  the four enrichment columns have absence already coerced to 0 at source and must not become
  facts.
- **ISSUE-092 population-drop protection is REQUIRED in the eventual draft importer.**
  Currently **missing**: `import_draft.py` calls `reload_keyed(..., delete_missing=True)` on
  `draft_picks` and runs an ungated orphan-person DELETE, with no `check_population_drop()`
  anywhere — the exact defect class ISSUE-092 exists to refuse, against a table whose surrogate
  ids are named by `player_link_resolutions`. Wire `check_population_drop()` from
  `tools/migration/common.py:129` plus `--acknowledge-population-drop`.
- **Existing human decisions must survive source reload/rebuild** (§4B).
- **Cross-source and admin-owned rows must not be deleted** — the `draft_picks_source_uq`
  partial index on `source_id IS NOT NULL` is the existing ownership boundary and must be
  respected (the mistake tracked as AFLDB-ISSUE-080 on the honours tables).

---

## 10. Pending gate — Step 1 (next exact action)

**A user-run, read-only audit against `afldb_dev`.**

**NOT `afldb_test_pre_rebuild_20260825`** — the preserved pre-rebuild database remains locked
(`ALLOW_CONNECTIONS = false`), reference-only, and **must not be accessed or enabled**. It is
not needed: migration 069 L41–42 records the same draft population on `afldb_dev`, which is
live and outside ISSUE-093's scope (093 §14 scopes the rebuild to `afldb_test` only).

The command is already prepared and approved in shape. Its safety properties:

- `PGOPTIONS='-c default_transaction_read_only=on'` set **at connect time**, before any
  statement;
- `psql -X` with `-v ON_ERROR_STOP=1`;
- DSN pins `/afldb_dev`, plus a `DO` guard that raises unless
  `current_database() = 'afldb_dev'` and the transaction is read-only;
- everything inside one `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;`
  … `ROLLBACK;`.

It measures:

1. database / user / read-only identity proof;
2. source registry (`draftguru`, `afltables`, `fitzroy_afldata`);
3. `draft_picks` / `draft_persons` population and year coverage;
4. `player_url` coverage (NULL/blank) and distinct-value count;
5. duplicate `player_url` groups in `draft_persons`;
6. `draft_persons.link_status` breakdown;
7. `draft_picks` identity-field integrity (missing URL, NULL `draft_kind`, NULL
   `draft_person_id`);
8. reload-key `(source_id, player_url, draft_year, draft_kind)` uniqueness;
9. **CSV reconciliation-key parity on the database side**
   `(draft_year, draft_kind, club_name_raw, player_name_raw)`;
10. `draft_type` / `draft_kind` vocabulary (to reconcile against the 11 CSV event types);
11. `player_link_resolutions` counts via **`target_table = 'draft_picks'`** (§4 correction);
12. resolution `action` / `match_method` breakdown;
13. dangling resolution targets and distinct persons covered;
14. reader suggestions on draft (context);
15. **AFL Tables external-identity coverage, absence, multiplicity and uniqueness for linked
    draft persons** (§5 gate).

> **Step 1 performs COUNTS AND AGGREGATES ONLY. It exports no mappings** — no `player_url`, no
> `external_id`, no player names leave the database — **and mutates nothing.**

---

## 11. Pending gate — Step 2 (do not execute yet)

**Only after Step 1 is evaluated.** Do not fetch DraftGuru before then.

Inspect the live DraftGuru source to prove that player links are still available in a richer
acquisition form:

- confirm each row's player cell carries an `<a href>` player page URL;
- confirm the URL format matches what `draft_persons.player_url` stores;
- **the probe must include at least one known same-name / ordinal-disambiguated DraftGuru
  player**, selected from Step 1 evidence — not an arbitrary year page. A page where every
  name happens to be unique would prove only that hrefs exist, not that they resolve the exact
  cases where names are unsafe. The probe must show two distinct URLs for two distinct people
  sharing a rendered name, and that both appear on the year pages we would acquire;
- inspect whether richer source HTML exposes information absent from the CSV export —
  **including trade-origin club information where applicable** (§7, currently unresolved);
- record whether the destination club exposes a link/identifier.

---

## 12. Stop conditions

**Stop and report before any importer planning** if any of the following occur:

- `afldb_dev` does not contain complete and unique `player_url` identity;
- existing human resolutions cannot be traversed safely (dangling targets, NULL
  `draft_person_id`, missing `player_url` on resolution targets);
- linked DraftGuru players lack a usable canonical AFL Tables identity at a material rate;
- AFL Tables identity collisions make a source-to-source crosswalk unsafe;
- live DraftGuru no longer exposes durable player URLs;
- richer reacquisition cannot preserve same-name identity;
- population differs materially from the established 6,810-row baseline without explanation.

---

## 13. Explicitly NOT done

- `AFLDB-ISSUE-093-DRAFTGURU-HANDOFF.md` — **not written** (final source contract; blocked on
  Steps 1 and 2);
- no DraftGuru acquisition adapter, contract file, manifest or validator;
- no DraftGuru PostgreSQL importer or importer design;
- no crosswalk export (neither artifact A nor B);
- no database access of any kind this session;
- no DraftGuru fetch;
- no code, Git, SQL, test, SSH, deployment or service command;
- no change to `IssuesIndex.md`, `issues.md` or `CHANGELOG.md` — ISSUE-093 remains Open and
  its state is unchanged by this investigation checkpoint; no retained project behaviour
  changed.

*(§13 describes the profiling session that produced §1–§12. The Step 1 audit recorded in the
next section was executed by the user in a later session, 2026-08-26.)*

---

## Step 1 — afldb_dev identity/crosswalk audit

**Executed 2026-08-26. The user personally ran the read-only audit against `afldb_dev` and
returned the complete output. Claude ran no command; it prepared the SQL and evaluated the
returned evidence.**

This section supersedes the `PENDING` state recorded for Step 1 in the Status table at the top
of this document.

### Safety proof (from the audit's own identity block)

| Property | Observed |
|---|---|
| `current_database()` | **`afldb_dev`** |
| `current_user` | **`afldb_owner`** |
| `default_transaction_read_only` | **`on`** (set at connect time via `PGOPTIONS`) |
| `transaction_read_only` | **`on`** |
| `transaction_isolation` | **`repeatable read`** |
| psql invocation | **`psql -X`**, `-v ON_ERROR_STOP=1`, `-P pager=off` |
| Transaction outcome | **`ROLLBACK`** — nothing written |
| `afldb_test_pre_rebuild_20260825` | **not accessed, not connected to, not enumerated** (the script contains no `pg_database` query and never names it) |
| Data egress | **none** — counts, aggregates and vocabulary only; **no `player_url`, no `external_id`, no player names, no `target_id` values were exported** |

The DSN was additionally guarded shell-side (refuse unless it ends `/afldb_dev`) and in-SQL by
a `DO` block that raises unless `current_database() = 'afldb_dev'` **and** both read-only
settings are `on`.

### DraftGuru source registry

Observed source IDs on `afldb_dev`:

| `sources.key` | `sources.id` |
|---|---:|
| `fitzroy_afldata` | **1** |
| `afltables` | **2** |
| `draftguru` | **4** |

### DraftGuru population and durable identity

Measured directly on `afldb_dev`:

| Measure | Value |
|---|---:|
| `draft_picks` | **6,810** |
| source-owned `draft_picks` (`source_id IS NOT NULL`) | **6,810** |
| `draft_persons` | **5,057** |
| linked `draft_persons` (`player_id IS NOT NULL`) | **3,464** |
| `draft_persons` with missing/blank `player_url` | **0** |
| distinct `draft_persons.player_url` | **5,057** |
| duplicate `player_url` groups | **0** |
| duplicate `player_url` extra rows | **0** |
| `draft_year` range | **1981–2025** |
| populated draft years | **42** |

Explicitly:

- **The live `afldb_dev` population exactly matches the 6,810-row CSV corpus** profiled in §1 —
  6,810 rows on both sides, no shortfall and no excess.
- **The 42 populated draft years match the 42 CSV files** one for one (1981, 1982, 1986–2025;
  1983–1985 legitimately absent, §1.2).
- **`player_url` is empirically complete and unique across all 5,057 draft persons** — zero
  missing, zero blank, 5,057 distinct values for 5,057 rows. The durable DraftGuru person
  identity asserted from repository evidence in §3 is now measured, not inferred.
- **The repository-derived ~3,459 linked-person estimate (§3, from
  `tests/integration/release-gates.test.ts`) is superseded for this checkpoint by the measured
  `afldb_dev` value of 3,464.** Use 3,464 from here on; the §3 table remains as the historical
  repository-derived figure it was labelled as.

### Pick/person and reload-key integrity

| Measure | Value |
|---|---:|
| source-owned picks missing `player_url` | **0** |
| NULL `draft_kind` | **0** |
| source-owned rows with NULL `draft_kind` | **0** |
| NULL `draft_person_id` | **0** |
| source-owned rows with NULL `draft_person_id` | **0** |
| linked draft-pick rows (`player_id IS NOT NULL`) | **5,086** |
| NULL `pick_number` rows | **1,686** |

Pick → `draft_person` consistency:

| Measure | Value |
|---|---:|
| picks joined to a person | **6,810** |
| `player_url` mismatches (pick vs person) | **0** |
| `player_id` mismatches (pick vs person) | **0** |

Every pick resolves to a person, and no pick disagrees with its person on either identity
field. Identity is single-valued per person exactly as migration 019 intended.

**Durable reload key** — `(source_id, player_url, draft_year, draft_kind)`:

| Measure | Value |
|---|---:|
| collision groups | **0** |
| extra rows | **0** |

**CSV reconciliation key on the database side** —
`(draft_year, draft_kind, club_name_raw, player_name_raw)`:

| Measure | Value |
|---|---:|
| rows represented | **6,810** |
| distinct keys | **6,810** |
| collision groups | **0** |
| extra rows | **0** |

> This tuple is still, and only, the **CSV reconciliation key** (§2). It is **not** a durable
> source identity and must never become a reload key. It is built from rendered/display-level
> values — modern-identity club labels (§6) and names DraftGuru can re-render — and the fact
> that it happens to be unique on both sides is a *reconciliation* property, not an identity
> guarantee. The durable key remains `player_url`.

**NULL `pick_number` agreement:** the 1,686 NULL `pick_number` rows measured on `afldb_dev`
agree exactly with the independently profiled non-ordered DraftGuru event population in §1.5 —
Trade 990 + Pre-Draft 370 + Post-Draft 188 + Free Agency 138 = **1,686**. Two independent
artefacts (the rendered CSV export and the live database) agree to the row on which events are
unordered. Blank `#` is confirmed *not-applicable*, never *not-recorded*, and must stay NULL.

### Explicit human/admin decisions

Interpreted through the §4 correction — `player_link_resolutions` has **no `entity_type`
column**; draft decisions are found via:

```text
target_table = 'draft_picks'
target_id -> draft_picks.id -> draft_picks.draft_person_id -> draft_persons
```

Measured:

| Measure | Value |
|---|---:|
| resolutions | **6** |
| distinct targets | **6** |
| `action = 'linked'` | **5** |
| `action = 'confirmed_unlinked'` | **1** |
| `match_method` | **NULL for all six** |
| `algorithm_version` | **NULL for all six** |
| dangling resolution rows | **0** |
| dangling target IDs | **0** |
| target rows missing `draft_person_id` | **0** |
| target persons missing `player_url` | **0** |
| distinct persons covered | **6** |
| distinct `player_url` covered | **6** |
| `player_url` covered by `linked` | **5** |
| `player_url` covered by `confirmed_unlinked` | **1** |
| persons carrying conflicting actions | **0** |

Every one of the six decisions traverses cleanly to a person that has a `player_url`, so all
six are replayable against source-URL identity rather than against a surrogate id that will not
survive the rebuild.

> **The NULL `match_method` and `algorithm_version` values are historical provenance and must
> be preserved as NULL.** These decisions predate the migration 067 columns. **Do not invent
> later metadata when replaying them** — no back-filled `'manual'`, no synthetic
> `algorithm_version`, no reconstructed `match_score`. A replay that manufactures provenance
> falsifies the audit trail.

§4B still governs: only these explicit resolutions are replayable human decisions. Automatic
`unique` matches are **not** promoted to human provenance and must be re-earned by the new
importer on its own evidence.

### Canonical AFL Tables identity gate

Measured for the currently linked DraftGuru population:

| Measure | Value |
|---|---:|
| linked DraftGuru persons | **3,464** |
| distinct canonical players | **3,460** |
| canonical players with a usable AFL Tables identity | **3,392** |
| canonical players **without** a usable AFL Tables identity | **68** |
| canonical players with **multiple** AFL Tables identities | **0** |
| coverage | **98.03%** |

Measured across the complete AFL Tables external-identity source (`sources.key = 'afltables'`):

| Measure | Value |
|---|---:|
| external identities | **12,472** |
| distinct `external_id` | **12,472** |
| identities without a player | **0** |
| `external_id` assigned to multiple players | **0** |
| players carrying multiple AFL Tables `external_id` | **0** |
| `status` | **`unique` for all 12,472** |
| `match_method` | **`afltables_profile_url` for all 12,472** |

The AFL Tables identity mechanism is therefore perfectly bijective on its own terms: one
`external_id`, one player, no orphans, no collisions, one match method.

### Step 1 conclusion

**The DraftGuru side of the durable identity gate PASSES:**

- complete `player_url` coverage (0 missing, 0 blank across 5,057 persons);
- unique person URLs (5,057 distinct for 5,057 persons, 0 duplicate groups);
- zero reload-key collisions on `(source_id, player_url, draft_year, draft_kind)`;
- exact **6,810-row parity** with the new CSV corpus, and 42-for-42 year parity;
- human resolution targets are intact and fully traversable (0 dangling, 0 NULL
  `draft_person_id`, 0 missing `player_url`, 0 conflicts).

**The AFL Tables external-identity mechanism also has perfect uniqueness** — 12,472 identities,
12,472 distinct ids, no orphans, no multi-player ids, no multi-id players.

**However, the proposed complete source-to-source crosswalk**

```text
DraftGuru player_url
  -> canonical AFLDB player
  -> AFL Tables external identity
```

**is NOT YET proven complete**, because **68 of the 3,460 linked canonical players currently
have no qualifying AFL Tables external identity**. At 98.03% coverage the crosswalk is strong
but not total, and §5 requires it be proven, not assumed.

**There is a second residual requiring explanation:** **3,464 linked DraftGuru persons resolve
to only 3,460 distinct canonical players.** Therefore **at least four extra DraftGuru-person
mappings converge onto canonical players already claimed by another DraftGuru person.**

> **Do NOT label those convergent mappings erroneous or legitimate yet.** Convergence has both
> innocent explanations (duplicate DraftGuru URLs for one real person; historical/source
> aliases) and defective ones (an incorrect old link, or a name-collision fusion of the exact
> kind the URL ordinal exists to prevent, §3). Nothing in Step 1 distinguishes them.

**Both residuals must be investigated before the carry-forward crosswalk contract (§4A/§4B) is
approved.** Neither is a §12 stop condition on its own — 98.03% is not "a material rate" of
missing canonical identity, and four convergences are not yet evidence of unsafe collision —
but both are unexplained, and §5 forbids designing around an unproven crosswalk.

### Updated pending gate

**Step 2 (live DraftGuru acquisition probe, §11) is NOT started and must not start yet.**

Before Step 2, perform **one additional read-only residual audit against `afldb_dev`**, under
the same envelope as Step 1 (`PGOPTIONS` read-only, `psql -X`, `ON_ERROR_STOP`,
`REPEATABLE READ READ ONLY`, `ROLLBACK`, `afldb_test_pre_rebuild_20260825` untouched), to
determine:

**Residual A — the 68 canonical players with no AFL Tables identity**

1. why those 68 linked canonical players lack an AFL Tables external identity;
2. whether they carry another durable AFL Tables/profile identity elsewhere (a non-`unique`
   status, a different `match_method`, or a different source);
3. whether they are historical, non-playing, or otherwise special cases (debut era, single-game
   careers, AFLW, VFL/state-league-only, recent seasons not yet enriched);
4. whether the absence is **expected** (a documented boundary of the fitzRoy/AFL Tables
   enrichment) or represents **missing identity enrichment** (a gap to be closed).

**Residual B — the four-or-more convergent person mappings**

5. how many canonical players are linked from **more than one** DraftGuru person, and the size
   distribution of those groups;
6. whether those convergent mappings represent
   - duplicate DraftGuru URLs for one real player,
   - historical/source aliases,
   - incorrect old links,
   - or another explainable case;

and, for each group, which link route produced it (`link_status`, `match_method` on
`draft_persons`, and whether any explicit `player_link_resolutions` decision is involved) —
because a convergence created by a **human** decision and one created **automatically** carry
different weight under §4B.

> **Do not export the mappings yet. Counts and categories first.** No `player_url`, no
> `external_id`, no player names, no ids leave the database at this stage. An export, if it is
> ever justified, is a separate deliberate decision under §4A.

The §12 stop conditions remain in force and are re-evaluated after the residual audit.

---

## Residual audit — COMPLETE

**Executed 2026-08-26. The user personally ran the residual audit against `afldb_dev` under the
same read-only controls as Step 1** — `afldb_dev` / `afldb_owner`, `PGOPTIONS
-c default_transaction_read_only=on`, `psql -X`, `ON_ERROR_STOP=1`, one
`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` ending in `ROLLBACK`, an in-SQL
`DO` guard on `current_database() = 'afldb_dev'` and both read-only settings,
`afldb_test_pre_rebuild_20260825` never accessed, and **counts/categories only — no player
names, `player_url` values, external ids, target ids or mappings printed.** Claude ran no
command; it prepared the SQL and evaluated the returned output.

### Residual A — the 68 canonical players without a qualifying AFL Tables identity

The target set **reproduced exactly**, independently re-derived rather than carried over:

| Measure | Value |
|---|---:|
| linked canonical players from DraftGuru | **3,460** |
| without a qualifying AFL Tables identity | **68** |

**External identity findings**

| Measure | Value |
|---|---:|
| target players | **68** |
| with a **non-qualifying** `afltables` identity row | **0** |
| with **no `afltables` identity row at all** | **68** |
| with an identity from **another** source | **0** |
| with **no `external_identities` row from any source** | **68** |

> **This is NOT a status-filter problem.** The qualifying predicate
> (`status IN ('unique','resolved')`) excludes nobody here: the rows simply do not exist. No
> widening of the status filter, and no alternative source, recovers a single one of the 68.

**Match participation**

| AFLDB games | Players |
|---|---:|
| 0 | **2** |
| 1 | **6** |
| 2–5 | **20** |
| 6–20 | **20** |
| 21–50 | **8** |
| 51–100 | **9** |
| 100+ | **3** |
| **total** | **68** |

**Recency**

| Group | Players |
|---|---:|
| never appeared in AFLDB match data | **2** |
| last played **before 2000** | **63** |
| last played **2023 or later** | **3** |
| **total** | **68** |

- earliest observed first-played season in the historical group: **1981**;
- latest observed last-played season in the historical group: **1996**;
- the recent group includes **2026** match participation.

The population is therefore bimodal: a large historical body (1981–1996) and a very small
current-edge group.

**Draft-side linkage**

| Measure | Value |
|---|---:|
| `draft_persons` with `link_status = 'unique'` | **60** |
| `draft_persons` with `link_status = 'resolved'` | **8** |
| canonical players in this set touched by an explicit `player_link_resolutions` row | **3** |
| of those explicit decisions, `action = 'linked'` | **3 (all)** |
| of those explicit decisions, `action = 'confirmed_unlinked'` | **0** |

**Draft-era distribution** (a player can appear in more than one decade, so the player counts
do not sum to 68)

| Draft decade | Pick rows | Players |
|---|---:|---:|
| 1980s | **35** | **34** |
| 1990s | **48** | **36** |
| 2020s | **5** | **5** |

**Conclusion — Residual A**

**The 68 are overwhelmingly real AFL/VFL match-playing canonical players, not draft-only rows
incorrectly manufactured as canonical players.** Only 2 of 68 never appeared in AFLDB match
data; 66 played, 20 of them more than 20 games and 12 more than 50.

The evidence is **most consistent with an external-identity enrichment/coverage gap** —
concentrated at the historical edge (63 of 68 last played before 2000, drafted in the 1980s and
1990s) with a small current-edge group of 3 still playing in 2023+. That is the classic shape of
a coverage boundary at both ends of an enrichment pass, not of a linking defect.

> **The schema does not establish WHY the external identity is absent**, and nothing here proves
> whether an AFL Tables profile exists upstream but was never ingested, or does not exist at
> all. **Do not claim the 68 are resolved.** They are *characterised*, not *explained*.

The complete crosswalk

```text
DraftGuru player_url
  -> canonical player
  -> AFL Tables external identity
```

therefore **remains incomplete**: 68 canonical players have **no durable canonical-side external
identity in `external_identities` at all**, from any source.

**Provenance discrepancy — preserve, do not explain away**

> **8 `draft_persons` in this set are marked `link_status = 'resolved'`, but only 3 of the
> corresponding canonical players are touched by an extant explicit `player_link_resolutions`
> row.** `resolved` is the status the schema reserves for a human decision (migration 019), so
> at least five `resolved` statuses have no surviving explicit decision behind them.
>
> **Do not invent an explanation for the other resolved statuses.** They may predate migration
> 056, may have been set by an earlier tool, or may have lost their audit rows. Nothing measured
> distinguishes these. **Preserved as a historical provenance residual for later
> reconciliation**, and a reminder that `link_status = 'resolved'` is *not* by itself proof of a
> replayable human decision — §4B's rule (only extant explicit `player_link_resolutions` rows
> are replayable) is what holds.

### Residual B — the convergent DraftGuru-person mappings

**Headline**

| Measure | Value |
|---|---:|
| linked `draft_persons` | **3,464** |
| distinct canonical players | **3,460** |
| excess DraftGuru-person mappings | **4** |

**Exact structure**

| Measure | Value |
|---|---:|
| canonical players with more than one linked `draft_person` | **4** |
| `draft_persons` per such player | **exactly 2, in every case** |
| `draft_persons` involved | **8** |
| excess person mappings | **4** |

**Identity characteristics**

- all four groups contain **2 distinct `player_url` values**;
- **no repeated `player_url`** within a group;
- all four groups have a **single shared `name_key`**;
- **no repeated `dg_person_id`** within a group;
- **all four pairs share the same `player_url` base after removing the trailing ordinal**;
- therefore **the two URLs in each pair differ exactly at the same-name disambiguating
  ordinal/URL suffix level**.

This is precisely the mechanism §3 identifies as DraftGuru's own same-name separator: *"whose
trailing ordinal disambiguates same-name people"*. Two URLs differing only in that ordinal are
DraftGuru asserting **two different people**.

**Draft/event chronology**

| Property | Groups |
|---|---:|
| draft-year overlap | **1** |
| no draft-year overlap | **3** |
| same-year **and** same-`draft_kind` overlap | **0** |
| confined to a single year | **0** |
| span 1–3 years | **2** |
| span 4–10 years | **1** |
| span more than 10 years | **1** |

**Link provenance**

| Measure | Value |
|---|---:|
| `draft_persons` with `link_status = 'unique'` | **8 (all)** |
| with an explicit `player_link_resolutions` row | **0** |
| `linked` decisions | **0** |
| `confirmed_unlinked` decisions | **0** |

**No human/admin decision supports any of these four convergences.** Every one is an automatic
link.

**Additional evidence**

- all four groups have **different `reported_games` values between their two DraftGuru
  persons** — the source itself describes two different careers;
- all four canonical players **do** hold qualifying AFL Tables identities;
- **none belongs to the 68-player missing-identity residual** — the two residuals are disjoint;
- all four canonical players are real match-playing players: **1** with 1–20 AFLDB games,
  **2** with 21–100, **1** with 100+.

### Residual B conclusion

**Do NOT classify the four convergences as legitimate carry-forward mappings.**

The combination of

- the same normalised name (`name_key`) across the pair;
- two **distinct** DraftGuru player URLs;
- the **same URL base with a different trailing ordinal** — DraftGuru's own same-name separator;
- **differing DraftGuru `reported_games`** between the two persons;
- **no human resolution** of any kind;
- **automatic `unique` linkage only**;
- and one pair spanning **more than ten draft years**

is **strong evidence that these are potentially different same-name DraftGuru people that the
old automatic linker converged onto one canonical AFLDB player.** §3 measured this exposure in
advance: roughly 59 names in the corpus belong to two different people, and these four sit
exactly where that risk lives.

**This is not yet proof that all four old mappings are wrong**, because the live DraftGuru
profiles have not been inspected. A shared ordinal base can also arise from DraftGuru holding
two pages for one real person.

**Classification:**

> ### SUSPECT AUTOMATIC HISTORICAL CONVERGENCES — MUST BE RE-EARNED

**They must NOT be replayed as identity truth into the rebuild.**

This reinforces the previously approved §4 rule, now with measured support:

- **explicit human decisions** may be replayed when their durable identities can be expressed
  safely;
- **automatic links are audit/reconciliation baseline only** (§4A);
- **the new importer/linker must re-earn automatic links** on its own evidence;
- **name-only matching is never sufficient** — these four are what name-driven convergence looks
  like when the URL ordinal is ignored.

### Updated gate status

| Gate | State |
|---|---|
| Step 1 `afldb_dev` identity audit | **COMPLETE** |
| Residual audit | **COMPLETE** |
| DraftGuru `player_url` identity completeness / uniqueness | **PASSED** |
| AFL Tables external-identity uniqueness | **PASSED** |
| Complete DraftGuru → AFL Tables crosswalk coverage | **FAILED / INCOMPLETE — 68 gaps** |
| Old automatic convergence integrity | **NOT TRUSTED FOR REPLAY** |
| Step 2 live DraftGuru source probe | **READY** |

> **The incomplete 68-player AFL Tables crosswalk is NOT a blocker to DraftGuru source
> reacquisition.** Reacquiring DraftGuru depends on DraftGuru's own durable identity
> (`player_url`), which passed completely and uniquely; it does not depend on the canonical
> side.
>
> **It IS a blocker to designing a universal canonical-side replay artifact based solely on AFL
> Tables external identities.** Any such artifact would silently drop 68 linked players, or
> would have to carry a documented secondary anchor and an explicit partial-coverage contract
> (§5). That decision is still to be taken deliberately, and is not taken here.

---

## Next boundary — Step 2 live DraftGuru source probe

**Purpose: NOT to acquire the corpus.** Step 2 is the smallest probe that proves whether the
live/richer DraftGuru source still exposes the durable `player_url` identity the browser-export
CSV stripped (§2).

It must determine:

1. the authoritative annual DraftGuru page/source URL pattern;
2. whether player cells contain `href`/player URLs;
3. whether those URLs preserve the trailing same-name disambiguation ordinal;
4. whether the same rendered player name can appear with **distinct durable URLs**;
5. whether the richer source avoids the CSV export artefacts already measured (§1.3: NBSP, ZWSP,
   `↧`, `1.0` float formatting, CP1252 mojibake);
6. whether club links/identifiers are available;
7. whether richer source data exposes **trade-origin information** not represented by the CSV
   table export (§7, still unresolved).

**The probe must include at least one same-name / ordinal-disambiguated DraftGuru identity
case** — a page where every name is unique would prove only that hrefs exist, not that they
resolve the cases where names are unsafe.

Constraints for the probe:

- it may inspect **publicly available DraftGuru source content**;
- **do not write files yet**;
- **do not build an acquisition adapter**;
- **do not modify the raw CSV snapshot** (§1);
- **do not touch PostgreSQL**;
- **do not use `AFLDB_LEGACY_SQLITE`**.

**Selecting the same-name case.** The four suspect convergent groups (Residual B) are the
highest-value probe targets: they are the exact cases where DraftGuru's ordinal must be shown to
separate two people. Identifying them requires a **narrowly scoped READ-ONLY `afldb_dev` query
outputting only the minimum public DraftGuru URL/name information needed to fetch the pages** —
no ids, no canonical player identifiers, no other population. That query is proposed for the
user to run; Claude does not run it. This is the first and only point in ISSUE-093 at which any
identity value leaves the database, it is scoped to 8 rows, and every value in it is already
public on DraftGuru.

---

## Step 2 target selection — COMPLETE

**Executed 2026-08-26 by the user.** A narrowly scoped read-only `afldb_dev` lookup exposed
**only the DraftGuru-public identities** for the four suspect automatic convergence groups
(Residual B).

Envelope: `afldb_dev` / `afldb_owner`, `default_transaction_read_only = on`,
`transaction_read_only = on`, `REPEATABLE READ`, `psql -X`, `ON_ERROR_STOP`, `ROLLBACK`.
`afldb_test_pre_rebuild_20260825` was not accessed.

> **No canonical player ids, AFLDB internal ids (`draft_persons.id`, `dg_person_id`,
> `players.id`), external ids, `target_id` values, canonical player names, or unrelated rows
> were exported.** Every value below is already public on DraftGuru.

Exactly 8 DraftGuru-person rows across 4 groups:

### Adam Houlihan

| | Person 1 | Person 2 |
|---|---|---|
| URL | `https://www.draftguru.com.au/players/adam_houlihan/1` | `https://www.draftguru.com.au/players/adam_houlihan/2` |
| `reported_games` | **94** | **0** |
| Draft years | 1994, 2001 | 1990 |
| Draft kinds | `national`, `pre_draft` | `national` |
| Clubs | Geelong, Richmond | Essendon |

### Andrew Hill

| | Person 1 | Person 2 |
|---|---|---|
| URL | `https://www.draftguru.com.au/players/andrew_hill/1` | `https://www.draftguru.com.au/players/andrew_hill/2` |
| `reported_games` | **0** | **1** |
| Draft years | 2001 | 2000 |
| Draft kinds | `rookie` | `rookie` |
| Clubs | Collingwood | Collingwood |

### Brad Miller

| | Person 1 | Person 2 |
|---|---|---|
| URL | `https://www.draftguru.com.au/players/brad_miller/1` | `https://www.draftguru.com.au/players/brad_miller/2` |
| `reported_games` | **157** | **0** |
| Draft years | 2001, 2010 | 2001 |
| Draft kinds | `national`, `rookie` | `rookie` |
| Clubs | Melbourne, Richmond | Richmond |

### Michael Brown

| | Person 1 | Person 2 |
|---|---|---|
| URL | `https://www.draftguru.com.au/players/michael_brown/1` | `https://www.draftguru.com.au/players/michael_brown/2` |
| `reported_games` | **22** | **0** |
| Draft years | 1995 | 1996 |
| Draft kinds | `pre_draft` | `rookie` |
| Clubs | Fremantle | Geelong |

Note the URL form measured here: `https://www.draftguru.com.au/players/<slug>/<ordinal>` — the
ordinal is a **path segment**, not a query parameter or a suffix on the slug. Note also that the
stored `draft_kind` vocabulary is snake_case (`national`, `pre_draft`, `rookie`), i.e. AFLDB's
normalised form, not DraftGuru's rendered `National` / `Pre-Draft` / `Rookie` wording (069
L34–37).

## Target-selection conclusion

**All four convergence groups contain two genuinely distinct DraftGuru source identities:**

- the same rendered/normalised player name;
- the same URL base;
- a **different trailing ordinal**;
- a **different `player_url`**;
- **different `reported_games`** values.

In every one of the four pairs the games figures are incompatible with the two rows describing
one career (94/0, 0/1, 157/0, 22/0), and in three of the four the clubs differ as well.

**This materially strengthens the classification:**

> ### SUSPECT AUTOMATIC HISTORICAL CONVERGENCES — MUST BE RE-EARNED

> **Do not yet state that the old AFLDB mappings are definitively wrong.** The live DraftGuru
> profiles have not been inspected. DraftGuru's own ordinal could still, in principle, separate
> two pages describing one real person.

### First live-source probe target: Brad Miller

Selected because:

- both DraftGuru identities share the same rendered name;
- **both have 2001 draft activity**, so a single annual page can be inspected for both;
- the URLs differ **only** by ordinal;
- `reported_games` differs sharply (**157 vs 0**);
- the pair therefore provides a strong direct test that the ordinal represents **meaningful
  person disambiguation** rather than an arbitrary duplicate page.

---

## Step 2 live DraftGuru source probe — COMPLETE

### Probe targets

Read-only HTTP inspection, 2026-08-26, covered:

- `https://www.draftguru.com.au/players/brad_miller/1`
- `https://www.draftguru.com.au/players/brad_miller/2`
- the DraftGuru **2001 annual draft/trade page** (`https://www.draftguru.com.au/years/2001`)

**No files were written. No adapter was built. No PostgreSQL was accessed. No
`AFLDB_LEGACY_SQLITE` was used.** No other page was fetched; this was not a crawl.

### Durable identity result

**Both Brad Miller profile URLs resolve successfully and represent distinct DraftGuru people.**

**DraftGuru person `/players/brad_miller/1`**

- page identifies **Brad Miller born 1983**;
- DOB **06 Jul 1983**;
- height **194cm**;
- originally from **Mount Gravatt**;
- career games **157**;
- **Melbourne 133 / Richmond 24**;
- **2001 National #55 Melbourne**;
- later Richmond rookie transaction (2010 Rookie #28, after a 2010 Melbourne delisting).

**DraftGuru person `/players/brad_miller/2`**

- page identifies Brad Miller as a **distinct same-name record** (page titled *"(number 2)"*);
- **no DOB shown**;
- originally from **Western U18 / Western Jets**;
- career games **0**;
- **2001 Rookie #30 Richmond**;
- later delisted (2002).

**Therefore the ordinal path component is meaningful source identity.** The two records differ
on origin club, pick number *within the same draft year*, career totals, grade and DOB
presence — DraftGuru is describing two people, and the `/1` vs `/2` segment is how it says so.

### Annual-page identity result

On the same 2001 annual page:

| Rendered name | Row | href |
|---|---|---|
| Brad Miller | National Draft #55, Melbourne | `/players/brad_miller/1` |
| Brad Miller | Rookie Draft #30, Richmond | `/players/brad_miller/2` |

Thus:

- the **rendered player name is identical**;
- the **href is different**;
- **both hrefs are present directly in server-returned HTML**;
- **JavaScript is not required to recover identity** (the probe executes no JS and still
  received the fully populated table with every href);
- hrefs are **root-relative** (`/players/<slug>/<ordinal>`);
- acquisition can normalise them against `https://www.draftguru.com.au`.

Other player hrefs observed on the same page confirm the pattern and that the ordinal is not
always `1`: `/players/daniel_bandy/1`, `/players/luke_hodge/1`, `/players/chris_judd/1`,
`/players/gary_ablett/2`, `/players/sam_mitchell/1`.

> **The browser/table CSV export destroyed the precise identity distinction that the live
> annual HTML preserves.** In the CSV these two rows are two lines of identical text differing
> only in club, event and pick number; in the source they are two different people with two
> different durable URLs. This is the single fact that makes the CSV unusable as canonical
> identity data (§2) and the live HTML usable.

### Old automatic convergence conclusion

The **Brad Miller** convergence is upgraded from

> SUSPECT AUTOMATIC HISTORICAL CONVERGENCE

to

> ### PROVEN INCORRECT AUTOMATIC HISTORICAL CONVERGENCE

**Reason:** two distinct DraftGuru source people, distinguished by DraftGuru itself using
different ordinal player URLs and different biographical/career records, were automatically
linked to **one** canonical AFLDB player.

> **Do NOT automatically classify the Adam Houlihan, Andrew Hill or Michael Brown pairs as
> proven wrong from this result alone.** They remain
> **SUSPECT AUTOMATIC HISTORICAL CONVERGENCES — MUST BE RE-EARNED** unless independently
> proven.

**This confirms the design rule:**

> ## OLD AUTOMATIC DRAFT LINKS MUST NOT BE REPLAYED AS IDENTITY TRUTH.

- Only **explicit durable human decisions** may be replayed as decisions (§4B).
- **Automatic mappings are reconciliation/audit evidence only** (§4A) and must be **re-earned**
  by the new linker on its own evidence.

### Club links

The annual HTML exposes destination-club links/slugs such as `/clubs/western-bulldogs`.

These are useful source identifiers, but they remain **modernised DraftGuru identities**. They
**do NOT remove the need for era-aware AFLDB club resolution** (§6), especially `Brisbane`
(Bears ≤1996 vs Lions 1997+) and the other historical identity/name transitions
(Footscray/Western Bulldogs, South Melbourne/Sydney, Kangaroos 1999–2002).

### Trade information

Correcting the earlier uncertainty in §7:

- the live 2001 annual page has a **16-column** table, whereas the browser-export CSV has
  **15** columns;
- the live-only final column is **`Trade`**;
- for 2001 it is **empty on every inspected row, including `Trade` rows**, and carries no
  links;
- the 2001 page therefore **does not supply previous-AFL-club origin information** through that
  column;
- `Original Club` remains **recruiting-pathway** information, not previous AFL club — the
  sampled 2001 trade row's `Original Club` read `Brisbane Boys' College/Kedron Grange`.

Two consequences: the browser export **silently dropped an entire source column**, and

> **Do NOT generalise that the `Trade` column is empty for all years.** The full acquisition
> must **profile it across all annual pages** before any semantic or database destination is
> assigned to it.

### Encoding

- The **`# ↧` glyph exists in the live page itself** — the header is `# ↧` in the source.
- Therefore **that glyph is not solely a browser-export artefact** and an acquisition parser
  must expect it in real source headers.
- **NBSP / ZWSP / mojibake provenance remains unresolved**: the probe normalised HTML to text
  rather than exposing original response bytes, so the bytes that would settle it were gone
  before inspection.
- **Raw-byte acquisition must settle encoding behaviour** (§5 of the acquisition runbook).

### Potential DraftGuru → AFL Tables bridge

Unplanned finding: **`/players/brad_miller/1` contains a link to an AFL Tables profile URL** of
the form

```text
http://afltables.com/afl/stats/players/B/Brad_Miller.html
```

This resembles the identifier AFLDB's `external_identities` stores with
`match_method = 'afltables_profile_url'` (normalised to the `players/A/Name.html` path, §5).

> **Measured on ONE DraftGuru person only. Do NOT generalise it to the corpus.**

The acquisition/validation phase must measure:

- how many DraftGuru person pages expose an AFL Tables profile link;
- uniqueness of those links;
- whether links are available for the **68** currently missing canonical-side identities;
- whether zero-game DraftGuru people appropriately lack one.

### Step 2 conclusion

| Gate | State |
|---|---|
| Live DraftGuru durable `player_url` source | **PASSED** |
| Server-rendered href availability | **PASSED** |
| Same-name ordinal disambiguation | **PASSED** |
| CSV suitability as canonical identity source | **FAILED** |
| Richer HTML suitability for acquisition | **PROVISIONALLY PASSED** |
| Full identity-complete snapshot | **NOT YET ACQUIRED** |
| Acquisition adapter/runbook | **NEXT** |

"Provisionally" is deliberate: one year page and two person pages passed. Schema stability
across all 42 years, the `Trade` column's real semantics, and raw-byte encoding behaviour are
unmeasured and are validation obligations of the acquisition itself, not settled facts.

The approved acquisition execution runbook is **`AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md`**.
