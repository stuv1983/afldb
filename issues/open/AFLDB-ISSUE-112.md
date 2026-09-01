# AFLDB-ISSUE-112 — Replace legacy SQLite honours acquisition with curated manifests

**Status: Open. Design only. NOT implemented.**
**Parent:** `AFLDB-ISSUE-102` (`issues/open/AFLDB-ISSUE-102.md`).
**Severity:** Medium — **Area:** Data acquisition / Import architecture / Data integrity.
**Created:** 2026-08-30 (ISSUE-102 pass 2, operator-authorised).

Replace the `AFLDB_LEGACY_SQLITE` input of the six legacy-dependent `import_awards.py` groups
with checked-in, validated, reviewable reference manifests — preserving every existing reload,
ownership and player-link guarantee, and restoring the data on a canonical rebuild.

**`AFLDB-ISSUE-110` is a different, unmerged issue. Do not use that id.**

---

## 1. Approved direction and its limits

Operator decision 2 approves **curated manifests**. Explicitly **not** authorised without a
separate decision: runtime scraping, brittle HTML parsing, paid APIs, undocumented endpoints.

Why manifests are the right class here (evidence, not preference):

- The 2026 acquisition investigation found **no free structured API** for any of these families
  (`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §2.7, §3). The only free authorities are the
  same three HTML scrapes the legacy database aggregated: `draftguru`, `wikipedia`, `footywire`.
- The facts are **append-mostly and low-frequency**: one Hall of Fame intake a year, one
  All-Australian team, one Rising Star winner, ~18 club best-and-fairests, ~18 captaincies.
  `team_selections` is 113 rows *in total*.
- The historical tail is **immutable**. The 1979 All-Australian team will not change.
- AFLDB already runs two curated manifests successfully (§3).
- A manifest is reproducible from the repository; a scrape of a wiki page is not.

The honest cost: annual maintenance, and a one-time extraction to create each manifest. That
extraction is **out of scope for this pass** and is called out as an operator prerequisite (§11).

---

## 2. Families in scope — verified names and grains

Seven families, from `GROUPS` (`tools/migration/import_awards.py:1320-1328`) and each loader's
`reload_keyed(...)` call. **Grains differ, so manifest schemas differ** (§4.2).

| # | Family | Group | Legacy table(s) | Target table | Grain | Reload key | Provenance source key | Legacy rows |
|---|---|---|---|---|---|---|---|---|
| 1 | All-Australian | `all_australian` | `all_australian`, `all_australian_history` | `award_winners` | season × selection slot | `(source_id, source_record_id)` | `draftguru` + `wikipedia` | 906 + 1,252 |
| 2 | Hall of Fame | `hall_of_fame` | `hall_of_fame` | `hall_of_fame` | person × induction | **`(name, inducted_year)`** + `refuse_out_of_scope_key=True` | `wikipedia` | 343 (34 Legends, 241 linked) |
| 3 | Honour teams | `honour_teams` | `team_selections` | `honour_team_members` | team × member | **`(team_name, player_name_raw)`** | `wikipedia` | 113 |
| 4 | Captaincies | `captaincies` | `captaincies` | `captaincies` | season × club × person × role | `(source_id, source_record_id)` | `wikipedia` | 1,375 (all linked) |
| 5 | Rising Star | `rising_star` | `rising_star_nominees` | `award_nominations` | season × round × nominee | `(source_id, source_record_id)` | `footywire` | 766 |
| 6 | Club best-and-fairest | `awards` | `awards` (`award_category = 'club_best_and_fairest'`) | `awards` (`bf-*`) + `award_winners` | award × season × winner | slug / `(source_id, source_record_id)` | `draftguru` | subset of 1,810 |
| 7 | Named medals & other `award`/`draft_pick` rows — Brownlow medal row, Norm Smith, AFLPA MVP, Magarey, Sandover, Liston, Morrish, Larke, Hunter Harrison, National Draft Pick #1 | `awards` | `awards` | `awards` + `award_winners` | award × season × winner | slug / `(source_id, source_record_id)` | `draftguru` | subset of 1,810 |

Also owned by this issue: the **award definitions** themselves (`awards` table, keyed on `slug`,
`link_columns=None`) and the **person-link bridge** (`person_links` / `dg_people`, currently read
by `load_person_links()` at `import_awards.py:1364-1376`), which must be replaced by the tracked
DraftGuru ledger rather than reimplemented.

`docs/search.md:220` records 40 award definitions in a loaded database. `docs/data-dictionary.md:191`
warns that in the legacy `awards` table *"most series begin 1980"* — **coverage per award is a
measured value and must be captured per family before a manifest is built** (§10 G0).

### 2.1 Explicitly out of scope

- **Coleman** — `AFLDB-ISSUE-111` derives it.
- **22 Under 22** — already legacy-free; it is the precedent, not a target.
- **Brownlow round votes** — canonical via `import_fitzroy_core.py`.
- **The Brownlow *season-total* rows in `brownlow_season_votes`** — `AFLDB-ISSUE-113`.
  Note family 7 includes the Brownlow **award-winner** row in `award_winners`, which is a
  different record from `brownlow_season_votes.is_winner`. Keep them distinct; ISSUE-112 must not
  attempt to source season vote totals.

---

## 3. Precedents to follow

| Precedent | What to copy | What to improve on |
|---|---|---|
| **22 Under 22** — `data/awards/22-under-22.csv`, `tools/migration/under_22.py`, `import_awards.py` group `under_22` | fully tracked CSV (whitelisted at `.gitignore:38-40`); validating parser that raises `Under22SourceError` with **no best-effort coercion**; assigned stable id `22under22:YYYY:pos:slot`; own `sources` row (migration 060); pre-flight capture of existing manual resolutions before a shared-family rebuild (`import_awards.py:1486-1503`) | its slot-position identity suits a fixed-formation team; other families need their own shapes |
| **first-kick-goal** — `tools/records/import-first-kick-goal.ts`, `data/records/first-kick-goal-ids.csv` | `--assign-ids` (allocate, never regenerate); `--accept-rename`; `--accept-retirement`; `data_issues` rows for source disagreements rather than silent correction; `--check` mode that needs no database | it tracks only the **ID manifest** — the extract itself is gitignored, so its facts are not reproducible from the repo. **Do not copy that.** Track the full facts, as 22 Under 22 does. |

---

## 4. Manifest architecture

### 4.1 Location — follow existing conventions

Three tracked data conventions exist today:

| Path | Loader | Shape | Player links? | Reload |
|---|---|---|---|---|
| `data/reference/*.json` | `tools/migration/load_reference_data.py` | JSON | **no** | TRUNCATE + reload |
| `data/awards/*.csv` | `tools/migration/under_22.py` → `import_awards.py` | CSV | **yes** | `reload_keyed` |
| `data/records/*.csv` | `tools/records/import-first-kick-goal.ts` | CSV | **yes** | keyed upsert |

**`data/reference/` is the wrong home.** `load_reference_data.py` TRUNCATEs its targets and has
no link-decision handling at all — it is for static data with no player identity. These families
are link targets.

**Use `data/awards/`**, extending the existing `.gitignore` whitelist pattern
(`!/data/awards/`, `/data/awards/*`, then one `!` line per tracked file). CSV, matching the
22 Under 22 precedent, with a header row and one file per family.

### 4.2 Per-family schema — do not force one shape

Common columns every manifest carries:

| Column | Rule |
|---|---|
| `source_key` | the stable record id; unique within the file; assigned once, never regenerated |
| `player` | the **source's own spelling**, retained verbatim — it is what `reload_keyed`'s name guard compares |
| `source_citation` | the specific upstream page/edition the row came from |

Family-specific additions:

| Family | Additional required columns |
|---|---|
| All-Australian | `season`, `position`, `club`, `is_captain`, `is_vice_captain` |
| Hall of Fame | `inducted_year`, `category`, `is_legend`, `legend_year`, `club`, `state`, `playing_career`, `removed_year` |
| Honour teams | `team_name`, `position`, `role`, `sort_order`, `club` |
| Captaincies | `season`, `club`, `role`, `period` |
| Rising Star | `season`, `round_number`, `club`, `opponent`, `is_winner`, `is_ineligible`, `ineligible_reason`, plus the stat line |
| Club B&F | `award_slug`, `season`, `club`, `votes` |
| Named medals | `award_slug`, `award_name`, `category`, `competition`, `season`, `club`, `votes` |

**A structural warning to carry into implementation.** Families 2 and 3 reload on *natural* keys
(`(name, inducted_year)` and `(team_name, player_name_raw)`), not on `source_record_id`. Their
target tables have no `source_record_id` column at all. So a `source_key` in those manifests is
an internal manifest key, **not** the database reload key, and the database key remains the raw
name. Renaming a person in those manifests is therefore still a link-losing event that
`reload_keyed` aborts on — exactly as today
(`awards-reload-links.test.ts:352`, `:401`). Do not "fix" this by adding a `source_record_id`
column to `hall_of_fame` or `honour_team_members`: migration 059 deliberately stopped treating
raw name as identity for honour teams, and changing those keys is a separate adjudication.

### 4.3 Stable identity

Assigned once per logical record and never regenerated, in the first-kick-goal mould:
`--assign-ids` allocates for genuinely new rows; a rename of a **decided** record requires an
explicit `--accept-rename`; a retirement requires `--accept-retirement`.

Proposed forms (family-appropriate, not uniform):
`allaustralian:YYYY:<pos>:<slot>`, `hof:<seq>`, `honourteam:<team-slug>:<seq>`,
`captaincy:<club-slug>:YYYY:<role>:<seq>`, `risingstar:YYYY:R<nn>`, `bf:<club-slug>:YYYY`,
`medal:<award-slug>:YYYY`.

### 4.4 Provenance

- Reuse the existing `sources` rows where they remain honest: `wikipedia` (2, 3, 4),
  `footywire` (5), `draftguru` (1, 6, 7). They are already registered in
  `data/reference/sources.json`, so **no new source row is required** and no migration is needed
  for provenance.
- **Do not invent a `manifest` source key.** The manifest is a transport, not an authority; the
  authority is still the upstream publication. Changing `source_id` would move the ownership
  scope every loader depends on and would orphan existing rows.
- Per-row `source_citation` in the manifest records *which* upstream page/edition, at a
  granularity `sources` cannot express.
- `import_batch_id` per run, unchanged.

---

## 5. Validation — the loader must reject, not coerce

Following `under_22.py`'s posture (`Under22SourceError`, no best-effort coercion), each family's
parser refuses on:

1. duplicate `source_key` within a file;
2. a season outside the `seasons` table, or outside the family's declared coverage;
3. a null/empty required key (`player`, `season`, `club` where semantically required);
4. duplicate **natural** identity — the same fact asserted twice under different keys (this is
   what protects the natural-keyed families 2 and 3, and `captaincies_natural_uq`);
5. malformed or missing provenance/citation;
6. an unsupported family/award/category/role value not in a declared vocabulary;
7. a `player` name change on a record that already carries a resolution decision — surfaced
   before any write, so a curator either supplies `--accept-rename` or fixes the manifest
   (this is the existing `reload_keyed` name guard, raised earlier and more legibly);
8. a declared per-family row-count or season-span expectation not met — the
   `EXPECTED_SEASONS` / `POSITION_SLOT_COUNTS` idea from `under_22.py:31-45`, which catches a
   truncated file.

A `--check` mode that parses and validates with **no database** must exist, as
`import-first-kick-goal.ts --check` does, so manifests can be reviewed anywhere.

---

## 6. Reload semantics

Reuse `tools/migration/common.py:410-703` `reload_keyed()` **without modification**. Every
guarantee in ISSUE-102 §6 applies: id preservation, pre-write decision classification,
fail-closed `LinkDecisionLoss`, the source-name-change guard, domain-AND-provenance ownership
scoping, `ReloadOwnershipCollision`, duplicate-key refusal, and the `(717275, 1)` advisory lock
for `honour_team_members`.

The change is **only the input**: `lite.execute("SELECT … FROM <legacy table>")` becomes
"parse the tracked manifest". Every `reload_keyed` call site keeps its current key, column list,
scopes and flags.

### 6.1 Removal policy — explicit

**A manifest row disappearing must never silently hard-delete linked or admin-owned data.**

| Case | Behaviour |
|---|---|
| Row vanishes, no decision on it, inside the ownership scope | deleted by `delete_missing=True` — current behaviour, acceptable |
| Row vanishes **and carries a link decision** | `reload_keyed` classifies it *"the source no longer carries this key"*, raises `LinkDecisionLoss`, and **nothing is written** (`:579-584`, `:610-617`). Preserve this. |
| Row is admin-owned (`manual_admin_edit`) or NULL-provenance | outside the ownership scope entirely — never touched |
| Row is deliberately retired | requires an explicit `--accept-retirement <id>` acknowledgement, in the first-kick-goal mould, with the retired id recorded |
| Row is referenced by an open `player_link_suggestions` tip | the loader already reads that table (migration 070, SELECT only) and must refuse to retire a referenced row unless the curator names it |

`--allow-link-loss` remains the only override and must stay itemised and deliberate. It must
**not** become part of any routine or scripted invocation.

---

## 7. Canonical rebuild

An AWARDS/HONOURS stage is added to `tools/db/rebuild-test.ts`, after DRAFTGURU (it needs
`players` and `clubs`; the person-link bridge needs the DraftGuru ledger) and before DERIVED.

- The stage runs `import_awards.py` with the manifest-backed groups and **no**
  `AFLDB_LEGACY_SQLITE` in its environment.
- Stage-9 FINAL VALIDATION gains per-family row-count gates, added **only once the manifests
  exist** — adding a gate before its data source would fail every canonical rebuild on a known
  gap (`AFLDB-ISSUE-093` §H15.5's rule for `club_seasons`).
- `tests/db-test-rebuild.test.ts:716` — *"carries no `AFLDB_LEGACY_SQLITE` anywhere in the
  plan"* — must still pass. **The legacy source must never be wired back in** (operator
  decision 8).
- The stage runs under the restricted `afldb_import` role, like every other data stage.

---

## 8. Privileges

**No privilege change is required or authorised.** The six target tables predate migration 045
and are in the seeded `afldb_meta.import_writable_tables` registry.
`player_link_resolutions` stays SELECT+INSERT (migrations 066/068);
`player_link_suggestions` stays SELECT (migration 070). If any future design needs a staging
table, it would require `afldb_meta.grant_import_write()` — raise it as a decision, do not add it.

---

## 9. Tests

| Kind | Home | Cases |
|---|---|---|
| Manifest parser/validation | new per-family DB-free suites in the `tests/under-22-source.test.ts` mould | every §5 refusal, one test each |
| Stable ID | same | format; uniqueness; `--assign-ids` allocates only for new rows and never regenerates |
| Duplicate detection | same | duplicate `source_key`; duplicate natural identity |
| Provenance validation | same | missing/malformed citation refuses; `source_id` resolves via `require_source` |
| Idempotent reload | `tests/integration/awards-reload-links.test.ts` | three consecutive runs, byte-identical row-id fingerprint |
| Manual-link preservation | same | a `linked` decision survives per family |
| `confirmed_unlinked` preservation | same | survives, and a source disagreement is reported not resolved |
| Source-name-change refusal | same | aborts without `--accept-rename`; the existing `:352` / `:401` cases become manifest-driven |
| Admin-owned row protection | same | a `manual_admin_edit` row survives every family's reload |
| Ownership collision | same | the existing `:824`-`:938` refusal matrix, manifest-driven |
| Removal policy | same | vanished-with-decision aborts; vanished-clean deletes; retirement needs acknowledgement |
| Advisory lock | same | the existing `:1080` block, unchanged |
| **Legacy independence** | same file's guards | **`canRunImporter` no longer requires `AFLDB_LEGACY_SQLITE`; the `:205-1247` matrix executes** — this is the headline acceptance test |
| Canonical rebuild | `tests/db-test-rebuild.test.ts` | the new stage is present, correctly ordered, legacy-free |
| Role parity | integration | the importer runs under restricted `afldb_import` via `tests/integration/import-role-parity.ts` |

---

## 10. Acceptance gates

| Gate | Statement |
|---|---|
| **G0** | Per-family coverage is **measured** read-only from a database that still holds the legacy-loaded data (row counts, season spans, linked/unlinked splits, distinct award slugs) and recorded, before any manifest is built. `docs/data-dictionary.md`'s counts are a cross-check, not the measurement. |
| **G1** | Each manifest parses, validates and round-trips to the same row set the legacy path produced — enumerated diffs only, each explained. |
| **G2** | `import_awards.py` runs all seven families with `AFLDB_LEGACY_SQLITE` **unset**. |
| **G3** | `awards-reload-links.test.ts` full matrix executes and passes with no legacy gate. |
| **G4** | Three consecutive reloads are idempotent with byte-identical row-id fingerprints per table. |
| **G5** | A before/after audit shows every `player_link_resolutions` decision on the five awards link-target tables still resolves to a live row, same person; `confirmed_unlinked` still reads unlinked. |
| **G6** | `npm run db:test:rebuild` restores all seven families, Stage-9 gated, with no legacy SQLite in the plan. |
| **G7** | `docs/deployment.md` §7 updated: `import_awards.py` no longer needs legacy SQLite. |
| **G8** | `tests/integration/privileges.test.ts` passes unchanged; no grant widened. |

---

## 11. Operator prerequisites and open questions

1. **Who performs the one-time extraction, and from where?** Building seven manifests requires
   the historical facts. Options: export them read-only from a database that still holds the
   legacy-loaded rows (lowest risk, no new acquisition, and the data is already AFLDB's);
   or re-extract from the upstream publications (a new acquisition, needs separate authorisation).
   **The export route is recommended and is not currently authorised — it needs a decision.**
   **DECIDED — operator, 2026-09-01 (ISSUE-112 G0 pass).** The one-time curated-manifest
   bootstrap extraction source is the **existing legacy-loaded AFLDB data** (the canonical
   PostgreSQL state that was loaded from `AFLDB_LEGACY_SQLITE`), **not** a fresh upstream scrape.
   This is a direction for ISSUE-112 architecture/implementation planning only; it authorises no
   export in the G0 pass and no manifest creation. The lossless-export assessment in §14.3
   evaluates that PostgreSQL state specifically.
2. **Phasing.** Seven families in one change is large. Recommended order, smallest and most
   isolated first: honour teams (113 rows) → Hall of Fame (343) → captaincies (1,375, already
   has its own ISSUE-085 ownership scoping and a fixture precedent) → Rising Star (766) →
   All-Australian (2,158) → club B&F → named medals. Each is independently shippable behind its
   own group.
3. **`person_links` replacement.** The DraftGuru ledger is tracked
   (`data/reference/draftguru-link-decisions.json`); confirm it covers the identities the awards
   families need before removing `load_person_links()`.
   **G0-measured 2026-09-01 (§14.6):** the ledger is **6 explicit decisions** (5 `linked`,
   1 `confirmed_unlinked`); 2,567 of 2,716 `draftguru`-sourced `award_winners` links (94.5%) are
   automatic and regenerated by the loader's scorer, not replayed from the ledger. The awards
   curation ledger `player_link_resolutions` (74 awards-scoped rows) is orphan-clean. The
   remaining row-by-row "covers every identity" proof is a **G1** step — `award_winners` does not
   retain the DraftGuru `player_url` bridge key, so it can only be checked when the loader
   re-resolves the manifest.
4. **Natural-keyed families.** Confirm that leaving `hall_of_fame` and `honour_team_members` on
   name-based reload keys is acceptable, or raise the key change as its own adjudication (§4.2).
   **G0-measured 2026-09-01 (§14.6):** data-safe today — `hall_of_fame (name, inducted_year)`
   dup = 0 and `name` alone dup = 0 (all 343 rows, incl. 45 NULL `inducted_year`);
   `honour_team_members (team_name, player_name_raw)` dup = 0 and `(team_name, player_id)`
   dup = 0. The only residual is the acknowledged rename-is-link-losing property
   (`awards-reload-links.test.ts:352`, `:401`).

---

## 12. Explicit exclusions

- No scraping, HTML parsing, API calls or external fetching of any kind in this issue.
- No acquisition of the actual historical data during design.
- No Coleman work (ISSUE-111); no Brownlow season totals (ISSUE-113).
- No change to `reload_keyed` or `common.py` semantics.
- No migration editing; no privilege change.
- No production or `afldb_dev` mutation. The §10 G0 measurement is read-only.

---

## 13. Status

Design recorded 2026-08-30. **Slice 1 (honour teams) IMPLEMENTED 2026-09-01 — Pass 7, §16;
DB-validated Pass 8, §17. Slice 2 (Hall of Fame) IMPLEMENTED and DB-validated 2026-09-01 —
Pass 9, §18. Slice 3 (captaincies) IMPLEMENTED and DB-validated 2026-09-01 — Pass 10, §19.
Slice 4 (Rising Star) IMPLEMENTED and DB-validated 2026-09-01 — Pass 11, §20.
The other three families (All-Australian, club best-and-fairest, named medals) remain not
implemented.**

- Operator prerequisite §11.1 (extraction source) — **DECIDED 2026-09-01**: the legacy-loaded
  AFLDB PostgreSQL state, not a fresh scrape.
- Gate **G0 per-family measurement — DONE 2026-09-01 (Pass 5, §14.6).** Executed read-only
  against `afldb_dev` via the streamanator dev server, connection proven, transaction rolled
  back. **All nine families (A, 1–7, L) PASS** — every measurement obtained and recorded (§14.4),
  no structural blocker to a manifest. Residual non-blocking items carried to G1 per family.
- §11.3 person-link ledger coverage — **partially resolved** (§14.6): the tracked ledger is
  6 explicit decisions; 94.5% of `draftguru` award links are automatic (regenerated by the
  scorer); the awards-side `player_link_resolutions` (74 rows) is orphan-clean. The row-by-row
  ledger-covers-every-identity proof is a **G1** item (the `player_url` bridge key is not
  retained in `award_winners`).
- §11.4 natural-key decision — **measurement supports leaving the keys as-is** (§14.6): zero
  collisions on `(name, inducted_year)`, `hall_of_fame.name` alone, `(team_name, player_name_raw)`
  and `(team_name, player_id)`. Only the rename-is-link-losing property remains as an operator
  policy acknowledgement (§14.5 item 2).
- **`source_citation` granularity — DECIDED 2026-09-01 (operator, Pass 7):** source-granularity
  provenance from the canonical source identity — the same policy now applies to the Hall of
  Fame slice (`wikipedia` for all 343 rows). This is explicitly **not** a per-row page/edition
  citation; PostgreSQL does not retain that, and legacy SQLite is not being reopened to
  reconstruct it.
- **Implementation phasing (§11.2) — honour teams (slice 1 of 7) IMPLEMENTED 2026-09-01** (§16),
  **DB-validated GREEN** (§17, 6/6 against real `afldb_test` under the restricted `afldb_import`
  role).
- **Implementation phasing (§11.2) — Hall of Fame (slice 2 of 7) IMPLEMENTED and DB-validated
  2026-09-01.** See §18. 343-row bootstrap extracted read-only from `afldb_dev` (proven), matching
  G0 exactly. `data/awards/hall-of-fame.csv` + `tools/migration/hall_of_fame.py` (validating
  DB-free parser). `import_hall_of_fame()` reads the manifest instead of legacy SQLite;
  `reload_keyed` key `(name, inducted_year)` / columns / scope / `refuse_out_of_scope_key` /
  advisory behaviour **byte-identical**; `"hall_of_fame"` added to `LEGACY_FREE_GROUPS` +
  `BATCH_SOURCE_KEYS`. DB-free 24/24, `tsc` clean, `git diff --check` clean; new
  `hall-of-fame manifest reload (AFLDB-ISSUE-112)` integration block **6/6 GREEN** against real
  `afldb_test` under `afldb_import` (343-row parity, 3× idempotent fingerprint, all five
  `player_link_resolutions` decisions survive, all 97 name-only rows stay unlinked,
  `manual_admin_edit` protection, other-family non-interference).
- **Implementation phasing (§11.2) — captaincies (slice 3 of 7) IMPLEMENTED and DB-validated
  2026-09-01.** See §19. 1,375-row bootstrap extracted read-only from `afldb_dev` (proven),
  matching G0 exactly. `data/awards/captaincies.csv` + `tools/migration/captaincies.py`
  (validating DB-free parser). `import_captaincies()` reads the manifest instead of legacy
  SQLite and **lost its `lite` parameter**; `source_record_id` is **preserved verbatim** as the
  manifest `source_key` (not re-minted); `reload_keyed` key `(source_id, source_record_id)` /
  columns / scope / `allow_link_loss`, `_refuse_captaincy_natural_key_collisions()` and
  `captaincies_natural_uq` semantics all **byte-identical / unchanged**; `club` is the canonical
  `clubs.name` re-resolved season-aware via `ClubResolver` (all 1,375 rows proved to round-trip
  — a rebuild-stable club identity, not a frozen `club_id`); `"captaincies"` added to
  `LEGACY_FREE_GROUPS` + `BATCH_SOURCE_KEYS`. DB-free 22/22, `tsc` clean, `git diff --check`
  clean; new `captaincies manifest reload (AFLDB-ISSUE-112)` integration block **8/8 GREEN**
  against real `afldb_test` under `afldb_import` (1,375-row parity, era re-resolution, 3×
  idempotent fingerprint, resolved-link id-stability, all rows stay linked, `manual_admin_edit`
  protection + natural-key collision fail-closed — both carrying the retired synthetic-SQLite
  fixture's AFLDB-ISSUE-085 coverage, manifest-driven — other-family non-interference); combined
  ISSUE-112 regression 20/20 (slices 1 & 2 not regressed).

- **Implementation phasing (§11.2) — Rising Star (slice 4 of 7) IMPLEMENTED and DB-validated
  2026-09-01.** See §20. 766-row bootstrap extracted read-only from `afldb_dev` (proven),
  matching G0 exactly. `data/awards/rising-star.csv` + `tools/migration/rising_star.py`
  (validating DB-free parser). `import_rising_star()` reads the manifest instead of legacy
  SQLite and **lost its `lite` parameter**; `source_record_id` (a 24-hex digest) is **preserved
  verbatim** as the manifest `source_key` (not re-minted); `reload_keyed` key
  `(source_id, source_record_id)` / the 16-column value list / `scope_column="award_id"` /
  the AFLDB-ISSUE-080 `scopes=[("source_id", [footywire], False)]` / `allow_link_loss` all
  **byte-identical / unchanged**; `club` / `opponent` are the canonical `clubs.name` re-resolved
  season-aware via `ClubResolver` (all 765 / 763 non-null rows proved to round-trip; 1 NULL club
  + 3 NULL opponent preserved), `stat_line` jsonb carried losslessly (763 present / 3 NULL,
  parser rejects malformed/wrong-shape rather than coercing); `"rising_star"` added to
  `LEGACY_FREE_GROUPS` + `BATCH_SOURCE_KEYS`, and its `GROUP_REQUIRES → {"awards"}` entry
  removed so `--groups rising_star` runs legacy-free (the reverse `awards`-refresh closure
  stays). DB-free 33/33, `tsc` clean, `git diff --check` clean; new `rising-star manifest
  reload (AFLDB-ISSUE-112)` integration block **9/9 GREEN** against real `afldb_test` under
  `afldb_import` (766-row parity, era re-resolution ×6, NULL club/opponent preserved, stat_line
  byte-round-trip, 3× idempotent fingerprint, resolved-link id-stability, link dropped only for
  unresolvable `player_id` — 13 such rows against a staler `afldb_test`, all `unmatched` —
  `manual_admin_edit` protection, other-family non-interference); combined ISSUE-112 regression
  29/29 (slices 1–3 not regressed); whole `awards-reload-links.test.ts` 59 passed / 21 skipped.
  The remaining three families (All-Australian, club best-and-fairest, named medals) are
  unstarted.

---

## 14. G0 execution log

### 14.1 Pass 4 — 2026-09-01 (operator-authorised read-only G0 attempt)

**Authorisation for the pass:** read-only G0 measurement against `afldb_dev` was authorised,
conditional on the connection being *proven* to be `afldb_dev` before any query ran, and with an
explicit instruction to **fail closed** if that proof could not be obtained first.

**Outcome: FAILED CLOSED. No database connection was made and no query was run.**

The worktree `D:\dev\afldb-issue-102` at `ee72563` carries **no means to reach `afldb_dev`**:

| Checked | Result |
|---|---|
| `.env` in the worktree | absent — only `.env.example` (all DSNs `CHANGE_ME`, host `localhost:5432`) |
| `AFLDB_*` / `PG*` / `DATABASE*` env vars (Git Bash **and** PowerShell) | none set |
| `psql` / `pg_isready` on PATH | not installed |
| Listening PostgreSQL/tunnel port (5432/5433/6543/15432/54320), both shells | none |

`afldb_dev` runs on the droplet and the ISSUE-111 G0 pass reached it over an operator-run
localhost SSH tunnel. No such tunnel and no credentials are present now. Guessing a DSN or probing
hosts was **not** attempted — it would risk contacting production and cannot satisfy the
"prove it is `afldb_dev` first" precondition.

**Database safety proof — NOT ESTABLISHED.** `current_database()` / `current_user` /
`inet_server_addr()` / `transaction_read_only` were never observed. Fail-closed as required.

What this pass *did* do, all read-only against the repository (no DB): derived the exact G0
measurement contract per family from the loader source and the applied schema (§14.2), and
completed the **structure-only** half of the lossless-export assessment (§14.3). The measured
values and the PASS/FAIL verdicts remain outstanding and are the entire content of the next pass.

**SUPERSEDED 2026-09-01 by Pass 5 (§14.6):** the measurement was executed read-only against
`afldb_dev` via the streamanator dev server (a proven path this pass lacked). All families PASS
(§14.4). This §14.1 log is retained as history only.

### 14.2 G0 measurement contract — exact, reproducible

Run as a single read-only transaction against the database **after** proving it is `afldb_dev`.
Every statement below is `SELECT` only.

**Step 0 — connection proof (must pass before any measurement; abort otherwise):**

```sql
BEGIN TRANSACTION READ ONLY;

SELECT current_database()                         AS db,
       current_user                              AS role,
       coalesce(host(inet_server_addr()), 'unix-socket') AS host,
       inet_server_port()                        AS port,
       current_setting('transaction_read_only')  AS txn_read_only,
       current_setting('server_version')         AS pg_version;
-- REQUIRE: db = 'afldb_dev' AND txn_read_only = 'on'. Otherwise ROLLBACK and stop.
```

**Family definitions (row scopes) — preserved from §2 / §4 of this runbook:**

| Family | Row scope |
|---|---|
| A · award definitions | `awards` (all rows; keyed on `slug`) |
| 1 · All-Australian | `award_winners w JOIN awards a ON a.id=w.award_id WHERE a.slug='all-australian'` |
| 2 · Hall of Fame | `hall_of_fame` (all rows) |
| 3 · honour teams | `honour_team_members` (all rows) |
| 4 · captaincies | `captaincies` (all rows) |
| 5 · Rising Star | `award_nominations n JOIN awards a ON a.id=n.award_id WHERE a.slug='rising-star'` |
| 6 · club best-and-fairest | `award_winners w JOIN awards a ON a.id=w.award_id WHERE a.category='club_best_and_fairest'` (slugs `bf-*`) |
| 7 · named medals & other `award`/`draft_pick` | `award_winners w JOIN awards a ON a.id=w.award_id WHERE a.category IN ('award','draft_pick') AND a.slug NOT IN ('all-australian','rising-star','22-under-22','coleman')` |
| L · person-link bridge & resolutions | `player_link_resolutions`, `player_link_suggestions` across the five awards link-target tables |

**Common metric block — run for families 1, 4, 5, 6, 7 (rows carry `season` + `source_record_id`):**

```sql
-- <SCOPE> = the family row scope from the table above, aliased w (or n)
SELECT count(*)                                              AS rows,
       count(DISTINCT season)                                AS distinct_seasons,
       min(season) AS min_season, max(season)                AS max_season,
       count(*) FILTER (WHERE player_id IS NOT NULL)         AS linked,
       count(*) FILTER (WHERE player_id IS NULL)             AS unlinked,
       count(*) FILTER (WHERE club_id IS NOT NULL)           AS club_id_resolved,
       count(*) FILTER (WHERE source_record_id IS NULL)      AS null_source_record_id,
       count(DISTINCT source_record_id)                      AS distinct_source_record_id
  FROM <SCOPE>;

-- link_status distribution
SELECT link_status_value, count(*) FROM <SCOPE> GROUP BY 1 ORDER BY 2 DESC;

-- provenance / source distribution
SELECT s.key AS source, count(*) AS rows,
       min(w.season) AS min_season, max(w.season) AS max_season
  FROM <SCOPE> LEFT JOIN sources s ON s.id = w.source_id
 GROUP BY s.key ORDER BY s.key;

-- source_record_id completeness / uniqueness verdict:
--   PASS iff null_source_record_id = 0 AND distinct_source_record_id = rows
-- per-season row counts (truncation / double-listing probe)
SELECT season, count(*) FROM <SCOPE> GROUP BY season ORDER BY season;
```

**Family-specific probes:**

```sql
-- A · award definitions ------------------------------------------------
SELECT count(*) AS award_defs,
       count(*) FILTER (WHERE category='award')                 AS cat_award,
       count(*) FILTER (WHERE category='club_best_and_fairest') AS cat_bf,
       count(*) FILTER (WHERE category='draft_pick')            AS cat_draft_pick,
       count(*) FILTER (WHERE category='honour_team')           AS cat_honour_team,
       count(*) FILTER (WHERE category='hall_of_fame')          AS cat_hof,
       count(*) FILTER (WHERE description IS NOT NULL)           AS with_description,
       count(*) FILTER (WHERE first_season IS NULL)             AS null_first_season
  FROM awards;
SELECT slug, name, category, competition, club_id, first_season, last_season,
       (description IS NOT NULL) AS has_desc
  FROM awards ORDER BY category, slug;          -- full enumeration (~40 rows)

-- 1 · All-Australian: natural-key anomaly (expect 1984 state/club dual rows + genuine same-name)
WITH aa AS (SELECT w.* FROM award_winners w JOIN awards a ON a.id=w.award_id
             WHERE a.slug='all-australian')
SELECT season, player_name_raw, count(*) AS n
  FROM aa GROUP BY season, player_name_raw HAVING count(*) > 1 ORDER BY n DESC, season;
-- also: count FILTER (position IS NOT NULL), FILTER (is_captain), FILTER (is_vice_captain),
--       FILTER (club_name_raw IS NOT NULL), FILTER (sort_order IS NOT NULL)

-- 2 · Hall of Fame (no season, no source_record_id) --------------------
SELECT count(*) AS rows,
       min(inducted_year) AS min_year, max(inducted_year) AS max_year,
       count(*) FILTER (WHERE inducted_year IS NULL)   AS null_inducted_year,
       count(*) FILTER (WHERE player_id IS NOT NULL)   AS linked,
       count(*) FILTER (WHERE player_id IS NULL)       AS name_only,
       count(*) FILTER (WHERE is_legend)               AS legends,
       count(*) FILTER (WHERE legend_year IS NOT NULL) AS legend_year_present,
       count(*) FILTER (WHERE removed_year IS NOT NULL) AS removed,
       count(*) FILTER (WHERE club_name_raw IS NOT NULL) AS club_present,
       count(*) FILTER (WHERE state IS NOT NULL)       AS state_present,
       count(*) FILTER (WHERE playing_career IS NOT NULL) AS career_present
  FROM hall_of_fame;
SELECT category, count(*) FROM hall_of_fame GROUP BY 1 ORDER BY 2 DESC;
SELECT link_status_value, count(*) FROM hall_of_fame GROUP BY 1 ORDER BY 2 DESC;
SELECT s.key, count(*) FROM hall_of_fame h LEFT JOIN sources s ON s.id=h.source_id GROUP BY 1;
SELECT name, inducted_year, count(*) AS n         -- natural-key duplicate probe (expect none)
  FROM hall_of_fame GROUP BY name, inducted_year HAVING count(*) > 1;

-- 3 · honour teams (no season, no source_record_id) -------------------
SELECT count(*) AS rows,
       count(DISTINCT team_name) AS distinct_teams,
       count(*) FILTER (WHERE player_id IS NOT NULL) AS linked,
       count(*) FILTER (WHERE player_id IS NULL)     AS unlinked,
       count(*) FILTER (WHERE position IS NOT NULL)  AS position_present,
       count(*) FILTER (WHERE role IS NOT NULL)      AS role_present,
       count(*) FILTER (WHERE club_name_raw IS NOT NULL) AS club_present,
       count(*) FILTER (WHERE sort_order <> 0)       AS sort_order_present
  FROM honour_team_members;
SELECT team_name, count(*) FROM honour_team_members GROUP BY 1 ORDER BY 1;
SELECT link_status_value, count(*) FROM honour_team_members GROUP BY 1 ORDER BY 2 DESC;
SELECT s.key, count(*) FROM honour_team_members m LEFT JOIN sources s ON s.id=m.source_id GROUP BY 1;
SELECT team_name, player_name_raw, count(*) AS n   -- natural key (expect none >1)
  FROM honour_team_members GROUP BY 1,2 HAVING count(*) > 1;
SELECT team_name, player_id, count(*) AS n         -- linked-identity key (expect none >1; migration 059)
  FROM honour_team_members WHERE player_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;

-- 4 · captaincies: club_id is NOT NULL by schema — verify no 0/orphan; role vocabulary; period
SELECT role, count(*) FROM captaincies GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) FILTER (WHERE period IS NOT NULL) AS period_present,
       count(*) FILTER (WHERE club_id IS NULL)    AS null_club_id     -- expect 0
  FROM captaincies;
SELECT season, club_id, player_name_raw, role, count(*) AS n          -- captaincies_natural_uq (expect none >1)
  FROM captaincies GROUP BY 1,2,3,4 HAVING count(*) > 1;

-- 5 · Rising Star: round grain, winners, ineligibility, stat line
WITH rs AS (SELECT n.* FROM award_nominations n JOIN awards a ON a.id=n.award_id
             WHERE a.slug='rising-star')
SELECT count(*) FILTER (WHERE round_number IS NOT NULL) AS round_present,
       count(DISTINCT round_number)                     AS distinct_rounds,
       count(*) FILTER (WHERE is_winner)                AS season_winners,
       count(*) FILTER (WHERE is_ineligible)            AS ineligible,
       count(*) FILTER (WHERE ineligible_reason IS NOT NULL) AS ineligible_reason_present,
       count(*) FILTER (WHERE stat_line IS NOT NULL)    AS stat_line_present,
       count(*) FILTER (WHERE opponent_club_id IS NOT NULL) AS opponent_present,
       count(*) FILTER (WHERE club_id IS NOT NULL)      AS club_present
  FROM rs;

-- 6 · club best-and-fairest: per-award breakdown (expect ~18 bf-* slugs)
SELECT a.slug, count(*) AS rows, min(w.season) AS min_s, max(w.season) AS max_s,
       count(*) FILTER (WHERE w.player_id IS NULL) AS unlinked,
       count(*) FILTER (WHERE w.votes IS NOT NULL) AS votes_present,
       count(*) FILTER (WHERE w.club_name_raw IS NOT NULL) AS club_raw_present
  FROM award_winners w JOIN awards a ON a.id=w.award_id
 WHERE a.category='club_best_and_fairest'
 GROUP BY a.slug ORDER BY a.slug;

-- 7 · named medals & other award/draft_pick: per-award breakdown + Brownlow medallist isolation
SELECT a.slug, a.name, a.category, a.competition,
       count(*) AS rows, min(w.season) AS min_s, max(w.season) AS max_s,
       count(*) FILTER (WHERE w.player_id IS NULL) AS unlinked
  FROM award_winners w JOIN awards a ON a.id=w.award_id
 WHERE a.category IN ('award','draft_pick')
   AND a.slug NOT IN ('all-australian','rising-star','22-under-22','coleman')
 GROUP BY a.slug, a.name, a.category, a.competition ORDER BY a.category, a.slug;
-- Brownlow award-winner row is 'brownlow-medal' here; confirm one row per season and that it is
-- DISTINCT from brownlow_season_votes.is_winner (ISSUE-113 territory — do NOT source season totals):
SELECT w.season, count(*) FROM award_winners w JOIN awards a ON a.id=w.award_id
 WHERE a.slug='brownlow-medal' GROUP BY w.season ORDER BY w.season;

-- L · person-link decisions across the five awards link-target tables ---
SELECT target_table, action, count(*) AS decisions
  FROM player_link_resolutions
 WHERE target_table IN ('award_winners','award_nominations','hall_of_fame',
                        'honour_team_members','captaincies')
 GROUP BY 1,2 ORDER BY 1,2;
-- latest decision per target (the DISTINCT ON reload_keyed itself uses)
SELECT target_table, action, count(*) AS latest_decisions FROM (
  SELECT DISTINCT ON (target_table, target_id) target_table, target_id, action
    FROM player_link_resolutions
   WHERE target_table IN ('award_winners','award_nominations','hall_of_fame',
                          'honour_team_members','captaincies')
   ORDER BY target_table, target_id, created_at DESC) t
 GROUP BY 1,2 ORDER BY 1,2;
-- G5-shape integrity: every resolved target_id still resolves to a live row (per table LEFT JOIN;
-- count rows where the join misses, and where action='linked' but the row's player_id <> decided player_id)
SELECT target_table, status, count(*) FROM player_link_suggestions
 WHERE target_table IN ('award_winners','award_nominations','hall_of_fame',
                        'honour_team_members','captaincies')
 GROUP BY 1,2 ORDER BY 1,2;

-- DraftGuru person-link ledger (§11.3) coverage cross-check — the tracked replacement for
-- load_person_links(): count decisions in data/reference/draftguru-link-decisions.json vs the
-- draftguru-sourced award_winners rows that currently carry a player_id or link_status.

COMMIT;   -- read-only; nothing to persist
```

**Cross-checks (not the measurement):** `docs/data-dictionary.md` §3 legacy counts — `awards`
1,810 rows / 38 distinct types, `all_australian` 906 + `all_australian_history` 1,252,
`hall_of_fame` 343 (34 Legends, 241 linked), `captaincies` 1,375 (all linked),
`rising_star_nominees` 766, `team_selections` 113; `docs/search.md:220` records 40 award
definitions loaded. Post-load `award_winners`/`award_nominations` counts differ from the raw
legacy counts (rejects, All-Australian merge of the two legacy tables, `other_group_awards`
exclusions) — the measured PostgreSQL values are authoritative for G0, these are the sanity frame.

### 14.3 Lossless-export assessment — structure only (measured completeness confirmed 2026-09-01 in §14.6; every predicted gap held, no new one)

Assessed against the **operator-chosen** extraction source: the legacy-loaded `afldb_dev`
PostgreSQL state. Verified from the applied schema (migrations 005, 042, 059, 061) and the loader
(`tools/migration/import_awards.py`). "Direct" = a column exists on the target row.
"Reconstruct" = derivable deterministically from other persisted state. "Lost" = not present in
the PostgreSQL state at the required granularity.

**Cross-cutting finding — the one systemic gap.** The §4.2 common column **`source_citation`**
("the specific upstream page/edition the row came from") **cannot be extracted from PostgreSQL at
per-row granularity for any of the five link-target tables.** None of `award_winners`,
`award_nominations`, `hall_of_fame`, `honour_team_members`, `captaincies` has a `source_url` /
`source_citation` column (confirmed: no migration adds one). The legacy SQLite tables each carried
`source_url` per row; the loader drops it. From PostgreSQL, citation is recoverable only at
**source granularity** — `sources.key` gives `draftguru` / `wikipedia` / `footywire` per row (via
`source_id`), i.e. one citation per source, not per page. **This does not block a manifest**, but
the operator must choose one of: (a) accept source-granularity `source_citation` values in the
manifests; (b) have the one-time bootstrap additionally read `source_url` from the legacy SQLite
file itself (same data lineage, a different store than `afldb_dev`); (c) reconstruct citations
from the documented scrape targets in `docs/acquisition/AFLDB-2026-API-ACQUISITION.md`. **Per the
G0 boundary this pass stops here and proposes no scrape.**

| Family | `source_key` (stable id) | `player` | Family payload fields | Provenance | Link decisions separable? | Structural verdict |
|---|---|---|---|---|---|---|
| **A · award definitions** | `slug` — **direct**, unique by PK | n/a | `name`, `category`, `competition`, `club_id`, `first_season`, `last_season` all **direct**; `description` is **code-sourced** (`AWARD_DESCRIPTIONS` dict), reconstruct from repo, else NULL | n/a (reference row) | n/a (`link_columns=None`) | **Lossless** (structure). `first_season`/`last_season` = min/max of winner seasons, reconstruct. |
| **1 · All-Australian** | `award_winners.source_record_id` (`aa:YYYY:n`, `aah:YYYY:player:club`) — **direct**, `award_winners_source_uq` | `player_name_raw` — **direct** | `season`, `position`, `club` (`club_name_raw` **direct**), `is_captain`, `is_vice_captain` — **direct**; `times_aa` only inside `note` text (reconstruct by parse, minor) | `source_id` → `draftguru` \| `wikipedia` — **direct at source granularity**; per-page `source_url` **lost** | **Yes** — `player_id`+`link_status_value` on row; `player_link_resolutions` separate ledger | **Lossless except `source_citation` granularity.** History rows legitimately lack `position`/captaincy (source did not provide) — not "insufficient". |
| **2 · Hall of Fame** | **none in DB** — `hall_of_fame` has no `source_record_id`; reload key is natural `(name, inducted_year)`. Manifest `source_key` must be **minted once** (`hof:<seq>`) at bootstrap, not extracted (by §4.2 design) | `name` — **direct** | `inducted_year`, `category`, `is_legend`, `legend_year`, `club` (`club_name_raw`), `state`, `playing_career`, `removed_year` — all **direct**; `games_goals` only inside `notes` (reconstruct by parse) | `source_id` → `wikipedia` — **direct at source granularity**; `source_url` **lost** | **Yes** — `player_id`+`link_status_value`; resolutions ledger separate | **Exportable, with a minted id.** Renames remain link-losing under the natural key (known, §4.2 / §11.4). ~45 rows with NULL `inducted_year` — still name-unique. |
| **3 · honour teams** | **none in DB** — natural key `(team_name, player_name_raw)`; linked rows also keyed `(team_name, player_id)` (migration 059). Manifest `source_key` **minted** (`honourteam:<team-slug>:<seq>`) | `player_name_raw` — **direct** | `team_name`, `position`, `role`, `sort_order`, `club` (`club_name_raw`) — **direct** | `source_id` → `wikipedia`; `source_url` **lost** | **Yes** — `player_id`+`link_status_value`; resolutions ledger separate | **Exportable, with a minted id.** Same natural-key rename hazard as HoF (§11.4). |
| **4 · captaincies** | `captaincies.source_record_id` — **direct**, `captaincies_source_uq`; also natural key `(season, club_id, player_name_raw, role)` | `player_name_raw` — **direct** | `season`, `role`, `period` — **direct**; **`club`: no `club_name_raw` column** — the source's raw club string is **not retained**; reconstruct from `club_id` via `clubs` (deterministic, `club_id` is NOT NULL so total) | `source_id` → `wikipedia`; `source_url` **lost** | **Yes** — `player_id`+`link_status_value`; resolutions ledger separate | **Lossless for identity/keys; source raw club spelling reconstructed, not verbatim.** Plus `source_citation` granularity. |
| **5 · Rising Star** | `award_nominations.source_record_id` (legacy `source_key`) — **direct**, `award_nominations_source_uq` | `player_name_raw` — **direct** | `season`, `round_number`, `is_winner`, `is_ineligible`, `ineligible_reason` — **direct**; `stat_line` jsonb — **direct** (NULL stats already dropped at load; round-trips exactly); **`club`/`opponent`: only `club_id`/`opponent_club_id`** — raw strings not retained, reconstruct from `clubs`; `player_display` (FootyWire short form) not retained (minor) | `source_id` → `footywire`; `source_url` **lost** | **Yes** — `player_id`+`link_status_value`; resolutions ledger separate | **Lossless for keys/stat line; club/opponent reconstructed.** Plus `source_citation` granularity. |
| **6 · club best-and-fairest** | `award_winners.source_record_id` = `bf-<club>:<season>:<row_no>` — **direct**, unique-constrained; note `row_no` came from legacy scan order, so it becomes a **frozen assigned id**, not a source-native one | `player_name_raw` — **direct** | `award_slug` (join to `awards.slug`), `season`, `club` (`club_name_raw` **direct** here), `votes` — **direct** | `source_id` → `draftguru`; per-row `source_url`/`source_row`/`player_url` **lost** (some folded into `note`) | **Yes** — resolved to `player_id`+`link_status_value`; the legacy `dg_person_id` bridge key is **not** retained (only its outcome), which is fine — the manifest carries `player` and the loader re-resolves | **Exportable; ids are frozen load-order ids; `source_citation` at source granularity only.** |
| **7 · named medals & other `award`/`draft_pick`** | as family 6 (`<slug>:<season>:<row_no>`) — **direct**, frozen assigned id | `player_name_raw` — **direct** | `award_slug`, `award_name`, `category`, `competition` (all from `awards` row — **direct**), `season`, `club` (`club_name_raw`), `votes` — **direct** | `source_id` → `draftguru`; per-row `source_url` **lost** | **Yes** — as family 6 | **Exportable.** Brownlow **medallist** row (`brownlow-medal` in `award_winners`) is in scope and is **distinct** from `brownlow_season_votes` (ISSUE-113) — do not source season vote totals here. |
| **L · person-link bridge** | legacy `person_links`/`dg_people` are **SQLite-only — no such table in PostgreSQL.** The tracked replacement `data/reference/draftguru-link-decisions.json` (keyed on durable `player_url`) already exists and holds **explicit human decisions only** | n/a | n/a | n/a | The bridge *is* the link-decision layer; §4.2 design replaces `load_person_links()` with the tracked ledger + the loader's own scorer for automatic links | **No PostgreSQL extraction gap for the explicit decisions** (already tracked). Automatic historical links are regenerated by the scorer, not extracted — by design. **§11.3 coverage check (does the ledger cover the identities the awards families need?) is a measured item — still pending DB.** |

**Rows with insufficient information for a deterministic, reviewable manifest:** none identified
structurally. The gaps above are (i) `source_citation` granularity — systemic, one operator
choice; (ii) `hall_of_fame` / `honour_team_members` have no persisted stable id, so ids are minted
once at bootstrap (already the §4.2 design); (iii) captaincies / Rising Star club + opponent are
reconstructed from `club_id`, deterministically and totally, rather than carried verbatim.
**Whether any individual row is genuinely unexportable can only be confirmed by the §14.2
measurement** (e.g. a NULL `source_record_id`, a duplicate natural key, a `club_id` that no longer
resolves, or a `player_link_resolutions` decision whose target row has vanished).

### 14.4 G0 PASS/FAIL by family

**Measured 2026-09-01 (Pass 5, §14.6). All families PASS.** "PASS" = the §10 G0 measurement was
obtained read-only from a database still holding the legacy-loaded data (`afldb_dev`), recorded,
and shows **no structural blocker** to a deterministic reviewable manifest (per §5 / §10: no NULL
required key, no reload-key collision, no orphaned link decision). Residual non-blocking items are
named per row and carried to G1.

| Family | G0 status | Key measured evidence | Residual (non-blocking) |
|---|---|---|---|
| A · award definitions | **PASS** | 40 defs (18 `award`, 19 `club_best_and_fairest`, 1 `draft_pick`, 2 `honour_team`); `first_season`/`last_season` NULL = 0; `slug` PK-unique; matches `docs/search.md:220` (40) | `description` present on only 6 rows — code-sourced (`AWARD_DESCRIPTIONS`), reconstruct from repo else NULL |
| 1 · All-Australian | **PASS** | 1,158 rows, 1953–2025, 53 seasons; linked 1,078 / unlinked 80; **`source_record_id` NULL = 0, distinct = 1,158 = rows**; provenance draftguru 906 (1979–2025) + wikipedia 252 (1953–1990); 10 `(season, player_name_raw)` dup pairs — 9 are the 1984 state/club dual selection (48 rows that season), 1 is a genuine same-name (Josh Kennedy 2016). Reload key `(source_id, source_record_id)` unaffected. | 1984 dual rows and same-name pairs legitimate; `source_citation` at source granularity only (§14.3 cross-cutting) |
| 2 · Hall of Fame | **PASS** | 343 rows, inducted_year 1996–2026, **45 NULL inducted_year**; linked 246 / name-only 97; 34 legends (= `legend_year` present); source wikipedia (all). **Natural key `(name, inducted_year)` dup = 0; `name` alone dup = 0** — every row name-unique despite the NULL years. | No persisted stable id — `source_key` minted `hof:<seq>` at bootstrap (§4.2). Rename remains link-losing under the natural key (§11.4, policy not data). `source_citation` at source granularity. |
| 3 · honour teams | **PASS** | 113 rows, 5 teams (Team of the Century 22 + 4 heritage teams 20–24); linked 89 / unlinked 24; source wikipedia (all); matches legacy `team_selections` (113). **`(team_name, player_name_raw)` dup = 0; `(team_name, player_id)` dup = 0** (migration 059 satisfied). | No persisted stable id — `source_key` minted `honourteam:<team-slug>:<seq>`. Same rename hazard as HoF (§11.4). `source_citation` at source granularity. |
| 4 · captaincies | **PASS** | 1,375 rows, 1897–2026, 130 seasons; **linked 1,375 / unlinked 0**; `club_id` NOT NULL on all; **`source_record_id` NULL = 0, distinct = 1,375 = rows**; source wikipedia (all); role vocabulary is the single value `Captain`; `period` present on all. **`captaincies_natural_uq (season, club_id, player_name_raw, role)` dup = 0.** | No `club_name_raw` column — raw club spelling reconstructed from `club_id` via `clubs` (deterministic, total). `source_citation` at source granularity. |
| 5 · Rising Star | **PASS** | 766 rows, 1993–2026, 34 seasons; **linked 766 / unlinked 0**; **`source_record_id` NULL = 0, distinct = 766 = rows**; source footywire (all); matches legacy `rising_star_nominees` (766); round grain 0–24, `stat_line` present 763; **exactly 1 `is_winner` per decided season 1993–2025, 0 for 2026** (33 total). | 1 row NULL `club_id`; 3 rows NULL `stat_line`/`opponent` — source gaps, not defects. club/opponent reconstructed from `*_club_id`. `source_citation` at source granularity. |
| 6 · club best-and-fairest | **PASS** | 752 rows, 1980–2025, 46 seasons, 19 `bf-*` slugs; linked 744 / unlinked 8; **`source_record_id` NULL = 0, distinct = 752 = rows**; `club_id` resolved on all; `club_name_raw` present on all; source draftguru (all). | `votes` column empty for every row — manifest omits or NULLs it. `source_record_id` values are frozen load-order ids `bf-<club>:<season>:<row_no>` (§14.3), not source-native. `source_citation` at source granularity. |
| 7 · named medals & other `award`/`draft_pick` | **PASS** | 979 rows, 1976–2025, 50 seasons, 17 slugs (16 `award` + `national-draft-pick-1`); linked 863 / unlinked 116 (unlinked concentrated in state-league/junior medals — legitimate); **`source_record_id` NULL = 0, distinct = 979 = rows**; source draftguru (all). Brownlow **medallist** rows = 53 over 46 seasons — the 7 extra are legitimate tie seasons (1981, 1986, 1987, 1996, 2003×3, 2012); **distinct from `brownlow_season_votes` — ISSUE-113 untouched**. | 299 rows legitimately without `club_id` (non-AFL competitions). Frozen load-order ids. `source_citation` at source granularity. |
| L · person-link bridge & `player_link_resolutions` | **PASS** | `player_link_resolutions` 94 rows total; **74 awards-scoped** across 3 of the 5 link-target tables: `award_winners` 68 (57 `linked` + 11 `confirmed_unlinked`), `hall_of_fame` 5 `linked`, `honour_team_members` 1 `linked`; **`award_nominations` 0, `captaincies` 0**. Latest-decision-per-target = totals (no supersession). **Orphan check: 0 target rows missing, 0 `linked`-decision player mismatches across all 74.** `player_link_suggestions` — **whole table empty (0 rows)**. | The 20 `draft_picks` decisions are outside ISSUE-112 scope (not an awards family). |

### 14.5 Exact next action

**G0 is complete.** ISSUE-112 implementation phasing (§11.2) may begin — **honour teams first**
(113 rows, minted `honourteam:<team-slug>:<seq>` ids, natural key proven collision-free).

Before phase 1, the operator must still settle the two remaining decisions (neither blocks
starting honour teams, both block a merge):

1. **`source_citation` granularity** (§14.3 cross-cutting; measured-confirmed below in §14.6) —
   choose (a) accept source-granularity values (`wikipedia` / `footywire` / `draftguru`) in the
   manifests, (b) have the one-time bootstrap read per-row `source_url` from the legacy SQLite
   file, or (c) reconstruct from `docs/acquisition/AFLDB-2026-API-ACQUISITION.md`. **No scrape
   is proposed.** *This pass records the evidence and leaves the decision explicitly pending.*
2. **§11.4 natural-key policy** — the measurement proves leaving `hall_of_fame` on
   `(name, inducted_year)` and `honour_team_members` on `(team_name, player_name_raw)` is
   **data-safe today** (zero collisions on either key, and on `hall_of_fame.name` alone). The
   open point is only the acknowledged property that a curated **rename** of a decided row stays
   a link-losing event `reload_keyed` aborts on (`awards-reload-links.test.ts:352`, `:401`).
   Confirm that is acceptable, or raise the key change as its own adjudication.

Boundary reminder for the next pass: no scrape; no `import_awards.py` run until a manifest exists;
ISSUE-111 and ISSUE-113 untouched.

### 14.6 Pass 5 — 2026-09-01 (G0 measurement EXECUTED, read-only, `afldb_dev`)

**Authorisation:** operator-authorised read-only G0 measurement against `afldb_dev`, via the
**streamanator development server** (`/home/arm/projects/afldb`), conditional on proving the
connection is `afldb_dev` in an explicit read-only transaction before any measurement query.

**Outcome: PASS. The full §14.2 contract ran; the transaction was rolled back; no server-side
file and no database row was changed.**

**Connection / read-only safety proof (observed):**

| Field | Value |
|---|---|
| transport | SSH to `arm@10.0.40.100` (streamanator), DSN read from `/home/arm/projects/afldb/.env` `AFLDB_IMPORT_DATABASE_URL`, password never printed |
| `current_database()` | **`afldb_dev`** ✓ |
| `current_user` | `afldb_import` (chosen over `afldb_app` so `player_link_resolutions` / `player_link_suggestions` are SELECT-visible — migrations 066/068/070; `afldb_app` cannot read them) |
| host / port | `127.0.0.1` / `5432` |
| `current_setting('transaction_read_only')` | **`on`** ✓ |
| `server_version` | 16.15 (Ubuntu) |
| execution | single `psql` session, `BEGIN TRANSACTION READ ONLY; … ROLLBACK;`, SQL piped over stdin (no file written to the server) |

The `db = 'afldb_dev' AND txn_read_only = 'on'` precondition was satisfied before any measurement
query ran. `afldb_test` was **not** used.

---

## 16. Pass 7 — 2026-09-01: implementation slice 1 (HONOUR TEAMS) — COMPLETE

**Scope:** unblock and complete the honour-teams slice per Pass 6's §15 spec, under two new
operator decisions supplied this pass: (1) the bootstrap connection is now reachable — a
dedicated SSH key `~/.ssh/afldb_dev` (distinct from the `dev`/`streamanator` alias's default
key) authenticates to `arm@10.0.40.100`, refuting Pass 6's "SSH key auth refused" finding; (2)
`source_citation` = `wikipedia` for every honour-teams row (source-granularity provenance, §13).

### 16.1 Bootstrap extraction — executed, read-only, proven

Same connection-proof discipline as Pass 5 (§14.6): `BEGIN TRANSACTION READ ONLY`, step-0 guard
(`current_database() = 'afldb_dev'`, `transaction_read_only = 'on'`), the full §15.5 query set
piped over `psql` stdin via SSH, then `ROLLBACK`. Observed: `db = afldb_dev`,
`role = afldb_import`, `host = 127.0.0.1:5432`, `txn_read_only = on`, PostgreSQL 16.15. No file
written to the server; nothing committed.

Measured results matched G0 exactly: **113 rows**, 5 teams (AFL/VFL Team of the Century 22,
Greek Team of the Century 20, Indigenous Team of the Century 24, Italian Team of the Century 23,
Queensland Team of the 20th Century 24), provenance **100% `wikipedia`**, natural-key probes
`(team_name, player_name_raw)` and `(team_name, player_id)` both **zero duplicates**, exactly
**one** `player_link_resolutions` decision (`target_id` = the Ted Whitten row, `action = linked`,
`decided_player_id` = the row's current `player_id` — no drift), and the §15.5 rebuild-stability
probe: of the 89 linked rows, 85 resolve to exactly one `afltables_profile_url` identity, 4 have
none, 0 have more than one (carried forward per §16.3, not a slice blocker).

### 16.2 Manifest — `data/awards/honour-teams.csv`

Built directly from the extraction's ordered result set (`ORDER BY team_name, sort_order,
player_name_raw, id` — the `id` column is the extraction tie-break only and does not appear in
the file). `source_key` minted once as `honourteam:<team-slug>:<seq>`, `<team-slug>` via the
byte-identical `import_awards.py` `slugify()` rule, `<seq>` 1-based within each team in file
order. `source_citation` set to the literal `wikipedia` for all 113 rows per the operator
decision. 114 lines (header + 113), exact §15.4 column order. `.gitignore` whitelisted
(`!/data/awards/honour-teams.csv`, alongside the existing `22-under-22.csv` entry).

### 16.3 Loader — `tools/migration/honour_teams.py` + `import_awards.py`

New `tools/migration/honour_teams.py`, in the `under_22.py` mould: `HonourTeamsSourceError`,
frozen `HonourTeamMember` dataclass, `load_honour_teams()` that fully validates before
constructing any row (no best-effort coercion), `summary()`/`main()` giving a DB-free `--check`.
Refuses: malformed header; unknown `team_name`/`position`/`role`/`link_status`; a
`source_citation` other than the one decided value; `link_status` disagreeing with `player_id`
presence (the migration 019/053 invariant, enforced here rather than left to the database);
malformed `source_key` or a slug not matching `slugify(team_name)`; a `source_key` seq out of
sequence for its team; rows out of the file's declared deterministic order (team blocks
non-contiguous or non-ascending; within a team, `sort_order`/`player` non-ascending); duplicate
`source_key`; duplicate natural identity `(team_name, player)`; duplicate linked identity
`(team_name, player_id)`; a total row count or per-team distribution not matching the declared
113/5-team contract. The duplicate-`source_key` check is deliberately ordered **before** the
seq-sequencing check — a literal key repeat is always also seq-invalid under sequential minting,
so checking duplication first keeps that failure mode distinctly reported rather than masked as
an ordering error.

`import_awards.py`: added `from honour_teams import HonourTeamMember, load_honour_teams`.
`import_honour_teams()` lost its `lite` parameter; its body now calls `load_honour_teams()`
instead of `lite.execute("SELECT ... FROM team_selections ...")`, mapping the parsed rows onto
the same `prepared` tuple shape the loader already built (still passed through the existing
`link_status()` invariant call for defense-in-depth). The advisory lock take, the §4.3/§4.4
`_refuse_honour_team_identity_collisions` preflight and the `reload_keyed(...)` call — key
`["team_name", "player_name_raw"]`, the same 11-column value list, `scope_column="source_id"`,
`allow_link_loss` — are **byte-identical** to before. `"honour_teams"` added to
`LEGACY_FREE_GROUPS`; `BATCH_SOURCE_KEYS["honour_teams"] = "wikipedia"` added so its
`import_batch` records against `wikipedia` rather than the `sports_data_lab` default. The call
site drops the `lite` argument. No other group, `GROUPS`, `GROUP_ORDER` or `GROUP_REQUIRES`
entry changed. No migration, no privilege change.

**Carried-forward risk, unchanged from Pass 6 (§15.3), not a slice-1 blocker:** the manifest
carries the 89 linked rows' `player_id` verbatim from `afldb_dev`. That reproduces the family
exactly in a database sharing `afldb_dev`'s player numbering (which is what `afldb_test` for this
suite already assumes — every pre-existing `hall_of_fame`/`honour_team_members` test in this file
relies on the same property for the real legacy-loaded data). It is **not** durable across a
from-scratch canonical rebuild that re-seeds `players.id` (ISSUE-111 G5) — 4 of the 89 linked
rows do not even carry a unique `afltables_profile_url` today (§16.1), so a rebuild-stable
re-resolution step could not cover all 89 without a separate adjudication. This risk is recorded
against the deferred canonical-rebuild AWARDS/HONOURS stage (§7), per instruction, not solved
here. `source_key` — not `player_id` — is the manifest's durable identity.

### 16.4 Tests

**DB-free — `tests/honour-teams-source.test.ts` (new, 22 cases, all passing):** the full 113-row
manifest parses with the exact G0-measured shape (`row_count: 113`, `linked_count: 89`,
`unlinked_count: 24`, the 5 per-team counts); two representative rows (Ted Whitten's decided
row, an `unmatched` row) round-trip verbatim; every row's `source_citation` is `wikipedia`; and
one test each for: malformed header; unknown `team_name`/invalid `position`/invalid `role`/
invalid `link_status`; a `source_citation` outside the decided value (both a wrong source key and
a page-URL-shaped value); `link_status` disagreeing with `player_id` presence (both directions);
malformed `source_key`; slug mismatch; seq-out-of-sequence; duplicate `source_key`; duplicate
natural identity; duplicate linked identity; out-of-order rows within a team; team blocks out of
order; total row count short of 113; a team missing entirely. Negative cases use a quote-aware
CSV cell replacer (the real manifest has commas inside quoted club-list fields) and a minimal
synthetic valid row for cases whose failure fires during per-row validation, before the
113-row completeness check would ever run.

**Integration — `tests/integration/awards-reload-links.test.ts` (new describe block, gated
`canRunHonourTeamsImporter`, legacy-free like the existing `canRunUnder22Importer` block):**
reloads the full 113-row manifest with `AFLDB_LEGACY_SQLITE` forced unset and asserts the
`import_batches` row (`records_read = 113`, `records_rejected = 0`, target `honour_teams`) and
the resulting split (`total 113, linked 89, unlinked 24, teams 5`); three consecutive reloads
produce a byte-identical `(id, team_name, player_name_raw, player_id)` fingerprint; the Ted
Whitten row's id and `player_id` survive an additional reload with `link_status = 'resolved'`;
all 24 unlinked rows stay unlinked; a synthetic `manual_admin_edit`-sourced row survives a reload
untouched; `hall_of_fame`/`captaincies`/`award_winners`/`award_nominations` row counts are
unchanged by a `honour_teams`-only run. The top-level `beforeAll`/`afterAll` in this file (role
validation gate, honours-table advisory lock, connection pool) needed no change — the new block
reuses `runImporter`/`countRows`/`sql` exactly as the existing blocks do, passing `undefined` as
`runImporter`'s third argument to force `AFLDB_LEGACY_SQLITE` unset regardless of this process's
own environment.

### 16.5 Validation — exact results

1. **DB-free:** `npx vitest run tests/honour-teams-source.test.ts` — **22/22 passed.**
2. **Typecheck:** `npx tsc --noEmit` — **clean**, before and after the integration-test addition.
3. **Integration:** the file was executed against the **real `afldb_test`** on the streamanator
   host (owner-role DSN, via an SSH tunnel to `10.0.40.100:5432`, opened and closed within this
   pass) to prove the new describe block loads and is wired correctly. Result: **the whole file
   self-skips (59 tests skipped, 0 run)** — `AFLDB_TEST_IMPORT_DATABASE_URL` (the restricted
   `afldb_import` test-role DSN `canRunHonourTeamsImporter`/`canRunUnder22Importer`/
   `canRunFixtureImporter` all require) is not configured anywhere reachable from this worktree or
   the streamanator host's committed `.env`. This is **not new**: every pre-existing
   legacy-gated block in this file (ISSUE-044, ISSUE-080, ISSUE-085, ISSUE-111, the existing
   `canRunUnder22Importer` block) skips for the identical reason in this same environment — it
   predates this pass. The new block's skip message and behaviour are indistinguishable from its
   neighbours', confirming it is wired the same way, but its actual reload/idempotency/
   link-survival assertions have **not executed against a live database this pass.** Provisioning
   a restricted `afldb_import` test-role credential is outside this pass's authorisation
   (database role/grant creation) and is the concrete next action for real DB-backed validation.
4. **`git diff --check`:** clean (only benign CRLF-on-checkout warnings for the two new
   LF-authored files, exit 0).

### 16.6 Files changed this pass

`.gitignore` (new whitelist line), `data/awards/honour-teams.csv` (new, 114 lines),
`tools/migration/honour_teams.py` (new), `tools/migration/import_awards.py` (import,
`import_honour_teams` signature/body, `LEGACY_FREE_GROUPS`, `BATCH_SOURCE_KEYS`, call site),
`tests/honour-teams-source.test.ts` (new), `tests/integration/awards-reload-links.test.ts`
(new describe block plus the `canRunHonourTeamsImporter` gate and its `beforeAll` wiring),
`issues/open/AFLDB-ISSUE-112.md`, `issues/open/AFLDB-ISSUE-102-HANDOFF.md`, `IssuesIndex.md`.
No `CHANGELOG.md` entry — nothing has been deployed or run against a live application database;
`import_awards.py`'s behaviour for the other six still-legacy-dependent groups is unchanged.
ISSUE-111 / ISSUE-113 untouched. `D:\dev\afldb` not accessed. `afldb_dev` was read-only for the
§16.1 extraction only, never written. No Git command run.

### 16.7 Exact next action

1. **Real DB-backed validation.** Provision (or point at an existing) `AFLDB_TEST_IMPORT_DATABASE_URL`
   for a `_test`-suffixed database's `afldb_import` role, then run
   `npx vitest run tests/integration/awards-reload-links.test.ts -t "honour-teams manifest reload"`.
   This also transitively re-validates that the pre-existing ISSUE-044/080/085/111 blocks in the
   same file still pass unchanged (no other family's behaviour was touched).
2. **G1–G4 for the honour-teams family specifically** (not the whole of ISSUE-112): once (1)
   passes, this family's slice satisfies the `AFLDB-ISSUE-112.md` §10 gates in isolation — it
   does **not** close G2/G3 for ISSUE-112 as a whole, which require all seven families.
3. **Phase 2**, per the §11.2 order: Hall of Fame (343 rows) next.
4. Do **not** resolve ISSUE-112. Do not add the canonical-rebuild AWARDS/HONOURS stage yet (§7)
   — record the §16.3 rebuild-stable-identity risk against it when that stage is designed.

**`link_status` enum labels (observed):** `unique`, `resolved`, `ambiguous`, `unmatched`,
`implausible`.

**Per-family measured results:** recorded in the §14.4 matrix above (row counts, season spans,
linked/unlinked, `source_record_id` completeness/distinctness, provenance distribution, per-season
counts, natural-key probes, link-decision distribution and orphan checks). Highlights:

- **Every `season`-bearing family (1, 4, 5, 6, 7) has `source_record_id` NULL = 0 and
  `distinct(source_record_id) = row count`** — the §14.2 completeness/uniqueness verdict is
  **PASS** for all five. Families 2 and 3 have no such column by design (ids minted at bootstrap).
- **Every natural-key probe returned zero true collisions:** HoF `(name, inducted_year)` = 0
  (and `name` alone = 0 across all 343 rows, including 45 with NULL `inducted_year`);
  honour teams `(team_name, player_name_raw)` = 0 and `(team_name, player_id)` = 0;
  captaincies `(season, club_id, player_name_raw, role)` = 0. All-Australian's 10
  `(season, player_name_raw)` pairs are the documented 1984 state/club dual selection (9) plus
  one genuine same-name (1) and do not touch the `(source_id, source_record_id)` reload key.
- **Link-decision ledger (family L) is small and fully consistent:** 74 awards-scoped
  `player_link_resolutions` rows, **0 pointing at a missing target row, 0 `linked` decisions
  whose target row now carries a different `player_id`**; `player_link_suggestions` empty. This
  is the G5-shape integrity check and it passes clean at G0.

**PostgreSQL bootstrap-completeness finding (resolves the §14.3 "pending measured" clause):**
every field each proposed manifest needs is present or deterministically reconstructable from the
`afldb_dev` state, **with exactly the three gaps §14.3 predicted and no new one**:

1. **`source_citation` — systemic, confirmed by measurement.** Provenance resolved cleanly to
   **source** granularity for every family (family 1 `draftguru` + `wikipedia`; families 2/3/4
   `wikipedia`; family 5 `footywire`; families 6/7 `draftguru`) via `source_id → sources.key`.
   No per-row page/edition citation exists in any of the five link-target tables (schema
   confirmed: no `source_url` / `source_citation` column). **Operator decision pending — not
   resolved here.**
2. **`hall_of_fame` / `honour_team_members` have no persisted stable id** — `source_key` is
   minted once at bootstrap (`hof:<seq>`, `honourteam:<team-slug>:<seq>`). Already the §4.2
   design; the zero-collision natural-key measurement makes the mint safe.
3. **`captaincies` raw club string and Rising Star `club` / `opponent`** are reconstructed from
   `club_id` / `opponent_club_id` (deterministic; `captaincies.club_id` is NOT NULL on all 1,375
   rows; Rising Star has 1 NULL `club_id` and 3 NULL `opponent_club_id` — source gaps).

**§11.3 person-link ledger coverage — partially resolved, remainder is a G1 item.** The tracked
replacement for `load_person_links()`, `data/reference/draftguru-link-decisions.json`, carries
**6 explicit decisions** (5 `linked`, 1 `confirmed_unlinked`); by its own contract it holds
*explicit human decisions only* and automatic historical links are regenerated by the loader's
scorer, never replayed. Measured DB side: **2,716 `draftguru`-sourced `award_winners` rows,
2,567 linked (94.5%), 149 unlinked** — i.e. the overwhelming majority of links are automatic and
will be regenerated, and only a handful are human-pinned. The awards-side curation ledger
(`player_link_resolutions`, 74 awards-scoped rows) is fully consistent with live rows (orphan
check clean). **What G0 cannot close:** `award_winners` does not retain the DraftGuru
`player_url` / `dg_person_id` bridge key (only its outcome, §14.3 row 6), so a row-by-row proof
that the 6-entry ledger covers every identity the awards manifests need must be done when the
loader re-resolves the manifest against the ledger — a **G1** check, not G0.

**§11.4 natural-key decision — measurement supports leaving the keys as-is.** Zero collisions on
every relevant natural key (see above). The only residual is the acknowledged property that a
curated rename of a decided row is link-losing; that is a policy acknowledgement for the operator
(§14.5 item 2), not a data defect.

**Cross-checks (frame, not the measurement):** family A 40 defs = `docs/search.md:220`;
family 3 113 rows = legacy `team_selections`; family 5 766 = legacy `rising_star_nominees`;
family 4 1,375 all-linked = `docs/data-dictionary.md` §3. All-Australian merged to 1,158 from the
legacy 906 + 1,252 (overlap dedup 1979–1990), `draftguru` 906 matching legacy `all_australian`
exactly. `draftguru`-sourced `award_winners` total 2,716; in-scope families 1 + 6 + 7 account for
2,637; the 79-row remainder is out-of-ISSUE-112-scope (Coleman — ISSUE-111) and was not measured
further, per the G0 boundary.

**Files changed this pass:** `issues/open/AFLDB-ISSUE-112.md`,
`issues/open/AFLDB-ISSUE-102-HANDOFF.md`. `IssuesIndex.md` next-action text refreshed for
ISSUE-112. No `CHANGELOG.md` change (measurement-only). No Git command run. No manifest created,
no loader written, no `import_awards.py` run, no migration, no scrape, no production contact,
ISSUE-111 / ISSUE-113 untouched.

---

## 17. Pass 8 — 2026-09-01: real DB-backed validation EXECUTED, GREEN

**Scope:** Pass 7's §16.7 exact next action — provision the restricted `afldb_import` test-role
credential and run the new integration block for real. Operator constraint this pass: do not sync
or modify anything on the streamanator checkout; use streamanator **only** as the PostgreSQL
endpoint, reached from `D:\dev\afldb-issue-102` over a temporary SSH local port-forward
(`arm@10.0.40.100`, key `~/.ssh/afldb_dev`), opened and closed within this pass.

**Outcome: GREEN. The honour-teams describe block executed for real against `afldb_test`, not
skipped.**

### 17.1 DSN safety proof

| DSN | Role/source | Proven `current_database()` | Proven `current_user` |
|---|---|---|---|
| `AFLDB_TEST_DATABASE_URL` (existing, from streamanator `.env`) | owner-role test DSN | `afldb_test` | `afldb_owner` |
| `AFLDB_TEST_IMPORT_DATABASE_URL` (**not configured anywhere reachable** — same finding as Pass 7 §16.5) | derived ephemerally, in-process only, from `AFLDB_IMPORT_DATABASE_URL` by substituting only the database name (`afldb_dev` → `afldb_test`); never written to disk | `afldb_test` | `afldb_import` |

Both proofs were obtained through the local tunnel before any test ran. No password or full DSN
was printed at any point in this pass.

### 17.2 Local execution blocker found and resolved

The suite spawns `tools/migration/import_awards.py` as a Python child process
(`runImporter`/`spawnSync`). Windows `python` (3.12.10) in this worktree had no `psycopg`
installed, which would make `hasPsycopg()` / `canSpawnPython` false and self-skip the entire file
regardless of DSN configuration — a different cause from Pass 7's skip (which was DSN-absence with
`canSpawnPython` never reached). Installed `psycopg[binary]` locally via `pip install --user`
(local machine only; no repository file, no server file, no `requirements.txt` — none exists —
touched).

### 17.3 Test execution

```
npx vitest run tests/integration/awards-reload-links.test.ts -t "honour-teams manifest reload"
```

**Result: 6/6 passed, 0 failed** (53 other pre-existing tests in the file excluded by the `-t`
filter — ordinary vitest filtering, not a restricted-role skip).

| Requirement | Test | Result |
|---|---|---|
| 113-row parity | `reloads the full 113-row manifest as afldb_import with AFLDB_LEGACY_SQLITE unset` | PASS — `import_batches` `records_read=113`, `records_rejected=0`, `status=completed`; `honour_team_members` split `total=113, linked=89, unlinked=24, teams=5` |
| Idempotent reload | `is idempotent across three consecutive reloads with a byte-identical row-id fingerprint` | PASS |
| Explicit link-decision survival | `keeps the one explicit honour_team_members link decision (Ted Whitten) resolved across a reload` | PASS |
| 24 unlinked rows preserved | `leaves all 24 unlinked observations unlinked` | PASS |
| `manual_admin_edit` protection | `does not touch a manual_admin_edit honour_team_members row` | PASS |
| Other-family non-interference | `does not change hall_of_fame, captaincies, award_winners or award_nominations row counts` | PASS |

`git diff --check`: clean.

### 17.4 Files changed this pass

`issues/open/AFLDB-ISSUE-112.md` §17 (this section), `issues/open/AFLDB-ISSUE-102-HANDOFF.md`,
`IssuesIndex.md`. **No file on the streamanator host was created, modified or deleted** — verified
the honour-teams slice files remain absent from `/home/arm/projects/afldb` both before and after
this pass. No migration run. No `afldb_dev` contact. No production contact. No Git command run.
Hall of Fame not started. ISSUE-111 / ISSUE-113 untouched.

### 17.5 Exact next action

Honour-teams family-specific G1–G4 (§10) are satisfied by this pass's evidence — **for the
honour-teams family only**; this does not close G2/G3 for ISSUE-112 as a whole, which need all
seven families. Phase 2 — Hall of Fame (343 rows) — is the next implementation slice, per the
§11.2 order. **Do not resolve ISSUE-112.**

---

## 18. Pass 9 — 2026-09-01: implementation slice 2 (HALL OF FAME) — IMPLEMENTED and DB-validated

**Scope:** the second ISSUE-112 implementation slice, **Hall of Fame only** (§11.2 phase 2). No
other family. Authorised: read-only bootstrap extraction from `afldb_dev` (connection proven
`afldb_dev` + `transaction_read_only = on` first); DB-free tests; `npx tsc --noEmit`; focused
`afldb_test`-only integration under the restricted `afldb_import` role; `git diff --check`. No
scrape, no `afldb_dev` mutation, no production, ISSUE-111 / ISSUE-113 untouched, `D:\dev\afldb`
not accessed, no Git command, no migration, no privilege change, the streamanator checkout not
modified.

**Outcome: COMPLETE and GREEN.** Manifest built, loader rewired, DB-free + real-DB integration
tests written and passing.

### 18.1 Bootstrap extraction — executed, read-only, proven

Same discipline as Passes 5/7: one `psql` script, step-0 connection guard, piped over SSH stdin
(`arm@10.0.40.100`, key `~/.ssh/afldb_dev`, DSN read from `/home/arm/projects/afldb/.env`
`AFLDB_IMPORT_DATABASE_URL`, password never printed), whole run inside
`BEGIN TRANSACTION READ ONLY; … ROLLBACK;`. **Observed:** `current_database() = afldb_dev`,
`current_user = afldb_import`, host `127.0.0.1:5432`, `transaction_read_only = on`,
PostgreSQL 16.15. No server-side file written; nothing committed.

Measured results matched G0 (§14.4) exactly:

| Fact | Value |
|---|---|
| rows | **343**, provenance **`wikipedia`** for all |
| `inducted_year` | 1996–2026; **45 NULL** |
| linked / name-only | **246 / 97** |
| legends (`is_legend`) | **34**, `legend_year` present on the same 34 |
| `removed_year` present | 2 (Barry Cable 2023, Nicky Winmar 2026) — both `category = 'removed'` |
| natural key `(name, inducted_year)` duplicates | **0**; `name` alone duplicates **0** |
| `player_id` appearing on >1 row | **3** — same person on a dated and an undated row (e.g. John Kennedy Sr / John Kennedy Sr.; Graham 'Polly' Farmer / Graham Farmer; Haydn Bunton Sr / Sr.). Legitimate; `hall_of_fame` has no linked-identity uniqueness constraint (`ix_hof_player` is non-unique), so the parser does **not** enforce global `player_id` uniqueness. |
| `category` vocabulary | `administrator, coach, legend, media, pioneer, player, removed, umpire` (all 343 rows carry one) |
| `link_status` vocabulary | `unique` 234, `resolved` 12, `ambiguous` 2, `unmatched` 92, `implausible` 3 |
| `player_link_resolutions` (hall_of_fame) | **5 rows, all `action = linked`**, latest-per-target = 5 linked, **0 orphaned target rows, 0 player mismatches**. Targets: Albert Chadwick/1996→2666, Carji Greeves/1996→2959, Graham 'Polly' Farmer/1996→2861, John Kennedy Sr/1996→1893, John Kennedy Sr./(NULL year)→1893. Every one already `resolved` on its row with the decided `player_id`. |
| `player_link_suggestions` (hall_of_fame) | **0** (whole table empty) |
| rebuild-stability probe | of 246 linked rows, **239** resolve to exactly one `afltables_profile_url` identity, **7** to none, **0** to more than one (carried-forward risk §18.3) |

### 18.2 Manifest — `data/awards/hall-of-fame.csv`

344 lines (header + 343). Exact column order:

```
source_key,name,inducted_year,category,is_legend,legend_year,club,state,playing_career,removed_year,player_id,link_status,note,source_citation
```

- **`source_key`** — minted once as `hof:<seq>`, `<seq>` a 1-based running counter in file order.
  This is an **internal manifest key**, not the database reload key: `hall_of_fame` has no
  `source_record_id` and `reload_keyed` still keys on the natural `(name, inducted_year)`
  (§4.2 structural warning). It is a positional sequence frozen in the checked-in CSV, so it
  survives a canonical rebuild and a deterministic reload; it is **not** derived from
  `player_id`, the target-row `id`, or any database surrogate. Adding a future intake is an
  `--assign-ids`-style concern, deferred exactly as in the honour-teams slice.
- **Deterministic order** (file order and `<seq>` basis): `inducted_year ASC NULLS LAST, name`
  with `name` compared by Unicode code point — extracted with `name COLLATE "C"` so the
  parser's Python string comparison matches the extraction byte-for-byte. (The first extraction
  used the database's default collation; re-run under `COLLATE "C"` after the ordering validator
  rejected it — recorded so it is not repeated.)
- **`name`** — the source spelling verbatim; this is what `reload_keyed`'s `name_column="name"`
  guard compares. All 5 decision target `(name, inducted_year)` keys appear verbatim.
- **`note`** — `hall_of_fame.notes` verbatim. The legacy loader folded `games_goals` into
  `notes` at the original load (`" · ".join(...)`), so the PostgreSQL value is already the
  combined string — there is nothing to re-join in the new loader.
- **`source_citation`** — the literal `wikipedia` for all 343 rows, per the source-granularity
  operator policy (§13); **not** a per-row page citation.
- `.gitignore` whitelisted (`!/data/awards/hall-of-fame.csv`, alongside `22-under-22.csv` and
  `honour-teams.csv`).

### 18.3 Loader — `tools/migration/hall_of_fame.py` + `import_awards.py`

New `tools/migration/hall_of_fame.py`, in the `honour_teams.py` / `under_22.py` mould:
`HallOfFameSourceError(ValueError)`, a frozen `HallOfFameInductee` dataclass,
`load_hall_of_fame()` that fully validates before constructing any row (no best-effort
coercion), `summary()` / `main()` giving a DB-free `--check` (JSON out, exit 1 on error).
Refuses: malformed header; missing required field (`source_key`, `name`, `category`,
`is_legend`, `link_status`, `source_citation`); leading/trailing whitespace or a control
character in any text field; `inducted_year` / `legend_year` / `removed_year` not an integer or
outside the declared `1996–2026` span; `is_legend` not `true`/`false`; `category` outside the
8-value vocabulary; `link_status` outside the 5-value enum; `link_status` disagreeing with
`player_id` presence (the migration 019/053 invariant, enforced here rather than left to the
database); `is_legend` vs `legend_year` presence disagreeing (both directions); `removed_year`
vs `category = 'removed'` disagreeing (both directions); malformed `source_key` (not
`hof:<positive-int>`); a `source_key` seq out of the running sequence; duplicate `source_key`
(checked **before** the seq rule — a literal repeat is always also seq-invalid, so checking
duplication first keeps that failure distinctly reported); duplicate natural identity
`(name, inducted_year)`; rows out of deterministic order (a dated row after an undated one,
`inducted_year` decreasing, or `name` not ascending within an `inducted_year` group); a total
row count ≠ 343, a NULL-`inducted_year` count ≠ 45, or a dated span ≠ 1996–2026.

`import_awards.py`: added `from hall_of_fame import HallOfFameInductee, load_hall_of_fame`.
`import_hall_of_fame()` lost its `lite` parameter; its body now calls `load_hall_of_fame()`
instead of `lite.execute("SELECT ... FROM hall_of_fame ...")`, mapping the parsed rows onto the
same tuple shape the loader already built (still passed through the existing `link_status()`
invariant call for defence in depth). **The `reload_keyed(...)` call — key
`["name", "inducted_year"]`, the same 14-column value list, `scope_column="source_id"`,
`name_column="name"`, `refuse_out_of_scope_key=True`, `allow_link_loss` — is byte-identical to
before.** `"hall_of_fame"` added to `LEGACY_FREE_GROUPS`;
`BATCH_SOURCE_KEYS["hall_of_fame"] = "wikipedia"` added so its `import_batch` records against
`wikipedia` rather than the `sports_data_lab` default. The `main()` dispatch drops the `lite`
argument for this group. `GROUPS`, `GROUP_ORDER`, `GROUP_REQUIRES`, the `--dry-run` legacy-table
list, and every other group are untouched. No migration, no privilege change.

**Carried-forward risk, unchanged in kind from the honour-teams slice (§16.3), not a slice-2
blocker:** the manifest carries the 246 linked rows' `player_id` verbatim from `afldb_dev`. That
reproduces the family exactly in a database sharing `afldb_dev`'s player numbering (which every
pre-existing `hall_of_fame` test in `awards-reload-links.test.ts` already assumes). It is **not**
durable across a from-scratch canonical rebuild that re-seeds `players.id` (ISSUE-111 G5) — and
7 of the 246 linked rows do not carry a unique `afltables_profile_url` today (§18.1), so a
rebuild-stable re-resolution step could not cover all 246 without a separate adjudication.
Recorded against the deferred canonical-rebuild AWARDS/HONOURS stage (§7). `source_key`, not
`player_id`, is the manifest's durable identity.

### 18.4 Tests

**DB-free — `tests/hall-of-fame-source.test.ts` (new, 24 cases, all passing):** the full 343-row
manifest parses with the exact G0-measured shape (`row_count: 343`, `legend_count: 34`,
`linked_count: 246`, `unlinked_count: 97`, `null_inducted_year_count: 45`,
`inducted_year_min/max: 1996/2026`, the 8-entry `categories` map); three representative rows
round-trip verbatim (the two John Kennedy Sr `(name, inducted_year)` keys and an undated
name-only row); every row's `source_citation` is `wikipedia`; and one test each for: malformed
header; unknown `category`; invalid `link_status`; `is_legend` not boolean; a `source_citation`
outside the decided value (both a wrong source key and a page-URL-shaped value); `link_status`
disagreeing with `player_id` presence (both directions); `is_legend` true without
`legend_year`; `legend_year` set with `is_legend` false; `removed_year` without
`category='removed'` and vice versa; `inducted_year` outside the declared span; malformed
`source_key`; seq out of sequence; duplicate `source_key`; duplicate natural identity; rows out
of deterministic order within a year; a dated row after an undated row; `inducted_year` running
backwards across groups; a total row count short of 343. Reuses the honour-teams test's
quote-aware CSV cell helpers and a minimal synthetic valid row for the per-row cases.

**Integration — `tests/integration/awards-reload-links.test.ts` (new `describe` block, gated
`canRunHallOfFameImporter`, legacy-free like the `canRunHonourTeamsImporter` block):** reloads
the full 343-row manifest with `AFLDB_LEGACY_SQLITE` forced unset and asserts the
`import_batches` row (`records_read = 343`, `records_rejected = 0`, target `hall_of_fame`,
`status = completed`) and the resulting split (`total 343, linked 246, unlinked 97, legends 34`
for `source_id = wikipedia`); three consecutive reloads produce a byte-identical
`(id, name, inducted_year, player_id)` fingerprint; each of the five explicit
`player_link_resolutions` decisions resolves under the natural key, keeps its `id` and decided
`player_id` and stays `resolved` across an extra reload; all 97 name-only rows stay unlinked; a
synthetic `manual_admin_edit`-sourced `hall_of_fame` row survives untouched;
`honour_team_members` / `captaincies` / `award_winners` / `award_nominations` row counts are
unchanged by a `hall_of_fame`-only run. The file's top-level `beforeAll` gains
`canRunHallOfFameImporter` in its validate condition; no other wiring changed.

### 18.5 Validation — exact results

1. **DB-free:** `npx vitest run tests/hall-of-fame-source.test.ts` — **24/24 passed**;
   `hall-of-fame.py --check` against the real manifest prints `ok: true` with the G0 shape.
2. **Typecheck:** `npx tsc --noEmit` — **clean.**
3. **Integration — EXECUTED FOR REAL, GREEN.** Run from `D:\dev\afldb-issue-102` with streamanator
   used only as the PostgreSQL endpoint over a temporary SSH local port-forward (`arm@10.0.40.100`,
   key `~/.ssh/afldb_dev`), opened and closed within the pass. **DSN safety proof (before any
   test):** `AFLDB_TEST_DATABASE_URL` → `current_database() = afldb_test`,
   `current_user = afldb_owner`; `AFLDB_TEST_IMPORT_DATABASE_URL` does not exist anywhere reachable
   (same finding as Pass 8) — derived ephemerally in-process from `AFLDB_IMPORT_DATABASE_URL` by
   substituting only the database name (`afldb_dev` → `afldb_test`), never written to disk, proven
   `current_database() = afldb_test`, `current_user = afldb_import`. No password or full DSN
   printed. Local `psycopg` 3.3.5 already present (Pass 8). Result:
   `npx vitest run tests/integration/awards-reload-links.test.ts -t "hall-of-fame manifest reload"`
   — **6/6 passed, 0 failed** (59 other tests filtered out by `-t`). Re-run alongside the
   honour-teams block (`-t "manifest reload .AFLDB-ISSUE-112."`) — **12/12 passed**, confirming the
   honour-teams slice is not regressed.
4. **`git diff --check`:** clean.

### 18.6 Files changed this pass

`.gitignore` (new whitelist line), `data/awards/hall-of-fame.csv` (new, 344 lines),
`tools/migration/hall_of_fame.py` (new), `tools/migration/import_awards.py` (import,
`import_hall_of_fame` signature/body, `LEGACY_FREE_GROUPS`, `BATCH_SOURCE_KEYS`, `main()` call
site), `tests/hall-of-fame-source.test.ts` (new), `tests/integration/awards-reload-links.test.ts`
(new `describe` block + `canRunHallOfFameImporter` gate + `beforeAll` condition),
`issues/open/AFLDB-ISSUE-112.md` (§13, this §18), `issues/open/AFLDB-ISSUE-102-HANDOFF.md`,
`IssuesIndex.md`. No `CHANGELOG.md` entry — nothing deployed or run against a live application
database; `import_awards.py`'s behaviour for the five still-legacy-dependent groups is unchanged.
Two stray 0-byte files in the worktree root (`operator`, `!line.includes('`), created as
tooling artefacts during this pass, were removed; they were never tracked. No Git command run.
`afldb_dev` read-only for the §18.1 extraction only. No migration. No production contact. The
streamanator checkout was not modified. ISSUE-111 / ISSUE-113 untouched. `D:\dev\afldb` not
accessed.

### 18.7 Exact next action

1. Hall-of-Fame family-specific G1–G4 (§10) are satisfied by this pass's evidence — **for the
   Hall of Fame family only**; this does not close G2/G3 for ISSUE-112 as a whole, which need all
   seven families.
2. **Phase 3 — captaincies (1,375 rows)** — is the next implementation slice, per the §11.2
   order (captaincies → Rising Star → All-Australian → club best-and-fairest → named medals).
   Captaincies has its own ISSUE-085 ownership scoping and a fixture precedent
   (`awards-reload-links.test.ts:1248`), and it reloads on `(source_id, source_record_id)` (not a
   natural key), so its manifest shape differs from the two natural-keyed slices done so far.
3. Do **not** resolve ISSUE-112. Do **not** add the canonical-rebuild AWARDS/HONOURS stage yet
   (§7) — record the §18.3 rebuild-stable-identity risk against it when that stage is designed.

---

## 19. Pass 10 — 2026-09-01: implementation slice 3 (CAPTAINCIES) — IMPLEMENTED and DB-validated

**Scope:** the third ISSUE-112 implementation slice, **captaincies only** (§11.2 phase 3). No
other family. Authorised: read-only bootstrap extraction from `afldb_dev` (connection proven
`afldb_dev` + `transaction_read_only = on` first); DB-free tests; `npx tsc --noEmit`; focused
`afldb_test`-only integration under the restricted `afldb_import` role; combined ISSUE-112
manifest-reload regression; `git diff --check`. No scrape, no `afldb_dev` mutation, no
production, ISSUE-111 / ISSUE-113 untouched, `D:\dev\afldb` not accessed, no Git command, no
migration, no privilege change, the streamanator checkout not modified.

**Outcome: COMPLETE and GREEN.** Manifest built, loader rewired, DB-free + real-DB integration
tests written and passing.

### 19.1 Bootstrap extraction — executed, read-only, proven

Same discipline as Passes 5/7/9: one `psql` script, step-0 connection guard (a `DO` block that
`RAISE EXCEPTION`s unless `current_database() = 'afldb_dev'` and
`current_setting('transaction_read_only') = 'on'`, under `ON_ERROR_STOP=1`), piped over SSH
stdin (`arm@10.0.40.100`, key `~/.ssh/afldb_dev`, DSN read from `/home/arm/projects/afldb/.env`
`AFLDB_IMPORT_DATABASE_URL`, password never printed), whole run inside
`BEGIN TRANSACTION READ ONLY; … ROLLBACK;`. **Observed:** `current_database() = afldb_dev`,
`current_user = afldb_import`, host `127.0.0.1:5432`, `transaction_read_only = on`,
PostgreSQL 16.15. No server-side file written; nothing committed.

Measured results matched G0 (§14.4) exactly:

| Fact | Value |
|---|---|
| rows | **1,375**, provenance **`wikipedia`** for all |
| `source_record_id` | NULL = 0, distinct = 1,375 = rows; **every value is `^[0-9a-f]{24}$`** (a 24-hex digest from the legacy scrape), min_len = max_len = 24, no whitespace |
| season | 1897–2026, **130 distinct**, span exactly 130 → contiguous, no gap season |
| linked / unlinked | **1,375 / 0** — `player_id` NOT NULL on every row |
| `club_id` | NOT NULL on every row; **18 distinct clubs**, all canonical AFL/VFL clubs |
| `role` vocabulary | the single value **`Captain`** |
| `period` | present on all 1,375; `notes` present on 178 (NULL on 1,197, no empty strings) |
| natural key `(season, club_id, player_name_raw, role)` duplicates | **0** (`captaincies_natural_uq` re-proved) |
| `player_link_resolutions` (captaincies) | **0 rows** (matches G0 §14.4) |
| `player_link_suggestions` (captaincies) | **0 rows** |
| text hygiene | 0 rows with leading/trailing whitespace or a control character in `player_name_raw` / `period` / `notes` |
| **club_id round-trip** | for **all 1,375 rows**, the stored `club_id` equals `identity_for_season(organization_of(club_id), season)` — i.e. re-resolving the canonical `clubs.name` season-aware reproduces the exact stored `club_id`. Zero mismatches. Era-pair boundaries line up cleanly: Footscray ≤ 1996 / Western Bulldogs ≥ 1997; South Melbourne ≤ 1981 / Sydney ≥ 1982; Kangaroos 1999–2007 inside North Melbourne. |
| rebuild-stability probe | of the 444 distinct linked `player_id`s, **444** resolve to exactly one `afltables_profile_url` identity, **0** to none, **0** to more than one (carried-forward risk §19.3) |

### 19.2 Manifest — `data/awards/captaincies.csv`

1,376 lines (header + 1,375). Exact column order:

```
source_key,season,club,player,player_id,link_status,role,period,note,source_citation
```

- **`source_key`** — the **preserved** `captaincies.source_record_id`, carried **verbatim**. This
  is the durable row identity and the database reload key half `(source_id, source_record_id)`.
  It is **not** re-minted (unlike the honour-teams `honourteam:<slug>:<seq>` and Hall of Fame
  `hof:<seq>` internal keys, which those tables have no persisted id for). The parser validates
  `^[0-9a-f]{24}$`, global uniqueness, and strictly-ascending file order.
- **Deterministic order** — `source_key` ascending under `COLLATE "C"` (all characters `[0-9a-f]`,
  so byte order is unambiguous and collation-independent). The parser enforces strict ascent.
- **`club`** — the canonical `clubs.name` for the row's **era identity** (e.g. `Footscray`,
  `Western Bulldogs`, `Kangaroos`), extracted by joining `club_id → clubs`. It is **not** a
  frozen `club_id`: the loader re-resolves it through `import_awards.ClubResolver.resolve(club,
  season)` — the exact season-aware path the legacy loader used for its raw club string — so the
  manifest carries a **rebuild-stable club identity**. §19.1 proved all 1,375 rows round-trip.
  Validated against an 18-name `KNOWN_CLUBS` vocabulary.
- **`player`** — `player_name_raw` verbatim; this is what `reload_keyed`'s `name_column`
  guard compares.
- **`player_id`** — carried verbatim for all 1,375 linked rows (deferred rebuild risk §19.3).
- **`link_status`** — `unique` (1,315) or `resolved` (60); both linked statuses. The parser
  enforces the migration 019/053 invariant (linked status ⟺ `player_id` present) and a
  completeness check that **every** row is linked.
- **`role`** — `Captain` for all rows; `ROLES = {"Captain"}` vocabulary.
- **`period`** — text, present on all rows (contains en-dash `–` and free text such as
  `(co-captain)`; UTF-8).
- **`note`** — `captaincies.notes` verbatim, optional (178 present); commas inside are
  CSV-quoted.
- **`source_citation`** — the literal `wikipedia` for all 1,375 rows, per the source-granularity
  operator policy (§13); **not** a per-row page citation.
- `.gitignore` whitelisted (`!/data/awards/captaincies.csv`, alongside `22-under-22.csv`,
  `honour-teams.csv`, `hall-of-fame.csv`).

### 19.3 Loader — `tools/migration/captaincies.py` + `import_awards.py`

New `tools/migration/captaincies.py`, in the `hall_of_fame.py` / `honour_teams.py` /
`under_22.py` mould: `CaptainciesSourceError(ValueError)`, a frozen `Captaincy` dataclass,
`load_captaincies()` that fully validates before constructing any row (no best-effort
coercion), `summary()` / `main()` giving a DB-free `--check` (JSON out, exit 1 on error).
Refuses: malformed header; missing required field (`source_key`, `season`, `club`, `player`,
`link_status`, `role`, `period`, `source_citation`); leading/trailing whitespace or a control
character in any text field; `season` not an integer or outside the declared `1897–2026`;
`source_key` not `^[0-9a-f]{24}$`; a `club` not in the 18-name vocabulary; a `role` not
`Captain`; a `link_status` outside the 5-value enum; `link_status` disagreeing with `player_id`
presence (both directions); a `source_citation` other than `wikipedia`; duplicate `source_key`
(checked **before** the ordering rule — a literal repeat is always also an ordering violation,
so checking duplication first keeps that failure distinctly reported); `source_key` rows out of
strictly-ascending order; duplicate natural identity `(season, club, player, role)`; a total
row count ≠ 1,375, a season span ≠ 1897–2026, a distinct-season count ≠ 130, a distinct-club
count ≠ 18, any unlinked row, or a role vocabulary ≠ `{Captain}`.

`import_awards.py`: added `from captaincies import Captaincy, load_captaincies`.
`import_captaincies()` **lost its `lite` parameter**; its body now calls `load_captaincies()`
instead of `lite.execute("SELECT … FROM captaincies …")`, mapping the parsed rows onto the same
11-tuple the loader already built (`row.role` / `row.period` / `row.note` straight from the
manifest; `row.player_id` straight through; `status` still via the existing `link_status()`
invariant call for defence in depth). **The `_refuse_captaincy_natural_key_collisions(pg,
prepared, source_id)` call and the function itself are byte-identical** — the positional tuple
shape it reads (`[0]` season, `[1]` club_id, `[3]` player_name_raw, `[5]` role) is preserved.
**The `reload_keyed(...)` call — key `["source_id", "source_record_id"]`, the same 11-column
value list, `scope_column="source_id"`, `scope_values=[source_id]`, `allow_link_loss` — is
byte-identical to before.** `captaincies_natural_uq` semantics are untouched. `"captaincies"`
added to `LEGACY_FREE_GROUPS`; `BATCH_SOURCE_KEYS["captaincies"] = "wikipedia"` added so its
`import_batch` records against `wikipedia` rather than the `sports_data_lab` default. The
`main()` dispatch drops the `lite` argument for this group. `GROUPS`, `GROUP_ORDER`,
`GROUP_REQUIRES`, and the `--dry-run` legacy-table list (which still names `hall_of_fame` /
`team_selections` / `captaincies` — left untouched, consistent with slices 1 & 2) are unchanged.
No migration, no privilege change.

**Carried-forward risk, unchanged in kind from slices 1 & 2 (§16.3 / §18.3), not a slice-3
blocker:** the manifest carries the 1,375 rows' `player_id` verbatim from `afldb_dev`. That
reproduces the family exactly in a database sharing `afldb_dev`'s player numbering (which every
pre-existing captaincy test already assumes). It is **not** durable across a from-scratch
canonical rebuild that re-seeds `players.id` (ISSUE-111 G5). **Better than the earlier slices:**
all 444 distinct linked players resolve to exactly one `afltables_profile_url` today (0 with
none), so a rebuild-stable re-resolution step *could* cover every captaincy row — but building
it is the deferred §7 canonical-rebuild AWARDS/HONOURS stage's job, not this slice's; the
pattern is kept consistent. **The club identity, by contrast, is already rebuild-stable** —
re-resolved from the canonical `clubs.name` through the season-aware `ClubResolver`, which the
§7 stage feeds with canonically rebuilt `clubs` / `club_aliases` (it runs after DRAFTGURU).
`source_key` (= `source_record_id`) is the manifest's durable row identity.

### 19.4 Tests

**DB-free — `tests/captaincies-source.test.ts` (new, 22 cases, all passing):** the full
1,375-row manifest parses with the exact G0-measured shape (`row_count: 1375`,
`linked_count: 1375`, `unlinked_count: 0`, `season_min/max: 1897/2026`, `distinct_seasons: 130`,
`distinct_clubs: 18`, `notes_present: 178`, `roles: {Captain: 1375}`); three representative
rows round-trip verbatim (a `resolved`-status row with a note, a row whose note contains commas
and is CSV-quoted, the first row in deterministic order); every row's `source_citation` is
`wikipedia`; every `source_key` is 24 hex chars, unique, strictly ascending. One test each for:
malformed header; a `source_key` that is not a 24-hex digest; `source_key` rows out of
ascending order; duplicate `source_key`; duplicate natural identity `(season, club, player,
role)`; season outside coverage; unknown club; role outside `{Captain}`; invalid `link_status`;
`unique`/`resolved` without `player_id`; a non-linked status carrying `player_id`; a
`source_citation` outside `wikipedia`; a missing required field (empty `period`); a `player`
field with edge whitespace; a total row count short of 1,375. A second `describe` block reads
`import_awards.py` as text and asserts `captaincies` is in `LEGACY_FREE_GROUPS`,
`BATCH_SOURCE_KEYS["captaincies"] = "wikipedia"`, and that `import_captaincies` no longer
threads a legacy SQLite handle.

**Integration — `tests/integration/awards-reload-links.test.ts` (new `describe` block, gated
`canRunCaptainciesImporter`, legacy-free like the `canRunHallOfFameImporter` block):** reloads
the full 1,375-row manifest with `AFLDB_LEGACY_SQLITE` forced unset and asserts the
`import_batches` row (`records_read = 1375`, `records_rejected = 0`, target `captaincies`,
`status = completed`) and the resulting split (`total 1375, linked 1375, unlinked 0, clubs 18,
seasons 130` for `source_id = wikipedia`); **re-resolves each era identity from the canonical
club name season-aware** (five `source_record_id → clubs.slug` assertions across the three
era-pairs); three consecutive reloads produce a byte-identical
`(id, source_record_id, season, club_id, player_id)` fingerprint; a `resolved`-status captaincy
keeps its `id` and `player_id` across an extra reload; every wikipedia-owned row stays linked;
a synthetic `manual_admin_edit` captaincy row survives untouched **(AFLDB-ISSUE-085)**; and —
**AFLDB-ISSUE-085 collision refusal, manifest-driven** — flipping the real Percy Bentley 1939
Richmond row to `manual_admin_edit` ownership makes the next reload fail closed
(`_refuse_captaincy_natural_key_collisions`: exit 1, `natural key(s)`, `does not own`,
`id=<row>`), writes nothing, and leaves the foreign row untouched; then restores a clean
wikipedia-owned population. `hall_of_fame` / `honour_team_members` / `award_winners` /
`award_nominations` row counts are unchanged by a `captaincies`-only run.

**Retired:** the synthetic-SQLite captaincy fixture `buildCaptaincyFixtureDb` and the
`describe('captaincies reload reconciles only wikipedia-owned rows (AFLDB-ISSUE-085)')` block
that drove it — `import_captaincies` no longer reads a legacy SQLite handle, so the fixture is
unreachable. Its two ownership protections (foreign-owned row untouched; natural-key collision
fail-closed) are **preserved, manifest-driven**, inside the new ISSUE-112 block, with the same
`natural key(s)` / `does not own` / `id=` assertions. The now-unused `CaptaincyRow` type and the
`node:os` / `mkdtempSync` / `rmSync` imports were removed with it. Coverage is not weakened —
the manifest block adds idempotency, id-stability, era re-resolution and 1,375-row parity on
top.

### 19.5 Validation — exact results

1. **DB-free:** `npx vitest run tests/captaincies-source.test.ts` — **22/22 passed**;
   `captaincies.py` against the real manifest prints `ok: true` with the G0 shape
   (`row_count 1375`, `distinct_seasons 130`, `distinct_clubs 18`, `roles {Captain: 1375}`).
2. **Typecheck:** `npx tsc --noEmit` — **clean**, after the ISSUE-085-block removal and import
   cleanup.
3. **Integration — EXECUTED FOR REAL, GREEN.** Run from `D:\dev\afldb-issue-102` with
   streamanator used only as the PostgreSQL endpoint over a temporary SSH local port-forward
   (`arm@10.0.40.100:5432 → localhost:5433`, key `~/.ssh/afldb_dev`), opened and closed within
   the pass. **DSN safety proof (before any test):** `AFLDB_TEST_DATABASE_URL` →
   `current_database() = afldb_test`, `current_user = afldb_owner`;
   `AFLDB_TEST_IMPORT_DATABASE_URL` does not exist anywhere reachable (same finding as Passes
   8/9) — derived ephemerally in-process from `AFLDB_IMPORT_DATABASE_URL` by rewriting only the
   host:port to the tunnel and the database name `afldb_dev → afldb_test`, never written to
   disk, proven `current_database() = afldb_test`, `current_user = afldb_import`. No password or
   full DSN printed. Local `psycopg` 3.3.5 present (Pass 8). Results:
   - `npx vitest run tests/integration/awards-reload-links.test.ts -t "captaincies manifest reload"`
     — **8/8 passed, 0 failed** (63 filtered out by `-t`).
   - Combined ISSUE-112 regression
     `-t "manifest reload .AFLDB-ISSUE-112."` — **20/20 passed** (honour teams 6 + Hall of Fame
     6 + captaincies 8), confirming slices 1 & 2 are **not regressed**.
   - Whole file `npx vitest run tests/integration/awards-reload-links.test.ts` — **50 passed,
     21 skipped, 0 failed**. The 21 skips are the pre-existing `AFLDB_LEGACY_SQLITE`-gated
     blocks (ISSUE-044 etc.), which skip because the legacy file is deliberately unset — not
     introduced by this pass. The `canRunFixtureImporter` blocks (ISSUE-080, ISSUE-111, …) all
     ran and passed.
4. **`git diff --check`:** clean (only benign CRLF-on-checkout warnings for the LF-authored new
   files, exit 0).

The temporary tunnel was torn down and the two ephemeral DSN scratch files deleted at the end
of the pass; nothing was persisted.

### 19.6 Files changed this pass

`.gitignore` (new whitelist line), `data/awards/captaincies.csv` (new, 1,376 lines),
`tools/migration/captaincies.py` (new), `tools/migration/import_awards.py` (import,
`import_captaincies` signature/body, `LEGACY_FREE_GROUPS`, `BATCH_SOURCE_KEYS`, `main()` call
site, one comment), `tests/captaincies-source.test.ts` (new),
`tests/integration/awards-reload-links.test.ts` (new `describe` block +
`canRunCaptainciesImporter` gate + `beforeAll` condition + `CAPTAINCIES_CSV`; retired the
ISSUE-085 SQLite fixture block and its now-dead helpers/imports),
`issues/open/AFLDB-ISSUE-112.md` (§13, this §19), `issues/open/AFLDB-ISSUE-102-HANDOFF.md`,
`IssuesIndex.md`. No `CHANGELOG.md` entry — nothing deployed or run against a live application
database; `import_awards.py`'s behaviour for the four still-legacy-dependent groups
(`awards`, `all_australian`, `rising_star`) is unchanged. One stray 0-byte tooling-artefact
file in the worktree root (`tuple[list[str]`) was removed; never tracked. No Git command run.
`afldb_dev` read-only for the §19.1 extraction only. No migration. No production contact. The
streamanator checkout was not modified. ISSUE-111 / ISSUE-113 untouched. `D:\dev\afldb` not
accessed.

### 19.7 Exact next action

1. Captaincies family-specific G1–G4 (§10) are satisfied by this pass's evidence — **for the
   captaincies family only**; this does not close G2/G3 for ISSUE-112 as a whole, which need
   all seven families.
2. **Phase 4 — Rising Star (766 rows)** — is the next implementation slice, per the §11.2
   order (Rising Star → All-Australian → club best-and-fairest → named medals). Rising Star
   reloads on `(source_id, source_record_id)` like captaincies, targets `award_nominations`,
   carries a `stat_line` jsonb and a round grain, and needs the `awards` definition to exist
   first.
3. Do **not** resolve ISSUE-112. Do **not** add the canonical-rebuild AWARDS/HONOURS stage yet
   (§7) — record the §19.3 rebuild-stable-identity (player_id) risk against it when that stage
   is designed; note the club identity is already rebuild-stable via `ClubResolver`
   re-resolution.

---

## 20. Pass 11 — 2026-09-01: implementation slice 4 (RISING STAR) — IMPLEMENTED and DB-validated

**Scope:** the fourth ISSUE-112 implementation slice, **Rising Star only** (§11.2 phase 4). No
other family. Authorised: read-only bootstrap extraction from `afldb_dev` (connection proven
`afldb_dev` + `transaction_read_only = on` first); DB-free tests; `npx tsc --noEmit`; focused
`afldb_test`-only integration under the restricted `afldb_import` role; combined ISSUE-112
manifest-reload regression; whole `awards-reload-links.test.ts`; `git diff --check`. No scrape,
no `afldb_dev` mutation, no production, ISSUE-111 / ISSUE-113 untouched, `D:\dev\afldb` not
accessed, streamanator checkout not modified, no Git command, no migration, no privilege change.

**Outcome: COMPLETE and GREEN.** Manifest built, loader rewired, DB-free + real-DB integration
tests written and passing.

### 20.1 Bootstrap extraction — executed, read-only, proven

Same discipline as Passes 5/7/9/10: one `psql` script, step-0 connection guard (a `DO` block
that `RAISE EXCEPTION`s unless `current_database() = 'afldb_dev'` and
`current_setting('transaction_read_only') = 'on'`, under `ON_ERROR_STOP=1`), piped over SSH
stdin (`arm@10.0.40.100`, key `~/.ssh/afldb_dev`, DSN read from `/home/arm/projects/afldb/.env`
`AFLDB_IMPORT_DATABASE_URL`, password never printed), whole run inside
`BEGIN TRANSACTION READ ONLY; … ROLLBACK;`. **Observed:** `current_database() = afldb_dev`,
`current_user = afldb_import`, host `127.0.0.1:5432`, `transaction_read_only = on`,
PostgreSQL 16.15. No server-side file written; nothing committed.

Measured results matched G0 (§14.4) exactly:

| Fact | Value |
|---|---|
| rows | **766**, provenance **`footywire`** for all |
| `source_record_id` | NULL = 0, distinct = 766 = rows; **every value is `^[0-9a-f]{24}$`** (a 24-hex digest from the FootyWire scrape), min_len = max_len = 24, no whitespace, all trimmed |
| season | 1993–2026, **34 distinct** (contiguous), span exactly 34 |
| `round_number` | present on **all 766**, range **0–24**, 25 distinct — a required field |
| linked / unlinked | **766 / 0** — `player_id` NOT NULL on every row |
| `link_status` | `unique` 679 + `resolved` 87 (both linked statuses) |
| `club_id` | **1 NULL** (Michael Gardiner, 1997 — the source club string never resolved); 765 resolved across **22 canonical club names** |
| `opponent_club_id` | **3 NULL** (two 2026 rounds not yet played, one 2013 row); 763 resolved |
| `is_winner` | 33 true — **exactly one per decided season 1993–2025, zero for 2026** |
| `is_ineligible` | 9 true; `ineligible_reason` present on exactly those 9 (free text, all suspension notices), absent on the other 757 |
| `votes` | **NULL on every row** — not a fact this family carries |
| `stat_line` | **763 present / 3 NULL**; every non-null value is a JSON object whose keys are a subset of the 12 FootyWire stat keys and whose values are all integers (`jsonb_typeof` = `number` throughout) |
| natural key `(season, player)` duplicates | **0** — no player is the nominee twice in a season |
| `player_link_resolutions` / `player_link_suggestions` (award_nominations) | **0 / 0** (matches G0 §14.4) |
| **club/opponent round-trip** | for **all 765 club + 763 opponent** non-null rows, the stored id equals `identity_for_season(organization_of(id), season)` — re-resolving the canonical `clubs.name` season-aware reproduces the exact stored id. **Zero mismatches.** Era pairs (Footscray/Western Bulldogs, Fitzroy/Brisbane Bears/Brisbane Lions, North Melbourne/Kangaroos, South Melbourne→Sydney) all line up. |

### 20.2 Manifest — `data/awards/rising-star.csv`

767 lines (header + 766). Exact column order:

```
source_key,season,round_number,club,opponent,player,player_id,link_status,is_winner,is_ineligible,ineligible_reason,votes,stat_line,source_citation
```

- **`source_key`** — the **preserved** `award_nominations.source_record_id`, carried
  **verbatim**. This is the durable row identity and the database reload key half
  `(source_id, source_record_id)`. **Not re-minted** (like captaincies §19.2, unlike the
  natural-keyed honour-teams / Hall of Fame internal keys). The parser validates
  `^[0-9a-f]{24}$`, global uniqueness, and strictly-ascending file order.
- **Deterministic order** — `source_key` ascending under `COLLATE "C"` (all characters
  `[0-9a-f]`, so byte order is collation-independent). The parser enforces strict ascent.
- **`round_number`** — required integer 0–24 (measured; every row carries one).
- **`club` / `opponent`** — the canonical `clubs.name` for each row's **era identity**,
  extracted by joining `club_id` / `opponent_club_id → clubs`. **Not** frozen ids: the loader
  re-resolves them through `import_awards.ClubResolver.resolve(name, season)` — the exact
  season-aware path the legacy loader used — so the manifest carries a **rebuild-stable club
  identity**. §20.1 proved all 765 / 763 non-null rows round-trip. The **1 NULL club** and
  **3 NULL opponent** cells are left empty and load back as NULL; validated against a 22-name
  `KNOWN_CLUBS` vocabulary.
- **`player`** — `player_name_raw` verbatim; what `reload_keyed`'s `name_column` guard compares.
- **`player_id`** — carried verbatim for all 766 linked rows (deferred rebuild risk §20.3).
- **`link_status`** — `unique` (679) or `resolved` (87). The parser enforces the migration
  019/053 invariant (linked status ⟺ `player_id` present, both directions) and a completeness
  check that **every** row is linked.
- **`is_winner` / `is_ineligible`** — `true`/`false` (the `hall_of_fame.py` `_bool` house
  style). Parser cross-checks: `ineligible_reason` present ⟺ `is_ineligible`; a row cannot be
  both a winner and ineligible; exactly one winner per decided season 1993–2025 and none for
  2026.
- **`ineligible_reason`** — free text, present on exactly the 9 ineligible rows.
- **`votes`** — always empty; the parser **refuses** a value (a source contract change, not
  something to load through).
- **`stat_line`** — the exact FootyWire statistic object as `jsonb::text` from `afldb_dev`,
  CSV-quoted, carried losslessly. The parser rejects malformed JSON, a non-object, an unknown
  key, or a non-integer value (`bool` explicitly excluded) — **never coerces, never infers**
  for the 3 empty rows. The loader re-emits `json.dumps(obj)` straight into the same `jsonb`
  column, so parity is jsonb-value equality regardless of key order.
- **`source_citation`** — the literal `footywire` for all 766 rows, per the source-granularity
  operator policy (§13); **not** a per-row page citation.
- `.gitignore` whitelisted (`!/data/awards/rising-star.csv`, alongside the three prior slices).
- File sha256: `54bd1145240ec0bd1f92afba65b9a551b2bcf640989b9abfe6bbd3c501e2a9e9`.

### 20.3 Loader — `tools/migration/rising_star.py` + `import_awards.py`

New `tools/migration/rising_star.py`, in the `captaincies.py` / `hall_of_fame.py` mould:
`RisingStarSourceError(ValueError)`, a frozen `RisingStarNomination` dataclass,
`load_rising_star()` that fully validates before constructing any row (no best-effort
coercion), `summary()` / `main()` giving a DB-free `--check` (JSON out, exit 1 on error).
Refuses: malformed header; too many columns; missing required field (`source_key`, `season`,
`round_number`, `player`, `link_status`, `source_citation`); leading/trailing whitespace or a
control character in any text field; `source_key` not `^[0-9a-f]{24}$`; `season` outside
`1993–2026`; `round_number` outside `0–24`; a `club` / `opponent` not in the 22-name
vocabulary; a `link_status` outside the 5-value enum; `link_status` disagreeing with
`player_id` presence (both directions); a `source_citation` other than `footywire`;
`ineligible_reason` present/absent disagreeing with `is_ineligible` (both directions); a
`votes` value; a row that is both `is_winner` and `is_ineligible`; malformed/wrong-shape/
non-integer/unknown-key `stat_line`; duplicate `source_key` (checked **before** the ordering
rule); `source_key` rows out of strictly-ascending order; duplicate natural identity
`(season, player)`; a total row count ≠ 766, season span ≠ 1993–2026, distinct seasons ≠ 34,
winners ≠ 33, a decided season 1993–2025 without exactly one winner, a post-2025 season with a
winner, ineligible ≠ 9, `stat_line` present ≠ 763, any unlinked row, or a `source_citation`
vocabulary ≠ `{footywire}`.

`import_awards.py`: added `from rising_star import RisingStarNomination, load_rising_star`.
`import_rising_star()` **lost its `lite` parameter**; its body now calls `load_rising_star()`
instead of `lite.execute("SELECT … FROM rising_star_nominees")`, mapping the parsed rows onto
the same 16-tuple the loader already built (`round_number` / `is_winner` / `is_ineligible` /
`ineligible_reason` / `votes` straight from the manifest; `stat_line` via `json.dumps(r.stat_line)`
into the same `jsonb` column; `status` still via the existing `link_status()` invariant call
for defence in depth; `player_id` still filtered through the pre-existing `valid_players`
guard). **The `reload_keyed(...)` call — key `["source_id", "source_record_id"]`, the same
16-column value list, `scope_column="award_id"`, `scope_values=[award_id]`,
`scopes=[("source_id", [source_id], False)]` (the AFLDB-ISSUE-080 domain-AND-provenance
scope), `allow_link_loss` — is byte-identical to before.** `"rising_star"` added to
`LEGACY_FREE_GROUPS`; `BATCH_SOURCE_KEYS["rising_star"] = "footywire"` added so its
`import_batch` records against `footywire` rather than the `sports_data_lab` default. The
`main()` dispatch drops the `lite` argument for this group. The now-dead module-level
`STAT_COLUMNS` list (used only by the old `build()`) was removed.

**Orchestration — one deliberate change beyond the input swap.** `GROUP_REQUIRES` lost its
`"rising_star": {"awards"}` entry, so `--groups rising_star` no longer drags in the
legacy-SQLite `awards` group and can run with `AFLDB_LEGACY_SQLITE` unset — exactly as
`under_22` already does. The **reverse** direction is untouched:
`GROUP_REQUIRES["awards"] = {"all_australian", "under_22", "rising_star"}` still closes a full
legacy awards refresh over rising_star, so its manifest is re-applied on every such run. The
loader keeps its own hard guard (`SELECT id FROM awards WHERE slug = 'rising-star'` →
`RuntimeError` "run the 'awards' group first"), so a missing definition still fails loud, not
silent. `GROUPS`, `GROUP_ORDER`, `GROUP_REQUIRES["all_australian"]`, `GROUP_REQUIRES["awards"]`
and the `--dry-run` legacy-table list are otherwise unchanged. No migration, no privilege
change.

**Award-definition dependency.** Rising Star needs the `rising-star` row in `awards` (family A,
a later slice / the §7 canonical-rebuild AWARDS/HONOURS definitions step). In a legacy-loaded
database it is already present; the integration block seeds a minimal stand-in when it is
absent and removes it afterwards (§20.4).

**Carried-forward risk, unchanged in kind from slices 1–3 (§16.3 / §18.3 / §19.3), not a
slice-4 blocker:** the manifest carries the 766 rows' `player_id` verbatim from `afldb_dev`.
`players.id` is not rebuild-stable (ISSUE-111 G5). Proven concretely this pass: against an
`afldb_test` whose `players` table was **staler than `afldb_dev`** (13,277 vs `afldb_dev`'s
larger population), **13 of the 766** `player_id`s — all 2026-debut players numbered above
`afldb_test`'s max id — were absent, and the loader's preserved `valid_players` guard loaded
those 13 nominations `unmatched`/unlinked. No other link was affected. The club identity, by
contrast, **is** already rebuild-stable via `ClubResolver` re-resolution. Recorded against the
deferred §7 AWARDS/HONOURS stage; `source_key` (= `source_record_id`) is the manifest's durable
row identity.

### 20.4 Tests

**DB-free — `tests/rising-star-source.test.ts` (new, 33 cases, all passing):** the full 766-row
manifest parses with the exact G0-measured shape (`row_count 766`, `linked_count 766`,
`unlinked_count 0`, `season_min/max 1993/2026`, `distinct_seasons 34`, `winners 33`,
`ineligible 9`, `stat_line_present 763`, `null_club 1`, `null_opponent 3`,
`link_status {resolved: 87, unique: 679}`); representative rows round-trip verbatim (the
null-club row, a null-opponent + null-stat_line row, an ineligible row with its reason, the
first row in deterministic order); every row's `source_citation` is `footywire`; every
`source_key` is 24 hex chars, unique, strictly ascending; every non-empty `stat_line` is an
integer-valued object keyed within the 12 stat keys, 763 present / 3 empty. One test each for:
malformed header; a non-hex `source_key`; `source_key` out of ascending order; duplicate
`source_key`; duplicate natural identity `(season, player)`; season outside coverage;
`round_number` outside 0–24; unknown club; unknown opponent; invalid `link_status`;
`unique`/`resolved` without `player_id`; a non-linked status carrying `player_id`; a
`source_citation` outside `footywire`; a missing required field (empty `round_number`); a
`player` with edge whitespace; malformed JSON `stat_line`; a `stat_line` that is not an object;
a `stat_line` with an unknown key; a `stat_line` with a non-integer value; an ineligible row
with no reason; an `ineligible_reason` on a non-ineligible row; a `votes` value; a row that is
both winner and ineligible; a total row count short of 766. A second `describe` block reads
`import_awards.py` as text and asserts `rising_star` is in `LEGACY_FREE_GROUPS`,
`BATCH_SOURCE_KEYS["rising_star"] = "footywire"`, that `import_rising_star` no longer threads a
legacy SQLite handle and is dispatched as `import_rising_star(pg, rep, batch, clubs, sources,`,
and that `GROUP_REQUIRES` no longer carries `"rising_star": {"awards"}` while the reverse
`awards` closure stays.

**Integration — `tests/integration/awards-reload-links.test.ts` (new `describe` block, gated
`canRunRisingStarImporter`, legacy-free like the three prior slices):** reloads the full
766-row manifest with `AFLDB_LEGACY_SQLITE` forced unset and asserts the `import_batches` row
(`records_read = 766`, `records_rejected = 0`, target `rising_star`, `status = completed`); the
resulting split (`total 766`, `seasons 34`, `winners 33`, `ineligible 9`, `nullClub 1`,
`nullOpp 3`, `statPresent 763`, `statNull 3`), with `linked` / `unlinked` stated against the
count of manifest `player_id`s the fixture DB can actually resolve (766 / 0 on a matching DB;
precise, not merely "close", on a divergent one) and no winner yet for 2026; re-resolves six
era identities from the canonical club name season-aware (Footscray, Western Bulldogs, Brisbane
Bears, Brisbane Lions, Kangaroos, Fitzroy); preserves the NULL club and NULL opponent + NULL
stat_line rows exactly; round-trips a `stat_line` jsonb object byte-for-byte; three consecutive
reloads produce a byte-identical `(id, source_record_id, season, round_number, club_id,
opponent_club_id, player_id, stat_line)` fingerprint; a `resolved`-status nomination keeps its
`id` and `player_id` across an extra reload; a link is dropped **only** where the `player_id`
cannot be resolved and every such row is `unmatched`, never otherwise; a synthetic
`manual_admin_edit`-sourced nomination row survives untouched **(AFLDB-ISSUE-080 — outside the
domain-AND-provenance reload scope)**; and `hall_of_fame` / `honour_team_members` /
`captaincies` / `award_winners` row counts are unchanged by a `rising_star`-only run.

**`tests/under-22-importer.test.ts`** — the pre-existing `expand_groups` contract test was
updated for the new orchestration: `expandGroups('rising_star')` now expects `['rising_star']`
(was the four-group `shared` closure), `GROUP_REQUIRES` is asserted to carry no `"rising_star":`
key, and the reverse `awards` closure over `rising_star` is still asserted. No other change.

### 20.5 Validation — exact results

1. **DB-free:** `npx vitest run tests/rising-star-source.test.ts` — **33/33 passed**;
   `rising_star.py` against the real manifest prints `ok: true` with the G0 shape
   (`row_count 766`, `distinct_seasons 34`, `winners 33`, `ineligible 9`,
   `stat_line_present 763`, `null_club 1`, `null_opponent 3`,
   `link_status {resolved: 87, unique: 679}`).
   `npx vitest run tests/rising-star-source.test.ts tests/under-22-importer.test.ts
   tests/coleman-derivation.test.ts` — **83/83 passed** (the two orchestration-contract
   suites confirm nothing else regressed).
2. **Typecheck:** `npx tsc --noEmit` — **clean**.
3. **Integration — EXECUTED FOR REAL, GREEN.** Run from `D:\dev\afldb-issue-102` with
   streamanator used only as the PostgreSQL endpoint over a temporary SSH local port-forward
   (`arm@10.0.40.100:5432 → 127.0.0.1:5433`, key `~/.ssh/afldb_dev`), opened and closed within
   the pass. **DSN safety proof (before any test):** `AFLDB_TEST_DATABASE_URL` →
   `current_database() = afldb_test`, `current_user = afldb_owner`;
   `AFLDB_TEST_IMPORT_DATABASE_URL` does not exist anywhere reachable (same finding as Passes
   8/9/10) — derived ephemerally in-process from `AFLDB_IMPORT_DATABASE_URL` by rewriting only
   the host:port to the tunnel and the database name `afldb_dev → afldb_test`, never written to
   disk, proven `current_database() = afldb_test`, `current_user = afldb_import`. No password or
   full DSN printed. Local `psycopg` 3.3.5 present (Pass 8). Results:
   - `npx vitest run tests/integration/awards-reload-links.test.ts -t "rising-star manifest reload"`
     — **9/9 passed, 0 failed** (71 filtered/skipped).
   - Combined ISSUE-112 regression `-t "manifest reload .AFLDB-ISSUE-112."` — **29/29 passed**
     (honour teams 6 + Hall of Fame 6 + captaincies 8 + Rising Star 9), confirming slices 1–3
     are **not regressed**.
   - Whole file `npx vitest run tests/integration/awards-reload-links.test.ts` — **59 passed,
     21 skipped, 0 failed**. The 21 skips are the pre-existing `AFLDB_LEGACY_SQLITE`-gated
     blocks (unchanged by this pass); the 9 new tests are the increment over Pass 10's 50.
4. **`git diff --check`:** clean.

The temporary tunnel was torn down and the two ephemeral DSN scratch files deleted at the end
of the pass; nothing was persisted.

### 20.6 Files changed this pass

`.gitignore` (new whitelist line), `data/awards/rising-star.csv` (new, 767 lines),
`tools/migration/rising_star.py` (new), `tools/migration/import_awards.py` (import,
`import_rising_star` signature/body, dead `STAT_COLUMNS` removed, `LEGACY_FREE_GROUPS`,
`BATCH_SOURCE_KEYS`, `GROUP_REQUIRES` `rising_star` entry removed + comments, `main()` call
site), `tests/rising-star-source.test.ts` (new),
`tests/integration/awards-reload-links.test.ts` (new `describe` block +
`canRunRisingStarImporter` gate + `beforeAll` condition + `RISING_STAR_CSV`),
`tests/under-22-importer.test.ts` (updated `expand_groups` contract for the new orchestration),
`issues/open/AFLDB-ISSUE-112.md` (§13, this §20), `issues/open/AFLDB-ISSUE-102-HANDOFF.md`,
`IssuesIndex.md`. No `CHANGELOG.md` entry — nothing deployed or run against a live application
database; `import_awards.py`'s behaviour for the three still-legacy-dependent groups
(`awards`, `all_australian`) is unchanged. No Git command run. `afldb_dev` read-only for the
§20.1 extraction only. No migration. No production contact. The streamanator checkout was not
modified. ISSUE-111 / ISSUE-113 untouched. `D:\dev\afldb` not accessed.

### 20.7 Exact next action

1. Rising Star family-specific G1–G4 (§10) are satisfied by this pass's evidence — **for the
   Rising Star family only**; this does not close G2/G3 for ISSUE-112 as a whole, which need
   all seven families.
2. **Phase 5 — All-Australian (2,158 rows)** — is the next implementation slice, per the §11.2
   order (All-Australian → club best-and-fairest → named medals). All-Australian is the largest
   slice, targets `award_winners`, merges two legacy tables (`all_australian` +
   `all_australian_history`), and carries the 1984 state/club dual-selection natural-key
   anomaly (§14.4). It also needs the `all-australian` award definition — created by the
   `awards` group today, so the family-A / §7 definitions step becomes the real blocker to
   fully decoupling it.
3. Do **not** resolve ISSUE-112. Do **not** add the canonical-rebuild AWARDS/HONOURS stage yet
   (§7) — record the §20.3 `player_id` rebuild-stability risk (now with concrete evidence: 13
   unlinkable 2026 rows against a staler `afldb_test`) against it when that stage is designed.

---

## 15. Pass 6 — 2026-09-01: implementation slice 1 (HONOUR TEAMS) — BLOCKED, spec handed off

**Scope of the pass:** the first ISSUE-112 implementation slice, honour teams only (§11.2).
No other family. Authorised: READ ONLY bootstrap extraction from `afldb_dev` with the
connection *proven* to be `afldb_dev` first; focused DB-free tests; `npx tsc --noEmit`;
focused `afldb_test`-only integration tests; `git diff --check`. Prohibited: any scrape, any
`afldb_dev` mutation, any production contact, ISSUE-111 / ISSUE-113 edits, `D:\dev\afldb`.

**Outcome: BLOCKED. No manifest built, no loader change, no test added. Fail-closed, as in
Pass 4.** The slice cannot be completed from this worktree because its one input — the
per-row honour-team facts — is not reachable here, and one contract-required manifest column
still has no authorised value.

### 15.1 Blocker 1 — no proven read-only path to the bootstrap source (same as Pass 4 §14.1)

Operator decision §11.1 fixes the bootstrap source as **the legacy-loaded AFLDB PostgreSQL
state** (`afldb_dev.honour_team_members`, 113 rows). Building the manifest needs the *contents*
of those 113 rows (team, verbatim name, position, role, raw club, sort order, link state,
note). The G0 pass measured only *aggregates* (§14.4); the row contents were never extracted
and are **not in the repository**:

| Checked in `D:\dev\afldb-issue-102` @ `78380eb` | Result |
|---|---|
| `.env` in the worktree | absent — only `.env.example` |
| `AFLDB_*` / `PG*` / `DATABASE*` env vars | none set |
| `psql` / `pg_isready` on PATH | not installed |
| listening PostgreSQL / tunnel port (5432/5433/6543/15432/54320) | none |
| legacy SQLite (`*.db` / `*.sqlite` / `team_selections` fixture) anywhere in the tree | none |
| `data/awards/` | only `22-under-22.csv` |
| SSH `dev` / `streamanator` (`10.0.40.100`, in `~/.ssh/config`, host key known) | key auth **refused** — `Permission denied (publickey,password)`; no non-interactive path |

Pass 5 reached `afldb_dev` "via the streamanator development server" as an **operator-run /
operator-assisted** SSH session (§14.6). That path is not available to this session: the SSH
key is not accepted and an interactive password cannot be supplied non-interactively.

**Database safety proof — NOT ESTABLISHED.** No connection was attempted beyond the failed SSH
handshake; `current_database()` / `transaction_read_only` were never observed. Fail-closed as
the pass authorisation requires.

### 15.2 Blocker 2 — `source_citation` has no authorised value (runbook §14.5 item 1)

§4.2 makes `source_citation` a **common, required** manifest column. §14.3 / §14.6 proved
PostgreSQL retains citation only at *source* granularity (`wikipedia`); there is no per-row
`source_url` on `honour_team_members`. The value policy is an **open operator decision** and
this pass "MUST NOT silently weaken or invent" it (pass instruction 8). So even with the row
contents in hand, the honour-teams manifest cannot be finalised until the operator picks one
of §14.5 item 1's options (accept source-granularity `wikipedia`; read `source_url` from the
legacy SQLite file; reconstruct from `docs/acquisition/`). **The missing field is
`source_citation`.**

### 15.3 Carried-forward design risk (not a slice-1 blocker) — rebuild-stable identity carry

`import_honour_teams` today passes the legacy `player_id` straight through — there is **no
resolver** in that group (unlike `under_22`). Only **1 of the 89 linked** rows is in
`player_link_resolutions`; the other 88 links are bare `player_id` values with no ledger.
Carrying `player_id` verbatim in the manifest reproduces the 113-row family exactly **in the
legacy-loaded database** (G1), so it is acceptable for this slice. But `players.id` is **not
rebuild-stable** (ISSUE-111 G5): under `npm run db:test:rebuild` those 88 ids would be wrong.
Settling this needs the §15.5 rebuild-stability probe and, most likely, an operator decision —
adding an `afltables_profile_url` re-resolution step to `import_honour_teams` (the Coleman
pattern) is outside "replace only the input" and must not be done silently. **Record the risk
against the canonical-rebuild integration step (§7), which the runbook already defers until
"once the manifests exist".**

### 15.4 Finalised honour-teams manifest design (ready to populate)

Everything below is derived from `import_awards.py:1721-1785` (`import_honour_teams` +
`reload_keyed` call), migration 005/042/059 schema, and the §14.4 measurements. Nothing here
needs the row contents; only the CSV body does.

**Path:** `data/awards/honour-teams.csv` (CSV, header row, one row per `honour_team_members`
row = 113).

**`.gitignore`:** after `!/data/awards/22-under-22.csv` (line 40) add
`!/data/awards/honour-teams.csv` — same whitelist pattern.

**Header (exact column order):**

```
source_key,team_name,player,position,role,club,sort_order,player_id,link_status,note,source_citation
```

| Column | Provenance / rule |
|---|---|
| `source_key` | **minted once** `honourteam:<team_slug>:<seq>`. `<team_slug>` = `slugify(team_name)` (`import_awards.py:280` rule). `<seq>` = 1-based index of the row **within its team** in the deterministic order below. Unique within the file; never regenerated; a rename of a decided row needs an explicit `--accept-rename`, a removal an explicit `--accept-retirement` (first-kick-goal mould). Not derived from `player_id` or any DB surrogate id. |
| `team_name` | `honour_team_members.team_name` verbatim. Must be one of the 5 measured teams (declared vocabulary — §5 rule 6). |
| `player` | `honour_team_members.player_name_raw` **verbatim** — this is what `reload_keyed`'s name guard compares (`common.py:586`). |
| `position` | `honour_team_members.position`; nullable (empty field = NULL). Vocabulary from §15.5 probe. |
| `role` | `honour_team_members.role`; nullable. Vocabulary from §15.5 probe. |
| `club` | `honour_team_members.club_name_raw`; nullable. The **raw source spelling**, retained verbatim — `import_honour_teams` does *not* resolve it to a `club_id` and there is no such column. |
| `sort_order` | `honour_team_members.sort_order`; integer ≥ 0; `0` is legal (schema default). |
| `player_id` | `honour_team_members.player_id`; nullable integer. 89 linked rows carry it, 24 unlinked are empty. See §15.3 risk. |
| `link_status` | `honour_team_members.link_status_value::text`; one of the enum labels (`unique`,`resolved`,`ambiguous`,`unmatched`,`implausible`). The parser must apply `import_awards.py:link_status()`'s invariant: a row with `player_id` set resolves to `unique`/`resolved`; a row without one never does. |
| `note` | `honour_team_members.note`; nullable. |
| `source_citation` | **BLOCKED — §15.2.** Column is in the header because §4.2 requires it; the value awaits the operator decision. Do not populate with `wikipedia` as if that were the decision. |

**Deterministic ordering (file order and `<seq>` basis):** `ORDER BY team_name, sort_order,
player_name_raw, id`. (`id` only as a final tie-break during extraction; it must not appear in
the file and `<seq>` must not depend on it once minted.)

**Parser module:** `tools/migration/honour_teams.py`, in the `tools/migration/under_22.py`
mould — `HonourTeamsSourceError(ValueError)`, a frozen `HonourTeamMember` dataclass, a
`load_honour_teams(path)` that fully validates or raises with no best-effort coercion, a
`summary()` and a `main()` giving a DB-free `--check` (JSON out, exit 1 on error).

**§5 refusals to implement (one test each, DB-free):** duplicate `source_key`; duplicate
natural identity `(team_name, player)`; duplicate linked identity `(team_name, player_id)`;
null/empty `team_name` or `player`; `team_name` / `position` / `role` / `link_status` outside
its declared vocabulary; `link_status` disagreeing with `player_id` presence; malformed
`source_key` (not `honourteam:<slug>:<int>`, or slug ≠ `slugify(team_name)`); a per-team
row-count / total-count expectation not met (the `EXPECTED_SEASONS` analogue — declare the 5
team sizes and the total 113 once the §15.5 probe gives them); a `player` change on a row that
already carries a `player_link_resolutions` decision surfaced before any write.

**Loader change (when the CSV exists):** in `import_awards.py`, replace only the
`lite.execute("SELECT ... FROM team_selections ...")` block in `import_honour_teams` with
`load_honour_teams()`; keep the advisory-lock take, `_refuse_honour_team_identity_collisions`,
and the `reload_keyed(... ["team_name","player_name_raw"] ...)` call **byte-identical** in key,
column list, scopes and flags. Add `"honour_teams"` to `LEGACY_FREE_GROUPS`
(`import_awards.py:1913`) and give it a `BATCH_SOURCE_KEYS` entry of `"wikipedia"` (matching
its `require_source(sources, "wikipedia")` provenance) so its `import_batch` is no longer
recorded as `sports_data_lab`. `import_honour_teams`'s signature loses `lite`. `GROUPS`,
`GROUP_ORDER`, `GROUP_REQUIRES` unchanged. No migration; no privilege change.

### 15.5 Exact read-only bootstrap extraction (for the operator, or a pass with a proven connection)

Run as one `BEGIN TRANSACTION READ ONLY; … ROLLBACK;` against a database **proven** to be
`afldb_dev`. Every statement is `SELECT`. This is the entire remaining input to slice 1.

```sql
BEGIN TRANSACTION READ ONLY;

-- Step 0 — connection proof. REQUIRE db='afldb_dev' AND txn_read_only='on', else ROLLBACK.
SELECT current_database() AS db,
       current_user       AS role,
       current_setting('transaction_read_only') AS txn_read_only;

-- (1) Manifest body — 113 rows, in the manifest's deterministic order.
SELECT m.id                      AS db_surrogate_id,   -- extraction tie-break only; NOT in the file
       m.team_name,
       m.player_name_raw         AS player,
       m.position,
       m.role,
       m.club_name_raw           AS club,
       m.sort_order,
       m.player_id,
       m.link_status_value::text AS link_status,
       m.note,
       s.key                     AS source            -- expect 'wikipedia' on every row
  FROM honour_team_members m
  LEFT JOIN sources s ON s.id = m.source_id
 ORDER BY m.team_name, m.sort_order, m.player_name_raw, m.id;

-- (2) Provenance sanity — expect exactly one group: ('wikipedia', 113).
SELECT s.key, count(*) AS n
  FROM honour_team_members m LEFT JOIN sources s ON s.id = m.source_id
 GROUP BY s.key ORDER BY s.key;

-- (3) The single linked player_link_resolutions decision — expect exactly 1 row.
SELECT r.id, r.target_id, r.action, r.player_id AS decided_player_id, r.created_at,
       m.team_name, m.player_name_raw, m.player_id AS current_row_player_id
  FROM player_link_resolutions r
  JOIN honour_team_members m ON m.id = r.target_id
 WHERE r.target_table = 'honour_team_members'
 ORDER BY r.target_id, r.created_at DESC;

-- (4) Natural-key re-proof for the manifest — expect 0 rows from each.
SELECT team_name, player_name_raw, count(*) FROM honour_team_members
 GROUP BY 1,2 HAVING count(*) > 1;
SELECT team_name, player_id, count(*) FROM honour_team_members
 WHERE player_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;

-- (5) Field completeness + per-team sizes — sets the parser's nullability and count gates.
SELECT count(*) AS rows,
       count(*) FILTER (WHERE position      IS NOT NULL) AS position_present,
       count(*) FILTER (WHERE role          IS NOT NULL) AS role_present,
       count(*) FILTER (WHERE club_name_raw IS NOT NULL) AS club_present,
       count(*) FILTER (WHERE note          IS NOT NULL) AS note_present,
       count(*) FILTER (WHERE sort_order <> 0)           AS sort_order_nonzero,
       count(*) FILTER (WHERE player_id IS NOT NULL)     AS linked,
       count(*) FILTER (WHERE player_id IS NULL)         AS unlinked
  FROM honour_team_members;
SELECT team_name, count(*) AS n, min(sort_order) AS min_so, max(sort_order) AS max_so
  FROM honour_team_members GROUP BY team_name ORDER BY team_name;

-- (6) Value vocabularies — the strict validator's declared domains.
SELECT DISTINCT position               FROM honour_team_members ORDER BY 1;
SELECT DISTINCT role                   FROM honour_team_members ORDER BY 1;
SELECT DISTINCT team_name              FROM honour_team_members ORDER BY 1;
SELECT DISTINCT link_status_value::text FROM honour_team_members ORDER BY 1;

-- (7) §15.3 rebuild-stability probe for the 89 linked identities (carried-forward risk).
SELECT count(*)                                         AS linked_members,
       count(*) FILTER (WHERE ei.n = 1)                 AS exactly_one_profile_url,
       count(*) FILTER (WHERE coalesce(ei.n, 0) = 0)    AS no_profile_url,
       count(*) FILTER (WHERE ei.n > 1)                 AS multi_profile_url
  FROM honour_team_members m
  LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM external_identities e
       WHERE e.player_id = m.player_id
         AND e.match_method = 'afltables_profile_url'
         AND e.status = 'unique'
  ) ei ON TRUE
 WHERE m.player_id IS NOT NULL;

ROLLBACK;
```

### 15.6 Exact next action

1. **Operator** supplies a proven read-only `afldb_dev` connection (worktree `.env` + tunnel,
   or an assisted SSH session as in Pass 5) **or** runs §15.5 and returns the output; **and**
   settles the `source_citation` value policy (§14.5 item 1) for the honour-teams slice.
2. A pass then: writes `data/awards/honour-teams.csv` from §15.5 output in the §15.4 schema
   and deterministic order; mints the `honourteam:<slug>:<seq>` ids once; adds the
   `.gitignore` whitelist line; writes `tools/migration/honour_teams.py` (under_22 mould) with
   `--check`; rewires only the `import_honour_teams` input per §15.4; adds
   `"honour_teams"` to `LEGACY_FREE_GROUPS` and a `"wikipedia"` `BATCH_SOURCE_KEYS` entry;
   adds `tests/honour-teams-source.test.ts` (DB-free, the §15.4 refusal list) and extends
   `tests/integration/awards-reload-links.test.ts` for the honour-teams slice only
   (113-row parity, idempotent reload, the 1 decision survives, 24 unlinked stay unlinked,
   `manual_admin_edit` untouched, no other family changed, `canRunImporter` no longer needs
   `AFLDB_LEGACY_SQLITE` for this group).
3. Validation order: DB-free tests → `npx tsc --noEmit` → focused `awards-reload-links`
   integration on `afldb_test` under the restricted import role → `git diff --check`.
4. Do **not** resolve ISSUE-112. Do not touch ISSUE-111 / ISSUE-113. Do not add the
   canonical-rebuild AWARDS/HONOURS stage yet (§7 — deferred until multiple manifests exist);
   record the §15.3 rebuild-stable-identity risk against that step.

**Files changed this pass:** `issues/open/AFLDB-ISSUE-112.md`,
`issues/open/AFLDB-ISSUE-102-HANDOFF.md`, `IssuesIndex.md` (ISSUE-112 next-action text only).
No `CHANGELOG.md` change. No Git command run. No manifest, no loader change, no test, no
`import_awards.py` run, no migration, no `afldb_dev` connection, no scrape, no production
contact. ISSUE-111 / ISSUE-113 untouched. `D:\dev\afldb` not accessed.
