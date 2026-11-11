# AFLDB-ISSUE-336 — production runbook: the 35-row DraftGuru Pre-Draft insert (stage I336)

> **2026-11-08 review hold — CLEARED 2026-11-08:** the I336 run-name grammar fix is published at `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade` (fast-forward of `origin/main`). `tests/gap029-ops.test.ts` passed 76/76 at that exact revision, and §3 now pins it. D-336-2 execution still needs its own owner approval (section 0).

Prepared 2026-11-06. **Nothing in this runbook has been run against production.** Ledger entry: `issues.md` → AFLDB-ISSUE-336.
Evidence: `docs/v2/evidence/issue336-draft-categories-20261105/` (README §4 and `prod-tool-rehearsal/`).

## 0. What is decided and what is not

| Decision | State |
|---|---|
| D-336-1 accept the signing head `Intl Schol` | **Accepted** by the owner 2026-11-06; in the contract (`data/reference/draftguru-event-kinds.json`, `post_stage_a_additions`) and `GRID_SIGNING_KINDS`. |
| D-336-2 insert the 35 rows on production | **Steps A+B and C+D approved 2026-11-11**, with the packet's populated statements, to run after the application release passes acceptance (capture, restore, assembly, read-only plan). **E+F (apply) not approved**: it waits for the actual plan digest, backup hash and window (OD-4). |
| D-336-3 refresh the 187 revised origin paths | **Decided (A) 2026-11-11:** the stored values are kept and nothing is written. The classification and the 3 club replacements are carried to the next DraftGuru acquisition as **ISSUE-348**. **Classified 2026-11-11** against the owner CSVs: 174 school insertions, 7 junior-club insertions, 3 `Brighton` → `Brighton Districts & Old Scholars`, 3 genuine club replacements. Recommendation: (A) now, (B) at the next full DraftGuru acquisition, with the 3 replacements checked explicitly; (C′), 184 additive rows, only if an earlier correction is wanted. Evidence: `docs/v2/evidence/issue336-draft-categories-20261105/d3363-classification-20261111/README.md`. |

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

**End-to-end SIMULATION at R′ `c1c4b22e` (2026-11-11, closure run 8).** This closes the "not rehearsed" items above.
- **Setup:** the real wrapper in production mode against a simulated production host. That is a separate loopback cluster with its own system identifier, holding the same 2026-11-04 snapshot (`e77c307d…`); evidence class SIMULATION.
- **Capture:** `CAPTURE_COMPLETE`, actor 1 checked.
- **Sealed assembly:** `assemble --stage I336`, `ASSEMBLY_COMPLETE`.
- **Plan:** 35 to insert, 31 new persons, 0 present.
- **Refusals before approval, nothing written:**
  - apply without approval: exit 3;
  - wrong digest: exit 6;
  - wrong revision: exit 20;
  - stage or run mismatches and a malformed run name: exit 2.
- **Apply:** `COMMITTED_VERIFIED`; verify 35/35 with pre-existing rows unchanged; accepted.
- **After acceptance:** apply, capture and plan each refused with exit 21.
- **Found:** ISSUE-347. The GAP-029 *runner's* `prepare` cannot complete an I336 run (fixed-offset TAG; fix `2207986f`, unpublished). Steps 2–6 below use the direct scripts and are unaffected.
- **Exact command blocks and approval texts:** `docs/v2/issue336-d3362-approval-packet-2026-11-11.md`. Evidence: `docs/v2/evidence/issue336-i336-simulation-20261111/`.

## 3. Order of work (each line is a separate owner approval)

1. **Application release first** (recommended): the draft-page code and the `Intl Schol` Grid Solver option. The data step does not depend on it, but
   releasing it first means the new rows appear under the right category the moment they land.
2. **P1 capture (read-only on production):** from the pinned ops checkout at the merged revision R = `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade` (revised pin R′, published on `origin/main` 2026-11-08 and qualified there; see §6),
   `bash tools/v2/gap029-ops/prod-stage.sh preflight c1c4b22ee15007111eab66f6d354e0b9ecbb2ade I336`, then `bash tools/v2/gap029-ops/prod-stage.sh capture c1c4b22ee15007111eab66f6d354e0b9ecbb2ade I336` (one fresh `pg_dump` as
   `afldb_backup`; stops on any writer/timer conflict, ledger ≠ the profile's 118, or identity difference).
3. **P2 restore + assembly (streamanator, outside production):** `STAGE=I336 … bash tools/v2/gap029-ops/restore-assemble-host.sh` exactly as for S3
   (`docs/v2/gap-029-ordered-execution-handoff-2026-11-03-rev3.md` §9 P2-X), producing the sealed `backup.json`, `restore-evidence.json`.
4. **P3 plan (read-only):** `bash tools/v2/gap029-ops/prod-stage.sh plan c1c4b22ee15007111eab66f6d354e0b9ecbb2ade I336 RUN`. Read the summary: it must say 35 to insert, 31 new persons, actor 1.
5. **Approval (owner act):** `bash tools/v2/gap029-ops/prod-stage.sh approve c1c4b22ee15007111eab66f6d354e0b9ecbb2ade I336 RUN <digest> <statement file> <expires>`; the statement is generated
   from the plan and names D-336-2, the digest, the evidence hash, actor 1 and D-336-1.
6. **Apply (once):** `bash tools/v2/gap029-ops/prod-stage.sh apply c1c4b22ee15007111eab66f6d354e0b9ecbb2ade I336 RUN`, then `report`, `state`, `accept` (accept runs the read-only verify).
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
* **r2 (2026-11-06):**
  * the restart is the sudo-free `-RestartMethod respawn` (tooling `b82dfcea`);
  * the 2027 nightly account is corrected, and A3 states that the timers' next firings run the pin's code;
  * DEV's artifact is preserved and restorable without rebuild (R1);
  * the next nightly is recorded as pending observation.

  Evidence: `docs/v2/evidence/issue336-draft-categories-20261105/dev-procedure-corrections-20261106/`.
* Its backup has been rehearsed to `BACKUP-VERIFIED`, and rollback to `242fa276` has been proven on the 118 schema.
* Owner approvals A1–A4 are listed there.

**Deployed to DEV on 2026-11-07, immediate acceptance PASS.**
* DEV runs pin `8b024098` on branch `dev-v2-main`, with ledger 118 and build `AlYJjIargpO5esTkTX_zq`.
* The authenticated browser check passed 76/76, and the timers are unchanged.
* The 2026-11-08 nightly is pending observation.
* Record: `docs/v2/evidence/issue336-draft-categories-20261105/dev-deploy-20261106/README.md`.

This does not change sections 0–4. The production application release and stage I336 still need their own approvals.

## 6. Pre-implementation review hold — 2026-11-08

**Hold cleared 2026-11-08.**
- **Published:** the fix is commit `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`, on `origin/main` by fast-forward from `7fabc6e5` and approved by the owner. The commit holds only `prod-stage.sh` and the test.
- **Qualified:** in a fresh streamanator workspace cloned from GitHub and checked out at exactly that revision, `tests/gap029-ops.test.ts` passed **76/76**, with all 15 ISSUE-336 run-name cases run rather than skipped. Evidence: `docs/v2/evidence/open-issues-closure-20261108/i336-pin/`.
- **Pin:** step 4 below is done; §3 now pins R′ = that revision.
- **Still open:** D-336-2 execution approval, the nightly observation, the production application release, and D-336-3. No production approval is implied.

**Grammar fix implemented locally 2026-11-08 (uncommitted), awaiting user-executed verification.** One `STAGE_RE='(S[1-4]|I336)'` now feeds both `stage_arg` and `run_arg` in `tools/v2/gap029-ops/prod-stage.sh`. Test: `tests/gap029-ops.test.ts` "prod-stage.sh run-name grammar (AFLDB-ISSUE-336)" executes the real parsers under bash; run `npx vitest run tests/gap029-ops.test.ts` on Linux. Step 4 (revise the pinned revision) is still pending. **Severity: Medium (existing issue).** This section supersedes execution readiness of sections 3–4 until the wrapper defect is fixed and qualified. D-336-1, D-336-2, D-336-3 and all prior DEV evidence above are preserved; no production approval is implied.

Baseline: 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656; the affected source is identical at locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b. Source-established; no new reproduction or live observation.

### Evidence, trigger and impact

- tools/v2/gap029-ops/prod-stage.sh:63 accepts stage I336, but :64-66 requires run names matching ^S[1-4]-[0-9]{8}T[0-9]{6}Z$ AND the same stage prefix. No run can satisfy both conditions for I336.
- :175-198 capture generates RUN=$S-$STAMP at :183, hence I336-...; plan at :202 and subsequent approve/apply/report/state/accept commands call run_arg.
- Sections 3.2–3.6 above prescribe those real wrapper entry points. tests/gap029-ops.test.ts:184-190 tests I336 plan values, not this shell run-name lifecycle.

With a prepared I336 capture, the next plan step refuses before its substantive work. This blocks the prepared production procedure. It does not establish a partial data insert: the rejection precedes the stage tool. Earlier isolated tool/assembler rehearsal expressly did not rehearse a fresh production capture and sealed assembly, so that evidence is not contradicted.

### Root cause and smallest viable fix

The stage allowlist was extended without extending the run-name parser. Define the strict run grammar from the same allowed stage set (S1–S4 and I336), retain the exact stage equality and timestamp checks, and leave all identity, revision, backup, evidence, approval and one-apply gates intact.

### Proposed sequence and focused checks

1. Add a Linux shell wrapper contract to the existing tests/gap029-ops.test.ts home or closest shell harness. Use stub host commands and disposable paths to reach the actual run_arg boundary for all consumers.
2. Accept a capture-shaped I336 run for I336; refuse S1/I336 mismatches, bad timestamps, arbitrary prefixes and path traversal. Verify S1–S4 remain valid. Assert a refusal cannot invoke the stage writer.
3. Fix only the shared grammar. Qualify a complete stubbed capture → plan → approve → apply → report/state/accept dispatch. Stubbed approvals are test inputs, never production authorization.
4. Revise the pinned operational revision before proposing another production run. Only then seek the separate D-336-2 execution decision; pending nightly observation and D-336-3 remain outstanding.

Acceptance: every documented I336 wrapper command accepts its own valid run name and reaches the intended next gate; malformed/mismatched names refuse before mutation; no other production guard changes. Existing plan-value tests continue to pass.

### Failure handling, dependencies and decisions

Do not bypass prod-stage.sh by calling the underlying writer to work around this failure. Preserve any existing capture and assess freshness before reuse; do not repeat capture or apply automatically. A committed insert still follows section 4's no-retry rule. The grammar repair can be grouped with ISSUE-339 wrapper qualification, but neither grants production execution approval. Owner decisions D-336-2 and D-336-3 remain open. No code, host or database action was performed in this review.
