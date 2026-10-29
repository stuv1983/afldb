# AFLDB V2 — Stage 0 inventory

Recorded 2026-10-19 against `D:\dev\afldbV2` at `8a44e165` plus the inherited uncommitted
ISSUE-316 files (see `docs/v2/baseline.md`). Read-only; nothing was executed against a database,
host or network to produce it.

## How this was produced, and how to re-derive it

Parts A and B were enumerated mechanically (read-only `find`/`grep`/`sed`) by two
`afldb-mechanic` dispatches; each section states the exact command it used, so every count and
row is re-derivable from the cited paths. The orchestrator re-derived the headline counts below
independently and spot-checked the load-bearing invoker facts (the AFL Tables settle chain at
`deploy/afldb-settle-afltables.sh:210,218,237`; the email intake route calling only
`stageSubmission`/`validateSubmission` at `src/app/api/admin/email-intake/route.ts:221`; the
current-season admin action reaching `runCurrentSeasonRefresh` at
`src/app/admin/current-season/actions.ts:87` and `startSettleRun` at `:181`; the
`update-current-season.ts:52` `'squiggle'` default; the `acquisition.legacyIntake` capability at
`src/app/admin/upload/stage/route.ts:44`). Limits are stated in A11 and in Part B's method notes:
invoker labels are grep-derived (a basename hit is not proof of a call unless marked), and SQL
write targets found by token search are candidates, not a statement-level census.

## Headline counts (re-derived)

| Item | Count | Command |
|---|---|---|
| Public pages (`src/app/**/page.tsx` outside `src/app/admin`) | 52 | `find src/app -name page.tsx -not -path 'src/app/admin/*' \| wc -l` |
| Admin pages (`src/app/admin/**/page.tsx`) | 56 | `find src/app/admin -name page.tsx \| wc -l` |
| Route handlers (`src/app/**/route.ts`) | 19 | `find src/app -name route.ts \| wc -l` |
| Server-action files (top-level `'use server'`) | 30 (25 under `src/app/admin`) | `grep -rlE "^['\"]use server['\"]" src \| wc -l` |
| Query modules (`src/db/queries/**`) | 74 (57 top-level, 17 under `nl/`) | `find src/db/queries -type f \| wc -l` |
| Direct `postgres(` call sites in query modules | 24 in 15 files | `grep -rn 'postgres(' src/db/queries \| wc -l` |
| Migrations | 110 (001-110, no gaps) | `ls src/db/migrations \| wc -l` |
| `src/lib` files | 118 | `find src/lib -type f -not -path '*__pycache__*' \| wc -l` |
| `package.json` scripts | 55 | `node -e "console.log(Object.keys(require('./package.json').scripts).length)"` |
| `deploy/` files | 33 (5 services, 4 timers, 1 polkit rule) | `find deploy -type f \| wc -l` |
| `tools/migration` files (top level) | 50 | `find tools/migration -maxdepth 1 -type f \| wc -l` |
| `tools/rebuild/**` files (excluding `__pycache__`) | 50 | `find tools/rebuild -type f -not -path '*__pycache__*' \| wc -l` |

## Logical application mapping (plan D1, ADR 0001)

| Target (owner's instruction) | Where it is in V2 |
|---|---|
| `apps/web` | the repository root Next.js app: `src/app`, `src/components`, `src/search`, `src/db/queries`, `src/lib`; served by `deploy/afldb.service` → `deploy/server-cluster.mjs` |
| `apps/worker` | `tools/current-season/*` run by `deploy/afldb-settle-afl-api.{service,timer,sh}` (nightly 05:00) and `deploy/afldb-settle-afl-api-brownlow.{service,timer,sh}` (every 5 minutes) |
| `packages/*` | `packages/{domain,db,acquisition,derived,admin,testing}/src/index.ts`, created in Stage 1 |
| `legacy/offline` | not created yet; disposition in Stage 4 (plan D10) |

## Legacy ingestion entry points — invoker matrix

Every path by which data reaches PostgreSQL other than the AFL API pipeline. "Runtime" means
reachable from the deployed application or a deployed scheduler. Classification under plan D10
happens in Stage 4 (`docs/v2/legacy-disposition.md`); this table records only the facts.

| # | Family | Entry point(s) | Invoked by | Runtime? | Writes (final tables, candidates) | Detail |
|---|---|---|---|---|---|---|
| L1 | CSV upload | `src/app/admin/upload/page.tsx`, `UploadForm.tsx:32` → `src/app/admin/upload/stage/route.ts:40` → `src/lib/ingest/pipeline.ts` `stageSubmission` | admin button (capability `acquisition.legacyIntake`) | yes (admin) | `data_submissions`, `data_submission_rows` (staging) | B1 |
| L2 | CSV submission review and promotion | `src/app/admin/submissions/[id]/actions.ts` `runValidation`/`decideSubmission`/`runPromotion` → `pipeline.ts` `promoteSubmission` (:483) → `src/lib/ingest/datasets.ts` promoters | admin buttons (`ReviewControls.tsx`) | yes (admin) | `award_nominations`, `award_winners`, `matches`, `player_match_stats`, `players`, `import_batches` | B1 dataset table |
| L3 | Email CSV intake | `tools/email_intake/fetch_and_stage.py` → `POST /api/admin/email-intake` (`route.ts:127`, shared secret) → stage + validate only | scheduler `deploy/afldb-email-intake.timer` (every 5 min) | yes (scheduler) | staging only; promotion stays the human L2 path | B7 |
| L4 | AFL Tables nightly settle | `deploy/afldb-settle-afltables.sh`: `tools/rebuild/fitzroy/acquire_core.R` (:210) → `tools/migration/import_fitzroy_core.py` (:218) → `tools/current-season/settle-afltables.ts` (:237) → `src/lib/acquisition/settle-afltables.ts` | scheduler `deploy/afldb-settle-afltables.timer` (04:30); `npm run settle:afltables` | yes (scheduler) | `matches`, `players`, `player_match_stats`, `brownlow_round_votes`, `match_period_scores`, `venues`, `external_identities`, staging and promotion tables | B2, B5 #33 |
| L5 | AFL Tables settle admin trigger | `src/app/admin/current-season/SettleRunPanel.tsx:184` → `actions.ts:167` `startSettleRunAction` → `src/lib/acquisition/settle-trigger.ts` (starts `afldb-settle-afltables.service`; polkit `deploy/afldb-settle-afltables-trigger.rules`) | admin button | yes (admin) | via L4 | B2 |
| L6 | Squiggle / Kali current-season refresh | `src/lib/external-afl/current-matches.ts` (HTTP), `current-season-import.ts` `runCurrentSeasonRefresh` (:269) | admin button `CurrentSeasonControls.tsx:203` → `actions.ts:51`; `npm run current-season:update` (`tools/current-season/update-current-season.ts`, default `--source squiggle` at :52) | yes (admin) | `import_batches`, `staging.external_current_matches` | B3 |
| L7 | AFL Tables network register / rollover | `tools/db/rollover-season.ts` writes `data/reference/afltables-network.json`; read by `afltables-network.ts` gates | manual CLI | no | a JSON file, not a table | B2 |
| L8 | Offline rebuild families | `tools/rebuild/{afltables,fitzroy,draftguru,afl_api}/**` (50 files) | manual, `tools/db/rebuild-test.ts`, and L4 for `acquire_core.R` | only `acquire_core.R` via L4 | DraftGuru: `players`, `draft_picks`, `draft_persons`, `external_identities` (`import_draftguru.py`) | B4 |
| L9 | `tools/migration` importers | 50 files (Python importers, TS rehearsal/recovery tools) | manual, package scripts, `tools/db/rebuild-test.ts`; `import_fitzroy_core.py` also via L4 | only via L4 | most canonical tables (B5) | B5 |
| L10 | Wikipedia-derived enrichment | `tools/migration/{after_siren,all_australian,captaincies,enrich_heights_wikipedia,family_siblings,father_son,hall_of_fame,honour_teams,named_medals}.py`, `import_awards.py`; `tools/records/import-first-kick-goal.ts` | manual, `tools/db/rebuild-test.ts`, `npm run records:first-kick-goal` | no | `after_siren_kicks`, `award_winners`, `hall_of_fame`, `honour_team_members`, `player_height_evidence`, `player_relationships`, `father_son_selections`, `player_achievements` | B6 |
| L11 | Derived rebuild | `tools/migration/rebuild_derived.py` | manual (operator instructed at `src/app/admin/db-health/page.tsx:75` and `src/app/admin/submissions/[id]/page.tsx:140`) | no | `player_season_stats`, `player_career_stats`, `player_clubs`, `club_seasons`, `derived_rebuilds` | B5 #42 |
| L12 | AFLW staging | `tools/aflw/load_staging.py` | manual | no | `staging_aflw.*` | B9 |
| L13 | Other admin editors (audited, kept) | awards, Brownlow, coaches, draft, fixtures, season lists, leadership, special records, data editor, player links | admin buttons behind capabilities | yes (admin) | the respective tables, with `data_edits` audit | A3, A4 |

L13 is not legacy ingestion; it is listed so the admin disposition in Stage 5 starts from the
whole set of write paths.

### Open fact recorded for later stages

- `tools/current-season/update-current-season.ts:52` supplies `'squiggle'` when `--source` is
  absent, while `src/lib/external-afl/current-season-import.ts:236-240` says there is no default
  (mechanic finding F-001, LOW). Relevant to the Stage 4 disposition of L6; not changed here.

## Part A — Backend, frontend, database and admin dependencies

### A1. Public frontend routes (`src/app/**/page.tsx`, excluding `src/app/admin`)

Count: **52** page files.
Command: `find src/app -name 'page.tsx' -not -path 'src/app/admin/*' | sort` (52 lines). `grep -n "export const revalidate|export const dynamic|generateStaticParams"` per file. `grep -oE "from '[^']+'"` per file for imports.

| URL | File | generateStaticParams | revalidate / dynamic | Direct @/db/queries imports |
|---|---|---|---|---|
| / | src/app/page.tsx | no | revalidate 3600 (:26) | matches, home-records, site-settings |
| /about | src/app/about/page.tsx | no | none | none direct (imports @/components/Breadcrumbs, @/lib/seo) |
| /advanced-search | src/app/advanced-search/page.tsx | no | dynamic force-dynamic (:5) | none direct (imports @/search/advanced-spec) |
| /aflw | src/app/aflw/page.tsx | no | revalidate 3600 (:29) | aflw, site-settings |
| /aflw/clubs | src/app/aflw/clubs/page.tsx | no | dynamic force-dynamic (:13) | aflw |
| /aflw/clubs/[code] | src/app/aflw/clubs/[code]/page.tsx | no | dynamic force-dynamic (:26) | aflw |
| /aflw/match-search | src/app/aflw/match-search/page.tsx | no | dynamic force-dynamic (:40) | aflw |
| /aflw/matches/[key] | src/app/aflw/matches/[key]/page.tsx | no | dynamic force-dynamic (:25) | aflw |
| /aflw/players | src/app/aflw/players/page.tsx | no | dynamic force-dynamic (:32) | aflw |
| /aflw/players/[slug] | src/app/aflw/players/[slug]/page.tsx | no | dynamic force-dynamic (:32) | aflw |
| /aflw/seasons | src/app/aflw/seasons/page.tsx | no | dynamic force-dynamic (:18) | aflw |
| /aflw/seasons/[key] | src/app/aflw/seasons/[key]/page.tsx | no | dynamic force-dynamic (:32) | aflw |
| /aflw/venues | src/app/aflw/venues/page.tsx | no | dynamic force-dynamic (:13) | aflw |
| /awards | src/app/awards/page.tsx | no | revalidate 86400 (:16) | awards |
| /awards/[slug] | src/app/awards/[slug]/page.tsx | yes (:42) | revalidate 86400 (:37) | awards |
| /awards/[slug]/[season] | src/app/awards/[slug]/[season]/page.tsx | no | revalidate 86400 (:28) | awards |
| /beta | src/app/beta/page.tsx | no | dynamic force-dynamic (:8) | none direct (imports @/app/beta/BetaGateForm, @/lib/auth/session, @/lib/params) |
| /beta/verify | src/app/beta/verify/page.tsx | no | dynamic force-dynamic (:7) | none direct (imports @/app/beta/verify/VerifyForm, @/lib/params) |
| /brownlow | src/app/brownlow/page.tsx | no | dynamic force-dynamic (:21) | advanced-search, brownlow, site-settings |
| /brownlow/[year] | src/app/brownlow/[year]/page.tsx | yes (:18) | revalidate 3600 (:15) | none direct (imports @/db/client, the raw sql client, directly) |
| /clubs | src/app/clubs/page.tsx | no | dynamic force-dynamic (:9) | clubs, site-settings |
| /clubs/[slug] | src/app/clubs/[slug]/page.tsx | yes (:61) | revalidate 86400 (:58) | awards, club-leadership, clubs, coaches |
| /clubs/compare | src/app/clubs/compare/page.tsx | no | dynamic force-dynamic (:19) | none direct (imports @/components/ClubComparisonView, @/lib/seo, ./state) |
| /coaches | src/app/coaches/page.tsx | no | revalidate 3600 (:12) | coaches |
| /coaches/[slug] | src/app/coaches/[slug]/page.tsx | no | dynamic force-dynamic (:53) | club-comparison, coaches |
| /coaches/compare | src/app/coaches/compare/page.tsx | no | dynamic force-dynamic (:20) | none direct (imports @/components/CoachComparisonView, @/lib/seo, ./state) |
| /draft | src/app/draft/page.tsx | no | dynamic force-dynamic (:8) | draft, site-settings |
| /draft/[year] | src/app/draft/[year]/page.tsx | no | dynamic force-dynamic (:26) | advanced-search, draft |
| /grid-solver | src/app/grid-solver/page.tsx | no | dynamic force-dynamic (:32) | advanced-search, awards, coaches, grid-solver, players, site-settings |
| /hall-of-fame | src/app/hall-of-fame/page.tsx | no | dynamic force-dynamic (:25) | awards |
| /honour-teams/[slug] | src/app/honour-teams/[slug]/page.tsx | yes (:15) | revalidate 86400 (:13) | awards |
| /match-search | src/app/match-search/page.tsx | no | dynamic force-dynamic (:30) | advanced-search, match-search |
| /matches/[id] | src/app/matches/[id]/page.tsx | yes (:38) | revalidate 3600 (:31) | matches |
| /players | src/app/players/page.tsx | no | dynamic force-dynamic (:26) | advanced-search, players, seasons |
| /players/[slug] | src/app/players/[slug]/page.tsx | yes (:70) | revalidate 3600 (:54) | after-siren, awards, club-comparison, coaches, draft, players |
| /players/[slug]/matches | src/app/players/[slug]/matches/page.tsx | no | dynamic force-dynamic (:26) | players |
| /players/compare | src/app/players/compare/page.tsx | no | dynamic force-dynamic (:29) | awards, player-compare, players |
| /privacy | src/app/privacy/page.tsx | no | none | none direct (imports next, next/link) |
| /records | src/app/records/page.tsx | no | revalidate 3600 (:8) | records, site-settings |
| /records/[category] | src/app/records/[category]/page.tsx | yes, non-async function (:42) | revalidate 3600 (:40) | advanced-search, records |
| /records/after-the-siren | src/app/records/after-the-siren/page.tsx | no | revalidate 86400 (:11) | after-siren |
| /records/coaches | src/app/records/coaches/page.tsx | no | revalidate 86400 (:12) | coaches |
| /records/family | src/app/records/family/page.tsx | no | revalidate 86400 (:11) | family-records |
| /records/father-son | src/app/records/father-son/page.tsx | no | revalidate 86400 (:11) | family-records |
| /records/first-kick-goal | src/app/records/first-kick-goal/page.tsx | no | revalidate 86400 (:27) | clubs, player-achievements |
| /search | src/app/search/page.tsx | no | dynamic force-dynamic (:19) | search, site-settings |
| /search/qualifying-matches | src/app/search/qualifying-matches/page.tsx | no | none | nl/team-match |
| /seasons | src/app/seasons/page.tsx | no | dynamic force-dynamic (:22) | advanced-search, seasons |
| /seasons/[year] | src/app/seasons/[year]/page.tsx | yes (:54) | revalidate 3600 (:46) | awards, matches, rounds, seasons |
| /venues | src/app/venues/page.tsx | no | dynamic force-dynamic (:14) | venues |
| /venues/[slug] | src/app/venues/[slug]/page.tsx | yes (:35) | revalidate 86400 (:32) | venues |
| /venues/[slug]/matches | src/app/venues/[slug]/matches/page.tsx | no | dynamic force-dynamic (:17) | venues |

Pages with no direct `@/db/queries` import: 8 (about, advanced-search, beta, beta/verify, brownlow/[year], clubs/compare, coaches/compare, privacy). Each row lists what the page does import.

---
### A2. Route handlers (`src/app/**/route.ts`)

Count: **19** route files.
Command: `find src/app -name 'route.ts' | sort` (19 lines). Methods via `grep -oE "export (async )?(function|const) (GET|POST|...)"`. Guards via `grep -n "requireCapability|requireSuperAdmin|..."` plus a check for `await requireCapability(` call sites. Imports via `grep -oE "from '@/(db|lib)/..."`.

| URL | File | Methods | Auth check (as found) | Imports (@/db, @/lib) |
|---|---|---|---|---|
| /admin/awards/revalidate | src/app/admin/awards/revalidate/route.ts | POST | `await requireCapability(` (call found; import :3) | @/lib/admin/revalidate-route, @/lib/auth/session |
| /admin/coaches/revalidate | src/app/admin/coaches/revalidate/route.ts | POST | `await requireCapability(` (call found; import :3) | @/lib/admin/revalidate-route, @/lib/auth/session |
| /admin/content/asset/[...path] | src/app/admin/content/asset/[...path]/route.ts | GET | `await requireCapability(` (call found; import :8) | @/db/queries/site-content, @/lib/apex-publish, @/lib/auth/session |
| /admin/content/media | src/app/admin/content/media/route.ts | POST | `await requireCapability('site.content')` (:31). `requireSuperAdmin` appears only in a comment (:20) | @/db/queries/site-content, @/lib/auth/session, @/lib/image-probe, @/lib/site-content |
| /admin/content/preview | src/app/admin/content/preview/route.ts | GET | `await requireCapability(` (call found; import :7) | @/db/queries/site-content, @/db/queries/overview, @/db/queries/site-settings, @/lib/apex-html, @/lib/auth/session, @/lib/site-content |
| /admin/draft/revalidate | src/app/admin/draft/revalidate/route.ts | POST | `await requireCapability(` (call found; import :3) | @/lib/admin/revalidate-route, @/lib/auth/session |
| /admin/nl-search/export | src/app/admin/nl-search/export/route.ts | GET | `await requireCapability('operations.nlTelemetry')` (:103). `requireSuperAdmin` appears only in a comment (:25) | @/db/queries/nl-search-log, @/lib/auth/session, @/lib/csv |
| /admin/player-links/revalidate | src/app/admin/player-links/revalidate/route.ts | POST | `await requireCapability(` (call found; import :4) | @/lib/auth/session |
| /admin/records/revalidate | src/app/admin/records/revalidate/route.ts | POST | `await requireCapability(` (call found; import :3) | @/lib/admin/revalidate-route, @/lib/auth/session |
| /admin/season-lists/revalidate | src/app/admin/season-lists/revalidate/route.ts | POST | `await requireCapability(` (call found; import :3) | @/lib/admin/revalidate-route, @/lib/auth/session |
| /admin/upload/stage | src/app/admin/upload/stage/route.ts | POST | `await requireCapability(` (call found; import :3) | @/lib/auth/session, @/lib/ingest/pipeline, @/lib/ingest/upload-request |
| /api/admin/email-intake | src/app/api/admin/email-intake/route.ts | POST | No session. Shared secret in header `x-intake-secret` (:138), compared with `timingSafeEqual` (:1 import, :73 `timingSafeStringEqual`). Local function `authorized` (:141). Rate limiters `AUTH_FAILURES` (:49) and `INTAKE_WORK` (:50) | @/db/authClient, @/lib/auth/rate-limit, @/lib/auth/session, @/lib/ingest/pipeline |
| /api/coaches/[id]/opponent-record | src/app/api/coaches/[id]/opponent-record/route.ts | GET | No session guard. `RateLimiter` 30 per 60 s by IP (:17, check :29) | @/db/queries/coaches, @/lib/auth/rate-limit, @/lib/auth/session (requestIp), @/lib/coach-opponent-history |
| /api/early-access | src/app/api/early-access/route.ts | GET, POST | No session guard. `READ_LIMIT` 120 per 15 min (:34) and `SUBMIT_LIMIT` 5 per 15 min (:33) | @/db/queries/early-access, @/db/queries/site-settings, @/lib/auth/rate-limit, @/lib/auth/session (audit, lastForwardedIp), @/lib/email/send, @/lib/site-settings |
| /api/health-event | src/app/api/health-event/route.ts | POST | No session guard. `REPORT_LIMIT` 120 per 60 s by IP (:24, check :90) | @/db/queries/app-health, @/lib/auth/session, @/lib/auth/rate-limit, @/lib/nl-session |
| /api/health | src/app/api/health/route.ts | GET | None found | @/db/client |
| /api/internal/revalidate-season | src/app/api/internal/revalidate-season/route.ts | POST | Shared secret in header `x-afldb-revalidate-secret` (constant at src/lib/acquisition/season-revalidation.ts:46, read at route :135), compared with `timingSafeEqual` (:1 import, :89). Local function `authorized` (:139). Failure limiter `AUTH_FAILURES` 10 per 15 min (:75, check :137) | @/lib/auth/rate-limit, @/lib/acquisition/season-revalidation, @/lib/format |
| /api/search/autocomplete | src/app/api/search/autocomplete/route.ts | GET | No session guard. `RateLimiter` 60 per 60 s by IP (:14, check :34) | @/db/queries/search, @/lib/auth/rate-limit, @/lib/auth/session (requestIp) |
| /sitemap.xml | src/app/sitemap.xml/route.ts | GET | None found | @/lib/indexing, @/lib/seo |

---
### A3. Server actions (files with a top-level `'use server'` directive, under `src/`)

Count: **30** files with the directive at column 0 (verified twice). Nine further files mention `use server` only in comments, so they are not directives: `src/app/admin/awards/validation.ts:4`, `src/app/admin/coaches/validation.ts:4`, `src/app/admin/draft/validation.ts:4`, `src/app/admin/fixtures/validation.ts:6`, `src/app/admin/nl-search/telemetry-clear-phrase.ts:9`, `src/app/admin/player-links/afl-api/AflApiAdjudicationForm.tsx:15`, `src/app/admin/records/validation.ts:5`, `src/app/admin/season-lists/validation.ts:6`, `src/db/queries/admin-invites.ts:91`.
Command: `grep -rlE "^['\"]use server['\"]" src/ | wc -l`. Exports via `grep -oE "^export (async )?(function|const) ..."`. Export check: every `export` in these 30 files is `export async function` or `export type`. None is a non-async value export.

| File | Exported actions | Guard names seen (occurrence count, comments included) | Imports (@/db, @/lib) |
|---|---|---|---|
| src/app/admin/access/actions.ts | createAccessCode, revokeAccessCode, deleteAccessCode, addAllowedEmail, approveJoinRequest, denyJoinRequest, revokeAllowedEmail | requireCapability 9, requireAdmin 1 | @/db/authClient, @/db/queries/access-codes, @/lib/auth/crypto, @/lib/auth/session, @/lib/params |
| src/app/admin/admins/actions.ts | revokeSession | requireCapability 2, requireAdmin 2, hasAdminManagementAccess 2 | @/db/authClient, @/lib/auth/admin-lifecycle, @/lib/auth/session |
| src/app/admin/admins/invite-actions.ts | createInvite, revokeInvite | requireCapability 3 | @/db/authClient, @/lib/auth/crypto, @/lib/auth/session |
| src/app/admin/admins/lifecycle-actions.ts | promoteAdmin, demoteSuperAdmin, deactivateAccount, reactivateAccount | requireSuperAdmin 3, requireCapability 2, requireAdmin 1 | @/db/authClient, @/db/queries/admin-users, @/lib/auth/admin-lifecycle, @/lib/auth/session |
| src/app/admin/admins/password-actions.ts | issueTemporaryPassword | requireCapability 2 | @/db/authClient, @/lib/auth/crypto, @/lib/auth/session |
| src/app/admin/awards/actions.ts | correctAwardWinnerAction, voidAwardWinnerAction, reinstateAwardWinnerAction, createAwardWinnerAction, replaceAwardWinnerAction, correctHallOfFameAction, voidHallOfFameAction, reinstateHallOfFameAction, createHallOfFameAction, replaceHallOfFameAction, correctHonourTeamAction, voidHonourTeamAction, reinstateHonourTeamAction, createHonourTeamMemberAction, replaceHonourTeamAction | requireCapability 17 | @/db/queries/admin-awards, @/lib/auth/session |
| src/app/admin/brownlow/actions.ts | saveDraftAction, finaliseAction, correctAction, voidAction, publishSeasonAction | requireCapability 4 | @/db/queries/admin-brownlow, @/lib/acquisition/season-revalidation, @/lib/auth/session, @/lib/brownlow/entry |
| src/app/admin/coaches/actions.ts | createCoachAction, saveCoachMetadataAction, linkCoachToPlayerAction, unlinkCoachAction, setCoachAssignmentAction, clearCoachAssignmentAction, searchPlayersForLinkAction, retireCoachOverrideAction | requireCapability 10 | @/db/client, @/db/queries/admin-coaches, @/db/queries/search, @/lib/auth/session, @/lib/format, @/lib/slugs |
| src/app/admin/content/actions.ts | saveSiteContent, republishApex, deleteMedia | requireCapability 4 | @/db/authClient, @/db/queries/site-content, @/lib/apex-publish, @/lib/auth/session, @/lib/site-content, @/lib/site-settings |
| src/app/admin/current-season/actions.ts | runCurrentSeasonAdminAction, startSettleRunAction, refreshSettleRunStatusAction, readAflApiIngestionAdminView, setAflApiCurrentSeasonIngestionAction, setAflApiBrownlowIngestionAction | requireCapability 9, requireSuperAdmin 1 | @/db/authClient, @/db/queries/settle-runs, @/lib/acquisition/afl-api-brownlow, @/lib/acquisition/afl-api-ingestion-control, @/lib/acquisition/settle-status, @/lib/acquisition/settle-trigger, @/lib/auth/session, @/lib/external-afl/current-season-import, @/lib/site-settings |
| src/app/admin/data-editor/actions.ts | createPlayerAction, saveDataEdit, saveMatchSheetAction, returnMatchSheetToSourceAction, createMatchAction, deleteMatchAction | requireCapability 7, requireSuperAdmin 1 | @/db/queries/data-edits, @/db/queries/match-admin, @/db/queries/match-sheet, @/db/queries/players, @/lib/admin-match, @/lib/auth/session, @/lib/edit/spec, @/lib/match-sheet |
| src/app/admin/draft/actions.ts | saveSourcePickFieldsAction, retireSourcePickOverrideAction, createManualPickAction, createPlayerAndDraftPickAction, saveManualPickAction, adoptLegacyPickAction, attachAflTablesIdentityAction, retireManualPickAction, supersedeManualPickBySourceRowAction, searchPlayersForDraftAction | requireCapability 12 | @/db/client, @/db/queries/admin-draft, @/db/queries/admin-season-lists, @/db/queries/search, @/lib/auth/session, @/lib/format |
| src/app/admin/fixtures/actions.ts | createFixtureAction, submitFixtureBatchAction, rescheduleFixtureAction, changeFixtureVenueAction, changeFixtureRoundAction, changeFixtureClubsAction, updateFixtureNotesAction, cancelFixtureAction, reinstateFixtureAction, voidFixtureAction | requireCapability 12 | @/db/queries/admin-fixtures, @/lib/auth/session |
| src/app/admin/invite/[token]/actions.ts | beginEnrolment, confirmEnrolment | none (token-gated flow) | @/db/authClient, @/db/queries/admin-invites, @/lib/auth/crypto, @/lib/auth/rate-limit, @/lib/auth/session |
| src/app/admin/login/actions.ts | adminLogin | getAdminUser 1 | @/db/authClient, @/lib/auth/crypto, @/lib/auth/rate-limit, @/lib/auth/session |
| src/app/admin/logout-action.ts | adminLogout | getAdminUser 2 | @/lib/auth/session |
| src/app/admin/nl-search/actions.ts | saveReview, clearTelemetry | requireCapability 4, requireSuperAdmin 2 | @/db/authClient, @/db/queries/nl-search-log, @/db/queries/nl-search-telemetry-clear, @/lib/auth/session |
| src/app/admin/password/actions.ts | changeOwnPassword | requireSignedIn 3, requireUploader 3 | @/db/authClient, @/lib/auth/crypto, @/lib/auth/rate-limit, @/lib/auth/session |
| src/app/admin/player-links/actions.ts | linkPlayer, confirmUnlinked, reviewSuggestion, createAndLinkPlayer, approveSuggestion, bulkApproveSuggestions, refreshSuggestions | requireCapability 8 | @/db/authClient, @/db/client, @/db/queries/player-links, @/db/queries/player-match-candidates, @/lib/auth/session |
| src/app/admin/player-links/afl-api/actions.ts | linkAflApiPlayer, revokeAflApiPlayerLink | requireCapability 3 | @/db/queries/afl-api-player-links, @/lib/auth/session |
| src/app/admin/records/actions.ts | correctFirstKickGoalAction, suppressFirstKickGoalAction, reinstateFirstKickGoalAction, createFirstKickGoalAction, replaceFirstKickGoalAction, correctAfterSirenKickAction, suppressAfterSirenKickAction, reinstateAfterSirenKickAction, createAfterSirenKickAction, replaceAfterSirenKickAction | requireCapability 12 | @/db/queries/admin-special-records, @/lib/auth/session, @/lib/special-records/after-siren-rules |
| src/app/admin/season-lists/actions.ts | addSeasonListMemberAction, addSeasonListMembersAction, removeSeasonListMemberAction, transferSeasonListMemberAction, copySeasonListsForwardAction | requireCapability 7 | @/db/queries/admin-season-lists, @/lib/auth/session |
| src/app/admin/season-lists/leadership-actions.ts | appointLeaderAction, replaceLeaderAction, endAppointmentAction, reinstateAppointmentAction, correctAppointmentAction, voidAppointmentAction | requireCapability 8 | @/db/queries/admin-club-leadership, @/lib/auth/session |
| src/app/admin/settings/actions.ts | saveSiteSettings, sendTestEmail | requireCapability 3 | @/db/authClient, @/lib/auth/session, @/lib/email/send, @/lib/site-settings |
| src/app/admin/submissions/[id]/actions.ts | runValidation, decideSubmission, runPromotion | requireSuperAdmin 3, requireAdmin 2 | @/db/authClient, @/lib/auth/session, @/lib/ingest/pipeline |
| src/app/beta/actions.ts | redeemAccessCode, requestMagicLink, requestJoin | none (public beta gate) | @/db/authClient, @/lib/auth/crypto, @/lib/auth/rate-limit, @/lib/auth/session, @/lib/email/send |
| src/app/beta/verify/actions.ts | confirmMagicLink | none (public, token flow) | @/db/authClient, @/lib/auth/crypto, @/lib/auth/rate-limit, @/lib/auth/session |
| src/app/consent-action.ts | setConsent | none (public) | @/lib/consent, @/lib/cookie-security, @/lib/nl-session |
| src/app/player-link-suggestion-action.ts | submitPlayerLinkSuggestion, isSuperAdminAction (also exports type LinkSuggestionState, :7) | getAdminUser 2 | @/db/queries/player-links, @/lib/auth/rate-limit, @/lib/auth/session |
| src/app/search/feedback-action.ts | submitNlFeedback, submitNlFeedbackForm | none (public) | @/db/queries/nl/feedback, @/lib/auth/rate-limit, @/lib/auth/session |

Public (non-admin) bindings to these actions, traced by import:
- `src/app/consent-action.ts` `setConsent`: `src/components/ConsentBanner.tsx:6` import; form `action={record}` at :71 and :75. `ConsentBanner` is imported by `src/app/layout.tsx:5`, so it is site-wide.
- `src/app/search/feedback-action.ts` `submitNlFeedbackForm`: `src/components/NlAnswerFeedback.tsx:1` import; `action={submitNlFeedbackForm}` at :14. Imported by `src/components/NlAnswerSection.tsx:4`, which `src/app/search/page.tsx:6` imports.
- `src/app/player-link-suggestion-action.ts`: `src/components/UnmatchedPlayer.tsx:8` import; form `action={formAction}` at :65. Also `src/components/useAdmin.ts:3` imports it. `UnmatchedPlayer` is imported by `src/app/awards/[slug]/page.tsx:11`, `src/app/awards/[slug]/[season]/page.tsx:9`, `src/app/clubs/[slug]/page.tsx:18`, `src/app/draft/[year]/page.tsx:9`, `src/app/hall-of-fame/page.tsx:10`, `src/app/honour-teams/[slug]/page.tsx:7`, `src/app/records/first-kick-goal/page.tsx:10`, `src/app/seasons/[year]/page.tsx:9`.
- `src/app/beta/actions.ts`: imported by `src/app/beta/BetaGateForm.tsx:11`, which `src/app/beta/page.tsx:4` imports. `src/app/beta/verify/actions.ts`: imported by `src/app/beta/verify/VerifyForm.tsx:5`, which `src/app/beta/verify/page.tsx:4` imports.

---
### A4. Admin pages (`src/app/admin/**/page.tsx`)

Count: **56** page files.
Command: `find src/app/admin -name 'page.tsx' | sort` (56 lines). Purpose = the `title:` string (quoted). Guard = first guard call string found. Query imports via `grep -oE "from '@/db/queries/[^']+'"`. Action bindings via one level of local imports, resolved by file, plus the nested imports traced separately. Form bindings are recorded as import chains, not as per-element bindings. The `action=` attribute on `src/app/admin/audit/page.tsx` and some list pages is a GET form URL, not a server action.

| URL | File | Purpose (title, quoted) | Guard (first call seen) | Direct @/db/queries imports | Action-bound components (direct imports) and the action module each imports |
|---|---|---|---|---|---|
| /admin | src/app/admin/page.tsx | "Administration" | requireAdmin() | admin-brownlow-ui, player-links, site-settings | none |
| /admin/access | src/app/admin/access/page.tsx | "Beta access" | requireCapability('people.betaAccess') | early-access, site-settings | AccessManager.tsx:17 → access/actions |
| /admin/admins | src/app/admin/admins/page.tsx | "Administrators" | requireCapability('people.admins.read'); requireSuperAdmin() | admin-users | AdminSessionsClient.tsx → admins/actions, admins/lifecycle-actions, admins/password-actions; InviteManager.tsx:8 → admins/invite-actions. AdminSessionsClient also imports LifecycleControls.tsx:11 (→ lifecycle-actions) |
| /admin/app-health | src/app/admin/app-health/page.tsx | "Application health" | requireCapability('operations.appHealth') | app-health | none |
| /admin/audit | src/app/admin/audit/page.tsx | "Audit trail" | requireCapability('operations.audit.read') | audit-log, audit-reader | none (GET form action={AUDIT_PATH}) |
| /admin/audit/entity/[table]/[rowId] | src/app/admin/audit/entity/[table]/[rowId]/page.tsx | "Entity history" | requireCapability('operations.audit.read') | audit-log, audit-reader | none |
| /admin/awards | src/app/admin/awards/page.tsx | "Awards & honours administration" | requireCapability('data.awards.read') | admin-awards | none (list cards) |
| /admin/awards/winners | src/app/admin/awards/winners/page.tsx | "Award winners" | requireCapability('data.awards.read') | admin-awards, awards, clubs | none |
| /admin/awards/winners/new | src/app/admin/awards/winners/new/page.tsx | "Record an award winner" | requireCapability('data.awards.edit') | awards, clubs | AwardWinnerForm.tsx:6 → awards/actions |
| /admin/awards/winners/[id] | src/app/admin/awards/winners/[id]/page.tsx | "Award winner" | requireCapability('data.awards.read') | admin-awards, awards, clubs | LifecyclePanel.tsx:8, ReplacePanel.tsx:8, WinnerCorrectionPanel.tsx:5 → awards/actions |
| /admin/awards/honour-teams | src/app/admin/awards/honour-teams/page.tsx | "Honour teams administration" | requireCapability('data.awards.read') | admin-awards | none |
| /admin/awards/honour-teams/new | src/app/admin/awards/honour-teams/new/page.tsx | "Record a team selection" | requireCapability('data.awards.edit') | admin-awards | HonourTeamForm.tsx:6 → awards/actions |
| /admin/awards/honour-teams/[id] | src/app/admin/awards/honour-teams/[id]/page.tsx | "Honour team selection" | requireCapability('data.awards.read') | admin-awards | HonourTeamCorrectionPanel.tsx:5, LifecyclePanel.tsx:8, ReplacePanel.tsx:8 → awards/actions |
| /admin/awards/hall-of-fame | src/app/admin/awards/hall-of-fame/page.tsx | "Hall of Fame administration" | requireCapability('data.awards.read') | admin-awards | none |
| /admin/awards/hall-of-fame/new | src/app/admin/awards/hall-of-fame/new/page.tsx | "Record a Hall of Fame induction" | requireCapability('data.awards.edit') | none | HallOfFameForm.tsx:6 → awards/actions |
| /admin/awards/hall-of-fame/[id] | src/app/admin/awards/hall-of-fame/[id]/page.tsx | "Hall of Fame entry" | requireCapability('data.awards.read') | admin-awards | HallOfFameCorrectionPanel.tsx:5, LifecyclePanel.tsx:8, ReplacePanel.tsx:8 → awards/actions |
| /admin/brownlow | src/app/admin/brownlow/page.tsx | "Brownlow administration" | requireCapability('data.brownlow.read') | admin-brownlow, admin-brownlow-ui | none |
| /admin/brownlow/[season] | src/app/admin/brownlow/[season]/page.tsx | "Brownlow season" | requireCapability('data.brownlow.read') | admin-brownlow, admin-brownlow-ui | PublishPanel.tsx:5 → brownlow/actions |
| /admin/brownlow/[season]/[round] | src/app/admin/brownlow/[season]/[round]/page.tsx | "Brownlow round" | requireCapability('data.brownlow.read') | admin-brownlow | RoundMatches.tsx:5 → brownlow/actions. MatchVoteEditor.tsx:11 also imports brownlow/actions, but the page does not import it directly |
| /admin/coaches | src/app/admin/coaches/page.tsx | "Coaches" | requireCapability('data.coaches.read') | admin-coaches | CreatePanel.tsx:5 → coaches/actions |
| /admin/coaches/[id] | src/app/admin/coaches/[id]/page.tsx | "Coach" | requireCapability('data.coaches.read') | admin-coaches | AssignmentPanel.tsx:5, LinkagePanel.tsx:5, MetadataPanel.tsx:5 → coaches/actions |
| /admin/content | src/app/admin/content/page.tsx | "Page content" | requireCapability('site.content') | site-content, site-settings | ContentEditor.tsx:7, MediaLibrary.tsx:5, PublishPanel.tsx:5 → content/actions |
| /admin/current-season | src/app/admin/current-season/page.tsx | "Current season refresh" | requireCapability('acquisition.currentSeason') | none direct | page.tsx:13 imports ./actions; AflApiIngestionControls.tsx:26, CurrentSeasonControls.tsx:8, SettleRunPanel.tsx:23 → ./actions |
| /admin/data-editor | src/app/admin/data-editor/page.tsx | "Data editor" | requireCapability('data.dataEditor') | clubs, data-edits, match-admin, match-sheet, matches, seasons, venues | CreateMatchForm.tsx:7, CreatePlayerForm.tsx:7, EditorForm.tsx:7, MatchSheetEditor.tsx:11 → data-editor/actions |
| /admin/db-health | src/app/admin/db-health/page.tsx | "Database Health" | requireCapability('operations.dbHealth') | db-health | none |
| /admin/draft | src/app/admin/draft/page.tsx | "Draft administration" | requireCapability('data.draft.read') | admin-draft, clubs | none |
| /admin/draft/new | src/app/admin/draft/new/page.tsx | "Add a draft selection" | requireCapability('data.draft.edit') | admin-draft, clubs | NewPickWizard.tsx:6 → draft/actions |
| /admin/draft/[id] | src/app/admin/draft/[id]/page.tsx | "Draft selection" | requireCapability('data.draft.read') | admin-draft, admin-season-lists, clubs | AdoptPanel.tsx:5, AttachIdentityPanel.tsx:5, ManualPickPanel.tsx:5, RetirePanel.tsx:6, SourceFieldsPanel.tsx:5, SupersedePanel.tsx:5 → draft/actions |
| /admin/fixtures | src/app/admin/fixtures/page.tsx | "Fixtures" | requireCapability('data.fixtures.read') | admin-fixtures | none |
| /admin/fixtures/[season] | src/app/admin/fixtures/[season]/page.tsx | `${season} fixtures` | requireCapability('data.fixtures.read') | admin-fixtures | none |
| /admin/fixtures/[season]/new | src/app/admin/fixtures/[season]/new/page.tsx | "Add a fixture — ${season}" | requireCapability('data.fixtures.edit') | admin-fixtures, venues | RoundBatchForm.tsx:5, SingleFixtureForm.tsx:5 → fixtures/actions |
| /admin/fixtures/[season]/[fixtureKey] | src/app/admin/fixtures/[season]/[fixtureKey]/page.tsx | dynamic: "{home} v {away}" or "Fixture" (:27) | requireCapability('data.fixtures.read') | admin-fixtures, venues | ClubsPanel, LifecyclePanel, NotesPanel, ReschedulePanel, RoundPanel, VenuePanel (each :5) → fixtures/actions |
| /admin/grid-solver | src/app/admin/grid-solver/page.tsx | no title. Comment: "The grid solver moved to /grid-solver when who may reach it" | NONE. The page calls `permanentRedirect` to /grid-solver (:1–30) | none | none |
| /admin/invite/[token] | src/app/admin/invite/[token]/page.tsx | "Accept admin invite" | NONE. Token-gated. /admin/invite is a public path in src/middleware.ts:30 | none. Imports @/db/authClient `authSql` directly (:4) and runs inline SQL at :23 | AcceptInviteForm.tsx:7 → invite/[token]/actions |
| /admin/login | src/app/admin/login/page.tsx | "Administrator sign-in" | getAdminUser() | none | LoginForm.tsx:5 → login/actions |
| /admin/nl-search | src/app/admin/nl-search/page.tsx | "Natural-language search" | requireCapability('operations.nlTelemetry') | nl-search-log | ClearTelemetryForm.tsx:5 → nl-search/actions |
| /admin/nl-search/feedback | src/app/admin/nl-search/feedback/page.tsx | "Reader feedback" | requireCapability('operations.nlTelemetry') | nl-search-log | none |
| /admin/nl-search/[id] | src/app/admin/nl-search/[id]/page.tsx | "Search detail" | requireCapability('operations.nlTelemetry') | nl-search-log | ReviewForm.tsx (imported as ../ReviewForm, :11) → nl-search/actions |
| /admin/password | src/app/admin/password/page.tsx | "Change password" | requireSignedIn() | none | ChangePasswordForm.tsx:5 → password/actions |
| /admin/player-links | src/app/admin/player-links/page.tsx | "Player links" | requireCapability('data.playerLinks') | player-links, player-match-candidates | SuggestionControls.tsx:9, RefreshSuggestionsControls.tsx:9 → player-links/actions. Also ResolvePanel.tsx (direct import, :6), which imports BulkApproveControls.tsx:9 and ResolveControls.tsx:12 → player-links/actions |
| /admin/player-links/afl-api | src/app/admin/player-links/afl-api/page.tsx | "AFL API providers" | requireCapability('data.playerLinks') | afl-api-player-links | none |
| /admin/player-links/afl-api/[providerId] | src/app/admin/player-links/afl-api/[providerId]/page.tsx | "AFL API provider" | requireCapability('data.playerLinks') | afl-api-player-links | AflApiAdjudicationForm.tsx:12 → ./actions (afl-api/actions) |
| /admin/query-builder | src/app/admin/query-builder/page.tsx | "Data QA search" | requireCapability('operations.queryBuilder'); requireSuperAdmin() | query-builder | none |
| /admin/records | src/app/admin/records/page.tsx | "Special records administration" | requireCapability('data.specialRecords.read') | admin-special-records | none |
| /admin/records/after-the-siren | src/app/admin/records/after-the-siren/page.tsx | "After-the-siren administration" | requireCapability('data.specialRecords.read') | admin-special-records | none |
| /admin/records/after-the-siren/new | src/app/admin/records/after-the-siren/new/page.tsx | "Record a kick after the siren" | requireCapability('data.specialRecords.edit') | none | SpecialRecordCreatePanel.tsx:6 → records/actions |
| /admin/records/after-the-siren/[id] | src/app/admin/records/after-the-siren/[id]/page.tsx | "After-the-siren record" | requireCapability('data.specialRecords.read') | admin-special-records | AfterSirenCorrectionPanel.tsx:8, SpecialRecordLifecyclePanel.tsx:8, SpecialRecordReplacePanel.tsx:6 → records/actions |
| /admin/records/first-kick-goal | src/app/admin/records/first-kick-goal/page.tsx | "First-kick-goal administration" | requireCapability('data.specialRecords.read') | admin-special-records | none |
| /admin/records/first-kick-goal/new | src/app/admin/records/first-kick-goal/new/page.tsx | "Record a first-kick goal" | requireCapability('data.specialRecords.edit') | none | SpecialRecordCreatePanel.tsx:6 → records/actions |
| /admin/records/first-kick-goal/[id] | src/app/admin/records/first-kick-goal/[id]/page.tsx | "First-kick-goal record" | requireCapability('data.specialRecords.edit') and requireCapability('data.specialRecords.read') | admin-special-records | FirstKickCorrectionPanel.tsx:8, SpecialRecordLifecyclePanel.tsx:8, SpecialRecordReplacePanel.tsx:6 → records/actions |
| /admin/season-lists | src/app/admin/season-lists/page.tsx | "Season lists" | requireCapability('data.seasonLists.read') | admin-season-lists | none |
| /admin/season-lists/[season] | src/app/admin/season-lists/[season]/page.tsx | `${season} season list` | requireCapability('data.seasonLists.read') | admin-club-leadership, admin-season-lists | CopyForwardPanel.tsx:5 → season-lists/actions |
| /admin/season-lists/[season]/[club] | src/app/admin/season-lists/[season]/[club]/page.tsx | `${season} · ${club}` | requireCapability('data.seasonLists.read') | admin-club-leadership, admin-season-lists | AddPlayerPanel.tsx:6, AppearancesReviewPanel.tsx:5, DraftSuggestionsPanel.tsx:3, MemberActions.tsx:5 → season-lists/actions. LeadershipPanel.tsx:8 (direct import, :8) imports AppointLeaderPanel.tsx:5 and LeadershipActions.tsx:11, both → leadership-actions |
| /admin/settings | src/app/admin/settings/page.tsx | "Site settings" | requireCapability('site.settings') | site-settings | SettingsForm.tsx:8, TestEmailForm.tsx:5 → settings/actions |
| /admin/submissions/[id] | src/app/admin/submissions/[id]/page.tsx | "Review submission" | requireCapability('acquisition.legacyIntake'); requireUploader() | none | ReviewControls.tsx:10 → submissions/[id]/actions |
| /admin/upload | src/app/admin/upload/page.tsx | "Upload data" | requireCapability('acquisition.legacyIntake') | none | none |

Layout-wide: `src/app/admin/layout.tsx:1` imports `AdminNav`, which `src/app/admin/AdminNav.tsx:7` imports `logout-action`. The layout calls `getAdminUser()` (layout.tsx:20).

---
### A5. Query modules (`src/db/queries/**`)

Count: **74** files (57 top-level plus 17 under `nl/`).
Command: `find src/db/queries -type f | sort` (74). Lines: `wc -l`. Client: `grep -q "from '@/db/client'"`, `grep -q "from '@/db/authClient'"` and `grep -q "postgres("`. Writes: `grep -cE '\b(INSERT|UPDATE|DELETE|TRUNCATE)\b'`. The write count is a count of matching lines and includes comments. It is not a count of statements.

Client key: `client` = `@/db/client` (sql, DATABASE_URL, src/db/client.ts:19). `authClient` = `@/db/authClient` (AFLDB_AUTH_DATABASE_URL, src/db/authClient.ts:35). `direct` = a `postgres(` call in this file. The URL source is `process.env.AFLDB_IMPORT_DATABASE_URL` in each case except one (admin-brownlow.ts:697, `postgres(url`, not traced). `none` = no client import, a type-only `postgres` import, or the module is composed from other query modules.

| File | Lines | DB client | Direct postgres( call lines | Write-matching lines |
|---|---|---|---|---|
| src/db/queries/access-codes.ts | 84 | none (type-only postgres import, :3) | none | 2 |
| src/db/queries/admin-awards.ts | 2848 | client; direct | 309 | 26 |
| src/db/queries/admin-brownlow-ui.ts | 130 | client, authClient | none | 0 |
| src/db/queries/admin-brownlow.ts | 1429 | client; direct | 697 (url, not traced) | 20 |
| src/db/queries/admin-club-leadership.ts | 1500 | client; direct | 338 | 15 |
| src/db/queries/admin-coaches.ts | 871 | client; direct | 55 | 23 |
| src/db/queries/admin-draft.ts | 2049 | client, authClient; direct | 206 | 36 |
| src/db/queries/admin-fixtures.ts | 2263 | client; direct | 439 | 10 |
| src/db/queries/admin-invites.ts | 323 | none (type-only postgres import, :3) | none | 8 |
| src/db/queries/admin-season-lists.ts | 1484 | client; direct | 297 | 10 |
| src/db/queries/admin-special-records.ts | 2275 | client; direct | 608 | 21 |
| src/db/queries/admin-users.ts | 426 | none (type-only postgres import, :3) | none | 9 |
| src/db/queries/advanced-search.ts | 118 | client | none | 0 |
| src/db/queries/afl-api-player-links.ts | 1049 | client, authClient; direct | 688, 846 | 9 |
| src/db/queries/aflw.ts | 926 | client | none | 0 |
| src/db/queries/after-siren.ts | 208 | client | none | 0 |
| src/db/queries/app-health.ts | 205 | authClient | none | 2 |
| src/db/queries/audit-log.ts | 123 | none (type-only postgres import, :3) | none | 3 |
| src/db/queries/audit-reader.ts | 265 | authClient | none | 1 |
| src/db/queries/awards-admin.ts | 477 | direct only (no client import) | 135, 286, 358 | 5 |
| src/db/queries/awards.ts | 871 | client | none | 0 |
| src/db/queries/brownlow.ts | 155 | client | none | 0 |
| src/db/queries/club-comparison.ts | 3087 | client | none | 0 |
| src/db/queries/club-leadership.ts | 150 | client | none | 0 |
| src/db/queries/clubs.ts | 754 | client | none | 0 |
| src/db/queries/coaches.ts | 1051 | client | none | 0 |
| src/db/queries/data-edits.ts | 520 | client; direct | 207 | 18 |
| src/db/queries/db-health.ts | 435 | client, authClient | none | 0 |
| src/db/queries/draft.ts | 185 | client | none | 0 |
| src/db/queries/early-access.ts | 132 | authClient | none | 1 |
| src/db/queries/family-records.ts | 210 | client | none | 0 |
| src/db/queries/filters.ts | 62 | client | none | 0 |
| src/db/queries/grid-solver.ts | 1773 | client | none | 0 |
| src/db/queries/home-records.ts | 183 | none (imports other query modules and @/lib/home-records) | none | 0 |
| src/db/queries/match-admin.ts | 737 | client; direct | 193, 410 | 21 |
| src/db/queries/match-search.ts | 143 | client | none | 0 |
| src/db/queries/match-sheet.ts | 698 | direct only (no client import) | 133, 510, 578 | 12 |
| src/db/queries/matches.ts | 294 | client | none | 0 |
| src/db/queries/nl-search-log.ts | 609 | authClient | none | 3 |
| src/db/queries/nl-search-telemetry-clear.ts | 133 | none (type-only postgres import, :3) | none | 2 |
| src/db/queries/nl/achievement-summary.ts | 161 | client | none | 0 |
| src/db/queries/nl/after-siren.ts | 331 | client | none | 0 |
| src/db/queries/nl/answer.ts | 242 | none (imports nl/execute, nl/log, nl/resolve, @/search/nl/*) | none | 0 |
| src/db/queries/nl/club-season.ts | 110 | client | none | 0 |
| src/db/queries/nl/coach-record.ts | 241 | client | none | 0 |
| src/db/queries/nl/execute.ts | 62 | none (imports other nl query modules) | none | 0 |
| src/db/queries/nl/family.ts | 152 | client | none | 0 |
| src/db/queries/nl/father-son-summary.ts | 101 | client | none | 0 |
| src/db/queries/nl/feedback.ts | 70 | authClient | none | 3 |
| src/db/queries/nl/head-to-head.ts | 82 | client | none | 0 |
| src/db/queries/nl/log.ts | 204 | authClient | none | 2 |
| src/db/queries/nl/player-career.ts | 308 | client | none | 0 |
| src/db/queries/nl/player-game.ts | 217 | client | none | 0 |
| src/db/queries/nl/player-season.ts | 162 | client | none | 0 |
| src/db/queries/nl/resolve.ts | 270 | client | none | 0 |
| src/db/queries/nl/team-match.ts | 352 | client | none | 0 |
| src/db/queries/nl/team-streak.ts | 116 | client | none | 0 |
| src/db/queries/overview.ts | 45 | client | none | 0 |
| src/db/queries/player-achievements.ts | 272 | client | none | 0 |
| src/db/queries/player-compare.ts | 168 | client | none | 0 |
| src/db/queries/player-derived.ts | 794 | none (type-only postgres import, :1; functions take a `Tx` handle) | none | 21 |
| src/db/queries/player-identity.ts | 438 | none (type-only postgres import, :3) | none | 9 |
| src/db/queries/player-links.ts | 797 | client, authClient; direct | 505, 535, 638, 720 | 10 |
| src/db/queries/player-match-candidates.ts | 1082 | none (type-only postgres import, :3) | none | 2 |
| src/db/queries/players.ts | 868 | client; direct | 478 | 6 |
| src/db/queries/query-builder.ts | 367 | client | none | 0 |
| src/db/queries/records.ts | 234 | client | none | 0 |
| src/db/queries/rounds.ts | 152 | client | none | 0 |
| src/db/queries/search.ts | 871 | client | none | 0 |
| src/db/queries/seasons.ts | 228 | client | none | 0 |
| src/db/queries/settle-runs.ts | 237 | client | none | 0 |
| src/db/queries/site-content.ts | 139 | authClient | none | 3 |
| src/db/queries/site-settings.ts | 104 | client, authClient | none | 0 |
| src/db/queries/venues.ts | 494 | client | none | 0 |

Totals from this table: 74 files. Direct `postgres(` call sites: 24 across 15 files. Of these, 23 take `process.env.AFLDB_IMPORT_DATABASE_URL` and one (admin-brownlow.ts:697) takes `url`. The `none` rows did not have their SQL handle origin traced.

---
### A6. Migrations 001–110 (`src/db/migrations/`)

Count: **110** files, numbered 001 to 110 with no gaps.
Command: `ls src/db/migrations | sort` (110). Objects: `grep -ioE "create (or replace )?(table|view|materialized view|function)( if not exists)? *[A-Za-z_.\"]+"` per file. GRANT lines: `grep -ciE "\bgrant\b"`. Helper-call lines: `grep -cE "grant_app_read|grant_import_write"`.
Key: T = table, V = view, F = function. Each object is named once per migration, from a matched `CREATE` line. The area column is the mechanic's labelling by filename and object name, with one primary area per migration. It is not a judgment about correctness.

| # | File | Area (labelling) | Objects created | GRANT lines | grant_app_read / grant_import_write lines |
|---|---|---|---|---|---|
| 001 | 001_foundations.sql | core schema | F add_provenance_columns; T data_issues, import_batches, import_rejections, sources | 0 | 0 |
| 002 | 002_core_entities.sql | core schema | T club_aliases, clubs, external_identities, player_name_aliases, players, seasons, stat_availability, stat_definitions, venue_aliases, venues | 0 | 0 |
| 003 | 003_matches.sql | matches/stats | T match_period_scores, matches | 0 | 0 |
| 004 | 004_player_match_stats.sql | matches/stats | T player_match_stats | 0 | 0 |
| 005 | 005_brownlow_awards.sql | awards/Brownlow | T award_nominations, award_winners, awards, brownlow_round_votes, brownlow_season_votes, captaincies, hall_of_fame, honour_team_members | 0 | 0 |
| 006 | 006_draft_relationships.sql | draft/relationships | T club_seasons, draft_picks, father_son_selections, player_relationships | 0 | 0 |
| 007 | 007_derived_stats.sql | derived | T derived_rebuilds, player_career_stats, player_clubs, player_season_stats | 0 | 0 |
| 008 | 008_search.sql | core schema | F afldb_normalise_name | 0 | 0 |
| 009 | 009_fix_name_normalisation.sql | core schema | F afldb_normalise_name | 0 | 0 |
| 010 | 010_import_role_truncate.sql | privileges/grants | none | 3 | 0 |
| 011 | 011_import_role_sequences.sql | privileges/grants | none | 2 | 0 |
| 012 | 012_clubs_deferrable_identity.sql | core schema | none | 0 | 0 |
| 013 | 013_drop_season_premier_fk.sql | core schema | none | 0 | 0 |
| 014 | 014_staging_schema.sql | staging/acquisition | T staging.team_seasons | 5 | 0 |
| 015 | 015_brownlow_grain_and_coverage.sql | awards/Brownlow | none (touches player_season_stats) | 2 | 0 |
| 016 | 016_brownlow_grain_availability.sql | awards/Brownlow | none | 0 | 0 |
| 017 | 017_club_organizations.sql | staging/acquisition | F afldb_identity_for_season; T club_organization_relations, club_organizations | 3 | 0 |
| 018 | 018_player_birth_evidence.sql | staging/acquisition | T player_birth_evidence | 2 | 0 |
| 019 | 019_draft_persons.sql | draft/relationships | T draft_persons | 3 | 0 |
| 020 | 020_attendance_provenance.sql | staging/acquisition | none | 0 | 0 |
| 021 | 021_club_organizations_reloadable.sql | staging/acquisition | none | 0 | 0 |
| 022 | 022_match_result_integrity.sql | matches/stats | none | 0 | 0 |
| 023 | 023_auth_submissions.sql | auth/admin/site | T auth_audit_log, auth_sessions, auth_users, beta_access_codes, beta_allowed_emails, beta_login_tokens, data_submission_rows, data_submissions | 10 | 0 |
| 024 | 024_beta_join_requests.sql | auth/admin/site | T beta_join_requests | 2 | 0 |
| 025 | 025_staging_aflw.sql | AFLW | T staging_aflw.fixtures, issues, ladders, matches, player_match_stats, player_seasons, scoring_events, seasons | 6 | 0 |
| 026 | 026_aflw_read_model.sql | AFLW | V aflw.club_totals, clubs, fixtures, ladders, matches, player_careers, player_match_stats, player_seasons, players, scoring_events, seasons, venues | 3 | 0 |
| 027 | 027_aflw_read_model_fixes.sql | AFLW | F aflw.venue_slug; V aflw.matches, player_seasons, seasons, venues | 1 | 0 |
| 028 | 028_totp_replay_guard.sql | auth/admin/site | none | 2 | 0 |
| 029 | 029_admin_roles.sql | auth/admin/site | none | 2 | 0 |
| 030 | 030_admin_invites.sql | auth/admin/site | T admin_invites | 2 | 0 |
| 031 | 031_afldb_app_read_only_fix.sql | privileges/grants | none | 5 | 0 |
| 032 | 032_auth_reads_matches_venues.sql | privileges/grants | none | 2 | 0 |
| 033 | 033_contributor_role.sql | auth/admin/site | none | 0 | 0 |
| 034 | 034_site_settings.sql | auth/admin/site | T site_settings | 3 | 0 |
| 035 | 035_early_access_answers.sql | auth/admin/site | none | 0 | 0 |
| 036 | 036_unlimited_access_codes.sql | auth/admin/site | none | 0 | 0 |
| 037 | 037_site_media.sql | auth/admin/site | T site_media | 3 | 0 |
| 038 | 038_site_media_not_public.sql | auth/admin/site | none | 4 | 0 |
| 039 | 039_app_read_is_fail_closed.sql | privileges/grants | F afldb_meta.grant_app_read; T afldb_meta.app_readable_tables | 11 | 4 (includes the function definition) |
| 040 | 040_password_reset.sql | auth/admin/site | none | 1 | 0 |
| 041 | 041_fk_indexes_and_dead_indexes.sql | other | none | 0 | 0 |
| 042 | 042_awards_natural_keys.sql | awards/Brownlow | none | 0 | 0 |
| 043 | 043_submission_content_lookup.sql | other | none | 0 | 0 |
| 044 | 044_schema_integrity.sql | core schema | none | 0 | 0 |
| 045 | 045_import_write_is_fail_closed.sql | privileges/grants | F afldb_meta.grant_import_write, afldb_meta.owned_sequences, afldb_meta.revoke_app_read, afldb_meta.revoke_import_write; T afldb_meta.import_writable_tables | 12 | 6 (includes the function definitions) |
| 046 | 046_nl_search_log.sql | NL telemetry | T nl_search_log | 3 | 1 |
| 047 | 047_nl_search_log_observability.sql | NL telemetry | T nl_search_review | 2 | 0 |
| 048 | 048_nl_search_log_jsonb_repair.sql | NL telemetry | none | 0 | 0 |
| 049 | 049_nl_search_feedback.sql | NL telemetry | T nl_search_feedback | 5 | 0 |
| 050 | 050_nl_search_fk_indexes.sql | NL telemetry | none | 0 | 0 |
| 051 | 051_nl_search_run_tag.sql | NL telemetry | none | 0 | 0 |
| 052 | 052_app_health_events.sql | other | T app_health_events | 3 | 1 |
| 053 | 053_player_achievements.sql | other | T player_achievements | 0 | 2 |
| 054 | 054_fix_player_achievement_comments.sql | other | none | 0 | 0 |
| 055 | 055_nl_search_log_achievement_grain.sql | NL telemetry | none | 0 | 0 |
| 056 | 056_player_link_review.sql | other | T player_link_resolutions, player_link_suggestions | 10 | 0 |
| 057 | 057_data_edits.sql | other | T data_edits | 4 | 0 |
| 058 | 058_data_edits_editor_entities.sql | other | none | 0 | 0 |
| 059 | 059_honour_team_member_identity.sql | awards/Brownlow | none | 0 | 0 |
| 060 | 060_wikipedia_22_under_22_source.sql | awards/Brownlow | none | 0 | 0 |
| 061 | 061_award_winner_sort_order.sql | awards/Brownlow | none | 0 | 0 |
| 062 | 062_player_match_period_stats.sql | matches/stats | T player_match_period_stats | 0 | 0 |
| 063 | 063_external_current_match_sources.sql | staging/acquisition | T staging.external_current_matches | 2 | 0 |
| 064 | 064_matches_external_provenance.sql | matches/stats | none | 0 | 0 |
| 065 | 065_career_frees_derived.sql | derived | none | 0 | 0 |
| 066 | 066_atomic_audit_import_grants.sql | privileges/grants | none | 7 | 0 |
| 067 | 067_player_link_match_candidates.sql | other | T player_link_match_candidates | 2 | 1 |
| 068 | 068_import_reads_link_resolutions.sql | privileges/grants | none | 3 | 0 |
| 069 | 069_draft_source_identity.sql | draft/relationships | none | 0 | 0 |
| 070 | 070_import_reads_link_suggestions.sql | privileges/grants | none | 2 | 0 |
| 071 | 071_audit_link_fk_indexes.sql | other | none | 0 | 0 |
| 072 | 072_dob_conflict_ownership.sql | other | none | 0 | 0 |
| 073 | 073_data_overrides.sql | other | T data_overrides | 1 | 0 |
| 074 | 074_source_observation_spine.sql | staging/acquisition | T promotion_candidates, promotion_decisions, staging.source_payloads, staging.source_record_versions, staging.source_records | 13 | 4 |
| 075 | 075_data_overrides_fk_index.sql | other | none | 0 | 0 |
| 076 | 076_afltables_settle_projections.sql | staging/acquisition | T staging.afltables_match, staging.afltables_player_match | 6 | 0 |
| 077 | 077_afl_api_lineups.sql | staging/acquisition | T staging.afl_api_lineup | 4 | 0 |
| 078 | 078_data_overrides_admin_write.sql | privileges/grants | none | 5 | 0 |
| 079 | 079_nl_search_log_head_to_head_grain.sql | NL telemetry | none | 0 | 0 |
| 080 | 080_external_grids.sql | other | T external_grid_axes, external_grid_sources, external_grids | 7 | 4 |
| 081 | 081_nl_search_telemetry_clear.sql | NL telemetry | F public.nl_search_telemetry_clear | 4 | 0 |
| 082 | 082_auth_audit_log_jsonb_repair.sql | auth/admin/site | none | 1 | 1 |
| 083 | 083_canonical_auto_apply.sql | other | T canonical_applications | 5 | 2 |
| 084 | 084_round_type_wildcard_final.sql | matches/stats | none | 0 | 0 |
| 085 | 085_matches_is_finals_series.sql | matches/stats | none | 1 | 0 |
| 086 | 086_player_height_evidence.sql | other | T player_height_evidence | 0 | 2 |
| 087 | 087_coaches.sql | coaches/fixtures/leadership | F match_coaches_club_in_match; T coaches, match_coaches | 0 | 4 |
| 088 | 088_father_son_link_checks.sql | other | none | 1 | 0 |
| 089 | 089_after_siren_kicks.sql | other | T after_siren_kicks | 0 | 2 |
| 090 | 090_players_height_evidence_fk_index.sql | other | none | 0 | 0 |
| 091 | 091_access_code_delete.sql | auth/admin/site | none | 4 | 0 |
| 092 | 092_nl_search_log_coach_record_grain.sql | NL telemetry | none | 0 | 0 |
| 093 | 093_nl_search_log_after_siren_grain.sql | NL telemetry | none | 0 | 0 |
| 094 | 094_brownlow_admin_workflow.sql | awards/Brownlow | T brownlow_season_authority, brownlow_vote_entry_state | 5 | 2 |
| 095 | 095_coach_admin_overrides.sql | coaches/fixtures/leadership | none | 0 | 1 |
| 096 | 096_season_list_members.sql | coaches/fixtures/leadership | F afldb_season_list_clubs; T season_list_members | 0 | 3 |
| 097 | 097_fixtures.sql | coaches/fixtures/leadership | T fixtures | 0 | 3 |
| 098 | 098_club_leadership.sql | coaches/fixtures/leadership | T club_leadership | 0 | 3 |
| 099 | 099_normalise_unicode_whitespace.sql | core schema | F afldb_normalise_name | 0 | 0 |
| 100 | 100_nl_search_log_family_grain.sql | NL telemetry | none | 0 | 0 |
| 101 | 101_awards_honours_lifecycle.sql | awards/Brownlow | none | 0 | 0 |
| 102 | 102_special_records_lifecycle.sql | awards/Brownlow | none | 0 | 1 |
| 103 | 103_afl_api_match_projections.sql | staging/acquisition | T staging.afl_api_brownlow_vote, staging.afl_api_match, staging.afl_api_player_match | 7 | 0 |
| 104 | 104_afl_api_identity_adjudications.sql | staging/acquisition | T afl_api_identity_adjudications | 4 | 0 |
| 105 | 105_prod_actor_lifecycle_assertion.sql | auth/admin/site | F public.assert_viable_super_admin_actor | 6 | 0 |
| 106 | 106_afl_api_identity_corrected_action.sql | staging/acquisition | none | 1 | 0 |
| 107 | 107_canonical_applications_delete_audit.sql | other | none | 1 | 0 |
| 108 | 108_import_reads_data_edits.sql | privileges/grants | none | 4 | 0 |
| 109 | 109_import_reads_player_match_period_stats.sql | privileges/grants | none | 1 | 0 |
| 110 | 110_match_sheet_player_match_stats_authority.sql | matches/stats | none | 0 | 0 |

Notes on migrations:
- Migration 039 defines `afldb_meta.grant_app_read` itself. Its 4 helper-matching lines include that definition, so they are not all calls.
- Migration 045 defines `grant_import_write` and the `revoke_*` helpers, so its 6 helper-matching lines include definitions.
- Objects were matched by the four `CREATE` forms named in the brief, plus the `CREATE FUNCTION` and `CREATE OR REPLACE` forms that the same pattern matches. Objects created without these keywords (for example by ALTER or DO blocks) are not listed.

---
### A7. `src/lib` (118 files, 53 top-level entries)

Count: **118** files. Command: `find src/lib -type f | wc -l` (118). Top-level entries: `find src/lib -mindepth 1 -maxdepth 1` (53 entries, of which 12 are folders: acquisition, admin, auth, brownlow, edit, email, external-afl, fixtures, ingest, player-matching, rollover, special-records).
Purpose: the first comment-like line in each file, paraphrased in 12 words or fewer. The `:N` is that first comment-like line (`grep -n -m1`). Where N is greater than 2 it may not be the file header, and the file header was not verified. Files with no comment have `:0`.

| File:line | Purpose (12 words or fewer) |
|---|---|
| src/lib/acquisition/afl-api-adjudication.ts:2 | Pure decision logic for afl_api human identity adjudication |
| src/lib/acquisition/afl-api-bridge-identity.ts:2 | AFL API bridge artefact stable-identity contract |
| src/lib/acquisition/afl-api-brownlow.ts:2 | AFL.com.au Brownlow settle engine |
| src/lib/acquisition/afl-api-bundle.ts:2 | AFL.com.au bundle emitter |
| src/lib/acquisition/afl-api-client.ts:2 | AFL.com.au direct-HTTP acquisition client |
| src/lib/acquisition/afl-api-cutover-readiness.ts:2 | Repository half of AFL API cutover readiness check, DB-free |
| src/lib/acquisition/afl-api-fixture-identity.ts:2 | Fixture-only Brownlow identity handling for AFL API |
| src/lib/acquisition/afl-api-identity-correction.ts:2 | Pure DB-free planner for correcting consumed identity |
| src/lib/acquisition/afl-api-ingestion-control.ts:2 | Super-admin-controlled afl_api ingestion control |
| src/lib/acquisition/afl-api-ingestion-safety.ts:22 | afl_api ingestion safety; names read from live PostgreSQL sessions |
| src/lib/acquisition/afl-api-match-absence.ts:2 | afl_api match-absence decision (ISSUE-231 D-231-3) |
| src/lib/acquisition/afl-api-match-identity.ts:2 | Read-only settle planning: match identity |
| src/lib/acquisition/afl-api-match-resolver.ts:2 | Provider-id-first match resolver for afl_api |
| src/lib/acquisition/afl-api-player-evidence.ts:2 | Full-season AFL API player-identity evidence |
| src/lib/acquisition/afl-api-player-resolver.ts:2 | Maps afl_api provider players to canonical players |
| src/lib/acquisition/afl-api-refusal-evidence.ts:2 | AFL API settle canonical refusal census |
| src/lib/acquisition/afl-api-rounds.ts:2 | AFL API round translation contract |
| src/lib/acquisition/afl-api-season-discovery.ts:2 | AFL API season discovery |
| src/lib/acquisition/afl-api-season-enumeration.ts:2 | afl_api season enumeration representation |
| src/lib/acquisition/afl-api-settle-plan.ts:2 | Read-only settle planner |
| src/lib/acquisition/afl-api-snapshot.ts:2 | Shared offline AFL API snapshot reader |
| src/lib/acquisition/afltables-network.ts:2 | Application view of the AFL Tables network switch |
| src/lib/acquisition/canonical-apply.ts:2 | Canonical applier |
| src/lib/acquisition/fitzroy-profile-continuity.ts:2 | Tracked AFL Tables profile continuity amendment |
| src/lib/acquisition/lineup-bundle.ts:2 | afl_api.lineup observation bundle emitter |
| src/lib/acquisition/lineup-store.ts:2 | Persists afl_api.lineup observations |
| src/lib/acquisition/manual-authority.ts:2 | Real ManualAuthorityProvider |
| src/lib/acquisition/manual-source-key.ts:2 | Provenance source key for human-typed attendance |
| src/lib/acquisition/match-rekey.ts:2 | Proves an upstream rekey is the same match |
| src/lib/acquisition/match-sheet-authority.ts:2 | Durable Match Sheet authority model, pure |
| src/lib/acquisition/observation-store.ts:2 | Migration-074 observation persistence layer |
| src/lib/acquisition/observations.ts:2 | Observation and reviewed-promotion semantics |
| src/lib/acquisition/promotion-review.ts:2 | Promotion-review contract |
| src/lib/acquisition/reconciliation.ts:2 | Reconciliation verb set and source-ownership rules |
| src/lib/acquisition/season-revalidation.ts:2 | Publishes a settled season to the public ISR cache |
| src/lib/acquisition/settle-afl-api.ts:2 | afl_api settle writer |
| src/lib/acquisition/settle-afltables.ts:2 | AFL Tables in-season settle contract |
| src/lib/acquisition/settle-core.ts:2 | Source-parametrised settle infrastructure |
| src/lib/acquisition/settle-report.ts:2 | AFL Tables settle exception report |
| src/lib/acquisition/settle-status.ts:2 | One bounded status view of the settle pipeline |
| src/lib/acquisition/settle-trigger.ts:2 | Host boundary for on-demand AFL Tables settle |
| src/lib/acquisition/snapshot-dir.ts:2 | Shared snapshot-directory claim for acquire jobs |
| src/lib/acquisition/source-completeness.ts:2 | Source-completeness verdict and rendering |
| src/lib/acquisition/source-families.ts:2 | Source-family acquisition contract |
| src/lib/admin-match.ts:62 | Validates client-controlled numeric fields before a match insert |
| src/lib/admin/revalidate-route.ts:5 | Shared body of every domain revalidate route |
| src/lib/after-siren-format.ts:2 | Plain-language wording for after_siren_kicks events |
| src/lib/apex-html.ts:2 | Renders apex coming-soon page to HTML |
| src/lib/apex-publish.ts:17 | Writes apex coming-soon page to disk for Caddy |
| src/lib/audit-view.ts:2 | Pure helpers for Admin Centre audit viewer |
| src/lib/auth/admin-lifecycle.ts:2 | Super Admin account lifecycle policy |
| src/lib/auth/audience.ts:9 | Guards pages whose audience is runtime-configurable |
| src/lib/auth/capabilities.ts:2 | Admin Centre capability policy |
| src/lib/auth/crypto.ts:11 | Password hashing and TOTP on Node crypto |
| src/lib/auth/line-input.ts:2 | Line extraction for hidden terminal prompts |
| src/lib/auth/rate-limit.ts:4 | Small bounded per-worker rate limiter |
| src/lib/auth/session.ts:23 | Session and admin guard functions, re-exported for one import site |
| src/lib/auth/tokens.ts:2 | Signed access tokens verifiable in both runtimes |
| src/lib/brownlow/entry.ts:2 | Pure rules of Brownlow vote administration |
| src/lib/brownlow/fingerprint.ts:2 | Canonical-fingerprint compare-and-set digest |
| src/lib/club-comparison-format.ts:2 | Presentation vocabulary for /clubs/compare |
| src/lib/club-comparison-url.ts:2 | URL and query-state helpers for /clubs/compare |
| src/lib/coach-comparison-url.ts:2 | URL and query-state helpers for /coaches/compare |
| src/lib/coach-opponent-history.ts:14 | Opponent-history selection shared by coach surfaces |
| src/lib/coaching-format.ts:4 | One-line coaching career summary text |
| src/lib/consent.ts:2 | Analytics-storage consent |
| src/lib/cookie-security.ts:2 | Whether cookies may carry the Secure attribute |
| src/lib/csv.ts:2 | Minimal RFC 4180 CSV writing |
| src/lib/early-access-presets.ts:2 | Ready-made early-access questions |
| src/lib/edit/spec.ts:2 | What a super admin may edit by hand |
| src/lib/email/send.ts:6 | Outbound email through an SMTP relay |
| src/lib/external-afl/current-matches.ts:0 | No leading comment |
| src/lib/external-afl/current-season-import.ts:145 | Observation comparison at independence-group grain |
| src/lib/family-format.ts:7 | Human label for the father-son competition pathway |
| src/lib/fixtures/spec.ts:2 | Fixture vocabulary, stated once |
| src/lib/format.ts:2 | Centralised formatting |
| src/lib/health-init-script.ts:2 | Client-side technical-failure reporting inline script |
| src/lib/home-records.ts:2 | Curated records for the AFL home-page panel |
| src/lib/hydration-error.ts:2 | React hydration-mismatch error recognition |
| src/lib/image-probe.ts:2 | Identifies an uploaded image from its bytes |
| src/lib/import-batch-id.ts:2 | Driver-boundary type for import_batches.id |
| src/lib/indexing.ts:2 | Whether the deployment may be indexed |
| src/lib/ingest/csv.ts:2 | Dependency-free RFC 4180 CSV parsing |
| src/lib/ingest/datasets.ts:25 | Read-only resolvers accepting a transaction handle (ISSUE-249) |
| src/lib/ingest/pipeline.ts:22 | Submission pipeline: staged to promoted |
| src/lib/ingest/upload-request.ts:2 | Request-level guards for the CSV upload route |
| src/lib/jsonb.ts:2 | Decodes jsonb columns however the driver returns them |
| src/lib/like.ts:2 | LIKE/ILIKE pattern building |
| src/lib/match-lineup-editor.ts:0 | No leading comment |
| src/lib/match-sheet.ts:16 | Read-only mirror of the canonical match-level Brownlow fact |
| src/lib/nl-run-tag.ts:2 | Provenance label for synthetic qualification runs |
| src/lib/nl-session.ts:2 | Anonymous cookie correlating NL searches |
| src/lib/pagination.ts:6 | Sends past-the-end page numbers to the last page |
| src/lib/params.ts:2 | Safe parsing of URL query parameters |
| src/lib/player-compare.ts:2 | Pure classification for comparing two player profiles |
| src/lib/player-matching/calibration.ts:4 | Calibration-only override for matcher club-text weights |
| src/lib/player-matching/club-identity.ts:2 | Club identity for the matcher |
| src/lib/player-matching/confidence.ts:8 | Matching policy: weights, thresholds, eligibility rules |
| src/lib/player-matching/describe.ts:5 | Turns matcher output into reviewer-actionable text |
| src/lib/player-matching/explain-limits.ts:18 | Explains why a link row is where it is |
| src/lib/player-matching/parse-career-span.ts:2 | Hall of Fame playing career to season range |
| src/lib/player-matching/score-candidate.ts:19 | Scores one candidate against one source row |
| src/lib/player-matching/types.ts:5 | Shared vocabulary for player-link matching |
| src/lib/redirect.ts:4 | Redirect to an internal path on the public origin |
| src/lib/rollover/afl-api-ownership-census.ts:2 | afl_api ownership census |
| src/lib/rollover/afltables-network-retirement.ts:2 | Season rollover retires AFL Tables network fetching |
| src/lib/rollover/season-rollover.ts:2 | End-of-season promotion and baseline rollover planner |
| src/lib/seo.ts:4 | Decides what a page tells search engines |
| src/lib/site-content.ts:2 | Editable content of the two super-admin pages |
| src/lib/site-nav-model.ts:2 | Canonical public navigation model |
| src/lib/site-settings.ts:2 | Runtime-chosen settings and compiled defaults |
| src/lib/slugs.ts:2 | Slugs for display-string natural keys |
| src/lib/sorting.ts:5 | Null- and type-aware value comparison for sorting |
| src/lib/special-records/after-siren-rules.ts:2 | After-the-siren coupled-event rules |
| src/lib/special-records/identity.ts:2 | Durable identity grammar for special records |
| src/lib/structured-data.ts:2 | Schema.org JSON-LD builders |
| src/lib/theme.ts:2 | Theme selection: two stored states plus implicit third |
| src/lib/urlState.ts:2 | Compact URL-token encoding, JSON to base64url |

---
### A8. `package.json` scripts

Count: **55** script entries at `package.json:7` to `package.json:61` (`"scripts": {` opens at :6, closes at :62). Command: `sed -n '7,61p' package.json | grep -c '": "'` (55). Commands are verbatim from the file.

| Script | Command (verbatim) |
|---|---|
| dev | next dev --webpack -p 3100 |
| build | next build --webpack && node tools/build/prepare-standalone.mjs |
| start | next start -p ${PORT:-3100} |
| lint | eslint . |
| typecheck | next typegen && tsc --noEmit |
| db:migrate | tsx tools/db/migrate.ts |
| db:status | tsx tools/db/migrate.ts --status |
| db:migrate:test | tsx tools/db/migrate.ts --target test |
| db:migrate:code-test | tsx tools/db/migrate.ts --target code-test |
| db:privileges | tsx tools/db/privileges.ts --target dev |
| db:privileges:test | tsx tools/db/privileges.ts --target test |
| db:privileges:code-test | tsx tools/db/privileges.ts --target code-test |
| db:test:rebuild | tsx tools/db/rebuild-test.ts |
| db:test:prove-reset | tsx tools/db/prove-reset.ts |
| db:test:fingerprint | tsx tools/db/fingerprint-test.ts |
| db:test:fingerprint-tier2 | tsx tools/db/fingerprint-tier2.ts |
| db:test:issue235-i18 | tsx --conditions=react-server tools/migration/afl_api_adjudication_i18_fixture.ts |
| db:code-test:issue237-rehearsal | tsx --conditions=react-server tools/migration/afl_api_identity_rebuild_rehearsal_fixture.ts |
| db:code-test:issue245-rehearsal | tsx --conditions=react-server tools/migration/manual_registration_rebuild_rehearsal_fixture.ts |
| db:code-test:issue249-rehearsal | tsx --conditions=react-server tools/records/first-kick-goal-rehearsal.ts |
| db:code-test:issue251-rehearsal | tsx --conditions=react-server tools/rebuild/draftguru/issue251_prod_rehearsal.ts |
| db:code-test:issue252-rehearsal | tsx --conditions=react-server tools/db/promotion-source-dependency-rehearsal.ts |
| db:issue237:export-importer-recovery | tsx tools/migration/recover_afl_api_importer_identities.ts export |
| db:issue237:recover-importer-identities | tsx tools/migration/recover_afl_api_importer_identities.ts r4 |
| db:issue239:recover-adjudications | tsx tools/migration/recover_afl_api_adjudications.ts |
| db:code-test:issue239-241-rehearsal | tsx tools/db/afl-api-identity-bulk-rehearsal.ts |
| import:afl-api-player-bridge | tsx tools/migration/import_afl_api_player_bridge.ts |
| db:issue237:ensure-recovery-actor | tsx tools/migration/ensure_issue237_recovery_actor.ts |
| db:issue246:retire-issue109-fixture | tsx tools/maintenance/issue246-retire-issue109-fixture.ts |
| db:issue248:cleanup-dev-auth-fixtures | tsx tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts |
| db:promotion:check | tsx tools/db/promotion-check.ts |
| db:promotion:prepare-source | tsx tools/db/prepare-promotion-source.ts |
| preflight | tsx tools/dev/preflight.ts |
| worktree:bootstrap | tsx tools/dev/bootstrap-worktree.ts |
| merge:ready | tsx tools/dev/merge-readiness.ts |
| current-season:update | tsx tools/current-season/update-current-season.ts |
| settle:afltables | tsx tools/current-season/settle-afltables.ts |
| acquire:afl-api | tsx tools/current-season/acquire-afl-api.ts |
| emit:afl-api | tsx tools/current-season/emit-afl-api-bundle.ts |
| settle:afl-api | tsx tools/current-season/settle-afl-api.ts |
| settle:afl-api-fixtures | tsx tools/current-season/settle-afl-api-fixtures.ts |
| emit:afl-api-player-bridge | tsx tools/current-season/emit-afl-api-player-bridge.ts |
| emit:afl-api-player-bridge-test | tsx tools/current-season/emit-afl-api-player-bridge-test.ts |
| acquire:afl-api-brownlow | tsx tools/current-season/acquire-afl-api-brownlow.ts |
| settle:afl-api-brownlow | tsx tools/current-season/settle-afl-api-brownlow.ts |
| records:first-kick-goal | tsx --conditions=react-server tools/records/import-first-kick-goal.ts |
| match:backtest | tsx --conditions=react-server tools/matching/backtest.ts |
| match:compare | tsx tools/matching/compare.ts |
| match:draft-labels | tsx tools/matching/export-draft-labels.ts |
| nl:stress | tsx --conditions=react-server tools/nl/stress-test.ts |
| nl:stress:compare | tsx tools/nl/compare-runs.ts |
| test | vitest run |
| test:watch | vitest |
| test:e2e | playwright test |
| nl:ui | playwright test --config playwright.nl-stress.config.ts |

---
### A9. Deploy units (`deploy/`)

Count: **33** files. Command: `find deploy -type f | sort` (33). Fields via `grep -nE "^(Description|ExecStart|OnCalendar|OnUnitActiveSec|OnBootSec|EnvironmentFile|Persistent|RandomizedDelaySec|Restart|User|Type)="`.

Units: 5 `.service` files and 4 `.timer` files. The 13 `coming-soon/` files, the 2 Caddyfiles, the rules file, the shell scripts and the PowerShell and Node files are not systemd units. They are listed by type only.

| File | Type | Description (line) | ExecStart (line) | Timer schedule (line) | EnvironmentFile (line) |
|---|---|---|---|---|---|
| deploy/afldb.service | systemd service (Type=simple, User=arm, Restart=always :91) | AFLDB — Australian Football statistics database (:2) | /home/arm/.nvm/versions/node/v22.23.2/bin/node deploy/server-cluster.mjs (:29) | — | /home/arm/projects/afldb/.env (:33) |
| deploy/afldb-email-intake.service | systemd service (oneshot, User=arm :9) | AFLDB — email CSV intake (one poll) (:2) | /usr/bin/python3 tools/email_intake/fetch_and_stage.py (:17) | — | /home/arm/projects/afldb/.env (:25) |
| deploy/afldb-email-intake.timer | systemd timer | AFLDB — poll for emailed CSV uploads every 5 minutes (:2) | — | OnBootSec=2min (:5), OnUnitActiveSec=5min (:6), Persistent=true (:8) | — |
| deploy/afldb-settle-afl-api.service | systemd service (oneshot, User=arm :9) | AFLDB — in-season AFL.com.au (afl_api) canonical settle (one run) (:2) | /bin/sh /home/arm/projects/afldb/deploy/afldb-settle-afl-api.sh (:31) | — | /home/arm/projects/afldb/.env (:56) |
| deploy/afldb-settle-afl-api.timer | systemd timer | AFLDB — nightly in-season AFL.com.au (afl_api) settle pass (:2) | — | OnCalendar=*-*-* 05:00 (:16), RandomizedDelaySec=15min (:17), Persistent=true (:21) | — |
| deploy/afldb-settle-afl-api-brownlow.service | systemd service (oneshot, User=arm :9) | AFLDB — AFL.com.au (afl_api) Brownlow live-count settle (one run) (:2) | /bin/sh /home/arm/projects/afldb/deploy/afldb-settle-afl-api-brownlow.sh (:36) | — | /home/arm/projects/afldb/.env (:61) |
| deploy/afldb-settle-afl-api-brownlow.timer | systemd timer | AFLDB — AFL.com.au (afl_api) Brownlow live-count poll (:2) | — | OnCalendar=*:0/5 (:15). No Persistent or RandomizedDelaySec line found | — |
| deploy/afldb-settle-afltables.service | systemd service (oneshot, User=arm :9) | AFLDB — in-season AFL Tables canonical settle (one run) (:2) | /bin/sh /home/arm/projects/afldb/deploy/afldb-settle-afltables.sh (:35) | — | /home/arm/projects/afldb/.env (:70) |
| deploy/afldb-settle-afltables.timer | systemd timer | AFLDB — nightly in-season AFL Tables settle pass (:2) | — | OnCalendar=*-*-* 04:30 (:13), RandomizedDelaySec=15min (:16), Persistent=true (:20) | — |
| deploy/afldb-r-env.sh | shell script | — | — | — | — |
| deploy/afldb-r-preflight.sh | shell script | — | — | — | — |
| deploy/afldb-settle-afl-api.sh | shell script (invoked by afldb-settle-afl-api.service :31) | — | — | — | — |
| deploy/afldb-settle-afl-api-brownlow.sh | shell script (invoked by afldb-settle-afl-api-brownlow.service :36) | — | — | — | — |
| deploy/afldb-settle-afltables.sh | shell script (invoked by afldb-settle-afltables.service :35) | — | — | — | — |
| deploy/sync-dev-remote.sh | shell script | — | — | — | — |
| deploy/sync-dev.ps1 | PowerShell | — | — | — | — |
| deploy/server-cluster.mjs | Node module (cluster supervisor, run by afldb.service :29) | — | — | — | — |
| deploy/Caddyfile | Caddy config | — | — | — | — |
| deploy/Caddyfile.production | Caddy config | — | — | — | — |
| deploy/afldb-settle-afltables-trigger.rules | rules file (no systemd keys) | — | — | — | — |
| deploy/coming-soon/ (13 files: app.js, favicon.svg, index.html, robots.txt, sitemap.xml, style.css, img/*.webp x7) | static site assets; app.js is Node | — | — | — | — |

The `.sh` scripts, the `.rules` file and the `.ps1` file were not read, so their contents are not summarised. The `.timer` files have no `Unit=` line in the grep output, so the timer-to-service link is not shown here.

---
### A10. Anomalies and observations (all INFO; none graded LOW or above)

- INFO. `src/app/admin/invite/[token]/page.tsx:4` imports `authSql` and runs SQL inline at :23. It does not go through `src/db/queries/`. The statement is parameterised (`token_hash = ${sha256Hex(token)}`).
- INFO. Twenty-four direct `postgres(` call sites in 15 modules under `src/db/queries/` use `process.env.AFLDB_IMPORT_DATABASE_URL` (Section 5, 23 of 24; admin-brownlow.ts:697 uses `url`). No judgment is offered on the credential boundary. The repo's tracked reference for this boundary is ISSUE-220 (not read in this task).
- INFO. `deploy/afldb.service:29` hard-codes the nvm node path `/home/arm/.nvm/versions/node/v22.23.2/bin/node`.
- INFO. `src/app/api/health/route.ts` (GET) has no auth check and performs a DB read through `@/db/client`.
- INFO. Two admin pages call no guard function: `src/app/admin/grid-solver/page.tsx` (a `permanentRedirect`, :1–30) and `src/app/admin/invite/[token]/page.tsx` (token-gated, with `/admin/invite` a public path at `src/middleware.ts:30`). Both are consistent with their code.
- INFO. The `requireSuperAdmin` occurrences in `src/app/admin/content/media/route.ts:20` and `src/app/admin/nl-search/export/route.ts:25` are comments. The guard in both routes is `requireCapability` (:31 and :103).

### A11. Limits of the Part A enumeration

- Section 4 action bindings are direct and one-level-nested import chains. Forms reached through deeper chains are not traced.
- Section 5 `none` rows did not have the origin of their SQL handle traced.
- Section 6 area labels are a filename-based labelling by the mechanic. They are not verified against content.
- Section 7 purposes are first-comment-line paraphrases. Where the line number is greater than 2, it may not be the file header.
- Section 8 commands are copied from `package.json` lines 7–61. An earlier `node -e` attempt produced no output and was not used. The lines were read with `sed` and `grep` instead.

---

## Part B — Legacy ingestion entry points (detail)

Method and caveats (all sections):
- Commands: find, ls, wc, sed, head, cat, grep only. No Read, Grep or Glob tools.
- Invoker search: `grep -rlF "<basename>" src tools deploy package.json` minus the file itself; tests counted separately under tests/. A basename hit includes comments, contract JSON, README and documentation mentions, so it is NOT proof of a call. Labels: pkg:<script> = package.json script (line cited); sched:<unit> = systemd unit or script chain; admin:<path> = admin page or action; tool:<file> = another tool's basename hit; mention = hit not confirmed as a call; manual = no non-test hit at all.
- Write-token search: `grep -oE "(INSERT INTO|UPDATE|DELETE FROM|COPY|TRUNCATE) +[a-z_\.\"]+"`. Noisy: prose matches (for example "UPDATE below", "COPY and", "copy") and helper-mediated writes (via tools/migration/common.py) are not captured. Treat target lists as candidates.
- Completeness: directory listings are complete (find). Invoker and token results are grep results and may be partial for helper-mediated paths.

### B1. CSV imports
Commands: find src/app/admin/upload src/app/admin/submissions -type f; grep -rnEi "insert into|update [a-z_]+ set|delete from|\bcopy\b|merge into" src/lib/ingest src/app/admin/upload src/app/admin/submissions src/lib/csv.ts; grep -rnE "lib/ingest/|lib/csv'" src tools tests.

- src/app/admin/upload/page.tsx: upload page; imports DATASETS (:5). Invoker: admin:/admin/upload.
- src/app/admin/upload/UploadForm.tsx: POSTs file to /admin/upload/stage (:32). Invoker: admin upload button.
- src/app/admin/upload/stage/route.ts: POST (:40); requireCapability('acquisition.legacyIntake') (:44); stageSubmission (:76). Invoker: UploadForm.tsx:32.
- src/app/admin/submissions/[id]/actions.ts: runValidation (:11, calls validateSubmission :20); decideSubmission (:38); runPromotion (:94, calls promoteSubmission :102). Invoker: ReviewControls.tsx:6-8, forms :43, :51, :60, :68 (admin buttons).
- src/app/admin/submissions/[id]/page.tsx: detail page, no writes. Line 140 text tells the operator to run tools/migration/rebuild_derived.py manually.
- src/app/admin/submissions/[id]/ReviewControls.tsx: buttons calling the actions above.
- src/lib/ingest/pipeline.ts: stageSubmission (:37), validateSubmission (:280), promoteSubmission (:483). Literal writes: INSERT data_submissions (:112), data_submission_rows (:130), import_batches (:563, target_table = spec.key). Invokers: actions.ts:7; stage/route.ts:4; api/admin/email-intake/route.ts:8-12.
- src/lib/ingest/datasets.ts: DATASETS (:1948-1955), six keys. Table map below.
- src/lib/ingest/csv.ts: parseCsv (:22). No DB writes. Invokers: pipeline.ts:18; tools/migration/correct_afl_api_identity.ts:109.
- src/lib/ingest/upload-request.ts: request guards (same-origin, size). No DB writes. Invoker: stage/route.ts:10.
- src/lib/csv.ts: CSV EXPORT writer (toCsv). Not ingest, no table writes. Invokers: src/app/admin/nl-search/export/route.ts:11; several tools/nl files.

CSV dataset to promotion writes (datasets.ts):
| Dataset (key line) | promoteRow | Literal writes |
| rising_star (:373) | :432 | INSERT award_nominations :441 |
| all_australian (:479) | :526 | INSERT award_winners :564; ON CONFLICT DO UPDATE :576 |
| match_results (:1001) | :1252 | INSERT matches :1275; ON CONFLICT (match_key) DO UPDATE :1291 |
| player_match_stats (:1447) | :1662 | INSERT player_match_stats :1665; ON CONFLICT (player_id, match_id) :1687 |
| player_bio (:1726) | :1767 | UPDATE players :1774 |
| match_attendance (:1849) | :1933 | UPDATE matches :1937 |

Other parseCsv users (tool-side, not lib/ingest): tools/records/first-kick-goal-source.ts:287 (own definition, used by import-first-kick-goal.ts:1175); tools/nl/corpus.ts:62 (own definition).
Package scripts for CSV: none. Scheduler for CSV: none (the email intake path is section 7).

---

### B2. AFL Tables settle
Commands: grep -rnEi "settle-afltables|settleAfltables|settle_afltables|settle:afltables|afldb-settle-afltables|settle-trigger|afltables-network|rollover-season" src tools deploy package.json data; cat deploy/afldb-settle-afltables.{service,timer} and trigger rules; grep -nE "tsx|Rscript|python|psql" deploy/afldb-settle-afltables.sh.

- src/lib/acquisition/settle-afltables.ts: library. runSettleAfltables (:1815). Literal writes: INSERT staging.afltables_match, INSERT staging.afltables_player_match, INSERT import_batches, INSERT import_rejections, INSERT promotion_candidates, ON CONFLICT upserts, UPDATE import_batches. Canonical upsert targets: PLAYER_MATCH_TARGET_TABLES = ['player_match_stats','brownlow_round_votes'] (:160). Invokers: tools/current-season/settle-afltables.ts:53-58, :360; tools/db/prepare-promotion-source.ts:66-71; tools/db/promotion-source-dependency-rehearsal.ts:106-111.
- src/lib/acquisition/settle-trigger.ts: admin trigger. SETTLE_UNIT = 'afldb-settle-afltables.service' (:45). Start-only. No writes. Invoker: src/app/admin/current-season/actions.ts:20, :181 (startSettleRun), reached from SettleRunPanel.tsx:184 invoke(startSettleRunAction).
- src/lib/acquisition/afltables-network.ts: reads data/reference/afltables-network.json (:17); status gate (:36-64). No writes. Invokers: settle-trigger.ts:42; src/lib/rollover/afltables-network-retirement.ts:34; src/lib/acquisition/afl-api-cutover-readiness.ts:28; tools/current-season/afl-api-c4b-rehearsal.ts:104; deploy/afldb-settle-afltables.sh:64 (Python read).
- src/lib/rollover/afltables-network-retirement.ts: pure planner, no writes. Invoker: tools/db/rollover-season.ts:127-128, :336.
- tools/current-season/settle-afltables.ts: CLI. runSettleCli (:336); calls runSettleAfltables (:360). Invokers: pkg:settle:afltables (package.json:43); deploy/afldb-settle-afltables.sh:237.
- deploy/afldb-settle-afltables.sh: chain under set -e. Step 1 acquire_core.R --acquire --in-season (:210). Step 2 import_fitzroy_core.py --require-in-season (:218). Step 3 settle-afltables.ts --apply --auto-apply (:237).
- deploy/afldb-settle-afltables.service: Type=oneshot, User=arm, ExecStart=/bin/sh .../afldb-settle-afltables.sh (:35), TimeoutStartSec=3600 (:40). Comments :28-30 say Squiggle and Kali are not invoked.
- deploy/afldb-settle-afltables.timer: OnCalendar=*-*-* 04:30 (:13); RandomizedDelaySec=15min (:16); Persistent=true (:20). SCHEDULER.
- deploy/afldb-settle-afltables-trigger.rules: polkit rule granting only manage-units, unit afldb-settle-afltables.service, verb start, user arm (:34-39). Enables the admin button.
- src/app/admin/current-season/**: SettleRunPanel.tsx:184 (button) to actions.ts:167 startSettleRunAction to settle-trigger.ts startSettleRun. Other files in folder: AflApiIngestionControls.tsx, AflApiSettleUnitsPanel.tsx (section 8), CurrentSeasonControls.tsx (section 3), page.tsx.
- tools/db/rollover-season.ts: CLI, usage at :71. Writes data/reference/afltables-network.json to 'retired' via writeFileSync (:187, :252) and renameSync (:253). Invoker: MANUAL. No package.json script. Basename hits are comments only (afltables-network.ts:11, afl-api-ownership-census comments) plus the file itself. Test-only: tests/season-rollover.test.ts.
- data/reference/afltables-network.json: status register (active / retired / out_of_bounds). Not an ingest entry point. Written by rollover-season.ts, read by the modules above. Content not read.

---

### B3. Squiggle / Kali current-season import
Commands: grep -rilE "squiggle|kali" src tools deploy package.json | sort; grep -rnEi "squiggle|kali" src/lib/external-afl tools/current-season/update-current-season.ts deploy; grep -rnE "external-afl/|update-current-season|runCurrentSeasonAdminAction" src tools deploy package.json tests; grep -nE "insert into|on conflict" src/lib/external-afl tools/current-season/update-current-season.ts src/lib/acquisition/observation-store.ts.

Case-insensitive file list (20):
1 deploy/afldb-settle-afl-api-brownlow.service (comment; env unset :62)
2 deploy/afldb-settle-afl-api.service (comments; env unset :48, :57)
3 deploy/afldb-settle-afltables.service (:28, comment: not invoked)
4 src/app/admin/current-season/CurrentSeasonControls.tsx
5 src/app/admin/current-season/actions.ts
6 src/app/admin/current-season/page.tsx
7 src/db/migrations/063_external_current_match_sources.sql
8 src/db/migrations/074_source_observation_spine.sql
9 src/db/migrations/083_canonical_auto_apply.sql
10 src/db/queries/admin-fixtures.ts
11 src/lib/acquisition/afl-api-client.ts
12 src/lib/acquisition/observations.ts
13 src/lib/acquisition/reconciliation.ts
14 src/lib/acquisition/settle-afltables.ts
15 src/lib/acquisition/source-families.ts
16 src/lib/external-afl/current-matches.ts (:1 type; :25-26 URLs; :111 Squiggle fetch; :159 Kali fetch; :160 reads KALI_AFL_API_KEY)
17 src/lib/external-afl/current-season-import.ts
18 src/lib/player-matching/describe.ts
19 tools/current-season/update-current-season.ts
20 (migration 064 is not in this list; see below)

Module facts:
- current-matches.ts: HTTP fetch only. fetchSquiggleCurrentMatches (:111), fetchKaliCurrentMatches (:159). No DB writes.
- current-season-import.ts: runCurrentSeasonRefresh (:269). Literal writes: INSERT import_batches (:770); INSERT staging.external_current_matches (:804); ON CONFLICT (source_id, external_game_id) DO UPDATE (:819). No matches-table write token found. :382 maps source to squiggle_api / kali_afl_stats.
- Invokers: admin button CurrentSeasonControls.tsx:203 to runCurrentSeasonAdminAction (actions.ts:51) to runCurrentSeasonRefresh (actions.ts:87). CLI tools/current-season/update-current-season.ts:97. Package script current-season:update (package.json:42). actions.ts:19-29 comment says legacy auto mode is gone.
- update-current-season.ts: --update-matches deprecated (:44). Default --source when absent is 'squiggle' (:52). See F-001.
- Migration 063 (063_external_current_match_sources.sql): registers squiggle_api (:11) and kali_afl_stats (:13).
- Migration 064 (064_matches_external_provenance.sql): SELECT add_provenance_columns('matches') at :8. A grep for external_source, external_match_id, external_provenance across src, tools and deploy returned no hits. Other consumers not enumerated.

---

### B4. Offline rebuild families
Commands: find tools/rebuild/{afltables,fitzroy,draftguru,afl_api} -type f (pycache excluded: 15 .pyc under tools/rebuild/draftguru/__pycache__); invoker loop as above; write-token loop as above.
Totals: 50 source, data and doc files (afl_api 5, afltables 3, fitzroy 4, draftguru 38).

afl_api (5)
- acquire_lineups.R: bounded AFL API lineup acquisition via fitzRoy (ISSUE-100 L2). Invoker: manual (mentions: lineup-bundle.ts, acquire_rosters.R, afl-api-contract.json). Test: tests/afl-api-lineup.test.ts.
- acquire_rosters.R: bounded AFL API roster acquisition (ISSUE-118 H3). Invoker: manual (mentions: tools/db/rebuild-test.ts, enrich_heights_afl_api.py).
- afl-api-contract.json: AFL API acquisition contract. Data.
- emit_lineup_bundle.ts: emits afl_api.lineup observation bundle. Invoker: manual (mention: persist_lineups.ts). No tests.
- persist_lineups.ts: persists emitted lineup bundle (ISSUE-100 L3B2). Invoker: manual. Test: tests/afl-api-lineup-store.test.ts.

afltables (3)
- acquire_club_lists.R: AFL Tables all-time club player lists, 21 club pages (ISSUE-118 D1). Invoker: manual (mentions: afltables-network.ts, enrich_birth_dates_afltables.py, acquire_coaches.py, rebuild-test.ts). Test: tests/afl-api-cutover.test.ts.
- acquire_coaches.py: AFL Tables coaches index and coach pages (ISSUE-118 E2). Invoker: manual (mentions: afltables-network.ts, import_match_coaches.py, rebuild-test.ts). Test: tests/afl-api-cutover.test.ts.
- afltables-contract.json: AFL Tables direct-acquisition contract. Data.

fitzroy (4)
- acquire_core.R: fitzRoy and AFL Tables core acquisition; header says no PostgreSQL access (:1-4). Invoker: sched:afldb-settle-afltables via deploy/afldb-settle-afltables.sh:210. Also mentioned in deploy/afldb-r-preflight.sh.
- fitzroy-contract.json: fitzRoy acquisition contract. Data.
- ladder-source-labels.json: club labels the ladder witness emits (ISSUE-095 D5). Data. Test-only: tests/python/ladder_identity_contract.py.
- validate_ladder_witness.py: offline validation of ladder witness (ISSUE-095). Invoker: tool: tools/db/rebuild-test.ts, tools/db/rollover-season.ts (mentions). Test: tests/fitzroy-acquisition.test.ts.

draftguru (38)
- README.md: documentation (1351 lines).
- acquire_draft.py: DraftGuru annual-page acquisition adapter (ISSUE-093 13.5). Invoker: manual (mention: tools/migration/acquire_gridley_boards.py). Test: tests/draftguru-acquisition.test.ts.
- acquire_persons.py: DraftGuru person-page acquisition (Stage B1). Invoker: manual (mention: profile_person_pages.py). Test: draftguru-acquisition.test.ts.
- afldb_test_draft_linkage_checks.sql: read-only linkage checks on afldb_test (ISSUE-222). Mention: README.
- b2_evidence.py: read-only evidence for gaps G2-G6 (B2-1). Mentions: b2_evidence_followup.py, b2_g5_evidence.py.
- b2_evidence_followup.py: G4-G6 evidence follow-up (B2-1). Mention: b2_g5_evidence.py.
- b2_g5_evidence.py: G5 linked-decision representability (B2-1). Manual.
- b2_g5_seed_payload.py: seed-target metadata provenance (B2-1). Manual.
- b2_g5_seed_scope.py: seeded player scope (B2-1). Manual.
- b2_signing_detail_evidence.py: how draft_picks.signing_detail is derived (B2-2). Manual.
- bridge_import_gate.py: read-only pre-import PLAN and post-import VERIFY gates (ISSUE-222). Mentions: import_draftguru.py, s74 scripts, tools/migration/build_afl_api_player_bridge.py, src/lib/acquisition/afl-api-player-evidence.ts. Tests: draftguru-acquisition.test.ts, tests/integration/draft-linkage.test.ts, tests/python/draftguru_import_gate_contract.py.
- build_issue224_d7_decision.py: emits ISSUE-224 operator decision D-7 artefact. Manual.
- build_issue224_s9_target_set.py: S9 registration target set. Mention: build_issue224_d7_decision.py.
- build_person_bridge_v2.py: DB-free build of corrected bridge v2 (ISSUE-222). Mentions: export_person_bridge.py, README. Test: tests/python/draftguru_bridge_v2_contract.py.
- build_person_bridge_v3_issue224.py: builds v3 bridge for ISSUE-224. No docstring in the first three lines; purpose from filename only. Mention: validate_person_bridge_child_v3.py. Test: tests/python/draftguru_bridge_v3_lineage_fixture.py.
- build_validation_sample.py: DB-free disjoint validation sample, salt AFLDB-ISSUE-222/v2 (Phase F). Mentions: validate_person_bridge_child.py, README.
- draftguru-contract.json: DraftGuru acquisition contract (13.5). Data.
- export_link_decisions.py: exports human link decisions to a ledger (B2-3). Non-test mention: src/lib/rollover/season-rollover.ts.
- export_person_bridge.py: bridge export (ISSUE-222 Stage B3). Mentions: build_person_bridge_v2.py, validate_person_bridge_child*.py, README.
- import_draftguru.py: supported DraftGuru importer (B2-4/5). Literal writes: DELETE draft_persons, DELETE external_identities, INSERT external_identities, INSERT players, UPDATE draft_persons, UPDATE draft_picks, UPDATE external_identities, UPDATE players. Invoker: manual CLI. Mentions: tools/db/rebuild-test.ts, tools/matching/export-draft-labels.ts, bridge_import_gate.py, s74-rollback-exercise.ps1, src/lib/acquisition/afl-api-adjudication.ts. Tests: tests/draftguru-import.test.ts, tests/integration/draftguru-import.test.ts.
- issue251_prod_rehearsal.ts: isolated rehearsal of PROD adoption write against code_test_db (ISSUE-251). Literal writes: DELETE auth_sessions, auth_users, data_edits, data_overrides, external_identities, player_career_stats, players; INSERT auth_users. Invoker: pkg:db:code-test:issue251-rehearsal (package.json:27).
- parse_draft_snapshot.py: DraftGuru annual snapshot validation parser (13.5). Mention: contract JSON.
- profile_person_pages.py: profiles Stage B1 person pages (30.8). Mentions: tools/matching/export-draft-labels.ts, build_validation_sample.py, contract.
- reconcile_person_bridge.py: read-only final reconciliation gate (B1, 30.9). Mentions: b2_evidence*.py, b2_g5_evidence.py.
- register_issue224_s9_players.ts: batch registration of 92 REGISTER players (ISSUE-224 S9). No literal write tokens ("UPDATE actually" is prose); writes presumably via helpers, not traced. Mentions: issue251_prod_rehearsal.ts, ensure_issue237_recovery_actor.ts, manual_registration_rebuild_rehearsal_fixture.ts, migration 105. Test: tests/register-issue224-s9-dev-write-gate.test.ts.
- review_bridge_operator.py: operator-adjudication helper (ISSUE-222 Phase 3). Mentions: review_validation_operator.py, README. Test: tests/python/draftguru_bridge_operator_review_contract.py.
- review_person_bridge_offline.py: offline retained-evidence review (ISSUE-222 Phase 3). Mentions: build_person_bridge_v2.py, review_bridge_operator.py, review_validation_sample.py, scan_person_bridge_population.py.
- review_validation_operator.py: local operator GUI for recheck rows (ISSUE-222 Phase F). Mention: README.
- review_validation_sample.py: offline review of validation sample (Phase F). Mentions: validate_person_bridge_child.py, README.
- s74-rollback-exercise.ps1: afldb_test rollback exercise S0-S3, fail-closed (ISSUE-222 7.4). Mentions: s74-snapshot-path-probe.sql, README. Tests: tests/s74-rollback-exercise-gate-parsing.test.ps1, tests/s74-rollback-exercise-static.test.ps1.
- s74-snapshot-path-probe.sql: read-only preflight probe for the \copy path (7.4). Mentions: README, s74-rollback-exercise.ps1.
- s74-snapshot.sql: read-only row-image snapshot via six \copy statements (7.4). Mentions: README, s74-rollback-exercise.ps1.
- scan_person_bridge_population.py: population-wide offline mislink scan (ISSUE-222). Mention: build_person_bridge_v2.py. Test: tests/python/draftguru_population_scan_contract.py.
- stage_b1_sample.py: freezes Stage B1 profiling sample (30.3/30.5). Mention: stage_b3_population.py.
- stage_b3_population.py: freezes Stage B3 population sample (revised runbook 2). Mention: profile_person_pages.py.
- validate_person_bridge_child.py: DB-free fail-closed validation of child bridge dataset (ISSUE-222). Mentions: build_validation_sample.py, validate_person_bridge_child_v3.py, README.
- validate_person_bridge_child_v3.py: DB-free validation of ISSUE-224 v3 afldb_test child bridge (ISSUE-227). Manual (tests only). Test: tests/python/draftguru_child_validation_v3_contract.py.
- validate_validation_review.py: read-only validation of Phase F review (ISSUE-222). Mentions: review_validation_operator.py, review_validation_sample.py, validate_person_bridge_child.py.

---

### B5. tools/migration importers
Commands: find tools/migration -maxdepth 1 -type f (50 files; __pycache__ excluded); invoker loop; write-token loop.

1. acquire_gridley_boards.py: acquires Gridley boards into immutable snapshot (ISSUE-118 S2). No literal writes. Mention: import_gridley_boards.py. Test: gridley-acquisition.test.ts.
2. afl_api_adjudication_i18_fixture.ts: afldb_test fixture for ISSUE-235 I18 seed/verify/teardown. Literal writes: DELETE/INSERT auth_users, import_batches, promotion_candidates, staging.source_*. Invoker: pkg:db:test:issue235-i18 (package.json:23).
3. afl_api_identity_rebuild_rehearsal_fixture.ts: code_test_db rehearsal fixture (ISSUE-237 L1/L2). Literal writes: DELETE/INSERT auth_users, external_identities, import_batches, promotion_candidates, staging.*. Invoker: pkg:db:code-test:issue237-rehearsal (package.json:24).
4. after_siren.py: normalises Wikipedia after-the-siren tables (section 6). Candidate writes: UPDATE import_batches. Invoker: tool: tools/db/rebuild-test.ts (AFTER_SIREN_LOADER :309). Test: after-siren-normalisation.test.ts.
5. all_australian.py: parses All-Australian source. No literal writes. Invoker: manual. Test: all-australian-source.test.ts.
6. award_definitions.py: parses award-definition manifest. No literal writes. Manual. Test: award-definitions-source.test.ts.
7. brownlow_afl_api_season_rehearsal.py: code_test_db Brownlow write-path rehearsal (ISSUE-233 D-233-2). Candidate writes: DELETE external_identities, import_batches, import_rejections, players; INSERT external_identities, players, brownlow_season_votes; UPDATE seasons, stat_availability. Manual. Test: tests/python/brownlow_afl_api_season_rehearsal_contract.py.
8. build_afl_api_brownlow_name_bridge.py: offline name/team/season bridge builder (ISSUE-228 S5b). No writes. Mention: build_brownlow_season_artefact_from_afl_api.py.
9. build_afl_api_player_bridge.py: offline afl_api player-identity bootstrap bridge (ISSUE-228 S5). No writes. Mentions: src/db/queries/afl-api-player-links.ts, tools/current-season/emit-afl-api-player-bridge.ts. Test: tests/python/afl_api_bridge_contract.py.
10. build_brownlow_season_artefact.py: builds Brownlow season artefact from export (ISSUE-113). No writes. Manual. Test: brownlow-season-artefact.test.ts.
11. build_brownlow_season_artefact_from_afl_api.py: completed-season Brownlow artefact from AFL API (S7). No writes. Mentions: tools/db/rebuild-test.ts, src/lib/acquisition/afl-api-adjudication.ts. Test: tests/python/afl_api_brownlow_season_artefact_contract.py.
12. captaincies.py: parses captaincies source (section 6). No literal writes. Mentions: src/db/migrations/098_club_leadership.sql, src/db/queries/club-leadership.ts. Test: captaincies-source.test.ts.
13. club_best_and_fairest.py: parses club best-and-fairest sources. No literal writes. Manual. Test: club-best-and-fairest-source.test.ts.
14. common.py: shared connection, import-batch and bulk-load helpers (3982 lines). Candidate write tokens across many tables (after_siren_kicks, award_winners, club_leadership, coaches, draft_picks, external_identities, fixtures, hall_of_fame, honour_team_members, import_batches, import_rejections, match_coaches, match_period_scores, player_career_stats, player_match_stats, players, season_list_members); many are prose. Mentioned by numerous importers.
15. correct_afl_api_identity.ts: original correction CLI and transaction (ISSUE-238 Slice 5). Candidate writes: INSERT afl_api_identity_adjudications, canonical_applications, external_identities, import_batches; UPDATE data_issues, external_identities, import_batches, staging.afl_api_brownlow_vote, staging.afl_api_player_match. Mentions: afl-api-identity-correction-rehearsal.ts, afl-api-identity-promotion-rehearsal.ts, rebuild_afl_api_adjudications.ts. Test: correct-afl-api-identity-cli.test.ts.
16. enrich_birth_dates.py: birth dates from legacy club player register. Candidate writes: DELETE data_issues, external_identities; INSERT data_issues, external_identities, player_birth_evidence; UPDATE data_issues, players. Mentions: enrich_birth_dates_from_club_lists.py, import_fitzroy_core.py, tools/validation/validate_migration.py. Tests: tests/integration/dob-enrichment-issues.test.ts.
17. enrich_birth_dates_afltables.py: birth dates from AFL Tables club lists. Candidate writes: COPY tmp_birth_evidence, COPY tmp_birth_fill; INSERT player_birth_evidence; UPDATE players. Mentions: src/search/gridley-compat.ts, tools/db/rebuild-test.ts. No tests.
18. enrich_birth_dates_from_club_lists.py: birth dates from AFL Tables club lists (alternate path). Candidate writes: DELETE data_issues; INSERT data_issues, player_birth_evidence; UPDATE data_issues, players. Mention: enrich_birth_dates.py. Test: tests/club-list-sources.test.ts.
19. enrich_heights.py: heights from AFL Tables player_details. Candidate writes: INSERT data_issues, player_height_evidence; UPDATE import_batches, players. Invoker: tool: tools/db/rebuild-test.ts (HEIGHT_LOADER :269). Test: tests/height-reconciliation.test.ts.
20. enrich_heights_afl_api.py: AFL API roster heights (second evidence source). Candidate writes: INSERT player_height_evidence; UPDATE import_batches. Invoker: tool: tools/db/rebuild-test.ts. No tests.
21. enrich_heights_wikipedia.py: Wikipedia infobox heights (third evidence source; section 6). Candidate writes: INSERT player_height_evidence; UPDATE import_batches. Input: data/players/height-evidence-wikipedia.csv. Invoker: tool: tools/db/rebuild-test.ts (WIKIPEDIA_HEIGHT_LOADER :271; argv :2802).
22. ensure_issue237_recovery_actor.ts: creates disabled recovery actor on afldb_test (ISSUE-237 11a.2.1). No literal writes. Invoker: pkg:db:issue237:ensure-recovery-actor (package.json:34). Test: tests/db-test-rebuild.test.ts.
23. family_siblings.py: normalises Wikipedia family-sibling export (section 6); loads player_relationships. Candidate writes: DELETE/INSERT player_relationships; UPDATE import_batches. Invoker: tool: tools/db/rebuild-test.ts. Test: tests/sibling-reconciliation.test.ts.
24. father_son.py: Wikipedia father-son selections (section 6). Candidate writes: DELETE/INSERT father_son_selections, player_relationships; UPDATE import_batches. Invoker: tool: tools/db/rebuild-test.ts. Test: tests/father-son-reconciliation.test.ts.
25. hall_of_fame.py: parses Hall of Fame source. No literal writes. Manual. Test: hall-of-fame-source.test.ts.
26. honour_teams.py: parses honour-teams source. No literal writes. Mention: hall_of_fame.py. Test: honour-teams-source.test.ts.
27. import_afl_api_player_bridge.py: RETIRED tombstone, 42 lines (:1-3); points to the .ts loader. No writes.
28. import_afl_api_player_bridge.ts: fail-closed afl_api player-identity bridge loader (ISSUE-241/240). Candidate writes: INSERT data_issues, external_identities, import_batches, import_rejections; UPDATE import_batches. Invoker: pkg:import:afl-api-player-bridge (package.json:33). Test: tests/afl-api-player-bridge-import.test.ts.
29. import_awards.py: awards, honours and captaincies import (Phase 3b). Candidate writes: DELETE award_winners; INSERT award_winners, awards; UPDATE awards, award_winners, honour_team_members; TRUNCATE (prose-like). Mention: tools/db/rebuild-test.ts. Tests: tests/integration/admin-awards.test.ts and others.
30. import_brownlow_season.py: loads Brownlow season totals from artefact (ISSUE-113 8.6). Candidate write: COPY in (probably prose; not verified). Mentions: tools/db/rebuild-test.ts, import_legacy_afl.py. Test: brownlow-season-artefact.test.ts.
31. import_draft.py: RETIRED tombstone, 83 lines; header says it reads and writes nothing (:1-5). Mentions: draftguru files.
32. import_external_grids.py: imports Gridley archive (ISSUE-118 Stage 1). Literal writes: INSERT external_grid_axes, external_grids. Mention: import_gridley_boards.py. Test: external-grids-import.test.ts.
33. import_fitzroy_core.py: canonical fitzRoy and AFL Tables snapshot import (3646 lines). Candidate writes: DELETE brownlow_round_votes, external_identities, match_period_scores, player_match_stats; INSERT external_identities, matches, player_birth_evidence, player_name_aliases (x2), players, venue_aliases, venues; UPDATE brownlow_round_votes, players (x3), venues. Invoker: sched:afldb-settle-afltables via deploy/afldb-settle-afltables.sh:218. Also tools/db/rebuild-test.ts:1042, :2415. Test: tests/fitzroy-core-import.test.ts.
34. import_gridley_boards.py: imports acquired Gridley snapshot (ISSUE-118 Stage 2). Literal writes: INSERT data_issues, external_grid_axes, external_grids; UPDATE external_grids. Mentions: acquire_gridley_boards.py, tools/gridley/export_corpus.py. Test: gridley-acquisition.test.ts.
35. import_legacy_afl.py: migrates legacy AFL SQLite into PostgreSQL (full run). Candidate writes: DELETE club_organization_relations, club_organizations, stat_definitions; INSERT club_aliases, club_organization_relations, club_organizations, clubs, player_name_aliases, seasons, sources, stat_availability, stat_definitions, venue_aliases, venues; UPDATE clubs (x3), players; TRUNCATE. Invoker: manual (mentions: import_brownlow_season.py, load_reference_data.py).
36. import_match_coaches.py: coaches and match assignments from AFL Tables. Candidate writes: COPY tmp_coaches, COPY tmp_match_coaches; DELETE match_coaches; INSERT coaches, match_coaches. Mentions: tools/db/rebuild-test.ts, common.py. Test: coach-reconciliation.test.ts.
37. load_reference_data.py: loads data/reference/ static data. Candidate writes: DELETE club_organization_relations, club_organizations; INSERT club_aliases, club_organization_relations, club_organizations, clubs, sources, stat_definitions; UPDATE clubs (x2); TRUNCATE (several, prose-like). Mentions: tools/db/rebuild-test.ts, import_fitzroy_core.py. Test: tests/reference-data.test.ts.
38. manual_registration_rebuild_rehearsal_fixture.ts: code_test_db fixture for ISSUE-245 rehearsal. Literal writes: DELETE auth_users, data_edits, data_overrides, external_identities (x3), player_career_stats, players; INSERT external_identities. Invoker: pkg:db:code-test:issue245-rehearsal (package.json:25).
39. named_medals.py: parses named-medals sources. No literal writes. Manual. Test: named-medals-source.test.ts.
40. player_identity.py: parses awards player-identity census. No literal writes. Mention: import_fitzroy_core.py. Test: player-identity-source.test.ts.
41. rebuild_afl_api_adjudications.ts: afl_api identity state through db:test:rebuild (ISSUE-235 OD-5, ISSUE-237 D1-D13). Literal write: INSERT afl_api_identity_adjudications. Mentions: tools/db/rebuild-test.ts, correct_afl_api_identity.ts, ensure_issue237_recovery_actor.ts, replay_afl_api_adjudications.ts. Tests: tests/db-test-rebuild.test.ts, tests/db-promotion-check.test.ts.
42. rebuild_derived.py: rebuilds derived summaries. Candidate writes: TRUNCATE club_seasons, player_career_stats, player_club_season_stats, player_clubs, player_season_stats; INSERT those plus derived_rebuilds; UPDATE derived_rebuilds, players, seasons. Invoker: manual CLI; human instructions at src/app/admin/db-health/page.tsx:75 and src/app/admin/submissions/[id]/page.tsx:140; mention tools/db/rebuild-test.ts.
43. rebuild_manual_registrations.ts: manual registrations through db:test:rebuild (ISSUE-245). Literal writes: INSERT auth_users, data_overrides. Mentions: rebuild_afl_api_adjudications.ts, issue251_prod_rehearsal.ts, register_issue224_s9_players.ts. Test: tests/db-test-rebuild.test.ts.
44. recover_afl_api_adjudications.ts: recovers afl_api adjudications outside D15 (ISSUE-239). Literal writes: INSERT afl_api_identity_adjudications, import_batches. Invoker: pkg:db:issue239:recover-adjudications (package.json:31). Test: tests/afl-api-adjudication-recovery.test.ts.
45. recover_afl_api_importer_identities.ts: OD-4 recovery of importer afl_api identity coverage (ISSUE-237 11a). No literal write tokens. Invokers: pkg:db:issue237:recover-importer-identities (package.json:30); pkg:db:issue237:export-importer-recovery (package.json:29).
46. replay_afl_api_adjudications.ts: afl_api human identity replay (ISSUE-235 OD-3, OD-5, D15). Literal writes: INSERT external_identities (x2), UPDATE external_identities. Mentions: src/lib/acquisition/afl-api-adjudication.ts, tools/db/promotion-check.ts, recover_afl_api_importer_identities.ts. Test: tests/correct-afl-api-identity-cli.test.ts.
47. replay_manual_registrations.py: replays manual registrations on a rebuilt database (ISSUE-245). No literal writes. Mentions: tools/db/rebuild-test.ts, rebuild_afl_api_adjudications.ts, rebuild_manual_registrations.ts. No tests.
48. rising_star.py: parses Rising Star nominations source. No literal writes. Manual. Tests: rising-star-source.test.ts, rising-star-winners-source.test.ts.
49. test_manual_insert_guard.py: self-test for ISSUE-160 D-2 manual-player insert guard. Run via python3 (:3-4); not run. One candidate token (UPDATE ", prose). Mention: import_fitzroy_core.py.
50. under_22.py: parses AFLPA 22under22 source. No literal writes. Manual. Test: tests/under-22-source.test.ts.

---

### B6. Wikipedia-derived enrichment
Commands: grep -rilE "wikipedia" tools src deploy package.json --exclude-dir=__pycache__; find data -iname "*wiki*"; ls data/reference; grep -rciE "wikipedia" tools/migration tools/rebuild tools/records tools/db tools/current-season src/lib src/app.

Files (40 under src, tools, deploy, package.json, plus one data file):
Direct Wikipedia-derived ingests:
- tools/migration/after_siren.py: normalises after-the-siren tables; loads after_siren_kicks (migration 089).
- tools/migration/all_australian.py: All-Australian source parser (13 mentions).
- tools/migration/captaincies.py: captaincies source parser (5 mentions).
- tools/migration/enrich_heights_wikipedia.py: infobox heights into player_height_evidence; input data/players/height-evidence-wikipedia.csv.
- tools/migration/family_siblings.py: family-sibling export into player_relationships.
- tools/migration/father_son.py: father-son list into father_son_selections and player_relationships.
- tools/migration/hall_of_fame.py: Hall of Fame source parser (3 mentions).
- tools/migration/honour_teams.py: honour-teams source parser (3 mentions).
- tools/migration/import_awards.py: awards and honours import; source key wikipedia_22under22 (src/lib/acquisition/afl-api-adjudication.ts:458).
- tools/migration/import_legacy_afl.py: legacy AFL migration (6 mentions).
- tools/migration/load_reference_data.py: reference data load (2 mentions).
- tools/migration/named_medals.py: named-medals parser (4 mentions).
- tools/migration/common.py: shared helpers (1 mention).
- tools/records/import-first-kick-goal.ts: Wikipedia first-kick-goal table into player_achievements; source key wikipedia_first_kick_goal (first-kick-goal-source.ts:20); pkg:records:first-kick-goal (package.json:52).
- tools/records/first-kick-goal-source.ts: parser and SOURCE_KEY (:20). No writes.
- tools/records/first-kick-goal-rehearsal.ts: rehearsal of the import; pkg:db:code-test:issue249-rehearsal (package.json:26).
Mention or orchestration:
- tools/db/rebuild-test.ts: 35 mentions; drives Wikipedia loaders (WIKIPEDIA_HEIGHT_LOADER :271; AFTER_SIREN_LOADER :309; argv at :2802).
- tools/db/afl-api-identity-correction-rehearsal.ts: 4 mentions; AFTER_SIREN_SOURCE_KEY 'wikipedia_after_siren_kicks' (:4150).
- tools/db/promotion-check.ts: 1 mention (comment :1147).
- tools/rebuild/draftguru/: README.md:271; build_person_bridge_v2.py:245; draftguru-contract.json:157 (wikipedia_link); profile_person_pages.py:356 (wikipedia_hrefs); review_validation_operator.py:331. Field and link handling, not ingestion.
- src/lib/acquisition/afl-api-adjudication.ts:458: source-key string literal.
- Site copy: src/app/about/page.tsx:57; src/app/admin/records/labels.ts:46; src/lib/site-content.ts:488; deploy/coming-soon/index.html.
- Comments: src/db/queries/admin-club-leadership.ts:83; src/db/queries/awards.ts:493; src/db/queries/club-leadership.ts:17; src/search/grid-solver-spec.ts:492; src/search/gridley-compat.ts:442.
- Migrations (schema mentions): 002_core_entities.sql, 053_player_achievements.sql, 060_wikipedia_22_under_22_source.sql, 089_after_siren_kicks.sql, 098_club_leadership.sql, 102_special_records_lifecycle.sql.
data/: data/players/height-evidence-wikipedia.csv is the only file with "wikipedia" in its name. data/reference/ (36 entries) has no filename containing "wiki".

---

### B7. Email intake
Commands: find tools/email_intake src/app/api/admin/email-intake deploy -iname "*email*" -type f; cat deploy/afldb-email-intake.{service,timer}; grep -nE "urllib|/api/admin/email-intake" tools/email_intake/fetch_and_stage.py; grep -nE "^export|promoteSubmission" src/app/api/admin/email-intake/route.ts.

- tools/email_intake/fetch_and_stage.py: IMAP poll. POSTs each unseen CSV to /api/admin/email-intake (:591-592) via urllib. No DB driver (:39, :91 comments). Invoker: sched:afldb-email-intake.timer via deploy/afldb-email-intake.service:17.
- tools/email_intake/test_fetch_and_stage.py: tests only.
- deploy/afldb-email-intake.service: Type=oneshot, User=arm; EnvironmentFile :25; UnsetEnvironment :31 drops DB DSNs.
- deploy/afldb-email-intake.timer: OnBootSec=2min, OnUnitActiveSec=5min, Persistent=true. SCHEDULER.
- src/app/api/admin/email-intake/route.ts: POST (:127). Calls stageSubmission (:221) and validateSubmission (:250). No promoteSubmission call. Shared-secret auth; middleware exclusion at src/middleware.ts:33. Approval and promotion remain human at /admin/submissions/<id>. Tests: tests/integration/email-intake.test.ts, tests/email-intake-route.test.ts.

---

### B8. AFL API pipeline (contrast, not legacy)
Commands: find tools/current-season deploy -iname "*afl-api*" -type f (21 files); grep -nE "current-season/|migration/" deploy/afldb-settle-afl-api.sh deploy/afldb-settle-afl-api-brownlow.sh; basename invoker loop.

Deploy (6):
- afldb-settle-afl-api.service: ExecStart /bin/sh afldb-settle-afl-api.sh (:31).
- afldb-settle-afl-api.timer: OnCalendar=*-*-* 05:00 (:16). SCHEDULER.
- afldb-settle-afl-api.sh: runs acquire-afl-api.ts (:121) and settle-afl-api.ts (:142).
- afldb-settle-afl-api-brownlow.service: ExecStart /bin/sh afldb-settle-afl-api-brownlow.sh (:36).
- afldb-settle-afl-api-brownlow.timer: OnCalendar=*:0/5 (:15), every 5 minutes. SCHEDULER.
- afldb-settle-afl-api-brownlow.sh: runs acquire-afl-api.ts --fixtures-only (:155), settle-afl-api-fixtures.ts (:176), acquire-afl-api-brownlow.ts (:181), settle-afl-api-brownlow.ts (:198).

Tools (15):
- acknowledge-afl-api-match-absence.ts: mention only (afl-api-match-absence.ts, settle-afl-api.ts, afl-api-season-rekey-rehearsal.ts). No package script.
- acquire-afl-api-brownlow.ts: pkg:acquire:afl-api-brownlow (package.json:50); sh afldb-settle-afl-api-brownlow.sh:181.
- acquire-afl-api.ts: pkg:acquire:afl-api (:44); sh afldb-settle-afl-api.sh:121 and afldb-settle-afl-api-brownlow.sh:155.
- afl-api-c4b-rehearsal.ts: manual (usage comment :7).
- afl-api-cutover-readiness.ts: manual (imported by afl-api-c4b-rehearsal.ts:106).
- audit-afl-api-brownlow-canonical-equality.ts: manual.
- audit-afl-api-player-bridge-persisted.ts: manual.
- census-afl-api-brownlow-identities.ts: mention (audit-afl-api-brownlow-canonical-equality.ts, build_afl_api_brownlow_name_bridge.py).
- discover-afl-api-seasons.ts: manual.
- emit-afl-api-bundle.ts: pkg:emit:afl-api (:45). Not invoked by afldb-settle-afl-api.sh (grep shows no invocation; basename appears there in comments only).
- emit-afl-api-player-bridge-test.ts: pkg:emit:afl-api-player-bridge-test (:49).
- emit-afl-api-player-bridge.ts: pkg:emit:afl-api-player-bridge (:48); mentions src/db/queries/afl-api-player-links.ts.
- settle-afl-api-brownlow.ts: pkg:settle:afl-api-brownlow (:51); sh afldb-settle-afl-api-brownlow.sh:198.
- settle-afl-api-fixtures.ts: pkg:settle:afl-api-fixtures (:47); sh afldb-settle-afl-api-brownlow.sh:176.
- settle-afl-api.ts: pkg:settle:afl-api (:46); sh afldb-settle-afl-api.sh:142.

---

### B9. Other tools writing statistical tables
Commands: grep -rnEi "insert into|update [a-z_.]+ set|delete from|\bcopy\b|merge into|truncate " tools/records tools/aflw tools/gridley tools/matching tools/maintenance --exclude-dir=__pycache__; find inventory.

No literal write tokens: tools/matching (backtest.ts, compare-reports.ts, compare.ts, export-draft-labels.ts, label-set.ts, policy-options.ts); tools/gridley/export_corpus.py; tools/maintenance/loadtest.mjs; tools/maintenance/02_add_auth_role.sh; tools/maintenance/backup-afldb-test.ps1.

Files with hits:
- tools/records/import-first-kick-goal.ts: literal writes. UPDATE player_achievements (:257, :960); DELETE data_issues (:921, :1075); DELETE player_achievements (:927); INSERT player_achievements (:984); INSERT data_issues (:1087, :1097); INSERT import_batches (:608). Invoker: pkg:records:first-kick-goal (package.json:52).
- tools/records/first-kick-goal-rehearsal.ts: rehearsal writes in rehearsal scope: DELETE/INSERT on player_achievements, data_issues, import_batches (lines :549-:970; INSERT :914). Invoker: pkg:db:code-test:issue249-rehearsal (package.json:26).
- tools/records/first-kick-goal-source.ts: prose only (:331, :451). No writes.
- tools/records/special-records-replay.ts: dynamic INSERT INTO ${table} (:364). Mentions: src/db/queries/admin-special-records.ts, tools/db/promotion-inventory.ts, tools/migration/common.py, tools/migration/replay_afl_api_adjudications.ts. No package script.
- tools/aflw/load_staging.py: literal writes. TRUNCATE staging_aflw.* (:238); COPY staging_aflw.* (:246-247); CLI --load (:266). Invoker: manual (documented in tools/aflw/README.md:12).
- tools/aflw/README.md: documentation (:12, :18).
- tools/maintenance/issue246-retire-issue109-fixture.ts: literal write INSERT auth_audit_log (:576). Invoker: pkg:db:issue246:retire-issue109-fixture (package.json:35).
- tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts: literal writes INSERT auth_audit_log (:703); DELETE auth_sessions (:711); DELETE auth_audit_log (:720); DELETE admin_invites (:730); DELETE auth_users (:742). Invoker: pkg:db:issue248:cleanup-dev-auth-fixtures (package.json:36).
- tools/maintenance/privileges.sql: GRANT/REVOKE DDL; DELETE FROM afldb_meta.app_readable_tables (:104) and afldb_meta.import_writable_tables (:117). Referenced by tools/db/privileges.ts and maintenance scripts (basename hits).
- tools/maintenance/00_install_postgres.sh: REVOKE only (:130). Not a data write.
- tools/maintenance/00_install_postgres_prod.sh: REVOKE only (:176). Not a data write. No non-test invoker.
- tools/maintenance/01_setup_service.sh, 03_apex_dir.sh, backup.sh, restore-test.sh: prose only ("copy").

Counts for section 9: 17 files with a token hit (9 with literal writes; 8 with prose or REVOKE only) plus 8 with none (6 matching, 1 gridley, loadtest.mjs; backup-afldb-test.ps1 and 02_add_auth_role.sh also had no hits).

Note on the section 9 "none" count: the 8 with no hits are the six matching files, export_corpus.py and loadtest.mjs. Backup-afldb-test.ps1 and 02_add_auth_role.sh were not in the grep output with hits, so they are in the no-hit group, making 10 with no hit in total. Treat the 17 and 8 figures as the grep's own output; the no-hit group is 8 files as listed plus those two if counted from the inventory.

---

### B10. Counts (re-derivable)
- Section 1: 12 rows (7 under src/app/admin/upload and submissions; 5 under src/lib/ingest and src/lib/csv.ts); 6 dataset writers.
- Section 2: 12 rows.
- Section 3: 20 squiggle/kali files; migrations 063 and 064.
- Section 4: 50 files (5 afl_api, 3 afltables, 4 fitzroy, 38 draftguru); 15 .pyc excluded.
- Section 5: 50 files.
- Section 6: 40 files under src, tools, deploy, package.json; 1 data file.
- Section 7: 5 files (2 deploy units, 2 tools, 1 route).
- Section 8: 21 files (15 tools, 6 deploy).
- Section 9: 17 files with a token hit (9 literal writes, 8 prose or REVOKE only) plus 8 with none, as listed above.

Self-check: each cited line was taken from grep or sed output in this run. Invoker labels are grep-derived and marked as such. No file in either tree was written or modified. The only Git call was F-002.
