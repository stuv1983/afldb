# Brownlow correction package for owner review — 2026-10-20

**Current owner-policy status, 2026-10-20:** [three content-bound decisions](brownlow-policy-decisions-2026-10-20.md) are approved at reviewed HEAD `92aa541d91a9b2cfcb43ddda861f573801540ec8`: D-V2-BROWNLOW-ELIGIBILITY-1 (BP-2025-ELIGIBILITY-v1 and all twelve exact rulings), OD-BROWNLOW-OWNERSHIP-1 (2025 only, 621 positives / 207 sets; preserve 8,901 zeros and original provenance), and D-V2-BROWNLOW-MATCH-BACKFILL-1 (1984–2025 only, fresh unique mappings/counts and exact plan). The archived 320,861 is an expectation. **Execution is pending for every operation; 2026 remains excluded.** No production connection, schema installation, correction, staging, publication, deployment or timer authority follows. The earlier verification/manifest below is historical; the current combined verification is recorded separately below.

**NO production execution is approved or performed. One agent; local changes and dedicated isolated
copies only.** Entry branch/HEAD verified: `v2/rebuild`, `36a36054818fa0545d81d9eb357cd50b3299c0f0`.
Existing untracked `.codex/`, recovery archives, worktrees, databases and empty remotes were preserved.
The new database copies and restricted evidence are retained, not cleaned up.

## Approval table

Policy approval and execution approval are different decisions. A policy approval does not authorise
a database connection, migration, correction, staging run, publication, deployment or timer change.
All counts below are expectations from preserved archive evidence, not a fresh live census.

Execution approval **E** means: exact fresh plan digest, target identity, season list, source, full
code revision, expiry, written owner reference and (for eligibility) every exact ruling record. The
common gates are verified backup/restore bytes, matching fresh baseline, migration 116 and locks.

| Exact operation | Season / records | Evidence | Expected writes | Preconditions | Reversal and limits | Exact approval required |
|---|---|---|---|---|---|---|---|
| Policy `BP-2025-ELIGIBILITY-v1` (**approved**, D-V2-BROWNLOW-ELIGIBILITY-1) | API-era policy; twelve exact 2025 rulings approved | [Final ruling table](brownlow-eligibility-ruling-2026-10-20.md) | None | Review final sanctions and unknown semantics | Amend policy; no data changed | Policy version plus accepted/deferred rulings; **not E** |
| Install migration 116 | New receipt ledger | Reviewed SQL and isolated schema checks | Table, function, immutable trigger; no statistics | Separate migration/deployment review, backup, role review | Retain populated ledger; no destructive down migration | Separate schema/deployment approval for revision and target |
| `observe` | 2025: 207 sets, 188 players | [Authentic snapshot](brownlow-authentic-reconciliation-2026-10-20.md), manifest rehash | Spine, typed staging, batch, receipt; no canonical writes | Common gates; exact snapshot/booleans/identities | Retain observations; supersede, never erase history | **E** for `observe`, `[2025]`, `afl_api` |
| `backfill` | 1984?2025: expected 320,861 NULL rows | [094-rule rehearsal](brownlow-round-vote-match-backfill-2026-10-20.md) | Reviewed `match_id` mappings and receipt only | Common gates; zero exclusions, exact per-season export | New `reverse-backfill` E; original export/receipt; refuse subsequent drift | D-V2-BROWNLOW-MATCH-BACKFILL-1 (**policy approved**) **plus E** with explicit 1984–2025 season list, `legacy` |
| `adopt` | 2025: 621 positives / 207 sets; preserve 8,901 zeros | [Value/identity agreement](brownlow-legacy-ownership-transition-2026-10-20.md) | 621 provenance changes, 621 audit rows, batch, receipt | Common gates; 207 adoptable, no refusals; legacy provenance retained | New `reverse-adopt` E before later writes; API writes block reversal | OD-BROWNLOW-OWNERSHIP-1 (**policy approved**) **plus separate E**, `[2025]`, `afl_api` |
| `eligibility` | Approved subset of twelve 2025 proposals | Final citations and stable identity/service checks | Decision rows, audited metadata/career publication, receipt; raw votes unchanged | Common gates; active Super Admin; exact records/current IDs; sealed season | New audited superseding decisions; no deletion of history | Individual ruling approval **plus E** enumerating every record |
| `resolve` | Exact named 2025 ownership-issue IDs only | Current 621 values/match IDs equal; 207 sets owned | Named resolution fields and receipt | Common gates; adoption/backfill done; reason/source/head match | Separately reviewed reopening; no automatic inverse | **E** for exact issue list and resolution, `[2025]`, `afl_api` |


**2026 is excluded from every correction and ownership decision in this package.** Its 9,522
`afltables`-owned vote rows are fingerprint-protected. The older all-season backfill rehearsal is
reused as algorithm evidence; this production proposal deliberately narrows its scope to 1984–2025.
No 2026 source transfer, canonical settle or completed-season writer bypass is included.

## Execution contract and entry point

New entry point: `tools/v2/brownlow-production-correction.ts`; shared guarded service:
`src/db/queries/brownlow-production-correction.ts`. The two existing isolated-only CLIs and their
target restrictions are unchanged. Planning and transactional apply/inverse functions are reused.
The only existing CLI change exports its already checksum-verifying snapshot loader for reuse;
its seal, completed-season restriction and command-line guards remain unchanged.

No arguments means refusal before connection. `baseline` and `plan` are read-only. No `.env` is loaded. No shared `DATABASE_URL` is used.
The only DSN input is the explicit secret `AFLDB_BROWNLOW_CORRECTION_DSN`, supplied by a future authorised
operator. Do not put the secret in command history, a document, a plan or Git. Output, target, backup,
restore evidence, plan and approval files must be outside the checkout; files are created exclusively.

The runner reads this checkout's full Git HEAD and refuses tracked/staged changes. Approval is pinned
to that **execution revision**, not this starting HEAD or an earlier proposal. Use a clean reviewed
checkout under normal owner control; unrelated untracked `.codex/` is neither read nor changed.
The plan and approval are ordinary restricted operator files, not digital signatures: their creation
requires the owner's explicit execution decision. A writable approval file is not proof that the owner
approved it. Keep that decision reference with the operator's access-controlled evidence.

`target.json` must contain the independently established fresh target facts:

```json
{"host":"<explicit host>","port":5432,"database":"<exact database>","user":"<operator role>",
 "systemIdentifier":"<pg_control_system system identifier>","databaseOid":"<database oid>",
 "clusterName":"<non-empty cluster_name>","databaseComment":null}
```

Before connecting the runner compares host, port, database and role to the DSN and rejects query-string
connection overrides. Inside the locked transaction it re-reads database name, role, system identifier,
database OID, cluster name and comment. Missing/ambiguous facts refuse. Access to `pg_control_system()`
must be provisioned and reviewed separately if the operator lacks it; do not grant app roles elevated
rights to make a correction work. No such privilege was changed on a shared target here.

`backup.json` is a target-bound attestation with `sha256`, `capturedAt`, `restoredAt`,
`restoreEvidenceSha256`, `baselineDigest` and `target`. The backup and restore evidence bytes are
rehashed from `--backup-file` and `--restore-evidence` at both plan and apply time. Timestamps must be
within 24 hours, restore after capture, and the restored-copy baseline digest must equal the fresh
target baseline captured in the plan. A mismatch requires a new backup/rehearsal/review.

Use `baseline --target <outside>/target.json --out <outside>/baseline.json` with the same entry point
and explicit DSN to capture the digest, read-only. Run it on the future authorised target and on the
verified restored copy using each one's independently proved target file. Compare `baselineDigest`;
retain both reports and restore verification in the hashed restore evidence file. A baseline command
needs no backup or apply approval because it writes no database data; it still needs the owner's
separate authorisation to connect to the named live target. No such live connection is made here.

The baseline hashes counts and all row values of the closed list of planning inputs, vote/publication,
identity, staging, audit, issue, actor, settings and migration-ledger tables in the service. It is a
targeted Brownlow baseline, not a substitute for database-wide migration preservation or schema
verification. Planning uses one repeatable-read, read-only transaction. Apply obtains the settle gate,
Brownlow admin lock and table locks, re-proves identity, then compares the exact baseline and re-derived
payload. Unexpected counts, values, identities, ownership or source versions refuse the whole operation.

The receipt commits in the **same outer transaction** as correction writes. Partial failures,
postcondition failures, service refusals or receipt failures roll everything back. Replay writes no
second batch/receipt and is accepted only while the exact recorded post-state remains present and
the approval remains fresh. A later change refuses replay, rather than guessing whether it is harmless.
This conservative baseline intentionally also refuses unrelated changes to a covered table. Review a
new plan; never suppress the check. PostgreSQL sequences may advance on rolled-back inserts; row/audit
rollback does not promise gap-free IDs.

Each operation has its own plan and approval; regenerate evidence after each committed operation.
Do not submit a multi-operation live batch using a single stale pre-operation baseline.

Example request files (placeholders are deliberately **not** executable production authority):

```json
{"operation":"adopt","seasons":[2025]}
```

For `backfill`, name every season 1984 through 2025 explicitly. For `eligibility`, include `actorId` and
`rulings`: records with `playerId`, durable `identity`, `verdict`, full `citation`, `note` and
`expectedCurrentDecisionId`. For `observe`, the entry point constructs the observation from the pinned
snapshot, requiring 207 sets and 188 leaderboard entries, literal boolean provider eligibility, and a
2025 manifest. For `resolve`, include exact `issueIds` and a factual `resolution`. For reversal, use
`reverse-backfill` or `reverse-adopt` and `reversal: {originalPlanDigest, export}` with the original
reviewed inner export; the original receipt and unchanged post-state must exist.

```text
node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts plan
  --target <outside>/target.json --request <outside>/request.json --backup <outside>/backup.json
  --backup-file <outside>/verified-backup.dump --restore-evidence <outside>/restore-report.json
  --out <outside>/plan.json

node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts apply
  --plan <outside>/plan.json --approval <outside>/execution-approval.json
  --backup-file <outside>/verified-backup.dump --restore-evidence <outside>/restore-report.json
  --out <outside>/result.json
```

Join the lines for the operator's shell. `observe` also requires `--snapshot-label
afl-api-brownlow-2025-2026-10-20-014218` in both commands. The snapshot must already exist under the
reviewed checkout's acquisition directory; these commands never acquire it or contact a provider.
Observation commits only observation/staging history, never activates a canonical writer or timer.

`execution-approval.json` fields: `planDigest`, exact `target`, full `revision`, exact `operation`, exact
`seasons`, `source` (`legacy` for backfill/inverse, `afl_api` otherwise), `approvedAt`, `expiresAt`
(no later than the plan's expiry), and a written `reference` of at least 20 characters. For eligibility
it must also contain the exact full `rulings` array. Changed, omitted, stale or extra ruling content
refuses. Plan content is self-digested; it cannot be edited after owner review.

If result-file writing fails after commit, the receipt remains authoritative; do not assume no writes.
Inspect the restricted receipt with the approved target arrangement. A fresh approved replay can recover
the result only if its full post-state is unchanged. This is not a recovery bypass.

## Existing evidence and acceptance limits

Reuse [the accepted archive-bound alternative](owner-decision-brownlow-alternative-2026-10-20.md)
only for the old archive's migration-preservation claim. It neither accepts this new live baseline nor
authorises a production connection or correction. Eligibility publication, ownership adoption and
match-ID changes deliberately alter selected fields, so future before/after evidence must itemise and
approve those deltas. No whole-season reconciliation or operational-readiness acceptance follows from
closing selected ownership issues; the eligibility rulings and season policy are now policy-approved, with production recording, runtime implementation and operational acceptance still pending.

## Current isolated follow-up

**Final isolated follow-up: migration 116 preservation/privilege/rerun PASS; eight PostgreSQL cases passed together; 98/98 focused units; typecheck and changed-file lint PASS.** [Migration 116 preservation, combined verification and the next exact authority package](brownlow-isolated-verification-2026-10-20.md) record the new isolated work. Policy approval is not an execution-approval envelope; exact target identity, reviewed revision, verified backup/restored baseline, exact operation/season/source, ruling records or mapping plan, digest/expiry and separate owner execution approval remain mandatory.

## Earlier local verification (historical separate runs)

Verified locally on 2026-10-20:

- **97/97 focused unit tests**, four existing/new Brownlow suites: production approval boundary,
  round-vote match backfill, legacy ownership adoption and eligibility. Includes wrong transport,
  missing approval, changed digest/revision/source/season, stale backup/plan and exact ruling approval.
- **Seven PostgreSQL integration cases passed** on the newly created, marked
  `afldb_v2_brownlow_package2_test`, a dedicated copy of the existing authentic-2025 rehearsal database.
  Backfill and adoption were applied, replayed and reversed; injected write failures rolled back;
  621 positives/207 sets and 8,901 legacy zeros were checked; a subsequent provenance write blocked
  ownership reversal; authentic observe-only staging rolled back on injected failure and then
  committed/replayed without canonical changes; two synthetic-approved eligibility decisions and
  publication rolled back together on failure, then committed through the audited service; a genuinely
  healed, precisely named synthetic ownership issue resolved with its receipt, rolled back on receipt
  failure, then replayed without writes. These clone-only decisions are not owner production rulings.
- **One additional focused PostgreSQL case passed** after the final restored-baseline gate was added:
  stale/mismatched restored baseline and wrong live system identity refused; historical 2024
  apply/replay/inverse preserved votes and provenance; ordinary app/import/auth roles could not mutate
  receipts, and UPDATE/DELETE/TRUNCATE were rejected by the immutable-ledger trigger. The other seven
  cases were filtered out for this last run, not disabled or removed. Eight distinct integration cases
  passed across the focused runs; no whole-suite pass is claimed.
- Final identity review additionally re-resolved **188/188 staged players** through the durable
  identity service in a read-only, 207-set adoption plan. A focused observe-only rerun used the CLI's
  fixture-identity fallback and asserted **207 planned, zero refused**, with failure rollback and
  replay again passing. The earlier fixture omitted that fallback and recorded observations while
  refusing unknown match identities; it did not establish this stronger observation contract. The
  final CLI refuses that incomplete result instead of accepting the run. The final role-revoke block
  of migration 116 also executed successfully only on a dedicated isolated copy.
- All **12/12 durable identities** matched through `resolvePlayerIdentity`, read-only on the first
  dedicated clone. Every original AFL article and the outcome follow-ups in the final ruling table
  was read directly. The graph connector was unavailable, so bounded source inspection was used.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **PASS**. Changed-file ESLint:
  **PASS, zero warnings**. `git diff --check`: **PASS**. No build or full suite was run.
- No-argument CLI invocation: exit **1**, refusal before a database connection. An initial sandboxed
  Windows `tsx` launch hit `uv_os_get_passwd`/ENOMEM before loading the runner; the normal local
  environment then produced the expected refusal. This was an environment launch limit, not a bypass.
- The actual committed CLI at `92ccbf790d01e95e79f9022a3a3d6805ae51daa1` also passed `baseline` and
  `plan` end to end against the verified dedicated isolated copy, from the real checkout. The 2023
  backfill plan named that exact revision and created only restricted output files; **no apply** was
  invoked. Synthetic, clearly labelled backup/restore evidence tested file hashing and matching
  baseline handling. Log: `committed-cli.log`; artifacts under the adjacent `committed-cli-*` directory.
  Those test files and that isolated plan digest are not production execution authority. The final
  documentation-only commit records these results; runner code is unchanged from this checked revision.

The first integration attempt caught a fixture timestamp round-trip losing PostgreSQL microseconds;
the unchanged baseline guard refused it correctly. The fixture now reverses its synthetic timestamp
delta in SQL. That first database and log are retained. A second fresh clone was used for the corrected
run; no prior database, evidence or cache was removed.

Restricted evidence: WSL distribution `AFLDB-V2-Rehearsal-20261020`,
`/home/rehearsal/evidence/brownlow-package/` (`integration-first.log`, `integration-second.log`,
`integration-fresh-baseline.log`, `identity-plan.log`, `observe-resolved-identities.log`). Source rehearsal copy: `/home/rehearsal/brownlow-package/` (plain
source copy, **not** a worktree); existing source snapshots and recovery archives were preserved.
Synthetic backup/restore attestations used in tests exercise validation, not real production
restorability. Actual verified fresh backup/restore bytes and matching baseline are still execution
preconditions. No production/shared connection, SSH, deployment, timer change or push occurred.

Tracking: V2-GAP-016, V2-GAP-030 and V2-GAP-031 remain open for runtime implementation and separately approved execution; the existing
proposals and `known-gaps.md` are updated and the change is recorded under `CHANGELOG.md` Unreleased.
No new reproducible application defect was found; the authoritative issue ledger, Open Issues table
and `IssuesIndex.md` retain their existing issue counts. The final commit/HEAD is returned with the
package; future execution approvals must name that reviewed execution revision explicitly.

## Earlier task changed-file manifest (historical)

These are the only repository files changed by this task:

- `CHANGELOG.md`
- `docs/v2/brownlow-eligibility-ruling-2026-10-20.md`
- `docs/v2/brownlow-legacy-ownership-transition-2026-10-20.md`
- `docs/v2/brownlow-round-vote-match-backfill-2026-10-20.md`
- `docs/v2/brownlow-production-approval-package-2026-10-20.md`
- `docs/v2/known-gaps.md`
- `src/db/migrations/116_brownlow_correction_receipts.sql`
- `src/db/queries/brownlow-production-correction.ts`
- `tests/integration/v2-brownlow-production-correction.test.ts`
- `tests/v2-brownlow-production-correction.test.ts`
- `tools/current-season/settle-afl-api-brownlow.ts`
- `tools/v2/brownlow-production-correction.ts`
