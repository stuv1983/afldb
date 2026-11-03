# V2-GAP-029 — ordered execution package: consolidated handoff (2026-11-03, revision 2)

Supersedes the staging in [`gap-029-d1-d5-handoff-2026-11-03.md`](gap-029-d1-d5-handoff-2026-11-03.md) (kept unchanged for its measurements and
production fingerprints). **Nothing was applied to production, DEV or any host. No importer dry run ran on production. No push, deployment,
restart, timer change, settle, grant or cleanup.** GAP-029 stays OPEN until the stages below are approved, run and accepted.

Owner decisions taken as given (not asked again): the eight Webster cells (D-GAP029-D4W, dated primary evidence added); the content of all eight
rookie selections including Rischitelli (Gold Coast 2018, pick 2) and Bryce Gibbs (Adelaide 2020, pick 1); the commissioning of guarded production
entry points; the preservation of the gate's production refusal.

## 1. Result on the production-derived chain (all stages, in order, on one disposable clone)

Clone `afldb_v2_gap029_chain_test` (isolated cluster `afldb_v2_isolated`, system id 7698245742874524392, OID 200441), created from the
production-equal restore. Stages ran in this order with the new tools, then `ANALYZE`, then the full corpus in diagnostic mode:

| Stage | Tool | Clone effect | Result |
|---|---|---|---|
| S1 captaincies | `gap029-captaincy-additions-production.ts` | captaincies 1,774 → 1,781 (batch 71) | plan 7 → apply 7 → replay "7 already present" → "nothing written" |
| S2 draft link-only | `gap029-draft-link-production.py` (**new**) | link columns only; draft picks linked 5 → 5,213 | gate plan clean → importer validate → **dry run (clone only)** → apply → gate VERIFY PASS (non-link digests unchanged) |
| S3 rookie selections | `gap029-rookie-selections-production.ts` (**new**) | draft_picks 6,810 → 6,818; 8 `data_overrides`; 8 `data_edits` (actor 1) | 31/31 controls, real apply, verify, replay writes nothing |
| S4 McGovern pair | `gap029-sibling-pair-production.py` (**new**) | `player_relationships` sibling rows 498 → 499; import_batches +1 | plan: exactly 1 new, 0 changed, 0 stale → apply → verify PASS |
| S5 policy/reference | files in Git (Webster D4W, Lyons D3) | none to any database | corpus conformance below |

**Final corpus (diagnostic; the production-derived register at 2026 as in the prior measurement):** 10,287 cells, 10,209 solved, 0 slow cells over 1 s.
Findings by category: time of board 23,530; list membership 1,232; external source disagreement 425; unsupported 78; adjudicated source conflict 63;
adjudicated key disagreement 54; **criterion disagreement 40** (32 Lyons + 8 Webster); source coverage gap **0**.

| Gate | Value |
|---|---|
| Strict corpus parity | **fails by design**: 118 strict findings retained transparently (78 approved deferrals + 40 approved criterion disagreements); `passed: false` |
| Approved policy conformance | **passed: true, 0 unapproved differences** (was 334 on production-derived data before this work; 8 after the previous stage) |
| Incorrect known answer (D5) | **0** (3 known-answer adjudications, all `current`: Cameron Bruce, David Swallow, Dylan Shiel) |
| McGovern `has_brother` cells | closed (not in the findings) |
| Webster 8 cells | counted as approved disagreements: 40 = 32 + 8; `dataMatches` 0 |

The corpus test file itself exits 1 in diagnostic mode because its zero-failure assertion counts the 40 approved criterion disagreements as findings; this is
the pre-existing strict gate and is not a regression (the previous clone run exited 1 with 32 + 8). Report sha256 `bcb1ad11…a388` (9.8 MB, outside Git);
a summary with the 40 cells is committed as [`evidence/gap029-final-20261103/corpus-summary.json`](evidence/gap029-final-20261103/corpus-summary.json).

## 2. Which stages are data-only and which need code

| Stage | Nature | Needs deployment/restart/build? |
|---|---|---|
| S1 captaincies | data (7 INSERTs) | **No.** Tool runs from a checkout at R. Public awards pages show the rows after ISR revalidation. |
| S2 draft link-only | data (link columns) | **No.** Python tool from a checkout at R. Draft pages are ISR. |
| S3 rookie selections | data (8 rows through the audited editor code) | **No application deployment.** The tool imports `src/db/queries/admin-draft.ts`, which was refactored this session (behaviour-neutral: the transaction body moved to `createManualPickInTransaction`; `createManualPick` still wraps it). The *running* build keeps its old copy, which is behaviourally identical; rebuilding is optional, not required. |
| S4 McGovern pair | data (1 row) | **No.** Existing loader, existing artefact. |
| S5 policy/reference | repository files only | **No.** `grep` of `src/` finds no consumer of `data/reference/gridley-*`; they affect tests and the corpus gate, not the served app. |

What *is* needed on the production host: its checkout must contain the reviewed revision R (the tools must be present and HEAD must equal R with a clean
tracked tree). That requires the local commits to be pushed and pulled, which is **not authorised here** and is your act; it involves no build and no restart.

Tests that cover the refactor and were run this session: `tests/integration/admin-draft.test.ts`, `sealed-editor-guard.test.ts`, `admin-draft-actions.test.ts`,
`data-overrides-source-contract.test.ts` (all passed on a fresh clone `afldb_v2_gap029_adm_test`), `v2-season-seal.test.ts` (55/55 after classifying the two new writers), `gridley-compat.test.ts`,
`gap029-rookie-selections.test.ts` (70/70 together); `tsc --noEmit` clean.

## 3. Replacement for the refused draft promotion (S2)

`tools/rebuild/draftguru/bridge_import_gate.py` is **unmodified** (sha256 `fbce43f7…558d`) and still refuses production: `TARGETS` = {test, dev}; no production key. A contract test
pins the file's hash, the closed target set and the absence of a production entry. The replacement does not edit, wrap or patch the gate: it imports the gate and the importer as libraries and
calls the gate's own `run_gate(..., link_only=True)` over a read-only connection that carries its own guards. The twelve safeguards it reproduces are recorded in every plan as `safeguards.G1…G12`:

| | Safeguard | Carried by |
|---|---|---|
| G1 | closed target, exact database, re-checked after connecting | reviewed target identity (host, port, database, user, system id, OID, cluster, comment) proved before any read and again on the write connection |
| G2 | read-only REPEATABLE READ SELECT-only session | `gate.open_read_only` / `gate.with_read_only`, asserted before any read |
| G3 | rollback and close unconditionally; nothing written to disk | `with_read_only`; tool writes only its own exclusive output outside the checkout |
| G4 | no DSN/credential printed | refusals name a class, never a DSN |
| G5 | child sha256 pinned, kind, schema, label | `load_child` with a required `--child-sha256` and label `isolated` |
| G6 | the test child can never be reused | `refuse_test_child_under('dev', child)` |
| G7 | parent chain verified | pinned v3 parent sha256 `1f7413a2…e21b` |
| G8 | explicit label proven against every stored identity note; no Stage A | explicit `--label` required; importer `validate_link_only` |
| G9 | write set is exactly the link columns | gate plan, compared to the importer's `link_only_write_set()` |
| G10 | zero gate failures | any failure refuses |
| G11 | verify re-reads non-link digests | the gate's own VERIFY against the plan's hashes and `batches_before` |
| G12 | deterministic | plan re-run at apply; every hash must equal the plan |

Added for production: digest-sealed plan, approval pinned to plan digest, target, revision, child sha, label and expiry; HEAD must equal the plan's revision with a clean tree; importer and gate bytes must equal
the reviewed hashes; fresh backup and restore evidence (24 h); **the importer's dry run is refused on any target that is not an `afldb_v2_*_test` clone** (it retains a failed audit batch, which is a write) —
negative control: dry run against a production-named target refuses before any connection. Rehearsal controls on the clone (10/10): wrong child sha, missing label, wrong-stage label, the afldb_test child,
dry-run-on-production-named target (twice), clone without `--rehearsal`, tampered plan, revision-edited plan, baseline drift after planning (state restored afterwards).

**Limitation, stated plainly:** the importer commits in its own transaction, so a gate VERIFY failure *after* commit cannot be rolled back by this tool. It prints `RESTORE REQUIRED` and exits 1; recovery is restore of the
verified backup (no inverse tool exists), which is why a fresh restore-verified backup is a precondition of the production plan.

## 4. The rookie entry point (S3), in one paragraph

Existing audited admin mutation (`createManualPickInTransaction`), one `afldb_import` transaction under REPEATABLE READ: prove identity → `assert_viable_super_admin_actor(id)` (migration-105 function: enabled, fully enrolled,
non-fixture Super Admin; row-locks FOR SHARE) → baseline digest → per-entry resolution → editor writes with a built sealed-season correction note (≥ 20 chars; V2-GAP-006 seals 1897–2026) → named post-write checks (exactly 8 new rows
with reviewed content, 8 new overrides, audit sequence +8, every pre-existing `draft_picks` row byte-identical) → commit. Any non-ok editor result throws and rolls back all eight. No synthetic actor, no user created, no grant, no
guard bypass. Refuses: identity ≠ reviewed id, same player/year/kind with different content, a pick number held by another player, ambiguous player/club, drift, stale plan, wrong writer role. Provenance preserved in `detail`:
draft event year and first playing season are separate fields (`draft event year=2018; first playing season=2019`); six pick numbers `primary`, **Rischitelli and Gibbs `secondary`** and never relabelled.
Clone result: actor 1; 8 `data_edits` rows (ids 168–175 on the clone, note lengths 196–213); 31/31 controls.

## 5. Approval inputs you must supply (apply to S1–S4 alike)

Per stage the tool needs: `target.json` (the reviewed production identity: host, port, database `afldb_prod`, user `afldb_import`, systemIdentifier `7674454702926115004`, databaseOid `66668`, clusterName, databaseComment — read-only),
a **fresh** backup (`backup.json` with `target`, `sha256`, `restoreEvidenceSha256`, `capturedAt`, `restoredAt`, `baselineDigest`) and its restore evidence from a guarded off-production restore verification (the Block L scripts under
`docs/v2/evidence/gap029-block-l-20261102/scripts/` are the template), then your approval JSON. Two of the new tools additionally require restore-derived fields **inside `backup.json`**:

* S2: `draftLinkRestorePlanExpect` = the four values `{after_state_sha256, picks_after_sha256, newly_linked_sha256, baseline_sha256}` obtained by running `plan --rehearsal` against the *restored copy* with a child exported against that restore. The production plan refuses unless production's own plan equals these.
* S4: `siblingContentDigest` = `before.contentDigest` from `plan --rehearsal` against the restored copy; plus `--expect-after-content-digest d6fceb338d5f37e8fdef18443da696c52225db9caa80cedb9261e401aea212ec` (the value rehearsed here).

No host script assembles these two fields yet; that is a manual step (or a small follow-up) and is listed under limitations. The actor for S3 is `auth_users.id 1` (the lowest enabled, enrolled Super Admin on the production-equal restore):
**you must confirm that is the person who is accountable for the entries**; the apply re-asserts viability and refuses otherwise.

## 6. Ordered execution, with copy-ready approvals

Order: **S1 → S2 → S3 → S4 → S5**. S3's baseline is independent of link columns, so S2/S3 may be reordered; S1 first keeps the corpus comparable. Run each stage as baseline/plan → your approval → apply → verify → `ANALYZE`,
with the stage's own fresh backup, or one backup spanning all four if you accept a single rollback point (the tools each bind the backup's `capturedAt` within 24 h). All commands are owner-run; none was run against production.

Revision R is the commit that carries this handoff (`git rev-parse HEAD` at plan time; the code files below are byte-identical to those rehearsed at `d3a13fc3`; only documents, tests and tracking were added after it).

**D1-PROD (S1).** "Apply, once, to `afldb_prod` (OID 66668, system identifier 7674454702926115004), the digest-pinned plan for evidence sha256 `f88f5524…` (full value in the evidence file), exactly the seven co-captain rows in §3 of the 2026-11-03 handoff, using revision R, after a fresh verified backup. Nothing else."

**D2-PROD (S2).** "Apply, once, to `afldb_prod` the link-only DraftGuru promotion through `tools/v2/gap029-draft-link-production.py`, for the child sha256 pinned at plan time (exported against the fresh restore), label `annual-html-20260826`, parent sha256 `1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b`, importer sha256 `f23e7646…40e1`, gate sha256 `fbce43f7…558d`, expecting the after-state values equal to the restore's plan (rehearsed: after-state `a186c592…620e`, picks `a56ca83d…78b3`, newly linked `d4a65f47…afca`, baseline `2618bcf9…c44d`). No production dry run. Recovery is restore of the verified backup."

**D3-PROD (S3).** "Apply, once, to `afldb_prod` the digest-pinned plan for evidence sha256 `d1740b8f65429aa32bea8b93a1f63d302674eb79bbc6e7195153d315310e6b6f`: exactly the eight manual rookie selections (Schneider 2014 St Kilda #54; Henderson 2019 Geelong #35; Davis 2022 GWS #3; Reid 2023 Sydney #11; Taylor 2021 Sydney #10; Seedsman 2022 Adelaide #21; Rischitelli 2018 Gold Coast #2 — pick number secondary-sourced; Gibbs 2020 Adelaide #1 — pick number secondary-sourced), through the audited editor path, as actor `auth_users.id <confirmed>`, using revision R, after a fresh verified backup. Nothing else."

**D4-PROD (S4).** "Apply, once, to `afldb_prod` the digest-pinned plan adding exactly `siblings:afldb-sibling-supplement:015` (Jeremy McGovern 6937 / Mitch McGovern 9714) through `family_siblings.py load`, artefact sha256 `b1f0ff4e…d318`, loader sha256 `6f1ce059…fd42`, expecting content digest `d6fceb33…12ec`, with zero changed and zero stale rows. Nothing else."

**D5-PROD (S5).** "Include `data/reference/gridley-sibling-eligibility-webster.json` (sha256 `dd1b4705…9e27f`) and the `D-GAP029-D4W` entry in `gridley-approved-sibling-disagreements.json` (sha256 `d6bba75b…f738`) in the pushed revision. No database or deployment effect."

## 7. Hashes (sha256, full)

| File | sha256 |
|---|---|
| `tools/v2/gap029-rookie-selections-production.ts` | `a4d69eb29a1ce553f189d3ff10fc2b0cfa66982fb46acd385ca9a16af35c2d56` |
| `tools/v2/gap029-draft-link-production.py` | `28aa2a8a8f6c90747dc32cae3486bbcd303aa849cb40de604fe4193258707763` |
| `tools/v2/gap029-sibling-pair-production.py` | `1cc03a2414eaa41883643df3056cf04075886d7d2125568cb1536dc123d07c0b` |
| `tools/v2/gap029-captaincy-additions-production.ts` | `5df20d56b0278c0c3a0cf81c154c70942d5a2c7bedec7d5ec108a8aca386ac38` |
| `tools/rebuild/draftguru/bridge_import_gate.py` (unmodified) | `fbce43f7f1e374b3dfac05968e627b8ad9f337279f233a49bc19ff57d02d558d` |
| `tools/rebuild/draftguru/import_draftguru.py` | `f23e76464818e9109f46004812dc65354c280ae1361a9ebe9fef59493d5540e1` |
| `tools/migration/family_siblings.py` | `6f1ce0597cc833f289b69fa3e065d72a2d03dcba0ec52c7c0c5703ed5a27fd42` |
| `data/players/sibling-relationships.csv` | `b1f0ff4ed0bfcf23b53fc8e0007c08ffee636cfd7077b39c3d07aa3b842bd318` |
| `docs/v2/evidence/gap-029-rookie-selections-2026-11-03.json` | `d1740b8f65429aa32bea8b93a1f63d302674eb79bbc6e7195153d315310e6b6f` |
| `data/reference/gridley-sibling-eligibility-webster.json` | `dd1b47050f39bd265b40a4ea972742649b8371d0c909fb46f17fc66b43a9e27f` |
| `data/reference/gridley-approved-sibling-disagreements.json` | `d6bba75ba612398bead94785ecae27e1d24634439c955b0d4db12a043e10f738` |
| parent bridge `draftguru-person-bridge-20260918-v3.json` | `1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b` |
| chain-clone child (rehearsal only; regenerate against the fresh restore) | `3ac793c85406c1487e1bab2e075d50802f14579d0c26b31394f92cd9529e4926` |
| corpus report (outside Git) | `bcb1ad11b3e774dc4f3255b4d08d17ffc2cbf57450d3fa2c622c3d30de76a388` |

Local commits this session (none pushed): `5a7ed19e`, `08786294`, `8d5c9915`, `ce684631`, `618df01c`, `674816c9`, `f9ec51a7`, `d3a13fc3`, and the commit carrying this document. Evidence copies: `docs/v2/evidence/gap029-final-20261103/`.

## 8. Webster, as approved and as limited

Eight cells (920/2-2/2020s, 929/2-2/goalscareerlessthan20, 964/2-1/marks10match, 990/2-2/2020s, 990/2-1/goalscareerlessthan20, 1073/2-2/2020s, 1109/2-2/finals1, 1109/2-1/woodenspoon; row `brother`), identity Jimmy Webster
(Gridley player 3989, AFLDB 7271), predicate `player_career_stats.games > 0` unchanged. The matcher requires profile + Gridley player id + cell + the sole lacking builder `has_brother`; neighbouring cells, other identities,
changed predicates and changed evidence are rejected (12 mutation controls plus the Lyons/Webster cross-identity control, `gridley-compat.test.ts`). Evidence tiers are kept apart in the file: the dated afl.com.au statement (Zac Webster played no senior game in three Hawthorn seasons before delisting),
the relationship evidence, the registration evidence, and the broader career inference (not stated as fact). No participation record was added and the sibling criterion was not weakened.

## 9. Remaining limitations (not hidden)

1. **Linux qualification was not run.** The new Python/TypeScript tools and suites ran as processes on this Windows workstation against the isolated PostgreSQL cluster at 127.0.0.1:55432; I did not execute them on the Linux host. The tools use no OS-specific behaviour I know of, but that is unproven. Nothing from the earlier Linux evidence is claimed for the new files. Needed: run `gridley-compat`, `gap029-rookie-selections` and `tests/integration/admin-draft.test.ts` on the authorised Linux host.
2. **WSL store touched, then stopped.** To look for a Linux environment I started `AFLDB-V2-Rehearsal-20261020` (which the Linux-verification record lists as *not an authorised target*) and ran `uname`, `node -v`, `python3 -V` and `ls /home` in it; I wrote nothing, and terminated the distro afterwards (`Stopped`). I should not have started it without asking.
3. **Post-commit recovery is restore, not rollback,** for S2 (importer commits itself) and S4 (loader commits itself); S1 and S3 verify inside their transactions and roll back.
4. **Audit-count verification needs an audit-capable role** (`AFLDB_GAP029_AUDIT_DSN`); `afldb_import` cannot read `data_edits`. The action-layer `audit()` log is not written by the tool (the `data_edits` row is).
5. **Backup JSON fields for S2/S4** (§5) are assembled by hand; no host script yet.
6. **Evidence strength.** Rischitelli and Gibbs pick numbers are secondary-sourced (no primary article states the pick); Gibbs has no official AFL/club article found for the re-draft pick number itself. The entries say so and the approval statement repeats it.
7. **Strict parity stays failing** (118 findings) and the corpus test file exits 1 in diagnostic mode; both are the accepted, documented state, not a defect.
8. **Production-only unknowns.** The production sibling content digest and `import_batches` count are assumed equal to the clone's starting state (the prior read-only fingerprints agreed for the draft/captaincy surfaces); the S4 plan refuses if they differ.
9. The corpus ran with the register at 2026 as before; no DEV or PROD page smoke is claimed (ISR, not measured).
