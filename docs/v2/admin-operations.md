# AFLDB V2 — admin operations centre: operating guide (plan D9, ADR 0009)

Status: implemented state at the close of Stage 5 (Launch D, 2026-10-19). Nothing here has been
rendered against a database or exercised on PostgreSQL: the pages need a database and a staff
session, which the V2 workstation does not have (V2-GAP-022), and the new SQL ran only on in-memory
PGlite over labelled stubs (V2-GAP-017). Roles and capabilities are the existing Admin Centre policy
(`src/lib/auth/capabilities.ts`); Stage 5 adds one read capability, `operations.centre.read`.

## 1. Who may use what

| Area | Route | Read | Mutate |
|---|---|---|---|
| Operations centre (overview) | `/admin/operations` | `operations.centre.read` (Admin, Super Admin) | none: the page has no form and no button |
| Award proposals (queue) | `/admin/operations/awards` | `data.awards.read` (Admin, Super Admin) | create from a local file: `data.awards.edit` (Super Admin) |
| Award proposal (one) | `/admin/operations/awards/[id]` | `data.awards.read` | validate / approve / reject: `data.awards.edit` |
| Coleman Medal derivation | `/admin/operations/coleman` | `data.awards.read` (includes the read-only compare) | publish: `data.awards.edit` |
| Brownlow reconciliation and medal determination | `/admin/operations/brownlow` | `data.brownlow.read` (Admin, Super Admin) | record an eligibility decision: `data.brownlow.finalise` (Super Admin) |

Every page calls its capability guard as its first awaited statement; every server action does the
same, and the server caller (`src/lib/admin/operations-centre.ts`) checks the capability again, so a
hidden button is never the control (`tests/auth.test.ts`, `tests/v2-admin-operations.test.ts`,
`tests/v2-admin-operations-ui.test.ts`). The sidebar shows "Operations centre" in the Overview group
to every Admin and Super Admin; the retired "Legacy file intake" link is gone.

## 2. The overview (`/admin/operations`, read-only)

- **Data health:** the AFL API coverage registry (`@afldb/domain` `COVERAGE_REGISTRY`): counts per
  status overall and per family, and the season span of each status. The season-by-season matrix
  is the repository file `docs/v2/coverage-matrix.md`.
- **Sealed seasons:** from `data/reference/seasons.json` through `src/lib/seasons/sealed-seasons.ts`,
  read fresh on every request. If the registry cannot be read the page says so, and every
  approval and publication is refused (the seal fails closed).
- **Acquisition runs, status only:** the AFL API settle units, and, labelled as such, the AFL
  Tables nightly settle that still runs on the host behind AFLDB-ISSUE-316 until the owner's
  ISSUE-316 decisions retire it (D-316-1 at C2; the timer is disabled by C5 under D-316-4; plan §7
  R-042). V2 neither starts nor stops it; there is no start button anywhere.
- **Curated awards and derived results:** links, and the count of undecided proposals for a
  viewer holding `data.awards.read`.
- **Inspection tools:** links shown only to a viewer holding each tool's capability: audit trail,
  database health, application health, data QA search, player links (unresolved identities),
  Brownlow administration, current season. There is no view of AFL API settle refusals yet
  (V2-GAP-025).
- **Maintenance:** there is no "run everything" control. Each explicit operation lives on its own
  page and shows its consequences before it runs.

Every read on the overview is isolated: one failing read is an inline notice in its own section,
with generic text (a thrown message is logged on the server, never rendered).

## 3. What each operation changes

Each mutation form shows an action card before its submit control: what it will change, the
affected season or records, the validation state, whether it is reversible, the acting user, and
the resulting audit entries. After submit it shows the outcome, codes, field errors, validation
issues and any audit warning. **An audit warning means the change WAS made: do not resubmit.**

| Operation | Changes | Reversible | Durable audit (same transaction) | Activity-trail row (`auth_audit_log`) |
|---|---|---|---|---|
| Create proposals from a local file (JSON or CSV, pasted or uploaded; nothing is fetched) | N `award_proposals` (status `proposed`) and N ledger rows, all or none; validates and approves nothing | in effect: a proposal can be rejected or left alone | `award_proposal_decisions` ledger | `admin.curated_award_created` / `admin.curated_award_refused` |
| Validate | status to `validated` or `validation_failed`; one ledger row | yes (re-validate, or reject) | ledger | `admin.curated_award_validated` / `admin.curated_award_refused` |
| Approve | one transaction: re-validate, pass the season seal, write `award_winners` with `data_overrides` and `data_edits` through `insertAwardWinner`, set `approved`, write the ledger; any failure rolls all of it back | **no**; an approved winner is corrected by an audited approved revision (below) or through `/admin/awards` | ledger and `data_edits` | `admin.curated_award_approved` / `admin.curated_award_refused` |
| Reject | status to `rejected`; the reason (at least 10 characters) kept in the ledger | **no**: terminal; a corrected entry is a new proposal | ledger | `admin.curated_award_rejected` / `admin.curated_award_refused` |
| Coleman publish | one transaction: one append-only `derived_award_results` row (none when unchanged), then the projection into `award_winners` with the loader's key and row tuple (insert / update / void / retain; refuses foreign rows, administrator overrides and voided derived rows), `data_edits` per changed row and one `derived_award_projections` provenance row (none on an idempotent rerun); the form posts the returned public paths to `/admin/awards/revalidate` (ADR 0015) | not undone; a later republish supersedes and is itself audited | `derived_award_results.correction` (workflow `derived_award_publication`), `derived_award_projections`, `data_edits` | `admin.coleman_published` / `admin.coleman_publication_refused` |

Notes:

- Approving into a **sealed** season is an audited correction (workflow `curated_award_approval`)
  and needs a decision note of 20 to 2000 characters; approving Wikipedia-derived input needs a
  note of at least 20 characters. **Four eyes (Launch F):** the creator of the revision being approved may not
  approve it, except a Super Admin who supplies a self-approval attestation of at least 20 characters; the
  approval ledger row records `selfApproval` and the attestation (ADR 0008).
- **Revise approved winner (Launch F, V2-GAP-018):** one transaction that validates the new values, passes the
  seal (`curated_award_approval`), corrects the canonical row in place (non-identity fields) or voids it and
  records the replacement (identity fields), supersedes the approved revision (`supersede_approved`) and inserts
  the new approved revision (`revise_approved`); a note of 20-2000 characters is required. Any failure rolls all
  of it back. Audit: two ledger rows plus the replace/correct `data_edits` and `data_overrides` rows;
  activity row `admin.curated_award_revised`.
- **Identity first (V2-GAP-020):** a winner without a durable player identity cannot be approved (re-validation
  refuses with `player_unresolved`). Link the player through the existing identity tools (player links), then
  propose again.
- Coleman **publish** needs the operator's "settled" attestation (every promotion and settle for
  the season has concluded; plan §7 R-022) and a note of 20 to 2000 characters. The evidence
  reference stored with it is `coleman_derivation:<season>:<inputChecksum>`. A season with a goal
  that is not recorded cannot be derived: a missing statistic is never counted as zero.
- The Coleman **compare** is read-only for any Admin: it derives a season from the database and
  compares it with the stored winners and the current publication; it writes and audits nothing.
- Activity-trail rows are written after the transaction settles and can never change its outcome
  (the awards-admin pattern); reads write no audit row.
- Approval, approved revision and Coleman publication return the server-computed public paths and the form
  posts them to `/admin/awards/revalidate` after success, as `/admin/awards` does (V2-GAP-024).
- Every database call of the operations centre uses the import-role connection
  (`AFLDB_IMPORT_DATABASE_URL`, as the other audited editors do); the activity trail uses the auth
  connection.

## 4. Brownlow reconciliation and eligibility-aware medal determination (`/admin/operations/brownlow`)

Pick a season and an eligibility rule. The page runs `reconcileBrownlowSeason` (ADR 0007) over the
staged AFL API round votes (`staging.afl_api_brownlow_vote`), the stored totals
(`brownlow_season_votes`) and the match context (`matches`), and shows the outcome, findings by
severity, comparisons, raw totals, and a leader only when the determination is `determined`.
Caveats stated on the page: no eligibility rule is recorded for API-era seasons (V2-GAP-016; the
default rule `unrecorded` refuses a leader when an ineligible player polled votes). The page also
shows what the staged API leaderboard and the provider-team-to-club mapping contributed (V2-GAP-023):
the leaderboard summary, the 18-team mapping with its fixture corroboration, or the specific refusal
codes when the mapping cannot be derived whole; a season whose settle has not staged a leaderboard is
still labelled "not staged" and its leaderboard comparison reads "not supplied".

**Medal determination (Launch F, ADR 0014).** The page also shows the owner's eligibility-aware determination: the
raw leaderboard for every vote-getter with each player's eligibility status (eligible, ineligible, missing,
ambiguous) and its source. Authoritative evidence is the current administrator decision
(`brownlow_eligibility_decisions`), else a RECORDED statement in `brownlow_season_votes` (`is_ineligible = true`; or
`false` on an admin-published season or with a recorded `eligible_rank`); the AFL API flag is never authoritative.
A known-ineligible player is excluded; if a player in the deciding group is missing or ambiguous the result is
`requires_review` and no winner is named; tied eligible leaders are joint winners. A Super Admin
(`data.brownlow.finalise`) records an eligibility decision with a required citation and a 20-2000 character note;
it is one append-only row (a later decision supersedes it), sealed seasons carry the
`brownlow_eligibility_decision` audited correction, and the determination is recomputed at once. Raw votes and
`brownlow_season_votes` are never written: projecting a decision into the published table remains the existing
`/admin/brownlow` publish workflow, and the page says when the stored `is_winner` flags disagree.

## 5. Retired controls (V2-GAP-013, `docs/v2/legacy-disposition.md` L1-L3, L5, L6)

The CSV upload, the CSV submission review and promotion, the email-intake route, the Squiggle/Kali
refresh and the AFL Tables settle trigger are gone from the admin UI. Their server actions and
route handlers still exist under their old names, keep their old guards, and refuse with
`{ refused: true, code: 'legacy_retired', surface, error }` (routes: HTTP 410) and one
`admin.legacy_retired_refused` activity-trail row; the email-intake route answers 410 without
reading the request or writing anything. Historical submissions stay readable at
`/admin/submissions/[id]`. Corrections go through the audited editors (`/admin/awards`, the data
editor and the other Data pages) and award proposals.

## 6. Screens the owner must eyeball (VISUAL: UNVERIFIED for every real page)

Component-level captures from synthetic props exist (`docs/v2/evidence/stage5-visual/`, 1280x800
and 390x844, made offline). An automated check found no horizontal overflow at either width after
one wrapping fix; no agent or person has inspected the images, and no real page has been rendered
(V2-GAP-022). Please check, signed in on an isolated environment, at desktop and mobile widths:

1. `/admin/operations` as Admin and as Super Admin (and with `data/reference/seasons.json` unreadable, if practical).
2. `/admin/operations/awards`: empty queue, populated queue, the create form (Super Admin only).
3. `/admin/operations/awards/[id]`: a validated proposal with the decision panel (Super Admin) and read-only (Admin); a sealed-season approval refusal.
4. `/admin/operations/coleman`: before compare, a derivable comparison, a refusal, the publish form.
5. `/admin/operations/brownlow`: a reconciled season and a refused one.
   Launch F additions: the medal determination (determined, tie, requires_review) and the eligibility decision form
   (Super Admin) with its success and error states; the Coleman award_winners preview and publish outcome; the curated
   self-approval attestation field and the "Revise approved winner" panel.
6. `/admin/current-season`: only the AFL API switches and the AFL API settle units remain.
7. `/admin/upload` (retirement notice), `/admin/submissions/[id]` (read-only history), `/admin` (no review notice, read-only submissions log).
8. The admin sidebar for Admin and Super Admin.
