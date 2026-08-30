# AFLDB-ISSUE-102 — Awards/honours legacy-SQLite acquisition dependency (PARENT)

**Document type:** parent architecture / dependency-coordination record.
**Status: Open. Not resolved. No implementation has been authorised or started.**

**Scope revised 2026-08-30 by operator decision.** The former "record only — do not design the
replacement" boundary is deliberately superseded (§2.1). ISSUE-102 is now the parent
architecture, dependency-inventory, child-coordination and acceptance record for the awards and
honours acquisition domain. **It does not implement replacement loaders itself** — implementation
belongs to `AFLDB-ISSUE-111`, `-112` and `-113`.

Pass history:
- **Pass 1 (2026-08-30)** — architecture/scope adjudication. Recommended Option B.
- **Pass 2 (2026-08-30)** — operator adopted Option B, revised this issue to parent scope,
  approved the curated-manifest and Coleman-derivation directions, and authorised child issues
  111/112/113. This document is the pass-2 output. Continuation state:
  `issues/open/AFLDB-ISSUE-102-HANDOFF.md`.

---

## 1. Revised scope

### 1.1 In scope for ISSUE-102

| Responsibility | Detail |
|---|---|
| Architecture | The end-state shape of legacy-free awards/honours acquisition |
| Dependency inventory | Every `AFLDB_LEGACY_SQLITE` consumer in the awards/honours domain, kept current |
| Child coordination | `AFLDB-ISSUE-111`, `-112`, `-113`; their boundaries and ordering |
| Acceptance criteria | The closure gates in §8 |
| Final verification | That `tools/migration/import_awards.py` no longer **operationally** requires `AFLDB_LEGACY_SQLITE` |

### 1.2 Explicitly NOT in scope

- Writing any loader, parser, manifest or migration. That is the children's work.
- Acquiring, scraping or fetching any external historical data.
- Selecting an external source for the Brownlow season-total gap (ISSUE-113's open question).
- Any change to `import_legacy_afl.py` beyond documenting its Brownlow dependency.
- Creating a broader `import_legacy_afl.py` parent issue. Deliberately deferred (§9.7).
- Broadening `afldb_import` privileges. None is needed (§6).
- Editing any applied migration.

---

## 2. Operator decisions — authoritative, 2026-08-30

These are decisions of record. A later pass must follow them, not re-litigate them.

1. **ISSUE-102 becomes the parent architecture/coordination record.** The old record-only
   boundary is revised. ISSUE-102 does not implement loaders. Do not mark it Resolved.
2. **Curated manifests are the approved architecture for the seven external honours families.**
   Runtime scraping, brittle HTML parsing, paid APIs and undocumented endpoints are **not**
   authorised and require a separate operator decision. Manifests must carry stable source
   identity, provenance, deterministic validation, reviewability, idempotent reload,
   `reload_keyed` compatibility, manual-link preservation, `confirmed_unlinked` preservation and
   admin-owned-row protection.
3. **Coleman is derived from canonical AFLDB facts**, and the derived rows are **persisted** to
   `award_winners` — not exposed as a transient view — because `award_winners` participates in
   durable linking and reload infrastructure.
4. **Coleman ties: every player tied on the qualifying total gets a winner row.** No arbitrary
   tie-breaker. Stable identity must stay deterministic for tied rows.
5. **Coleman season span must preserve real award semantics.** Do not retroactively label every
   leading goalkicker since 1897 a Coleman Medal winner. The first award season must be
   established from evidence (§4.4), not assumed.
6. **Issue numbering: `AFLDB-ISSUE-110` is taken** by active NL semantic-mapping work that is
   **not merged into this worktree**. Do not use it, do not modify it, do not invent its ledger
   content. Children are `111`, `112`, `113`.
7. **Brownlow season totals stay separate** as `AFLDB-ISSUE-113`. Do not conflate with
   `import_awards.py`. Do not choose an external source without evidence.
8. **Canonical rebuild is an acceptance requirement.** ISSUE-111 and ISSUE-112 must make
   `npm run db:test:rebuild` restore their covered data with no `AFLDB_LEGACY_SQLITE`. The
   end-state must not silently leave required tables empty, **and the legacy SQLite source must
   not be bolted back into `rebuild-test.ts`**.

---

## 3. The legacy dependency — verified inventory

### 3.1 The call site

`tools/migration/import_awards.py:1407-1416` (verified in source, pass 1 and re-verified pass 2):

```python
needs_legacy = any(key != "under_22" for key in selected)
legacy_path = require_env("AFLDB_LEGACY_SQLITE") if needs_legacy else None
...
lite = connect_legacy(legacy_path) if legacy_path else None
```

`connect_legacy()` — `tools/migration/common.py:71-77` — opens SQLite read-only
(`file:{path}?mode=ro`). Nothing is ever written to the legacy database.

**The dependency is per-group, not per-file.** Six of the seven `GROUPS`
(`import_awards.py:1320-1328`) need it; `under_22` does not.

### 3.2 Repository-wide consumers (verified paths)

| File | Line | Class | In ISSUE-102's boundary? |
|---|---|---|---|
| `tools/migration/common.py` | `:73` | shared read-only opener | shared — not removed by this work |
| `tools/migration/import_awards.py` | `:1408` | **the subject of this issue** | **yes** — ISSUE-111 + ISSUE-112 |
| `tools/migration/import_legacy_afl.py` | `:1021` | core reload incl. `import_brownlow` (`:684`) | **no** — ISSUE-113 documents only the Brownlow slice |
| `tools/migration/enrich_birth_dates.py` | `:406` | DOB register pass | no — ISSUE-090 §27.4 retired its acceptance |
| `tools/validation/validate_migration.py` | `:340` | legacy↔PostgreSQL parity validator | no — ISSUE-108 follow-up |
| `.env.example` | `:198` | env declaration | no |
| `tools/maintenance/00_install_postgres.sh` / `00_install_postgres_prod.sh` | `:158` / `:262` | provisioning var/comment | no |
| `tests/integration/awards-reload-links.test.ts` | `:59`, `:76-79` | **test guard** — skips the suite when absent | **yes** — must become legacy-independent |
| `tests/draftguru-import.test.ts`, `tests/reference-data.test.ts`, `tests/db-test-rebuild.test.ts`, `tests/fitzroy-core-import.test.ts` | various | **negative** contract tests asserting the new paths never use it | keep as-is |

`tools/migration/import_draft.py` is a tombstone: it names the variable only to say it is unused
(`:13`, `:32`, `:73`).

### 3.3 Classification

**`LEGACY_SOURCE_DEPENDENCY` — repeatable reload — still operationally required.**

`docs/deployment.md` §7 ("Data refresh", verified at `:240-250`) lists
`python tools/migration/import_awards.py` in the standing, idempotent refresh sequence for
`afldb_dev`/production. It is not one-time, not developer-only, not dead.

Architecturally the legacy file is a **cached aggregation**, not a primary source.
`issues.md:6772-6776` states it verbatim: *"`AFLDB_LEGACY_SQLITE` is itself an aggregation of
upstream sources (fitzRoy/AFL Tables, DraftGuru, Wikipedia, FootyWire), not a primary source —
AFLDB simply has no rebuild path that acquires from those upstream sources directly."*
`data/reference/sources.json` agrees: `draftguru`, `wikipedia` and `footywire` are registered
sources; `sports_data_lab` is registered `kind: "derived"`.

---

## 4. Acquisition matrix

Groups from `GROUPS` (`import_awards.py:1320-1328`); keys, scopes and provenance read from each
loader's `reload_keyed(...)` call.

| # | Family | Group | Legacy table(s) | Target table(s) | Reload key | Provenance | Legacy needed? | Owner |
|---|---|---|---|---|---|---|---|---|
| A | Award definitions | `awards` | `awards` | `awards` | `slug` | reference row | yes | **111** (Coleman defn) + **112** (rest) |
| B | Coleman | `awards` | `awards` | `award_winners` | `(source_id, source_record_id)` | `draftguru` | yes | **111** |
| C | Brownlow medal row | `awards` | `awards` | `award_winners` | as B | `draftguru` | yes | **112**, blocked on **113** (§4.5) |
| D | Norm Smith, AFLPA MVP, state-league medals (Magarey/Sandover/Liston/Morrish), junior awards (Larke/Hunter Harrison), `draft_pick` honours | `awards` | `awards` | `award_winners` | as B | `draftguru` | yes | **112** |
| E | Club best-and-fairest (18) | `awards` | `awards` | `awards` (`bf-*`) + `award_winners` | slug / as B | `draftguru` | yes | **112** |
| F | All-Australian | `all_australian` | `all_australian`, `all_australian_history` | `award_winners` | as B | `draftguru` + `wikipedia` | yes | **112** |
| G | AFLPA 22 Under 22 | `under_22` | **none** | `awards` + `award_winners` | `(source_id, source_record_id)`, `22under22:YYYY:pos:slot` | `wikipedia_22under22` | **NO** | already solved — the precedent |
| H | Rising Star nominations | `rising_star` | `rising_star_nominees` | `award_nominations` | as B | `footywire` | yes | **112** |
| I | Hall of Fame | `hall_of_fame` | `hall_of_fame` | `hall_of_fame` | `(name, inducted_year)` + `refuse_out_of_scope_key=True` | `wikipedia` | yes | **112** |
| J | Honour teams | `honour_teams` | `team_selections` | `honour_team_members` | `(team_name, player_name_raw)` | `wikipedia` | yes | **112** |
| K | Captaincies | `captaincies` | `captaincies` | `captaincies` | as B | `wikipedia` | yes | **112** |
| L | Person-link bridge | shared | `person_links`, `dg_people` | in-memory only | `dg_person_id` | — | yes | **112** (replace with the DraftGuru ledger) |

Already solved elsewhere and **not** to be reopened: Brownlow **round** votes
(`import_fitzroy_core.py:2515`), draft (`tools/rebuild/draftguru/import_draftguru.py`),
`player_achievements` (`tools/records/import-first-kick-goal.ts`).

Legacy row counts for scale (`docs/data-dictionary.md` §3): `awards` 1,810 rows / 38 distinct
award types ("most series begin 1980"); `all_australian` 906 + `all_australian_history` 1,252;
`hall_of_fame` 343 (34 Legends, 241 linked); `captaincies` 1,375 (all linked);
`rising_star_nominees` 766; `team_selections` 113. `docs/search.md:220` records 40 award
definitions in the loaded database.

### 4.5 Brownlow — the precise correction

Do **not** say "Brownlow is legacy-free". Only the **round** grain is.

- `brownlow_round_votes` — canonical, legacy-free, Stage-9 gated. ✔
- `brownlow_season_votes` — **no legacy-free writer.** Sole writer `import_legacy_afl.py:684`
  (`import_brownlow`, which `truncate()`s both tables first).

`rebuild_derived.py:23-26` treats it as **AUTHORITATIVE**: *"Brownlow summed from
`brownlow_season_votes` (AUTHORITATIVE). Never summed from `player_match_stats.brownlow_votes`."*

Not reconstructible from round votes. `data/reference/stat-availability.json`:
`brownlow_season_total` is `complete 1924-1941` and `complete 1946-2025`;
`brownlow_round_votes` is `complete` only `1984-2025`, `not_collected 1924-1941` and
`1946-1983`. Roughly 56 of ~102 decided seasons have no round-grain votes at all. `vote_rank`,
`eligible_rank`, `is_ineligible` and `is_winner` are additionally not computable from vote sums.

Owner: **`AFLDB-ISSUE-113`**. Outside `import_awards.py` and outside ISSUE-102's closure boundary
(§8.3).

---

## 5. The canonical rebuild gap

`tools/db/rebuild-test.ts` stages: PRECHECK, RESET, MIGRATIONS, PRIVILEGES, REFERENCE, FITZROY,
DRAFTGURU, DERIVED, LADDER-WITNESS, FINAL VALIDATION. **There is no awards stage** — searching
that file for `award|honour|captainc|hall_of_fame` returns one unrelated comment.

Therefore a canonically rebuilt `afldb_test` holds **zero rows** in `awards`, `award_winners`,
`award_nominations`, `hall_of_fame`, `honour_team_members` and `captaincies`, and no Stage-9 gate
detects it. Same shape as the `club_seasons = 0` finding that became `AFLDB-ISSUE-095`.

Degradation while empty: `/awards`, `/awards/[slug]`, `/hall-of-fame`, the honour-team and
captaincy panels on `/players/[slug]`, the "Awards & honours" Grid Solver axis group
(`src/search/grid-solver-spec.ts:308-312` and neighbours), award and honour-team `sitemap.ts`
entries (`:112-117`), and every award-shaped NL answer.

**Acceptance rule (operator decision 8).** ISSUE-111 and ISSUE-112 each add their own rebuild
stage and Stage-9 gate. The gate **must not** be added before its data source exists, or every
canonical rebuild would fail on a known gap — the rule ISSUE-093 §H15.5 set for `club_seasons`.
Legacy SQLite must never be reintroduced into `rebuild-test.ts`.

---

## 6. Integrity contracts every child must preserve

`tools/migration/common.py:410-703` `reload_keyed()` is the contract. Verified behaviour:

| Guarantee | Mechanism |
|---|---|
| Surrogate ids survive a reload | matched rows are UPDATEd in place (`:662-670`); no TRUNCATE, no `RESTART IDENTITY` |
| Manual links survive | latest decision per target read from `player_link_resolutions` (`DISTINCT ON (target_id) … created_at DESC`, `:546-554`), classified **before** any write, re-applied after (`:648-658`) |
| `confirmed_unlinked` survives | same path; forces `player_id NULL` and keeps the stored status |
| Loss is fail-closed | a decision that cannot be carried raises `LinkDecisionLoss` and **nothing is written** unless `--allow-link-loss` (`:610-617`) |
| Source-name change cannot re-attribute a link | `name_column` guard (`:586-592`) |
| Admin/foreign rows are untouchable | ownership is domain **AND** provenance — every loader adds `scopes=[("source_id",[...],False)]` (ISSUE-080) |
| Foreign row holding an incoming key | `ReloadOwnershipCollision` before any write (`:506-540`); `captaincies` gets the same via `_refuse_captaincy_natural_key_collisions()` |
| Duplicate incoming keys | hard `RuntimeError`, nothing written (`:488-504`) |
| Cross-writer race | frozen advisory lock `(717275, 1)`, byte-identical in `import_awards.py:257-258` and `awards-admin.ts` |
| Unlinked rows are still rows | `player_id NULL` + `player_name_raw` retained (`import_awards.py:25-30`) |
| Provenance | `source_id` + `source_record_id` + `import_batch_id`; `require_source()` fails closed (`:261-275`) |

**Privileges: no change is required and none is authorised.** The six awards tables predate
migration 045 and are in the seeded `afldb_meta.import_writable_tables` registry.
`player_link_resolutions` is SELECT+INSERT only (migrations 066/068); `player_link_suggestions`
is SELECT only (migration 070). A *new* staging table — if a child ever needs one — would require
`afldb_meta.grant_import_write()` and, for app reads, `grant_app_read()`.

**Five of the seven `LINK_TARGET_TABLES` are awards tables** (`src/db/queries/player-links.ts:37-45`,
CHECK-constrained in migration 056): `award_winners`, `award_nominations`, `hall_of_fame`,
`honour_team_members`, `captaincies`, plus `player_achievements` and `draft_picks`.

---

## 7. Test contract

| Suite | Protects | Runs on the canonical baseline today? |
|---|---|---|
| `tests/integration/awards-reload-links.test.ts:205-1247` | the entire link-preservation, ownership-refusal, idempotency and advisory-lock matrix | **NO** — `describe.skipIf(!canRunImporter)`, and `canRunImporter` requires `AFLDB_LEGACY_SQLITE` set **and** present (`:76-79`) |
| same file `:158-204` | `under_22` parity under the restricted `afldb_import` role | yes, when `AFLDB_TEST_IMPORT_DATABASE_URL` is set |
| same file `:1248-1403` | captaincy ownership scoping (ISSUE-085) | **yes** — it builds its **own temporary SQLite fixture** (`buildCaptaincyFixtureDb`) |
| `tests/under-22-importer.test.ts`, `tests/under-22-source.test.ts` | manifest parse/contract, DB-free | yes |
| `tests/awards-admin.test.ts` | admin create paths, `manual_admin_edit` provenance, lock constants | yes |
| `tests/integration/first-kick-goal-reload-links.test.ts` | the same contract for `player_achievements` | yes |
| `tests/integration/privileges.test.ts` | `afldb_import` least privilege | yes |

Two consequences: the most valuable awards regression suite is **currently unexecutable**, and a
precedent for driving the real importer from a synthetic SQLite fixture already exists in the
same file. Making that matrix legacy-independent is an ISSUE-112 acceptance gate.

---

## 8. Closure criteria

### 8.1 ISSUE-102 must NOT close until every one of these holds

1. **`AFLDB-ISSUE-111` is Resolved** — Coleman derived, persisted, rebuilt and validated.
2. **`AFLDB-ISSUE-112` is Resolved** — all seven curated honours families acquired from tracked
   manifests.
3. **`tools/migration/import_awards.py` no longer operationally requires `AFLDB_LEGACY_SQLITE`** —
   proved by source (`require_env("AFLDB_LEGACY_SQLITE")` gone or unreachable on every supported
   path) **and** by a real full run with the variable unset.
4. **Canonical rebuild restores every award/honour dataset owned by 111 and 112** —
   `npm run db:test:rebuild` produces non-zero, gated counts for `awards`, `award_winners`,
   `award_nominations`, `hall_of_fame`, `honour_team_members` and `captaincies`, with Stage-9
   gates that fail the run on drift. No legacy SQLite anywhere in the plan (the existing
   `tests/db-test-rebuild.test.ts:716` assertion must still pass).
5. **Reload/link-preservation validation runs without `AFLDB_LEGACY_SQLITE`** —
   `tests/integration/awards-reload-links.test.ts` executes its full matrix (no
   `canRunImporter` legacy gate) and passes.
6. **`docs/deployment.md` §7 no longer requires legacy SQLite for `import_awards.py`**, and the
   refresh sequence is updated and accurate.
7. **Source/provenance contracts are documented** — every family's source key, stable record id,
   manifest location and validation rule recorded in the repository.
8. **No manual player-link resolution regression** — a before/after audit shows every
   `player_link_resolutions` decision on the five awards link-target tables still resolves to a
   live row, with the same person, and `confirmed_unlinked` decisions still read as unlinked.

### 8.2 Explicitly NOT closure conditions

- Production rollout. Separate work, separate review.
- Removal of `AFLDB_LEGACY_SQLITE` from `import_legacy_afl.py`, `enrich_birth_dates.py` or
  `validate_migration.py`.
- Retiring `connect_legacy()` from `common.py`.

### 8.3 ISSUE-113 may remain open after ISSUE-102 closes

`brownlow_season_votes` is written by `import_legacy_afl.py`, not `import_awards.py`. It is
**outside** ISSUE-102's closure boundary. ISSUE-102 may be Resolved with ISSUE-113 still Open,
provided §8.1.3 and §8.1.4 hold for the awards domain proper. This must be stated explicitly in
the resolution so the residual legacy dependency is never mistaken for an oversight.

---

## 9. Unresolved / deferred

1. **The Coleman first-award season is not provable from repository source alone.** See §4.4 of
   `issues/open/AFLDB-ISSUE-111.md` — it is a **measured** value, and ISSUE-111 carries the exact
   read-only SQL that must be run before implementation.
2. **The Brownlow season-total replacement source is undecided.** ISSUE-113 records the classes;
   no selection is authorised without evidence.
3. **No broader `import_legacy_afl.py` parent issue.** Deferred by operator decision 7. If later
   evidence proves coordinated replacement is needed, record it then — not speculatively now.
4. **`AFLDB-ISSUE-110` is not present in this worktree.** Its NL semantic-mapping work is
   unmerged at baseline `95819a3`. Ledger entries here reserve the id and say only that; nothing
   about its content is asserted. Merge-sensitive — see the handoff.

---

## 10. What pass 2 did NOT do

No loader, parser, manifest, migration, privilege change or schema change. No source acquired,
scraped, fetched or selected beyond the approved directions. No database read or written. No
test run. No Git command. No production or `afldb_dev` action. No issue resolved. No existing
test changed or skipped. ISSUE-110 untouched. `D:\dev\afldb` never accessed.
