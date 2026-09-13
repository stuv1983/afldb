# AFLDB-ISSUE-167 — Special records administration and durable suppression

**Status:** Planning (approved runbook pending operator sign-off)
**Severity:** Medium-high
**Area:** Admin / Data management / Acquisition / Public read models
**Created:** 2026-09-13
**Parent:** `AFLDB-ISSUE-156` P4 (Admin Centre umbrella)
**Inherited scope:** `AFLDB-ISSUE-155` Phase E (§12, §14.4, §23 Phase E), transferred to ISSUE-156 by reference
**Branch:** `opus/issue-167-special-records-admin`
**Worktree:** `D:\dev\afldb-issue-167`

This document is a planning deliverable. No application code, migration, privilege,
test or deployment change was made while producing it. Every stage below re-verifies
current repository evidence before it writes anything.

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

### 6.5 Privileges

Both tables already carry `grant_app_read` and `grant_import_write` (`053:151-152`,
`089:159-160`). Grants are **table-level**, so new columns need nothing further.

**But `afldb_auth` does.** The admin surface reads these tables on the **auth pool**, and
`privileges.sql`'s `afldb_auth` list is **hand-typed and subtractive** — any operational
table missing from it is silently revoked. This is the exact class of defect the umbrella
recorded as *"an admin page reading an operational table on the wrong pool (only a real
role enforces it)"* (`AFLDB-ISSUE-156.md:730-733`).

**Stage 2 must add `player_achievements` and `after_siren_kicks` SELECT for `afldb_auth`
to `tools/maintenance/privileges.sql` in the same change** (umbrella R-2: *a new read
surface without a `privileges.sql` entry in the same change → stop*). Additionally,
`data_overrides` admin write already exists via migration 078's COLUMN-level grants —
**re-verify against 078, since ISSUE-165's memory records that owner-role tests hid exactly
this**.

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

**Nav:** one `Data` group entry, after `Awards & honours`:

```ts
{ href: '/admin/records', label: 'Special records', capability: 'data.specialRecords.read' }
```

**Privileges:** §6.5 — `afldb_auth` SELECT on both tables in `privileges.sql`, same change.

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
4. **`after_siren_kicks` must not remain unclassified** — the file's own
   `kind: 'unclassified'` problem class (`:2082-2104`) reports a public table in neither
   the registry nor the contract, and umbrella **R-3** says an unclassified table breaks
   production promotion for unrelated phases → **stop before merge**.

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
  `table_name` values appearing — **to be confirmed at Stage 6**, since the viewer may
  carry its own table-name allowlist for labels.

---

## 13. Migration / deploy order

```
1. Migration 10N                     (lifecycle columns; data_overrides entity widening;
                                      data_edits table_name widening)
2. npm run db:privileges             (afldb_auth SELECT on both tables — §6.5)
3. Code                              (queries, actions, routes, capability, nav,
                                      public status filters, importer refusals, replay,
                                      promotion-inventory)
4. UI exposure                       (nav entry becomes reachable)
```

**Why this order.** The `data_overrides` widening is order-independent (§6.3: neither
table is a settle target, and `manual-authority.ts`'s refusal proof is order-independent
about non-settle-targets). The **privileges step is not** — the admin pages read both
tables on the auth pool, and `privileges.sql` is subtractive, so code deployed before
privileges fails closed at runtime in a way no local gate catches. This is the umbrella's
own recorded lesson (`AFLDB-ISSUE-156.md:730-733`).

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
| Privileges/promotion behaviour cannot be made fail-closed | **NOT triggered** — but §6.5 and §11 are both **blocking** work, not optional |

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
| **2** | Migration 10N (lifecycle columns + **both** CHECK widenings, §6.3/§6.4) + `privileges.sql` + RED identity/constraint tests | Gates G-3, G-4, G-7, G-8 (**G-1 already satisfied**) |
| **3** | Capability (`data.specialRecords.*`) + nav + read-only admin surface (list/detail/provenance, incl. read-only link state per D-2) | `tests/auth.test.ts` green; three-role denial proven server-side |
| **4** | Both replay adapters + importer refusals (**the Phase E stop condition**) | Gates G-5, G-9. Reload-survival, rebuild-survival, atomicity and adapter-parity tests green. **STOP** if a suppressed fact can be resurrected by any path, or if the TS adapter cannot run on the importer's own `tx` |
| **5** | Public read-model `status = 'active'` filters, fragment by fragment | Every consumer in §7 filtered and tested; no unfiltered reference remains |
| **6** | Mutations: correct / void / reinstate / replace / create, atomic audit, CAS, revalidation out of the pending path | Atomicity and CAS tests green; `match-admin` refusal green |
| **7** | `promotion-inventory.ts` entries + `db:promotion-check` + `npm run build` | Gate G-6. **STOP before merge** on any new refusal class (umbrella R-3) |
| **8** | Operator commits; DEV deploy (migration → `db:privileges` → code); browser acceptance | Acceptance matrix §18 |

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

## 19. Operator decisions — **all four RECORDED 2026-09-13**

| # | Decision | Outcome |
|---|---|---|
| **D-1** | Family / father-son scope | **APPROVED — EXCLUDE.** P4 is limited to first-kick goal and after-the-siren. Family/father-son remains outside ISSUE-167 entirely. The `/records/family` namespace is left unclaimed (§3.3) |
| **D-2** | After-siren player-link resolution | **APPROVED — DEFER.** P4 may display current linkage state but must **not** create another player-link queue or authority, and must not collide with `AFLDB-ISSUE-164`. `LINK_TARGET_TABLES` is not modified (§3.5) |
| **D-3** | Where Family A's replay lives | **APPROVED WITH MODIFICATION — one durable authority, two replay adapters.** `data_overrides` stays the sole durable authority; after-siren uses the existing Python `common.py` contract; `import-first-kick-goal.ts` gets an explicit TypeScript adapter with the same `lifecycle`/`correction`/`record` semantics; both pinned by parity/contract tests; **replay atomic with the owning importer**; do not port first-kick to Python; no second authority mechanism. **Atomicity proven structurally feasible from source — §8.2.2; the STOP clause is not invoked** (§8.2.1–§8.2.3) |
| **D-4** | Capability shape | **APPROVED — TWO capabilities.** `data.specialRecords.read` (Admin + Super Admin) / `data.specialRecords.edit` (Super Admin). Create, correct, void, suppress, reinstate and replace are all writes under `.edit`; no separate `.suppress`. Supersedes ISSUE-156 §2's working name (§9) |

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
