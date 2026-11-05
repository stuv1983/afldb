# AFLDB-ISSUE-336 — production runbook: the 35-row DraftGuru Pre-Draft insert (stage I336)

Prepared 2026-11-06. **Nothing in this runbook has been run against production.** Ledger entry: `issues.md` → AFLDB-ISSUE-336.
Evidence: `docs/v2/evidence/issue336-draft-categories-20261105/` (README §4 and `prod-tool-rehearsal/`).

## 0. What is decided and what is not

| Decision | State |
|---|---|
| D-336-1 accept the signing head `Intl Schol` | **Accepted** by the owner 2026-11-06; in the contract (`data/reference/draftguru-event-kinds.json`, `post_stage_a_additions`) and `GRID_SIGNING_KINDS`. |
| D-336-2 insert the 35 rows on production | **Prepared, not approved for execution.** The approval below is a separate owner act. |
| D-336-3 refresh the 187 revised origin paths | Open; not part of this runbook (recommend only a full DraftGuru re-acquisition and keyed reload, whose `EXPECTED_ROWS = 6810` would need updating). |

## 1. What the write is

Tool `tools/v2/issue336-predraft-insert-production.ts`, run through the reviewed V2-GAP-029 operations framework as stage **I336** (no predecessor
stage). In ONE transaction as `afldb_import`: 35 `draft_picks` rows (source `draftguru`, `Pre-Draft`, `pre_draft`, no pick number, the importer's own
reload key and `source_record_id`), 31 new **unmatched** `draft_persons` rows (4 person URLs already stored keep their rows and links, 2 of them linked
to players 8331 and 5867), and one `data_edits` row per pick through `recordDataEdit`, judged by the V2-GAP-006 season seal (2008-2025 are sealed) as an
audited correction by actor `auth_users.id 1`. No override, no update, no delete. Evidence pinned: `predraft-insert-plan.json` sha256 `6a207cfe…11cb`.

## 2. Rehearsed (isolated clone of the 2026-11-04 production dump, streamanator, revision 09acd432)

Production-mode run on an isolated clone refused; non-viable actor refused before mutation; plan 35 to insert / 31 new persons; apply
`COMMITTED_VERIFIED`; 35 audit rows by actor 1, seal basis `audited_correction` × 35; verify 35/35 with every pre-existing draft row unchanged; state
`PLANNED RESULT PRESENT`; replay refused on baseline drift; reconciliation afterwards 5,966 = 5,966 with 0 per-(year, category) differences. The
assembler's I336 derivation (`baseline --rehearsal`) produced the stage fields. **Not rehearsed:** a production capture and a sealed `assemble --stage
I336` (the only dump available is older than 24 hours, which the assembler correctly refuses); these are the unchanged GAP-029 steps with the stage
constant added.

## 3. Order of work (each line is a separate owner approval)

1. **Application release first** (recommended): the draft-page code and the `Intl Schol` Grid Solver option. The data step does not depend on it, but
   releasing it first means the new rows appear under the right category the moment they land.
2. **P1 capture (read-only on production):** from the pinned ops checkout at the merged revision R,
   `bash tools/v2/gap029-ops/prod-stage.sh preflight R I336`, then `bash tools/v2/gap029-ops/prod-stage.sh capture R I336` (one fresh `pg_dump` as
   `afldb_backup`; stops on any writer/timer conflict, ledger ≠ the profile's 118, or identity difference).
3. **P2 restore + assembly (streamanator, outside production):** `STAGE=I336 … bash tools/v2/gap029-ops/restore-assemble-host.sh` exactly as for S3
   (`docs/v2/gap-029-ordered-execution-handoff-2026-11-03-rev3.md` §9 P2-X), producing the sealed `backup.json`, `restore-evidence.json`.
4. **P3 plan (read-only):** `bash tools/v2/gap029-ops/prod-stage.sh plan R I336 RUN`. Read the summary: it must say 35 to insert, 31 new persons, actor 1.
5. **Approval (owner act):** `bash tools/v2/gap029-ops/prod-stage.sh approve R I336 RUN <digest> <statement file> <expires>`; the statement is generated
   from the plan and names D-336-2, the digest, the evidence hash, actor 1 and D-336-1.
6. **Apply (once):** `bash tools/v2/gap029-ops/prod-stage.sh apply R I336 RUN`, then `report`, `state`, `accept` (accept runs the read-only verify).
7. **After:** read-only reconciliation against the CSVs (expect 5,966 = 5,966), the production draft pages for 2008 and 2025, and close D-336-2.

## 4. Recovery

Outcomes and exit codes are `tools/v2/gap029-common.ts`'s. A refused or rolled-back run wrote nothing. A committed run is never retried, reversed or
restored by the tools; restoring the stage backup would discard every later write and is a separate owner decision.

## 5. DEV status (2026-11-06): not deployed; isolated preview verified

The owner chose to push, merge and deploy to DEV. Before any DEV change I found DEV's checkout 18 commits ahead of origin (`242fa276`, all already in the
archived source repository) and its database 8 migrations behind, so a plain `sync-dev.ps1` would fail its fast-forward and would migrate the live DEV
database. On the owner's instruction DEV was left unchanged and ISSUE-336 was verified through an isolated preview on a restore of DEV's own data at
`ea9bddf8`: migrations 111–118 apply cleanly; the focused draft tests and browser checks pass apart from failures shown to be data-dependent (identical at
base) or pre-existing (AFLDB-ISSUE-337); DEV health is identical before and after. The recommended primary-DEV procedure (timer pause, restore-verified
backup, a new local branch tracking `origin/main` with local `main` kept, `sync-dev.ps1`, `db:privileges`, smoke, timers resumed) and its recovery are
in `docs/v2/evidence/issue336-draft-categories-20261105/dev-preview-20261106/README.md` §4. **Any live DEV migration or replacement is a separate owner
approval.** Production application release and the I336 data step are unaffected by this and still need their own approvals.

**Superseded for DEV (2026-11-06, follow-up):** the single DEV procedure is now `issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md`.

* It is pinned to `8b024098`, which adds the ISSUE-337 fix and `sync-dev.ps1 -ExpectedRevision`.
* It needs no timer pause, no sudo and no unit change.
* Its backup has been rehearsed to `BACKUP-VERIFIED`, and rollback to `242fa276` has been proven on the 118 schema.
* Owner approvals A1–A4 are listed there. Nothing has been run on DEV.
