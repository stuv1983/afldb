# AFLDB-ISSUE-155 — Admin / Super Admin overhaul

**Status:** Open / In progress
**Severity:** Medium
**Area:** Admin, authentication, data management, acquisition, provenance
**Found:** 2026-09-10
**Implementation:** Phase A (§23) complete and verified 2026-09-10 — see `issues.md` for the record. Phase B (§26) complete and validated 2026-09-10 — see §26.20 for the record. Phase C planning complete 2026-09-10 — §27 is the C1/C2 implementation contract. Phase C1 implemented 2026-09-10 (migration 094 applied and post-validated on `afldb_test`; every §27.25 item written; the §27.25 gate not yet run) — the record is the Phase C1 entries in `issues.md`. Phase C2 and Phases D–I not started.

## 1. Executive summary

AFLDB's administration features are individually useful but are spread across a flat `/admin` navigation and have accumulated different access, mutation, provenance and operational models. The present system has three authenticated roles (`contributor`, `admin`, `super_admin`). Contributors can upload intake files, Admins can review intake/access work, and many data-management and operational pages are Super Admin-only. Existing dedicated pages already cover uploads and submissions, player-link resolution, current-season acquisition, data editing, health, page content and settings. There are no dedicated Brownlow, coach or special-record management routes.

The recommended architecture is a coherent Admin Centre built from domain pages over the existing canonical tables and service boundaries. A central capability policy should drive navigation visibility and be called again by every page, query and Server Action. It must not become the security boundary by itself. Routine, reversible data work may be delegated to Admin; canonical publication, role changes, site-wide configuration, refresh execution and destructive actions remain Super Admin-only; rebuilds, migrations and unrestricted importer operation remain operator-only.

The upgrade should retain the staged submission/review model, current-season importer boundary, canonical identity/link tooling, existing structured page-content/settings system, durable overrides, `manual_admin_edit` provenance, required in-transaction `data_edits`, and database-role separation. It should replace the flat navigation and generic Brownlow match-sheet field with dedicated workflows. Browser CSV intake should move to a clearly labelled legacy/intake area and be retired dataset by dataset only after its replacement and recovery use have been proven. No underlying parser/import format should be deleted merely because the browser surface is hidden.

Implementation must be split into bounded phases. Brownlow, coaches, auth lifecycle, special records and refresh execution each cross a distinct authority boundary and should not be delivered as one migration or one review unit.

## 2. Evidence basis and required implementation preflight

This runbook is based on current repository inspection of the admin route tree, current auth/session guards, data-editor actions, Brownlow queries/acquisition writers, coach queries, manual-authority helpers, site-content/settings pages, current-season controls and the narrowly relevant issue history. Material current findings are:

- `src/app/admin/nav-model.ts` defines the present role-aware navigation, while page and action guards in `src/lib/auth/session.ts` enforce access.
- `requireUploader`, `requireAdmin`, `requireSuperAdmin` and `requireAdminManager` are distinct current boundaries. `can_manage_admins` delegates invite/password-management work but does not make a user a Super Admin.
- The current data editor, player links, current-season controls, site content/settings, health and QA surfaces are Super Admin-gated. Admin currently has beta-access, administrator/session and submission-review responsibilities.
- The current match-sheet action still accepts a per-match Brownlow field, but authoritative public season and career results come from protected Brownlow relations. Generic match and generic award actions must not rebuild or overwrite those authorities.
- `coaches` supports nullable `player_id`; coach-only identities already exist. `match_coaches` represents assignments at match and club grain, so mid-season changes are representable without a season-only tenure table. Public W-D-L and tenure summaries are derived from those match assignments.
- `data_overrides`, `manual_admin_edit`, `data_edits` and fail-closed manual-authority checks already exist and must be extended rather than bypassed.
- `auth_users.disabled_at` is already honoured by session loading, making deactivation the correct account lifecycle primitive.
- `/admin/content` and `/admin/settings` already provide Super Admin-only structured content/settings foundations and root-layout revalidation behaviour that must be reused.

Before each implementation phase, inspect the exact current migration constraints and importer transaction used by that phase. In particular, confirm current foreign keys to `auth_users`, the exact allowed entity check on `data_overrides`/`data_edits`, provenance columns on coach and special-record tables, the registered upload dataset list, and source-scoped deletion behaviour in the relevant importer. These are bounded implementation preflights, not reasons to reopen the overall architecture.

## 3. Current-state Admin map

| Route | Current purpose | Current access | Primary backing boundary | Current authority |
|---|---|---|---|---|
| `/admin` | Overview/dashboard | Admin+ | Admin dashboard queries | Read-only summary |
| `/admin/upload` | Upload a registered intake/CSV dataset | Contributor+ | upload/submission actions and ingest registry | Staging only; not canonical until promotion |
| `/admin/submissions/[id]` | Inspect, validate, decide and promote a submission | Uploader view; Admin validation; Super Admin decision/promotion | submission actions and importer promotion | Promotion is canonical/import authority |
| `/admin/access` | Beta/early-access administration | Admin+ | access/settings queries and actions | Auth/access configuration |
| `/admin/admins` | Accounts, active sessions, invites and temporary passwords | Admin+; manager actions require Super Admin or `can_manage_admins` | auth queries/actions | Auth database |
| `/admin/data-editor` | Players, matches, match sheets, awards, Hall of Fame and honour teams | Super Admin | data-editor queries/actions | Canonical football tables plus manual provenance/overrides where implemented |
| `/admin/player-links` | Resolve imported identities to canonical players | Super Admin | player-link queries/actions | Durable identity resolutions |
| `/admin/current-season` | Current-season acquisition/settlement and status | Super Admin | current-season actions/acquisition helpers | Allowlisted current-season importer boundary |
| `/admin/content` | Page-content editing, media, preview and publish | Super Admin | site-content queries/actions | Existing structured content store |
| `/admin/settings` | Site settings including frontend theme and homepage configuration | Super Admin | site-settings helpers/actions | Existing settings store and layout cache contract |
| `/admin/query-builder` | Restricted data QA query UI | Super Admin | allowlisted query builder | Read-only QA |
| `/admin/nl-search` and child routes | NL telemetry, feedback and exports | Super Admin | NL admin queries/actions | Operational telemetry |
| `/admin/db-health` | Database health/reporting | Super Admin | health queries | Read-only operations |
| `/admin/app-health` | Application health/reporting | Super Admin | application health helpers | Read-only operations |
| `/admin/grid-solver` | Redirect to the public Grid Solver | Auth route but public destination | redirect | No admin authority |
| login/logout/password/invite routes | Authentication lifecycle | Context-specific | auth helpers/actions | Auth database |

The current administrator list exposes roles, management delegation, password state and live sessions, but no complete role/deactivation workflow. Session validity already rejects disabled users. Current auth actions use fresh server-side user lookups; new actions must continue that pattern.

## 4. Browser CSV/import review

The browser-facing import surface is the staged upload/submission workflow, not every internal importer. Internal CSV files used by repeatable acquisition jobs and operator rebuilds are separate contracts.

| Interface | Domain/responsibility | Current dependency | Recommendation | Phase |
|---|---|---|---|---|
| `/admin/upload` | Registry-selected intake files, staged with uploader attribution | Supported for contributor/operator-provided datasets; feeds submission review rather than writing canonical data directly | **Retain temporarily; move/hide.** Rename/navigation-label it `Legacy intake` or `File intake`, remove it from primary Data navigation, and show the selected dataset's owner/replacement. Do not accept arbitrary table names or parser paths. | A, then H |
| `/admin/submissions/[id]` validation and promotion | Review boundary for uploaded data | Provides validation evidence and separates upload from canonical promotion | **Retain while any registered dataset uses browser intake.** Keep Admin validation and Super Admin promotion. After a dataset is retired, preserve historical submissions read-only for audit. | A/H |
| Internal CSV formats consumed by supported importers | Repeatable acquisition, rebuild or curated-source inputs | May be required by CLI jobs even if no browser upload is needed | **Retain unless the owning importer is retired separately.** Browser removal must not delete parser support or source artifacts. | Outside H unless directly coupled |
| `/admin/current-season` | Supported API/current-season refresh and settlement; not a generic CSV surface | Current supported bounded acquisition workflow | **Retain and harden** under `Acquisition > Current season`; use the refresh-job rules in section 12. | G |

Phase H must first enumerate the current ingest registry and produce a dataset-by-dataset decision table in the implementation PR. For each registered dataset record its canonical tables, source owner, supported API/manual replacement, disaster-recovery/rebuild dependency and last known operator use. Apply these rules:

- **Retain** a browser dataset only where external files remain the supported source and staged human review adds value.
- **Replace** it when a dedicated canonical form or supported API covers the complete semantic grain, provenance and correction workflow.
- **Hide/deprecate** it when a replacement exists but operational/recovery evidence is incomplete. Existing URLs may remain accessible to authorised users with a deprecation notice for one release.
- **Remove the browser option** only after tests prove no supported web workflow links to it and operator documentation identifies the remaining importer entry point.
- **Do not remove the parser/importer** in ISSUE-155 unless it has no rebuild, acquisition, recovery or curated-source owner. Parser deletion is a separate explicit cleanup decision.

The intended end state is that ordinary Admins use domain forms for players, matches, Brownlow, coaches and records. File intake remains a narrow staging tool for genuinely file-owned domains, not a general database mutation interface.

## 5. Source-of-truth matrix

| Feature | Canonical table/grain | Source authority and derived data | Manual provenance | Import ownership and admin rules |
|---|---|---|---|---|
| Brownlow round votes | `brownlow_round_votes`, one player vote fact per season/round, extended with exact `match_id` for new/admin facts | Independently sourced round facts; public season totals use `brownlow_season_votes`; career totals derive through existing Brownlow/career rebuild path. Per-match Brownlow fields are legacy/non-authoritative. | `manual_admin_edit` source plus actor, reason and required `data_edits` | Dedicated Brownlow transaction only. Generic match/award actions never reconcile Brownlow. Imported rows and manual rows collide fail-closed unless the correction explicitly claims the existing fact. |
| Brownlow season totals | `brownlow_season_votes`, one player/season | Authoritative published season total, rank/winner/eligibility and polling counts; `player_career_stats` and status fields are derived | Reconciliation event links to finalised round set and actor | Recompute only within the Brownlow authority workflow and only with complete coverage or correction of a season already declared complete. Never sum a partial round set into public authority. |
| Coaches | `coaches` identity, optional `player_id`; `match_coaches`, exact match/club assignment | Coach identity and assignment are canonical; public tenure and W-D-L derive from assignments and match results | `manual_admin_edit` for coach-only identities/assignments or durable override for source-owned facts | Importers must preserve manual rows and reapply active overrides. Admin selects stable player/coach/match/club IDs; never name-only identity. |
| First career kick goal | Existing `player_achievements` first-kick-goal family at its current record grain | Existing curated importer/source remains owner of imported facts; public record query reads canonical achievements | Manual source rows for additions; durable patch/suppression override for corrections/removals | Scoped reload cannot delete manual rows or resurrect suppressed source rows. Link by player ID and match ID when the source semantics provide a match. |
| Goal after the siren | `after_siren_kicks`, one canonical event | Existing curated/Wikipedia-backed import remains owner of imported events; public pages/player events read canonical rows | Manual source rows and durable overrides/tombstones | Match and player are stable FKs. Reload replays overrides and fails closed on ambiguous source identity. |
| Existing awards/Hall of Fame/honour teams | Existing canonical relations | Existing admin actions/import ownership | Existing `manual_admin_edit` pattern | Retain and regroup under Records/Honours; do not broaden their model in this issue. Brownlow remains excluded from generic awards. |
| Site content | Existing site-content/settings store, one known key/revision or current equivalent | Published structured content is authoritative for approved copy; settings remain authoritative for theme/layout flags | Authenticated Super Admin revision/audit metadata | Only allow registered keys and field schemas. Source-controlled text remains code-owned. |
| Auth users | `auth_users`; sessions/invites and auth audit tables | Auth database is authoritative; disabled accounts cannot create/use valid sessions | `auth_audit_log` with actor and before/after role/status | Super Admin-only role/status transaction. Historical users are retained; no hard delete. |

`NULL` continues to mean unknown/not covered where that is the present statistical contract. The Brownlow workflow must never manufacture zero-vote rows or complete status for historical seasons whose source coverage is unknown. Explicit zero is permitted only inside a declared complete match/season coverage set.

## 6. Permissions matrix

The matrix describes the target policy. `Contributor` is retained only while file intake needs it.

| Capability | Admin | Super Admin | Operator/CLI | Risk and reason |
|---|---|---|---|---|
| Admin overview/status counts | Read | Read | — | Low; role-filter sensitive details |
| Player create/edit | Create/edit ordinary fields | Same; approve exceptional conflicts | Bulk rebuild/repair | Medium; stable IDs and override ownership required |
| Player delete/merge | No | No general delete; dedicated guarded merge only if already supported | Destructive repair | High identity blast radius |
| Match create/edit and match sheets | Routine create/edit | Same; destructive delete/correction controls | Bulk repair/rebuild | Medium/high; required audit atomicity and derived recalculation |
| Brownlow | Read and, subject to owner decision, save draft | Finalise, revise and reconcile authority | Historic bulk load/rebuild | High independent authority; generic editor excluded |
| Coaches | Create identity, assign tenure, correct with reason | Same; resolve source collisions/suppress imported fact | Bulk import/rebuild | Medium; exact match/club identity and importer survival |
| Special records | Add/correct manual fact | Suppress/restore source-owned fact and resolve collisions | Bulk curated import | Medium/high provenance risk |
| Awards/Hall of Fame/honour teams | Existing ordinary workflow when granular guard is introduced | Same; high-impact corrections | Bulk load | Medium; Brownlow explicitly excluded |
| Player links | Review and resolve one identity with evidence | Same plus bulk/high-impact conflict operations | Import/rebuild candidate generation | High same-name risk; durable IDs and server checks |
| Submission upload | If intake retained | Yes | Yes | Medium; staging only |
| Submission validation | Yes | Yes | — | Medium; no canonical write |
| Submission promotion | No | Yes | Yes | High canonical/import write |
| Site content | Read preview if useful | Edit/publish | Seed/backfill | High public-wide effect |
| Site settings/theme | Read current | Edit | Environment/operator-only settings remain CLI/config | High global/cache effect |
| Admin account list | Read limited account/status data | Full list | Owner recovery | Medium personal/security data |
| Invite/temp password/session | Own session revoke; existing delegated managers may invite/reset lower roles during compatibility | All guarded actions | Emergency recovery | High account takeover risk |
| Promote/demote/deactivate/reactivate | No | Yes with invariant checks | Emergency recovery | Critical auth boundary |
| Current-season refresh/apply/settle | Read status | Start allowlisted jobs | Yes | High write volume; active-season restriction |
| Wikipedia/curated refresh | Read last provenance | No in initial release | Yes | Importers are not yet proven web-safe |
| DB/app health | Summary | Detailed read-only | Detailed diagnostics | Sensitive operational information |
| Query builder/NL telemetry | No by default | Restricted read/export/clear as currently guarded | Direct diagnostics | Sensitive data/operational risk |
| Migrations, rebuilds, arbitrary SQL/shell/Git/deploy/secrets | No | No | Yes | Critical; unavailable in web UI |

All actions must call the capability guard at their server/query/action boundary. UI visibility and disabled buttons are explanatory only.

## 7. Proposed Admin Centre information architecture

Use the existing `/admin` layout and component language, but replace the flat feature list with role-filtered sections:

- **Overview** — `/admin`; pending submissions, unresolved links, Brownlow completion, running/failed refreshes and health warnings. Each card links to the owning page.
- **Data**
  - Players — `/admin/players` (initially a clearer entry to/refactor of existing data-editor player forms).
  - Matches — `/admin/matches`, including match sheet; destructive operations visually separated.
  - Brownlow — `/admin/brownlow` and `/admin/brownlow/[season]/[round]`.
  - Coaches — `/admin/coaches`, `/admin/coaches/[id]` and assignment flow.
  - Records & honours — `/admin/records`, with first-kick goal, after-siren and links to retained awards/Hall of Fame/honour-team forms.
  - Identity resolution — existing `/admin/player-links`.
  - Submissions — add a list route if one is not already present; keep `/admin/submissions/[id]`.
- **Acquisition** (Super Admin)
  - Current season / refresh jobs — existing `/admin/current-season`, later `/admin/refreshes/[jobId]`.
  - Legacy file intake — existing `/admin/upload`, visible only to roles still authorised and labelled by lifecycle state.
- **Site** (Super Admin)
  - Page content — existing `/admin/content`.
  - Settings — existing `/admin/settings`.
- **People & access**
  - Admin users — existing `/admin/admins`, upgraded lifecycle controls.
  - Beta access — existing `/admin/access`.
- **Operations** (Super Admin)
  - DB health, app health, restricted query builder and NL telemetry.
- **Account** — password and own sessions.

Remove the public Grid Solver from primary Admin navigation; keep `/admin/grid-solver` as a compatibility redirect. The public tool is not an administrative capability.

Badges should be query-owned, cheap and role-filtered: pending submission count, unresolved-link count, incomplete Brownlow match count for the selected/current season, active/failed job count and health severity. Warning states must link to evidence. Use ordinary confirmation for publication/corrections and typed confirmation only for account deactivation, source-fact suppression or an already-supported destructive match operation. Routine saves should use inline validation and clear success/failure messages. Stale revisions should preserve entered form data and offer reload/compare rather than silently overwrite.

The navigation must collapse to a labelled menu on narrow screens; tables need stacked/card alternatives or controlled horizontal overflow, 44px action targets, persistent field labels and no hover-only provenance.

## 8. Brownlow workflow

### Routes and read model

`/admin/brownlow` shows seasons, source coverage, count of expected home-and-away matches, draft/finalised match counts, season-authority status and last editor. `/admin/brownlow/[season]/[round]` renders every home-and-away match in fixture order. Each match card lists only players in the canonical match line-up (`player_match_stats`/the existing match participant query), grouped by club, with searchable 3, 2 and 1 vote selectors.

The page must explicitly show missing line-ups or uncertain coverage. A match without a complete known participant set cannot be finalised. Finals are excluded. A historical source row that cannot be linked to an exact match is displayed as legacy/unresolved and cannot be silently adopted.

### Validation and draft state

Client validation improves speed, but the transaction must repeat every rule:

1. season/round/match exist and the match is home-and-away;
2. each selected player is a canonical participant in that exact match;
3. exactly one distinct player receives 3, 2 and 1 on finalisation;
4. no player receives two vote values in a match;
5. no other positive vote row exists for the match outside the submitted set;
6. current revision matches the submitted revision;
7. source ownership/collision verdict is determinate;
8. required audit/provenance fields are present.

Drafts may omit selectors and may be saved with warnings. Draft values live only in a workflow table and never feed public Brownlow queries. A round is complete only when every expected H&A match is finalised; a season is complete only when every expected H&A match is finalised and eligibility/winner review has been completed. Missing historical coverage remains unknown, never zero.

### Storage and authority

Add an exact `match_id` association to `brownlow_round_votes` for newly managed facts. Backfill only rows that resolve uniquely through season/round/player participation; leave ambiguous history null and report it. Add a `brownlow_vote_entry_state` table keyed by `match_id` with the three selected player IDs, `status` (`draft`/`finalised`), monotonic `revision`, updater/finaliser and timestamps. It is workflow state, not a public statistical authority.

Add a small season authority/coverage record if the current schema has no equivalent. It records `unknown`, `incomplete` or `complete`, revision, finaliser and timestamp. Do not infer complete from the presence of some round rows.

Finalising a match runs one import/statistical transaction that locks the match/state and affected vote rows, validates the submission, upserts the canonical round facts with `manual_admin_edit` provenance, removes/replaces only facts explicitly owned by that correction, updates workflow state and writes required `data_edits`. Required statistical audit must commit or roll back with the vote facts. Supplemental auth audit may be written only if failure cannot leave the statistical change unattributed.

When the last required match is finalised, show a season reconciliation preview. It sums only the declared-complete round set, calculates 3/2/1 and polling-game counts, and requires review of eligibility/winner metadata. The explicit `Finalise season authority` transaction writes `brownlow_season_votes`, recomputes existing player-season Brownlow status and career totals through their existing canonical helper, and records the coverage revision. No generic match mutation or awards mutation may call this path.

For a correction to an already complete season, require a reason, show before/after match and season totals, lock the season revision, and update round fact, season authority and affected derived totals atomically. Preserve existing ineligibility/winner metadata unless the correction explicitly changes it. Revalidation covers the Brownlow admin routes and affected public season, player, club comparison/records and search pages.

### Transition from match sheet

After the dedicated workflow is live, remove the editable Brownlow field from the generic match-sheet form. If the legacy per-match column must remain for compatibility, display it read-only with a link to Brownlow administration and do not use it to derive season/career totals. Before removal, identify and migrate any still-supported consumer; conflicting legacy values are evidence to resolve, not a value to copy automatically.

## 9. Coach workflow

`/admin/coaches` provides coach search, current assignments, unlinked/coach-only status and add buttons. Identity creation begins with canonical player search. Selecting a player reuses or creates one `coaches` identity linked by `player_id`; same-name matches require ID-based selection. If the person never played VFL/AFL, `Create coach-only identity` creates a `coaches` row with a stable manual source record ID. It must not create an empty/fake `players` row.

An assignment form selects the exact historical club identity, a season, and inclusive first/last matches from that club's fixture. The preview expands the range to concrete `match_coaches` rows and shows existing assignments/conflicts. This uses the model's match grain and supports mid-season changes without a parallel season-tenure table. Open-ended `current` tenure is UI shorthand for the last known/incoming fixture set; persisted assignments remain exact matches.

Saving acquires locks for affected match/club rows, refuses two coaches for the same match/club unless the correction explicitly replaces the displayed assignment, writes canonical assignments plus provenance/override state and required audit in one transaction, then revalidates coach, club and affected match pages. Correction UI shows imported/manual source, actor, reason and before/after affected matches. Source-owned rows use durable overrides; manual additions use `manual_admin_edit`. Deletion is represented as a durable suppression/ended range, not an importer-vulnerable physical delete.

Public W-D-L and tenure continue to derive from `match_coaches` and match results. No stored W-D-L counters should be introduced. Historical club organisation rollups continue to use the current query rules while assignments retain the exact club ID from the match.

Implementation preflight: inspect the coach importer transaction and provenance columns. If it source-scoped deletes only its own rows and preserves manual rows, reuse that contract. Otherwise add the minimum provenance/stable-key columns and override replay before enabling the UI. Stop if a coach or assignment lacks a stable non-name source key that can survive reload; define that key before migration.

## 10. Admin user management

Upgrade `/admin/admins` to show the authenticated user, email, role, active/disabled status, created date, password state and last-login/session information already safely derivable. Ordinary Admins receive a limited read view and own-session controls. Super Admins receive promote, demote, deactivate, reactivate, session revoke, invite and temporary-password controls.

Use deactivation, not hard deletion. `disabled_at` is already enforced by session loading, and durable audit, link-resolution, override and data-edit attribution must retain historical user identity. Deactivation sets `disabled_at`, revokes all target sessions and preserves the row. Reactivation clears it but does not revive old sessions; requiring a temporary-password/reset flow is safer.

Each role/status action must:

- call `requireSuperAdmin` and reload actor/target inside the auth transaction;
- lock the target and all active Super Admin rows needed for the invariant;
- reject self-demotion and self-deactivation;
- reject disabling/demoting the last active viable Super Admin;
- reject stale target version/role/status;
- preserve `can_manage_admins` consistency (demotion clears privileges a lower role cannot hold);
- revoke sessions when privilege is reduced or an account is disabled;
- write the auth audit event with before/after state in the same transaction through the existing transactional audit helper;
- revalidate the administrators page and force affected session checks to observe the change.

“Viable Super Admin” means an enabled `super_admin` account with usable credentials under current auth rules. The invariant must be checked under a lock or transaction-level mechanism so two concurrent demotions cannot both pass. Do not rely on a pre-count in application memory. Emergency repair remains owner/operator work.

During implementation, enumerate every FK to `auth_users`. If any uses restrictive deletion or nulling semantics, document it in the migration review; it reinforces deactivation and must not be weakened. Existing invite/temp-password delegation through `can_manage_admins` may remain for compatibility, but only actual Super Admins can alter roles or status.

## 11. Site content management

Extend the existing `/admin/content` publish/preview model and `/admin/settings` helpers. Do not create another settings table or a generic CMS. Define a source-controlled registry of allowed content keys, their field type, maximum length, whether blank is allowed and the public route/tag they invalidate. Initial candidates are homepage introduction, selected feature descriptions/help text and an optional global notice/banner with separate enabled/severity/text/link fields.

Default to plain text with preserved line breaks. If the owner selects restricted Markdown, allow only a small source-controlled element set and sanitize on the server and render path; never accept arbitrary HTML, scripts, inline styles, embeds or arbitrary attributes. Links, if enabled for a key, must use a validated `https` or internal path and safe rendering.

Keep application behaviour, statistical definitions, coverage/NULL semantics, legal/security language, parser/error text, destructive warnings and developer/operator instructions source-controlled. A key cannot change its semantic type through the UI.

Publishing requires Super Admin, server validation, a monotonic revision/stale check, actor/timestamp and audit metadata. Reuse current draft/preview/publish facilities where present. If the current content table lacks durable revisions, add the smallest revision/history table rather than a general page/block schema. Revalidate the exact public routes and the root layout/settings tag in the same successful action. A failed revalidation should be surfaced and retryable without duplicating the revision.

## 12. Special-record management

Place record-family cards under `/admin/records`. Each form searches canonical players and, where the record semantics identify a game, canonical matches. Same-name selections show club/season/career context and persist IDs only.

### Goal with first career kick

Use the existing first-kick-goal achievement family in `player_achievements`; do not add a parallel records table. Manual addition creates a stable manual record with `manual_admin_edit` provenance and the current achievement semantics. Correction of an imported fact stores a durable field override keyed by the importer's stable source record ID. Suppression stores a tombstone/active suppression override so the next curated reload cannot recreate the visible fact. Restore deactivates the suppression with a new audit event. Validate that the player is canonical and that an optional match link is compatible with the player where match evidence is supplied.

### Goal after the siren

Use `after_siren_kicks` and its existing event fields/query semantics. Require canonical player and match IDs for new records when the table's semantic grain requires them; validate participant/team/season consistency without guessing from names. Imported corrections and suppressions use the same durable override/tombstone mechanism; manual events use `manual_admin_edit` and a stable manual source record ID.

For both families, source reload must delete/update only rows it owns, preserve manual rows, reapply active overrides and fail closed when a source key collides or cannot be resolved uniquely. Required `data_edits` and the canonical mutation commit atomically. Public record, player, match and search caches are revalidated after commit. A “delete” button is presented as `Suppress record` with source and consequences; physical deletion is reserved for operator repair.

Existing awards, Hall of Fame and honour-team forms naturally belong in the Records & honours navigation group and should retain their existing manual provenance. No other record family is added merely because it is manually curated.

## 13. External refresh design

Only fixed operations backed by supported library entry points may be web-triggered.

| Candidate | Web trigger | Exact operation and role | Execution/status model | Restriction |
|---|---|---|---|---|
| Current-season acquire/stage | Yes | `current_season.acquire` by Super Admin | Existing bounded mechanism if it proves single-flight and durable; otherwise persisted refresh job | Season comes from trusted active-season settings; no user season/source/path argument |
| Current-season apply/settle | Yes | `current_season.settle` by Super Admin after preview | Same job model; records report counts and bounded error summary | Current season only; no destructive rebuild flag |
| Current-season status refresh | Yes/read-only | status query by Super Admin; summary to Admin | Synchronous query | No mutation |
| First-kick/after-siren Wikipedia or curated reload | No initially | Operator CLI only | Existing importer | Keep operator-only until refactored into a bounded, idempotent library and manual-override survival tests pass |
| Historical/full rebuilds, derived rebuilds, migrations/backfills | No | Operator only | Existing operational tooling | Never exposed in web UI |

If the current-season work exceeds a normal request budget or its existing status mechanism is not durable, add a minimal `admin_refresh_jobs` table and trusted worker/dispatcher. The enqueue Server Action inserts one of a compile-time allowlist of operation IDs; it accepts no executable, path, raw argument, environment or shell text. A partial unique index prevents a second queued/running job for the same operation/environment. The worker claims a row atomically, maps the operation ID directly to an imported TypeScript function, and uses the existing import/statistical role. It must never build a shell command.

Job state is `queued`, `running`, `succeeded`, `failed` or `timed_out`, with requester, environment label supplied by server configuration, timestamps, bounded structured counts, bounded/sanitized error summary and audit correlation ID. Secrets, stack traces, DSNs and raw source payloads are not stored or rendered. Set per-operation timeouts. Do not implement cancellation in the first release unless the importer already supports a safe cooperative cancellation point; display `No cancellation; wait for timeout/operator intervention`. Retrying creates a new audited job only after the prior job is terminal.

Production execution requires a distinct trusted worker/service boundary or a proven existing equivalent. The web/auth role may enqueue and read job metadata but must not receive import-table privileges. The worker receives only the credentials required by the allowlisted import action. If that separation cannot be deployed, retain the present fixed synchronous current-season action and leave all additional refreshes operator-only.

## 14. Schema changes

Migrations are proposed by capability and should not be combined merely to reduce file count.

1. **Admin capability/auth lifecycle:** likely no migration because roles, `can_manage_admins` and `disabled_at` exist. Add a target revision/status version only if no safe current concurrency token exists. Do not alter historical audit FKs. Auth-role privileges only.
2. **Brownlow workflow:** nullable/backfillable `match_id` on `brownlow_round_votes`; indexes for exact match/player and positive vote uniqueness; `brownlow_vote_entry_state`; a season coverage/authority row if no equivalent exists; revision/check constraints and actor FKs. Backfill only unambiguous rows. Historic ambiguous rows remain null and reported. Football read role receives only required SELECT; mutation stays with import/statistical role.
3. **Coach/manual authority:** if missing, stable manual source key and provenance quartet on `coaches`/`match_coaches`; extend existing `data_overrides` and `data_edits` entity constraints for coach identities/assignments. Add uniqueness for one coach per match/club if not present. Code that understands the expanded check must be deployable before a constraint expansion that would otherwise make manual-authority introspection fail closed.
4. **Special-record durable operations:** extend `data_overrides` with an explicit patch/suppress operation or the smallest equivalent supported by its current schema; admit only the two named entity families with stable keys. Add no duplicate canonical record system. Backfill none; current imported facts remain source-owned.
5. **Site content:** no migration if the existing content revisions and metadata satisfy the contract. Otherwise add monotonic revision/history metadata only.
6. **Refresh jobs:** add `admin_refresh_jobs` only if the current mechanism cannot provide durable single-flight/status. Include operation allowlist check, state check, timestamps, requester FK, bounded result/error fields and partial unique active-job index. Enqueue privileges belong to auth/job boundary; canonical mutation privileges belong only to worker/import role.

All migrations are forward-only in production. Rollback means disabling new routes/actions while preserving new audit/provenance rows. Never down-migrate by deleting manual decisions. Migration ordering is code compatibility/guards first where an expanded constraint would trip fail-closed introspection, then schema, privileges, worker if needed, then UI exposure.

## 15. Backend changes

Confirmed existing files to extend include:

- `src/lib/auth/session.ts` and current auth audit/action helpers for capability guards and transactional role/status operations;
- `src/app/admin/nav-model.ts`, `src/app/admin/layout.tsx` and existing admin actions;
- `src/app/admin/data-editor/actions.ts` for routing existing operations through granular guards and removing Brownlow mutation ownership;
- existing Brownlow queries/acquisition writer and derived-status helpers;
- existing coach queries and importer/manual-authority helpers;
- `src/lib/manual-authority.ts` and data-edit/override helpers;
- site-content/site-settings queries and actions;
- current-season actions and acquisition helpers;
- upload/submission registry/actions for lifecycle labels and retirement.

Likely new backend modules should be domain-specific: `src/db/queries/admin-brownlow.ts`, `admin-coaches.ts`, `admin-records.ts`, `admin-users.ts`, an `src/lib/auth/capabilities.ts` policy, Brownlow validation/reconciliation helpers, and refresh-job query/dispatcher modules if required. Queries must be parameterised. Shared validation helpers should be parser-independent and testable without a database.

Do not place import-role mutations in UI components, do not use the application read pool for writes, and do not duplicate canonical recalculation SQL inside actions.

## 16. Frontend changes

Extend the existing Admin layout and section components. Add the route hierarchy in section 7, dedicated Brownlow round cards, coach identity/assignment forms, record-family forms, admin user lifecycle controls and refresh job status. Reuse current player/match search controls where they preserve stable IDs. Add provenance panels showing source, last manual decision, actor/time and correction reason.

Forms need server-returned field errors, pending state, post-success data refresh and stale-revision recovery. Destructive/high-impact actions use explicit language and a reason. Responsive acceptance covers 320px, tablet and desktop widths; long player/club labels wrap, tables retain accessible headers, selector results are keyboard usable and match vote controls do not depend on colour.

## 17. Audit, provenance and security

- Navigation uses capability metadata; every page, read query returning sensitive data, route handler and Server Action independently enforces the same server-side capability.
- Re-read actor and target state after the transaction begins. Never trust submitted role, source, season, match participants, totals or job operation.
- Required statistical `data_edits` commit in the same import transaction as canonical changes. Do not reintroduce post-commit required-audit writes.
- Auth role/status actions use the existing transactional auth audit helper. Audit retains actor labels even if future FK handling changes.
- `manual_admin_edit` identifies manual canonical rows. `data_overrides` identifies durable changes/suppressions to source-owned rows. Each has stable non-name keys, actor, reason and time.
- Importers delete/update only their source scope, replay active overrides, preserve manual rows and fail closed on ambiguous identity or ownership collisions.
- Application read, auth, import/statistical and owner/operator roles remain separate. A new screen is not justification to grant the application read role writes.
- Refresh operation IDs and arguments are compile-time/server-controlled. No shell interpolation, paths, environment editing, secrets or raw logs.
- Role reduction/deactivation revokes sessions. CSRF/origin/session protections used by current Server Actions remain in force.
- Stale edits use revision compare-and-swap. High-impact transactions lock the authority row(s); concurrent invariant checks happen in the database transaction.
- Physical deletion of users and source-owned special facts is unavailable. Match/player destructive repair and all rebuild operations remain operator-only unless an existing separately guarded contract already applies.

## 18. Cache and revalidation

| Mutation | Public impact | Admin impact | Required strategy |
|---|---|---|---|
| Player edit | Player, club/records/search where field participates | Players/overview | Existing targeted player/data tags plus affected routes |
| Match/match sheet | Match, player/club season/career/records/search | Matches/overview | Existing match mutation revalidation; do not add Brownlow reconciliation |
| Brownlow draft | None | Brownlow season/round/overview | Admin routes only |
| Brownlow finalise/correct | Brownlow season, player, club comparison/records, search and derived totals | Brownlow/overview | Invalidate after atomic commit using existing Brownlow/player/season tags or exact paths |
| Coach assignment/identity | Coach, linked player, club coach records, affected matches/search | Coaches/overview | Exact coach/player/club/match routes and query tags |
| Special record | Record family, player, match and search | Records/overview | Exact family/player/match tags |
| User role/status | None | Admin users/nav/session | Revalidate admins/layout; revoked user is rejected by next server check |
| Site content/settings | Registered public routes and possibly global layout | Content/settings/overview | Reuse current root-layout/settings revalidation and key-specific route map |
| Refresh enqueue/status | None until importer commit; importer owns data invalidation | Current season/job/overview | Poll job state; on success call the importer's established invalidation set |

Cache invalidation occurs only after a successful commit. Settings/content changes must preserve the current root-layout strategy so one worker/request cannot keep inconsistent cached settings.

## 19. Testing strategy

Extend the closest existing suites before creating new test homes.

### Unit/source-contract

- capability matrix, nav visibility and direct guard rejection;
- Brownlow distinct 3/2/1, participation, H&A, completeness, NULL/zero and stale-revision validation;
- coach range expansion and stable identity selection;
- site content key/type/length/link/safe-render rules;
- special-record stable keys, patch/suppress semantics and fail-closed source collision;
- refresh operation allowlist, no arguments/shell path, log sanitisation and state transitions;
- upload dataset lifecycle labels do not alter internal parser registration.

### Database integration

- Brownlow finalisation writes exact round authority and required audit atomically; partial seasons do not rewrite `brownlow_season_votes`; complete-season/correction reconciliation updates authoritative season/career status exactly once;
- match/award mutations still cannot overwrite Brownlow authority;
- coach-only and player-linked identity uniqueness, match-grain mid-season assignments, conflict handling and derived W-D-L;
- imported coach/record reload preserves manual rows and reapplies patch/suppression overrides;
- auth concurrent role transitions preserve one viable Super Admin, deactivation revokes sessions and audit/FKs retain attribution;
- database-role tests prove read/auth/web-job roles cannot perform import/statistical writes;
- refresh active-job unique constraint prevents double submit.

### Auth/authorisation

- Contributor/Admin/Super Admin direct URL and direct action cases for every capability;
- ordinary Admin cannot promote/demote/deactivate or start refresh;
- Super Admin success; self-demotion/deactivation and last-viable-Super-Admin rejection;
- disabled users and revoked sessions cannot continue through a cached page/action;
- `can_manage_admins` does not grant role/status mutation.

### Concurrency

- two Brownlow finalisations/corrections with the same revision;
- two simultaneous demotions/deactivations of the final two Super Admins;
- two identical refresh enqueues;
- overlapping coach tenure corrections;
- stale site-content publication.

### Browser/E2E

- role-specific navigation and direct-route enforcement;
- Brownlow season/round selection, incomplete draft, invalid duplicate, finalise and safe correction;
- existing-player and coach-only creation plus mid-season change;
- admin promotion/demotion/deactivation/reactivation protections;
- content preview/publish and public refresh;
- refresh double-click/status/failure rendering;
- legacy intake labels and retained submission flow;
- 320px/tablet/desktop navigation and forms.

## 20. Deployment sequencing

1. Land capability policy and route/action guard tests without changing current permissions; deploy safely.
2. For each domain, deploy code that tolerates the old and new schema, then apply migrations and reconcile grants, then enable the route/action. Where fail-closed override introspection expects an exact constraint, deploy the compatible reader before expanding the constraint.
3. Backfill Brownlow `match_id` only for unique evidence and publish an ambiguity report. Do not enable season finalisation until coverage/preflight validation passes.
4. Deploy auth lifecycle actions only after FK review and concurrency integration tests; no schema change should delete users.
5. Deploy coach/special-record importer preservation before enabling manual forms.
6. If refresh jobs are required, migrate job state, deploy/start the trusted worker, prove credential separation and single-flight in non-production, then expose enqueue controls. If no worker is available, retain the bounded current action.
7. Extend content keys after root-layout revalidation tests pass.
8. Move/deprecate CSV options only after domain replacements are live and dataset ownership/recovery evidence is recorded.
9. Finish with cross-role browser acceptance and operational rollback checks. Old code must safely ignore additive tables/columns during rolling deployment; new code must tolerate absent optional workflow data until migration completion.

## 21. Explicit non-goals

- General-purpose CMS, arbitrary HTML editor or arbitrary page builder.
- Arbitrary SQL, shell, command arguments, executable paths, Git, deployment, migrations, secrets or environment-variable UI.
- Full/historical rebuild UI or production repair console.
- Redesign of public pages beyond rendering approved structured content and reflecting canonical data.
- Replacement of canonical player/person identity or creation of player shells for non-player coaches.
- A second Brownlow authority or derivation from generic match-sheet fields.
- Season-grain coach model that discards exact match assignments.
- Deletion of internal importer formats solely because a browser upload option is retired.
- Broad conversion of all curated record families.
- AFLDB-ISSUE-153 or AFLDB-ISSUE-154 work.
- Dependency upgrades or unrelated cleanup.

## 22. Risks and stop conditions

- **Brownlow authority conflict:** stop if a proposed write cannot identify whether round or season source owns the fact, or if complete coverage cannot be proved. Never publish a partial sum as authoritative.
- **Legacy Brownlow ambiguity:** do not backfill `match_id` from player/round alone when multiple/no matches resolve. Keep it unresolved.
- **Coach identity:** stop if a coach cannot receive a stable coach ID independent of a name; do not create a fake player.
- **Importer survival:** do not enable coach/record forms until reload tests prove manual rows/overrides survive and source collisions fail closed.
- **Override constraint drift:** stop rollout if schema and `manual-authority` allowed-entity introspection disagree.
- **Auth FK/invariant:** do not implement hard delete; stop role rollout if audit attribution or the last-Super-Admin invariant cannot be enforced transactionally.
- **Privilege expansion:** stop if implementation requires granting canonical writes to the application read role or import credentials to a web request.
- **Unsafe importer exposure:** leave an operation CLI-only unless it is fixed, bounded, idempotent/retry-understood, current-environment scoped and free of user-provided commands/paths.
- **Worker availability:** do not enqueue jobs without a proven claimant/timeout/monitoring path.
- **Migration collision:** rebase/re-number migrations in the implementation worktree before applying; do not reuse ISSUE-154 or touch ISSUE-153 artifacts.
- **CSV ownership:** keep a browser option hidden/deprecated rather than deleted when supported acquisition/recovery ownership is unclear.
- **Cache contract:** stop content/settings rollout if the root layout can serve inconsistent revisions across workers.

## 23. Recommended implementation phases and validation gates

### Phase A — Capability policy and Admin Centre information architecture

**Objective:** central capability map, grouped responsive navigation, overview badges and compatibility links without changing data authority.
**Scope:** layout/nav/dashboard; granular server guard helpers; keep current routes working.
**Migrations:** none.
**Likely files:** `src/app/admin/nav-model.ts`, `layout.tsx`, `page.tsx`, `AdminNav.tsx`, `AdminSection.tsx`, `src/lib/auth/session.ts`; likely new `src/lib/auth/capabilities.ts`; closest admin/nav/auth tests.
**Validation gate:** capability unit tests → direct page/action guard tests for all three roles → admin navigation browser test at mobile/desktop → typecheck only if route/type changes require it.
**Dependencies:** none.
**Stop:** any existing direct URL loses its current server guard.
**Model/effort:** `gpt-6-astra`, high.

### Phase B — Super Admin user lifecycle

**Objective:** promotion, demotion, deactivation/reactivation and safe session controls.
**Scope:** `/admin/admins`, auth queries/actions, transactional audit and invariants.
**Migrations:** none expected; add revision metadata only if preflight proves necessary.
**Likely files:** existing admins page/components/actions, auth session/audit helpers; likely `src/db/queries/admin-users.ts`; closest auth/admin integration and E2E suites.
**Validation gate:** role-transition helper tests → auth DB integration including concurrent final-Super-Admin cases and audit atomicity → direct action authorisation → admin-users E2E.
**Dependencies:** A.
**Stop:** unresolved FK attribution or non-transactional last-Super-Admin check.
**Model/effort:** Opus, high (implementation only; the implementation-ready plan is §26).
**Planning status:** complete 2026-09-10 — see §26 for the binding Phase B contract. Where §10 and §26 differ, §26 governs.

### Phase C1 — Brownlow canonical workflow and migration

**Objective:** exact-match draft/finalisation schema, authoritative transaction and season reconciliation helper.
**Scope:** migration, Brownlow queries/writers, audit/provenance, removal of generic mutation ownership at backend boundary.
**Migrations:** Brownlow `match_id`, workflow state/coverage and constraints.
**Likely files:** next migration; existing Brownlow acquisition/query/derived helpers; `src/app/admin/data-editor/actions.ts`; likely `src/db/queries/admin-brownlow.ts` and validation helper; existing Brownlow/match mutation and DB integration suites.
**Validation gate:** pure validation tests → migration/constraint integration → authoritative write/audit/partial-coverage/correction integration → regression that match/awards cannot alter Brownlow → privilege test.
**Dependencies:** A; unique-match preflight.
**Stop:** ambiguous source authority or incomplete season being written to `brownlow_season_votes`.
**Model/effort:** Opus, high (implementation only; the implementation-ready plan is §27).
**Planning status:** complete 2026-09-10 — see §27 for the binding Phase C contract and §27.25 for the C1 handoff prompt. Where §8 and §27 differ, §27 governs.
**Implementation status:** complete 2026-09-10 (all nine §27.25 items). Migration 094 applied and post-validated on `afldb_test`. The validation gate above has not yet been run; the record and the exact command sequence are the Phase C1 entries in `issues.md`.

### Phase C2 — Brownlow Admin UI

**Objective:** fast season/round/match entry, draft, finalise, correction and provenance UI.
**Scope:** new routes/components, status badges, remove/read-only legacy match-sheet field, revalidation.
**Migrations:** none beyond C1.
**Likely files:** likely `src/app/admin/brownlow/**`; existing match sheet form; Admin nav/dashboard; Brownlow browser tests.
**Validation gate:** component/action tests → affected route tests → Brownlow E2E including invalid participant/duplicate/stale edit → responsive E2E.
**Dependencies:** C1 and owner decision on Admin draft access.
**Stop:** UI can submit a player outside the server-loaded participant set or bypass season publication review.
**Model/effort:** Sonnet, high (implementation only; the contract is §27, handoff §27.26).
**Planning status:** complete 2026-09-10 — see §27.

### Phase D — Coach administration and durable assignments

**Objective:** player-linked/coach-only identity and exact-match tenure management that survives imports.
**Scope:** importer preservation/overrides, coach queries/actions/routes, derived-query regression.
**Migrations:** provenance/stable keys/override entity additions only where preflight shows gaps.
**Likely files:** next migration if needed; existing coach queries and importer; `src/lib/manual-authority.ts`; likely `src/db/queries/admin-coaches.ts`, `src/app/admin/coaches/**`; coach integration/E2E suites.
**Validation gate:** identity/range unit tests → importer-survival and assignment-conflict integration → public W-D-L/tenure regression → authorisation route/action tests → coach E2E.
**Dependencies:** A; importer preflight.
**Stop:** no stable non-name coach/source key or reload can erase a manual decision.
**Model/effort:** `gpt-6-astra`, xhigh.

### Phase E — Special records and durable suppression

**Objective:** manage first-kick goal and after-siren facts through canonical tables and durable provenance.
**Scope:** override patch/suppress contract, importer preservation, forms/routes and public revalidation.
**Migrations:** override operation/entity constraint changes if needed.
**Likely files:** next migration; existing override/data-edit helpers; relevant record importers and public queries; likely `src/db/queries/admin-records.ts`, `src/app/admin/records/**`; existing record/import/player-link tests.
**Validation gate:** stable-key/suppression unit tests → add/correct/suppress/restore integration → reload-survival and collision tests → affected public query tests → record-management E2E.
**Dependencies:** A; may reuse D's override extension.
**Stop:** importer can resurrect suppressed facts or manual additions cannot survive full supported reload.
**Model/effort:** `gpt-6-astra`, xhigh.

### Phase F — Structured site content extension

**Objective:** selected public copy controlled through the existing Super Admin content workflow.
**Scope:** approved key registry, validation, preview/publish, audit and route/layout invalidation.
**Migrations:** none expected; revision metadata only if missing.
**Likely files:** existing admin content/settings pages/actions/components, site-content/site-settings queries/helpers, public components consuming approved keys, existing settings/content/cache tests.
**Validation gate:** content schema/safe-render unit tests → action auth/stale revision tests → affected public route/cache tests → content publish E2E.
**Dependencies:** A and approved initial key list.
**Stop:** arbitrary HTML reaches rendering or layout settings can be cached at inconsistent revisions.
**Model/effort:** `gpt-5.6-sol`, high.

### Phase G — Safe current-season refresh jobs

**Objective:** retain current supported actions behind a fixed, observable, single-flight Super Admin boundary.
**Scope:** assess/reuse current mechanism; add minimal persisted jobs/worker only if necessary; current-season UI/status/audit.
**Migrations:** `admin_refresh_jobs` only if required.
**Likely files:** existing current-season page/actions/components and acquisition helpers; likely refresh-job query/dispatcher/worker module and route; deployment service only if a new worker is actually required; current-season/import/auth/job tests.
**Validation gate:** allowlist/no-argument unit tests → job state/single-flight/timeout integration → importer idempotency and privilege tests → route/action auth → success/failure/double-submit E2E.
**Dependencies:** A; operational decision on worker.
**Stop:** web input can influence executable/path/environment, import credentials enter web process, or no reliable job claimant exists.
**Model/effort:** `gpt-6-astra`, xhigh.

### Phase H — Dataset-by-dataset CSV transition

**Objective:** hide/remove redundant browser intake choices only after replacements and ownership are proven.
**Scope:** ingest registry inventory, labels/notices/navigation, remove browser options, retain required parsers and historical submissions.
**Migrations:** none expected.
**Likely files:** existing upload/submission pages/actions/components, ingest dataset registry, Admin nav and closest ingest/submission tests; operator docs only if authorised in that implementation issue/session.
**Validation gate:** registry contract tests → retained dataset upload/validate/promote test → removed options absent from direct action as well as UI → submission history read test → focused browser intake flow.
**Dependencies:** C–G replacements as applicable.
**Stop:** any removed option remains the only supported acquisition/recovery path.
**Model/effort:** `gpt-6-astra`, high.

### Phase I — Integrated acceptance and permission audit

**Objective:** verify the complete centre across roles and public effects; no new product scope.
**Scope:** cross-feature E2E, accessibility/responsive checks, deployment compatibility and issue evidence.
**Migrations:** none.
**Likely files:** closest existing admin/auth E2E specs and only defects found within ISSUE-155 scope.
**Validation gate:** focused role matrix/API routes → feature E2Es → responsive/accessibility pass → affected typecheck/build once → broader admin/auth integration suite once. Full repository suite only if shared auth/database changes justify it.
**Dependencies:** all delivered phases.
**Stop:** guard/UI disagreement, privilege drift, stale public cache or importer-survival regression.
**Model/effort:** `gpt-6-astra`, high.

## 24. Projected files by phase

This is a projection, not edit authorisation. Exact migration numbers must be chosen against the implementation branch at phase start.

| Phase | Confirmed existing files/subsystems | Likely new files | Migrations/tests |
|---|---|---|---|
| A | `src/app/admin/nav-model.ts`, `layout.tsx`, `page.tsx`, `AdminNav.tsx`, `AdminSection.tsx`, `src/lib/auth/session.ts` | `src/lib/auth/capabilities.ts` | closest admin nav/auth tests |
| B | `src/app/admin/admins/**`, auth actions/audit/session helpers | `src/db/queries/admin-users.ts` if extraction is useful | optional auth revision migration; auth/admin integration/E2E |
| C1 | Brownlow acquisition/query/derived helpers; data-editor actions | `src/db/queries/admin-brownlow.ts`, Brownlow validation/reconciliation helper | Brownlow migration; existing Brownlow/match integration suites |
| C2 | match-sheet form; Admin nav/dashboard | `src/app/admin/brownlow/page.tsx`, `[season]/[round]/**`, components/actions | Brownlow route/E2E tests |
| D | coach public queries/importer; manual-authority/data-edit helpers | `src/db/queries/admin-coaches.ts`, `src/app/admin/coaches/**` | coach/provenance migration if needed; coach/import/E2E tests |
| E | record public queries/importers; override/data-edit/player-link helpers | `src/db/queries/admin-records.ts`, `src/app/admin/records/**` | override operation migration if needed; record/import/E2E tests |
| F | `src/app/admin/content/**`, `settings/**`, site-content/site-settings helpers and selected public consumers | key registry/field components only if current homes are unsuitable | optional revision migration; content/settings/cache/E2E tests |
| G | `src/app/admin/current-season/**`, acquisition/status helpers | refresh-job query/dispatcher/status route; worker only if required | job migration if required; current-season/job/privilege/E2E tests |
| H | `src/app/admin/upload/**`, `submissions/**`, ingest dataset registry, nav | none expected | ingest/submission/browser tests |
| I | all affected Admin routes | none | existing admin/auth/integration/E2E homes |

## 25. Unresolved decisions

Only two product decisions need owner review; neither blocks the rest of the plan.

### Decision 1 — Who may save Brownlow drafts?

- **Option A:** Admin can save incomplete drafts; Super Admin alone can finalise, correct published facts and reconcile season authority.
- **Option B:** Brownlow is entirely Super Admin-only, including draft entry.
- **Recommendation:** Option A. Participant validation, no public effect from drafts and Super Admin publication preserve the authority boundary while allowing data-entry delegation.
- **Consequences:** A requires separate `brownlow.draft` and `brownlow.finalise` capabilities and displays draft actor history. B is simpler but concentrates a repetitive entry task in the highest role.
- **Status:** adopted as Option A by the Phase C plan (§27.8), per the owner's Phase C brief of 2026-09-10 (`data.brownlow.read`, `data.brownlow.draft`, `data.brownlow.finalise`).

### Decision 2 — Allowed formatting for managed public copy

- **Option A:** plain text with preserved line breaks and separately validated link fields.
- **Option B:** tightly restricted Markdown with a source-controlled element allowlist and sanitisation.
- **Recommendation:** Option A for the initial release.
- **Consequences:** A has the smallest security/cache/rendering surface and fits explanatory copy/banners. B offers emphasis and lists but adds parser, sanitisation, preview parity and regression responsibilities.

## 26. Phase B — Super Admin user lifecycle: implementation-ready plan

Planned 2026-09-10 by native repository inspection only (no commands, no database access). Every "confirmed" statement below was read from the current worktree at `codex/issue-155-admin-overhaul` with Phase A applied. Anything that could only be established at runtime is listed in §26.16 as an implementation preflight. This section is the implementation contract for Phase B; §10 remains the product intent and §26 refines it.

### 26.1 Confirmed current-state auth/user model

**`auth_users`** (migrations 023, 028, 029, 033, 040, 044):

| Column | Type / rule | Lifecycle relevance |
|---|---|---|
| `id` | identity PK | referenced by every attribution FK (§26.4) |
| `email` | `NOT NULL UNIQUE`, plus `uq_auth_users_email_lower` (044) | one account per address; not changed by Phase B |
| `role` | `text NOT NULL CHECK (role IN ('admin','super_admin','contributor'))` (033) | the role is a plain text column, no enum, no version |
| `password_hash` | scrypt, nullable | NULL means the account cannot sign in |
| `totp_secret` | nullable | NULL means the account cannot sign in (login requires both factors) |
| `totp_last_step` | bigint (028) | replay guard, untouched by Phase B |
| `can_manage_admins` | `boolean NOT NULL DEFAULT false` (029) | delegated invite/reset power for a plain admin; `super_admin` implies it |
| `must_change_password` | `boolean NOT NULL DEFAULT false` (040) | temporary-password obligation; enforced by `requireUploader` |
| `password_changed_at` | timestamptz (040) | shown on `/admin/admins` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | "created" column for the list |
| `disabled_at` | timestamptz, nullable | **the existing active/inactive state**; NULL = active |

There is **no** status enum, **no** row version/revision column, **no** `last_login_at`, **no** `disabled_by`/`disabled_reason`, and **no** session epoch for admin claims.

**Sessions.** `auth_sessions` (023): `token_hash`, `user_id` (`REFERENCES auth_users(id) ON DELETE CASCADE`), `created_at`, `expires_at`, `revoked_at`, `ip`, `user_agent`. Rows are never deleted by the application, only revoked. The admin cookie carries a signed claim (`kind: 'admin'`, `epoch: 1`, fixed) plus the opaque token; `verifyClaim` applies `minEpoch` only to beta claims (`tokens.ts`), so there is no admin epoch mechanism to reuse and Phase B must not invent one. The database row is the revocation layer.

**Live per-request re-read.** `getAdminUser()` (`src/lib/auth/session.ts`) joins `auth_sessions` to `auth_users` on every request and requires `s.expires_at > now()`, `s.revoked_at IS NULL`, `u.disabled_at IS NULL` and a valid role. It is wrapped in `React.cache`, which is per request only. Consequently a role change is observed by the target's very next request without any cookie change, and a deactivated account is rejected by the next request even before its sessions are revoked. `adminLogin` also filters `disabled_at IS NULL`, so a disabled account cannot sign in.

**Guards.** `requireSignedIn` → `requireUploader` (enforces `must_change_password`) → `requireAdmin` (bounces contributor to `/admin/upload`) → `requireSuperAdmin` (redirects non-super to `/admin`). `requireAdminManager` admits `super_admin` or `can_manage_admins` (`hasAdminManagementAccess`). Phase A added `requireCapability(capability)` over `requireUploader` + `hasCapability`, redirecting identically. `ROLE_RANK` (`contributor 0 < admin 1 < super_admin 2`) is exported from `session.ts` and used by the invite and temporary-password flows.

**Capability policy (Phase A, `src/lib/auth/capabilities.ts`).** `people.admins.read` = admin and super_admin; `people.admins.manage` = super_admin or `canManageAdmins` (delegation). No lifecycle capability exists yet. `nav-model.ts` shows the Administrators link on `people.admins.read`.

**Current `/admin/admins`** (`page.tsx`, `AdminSessionsClient.tsx`, `InviteManager.tsx`, `actions.ts`, `invite-actions.ts`, `password-actions.ts`):

- page guard `requireAdmin`; lists **every** account (including disabled ones, with no status shown) with role label, `can_manage_admins` label, temporary-password state, `password_changed_at`, and every live session's created/expires/IP/user agent;
- `revokeSession` — guard `requireAdmin` only, so today **any admin may sign out any other account's session**, including a super admin's;
- `issueTemporaryPassword` — `requireAdminManager`; refuses self; delegated manager may reset only a contributor (rank compare); transaction writes hash + `must_change_password` + revokes target sessions; audit written on the pool **after** commit;
- `createInvite`/`revokeInvite` — `requireAdminManager`; only a super admin may grant `super_admin` or `can_manage_admins`; delegated manager may not re-invite an existing admin+ address;
- invite acceptance (`src/app/admin/invite/[token]/actions.ts`) upserts on email under `FOR UPDATE`, refuses if the existing account outranks the invite, sets password/TOTP, **clears `disabled_at`**, revokes the account's sessions, and audits `admin.invite_accepted` with the invitee as actor label. This is the current account-creation path (no shell path is used for routine creation). A new account is active immediately on acceptance.

**Audit.** `auth_audit_log` (023, 082): append-only for `afldb_auth` (SELECT + INSERT only), `actor_user_id` FK to `auth_users`, `actor_label`, `action`, `detail jsonb` (must be an object or NULL, constraint `auth_audit_log_detail_is_object_ck`), `ip`. `audit()` writes on the pool; `auditInTransaction(tx, …)` writes on a caller's `authSql.begin()` handle and deliberately propagates failure so the mutation rolls back with it. Both funnel through one `insertAuditRow`, which binds `detail` via `sql.json()` and records `requestIp()`.

**Auth pool.** `authSql` (`src/db/authClient.ts`): role `afldb_auth`, `max: 3`, `statement_timeout: 5000`. `authSql.begin()` is already used by `password-actions.ts`, `password/actions.ts` and the access-code actions, so it is the transaction helper to reuse. `afldb_auth` holds `SELECT, INSERT, UPDATE` on `auth_users` and `auth_sessions` (023, reconciled by `tools/maintenance/privileges.sql` line ~411 and asserted by `tests/integration/privileges.test.ts`), and **no DELETE** on `auth_users`.

**Existing concurrency idiom.** `tests/integration/player-link-concurrency.test.ts` opens two `postgres(testDbUrl, { max: 1 })` connections plus an observer, and proves blocking deterministically with `pg_blocking_pids()` polling rather than sleeps. `src/db/queries/player-links.ts` and the invite acceptance use `SELECT … FOR UPDATE`. No code under `src/` uses advisory locks today.

### 26.2 Product decisions (binding)

1. **Deactivation, never deletion.** No delete mutation is implemented. See §26.4.
2. **Lifecycle mutations are Super Admin-only.** Promote, demote, deactivate and reactivate require an enabled `super_admin` actor. `can_manage_admins` grants none of them (§26.3).
3. **Role transitions are limited to `admin ⇄ super_admin`.** A contributor is not promoted or demoted by Phase B (contributor role changes remain the invite flow's job). Deactivate/reactivate apply to all three roles.
4. **No self-demotion, no self-deactivation.** §26.6.
5. **Every role or status change revokes all of the target's sessions**, including promotion. §26.8.
6. **Reactivation restores the account as it was** (role, `can_manage_admins`, credentials) and revives no session. Credential re-issue stays the existing temporary-password control, surfaced next to the reactivated account. §26.8.
7. **Demotion clears `can_manage_admins`.** The demoted account becomes a plain admin; the previous value is recorded in the audit detail. Promotion leaves the column as is (irrelevant for a super admin).
8. **Deactivation requires typed confirmation (the target's email) and a short reason** stored in the audit detail. Demotion requires an ordinary confirm step. Promotion and reactivation need no confirmation (reversible, non-destructive).
9. **Ordinary Admins keep read access to the page but lose other-account session controls.** §26.9.
10. **No migration.** §26.11.
11. **Stale requests are refused, not silently re-applied.** Every mutation is compare-and-set against the role/status the page rendered. §26.10, §26.13.

### 26.3 Role and capability matrix

| Action | Contributor | Admin | Admin + `can_manage_admins` | Super Admin | Operator |
|---|---|---|---|---|---|
| View Administrators page (`people.admins.read`) | No (bounced to upload) | Limited view | Limited view + invite/reset controls as today | Full view | — |
| See other accounts' live sessions (IP/device) | No | No (own sessions only) | No (own only) | Yes | — |
| Revoke own session | via page: No (cannot reach) | Yes | Yes | Yes | — |
| Revoke another account's session | No | No | Contributor targets only (same rank rule as password reset) | Yes | — |
| Invite / revoke invite (`people.admins.manage`) | No | No | Yes, existing rules | Yes | — |
| Issue temporary password | No | No | Contributor targets only (existing) | Anyone but self (existing) | — |
| Promote admin → super admin (`people.admins.lifecycle`) | No | No | **No** | Yes | — |
| Demote super admin → admin | No | No | **No** | Yes, invariant + not self | — |
| Deactivate | No | No | **No** | Yes, invariant + not self | — |
| Reactivate | No | No | **No** | Yes | — |
| Hard delete | No | No | No | **No** | Repair only, outside the app |

**Capability table change (exact):** add one member to the `Capability` union and `CAPABILITY_ROLES` in `src/lib/auth/capabilities.ts`:

```ts
| 'people.admins.lifecycle'
…
'people.admins.lifecycle': SUPER_ADMIN_ONLY,
```

`hasCapability` needs no new special case: the `people.admins.manage` branch stays exactly as Phase A wrote it, and `people.admins.lifecycle` resolves through the role list, so a `canManageAdmins` admin is denied. `people.admins.read` and `people.admins.manage` are unchanged, so Phase A visibility and every existing guard call keep their behaviour. The nav gains no link (the page already exists).

**`can_manage_admins` decision:** preserved for its existing invite/temporary-password/session delegation for compatibility; explicitly excluded from lifecycle mutations; cleared on demotion. Phase B adds no UI to grant or revoke the flag on an existing account (today it is only set through an invite); if that is wanted it is a separate small follow-up, not part of this phase.

### 26.4 Hard delete versus deactivate

**Hard deletion is not supported and no delete mutation is implemented.** Evidence:

- Every attribution FK to `auth_users` uses the default `NO ACTION` except `auth_sessions.user_id` (`ON DELETE CASCADE`): `auth_audit_log.actor_user_id`, `beta_access_codes.created_by`, `beta_allowed_emails.added_by`, `beta_join_requests.reviewed_by` (024), `data_submissions.uploaded_by` (NOT NULL) and `reviewed_by`, `admin_invites.invited_by` (NOT NULL, 030), `site_settings.updated_by` (034), `site_media.uploaded_by` (037), `nl_search_review.reviewed_by` (047), `player_link_suggestions.resolved_by` and `player_link_resolutions.admin_user_id` (NOT NULL, 056), `data_edits.admin_user_id` (NOT NULL, 057), `data_overrides.admin_user_id` (NOT NULL, 073), and the `staging` observation spine's `admin_user_id` (NOT NULL, 074). A delete of any account that has ever acted is therefore refused by PostgreSQL, and making it succeed would need cascades or nulling that erase required attribution (`data_edits`, `player_link_resolutions`, `data_overrides` are NOT NULL by design).
- `afldb_auth` holds no `DELETE` on `auth_users`; a web-path delete would require a privilege expansion, which §22 forbids.
- `disabled_at` is already honoured by `getAdminUser` and `adminLogin`, so deactivation already means "cannot authenticate".

**Consequences the implementation must honour:**

- Historical attribution stays valid: the row is retained; every FK keeps resolving; the list shows deactivated accounts with their date rather than hiding them.
- An inactive account cannot sign in (existing `adminLogin` predicate) and cannot continue an existing session (existing `getAdminUser` predicate); Phase B additionally revokes its sessions so nothing is revived by reactivation.
- Email uniqueness is retained; an invite to a deactivated address behaves as today (§26.1): acceptance re-enrols and clears `disabled_at`. Only a super admin can issue such an invite for an admin+ address, so this remains a Super Admin-controlled reactivation path with its own audit event. It is acknowledged, not changed, in Phase B.
- The FK review is recorded here; the implementation does not alter any FK.

### 26.5 Last-Super-Admin invariant

**Viable Super Admin** = a row with `role = 'super_admin' AND disabled_at IS NULL AND password_hash IS NOT NULL AND totp_secret IS NOT NULL`. That is exactly the set that can pass `adminLogin`. An outstanding temporary password (`must_change_password = true`) still counts as viable, because the holder can sign in and replace it. Disabled accounts and un-enrolled accounts never count.

**Rule:** a demotion or deactivation of a super admin commits only if, inside the same transaction and under the lifecycle lock, `count(viable super admins whose id <> target) >= 1`.

**Schema support:** none is possible or needed. "At least one row matching a predicate" cannot be a CHECK or unique index; the invariant is enforced transactionally (§26.7). `auth_users` is tiny (tens of rows), so the count is a trivial scan and no index is added.

Because the actor must be a live super admin and self-actions are refused, a single mutation can never remove the last viable super admin on its own. The invariant exists for the concurrent case, and §26.7 is what makes it hold there.

### 26.6 Self-action policy

- **Self-demotion: refused.** **Self-deactivation: refused.** (Self-promotion and self-reactivation are impossible by state.) The refusal is server-side (`target.id === actor.id` inside the transaction) and mirrored in the UI as an explanation, matching `issueTemporaryPassword`'s existing self refusal.
- Rationale: fail-safe. Permitting either would make "I demoted myself and the other super admin is on leave" a recovery incident; the invariant count alone does not protect against it when two super admins exist. Nothing in the product requires self-demotion; an operator can repair a genuinely stuck account outside the application.
- The actor is re-read under the lock; if the actor's own row is no longer an enabled `super_admin` by then (a concurrent demotion/deactivation landed first), the mutation is refused with `forbidden` and the next request's guard redirects them.

### 26.7 Concurrent mutation strategy

Minimum sufficient mechanism, in one `authSql.begin()` transaction:

1. `SELECT pg_advisory_xact_lock(<constant key>)` — serialises **all** lifecycle mutations (promote/demote/deactivate/reactivate) across the pool and across workers. Use one fixed bigint key defined in the query module (for example `hashtext('auth_users.lifecycle')`'s constant value, or a literal such as `155_001`), documented in code; advisory locks need no grant and no schema. No other code under `src/` uses advisory locks, so the key space is free (preflight §26.16 re-checks `tools/`).
2. `SELECT … FROM auth_users WHERE id IN (actor, target) FOR UPDATE` — row locks on the two rows that are about to be read and written, so the compare-and-set below is against a stable row.
3. Re-derive everything from those rows (never from the form): actor still viable super admin; target exists; target's current `role`/`disabled_at`/`can_manage_admins`.
4. Compare-and-set: refuse `stale` if the target's current `role` or active state differs from the `expectedRole`/`expectedActive` hidden fields the page rendered.
5. Invariant count (`viable super admins excluding target`) for demote/deactivate of a super admin.
6. `UPDATE auth_users … WHERE id = target AND role = <current> AND (disabled_at IS NULL) = <current>` and assert one row was updated (belt and braces under the lock).
7. `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL RETURNING id` — count recorded in the audit detail.
8. `auditInTransaction(tx, …)`.
9. Commit.

Why this and not row locks alone: `SELECT … WHERE role = 'super_admin' FOR UPDATE` would also work in READ COMMITTED (the blocked transaction re-evaluates the predicate on the updated row and skips the demoted one), but that correctness argument depends on EvalPlanQual behaviour and on every mutation locking the same predicate set. A single advisory transaction lock makes serialisation explicit, cheap (mutations are rare), provable with `pg_blocking_pids()` in the existing test idiom, and independent of the row set. No SERIALIZABLE isolation and no distributed locking.

Race outcomes with this design:

- **A demotes B while B demotes A:** the second transaction waits on the advisory lock, then re-reads its actor row (now `admin`) and refuses `forbidden`; even if the actor check were absent, the invariant count excluding the target would be zero and refuse `last_super_admin`.
- **Two super admins each remove a different third/fourth super admin when only two others exist:** serialised; the second sees the reduced count and refuses if it would leave zero.
- **Stale page:** the compare-and-set refuses; the UI says the account changed and offers reload.
- **Promotion/demotion of the same target at once:** serialised; the loser refuses `stale`.
- **Lock wait longer than `statement_timeout` (5 s on `authSql`):** PostgreSQL raises a statement timeout inside `pg_advisory_xact_lock`; the action catches and returns `conflict` ("another administrator change is in progress, try again"). Nothing is written.

### 26.8 Session invalidation strategy

Reuse the existing database session rows; do not add an epoch. The signed cookie already only opens the door, and `getAdminUser` re-reads role and `disabled_at` per request.

| Event | Existing sessions of the target | Why |
|---|---|---|
| Promote | Revoked in the same transaction | Fail-closed: new powers are exercised only by a session that authenticated after the change. Role would be live on the next request anyway; revoking is cheap and uniform. |
| Demote | Revoked | Privilege reduction; the next request would already read `admin`, revocation removes any in-flight assumption. |
| Deactivate | Revoked | `disabled_at` alone already fails the next request; revoking ensures reactivation cannot revive an old session and makes the session list truthful immediately. |
| Reactivate | None revived; nothing to revoke (defensive revoke of any live row is harmless and included) | Sessions ended at deactivation. The person signs in again with existing credentials, or with a temporary password if the super admin issues one. |

The actor's own session is untouched by every action (self-actions are refused). Password change (`password/actions.ts`) and temporary-password issue continue to revoke as they do today; Phase B does not modify them.

### 26.9 UI workflow (`/admin/admins`)

Keep the route, the `CollapsibleTable` presentation, `InviteManager` and the password/invite actions. Change the page and `AdminSessionsClient` as follows.

**Page query** (`page.tsx`, moved into `src/db/queries/admin-users.ts`): one statement per account with `id, email, role, can_manage_admins, disabled_at, created_at, must_change_password, password_changed_at, password_hash IS NOT NULL AS has_password, totp_secret IS NOT NULL AS has_totp, (SELECT max(created_at) FROM auth_sessions s WHERE s.user_id = u.id) AS last_sign_in_at`, ordered active first then email; sessions loaded as today but **only for the accounts the viewer may see sessions for** (all for super admin; own row only otherwise). The viable-super-admin count is computed in the same query (or a second cheap one) and passed to the client for explanatory text only. Never select `password_hash`/`totp_secret` values, only their presence.

**Account card header:** email; role badge (`Super admin` / `Admin` / `Admin · can manage admins` / `Contributor`); status badge (`Active` or `Deactivated <date>`); `You` marker on the viewer's own row; created date; last sign-in (or `never`); enrolment note only when `has_password`/`has_totp` is false (`not yet enrolled`, no secrets); temporary-password note as today. Deactivated accounts are grouped under a collapsed `Deactivated accounts` heading below the active ones.

**Sessions table:** unchanged columns; rendered for the viewer's own account for every role, and for all accounts only for a super admin. `Sign out` on another account's session is shown to super admins and (for contributor targets) to delegated managers, matching the server rule.

**Lifecycle controls (super admin only, new `LifecycleControls` client component under the card):**

| Target state | Controls offered | Confirmation |
|---|---|---|
| Active admin | `Promote to super admin`, `Deactivate` | none / typed email + reason |
| Active super admin | `Demote to admin`, `Deactivate` | confirm step / typed email + reason |
| Active contributor | `Deactivate` | typed email + reason |
| Deactivated (any role) | `Reactivate` | none |
| Viewer's own row | none; text "This is your own account. Another super admin must change it." | — |

Each form carries hidden `userId`, `expectedRole`, `expectedActive` (`'1'`/`'0'`) fields. A control that the pure helper (§26.10) reports as unavailable renders as disabled with the reason beside it (for example "Cannot demote: this is the only active super admin"; "Cannot deactivate: this account is the only active super admin with working credentials"). The server enforces the same rule regardless of the disabled state. The per-account action state shows `error`/`message` next to the row (the `PasswordResetState.email` pattern), and a `stale`/`conflict` result adds a `Reload` link.

Responsive: reuse the existing card/table styles; controls stack vertically under 600px; targets at least 44px high; no new horizontal overflow (the existing `.table-wrap` handles the sessions table).

### 26.10 Backend mutation design

**Files:**

- `src/lib/auth/admin-lifecycle.ts` — **new, pure (no `server-only`)**: the shared decision logic so the client, the action and the unit tests agree.
  - `LifecycleAction = 'promote' | 'demote' | 'deactivate' | 'reactivate'`
  - `isViableSuperAdmin(row)` — the §26.5 predicate over `{ role, disabledAt, hasPassword, hasTotp }`.
  - `lifecycleEligibility(actor, target, viableOtherSuperAdmins)` → `{ promote, demote, deactivate, reactivate }`, each `{ allowed: true } | { allowed: false; reason: LifecycleRefusal }`, where `LifecycleRefusal = 'self' | 'forbidden' | 'invalid_state' | 'last_super_admin'`.
  - `lifecycleTransition(action, target)` → the `{ role, disabledAt, canManageAdmins }` after the action (promote sets `super_admin`; demote sets `admin` + `can_manage_admins=false`; deactivate sets `disabled_at=now`; reactivate sets `disabled_at=null`).
  - Message text for each refusal code, so the UI and the action wording cannot drift.
- `src/db/queries/admin-users.ts` — **new, `server-only`**: `listAdminAccounts(viewer)` (the page read model, §26.9) and `applyLifecycleMutation(sql, input)` where `sql` is a `postgres.Sql` handle (the action passes `authSql`; integration tests pass their own owner connections, so the transactional logic is exercised without mocking). Returns a discriminated result, never throws for a refusal.
- `src/app/admin/admins/lifecycle-actions.ts` — **new** Server Actions `promoteAdmin`, `demoteSuperAdmin`, `deactivateAccount`, `reactivateAccount`, each a thin wrapper: guard → parse form → `applyLifecycleMutation` → refusal audit on the pool → `revalidatePath('/admin/admins')` → state.
- `src/app/admin/admins/LifecycleControls.tsx` — **new** client component.
- `src/app/admin/admins/page.tsx`, `AdminSessionsClient.tsx` — read model, badges, visibility rules.
- `src/app/admin/admins/actions.ts` (`revokeSession`) — add the target-ownership rule (§26.3): own session for any admin; another account's session only for a super admin, or a delegated manager when the target is a contributor. Refusal audited as `session.revoke_refused`.
- `src/lib/auth/capabilities.ts` — one added capability (§26.3).

**Common mutation contract** (`applyLifecycleMutation(sql, { action, actorId, targetId, expectedRole, expectedActive, reason? })`):

| Step | Detail |
|---|---|
| Actor capability (in the action) | `requireSuperAdmin()` (also equals `hasCapability(admin, 'people.admins.lifecycle')`; a unit test asserts the two agree). Contributors are bounced by `requireAdmin`; delegated managers redirect to `/admin`. |
| Input validation | `userId` integer; `expectedRole ∈ {admin, super_admin, contributor}`; `expectedActive ∈ {'1','0'}`; deactivate: `reason` trimmed, 3–200 chars, `confirmEmail` must equal the target's email (compared server-side to the row read under lock, case-insensitive). Invalid input → `{ error, code: 'invalid' }` without opening a transaction. |
| Transaction | `sql.begin(async tx => …)` with the §26.7 sequence: advisory lock → `FOR UPDATE` on actor and target → checks → UPDATE → session revoke → `auditInTransaction`. |
| Target lookup | Not found → `not_found` (no audit row; nothing to attribute). |
| Self check | `targetId === actorId` → `self` for demote/deactivate. |
| Actor re-check | actor row not viable super admin → `forbidden`. |
| Stale check | `role !== expectedRole` or `(disabled_at IS NULL) !== expectedActive` → `stale`. This also covers duplicate promotion/deactivation from a stale page: the page that rendered "Promote" expected `admin`, the row is already `super_admin`, so the answer is `stale`, not a silent success. |
| State validity | promote requires `admin` active; demote requires `super_admin` active; deactivate requires active; reactivate requires deactivated → otherwise `invalid_state` (only reachable if the UI and hidden fields disagree). |
| Invariant | demote/deactivate of a `super_admin`: count viable others `>= 1` else `last_super_admin`. |
| Mutation | the `lifecycleTransition` values, conditional UPDATE, assert rowCount 1 (else throw → rollback → `conflict`). |
| Session invalidation | revoke all target sessions; keep the count. |
| Audit (in-transaction, required) | actions `admin.promoted`, `admin.demoted`, `admin.deactivated`, `admin.reactivated`; detail `{ targetUserId, targetEmail, before: { role, active, canManageAdmins }, after: { … }, reason?, revokedSessions, expected: { role, active } }`; actor `{ userId: actor.id, label: actor.email }`. A failed INSERT propagates and rolls the UPDATE back (the `auditInTransaction` contract). |
| Refusal audit (pool, after rollback/no-write) | `admin.lifecycle_refused` with `{ action, targetUserId, targetEmail, code }`, mirroring `admin.password_reset_refused`. Not written for `not_found` or `invalid`. |
| Return | `{ ok: true, message, email }` or `{ ok: false, code, error, email }`; the Server Action maps it to `LifecycleState = { error?, message?, code?, email? }`. |
| Failure | any thrown error (timeout, audit failure, connection) → rolled back by `begin`, logged with `console.error` without secrets, returned as `code: 'conflict'` for lock/statement timeouts and `code: 'failed'` otherwise, both with a generic message. Never report success unless the transaction committed. |
| After commit | `revalidatePath('/admin/admins')`. No public cache is affected. The target's next request is rejected/redirected by the existing guards because its sessions are revoked. |

**`revokeSession` change:** read the session's `user_id` and the target's role first (`SELECT … FROM auth_sessions JOIN auth_users`), apply the ownership rule, then the existing UPDATE. Non-transactional as today; nothing here changes roles or status.

### 26.11 Schema and migration decision

**No migration.** Reasons:

- active/inactive state exists (`disabled_at`); role is an existing checked text column; credentials presence is derivable; created date exists; last sign-in derives from `auth_sessions.created_at` without a new column;
- stale detection uses compare-and-set on `role` and `disabled_at`, so no revision column is needed for a two-field state on a tiny table;
- the invariant cannot be expressed as a constraint and is enforced transactionally with an advisory lock, which needs no schema and no grant;
- `afldb_auth` already holds `SELECT, INSERT, UPDATE` on `auth_users`/`auth_sessions` and `INSERT` on `auth_audit_log`, which is exactly what the mutation uses; `privileges.sql` is untouched;
- no FK is altered; `tests/integration/fk-indexes.test.ts` and `privileges.test.ts` keep passing unchanged.

If the implementation session finds it wants `disabled_reason`/`disabled_by` columns for display, it must not add them in Phase B; the audit log holds the reason (optionally surfaced by reading the latest `admin.deactivated` row for that target from `auth_audit_log`, which `afldb_auth` may SELECT).

### 26.12 Audit model

- Mechanism: `auth_audit_log` via `auditInTransaction` inside the lifecycle transaction (required, atomic with the mutation) and `audit` on the pool for refusals. No new table.
- Recorded per mutation: actor id and label, target id and email, before/after role and active state and `can_manage_admins`, action, timestamp (`at` default), request IP (existing `requestIp()`), reason (deactivation), number of revoked sessions, the expected state the page carried.
- Failure semantics: mutation + audit have one atomic outcome. There is no post-commit required audit write. Refusal events are informational and best-effort on the pool, as today's refusal events are.
- Attribution survives: the target row is never deleted; `actor_user_id` remains a valid FK.

### 26.13 Error and conflict outcomes

| Situation | Code | User-facing outcome | Audit |
|---|---|---|---|
| Target id not an integer / bad expected fields | `invalid` | "Bad request." | none |
| Target not found | `not_found` | "No such account." | none |
| Own account (demote/deactivate) | `self` | "This is your own account. Another super admin must change it." | `admin.lifecycle_refused` |
| Actor no longer an enabled super admin | `forbidden` | "Your access changed. Sign in again." | `admin.lifecycle_refused` |
| Role or active state differs from the page | `stale` | "This account changed since the page loaded. Reload and try again." | `admin.lifecycle_refused` |
| Duplicate promotion / duplicate deactivation | `stale` (as above) | same, worded for the case ("already a super admin") | as above |
| Action invalid for the current state | `invalid_state` | "That action is not available for this account." | `admin.lifecycle_refused` |
| Would remove the last viable super admin | `last_super_admin` | "Refused: <email> is the only active super admin with working credentials." | `admin.lifecycle_refused` |
| Typed email mismatch (deactivate) | `invalid` | "Type the account's email exactly to confirm." | none |
| Lock wait / statement timeout | `conflict` | "Another administrator change is in progress. Try again." | none (nothing happened) |
| Audit INSERT or UPDATE failure | `failed` | "The change was not saved." | none (rolled back) |
| Other database failure | `failed` | same | none |

Idempotent success is deliberately not offered: a stale request that would change nothing is reported as stale, so a super admin never sees "done" for something another super admin did.

### 26.14 Expected files to change

| File | Change |
|---|---|
| `src/lib/auth/capabilities.ts` | add `people.admins.lifecycle` (super admin only) |
| `src/lib/auth/admin-lifecycle.ts` | **new** pure eligibility/transition/viability helper |
| `src/db/queries/admin-users.ts` | **new** read model + `applyLifecycleMutation(sql, …)` |
| `src/app/admin/admins/lifecycle-actions.ts` | **new** four Server Actions |
| `src/app/admin/admins/LifecycleControls.tsx` | **new** client controls with explanations and confirmations |
| `src/app/admin/admins/page.tsx` | use the read model; pass viewer role/viable count; session visibility rule |
| `src/app/admin/admins/AdminSessionsClient.tsx` | badges, status, `You`, created/last sign-in, deactivated grouping, render `LifecycleControls` |
| `src/app/admin/admins/actions.ts` | `revokeSession` ownership rule |
| `tests/auth.test.ts` | capability + pure helper coverage |
| `tests/admin-lifecycle-actions.test.ts` | **new** action-level source-contract tests (closest existing home is `admin-access-actions.test.ts`, whose mock shape is reused; a new file is justified because no admin-users action suite exists) |
| `tests/integration/admin-lifecycle.test.ts` | **new** DB integration incl. concurrency (modelled on `player-link-concurrency.test.ts`; no existing auth lifecycle integration suite) |
| `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` (Unreleased) | Phase B record |

Not changed: migrations, `privileges.sql`, `session.ts` guards, `invite-actions.ts`, `password-actions.ts`, `InviteManager.tsx`, `nav-model.ts`, middleware, any deploy file.

### 26.15 Focused test plan

**Unit / source-contract (`tests/auth.test.ts`, extend existing `describe('capability policy')` and add a `describe('admin lifecycle helper')`):**

- `people.admins.lifecycle` is true only for `super_admin`; false for `admin` with and without `canManageAdmins`, and for contributor; `people.admins.read`/`manage` unchanged (existing assertions keep passing).
- `isViableSuperAdmin`: true for enabled enrolled super admin (with and without `mustChangePassword`); false when disabled, when `hasPassword` false, when `hasTotp` false, when role is admin.
- `lifecycleEligibility`: promote allowed for active admin only; demote allowed for active super admin with `viableOtherSuperAdmins >= 1`, refused `last_super_admin` at 0, refused `self`; deactivate refused `self`, refused `last_super_admin` for a super admin at 0, allowed for admin/contributor regardless of count; reactivate only for deactivated; non-super actor → `forbidden` for every action.
- `lifecycleTransition`: demote clears `canManageAdmins`; promote keeps it; deactivate/reactivate keep role and flag.
- `getAdminUser` statement capture (the file already mocks `@/db/authClient` and `next/headers`; sign an admin claim with `signClaim` for the mocked cookie): the emitted SQL contains `u.disabled_at IS NULL` and `s.revoked_at IS NULL`. This is the source-contract proof that an inactive user and a revoked session cannot continue.

**Action-level (`tests/admin-lifecycle-actions.test.ts`, mock `@/db/authClient` and `@/lib/auth/session` exactly as `admin-access-actions.test.ts` does):**

- guard: `requireSuperAdmin` is called by every lifecycle action; a thrown redirect stops before any statement.
- the transaction opens with `pg_advisory_xact_lock`, then `FOR UPDATE` on actor and target, then the conditional UPDATE, the session revoke, and the audit INSERT — all on the `tx` handle, none on the pool (statement-order assertions like the access-code tests).
- refusal codes map to the documented messages and to `admin.lifecycle_refused` on the pool.
- deactivate refuses when `confirmEmail` mismatches before opening a transaction.
- `revokeSession`: plain admin on another account's session → refused with `session.revoke_refused`; own session → UPDATE issued; super admin → UPDATE issued.

**Database integration (`tests/integration/admin-lifecycle.test.ts`, `AFLDB_TEST_DATABASE_URL`, name must end `_test`):** fixtures are inserted with unique random emails and non-null dummy `password_hash`/`totp_secret` (viability requires both); cleanup deletes this run's `auth_audit_log` rows for those actor/target ids first (the FK would otherwise block), then the users (sessions cascade). Calls `applyLifecycleMutation(ownerSql, …)` directly.

1. promote admin → super admin: row updated, sessions revoked, one `admin.promoted` audit row with before/after, `can_manage_admins` untouched.
2. demote with two viable super admins: succeeds, `can_manage_admins` cleared, sessions revoked, `admin.demoted` written.
3. demote the only viable super admin (other super admin disabled, another un-enrolled): refused `last_super_admin`, row unchanged, no `admin.demoted` row.
4. deactivate an admin: `disabled_at` set, sessions revoked, `admin.deactivated` carries the reason.
5. deactivate a super admin while another viable one exists: succeeds.
6. deactivate the last viable super admin: refused.
7. reactivate: `disabled_at` cleared, previously revoked sessions stay revoked, `admin.reactivated` written.
8. stale: `expectedRole` mismatch → refused `stale`, nothing written.
9. self: actor = target → refused `self`.
10. audit atomicity: run the mutation through `runLifecycleSteps` with a test hook that makes the audit INSERT fail (for example an `auditDetail` override containing a non-object payload, which `auth_audit_log_detail_is_object_ck` rejects) and assert the user row and its sessions are unchanged afterwards; as a second proof on the success path, assert `xmin` equality between the updated `auth_users` row and the new audit row, which shows they were written by one transaction.
11. historical attribution: insert a `data_edits`-style child (or simply an `auth_audit_log` row with `actor_user_id = target`) before deactivation and assert it still resolves afterwards, and that `DELETE FROM auth_users WHERE id = target` is refused by the FK (run inside a rolled-back transaction).
12. inactive cannot authenticate: after deactivation, the `adminLogin` predicate (`role IN (…) AND disabled_at IS NULL` by email) returns no row; and every session for the target has `revoked_at` set.

**Concurrency (required, same file):** two `postgres(testDbUrl, { max: 1 })` connections T1 and T2 plus an observer. The invariant counts the whole table, and the `_test` database retains durable fixture super admins (for example the email-intake fixture), so the race must be constructed so that it is decisive regardless of pre-existing rows: the observer first records the set of viable super admins that are not the test's own, and the test **temporarily deactivates none of them**; instead it proves the mechanism with the actor check (case 1) and proves the count with a target set that includes every pre-existing viable super admin (case 2, below), restoring nothing because nothing else is touched.

- Case 1 — mutual demotion: fixture super admins A and B. T1 runs "A demotes B" but pauses after the advisory lock and `FOR UPDATE` (the query module exposes its steps through an internal `runLifecycleSteps(tx, input, hooks)` used only by tests, or T1 issues the same statements by hand). T2 starts "B demotes A" as a full `applyLifecycleMutation(sql2, …)` and is proven blocked with `pg_blocking_pids(T2) ⊇ {T1}` (the existing `waitForBlock` idiom). T1 finishes and commits. T2 resumes and must refuse with `forbidden` (its actor B is now an admin); the observer asserts A is still a viable super admin and B is an admin, and that the total viable count never dropped below one.
- Case 2 — count under the lock: fixture super admin C as actor; targets are every other viable super admin (fixture A plus any pre-existing ones), deactivated one by one on T1 while T2 concurrently attempts the last one. With the observer proving T2 blocked on T1, the transaction that would leave zero viable super admins other than C must refuse `last_super_admin`; C itself is never a target (self is refused), so the table always keeps C. Everything deactivated by the test is reactivated in `afterEach` by id (this run's fixtures and any pre-existing account it deactivated, recorded by id), so a concurrent suite run is unaffected beyond a brief window that the email-intake suite already tolerates by re-checking its fixture.

If touching pre-existing fixture accounts is judged too intrusive for a shared `_test` database, case 2 may instead use `runLifecycleSteps` with a test-only `countScope` restricted to the test's own fixture ids, provided the production entry point has no such parameter; record that choice in the test header.

**Route/action authorisation:** covered by the action-level suite (contributor and admin cannot reach the actions; super admin can) and by the existing `requireSuperAdmin` behaviour; plus a direct-URL check in the browser pass that an admin session sees the page without lifecycle controls and a contributor is bounced to `/admin/upload`.

**Browser acceptance (bounded, manual via Playwright MCP against the local dev server as Phase A did; no new E2E suite):** desktop 1440×900 and mobile 375×812; role/status badges, `You` marker, created/last sign-in; super admin sees controls, admin does not; the last-super-admin refusal renders both as the disabled explanation and, by submitting from a second stale tab, as the server refusal; promote → demote → deactivate (typed email + reason) → reactivate on a dedicated test account; no horizontal overflow; no console/runtime errors. Precondition: at least two viable super admins exist on the dev database (preflight §26.16).

**Typecheck once** (`npm run typecheck`) after the route/type changes. No full suite, no build unless the implementation session finds a framework-level reason.

### 26.16 Deployment order and preflight

No migration, no privilege change, no environment change: a code-only deploy.

1. Merge-ready checks on the branch; `npm run merge:ready -- --issue 155`.
2. `deploy/sync-dev.ps1` (DEV); smoke: sign in as super admin, load `/admin/admins`, confirm badges/counts; sign in as an ordinary admin, confirm no lifecycle controls and own-session-only sign-out.
3. Old sessions need no invalidation at rollout: nothing about cookies or claims changes.
4. Prod only after the user has tested DEV (per the dev-before-prod rule).

**Implementation preflight (runtime facts not establishable by inspection):**

- P1. Count viable super admins on the dev database before the browser pass; create a second test super admin through the existing invite flow if there is only one.
- P2. Confirm nothing under `tools/` uses `pg_advisory_*` with the chosen key (a `Grep` for `advisory` across the repository at implementation start).
- P3. Confirm `tests/integration/privileges.test.ts` still asserts `afldb_auth` lacks `DELETE` on `auth_users` (read the spec at lines ~284–290) — it is the guard that keeps §26.4 true on the live cluster.
- P4. Confirm the `_test` database has the `auth_audit_log_detail_is_object_ck` constraint (migration 082 applied), since the integration suite writes object details.

### 26.17 Risks and stop conditions (Phase B)

- **Stop** if the implementation cannot keep the invariant count, the UPDATE, the session revoke and the audit INSERT in one `authSql.begin()` transaction (for example if a helper insists on the pool).
- **Stop** if any FK to `auth_users` must be altered, or if any path would DELETE an `auth_users` row.
- **Stop** if lifecycle actions would need a guard weaker than `requireSuperAdmin`, or if `can_manage_admins` would gain lifecycle power.
- **Do not** add an epoch/claim change, a second session store, or a migration in this phase.
- **Do not** modify the invite acceptance's `disabled_at = NULL` behaviour in this phase; it is recorded in §26.4 and can be revisited separately.
- **Risk:** the 5 s `statement_timeout` on `authSql` bounds lock waits; a burst of lifecycle actions could surface `conflict`. Acceptable for a rare administrative action; do not raise the timeout.
- **Risk:** the concurrency test needs a real two-connection race; if the test database is shared with a concurrent run, use unique fixture emails and per-run ids, never table-wide deletes.

### 26.18 Unresolved decisions

None that block implementation. Two optional refinements are left to the owner and default to "not in Phase B":

- whether to surface the deactivation reason on the card by reading the latest `admin.deactivated` audit row (default: no; the audit trail holds it);
- whether a UI to grant/revoke `can_manage_admins` on an existing account is wanted (default: no; it remains invite-only).

### 26.19 Handoff contract for the implementation session

**Session:** fresh; **model Opus, effort high**; worktree `D:\dev\afldb-issue-155`, branch `codex/issue-155-admin-overhaul`; follow `CLAUDE.md`; user runs all commands.

**Prompt:**

> Implement AFLDB-ISSUE-155 Phase B exactly as specified in `AFLDB-ISSUE-155.md` §26 (read §26 first, then §10 for intent; §26 governs). Phase A is complete and must not change behaviour. Do not create a migration; do not alter FKs, `privileges.sql`, guards in `session.ts`, the invite or password actions, or deployment files. Add `people.admins.lifecycle` to `capabilities.ts`; create `src/lib/auth/admin-lifecycle.ts` (pure), `src/db/queries/admin-users.ts` (`listAdminAccounts`, `applyLifecycleMutation(sql, …)` with the §26.7 sequence: advisory xact lock → `FOR UPDATE` actor+target → re-derived checks → compare-and-set UPDATE → revoke target sessions → `auditInTransaction`), `src/app/admin/admins/lifecycle-actions.ts` (four Server Actions behind `requireSuperAdmin`), `src/app/admin/admins/LifecycleControls.tsx`, and update `page.tsx`, `AdminSessionsClient.tsx` and `actions.ts` (`revokeSession` ownership rule) per §26.9–§26.10. Then write the tests in §26.15 (extend `tests/auth.test.ts`; new `tests/admin-lifecycle-actions.test.ts`; new `tests/integration/admin-lifecycle.test.ts` including the deterministic two-connection race), and give the user the focused commands in this order: `npm run test -- tests/auth.test.ts tests/admin-lifecycle-actions.test.ts`, then `npm run test -- tests/integration/admin-lifecycle.test.ts` (needs `AFLDB_TEST_DATABASE_URL`), then `npm run typecheck`, then the bounded browser pass of §26.15 after preflight P1. Record results in the ISSUE-155 entry in `issues.md`, update `IssuesIndex.md`, add an Unreleased `CHANGELOG.md` entry, and stop at the Phase B validation gate. Do not start Phase C.

### 26.20 Phase B implementation record and validation (2026-09-10)

Phase B is **implemented and validated**. AFLDB-ISSUE-155 as a whole remains open: Phases C-I are not started.

**Lifecycle operations delivered:** promote (admin to super admin), demote (super admin to admin, clearing `can_manage_admins`), deactivate (`disabled_at = now()`, typed-email plus reason) and reactivate (`disabled_at = NULL`). No hard-delete path exists anywhere in the phase; §26.4 is intact.

**Files.** New: `src/lib/auth/admin-lifecycle.ts` (pure eligibility/messages), `src/db/queries/admin-users.ts` (`listAdminAccounts`, `applyLifecycleMutation`), `src/app/admin/admins/lifecycle-actions.ts` (four Server Actions behind `requireSuperAdmin`), `src/app/admin/admins/LifecycleControls.tsx`, `tests/admin-lifecycle-actions.test.ts`, `tests/integration/admin-lifecycle.test.ts`. Modified: `src/lib/auth/capabilities.ts` (Phase A's table, gaining only `people.admins.lifecycle`), `src/app/admin/admins/page.tsx`, `src/app/admin/admins/AdminSessionsClient.tsx`, `src/app/admin/admins/actions.ts`, `tests/auth.test.ts`. No migration, no privilege change, no FK change, no deployment-file change.

**Validation evidence.**

| Gate | Command | Result |
|---|---|---|
| 1 + 2 - unit and Server Action | `npm run test -- tests/auth.test.ts tests/admin-lifecycle-actions.test.ts` | **98/98 passed** (67 + 31); re-run green after the UI corrections below |
| 3 + 4 - DB integration and deterministic concurrency | `npm run test -- tests/integration/admin-lifecycle.test.ts` | **17/17 passed** (16.5 s) against `afldb_test` |
| 5 - types | `npm run typecheck` | **passed** (`next typegen` + `tsc --noEmit`, no diagnostics) |
| 6 - browser acceptance | manual, DEV at `http://localhost:3100` | **passed**, desktop 1440x900 and mobile 375x812 (below) |

Gate 3 + 4 include, by name: the atomic mutation-plus-audit case; the audit-failure rollback case (role change and session revoke both rolled back); session revocation on every successful transition; a deactivated account that cannot sign in, holds no live session and is still refused by the delete guard; mutual demotion under the lock (the loser waits, re-reads its own row and refuses); and the concurrent-deactivation case proving the invariant is counted **under** the lock so the second call refuses.

**Advisory lock as implemented.** `pg_advisory_xact_lock(717275, 2)` - the two-argument namespaced form, not the bare literal §26.7 suggested. `717275` is `0xAF1DB`, the namespace already used by `HONOUR_TEAM_LOCK_NAMESPACE` in `src/db/queries/awards-admin.ts` and by `tools/migration/import_awards.py`; key `1` is honour-team identity and key `2` is this lifecycle lock. This also corrects §26.7's preflight statement that no other code under `src/` uses advisory locks - `awards-admin.ts` does, which is exactly why the namespaced key was chosen. The keys are frozen literals, never derived by hashing, because two implementations must contend on identical numbers.

**Browser acceptance - desktop (1440x900), signed in as a super admin.** The account list renders with role and Active/Deactivated status; the viewer's own row is marked "You"; the viewer's own card offers no lifecycle controls at all and says another super admin must change it, so self-demotion and self-deactivation are unavailable rather than merely refused. A full round trip was exercised on `e2e-plain-admin@afldb.test`: promote, demote, deactivate (typed email plus reason), reactivate - each confirmed in `auth_users` and in `auth_audit_log`. The pass wrote `auth_audit_log` rows **771-785** on the dev database, every one of them against that single test account: fourteen committed transitions (the round trip was repeated to verify the UI corrections below, and again at mobile width) and one refusal, row 782, `admin.lifecycle_refused` with `code: stale`. Each committed row carries `before`, `after`, `expected`, `targetEmail`, `targetUserId` and `revokedSessions`. The mismatched-typed-email refusal is deliberately not among them: `invalid` says nothing about a real account and is excluded from the audited refusal set. The last row leaves the account exactly as the pass found it, and the trail is history - it stays. Two refusal paths were exercised from the browser: a mismatched typed email ("Type the account's email exactly to confirm.", nothing written), and a genuinely stale second tab whose promote submitted an `expectedRole` the row no longer had - refused with "This account changed since the page loaded. Reload and try again." plus the reload link, written to the trail as `admin.lifecycle_refused` `code: stale` with no mutation. Every account was returned to its starting state; the four viable super admins present at preflight P1 were the same four at the end.

**Browser acceptance - mobile (375x812).** The admin menu still collapses and expands (Phase A behaviour intact). The lifecycle controls and the deactivation form fit inside the viewport (form right edge 328 px against a 360 px content width; no part of it overflows) and a promote/demote round trip works at that width with visible confirmation. One narrow-viewport observation, **not** caused by the new controls: the page's own scroll width is 366 px against 360 px of content width, a 6 px horizontal overflow that comes entirely from the card *summary* - hiding `.table-details-note` removes it exactly (366 to 360). `details.table-details > summary` is a shared `display: flex; flex-wrap: nowrap` row, so a long email title plus its note cannot shrink at that width. The lifecycle controls live in the card body and are not implicated. A one-line `flex-wrap: wrap` on that shared rule is the obvious candidate, but it changes every collapsible table on the site and was left for the owner rather than taken inside Phase B.

**Runtime.** Zero console errors and zero warnings on a clean load of the final code, at both widths. No failed lifecycle POST: every refusal was an ordinary application result, never an error response.

**Not verifiable in this browser pass** (no plain-admin credentials were available, and manufacturing them was out of scope): the negative path where an ordinary or `can_manage_admins` admin sees no lifecycle controls, and the broader super-admin session-management view. Both are enforced twice and covered by the green gates - `AdminSessionsClient` builds a lifecycle actor only for `viewer.role === 'super_admin'`, so a non-super-admin renders no controls, and each Server Action calls `requireSuperAdmin()` for itself regardless of what the form carries. The last-viable-super-admin refusal was likewise not forced through the UI: the dev database holds four viable super admins, and reducing it to one to watch a button disable itself was not a safe trade. It is proven transactionally by the two concurrency cases and the two "refuses the last viable super admin" integration cases.

**Deviations from §26, and why.**

1. **Namespaced advisory key** (above) instead of a bare literal - collision-safe, matches the existing AFLDB convention, and corrects a §26.7 factual claim.
2. **Lifecycle results are held by the list, not by the control that produced them** (`AdminSessionsClient` owns `{ accountId, state }`; `LifecycleControls` renders it from a prop and reports settled results upward). §26.9 requires the per-account `error`/`message` to show next to the row. The first implementation held each result inside its own control, and browser acceptance showed that no success message was ever visible: a successful mutation revalidates the page, which swaps the submitting control for the next one (promote for demote, deactivate for reactivate) and, for deactivate/reactivate, moves the whole card between the active and deactivated lists and remounts it. The confirmation was discarded by the same commit that produced it. Refusals were unaffected and were visible throughout. Held above both lists, all four confirmations now render.
3. **A deactivated card stays open while it holds a result.** Deactivated cards are filed away collapsed (`defaultOpen={active}`); the card just acted on would otherwise fold its own confirmation out of sight.
4. **The deactivation `reason` and `confirmEmail` inputs are controlled.** React resets an uncontrolled form once its action returns, so the mismatched-email refusal cleared the reason the super admin had already written and required both fields to be retyped in order to correct one. §26's UI guidance asks for entered form data to survive a refusal.

Deviations 2-4 are UI-layer only: no Server Action signature, transaction, guard, audit shape or SQL statement changed, and the 98/98 unit and Server Action gate was re-run green afterwards.

**Working-tree artefacts from the browser pass (scratch, not deliverables).** The Playwright tooling writes into the repository: `.playwright-mcp/` (63 files, ~845 KB - 49 `page-*.yml` accessibility snapshots and 14 `console-*.log` files, 18 of them predating this session's work) and one stray `stale-tab.yml` at the repository root, written when a snapshot was given an explicit filename. Neither path is in `.gitignore`, so both appear as untracked in `git status`; neither belongs in a commit. Remove with `rm -r .playwright-mcp stale-tab.yml`. A separate empty `Implement` file at the repository root also predates this session and is not part of Phase B.

**Follow-up noted, not actioned:** preflight P3 found that the privilege suite positively asserts `afldb_auth` access to `auth_users` but carries no explicit negative assertion for `DELETE ON auth_users`. Phase B adds no delete path, changes no grants and touches no migration, so this is not a Phase B defect - it is a hardening assertion worth adding when the privilege suite is next edited.

## 27. Phase C — Brownlow administration: implementation-ready plan

Planned 2026-09-10 by native repository inspection only (no commands, no database access, no source edits). Every "confirmed" statement below was read from the current worktree at `codex/issue-155-admin-overhaul` with Phases A and B applied. Anything only establishable at runtime is a numbered preflight in §27.20. This section is the implementation contract for Phase C; §8 remains the product intent and §27 governs where they differ. Phase A/B architecture (capability table, `requireCapability`, transactional audit, advisory-lock namespace `717275`) is settled and is reused, not reopened.

### 27.1 Confirmed current Brownlow data model

Brownlow is stored in **three grains plus two derived copies**. None of them carries a match identifier today.

| Relation | Grain / key | Coverage | Columns that matter | Writers today |
|---|---|---|---|---|
| `brownlow_season_votes` (005) | one row per `(season, player_id)`, `brownlow_season_uq` | 1924–2025 except 1942–1945; rows only for players who polled (0-vote rows: preflight P4) | `votes`, `vote_rank`, `eligible_rank`, `is_ineligible`, `is_winner`, `games`, `three/two/one_vote_games`, `polling_games`, `link_status_value`, `source_id`, `source_record_id`, `import_batch_id` (nullable), `club_id` (unpopulated) | `tools/migration/import_brownlow_season.py` only: `TRUNCATE ONLY brownlow_season_votes` then COPY of the tracked artefact, refused unless the post-write measurement equals the manifest and the declared season set equals the decided seasons in the database (`check_database_coverage`). Declared **AUTHORITATIVE** for season and career totals by 005, 007, 015, `db-health.ts` and `tests/integration/release-gates.test.ts` ("gate: Brownlow authority"). |
| `brownlow_round_votes` (005; provenance quartet added by 083) | one row per `(season, player_id, round_number)`, `brownlow_round_uq`; `played boolean NOT NULL`; `votes` 0–3 nullable; `source_id`, `source_record_id`, `import_batch_id`, `imported_at` | 1984–2025; rows exist only where the source published a vote (a published 0 is a row; NA is never a row); finals never | **no `match_id`, no club** | (a) `tools/migration/import_fitzroy_core.py::import_brownlow_round_votes` — rebuild path, `DELETE … WHERE season = ANY(snapshot seasons)` then COPY, **writes no `source_id`** (five columns only), derived 1:1 from per-match votes because a player plays once per H&A round; (b) `src/lib/acquisition/canonical-apply.ts::writeBrownlowRoundVotes` — the settle applier, `afltables` source, ownership-gated: an `unowned` (NULL `source_id`) or `foreign` (other `source_id`) row is refused and never adopted (`ownershipOf`, settle tests "refuses a foreign-owned canonical row"). |
| `player_match_stats.brownlow_votes` (004) | per player per match, `pms_player_match_uq (player_id, match_id)`, CHECK 0–3 | 1931–1934 and 1984–2025, partial even inside that window ("never sum this for career totals") | one column on the lineup row | fitzRoy core rebuild; **`src/db/queries/match-sheet.ts::saveMatchSheet`** (generic match sheet, Super Admin, validates blank-or-exact-3/2/1 in `src/lib/match-sheet.ts`, refuses finals and seasons whose `stat_availability.brownlow_match_votes` coverage is not complete/partial, then upserts the column); `src/lib/ingest/datasets.ts` (legacy `player_match_stats` upload dataset). The settle deliberately never writes this column. |
| `player_season_stats.brownlow_votes` + `brownlow_status` (015) | derived, `(player_id, season)`; `pss_brownlow_grain_ck` | — | `complete` ⇒ votes 0..n; `pending`/`not_applicable` ⇒ NULL | `recomputeSeasonBrownlowStatus(tx, season)` and `recomputePlayerDerivedStats(tx, ids, season)` in `src/db/queries/player-derived.ts`; `tools/migration/rebuild_derived.py`. All read `brownlow_season_votes` only. |
| `player_career_stats.brownlow_votes`, `brownlow_medals` (007) | derived, per player | — | sum of `brownlow_season_votes.votes`, count of `is_winner` | `recomputePlayerDerivedStats` (both the playing-record insert and the no-match-history insert); `rebuild_derived.py`. `db-health.ts::reconcileCareerTotals` asserts career = sum(bsv). |
| `stat_availability` rows for `brownlow_match_votes`, `brownlow_round_votes`, `brownlow_season_total` (015/016) | per season per grain, `coverage_status` enum | — | complete / partial / not_collected / not_applicable / pending | migration 016 and `import_legacy_afl.py` recompute them from the loaded data (match grain: an H&A match is "complete" when its `player_match_stats.brownlow_votes` sum to 6). `saveMatchSheet` and the fitzRoy loader read them as the coverage authority. |

**Match identity available today.** `matches` (003, 084, 085): `id`, `match_key text NOT NULL UNIQUE` (`season|round|date|home|away`), `season`, `round_code`, `round_number` (NOT NULL iff `round_type = 'home_and_away'`), `round_type` enum (`home_and_away`, `wildcard_final`, `elimination_final`, …, `grand_final`), `is_final` (= `round_type <> 'home_and_away'`; the Wildcard Final is `is_final = true` and is not polled — 084/085 name Brownlow scoping as a consumer of `is_final`), `is_finals_series`, `match_date`, `venue_id/venue_raw`, `home_club_id`, `away_club_id`. A Brownlow-eligible match is exactly `round_type = 'home_and_away'`.

**Participants today.** The canonical line-up is `player_match_stats` rows for the match (`getMatchPlayers` in `src/db/queries/matches.ts`; the match sheet writes the same rows). There is no separate lineup table for canonical seasons; `staging.afl_api_lineups` (077) is staging only. The settle writes `player_match_stats` for completed current-season matches, so current-season participants exist once a match is settled.

**Player identity.** Every Brownlow row uses `players.id` as a hard FK; no name matching anywhere in the Brownlow path (`import_brownlow_season.py::ProfileResolver` is fail-closed by profile URL).

**Audit and provenance infrastructure.** `data_edits` (057/058): append-only, `table_name` CHECK allowlist `('players','matches','draft_picks','award_winners','hall_of_fame','honour_team_members')`, `row_id > 0`, `field_group`, `old_values`/`new_values` jsonb, `admin_user_id NOT NULL` FK `auth_users`, `note ≤ 2000`; written by `recordDataEdit(tx, …)` (`src/db/queries/audit-log.ts`) inside the import-role transaction so a failed audit rolls the edit back. Source `manual_admin_edit` exists (057). `data_overrides` (073) `entity_type` CHECK is `('players','matches','draft_picks')` and **`src/lib/acquisition/manual-authority.ts` pins that exact list as a proof** that `brownlow_round_votes` overrides are unrepresentable; widening it would flip the settle's manual-authority answer from `clear` to `indeterminate` (§22 "Override constraint drift"). Phase C therefore must **not** touch `data_overrides`.

**Write connection pattern.** Every manual statistical write (`match-sheet.ts`, `data-edits.ts`, `match-admin.ts`, `awards-admin.ts`) opens a short-lived `postgres(process.env.AFLDB_IMPORT_DATABASE_URL, { max: 1 })` and runs one `importSql.begin()` transaction; reads use the `afldb_app` pool (`sql` from `@/db/client`). `afldb_auth` holds no statistical writes. `afldb_import` already inserts `data_edits` and rows with `auth_users` FKs.

**Public consumers.** `/brownlow` (force-dynamic; winners, career leaders, multiple winners — all from `brownlow_season_votes` / `player_career_stats`); `/brownlow/[year]` (ISR 3600, prerendered; `brownlow_season_votes`); `/seasons/[year]` (ISR 3600; `getSeasonBrownlow` from `brownlow_season_votes` and `getSeasonRoundVotes` from `brownlow_round_votes`, club resolved through `player_match_stats` by season/round); `/players/[slug]` (ISR 3600; `player_season_stats`/`player_career_stats`); `/clubs/[slug]` (ISR 86400; club honours); `/clubs/compare` (force-dynamic; per-match `player_match_stats.brownlow_votes` analytics); `/matches/[id]` (ISR 3600; `player_match_stats.brownlow_votes`); `/records/[category]` (ISR 3600; `most-brownlow-votes` from career); advanced search, NL, query builder and Grid Solver (career column; NL `player_game` grain reads `player_match_stats.brownlow_votes`).

**Existing tests.** `tests/match-sheet.test.ts` (3/2/1 payload validation), `tests/integration/data-editor.test.ts` T6/T6b (Wildcard Final refusal, nothing written), `tests/admin-match-mutations.test.ts` (source contract: `match-admin.ts`/`data-edits.ts` never mutate either Brownlow table and call `recomputeSeasonBrownlowStatus`), `tests/integration/release-gates.test.ts` ("gate: Brownlow authority", "gate: Brownlow coverage semantics", 2026 pending-never-zero), `tests/integration/settle-afltables.test.ts` (round-grain write, foreign/unowned refusal, no season total from a partial set), `tests/brownlow-season-artefact.test.ts`, `tests/fitzroy-core-import.test.ts`, `tests/integration/privileges.test.ts`, `tests/integration/database.test.ts`. Concurrency idiom: `tests/integration/admin-lifecycle.test.ts` and `player-link-concurrency.test.ts` (two `max: 1` connections, `pg_blocking_pids` polling).

### 27.2 Current source/writer inventory and classification

| Writer | Target | Phase C classification |
|---|---|---|
| `import_brownlow_season.py` (artefact loader) | `brownlow_season_votes` (truncate + copy) | **Retain as the historical source loader; make it manual-aware and fail-closed** (§27.11). Never run by the web app. |
| `import_fitzroy_core.py::import_brownlow_round_votes` (rebuild) | `brownlow_round_votes` season-scoped delete + copy, no `source_id` | **Retain for rebuilds; refuse to delete manual-owned rows** (§27.11). |
| `canonical-apply.ts::writeBrownlowRoundVotes` (settle) | `brownlow_round_votes`, `afltables`-owned rows only | **Retain unchanged.** Its ownership gate already refuses `manual_admin_edit` rows. It never sets `match_id`; Phase C's read model resolves the match for unowned/afltables rows by `(season, round_number, player)` through `player_match_stats` (§27.5) and the migration backfill sets it. |
| `match-sheet.ts::saveMatchSheet` (generic Data Editor match sheet) | `player_match_stats.brownlow_votes` | **Redirect: the write is removed.** A submitted non-null `brownlowVotes` is refused with an error naming Brownlow administration; the upsert no longer lists the column so existing values are preserved (§27.15). |
| `src/lib/ingest/datasets.ts` `player_match_stats` dataset | `player_match_stats.brownlow_votes` | **Compatibility/import-only, unchanged.** It is a registered legacy intake dataset (Phase H decides its retirement). Recorded, not modified. |
| `recomputePlayerDerivedStats`, `recomputeSeasonBrownlowStatus`, `rebuild_derived.py` | derived `player_season_stats`, `player_career_stats` | **Retain; extend** with one narrow Brownlow-only career helper (§27.10). |
| `awards-admin.ts` | refuses Brownlow winners in `award_winners` | Retain unchanged. |
| **New** `src/db/queries/admin-brownlow.ts` | `brownlow_vote_entry_state`, `brownlow_season_authority`, `brownlow_round_votes` (manual rows), `player_match_stats.brownlow_votes` (mirror), `brownlow_season_votes` (manual season rows), derived totals, `stat_availability`, `data_edits` | **The only application writer of Brownlow facts.** |

### 27.3 Canonical source-of-truth decision (binding)

1. **The canonical Brownlow fact is the match-level vote assignment**: one `brownlow_round_votes` row per `(match_id, player_id)` with `votes ∈ {1,2,3}` and `match_id` set. The existing round-grain key `(season, player_id, round_number)` is preserved because it is equivalent to the match grain for home-and-away football (one match per player per round) and because two importers own it.
2. **Season totals are derived from those facts** for every season the workflow publishes: `brownlow_season_votes` rows for an admin-published season carry `source_id = manual_admin_edit` and are recomputed only by the publish/correction transaction.
3. **Compatibility state, explicit:** for a season whose `brownlow_season_votes` rows come from the artefact (`source_id ≠ manual_admin_edit`) the season total remains **source-published** and authoritative for public totals, whatever the state of match-grain attribution. This is how AFLDB represents "known total, incomplete match attribution": artefact season rows plus zero-or-more match facts, with the per-player difference between the two surfaced in the admin season view and never applied automatically. Nothing is destroyed to reach this state.
4. **`player_match_stats.brownlow_votes` becomes a mirror**, written only by the Brownlow transaction for finalised matches (3/2/1 on the three players, 0 on every other participant of that match, because a finalised match is a declared-complete coverage set — §5) and never by any other application path. Existing historical values stay as they are.
5. **`player_season_stats` and `player_career_stats` remain derived** from `brownlow_season_votes`, exactly as today; the only change is that the Brownlow transaction refreshes them for the affected players in the same transaction.
6. **Existing violations of this model** (removed or restricted by Phase C): the generic match sheet's ability to write per-match votes (§27.15); the absence of a match identifier on the round facts (§27.5); the artefact loader's blind truncate (§27.11).
7. **No independent manually maintained total exists after Phase C.** The publish transaction is the only writer of a manual `brownlow_season_votes` row, and it always derives from the complete finalised match set.

### 27.4 Historical-data classification

Computed at read time per season (no stored classification), from `stat_availability` and the tables above:

| Class | Seasons (expected) | Admin behaviour |
|---|---|---|
| **No medal** (`brownlow_season_total` = `not_applicable`) | 1897–1923, 1942–1945 | Season not listed for entry; every mutation refuses `season_not_polled`. |
| **Source-published, match grain complete or partial** | 1984–2025 (round rows from fitzRoy/settle; match grain mostly complete, `brownlow_match_votes` complete/partial) | Listed. Matches whose backfilled rows sum to 6 show as `imported`; Super Admin may correct any match (creates a manual entry) and may re-publish the season from match grain. Ordinary entry is not required. |
| **Source-published, match grain absent** | 1924–1934 with partial 1931–1934 `player_match_stats` votes, 1935–1983 none | Listed. Entry permitted (Admin drafts, Super Admin finalises). The artefact total stands until every H&A match is finalised and the Super Admin publishes. 1931–1934 `player_match_stats` values are **not** backfilled into round rows (they are partial and the coverage authority already says so); the editor shows them as a hint only. |
| **Current season, pending** (`seasons.status = 'in_progress'`, `brownlow_season_total` = `pending`) | 2026 | Listed. Entry as above once votes are known (§27.19). Publication allowed when every expected H&A match is complete, without waiting for `seasons.status = 'complete'`. |

The migration fabricates no match-grain precision: backfill sets `match_id` only where the round fact resolves to exactly one match through the player's own `player_match_stats` row (§27.5); it never creates vote rows, zero rows or season rows.

### 27.5 Match identity and backfill decision

**Decision:** add `match_id integer NULL REFERENCES matches(id) ON DELETE SET NULL` to `brownlow_round_votes`. Backfill deterministically; leave the unresolved NULL; enforce the match-grain invariants with partial unique indexes that ignore NULL `match_id`.

**Backfill statement (inside the migration, before the indexes):**

```sql
UPDATE brownlow_round_votes rv
   SET match_id = r.match_id
  FROM (
    SELECT rv2.id,
           (array_agg(m.id))[1] AS match_id,
           count(DISTINCT m.id)  AS candidates
      FROM brownlow_round_votes rv2
      JOIN matches m
        ON m.season = rv2.season
       AND m.round_type = 'home_and_away'
       AND m.round_number = rv2.round_number
      JOIN player_match_stats pms
        ON pms.match_id = m.id AND pms.player_id = rv2.player_id
     WHERE rv2.match_id IS NULL
     GROUP BY rv2.id
  ) r
 WHERE r.id = rv.id AND r.candidates = 1;
```

A row with zero candidates (no line-up row: the coverage gap `rounds.ts` already documents) or more than one (a data defect) stays NULL and is counted by preflight P2 and by the admin season view as `unresolved`. Fuzzy matching by name, date or club is never used; the only key is the player's own canonical line-up row in that season/round.

**Constraints after backfill** (all partial on `match_id IS NOT NULL`, so unresolved history is untouched):

- `ux_brownlow_round_votes_match_player UNIQUE (match_id, player_id)`;
- `ux_brownlow_round_votes_match_value UNIQUE (match_id, votes) WHERE match_id IS NOT NULL AND votes > 0` — at most one 3, one 2 and one 1 per match, enforced by the database;
- `ix_brownlow_round_votes_match ON brownlow_round_votes (match_id) WHERE match_id IS NOT NULL` — the FK's own index (the migration-041 rule `tests/integration/fk-indexes.test.ts` enforces).

Preflight P3 must return zero before the migration is applied; the runner is transactional, so a violation aborts the whole migration with nothing applied. A non-zero P3 is a **hard stop** (§27.22): the source data has two players on one vote value in one match, and that is evidence to repair, not a constraint to weaken.

**Consistency rule** (transaction-checked, not a trigger): a manual row's `match_id` must satisfy `matches.season = rv.season AND matches.round_number = rv.round_number AND round_type = 'home_and_away'`. `ON DELETE SET NULL` keeps the round fact when a match is deleted (facts are never destroyed); the workflow row (§27.16) restricts the delete instead.

### 27.6 Participant eligibility contract

- **Participants of a match** = `SELECT player_id, club_id, jumper_number FROM player_match_stats WHERE match_id = $1` — the same canonical line-up the public match page and the match sheet use. Nothing else (no staging lineups, no `player_clubs`, no free text).
- **Complete participant set** = both `home_club_id` and `away_club_id` have **at least 18** line-up rows for the match (the smallest side any VFL/AFL era fielded; preflight P8 confirms no legitimate H&A match falls under it, and if it does the threshold is lowered to the measured minimum, never removed).
- Draft saves accept only players in the participant set, whatever its completeness. **Finalisation, correction and adoption of imported rows require a complete participant set**; otherwise the mutation refuses `participants_incomplete` and the UI shows a blocked state with the counts per club and a link to the match sheet (Super Admin) where line-ups are repaired. There is no operator override inside the Brownlow workflow.
- Substitutes/interchange: every player with a line-up row is eligible (an unused substitute has no row unless the source recorded one; that is the line-up's decision, not Brownlow's).
- Identity: `players.id` only. A line-up row whose player is later merged/relinked is the player-links subsystem's concern; the Brownlow transaction re-reads participants under the match lock at commit time, so a stale participant list in the browser is refused as `not_participant`.

### 27.7 Draft / final / correction state machine

Per match, in `brownlow_vote_entry_state` (§27.16):

| State | Meaning | Public effect |
|---|---|---|
| (no row) + no positive round rows | not entered | none |
| (no row) + imported rows with `match_id` summing to 6 (`imported`) or to another positive total (`imported_partial`) | source-published match fact | already public (round votes on the season page, mirror on the match page where the source loaded it) |
| `draft` | 0–3 distinct participants selected; saved by Admin or Super Admin | **none** — drafts never reach any public query |
| `final` | exactly 3 distinct participants; canonical rows written | round facts and match mirror public; season total only after publication |
| `void` | Super Admin declared "no votes awarded for this match" with a reason (exists for the exception case preflight P7 may reveal; counts as complete for season completeness; writes no vote rows and clears the mirror to NULL) | none |

Transitions and who may perform them:

| From → to | Action | Capability | Notes |
|---|---|---|---|
| none/imported/draft → draft | `saveDraft` | `data.brownlow.draft` | duplicates and non-participants refused even in draft; CAS on `revision` |
| none/imported/draft → final | `finaliseMatch` | `data.brownlow.finalise` | requires complete 3/2/1, complete participants, CAS on `revision` **and** on the canonical fingerprint (§27.14) |
| final → final (new values) | `correctMatch` | `data.brownlow.finalise` | reason required (3–500 chars); direct authoritative update with the full before/after in `data_edits`; no revision history table |
| final/imported → void, void → final | `voidMatch` / `finaliseMatch` | `data.brownlow.finalise` | reason required |
| final → draft | **not available** | — | a finalised match is corrected, never reopened into a public-invisible state; "reopen" in the UI is `correctMatch` with the current values preloaded |

Answers to the §8 questions: a finalised match **can** be changed, by a Super Admin only, as a direct update with reason and audit; correcting a match in an admin-published season **re-derives the season in the same transaction** (§27.10), so the public totals never enter a "published but unreconciled" state; correcting a match in a **source-published** season leaves the artefact total untouched and shows the resulting disagreement until the Super Admin publishes from match grain; public totals change only at publication or at a correction of an already-published season; season publication is a separate Super Admin transaction (§27.9); partial data cannot masquerade as complete because publication requires every expected H&A match to be complete and derives from nothing else.

### 27.8 Capability matrix (Decision 1 of §25 adopted as Option A)

Add three members to `Capability` and `CAPABILITY_ROLES` in `src/lib/auth/capabilities.ts`; `hasCapability` needs no special case:

```ts
| 'data.brownlow.read'
| 'data.brownlow.draft'
| 'data.brownlow.finalise'
…
'data.brownlow.read':     ADMIN_AND_UP,
'data.brownlow.draft':    ADMIN_AND_UP,
'data.brownlow.finalise': SUPER_ADMIN_ONLY,
```

| Operation | Contributor | Admin | Super Admin | Server guard |
|---|---|---|---|---|
| See Brownlow in the Data nav; open season/round pages | No (bounced to upload) | Yes | Yes | page: `requireCapability('data.brownlow.read')` |
| Save/clear a draft; adopt imported values into a draft | No | Yes | Yes | action: `requireCapability('data.brownlow.draft')` |
| Finalise, correct, void a match | No | **No** | Yes | action: `requireCapability('data.brownlow.finalise')` — resolves to super_admin only |
| Publish / re-publish a season; set ineligibility | No | **No** | Yes | same |
| See the Publish panel and Finalise/Correct controls | — | rendered disabled with the reason "Super Admin only" | rendered | UI only; the guard above is the boundary |
| Edit `player_match_stats.brownlow_votes` through the match sheet | No | No | **No** (removed) | `saveMatchSheet` refuses |

`can_manage_admins` is irrelevant here and grants nothing. Every Server Action calls its guard itself; the capability entries describe those guards, as in Phases A/B.

### 27.9 Season completeness and publication model

Read-model per season (`getBrownlowSeasonOverview(season)`), all counts over `matches WHERE season = $1 AND round_type = 'home_and_away'`:

- `expected` = H&A match count; `final`, `draft`, `void` = entry-state counts; `imported` = matches without an entry row whose round rows (`match_id` set) sum to 6 with three distinct positive values; `importedPartial` = positive sum ≠ 6; `notEntered` = the remainder; `unresolved` = round rows in the season with `match_id IS NULL`; `participantsIncomplete` = H&A matches failing §27.6.
- `complete` = `final + void + imported == expected`.
- `authority` = `none` (no `brownlow_season_votes` rows), `source` (rows with `source_id ≠ manual_admin_edit`), `manual` (rows with `source_id = manual_admin_edit`); `publishedRevision`, `revision` from `brownlow_season_authority`; `stale = authority = 'manual' AND publishedRevision <> revision` (defensive; a new match created in a published season is the case that produces it).
- Season status label: `not_polled` | `not_started` | `in_progress` | `entered` (complete, authority ≠ manual) | `published` (authority = manual, not stale) | `published_stale` | `source_published` (authority = source, entry not complete or not started).
- **Disagreement report** (source-published seasons): per player, `sum(votes)` over resolved round rows vs `brownlow_season_votes.votes`; shown, never applied.

**Publication** (`publishSeason`, Super Admin) requires `complete = true` and `unresolved = 0`, takes `ineligiblePlayerIds[]` (validated against the polled set; prefilled from the current `brownlow_season_votes.is_ineligible` flags whatever their source) and `expectedRevision`, and writes the derived rows (§27.10). Publication is idempotent for identical inputs (re-publish produces identical rows and a new revision; allowed). There is no "unpublish": reversal is a correction plus re-publish, or an operator artefact reload (which the loader refuses for manual seasons, §27.11).

### 27.10 Reconciliation and derived-total model

One helper family in `src/db/queries/admin-brownlow.ts`, called only from the Brownlow transactions, all on the same `tx`:

1. `writeMatchFacts(tx, match, selection, actor, revision)` — for the three players: upsert `brownlow_round_votes (season, player_id, round_number, match_id, played = true, votes, source_id = manual, source_record_id = 'entry:<match_id>:r<revision>', import_batch_id = NULL, imported_at = now())` on `(season, player_id, round_number)`; delete every other row for that match (`match_id = $1`) **and** every unresolved row for the match's `(season, round_number)` whose player is a participant of this match (re-attributing and superseding the stale row; the old values go into the audit); set `player_match_stats.brownlow_votes` = 3/2/1/0 across the match's participants. For `void`: delete positive rows for the match, mirror to NULL.
2. `deriveSeasonRows(tx, season, ineligibleIds)` — from resolved round rows of the season: per player `votes = sum`, `three/two/one_vote_games` = counts by value **stored NULL when the count is zero** (§27.29 P13(j): the artefact's own representation; read them with `COALESCE(col, 0)`), `polling_games` = count of positive rows (always populated), `games` = `player_season_stats.games - player_season_stats.finals` for that player and season (§27.29 P13(i) settles this over the alternatives), `vote_rank = rank() OVER (ORDER BY votes DESC)`, `eligible_rank` = same over eligible players, `is_winner = NOT is_ineligible AND eligible_rank = 1` (ties are multiple winners), `link_status_value = 'unique'`, `source_id = manual`, `source_record_id = 'publish:<season>:r<revision>'`. Rows only for `votes > 0`. Replaces all rows for the season (`DELETE WHERE season = $1` then insert). Preserves `is_ineligible` per the submitted set.
3. `recomputeSeasonBrownlowStatus(tx, season)` (existing) — refreshes `player_season_stats` for the season.
4. `recomputeBrownlowCareerTotals(tx, playerIds)` (**new**, `player-derived.ts`, kept in lockstep with `rebuild_derived.py` and the existing `brownlow` CTE) — `UPDATE player_career_stats SET brownlow_votes = COALESCE(sum, 0), brownlow_medals = COALESCE(count winners, 0)` for the union of players in the old and new season rows. This is deliberately narrower than `recomputePlayerDerivedStats` (which rebuilds playing records the Brownlow change did not touch).
5. `recomputeBrownlowCoverage(tx, season)` (**new**) — the migration-016 `resolved` CTE restricted to one season, upserting the three `stat_availability` rows. Called after every finalise/void/correct (match grain) and publish (all three grains).

`db-health.ts::reconcileCareerTotals` remains the independent drift check and is the post-deploy validation (§27.21). No other path may write any of these tables for Brownlow purposes; `tests/admin-match-mutations.test.ts` is extended to assert that `admin-brownlow.ts` is the only file under `src/db/queries` and `src/app` containing an INSERT/UPDATE/DELETE against `brownlow_round_votes` or `brownlow_season_votes`.

### 27.11 Importer / reload precedence

Precedence, highest first: **admin-finalised manual fact** → **settle-imported (afltables) fact** → **rebuild-loaded historical fact** → nothing. Concretely:

- **Settle (`canonical-apply.ts`)**: already refuses to update a `manual_admin_edit`-owned row (foreign ownership) and never inserts over an existing key; a manual row therefore survives every settle. Rows the settle inserts for a match that already has a manual entry cannot exist (the manual finalisation deleted or claimed every round row for that match; a later settle proposal for the same `(season, player, round)` finds the manual row and refuses). No change.
- **Artefact loader (`import_brownlow_season.py`)**: extend `check_database_coverage` to refuse when `brownlow_season_votes` holds any `source_id = manual_admin_edit` row ("season(s) <list> are admin-published; reload refused. Correct them through Brownlow administration or delete the manual rows deliberately first."). Fail closed, never silent. The existing "declared = decided seasons" check already refuses a manifest that omits a manually published new season; this makes the overlap case explicit too.
- **fitzRoy rebuild loader (`import_fitzroy_core.py::import_brownlow_round_votes`)**: before the season-scoped `DELETE`, refuse if any row in those seasons carries `source_id = manual_admin_edit` (same message shape). A rebuild database is empty of manual rows, so rebuilds are unaffected; a live database with manual rows is protected.
- **Promotion/restore pipelines** (ISSUE-139/151 lineage remap) must carry the two new tables and the manual-owned rows of the two existing tables. That is an operator follow-up outside Phase C and is listed as a stop condition for running a promotion after Phase C is live (§27.22).
- **Imported rows on entry**: the match editor initialises from existing round rows (resolved or backfilled); "Adopt" copies them into a draft (Admin) or straight into a finalisation (Super Admin). Finalisation over imported rows claims them (rewrites provenance to manual with the old values audited). A settle that lands new imported values between page load and submit is caught by the canonical fingerprint CAS (§27.14).

### 27.12 Provenance model

Reuse the existing quartet; add no parallel framework.

| Fact | Where provenance lives |
|---|---|
| Match-level vote row | `brownlow_round_votes.source_id/source_record_id/import_batch_id/imported_at` (083 quartet); manual rows: `manual_admin_edit`, `entry:<match_id>:r<revision>`, NULL batch |
| Who entered/finalised, when, last reason | `brownlow_vote_entry_state.created_by/created_at/updated_by/updated_at/finalised_by/finalised_at/last_reason` (auth user FKs, as `data_edits` already does) |
| Season total row | `brownlow_season_votes.source_id/source_record_id/import_batch_id`; manual: `manual_admin_edit`, `publish:<season>:r<revision>` |
| Who published, when, revision | `brownlow_season_authority` |
| Correction history (before/after, actor, reason, time) | `data_edits` rows (§27.13) — the append-only history; no per-row revision table |
| Upstream source reference | retained on imported rows; an adopted-then-finalised row records the superseded imported values in its `data_edits.old_values` |

### 27.13 Audit model

All required audit is `recordDataEdit(tx, …)` inside the import-role transaction (migration-066 discipline: audit failure rolls the fact back). Migration widens `data_edits_table_name_check` (058 pattern) with `'brownlow_vote_entry_state'` and `'brownlow_season_authority'`.

| Event | `table_name` / `row_id` | `field_group` | `old_values` → `new_values` (jsonb) | `note` |
|---|---|---|---|---|
| draft created / changed / cleared | `brownlow_vote_entry_state` / `match_id` | `draft` | `{status, three, two, one, revision}` → same shape | optional |
| match finalised (incl. adoption) | same | `finalise` | `{status, three, two, one, revision, canonicalRows:[{playerId, votes, sourceId}]}` → same | optional |
| finalised match corrected | same | `correct` | same shape | **reason (required)** |
| match voided / un-voided | same | `void` | same | reason (required) |
| season published / re-published | `brownlow_season_authority` / `season` | `publish` | `{revision, authority, rowCount, votesTotal, winners:[playerId], ineligible:[playerId]}` → same | optional |
| correction that re-derived a published season | second `data_edits` row on `brownlow_season_authority` in the same transaction | `republish` | as above | copied reason |

Every row carries `admin_user_id` (actor). Refusals `stale`, `forbidden`, `already_final` are additionally written to `auth_audit_log` via `audit('admin.brownlow_refused', {...})` after the failed call, mirroring Phase B; `invalid`/`not_found` are not audited.

### 27.14 Stale-edit and concurrency strategy

- **Revision CAS.** `brownlow_vote_entry_state.revision` (monotonic). Every mutation carries `expectedRevision` (0 = "no row existed when the page rendered"). Inside the transaction, after `SELECT … FROM matches WHERE id = $1 FOR UPDATE` and `SELECT … FROM brownlow_vote_entry_state WHERE match_id = $1 FOR UPDATE`, a mismatch refuses `stale`. Insert uses `INSERT … ON CONFLICT (match_id) DO NOTHING` followed by a re-read under the match lock, so two "first" drafts do not both succeed.
- **Canonical fingerprint CAS** for finalise/correct/adopt: the read model returns `canonicalFingerprint` = sha-256 of the sorted `(player_id, votes, source_id)` triples of the match's positive round rows (resolved and, for the match's season/round, unresolved rows of its participants). The transaction recomputes it under the match lock and refuses `stale` when it differs (covers a settle landing votes, a second Super Admin's correction, or an operator repair between load and submit).
- **Locks, in fixed order** to avoid deadlock: (1) `pg_advisory_xact_lock(717275, 3)` for any operation that touches season authority (finalise/correct/void — because they may re-derive a published season — and publish; **not** for draft saves); (2) `FOR UPDATE` on the `matches` row; (3) `FOR UPDATE` on the entry-state row; (4) `FOR UPDATE` on the `brownlow_season_authority` row (inserted with `ON CONFLICT DO NOTHING` first). Key 3 is the next free key in the `0xAF1DB` namespace (1 = honour teams, 2 = admin lifecycle); it is a frozen literal.
- **Scenarios:** Admin drafts while Super Admin finalises the same match → the later one sees a changed `revision` and is refused `stale`, and the page reloads with the finalised state (an Admin cannot overwrite a final row in any case: `already_final`). Two finalisations → second refused `stale`. Correction racing a settle → fingerprint refuses the correction; the settle's own transaction never touches a manual row. Two publishes → second refused `stale` on the authority revision. Corrections during a publish → serialised by the advisory lock; the loser re-reads and CAS-refuses.
- **Refusal precedence when the CAS and the transition fail together (measured in C1, 2026-09-10).** `assertRevision()` runs **before** `checkTransition()` in `src/db/queries/admin-brownlow.ts`. The two orders differ only for a transaction that loses a race and finds a row that is both moved and no longer in the state it acted on — exactly the scenario above. §27.17 step 4's ordering (transition first) would answer those with `already_final`, contradicting "Two finalisations → second refused `stale`"; the scenario is normative and is also the more useful answer, because the loser did not choose to act on a decided match, it acted on a page that stopped being true. `already_final` is preserved for the case §27.17 describes: an administrator submitting against the **current** revision of a match that is already final or void is still told to use Correct (proved by `refuses a draft on a finalised match` and `refuses a second void of the same match`).
- **Observing the wait in a test.** An advisory-lock waiter names the holder in `pg_blocking_pids()`, so a direct reading proves those three races. A **row**-lock waiter does not: the first waiter takes the *tuple* lock and then waits on the holder's transaction id, and every later waiter queues behind it on that tuple lock, so the second contender names the **first contender** and never the holder. Measured on `short.matches[0]`: holder 3168847; contender 3168867 `Lock/transactionid` blocked by [3168847]; contender 3168868 `Lock/tuple` blocked by [3168867]. "Both are blocked by the holder" is therefore not a fact that can become true for a row lock however long it is polled — the race itself was correct throughout (one winner, one `stale`), only the observation was wrong. The row-lock proof instead walks the `pg_blocking_pids()` graph transitively (recursive CTE rooted at the holder) and additionally requires each contender to be `wait_event_type = 'Lock'` and to be executing the contended `matches … FOR UPDATE`.
- No SERIALIZABLE, no distributed locking, no epoch.

### 27.15 Legacy Data Editor transition

- **Backend (C1):** `src/lib/match-sheet.ts::validateMatchSheetPayload` rejects any payload where a player has a non-null `brownlowVotes` with `"Brownlow votes are managed in Brownlow administration (/admin/brownlow) and cannot be saved from the match sheet."`; `src/db/queries/match-sheet.ts::saveMatchSheet` removes `brownlow_votes` from both the INSERT column list and the `ON CONFLICT` SET, so the mirror written by the Brownlow transaction (or the historical source value) is preserved through any match-sheet save. The finals/coverage checks that only served the removed write are deleted with it. Existing tests: `tests/match-sheet.test.ts` cases that accept a 3/2/1 allocation are inverted; `tests/integration/data-editor.test.ts` T6/T6b become "refused before any write, for any match, with the redirect message".
- **UI (C2):** `MatchSheetEditor.tsx` renders the `BV` column read-only (current value or "—") with a link to the match's Brownlow editor (`/admin/brownlow/<season>/<round>#match-<id>`); the input is removed rather than disabled, so nothing can be typed.
- **Deletion of a match with Brownlow entry** (`deleteMatch` in `match-admin.ts`): refused. **Revised in C1 (2026-09-10):** the refusal is an application-level check on the workflow state — `deleteMatch` reads `brownlow_vote_entry_state` under the match lock and returns `{ ok: false, error }` naming the status and the Brownlow round page, *before* any destructive statement runs. The `ON DELETE RESTRICT` foreign key of migration 094 §4 remains, but only as a storage-layer backstop: a raised foreign-key violation is not control flow a Data Editor user can act on, and relying on it alone meant the refusal arrived only after the deletes had been attempted. So `match-admin.ts` **is** changed, by that check and nothing else; `tests/admin-match-mutations.test.ts` still asserts it never mutates a Brownlow table (the read is a `SELECT`), and the integration test still proves the match and its entry survive intact.
- Awards, players, Hall of Fame and honour-team editing are untouched.

### 27.16 Schema / migration plan — **migration required: yes**, one file

Next free number at planning time is **094** (`093_nl_search_log_after_siren_grain.sql` is the latest); re-number against the branch at implementation start (§22 "Migration collision"). Forward-only; every object is additive.

```sql
-- 094_brownlow_admin_workflow.sql (AFLDB-ISSUE-155 Phase C1)

-- 1. Match identity on the round fact (nullable; backfilled; never NOT NULL)
ALTER TABLE brownlow_round_votes
  ADD COLUMN match_id integer REFERENCES matches(id) ON DELETE SET NULL;
COMMENT ON COLUMN brownlow_round_votes.match_id IS
  'Exact home-and-away match this vote was polled in. NULL = not resolved (no line-up row, or ambiguous); never guessed.';

-- 2. Deterministic backfill (§27.5 statement)

-- 3. Match-grain invariants, partial on match_id IS NOT NULL
CREATE UNIQUE INDEX ux_brownlow_round_votes_match_player
  ON brownlow_round_votes (match_id, player_id) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX ux_brownlow_round_votes_match_value
  ON brownlow_round_votes (match_id, votes) WHERE match_id IS NOT NULL AND votes > 0;
CREATE INDEX ix_brownlow_round_votes_match
  ON brownlow_round_votes (match_id) WHERE match_id IS NOT NULL;

-- 4. Workflow state (NOT a public statistical authority)
CREATE TABLE brownlow_vote_entry_state (
  match_id           integer     PRIMARY KEY REFERENCES matches(id) ON DELETE RESTRICT,
  season             smallint    NOT NULL REFERENCES seasons(year),
  status             text        NOT NULL CHECK (status IN ('draft', 'final', 'void')),
  three_player_id    integer     REFERENCES players(id),
  two_player_id      integer     REFERENCES players(id),
  one_player_id      integer     REFERENCES players(id),
  revision           integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by         integer     NOT NULL REFERENCES auth_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer     NOT NULL REFERENCES auth_users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  finalised_by       integer     REFERENCES auth_users(id),
  finalised_at       timestamptz,
  finalised_revision integer,
  last_reason        text        CHECK (last_reason IS NULL OR length(last_reason) <= 500),
  CONSTRAINT bves_distinct_ck CHECK (
    three_player_id IS DISTINCT FROM two_player_id
    AND three_player_id IS DISTINCT FROM one_player_id
    AND two_player_id   IS DISTINCT FROM one_player_id),
  CONSTRAINT bves_final_complete_ck CHECK (
    status <> 'final'
    OR (three_player_id IS NOT NULL AND two_player_id IS NOT NULL AND one_player_id IS NOT NULL
        AND finalised_by IS NOT NULL AND finalised_at IS NOT NULL AND finalised_revision IS NOT NULL)),
  CONSTRAINT bves_void_empty_ck CHECK (
    status <> 'void'
    OR (three_player_id IS NULL AND two_player_id IS NULL AND one_player_id IS NULL
        AND finalised_by IS NOT NULL AND last_reason IS NOT NULL))
);
CREATE INDEX ix_bves_season_status ON brownlow_vote_entry_state (season, status);
CREATE INDEX ix_bves_three ON brownlow_vote_entry_state (three_player_id) WHERE three_player_id IS NOT NULL;
CREATE INDEX ix_bves_two   ON brownlow_vote_entry_state (two_player_id)   WHERE two_player_id   IS NOT NULL;
CREATE INDEX ix_bves_one   ON brownlow_vote_entry_state (one_player_id)   WHERE one_player_id   IS NOT NULL;
-- (created_by/updated_by/finalised_by: index per the fk-indexes test's current rule; check that test first)

-- 5. Season authority / publication record
CREATE TABLE brownlow_season_authority (
  season             smallint    PRIMARY KEY REFERENCES seasons(year),
  revision           integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  published_revision integer,
  published_by       integer     REFERENCES auth_users(id),
  published_at       timestamptz,
  updated_by         integer     NOT NULL REFERENCES auth_users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bsa_published_ck CHECK (
    (published_revision IS NULL) = (published_by IS NULL)
    AND (published_revision IS NULL) = (published_at IS NULL))
);

-- 6. Audit allowlist (058 pattern)
ALTER TABLE data_edits
  DROP CONSTRAINT data_edits_table_name_check,
  ADD CONSTRAINT data_edits_table_name_check CHECK (table_name IN (
    'players', 'matches', 'draft_picks', 'award_winners', 'hall_of_fame', 'honour_team_members',
    'brownlow_vote_entry_state', 'brownlow_season_authority'));

-- 7. Privileges: same shape as every statistical table
SELECT afldb_meta.grant_app_read('brownlow_vote_entry_state');
SELECT afldb_meta.grant_app_read('brownlow_season_authority');
GRANT SELECT, INSERT, UPDATE, DELETE ON brownlow_vote_entry_state, brownlow_season_authority TO afldb_import;
```

Also: add both tables to `tools/maintenance/privileges.sql` (the reconciler's hand-typed lists; §memory: a table missing from it is silently revoked on the next reconcile) and extend `tests/integration/privileges.test.ts` (app SELECT only; import write; auth nothing). No `data_overrides` change (§27.1). No `NOT NULL` transition for `match_id`, ever — unresolved history is a legitimate state. No enum types (text + CHECK, as 057/058 chose). No JSON for vote assignments. A new table is chosen over widening `brownlow_round_votes` with workflow columns because drafts must never be rows in a public fact table.

### 27.17 Transaction design

All four run in `src/db/queries/admin-brownlow.ts` on a short-lived `postgres(AFLDB_IMPORT_DATABASE_URL, { max: 1 })` `begin()` (the `match-sheet.ts` pattern); each returns a discriminated result (`{ ok: true, state }` / `{ ok: false, code, message }`), never throws for a business refusal. Actor guard is in the Server Action (§27.8); the transaction re-reads nothing from the form beyond ids, expected revisions and the selection.

**`saveDraftBrownlowMatch({ matchId, selection: {three?, two?, one?}, expectedRevision, actorId, note? })`**
1. `SELECT id, season, round_number, round_type, home_club_id, away_club_id FROM matches WHERE id = $1 FOR UPDATE` → `not_found`; `round_type <> 'home_and_away'` → `not_home_and_away`; season class no-medal → `season_not_polled`.
2. Participants (§27.6); each selected id ∈ participants else `not_participant`; distinct else `duplicate_player`.
3. Entry row `FOR UPDATE` (insert `draft` with `ON CONFLICT DO NOTHING`, re-read). `status = 'final'|'void'` → `already_final`. `revision <> expectedRevision` → `stale`.
4. `UPDATE … SET three/two/one, revision = revision + 1, updated_by, updated_at`.
5. `recordDataEdit` (`draft`). 6. Return `{ revision, status, selection }`. No canonical, derived, coverage or public write. Revalidate admin round page only.

**`finaliseBrownlowMatch({ matchId, selection (all three), expectedRevision, expectedCanonicalFingerprint, actorId, reason?, adoptImported? })`**
1. `pg_advisory_xact_lock(717275, 3)`. 2. Match `FOR UPDATE` and checks as above. 3. Participants complete (§27.6) else `participants_incomplete`; selection complete else `incomplete`; membership/distinctness as above. 4. Entry row lock; **revision CAS → `stale` first**, then `final`/`void` → `already_final` (use correct). The order matters only to the loser of a race, whose answer is `stale`; see §27.14 "Refusal precedence". 5. Recompute canonical fingerprint under lock → `stale` if different. 6. `writeMatchFacts` (§27.10 item 1). 7. `UPDATE` entry → `final`, `finalised_by/at`, `finalised_revision = revision + 1`, `revision + 1`. 8. Season authority row: insert-if-absent, `FOR UPDATE`, `revision + 1`; **if `published_revision IS NOT NULL`** run `deriveSeasonRows` with the existing ineligible set, `recomputeSeasonBrownlowStatus`, `recomputeBrownlowCareerTotals(affected)`, set `published_revision = revision`, audit `republish`. 9. `recomputeBrownlowCoverage(season)`. 10. `recordDataEdit` (`finalise`, with `canonicalRows` before/after). 11. Return `{ revision, status: 'final', selection, seasonAuthority }`. Revalidation per §27.18.

**`correctBrownlowMatch(...)`** = `finaliseBrownlowMatch` with `status = 'final'` required at step 4 (`not_final` otherwise), `reason` required (else `invalid`), audit `correct`. **`voidBrownlowMatch`** = same skeleton, no selection, reason required, `writeMatchFacts` in void mode, audit `void`.

**`publishBrownlowSeason({ season, ineligiblePlayerIds, expectedRevision, actorId, note? })`**
1. Advisory lock (717275, 3). 2. Season exists and is polled; authority row insert-if-absent, `FOR UPDATE`; revision CAS → `stale`. 3. Completeness (§27.9) with `unresolved = 0` else `season_incomplete` (message lists the counts). 4. Every ineligible id must have polled in the season else `invalid`. 5. Old season rows captured; `deriveSeasonRows`; `recomputeSeasonBrownlowStatus`; `recomputeBrownlowCareerTotals(old ∪ new players)`; `recomputeBrownlowCoverage`. 6. `UPDATE` authority `revision + 1`, `published_revision = revision`, `published_by/at`. 7. `recordDataEdit` (`publish`). 8. Return the new overview. Revalidation per §27.18.

Failure handling: any thrown error (constraint, audit, connection) rolls the transaction back and is returned as `db_error` with the message logged server-side; `recordDataEdit` failing is therefore `db_error` with nothing committed (proven by the integration test that submits a 501-character reason → `last_reason` CHECK passes at 500 but the audit note is deliberately given 2001 characters in the test double to trip `data_edits.note` — or simply by forcing the audit insert to fail through a test-only invalid `admin_user_id`). Split outcomes are impossible by construction.

### 27.18 Publication / cache behaviour

| Mutation | Paths revalidated after commit |
|---|---|
| draft save / clear | `/admin/brownlow/[season]/[round]` and `/admin/brownlow/[season]` (`revalidatePath(..., 'page')` on the dynamic patterns) |
| finalise / correct / void, season **not** admin-published | admin paths above; `/seasons/${season}` via the existing all-worker fan-out `revalidateSeason()` from `src/lib/acquisition/season-revalidation.ts` when its env is configured (falls back to local `revalidatePath`); `/matches/${matchId}` (mirror) locally |
| finalise / correct in an admin-published season, publish, re-publish | all of the above plus `/brownlow`, `/brownlow/${season}`, `/players/[slug]` (`'page'`), `/clubs/[slug]` (`'page'`), `/records/[category]` (`'page'`) locally |

Known limitation (recorded, not solved here): `revalidatePath` from a Server Action invalidates the worker that served it (ISSUE-134 evidence); only the season page has the cross-worker route. Other pages refresh within their ISR window (≤ 1 h; club pages 24 h). Extending `/api/internal/revalidate-season` to an allowlisted path set is a small C2 option if acceptance shows it matters; not required. Drafts never reach any public query, so no draft can leak whatever the cache state.

### 27.19 Current-season coexistence (no refresh-job work)

- Until award night the source publishes no votes; the settle produces no round rows and `brownlow_season_total` reads `pending` (release-gate test). The admin season page for 2026 shows `not_started` with every H&A match `not entered`; participants exist for settled matches.
- On award night an operator enters votes round by round (Admin drafts, Super Admin finalises), or, if a later settle imports votes first, adopts them. Publication follows when complete. Nothing here schedules or runs an import (Phase G).
- Season rollover (`src/lib/rollover/season-rollover.ts`) already treats the Brownlow coverage transition as an operator-declared decision; `recomputeBrownlowCoverage` keeps the per-season rows consistent with whatever the workflow has done, so rollover evidence remains truthful.

### 27.20 SQL / runtime preflights (run before applying the migration; record results in the issue)

| # | Question | Query shape | Gate |
|---|---|---|---|
| P1 | Round-fact volume and span | `SELECT count(*), min(season), max(season), count(*) FILTER (WHERE votes = 0), count(*) FILTER (WHERE source_id IS NULL), count(DISTINCT source_id) FROM brownlow_round_votes` | informational; expect 1984–2025/2026 |
| P2 | Backfill resolvability | the §27.5 SELECT with `count(*) FILTER (WHERE candidates = 1 / 0 / > 1)` | `> 1` must be 0 (else repair first); `0` is reported as the unresolved baseline |
| P3 | Match-grain uniqueness | after computing candidate `match_id` in a CTE: duplicates of `(match_id, votes) WHERE votes > 0` and of `(match_id, player_id)` | **must be 0** (hard stop) |
| P4 | Season-row semantics | `SELECT count(*) FILTER (WHERE votes = 0), count(*) FILTER (WHERE source_id IS NULL), count(*) FILTER (WHERE source_id = (SELECT id FROM sources WHERE key='manual_admin_edit')) FROM brownlow_season_votes` | zero manual rows expected today; 0-vote row count decides whether `deriveSeasonRows` emits 0 rows |
| P5 | Season totals vs sum of round facts (1984–2025) | per season: `sum(rv.votes)` vs `sum(bsv.votes)`, and per player mismatches | informational; the disagreement report baseline |
| P6 | Match-grain sums | per H&A match **1984–2025** (not "1984+" — `brownlow_round_votes` has zero rows outside that span, and driving this from `matches` past 2025 would put every in-progress current-season H&A match into the "none" bucket as a false exception; corrected 2026-09-11 after DEV preflight caught it): `sum(rv.votes)` grouped into 6 / other positive / none | reveals the exception population for P7 |
| P7 | Exceptions | list matches from P6 with a positive sum ≠ 6 | if any are legitimate "no votes awarded" cases, `void` is used; otherwise repair |
| P8 | Participant completeness | per season, over the full match history (no lower bound assumed — measured span is 1897–2026, not "1899+"): H&A matches where either club has < 18 `player_match_stats` rows | expect **zero genuinely historical exceptions**; a handful of incomplete in-progress current-season matches (measured: 7, all 2026) is expected and benign — those correctly refuse finalisation until the normal current-season pipeline repairs their line-ups; decides the §27.6 threshold (corrected 2026-09-11 after DEV preflight — the original "expect 0 for 1899+" wording did not account for an in-progress season) |
| P9 | `games` semantics of the artefact | for 3 seasons compare `bsv.games` with H&A line-up count and with `player_season_stats.games` | decides item 2 of §27.10 |
| P10 | Unresolved player links inside Brownlow rows | `link_status_value` distribution on `brownlow_season_votes` (`db-health` already lists it) | informational |
| P11 | Privileges | `has_table_privilege('afldb_import','stat_availability','UPDATE')`, `…('player_career_stats','UPDATE')`, `…('player_season_stats','UPDATE')`, `…('brownlow_season_votes','DELETE')` | all true (the import role rebuilds them today); else stop |
| P12 | Mirror column baseline | **two separate populations, not one "1984+" range** (corrected 2026-09-11 after DEV preflight): (a) H&A matches **1984–2025**, where `player_match_stats.brownlow_votes` sum is compared against `rv` sum — the genuine comparison zone; (b) pre-1984 mirror-only rows (expected exactly seasons **1931–1934**), which have no `rv` counterpart at all and must never be compared against one or promoted into round facts (§27.22) | informational; documents pre-existing drift the mirror will not retro-fix |

### 27.21 Deployment sequencing

1. Operator runs P1–P12 on the target (DEV first, then PROD); P3 = 0 and P11 all true are required.
2. Apply migration 094 (transactional: schema, backfill, indexes, CHECK widening, grants in one commit), then `db:privileges` to reconcile `privileges.sql`.
3. Deploy C1 code (no route yet): the match-sheet write is gone, the new tables exist, nothing is reachable. Old code that may still be running tolerates the additive schema.
4. Run `tests/integration/privileges.test.ts` and the C1 integration suite against the host's `_test` database where available (PROD has no `afldb_test`; rely on DEV/streamanator per memory).
5. Deploy C2 (routes, nav, actions). Verify a Contributor is bounced and an Admin sees no finalise control.
6. Validate reconciliation on the live database: `db-health` career check = 0 mismatches; `SELECT count(*) FROM brownlow_round_votes WHERE match_id IS NULL` equals the P2 baseline; release gates green.
7. Public route validation: `/brownlow`, `/brownlow/<year>`, `/seasons/<year>` render unchanged for an untouched season; after a test finalisation on DEV, the season page shows the round votes and the match page the mirror.
8. Only then perform any real entry. No step creates two live authorities: until publish, the artefact rows are authoritative; at publish, the manual rows replace them atomically.

Rollback = disable the routes/actions; new tables and manual rows stay (forward-only, §14).

### 27.22 Risks and stop conditions

- **P3 > 0** (two players share a vote value in one match, or one player has two rows for a match): stop; repair the source data before the migration.
- **P2 ambiguity > 0** (a player with two line-up rows in one H&A round): stop and repair the line-up.
- **P11 false**: the import role cannot rebuild derived/coverage tables from the web path — stop; do not widen the app role.
- **`manual-authority.ts` contract**: if implementation finds it necessary to touch `data_overrides.entity_type`, stop; the settle's proof would break.
- **Promotion/restore after Phase C**: a lineage-remap promotion that does not carry `brownlow_vote_entry_state`, `brownlow_season_authority` and manual-owned rows would erase admin decisions — stop any promotion until the ISSUE-151 pipeline lists them.
- **Participant coverage** (P8) shows material historical H&A ranges under 18 rows per side: lower the threshold to the measured minimum; if a range has no line-ups at all, entry there is blocked by design and the range is reported — not a reason to allow free-text players.
- **Audit atomicity**: the design keeps `data_edits` in the fact transaction; if any implementation pressure suggests post-commit audit, stop.
- **Fabricated precision**: the migration must never turn a season total into match rows, nor 1931–1934 partial match votes into round rows.
- **Cross-worker cache**: not a stop; recorded limitation (§27.18).

### 27.23 Implementation split — C1 / C2 confirmed

The split in §23 is correct and is adopted: C1 is entirely server-side and database-bound (migration, transactions, importer guards, contract tests) and can be validated without a browser; C2 is a thin UI over C1's read model and results, whose only client-side logic (selection state, duplicate prevention, keyboard flow) is repeated server-side. Neither depends on the other's model choice.

### 27.24 Recommended model / effort

- **C1 — Opus, high.** Transactional data-authority code, migration/backfill, importer guards, deterministic concurrency tests.
- **C2 — Sonnet, high.** Routes/components/actions over fixed server contracts; no data-authority logic lives client-side, so Opus is not warranted.
- Astra is not used for either.

### 27.25 Handoff contract — C1 (Brownlow canonical backend/schema)

**Session:** fresh; model Opus, effort high; worktree `D:\dev\afldb-issue-155`, branch `codex/issue-155-admin-overhaul`; follow `CLAUDE.md`; the user runs all commands.

**Prompt:**

> Implement AFLDB-ISSUE-155 Phase C1 exactly as specified in `AFLDB-ISSUE-155.md` §27 (read §27 fully first; §8 is intent only, §27 governs). Phases A and B are complete and must not change. Do not build any `/admin/brownlow` UI (that is C2). Scope: (1) migration `094_brownlow_admin_workflow.sql` per §27.16, re-numbered if the branch has moved, including the §27.5 backfill and partial unique indexes; add both new tables to `tools/maintenance/privileges.sql` and `tests/integration/privileges.test.ts`. (2) `src/lib/brownlow/entry.ts` (pure, no `server-only`): selection validation (distinct, participant membership, complete-for-final), state transitions, error codes and messages, canonical fingerprint, season-row derivation math (ranks, eligible ranks, tied winners). (3) `src/db/queries/admin-brownlow.ts`: read model (`listBrownlowSeasons`, `getBrownlowSeasonOverview`, `getBrownlowRound`, `getBrownlowMatchEditorModel` returning participants, current entry, imported rows, fingerprint, participant completeness, disagreement report) and the four transactions of §27.17 on the `AFLDB_IMPORT_DATABASE_URL` short-lived connection with the §27.14 lock order and `recordDataEdit` in-transaction. (4) `src/db/queries/player-derived.ts`: add `recomputeBrownlowCareerTotals` and `recomputeBrownlowCoverage` in lockstep with `rebuild_derived.py` and migration 016. (5) `src/db/queries/audit-log.ts`: extend `DataEditTableName`. (6) `src/lib/auth/capabilities.ts`: add `data.brownlow.read/draft/finalise` per §27.8. (7) Legacy writer per §27.15: `src/lib/match-sheet.ts` refuses non-null `brownlowVotes`; `src/db/queries/match-sheet.ts` no longer writes `brownlow_votes`. (8) Importer guards per §27.11 in `tools/migration/import_brownlow_season.py` (`check_database_coverage`) and `tools/migration/import_fitzroy_core.py` (`import_brownlow_round_votes`), fail-closed with a clear message. (9) Tests per §27.26: new `tests/brownlow-entry.test.ts`; extend `tests/match-sheet.test.ts`, `tests/admin-match-mutations.test.ts`, `tests/auth.test.ts` (capabilities), `tests/integration/data-editor.test.ts` (T6/T6b), `tests/integration/privileges.test.ts`; new `tests/integration/admin-brownlow.test.ts` including the deterministic two-connection races and audit-failure rollback; source-contract assertions for the two Python guards in `tests/brownlow-season-artefact.test.ts` and `tests/fitzroy-core-import.test.ts`. Before writing the migration, ask the user to run preflights P1–P12 (§27.20) against `afldb_test` and record the results in the ISSUE-155 entry; stop if P3 or P2-ambiguity is non-zero. Then give the focused commands in this order: `npm run test -- tests/brownlow-entry.test.ts tests/match-sheet.test.ts tests/admin-match-mutations.test.ts tests/auth.test.ts`, then `npm run db:migrate` against `AFLDB_TEST_DATABASE_URL` (the user chooses the exact invocation), then `npm run test -- tests/integration/admin-brownlow.test.ts tests/integration/data-editor.test.ts tests/integration/privileges.test.ts tests/integration/release-gates.test.ts`, then `npm run typecheck`. Record results in `issues.md`, update `IssuesIndex.md`, add an Unreleased `CHANGELOG.md` entry, and stop at the C1 validation gate. Do not start C2.

### 27.26 Handoff contract — C2 (Brownlow Admin UI)

**Session:** fresh; model Sonnet, effort high; same worktree/branch; C1 committed and its integration gate green.

**Prompt:**

> Implement AFLDB-ISSUE-155 Phase C2 exactly as specified in `AFLDB-ISSUE-155.md` §27 (read §27.6–§27.9, §27.14–§27.15, §27.18 and §27.26; C1's `src/db/queries/admin-brownlow.ts` and `src/lib/brownlow/entry.ts` are the fixed contracts — do not change transaction, guard, SQL or audit code). Build: `src/app/admin/brownlow/page.tsx` (season list with status label, expected/final/draft/imported/unresolved counts, authority and last editor via `authSql` email lookup), `src/app/admin/brownlow/[season]/page.tsx` (round grid with per-round completeness, disagreement report for source-published seasons, Super Admin publish panel with ineligible-player multi-select prefilled from current rows, `expectedRevision` hidden field), `src/app/admin/brownlow/[season]/[round]/page.tsx` rendering every H&A match in fixture order with an inline `MatchVoteEditor.tsx` client component per match (teams, date, venue; participants grouped by club with jumper numbers; three type-ahead selects for 3/2/1 that exclude already-chosen players; visible current state, imported values with an Adopt control, participant-incomplete block; Save draft; Finalise / Correct (with reason) / Void for Super Admin, rendered disabled with reason for Admin; success/refusal/stale messages held by the round page so a revalidation does not discard them, and entered values preserved on refusal — the Phase B lessons in §26.20), `src/app/admin/brownlow/actions.ts` (Server Actions: `saveDraft`, `finalise`, `correct`, `void`, `publish`, each calling `requireCapability` per §27.8, parsing ids/revisions/fingerprint from the form, calling the C1 transaction, auditing refusals per §27.13, revalidating per §27.18), keyboard flow (Tab order 3→2→1→Save, Enter submits, focus moves to the next match on success). Add the Data-group nav link in `src/app/admin/nav-model.ts` on `data.brownlow.read`, an overview badge on `/admin` for the current season's incomplete H&A count, and make the match sheet's BV column read-only with a link (§27.15). Tests: extend `tests/auth.test.ts` for the nav; new `tests/admin-brownlow-actions.test.ts` (parse/guard/refusal-audit with the queries mocked, the `tests/admin-lifecycle-actions.test.ts` pattern). Then run the browser acceptance of §27.27 at 1440×900 and 375×812 on DEV, restoring every touched row afterwards, and record the evidence in `issues.md`. Do not start Phase D.

### 27.27 Focused test matrix

**C1 unit (`tests/brownlow-entry.test.ts`, pure):** valid 3/2/1; missing one/two/three selections is draft-valid and final-invalid; same player twice; non-participant id; participant-complete threshold; state transitions (none→draft→final, final→final by correct only, draft→final needs finalise capability flag in the pure model, void rules); fingerprint stability and change; season derivation: ranks, eligible ranks with ineligible players, tied winners, zero-vote exclusion, 3/2/1 game counts, polling games; error-code → message mapping.

**C1 source-contract:** `admin-brownlow.ts` is the only application file mutating the two Brownlow tables (with `canonical-apply.ts`, the ownership-gated settle writer of §27.11); `match-sheet.ts` contains no `brownlow_votes` write; `match-admin.ts`/`data-edits.ts` write no Brownlow fact — **not** "unchanged": `deleteMatch` gained the §27.15 workflow-state refusal, which is a `SELECT` and so still satisfies the no-write contract; capability table entries; the two Python guards exist (regex on source).

**C1 DB integration (`tests/integration/admin-brownlow.test.ts`, `afldb_test`):** migration objects and privileges; backfill result equals the P2 expectation on the rebuilt test data and both partial unique indexes exist; draft create; draft update; draft on a finalised match refused; finalise writes three manual rows with `match_id`, provenance and the 3/2/1/0 mirror, one `data_edits` row, coverage row updated; correction writes before/after and reason; non-participant, duplicate player, incomplete selection, non-H&A match (Wildcard Final and a Grand Final), no-medal season, participants-incomplete refused with nothing written; stale revision refused; stale fingerprint refused after a simulated settle-style update of an imported row; audit failure rolls back the fact rows; finalise in a **source-published** season leaves `brownlow_season_votes` untouched and the disagreement report shows the delta; publish refused while incomplete or with unresolved rows; publish writes derived rows with manual provenance, ranks/winners/ineligibility, `player_season_stats` and `player_career_stats` updated for affected players, `db-health` reconcile = 0; correction in a **published** season re-derives atomically and bumps `published_revision`; re-publish idempotent; the artefact-loader guard and fitzRoy guard refuse when a manual row exists (executed through a minimal Python invocation if the harness allows, else the source contract); `deleteMatch` on a match with an entry row fails — on the §27.15 application check, before any destructive statement — and leaves everything intact; match-sheet save preserves the mirror. **Concurrency:** Admin draft vs Super Admin finalise (loser refused `stale`); two finalisations; correction vs a concurrent correction; two publishes — each with a `pg_blocking_pids` proof of the wait: a direct reading for the three advisory-lock races, and the transitive blocking chain rooted at the held `matches` row for the row-lock race (§27.14 "Observing the wait in a test"). Each race seeds the state it needs rather than inheriting it from an earlier `it()`, so any one of them can be run alone with `vitest -t`.

**Two C1 corrections to the assertions themselves**, both cases where the first version of a test asserted something the workflow does not claim: (i) the **correction** test now distinguishes a *reshuffle* from a *displacement* — a previous holder who is still on the corrected sheet is demoted (the former 3-vote holder to 2), and only the one holder who leaves it keeps the `votes = 0, played = true` row that "claim and demote, never delete" is about; asserting a zero row for every previous holder was simply wrong; (ii) `participantsComplete` in `getBrownlowRound` compares counts that are cast `::int` in the SQL and uses `MIN_CLUB_LINEUP_ROWS` — postgres.js returns a bare `count()` as a **string**, and `row.foreignRows === 0` is then false for every match, which would have marked every complete line-up incomplete in the round grid. The threshold is the named constant rather than a literal 18 so it cannot drift from `assessParticipants` (§27.6).

**Action/auth (`tests/admin-brownlow-actions.test.ts`):** Contributor redirected; Admin can draft, cannot finalise/correct/void/publish (each refused by the guard before the query is called); Super Admin can; capability table and nav visibility agree with the guards; refusal audit written for `stale`/`forbidden`/`already_final` only.

**Browser acceptance (manual, DEV, both widths), as in §26.20:** season list and status labels; round navigation and completeness; rapid entry of two consecutive matches by keyboard only; duplicate prevented (second select excludes the first); non-participant unavailable (not in list) and, via a hand-edited form post, refused by the server; draft save with visible confirmation; Admin sees finalise disabled with reason; Super Admin finalises; stale-tab conflict on the same match shows the stale message and reloads current state; correction with reason; season page shows the round votes after finalise and totals after a DEV-only publish of a test season (then restored); match page mirror; publish refused while incomplete; role-specific controls; no horizontal overflow at 375×812; zero console/runtime errors.

### 27.28 Genuine unresolved decisions

None block C1. Two were settled by preflight rather than by the owner and are now closed: the `games` semantic for manual season rows (P9, settled across all 98 seasons by P13(i), §27.29) and the §27.6 threshold (P8, which remains 18). P13 (§27.29) additionally pinned the rank, winner and NULL-for-zero counting conventions the derived rows must reproduce. One is an owner/operator follow-up outside Phase C: adding the Brownlow tables and manual-owned rows to the promotion/restore lineage (ISSUE-151 pipeline) before any post-Phase-C promotion. Decision 1 of §25 is adopted as Option A by this plan (Admin drafts; Super Admin finalises/publishes), per the owner's Phase C brief.

### 27.29 Preflight P13 results — measured artefact conventions (2026-09-10)

P1–P12 measure whether the data can support the workflow. P13 was added during C1 because it measures something else: the **conventions** the 98 source-published seasons already encode. `deriveSeasonRows` must produce rows a reader cannot tell apart from an imported one, and the artefact importer carries these values through rather than deriving them, so every one of them is knowable only by measuring the data. Read-only, run against the rebuilt `afldb_test` over all 16,120 `brownlow_season_votes` rows (the round-grain checks over 1984–2025). The scratch suites that produced this have been deleted; these are their results.

| # | Question | Result | Binding for `deriveSeasonRows` |
|---|---|---|---|
| P13(a) | What does an ineligible row carry? | exactly three rows: 1996 player 3063 (21 votes), 1997 player 2763 (27), 2012 player 7273 (30) — each `vote_rank = 1`, `eligible_rank` NULL, `is_winner` false | an ineligible player keeps his place in the overall ranking, has no eligible rank, wins nothing |
| P13(b) | Are NULL `eligible_rank` and ineligibility the same set? | 16,120 rows; `vote_rank` NULL 0; `eligible_rank` NULL 3; NULL-and-ineligible 3; ineligible-with-rank 0; `club_id` populated 0 | NULL `eligible_rank` ⇔ ineligible; `club_id` stays NULL on manual rows |
| P13(c) | Is `vote_rank` competition or dense, and over whom? | over all rows: disagrees with competition on 0, with dense on 15,590 | **competition rank (1, 2, 2, 4) over ALL polled players, ineligible included** |
| P13(d) | Could `vote_rank` be eligible-only? | re-ranked over the 16,117 eligible rows: 636 disagreements | no — the ineligible sit inside the ordering |
| P13(e) | What is `eligible_rank`? | over eligible rows: disagrees with competition on 0, with dense on 15,590 | **competition rank among the eligible only** |
| P13(f) | What does `is_winner` mean? | 112 winner rows; winners not at `eligible_rank` 1: 0; ineligible winners: 0; `eligible_rank` 1 not winner: 0 | `is_winner` ⇔ `eligible_rank = 1`, exactly and in both directions |
| P13(g) | Are tied winners real? | 12 seasons have more than one winner — 1930 (3), 1940, 1949, 1952, 1959, 1965, 1981, 1986, 1987, 1996 (2 each), 2003 (3), 2012 (2) | a tie at the top produces multiple winners sharing rank 1; do not tie-break |
| P13(h) | Do the counting columns re-derive from the round grain, 1984–2025? | 8,570 rows, none without round rows; `votes` mismatch 0; `polling_games` mismatch 0; but `three/two/one_vote_games` mismatched 4,327 / 3,798 / 3,423 | opened P13(j); do not choose an authority until it is explained |
| P13(i) | What is the `games` semantic? | all 16,120 rows, all 98 seasons: no missing `player_season_stats` row; disagreements with `games - finals` 0; with `games` 6,507 | **`games` is home-and-away only** — `player_season_stats.games - player_season_stats.finals`. This settles §27.28's open P9 item across every season, not the three P9 sampled |
| P13(j) | Why do the 3/2/1 counts disagree? | aggregates identical (stored three/two/one 7,413 each vs derived 7,413 each; stored `polling_games` 22,239 vs derived 22,239); populated-and-wrong 0 / 0 / 0; no transposition; **every P13(h) mismatch is a stored NULL against a derived zero** | the columns are ordinary exact counts of canonical 3/2/1 rows. The representation is **NULL-for-zero**: store the positive count, store NULL for zero. Interpret with `COALESCE(col, 0)` |

**Why P13(j) mattered.** P13(h)'s counts came from `IS DISTINCT FROM`, which scores `NULL` against `4` and `NULL` against `0` alike, and migration 005 declares all four counting columns nullable with no CHECK — so "half the rows use a different counting rule" and "half the rows are simply unpopulated" produced identical evidence. They are not the same finding: the first would have meant the artefact encodes a historical convention worth reproducing, the second means it encodes an absence. Separating them needed the populated rows checked on their own, which is what P13(j) did. A transposition hypothesis (stored three = derived one) was tested and excluded at the same time, because transposing preserves `polling_games` and would have survived P13(h) unnoticed.

**Consequence for the writer.** A manual row that stored `0` where the artefact stores NULL would be distinguishable from a source-published one by a plain `IS NULL` — the exact failure §27.10 exists to prevent. `deriveSeasonRows` therefore emits `count > 0 ? count : null` for the three columns and always populates `polling_games`, which cannot be zero on a row that exists at all. Existing artefact rows are not altered. Pinned by `tests/brownlow-entry.test.ts` ("stores a zero 3/2/1 count as NULL, the way the artefact does", plus the COALESCE identity case).

### 27.30 C1 test-harness defect — `seedBrownlowSeason` can commit fixture residue on a Vitest timeout (FIXED and validated 2026-09-10)

**Status:** **fixed and validated 2026-09-10**, on the abnormal paths themselves rather than by inspection. The residue cleanup ran first; the harness fix and its validation follow below.

`tests/integration/brownlow-fixture.ts` seeds **committed** rows by design (§27.27: the code under test opens its own connections, so an uncommitted fixture would be invisible to it). Cleanup is therefore entirely the suite's responsibility, and it is reachable only through the handle `seedBrownlowSeason` returns. That makes the harness unsound under a `beforeAll` timeout:

1. Vitest's `beforeAll` timeout **rejects the hook**; it does not cancel or reject the in-flight `seedBrownlowSeason` promise. The seed keeps running to completion on its own connection and commits every statement it issues.
2. `main` / `short` / `noMedal` in `tests/integration/admin-brownlow.test.ts` are assigned only from the awaited return value, so on a timeout they are never assigned.
3. `afterAll` calls `noMedal?.cleanup()` / `short?.cleanup()` / `main?.cleanup()` — all three short-circuit on `undefined`, so **no cleanup runs at all**, including for the seasons that had already finished seeding.
4. The internal `try/catch` around `seed()` only covers a *thrown* seed error. A timeout is not one, so `removeSeeded()` is never invoked either.

Net effect: **a normal test invocation can contaminate `afldb_test`** with committed rows in reserved seasons 2084/2085/2089 and on `issue155-*` keys, with no handle left to remove them. The fixture's fail-closed collision guard then refuses the *next* run, so the contamination is self-latching and needs manual cleanup.

Aggravating factor: the audit-probe case in `admin-brownlow.test.ts` creates `issue155_audit_probe()` and a `BEFORE INSERT` trigger `issue155_audit_probe_trg` **on `data_edits`**. It is dropped in a `finally`, but a hard timeout or process kill inside that `it` would leave a trigger that raises on every `data_edits` insert for the affected match, i.e. database-wide residue that is not a row.

**Fix as shipped (2026-09-10).** Cleanup no longer depends on the handle `seedBrownlowSeason` returns:

- a **module-level seed registry** entry is created at the moment the fixture claims the namespace — *before the first fixture row is written* — carrying the season's `removeSeeded`, its cancellation signal and its connection;
- each seed runs on its **own dedicated connection**, so an abandoned seed can be stopped without disturbing the suite's other clients;
- the seed observes a cancellation flag at **checkpoints** between statements and throws at the next one;
- `afterAll` sweeps the **registry** rather than the three optional handles, in this order: cancel first → wait briefly for the seed to settle cooperatively → forcibly close that seed's dedicated connection if it has not settled → only then remove the fixture rows;
- removal is **memoised and idempotent**, one execution shared by the internal `catch` and the sweep, and **fail-closed**: a failed removal keeps failing rather than reporting clean on the second ask;
- the internal seed deadline (`SEED_DEADLINE_MS`, 300 s, overridable with `AFLDB_BROWNLOW_SEED_DEADLINE_MS`) is retained **only as a secondary protection** against a seed that hangs somewhere no checkpoint is reached — it is no longer the primary cancellation mechanism.

**Both abnormal paths were exercised directly (2026-09-10)**, through a temporary suite `tests/integration/tmp-issue155-cancel.test.ts` (deleted after the runs; it was never part of the committed suite):

| Run | Command | Path proved | Result |
|---|---|---|---|
| A | `npx vitest run tests/integration/tmp-issue155-cancel.test.ts --testTimeout=600000 --hookTimeout=600000` | registry-sweep cancellation and quiesce — "an abandoned in-flight seed is cancelled and removed by the registry sweep" | **PASS**, 1 passed / 1 skipped, ~3.6 s, clean process exit |
| B | same, with `AFLDB_BROWNLOW_SEED_DEADLINE_MS=3000` | internal deadline — "the internal deadline cancels a seed and removes what it wrote" | **PASS**, 1 passed / 1 skipped, ~5.5 s, clean process exit |

The clean exit of both runs is itself part of the evidence: shutting down a dedicated seed connection mid-flight does not hang the Vitest process.

**Independent verification after those abnormal-path runs** (read-only Node + `postgres`, inside a `READ ONLY` transaction, refusing before connection and again on `current_database()` unless the database name ends in `_test`): every ISSUE-155 residue counter was **zero** — no reserved season 2084/2085/2089 row; no `issue155-*` match or player; no `player_match_stats`, `player_season_stats`, `player_club_season_stats`, `player_career_stats`, `player_clubs`, `club_seasons` or `stat_availability` residue at any grain; no `brownlow_season_votes`, `brownlow_round_votes`, `brownlow_vote_entry_state` or `brownlow_season_authority` residue; no `data_edits` row on a fixture match, player or workflow subject; no `issue-155-brownlow-test@example.test` auth user; and neither the `issue155_audit_probe_trg` trigger nor the `issue155_audit_probe` function in the catalog. **`ISSUE155_RESIDUE_ZERO: YES`.** Informational, deliberately excluded from that verdict because it is a whole-database integrity question rather than an ISSUE-155 one: `GLOBAL_DATA_EDITS_ORPHANS: 0`.

### 27.31 C1 closeout — fixture residue cleanup, gate results and externally-owned failures (2026-09-10)

**Fixture residue cleanup (`afldb_test`, guarded, committed).** The contamination §27.30 describes was removed by a scoped cleanup that refused to run unless every precondition held. Evidence:

- all **15 entanglement guards = 0** — no fixture row shared identity with, or was referenced by, a real row;
- fixture **auth precondition = 0**;
- every **FK blocker scan = 0**;
- postconditions **P01–P14 residue checks green**; **P15 collateral accounting green**;
- **exactly 419 rows deleted**, and nothing else;
- committed, with the closing statement *"afldb_test is clean of ISSUE-155 fixture residue."*

The later independent verification recorded in §27.30 — run *after* the two abnormal-path validations, not merely after the cleanup — re-proved zero residue from outside the harness.

**§27.25 C1 gate results.**

| Gate | Result |
|---|---|
| `npm run typecheck` | **GREEN** |
| `tests/integration/admin-brownlow.test.ts` | **44/44 PASS**; the only stderr is the deliberate audit-probe rollback case, as designed |
| `tests/integration/data-editor.test.ts` | 9 passed / **1 failed** / 2 skipped — **T6, T6b and T6c all PASS**; the single failure is the ladder/no-matches assertion, classified below |
| `privileges` + `release-gates` | 56 passed / **3 failed** / 7 skipped — all three classified below |

**The four remaining failures are externally owned. None is an ISSUE-155 regression, and none is a historical-data regression.** Attribution was proved by an independent read-only query, not inferred from the suites:

| Measure | Value |
|---|---|
| `matches_2026` | 213 |
| `complete_2026` (attendance) | 213 |
| `complete_le2025` (attendance) | **15,187 — the pinned expectation, exactly** |
| `club_seasons_2026` | 18 |
| `pss_2026` | 577 |
| `cohort_on_2025_basis` | **261 — the pinned expectation, exactly** |
| verdict | **`PURE_2026_DRIFT_CONFIRMED: YES`** |

1. **Advanced Search, expected 261 / actual 268.** Recomputing the cohort with 2026 season goals subtracted from career goals returns **261** — the pinned number and, per the gate's own comment, its ISSUE-113 membership digest basis. The seven extra players crossed the 50-goal floor on 2026 goals alone.
2. **Western Bulldogs identity, expected `to = 2025` / actual `to = 2026`.** `club_seasons` holds **18** rows for 2026. The gate's comment records that **ISSUE-095 deliberately re-pinned this bound from 2026 to 2025** because "the in-progress season belongs to the current-season pipeline (ISSUE-098/-099), not here".
3. **Attendance status, expected complete = 15,187 / actual 15,400.** Complete rows at **season ≤ 2025 are exactly 15,187**; the 213 extra are the 213 2026 matches. `not_collected` is unchanged at **1,651**, so no historical attendance value moved.
4. **`data-editor` ladder/no-matches assertion** — *"expected canonical in-progress season row to exist, got undefined"*. Direct mechanism, not an assumption: the test selects the newest season having **no** non-final matches, and its own message states the premise — *"a canonical rebuild leaves the in-progress season without matches"*. With `matches_2026 = 213`, no such season exists, so the subject of the test is `undefined`. Same root cause as 1–3, one direction further on: the test needs a match-free in-progress season and `afldb_test` no longer has one.

**Database-state policy finding (documented, not decided here).** The canonical baseline these gates were pinned to is **1897–2025** — stated in the release-gate source itself (ISSUE-095 for the club-lineage bound, ISSUE-113 for the cohort digest and for "never emits a row for an in-progress season, so 2026 derives as pending"). `afldb_test` now additionally carries current-season 2026 rows (213 matches, 18 `club_seasons`, 577 `player_season_stats`). Both facts are intentional in their own terms; what does **not** exist is a rule reconciling them, because the gate predicates are unbounded by season and therefore read the 2026 rows. Establishing the provenance of those 2026 rows (the current-season pipeline of ISSUE-098/-099/-100 is the only writer of an in-progress season and is the presumed origin, unconfirmed here) and deciding the reconciliation — bound the gates by season, or keep `afldb_test` canonical-through-2025 and stage current-season work elsewhere — belongs to the release-gate / current-season owner. **ISSUE-155 changed no expected value and no ladder logic, and must not.**

**Also untouched, by instruction:** the known `external_grid_axes` / `external_grids` privilege mismatch.

**C1 verdict: complete, gate green** on everything ISSUE-155 owns, with the four failures above classified as external and evidenced. **C2 is not started.** Nothing from C1 has been deployed.

## Next action

Phase A and Phase B are complete and validated. Phase C planning is complete (§27, 2026-09-10) and **Phase C1 implementation is complete**: preflights P1–P13 recorded (§27.29), migration 094 applied and post-validated on `afldb_test`, and every §27.25 item written — the canonical writer, the pure entry model, the derived-total helpers, the capability entries, the legacy match-sheet writer removal, both fail-closed Python reload guards, and the test suite including `tests/integration/admin-brownlow.test.ts` with its four `pg_blocking_pids()`-proved races. Writing that validation found and fixed one real defect in `recomputeBrownlowCoverage` (see the C1 record in `issues.md`).

**Phase C1 is complete and its gate is green (§27.31, 2026-09-10).** The `afldb_test` fixture residue was removed by a guarded, committed cleanup (419 rows, every guard and postcondition zero/green); the §27.30 harness defect is **fixed and validated on both abnormal paths**, with independent post-run verification showing `ISSUE155_RESIDUE_ZERO: YES`; typecheck is green, `admin-brownlow` is 44/44, and the four remaining failures across `data-editor`, `privileges` and `release-gates` are proved to be 2026 current-season/test-database drift (`PURE_2026_DRIFT_CONFIRMED: YES`) owned outside this issue.

Next: commit the C1 closeout, then **Phase C2** — model Sonnet, effort high, fresh session — using §27.26. Nothing is deployed. Two items belong to other owners and must not be absorbed into C2: the §27.31 database-state policy question (release-gate season bounds versus current-season rows in `afldb_test`, which also owns the `data-editor` ladder assertion), and the `external_grid_axes` / `external_grids` privilege mismatch. Phases D–I remain unstarted.
