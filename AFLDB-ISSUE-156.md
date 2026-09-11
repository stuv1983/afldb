# AFLDB-ISSUE-156 — Admin Centre completion (umbrella runbook)

**Status:** Open / Planning complete — no implementation started.
**Severity:** Medium
**Area:** Admin / Authentication / Data management / Acquisition / Operations
**Created:** 2026-09-11
**Parent lineage:** `AFLDB-ISSUE-155` (Phases D–I transferred here by reference; see §0)
**Children allocated:** `AFLDB-ISSUE-157` (P1), `AFLDB-ISSUE-158` (P2), `AFLDB-ISSUE-159` (P3), `AFLDB-ISSUE-160` (P3b — Draft administration, a supplemental child inserted after P3 on 2026-09-11; P4–P12 keep their labels), `AFLDB-ISSUE-161` (P3c — Season list administration, a supplemental child inserted after P3b on 2026-09-11, Stage 1 AND Stage 2 complete/uncommitted; P4–P12 keep their labels), `AFLDB-ISSUE-162` (P3d — Fixture / season schedule administration, a supplemental child inserted after P3c on 2026-09-11, owning migration **097**; Stage 1 backend only, uncommitted and not yet validated, Stage 2 not built; P4–P12 keep their labels). P4–P12 are named placeholders and receive an ID only when each phase starts.

This document is a planning deliverable. No application code, migration, privilege, test or
deployment change was made while producing it. Every later phase must re-verify the repository
facts it cites at its own preflight; the facts recorded here are a 2026-09-11 snapshot.

---

## 0. Relationship to AFLDB-ISSUE-155

`AFLDB-ISSUE-155` delivered Phases A (capability policy + Admin Centre navigation), B (Super
Admin user lifecycle), C1 (Brownlow canonical workflow + migration 094) and C2 (Brownlow admin
UI), all deployed and accepted on DEV on 2026-09-11.

**Ownership transfer (2026-09-11):**

| ISSUE-155 scope | New owner |
|---|---|
| Phase D — Coach administration and durable assignments (`AFLDB-ISSUE-155.md` §23, §9) | this umbrella, P3 |
| Phase E — Special records and durable suppression (§23, §12) | this umbrella, P4 |
| Phase F — Structured site content extension (§23, §11) | this umbrella, P6 |
| Phase G — Safe current-season refresh jobs (§23, §13) | this umbrella, P7 |
| Phase H — Dataset-by-dataset CSV transition (§23, §4) | this umbrella, P11 |
| Phase I — Integrated acceptance and permission audit (§23) | this umbrella, P12 |
| PROD closeout of implemented A/B/C1/C2 | **remains in ISSUE-155** |

The transfer is by reference. `AFLDB-ISSUE-155.md` is not rewritten; its §5 (source of truth),
§6 (permissions), §7 (information architecture), §17 (audit/security), §18 (cache) and §23
Phases D–I are the binding baseline architecture for this umbrella. Where this document and
ISSUE-155.md differ, this document governs for D–I-derived work; ISSUE-155.md governs for
A/B/C1/C2 and its own PROD closeout.

**ISSUE-155 PROD is not a blocker** for any phase here. Phases build on the committed branch
state (`3eb6739` / `e27e985`), not on production.

---

## 1. Target information architecture

Adopt `AFLDB-ISSUE-155.md` §7 verbatim as the baseline: Overview / Data / Acquisition / Site /
People & access / Operations / Account, rendered through the Phase A grouped responsive shell
(`src/app/admin/nav-model.ts`, `layout.tsx`, `AdminNav.tsx`, `AdminSection.tsx`).

Additions this umbrella introduces, and nothing else:

| Group | Route | Phase | Notes |
|---|---|---|---|
| Operations | `/admin/audit` | P1 | Read-only audit viewer over `auth_audit_log` + `data_edits` |
| Data | `/admin/coaches`, `/admin/coaches/[id]` | P3 | Replaces the coach slice of `/admin/data-editor` |
| Data | `/admin/draft`, `/admin/draft/new`, `/admin/draft/[id]` | P3b | Draft administration and new-player draft intake (added 2026-09-11, `AFLDB-ISSUE-160`). Replaces the draft slice of `/admin/data-editor` and the draft block of `CreatePlayerForm` — the one draft mutation contract |
| Data | `/admin/season-lists`, `/admin/season-lists/[season]`, `/admin/season-lists/[season]/[club]` | P3c | Season list administration (added 2026-09-11, `AFLDB-ISSUE-161`, Stage 1 AND Stage 2 complete/uncommitted): authoritative club playing lists per season; new canonical table `season_list_members`; no public consumer change |
| Data | `/admin/fixtures`, `/admin/fixtures/[season]`, `/admin/fixtures/[season]/[fixtureKey]` | P3d | Fixture / season schedule administration (added 2026-09-11, `AFLDB-ISSUE-162`, **Stage 1 backend only, uncommitted and not yet validated; Stage 2 routes NOT built**): a future season's schedule as `fixtures`, a new canonical registry that is not `matches`; "played" is resolved at read time and never stored; no public consumer change (D-7) |
| Data | `/admin/records/*` (first-kick, after-siren, family) | P4 | Special records |
| Data | `/admin/honours/*` | P5 | Awards/honours correction lifecycle |
| Site | existing `/admin/content`, `/admin/settings` widened | P6 | No new top-level route by default |
| Operations | `/admin/refresh` (or the existing current-season route widened) | P7 | Allowlisted refreshes only |
| Data | domain routes replacing `/admin/data-editor/*` | P8 | Decomposition, not rewrite |
| Data | `/admin/players/[id]/lifecycle` (merge preview/confirm) | P9 | High blast radius, §10 |
| Data | `/admin/matches/[id]/identity` | P10 | High blast radius, §10 |

Kept as-is: `/admin/grid-solver` stays a `permanentRedirect` compatibility shell, out of nav.
`/admin/brownlow/**` is complete and is not touched by any phase.

---

## 2. Capability / role matrix

`src/lib/auth/capabilities.ts` declares 18 capabilities. At planning time only
`data.brownlow.read`, `data.brownlow.draft` and `data.brownlow.finalise` reach
`requireCapability()`; the other 15 influence `nav-model.ts` visibility only. Enforcement today
is role-name guards (`requireSuperAdmin` ×78, `requireAdmin` ×23, `requireUploader` ×13,
`requireAdminManager` ×5) against 11 `requireCapability` calls.

Rule for every row below and every capability a later phase adds: **the matrix names the
enforcing server-side guard at the route/action boundary, not merely the nav entry.** A
capability that appears only in navigation is a defect (P2 makes this a CI-failing contract).

| Capability (declared or planned) | Contributor | Admin | Super Admin | Enforcing guard (target) | Phase |
|---|---|---|---|---|---|
| `data.brownlow.read` / `.draft` / `.finalise` | – / – / – | ✓ / ✓ / – | ✓ / ✓ / ✓ | `requireCapability` (already) | done (155 C2) |
| remaining 15 declared capabilities | per `capabilities.ts` | per `capabilities.ts` | ✓ | `requireCapability` beside or replacing role guard | P2 |
| `people.admins.lifecycle` | – | – | ✓ | **`requireSuperAdmin` retained** + documented capability assertion beside it (ISSUE-155 §26.3: a `can_manage_admins` delegate must stay denied) | P2 |
| `ops.audit.read` (new) | – | ✓ (own-scope TBD at P1 preflight) | ✓ | `requireCapability` | P1 |
| `data.coaches.edit` (new) | – | draft-level TBD | ✓ | `requireCapability` | P3 |
| `data.draft.read` / `data.draft.edit` (new, 2026-09-11) | – / – | ✓ / – | ✓ / ✓ | `requireCapability`; new-player creation and AFL Tables identity attach sit under `.edit`, no third capability (`AFLDB-ISSUE-160.md` D-6) | P3b |
| `data.fixtures.read` / `data.fixtures.edit` (new, 2026-09-11) | – / – | – / – | ✓ / ✓ | `requireCapability`; both Super Admin, because a fixture is forward-looking administrative intent about a season the register has not reached (`AFLDB-ISSUE-162.md` §23). **Declared in Stage 2, not yet built** | P3d |
| `data.records.edit` / `.suppress` (new) | – | – | ✓ | `requireCapability` | P4 |
| `data.honours.correct` (new) | – | – | ✓ | `requireCapability` | P5 |
| `site.content.publish` (new or existing widened) | – | – | ✓ | `requireCapability` | P6 |
| `ops.refresh.run` (new) | – | – | ✓ | `requireCapability` + operation allowlist | P7 |
| `data.players.merge` (new) | – | – | ✓ | `requireCapability` + `requireSuperAdmin` retained + typed confirmation | P9 |
| `data.matches.rekey` (new) | – | – | ✓ | `requireCapability` + `requireSuperAdmin` retained + typed confirmation | P10 |

Names above are working names; each phase fixes the identifier at preflight and adds it to the
`Capability` union so the P2 source contract covers it automatically.

---

## 3. Canonical write ownership per admin domain

Extends `AFLDB-ISSUE-155.md` §5. The Admin Centre may only write where this table says so;
everywhere else it records a durable override or refuses.

| Domain | Canonical source | Admin Centre write | Durable mechanism | Phase |
|---|---|---|---|---|
| Brownlow round votes / season totals | `brownlow_round_votes` (canonical), `brownlow_season_votes` derived at publication | Draft/finalise/publish only via `src/db/queries/admin-brownlow.ts` | entry state + authority tables (094) | done |
| Admin users | `auth_users` | Phase B lifecycle transaction only | atomic `auth_audit_log` | done |
| Coaches / match coaching tenure | `coaches`, `match_coaches` (source-provenanced, 087) | Manual rows under a manual source; edits to source-owned rows via override | `data_overrides` widened to coaches; `data_edits` allowlist widened | P3 |
| Draft selections and manual players (added 2026-09-11) | `draft_picks` (source-owned by DraftGuru, key 069); `players` + `external_identities` | Source-owned selection fields via override; manual selection = ordinary row under `manual_admin_edit` with `player_url = 'manual:<token>'`; manual player = ordinary `players` row with a minted `manual_admin_edit` identity in `external_identities`; both re-created on promotion by the `players`/`draft_picks` replay branches | `data_overrides` (`players`, `draft_picks` — already admitted, no widening) + `data_edits` | P3b |
| First-kick goal / after-siren / family records | `player_achievements` (053), `after_siren_kicks` (089), family list (088) | Patch/suppress via override, never direct rewrite of source rows | `data_overrides` widened; explicit suppress operation | P4 |
| Awards / honours | award tables (source-owned) | Correction lifecycle with review; never a second authority for Brownlow | `data_overrides` widened; `data_edits` | P5 |
| Site content / settings | `site_settings`, content revisions | Existing `/admin/content`, `/admin/settings` patterns reused | existing revision metadata | P6 |
| Current-season refresh | importer jobs | Trigger only, allowlisted operations, single-flight | status/job record (see §6) | P7 |
| Players (identity) | `players` + stable IDs | Merge is preview → review → typed confirm; deactivate-not-delete analogue | reversible merge record | P9 |
| Fixtures (identity) | `matches`; `src/lib/acquisition/match-rekey.ts` | Preview + typed confirm, or stays CLI-only (§10) | `data_overrides` (already read by rekey) | P10 |
| Match sheet statistics | existing data-editor actions | Moved into domain routes, not rewritten | existing `data_edits` | P8 |

Invariants carried from ISSUE-155: Brownlow totals use their authoritative source; historical
club identity is explicit; player identity uses stable IDs; missing historical statistics mean
"not recorded", not zero; manual decisions survive reloads via `manual_admin_edit` /
`data_overrides` and are never deleted by a down-migration.

---

## 4. Audit contract

| Event class | Table | Written by | Requirement |
|---|---|---|---|
| Authorisation, refusal, lifecycle, login/session | `auth_audit_log` | auth pool (`afldb_auth`) | Same transaction as the refused/accepted action where one exists; `detail` is `jsonb` |
| Statistical / entity mutation (old → new values) | `data_edits` | `src/db/queries/audit-log.ts` writer | **In-transaction, required.** A mutation without its `data_edits` row must not commit |
| Durable change to a source-owned row | `data_overrides` | import/acquisition role | Recorded as the durable decision the reload path honours |

No post-commit audit anywhere. Refusal audit follows the ISSUE-155 C2 precedent: audit
refusals that carry information (`stale`, `already_final`, `forbidden`), not every validation
miss.

Driver traps binding on every phase that reads these tables (P1 first):

- `auth_audit_log.id` and `data_edits.id` are `bigint`. postgres.js returns int8 as a
  **string**; number-keyed lookups miss silently. Cast `::int` in SQL or key on strings.
- `auth_audit_log.detail` is `jsonb` and the driver **does** decode it. Do not decode again on
  read. The hazard is a double-encoded write; existing `fromStore()`-style absorbers are
  deliberate and must not be "simplified" away.

---

## 5. Privilege boundaries

Four-role separation is unchanged: `afldb_owner` (migrations), `afldb_import` (importers and
acquisition), `afldb_auth` (application auth pool), `afldb_app` (public read).

`tools/maintenance/privileges.sql:435-470` is the `afldb_auth` specification and is
**subtractive** (`:430-434`): any `public` object not named there is revoked on every
reconcile. Consequences:

- P1 needs **no privilege change**: `auth_audit_log` is `SELECT, INSERT` (`:441`) and
  `data_edits` is `SELECT, INSERT` (`:463`) for `afldb_auth` already, and both are reachable
  through `src/db/authClient.ts`.
- `data_overrides` is granted only to `afldb_import` (`:318-327`). Surfacing overrides in any
  admin read surface requires a `privileges.sql` entry **and** a deploy-order step
  (`db:privileges` before code, or the read fails closed). This is why `data_overrides`
  visibility is outside P1's default scope.
- Any new table read or written by the application needs `afldb_meta.grant_app_read()` /
  the `afldb_auth` list updated in the same change, otherwise the app fails closed after the
  next reconcile.
- Never `grant_import_write()` for workflow tables; follow the ISSUE-155 C1/C2 precedent of
  explicit narrow grants.

---

## 6. Migration requirements

**Planning-time snapshot only: highest migration on this branch and all local branches is
`094_brownlow_admin_workflow.sql`, so the next free number was 095 on 2026-09-11.** No number
is allocated here. **Every phase must re-check `src/db/migrations/` on its own branch at
preflight**; ISSUE-151/152/153/154/155 work may consume numbers first.

| Phase | Migration expected | Content | Allowlists to widen |
|---|---|---|---|
| P1 | none | — | — |
| P2 | none | — | — |
| P3 | yes | coach manual-source provenance decision (see §10 stop condition C-1); `data_overrides.entity_type` and `data_edits.table_name` widened for coaches | both |
| P3b | **none** | `players` and `draft_picks` are already admitted by both CHECKs; identity is carried in existing columns (`AFLDB-ISSUE-160.md` §10). Next free number was 096 on 2026-09-11, not allocated | — |
| P3c | **yes, one** | `season_list_members` table + indexes + `afldb_season_list_clubs(season)` helper; `data_overrides.entity_type` += `'season_list_members'`; `grant_app_read`/`grant_import_write`. No `data_edits` widening (audited on `players`). **096 allocated and written 2026-09-11**, applied to `afldb_test` only (`AFLDB-ISSUE-161.md` §22, §32) | `data_overrides` only |
| P3d | **yes, one** | `fixtures` table + indexes + CHECKs (schedule facts only — no score/result/margin/attendance column, and deliberately no `match_id` and no `match_key`); `data_overrides.entity_type` += `'fixtures'`; `data_edits.table_name` += `'fixtures'`; `grant_app_read`/`grant_import_write`. No function is created or altered — club eligibility reuses P3c's `afldb_season_list_clubs()`. **097 allocated and written 2026-09-11**, applied to **`afldb_test` only** (evidenced by the 2026-09-11 integration run); the all-refs collision check is still outstanding (`AFLDB-ISSUE-162.md` §37.7, §37.10) | both |
| P4 | yes | explicit patch/suppress operation on `data_overrides` (or smallest equivalent); entity widening for `player_achievements`, `after_siren_kicks`, family list | both |
| P5 | yes | honours entity widening; review-state if no current token suffices | both |
| P6 | none unless revision/history metadata is insufficient | monotonic revision only | — |
| P7 | only if durable single-flight/status cannot be provided otherwise | `admin_refresh_jobs` with operation allowlist check, state check, timestamps, requester FK | — |
| P8 | none | — | — |
| P9 | yes | reversible merge record table | `data_edits` |
| P10 | probably none | uses existing `data_overrides` read by `match-rekey.ts` | — |
| P11, P12 | none | — | — |

Two allowlists called out because they are constraints, not code:

- `data_edits.table_name` CHECK: 8 entities at planning time (057 → 058 → 094).
- `data_overrides.entity_type` CHECK: still only `('players','matches','draft_picks')` (073,
  never widened). **Deploy-order rule from ISSUE-155 §14:** ship the reader that understands
  the widened check *before* expanding the constraint, or fail-closed introspection trips.

All migrations forward-only in production. Rollback = disable new routes/actions, preserve new
audit/provenance rows.

---

## 7. Cache / revalidation requirements

Extends `AFLDB-ISSUE-155.md` §18. Known hazards from memory that every phase must respect:
`/seasons/[year]` and the landing pages are ISR with a one-hour window and per-worker page
cache; `revalidatePath` **inside** a Server Action hangs the Next 15.5 client (the
player-links fix moved it out of the action path).

| Phase | Public surfaces affected | Revalidation |
|---|---|---|
| P1 | none (admin-only reads) | none |
| P2 | none | none |
| P3 | player pages, club season pages, coach pages | tag/path revalidation after commit, outside the action's pending path |
| P3b | `/players/[slug]` (ISR 1h) and `/sitemap.xml`; `/draft`, `/draft/[year]`, `/players` are `force-dynamic` and need nothing | same shape as P3 (`revalidatePaths` returned by the action, POSTed to a bounded allowlisted route afterwards) |
| P3d | **none** — `fixtures` has no public reader at all (`AFLDB-ISSUE-162.md` §22, D-7) | **none**; no Server Action in P3d revalidates a public path |
| P4 | player pages, records pages, match pages | same |
| P5 | player pages, honours pages, season pages | same |
| P6 | root layout / content pages | reuse existing `/admin/content` root-layout revalidation |
| P7 | current-season pages | importer already handles; refresh must not add a second, conflicting revalidation |
| P8 | as today for data-editor | unchanged |
| P9 | every page naming either player | explicit list produced by the preview step |
| P10 | match, season, ladder pages | explicit list produced by the preview step |

---

## 8. Responsive / shared admin component requirements

- Every admin surface works at 320 px, tablet and desktop; 44 px minimum touch targets; no
  hover-only provenance or state disclosure.
- Every admin form that can refuse an action reuses `src/app/admin/brownlow/focus-restore.ts`
  (the ISSUE-155 H-1 fix): a refused action must not dump keyboard focus to `document.body`.
- Server Actions that drive `useActionState` dispatch inside `startTransition` through a
  single submit helper, and reconcile client state from a recorded server revision rather than
  a `useEffect` dependency array (the C2 stale-tab fixes).
- **Extraction rule:** a component moves into `src/components/admin/` only when two or more
  existing admin routes already duplicate the pattern (filter bars, paginated tables,
  provenance panels). No speculative extraction. Reuse the `src/app/admin/player-links/`
  pager and `ResolvePanel` rather than inventing a second pager.
- Disabled controls rely on React's fiber-read `disabled`, which already defeats DOM-level
  bypass; do not add client-only guards as if they were security.

---

## 9. Dependency graph

```text
P1 (157) ──┐
           ├─► P3 ──► P8 ──► P11 ──► P12
P2 (158) ──┤     │
           ├─► P4 ┘
           ├─► P5
           ├─► P6
           ├─► P7
           ├─► P9  (needs P1 audit viewer to prove attribution; needs P8 domain routes)
           └─► P10 (needs P1; needs ISSUE-142/151 lineage contract honoured)
```

- P1 and P2 are functionally independent; either order works. P1 first is recommended (§11).
- P3b (`AFLDB-ISSUE-160`) sits between P3 and P8 in the graph: it reuses P3's action,
  revalidation and transaction patterns, adds **no** table, and honours the ISSUE-151 contract by
  adding a lineage identity rule (`draft_pick_key`) and a `data_edits` target for `draft_picks`
  plus widening the `players` rule to manual identities — see `AFLDB-ISSUE-160.md` §11. P8's
  data-editor decomposition inherits the draft slice already removed.
- P3d (`AFLDB-ISSUE-162`) sits after P3c and depends on it for exactly one thing: club eligibility
  via `afldb_season_list_clubs()`, reused unchanged. It adds the `fixtures` table, has no public
  consumer in either direction, and adds a `fixture_key` lineage identity rule so a `data_edits`
  row about a fixture survives a promotion remap — see `AFLDB-ISSUE-162.md` §20.
- P3, P3d, P4, P5, P7, P9, P10 each add a table or a NOT NULL football reference and therefore
  **must add a `tools/db/promotion-inventory.ts` classification entry in the same change**
  (see ISSUE-151 dependency below). P1, P2, P6, P8, P11, P12 are not affected.
- P12 runs last and is the only phase that re-runs the full permission audit across all
  routes.

**AFLDB-ISSUE-151 (settled; inherited contract, not a blocker).** ISSUE-151 is completed and
nothing in it needs resolving before any phase here. What it leaves behind is architecture that
later phases inherit: `promotion-inventory.ts` is a fail-closed classification set whose own
comments (`:528`, `:561`) record that unclassified tables once refused every promotion phase on
every real database. ISSUE-155 C1/C2 added `brownlow_vote_entry_state` and
`brownlow_season_authority` under that contract and invented the `rowIdColumn` remap mechanism
(`:206`, `:1236`) for a table whose primary key is the remapped column. That mechanism is
reused by any later table remap. The obligation on this umbrella is only to honour the
promotion/restore-lineage contract in every change that adds a table or a NOT NULL football
reference.

---

## 10. Risk register and stop conditions

| ID | Risk | Phase | Stop condition |
|---|---|---|---|
| R-1 | A route loses its existing server guard while migrating to capabilities | P2 | Any direct URL or action rejects more weakly than before → stop |
| R-2 | Subtractive `afldb_auth` spec silently revokes a newly read table | all | A new read surface without a `privileges.sql` entry in the same change → stop |
| R-3 | Unclassified new table breaks production promotion for unrelated phases | P3/P4/P5/P7/P9/P10 | Missing promotion-inventory entry → stop before merge |
| R-4 | `data_overrides` constraint widened before its reader ships | P3/P4/P5 | Reader not deployed first → stop. **Amended for P3 (2026-09-11, decision D-1):** the real hazard is not the reader but `src/lib/acquisition/manual-authority.ts`, whose exact-set proof degrades the nightly settle to propose-only in **either** order. P3 replaces that proof with an order-independent one; **no deploy window is acceptable in which widening `data_overrides` can silently switch the settle from apply to propose-only** |
| R-5 | Player merge cannot preserve the losing identity for audit attribution, or a derived total cannot be proven recomputed | P9 | Merge stays operator-only |
| R-6 | Browser-initiated rekey can desynchronise the promotion lineage contract | P10 | Rekey stays CLI-only |
| R-7 | `revalidatePath` inside a Server Action hangs the client | P3–P10 | Move revalidation out of the pending path |
| R-8 | int8-as-string / jsonb double-decode on audit columns | P1 | Contract test on the query layer before UI |
| **C-1** | **~~Coach-only identity creation as specified in ISSUE-155 §9 is not implementable against the current schema~~ — DECIDED 2026-09-11, `AFLDB-ISSUE-159`.** `coaches.afltables_coach_path` is `NOT NULL UNIQUE` (087:38) and `coaches.source_id` is `NOT NULL` (087:58). | **P3** | **CLEARED.** A manual coach is an ordinary `coaches` row whose `afltables_coach_path` **and** `name_key` are both a synthetic `'manual:' || <token>` under the **existing** `manual_admin_edit` source (057:36-42); the durable record is a `data_overrides` row replayed on reload and promotion. Nothing relaxed, nothing dropped, no new `sources` row, no merge tooling. The nullable-path alternative was rejected: `data_edits.row_id` is lineage-bound and name-derived identity is forbidden, so a NULL path stops the promotion. Rationale and citations: `AFLDB-ISSUE-159.md` §1–§2 |
| R-9 | Refresh job runs an operation outside the allowlist or overlaps a running settle | P7 | Any unbounded importer argument reachable from the browser → stop |
| **R-10** | A manually created player is duplicated when AFL Tables first publishes them: the nightly settle never creates players, but the operator-run `import_fitzroy_core.py` inserts any profile with no registered identity | **P3b** | `AFLDB-ISSUE-160.md` W-3 / D-2: the admin attaches the profile path first (the settle and the importer then both resolve the existing player), backed by a fail-closed name+dob refusal in `import_players()` (operator-run importer only). If D-2 is declined, new-player creation is **not shipped** |

**P9 — Player / entity lifecycle including merge — is not ordinary CRUD.** No merge tooling
exists anywhere in the repository (`tools/migration/`, `src/lib/acquisition/`). Required: a
mandatory preview enumerating every affected row across `player_match_stats`,
`player_achievements`, `player_link_resolutions`, `coaches.player_id`,
`after_siren_kicks.player_id` and career derivations; a second human review step; derived-data
recomputation named explicitly; a durable, reversible merge record; typed confirmation. Reuses
the Phase B transaction shape (advisory lock, invariant check, atomic audit).

**P10 — Fixture-identity correction — is not ordinary CRUD.**
`src/lib/acquisition/match-rekey.ts` already owns this and reads `data_overrides` (`:191`,
`:199`). Required: preview of every dependent row, explicit derived-data implications, and the
ISSUE-142 lineage-remap interaction, because match identity is exactly what the promotion
contract remaps.

---

## 11. Phase ordering and acceptance gates

| # | Issue | Title | ISSUE-155 lineage | Blast radius | Gate summary |
|---|---|---|---|---|---|
| P1 | **AFLDB-ISSUE-157** | Admin foundation and audit viewer | new | low | §P1 below |
| P2 | **AFLDB-ISSUE-158** | Capability enforcement | extends §23 Phase A | medium | §P2 below |
| P3 | **AFLDB-ISSUE-159** | Coach administration | Phase D (§23, §9) | medium | §P3 below — C-1 decided; two gated stages, hard gate = a real DEV settle still applying. **RESOLVED 2026-09-11, merged `af6379e`** |
| P3b | **AFLDB-ISSUE-160** | Draft administration and new-player draft intake | restored original Admin Centre scope (no ISSUE-155 phase) — inserted 2026-09-11 | medium-high (player identity) | §P3b below — no migration; W-3 cleared by D-2 (decided 2026-09-11, symmetric DOB rule); D-1…D-9 all decided; two stages, no DEV settle gate |
| P3c | **AFLDB-ISSUE-161** | Season list administration — authoritative club playing lists per season | new (no ISSUE-155 phase) — inserted 2026-09-11, stacked on P3b | medium (player–club–season model; one migration) | §P3c below — **Stage 1 AND Stage 2 complete 2026-09-11** (D-3 evidence gate passed, migration 096, replay/promotion classification proven; admin surface implemented, Stage 2 validation not yet run) |
| P3d | **AFLDB-ISSUE-162** | Fixture / season schedule administration — a future season's schedule inside AFLDB | new (no ISSUE-155 phase) — inserted 2026-09-11, stacked on P3c | medium-high (new canonical table beside `matches`; one migration; promotion lineage) | §P3d below — **Stage 1 backend only, 2026-09-11, UNCOMMITTED and NOT YET FULLY VALIDATED** (migration 097 applied to `afldb_test` only; typecheck, unit, contract, regression and lint gates green on the second run; the integration suite is awaiting a rerun after a test-ordering repair; preflight and the all-refs 097 collision check outstanding). Stage 2 admin surface NOT built. No DEV and no PROD acceptance is claimed |
| P4 | placeholder | Special records — first-kick / after-siren / family | Phase E (§23, §12) | medium-high | suppress operation proven reload-safe |
| P5 | placeholder | Awards and honours correction lifecycle | §5, §12 tail | medium | never a second Brownlow authority |
| P6 | placeholder | Site content and versioning | Phase F (§23, §11) | medium | reuse root-layout revalidation |
| P7 | placeholder | Safe refresh and operational controls | Phase G (§23, §13) | high | allowlist + single-flight + settle-timer interaction proven |
| P8 | placeholder | Data-editor decomposition into domain routes | §7, §15 | medium | move, don't rewrite; existing tests still green |
| P9 | placeholder | Player / entity lifecycle incl. merge | new | **HIGH** | §10 R-5 |
| P10 | placeholder | Fixture-identity correction | new | **HIGH** | §10 R-6 |
| P11 | placeholder | Dataset-by-dataset CSV transition | Phase H (§23, §4) | medium | each of the 6 registered datasets decided individually |
| P12 | placeholder | Integrated acceptance and permission audit | Phase I (§23) | — | all roles × all routes × direct actions |

Every phase: focused unit → route/action authorisation for all three roles → integration on
`afldb_test` → responsive browser pass → typecheck; DEV deploy and acceptance before PROD is
even discussed. Each phase allocates its own issue ID at start by the standard next-ID search.

### P1 handoff contract — AFLDB-ISSUE-157: Admin foundation and audit viewer

**Objective.** Make `auth_audit_log` and `data_edits` operationally inspectable, and establish
shared admin component patterns only where extraction is already justified by duplication.

**Read-only wherever possible.** No new mutation. The only non-read surface contemplated is the
existing logout/session pattern.

**Scope.**
- New `/admin/audit` route in the Operations group, two tabs or a unified timeline over
  `auth_audit_log` and `data_edits`.
- Filters: actor, date range, entity (`table_name` + `row_id`), action.
- A per-entity view answering "who changed player X, when, from what, to what" by rendering
  `data_edits.old_values` / `new_values` field by field.
- Reader functions added beside the existing writer in `src/db/queries/audit-log.ts` (or a
  sibling read module), SELECT-only, parameterised.
- Extract into `src/components/admin/` only patterns already duplicated by two or more admin
  routes. Reuse the `player-links` pager.
- A capability for the viewer (working name `ops.audit.read`) added to the `Capability` union
  and enforced with `requireCapability()` at the route boundary.

**Confirmed at planning: no migration and no privilege change.** `privileges.sql:441` and
`:463` already grant `afldb_auth` SELECT on both tables; the auth pool
(`src/db/authClient.ts`) reads them today (`src/app/admin/page.tsx:46-51` is the only current
reader, three columns, `LIMIT 15`).

**Explicitly deferred.** `data_overrides` visibility. It is `afldb_import`-only
(`privileges.sql:318-327`); surfacing it needs a `privileges.sql` change and a deploy-order
step. Optional, separately gated extension. Not in P1's default scope.

**Driver traps (binding).** int8-as-string on both `id` columns; jsonb already decoded on
`detail`. See §4.

**Dependencies.** None on ISSUE-151 (no table, no football FK). None on ISSUE-155 PROD.

**Preflight (implementation session).**
1. `npm run preflight -- --mode implementation --issue 157` on a fresh worktree.
2. Re-verify `privileges.sql` grants for `auth_audit_log` and `data_edits` are unchanged.
3. Re-check `src/db/migrations/` highest number (expect none needed; record anyway).
4. Confirm `Capability` union and `nav-model.ts` shape since `e27e985`.

**Acceptance gate.** Query-contract unit tests (int8/jsonb handling, filter SQL) → route/action
authorisation tests for Contributor / Admin / Super Admin → filter-correctness integration
against `afldb_test` → responsive browser pass at 320 px / tablet / desktop → typecheck.
Extend `tests/auth.test.ts` for the nav contract; integration lives in a new
`tests/integration/admin-audit.test.ts` only if no existing admin integration suite fits.

**Stop conditions.** Any write path introduced; any privilege or migration found necessary for
the default scope (means the planning finding was wrong — stop and record).

### P2 handoff contract — AFLDB-ISSUE-158: Capability enforcement

**Objective.** Make the declared capability model authoritative rather than decorative.

**Scope.**
- Migrate role-name guards to `requireCapability()` where the capability table already
  describes the exact same boundary: the 15 unenforced capabilities in
  `src/lib/auth/capabilities.ts`, across call sites under `src/app/admin/**`.
- **Retain explicit Super Admin-only boundaries** where policy requires them.
  `people.admins.lifecycle` is the worked example (ISSUE-155 §26.3): keep
  `requireSuperAdmin()` and add a documented capability assertion beside it, not instead.
- **Source-contract regression** (the deliverable that makes this stick): a test proving every
  `Capability` union member is referenced by at least one `requireCapability()` call at a
  route/action boundary, and that no admin route or Server Action reaches a mutation without a
  server-side capability assertion. Reads source, so drift fails CI. Home:
  `tests/auth.test.ts` (already carries the nav contract). No new test file by default.

**No migration. No privilege change. No ISSUE-151 dependency.**

**Depends on P1** only for shared component patterns it may reuse; functionally independent.

**Preflight.** `npm run preflight -- --mode implementation --issue 158`; enumerate current
guard call sites and `requireCapability` sites fresh (counts above are a 2026-09-11 snapshot).

**Acceptance gate.** Capability source-contract test → per-role direct-URL and direct-action
rejection tests for all 18 (plus any newly added) capabilities → confirm no route lost its
existing guard (ISSUE-155 Phase A stop condition restated) → typecheck.

**Stop condition.** Any existing direct URL loses its current server guard, or a capability is
enforced more weakly than the role guard it replaced.

### P3 handoff contract — AFLDB-ISSUE-159: Coach administration

**Allocated 2026-09-11. Status: Planning / Approved for Stage 1 — not implemented.** The
authoritative contract is `AFLDB-ISSUE-159.md`; this section is the umbrella's summary of it.

**C-1 is decided (see §10).** Migration **095** is allocated to this phase.

**Correction to §1 of this runbook.** `/admin/coaches` does **not** replace "the coach slice of
`/admin/data-editor`" — there is no coach slice. `EDITABLE_ENTITIES` carries only `players`,
`matches` and `draft_picks`, and no file under `src/app/admin/` mentions coaches. P3 **adds** a
surface; `/admin/data-editor` is untouched and coaches deliberately never enter
`src/lib/edit/spec.ts`.

**Two gated stages, one issue.**

- **Stage 1 — contract, migration, reload, promotion (no UI).** Rewrite `overrideScopeProven` in
  `src/lib/acquisition/manual-authority.ts` to an order-independent proof (§10 R-4 as amended);
  migration 095 (`data_overrides.entity_type` += `'coaches'`, `'match_coaches'`;
  `data_edits.table_name` += `'coaches'` only; `coaches_path_namespace_ck` and
  `coaches_manual_identity_ck`); `replay_admin_overrides` branches for both new entity types with
  two ordered call sites in `import_match_coaches.py`; the `'afltables_coach_path'` lineage
  identity rule and the `data_edits` coach target in `tools/db/promotion-inventory.ts`;
  `docs/production-promotion.md` §8. **Opus 5, high effort.**
- **Stage 2 — the admin surface.** Capabilities `data.coaches.read` (Admin-and-up, resolving §2's
  "draft-level TBD" as *Admin may inspect, only Super Admin may mutate*) and `data.coaches.edit`
  (Super Admin only); `/admin/coaches` and `/admin/coaches/[id]`; seven Server Actions each
  asserting `requireCapability()` first; every mutation one import-role transaction writing
  canonical row + `data_overrides` + `data_edits` atomically. **Sonnet 5, medium**, escalating to
  Opus for the assignment transaction and the permission matrix.

**The gate between them is not negotiable:** Stage 1 must be deployed to DEV and proven by a
**real settle run** in which `match_period_scores`, `player_match_stats` and
`brownlow_round_votes` still **apply**, not merely propose. UI work does not start before it.

**No `PROMOTION_CONTRACT` entry** for `coaches` / `match_coaches` — both are already
`grant_import_write`-registered (087:114-115), so an entry is a `{kind:'both'}` refusal. §10 R-3
is satisfied by the lineage identity rule and the `data_edits` target instead.

**No `privileges.sql` change** (R-2 satisfied): both tables are already `grant_app_read` and
`grant_import_write` registered, and decision D-2 keeps override reads on a narrow server-side
SELECT-only import-role helper rather than granting `afldb_auth`.

**Out of scope, reported:** coach reconciliation — a manual coach later acquiring an AFL Tables
identity — is **P9-class** (§10 R-5). The manual row can never be deleted, so a merge needs a
durable supersession record, a mandatory preview, a second review step and a reversible merge
record, and no merge tooling exists in the repository. P3 ships duplicate **prevention** only:
no merge, no `superseded_by` column, no delete path for `coaches`. It receives its own ID when
P9 starts and is **not** folded into 159.

### P3b handoff contract — AFLDB-ISSUE-160: Draft administration and new-player draft intake

**Allocated 2026-09-11. Status: Stage 1 and Stage 2 IMPLEMENTED 2026-09-11,
uncommitted, not deployed, not merged.** Operator decisions D-1…D-9 were
decided 2026-09-11 (D-2 symmetric-DOB importer guard; D-3 conditional on read-only PROD probes
and a pre-deploy sequencing decision S-1 against the paused ISSUE-151 promotion; D-7 adoption
also mints an identity-less legacy player's identity; D-8 both J-3 branches pre-authorised;
D-9 Stage 2 only) and implemented as decided. **D-8 resolved to the J-3 HARD-REFUSAL branch**:
the gate-2 probe measured zero `(draft_year, draft_kind, pick_number)` collisions across all
6,810 source selections on `afldb_test` and `afldb_dev`. Capabilities (D-6) were deliberately
deferred out of Stage 1 (`tests/auth.test.ts` fails on a capability declared but enforced at no
page, route or action, and Stage 1 shipped no route) and delivered in Stage 2 instead, with
`/admin/draft` as the enforcing surface. The probe table, the gate results and
the real defects found during implementation are in `issues.md`. The authoritative contract is `AFLDB-ISSUE-160.md`; this
is the umbrella's summary. Draft administration was part of the original Admin Centre intent
but had no phase of its own; it is restored here as a supplemental child after P3 so P4–P12
keep their labels.

**Objective.** One authoritative, audited, replayable, promotable contract for draft
selections, including onboarding a genuinely new person into AFLDB through their draft
selection — search-before-create, duplicate refusal, atomic player + selection creation — and
attaching a later AFL Tables identity to that same player rather than minting a second one.

**Planning findings that bind implementation.**
- Admin-created players and picks today have **no promotion identity** (both vanish on
  promotion; a manual player's `data_edits` rows stop a PROD promotion), and editing an
  admin-created pick writes a `data_overrides` key of `null|null|<year>|null`. ISSUE-160
  **prevents new occurrences** of all three by the ISSUE-159 pattern: a minted
  `manual_admin_edit` token carried in existing columns (`external_identities` for players,
  `draft_picks.player_url = 'manual:<token>'` for picks), a whole-row `data_overrides` record,
  and re-create branches in `replay_admin_overrides`. Existing rows are repaired **per row**
  only, through the D-7 adopt action (a legacy pick and, when needed, its identity-less
  player, in one transaction); no bulk backfill. Existing `null|…` override keys are inert and
  stay as frozen residue, enumerated by the gate-2 probe (runbook §13).
- **No migration, no privilege change**: `players` and `draft_picks` are already admitted by
  both CHECKs.
- The nightly settle never creates a player and resolves debutants only through registered
  AFL Tables identities, so *attach-first* is immediate and sufficient; the residual duplicate
  risk is the operator-run fitzRoy import, closed by a fail-closed name+dob **refusal** (never a
  link) in `import_players()` — decision D-2 (approved, symmetric DOB rule: either DOB unknown
  or both equal → refuse, both known and different → distinct namesake; a refusal rolls back
  the whole players batch), stop condition W-3 cleared (§10 R-10).
- `/admin/data-editor` loses its draft slice and `CreatePlayerForm` its draft block;
  `createPlayerInTransaction` stops inserting `draft_picks`; `saveEdit` refuses `draft_picks`.
  `EDITABLE_ENTITIES.draft_picks` survives as the validation spec only.
- Merging two existing players and relinking/unlinking a source-owned selection stay **P9**.

**Two stages, one issue.** Stage 1 (Opus 5, high): identity/provenance contracts,
`createPlayerInTransaction` minting, `src/db/queries/admin-draft.ts`, replay branches, importer
guard and ledger target, promotion inventory, docs, unit + `afldb_test` integration. Stage 2
(Sonnet 5 high for UI wiring, Opus for the create-player wizard action and permission matrix):
`/admin/draft`, `/admin/draft/new`, `/admin/draft/[id]`, capabilities `data.draft.read`
(Admin-and-up) / `data.draft.edit` (Super Admin), shared revalidate/submit extraction (D-9).
DEV browser acceptance is deferred until the operator updates DEV for the Admin Centre batch.

---

### P3c handoff contract — AFLDB-ISSUE-161: Season list administration

**Allocated 2026-09-11. Status: STAGE 1 AND STAGE 2 COMPLETE 2026-09-11 (Stage 1 Opus 5 high, Stage 2 Sonnet 5 high) — not committed, not deployed.** Stage 2 delivers `/admin/season-lists`, `/admin/season-lists/[season]`, `/admin/season-lists/[season]/[club]`, capabilities `data.seasonLists.read/.edit`, the nav entry and the ISSUE-160 handoff link. First operator validation run found 3 auth/unit failures and 1 new lint error, all fixed by a 2026-09-11 repair pass that also filled a genuine missed mandatory contract item (`+added/-departed vs S-1`, a "departed since S-1" panel) found on re-inspection; awaiting the operator's confirming re-run. The D-3 evidence gate **passed** (modern-era probe = 0 rows; all 249 historical multi-club player-seasons end at 1992), so `UNIQUE (season, player_id)` stands; **migration 096 is allocated** and applied to `afldb_test` only. Delivered: `season_list_members`, `afldb_season_list_clubs()`, the `data_overrides` widening and both registries; `src/db/queries/admin-season-lists.ts` (add / multi-select add / remove + tombstone / transfer / copy-forward / appearances review projection / diagnostics); `src/db/queries/player-identity.ts` extracted behaviour-preservingly from `admin-draft.ts` + `players.ts`; the fail-closed `replay_admin_overrides('season_list_members')` branch, its fitzRoy call site, the promotion §8 loop and the acceptance checklist. 25 pure + 40 integration tests green (including the real Python replay and a fixture-independence proof against a season with zero matches), ISSUE-160 regressions 45 + 120 green, tsc/lint/`git diff --check` clean. D-2 was approved with modification: 2027 is the first authoritative list season and 2026 appearances are never promoted into membership (non-authoritative review seed only); D-3 is subject to a Stage 1 evidence gate (stop on contrary evidence); ISSUE-161 does not own fixtures (likely ISSUE-162) and must not depend on one. The authoritative contract
is `AFLDB-ISSUE-161.md`; this is the umbrella's summary. Stacked on P3b (`opus/issue-161-season-lists`
from `opus/issue-160-draft-admin` @ `1295d3d`); ISSUE-160 is not merged first, and no Admin/Super
Admin change reaches DEV until both are complete and the operator confirms the batch is closed.

**Objective.** Make each club's playing list for a season an explicit, authoritative, audited,
replayable and promotable fact administered in the Admin Centre, so AFLDB no longer depends on
match data or an external site to say who is on a list, and so a draftee, a listed-but-never-played
rookie, a delisting, a return and a change of clubs are all representable as season membership —
never as a lifecycle flag.

**Planning findings that bind implementation.**
- Every existing player–club/season table is DERIVED from matches and truncate-rebuilt, so none
  can carry a listing (ISSUE-152 measured zero zero-game `player_clubs` rows). Chosen model: new
  canonical registry table `season_list_members` (`UNIQUE (season, player_id)`), durable record in
  `data_overrides` under the natural key `<club_slug>|<season>|<player identity>`, per-mutation
  import-role transactions with `data_edits` audited against the player, a fail-closed
  `replay_admin_overrides('season_list_members')` branch after `players`, and inactive overrides as
  removal tombstones that no importer or replay may resurrect.
- No `retired` flag; not-current = no membership in the current list season (`max(season)` over
  memberships); "unknown" until every eligible club has a list.
- `seasons`, `clubs.last_season` and `club_seasons` are never written (reference-loaded or derived;
  the ISSUE-101 rollover owns the register). List season validity is `FIRST_LIST_SEASON <= S <=
  max(seasons.year)+1` with no FK to `seasons`; for `S >= max(year)` the eligible clubs are the
  `is_current_afl_club` identities via a new SQL helper. `afldb_identity_for_season()` and ISSUE-160
  J-6 are untouched.
- One migration (next free 096, allocated at Stage 1): table, indexes, helper,
  `data_overrides.entity_type` widening (order-independent for the settle), read/write registries.
  No `PROMOTION_CONTRACT` entry, no new lineage target, no `privileges.sql` edit.
- Capabilities `data.seasonLists.read` (Admin+) / `data.seasonLists.edit` (Super Admin). Routes
  `/admin/season-lists`, `/[season]`, `/[season]/[club]`. No public consumer change; no revalidate
  route until one exists.
- ISSUE-160 integration: handoff link + draftee suggestion panel, explicit add, never automatic;
  `resolvePlayerIdentity` extracted into a shared module behaviour-preservingly.

**Two stages, one issue — both complete.** Stage 1 (Opus 5 high): migration,
`src/db/queries/admin-season-lists.ts`, replay branch and call site, promotion docs, contract +
`afldb_test` integration suites. Stage 2 (Sonnet 5 high, per the operator's session assignment —
the plan's Fable 5.1 high recommendation was not what was actually run): admin surface,
capabilities, nav, ISSUE-160 handoff — implemented, its typecheck/tests/lint not yet run.
DEV/Playwright acceptance deferred to the Admin Centre batch. Operator decisions D-1…D-8 (decided)
in `AFLDB-ISSUE-161.md` §30.

**Out of scope, reported:** public consumers of lists (club/player pages, NL, Grid Solver, draft
pages) and an external-source reconciliation view (no club-list importer exists) — each a separate
child when started.

---

### P3d handoff contract — AFLDB-ISSUE-162: Fixture / season schedule administration

**Allocated 2026-09-11. Status: STAGE 1 (BACKEND) BUILT 2026-09-11, UNCOMMITTED, NOT YET VALIDATED —
not deployed, DEV and PROD untouched. Stage 2 (the `/admin/fixtures` surface) NOT BUILT.** The
authoritative contract is `AFLDB-ISSUE-162.md`; this is the umbrella's summary. Stacked on P3c
(`opus/issue-162-fixture-admin` from `34858ce`); ISSUE-160 and ISSUE-161 are not merged first, and
**the combined-batch rule remains binding: no Admin/Super Admin change from P3b, P3c or P3d reaches
DEV until the whole Admin Centre batch is complete and the operator confirms it is closed.**

**Objective.** Let AFLDB represent a match that has NOT been played. `matches` requires
`home_score`, `away_score`, `result` and `margin`, and every derived figure reads it, so a scheduled
game cannot live there without counting as a 0-0 result. P3d adds a separate canonical registry,
`fixtures`, whose row asserts only "this match is SCHEDULED".

**Findings that bind implementation.**
- `fixtures` carries schedule facts only — no score, result, margin, winner, attendance, period,
  lineup or statistic column — so "0-0 means unplayed" is unrepresentable rather than merely
  forbidden, and nothing in the module writes `matches` or any table derived from one (§21).
- Identity is `fixture_key`, a minted `randomUUID()` never edited, surviving reschedule, venue
  change, round correction, home/away swap, club replacement, cancellation, voiding, a destructive
  rebuild and a promotion. There is deliberately **no `match_id` and no `match_key` column**:
  `match_key` is a content address over season|round|date|home|away — over exactly the fields a
  fixture exists in order to change (operator constraint, D-6).
- "Played" is DERIVED at read time and never stored: exactly one `matches` row for the same season,
  same `round_code` and same club pair, or zero exact and exactly one swapped. **Any other
  combination is `ambiguous` and links to nothing** — no name matching, no date tolerance, no venue
  comparison, no fuzzy fallback, and no tie-break between competing candidates.
- Removal is never a DELETE: `cancelled` (a genuine event that did not happen, reversible) and
  `void` (the record should never have existed, terminal) both keep the row, so every `data_edits`
  row stays resolvable through the `fixture_key` lineage rule at the next promotion remap — the
  dangle ISSUE-160 D-3 exists to prevent. `cancelled → void` is an explicit audited correction of
  classification; Stage 2 must gate void behind destructive confirmation and a reason.
- Durability is the ISSUE-159/160/161 shape: one whole-row `data_overrides` record keyed
  `manual_admin_edit:<token>` carrying club SLUGS and a venue SLUG, replayed fail-closed by
  `replay_admin_overrides('fixtures')`. An unresolvable venue slug degrades to the stored canonical
  NAME with `venue_id NULL` and a counted warning — never to TBC, never fuzzy-matched, and never a
  refusal that would stop a promotion over a venue rename.
- Club eligibility reuses P3c's `afldb_season_list_clubs()` unchanged; no `seasons`, `clubs`,
  `club_seasons`, `venues` or `venue_aliases` row is ever written (D-3), and the migration creates
  and alters no function.
- One migration, **097**, allocated and written 2026-09-11 — **applied to no database yet.**
- No public consumer, in either direction (D-7): nothing outside `/admin` reads `fixtures`, and no
  rebuild, settle or public query may read it.

**Validation state — nothing is claimed.** The operator's first run found four Stage 1 defects, all
repaired the same day (`AFLDB-ISSUE-162.md` §37.8): a missing `fixtures` audit label; a date check
that accepted impossible calendar dates; a played resolution that preferred one exact candidate over
a competing swapped one; and a result-comparison row chosen independently of that resolution. The
second run (2026-09-11, with the worktree `.env` in place) was green on typecheck, the fixture unit
suite, the contract/promotion/current-season suites, the ISSUE-161 regressions, ESLint and
`git diff --check`, and confirmed migration 097 is applied to `afldb_test`. The integration suite ran
31/5: all five failures were a test-ordering defect — the played-resolution tests wrote the played
`matches` row before creating the fixture, so §13's `already_played` guard correctly refused — now
repaired in the tests alone, awaiting the operator's rerun (expecting 36/36). Still outstanding and
still binding: `npm run preflight -- --mode implementation --issue 162`, the all-refs migration-097
collision check, and the re-gate after the integration rerun. **No DEV or PROD acceptance exists for
P3d.**

**Out of scope, reported:** every public fixture surface (a season schedule page, club fixture
lists, NL and Grid Solver awareness of unplayed matches) and any external fixture importer — each a
separate child when started.

---

## 12. Explicit non-goals

Inherits `AFLDB-ISSUE-155.md` §21 in full. Additionally:

- No reopening or expansion of ISSUE-155; its PROD deployment closeout stays in ISSUE-155.
- No ISSUE-153 work. No ISSUE-154 work, and **ISSUE-154 is not reused**: it is a ledger hole
  reserved by `IssuesIndex.md` for the Grid Solver won-final eligibility defect.
- No general CMS. No production repair console. Migrations, restores, arbitrary SQL/shell,
  Git, deployment, secrets and user-supplied executable paths never become browser operations.
- No dependency upgrades.
- CSV / upload / email ingestion is **live** (6 registered datasets in
  `src/lib/ingest/datasets.ts`, plus `tools/email_intake/fetch_and_stage.py`) and is not
  retired merely because manual editing exists; P11 decides dataset by dataset.
- `/admin/data-editor` (3,694 lines over 12 files; `actions.ts` 726 lines / 8 Server Actions;
  `MatchSheetEditor.tsx` 705 lines) is decomposed by P8, not discarded or rewritten.
- Brownlow administration and the admin lifecycle are not rebuilt.

---

## Next action

**P1 is complete.** `AFLDB-ISSUE-157` resolved 2026-09-11 on `fable/issue-157-admin-audit`
(deployed to DEV, unmerged): capability `operations.audit.read` (the §2 working name
`ops.audit.read`, renamed to the union's `operations.` prefix; Admin-and-up, resolving the
"own-scope TBD" as full scope because the dashboard already showed every admin the whole trail),
`/admin/audit` plus the per-entity history page, SELECT-only `src/db/queries/audit-reader.ts`,
`src/components/admin/AdminPager.tsx`. No migration, no privilege change, no write path;
`data_overrides` still deferred per §5. Evidence in `issues.md` under ISSUE-157.

**P2 is complete.** `AFLDB-ISSUE-158` resolved 2026-09-11 on
`fable/issue-158-capability-enforcement` (validated: 11 suites / 568 tests, tsc clean; unmerged,
not deployed): every `/admin` boundary now calls `requireCapability()`, the retained
role guards are exactly the dashboard, submission review, change-password and the lifecycle
(beside the capability), the `people.admins.manage` rule was tightened to match
`requireAdminManager()` before it became the guard, and `tests/auth.test.ts` holds the source
contract. Evidence and the validation commands are in `issues.md` under ISSUE-158.

**P3 is complete.** `AFLDB-ISSUE-159` (Coach administration) resolved 2026-09-11 and merged
to `main` at `af6379e` (migration 095, `/admin/coaches`, Stage 1 + Stage 2 gates all passed on
DEV). Coach reconciliation stays P9-class.

**P3b Stage 1 and Stage 2 are code-complete, committed and locally validated.** `AFLDB-ISSUE-160`
(Draft administration and new-player draft intake), branch `opus/issue-160-draft-admin`, both
stages completed and committed 2026-09-11 (Stage 1 `91935b9`, Stage 2 `a947e52`) — not
deployed, not merged, neither DEV nor PROD touched. A local completion audit the same day
found and fixed one real atomicity defect (a refusal returned after a write committed the
partial mutation) and eight new Stage 2 ESLint errors, and reported two runbook §18 list items
as undelivered; on the operator's direction both were then implemented (the list review-state
filter and the Player-links deep link, read-only, no migration, no new mutation path). Those
changes are uncommitted and await operator review. Nothing but the deliberately deferred
external gates -- PROD probes (d)/(e)/(g)/(h), S-1, gate 9's real-importer half, gate 15 DEV
deploy/build and gate 16 Playwright -- remains. No migration (096 still free), no privilege change. Draft selections have exactly one
mutation contract (`src/db/queries/admin-draft.ts`, the only `INSERT INTO draft_picks` in
`src/`); every admin-created player is minted with a `manual_admin_edit` identity and a
whole-row durable record; both players and selections are re-created on a rebuilt database by
fail-closed `replay_admin_overrides` branches; the D-2 symmetric name+DOB refusal ships in the
operator-run fitzRoy importer; `data_edits` rows about a selection are remapped through a stable
`draft_pick_key` instead of being reinstated by integer. Stop condition W-3 is cleared and
verified at gate 10.

Stage 2 (a fresh Sonnet 5 high session) added `/admin/draft`, `/admin/draft/new`,
`/admin/draft/[id]` and `/admin/draft/revalidate`; capabilities `data.draft.read` (Admin+) /
`data.draft.edit` (Super Admin) declared and enforced at every page/route/action boundary
(`tests/auth.test.ts` green); the Data-group nav entry; the D-9 shared
`src/lib/admin/revalidate-route.ts` / `src/components/admin/action-submit.ts` extraction, with
coaches switched to it behaviour-preservingly; and the `/admin/data-editor` draft-slice UI
removal. No Stage 1 backend defect was found; `npx tsc --noEmit` is clean and 399 tests pass
across the Stage 2-affected and Stage 1-adjacent suites.

Still open: the gate-2 **PROD** read-only probes (d)/(e)/(g)/(h) — not run, PROD deliberately
untouched — and the real-importer half of gate 9, which needs a host carrying `.venv`, the
accepted DraftGuru Stage A snapshot and `AFLDB_TEST_IMPORT_DATABASE_URL`. Operator decision S-1
(whether the paused ISSUE-151 PROD promotion completes under the current lineage contract or
resumes under the new `draft_pick_key` gate) stays a **pre-deploy** decision (runbook §11.1),
not a commit gate.

**P3d Stage 1 is built, uncommitted and NOT YET VALIDATED.** `AFLDB-ISSUE-162` (Fixture / season
schedule administration), branch `opus/issue-162-fixture-admin` stacked on P3c, backend only:
migration **097** (the `fixtures` registry — schedule facts only, no `match_id` and no `match_key`),
`src/db/queries/admin-fixtures.ts` as the single fixture mutation contract, the fail-closed
`replay_admin_overrides('fixtures')` branch and its call site, the promotion replay loop, and the
pure + integration suites. The operator's first validation run found four Stage 1 defects — a
missing `fixtures` audit label, a date check that accepted impossible calendar dates, a played
resolution that preferred one exact candidate over a competing swapped one, and a result comparison
against a row chosen independently of that resolution — all repaired 2026-09-11
(`AFLDB-ISSUE-162.md` §37.8), and the second run was green everywhere except the integration suite,
which was 31/5 on a test-ordering defect (the played-resolution tests wrote the result before the
fixture, so the `already_played` guard refused the create) — repaired in the tests alone and awaiting
the operator's rerun. Migration 097 is applied to `afldb_test` only. Preflight, the all-refs 097
collision check and the post-rerun re-gate are still outstanding.
Stage 2 — the `/admin/fixtures` surface, `data.fixtures.read`/`.edit`, the nav entry and the
destructive-confirmation void control — is not built.

Next: the operator reviews and commits Stage 1 and Stage 2 together, then DEV deploy + gate 16
Playwright (three roles × 320/768/1000/1280/1920) once the operator updates DEV for the Admin
Centre batch — deliberately deferred, not a defect. P3d is validated and completed before the batch
is considered closed; the combined DEV deployment rule covers P3b, P3c and P3d together, and no
part of it reaches DEV or PROD until the operator confirms the batch. P4–P12 remain unallocated
placeholders.
