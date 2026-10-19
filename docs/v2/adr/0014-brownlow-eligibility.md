# ADR 0014 — Brownlow: eligibility-aware medal determination and audited eligibility decisions

- Status: Accepted (owner decision); implemented (Launch F, stream F-D)
- Builds on: ADR 0007 (pure Brownlow reconciliation). Plan decision: `docs/v2/plan.md` §3 D7;
  open owner decision V2-GAP-016 (`docs/v2/known-gaps.md`)
- Plan and review: `documentation/plans/implementation/launchF-FD-awards-plan.md` §1 and §5 (F-001)

## Context

ADR 0007 deliberately stated no winner: with no recorded eligibility rule, any ineligible vote-getter
refused the leader determination (`refused_eligibility_rule_unrecorded`), and the stored table's
convention (`is_winner` means `eligible_rank = 1`, `src/lib/brownlow/entry.ts`) was selectable only
by the caller. That left the owner's question open (V2-GAP-016): when may V2 name a Brownlow Medal
winner, and what happens when a player's eligibility is not established?

## Decision (the owner's, verbatim)

> Implement an eligibility-aware model: Preserve the raw vote leaderboard for every player. Exclude
> a player from medal-winner determination only when authoritative stored eligibility evidence marks
> that player ineligible. If the vote leader's eligibility is missing or ambiguous, do not invent a
> medal winner. Mark the result `requires_review`. Permit an authorised administrator to resolve
> eligibility through an audited decision with a citation and note. Recompute the winner
> deterministically after the decision. Support ties among eligible leaders. Never alter raw votes
> to produce a winner.

## Authoritative eligibility evidence

Per (season, player), in precedence order:

1. **The CURRENT administrator decision** — the row of `brownlow_eligibility_decisions` (migration
   113) for the season and the player's durable identity that no later row supersedes. Verdict
   `eligible` or `ineligible`; source `admin_decision`. It overrides everything below, including a
   conflicting provider flag.
2. **Else the season's `brownlow_season_votes` row, but only as a RECORDED statement** (source
   `stored_season_votes`):
   - `is_ineligible = true` => ineligible;
   - `is_ineligible = false` => eligible **only** when the season is administrator-published
     (`brownlow_season_authority.published_revision IS NOT NULL`) **or** the row carries a non-NULL
     `eligible_rank`. `is_ineligible` is `NOT NULL DEFAULT false`, so a bare `false` is a column
     default, not a statement (plan-review F-001, HIGH, accepted). Without either corroboration it
     is *not recorded*.
3. **The AFL API staged flag** (`staging.afl_api_brownlow_vote.eligible`) is a provider **proposal**,
   never authoritative. It can make a status `ambiguous` (it disagrees with a recorded stored
   statement; or a player's own staged flags disagree; or the reconciliation reports
   `eligibility_flag_inconsistent` for the player), but it never decides one.

No decision and no recorded stored statement => `missing`, with the provider observation reported.
So each vote-getter has a status `eligible | ineligible | missing | ambiguous`, a source
(`admin_decision | stored_season_votes | none`) and the evidence detail behind it.

The determination reads this raw evidence. It never reads `report.rawVotes.playerTotals[].eligible`
for a status: that boolean folds the provider and stored flags together, so a provider flag could
otherwise decide (pinned by a unit test that flips it).

## Algorithm — `determineBrownlowMedal` (`packages/derived/src/brownlow-eligibility.ts`)

Pure: no I/O, no clock, no database. Input: the reconciliation report (default rule) for raw totals
and evidence gating, the season's administrator-published flag, and per-player raw evidence.

1. **Gating** (pass-through, in the reconciliation's own priority order): `refused_whole_set`
   (an unresolved player or match, or a malformed input), `season_incomplete`, `no_vote_evidence`,
   `refused_unreconciled_evidence` (any `discrepancy` finding other than the two eligibility-evidence
   findings below; the blocking findings are listed).
   - `eligibility_flag_inconsistent` is not a season-level refusal: it becomes that player's
     `ambiguous` status.
   - `stored_rank_inconsistent` on `eligible_rank` **where the stored rank is NULL** is likewise
     per-player: it reports that a non-ineligible stored row carries no eligible rank, which is
     exactly the *not recorded* gap above. Refusing the whole season for it would make the gap
     impossible to resolve. A stored rank that is *present but wrong* still refuses. (This narrows
     the plan's "any discrepancy" wording; the finding is still reported by the reconciliation.)
2. **Walk** the distinct vote totals in descending order. In the current group: if **any** player is
   `missing` or `ambiguous` => `requires_review` (the players are named, with reasons; no winner).
   Otherwise remove the known-`ineligible` players; if at least one `eligible` player remains, **all
   of them** are the joint winners (`determined`, `tie` when more than one — no tie-break exists);
   otherwise continue with the next group. An exhausted walk is `no_eligible_winner`.
3. **Output**: `rawLeaderboard` — every vote-getter, the votes exactly as the reconciliation reports
   them (never mutated, never dropped; ineligible players are listed with their status), competition
   `rank`, and each player's `eligibility` (status, source, detail and a one-sentence reason);
   `status`; `winners` (sorted by player id); `tie`; `excludedIneligible`; `playersRequiringReview`;
   `blockingFindings`; and `inputChecksum` (sha256 of the canonical input, independent of supplied
   order and of `generatedAt`; reuses `canonicalJson` of `@afldb/derived`).

Statuses: `refused_whole_set`, `season_incomplete`, `no_vote_evidence`,
`refused_unreconciled_evidence`, `requires_review`, `determined`, `no_eligible_winner`.

## The decision ledger and the write path

`brownlow_eligibility_decisions` (migration 113, append-only, ADR 0004 style):

| Column | Meaning |
|---|---|
| `season`, `player_identity` | the target, by the **durable identity** string `resolvePlayerIdentity` computes (`afltables:<profile path>` / `manual_admin_edit:<token>`); **no** foreign key into `players` or `seasons`, which a rebuild renumbers |
| `player_id_at_decision` | a snapshot of `players.id`, for the reader's convenience; not durable |
| `verdict`, `citation`, `note` | `eligible`/`ineligible`; citation trimmed 1..2000 (URL or reference); note trimmed 20..2000 |
| `decided_by`, `decided_at` | the actor (FK `auth_users`) and the time (database default) |
| `basis`, `correction` | `open_season` with `correction` NULL, or `audited_correction` with the season seal's audit record |
| `supersedes_id` | the decision it replaces; one linear chain per (season, identity) via four constraints |

Grants: `afldb_import` SELECT, INSERT and the sequence; `afldb_auth` SELECT; `afldb_app` nothing. No
role holds UPDATE, DELETE or TRUNCATE (pinned by `tests/integration/privileges.test.ts` and the
integration test below). The table is not in `afldb_meta.import_writable_tables`. A reversal is a new
row that supersedes the old; nothing is edited or removed.

`recordBrownlowEligibilityDecision` (`src/db/queries/brownlow-eligibility.ts`) is the only writer:

- capability `data.brownlow.finalise` (Super Admin only), checked **first**, before any SQL;
- shape refusals before SQL: `invalid_input` (verdict, season range, ids), `citation_required`,
  `note_invalid`;
- ONE transaction with `pg_advisory_xact_lock(hashtext('brownlow_eligibility_decisions'), season)`
  (the import role has no UPDATE, so `SELECT ... FOR UPDATE` is unavailable by design), then the
  refusals that need the database, all before the INSERT: `unknown_player`, `identity_missing`,
  `identity_ambiguous`, `player_not_vote_getter` (no stored total above zero and no staged API vote in
  the season), `stale_decision` (the caller's `expectedCurrentDecisionId` differs from the current
  row), and the season seal;
- **season seal**: an open season records `open_season` with a NULL correction; a sealed season
  passes `evaluateSeasonWrite` with the audited-correction workflow
  `brownlow_eligibility_decision` (added to `AUDITED_CORRECTION_WORKFLOWS` and pinned by the
  migration's CHECK), actor = the deciding user, the note, and the evidence reference
  `brownlow_eligibility:<season>:<identity>`, stored verbatim in `correction`;
- it **never** writes `brownlow_season_votes`, `brownlow_round_votes` or any staging table.

The operations-centre callers (`src/lib/admin/operations-centre.ts`) are
`determineBrownlowSeasonForAdmin` (read, `data.brownlow.read`) and `recordBrownlowEligibilityForAdmin`
(`data.brownlow.finalise`); the latter writes one `auth_audit_log` activity row per attempt
(`admin.brownlow_eligibility_decided` / `admin.brownlow_eligibility_refused`) and returns the
**recomputed** determination. The page is `/admin/operations/brownlow`: status in plain words, the
joint winners, the players requiring review with a decision form (Super Admin; an Admin sees the
evidence and history read-only) behind a D9 action card, the raw leaderboard with each player's
status and source, and a notice when the stored `is_winner` flags disagree with the determination.

Identity is resolved by reusing `resolvePlayerIdentity` through `nativeTransactionOf` inside an
executor transaction (not by copying its SQL), one player at a time. The cost is two cheap statements
per vote-getter on a read of a season's evidence; over a non-postgres.js executor (PGlite) the loader
and the writer refuse rather than guess.

## Publication amendment — local release follow-up, 2026-10-19

The authorised decision service now records the decision and projects medal/eligibility metadata
in ONE transaction. `publishBrownlowEligibilityInTransaction` also runs after existing manual
season publication and match corrections. All consumers continue to read the same canonical
`is_winner` result. `votes`, `vote_rank`, round votes and source/provenance columns never change.
Only `is_winner`, `is_ineligible` and `eligible_rank` are projected; the required `data_edits`
publication record preserves prior eligibility statements, decision IDs, checksum and actor/note.
Audit failure rolls back both the decision and the projection. Replaying an unchanged projection
creates no duplicate publication audit. The existing season-seal correction gates remain.

The stored season table contains authoritative season totals, not a replacement API leaderboard.
Where no API votes exist, medal determination can use those totals with recorded stored eligibility
or cited decisions; the diagnostic still reports missing API evidence and cannot claim API parity.
Missing/ambiguous relevant eligibility means `requires_review` and no published winner. Joint
eligible leaders are published together. The raw vote leaderboard remains visible, ineligible
players included. Historical read-only reconciliation found 98/98 seasons determined and agreeing,
zero unresolved/disagreeing (`evidence/local-brownlow-history-final.json`). This is local evidence,
not production parity. No Brownlow migration was needed: migration 113 and existing audit columns
already provide the contract. Migration 115 is an unrelated FK-index correction.

Integration coverage demonstrates public winner changes after authorised decisions, raw-content
fingerprint preservation, idempotent publication and rollback on required audit failure. The
browser revalidation endpoint is capability-guarded and accepts no caller-controlled paths.

## Historical Launch F limitations (superseded above where stated)

- **No write to `brownlow_season_votes`.** A decision is new evidence *beside* the raw votes. When the
  determination disagrees with the stored `is_winner` flags the page says so and changes nothing.
  Projecting a decision into the published table remains the existing `/admin/brownlow` publish
  workflow (`publishBrownlowSeason`, `brownlow_season_authority`) — **remaining work**, to be decided
  by the owner (it needs its own audited-correction path into sealed seasons).
- No change to the reconciliation's `eligibilityRule` (ADR 0007) or to the API leaderboard (still not
  staged, F-WB1-005). The default `unrecorded` rule is unchanged; this model supersedes it for
  naming a winner, not for reporting evidence.
- The plan-review F-001 *blast-radius* count (how many real historical seasons have a default-false
  row with a NULL `eligible_rank` and no administrator publication, i.e. would read `missing`) needs a
  historical database; the isolated template holds none. It is recorded for the main session's
  rebuilt-database run.

## Tests

- `tests/v2-brownlow-eligibility.test.ts` — the pure determination: missing leader (default-false
  stored row, NULL rank), ambiguous leader (provider flag disagrees; own flags disagree; reconciliation
  finding), a provider flag never deciding, ineligible leader excluded with the next group
  determined, an administrator decision overriding stored evidence either way, ties (and a tie with
  one player missing), all-ineligible, every gating pass-through, determinism under shuffling, the raw
  leaderboard byte-equal to the input totals (deep-frozen), the folded per-player boolean never read.
- `tests/integration/v2-brownlow-eligibility.test.ts` — real PostgreSQL (self-seeding): the ledger row
  content including the sealed-season correction record, the superseding chain and the stale refusal,
  every refusal writing no row, `requires_review` for a missing and an ambiguous leader (staged
  votes), the deterministic recompute after a decision, ties, administrator publication, an open-season
  decision, the raw votes unchanged (md5 of the vote tables), and the import role's INSERT-only grant.
- `tests/v2-admin-operations.test.ts` — the callers' capability refusals and audit rows, the Server
  Action's guard and parsing, the action card, the audit-action drift test.

## V2-GAP-016 disposition

Local implementation, publication and historical reconciliation are demonstrated. Keep the gap
narrowly open for owner release acceptance and production-dump reconciliation, not missing local
publication code. No historical flags were bulk rewritten during the read-only reconciliation.

## Deploy order

Apply migration 113 (and 114, which ships in the same stream), then run `npm run db:privileges`, then deploy
the code (AFLDB-ISSUE-027): the new caller fails closed until the table and its grants exist.
