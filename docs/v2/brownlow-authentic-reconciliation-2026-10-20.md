# Authentic 2025 Brownlow reconciliation and operations-centre application check (2026-10-20)

Sanitised record. Counts, identifiers and digests only; the acquired provider responses, row-level
evidence and logs stay in the restricted rehearsal store (WSL distribution
`AFLDB-V2-Rehearsal-20261020`, `/home/rehearsal/evidence/b2025/`) and are not in Git. **Production
remains NO-GO.** This is **operational-readiness** evidence for one completed season. It is distinct
from the archive-scoped *migration* acceptance (D-V2-BROWNLOW-ALT-1), which it neither extends nor
replaces, and it approves no eligibility assumption. Nothing here touched a production or shared
database; every database is a disposable `afldb_v2_*_test` copy in the isolated loopback-only
PostgreSQL 16.15 cluster.

Code under test: `c51cd5d8` (the isolated tree's `src/` is byte-identical to it; no application
source changed). The only repository addition is `tools/v2/brownlow-operations-check.mts`.

## Part 1 — authentic 2025 Brownlow reconciliation

### Provenance

No retained snapshot was suitable (the documented retained locations hold none; see
`linux-rehearsal-followup-2026-10-20.md`). Season **2025** (competition AFL, `compSeasonId` 73, a
sealed completed season) was therefore acquired read-only, once, on 2026-10-20 (UTC, ~01:42), with the
repository's own acquisition code, bounded to that season, no other provider, no historical crawl.

| Item | Value |
|---|---|
| Brownlow snapshot label | `afl-api-brownlow-2025-2026-10-20-014218` |
| Endpoint 1 | `GET https://api.afl.com.au/cfs/afl/bfawards/season/CD_S2025014` (HTTP 200) sha256 `f860e0a6…f4717` |
| Endpoint 2 | `GET https://api.afl.com.au/cfs/afl/bfawards/leaderboard/season/CD_S2025014` (HTTP 200) sha256 `cce0428d…ec3a3` |
| Feed state | both CONCLUDED; 207 vote sets; 188 players; 188 leaderboard entries |
| Fixtures snapshot label | `afl-api-2025-2026-10-20-014218`: 216 matches, 217 files, all CONCLUDED, season feed complete |
| Retained | original responses, endpoints and parameters, capture times, per-file sha256 manifest (221 files, digest `2ce5a23b…37ef`) |

The acquisition tool's two-key gate is database-backed; the driver injected the ingestion controls in
memory and touched no database. The snapshot checksums are re-verified by the settle on every run
(a one-byte change is refused: below).

### Pathway and results

Disposable copy `afldb_v2_rb_brownlow2025_test` (cloned from the migrated copy; baseline,
migration-only and earlier evidence copies untouched). Order: fixtures settle (validate → dry-run →
apply), Brownlow settle (A validate → B observe → C dry-run → D apply), replay ×2, five refusal
variants, read-only reconciliation, V2 report under both eligibility rules, Brownlow integration suites.

| Check | Result |
|---|---|
| Fixtures spine | 212 built, 4 `finals_label_required` (finals matches outside the home-and-away Brownlow population); 212 observations |
| Match identity | 207 provider matches → 207 distinct canonical home-and-away 2025 matches (all non-final matches covered); 2 rescheduled rounds (provider 24→canonical 1, 3→1) resolved |
| Player identity | 188 bridge identities, unique and injective; every voted player has a stats row in that match and plays for its home or away club (621/621) |
| Raw votes | every match exactly 3-2-1, no duplicates; 621 positive rows; staged = `player_match_stats.brownlow_votes` for all 207 matches (0 differ); canonical round rows = staged by (player, round, votes) |
| Season totals / leaderboard | stored totals (188) = API match-vote sums = canonical round sums = leaderboard totals; leaderboard `roundVotes` 621 = 621; stored `vote_rank` and `eligible_rank` recompute exactly |
| Winner | one player, 39 votes; stored `is_winner`, API leaderboard and the recomputed maximum agree |
| Replay idempotence | two replays: 0 inserted, 207 observations unchanged, `import_batches` +1 per run (the audit row) and nothing else |
| Transactional refusal | five corrupted copies (byte tamper, vote values `[2,2,1]`, duplicate player, duplicate match, two vote rows only): each exit 1, refused **before any database connection**; fingerprints identical |
| Reconciliation script | 42 checks: 41 pass, **1 fail** (eligibility, below) |

**Canonical apply is refused, by design.** The settle's apply built 207 vote sets and wrote **0
canonical rows**: all 207 failed `applyCanonicalUnit` with `ownership_indeterminate`, and 207
`data_issues` were opened. Every one of the 9,522 existing 2025 `brownlow_round_votes` rows is a
legacy row with no source ownership, which the canonical writer will not re-own. Before/after
canonical fingerprints (matches, scores, stats, round and season votes, applications, overrides,
award winners, players, identities, data edits, audit log, the five V2 tables) are identical:
**no partial canonical write**. So the reconciliation of a sealed, legacy-owned season is a staged
projection plus a read-only comparison, not a canonical write.

### Unresolved differences (not adjudicated; expected results unchanged)

1. **Eligibility: 12 players.** The provider marks them `eligible=false` (leaderboard entry and every
   per-vote flag); the stored `is_ineligible` is `false` for all 12. Their season totals are 1–14
   votes (3, 3, 3, 14, 7, 6, 5, 4, 2, 2, 2, 1 across the twelve); **none is the leader**, so the
   outcome (winner, 39 votes) is not affected. The V2 report outcome is `discrepancies` under both
   rules: 12 `eligibility_flag_inconsistent`; under `unrecorded`, also 12 `eligibility_rule_unrecorded`
   (presentation `refused_eligibility_rule_unrecorded`, no leader stated); under
   `stored_eligible_rank_one`, `refused_unreconciled_evidence`. Unknown eligibility **remains
   unresolved**: the migration-only alternative does not approve it, and the application path (Part 2)
   is the mechanism for a ruling.
2. **207 `club_unverifiable` (info).** The reconciliation view has no provider-team→club mapping and
   no staged leaderboard (V2-GAP-023). The script derived an 18-team mapping, functional and
   injective, from the evidence as proof that it is derivable; **nothing is committed**.
3. **`brownlow_round_votes.match_id` is NULL for all 330,383 archive rows**, although migration 094 is
   in the ledger (22,860 positive rows). One integration assertion therefore fails
   (`migration 094 … resolved every historical round row to exactly one match`, expected 330383 to be 0)
   in `admin-brownlow.test.ts`: 45 of 46 pass; `settle-afl-api-brownlow*` 30/30 and
   `v2-brownlow-eligibility` 35/35 pass (110 of 111 overall). This is a property of the restored
   archive, not of V2 code; a read-only measurement shows the 094 backfill statement would now resolve
   all 330,383 rows (0 ambiguous). Re-running it is a production-data operation and needs an owner
   decision; **no data was changed**.
4. **The fixtures settle has no completed-season path** (`settle-season-seal.ts` refuses writing
   settles for a sealed season; only the Brownlow settle has the backtest authority). The
   fixture observations were written with a scratch project root whose seasons registry marks 2025
   in progress; the CLI itself was unmodified. This is a limitation of the historical-season path, not
   a defect to fix before a live season.

## Part 2 — the operations-centre workflow through the real application

`tools/v2/brownlow-operations-check.mts` drives the **actual running Next application** (V2
production build, `127.0.0.1:3912`, loopback only, every non-loopback request aborted: 0 observed)
against a fresh disposable copy of the settled 2025 database (`afldb_v2_rb_brownlowapp_test`),
using synthetic `@example.invalid` users with signed sessions. It operates the real form in
Chromium, captures the genuine Server Action request and replays variants of it over HTTP. It never
calls the operations-centre module or the query layer directly.

Scenario fixture (disposable copy only): the season leader's stored `eligible_rank` is set to NULL, so
the leader's eligibility is *not recorded* and the determination is `requires_review`, which is the
state in which the form is offered. Raw votes are untouched.

**Final run: 41/41 checks pass** (`ops-check.json` sha256 `6a5ce3f2…ab33`; the run was repeated on a
fresh copy after harness faults in earlier runs, all of which were test-script defects, none in the
application; the earlier outputs are retained as superseded).

| Area | Result |
|---|---|
| Page access | anonymous, contributor, disabled and expired-session users are sent to sign-in; Admin and delegated Admin (`can_manage_admins`) see the evidence read-only with no form; Super Admin sees the form |
| Unauthorised action requests | anonymous, contributor, Admin, delegated Admin, disabled, expired: each redirected, **no decision, no publication, no raw change** |
| Origin / CSRF | foreign `Origin` Server Action POST refused (HTTP 500, framework check), no change. Public-refresh route rejects anonymous and plain Admin |
| Valid decision (UI) | one `brownlow_eligibility_decisions` row, `decided_by` the Super Admin, basis `audited_correction` (2025 is sealed) with the correction record; publication metadata changed in the same transaction; publication `data_edits` rows name the actor; **exactly one** `admin.brownlow_eligibility_decided` row; raw votes, season totals, staged votes and matches identical |
| Public-result refresh | the browser's follow-up POST to `/admin/operations/brownlow/revalidate` returned 200 once; the public `/brownlow/2025` page announced the new winner on the first request |
| Invalid input | short note, empty and over-long citation, bad verdict, season out of range, non-numeric ids, unknown player, non-vote-getter: all refused with the documented typed code, nothing written |
| Repeated request | identical resubmission refused `stale_decision`, one refusal audit row, nothing published |
| Revision | a second Super Admin supersedes the first decision (linear chain, both rows kept); published metadata follows; a revision against the superseded id is refused stale |
| Concurrency | two simultaneous first decisions: one commits, the other is refused `stale_decision` |
| Failure injection | a trigger forcing the publication insert to fail: **no decision row, no flag change, no data edit**, refusal audited once; the same request then commits exactly once. A trigger forcing the activity-audit insert to fail: the decision commits, `auditWarning` is returned, no audit row (the durable decision and `data_edits` records are in the transaction) |
| Ledger consistency | 6 decisions, 5 `decided` audit rows (the sixth is the deliberate audit failure); no decision superseded twice; no player published as winner and ineligible |

### Observations (no defect demonstrated; no code changed)

1. **Unauthorised attempts leave no audit row.** The action's `requireCapability` redirect runs before
   the wrapper's own refusal-and-audit path, which the contract describes for "a capability refusal
   reached past the route guard". An Admin who replays the Super Admin action is redirected and
   unrecorded. This matches the documented contract; if the owner wants denied attempts trailed, it
   is a design change, not a defect fix.
2. **Shape failures and pre-service failures are not audited** (season out of range, bad verdict,
   citation, note, ids): they never reach the wrapper. Service refusals (unknown player, non-vote-getter,
   stale, seal) are, once each.
3. **Public refresh is a browser follow-up.** A decision committed by a non-browser client (the
   replays) leaves `/brownlow/<year>` on the previous winner until the refresh route runs, or until the
   page's hourly revalidation. The check measured this and showed the route brings it level in one
   request. It is the documented workaround for a Next client hang from Server Actions
   (ADR 0014 amendment); the operator-facing risk is a browser closed between commit and follow-up.
4. **Origin handling.** The Server Action rejects a foreign `Origin` (framework). A request with no
   `Origin` header and a valid Super Admin session cookie is accepted (framework behaviour; browsers
   always send `Origin` on a cross-site POST, and the session cookie is `httpOnly; SameSite=Lax`).
   The revalidate route performs no Origin check, like its six sibling revalidate routes; it writes
   nothing and only expires caches. The upload route's stricter `sameOriginRefusal` is not applied to
   either. All three are LOW observations; none was exploited by anything the check could do from a
   browser identity.
5. The production build persists its ISR output on disk across restarts, so a page can hold a previous
   run's winner. The check refreshes through the product's own route before taking its baseline.

## Tests performed

- Brownlow integration suites on an isolated PG16 copy: 110/111 (the one failure is finding 3 above).
- Part 2 application check: 41/41 against the production build.
- `eslint` on the new tool: clean. `tsc --noEmit` for the repository: clean; the tool is `.mts`, which
  `tsconfig.json` does not include, so it was also type-checked through an ad-hoc project: clean.
- No application source changed; the full repository suite was not run.

## Still open after this record

- Owner review of the 12 eligibility disagreements and of the V2 report outcome (`discrepancies`).
- V2-GAP-023: stage the leaderboard and commit a provider-team mapping before the application view can
  show a reconciled leaderboard and club checks (the check shows both are derivable).
- Owner decision on the `match_id` backfill (finding 3).
- Everything in the release checklist that concerns the live database, the host, timers, the first
  authentic 2027 feed, ISSUE-316, and the signed approvals. **Production: NO-GO.**
