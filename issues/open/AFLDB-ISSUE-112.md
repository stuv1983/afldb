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
2. **Phasing.** Seven families in one change is large. Recommended order, smallest and most
   isolated first: honour teams (113 rows) → Hall of Fame (343) → captaincies (1,375, already
   has its own ISSUE-085 ownership scoping and a fixture precedent) → Rising Star (766) →
   All-Australian (2,158) → club B&F → named medals. Each is independently shippable behind its
   own group.
3. **`person_links` replacement.** The DraftGuru ledger is tracked
   (`data/reference/draftguru-link-decisions.json`); confirm it covers the identities the awards
   families need before removing `load_person_links()`.
4. **Natural-keyed families.** Confirm that leaving `hall_of_fame` and `honour_team_members` on
   name-based reload keys is acceptable, or raise the key change as its own adjudication (§4.2).

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

Design recorded 2026-08-30. **Not implemented. No manifest built, no code written, no data
acquired.** Blocked on the G0 per-family measurement and on operator prerequisite 1 (the source
of the one-time extraction).
