# Brownlow policy follow-up: isolated verification — 2026-10-20

Entry and current HEAD: `92aa541d91a9b2cfcb43ddda861f573801540ec8`, branch `v2/rebuild`.
No commits were created. Existing commits: `92aa541d` records the earlier verification;
`92ccbf79` contains the correction runner; `36a36054` contains the proposal records.
The only entry untracked content was `.codex/`; it is preserved. Remotes remain empty.
One agent, no subagents or new worktrees. No production/shared access, push, deployment or timer action.

[Owner policy decisions](brownlow-policy-decisions-2026-10-20.md) bind all three approvals to exact
proposal bytes at that HEAD and retain the owner instruction verbatim. Approval is policy only;
execution remains pending. The old D-V2-BROWNLOW-ALT-1 record is unchanged and remains archive-bound
to migration 110–115. This independent **115 → 116 technical rehearsal** does not extend that acceptance.

## Isolation and tested source

Existing WSL distribution `AFLDB-V2-Rehearsal-20261020`, PostgreSQL 16.15, Node 22.21.0.
The existing PostgreSQL process is in a network namespace with **zero external routes**, listener
`127.0.0.1:55434`, cluster `afldb_v2_isolated`. The launcher independently checks listener ownership,
loopback DSN, marked database and server identity. Integration tests repeat those checks.

New plain source copy: `/home/rehearsal/brownlow-policy-20261020/` (not a worktree). All 1,421 tracked
runtime/tool/test/config files were compared byte-for-byte with the final repository files; their
SHA-256 manifest is retained. Dependencies reuse the existing Linux install; nothing was downloaded.
Graph tools were unavailable, so bounded source inspection was used.

All new databases were created from the preserved, marked `afldb_v2_rb_brownlow2025_test` template.
They and the old template, source copies, recovery archives and restricted evidence are retained.

## Migration 116: preservation and exact delta

Primary all-schema rehearsal: `afldb_v2_brownlow_m116all_test`, independently verified at **115**
before applying anything. Earlier narrower diagnostic copy: `afldb_v2_brownlow_m116_test`, retained.

- **PASS:** all 103 pre-existing data tables, **1,661,885 rows** (plus all 115 prior migration-ledger rows checked separately), across all non-system table schemas
  (`afldb_meta`, `public`, `staging`, `staging_aflw`). Counts and sorted all-column row fingerprints
  are identical before/after. Each row is hashed as PostgreSQL JSONB text; aggregate fingerprints
  use sorted row MD5s, with counts retained. This is fingerprint evidence, not a mathematical proof
  against hash collisions. All **68 sequences** retain their exact values.
- **PASS:** actual public `getBrownlowWinners`, `getBrownlowCareerLeaders`,
  `getMultipleBrownlowWinners` and `getSeasonRoundVotes` for **all 43 stored round-vote seasons**
  return identical results through the app connection. No vote, provenance, eligibility or winner
  correction is part of the migration test.
- **PASS:** every pre-existing schema dump section is byte-identical. Only pg_dump's random
  restrict/unrestrict token is normalized. Existing tables, views (including AFLW), columns,
  defaults, relationships, constraints, indexes, triggers, functions, ownership and ACLs are
  unchanged. Role attributes, memberships and default privileges are also identical.
- The normal runner reports **116 files / 115 applied**, applies only
  `116_brownlow_correction_receipts.sql` and records its matching canonical-LF SHA-256 checksum.
  All 115 prior ledger records remain identical. A rerun reports **116 applied, nothing to apply**;
  the complete post-migration snapshot and the populated receipt are unchanged.

Exact additive schema delta, owned by `afldb_owner`:

| Object | Exact change |
|---|---|
| `public.brownlow_correction_receipts` | Eight NOT NULL columns: `plan_digest`, `operation`, `code_revision`, `approval_reference`, `before_digest`, `after_digest` (text), `result` (jsonb), `applied_at` (timestamptz, default `clock_timestamp()`). Table comment matches reviewed SQL. |
| Constraints/index | Primary key/B-tree on `plan_digest`; four CHECKs: 64 lowercase hex plan digest, seven enumerated operations, 40 lowercase hex revision, approval reference length ≥20. No sequence, FK, existing column or relationship added/changed. |
| `public.refuse_brownlow_receipt_mutation()` | PL/pgSQL trigger function; raises `Brownlow correction receipts are append-only`; SECURITY INVOKER, matching reviewed body. |
| `brownlow_receipt_immutable` | Enabled BEFORE UPDATE/DELETE/TRUNCATE statement trigger on the new table; invokes that function, including for zero affected rows. |
| Table ACL | Owner only: `afldb_owner=arwdDxt/afldb_owner`. PUBLIC and `afldb_app`/`afldb_import`/`afldb_auth` have no table privileges after explicit revocation. No grants or memberships on existing objects change. |
| Function ACL | `proacl = NULL`: normal PostgreSQL default owner/PUBLIC EXECUTE, as in reviewed SQL. It is a trigger-only, non-definer function; this grants no receipt mutation capability. No EXECUTE revocation is invented. |
| Migration ledger | Exactly one new 116 record; the old 115 records remain intact. |

Failure/privilege verification:

- Injected division-by-zero **after the complete migration SQL** inside an outer transaction rolls
  back the table, function, trigger and privileges. A normal runner apply then succeeds.
- Synthetic receipt insertion followed by an outer error rolls back completely. A subsequent
  committed synthetic receipt is retained. Duplicate digest and invalid digest inserts refuse.
- Actual separate logins as app/import/auth each attempt INSERT, UPDATE, DELETE and TRUNCATE:
  **12/12 denied, SQLSTATE 42501**. Catalog checks also deny mutation, REFERENCES and TRIGGER rights.
- Owner UPDATE/DELETE/TRUNCATE attempts are rejected by the immutable trigger; receipt bytes remain
  unchanged. The rerun preserves the populated history. No destructive ledger rollback is proposed.

## Combined correction and focused validation

**PASS: all eight PostgreSQL cases together, one invocation, 0 failures / 0 skipped** on the fresh
`afldb_v2_brownlow_policy_final_test` copy. Duration **716.76 seconds**. Final code and assertions
were used throughout; no test filter was applied.

| Case | Result |
|---|---|
| Read-only planning, wrong target and pre-apply baseline drift | PASS |
| Backfill partial-failure rollback, apply/replay/reversal; votes/provenance preserved | PASS |
| 621 positives / 207 sets adopted, 8,901 legacy zeros retained, replay/reversal and later-write refusal | PASS |
| Premature issue resolution and ambiguous/unapproved eligibility refusal | PASS |
| Authentic 207-set observe-only transaction, injected failure rollback, commit/replay without canonical writes | PASS |
| Eligibility decisions/publication roll back together; synthetic-approved subset through audited service | PASS |
| Precisely named healed ownership issue, receipt-failure rollback, commit and replay | PASS |
| Fresh restored baseline/live identity, historical 2024 apply/replay/inverse and receipt immutability/privileges | PASS |

The final dedicated database retains **11 synthetic-test receipts**. A final read-only comparison
with the untouched template proves all **9,522 2026 round-vote rows** and 2026 season-vote rows
hash-identical. All **8,901 2025 zero-vote rows**, including original provenance, are identical after
excluding only the policy-permitted `match_id` field. The deliberately mutated correction clone is
not migration-preservation evidence; that comparison used separate fresh copies above.

**Focused units: 98/98, 0 failures / 0 skipped**, in the four suites
`v2-brownlow-production-correction`, `v2-brownlow-round-vote-match-backfill`,
`v2-brownlow-legacy-ownership-adoption` and `v2-brownlow-eligibility`.
Final Linux `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **PASS**.
ESLint on both changed TypeScript test files with `--max-warnings=0`: **PASS, zero warnings**.
`git diff --check`: **PASS**. No full repository suite, historical rebuild or application build ran.

An earlier combined invocation on `afldb_v2_brownlow_policy_test` finished **7 passed / 1 failed**:
the observation test could not find `data/reference/source-families.json` because the supplied
acquisition-only root lacked the registry files. It failed before that case's database work.
Its database and reports are retained. A complete new fixture root combines copied final reference
files with a read-only link to the retained acquisitions; loader/manifest checks were verified
before the successful fresh eight-case run. Supporting preflight harness field/count mistakes and
their logs are retained too. No runtime fix or weakened assertion was used to obtain the final PASS.

## Execution-gate review after policy recording

The status documents are not execution inputs. No runtime or migration SQL changed in this task.
The new focused unit case supplies each policy identifier without an execution envelope and proves
refusal. The unchanged CLI/service still enforce these independent requirements:

| Requirement | Evidence in final source and focused checks |
|---|---|
| Exact target identity | `checkCorrectionTransport` pins DSN host/port/database/role before connection, rejects query overrides; `proveCorrectionTarget` rechecks system ID/OID/cluster/comment in the transaction. Wrong transport/identity cases refuse. |
| Reviewed revision | CLI reads full HEAD and refuses tracked/staged changes; `checkCorrectionApproval` requires plan/approval/current revision equality. Changed-revision unit case refuses. |
| Fresh verified backup and restore | CLI rehashes actual backup and restore-evidence bytes at plan/apply; `checkBackup` pins target and ≤24-hour timestamps; restored baseline must equal fresh target/plan baseline. Stale and mismatched baseline cases refuse. No synthetic attestation is represented as production restore proof. |
| Exact operation/season/source | Approval equality is checked independently of policy; non-backfill operations are 2025-only, all requests exclude 2026. Changed fields refuse. |
| Exact ruling/mapping content | Eligibility requires the exact complete ruling array (including citation/note/supersedes); current durable identities are re-resolved. Backfill parses the digested export, verifies unique supported mappings and re-derives the exact payload while locked. Tamper/drift cases refuse. |
| Plan digest and expiry | Self-digested plan, exact approved digest, fresh creation/approval times and unexpired approval no later than plan expiry. Altered/stale cases refuse. |
| Separate owner execution approval | CLI `apply` requires its explicit external approval file; no policy-file or identifier fallback exists. Service `checkCorrectionApproval` runs before writes. All approvals in the isolated integration cases are labelled **SYNTHETIC**, in memory only. |

Source: `tools/v2/brownlow-production-correction.ts` and
`src/db/queries/brownlow-production-correction.ts`. The final no-argument CLI invocation exited **1**
with refusal before connection. The combined PostgreSQL cases test the guarded service functions;
they do not claim a new end-to-end production CLI apply or any live backup verification.

## Next concrete authority package (pending, no request to execute)

The next production-dependent step is **evidence acquisition**, requiring a separate owner decision
identifying the exact live host/database/role and allowing only read-only identity/schema/baseline
inspection plus an explicitly scoped backup and isolated restore verification. No such authority or
target identity exists in this task; no placeholder is represented as an independently proved target.

Fresh evidence still needed before any correction execution approval can be requested:

1. Independently proved host, port, database, operator role, cluster/system identifier, database OID
   and comment; actual current migration ledger and role privileges. Do not assume production is
   at 115 (the earlier release checklist expects 110 and requires review of any different state).
2. Separately reviewed schema/deployment approval for the exact migration set/revision and target,
   explicitly including 116 when appropriate. This isolated technical PASS grants no installation
   authority and does not inherit D-V2-BROWNLOW-ALT-1.
3. Fresh target-bound verified backup bytes, capture/restore timestamps, restore-evidence bytes and
   their hashes; matching restored/live Brownlow baseline and fresh schema-preservation/privilege
   evidence. Synthetic test attestations provide none of this production evidence.
4. Clean reviewed execution revision. Current changes are uncommitted and the CLI refuses tracked
   changes. Re-review/record the actual final execution revision; do not substitute the starting HEAD.
5. Exact next request: after schema prerequisites, **`observe`, `[2025]`, `afl_api`**, pinned to the
   retained `afl-api-brownlow-2025-2026-10-20-014218` manifest/checksums and 207-set/188-player identity
   contract. This is an observation/staging write and needs its own fresh plan and execution approval.
   It does not publish votes or enable a timer/canonical writer.
6. For each subsequent operation, regenerate evidence after prior commits. Backfill must enumerate
   every season 1984–2025, validate fresh counts/unique supported mappings/zero exclusions and review
   the exact mapping export; 320,861 is only the archived expectation. Adoption must freshly prove
   621 positives / 207 sets / 8,901 preserved zeros and original provenance. Eligibility must re-resolve
   the twelve durable identities to current numeric IDs, exact citations/verdicts/notes/current
   supersedes IDs and active Super Admin; full records must appear in the plan and approval.
7. A self-digested unexpired operation plan and **separate owner execution approval** naming that
   digest, exact target, revision, operation, season list, source, expiry and exact rulings where
   applicable. No live plan digest or execution-approval file has been created here.

Sequence matters: the first live write would be a separately approved **schema installation**, with
its own pre-install backup/restore and exact reviewed migration set. If the target is still at 110,
the correction baseline command's 111–115 tables cannot be assumed to exist. Review that actual
schema path first. After the approved schema is installed, acquire a fresh post-schema backup and
matching restored/live correction baseline before planning `observe`. An earlier schema-110 backup
or the current isolated schema-115 template is not silently substituted for that correction baseline.

V2-GAP-016/030/031 remain open for implementation and/or separately approved execution. (Update: the V2-GAP-016 runtime was later
implemented and isolated-verified in a separate change with new migration 117; see the
[implementation record](brownlow-eligibility-implementation-2026-10-20.md). Production rollout remains pending.) The approved
eligibility policy's unknown semantics, provider evidence precedence and authoritative ranking
refusal are not fully implemented by legacy boolean storage/emission or the explicit existing
season-rule contract. This task changes no runtime code, selects no global stored-rank shortcut and
does not declare Brownlow operationally ready or production GO.

## Evidence and changed files

Restricted evidence root: `/home/rehearsal/evidence/brownlow-policy-20261020/` in the named WSL distro.
The verifier source is retained in the new plain source copy. Relevant files: `final-tested-source-sha256.json`,
`before-schema.sql`, `after-schema.sql`, `schema-delta.diff`, `schema-comparison.json`,
`m116-all/{before,after}.json`, `m116-all/receipt-contract.json`, all apply/rerun logs, and focused
test/typecheck/lint logs/reports. The first harness syntax failure occurred before database work;
its log is retained, followed by successful corrected checks. The initial public/meta-only row
snapshot was expanded on another fresh copy to every non-system table schema; no evidence was erased.

Final reports: `final-combined.json`, `final-unit.json`, `final-typecheck.log`, `final-lint.log`,
`final-retained-state.json`, `template-retained-state.json`, `validation-summary.json` and
`harness-source-sha256.json`. The restricted `evidence-manifest.sha256.json` has SHA-256
`b80b1de7d197296340f7c3d34587e16ee0a3d02a012d4d56a70d138bff20b941`.

Repository files changed by this task:

- `CHANGELOG.md`
- `docs/v2/brownlow-policy-decisions-2026-10-20.md` (new)
- `docs/v2/brownlow-isolated-verification-2026-10-20.md` (new)
- `docs/v2/brownlow-eligibility-ruling-2026-10-20.md`
- `docs/v2/brownlow-legacy-ownership-transition-2026-10-20.md`
- `docs/v2/brownlow-round-vote-match-backfill-2026-10-20.md`
- `docs/v2/brownlow-production-approval-package-2026-10-20.md`
- `docs/v2/known-gaps.md`
- `docs/v2/release-requirements-checklist-2026-10-20.md`
- `tests/integration/v2-brownlow-production-correction.test.ts` (pin the fresh dedicated database)
- `tests/v2-brownlow-production-correction.test.ts` (policy-only authority refusal)

No new application defect or issue was established. `IssuesIndex.md`, `issues.md` and its Open Issues
table keep their existing issue counts; V2 gap and checklist state is updated in place.
