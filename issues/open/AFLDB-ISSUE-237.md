# AFLDB-ISSUE-237 — Preserve importer-created AFL API `unique` identities across rebuild and promotion

## 0. Status

**Open. Plan reviewed 2026-09-24. Operator decisions OD-1…OD-5 recorded 2026-09-24, and
corrected the same day (revision notes 3–4). OD-6 approved 2026-09-24 (§15). S1–S7 are
authorised as the non-destructive implementation phase, within the §8 boundaries: S3 is gated by
P-M, and L3–L5 are blocked until R1 passes. P-M point 2 is PROVEN (2026-09-24, operator-run live
evidence, §11(d)2); S3 implementation is now in progress.** No database has been rebuilt or
promoted.

**L1/L2 state (operator-run, reported 2026-09-25).** The §11b rehearsals on the real
`code_test_db` have now been run by the operator. **L1 PASS:** non-empty importer + human state
survived a full destructive rebuild. **L2/recovery PASS:** Stage 2 capture → marker set → real
`RESET_SQL` → marker survives → `--recover` adopts the original pending capture → Stage 18
restores identities → marker clears transactionally → Stage 19 invariant passes. **P-M point 3
is PROVEN.** Rehearsal teardown/residue also PASSED with zero residue. L1/L2 are not to be re-run.
S6 (§10) status and the 2026-09-25 failure dispositions: §10.1. The paragraph below is the
pre-rehearsal record, kept for history.

**OD-4 recovery state (2026-09-25).** **R1 PASS, R2 PASS** (operator-run): the dump is now the
authoritative pre-I18 backup. It is restored read-only as `issue237_r1_restore`, and its census is
802 rows, 3/129/397/273. **R3 was BLOCKED** because no executable export CLI existed. **The R3 CLI
is now implemented** (`npm run db:issue237:export-importer-recovery`), but **live R3 has NOT been
run**. R4 and R5 are not started. Details are in §11a.1.
*(Superseded 2026-09-25: the first live R3 run **FAILED**, correctly, under the literal D7 rule. It
refused four providers whose players each hold an exact tracked `profile_url_continuity` pair. The
operator approved the narrow D7 continuity amendment (§4 D7, OD-7). It is implemented and DB-free
tested. **R3 is pending a rerun; it is NOT PASS.** R4 is not started. See §11a.1.)*
*(Superseded 2026-09-25: **R3 PASS** (operator-run rerun): 802 rows / 802 providers / 802 stable
identities, 3/129/397/273, payload SHA256 `3cfad942…bcb9b`, file SHA256 `870EA366…75D35` (full
values in §11a.1). The S6 live integration filter is **9/9 PASS**. The reverse direction of the
continuity amendment is now fail-closed too (§4 D7): a continuity identity resolves on a target
only when both rule paths name the same single player. That tightening is DB-free tested only.
**R4 is NOT started.** ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: the **reverse continuity guard is COMPLETE** (DB-free). **R3 is PASS.**
The **R4 CLI is implemented** (`npm run db:issue237:recover-importer-identities`, §11a.2) and
DB-free tested. **Live R4 is NOT RUN**: validate-only, dry-run and apply are all operator-run and
still to come, so R5 is not started either. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: R4 validate-only FAILED, correctly. The 92 unresolved identities are the
ISSUE-224 S9 cohort that the I18 rebuild dropped (§11a.2.1). **R4 is BLOCKED.** Re-registration
is blocked by 0 `auth_users` on `afldb_test`. A recovery attribution actor CLI is now implemented
and DB-free tested, but **NOT live-run** (§11a.2.2). ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: **R4 COMPLETE and R5 PASS** (operator-run, §11a.2.3). The actor (id 144,
disabled, no credentials) exists for recovery attribution only. The 92 ISSUE-224 registrations
are restored as players 13857–13948. R4 ran validate-only, then dry-run, then apply, and all
three PASS: 802 inserted and COMMITTED. Post-commit parity and invariant PASS, and an independent
re-run found 802 already identical and 0 to insert. **The 2026 matches and statistics are NOT
restored.** The remaining-gate reconciliation is §11a.3:

- **L3 is blocked by AFLDB-ISSUE-245** (rebuild durability of manual registrations and
  `data_overrides`). *(2026-09-25: ISSUE-245 is implemented, DB-free tests only; L3 stays blocked
  until its `code_test_db` rehearsal passes — see the §11a.3 annotation.)*
- **L4 and L5** follow L3.
- **S5 is incomplete:** `docs/deployment.md` §6a.

ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: **AFLDB-ISSUE-245's `code_test_db` rehearsal is PASS** (operator-run,
§11a.5). **The L3 blocker is CLEARED.** The `settle-afl-api.test.ts -t "AFLDB-ISSUE-237"` rerun
§11a.3 recommended is PASS, 9/9, against the live populated `afldb_test`. **The exact guarded L3
operator sequence is now written, §11c. L3 itself is NOT RUN.** ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: **L3 PASS** (operator-run, §11a.6). The real destructive `afldb_test`
rebuild carried 802 importer identities (3/129/397/273) and 92 manual registrations across a
real surrogate renumbering (diagnostic `players.id` 13857–13948 before, 13272–13363 after).
Final validation passed 85 checks; the post-L3 source census and the `settle-afl-api` filter
(9/9) pass; no marker and no pending capture remain. **AFLDB-ISSUE-245 is RESOLVED** on that
evidence (§11a.6). §11c's DraftGuru label was wrong and is corrected (`annual-html-20260826`).
**L4 is prepared, NOT RUN** (§11d). Source inspection found three HIGH findings in the
promotion checker's `afl_api` gates, and they condition L4 (§11d.0). **L5 is NOT RUN.** The 2026
current-season corpus is still not restored on `afldb_test`, which is not an L3 failure.
ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: **the L4 hardening is implemented and DB-free validated** (§11d.0,
§11d.9). F-L4-1 (the marker read), F-L4-2 (G2 now reads the candidate importer rows against the
TARGET ledger), F-L4-3 (`--phase candidate` verifies the reinstated target ledger against the
bound file), F-L4-4 (the `E_promotion` file is written only on PASS, atomically, bound, and verified
by the post-swap replay) and F-L4-5 (a DEV regeneration generator) are fixed; F-L4-6 was a
documentation error and is corrected. **§11d is rewritten** from the corrected code, and it works
with an empty or non-empty DEV ledger. **L4 and L5 are NOT RUN.** All code is uncommitted.
ISSUE-237 is not resolved.)*

**Current gate state (2026-09-25):**

| Gate | State |
|---|---|
| R1–R5 (L0) | PASS (§11a.1, §11a.2.3) |
| P-M | PASS (points 1–4; point 3 by L2) |
| L1 | PASS |
| L2 | PASS |
| ISSUE-245 blocker on L3 | CLEARED (§11a.5) |
| ISSUE-245 `afldb_test` proof | PASS, through L3 (§11a.6) |
| L3 | **PASS** (§11a.6) |
| L4 DEV promotion | **NOT RUN.** Procedure rewritten after the L4 hardening (§11d; findings and fixes §11d.0, prerequisites §11d.2). *(2026-09-25: the second real attempt STOPPED at A4.3, before the destructive boundary. A3 PASS; the blocker is the orphaned ISSUE-109 fixture override; prerequisite **AFLDB-ISSUE-246**, §11d.12.)* *(2026-09-25: ISSUE-246 RESOLVED, audit 983; the A4.3 rerun returned no rows, so A4.3 is PASS; A3/A4.1/A4.2 unchanged; next step **A5**, §11d.13.)* *(2026-09-25: **A5 REFUSED on TWO independent gates**: the ISSUE-151 staged-rows gate on the legitimately empty `afl_api_identity_adjudications` ledger (0; census 669/0/0/0 PASS), prerequisite **AFLDB-ISSUE-247**; and the test-fixture identity gate on reserved-domain `auth_users` 14/17/18 and `admin_invites` 5, prerequisite **AFLDB-ISSUE-248**. Nothing past A5 ran. §11d.14.)* *(2026-09-26: a post-merge attempt reached the post-swap phase and was ROLLED BACK on discovering **AFLDB-ISSUE-249** — the promoted candidate held first-kick-goal 0 against DEV's 335/334. `afldb_dev` restored; failed candidate retained as `afldb_dev_candidate_20260926-033212`.)* *(2026-09-26: **L4 PASS** (operator-run, stamp `20260926-085511`), after AFLDB-ISSUE-249 was deployed at `6ae70722`. G3 found one classified DEV-regenerable hard loss, `CD_I297354`, resolved through the §6.3 exception (fresh re-acquisition, target-bound bridge 669/669, loader apply, `dev-regeneration-census` PASS). Post-swap first-kick-goal census 335/334/1. Full record: §11d.15.)* |
| L5 PROD promotion | **NOT RUN** |

**P-M state (2026-09-24).** Point 1 PROVEN (DB-free). Point 2 PROVEN (live, `afldb_test`,
rolled back). Point 4 PROVEN by composition. **Point 3 is NOT PROVEN** *(superseded 2026-09-25:
PROVEN by L2, above)*. The L1/L2 procedure
review found two testability gaps: no deterministic `code_test_db` fixture seed, and no
deterministic supported halt after `recreate` (an operator-timed Ctrl+C is not a procedure).
Both are now closed in code: the rehearsal fixture
(`tools/migration/afl_api_identity_rebuild_rehearsal_fixture.ts`) and the `code_test_db`-only
`--rehearsal-stop-after recreate` control. The prepared L1/L2 commands are in §11b.
**Nothing in §11b has been run.** *(Superseded 2026-09-25: L1 and L2 have been run, both PASS.)*
**Severity:** Medium. **Tier:** T3 (rebuild tool, promotion checker, pure module, D15 adapter,
one-off recovery tool, docs).
**Area:** promotion and rebuild lifecycle: `external_identities` (`afl_api`),
`tools/db/rebuild-test.ts`, `tools/migration/rebuild_afl_api_adjudications.ts`,
`tools/migration/replay_afl_api_adjudications.ts`, `src/lib/acquisition/afl-api-adjudication.ts`,
`tools/db/promotion-check.ts`, `docs/production-promotion.md`.

This issue was opened on 2026-09-23 from AFLDB-ISSUE-235 review finding R4. The gap is
pre-existing and does not depend on ISSUE-235.

**Revision note 1 (2026-09-24 review).** The first draft of this runbook was a proposal. The review
kept its no-surrogate-id rule (draft D2), its capture-is-not-evidence rule (draft D3) and its
fail-closed intent (draft D5). It replaced its promotion model (draft D4). There is **no
importer-identity replay in promotion**. Importer rows reach a promotion inside the rebuilt dump, as
every other import-writable table does. The real promotion hazard is a *post-swap* D15 STOP, and
the draft did not see it.

**Revision note 2 (2026-09-24, operator decisions).** This revision applies OD-1…OD-5 (§15):

- **OD-1:** fail closed; no withhold mode (D7).
- **OD-2:** the one D15 supersede transition, and nothing wider (D9).
- **OD-3 (modified):** production hard loss is FAIL; a narrow DEV-only exception (D14, §6.3).
- **OD-4:** `afldb_test` coverage is recovered through stable identity from a pre-I18 state once
  that state is proven authoritative (R1), never from old bridge artefacts (§11a).
- **OD-5:** the artefact hardening is the successor **AFLDB-ISSUE-241** (§12).

It also:

- brings F5 into scope (D11);
- corrects the terminology (D1);
- corrects the rebuild stage ordinals (F13);
- corrects the two documents that described a bridge re-run as recovery (F3).

**Revision note 3 (2026-09-24, operator correction before implementation authorisation).**

- **The expected supersede set** *(superseded by revision note 4: the rebuild now requires
  `E_rebuild = ∅`, and only promotion uses a non-empty exact set)*. Revision 2 said Stage 18 "D15 replay; the superseded count must
  be 0". That contradicted OD-2/D9. Stage 18 now derives the exact expected supersede set `E` from
  the combined capture **before mutation**, and the D15 replay must produce exactly `E`. A
  missing or extra supersede is a hard STOP that rolls back Stage 18. Promotion uses the same rule,
  with `E` = G2's AGREE list (D9, D13, §6.1, §6.2).
- **Marker survival** is no longer assumed. It is prerequisite P-M, which gates S3 (D11d).
- **The I18 dump** is called the **candidate** authoritative pre-I18 backup until R1.1–R1.5 prove
  it (§11a).
- **OD-6 was open** (approved in revision note 4). It was raised because Stage 2's current checks make `E` empty for every capture
  they accept (§15).

**Revision note 4 (2026-09-24, OD-6 approved: keep the Stage 2 refusal).**

- **The two lifecycles are now separate.** Revision 3 treated them as one expected-set rule. They
  share only the agreement predicate; their semantics differ.
- **Rebuild.** An importer/human overlap is **invalid, pre-existing broken state**. Stage 2 STOPs
  before destruction on it. For an accepted capture, `E_rebuild = ∅` is an invariant. Stage 18
  re-derives and checks it before any mutation. Expected and actual rebuild supersedes must both
  be empty; anything else is a hard STOP and rolls back. There is **no** supported rebuild path
  that carries the overlap across the reset.
- **Promotion.** `E_promotion = G2.AGREE` may legitimately be non-empty. The post-swap replay must
  supersede exactly that set, under the D9 conditions including "remapped player agrees".
- **Where it applies.** D8, D9, D11c, D13, §6.1, §6.2, §9, §13, §14 and §15 are revised to match.
- **Authorisation.** S1–S7 are authorised (non-destructive) once this correction is made.

§1 lists the findings, and §4 gives the resulting decisions.

---

## 1. Review findings (2026-09-24), most severe first

| # | Grade | Finding | Evidence |
|---|---|---|---|
| F1 | HIGH | **The draft's promotion model is wrong.** `external_identities` is import-writable, so its treatment is `rebuilt`: the candidate keeps the **rebuilt source's** rows from the dump (§1 of the promotion doc). The importer has no PROD target by design, so production's own importer can never write a row there. "Capture from the replaced live database and replay" would therefore carry nothing to production. The only carrier into production is the rebuilt `afldb_test`. Fixing `db:test:rebuild` fixes promotion's input. (Correction F14: *promoted* importer rows do land in production, and G3 must protect them.) | `docs/production-promotion.md:50-55,90`; `import_afl_api_player_bridge.py:152-174` (closed `TARGETS`, no PROD) |
| F2 | HIGH | **Post-swap STOP hazard.** Once a candidate carries importer rows, the ISSUE-235 D15 replay STOPs on **any** existing row for a provider the target's human ledger links. That includes an importer row that points at the *same* player. The replay runs in §8 step 1, **after the swap**, so a live database would be left without its human identities. The trigger is realistic. A human can link only a provider that the target's importer never linked (T2/T3 refuse otherwise), and the rebuilt source's bridge may well have linked that same provider. | `afl-api-adjudication.ts:794-801`; ISSUE-235 D15 table (`issues/closed/AFLDB-ISSUE-235.md:1437-1445`); `docs/production-promotion.md:719-751` |
| F3 | HIGH | **Re-running bridge artefacts after a lifecycle is not a safe recovery.** Three of the four evidence classes carry a bare, database-local `candidate_player_id` with **no** `built_from_database` and no lineage gate. The loader checks provenance only for `afl_api_stat_vector_season`. After a renumbering reset, `--apply` would link each provider to whatever player now holds that integer. For the season class, validate-only proves nothing about which person an id names. **Two documents described a bridge re-run as the recovery. Both are corrected in this revision:** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` (the ISSUE-237 boundary note) and `issues/closed/AFLDB-ISSUE-235.md` §4 ("Importer rows through a rebuild or promotion", annotated). The contract hardening is **AFLDB-ISSUE-241** (OD-5), not ISSUE-237. | `import_afl_api_player_bridge.py:339-367` (gate only at `:351-356`), `:403-426`; artefacts `afl-api-player-bridge-2026-09-20.json`, `afl-api-brownlow-name-bridge-*.json`, `afl-api-player-adjudication-*.json` (no `built_from_database`); the I18 "Limit" note (`issues/closed/AFLDB-ISSUE-235.md:803-805`) is already accurate and needs no correction |
| F4 | MED | **A separate importer capture would defeat the ISSUE-235 crash recovery.** `decidePendingCapture()` treats "pending empty, live empty" as safe to recapture (`:338`). A second, independent capture file can be recovered while the first is recaptured. After a reset, that recapture reads empty and silently drops ~800 rows. One snapshot, one file and one decision are required. | `rebuild_afl_api_adjudications.ts:328-356`, `:879-919` |
| F5 | MED — **in scope** | **The pending capture lives under `process.cwd()`.** `REPO_ROOT = process.cwd()` (`:870`) feeds `captureDirectory()` (`:612-614`), and `rebuild-test.ts:153` does the same. Say a run fails after the reset and is retried from another worktree. That retry finds no pending capture, captures the destroyed database as an empty new baseline, and "succeeds". Nothing is lost today only because the human ledger is small. ISSUE-237 raises the stakes to ~800 rows. D11 removes the hazard. | `rebuild_afl_api_adjudications.ts:612-614`, `:870`; `rebuild-test.ts:153`; `RESET_SQL` (`rebuild-test.ts:1656-1680`) drops schemas and `public` relations, never the database or its database-level objects |
| F6 | MED | **"Machine" is the wrong word.** `afl_api_manual_adjudication` rows are human-authored (ISSUE-228 §9.10), but the **importer** writes them as `unique`. They belong to ISSUE-237's set, not the ISSUE-235 ledger. The set is "importer-created", and `match_method` records the evidence class, so it must be carried exactly. S5b's rule is that a name+team+season row must never read as a stat-vector row. | `import_afl_api_player_bridge.py:25-50`, `:176-187`; pre-I18 census 3/129/397/273 (ISSUE-235 `:370-371`) |
| F7 | MED | **A promotion source can carry human rows that nothing replays.** A source (`afldb_test`) that holds `resolved`/`afl_api_admin_adjudication` rows brings them in the dump. The candidate's ledger is then truncated and replaced by the target's, so those rows fail the bijection **after** the swap. `promotion-check.ts` has **no** `afl_api` gate at all. The D15 "checker asserts the bijection" exists only as the post-swap script. | `promotion-check.ts:1112-1137` (no `afl_api` reference anywhere in the file); `docs/production-promotion.md:753-767` |
| F8 | MED | **"Rebuild from source" cannot run at lifecycle time** (§3.4). | §3.4 |
| F14 | MED | **The first review's OD-3 recommendation was wrong for production.** It called G3 vacuous on PROD because "PROD's target has no importer rows". That holds only until the first promotion that carries importer rows. From then on, production **holds** promoted importer rows, and every later promotion's G3 compares against them. A hard loss there is live, so it is graded FAIL (OD-3). | F1; D2 |
| F15 | MED | **The first review's L0/OD-4 recommendation repeated the F3 hazard.** It proposed re-applying the manual artefacts and regenerating the bootstrap and name classes with the builders against the rebuilt `afldb_test`. Two problems: the bare ids are unbound, and a regeneration cannot reproduce first-writer-wins order (§3.4), so it would not reproduce the former set. That recommendation is **replaced** by §11a. **Counts, for the record.** The read-only census immediately before I18 counted **802** importer rows (3/129/397/273). S0 (2026-09-23) counted 803. DEV's 669 rows are a different lineage and are **never** a substitute for either. | `issues/closed/AFLDB-ISSUE-235.md:370-371`, `:612`, `:1029` |
| F9 | LOW | **The same stable identity is rendered two ways in the repository.** `resolvePlayerIdentity()` returns prefixed `afltables:<path>`/`manual_admin_edit:<token>`. The lineage rule and the ledger's `player_identity` use the **unprefixed** value. `readPlayerStableIdentity()` is module-private in a `server-only` module, so a `tsx` CLI cannot import it. `LINEAGE_IDENTITY_SQL.byId` quietly picks one path when a player has two. | `player-identity.ts:83-109`; `afl-api-player-links.ts:72-86`; `promotion-inventory.ts:1651-1696`; migration 104 comment `:23-31` |
| F10 | LOW | **"After DraftGuru" is right, but the draft's reason is wrong.** Resolving an identity needs only `afltables_profile_url` identities, and `fitzroy` writes those. No rebuild stage creates a `manual_admin_edit` identity. DraftGuru's seeded shells carry only a `draftguru` identity, so they can never be targets. No stage between `fitzroy` and `draftguru` reads or writes `afl_api` rows. The position is chosen for **atomicity with the human replay** (§6.1). | `import_draftguru.py:82`, `:646-686`; `enrich_heights_afl_api.py` (no `external_identities` reference); `rebuild-test.ts:792-816` |
| F13 | LOW | **The first review's stage ordinals were wrong.** `recreate` … `draftguru` is fifteen stages (3–17), not thirteen. The real ordinals are `afl-api-adjudications-capture` = **2**, `afl-api-adjudications-reinstate` = **18** and `afl-api-adjudications-bijection` = **19**. That matches the I18 evidence ("Stage 18 reinstated … Stage 19 standalone bijection"). Stage **ids** are the contract, and they do not change. | `rebuild-test.ts:609-914` (`planStages()`); `issues/closed/AFLDB-ISSUE-235.md:686-690` |
| F11 | LOW | The ledger's contract remediation text names `replay_afl_api_adjudications.py or the common.py sibling`. The adapter is TypeScript. | `promotion-inventory.ts:689-693` |
| F12 | INFO | A replay by stable identity preserves an *established decision*. It does **not** re-verify evidence against the rebuilt canonical data, just as D15 does not re-verify a human decision. Correcting a wrong decision is ISSUE-238. | — |

---

## 2. Problem

The bridge loader writes `external_identities` rows with `source='afl_api'`, `status='unique'`
and one of four evidence-class `match_method` values. These are trusted identity: the settle
resolver trusts `unique` and `resolved` alike, and does not filter on method
(`afl-api-player-resolver.ts:12-36,68`).

`db:test:rebuild` resets `afldb_test` and has no stage that brings these rows back. I18 proved it:
802 before the rebuild, 0 after. `afldb_test` is the promotion source, so every promotion then
carries 0 rows. After a promotion or rebuild, each importer-linked provider settles as
`unresolved_identity` again. The two documents F3 names used to present a bridge re-run as the
recovery. It is not a safe one (F3).

ISSUE-235 carries **human** `resolved` rows through both lifecycles with the
`afl_api_identity_adjudications` ledger (D15/OD-5). ISSUE-237 must not change that authority model.
It must, however, fix the D15 replay's behaviour when it meets a rebuilt importer row (F2).

---

## 3. Repository evidence

### 3.1 The row

The table is `external_identities` (`002_core_entities.sql:178`). Its columns are `id`,
`source_id`, `external_id`, `external_name`, `external_url`, `player_id`, `status`,
`candidate_count`, `match_method` and `notes`. It is `UNIQUE (source_id, external_id)`. Migration
104's `uq_external_identities_afl_api_player` (`:143-179`) allows one `afl_api` row per player
across both writers. Nothing stores a timestamp.

The loader's INSERT (`import_afl_api_player_bridge.py:589-598`) writes:

- `external_name` = the artefact's `observed_name`
- `status` = `'unique'`
- `candidate_count` = `1`
- `match_method` = the artefact's declared method
- `notes` = `evidence_summary`
- `external_url` = never written (NULL)

The loader **never** UPDATEs or DELETEs a row (`:9-17`, `:120`). Precedence is first trusted
writer wins.

### 3.2 The human side (ISSUE-235, unchanged except §7.3)

- **Ledger.** It is reinstated in every environment (`promotion-inventory.ts:659-709`). Its
  `player_identity` is the **unprefixed** lineage value.
- **Capture, reinstate and bijection in the rebuild.** `rebuild_afl_api_adjudications.ts`. Stages
  (F13 ordinals): 2 `afl-api-adjudications-capture` (`rebuild-test.ts:623`, before `recreate`),
  18 `afl-api-adjudications-reinstate` (`:810`, one transaction, after `draftguru`) and 19
  `afl-api-adjudications-bijection` (`:820`).
- **Remap.** `resolveAflApiPlayerIdentity()` (`replay_afl_api_adjudications.ts:92-107`) resolves
  an identity through the `afltables`/`manual_admin_edit` identities; ambiguity is a stop.
- **Replay decision table.** `planAflApiAdjudicationReplay()` (`afl-api-adjudication.ts:759-818`).
  Any existing row for the provider that is not an identical human row is a **STOP**.
- **Promotion.** The D15 replay runs in §8 step 1, after `replay_admin_overrides('players')`
  (`docs/production-promotion.md:719-767`). **After the swap.**

### 3.3 The promotion carrier

`docs/production-promotion.md` §1 (`:50-55`, `:90`) says import-writable tables arrive with the
rebuild. `external_identities` is one of them. So the candidate's `afl_api` rows are whatever the
rebuilt `afldb_test` held. Nothing in §6–§8 truncates or reinstates them. The current season is
re-acquired only **after** the swap (§9, `:830-837`).

### 3.4 Why rebuild-from-source is not available at lifecycle time (R2)

- **`afl_api_stat_vector_season`.** The emitter
  (`tools/current-season/emit-afl-api-player-bridge-test.ts`) reads the target's canonical 2026
  `player_match_stats`. Before the reset, those rows came from settle runs on `afldb_test`
  (ISSUE-230's 2099 clock), not from the accepted fitzRoy baseline the rebuild loads. A re-emit
  after the reset reads different canonical data, so it cannot reproduce the same provider set. In
  promotion the current season is re-acquired only after the swap (§9). A re-emit is possible only
  on DEV, with the DEV-pinned emitter and `--target dev`, and only after §9. Production has no
  target at all. This class is the only one with a lineage gate (`built_from_database`), which is
  why it alone is eligible for the DEV exception in §6.3.
- **Bootstrap, name+team+season and manual classes.** The artefacts are tracked, but their ids are
  bare and have no lineage binding (F3). Rebuilding the rows by re-running the builders would also
  have to replay the historical **order** of four classes and several artefacts, because first
  writer wins. That order is what split the 2026 providers into 397 bootstrap and 273–274 season
  rows. No tracked manifest records that order.
- **Conclusion.** Rebuild-from-source is not deterministic in `db:test:rebuild`, cannot run
  before the swap in promotion, and does not exist for PROD.

### 3.5 Identity lookups this issue reuses

- **Forward (player → identity):** `LINEAGE_IDENTITY_SQL.afltables_profile_url.byId`
  (`promotion-inventory.ts:1669-1678`, exported from a `tools/` module that `tsx` can import).
- **Reverse (identity → player):** `resolveAflApiPlayerIdentity()`.
- **Both render the value the same way.** The ledger stores the same unprefixed value, so
  importer captures and ledger rows compare byte for byte.

---

## 4. Decisions

**D1 — Authority and transport (R1: answer b).**

- **Authority.** The `external_identities` row itself is the **authoritative accepted importer
  identity state**. It is not a ledger, and ISSUE-237 creates no ledger of any kind. The only
  AFL API ledger is ISSUE-235's human `afl_api_identity_adjudications`.
- **Provenance.** The bridge artefact (a) records how the row was first established. It is
  never a lifecycle input (F3).
- **Transport.** The rebuild capture (c) is **transient lifecycle transport**. It exists only
  between Stage 2 and the Stage 18 commit of one rebuild run. It is never an authority, never
  tracked and never exported, and it is archived once the reinstatement commits.
- **Regeneration.** Rebuild-from-source (d) is unavailable (§3.4).

**D2 — Ownership model: replay inside `afldb_test`'s lineage, and carry into promotion by the
rebuilt dump.**

- **`db:test:rebuild`:** capture before the reset by stable identity, then replay after the
  player load (§6.1).
- **Promotion:** no importer capture and no importer replay. The rows arrive with the rebuilt
  dump, already coherent with the candidate's player ids by construction. The promotion adds
  gates (§6.2) and the D15 supersede rule (D9) so it cannot stop after the swap.
- **Why not capture from the replaced target.** Production's own importer never writes there
  (F1), and the contract treats import-writable state as rebuilt. Promoted rows already in
  production are protected by G3 (D14), not by a capture.
- **Why not regenerate.** §3.4.

**D3 — No surrogate ids across a lineage (draft D2, kept).** A carried row resolves only through
the stable identity described in §3.5. A name, surname, jumper number or equal integer is never
enough. The replay never trusts a captured `player_id`, and no recovery path ever reads a bridge
artefact's `candidate_player_id` as identity.

**D4 — The capture is not bridge evidence (draft D3, kept).** No importer provenance gate is
relaxed. No PROD target is added to the loader.

**D5 — The carried set is exactly "importer-created" (R4).** An `afl_api` row is in the set if and
only if **all** of these hold:

- `status='unique'`
- `match_method` is one of the **approved importer methods**: `afl_api_stat_vector_bootstrap`,
  `afl_api_name_team_season_bootstrap`, `afl_api_manual_adjudication` or
  `afl_api_stat_vector_season`
- `player_id IS NOT NULL`
- `candidate_count = 1`
- `external_url IS NULL`

The set of methods is a TypeScript constant (`AFL_API_IMPORTER_MATCH_METHODS`). A DB-free test
pins it to the loader's `ALLOWED_MATCH_METHODS`.

The only other admissible `afl_api` row is ISSUE-235's human row: `status='resolved'` and
`match_method='afl_api_admin_adjudication'`, which the ledger bijection accounts for. **Any other
`afl_api` row refuses.** That includes:

- an unsupported method;
- `resolved` under another method;
- a NULL player;
- an unexpected `candidate_count`;
- a non-NULL `external_url`;
- a human row with no net `linked` ledger entry.

Nothing is silently copied or silently dropped.

**D6 — What a captured row holds (R3).**

| Field | Role |
|---|---|
| `externalId` | **Identity, required.** `^CD_I[0-9]+$`. |
| `playerIdentity` | **Identity, required.** The unprefixed lineage value, i.e. exactly what the ledger stores. |
| `matchMethod` | **Meaning, required.** The evidence class. It must be reproduced exactly. |
| `status` (`unique`), `candidateCount` (`1`) | **Meaning, required.** Asserted and reproduced. |
| `externalName`, `externalUrl` (NULL), `notes` | **Fidelity.** Carried verbatim so the row is reproduced "without changing its meaning". Not identity. |
| `playerId` | **Audit only.** The captured database's surrogate. It is never written back. |

Not carried:

- `external_identities.id`. It is a surrogate, and no durable row references it. Contradiction
  findings are rebuilt state; ISSUE-240 owns their keys.
- A per-row evidence digest. The row records no artefact reference, and one must not be invented.
  The capture's `payloadSha256` protects integrity.

**D7 — Fail closed at both resolution points; no withhold mode (OD-1, R5).** Every captured
importer row must resolve to **exactly one accepted stable player identity** at two points. First,
**before destruction**, a forward identity from the live player. Second, **during replay**, a
reverse resolution to exactly one player. There is **no** withhold-and-continue mode, flag or
partial success, now or as a later option.

- **Before destruction (Stage 2).** The capture **refuses before `recreate`** when any importer
  row's player:
  - has no stable identity;
  - holds more than one `afltables_profile_url` identity (the `resolvePlayerIdentity()` ambiguity
    precedent, F9), **unless** the continuity amendment below applies; or
  - is identified only by a `manual_admin_edit` token. That refusal is unchanged: a bare token is
    never an importer replay identity. *(Amended 2026-09-25 for AFLDB-ISSUE-245; the earlier "no
    rebuild stage re-creates such a player" is no longer true.)* A player that exists only through
    a manual registration must be reproducible by ISSUE-245's manual-registration lifecycle
    (Stages 17–19, before `draftguru` and before this issue's importer replay) before AFL API
    identity replay. A supported registered player is captured in the combined capture's
    `registrations` section and replayed there. Unsupported or uncarried manual player state still
    refuses at Stage 2, before `recreate`. ISSUE-237 itself still creates no canonical player.
- **Continuity amendment (OD-7, operator-approved 2026-09-25).** A player whose accepted AFL
  Tables paths are **exactly two**, where those two are **exactly** one tracked
  `profile_url_continuity` rule's `{continuing_url, renumbered_url}` (AFLDB-ISSUE-136,
  `tools/rebuild/fitzroy/fitzroy-contract.json`, valid under the fitzRoy importer's own rule
  checks), has the stable identity **`continuing_url`**:
  - The rule picks the path. Path order and sort order play no part.
  - Every other multi-path case stays **ambiguous → STOP**: a continuity path with an unrelated
    second path, an exact pair plus any third path, or two paths no single rule names exactly.
  - One accepted path, the zero-path `manual_admin_edit` fallback and AFL Tables precedence over a
    manual token are all unchanged. An exact pair counts as one canonical AFL Tables identity.
  - There is no name matching, no heuristic, no lexicographic fallback and no per-provider
    exception. Neither identity row is deleted or rewritten. The fitzRoy importer and its
    contract are not changed.
  - An unreadable or malformed contract refuses the lookup (fail closed). "Malformed" means any
    shape the importer's `load_profile_continuity_rules()` refuses: duplicate id, duplicate
    renumbered path, self mapping, chain, bad path or file, or an incomplete or inconsistent
    `expect` block.
  - Code: the one shared pure classifier is `classifyAflApiForwardIdentity` /
    `classifyAflApiForwardIdentityRows` (`src/lib/acquisition/afl-api-adjudication.ts`). The
    rebuild/recovery reader (`readAflApiForwardIdentities`, `replay_afl_api_adjudications.ts`)
    and the promotion checker's reader (`tools/db/promotion-check.ts`) both delegate to it. The
    rules come from the neutral loader `src/lib/acquisition/fitzroy-profile-continuity.ts`.
    ~~`resolveAflApiPlayerIdentity()` (the reverse lookup) is unchanged.~~ *(Superseded
    2026-09-25, next bullet.)*
- **Continuity amendment, reverse direction (2026-09-25 tightening).** A tracked rule asserts its
  two paths are one footballer, so a target that splits them contradicts the contract. When a
  stable identity is named by a tracked rule (either side; membership is looked up in the
  validated contract, never inferred from the path), the identity resolves **only** when, for
  every rule naming it, `continuing_url` resolves to exactly one target player, `renumbered_url`
  resolves to exactly one target player, and they are the **same** player. Otherwise it is
  `continuity_contradiction` → **STOP**, with one of `continuing_missing`,
  `continuing_ambiguous`, `renumbered_missing`, `renumbered_ambiguous` or `split`. There is **no**
  fallback to the identity's own path alone. An identity no rule names is unchanged (one → it,
  none → unresolvable, several → ambiguous).
  - Code: the one shared pure classifier is `classifyAflApiReverseIdentity` (with
    `aflApiReverseIdentityPaths`, `src/lib/acquisition/afl-api-adjudication.ts`). The replay
    adapter's `resolveAflApiPlayerIdentity()` delegates to it, which covers Stage 18, the D15
    ledger replay and remap, the rebuild ledger reinstatement and R4. So does the promotion
    checker's G2 reader (`readAflApiReverseIdentities`, `tools/db/promotion-check.ts`), which
    replaces G2's former inline remap. G2 grades a contradicted net-linked entry
    `CONTINUITY_CONTRADICTION` (FAIL), even when the candidate has no importer row for it.

  The accepted identity statuses are `unique` and `resolved` (§5).
- **During replay (Stage 18).** Say an identity resolves to zero players or to several. Then the
  **whole** reinstate transaction rolls back. So do the ledger reinstatement and the D15 replay:
  they share the transaction (D12). The pending capture and the database marker stay in place for
  `--recover` (D11). There is no name fallback.
- **The same rule binds the OD-4 recovery path (§11a)** and the promotion gates G1/G2 (§6.2).

The precedents are ISSUE-235 D6-3 (a human link needs a stable identity), OD-5 (on `afldb_test` a
`manual_admin_edit` key stops the rebuild), and a production lineage remap that refuses an
unresolved id.

**D8 — Order: importer rows present first, then the human replay applied over them (R8).**

- **In both lifecycles.** The importer rows are in place first: replayed in the rebuild, arriving
  with the dump in promotion. Then the D15 replay runs. **A human decision always prevails, so
  the order does not decide the outcome.** D9 fixes every case.
- **Why this order.** It is already the physical order in promotion, where the rows are in the
  dump. Using the same order in the rebuild means one D15 code path. The replay never picks its
  own supersedes. The caller fixes the **exact expected supersede set** *before* mutation, and
  the two lifecycles fix it differently (D9):
  - **rebuild:** `E_rebuild = ∅` always. An overlap is invalid state, refused at Stage 2 and
    re-checked at Stage 18;
  - **promotion:** `E_promotion = G2.AGREE`, which may be non-empty.
- **Against the draft's rationale.** The draft called the human replay the "later authority".
  Under first-trusted-writer-wins that is backwards, because the earlier writer wins. Precedence
  comes from explicit rules, not from position.

**D9 — Importer/human precedence and conflicts (R9, OD-2).**

**Importer replay** (rebuild and the OD-4 recovery path only). It is a pure planner, with the same
shape as `planAflApiAdjudicationReplay`:

| Candidate state for a captured row | Outcome |
|---|---|
| No row for the provider; the player holds no `afl_api` row | INSERT the captured row verbatim, with `player_id` from the identity |
| An identical importer row (same provider, same resolved player, same method/status/candidate_count/name/url/notes) | No-op (the recovery-verify path only) |
| Same provider, same player, **different importer method** or other field | **STOP** (the meaning differs) |
| Same provider, different player | **STOP** |
| Different provider, same player (the migration 104 per-player index) | **STOP** |
| A human `resolved` row for the provider, same or different player | **STOP**. It cannot occur from a single consistent snapshot, because the importer runs first. |
| An identity that is unresolvable or ambiguous | **STOP** (D7) |

**D15 replay extension** (the **only** change to ISSUE-235's table; OD-2 APPROVED).

- **The code path is shared.** The rebuild's permitted supersede set is always empty (see
  "Rebuild semantics" below), so in practice this branch acts **only in promotion**.
- **Conditions.** Human adjudication may supersede an agreeing importer row **when, and only
  when,** all of the following hold:

1. **Provider identity is identical.** The ledger entry's `external_id` equals the importer row's
   `external_id`.
2. **Stable player identity is identical.** The ledger entry's `player_identity` equals the
   importer row's player's forward identity (§5), byte for byte. Its remap is also the importer
   row's own `player_id`. Both must hold. Neither alone is enough.
3. **The existing row is a full D5 importer row.** That means `status='unique'`, an approved
   importer method, `candidate_count 1`, `external_url` NULL and a non-NULL player.

The **only** allowed transition is:

```text
unique / <approved importer match_method>  ->  resolved / afl_api_admin_adjudication
```

- It is one in-place UPDATE, so `external_identities.id` is kept.
- The row becomes `resolved`, `afl_api_admin_adjudication`, `candidate_count 0`, the D15 note and
  `external_name` NULL. That is exactly the row an INSERT would create, so the bijection holds.
- It is counted as `superseded`, and each provider is named in the output.
- It only ever runs upward. A human row is never downgraded, overwritten or re-superseded.

**Hard failures (STOP; nothing written).** Every other D15 outcome stays unchanged:

- a **different-player mapping**, where the same provider's importer row is on another player;
- a **player collision**, where the remapped player holds another provider;
- **ambiguity**: an unresolvable or ambiguous identity, or a player with two AFL Tables paths;
- an **unsupported method**: a `unique` row whose method is not an approved importer method, or
  any other non-D5 row;
- a human row that is not identical.

In promotion these STOPs are predicted **before the swap** by gate G2 (§6.2), so the post-swap
replay cannot meet one it has not already reported.

**The agreement predicate `agrees(P)`.** Both lifecycles use it, but **what it means differs by
lifecycle** (below). A provider `P` agrees if and only if **all** of these hold for an importer row
and a human ledger entry:

1. **same `external_id`** (`P`);
2. **same stable `player_identity`, byte for byte**: the importer row's player's forward identity
   equals the ledger entry's stored `player_identity`;
3. the importer row's `status` is `unique`;
4. the importer row's `match_method` is an **approved ISSUE-237 importer method** (D5);
5. the **effective human ledger state** for `P` is `LINKED` (its latest action is a link, not a
   revoke);
6. **the remapped player agrees**: the ledger identity's reverse resolution (§5) is the importer
   row's own `player_id`.

The replay never decides by itself which rows it supersedes. The caller fixes the exact expected
set **before any mutation**.

**1. Rebuild semantics (`db:test:rebuild`): an overlap is invalid, and `E_rebuild` must be empty.**

- **Why an overlap is invalid.** A rebuild capture is one snapshot of one live database.
  ISSUE-235 writes a ledger decision and its `resolved` row **atomically**
  (`src/db/queries/afl-api-player-links.ts:612-623`). So a live provider cannot legitimately hold
  both an importer `unique` row and an effective `LINKED` ledger decision without its `resolved`
  row. An agreeing overlap in a live snapshot is therefore **broken pre-existing state**. The
  rebuild must **not** normalise it across the reset (OD-6).
- **Stage 2 (before destruction).** Stage 2 keeps the ledger bijection and disjointness checks
  (D13). It also derives `E_rebuild = { P : agrees(P) }` over the combined live snapshot. If
  `E_rebuild ≠ ∅`, Stage 2 **STOPs** before `recreate`, and it names every provider. So does any
  bijection or disjointness failure.
- **The invariant.** For every accepted rebuild capture, **`E_rebuild = ∅`**.
- **Stage 18 (before mutation).** Stage 18 **independently** re-derives `E_rebuild` from the
  capture file alone, and asserts it is empty. It does not rely on Stage 2 having done so. A
  non-empty result is a hard STOP with nothing written.
- **Stage 18 (inside the transaction).** Both **expectedSupersedes = {}** and **actualSupersedes
  = {}** must hold. Any actual supersede at step (c) is a **hard STOP**, and the whole Stage 18
  transaction rolls back (the marker is kept).
- **No carry path.** There is **no** supported rebuild path that carries an overlapping state
  across the reset: no flag, recover mode or operator override. Repairing such a state is outside
  ISSUE-237. It is manual, before the rebuild, and it is ISSUE-238/239 territory if it involves a
  consumed link or human recovery.

**2. Promotion semantics: `E_promotion = G2.AGREE`, which may legitimately be non-empty.**

- **Why an overlap is legitimate here.** Promotion compares two **different lifecycle sides**.
  The rebuilt candidate carries importer `unique` rows from `afldb_test`'s lineage. The live
  target owns the durable human ledger. A target human decision for a provider that the candidate's
  importer also linked is an expected, benign meeting. It is **not** broken state.
- **Before the swap.** G2 (§6.2) evaluates `agrees(P)` for each net-linked entry of the
  reinstated ledger against the candidate's importer rows. For conditions 2 and 6, it compares the
  stored identity with the candidate row's forward identity. `E_promotion = G2.AGREE`. Every
  other G2 outcome FAILs before the swap.
- **After the swap (§8 step 1).** The D15 replay takes `E_promotion` as a required input. It may
  supersede only providers in that set, and only under all six conditions, including a
  re-checked remap agreement against the live post-swap rows. The **actual superseded provider set
  must equal `E_promotion` exactly**:
  - if it is empty, zero supersedes;
  - otherwise, exactly those provider ids.

  A **missing** or **additional** supersede is a **hard STOP**, and the replay transaction rolls
  back.

**The two are not the same lifecycle state.** They share the agreement predicate only. In the
rebuild, agreement signals corruption and refuses. In promotion, agreement is the permitted
supersede set. Tests and code keep them as two named call sites: `E_rebuild` must be empty;
`E_promotion` is bound to G2.

**D10 — One combined capture (R10).** Extend ISSUE-235's framework rather than adding a parallel
one:

- one read-only repeatable-read snapshot;
- one file, **format `afldb.afl_api_identities.rebuild_capture` version 1**;
- one `payloadSha256`;
- one pending/recover decision;
- one database marker;
- one reinstate transaction.

The file has two sections. One is the ledger (the v2 row shape, unchanged). The other is the
importer rows (D6).

- **The sections never travel apart.** No importer-only file, marker or decision exists anywhere.
- **No split decision.** No decision adopts one section while it captures the other live, or
  verifies one section while it adopts the other. The human ledger state and the importer state
  are recovered together or not at all.
- **A v2 file is refused, never upgraded.** A v2 file
  (`afldb.afl_api_identity_adjudications.rebuild_capture`) can exist only after a failed
  ISSUE-235-era run, and the operator reconciles it by hand. None exists in this worktree
  (`backups/rebuild/` is absent).

**D11 — Crash and recovery; the cwd hazard removed (R10, F5 in scope).**

*(a) No checkout-relative location.* `REPO_ROOT = process.cwd()` stops being the root of the
capture path, in both `rebuild_afl_api_adjudications.ts` and `rebuild-test.ts`.

- **One capture root.** It comes from one required, explicit, absolute setting. The proposed name
  is `AFLDB_REBUILD_CAPTURE_ROOT`. Both processes resolve it with one shared function, and the
  capture directory is `<root>/<database>/`.
- **`precheck` refuses** before Stage 2 when the root is unset, relative or not creatable.
- **It also refuses a root inside the invoking checkout.** Removing a worktree would otherwise
  delete a pending capture with it.
- **Result.** Every checkout on the same host reads and writes the same pending capture.

*(b) The database marker is authoritative for "a capture is pending".* A filesystem alone is not.

- **What it records.** Stage 2 records `{format, version, capturedAt, payloadSha256,
  fileSha256}` on the target database.
- **When it is set.** After the capture file is durably written (tmp + rename), and **before**
  `recreate`.
- **Where it lives (proposed; not yet proven).** The proposal is `COMMENT ON DATABASE <target>`,
  which the owner may set. It attaches to the **database object**, not to a schema, so it survives
  the rebuild **only if the rebuild never drops or recreates the database itself**.
  - **What the code suggests.** The `recreate` stage runs `RESET_SQL` in place over the admin DSN
    (`rebuild-test.ts:1757`). The header states that no DSN in the credential model can DROP or
    CREATE a database (`:43-46`), and that `RESET_SQL` contains no `DROP DATABASE`
    (`:1652-1655`).
  - **That is evidence, not proof.** Marker survival is **not assumed**. It is an implementation
    prerequisite (**P-M**, below), which must pass before any marker code is written.
- **If setting it fails,** Stage 2 refuses, and `recreate` never runs.
- **When it is cleared.** Only inside the Stage 18 transaction that commits the reinstatement.
- **Therefore** a database that has been reset carries the marker until its reinstatement
  commits, **from whatever checkout or host the retry comes**.

*(c) The combined pending decision.* `decidePendingCapture()` is generalised. It takes both
sections and the marker, and returns one decision:

| Marker | Pending file at the capture root | Live sections | Decision |
|---|---|---|---|
| present | absent | any | **REFUSE.** The message names the marker's hashes and the expected path. **Never** capture-live: this is the other-worktree / other-host silent-loss path F5 describes. |
| present | present, hashes ≠ marker | any | **REFUSE** (the wrong or tampered capture). |
| present | present, matching | both empty | `--recover-afl-api-adjudications` → **adopt the pending capture**. Without the flag → **REFUSE**, naming the flag. |
| present | present, matching | not both empty, equal to the pending capture | **verify-reinstated** (see below). The marker is then cleared and a fresh capture is taken. |
| present | present, matching | not both empty, different | **REFUSE**; reconcile by hand. |
| absent | present | equal to the pending capture | **verify-reinstated** (a crash after the Stage 18 commit, before archive). |
| absent | present | both empty, pending not empty | **REFUSE** unless `--recover`. The marker being absent here means the database was not reset by this tool, so adopt only on the explicit flag. |
| absent | present | otherwise | The existing ISSUE-235 logic, generalised to both sections. A crash between the file write and the marker leaves the database intact. |
| absent | absent | any | **capture-live**. |

Supporting rules:

- **"Empty"** means **both** sections are empty.
- **"Equal"** means both sections are equal, ignoring only the `player_id`/`admin_user_id`
  surrogates. No supersede adjustment exists, because `E_rebuild = ∅` (D9, rebuild semantics).
- **Overlap.** A pending capture that derives a non-empty `E_rebuild` is **refused**, never
  adopted or verified. A live snapshot that derives one is also refused before any decision acts.
- **The existing flag is kept.** `--recover-afl-api-adjudications` keeps its name for
  continuity, and its help text is widened to cover both sections.
- **`verify-reinstated`** additionally requires three things. The importer replay, run
  read-only, must insert 0 and stop 0. The read-only D15 replay must supersede 0 (`E_rebuild = ∅`).
  The combined invariant must hold.
- **Manual marker changes are forbidden.** Removing or editing the marker by hand is outside the
  supported procedure. The docs say so.

*(d) Prerequisite P-M: the marker must be proven to survive the real reset path.* This gates **S3**.
No marker code is written until P-M passes. The implementer proves every point below from the
code path `tools/db/rebuild-test.ts` actually runs, not from `RESET_SQL` alone:

1. **DB-free test (`tests/db-test-rebuild.test.ts`).** For **every** rebuild target the runner
   accepts (`afldb_test` and `code_test_db`):
   - the `recreate` stage's only action is `deps.runSql(adminDsn, RESET_SQL)`;
   - no stage between `afl-api-adjudications-capture` and `afl-api-adjudications-reinstate` runs
     `DROP DATABASE`, `CREATE DATABASE`, `dropdb`, `createdb`, `pg_restore --create`/`--clean`
     of the database, or any other statement or command that drops or recreates the database
     object;
   - `RESET_SQL` contains none of those.

   A new stage or command that could do so must fail this test.
2. **Rolled-back proof (`prove-reset` territory, non-destructive, always rolled back).** On
   `afldb_test`, inside one transaction:
   - set a test marker;
   - run the exact `RESET_SQL` constant;
   - confirm the marker is still readable;
   - roll back;
   - confirm the pre-test comment is unchanged.

   This proves that `RESET_SQL` does not touch the comment, and that setting it is transactional.

   **PROVEN (2026-09-24), by operator-run live evidence against `afldb_test`:**

   | Field | Value |
   |---|---|
   | target | `afldb_test` |
   | role | `afldb_owner` / `afldb_owner` (current_user / session_user) |
   | superuser | no |
   | exclusive sessions | 0 |
   | PostgreSQL | 16.15 |
   | reset path | real `psql`/`RESET_SQL`, `tools/db/prove-reset.ts` |
   | psql exit | 3 (the deliberate `AFLDB-RESET-PROOF-ROLLBACK` abort) |
   | pre-reset fingerprint | `4a9388a2351917f0c249446b43058a1b76eb0a74534f6dba7a4044c3c6926b04` |
   | post-rollback fingerprint | `4a9388a2351917f0c249446b43058a1b76eb0a74534f6dba7a4044c3c6926b04` (identical) |
   | database comment before proof | none |
   | marker behaviour | the throwaway `COMMENT ON DATABASE` set inside the transaction survived `RESET_SQL`; the rollback restored the pre-existing comment (none) exactly |
   | health after rollback | 1185 relations, 3 extensions |
   | committed | nothing; nothing rebuilt |

   This proves the mechanism `COMMENT ON DATABASE` is not touched by `RESET_SQL` and that setting
   it is transactional, through the real `psql`/`RESET_SQL` path (not a substitute mechanism). It
   is the P-M point 2 proof; it does **not** by itself prove point 3 (the real destructive
   `recreate` rehearsal on `code_test_db`, L1/L2) or point 4 (the Stage 18 transactional clear,
   proven DB-free below, §14).
3. **Rehearsal (L1 and L2 on `code_test_db`).** Across the real destructive `recreate`, confirm the
   marker is present after the reset and cleared only by the Stage 18 commit.

   **NOT PROVEN.** It is proven only by the §11b L2 sequence on the real `code_test_db`
   destructive path, and only when **all** of these are observed:
   1. `seed` and `verify --phase pre` PASS on `code_test_db`;
   2. the rebuild with `--rehearsal-stop-after recreate` exits **86**, and its log shows Stage 2
      capture, then `DATABASE RESET`, then the halt, with `migrations` first in `Not run:`;
   3. an independent `psql` query of the `pg_database` comment (§11b, Q-M) returns the marker;
   4. independent catalog reads show the real `RESET_SQL` ran (`external_identities` and the
      ledger table are gone), so the marker survived the actual recreate;
   5. the marker's `payloadSha256` and `fileSha256` equal the durable pending combined capture's
      payload hash and file SHA-256;
   6. the supported `--recover-afl-api-adjudications` rebuild exits 0 and adopts that capture;
   7. its Stage 18 reports the importer inserted, 0 supersedes, and the marker cleared inside the
      committing transaction, and Stage 19 passes (no marker remains);
   8. Q-M, run again independently, returns NULL;
   9. `verify --phase post` PASS (the fixture state, D5/D7/D13, D15 bijection, zero supersedes).
4. **Transactional clear.** A rolled-back Stage 18 leaves the marker in place (integration test,
   §10).

**If any point fails, or the database object can be dropped or recreated on any supported path,
the marker is redesigned before implementation.** The replacement must be an equally
reset-surviving, checkout-independent record. A database comment is not a design commitment. The
redesign goes back to the operator. Nothing proceeds on an unproven marker.

**D12 — Atomicity.**

- **In the rebuild.** Five steps run in **one** transaction, the existing Stage 18: the importer
  replay, the ledger reinstatement, the D15 replay, the combined invariant and the marker clear.
  Any failure rolls everything back.
- **In the OD-4 recovery path.** The same importer replay and parity run in one transaction
  (§11a).
- **In promotion.** The D15 replay (with supersede) and its verification each run in one
  transaction, as today. G1–G3 are read-only.

**D13 — Verification invariants (R11).**

- **Capture, before destruction:**
  - every `afl_api` row falls in exactly one of the D5 importer set or the bijected human set;
  - providers are unique, and per-row identities are unique;
  - importer and net-linked human sets are disjoint by provider **and** by identity;
  - the D7 identity rules hold;
  - the ledger bijection holds;
  - **`E_rebuild = ∅`**: no provider satisfies the agreement predicate (D9, rebuild semantics),
    reported by name if one does.
- **Reinstate transaction, before commit (exact parity).** Project the live importer rows to
  `(external_id, forward player_identity, status, candidate_count, match_method, external_name,
  external_url, notes)`. That projection must **equal the captured projection as a set**. This one
  comparison covers:
  - count parity;
  - provider-set equality;
  - the provider → identity bijection;
  - method equality;
  - no silent retargeting.

  The forward identity is recomputed with `byId`. On top of that:
  - **expectedSupersedes = {} and actualSupersedes = {}**. Any supersede is a hard STOP (D9);
  - the D15 bijection holds;
  - the total `afl_api` rows = |captured importer| + |net-linked human|;
  - no player holds more than one `afl_api` row.
- **Promotion, the D15 replay transaction.** The actual superseded provider set equals
  `E_promotion = G2.AGREE` exactly (D9, promotion semantics). Each superseded provider then holds
  a `resolved`/`afl_api_admin_adjudication` row whose forward identity equals its ledger identity,
  byte for byte.
- **Standalone (validation stage, promotion, any time).** This is
  `assertAflApiIdentityInvariant()`. It needs no capture:
  - the D5 census (no anomalous row);
  - the D15 bijection;
  - one row per player;
  - every importer row's player has exactly one accepted stable identity (D7).

  Exact parity against the capture is asserted inside the committing transaction, the strongest
  point. It is not repeated from an archived file.

**D14 — Promotion source and cross-lineage rules (F7, F1, F14, OD-3 modified).**

- **Promotion source.** A promotion **source** must hold **zero** `resolved` `afl_api` rows and
  **zero** ledger rows. Source-lineage human decisions are not authority on the target, and
  nothing would replay them. The source must also:
  - pass the D5 census;
  - pass the D7 identity rules;
  - carry no rebuild marker.

  Otherwise the source phase FAILs.
- **Cross-lineage rule.** On a promotion, the target's own importer rows are replaced by the
  candidate's (D2). Gate G3 compares the two by stable identity. §6.2 gives the grades. In summary:
  - Same provider, different identity → **FAIL**, in every environment. This is the fail-closed
    choice for two importer classifications that contradict each other; ISSUE-238 owns
    correction.
  - **A provider present in the live target's importer set but absent from the candidate is a
    hard loss. In production it is FAIL, with no exception and no general WARN.**
  - **The only exception is DEV-only.** WARN + record is allowed only for explicitly classified
    `afl_api_stat_vector_season` identities. Their regeneration after re-acquisition is intended,
    and a post-re-acquisition verification census is mandatory. Every other DEV hard loss is FAIL.
    §6.3 defines the exception precisely.

**D15 — Scope boundaries (R12).** Out of scope:

- ISSUE-238: correcting or reattributing a consumed link, including resolving a G2/G3 FAIL.
- ISSUE-239: human recovery outside D15.
- ISSUE-240: finding dedup.
- **ISSUE-241 (OD-5):** hardening the bridge artefact/importer contract against stale
  database-local `candidate_player_id` reuse. ISSUE-237 corrects only the documents that
  presented a re-run as recovery (F3).
- Any new matching rule.
- Any change to the loader's classes, provenance gates or targets.
- Current-season acquisition.

**D16 — `afldb_test` coverage recovery (OD-4).** `afldb_test` holds 0 importer rows since I18. It
is recovered through stable identity from a pre-I18 state **proven authoritative by R1**, never from old bridge
artefacts. §11a gives the procedure and its preconditions. Without that state, the destructive
ISSUE-237 validation on `afldb_test` (L3) and every promotion step that depends on
`afldb_test`'s coverage (L4, L5) stay **blocked**.

---

## 5. Stable identity contract

- **One identity system.** The value is `LINEAGE_IDENTITY_SQL.afltables_profile_url`'s unprefixed
  `external_id`:
  - the trusted `afltables`/`afltables_profile_url` path; otherwise
  - the `manual_admin_edit` token.
  - Status must be `unique` or `resolved`. That is an **accepted** stable identity.
- **Byte-compatible with the ledger.** It is what `afl_api_identity_adjudications.player_identity`
  stores, so the two sections compare byte for byte.
- **Forward lookup.** Uses `byId` (reused, not copied), plus the D7 guards: more than one
  AFL Tables path refuses, and a `manual_admin_edit`-only player refuses in the rebuild and in the
  OD-4 export. *(Amended 2026-09-25, OD-7: an exact tracked `profile_url_continuity` pair
  resolves to its `continuing_url`. Every other multi-path case still refuses. See §4 D7.)*
- **Reverse lookup.** Uses `resolveAflApiPlayerIdentity()` (reused). Zero or several players is a
  refusal.
- **Not used:**
  - `resolvePlayerIdentity()`: the prefixed form, used for the `data_overrides` keys.
  - `readPlayerStableIdentity()`: `server-only` and private.
  - Any bridge artefact's `candidate_player_id` (F3).
- **Names are never read.**

## 6. Lifecycle ordering

### 6.1 `db:test:rebuild` — the Stage 2 / 18 / 19 contract

Still 25 stages. The stage **ids** are unchanged, because tests and run reports pin them. Their
names and comments are widened. The ordinals below are the real ones from `planStages()` (F13):

- **1** `precheck`
- **2** `afl-api-adjudications-capture`
- **3** `recreate` … **17** `draftguru`
- **18** `afl-api-adjudications-reinstate`
- **19** `afl-api-adjudications-bijection`
- **20** `awards-honours` … **25** `fingerprints`

The first review's "16/17" labels meant stages 18/19.

*(Annotation 2026-09-25: the ordinals above predate AFLDB-ISSUE-245. `planStages()` now has
**28** stages. ISSUE-245 inserted `manual-registrations-reinstate`/`-replay`/`-verify` as 17–19,
before `draftguru` (now 20). This issue's reinstate and bijection stages are now **21** and
**22**, with `awards-honours` … `fingerprints` at 23–28 (`docs/deployment.md` §6a stage table).
Their stage ids and content are unchanged. Where this section says "Stage 18/19", read 21/22.)*

**Stage 1 `precheck` (addition).** It resolves the capture root (D11a) and refuses when the root
is unset, relative, not creatable or inside the invoking checkout. Nothing else changes.

**Stage 2 `afl-api-adjudications-capture`.** Owner DSN. Every refusal happens **before
`recreate`**, so a refusal leaves the database untouched. The order:

1. **Read the pending state.** Read the database marker and the pending file at
   `<capture root>/<database>/afl-api-identities.capture.json`. Parse the file: format v1, the
   target database, both sections' structure and the hash. A v2 file refuses.
2. **Read the live state in one `REPEATABLE READ READ ONLY` transaction.**
   - The ledger section, as ISSUE-235 reads it.
   - The importer section, with the forward identity (`readAflApiImporterRows`).
   - The D5 census.
   - The D7 identity rules: each importer row has **exactly one accepted stable identity**.
   - The D13 capture checks: sets, disjointness and uniqueness.
   - The ledger bijection.
   - **`E_rebuild` over the live snapshot (D9, rebuild semantics).** If it is non-empty, **STOP
     before destruction**, naming each overlapping provider. The overlap is broken pre-existing
     state, and it is repaired by hand outside the rebuild. It is never carried across the reset.
   - The combined pending decision (D11c).
   - For `verify-reinstated`, the read-only replay observation: insert 0, stop 0, supersede 0,
     plain two-section equality, and the invariant.
3. **Act on the decision.**
   - **capture-live.** Write the combined file (tmp + rename). Then, in a separate short
     transaction, set the marker to `{format, version, capturedAt, payloadSha256, fileSha256}`.
     If the marker fails, REFUSE: `recreate` does not run, and the file left behind is handled by
     the next run's "marker absent, file present" row.
   - **verify-reinstated.** Archive the pending file, clear any marker, then capture-live as
     above.
   - **adopt-pending** (`--recover`). Keep the file, and set the marker to the file's hashes if it
     is absent.
   - **refuse.** Exit non-zero.
4. **Print** the per-section counts, the importer per-method counts, the file path, the file
   sha256, the payload sha256 and the marker state.

**Stages 3–17.** Unchanged. `recreate` resets the database in place. That the marker survives it
is a proven prerequisite (P-M, D11d), not an assumption.

**Stage 18 `afl-api-adjudications-reinstate`.** Owner DSN, **one read-write transaction** (D12).

- **Preconditions** (refuse with nothing written):
  - the pending file exists at the capture root and parses;
  - the marker is present and equal to the file's `payloadSha256`/`fileSha256`.
- **Before any mutation: re-derive `E_rebuild` and require it empty.**
  - It is a pure computation over the capture file alone, with no database read, and it does
    **not** rely on Stage 2 having checked.
  - It evaluates the D9 agreement predicate between the capture's importer section and its ledger
    section, on conditions 1–5 only. Condition 6 (remap) needs a database and is **not** required
    to refuse. Any capture meeting 1–5 for some provider is already refused, which is stricter.
    The capture's own disjointness check (D13) refuses *any* provider overlap, agreeing or not.
  - **If `E_rebuild ≠ ∅`, it is a hard STOP.** Nothing is written, the marker is kept, and each
    provider is named.
- **In order, inside the transaction:**
  - **(a) Importer replay by stable identity (D9).** For each captured importer row, reverse-resolve
    `playerIdentity` to exactly one player (D7). Plan against the current rows. **Any STOP throws
    and rolls back everything.** INSERT the verbatim row with the resolved `player_id`.
  - **(b) Ledger reinstatement.** Unchanged ISSUE-235 behaviour: original ids, sequence and actors.
  - **(c) The D15 replay, with `expectedSupersedes = {}`.** `actualSupersedes` must be `{}`. **Any**
    supersede is a **hard STOP**, and the whole of Stage 18 rolls back (the marker is kept).
  - **(d) Exact parity plus the combined invariant (D13).**
  - **(e) Clear the marker.**
- **Then** commit, and then archive the capture as
  `afl-api-identities.<stamp>.<sha12>.reinstated.json`. A crash after the commit and before the
  archive is recovered by the "marker absent, file present, live equal" row.
- **Print** the importer rows inserted per method, the ledger rows, human inserted/no-op,
  `expectedSupersedes = {}` / `actualSupersedes = {}`, and the parity result.

**Stage 19 `afl-api-adjudications-bijection`.** Read-only. It is now the standalone
`assertAflApiIdentityInvariant()` (D13):

- the D5 census;
- the D15 bijection;
- one row per player;
- every importer row has exactly one accepted stable identity;
- **plus the marker is absent.**

It prints the per-method counts.

**Stages 20–25.** Unchanged.

**Why position 18 (R6).**

- **Why not earlier.** The earliest *correct* point is after `fitzroy` (stage 7), the last writer
  of AFL Tables identities (F10). Nothing between `fitzroy` and `draftguru` reads or writes
  `afl_api` rows.
- **Why 18.** Co-location in the existing ledger transaction gives one atomic unit with one
  recovery source (D10–D12). That outweighs the earlier moment.
- **Nothing downstream depends on it.** No later stage reads `afl_api` identities (grep of
  `tools/migration` and `tools/rebuild`), and the validation stages still follow.

### 6.2 Production promotion — exact gates

Grades: **FAIL** stops the promotion before the swap. **INFO** is listed in the promotion record.
Production has **no WARN grade** for any `afl_api` gate.

| Step | ISSUE-237 addition |
|---|---|
| §3 `--phase source` (`afldb_test`) | **G1 source census** (D14). **FAIL** on: any D5 anomaly; any `resolved` `afl_api` row; any ledger row; any importer row without exactly one accepted stable identity (D7); a player holding more than one `afl_api` row; a rebuild marker present. Per-method counts are printed. |
| §5 `--phase pre-cutover` (live target) | **Target census, written into the snapshot:** importer rows as `(external_id, stable identity, match_method)`, grouped by method; human `resolved` rows; net-linked ledger entries. **FAIL** if the target breaks the D15 bijection, holds a D5 anomaly, or has an importer row without exactly one accepted stable identity. A target like that cannot be promoted consistently. |
| §6 restore | Nothing. The importer rows arrive in the dump (D2). |
| §7 reinstate | Nothing new. The ledger is staged and remapped exactly as ISSUE-235 does it. `external_identities` is rebuilt and untouched. |
| §7 `--phase restored` (candidate + old) | **G2 human-vs-importer overlap**, then **G3 cross-lineage importer comparison**. Both are defined below the table. |
| §7.5 `--phase candidate` | **G1 on the candidate:** zero `resolved` rows before D15, D5 census, D7, and the one-row-per-player rule. |
| §8 swap, then `--phase production` | Unchanged. |
| §8 step 1, after `replay_admin_overrides('players')` | The **D15 replay with supersede** (D9, **promotion semantics**; this is not the rebuild rule). `E_promotion` is the promotion record's G2 AGREE list, a required input fixed before the swap. It may be non-empty. The replay supersedes only providers in `E_promotion`, and only when all six D9 conditions hold, re-checked against the live post-swap rows, including "remapped player agrees". The actual superseded provider set must equal `E_promotion` exactly: zero if it is empty, exactly those provider ids otherwise. A missing or additional supersede is a hard STOP that rolls back the replay transaction, with nothing written. Then the **combined verify** script (`assertAflApiIdentityInvariant`), which replaces the bijection-only script. |
| §9 current season | Unchanged. Importer-linked providers resolve on the first supervised settle. |

**G2 — human-vs-importer overlap** (`--phase restored`). For each net-linked entry of the
**reinstated** ledger, compare its stored `player_identity` with the candidate's `afl_api` rows by
forward identity:

- **AGREE → PASS.** The provider satisfies the D9 agreement predicate against the candidate: same
  provider; byte-identical stable identity; `unique` status; an approved method (a full D5 row);
  effective ledger state `LINKED`; and the ledger identity remaps to the candidate row's own
  player. The provider is listed as "will be superseded". **The AGREE list is `E_promotion`.**
  It may legitimately be non-empty, unlike `E_rebuild`.
- **DISAGREE → FAIL.** Same provider, different identity.
- **COLLISION → FAIL.** The ledger identity is held by a candidate row under another provider.
- **UNSUPPORTED → FAIL.** The candidate row for the provider is not a full D5 importer row.
- **UNEVALUABLE → FAIL.** The ledger identity is a `manual_admin_edit` token. It cannot be evaluated
  before the players replay, so it fails closed.
- **INFO.** A candidate importer row for a provider whose latest ledger action is `revoked`. A
  revoke is an undo, not a negative assertion.

**G3 — cross-lineage importer comparison** (`--phase restored`, production). For every importer
row in the pre-cutover target census:

| Target row vs the candidate | Production grade |
|---|---|
| The candidate has the same provider, the same stable identity and the same method | PASS |
| Same provider, same identity, **different method** | **FAIL**. The carried meaning changed. The rebuild preserves the method exactly (D13), so a change means an unsupported rewrite. |
| Same provider, **different identity** | **FAIL** (ISSUE-238 owns correction) |
| The target's identity is held in the candidate by **another provider** | **FAIL** (collision) |
| **The provider is absent from the candidate (hard loss)** | **FAIL, no exception.** Production has no classified-regeneration path, because production has no importer target (F1). Every promoted importer identity is lost for good if it is dropped. |
| A candidate provider absent from the target (gained coverage) | INFO, listed |

**Why there is no importer replay in promotion (R7).** The possibilities, one by one:

- **Reinstated before the swap.** There is nothing to reinstate. The rows are rebuilt state that
  is already coherent with the candidate.
- **Replayed after the swap.** They are already present, so a replay has nothing to do.
- **Generated into the plan.** Unnecessary.
- **Captured from the live target.** Production's importer never writes there (F1). Promoted rows
  already there are protected by G3's hard-loss FAIL, not by a capture.
- **Reproduced from source.** Unavailable (§3.4).

What promotion *does* need is **human-first precedence without a post-swap stop**, plus **no
silent loss**. G2 and the D15 supersede provide the first. G3 provides the second.

### 6.3 DEV promotion (`--environment dev`) — exact gates, where they differ

G1, the pre-cutover census, G2, the §8 step 1 supersede and the combined verify are **identical to
production**. G3 differs in two rows only:

| Target row vs the candidate | DEV grade |
|---|---|
| Same provider, same identity, **different method** | **WARN + record** both methods. The identity agrees and nothing resolves differently. DEV's rows were written by DEV-lineage artefacts, and the candidate's come from `afldb_test`, so the evidence class can legitimately differ. |
| **Hard loss (the provider is absent from the candidate)** | **FAIL**, *unless* the row satisfies **every** condition of the DEV regeneration exception below, in which case **WARN + record**. |
| Every other row | As production (PASS / FAIL / INFO). |

**The DEV regeneration exception.** A lost target row is admitted as WARN only when **all** of
these hold:

1. **Environment.** `--environment dev`. The production code path never evaluates the exception.
2. **Class.** The target row's `match_method` is `afl_api_stat_vector_season`. That is the
   current-season, environment-local class: its evidence is the environment's own canonical
   current-season data, and it alone carries a lineage gate (`built_from_database`, §3.4), so it
   can be honestly regenerated on DEV. Rows of `afl_api_stat_vector_bootstrap`,
   `afl_api_name_team_season_bootstrap` and `afl_api_manual_adjudication` are **never** eligible,
   so a loss of any of them is FAIL.
3. **Explicit classification.** The provider is listed in an operator-authored, hash-bound
   classification file passed to `--phase restored`. The proposed flag is
   `--afl-api-dev-regeneration <path>`, and the proposed format is
   `afldb.afl_api_dev_regeneration_classification` version 1:

   ```text
   { database: 'afldb_dev', season, reason, reacquisitionPlan,
     entries: [{ externalId, playerIdentity, matchMethod }], payloadSha256 }
   ```

   - **Entries must match.** Every entry must equal a target row in the pre-cutover census exactly
     (provider, identity and method), and that row must be absent from the candidate. An entry that
     does not match is a **FAIL** (a stale or wrong classification).
   - **Unlisted losses FAIL.** A lost row that is not listed is a **FAIL**. Nothing is inferred and
     nothing is defaulted.
4. **No collision.** The listed identity is not held in the candidate by another provider. If it
   is, the collision FAIL still applies.
5. **Recorded.** The promotion record carries the WARN, the full list, the file's sha256 and the
   count.

**The mandatory post-re-acquisition verification census.** An exception that was used makes the
DEV promotion **not accepted** until this census passes:

- **When it runs.** After §9 current-season re-acquisition and the existing target-bound
  regeneration: the DEV emitter, then `import --target dev` validate-only → dry-run → apply. The
  promoted lineage is now DEV's own, so the season class's provenance gate is honestly satisfied.
  No code change is needed.
- **What runs.** A read-only census. The proposed form is `promotion-check.ts --phase
  dev-regeneration-census`, run with the same classification file.
- **What it requires.** **Every** listed entry must again be present on `afldb_dev`, with the same
  `external_id`, the same stable identity, `match_method='afl_api_stat_vector_season'` and
  `status='unique'`.
- **Outcomes:**
  - An entry is still absent → **FAIL**.
  - An entry is present under another identity → **FAIL**, which ISSUE-238 owns.
  - An entry is present under another method → **FAIL**.

  A FAIL leaves the DEV promotion recorded as not accepted, with the gap listed. There is no
  automatic repair.
- **Recorded.** The census result and the classification hash go into the DEV promotion record.

**No `historicalOnly` relaxation.** Nothing here relaxes a DEV `historicalOnly` rule; the ledger
still has no `historicalOnly` entry.

## 7. Capture format and adapters

### 7.1 File

The file is `<AFLDB_REBUILD_CAPTURE_ROOT>/<target>/afl-api-identities.capture.json`. It is outside
every checkout (D11a) and never tracked. It holds admin emails from the ledger section.

```text
{ format: 'afldb.afl_api_identities.rebuild_capture', version: 1, database, capturedAt,
  ledgerTablePresent, ledgerRows: CapturedLedgerRow[] /* ISSUE-235 v2 row shape, unchanged */,
  importerRows: CapturedImporterRow[] /* D6, ordered by externalId */, payloadSha256 }
```

- `payloadSha256` covers every field of both sections in fixed tuple order, as
  `capturePayloadSha256` does today.
- The database marker holds `{format, version, capturedAt, payloadSha256, fileSha256}` (D11b).
- Archiving renames the file to `afl-api-identities.<stamp>.<sha12>.reinstated.json` in the same
  directory.
- `parse*` proves the format, target database, both sections' structure (D5/D6) and the hash.

### 7.2 Code placement

These choices reuse existing code and add no second identity lookup.

| Unit | Location |
|---|---|
| Pure logic | `src/lib/acquisition/afl-api-adjudication.ts`, a new §5 holding: `AFL_API_IMPORTER_MATCH_METHODS`; the captured-row structure problems; `planAflApiImporterReplay()` (D9); `importerParityProblems()` (D13); the census classifier used by G1 and the invariant; the G2 overlap classifier; the G3 cross-lineage classifier (production and DEV grades, and the regeneration-exception validator); and the **supersede branch** in `planAflApiAdjudicationReplay()`, with a new `supersedes` output restricted to the OD-2 transition |
| DB adapter | `tools/migration/replay_afl_api_adjudications.ts` (extended): `readAflApiImporterRows(tx)`, which reads with a forward identity through `LINEAGE_IDENTITY_SQL`; `replayAflApiImporterRows(tx, rows)`; the D15 supersede UPDATE, which takes the expected-supersede list; `assertAflApiIdentityInvariant(tx)`. Every function takes a `TransactionSql`, never a pool |
| Rebuild tool | `tools/migration/rebuild_afl_api_adjudications.ts` (extended): the combined format; the capture root (D11a); the database marker; the generalised pending decision (D11c); reinstate order (a)–(e) |
| Rebuild runner | `tools/db/rebuild-test.ts`: the `precheck` capture-root check, and the stage names, comments and header |
| Promotion checker | `tools/db/promotion-check.ts`: `gateAflApiIdentities` (G1 and the pre-cutover census, per phase); `gateAflApiOverlap` (G2 and G3, `restored` only, with the `--afl-api-dev-regeneration` input on DEV); and the `dev-regeneration-census` phase. All of them call the pure classifiers |
| OD-4 recovery (one-off) | Proposed: `tools/migration/recover_afl_api_importer_identities.ts` (§11a). It reuses `readAflApiImporterRows`, `planAflApiImporterReplay`, `replayAflApiImporterRows` and `importerParityProblems`. It has no identity logic of its own |

### 7.3 The one normative change to ISSUE-235

D15's table gains exactly one row: "a full D5 importer row, same provider, same stable player
identity, same remapped player → supersede, `unique`/<approved importer method> →
`resolved`/`afl_api_admin_adjudication`". Everything else in D15, D10 and the ledger is unchanged.
**Approved (OD-2, 2026-09-24).**

## 8. Non-destructive implementation rule

Start with code and DB-free tests. As part of implementation, do **not**:

- run `db:test:rebuild`;
- pass `--acknowledge-destroy`;
- write to DEV;
- run a promotion;
- run a bridge `--apply`;
- run the OD-4 recovery tool against any database.

Integration tests run only against `afldb_test`, in transactions that roll back.

## 9. Required DB-free tests (extend existing suites)

**`tests/player-link-mutations.test.ts`** (the pure-module block):
- **Constants:**
  - `AFL_API_IMPORTER_MATCH_METHODS` equals the loader's `ALLOWED_MATCH_METHODS`, read from the
    `.py` source text.
- **Capture structure:**
  - duplicate provider refuses;
  - duplicate identity refuses;
  - an unsupported method refuses;
  - `candidate_count ≠ 1` refuses;
  - a non-NULL url refuses;
  - an empty identity refuses.
- **`planAflApiImporterReplay`**, every D9 row:
  - insert;
  - identical no-op;
  - same player with a different method → STOP;
  - different player → STOP;
  - player collision → STOP;
  - an existing human row with the same or a different player → STOP;
  - unresolvable → STOP;
  - ambiguous → STOP;
  - an old id remapped to a **different** new id through its identity.
- **`importerParityProblems`:**
  - a missing row fails;
  - an extra row fails;
  - a retargeted identity fails;
  - a changed method fails;
  - a changed notes value fails;
  - an identical set passes.
- **D15 supersede (OD-2):**
  - AGREE (same provider, same identity, same remapped player, full D5 row) → a supersede, not a
    STOP;
  - same provider, same `player_id`, but a different stored identity → STOP;
  - an importer row for a different player → STOP;
  - a `unique` row under an unsupported method → STOP;
  - a `unique` row with `candidate_count ≠ 1` or a non-NULL url → STOP;
  - a non-identical human row → STOP;
  - a player holding another provider → STOP;
  - a superseded row satisfies the bijection;
  - supersede never applies to a `resolved` row.
- **The agreement predicate (D9):**
  - it holds only when all six conditions hold;
  - each condition, violated alone, makes it false: a different `external_id`, an identity that
    differs by one byte, a non-`unique` status, an unapproved method, a revoked latest ledger
    action, a remap to another player.
- **Rebuild semantics, `E_rebuild` (the pure check shared by Stage 2 and Stage 18):**
  - an accepted, non-overlapping capture → `E_rebuild = ∅`, expected supersedes `{}`, actual
    supersedes `{}` → pass;
  - a **synthetic overlapping capture** (an agreeing importer row plus a `LINKED` ledger entry
    for the same provider) → **refused**. There is **no** successful supersession path, and the
    refusal names the provider;
  - an **unexpected supersede** reported by the D15 replay while `expectedSupersedes = {}` →
    refused.
- **Promotion semantics, `E_promotion = G2.AGREE` (the non-empty exact-set tests kept):**
  - `E_promotion` empty with zero actual supersedes → pass;
  - `E_promotion` empty with one actual supersede → STOP;
  - `E_promotion` non-empty and equal to the actual set → pass;
  - a provider missing from the actual set → STOP;
  - an additional provider in the actual set → STOP;
  - a provider in `E_promotion` whose remap no longer agrees at replay time → STOP;
  - the promotion replay takes G2's AGREE list, never a set it derives itself.
- **Classifiers:**
  - census: every anomaly class;
  - G2: AGREE, DISAGREE, COLLISION, UNSUPPORTED, manual-token FAIL, revoked INFO;
  - G3 production:
    - hard loss → FAIL for **every** method, including `afl_api_stat_vector_season`;
    - method change → FAIL;
    - disagreement → FAIL;
    - collision → FAIL;
    - gain → INFO;
    - a classification file supplied under production → refused;
  - G3 DEV:
    - an unlisted loss → FAIL;
    - a listed season-class loss → WARN;
    - a listed loss of another class → FAIL;
    - a listed entry that does not match a target row → FAIL;
    - a listed entry still present in the candidate → FAIL;
    - a tampered classification hash → refuse;
    - method change → WARN;
  - DEV regeneration census:
    - all regenerated → PASS;
    - one absent → FAIL;
    - one under another identity → FAIL;
    - one under another method → FAIL.

**`tests/db-test-rebuild.test.ts`** (the C6/OD-5 block and the I18 harness):
- **Stages:**
  - 25 stages, ids unchanged, capture at ordinal 2 before `recreate`, reinstate at 18 after
    `draftguru`, bijection at 19;
  - the stage names and env still carry the owner DSN only for capture and reinstate.
- **Capture root (F5):**
  - unset → `precheck` refuses;
  - relative → refuses;
  - inside the invoking checkout → refuses;
  - two different simulated `cwd` values with the same root resolve to the same capture
    directory;
  - no capture path is derived from `process.cwd()`.
- **Combined capture:**
  - build, parse and hash round-trip;
  - a v2 file refuses;
  - the wrong database refuses;
  - a tampered payload refuses.
- **Generalised `decidePendingCapture`**, every D11c row, including:
  - marker present with the file absent → refuse, and **never** capture-live, even with `--recover`;
  - marker present with a mismatched file → refuse;
  - marker present, file matching, live empty → refuse without `--recover`, adopt with it;
  - importer-only pending with an empty live database → refuse;
  - both sections empty with no marker → capture-live;
  - equal → verify;
  - a differing importer section → refuse;
  - **no decision splits the sections**: ledger adopt with importer capture-live is unrepresentable.
- **Database marker:**
  - it is set only after the file rename;
  - a marker-set failure → refuse before `recreate`;
  - reinstate clears the marker inside the transaction (fake transaction);
  - a rollback leaves the marker in place.
- **Refusals before destruction** (D5, D7, D13), each proven to leave `recreate` unexecuted:
  - no identity;
  - two AFL Tables paths;
  - a manual-token-only player;
  - an anomalous row;
  - an orphan human row;
  - overlapping sections.
- **Reinstate order** (fake `tx`):
  - importer replay before ledger reinstatement, before the D15 replay, before parity, before the
    marker clear;
  - one failure → nothing committed and the marker kept;
  - `E_rebuild` is re-derived from the capture **before** the first mutation call;
  - an **accepted rebuild capture** → zero expected and zero actual supersedes, and it commits;
  - a **synthetic overlapping rebuild capture** → **refused** before any mutation call, nothing
    committed, marker kept. It must never supersede;
  - an **unexpected Stage 18 supersede** (the fake D15 replay reports one) → throw, **rollback**,
    nothing committed, marker kept;
  - `verify-reinstated` → plain two-section equality, supersede 0.
- **Stage 2 overlap refusal:**
  - a live snapshot with an agreeing importer/`LINKED`-ledger overlap → STOP **before
    `recreate`**, provider named;
  - a pending capture file that derives a non-empty `E_rebuild` → refused, never adopted or
    verified, even with `--recover`.
- **Marker survival prerequisite P-M (D11d), point 1:**
  - for `afldb_test` and `code_test_db`, `recreate` runs only `RESET_SQL` in place;
  - no stage from capture to reinstate drops or recreates the database object;
  - `RESET_SQL` contains no `DROP DATABASE` or `CREATE DATABASE`;
  - a synthetic stage that would drop or recreate the database fails the test.
- **I18 harness:**
  - importer rows are now expected, and it no longer says "not checked".

**`tests/db-promotion-check.test.ts`**:
- **G1:** each phase's expectation, including the rebuild-marker FAIL on a source.
- **Pre-cutover census:** it is in the snapshot, as `(external_id, identity, method)`.
- **G2/G3:** only in `restored`, graded as §6.2 and §6.3 state, and the production code path
  never reads a classification file.
- **Contract text:** the stale `.py`/`common.py` wording is fixed (F11).

**OD-4 recovery tool** (the closest existing home, `tests/db-test-rebuild.test.ts`, unless a
closer suite exists at implementation time):
- **Export parse and hash.** A tampered export refuses. So does a wrong `sourceDumpSha256`.
- **Target guard.** Any database other than `afldb_test` refuses. So does a present rebuild
  marker.
- **Existing importer rows.** A non-identical existing importer row refuses.
- **Validate-only and dry-run** roll back.
- **Fail closed.** Any unresolved or ambiguous identity rolls back everything (OD-1).

## 10. Required integration tests (`afldb_test`, `_test` guard, rolled-back transactions only)

Extend the ISSUE-235 I14–I16 home (`tests/integration/settle-afl-api.test.ts` with
`afl-api-adjudication-fixtures.ts`):

- **Importer read.** `readAflApiImporterRows` against the real schema returns the unprefixed
  identity, and refuses a two-path fixture player.
- **Renumbering.** A fixture player's row is re-created under a new id with the same AFL Tables
  identity, and the replay links it to the **new** id.
- **Constraints.** Each D9 STOP is proven against the real UNIQUE constraint and the per-player
  index.
- **D15 supersede against the real table.** The id is kept, the bijection passes, and a second
  replay is a no-op. An unsupported-method fixture row STOPs.
- **Combined invariant.** It passes on a consistent fixture and fails for each anomaly class.
- **Marker (P-M points 2 and 4).** Inside one rolled-back transaction: set a test marker, run the
  exact `RESET_SQL`, and confirm the marker is still present. After the rollback, the comment's
  pre-test value is unchanged. A rolled-back reinstatement leaves the marker in place.
- **Settle.** The resolver resolves a replayed importer row (the E13 path).
- **Teardown.** Fixture importer rows are removed as the owner role, as for the ledger fixtures,
  so the next rebuild neither carries nor stops on them.

### 10.1 S6 run record (2026-09-25)

**Initial operator run:** `npx vitest run tests/integration/settle-afl-api.test.ts -t "AFLDB-ISSUE-237"`
gave **5 failed / 4 passed** across the 8 I237 cases plus the I237 fixture-leftover gate (the
gate passed). No production code was changed to resolve any of the five. Every fix is in test
fixtures or assertions, and no ISSUE-237 invariant was relaxed.

| # | Case | Root cause | Class | Disposition |
|---|---|---|---|---|
| 1 | D9 STOPs against the real UNIQUE constraint and the per-player index | Cross-case leakage. The renumbering case commits `CD_I9992370001` on player A and nothing removed it. D9's first seed then put `CD_I9992370004` on the same player A, an impossible live state that migration 104's `uq_external_identities_afl_api_player` rightly rejected before the planner ran. Its third sub-case also silently depended on that leaked row. | Fixture defect | A per-case `afterEach` (`cleanupI237ProviderRows()`, which removes I237 provider and ledger rows by literal id only). D9 now seeds only legal states, including its own occupant for the per-player case. It asserts each STOP's exact D9 reason, not just the abort class. The per-player contract is proven at **both** layers: the planner STOP, and the real index refusing a direct write. The index is untouched. |
| 2 | D15 supersede (OD-2) | The **first** replay superseded correctly: `CD_I9992370003` was `unique`/`afl_api_stat_vector_bootstrap`/`candidate_count 1`/NULL URL on player B, whose sole identity is `players/Z/Issue237-I1-test-b.html`; the ledger `linked` row names the same identity, so the remap is player B; the id was kept and the bijection held. The failure was the test's **second** call (line 3877). It re-passed the first run's expected set `{CD_I9992370003}`, but the row was by then a human row, so D13's exact-set check correctly aborted (`missing: CD_I9992370003`). | Test defect | The re-run now passes the expected set a caller would derive from current state (`{}`), and gets a no-op. The test also now **pins** that re-passing the stale set fails closed with nothing written. D15/D13 are unchanged. |
| 3 | Combined invariant | `CD_I297354` is **not** pre-existing `afldb_test` data. It is the file's own root ISSUE-228 baseline fixture (`BRIDGED_PROVIDER_PLAYER_ID`, synthetic player `legacy_player_id -228000001`, "Karl Amon (ISSUE-228 test fixture)"). It is re-seeded before every case and deleted by the root `afterAll`. It was inserted without `candidate_count` (column default 0, where the real loader always writes 1), and its player had no AFL Tables identity. So it was a genuine D5 anomaly, and D7-unresolvable too. A read-only `afldb_test` check (2026-09-25, outside any run) found **zero** `afl_api` rows, an empty ledger, and no I237/ISSUE-228 fixture players. No data-correction issue is needed, and none is covered elsewhere. | Fixture defect (ISSUE-228 baseline) | The baseline now seeds the exact loader shape (`candidate_count 1`) plus a synthetic AFL Tables identity (`players/Z/Issue228-bridged-test.html`), and root `cleanup()` removes it. The invariant stays **whole-table**, and no row is excluded. |
| 4 | P-M point 2 (D11d) | The test read the database comment with `obj_description()`, which reads the per-database `pg_description` and is always NULL for a `pg_database` oid. A database comment lives in the shared `pg_shdescription`. | Test defect | `shobj_description(oid, 'pg_database')` at all four reads, as the L2 proof used. Marker production code unchanged. |
| 5 | §10/E13 settle resolver | Same leakage as #1. The E13 capture re-derived to player A, which still held `CD_I9992370001`, so the planner correctly STOPped on the one-provider-per-player rule. | Fixture defect | E13 now uses a dedicated fixture player D (`legacy_player_id -237140004`, `players/Z/Issue237-I1-test-d.html`), added to `I237_FIXTURE`, `I237_OWNERSHIP`, `cleanupI237Fixtures()` and so to the leftover gate. The per-case `afterEach` also makes it independent of anything before it. |

**Knock-on effects in the same file (outside the I237 filter), found by a full-file run:**

- *ISSUE-235 I15 ("an importer unique row … SAME player still stops the replay").* This failure
  does not come from the fixes above. It is caused by this branch's own D9/OD-2 planner change: an
  agreeing full importer row with an empty expected set now STOPs with the more specific reason
  "an agreeing importer row exists for this provider but is not in the expected supersede set".
  The STOP and the "nothing written" assertions are unchanged; only the expected reason text
  was updated.
- *ISSUE-235 OD-5 reinstate (rolled back).* Exposed by fix #3. The case simulates "the state a
  reset leaves", but it had only deleted its own rows. It passed only because the malformed
  baseline row was invisible to `reinstateAndReplay()`'s "no importer rows" precondition. It now
  also deletes the baseline importer row inside its always-rolled-back transaction, as a real
  reset would.
- *Observation, not changed:* that precondition counts only `readAflApiImporterRows().rows`
  (well-formed rows with a resolvable identity). A malformed `afl_api` row would pass it and be
  caught only later, by the Stage 19 invariant. No production defect is demonstrated, so this is
  recorded for review only.

**Final S6 result (2026-09-25, Claude-run against `afldb_test`, fixtures only):** each of the
five previously failing cases passed **in isolation**. The whole filter
`-t "AFLDB-ISSUE-237"` gave **9 passed / 0 failed** (8 I237 cases + the leftover gate).
The whole file `tests/integration/settle-afl-api.test.ts` then gave **70 passed / 0 failed**. The
first full-file pass had found the two ISSUE-235 knock-ons above (68/70); they are fixed as
described. Regression: `tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` 47/47 passed;
`tests/player-link-mutations.test.ts` 91/91 passed.
`npx tsc --noEmit` clean; `git diff --check` clean. No destructive rebuild ran, no persistent
manual `afldb_test` mutation was made (the only direct queries were two `READ ONLY` transactions),
and no Git write occurred.

## 11. Destructive and live validation (operator-gated; NOT run by this review)

| # | Step | Gate |
|---|---|---|
| L0 | **The OD-4 recovery prerequisite (§11a).** First prove the **candidate** authoritative pre-I18 backup (R1.1–R1.5). Only then restore `afldb_test`'s importer state from it (R2–R5), through stable identity, with exact parity proven. **Old bridge artefacts are never re-applied.** | Operator. If R1 does not pass, L3–L5 are **blocked** |
| L1 | `db:test:rebuild --target code_test_db` rehearsal, with the §11b rehearsal fixture seeded (one importer row, one disjoint human adjudication). Expect: parity PASS, one row per player, invariant PASS, the marker set at Stage 2 and cleared at Stage 18. **Exact commands: §11b.** | Operator, disposable DB. Independent of L0 |
| L2 | Crash rehearsal on `code_test_db`. Stop deterministically after the reset with `--rehearsal-stop-after recreate` (**never** Ctrl+C). Observe the marker and the pending capture independently. A normal rerun refuses without `--recover`, and **never** captures empty. Re-run with `--recover`: it adopts the capture, and parity passes. This is the P-M point 3 proof. The other-worktree, empty-capture-root and post-commit/pre-archive variants remain optional extensions. **Exact commands: §11b.** | Operator, disposable DB. Independent of L0 |
| L3 | `db:test:rebuild` on `afldb_test`, **after L0**. The captured importer count equals the replayed count, per method, and equals L0's parity census. The invariant holds, and the settle resolver resolves a sample provider. | Operator, destructive. **Blocked until L0 passes** |
| L4 | At the next DEV promotion, record G1/G2/G3 with every row's grade. D15's actual superseded set must equal G2's AGREE list (`E_promotion`) exactly. If the DEV exception is used, record the classification file and complete the post-re-acquisition census. | Operator. **Blocked until L3 passes** |
| L5 | PROD, only inside the next scheduled production promotion. G3 hard loss is FAIL. | Operator. **Blocked until L4 passes** |

*(Annotation 2026-09-25: **L0 PASS** (R1–R5, §11a.1, §11a.2.3). **L3 is additionally blocked by
AFLDB-ISSUE-245.** On the current `afldb_test`, a rebuild destroys the 92 ISSUE-224 registrations
that 92 of the 802 captured identities need, and nothing replays them, so Stage 18 STOPs and
`--recover` cannot complete (§11a.3). The rows above are unchanged.)*
*(Annotation 2026-09-25: **L3 PASS** (§11a.6); the ISSUE-245 block is cleared and ISSUE-245 is
resolved. **L4 is prepared, NOT RUN** (§11d). **L5 is NOT RUN.** The rows above are unchanged.)*

## 11a. OD-4 recovery prerequisite — restoring `afldb_test`'s importer state

**Why it is needed.** `afldb_test` has held 0 importer rows since I18. L3 cannot prove carry-through
on an empty set. `afldb_test` is also the promotion source, so a promotion from it now would lose
every target importer row. G3 would FAIL that on PROD once promoted rows exist, and on DEV for
every non-season class.

**What is forbidden.**

- Applying any old bridge artefact that carries bare `candidate_player_id` values, for any class
  (F3, F15).
- Regenerating the bootstrap, name or manual classes against the rebuilt `afldb_test`.
- Treating DEV's 669 rows as a reproduction of the former `afldb_test` set. They are a different
  lineage, and the former set was measured as 802 immediately before I18.
- Guessing any count or identity that R1 does not establish.

**R1 — Prove the candidate authoritative pre-I18 backup.**

**The candidate.**
`D:\backups\afldb\issue-235\afldb_test-pre-i18-20260924-094554.dump` is the **candidate
authoritative pre-I18 backup**. It is the I18 safety backup, recorded with SHA256
`B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436` and retained by operator
instruction (`issues/closed/AFLDB-ISSUE-235.md:682-683`, `:923-926`). **It is not
authoritative yet.** This runbook, the ledgers and every tool message call it the *candidate*
until R1 completes. It becomes authoritative only when **all** of R1.1–R1.5 pass, in order.

- **R1.1 Exact hash.** The file's SHA256 is **exactly**
  `B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436`.
- **R1.2 Successful isolated restore.** The dump restores without error into a temporary,
  non-production database:
  - it is operator-provisioned and never on the PROD host;
  - its name is none of `afldb`, `afldb_prod`, `afldb_dev` or `afldb_test`, nor any promotion
    candidate or target;
  - it is set `default_transaction_read_only = on` immediately after the restore.

  If no host or credential can provide such a database, R1 cannot complete.
- **R1.3 Exactly 802 importer rows.** A read-only census of the restored database counts
  **exactly 802** rows in the D5 importer set. It also finds zero D5 anomalies.
- **R1.4 Exact method counts.** The per-method counts are **exactly**:
  - `afl_api_manual_adjudication` 3;
  - `afl_api_name_team_season_bootstrap` 129;
  - `afl_api_stat_vector_bootstrap` 397;
  - `afl_api_stat_vector_season` 273.

  The source is `issues/closed/AFLDB-ISSUE-235.md:370-371`.
- **R1.5 Stable-identity resolution and invariants pass.** In one read-only repeatable-read
  snapshot of the restored database, all of these hold:
  - every importer row's player has exactly one accepted stable identity (D7 forward: one
    AFL Tables path, not manual-token-only);
  - providers are unique;
  - identities are unique;
  - no player holds more than one `afl_api` row;
  - the D15 bijection holds on the human side.

  The human side is expected to match the I18 pre-state (`:677-678`: provider `CD_I9991800001` on
  the fixture player, ledger 199/200/201). It is **excluded** from the export, because it is not
  importer state.

**If any of R1.1–R1.5 fails,** the candidate is **not authoritative**. No other source is
substituted, and R2–R5 do not run.

**If no authoritative pre-I18 state is established, destructive ISSUE-237 live validation
(L3–L5) remains blocked.** The issue then goes back to the operator. The operator may accept
L1/L2 evidence only, or choose another authoritative source. Claude does not pick one.

**Only after R1.1–R1.5 all pass may R2–R5 proceed.**

**R2 — Record the proof and freeze the source.**

- **Record the R1 evidence** in this runbook and in `issues.md`: the hash, the restore log
  summary, the census, the method counts and the invariant result.
- **Rename it.** From that point the backup is called the **authoritative pre-I18 backup**.
- **Keep the restored database read-only,** and make no further change to it.
- **When it is dropped.** Only after R5's evidence is recorded, on the operator's decision.

**R3 — Export through stable identity** (read-only, against the temporary database).

- **One transaction.** A single `REPEATABLE READ READ ONLY` transaction uses the S2 adapter
  `readAflApiImporterRows`: forward identity by `byId`, the D5 census and the D7 rules.
- **Fail closed.** **Any** importer row without exactly one accepted stable identity refuses the
  whole export (OD-1). There is no partial export.
- **What each row carries.** It carries `external_id` and the **exact** `match_method`, plus the
  D6 fidelity fields. `playerId` is audit only.
- **Output.** An export file, in the proposed format `afldb.afl_api_importer_identities.recovery_export`
  version 1:

  ```text
  { format, version, sourceDatabase, sourceDumpSha256, capturedAt,
    countsByMethod, rows: CapturedImporterRow[] /* D6 */, payloadSha256 }
  ```

  It is stored under `AFLDB_REBUILD_CAPTURE_ROOT`, never tracked. `countsByMethod` must equal R1's
  census.

**R4 — Resolve and restore on the current `afldb_test`, through a fail-closed one-off path.**

- **The tool.** The proposed `recover_afl_api_importer_identities.ts` (§7.2). It is **not** the
  bridge loader, reads no artefact `candidate_player_id`, and adds no loader target.
- **Refuses unless** all of these hold:
  - the target database is named `afldb_test`, reached through the owner DSN *(amended
    2026-09-25, §11a.2: the restricted `AFLDB_TEST_IMPORT_DATABASE_URL`. The owner DSN is used only
    when that is unset, and only with an explicit `--allow-owner-import-dsn`)*;
  - the export path and the expected `payloadSha256` are given;
  - the export parses and its hash matches;
  - no rebuild marker is present on `afldb_test`;
  - the D15 bijection holds on `afldb_test`;
  - `afldb_test` holds no importer row except rows identical to export entries.
- **Modes, in order:** `--validate-only` → `--dry-run` → `--apply`. The first two roll back.
- **One transaction for each mode.** Reverse-resolve every exported identity to **exactly one**
  current `afldb_test` player (OD-1). Plan with `planAflApiImporterReplay` (D9). **Any** STOP
  rolls back everything: an unresolved, ambiguous or collision identity, a differing existing row,
  or a human row on the provider. Otherwise INSERT, check parity (R5) and the combined invariant,
  then commit (apply only).
- **The meaning of the result.** The recovered rows are `afldb_test`'s authoritative accepted
  importer identity state. They preserve established decisions, and they are not re-verified
  against current canonical data (F12).

**R5 — Prove exact parity.** Inside the apply transaction before commit, and again afterwards in a
read-only census:

- **Exact projection.** `afldb_test`'s importer projection `(external_id, forward stable
  identity, match_method, status, candidate_count, external_name, external_url, notes)` equals the
  export **exactly, as a set**.
- **Counts.** The per-method counts equal R1's census.
- **No other importer row** exists.
- **Human side unchanged.** The D15 bijection and one-row-per-player still hold, and the human
  side is unchanged.

The census output, the export `payloadSha256`, the dump SHA256 and the per-method counts are
recorded in this runbook's evidence section and in `issues.md`.

**A possible R4 outcome is a refusal.** For example, a 2026 player created by a post-baseline settle
on the pre-I18 database may be absent from the current `afldb_test`. OD-1 forbids withholding it. A
refusal is reported to the operator with the unresolved providers named, nothing is restored, and
L3–L5 stay blocked until the operator decides.

### 11a.1 R1–R3 run record (2026-09-25)

**R1: PASS (operator-run).** The candidate dump
`D:\backups\afldb\issue-235\afldb_test-pre-i18-20260924-094554.dump` hashed to exactly
`B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436` (R1.1). It was restored into the
isolated temporary database `issue237_r1_restore` (R1.2). The census in one read-only session was:

```text
database|user_name|tx_read_only|default_read_only
issue237_r1_restore|afldb_owner|on|on

importer_rows|distinct_providers|distinct_players
802|802|802

afl_api_manual_adjudication|3
afl_api_name_team_season_bootstrap|129
afl_api_stat_vector_bootstrap|397
afl_api_stat_vector_season|273

bad_status|bad_candidate_count|null_player|bad_provider_id|duplicate_provider_rows|duplicate_player_links
0|0|0|0|0|0
```

That satisfies R1.3–R1.5 exactly. From this point the dump is the **authoritative pre-I18 backup**.

**R2: PASS.** `issue237_r1_restore` is owned by `afldb_owner`, has
`default_transaction_read_only = on`, and is frozen. It is not to be changed or dropped until R5's
evidence is recorded and the operator decides.

**R3: previously BLOCKED (2026-09-25).** `recover_afl_api_importer_identities.ts` was a library
only. It had no executable entry point. Nothing opened a read-only source session, proved the
source database, refused forbidden sources, wrote the file, or bound the export to the R1
census. Nothing was run, and no workaround was improvised.

**R3 CLI: now IMPLEMENTED; live R3 NOT YET RUN.** It is the same file, adds no identity logic, and
calls `exportAflApiImporterIdentities` unchanged. The operator runs:

```powershell
$env:AFLDB_ISSUE237_R1_DATABASE_URL = '<owner DSN naming issue237_r1_restore>'
npm run db:issue237:export-importer-recovery -- `
    --source-database issue237_r1_restore `
    --source-dump-sha256 B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436 `
    --output D:\afldb-rebuild-captures\issue-237-recovery\afl-api-importer-identities.json
```

- **Before connecting:**
  - only `export` is accepted;
  - `--source-database` must be `issue237_r1_restore`. The names `afldb`, `afldb_prod`,
    `afldb_dev`, `afldb_test`, `code_test_db` and any `/prod/i` name are refused;
  - the dump hash must be 64 hex characters equal to R1.1's hash;
  - the DSN comes only from `AFLDB_ISSUE237_R1_DATABASE_URL`, and its path must name the same
    database;
  - `--output` must be an absolute `.json` path. It must not exist, and it must not resolve inside
    this checkout or any Git checkout (junctions resolved).
- **Inside one `REPEATABLE READ READ ONLY` transaction, before any identity is read:** the live
  `current_database()` must be `issue237_r1_restore` and equal `--source-database`. Also,
  `transaction_read_only` must be `on`, `default_transaction_read_only` must be `on`, and
  `transaction_isolation` must be `repeatable read`.
- **After the library export:**
  - there must be exactly 802 rows, 802 distinct `externalId` and 802 distinct `playerIdentity`;
  - the per-method counts must be exactly 3 / 129 / 397 / 273, with no other method. These are
    re-derived from the rows, and the export's own `countsByMethod` must agree.
  - These are fixed constants, not options.
  - OD-1 still refuses any unresolved or ambiguous identity through the library.
- **Write:**
  - a `wx` temp file in the target directory, with fsync;
  - then a no-clobber hard link, so the export is never overwritten;
  - then a read-back through `parseAflApiImporterRecoveryExport`, which checks the dump hash, the
    payload hash and the R1 binding again;
  - finally the file SHA256 is printed.
  - Any refusal leaves no file. The DSN is never printed.
- **The runbook's capture location.** It named `AFLDB_REBUILD_CAPTURE_ROOT`. This one-off export
  takes an explicit `--output` instead, outside any checkout.
- **DB-free coverage:** `tests/db-test-rebuild.test.ts` → "R3 export CLI", 12 tests.

**Still to record once the operator runs R3:**

- the CLI's printed evidence (source proof, the 802/802/802 census, method counts);
- the dump SHA256, the `payloadSha256` and the file SHA256.

R3 is **not** PASS until then. R4 has **no CLI yet** and is not started.

**R3 first live run: FAIL (operator-run, 2026-09-25). The refusal was correct.** Under the literal
D7 contract then in force, a player with more than one accepted AFL Tables path was ambiguous.
The export refused the WHOLE export (OD-1) on exactly four providers:

```text
CD_I1006133
CD_I990609
CD_I990827
CD_I1020371
```

**Diagnostics (read-only, operator-run against `issue237_r1_restore`):**

- **S0:** 802 importer rows. Exactly these 4 are unresolved.
- **S6:** exactly these 4 players hold more than one accepted AFL Tables path.
- **S7:** each player holds exactly one AFL API provider. No adjudication ledger row touches these
  providers, players or paths.
- **S8:** each player's two paths exactly match one tracked `profile_url_continuity` rule:

| Provider | Rule | `continuing_url` | `renumbered_url` |
|---|---|---|---|
| `CD_I990609` | `2025-charlie-cameron-renumbered-profile` | `players/C/Charlie_Cameron.html` | `players/C/Charlie_Cameron3.html` |
| `CD_I990827` | `2025-jack-graham-renumbered-profile` | `players/J/Jack_Graham.html` | `players/J/Jack_Graham2.html` |
| `CD_I1006133` | `2025-jack-ross-renumbered-profile` | `players/J/Jack_Ross.html` | `players/J/Jack_Ross3.html` |
| `CD_I1020371` | `2025-jack-williams-renumbered-profile` | `players/J/Jack_Williams.html` | `players/J/Jack_Williams3.html` |

The target `afldb_test` was previously proven, read-only, to resolve both paths of each rule to the
same single target player.

**Cause.** The fitzRoy importer folds a renumbered profile into the continuing player and
registers **both** paths as that player's AFL Tables identities (AFLDB-ISSUE-136). The literal D7
rule could not tell that reviewed fold from a genuine two-footballer ambiguity.

**Operator decision (OD-7, 2026-09-25):** the narrow D7 continuity amendment in §4 D7. It is
general for any valid tracked pair, with no exception for these four provider ids.

**Implementation (2026-09-25): DB-free tested. No database was contacted, and R3 was not rerun.**

- Pure classifier: `classifyAflApiForwardIdentity` and `classifyAflApiForwardIdentityRows`
  (`src/lib/acquisition/afl-api-adjudication.ts`).
- Contract loader and validator: `src/lib/acquisition/fitzroy-profile-continuity.ts`. It mirrors
  `load_profile_continuity_rules()`.
- The two former copies of the lookup now delegate to the shared classifier:
  `readAflApiForwardIdentities` (`replay_afl_api_adjudications.ts`) and promotion-check's reader.
  `recover_afl_api_importer_identities.ts` is unchanged.
- Coverage:
  - `tests/player-link-mutations.test.ts` → "continuity amendment": the classifier, the no-sort
    proof, manual precedence, the real contract, and malformed/unreadable refusals.
  - `tests/db-test-rebuild.test.ts` → "AFLDB-ISSUE-237 continuity": reverse resolution, Stage 2
    capture and refusals, Stage 18 replay with parity and invariant, the unfolded-source parity
    refusal, and the R3 export with a folded player.
  - `tests/db-promotion-check.test.ts` → "promotion and rebuild forward identity agree".

**R3 remains PENDING a rerun** of the exact §11a.1 command above. It is not PASS. R4 is not
started. *(Superseded 2026-09-25: R3 PASS, below.)*

**R3 rerun: PASS (operator-run, 2026-09-25),** with the unchanged command above, under the OD-7
continuity amendment.

```text
export:  D:\afldb-rebuild-captures\issue-237-recovery\afl-api-importer-identities.json

source dump SHA256  B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436
payloadSha256       3cfad942dabed98d69452a71b6f57b82cc951b63109fb0152dc74f362f6bcb9b
file SHA256         870EA366C63E9C6C434E8A41340B024A43BC80D413E41FF99B1D398836175D35

rows 802 / providers 802 / stable identities 802

afl_api_manual_adjudication         3
afl_api_name_team_season_bootstrap  129
afl_api_stat_vector_bootstrap       397
afl_api_stat_vector_season          273
```

This matches R1.3 exactly. The export file is outside any checkout and is never tracked.

**S6 live integration: 9/9 PASS** (`tests/integration/settle-afl-api.test.ts -t "AFLDB-ISSUE-237"`,
8 I237 cases plus the leftover gate; operator-reported 2026-09-25, consistent with §10.1).

**Reverse-direction continuity tightening (2026-09-25): implemented, DB-free tested. No database
was contacted.** Before it, a replay resolved a continuity identity through `continuing_url` alone,
so a target holding the rule's two paths on DIFFERENT players could pass. The rule is now §4 D7's
"reverse direction" bullet: the target must prove both paths name the same single player, or the
replay/recovery/promotion STOPs.

- Shared classifier: `classifyAflApiReverseIdentity` + `aflApiReverseIdentityPaths`
  (`src/lib/acquisition/afl-api-adjudication.ts`). Consumers: `resolveAflApiPlayerIdentity`
  (`replay_afl_api_adjudications.ts`: Stage 18, D15, rebuild ledger reinstatement, R4) and
  `readAflApiReverseIdentities` (`tools/db/promotion-check.ts`, G2). An ordinary identity still
  issues exactly one lookup, as before.
- Coverage:
  - `tests/player-link-mutations.test.ts` → "classifyAflApiReverseIdentity": folded PASS; split,
    missing and ambiguous on either side STOP; ordinary paths unchanged; the source pair still
    normalises to `continuing_url`; both planners' STOP wording; G2 `CONTINUITY_CONTRADICTION`.
  - `tests/db-test-rebuild.test.ts` → Stage 18 refuses a split target (this **replaces** the
    earlier test that accepted it), and a missing or ambiguous path; R4 refuses a split target in
    every mode and a missing renumbered path; R4 + R5 accept the folded target.
  - `tests/db-promotion-check.test.ts` → the promotion G2 reader and the replay adapter return
    identical results across nine target states, and a split candidate fails G2.
- The real `afldb_test` state (both paths of each rule on one player, §11a.1 above) is the
  folded case, which stays accepted.

**R4 is NOT started.** It needs its own CLI and authorisation. ISSUE-237 is not resolved.

### 11a.2 R4 CLI (implemented 2026-09-25; live R4 NOT RUN)

**Status.** The reverse continuity guard is **COMPLETE** (DB-free, above). **R3 is PASS.** The **R4
CLI is implemented and DB-free tested.** No database was contacted while building it. **Live R4 is
NOT RUN**, and neither is R5.

**Operator commands.** Run them strictly in this order, and run each one only after the one before
it has printed `PASS`:

```powershell
$env:AFLDB_TEST_IMPORT_DATABASE_URL = '<afldb_import DSN naming afldb_test>'

npm run db:issue237:recover-importer-identities -- `
    validate-only `
    --export D:\afldb-rebuild-captures\issue-237-recovery\afl-api-importer-identities.json `
    --source-dump-sha256 B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436

npm run db:issue237:recover-importer-identities -- `
    dry-run `
    --export D:\afldb-rebuild-captures\issue-237-recovery\afl-api-importer-identities.json `
    --source-dump-sha256 B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436

npm run db:issue237:recover-importer-identities -- `
    apply `
    --export D:\afldb-rebuild-captures\issue-237-recovery\afl-api-importer-identities.json `
    --source-dump-sha256 B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436
```

If `AFLDB_TEST_IMPORT_DATABASE_URL` is unavailable, add `--allow-owner-import-dsn`. The owner
`AFLDB_TEST_DATABASE_URL` is then used deliberately. It is never substituted silently, and it is
never used while the import DSN is set.

**Expected result on the current `afldb_test`, which holds zero importer rows.** validate-only
reports `would insert 802`, `already identical 0`, `conflicts 0`. These are acceptance
expectations for this run, not constants in the recovery logic.

**Before any connection is opened.**

- **Arguments.** The mode must be exactly `validate-only`, `dry-run` or `apply`. `--export` and
  `--source-dump-sha256` are each required exactly once. The only other argument accepted is the
  bare `--allow-owner-import-dsn`.
- **Source dump hash.** It must be R1.1's hash.
- **Credential.** The DSN comes from the environment only, never from argv, and is never printed.
  Its path must name exactly `afldb_test`.
- **The export file** must be an absolute path to an existing file, and:
  - its bytes must hash to the R3 PASS file SHA256 `870EA366…75D35`;
  - it must parse through `parseAflApiImporterRecoveryExport`, which checks the format, version,
    dump hash and a self-consistent payload hash;
  - its payload hash must be the R3 PASS `3cfad942…bcb9b`, and its source must be
    `issue237_r1_restore`;
  - its rows must hold exactly the R1 census (`assertR3ExportBinding`): 802 rows, 802 providers,
    802 stable identities, and 3/129/397/273 per method. There must be no duplicate provider or
    stable identity;
  - every row must be a well-formed D5 importer row (`importerCaptureStructureProblems`).

**One transaction for each mode** (`recoverAflApiImporterIdentities`, in this order):

1. The live `current_database()` is exactly `afldb_test`.
2. The export is re-validated.
3. There is no rebuild marker. It is read by the rebuild's own `readRebuildMarker`, and a foreign
   database comment also refuses.
4. The D15 bijection and the D13 combined invariant (`assertAflApiIdentityInvariant`) hold before
   any write.
5. No live importer row exists except one identical to an export entry.
6. The D9 plan runs through `planAflApiImporterRowsLive`, the read half split out of
   `replayAflApiImporterRows`, so there is no second planner:
   - every stable identity is reverse-resolved, including the continuity reverse check;
   - it detects provider and per-player collisions, a human `resolved` row on the provider or on
     the target player, and a non-identical existing row;
   - any STOP refuses all 802 rows;
   - two planned INSERTs landing on one player also STOP.
7. **R5 projected parity.** `importerParityProblems` and the per-method census are checked over the
   identical live rows plus the planned INSERTs.

Then each mode finishes differently:

- **validate-only.** It runs in a `REPEATABLE READ READ ONLY` transaction and writes nothing. It is
  always ROLLED BACK.
- **dry-run.** It runs the apply path inside a savepoint:
  - it INSERTs every planned row;
  - it re-reads, then runs R5 parity (exact projection and per-method counts) on the written state;
  - it runs the D15 bijection and the D13 combined invariant.

  Then the savepoint and the transaction are both ROLLED BACK unconditionally.
- **apply.** It runs the same steps in the transaction itself. It COMMITs only after all of them
  pass. Any throw rolls back all 802 writes.
- **Existing rows.** An existing identical row is counted as `already identical` and never
  re-inserted. There is no UPDATE in any mode, and a human row is never overwritten or superseded.

**A fresh reader.** A second, read-only connection runs after the transaction ends:

- **After validate-only or dry-run.** The importer-row count must equal the pre-transaction count
  (0 today), with none of the planned providers present.
- **After apply.** It re-proves R5 parity and the combined invariant on the committed state. This is
  R5's "again afterwards in a read-only census".
- **If that post-commit check fails,** the failure is reported explicitly as **COMMITTED**, never
  as rolled back.

**Defect fixed in passing.** The library's marker guard read `obj_description(oid,
'pg_database')`. It could never see a database comment, which lives in `pg_shdescription`, so the
guard could never fire. It now uses `readRebuildMarker` (`shobj_description`).

**DB-free coverage.** `tests/db-test-rebuild.test.ts` → "R4 recovery CLI" has 28 tests. They run
against a stateful fake `afl_api` table, with real INSERT, savepoint restore and READ ONLY
refusal, and cover:

- argv;
- the credential contract and the target name;
- the marker;
- the file, source dump and payload bindings, count, method, duplicate and malformed rows;
- validate-only, dry-run and apply transaction semantics;
- a one-row resolution failure and a split continuity target in every mode;
- an existing identical row, an existing non-identical row, and human-row collisions;
- a per-player collision;
- an R5 mismatch and an invariant failure, both after the write;
- a post-commit failure.

Four earlier R4 library tests were updated for the corrected marker read and the no-write
validate-only: the marker test, validate-only/dry-run, apply success, and the folded continuity
case.

**Still to record once the operator runs R4:** the printed evidence of all three modes (including
the fresh-reader lines), and then the R5 census.

#### 11a.2.1 R4 validate-only run record (2026-09-25): FAIL, blocked on ISSUE-224 registration

**Result: FAIL (correct refusal).** Exactly **92** R3 stable identities do not resolve on current
`afldb_test`. A read-only diagnosis proved they are exactly the ISSUE-224 S9 registration cohort
(`docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json`), matched by AFL Tables
path, with identical providers. All 92 are `afl_api_stat_vector_season`.

**Cause: not an R4 defect.** The I18 `afldb_test` rebuild (2026-09-24) ran *after* ISSUE-224 had
registered and populated these players. The rebuild keeps no `data_overrides`, and it has no stage
that replays ISSUE-224 registrations, so all 92 were dropped. R4 is right to refuse. It must not
create canonical players; that belongs to ISSUE-224's registration surface.

**Read-only census (2026-09-25).** Run as `afldb_owner` with `transaction_read_only = on`, then
rolled back:

```text
AFL Tables identities present (92 paths)   0
players resolvable                          0
afl_api identities (92 providers)           0
data_overrides (all)                        0
manual_admin_edit overrides (active)        0
pending manual player shells                0
data_edits (all)                            0
players total / max id                      13,273 / 13,273
auth_users                                  0
```

One existing player shares a normalised name with a target: `#6217 Jack Dalton`
(`players/J/Jack_Dalton.html`). The target is `players/J/Jack_Dalton1.html`, a different AFL Tables
identity. This is **not** a CONFLICT under the tool's rules, because the ISSUE-160 D-2 guard checks
only pending manual shells, and there are 0.

**Restoration path: identified, NOT RUN.**
`tools/rebuild/draftguru/register_issue224_s9_players.ts` with `--target test --apply --name-parts
docs/rebuild-manifests/draftguru/issue224-s9-name-parts-20260922.json --admin-user-id <n>`. It is
**blocked**: `afldb_test` has **0 `auth_users` rows**. The tool writes `data_overrides.admin_user_id`
and `data_edits.admin_user_id`, and both are `NOT NULL REFERENCES auth_users(id)` (migrations
073/057). No actor exists to attribute the writes to. The tool also requires `--admin-user-id` for
its no-`--apply` classification mode, so that preflight was not run either. Creating an actor needs
a separate operator decision.

**R4 stays BLOCKED** until the 92 are registered again on `afldb_test` and a fresh R4 validate-only
passes. The durability gap is a successor issue, proposed and not yet opened: the `afldb_test`
destructive rebuild does not keep or replay ISSUE-224/manual registrations or `data_overrides`.
*(Superseded 2026-09-25: the 92 were re-registered, and R4 and R5 PASS (§11a.2.3). The successor
is opened as **AFLDB-ISSUE-245**.)*

#### 11a.2.2 Recovery attribution actor CLI (implemented 2026-09-25; NOT live-run)

**Status.** The actor blocker above now has a tool. It has **not been run**, so `afldb_test` still
has 0 `auth_users` rows. The ISSUE-224 registration of the **92** players (the exact S9 cohort in
`issue224-s9-target-set-20260922.json`, all `afl_api_stat_vector_season`) has **not been run**.
**R4 remains BLOCKED**, and nothing here marks R4 PASS or resolves ISSUE-237.

**Tool.** `npm run db:issue237:ensure-recovery-actor -- --email <addr> --role <role>`
(`tools/migration/ensure_issue237_recovery_actor.ts`).

- **Target.** `AFLDB_TEST_DATABASE_URL` only, which is the owner DSN because the tool INSERTs into
  `auth_users`. Both the DSN path and the live `current_database()` must be exactly `afldb_test`.
  Every other name is refused (`afldb_dev`, `code_test_db`, `issue237_r1_restore`, prod-like names).
  No DSN or credential value is ever printed or read back.
- **Actor.** The row is written only through `insertAttributionOnlyActor()`. That helper was
  extracted from the ISSUE-235 `remapActors()` in `rebuild_afl_api_adjudications.ts`, and both
  paths now share it. The row has the email (trimmed and lowercased, as in `create-admin.ts`), the
  explicit role, NULL `password_hash`, NULL `totp_secret` and `disabled_at = now()`. Every other
  column keeps its schema default (`totp_last_step`/`password_changed_at` NULL,
  `must_change_password`/`can_manage_admins` false). There is no session. The account cannot sign in.
- **Role.** Use `super_admin`. The application's player-creation paths (`data.dataEditor`,
  `data.playerLinks`) are SUPER_ADMIN_ONLY, so an `admin` attribution would record a role that
  could not have made these writes. The registration tool itself checks no role.
- **Idempotent, never corrective.** One transaction, in this order: prove the target, refuse any
  open `admin_invites` for the address, inspect the email case-insensitively, INSERT only if the
  email is absent, read the row back and prove the exact contract, then commit. If an existing row
  already matches exactly, the tool returns `ALREADY_SUITABLE`, `writes 0` and the same id. Any
  other existing state is a STOP and the row is left untouched: enabled, wrong role, any
  credential, a TOTP counter, a temporary-password flag, `can_manage_admins`, any session, a
  mixed-case stored email, or two case-variant rows. A readback mismatch rolls the INSERT back.
- **DB-free coverage.** `tests/db-test-rebuild.test.ts`, "AFLDB-ISSUE-237 recovery attribution
  actor": 12 tests. No database was contacted.

**Operator sequence (each step separately authorised; NOT RUN):**

```powershell
$env:AFLDB_TEST_DATABASE_URL = '<owner DSN naming afldb_test>'
npm run db:issue237:ensure-recovery-actor -- --email issue224-recovery@example.test --role super_admin
# expect: action CREATED, transaction COMMITTED, PASS; rerun -> ALREADY_SUITABLE, writes 0, same id
```

Then run the ISSUE-224 registration (§11a.2.1) with `--admin-user-id <that id>`: classification
first, then `--apply`. After that, run a fresh R4 validate-only.

#### 11a.2.3 Actor, ISSUE-224 re-registration, R4 and R5 run record (2026-09-25): R4 PASS, R5 PASS

**Every step below was operator-run against `afldb_test`.** The evidence is recorded as the
operator reported it. Claude contacted no database while recording it.

**1. The first R4 refusal was correct (§11a.2.1).** R4 refused 92 identities. They were the
ISSUE-224 S9 cohort, and the refusal came from ISSUE-224 lifecycle state that the I18 rebuild
destroyed. It was **not an R4 defect**. R4 must not create players, so the cohort had to be
registered again through ISSUE-224's own surface.

**2. The recovery attribution actor (§11a.2.2).** It exists **solely** to attribute the ISSUE-224
recovery writes (`data_overrides`/`data_edits.admin_user_id`). It cannot sign in and it is not a
restored account. Do not enable it.

```text
first run    email          issue224-recovery@example.test
             role           super_admin
             admin_user_id  144
             disabled       yes
             credentials    absent
second run   ALREADY_SUITABLE, writes = 0, same id 144
```

**3. The ISSUE-224 re-registration of the 92** (`register_issue224_s9_players.ts --target test`,
`--admin-user-id 144`):

```text
preview             CREATE 92    ALREADY_SATISFIED  0   CONFLICT 0
apply               created 92   already            0   conflicts 0
new player ids      13857–13948
post-apply preview  CREATE  0    ALREADY_SATISFIED 92   CONFLICT 0
```

These ids are this lineage's surrogates only. Nothing binds to them (D3).

**4. R4 validate-only: PASS** (after the re-registration):

```text
pre-existing importer rows 0
would insert               802
already identical            0
conflicts                    0
R5 projected parity   PASS
AFL API invariant     PASS
transaction           ROLLED BACK
fresh importer rows   0
PASS
```

**5. R4 dry-run: PASS.**

```text
inserted inside transaction 802
already identical             0
conflicts                     0
R5 projected parity PASS
R5 parity           PASS
AFL API invariant   PASS
transaction         ROLLED BACK
fresh importer rows 0
PASS
```

**6. R4 apply: PASS.**

```text
planned inserts 802
inserted        802
already           0
conflicts         0
R5 projected parity   PASS
R5 parity             PASS
AFL API invariant     PASS
transaction           COMMITTED
fresh importer rows   802
fresh planned rows    802
post-commit R5 parity PASS
post-commit invariant PASS
R4 apply PASS
```

**7. The independent post-commit idempotence check: PASS.** This was a fresh `validate-only`
invocation:

```text
pre-existing importer rows 802
would insert                 0
already identical          802
conflicts                    0
R5 projected parity  PASS
AFL API invariant    PASS
transaction          ROLLED BACK
fresh reader importer rows 802
fresh reader planned rows    0
PASS
```

**R4 is COMPLETE, and R5 is PASS.** R5 held at every point:

- **Inside the apply transaction:** projected and written parity. That is the exact
  `(external_id, forward stable identity, match_method, status, candidate_count, external_name,
  external_url, notes)` projection against the R3 export, plus the per-method census that the R3
  binding pins to 3/129/397/273.
- **After the commit:** a fresh reader found parity and the combined invariant.
- **On an independent re-run:** 802 already identical, 0 to insert, 0 conflicts.

So `afldb_test` again holds exactly the authoritative pre-I18 importer identity state:

- 802 rows, 802 providers, 802 stable identities;
- every provider on its original stable identity, with its original `match_method`;
- the D15 bijection and one row per player intact (the invariant).

**Hashes, for the record:**

| Item | SHA256 |
|---|---|
| source dump | `B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436` |
| export payload | `3cfad942dabed98d69452a71b6f57b82cc951b63109fb0152dc74f362f6bcb9b` |
| export file | `870EA366C63E9C6C434E8A41340B024A43BC80D413E41FF99B1D398836175D35` |

**NOT restored, and not claimed.** The I18 rebuild also removed `afldb_test`'s 2026
current-season state. The read-only diagnosis before this restoration found:

```text
max(matches.season) = 2025
2026 matches = 0
2026 player_match_stats = 0
```

The former ISSUE-224/228 state held 827 `player_match_stats` rows for the 92. **None of that is
restored.** The 92 players now exist with their identities, but with no 2026 matches or stats.
Neither R4 nor the re-registration writes matches or statistics, so no other 2026 current-season
state is restored either. That restoration is ISSUE-224/228 territory (with ISSUE-230's 2099
clock). It is **not** an ISSUE-237 requirement (§11a.3).

**`issue237_r1_restore`.** R5's evidence is now recorded, so under R2 the database may be dropped
at the operator's decision. Keep the dump and the R3 export file until ISSUE-237 closes. After a
future rebuild, R4 can be re-run from the export alone, once the players it names exist.

### 11a.3 Remaining-gate reconciliation (2026-09-25, after R5)

This section is a documentation review only. Nothing was run, and no gate was redefined.

**The gates, as §11 defines them.** The step and gate text is verbatim. The criteria column splits
§11's own words into items, with the section each one comes from.

| # | Step (§11, verbatim) | Acceptance criteria | Gate (§11, verbatim) |
|---|---|---|---|
| L3 | "`db:test:rebuild` on `afldb_test`, **after L0**. The captured importer count equals the replayed count, per method, and equals L0's parity census. The invariant holds, and the settle resolver resolves a sample provider." | (1) Stage 2 captured count = Stage 18 replayed count, per method. (2) Both equal L0's census: 802; 3/129/397/273 (§11a.2.3). (3) The Stage 19 invariant holds (§6.1). (4) The settle resolver resolves a sample provider. | "Operator, destructive. **Blocked until L0 passes**" |
| L4 | "At the next DEV promotion, record G1/G2/G3 with every row's grade. D15's actual superseded set must equal G2's AGREE list (`E_promotion`) exactly. If the DEV exception is used, record the classification file and complete the post-re-acquisition census." | (1) G1/G2/G3 are recorded per row, with the §6.3 DEV grades. (2) actual supersedes = `E_promotion`. (3) If the exception is used: the classification file is recorded, and the census (§6.3) PASSes. | "Operator. **Blocked until L3 passes**" |
| L5 | "PROD, only inside the next scheduled production promotion. G3 hard loss is FAIL." | The §6.2 production gates hold, and a G3 hard loss is FAIL with no exception. | "Operator. **Blocked until L4 passes**" |

**The purposes** (read from §6 and §11a, not stated in §11 itself):

- **L3** proves rebuild carry-through on real, non-empty data (§11a: "L3 cannot prove carry-through
  on an empty set").
- **L4** proves the G1–G3 gates and the exact-set supersede on a real DEV promotion.
- **L5** proves the same in production, where no WARN grade exists.

**Where each gate stands:**

- **L0 is now PASS in full:** R1–R5 (§11a.1, §11a.2.3).
- **L1 and L2 are PASS** (§0).
- **L3–L5 are not run.** *(Historical: true when written. L3 has since PASSED, §11a.6; L4 and
  L5 remain NOT RUN.)*
- *(Superseded 2026-09-25: L3's exact commands and return list are now written, §11c, as this
  bullet required. L4/L5 still have no command block; they would use the promotion runbook
  commands, `docs/production-promotion.md`, including the `--afl-api-dev-regeneration` and
  `dev-regeneration-census` blocks.)*
- *(Superseded 2026-09-25: **L3 PASS** (§11a.6). L4 now has a source-derived guarded sequence
  (§11d, NOT RUN). It found that the promotion runbook's command order leaves G2 vacuous, and
  that `--phase candidate`'s G1 refuses a reinstated ledger (§11d.0). L5 still has no command
  block of its own.)*
- *(Annotation 2026-09-25, S5: the `docs/deployment.md` §6a gap named in the table below appears
  closed. The AFLDB-ISSUE-245 rewrite of §6a (`:237-461`) covers the combined capture,
  `AFLDB_REBUILD_CAPTURE_ROOT`, the database marker, the importer section and stage 21's empty
  expected-supersede set. This pass did not re-audit it line by line.)*

**Dependencies:**

| Depends on | L3 | L4 | L5 |
|---|---|---|---|
| 2026 `matches` on `afldb_test` | No. A rebuild loads the ≤2025 baseline, and the resolver check (`resolveAflApiPlayer`) is an `external_identities` lookup only | No | No |
| 2026 `player_match_stats` on `afldb_test` | No | No | No |
| The ISSUE-224 92-player 2026 **stats** | No | No | No |
| The ISSUE-224 92-player **registrations** | **Yes, structurally.** See "L3 is blocked by ISSUE-245" below | Indirectly, through L3 and the source's coverage | Indirectly |
| AFL API bridge generation | No (F3 forbids it as recovery) | Only if the DEV exception is used: the DEV emitter, then `import --target dev`, after §9 re-acquisition on DEV | No |
| Promotion checks (`promotion-check.ts`) | No | Yes: G1 (`source`, `candidate`), the pre-cutover census, G2 and G3 (`restored`), and the census if the exception is used | Yes: the same, with the production grades |
| DEV | No | **Yes:** a real DEV promotion, which is destructive to `afldb_dev`. DEV's own 2026 current season is re-acquired after the swap (§9); that is DEV-side and only matters for the exception's census | No |
| `afldb_test` | **Yes:** it is the destructive target | Yes: the promotion source, after L3 | Yes: the source |
| Production | No | No | **Yes**, inside a scheduled production promotion only |

**L3 is blocked by AFLDB-ISSUE-245.** This is predicted from the code and the recorded evidence.
It has not been run.

**Why the 92 cannot survive a rebuild:**

- **How they exist.** The 92 players exist on `afldb_test` only through the ISSUE-224
  registration: players 13857–13948, their `manual_admin_edit` tokens, their
  `data_overrides('players','identity')` rows, and the attached AFL Tables paths.
- **No stage replays them.** `planStages()` (`tools/db/rebuild-test.ts:723-1031`) has no stage that
  replays `data_overrides` or re-runs that registration.
- **fitzRoy does not create them.** None of the 92 paths is in the accepted fitzRoy snapshot that
  `fitzroy` loads (ISSUE-224's measured facts). The I18 result confirmed it: §11a.2.1 found 0 of
  the 92 paths after that rebuild.

**What L3 would therefore do:**

1. **Stage 2 accepts the capture.** Each of the 92 has one accepted AFL Tables path, and that path
   takes precedence over the manual token (D7). The guard that refuses a player identified only
   by a `manual_admin_edit` token (`src/lib/acquisition/afl-api-adjudication.ts:1264`) never
   fires for them, so nothing refuses before destruction.
2. **`recreate` destroys the registrations:** the 92 players, their overrides, their edits and
   actor 144.
3. **Stage 18 STOPs.** Step (a) cannot reverse-resolve the 92 identities, so the whole Stage 18
   transaction rolls back (D7, D12).
   - **Kept:** the capture and the marker, so no identity is lost.
   - **Left behind:** `afldb_test` after stage 17, with 0 `afl_api` rows and stages 19–25 unrun.
4. **`--recover` cannot finish.** It re-runs `recreate`, so it fails the same way. Re-registering
   after the halt does not help either, because the next run resets the database again.

**This is correct fail-closed behaviour.** OD-1 forbids withholding the 92, and the Stage 18 STOP
is exactly the fail-closed result the design intends. The gap sits outside ISSUE-237: the
`afldb_test` rebuild does not make manual/post-baseline player registrations durable. That is
**AFLDB-ISSUE-245** (§12).

**Do not run L3 until ISSUE-245 is resolved, or until the operator records another decision.**
One option, for the operator only: accept L1/L2 plus R1–R5 as ISSUE-237's `afldb_test` evidence,
and defer L3 to ISSUE-245's validation.

*(Annotation 2026-09-25, AFLDB-ISSUE-245 implementation, uncommitted: the rebuild now carries the
registrations as a third section of the same combined capture (format version 2), and replays them
in three new stages **before `draftguru`**. Those stages are `manual-registrations-reinstate`,
`manual-registrations-replay` (the production `replay_admin_overrides(players)`) and
`manual-registrations-verify`. This issue's Stage 18/19 are unchanged in content; in
`planStages()` they are now stages 21/22 (`afl-api-adjudications-reinstate`/`-bijection`), and
they can assume every registered player already exists. The failure predicted above (step 3) is
covered by the DB-free suite (`tests/db-test-rebuild.test.ts`, "AFLDB-ISSUE-245", cases 19/20).
**L3 is still blocked.** It becomes executable once the ISSUE-245 `code_test_db` rehearsal
(`npm run db:code-test:issue245-rehearsal`, run alone) passes `verify --phase post`, and once
L3's exact commands and return list are written, as §11a.3 already requires. The 2026 match and
stat restoration remains unrelated to L3: see below.)*
*(Superseded 2026-09-25: both conditions are now met. The rehearsal is PASS (§11a.5) and L3's
exact commands and return list are written (§11c). **L3 itself has not been run.**)*

**Restoring the 2026 stats is not an ISSUE-237 prerequisite.**

- No L3–L5 criterion reads 2026 matches or statistics.
- A rebuilt `afldb_test` holds no 2026 current-season data by construction, and promotion
  re-acquires the current season after the swap (§3.3, §9). Any 2026 restoration done before L3
  would be destroyed by L3's own reset.
- The 273 `afl_api_stat_vector_season` rows are carried as established decisions (F12), not
  re-derived from 2026 statistics.
- That restoration belongs solely to ISSUE-224/228 (and ISSUE-230).

**The ISSUE-237 acceptance state, by category:**

| Category | Remaining |
|---|---|
| DB-free / code | Confirm the standard DB-free gates on the final committed tree: typecheck, `db-test-rebuild -t "AFLDB-ISSUE-237"`, `db-promotion-check`, `player-link-mutations`, `git diff --check`. The 2026-09-25 run is recorded in §11a.4. No §9 item is recorded as open, but this reconciliation did not re-audit §9 test by test. Review-only, not a gate: the §10.1 observation on the reinstate precondition. |
| `afldb_test` live | **L3**, blocked by ISSUE-245 (above). Recommended before closure: re-run `tests/integration/settle-afl-api.test.ts`. Its 9/9 and 70/70 results (§10.1) were measured when `afldb_test` held **zero** `afl_api` rows. It now holds 802 real importer rows plus the 92 registrations, and several ISSUE-235 recovery cases model "no importer rows" (for example `:5082`, `:5100`, `:5124-5143`), so the outcome on this state is unmeasured. Its fixtures use disjoint namespaces: `CD_I297354`, the ISSUE-228 root baseline provider, is **not** among the 802 in the R3 export. |
| DEV | **L4.** Blocked by L3, and it needs a scheduled DEV promotion. G3 against DEV's 669 importer rows (a different lineage) is unmeasured, so its grades cannot be predicted. |
| Production / promotion | **L5.** Blocked by L4, and only inside a scheduled production promotion. |
| Documentation / closure | **S5 is incomplete:** `docs/deployment.md` §6a (`:346-386`) still describes the ISSUE-235 v2 ledger-only capture at `backups/rebuild/<target>/afl-api-adjudications.capture.json`. It must be updated for the combined capture, `AFLDB_REBUILD_CAPTURE_ROOT`, the database marker, the importer section and `E_rebuild` (§13 S5). **Then S9:** `issues.md` resolution, `IssuesIndex.md`, `CHANGELOG.md`, and the move to `issues/closed/`. **Also:** the operator commit, and `merge:ready`. |

**Technically ready apart from those gates?** The code, the DB-free tests, S6, L1/L2 and R1–R5 are
all in place. The remaining work is:

- confirming the DB-free gates on the final tree;
- the S5 doc gap;
- the integration re-run recommended above;
- the operator-gated L3–L5, with L3 depending on ISSUE-245 first.

**ISSUE-237 is not resolved.**

### 11a.4 Validation of the 2026-09-25 reconciliation (DB-free, Claude-run)

Only the runbook and the three tracking files changed. No code changed.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean (exit 0) |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 111 passed / 341 skipped (filter), 0 failed |
| `npx vitest run tests/db-promotion-check.test.ts` | 121 / 121 passed |
| `npx vitest run tests/player-link-mutations.test.ts` | 109 / 109 passed |
| `git diff --check` | clean (exit 0; CRLF notices only). This runbook is untracked, so it was checked separately: 0 trailing-whitespace lines |

No database was contacted, and no Git write occurred.

### 11a.5 AFLDB-ISSUE-245 `code_test_db` rehearsal PASS; L3 blocker CLEARED (2026-09-25, operator-run)

**What this proves.** ISSUE-245's destructive `code_test_db` rehearsal (`npm run
db:code-test:issue245-rehearsal`, run alone) has now passed `verify --phase post`. Per §11a.3's own
condition, that is what makes L3 executable. It does **not** itself constitute L3: L3 is the real
`afldb_test` rebuild, prepared and NOT run below (§11c).

**Evidence, as reported by the operator:**

- **Live target:** `code_test_db` / `afldb_owner` / writable.
- **Seed:** 2 manual registrations — one carried `players/I/Issue245_Rehearsalone.html`, plus
  `CD_I9992450001` / `afl_api_stat_vector_bootstrap`. Pre-rebuild player ids: 13274 and 13275
  (rehearsal-fixture ids, diagnostic only — never identity, D9/D7).
- **Full `db:test:rebuild` on `code_test_db`: PASS.**
- **Capture, before reset:** 0 human adjudications, 1 importer identity, 2 manual registrations.
- **Stage 17 (`manual-registrations-reinstate`):** 2 registrations reinstated; 1 attribution-only
  actor created.
- **Stage 18 (`manual-registrations-replay`):** the production `replay_admin_overrides(players)`
  committed.
- **Stage 19 (`manual-registrations-verify`):** 2/2 registrations verified.
- **`draftguru`: PASS.**
- **Stage 21 (`afl-api-adjudications-reinstate`):** 1 AFL API importer identity inserted; combined
  invariant PASS at Stage 22 (`afl-api-adjudications-bijection`).
- **Marker:** cleared transactionally; the pending capture was archived.
- **Final rebuild validation: 85/85.**
- **Post-rebuild player ids:** 13272 and 13273 (rehearsal-fixture ids, diagnostic only).
  `CD_I9992450001` remapped to player 13272 under the same reverse-resolution method Stage 21
  always uses (no new method, no surrogate carried).
- **Post verification: PASS. Teardown: PASS. Fixture residue gate: 0.**

**Focused validation (reported by the operator):**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-245"` | 28/28 |
| `tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 111/111 |
| `tests/integration/settle-afl-api.test.ts -t "AFLDB-ISSUE-237"` (live, against the current `afldb_test`, which holds the recovered 802 importer rows) | 9/9 PASS |
| `tests/player-link-mutations.test.ts` | 109/109 |
| `tests/db-promotion-check.test.ts` | 121/121 |
| `git diff --check` | PASS |

**Disposition.**

- **AFLDB-ISSUE-245: implementation PASS, DB-free validation PASS, `code_test_db` destructive
  rehearsal PASS.** Its `afldb_test` proof is deferred to — and will occur through — ISSUE-237 L3
  (§11a.3's own design: ISSUE-245 has no `afldb_test`-targeting rehearsal of its own, by the same
  rehearsal-fixture rule that keeps L1/L2 off `afldb_test`).
- **ISSUE-237: R1–R5 remain PASS (§11a.1, §11a.2.3, unchanged). The ISSUE-245 blocker on L3 is
  CLEARED.** The integration rerun `tests/integration/settle-afl-api.test.ts -t "AFLDB-ISSUE-237"`
  that §11a.3 recommended is now PASS (9/9), measured against the live, populated `afldb_test`.
  **L3 itself had not yet run when this was recorded** (it has since run and PASSED, §11a.6). The
  exact guarded operator sequence is written in §11c, as §11a.3 required before L3 may ever run.
- This section is a record of operator-reported evidence. Nothing here was executed by Claude, and
  no database was contacted by Claude while writing it.

### 11a.6 L3 run record — the real `afldb_test` destructive rebuild (2026-09-25, operator-run): PASS

The operator ran the §11c sequence, with one correction: the DraftGuru label was
`annual-html-20260826`, not the `annual-html-20260902` that §11c point 9 stated (corrected in
§11c). Everything below is operator-reported evidence. Claude executed nothing and contacted no
database.

**Pre-L3 state (§11c points 1–8).**

| Check | Result |
|---|---|
| Target / role / `transaction_read_only` | `afldb_test` / `afldb_owner` / `off` |
| Database rebuild marker | absent |
| Pending capture | absent |
| L0 promotion/source gate | `PROMOTION CHECK (prod/source): PASS` |
| Importer census | 802 total: `afl_api_manual_adjudication` 3, `afl_api_name_team_season_bootstrap` 129, `afl_api_stat_vector_bootstrap` 397, `afl_api_stat_vector_season` 273 |
| Manual registrations (`data_overrides`, `manual_admin_edit`) | 92 |
| Diagnostic `players.id` range of the 92 | 13857–13948. **Diagnostic only, never identity** (D7/D9) |

**The command.** The first attempt did not pass `--allow-owner-import-dsn`. It was refused
before Stage 1 because `AFLDB_TEST_IMPORT_DATABASE_URL` was unset (`resolveTarget()`,
`tools/db/rebuild-test.ts`). Nothing was destroyed, and that refusal is not an L3 failure. The
successful run was:

```powershell
npm run db:test:rebuild -- `
    --target afldb_test `
    --acknowledge-destroy afldb_test `
    --allow-owner-import-dsn `
    --draftguru-label annual-html-20260826
```

It used the owner-import fallback because the restricted import DSN was not available. The rebuild
therefore exercised the repository's supported AFLDB-ISSUE-083 fallback path, with the data
stages run as the owner. **It does not prove that an `afldb_import` grant would work in
production.** That grant is not exercised on this path, exactly as `issues/closed/AFLDB-ISSUE-113.md`
recorded for the same fallback.

**Rebuild evidence (stage ids per the current `planStages()`, §6.1 annotation).**

| Stage | Evidence |
|---|---|
| 2 `afl-api-adjudications-capture` | captured 0 adjudication row(s), 802 importer identity row(s), 92 manual player registration(s). Capture file `D:\afldb-rebuild-captures\afldb_test\afl-api-identities.capture.json`, file SHA256 `3d76c061014a05ea4a529157fa2cae8768c050be7e25cc0bb3470c2f65b3d653`, payload SHA256 `dff7cbea5ac67d33fd3640905ab94f880354cd9c6104a370f3c1ea3d8b5f2414`. Marker set before reset |
| 3 `recreate` | database reset completed |
| 4 `migrations` | 104/104 applied |
| 17 `manual-registrations-reinstate` | 92 creation records reinstated: 92 to re-create, 0 to bind to a source-owned player. Actors: 0 reused, 1 attribution-only actor created (disabled, no credentials) |
| 18 `manual-registrations-replay` | `replay_admin_overrides(players)`, 92 creation records, COMMITTED |
| 19 `manual-registrations-verify` | 92 replayed exactly (player, manual identity, AFL Tables identity, creation record) |
| 20 `draftguru` | `annual-html-20260826`: persons 5057, picks 6810, completed successfully |
| 21 `afl-api-adjudications-reinstate` | importer: 802 inserted, 0 no-op. Ledger: 0 rows. Replay: 0 inserted, 0 no-op, 0 superseded, expected supersedes = 0, bijection OK. Marker cleared inside the reinstate transaction. Capture archived as `D:\afldb-rebuild-captures\afldb_test\afl-api-identities.20260925T051802075Z.dff7cbea5ac6.reinstated.json` |
| 22 `afl-api-adjudications-bijection` | combined AFL API invariant PASS; no rebuild marker remains |
| Final validation | `PASSED: 85 checks` |
| Result | `Rebuild complete.`, exit code 0 |

**Independent post-L3 proofs (§11c points 10–14).**

- **Source gate.** A fresh read-only `db:promotion:check --phase source` returned
  `PROMOTION CHECK (prod/source): PASS`.
- **Importer census.** Still exactly 802: 3/129/397/273.
- **Manual registrations.** 92.
- **Settle resolver.** `npx vitest run tests/integration/settle-afl-api.test.ts -t "AFLDB-ISSUE-237"`
  → **9/9 PASS**, 61 skipped. That includes §10/E13: `resolveAflApiPlayer` resolves a replayed
  importer row through the intended identity path, and refuses one it never replayed.
- **Lifecycle.** Database marker = `<NULL>`. Pending capture = `False`. Newest archived capture:
  `D:\afldb-rebuild-captures\afldb_test\afl-api-identities.20260925T051802075Z.dff7cbea5ac6.reinstated.json`,
  length 399753, LastWriteTime 25/09/2026 3:18:02 PM.

**Live evidence that `players.id` is not transported as identity.** The 92 players' diagnostic
`players.id` range was **13857–13948** before the rebuild and **13272–13363** after it. Every one
was renumbered. The 92 registrations and all 802 AFL API identities still survived, because each
was carried by stable identity: the `manual_admin_edit` token, the AFL Tables path, and the
importer row's forward stable identity. The integers are diagnostic. Neither equal nor changed
integers are themselves identity. What this run proves is that the lifecycle never relied on
them.

**L3 against §11a.3's acceptance criteria.**

| # | Criterion | Evidence | Result |
|---|---|---|---|
| 1 | Stage 2 captured count = Stage 21 replayed count, per method | 802 captured, 802 inserted into a reset database (0 no-op). Stage 21 checks exact importer parity in-transaction (D13). The independent post-L3 census equals the pre-L3 census method by method. The per-method equality comes from that pair of censuses plus D13; the operator did not report a per-method stage log line | PASS |
| 2 | Both equal L0's census: 802; 3/129/397/273 | pre-L3 and post-L3 census | PASS |
| 3 | The combined invariant holds | Stage 22 PASS; the independent `--phase source` G1 PASS | PASS |
| 4 | The settle resolver resolves a sample provider | `settle-afl-api.test.ts -t "AFLDB-ISSUE-237"` 9/9, including §10/E13 | PASS |

**L3 = PASS.** L4 and L5 are not complete (§11d).

**AFLDB-ISSUE-245 consequence.**

- **Evidence.** ISSUE-245 now has implementation PASS, DB-free validation PASS, the real
  `code_test_db` destructive rehearsal PASS (§11a.5), and the real `afldb_test` proof through L3
  PASS. All 92 manual registrations survived a real destructive rebuild.
- **Observed operational state.**

  | Table | Before L3 | After L3 |
  |---|---|---|
  | `data_overrides` (the 92 creation records) | 92 | 92 |
  | `data_edits` | 92 | 0 |

- **Why `data_edits` fell to 0.** This is expected under ISSUE-245's implemented scope.
  `data_overrides` creation records are the durable registration authority. `data_edits` rows are
  the audit log, keyed to the old player surrogates (`row_id`), and the implementation
  deliberately does not carry them (`tools/migration/rebuild_manual_registrations.ts:34-37`;
  `issues.md` ISSUE-245 "Implementation": "`data_edits` is not carried"). **The loss is not
  fixed. It is out of scope by design.**
- **Finding only, no issue allocated.** The `afldb_test` rebuild starts a fresh `data_edits`
  history for re-created registrations. This does not reach any promoted database: every
  promotion truncates `data_edits` in the candidate. PROD then reinstates its own rows, and DEV
  withholds them as historical-only (`docs/production-promotion.md` §1, §7.4d). If the operator
  wants audit continuity on `afldb_test` itself, that would be a new successor issue. Its number
  must be checked against the global namespace first: 242 and 243 are recorded as unallocated in
  this worktree, but other branches and worktrees were not inspected.
- **Disposition.** ISSUE-245's own contract is satisfied. Its scope asked for authority,
  attribution, ordering, fail-closed behaviour and an early refusal, and all five are
  implemented. Its recorded next action was "resolve this issue on L3 evidence". **ISSUE-245 is
  RESOLVED 2026-09-25** (`issues.md`). The code is still uncommitted; the operator commit is
  pending.

### 11a.7 Validation of the 2026-09-25 L3 record and L4 preparation (DB-free, Claude-run)

Only this runbook, `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` changed. No code changed.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean (exit 0) |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-245"` | 28 passed / 452 skipped |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 111 passed / 369 skipped |
| `npx vitest run tests/player-link-mutations.test.ts` | 109 / 109 |
| `npx vitest run tests/db-promotion-check.test.ts` | 121 / 121 |
| `git diff --check` | exit 0 (CRLF notices only). This runbook is untracked, so it was checked separately: 0 trailing-whitespace lines |

No database was contacted. There was no SSH, no DEV or PROD action and no Git write.

## 11b. L1/L2 rehearsal procedure on `code_test_db` (prepared 2026-09-24; NOT RUN)

**Tooling (DB-free tested; `tests/db-test-rebuild.test.ts`).**

- **Rehearsal fixture:** `npm run db:code-test:issue237-rehearsal -- seed | verify --phase pre|post | teardown | residue`
  (`tools/migration/afl_api_identity_rebuild_rehearsal_fixture.ts`).
  - **Target.** `code_test_db` only, through `AFLDB_CODE_TEST_DATABASE_URL` and
    `AFLDB_CODE_TEST_IMPORT_DATABASE_URL`. `afldb_test`, `afldb_dev` and anything
    production-like are refused by name.
  - **Namespace.** It is `^CD_I999237[0-9]{4}$`. The importer uses `CD_I9992370001` and the
    human `CD_I9992370002` (spine `CD_M9992370002|CD_T20|CD_I9992370002`). The actor is
    `issue237-rehearsal-fixture@example.test`.
  - **Identities.** Importer: `players/B/Barry_Mulcair.html`, `afl_api_stat_vector_bootstrap`.
    Human: `players/G/Graeme_Shephard.html`, linked through `linkAflApiProvider()`.
  - **Resolution.** Players are resolved by accepted AFL Tables identity in every transaction. No
    `players.id` is stored.
  - **Seed refuses** on any `afl_api` row, any ledger row, a marker, a pending capture, residue,
    or an ambiguous or missing identity. That makes `E_rebuild = ∅` by construction.
  - **Baseline** (durable ledger fields only):
    `<AFLDB_REBUILD_CAPTURE_ROOT>\issue-237-rehearsal\code_test_db.baseline.json`.
- **Deterministic halt:** `--rehearsal-stop-after recreate`. It is valid only with an explicit
  `--target code_test_db`, and it cannot be combined with `--recover-afl-api-adjudications`.
  - **Unchanged.** It keeps the acknowledgement, the capture root, Stage 1 and Stage 2. The plan
    must begin `precheck -> capture -> recreate`.
  - **Where it stops.** Only after `recreate` succeeds. Migrations and every later stage never
    run.
  - **Exit code.** It exits **86** with an `AFLDB-ISSUE-237 REHEARSAL HALT` banner saying
    recovery is required.
- **Stage 2 fix found while wiring L2.** Stage 2 used to run `SELECT … FROM sources`
  unconditionally. On a database the real `RESET_SQL` had emptied, the `--recover` run would
  therefore have failed with `relation "sources" does not exist`. It now reads that state as an
  empty importer section (`fetchAflApiSourceIdIfPresent`). The marker decision still refuses to
  capture it as a baseline. A ledger without a source refuses.
- **Stage 2 bootstrap fix (2026-09-24), found by the operator's real `code_test_db` bootstrap.**
  - **Observed.** Every PRECHECK input passed. Stage 2 then failed with
    `REFUSED: relation "afl_api_identity_adjudications" does not exist`. Nothing was destroyed:
    `recreate` and every later stage were listed as not run. The target was a legitimate
    pre-ISSUE-235 database: `external_identities`, `sources` and the `afl_api` source exist, 0
    `afl_api` identity rows, no ledger table (migration 104 not applied), marker `<NULL>`, no
    capture directory.
  - **Cause.** `readLedger` already probed the table with `to_regclass` and returned
    `present: false`. But once an `afl_api` source exists, Stage 2 also runs
    `assertAflApiAdjudicationBijection`, and that read the ledger unconditionally.
  - **Decision.** An absent relation, established only by that `to_regclass` probe, means an empty
    human-ledger section. That is all it means: nothing is created or synthesised, and no flag
    is added. `assertAflApiAdjudicationBijection(tx, { ledgerTablePresent })` takes `[]` as the
    ledger only when told the table is absent. Every other caller omits the option and reads
    strictly.
  - **Still enforced.** The bijection still runs against that empty ledger, so an
    admin-resolved `afl_api` row with no ledger table still refuses (`row_without_ledger`).
    Importer capture (D5/D7/D13) is unchanged.
  - **Still strict.** When the table exists, any read error (permission, SQL error, the relation
    vanishing after the probe), a malformed row, or an actor-count mismatch fails the stage hard,
    before any marker or file.
  - **Unchanged.** The combined payload is still one payload: one hash, one file, one marker.
    `E_rebuild = ∅`, Stage 18, Stage 19 and recovery are unchanged.
  - **Refactor.** Stage 2's read-only half moved, unchanged, from `runCapture` into the exported
    `observeCaptureState` so it can be tested without a database.
  - **DB-free evidence.** `tests/db-test-rebuild.test.ts` has a new describe, *AFLDB-ISSUE-237
    bootstrap*, with Test A (bootstrap captures `[]`/`[]`, marker action `set`, file round-trips;
    plus the strictness variants), Test B (5 read-failure modes plus the bijection's own read)
    and Test C (existing-table capture unchanged). All 4 pass. The suite total is 386/387; the
    single failure is the known I18 mini-resolver baseline (`afl-api-identities.json`).
    `tsc --noEmit` is clean. `player-link-mutations` passes 91/91.
  - **Not yet proven.** The real `code_test_db` bootstrap and L1/L2 have NOT been re-run, so
    P-M point 3 remains NOT PROVEN.

**Q-M: the independent marker query** (P-M point 3; it proves nothing unless run by the operator
outside the rebuild):

```powershell
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_CODE_TEST_DATABASE_URL -c "SELECT coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = 'code_test_db'"
```

**Common environment** (every step below, one PowerShell session, worktree `D:\dev\afldb-issue-237`;
the tunnel to the PostgreSQL host must be listening; the DSN values are the operator's own and are
never pasted into evidence):

```powershell
Set-Location D:\dev\afldb-issue-237
$env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
$env:AFLDB_PYTHON = 'C:/Users/stuar/AppData/Local/Programs/Python/Python312/python.exe'
$env:AFLDB_REBUILD_CAPTURE_ROOT = 'D:\afldb-rebuild-captures'
$env:AFLDB_CODE_TEST_DATABASE_URL = '<afldb_owner DSN naming code_test_db>'
$env:AFLDB_CODE_TEST_IMPORT_DATABASE_URL = '<afldb_import DSN naming code_test_db>'
$pending = Join-Path $env:AFLDB_REBUILD_CAPTURE_ROOT 'code_test_db\afl-api-identities.capture.json'
# Read-only sanity: expect "code_test_db|<NULL>" and False.
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_CODE_TEST_DATABASE_URL -c "SELECT current_database(), coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = current_database()"
Test-Path $pending
```

**Bootstrap, only if genuinely required.** Run it only when `seed` refuses because the baseline
players or the `afl_api` source are absent (for example, `code_test_db` was never rebuilt). It is a
normal destructive rebuild with nothing seeded:

```powershell
npm run db:test:rebuild -- --target code_test_db --acknowledge-destroy code_test_db --draftguru-label annual-html-20260826
```

### L1: normal destructive rebuild with the fixture

```powershell
npm run db:code-test:issue237-rehearsal -- seed
npm run db:code-test:issue237-rehearsal -- verify --phase pre
npm run db:test:rebuild -- --target code_test_db --acknowledge-destroy code_test_db --draftguru-label annual-html-20260826 2>&1 | Tee-Object -FilePath "$env:AFLDB_REBUILD_CAPTURE_ROOT\issue237-L1-rebuild.log"
$LASTEXITCODE          # expect 0; the log ends "Rebuild complete."
npm run db:code-test:issue237-rehearsal -- verify --phase post
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_CODE_TEST_DATABASE_URL -c "SELECT coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = 'code_test_db'"   # Q-M: expect <NULL>
Test-Path $pending     # expect False
npm run db:code-test:issue237-rehearsal -- teardown   # ends in the residue gate: PASS (0)
npm run db:code-test:issue237-rehearsal -- residue    # independent re-check: PASS (0)
```

**Expected rebuild log evidence:**

- **Stage 2:** `captured 1 adjudication row(s) and 1 importer identity row(s)` and `marker  : set`.
- **Stage 18:**
  - `importer: 1 inserted`;
  - `replay  : … 0 superseded (expected 0); bijection OK`;
  - `marker  : cleared inside this transaction`.
- **Stage 19:** `… invariant: OK (no rebuild marker remains)`.

### L2: deterministic crash rehearsal (the P-M point 3 proof)

```powershell
npm run db:code-test:issue237-rehearsal -- seed
npm run db:code-test:issue237-rehearsal -- verify --phase pre

# 1. Halt deterministically after the real recreate.
npm run db:test:rebuild -- --target code_test_db --acknowledge-destroy code_test_db --draftguru-label annual-html-20260826 --rehearsal-stop-after recreate 2>&1 | Tee-Object -FilePath "$env:AFLDB_REBUILD_CAPTURE_ROOT\issue237-L2-halt.log"
$LASTEXITCODE          # expect 86; log: "AFLDB-ISSUE-237 REHEARSAL HALT after 'recreate'", "Not run: migrations, …"

# 2. Independent: the marker is present AFTER the real RESET_SQL, and it names the durable capture.
$raw = psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_CODE_TEST_DATABASE_URL -c "SELECT coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = 'code_test_db'"
$raw                   # Q-M: expect the JSON marker, format afldb.afl_api_identities.rebuild_capture
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_CODE_TEST_DATABASE_URL -c "SELECT current_database(), to_regclass('public.external_identities') IS NULL, to_regclass('public.afl_api_identity_adjudications') IS NULL, (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')"
                       # expect code_test_db|t|t|0  (the reset really ran)
$marker = $raw | ConvertFrom-Json
$fileSha = (Get-FileHash -Algorithm SHA256 $pending).Hash.ToLower()
$payloadSha = (Get-Content -Raw $pending | ConvertFrom-Json).payloadSha256
"fileSha256    marker=$($marker.fileSha256) file=$fileSha match=$($marker.fileSha256 -ceq $fileSha)"
"payloadSha256 marker=$($marker.payloadSha256) file=$payloadSha match=$($marker.payloadSha256 -ceq $payloadSha)"
                       # expect match=True twice

# 3. Optional negative check: a normal rerun without --recover refuses at Stage 2, before recreate.
npm run db:test:rebuild -- --target code_test_db --acknowledge-destroy code_test_db --draftguru-label annual-html-20260826 2>&1 | Tee-Object -FilePath "$env:AFLDB_REBUILD_CAPTURE_ROOT\issue237-L2-norecover.log"
$LASTEXITCODE          # expect 1; "REFUSED: A rebuild marker and a pending capture …
                       #   Re-run with --recover-afl-api-adjudications"; "REBUILD FAILED at stage 'afl-api-adjudications-capture'"
                       # then re-run step 2: the same marker and hashes, still match=True

# 4. The supported recovery.
npm run db:test:rebuild -- --target code_test_db --acknowledge-destroy code_test_db --draftguru-label annual-html-20260826 --recover-afl-api-adjudications 2>&1 | Tee-Object -FilePath "$env:AFLDB_REBUILD_CAPTURE_ROOT\issue237-L2-recover.log"
$LASTEXITCODE          # expect 0; "RECOVER: reinstating the pending capture … (1 ledger row(s), 1 importer row(s), payload <the step-2 payloadSha256>)",
                       # Stage 18 "marker  : cleared inside this transaction", Stage 19 OK, "Rebuild complete."

# 5. Independent: the marker is gone; then the fixture and invariants.
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_CODE_TEST_DATABASE_URL -c "SELECT coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = 'code_test_db'"   # Q-M: expect <NULL>
Test-Path $pending     # expect False (archived as afl-api-identities.*.reinstated.json)
npm run db:code-test:issue237-rehearsal -- verify --phase post
npm run db:code-test:issue237-rehearsal -- teardown
npm run db:code-test:issue237-rehearsal -- residue
```

**Return to Claude:** the four logs' Stage 2 / Stage 18 / Stage 19 / halt lines, every Q-M
output, the hash lines, and each fixture command's output. Only then is P-M point 3 assessed.

## 11c. L3 operator sequence — the real `afldb_test` destructive rebuild (prepared 2026-09-25; RUN 2026-09-25, PASS)

Written because §11a.3 requires exact commands and a return list here before L3 is ever run, and
because AFLDB-ISSUE-245's blocker cleared (§11a.5). **Nothing below has been run.** Every flag and
every log line is taken from the current CLI source (cited inline); nothing here is invented.
*(Superseded 2026-09-25: the operator ran this sequence and L3 PASSED; the run record is §11a.6.
Two corrections were made afterwards, both marked in place: point 6's claim that G1 corroborates
the marker check, and point 9's DraftGuru label.)*

**Common environment** (one PowerShell session, worktree `D:\dev\afldb-issue-237`; the tunnel to
the PostgreSQL host must be listening; DSN values are the operator's own and are never pasted into
evidence):

```powershell
Set-Location D:\dev\afldb-issue-237
$env:PATH = "C:\Program Files\PostgreSQL\16\bin;$env:PATH"
$env:AFLDB_PYTHON = 'C:/Users/stuar/AppData/Local/Programs/Python/Python312/python.exe'
$env:AFLDB_REBUILD_CAPTURE_ROOT = 'D:\afldb-rebuild-captures'
$env:AFLDB_TEST_DATABASE_URL = '<afldb_owner DSN naming afldb_test>'
# Set only if genuinely available (checked at step 1-2 below):
# $env:AFLDB_TEST_IMPORT_DATABASE_URL = '<afldb_import DSN naming afldb_test>'
$pending = Join-Path $env:AFLDB_REBUILD_CAPTURE_ROOT 'afldb_test\afl-api-identities.capture.json'
```

### 1–2. Prove the DSN names `afldb_test`, and the owner-import fallback rule

`resolveTarget()` (`tools/db/rebuild-test.ts:450-517`) reads `AFLDB_TEST_DATABASE_URL` and refuses
unless the database it names equals `afldb_test` exactly (`databaseOf()`, `:408-410` — the URL's
own path, never inferred). It also refuses to run any data stage unless
`AFLDB_TEST_IMPORT_DATABASE_URL` is set OR `--allow-owner-import-dsn` is given explicitly
(`:505-514`). Prove both before spending any time on the later steps:

```powershell
# 1. The DSN's own database name (prints no credential): expect afldb_test.
([Uri]$env:AFLDB_TEST_DATABASE_URL).AbsolutePath.TrimStart('/')

# 2. The restricted import DSN, if set, must also name afldb_test (rebuild-test.ts:499-503).
#    Only if it is genuinely unavailable does this run pass --allow-owner-import-dsn.
if ($env:AFLDB_TEST_IMPORT_DATABASE_URL) {
    ([Uri]$env:AFLDB_TEST_IMPORT_DATABASE_URL).AbsolutePath.TrimStart('/')   # expect afldb_test
    $ownerImportFlag = @()
} else {
    $ownerImportFlag = @('--allow-owner-import-dsn')
}
```

### 3–5. Prove the live connection, the marker, and the pending capture

The same Q-M pattern §11b uses on `code_test_db` (`readRebuildMarker`,
`rebuild_afl_api_adjudications.ts:983-991`), pointed at `afldb_test`:

```powershell
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_TEST_DATABASE_URL -c "SELECT current_database(), coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = current_database()"
# expect: afldb_test|<NULL>   (3: current_database is afldb_test; 4: no rebuild marker)
Test-Path $pending
# expect: False               (5: no pending capture)
```

If either check fails, STOP. A marker or a pending capture means an earlier run failed after
`recreate` and left recoverable state; that is a `--recover-afl-api-adjudications` situation
(§11b's L2 pattern), not a fresh L3 run, and resolving it is out of scope for this sequence.

### 6. L0 census — exactly 802, 3/129/397/273

Reuse the read-only G1 source census (`promotion-check.ts --phase source`, the exact D5/D7 count
this issue's own gates use, `promotion-check.ts:1158-1174`) rather than hand-written SQL, so the
census can never drift from the gate that will later re-check it. It is read-only by construction
(`READ_ONLY_SQL`, `:153`), and it independently corroborates point 4 (a rebuild marker present on
the source database is itself a G1 problem, `:1161`):

*(Corrected 2026-09-25: it does **not** corroborate point 4. G1's marker read,
`readRebuildMarkerPresent` (`promotion-check.ts:1135-1139`), calls `obj_description(oid,
'pg_database')`. A database comment lives in the shared `pg_shdescription` catalogue, so that
call always returns NULL. The repository says so itself: `tests/integration/settle-afl-api.test.ts:3988-3990`
and `tools/migration/recover_afl_api_importer_identities.ts:298-299`. The rebuild's own reader
uses `shobj_description` (`rebuild_afl_api_adjudications.ts:987`, `:1006`). G1 therefore never
reports `rebuild_marker_present`. Point 4 is proven only by the `psql` `shobj_description` read in
points 3–5 and 14, and that is how L3 proved it (§11a.6). This is finding F-L4-1, §11d.0.)*

```powershell
npm run db:promotion:check -- --phase source --database afldb_test --dsn-env AFLDB_TEST_DATABASE_URL
```

Required: `PROMOTION CHECK (prod/source): PASS` and the printed line `importer rows: 802
(afl_api_manual_adjudication=3, afl_api_name_team_season_bootstrap=129,
afl_api_stat_vector_bootstrap=397, afl_api_stat_vector_season=273)` (counts must match; the
method order the tool prints is not itself significant). A different total, a different per-method
count, or FAIL stops the sequence here.

### 7–8. Prove the 92 ISSUE-224 registrations, and record ids as diagnostic only

The registration authority is `data_overrides('players', …)` (migration 073); the manual identity
namespace is `manual_admin_edit` (`rebuild_manual_registrations.ts:49`, `MANUAL_NAMESPACE`). The
count query is `readReplayState`'s own live count (`rebuild_manual_registrations.ts:603-606`):

```powershell
# 7. Expect exactly 92.
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_TEST_DATABASE_URL -c "SELECT count(*) FROM data_overrides WHERE entity_type = 'players' AND split_part(entity_key, ':', 1) = 'manual_admin_edit'"

# 8. DIAGNOSTIC ONLY, never identity (D9/D7: identity is the accepted AFL Tables path, not a
#    players.id). Record this list for later comparison; it is not itself proof of anything.
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_TEST_DATABASE_URL -c "SELECT e.player_id, e.external_id FROM external_identities e JOIN sources s ON s.id = e.source_id WHERE s.key = 'manual_admin_edit' ORDER BY e.player_id"
# expect: 92 rows (ids were 13857-13948 as of §11a.2.3; may differ if registration state has
# changed since — that is exactly why this is diagnostic, not identity)
```

### 9. Run the real `db:test:rebuild` on `afldb_test`

`--target afldb_test` names the default explicitly for the log (`DEFAULT_TARGET`,
`rebuild-test.ts:220`). `--draftguru-label annual-html-20260826` is the current L3 DraftGuru
input: it is the CLI's own default (`DEFAULT_DRAFTGURU_LABEL`, `rebuild-test.ts:2932`), a tracked
accepted manifest (`docs/rebuild-manifests/draftguru/annual-html-20260826.json`), and the only
DraftGuru snapshot present in this worktree (`data/sources/draftguru/annual-html-20260826`).

*(Corrected 2026-09-25. This paragraph originally named `annual-html-20260902` and called
`annual-html-20260826` "superseded" and absent "on this workstation". That was wrong. It
generalised two historical records made in **other** worktrees: `issues/closed/AFLDB-ISSUE-113.md:1056`,
where only `annual-html-20260902` had been copied in and the `D:\dev\afldb` directory for the
default was empty, and `issues/closed/AFLDB-ISSUE-136.md:429`. It never checked this worktree's
own `data/sources/`. The operator's evidence in this worktree shows the opposite:
`data\sources\draftguru` holds `annual-html-20260826` only; `Test-Path …\annual-html-20260902` is
`False`; `DEFAULT_DRAFTGURU_LABEL = 'annual-html-20260826'`. Both labels are tracked accepted
manifests with identical counts (42 pages / 5,057 persons / 6,810 picks, ISSUE-113:1056), and
every importer re-verifies the bytes against the manifest by SHA-256. So `annual-html-20260826`
is not superseded. The real L3 run used it successfully: persons 5057, picks 6810 (§11a.6). The
historical records in the closed issues are correct for their own worktrees and are not changed.)*

```powershell
npm run db:test:rebuild -- --target afldb_test --acknowledge-destroy afldb_test --draftguru-label annual-html-20260826 @ownerImportFlag 2>&1 | Tee-Object -FilePath "$env:AFLDB_REBUILD_CAPTURE_ROOT\issue237-L3-rebuild.log"
$LASTEXITCODE   # expect 0; log ends "Rebuild complete."
```

**Required log evidence** (stage ids, order and lines from `rebuild-test.ts:737-1031` and
`rebuild_afl_api_adjudications.ts:1420-1701`; ordinals per the current `planStages()` order):

- **Stage 2** (`afl-api-adjudications-capture`): `captured … adjudication row(s), 802 importer
  identity row(s) and 92 manual player registration(s)`; `marker  : set`. (The ledger/adjudication
  count is whatever the current human ledger holds; it is not an L3 acceptance criterion here —
  only the importer and registration counts are, per §11a.3.)
- **Stage 17** (`manual-registrations-reinstate`): `registrations: 92 creation record(s)
  reinstated …`.
- **Stage 18** (`manual-registrations-replay`): completes without error (`replay_manual_registrations.py`,
  the production `replay_admin_overrides(players)`).
- **Stage 19** (`manual-registrations-verify`): `registrations: 92 replayed exactly (player,
  manual identity, AFL Tables identity, creation record)`.
- **Stage 20** (`draftguru`): completes without error.
- **Stage 21** (`afl-api-adjudications-reinstate`): `importer: 802 inserted, 0 no-op`; `replay  :
  … 0 superseded (expected 0); bijection OK`; `marker  : cleared inside this transaction`.
- **Stage 22** (`afl-api-adjudications-bijection`): `afl_api combined importer/human identity
  invariant: OK (no rebuild marker remains)`.
- **Final validation:** PASS.

Any STOP, refusal, or a count that does not match L0 (point 6) ends the sequence: do not proceed to
`--recover-afl-api-adjudications`, and report the exact stage and message before any further action.

### 10–12. Prove capture/replay parity, the 92 registrations, and the combined invariant, independently

Stages 19/21/22 already assert these in-transaction. Prove them again from a fresh, independent
read-only connection, exactly as R5 did it (§11a.2, "A fresh reader"):

```powershell
# 10 + 12. Independent re-check of the census and the combined invariant (same command as point
#          6): expect PASS again, the same total and the same per-method counts.
npm run db:promotion:check -- --phase source --database afldb_test --dsn-env AFLDB_TEST_DATABASE_URL

# 11. Independent re-check of the 92 registrations (same query as point 7): expect 92 again.
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_TEST_DATABASE_URL -c "SELECT count(*) FROM data_overrides WHERE entity_type = 'players' AND split_part(entity_key, ':', 1) = 'manual_admin_edit'"
```

### 13. Prove one recovered provider resolves through the real settle resolver

Re-run the same live integration filter §11a.5 already ran once, so it is measured against the
POST-rebuild `afldb_test`, not the pre-rebuild one:

```powershell
npx vitest run tests/integration/settle-afl-api.test.ts -t "AFLDB-ISSUE-237"
```

Required: 9/9 PASS — a real resolution through the settle resolver against the rebuilt, live
database, not a fixture and not a DB-free mock.

### 14. Prove the marker is absent and the capture is archived

```powershell
psql -X -A -t -v ON_ERROR_STOP=1 -d $env:AFLDB_TEST_DATABASE_URL -c "SELECT coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = 'afldb_test'"
# expect: <NULL>
Test-Path $pending
# expect: False
Get-ChildItem (Join-Path $env:AFLDB_REBUILD_CAPTURE_ROOT 'afldb_test') -Filter 'afl-api-identities.*.reinstated.json'
# expect: one archived file, timestamped from this run (rebuild_afl_api_adjudications.ts:1673,
# `archivePendingCapture`)
```

**Return to Claude:** the full L3 rebuild log, every psql output above, both `db:promotion:check`
outputs, and the `settle-afl-api.test.ts` result line. Only then is L3 assessed against §11a.3's
acceptance criteria.

**What this sequence deliberately does not do.** It does not pass
`--recover-afl-api-adjudications` (there is no prior failed run to recover from here); it does not
touch DEV or production (L4/L5, §11a.3); and it does not restore the 2026 current-season corpus
(explicitly out of scope for L3, §11a.3: "Restoring the 2026 stats is not an ISSUE-237
prerequisite").

## 11d. L4 operator sequence — the next DEV promotion (rewritten 2026-09-25 after the L4 hardening; NOT RUN)

**Nothing in this section has been run.** It was first derived on 2026-09-25 by reading the
source, and that reading found three HIGH defects in the promotion checker's `afl_api` gates
(F-L4-1..3, §11d.0). They are now **fixed in code and DB-free validated** (§11d.9). This section
was then **rewritten from the corrected implementation**. It works whether DEV's `afl_api`
ledger is empty or not, and it no longer needs "A4.1 must be 0" as a safety workaround. No
database was contacted, and no command below has been run. Every command and flag is traced in
§11d.10. Where a live value is needed, the step is a named **operator read**.

**Revised again 2026-09-25 (the L4 semantic blockers).** The repaired §11d still left three
things to the operator: A4.2 (a DEV and a candidate registration of one AFL Tables path under
different tokens), A4.3 (DEV overrides keyed to 2026 matches) and the `--lineage-remap-out` file
of a refused run. All three are now **deterministic checker behaviour**, fixed in code and DB-free
validated (F-L4-8..10, §11d.0, §11d.9). **No step below asks the operator to decide anything.**
The only inputs left are the explicit L4 authorisation and live values that exist only on DEV, and
every live value that breaks a contract is a named **STOP**.

**Where it runs.** On the DEV host (`DEV: streamanator`, bash, in `~/projects/afldb`), never from
the Windows workstation. The source requires this:

- `--plan`'s dump paths, `--afl-api-dev-regeneration` and `--afl-api-supersede-in` must be
  absolute Linux host paths (`assertLinuxHostPath`, `promotion-inventory.ts:2665-2674`).
- `createdb` and the swap run as `sudo -u postgres` on the host (`docs/production-promotion.md`
  §6, §8, §13).

The workstation only opens the SSH session. **Never** paste a DSN into evidence. The shell must
have the host's DSN variables exported, exactly as `docs/production-promotion.md` §6's `pg_dump`
line already assumes.

### 11d.0 The L4 findings and their fixes (2026-09-25)

| # | Grade | Root cause | Fix | Status |
|---|---|---|---|---|
| F-L4-1 | HIGH | `readRebuildMarkerPresent` read `obj_description(oid, 'pg_database')`. That reads the per-database `pg_description`, which never holds a database comment, so it is always NULL for a `pg_database` oid. `COMMENT ON DATABASE` writes the shared `pg_shdescription`, which only `shobj_description` reads. G1's `rebuild_marker_present` could never fire. | The checker reads `DATABASE_COMMENT_SQL`, the same `shobj_description(oid, 'pg_database')` statement as the rebuild's `readRebuildMarker` (pinned equal by a test). The marker is refused at `source` (G1), `pre-cutover` (the target), `restored` (the candidate **and** the target) and `candidate`. The database-name guards are unchanged. | FIXED, DB-free validated |
| F-L4-2 | HIGH | G2 read `afl_api_identity_adjudications` from the **candidate** at `--phase restored`. That phase runs before §7 reinstates the target's ledger, and it must: the plan's remap step consumes the `--lineage-remap-out` file this phase writes. The candidate's ledger at that moment is the source's, which G1 proves empty, so G2 graded nothing and `E_promotion` was `∅` whatever DEV held. DISAGREE and COLLISION could surface only after the swap. | G2 reads each fact from the side that owns it, through explicit roles (`AflApiPromotionSides`, `AflApiG2Sides`): **importer rows and the identity remap from the candidate, the human ledger from the target** (`--old-database`). `E_promotion` is exactly the AGREE set. A new **UNRESOLVED** grade refuses a ledger identity that resolves to no candidate player, or to several, which is exactly what the D15 replay would STOP on after the swap. The restored phase also refuses a candidate carrying any source-lineage ledger or `resolved` row. No name or surrogate-id matching was added. | FIXED, DB-free validated |
| F-L4-3 | HIGH | `--phase candidate` ran the source G1, which refuses **any** ledger row. At §7.5, though, the candidate legitimately holds the target's reinstated ledger. | `--phase candidate` now **requires** `--afl-api-supersede-in <the restored file>`, and runs `gateAflApiCandidateAfterReinstate`. The reinstated ledger must equal the bound target ledger by row count and digest; zero `resolved` rows; the importer census invariants hold; no marker; and G2, re-evaluated over the reinstated ledger, must reproduce `E_promotion` exactly. The source phase is unchanged: any ledger row is still `ledger_row_present`. | FIXED, DB-free validated |
| F-L4-4 | MED | `--afl-api-supersede-out` was written even when the run REFUSED. It carried only `{issue, format, version, expectedSupersedes}`, and the post-swap replay trusted any file it was given. | The file is written **after every gate**, **only if none failed**, atomically (`writeOperatorFileAtomically`: a private temporary sibling, published by `link()`, which never replaces a file). Format v2 binds the environment, the candidate and target names, the candidate importer state and the target ledger state (row count + SHA-256 over stable fields; `player_id` excluded), the sorted `expectedSupersedes`, and a `payloadSha256` over all of it. `--phase candidate` and the post-swap `replayAflApiAdjudicationsFromSupersedeFile` both refuse a malformed, v1, foreign, tampered, stale or candidate-mismatched file before any write. An empty set is bound exactly as strongly. | FIXED, DB-free validated |
| F-L4-5 | LOW | No generator existed for the DEV regeneration classification (confirmed: nothing in the repository wrote `afldb.afl_api_dev_regeneration_classification`), so the old §11d.4 had the operator hand-author a hash-bound JSON. v1 hashed `{database, season, entries}` only and bound no compared state. | Generator: `--phase restored --afl-api-dev-regeneration-out <file>` plus `--afl-api-regeneration-season/-reason/-plan` (DEV only). It is built from G3's own grades, writes only when the run's failures are exactly G3 hard losses of `afl_api_stat_vector_season` rows that pass the §6.3 validator, and never admits the bootstrap, name/team or manual-adjudication classes. Format v2 binds the target and candidate names and **both** compared importer-state digests, and hashes every field. v1 is refused. The census phase checks that the file names its database. | FIXED, DB-free validated |
| F-L4-6 | LOW | `docs/production-promotion.md` §5 claimed the snapshot records `(external_id, stable identity, match_method)` per importer row. The code records counts only. | **Not required:** no gate reads a per-row census back. G3 and the generator read the live target at `--phase restored`, and the census phase reads the file's own entries. **Documentation corrected** instead, with a docs test. | FIXED (docs) |
| F-L4-7 | INFO | L4 proves only what DEV holds. With an empty DEV ledger it proves `E_promotion = ∅ = actual`; with a non-empty one it proves that exact set. | — | Record it in the L4 evidence; do not overclaim |
| F-L4-8 | HIGH | **A4.2.** `data_overrides` is reinstated verbatim, and the candidate's is truncated. After the swap, `replay_admin_overrides(players)` (`common.py:1229-1341`) finds DEV's token A missing (`NOT EXISTS`) and **binds** it to whichever candidate player holds A's AFL Tables path (the ISSUE-160 rule). It does this even when that player already carries candidate token B. The result is one person with two `manual_admin_edit` identities, and only A has a creation record. `readManualPlayerToken` then returns null ("refusing to choose", `player-identity.ts:42-56`), and the ISSUE-245 planner refuses exactly this state (`planRegistrationReplay`). The same token on a different path is worse: A is "present", nothing is inserted, and DEV's fields overlay a player whose path is not the record's. A path held by a non-accepted identity creates a twin without the path. A source-keyed correction whose identity the candidate lacks matches nothing, silently. No gate saw any of this before the swap. | New pre-swap gate `gateOverrideReplayTargets` → `planPromotionPlayersReplay`, run at B4 (DEV `data_overrides` vs candidate identities) and again at C2 (the reinstated overrides). It uses stable identity only. **present** and **create** pass. **bind** passes only when the path's single holder carries **no** manual token. Every other case is a named **STOP**: different token + same path, same token + different path, ambiguous or unbindable path, converging records, one path named twice, duplicate or unaccepted manual identities, a non-`identity` manual row, the replay's own `dob` refusal, and a correction resolving to 0 or more than 1 players. It never matches by name and never reads `players.id` across lineages. | FIXED, DB-free validated |
| F-L4-9 | HIGH | **A4.3.** The `matches` replay is `UPDATE … WHERE entity_key = match_key` (`common.py:1482-1547`), so an override on a match the candidate lacks is **silently lost**. The `match_coaches` replay **raises after the swap** (`:1891-1918`). The historical candidate ends at 2025, and §8 replays before §9 re-acquires 2026. Nothing re-applies such an override after re-acquisition: the settle's `ManualAuthorityProvider` answers `conflict` and proposes (`manual-authority.ts:184-226`); it never replays. **There is no supported deferred lifecycle.** | The same gate, `planPromotionMatchReplay`: every active `matches` / `match_coaches` override must name a `match_key` the candidate holds. Otherwise it is a **STOP** at B4/C2, naming the season and the lifecycle boundary. It uses no name, date or surrogate id. L4 stays blocked while any such override is active. | FIXED (STOP), DB-free validated |
| F-L4-10 | MED | `--lineage-remap-out` was written **inside** `gateLineageIdentity`: before every later gate (marker, G2, G3, A4.2, A4.3), and even when that gate itself refused, with the `UNRESOLVED` lines followed by `COMMIT`. `--plan` does not bind the file, and step 2c runs whatever `LINEAGE_REMAP_SQL` names. §11d.5 therefore produced up to three lineage files, two of them from refused runs. The SQL named its candidate only in a comment. | The gate only **prepares** the SQL. `publishRestoredLineageRemap` writes it after every gate, **only if none failed**, through `writeOperatorFileAtomically`. An existing path is refused before any database is opened, and the checker prints the file's sha256. The file's first statement inside `BEGIN` refuses any database but its candidate (`lineageRemapBindingGuard`). A refused column prints every unresolved id, because no file will list them. | FIXED, DB-free validated |

### 11d.1 Database roles

| Role | Database | DSN variable (never printed) | Owns | Read by |
|---|---|---|---|---|
| **source** | `afldb_test` | `AFLDB_TEST_DATABASE_URL` | the rebuilt lineage (L3 state) | A3 (G1) |
| **candidate** | `afldb_dev_candidate_$STAMP`, the restored rebuild; renamed to `afldb_dev` by the swap | `AFLDB_OWNER_DATABASE_URL`, database name replaced by the checker | **importer state**: `external_identities` (`afl_api`) and the identity rows every ledger identity is remapped against | B4 (G2 importer + remap, G3 candidate side), C2 |
| **target** | `afldb_dev`, the live database being replaced | `AFLDB_OWNER_DATABASE_URL` (checker, name replaced); `AFLDB_IMPORT_DATABASE_URL` (post-swap replays, **not** replaced, must name `afldb_dev`) | **durable human authority**: `afl_api_identity_adjudications` | A5, B4 (G2 ledger, G3 target side), E, F |

The same rule holds everywhere below. The candidate owns importer rows. DEV owns the human
decisions. Identity is compared only through stable identity (AFL Tables path or
`manual_admin_edit` token), never by name and never by a player id carried across lineages.

### 11d.2 Prerequisites (every one must hold before step A)

1. **The code is committed and deployed to the DEV host.** That means the ISSUE-237/245 code
   **including this L4 hardening**. `npm run merge:ready -- --issue 237` passes, the change is
   merged, and the DEV checkout (`~/projects/afldb`) is at that revision
   (`docs/production-promotion.md` §3). Two reasons:
   - `--phase source` refuses unless `afldb_test`'s migration ledger equals the checkout
     (`gateMigrationParity`).
   - The corrected gates, the bound file and the file-verifying replay exist only in that code.

   **Today it is uncommitted, so L4 cannot start.**
2. **`afldb_test` has not changed since L3.** No rebuild, R4 or registration run has touched it.
   The L3 state (§11a.6) is the source.
3. **An explicit, separate operator authorisation for L4**, in a chosen DEV window. Nothing in
   this issue authorises a DEV mutation (§14).

DEV's ledger may be empty or not. Both are supported, and A4.1 is now a record, not a gate.

### A. Read-only preparation

```bash
# DEV: streamanator
cd ~/projects/afldb && hostname && git log -1 --oneline   # the merged ISSUE-237 revision
STAMP=$(date +%Y%m%d-%H%M%S); echo "$STAMP"               # use this one value everywhere below
CAND="afldb_dev_candidate_$STAMP"
EFILE=~/backups/afldb/promotion-dev-afl-api-supersede-$STAMP.json
```

**A2. Preflight** (read-only, `tools/dev/preflight.ts`). Every `FAIL` is a stop. This needs the
AFLDB-ISSUE-243 preflight on the DEV checkout.

```bash
npm run preflight -- --mode promotion --environment dev --promotion-side source \
  --dsn-env AFLDB_TEST_DATABASE_URL --expect-database afldb_test --expect-role afldb_owner
npm run preflight -- --mode promotion --environment dev --promotion-side target \
  --dsn-env AFLDB_OWNER_DATABASE_URL --expect-database afldb_dev --expect-role afldb_owner
npm run preflight -- --mode promotion --environment dev --promotion-side target \
  --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-database afldb_dev --expect-role afldb_import
npm run preflight -- --mode promotion --environment dev --promotion-side target \
  --dsn-env AFLDB_BACKUP_DATABASE_URL --expect-database afldb_dev --expect-role afldb_backup
# expect: each "Preflight result: READY". The source proves migration parity. The three target
# runs print "INFO migration parity not read on a promotion target". The untracked nightly settle
# manifests show as "WARN working tree holds only known operational artefacts".
```

- **First real attempt (2026-09-25, DEV at `bfafed36`): STOPPED at A2, before A3.** It used the
  superseded commands, which had no `--promotion-side`:
  - A2.1 connected to `afldb_test` / `afldb_owner` with parity 104/104. It FAILed only on two
    untracked `afltables_fitzroy_core/settle-2026-2026-09-15-*.json` manifests.
  - A2.2, A2.3 and A2.4 connected to `afldb_dev` as `afldb_owner`, `afldb_import` and
    `afldb_backup` respectively. Each FAILed on the source-only `*_test` rule. A2.3 also failed on
    `permission denied for schema afldb_meta`.

  No dump, candidate, swap or any later L4 step ran. The preflight prerequisite is
  **AFLDB-ISSUE-243**. **L4 remains NOT RUN.**
- **The import DSN must name `afldb_dev` itself.** The checker replaces the database name in
  whatever `--dsn-env` names, but the post-swap replays read `AFLDB_IMPORT_DATABASE_URL`
  **unreplaced**. E2 also re-checks `current_database()` against the file.
- **So must the backup DSN.** `backup.sh` names the dump after it (`backup.sh:67-80`).

**A3. G1 on the source.** The marker is now enforced by the checker (F-L4-1). The `psql` read is
kept as an independent cross-check.

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql -X -A -t -v ON_ERROR_STOP=1 -d "$AFLDB_TEST_DATABASE_URL" -c "SELECT current_database(), current_user, coalesce(shobj_description(d.oid, 'pg_database'), '<NULL>') FROM pg_database d WHERE d.datname = current_database()"
# expect: afldb_test|afldb_owner|<NULL>        anything else: STOP

npm run db:promotion:check -- --environment dev --phase source --database afldb_test --dsn-env AFLDB_TEST_DATABASE_URL
# expect: PROMOTION CHECK (dev/source): PASS
#         [PASS] afl_api importer identity — source census (G1)
#                importer rows: 802 (… =3, … =129, … =397, … =273)     (order not significant)
#                importer state sha256: <64 hex>                         (record it)
```

**STOP** on any G1 problem: `rebuild_marker_present`, `ledger_row_present`,
`resolved_row_present`, `census_anomaly`, `unresolved_identity` or `player_holds_multiple_rows`.
Also STOP on a total or per-method count that differs from L3. Source lineage never carries human
authority. **No pending-capture check applies on the DEV host.** The L3 capture root was the
workstation's, recorded `False` after L3 (§11a.6); the marker is the cross-host authority (D11b).

**A4. DEV operator reads** (ad-hoc SQL, read-only by startup option). Each query prints
`current_database()` first, so a wrong DSN is visible.

```bash
dev_ro() { PGOPTIONS='-c default_transaction_read_only=on' psql -X -A -t -v ON_ERROR_STOP=1 -d "$AFLDB_OWNER_DATABASE_URL" -c "$1"; }
# The owner DSN must name afldb_dev for these reads; every row below must begin "afldb_dev|".

# A4.1 (a RECORD, not a gate): DEV's afl_api ledger — total rows, and net-linked providers.
dev_ro "SELECT current_database(), count(*) FROM afl_api_identity_adjudications WHERE source_key = 'afl_api'"
dev_ro "SELECT current_database(), count(*) FROM (SELECT DISTINCT ON (external_id) action FROM afl_api_identity_adjudications WHERE source_key = 'afl_api' ORDER BY external_id, id DESC) n WHERE action = 'linked'"

# A4.2 (a RECORD; B4 is the gate): DEV's active manual registrations (creation records) with their AFL Tables paths.
dev_ro "SELECT current_database(), entity_key, override_values->>'afltables_profile_path' FROM data_overrides WHERE is_active AND entity_type = 'players' AND field_group = 'identity' AND split_part(entity_key, ':', 1) = 'manual_admin_edit' ORDER BY 3, 2"

# A4.3 (an EARLY STOP; B4 is the gate): DEV active match-keyed overrides beyond afldb_test's last season.
dev_ro "SELECT current_database(), entity_type, count(*) FROM data_overrides WHERE is_active AND entity_type IN ('matches', 'match_coaches') AND split_part(entity_key, '|', 1) >= '2026' GROUP BY 1, 2 ORDER BY 2"
# expect: no rows.   any row: STOP now — B4 will refuse it (F-L4-9), so do not dump or build a candidate.

# A4.4 DEV timers that could write during the window (read-only).
systemctl list-timers 'afldb-*' --no-pager
```

Run the same A4.2 query against `afldb_test` (`-d "$AFLDB_TEST_DATABASE_URL"`, expect 92 rows) and
record both lists. **Any AFL Tables path that appears in both lists under different tokens is a
STOP now.** B4 will refuse it (F-L4-8), so do not go on to B.

- **A4.1** is cross-checked twice later. A5 must print the same ledger-row and net-linked counts,
  and B4's G2 line `human ledger: TARGET afldb_dev, <N> row(s)` must print the same total.
- **A4.2 — the rule (F-L4-8; enforced at B4 and C2, not by the operator).** The candidate carries
  `afldb_test`'s registered players as rebuilt rows, together with their `manual_admin_edit`
  identities. DEV's `data_overrides` replaces the candidate's (§1, §7.1), and each DEV creation
  record survives byte for byte. So DEV's token is the one the promoted database must carry.
  Lineage is bound by the AFL Tables path. A person may carry at most one manual token, and that
  token must have a creation record. Therefore:
  - **same token, same path** → *present*;
  - **token absent, path held by one candidate player with no manual token** → *bind* (ISSUE-160);
  - **path held by nobody, or no path** → *create*;
  - **anything else** → **STOP**. That includes a **different token on the same path**, which is
    exactly the "same path in both lists under different tokens" case.

  Tokens are minted per database (`randomUUID`), so if DEV registered any of the 92 itself, that
  person is a STOP. **L4 then stays blocked** until a supported token-convergence mechanism
  exists. That is a follow-up, proposed in §11d.8, not an L4 action.
  ~~Candidate tokens that DEV does not name are reported, not refused: they stay as rebuilt rows
  with no creation record on DEV. If DEV has no registrations, the 92 promoted players are exactly
  that case.~~ *(Superseded 2026-09-25, final pre-commit review, §11d.11.)* **A candidate token
  that no DEV creation record names is a STOP too.** After the swap it would be a
  `manual_admin_edit` identity with no creation record: `registrationsFromLive` (ISSUE-245)
  refuses that state, `attachAflTablesIdentity` rolls back on it, and a manual-only player's name
  edits are not durable. **So if `afldb_test` carries the 92 registrations and DEV does not hold
  them under the same tokens (and it cannot, because tokens are minted per database), B4 STOPs.**
  The same token-convergence follow-up (§11d.8) is what unblocks it.
  The gate also predicts every refusal the replay itself would raise after the swap (§11d.11).
- **A4.3 — the rule (F-L4-9; enforced at B4 and C2).** Every active `matches` / `match_coaches`
  override must name a `match_key` the candidate holds. There is no deferred replay after §9, so
  any 2026-keyed override is a STOP. It keeps L4 blocked while that override is active. The
  operator does not decide what happens to it.
- **A4.4 — the rule.** Stop any enabled `afldb-settle-*` timer at D2, and restart it only after
  §9. A DEV adjudication made **after** B4 makes C2 (or E2) refuse. That is fail-closed, not a
  silent loss, but avoid it by keeping `/admin/player-links/afl-api` idle from B1 onward.

**A5. Pre-cutover target census** (read-only against `afldb_dev`; it writes only the local
snapshot file, mode 600, and refuses to overwrite).

```bash
npm run db:promotion:check -- --environment dev --phase pre-cutover --database afldb_dev \
    --snapshot ~/backups/afldb/promotion-dev-$STAMP.json [--expect-super-admin <DEV super admin email>]
# expect: PASS, including
#   [PASS] afl_api rebuild marker absent (F-L4-1)
#   [PASS] afl_api importer identity — pre-cutover target census
#          importer rows: <N> (<per-method>)
#          human resolved rows: <H>; ledger rows: <L>; net-linked ledger entries: <K>
#          importer state sha256: <…>; ledger state sha256: <…>
```

- **Record N, the per-method counts, H, L, K and both digests.** L and K must equal A4.1. N is
  DEV's G3 target set (§11a.3 recorded 669 at ISSUE-235's DEV acceptance; the current value is an
  operator read).
- **Refusals:** a D5 anomaly, a bijection mismatch (ledger vs `resolved` rows), a player holding
  more than one `afl_api` row, or an importer row without exactly one accepted stable identity
  (`checkAflApiIdentityInvariant`). So is a fixture identity. L4 never passes
  `--allow-fixture-identities`, at any step. Any of these: **STOP**.
- The snapshot stores **counts only** (F-L4-6). No later step reads a per-row census from it.

### B. Dump, candidate build and plan generation (writes only files and a NEW database)

**B1. The mandatory DEV backup, proven** (`docs/production-promotion.md` §4 and §13).

```bash
hostname
bash tools/maintenance/backup.sh --keep 14            # must print "Backing up afldb_dev to …"
PRE=$(ls -1t ~/backups/afldb/afldb_dev-*.dump | head -1); echo "$PRE"
sha256sum "$PRE" | tee ~/backups/afldb/promotion-dev-$STAMP.sha256
pg_restore --list "$PRE" | grep -c '^[0-9]'           # non-zero
bash tools/maintenance/restore-test.sh "$PRE"        # restores into afldb_restore_test, never afldb_dev
```

`$PRE` is what C1 reinstates. From here to the swap, DEV's ledger must not change (A4.4).

**B2. Dump the L3 source** (`docs/production-promotion.md` §6):

```bash
pg_dump "$AFLDB_TEST_DATABASE_URL" --format=custom --compress=6 --no-owner \
        --file=/home/arm/afldb_test_rebuilt_$STAMP.dump
sha256sum /home/arm/afldb_test_rebuilt_$STAMP.dump | tee -a ~/backups/afldb/promotion-dev-$STAMP.sha256
```

**B3. Create and restore the candidate.** It is a new database and never `afldb_dev`.

```bash
hostname
sudo -u postgres createdb -O afldb_owner "$CAND"
sudo -u postgres psql -d "$CAND" -v ON_ERROR_STOP=1 -c \
  'CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; ALTER SCHEMA public OWNER TO afldb_owner;'
# CANDIDATE_DSN: the owner DSN with ONLY the database name replaced by $CAND; build it, never echo it.
pg_restore --dbname="$CANDIDATE_DSN" --no-owner --no-privileges --jobs=4 /home/arm/afldb_test_rebuilt_$STAMP.dump
```

The two "must be owner of extension" messages are the only tolerated errors
(`docs/production-promotion.md` §6).

**B4. `--phase restored`: lineage, markers, A4.2/A4.3, G2, G3, and the two files.** It is
read-only against the candidate and `afldb_dev`. It writes the lineage remap file and the bound
`E_promotion` file **only if the whole run passes** (F-L4-4, F-L4-10). Both are atomic, both
refuse to overwrite, and an existing path is refused before any database is opened.

```bash
LFILE=~/backups/afldb/promotion-dev-lineage-$STAMP.sql
npm run db:promotion:check -- --environment dev --phase restored --database "$CAND" \
    --old-database afldb_dev \
    --lineage-remap-out "$LFILE" \
    --afl-api-supersede-out "$EFILE"
sha256sum "$LFILE" "$EFILE" | tee -a ~/backups/afldb/promotion-dev-$STAMP.sha256
cat "$EFILE"
```

**Required:** `PROMOTION CHECK (dev/restored): PASS`, with:

- `[PASS] data_overrides players replay predicted on the candidate (AFLDB-ISSUE-237 A4.2)`, whose
  `present / bind / create` counts account for every A4.2 row, and which lists the candidate
  tokens DEV does not name. Record all of it;
- `[PASS] data_overrides match-keyed replay targets exist in the candidate (AFLDB-ISSUE-237 A4.3)`;
- `[INFO] Lineage remap file written`, naming `$LFILE` and a sha256 that equals the `sha256sum`
  line;
- `[PASS] afl_api rebuild marker absent (F-L4-1)`, naming both the candidate and the target;
- `[PASS] afl_api candidate carries no source-lineage human authority`: candidate ledger rows 0,
  candidate resolved rows 0;
- `[PASS] … G2 human-vs-importer overlap`, whose first two lines state the roles:
  `human ledger: TARGET afldb_dev, <L> row(s), sha256 <…>` (L and the digest equal A5) and
  `importer rows and identity remap: CANDIDATE <CAND>, 802 row(s), sha256 <…>`. Then
  `E_promotion (AGREE) = {…}`, and one line per graded net ledger entry: `AGREE` or
  `INFO_REVOKED_CANDIDATE`. A net-linked entry with no candidate importer row gets **no** line;
  it is the ordinary D15 INSERT case;
- `[PASS] … G3 cross-lineage comparison`: `<N> target row(s) (sha256 …), 802 candidate row(s)`;
- `[INFO] afl_api E_promotion file written`, naming the file, `expectedSupersedes`, the bound
  candidate and target states, and `payloadSha256`.

**Record** every G2 and G3 line, and the whole file. The file's `expectedSupersedes` must equal
the `E_promotion (AGREE)` line; `targetLedgerRowCount` must equal L; `candidateImporterRowCount`
must equal 802. The allowed G3 grades are `PASS`, `WARN (method_changed)` (DEV only), and
`INFO (gained_coverage)` for a candidate provider DEV never held.

**Pre-swap STOP points at B4.** Any of these is a STOP:

- a G2 `DISAGREE`, `COLLISION`, `UNSUPPORTED`, `UNEVALUABLE`, `CONTINUITY_CONTRADICTION` or
  `UNRESOLVED`. **Resolving any of these is not L4's to do**: correction belongs to ISSUE-238.
  `UNEVALUABLE`/`UNRESOLVED` on an identity only DEV holds (for example a DEV-only registration)
  means the source lacks that registration. The supported remedy is to register it on
  `afldb_test` before its rebuild (ISSUE-245 carries it through), never an L4 workaround;
- any G3 `FAIL (collision | disagreement | hard_loss)`. If the **only** failures are `hard_loss`
  lines, go to §11d.5 first;
- any A4.2 `STOP` line (F-L4-8) or A4.3 `STOP` line (F-L4-9). Neither has an L4 remedy. Record
  the lines, `dropdb "$CAND"`, and stop L4. A4.2's different-token case needs the §11d.8
  follow-up. A4.3 needs the override to be inactive, or the current-season lifecycle to gain an
  identity-safe replay;
- a marker, source-lineage, lineage or dangling-reference `FAIL`, or any other refused gate.

A refused B4 writes **neither** file. It prints `[INFO] afl_api E_promotion file NOT written` and
`[INFO] Lineage remap file NOT written`. Otherwise: `dropdb "$CAND"`, record the result, and stop
L4.

**B5. Generate the plan.** No database contact; refuses to overwrite.

```bash
npm run db:promotion:check -- --environment dev --plan --database "$CAND" --old-database afldb_dev \
    --pre-cutover-dump "$PRE" --rebuilt-dump /home/arm/afldb_test_rebuilt_$STAMP.dump \
    --plan-dir ~/backups/afldb/promotion-dev-$STAMP
```

Read all eight files (`docs/production-promotion.md` §7). The `.sh` is a transcript to follow, not
a script to pipe. The historical-only block must name `player_link_resolutions` and `data_edits`
(§7.4d).

### C. Candidate validation after the target-state reinstatement (writes only the candidate)

**C1.** Follow `promotion-reinstate.sh` line by line against `$CANDIDATE_DSN`, with
`LINEAGE_REMAP_SQL="$LFILE"`. Before running it, `sha256sum "$LFILE"` must equal the B4 line. The
file refuses to run on any database but `$CAND`. The steps are: truncate;
2 direct restores; 2b stage; 2c the remap, once; 2d promote the staged tables; 2e the dependants;
then the resync, the audit marker and `tools/maintenance/privileges.sql` on the candidate
(`docs/production-promotion.md` §7.1–§7.3). **This is the step that reinstates DEV's human
ledger into the candidate:** `afl_api_identity_adjudications` is staged, its `player_id` remapped
through the row's stored identity (with the stored-identity assertion), and promoted with ids
preserved (`promotion-inventory.ts:659-709`). An unresolvable row stops the remap. There is no
historical-only fallback for this table.

**C2. Accept the candidate.** The bound file is **required**.

```bash
npm run db:promotion:check -- --environment dev --phase candidate --database "$CAND" \
    --compare ~/backups/afldb/promotion-dev-$STAMP.json \
    --afl-api-supersede-in "$EFILE" [--expect-super-admin <DEV super admin email>]
# expect: PASS, including
#   [PASS] afl_api importer identity — candidate census after target-ledger reinstatement (G1)
#          importer rows: 802 (3/129/397/273)
#          reinstated human ledger: <L> row(s), sha256 <A5's ledger digest> (bound: <L>, <same>)
#          E_promotion (AGREE) = {<exactly the file's expectedSupersedes>}
#   [PASS] data_overrides players replay predicted on the candidate (AFLDB-ISSUE-237 A4.2)   (same counts as B4)
#   [PASS] data_overrides match-keyed replay targets exist in the candidate (AFLDB-ISSUE-237 A4.3)
```

**Pre-swap STOP points at C2**, each a refusal that costs `dropdb "$CAND"` and nothing else,
because `afldb_dev` has not been touched:

- `ledger_not_bound_target_state`: a human row dropped, added, downgraded or altered by the
  reinstatement, or DEV adjudicated after B4;
- `resolved_row_present`: D15 has not run, so there must be none;
- `importer_state_mismatch`, `candidate_database_mismatch`, `environment_mismatch` or
  `target_database_mismatch`: the file is not this candidate's;
- `g2_refuses_after_reinstatement` or `e_promotion_not_reproduced`;
- `rebuild_marker_present`, `census_anomaly`, `unresolved_identity` or
  `player_holds_multiple_rows`;
- an A4.2 or A4.3 `STOP` over the reinstated overrides. This means DEV changed an override after
  B4, or the reinstatement differs from the dump;
- any non-`afl_api` refusal (counts vs snapshot, fixtures, super admin, grants, parity).

**C3. The last read before the swap.** Re-run `sha256sum "$EFILE"`. It must equal the B4 line in
`promotion-dev-$STAMP.sha256`.

### D. Destructive boundary — the swap

The DEV service is `afldb` (`deploy/sync-dev.ps1:32`). Stop every timer that A4.4 listed as
enabled.

```bash
hostname
sudo systemctl stop afldb            # plus any enabled afldb-settle-* timer/service from A4.4
sudo -u postgres psql -d postgres -f ~/backups/afldb/promotion-dev-$STAMP/promotion-swap.sql
sudo systemctl start afldb
npm run db:promotion:check -- --environment dev --phase production --database afldb_dev \
    --compare ~/backups/afldb/promotion-dev-$STAMP.json [--expect-super-admin <DEV super admin email>]
```

- `afldb_dev_pre_rebuild_$STAMP` is kept for rollback.
- Rollback is `promotion-rollback.sql`, run the same way (`docs/production-promotion.md` §10).
- `--phase production` runs no `afl_api` gate; E3 and F1 cover that.

### E. Post-swap replay (as the import role, one window, in this order)

1. **The `data_overrides` replay loop, exactly as written** (`docs/production-promotion.md` §8
   step 1): `players`, `matches`, `draft_picks`, `season_list_members`, `club_leadership`,
   `coaches`, `match_coaches`, `after_siren_kicks`, `fixtures`. Then the `player_achievements`
   special-record adapter. Any raise is a real STOP. The `players`, `matches` and
   `match_coaches` branches' own refusals were already predicted and passed at B4 and C2
   (F-L4-8, F-L4-9).
2. **The D15 replay with the bound `E_promotion`.** Use the §8 `replay-afl-api-adjudications.ts`
   script (`replayAflApiAdjudicationsFromSupersedeFile`) with the B4 file, the environment and the
   target:

   ```bash
   npx tsx replay-afl-api-adjudications.ts "$EFILE" dev afldb_dev && rm replay-afl-api-adjudications.ts
   # expect: { inserted: <K − |E_promotion|>, noops: 0, stops: [], supersedes: [<E_promotion, each with its player id>] }
   ```

   Inside one transaction, before any write, it refuses:
   - a malformed, v1, foreign or tampered file;
   - a connection not on `afldb_dev`;
   - an importer state or reinstated-ledger state that no longer hashes to the file (stale or
     candidate-mismatched).

   It then supersedes **exactly** `expectedSupersedes`. An agreeing importer row outside the set
   STOPs; a missing or extra supersede STOPs (`aflApiSupersedeMismatch`); a conflicting row, an
   unresolvable or ambiguous identity, or a player already holding another provider STOPs. Any
   STOP rolls the whole replay back. The one UPDATE is `unique`/importer →
   `resolved`/`afl_api_admin_adjudication`, keeping `external_identities.id`. An identical human
   row is a no-op; human authority is never downgraded. With an empty DEV ledger the file binds
   `targetLedgerRowCount: 0`, and the replay returns `{ inserted: 0, noops: 0, stops: [],
   supersedes: [] }`.
3. **The combined invariant**, using the §8 `verify-afl-api-adjudications.ts`
   (`assertAflApiIdentityInvariant`): the D5 census, the D15 bijection (every net-linked ledger
   entry ↔ exactly one `resolved` row), one row per player, and the D7 identity check. Expect
   `afl_api identity invariant: OK`.
4. **Then:** `rebuild_derived.py` if the replay changed player or match rows; regenerate
   `player_link_match_candidates` from `/admin/player-links`; health; an admin login
   (`docs/production-promotion.md` §8 steps 1–4).

### F. Post-promotion verification

**F1. The live `afl_api` census on the promoted DEV.** `--phase pre-cutover` is reused
deliberately: it is the only checker phase that runs the target census, the invariant and the
marker check on the live name, read-only. **No** `--snapshot` is passed.

```bash
npm run db:promotion:check -- --environment dev --phase pre-cutover --database afldb_dev
# expect: importer rows: <802 − |E_promotion|>; human resolved rows: <K>; ledger rows: <L>; net-linked ledger entries: <K>
```

**F2. §9 current-season re-acquisition on DEV**, by the supervised ladder
(`docs/production-promotion.md` §9, `docs/deployment.md` §7b), owned by ISSUE-224/228. It is not
an ISSUE-237 acceptance item unless the §11d.5 exception was used.

**F3.** If the exception was used, run §11d.5 step 5's census.

**Return to Claude:**

- every command's final line and every `afl_api` gate block (A3, A5, B4, C2, F1);
- A4.1–A4.4, the full G2 and G3 line lists, and both A4.2/A4.3 gate blocks from B4 and C2;
- the `E_promotion` file's contents and every `sha256sum` line;
- E2's printed counts and E3's result;
- the classification file, the generator run and the census, if §11d.5 was used.

Only then is L4 assessed against §11a.3:

1. G1, G2 and G3 are recorded per row.
2. The actual supersedes equal `E_promotion`. E2's success proves this by construction, because
   a mismatch throws before any write.
3. The exception record and census, if used.

Per F-L4-7, record which case L4 exercised: `E_promotion = ∅` or a non-empty set.

### 11d.3 Where each AFL API gate runs

Every checker call is server-enforced read-only (`READ_ONLY_SQL`, `promotion-check.ts:175`,
applied at `:1817`). Every call runs with `--environment dev`.

| Gate | Step | Reads | Compares | PASS | Hard STOP |
|---|---|---|---|---|---|
| G1 source | A3 | **source** `afldb_test` | its `afl_api` rows, ledger row count, `resolved` rows, database comment (`shobj_description`) | no `classifyAflApiG1` problem; 802, 3/129/397/273 | any problem, or a count change |
| Target census | A5, F1 | **target** `afldb_dev` | DEV's `afl_api` rows and ledger; database comment | the invariant holds; no marker | any anomaly, bijection, multi-row, identity problem; a marker |
| Marker | B4 | **candidate** and **target** | both database comments | neither is a rebuild marker | either is |
| Source-lineage | B4 | **candidate** | its ledger row count and `resolved` rows | both 0 | either non-zero |
| G2 | B4 | importer rows and remap: **candidate**; ledger: **target**; manual tokens: both | each net target-ledger entry vs the candidate's importer row for that provider, via the entry's stored identity remapped on the candidate | only `AGREE` / `INFO_REVOKED_CANDIDATE`; `E_promotion` = AGREE | `DISAGREE`, `COLLISION`, `UNSUPPORTED`, `UNEVALUABLE`, `CONTINUITY_CONTRADICTION`, `UNRESOLVED` |
| A4.2 players replay (F-L4-8) | B4, C2 | active `players` overrides: **target** (B4) / the candidate's reinstated copy (C2); identities: **candidate** | each creation record's token + AFL Tables path, and each correction's identity, vs the candidate's accepted identities | every record `present`, `bind` (path holder carries no manual token) or `create`; every correction resolves to one player | every other case (different token/same path, same token/different path, ambiguous or unbindable path, convergence, duplicate/unaccepted manual identity, unsupported shape, `dob` refusal, unresolved correction) |
| A4.3 match-keyed overrides (F-L4-9) | B4, C2 | active `matches` / `match_coaches` overrides: as A4.2; matches: **candidate** | each override's `match_key` vs the candidate's `matches.match_key` | every key present | any key absent (every 2026 key); an undecodable `match_coaches` key |
| Lineage remap file (F-L4-10) | B4 | — (the run's own results) | — | written only if every gate of the run passed; atomic; no overwrite; refuses any database but `$CAND` | not written on any failure |
| G3 | B4 | **target** importer rows vs **candidate** importer rows | `(external_id, forward stable identity, match_method)` | `PASS`; DEV-only `WARN (method_changed)`; `WARN (hard_loss_regeneration)` only for a bound, classified season row; `INFO (gained_coverage)` | `FAIL (collision / disagreement / hard_loss)`; a classification binding or validation problem |
| `E_promotion` file | B4 | — (the run's own results) | — | written only if every gate of the run passed; atomic; no overwrite | not written on any failure |
| G1 after reinstatement | C2 | **candidate** (now holding DEV's reinstated ledger) + the bound file | reinstated ledger vs `targetLedger*`; importer state vs `candidateImporter*`; G2 re-evaluated vs `expectedSupersedes` | all equal; 0 `resolved` rows; census invariants; no marker | any C2 STOP point |
| D15 replay | E2 | the promoted `afldb_dev` (import role, **read-write**, one transaction) + the bound file | file binding, then DEV's reinstated net ledger vs the promoted `afl_api` rows | no stop; actual supersedes = `expectedSupersedes` | any binding problem, stop or set mismatch: nothing written |
| Combined invariant | E3 | promoted `afldb_dev` (import role; reads only) | D5 census, D15 bijection, one row per player, D7 | no problem | any problem |
| Regeneration census | §11d.5 | promoted `afldb_dev` after re-acquisition + the classification | the classified entries vs DEV's importer rows | the file names `afldb_dev`; every entry `PASS` | a binding mismatch; `absent` / `different_identity` / `different_method_or_status` |

**G3's DEV exception is narrow.** A hard loss is `WARN` only when **all** of these hold:

- `environment === 'dev'`;
- the provider is listed in a **generated, v2, bound** classification whose target and candidate
  names and importer-state digests match the run;
- the listed identity and method equal the target row's;
- the method is `afl_api_stat_vector_season`.

`afl_api_stat_vector_bootstrap`, `afl_api_name_team_season_bootstrap` and
`afl_api_manual_adjudication` can never qualify. The generator refuses to propose them, the
parser refuses a file listing them, and the validator refuses them (`entry_class_not_eligible`).
Production never consults a classification, and `parseArgs` refuses every classification flag
outside `--environment dev`.

### 11d.4 The `E_promotion` handoff, and how it is candidate-bound

- **Derived** at B4 from the candidate's importer rows and DEV's net ledger (roles above):
  `E_promotion = G2.AGREE` (`aflApiG2AgreeSet`).
- **Written** by B4 only if **no gate of that run failed** (`publishRestoredAflApiFiles`),
  atomically, mode 600, never over an existing file (`writeOperatorFileAtomically`). Its format
  is `afldb.afl_api_supersede_expected` **v2**:

  ```text
  { issue: 'AFLDB-ISSUE-237', format, version: 2, environment: 'dev',
    candidateDatabase: '<CAND>', targetDatabase: 'afldb_dev',
    candidateImporterRowCount, candidateImporterSha256,     // candidate importer state (stable fields + forward identity)
    targetLedgerRowCount, targetLedgerSha256,               // DEV ledger (id, provider, action, identity, supersedes_id; never player_id)
    expectedSupersedes: [sorted, unique provider ids],      // may be []
    payloadSha256 }                                         // over every other field
  ```

  The digests are deterministic, order-independent, and computed by the same library functions
  on both sides (`aflApiImporterStateSha256`, `aflApiLedgerStateSha256`). `bigint` ids are
  normalised, so the checker's and the replay's readers hash one ledger identically. The same
  state always yields byte-identical content.
- **Verified before the swap** by C2 against the reinstated candidate: the candidate name, the
  environment, the live target name, the importer state, the ledger state, and the re-derived
  `E_promotion`.
- **Verified after the swap** by E2 inside the replay transaction, before any write: the format,
  version and payload, the environment and target stated by the operator, the connected database,
  and both state digests. The candidate **name** is not observable after the rename (and the
  import role cannot read `auth_audit_log`'s `database.promoted` marker), so post-swap binding is
  by **state**. Any other candidate with a different importer state or ledger fails.
- **An empty set is bound exactly as strongly:** `targetLedgerRowCount: 0` with the empty-ledger
  digest. A promoted database that suddenly holds a decision refuses.
- **Proven by the source**, as before: only providers in the set can be superseded; the actual
  set must equal it exactly; both identities must agree; human authority is never downgraded.

### 11d.5 The DEV regeneration exception — only if B4's G3 fails on hard losses alone

**Is it needed?** That cannot be determined from source. It depends on DEV's live importer set
(A5's N) against `afldb_test`'s 802, which are different lineages (§11a.3). If B4's G3 has no
`FAIL (hard_loss)` line, the exception is not entered. Do not pass any classification flag, and
record "not used".

If G3's only failures are `hard_loss` lines:

1. **Generate the classification**; never hand-author it. Re-run B4 with the generator and new
   output names (nothing is overwritten):

   ```bash
   npm run db:promotion:check -- --environment dev --phase restored --database "$CAND" --old-database afldb_dev \
       --afl-api-dev-regeneration-out ~/backups/afldb/afl-api-dev-regeneration-$STAMP.json \
       --afl-api-regeneration-season 2026 \
       --afl-api-regeneration-reason "<why these providers are regenerated>" \
       --afl-api-regeneration-plan "<the ISSUE-224/228 §9 re-acquisition that restores them>"
   sha256sum ~/backups/afldb/afl-api-dev-regeneration-$STAMP.json | tee -a ~/backups/afldb/promotion-dev-$STAMP.sha256
   ```

   This run still REFUSES, because G3 has not passed. It must print `[INFO] afl_api DEV
   regeneration classification proposed`, listing the season hard losses. `[FAIL] … NOT
   generated` means a lost row is not of the eligible class, G3 also failed on a collision or
   disagreement, or another gate failed (an A4.2 or A4.3 STOP included). That is a **STOP**: the
   exception cannot admit it. Read the file; its `entries` must be exactly the `hard_loss` lines.
   No lineage flag is passed: a refusing run publishes no remap (F-L4-10).
2. **Approve by consuming it** in a third B4 run. The first B4 refused, so it wrote neither
   `$LFILE` nor `$EFILE` (F-L4-4, F-L4-10), and this run reuses both names:

   ```bash
   npm run db:promotion:check -- --environment dev --phase restored --database "$CAND" --old-database afldb_dev \
       --lineage-remap-out "$LFILE" \
       --afl-api-supersede-out "$EFILE" \
       --afl-api-dev-regeneration ~/backups/afldb/afl-api-dev-regeneration-$STAMP.json
   sha256sum "$LFILE" "$EFILE" | tee -a ~/backups/afldb/promotion-dev-$STAMP.sha256
   ```

   If either path already exists, the checker refuses before opening a database. That means an
   earlier run passed, and the exception was not needed: **STOP** and re-read B4's output.

   **Required:**
   - `[INFO] … DEV regeneration classification` with `<k> entries, bound to target afldb_dev and
     candidate <CAND>`;
   - G3 PASS, with exactly those k providers as `WARN (hard_loss_regeneration)`;
   - the A4.2 and A4.3 gates PASS;
   - `[INFO] afl_api E_promotion file written` and `[INFO] Lineage remap file written`.

   **STOP on:**
   - any binding problem: `target_database_mismatch`, `candidate_database_mismatch`, or
     `importer_state_mismatch`, meaning either side moved since the file was generated;
   - any validator problem;
   - a tampered-file refusal;
   - any other FAIL.

   From here, `$EFILE` and `$LFILE` are this run's files, and C1 and C2 use them unchanged.
3. **After the swap, E and F2**, plus the DEV-side regeneration the census depends on:
   - the DEV emitter, `npm run emit:afl-api-player-bridge -- --label <snapshot> --out <path>`
     (reads `afldb_dev` only, as `AFLDB_DEV_DATABASE_URL`);
   - then `import_afl_api_player_bridge.py --target dev --artefact <path>`, with
     `--validate-only`, then `--dry-run`, then `--apply`.

   The exact label and artefact come from ISSUE-224/228's current-season runbook, not from here.
4. **The mandatory census**, with the **same** file:

   ```bash
   npm run db:promotion:check -- --environment dev --phase dev-regeneration-census \
       --database afldb_dev --afl-api-dev-regeneration ~/backups/afldb/afl-api-dev-regeneration-$STAMP.json
   # expect: PROMOTION CHECK (dev/dev-regeneration-census): PASS; one PASS line per listed provider
   ```

   The file must name `afldb_dev`. Each entry must be present again with the same `external_id`,
   the same identity, `match_method='afl_api_stat_vector_season'` and `status='unique'`. **A FAIL
   leaves L4 recorded as not accepted**, with the gap listed. There is no automatic repair (§6.3).

The regeneration census runs **only** when the exception was actually used.

### 11d.6 Current-season boundary and ordering

**The missing 2026 corpus on `afldb_test` does not block L4.** The contract promotes the historical
candidate first and re-acquires the current season after the swap
(`docs/production-promotion.md` §9, §13; §11a.3's dependency table: no L4 criterion reads 2026
matches or statistics).

**The order for L4:**

1. swap (D);
2. overrides, then the D15 replay with the bound file, then the combined invariant (E);
3. F1 census;
4. F2 re-acquisition of 2026 on DEV (ISSUE-224/228);
5. only if the exception was used, the regeneration and census (§11d.5 steps 3–4).

**What the operator should expect.** Between D and F2, DEV has **no 2026 matches or statistics**.
That is the contract's intended window, not a defect. The 273 `afl_api_stat_vector_season`
identities are carried as decisions (F12), and they resolve on the first supervised settle once
the matches exist. The §8 replay runs before §9, so DEV overrides keyed to a 2026 match cannot
resolve at that point. Nothing re-applies them after §9. That is why A4.3 is a checker STOP at B4
and C2 (F-L4-9), not a deferral: while such an override is active, L4 does not reach the swap.

### 11d.7 Pre-swap STOP points and target safety

**Every `afl_api` refusal that can happen before the swap** is at A3, A5, B4 or C2. Each costs at
most `dropdb "$CAND"`:

| Step | Refuses |
|---|---|
| A3 | source marker; any source ledger or `resolved` row; census, identity or multi-row problem; count drift from L3 |
| A5 | target marker; target invariant (census, bijection, multi-row, identity) |
| B4 | either marker; a source-lineage ledger or `resolved` row in the candidate; every refusing G2 grade; every G3 FAIL; a bad or unbound classification; every A4.2 and A4.3 STOP. **No `E_promotion` file and no lineage remap file on any failure** |
| C2 | a reinstated ledger that is not the bound target ledger; `resolved` rows before D15; a file for another candidate, environment, target or importer state; G2 not reproduced; an A4.2 or A4.3 STOP over the reinstated overrides |

**After the swap**, E2 still refuses an unbound or stale file before any write, and E3 checks the
combined invariant. Both are last-line guards, not the plan.

| Hazard | Refused by |
|---|---|
| Wrong source database | `assertDatabaseForPhase('source')` (`afldb_test` only, `promotion-inventory.ts:2483-2488`); `gateIdentity` (live `current_database()`); A3's `psql` read |
| Wrong candidate | the `restored`/`candidate` name shape `afldb_dev_candidate_<stamp>` (`:2496-2503`); `--plan` the same; C2's `candidate_database_mismatch` |
| Wrong DEV target | `pre-cutover`/`production` accept only `afldb_dev` under `dev` (`:2489-2495`); `--old-database` shape check; the old connection's own `current_database()` is re-checked (`promotion-check.ts:1982`); C2's and E2's `target_database_mismatch`; E2's connected-database check |
| Production-looking target | the name matrix, fail-closed both ways; every classification flag and `--allow-fixture-identities` refused outside `dev` |
| Wrong environment | `--environment` always explicit, never inferred; the file's `environment` checked at C2 and E2 |
| Pending rebuild marker | the checker at A3, A5, B4 (both sides) and C2 (`shobj_description`, F-L4-1) |
| Stale or foreign lineage remap | F-L4-10: written only by a fully passing B4, never over a file; the file's `DO $bind$` guard refuses any database but `$CAND`; C1's sha256 check against the B4 line |
| DEV human decision lost by the post-swap replay | F-L4-8 / F-L4-9 at B4 and C2 (the `players`, `matches` and `match_coaches` branches predicted from stable identities) |
| Leftover `promotion_staging` | `gateStagingLeftover`, every phase |
| Migration mismatch | `gateMigrationParity`, every phase |
| Unresolved lineage | `gateLineageIdentity`; historical-only only where declared (§7.4d) |
| Unexpected fixture identities | `gateFixtureIdentities`; L4 never passes `--allow-fixture-identities` |
| A DSN in output | the checker takes only a variable name and prints no DSN; A4's `psql` reads print no connection string |

### 11d.8 What L4 still cannot claim

> **2026-09-25 — AFLDB-ISSUE-242 allocated (`issues/open/AFLDB-ISSUE-242.md`).**
> - **L4 remains NOT RUN, and no L4 evidence has been produced.**
> - ISSUE-242 is now the token-convergence prerequisite that points 1 and 3 below proposed.
> - **B4 remains fail-closed until ISSUE-242 is merged.** Until then, the deployed checker STOPs on
>   both cases exactly as described here.
> - After the merge, B4 plans the convergence (rebind / retire by accepted AFL Tables path), and
>   step 2c applies it. Every contradictory, orphan or unaccepted case still STOPs.
> - **2026-09-25:** the ISSUE-242 step-2c SQL has `code_test_db` rehearsal evidence (ISSUE-242
>   §8a, 103/103: executed, atomic on refusal, idempotent, 92-player mixture). This is **not** L4
>   evidence. **L4 remains NOT RUN.**

- L4 is **not** run, and nothing here is evidence of a live pass.
- Case coverage is F-L4-7's. The non-empty `E_promotion` path is proven DB-free
  (`tests/db-promotion-check.test.ts`, the L4 hardening suite) and by construction. It is proven
  live only if DEV actually holds agreeing decisions.
- ~~A4.2's token/path interaction with the post-swap `players` replay is still untraced.~~
  *(2026-09-25: traced and gated, F-L4-8. A4.3 is gated too, F-L4-9. The remap artefact is
  hardened, F-L4-10. No semantic decision remains in §11d.)*
- **Whether L4 can reach the swap depends on three live DEV values, and on nothing else.** Each is
  now a deterministic STOP, not a decision:
  1. **A4.2 different-token registrations.** If DEV registered any AFL Tables path that
     `afldb_test` also registered (for example DEV's own run of the ISSUE-224 S9 registration of
     the same 92), the tokens differ by construction. B4 STOPs. No supported mechanism converges a
     DEV token and a candidate token onto one person: tokens are never edited, and the promotion
     never writes a rebuilt table. **Proposed follow-up (not allocated; operator's number):** a
     supported, audited token convergence for the promotion boundary. For example, a bound
     pre-swap step that retires the candidate token when DEV's creation record names the same
     accepted path, re-proven at C2. It is out of scope here, because it adds a new promotion write
     class.
  2. **A4.3 2026-keyed overrides.** Any active DEV `matches` / `match_coaches` override on a 2026
     match STOPs B4 until it is inactive or the current-season lifecycle gains an identity-safe
     replay. That lifecycle belongs to ISSUE-224/228.
  3. **A4.2 candidate-only registrations** *(added 2026-09-25, §11d.11)*. Every `afldb_test`
     registration that DEV holds under no token is a STOP. If DEV registered none of the 92, all
     92 are. So **L4 is expected to STOP at B4 while `afldb_test` carries registrations that DEV
     lacks.** The token-convergence follow-up in point 1 must also cover this case. For example,
     it could retire a candidate-only token whose player holds an accepted AFL Tables path, or
     carry the creation record into DEV under an audited decision. That is out of scope here for
     the same reason: it adds a promotion write class.
- **Not covered by A4.2/A4.3, unchanged from before:** the other replay branches
  (`draft_picks`, `season_list_members`, `club_leadership`, `coaches`, `fixtures`, the two
  special-record families) keep their own post-swap refusals, and no pre-swap gate was added for
  them. None of them is keyed to a `match_key`. A post-swap raise in them is still E1's STOP.

### 11d.9 Validation of the L4 hardening (2026-09-25, DB-free, Claude-run)

No database, SSH, DEV, PROD, L4 or Git write was involved.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 111 passed, 369 skipped |
| `npx vitest run tests/player-link-mutations.test.ts` | 112 passed |
| `npx vitest run tests/db-promotion-check.test.ts` | 136 passed |
| `git diff --check` | clean |

**Tests added:**

- `tests/db-promotion-check.test.ts`, "AFLDB-ISSUE-237 L4 hardening": 15 tests driving the real
  gate functions against in-memory databases. They cover:
  - F-L4-1 (a) marker present FAIL, (b) absent PASS, (c) an unrelated object comment is not the
    marker, at source, pre-cutover, restored and candidate; the reader's SQL is pinned equal to
    the rebuild's;
  - F-L4-2 the roles, proven from which database received the ledger read; the pre-fix wiring
    reproduced as the vacuous `∅`; all six refusing G2 classes and the revoked INFO case; no
    name or cross-lineage id matching;
  - F-L4-3 source lineage still refuses, the reinstated ledger is accepted exactly, and every
    drift refuses;
  - F-L4-4 PASS-only, atomic, deterministic writing; every stale, foreign, tampered, v1 or
    mismatched file refused, by the parser, the binding check and the post-swap replay; the
    empty set bound;
  - F-L4-5 generator selection and binding, the ineligible classes, strict parsing, flag
    scoping;
  - F-L4-6 a docs test.
- `tests/player-link-mutations.test.ts`: 3 tests for `classifyAflApiG1`'s bound-ledger mode,
  G2's `UNRESOLVED` grade, and the state digests (stable fields, order independence, bigint
  strings).
- `tests/db-promotion-check.test.ts`: 3 source-pinned wiring tests updated to the corrected
  wiring.

**L4 semantic blockers F-L4-8..10 (2026-09-25, DB-free, Claude-run).** No database, SSH, DEV,
PROD, L4 or Git write was involved.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 111 passed, 369 skipped |
| `npx vitest run tests/player-link-mutations.test.ts` | 112 passed |
| `npx vitest run tests/db-promotion-check.test.ts` | 155 passed (136 + 19 new) |
| `npx eslint` over the six requested files | **27 errors, all `@typescript-eslint/no-explicit-any` in `tests/player-link-mutations.test.ts`**, a file this change did not touch. The other five files are clean. Whether the 27 predate the uncommitted ISSUE-237 work was not established, because only `git diff --check` was authorised. |
| `git diff --check` | clean (CRLF notices only). The untracked runbook and the edited files have no trailing whitespace (checked with Grep). |

Tests added in `tests/db-promotion-check.test.ts`, "AFLDB-ISSUE-237 L4 — A4.2 / A4.3 replay
gates and the lineage remap artefact": 19 tests. They drive the real planners, the real gate
function and the real publisher:

- **A4.2.** The seven required cases:
  1. same token + same path;
  2. different token + same path;
  3. same token + different path, three directions;
  4. convergence, and one path named twice;
  5. an ambiguous or unbindable path;
  6. a missing path, which creates;
  7. duplicate or unaccepted manual identities, and a non-`identity` manual row.

  Plus the ISSUE-160 bind, corrections resolving to 0, 1 or 2 players, the replay's `dob`
  refusal, an unparseable payload, candidate-only tokens, and the identity keys read.
- **A4.3.** 2026-keyed `matches` and `match_coaches` STOPs naming the boundary; an absent
  historical key; an undecodable `match_coaches` key; the last-delimiter decode.
- **Gate roles.** Restored reads overrides from the target and identities and matches from the
  candidate; candidate reads one database; the wiring and publication order are source-pinned; the
  new gate reads no name and no `players` row.
- **F-L4-10.** A refused run publishes nothing. A passing run publishes exactly the prepared SQL,
  once, and never over an existing file. The candidate-binding guard is the first statement after
  `BEGIN`, and its literal is quoted.

Updated: the read-only-by-construction count of `writeFileSync(` call sites (4 → 3; the remap
now goes through the atomic writer) and the shared-lineage pin (`writeRemap` → `prepareRemap`).
The existing guard that forbids name fields in both promotion modules was kept as it was. ~~The
planner therefore does not mirror the replay's name-field presence check, which the replay still
enforces itself.~~ *(Superseded 2026-09-25, §11d.11: that left a post-swap STOP. The planner now
predicts it through the shared ISSUE-245 validator, and the guard still holds.)*

### 11d.10 Source index for every L4 command and flag

| Command / flag | Source |
|---|---|
| `npm run db:promotion:check` | `package.json:28` → `tools/db/promotion-check.ts` |
| every flag, including `--afl-api-supersede-out`, `--afl-api-supersede-in`, `--afl-api-dev-regeneration`, `--afl-api-dev-regeneration-out`, `--afl-api-regeneration-season/-reason/-plan` | `parseArgs`, `promotion-check.ts:255-439` |
| database-comment read (F-L4-1) | `DATABASE_COMMENT_SQL` / `readRebuildMarkerPresent`, `promotion-check.ts:1276-1282`; `gateAflApiRebuildMarker`, `:1362`; `AFL_API_REBUILD_MARKER_FORMAT`, `afl-api-adjudication.ts:1947` |
| G1 source | `gateAflApiG1`, `promotion-check.ts:1344`; `classifyAflApiG1`, `afl-api-adjudication.ts:1627` |
| target census | `gateAflApiPreCutoverCensus`, `promotion-check.ts:1377` |
| roles, G2 | `AflApiPromotionSides` / `AflApiG2Sides`, `promotion-check.ts:1438-1446`; `evaluateAflApiG2`, `:1462`; `aflApiG2Entries` (identity and player collision), `:1480`; `classifyAflApiG2` / `AFL_API_G2_REFUSING_OUTCOMES`, `afl-api-adjudication.ts:1713-1724` |
| restored wiring | `gateAflApiOverlap` (G3 ungraded-row STOP), `promotion-check.ts:1556`; main's call with `{ candidate: conn.q, target: old.q }`, `:2186` |
| `E_promotion` file | `aflApiSupersedeFileFor`, `promotion-check.ts:1623`; `publishRestoredAflApiFiles`, `:2014` (called at `:2206`, after every gate); `writeOperatorFileAtomically`, `:1765`; format, `afl-api-adjudication.ts:2123-2210` |
| G1 after reinstatement | `gateAflApiCandidateAfterReinstate`, `promotion-check.ts:1689`; the file is read before any connection, `:2127` |
| G3, classification | `classifyAflApiG3`, `afl-api-adjudication.ts:1794`; `validateAflApiDevRegenerationClassification`, `:1872`; v2 format and binding, `:2256-2358`; selection, `aflApiDevRegenerationEntriesFromG3`, `:2360`; `aflApiDevRegenerationProposal`, `promotion-check.ts:1640` |
| regeneration census | `runAflApiDevRegenerationCensus`, `promotion-check.ts:1728` |
| A4.2 / A4.3 gate (F-L4-8, F-L4-9) | `gateOverrideReplayTargets`, `promotion-check.ts:1843`; readers `PROMOTION_REPLAY_*_SQL` (including the id-keyed `PROMOTION_REPLAY_PLAYER_CHECKS_SQL`), `:1797-1835`; called at restored `:2178` (`{ overrides: old.q, candidate: conn.q }`) and candidate `:2159` (`{ overrides: conn.q, candidate: conn.q }`); planners `planPromotionPlayersReplay`, `promotion-inventory.ts:3501`, `promotionPlayerCheckProblems`, `:3727`, `planPromotionMatchReplay`, `:3817`; `playerIdentityKeysOfOverrides`, `:3760`; `decodeMatchCoachKey`, `:3781`; shared payload validators `playerOverrideValueProblems` / `registrationPayloadProblems`, `tools/migration/rebuild_manual_registrations.ts:141`, `:163` |
| replay branches predicted | `replay_admin_overrides`, `tools/migration/common.py`: players `:1168-1478` (pre-check `:1191-1223`, pending/bind `:1229-1341`), matches `:1480-1547`, match_coaches `:1857-1940`; `readManualPlayerToken`, `src/db/queries/player-identity.ts:42-56`; `manualAuthorityVerdict`, `src/lib/acquisition/manual-authority.ts:184-226` |
| lineage remap file (F-L4-10) | prepared in `gateLineageIdentity` (`prepareRemap`), `promotion-check.ts:1141`; `publishRestoredLineageRemap`, `:1912` (called at `:2207`, after every gate); pre-open existence check `:2128`; `lineageRemapBindingGuard`, `promotion-inventory.ts:2127` |
| state digests | `aflApiImporterStateSha256` / `aflApiLedgerStateSha256`, `afl-api-adjudication.ts:1980-2020` |
| post-swap replay | `replayAflApiAdjudicationsFromSupersedeFile`, `replay_afl_api_adjudications.ts:478`; `readAflApiSupersedeBindingState`, `:438`; `replayAflApiAdjudications`, `:362` (exact-set check `:395`, reached for an empty ledger too); `assertAflApiIdentityInvariant`, `:542` |
| promotion procedure | `docs/production-promotion.md` §5, §6 (roles, G2/G3, file; the remap rule and the A4.2/A4.3 gates), §7.5 (`--afl-api-supersede-in`), §8 step 1 (replay script), §13 (generator, census) |
| `npm run preflight -- --mode promotion …` | `package.json:29`; `tools/dev/preflight-core.ts:30-58`; `tools/dev/preflight.ts:225-330` |
| `backup.sh`, `restore-test.sh` | `tools/maintenance/backup.sh:5-6`, `:40-47`, `:67-80`; `tools/maintenance/restore-test.sh:9`, `:45` |
| ledger staging / remap in the plan | `promotion-inventory.ts:659-709` |
| swap / rollback | `docs/production-promotion.md` §8, §10; DEV service `afldb` (`deploy/sync-dev.ps1:32`) |
| `emit:afl-api-player-bridge`, `import_afl_api_player_bridge.py` | `package.json:38`; `tools/current-season/emit-afl-api-player-bridge.ts:20-45`, `:142-147`; `tools/migration/import_afl_api_player_bridge.py:159-205`, `:720-730` |

### 11d.11 Final pre-commit review (2026-09-25, DB-free, Claude-run)

The whole uncommitted diff was reviewed against HEAD `f3e2689c`, not only the last pass. No
database, SSH, DEV, PROD, L4 or Git write was involved. Defects found and fixed:

| # | Grade | Defect (before) | Fix |
|---|---|---|---|
| FR-1 | HIGH | A4.2 did not predict the players replay's own refusals, so they could only fire **after** the swap. A creation record with no usable name raises in `replay_admin_overrides(players)`'s pre-check (`common.py:1191-1223`). Any value the replay cannot cast (`::date`, `::smallint`, `::value_confidence`) raises in its INSERT or merge UPDATE; a pinned test even passed `dob_confidence: 'exact'`, which is not a `value_confidence` (migration 001). So do a non-object correction (`jsonb_each`), two equal-authority overrides disagreeing on one field of one player (`:1381-1417`), and a merged row violating `players_dob_confidence_ck` / `players_birth_range_ck`. A dob-only correction meeting a candidate row with confidence `'unknown'` is enough, because the data editor records changed fields only. | Creation records go through the shared ISSUE-245 validator (`registrationPayloadProblems`), and corrections through the new shared `playerOverrideValueProblems` (`rebuild_manual_registrations.ts:141`), which adds smallint range and scale checks (jsonb keeps `1990.0`, and `'1990.0'::smallint` raises) and a real calendar-date check. `planPromotionPlayersReplay` predicts equal-authority conflicts and records the replay's per-key winners (`merges`). `promotionPlayerCheckProblems` predicts the two CHECKs from the candidate's `dob IS NOT NULL`, `dob_confidence`, `birth_year_min` and `birth_year_max`, read by the player ids the stable identities already resolved (`PROMOTION_REPLAY_PLAYER_CHECKS_SQL`). Neither promotion module names a presentation field, and the name guard is unchanged. The new-gate guard was **narrowed**, not removed: from "no `players` read" to "no name column, and exactly one `players` read, id-keyed, the CHECK columns only". This is an operator-visible test change, recorded here. |
| FR-2 | HIGH | A4.2 only **listed** a candidate `manual_admin_edit` token that no target creation record names. It would survive the swap as a manual identity with no creation record. `registrationsFromLive` refuses that state (`rebuild_manual_registrations.ts:359-364`). `attachAflTablesIdentity` rolls back on it (`admin-draft.ts:1536-1542`). `syncManualIdentityNameRecord` returns `no_durable_record`, so a manual-only player's name edits are not durable. For a player that also holds an AFL Tables path it is inert today (`resolvePlayerIdentity` prefers the path), but no lifecycle admits it. | **Outcome C: a STOP before the swap**, with or without a path. Retiring the token or carrying its record (outcome B) is a new promotion write class, deferred to the token-convergence follow-up (§11d.8 point 3). **Consequence: L4 STOPs at B4 while `afldb_test` carries registrations that DEV does not hold under the same token.** |
| FR-3 | HIGH | G2 found a `COLLISION` by identity **string**, but the post-swap D15 planner refuses by **player** (`afl-api-adjudication.ts:962`). ISSUE-235's link stores the first path in collation order (`afl-api-player-links.ts:82`), while the forward classifier gives a continuity-pair player the continuing path. So consider a ledger entry naming the renumbered path, with no candidate row, on a player that holds another provider's importer row. G2 passed it, `E_promotion` was written, and D15 then STOPped after the swap. | `aflApiG2Entries` also collides by the remapped candidate player (`promotion-check.ts:1480`). The D15 `remappedIdentity !== playerIdentity` branch is unreachable, because the reverse classifier returns the identity itself (`afl-api-adjudication.ts:803`, `:822`). |
| FR-4 | MED | At `--phase restored`, G3 silently left out an importer row whose player has no single forward identity (`aflApiViewToG3`). The live target is re-read there without `--phase pre-cutover`'s invariant, so a DEV player who gained a second path after pre-cutover lost its row unseen. | Such a row, on either side, is a G3 STOP. The DEV regeneration generator refuses it too, never classifying it as a hard loss. |
| FR-5 | MED | `db:test:rebuild --recover-afl-api-adjudications` could not recover a run that died after Stage 17 committed the creation records but before the registration replay. The registration check threw before `decidePendingCapture`, which blocked the documented recovery (fail-closed, nothing lost). | With a marker present, the check refuses unless the decision is `adopt-pending`, which resets and replays from the ORIGINAL capture. Without a marker it still refuses unconditionally (`rebuild_afl_api_adjudications.ts:1551-1567`). |
| FR-6 | LOW | `replayAflApiAdjudications` returned early on an empty ledger, before the exact-set check. A non-empty expected set was accepted with zero supersedes; only the file path's ledger-digest check caught it. | The early return now applies only when the expected set is empty (`replay_afl_api_adjudications.ts:377`). |
| FR-7 | LOW | ESLint: 7 `no-explicit-any` errors on ISSUE-237 lines in `tests/player-link-mutations.test.ts`, 4 in `tests/db-test-rebuild.test.ts` and 1 in `tests/integration/settle-afl-api.test.ts`, plus 3 unused imports. | Proper types (`CapturedImporterRow`, `AflApiCandidateIdentityRow`, `AflApiPlayerRemapResult`, `AflApiForwardIdentityResult`, `AflApiImporterMatchMethod`, `Object.assign` for the fake transactions); no disable directive. |

**Recorded, not changed.**

- **FR-8, LOW.** `--phase restored` publishes the `E_promotion` file and then the remap. If the
  second atomic write fails (an I/O error, or an `EEXIST` race after the pre-open check), one bound,
  correct file remains, and a re-run refuses up front because its path exists.
- **The lineage remap binding is by candidate NAME**: the `DO $bind$` guard compares against
  `current_database()`, and candidate names are stamped per run. A candidate dropped and recreated
  under the same name with different content would pass the guard. C1's operator sha256 check
  against B4's printed line (§11d.7) is what ties the applied file to the B4 run. It is not
  content-bound in SQL.

**Traced and sound.**

- G2 → `E_promotion` → D15. The ledger always comes from the target at restored, and from the
  proven-equal reinstated ledger at candidate. The file is written only on a fully passing run,
  bound to both states, and re-verified at candidate and before the post-swap replay. The replay
  supersedes exactly the expected set. With FR-3, every D15 STOP class has a refusing G2 grade.
- The DEV regeneration generator is DEV-only and restored-only. It is reached only on a G3 FAIL
  and selects only `afl_api_stat_vector_season` hard losses. It is bound to both compared importer
  states, v2 and hashed, published atomically without overwrite, and re-verified by the
  post-reacquisition census. A passing G3 never generates it.

**Validation (DB-free).**

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-245"` | 29 passed (28 + FR-5) |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 112 passed (111 + FR-6) |
| `npx vitest run tests/player-link-mutations.test.ts` | 112 passed |
| `npx vitest run tests/db-promotion-check.test.ts` | 164 passed (155 + 9: FR-1 ×6, FR-3, FR-4 ×2; FR-2 extends two existing cases) |
| the whole `tests/db-test-rebuild.test.ts`, `tests/data-overrides-source-contract.test.ts`, `tests/reference-data.test.ts` | 596 / 598. The 2 failures predate this diff: the known `afl-api-player-links.ts` `.json` resolver gap (the test is unchanged from HEAD), and `reference-data.test.ts` §H12. That test does not list the ISSUE-235 table `afl_api_identity_adjudications`, and neither the test nor any migration is in this diff. It is untracked; allocation is the operator's. |
| ESLint over all 19 changed or untracked `.ts` files | **0 errors on ISSUE-237 lines.** 47 errors remain, each on an untouched HEAD line, and they equal HEAD's own per-file counts (player-link-mutations 20, db-test-rebuild 7, settle-afl-api 19, rebuild-test 1). |
| `git diff --check`, `git diff HEAD --check` | clean |

### 11d.12 Second real L4 attempt (2026-09-25, operator-run): STOPPED at A4.3; L4 NOT RUN

This result was reported by the operator and recorded here; Claude did not re-run it. The A2
preflight results belong to AFLDB-ISSUE-243 and are recorded there. *(2026-09-26 closure audit:
they never were. ISSUE-243 runbook §10 has the gap and the read-only closure path.)*

| Step | Result |
|---|---|
| A3 (G1 on `afldb_test`) | **PASS.** Importer rows **802**: 273 / 397 / 129 / 3, the L3 census; order not significant. Importer state sha256 `e04a57767c60479cdac13c054c69c519cc00a826d6f1670dad7bef32bc98783b`. Marker `<NULL>`. |
| A4.1 (record) | DEV `afl_api` ledger rows **0**; net-linked **0**. |
| A4.2 (record) | DEV active manual registrations **92**; source (`afldb_test`) registrations **92**. |
| A4.3 (early STOP) | **STOP: `matches` = 1.** |

- **The exact blocker** is one active override: `matches` / `2026|R30|2026-12-31|104|103` /
  `notes` = `AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN`.
  - It is the retained AFLDB-ISSUE-109 DEV validation fixture override.
  - Its canonical match is absent from `afldb_dev`: it was deleted on the old DEV lineage and
    carried as an orphan through the 2026-09-06 DEV promotion.
  - A4.3 behaved as designed (F-L4-9) and is not weakened.
- **Nothing past A4.3 ran:** no A5, backup, dump, candidate, `--plan` or swap.
- **Prerequisite: AFLDB-ISSUE-246** (`issues/closed/AFLDB-ISSUE-246.md`), the audited,
  fixture-bound retirement of that override. After it, A4.3 must return no rows. Then resume L4 at
  §11d A under its own authorisation. *(2026-09-25: met; see §11d.13.)*
- **L4 remains NOT RUN**: it stopped before the destructive boundary.

### 11d.13 AFLDB-ISSUE-246 live repair (2026-09-25, operator-run): PASS; A4.3 cleared; L4 NOT RUN

The operator reported this result; Claude recorded it and did not re-run it. The full evidence is
in `issues/closed/AFLDB-ISSUE-246.md` §10.1.

- **ISSUE-246 live repair: PASS**, on DEV at `4bb23a8f`, after a mandatory `afldb_dev` backup.
  - Validate-only returned WOULD_RETIRE.
  - `--apply` returned RETIRED, with retirement audit **`auth_audit_log` 983**, 2 writes,
    COMMITTED.
  - The rerun returned ALREADY_RETIRED on the same 983, with 0 writes.
  - Override `id 1` (`matches` / `2026|R30|2026-12-31|104|103` / `notes`) is preserved and
    inactive. The canonical fixture match is still absent.
  - `data_edits` (153/245) and `data_overrides` (118) are unchanged, and `auth_audit_log` grew by
    exactly one row (max 982 → 983).
  - **ISSUE-246 is RESOLVED.**
- **The A4.3 rerun** (ISSUE-246 P4, the §11d A4.3 query verbatim) returned **no rows**. **A4.3 is
  now PASS, and L4 is unblocked at A4.3.**

**L4 gate state after ISSUE-246:**

| Step | State |
|---|---|
| A3 | remains **PASS** (§11d.12) |
| A4.1 | remains DEV `afl_api` ledger **0** / net-linked **0** |
| A4.2 | remains DEV manual registrations **92** / source **92** |
| A4.3 | **PASS**: no rows |
| A5 onward | **NOT RUN** |

- **Nothing past A4 ran as part of ISSUE-246:** no A5, promotion dump, candidate, `--plan` or
  swap. The ISSUE-246 pre-mutation backup was that issue's own safety net and is not an L4
  artefact.
- **L4 remains NOT RUN, and ISSUE-237 remains OPEN.**
- **Next step: L4 A5**, under ISSUE-237 and its own separate DEV authorisation. *(2026-09-25: A5
  ran and was REFUSED on two independent gates; see §11d.14.)*

### 11d.14 L4 A5 REFUSED (2026-09-25, operator-run): two independent gates; L4 NOT RUN

The operator reported this result; it was recorded here and was not re-run.

- **A5** (`db:promotion:check --environment dev --phase pre-cutover --database afldb_dev`, without
  `--allow-fixture-identities`, as §11d A5 requires) **REFUSED**, on two independent gates in the
  same run.
- **The AFL API census itself PASSED:** importer rows **669**, `afl_api_stat_vector_season` **669**,
  human resolved rows **0**, adjudication ledger **0**, net-linked ledger **0**. L = 0 and K = 0
  agree with A4.1 (0/0).
  - importer SHA256: `ec7a5af7b0bb5711ad84a1f5968f27f7fb9a60f3751956dd6687e0781421661e`
  - ledger SHA256: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`

**Independent blocker 1 — AFLDB-ISSUE-151 staged-rows gate.**

`Staged tables hold rows in the replaced database` FAILed:

```text
[FAIL] Staged tables hold rows in the replaced database
  brownlow_vote_entry_state      3
  external_grid_sources          1
  afl_api_identity_adjudications 0 — EMPTY
```

This is not an ISSUE-237 defect. An empty `afl_api_identity_adjudications` ledger is a valid,
evidenced DEV state (no administrator has adjudicated an `afl_api` identity). The generic
ISSUE-151 staged mechanism conflated a legitimate zero-row table with a stage restore that never
ran, and refused both. No ledger row is to be manufactured. **Prerequisite: AFLDB-ISSUE-247**
(`issues/open/AFLDB-ISSUE-247.md`): a contract-declared `stagedMayBeEmpty` permission on
`afl_api_identity_adjudications`, accepted at step 2d only on per-table stage-completion evidence
written by the staged `COPY`'s own trigger. Implemented and DB-free validated 2026-09-25, and
committed `86e0e2ba` with the `code_test_db` PostgreSQL rehearsal PASS 7/7, rollback-only, zero
residue, on 2026-09-26. `external_grid_sources` and `brownlow_vote_entry_state` still require
rows. The live DEV empty-table/COPY-header proof and combined DEV deployment are still pending.

**Independent blocker 2 — reserved-domain fixture identity gate.**

The test-fixture identity gate (`gateFixtureIdentities`, reserved domains) also REFUSED. The
exact fixture closure on `afldb_dev`:

| Row | Facts |
|---|---|
| `auth_users` 14 | `e2e-plain-admin@afldb.test`: disabled, password and TOTP present |
| `auth_users` 17 | `e2e-super-admin@afldb.test`: disabled, password and TOTP present |
| `auth_users` 18 | `testcon@test.test`: disabled, password and TOTP present |
| `admin_invites` 5 | `testcon@test.test`, `contributor`, `invited_by` 4, `used_at` 2026-09-11 13:12:00.671379+10, expired, not revoked |

The full FK census into 14/17/18:
- `auth_audit_log.actor_user_id` **8**: 807, 811, 889 and 912 are `admin.login`; 808, 812, 890 and
  913 are `admin.logout`. All are user 18, with NULL `detail`.
- `auth_sessions.user_id` **4**: 13, 15, 29 and 35, all user 18, all already revoked.
- **Every other FK is 0.** No durable football, admin or business provenance is owned by these
  identities.

The gate behaved as designed and is not weakened. L4 never passes `--allow-fixture-identities`,
and renaming the emails is excluded. **Prerequisite: AFLDB-ISSUE-248**
(`issues/open/AFLDB-ISSUE-248.md`), the audited DEV cleanup bound to exactly this closure.
Implemented and DB-free tested, committed `a4f734af`; live validate/apply/idempotence/postchecks
are still pending. After it, P3 of that runbook must find no reserved-domain row.

**Snapshot handling.** `--phase pre-cutover` writes `--snapshot` whatever its verdict, and this
refused run left `/home/arm/backups/afldb/promotion-dev-20260925-203256.json`. That file is
failure-run evidence only: it must not be reused for B/C and must not be overwritten or deleted.
A future A5 uses a fresh `$STAMP` — the checker refuses to overwrite.

- **Nothing past A5 ran:** no B1 promotion backup, no promotion source dump, no candidate, no
  plan, no swap.
- **Next:** finish combined ISSUE-247/248 integration; deploy the combined result to DEV; run
  ISSUE-248's controlled validate/apply/idempotence/postchecks; run ISSUE-247's live DEV
  empty-table/COPY-header proof; then rerun L4 A5 with a fresh `$STAMP` under a separate DEV
  authorisation. L5 remains scheduled production work.

**L4 gate state after A5:**

| Step | State |
|---|---|
| A3 | remains **PASS** (§11d.12) |
| A4.1 | remains DEV `afl_api` ledger **0** / net-linked **0** |
| A4.2 | remains DEV manual registrations **92** / source **92** |
| A4.3 | remains **PASS** (§11d.13) |
| A5 | **REFUSED on TWO independent gates**: ISSUE-151 staged rows (prerequisite ISSUE-247) and test-fixture identities (prerequisite ISSUE-248) |
| B onward | **NOT RUN** |

- **L4 remains NOT RUN, and ISSUE-237 remains OPEN.**

### 11d.15 L4 PASS (2026-09-26, operator-run): the first accepted real DEV promotion; L5 NOT RUN

The prerequisite blockers on A5 (AFLDB-ISSUE-247, AFLDB-ISSUE-248) and the discovered
AFLDB-ISSUE-249 (first-kick-goal reconstruction) are all resolved and deployed at main/DEV
`6ae70722`. This run is the first real DEV promotion this issue accepts. Promotion stamp:
`20260926-085511`. Promoted live database: `afldb_dev`.

*(2026-09-26 closure audit.)* "Resolved" above means that the blockers are deployed and no longer
stopped L4. It does not mean ISSUE-247 and ISSUE-248 are resolved.

- The same bulk audit also covered ISSUE-242 and ISSUE-243.
- All four L4 prerequisites stay **open**, because this record does not preserve their own
  closure evidence:
  - ISSUE-242: the B4/2c/C2 convergence counts;
  - ISSUE-243: the four A2 READY results;
  - ISSUE-247: the A5 permitted-empty line, R6, stage-completion readback, the 2d NOTICE and the
    C2 0/0 compare;
  - ISSUE-248: the §9 cleanup and P1–P4.
- The "documented targeted grid repair" below is not documented anywhere in the repository.
- Each prerequisite runbook's closure-audit section names exactly what is missing. This L4 PASS
  and ISSUE-237's state are unchanged.

**A — source and prerequisite proof.**

- ISSUE-249's fix is live: the rebuild owns a pinned `first-kick-goal` stage; `afldb_test` was
  reloaded with it.
- The first-kick-goal source promotion gate PASSED: 334/334 manifest-backed
  `wikipedia_first_kick_goal` identities.
- L3/source rebuild FINAL VALIDATION reported 89 checks; the source promotion gate PASSED overall.

**B/C — candidate, pre-swap and swap.**

- A/B/C gates passed after the documented targeted grid repair.
- **G3 classified exactly one hard loss:** `CD_I297354`, class `afl_api_stat_vector_season`, stable
  identity `players/K/Karl_Amon.html`. The DEV regeneration classification file is
  `afl-api-dev-regeneration-20260926-085511.json` (per §11d.5, the classification proposes
  `afl_api_stat_vector_season` hard losses only, format v2).
- `E_promotion` (the G2 AGREE set) was empty.
- Post-swap, the production-phase promotion check PASSED, and the first-kick-goal promotion gate
  PASSED after the swap.

**E — post-swap replay.**

- **E1 (normal admin-override replay): PASS.**
- **E1b (first-kick-goal special-record replay): recreated 1, restored 0, corrected 0, lifecycle 0.**
  Resulting first-kick-goal census: `total_first_kick_goal|335`, `wikipedia_first_kick_goal|334`,
  `manual_first_kick_goal|1` — the exact pre-failure DEV state, and the AFLDB-ISSUE-249 regression
  proof.
- AFL API adjudication replay: inserted 0, noops 0, stops none, supersedes none. Combined AFL API
  identity invariant: OK.

**§9 — current-season reacquisition (the DEV §6.3 regeneration path for the G3 hard loss).**

- Snapshot label `settle-2026-2026-09-26-0941`.
- Fresh AFL Tables acquisition: 217 matches, 9,982 player-stat rows, observation bundle complete, no
  rejections; dry run clean; real apply clean.
- Applied batch 86: observations 10,199; canonical rows inserted 21,457, updated 0; canonical
  applications logged 19,938; canonical apply refusals 0; canonical apply failures 0; derived
  recompute 669 players; ACTIVE exceptions 0; unresolved identities 0; source completeness COMPLETE.
- Post-settle live census: `matches_2026|217`, `player_match_stats_2026|9982`,
  `afl_api_stat_vector_season|273`, `CD_I297354|0`.
- ISSUE-249 regression proof at this point (unchanged from E1b): `total_first_kick_goal|335`,
  `wikipedia_first_kick_goal|334`, `manual_first_kick_goal|1`.
- Health: `{"status":"ok","database":"ok","latencyMs":18}`.
- Fresh AFL API acquisition label `afl-api-2026-2026-09-25-235854`, manifest sha256
  `afb2a754943fba59a48eabf0bf01dbae7e64046e012318864dc84f68c96907c7`: season 2026, kind
  `afl_api_match_snapshot`, 218 matches in feed, 217 selected, 652 manifested files, selection
  CONCLUDED.
- Fresh target-bound DEV bridge evidence: bundle v2, 217 match units, 0 build failures,
  `current_database()='afldb_dev'`, role `afldb_app`, `transaction_read_only=on`; snapshot
  matches 217, player-match rows 9983, distinct provider players 669; canonical matches resolved
  217/unresolved 0; canonical PMS rows read 9982; providers linked 669, unresolved 0,
  contradictory 0; player-match rows covered by linked providers 9983, uncovered 0; 0 duplicate
  jumper keys, 0 nonstandard jumpers, 0 all-zero withheld. Overlap with the previously accepted
  provider set: existing linked 669, both linked 669, newly linked 0, existing-only 0, newly
  contradictory 0.
- Fresh promotion-bound bridge artefact:
  `/home/arm/backups/afldb/promotion-dev-20260926-085511-afl-api-player-bridge.json`, sha256
  `75ee96ca79089ac5fe6212501ff9448b22ac24b722029058344b5d9318ad8fb3`. Contract:
  `tool=tools/current-season/emit-afl-api-player-bridge.ts`,
  `match_method=afl_api_stat_vector_season`, `built_from_database=afldb_dev`, `read_only=true`,
  `snapshot_label=afl-api-2026-2026-09-25-235854`, census 217 matches / 9983 rows / 669 providers,
  669 linked / 0 unresolved / 0 contradictory. `CD_I297354` disposition `linked`, candidate player
  id 7974, observed name Karl Amon.
- **Loader validate-only:** `would_link 1`, `already_linked 668`, `already_linked_human 0`,
  0 HALTs (contradiction/collision/identity-check).
- **Loader dry-run:** `linked 1`, `already_linked 668`, 0 withheld, exit 0. Rollback proof after
  the dry run: `CD_I297354_row_count=0`.
- **Real bridge apply:** `linked 1`, `already_linked 668`, 0 withheld, exit 0. Post-apply identity
  proof: `CD_I297354|unique|afl_api_stat_vector_season|1|players/K/Karl_Amon.html`.

**Mandatory ISSUE-237 DEV regeneration census.**

Command phase `--environment dev --phase dev-regeneration-census --database afldb_dev
--afl-api-dev-regeneration afl-api-dev-regeneration-20260926-085511.json`:

```text
[PASS] Database identity
[PASS] afl_api DEV regeneration — post-re-acquisition census
       CD_I297354: PASS

PROMOTION CHECK (dev/dev-regeneration-census): PASS — 2 gate(s) evaluated, none failed.
```

Exit 0. Final health: `{"status":"ok","database":"ok","latencyMs":17}`.

**Retained evidence, not touched:** `afldb_dev_pre_rebuild_20260926-085511`,
`afldb_dev_candidate_20260926-033212` (the earlier failed L4 candidate, first-kick-goal 0; kept as
the AFLDB-ISSUE-249 discovery record).

**L4 gate state after this run:**

| Step | State |
|---|---|
| Source/L3 (post-ISSUE-249 fix) | **PASS**, 334/334 |
| A–C (candidate, pre-swap, swap) | **PASS**, after the targeted grid repair |
| G3 | one classified hard loss, `CD_I297354` (`afl_api_stat_vector_season`); `E_promotion` empty |
| E1 (admin override replay) | **PASS** |
| E1b (first-kick-goal special replay) | **PASS**: recreated 1; census 335/334/1 |
| §9 current-season reacquisition | **PASS**: batch 86, 0 refusals/failures |
| DEV bridge + loader (validate-only → dry-run → apply) | **PASS**: 669/669 linked, `CD_I297354` regenerated |
| `dev-regeneration-census` | **PASS** |
| **L4** | **PASS** |
| L5 (PROD) | **NOT RUN** |

**Closure interpretation.** The narrow DEV G3 exception (§6.3, OD-3) was actually used, for exactly
one classified `afl_api_stat_vector_season` hard loss. The required target-bound
re-acquisition/regeneration sequence completed, and the mandatory census passed. **The DEV
promotion is accepted under the ISSUE-237 §6.3 contract.** **ISSUE-237 remains OPEN**, because L5
PROD is still NOT RUN. Production's G3 hard-loss rule is unmodified: FAIL, with no DEV-style
exception. **Next action:** L5, inside a future scheduled production promotion.

## 12. Non-goals and successors

- **ISSUE-238:** correcting a consumed link, including every G2/G3 FAIL resolution.
- **ISSUE-239:** human recovery outside D15.
- **ISSUE-240:** dedup of contradiction findings.
- **AFLDB-ISSUE-241 (allocated 2026-09-24, OD-5):** harden the bridge artefact/importer contract
  against stale database-local `candidate_player_id` reuse (F3). **Not implemented under
  ISSUE-237.** The allocation was checked against the index and ledger on 2026-09-24. 240 was the
  highest sequential ID, 241–243 were unused, and 244 is a one-off out-of-sequence reconciliation
  (`issues.md` ISSUE-244 ID note).
- **AFLDB-ISSUE-245 (allocated 2026-09-25):** the `afldb_test` destructive rebuild does not
  preserve or replay manual player registrations or `data_overrides`. It blocks L3 (§11a.3).
  **Not implemented under ISSUE-237.** *(2026-09-25: **RESOLVED** on the `code_test_db`
  rehearsal (§11a.5) and the real `afldb_test` proof through L3 (§11a.6). `data_edits` is not
  carried, by design. That is recorded as a finding only; no successor is allocated.)*
- **No new matching** and no change to the evidence classes.
- **No PROD loader target**, and no relaxed provenance gate.
- **No tracked or exported importer-identity artefact** in the rebuild (D1). The OD-4 export is a
  one-off, untracked recovery input, not a lifecycle mechanism.

## 13. Implementation slices, in dependency order

1. **S1, pure module and DB-free tests.** Constants, capture structure, the importer replay
   planner, parity, census, the G2/G3 classifiers (production, DEV and the regeneration validator)
   and the OD-2 supersede branch (§9, the first suite).
2. **S2, adapter.** `readAflApiImporterRows`, `replayAflApiImporterRows`, the D15 supersede UPDATE
   (with the expected list) and `assertAflApiIdentityInvariant`, all in
   `replay_afl_api_adjudications.ts`.
3. **S3, rebuild tool (includes F5).** It is **gated by prerequisite P-M (D11d)**: P-M points 1
   and 2 pass before any marker code is written. If P-M fails, the marker is redesigned and the
   redesign goes back to the operator first. S3 covers:
   - the combined format;
   - the capture root (D11a), with no `process.cwd()` path;
   - the database marker (D11b);
   - the generalised pending decision (D11c), which refuses an overlapping pending capture;
   - the Stage 2 `E_rebuild` STOP before destruction;
   - the Stage 18 independent re-check `E_rebuild = ∅` before mutation, and
     `actualSupersedes = {}` at (c);
   - reinstate order (a)–(e);
   - the Stage 19 verify;
   - the `rebuild-test.ts` `precheck`, names, comments and header.

   It includes the `db-test-rebuild` tests and the I18 harness.
4. **S4, promotion checker.** G1, the pre-cutover census, G2, G3 (production and DEV), the DEV
   classification input and the `dev-regeneration-census` phase, with `db-promotion-check` tests.
5. **S5, docs.**
   - `docs/production-promotion.md`:
     - the §1 note;
     - the §3/§5/§7 gates, with production G3 hard loss = FAIL;
     - §8 step 1 (supersede with the expected list, and the combined verify script);
     - the §13 DEV exception and census;
     - remove the "ISSUE-237 gap" sentence.
   - `docs/acquisition/AFLDB-2026-API-ACQUISITION.md`: the implemented lifecycle, replacing the
     boundary note that was corrected in this revision.
   - `docs/deployment.md` §6a: the stage description and `AFLDB_REBUILD_CAPTURE_ROOT`.
   - The `promotion-inventory.ts` stale text (F11).
6. **S6, integration tests** (§10) on `afldb_test`.
7. **S7, the OD-4 recovery tool** (§11a, R3–R5) and its DB-free tests. It is implemented but
   **not run**.
8. **S8, operator live validation** L0–L5, in the §11 order and with its blocks.
9. **S9, closure.** `issues.md` resolution, `IssuesIndex.md`, `CHANGELOG.md`, and the move to
   `issues/closed/`.

## 14. Next action

OD-6 is approved. **S1–S7 are authorised (2026-09-24)** as the non-destructive implementation
phase, within these boundaries:

- **S3 remains gated by P-M (D11d).**
- **No destructive `db:test:rebuild`** is authorised.
- **No production promotion** is authorised.
- **No DEV mutation** is authorised unless a later step explicitly grants it.
- **L3–L5 remain blocked** until R1 proves the candidate pre-I18 backup authoritative. R1 may be
  planned separately, but the candidate dump is not treated as authoritative until every one of
  R1.1–R1.5 passes.
- **No commit, merge or push** without separate authorisation.

Implementation starts at S1 (§8). No code has been written, and nothing has been run.
*(Superseded 2026-09-25: S1–S7 are implemented, L1/L2 PASS, P-M point 3 PROVEN, and S6 is green;
see §0 and §10.1. ISSUE-237 is **not** resolved: the remaining S8 items stay operator-gated, and
L3–L5 remain blocked on R1.)*
*(Superseded 2026-09-25: R1 and R2 PASS. The R3 export CLI is implemented but not yet run. The next
action is the operator's live R3 run against `issue237_r1_restore`, whose evidence is recorded in
§11a.1. R4 needs its own CLI and authorisation first, and L3–L5 stay blocked until R5 passes.)*
*(Superseded 2026-09-25: the first live R3 run failed, correctly, on four exact continuity-pair
players. The OD-7 continuity amendment is implemented and DB-free tested. The next action is the
operator's **rerun of R3** with the unchanged §11a.1 command. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: R3 PASS and S6 9/9 PASS, recorded in §11a.1. The reverse-direction
continuity tightening is implemented and DB-free tested. The next action is R4, which needs its own
CLI and a separate operator authorisation. R4 is not started. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: the R4 CLI is implemented and DB-free tested (§11a.2). The next action is
the operator's live R4 against `afldb_test`: `validate-only`, then `dry-run`, then `apply`, with
each run's evidence recorded in §11a.2, and then R5. Live R4 is NOT RUN. L3–L5 stay blocked until
R5 passes. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: R4 validate-only FAILED, correctly. The 92 unresolved identities are
exactly the ISSUE-224 cohort, which the I18 rebuild dropped (§11a.2.1). This is not an R4 defect.
R4 is BLOCKED until the ISSUE-224 registration is restored on `afldb_test`. That restoration is
itself blocked because `afldb_test` has 0 `auth_users` rows and the registration tool needs an
actor, which requires an operator decision. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: the recovery attribution actor CLI is implemented and DB-free tested
(`npm run db:issue237:ensure-recovery-actor`, §11a.2.2). It is **NOT live-run**, so `afldb_test`
still has 0 `auth_users`. The next action is the operator's actor run (`--role super_admin`), then
the ISSUE-224 registration of the 92 with that `--admin-user-id`, then a fresh R4 validate-only.
R4 remains BLOCKED. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: R4 COMPLETE, R5 PASS (§11a.2.3). The remaining-gate reconciliation is in
§11a.3. The next actions are operator decisions:

1. **Update `docs/deployment.md` §6a** (S5).
2. **Re-run `tests/integration/settle-afl-api.test.ts`** on the post-R4 `afldb_test`.
3. **Decide L3.** Either resolve AFLDB-ISSUE-245 first and then run L3, or record an acceptance of
   L1/L2 + R1–R5 in its place. **Do not run L3 before one of these.**
4. **L4 and L5** at the next scheduled promotions.

2026 current-season restoration is ISSUE-224/228, not ISSUE-237. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: **L3 PASS** (§11a.6), and ISSUE-245 is RESOLVED. The next actions:

1. **The operator commit** of the ISSUE-237/245 work, then `merge:ready`, the merge, and the DEV
   checkout at that revision (§11d.1 prerequisite 1).
2. **Decide F-L4-1** (the G1 marker read). Recommended: a separately authorised one-word fix
   before L4.
3. **Decide F-L4-2/F-L4-3** (G2 ordering, candidate-phase G1). They block L4 only if DEV's
   `afl_api` ledger is non-empty (§11d.0, read at A4.1). By the same code they block L5 whenever
   production's ledger is non-empty, which is expected once ISSUE-235 adjudications exist there.
4. **L4** by §11d, only under a separate DEV authorisation. Then **L5** inside a scheduled
   production promotion.

Boundaries are unchanged: ISSUE-224/228 own the 2026 corpus; ISSUE-238 owns correction and
re-attribution; ISSUE-239 owns human adjudication recovery outside D15; ISSUE-240 owns
contradiction dedup; ISSUE-241 owns bridge artefact lineage hardening. ISSUE-237 is not
resolved.)*
*(Superseded 2026-09-25: F-L4-1..6 are fixed in code and DB-free validated (§11d.0, §11d.9), and
§11d is rewritten from the corrected implementation. Items 2 and 3 above are done, and L4 no
longer depends on DEV's ledger being empty. The next actions:

1. **The operator reviews and commits** the ISSUE-237/245 work, including this hardening. Then
   `merge:ready`, the merge, and the DEV checkout at that revision (§11d.2 prerequisite 1).
2. **L4** by §11d, only under a separate DEV authorisation.
3. **L5** inside a scheduled production promotion, by the same corrected gates
   (`docs/production-promotion.md` §5–§8).

Boundaries are unchanged. ISSUE-237 is not resolved.)*
*(Superseded 2026-09-25: the L4 semantic blockers are resolved in code and DB-free validated.
A4.2 is F-L4-8, A4.3 is F-L4-9, and the `--lineage-remap-out` artefact is F-L4-10 (§11d.0,
§11d.9). §11d now holds no operator decision beyond the L4 authorisation and DEV's live values,
and every contract breach is a STOP. Status: R1–R5 PASS; P-M PASS; L1 PASS; L2 PASS; L3 PASS;
ISSUE-245 RESOLVED; **L4 NOT RUN; L5 NOT RUN**. The next actions:

1. **The operator reviews and commits** the ISSUE-237/245 work, including F-L4-1..10. Then
   `merge:ready`, the merge, and the DEV checkout at that revision (§11d.2 prerequisite 1).
2. **L4** by §11d, only under a separate DEV authorisation. A4.2 and A4.3 are read first. If DEV
   holds a different-token registration of an `afldb_test` path, or an active 2026-keyed match
   override, L4 STOPs at A4 or B4 (§11d.8). The first case needs the proposed token-convergence
   follow-up.
3. **L5** inside a scheduled production promotion.

Boundaries are unchanged. ISSUE-237 is not resolved.)*
*(2026-09-25: the second real L4 attempt STOPPED at A4.3 (§11d.12). A3 PASS, A4.1 0/0, A4.2
92/92, A4.3 `matches` = 1: the orphaned, retained ISSUE-109 DEV fixture override. No A5, backup,
dump, candidate, plan or swap ran. **L4 remains NOT RUN.** The next action is AFLDB-ISSUE-246, then
L4 again from §11d A under its own authorisation. ISSUE-237 is not resolved.)*
*(2026-09-25: **AFLDB-ISSUE-246 is RESOLVED** on live DEV evidence (§11d.13). The retirement audit
is `auth_audit_log` 983, and the A4.3 rerun returned no rows, so **A4.3 is PASS**. A3 PASS, A4.1
0/0 and A4.2 92/92 are unchanged. No A5, promotion dump, candidate, plan or swap ran as part of
ISSUE-246. **L4 remains NOT RUN.** The next action is **L4 A5**, under a separate DEV
authorisation. ISSUE-237 is not resolved.)*
*(2026-09-25: **L4 A5 REFUSED on TWO independent gates** (§11d.14). The AFL API census itself
passed (669 importer, 0 human resolved, 0 ledger, 0 net-linked). **Blocker 1:** the ISSUE-151
staged-rows gate on `afl_api_identity_adjudications` 0 — EMPTY (beside `brownlow_vote_entry_state`
3 and `external_grid_sources` 1); the empty ledger is legitimate; prerequisite **AFLDB-ISSUE-247**
(committed `86e0e2ba`, `code_test_db` rehearsal PASS 7/7). **Blocker 2:** the test-fixture identity
gate on reserved-domain `auth_users` 14/17/18 and `admin_invites` 5, whose only FK references are 8
login/logout audit rows and 4 revoked sessions of user 18; prerequisite **AFLDB-ISSUE-248**
(committed `a4f734af`). Nothing past A5 ran. **L4 remains NOT RUN.** The next action is combined
ISSUE-247/248 deployment to DEV, ISSUE-248's live validate/apply/idempotence/postchecks,
ISSUE-247's live DEV empty-table/COPY-header proof, then A5 again with a fresh `$STAMP` under a
separate DEV authorisation. ISSUE-237 is not resolved.)*
*(2026-09-26: a post-merge L4 attempt at `397f422d` reached the post-swap phase and was ROLLED
BACK: the promoted candidate held first-kick-goal 0 against DEV's 335/334. This discovered
**AFLDB-ISSUE-249**. `afldb_dev` was restored; the failed candidate is retained as
`afldb_dev_candidate_20260926-033212`. The next action is the ISSUE-249 fix, then L4 again with a
fresh `$STAMP`. ISSUE-237 is not resolved.)*
*(2026-09-26: **L4 PASS** (operator-run, stamp `20260926-085511`), after AFLDB-ISSUE-249 was
deployed at `6ae70722` (§11d.15). Source gate PASS 334/334. G3's one classified hard loss,
`CD_I297354`, was resolved through the §6.3 DEV exception: a fresh §9 current-season
re-acquisition, a target-bound DEV bridge emitter (669/669 linked), and the loader's
validate-only → dry-run → apply, confirmed by a PASSing `dev-regeneration-census`. The post-swap
first-kick-goal special replay recreated the manual row exactly: census 335/334/1. **The DEV
promotion is accepted under the ISSUE-237 §6.3 contract. L4 is PASS.** **ISSUE-237 remains OPEN:
L5 PROD is NOT RUN.** The next action is L5, inside a future scheduled production promotion, under
production's unmodified G3 hard-loss rule (FAIL, no DEV-style exception).)*

---

## 15. Operator decisions (recorded 2026-09-24)

| OD | Question | Decision |
|---|---|---|
| OD-1 | A captured importer row that cannot resolve to exactly one accepted stable identity. | **APPROVED: fail closed.** Every captured importer-created `afl_api` row must resolve to exactly one accepted stable player identity before destruction (Stage 2) and again during replay (Stage 18, and the OD-4 recovery R3/R4). There is no withhold-and-continue mode and no later withhold flag (D7). |
| OD-2 | Human adjudication over an agreeing importer row. | **APPROVED.** It supersedes when, and only when, provider identity and stable player identity are identical. The only transition is `unique`/<approved importer `match_method`> → `resolved`/`afl_api_admin_adjudication`. A different-player mapping, player collision, ambiguity or unsupported method remains a hard failure (D9, §7.3). |
| OD-3 | Target importer coverage absent from the candidate. | **MODIFIED. No general WARN.** In production, a provider in the live target's importer set that is absent from the candidate is a **FAIL**. On DEV only, WARN + record is allowed, and only for explicitly classified `afl_api_stat_vector_season` identities that are intentionally regenerated after re-acquisition, with a mandatory post-re-acquisition verification census. Every other loss is FAIL (D14, §6.2, §6.3). |
| OD-4 | How to restore `afldb_test`'s importer coverage. | **Never** apply old bridge artefacts with bare `candidate_player_id` values. The I18 safety dump is the **candidate** authoritative pre-I18 backup. It is not authoritative until R1.1–R1.5 prove the exact SHA256, a successful isolated restore, exactly 802 importer rows, the exact method counts 3/129/397/273, and a passing stable-identity resolution and invariant check. Only then do R2–R5 proceed: export through stable identity (keeping `external_id` and the exact `match_method`), resolve against the current `afldb_test` through a fail-closed one-off path, and prove exact parity (§11a). With no authoritative state, destructive live validation stays blocked. DEV's 669 rows are never claimed to reproduce the former set. |
| OD-5 | A successor for the artefact/importer contract. | **APPROVED.** Allocated as **AFLDB-ISSUE-241** (next available ID, checked against the index 2026-09-24). Not implemented under ISSUE-237. |
| OD-6 (raised and approved 2026-09-24) | Should Stage 2 admit a rebuild capture whose importer/human supersede set is non-empty? That is a live `unique` importer row plus an effective `LINKED` ledger decision for the same provider/player, without its `resolved` row. | **APPROVED: keep the Stage 2 refusal.** ISSUE-235 creates the ledger decision and the `resolved` identity atomically, so the overlap is broken pre-existing state and the rebuild must not normalise it. Stage 2 keeps the bijection and disjointness checks and STOPs before destruction on a non-empty `E_rebuild`. `E_rebuild = ∅` is an invariant of every accepted capture, and Stage 18 re-checks it independently before mutation. Expected and actual rebuild supersedes are both `{}`, and anything else is a hard STOP and rollback. There is no supported rebuild carry path. **Promotion is not restricted:** `E_promotion = G2.AGREE` may be non-empty, and the post-swap replay must supersede exactly that set under the D9 conditions (D9 rebuild and promotion semantics). |
| OD-7 (raised and approved 2026-09-25, after the first R3 FAIL) | May a player holding two accepted AFL Tables paths resolve to one stable identity when the two are a reviewed fitzRoy renumbering fold? | **APPROVED, narrowly.** It applies only when there are exactly two paths, they are exactly one valid tracked `profile_url_continuity` rule's `{continuing_url, renumbered_url}`, and there is no third path. The identity is then `continuing_url`. Every other multi-path case stays ambiguous and refuses. There is no name matching, heuristic, lexicographic fallback or per-provider exception, and no identity row, importer or contract changes. Implemented once, in the shared classifier used by rebuild, recovery and promotion (§4 D7, §11a.1). |
