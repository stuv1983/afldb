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

Design recorded 2026-08-30. **Not implemented. No manifest built, no code written, no data
acquired.**

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
- **Still open before a merge:** the `source_citation` granularity choice (§14.5 item 1) — the
  one systemic gap, operator decision, no scrape proposed.
- **Implementation phasing (§11.2) may now begin — honour teams first.**

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
