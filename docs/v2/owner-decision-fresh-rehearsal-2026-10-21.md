# Fresh rehearsal acceptance and staging default policies — 2026-10-21

Provenance: explicit owner instruction in the Codex session dated 2026-10-21,
repository `D:\dev\afldbV2`, branch `v2/rebuild`. Expected and verified starting HEAD:
`2474d2e96fde66b4b0d903ebd00ed574ff842968`. Only untracked `.codex/` existed; preserved.
Remotes were empty. One agent, no subagents. This records the approval of the exact
acceptance request in [the release plan](production-release-plan-2026-10-21.md).

## Owner approval, verbatim

> The owner approves the scoped fresh-rehearsal acceptance and the two staging default-privilege policies proposed in docs/v2/production-release-plan-2026-10-21.md.
>
> Archive SHA-256:
>
> 7fefcd9b791520ccc939f7f9d0ca1ddacd5fe99d2cca33d53ea1aa9c6dea6599
>
> Production baseline: 110.
> Rehearsed migrations: exactly 111–117.
> Reviewed runtime source: a6400e7dd805fce4d2090110831b2eec45f23500.
>
> The owner accepts:
>
> 1. Migration 116’s exact reviewed receipt-table, function, trigger and permissions delta, and migration 117’s exact eligibility nullability/comment delta.
>
> 2. This archive’s complete raw-vote/audit preservation, identical 98-season stored reports and passing focused Linux checks as alternative migration evidence for the unavailable staged Brownlow comparator.
>
> All other existing definitions, records, relationships and required query outputs remain subject to strict comparison. Unexpected changes still fail.
>
> This does not establish authentic staged API reconciliation for this archive or approve operational publication.
>
> For future tables created by afldb_owner in schema staging:
>
> - afldb_import: SELECT, INSERT, UPDATE, DELETE, TRUNCATE.
> - afldb_app: SELECT.
>
> These are the two exact ALTER DEFAULT PRIVILEGES declarations in the reviewed release plan.
>
> Policy approval does not authorise executing them on production. Do not extend them to other roles, schemas or object types.

The same instruction authorises focused gate tests, typecheck, changed-file lint and focused local
commits with explicit paths. It prohibits production/shared access, new backups/restores/rehearsals,
builds/browser/full-suite reruns, migrations/deployments/corrections/privilege or timer/service writes,
pushes, subagents and new worktrees. It requires preservation of restricted evidence, archives,
worktrees and unrelated `.codex/` state, and a stop for review after acceptance recording.

## Recorded decisions

| Identifier | Exact decision | Production execution |
|---|---|---|
| D-V2-FRESH-REHEARSAL-1 | Accept this archive's migration-only compatibility, baseline 110 through exactly 111–117 | None |
| D-V2-FRESH-SCHEMA-1 | Accept only the measured 116 receipt objects/permissions and 117 nullable eligibility/comment deltas | Target/revision/window-bound schema installation approval still pending |
| D-V2-BROWNLOW-ALT-2 | Accept this archive's raw-vote/audit preservation, identical 98-season stored reports and passing focused Linux evidence for the unavailable comparator | No API reconciliation, ingestion, correction or publication authority |
| D-V2-STAGING-IMPORT-DEFAULT-1 | Future tables created by afldb_owner in staging: afldb_import SELECT, INSERT, UPDATE, DELETE, TRUNCATE | PENDING; no execution authority |
| D-V2-STAGING-APP-DEFAULT-1 | Future tables created by afldb_owner in staging: afldb_app SELECT | PENDING; no execution authority |

The two policy declarations are exactly:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging
  GRANT SELECT ON TABLES TO afldb_app;
```

Both are absent from captured production. They were installed only on the rehearsal clone before
capture; approving their policy does not install them. No other role/schema/object type is covered.

## Immutable evidence binding

Source tar SHA-256: `a3702c04ae69f5fe12f75949ead992324b75c8a390eefbde992e78a592be13b3`.
Restricted directory: `/home/rehearsal/evidence/release117-20261020T194848633969Z/`.
Its complete 50-file `evidence-manifest.sha256` is pinned to
`22dc0e2a74dea414ccc49feb55808d97621255be918245d19731e1550e925dce`.
All 50 files were rehashed successfully, including the actual backup and source tar.
The exact canonical-LF checksums and filenames of migrations 111–117 are retained in the
[new result's binding](evidence/fresh-rehearsal-acceptance-2026-10-21.json) and
`FRESH_ACCEPTANCE` in `tools/v2/fresh-rehearsal-acceptance.ts`; each was checked against current files.

Full schema/catalog, schema sections/diff, permission probes, both snapshots, reports and Linux logs
are pinned by that inventory. This accepts these measured bytes only, with no pattern-based schema
ignore and no change to the original strict comparator or D-V2-BROWNLOW-ALT-1.

| Measured evidence | Exact SHA-256 |
|---|---|
| before.schema.sql | `f802e0789e7c84886cda9de2dff020a7cff3f02554a31f907d1b2fc3fb9784d5` |
| after.schema.sql | `85bda19340a340771afff6b31a523f392a2dbfc016169a41d8e616d6461d30e4` |
| schema-sections.json | `518115f17a036ae48a8101ff0b9a7122f7dfd17976bb8eef89a040e1cb8230af` |
| schema.diff | `51f028ff7a3f358062975594ba6d75c2041e25a8d261fed13fca32a534d01403` |
| receipt-privilege-check.json | `d64f03a68e88d5f17b453bb7406a3ee3d3d77e3d39991ae729973ee53098a588` |

- 116: eight-column empty owner-owned receipt table, primary key/four checks/comment; no app/import/auth
  grants; SECURITY INVOKER function, default PUBLIC EXECUTE (`proacl NULL`); enabled statement trigger
  before UPDATE/DELETE/TRUNCATE. Twelve actual-role mutation denials, three owner immutable refusals;
  synthetic insert rolled back, zero receipts remain.
- 117: `staging.afl_api_brownlow_vote.eligible` boolean NOT NULL becomes nullable boolean, with exactly
  the UNKNOWN comment in the checksum-bound file. No row/default/index/key/grant change.
- Other additions from 111–115 retain their original strict rules. All 87 added schema sections,
  the sole changed existing section, zero removed sections, 63 preserved sequences, five added
  sequences and unchanged roles/memberships/default ACLs are covered by complete pinned evidence.

## Measured acceptance

| Gate | Actual result |
|---|---|
| Original strict preservation / compatibility | FAIL, unchanged: exact receipt addition and eligibility definition change |
| Original strict parity | FAIL: 3 pass, receipt-table count policy fail, staged Brownlow incomplete |
| Original staged Brownlow comparator | INCOMPLETE, unchanged; never converted to PASS |
| New evidence integrity | PASS, all 50 files plus seven canonical-LF migration files |
| Accepted migration compatibility / backend acceptance | PASS, this archive/source/110–117 only |
| Production operational acceptance | INCOMPLETE / NO-GO |
| Production default-privilege installation | Both PENDING; execution not authorised |

1,659,904 existing rows, six public projections and raw-vote/audit data are preserved; stored reports
cover 98 seasons with identical SHA-256 `fea86e5dcbd74027f9d5951a6eb09405b95c2669acb03c5cc3a83613e0346db2`.
Retained Linux checks: 306 units, 43 privileges, 47 eligibility integration; zero failures/skips.
The new offline gate passed on these actual restricted artifacts and wrote the linked new result
exclusively; the old strict report was not overwritten. Authentic staged reconciliation remains
unestablished for this archive. Strict Gridley 149 / 99 approved / 50 unapproved is unchanged.

Acceptance-tool validation: focused `tests/v2-shadow-parity.test.ts` **158/158** (including 15 new
boundary cases); `npm run typecheck` and ESLint on the two changed TypeScript files **PASS**.
The existing CLI subprocess case required child-process access; its restricted Windows attempt
failed before the authorised rerun passed. The actual acceptance gate ran on Linux Node 22.21.0
using the existing isolated tools, without database access. Full suite, builds, browser checks,
restores and migration rehearsals were not repeated. No new issue or issue-state change was
identified; `IssuesIndex.md` and `issues.md` remain unchanged.

## Next authority

First remaining concrete release prerequisite: owner review/merge reconciliation of the imported
ISSUE-316 work with its source branch, then C0 DEV sync and C1 retirement rehearsal under the owner
authorities in [ISSUE-316 §7 C0/C1](../../issues/open/AFLDB-ISSUE-316.md).
This task grants no merge/DEV-deployment or DEV-acquisition authority. The next production decision
in that sequence is D-316-1 for C2's final acquisition and coordinated rollover, after C0/C1, with
the separately approved writer-pause/recovery window. No C2 execution is approved here.

Artifact/build identity after merge/C2, live freshness/frozen rollback backup, A-ROLLBACK, A-AFLT
timer retirement, A-REL including 111–117 and both privilege writes, and A-GO remain separate.
C3 inert units, C4 deployed readiness, C4b/D-316-13 and C5/D-316-4 activation remain distinct;
ISSUE-229 B2 and Brownlow operation-specific approvals remain intact. No production execution
envelope or correction plan digest was created. See the ordered release plan for the full sequence.
