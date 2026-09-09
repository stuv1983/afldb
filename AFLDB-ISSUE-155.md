# AFLDB-ISSUE-155 — Admin / Super Admin overhaul

**Status:** Open / In progress
**Severity:** Medium
**Area:** Admin, authentication, data management, acquisition, provenance
**Found:** 2026-09-10
**Implementation:** Phase A (§23) complete and verified 2026-09-10 — see `issues.md` for the record. Phase B (§26) complete and validated 2026-09-10 — see §26.20 for the record. Phases C–I not started.

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
**Model/effort:** `gpt-6-astra`, xhigh.

### Phase C2 — Brownlow Admin UI

**Objective:** fast season/round/match entry, draft, finalise, correction and provenance UI.
**Scope:** new routes/components, status badges, remove/read-only legacy match-sheet field, revalidation.
**Migrations:** none beyond C1.
**Likely files:** likely `src/app/admin/brownlow/**`; existing match sheet form; Admin nav/dashboard; Brownlow browser tests.
**Validation gate:** component/action tests → affected route tests → Brownlow E2E including invalid participant/duplicate/stale edit → responsive E2E.
**Dependencies:** C1 and owner decision on Admin draft access.
**Stop:** UI can submit a player outside the server-loaded participant set or bypass season publication review.
**Model/effort:** `gpt-6-astra`, high.

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

## Next action

Phase A and Phase B are complete and validated; both are uncommitted in the worktree and await the operator’s review and commit. The next action is to plan Phase C (Brownlow administration) in a fresh session — model Opus, effort high — reading §10 for intent and §26.20 for the Phase B record before designing it. Phases C–I remain unstarted.
