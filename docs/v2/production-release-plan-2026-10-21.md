# Production inspection, fresh rehearsal and ordered release plan — 2026-10-21

**Scoped owner acceptance recorded; production release remains NO-GO.** The
[2026-10-21 owner decisions](owner-decision-fresh-rehearsal-2026-10-21.md) accept this exact
archive/source/110–117 rehearsal (D-V2-FRESH-REHEARSAL-1, D-V2-FRESH-SCHEMA-1,
D-V2-BROWNLOW-ALT-2) and the two staging default policies (D-V2-STAGING-IMPORT-DEFAULT-1,
D-V2-STAGING-APP-DEFAULT-1). The [new offline result](evidence/fresh-rehearsal-acceptance-2026-10-21.json)
is migration compatibility **PASS**, original strict **FAIL**, staged comparator **INCOMPLETE**,
production operational acceptance **INCOMPLETE / NO-GO**. All 50 restricted inventory files and
seven migration checksums verified. Privilege installation remains pending and unauthorised.
No demonstrated rehearsal is requested again absent a specific changed baseline/artifact condition.

The original inspection/rehearsal task used one agent, no subagents,
pushes, new worktrees or cleanup. Production database contents, roles, services, timers, installed code
and traffic were not changed. The approved backup and restricted inspection files were the only
production-host filesystem additions. No execution-approval envelope or production correction plan
digest was created. Dates below are UTC; the session date is 21 October in Australia/Sydney.

## Verified candidate and current production

Reviewed source: `v2/rebuild`, `a6400e7dd805fce4d2090110831b2eec45f23500`; expected HEAD matched.
Only pre-existing untracked `.codex/` was present. It was preserved; remotes remain empty.
The source-only `git archive` artifact is `reviewed-source-a6400e7d.tar`, SHA-256
`a3702c04ae69f5fe12f75949ead992324b75c8a390eefbde992e78a592be13b3`.
This is an identified source artifact, not an installable production build.

| Fact | Current evidence |
|---|---|
| Access and host | Owner SSH configuration resolves `afldb` to `arm@209.38.87.252:22`; remote hostname `afldb-prod` |
| Cluster | PostgreSQL `16/main`, port 5432; `/var/lib/postgresql/16/main`; system identifier `7674454702926115004` |
| Database | `afldb_prod`, OID `66668`, owner `afldb_owner`; actual SQL peer `::1:5432` through host-local `localhost` |
| Server/client | PostgreSQL and pg_dump 16.15, Ubuntu 16.15-0ubuntu0.24.04.1 |
| Extensions | `pg_trgm` 1.6, `unaccent` 1.1, `plpgsql` 1.0 |
| Ledger | Complete 110-record ledger, ending `110_match_sheet_player_match_stats_authority.sql`; names/checksums retained and verified on restore |
| Deployed checkout | `/home/arm/projects/afldb`, `ff100dc2b8da8523f550ef45a9eaa3ef96d9d840`, no tracked changes; `.next/BUILD_ID` `vcxM_SyDxFCP0sj9n9W1t` |
| Running app | `afldb.service` active/running, PID 2626763, started 18 October; working directory matches. Checkout/build files do not independently bind that PID to a Git revision |
| Legacy writer | AFL Tables settle service inactive; `afldb-settle-afltables.timer` enabled, active/waiting; no change made |
| Other exact timers | `afldb-email-intake.timer`, `afldb-settle-afl-api.timer`, `afldb-settle-afl-api-brownlow.timer`: not-found/inactive. This does not prove every possible ad hoc writer is absent |
| Roles | Five `afldb_*` roles have no superuser/create-role/create-db/replication/BYPASSRLS attributes. Backup is a member of `pg_read_all_data`; zero writable relations in the inspected application schemas |

Identity/ledger/ACL observations span approximately 19:46–19:54 on 20 October UTC; the complete
catalog inspection was measured at 19:53:40 UTC. The full ledger, schema dump, ownership/ACL/default
privileges and extension records are restricted side reports. Neither streamanator, afldb_dev nor
the local SSH-forward listener at 55432 was used.

Live Brownlow aggregate observations: 2025 has 9,522 round-vote rows (621 positive, 8,901 zero), all
with NULL source and match IDs. 2026 has the same counts, source `afltables`, all match IDs NULL.
The 1984–2025 NULL-match-ID count is **320,861**. There are **zero staged Brownlow rows**, 98 stored
season-total seasons, and zero unresolved `data_issues` matching Brownlow issue/entity types.
No named live ownership-issue list therefore exists for an issue-resolution operation at this point.
Missing IDs/source and the policy-approved twelve 2025 eligibility rulings remain separate correction
work; this inspection did not re-adjudicate those rulings or transfer 2026 ownership.

## Fresh backup, restore and isolated measurements

Remote directory:
`/home/arm/backups/afldb/release117-20261020T194848633969Z/`

Secure Windows export:
`C:\Users\stuar\backups\afldb\release117-20261020T194848633969Z\`

Archive in both directories: `afldb_prod-20261020T194848633969Z.dump`, **29,776,493 bytes**, SHA-256
`7fefcd9b791520ccc939f7f9d0ca1ddacd5fe99d2cca33d53ea1aa9c6dea6599`.
Capture: **2026-10-20 19:48:49.431686 → 19:48:58.584105 UTC**. Remote/local size and hash agreement
was checked on export and again after rehearsal; the Linux input copy has the same hash.
The unchanged `.provenance.json` sidecar records approval, source, separately measured complete ledger,
versions, options, coverage, size/hash, consistency and initially unverified restore status.
`restore-result.json` supplies the subsequent result without rewriting that sidecar.

One full custom-format dump used `afldb_backup`, compression 6, `--no-owner`,
`--lock-wait-timeout=5s`, no schema/table/data exclusions and no retention script. The single pg_dump
MVCC snapshot kept writers enabled. The separately observed ledger is not claimed to be in that same
snapshot. The dump completed without error; its TOC is readable remotely and locally. Remote mode is
600 in a mode-700 directory; Windows access is restricted to owner/SYSTEM/Administrators.

Existing WSL distribution `AFLDB-V2-Rehearsal-20261020`: PostgreSQL PID 503, executable/data-directory
and `rehearsal` ownership verified **before authentication**; network namespace `afldb-v2-rehearsal`
has no external route and only the PostgreSQL listener at 127.0.0.1:55434. The launcher independently
checks cluster `afldb_v2_isolated`, database marker `afldb-v2-isolated-test` and target names. Cleared
child environments contain only isolated credentials. No production environment file was copied;
application runtime/integrations were not started.

New retained databases:

- `afldb_v2_fresh117_baseline_test`: archive restored **once**, exit **0**; complete ledger matches;
  174 table/sequence/view catalog objects. No retry over a partial restore.
- `afldb_v2_shadow_fresh117_migration_test`: clone used for the migration-only pair and runner rerun.
- `afldb_v2_shadow_fresh117_smoke_test`: separate clone used for focused functional/privilege writes.
- `afldb_v2_fresh117_migration_test`: initial preparation copy retained after the shadow-name guard
  refused it before capture or migration. The guard was not changed.

Restore retained every TOC entry except the four reviewed CREATE/COMMENT entries for bootstrap-owned
`pg_trgm`/`unaccent`; used `--no-owner --no-privileges --exit-on-error --use-list`, no clean/create.
Old-release privileges were reconciled only on the mutable migration clone before capture. The two
exact migration-014 staging default grants were also applied there. **The captured production source
itself lacks these default grants**; they are not merely ACLs lost during restore. Source-to-restored
schema comparison otherwise matches after explicit ownership/dump-format normalization. Future
installation of these two defaults is an explicit privilege change requiring release approval.

The freshly derived pending set, and the only migrations applied, was:

```text
111_curated_award_proposals.sql
112_derived_award_results.sql
113_brownlow_eligibility_decisions.sql
114_award_projections_and_curated_revisions.sql
115_adjudication_supersession_fk_index.sql
116_brownlow_correction_receipts.sql
117_brownlow_provider_eligibility_unknown.sql
```

All seven ledger checksums match canonical-LF source. Prior 110 ledger records remain identical.
No ledger entry was deleted or baseline forced. There was no ingestion, publication or correction
between captures. Current privilege reconciliation ran after migrations.

| Fresh measurement | Result |
|---|---|
| All existing rows, including ledger | **1,659,904 preserved**, 99 → 105 tables; existing non-ledger row multisets identical; six new tables empty; seven ledger rows added |
| IDs, relationships, NULLs, raw votes/provenance/audits | Preserved by all-column row hashes; no existing row changed/lost |
| Six required public projections | All identical, including registration, participation, match details, Brownlow raw, awards and audits |
| Manifest / coverage / Coleman | PASS: 32 tables / 1,380 buckets; 650 coverage cells; 46 seasons 1980–2025 |
| Stored Brownlow reports | 98 identical reports; both SHA-256 `fea86e5dcbd74027f9d5951a6eb09405b95c2669acb03c5cc3a83613e0346db2`; stored-only basis |
| Existing sequences / roles / memberships / default privileges | 63 existing sequence states identical; five intended sequences added; role attributes/memberships/default ACLs unchanged across migration pair |
| Existing schema | No section removed. Sole changed existing section: staging vote table, exactly `eligible boolean NOT NULL` → `eligible boolean` |
| Additive schema | 87 sections, all belonging to the six named migration tables and their constraints/indexes/comments/ACLs, the 115 index, 116 function/trigger and the exact 117 column comment; no unexpected section |
| 116 | Owner-owned eight-column receipt table, PK/four checks/comment; SECURITY INVOKER function with default PUBLIC EXECUTE (`proacl NULL`); enabled statement trigger before UPDATE/DELETE/TRUNCATE; no app/import/auth table privileges |
| 116 actual-role probes | 12/12 mutation attempts denied with 42501; three owner mutation forms refused by immutable trigger; synthetic insert rolled back; receipt count returns to zero |
| 117 | Nullable boolean and exact UNKNOWN comment; no default/index/key/grant/row change; NULL semantics exercised in focused suite |
| Runner rerun | Nothing to apply; post/rerun full preservation snapshots identical; complete schema identical after dump-key and consecutive-GRANT-order normalization |
| Focused Linux verification | **306/306 units**, **43/43 privileges**, **47/47 eligibility integration**; no failures/skips |

The **unchanged** strict parity report is **FAIL** (3 pass, receipt-table policy FAIL, staged Brownlow
INCOMPLETE). The strict release gate is **FAIL**, with exactly the new receipt table and changed
eligibility definition as preservation findings. No broad schema-ignore rule, policy edit or old
alternative attestation was supplied. These are visible acceptance-boundary findings, not lost rows.

Restricted evidence: `/home/rehearsal/evidence/release117-20261020T194848633969Z/`.
50-file inventory `evidence-manifest.sha256` SHA-256:
`22dc0e2a74dea414ccc49feb55808d97621255be918245d19731e1550e925dce`.
Source copy: `/home/rehearsal/release117-a6400e7d-20261021/`. Earlier archives/copies/evidence remain.
Raw rows, row hashes, archives, credentials and the full inventory are outside Git.

## Original acceptance request — subsequently approved within scope

The request below is preserved as reviewed. Approval is now recorded in the linked owner-decision
record; references below to a required decision describe the original request. Approval covers
migration evidence and future privilege policy only, never production installation or publication.

The owner must review the following **new, narrowly bounded** acceptance for archive
`7fefcd9b791520ccc939f7f9d0ca1ddacd5fe99d2cca33d53ea1aa9c6dea6599`, baseline **110**, migrations
**111–117**, source **a6400e7dd805fce4d2090110831b2eec45f23500**:

1. Accept only migration 116's exact empty receipt table/function/trigger/permissions and migration
   117's exact nullability/comment delta as explained migration-preservation changes. Every other
   existing definition remains subject to comparison; changed data/public results remain blockers.
2. Accept the unavailable staged Brownlow before/after comparator using this archive's measured
   complete raw-vote/audit preservation, identical 98-season stored reports and focused Linux checks.
   This establishes no fresh authentic API-versus-stored operational reconciliation.
3. Separately review the exact two staging default-grant declarations below as the intended future
   privilege policy, explicitly recognizing their absence from current production.

This request does not alter the recorded FAIL/INCOMPLETE results or grant installation authority.
The earlier D-V2-BROWNLOW-ALT-1 remains bound to its old archive and 110–115. The authentic 2025
reconciliation and three approved Brownlow policies remain useful evidence, with their documented
limits; they are not production execution approval. Any later acceptance tooling change must encode
only the exact approved delta and retain strict comparison of everything else.

## Ordered future release plan — do not execute from this record

1. **Owner decisions and artifact lock.** The measured rehearsal acceptance and two privilege
   policies above are approved. Remaining: accept known test/lint residuals, visual/merge decisions and host recovery limits.
   Require A-GO, an A-REL explicitly covering **111–117** and both default grants, target/revision-bound
   schema approval for **116 and 117**, A-ROLLBACK and A-AFLT. Existing wording mentioning only
   111–114 is insufficient. Complete ISSUE-316 C0/C1 and approve D-316-1 for C2; decide the explicit
   A-AFLT route after its final acquisition if C5 is not yet possible. No writer enablement follows.
   ISSUE-316 source reconciliation is complete locally (19/19 snapshot and import matches); no
   redundant merge is needed. Review the [exact C0/C1 adaptation and DEV shell approval package](issue316-c0-c1-approval-2026-10-21.md);
   original acquiring C0 and V2 runtime refusal require that explicit owner decision. Full deployed
   DEV app/audit C1 and separate C2 authority remain pending. Record the full
   resulting execution commit and production-configured build/artifact hashes before installation.
   The present source archive is the measured candidate; no future merge/rollover SHA is invented.

2. **Fresh read-only preflight and recovery gate.** Immediately before the window, reverify SSH host,
   system identifier, database/OID/owner, extension versions, full ledger/checksums/schema/ACLs,
   checkout/build/process identities, timer states, all writers/admin activity and available space.
   Require no active settle and no migration drift. Resolve host-local backup recovery/routing and
   Caddy/systemd/TLS prerequisites under their own authority. This WSL restore is not host disaster
   recovery or traffic-switch evidence. Retain current serving artifact and exact timer/polkit state.

3. **First proposed production write: temporary writer pause.** Only after the owner explicitly
   authorizes this coordinated C2/release window and its recovery route, run:
   `sudo systemctl stop afldb-settle-afltables.timer`.
   This is a temporary pause, not approval to retire the source. Read back inactive timer, enabled
   state unchanged, inactive settle service and no in-flight writer; arrange the approved admin-write
   freeze. If any state differs, stop. No blanket instruction to stop unknown services is implied.

4. **ISSUE-316 C2 before installing the quarantined V2 runtime.** Under D-316-1, perform the final
   full-history AFL Tables acquisition plus ladder witness, D-233-3 census/validation, then reviewed
   rollover dry run/apply with `--afltables-retirement-decision D-316-1`; the switch is written retired
   first, and all six coordinated reference files form one reviewed commit. Read-only rehash/review
   every new acquisition and each reference-state write before proceeding. The current production
   `ff100dc2…` has the acquisition implementation; the V2 candidate's old acquisition entry point
   refuses and points into `legacy/offline/`. Do not deploy V2 and then attempt C2 through its stub.
   A separately reviewed ISSUE-316-capable execution artifact, exact source labels and successor
   validation inputs are prerequisites; this record does not fabricate them or bypass a validator.
   C2's configuration/commit changes require renewed affected checks and a pinned rebuilt artifact;
   the a6400e7d evidence does not automatically certify those changes.

5. **Retire legacy triggers, then establish final rollback bytes.** After C2's verified final
   acquisition and the separate A-AFLT decision, disable the AFL Tables timer and retire its exact
   discovered polkit rule using the existing cutover procedure. The email-intake unit is currently
   absent: recheck; if present later, disable it under A-REL. Prove `legacy-writers` PASS from the
   reviewed artifact and retain read-only enabled/active/process checks. Install no active new writer.
   With writers/admin edits frozen, capture a new non-pruning full backup/off-host copy and source
   manifest and prove its restore under fresh authority. Compare its complete baseline with this
   rehearsal; drift requires a fresh migration rehearsal/acceptance. The current writers-active
   backup proves this capture's consistency, not the eventual frozen release rollback baseline.

6. **Schema before code.** Reverify identity under the explicit production owner target. Only after
   write approval, inspect the runner with `node --import tsx tools/db/migrate.ts --target prod --status`,
   then apply with `node --import tsx tools/db/migrate.ts --target prod`. Its explicit secret input is
   `AFLDB_PROD_DATABASE_URL`, supplied securely by the operator, never a command-line DSN. The runner
   also issues its existing metadata bootstrap DDL; do not use its status mode for a read-only-only
   authorization. First substantive new schema write is migration **111**'s `CREATE TABLE award_proposals`.
   Execute the reviewed runner for exactly the freshly pending **111–117**, each transaction/ledger
   record verified before continuing. Do not use `--target test` in production, delete ledger rows,
   edit checksums or replay an assumed 110 baseline. If any step fails, retain its log and re-read
   actual ledger/schema before deciding recovery; prior successful migrations remain committed.

7. **Privileges, with exact read-back.** Reconcile using
   `psql -X -w -v ON_ERROR_STOP=1 -d afldb_prod -f tools/maintenance/privileges.sql`, with verified
   host-local port 5432, role `afldb_owner` and password supplied only through the secure libpq
   environment. The privilege TypeScript CLI has no `prod` target: do not invent one or silently
   use its default development target. Separately execute the two approved, migration-014 declarations
   through that same verified owner connection:

   ```sql
   ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging
     GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;
   ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging
     GRANT SELECT ON TABLES TO afldb_app;
   ```

   After each privilege write, read back ACLs/default ACLs/memberships/role attributes; compare to
   the reviewed policy. Verify receipt table owner-only access, function SECURITY INVOKER/default
   EXECUTE and enabled immutable trigger; verify nullable eligibility/comment. No production test
   INSERT/UPDATE/DELETE/TRUNCATE is proposed. Re-read migration status: 117 applied, zero pending.
   Read-only compare all preserved rows/public projections and exact schema deltas before code.

8. **Install the exact rebuilt artifact and verify.** Only after schema/privilege gates and artifact
   identity/config review, install code, restart/switch traffic under A-REL and verify revision/build,
   health, sessions/capabilities, key public/operations pages and logs with read-only requests.
   Keep acquisition/provider/mail integrations and all new canonical writers disabled. Confirm
   source-retirement refusals and timer state without invoking an acquiring job. Any unexplained
   public/statistical/schema/privilege difference stops release and invokes the approved recovery route.

9. **ISSUE-316 new-writer boundary remains separate.** C3 / D-316-2 installs AFL API units inert,
   both disabled/inactive. C4 / D-316-3 requires authentic 2027 rounds/venue/feed readiness deployed.
   Only then may D-316-13 authorize C4b's setting-writing production D1 rehearsal; its read-only
   before/after evidence and restored-off setting must pass before C5 / D-316-4. C5 may activate only
   the match writer. Preserve D-316-5…12 requirements (debutants, totals, attendance/bios/coaches,
   completeness, rebuild/rollover and controls); C8 alone governs the Brownlow count-window timer.
   The first 2027 AFL API canonical match write is the forward-recovery boundary: AFL Tables cannot
   reclaim its ownership. **ISSUE-229 B2** still blocks wiring/first applying the new-season fixture
   writer until authentic first-season whole-feed/TBC/status/key/venue/round evidence, a reviewed dry
   run and separate owner first-apply approval. Inactive-writer schema/runtime installation does not
   satisfy or bypass B2. Read-only inspect every future setting/unit/data write before the next step.

10. **Brownlow operations are five separate later decisions.** After 116/117 and runtime are installed,
    capture fresh target and restored-copy post-schema Brownlow baselines, rehash backup/restore bytes
    and obtain a matching baseline under the correction runner's freshness rules. A pre-110 archive
    cannot be asserted equal to a post-117 baseline. Reconstruct and prove the required post-schema
    restored baseline from the fresh release backup, or obtain a new post-schema backup/restore with
    separate authority. Only then generate real operation plans/digests and request exact execution
    approval. In order: `observe` authentic pinned 2025 snapshot (staging/spine/batch/receipt only);
    `backfill` explicit 1984–2025 list with fresh unique mappings/counts and zero exclusions;
    `adopt` 2025's 621 positive rows/207 sets while retaining 8,901 zeros and original provenance;
    `eligibility` exact twelve approved 2025 records, current identities/IDs/actor/citations and audited
    publication; `resolve` only freshly existing, genuinely healed named ownership issues. If none
    exist, do not invent them or run resolve. After **each** committed operation, inspect read-only
    receipt/audits, raw votes/provenance, eligibility/results and protected 2026/zero rows; regenerate
    baseline/backup matching evidence/plan/approval for the next operation. Unknown semantics and
    withheld-publication refusals remain intact. No shared batch approval; 2026 stays excluded.

11. **Recovery and stop conditions.** Before the first 2027 API canonical write, prefer reverting the
    app artifact while retaining forward schema/receipts and grants, subject to the reviewed legacy
    runtime contract; do not silently restart retired acquisition. 117's NULLs forbid restoring NOT
    NULL until a separately reviewed reconciliation proves zero NULLs. Retain 115's index and 116's
    append-only receipts; no destructive receipt rollback is approved. Reversal of 111–114 loses
    populated workflow/provenance and requires exact row/sequence exports and separate approval.
    Host restore requires the frozen verified archive, full sequence/auth/audit recovery, writer
    freeze and A-ROLLBACK; this rehearsal does not grant it. Stop for wrong identity, drift, contention,
    any dump/restore/migration error, unknown pending file, unexpected schema/ACL/data/result change,
    missing acceptance/authority, unverified artifact, active competing writer or failed readiness.
    Keep failed/partial copies and logs. After the ownership boundary, use supervised forward fixes.

## Evidence reuse and freshness limits

Fresh checks above use Linux Node 22.21.0 / PostgreSQL 16.15 and the exact a6400e7d source archive.
1,467 runtime/package/tool/test/deploy/root-config files match the retained final Linux build source
after canonical-LF normalization; comparison manifest SHA-256
`fccd15c4e452dc0d7fe8b76a5c9badea0c96a7b7b3135defd0240859dd042fbc`.
Retained final build ID: `lb3QH7MZc7jhLkBhT6iau`. Reuse the final a6400e7d implementation/build/browser
evidence in [the final regression record](brownlow-eligibility-implementation-2026-10-20.md) and
[its results](evidence/final-local-regression-2026-10-20.json): final build/standalone, eight browser
checkpoints, admin 46/46 and settlement 73/73. No build/full suite/browser rerun was needed for this
documentation-only task. That build used isolated HTTP/config and is not production host acceptance.

Reuse populated-ledger rollback evidence at `a273b21a8952f91f279d6a18938a49d19be2dd9d` in
[the rollback record](rollback-populated-rehearsal-2026-10-20.md), strictly for 111–115 and that older
archive. It is not a 116/117 destructive rollback or a current-host restoration test. Migrations
111–115 are unchanged from the accepted earlier source; their exact paths were compared.

Writers stayed enabled during this inspection: the archive is a point-in-time rehearsal input, not
a permanent release baseline. Recheck live facts immediately before every future write; refresh backup,
restore/preservation and approvals on baseline/artifact drift. The correction runner requires capture,
restore and plan/approval times within its 24-hour window, restore after capture, exact target/revision
and matching baseline; this archive is not indefinite correction authority. Refresh after every covered
correction. Freeze-time recovery evidence and ISSUE-316 configuration changes need their own review.
Known full-workflow residuals (13,740 passed / 9 failed / 31 skipped), lint debt and strict Gridley
149 findings / 99 approved / 50 unapproved remain; no new adjudication or waiver is granted here.

The first remaining concrete prerequisite is owner review/merge reconciliation of the imported
ISSUE-316 work with its source branch, then C0 DEV sync and C1 retirement rehearsal under the
explicit owner authorities in ISSUE-316 §7 C0/C1. Those actions are not authorised here. D-316-1
for C2 is the next production sequencing approval after C0/C1, together with the separate coordinated
pause/recovery window. Artifact/build identity, live freshness, rollback, A-AFLT retirement and
new-writer activation remain distinct later gates. No production release command was executed.

Retained repository changes for the original inspection/rehearsal task were this plan,
`docs/v2/evidence/fresh-production-rehearsal-2026-10-21.json`,
`docs/v2/release-requirements-checklist-2026-10-20.md` and `CHANGELOG.md`. No application/tooling code
changed; ISSUE-316 and ISSUE-229 remain open with their existing decisions/next actions. No new defect
was asserted and no issue was resolved, so the open-issue index and detailed issue statuses are unchanged.
The subsequent owner-acceptance task adds the linked decision record, separate offline gate/result
and focused boundary tests, and updates this plan, checklist, go/no-go record and changelog. It
changes no application/schema code or issue status. No restricted raw data or inventory is committed.
