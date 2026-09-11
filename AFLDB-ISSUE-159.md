# AFLDB-ISSUE-159 — Coach administration (AFLDB-ISSUE-156 P3)

**Status:** **Stage 1 COMPLETE and VALIDATED — G0 through G8 all PASSED (2026-09-11).**
The issue is NOT Resolved: Stage 2 (the `/admin/coaches` surface) is **UNBLOCKED but NOT
STARTED**, and `AFLDB-ISSUE-159` closes only when Stage 2 ships. Stage 1 was written,
committed `dbef4c2`, deployed to DEV, and validated: G1 (254 passed); G2 (§5.3 pre-check
with `total` corrected 383 -> 386, then migration 095 on `afldb_test`); G3 A–E after
catching and fixing a composite-key decode defect (§6.1); **G4 on real `afldb_dev` as legs
A+B+C under operator decision D-5 (§17.1)**; G5 12/12; G6 97/97; G7 13/13; G8 typecheck
clean. **G4-D remains OPEN** as a non-blocking dated obligation: when the 2026 Brownlow
votes publish, the next real DEV settle must show `brownlow_round_votes` traversing the
canonical apply path. Not merged to `main`. Deliverables and prohibitions are §16; gates and their recorded results are
§17; the per-file record of what was written is the Stage 1 implementation table in the
`issues.md` entry.
**Severity:** Medium
**Area:** Admin / Data management / Acquisition / Promotion lineage
**Created:** 2026-09-11
**Parent:** `AFLDB-ISSUE-156` (umbrella) P3 · lineage `AFLDB-ISSUE-155` Phase D (§23, §9)
**Branch:** `opus/issue-159-coach-admin` · worktree `D:\dev\afldb-issue-159`

This document is a planning deliverable. No application code, migration, privilege, test or
deployment change was made while producing it. Every repository fact below was read on this
branch on 2026-09-11 and is cited by file and line.

---

## 0. Preflight verification

### 0.1 Verified natively on this branch

| Check | Result |
|---|---|
| `AFLDB-ISSUE-159` in any `*.md` (`issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `AFLDB-ISSUE-156.md`) | **absent** — no match anywhere |
| Highest issue heading in `issues.md` | `AFLDB-ISSUE-158` (`issues.md:22030`); 159 is the next free ID |
| Highest migration **on this branch** | `094_brownlow_admin_workflow.sql` → next free **095** |
| `coaches` / `match_coaches` schema | `src/db/migrations/087_coaches.sql:34-115` |
| `data_overrides.entity_type` CHECK | `073_data_overrides.sql:13` — still only `('players','matches','draft_picks')`, never widened |
| `data_edits.table_name` CHECK | `094_brownlow_admin_workflow.sql:300-311` — 8 literals |
| Coach import ownership | `tools/migration/import_match_coaches.py:388-446`; acquisition `tools/rebuild/afltables/acquire_coaches.py`; contract `tools/rebuild/afltables/afltables-contract.json:73-178` |
| Promotion-inventory classification of `coaches` / `match_coaches` | **already classified as rebuilt data** — `087:114-115` registers both in `afldb_meta.import_writable_tables`; `promotion-inventory.ts:1777-1796` classifies a registry table as complete. Neither name appears in `PROMOTION_CONTRACT`, which is correct: `{kind:'both'}` is a refusal |
| `privileges.sql` mentions of `coaches` / `match_coaches` | **none** — both are registry-driven (`087:112-115`), so the subtractive `afldb_auth` list at `privileges.sql:435-470` is not involved |
| `manual_admin_edit` source row | **already exists** — `057_data_edits.sql:36-42`, `kind = 'manual'`. No new `sources` row is needed |

### 0.2 Operator-executed — COMPLETE 2026-09-11

The operator ran the outstanding checks. All passed; the ID and the migration number are clear.

| Check | Result |
|---|---|
| `npm run preflight -- --mode planning --issue 159` | **READY** — 0 blockers, 4 warnings (`.env` / `psql` / `pg_restore`, all non-blocking for planning) |
| Worktree / branch | correct repository and worktree; `opus/issue-159-coach-admin` valid, linked worktree, contains current local `main`, ahead 0 / behind 0 of recorded `origin/main` |
| `git branch -a --contains main` | `main`, `opus/issue-159-coach-admin`, `origin/main` |
| Migration collision check (all branches) | collision-free; **highest is still `094_brownlow_admin_workflow.sql`, so 095 is free** |
| GitHub commit search for `159` | no matches |
| GitHub branch search for `issue-159` | no branch |
| Working-tree changes | exactly one changed/untracked path, the planning artefact `AFLDB-ISSUE-159.md` |

**Migration 095 is therefore allocated to this issue.** S-8 remains standing only as an
implementation-time re-check (`npm run preflight -- --mode implementation --issue 159`), because
ISSUE-151/152/155 branches could still take it before Stage 1 commits.

---

## 1. C-1 decision — **APPROVED 2026-09-11**

> **Approved as written.** Synthetic `manual:<token>` identity; source `manual_admin_edit`;
> namespaced manual `name_key`; no nullable-AFL-Tables-identity design; duplicate prevention
> required; **no merge/reconciliation implementation in P3**; a manual coach later acquiring an
> AFL Tables identity is a separate P9-class follow-up (§13).

> **C-1 (ISSUE-156 §10):** `coaches.afltables_coach_path` is `NOT NULL UNIQUE` (087:38) and
> `coaches.source_id` is `NOT NULL` (087:58). A manually created coach has no AFL Tables path.

**Decision: Approach B — mint a synthetic manual identifier under the existing
`manual_admin_edit` source row, and make the durable record a `data_overrides` row rather than
the `coaches` row itself.**

No column is relaxed. `afltables_coach_path` and `source_id` both stay `NOT NULL`, and
`afltables_coach_path` stays `UNIQUE`.

### 1.1 The shape

A manually created coach is one `coaches` row:

| column | value |
|---|---|
| `afltables_coach_path` | `'manual:' \|\| <token>` |
| `name_key` | `'manual:' \|\| <token>` |
| `display_name`, `given_name`, `surname`, `dob` | as typed by the Super Admin |
| `source_id` | `sources.id WHERE key = 'manual_admin_edit'` (057) |
| `source_record_id` | `<token>` |
| `import_batch_id` | `NULL` (nullable, 087:60) |
| `source_games_coached` | `NULL` — it is source evidence and a manual coach has no source |
| `player_id` / `link_status_value` / `afltables_profile_path` | per §4.3 |

`<token>` is an opaque, permanent identifier minted once by the create action (UUID or ULID).
It is never derived from a name — `promotion-inventory.ts:78-82` forbids name-derived identity
in exactly these words, and the rule is binding here.

The durable record of that row is **not** the row. It is a `data_overrides` row:

```
entity_type     = 'coaches'
entity_key      = 'manual_admin_edit:' || <token>
field_group     = 'identity'
override_values = { display_name, given_name, surname, dob, notes,
                    player_id_identity, afltables_profile_path }
is_active       = true
```

The `<source key>:<external id>` key shape mirrors the `players` convention that
`replay_admin_overrides` already parses with `split_part(entity_key, ':', 1)` /
`substring(... from position(':' in ...) + 1)` (`tools/migration/common.py:909-911`). A
source-owned coach uses the same shape: `entity_key = 'afltables:coaches/Chris_Fagan0.html'`.

### 1.2 Why the identity has to be synthetic and not absent

This is the decisive argument, and it is not the `NOT NULL` itself.

`data_edits.row_id` is **lineage-bound**. `promotion-inventory.ts:322-337` declares
`data_edits.row_id` with `kindColumn: 'table_name'`, and `:359-363` records why: *"table_name +
row_id is a row id in players or matches, NOT a foreign key: it reinstates without tripping a
constraint, and therefore without noticing a lineage change. AFLDB-ISSUE-142 (B): remapped
through a stable identity, never by id."*

Admitting `'coaches'` into `data_edits.table_name` therefore obliges P3 to add a lineage target
for it, which obliges every coach to have a **stable text identity that exists on both
databases**. Under Approach A a manually created coach has no such identity at all: the only
remaining text column would be `name_key`, which is a name, which the same file forbids. Its
`data_edits` rows would be unremappable, and per the declared remediation (`:331-332`) *"the
promotion stops."*

`afltables_coach_path` is already `NOT NULL UNIQUE` and stable across a rebuild. Keeping it
populated for every coach — real path for sourced coaches, `manual:<token>` for manual ones — is
what makes the promotion lineage remap possible at all. **Approach A would have to invent a
synthetic stable identity anyway; Approach B simply uses the column that already is one.**

### 1.3 Why `name_key` must also be namespaced

`name_key` is `NOT NULL UNIQUE` (087:41) and is *"the ONLY thing the per-match column is joined
on, by exact string"* (087:74-75).

The importer's coach upsert is
`INSERT INTO coaches (...) ... ON CONFLICT (afltables_coach_path) DO UPDATE`
(`import_match_coaches.py:398-412`). **The conflict target is only the path.** A manual row
holding the real `"Surname, Given"` string would therefore collide on `coaches_name_key_key`
the first time AFL Tables publishes a coach page for that person — and a unique violation on a
non-target constraint is not an upsert, it aborts the whole batch. Every nightly coach import
would fail until an operator intervened.

Namespacing the manual `name_key` removes that class of failure by construction: an AFL Tables
`name_raw` is `"Surname, Given"` and can never equal `manual:<token>`. §5 makes the guarantee
structural with a CHECK rather than conventional.

The cost is that a manual coach can never be matched by the fitzRoy per-match `Coach` column.
That is correct, not a limitation: a manual coach exists precisely because the source does not
name them, and the contract's `identity_rule` already refuses *"A snapshot Coach string that is
not exactly one index name_raw"* (`afltables-contract.json:143`).

### 1.4 Assessment against the required criteria

| Criterion | Approach B (recommended) |
|---|---|
| Identity stability | Permanent. `manual:<token>` is minted once and never changes — not on rename, not on rebuild, not on promotion |
| Collision risk with future imports | **Zero by construction**, and enforced by CHECK (§5.3). Every AFL Tables path begins `coaches/`; every manual path begins `manual:` |
| Importer / reload behaviour | The coaches upsert touches rows by path only, and there is no delete-not-in-snapshot for `coaches`, so a manual row is untouched. `match_coaches` stale-delete is scoped `WHERE mc.source_id = <afltables>` (`:420-424`), so a manual assignment survives. The `ON CONFLICT (match_id, club_id) DO UPDATE` at `:429-431` *can* overwrite a manual assignment where the source later gains a row — §7 resolves this with replay ordering |
| Source provenance | Unweakened. `source_id` stays `NOT NULL` and names `manual_admin_edit`; the per-edit provenance lives in `data_edits`, exactly as 057:40-41 already specifies for manual values |
| Promotion / restore lineage | `coaches` is rebuilt-on-promotion, so the manual row is destroyed by the swap. It is **reconstructed** from `data_overrides`, which is `treatment: 'reinstate'` and whose own note (`promotion-inventory.ts:369-371`) already requires replay onto the promoted rows. §8 |
| Admin edit semantics | Identical for manual and sourced coaches: one import-role transaction writing canonical row + override + `data_edits`. No second code path |
| Reversibility | `is_active = false` retires a manual coach's identity override; the next reload stops reconstructing it. The row and its audit trail are never deleted |
| Migration complexity | Two CHECK widenings and two CHECKs on `coaches`. No new table, no new column, no `NOT NULL` relaxed, no data backfill |
| Public coach slugs / URLs | Unaffected. `coachSlug()` derives from `display_name` at read time (`src/lib/slugs.ts:25-40`) and `/coaches/[slug]` is `<slug>-<id>` with the id authoritative and a canonical redirect on mismatch (`src/app/coaches/[slug]/page.tsx:32,93-97`). A manual coach gets a normal slug; a corrected name permanent-redirects |
| `coaches` / `match_coaches` impact | No schema change to either beyond two CHECKs |
| Later link to an AFL Tables identity | Possible and safe, but **out of P3 scope** — see §11 S-3 |

---

## 2. Rejected alternatives

### A. Relax `afltables_coach_path` to nullable + partial unique index — **rejected**

1. **It destroys the only stable coach identity.** §1.2: `data_edits` lineage remap and
   `data_overrides.entity_key` both need a text identity that exists on both databases. A NULL
   path leaves only `name_key`, and `promotion-inventory.ts:78-82` forbids name-derived
   identity outright. A manual coach's `data_edits` rows become unremappable and the promotion
   stops.
2. **It does not remove the collision it is supposed to remove.** `name_key` is independently
   `NOT NULL UNIQUE`, and the upsert's conflict target is the path alone (`:405`). Relaxing the
   path changes nothing about the batch-aborting `name_key` violation in §1.3.
3. **It collapses into B.** To be lineage-safe it must mint a synthetic stable key anyway — at
   which point the nullable column and the partial index are pure cost.
4. It is a larger migration (drop `UNIQUE`, drop `NOT NULL`, add partial index) against a table
   carrying 383 rows of real provenance, for no gain.

### B′. Synthetic identifier under a **new** `sources` row — **rejected as unnecessary**

`manual_admin_edit` already exists with `kind = 'manual'` (057:36-42) and is already the
provenance citation for hand-entered values elsewhere (`manual-authority.ts:65-66`,
`common.py:962`, `094:287`). A second manual source would fragment that citation for no
benefit. Approach B uses the existing row.

### C. Existing mechanisms already in the repository

Three were assessed. All are real and all are retained — none is sufficient alone.

| Mechanism | What it does | Why not sufficient |
|---|---|---|
| `data_overrides` + `replay_admin_overrides` (073/078, `common.py:893`) | The durable human decision that destructive reloads replay | **This is the core of the recommendation** — but it currently has no `coaches` entity_type and no `coaches` replay branch. It is the thing P3 extends, not an alternative to it |
| `afltables-contract.json` `profile_link_corrections.rules` (`:144-176`) | Tracked, evidence-bound coach→player link corrections applied at import | Repo-side JSON, not browser-editable; requires an importer re-run; corrects **linkage only** and cannot create a coach. **Retained and must be respected** — §4.3 refuses an admin link that collides with a tracked rule |
| `src/lib/edit/spec.ts` `EDITABLE_ENTITIES` + `saveEdit()` (`data-edits.ts:161-262`) | The generic three-entity data editor | Cannot create rows, only edit existing ones; and adding `coaches` to it **breaks the settle** (§3). P3 reuses its *transaction shape*, not its spec |

**No smaller existing mechanism models manually-created, source-independent coach identity.**
Approach B is the smallest correct construction on top of what exists.

---

## 3. Blocking prerequisite — the `manual-authority.ts` fail-closed coupling

**This is the single highest-risk finding in this plan, and it is not in the umbrella's C-1
text.** It must be resolved before the migration runs, in either order.

`src/lib/acquisition/manual-authority.ts` pins two contracts at load time and **fails closed if
either changes**:

- `checkAdmitsExactly()` (`:191-197`) reads the live `data_overrides.entity_type` CHECK and
  requires its literal set to **exactly equal** `OVERRIDE_ENTITY_TYPES = ['draft_picks',
  'matches', 'players']` (`:54`).
- `editorSpecMatchesOverrideScope()` (`:103-107`) requires `Object.keys(EDITABLE_ENTITIES)` to
  **exactly equal** the same three.

Both feed `overrideScopeProven` (`:250-253`). When it is false, `manualAuthorityVerdict()`
returns `'indeterminate'` for `match_period_scores`, `player_match_stats` and
`brownlow_round_votes` (`:146-149`) — **which refuses**. The nightly AFL Tables settle then
stops applying those three targets and only proposes.

Consequences:

1. **Widening the CHECK to add `'coaches'` breaks the settle** the moment the migration runs.
2. **Shipping an updated pinned list first also breaks it**, for the window in which the code
   expects five literals and the database still has three.
3. An exact-set check therefore has **no safe two-step deploy order in either direction.**

### 3.1 Resolution (mandatory, ships before or with the migration)

Replace the exact-set proof with the proof that is *directly sufficient for the question being
asked*, keeping every existing refusal:

`overrideScopeProven` becomes true only when **all** of these hold, and false otherwise:

- the `data_overrides` `entity_type` CHECK is readable and unambiguous — exactly one matching
  constraint definition, at least one literal (the existing `:192-195` refusals, unchanged);
- **none** of `UNREPRESENTABLE_OVERRIDE_ENTITIES` appears among its literals;
- **none** of `UNREPRESENTABLE_OVERRIDE_ENTITIES` appears among `Object.keys(EDITABLE_ENTITIES)`;
- every editor entity is admitted by the CHECK (editor ⊆ CHECK).

This is strictly equivalent to what the current code proves about those three targets — the
comment at `:24-29` states the proposition exactly: *"an override for `match_period_scores`,
`player_match_stats` or `brownlow_round_votes` is unrepresentable at the database level"* — and
it is **order-independent**, so widening the CHECK in either sequence is safe. `coaches` is
deliberately **not** added to `EDITABLE_ENTITIES`; it gets its own route.

`OVERRIDE_ENTITY_TYPES` is still pinned and still updated (`['coaches','draft_picks','matches',
'match_coaches','players']`), but as the documented inventory, not as the proof.

**Acceptance gate for this change, before any UI work starts:** a DEV settle run proving all
three targets still apply, not merely propose. See §10.2 stage 1.

---

## 4. Source / provenance rules

### 4.1 Field classification for `coaches`

Nothing is a generic CRUD field. Every column is in exactly one class.

| Column | Class | Admin may |
|---|---|---|
| `id` | system | — |
| `afltables_coach_path` | **identity** | never edit, ever. Set once at creation |
| `name_key` | **identity / join key** | never edit, ever. Set once at creation |
| `source_id`, `source_record_id`, `import_batch_id` | **provenance** | never edit |
| `source_games_coached` | **source evidence** | never edit — 087:76-77 calls it cross-check evidence, *"Not a total"* |
| `display_name` | source-owned | edit **via override** (drives the public slug) |
| `given_name`, `surname`, `dob` | source-owned | edit via override |
| `notes` | admin-owned | edit via override |
| `player_id`, `link_status_value`, `afltables_profile_path` | **linkage** | change only through the link/unlink operation (§4.3) |

`match_coaches` has exactly one mutable fact: *who coached club C in match M*. Every column is
either a key or provenance.

### 4.2 Every coach mutation takes the same path

There is **no direct-UPDATE path and no second code path for manual coaches.** Every mutation —
create, metadata correction, link, assignment — is one `AFLDB_IMPORT_DATABASE_URL` short-lived
transaction (`data-edits.ts:195-262`, the `saveEdit` shape) containing, in order:

1. the canonical write to `coaches` / `match_coaches`;
2. the `data_overrides` upsert carrying the durable decision (delta-only payload, absent-vs-
   explicit-null preserved — the 086 source contract, `tests/data-overrides-source-contract.test.ts:31-34`);
3. `recordDataEdit()` into `data_edits` (`audit-log.ts:69`).

If (3) fails, (1) and (2) roll back with it — AFLDB-ISSUE-027, restated at `data-edits.ts:26-29`.
**No post-commit audit anywhere.**

`afldb_auth` gains no write access: `coaches` and `match_coaches` are already
`grant_import_write` registered (087:114-115) and already `grant_app_read` registered
(087:112-113), so reads use the ordinary public client and writes use the import role, exactly
as today.

### 4.3 Player linkage rules

`coaches_link_ck` (087:64-67) admits only `(player_id NOT NULL AND link_status_value = 'unique')`
or `(player_id NULL AND link_status_value <> 'unique')`. `coaches_profile_link_ck` (087:68)
requires `afltables_profile_path IS NOT NULL` whenever `player_id` is set.
`coaches_player_uq` (087:70) permits at most one coach per player.

Therefore an admin link:

- resolves the target player's AFL Tables profile path from `external_identities`
  (source `afltables`, status `unique`/`resolved`) — the same lookup `getEntityNaturalKey()`
  already performs for players, and **never by name**;
- writes `player_id`, `link_status_value = 'unique'`, `afltables_profile_path = <that path>`;
- is **refused** when the player already has a coach row (`coaches_player_uq`), when the player
  has no AFL Tables profile path (nothing to satisfy `coaches_profile_link_ck` with), or when
  `afltables-contract.json` `profile_link_corrections.rules` already carries a tracked,
  evidence-bound rule for this `coach_path` — a repo-tracked correction with cited HTTP evidence
  must not be silently overridden from a browser;
- stores the decision as `override_values.player_id_identity = '<profile path>'`, never a
  `player_id`. Player ids are rebuilt on promotion; profile paths are the lineage identity
  (`promotion-inventory.ts:1411-1434`).

Unlink is the inverse: `player_id = NULL`, `link_status_value = 'unmatched'`,
`afltables_profile_path` cleared, override rewritten (not deleted), `data_edits` row written.

`link_status_value = 'resolved'` is deliberately **not** used: the CHECK forbids it alongside a
`player_id`, and widening that CHECK to distinguish admin-resolved from importer-derived links
would be a second identity authority for no gain. Link provenance comes from `data_overrides` +
`data_edits`, which record who decided it and when.

**No `players` row is ever created for a coach.** 087:13-21 forbids it and this plan does not
touch that rule.

### 4.4 Duplicate prevention

| Layer | Mechanism |
|---|---|
| Database | `afltables_coach_path` UNIQUE, `name_key` UNIQUE, `coaches_player_uq` |
| Create action | Refuses when a coach already exists whose normalised display name matches and whose `dob` matches or is NULL; requires explicit typed confirmation when the name matches but the dob differs |
| Create action | Refuses when the named person resolves to a `players` row that already carries a coach row |
| Create action | Warns (does not refuse) when the name resembles an AFL Tables `name_key` — the person may already be sourced and manual creation would duplicate them |
| Assignment | `match_coaches` PK `(match_id, club_id)` makes two coaches for one team-match unrepresentable; the 087:95-108 trigger already refuses a club that is not in the match |

---

## 5. Schema / migration design

**`src/db/migrations/095_coach_admin_overrides.sql`** — number to be re-confirmed per §0.2.
Forward-only. No new table, no new column, no `NOT NULL` relaxed, no backfill.

### 5.1 `data_overrides.entity_type` widening

```sql
ALTER TABLE data_overrides
  DROP CONSTRAINT data_overrides_entity_type_check,
  ADD  CONSTRAINT data_overrides_entity_type_check CHECK (entity_type IN (
    'players', 'matches', 'draft_picks',   -- retained verbatim
    'coaches', 'match_coaches'
  ));
```

Every existing literal retained. **Requires §3.1 to have shipped**, in either order once §3.1 is
order-independent. R-4 satisfied.

### 5.2 `data_edits.table_name` widening — one literal only

```sql
ALTER TABLE data_edits
  DROP CONSTRAINT data_edits_table_name_check,
  ADD  CONSTRAINT data_edits_table_name_check CHECK (table_name IN (
    'players','matches','draft_picks','award_winners','hall_of_fame',
    'honour_team_members','brownlow_vote_entry_state','brownlow_season_authority',
    'coaches'
  ));
```

**`match_coaches` is deliberately absent.** `data_edits.row_id` is a single `bigint` (057:18)
and `match_coaches` has a composite primary key `(match_id, club_id)` (087:86), so it has no
row id to audit against. A coaching-assignment change is audited as a property of the match:

```
table_name  = 'matches'
row_id      = matches.id
field_group = 'coach_assignment'
old_values  = { club: '<club slug>', coach: '<path or null>', source: '<source key>' }
new_values  = { club: '<club slug>', coach: '<path or null>', source: 'manual_admin_edit' }
```

`'matches'` is already allowlisted, already lineage-remappable by `match_key`, and the P1
per-entity audit page `/admin/audit/entity/matches/<id>` already renders it. This removes an
allowlist entry, a lineage target and a whole class of promotion work from P3.

### 5.3 Two CHECKs on `coaches` making the manual namespace structural

```sql
ALTER TABLE coaches
  ADD CONSTRAINT coaches_path_namespace_ck
    CHECK (afltables_coach_path LIKE 'coaches/%' OR afltables_coach_path LIKE 'manual:%'),
  ADD CONSTRAINT coaches_manual_identity_ck
    CHECK ((afltables_coach_path LIKE 'manual:%') = (name_key LIKE 'manual:%'));
```

The first makes §1.3's collision-freedom a database guarantee rather than a convention. The
second forbids a half-namespaced row — a manual path with a real `name_key`, which is exactly
the batch-aborting shape.

**Operator pre-check, before writing the migration** (every existing path must already satisfy
the first CHECK, or it fails on `ALTER`):

```sql
SELECT count(*) FILTER (WHERE afltables_coach_path NOT LIKE 'coaches/%') AS bad_path,
       count(*) FILTER (WHERE name_key LIKE 'manual:%')                  AS bad_name_key,
       count(*)                                                          AS total
  FROM coaches;
```

Expected `bad_path = 0`, `bad_name_key = 0`, ~~`total = 383`~~ **`total = 386`**.

> **Correction, Stage 1 (2026-09-11).** `383` was wrong. It is
> `tools/rebuild/afltables/afltables-contract.json`'s count of accepted-baseline fitzRoy `Coach`
> **strings** (`:74`, `:183`), not coach rows. The same file pins
> `coaches.accepted_snapshot.measured.coaches = 386` (`:186`) and the tracked snapshot
> `data/sources/afltables/coaches/coaches-20260905/parsed/coach_pages.csv` holds exactly 386
> rows. The operator's run on `afldb_test` returned `bad_path = 0`, `bad_name_key = 0`,
> `total = 386`, all 386 sourced `afltables` — agreeing with the repository exactly. The two
> **migration-gating** invariants are the two zeros; `total` is a snapshot-size observation and
> never gated the `ALTER`.

### 5.4 Comments

`COMMENT ON COLUMN coaches.afltables_coach_path` and `.name_key` updated to record the manual
namespace and why (§1.2, §1.3), following 087's own commenting density.

### 5.5 Privileges — **no `privileges.sql` change**

| Need | Already satisfied by |
|---|---|
| App reads `coaches`, `match_coaches` | `grant_app_read` (087:112-113) |
| Import role writes `coaches`, `match_coaches` | `grant_import_write` (087:114-115) |
| Import role writes `data_overrides` | migration 078 narrow column grants, mirrored in `privileges.sql` and pinned by `tests/data-overrides-source-contract.test.ts:82-128` |
| Auth role appends `data_edits` | `privileges.sql:463` |

R-2 is satisfied **only if the admin UI does not read `data_overrides` through `afldb_auth`** —
see decision **D-2** in §12. The recommended answer keeps the privilege model unchanged.

### 5.6 Promotion inventory

No new table and no new `NOT NULL` football reference, so **no new `PROMOTION_CONTRACT` entry**
— and adding one would be a refusal (`{kind:'both'}`, `promotion-inventory.ts:1789`) because
both tables are already in `afldb_meta.import_writable_tables`.

Two additions are required in `tools/db/promotion-inventory.ts`:

1. A new identity rule `'afltables_coach_path'` on `LineageIdentityRule` (`:83`) with its
   `LINEAGE_IDENTITY_SQL` entry (`:1407`):

   ```
   entity:      'coaches'
   description: "coaches.afltables_coach_path — NOT NULL UNIQUE (migration 087), the AFL Tables
                 coach page path; 'manual:<token>' for an admin-created coach"
   byId:        SELECT id::bigint AS id, afltables_coach_path AS identity
                  FROM public.coaches WHERE id = ANY ($1::bigint[]) ORDER BY 1, 2
   byIdentity:  SELECT id::bigint AS id, afltables_coach_path AS identity
                  FROM public.coaches WHERE afltables_coach_path = ANY ($1::text[]) ORDER BY 1, 2
   ```

2. A new target on the existing `data_edits` lineage ref (`:322-337`):
   `{ kind: 'coaches', entity: 'coaches', identity: 'afltables_coach_path' }`, with the
   `remediation` text extended to name the coach case.

`assertContractCoherent()` (`:1072`) rejects a `historicalOnly` declaration that does not name
every lineage-bound **column** of its table. This adds a target to the existing `row_id` column,
not a new column, so the DEV `historicalOnly` declaration at `:339-358` stays coherent —
**verify this explicitly at implementation**, it is a refusal if wrong.

---

## 6. Importer / reload interaction

### 6.1 `replay_admin_overrides` gains two branches

`tools/migration/common.py:893` gains `coaches` and `match_coaches`, following the `players`
branch's absent-vs-explicit-null discipline (`:901-948`) exactly — `COALESCE` for `NOT NULL`
columns, `jsonb_exists` for nullable ones. The 086 source contract test pins that discipline and
must be extended to cover the new branches.

**`coaches` branch**

1. For `entity_key LIKE 'manual_admin_edit:%'`, `field_group = 'identity'`, `is_active`:
   **INSERT the coach if absent**, keyed on `afltables_coach_path = 'manual:' || <token>`, else
   UPDATE its fields. *This is what makes a manual coach survive a destructive reload and a
   promotion.*
2. For `entity_key LIKE 'afltables:%'`, `is_active`: UPDATE the overridden fields of the coach
   whose `afltables_coach_path` equals the key's suffix.
3. Linkage overrides resolve `player_id_identity` (a profile path) through `external_identities`
   to the local `player_id`, and refuse rather than guess when it resolves to nothing.

**`match_coaches` branch**

For `entity_type = 'match_coaches'`, `entity_key = '<match_key>|<club slug>'`,
`field_group = 'assignment'`: resolve `match_key` → `matches.id`, club slug → `clubs.id`
(`clubs.slug` is `NOT NULL UNIQUE`, 002:36), `override_values.coach_identity` → `coaches.id`,
then upsert `match_coaches` with `source_id = manual_admin_edit`. An unresolvable key raises
rather than silently skipping.

> **Decode rule, added at Stage 1 (2026-09-11) after G3 caught it.** `matches.match_key` is
> **itself pipe-delimited** — `season|round|date|home|away` (migration 003, built by
> `import_fitzroy_core.match_key_of()`), so `'<match_key>|<club slug>'` carries **five**
> delimiters, not one. A real key is
> `1902|1|1902-05-03|Carlton|Geelong|carlton`. The club slug is therefore the segment after
> the **last** delimiter, and `split_part(entity_key, '|', 1)` / `(…, 2)` — which reads
> `'1902'` and `'1'` — is wrong: it refuses a valid human decision. `clubs.slug` carries no
> `'|'`, so the last delimiter is the only unambiguous split point. The key **shape is
> unchanged**; only the decode is specified here. The decode is single-sourced in one CTE so
> the refusal query and the write query cannot diverge, and a key with no final delimiter, or
> an empty trailing slug, still refuses.

### 6.2 Call sites and ordering — this is load-bearing

`tools/migration/import_match_coaches.py`, inside the existing `with import_batch(...)` block
(`:388-444`), so the replay is in the same transaction as the import:

- `replay_admin_overrides(pg, "coaches")` **immediately after** the coaches upsert (`:412`) and
  **before** the `match_coaches` work, so manual coach rows exist for the assignment join;
- `replay_admin_overrides(pg, "match_coaches")` **after** the assignment upsert (`:432`) and
  **before** the integrity checks at `:434-440`.

Ordering matters because the assignment upsert is
`ON CONFLICT (match_id, club_id) DO UPDATE SET coach_id = EXCLUDED.coach_id` (`:429-431`) —
the primary key carries no source, so the snapshot **will** overwrite a manual assignment on a
team-match the source later covers. Replaying after restores the human decision. The stale-delete
at `:420-424` is already scoped `WHERE mc.source_id = <afltables>` and never touches a manual row.

The `coaches_written != len(coach_rows)` guard at `:434` counts rows affected by the INSERT over
`tmp_coaches` only, so manual rows do not perturb it. **Confirm by test**, do not assume.

### 6.3 Source-versus-human conflict is surfaced, never silent

Where the source later supplies a different coach for a team-match that carries an active manual
override, the human decision wins on replay and `/admin/coaches/[id]` **shows that it is now in
conflict with the source**, so the operator can retire it (`is_active = false`). Silent
divergence is the failure mode this repository consistently refuses — `manualAuthorityVerdict()`
returns `'conflict'` rather than overwriting (`manual-authority.ts:157-176`) and this follows it.

---

## 7. Promotion / restore contract

The promotion path is:

| Table | Treatment | Consequence for P3 |
|---|---|---|
| `coaches`, `match_coaches` | rebuilt (registry) | truncated and reloaded from the rebuilt source database. **A manual coach row does not survive the swap** |
| `data_overrides` | `reinstate`, `compare: 'equal'`, `restoreAfter: ['auth_users']` (`:366-372`) | survives, and its note already requires replay onto the promoted rows |
| `data_edits` | `reinstate`, lineage-bound on `row_id` (`:319-337`) | survives; its `'coaches'` rows remap through `afltables_coach_path` (§5.6) |

So the post-promotion sequence in `docs/production-promotion.md` §8 — *"after reinstatement they
must be replayed onto the promoted canonical rows"* — is the step that **re-creates every manual
coach and every manual assignment in the candidate**. P3's obligation is therefore:

1. add the two `replay_admin_overrides` branches (§6.1);
2. add the lineage identity rule and `data_edits` target (§5.6);
3. extend `docs/production-promotion.md` §8 to name `coaches` and `match_coaches` in the replay
   step, so the runbook and the code agree;
4. add the two new entity types to the acceptance checklist's override-replay verification.

The ISSUE-151 contract is preserved: no new table, no new `NOT NULL` football FK, no change to
`reinstateGroups`, `stagedReinstatement` or the `rowIdColumn` remap mechanism.

**One genuine gap to state plainly:** between the candidate swap and the override replay, a
manual coach does not exist in the promoted database. Any `/coaches/<slug>-<id>` URL for a manual
coach 404s in that window, and the ids change across it. This is the same window every
override-carried fact already lives in; it is not new, but P3 is the first phase where the
override carries an *entire row* rather than a field patch, so the runbook must say so.

---

## 8. Admin routes, capabilities and admission matrix

### 8.1 Capabilities — two, both enforced

Added to the `Capability` union (`src/lib/auth/capabilities.ts:36-54`) and `CAPABILITY_ROLES`:

| Identifier | Roles | Rationale |
|---|---|---|
| `data.coaches.read` | `ADMIN_AND_UP` | Reading coach provenance widens no boundary an Admin does not already have — coach data is public, and `operations.audit.read` already gives an Admin the full edit trail (`:96-104`) |
| `data.coaches.edit` | `SUPER_ADMIN_ONLY` | A coach edit becomes a public statistical fact immediately, with no draft stage. Matches `data.dataEditor` and `data.playerLinks`, both `SUPER_ADMIN_ONLY` (`:67-68`) |

This resolves the umbrella §2 *"draft-level TBD"* for Admin as: **Admin may inspect, only Super
Admin may mutate.** There is no Brownlow-style draft stage because there is no publication
boundary to draft against. The working name `data.coaches.edit` is kept; `.read` is added beside
it following the `data.brownlow.read` / `people.admins.read` precedent.

### 8.2 Admission matrix — the enforcing guard, not the nav entry

| Surface | Guard (first `await`) | Contributor | Admin | Super Admin |
|---|---|---|---|---|
| `GET /admin/coaches` | `requireCapability('data.coaches.read')` | ✗ → `/admin/upload` | ✓ | ✓ |
| `GET /admin/coaches/[id]` | `requireCapability('data.coaches.read')` | ✗ → `/admin/upload` | ✓ | ✓ |
| `createCoach` action | `requireCapability('data.coaches.edit')` | ✗ → `/admin/upload` | ✗ → `/admin` | ✓ |
| `saveCoachMetadata` action | `requireCapability('data.coaches.edit')` | ✗ | ✗ | ✓ |
| `linkCoachToPlayer` / `unlinkCoach` | `requireCapability('data.coaches.edit')` | ✗ | ✗ | ✓ |
| `setCoachAssignment` / `clearCoachAssignment` | `requireCapability('data.coaches.edit')` | ✗ | ✗ | ✓ |
| `retireCoachOverride` | `requireCapability('data.coaches.edit')` | ✗ | ✗ | ✓ |

`requireCapability` redirects exactly as the role guards do (`session.ts:331-335`). No surface is
weaker than existing policy: there is no coach surface today, and every mutation lands at
`data.dataEditor`'s level.

Nav (`src/app/admin/nav-model.ts:85-88`), Data group, after Data editor:
`{ href: '/admin/coaches', label: 'Coaches', capability: 'data.coaches.read' }`.

The ISSUE-158 source-contract test in `tests/auth.test.ts` will require both new capabilities to
be referenced by a real `requireCapability()` call — they are, so it passes by construction.

**Correction to the umbrella:** ISSUE-156 §1 says `/admin/coaches` *"Replaces the coach slice of
`/admin/data-editor`"*. There is no coach slice — `EDITABLE_ENTITIES` carries only `players`,
`matches`, `draft_picks`, and no file under `src/app/admin/` mentions coaches. P3 **adds** a
surface; it removes nothing, and `/admin/data-editor` is untouched.

---

## 9. UI structure

Existing Admin Centre shell (`layout.tsx`, `AdminNav.tsx`, `AdminSection.tsx`). Server Components
for every read; Server Actions for every mutation. 320 px / tablet / desktop; 44 px touch targets;
no hover-only provenance disclosure.

### `/admin/coaches`

- **Search + filters:** name (normalised), provenance (`AFL Tables` / `Manual`), link status,
  "has an active override".
- **Table:** display name · dob · provenance badge · link status · matches coached
  (`count(match_coaches)`, not a W/D/L derivation — cheap) · override badge. Paged with
  `src/components/admin/AdminPager.tsx` (the P1 extraction). **No new pager.**
- **Create panel**, Super Admin only, collapsed by default: display name, given name, surname,
  dob, notes. Submitting runs §4.4's duplicate checks and returns the candidate list rather than
  creating, until the operator confirms. Kept on the index route rather than a third route.

### `/admin/coaches/[id]`

Four panels, each independently submittable:

1. **Identity & provenance** — read-only. Path, `name_key`, source key, `source_record_id`,
   import batch, `source_games_coached`, link status, profile path, Manual/AFL Tables badge, and
   a link to `/admin/audit/entity/coaches/<id>` (P1's per-entity view, which the §5.2 allowlist
   widening makes populated).
2. **Editable metadata** — `display_name`, `given_name`, `surname`, `dob`, `notes`. Per-field
   "overridden" markers and a "retire this override" control.
3. **Player linkage** — search for a player, resolve through their AFL Tables profile path, link
   or unlink. Reuses the `src/app/admin/player-links/` `ResolvePanel` pattern rather than
   inventing a second one. Shows the refusal reasons from §4.3 as text, not as a disabled control
   with no explanation.
4. **Coaching assignments** — **bounded by construction.** Choose a club and a season; the panel
   lists that club's matches in that season with the current coach and its source; set or clear
   per match. A "apply to every listed match" control expands server-side into one override and
   one `data_edits` row per match inside a single transaction. There is no free grid over 33,676
   team-matches and no unbounded range.

### Interaction contract (inherited, binding)

- Every refusable form reuses `src/app/admin/brownlow/focus-restore.ts` — a refused action must
  not drop keyboard focus to `document.body` (ISSUE-155 H-1; the same defect stopped ISSUE-155
  §27.27 at section H, recorded in project memory).
- `useActionState` dispatch goes through one submit helper inside `startTransition`; client state
  reconciles from a server-recorded revision, not a `useEffect` dependency array.
- Disabled controls rely on React's fiber-read `disabled`; no client-only guard is treated as
  security.
- **No `revalidatePath` inside a Server Action** (R-7 — it hangs the Next 15.5 client; the
  player-links fix moved it out). Revalidation runs after the action resolves, over exactly:
  `/coaches`, `/coaches/<slug>-<id>`, `/records/coaches`, `/clubs/<club slug>` for every affected
  club, `/players/<slug>` when linked, and `/sitemap.xml`. `/coaches/[slug]` is
  `revalidate = 3600` with `generateStaticParams` (`page.tsx:25-32`), so without this an edit is
  invisible for up to an hour.
- Nothing arbitrary reaches the browser: no SQL, no importer arguments, no shell, no file paths.

---

## 10. Tests and acceptance

### 10.1 Test homes — extend first, create only twice

| Coverage | Home | New? |
|---|---|---|
| Override-scope proof after widening (§3.1) | `tests/current-season-import.test.ts` (already pins `OVERRIDE_ENTITY_TYPES`) | extend |
| 086 source contract for the new replay branches | `tests/data-overrides-source-contract.test.ts` | extend |
| Capability source contract + nav for the two new capabilities | `tests/auth.test.ts` | extend |
| Promotion inventory: new identity rule, `data_edits` coach target, contract coherence | `tests/db-promotion-check.test.ts` | extend |
| Importer identity/collision rules for `manual:` paths | `tests/coach-reconciliation.test.ts` | extend |
| Slug behaviour for a manual coach and a renamed coach | `tests/coach-slug.test.ts` | extend |
| Admin action unit contracts (validation, duplicate refusal, link refusal, assignment bounds) | `tests/admin-coach-actions.test.ts` | **new** — no existing home covers coach *admin* mutations |
| Integration on `afldb_test` | `tests/integration/admin-coaches.test.ts` | **new** — same reason |
| Responsive browser acceptance | `tests/nl-ui/`-style Playwright pass on DEV | manual, recorded |

### 10.2 Acceptance gates, in order

**Stage 1 — override-scope contract and reload safety (no UI).**

1. Unit: the rewritten `overrideScopeProven` proof — proves `'clear'` with the widened CHECK,
   still `'indeterminate'` on an unreadable, ambiguous, or `UNREPRESENTABLE_*`-admitting CHECK,
   and on an editor entity the CHECK does not admit.
2. Migration applies on `afldb_test`; §5.3 pre-check returns `bad_path = 0`.
3. Integration on `afldb_test`: create a manual coach row + identity override → run
   `import_match_coaches.py` against the tracked snapshot → **the manual coach survives, the
   manual assignment survives, and the batch does not abort**; then the same with a `name_key`
   that would have collided pre-namespacing, proving `coaches_manual_identity_ck` refuses it.
4. **A real DEV settle run proving `match_period_scores`, `player_match_stats` and
   `brownlow_round_votes` still apply, not merely propose.** This is the gate. §3.
5. `tsc` clean; `db-promotion-check` green.

**Stage 2 — admin surface.**

6. Permission matrix: direct URL and direct Server Action invocation for Contributor / Admin /
   Super Admin against all seven surfaces in §8.2.
7. Unit: duplicate prevention (each §4.4 rule), link refusals (each §4.3 rule), assignment bounds.
8. Integration on `afldb_test`: create → edit → link → assign → each writes its `data_edits` row
   **in the same transaction**, proven by forcing the audit insert to fail and asserting the
   canonical write rolled back.
9. Integration: override persistence — edit a source-owned coach's `display_name`, re-run the
   importer, assert the override survives with absent-vs-null semantics intact.
10. Integration: coach-only manual creation and existing-player-to-coach linkage end to end.
11. Integration: tenure assignment correctness — assignment appears in `match_coaches` with
    `source_id = manual_admin_edit`, derived club/coach records recompute, the 087 trigger still
    refuses a club that is not in the match.
12. Responsive browser acceptance on DEV at 320 / 768 / 1000 / 1280 / 1920 across the index,
    detail, create panel and a refused action (focus must stay on the control).
13. `tsc` clean; full affected suites green.

---

## 11. Risk register and stop conditions

| ID | Risk | Stop condition |
|---|---|---|
| **S-1** | `manual-authority.ts` exact-set proof turns the nightly settle's three unrepresentable targets to `'indeterminate'` | §3.1 ships and the DEV settle in §10.2 gate 4 passes **before** any UI work. If the settle still only proposes, **stop** |
| **S-2** | A manual `name_key` collides with a future AFL Tables `name_raw` and aborts the coach import batch | `coaches_manual_identity_ck` + `coaches_path_namespace_ck` (§5.3) must be in the migration. Without both, **stop** |
| **S-3** | **Coach reconciliation expands into P9.** A manual coach later gaining an AFL Tables identity needs a merge: re-point assignments, retire the manual identity, and keep the superseded row forever (deleting it makes its `data_edits` rows unremappable and **the promotion stops**, `promotion-inventory.ts:331-332`) | **Out of P3 scope, stopped and reported.** See §13. P3 delivers only duplicate *prevention*; no merge, no `superseded_by` column, no delete path for `coaches` |
| **S-4** | `assertContractCoherent()` refuses the new `data_edits` lineage target against the DEV `historicalOnly` declaration | Verify at implementation (§5.6). If it refuses, **stop** — the DEV disposition must be re-decided by the operator, not worked around |
| **S-5** | The admin UI reads `data_overrides` through `afldb_auth`, which the subtractive spec has never granted | **Decided (D-2):** reads go through the narrow server-side import-role helper. A read surface without a `privileges.sql` entry in the same change → **stop** (umbrella R-2); any direct `afldb_import` authority in browser/admin client code → **stop** |
| **S-10** | Stage 1 evidence shows `coaches_link_ck` must admit `'resolved'` after all | **Decided (D-3): do not widen.** If repository evidence proves a widening is genuinely required, **stop and report** to the operator — do not widen in flight |
| **S-6** | `revalidatePath` inside a Server Action hangs the client | Revalidation is outside the action's pending path (§9). Any in-action call → **stop** |
| **S-7** | The browser gains import-role powers | It does not: the import role is reached only through the existing short-lived `AFLDB_IMPORT_DATABASE_URL` connection inside a named action, with no operation, table or argument supplied by the request. Any unbounded importer argument reachable from the browser → **stop** |
| **S-8** | Migration 095 is taken on another branch | §0.2 command 4. Re-number and proceed; nothing else changes |
| **S-9** | An admin link silently defeats a tracked `profile_link_corrections` rule | The link action refuses when a tracked rule covers that `coach_path` (§4.3). Without that refusal, **stop** |

**None of the umbrella's C-1 stop conditions fire.** Manual coach identity is durable without
weakening source provenance (§1); the importer does not overwrite manual rows (§6.2); promotion
lineage is maintainable (§7); the browser gains no import-role powers (S-7). The one stop
condition that **does** fire is the reconciliation one, and it is reported in §13 rather than
absorbed.

---

## 12. Operator decisions — **ALL APPROVED 2026-09-11**

These are binding on implementation. They are not re-openable during Stage 1; material
contradicting evidence is a **stop and report**, not a redesign.

| ID | Decision | Approved outcome |
|---|---|---|
| **D-1** | Override-scope proof versus a constrained deploy window | **APPROVED — rewrite the proof (§3.1), order-independent.** Binding addition: **no deploy window is acceptable in which widening `data_overrides` can silently make the settle switch from apply to propose-only.** The rewritten proof must make that unreachable in either order, and gate 4 (a real DEV settle proving apply) is what demonstrates it |
| **D-2** | How the admin UI reads override state | **APPROVED — a narrow server-side SELECT-only import-role helper**, on the existing short-lived `AFLDB_IMPORT_DATABASE_URL` connection (the `saveEdit` precedent, `data-edits.ts:195-198`). Browser and admin client code get **no** direct `afldb_import` authority, and `afldb_auth` privileges are **not** broadened merely to expose override inspection. No `privileges.sql` change, no deploy-order step, R-2 untouched |
| **D-3** | Widen `coaches_link_ck` to admit `link_status_value = 'resolved'` | **APPROVED — do not widen**, unless Stage 1 repository evidence proves it is required. If such evidence appears, it is a stop-and-report to the operator (S-10), not an in-flight widening |
| **D-4** | Manual assignment versus source, where the source later covers that team-match | **APPROVED — an explicit human/admin decision wins visibly and durably.** A source refresh must never silently overwrite it: the human decision wins on replay (§6.2) and the conflict is shown in `/admin/coaches/[id]` (§6.3) so the operator can retire it. Consistent with `manualAuthorityVerdict()` returning `'conflict'` rather than overwriting |
| **D-5** | What G4 must observe when the source publishes no candidate for an unrepresentable target | **APPROVED 2026-09-11 — revised G4 semantics, §17.1.** G4 exists to prove D-1/S-1: post-095 manual authority on REAL `afldb_dev` stays `clear` for all three unrepresentable canonical targets. All three are answered from the SAME `overrideScopeProven` boolean in `manualAuthorityVerdict()` (`manual-authority.ts:173-176`) — there is no per-family authority branch — and AFL Tables publishes no Brownlow votes until the count, which this repository already pins as the normal in-season shape (`import_fitzroy_core.py:2097-2099`; `tests/integration/settle-afltables.test.ts:384,554,1168-1172`). The literal "source data for every family on the day" reading would make G4 unsatisfiable for most of every year and would test AFL Tables' publication calendar rather than AFLDB. G4 is therefore observed as the four legs in §17.1. **This is NOT a Brownlow skip:** the absence must be positively proven to be a SOURCE absence, never an authority refusal |

---

## 13. Reported stop — coach reconciliation is P9-class

The prompt asked whether a coach may later become linked to an AFL Tables identity and how that
reconciliation would occur without duplicating the person. It can, and it must not be built here.

The mechanism would be: re-point every manual `match_coaches` assignment override onto the
sourced `coach_path`, deactivate the manual identity override, and mark the manual `coaches` row
superseded. The last step is the problem. The manual row **cannot be deleted**: its `data_edits`
rows carry its id, `data_edits` is lineage-bound on `row_id` (`promotion-inventory.ts:322-337`),
and an id that resolves to nothing does not get dropped — *"the promotion stops and the operator
records the decision"* (`:331-332`). So reconciliation needs a durable supersession record, a
mandatory preview of every affected row, a second human review step, and a reversible merge
record — which is precisely the ISSUE-156 §10 R-5 / P9 contract, and no merge tooling exists
anywhere in the repository.

**Recommendation:** P3 ships duplicate *prevention* (§4.4) and no merge, no `superseded_by`
column, and no delete path for `coaches`. Adding the column now with no writer would be
speculative; adding it later is a trivial forward migration. Allocate a separate issue
(next free after 159) for coach reconciliation, folded under P9's lifecycle work.

---

## 14. Files expected to change during implementation

Nothing below has been changed. This is the expected set, for review.

**Stage 1 — contract, migration, reload, promotion**

| File | Change |
|---|---|
| `src/lib/acquisition/manual-authority.ts` | Rewrite `overrideScopeProven`'s proof (§3.1); update `OVERRIDE_ENTITY_TYPES` |
| `src/db/migrations/095_coach_admin_overrides.sql` | **new** — §5.1, §5.2, §5.3, §5.4 |
| `tools/migration/common.py` | `replay_admin_overrides` gains `coaches` and `match_coaches` branches (§6.1) |
| `tools/migration/import_match_coaches.py` | Two `replay_admin_overrides` calls at the ordered positions (§6.2) |
| `tools/db/promotion-inventory.ts` | `'afltables_coach_path'` identity rule + `LINEAGE_IDENTITY_SQL` entry + `data_edits` coach target (§5.6) |
| `src/db/queries/audit-log.ts` | `DataEditTableName` union + `DATA_EDIT_TABLE_NAMES` gain `'coaches'` |
| `docs/production-promotion.md` | §8 replay step names `coaches` and `match_coaches`; acceptance checklist updated (§7) |
| `tests/current-season-import.test.ts`, `tests/data-overrides-source-contract.test.ts`, `tests/db-promotion-check.test.ts`, `tests/coach-reconciliation.test.ts` | Extended per §10.1 |
| `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` | Stage 1 state + one `Unreleased` entry (migration, reload-replay behaviour, promotion-lineage rule). The **allocation** edits to `issues.md`, `IssuesIndex.md`, `AFLDB-ISSUE-156.md` and this file were made on 2026-09-11 and are already done |

**Stage 2 — admin surface**

| File | Change |
|---|---|
| `src/lib/auth/capabilities.ts` | `data.coaches.read`, `data.coaches.edit` (§8.1) |
| `src/app/admin/nav-model.ts` | Data group entry |
| `src/app/admin/coaches/page.tsx` | **new** — list, search, filters, create panel |
| `src/app/admin/coaches/[id]/page.tsx` | **new** — four panels (§9) |
| `src/app/admin/coaches/actions.ts` | **new** — seven Server Actions, each `requireCapability` first |
| `src/app/admin/coaches/*.tsx` | **new** — client panels; reuse `AdminPager`, `focus-restore`, the `player-links` `ResolvePanel` pattern |
| `src/db/queries/admin-coaches.ts` | **new** — reads (public client) + the import-role mutation transactions (§4.2) |
| `src/lib/slugs.ts` | Unchanged — verify only |
| `tests/auth.test.ts`, `tests/coach-slug.test.ts` | Extended |
| `tests/admin-coach-actions.test.ts`, `tests/integration/admin-coaches.test.ts` | **new** (§10.1) |
| `IssuesIndex.md`, `issues.md`, `CHANGELOG.md` | Ledger, index, Unreleased entry |

No change to: `src/lib/edit/spec.ts` (coaches stay out of the data editor — §3.1),
`src/app/admin/data-editor/**`, `tools/maintenance/privileges.sql` (§5.5), `src/db/migrations/087_coaches.sql`,
or any public coach page.

---

## 15. Phasing and handoff

**Recommendation: one issue, two gated stages — not two issues, and not one undivided change.**

Stage 1 touches the acquisition pipeline and the promotion contract. Its failure mode is the
nightly settle silently degrading to propose-only, which is exactly the kind of defect that hides
until someone reads a journal. It must be merged, deployed to DEV, and **proven by a real settle
run** (§10.2 gate 4) before stage 2 begins. Stage 2 is ordinary admin UI with no acquisition
reach, and is safe to iterate on afterwards.

Splitting into two issues would fragment one C-1 decision across two ledger entries for no
operational gain; running both stages as one undivided change would put the settle gate after the
UI work, which is the wrong order.

**Recommended model and effort after approval:**

- **Stage 1 — Opus 5, high effort (confirmed at approval 2026-09-11).** Fail-closed proof rewrite, a Python replay branch that must
  honour absent-vs-explicit-null semantics, and a promotion lineage rule. Every one of these is a
  place where a plausible-looking change is silently wrong.
- **Stage 2 — Sonnet 5, medium effort**, escalating to Opus 5 for the assignment panel's
  transaction and the permission matrix tests. The routes, panels and actions have close,
  well-tested precedents in `player-links` and `brownlow`.
- Fresh session per stage, with this document as the carry-over contract (CLAUDE.md §1).

---

## 16. Stage 1 implementation contract (approved 2026-09-11)

This section is the contract a Stage 1 session executes. It does not redesign anything above; it
states exactly what Stage 1 delivers and what it must not touch.

### 16.1 Deliverables, in this order

1. **`src/lib/acquisition/manual-authority.ts` — rewrite `overrideScopeProven`'s proof** to the
   §3.1 four-condition form (readable + unambiguous CHECK; no `UNREPRESENTABLE_OVERRIDE_ENTITIES`
   literal in the CHECK; none among `Object.keys(EDITABLE_ENTITIES)`; editor ⊆ CHECK). Keep every
   existing refusal. Update `OVERRIDE_ENTITY_TYPES` to
   `['coaches','draft_picks','matches','match_coaches','players']` as documented inventory only,
   never as the proof. **Order-independent in both directions** (D-1).
2. **Operator pre-check before writing the migration** (§5.3 SQL): expect `bad_path = 0`,
   `bad_name_key = 0`, `total = 386` (corrected from `383` at Stage 1 — see the note in §5.3).
   **PASSED 2026-09-11.**
3. **`src/db/migrations/095_coach_admin_overrides.sql`** — §5.1 (`data_overrides.entity_type`
   += `'coaches'`, `'match_coaches'`), §5.2 (`data_edits.table_name` += `'coaches'` only —
   `match_coaches` deliberately absent), §5.3 (`coaches_path_namespace_ck`,
   `coaches_manual_identity_ck`), §5.4 comments. Forward-only. Re-confirm the number at preflight.
4. **`tools/migration/common.py`** — `replay_admin_overrides` gains the `coaches` and
   `match_coaches` branches (§6.1), honouring the 086 absent-vs-explicit-null discipline
   (`COALESCE` for `NOT NULL`, `jsonb_exists` for nullable). Unresolvable keys raise; never skip.
5. **`tools/migration/import_match_coaches.py`** — the two `replay_admin_overrides` calls at the
   exact ordered positions of §6.2, inside the existing `with import_batch(...)` block.
6. **`tools/db/promotion-inventory.ts`** — the `'afltables_coach_path'` identity rule and its
   `LINEAGE_IDENTITY_SQL` entry, plus the `{ kind: 'coaches', entity: 'coaches', identity:
   'afltables_coach_path' }` target on the existing `data_edits` lineage ref, remediation text
   extended. **Explicitly verify `assertContractCoherent()` still accepts the DEV `historicalOnly`
   declaration** (S-4).
7. **`src/db/queries/audit-log.ts`** — `DataEditTableName` union and `DATA_EDIT_TABLE_NAMES` gain
   `'coaches'`.
8. **`docs/production-promotion.md`** — §8 replay step names `coaches` and `match_coaches`;
   acceptance checklist gains the two new entity types (§7).
9. **Tests**, extended in place (§10.1): `tests/current-season-import.test.ts`,
   `tests/data-overrides-source-contract.test.ts`, `tests/db-promotion-check.test.ts`,
   `tests/coach-reconciliation.test.ts`. No new test file in Stage 1.
10. **Tracking**: `issues.md` (entry + Open Issues row), `IssuesIndex.md`, and one `Unreleased`
    `CHANGELOG.md` entry — the migration, the reload-replay behaviour and the promotion-lineage
    rule are all meaningful retained changes.

### 16.2 Stage 1 must NOT

- add `'coaches'` to `EDITABLE_ENTITIES` or otherwise touch `src/lib/edit/spec.ts`;
- create any route, page, component, Server Action or capability (that is Stage 2);
- change `tools/maintenance/privileges.sql` (§5.5) or `src/db/migrations/087_coaches.sql`;
- add a `PROMOTION_CONTRACT` entry for `coaches` / `match_coaches` (a refusal — §5.6);
- widen `coaches_link_ck` (D-3), relax any `NOT NULL`, or add a `superseded_by` column;
- implement merge / reconciliation in any form (§13, C-1);
- perform Git, deployment or database-state operations of its own.

### 16.3 Binding invariants

- Every coach mutation is one import-role transaction: canonical write + `data_overrides` upsert
  + `recordDataEdit()`, all or nothing (§4.2). No post-commit audit.
- Identity is never name-derived; `manual:<token>` is minted once and never changes (§1.1).
- A human decision wins visibly and durably over a later source refresh (D-4, §6.2, §6.3).
- The nightly settle must still **apply** `match_period_scores`, `player_match_stats` and
  `brownlow_round_votes` — never degrade to propose-only (D-1, S-1).

---

## 17. Stage 1 validation gates (exact, in order)

Stage 1 is complete only when every gate below has passed. Gate 4 is the hard gate; gates 1–3
and 5 may be re-run freely, but **UI work does not begin until gate 4 passes**.

| # | Gate | Command / evidence | Pass condition |
|---|---|---|---|
| **G0** | Preflight and migration number | `npm run preflight -- --mode implementation --issue 159` | READY; 095 still free (re-number and proceed if not — S-8) |
| **G1** | Override-scope proof unit contract | `npx vitest run tests/current-season-import.test.ts` | `'clear'` with the widened CHECK; still `'indeterminate'` on an unreadable CHECK, an ambiguous CHECK, a CHECK admitting any `UNREPRESENTABLE_OVERRIDE_ENTITIES` literal, and an editor entity the CHECK does not admit. **Both deploy orders proven** (code-before-migration and migration-before-code). **PASSED 2026-09-11** — 254 passed, 4 pre-existing POSIX skips, 0 failures |
| **G2** | Pre-check + migration on `afldb_test` | §5.3 SQL, then `npm run db:migrate` against `AFLDB_TEST_DATABASE_URL` | `bad_path = 0`, `bad_name_key = 0`, `total = 386` (corrected from `383`, §5.3) — **pre-check PASSED 2026-09-11**; migration 095 then applied to `afldb_test` via `npm run db:migrate:test`, both new CHECKs present — **G2 PASSED 2026-09-11** |
| **G3** | Reload safety on `afldb_test` | seed a manual coach row + identity override, run `tools/migration/import_match_coaches.py` against the tracked snapshot | manual coach survives; manual assignment survives; **batch does not abort**; the `coaches_written != len(coach_rows)` guard is unperturbed (proven, not assumed); a would-have-collided real `name_key` is refused by `coaches_manual_identity_ck`. **PASSED 2026-09-11 (A–E)**, against the exact accepted fitzRoy `full-history-20260902` snapshot restored from DEV (validator PASS: seasons 1897–2025, 16,838 matches, 685,471 player match rows). **The first G3-B run failed closed on a real defect** — the §6.1 composite-key decode — and the batch rolled back with nothing written; read-only verification confirmed the rollback (386 sourced + 1 manual = 387, three overrides intact) and demonstrated the broken and fixed decodes live; the decoder now splits on the LAST `|`, single-sourced for both the refusal check and the write, with the Stage 1 regression coverage updated. Rerun G3-B: batch 255, coaches 386, match_coaches 32,452, 0 stale removed. G3-C: sourced coach survived the reload, manual coach reconstructed from its override, D-4 manual Carlton assignment won after a source refresh (386 sourced + 2 manual = 388; 32,451 source + 1 manual = 32,452), migration-095 invariants clean. G3-D: all four identity/namespace collision cases refused, transaction rolled back. G3-E: fixture cleaned, `afldb_test` restored to 386 sourced coaches. **Do not re-run G3.** |
| **G4** | **DEV settle still applies (HARD GATE)** | a real settle run on DEV after deploying the Stage 1 change | `match_period_scores`, `player_match_stats` and `brownlow_round_votes` all **apply**, not merely propose. Anything else → **STOP** (S-1). **OPEN.** Step 1 **PASSED 2026-09-11** — `npm run db:status` against `afldb_dev`: 95 migration files, 94 applied, only `095_coach_admin_overrides.sql` pending. Step 2 **PASSED 2026-09-11** — a read-only pre-check on the real `afldb_dev` (a `BEGIN READ ONLY` transaction ending in `ROLLBACK`, refusing any database but `afldb_dev`) proved DEV data compatible with 095: both CHECK names present with their 073/094 definitions matching verbatim, neither new `coaches` constraint already present, 386 coach rows with 0 null-identity, 0 namespace and 0 half-namespaced violations and 0 rows already in the `manual:` namespace, and the 1 `data_overrides` row (`matches`) and 5 `data_edits` rows (`brownlow_vote_entry_state`) both inside the widened allowlists. Nothing was mutated; 095 was NOT applied to DEV. **PASSED 2026-09-11 as legs A+B+C under the revised D-5 semantics — see §17.1 for the recorded evidence.** |
| **G5** | Source contract for the new replay branches | `npx vitest run tests/data-overrides-source-contract.test.ts` | absent-vs-explicit-null preserved on both new branches; the 078 narrow column grants still pinned — **PASSED 2026-09-11, 12/12** |
| **G6** | Promotion contract | `npx vitest run tests/db-promotion-check.test.ts` | new identity rule + `data_edits` coach target green; `assertContractCoherent()` accepts the DEV `historicalOnly` declaration (S-4) — **PASSED 2026-09-11, 97/97** |
| **G7** | Coach identity/collision rules | `npx vitest run tests/coach-reconciliation.test.ts` | `manual:` namespace rules hold — **PASSED 2026-09-11, 13/13** |
| **G8** | Typecheck | `npx tsc --noEmit` | clean — **PASSED 2026-09-11: exit 0, no output** |

No full-suite or `npm run build` run is required by Stage 1; escalate only if a gate implicates
framework or build behaviour.

### 17.1 Revised G4, as observed (operator decision D-5, approved 2026-09-11)

G4's proposition is D-1/S-1: **post-095 manual authority on REAL `afldb_dev` remains `clear`
for every unrepresentable canonical target.** It is observed in four legs, all of them on the
real DEV database. G4 is PASSED only when A, B and C all pass; D is an obligation carried
forward, not a gate.

**G4-A — the real DEV settle path.** Bundle `settle-2026-2026-09-11-1148` (213 matches, 9,798
player match rows, 0 rejections, source COMPLETE). `--dry-run --auto-apply` first, and the real
`--apply --auto-apply --require-complete-source` only after that dry run is assessed. PASS
requires:

- every candidate that actually reaches manual authority is NOT refused
  `manual_authority_indeterminate`;
- `canonicalApplyRefusals` carries no refusal for that authority reason;
- where a genuine CHANGED target exists, positive `canonical_applications` evidence for that
  target (`target_table` + `import_batch_id`);
- a target reporting `nothing_to_write` is acceptable ONLY where the evidence positively shows
  the canonical DEV row already equals the offered source value. **The absence of a write is
  never by itself an APPLY proof** — `canonical-apply.ts:974-979` short-circuits
  `nothing_to_write` BEFORE the authority is consulted, so an unchanged target proves nothing
  about authority either way.

**G4-B — the direct live authority proof.** Inside a `BEGIN READ ONLY` transaction on REAL
`afldb_dev`, call the repository's own `loadManualAuthority(tx, 2026)` — never a
reimplementation — and query all three named entities explicitly, printing the live
`data_overrides` CHECK definition the proof read. PASS requires exactly:

```text
match_period_scores  = clear
player_match_stats   = clear
brownlow_round_votes = clear
```

Any `indeterminate` is **G4 FAILED (S-1)**, whatever G4-A showed. `loadManualAuthority()`
(`manual-authority.ts:264-318`) is three SELECTs and writes nothing.

**G4-C — the source-absence proof.** The already-observed bundle evidence is retained as the
record: `projectable_round_vote_rows = 0`, `rows_with_votes = 0`, `rows_na = 9798`,
`distinct_values = []`, `seasons_gated_for_round_votes = [2026]`. The settle batch must then
contain **zero** `brownlow_round_votes` candidate, application or refusal rows. This proves no
Brownlow canonical target existed BECAUSE THE SOURCE PUBLISHED NONE — an authority refusal
would instead appear as a `manual_authority_indeterminate` rejection or a pending candidate. If
a Brownlow candidate or refusal DOES appear, investigate; the gate is not passed.

**G4-D — carry-forward verification.** When AFL Tables publishes the 2026 Brownlow votes, the
next real DEV settle must positively show `brownlow_round_votes` traversing the canonical apply
path. Recorded as a dated follow-up verification obligation, **not** a Stage 2 blocker. The
existing vote-bearing scenarios in `tests/integration/settle-afltables.test.ts` remain
SUPPORTING evidence only — they run against `afldb_test`, not DEV.

#### Recorded result — **G4 PASSED (A+B+C) 2026-09-11**

**G4-A PASS.** The dry run (`--dry-run --auto-apply --require-complete-source`, bundle
`settle-2026-2026-09-11-1148`) executed the full write path against real constraints,
privileges and the real `loadManualAuthority()` on `afldb_dev`, then rolled back:
`manualAuthorityRefusals 0`, `canonicalApplyRefusals 0`, `canonicalApplyFailures 0`,
`canonicalRowsInserted 0`, `canonicalRowsUpdated 0`, source COMPLETE. Because
`settle-afltables.ts:2486` counts EVERY non-applied target result — `nothing_to_write`
included — a zero refusal count proves no target was offered, i.e. `invitationFor()`
(`:2243-2249`) found no difference. The read-only population probe then established the
population that decision ran over: **213 resolved `match_period_scores` targets** (live
match + at least one canonical period row, 0 match keys absent on DEV) and **8,974 resolved
`player_match_stats` targets**, with **824 unresolved player identities reconciling exactly**
against the run's `unresolvedIdentityPlayer` and **no** identity-resolved record lacking a
canonical row. So every resolved target was compared by the repository's own `diffFields()`
and found already equal to canonical DEV. No apply was required, and none was run.

**G4-B PASS.** A `BEGIN READ ONLY` transaction on real `afldb_dev` called the repository's
own `loadManualAuthority(tx, 2026)`: `overrideScopeProvenFrom(definitions) = true` over the
live post-095 CHECK, and `match_period_scores = clear`, `player_match_stats = clear`,
`brownlow_round_votes = clear`, every per-field verdict `clear`. The negative control (an
empty field list) returned `indeterminate`, so the provider is discriminating rather than
permissive. **This is the direct positive proof of D-1/S-1 on the live authority contract.**

**G4-C PASS.** `rows_with_votes = 0`, `projectable_round_vote_rows = 0`,
`seasons_gated_for_round_votes = [2026]` offline, and no `brownlow_round_votes` candidate,
application or refusal appeared anywhere in the run — `proposedBrownlowValues()` (§1331-1340)
returns null when the source published no vote, so no target is constructed at all. The
absence is therefore proven to be a SOURCE absence, not an authority refusal. Recorded
against the dry run rather than an applied batch, because G4-A required no apply.

**G4-D OPEN (carry-forward, not a blocker).** When AFL Tables publishes the 2026 Brownlow
votes, the next real DEV settle must positively show `brownlow_round_votes` traversing the
canonical apply path. Verify and record it then.

*Diagnostic note, for the audit trail:* the first population probe compared
`record.family` against the CONTRACT spellings while the bundle carries the dotted WIRE
form, so it reported a zero population. That was a probe defect, not evidence; it was
caught by the operator, corrected to route through the repository's own
`contractFamilyOf()`, and re-run with a hard precondition on the family histogram. No
conclusion was drawn from the defective run.

---

## Next action

**Approved. Tracking allocated 2026-09-11** — `AFLDB-ISSUE-159` now exists in `issues.md`
(detail entry + Open Issues row), `IssuesIndex.md`, and `AFLDB-ISSUE-156.md` (§10 C-1 decided,
§11 P3 = 159, P3 handoff contract).

*Superseded — Stage 1 has been written and G0–G3 have passed.*

**Current next action (2026-09-11).** **Stage 1 is COMPLETE and validated: G0–G8 all passed.**
The Stage 1 closeout tracking updates are written and await the operator's commit and push on
`opus/issue-159-coach-admin`. **Do not merge to `main` yet** — merge readiness is a separate
operator step (`npm run merge:ready -- --issue 159`), and ISSUE-151 promotion/restore lineage
stays untouched.

Then **Stage 2 in a fresh session** (§9, §15: Sonnet 5 / medium effort, escalating to Opus 5
for the assignment transaction and the permission matrix), against this document as the
contract. Stage 2 is UNBLOCKED but NOT STARTED. Binding on it: D-2, D-3 and D-4 are Stage 2
obligations; the reported P9-class coach reconciliation stop (§13) stays out of scope; and
the interaction contract in §9 is inherited, including no `revalidatePath` inside a Server
Action (S-6).

**G4-D remains OPEN** and is carried by this issue until the 2026 Brownlow count publishes:
the next real DEV settle after it must positively show `brownlow_round_votes` traversing the
canonical apply path. It blocks nothing.
