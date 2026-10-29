# Isolated Linux production-archive rehearsal — 2026-10-20

**Follow-up:** [settlement closure and proposed Brownlow acceptance amendment](linux-rehearsal-followup-2026-10-20.md)
records the subsequent full restored-copy **73/73** settlement pass, authentic **217/217**
match correlation and identical **98-season** stored-only Brownlow reports. The original
results below remain historical evidence. The owner has since approved the scoped Brownlow
alternative ([D-V2-BROWNLOW-ALT-1](owner-decision-brownlow-alternative-2026-10-20.md)); the staged
comparator itself stays INCOMPLETE and the INCOMPLETE statements below are historical.

**Backend acceptance: INCOMPLETE. Production: NO-GO.** The authorised rehearsal ran with one
agent. Preservation and the scoped functional contracts pass; the original Brownlow
reconciliation comparison remains incomplete because this archive has no authentic staged
Brownlow seasons. No waiver, synthetic reconciliation input or production correction was used.

## Reviewed inputs and isolation

- Starting branch `v2/rebuild`, HEAD `6755645642663414d8f23557e84e9fa97f9177bc`, matched.
  Only untracked `.codex/` existed. It, existing worktrees and empty remotes were preserved.
- Owner instruction granted S-A1–S-A4 for this archive and fresh local isolation only.
- Original: `C:/Users/stuar/backups/afldb/v2-rehearsal-20261019T233531867935Z/`;
  `afldb_prod-20261019T233531867935Z.dump`, **29,779,665 bytes**, SHA-256
  `a583fc7d8d4376aa816253adf299a1325da7e65c994576b6b56bfa136ed11b04`.
- Exact sidecar: `afldb_prod-20261019T233531867935Z.provenance.json`, SHA-256
  `289d26504713e3495721d7d793407efaa38a879527f9379d94e709c3837f664f`.
  Its fields are `archive_sha256` and `archive_bytes`, rather than the earlier example's `sha256`.
  It attests full coverage, MVCC consistency with writers active, and separately measured
  baseline 110. The recorded previous checkout is `ff100dc2b8da8523f550ef45a9eaa3ef96d9d840`;
  the sidecar does not independently attest production's running build revision. Seal 2025
  follows the reviewed migration-acceptance policy; the sidecar has no seal field.
- Fresh WSL2 distribution **AFLDB-V2-Rehearsal-20261020**, Ubuntu 24.04,
  kernel `6.18.33.2-microsoft-standard-WSL2`, WSL `2.7.11.0`, Node **22.21.0**,
  PostgreSQL/pg_restore **16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)**, Python 3.12.3 with psycopg.
- Dedicated unprivileged `rehearsal` account, private cluster `/home/rehearsal/cluster`,
  fresh role passwords, verified PostgreSQL executable/PID/data directory, cluster
  `afldb_v2_isolated` and database marker `afldb-v2-isolated-test`. All rehearsal database
  names end `_test`. Port **55434** is bound only inside the named network namespace.
  Port 55432 and its SSH listener were not used or changed.
- Namespace `afldb-v2-rehearsal` has only loopback and no external route. Child processes
  receive a cleared environment and launcher-generated isolated DSNs. Exact Git source
  archives and fresh lockfile installs were used, without production `.env` files or service
  credentials. Default PostgreSQL service and cron were disabled in this new distribution;
  no application/acquisition timers were installed. SMTP/IMAP configuration was absent.
- Next's real Google Fonts downloads required a temporary CONNECT proxy allowing only
  `fonts.googleapis.com:443` and `fonts.gstatic.com:443`; it was stopped before browser tests.
  Final namespace listener inventory contains only PostgreSQL on 127.0.0.1:55434.
- Windows backing directory `D:/afldb-v2-rehearsal-20261020` has restricted owner/SYSTEM/
  Administrators access; the backing VHD also retains its explicit WSL VM service principals.
  Linux home/evidence directories are mode 700; archive and secret files are mode 600.

## Restore and migration preservation

`pg_restore --list` covered all **162** source objects recorded in provenance. Only the four
CREATE/COMMENT entries for preinstalled `pg_trgm` 1.6 and `unaccent` 1.1 were excluded.
All other TOC entries were retained; `--no-owner --no-privileges --exit-on-error --use-list`
was used without `--clean` or `--create`. The original archive was retained unchanged.

The archive was restored **once**, into fresh `afldb_v2_shadow_baseline_test`, with exit **0**.
All **110** restored ledger names and checksums matched the sidecar, ending at
`110_match_sheet_player_match_stats_authority.sql`. No failed/partial restore was overwritten.
The earlier failed cluster start occurred before restoration; its log is retained.

`afldb_v2_shadow_migration_test` was cloned from that baseline. Before any functional writes,
the reviewed capture scripts produced preservation, manifest, counts, Coleman and coverage
evidence. The runner showed exactly 111–115 pending, applied all five successfully, reconciled
privileges and showed **115 applied / 0 pending**. Identical captures followed on the same
database, roles, server, archive, seal and query contract. Both copies are retained unchanged.

| Comparison | Result |
|---|---|
| Complete existing row hashes, IDs, NULLs, relationships and definitions | PASS; zero findings |
| Six required public projections, including raw votes, award provenance and audit history | PASS |
| Historical manifest | PASS; 32 tables / 1,380 buckets |
| Base-table counts | PASS; 99 → 104 tables; only five intended V2 additions and five ledger rows |
| Coleman reconciliation, 1980–2025 | PASS; 46/46 agree before and after |
| Coverage registry | PASS; 650 cells |
| Original staged Brownlow reconciliation | INCOMPLETE; zero authentic staged seasons |

`shadow-parity.ts compare` exits **2**, with four checks passing, none failing and one incomplete.
The Linux-specific `release-gates.ts` report also exits **2**: preservation PASS, scoped backend
functionality PASS, migration compatibility/backend acceptance INCOMPLETE, production NO-GO.
Raw Brownlow votes are covered independently by preservation; that does not replace the
missing original reconciliation evidence.

## Linux verification

All commands ran in the restricted namespace. Integration commands were wrapped by
`node --import tsx tools/v2/isolated-pg.ts run <dedicated_test_database> --`.

| Exact suite(s), run with `node node_modules/vitest/vitest.mjs run … --no-cache` | Final result |
|---|---|
| `tests/v2-shadow-parity.test.ts`, `tests/v2-shadow-capture.test.ts`, `tests/v2-isolated-test-target.test.ts` | 221 passed |
| `tests/v2-fixture-contract.test.ts`, `tests/v2-acquisition-pipeline.test.ts`, `tests/v2-acquisition-replay.test.ts`, `tests/v2-curated-awards.test.ts`, `tests/v2-coleman.test.ts`, `tests/v2-coleman-publication.test.ts`, `tests/v2-coleman-projection.test.ts`, `tests/v2-brownlow-reconciliation.test.ts`, `tests/v2-brownlow-eligibility.test.ts`, `tests/v2-admin-operations.test.ts` | 516 passed |
| `tests/admin-upload-route.test.ts`, `tests/admin-current-season-settle.test.ts`, `tests/v2-shadow-award-reports.test.ts` | 136 passed |
| `tests/integration/v2-fixture-writer.test.ts` | 17 passed, synthetic dedicated database |
| `tests/integration/v2-brownlow-eligibility.test.ts` | 35 passed, separate restored clone |
| `tests/integration/v2-curated-awards.test.ts` | 17 passed, synthetic dedicated database |
| `tests/integration/v2-coleman-publication.test.ts` | 28 passed after psycopg provisioning and isolated-port fix |
| `tests/integration/privileges.test.ts` | 43 passed on synthetic database; 43 passed on reconciled rollback clone |
| `tests/integration/settle-afl-api.test.ts -t '^AFLDB-ISSUE-228 S6'` | 17 passed / 56 filtered, reference-only dedicated database |

The reference-only database contains the migrated schema and six selected tables: sources,
seasons, club organisations, clubs, venues and the migration ledger. It contains no historical
match rows. This tests insertion/replay/promotion without changing any restored production fact.
The complete settlement file on a full restored clone remains **46 passed / 27 failed**.
The first insertion case is refused as `possible_existing_match` before canonical writes;
other retained failures include statement timeouts and a rebuild-marker test explicitly
restricted to names outside this rehearsal's permitted namespace. That broader suite is
**not green**, and no general settlement/rebuild acceptance is claimed.

Earlier failures remain in restricted evidence: missing historical Brownlow definition on an
empty synthetic database; absent psycopg; the offline loader's fixed 55432 guard; denied font
downloads; an initially short-lived font proxy; and report-import/ownership defects. Corrected
runs have distinct files. No assertions were disabled or weakened.

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit **0**, including
  the final changed integration test. Both Next production builds also performed TypeScript checks.
- `node node_modules/eslint/bin/eslint.js tools/v2/isolated-pg.ts tests/integration/v2-coleman-publication.test.ts`:
  exit **0**. The six preservation-package files listed in `production-shadow-commands.md`
  plus the launcher also passed lint. Changed Python parsed with `ast.parse`, exit **0**.
- V2 and previous: `node node_modules/next/dist/bin/next build --webpack`, then
  `node tools/build/prepare-standalone.mjs`: both exit **0**, with telemetry disabled and only
  isolated DSNs. Builds precede the offline-only Python guard/test change; no application
  runtime source changed afterwards. No full-suite or Gridley rerun was performed.

## Application and database rollback

The separate restored `afldb_v2_shadow_application_test` retained migrations 111–115 throughout
**previous → V2 → previous → V2**. Actual standalone servers bound loopback ports 3911/3912
inside the namespace. Existing `local-runtime-check.mts` passed **18 / 24 / 18 / 24** browser,
public-route and anonymous/Admin/Super Admin permission checks. Statistical/audit fingerprints
matched within and across all phases; no browser exception or external request occurred.
Processes were stopped using verified PID/executable/working directory/listener ownership.

On separate `afldb_v2_shadow_rollback_test`:

1. Exported all five V2 ledgers before dropping them. They were empty on this clean migration
   clone: exports test mechanics, not recovery of populated publication histories.
2. Ran `docs/v2/rollback-111-114.sql`, then explicitly dropped migration 115's
   `ix_afl_api_identity_adjudications_supersedes_id` and deleted only its ledger entry.
   Applied previous-release privileges. Ledger returned to 110. Schema, excluding ACL/meta
   schema, matched the restored baseline exactly after removing random pg_dump restrict keys.
3. Complete baseline preservation after reversal: PASS, zero findings. Reapplied 111–115 and
   V2 privileges successfully. Schema and grants matched the first forward state after
   normalising random restrict keys and sorting only consecutive, commutative GRANT statements.
   Raw comparison initially differed only in GRANT ordering; both dumps and the diff are retained.
4. Restored-copy permission testing found the exact migration-014 staging DEFAULT privileges
   absent because restore used `--no-privileges`. Current `privileges.sql` restores existing
   table grants but not those two defaults. Reconciled that existing policy on this mutable
   rollback copy only; permission tests then passed 43/43. The migration-only copy was not
   changed after capture. Future rehearsals must account explicitly for this omitted ACL state.

Reversing 111–114 discards V2 eligibility/proposal/decision/publication provenance, including
their audit chain; existing award winners and historical audit tables are not removed by the
drop script. Exports do not make that data loss harmless. Application rollback retains all
five ledgers and migration 115; no destructive reversal is needed for a code rollback.

## Restricted evidence and retained changes

Within WSL distribution `AFLDB-V2-Rehearsal-20261020`:

- `/home/rehearsal/input/`: exact archive/provenance copies.
- `/home/rehearsal/evidence/`: commands/scripts, exit outcomes, original and corrected logs,
  TOCs, complete row-hash captures, manifests, reports, exports and schema/grant dumps.
- `/home/rehearsal/cluster/`: all retained databases, isolated credentials and PostgreSQL logs.
- `/home/rehearsal/code/` and `/home/rehearsal/previous/`: reviewed source copies and builds.

Final evidence manifest SHA-256:
`7cff62545b46fcaf2e56fbc790e7849ee40e4987eae0e48c160464cbe044d172`.
Linux gate report `linux-release-gates-readable.json` SHA-256:
`ad2f305389e8bde022a2ed5beeffdee2a9dcc290cb411855ff42cd28231290ec`.
These aggregate hashes may be committed; the inventories and data remain outside Git.

Retained fixes (AFLDB-ISSUE-317): TCP-only cluster initialisation avoids Ubuntu's root-owned
Unix-socket directory; offline Coleman accepts the validated isolated launcher port while
retaining loopback, database-marker and cluster checks; seven unsafe-target cases were added
to the existing integration suite. The source-delta hashes are retained with evidence.

No production connection, host deployment, traffic switch, production writer retirement,
push, worktree creation or archive/environment deletion occurred. Local process switching
does not prove production routing, host backup recovery or host traffic switching. ISSUE-229 B2
and first apply, ISSUE-316 sequencing, host operational evidence and explicit production release
approvals remain outstanding. Strict Gridley results stay **149 findings / 99 approved /
50 unapproved**, with zero new adjudications. The backend migration criteria are **not yet met**;
the missing authentic Brownlow reconciliation requires scoped owner review. Production GO is
a separate owner decision.
