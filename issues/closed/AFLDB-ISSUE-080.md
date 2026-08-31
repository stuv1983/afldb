# AFLDB-ISSUE-080 — Approved implementation runbook and evidence record (revision 5)

> **Status of this document:** approved implementation runbook and evidence
> record. `AFLDB-ISSUE-080` is **Resolved** (2026-08-23): the plan below was
> approved, implemented and validated — the authoritative fix and validation
> record is the `AFLDB-ISSUE-080` entry in `issues.md`. The body of this file is
> preserved as the historical planning/audit record, so planning-era wording
> that survives in it ("proposed", "nothing here is implemented", the §12
> safety/changes statement, and the closing "Awaiting review" note) describes
> the state **at planning time**, not the current state. Production rollout is
> owned by `AFLDB-ISSUE-084`; see the ISSUE-084 handoff table and the
> post-implementation corrections section below.
>
> **Revision 2** applied the first review: extract-aware collision audit (§7),
> version-aware schema profiles (§7.2), `captaincies` removed from implementation
> scope (§2.2, §6), admin create always refuses (§5.2), narrowed preflight API
> (§8.1), ISSUE-081 kept separate (G3), G1 made an execution gate (G1), G5
> severity left open (G5), and a corrected path count (§1).
>
> **Revision 5** completes the final bounded verification: a complete honour-team
> identity **writer inventory** with source evidence (§2.4b) — implementation
> scope **unchanged**; the advisory-lock protocol **frozen** to one cross-language
> two-integer form (§5.3); and lock validation required **under the real runtime
> roles** rather than `afldb_owner`, with the privilege claim made conditional on
> that proof (§8.4, §9.4b, handoff).
>
> **Revision 4** applied five bounded corrections: the honour-team identity policy
> becomes a five-case semantic matrix that preserves ISSUE-025/migration-059
> (two distinct linked people may share a display name in one team) and is applied
> to both writers (§4.3, §5.2, §8.2, §9.3, §9.4); the out-of-scope reload-key
> refusal becomes **opt-in** rather than a universal `reload_keyed` invariant
> (§8.1b); the migration-059 semantic key is made concurrency-safe with a
> transaction-scoped advisory lock shared by both writers (§5.3); the
> missing-source failure mode is described correctly (§8.1d); and the Profile-B
> audit is placed inside ISSUE-084's deployment sequence (§7.2, G1, handoff).
>
> **Revision 3** applied the two prior amendments: the Plane B keyset is pinned to
> a recorded artifact digest, code revision and normalised-key fingerprints, with
> an explicit staleness rule and an explicit statement of the source-keyed
> ownership assumption plus its verified owner/domain pairs (§7.1, §7.3, §7.4,
> G1, ISSUE-084 handoff); and `createHonourTeamMember`'s duplicate refusal covers
> **both** semantic identity axes, because removing the upsert clause alone would
> turn a silent overwrite into a silent duplicate under migration 059's partial
> indexes (§5.2, §8.3, §9.4).

---

## Post-implementation corrections (2026-08-23, independent review)

An independent read-only review of the completed implementation reported no
blocking correctness findings. Two bookkeeping corrections are recorded here so
`AFLDB-ISSUE-084` can execute from this file and `issues.md` alone.

### Correction 1 — Profile-B evidence baseline and the corrected staleness rule (H1)

The Profile-A audit's Plane B was generated **before** the ISSUE-080
implementation. Its complete recorded baseline, so ISSUE-084 never depends on
opening the untracked scratchpad JSON to know the original comparison values:

| Baseline evidence | Value |
|---|---|
| Legacy SQLite artifact SHA-256 | `a56fef4e79f3583a5dfa773190412abd4b4a3eca347a8ec95de6d1b960eac547` |
| Plane-B code HEAD | `9b628612cac7ac185be347314b270795a5ce1543` |
| `common.py` baseline blob | `579e129b20ebf1cb6ae74f7c4e938e4168aaf2f3` |
| `import_awards.py` baseline blob | `b19ea80af85e4b9be1724db4b579281aba1537e1` |
| Hall of Fame incoming-key fingerprint | `bcb0c3d609eb9d6251d22488d63ca86fb9f0e998ddec42d076e7e713a3e6bcc7` |
| Honour-team incoming-key fingerprint | `4a9710b29118f62bd8fb78178e7698513c0a44e5686016be088d04f784777110` |
| Hall of Fame counts | read 343, skipped 0, emitted 343, distinct 343, duplicate keys 0 |
| Honour-team counts | read 113, skipped 0, emitted 113, distinct 113, duplicate keys 0 |

**The pre-fix code HEAD and blob IDs are reproducibility/provenance pins, not
an equality requirement for the post-ISSUE-080 deployment candidate.** Earlier
wording in §7.1, §7.4 and the ISSUE-084 handoff read as if *any* change to the
recorded code revision voids Profile B — which the deployment candidate can
never satisfy, because ISSUE-080 itself necessarily changes `common.py` and
`import_awards.py`. The corrected rule (which supersedes any stricter reading
elsewhere in this file):

1. ISSUE-084 must rerun Plane B using the **exact deployment-candidate code**
   and the **exact canonical SQLite artifact selected for the production
   reload**.
2. The rerun records its own code HEAD/revision, relevant code blob IDs,
   artifact SHA-256, read/skipped/emitted/distinct counts, duplicate-key
   result, and both (HoF and honour-team) key fingerprints.
3. The pre-fix HEAD/blob IDs above remain historical provenance only. A changed
   whole-file `common.py` or `import_awards.py` blob does **not** by itself
   invalidate Profile B.
4. The operative comparison is: (a) canonical legacy artifact identity, and
   (b) regenerated incoming natural-key counts/fingerprints.
5. If the canonical artifact SHA-256 changes, **STOP** and redo the
   Plane-A × Plane-B classification.
6. If incoming counts or fingerprints change, **STOP** and redo the
   Plane-A × Plane-B classification.
7. If normalisation, skip rules, or natural-key derivation themselves changed,
   the newly generated Plane-B keyset becomes authoritative and the
   classification must be redone rather than waived.
8. Do not informally approve a mismatch.

The existing audit artifacts (`scratchpad/issue-080-planea-prod-20260823.txt`,
`scratchpad/issue-080-planeb-dev-20260823-v2.json` and the preserved failed-run
artifacts) are unchanged by this correction.

### Correction 2 — migration 059 is a load-bearing deployment prerequisite (M4)

The honour-team raw-input preflight intentionally classifies collisions using
the **incoming row's raw `player_id`, before any player-link decision replay**
(§8.1b). A replayed decision can later change an in-scope row's effective
`player_id`. Therefore `059_honour_team_member_identity.sql` — specifically its
linked-player uniqueness protection — is a safety-critical final database
backstop, and the ordering is load-bearing, not incidental:

- Migration **059 must already be applied** before the corrected
  `import_honour_teams` loader is permitted to run.
- `honour_team_linked_player_uq` is the final fail-closed backstop if decision
  replay would create duplicate `(team_name, player_id)` identity after the
  raw-input preflight has passed.
- **If migration 059 is absent, STOP.** Do not run the corrected production
  honour-team reload on a pre-059 schema.

This tightens the "Ordering relative to migrations 058–070" answer in the
ISSUE-084 handoff table: within ISSUE-084's existing sequence (migrations
before loaders) it is automatically satisfied, but it must hold even if that
sequence is ever re-ordered.

### Accepted residual operational risk (M3)

There is deliberately **no in-app remedy** for an admin/source honour-team
collision: the intended behaviour is fail-closed, so a conflicting foreign or
admin-created row may block the source reload pending curator/operator
resolution (direct SQL or a future product decision). This is accepted under
ISSUE-080; no editor/delete/remediation workflow is designed here.

---

## Context

A source reload is supposed to reconcile the rows *its own source* supplies. In
`import_awards.py` several reloads instead reconcile a population defined by
domain (award id) or by nothing at all (the whole table). Any row inside that
population whose key is absent from the incoming extract is classified as
"vanished" and deleted — including rows created by an administrator or promoted
from an entirely different source.

ISSUE-080 was raised for the two natural-key honours loaders. This investigation
proves the same defect on three further reload paths, one of which destroys rows
created through a shipped admin screen.

---

## 1. Executive conclusion

**Ledger premise: confirmed for `hall_of_fame` and `honour_team_members`, and
materially incomplete beyond them.** Everything the ledger states about the two
honours loaders is verified in the current tree. Its explicit exclusion of the
other awards loaders is **wrong**, and the error is conceptual, not clerical.

**The conceptual correction, which the runbook must carry:**

> `(source_id, source_record_id)` identifies a row. It does **not** define which
> existing rows a source reload owns. Ownership is established only by
> constraining the **reconciliation population** — `reload_keyed`'s `scope_*`
> predicate — not by the shape of the key. A row with a key the incoming extract
> can never produce is not thereby protected; it is precisely the row the DELETE
> step classifies as vanished.

**First wrong layer:** Import/ETL ownership scoping — a loader reconciles rows it
does not own.

**Scope of the eight reload paths in `import_awards.py`:**

| Classification | Count | Paths |
|---|---|---|
| **Proven cross-owner loss — implemented under ISSUE-080** | **5** | `import_hall_of_fame`, `import_honour_teams`, `import_awards` (legacy winners), `import_all_australian`, `import_rising_star` |
| **Structurally unsafe, no second owner proven — NOT implemented here** | **1** | `import_captaincies` |
| **Proven unaffected** | **2** | `import_awards` (definitions), `import_under_22` |

Three tables are touched by the implementation: `hall_of_fame`,
`honour_team_members`, `award_winners` (two paths) and `award_nominations` —
four tables across five paths.

**Recommended ownership model:** every affected reload restricts its existing-row
population to `source_id ∈ {sources it owns}`, **in conjunction with** any
legitimate domain predicate it already has. Source scope is added to domain
scope; it never replaces it. This is the model `import_under_22` and
`import_draft.py` already use correctly.

**Recommended Hall of Fame collision policy:** **detect and refuse before any
write** — a fail-closed preflight naming both row ids. Do not adopt the admin row
into source ownership; do not re-scope `hall_of_fame_name_uq`.

**Recommended honour-team collision policy:** the same fail-closed preflight,
plus an explicit linked-identity check. On the **development** schema (migration
059) the preflight is *mandatory*: one collision shape produces a silent
duplicate no constraint catches. On the **production** schema (migration 057) the
same shape is refused by `honour_team_uq` — see §7.2 for why this difference
matters to the audit.

**Recommended admin-side policy:** a create operation refuses when the fact
already exists, applying the **§4.3 semantic matrix** on
`(team_name, player_name_raw)` and refusing unconditionally on
`(team_name, player_id)`, for **every** ownership class, directing the
administrator to the edit workflow. Crucially the matrix **permits** a second,
differently-linked player sharing a display name — collapsing those would regress
ISSUE-025 and migration 059. No ownership inference from NULL, no silent
create→edit, no false `oldValues: {}` creation audit. Removing `ON CONFLICT … DO
UPDATE` alone is **not** sufficient: under 059's partial indexes it would replace
a silent overwrite with a silent duplicate.

**Concurrency:** the two mixed linked/unlinked cases have no unique-index
backstop after migration 059, so check-then-insert under `READ COMMITTED` is not
enough. Both writers take a **transaction-scoped advisory lock** over the
`honour_team_members` key space, on one frozen two-integer protocol (§5.3). No
global serialisation, no migration.

**Writer inventory: implementation scope is unchanged.** Every path that can
write `team_name` / `player_name_raw` / `player_id` or flip a row's linked state
was enumerated (§2.4b). The data editor **cannot touch this table** —
`EDITABLE_ENTITIES` registers only `players`, `matches`, `draft_picks` — and
`applyLockedLink` performs unlinked→linked transitions only, which provably
cannot produce the unbacked mixed case and whose one reachable collision is
fully backed by `honour_team_linked_player_uq`. So the two participating writers
remain `createHonourTeamMember` and `import_honour_teams`, with a recorded
forward constraint on ISSUE-082.

**Migration required: NO.** ISSUE-080 is code-only. `source_id` already exists on
every affected table; `manual_admin_edit` already exists as a source
(migration 057). No schema change, no backfill, no privilege reconciliation.

**Recommended severity: High, unchanged — but the summary must be rewritten.**
`createAwardWinner` is a shipped admin path whose rows are deleted by a routine
legacy reload, which is a larger live exposure than the honours tables (0 rows on
dev, production unaudited).

---

## 2. Verified current state

### 2.1 Ownership map — every reload path in `import_awards.py`

Located by symbol, not by ledger line numbers. Line numbers are current at the
time of writing and are for navigation only.

| Target | Loader / call | Domain scope today | Provenance scope today | Other legitimate writer | Classification |
|---|---|---|---|---|---|
| `awards` | `import_awards` (definitions), `import_awards.py:369` | `slug <> ALL(22under22)` | — | none | **Not affected** |
| `award_winners` | `import_awards` (legacy winners), `:433` | `award_id <> ALL(u22, all-australian)` | **none** | `createAwardWinner` → `manual_admin_edit` | **Proven affected** |
| `award_winners` | `import_all_australian`, `:538` | `award_id = all-australian` | **none** | ingest `all_australian` dataset → `sports_data_lab` | **Proven affected** |
| `award_winners` | `import_under_22` (bespoke DELETE), `:807` | `award_id = u22` | `source_id = wikipedia_22under22` ✅ | — | **Not affected — positive precedent** |
| `award_nominations` | `import_rising_star`, `:926` | `award_id = rising-star` | **none** | ingest `rising_star` dataset → `sports_data_lab` | **Proven affected** |
| `hall_of_fame` | `import_hall_of_fame`, `:982` | **none (whole table)** | **none** | `createHallOfFameInductee` → `source_id NULL` | **Proven affected** |
| `honour_team_members` | `import_honour_teams`, `:1031` | **none (whole table)** | **none** | `createHonourTeamMember` → `source_id NULL` | **Proven affected** |
| `captaincies` | `import_captaincies`, `:1084` | **none (whole table)** | **none** | **none proven** | **Structurally unsafe / latent — out of implementation scope** |

### 2.2 Proof chains

**`award_winners` / legacy winners reload — proven affected.**
`import_awards.py:441` passes
`scope_column="award_id", scope_values=other_group_awards, scope_exclude=True`,
where `other_group_awards` is `[22under22 id, all-australian id]` (`:386-389`).
`createAwardWinner` (`src/db/queries/awards-admin.ts:124-200`) resolves the
`manual_admin_edit` source, generates `source_record_id = 'award_winner:<uuid>'`,
and inserts with that provenance. It refuses only the Brownlow (`:118`), so a
manual winner can carry any other `award_id` — inside the exclusion scope. Its
`(manual_admin_edit, award_winner:<uuid>)` key never occurs in the incoming
draftguru extract. The DELETE at `common.py:543-550` therefore removes it. If
that row carries a `player_link_resolutions` decision, the ISSUE-044
classification query (`common.py:420-434`, scoped by the same clause) instead
raises `LinkDecisionLoss` and aborts the whole reload. Identical double failure
mode to the honours case.

**`award_winners` / All-Australian reload — proven affected.**
`import_all_australian` scopes `award_id = ANY([all-australian])` (`:546`) and
supplies rows under **two** source ids — `draftguru` (`:510`) and `wikipedia`
(`:532`). The ingest pipeline promotes the `all_australian` dataset
(`src/lib/ingest/datasets.ts:325-390`, `awardSlug: 'all-australian'`) under
`sports_data_lab` (`src/lib/ingest/pipeline.ts:271`) with
`source_record_id = '<season>:<player>:<club>'`. Those rows are inside the
award-id scope, are never produced by either legacy extract, and are deleted.

**`award_nominations` / Rising Star reload — proven affected.**
Writer: `datasets.ts:222-320`, `key: 'rising_star'`, `awardSlug: 'rising-star'`,
inserting `source_id = sports_data_lab`, `source_record_id = row.source_key`
(from the uploaded CSV). Reload: `import_rising_star` (`:926`) scopes
`award_id = ANY([rising-star])`, extract source `footywire` (`:894`). The
promoted row is in scope, its key is absent from the footywire extract, it is
deleted. A record-id string shared between the two sources does not rescue it —
`_key_match` requires both key columns and `source_id` differs.

**`captaincies` — structurally unsafe, NOT proven affected, and NOT implemented
under ISSUE-080.**
`import_captaincies` (`:1084`) passes no `scope_column`, so `_scope_clause`
returns `TRUE` and the reconciliation population is the entire table. But the
only writer of `captaincies` in the tree is this importer: it is absent from the
`data_edits` allowlist (migration 058), absent from `src/lib/ingest/datasets.ts`,
and has no admin mutation in `src/db/queries/`. **A second legitimate ownership
population cannot be shown to exist**, so this does not meet the issue's evidence
threshold. It is retained in §6 as a structural hardening observation and
recommended as a separate issue. No loader change, no fixture, no claim of
implementation under ISSUE-080.

**`awards` (definitions) — proven not affected.**
The `awards` table has **no `source_id` column at all** (migration 005), so
provenance is inexpressible, and the only writer in the tree is
`import_awards.py:726`. A second ownership population cannot exist.

**`import_under_22` — correctly scoped, precedent.**
Its bespoke DELETE (`:806-812`) is
`WHERE award_id = %s AND source_id = %s AND (source_record_id IS NULL OR source_record_id <> ALL(%s))`
— domain **and** provenance, conjoined. The conjunction is the intended model,
not an invention of this issue.

### 2.3 Schema — identity, ownership and linking

**`hall_of_fame`** (migration 005:139, 042:90)

| Aspect | Fact |
|---|---|
| Surrogate id | `id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY` |
| Reload key | `(name, inducted_year)` — natural; no source record id exists |
| Unique constraints | `hall_of_fame_name_uq UNIQUE NULLS NOT DISTINCT (name, inducted_year)` — **global, not source-scoped** |
| `source_id` | `smallint REFERENCES sources(id)`, **nullable** |
| `source_record_id` | **does not exist** |
| `player_id` | `integer REFERENCES players(id)`, nullable |
| Link status | `link_status_value link_status NOT NULL` |

**`honour_team_members`** (migration 005:160, 059)

| Aspect | Fact (development schema, migration 059 applied) |
|---|---|
| Surrogate id | `id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY` |
| Reload key | `(team_name, player_name_raw)` |
| Unique constraints | migration 059 **dropped** `honour_team_uq` and replaced it with two **partial** unique indexes: `honour_team_linked_player_uq (team_name, player_id) WHERE player_id IS NOT NULL` and `honour_team_unlinked_name_uq (team_name, player_name_raw) WHERE player_id IS NULL` |
| `source_id` | `smallint REFERENCES sources(id)`, **nullable** |
| `source_record_id` | **does not exist** |
| `player_id` | `integer REFERENCES players(id)`, nullable |

**Consequence, and the ledger's second error:** because both indexes are
*partial*, a linked row and an unlinked row sharing `(team_name,
player_name_raw)` violate **neither**. The reload key is unbacked for linked
rows. §4.3 shows the collision this permits. On the migration-057 production
schema the total `honour_team_uq` is still in force and this shape is refused —
§7.2.

**`award_winners` / `award_nominations` / `captaincies`** (migrations 005, 023,
042, 044)

- `award_winners_source_uq` / `award_nominations_source_uq` /
  `captaincies_source_uq`: `UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)`.
- `uq_award_winners_source` / `uq_award_nominations_source` (migration 023, kept
  deliberately by 044:280-301): `UNIQUE (award_id, source_record_id) WHERE
  source_record_id IS NOT NULL` — **award-grained and source-blind**, and the
  live `ON CONFLICT` arbiters for the two ingest promotions.
- `captaincies_natural_uq UNIQUE (season, club_id, player_name_raw, role)` —
  **fact-grained and source-blind**.

### 2.4 Admin creation paths (verified, not inferred)

| Function | File | Provenance written | Conflict behaviour |
|---|---|---|---|
| `createAwardWinner` | `src/db/queries/awards-admin.ts:83` | `source_id = manual_admin_edit`, `source_record_id = 'award_winner:<uuid>'` | none — a duplicate is a raw constraint error |
| `createHallOfFameInductee` | `awards-admin.ts:228` | **no `source_id`** → NULL | none — a `(name, inducted_year)` duplicate is a raw `hall_of_fame_name_uq` error |
| `createHonourTeamMember` | `awards-admin.ts:299` | **no `source_id`** → NULL | **`ON CONFLICT … DO UPDATE`** on whichever partial index applies |

All three write a `data_edits` audit row in the same transaction
(`recordDataEdit`). Note that `createHonourTeamMember`'s conflict arbiters —
`(team_name, player_id) WHERE player_id IS NOT NULL` and `(team_name,
player_name_raw) WHERE player_id IS NULL` — are **migration 059 objects**. On the
migration-057 production schema neither arbiter exists, so **both branches of
this admin action would fail outright on production today**. That is a strong
prior for the audit's expected findings and is listed as an explicit schema-gate
observation in §7.2, not assumed.

### 2.4b Honour-team identity writer inventory — complete, with evidence

The migration-059 invariant protects `team_name`, `player_name_raw` and
`player_id`. Every path that can write those columns, or convert a row between
linked and unlinked identity states, was enumerated. **The inventory does not
change implementation scope**, but the reasoning must be recorded because a
future change to any of it reopens the question.

| Writer | Can it write `team_name` / `player_name_raw` / `player_id`? | Can it create the migration-059 collision? | Action |
|---|---|---|---|
| `createHonourTeamMember` (`awards-admin.ts:299`) | yes — INSERT, all three | **yes**, both axes including the unbacked mixed case | participates: matrix + lock (§5.2, §5.3) |
| `import_honour_teams` (`import_awards.py:1031`) | yes — INSERT/UPDATE/DELETE, all three | **yes**, both axes including the unbacked mixed case | participates: matrix + lock (§8.1b, §5.3) |
| **Data editor** (`applyDataEdit`, `data-edits.ts:127-190`) | **no — it cannot touch this table at all** | no | **no change required** |
| `applyLockedLink` (`player-links.ts:301-334`) | `player_id` + `link_status_value` only; unlinked→linked only | **no** — proof below | **no change required**; recorded as a forward constraint |

**The data editor cannot edit `honour_team_members`.** `EDITABLE_ENTITIES`
(`src/lib/edit/spec.ts:58`) registers exactly three entities — `players`,
`matches`, `draft_picks` — and `applyDataEdit` dispatches only to
`applyPlayerEdit`, `applyDraftPickEdit` and `applyMatchEdit`
(`data-edits.ts:172-178`), so an unregistered entity cannot reach a write at all.
Migration 058 widened the `data_edits.table_name` CHECK to include
`hall_of_fame` / `honour_team_members` / `award_winners` because the **creation**
functions write audit rows under those table names via `recordDataEdit`, **not**
because the editor edits those tables. The approved create-refusal message must
therefore direct the administrator to the correct existing workflow, and "the
data editor" is not it for this table — §8.3.

**`applyLockedLink` cannot create the unbacked collision.** Its generic branch is
`UPDATE <target> SET player_id = …, link_status_value = 'resolved' WHERE id = …`,
so it never writes `team_name` or `player_name_raw`, and it only moves a row
**unlinked → linked**. The mixed same-name case requires one linked and one
unlinked row sharing `(team_name, player_name_raw)`; linking cannot produce that
pair, because to produce it there would have to be two unlinked rows sharing the
key first, and `honour_team_unlinked_name_uq` forbids exactly that. The only
collision it can reach is `(team_name, player_id)`, which
`honour_team_linked_player_uq` backs completely and fails closed on — including
under concurrency, where two `resolveLink` calls locking two *different* target
rows are arbitrated by the index rather than by `lockUnresolvedTarget`. It
therefore does not join the §5.3 protocol.

> **Forward constraint on AFLDB-ISSUE-082.** This proof depends on there being no
> admin path that moves an honour-team row **linked → unlinked**. `confirmUnlinked`
> is audit-only today and writes nothing to the target. If ISSUE-082's fix ever
> makes it (or any successor) write `player_id = NULL` back to
> `honour_team_members`, that path **creates** the unbacked mixed case and must
> join the §5.3 matrix and lock protocol. Record this in ISSUE-082 when
> ISSUE-080 lands.

This check is **write-time semantic identity integrity**, and is settled here. It
is *not* gate G5: G5 concerns durability/reversion of source-owned edits after a
reload, which is a different question and remains separate.

Migration 058's allowlist entry is also why gate **G5** exists at all — but note
that for `honour_team_members` specifically there is no editor path to revert, so
G5's evidence-gathering applies to `award_winners` and any entity later
registered, not to this table today.

### 2.5 `reload_keyed` — exact scoped semantics (`tools/migration/common.py:321`)

`_scope_clause(alias, scope_column, scope_values, scope_exclude)` (`:294`) emits
**one** predicate over **one** column:

- `scope_column is None` → `TRUE` (whole table).
- empty `scope_values` → `FALSE` when including, `TRUE` when excluding.
- otherwise `e.<col> = ANY(%s)` or `e.<col> <> ALL(%s)`.

It is applied as `scope_e` to the **existing** table alias `e` only. Incoming
rows are never filtered.

| Step | Location | Scope applied? | Effect |
|---|---|---|---|
| Duplicate incoming-key check | `:382-398` | n/a | `RuntimeError` on duplicated incoming keys. Nothing written. |
| Decision snapshot `_afldb_decisions` | `:404-412` | **no** | `DISTINCT ON (target_id)` latest decision for the whole `target_table`. |
| Decision classification | `:420-434` | **yes** | Out-of-scope rows are **not classified**. |
| `LinkDecisionLoss` | `:468-475` | inherits classification | Raised only from in-scope rows. |
| Decision carry-over onto `_incoming` | `:488-499` | **yes** | |
| UPDATE | `:520-527` | **yes** | In-scope rows only. |
| INSERT | `:530-539` | **yes, inside `NOT EXISTS`** | An incoming key matching only an **out-of-scope** row is **not suppressed** — it reaches INSERT and is decided by the database's constraints. |
| DELETE | `:542-551` | **yes** | In-scope rows only. |
| Transaction | caller | — | The loader commits after the call; any raise leaves the reload unwritten. |

**Answers to the required questions:** the reconciliation population is exactly
the rows satisfying `scope_e`; keys are computed only from scoped rows for
UPDATE/DELETE/classification, and the INSERT suppression test is *also* scoped
and therefore **blind** to out-of-scope rows; unscoped rows cannot participate in
key matching, which is the hazard rather than a safeguard; an incoming key
colliding with an unscoped row **can** reach INSERT and fail a constraint;
duplicate incoming keys raise before any write; a raise leaves nothing committed.

**Key equality.** `_key_match` (`:314-318`) compares with `IS NOT DISTINCT FROM`
per column, so NULL matches NULL. This matters twice: it is the semantics any
preflight must reuse (§8.1), and it is why the source-presence guard (§8.1d) is
load-bearing — a `sources.get()` miss would emit `source_id = NULL` on every
incoming row, which `IS NOT DISTINCT FROM` would then match against stored
NULL-source rows.

**ISSUE-044 decision handling under scope.** Decisions are loaded for the whole
`target_table`, then filtered by scope through the join at `:428-432`. A decision
on an **out-of-scope** row is never classified: not preserved, not reported as a
disagreement, not counted as discarded, and it **cannot raise
`LinkDecisionLoss`**. Its row is untouched, so its `target_id` stays valid.
`linked` is reapplied as `player_id = i._dec_player`, status `resolved`;
`confirmed_unlinked` as `player_id = NULL`, status `i._dec_status` (`:507-516`).
Disagreement is reported when the incoming row names a different player than a
`linked` decision, or names any player against `confirmed_unlinked` (`:452-466`);
the admin wins in both cases. `--allow-link-loss` has **no interaction with
out-of-scope rows** — they never enter the discarded set. That is the mechanism
by which scoping makes the flag irrelevant to admin-owned rows.

**Composition limitation — proven.** `_scope_clause` expresses one predicate over
one column. Two affected loaders need a conjunction:

- legacy winners: `award_id <> ALL(u22, all-australian) AND source_id = ANY(draftguru)`
  — source scope alone is unsafe, because `import_all_australian` writes
  draftguru-sourced rows under the All-Australian award that the legacy reload
  must keep out of;
- All-Australian: `award_id = ANY(all-australian) AND source_id = ANY(draftguru, wikipedia)`.

Weakening the award-family isolation to add source scoping is unacceptable, so
the helper must gain a conjunction (§8.1a).

---

## 3. Premise corrections

| # | Premise | Verdict |
|---|---|---|
| P1 | "`award_winners`, `award_nominations` and `captaincies` key on `(source_id, source_record_id)`, so a NULL-source row is already outside their reload key space" | **Wrong, and conceptually so.** Key space ≠ reconciliation ownership. Being unmatchable by key is what makes a row a DELETE candidate, not what protects it. |
| P2 | "The other four honours loaders are unaffected" | **Wrong.** Three further paths are proven affected. Only `under_22` and the `awards` definitions reload are genuinely unaffected; `captaincies` is unscoped but has no proven second owner. |
| P3 | "`honour_team_members` has no equivalent problem: migration 059 already replaced its table-wide constraint with two partial unique indexes" | **Wrong on the development schema, and the opposite of reassuring.** Partial indexes mean one post-scoping collision produces a **silent duplicate** (§4.3). Its collision policy is *more* urgent, not less. On migration 057 the total constraint still applies — §7.2. |
| P4 | The admin function is `createHallOfFameEntry` | **Stale name.** It is `createHallOfFameInductee`. |
| P5 | "Both admin inserts omit `source_id`" | **Confirmed** for the two honours creators. But `createAwardWinner` **does** stamp `manual_admin_edit`. Admin provenance is already inconsistent across the three. |
| P6 | Admin creation of an honour-team member cannot mutate a source row | **False.** `createHonourTeamMember` uses `ON CONFLICT … DO UPDATE`; colliding with a Wikipedia-owned row silently overwrites that row while leaving `source_id = wikipedia`, so the next reload reverts the admin's work with no error at either end (`awards-admin.ts:329-368`). |
| P7 | Scoping the honours loaders to `source_id` is a self-contained change | **Incomplete.** True for the two honours loaders; false for the newly proven paths, where `_scope_clause` cannot express the required conjunction. |
| P8 | The ledger's audit query selects `r.match_method` from `player_link_resolutions` | **Would fail on production.** `match_method` is added by **migration 067**; production is at **057**. |
| P9 | Ledger audit query 4 (source-less vs source-owned `(name, inducted_year)` join) settles the Hall of Fame collision set | **Insufficient — the central review finding.** A stored-state join can only find collisions that *already coexist*, and `hall_of_fame_name_uq` largely forbids coexistence. The dangerous state is a foreign-owned row occupying key K with **no** source-owned row for K, where the *incoming extract* carries K. Only comparison against the extract detects it (§7). |
| P10 | `afldb_dev` exposure figures (343 / 113 rows, 0 source-less) | **Accepted as recorded, not re-verified.** They cover only the two honours tables and say nothing about `award_winners`, where the live admin path is. |
| P11 | Prompt: "the ownership fix should not require a schema change" | **Confirmed.** No migration is required for any affected table. |
| P12 | `createHonourTeamMember` works on production today | **Doubtful.** Both of its `ON CONFLICT` arbiters are migration-059 objects and production is at 057, so both branches would fail. Stated as an audit assertion, not an assumed fact (§7.2). |

---

## 4. Collision analysis

Scoping introduces a collision surface because out-of-scope rows remain in the
table and are invisible to the INSERT suppression test (§2.5). Behaviour below is
stated for the **development** schema unless noted; §7.2 gives the migration-057
differences.

### 4.1 Hall of Fame — foreign-owned row vs incoming source row on `(name, inducted_year)`

- **Does the constraint permit both?** No. `hall_of_fame_name_uq` is
  `UNIQUE NULLS NOT DISTINCT (name, inducted_year)` with no `source_id`
  component.
- **Today:** the unscoped reload UPDATEs the foreign row in place to the source's
  values and stamps `source_id = wikipedia` — silent ownership transfer — or, if
  the row carries a decision and the key genuinely vanished, aborts. The
  collision is *hidden* by the table-wide reload.
- **After scoping, unfixed:** the foreign row is out of scope, the INSERT is not
  suppressed, PostgreSQL raises a unique violation, the transaction rolls back.
  Fail-closed but opaque — a raw constraint name, no row ids.
- **Proposed:** fail-closed **preflight** before any write, naming table, key,
  the out-of-scope row id and its owning source, and the required human action.
  The constraint remains the concurrency backstop.
- **Rejected:** *adopt into source ownership* silently transfers provenance and
  erases the fact a human curated the row; *re-scope the constraint* weakens
  exactly the guarantee migration 042 was written for — one inductee, one row,
  regardless of paperwork.

**Reverse direction — admin creates a fact the source already owns.**
`createHallOfFameInductee` has no `ON CONFLICT`, so it already fails closed.
Correct policy, poor message; improving the message is optional (§8.3).

### 4.2 Honour teams — foreign row and incoming row both unlinked

`honour_team_unlinked_name_uq` applies to both; coexistence refused; raw unique
violation after scoping. Preflight gives the same outcome with a usable message.

### 4.3 Honour teams — the semantic identity matrix (raw-name axis)

Stored foreign-owned row `(T, N)` and incoming source row `(T, N)` share the
reload key. **A raw-name match is not automatically a collision.** Migration 059
deliberately stopped treating raw name as identity (ISSUE-025), and two distinct
linked people with the same displayed name in the same honour team must remain
representable. The correct rule is therefore case-analytic, not a blanket refusal:

| Existing row | Incoming / proposed row | Policy | Why |
|---|---|---|---|
| unlinked | unlinked | **refuse** | identity unknown on both sides; a name match is the only evidence there is, and duplicating it is indefensible |
| unlinked | linked **P** | **refuse — explicit review** | ambiguous: the unlinked row may *be* P, or may be someone else entirely. A human must decide before either duplicating or adopting |
| linked **P** | unlinked | **refuse — explicit review** | same ambiguity, mirrored |
| linked **P** | linked **P** | **refuse** | the same identity asserted twice in one team |
| linked **P** | linked **Q**, `P ≠ Q` | **allow coexistence** | identity is *positively known* on both sides and known to differ. Collapsing them on raw-name equality would reintroduce exactly the defect migration 059 fixed |

The governing principle: **a raw-name match is ambiguous identity whenever either
side is unlinked; once both sides are positively linked to different player ids,
identity is known to be distinct and raw-name equality must not collapse them.**

**Database backstop status.** `honour_team_unlinked_name_uq` covers only the
first row of the matrix (both unlinked). The two mixed rows have **no complete
database backstop** after migration 059 — `honour_team_linked_player_uq` does not
apply to the unlinked side and `honour_team_unlinked_name_uq` does not apply to
the linked side — so an unguarded INSERT would silently duplicate a person. Those
two cases are guarded only by the explicit check, on both writers, and that check
needs concurrency protection (§5.3).

On the migration-057 production schema the total `honour_team_uq` refuses **every
row of this matrix**, including the last — see §7.2.

### 4.4 Honour teams — the linked-identity axis, `(team_name, player_id)`

Independent of raw name: an existing row and an incoming/proposed row with the
**same `team_name` and the same non-NULL `player_id`** always refuse, whatever
their `player_name_raw` variations. This is the axis migration 059 made
authoritative, and `honour_team_linked_player_uq` is its database backstop.

The two axes are complementary, not alternatives: axis 4.3 catches same-name
ambiguity the identity index cannot see, and axis 4.4 catches same-identity
duplication the name index cannot see.

**Reverse direction — admin creates a member the source already owns.** Confirmed
defect P6. Policy in §5.2.

### 4.5 Source-keyed tables — `award_winners`, `award_nominations`

Scoping these does **not** create a `*_source_uq` collision: an incoming
`(draftguru, …)` key cannot equal a stored `(manual_admin_edit, …)` or
`(sports_data_lab, …)` key. Two rows for the same real-world fact under different
provenance **coexist legitimately** — that is what a source-record key is for,
and it is the intended outcome of the fix.

One residual cross-owner surface exists: `uq_award_winners_source` /
`uq_award_nominations_source` are `UNIQUE (award_id, source_record_id) WHERE
source_record_id IS NOT NULL`, **award-grained and source-blind** (migration
044:280-301). An incoming legacy record id equal to a promoted `sports_data_lab`
record id under the same award would violate it. The formats differ today
(`aa:1984:37` vs `1984:Robert Flower:Melbourne`), so this is **improbable and not
proven possible**. Per the review's narrowing instruction it is **left to the
database constraint as backstop** — the failure is already fail-closed and
rolls the reload back — and is recorded here as a residual risk rather than
built into the preflight. The production audit still reports the collision set
(§7.3) so the assumption is checked against real data rather than asserted.

### 4.6 `captaincies` — noted, not implemented

`captaincies_natural_uq UNIQUE (season, club_id, player_name_raw, role)` binds
the **fact**, source-blind by design (migration 042:69-74). If a second writer
ever appears, scoping `captaincies` would require declaring that key to a
preflight. No second writer is proven, so nothing is implemented here (§6).

### 4.7 Collision policy — recommendation

| Table | Policy | Enforced where |
|---|---|---|
| `hall_of_fame` | **Refuse and require explicit curator review.** Never adopt, never overwrite, never re-scope the constraint. | Preflight; `hall_of_fame_name_uq` as backstop |
| `honour_team_members` | **Apply the §4.3 matrix**, not a blanket reload-key refusal: refuse every same-name case except *linked P vs linked Q, `P ≠ Q`*, which must be **allowed to coexist**; and refuse unconditionally on the §4.4 linked-identity axis. Mandatory on the dev schema — the two mixed cases have no backstop. | Loader-local preflight (§8.1b check 2); partial indexes as backstop where they apply; advisory lock for concurrency (§5.3) |
| `award_winners` / `award_nominations` | **Coexistence across provenance is correct.** No preflight; the retained award-grained record-id index is the backstop for the improbable residual case. | Database constraint |

Justification: provenance must never move without a human deciding it; a
real-world fact asserted by two owners is either a genuine duplicate a curator
must merge or two legitimate records the schema already permits, and only the
schema knows which; public query behaviour must never show one person twice;
reloads must stay deterministic and idempotent; surrogate ids and manual
resolutions must stay valid; and where the two cannot be told apart
automatically, fail closed rather than guess.

---

## 5. Provenance decision

### 5.1 `source_id NULL` vs `manual_admin_edit` (approved: stamp new rows, no backfill)

| Criterion | `source_id NULL` | `manual_admin_edit` |
|---|---|---|
| Semantic clarity | ambiguous — "manual" or "unknown"? | asserts manual authorship |
| Consistency | inconsistent with `createAwardWinner` | matches it, and `match-admin.ts`, `data-edits.ts`, `datasets.ts` |
| Collision implications | none either way — scope is keyed positively on the loader's own sources | same |
| Query behaviour | reads as missing data | joins to a named source |
| Auditability | must infer from `data_edits` | self-describing |
| Loader scoping | works by exclusion | works, and keeps working if a `manual_admin_edit` reconciler ever exists |
| Migration/backfill | none | none, for new rows only |

**Recommendation (approved):** `createHallOfFameInductee` and
`createHonourTeamMember` stamp `manual_admin_edit`, resolved and required in the
same transaction exactly as `createAwardWinner` does
(`awards-admin.ts:124-129`, including the "Required source … is not configured"
failure). **No backfill.** Existing `source_id IS NULL` rows keep their honest
meaning: *provenance unknown*.

**The scoping fix does not depend on this.** Scope is expressed positively —
`source_id = ANY(<the loader's own sources>)` — so every row that is not the
loader's is out of scope regardless of what it carries. Provenance stamping is a
clarity improvement, not a load-bearing part of the fix.

### 5.2 Admin-side ownership boundary — **create always refuses** (approved G2)

The contract holds in both directions: *a source loader modifies only rows it
owns, and an admin create never modifies an existing row at all.*

**Policy:** `createHonourTeamMember` is a **create** operation. If the fact
already exists on **either** semantic identity axis, it refuses and directs the
administrator to the existing edit workflow. This applies **regardless of the
existing row's ownership** — `manual_admin_edit`, any other named source, or
`source_id IS NULL`.

**Removing `ON CONFLICT … DO UPDATE` is necessary but not sufficient after
migration 059.** Because 059's indexes are *partial*, PostgreSQL permits a linked
row and an unlinked row sharing `(team_name, player_name_raw)`, so deleting the
upsert clause alone would convert a silent overwrite into a silent **duplicate**.
The mutation must check both axes explicitly, before inserting — using **exactly
the §4.3 matrix and the §4.4 rule**, the same semantics the loader applies:

| Axis | Rule | Applies to |
|---|---|---|
| **1. Raw-name axis, `(team_name, player_name_raw)`** | apply the §4.3 matrix: refuse *unlinked/unlinked*, *unlinked/linked P*, *linked P/unlinked* and *linked P/linked P*; **allow** *linked P / linked Q where `P ≠ Q`* | every create |
| **2. Linked-identity axis, `(team_name, player_id)`** | refuse whenever the proposed row carries `player_id` and a row already exists with the same `(team_name, player_id)`, regardless of raw-name variation | creates that supply `player_id` |

**Axis 1 is deliberately not a blanket refusal.** An administrator must still be
able to add a second, genuinely different, positively-linked player who happens to
share a display name with someone already in that team — the exact capability
ISSUE-025 and migration 059 exist to preserve. Refusing on raw name alone would
regress it.

Both axes ignore provenance entirely. Where the matrix says refuse, the create
must not adopt, edit, overwrite or duplicate the existing record; it returns a
clear message **naming the existing entry** — team, player name, and whether it
is linked and to whom — so the administrator can see exactly what already
occupies the identity.

**The message must not promise a workflow that does not exist.** §2.4b
establishes that `honour_team_members` is **not** a data-editor entity, so there
is no in-app edit screen for these rows today. The refusal should therefore state
what exists and stop, rather than direct the administrator to a non-existent
editor. Whether an honour-team edit surface should be added is a separate product
question and is explicitly **not** part of ISSUE-080.

**Backstop status, recorded explicitly:** the database indexes are the
concurrency backstop **only where they apply** — `honour_team_unlinked_name_uq`
for the unlinked/unlinked case, `honour_team_linked_player_uq` for axis 2. **The
two mixed linked/unlinked cases have no complete database backstop after
migration 059** (§4.3, §7.2), so for those the application check is the only
guard — which is why §5.3 exists.

No `data_edits` lookup is required for any of these decisions.

### 5.3 Concurrency — the migration-059 semantic key needs an explicit lock

The two mixed cases have no unique index behind them, so a plain
*SELECT-then-INSERT* under `READ COMMITTED` is **not sufficient**: two concurrent
writers can each observe no conflict and each insert, producing exactly the mixed
linked/unlinked duplicate the check exists to prevent. This is a phantom-insert
problem, and the existing repository primitive does not cover it.

**What the current transaction model provides.** Production mutations run inside
`importSql.begin(...)` and take **row-level** locks: `lockUnresolvedTarget`
(`src/db/queries/player-links.ts:246-294`) issues `SELECT … FOR UPDATE` against
the target row, then re-checks it. That is correct for *mutating an existing row*
and structurally incapable of protecting a *creation* — `FOR UPDATE` cannot lock
a row that does not exist yet. The only advisory-lock precedent in the tree is
`tests/integration/draft-lock.ts`, which is session-scoped and belongs to the
test harness, not the product.

**Smallest safe mechanism: a transaction-scoped advisory lock over the
`honour_team_members` semantic key space**, taken by every ISSUE-080 writer that
can create the mixed collision, before its check and released automatically at
commit or rollback:

| Writer | Lock point | Notes |
|---|---|---|
| `createHonourTeamMember` | first statement inside `importSql.begin(...)`, before the axis checks | check and INSERT are then in one protected transaction |
| `import_honour_teams` | before its collision preflight, inside the transaction `reload_keyed` runs in and that `pg.commit()` closes | preflight, UPDATE, INSERT and DELETE are all inside the protected transaction |

#### The protocol, frozen

One exact cross-language protocol. These are requirements, not suggestions:

1. **Two-integer advisory-lock namespace with fixed documented constants** —
   conceptually `pg_advisory_xact_lock(<AFLDB namespace>, <honour_team_members
   identity-writer namespace>)`, and `pg_try_advisory_xact_lock(<the same two
   constants>)`. The exact numbers are chosen at implementation time and
   documented in one place per language, cross-referencing each other.
2. **Never hash a string independently in Python and TypeScript.** `hashtext`,
   language-level hashing, or any derived key computed twice is prohibited: the
   two implementations must contend on an **identical literal lock identity**,
   which only fixed integer constants guarantee.
3. **`import_honour_teams` uses the blocking transaction-scoped form**
   (`pg_advisory_xact_lock`). A batch job may wait.
4. **`createHonourTeamMember` uses the try transaction-scoped form**
   (`pg_try_advisory_xact_lock`) and, on `false`, returns a clear bounded failure
   — "an honours reload is in progress; try again shortly" — rather than blocking
   a web request behind a multi-minute reload.
5. **The lock is acquired before any semantic-collision SELECT or preflight.**
   Acquiring it after the check would leave the phantom-insert window open.
6. **The lock is held through the relevant INSERT / UPDATE / reconciliation,
   until commit or rollback.** Check and write are in one protected transaction.
7. **No session-scoped advisory lock.** `pg_advisory_lock` /
   `pg_advisory_unlock` must not be used: transaction scope releases on commit
   *and* rollback, so a failed preflight or a crashed request cannot strand it.
   The `draft-lock.ts` session form is a test-harness pattern and is wrong here.
8. **No per-row or per-team multi-lock acquisition** unless the table-scoped
   design is disproven. The importer reconciles every team in one transaction, so
   per-team locking would mean N locks in a data-dependent order — a deadlock
   source for no benefit. Per-team granularity is the fallback if admin
   contention ever becomes real, not the starting design.

> This intentionally serialises `honour_team_members` identity-changing writes
> against the honours importer. **It does not globally serialise AFLDB.** Nothing
> else takes this lock; reads are unaffected; every other table and every other
> mutation path is untouched.

#### Roles and privileges — to be proven, not assumed

Both participants connect through **the same DSN and therefore the same role**:
`createHonourTeamMember` opens `process.env.AFLDB_IMPORT_DATABASE_URL`
(`awards-admin.ts:309-312`) and `import_awards.py` requires the same variable
(`:1217`), so both run as `afldb_import`. `pg_advisory_xact_lock` is normally
executable by `PUBLIC`, but §9.4b **proves** this under the real runtime role
rather than assuming it.

**Conservative rule for any privilege conclusion.** Restricted-role validation
must **diagnose an actual observed failure** — the specific statement, the
specific role, and the specific PostgreSQL error — before anyone concludes that a
new grant or a `tools/maintenance/privileges.sql` change is required. A failing
test alone is not evidence of a missing privilege: the likelier causes are a test
harness or DSN misconfiguration, an incorrect lock constant, or a transaction
boundary that is not where it is assumed to be. Rule those out first. Only a
diagnosed privilege error justifies changing §8.4's conclusion, and then only by
adding exactly the grant the diagnosis names.

**No migration**, on this basis rather than by assumption: the existing schema
plus this transactional lock is sufficient. If validation shows the lock cannot
serialise both writers as designed, revisit the conclusion — gate **G8**.

`createHallOfFameInductee` does not need the lock: `hall_of_fame_name_uq` is a
total unique constraint and is a complete backstop for its only collision shape.

This removes, in one change:

- ownership inference from NULL;
- silent create→edit semantics;
- the false `oldValues: {}` creation audit (an overwrite recorded as a creation);
- **any need for a mutation-time `data_edits` read.** `data_edits` is used only
  by the read-only production audit (§7.3), never on the mutation path.

`createHallOfFameInductee` already has create/fail semantics via
`hall_of_fame_name_uq` and needs no behavioural change beyond the provenance
stamp; its error message may be improved for consistency with the honour-team
refusal, which is cosmetic and optional.

`createAwardWinner` remains unchanged: it has no conflict clause, and
`award_winner:<uuid>` makes a record-id collision effectively impossible. No
separate conflict defect was found in it.

---

## 6. Other-loader check

Performed narrowly, over `reload_keyed` callers and the writers of the tables
they reconcile.

- **Proven cross-owner loss, implemented under ISSUE-080 (5 paths, 4 tables):**
  `import_hall_of_fame`, `import_honour_teams`, `import_awards` (legacy
  winners), `import_all_australian`, `import_rising_star`.
- **Structurally unsafe, no second owner proven, NOT implemented:**
  `import_captaincies`. Recommend a **separate hardening issue** — "unscoped
  reconciliation on `captaincies` has no ownership predicate and would delete a
  foreign-owned row the day a second writer exists; scope it by construction, as
  ISSUE-078 did for `draft_persons`, and declare `captaincies_natural_uq` to
  whatever preflight ISSUE-080 leaves behind." Severity for that issue should be
  set on its own evidence, not inherited from ISSUE-080.
- **Proven unaffected:** `awards` definitions (no `source_id` column, single
  writer); `import_under_22` (already conjoined domain + provenance scope).
- **Outside `import_awards.py`:** `import_draft.py` (`:597`, `:647`) already uses
  `scope_column="source_id"` (ISSUE-078). `tools/records/import-first-kick-goal.ts`
  is scoped by `achievement_type AND source_id` (ISSUE-078). No action.
- **Observed, deliberately not widened:** data-editor UPDATEs of source-owned
  `award_winners` / `hall_of_fame` / `honour_team_members` rows are reverted by
  the next reload. Edit durability, not ownership deletion. Gate **G5**.

---

## 7. Production exposure audit design (read-only; **not** run, **not** generated)

No executable production SQL is produced in this session. What follows is the
specification a later preparation session must translate into reviewed SQL.

### 7.1 Two evidence planes

The central revision. A database-only audit **cannot** settle the natural-key
collision question, because existing uniqueness largely prevents the two rows
from coexisting in the first place (P9). The dangerous production state is:

> a foreign-owned row occupies natural key **K**; there is **no** source-owned
> row for K; the next canonical extract **contains** K. Today the unscoped reload
> UPDATEs/adopts that row. After scoping it becomes an INSERT that collides with
> an out-of-scope row.

So the audit compares two planes:

**Plane A — the production database (read-only).** Row inventory, provenance
counts, link decisions, `data_edits` evidence, and every stored-state collision
set.

**Plane B — the canonical incoming keyset.** Derived, without touching
production, from the legacy SQLite extract the loader itself consumes
(`AFLDB_LEGACY_SQLITE`, resolved at `import_awards.py:1190`):

| Loader | Extract table | Key expression, using the loader's own normalisation |
|---|---|---|
| `import_hall_of_fame` | `hall_of_fame` | `(clean_text(name), to_int(inducted_year))`, skipping rows where `clean_text(name)` is falsy (`import_awards.py:963-965`) |
| `import_honour_teams` | `team_selections` | `(clean_text(team_name), clean_text(name))`, skipping rows where either is falsy (`:1013-1016`) |

`clean_text` is `str(value).strip() or None`; `to_int` is
`int(round(float(value)))` with `None`/`""`/unparseable → `None`
(`common.py:90-113`). **The keyset must be derived with these exact
transformations** — a raw `SELECT name, inducted_year` from SQLite produces a
different key space and would misclassify rows. Comparison uses the same
NULL-equality `reload_keyed` uses (`IS NOT DISTINCT FROM` / Python `==` on
`None`).

**Plane B is derived offline** — read the canonical extract read-only, emit the
normalised keyset, and join it against the preserved Plane A output outside the
production database. Production is never written to, never receives a temp table,
and never sees the extract.

#### Plane B evidence requirements — the keyset must be pinned

Plane B is correct **only** for the exact canonical source snapshot and the exact
loader normalisation used to produce it. The audit artifact must therefore record
at minimum:

| Evidence | Detail |
|---|---|
| Source artifact digest | **SHA-256 of the exact `AFLDB_LEGACY_SQLITE` file used** |
| Source artifact identity | absolute path, file size, mtime, and how the snapshot was obtained |
| Code revision | the importer/repository revision whose `clean_text`, `to_int`, skip rules and key construction were used to normalise (`common.py:90-113`; `import_awards.py:963-965`, `:1013-1016`) |
| Hall of Fame keyset size | count of normalised incoming `(name, inducted_year)` keys after skips |
| Honour-team keyset size | count of normalised incoming `(team_name, player_name_raw)` keys after skips |
| Hall of Fame keyset fingerprint | deterministic hash of the **normalised keys** |
| Honour-team keyset fingerprint | deterministic hash of the **normalised keys** |

Each fingerprint is computed over a **deterministic ordering of the normalised
keys** — sort the normalised tuples, serialise them unambiguously (with an
explicit, distinguishable rendering for `None`), and hash that. It must **not**
be derived from raw SQLite rows: raw rows carry pre-normalisation text and row
order that say nothing about the key space the loader actually produces.

> **If the legacy source artifact or any relevant normalisation, skip or
> key-generation code changes after the audit, the incoming-key classification is
> stale and must be regenerated before a production reload is authorised.**

This applies with particular force to the **repeat audit inside ISSUE-084's
deployment sequence**: that run must re-derive Plane B from the artifact and
code revision actually being deployed and record its own full evidence set.
*(Corrected 2026-08-23 — see "Post-implementation corrections", Correction 1:
the recorded code revision/blob IDs are provenance pins, not an equality
requirement — ISSUE-080 itself changes `common.py` and `import_awards.py`. The
operative comparison is the canonical artifact SHA-256 and the regenerated
incoming-key counts/fingerprints; a difference in either **STOPs** the
deployment and forces the Plane-A × Plane-B classification to be redone, and a
change to normalisation, skip or key-derivation code makes the newly generated
keyset authoritative with the classification redone rather than waived.)*

### 7.2 Schema gate — version-aware, fails closed against the **selected** profile

Production is at migration **057** before ISSUE-084 deploys. The first audit must
be written for that schema; migration 057 is **not** an audit failure. Two
profiles are defined; the operator selects one, and the gate refuses if
production does not match the selected profile.

#### Profile A — pre-ISSUE-084, migration 057 (the first exposure audit)

1. Tables exist: `hall_of_fame`, `honour_team_members`, `award_winners`,
   `award_nominations`, `sources`, `player_link_resolutions`, `data_edits`.
2. `source_id` exists and is nullable on the four data tables;
   `source_record_id` exists on `award_winners`/`award_nominations` and does
   **not** exist on the two honours tables.
3. Honours constraints as at 057: `hall_of_fame_name_uq` (migration 042) present;
   **`honour_team_uq UNIQUE (team_name, player_name_raw)` present and total**;
   `honour_team_linked_player_uq` and `honour_team_unlinked_name_uq`
   **absent**. Their presence means 059 has been applied and Profile A is the
   wrong profile — refuse and re-select.
4. `award_winners_source_uq`, `award_nominations_source_uq`,
   `uq_award_winners_source`, `uq_award_nominations_source` present.
5. `player_link_resolutions` is the **migration-057** shape.
   **`match_method` must not be assumed** (migration 067). Select it only if the
   catalogue shows it.
6. Migrations 058–070 must **not** be assumed to exist. `data_edits`' allowlist
   is the 057 one, so `award_winners`/`hall_of_fame`/`honour_team_members` may
   not yet be registered there; the `data_edits` evidence query must tolerate
   returning nothing.
7. Required `sources` rows resolve by key, ids reported: `wikipedia`,
   `draftguru`, `footywire`, `sports_data_lab`, `wikipedia_22under22`,
   `manual_admin_edit`.
8. Report the applied migration high-water mark for the record.

**How migration 059 changes honour-team collision behaviour between profiles —
document explicitly:**

| Collision shape (foreign-owned stored row vs incoming source key) | Profile A (057, total `honour_team_uq`) | Profile B (059+, two partial indexes) |
|---|---|---|
| both unlinked, same `(team_name, player_name_raw)` | refused by `honour_team_uq` | refused by `honour_team_unlinked_name_uq` |
| stored **linked**, incoming unlinked, same `(team_name, player_name_raw)` | **refused** by `honour_team_uq` (it is total, so `player_id` is irrelevant) | **NOT refused — silent duplicate** (§4.3) |
| stored **linked P**, incoming **linked Q**, `P ≠ Q`, same `(team_name, player_name_raw)` | **refused** by `honour_team_uq` — two distinct same-named players cannot both be recorded, which is the defect ISSUE-025 raised | **permitted, and must remain so** (§4.3 last row) |
| same `(team_name, player_id)`, different `player_name_raw` | not constrained at all | refused by `honour_team_linked_player_uq` |
| admin create colliding with an existing row | `createHonourTeamMember`'s `ON CONFLICT` arbiters do not exist → **the admin action fails outright** (P12) | `DO UPDATE` silently overwrites (P6) |

Consequences for the audit: on Profile A the silent-duplicate shape cannot exist
in stored data, and admin-created honour-team rows are unlikely to exist at all —
but the *extract* comparison is still required, because the adopt/overwrite path
(§4.1, §7.3) is live on 057 for both honours tables.

#### Profile B — post-migration, ISSUE-084 verification

The verification audit must be **regenerated and reviewed against the actual
migrated schema**, not reused from Profile A: 059's partial indexes, 067's
`match_method`, and 058's widened `data_edits` allowlist all change what can be
selected and what the collision classification means. The gate still fails closed
if production does not match Profile B.

**Timing — it cannot simply be "immediately before ISSUE-084 deploys", because
Profile B requires migration 059+ to have already been applied.** The operational
gate is:

> The Profile-B ISSUE-080 audit occurs **after the production schema has been
> migrated to the Profile-B shape and verified, but before the first
> awards/honours reload or importer execution under that schema.**

It therefore sits **inside ISSUE-084's deployment sequence**, not before it.
Reconciled against ISSUE-084's existing ordering:

| Step | Owner | Note |
|---|---|---|
| Apply migrations 058–070, including **059** | ISSUE-084 | 059 is what creates the Profile-B honour-team shape |
| `npm run db:privileges` at ISSUE-084's required points, including **068 + privileges before the honours importer** | ISSUE-084 | unchanged |
| Deploy the corrected loaders (`common.py`, `import_awards.py`) and `awards-admin.ts` | ISSUE-084, prerequisite from ISSUE-080 | must precede any reload |
| **Profile-B ISSUE-080 audit — schema gate, Plane A, Plane B re-derivation, reclassification** | **ISSUE-080 gate, executed within ISSUE-084** | after the migrations and privileges above; **before** `import_awards.py` runs |
| First awards/honours reload under the new schema | ISSUE-084 | only if the audit gate passed |
| ISSUE-078 one-time production `--rekey`, ISSUE-079 audit regeneration | ISSUE-084 | unchanged |

Plane B for this run is pinned to **the exact legacy artifact and importer
revision that will actually execute** in the reload step below it — not the
artifact used for the Profile A audit (§7.1).

Note also that migration 059 changes what a collision *means* (the table above in
this section), so a Profile A "no collision" result does not carry over and the
classification must be redone regardless of whether the artifact changed.

### 7.3 Query responsibilities and required output

#### Plane A — production, all four implemented tables

| Assertion | Applies to | Output columns |
|---|---|---|
| Total rows | all four | `table`, `total` |
| Rows grouped by provenance | all four | `table`, `source_id`, `source_key` (NULL rendered explicitly), `rows` |
| Rows inside each loader's **current** domain scope | `award_winners` (legacy exclusion; All-Australian), `award_nominations` (rising-star) | `table`, `loader`, `rows_in_domain_scope` |
| Rows inside domain scope but **owned by another source** — the exposed set | same | `table`, `loader`, `source_key`, `exposed_rows` |
| Foreign-owned rows (any provenance that is not the loader's) | `hall_of_fame`, `honour_team_members` | `table`, `source_key`, `rows` |
| Exposed/foreign rows carrying `player_id` | all four | count |
| Exposed/foreign rows referenced by `player_link_resolutions` | all four | `target_table`, `target_id`, `action`, `player_id`, `previous_status`, `created_at`, `admin_user_id` — joined on **`target_table = '<name>' AND target_id = …`**, never on numeric id alone |
| Exposed/foreign rows with a `data_edits` row | whichever tables the live allowlist permits | `table_name`, `row_id`, `field_group`, earliest `created_at`. **Included** because it is the only positive evidence separating "admin created this" from "provenance unknown" for historical NULL rows — audit use only, never on the mutation path (§5.2) |
| Stored-state `(name, inducted_year)` collisions between foreign and source-owned rows | `hall_of_fame` | both ids, key, both `source_key`s, both `player_id`s |
| Stored-state honour-team collisions across owners — reload key, **and** `(team_name, player_id)`, **and** the linked/unlinked mixed shape | `honour_team_members` | both ids, `team_name`, `player_name_raw`, both `player_id`s, both `source_key`s, which constraint/index would fire **under the selected profile** |
| `(award_id, source_record_id)` collisions across owners (residual risk check, §4.5) | `award_winners`, `award_nominations` | both ids, `award_id`, `source_record_id`, both `source_key`s |
| Row detail for every exposed/foreign row | all four | identity, key, `player_id`, link status, `source_key`, `import_batch_id` — **no admin emails, no note/free-text bodies, no unrelated personal data** |

Full row detail is bounded to the exposed/foreign set; everything else is counts
only.

#### Plane A × Plane B — natural-key classification (`hall_of_fame`, `honour_team_members`)

Every **foreign-owned** production row in these two tables is classified against
the normalised incoming keyset. **Do not describe all foreign-owned natural-key
rows as `would_delete`.**

| Class | Test | Current unscoped behaviour | Post-scoping behaviour |
|---|---|---|---|
| **`incoming_key_present`** | the row's key ∈ Plane B | UPDATE in place — the row's fields are overwritten with the source's and `source_id` is stamped to `wikipedia`: **silent adoption**, not deletion | out-of-scope; the incoming row attempts INSERT and **collides** → the §4.7 fail-closed policy fires. **This is the set that decides the collision policy.** |
| **`incoming_key_absent`** | the row's key ∉ Plane B | **DELETE** (or `LinkDecisionLoss` abort if it carries a decision) | out-of-scope and untouched — the fix protects it |
| **`ambiguous`** | key membership cannot be established — extract unavailable, normalisation mismatch, non-deterministic key, or the row's key columns cannot be normalised | unknown | **STOP.** Do not proceed to implementation on an unclassified row. |

Required output per row: table, row id, key, `source_key`, `player_id`, link
status, class, and — for `incoming_key_present` — whether the row carries a
`player_link_resolutions` decision (an adoption that also overwrites a decided
link is the worst case and must be listed individually).

#### Source-keyed tables — no extract plane required, and why

For `award_winners` and `award_nominations` the equivalent question is settled by
**construction, not by data**. Each loader emits a *constant* `source_id` per
generator branch, drawn from a closed, known set:

| Loader | Source ids it can emit |
|---|---|
| `import_awards` (legacy winners) | `{draftguru}` (`:430`) |
| `import_all_australian` | `{draftguru, wikipedia}` (`:510`, `:532`) |
| `import_rising_star` | `{footywire}` (`:894`) |

`_key_match` requires **both** `source_id` and `source_record_id` to match. A
foreign-owned row's `source_id` is by definition outside that set, so the pair
can never match any incoming row. **Therefore every foreign-owned row inside the
current domain scope is necessarily absent from the incoming keyset and is a
current DELETE candidate** — `would_delete` is the correct label here, and no
extract comparison is needed.

One caveat, and it is the reason for the §8.1d guard: this proof assumes each
loader's source ids resolve to real values. If `sources.get(...)` returned
`None`, the scope predicate would select **no** rows at all, nothing would be
reconciled, and every incoming row would proceed toward INSERT with NULL
provenance — see §8.1d for the exact failure sequence. The audit should
therefore also report whether any row in these tables already carries
`source_id IS NULL`, since such rows would be indistinguishable from that
failure's output after the fact.

#### The source-keyed ownership assumption, stated explicitly

> `domain predicate AND source_id ∈ loader-owned-sources` is safe **only because
> investigation established that, inside that domain, those source ids are
> exclusively reconciled by that loader.** Positive `source_id` scoping is not
> self-justifying: it is correct only while the owner/domain pair is exclusive.

Verified owner/domain pairs — each established by reading the loader's row
generator and confirming no other writer emits that source id inside that domain
(§2.1, §2.2):

| Loader | Domain | Source ids it owns | Exclusivity evidence |
|---|---|---|---|
| `import_awards` (legacy winners) | `award_id <> ALL(22under22, all-australian)` | `{draftguru}` (`:430`) | The only other `draftguru` writer of `award_winners` is `import_all_australian`, which writes **only** under the All-Australian award — excluded by this loader's domain predicate. The ingest pipeline writes `sports_data_lab`; `createAwardWinner` writes `manual_admin_edit`. |
| `import_all_australian` | `award_id = all-australian` | `{draftguru, wikipedia}` (`:510`, `:532`) | Both ids are emitted by this one loader for this one award. The legacy winners loader excludes this award; `import_under_22` writes only `wikipedia_22under22` under its own award; the ingest `all_australian` dataset writes `sports_data_lab`. |
| `import_rising_star` | `award_id = rising-star` | `{footywire}` (`:894`) | The only `footywire` writer of `award_nominations` in the tree. The ingest `rising_star` dataset writes `sports_data_lab` under the same award. |

**If another legitimate writer using the same source id inside the same domain is
discovered — during the audit or later — STOP.** Positive `source_id` scoping
alone would still be too broad in that case, because the loader would own, and
therefore delete, rows a second writer produced under the same provenance. The
scope would need a further discriminator (as `import_under_22` gains from
`source_record_id`), and that is a change to this plan, not a detail of it.

### 7.4 Classification rules

| Outcome | Definition | Consequence |
|---|---|---|
| **Successful completion** | Selected profile's gate passed; every Plane A assertion returned; Plane B derived **with its full evidence record** (§7.1) and every foreign-owned natural-key row classified. | Proceed to classify. |
| **Stale keyset — classification void** | The legacy artifact digest, either keyset count, or either normalised-key fingerprint differs from the run whose classification is being relied on; or the normalisation/skip/key-derivation code itself changed (in which case the newly generated keyset is authoritative). *(Corrected 2026-08-23 — Correction 1: a changed code revision or whole-file blob is provenance only and does not by itself void the classification.)* | The `incoming_key_present` / `incoming_key_absent` classification is void. Regenerate Plane B and reclassify before any reload is authorised. Do not informally approve a mismatch. |
| **Schema-gate refusal** | Any gate item mismatched the selected profile. | Stop before any data read. Record which item; re-select the profile or re-derive the audit against the real schema. Never relax the gate to proceed. |
| **No exposure** | Zero foreign-owned rows in the honours tables; zero foreign-owned rows in any source-keyed loader's domain scope; every stored-state collision set empty. | Implementation may proceed with no production remediation. |
| **Exposed but classifiable** | Non-zero exposed rows, every one attributable to a known owner, every natural-key row classified `incoming_key_absent`, and every stored-state collision set empty. | Implementation proceeds; scoping is exactly what protects them. Record the inventory as ISSUE-084's post-deployment baseline. |
| **Ambiguous exposure — STOP** | Any row classified `incoming_key_present` (a real post-scoping collision requiring curator judgement); or any `ambiguous` row; or any stored-state collision set non-empty; or any exposed row whose ownership cannot be attributed; or any `incoming_key_present` row carrying a link decision. | **Stop before source changes.** Each case is a separate curator decision recorded in `issues.md`. Do not encode a default. |

Results are recorded in the ISSUE-080 entry as evidence.

---

## 8. Implementation plan

Nothing here is implemented, and none of it starts before gate **G1** passes.
Order matters: §8.1 before §8.2.

### 8.1 `tools/migration/common.py` — `reload_keyed`

**(a) Conjunctive scope.** Generalise `_scope_clause` from one predicate to a
conjunction over distinct columns, `AND`-joined, parameters appended in order.
Keep the existing `scope_column`/`scope_values`/`scope_exclude` signature as the
single-predicate shorthand so `import_draft.py` and the already-correct calls
need no edit. Add, e.g., `scopes: Sequence[tuple[str, Sequence[Any], bool]] = ()`.
Preserve the existing empty-list semantics exactly (`FALSE` when including,
`TRUE` when excluding) — they are load-bearing and already documented.

**(b) Out-of-scope collision preflight — narrowly tailored, two checks only.**

The earlier draft proposed a generic `conflict_keys` list with a blanket
"skip when any column is NULL" rule. **That is withdrawn.** It is not equivalent
to PostgreSQL uniqueness semantics — ordinary `UNIQUE`, `UNIQUE NULLS NOT
DISTINCT`, and partial unique indexes each treat NULL differently — and it would
turn `reload_keyed` into a general constraint engine. The final API is:

**Check 1 — out-of-scope reload-key refusal, `reload_keyed`, OPT-IN.**
When enabled, no incoming row may hold a reload key that an out-of-scope row
already holds. Comparison uses **`_key_match`** — the exact `IS NOT DISTINCT
FROM` semantics `reload_keyed` already applies to this key everywhere else — so
no new equality rule is invented and the check cannot disagree with the
UPDATE/INSERT/DELETE steps about what "the same key" means.

**It must not be automatic.** An earlier draft enabled this unconditionally
whenever a scope was in effect. That is correct for `hall_of_fame`, whose reload
key `(name, inducted_year)` *is* a globally unique real-world identity backed by
a total constraint — but **wrong for `honour_team_members`**, whose reload key
contains `player_name_raw`, which migration 059 deliberately stopped treating as
identity. Enabling it there would refuse the *linked P / linked Q, `P ≠ Q`* case
the schema is designed to permit, regressing ISSUE-025. So the helper gains one
boolean the caller opts into — e.g. `refuse_out_of_scope_key: bool = False` —
and **"the reload key is globally unique real-world identity" is never encoded as
a `reload_keyed` assumption.**

| Caller | Check 1 | Reason |
|---|---|---|
| `import_hall_of_fame` | **enabled** | reload key is a total, globally unique natural key |
| `import_honour_teams` | **disabled** | reload key contains raw name; §4.3's matrix applies instead |
| `import_awards` (winners), `import_all_australian`, `import_rising_star` | **disabled** | provenance is part of the reload key, so foreign ownership is intended to coexist (§4.5). No preflight required at all |

**Check 2 — honour-team collision classification, in the loader, not the
helper.** `import_honour_teams` implements §4.3's matrix and §4.4's
linked-identity rule directly, as a preflight before its `reload_keyed` call.
Both are table-specific statements about migration-059 objects, so they belong
with the loader that owns the table, and the matrix's five-way outcome cannot be
expressed as a generic key comparison anyway. The `(team_name, player_id)` check
mirrors `honour_team_linked_player_uq` exactly: both sides require `player_id IS
NOT NULL`, and comparison is plain `=` because the index is an ordinary
(non-`NULLS NOT DISTINCT`) unique index over a predicate that already excludes
NULL. `import_honour_teams` already materialises its extract rows and can build
both candidate lists cheaply.

The incoming row's **raw** `player_id` is the right value to classify with: a
decision replay can only change the effective `player_id` of a row that *matched
an in-scope row*, and such a row is an UPDATE, never an INSERT, so it cannot
reach this collision path.

**Why this is the minimum sufficient change:** `reload_keyed` gains exactly one
opt-in boolean and no new semantics; it reuses the helper's own key equality
rather than inventing a second rule; the table-specific identity policy stays
with the table that owns it, expressed as migration 059 expresses it; and no
constraint the database already enforces fail-closed is re-implemented (§4.5).
Both checks raise a dedicated exception **before any write**, listing table, key
columns and values, the out-of-scope row id and its `source_id`, and the required
human action. **The database unique constraints and indexes remain the
concurrency backstop where they apply** — and where they do not (§4.3's two mixed
cases), §5.3's advisory lock supplies the serialisation.

**(c) No change** to decision loading, classification, `LinkDecisionLoss`,
disagreement reporting, `--allow-link-loss`, the UPDATE/INSERT/DELETE shapes, or
`ReloadStats`. ISSUE-044 behaviour is untouched; scoping changes only *which*
rows those mechanisms see.

**(d) Source-presence guard.** A `sources.get(...)` miss must raise rather than
produce `scope_values = [None]`. The precise failure mode:

1. The scope predicate becomes `e.source_id = ANY(ARRAY[NULL])`, which evaluates
   to NULL — never true — for **every** row. **The intended owned-row scope is
   empty/invalid.** It does *not* select stored `source_id IS NULL` rows; the
   scope predicate itself prevents that.
2. No existing source-owned row is reconciled: UPDATE matches nothing, DELETE
   matches nothing.
3. Every incoming row passes the scoped `NOT EXISTS` and proceeds toward INSERT,
   carrying **missing or incorrect provenance** (`source_id` NULL).
4. Some of those inserts may then fail a unique constraint — but **relying on
   that is unsafe and opaque**: which constraint fires, and whether one fires at
   all, depends on the table and the data, and the operator is left with a raw
   constraint name instead of "this source is not configured".

`IS NOT DISTINCT FROM` is the key-equality rule applied **after** rows
participate in a key comparison; it does not confer scope membership, and the
NULL-scope failure above is not attributable to it. `import_under_22` already
guards this (`import_awards.py:1242-1246`); apply the same guard to every newly
scoped loader.

### 8.2 `tools/migration/import_awards.py` — per-loader changes

| Loader | Current scope | Proposed scope | Extra preflight |
|---|---|---|---|
| `import_hall_of_fame` | none | `source_id = ANY([wikipedia])` | check 1 **enabled** (`refuse_out_of_scope_key`) |
| `import_honour_teams` | none | `source_id = ANY([wikipedia])` | check 1 **disabled**; loader-local §4.3 matrix + §4.4 identity check, under the §5.3 advisory lock |
| `import_awards` (winners) | `award_id <> ALL(u22, all-australian)` | **plus** `source_id = ANY([draftguru])` | none — provenance is in the reload key (§4.5) |
| `import_all_australian` | `award_id = ANY([all-australian])` | **plus** `source_id = ANY([draftguru, wikipedia])` | none — as above |
| `import_rising_star` | `award_id = ANY([rising-star])` | **plus** `source_id = ANY([footywire])` | none — as above |
| `import_captaincies` | none | **unchanged** — out of scope (§6) | — |
| `import_under_22` | already correct | unchanged | — |
| `import_awards` (definitions) | `slug <> ALL(u22)` | unchanged | — |

Expected populations after the change, uniformly: **UPDATE** — rows this source
owns whose key the extract still carries; **INSERT** — extract rows with no
in-scope key match *and* no out-of-scope conflict; **DELETE** — rows this source
owns whose key the extract no longer carries. Incoming keys are constructed
exactly as today; no key changes. Every loader keeps its existing domain
predicate.

### 8.3 `src/db/queries/awards-admin.ts`

- `createHallOfFameInductee`: resolve and require `manual_admin_edit`, stamp
  `source_id`, mirroring `createAwardWinner`'s missing-source error. Behaviour
  otherwise unchanged (it already fails closed). Error-message polish optional.
- `createHonourTeamMember`: same provenance stamp; **remove `ON CONFLICT … DO
  UPDATE` from both branches**; take the §5.3 transaction-scoped advisory lock as
  the first statement inside `importSql.begin(...)`; then apply the **§4.3
  matrix** on `(team_name, player_name_raw)` and the **§4.4 rule** on
  `(team_name, player_id)`, for every ownership class, returning a refusal that
  **names the existing entry** rather than pointing at an editor that does not
  exist for this table (§2.4b, §5.2). Removing the upsert
  clause without these checks would replace a silent overwrite with a silent
  duplicate, because 059's partial indexes do not cover the two mixed
  linked/unlinked cases — and the checks without the lock would still admit that
  duplicate under concurrency. **The matrix's last row must still succeed:** a
  second, differently-linked player sharing a display name is legitimate and must
  be creatable. No `data_edits` read on the mutation path.
- `createAwardWinner`: no change.

### 8.4 Migrations and privileges

**No migration — on a stated basis, not by assumption.** `source_id` exists on
all affected tables; `manual_admin_edit` exists since migration 057; no
constraint changes; no backfill. The one place a migration might have been
forced is the migration-059 semantic gap (§4.3), and §5.3 establishes that the
**existing schema plus a transaction-scoped advisory lock** serialises both
writers over that key space without one. If validation shows that lock cannot
serialise `createHonourTeamMember` against `import_honour_teams` as designed,
**this conclusion must be revisited rather than preserved** — gate **G8**. A
constraint-based alternative would mean a new total or expression-based unique
index on `honour_team_members`, which would have to be reconciled with migration
059's deliberate identity model and with ISSUE-084's migration ordering, and is
explicitly the less preferred outcome.

Recorded explicitly so ISSUE-084's migration ordering (058–070) is unaffected as
things stand.

**No privilege change — expected, and conditional on §9.4b.** The loaders touch
no new table and the preflights read tables the loader already reads. The one
open question is the advisory lock: `pg_advisory_xact_lock` /
`pg_try_advisory_xact_lock` are normally executable by `PUBLIC` and both writers
already connect as `afldb_import`, but this is **proven under the real runtime
role in §9.4b rather than assumed**. Verify with the existing
`tests/integration/privileges.test.ts` unchanged.

**Do not conclude a privilege gap from a failing test.** A restricted-role
failure must first be **diagnosed to an actual privilege error** — statement,
role, and PostgreSQL error text — with harness/DSN misconfiguration, a wrong lock
constant and a misplaced transaction boundary ruled out (§5.3). Only a diagnosed
privilege error justifies adding a grant, and then only exactly the grant the
diagnosis names. Note that such a change would also add an
`npm run db:privileges` step to ISSUE-084's sequence that this plan currently
says is unnecessary, so the diagnosis must be recorded in `issues.md` before the
grant is written.

---

## 9. Test / validation matrix

`tests/integration/awards-reload-links.test.ts` is the correct home: it is the
only suite that drives a Python importer against a real database, it already owns
the ISSUE-044 reload contract, and it already has fixture helpers
(`takeUnresolved`, `readRow`, `countRows`, `runImporter`). **No new test file is
justified.** Unit coverage for the admin changes extends
`tests/awards-admin.test.ts`, which already asserts `manual_admin_edit` source
lookups and the missing-source error.

### 9.1 Ownership preservation (new — `afldb_test`)

- Admin-created `hall_of_fame` row survives a full honours reload.
- Admin-created `honour_team_members` row survives.
- Admin-created `award_winners` row (`manual_admin_edit`, `award_winner:<uuid>`)
  survives the legacy `awards` reload, source and record id unchanged.
- A `sports_data_lab` `award_winners` row under the All-Australian award survives
  the `all_australian` reload.
- A `sports_data_lab` `award_nominations` row under the Rising Star award
  survives the `rising_star` reload.
- Each of the above with **no** player link — survives.
- Each with `player_id` set — survives with the link intact.
- Each with a manual `player_link_resolutions` decision — survives, and the
  reload does **not** raise `LinkDecisionLoss` (proving the out-of-scope
  exemption in §2.5).
- Preserved rows keep their surrogate ids.
- Preserved resolution `target_id` still resolves to the same row.
- **No `captaincies` fixture** — out of scope (§6).

### 9.2 Source reconciliation (must remain true)

- An in-scope source row present in the extract is UPDATEd in place, id stable.
- An in-scope source row absent from the extract is DELETEd.
- A new source row is INSERTed.
- A manual decision on a source-owned row survives exactly as ISSUE-044 requires.
- A `confirmed_unlinked` decision on a source-owned row survives.
- Disagreement reporting is unchanged.

### 9.3 Collision policy (new)

- Hall of Fame foreign/source `(name, inducted_year)` collision → check 1
  refuses before any write; `hall_of_fame` unchanged afterwards.

Honour teams — the full §4.3 matrix against the reload, one case per row:

- foreign **unlinked** vs incoming **unlinked** → refuses.
- foreign **unlinked** vs incoming **linked P** → refuses.
- **foreign linked P vs incoming unlinked → refuses, and no duplicate row is
  created.** One of the two cases with no database backstop on the dev schema;
  the single most important new assertion.
- foreign **linked P** vs incoming **linked P** → refuses.
- **foreign linked P vs incoming linked Q, `P ≠ Q` → the reload SUCCEEDS and both
  rows survive as distinct people.** The positive ISSUE-025 regression: prove the
  fix does not collapse two same-named linked players in one team.
- §4.4 axis: foreign row linked to P in team T under a *different*
  `player_name_raw`, incoming row linked to P in team T → refuses.
- Every refusal leaves every affected table unchanged — row count, ids, and the
  specific fixture rows.
- Check 1 is **not** enabled for `import_honour_teams`: assert this by the
  matrix's last case passing, which a blanket reload-key refusal would fail.

### 9.4 Admin-create policy (new — `tests/awards-admin.test.ts`)

- `createHallOfFameInductee` stamps `manual_admin_edit`; missing source raises.
- `createHonourTeamMember` stamps `manual_admin_edit`; missing source raises.

Duplicate refusal, both axes (§5.2), covering every row of the §4.3 matrix:

- **Mixed linked/unlinked — the case with no database backstop.** Existing
  source-owned unlinked row `(team = T, name = N, player_id = NULL)`; attempted
  linked admin create `(T, N, player_id = P)` → **refused**, and the existing row
  is unchanged (id, `source_id`, `player_id`, link status, every field).
- **Reverse mixed case.** Existing linked row `(T, N, player_id = P)`; attempted
  unlinked/admin duplicate `(T, N)` → **refused**, if that input shape is
  reachable through the form.
- **Both unlinked** → refused. **Same linked player** `(T, N, P)` vs `(T, N, P)`
  → refused.
- **Positive ISSUE-025 regression — must SUCCEED.** Existing linked
  `(T, "Same Name", player = P)`; proposed linked `(T, "Same Name", player = Q)`
  with `P ≠ Q` → **creation is allowed**, both rows exist afterwards, and both
  remain linked to their own distinct players. A blanket raw-name refusal would
  fail this test, which is the point of having it.
- **Axis 2 under a different display name.** Existing linked player `P` in team
  `T` recorded under another `player_name_raw` variation; attempted linked create
  for the same `(T, P)` → **refused** (axis 1 does not match, axis 2 does).
- **Provenance independence.** Refusal proven against a `manual_admin_edit` row,
  a `wikipedia` row and a `source_id IS NULL` row alike — three cases, one
  policy.
- **Happy path intact.** An ordinary non-conflicting creation still succeeds and
  receives `source_id = manual_admin_edit`.
- The refusal path writes **no** `data_edits` row, performs no UPDATE, and
  performs **no** `data_edits` lookup.

### 9.4b Concurrency of the migration-059 semantic key (§5.3)

The two mixed cases have no unique-index backstop, so the lock is the invariant
and must be proven, not assumed. Add **either** a concurrency-oriented
integration test **or**, if reliable interleaving proves impractical in the
harness, a database-backed proof of the locking invariant itself:

- Two overlapping `createHonourTeamMember` transactions racing the same mixed
  case → exactly one succeeds or refuses cleanly; **no duplicate row exists
  afterwards**.
- `createHonourTeamMember` racing `import_honour_teams` over the same team →
  same outcome; the reload either completes with the admin row untouched or the
  create refuses with the bounded "reload in progress" error, never both writing.
- Acceptable fallback proof: assert that both writers acquire the **same**
  advisory-lock key inside their transaction, and that a second acquisition
  attempt from an independent connection blocks (or fails the *try* form) while
  the first transaction is open — a direct database-backed demonstration that the
  two writers are serialised over this key space.
- Lock behaviour is bounded and fail-closed: the admin path's *try* form returns
  a clear error rather than hanging; nothing outside `honour_team_members`
  serialises.

**Validation must run under the real runtime roles, not `afldb_owner`.** Both
participants connect through `AFLDB_IMPORT_DATABASE_URL` and therefore run as
`afldb_import` (§5.3), while the integration suite currently assigns the **owner**
DSN to that variable (`awards-reload-links.test.ts:35`) — which is precisely the
defect **AFLDB-ISSUE-083** tracks: a privilege gap on the real role would pass as
owner and fail in production. The lock proof must therefore establish, under the
actual roles used by the admin mutation and by the legacy importer:

1. each runtime role **can acquire** its required transaction advisory lock —
   the blocking form for the importer, the try form for the admin path;
2. both paths contend on the **exact same lock identity** (same two integer
   constants, verified as literals, not as separately computed values);
3. a transaction holding the lock **prevents the other writer from entering** the
   protected identity check/write section;
4. `pg_try_advisory_xact_lock` returns **false rather than hanging** the
   interactive path while the lock is held;
5. **both commit and rollback release** the transaction-scoped lock — proven by a
   subsequent acquisition succeeding after each.

This is the same restricted-DSN capability ISSUE-083 proposes. If ISSUE-083 has
landed, reuse its helper; if not, this validation may be run as a bounded
one-off restricted-DSN check for these five assertions only — it does **not**
require re-running the integration suite as `afldb_import`, which remains
ISSUE-083's scope.

**If any of the five assertions fails, diagnose before concluding.** Capture the
exact statement, the connected role (`SELECT current_user`) and the verbatim
PostgreSQL error, and rule out the likelier causes first — a harness/DSN
misconfiguration pointing at the wrong role, mismatched lock constants between
the two implementations, or a transaction boundary that is not where it is
assumed to be. **Only a diagnosed privilege error** justifies updating §5.3 and
§8.4 and adding exactly the named grant to `tools/maintenance/privileges.sql`.
Add nothing speculatively, and record the diagnosis in `issues.md` first.

### 9.5 Idempotency

- First reload after the fix reaches the expected state.
- A second identical reload changes nothing logically: same row count, same ids,
  same links, `deleted = 0`, `inserted = 0`.
- Manual decisions still valid after the second run.

### 9.6 ISSUE-044 regression surface — rerun unchanged

All six existing cases in `tests/integration/awards-reload-links.test.ts`:
resolved-link + id preservation; confirmed-unlinked pointing at the same row;
admin link kept when the source names someone else, with the disagreement
reported; strict abort on a renamed name-keyed Hall of Fame row; the same for a
renamed honour-team member; and the `--allow-link-loss` reporting case. Plus
`tests/integration/release-gates.test.ts` (counts), `privileges.test.ts`
(unchanged confinement), `tests/under-22-importer.test.ts` (Under-22 isolation —
Linux only; ISSUE-054 makes four of its cases fail on Windows and those failures
must **not** be attributed to ISSUE-080), and `tests/awards-admin.test.ts`.

### 9.7 ISSUE-081 interaction — kept separate (gate G3)

ISSUE-081 is a separately tracked test-concurrency issue and **is not absorbed
here**. The new cases add fixtures to `award_winners` and `award_nominations`,
which `release-gates.test.ts` counts, so this work **widens** the latent race
ISSUE-081 records. Handling:

- ISSUE-081 stays open and separately owned; ISSUE-080 does not close it.
- **Recommended:** resolve ISSUE-081 before the combined ISSUE-080 + release-gate
  validation, if practical.
- Once ISSUE-081 supplies the shared advisory lock (the
  `tests/integration/draft-lock.ts` treatment), ISSUE-080's new cases may rely
  on it. ISSUE-080 does not introduce its own competing lock.
- **The ISSUE-080 suite can be validated in isolation before ISSUE-081 lands:**
  running `tests/integration/awards-reload-links.test.ts` on its own removes the
  cross-file race entirely, since the race is with `release-gates.test.ts`
  specifically. That is the §10 step-3 order.
- Do not serialise the whole test run — file parallelism is worth keeping.

---

## 10. Development validation plan (execution session, in order)

Begins only after gate **G1** passes.

1. **Static/unit first, no database:** `tests/awards-admin.test.ts` (provenance
   stamping and the refuse-on-conflict policy), then
   `tests/under-22-importer.test.ts` on Linux (source-contract assertions over
   `import_awards.py`).
2. **Migration validation:** none required — no migration. Confirm with
   `npm run db:status` and observe no pending migration attributable to this work.
3. **`afldb_test` integration, isolated first:**
   `tests/integration/awards-reload-links.test.ts` **alone** (needs
   `AFLDB_LEGACY_SQLITE` and psycopg, else it skips) — this proves the change
   without touching the ISSUE-081 race. Only then run it together with
   `release-gates.test.ts`, and only once ISSUE-081's lock exists (§9.7).
4. **Concurrency proof (§9.4b):** prove the §5.3 advisory lock serialises
   `createHonourTeamMember` against itself and against `import_honour_teams`,
   either by interleaved transactions or by the database-backed lock-key proof.
   **Do this before declaring §8.4's no-migration conclusion held** — it is what
   gate **G8** turns on.
5. **Idempotent reload:** the §9.5 double-reload assertions, against `afldb_test`
   fixtures only.
6. **Read-only `afldb_dev` checks** — counts, provenance groups and collision
   sets only, mirroring §7.3 Plane A, to confirm the shipped scope matches a live
   dataset. **No dev mutation.** A scenario `afldb_test` can prove must not be
   manufactured on dev.
7. **Typecheck** if `awards-admin.ts` changed (`npm run typecheck`). **No full
   build** — no framework, compiler or route behaviour is involved.
8. **Attribution discipline:** ISSUE-054 (Windows-only Under-22 contract
   failures), ISSUE-072 (site-settings), ISSUE-073 (fk-indexes), ISSUE-074
   (email-intake) are known failing and must not be recorded as ISSUE-080
   regressions.

---

## 11. Decision gates / unresolved questions

### G1 — Production exposure audit is an **execution gate**, not a recommendation

Approval and saving of this runbook **does not authorise source edits.** The next
fresh execution session must begin with, and in this order:

1. Prepare and review the **migration-057-compatible (Profile A)** production
   audit — Plane A queries plus the Plane B keyset derivation, **including the
   Plane B evidence record**: artifact SHA-256, path/metadata, code revision,
   both keyset counts and both normalised-key fingerprints (§7.1, §7.2).
2. **The user runs the read-only production commands.** Claude does not connect
   to production.
3. Classify the returned evidence against §7.4, including the Plane A × Plane B
   natural-key classification.
4. **If any row classifies `incoming_key_present`, any row is `ambiguous`, or any
   stored-state collision set is non-empty — STOP before any source change** and
   record the curator decision required.
5. **Only if the gate passes may implementation begin** (§8).

The audit is then **repeated inside ISSUE-084's deployment sequence** —
regenerated against Profile B, after the production schema has been migrated to
the Profile-B shape (059 included) and verified and after ISSUE-084's
migration-068 + privilege step, but **before the first awards/honours reload or
importer execution under that schema**. See §7.2 for the reconciled ordering.

### G2 — Admin create conflict policy — **resolved**

`createHonourTeamMember` applies the §4.3 matrix on `(team_name,
player_name_raw)` and refuses unconditionally on `(team_name, player_id)`, for
every ownership class, directing the administrator to the edit workflow —
**while still permitting a second differently-linked player who shares a display
name** (ISSUE-025). No `data_edits` read on the mutation path. `ON CONFLICT … DO
UPDATE` is removed. Folded into §5.2 and §8.3; no longer open.

### G3 — ISSUE-081 stays separate — **resolved**

ISSUE-081 remains open and separately owned. ISSUE-080 does not close it, does
not absorb it, and does not serialise the whole suite. Recommended order: resolve
ISSUE-081 before the combined validation; ISSUE-080's isolated suite run (§10
step 3) is safe before then. See §9.7.

### G4 — Ambiguous production exposure

Resolution is per-row curator judgement recorded in `issues.md`. No default is
encoded in code. Blocks implementation start if it occurs (folded into G1 step 4).

### G5 — Data-editor edit durability — separate issue, **severity not
predetermined**

Data-editor UPDATEs to source-owned rows may be reverted by a later reload.
**Narrowed by §2.4b:** `EDITABLE_ENTITIES` registers only `players`, `matches`
and `draft_picks`, so `hall_of_fame` and `honour_team_members` have no editor
path to revert today and `award_winners` is registered in the `data_edits`
allowlist without being an editable entity either — the concern is therefore
about the *pattern* and about any entity later registered, not about a live
reversion in these three tables. Confirm that framing when the issue is written.

G5 is **write-time-independent**: it concerns durability/reversion after a
reload, not semantic identity integrity at write time, which §2.4b settles inside
ISSUE-080. Recommend a separate tracked issue after this planning work. **Do not
pre-classify its severity.** It should be set on its own evidence:

- what the admin UI promises about the edit;
- which fields and entities are affected;
- whether the edits are intended as durable corrections;
- whether the reversion is silent.

It does **not** block ISSUE-080 unless further evidence shows the same
ownership-deletion mechanism rather than overwrite-on-reload.

### G6 — `captaincies` hardening

Recommended as a **separate issue** (§6), with its own severity set on its own
evidence. Not implemented under ISSUE-080. Blocks nothing.

### G8 — The "no migration" conclusion is conditional on the lock holding

§8.4's no-migration conclusion rests on §5.3: the existing schema plus a
transaction-scoped advisory lock serialises `createHonourTeamMember` and
`import_honour_teams` over the migration-059 semantic key space. **If validation
(§9.4b) shows that lock cannot serialise both writers as designed, revisit the
conclusion rather than preserve it** — the alternative is a new unique index on
`honour_team_members` that must be reconciled with 059's identity model and with
ISSUE-084's migration ordering. Prefer no migration; do not force the answer.
Blocks the §8.4 claim only, not implementation start.

### G7 — Ledger rewrite on approval

ISSUE-080's title, summary, Files, Current state and Next action must widen
beyond Hall of Fame / honour teams to the five proven affected paths across four
tables, and the Open Issues table plus `IssuesIndex.md` must match. No
`AFLDB-ISSUE-085` for the widening itself; separate issues only for G5 and G6.

---

## 12. Safety / changes statement

| Item | Status |
|---|---|
| Source changed | **NO** |
| Tests changed | **NO** |
| Migrations changed | **NO** |
| Issues ledger changed (`issues.md`, `IssuesIndex.md`) | **NO** |
| `CHANGELOG.md` changed | **NO** |
| `AFLDB-ISSUE-080.md` created | **NO** |
| Production accessed | **NO** |
| Production data changed | **NO** |
| Dev database accessed or changed | **NO** |
| Test database accessed | **NO** |
| Migrations run | **NO** |
| Test suites / typecheck / build run | **NO** |
| Deployment performed | **NO** |
| Git commands used | **NO** |
| `--allow-link-loss` used or proposed as remediation | **NO** |

Only read-only local file inspection was performed. The one non-read action was
writing this plan document.

---

## ISSUE-084 handoff

| Question | Answer |
|---|---|
| Code only, or also a migration? | **Code only.** `tools/migration/common.py`, `tools/migration/import_awards.py`, `src/db/queries/awards-admin.ts`, plus tests. |
| Privilege reconciliation required? | **Expected no**, conditional on §9.4b. No new table is touched; the only open item is advisory-lock execution under `afldb_import`, which is proven rather than assumed. As things stand `npm run db:privileges` is not required *by ISSUE-080* and ISSUE-084's own 068/070 privilege steps are unaffected. A privileges step is added here **only if §9.4b diagnoses an actual privilege error** — statement, role and PostgreSQL error, with harness/DSN misconfiguration, wrong lock constants and misplaced transaction boundaries ruled out first. A failing restricted-role test is not by itself sufficient. If such a diagnosis is recorded, ISSUE-084 gains a privileges step and this row must be updated before deployment. |
| Ordering relative to migrations 058–070 | **ISSUE-080 adds no migration**, and the corrected `import_awards.py` and `common.py` must be **deployed before any honours or awards reload is run on production**, alongside ISSUE-084's existing "068 + privileges before the honours importer" step. *(Tightened 2026-08-23 — Correction 2 / M4.)* One ordering constraint **is** load-bearing: **migration 059 must already be applied before the corrected `import_honour_teams` loader runs**, because the honour-team preflight classifies on the incoming raw `player_id` before decision replay, and replay can later change an in-scope row's `player_id` — `honour_team_linked_player_uq` (a migration-059 object) is the final fail-closed backstop for that shape. If migration 059 is absent, **STOP**; do not run the corrected production honour-team reload on a pre-059 schema. Within ISSUE-084's existing sequence (migrations before loaders) this is automatically satisfied. |
| Must ISSUE-084's honours importer deployment include the completed ISSUE-080 changes? | **Yes.** Deploying the ISSUE-044 protections without ISSUE-080's scoping ships a loader that fails closed on decided admin rows and still silently deletes undecided ones — the worst of both. The corrected loaders are a **deployment prerequisite**. |
| When does the production exposure audit run? | **Twice** (gate G1). **First:** before ISSUE-080 implementation, under **Profile A** (migration 057) — it must not assume 059's partial indexes or 067's `match_method`. **Second:** **inside ISSUE-084's deployment sequence**, regenerated under **Profile B** — after the schema has been migrated to the Profile-B shape (059 included) and verified, after ISSUE-084's migration-068 + privilege step, and after the corrected loaders are deployed, but **before the first awards/honours reload or importer execution**. It cannot run "immediately before ISSUE-084 deploys", because Profile B does not exist until ISSUE-084 has applied its migrations. Full ordering in §7.2. |
| What must the in-sequence Profile-B audit re-derive? | **Plane B in full.** Re-derive the normalised incoming keyset from the exact deployment-candidate code and the exact canonical legacy artifact **that will actually execute in the reload step immediately following**, and record its own SHA-256, path/metadata, code HEAD/revision, relevant code blob IDs, read/skipped/emitted/distinct counts, duplicate-key result, and both normalised-key fingerprints (§7.1). *(Corrected 2026-08-23 — Correction 1.)* The **operative comparison** against the recorded Profile-A baseline is the canonical artifact SHA-256 and the incoming natural-key counts/fingerprints — the pre-fix code HEAD/blob IDs are historical provenance only, since ISSUE-080 itself changes `common.py` and `import_awards.py`. If the artifact SHA-256, either count or either fingerprint differs, **STOP** and redo the Plane-A × Plane-B classification; if normalisation, skip rules or key derivation changed, the new keyset is authoritative and the classification is redone, never waived. Do not informally approve a mismatch. A Profile A "no collision" result does not carry over regardless, because migration 059 changes what a collision means (§7.2). |
| Post-deployment verification to add to ISSUE-084 | (1) Re-run the §7.3 Plane A audit under Profile B and confirm the exposed-row inventory is **identical** before and after the first post-deployment reload — same ids, same provenance, same links. (2) Confirm `reload_keyed`'s reported `deleted` counts are consistent with source-owned rows only. (3) Confirm no preflight refusal fired; if one did, stop and resolve it as a curator decision before any further reload. (4) Confirm `player_link_resolutions` rows for admin-owned targets still resolve to live rows. (5) Note that migration 059 changes honour-team collision behaviour (§7.2), so a Profile A "no collision" result does not carry over — re-derive it. |
| Does ISSUE-080 change ISSUE-084's plan? | **No.** ISSUE-084's migration list, ordering and `--rekey` step are untouched. ISSUE-080 adds one prerequisite (deploy the corrected loaders) and one verification (the re-run audit). This runbook does not rewrite ISSUE-084. |

---

**Nothing further will be executed. Awaiting review.** On approval, this document
is saved as `AFLDB-ISSUE-080.md` and the session stops. The next session begins
at gate **G1** — the read-only production audit — not at implementation.
