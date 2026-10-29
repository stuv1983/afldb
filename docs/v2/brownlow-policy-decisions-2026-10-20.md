# Brownlow owner policy decisions — 2026-10-20

Policy approvals only. No production/shared connection or operation is authorised. No execution
approval file or live plan digest is created by this record. 2026 is excluded.

## Reviewed content and decision identifiers

Reviewed branch: `v2/rebuild`; reviewed HEAD: `92aa541d91a9b2cfcb43ddda861f573801540ec8`.
SHA-256 below hashes the exact Git blob bytes at that revision, including the complete citations,
durable identities, verdicts and policy wording. Later status annotations do not amend those records.
Retrieve with `git show <reviewed HEAD>:docs/v2/<filename>`; hash the raw bytes without shell
encoding conversion. These are proposal-content hashes, **not execution-plan digests**.

| Decision | Approved scope | Reviewed file | SHA-256 |
|---|---|---|---|
| **D-V2-BROWNLOW-ELIGIBILITY-1** | `BP-2025-ELIGIBILITY-v1` (§4a) and all twelve named 2025 ineligible rulings (§2), preserving exact durable identities, season, verdicts and citations | `brownlow-eligibility-ruling-2026-10-20.md` | `5ddde8547751353877f56816770097756f1a9faa1bb5aa89a803098c7b20ed56` |
| **OD-BROWNLOW-OWNERSHIP-1** | Season 2025 only: adoption of 621 positive-vote rows / 207 sets as `afl_api` owned; preserve 8,901 legacy zero rows and original provenance | `brownlow-legacy-ownership-transition-2026-10-20.md` | `275cb0392798ad36b269e23cc5ba87201877d7729c48a74fcdaaa6b0bcbcbe8f` |
| **D-V2-BROWNLOW-MATCH-BACKFILL-1** | `match_id` backfill policy for 1984–2025 only; fresh counts, unique supported mappings and exact plan validation required; archived expectation 320,861, never an unconditional live count | `brownlow-round-vote-match-backfill-2026-10-20.md` | `28dfcd412dfa292083faabc43ea8ae15ee594244d0eea3ac60be4bf05d828451` |

The latter two decisions approve only the stated scopes, not every historic rehearsal or operational
step described in the hashed files. The eligibility decision records policy acceptance; it does not
insert production ledger decisions, select `stored_eligible_rank_one` globally, or implement tri-state
ingestion/storage/runtime. Current boolean defaults do not become evidence of eligibility.

## Owner instruction provenance (verbatim)

The following instruction was supplied by the owner in this task on 2026-10-20. It is retained as the
decision source; no signature, execution approval, production inspection or live facts are inferred.

> The owner approves the three Brownlow policies described in the preceding approval request.
>
> Use one agent. Record these decisions and complete the remaining isolated verification. Do not access production.
>
> Repository: D:\dev\afldbV2
> Branch: v2/rebuild
> Expected HEAD: 92aa541d91a9b2cfcb43ddda861f573801540ec8
>
> Verify actual state and preserve subsequent changes. Read AGENTS.md and the existing Brownlow approval package.
>
> ## Exact policy approvals
>
> 1. Approve BP-2025-ELIGIBILITY-v1 and the twelve named 2025 ineligible rulings in docs/v2/brownlow-eligibility-ruling-2026-10-20.md as reviewed at the expected HEAD.
>
> Preserve their exact durable identities, season, verdicts and citations. This approves the policy and proposed rulings; it does not record production decisions, select a global stored eligibility shortcut or implement new tri-state runtime behaviour.
>
> 2. Approve season-2025 ownership adoption of the 621 positive-vote rows across 207 vote sets. Preserve the 8,901 legacy zero-vote rows and original provenance.
>
> 3. Approve the match_id backfill policy for 1984–2025 only, subject to fresh counts, unique supported mappings and exact plan validation. The archived expectation is 320,861 rows, not an unconditional live row count.
>
> 2026 is excluded.
>
> These are policy approvals only. No production connection, migration, correction, staging, publication, deployment or timer operation is authorised.
>
> ## 1. Record the decisions
>
> Create explicit decision identifiers and preserve this instruction as provenance.
>
> Bind the approvals to the reviewed proposal content, preferably with hashes of the exact ruling and policy records.
>
> Update the existing approval package, gap records and release checklist so approved policy is clearly distinguished from pending execution.
>
> Do not create an execution-approval file or fabricate a live plan digest.
>
> ## 2. Verify migration 116
>
> The earlier accepted migration scope ends at 115. It does not automatically cover 116.
>
> Using the existing isolated Linux environment, prepare a disposable copy at schema 115.
>
> Before and after applying 116, verify:
>
> - Existing row content and public query results are unchanged.
> - Existing definitions and relationships are preserved except for explicit intended changes.
> - The receipt ledger, function, trigger and grants match the reviewed SQL.
> - Ordinary application/import/auth roles cannot mutate receipts.
> - Failure and transaction behaviour remain correct.
> - The migration behaves correctly on rerun through the normal migration runner.
>
> Record the exact schema and privilege delta. Do not alter the old archive-scoped acceptance or extend D-V2-BROWNLOW-ALT-1 to another migration scope.
>
> Retain populated receipt history. Do not invent a destructive rollback for the immutable ledger.
>
> ## 3. Verify the final correction package together
>
> Run the eight PostgreSQL correction cases together against a fresh dedicated isolated copy using the final code, rather than relying solely on separate earlier runs.
>
> Run the relevant focused unit tests, typecheck and changed-file lint.
>
> Verify that recording policy approval does not bypass any execution requirement:
>
> - Exact target identity.
> - Reviewed code revision.
> - Verified fresh backup and restored baseline.
> - Exact operation, season and source.
> - Exact ruling records or mapping plan.
> - Plan digest and expiry.
> - Separate owner execution approval.
>
> Use clearly labelled synthetic execution approvals in isolated tests only.
>
> Do not run the full repository suite, historical rebuild or application build unless a demonstrated change requires it.
>
> ## 4. Return the next concrete approval package
>
> Report:
>
> - HEAD and commits.
> - The three recorded policy decisions.
> - Migration 116 preservation and privilege results.
> - Combined PostgreSQL and unit-test results.
> - Any implementation gap between approved eligibility policy and current runtime.
> - The next operation requiring production authority, with exact scope and prerequisites.
> - Which fresh evidence is still needed before an execution approval can be requested.
>
> Do not ask for blanket production approval. Any future production apply must be tied to a fresh reviewed plan.
>
> Preserve worktrees, unrelated .codex/ state, recovery archives and sensitive evidence. Keep remotes empty. No subagents, new worktrees, production/shared access, pushes or deployments.
>
> Complete the isolated work and stop for review.

## Execution remains pending

See the [approval package](brownlow-production-approval-package-2026-10-20.md) for separate schema,
connection/backup and per-operation execution gates. Each operation needs a fresh exact target,
reviewed clean code revision, verified backup bytes and restored matching baseline, exact request
and ruling/mapping records, self-digested unexpired plan and separate owner execution approval.
Policy identifiers cannot satisfy the execution-approval structure. No production facts are asserted.

The eligibility runtime gap (V2-GAP-016) was, at the time of this record, unimplemented: boolean legacy storage/emission and the
existing explicit season-rule contract did not implement the approved three-state policy. **Update, same day:** the
three-state runtime is now implemented and isolated-verified in a separate change (new migration 117; no stored-rank
shortcut is selected); see the [implementation record](brownlow-eligibility-implementation-2026-10-20.md). Production rollout remains pending.
