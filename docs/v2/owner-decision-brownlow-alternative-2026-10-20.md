# Owner decision D-V2-BROWNLOW-ALT-1: scoped alternative Brownlow migration evidence

Provenance: owner instruction in this Claude Code session on 2026-10-20, repository
`D:\dev\afldbV2`, branch `v2/rebuild`. Expected and verified starting HEAD
`01fc21dffb84f16b26c38f4abc38bd553fef91db`; only untracked `.codex/` existed and remotes were empty.
The instruction approves the amendment proposed in
[the Linux rehearsal follow-up](linux-rehearsal-followup-2026-10-20.md). Decision identifier:
**D-V2-BROWNLOW-ALT-1**. It follows [D-V2-MIGRATION-SEPARATION](migration-acceptance-2026-10-20.md).

## Approval, verbatim

> Solely for the production archive with SHA-256:
>
> a583fc7d8d4376aa816253adf299a1325da7e65c994576b6b56bfa136ed11b04
>
> and the migration-only transition from baseline 110 through migrations 111–115, I accept this
> alternative Brownlow migration evidence:
>
> - Raw-vote and audit preservation.
> - Identical before/after stored-data reports across 98 historical seasons.
> - Passing Brownlow integration and unit/report checks.
>
> This approval does not establish authentic AFL API vote, identity or leaderboard reconciliation.
> It does not approve live ingestion, publication, production eligibility changes, deployment or
> production GO.

## What it does and does not do

- It lets the **migration compatibility** gate rest on the alternative above, for that archive and
  that transition only, in place of the unavailable staged Brownlow before/after comparator.
- The original staged comparator result stays **INCOMPLETE**. It is neither converted to PASS nor
  altered; the gate report carries it separately (`stagedBrownlowComparator`).
- The authentic Brownlow requirement is moved, not removed: **authentic API vote, identity and
  leaderboard reconciliation remains required for Brownlow operational/publication readiness**
  (see the [release requirements checklist](release-requirements-checklist-2026-10-20.md), item 1).
- It is bound to the archive SHA-256 and to 110 → 115. A different archive, baseline or migration
  scope is not covered and needs its own owner decision. It is not a statement about the live database.
- It waives nothing else. Failure precedence is unchanged: a lost row, changed relationship,
  coverage regression, unexplained public-output difference, or failed alternative evidence is FAIL.
- It does not touch GAP-029 (below).

## Retained evidence checked against the approval

Checked against the committed records only. The restricted evidence under
`/home/rehearsal/evidence/` was not re-read, and no rehearsal work was repeated.

| Approval element | Retained record | Match |
|---|---|---|
| Archive SHA-256 `a583fc7d…ed11b04` (29,779,665 bytes, restored once, unchanged) | [Linux rehearsal](linux-rehearsal-2026-10-20.md) inputs; the follow-up's proposed amendment carries the same full digest | exact |
| Baseline 110 → migrations 111–115 | Ledger 110 verified against the sidecar; runner showed exactly 111–115 pending and applied; 115 applied / 0 pending | exact |
| Raw-vote and audit preservation | Complete row, ID, NULL, relationship and definition preservation PASS with zero findings; six required projections PASS, including `brownlow_raw` and `audit_history` | exact |
| Identical before/after stored-data reports, 98 seasons | Complete reports share SHA-256 `fea86e5d…346db2`; all 98 outcomes `reconciled`, zero findings; stored-only, with `storedOnlyFallback` and `stored_eligible_rank_one` | exact |
| Passing Brownlow integration and unit/report checks | 35/35 integration; 159/159 reconciliation, eligibility and shadow-report unit checks | exact |
| Not claimed by the approval | Authentic API vote-set identity, API-versus-stored totals, leaderboard | The follow-up states the alternative does not exercise these |

The aggregate evidence digest `followup-evidence.sha256` is
`8193f5d40d1caf7ef6a9b53eeff9a04afcd360844234c1b400b66e0a9be6a52d` (retained outside Git).
The gate reads these claims from the machine-readable attestation
[`evidence/brownlow-migration-alternative-attestation.json`](evidence/brownlow-migration-alternative-attestation.json),
whose evidence references are the committed records above.

## Recalculated assessment (all applicable evidence)

The gate rule is applied to the retained component results. The Linux gate report file produced at
rehearsal time (`linux-release-gates-readable.json`, SHA-256 `ad2f3053…1290ec`, exit 2) is historical
and was **not** regenerated; this task entered no restricted environment.

| Result | Before this decision | Now |
|---|---|---|
| Backend functional | PASS (retained local evidence) | PASS, unchanged. Restored-copy settlement 73/73; authentic 217/217 match-identity correlation |
| Migration preservation and public compatibility | INCOMPLETE | **PASS, scoped to D-V2-BROWNLOW-ALT-1.** Preservation PASS; parity 4 pass / 1 incomplete (staged Brownlow) / 0 fail; coverage 650 cells, manifest 32 tables / 1,380 buckets, Coleman 46/46, six projections all PASS |
| Staged Brownlow before/after comparator | INCOMPLETE | **INCOMPLETE, unchanged** (zero authentic staged seasons) |
| Backend migration acceptance | INCOMPLETE | **PASS, scoped** to the archive and 110 → 115 |
| Authentic Brownlow operational reconciliation | not separately tracked | **OUTSTANDING** (required operational contract `authenticBrownlowReconciliation`) |
| Strict Gridley parity | FAIL: 149 | FAIL: 149, unchanged |
| Adjudication conformance | FAIL: 50 unapproved | FAIL: 50 unapproved, unchanged |
| Production operational acceptance | INCOMPLETE / NO-GO | INCOMPLETE / NO-GO, unchanged |

**Remaining migration blocker: none identified** in the applicable evidence for this archive and
transition. No data loss, coverage regression or unexplained query difference was found.
Limits that are not blockers but stay visible:

- Reversal of 111–114 was tested only with **empty V2 ledgers**; it discards V2 eligibility,
  proposal, decision and publication provenance. Recovery of populated ledgers is untested.
- The archive is a point-in-time copy (captured 2026-10-19, MVCC-consistent with writers active).
  It proves nothing about the current live database; a release needs its own freshness and
  baseline checks and, if the staged comparator is still unavailable, its own decision.
- A restore with `--no-privileges` omits the migration-014 staging DEFAULT privileges.

## GAP-029 and Gridley separation

GAP-029 remains **OPEN** as data-quality debt. Its **50 unapproved findings remain unapproved**:
**149 strict / 99 approved / 50 unapproved**, zero additional data matches. Exact Gridley parity is
reported separately and stays FAIL. This decision grants no Gridley adjudication.

## Code

`tools/v2/migration-preservation.ts` (`APPROVED_BROWNLOW_ALTERNATIVE`, `assessBrownlowAlternative`)
and `tools/v2/release-gates.ts` (`--brownlow-alternative`). The alternative applies only when the
attestation names this decision, archive and 110 → 115; the preservation snapshots are of this
archive and PASS; the other four parity checks PASS; the staged Brownlow check is INCOMPLETE; every
part has readable evidence; reports cover exactly 98 seasons and hash identically; and the
integration and unit checks all pass. Tests: `tests/v2-shadow-parity.test.ts`.
