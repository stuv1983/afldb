# AFLDB-ISSUE-167 — Special records administration and durable suppression

**Status:** **RESOLVED 2026-09-14 on DEV acceptance.** All nine stages complete, committed and pushed on `opus/issue-167-special-records-admin` (Stage 7 `c847b88`, Stage 8 fix `026ec2a`); migration 102 and the code are deployed to `afldb_dev`, §18's acceptance matrix is green against real roles, and the committed build is proven to mutate successfully. **Not merged to `main`; PRODUCTION untouched** — promotion stays with the `AFLDB-ISSUE-156` umbrella
**Severity:** Medium-high
**Area:** Admin / Data management / Acquisition / Public read models
**Created:** 2026-09-13
**Parent:** `AFLDB-ISSUE-156` P4 (Admin Centre umbrella)
**Inherited scope:** `AFLDB-ISSUE-155` Phase E (§12, §14.4, §23 Phase E), transferred to ISSUE-156 by reference
**Branch:** `opus/issue-167-special-records-admin`
**Worktree:** `D:\dev\afldb-issue-167`

This document began as a planning deliverable: no application code, migration, privilege,
test or deployment change was made while producing Stages 0–1, and every stage below
re-verifies current repository evidence before it writes anything. **Stages 2–6 have since
changed the repository, and that work is now committed and pushed.**

### Repository state — operator-proven 2026-09-14

```
planning / allocation   9faba6f
Stage 2                 8d9ac74
Stage 3                 2a54444
Stage 4                 5de87dd
Stage 5                 e8b44f6
tracking reconcile      c5a0df7
Stage 6                 077bf2a
Stage 7                 c847b88
Stage 8 fix             026ec2a
HEAD = @{u}             026ec2ab9c41f9a1ca3f1f80d5256d38d346d4f4
```

Branch `opus/issue-167-special-records-admin` is **committed and pushed** through Stage 8 and
is level with its upstream. **Nothing is merged to `main`.** DEV runs `026ec2a` from a clean
checkout; §27 records the stage and §27.11 its closeout.

**A claim Stage 8 had to correct.** This block previously argued that because `origin/main`
carried no migration past 101, "neither host can have seen 102". That is not what a ref
proves: a host can check out any branch, and Stage 8 did exactly that. The wording is
replaced by **direct evidence per host**:

* **DEV — measured, before anything was applied (2026-09-14).** `npm run db:status` on
  `streamanator:/home/arm/projects/afldb` against `afldb_owner@localhost:5432/afldb_dev`
  reported *101 migration file(s), 101 already applied, 0 pending*, and
  `information_schema.columns` returned **zero rows** for `status` / `status_reason` /
  `updated_at` on both `player_achievements` and `after_siren_kicks`. 102 had never been
  applied to DEV. It has been applied since, deliberately, under §27.
* **PROD — not connected to, and therefore not asserted.** No command in this stage
  addressed `afldb_prod` or the production host; the DEV checkout carries no production DSN
  (its `.env` names `afldb_dev`, `afldb_test` and `code_test_db` only). The honest statement
  is that **production was not touched by this work**, not that its state was verified.

Each stage-boundary paragraph
below ("nothing staged, committed, pushed…") records the state at the close of that
stage's own session and is superseded on the commit/push half only by this block.

---

## 0. Allocation proof and baseline

### 0.1 Issue ID

`AFLDB-ISSUE-167` was unused before this document. Native repository search over the
whole worktree (`Grep "ISSUE-167"`, all files, no glob filter) returned **no files**.
Specifically:

| Surface | Evidence | Result |
|---|---|---|
| `issues.md` | heading scan `^## AFLDB-ISSUE-16[0-9]` | highest heading is `AFLDB-ISSUE-166`; no 167 |
| `IssuesIndex.md` | included in the repository-wide grep | no match |
| Runbook files | `Glob AFLDB-ISSUE-*.md` (root + `issues/open` + `issues/closed`) | highest root runbook is `AFLDB-ISSUE-165.md`; no 167 |
| `CHANGELOG.md` | included in the repository-wide grep | no match |
| Branches / worktrees / git history | operator command block §0.5, **executed 2026-09-13** | no match |

`166` is resolved and unrelated (admin HTTP-layer denial). `167` is therefore the next
free ID, and it is allocated here as ISSUE-156 **P4**.

### 0.1a Stage 0 — **PASS** (operator evidence, 2026-09-13)

```
branch                       opus/issue-167-special-records-admin
HEAD                         bb2e0af2dcb744e81de324d3d2dfb5377a0970cd
main                         bb2e0af2dcb744e81de324d3d2dfb5377a0970cd
origin/main                  bb2e0af2dcb744e81de324d3d2dfb5377a0970cd
git log main..HEAD           empty
git log HEAD..main           empty
worktree list                exactly one ISSUE-167 worktree, D:/dev/afldb-issue-167
branch search "167"          only opus/issue-167-special-records-admin
git log --all --grep 167     empty
repository search "ISSUE-167" only the four planning files this session created
git diff --check             clean
working tree                 only those four planning changes
```

**HEAD, `main` and `origin/main` are the same commit**, so the worktree is based cleanly
on current main with nothing ahead or behind. The ID is unused everywhere — tracking
files, runbooks, branches, worktrees and git history. **Stage 0 is PASS and the
allocation is proven.** No part of the allocation, history or main relationship remains
open.

### 0.2 Migration ceiling

`Glob src/db/migrations/*.sql` → highest is **`101_awards_honours_lifecycle.sql`**
(ISSUE-165 / P5). The next free number is **102**. It is **NOT allocated by this
document** — Stage 2 allocates it after re-running the all-refs collision check, because
other worktrees (ISSUE-164, ISSUE-111) may claim 102 first.

**Allocated at Stage 2 (2026-09-13): `102_special_records_lifecycle.sql`.** Gate G-7 was
re-run first and is recorded in §21.1.

### 0.3 Parent decisions inherited from ISSUE-156

Read from `AFLDB-ISSUE-156.md`:

| Line | Inherited decision |
|---|---|
| §0 row | Phase E ("Special records and durable suppression", ISSUE-155 §23, §12) is **P4** |
| Route table | `/admin/records/*` (first-kick, after-siren, family) is P4's surface |
| Capability table | `data.records.edit` / `.suppress` — Super Admin, via `requireCapability`. **Superseded by D-4 (2026-09-13): `data.specialRecords.read` / `.edit`, two capabilities** (§9) |
| Ownership table | `player_achievements` (053), `after_siren_kicks` (089), family list (088): **"Patch/suppress via override, never direct rewrite of source rows"**; `data_overrides` widened; explicit suppress operation |
| Migration table | P4 = **yes**, one migration: explicit patch/suppress operation on `data_overrides` (or smallest equivalent) + entity widening |
| Revalidation table | P4 revalidates player pages, records pages, match pages |
| §294 | P4 adds a table or NOT NULL football reference → **must add a `tools/db/promotion-inventory.ts` classification entry in the same change** |
| R-3 | Unclassified new table breaks production promotion → **stop before merge** |
| R-7 | `revalidatePath` inside a Server Action hangs the client → revalidation moves out of the pending path |
| Dependency graph | P4 depends on P1 (157) + P2 (158), both complete |

### 0.4 Decisions inherited from ISSUE-155 Phase E (§12)

Quoted contract, verbatim obligations:

1. Place record-family cards under `/admin/records`.
2. First-kick goal: **use the existing `player_achievements` family; do not add a
   parallel records table.** Manual addition = stable manual record with
   `manual_admin_edit` provenance. Correction of an imported fact = durable field
   override **keyed by the importer's stable source record ID**. Suppression = a
   tombstone/active suppression override so the next curated reload **cannot recreate
   the visible fact**. Restore deactivates the suppression with a new audit event.
3. After-siren: use `after_siren_kicks` and its existing event fields/query semantics.
   Require canonical player and match IDs where the grain requires them; validate
   participant/team/season consistency **without guessing from names**.
4. For both families: source reload must **delete/update only rows it owns**, preserve
   manual rows, **reapply active overrides**, and **fail closed** when a source key
   collides or cannot be resolved uniquely.
5. Required `data_edits` and the canonical mutation commit **atomically**.
6. Public record, player, match and search caches revalidated after commit.
7. **"A 'delete' button is presented as `Suppress record` with source and consequences;
   physical deletion is reserved for operator repair."**
8. **"No other record family is added merely because it is manually curated."**

Phase E stop conditions (§23): *"importer can resurrect suppressed facts or manual
additions cannot survive full supported reload."*

### 0.5 Operator command block — allocation proof (**executed; result in §0.1a**)

Retained for reproducibility. Run from the worktree.

```powershell
npm run preflight -- --mode read-only --issue 167
git -C D:\dev\afldb-issue-167 rev-parse main HEAD
git -C D:\dev\afldb-issue-167 merge-base --is-ancestor main HEAD; if ($?) { "HEAD contains main" } else { "HEAD is NOT a descendant of main" }
git -C D:\dev\afldb-issue-167 status --porcelain
git -C D:\dev\afldb-issue-167 worktree list
git -C D:\dev\afldb-issue-167 branch -a --list "*167*"
git -C D:\dev\afldb-issue-167 log --all --oneline --grep="ISSUE-167"
```

**Gate:** if any command shows an existing 167 branch, commit or runbook, or if HEAD is
not a descendant of `main`, **STOP** and do not proceed to Stage 1. **Gate passed
2026-09-13** — see §0.1a.

---

## 1. Objective and non-goals

### 1.1 Objective

Give administrators one authoritative, audited, capability-gated, replay-safe surface
for the two Phase E special-record families, so that:

- a wrong source-provided fact can be **corrected** without editing the source row's
  identity and without the correction being reverted by the next reload;
- a fact that should never have been published can be **suppressed** (void) without a
  destructive `DELETE`, and **cannot be resurrected** by an importer rerun, a scoped
  reload, or a full destructive rebuild;
- a genuinely manual record can be **created** under `manual_admin_edit` provenance with
  an administrator-minted stable identity that can never collide with a source key;
- a suppressed record **disappears from every public read model** — record pages, player
  pages, NL search answers and the Grid Solver — while remaining fully visible in the
  admin surface and in `data_edits`;
- every mutation writes a `data_edits` row **atomically** with the canonical change.

### 1.2 Non-goals (explicit)

| Excluded | Owner |
|---|---|
| Brownlow vote entry / correction / finalisation | ISSUE-155 Phase C, already delivered; **P4 must never become a second Brownlow authority** |
| General match-sheet editing, score/stat correction | `data.dataEditor`, the nightly settle |
| Merging two player identities | **P9** |
| Coach reconciliation / supersession | **P9** |
| Merging or relinking source-owned entity identities | **P9** |
| General player/entity merge tooling | **P9** |
| General fixture identity correction / rekey | **P10** |
| `/admin/data-editor` decomposition | **P8** |
| Wikipedia re-acquisition as a web-triggered refresh | **P7** (ISSUE-155 §13 keeps first-kick/after-siren reload operator-CLI-only) |
| Family / father-son record administration | **excluded — D-1 APPROVED 2026-09-13** (§3.3). Remains outside ISSUE-167 entirely |
| Creating a second player-link queue or authority for after-siren | **excluded — D-2 APPROVED 2026-09-13** (§3.5). P4 displays linkage state read-only and must not collide with ISSUE-164 |

P4 may **reference** an existing player or match. It must not implement, or partially
implement, a general identity-merge or rekey framework.

---

## 2. Current-state inventory by special-record family

### 2.1 Family A — First-kick goal (`player_achievements`, migration 053)

| Aspect | Current state | Evidence |
|---|---|---|
| Canonical table | `player_achievements`, `achievement_type` enum currently `('first_kick_goal')` only | `053_player_achievements.sql:35-79` |
| Source | `sources.key = 'wikipedia_first_kick_goal'` | `053:136-146` |
| Source identity | `source_record_id` = `fkg-NNN`, assigned in the **tracked, committed** manifest `data/records/first-kick-goal-ids.csv` | `import-first-kick-goal.ts:24-30, 118` |
| Identity uniqueness | `player_achievements_source_uq UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)` | `053:114-116` |
| Importer | `tools/records/import-first-kick-goal.ts` (TypeScript, `AFLDB_IMPORT_DATABASE_URL`) | — |
| Ownership scope | `WHERE achievement_type = 'first_kick_goal' AND source_id = <wikipedia source>` | `import-first-kick-goal.ts:331-336` |
| Deletion | **Yes** — retirement deletes the row, but only after a fail-closed preflight and an explicit `--accept-retirement fkg-N` for any row carrying a link decision | `:1029-1073, 1175-1189` |
| Rekey | `--rekey` one-time transition; a mixture of legacy and stable ids **aborts before mutation**; `ReloadAbort` rolls the whole transaction back | `:98, 315-407` |
| Link resolution | `player_achievements` **is** a `LINK_TARGET_TABLE`; unlinked rows appear in `/admin/player-links` | `src/db/queries/player-links.ts:37-45`; `src/app/admin/player-links/page.tsx:55` |
| Override seam | **NONE.** The importer reads `data_overrides` for nothing. `data_overrides.entity_type` does not admit `player_achievements` | `101_awards_honours_lifecycle.sql:284-296` |
| Lifecycle columns | **NONE.** No `status`, no `status_reason`, no `updated_at` | `053:37-79` |
| Public consumers | `/records/first-kick-goal`, player-page honours (`src/db/queries/awards.ts:541-560`), Grid Solver (`grid-solver.ts:1019-1062`), NL answers (`nl/achievement-summary.ts`, `nl/parser.ts:3265`, `grid-solver-spec.ts:369`) | — |
| Second destruction path | `src/db/queries/match-admin.ts:401` — `DELETE FROM player_achievements WHERE match_id = $1` when an admin deletes a match | — |

**Verdict:** stable identity **exists and is strong** (tracked, committed, never reused,
retirement reserves the number). The contract is already fail-closed. There is **no**
correction or suppression seam of any kind.

### 2.2 Family B — After the siren (`after_siren_kicks`, migration 089)

| Aspect | Current state | Evidence |
|---|---|---|
| Canonical table | `after_siren_kicks` | `089_after_siren_kicks.sql:40-110` |
| Source | `sources.key = 'wikipedia_after_siren_kicks'` | `089:148-157` |
| Source identity | `source_record_id` = the artefact's `event_key`, first column of the tracked `data/records/after-siren-events.csv` | `after_siren.py:130-137, 586-588` |
| Identity uniqueness | `after_siren_kicks_source_uq UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)` | `089:138-140` |
| Importer | `tools/migration/after_siren.py load` (Python, imports `tools/migration/common.py`) | `after_siren.py:83, 1274` |
| Reload shape | **Upsert** keyed on `(source_id, event_key)`; rewrites a column only when it actually differs | `after_siren.py:586-588, 594-604` |
| Deletion | **Yes** — `DELETE FROM after_siren_kicks WHERE source_id = %s AND NOT (source_record_id = ANY(%s))`: any owned row absent from the artefact is removed, with no acknowledgement flag | `after_siren.py:992` |
| Ownership scope | `source_id` only — rows under a different source survive | same line |
| Link resolution | **NOT** a `LINK_TARGET_TABLE`. An unlinked after-siren row has **no admin queue at all** | `player-links.ts:37-45` |
| Override seam | **NONE.** `data_overrides.entity_type` does not admit `after_siren_kicks` | `101:284-296` |
| Lifecycle columns | **NONE** | `089:40-110` |
| Integrity constraints | Four non-trivial CHECKs: `_link_ck`, `_effect_ck` (couples `kick_effect`/`kicker_result`/`kick_scored`/margin), `_regulation_ck`, `_match_ck` (`premiership_season OR match_id IS NULL`), `_points_ck` | `089:94-109` |
| Public consumers | `/records/after-the-siren`, `/players/[slug]` (`getPlayerAfterSirenEvents`), Grid Solver (`grid-solver.ts:1036-1044`), NL `after_siren` grain (`nl/plan.ts:319, 1642`, `nl/after-siren.ts`), `gridley-compat.ts:533` | — |
| Rendering | `src/lib/after-siren-format.ts` `afterSirenEventLabel()` | — |

**Verdict:** stable identity **exists** (`event_key`, tracked artefact). No correction or
suppression seam. Its `DELETE` is **broader and less guarded** than Family A's — no
`--accept-retirement` equivalent, no link-loss check (it has no link queue to lose).

### 2.3 Shared current-state facts

- **`data_overrides`** (073, widened by 095/096/097/098/101) currently admits:
  `players`, `matches`, `draft_picks`, `coaches`, `match_coaches`, `season_list_members`,
  `fixtures`, `club_leadership`, `award_winners`, `hall_of_fame`, `honour_team_members`.
  **Neither P4 table is admitted** — confirmed live by P-4, whose reading matches
  migration 101's eleven literals exactly.
- **`data_edits.table_name`** (057, widened by 058/095/097/098) — **P-4 proved both P4
  tables absent**, so P4 needs a widening for `player_achievements` and
  `after_siren_kicks`. ISSUE-165 needed none, because 058 already admitted its three
  tables. Full constraint text in §15.0a.
- **`replay_admin_overrides(conn, table)`** lives in `tools/migration/common.py:1057`,
  with per-entity branches for `players`, `draft_picks`, `coaches`, `match_coaches`,
  `season_list_members`, and (ISSUE-165) the three honours tables. Each branch raises
  `RuntimeError` and refuses to commit on an unresolvable active override.
- **Asymmetry that shapes the whole design:** the after-siren importer is **Python and
  already inside `common.py`'s replay world**; the first-kick-goal importer is
  **TypeScript and completely outside it**. See §8.2 — this is the single largest piece
  of new work in P4.
- **`/admin/data-editor` has no special-record surface.** Repository-wide grep for
  `achievement|first_kick|firstKick|siren` under `src/app/admin/**` returns only the
  player-link queue label and two unrelated Hall-of-Fame "Career summary / achievements"
  form fields. **Nothing is retired or replaced by P4** — unlike P5, which took three
  create actions off `/admin/data-editor`.

---

## 3. Canonical ownership and identity matrix

### 3.1 What is canonical

| Family | Canonical thing | Kind |
|---|---|---|
| First-kick goal | the `player_achievements` row | **source row** for imported rows; **manual record** for admin-created rows |
| After the siren | the `after_siren_kicks` row | same |

Neither is a derived fact. Both migrations state explicitly that AFLDB has no
play-by-play data and cannot recompute either (`053:1-11`, `089:4-8`). The football fact
and the row are one thing; there is no separate canonical football fact to reconcile
against. **This is why suppression, not deletion, is the correct "remove" semantics:**
deleting the row destroys the only record that the claim was ever made.

### 3.2 Who owns identity

| Family | Row ownership | Identity | Owner |
|---|---|---|---|
| First-kick goal | imported | `fkg-NNN` in `data/records/first-kick-goal-ids.csv` | **source-owned, tracked** — immutable, never reused, retirement reserves |
| First-kick goal | manual | `first_kick_goal:<uuid>` under a `manual_admin_edit` source | **administrator-minted** |
| After the siren | imported | `event_key` in `data/records/after-siren-events.csv` | **source-owned, tracked** |
| After the siren | manual | `after_siren:<uuid>` under a `manual_admin_edit` source | **administrator-minted** |

**No family lacks a stable identity. Stop condition "a special-record family lacks a
stable identity" is NOT triggered.**

Two identity constraints that bind the design:

1. Both uniqueness constraints are `UNIQUE NULLS NOT DISTINCT`, so **at most one row in
   each table may carry `(NULL, NULL)`**. A manual row therefore **must** carry a real
   `source_id` (the `manual_admin_edit` source) and a minted `source_record_id`, or the
   second manual creation fails on the constraint. This is not optional.
2. A minted `<family>:<uuid>` can never collide with `fkg-NNN` or a Wikipedia
   `event_key` **by construction**, and it lives under a different `source_id` besides —
   the same double guarantee ISSUE-165 relied on (`101:96-99`).

### 3.3 Decision D-1 — the third "family" domain — **APPROVED: EXCLUDE (2026-09-13)**

**Operator decision: family/father-son is EXCLUDED. P4 is limited to first-kick goal and
after-the-siren. Family/father-son remains outside ISSUE-167.** The reasoning below is
the evidence that produced that decision and is retained as the record.

ISSUE-156's route table says `/admin/records/*` **(first-kick, after-siren, family)** and
its ownership table names "family list (088)". Against that:

- The **authoritative** Phase E text (ISSUE-155 §12) names **two** families and closes
  with *"No other record family is added merely because it is manually curated."*
- Migration 088 does not create a table. It adds CHECK constraints and a pair uniqueness
  to **`father_son_selections`, a migration 006 draft-relationships table**
  (`088:4, 21-37`; `006:130-150`).
- `father_son_selections.source_record_id` is plain `text UNIQUE` (**nullable, NULLS
  DISTINCT**), and the table has **no `add_provenance_columns` quartet**. Its identity
  guarantee is materially weaker than either Phase E family's.
- It sits in the **draft** subsystem, which is **P3b / ISSUE-160's** territory, and it
  carries *two* independent person links, which is exactly the shape P9 owns.
- Its public surface (`/records/family`, `/records/father-son`) is served by
  `src/db/queries/family-records.ts`, not by either Phase E query module.

**Recommendation:** exclude family/father-son from P4 and keep the route namespace open
for it. Designing it inside P4 would import a weaker identity contract into a phase whose
whole point is durable identity, and would cross into P3b and P9.

**Decided 2026-09-13: excluded.** The `/records/family` route namespace is left unclaimed.
Any future family/father-son administration is a separate issue with its own identity
evidence gate; it does **not** inherit Family A/B's schema unexamined.

### 3.4 What an administrator may change

Classification per family. **identity** = never editable in P4; **amendable** = editable
via a `correction` override; **link** = editable, resolved by ID not name; **derived** =
read-only.

**Family A — `player_achievements`**

| Field | Class |
|---|---|
| `id` | identity (surrogate; never surfaced as the edit key) |
| `source_id`, `source_record_id` | **identity — never editable** |
| `achievement_type` | identity (single-valued enum today) |
| `player_id` | **link** — via the existing `/admin/player-links` queue, *not* a new P4 mechanism |
| `player_name_raw`, `player_name_clean` | amendable (source spelling; correcting a transcription error) |
| `club_id` | link |
| `club_name_raw` | amendable |
| `season`, `round_raw`, `season_footnote_raw` | amendable |
| `consecutive_goal_kicks`, `no_further_career_goals`, `no_further_career_kicks`, `kickless_matches_before_first_kick` | amendable (legend decodings) |
| `match_id` | **link** — but see §3.4.1 |
| `source_annotation`, `notes` | amendable |
| `link_status_value`, `candidate_count` | **derived/read-only** — owned by the link pipeline and bound by `player_achievements_link_ck` |
| `import_batch_id` and the rest of the provenance quartet | derived/read-only |

**Family B — `after_siren_kicks`**

| Field | Class |
|---|---|
| `source_id`, `source_record_id` | **identity — never editable** |
| `player_id`, `club_id`, `opponent_club_id`, `match_id` | **link** |
| `player_name_raw`/`_clean`, `club_name_raw`, `opponent_name_raw` | amendable |
| `competition`, `season`, `round_raw` | amendable |
| `premiership_season` | amendable **but constraint-coupled** (`_match_ck`) |
| `kick_scored`, `kick_effect`, `kicker_result`, `siren` | amendable **but jointly constrained** by `_effect_ck` / `_regulation_ck` |
| `shot_detail`, `source_annotation`, `notes` | amendable |
| `kicker_score_raw`, `opponent_score_raw`, `kicker_points`, `opponent_points` | amendable **but constraint-coupled** (`_effect_ck` margin arithmetic, `_points_ck`) |
| `supergoal_scoring`, `cited` | amendable |
| `link_status_value`, `candidate_count` | **derived/read-only** |

#### 3.4.1 Stop-condition check — "an apparently manual field is actually derived elsewhere"

Three fields were tested against this stop condition and **all three are genuinely
derived**, so all three are classified read-only rather than amendable:

1. **`link_status_value` / `candidate_count`** (both tables). Written by the link
   pipeline; `*_link_ck` makes `(link_status IN ('unique','resolved')) = (player_id IS NOT NULL)`
   a hard invariant. An admin editing `link_status_value` directly could either create a
   silent guess or break the CHECK. **Not amendable.** Player linkage changes go through
   `/admin/player-links` for Family A. Family B has **no** queue — see decision D-2.
2. **`player_achievements.match_id`.** The column comment is explicit: *"resolved by
   career game position (1 + kickless_matches_before_first_kick), never by season/round/club
   lookup"* (`053:103-105`). It is **derived from `kickless_matches_before_first_kick`**,
   which is itself amendable. So P4 must not offer a free-text match picker here: editing
   `kickless_matches_before_first_kick` is the real correction, and `match_id` is its
   consequence. Offering both independently would let an admin create a row whose
   `match_id` contradicts its own decoding rule.
3. **`after_siren_kicks.club_id`.** `after_siren.py:554-559` — *"the era club actually
   stored is taken from the resolved MATCH wherever there is one"*. It is derived from
   `match_id` for any linked row, and only a match-less row falls back to the
   season-window rule. So `club_id` is editable **only** on a row with no `match_id`.

**These three findings are why P4 is a designed correction surface and not a generic
field editor.** Recorded as **gate G-2** (§14).

### 3.5 Decision D-2 — after-siren has no player-link queue — **APPROVED: DEFER (2026-09-13)**

**Operator decision: after-siren player-link resolution is DEFERRED. P4 may display
current linkage state but must not create another player-link queue or authority, and
must not collide with `AFLDB-ISSUE-164`.** Option (c) below is adopted; options (a) and
(b) are both refused. The evidence follows.

`after_siren_kicks` is not in `LINK_TARGET_TABLES`, so an unlinked after-siren row is
invisible to `/admin/player-links`. Options:

| Option | Effect | Assessment |
|---|---|---|
| **(a)** Add `after_siren_kicks` to `LINK_TARGET_TABLES` | Reuses the whole existing queue, `player_link_resolutions`, suggestions, audit | Touches ISSUE-164's live confidence work and adds an eighth target with `identity: 'none'` in promotion-inventory — **cross-issue risk while ISSUE-164 is open and uncommitted** |
| **(b)** P4 supplies an explicit link action on the after-siren admin row | Self-contained, no shared-queue change | A second link authority for one table — the thing §"reuse before invention" warns against |
| **(c)** Out of scope for P4; record as a follow-up | Smallest P4 | Leaves a real gap: an unlinked after-siren row cannot be linked anywhere |

**Decided 2026-09-13: (c).** (a) collides with ISSUE-164 while it is uncommitted; (b)
creates the second authority the parent forbids. P4 **displays** `link_status_value` and
`candidate_count` read-only with the resolved player where there is one, so the gap is
visible rather than silent, and adds **no** link mutation path. `LINK_TARGET_TABLES` is
**not** modified by P4. A tracked follow-up records the gap.

---

## 4. What "remove" means

**Suppression, never `DELETE`.** Lifecycle semantics, reusing the ISSUE-165 shape
(`101:48-59`) because the grain genuinely matches: a wrong first-kick-goal row or a wrong
after-siren row *was entered in error and never represented a real event*, exactly as a
wrong award winner was.

Two states, not three: `status IN ('active', 'void')`.

- There is deliberately **no `ended`** state. A first kick happens once; an after-siren
  kick happens once. Neither *ceases* the way a captaincy office does
  (`club_leadership`'s three-state model does not apply).
- `status_reason` is **mandatory whenever `status = 'void'`**, enforced by CHECK — the
  only thing separating a data-entry error from a real event.
- Voiding is **never** a `DELETE`: the row is kept so its `data_edits` rows and (Family A)
  its `player_link_resolutions.target_id` stay resolvable at the next promotion lineage
  remap.
- **Reinstate** sets `status` back to `active` and writes a new `data_edits` row. It does
  not erase the void's audit history.
- **Replace/supersede**: needed only when *identity itself* is wrong. The imported row is
  voided with a reason, and a **new manual row** is created under `manual_admin_edit` with
  a minted identity. P4 does **not** edit `source_record_id` to "fix" identity — that
  would be a rekey, which belongs to P10.
- **Physical deletion stays operator CLI repair only**, per Phase E §12 verbatim. The UI
  button reads **"Suppress record"**, states the source, and states the consequences.

### 4.1 The `hall_of_fame.removed_year` lesson, applied

ISSUE-165 drew a sharp line between "this ROW was wrong" and "a real thing was later
undone" (`101:55-60`). The equivalent trap here is **`after_siren_kicks.cited`**.
`cited = false` means *the source row carried no reference* — an **evidence gap recorded
rather than dropped** (`089:133-134`). It is a fact about the evidence, not about the
row's validity. **`cited` must never be conflated with `void`**, and an uncited row stays
publicly visible exactly as it is today. Recorded as **gate G-3**.

---

## 5. Read / write / rebuild / importer flow

### 5.1 Two layers, and why both exist

Directly inherited from ISSUE-165 §6.2 (`101:27-46`), and it applies here for the **same
mechanical reason**:

**Layer 1 — columns on the canonical row** (`status`, `status_reason`, `updated_at`).
These survive an **ordinary scoped reload** for free:

- *Family A:* `import-first-kick-goal.ts` writes an explicit column list. It never writes
  `status` — to be re-proven at Stage 2 against the actual `INSERT`/`UPDATE` column lists.
- *Family B:* `after_siren.py`'s `WRITTEN_COLUMNS` / `COMPARED_COLUMNS` tuples
  (`:594-604`) are explicit and closed; new columns are simply not in them. This is the
  same free protection `award_winners.sort_order` (061) already relies on.

**Layer 2 — a `data_overrides` row, replayed.** Layer 1 does **not** survive a full
destructive rebuild. Both tables carry `player_id REFERENCES players(id)`, so a
`TRUNCATE players CASCADE` empties both — the row is gone and every column with it. Layer 1
also does not survive Family A's **retirement `DELETE`** or Family B's
**`NOT (source_record_id = ANY(...))` `DELETE`**. The durable record is therefore the
`data_overrides` row, and the columns are its cheap read-path cache.

### 5.2 Three field groups

Mirroring ISSUE-165's D-9 (`101:233-254`), because the three replay semantics are
genuinely different:

| `field_group` | Payload | Replay when target row is **absent** |
|---|---|---|
| `lifecycle` | `status`, `status_reason`, replacement linkage; for a row of **either** ownership | **WARN AND RETAIN.** A source manifest that stopped carrying a row is not a reason to discard the human decision that the row was wrong |
| `correction` | a **delta** over a source-owned row's amendable metadata. Key presence is the semantics (migration 086 discipline): an absent key leaves the source value, an explicit JSON `null` clears it | **FAIL CLOSED.** The reload stops rather than silently reverting a human decision |
| `record` | the whole durable row of a `manual_admin_edit` creation | **RE-CREATE, then restore the payload.** A record override that cannot be reconstructed **FAILS CLOSED** |

`is_active` is **always `true`** for all three groups. The lifecycle lives in the
payload's `status`, because a voided row must be **re-created by the replay and voided
again**, not suppressed by it — suppressing it would delete the row whose `data_edits`
rows must stay resolvable. **No tombstone**, the ISSUE-162/163/165 shape rather than
ISSUE-161's.

### 5.3 `entity_key` shapes

`entity_key` is the row's **durable natural identity, never its `id`** — ids are
renumbered by a rebuild and by a promotion.

```
player_achievements   '<sources.key>:<source_record_id>'
                      e.g. 'wikipedia_first_kick_goal:fkg-042'
                           'manual_admin_edit:first_kick_goal:<uuid>'

after_siren_kicks     '<sources.key>:<source_record_id>'
                      e.g. 'wikipedia_after_siren_kicks:<event_key>'
                           'manual_admin_edit:after_siren:<uuid>'
```

Everything before the **first** colon is the source key. Both families reduce to the same
shape because — unlike `hall_of_fame` (`name|inducted_year`) and `honour_team_members`
(`team|player identity`) — **both P4 tables already carry a real, tracked source record
id on every row**. This is materially *simpler* than ISSUE-165's, and it is the direct
payoff of the identity discipline 053 and 089 established.

**Constraint:** the writer must refuse a `source_record_id` containing a colon, and
Stage 2 must prove by probe (§15, probe P-3) that no existing value contains one.

### 5.4 Flow diagram

```
ADMIN WRITE (Server Action, requireCapability, one transaction)
  ├─ compare-and-swap on updated_at  ──── stale? refuse, write nothing
  ├─ UPDATE/INSERT canonical row (status/status_reason/amendable fields)
  ├─ UPSERT data_overrides (entity_type, entity_key, field_group)
  └─ INSERT data_edits                    ← atomic with both (ISSUE-027)
     COMMIT
  └─ (outside the pending path — R-7) POST revalidation to the bounded allowlisted route

PUBLIC READ
  └─ every consumer adds  status = 'active'   (§7)

SCOPED RELOAD (importer rerun)
  ├─ Layer 1 columns untouched (not in the written-column list)
  ├─ replay_admin_overrides(<table>) re-asserts lifecycle + correction
  └─ manual rows untouched (different source_id)

FULL DESTRUCTIVE REBUILD
  ├─ rows gone with TRUNCATE players CASCADE
  ├─ importer repopulates source-owned rows
  └─ replay_admin_overrides(<table>) re-creates manual rows ('record'),
     re-applies corrections, re-voids voided rows — or FAILS CLOSED
```

---

## 6. Proposed schema changes

**One migration, number allocated at Stage 2** (next free is 102; re-check first).
Forward-only, additive.

### 6.1 Lifecycle columns

```sql
ALTER TABLE player_achievements
  ADD COLUMN status        text        NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT player_achievements_status_ck      CHECK (status IN ('active','void')),
  ADD CONSTRAINT player_achievements_void_reason_ck CHECK (status <> 'void' OR status_reason IS NOT NULL);

ALTER TABLE after_siren_kicks
  ADD COLUMN status        text        NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT after_siren_kicks_status_ck      CHECK (status IN ('active','void')),
  ADD CONSTRAINT after_siren_kicks_void_reason_ck CHECK (status <> 'void' OR status_reason IS NOT NULL);
```

`updated_at` is the **compare-and-swap** column for optimistic concurrency. The importers
must **not** maintain it.

**No `created_at`**, following ISSUE-165 D-8 (`101:70-73`): nothing reads a creation
instant, and the `data_edits` row already carries when and by whom.

**No speculative indexes**, following ISSUE-165 D-8 (`101:62-68`): every existing row will
be `'active'`, so a partial index on `status = 'active'` would cover the whole table and
buy nothing the existing access-path indexes do not already provide. An index is added
when a **measured** plan asks for one — recorded as a Stage 7 `EXPLAIN` check (§15, P-5).

### 6.2 Source-uniqueness — deliberately unchanged

Neither `player_achievements_source_uq` nor `after_siren_kicks_source_uq` changes. They
are not lifecycle keys: a voided row keeps its source record id, and a replacement is
always a new `manual_admin_edit` row whose minted uuid cannot collide by construction.

**Unlike ISSUE-165, no active-row-only uniqueness is needed**, because neither table has
a natural-key uniqueness rule that a replacement would collide with — their only
uniqueness *is* the source key, and a manual replacement never reuses it.

### 6.3 `data_overrides.entity_type` widening — **REQUIRED, proven by P-4**

Both tables are **absent** from the live `data_overrides_entity_type_check`, which P-4 read
as the eleven literals migration 101 left it with:

```
players, matches, draft_picks, coaches, match_coaches, season_list_members,
fixtures, club_leadership, award_winners, hall_of_fame, honour_team_members
```

Stage 2's migration **explicitly widens `data_overrides.entity_type` to include
`player_achievements` and `after_siren_kicks`**, retaining every existing literal verbatim.

**The `manual-authority.ts` proof must be re-checked** (`101:222-231`): `src/lib/acquisition/manual-authority.ts` reads this constraint **live** and refuses to APPLY
`match_period_scores`, `player_match_stats` or `brownlow_round_votes` if any appears here.
Neither P4 table is a settle target — the nightly settle writes matches and statistics and
touches neither a first-kick achievement nor an after-siren event — so this widening is
**order-independent** and safe to deploy before or after the code. **To be re-proven at
Stage 2 by reading `manual-authority.ts` directly**, not assumed from the 101 comment.

### 6.4 `data_edits.table_name` widening — **REQUIRED, proven by P-4**

Both `'player_achievements'` and `'after_siren_kicks'` are **absent** from the live
`data_edits_table_name_check`, which P-4 read as:

```
players, matches, draft_picks, award_winners, hall_of_fame, honour_team_members,
brownlow_vote_entry_state, brownlow_season_authority, coaches, fixtures, club_leadership
```

Stage 2's migration therefore **explicitly widens `data_edits.table_name` to include
`player_achievements` and `after_siren_kicks`**, retaining every existing literal verbatim.
This is no longer provisional — unlike ISSUE-165, which needed no widening because
migration 058 already admitted its three tables, P4 needs one for both of its tables.

Ordering rule inherited from ISSUE-155 §14.3 and 095's comment: *code that understands the
expanded check must be deployable before a constraint expansion that would otherwise make
manual-authority introspection fail closed*. The `data_edits` widening is purely additive
(it admits more names, refuses none) and so carries no such hazard — **but this must be
stated and re-checked, not assumed.**

### 6.5 Privileges — **SUPERSEDED by D-5 (operator decision, 2026-09-13)**

> **This section's original requirement was wrong and is not in force.** It asserted that
> the admin surface reads these tables on the **auth pool** and that Stage 2 must therefore
> add `afldb_auth` SELECT entries to `tools/maintenance/privileges.sql`. Stage 2 read
> current source and found the premise contradicted; the operator reviewed that evidence
> and **approved leaving `privileges.sql` unchanged (D-5, §19)**. The paragraph below is
> retained only so the superseded reasoning is legible. **The binding text is §21.6.**
>
> *Original: "But `afldb_auth` does. The admin surface reads these tables on the auth pool,
> and `privileges.sql`'s `afldb_auth` list is hand-typed and subtractive … Stage 2 must add
> `player_achievements` and `after_siren_kicks` SELECT for `afldb_auth` to
> `tools/maintenance/privileges.sql` in the same change."*

What remains true and in force:

Both tables already carry `grant_app_read` and `grant_import_write` (`053:151-152`,
`089:159-160`). Grants are **table-level**, so new columns need nothing further — and this
is the whole privilege requirement, because the reads run on the **app** pool and the
writes as **`afldb_import`**.

Umbrella R-2 (*a new read surface without a `privileges.sql` entry in the same change →
stop*) is discharged on the **correct pool**: both tables are in the catalogue registries
`afldb_meta.app_readable_tables` and `afldb_meta.import_writable_tables`, which
`privileges.sql` reconciles from without a hand-typed entry, and the whole contract —
including `afldb_auth`'s **absence** — is pinned by
`tests/integration/special-records-lifecycle.test.ts` rather than left to inspection.

`data_overrides` admin write already exists via migration 078's COLUMN-level grants —
**re-verified against 078 at Stage 2**, since ISSUE-165's memory records that owner-role
tests hid exactly this. They are 7 INSERT columns, 4 UPDATE columns and a table-level
SELECT, for `afldb_import` alone (§21.5).

### 6.6 No new table

P4 adds **no table**. Phase E §12 is explicit: *"do not add a parallel records table"*.
The suppress operation rides on the existing `data_overrides` schema via `field_group`,
which is the "smallest equivalent supported by its current schema" ISSUE-155 §14.4 asked
for. **No `data_overrides` structural change is required** — no new column, no new
operation column: `field_group` + `override_values` already carry it, exactly as
ISSUE-165 proved.

---

## 7. Public read-model changes

**This is the largest and most error-prone surface in P4.** Every consumer of either table
must filter `status = 'active'`, or a voided record still answers an NL question, still
satisfies a Grid Solver cell, and still appears on a player page — which would make
suppression a lie.

| Consumer | File | Family |
|---|---|---|
| `/records/first-kick-goal` | `src/app/records/first-kick-goal/page.tsx` → `getFirstKickGoalList`, `getFirstKickGoalSummary` (`src/db/queries/player-achievements.ts`) | A |
| Player page honours | `src/db/queries/awards.ts:541-560` | A |
| `/records/after-the-siren` | `src/app/records/after-the-siren/page.tsx` → `getAfterSirenRecords` | B |
| Player page after-siren block | `src/app/players/[slug]/page.tsx` → `getPlayerAfterSirenEvents` (`src/db/queries/after-siren.ts`, **6 fragments** at `:89, 97, 107, 117, 127, 178`) | B |
| Grid Solver | `src/db/queries/grid-solver.ts:1019-1062` — **5+ fragments** across both families | A + B |
| Grid Solver spec | `src/search/grid-solver-spec.ts:232, 369` | A + B |
| Gridley compat | `src/search/gridley-compat.ts:533` | B |
| NL plan / compile | `src/search/nl/plan.ts:319, 1642` (`after_siren` grain); `src/db/queries/nl/after-siren.ts`; `src/db/queries/nl/achievement-summary.ts` | A + B |
| NL parser | `src/search/nl/parser.ts:3265-3267` | A |
| `/admin/player-links` | `src/app/admin/player-links/page.tsx` | A — **voided rows must leave the link queue** (the ISSUE-165 precedent, `101:116`) |

**Stage 5 enumerates every fragment by grep and proves each one is filtered**, with a test
that fails if a new unfiltered reference appears. A count-based assertion alone is not
enough — the test names the fragments.

> **Superseded in four places by the Stage 5 execution inventory (§24.2), which was
> re-derived from current source and is authoritative.** The `src/search/*` rows above
> (`grid-solver-spec.ts`, `gridley-compat.ts`, `nl/plan.ts`, `nl/parser.ts`) hold **no SQL
> at all** — every one is a prose comment naming the table. `/players/compare` is a second
> consumer of `getPlayerHonours` and was missing. `src/db/queries/player-match-candidates.ts`
> is a consumer and was missing. All SQL over both tables lives in `src/db/queries/`.

**Revalidation** (ISSUE-156 revalidation table, R-7): player pages, records pages, match
pages. The Server Action returns `revalidatePaths`; the client POSTs them to the bounded
allowlisted route **after** the action resolves. `revalidatePath` is **never** called
inside the action — it hangs the Next 15.5 client (recorded in project memory and as
umbrella R-7).

---

## 8. Importer / rebuild replay contract

### 8.1 Family B — after-siren (Python, the straightforward half)

`after_siren.py` already imports from `common.py` (`:83`). Stage 4 adds an
`after_siren_kicks` branch to `replay_admin_overrides` and calls it inside the load
transaction.

Two changes to the existing load:

1. The `DELETE ... WHERE source_id = %s AND NOT (source_record_id = ANY(%s))` at `:992`
   must **refuse** to delete a row that carries an active `lifecycle` or `correction`
   override, rather than deleting it. Deleting it would destroy the row and leave the
   override orphaned; the replay's WARN-AND-RETAIN then could not restore it, because a
   source-owned row is not re-creatable from a lifecycle payload.
2. `WRITTEN_COLUMNS` / `COMPARED_COLUMNS` must **not** gain `status`, `status_reason` or
   `updated_at`.

### 8.2 Family A — first-kick-goal (TypeScript, the hard half)

**`import-first-kick-goal.ts` is TypeScript and has no access to `common.py`'s replay.**
This is the single largest new-work item in P4, and it is where the Phase E stop condition
actually bites.

Required:

- A **TypeScript replay** for `player_achievements` implementing the same three
  field-group semantics, or a deliberate, documented decision to invoke the Python replay
  as a separate step in the rebuild sequence.
- The retirement `DELETE` (`:1175-1189`) must **refuse** to delete a row carrying an
  active `lifecycle` or `correction` override — a third refusal class beside the existing
  `--accept-retirement` and `--allow-link-loss`.
- The existing `ReloadAbort` machinery (`:98`) is the right place: it is raised **before
  anything in the owned scope is written**, so the surrounding transaction rolls back
  untouched.
- `manual_admin_edit` rows carry a **different `source_id`** and so fall outside
  `owned` (`:331-336`) — they already survive untouched. **To be re-proven at Stage 2.**

### 8.2.1 Decision D-3 — **APPROVED WITH MODIFICATION (2026-09-13): one durable authority, two replay adapters**

**Operator decision, binding:**

- **`data_overrides` remains the sole durable authority.** No second authority table or
  mechanism is introduced.
- After-siren uses the **existing Python `common.py` replay contract**.
- `tools/records/import-first-kick-goal.ts` gets an **explicit TypeScript replay
  adapter** implementing the **same** `lifecycle` / `correction` / `record` semantics.
- **Both adapters must be pinned by parity/contract tests.**
- **Replay must be atomic with the owning importer.**
- Do **not** move first-kick into Python merely to share `common.py`.
- Do **not** introduce a second authority table or mechanism.

**If the TypeScript importer cannot replay overrides atomically within its existing
transaction structure, STOP and report rather than weakening the contract.**

This supersedes the planning recommendation (option (b), a `common.py` branch sequenced
by the orchestrator). The distinction the modification draws is the right one: **"one
authority" is a property of the durable store and the semantics, not of the
implementation language.** Two adapters over one authority is not two authorities,
provided the semantics are pinned — which is what the parity tests are for.

### 8.2.2 Atomicity — **structurally feasible, proven from source**

The D-3 stop condition (*"cannot replay atomically within its existing transaction
structure"*) is **NOT triggered**. Evidence from `tools/records/import-first-kick-goal.ts`:

| Fact | Line | Consequence |
|---|---|---|
| `postgres(dsn, { max: 1, onnotice: () => {} })` | `:740` | Single pooled connection; no second implicit session to diverge |
| `await sql.begin(async (tx) => { … })` opens the load | `:888` | **One transaction wraps the entire apply phase** |
| …and closes at | `:1353` | Every write between the two is in that transaction |
| `import_batches` row inserted **inside** `tx` | `:892-896` | The batch identity itself is transactional |
| `ReloadAbort` thrown **inside** `tx` | `:916, :936, :947, :1136` | An abort rolls the whole transaction back untouched — the documented ISSUE-078 contract at `:94-98` |
| Retirement `DELETE` and all upserts inside `tx` | `:1174-1301` | Nothing escapes the transaction |
| `rowIds` (stable key → surviving row id) is in scope | `:1308, :1319` | The replay has the key→id map it needs, already built |
| `data_issues` refiling and batch completion inside `tx` | `:1309-1344` | A natural seam exists **between** the upsert phase and the refiling |
| `await sql.end({ timeout: 5 })` in `finally`, outside `begin` | `:1354-1356` | Connection teardown does not commit anything |

**Therefore:** a TypeScript replay adapter placed inside the existing `sql.begin` callback
— after the upsert phase (`:1301`) and before the `data_issues` refiling (`:1309`) —
is atomic with the importer **by construction**, using the same `tx` handle, seeing the
same uncommitted state, and able to throw `ReloadAbort` to roll everything back. **No
change to the transaction structure is required, and nothing is weakened.**

Two supporting facts:

1. **The replay contract is read-only against `data_overrides`.** Every one of
   `common.py`'s twenty-plus override references is a `FROM data_overrides` read; none
   writes, updates or deletes one. That matches migration 073's grant exactly —
   `GRANT SELECT ON data_overrides TO afldb_import`, with the migration's own comment
   *"SELECT only: `data_overrides` is not importer-owned and must not enter
   `afldb_meta.import_writable_tables`"* (`073:29-38`). The TypeScript adapter runs under
   `AFLDB_IMPORT_DATABASE_URL` (`afldb_import`) and can honour the identical read-only
   contract. **Neither adapter may write `data_overrides`** — including the `lifecycle`
   warn-and-retain branch, whose whole point is that it does *not* delete the override.
2. **The `record` group needs INSERT on `player_achievements`**, which the importer
   already holds via `grant_import_write` (`053:152`). No privilege change is needed for
   the replay itself.

### 8.2.3 Parity/contract tests (D-3 requirement)

The two adapters are pinned by tests that assert **identical semantics**, not identical
code:

| Test | Asserts |
|---|---|
| Group semantics parity | For each of `lifecycle` / `correction` / `record`, both adapters produce the same outcome from the same override payload and the same starting row state |
| Absent-target parity | `lifecycle` → **warn and retain** in both; `correction` → **fail closed** in both; `record` → **re-create then restore, fail closed if unreconstructable** in both |
| Collision parity | Two overrides resolving to one `entity_key` **fail closed** in both |
| Read-only parity | Neither adapter issues any write against `data_overrides` |
| Atomicity | A forced replay failure inside the first-kick importer leaves `player_achievements`, `data_issues` **and** `import_batches` unchanged — the transaction rolled back whole |
| `entity_key` grammar parity | Both adapters parse `'<source key>:<record id>'` identically and both refuse a `source_record_id` containing a colon |

A single shared fixture set drives both sides, so a semantic drift in either adapter fails
the suite rather than silently diverging.

**Gate G-5 is revised** (§14): it no longer asks whether `rebuild-test.ts` can sequence a
subprocess call. It now requires that the TypeScript adapter runs on the importer's own
`tx` handle inside `sql.begin`, and that the atomicity test above is RED before the
adapter exists and GREEN after.

### 8.3 The third destruction path — `match-admin.ts:401`

`DELETE FROM player_achievements WHERE match_id = $1` runs when an admin deletes a match.
This is **outside both importers** and is not covered by any reload-survival mechanism.

Today it silently destroys a curated achievement row. After P4 it must **refuse**, the way
the same function already refuses a match carrying a Brownlow vote entry (`:377-385`):

> *"Match #N carries a first-kick-goal achievement (fkg-042) and cannot be deleted.
> Suppress or reassign that record in Special records (/admin/records/first-kick-goal)
> first."*

`after_siren_kicks.match_id` is **not** currently deleted there — Stage 2 must check
whether the match delete would now violate the FK, and if so extend the same refusal.

**This finding is in P4 scope**: it is a resurrection/destruction path for a Phase E
record, which §"identify every source/rebuild path that can recreate or overwrite these
records" explicitly requires. It is **not** general match-sheet editing.

### 8.4 Missing-source replay behaviour (fail-closed definition)

| Situation | Behaviour |
|---|---|
| `lifecycle` override names an absent row | **WARN AND RETAIN** the override; the reload proceeds. A manifest that stopped carrying a row is not a reason to discard the decision it was wrong |
| `correction` override names an absent row | **FAIL CLOSED** — `RuntimeError`, refuse to commit, name the unresolvable keys (max 10), the `common.py:1116-1120` shape |
| `record` override cannot be reconstructed or its player/match identity cannot be resolved | **FAIL CLOSED** |
| Source key collides (two rows resolve to one `entity_key`) | **FAIL CLOSED** — Phase E §12 verbatim |
| Importer would delete a row carrying an active override | **REFUSE the whole run**, before any write (§8.1, §8.2) |

---

## 9. Capability and privilege design

**D-4 APPROVED (2026-09-13): TWO capabilities, with the operator's chosen names.**

```ts
| 'data.specialRecords.read'   // ADMIN_AND_UP    — Admin + Super Admin
| 'data.specialRecords.edit'   // SUPER_ADMIN_ONLY — Super Admin
```

**Create, correct, void, suppress, reinstate and replace are all writes under `.edit`.
There is no separate `.suppress` capability.** This supersedes ISSUE-156 §2's working
name `data.records.edit` / `.suppress`. The `specialRecords` segment (rather than
`records`) also avoids colliding conceptually with `src/db/queries/records.ts`, which in
this codebase means computed leaderboards and nothing stored — the same naming hazard
migration 053 called out at `:21-23`.

Shape follows the ISSUE-165 precedent exactly (`capabilities.ts:121-134`).

**Rationale for `.read` = Admin-and-up:** the underlying facts are already public —
`/records/first-kick-goal` and `/records/after-the-siren` are public pages — and
`operations.audit.read` already gives an Admin the full `data_edits` trail. Reading a
record's provenance, lifecycle state and void reason widens no boundary that exists today.

**Rationale for `.edit` = Super Admin only:** correcting, voiding, reinstating, replacing
or creating a special record becomes a public fact **immediately, with no draft stage** —
the same reasoning as `data.coaches.edit` / `data.draft.edit` / `data.seasonLists.edit` /
`data.fixtures.edit` / `data.awards.edit`.

**Why two and not three** (the evidence behind D-4):

- ISSUE-165 faced the identical question for void/reinstate/replace and folded all of
  them into `data.awards.edit`.
- ISSUE-160 D-6 explicitly refused a third capability for new-player creation, on the
  ground that it was *"the class of mutation `data.draft.edit` already gates"*.
- Both `.edit` and `.suppress` would be `SUPER_ADMIN_ONLY`, so splitting them **separates
  nothing** — the same population holds both.

The departure from ISSUE-156's written table is recorded in the ISSUE-156 P4 handoff
contract and in the `issues.md` entry.

**Enforcement:** `tests/auth.test.ts` reads `capabilities.ts` as source and fails if a
capability is declared but enforced nowhere, or if an admin mutation ships without a
server-side guard (`capabilities.ts:24-26`). That test is the gate, not a manual check.

### 9.1 When each half is declared — **SEQUENCING CLARIFICATION, approved 2026-09-14**

**`data.specialRecords.read` is declared at Stage 3. `data.specialRecords.edit` is declared
at Stage 6, in the same change as the first mutation that guards on it.** D-4's outcome is
unchanged — two capabilities, Contributor neither, Admin `.read` only, Super Admin both —
and only the moment the union entry appears has moved.

The contradiction this resolves was found at Stage 3 against current source, not at
planning. `tests/auth.test.ts:1040-1046` is categorical:

```ts
const unenforced = DECLARED_CAPABILITIES.filter((capability) => !enforced.has(capability));
expect(unenforced, 'declared in capabilities.ts but no boundary calls requireCapability() with it').toEqual([]);
```

`enforcedCapabilities()` (`:1021-1027`) counts only an **awaited `requireCapability()`** at a
`page.tsx` / `route.ts` / `'use server'` boundary under `src/app/admin`. `hasCapability()` —
how a detail page derives `canEdit` (`src/app/admin/awards/page.tsx:47`) — is not
enforcement. So declaring `.edit` in a stage that ships no write leaves exactly three
options, and two of them are forbidden by the stage's own terms: ship a write path early,
or weaken the ISSUE-158 contract with a declared-ahead-of-enforcement exemption. The third
is to let the declaration travel with its guard, which is what every other `.edit`
capability in the table already did.

Operator decision, 2026-09-14: **the third.** Recorded as an implementation-sequencing
clarification to D-4, not a change to it. Neither `tests/auth.test.ts` nor any other
existing test was weakened, and no exemption list was added. Stage 6 adds the union entry,
the `SUPER_ADMIN_ONLY` role list, and the `EQUIVALENT_ROLE_GUARD` entry
(`'requireSuperAdmin'`) together with the first guarded mutation; `capabilities.ts` carries
the whole of that obligation in a comment beside `.read` so it cannot be lost.

**Nav:** one `Data` group entry, after `Awards & honours`:

```ts
{ href: '/admin/records', label: 'Special records', capability: 'data.specialRecords.read' }
```

**Privileges:** §6.5 as superseded by **D-5** — `privileges.sql` is **unchanged**. The admin
surface reads on the app pool and writes as `afldb_import`; `afldb_auth` gets nothing on
either table. See §21.6.

---

## 10. Admin route / UX design

### 10.1 IA decision

The Admin Centre `Data` group currently holds six entries (`nav-model.ts:86-93`): Player
links, Data editor, Coaches, Draft administration, Season lists, Fixtures, Awards &
honours. Adding two more top-level entries (First-kick goal, After the siren) would make
nine, for two small domains of a few hundred rows each.

**Decision: one nav entry, `/admin/records`, with domain subroutes.** This is also what
ISSUE-155 §12 states verbatim (*"Place record-family cards under `/admin/records`"*) and
what ISSUE-156's route table says (`/admin/records/*`).

```
/admin/records                              domain cards + counts (active / void)
/admin/records/first-kick-goal              search + list
/admin/records/first-kick-goal/[id]         detail: provenance, links, correct, void, reinstate, history
/admin/records/first-kick-goal/new          manual creation
/admin/records/after-the-siren              search + list
/admin/records/after-the-siren/[id]         detail
/admin/records/after-the-siren/new          manual creation
```

The `/records/family` namespace is left unclaimed pending D-1.

### 10.2 Operator workflows

| Workflow | Supported | Notes |
|---|---|---|
| Search / list existing records | ✅ | by player, club, season, source, lifecycle state, link status |
| Inspect source / provenance and links | ✅ | source key, `source_record_id`, batch, link status, candidate count, resolved player/match/club |
| Create a genuinely manual record | ✅ | `manual_admin_edit` source + minted `<family>:<uuid>`; player and match selected **by ID** with club/season/career disambiguation context, never by name (Phase E §12) |
| Correct amendable fields | ✅ | §3.4 classification; derived fields rendered read-only with the reason |
| Void / suppress | ✅ | **mandatory** reason; button reads "Suppress record"; shows source and consequences |
| Reinstate | ✅ | new audit event; does not erase void history |
| Replace / supersede | ✅ | void + create manual replacement, linked; **never** an identity edit |
| Inspect audit / history | ✅ | `data_edits` for the row, reusing the ISSUE-157 audit viewer components |
| Destructive delete | ❌ | **deliberately absent**; operator CLI repair only |
| Edit `source_record_id` | ❌ | identity; a rekey belongs to **P10** |
| Link an unlinked after-siren row | ❌ **D-2: excluded** | link status, candidate count and the resolved player displayed **read-only**; no link mutation path, no new queue, no change to `LINK_TARGET_TABLES` |

### 10.3 Concurrency and validation

- **Compare-and-swap on `updated_at`**: a mutation carrying a stale `expectedUpdatedAt`
  refuses **without writing anything** (the `admin-awards.ts` contract, `101:120`).
- **Family B constraint coupling**: the form must validate the `_effect_ck` /
  `_regulation_ck` / `_match_ck` / `_points_ck` relationships **in the action** and return
  a readable error, rather than surfacing a raw PostgreSQL constraint violation. Five
  coupled fields (`kick_scored`, `kick_effect`, `kicker_result`, `siren`, and the margin
  arithmetic over `kicker_points`/`opponent_points`) cannot be edited independently.
- **Family A**: `match_id` is not directly editable (§3.4.1); editing
  `kickless_matches_before_first_kick` re-derives it, and the form says so.
- **Focus handling**: a refused action must not drop keyboard focus to `body`. This is a
  **known live defect from ISSUE-155 §27.27 H** (project memory), and it is in P4's
  acceptance matrix, not assumed fixed.

---

## 11. Promotion-inventory impact

ISSUE-156 §294 is binding: P4 **must** add classification entries in the same change.

Current state read from `tools/db/promotion-inventory.ts`:

- `player_link_resolutions.target_id` classifies seven target tables — including
  `player_achievements` — as **`identity: 'none'`** (`:516-525`), with the remediation
  *"NO stable identity exists for an honours row … nothing in the tree carries an external
  key for one of their rows."*
- `after_siren_kicks` **does not appear anywhere** in the file.
- The entity registry (`:1514-1766`) resolves durable identities: `players` →
  `afltables_profile_url`, `matches` → `match_key`, `award_winners` → `award_winner_key`,
  `hall_of_fame` → `hall_of_fame_key`, `club_leadership` → `appointment_key`, etc.

**P4's required changes:**

1. **Two new entity registry entries**, resolving durable identity from
   `(sources.key, source_record_id)`:
   - `player_achievements` → `first_kick_goal_key`
   - `after_siren_kicks` → `after_siren_key`
2. **`data_edits` lineage targets** for both tables, so a `data_edits` row survives a
   promotion remap through a durable identity string rather than a renumbered integer —
   the exact obligation ISSUE-165 discharged for its three tables (`101:83-87`).
3. **Upgrade the `player_link_resolutions.target_id` classification for
   `player_achievements` from `identity: 'none'`.** The remediation text is **now factually
   wrong for this one table**: `fkg-NNN` in the tracked, committed
   `data/records/first-kick-goal-ids.csv` **is** an external key for one of its rows, and
   it has been since the ISSUE-078 rekey. This is a genuine correctness improvement that
   P4 is uniquely positioned to make, and it removes a real promotion hazard (a stale
   `target_id` silently reinstating and attaching a link decision to a different row).
4. ~~**`after_siren_kicks` must not remain unclassified**~~ — **WITHDRAWN at Stage 2: the
   premise was false.** `classifyPublicTables()` (`:2082-2104`) accepts a public table that
   is in EITHER `afldb_meta.import_writable_tables` OR `PROMOTION_CONTRACT`, and migration
   089's `grant_import_write('after_siren_kicks')` put it in the registry on the day it was
   created — as `053:152` did for `player_achievements`. Measured on `afldb_test`, and the
   live gate reports `[PASS] Table classification (fail-closed)`. **Umbrella R-3 was never
   at risk, and no classification entry was needed or added.** Items 1–3 above were the
   genuine work and all three were done (§21).

**Gate G-6:** `npm run db:promotion-check` must pass, and the **existing** ISSUE-139 /
ISSUE-143 pre-cutover refusals (UNKNOWN 079 + PENDING 091) must be **unchanged** — P4 must
not add a new refusal class. Project memory records those two refusals as pre-existing;
P4 re-baselines against them rather than treating them as its own regression.

---

## 12. Audit requirements

- Every mutation writes a `data_edits` row **in the same transaction** as the canonical
  change. A failed audit insert rolls the mutation back (ISSUE-027 contract, the
  `match-admin.ts:411-413` shape).
- `table_name` = `'player_achievements'` or `'after_siren_kicks'` (§6.4 widening).
- `row_id` = the surrogate id; the **durable** identity travels in the promotion-inventory
  lineage entry (§11.2), which is what makes the audit row survive a remap.
- `field_group` values mirror the override groups: `lifecycle`, `correction`, `record`.
- The void reason is captured in both `status_reason` (read path) and the `data_edits`
  payload (audit path).
- The ISSUE-157 audit viewer reads `data_edits` and needs **no change** beyond the new
  `table_name` values appearing — ~~to be confirmed at Stage 6~~ **ANSWERED AT STAGE 3, and
  the answer was yes, it carries one.** Two TypeScript allowlists shadow migration 102's
  CHECK and neither is derived from it: `DataEditTableName` / `DATA_EDIT_TABLE_NAMES`
  (`src/db/queries/audit-log.ts:59-83`) gate what `recordDataEdit()` may write and what a
  URL-supplied `?table=` filter is allowed to bind, and `DATA_EDIT_TABLE_LABELS`
  (`src/lib/audit-view.ts:61-73`) is a `Record<DataEditTableName, string>`, so the union and
  the labels cannot drift from each other but both could drift from the database. Both were
  widened in Stage 3 — read-only work, shipping no mutation — because without the union a
  record's own history could not be typed or rendered at all. Labels: *First-kick goal*,
  *After the siren*. `tests/special-records-admin.test.ts` now pins the TypeScript list
  against the literals parsed out of migration 102, so the two can no longer part company.

---

## 13. Migration / deploy order

```
1. Migration 102                     (lifecycle columns; data_overrides entity widening;
                                      data_edits table_name widening)
2. Code                              (queries, actions, routes, capability, nav,
                                      public status filters, importer refusals, replay,
                                      promotion-inventory)
3. UI exposure                       (nav entry becomes reachable)
```

**Why this order.** The `data_overrides` widening is order-independent (§6.3: neither
table is a settle target, and `manual-authority.ts`'s refusal proof is order-independent
about non-settle-targets), so the migration may land before or after the code.

**There is no `db:privileges` step, per D-5 (§21.6).** The earlier plan placed one here on
the belief that the admin pages read on the auth pool; they do not — they read on the app
pool, where both tables have been readable since 053 and 089, and they write as
`afldb_import`. `privileges.sql` is unchanged by P4, so there is nothing for a reconcile to
apply. The umbrella's recorded lesson (*"an admin page reading an operational table on the
wrong pool — only a real role enforces it"*, `AFLDB-ISSUE-156.md:730-733`) is honoured by
**proving the pool with real roles** (§21.5) rather than by widening a role that no code
path uses. Running `npm run db:privileges` on DEV remains harmless and is still worth doing
as routine reconciliation — it is simply not a P4 deploy dependency.

**Rollback.** Forward-only in production (ISSUE-155 §14). Rollback means **disabling the
new routes and actions while preserving every new `data_overrides` and `data_edits` row**.
Never down-migrate by deleting manual decisions. The lifecycle columns are additive with
safe defaults (`'active'`), so leaving them in place while the UI is disabled returns the
public read models to exactly their pre-P4 behaviour.

**Recovery.** If a replay fails closed during a rebuild, the durable decision is still in
`data_overrides` — nothing is lost. The operator resolves the named unresolvable keys and
re-runs. This is the designed outcome, not a failure mode.

---

## 14. Evidence gates and stop conditions

### 14.1 Gates that must pass before schema is written (Stage 2)

| Gate | Check |
|---|---|
| **G-1** | ✅ **SATISFIED by P-4 (2026-09-13).** Both live CHECKs read; `player_achievements` and `after_siren_kicks` are absent from **both**, so Stage 2 widens both, retaining every existing literal verbatim (§6.3, §6.4). No Stage 2 re-read is required |
| **G-2** | Re-prove the three derived-field findings (§3.4.1) against current source before any field is exposed as editable |
| **G-3** | Confirm `after_siren_kicks.cited` is **not** conflated with `void` anywhere in the design or the UI copy |
| **G-4** | Read `src/lib/acquisition/manual-authority.ts` directly and confirm the widening is order-independent for non-settle-targets |
| **G-5** | **(revised by D-3)** The TypeScript replay adapter runs on the importer's own `tx` handle inside `sql.begin` (`:888-1353`), between the upsert phase and the `data_issues` refiling. The atomicity test (a forced replay failure leaves `player_achievements`, `data_issues` and `import_batches` all unchanged) is RED before the adapter and GREEN after. **Feasibility already proven from source — §8.2.2** |
| **G-9** | **(new, D-3)** The adapter parity suite (§8.2.3) is green: identical group semantics, identical absent-target behaviour, identical collision behaviour, identical `entity_key` grammar, and **neither adapter writes `data_overrides`** |
| **G-6** | `npm run db:promotion-check` passes; ISSUE-139/143 pre-existing refusals unchanged |
| **G-7** | Re-run the all-refs migration-number collision check before allocating 10N |
| **G-8** | Confirm `import-first-kick-goal.ts`'s written-column lists exclude `status`/`status_reason`/`updated_at`, and that `manual_admin_edit` rows fall outside `owned` |

### 14.2 Stop conditions — status at end of planning

| Stop condition | Status |
|---|---|
| A family lacks a stable identity and no safe replacement key can be proven | **NOT triggered** — both families carry tracked, committed source identity (§3.2) |
| An apparently manual field is actually derived elsewhere | **TRIGGERED AND RESOLVED IN PLAN** — three fields found derived (§3.4.1); classified read-only rather than designed around. Re-proof is gate G-2 |
| Suppression cannot survive an importer/rebuild without changing ownership semantics | **NOT triggered.** D-3 is settled (one durable authority, two replay adapters), and §8.2.2 proves from source that the TypeScript adapter can run atomically inside the importer's existing `sql.begin` with **no structural change and nothing weakened**. The D-3 escape clause (*"if it cannot replay atomically, STOP"*) is **NOT invoked** |
| P4 would require a general player merge or fixture rekey | **NOT triggered** — identity edits are refused and routed to P9/P10 (§4, §10.2) |
| Current provenance cannot distinguish source-owned from manual records | **NOT triggered** — `source_id` distinguishes them, and `UNIQUE NULLS NOT DISTINCT` forces a manual row to carry a real source (§3.2) |
| A proposed migration conflicts with current main | **NOT triggered** — 102 free at planning time; re-checked at G-7 |
| Privileges/promotion behaviour cannot be made fail-closed | **NOT triggered, and CLOSED at Stage 2.** §11's promotion work was blocking and is done (§21.1–§21.4). §6.5's privilege work turned out to be a **premise error, not a task**: the pools were already correct, and D-5 approved leaving `privileges.sql` unchanged with the contract pinned by restricted-role tests (§21.5, §21.6). **No stop condition remains open on this issue** |

---

## 15. `afldb_test` evidence probes

Read-only. **The operator executes these; nothing in this plan relies on their results
until they are returned.** Run against `afldb_test` (never DEV, never PROD).

**P-1…P-4 are the Stage 1 gate.** P-5 and P-6 are Stage 2 sizing inputs and are not
blocking.

### 15.0 How to run P-1…P-4 (corrected against the 2026-09-13 execution)

`tools/probes/issue-167-stage1.sql` does not exist and is **not created by this planning
session**. The probe file is generated into the session scratch area, so nothing untracked
lands in the worktree.

**Environment facts, corrected by the actual run — do not restore the earlier wording:**

- **Worktrees do not carry their own `.env`.** Use the established shared env at
  `D:\dev\afldb\.env`. A `.env` lookup relative to the worktree finds nothing.
- **Do not hard-code port 55432.** That was one historical tunnel arrangement, not a
  property of `afldb_test`. Take the port from the configured DSN.
- **The safety contract is three conditions, all of which must hold:** the database name
  ends in `_test`; the host is `localhost` or `127.0.0.1`; and the configured local port
  has a **live listener**.
- **Proven endpoint as of 2026-09-13:** `127.0.0.1:5432/afldb_test`, listener verified,
  PostgreSQL client 16.15.
- `.env` values on this workstation carry a trailing CR that must be stripped.
- psql flags go **before** `-d <DSN>`.

```powershell
# 1. Read the DSN from the SHARED env (worktrees have no .env of their own).
$dsn = (Select-String -Path 'D:\dev\afldb\.env' -Pattern '^AFLDB_TEST_DATABASE_URL=' |
        Select-Object -First 1).Line -replace '^AFLDB_TEST_DATABASE_URL=','' -replace "`r",''

# 2. Safety contract: _test database + loopback host + a live listener on the CONFIGURED port.
$u = [uri]$dsn
if ($u.AbsolutePath.TrimStart('/') -notmatch '_test$') { throw "REFUSING: not a _test database: $dsn" }
if ($u.Host -notin @('localhost','127.0.0.1'))         { throw "REFUSING: non-loopback host: $($u.Host)" }
$port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
if (-not (Test-NetConnection -ComputerName $u.Host -Port $port).TcpTestSucceeded) {
  throw "REFUSING: no listener on $($u.Host):$port"
}
"Target OK: $($u.Host):$port/$($u.AbsolutePath.TrimStart('/'))"
```

Write the probe file as **UTF-8 without BOM** — `Out-File`/`Set-Content` add a BOM or the
ANSI codepage, and psql chokes on a BOM before the first statement:

```powershell
$sql = @'
SET TRANSACTION READ ONLY;
-- … the four probes, exactly as in §15.1 …
'@
$path = Join-Path $env:TEMP 'issue-167-stage1.sql'
[System.IO.File]::WriteAllText($path, $sql, [System.Text.UTF8Encoding]::new($false))
```

Then run it:

```powershell
psql -v ON_ERROR_STOP=1 --single-transaction -X -A -F ' | ' -P pager=off `
     -f $path -d $dsn
```

`--single-transaction` plus the `SET TRANSACTION READ ONLY` first statement makes the whole
run non-mutating **at the server**, not merely by inspection. `-X` skips `.psqlrc`.
`ON_ERROR_STOP=1` stops on the first error rather than continuing. **All four flags are
retained.**

<details>
<summary>Equivalent heredoc (Bash tool / Git Bash), if preferred over the PowerShell writer</summary>

```bash
cat > "$TEMP/issue-167-stage1.sql" <<'SQL'
SET TRANSACTION READ ONLY;

\echo '=== P-1  Row counts and source ownership per family ==='
SELECT 'player_achievements' AS t, s.key AS source, count(*) AS rows,
       count(*) FILTER (WHERE a.player_id IS NULL) AS unlinked,
       count(*) FILTER (WHERE a.match_id IS NULL)  AS unmatched
  FROM player_achievements a LEFT JOIN sources s ON s.id = a.source_id
 GROUP BY 1,2
UNION ALL
SELECT 'after_siren_kicks', s.key, count(*),
       count(*) FILTER (WHERE k.player_id IS NULL),
       count(*) FILTER (WHERE k.match_id IS NULL)
  FROM after_siren_kicks k LEFT JOIN sources s ON s.id = k.source_id
 GROUP BY 1,2
 ORDER BY 1,2;

\echo '=== P-2  Stable-identity coverage ==='
SELECT 'player_achievements' AS t,
       count(*) AS rows, count(source_record_id) AS with_key,
       count(*) FILTER (WHERE source_record_id !~ '^fkg-[0-9]{3,}$') AS off_pattern
  FROM player_achievements
UNION ALL
SELECT 'after_siren_kicks', count(*), count(source_record_id), NULL
  FROM after_siren_kicks;

\echo '=== P-3  Colon safety for the entity_key grammar ==='
SELECT 'player_achievements' AS t, count(*) AS with_colon
  FROM player_achievements WHERE source_record_id LIKE '%:%'
UNION ALL
SELECT 'after_siren_kicks', count(*)
  FROM after_siren_kicks WHERE source_record_id LIKE '%:%';

\echo '=== P-4  Live data_edits / data_overrides allowlists ==='
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname IN ('data_edits_table_name_check','data_overrides_entity_type_check')
 ORDER BY conname;
SQL
```
</details>

### 15.0a Stage 1 evidence gate — **PASS (executed 2026-09-13)**

Executed read-only against `afldb_test` at `127.0.0.1:5432/afldb_test` (listener verified,
PostgreSQL client 16.15), wrapped by `--single-transaction` with `SET TRANSACTION READ
ONLY`. **No further Stage 1 DB evidence is required.**

**P-1 — PASS.** No NULL-source ownership group in either family, so the single
`(NULL, NULL)` slot that `UNIQUE NULLS NOT DISTINCT` permits is **unoccupied** in both
tables and the manual-creation design of §3.2 stands unchanged.

| Table | Source | Rows | Unlinked | Unmatched |
|---|---|---|---|---|
| `after_siren_kicks` | `wikipedia_after_siren_kicks` | 126 | 6 | 10 |
| `player_achievements` | `wikipedia_first_kick_goal` | 334 | 4 | 6 |

The 334 also reconciles with migration 053's recorded note that the extract carried 334
rows against the source's stale prose claim of 332 (`053:130-135`) — the table is at its
expected size, not short.

**P-2 — PASS. Every current row in both families has stable source identity.**

| Table | Rows | `with_key` | `off_pattern` |
|---|---|---|---|
| `player_achievements` | 334 | 334 | 0 |
| `after_siren_kicks` | 126 | 126 | *(not asserted — see below)* |

`with_key = rows` in both. For `player_achievements`, `off_pattern = 0` confirms all 334
match `^fkg-[0-9]{3,}$`. **The after-siren `off_pattern` column was deliberately a NULL
placeholder in the probe and must not be read as a failed or skipped pattern check:** the
after-siren identity is the artefact's own `event_key`, which has no fixed regular shape to
assert against, so there is no pattern to test. Its identity guarantee comes from
`with_key = rows` plus `after_siren_kicks_source_uq`, both of which hold.

**P-3 — PASS.** `with_colon = 0` for both tables. The planned
`'<source key>:<record id>'` `entity_key` grammar (§5.3) is **admissible as designed**; no
separator change is needed, and the writer's refusal of a colon-bearing `source_record_id`
is a forward guard rather than a migration of existing data.

**P-4 — PASS, and it is the authoritative migration input for gate G-1.** Both allowlists
read live:

```
data_edits_table_name_check
  players, matches, draft_picks, award_winners, hall_of_fame, honour_team_members,
  brownlow_vote_entry_state, brownlow_season_authority, coaches, fixtures, club_leadership

data_overrides_entity_type_check
  players, matches, draft_picks, coaches, match_coaches, season_list_members, fixtures,
  club_leadership, award_winners, hall_of_fame, honour_team_members
```

**`player_achievements` and `after_siren_kicks` are absent from BOTH allowlists.** Stage 2
therefore widens both CHECKs — see §6.3 and §6.4, now settled rather than provisional.

Three corroborations worth recording, because they confirm the probe read a database at the
expected schema state rather than a drifted one: the `data_overrides` list matches migration
101's eleven literals exactly; `season_list_members` is absent from `data_edits` exactly as
migration 096 documented (*"no `data_edits.table_name` widening"*); and `match_coaches` is
absent from `data_edits` exactly as migration 095 documented (its composite primary key
means a coaching-assignment edit is audited against its match).

**This does not change the decision that P4 adds no new table and no structural change to
`data_overrides`.** Widening a CHECK constraint's allowlist is additive and admits more
values; it alters no column, no index and no key.

### 15.1 The probe SQL

```sql
-- P-1  Row counts and source ownership per family.
SELECT 'player_achievements' AS t, s.key AS source, count(*) AS rows,
       count(*) FILTER (WHERE a.player_id IS NULL) AS unlinked,
       count(*) FILTER (WHERE a.match_id IS NULL)  AS unmatched
  FROM player_achievements a LEFT JOIN sources s ON s.id = a.source_id
 GROUP BY 1,2
UNION ALL
SELECT 'after_siren_kicks', s.key, count(*),
       count(*) FILTER (WHERE k.player_id IS NULL),
       count(*) FILTER (WHERE k.match_id IS NULL)
  FROM after_siren_kicks k LEFT JOIN sources s ON s.id = k.source_id
 GROUP BY 1,2;
```
*Interpretation:* proves every row has a real `source_id` today. **A NULL `source_id`
group is a finding** — it would mean a row already occupies the single `(NULL, NULL)` slot
that `UNIQUE NULLS NOT DISTINCT` permits, which changes the manual-creation design (§3.2).
**Result: PASS — see §15.0a.**

```sql
-- P-2  Stable-identity coverage: is source_record_id populated everywhere?
SELECT 'player_achievements' AS t,
       count(*) AS rows, count(source_record_id) AS with_key,
       count(*) FILTER (WHERE source_record_id !~ '^fkg-[0-9]{3,}$') AS off_pattern
  FROM player_achievements
UNION ALL
SELECT 'after_siren_kicks', count(*), count(source_record_id), NULL
  FROM after_siren_kicks;
```
*Interpretation:* `with_key` must equal `rows` in **both** tables, and `off_pattern` must
be `0` for `player_achievements`. **Any shortfall is a STOP** — `entity_key` cannot be
formed for a row with no source record id, and the whole durable-override design rests on
it. The after-siren `off_pattern` column is a deliberate NULL placeholder: `event_key` has
no fixed regular shape to assert, so there is no pattern check for that family and a NULL
here is **not** a failure. **Result: PASS — see §15.0a.**

```sql
-- P-3  Colon safety for the entity_key grammar (§5.3).
SELECT 'player_achievements' AS t, count(*) AS with_colon
  FROM player_achievements WHERE source_record_id LIKE '%:%'
UNION ALL
SELECT 'after_siren_kicks', count(*)
  FROM after_siren_kicks WHERE source_record_id LIKE '%:%';
```
*Interpretation:* both must be `0`. A non-zero result means the
`'<source key>:<record id>'` grammar is ambiguous and the separator must change before
Stage 2. **Result: PASS — see §15.0a.**

```sql
-- P-4  Current data_edits and data_overrides allowlists, read live.
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname IN ('data_edits_table_name_check','data_overrides_entity_type_check');
```
*Interpretation:* the authoritative input to gate G-1. Widen only what is absent.
**Result: PASS, executed — both tables absent from both allowlists; the full constraint
text and its corroborations are in §15.0a. G-1's input is now settled evidence, not a
Stage 2 re-read.**

```sql
-- P-5  Access-path baseline for the deliberate no-index decision (§6.1).
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM after_siren_kicks WHERE premiership_season AND kick_effect = 'won';
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM player_achievements WHERE achievement_type = 'first_kick_goal';
```
*Interpretation:* the measured baseline. An index on `status` is added **only** if a
post-change plan measurably regresses — never speculatively.

```sql
-- P-6  Does the match-delete path have live collateral? (§8.3)
SELECT count(*) AS achievements_with_match FROM player_achievements WHERE match_id IS NOT NULL
UNION ALL
SELECT count(*) FROM after_siren_kicks WHERE match_id IS NOT NULL;
```
*Interpretation:* sizes the blast radius of `match-admin.ts:401` and tells Stage 2 whether
the after-siren FK would now block a match delete that previously succeeded.

**Known environment constraints.** See §15.0 for the corrected access contract — shared
env at `D:\dev\afldb\.env`, no hard-coded port, `_test` + loopback + live listener, proven
endpoint `127.0.0.1:5432/afldb_test`. Seven DB-backed gate assertions are **already
failing** as of 2026-09-13 (release-gates ×4, grid-solver ×2, data-editor, captaincies
manifest) — P4 re-baselines against that list rather than treating them as its own
regressions.

---

## 16. Test strategy (RED first)

Every stage writes a failing test before the fix.

| Stage | RED test | Home |
|---|---|---|
| 2 | `entity_key` formation + colon refusal; minted-identity collision impossible | new `tests/special-records-identity.test.ts` (no existing semantic home) |
| 2 | Migration applies; both CHECKs reject `void` without a reason | `tests/integration/` |
| 3 | Capability matrix: Contributor/Admin denied edit, Admin allowed read | `tests/auth.test.ts` (extends the existing declaration-vs-enforcement check) |
| 4 | **Suppression survives a scoped reload** | `tests/integration/first-kick-goal-reload-links.test.ts` (existing, correct home) |
| 4 | **Suppression survives a full destructive rebuild** (the Phase E stop condition) | `tests/integration/after-siren.test.ts` + the first-kick reload suite |
| 4 | Manual row survives a full supported reload | same |
| 4 | Importer **refuses** to delete a row carrying an active override | same |
| 4 | `correction` naming an absent row **fails closed**; `lifecycle` naming an absent row **warns and retains** | same |
| 4 | **Adapter parity (D-3)**: identical group semantics, absent-target behaviour, collision behaviour and `entity_key` grammar across the Python and TypeScript adapters, from one shared fixture set; **neither writes `data_overrides`** | new `tests/special-records-replay-parity.test.ts` (no existing semantic home spans both adapters) |
| 4 | **Atomicity (D-3)**: a forced replay failure inside `import-first-kick-goal.ts` leaves `player_achievements`, `data_issues` **and** `import_batches` unchanged | `tests/integration/first-kick-goal-reload-links.test.ts` |
| 5 | Voided row absent from **every** public consumer, fragment by fragment | `tests/integration/nl-answers-first-kick-goal.test.ts`, `nl-answers-after-siren.test.ts`, `tests/integration/grid-solver.test.ts`, `tests/integration/after-siren.test.ts` |
| 5 | Voided row leaves the `/admin/player-links` queue | `tests/player-link-*.test.ts` |
| 6 | Atomic `data_edits`: a forced audit failure rolls the canonical change back | `tests/integration/` alongside `admin-awards.test.ts` |
| 6 | Compare-and-swap refuses a stale `expectedUpdatedAt` **without writing** | same |
| 6 | `match-admin` refuses a match delete that would destroy a special record | `tests/admin-match-mutations.test.ts` (existing) |
| 7 | `npm run db:promotion-check`; `tests/db-promotion-check.test.ts` | existing |
| 7 | `npm run build` — the **only** thing that catches a Client Component value-importing a `server-only` module (umbrella lesson, ISSUE-162 §40) | — |

**No existing regression coverage is deleted, skipped, disabled or weakened.**

---

## 17. Staged implementation plan with stop gates

| Stage | Work | Stop gate |
|---|---|---|
| **0** | Allocation proof; D-1…D-4 | ✅ **COMPLETE — PASS 2026-09-13.** §0.1a; all four decisions recorded (§19) |
| **1** | Re-verify every §2 finding against current source; run probes P-1…P-4 | ✅ **COMPLETE — PASS 2026-09-13** (§15.0a). P-1/P-2/P-3 PASS; P-4 is the authoritative G-1 input. **No further Stage 1 DB evidence is required** |
| **2** | Migration 10N (lifecycle columns + **both** CHECK widenings, §6.3/§6.4) + `privileges.sql` + RED identity/constraint tests | ✅ **COMPLETE — PASS 2026-09-13** (§21). Migration **102** allocated and green on `afldb_test`; G-3, G-4, G-7, G-8 all PASS; G-6 re-baselined PASS. `privileges.sql` **unchanged by D-5** (§19, §21.6) — the premise §6.5 rested on was contradicted by current source, the operator reviewed the evidence and approved, and the real-role privilege contract is pinned by tests instead. **No stop condition open** |
| **3** | Capability (`data.specialRecords.*`) + nav + read-only admin surface (list/detail/provenance, incl. read-only link state per D-2) | ✅ **COMPLETE — PASS 2026-09-14** (§22). Five routes, one nav entry, `data.specialRecords.read` declared and enforced on every one; `tests/auth.test.ts` green (150) and the three roles proven against the REAL guard; 14 new DB-backed admin-read assertions green on `afldb_test`. **`.edit` is deliberately NOT declared until Stage 6** — the ISSUE-158 contract fails a capability enforced at no boundary, and Stage 3 ships no write (§9, §22.2). D-4's final role matrix is unchanged. **No stop condition open** |
| **4** | Both replay adapters + importer refusals (**the Phase E stop condition**) | Gates G-5, G-9. Reload-survival, rebuild-survival, atomicity and adapter-parity tests green. **STOP** if a suppressed fact can be resurrected by any path, or if the TS adapter cannot run on the importer's own `tx` |
| **5** | Public read-model `status = 'active'` filters, fragment by fragment | ✅ **COMPLETE — PASS 2026-09-14** (§24). Eight query modules, 31 fragments, filtered and tested; §7's inventory re-derived from current source and **corrected in four places** (§24.2). Every public read path is filtered directly or by a proven helper, and a per-fragment source gate fails on any new unclassified reference. Admin still sees void rows; D-2 intact. 10 pre-existing failures proven pre-existing by in-place differential (§24.9). **No stop condition open** |
| **6** | Mutations: correct / suppress / reinstate / replace / create, atomic audit, CAS, revalidation out of the pending path | ✅ **COMPLETE — PASS 2026-09-14** (§25). `data.specialRecords.edit` declared and enforced at ten Server Actions and the revalidate route; atomicity, CAS zero-write, replay-compatibility and both match-admin refusals green on `afldb_test` as `afldb_import`. Two design contradictions found against current source and resolved by NARROWING (§25.3 F-1 match derivation, §25.4 F-2 manual club link) — no authority, audit, CAS or replay contract weakened. **No stop condition open** |
| **7** | `promotion-inventory.ts` entries + `db:promotion-check` + `npm run build` | ✅ **COMPLETE — PASS 2026-09-14** (§26). **G-6 PASS** — 8 gates, none failed, before and after the edit; **no new refusal class**, so umbrella R-3's STOP is not invoked. §11's items 1–3 were already discharged at Stage 2; what Stage 7 found missing was the replay STEP — neither operator surface named a special-record entity type, so a promotion would have republished every voided record, lost every manual one and then stopped at the `data_edits` remap. Both surfaces now name both families AND both adapters (§26.3). The build gate caught a **real defect Stage 6 could not see**: `identity.ts` imported `node:crypto` and a Client Component reaches it, so `npm run build` failed outright; fixed by minting from Web Crypto, with no semantic change (§26.5). Build exit 0, 1534/1534 static pages. **No stop condition open** |
| **8** | Operator commits; DEV deploy (migration → code — **no `db:privileges` dependency, per D-5**; a routine reconcile is harmless but applies nothing for P4); browser acceptance | Acceptance matrix §18 |

Stages 4 and 5 are the two that can invalidate the design. Neither may be skipped or
merged into another stage.

---

## 18. Final acceptance matrix

**Roles** — each proven against a **real role on DEV**, not a local mock (the umbrella's
recorded lesson: a wrong-pool read is only caught by a real role).

| Check | Contributor | Admin | Super Admin |
|---|---|---|---|
| `/admin/records` reachable | ✗ denied | ✓ | ✓ |
| Nav entry visible | ✗ | ✓ | ✓ |
| Record detail / provenance / history | ✗ | ✓ read-only | ✓ |
| Correct amendable field | ✗ | ✗ | ✓ |
| Void / reinstate | ✗ | ✗ | ✓ |
| Create manual record | ✗ | ✗ | ✓ |
| Direct Server Action POST (guard bypass attempt) | ✗ HTTP-layer denial | ✗ | ✓ |

Denials must be **HTTP-layer redirects, not 200 + meta-refresh** — ISSUE-166's resolved
contract; P4 inherits it and must not regress it.

**Browser / responsive** — Playwright, three roles × 320 / 768 / 1000 / 1280 / 1920,
matching the ISSUE-156 batch convention. Device priority desktop > tablet > phone;
phone-only polish is a follow-up, not a P4 blocker.

**Behavioural**

- A voided record disappears from `/records/first-kick-goal`, `/records/after-the-siren`,
  the player page, NL answers and the Grid Solver — and remains fully visible in
  `/admin/records` and the audit viewer.
- A refused action **does not drop keyboard focus to `body`** (the known ISSUE-155 §27.27 H
  defect — verified here, not assumed fixed).
- A stale `expectedUpdatedAt` refuses and writes nothing.
- Revalidation happens after the action resolves; the client does not hang.

---

## 19. Operator decisions — **five RECORDED 2026-09-13, D-6 RECORDED 2026-09-14**

| # | Decision | Outcome |
|---|---|---|
| **D-1** | Family / father-son scope | **APPROVED — EXCLUDE.** P4 is limited to first-kick goal and after-the-siren. Family/father-son remains outside ISSUE-167 entirely. The `/records/family` namespace is left unclaimed (§3.3) |
| **D-2** | After-siren player-link resolution | **APPROVED — DEFER.** P4 may display current linkage state but must **not** create another player-link queue or authority, and must not collide with `AFLDB-ISSUE-164`. `LINK_TARGET_TABLES` is not modified (§3.5) |
| **D-3** | Where Family A's replay lives | **APPROVED WITH MODIFICATION — one durable authority, two replay adapters.** `data_overrides` stays the sole durable authority; after-siren uses the existing Python `common.py` contract; `import-first-kick-goal.ts` gets an explicit TypeScript adapter with the same `lifecycle`/`correction`/`record` semantics; both pinned by parity/contract tests; **replay atomic with the owning importer**; do not port first-kick to Python; no second authority mechanism. **Atomicity proven structurally feasible from source — §8.2.2; the STOP clause is not invoked** (§8.2.1–§8.2.3) |
| **D-4** | Capability shape | **APPROVED — TWO capabilities.** `data.specialRecords.read` (Admin + Super Admin) / `data.specialRecords.edit` (Super Admin). Create, correct, void, suppress, reinstate and replace are all writes under `.edit`; no separate `.suppress`. Supersedes ISSUE-156 §2's working name (§9). **Sequencing clarified 2026-09-14 (§9.1):** `.read` is declared at Stage 3, `.edit` at Stage 6 beside its first guarded mutation, because the ISSUE-158 enforcement contract fails a capability declared but enforced at no boundary. The final role matrix is unchanged |
| **D-5** | Which pool the special-record admin surface uses, and therefore whether `privileges.sql` changes | **APPROVED — `afldb_auth` gets NOTHING; `tools/maintenance/privileges.sql` stays unchanged.** Raised at Stage 2, not at planning: §6.5 had assumed the admin surface reads these tables on the auth pool, and current source contradicts that. **Supersedes §6.5.** The operator's grounds, recorded verbatim in substance: reads for these data surfaces use the app/public pool; writes use `afldb_import`; `afldb_auth` is reserved for operational/auth-owned tables; no current or planned ISSUE-167 path consumes these tables through `authSql`; and adding the grants would widen an otherwise deliberate boundary **without a caller**. The regression assertion is **retained** and must keep proving all five of: `afldb_app` can SELECT the lifecycle columns; `afldb_app` cannot mutate them; `afldb_import` holds the intended import/write privileges; `afldb_auth` has no access; and the auth privilege specification does not name either table. Evidence and consequences: §21.6 |
| **D-6** | Whether the four Grid Solver / NL after-siren fixture assertions that fail on current `afldb_test` should be re-baselined in ISSUE-167 | **DECIDED 2026-09-14 — DO NOT re-baseline; the item is CLOSED, not an open operator item.** Raised at Stage 5 (§24.9). The in-place differential is accepted as proof that the failures are independent of the Stage 5 filters — identical failures, assertions and values with the implicated filters present and reverted. They are recorded as **pre-existing / test-data-state drift caused by the current `afldb_test` linkage state, not an ISSUE-167 regression**. `tests/integration/grid-solver.test.ts` and `tests/integration/nl-answers-after-siren.test.ts` are **not** to be altered and Stage 5 scope is **not** widened; no product or test code changes under this decision — tracking clarification only. **Stage 5 is signed off with no stop condition open** |

### 19.1 Planning findings preserved unchanged by these decisions

Explicitly reconfirmed as still binding:

- derived/read-only fields stay derived/read-only (§3.4.1 — `link_status_value`,
  `candidate_count`, `player_achievements.match_id`, `after_siren_kicks.club_id`);
- **no new table** (§6.6);
- **no structural change to `data_overrides`** (§6.6) — and, per §8.2.2, no adapter may
  write it either;
- **fix the promotion inventory for `after_siren_kicks`**, which is absent entirely (§11.4);
- **correct the stale `player_achievements` `identity: 'none'` classification** to
  recognise the stable `fkg-NNN` manifest identity (§11.3);
- **`src/db/queries/match-admin.ts:401` is inside the durable-survival contract** (§8.3) —
  the match-delete path must refuse rather than destroy a special record.

---

## 20. Explicit boundaries restated

- **Family / father-son** — out of scope by **D-1**, not deferred within P4. It is not
  P4's to design, stage or annex.
- **P8** — `/admin/data-editor` decomposition. P4 retires **nothing** there: repository
  grep proves no special-record editing exists under `/admin/data-editor` today (§2.3).
- **P9** — player identity merges, coach reconciliation/supersession, merging or relinking
  source-owned entity identities, general merge tooling. P4 references an existing player
  or match by ID and refuses every identity edit.
- **P10** — general fixture identity correction and rekey. P4 never edits
  `source_record_id`; a wrong identity is handled by void + manual replacement (§4).
- **Brownlow** — entirely outside P4. ISSUE-155 Phase C already supplied the workflow, and
  `data_overrides` must never admit `brownlow_round_votes` (`101:298-299`).
- **P7** — web-triggered reload of either Wikipedia source. ISSUE-155 §13 keeps both
  operator-CLI-only *"until refactored into a bounded, idempotent library and manual-override
  survival tests pass"*. P4 delivers exactly those survival tests (Stage 4), so it **unblocks**
  a future P7 decision without taking it.

---

## 21. Stage 2 execution evidence — **PASS (2026-09-13)**

Everything below was executed from the worktree with operator authorisation for this
stage. Nothing was staged, committed, pushed, merged or deployed. **DEV and PROD were not
migrated.**

### 21.1 Gate G-7 — migration-number collision proof

Re-run before a number was allocated, across all four surfaces rather than the working
directory alone:

| Surface | Method | Result |
|---|---|---|
| Working tree | `ls src/db/migrations` | highest `101_awards_honours_lifecycle.sql` |
| **All 27 worktrees, including uncommitted files** | filesystem scan of every `D:\dev\afldb*/src/db/migrations` for a `102`–`199` prefix | **no match** |
| All local + remote refs | `git ls-tree -r <ref> -- src/db/migrations` over every `refs/heads` and `refs/remotes` | highest is `101` on `main`, `origin/main`, `opus/issue-166-…`, `sonnet/issue-165-…` and this branch; `100` elsewhere |
| Reachable history | `git log --all --diff-filter=A -- 'src/db/migrations/1[0-9][0-9]_*.sql'`; `git rev-list --all --objects` | only `100` and `101` were ever added; **0 objects** named `10[2-9]` |

The uncommitted-file scan is the one that matters here, because ISSUE-164's and
ISSUE-165's work is recorded as uncommitted in project memory and a `git`-only check
would not have seen a claim on 102. **102 is free. Allocated:
`src/db/migrations/102_special_records_lifecycle.sql`.**

### 21.2 Database identity proof

Re-proven before any migration or test command, by the §15.0 three-condition contract:
database name ends `_test`; host is loopback; a live listener answers on the **configured**
port.

```
Target OK: 127.0.0.1:5432/afldb_test  (user=afldb_owner)
```

`AFLDB_TEST_DATABASE_URL` was read from the shared `D:\dev\afldb\.env` (the worktree
carries none) with the trailing CR stripped. `psql` is not on `PATH` on this workstation;
it is at `C:\Program Files\PostgreSQL\16\bin\psql.exe`. Migration status before applying
read `101 already applied, 102 PENDING`; after, `Applied 1 migration(s)`.

**Recorded lesson — the runner refuses an edited applied migration, and it is right to.**
After 102 had been applied, its header comments were amended to cite D-5 (§21.6). The next
`--status` refused:

```
ERROR: these applied migrations have been modified since they ran:
  - 102_special_records_lifecycle.sql
Add a new migration instead of editing an applied one.
```

`tools/db/migrate.ts` stores a SHA-256 per applied migration, so **any** edit — comment-only
included — is drift. Reconciled the only way that is correct while 102 is uncommitted and
exists on no other database: reversed it on `afldb_test` inside one transaction (drop the
six lifecycle columns, which drops their CHECKs with them; restore both allowlists to the
eleven literals 101 and 098 left, with their original constraint comments; delete the
`afldb_meta.schema_migrations` row), then re-applied from the amended file — `ok (272 ms)`,
`0 pending`, checksum clean. Verified immediately beforehand that nothing depended on it:
**0** `data_overrides` rows and **0** `data_edits` rows using either new literal, and **0**
non-`active` rows in either table.

**This is a local-development reconciliation and nothing else.** Once 102 is committed, or
on DEV or PROD, the answer is a **new migration**, never an edit — §13's rollback rule is
forward-only. Two further consequences worth carrying: a full-suite run was in flight
against `afldb_test` while the columns were briefly absent, so **that run was discarded and
re-run** rather than reported; and the migration file must not be touched again now that
its checksum is recorded.

### 21.3 Stage 2 gates

| Gate | Result | Evidence |
|---|---|---|
| **G-1** | PASS (carried from P-4) | both live CHECKs re-read on the §21.2 database; both allowlists were exactly as §15.0a recorded |
| **G-3** | **PASS** | `after_siren_kicks.cited` is an EVIDENCE flag — 089's comment is *"false when the source row carried no reference; recorded as an evidence gap, not dropped"*. Grep of every consumer (`src/db/queries/after-siren.ts:177`, `src/db/queries/nl/after-siren.ts:144`, `src/search/grid-solver-spec.ts:232`) shows it **projected, never filtered on**. Migration 102 does not touch it, states the distinction in the `status` column comment, and an integration test asserts migration 102 voided **no** uncited row |
| **G-4** | **PASS** | `manual-authority.ts` read directly, not trusted from 101's comment. The proof is `overrideScopeProvenFrom()`'s four conditions; condition 4 is `editor ⊆ CHECK`, which only ever gets **easier** as the CHECK grows, and neither new entity is a settle target or an `EDITABLE_ENTITIES` key. Order-independent in both directions, and now asserted as a fact: `tests/current-season-import.test.ts` extends the equality chain with `overrideScopeProvenFrom([CHECK_AFTER_101]) === overrideScopeProvenFrom([CHECK_AFTER_102])` |
| **G-7** | **PASS** | §21.1 |
| **G-8** | **PASS** | `tools/records/import-first-kick-goal.ts` (NOT `tools/migration/` — the planning path was wrong) read directly. Its `INSERT` names 21 columns and its `UPDATE` names 18; `status`, `status_reason` and `updated_at` appear in **neither**. `owned` is scoped by `achievement_type` AND `source_id`, and the retirement `DELETE` carries both predicates, so a `manual_admin_edit` row — a different `source_id` — falls outside both by construction |
| **G-6** | **PASS, re-baselined** | `--phase source --database afldb_test` → `PASS — 8 gate(s) evaluated, none failed`, including `[PASS] Table classification (fail-closed)`. No new refusal class. The ISSUE-139/143 refusals live in the **pre-cutover** phase and are untouched by this change |

### 21.4 RED → GREEN

| # | RED | Evidence of RED | GREEN by |
|---|---|---|---|
| 1 | `tests/db-promotion-check.test.ts` — the standing contract that every admitted `data_edits.table_name` has a lineage target | `data_edits admits 'player_achievements' with no lineage target and no recorded exemption` — the existing test read the widened CHECK **out of migration 102** and refused | two new lineage targets in `promotion-inventory.ts` |
| 2 | `tests/special-records-identity.test.ts` (new) | `Cannot find package '@/lib/special-records/identity'` | new pure module |
| 3 | `tests/integration/special-records-lifecycle.test.ts` (new) | same | new pure module + migration applied |
| 4 | `tests/db-promotion-check.test.ts` — the seven `target_id` targets | `expected 'first_kick_goal_key' to be 'none'` | test updated to the corrected classification, plus a new assertion that ISSUE-139 D1 is **not** reopened |
| 5 | `tests/current-season-import.test.ts` — `OVERRIDE_ENTITY_TYPES` vs the live CHECK | `expected [ 'coaches', 'draft_picks', …(11) ] to deeply equal [ …(9) ]` | `CHECK_AFTER_102` fixture + inventory list extended |

Gate 1 is worth recording separately: **the repository's own standing contract caught the
omission before a human did**, which is exactly what ISSUE-165 built it for after four
issues had let the same obligation slip.

### 21.5 Restricted-role evidence

The owner-role trap ISSUE-165 recorded was closed rather than repeated.
`AFLDB_TEST_DATABASE_URL` authenticates as **`afldb_owner`**, so every privilege claim is
asked of the **catalogue for a named role**, and the importer's is additionally
**exercised over a real `afldb_import` connection** through
`createImportRoleParityHarness` (`AFLDB_TEST_IMPORT_DATABASE_URL` derived by swapping the
database name in `AFLDB_IMPORT_DATABASE_URL`).

| Role | Contract | Result |
|---|---|---|
| `afldb_app` | `SELECT` on all three new columns of both tables | **held** |
| `afldb_app` | no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` on either table | **none held** — the public role still cannot void a record |
| `afldb_import` | `SELECT`/`INSERT`/`UPDATE` on all three new columns of both tables | **held** — `grant_import_write()` is table-level, so the new columns are covered without a further grant. Asserted rather than assumed |
| `afldb_import` (real session) | `current_user = afldb_import`; counts both tables; `UPDATE … SET status='void'` inside a rolled-back transaction | **PASS**, 1,282 ms — a genuine restricted connection, and the row is verified still `active` afterwards |
| `afldb_auth` | `SELECT`/`INSERT`/`UPDATE`/`DELETE` on either table | **none held — and this is the decision, see §21.6** |

`data_overrides` grants were re-verified against migration 078 as §6.5 required: they are
**COLUMN-level** for `afldb_import` (7 `INSERT` columns, 4 `UPDATE` columns) plus a
table-level `SELECT`, and `has_table_privilege(…, 'INSERT')` correctly answers `false` for
them — which is exactly the shape ISSUE-165's memory records an owner-role test hiding.
`afldb_app` and `afldb_auth` hold nothing on `data_overrides`.

### 21.6 Decision D-5 — `privileges.sql` unchanged — **RAISED AND RESOLVED 2026-09-13**

**Status: APPROVED by the operator. Not an open stop condition.** It was raised as one
during execution, the evidence below was reviewed, and the decision is recorded as **D-5**
in §19. §6.5's original requirement is **superseded**.

§6.5 asserted that *"the admin surface reads these tables on the **auth pool**"* and
therefore required `player_achievements` and `after_siren_kicks` `SELECT` for `afldb_auth`
in `privileges.sql`. **Current source contradicts that premise**, so the change was not
made.

The evidence, read directly rather than inferred:

1. **`src/db/queries/player-links.ts:86-88`** says it in words, about this exact family of
   tables including `player_achievements`: *"Reads run on the public client: all seven
   tables are app-readable, and the queue needs nothing the public pages cannot see."*
2. **Every comparable admin data surface follows a three-pool shape.** Reads go through
   `@/db/client` (`afldb_app`); the canonical write plus its `data_edits` and
   `data_overrides` rows go through a short-lived `AFLDB_IMPORT_DATABASE_URL` transaction
   (`admin-awards.ts:274`, `admin-club-leadership.ts:336`, `admin-coaches.ts:53`,
   `admin-brownlow.ts:683`); `authSql` is used only for **operational** tables —
   `admin-draft.ts:361` reads `data_edits`, `admin-brownlow-ui.ts:82` reads `auth_users`,
   and both are already in the `afldb_auth` spec.
3. **ISSUE-165, the immediately preceding sibling with the identical shape, made no
   `privileges.sql` change at all**, and migration 101 states why at `:73-81`.
4. **`src/db/authClient.ts` documents the invariant the change would erode**: *"a
   compromise of the auth path still cannot touch statistics."*
5. **Live measurement** on `afldb_test`: `afldb_app` `SELECT` = true and `afldb_auth`
   `SELECT` = false on both tables — i.e. the pools are already exactly as the code
   expects.

So the R-2 obligation (*a new read surface without a `privileges.sql` entry in the same
change → stop*) is **discharged on the correct pool** instead: both tables already carry
`grant_app_read()` and `grant_import_write()` (`053:151-152`, `089:159-160`), both are
present in `afldb_meta.app_readable_tables` and `afldb_meta.import_writable_tables`
(measured), `privileges.sql` reconciles both registries from the catalogue with no
hand-typed entry, and the whole contract — including `afldb_auth`'s **absence** — is now
pinned by tests rather than left to inspection.

**The operator's decision (2026-09-13): APPROVED — do not add the grants; keep
`tools/maintenance/privileges.sql` unchanged.** The grounds recorded: reads for these data
surfaces use the app/public pool; writes use `afldb_import`; `afldb_auth` is reserved for
operational/auth-owned tables; no current or planned ISSUE-167 path consumes these tables
through `authSql`; and adding the grants would widen an otherwise deliberate boundary
**without a caller**.

**Binding consequences for the remaining stages.**

1. **`tools/maintenance/privileges.sql` is not to be edited by this issue.** A later stage
   that finds itself wanting an `afldb_auth` grant on either table has almost certainly
   put a read on the wrong pool — fix the query, not the grant.
2. **Stage 3 onwards must read these tables through `@/db/client`** and write them on a
   short-lived `AFLDB_IMPORT_DATABASE_URL` transaction, the `admin-awards.ts:274` shape.
   `authSql` is for `auth_users`, `data_edits` reads and the other operational tables only.
3. **§13's deploy order loses its `db:privileges` step** — there is nothing for it to
   apply. Updated in place.
4. **The regression assertion is RETAINED**, by explicit operator instruction, and must
   keep proving all five clauses:

   | Clause | Where |
   |---|---|
   | `afldb_app` can SELECT the lifecycle columns | *"gives afldb_app SELECT on both tables, including the new columns"* |
   | `afldb_app` cannot mutate them | *"gives afldb_app no write, so the public role still cannot void a record"* |
   | `afldb_import` holds the intended import/write privileges | *"keeps afldb_import write on both tables, new columns included"* + the real-connection test |
   | `afldb_auth` has no access | *"leaves afldb_auth without either table…"* |
   | the auth privilege specification does not name either table | same test, which parses `privileges.sql`'s `afldb_auth` section |

   All five live in `tests/integration/special-records-lifecycle.test.ts`. The fifth is
   what stops the decision drifting on one side only: a future edit to `privileges.sql`'s
   `spec` array fails the test, and a future edit to the test fails against the live
   grants.

### 21.7 Two planning claims corrected by execution

Both were found by reading current source, and neither changes a decision.

1. **§11.4 is wrong: `after_siren_kicks` was never "unclassified".**
   `classifyPublicTables()` requires every public table to be in EITHER
   `afldb_meta.import_writable_tables` OR `PROMOTION_CONTRACT`. Migration 089 called
   `grant_import_write('after_siren_kicks')`, so it has been in the registry — and
   therefore classified as rebuilt data — since the day it was created. Measured on
   `afldb_test`, and the live gate reports `[PASS] Table classification (fail-closed)`.
   The same is true of `player_achievements` via `053:152`. **Umbrella R-3 was never at
   risk.** The genuine promotion work was §11.1–§11.3, and all three were done.
2. **§5.3's colon refusal cannot be universal, and is now scoped.** §5.3 requires the
   writer to refuse a `source_record_id` containing a colon, but its own manual example
   — `'manual_admin_edit:first_kick_goal:<uuid>'` — contains one by construction, exactly
   as ISSUE-165's `'award_winner:<uuid>'` does. Resolved in the narrowest safe way: the
   **absolute** refusal is on a colon in the **source key**, which would steal the
   first-colon split point and make the two halves unrecoverable; the **manifest** guard
   (`assertSourceOwnedRecordId`) refuses a colon in a source-owned id, which is the
   forward guard P-3 evidenced. Both are tested, including a 500-mint collision check.

Also corrected in passing: the first-kick importer is at
**`tools/records/import-first-kick-goal.ts`**, not `tools/migration/`, which §8.2 / §14.1
imply. Stage 4 should use the real path.

### 21.8 A name collision Stage 4 must not be caught by

`tools/records/import-first-kick-goal.ts:928` aliases `link_status_value::text AS status`
into its `OwnedRow` type. That alias is TypeScript-local, predates migration 102's
`status` column and is unrelated to it — the importer writes neither. Recorded in the
migration header so the replay adapter's author sees it before writing a query that reads
`status` and gets the wrong one.

### 21.9 Files changed, and validation

**New**

| File | Purpose |
|---|---|
| `src/db/migrations/102_special_records_lifecycle.sql` | lifecycle columns on both tables; both CHECK widenings |
| `src/lib/special-records/identity.ts` | the pure `entity_key` grammar, minting and the two refusals. No `server-only`, no DB handle — the migration, the promotion inventory, both replay adapters and the admin writer all have to be able to import it |
| `tests/special-records-identity.test.ts` | the identity contract (§16 Stage 2) |
| `tests/integration/special-records-lifecycle.test.ts` | the migration, the CHECKs as **enforced**, both live allowlists, and the restricted-role privilege contract |

**Modified**

| File | Change |
|---|---|
| `tools/db/promotion-inventory.ts` | `LineageIdentityRule` += `first_kick_goal_key`, `after_siren_key` (+ doc block); two `data_edits` lineage targets; two `LINEAGE_IDENTITY_SQL` entries; `player_link_resolutions.target_id`'s `player_achievements` target corrected from `identity: 'none'`, with its remediation and the ISSUE-139 D1 `reason` made factually accurate **without changing the decision** |
| `src/lib/acquisition/manual-authority.ts` | `OVERRIDE_ENTITY_TYPES` inventory += both tables (documentation only — never the proof) |
| `tests/db-promotion-check.test.ts` | seven-target assertion updated to the corrected classification; `data_edits` target list += both; new assertion that D1 is not reopened |
| `tests/current-season-import.test.ts` | `CHECK_AFTER_102` fixture; migration-102 regex; `OVERRIDE_ENTITY_TYPES` expectations; order-independence chain extended |

**Not changed, deliberately:** `tools/maintenance/privileges.sql` (§21.6),
`LINK_TARGET_TABLES` (D-2), `data_overrides` structure (§6.6), both `*_source_uq`
constraints (§6.2), and every public read path (Stage 5).

**Validation**

| Check | Result |
|---|---|
| `tools/db/migrate.ts --target test` | `applying 102_special_records_lifecycle.sql ... ok (272 ms)`, `0 pending`, checksum clean (see §21.2 on the reverse-and-reapply) |
| `tests/special-records-identity.test.ts` + `tests/integration/special-records-lifecycle.test.ts` | **29 passed, 1 skipped** (the skip is the "restricted validation was skipped" reporter, correctly inactive because the harness IS configured) |
| `tests/db-promotion-check.test.ts`, `tests/current-season-import.test.ts`, `tests/data-overrides-source-contract.test.ts` | **405 passed, 4 skipped** |
| `after-siren`, `first-kick-goal-reload-links`, `privileges`, `nl-answers-after-siren`, `nl-answers-first-kick-goal`, `player-link-mutations`, `admin-awards` | **162 passed, 16 skipped**, 0 failed |
| **Full suite** (`npx vitest run`) | **44 failed / 7110 passed / 101 skipped (7275)**, 1,970 s — and **every one of the 44 also fails at baseline `9faba6f` with the identical set**. §21.10 |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` over every changed file | exit 0 |
| `npm run db:promotion:check -- --phase source --database afldb_test` | **PASS — 8 gates, none failed** |
| `git diff --check` | clean |

### 21.10 Full suite, and the baseline that makes it mean something

**Zero regressions attributable to Stage 2, proven by differential rather than argued.**

The run:

```powershell
# From the worktree, with NO .env present (see the environment note below).
$env:AFLDB_TEST_DATABASE_URL        = <shared .env value>                     # afldb_owner@afldb_test
$env:AFLDB_TEST_IMPORT_DATABASE_URL = <AFLDB_IMPORT_DATABASE_URL, db swapped> # afldb_import@afldb_test
$env:AFLDB_IMPORT_DATABASE_URL      = $env:AFLDB_TEST_IMPORT_DATABASE_URL
$env:AFLDB_AUTH_DATABASE_URL        = <AFLDB_AUTH_DATABASE_URL, db swapped>   # afldb_auth@afldb_test
npx vitest run --reporter=dot
```

| | Stage 2 (this branch) | Baseline `9faba6f` (same 11 files) |
|---|---|---|
| Test files | 11 failed, 174 passed, 2 skipped (187) | 11 failed (11) |
| Tests | **44 failed**, 7,110 passed, 101 skipped (7,275) | **44 failed**, 1,679 passed, 61 skipped (1,784) |
| Duration | 1,970 s | 877 s |

The baseline was a detached `git worktree` at `9faba6f` — the planning commit, i.e. this
branch **without any Stage 2 change** — in the same environment, against the same
`afldb_test`, running exactly the 11 files that failed. Comparing the two failing-test
lists as sets:

```
stage2 fail lines:   46
baseline fail lines: 46
=== IDENTICAL: every failing test in the Stage 2 run also fails at baseline 9faba6f,
    and vice versa ===
```

(46 lines = 44 failing tests plus the two-line suite-level entry for `admin-brownlow`.)
The baseline worktree was removed afterwards and `git worktree prune` run.

**The 44 pre-existing failures, by file and kind.** Every one is football-data semantics
against an `afldb_test` that lags the canonical rebuild — none touches special records,
lifecycle state, either widened allowlist, or promotion lineage.

| File | n | Kind |
|---|---|---|
| `club-comparison` | 24 | head-to-head, crossover, player averages/leaders, period-score rivalry |
| `database` | 4 | advanced-search regression cases; full player-match dataset count |
| `gridley-corpus` | 4 | dataset gaps — e.g. *"override Willem Duursma/2026 matched 0 players"* |
| `release-gates` | 4 | attendance `complete`/`not_collected` split; birth dates `expected 83 to be 18`; ladder rows; advanced search |
| `awards-reload-links` | 2 | captaincies + named-medals manifest reloads (`expected length 863, got 1191`) |
| `club-comparison-route` | 2 | route state for the same comparison data |
| `grid-solver` | 2 | finals-win cells, `expected 282 to be 283` |
| `finals-semantics-contract` | 1 | the known Windows CRLF case — splits on bare `\n`; passes on Linux |
| `admin-brownlow` | 1 | `Hook timed out in 30000ms` in `beforeAll` on `SELECT id FROM auth_users LIMIT 1` — contention in a 33-minute serial run |
| `data-editor` | 1 | targeted `club_seasons` rebuild refusal |
| `nl-answers-coaching` | 1 | Richmond coaching threshold vs hand-written `HAVING` |

Eight of these were already recorded as failing on this database earlier the same day,
before any ISSUE-167 change existed (`release-gates` x4, `grid-solver` x2, `data-editor`,
the captaincies manifest), which corroborates the differential independently.

**Corroborating structural argument**, which the differential now merely confirms:
migration 102 is **strictly additive** (six columns, all defaulted, on two tables) and
**strictly widening** (two CHECKs admit more and refuse nothing). No read path filters on
`status` yet — Stage 5 has not landed — so a defaulted column cannot change any query
result. The only vector that could have mattered is a test enumerating columns on those two
tables, and none of the 44 is of that kind.

**Environment note, which cost two invalid runs and belongs in the record.**

This worktree has **no `.env`** (worktrees do not carry one) and `tests/setup.ts` loads
`<root>/.env`, tolerating its absence. Two ways of supplying the configuration were wrong:

1. **Setting only the two test DSNs.** Every auth-pool test then fails with
   `AFLDB_AUTH_DATABASE_URL is not set` from `src/db/authClient.ts:35` — not a defect, a
   missing variable. 71 failures.
2. **Copying the shared `D:\dev\afldb\.env` into the worktree.** Worse: it drags in
   dev-oriented configuration, and — the real trap — `tools/migration/common.py`'s
   `load_env()` does `path.read_text()`, which on Windows decodes as **cp1252**. A copy
   written as UTF-8 raises `UnicodeDecodeError` and **every Python-importer test dies at
   startup**. 147 failures.

**The correct configuration is no `.env` plus the four explicit DSNs above**, which is also
what `tests/setup.ts` describes for CI (*".env is absent in CI; variables are expected to be
set already"*). A worktree `.env` is gitignored, so neither mistake could reach the
repository — but both invalidated a 30-minute run.

Also recorded: a full-suite run was in flight against `afldb_test` while migration 102 was
being reversed and re-applied (§21.2). **Stop the run first.** That run was discarded, not
reported.

**Database integrity after all four runs**, probed read-only: `award_winners` 3,712,
`players` 13,338, `matches` 17,051, `player_achievements` 334, `after_siren_kicks` 126,
`data_overrides` 0, `data_edits` 0, every special-record row `status = 'active'`, and **no
leftover `issue_167_fixture_source`**. The reload suites restore their own state, and this
issue's fixtures are removed in `afterAll`.

**Standing caveat.** Linux is the supported runtime (CLAUDE.md §11); a Windows run does not
prove Linux integration behaviour, and one of the 44 (`finals-semantics-contract`) is a
Windows-only artefact. The authoritative full-suite signal is a Linux/CI run. What this
differential establishes is narrower and is the thing that was asked: **Stage 2 introduces
no new failure.**

### 21.11 Stage boundary

Stage 2 ends here. **Not implemented, by design:** the admin route, capability and nav
(Stage 3); both replay adapters and the importer refusals (Stage 4); the public
`status = 'active'` filters (Stage 5); the mutations, atomic audit and CAS (Stage 6). No
DEV or PROD migration. Nothing staged or committed — the operator commits.

---

## 22. Stage 3 execution evidence — **PASS (2026-09-14)**

Executed from the worktree with operator authorisation for this stage only. Nothing was
staged, committed, pushed, merged or deployed; **DEV and PROD were not migrated**, and no
database other than `afldb_test` was contacted.

### 22.1 Checkpoint, before anything was edited

| Claim | Evidence |
|---|---|
| Worktree clean | `git status --porcelain=v1` — no tracked modification. One untracked **0-byte `b.kind`** (§22.9), not part of Stage 2 or Stage 3 and left in place |
| Branch / HEAD | `opus/issue-167-special-records-admin` @ **`8d9ac74`** |
| Stage 2 pushed | `git rev-parse HEAD` = `git rev-parse origin/opus/issue-167-special-records-admin` = `8d9ac744492f197c85eca430c625ada818b1ac10`; `git branch -r --contains 8d9ac74` lists the remote branch |
| Migration 102 is in that commit | `git log --oneline -1 -- src/db/migrations/102_special_records_lifecycle.sql` → `8d9ac74` |
| DB target is `_test` on loopback | §15.0 three-condition contract re-run: `Target OK: afldb_owner@127.0.0.1:5432/afldb_test`, listener verified on the **configured** port |
| **102 applied, checksum clean** | `npx tsx tools/db/migrate.ts --status --target test` → `102 migration file(s), 102 already applied … applied 102_special_records_lifecycle.sql … 0 pending`. The drift check runs **before** the `--status` branch (`tools/db/migrate.ts:261-279`), so a clean status listing is positive proof of no checksum drift, not merely an absence of complaint |

Migration 102 was not edited and must not be. Any future schema correction is 103+ after a
fresh G-7 collision proof.

### 22.2 The one design contradiction found, and how it was resolved

`tests/auth.test.ts:1040-1046` fails any capability declared in `capabilities.ts` that no
admin boundary awaits `requireCapability()` with, and Stage 3's own stop gate is that this
test is green. Declaring `data.specialRecords.edit` in a read-only stage therefore could
not be reconciled with the stage's other two terms — no write path, no weakened test.
Raised before implementation, resolved by the operator as a sequencing clarification to
D-4: `.read` now, `.edit` at Stage 6 with its first guarded mutation. **Full reasoning and
the decision text: §9.1.** No test was weakened and no exemption list was added.

### 22.3 What was built

| Route | What it does |
|---|---|
| `/admin/records` | Two family cards with active / void counts, both linking into a filtered list; the two-state explanation, including why an **uncited** kick is not a voided one |
| `/admin/records/first-kick-goal` | Search (source spelling, linked display name, or `fkg-NNN`), season, status, provenance and player-link filters; table + card layouts; pager |
| `/admin/records/first-kick-goal/[id]` | Identity, provenance, durable identity, lifecycle, read-only link state, derived detail, and the record's own `data_edits` history |
| `/admin/records/after-the-siren` | The same, plus a kick-effect filter and a `cited` **column** |
| `/admin/records/after-the-siren/[id]` | The same, plus the five coupled event fields shown together and the uncited notice |

One `Data` nav entry — `Special records` → `/admin/records`, gated on
`data.specialRecords.read`, placed after `Awards & honours`. **Not** two entries: §10.1.

New files: `src/db/queries/admin-special-records.ts`, `src/app/admin/records/labels.ts`,
`src/app/admin/records/SpecialRecordFacts.tsx`, the five `page.tsx` above,
`tests/special-records-admin.test.ts`, `tests/integration/admin-special-records.test.ts`.
Modified: `src/lib/auth/capabilities.ts`, `src/app/admin/nav-model.ts`,
`src/db/queries/audit-log.ts`, `src/lib/audit-view.ts`, `tests/auth.test.ts`.

**Reuse rather than a second implementation.** The per-record history is the ISSUE-157
viewer's own reader and renderer through the existing `RecordHistory` component
(`src/app/admin/awards/RecordHistory.tsx`), which is already generic over
`(DataEditTableName, rowId)`; an entry reads here exactly as it reads at `/admin/audit`,
because it is the same code rendering the same row. Relocating that component to
`src/components/admin/` is a reasonable tidy-up when Stage 6 grows this domain, and was
**not** done here rather than modify ISSUE-165's shipped files for cosmetics.

### 22.4 Query and pool architecture — **D-5 confirmed**

`src/db/queries/admin-special-records.ts` is a dedicated module, not SQL embedded in pages,
following `admin-awards.ts` / `admin-club-leadership.ts`. Both special-record tables are
read on **`sql` from `@/db/client` — the app/public pool — and nowhere else**. The module
does not import `@/db/authClient`, and neither does any file under
`src/app/admin/records/`. `tools/maintenance/privileges.sql` is **unchanged**: it grants
nothing on either table, and its only mention of `player_achievements` is a comment
explaining a `player_link_suggestions` grant.

The one auth-pool read anywhere in Stage 3 is `data_edits`, through
`listDataEditHistory()`. That is correct and is not a D-5 exception: `data_edits` is an
operational table that `afldb_auth` owns and the app role cannot read, and it is not one of
the two special-record tables D-5 is about.

Other properties, each pinned by a test rather than asserted here:

- **every join is `LEFT`** (nine of them), so an unlinked or unresolved row is never
  dropped by the joins that resolve a player, club, opponent or match;
- **no admin query carries `status = 'active'`** — Stage 5's filtering is a public-read-model
  concern, and an admin list that acquired it would hide what the surface exists to show;
- **every list is bounded** (`LIMIT`/`OFFSET`, page size clamped to 200) and every filter is
  a bound parameter — nothing is spliced;
- **no N+1**: two statements per list (page + count), two for the landing counts, one per
  detail read;
- `data_overrides` is deliberately **not** read yet. There are no override rows for these
  entities until Stage 4/6, and leaving it out keeps Stage 3 on one pool for these tables.

**One departure from the ISSUE-165 precedent, deliberate and recorded:** the admin lists
default to `status = 'all'`, where the awards lists default to `active`. This is the surface
whose job is to report what the lifecycle has removed from the public site, and the two
families hold 334 + 126 rows, so showing everything costs nothing and hides nothing. The
default is a named constant, `DEFAULT_ADMIN_STATUS_FILTER`, and is asserted.

### 22.5 Server-side access, proven for all three roles

Not nav hiding: `nav-model.ts` says of itself that a link omitted there is not a link that
is protected. All five routes `await requireCapability('data.specialRecords.read')` **before
they await anything else**, which `tests/auth.test.ts:1048-1064` enforces structurally.

The three-role proof is against the **real guard**, not a mock of the table —
`tests/auth.test.ts:1267` runs `it.each(DECLARED_CAPABILITIES)` through `requireCapability()`
with a signed cookie and a session row, so the new capability was covered the moment it was
declared:

```
✓ capabilities are exactly as strict as the role guards they replaced (AFLDB-ISSUE-158)
  > data.specialRecords.read admits the same viewers as requireAdmin()
✓ requireCapability against the real guard (AFLDB-ISSUE-158)
  > data.specialRecords.read: admits the viewers the table names and bounces the rest
    where the role guards did
```

| Role | `/admin/records/*` | Nav entry | Mechanism |
|---|---|---|---|
| Contributor | ✗ denied | ✗ | `requireCapability` → `NEXT_REDIRECT /admin/upload` |
| Admin | ✓ list + detail + history | ✓ | capability held |
| Super Admin | ✓ list + detail + history | ✓ | capability held |

**ISSUE-166's transport contract is intact.** The denial is a `redirect()`, which only
reaches the browser as a 307 if nothing has committed a 200 shell above it, so the rule is
structural: `tests/auth.test.ts:1291-1307` fails on any `loading.tsx` under `src/app/admin`
or at `src/app/loading.tsx`, and `:1309-1322` on any admin layout wrapping its children in
`<Suspense>`. Stage 3 adds neither, and `tests/special-records-admin.test.ts` asserts the
same two things again for this domain specifically, so the reason travels with the code.

### 22.6 D-2 and D-1, proven rather than asserted

**D-2.** `LINK_TARGET_TABLES` (`src/db/queries/player-links.ts:37-45`) is byte-for-byte
unchanged and is asserted member-by-member; `after_siren_kicks` is still absent. No file in
the records domain and nothing in the query module references `player_link_resolutions`,
calls a link-resolution function, or writes either table — asserted by pattern. What the
surface *does* do is display `link_status_value`, `candidate_count` and the resolved player
read-only, with the reason beside them (`LINK_STATE_NOTICE`), so the gap is visible rather
than silent. Nothing here can collide with AFLDB-ISSUE-164.

**D-1.** No family or father-son route, card, capability or query. The admin list
deliberately does **not** filter `achievement_type`: the enum has exactly one member, so a
predicate would buy nothing today and would silently *hide* a future family row rather than
surface it. The safety for that choice is an assertion that the enum still has one member —
admit a second and the test fails, which is the moment to decide what the surface should do.

### 22.7 No edit seam

Asserted, not intended: no `'use server'` module, no `method="POST"` form, no
`formAction` / `useActionState`, and no `/new` route anywhere under
`src/app/admin/records/`. The two detail pages carry **no** `<input>`, `<select>`,
`<textarea>` or `<button>` at all — the only controls in the domain are the GET filter forms
on the two lists, which narrow a query and write nothing. The derived and identity-bearing
fields (`link_status_value`, `candidate_count`, `player_achievements.match_id`,
`after_siren_kicks.club_id`, `source_id`, `source_record_id`) are displayed with the reason
they are not editable, so that when Stage 6's refusals arrive they are not the first an
administrator hears of the rule.

### 22.8 Validation

RED first, then GREEN. Before implementation the suites failed with **6 failing assertions
plus one suite that could not load** (`Cannot find package '@/db/queries/admin-special-records'`).

| Command | Result |
|---|---|
| `npx vitest run tests/auth.test.ts tests/special-records-admin.test.ts` | **172 passed**, 0 failed (`auth.test.ts` alone: 150) |
| `npx vitest run tests/integration/admin-special-records.test.ts` | **14 passed** on `afldb_test` — active + void both listed, unlinked rows survive every join, provenance and durable identity returned, `cited` proven independent of `status`, paging bounded |
| `npx vitest run` × 8 affected suites — `special-records-identity`, `admin-audit-viewer`, `data-overrides-source-contract`, `db-promotion-check`, `awards-admin`, `integration/special-records-lifecycle`, `integration/admin-audit`, `integration/privileges` | **296 passed, 1 skipped, 0 failed.** The Stage 2 D-5 privilege assertions — `afldb_app` SELECT, `afldb_app` no write, `afldb_import` write, **`afldb_auth` nothing**, and the auth specification naming neither table — are all still green |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` over every changed source and test file | exit 0 |
| `git diff --check` | exit 0 |

Four DSNs were set explicitly (no worktree `.env`, per §21.10), and **each of the four was
verified to end in `_test` before the runner was invoked** — a naive path swap had produced
`afldb_dev` targets on the first attempt, which the pre-flight check caught before any test
ran. No full-suite run: the focused Stage 3 surface is green and §21.10's 44-failure
baseline is unchanged by a read-only surface. A Linux/CI run remains the authoritative
full-suite signal (CLAUDE.md §11).

### 22.9 Observation, not a Stage 3 change

An untracked, empty `b.kind` sits in the worktree root (created 2026-09-14 05:38, the same
minute as the worktree directory's own mtime). It belongs to no stage of this issue, is
0 bytes, and was **left in place** rather than deleted — the operator owns the working tree.

### 22.10 Stage boundary

Stage 3 ends here. **Not implemented, by design:** both replay adapters and the importer
refusals (Stage 4); durable suppression survival; the public `status = 'active'` filters
(Stage 5); correct / void / reinstate / replace / create, the atomic audit, CAS and the
`match-admin` delete refusal (Stage 6); `promotion-inventory` closeout and `npm run build`
(Stage 7); DEV deployment and browser acceptance (Stage 8). `data.specialRecords.edit` lands
in Stage 6 with the first mutation that guards on it (§9.1). Nothing staged or committed —
the operator commits.

---

## 23. Stage 4 execution evidence — **PASS (2026-09-14)**

Both replay adapters, both importer refusals, and the two gates D-3 made the
condition of its approval: **G-5** (the TypeScript adapter runs on the importer's
own `tx`) and **G-9** (the two adapters are pinned to identical semantics).

### 23.1 Checkpoint, before anything was edited

| Fact | Evidence |
|---|---|
| Branch / HEAD / upstream | `opus/issue-167-special-records-admin`, `2a544441af3e105a4b353198d18e75cec9f2b417`, and `@{u}` at the same commit — nothing ahead or behind |
| Tracked tree | clean |
| Target database | `127.0.0.1:5432/afldb_test` — `_test` suffix, loopback host, live listener, the §15.0 three-condition contract |
| Migration 102 | `applied 102_special_records_lifecycle.sql`, **0 pending**, checksum clean — `migrate.ts --status` runs the drift check at `:262-270` *before* its status return, so one command proves both |

**One deviation, non-material and not touched:** an untracked **zero-byte** file
literally named `'status_reason'` (the quotes are part of the filename), created
2026-09-14 06:22:37 — a shell-quoting accident from an earlier session, not a
Stage 3 artefact. It cannot affect code, tests or the build, but it is why the
staging command in §23.9 is path-scoped and never `git add -A`.

### 23.2 What was built

**One durable authority, two adapters (D-3), and the semantics live in one place.**

| File | Role |
|---|---|
| `tools/records/special-records-replay.ts` (new) | The TypeScript adapter for `player_achievements`. Takes a **transaction handle**, never a pool — typed `Pick<TransactionSql, 'unsafe'>`, so the only thing it can do with the caller's transaction is run a statement on it: it cannot commit, roll back, or open a nested one |
| `tools/migration/common.py` | An `after_siren_kicks` branch of `replay_admin_overrides`, plus the `AFTER_SIREN_COLUMNS` amendable set and the two expression helpers the branch composes its SQL from |
| `tools/migration/after_siren.py` | `refuse_protected_retirements()` before the batch opens; `replay_admin_overrides(pg, TARGET_TABLE)` inside the load transaction |
| `tools/records/import-first-kick-goal.ts` | The third refusal class, and the replay call on the importer's own `tx` |

Six statements per adapter, in the same order on both sides: **validate the whole
active set and refuse** → **warn and retain** → **re-create `record` rows** →
**restore `record` payloads** → **apply the `correction` delta** → **apply the
`lifecycle` decision**. That is `hall_of_fame`'s shape (`common.py:2637-2857`),
which is the point: P4 adds no new mechanism.

### 23.3 The seam, and why atomicity needed no structural change

§8.2.2 proved the seam from source before a line was written, and execution
confirmed it unchanged. The call sits inside the existing
`await sql.begin(async (tx) => { … })`, **after** the human-decision re-apply and
**before** the `data_issues` refiling:

```
import-first-kick-goal.ts
  sql.begin(async (tx) => {                     ← one transaction, max: 1 pool
    INSERT import_batches … 'running'
    … ReloadAbort preflight, including the NEW protected-retirement refusal …
    DELETE data_issues / DELETE player_achievements   (retirement)
    UPDATE / INSERT player_achievements               (the upsert phase)
    … re-apply the human link decisions …
    replaySpecialRecordOverrides(tx, 'player_achievements')   ← HERE
    DELETE + INSERT data_issues                       (the refiling)
    UPDATE import_batches … 'completed'
  })
```

`ReloadAbort` is never caught anywhere in the importer, so any throw — the
adapter's `SpecialRecordReplayAbort` included — unwinds out of `sql.begin` and
rolls the whole run back. **No change to the transaction structure, and nothing
weakened.** The D-3 escape clause is not invoked.

### 23.4 The collision rule, defined rather than assumed

§8.4 requires "two applicable overrides resolving to one `entity_key`" to fail
closed, and execution had to make that precise, because the obvious reading is
**structurally unreachable**: `entity_key → (source key, source record id)` is
injective under the first-colon split, and both tables carry
`UNIQUE NULLS NOT DISTINCT (source_id, source_record_id)`, so two rows cannot
resolve to one key and two keys cannot resolve to one row.

What IS reachable is two overrides on **one key** — `data_overrides_uq` is
`(entity_type, entity_key, field_group)`, so different groups coexist freely. The
rule both adapters implement:

> A **`record`** override owns the whole durable row, its `status` included, so
> pairing it with any second authority over the same row makes the outcome
> order-dependent. **`record` + anything = FAIL CLOSED.**
> **`correction` + `lifecycle` is NOT a collision** — disjoint fields, defined
> order (correction, then lifecycle).

The structural `row_matches > 1` guard is retained as defence in depth. Both
halves — the refusal and the deliberate non-refusal — are corpus cases.

### 23.5 Gate G-9 — adapter parity

`tests/fixtures/special-records-replay-parity.json` is a **language-neutral
corpus**, and `tests/special-records-replay-parity.test.ts` drives **both**
adapters from it: the TypeScript one in-process on a transaction handle, the
Python one spawned out of the real `common.py`. Seeding is shared byte-for-byte,
so a divergence can only come from the replay. Every case asserts against the
corpus **and** against the other adapter.

| Corpus case | Both adapters |
|---|---|
| `lifecycle` on a present row | applied |
| `lifecycle` on a missing row | **warn and retain**, run proceeds, override still present |
| `correction` on a present row | delta applied; absent key leaves the source value, explicit JSON `null` clears it |
| `correction` on a missing row | **fail closed** |
| `record` re-creation | row re-created from the payload, `source_id` = `manual_admin_edit` |
| `record` re-creation of a **voided** row | re-created **and voided again** (§5.2's "no tombstone") |
| `record` that cannot be reconstructed | **fail closed** |
| `record` whose `player_identity` does not resolve | **fail closed** |
| `record` whose `player_identity` resolves | row comes back **linked**, `*_link_ck` satisfied |
| two applicable overrides on one `entity_key` | **fail closed** |
| `correction` + `lifecycle` on one row | **not** a collision |
| malformed `entity_key` (no colon) | **fail closed** |
| `entity_key` naming no source | **fail closed** |
| `entity_key` with an empty record-id half | **fail closed** |
| unknown `field_group` | **fail closed** |
| `lifecycle` payload with no valid status | **fail closed** |
| `void` payload with no `status_reason` | **fail closed** |
| **every** case | `data_overrides` fingerprint **unchanged** — neither adapter writes it |

**Result: 19 passed, 0 failed.** Seventeen corpus cases, plus a test that proves
the suite's own target is a `_test` database on loopback before it mutates
anything, plus one that proves the corpus really does cover both tables and both
adapters.

**The identity grammar is shared, not merely agreed.** Every fixture key is
minted by `src/lib/special-records/identity.ts`'s `specialRecordEntityKey()`, and
both adapters' SQL then has to resolve it to the right row — so the Stage 2
helper, the Python parser and the TypeScript parser are proven to agree by
construction rather than by inspection. `findProtectedRecordKeys()` was changed
during execution to take **minted keys** and match them whole, rather than
re-deriving the grammar in SQL, for the same reason.

### 23.5a G-9 RED → GREEN, and what the RED proved

The RED was unusually informative and is worth recording. With the **TypeScript
adapter written and the Python branch not yet added**, the suite reported
**16 failures — every one of them on the `after_siren_kicks (python)` side**, and
the `player_achievements (typescript)` half of every single case passed first.
Adding the `common.py` branch turned all 16 green with no change to the corpus or
to the TypeScript adapter.

That is the parity claim demonstrated rather than asserted: one corpus, two
independent implementations, and the corpus was expressive enough to fail one
side completely while the other satisfied it.

### 23.6 Gate G-5 — atomicity, RED before and GREEN after

**The forced failure is real contract behaviour, not an injected hook**, which is
the discipline ISSUE-165's audit-rollback gate established
(`admin-awards.test.ts:732-744` forces a foreign-key violation rather than adding
a test-only switch). A `correction` override naming an absent row fails closed by
§8.4; the replay runs after the retirement `DELETE` and the upsert phase have
already written inside the same transaction. So if the adapter were **not** on
the importer's own `tx`, the retirement would survive the failure.

All four §8.2.3 surfaces asserted unchanged after the refused run:
`player_achievements` (row present, id-set fingerprint, row count), `data_issues`,
`import_batches` (**no batch row at all** — the `INSERT … 'running'` rolls back
with everything else), and the retirement effect itself.

**Result: the six Stage 4 tests in
`tests/integration/first-kick-goal-reload-links.test.ts` are green** — 6 passed,
0 failed, 892 s, every one of them driving the REAL importer as `afldb_import`.

| Test | Time | Proves |
|---|---|---|
| Layer 1 — lifecycle columns untouched by an ordinary reload | 90.2 s | §5.1's free protection, with no override in play at all |
| Layer 2 — a lifecycle decision the canonical row lost is re-asserted | 91.8 s | the durable authority actually restores what the source cannot |
| a `record` row is re-created, and a second reload leaves it alone | 182.5 s | manual rows survive, and are outside `owned` (§8.2, re-proven) |
| `lifecycle` on an absent row warns, retains, and the run proceeds | 90.9 s | §8.4's asymmetry |
| the importer **refuses** to retire a row carrying an active override | **70.5 s** | the third refusal class — and the shorter time is itself evidence: it aborts in the preflight, before the write phase |
| **gate G-5** — the whole transaction rolls back on a fail-closed replay | 92.0 s | atomicity on the importer's own `tx` |

### 23.7 The two refusals

| Importer | Refusal |
|---|---|
| `import-first-kick-goal.ts` | A third `ReloadAbort` class beside `--accept-retirement` and `--allow-link-loss`, evaluated in the preflight at `:1115-1140` — **before** the retirement `DELETE` at `:1180` |
| `after_siren.py` | `refuse_protected_retirements()` runs **before `import_batch` even opens**, so a refused run writes nothing at all, not even a batch row |

**Neither is reachable past a flag, and that is deliberate.**
`--accept-retirement` authorises losing a durable *reference*;
`--allow-link-loss` authorises discarding a *link decision*. Neither is authority
to destroy the row a lifecycle or correction decision is attached to, because a
**source-owned row cannot be re-created from a lifecycle payload** — only a
`record` override carries a whole row, and a `record` override names a
`manual_admin_edit` row, which carries a different `source_id` and is outside
every source-owned retirement scope in the first place. The operator's route is
to reinstate or resolve the decision in Special records, which is a decision, not
a flag.

`record` is deliberately **not** consulted by either refusal, for that same
ownership reason.

**The after-siren half is proven against the REAL loader**, ten tests in
`tests/integration/after-siren.test.ts` driving `after_siren.py load`: Layer 1,
Layer 2, `record` re-creation surviving the stale-row `DELETE`, warn-and-retain,
and the refusal itself — plus the four pre-existing
`getPlayerAfterSirenEvents` tests, which are unaffected.

One fixture note, recorded because it is not obvious: the stale row the refusal
test protects is seeded **in the database**, not produced by trimming the
artefact. `cmd_load` validates the tracked `after-siren-events.source.json`
measures against whatever artefact it is handed, so a trimmed copy is refused
with *"measures disagree with the artefact"* — a provenance guard — long before
the lifecycle refusal is reached. Seeding a source-owned row the artefact never
carried models "the source stopped carrying this row" exactly, and leaves the
tracked artefact untouched.

### 23.8 One deliberate improvement on the ISSUE-165 replay, applied to both adapters

Every write in both adapters is guarded by `IS DISTINCT FROM` over the tuple it
would assign. `hall_of_fame`'s replay is unguarded, and on an **ordinary** reload
that would bump `updated_at` on every override-bearing row on every run — because
the lifecycle columns are Layer 1 and already carry the decision — invalidating a
concurrent administrator's compare-and-swap for no actual change. `updated_at` is
the CAS column the Stage 6 mutations depend on (§6.1), so the churn is not
cosmetic. This is the same discipline `after_siren.py:586-588` already applies to
its own upsert, and it is applied **identically on both sides**, so parity holds.

**Flagged for Stage 6, not decided here:** the replay still *does* set
`updated_at` when a value genuinely changes. That is correct — the row did change
— but Stage 6's CAS contract should state explicitly that a reload which
re-asserts a decision can legitimately invalidate an in-flight edit.

### 23.9 Files changed, and validation

**New**

| File | Purpose |
|---|---|
| `tools/records/special-records-replay.ts` | The TypeScript adapter, and `findProtectedRecordKeys()` |
| `tests/fixtures/special-records-replay-parity.json` | The language-neutral parity corpus (G-9) |
| `tests/special-records-replay-parity.test.ts` | The G-9 runner, driving both adapters from that corpus |

**Modified**

| File | Change |
|---|---|
| `tools/migration/common.py` | `SPECIAL_RECORD_FIELD_GROUPS` / `SPECIAL_RECORD_STATUSES` / `AFTER_SIREN_COLUMNS` + two expression helpers; the `after_siren_kicks` replay branch |
| `tools/migration/after_siren.py` | `refuse_protected_retirements()`; the replay call inside the load transaction; `replay_admin_overrides` imported. `WRITTEN_COLUMNS` / `COMPARED_COLUMNS` **unchanged** |
| `tools/records/import-first-kick-goal.ts` | The protected-retirement refusal; the replay call on `tx` at the §8.2.2 seam; the Stage 2 identity helper imported |
| `tests/integration/first-kick-goal-reload-links.test.ts` | Six Stage 4 tests, including gate G-5 |
| `tests/integration/after-siren.test.ts` | Six Stage 4 tests driving the REAL `after_siren.py load` |
| `tests/data-overrides-source-contract.test.ts` | Seven source-contract assertions, including "the two adapters refuse exactly the same things, in the same words" |

**Validation**

| Check | Result |
|---|---|
| `tests/special-records-replay-parity.test.ts` (**G-9**) | **19 passed, 0 failed** — both adapters, one corpus |
| `tests/integration/first-kick-goal-reload-links.test.ts`, Stage 4 block (**G-5**) | **6 passed, 0 failed**, 892 s, real importer as `afldb_import` |
| `tests/integration/after-siren.test.ts` | **10 passed, 0 failed**, 132 s, real `after_siren.py load` |
| `tests/special-records-identity.test.ts`, `special-records-admin.test.ts`, `integration/special-records-lifecycle.test.ts`, `integration/admin-special-records.test.ts`, `auth.test.ts`, `data-overrides-source-contract.test.ts` | **272 passed, 1 skipped, 0 failed** — Stage 2 and Stage 3 unregressed, and the new source-contract assertions green |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` over every changed TS file | exit 0 |
| `python -m py_compile` + import of `common.py` and `after_siren.py` | exit 0 |
| `git diff --check` | clean |

The repository has **no Python lint or type-check configuration** (no
`pyproject.toml`, `setup.cfg`, `.flake8`, `ruff.toml` or `mypy.ini`), so
`py_compile` plus the two suites that spawn the real module are the Python checks
this repo actually has.

**A full-suite run was not performed.** §17 does not require one at this stage,
and the runbook's own instruction is to compare against the recorded baseline
rather than re-derive it; the §21.10 baseline differential is what a full run
would be measured against, and nothing in this stage touches a path outside the
suites above. The environment findings in §23.10 would also make a full run's
result unreadable without first resolving them.

**Not changed, deliberately:** `src/db/migrations/102_special_records_lifecycle.sql`
(untouched, as instructed), `tools/maintenance/privileges.sql` (D-5), migration
073's `GRANT SELECT ON data_overrides TO afldb_import` (neither adapter writes
it), `LINK_TARGET_TABLES` (D-2), every public read path (Stage 5), every admin
mutation surface (Stage 6), and `src/lib/auth/capabilities.ts` — **`.edit` is
still not declared**, per the §9.1 sequencing clarification.

### 23.10 Three environment findings, none of them Stage 4 defects

**1. The first-kick suite was silently skipping, entirely.**
`data/records/first-kick-goal.csv` is **gitignored** (`.gitignore:76`,
`/data/records/*` with tracked exceptions) and was **absent from this worktree**,
present only in `D:\dev\afldb`. The suite's `canSpawnImporter` guard therefore
made all 22 of its tests skip, and they would have gone on skipping. Copied in
from the main worktree — an ignored path, so not a repository change. **A
`describe.skipIf` keyed on a gitignored fixture reports a clean run whether the
fixture is there or not**, and this worktree had been reporting one since it was
created. That is why §21.10's "0 failed" for this suite is not evidence it ever
ran here.

**2. The importer takes ~93 s on this workstation, and several of the suite's own
timeouts assume far less.** Five tests (`:446`, `:483`, `:779`, `:851`, `:880`)
carry no explicit timeout and get vitest's 30 s default; others carry
`120_000` but perform **two** importer runs, needing ~186 s. So the suite cannot
pass here as written, independently of anything in this stage.

**Proven, not argued.** The pre-Stage-4 importer was extracted from `HEAD`
(`git show 2a54444:tools/records/import-first-kick-goal.ts`) into the same
directory so its relative imports resolved identically, and both were run
`--apply` against `afldb_test` back to back:

| Importer | Wall time | Result |
|---|---|---|
| **Baseline `2a54444`** (no replay adapter) | **93.6 s** | exit 0, 334 rows reconciled |
| **Stage 4** (replay adapter on the importer's `tx`) | **93.0 s** | exit 0, 334 rows reconciled |

**The replay adds no measurable cost** — it validates the whole active override
set in one statement and its four write statements match nothing when there is
nothing to replay. The ~93 s is the existing per-row match resolution over 334
rows. The affected runs were therefore re-run with `--testTimeout` raised **at the
CLI**; no test file's timeout was edited, because raising a committed timeout to
suit one workstation is the operator's call, not this stage's.

**3. Retiring a row in this suite is a TWO-part edit, and half of it fails
silently in a way that looks like a product bug.** Dropping a row from the temp
extract is not enough: the manifest still claims that id is `active`, so the
importer refuses at the **manifest join** and exits having printed only its parse
summary — before it reaches any refusal, replay or write. Two Stage 4 tests were
written with the one-part edit and failed in ~0.5 s against output that never
mentioned the thing under test. The established two-part form is at `:924-944`;
it is now factored as a `retire()` helper in the Stage 4 block, and each test
starts from pristine copies via `beforeEach` so a failure cannot cascade into the
next test as a second, unrelated one.

**4. This suite purges its fixtures in `afterAll` only, so a crashed run poisons
the next one.** A run of it had to be interrupted during this stage; that skipped
the `afterAll` at `:363-370` and left four `player_link_resolutions` rows and the
`issue-078-foreign` fixture row behind, which then made the next run fail in
647 ms on a precondition rather than on anything real. Cleaned by hand, doing
exactly what that `afterAll` does, and the baseline verified back to 334 canonical
rows / 0 decisions / 0 overrides before re-running. **The suite is not modified.**
`tests/integration/admin-awards.test.ts:124-131` already records this exact
lesson — purge on stable prefixes in `beforeAll` **and** `afterAll`, never a
per-run nonce — and this suite predates it. Both AFLDB-ISSUE-167 suites added in
this stage follow the ISSUE-165 pattern and purge at both ends.

### 23.11 Stage boundary

Stage 4 is green and **stops here**. No public `status = 'active'` filter, no
admin mutation, no `.edit` declaration, no `match-admin` change, no DEV or PROD
migration, and nothing staged, committed, pushed, merged or deployed.

**ISSUE-167 is NOT resolved.** Stage 5 is the next stage, and §17 is explicit that
Stages 4 and 5 are the two that can invalidate the design, and that neither may be
merged into another stage.

---

## 24. Stage 5 execution evidence — **PASS (2026-09-14)**

Public read-model filtering only. No mutation, no `.edit`, no `/new` route, no
`match-admin` change, nothing migrated beyond `afldb_test`, nothing staged or committed.

### 24.1 Checkpoint, before anything was edited

Worktree clean; `HEAD` = branch = `origin/opus/issue-167-special-records-admin` =
`5de87ddfcb5b71db9f348c9f4d977cdeb398cd04`. `migrate.ts --status --target test` reported
`102_special_records_lifecycle.sql applied`, **0 pending** — which is positive checksum
proof, because the runner's edited-migration refusal runs *before* the status branch.
The `afldb_test` target was re-proven by the §15.0 three-condition contract first:
`127.0.0.1:5432/afldb_test`, `_test` suffix, loopback host, live listener. Migration 102
was not edited.

### 24.2 The consumer inventory, re-derived from current source

The planning inventory in §7 was **not trusted**. Every reference to either table in
`src/` was re-enumerated, and the result differs from §7 in four places.

| # | Consumer | File | Fragments | Family |
|---|---|---|---|---|
| 1 | `/records/first-kick-goal` | `src/db/queries/player-achievements.ts` | **8** (list, summary, 2 highlight branches, by-club, by-decade, clubs-without, provenance) | A |
| 2 | Player page + **`/players/compare`** honours | `src/db/queries/awards.ts` (`getPlayerHonours`) | 1 | A |
| 3 | `/records/after-the-siren` + player page | `src/db/queries/after-siren.ts` | **6** (5 CTEs in the records board, 1 player query) | B |
| 4 | Grid Solver | `src/db/queries/grid-solver.ts` | **6** (5 first-kick builders, `after_siren_winner`) | A + B |
| 5 | NL achievement summary | `src/db/queries/nl/achievement-summary.ts` | **6** | A |
| 6 | NL `after_siren` grain | `src/db/queries/nl/after-siren.ts` | 1 helper (`baseClauses`) covering **5** query sites | B |
| 7 | `/admin/player-links` queue | `src/db/queries/player-links.ts` (`listUnresolvedLinks`) | 1 | A |
| 8 | Link candidate evidence + detail | `src/db/queries/player-match-candidates.ts` (`fetchSourceEvidence`, `readSourceDetails`) | **2** | A |

**Four corrections to §7's planning inventory:**

1. **`/players/compare` is a second consumer of `getPlayerHonours`** and was not listed.
   It is filtered by the same one-line change, but the page was unlisted.
2. **`src/search/grid-solver-spec.ts:232,369`, `src/search/gridley-compat.ts:533`,
   `src/search/nl/plan.ts:319,1642` and `src/search/nl/parser.ts:3265-3267` hold no SQL
   at all** — every one is a prose comment naming the table. §7 listed them as fragments
   requiring a filter; they require nothing. All SQL over both tables lives in
   `src/db/queries/`.
3. **`player-match-candidates.ts` is a consumer and §7 did not name it.** It holds two
   references: `fetchSourceEvidence` (the candidate-evidence source set, a real public
   read path) and `readSourceDetails` (an id-keyed detail hydrator).
4. **`src/db/queries/after-siren.ts` has 6 fragments, not the 6 line numbers §7 quoted** —
   the count is right but `:178` is the player query and `:89…:127` are five separate
   scans inside one statement, which is why the filter is repeated per CTE rather than
   lifted: filtering four of five would produce a board whose totals and whose
   first/last occurrences disagreed.

**Classified non-public, with reasons:** `admin-special-records.ts` (Stage 3 deliberately
shows both states), `match-admin.ts:401` (an administrative `DELETE`, Stage 6's subject),
`audit-log.ts` / `audit-view.ts` / `capabilities.ts` / `identity.ts` /
`acquisition/manual-authority.ts` / `player-matching/confidence.ts` (table-name constants
and label maps, no relation reference), every migration, importer and test.

**Page wiring proven, not assumed:** `/records/first-kick-goal`,
`/records/after-the-siren`, `/players/[slug]` and `/players/compare` each import only the
query functions above; no page holds its own SQL.

### 24.3 The filter, and why `= 'active'`

`status = 'active'`, never `status <> 'void'` and never `status IS NULL OR …`. Migration
102 gave both tables `status text NOT NULL DEFAULT 'active'` under a two-value
`CHECK (status IN ('active','void'))`, so there is no null to tolerate and a negated test
would silently admit any third state a later migration adds.

This **deliberately differs from the neighbouring AFLDB-ISSUE-165 branches** in
`player-links.ts` and `player-match-candidates.ts`, which use `<> 'void'` — correctly,
because their tables carry a wider lifecycle vocabulary. Both spellings now sit in the
same `UNION`, and the comment at each site says why.

### 24.4 RED → GREEN

RED was run before any source edit: **26 failed, 7 passed**. Every failure was a real
missing filter; the 7 passes were the classification gate, the D-2 `LINK_TARGET_TABLES`
assertion, the other-target-tables-untouched check and the Admin-still-sees-void tests,
all of which are true before and after by design. GREEN: **33 passed, 0 failed**.

**The RED found a real defect that no integration test could have.** The first draft of
the two player-link comments used backticks around `after_siren_kicks` and
`LINK_TARGET_TABLES` inside a `sql` **template literal**, which terminates the literal and
broke both files at parse time. The source-contract test reported it as "1 reference but
0 filters" — because the literal had been torn in half — and `vitest` then surfaced the
parse error. A whole-file "contains the string" assertion would have passed.

### 24.5 Suppression proved by decisive fixtures, not by counts

Each fixture is **discovered by the property that makes it decisive**, so the assertion is
"the answer changed", not "a count went down":

| Fixture | Discovery rule | What it proves |
|---|---|---|
| Sole linked row in its season | `GROUP BY season HAVING count(*) = 1` | the Grid Solver `first_kick_goal_between` cell empties; the NL `by_season` group vanishes |
| Sole linked row for its organization | `GROUP BY organization_id HAVING count(*) = 1` | the club moves *into* `getClubsWithoutFirstKickGoal` and into the NL `clubs_without` answer; the club-scoped grid cell empties |
| The earliest row | `ORDER BY season, id LIMIT 1` | the records board's `earliest` highlight moves |
| Sole holder of `max(imported_at)` | proven unique before use | the provenance instant moves back |
| A player with exactly one winner-qualifying kick | `GROUP BY player_id HAVING count(*) = 1` | the player leaves the `after_siren_winner` grid cell |
| A player with exactly one after-siren attempt | `GROUP BY player_id HAVING count(*) = 1` | the player leaves the records board entirely |
| An `unmatched` first-kick row | `link_status_value = 'unmatched'` | the row leaves the player-link queue and the candidate evidence set |

**Safety.** Each test voids ONE real row inside `withVoid`, restoring
`status = 'active', status_reason = NULL` in a `finally` whether the assertions pass, fail
or throw. The suite asserts **zero void rows in both tables at `beforeAll` and again at
`afterAll`** — the ISSUE-165 purge-at-both-ends lesson §23.10 recorded, applied here from
the start. `fileParallelism: false` means no other suite observes the transient void.

### 24.6 Two things the filter had to be placed carefully to get right

**1. The NL caveat line.** `exclusions()` in `nl/after-siren.ts` is built from
`baseClauses` **alone**, deliberately excluding the ownership rules, so the caveat counts
against the same set the reader asked about. Putting the filter in `ownershipClauses`
would have removed a voided row from the answer while still quoting it in the caveat
underneath. It goes in `baseClauses`, unconditionally and first, and a test voids a
player-unlinked kick and asserts `excluded.noPlayerLink` drops by exactly one.

**2. The detail hydrator.** `readSourceDetails` is keyed by ids that come from the
now-filtered `fetchSourceEvidence`, so it can subtract nothing today. It is filtered
anyway, and says so, because a future caller assembling its own id list would otherwise
reintroduce a retracted row through the back door of a detail lookup.

### 24.7 Admin still sees everything, and D-2 is intact

Proven under the same transient void, not asserted: `listFirstKickGoals` and
`listAfterSirenKicks` still return the voided row, `readFirstKickGoal` /
`readAfterSirenKick` return it with `status = 'void'` and its reason,
`specialRecordLifecycleCounts()` reports `void: 1`, and `status: 'void'` filtering returns
exactly that row. **D-2**: `LINK_TARGET_TABLES` is asserted equal to its seven members
with `after_siren_kicks` absent; every other target table's queue is asserted
byte-identical before and after.

### 24.8 Files changed, and validation

**New**

| File | Purpose |
|---|---|
| `tests/integration/special-records-public-suppression.test.ts` | The DB-backed sweep: one void, every public consumer, plus Admin and D-2 |
| `tests/special-records-public-filter-contract.test.ts` | The §7 per-fragment gate — parses each `sql` literal, resolves its fragment constants, requires the filter **under the same alias**, and fails on any unclassified new reference |

**Why one suite and not the four §16 named.** §16's Stage 5 row names four existing
integration homes. The claim is a single atomic one — void it once, and it is gone
everywhere public while Admin still sees it — spanning eight query modules, **three of
which (the records-board queries, the player-page honours query and the player-link
queue) are in none of those four files**. Splitting it would mean voiding and restoring
the same row four times, four copies of the same helper, and no single place that fails
when a ninth consumer appears. This is the same reason Stage 4 created
`special-records-replay-parity.test.ts`. No existing suite was modified, weakened or
skipped.

**Modified** — eight query modules, filter-only; no signature, no shape, no behaviour
beyond the exclusion of voided rows:

`player-achievements.ts` (new `ACTIVE` fragment, 8 sites) · `after-siren.ts` (6 sites) ·
`awards.ts` (1) · `grid-solver.ts` (6) · `nl/achievement-summary.ts` (new `ACTIVE`
fragment, 6 sites) · `nl/after-siren.ts` (`baseClauses`) · `player-links.ts` (1) ·
`player-match-candidates.ts` (2)

**Validation**

| Check | Result |
|---|---|
| Stage 5 suites (RED → GREEN) | **33 passed, 0 failed** (RED was 26 failed / 7 passed) |
| Stage 2 + 3 + 4 regression — `special-records-admin`, `integration/admin-special-records`, `integration/special-records-lifecycle`, `special-records-identity`, `special-records-replay-parity`, `auth` | **234 passed, 1 skipped, 0 failed** |
| `player-matching`, `data-overrides-source-contract`, `nl-parser`, `nl-plan` | **686 passed, 0 failed** |
| `player-link-mutations` | **49 passed, 0 failed** |
| Grid Solver / NL / after-siren / Gridley (6 files) | 1,448 passed, **10 failed — all pre-existing, proven by differential (§24.9)** |
| `npx tsc --noEmit` | clean |
| ESLint over the 10 changed files | **0 errors**; 4 pre-existing `no-unused-vars` warnings in `nl/after-siren.ts` at `:216,:300,:317`, outside the edited region |
| `git diff --check` | clean |

### 24.9 The 10 failures are pre-existing, proven by differential

§21.10's recorded baseline lists `grid-solver` × 2 and `gridley-corpus` × 4. This run
showed `grid-solver` × 3, `gridley-corpus` × 4 and `nl-answers-after-siren` × 3 — **more
than the recorded baseline**, so the recorded list alone was not sufficient evidence and a
differential was run rather than an argument made.

`grid-solver.ts`'s `after_siren_winner` builder and `nl/after-siren.ts`'s `baseClauses`
were reverted in place, the two suites re-run, and the files restored from saved copies:

```
with filters:     6 failed | 226 passed   (grid-solver 3, nl-answers-after-siren 3)
filters reverted: 6 failed | 226 passed   (IDENTICAL assertions, IDENTICAL values)
```

**Zero regressions attributable to Stage 5.** The Stage 5 gate was re-run after the
restore (33/33) and `tsc` / `git diff --check` re-confirmed clean.

**What the four beyond-§21.10 failures actually are.** `afldb_test` has gained player
links since those fixtures were written — Stage 4 ran the real `after_siren.py load`
repeatedly. Measured now: all 68 `kick_effect = 'won'` rows are linked, where
`grid-solver.test.ts:635-636` asserts an unlinked premiership-season winner exists (the
suite names Cameron Zurhaar, 2026, as that row). The three `nl-answers-after-siren`
failures are the same drift in the other direction — a *wider* tie, a later "most recent"
kick, and 2 excluded rows where the fixture records 6. **A suppression filter can only
remove rows, never add links or widen a tie**, which corroborates the differential.
These belong to the §21.10 class of football-data-state failures and are **not** Stage 5
defects. Recorded here so the next stage does not re-investigate them.

**Operator decision D-6 (2026-09-14) — DO NOT re-baseline. This item is CLOSED; it is not
an open operator item.** The differential is accepted as proof that the failures are
independent of the Stage 5 filters — the same failures, the same assertions and the same
values with the implicated filters present and reverted. They are recorded as
**pre-existing test-data-state drift caused by the current `afldb_test` linkage state, not
an ISSUE-167 regression**. The four assertions in `tests/integration/grid-solver.test.ts`
and `tests/integration/nl-answers-after-siren.test.ts` are **not** to be altered, and Stage
5 scope is **not** widened. Stage 5 is signed off with **no stop condition open**. See
§19 D-6.

### 24.10 Stage boundary

Stage 5 is green and **stops here**. No mutation, no `data.specialRecords.edit`, no `/new`
route, no `match-admin` change, no DEV or PROD migration, and — at the close of the Stage 5
session — nothing staged, committed, pushed, merged or deployed.

**Superseded on the commit/push half only (2026-09-14):** the operator has since committed
Stages 2–5 and pushed the branch; Stage 5 is `e8b44f6` and `HEAD = @{u}` with a clean
worktree (header **Repository state**). Nothing is merged to `main` and neither DEV nor
PROD is migrated or deployed.

**ISSUE-167 is NOT resolved.** Stage 6 (mutations, atomic audit, CAS, revalidation out of
the pending path) is **the next action** — with D-6 closed, it is the only one.

---

## 25. Stage 6 execution evidence — **PASS (2026-09-14)**

Mutations: correct / suppress / reinstate / replace / create, for both families, with the
canonical row, the durable `data_overrides` record and the `data_edits` audit row
committing as one transaction; compare-and-swap on `updated_at`; bounded revalidation out
of the pending path; and the third destruction path closed.

**No stop condition is open.** Two design contradictions were found against current source
and are recorded in §25.3 and §25.4 — both were resolved by making Stage 6 *narrower and
more faithful to the Stage 4 replay*, not by weakening the authority, audit, CAS or replay
contracts.

### 25.1 Checkpoint, before anything was edited

| Claim | Evidence |
|---|---|
| Worktree clean | `git status --short --branch` → `## opus/issue-167-special-records-admin...origin/opus/issue-167-special-records-admin`, no entries |
| Branch, HEAD and upstream agree | all three `c5a0df7a64663bfe8dbfbeb56d65e0a5879defc0` |
| Migration 102 applied | `tsx tools/db/migrate.ts --status --target test` → `applied 102_special_records_lifecycle.sql`, `0 pending` |
| Migration 102 checksum-clean | the runner's drift check runs **before** the `--status` branch (`migrate.ts:261-270`), so a clean status run is the proof |
| Migration 102 unedited | `git log --oneline -- src/db/migrations/102_*.sql` → `8d9ac74` only; `git diff HEAD` empty; sha256 `dec12080ca270d7dcdd32c026a11b0025cc2352e0c0d247b11af1aa701f5f173` |
| DB target is `_test`, loopback, live | `127.0.0.1:5432/afldb_test`, `Test-NetConnection` TCP succeeded, DSN user `afldb_owner` |
| Mutations ran as the restricted role | `createImportRoleParityHarness` proved `afldb_import` on the same `_test` database before a single row was written |

### 25.2 What was built

**Capability (D-4, sequencing per §9.1).** `data.specialRecords.edit` is declared in
`src/lib/auth/capabilities.ts` as `SUPER_ADMIN_ONLY`, in the same change as its first
guarded mutation, with the `EQUIVALENT_ROLE_GUARD` entry (`'requireSuperAdmin'`) beside it.
`tests/auth.test.ts` was **not** weakened and no declared-ahead-of-enforcement exemption
was added; the Stage 3 comment that promised this is replaced by the declaration it
promised.

**Final role matrix — proven, not asserted:**

| | `data.specialRecords.read` | `data.specialRecords.edit` |
|---|---|---|
| Contributor | ✗ | ✗ |
| Contributor + `can_manage_admins` | ✗ | ✗ |
| Admin | ✓ | ✗ |
| Admin + `can_manage_admins` | ✓ | ✗ |
| Super Admin | ✓ | ✓ |

**The mutation module** (`src/db/queries/admin-special-records.ts`, write half). Ten
exported mutations — correct / suppress / reinstate / create / replace × two families —
over one shared core, `runSpecialRecordEdit()`: lock, compare-and-swap, precheck, apply,
`data_overrides`, `data_edits`, in that order, inside one `afldb_import` transaction. Every
refusal reachable **before** the first write returns; every refusal after it **throws**
(`RollbackRefusal`), because `postgres.js` commits when the `begin()` callback resolves.

**Server Actions** (`src/app/admin/records/actions.ts`, the one `'use server'` module in
the domain). Ten exported actions, each asserting
`await requireCapability('data.specialRecords.edit')` **first**, before awaiting anything
else. Nothing in the module imports `next/cache` or calls `revalidatePath`.

**Routes.** `/admin/records/first-kick-goal/new` and `/admin/records/after-the-siren/new`
(guarded by `.edit`, the `/admin/awards/winners/new` precedent); the existing five read
routes keep `.read`; `/admin/records/revalidate` is the one allowlisted invalidation
endpoint, guarded by `.edit`.

**Match-admin refusal** (`src/db/queries/match-admin.ts`). `DELETE FROM
player_achievements WHERE match_id = $1` is **gone**. Both families are inspected before
anything destructive runs and a match carrying either is refused by name.

### 25.3 Finding F-1 — §3.4.1's match derivation is contradicted by current source

**§3.4.1 item 2 is wrong about *which field* `player_achievements.match_id` is derived
from, and the error is inherited from migration 053's own column comment.**

| Source | Claim |
|---|---|
| `src/db/migrations/053_player_achievements.sql:103-105` | *"resolved by career game position (1 + kickless_matches_before_first_kick), never by season/round/club lookup"* |
| `tools/records/import-first-kick-goal.ts:797-808` | *"The match is the one the SOURCE says it happened in — the player's game in that season at that round — **not one inferred from career position**. Position is unreliable here: Brent Harvey's debut (1996 R22) recorded no kick at all, and his first kick, the goal, came in his second game (1997 R5)"* |
| `import-first-kick-goal.ts:607-647` | `findMatchForRound(sql, playerId, season, roundRaw)` — the actual resolver, with the Opening-Round offset rule |

The importer is the live behaviour; the migration comment is stale. §10.3's consequential
sentence — *"editing `kickless_matches_before_first_kick` re-derives `match_id`, and the
form says so"* — is therefore wrong on both halves.

**Resolution, which weakens nothing.** `match_id` stays **derived and never editable**,
exactly as §3.4.1 requires. What changes is that a correction does **not** re-derive it,
and the reason is the Stage 4 contract rather than convenience:

- the replay carries a `correction` as a **delta over the amendable columns** and touches
  no link column (`special-records-replay.ts` step 5, and its own comment: *"Link columns
  are deliberately NOT restored here"*);
- so after a destructive rebuild the row carries the importer's own `match_id`, resolved
  from the **source's** season and round, beside the corrected season;
- a mutation that re-derived the link would therefore create state the replay cannot
  reproduce — the one failure the durable-decision design exists to prevent.

Leaving the link alone is the only outcome that is identical before and after a rebuild.
The detail page and the correction panel both say so in the operator's words. **No
migration is edited**: 102 is immutable and 053's comment is a pre-existing documentation
defect in a migration that has already run, recorded here for a future migration to
correct if the operator wants it corrected.

### 25.4 Finding F-2 — a manual record carries no club link, by construction

The Stage 4 replay's `record` INSERT sets `player_id`, `link_status_value`, `match_id`,
`source_id`, `source_record_id`, the lifecycle pair and the amendable columns — and **no
club column at all** (`special-records-replay.ts:348-367`). A manual row created with a
`club_id` would therefore not be the row a rebuild reconstructs, which the Stage 6 contract
forbids outright (*"If the durable record payload cannot fully reconstruct the manual row
under Stage 4 replay, STOP"*).

**Resolution: the creator sets no club id.** The club travels as `club_name_raw` — the
source spelling, which is in the replay's column list and is what every public read already
falls back to (`after-siren.ts:177`: `COALESCE(cl.name, a.club_name_raw)`). The creation
form says so. This is a *narrowing*, it creates no state the replay cannot reproduce, and
it costs nothing a public page renders. Recorded as a follow-up candidate rather than a
Stage 6 defect: giving a manual record a durable club identity is a change to **both**
replay adapters and their shared parity corpus, which is Stage 4 work and is out of Stage
6's contract.

### 25.5 The correctable surface, and why it is exactly this one

The load-bearing invariant of the whole stage, pinned by
`tests/special-records-admin.test.ts`:

> the correctable columns are **exactly** the columns the Stage 4 replay adapter carries —
> both directions, so neither list can drift alone.

| Family | Correctable columns | Equal to |
|---|---|---|
| `player_achievements` | 12 | `COLUMNS.player_achievements` in `tools/records/special-records-replay.ts` |
| `after_siren_kicks` | 21 | `COLUMNS.after_siren_kicks` |

Both sets are also, column for column, §3.4's **amendable** classification. A column the
replay cannot carry would be silently reverted by the next rebuild; a replay column the
admin surface cannot reach would be an amendable field with no way to amend it.

**Everything else is refused, and refused twice:** the typed `fields` parameter excludes it
at compile time, and `partitionCorrection()` refuses it again at run time, so a crafted
POST naming `matchId`, `playerId`, `clubId`, `linkStatus`, `candidateCount` or
`sourceRecordId` gets a sentence rather than silence. The Server Action's own allowlist is
asserted equal to the query module's spec, so a field in the form and not in the
transaction cannot exist either.

### 25.6 Family B — the coupled event fields

`src/lib/special-records/after-siren-rules.ts` is a new **pure** module transcribing
migration 089's four CHECK constraints — `_effect_ck`, `_regulation_ck`, `_match_ck`,
`_points_ck` — into readable refusals. It is used in three places and implemented once: the
correction panel (live, as the operator types), the Server Action's mutation (before any
SQL is issued), and the CHECK constraints themselves (inside the same transaction). The
suite asserts the constraint text is still in 089 and that no refusal ever names a
constraint.

The row is validated **as it will stand once the delta lands**, never field by field: three
of the four constraints are satisfied or broken by a *combination*, so a partial check
would pass a change that breaks the row it lands on.

`club_id` stays derived and read-only (§3.4.1 item 3). D-2 is intact: no link mutation, no
new queue, `LINK_TARGET_TABLES` unchanged.

### 25.7 Suppress, reinstate, replace

**Suppress** — the button reads *"Suppress record"*, the reason is mandatory (migration
102's CHECK refuses a void row without one), the row is **kept**, and the decision is
durable. **Reinstate** appends a second audit row and erases nothing. **Replace** is
suppress + manual create **in one transaction**, cross-referenced by natural key
(`replaces_key` / `replaced_by_key`) and sharing one `replacement_id` across both audit
rows — never an identity edit, and never a delete-and-reinsert under the original source
identity. A wrong `source_record_id` is repaired here and nowhere else; a rekey remains
P10's.

**Which override group each mutation writes, and why it is never two:**

| Row ownership | correct | suppress / reinstate |
|---|---|---|
| source-owned | `correction` (a delta) | `lifecycle` |
| `manual_admin_edit` | `record` (the whole row) | `record` (the whole row, its `status` included) |

A manual row's lifecycle decision goes **inside** its `record` payload rather than beside it
as a second override, because `record` + anything is the collision the replay fails the
whole reload closed on (§23.4). `refuseOverrideCollision()` checks that before writing, so
an administrator meets a sentence now instead of an operator meeting a refused rebuild
months later.

### 25.8 RED → GREEN

| Contract | RED | GREEN |
|---|---|---|
| `.edit` declared, role matrix, real enforcement, no `revalidatePath` in the action | `tests/auth.test.ts` **5 failed / 149 passed** — `expected [...] to include 'data.specialRecords.edit'`; `the Stage 6 special-record Server Actions module: expected undefined to be defined`; `places every declared capability`; `data.specialRecords.edit admits the same viewers as requireSuperAdmin()` | **155 passed** |
| Correctable ≡ replay COLUMNS; coupled rules; revalidate allowlist; match-admin refusal | `tests/special-records-admin.test.ts` — the Stage 6 blocks could not resolve their imports before the modules existed | **42 passed** (was 22) |
| Mutation, CAS, atomicity, replay, match delete | `tests/integration/admin-special-records.test.ts` — same | **33 passed** (was 14) |
| Match-delete refusal, as a source contract | `tests/admin-match-mutations.test.ts` | **16 passed** (was 14) |

Two RED assertions were **tightened rather than satisfied** when they turned out to be
reading prose instead of code, and both are recorded because the distinction matters:

1. `expect(source).not.toContain('revalidatePath')` failed on the action module's own
   header sentence *explaining* that it never calls it. Replaced with
   `not.toMatch(/\brevalidatePath\s*\(/)` plus the `next/cache` import check — a call, not
   a mention.
2. `tests/admin-match-mutations.test.ts` failed on the refusal's own comment *quoting* the
   `DELETE FROM player_achievements` statement it replaced. The assertion now reads a
   comment-stripped copy, the idiom `tests/special-records-admin.test.ts` already uses.

### 25.9 The Stage 3 assertions Stage 6 had to move, and how

Four Stage 3 source-contract assertions were **statements about a read-only stage**, not
about the design. Each is replaced by the precise form of the same rule rather than
deleted:

| Stage 3 assertion | Stage 6 form |
|---|---|
| *"five read-only routes, and no `/new`"* | the five read routes **and** the two creation routes, exactly |
| *"every route enforces `.read`"* | read routes enforce `.read`; creation routes enforce the **narrower** `.edit` |
| *"no edit seam: no `'use server'` anywhere"* | **exactly one** `'use server'` module, and every guard in it is `.edit` |
| *"no `<input>`/`<select>` on a detail page"* | no control **named after** a derived, link or identity field anywhere; `matchId` / `playerId` admitted **only** in a creation field set |
| *"no `UPDATE player_achievements/after_siren_kicks`"* | no statement anywhere in the domain **assigns** a link column |
| *"no `status = 'active'` in the query module"* | every occurrence is an `SET status = 'active'` **assignment**; none is a filter — and the assertion fails vacuously if the assignment disappears |

No regression coverage was deleted, skipped, disabled or weakened.

### 25.10 Evidence for each Stage 6 obligation

All DB-backed, on `afldb_test`, mutations as `afldb_import`.

| Obligation | Evidence |
|---|---|
| correction persists canonical + override + audit | delta override carries exactly `{consecutive_goal_kicks, round_raw}`; one `first_kick_goal_corrected` audit row carrying `entity_key` and `lineage_identity` |
| derived / identity mutation refused, nothing written | `reason: 'forbidden'`, `subjects` naming `matchId` and `sourceRecordId`; `updatedAt` unchanged, 0 overrides, 0 audit rows |
| after-siren invalid combination → domain error | *"A goal that won the match leaves a final margin of 1 to 6 points; these scores leave 11"*; asserted **not** to match `/_ck\b/` |
| after-siren legal coupled correction accepted | behind + drew + draw + level scores, all four moving together |
| suppress requires a reason | whitespace-only reason → `reason: 'validation'`, row still active |
| suppress writes lifecycle override + audit atomically | `lifecycle` override `{status: 'void', status_reason}`, one audit row, row kept |
| reinstate appends history, restores active | two audit rows in order (`_suppressed`, `_reinstated`); the suppression's reason survives in the earlier row |
| replace is atomic suppress + manual create | old row `void` with its own `source_record_id` intact; new row `manual_admin_edit`; payloads cross-reference by natural key; one shared `replacement_id` |
| **stale `expectedUpdatedAt` writes nothing anywhere** | all four mutations refused `reason: 'stale'`; canonical row, 0 overrides, 0 audit rows, **and 0 orphan replacements** from the refused replace |
| forced audit failure rolls the canonical mutation back | `adminUserId: -1` (no `auth_users` row): status still `active`, `updatedAt` unchanged, 0 overrides, 0 audit rows |
| ... and rolls a whole **replacement** back, both halves | old row still `active`, 0 manual rows created |
| manual record replays under the Stage 4 adapter | row deleted to simulate a destructive rebuild; `replaySpecialRecordOverrides()` re-created it with the same season, round, club spelling, decoded markers and status — **and both links resolved** from `player_identity` and `match_key` |
| correction + lifecycle coexist and replay | two active overrides, disjoint groups; after an ordinary reload was simulated the replay re-applied both (`corrected ≥ 1`, `lifecycle ≥ 1`) |
| forbidden `record` + second authority fails closed | the mutation refuses `reason: 'conflict'` **after** its canonical UPDATE, and the rollback leaves the row unchanged; a planted pair makes the replay throw *"more than one active override resolves to this row"* |
| public suppression remains effective | the fixture is in `getFirstKickGoalList()` before and absent after |
| Admin still sees void records | `listFirstKickGoals({search})` returns the suppressed row |
| bounded revalidation paths returned | every returned path asserted against `isAllowedRevalidatePath()`; the set contains the public family page and the admin detail page |
| no `revalidatePath()` inside the action | asserted in `tests/auth.test.ts` and again in the source contract |
| match deletion refused — first-kick | fixture match of the suite's own making; `deleteMatch` → `ok: false`, message names both families and `/admin/records/` |
| match deletion refused — after-siren | same call, same message; the raw FK violation never happens |
| ... and refused for a **suppressed** record too | suppression is not permission to destroy the row |
| D-2 intact | `LINK_TARGET_TABLES` unchanged; no link assignment anywhere in the domain |
| D-5 intact | the five Stage 2 privilege assertions still green; `privileges.sql` untouched; reads on the app pool, writes on `afldb_import` |

### 25.11 Files changed, and validation

**New (15):**

```
src/lib/special-records/after-siren-rules.ts
src/app/admin/records/actions.ts
src/app/admin/records/validation.ts
src/app/admin/records/revalidate-paths.ts
src/app/admin/records/revalidate/route.ts
src/app/admin/records/submit-helper.ts
src/app/admin/records/FirstKickFields.tsx
src/app/admin/records/AfterSirenFields.tsx
src/app/admin/records/FirstKickCorrectionPanel.tsx
src/app/admin/records/AfterSirenCorrectionPanel.tsx
src/app/admin/records/SpecialRecordLifecyclePanel.tsx
src/app/admin/records/SpecialRecordReplacePanel.tsx
src/app/admin/records/SpecialRecordCreatePanel.tsx
src/app/admin/records/first-kick-goal/new/page.tsx
src/app/admin/records/after-the-siren/new/page.tsx
```

**Modified (12), plus the four tracking documents:**

```
CHANGELOG.md                                          the Unreleased entry (operator, 2026-09-14)
src/lib/auth/capabilities.ts                          data.specialRecords.edit declared
src/db/queries/admin-special-records.ts               the whole write half
src/db/queries/match-admin.ts                         the third destruction path, closed
src/app/admin/records/first-kick-goal/page.tsx        create link (canEdit only)
src/app/admin/records/first-kick-goal/[id]/page.tsx   the three write panels
src/app/admin/records/after-the-siren/page.tsx        create link (canEdit only)
src/app/admin/records/after-the-siren/[id]/page.tsx   the three write panels
tests/auth.test.ts                                    .edit matrix + enforcement + R-7
tests/special-records-admin.test.ts                   Stage 6 source contract
tests/integration/admin-special-records.test.ts       Stage 6 mutation contract
tests/admin-match-mutations.test.ts                   the match-delete refusal
```

**Validation:**

| Check | Result |
|---|---|
| `tests/auth.test.ts` | **155 passed** |
| `tests/special-records-admin.test.ts` | **42 passed** |
| `tests/integration/admin-special-records.test.ts` | **33 passed** (as `afldb_import`) |
| `tests/admin-match-mutations.test.ts` | **16 passed** |
| `tests/integration/special-records-lifecycle.test.ts`, `special-records-public-suppression.test.ts`, `tests/special-records-replay-parity.test.ts`, `special-records-identity.test.ts`, `data-overrides-source-contract.test.ts`, `special-records-public-filter-contract.test.ts` | **138 passed, 1 skipped** |
| `tests/integration/after-siren.test.ts` (drives the REAL `after_siren.py load`) | **10 passed** |
| `tests/integration/first-kick-goal-reload-links.test.ts` — **the whole Stage 4 special-records block, gate G-5 included** | **6 passed** (see §25.13 for the 9 unrelated environmental failures in that file's ISSUE-078 identity block) |
| `npx tsc --noEmit` | clean |
| ESLint, every changed and new `.ts`/`.tsx` | clean |
| `git diff --check` | clean |

### 25.12 Stage 4 regression — re-proven, and the nine failures that are not Stage 6’s

That file's ISSUE-078 identity block fails 9 of its own tests on this workstation. **None is an
assertion about behaviour** — every one is `Error: Test timed out in 120000ms`, plus one
`PostgresError: canceling statement due to statement timeout` / `write CONNECT_TIMEOUT` under
~45 minutes of sustained load. This is the Stage 4 finding restated: the importer measures ~93 s
here (334 rows × per-row match resolution), and those tests run it **twice** against a per-test
cap of `120_000` written inline in the source. **The CLI `--testTimeout` cannot override an inline
`it(…, 120_000)`**, which is why raising it took the file from 12 failures to 9 and no further:
the 30-s-default tests passed, the inline-capped ones could not.

**Stage 6 changed no file in that suite's dependency closure**, so it cannot be the cause:

```
git diff --name-only HEAD -- tools/ src/db/migrations/     -> empty
git ls-files --others --exclude-standard -- tools/         -> empty
```

The suite imports `@/db/client` and `@/db/queries/player-links` and shells out to
`tools/records/import-first-kick-goal.ts`. Stage 6 touched none of them.

**And the tests that matter here all passed.** Every one of the six Stage 4 special-record tests in
that same file is green, gate G-5 among them:

- `leaves the lifecycle columns alone on an ordinary reload (Layer 1)`
- `re-asserts a lifecycle decision the canonical row lost (Layer 2)`
- `re-creates a manual record row, and an ordinary reload leaves it alone`
- `WARNS AND RETAINS a lifecycle override whose row is absent, and proceeds`
- `REFUSES to retire a row carrying an active override, and writes nothing`
- **`rolls the ENTIRE importer transaction back when the replay fails closed (gate G-5)`**

So lifecycle source-survival, manual-record replay, warn-and-retain, the protected-retirement
refusal and importer atomicity are all re-proven under Stage 6, and the nine failures belong to the
timeout class §23.10 already recorded as an environment finding rather than a defect.

### 25.13 Stage boundary

Stage 6 is green and **stops here**. Nothing staged, committed, pushed or merged; no DEV or
PROD migration; no deployment; no browser acceptance; Stage 7 not begun.

`CHANGELOG.md` **is** updated, under `Unreleased`, on the operator's instruction
(2026-09-14). §24's Stage 5 note had nominated Stage 6 as the changelog point — Stage 6 is
where a row can first become void, and therefore where site behaviour can first differ — and
that is the reading taken. The entry is operator-facing and states its own limits: migration
102 is applied to the **test database only**, the work is **not deployed**, DEV and production
are unchanged, and `AFLDB-ISSUE-167` **remains open** with the promotion and deployment stages
still to come. Stage 7's promotion work is the next action.

**ISSUE-167 is NOT resolved.**

---

## 26. Stage 7 execution evidence — **PASS (2026-09-14)**

Stage 7 is the promotion/build gate: reconcile the promotion inventory, pass **G-6**, pass the
production build, and change nothing else. It found one real defect — in the **build** half, not
the promotion half — and that is exactly the gate doing its job.

### 26.1 Checkpoint, before anything was edited

```
branch            opus/issue-167-special-records-admin
HEAD              077bf2af95e1bd116f7aa1ade00015fe3457c6ae
@{u}              077bf2af95e1bd116f7aa1ade00015fe3457c6ae   (origin/, level)
git status        clean
git diff --check  clean
origin/main       bb2e0af — HEAD is NOT an ancestor of it, and main's migrations stop at 101
afldb_test        102 applied, 0 pending, no checksum drift
```

`npm run db:status -- --target test` lists `102_special_records_lifecycle.sql` as applied with
**0 pending**. That also proves the file is **checksum-clean**: the drift check in
`tools/db/migrate.ts:260-271` runs BEFORE the `--status` branch returns, so an edited applied
migration would have exited 1 instead of printing the list.

**Stage 6 committed exactly the intended surface.** `git show --stat 077bf2a` is 31 files: the
15 new and 12 modified files §25.11 lists, plus the four tracking documents
(`AFLDB-ISSUE-156.md`, `AFLDB-ISSUE-167.md`, `IssuesIndex.md`, `issues.md`) — `CHANGELOG.md`
being one of the 12. Nothing else rode along.

**DEV and PROD were untouched by Stage 7** — but note the reasoning, which Stage 8 corrected.
Every database command in this stage named `afldb_test` on `127.0.0.1`, refused otherwise by an
explicit precondition, and no deployment, `systemctl`, `ssh` or `db:migrate` command was run at
all. **That** is what makes the claim true. The argument originally offered alongside it — that
`origin/main` carries no migration past `101_awards_honours_lifecycle.sql` and a DEV deploy pulls
from `origin`, "so migration 102 cannot have reached either host" — **overstated what a ref can
prove**: a host can check out any pushed branch, and Stage 8's DEV deploy did exactly that. The
per-host position is now stated from direct evidence in the header block, not inferred from a ref.

### 26.2 The promotion inventory — what Stage 2 had already done, and the one thing it had not

Re-read against the §11 obligations and the Stage 2 classification, **items 1–3 were already
complete and correct** (§21.9), and item 4 was withdrawn at Stage 2 as a false premise:

| §11 obligation | State at Stage 7 |
|---|---|
| 1. Entity registry for both families | **Done at Stage 2** — `first_kick_goal_key` and `after_siren_key` in `LINEAGE_IDENTITY_SQL`, resolving `'<sources.key>\|<source_record_id>'` by source KEY, so they denote the same row on both databases |
| 2. `data_edits` lineage targets for both | **Done at Stage 2** — both in `data_edits.lineageRefs[0].targets`, in the same change that admitted them to the CHECK |
| 3. `player_link_resolutions.target_id` for `player_achievements` | **Done at Stage 2** — corrected from `identity: 'none'` without reopening ISSUE-139 D1 |
| 4. `after_siren_kicks` classification | **Withdrawn at Stage 2** — migration 089's `grant_import_write` registered it, so it is rebuilt data. Re-measured here: `[PASS] Table classification (fail-closed)` |

**What was missing is the replay STEP, not the classification.** `data_overrides` is durable
authority only if the promotion actually replays it, and the two operator surfaces that say what
to replay — `ACCEPTANCE_CHECKLIST` in `tools/db/promotion-inventory.ts` and §8 step 1 of
`docs/production-promotion.md` — named neither special-record entity type. Left alone, an
operator following the runbook would have:

- **republished every voided record** — Stage 5's suppression lives in `status`, the candidate is
  rebuilt from source, and only the replay re-asserts it;
- **lost every administrator-created record** — a manual row exists nowhere but in
  `data_overrides` until its replay re-creates it;
- then **STOPPED the promotion at the `data_edits` remap**, because those manual rows' audit rows
  resolve through `first_kick_goal_key` / `after_siren_key`, and a row that does not exist cannot
  be resolved.

That is the AFLDB-ISSUE-162 / -163 obligation arriving for a third and a fourth entity type, and
it is discharged the same way — **with one addition neither of those had to make.**

### 26.3 One authority, two adapters — and only one of them is in the Python loop

The runbook's replay step is a Python loop over `replay_admin_overrides`. `after_siren_kicks`
joins it, placed before `'fixtures'` so the existing AFLDB-ISSUE-162 assertion still anchors on
the tuple's closing parenthesis. **`player_achievements` cannot join it**: D-3 put its adapter in
TypeScript (`tools/records/special-records-replay.ts`) because its importer is TypeScript, so the
runbook now prints a second, explicitly separate invocation for it, run as the import role
against `AFLDB_IMPORT_DATABASE_URL`. `data_overrides` remains the **sole** durable authority;
this is the same two-adapters-one-authority shape §8.2.1 approved, surfaced where the operator
acts on it.

**The runbook deliberately says "write it to a FILE".** Measured here:

```
npx tsx -e "import('./tools/records/special-records-replay')
              .then((m) => console.log(typeof m.replaySpecialRecordOverrides,
                                       typeof (m.default || {}).replaySpecialRecordOverrides))"
-> undefined function
```

`tsx -e` evaluates as CommonJS, where the adapter's named exports arrive under `.default`. A
one-liner in a runbook would therefore read `undefined`, throw *is not a function*, and look like
a broken adapter rather than a broken command. The file form is the one
`tools/records/import-first-kick-goal.ts` itself uses.

**Not executed here, and deliberately so.** Running the printed snippet needs a write-capable
connection; this session's mandate is a read-only gate, and the environment refused the attempt
when it was made. The snippet's *import shape* is proven (above, and by the importer that uses
it) and its arguments are pinned by `tests/data-overrides-source-contract.test.ts`, but its
**execution** belongs to Stage 8's DEV window, where a replay has real overrides to act on. That
is stated rather than implied, so nobody reads §26 as evidence the command has been run.

### 26.4 Gate G-6 — the real promotion check, twice

```
npm run db:promotion:check -- --phase source --database afldb_test

[PASS] Database identity
[PASS] Table classification (fail-closed)
[PASS] No leftover promotion_staging schema (AFLDB-ISSUE-151)
[PASS] Migration parity with this checkout
       102 migration file(s) in this checkout, 102 applied, latest 102_special_records_lifecycle.sql
[INFO] Test-fixture identities
[INFO] Production super admin
[INFO] Production-owned / operational state inventory
[INFO] Privileges reconciled

PROMOTION CHECK (prod/source): PASS — 8 gate(s) evaluated, none failed.
```

Run **before** the Stage 7 edit and **after** it, with identical output: 8 gates, 4 PASS + 4
INFO, none failed. **ISSUE-167 adds no new refusal class.** The ISSUE-139 / ISSUE-143 pre-cutover
refusals (UNKNOWN 079 + PENDING 091) are a **different phase against `afldb_prod`** and were not
re-run here: this stage is not authorised to touch production, and those refusals stand as
recorded, pre-existing, and unrelated to P4. `--phase source` is the phase P4's work can affect,
and it passes.

### 26.5 The build defect — a `node:crypto` import that reached a client bundle

`npm run build` **FAILED** on the first run, and nothing before it could have caught it:

```
Failed to compile.
node:crypto
Module build failed: UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins
Import trace for requested module:
  node:crypto
  ./src/lib/special-records/identity.ts
  ./src/app/admin/records/labels.ts
  ./src/app/admin/records/SpecialRecordCreatePanel.tsx
```

Stage 2 wrote `mintManualSourceRecordId()` into the **pure** grammar module, which was correct
until Stage 6 shipped a **Client** Component that reaches it through `labels.ts`. `tsc`, ESLint
and every vitest suite run in Node, where `node:crypto` resolves perfectly — this is the
AFLDB-ISSUE-162 lesson restated: **only `npm run build` sees a client bundle.**

**The fix is the smallest true one.** `identity.ts` now mints from **Web Crypto**
(`crypto.randomUUID()`), a global in Node (stable since 19), in the Edge runtime and in the
browser alike, returning the same cryptographically random v4 uuid. The module is now free of
imports altogether, which is what its own "DELIBERATELY PURE" contract always meant. The other
five minting sites (`admin-awards`, `admin-club-leadership`, `admin-coaches`, `admin-draft`,
`admin-fixtures`) keep `node:crypto` and are deliberately left alone: every one of them is
`server-only` and no client bundle can reach it.

No identity, grammar, refusal or replay semantic changed — the minted id is still
`'<family>:<uuid>'`, the Stage 6 writer mints through the same call, and the parity corpus that
pins both adapters is green.

```
npm run build   ->   exit 0
  ✓ Compiled successfully in 11.9s
  ✓ Generating static pages using 19 workers (1534/1534) in 57s
  prepare-standalone: standalone bundle ready
  all seven /admin/records routes present and ƒ (dynamic), as designed
```

**Warnings, classified.** Two, neither new nor ISSUE-167's:

| Warning | Classification |
|---|---|
| `The "middleware" file convention is deprecated. Please use "proxy" instead.` | **Known, pre-existing** Next 16.3.1 framework deprecation; the operator brief names it explicitly as not a Stage 7 defect |
| `A Node.js API is used (process.cwd …) which is not supported in the Edge Runtime` | **Not ISSUE-167's.** Every frame of its import trace is inside `next/dist/esm/server/…`; no repository file appears in it, and P4 touched no middleware. It was present in the FAILED build too, before the only source fix this stage made |

### 26.6 Files changed, and validation

**Modified (6), plus the four tracking documents:**

```
tools/db/promotion-inventory.ts               ACCEPTANCE_CHECKLIST: both entity types, both adapters
docs/production-promotion.md                  §8 step 1: after_siren_kicks in the loop, the TS half beside it
src/lib/special-records/identity.ts           the build fix — Web Crypto, no `node:` import at all
tests/db-promotion-check.test.ts              new: both families rebuilt + the checklist names both adapters
tests/data-overrides-source-contract.test.ts  new: the runbook names both adapters, and not the `-e` form
tests/special-records-identity.test.ts        new: identity.ts imports NOTHING, and still mints a v4 uuid
```

**Validation:**

| Check | Result |
|---|---|
| `npm run db:promotion:check -- --phase source --database afldb_test` | **PASS — 8 gates, none failed** (before and after the edit) |
| `npm run build` | **exit 0**, 1534/1534 static pages, standalone bundle ready |
| `tests/db-promotion-check.test.ts`, `tests/data-overrides-source-contract.test.ts` | **160 passed** |
| `tests/special-records-identity.test.ts` | **15 passed** |
| Those three plus `tests/auth.test.ts` and `tests/special-records-admin.test.ts`, final run | **372 passed, 0 failed** |
| `tests/special-records-replay-parity.test.ts` (both adapters, one corpus) | **19 passed** on `afldb_test` |
| `tests/integration/admin-special-records.test.ts`, `tests/integration/special-records-lifecycle.test.ts` | **48 passed, 1 skipped**, as `afldb_import` |
| `npx tsc --noEmit` | clean |
| ESLint, every changed file | clean |
| `git diff --check` | clean |

The Stage 6 mutation suite is the one that matters for the mint change: it creates manual records
through the real writer, so `crypto.randomUUID()` is exercised on its production path and not
only in a unit test.

### 26.7 Stage boundary

Stage 7 is green and **stops here**. Nothing staged, committed, pushed or merged; no DEV or PROD
migration; no deployment; no browser acceptance; **Stage 8 not begun**.

`CHANGELOG.md` is **deliberately not touched again**. Stage 6's `Unreleased` entry already
describes the retained behaviour; Stage 7 changed nothing a reader of the changelog can observe —
a corrected promotion runbook, a uuid minted from a different global that returns the identical
value, and three test files. An entry for it would be an investigation note, which §5 forbids.

**ISSUE-167 is NOT resolved.** Stage 8 — operator commit, DEV migration then code (no
`db:privileges` dependency, per D-5), then browser acceptance against §18 — is the next action.

*Superseded by §27 (2026-09-14): Stage 8 has since run. Migration 102 and the code are on DEV,
§18's matrix is green against real roles, and two defects were found and fixed. The issue is
still **not resolved**, for the single reason recorded in §27.10.*

---

## 27. Stage 8 execution evidence — **DEV acceptance GREEN, issue NOT resolved (2026-09-14)**

Stage 8 is **DEV only**. §17's row 8 and §13's deploy order define it as operator commit → DEV
migration → DEV code → browser acceptance against §18. **No production host, database, DSN or
service was contacted at any point in this stage**, and the DEV checkout carries no production
DSN (`.env` names `afldb_dev`, `afldb_test` and `code_test_db` only).

### 27.1 Checkpoint, before anything was touched

```
branch    opus/issue-167-special-records-admin
HEAD      c847b8896a1bd66e51dca8e120c80a4883ef30ea
@{u}      c847b8896a1bd66e51dca8e120c80a4883ef30ea   (origin/..., identical)
worktree  clean
```

Stage 7 is **committed and pushed at `c847b88`**. Every earlier line in this document that
called Stage 7 "UNCOMMITTED" was written before that commit and is stale; the header block is
corrected, and §26.7's `origin/main` argument is corrected there too.

### 27.2 DEV identity and pre-deploy state — measured, not assumed

```
host        streamanator (arm@10.0.40.100)
project     /home/arm/projects/afldb
service     afldb (/etc/systemd/system/afldb.service), active
database    afldb_owner@localhost:5432/afldb_dev
DEV HEAD    d0b522a (main) -- three commits behind origin/main, no ISSUE-167 code
migrations  101 file(s), 101 applied, 0 pending
lifecycle   information_schema returns ZERO rows for status / status_reason / updated_at
            on BOTH player_achievements and after_siren_kicks
```

That last line is the **direct evidence** that migration 102 had never reached DEV — replacing
the earlier inference from `origin/main`, which proved nothing (a host can check out any pushed
branch, and this stage did exactly that).

Baseline data: `after_siren_kicks` **126**, `player_achievements` **334** (all `first_kick_goal`),
`data_overrides` carrying **no** special-record entity type, `data_edits` carrying **none**.

### 27.3 Migration, then code — the order held

`npm run preflight -- --mode deploy` refuses a feature branch **by design**
(`branchPolicyProblems`: deploy is main-only), so the branch-appropriate gate was used:

```
npm run preflight -- --mode implementation --issue 167 --environment dev \
    --dsn-env AFLDB_OWNER_DATABASE_URL --expect-database afldb_dev
-> 2 FAIL: "implementation uses a linked worktree" (a workstation-workflow rule; the DEV
           deployment host is a primary checkout by construction)
           "102_special_records_lifecycle.sql is pending in the target database"  <- the
           condition this stage exists to resolve
   1 WARN: branch-local migration 102 -- reserve its number before applying it outside *_test
           (reserved at Stage 2, §21.1 G-7)
```

Deploy sequence, with the running service left on the OLD build throughout the first two steps:

```
1. sync-dev.ps1 -RemoteRef opus/issue-167-special-records-admin \
       -SkipMigrate -SkipBuild -SkipRestart -SkipHealth      # checkout + npm ci only
   -> before: d0b522a main | after: c847b88 opus/issue-167-special-records-admin
2. npm run db:migrate -- --allow-branch-local                 # DEV-only acknowledgement,
   -> applying 102_special_records_lifecycle.sql ... ok (25 ms)   docs/deployment.md:76-78
   -> 102 file(s), 102 applied, 0 pending
3. sync-dev.ps1 -SkipInstall -SkipMigrate                     # build + restart + health
   -> built BUILD_ID wWXvkc4sx7KJVCTVQoGMs, MainPID 2134528 -> 3011218,
      health ready after 2s: {"status":"ok","database":"ok","latencyMs":31}
```

`npm run db:migrate` **without** `--allow-branch-local` refuses an unmerged migration against a
shared database, so the plain `sync-dev.ps1` migrate step cannot apply 102; that is why the
migration was run by hand between two narrowed deploy runs rather than inside one.

Post-migration schema, verified on DEV: `status text NOT NULL DEFAULT 'active'`, `status_reason`
and `updated_at` on both tables; `data_overrides_entity_type_check` and
`data_edits_table_name_check` both carrying `player_achievements` and `after_siren_kicks`; all
126 + 334 existing rows defaulted to `active`. **D-5 held — no `db:privileges` run was needed or
performed, and `privileges.sql` was not touched.**

### 27.4 Two defects found by rendered acceptance, both fixed

Neither was reachable by any gate that ran before Stage 8. This is what the stage is for.

**F-1 — every mutation returned HTTP 500.** The first correction submitted on DEV failed:

```
X Error: A "use server" file can only export async functions, found object.
  digest: '2926408828@E352'
POST /admin/records/first-kick-goal/1 -> 500
```

`actions.ts` carries `'use server'` and exported two **const arrays**,
`FIRST_KICK_CORRECTABLE_FIELDS` and `AFTER_SIREN_CORRECTABLE_FIELDS`. Next.js enforces the
async-functions-only rule **when the Server Action is first invoked**, not when the bundle is
built — so Stage 7's `npm run build` passed at 1534/1534 pages, every unit test that imports the
module directly as TypeScript passed, and the surface still failed on its first real mutation.
The sibling admin surfaces keep their equivalent lists module-private for exactly this reason
(`src/app/admin/awards/actions.ts:165,358,550`); ISSUE-167 exported these so
`tests/special-records-admin.test.ts` could assert the Stage 6 invariant that the correctable set
equals the replay adapter's own column list.

**Fixed by moving both lists to `validation.ts`** — the domain's existing pure, directive-free,
unit-testable sibling, already imported by `actions.ts` — and repointing the test's import. The
contract test keeps its full coverage; no authority, audit, CAS or replay contract was touched.
A repo-wide scan found **no other `'use server'` module in `src/` with a non-async export.**

A regression gate was added in the closest existing suite
(`tests/special-records-admin.test.ts`, "exports only async functions from every 'use server'
module"). It strips comments before matching, because this module and `validation.ts` both
*discuss* `export const` in a `'use server'` file in order to say it must never happen — the
recorded lesson that a prose-matching gate fails on its own explanation. **Proven RED by
in-place differential**: re-adding one `export const` to `actions.ts` fails it with
*`src/app/admin/records/actions.ts` exports a non-async-function value: expected [ 'const' ] to
deeply equal []*, and GREEN once reverted.

**F-2 — the hub told a Super Admin the surface was read-only.** `/admin/records` rendered
Stage 3's unconditional `READ_ONLY_NOTICE` — *"Nothing here changes a record, and nothing here
deletes one"* — directly above controls that do exactly that. True for an Admin, false for a
Super Admin since Stage 6. Fixed by choosing the sentence with the same
`hasCapability(admin, 'data.specialRecords.edit')` check that decides whether the controls
render, using the pattern the two family list pages already use. **Verified in both directions
on DEV**: Super Admin sees the new `EDITABLE_NOTICE`, the real Admin account sees the unchanged
`READ_ONLY_NOTICE`.

Local validation of the fix: `tsc --noEmit` exit 0; `tests/special-records-admin.test.ts` +
`tests/auth.test.ts` **198 passed**; `git diff --check` clean.

### 27.5 How the fix reached DEV — and the provenance gap it leaves

The operator reserves commits, so the fix was **not** committed. `sync-dev.ps1` deploys from
`origin`, so it could not carry an uncommitted change. The four changed `src/` files plus the
changed test were copied to DEV and rebuilt, with the overlay proven byte-identical by md5 on
both sides. DEV therefore runs **`c847b88` plus a named, uncommitted five-file overlay**:

```
 M src/app/admin/records/actions.ts        M src/app/admin/records/validation.ts
 M src/app/admin/records/labels.ts         M tests/special-records-admin.test.ts
 M src/app/admin/records/page.tsx
```

`npm run build` on DEV **typechecks the test tree**, which caught the test's stale import before
the first rebuild — the build failed with TS2459 until the test file was copied across too.
Second build clean; MainPID 2134528 → 3028976 (4 workers), health `ok`/`ok`.

**This is the one thing standing between Stage 8 and resolution** (§27.10).

### 27.6 Replay and durable authority — proven through the REAL importers

The standalone adapters were run first, exactly as `docs/production-promotion.md` §8 prints
them (the Python `replay_admin_overrides` loop scoped to `after_siren_kicks`, and the
file-form `npx tsx replay-first-kick-goal.ts` for `player_achievements` — never the `tsx -e`
form §26.3 forbids). Against a zero-override baseline both were clean no-ops
(`{ recreated: 0, restored: 0, corrected: 0, lifecycle: 0, retained: [] }`).

A no-op proves nothing about reconstruction, so the decisive evidence was taken by running the
**real importers**, each of which calls its own adapter inside its own transaction
(`import-first-kick-goal.ts:1346`, `after_siren.py:1059`). A raw-SQL simulated reload was
attempted first and refused by the environment; the importer route is better evidence anyway.

State before the reloads: `player_achievements` 334 active with a `correction` override on
`fkg-001`; `after_siren_kicks` **125 active + 1 void**, the void row carrying both a `correction`
and a `lifecycle` override. One active decision and one suppression, so a single pass exercises
both branches.

```
npm run records:first-kick-goal -- --apply
-> Durable admin decisions replayed: 0 manual row(s) re-created, 0 restored,
   1 correction(s) re-applied, 0 lifecycle decision(s) re-asserted.
-> Reconciled 334 rows as import batch 90: 334 updated, 0 inserted, 0 deleted.

./.venv/bin/python tools/migration/after_siren.py load
-> batch 91: 126 events, 6 inserted or changed, 0 stale removed
```

Outcomes, all verified against the database:

* **The correction survived a 334-row reload.** The importer rewrote every source-owned column
  and the adapter re-applied the override — reported as `1 correction(s) re-applied`, and the
  whole-table fingerprint over `(id, notes, status, status_reason)` was **identical**
  (`dfef2342971ec9731df5d576837b1aba`) before and after.
* **The suppression was not resurrected.** After a full 126-event reload the counts were still
  **125 active / 1 void**, with the void row's reason intact — the precise failure §8 warns about
  ("skip either replay and the promoted site publishes suppressed records again") did not occur.
* **`data_overrides` was not modified by replay**: all four rows unchanged in value and
  `is_active`.
* **Replay wrote no audit rows**: `data_edits` stayed at 5 rows / max id 47 across both reloads.
  Replay is reconciliation, not a human edit, and the log correctly says so.
* **No duplicate rows and no unexpected source-owned retirement**: 334 / 126 throughout,
  `0 deleted`, `0 stale removed`.
* **No new refusal or data-issue class.** The importer's four cross-check findings
  (`career_kicks_contradicts_source` x1, `career_goals_contradicts_source` x1,
  `first_kick_match_unresolved` x2) are pre-existing source contradictions it reports on every
  run, unrelated to P4.

Re-running the after-siren loader converges: it reports `1 inserted or changed` each pass — the
reload writes the source value and the replay re-applies the override, the designed loop — and
the fingerprint is stable at `4d869e758093fed996c7e04c7ad5e9c3` across runs.

**One unrelated side effect, recorded rather than buried.** The after-siren loader's first run
changed **6** rows: DEV's `after_siren_kicks` was stale relative to the tracked
`data/records/after-siren-events.csv` (last loaded 2026-09-06), and the documented reload brought
it into line. Nothing to do with ISSUE-167; the acceptance row's own values were untouched.

**Manual-record reconstruction is proven by authority, not by a rebuild.** The manual record
created at §27.7 carries a whole-row `record` override — every field, `status`, `status_reason`
and identity — which is what a rebuild replays from. It survived a full reload (the importer
reconciles only its own `source_id`). The `manual row(s) re-created` counter itself only fires
against a table rebuilt from scratch, which is a promotion step, not a DEV one; that branch stays
covered by Stage 4's rebuild-survival tests (§23.5).

### 27.7 Rendered acceptance — §18's matrix, against real roles on DEV

Every role is a **real DEV account**, signed in by the operator through the real
`/admin/login` form with a real TOTP. No session was minted, no gate was relaxed, and no
credential was handled by this session.

| §18 check | Contributor (`testcon@test.test`) | Admin (`testadmin@test.com.tst`) | Super Admin |
|---|---|---|---|
| `/admin/records` reachable | ✗ redirect to `/admin/upload` | ✓ | ✓ |
| Nav entry visible | ✗ (nav holds only Upload / Change password) | ✓ | ✓ |
| Detail / provenance / history | ✗ | ✓ read-only, **void record fully readable** | ✓ |
| Correct amendable field | ✗ | ✗ (no form, **zero** mutation buttons) | ✓ |
| Void / reinstate | ✗ | ✗ | ✓ |
| Create manual record | ✗ `/new` denied | ✗ `/new` denied, no link rendered | ✓ |
| Direct POST (bypass attempt) | ✗ redirect | ✗ redirect | ✓ |

**Denials are HTTP-layer redirects, never 200 + meta-refresh** — ISSUE-166's contract, measured
on every ISSUE-167 surface:

```
anonymous   /admin/records, /admin/records/first-kick-goal[/new],
            /admin/records/after-the-siren[/new], POST /admin/records/revalidate
            -> HTTP 307 + Location: /admin/login, meta-refresh count 0 on all seven
contributor -> every route redirects to /admin/upload, metaRefresh=false
admin       -> /admin/records/first-kick-goal/new and POST /admin/records/revalidate
               both redirect to /admin, metaRefresh=false
```

The Admin also sees the void record with its full reason and its `first_kick_goal_created` /
`first_kick_goal_suppressed` history — suppression hides a record from the public, never from an
administrator — while rendering no correction form and no create link. D-2 held throughout: the
after-siren detail states the link is resolved by the import and offers no player-link control.

**First-kick workflow (Super Admin, record 1 `fkg-001` Jack Kirby).** Correct → success banner
*"First-kick-goal record corrected."*, value visible, `data_overrides` gains
`(player_achievements, wikipedia_first_kick_goal:fkg-001, correction, {"notes": ...})` and
`data_edits` gains one row carrying old/new plus `entity_key` and `lineage_identity`. Suppress
with a mandatory reason (the confirm button stays disabled until one is typed) → status
*"Void — <reason>"*. **Public disappearance, decisively**: `/records/first-kick-goal` fell from
334 to 333 **and its EARLIEST summary moved 1911 → 1920 (Gordon Coventry)** — the filter reaches
the derived aggregates, not just the row list; the player page's Honours block disappeared
entirely; NL search returned 329 with Jack Kirby absent. Reinstate → active, public visibility
returned, count back to 334.

**After-siren workflow (Super Admin, record 1 Billy Schmidt, 1913 R15 St Kilda v Carlton).**
The five coupled event fields render as one group labelled *"The event — these five agree or the
correction is refused"*. Setting the result to a loss while the effect stays *won* produced the
readable football refusal **"A kick that won the match cannot be recorded against a loss."** and
left Save disabled — a domain rule stated in football, not in schema. A valid correction, a
suppression with reason (Billy Schmidt then absent from `/records/after-the-siren`), and a
reinstatement all behaved as the first-kick family did. `club_id` is derived and read-only, and
no player-link queue or control appears anywhere (D-2).

**Create.** A manual record was created through the real form and landed as row 335 with
provenance **MANUAL (ADMINISTRATOR) `manual_admin_edit`**, source record
`first_kick_goal:fdadd8a8-0178-4084-bea3-971bad3dc4da`, no import batch, and a whole-row
`record` override. It was publicly visible while active (335 recognised players).

**Replace was not exercised** — §18's matrix does not list it, and it is *suppress + create in
one transaction* with both halves and the atomic audit already proven here. Stated rather than
implied.

**CAS / stale form.** Two tabs on the same record; tab A reinstated it (bumping `updated_at`
13:14:22 → 13:15:51); tab B then submitted its stale `expectedUpdatedAt`. Result:

* readable refusal — **"That record changed while this page was open. Reload it and try again."**;
* **keyboard focus stayed on the button** (`document.activeElement` = the Reinstate button, not
  `body`) — the known ISSUE-155 §27.27 H defect, **verified here rather than assumed fixed**;
* **zero write**: `data_edits` held exactly 3 rows for that record (corrected / suppressed /
  reinstated) and the refused fourth action added none.

**Revalidation (S-6 / D-9).** The network trace for one correction is
`POST /admin/records/first-kick-goal/1` → 200, then a **separate**
`POST /admin/records/revalidate` → 200, then a refetch. Revalidation happens after the action
resolves, from a second request, never inside the action — the contract that keeps the Next 15.5
client from hanging. The UI never stuck pending.

**Match-delete refusal.** Both families, both refused, neither match deleted:

```
match 1103 (Essendon v Richmond 1911, Jack Kirby's first-kick match)
  "Match #1103 carries 1 curated special record (first-kick-goal fkg-001) and cannot be
   deleted. Deleting the match would destroy or orphan a record that carries its own durable
   decision and audit trail. Suppress or reassign it in Special records
   (/admin/records/first-kick-goal) first."
match 1313 (St Kilda v Carlton 1913, Billy Schmidt's after-the-siren kick)
  "... carries 1 curated special record (after-the-siren 1913-vfl-afl-15-st-kilda-billy-schmidt)
   and cannot be deleted. ... (/admin/records/after-the-siren) first."
```

Each names its own family, its own record id and the right admin path. Afterwards: both matches
present, both collateral rows present, `matches` still **17,052**. **The refusal is SERVER-side.**
`DeleteMatchButton` renders it as the action's returned `state.warning`, and its confirm button
is *not* disabled (`disabled=false`, `pointer-events: auto`) — it only disables while pending or
after success. So the operator clicked a live confirm and the server refused; the guard is not a
client-side gate, which is the stronger result. The destructive confirm was clicked by the
operator, not by this session.

**Public regression smoke**, all with the acceptance data active:

* `/records/first-kick-goal` — 334 recognised players, summary tiles correct;
* `/records/after-the-siren` — renders, Billy Schmidt present once reinstated;
* player page — Honours block returns after reinstatement;
* NL — *"players who kicked a goal with their first kick"* → 329; *"players with the most goals
  after the siren"* → *"Barry Hall and Gary Rohan — 2 kicks after the siren (tied)"*, with the
  1913 provenance note intact;
* **Grid Solver** — all three special-record criteria are offered (`Won a game with a kick after
  the siren`; `Goal with their first kick, for club`; `... between seasons`), and a solve on
  builder `after_siren_winner` returned a populated grid with **no timeouts**, Billy Schmidt
  among the answers.

D-6 was honoured: no fixture expectation was re-baselined.

**Not separately rendered:** `/players/compare`'s first-kick honour. Its data comes from the same
`playerHonours()` fragment in `src/db/queries/awards.ts:569-570` that carries
`AND a.status = 'active'` and was proven live on the player page; the compare page needs a
two-player selection this session did not complete. Recorded as covered-by-the-same-fragment, not
claimed as rendered.

**Responsive** (`/admin/records/first-kick-goal/1`): **768, 1000, 1280 and 1920 all clean**, no
horizontal overflow. At **320** the document scrolls to 425px: the detail page's key/value tables
overflow even though each sits in the repo's `.table-wrap` (`overflow-x: auto`), which the family
list page at the same width contains correctly. §18 sets device priority desktop > tablet > phone
and makes phone-only polish a follow-up rather than a P4 blocker, so this is **recorded as a
follow-up, not fixed** — a speculative change to a shared CSS class late in an acceptance stage
would risk the sibling admin surfaces for no acceptance gain.

### 27.8 Acceptance data — what was used, and what remains

| Row | Used for | Final state |
|---|---|---|
| `player_achievements` 1 (`fkg-001`, Jack Kirby) | correct, suppress, reinstate, CAS | **Restored** — `notes` NULL, `status` active |
| `after_siren_kicks` 1 (Billy Schmidt) | correct, invalid-coupling refusal, suppress, reinstate | **Restored** — original `notes` text, `status` active |
| `player_achievements` 335 (manual) | create, provenance, reload survival | **Void**, reason recorded — retained DEV fixture |

`after_siren_kicks` is back to **126 active / 0 void**. `player_achievements` is **334 active +
1 void**, the void row being the manual fixture. **There is no hard delete by design** (§4), so
voiding is the supported cleanup path and the fixture row is retained deliberately, clearly
labelled in both its notes and its void reason. The **append-only `data_edits` trail was not
erased** — 10 rows record every acceptance action, which is the product behaving correctly;
erasing them to tidy up would violate the audit contract this issue exists to protect. Two
`correction` overrides remain, holding the restored values.

### 27.9 Final DEV state

```
service      afldb active; health {"status":"ok","database":"ok","latencyMs":13}
migrations   102 file(s), 102 applied, 0 pending
code         c847b88 + the five-file Stage 8 overlay (§27.5)
logs         since the fixed build: 1,927 requests, ZERO 5xx, ZERO application errors
batches      0 running import batches
data         after_siren_kicks 126 active / 0 void; player_achievements 334 active / 1 void
fingerprints player_achievements dfef2342..., after_siren 88c57296... (post-restore), stable
PRODUCTION   never contacted -- no prod host, DSN, database or service touched in this stage
```

### 27.10 Stage boundary — the one blocker, as it stood before the closeout

> **SUPERSEDED by §27.10a and §27.11 (2026-09-14).** The blocker below was real when written and
> is recorded unchanged; it has since been closed. Do not read this section as current state.

Every §18 acceptance row is **green**, both defects Stage 8 found are **fixed and regression-
gated**, and DEV is healthy. One thing remains, and it is an operator action by design:

> **The Stage 8 fix is uncommitted, and DEV is running it as a working-tree overlay rather than
> as a deployed commit.** Until the operator commits and pushes it and DEV is redeployed from
> that commit, the deployed SHA does not describe the code that passed acceptance — and a
> `sync-dev.ps1` run or a `git checkout` on DEV would silently revert the surface to the state
> that returns HTTP 500 on every mutation.

Closing sequence: operator reviews and commits the five files → pushes → `sync-dev.ps1`
(`-RemoteRef opus/issue-167-special-records-admin`) to restore clean provenance → confirm one
mutation still succeeds → **then** ISSUE-167 may be resolved on DEV acceptance, and ISSUE-156 P4
closed with it. Production remains a separate, unauthorised, future decision.

### 27.10a Superseded

The closing sequence above was carried out in full on 2026-09-14: the operator committed and
pushed the fix as `026ec2a`, DEV was redeployed from it through `sync-dev.ps1`, and one mutation
was proven to succeed on the committed build. **ISSUE-167 is RESOLVED.** §27.11 is the evidence.

### 27.11 Closeout — the committed build, deployed and proven (2026-09-14)

§27.10 named one blocker: the Stage 8 fix was uncommitted and DEV ran it as a working-tree
overlay. The operator has since committed and pushed it as **`026ec2a`**, and DEV has been
redeployed from that commit through the established `sync-dev.ps1` path. **The blocker is closed.**

**The overlay was discarded losslessly, not overwritten.** Before redeploying, each of the five
overlay files on DEV was checksummed against the committed blob and all five matched exactly
(`actions.ts` `3f5df9fd…`, `labels.ts` `c600f2a8…`, `page.tsx` `fe1c1418…`, `validation.ts`
`cd55b0fd…`, `tests/special-records-admin.test.ts` `a7cead28…`), so `git checkout --` on those
paths could not lose work. The DEV tree was clean before the deploy ran.

**Migration 102 was NOT reapplied, and was proven already correct first:**

```
afldb_meta.schema_migrations 102_special_records_lifecycle.sql
  checksum dec12080ca270d7dcdd32c026a11b0025cc2352e0c0d247b11af1aa701f5f173
  applied  2026-09-14 12:52:23
sha256sum src/db/migrations/102_special_records_lifecycle.sql
           dec12080ca270d7dcdd32c026a11b0025cc2352e0c0d247b11af1aa701f5f173   <- identical
npm run db:status -> 102 file(s), 102 already applied, 0 pending
```

The deploy therefore ran `sync-dev.ps1 -RemoteRef opus/issue-167-special-records-admin
-SkipMigrate`.

**Deployment proof:**

```
DEV HEAD      026ec2ab9c41f9a1ca3f1f80d5256d38d346d4f4  == @{u} == local HEAD
branch        opus/issue-167-special-records-admin
worktree      git status --porcelain -> EMPTY (no overlay, no untracked debris)
BUILD_ID      built 84-5g6y04iLdEo5FhrwxG == live x-afldb-build 84-5g6y04iLdEo5FhrwxG
service       afldb active, MainPID 3069523, 4 worker processes, clean Next.js 16.3.1 startup
health        {"status":"ok","database":"ok","latencyMs":31}
migrations    102 applied, 0 pending
```

**The defect is gone on the committed build — proven by a real mutation, not by inspection.**
One narrow Super Admin correction was made through the rendered UI on `player_achievements` 1
(`fkg-001`, Jack Kirby): set `notes`, save, then clear it again.

```
POST /admin/records/first-kick-goal/1  -> 200      (this returned 500 before the fix)
POST /admin/records/revalidate         -> 200      (still the separate, post-action request)
GET  /admin/records/first-kick-goal/1  -> 200
banner: "First-kick-goal record corrected."     browser console errors: 0
```

**The record was then restored exactly.** Both whole-table fingerprints are byte-identical to
their pre-mutation values — `player_achievements` `2f942ff0d72fac30e851829e609d521a`,
`after_siren_kicks` `88c572969fd2dc25eedc7ba296986c50` — `notes` is empty, `status` active, and
the existing `correction` override is back to `{"notes": null}`. **No new override row was
created**: the count stayed at five, because a correction reuses its row rather than accumulating
one per edit. `data_edits` went 10 → 12 rows (max id 52 → 54), which is correct and deliberate —
the log is append-only, the two corrections really happened, and erasing them to tidy up would
violate the audit contract this issue exists to protect.

**Since the committed build started: 216 requests, ZERO 5xx, ZERO application errors.**

**Final DEV fixture state — every row intentional and accounted for:**

| Row | State | Why it is there |
|---|---|---|
| `player_achievements` 1 (`fkg-001`) | active, `notes` empty | source record, restored to its loaded state |
| `after_siren_kicks` 1 (Billy Schmidt) | active, original `notes` | source record, restored to its loaded state |
| `player_achievements` 335 (manual) | **void**, reason recorded | the one deliberate DEV acceptance fixture |
| `data_overrides` | 5 rows | 2 restored corrections, 2 lifecycle-active, 1 manual whole-row |
| `data_edits` | 12 rows | append-only audit of every acceptance action |

`after_siren_kicks` is **126 active / 0 void**; `player_achievements` is **334 active / 1 void**.
**There is no accidental DEV-only record.** The single retained row is the manual fixture, void,
labelled as an acceptance fixture in both its notes and its void reason — and it is retained
because **this design has no hard delete by construction** (§4): voiding is the supported cleanup
path, and a hard delete would break the very guarantee the issue exists to provide.

**Two follow-ups, recorded and neither a blocker**, carried on the `AFLDB-ISSUE-156` umbrella
rather than reopening this issue:

1. the record detail page overflows horizontally at **320px** (768 / 1000 / 1280 / 1920 are clean)
   even though its tables sit in the repo's `.table-wrap`, which the family list page contains
   correctly at the same width — §18 sets device priority desktop > tablet > phone and makes
   phone-only polish a follow-up;
2. `/players/compare`'s first-kick honour was not separately rendered — it reads the same
   `status = 'active'` fragment (`src/db/queries/awards.ts:569-570`) proven live on the player page.

**ISSUE-167 is RESOLVED on DEV acceptance**, and `AFLDB-ISSUE-156` **P4 is closed with it**.
**Production deployment is not part of this issue** and was never contacted: promotion of the
Admin Centre work remains an umbrella decision under ISSUE-156, and when it happens the
`docs/production-promotion.md` §8 replay step must run **both** special-record adapters.
