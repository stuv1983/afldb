# Owner decision: migration acceptance and production shadow package

**Subsequent execution:** [isolated Linux rehearsal, 2026-10-20](linux-rehearsal-2026-10-20.md).
The approved archive restored successfully, ledger 110 → 115, complete preservation PASS;
original staged Brownlow comparison remains INCOMPLETE. Backend acceptance is not yet met.
The backup-unavailable and not-executed statements below are retained preparation-time history.

Decision **D-V2-MIGRATION-SEPARATION**, owner instruction 2026-10-20, starting branch
`v2/rebuild`, HEAD `12abe77f7f7b65f83b9adb079460ca9392d98cc8`. Actual starting state matched;
only untracked `.codex/` existed. No other checkout, worktree or remote was changed.

The owner approves separate acceptance criteria for backend migration and exact
Gridley/reference-data parity. GAP-029 remains OPEN as data quality debt. Its **50 unapproved
findings remain unapproved**. Strict assertions and existing bounded adjudications are retained:
**149 strict findings, 99 approved, 50 unapproved; zero additional data matches**.

GAP-029 ceases being an automatic backend-migration blocker only when evidence proves:

- Existing records, stable identifiers and relationships are preserved.
- Existing event, registration and participation coverage does not decrease.
- Existing public query results remain equivalent except for specifically approved corrections.
- New ingestion and publication paths meet their functional contracts.
- Permissions, auditing and rollback work.
- Every changed result is explained and supported. A newly introduced discrepancy blocks migration.

This decision grants no production deployment authority, data-preservation waiver, new missing
data acceptance or additional Gridley adjudication. No production-row correction is authorised
by it. No changed result is currently approved for the migration-only phase.

## Separate results

`tools/v2/release-gates.ts` composes the existing five-check shadow parity report with the new
preservation snapshots and separately attested functional/operational evidence. Existing
comparison rules remain intact. Missing, invalid or unlike evidence is INCOMPLETE, never PASS.
Each attested contract must name nonempty readable evidence files as `exact/path: description`;
the CLI refuses a PASS backed only by missing references. Reviewers must judge their actual
scope and outcomes; these attestations do not turn local evidence into production evidence.
Failure has precedence over incomplete evidence. Exit codes describe **backend acceptance**:
0 PASS, 1 FAIL, 2 INCOMPLETE, 3 usage/write error. Production remains a separate NO-GO decision.
The Gridley counts in this report are explicitly retained evidence at the starting HEAD,
not a claim that a new Gridley run occurred.

| Gate | Current result | Evidence/limit |
|---|---|---|
| Backend functional verification | PASS, retained local evidence | `migration-functional-evidence.json`; isolated PG16 ingestion, publication, permissions, audit and rollback contracts; Linux operational acceptance remains separate |
| Migration preservation and public compatibility | **INCOMPLETE** | No approved production archive or production before/after captures |
| Strict Gridley parity | **FAIL: 149** | Existing strict results unchanged |
| Approved adjudication conformance | **FAIL: 50 unapproved** | 99 approved; all 50 remain unapproved |
| Production operational acceptance | **INCOMPLETE / NO-GO** | Production compatibility, Linux, host backup/restore/rollback, legacy-writer retirement, ISSUE-316 sequencing and explicit release approval outstanding |

The full workflow remains **13,740 passed / 9 failed / 31 skipped**, not green. No full suite,
historical rebuild, Gridley investigation or visual capture was repeated for this package.

## Preservation contract

`shadow-capture.ts preservation` captures all base tables in public, staging, staging_aflw,
aflw and afldb_meta. Every row, including every stable ID, FK value, NULL, label, registration,
participation fact, raw Brownlow vote, publication citation and audit value is hashed as
PostgreSQL JSONB text using SHA-256. Duplicate multiplicity is retained. Column types,
nullability, defaults and constraints (including FK definitions and validation states) are
hashed too. RLS, unreadable data, missing schemas or required tables, invalid query contracts
and target/isolation errors refuse the capture; no partial output is written. Transaction is
read-only repeatable-read, UTC/ISO, always rolled back. Hash files are sensitive evidence:
keep mode 600 in a restricted directory; they contain no raw rows or credentials.

Before and after must identify the same immutable archive SHA-256, query-contract SHA-256,
seal and migration-only phase. Capture both on the same PostgreSQL version, roles and
settings with writers stopped. Do not compare a rebuild against a production restore, move
the seal, mix independent backups or run settle/publication between these captures.

Every existing row must remain byte-equivalent as JSONB content, even in an open season or
an existing V2 table; every existing definition/relationship must remain equivalent. New rows
may be additive, but required query outputs must still match. New tables are limited to the
five `V2_ADDED_TABLES` in the existing domain policy. This policy is stricter than the original
manifest's open-season and V2-table exceptions. Existing Gridley adjudications do not excuse
row changes. Approved corrections require separately reviewed exact before/after evidence and
an owner-approved policy revision; there is no ignore flag. If production already has an
intermediate V2 schema, stop and review its migration baseline and constraint changes rather
than treating it as schema 110.

`preservation-queries.json` captures the match-detail projection for **all matches**, joined
registration and participation, authoritative Brownlow totals with the public club fallback,
award winners with source/provenance columns, and audit history. Query homes:
`src/db/queries/matches.ts` (`fetchMatch`), `players.ts`, `brownlow.ts` (`getBrownlowWinners`).
Hashes compare multisets; output ordering is excluded. Full-table content and definitions
provide the broader preservation proof. This is not an exhaustive assertion about every UI,
cached response or NL query: Linux application-contract validation remains required. The
existing manifest, coverage registry and award-reconciliation comparisons also remain required.

Publication/ingestion smoke tests run **after** the migration-only pair, in a separately named
phase/copy, with exact intended writes, provenance/audit records, refusals and idempotence
reviewed. They cannot be used to explain away a migration-only difference.

## Backup availability and required input

Only the documented backup location was checked: `~/backups/afldb/`
(`C:\Users\stuar\backups\afldb` on this workstation), from `docs/backup-restore.md` §1.
It is absent. **No approved local production backup is available.** No disk-wide search,
shared/production database, SSH forward, remote host or network acquisition was used.

Supply an owner-approved custom-format production archive, retained unchanged, at
`~/backups/afldb/production-shadow-approved.dump` on the approved isolated **Linux** host.
For this workstation the equivalent destination is
`C:\Users\stuar\backups\afldb\production-shadow-approved.dump`; no directory or dump was created.
Supply a restricted sidecar `production-shadow-approved.provenance.json` containing:

- Source database/environment attested as production, capture UTC time, operator, approval
  reference for local reuse/restoration and auth/audit-data handling; never credentials.
- Archive byte size and SHA-256, PostgreSQL server and pg_dump versions, dump command/options,
  schema-migration high-water mark, and capture consistency/writer-freeze procedure.
- Full schema/data coverage, including auth/audit, staging, registrations, match participants,
  raw Brownlow and award provenance; any excluded object must be listed and blocks acceptance
  until reviewed. No synthetic substitute or undocumented sanitisation.
- Existing restore verification record (or explicitly unverified, requiring a successful
  isolated restore before acceptance), previous deployed code commit, seal and compatible
  extension versions. Expected migration baseline is 110; differing ledger requires review.

The `.dump` suffix and archive readability alone do not establish provenance or production
compatibility. Do not make a backup request to production as part of this local task.

## ISSUE-229 B2 and production approvals

B2 requires the first authentic new-season (currently 2027) pre-match feed before **wiring or
first applying the fixture schedule writer**. It establishes the whole-season shape, actual
TBC date/time encoding if present, new status/key variants, and season-specific venue/round
mappings. Retained authentic 2026 samples prove the existing contract but cannot establish
those new-season facts. Owner-approved first apply remains mandatory. An inactive-writer
backend schema/data-preservation rehearsal does not require pretending B2 is satisfied.
Any release enabling that writer remains blocked by B2 and its first-apply decision.

Production remains NO-GO until production-data compatibility, Linux verification, host
backup/restore/rollback, legacy-writer retirement, ISSUE-316 C2/C3/C4/C4b/C5 sequencing (including
D-316-13 only after deployed C4), and explicit release approval are satisfied. S-A1..S-A4
remain environment/rehearsal approvals; S-A5 is not needed for this focused package and no
shared `afldb_test` rebuild is proposed. Production approvals A-REHEARSAL, A-BACKUP, A-GO,
A-REL, A-ROLLBACK and A-AFLT remain; no ISSUE-316 decision is shortened or granted here.

Executable steps and phase boundaries: [Linux rehearsal procedure](production-shadow-commands.md).
