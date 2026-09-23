# AFLDB-ISSUE-228 — AFL.com.au official JSON APIs as the current-season match, stats and Brownlow source

> **CURRENT STATUS (2026-09-23, §22.22): RESOLVED / CLOSED — 2026-09-23.**
> Implementation and acceptance commit: `6eae820c` (branch `sonnet/issue-224-s9-unblock`; not
> merged, pushed or deployed by the resolution).
>
> ```text
> ISSUE-228: RESOLVED
> Resolved: 2026-09-23
> Commit: 6eae820c
>
> S9: PASS
> Assertion 9: PASS
> README gate: PASS
> §19 sweep: PASS
> ```
>
> No ISSUE-228 technical blocker remains. Successor work is owned by AFLDB-ISSUE-229 (fixture
> ingestion) and AFLDB-ISSUE-231 to AFLDB-ISSUE-235 (§22.21 A). AFLDB-ISSUE-230 (the `afldb_test`
> 2099 benchmark clock) is separate TEST hygiene and stays open. This record is stored at
> `issues/closed/AFLDB-ISSUE-228.md`. Every state block below, including the next one's "OPEN —
> awaiting operator commit" line, is retained as dated history.

> **STATE AT TECHNICAL ACCEPTANCE — 2026-09-23 (superseded by the RESOLVED block above; operator decision; supersedes every "S9 NOT accepted", "S9
> BLOCKED", "S9 acceptance is the operator's decision" and "Assertion 9 NOT PASSED / BLOCKED /
> SKIPPED" statement below, which are retained as dated lineage).**
> - **ISSUE-228 S9 — Brownlow completed-count acceptance: PASS** (operator-recorded 2026-09-23 on
>   `afldb_test`; acceptance record §22.16, evidence §22.13–§22.15).
> - **Assertion 9 (§9.9): PASS (2026-09-23, closeout option b; §22.18).** The genuine 10:29 and
>   21:41 captures were hash-verified against the tracked manifest in both surviving locations. The
>   harness was fixed to compare the named pair. The pair is canonically unchanged with no
>   exclusions: match 1/1, match_roster 1/1, player_match_stats 46/46 records. It was proven
>   separately from S9; nothing in S9 was used to close it.
> - **README AFL API documentation gate (§22.18 E item 7): PASS** (operator-accepted 2026-09-23;
>   §22.19).
> - **ISSUE-228 technical acceptance: COMPLETE (closeout review 2026-09-23, §22.20).** Every
>   §22.18 E residual is classified there with repository evidence; none is a blocking technical
>   gate. The DB-free §19 sweep passed. **No technical blocker remains.**
> - **Successors allocated (closure preparation 2026-09-23, §22.21).** Every non-blocking residual
>   now has an owner: AFLDB-ISSUE-229 (fixture ingestion), AFLDB-ISSUE-231 (retired-identity rekey
>   and match-family absence sweep), AFLDB-ISSUE-232 (timers, Brownlow wrapper
>   `--use-fixture-identity` decision, match-before-Brownlow ordering, admin unit status, automatic
>   revalidation), AFLDB-ISSUE-233 (season discovery and rollover, replacing ISSUE-101/F),
>   AFLDB-ISSUE-234 (optional feeds), AFLDB-ISSUE-235 (`afl_api` player-link adjudication).
> - **ISSUE-228 overall: OPEN — technical acceptance complete; awaiting operator commit.** Then
>   resolution bookkeeping: move this runbook to `issues/closed/`, remove the index and Open Issues
>   rows, and mark the CHANGELOG entry Resolved.
> - AFLDB-ISSUE-230 (the `afldb_test` 2099 benchmark clock) is a separate LOW test-hygiene issue and
>   does not affect the S9 acceptance.

> **RECONCILED CURRENT STATE — 2026-09-22 (supersedes every stale S9 statement below).**
> Every "S9 NOT STARTED", "S9 paused before any real-feed acquisition" and "S9 still stopped before any
> DB dry-run" statement further down this document is a **dated historical snapshot**, retained as
> lineage and superseded. Full record: `issues.md` "S9 — RECORD RECONCILIATION, ROUTE A, Q5-B (2026-09-22)".
>
> - **ACCEPTANCE SNAPSHOT — decision D-9b RESOLVED 2026-09-22, option B (see §20).**
>   `afl-api-2026-2026-09-21-011148` is **formally SUPERSEDED**: its bytes are absent from every local
>   root. The authoritative S9 acceptance snapshot is now the retained, immutable, hash-verified
>   **`afl-api-2026-2026-09-21-031725`** (manifest sha256 `5018a3d6…`, 652/652 files byte-exact).
>   `-011148` is retained as lineage and must not be rewritten, but **no acceptance claim may depend
>   on its bytes**. Consequence: the accepted bridge must be **rebuilt as one coherent population —
>   all 669 providers re-resolved — against `-031725`**; the **577** links already imported to DEV are
>   **lineage, NOT acceptance evidence**, and must not be mixed with the 92 that ISSUE-224
>   registration will resolve (§20.5.1). Every `-011148` reference below this line is historical.
> - **S9: IMPLEMENTED / NOT ACCEPTED — PARTIALLY EXECUTED.** A real 2026 acquisition occurred
>   (snapshot `afl-api-2026-2026-09-21-011148` — **superseded per §20**; manifest sha256 `dcbd0626…`,
>   217 concluded matches, 9,983 player-match rows, 0 bundle build failures; the later acquisition
>   `afl-api-2026-2026-09-21-031725` is now the authoritative snapshot). A full-season player bridge
>   artefact was built and its 577 links imported to DEV. A full DEV settle **DRY-RUN** followed and was
>   **INCOMPLETE**: `unresolvedIdentityMatch 0`, `unresolvedIdentityPlayer 830`. **No committed
>   canonical `afl_api` apply, no S9 DEV smoke, no timer installation/enablement has occurred.
>   S9 is NOT accepted.** That dry-run predates the ISSUE-244 hardening and is **not** current
>   acceptance evidence; all committed S9 acceptance work must run on the post-ISSUE-244 lineage.
> - **ISSUE-244 is RESOLVED / CLOSED** (main `7f242ecc`; `sonnet/issue-228-s9` starts from it). It
>   returned to this issue: S9 operational acceptance (open); Q5 (now decided, below);
>   ISSUE-224 registration/linkage as the prerequisite of the full `--require-complete-source` path;
>   and the fact that closing ISSUE-244 does **not** make the timer operational (F004 refuses an
>   incomplete source before commit; timer installation/enablement is separately authorised work).
> - **S9 completeness path — ROUTE A (operator decision 2026-09-22).** ISSUE-224 registration/linkage
>   must be completed enough that the **authoritative immutable snapshot — `-031725` per D-9b/§20**
>   settles with `unresolvedIdentityPlayer = 0` and passes the F004 completeness gate. "Same
>   snapshot" means *one* snapshot throughout acquisition, bridge and settle, not specifically
>   `-011148`, whose bytes are gone. **A partial-player canonical
>   apply by removing `--require-complete-source` is REJECTED FOR S9 ACCEPTANCE**: F004 makes source
>   completeness a pre-commit gate and S9 must exercise the production-intended guarded path. The
>   technical ability to run without the flag is unchanged and remains documented; it is simply not the
>   selected S9 route.
> - **Q5 (§15 item 5) — RESOLVED, Q5-B selected 2026-09-22:** canonical `afl_api` `match_time` is
>   venue-local **`HH:MM`**; `NULL` still means "not published / unavailable"; the §11.1 agreement /
>   contradiction check still compares the underlying timestamps at **second** precision; `match_time`
>   stays NON-IDENTITY; no AFL Tables rewrite, no schema/type migration, no `afl_api` canonical
>   remediation needed (ISSUE-244 F031 census: 0 `afl_api`-owned matches). Implemented in
>   `src/lib/acquisition/afl-api-bundle.ts` (`deriveAflApiLocalMatchDateTime()`); DB-free validation
>   recorded in `issues.md`.
> - **DEV deployed SHA is UNMEASURED.** `bbf87566`, `27d7e5aa` and `4e67ce38` in this document are
>   historical evidence of the deploy each one actually represented, not a statement of what DEV runs
>   now. The exact DEV deployed SHA must be measured in the next read-only S9 preflight and must equal
>   the commit selected for acceptance before any write/apply phase. DEV is **not** claimed to run
>   `7f242ecc`.
> - **Next S9 prerequisite:** ISSUE-224 registers the missing canonical player rows for the 92
>   unresolved AFL API providers → the AFL API bridge is rebuilt/re-resolved against the same
>   immutable snapshot → only then the read-only S9 preflight and re-settle.
> - **Addendum 2026-09-23 — see §22 below.** The ISSUE-224 registration/bridge-rebuild prerequisite
>   above is now independently confirmed complete. An operator-reported canonical `afl_api` apply
>   and identical-snapshot idempotence replay against `afldb_dev` followed. **S9 is still NOT
>   accepted** — Brownlow replay/Assertion 9 and the DEV smoke check remain outstanding.
> - **Addendum 2026-09-23 (later same day) — DEV smoke now PASS, see §22.9.** Operator executed
>   the §22.8 "reading 2" minimum remediation: DEV `.env` given a temporary, byte-backed
>   `AFLDB_REVALIDATE_URL`/`AFLDB_REVALIDATE_SECRET` acceptance window, `afldb.service` restarted,
>   all four workers independently proven to accept an authenticated loopback
>   `/api/internal/revalidate-season` call, then an authenticated fresh `/seasons/2026` GET
>   confirmed the batch-111 canonical Preliminary Final rows render, then the original `.env` was
>   restored byte-identically (SHA-verified) and the service restarted again, restoring the fail-
>   closed 503 posture. §18 item 8 is satisfied under reading 2; no code change was made; the
>   acceptance secret no longer exists anywhere. **S9 is still NOT accepted** — Brownlow replay /
>   Assertion 9 (§9.9) remains the sole outstanding S9 gate; see §22.9-§22.10 for the full record
>   and the Assertion 9 investigation.
> - **Addendum 2026-09-23 (later same day) — operator contract clarification + completed-tracker
>   acquisition proof, see §22.11.** "Brownlow replay" (Requirement 1) never required observing the
>   live ceremony; the operator-confirmed acceptance objective is obtaining the **official completed**
>   tracker, resolving/validating it, and replaying it safely and idempotently into `afldb_test`.
>   The real 2026 Brownlow tracker was fetched this pass (network acquisition explicitly
>   operator-authorised) and reports **`status: CONCLUDED`** on both feeds — 207 matches, 621
>   vote-allocation rows, 1,242 total votes, 0 invalid sums, 0 duplicate positions, leaderboard
>   reconciles exactly, winner Nick Daicos (47 votes). The acquisition/settle pipeline has no
>   liveness dependency in code (confirmed by reading it) and needs no change. **Requirement 1 is
>   now blocked only on execution, not on source availability**: no DB tunnel was reachable from
>   this workstation this pass, so the super-admin Brownlow ingestion toggle could not be read and
>   no dry-run/apply/replay was attempted. **Requirement 2 (Assertion 9) is unaffected by this
>   clarification and remains separately blocked** per §22.10. **S9 is still NOT accepted.**
> - **Addendum 2026-09-23 (latest) — §22.12.** The Brownlow apply to `afldb_test` (batch 2418) left
>   27 vote sets refused over **23** unlinked providers. A missing full-season `afldb_test`-native
>   bridge emitter was implemented, tested and run read-only: 577 linked, 0 contradictory, and
>   accepted by the importer. It resolves **15 of 23**. The other 8 are ISSUE-224 registrants with
>   **no 2026 `player_match_stats` in `afldb_test`**. The run stopped before any `afldb_test` write,
>   and an operator decision is pending (§22.12 H).

**Status:** Open — PLAN, amended 2026-09-19 with operator decisions Q1/Q2/Q7 and four
tightening points (§0.1, §19). This document is the frozen implementation contract for S0–S10;
**current per-stage execution status is tracked in `issues.md` (AFLDB-ISSUE-228), not here.**
As of 2026-09-20: S1–S5 implemented and operator-validated; S6's core operational settle path is
implemented and operator-validated (per operator evidence: `tsc --noEmit` clean,
`settle-afl-api.test.ts` 5/5, `current-season-import.test.ts` 258/4-skipped,
`settle-afltables.test.ts` unregressed at 64/1-expected-skip); two S6 gaps remain deliberately
open (the ISSUE-131 rekey search for `afl_api`; the `match`-family absence sweep). S7 (Brownlow,
§10) is implemented but UNEXECUTED — no test/tsc/DB/Git/deployment command has been run by the
assistant for S7 (CLAUDE.md §9); pending operator validation against the local Brownlow simulator
first, then `afldb_test`. As of 2026-09-20 (later same day), the §16 S7 deliverable row's
completed-season artefact builder (`tools/migration/build_brownlow_season_artefact_from_afl_api.py`)
is also implemented, likewise UNEXECUTED — see `issues.md` "S7 completed-season Brownlow
season-artefact builder" for detail. The `staging.afl_api_brownlow_vote` typed-projection gap
remains open and out of scope for that pass. As of 2026-09-21: **§9.10 historical Brownlow
equality (2022–2025) is operator-proven CLOSED / PASS** (see `issues.md` "§9.10 — HISTORICAL
CLOSEOUT" paragraph) — every season's vote sets, positive vote rows, provider identities and
exact canonical equality now reconcile with every mismatch/failure counter at 0; the historical
fixture-observation prerequisite is likewise satisfied for 2022–2024. **S7 itself remains
OPEN** — the separate real live-count capture/replay requirement has not occurred; the 2026 count
is imminent. Assertion 9 (§9.9) remains SKIPPED (documented, not a silent pass) and is a distinct,
still-open ISSUE-228 closeout item. **S7 is still not complete.** As of 2026-09-21: **S8
(operations) is implemented, UNEXECUTED and NOT installed/enabled** — package scripts, the
`deploy/afldb-settle-afl-api*`/`-brownlow*` unit/timer/script files, a read-only `settle-status.ts`/
`settle-trigger.ts` three-unit table, the `AFLDB-2026-API-ACQUISITION.md` §5/§0 rollover-doctrine
correction (Q7), `.env.example`/`docs/deployment.md` variable documentation, and a new manual
Brownlow live-count operator runbook — see `issues.md` "S8 operations implementation" for the full
record, including the disclosed discrepancies against the original §17 sketch (`emit:afl-api`'s
real scope, `bridge:afl-api` deliberately not added, no admin on-demand trigger for the two new
units). S9–S10 not started *[2026-09-20/21 snapshot — S9 superseded, see the reconciled block at the top]*. S5 (§6.3, this document) was operator-executed and
validated on `afldb_test` only (contract test, builder `--validate-only`/`--write`, importer
`--validate-only`/`--dry-run`/`--apply`, post-apply idempotency dry-run) — see `issues.md` for the
full evidence record. No database, Git, network or deployment command has been run by the
assistant in any pass (CLAUDE.md §9); every DB-touching step recorded as "validated" above was
executed by the operator.

**As of 2026-09-21 (later same day): S8 (operations) is operator-validated COMPLETE.** Per
operator-supplied evidence (no test/tsc/DB/Git/network/deployment command run by the assistant,
CLAUDE.md §9): `npx tsc --noEmit` PASS; `tests/admin-current-season-settle.test.ts` 38/38 PASS;
`sh -n deploy/afldb-settle-afl-api.sh` and `sh -n deploy/afldb-settle-afl-api-brownlow.sh` both
PASS; a systemd safety inspection of the new units found no `afldb_test`/`afldb_dev`/prod
database, local-tunnel or simulator URL hard-coded. The same inspection of the manual Brownlow
live-count operator runbook originally found its write-target guard checked the wrong
environment variables; that blocker is now fixed — `AFLDB_IMPORT_DATABASE_URL` is bound
process-locally from `AFLDB_TEST_IMPORT_DATABASE_URL` and independently re-verified by
`SELECT current_database() = 'afldb_test'` before any write; real-feed/simulator overrides are
explicitly cleared and positively checked; the 2026 `staging.afl_api_match` prerequisite is
explicitly documented in the runbook. **No DEV or PROD deployment has occurred.** **S1–S6 are
COMPLETE. S7 remains OPEN** — the sole remaining acceptance item is the real 2026 live-count
capture/replay evidence (do not mark S7 complete before that event evidence exists). **S9 is
NOT STARTED** *[historical, 2026-09-21 morning — superseded: S9 is IMPLEMENTED / NOT ACCEPTED —
PARTIALLY EXECUTED, see the reconciled block at the top]*, requiring a later DEV dry-run/apply, AFL
Tables corroboration and Brownlow replay after the S7/S8 prerequisites. **Assertion 9 (§9.9) stays explicitly separate from the Brownlow
live-count replay and remains SKIPPED/open** — only one formal monitor-capture pair
(`CD_M20260142801`) exists; it is not PASS and is not closed by tonight's Brownlow snapshots; it
must be explicitly dispositioned before final ISSUE-228 closeout (see `issues.md` "§9.10 —
HISTORICAL CLOSEOUT" for the full Assertion 9 disposition options). Full evidence and file list:
`issues.md` "S8 operator-validated" paragraph.

**As of 2026-09-21 (later same day): merged to main and deployed to DEV** (commit `bbf87566` — the
HISTORICAL merge deploy of migration 103; the admin ingestion control was added after it; not a
statement of what DEV runs now). During DEV acceptance the operator found no super-admin UI control existed to
enable/disable AFL API current-season or Brownlow ingestion, and **paused S9 before any real-feed
acquisition** pending one *[historical — the real-feed acquisition subsequently occurred; see the
reconciled block at the top]*. Super-admin-controlled, fail-closed, server-side-enforced ingestion switches were
added this pass — see `issues.md` "operational-control gap found during DEV acceptance" paragraph
for the full architecture and file list. **This does not change S7 (still OPEN), S9 (still NOT
STARTED — the control exists but neither switch was enabled and S9 has not resumed *[historical
2026-09-21 statement, superseded]*) or Assertion 9 (still SKIPPED/open).**

## 0.1 Operator decisions recorded 2026-09-19 (binding on every stage below)

| Decision | Ruling | Where applied |
|---|---|---|
| **Q1 ownership** | **APPROVED: co-source corroboration.** Existing 2026 canonical rows stay `afltables`-owned; `afl_api` corroborates them. A row first promoted from `afl_api` is naturally `afl_api`-owned. No row is ever re-owned merely because another source now corroborates it. | §7.5, S6, §19.1 |
| **Q2 attendance** | **APPROVED: AFL Tables as optional, field-scoped attendance enrichment** on `afl_api`-owned matches. Missing attendance never blocks match promotion. Reviewed/manual Super Admin attendance is never overwritten by automated enrichment. **Clarified:** the gate keys on `matches.attendance_source_id IS NULL` (an unsourced field), never on match completion; a CONCLUDED, fully settled match stays eligible. | §7.5, §8 gate 12, §19.2 |
| **Q7 rollover** | **APPROVED: rollover re-acquisition corroborates, never re-owns.** The completed-season fitzRoy/AFL Tables full-history re-acquisition corroborates independently sourced canonical data; any ownership transfer requires an explicit rule or operator decision, never "the rollover ran later". | §14 R7, S10, §19.3 |
| **T1 player bridge** | Stat-vector bridge is a **bootstrap/backfill mechanism only**; it must yield durable trusted `afl_api` `external_identities`; normal ingestion must resolve bridged players **without AFL Tables present**; unresolved/new players are never guessed and stay unresolved/HALT, with debutant gaps continuing through ISSUE-224. | §6.3, S5, §19.4 |
| **T2 semantic hashing** | raw immutable payload → parse → canonical JSON → semantic hash. **No exclusion list on assumption**; every exclusion needs repeated evidence, documentation and a fixture/regression test. | §4.5, §5.2, §9.9, §19.5 |
| **T3 POSTGAME** | POSTGAME is valid source data that is not yet eligible for completed-match promotion: represent it as **observed/deferred**, not rejected, and never report a normal POSTGAME → CONCLUDED lifecycle as a failed run followed by success. | §7.3, S6, §19.6 |
| **T4 round mapping** | One centralised, per-season, tested translation contract; no scattered `roundNumber + 1`; explicit HALT for uncovered season/round combinations. | §2.1, §5.2, §6.4, §19.7 |

---

## 0. Summary of the recommendation

1. AFL.com.au is **not a new source**. It is the existing `afl_api` source (registered by
   migration 077, independence group `afl_api`, shared `CD_` identity namespace already proven
   by ISSUE-100 P3/P4). ISSUE-228 adds **five new families** to that source and a direct-HTTP
   adapter beside the existing fitzRoy-based `lineup` / `roster` adapters.
2. The pipeline is the existing ISSUE-096/099/122 one, **generalised over the source**, not a
   parallel importer: acquisition snapshot + hash-bound manifest → offline bundle emitter →
   `staging.source_*` spine (074) → typed projection (new migration) → `reconcile()` →
   `promotion_candidates` → `applyCanonicalUnit()` under gates E1–E6 → `canonical_applications`.
   The only existing canonical writer is the automatic path (`canonical-apply.ts`); the
   reviewed human accept path is still `canonical_write_unimplemented`
   (`promotion-review.ts:719`). The plan does not change that fact.
3. **Provider IDs are identity everywhere**: `CD_M…` is `external_record_id` for the match
   family *and* `matches.source_record_id` (migration 064 column, currently unused by any
   writer) *and*, later, `fixtures.source_record_id` (migration 097 already reserves that
   column for "a FUTURE fixture importer … with the provider's id"). Players resolve through a
   new `external_identities` bridge (`afl_api` / `CD_I…`), never by name.
4. **POSTGAME is observed, never promoted.** Only a `CONCLUDED` fixture status with a
   `CONCLUDED` roster status reaches projection and promotion. Corrections after CONCLUDED
   flow as ordinary `corrected` versions (I2 history is kept by the spine).
5. **Attendance is not sourced** by AFL.com.au. The match proposal carries
   `attendance = NULL` with the non-complete status; AFL Tables (or Super Admin) may enrich
   it later through a narrow, explicitly declared **field-group enrichment** on the
   `attendance` group only, which is already per-field-owned via `matches.attendance_source_id`
   (migration 020).
6. **Brownlow** reuses the same spine and provenance but is a separate stage with separate
   families, its own validator and its own promotion component; it targets
   `brownlow_round_votes` (an existing settle target) and produces an artefact for the
   ISSUE-113 `brownlow_season_votes` loader at rollover. It never rides on the match/stat
   promotion.
7. **Fixture ingestion** is a **successor issue** (recommended `AFLDB-ISSUE-229`), but four
   decisions are taken **now** so it needs no redesign (§13).

The hard dependency that gates any live promotion: **the player-identity bridge (§6)**.
Without it every `player_match_stats` proposal is `unresolved_identity` and the match family
would settle alone. The bridge is deterministic, backtestable and reviewed; it is Stage S5.

---

## 1. Repository findings (exact locations)

### 1.1 Issue tracking
- No `AFLDB-ISSUE-228` existed anywhere in the repository before this pass (`issues.md`,
  `IssuesIndex.md`, `issues/`, Git history). `issues.md` line 37574 records 226 as the last
  allocated ID and 227 as unallocated; 228 is allocated by this document, leaving 227 free.
- Conventions: `issues.md` (authoritative), Open Issues table at its head, `IssuesIndex.md`
  (open only), runbooks in `issues/open/<ID>.md` (CLAUDE.md §5).

### 1.2 The current-season architecture (ISSUE-096 → 099 → 100 → 122 → 128 → 131)
| Component | Location | Role |
|---|---|---|
| Source-family registry | `data/reference/source-families.json` + `src/lib/acquisition/source-families.ts` | Declares per `(source_key, family)`: external key, required/known columns, hash exclusions, `source_updated_at_field`, round vocabulary, independence group, `promotion_policy`. Validator refuses promotion for an unregistered source. |
| Observation spine | `src/db/migrations/074_source_observation_spine.sql`; `src/lib/acquisition/observations.ts`, `observation-store.ts` | `staging.source_payloads` (content-addressed, immutable), `staging.source_record_versions` (ordered A→B→A history, `version_seq`), `staging.source_records` (head + `absent_since`). `persistSourceObservation()`, `markMissingObservationsAbsent()`, `hashPayload()`/`canonicalJson()`. |
| Typed projections | `076_afltables_settle_projections.sql` (`staging.afltables_match`, `staging.afltables_player_match`); `077_afl_api_lineups.sql` (`staging.afl_api_lineup`) | ISSUE-096 Decision B: "the jsonb spine never feeds a promotion; a family with no typed projection cannot be promoted." |
| Reconciliation | `src/lib/acquisition/reconciliation.ts` | Verbs `new / corrected / rescheduled / absent / unresolved_identity / source_disagreement / foreign_owned_collision / manual_authority_conflict / stale_review`; `classifyCorroboration()`, `diffFields()`, `evaluateTargetOwnership()`. |
| Promotion ledger | 074 `promotion_candidates` (CHECK: only `new/corrected/rescheduled` may be accepted), `promotion_decisions` (append-only) | Human review record. |
| Automatic canonical path | `083_canonical_auto_apply.sql` (`canonical_applications`, provenance quartet on `match_period_scores`/`brownlow_round_votes`, `player_match_stats.source_record_id`); `src/lib/acquisition/canonical-apply.ts` (`applyCanonicalUnit`, `autoApplyOwnership`, gates E1–E6 re-read inside a savepoint) | The **only** canonical writer. `canonical_applications_target_table_ck` admits exactly `matches, match_period_scores, player_match_stats, brownlow_round_votes`. Takes `sourceKey` as a parameter — source-neutral by construction. |
| Settle orchestration | `src/lib/acquisition/settle-afltables.ts` (3,450 lines) | Bundle validation (`validateSettleBundle`), `loadRefs()` (clubs by `legacy_club_hist`, venues by `legacy_name`, players by `external_identities` where `match_method = 'afltables_profile_url'`, matches by `match_key`), `resolveTarget()` (match_key lookup + ISSUE-131 rekey), `settleFamily()`, disagreement `data_issues` lifecycle, derived recompute. **Hard-bound to AFL Tables** at: `SETTLE_SOURCE_KEY = 'afltables'` (:108), `BUNDLE_FAMILIES` (:121), `SETTLE_ACQUISITION_KIND = 'in_season_partial'` (:113), the `import_batches.tool` literal `'settle-afltables.ts'` (:1892), `fitzroy_version` in the bundle (:862), and the projection writers (`writeMatchProjection`, `writePlayerMatchProjection` → the two 076 tables). |
| Manual authority | `src/lib/acquisition/manual-authority.ts`, `073_data_overrides.sql`, `src/lib/edit/spec.ts` (`matches` groups: `attendance`, `score`) | `data_overrides` is the only authority record; settle targets other than `matches`/`fixtures` are proven unrepresentable there. Source-neutral. |
| Completeness / status / trigger | `source-completeness.ts` (ISSUE-128), `settle-status.ts` + `settle-trigger.ts` (ISSUE-127, one hard-coded unit `afldb-settle-afltables.service`), `season-revalidation.ts` (ISSUE-134 ISR publish) | Status surfaces are single-unit today. |
| CLI + chain | `tools/current-season/settle-afltables.ts` (`--label --dry-run/--apply --auto-apply --report --require-complete-source`), `deploy/afldb-settle-afltables.sh` (acquire R → `import_fitzroy_core.py --emit-observations` → settle), `.service`/`.timer` (04:30 nightly, `Persistent=true`) | Snapshot under `data/sources/afltables/fitzroy_core/<label>/`, manifest under `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`, manifest written LAST, re-hashed before any DB contact. |
| Bundle contract | `settle-afltables.ts:585-631` (`SettleBundle`), Python emitter `tools/migration/import_fitzroy_core.py` (§ "observation-bundle emission", `match_key_of()` :1880), `tests/python/settle_emit_contract.py` | `bundle_contract_version 1`; records `{family, scope_key, external_record_id, payload, observed_columns, projection|null, rejection|null}`; `enumerations[{family, scope_key, complete, external_record_ids}]`; `unkeyed_rejections`; `counts`. |
| Existing `afl_api` adapters | `tools/rebuild/afl_api/afl-api-contract.json`, `acquire_lineups.R` (fitzRoy `fetch_lineup_afl`), `emit_lineup_bundle.ts` → `src/lib/acquisition/lineup-bundle.ts`, `persist_lineups.ts` → `lineup-store.ts`; `acquire_rosters.R` + `tools/migration/enrich_heights_afl_api.py` (rosters 2012–2026, manifest `docs/rebuild-manifests/afl_api/rosters-20260905.json`) | Staging-only lineups (promotion `never`); rosters are height corroboration only. **No direct-HTTP AFL API code, no `WMCTok`/`x-media-mis-token`, no CFS/SAPI URL exists anywhere in the repository.** |
| Retired current-season path | `src/lib/external-afl/current-matches.ts` (Squiggle/Kali), `063_external_current_match_sources.sql`, `tools/current-season/update-current-season.ts` | `--update-matches` / `--insert-missing-matches` hard-refused since ISSUE-122; staging/diagnostic only. |

### 1.3 Canonical schemas that matter
- `matches` (003 + 020 + 064 + 084/085): `match_key = season|round_code|match_date|home hist|away hist` UNIQUE; `round_type` enum incl. `wildcard_final`; `round_number` NULL for finals; scores/result/margin NOT NULL; `attendance` NULL = not recorded, `attendance_status coverage_status NOT NULL`, `attendance_source_id`; `scheduled_at timestamptz` (no reader or writer since 003); provenance quartet `source_id, source_record_id, import_batch_id, imported_at` (064).
- `match_period_scores` (003): **cumulative-to-date** per club per period; provenance quartet (083).
- `player_match_stats` (004 + 083): 21 nullable stat columns + `career_game_no`, `jumper_number text`, `brownlow_votes`; `UNIQUE (player_id, match_id)`; `source_id`, `import_batch_id`, `source_record_id`.
- `external_identities` (002): `UNIQUE (source_id, external_id)`, `status link_status`, `match_method`. Today only `afltables` / `afltables_profile_url` links exist (`settle-afltables.ts:1685-1692`); migration 077 comment: "No afl_api identity exists in external_identities and no approved deterministic bridge populates one."
- `brownlow_round_votes` (005 + 083): `UNIQUE (season, player_id, round_number)`, `played`, `votes 0–3`; canonical `round_number` is AFL Tables numbering (Opening Round = 1 from 2024).
- `brownlow_season_votes` (005): authoritative totals; sole writer `tools/migration/import_brownlow_season.py` from the tracked artefact `data/brownlow/season-votes.csv`; refuses `in_progress` seasons; `stat-availability.json` marks all three Brownlow grains `pending` for 2026.
- `fixtures` (097, ISSUE-162): scheduled-match registry, `fixture_key` UUID identity, `UNIQUE (source_id, source_record_id)`, status `scheduled|cancelled|void`, no score columns, read-time "played" resolution via `(season, round_code, home, away)`, `isFixtureEditAllowed()` locks played fixtures. Written today only by `src/db/queries/admin-fixtures.ts` under `manual_admin_edit`.
- Not stored anywhere: umpires, weather, milestones, club debuts, time-on-ground, metres gained, extended Champion Data statistics. `player_achievements` (053) holds only `first_kick_goal`.
- Manual paths: `src/db/queries/match-admin.ts` `createMatch()` (writes no provenance; renders `round_code` decimal/EF..GF), `match-sheet.ts` (no provenance columns written), CSV/email `matchResults.promoteRow()` (stamps provenance since ISSUE-185).

### 1.4 `data/sources` tracking
`.gitignore:120-135`: everything under `data/sources/` is ignored except
`data/sources/afltables/coaches/*/parsed/`. The sample tree `data/sources/AFLWebsite/…` is
therefore **untracked local evidence**, as intended. The repository convention for raw
acquisitions is: bytes untracked, **manifest tracked** under `docs/rebuild-manifests/<source>/`
and hash-bound (`fitzroy-accepted-baselines.json`, `afl-api-contract.json` `accepted_snapshot`).

### 1.5 Code that assumes AFL Tables is the only current-season source
- `settle-afltables.ts` (constants listed in §1.2), `deploy/afldb-settle-afltables.sh`,
  `settle-status.ts`/`settle-trigger.ts` (one unit), `source-completeness.ts` counters named
  for the settle bundle.
- `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5 rollover row: "re-acquire the completed
  season through the standard full-history fitzRoy path … supersede in-season provenance" —
  incompatible with `afl_api`-owned rows unless amended (§14 R7).
- `tools/db/rebuild-test.ts:1255` `matches_after_accepted_last_season = 0` — unaffected
  (in-season rows are never in the historical core).
- `import_brownlow_season.py` `SOURCE_KEY` fixed to `afltables` (operator decision 2026-09-04).

---

## 2. What the captured payloads actually say

All raw files are single-line JSON; findings below were extracted with anchored searches.

### 2.1 Season matches feed (`aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=<id>&pageSize=1000`)
- Envelope `{meta, pagination{numEntries}, matches[]}`; 2026 = 218 entries, 2025/2024/2023 = 216, 2022 = 207.
- Match object: `id`, **`providerId` (`CD_M…`)**, `compSeason{id, providerId CD_S…}`,
  `round{id, providerId CD_R…, abbreviation, name, roundNumber, byes[], utcStartTime, utcEndTime}`,
  `home/away{team{id, providerId CD_T…, name, abbreviation, nickname, club{providerId CD_O…}}, score{goals, behinds, totalScore, superGoals}}`,
  `venue{providerId CD_V…, name, timezone, state, landOwner}`, `utcStartTime`, **`status`**,
  `metadata{finals_match_label, ticket_link}`.
- **Round vocabulary (2026):** `OR`/"Opening Round" = **0**, "Round N" = N (1..24), `WF`
  "Wildcard Finals" = 25, `QE` "Qualifying & Elimination Finals" = 26, `SF` = 27, `PF` = 28,
  `GF` = 29. AFL Tables (and therefore AFLDB `round_number`) numbers the Opening Round **1**,
  so **canonical H&A round = AFL `roundNumber` + 1 for seasons that have an Opening Round**
  (2024, 2025, 2026 feeds contain one; 2022, 2023 do not → offset 0). `QE` cannot be split
  into `QF`/`EF` from the round object; **`metadata.finals_match_label`** ("First Qualifying
  Final", "Second Elimination Final", …) does it for 2026 and 2024 was checked and carries **no**
  label — a backtest limitation (§9.4). **Translation is never an inline `+ 1`**: it is the
  declared per-season contract in §6.4, and only that.
- Observed `status` values: `CONCLUDED` only (feed captured after the season's last H&A round),
  plus `POSTGAME` reported by the operator's monitor. Pre-match values (`SCHEDULED`, `LIVE`, …)
  are **unobserved** and must be measured, never assumed (§15 Q4).
- Team identities (18): `CD_T10` Adelaide Crows, `CD_T20` Brisbane Lions, `CD_T30` Carlton,
  `CD_T40` Collingwood, `CD_T50` Essendon, `CD_T60` Fremantle, `CD_T70` Geelong Cats, `CD_T80`
  Hawthorn, `CD_T90` Melbourne, `CD_T100` North Melbourne, `CD_T110` Port Adelaide, `CD_T120`
  Richmond, `CD_T130` St Kilda, `CD_T140` Western Bulldogs, `CD_T150` West Coast Eagles,
  `CD_T160` Sydney Swans, `CD_T1000` Gold Coast SUNS, `CD_T1010` GWS GIANTS. Six names differ
  from `clubs.legacy_club_hist` — names are never the key.
- Venues carry `CD_V` ids with AFL commercial names (`Marvel Stadium`, `People First Stadium`,
  `ENGIE Stadium`, `Optus Stadium`, `Barossa Park`, …); AFLDB `venues.legacy_name` uses AFL
  Tables spellings (`M.C.G.`, `S.C.G.` …) — a tracked map is required.

### 2.2 Player stats (`api.afl.com.au/cfs/afl/playerStats/match/<CD_M>`)
- `homeTeamPlayerStats[]` / `awayTeamPlayerStats[]`, 23 rows each, 46 per match (verified for
  all 14 samples: every file carries exactly one `homeTeamPlayerStats` key and the CSV summaries
  show 46 rows). Row: `player{player{position, player{playerId CD_I…, playerName{givenName,
  surname}, captain, playerJumperNumber}, jumperNumber, photoURL}}`, `teamId`,
  `playerStats{stats{…}, extendedStats{…}, lastUpdated}`, `gamesPlayed` (**null in every
  sampled row, 2022–2026**), `timeOnGroundPercentage`.
- `stats` keys: goals, behinds, superGoals, kicks, handballs, disposals, marks, bounces,
  tackles, contestedPossessions, uncontestedPossessions, totalPossessions, inside50s,
  marksInside50, contestedMarks, hitouts, onePercenters, disposalEfficiency, clangers, freesFor,
  freesAgainst, dreamTeamPoints, clearances{centreClearances, stoppageClearances,
  totalClearances}, rebound50s, goalAssists, goalAccuracy, ratingPoints, ranking, lastUpdated,
  turnovers, intercepts, tacklesInside50, shotsAtGoal, goalEfficiency, shotEfficiency,
  interchangeCounts, scoreInvolvements, metresGained. `extendedStats`: effectiveKicks,
  kickEfficiency, kickToHandballRatio, effectiveDisposals, marksOnLead, interceptMarks,
  contestedPossessionRate, hitoutsToAdvantage, hitoutWinPercentage, hitoutToAdvantageRate,
  groundBallGets, f50GroundBallGets, scoreLaunches, pressureActs, defHalfPressureActs, spoils,
  ruckContests, contestDefOneOnOnes, contestDefLosses, contestDefLossPercentage,
  contestOffOneOnOnes, contestOffWins, contestOffWinsPercentage, centreBounceAttendances,
  kickins, kickinsPlayon.
- **Schema stability:** the first 130 keys of the 2022 R8 sample and the 2026 PF sample are
  identical in name and order. All counts are floats (`9.0`); integrality must be enforced.
- `position` in stats rows includes `INT`; `EMERG` appears only in the roster.

### 2.3 Match roster (`api.afl.com.au/cfs/afl/matchRoster/full/<CD_M>`)
- `match{status, matchId, venue CD_V, utcStartTime, homeTeamId, awayTeamId, homeTeam/awayTeam{name, teamId, abbr, nickname, badge/flag asset URLs}, round, venueLocalStartTime ("2026-09-19T17:15:00"), venue{…, timeZone, capacity, …}}`
- `matchRoster{status, lastUpdated, matchId, competitionId CD_S…, roundNumber, weather{description, tempInCelsius, weatherType}, umpires[{umpireName, umpireId CD_U…, umpireType FIELD/…, umpireNumber}], homeTeam/awayTeam{teamName, ins[], outs[], milestones[{player, milestoneEvent "150th game"}], clubDebuts[], positions[{position, player}], lateChanges}, recentMatches[], teamPlayers[]}`
- Score block: `homeTeamScore/awayTeamScore{matchScore{totalScore, goals, behinds}, periodScore[{periodNumber, score{totalScore, goals, behinds}}], rushedBehinds, minutesInFront}`, `matchClock{periods[]}`, `scoreWorm{scoringEvents[]}`.
- **Period scores are per-period increments, not cumulative** (HAW 31/36/10/45 = 122). AFLDB
  `match_period_scores` is cumulative-to-date → convert and prove `Σ == final`.
- **Rushed behinds** are explicit: team behinds = Σ player behinds + `rushedBehinds`.
- No attendance/crowd field in any of the three feeds (confirmed by key search).

### 2.4 Post-conclusion churn (monitor snapshot 21:41 vs capture 10:29, `CD_M20260142801`)
The monitor recorded all three endpoint hashes as changed. Against the first nine stat rows
compared, **every statistic value and every `playerStats.lastUpdated`
(`2026-09-19T10:22:58.857+0000`) is byte-identical** in both captures, and the roster
`lastUpdated` (`10:14:39.970+0000`) is identical too. The monitor hashes raw bytes; the
sample-folder copies were re-serialised by the capture script (pretty-printed), so a
formatting difference is the likeliest cause. **Conclusion (T2):** the monitor's byte hashes
prove nothing about source state. AFLDB hashes the parsed, canonicalised payload (§4.5). This
capture pair is **not** evidence for any exclusion; it is the first fixture pair of the §9.9
evidence process, and the expected outcome there is `unchanged` with **no** exclusion at all.

### 2.5 Brownlow feeds
- `bfawards/season/<CD_S>`: `{seasonId, status, matchVotes[{matchId CD_M…, roundNumber, votes[{player{photoURL, givenName, surname, playerId CD_I…, jumper}, team{teamId, teamAbbr, teamName, teamNickname}, votes, eligible}]}], players[], teams[]}`. `roundNumber` uses **AFL API numbering** (2025 shows `0` for Opening Round and `24` for the last H&A round).
- `bfawards/leaderboard/season/<CD_S>`: `{seasonId, status, teamFilter, leaderboard[{player, team, eligible, winner, leader, roundByRoundVotes[{matchId, roundNumber, votes}], roundByRoundTotalVotes[{roundNumber, votes}], totalVotes}]}`.
- 2022–2025 validation JSONs: 0 bad vote sets, 0 duplicate matches, 0 duplicate players, 0
  unresolved match ids, 0 leaderboard mismatches; 198/207/207/207 match-vote records;
  `eligible:false` occurs (ineligible players still receive votes — carried, not dropped).
- The 2026 feed exists with `status: null`, empty arrays, `Cache-Control: max-age=3`, ETag
  present, `If-None-Match` not honoured.

---

## 3. Current architecture summary (one paragraph)

Every 2026+ source is observed into an immutable, content-addressed spine with ordered version
history and absence-as-state; a family may only be promoted through a typed projection that
carries the exact observation version; `reconcile()` names a verb; a candidate is queued; and
the one canonical writer (`applyCanonicalUnit`) re-derives ownership, manual authority,
baseline hash, season, completion and identity inside a savepoint, writing an append-only
`canonical_applications` row with the canonical row or neither. AFL Tables is the only source
that owns 2026 canonical rows today; Squiggle/Kali are retired witnesses; `afl_api` exists as
a source with two staging-only families. The AFL.com.au work therefore has a complete
substrate and needs (a) new families, (b) an adapter, (c) a typed projection migration,
(d) a source-parametrised settle, (e) a player bridge and (f) a co-source ownership policy.

---

## 4. Gap analysis — samples vs canonical requirements

### 4.1 Provided and mappable (authoritative candidates)
match/provider id, season (`compSeason.providerId`), round (with declared mapping), home/away
team (with tracked `CD_T` map), venue (`CD_V` map, else `venue_raw`), local date and time
(`venueLocalStartTime`), final score (goals/behinds/total), period scores (after cumulative
conversion), rushed behinds (validation only), player participation (stats rows), jumper
number, 21 of AFLDB's 21 statistics except `brownlow_votes` and `career_game_no` (below),
Brownlow 3-2-1 per match, season leaderboard totals, eligibility.

### 4.2 Provided but AFLDB does not store (retain in raw payload; **not projected**)
`timeOnGroundPercentage`, `metresGained`, `scoreInvolvements`, `turnovers`, `intercepts`,
`tacklesInside50`, `shotsAtGoal`, efficiency percentages, `dreamTeamPoints`, `ratingPoints`,
every `extendedStats` field, `superGoals`, umpires, weather, milestones, club debuts,
`ins/outs/lateChanges`, `minutesInFront`, `matchClock`, `scoreWorm`, `recentMatches`,
`matchChains` (play-by-play). ISSUE-096 explicitly excludes creating a Champion Data licensing
issue and a `player_match_period_stats` issue; this plan does not propose storing any of these.
A successor issue may add a narrow extended-stats table if a product requirement appears.

### 4.3 Required by AFLDB, not provided by AFL.com.au
| Field | Handling |
|---|---|
| `matches.attendance` | **Optional enrichment.** Propose `NULL` + non-complete `attendance_status` + `attendance_source_id NULL`. Enrichable later by AFL Tables settle (field-group exception, §7.5) or Super Admin (`data_overrides` group `attendance`). Never blocks promotion. |
| `player_match_stats.career_game_no` | `gamesPlayed` is null in every sample. Propose `NULL`; it is derivable and AFL Tables may enrich under the same field-group rule if approved (default: leave NULL, recompute-owned candidate). |
| `player_match_stats.brownlow_votes` | Not in the stats feed; comes from the Brownlow family after the count. Propose `NULL` (NA), exactly as the AFL Tables path does in season. |
| `matches.match_time` vocabulary | AFL Tables supplies free text (`Local.start.time`); AFL supplies ISO local time. Render `HH:MM` (the `fixtures` writer convention) — **operator confirmed 2026-09-22, Q5-B** (§15 Q5); implemented in `deriveAflApiLocalMatchDateTime()`. |
| Player identity | No `external_identities` rows for `afl_api`. **Stage S5 bridge** (§6). |
| `QF` vs `EF` for seasons without `finals_match_label` | Fail closed (`round_unresolvable`) — affects historical backtest only. |

### 4.4 Type and nullability differences
- All AFL counts are JSON floats; project as integers only when `Number.isInteger(x)`; a
  non-integral count refuses the record (`non_integral_statistic`).
- `superGoals` is null/0 noise; excluded from the projection, kept in the payload.
- `jumperNumber` integer → `text` (AFLDB convention, 077 rationale).
- `gamesPlayed` null → `career_game_no NULL` (not 0).
- Zero-as-missing: none observed in the stat feed (a 0 is a real 0). `zero_is_missing_columns`
  stays empty for every new family.

**S3 status (2026-09-19):** the non-integral refusal is a binding S3 requirement (§18 test plan
item 1 lists "integrality" under the DB-free parser/adapter tests) — it lives in the emitter's
`numOrNull()` (`afl-api-bundle.ts`), shared by `emitAflApiPlayerMatchStats()`'s stat counts and
`emitAflApiMatchRoster()`'s `playerJumperNumber`, not deferred to the S4 migration. Implemented:
`numOrNull()` now throws `non_integral_statistic` when `!Number.isInteger(value)`; a measured `9.0`
still parses to the integer `9` and passes. Covered by
`tests/afl-api-match.test.ts` (`emitAflApiPlayerMatchStats` and `emitAflApiMatchRoster` describe
blocks): one accept case (integral float) and one refusal case per call site.

### 4.5 Semantic hashing contract (T2)
```
raw bytes (immutable file in the snapshot, SHA-256 in the manifest)
  → JSON.parse (formatting, whitespace and `9.0` vs `9` vanish here: both parse to number 9)
  → declared-column selection (the family's known_columns; an undeclared key REFUSES the
    record at the S1 gate — it is never silently dropped from the hash)
  → canonicalJson() (sorted keys, stable number/boolean/null rendering, observations.ts:128)
  → sha256 = payload_hash, with hash_recipe = algorithm + the family's exclusion list
```
Rules:
1. `raw_payload` in `staging.source_payloads` is the parsed, declared-column object; the raw
   bytes stay in the snapshot file and are bound by the manifest. Nothing is hashed on bytes.
2. **`hash_exclusions` starts EMPTY for every ISSUE-228 family.** The lists sketched in the
   first draft of §5.2 are withdrawn; they were hypotheses.
3. A field may enter a family's `hash_exclusions` only when **all** of the following hold:
   (a) at least three independent observation pairs (distinct matches, or distinct polls of one
   match at least an hour apart) show the field changing while every other declared field is
   identical; (b) each pair is recorded in the registry entry's `evidence[]` with snapshot
   labels and the field path; (c) a fixture pair is added under `tests/fixtures/afl_api/hash/`
   and a regression test asserts `unchanged` with the exclusion and a new version without it;
   (d) the registry validator refuses an exclusion whose evidence entry is missing.
4. Migration 074's `hash_recipe` makes a later exclusion a reference-data edit with no backfill
   and no spurious version, so nothing is lost by starting empty.
5. `source_updated_at_field` may name a genuine upstream mutation timestamp
   (`matchRoster.lastUpdated`, `playerStats.lastUpdated`) **and that field stays inside the
   hash** unless rule 3 admits it — exactly the Squiggle `updated` precedent.

---

## 5. Proposed source contract

### 5.1 Source row
Keep `sources.key = 'afl_api'` (077). Amend the prose `description` by a data-only statement
in the new migration (077 refuses only on `kind`/`url`, which are unchanged): "Official
AFL.com.au JSON APIs (aflapi.afl.com.au v2, api.afl.com.au CFS with a public `WMCTok` media
token, sapi.afl.com.au). Reached directly for ISSUE-228 families and through fitzRoy for the
ISSUE-100/118 families. No operator credential." Independence group `afl_api` unchanged.

### 5.2 New families in `data/reference/source-families.json` (all `source_key: afl_api`)
| family | endpoint | external_key → `external_record_id` | scope_key | hash_exclusions | `source_updated_at_field` | promotion_policy |
|---|---|---|---|---|---|---|
| `match` | season matches feed, one record per `matches[]` element | `providerId` → `CD_M…` | `season=<year>` (feed enumerates the whole season → absence sweepable **for the match family only**) | **`[]`** (T2; §4.5 rule 3 governs any later addition) | none (feed publishes no mutation timestamp) | `reviewed` (auto-apply by CLI switch, as `afltables.match`) |
| `match_roster` | `matchRoster/full/<CD_M>` | `match.matchId` → `CD_M…` | `season=<year>;match=<CD_M>` (one record per fetch; **not sweepable**) | **`[]`** | `matchRoster.lastUpdated` (inside the hash) | `reviewed` (targets `match_period_scores` only; match-level facts come from `match`) |
| `player_match_stats` | `playerStats/match/<CD_M>` | `matchId|teamId|player.playerId` → `CD_M…|CD_T…|CD_I…` (the 077 lineup encoding) | `season=<year>;match=<CD_M>` (complete per match: 46 rows, sweepable within the match) | **`[]`** (`extendedStats.*` and `photoURL` are declared known columns, inside the hash, retained in the payload, never projected) | `playerStats.lastUpdated` (inside the hash) | `reviewed` |
| `brownlow_match_votes` | `bfawards/season/<CD_S>` split per `matchVotes[]` | `matchId` → `CD_M…` | `season=<year>` (sweepable only when `status = CONCLUDED`) | **`[]`** | none | `reviewed` (target `brownlow_round_votes`) |
| `brownlow_leaderboard` | `bfawards/leaderboard/season/<CD_S>` per `leaderboard[]` | `player.playerId` → `CD_I…` | `season=<year>` | **`[]`** | none | `never` in ISSUE-228 (artefact input for the ISSUE-113 loader at rollover; witness for round-vote totals) |

Expected consequence of empty exclusions, stated so it is not mistaken for a defect: every
poll that changes `photoURL` query strings, ticket links or `lastUpdated` without a fact change
will append a spine version and reconcile as `history_only` (no projected field moved, no
candidate). That is the designed behaviour of ISSUE-096 and is exactly the evidence stream §4.5
rule 3 needs. If it proves noisy, the fix is an evidenced exclusion, not a shortcut.

`match_plays` is **not declared** (optional, out of scope). `known_columns_status` is
`complete` only after the backtest enumerates every key across 2022–2026 samples; until then
the registry validator will refuse an undeclared key, which is the intended fail-closed shape.

Round vocabulary: replace the `anchors_only` `afl_api_2026` entry with the per-season
**explicit round table** defined in §6.4 (`mapping_status: declared`, evidence = the season
feed's round list). No offset arithmetic appears in the registry or in any adapter.

### 5.3 New tracked reference data
- `data/reference/afl-api-identities.json`: `teams: { "CD_T10": { hist: "Adelaide", first_season, last_season|null } … }` (18 rows, filled from the feeds and verified against `clubs.json`), `venues: { "CD_V40": { legacy_name: "M.C.G." } … }` (unmapped venue → `venue_id NULL`, `venue_raw` = AFL name; no venue row is ever created), `seasons: { "2026": { compSeasonId: 85, providerId: "CD_S2026014" } … }`.
- `data/reference/afl-api-player-bridge-<date>.json` (S5 output, reviewed, hash-bound).

### 5.4 Snapshot layout and manifest
`data/sources/afl_api/matches/<label>/` with `00-season-matches.json`, per match
`<CD_M>/fixture.json`, `<CD_M>/player-stats.json`, `<CD_M>/match-roster.json`, `token.meta.json`
(token issue time only, never the token), and `manifest.json` written **last**; manifest copied
to `docs/rebuild-manifests/afl_api/<label>.json` (tracked). Label grammar
`afl-api-<season>-<YYYY-MM-DD-HHMM>`. Brownlow: `data/sources/afl_api/brownlow/<label>/`.
The existing `AFLWebsite` sample folders are **not** the contract; they are backtest inputs (§9).

---

## 6. Player, match and provider-ID resolution rules

### 6.1 Match
1. **Provider id first.** Look up `matches WHERE source_id = afl_api AND source_record_id = <CD_M>`.
   A hit is the canonical row regardless of its current `match_key` (this makes an upstream
   date/round/venue correction an exact rekey, no ISSUE-131 search needed).
2. **Then `match_key`.** Render `season|round_code|match_date|home hist|away hist` exactly as
   `import_fitzroy_core.py::match_key_of()` does (ClubResolver names). A hit is an
   AFL-Tables-owned or manually created row for the same real-world match → ownership rules (§7).
3. **Then the ISSUE-131 retired-identity search** (`findRetiredMatchIdentities`) — only for
   `afl_api`-owned rows; never merges two populated graphs.
4. Otherwise `new_target`.
Contradiction: provider-id hit whose (season, home, away) differ from the payload → `HALT`
for the run (`provider_identity_contradiction`, §14). Two canonical rows matching (1) and (2)
with different ids → `rekey_would_merge` refusal (existing).

### 6.2 Team and venue
`CD_T` → `clubs.legacy_club_hist` through `afl-api-identities.json` only; validate
`abbreviation`/`name` against the map's recorded raw strings and refuse on drift
(`team_identity_drift`), never resolve by name. `CD_V` → `venues.legacy_name`; unmapped is a
warning + `venue_id NULL`.

### 6.3 Player — the `afl_api` provider bridge (Stage S5) — **bootstrap only (T1)**
- **Normal ingestion resolves players from one place only:** `external_identities WHERE
  source_id = afl_api AND external_id = <CD_I> AND status IN ('unique','resolved') AND
  player_id IS NOT NULL`, loaded into `refs.playerIdsByProviderId` exactly as
  `playerIdsByUrl` is today. The settle never reads AFL Tables snapshots, `afltables`
  projections or `afltables`-owned `player_match_stats` to resolve a player. Acceptance test
  §19.4(c) runs a settle with no AFL Tables snapshot on disk and no `afltables` rows for the
  match and requires 100% resolution of previously bridged players.
- **The bridge is a bootstrap/backfill tool, not an ingestion step.** It is run on demand by the
  operator (`bridge:afl-api --build/--validate-only/--dry-run/--apply`), reads AFL Tables-owned
  canonical rows as *evidence*, and writes **durable** `external_identities` rows:
  `source_id = afl_api`, `external_id = CD_I…`, `external_name` (as the AFL spells it),
  `status = 'unique'`, `match_method = 'afl_api_stat_vector_bootstrap'`, `notes` = the evidence
  summary (matches, agreeing statistics). Once written, a link is trusted by ingestion forever
  and is independent of AFL Tables' continued availability.
- **Append-only and non-guessing:** a re-run never modifies or deletes an existing link; a
  re-run that finds a contradiction for an existing link withholds the new evidence, opens a
  `data_issues` row (`afl_api_identity_contradiction`, keyed by `CD_I`) and leaves the link for a
  human. `status = 'resolved'` is reserved for a human decision; the bootstrap writes only
  `unique`.
- **Unresolved is unresolved.** A `CD_I` the bridge cannot prove stays absent from
  `external_identities`; ingestion records `unresolved_identity` for that player unit (existing
  refusal verb, `import_rejections` row, refusal candidate) and applies the match unit anyway.
  A debutant with no `players` row (ISSUE-224) is exactly this case and is resolved only through
  ISSUE-224 or the identity workflow that issue produces — never by this bridge and never by the
  settle.
- **Bridge construction (offline builder + fail-closed loader, DraftGuru-bridge pattern):**
  for every AFL.com.au CONCLUDED match that resolves (§6.1 step 2) to an `afltables`-owned
  canonical match with `player_match_stats` rows, join each AFL stat row to the canonical rows
  of the same `match_id` and resolved `club_id` on `jumper_number` **and exact equality of the
  core stat vector** (kicks, handballs, marks, tackles, goals, behinds, hitouts, frees_for,
  frees_against, inside_50s, clearances, rebounds, goal_assists — every column both sides carry
  non-NULL). Accept `CD_I → player_id` only when: (a) every observed match of that `CD_I` maps
  to the same `player_id`; (b) that `player_id` maps to no other `CD_I`; (c) ≥ 2 matched
  matches, or 1 match with ≥ 10 non-NULL agreeing statistics; (d) normalised surname equality
  holds — **as validation**: a failure withholds the pair (`surname_disagrees`), it never
  resolves anything. Roster snapshots (`rosters-20260905`, 2012–2026) are a second witness
  (`CD_I` + club-season listing must be consistent) but not an identity source.
- **Fallback checks:** none automatic. A `CD_I` with zero core-stat matches (debutant, or a
  player whose AFL Tables row has not settled) is `unresolved_identity` → `import_rejections`
  row + refusal candidate for a human, and the *match* family still settles.
- **Contradiction:** a `CD_I` whose stat vector matches two different players across matches,
  or two `CD_I` matching one player → both withheld, listed in the bridge report; never picked.
- **Unresolved handling:** the ISSUE-224 gap (2026 debutants with no `players` row at all, e.g.
  Jagga Smith, Willem Duursma) is **not** closed here; the bridge can only link existing
  players. Registering a debutant remains a human decision (existing `admin/player-links`
  surface; an `afl_api` adjudication path there is a successor item).
- **No unsafe auto-linking:** names, jumper alone, or club+season alone never create a link;
  `status` is always `unique` (deterministic) or nothing; `resolved` is reserved for a human.

### 6.4 Round translation — the one contract (T4)
- **Location:** `src/lib/acquisition/afl-api-rounds.ts`, `translateAflRound(vocabulary,
  observed)` — the **only** code path that turns an AFL round into AFLDB `(round_code,
  round_number, round_type, is_final)`. The emitter, the Brownlow emitter and the fixture
  successor all call it; a code search for `roundNumber + 1` outside this module fails the
  contract test (§19.7(f)).
- **Vocabulary shape** (`data/reference/source-families.json` →
  `round_vocabularies.afl_api_<year>`), fully explicit, one row per AFL round:
  ```
  { "mapping_status": "declared", "season": 2026,
    "evidence": ["00-season-matches.raw.json compSeasonId 85, 2026-09-19"],
    "rounds": [
      { "api_round_number": 0,  "api_abbreviation": "OR", "api_name": "Opening Round",
        "round_type": "home_and_away", "canonical_round_number": 1 },
      { "api_round_number": 1,  "api_abbreviation": "1",  "api_name": "Round 1",
        "round_type": "home_and_away", "canonical_round_number": 2 },
      … one row each through api_round_number 24 → canonical 25 …,
      { "api_round_number": 25, "api_abbreviation": "WF", "api_name": "Wildcard Finals",
        "round_type": "wildcard_final" },
      { "api_round_number": 26, "api_abbreviation": "QE",
        "api_name": "Qualifying & Elimination Finals", "round_type": "mixed_finals",
        "finals_label_rules": [ { "contains": "Qualifying",  "round_type": "qualifying_final" },
                                { "contains": "Elimination", "round_type": "elimination_final" } ] },
      { "api_round_number": 27, "api_abbreviation": "SF", "round_type": "semi_final" },
      { "api_round_number": 28, "api_abbreviation": "PF", "round_type": "preliminary_final" },
      { "api_round_number": 29, "api_abbreviation": "GF", "round_type": "grand_final" } ] }
  ```
  `round_code` is derived by the module from `round_type` exactly as `createMatch()` and
  `admin-fixtures.ts renderRound()` do (decimal string for home-and-away; `WF/EF/QF/SF/PF/GF`),
  so the three writers cannot disagree. The registry validator refuses a vocabulary whose
  canonical H&A numbers are not a contiguous 1..N, whose `mixed_finals` row lacks label rules,
  or whose `api_round_number`s are not unique.
- **Representable cases:** Opening Round (a row with `canonical_round_number: 1`), ordinary
  H&A rounds, a season with no Opening Round (2022/2023: `api_round_number 1 → canonical 1`),
  the Wildcard round, single-type finals rounds, and the mixed QE round via
  `finals_label_rules` over `metadata.finals_match_label`.
- **Refusals (typed, tested):**
  | Condition | Outcome |
  |---|---|
  | no `afl_api_<year>` vocabulary for the bundle's season | **run-level HALT** before any DB connection (`round_vocabulary_missing`) |
  | `api_round_number` not in the table | **record rejection** `round_unmapped` (presence kept; enumeration `complete` stays as measured; the record counts toward `rejected_records`, so `--require-complete-source` turns the run red — the ISSUE-128 Wildcard precedent, deliberately) |
  | observed `api_abbreviation`/`api_name` differ from the declared row | record rejection `round_vocabulary_drift` (a renamed round is a contract change, not a guess) |
  | `mixed_finals` row and `finals_match_label` absent or matching no rule | record rejection `finals_label_required` (this is the 2022–2024 historical case; the backtest asserts it) |
  | label matches a rule but the fixture's `round.abbreviation` is not the mixed row | record rejection `round_inconsistent` |
  | Brownlow `roundNumber` maps to a non-H&A round | record rejection `brownlow_round_not_home_and_away` |
- **Cross-check gate (§8 gate 2):** when the match resolves to an existing canonical row, the
  translated `(round_code, round_type)` must equal the canonical row's; a mismatch is a
  `corrected` candidate on a historically significant field (§13.5), never an auto-apply.

---

## 7. Lifecycle: acquire → observe → validate → promote

### 7.1 Acquire (network, files only)
1. `POST api.afl.com.au/cfs/afl/WMCTok` → token (memory only; never written).
2. `GET` season matches feed (full season, `pageSize=1000`); select matches by `--status`
   (default `CONCLUDED`), `--since`, `--match <CD_M>…`.
3. Per selected match: `GET playerStats`, `GET matchRoster`. Retry 3× exponential backoff;
   401/403 → re-issue token once; any remaining failure → no manifest, partial dir removed
   (the `cleanup_partial` pattern in `afldb-settle-afltables.sh`).
4. Write raw bytes verbatim, then the manifest last with SHA-256 per file and per-endpoint HTTP
   status, ETag, `Cache-Control`, retrieval time.
Nothing here adjudicates.

### 7.2 Observe (offline emitter + DB persistence)
- Emitter (`src/lib/acquisition/afl-api-bundle.ts`, pure): parse → validate shape against the
  registry → render `external_record_id`, `scope_key`, payload (observed columns) →
  **projection or rejection** per record → bundle v1 (`acquisition_kind: 'afl_api_match_snapshot'`,
  `season`, `source_key: 'afl_api'`).
- Persistence reuses `persistSourceObservation()` unchanged: identical canonical payload →
  `head_refreshed`, changed → new `version_seq`; **every status is observed** (SCHEDULED, LIVE,
  POSTGAME, CONCLUDED), so the spine holds the full transition history.

### 7.3 POSTGAME vs CONCLUDED (Decision, amended per T3)

**What the existing state model can and cannot say.** A bundle record today has exactly three
shapes: projected (`projection` set, `rejection` null), rejected (`rejection` set) or
unprojected-without-rejection (`projection` null, `rejection` null). Reading
`settleFamily()` (`settle-afltables.ts:2031-2150`) and `assessSourceCompleteness()`
(`source-completeness.ts:96-160`):
- a **rejected** record is observed (spine), writes no projection, and for every target the
  source "establishes" (`matches`, `player_match_stats`) it is reconciled with
  `identity: unresolved` → an `unresolved_identity` refusal candidate plus an
  `import_rejections` row, and it counts toward `snapshotRejections` → completeness verdict
  `incomplete` → a red unit under `--require-complete-source`;
- an **unprojected, unrejected** record fares no better: `resolveTarget` is skipped, but the
  targets are still reconciled as `unresolved('the record produced no typed projection')` with
  the same candidate and rejection row.
So **the current model cannot express "observed, valid, not yet promotable"**: both available
shapes would report every POSTGAME match as a failed ingestion that later "succeeded". That is
precisely the operational reporting T3 forbids. The limitation is documented here and **a
minimal distinction is warranted and included in Stage S6**:

- **Bundle contract v2** (afl_api spec only; the AFL Tables emitter keeps v1 and its validator
  keeps pinning v1): a record gains an optional `deferral: { reason, detail } | null`, mutually
  exclusive with `rejection`. A deferred record has `projection: null`.
- **Settle core semantics for a deferred record:** observed into the spine exactly like any
  other record (I1/I2 apply: an unchanged POSTGAME re-poll is a head touch, the POSTGAME →
  CONCLUDED payload change is a new version); **no projection, no target pass, no reconcile,
  no candidate, no `import_rejections` row**. `targetEstablishedBySource()` answers false for
  every target of a deferred record — the source has not yet published a completed match, so
  no completed-match fact exists to propose, which is the same reasoning the function already
  applies to an unpublished Brownlow vote.
- **Counters and reporting:** new `recordsDeferred` (by reason) in `SettleCounters`; deferred
  records are **excluded** from `snapshotRejections` and from every `SourceCompletenessReason`;
  the completeness headline gains an informational line ("N match(es) observed but not yet
  concluded; nothing proposed") that does not change the verdict. A run whose only non-applied
  records are deferred reports `complete` and exits 0. The `--report` view lists deferred
  records under their own heading, never under exceptions.
- **Enumeration and absence:** a deferred record is present in its enumeration; a `complete`
  season enumeration may still sweep. A match that leaves the feed entirely is `absent` (review
  signal), unchanged.

| State | Observation | Projection | Candidate | Auto-apply | Reported as |
|---|---|---|---|---|---|
| fixture `status ∉ {CONCLUDED}` (`POSTGAME`, `LIVE`, pre-match) | yes | **no** — record **deferred** `{reason: 'status_not_concluded', detail: '<status>'}` | no | no | deferred (informational) |
| fixture `CONCLUDED`, roster absent or `status ≠ CONCLUDED` | yes | match family: yes; roster/stat families: **deferred** `roster_not_concluded` | match only | match only (all-or-none per family still holds) | applied + deferred |
| both `CONCLUDED`, gates pass | yes | yes | yes | yes | applied |
| both `CONCLUDED`, a gate fails (arithmetic, mapping, identity) | yes | rejection / refusal as today | refusal candidate | no | exception (correct: this IS a failure) |
| later re-observation, payload unchanged | head touch | unchanged | none (`unchanged`) | none | no-op |
| later re-observation, values changed | new version | replaced in place (O1: never deleted) | `corrected` | yes if `afl_api` owns the row and no override; else candidate/refusal | correction |

Rationale: the operator's monitor shows POSTGAME → CONCLUDED with identical scores, but
POSTGAME is by definition pre-verification; AFLDB gains nothing by promoting minutes earlier
and risks writing a number Champion Data then corrects. Idempotency and replay are the spine's
I1/I2 properties; the settle run over an identical snapshot is a total no-op (proven for the
AFL Tables path by `settle-afltables.test.ts:2766`). Deferral is a record state inside a
successful run, not a verdict on the run.

### 7.4 Validate (§8) then promote through `applyCanonicalUnit()` with `sourceKey = 'afl_api'`.

### 7.5 Ownership between `afltables` and `afl_api` — **DECIDED (Q1, Q2)**
`autoApplyOwnership()` refuses any row owned by another source; that gate is not weakened.
- **Co-sources (Q1).** `afltables` and `afl_api` are declared co-sources for the four canonical
  targets in the registry (`co_source_groups: [["afltables", "afl_api"]]`). A co-source-owned
  row is *corroborated*: `classifyCorroboration()` records agreement/disagreement, a
  disagreement opens the deduplicated `source_disagreement` `data_issues` row (advisory), and
  the encounter is counted as `corroboratedForeignOwned`, **not** as a refusal or exception.
  The row keeps its first owner. Existing 2026 rows stay `afltables`-owned; a match first
  promoted by `afl_api` is `afl_api`-owned. **Nothing re-owns a row because another source now
  corroborates it**; an ownership transfer, if ever wanted, is an explicit operator-run script
  with its own `canonical_applications` rows, never a side effect of a settle.
- **Attendance enrichment (Q2)** — the one field-group exception, declared in code as
  `CO_SOURCE_ENRICHMENT = { matches: { attendance: ['attendance', 'attendance_status',
  'attendance_source_id'] } }` and nothing else.

  **Terminology, so this cannot be misimplemented.** Wherever this section says "status" it
  means **`matches.attendance_status`**, the per-field `coverage_status` enum from migration
  020 (`complete | partial | not_collected | not_applicable | pending`), whose CHECK
  `matches_attendance_status_ck` ties it to the `attendance` column (`complete` ⇔ non-NULL).
  It **never** means the AFL `CONCLUDED` state, `is_final`, "match played", or any notion of
  canonical match completion. A completed, CONCLUDED, fully settled `afl_api`-owned match
  **remains eligible** for attendance-only enrichment for as long as its attendance is
  unsourced. Completion protects the already-sourced match, result, period and statistic
  fields (they move only through `corrected` candidates under the ordinary ownership and
  authority gates); it does not freeze an unsourced optional enrichment field.

  **The gate, evaluated inside the applier's savepoint against re-read state, all conditions
  required:**
  1. **the canonical `matches` row already exists** (identity `resolved`, never `new_target`
     — enrichment never inserts a match);
  2. **the enriching source is a declared co-source for the `attendance` field group** on a row
     owned by another co-source (registry `co_source_groups`; today that means `afltables`
     enriching an `afl_api`-owned row; the reverse can never fire because an `afl_api`
     proposal carries no attendance);
  3. **`matches.attendance_source_id IS NULL`** — the field is unsourced. Because of the 020
     CHECK this implies `attendance IS NULL` and `attendance_status <> 'complete'`; a value that
     already cites a source (including `manual_admin_edit`, the existing
     `settle-afltables.test.ts:1923` refusal) is never touched automatically, whatever its
     value;
  4. **no active manual/admin override**: no active `data_overrides` row for
     `(matches, <match_key>, 'attendance')` (E4, re-read inside the savepoint);
  5. **the incoming attendance is valid**: an integer ≥ 0 from the enriching source's own
     typed projection (`staging.afltables_match.attendance`), with its `attendance_status =
     'complete'` and, for a 0 crowd, a non-NULL `attendance_source_id` (the 020 zero-crowd rule);
  6. **only the attendance field group is written**: `attendance`, `attendance_status`,
     `attendance_source_id` and nothing else; `matches.source_id` (row ownership) is not
     changed; no other target of the unit is offered;
  7. **the write goes through `applyCanonicalUnit()`** and produces a `canonical_applications`
     row (`target_table = 'matches'`, `verb = 'update'`, `new_values` = exactly the three
     fields, `previous_values` = their prior NULL/non-complete/NULL state, bound to the
     enriching source's `source_version_seq`); `attendance_source_id` becomes the enriching
     source.

  Consequences stated plainly: a NULL attendance on an `afl_api`-owned row blocks nothing —
  the match, its period scores and its player rows promote with `attendance_status` at the
  non-complete value 020 assigns (`not_collected`; `pending` if the operator prefers "expected,
  not yet published" for in-season rows — decide at S4 and pin it in the projection CHECK) —
  and the enrichment may land days or weeks later, after the match is long CONCLUDED. A
  correction to an already-sourced attendance from a co-source is a `corrected` candidate for
  review, never an automatic write. A Super Admin `data_overrides` attendance edit wins over
  both.

---

## 8. Validation gates and invariants (promotion checks)

Per match unit (all must pass or the unit is refused with a named reason):
1. **Status**: fixture `CONCLUDED`; roster `CONCLUDED` for period/stat targets.
2. **Season/round agreement**: `compSeason.providerId` ↔ declared season; round mapping
   declared for the season; `round.roundNumber` consistent with `matchRoster.roundNumber`;
   finals label parses; `is_final = (round_type <> 'home_and_away')`.
3. **Team resolution**: both `CD_T` mapped, different, raw name/abbr match the map.
4. **Match resolution** (§6.1); provider-identity contradiction → HALT.
5. **Score arithmetic**: `total = 6*goals + behinds` both sides; `margin = |diff|`; `result`;
   fixture score == roster `matchScore` == cumulative Q4.
6. **Period scores**: 4 periods each side, cumulative conversion, non-negative, `Σ` equals
   final; more than 4 periods → refuse (`extra_time_unsupported`, mirrors AFL Tables path).
7. **Player counts**: 23 rows per team, 46 per match (declared per season; refuse otherwise),
   `Σ` roster `positions` minus `EMERG` == stat-row `playerId` set; no duplicate `CD_I` in a
   match; no `CD_I` on both teams.
8. **Goal/behind reconciliation**: `Σ player goals == team goals`; `Σ player behinds +
   rushedBehinds == team behinds`.
9. **Integrality**: every projected count is an integer ≥ 0.
10. **Provider-ID consistency**: every `teamId` on stat rows ∈ {home, away}; `matchId` on
    roster/stat payloads equals the fixture `providerId`; `competitionId` equals the season.
11. **Identity**: player `CD_I` resolved (else that player unit is `unresolved_identity`; the
    match unit still applies).
12. **Canonical conflict detection** (existing gates): E3 ownership, E4 manual authority
    (`data_overrides`), E5 baseline hash, E2 in-progress season, E6 completion; `match_key`
    collision with a differently-owned row → candidate, never auto-apply.
13. **Duplicate protection**: `pms_player_match_uq`, `matches_match_key` UNIQUE,
    `(source_id, source_record_id)` uniqueness on `matches` enforced by the resolver.

Brownlow (§10) has its own list.

---

## 9. Historical replay / backtest design

Inputs: the 12 historical samples (2022–2025, 3 per season, all `CONCLUDED`) + the 2 2026
preliminary finals + the monitor snapshot; the 2022–2025 Brownlow season/leaderboard feeds.
Bytes stay untracked; a tracked manifest `docs/rebuild-manifests/afl_api/backtest-20260919.json`
hash-binds them, and the backtest **skips with an explicit "fixture absent" outcome** (never a
silent pass) when a file is missing. Small hand-trimmed tracked fixtures (one match, one
Brownlow round) live under `tests/fixtures/afl_api/` for the DB-free contract tests.

Backtest assertions (DB-free unless stated):
1. **Schema stability**: the key set and types of every payload are identical across 2022–2026
   for the declared columns; any new key is reported (not fatal) and any missing required key
   is fatal.
2. **Round mapping**: each sample's mapped `(round_code, round_type, round_number)` equals the
   folder's `R<n>` label + 1 where an Opening Round exists (2024–2026) and + 0 otherwise.
3. **Counts and arithmetic**: gates 5–10 pass on all 14 matches.
4. **Cumulative conversion**: derived `match_period_scores` reproduce the final score.
5. **`match_key` resolution on `afldb_test`** (integration, read-only): all 12 historical
   samples resolve to an existing `afltables`-owned match and the canonical scores/period
   scores agree exactly — the proof that the mapping is right.
6. **Stat parity on `afldb_test`** (integration, read-only): for every resolved player (via the
   S5 bridge), the 19 stat columns both sources carry agree; disagreements are listed by column
   (expected: exact for the AFL Tables era of these columns; `bounces`, `one_percenters`,
   `clangers` are the ones to watch).
7. **Bridge coverage**: fraction of the 644 sample `CD_I` values the bridge resolves; the
   unresolved list must be explainable (debutants / unsettled).
8. **Idempotency**: emitting the same snapshot twice yields byte-identical bundles; persisting
   twice on `afldb_test` (dry-run) yields `head_refreshed` only.
9. **Semantic hash evidence (T2)**: the 10:29 and 21:41 captures of `CD_M20260142801` are
   parsed, canonicalised and hashed **with an empty exclusion list**; the expected result is
   `unchanged`. If they differ, the differing paths are printed and recorded as **evidence
   pair 1 of 3** in the registry `evidence[]` for the affected family — not added to
   `hash_exclusions`. The same comparison runs for every pair of polls the monitor captured;
   an exclusion is proposed only when §4.5 rule 3 is met, and lands only with its fixture pair
   and regression test.
10. **Brownlow**: 2022–2025 feeds reproduce the sample validation JSONs (0 defects) and every
    `matchId` resolves to a canonical H&A match on `afldb_test`; reconstructed totals equal
    `totalVotes`.
Known limitation: 2022/2023 (and 2024) finals cannot be split `QF`/`EF` from the feed; the
backtest asserts `round_unresolvable` for them rather than guessing.

---

## 10. Brownlow integration

- **Same infrastructure**: `afl_api.brownlow_match_votes` records per `CD_M` into the 074 spine
  (idempotent under polling: an unchanged match record is a head touch; new matches appear as
  new records during the live count; a correction is a new version), typed projection
  `staging.afl_api_brownlow_vote` (one row per vote: `provider_match_id, provider_player_id,
  provider_team_id, season, api_round_number, canonical_round_number, votes, eligible,
  match_id NULL, player_id NULL, club_id NULL`), target `brownlow_round_votes` (already an
  admitted canonical target with provenance since 083).

  > **Annotation 2026-09-22 (ISSUE-244 F021; original text above is frozen and unchanged).**
  > The `match_id NULL, player_id NULL` wording is the plan-stage design. The current projection
  > populates the resolved identifiers, and ISSUE-244 F007 carries `match_id` into
  > `brownlow_round_votes` (the canonical row) as well.
- **Logically separate**: its own emitter, validator, CLI (`settle:afl-api-brownlow`), unit
  and status line; it never touches `matches`/`player_match_stats`; the match path never
  writes votes. `player_match_stats.brownlow_votes` is **not** written by this stage (the
  round-vote grain is canonical; the per-game column stays NA in season exactly as today).
- **Season totals**: `brownlow_season_votes` is not an automatic target and its loader refuses
  `in_progress` seasons. ISSUE-228 delivers an **artefact builder** that renders the
  leaderboard feed into the ISSUE-113 artefact row shape keyed by AFL Tables profile path via
  the bridge → `external_identities(afltables)`; loading it is a rollover step (ISSUE-101/F),
  gated on `stat-availability.json` moving 2026 from `pending` to `complete`.
- **Validation (per §H of the brief):** exactly one vote set per `CD_M` (3 rows); votes are
  exactly {3,2,1}; total 6; no duplicate player within a match; `CD_M` resolves to a canonical
  match (provider id first, then `match_key`); `CD_I` resolves through the bridge (else
  `unresolved_identity` for that vote — the other two votes of the match still apply? **No**:
  a match's vote set is one unit, all-or-none, mirroring the match family); finals are excluded
  naturally (no finals records in the feed) **and** defensively (a vote record whose match is
  `is_final` refuses, as `afltables_player_match_brownlow_row_ck` already makes unrepresentable);
  reconstructed per-player totals == leaderboard `totalVotes` when the leaderboard `status` is
  `CONCLUDED` (advisory during the live count, blocking at the end); repeated observation during
  the count is idempotent; `eligible=false` is carried to the season artefact as `is_ineligible`.
- **Round numbering**: `canonical_round_number = api_round_number + offset` from the season's
  declared vocabulary; the backtest checks 2025 `roundNumber 0` votes land on canonical round 1
  (**operator to confirm on `afldb_test`** that 2024/2025 `brownlow_round_votes` follow the
  AFL Tables numbering, §15 Q8).
- **Timing**: the 2026 count is imminent (Grand Final week). ISSUE-228 cannot land before it;
  the operator's standalone monitor should **capture the raw season and leaderboard feeds
  every few minutes during the live count** into immutable timestamped files. Those captures
  become the replay input for the idempotency test (§11.5) — a live-count observation that costs
  nothing now and is otherwise unrepeatable.
- **Operational enablement (DECIDED 2026-09-19, operator, carried forward to S7/S8):** the
  Brownlow ingestion job is **independently enable/disableable** from the match-family settle job
  (its own unit/flag, never bundled behind the match timer) and **defaults to disabled outside the
  live count period** — it is not safe-by-default to poll `bfawards` year-round. It must support an
  **observe-only mode** (fetch, parse, validate, log — no promotion write) distinct from its normal
  apply mode, and a **simulator mode** pointed at `AFLDB_AFL_API_CFS_BASE_URL=http://127.0.0.1:22880`
  (§ "Brownlow simulator compatibility" above). The S7/S8 implementation must be **exercised
  end-to-end against the local simulator in both observe-only and apply mode before it is ever
  pointed at the live AFL endpoint**. S3 does not implement this job; its emitter/validator
  (`afl-api-brownlow.ts` family functions) must simply avoid baking in any live-only or
  always-on assumption, so S7/S8 can add the enable flag, the default-disabled guard and the
  observe-only switch around them without reshaping the emitter contract.

---

## 11. Field mapping matrix

### 11.1 `matches`
| Canonical | AFL source | Class | Notes |
|---|---|---|---|
| `source_record_id` | `providerId` | authoritative | identity |
| `season` | declared from `compSeason.providerId` | authoritative | |
| `round_code`, `round_number`, `round_type`, `is_final` | `round.abbreviation/roundNumber` + `metadata.finals_match_label` via `afl_api_<year>` mapping | authoritative | offset rule §2.1 |
| `match_date`, `match_time` | roster `match.venueLocalStartTime` (cross-checked with fixture `utcStartTime` in `venue.timezone`) | authoritative | `HH:MM` rendering (Q5-B, decided 2026-09-22) |
| `venue_id`, `venue_raw` | `venue.providerId` via map; `venue.name` | authoritative / raw | unmapped → NULL id |
| `home_club_id`, `away_club_id`, `winner_club_id` | `CD_T` via map | authoritative | |
| `home/away goals, behinds, score`, `result`, `margin` | fixture `score` (== roster `matchScore`) | authoritative | |
| `attendance`, `attendance_status`, `attendance_source_id` | — | **optional enrichment** | NULL / non-complete |
| `scheduled_at` | `utcStartTime` | optional | column has no reader; **not** written in v1 (avoid inventing a convention, per 097 rationale) |
| `match_event`, `notes` | — | not sourced | |

### 11.2 `match_period_scores` — roster `periodScore[]` per side, cumulative-converted; authoritative.

### 11.3 `player_match_stats`
| Canonical | AFL `stats` key | Class |
|---|---|---|
| `player_id` | `player.playerId` via bridge | identity |
| `club_id` | `teamId` via map | identity |
| `jumper_number` | `jumperNumber` (text) | authoritative |
| `career_game_no` | `gamesPlayed` (null) | not sourced → NULL |
| `kicks` `handballs` `disposals` `marks` `goals` `behinds` `hitouts` `tackles` `bounces` `clangers` `goal_assists` | same names | authoritative |
| `rebounds` | `rebound50s` | authoritative |
| `inside_50s` | `inside50s` | authoritative |
| `clearances` | `clearances.totalClearances` | authoritative |
| `frees_for` / `frees_against` | `freesFor` / `freesAgainst` | authoritative |
| `contested` / `uncontested` | `contestedPossessions` / `uncontestedPossessions` | authoritative |
| `contested_marks` | `contestedMarks` | authoritative |
| `marks_inside_50` | `marksInside50` | authoritative |
| `one_percenters` | `onePercenters` | authoritative |
| `brownlow_votes` | — | not sourced here (NA) |
| `source_record_id` | `CD_M|CD_T|CD_I` | provenance |

### 11.4 `brownlow_round_votes` — `season`, `player_id` (bridge), `round_number` (mapped), `played = true`, `votes`; provenance quartet.

### 11.5 Not stored (see §4.2). Umpires, weather, milestones, debuts: **not currently sourced into canonical**; retained in raw payloads; possible successor families.

---

## 12. Migration / schema changes (genuinely required)

**Migration 103 (one file, additive, no canonical column changes):**
1. `staging.afl_api_match` — column-for-column the `staging.afltables_match` shape (076) plus
   `provider_match_id text NOT NULL`, `provider_season_id text NOT NULL`, `provider_status text
   NOT NULL`, `provider_home_team_id`, `provider_away_team_id`, `provider_venue_id`; family
   CHECK `family = 'match'`; same score/period/attendance CHECKs (attendance will always be NULL
   + non-complete here, and the CHECK proves it).
2. `staging.afl_api_player_match` — the `staging.afltables_player_match` shape plus
   `provider_match_id`, `provider_team_id`, `provider_player_id`, `match_key`, no `afltables_id`,
   no `brownlow_*` columns (votes are a separate family); grain UNIQUE `(source_id,
   provider_player_id, match_key)`.
3. `staging.afl_api_brownlow_vote` (§10).
4. `UPDATE sources SET description = … WHERE key = 'afl_api'` (prose only).
5. Grants exactly as 076/077 (`afldb_import` DML, `afldb_app` SELECT).
Explicitly **not** changed: `matches`, `player_match_stats`, `brownlow_round_votes`,
`canonical_applications` CHECK (the four targets are exactly what ISSUE-228 writes),
`data_overrides` CHECK, `external_identities` (rows are data, `match_method` is free text).
The fixture successor will need the `canonical_applications_target_table_ck` widened to admit
`fixtures` (§13.2, decided now, executed later).

---

## 13. Fixture ingestion — placement and the decisions taken now

### 13.1 Placement
**Successor issue** (`AFLDB-ISSUE-229` recommended), not an ISSUE-228 stage: it needs a
`canonical_applications` CHECK widening, a second writer for `fixtures` beside
`admin-fixtures.ts`, a status-driven target switch, and the SCHEDULED/LIVE status vocabulary
that no sample has yet observed. None of that is needed to reduce the AFL Tables dependency
for completed matches. ISSUE-228 stops at "observe every status; promote CONCLUDED".

> **Annotation 2026-09-23 (closure preparation, §22.21; original text above unchanged).** Opened as
> **AFLDB-ISSUE-229 — AFL API fixture ingestion**. Season discovery (§13.4) is
> **AFLDB-ISSUE-233**, not ISSUE-229.

### 13.2 Decisions ISSUE-228 makes now so fixtures need no redesign
1. **One family, one identity, status-selected targets.** `afl_api.match` is the season-feed
   match object keyed by `CD_M…`; it is the *same* external record whether the match is
   SCHEDULED, LIVE, POSTGAME or CONCLUDED. The spine records the transition history. The
   emitter's projection carries `provider_status`; the settle proposes **`fixtures`** targets
   while `status ∉ {CONCLUDED}` (successor) and **`matches`** targets when `CONCLUDED`
   (ISSUE-228). `ux_promotion_candidates_pending` is already per `target_table`.
2. **`providerMatchId` threads every table**: `staging.source_records.external_record_id`,
   `staging.afl_api_match.provider_match_id`, `matches.source_record_id` (written by ISSUE-228),
   `fixtures.source_record_id` (successor; `UNIQUE (source_id, source_record_id)` already
   exists), `canonical_applications.external_record_id`. No name, date or `match_key` is ever
   used as the primary key for the same real-world match once a provider id has been seen.
3. **Resolver order is provider id → `match_key` → retired-identity search** (§6.1) for
   every `afl_api` target, and it is written source-parametrised in Stage S6 so the successor
   adds a `fixtures` lookup by `(source_id, source_record_id)` without touching the order.
4. **`fixture_key` is minted once** (`randomUUID()`, the 097 rule) on first creation by the
   importer and thereafter found only through `(source_id = afl_api, source_record_id = CD_M)`;
   it is never derived from any field. The `data_overrides` entity key for an imported fixture
   remains `manual_admin_edit:<token>` only for human edits; an importer-owned fixture carries
   no override row unless a human edits it (ISSUE-162 §7 precedence: a manual row is never
   overwritten by the importer).
5. **Round vocabulary is per-season and declared** (`afl_api_<year>`), so a new season is a
   registry addition, never a code change; the successor's season discovery writes proposals
   into the same file.
6. **Hash exclusions and `source_updated_at` are declared per family**, so pre-match churn
   (ticket links, byes, asset URLs) is excluded from the change oracle from day one.

### 13.3 Fixture upserts by `providerMatchId` (successor behaviour)
- First observation with a pre-match status and no `fixtures` row for `(afl_api, CD_M)` →
  `new` → INSERT `fixtures` (status `scheduled`, `source_id = afl_api`, `source_record_id =
  CD_M`, `import_batch_id`, `fixture_key = randomUUID()`), ledger row target `fixtures`.
- Re-observation, unchanged → head touch, no candidate.
- Re-observation with changed date/time/venue/round/clubs while still pre-match →
  `rescheduled` (round/date/time/venue) or `corrected` (clubs) → auto-apply onto the **same
  row** located by provider id, subject to E3 (row owned by `afl_api`), E4 (no active
  `data_overrides` `fixtures` row — a human edit wins, the candidate is queued), E5 baseline.
- Provider says the match no longer exists in the season enumeration → `absent` (review
  signal only; a human may cancel/void through `admin-fixtures.ts`). Never a DELETE.
- Transition to `CONCLUDED` → the match family inserts the `matches` row with the same
  `source_record_id`; the read-time played resolution (097 §18) then reports the fixture
  played; `isFixtureEditAllowed()` locks it. No `fixtures` row is ever mutated by the
  match family and no `match_id` is stored on `fixtures` (ISSUE-162 D-6 preserved).
- Duplicate protection: `fixtures_source_record_uq` + the provider-id-first resolver; a
  manually created fixture for the same real-world match (different `source_id`) is detected
  by `(season, round_code, home, away)` equality and reported as `foreign_owned_collision`
  (candidate for a human to void one), never merged.

### 13.4 Season / fixture discovery (successor behaviour)
`GET aflapi.afl.com.au/afl/v2/competitions/1/compseasons?pageSize=100` (the sample
`00-compseasons.raw.json` exists in both sample sets) → a `discover-seasons` command that
**proposes** additions to `afl-api-identities.json.seasons` (new `{year, compSeasonId,
providerId}`) as a diff for the operator; it never writes `seasons.json` or advances
`in_progress_seasons` (that is the ISSUE-101 rollover's decision). The fixtures administrable
window (`max(seasons.year) ≤ S ≤ max+1`, `admin-fixtures.ts:179-184`) already admits the next
season, so a newly discovered season's SCHEDULED matches can be imported as soon as the
registry entry is approved.

### 13.5 Validation, idempotency and HALT rules for fixture updates (successor behaviour)
- Pre-match (`fixtures` target): the §8 gates 2–4, 10, 12 apply; a change is applied when the
  row is `afl_api`-owned and unlocked; contradictions (two provider ids for one
  `(season, round, home, away)`; a provider id whose clubs change) → candidate + `data_issues`,
  no write.
- **After the match has started** (`status ∈ {LIVE, POSTGAME, CONCLUDED}` observed at least
  once, or a `matches` row exists for the provider id): any change to the historically
  significant fields — `season`, `round_code`/`round_type`, `match_date`, `home_club_id`,
  `away_club_id`, `venue_id` — on the `matches` target is **never auto-applied**; it becomes a
  `corrected` candidate with `agreeing_groups = ['afl_api']` for Super Admin review (this is
  where a rekey of an `afl_api`-owned row happens, deliberately). Scores and period scores may
  still auto-apply as ordinary corrections. Time-of-day corrections on a concluded match are
  treated as historically significant too (they change nothing derived, but silently rewriting
  them is the behaviour the brief forbids).

  > **Annotation 2026-09-22 (ISSUE-244 F021; original text above is frozen and unchanged).**
  > Implemented outcome, ISSUE-244 F010: identity-bearing corrections on an `afl_api`-owned match
  > are **WITHHELD**, not auto-applied. Each withheld correction creates durable `data_issues`
  > evidence (self-healing `…|matches:identity` finding) and is **not** emitted as a `corrected`
  > candidate. `venue_id` and `match_time` are non-identity and may still auto-apply on an
  > `afl_api`-owned row. No rekey and no migration.
- Idempotency: unchanged payload → no version, no candidate; the same snapshot replayed → no
  write, no ledger row (existing property).
- HALT (run-level, §14): provider-identity contradiction; season enumeration shrinking by more
  than a declared tolerance (a partial feed must not sweep half a season absent —
  `--require-complete-source` semantics, ISSUE-128).

---

## 14. Risks and HALT conditions

| # | Risk | Mitigation / HALT |
|---|---|---|
| R1 | Identity bridge coverage too low (debutants, unsettled rows) → most stat rows unresolved | Bridge is measured on `afldb_test` before any DEV apply; publish coverage %; the match family settles regardless; ISSUE-224 remains open for registration. |
| R2 | Two owners for one fact (afltables vs afl_api) → nightly exception noise or, worse, a policy that lets one overwrite the other | §7.5 co-source policy, decided by the operator before S6; E3 never weakened; only the attendance field group crosses owners. |
| R3 | Off-by-one round mapping (Opening Round) | Declared per-season vocabulary + backtest assertion 2 + gate 2 comparing the resolved canonical match's `round_number`. |
| R4 | Team/venue name drift or a new venue id | Map-only resolution; drift refuses; unmapped venue is a warning. |
| R5 | Post-conclusion Champion Data corrections | Spine history + `corrected` candidates; auto-apply only for the owner; exclusion list measured (§9.9). |
| R6 | API change / token mechanism change / rate limiting | Adapter fails closed (no manifest); `known_columns` contract refuses drift; token is public but unofficial — same risk class 077 records. |
| R7 | Rollover doctrine ("fitzRoy full-history supersedes in-season provenance") would collide with `afl_api`-owned 2026 rows | **DECIDED (Q7):** amend `AFLDB-2026-API-ACQUISITION.md` §5 and ISSUE-101/F **before** the 2026 rollover: the completed-season re-acquisition corroborates independently sourced canonical rows (agreement recorded, disagreement → `data_issues`), enriches only through the §7.5 field-group rule, and never re-owns. Any ownership transfer is an explicit rule or operator decision with its own ledger rows. The Stage-9 gate `matches_after_accepted_last_season = 0` is unaffected (in-season rows are never in the historical core). Doc amendment is Stage S8; ISSUE-101/F's own runbook must be updated by that issue, not silently by this one. |
| R8 | `match_time` vocabulary mismatch creates perpetual `corrected` diffs between sources | Exclude `match_time` from cross-source comparison (`CORROBORATED_MATCH_FIELDS` already excludes it); rendering fixed as `HH:MM` by Q5-B (2026-09-22). |
| R9 | Brownlow live-count polling creates version churn | Match-grain records; leaderboard family not promoted; `max-age=3` respected with a ≥ 60 s poll floor. |
| R10 | Fixture successor rekeys a concluded match silently | §13.5 rule: historically significant fields on a started match are review-only. |

**HALT conditions (stop the run, write nothing canonical, exit non-zero, marker
`AFLDB_SETTLE_FAILURE`):** manifest hash mismatch; registry refusal (undeclared column /
season without a round vocabulary → `round_vocabulary_missing`, §6.4); provider-identity
contradiction (§6.1); season enumeration
smaller than the last complete enumeration by > declared tolerance; two canonical rows for one
provider id; bridge file hash mismatch; `data_overrides` CHECK unreadable (existing E4 rule).

---

## 15. Questions the repository and samples cannot answer

1. ~~Ownership policy~~ — **DECIDED 2026-09-19 (Q1): co-source corroboration; no re-ownership.**
2. ~~Attendance enrichment~~ — **DECIDED 2026-09-19 (Q2): approved, field-scoped, never over
   a cited or reviewed value.**
3. Should `career_game_no` be enriched by AFL Tables under a second field-group rule, or left
   to the derived recompute? (Default in this plan: NULL, derived. Q2 approved attendance only;
   adding a group is a new decision.)
4. The exact pre-match `status` strings (`SCHEDULED`? `UPCOMING`? `LIVE`?) — unobserved; must be
   measured live before the fixture successor and recorded as measurements, not enums.
5. ~~`matches.match_time` rendering~~ — **DECIDED 2026-09-22 (Q5-B): canonical `afl_api`
   `match_time` = venue-local `HH:MM`** (NULL = not published; source agreement still compared at
   second precision; non-identity; no historical AFL Tables rewrite, no column typing, no
   cross-source vocabulary migration). Implemented in `afl-api-bundle.ts`; see `issues.md`.
6. Confirm the AFL Tables numbering of 2024/2025 `brownlow_round_votes.round_number` on
   `afldb_test` (Opening Round votes under round 1?).
7. ~~Rollover doctrine amendment~~ — **DECIDED 2026-09-19 (Q7): corroborate, never re-own;
   transfers only by explicit rule/decision.**
8. Is any AFL.com.au terms-of-use constraint on storing Champion Data extended statistics a
   concern? Out of scope by ISSUE-096 exclusion; this plan stores none, but the raw payloads
   in `staging.source_payloads` do retain them.
9. Polling cadence and hosting for the acquisition timer (DEV first; production timer is a
   separate authorisation, as ISSUE-122 S8 was).
10. Whether the standalone monitor can be pointed at the 2026 Brownlow feeds during the count
    (§10, timing).

---

## 16. Implementation stages (dependency order)

| Stage | Deliverable | Depends on | Files (new **N** / modified **M**) | Gate |
|---|---|---|---|---|
| **S0** | This plan approved. Q1/Q2/Q7 **decided 2026-09-19** (§0.1); T1–T4 tightening incorporated | — | `issues/open/AFLDB-ISSUE-228.md` | operator |
| **S1** | Registry (families with **empty** `hash_exclusions`, `co_source_groups`), reference identity maps, per-season explicit round tables, and the **round translation module** `afl-api-rounds.ts` with its refusal table; DB-free contract tests | S0 | **M** `data/reference/source-families.json`; **N** `data/reference/afl-api-identities.json`; **M** `src/lib/acquisition/source-families.ts` (round-table shape + validator rules §6.4); **N** `src/lib/acquisition/afl-api-rounds.ts`; **N** `tests/afl-api-rounds.test.ts`; **M** `tests/reference-data.test.ts` | vitest; §19.7 |
| **S2** | Direct-HTTP acquisition adapter with manifest-last, retry, token handling; DB-free tests with a stubbed fetch | S1 | **N** `tools/current-season/acquire-afl-api.ts`; **N** `src/lib/acquisition/afl-api-client.ts` (pure request planning + response validation, fetch injected); **N** `tests/afl-api-match.test.ts` | vitest |
| **S3** | Bundle emitter (parse → resolve → project → bundle) + backtest harness over the hash-bound samples | S1 | **N** `src/lib/acquisition/afl-api-bundle.ts`; **N** `tools/current-season/emit-afl-api-bundle.ts`; **N** `docs/rebuild-manifests/afl_api/backtest-20260919.json`; **N** `tests/fixtures/afl_api/*` (trimmed); **M** `tests/afl-api-match.test.ts` | backtest §9.1–9.4, 9.8, 9.9 green |
| **S4** | Migration 103 typed projections; source description | S3 | **N** `src/db/migrations/103_afl_api_match_projections.sql`; **M** `tests/afl-api-lineup-migration.test.ts` pattern → **N** `tests/afl-api-match-migration.test.ts` | migrate on `afldb_test` (operator) |
| **S5** | Player provider **bootstrap** bridge (T1): offline builder, validate-only/dry-run/apply loader writing durable `external_identities` (`afl_api_stat_vector_bootstrap`, `unique`, append-only), contradiction `data_issues`, coverage report | S3, S4 | **N** `tools/migration/build_afl_api_player_bridge.py`, **N** `tools/migration/import_afl_api_player_bridge.py` (DraftGuru-bridge pattern, `common.Reporter`); **N** `data/reference/afl-api-player-bridge-<date>.json`; **N** `tests/python/afl_api_bridge_contract.py` | backtest §9.5–9.7 on `afldb_test`; §19.4 |
| **S6** | Source-parametrised settle: `SettleSourceSpec` (source key, families, projection writers, tool name, bundle acquisition kind, **supported bundle contract version**), **record deferral** (bundle v2 `deferral`, no target pass, `recordsDeferred` counters, completeness/report wording — T3), provider-id-first resolver, **co-source corroboration** (Q1: `corroboratedForeignOwned`, never an exception), **attendance field-group enrichment** in `canonical-apply.ts` (Q2 gate §7.5 conditions 1–7, keyed on `attendance_source_id IS NULL`, never on match completion), player resolution from `external_identities` only (T1); CLI `settle-afl-api.ts`; integration tests | S4, S5 | **M** `src/lib/acquisition/settle-afltables.ts` (extract `settle-core.ts`; the AFL Tables spec keeps byte-identical behaviour, proven by the existing suite), **M** `canonical-apply.ts`, **M** `source-completeness.ts`, **M** `settle-report.ts`; **N** `tools/current-season/settle-afl-api.ts`; **M** `package.json` scripts; **N** `tests/integration/settle-afl-api.test.ts` (fixture seasons reserved per the 2073/2084–2099 convention) | existing `settle-afltables.test.ts` unchanged and green; new suite green on `afldb_test`; §19.1–19.6 |
| **S7** | Brownlow families, validator, projection, `settle:afl-api-brownlow`, season artefact builder | S4, S5, S6 | **N** `src/lib/acquisition/afl-api-brownlow.ts`; **N** `tools/current-season/settle-afl-api-brownlow.ts`; **N** `tools/migration/build_brownlow_season_artefact_from_afl_api.py`; tests | backtest §9.10; replay of live-count captures |
| **S8** | Operations: chain script, systemd unit + timer (DEV), admin status second unit, docs (`docs/acquisition/…` §4/§5 amendments **including the Q7 rollover wording**, `docs/deployment.md`), `.env.example` (base URLs only) | S6 | **N** `deploy/afldb-settle-afl-api.sh/.service/.timer`; **M** `settle-status.ts`, `settle-trigger.ts` (unit table, not a second copy); **M** docs | `sh -n`, DEV dry-run |
| **S9** | DEV validation: dry-run → apply on the remaining 2026 matches (Grand Final if timing allows), corroboration of R1–R28 against AFL Tables rows, Brownlow replay | S8 | evidence in this runbook | operator |
| **S10** | Successors: fixture ingestion (§13, ISSUE-229), season discovery, `admin/player-links` `afl_api` adjudication, optional extended stats / umpires / play-by-play families, rollover doctrine amendment (ISSUE-101/F) | S9 | separate issues | — |

> **Annotation 2026-09-23 (closure preparation, §22.21; the table above is unchanged).** S10's
> "separate issues" are: fixture ingestion → AFLDB-ISSUE-229; season discovery and the rollover
> doctrine amendment (ISSUE-101 is Resolved) → AFLDB-ISSUE-233; `admin/player-links` `afl_api`
> adjudication → AFLDB-ISSUE-235; optional extended stats / umpires / play-by-play →
> AFLDB-ISSUE-234. S8's uninstalled timers and admin wiring → AFLDB-ISSUE-232.

Documentation weight: T3 (multi-module, migration) under CLAUDE.md §15; plan review by
`afldb-reviewer` is the first act of any planned launch.

---

## 17. Operational / runbook plan

- **Commands** (`package.json`): `acquire:afl-api -- --season 2026 [--status CONCLUDED] [--since YYYY-MM-DD] [--match CD_M…]`; `emit:afl-api -- --label <label>`; `settle:afl-api -- --label <label> (--dry-run | --apply) [--auto-apply] [--report] [--require-complete-source] [--validate-only]`; `acquire:afl-api-brownlow`, `settle:afl-api-brownlow`; `bridge:afl-api -- --build | --validate-only | --dry-run | --apply`.
- **Dry-run / validate-only**: `--validate-only` = manifest re-hash + registry + bundle
  contract, no connection; `--dry-run` = the full write path rolled back (the §22 pattern);
  `--apply` without `--auto-apply` = observations + projections + candidates only.
- **Retention**: raw snapshots immutable and gitignored; manifests tracked; no pruning in v1
  (~1 MB per match); a pruning policy is a later operator decision.
- **Retry / token**: 3× backoff per request; token re-issued once on 401/403 and at most once
  per run otherwise; token never persisted or logged.
- **Logging**: the existing `[monitor]` block and `AFLDB_SETTLE_SUCCESS/FAILURE` markers;
  counters in `import_batches.validation_result` (ISSUE-128 shape) with source-specific names.
- **Health / status**: `settle-status.ts` gains a unit table `{afltables, afl_api,
  afl_api_brownlow}`; the admin current-season panel shows each unit's last run, completeness
  verdict and the number of pending candidates / unresolved identities.

  > **Annotation 2026-09-22 (ISSUE-244 F021; original text above is frozen and unchanged).**
  > ISSUE-244 F008 now persists the run's counters and terminal `import_batches` state for the
  > AFL API units, so the data the panel would read exists. **Admin-panel wiring for both AFL API
  > units has NOT been done and remains a later follow-up**; the panel does not yet show either
  > unit's last run or completeness verdict.
- **Manual review path**: `promotion_candidates` (pending) + `import_rejections` per batch +
  `data_issues` (`source_disagreement`, `canonical_apply_failed`) — the existing surfaces; the
  human accept path stays unimplemented (a separate issue if wanted).
- **Safe failure**: no manifest → no bundle; contract refusal → no connection; any gate → unit
  refusal in its own savepoint; HALT → whole run rolled back including the batch row.

---

## 18. Test plan (staged)

1. **DB-free parser/adapter** (`tests/afl-api-match.test.ts`): request planning, token flow with
   a stubbed fetch, manifest-last, canonicalisation and exclusions, round mapping, cumulative
   conversion, integrality, external-record encoding, gates 1–10 on trimmed fixtures.
2. **Fixture contract / backtest** (same file, `describe('backtest')`): §9.1–9.4, 9.8, 9.9 over
   the hash-bound local samples, skipping explicitly when absent.
3. **Registry** (`tests/reference-data.test.ts`): new families validate; undeclared column
   refuses; per-season vocabulary required.
4. **Migration** (`tests/afl-api-match-migration.test.ts`): 103 shape, CHECKs, grants.
5. **Test DB integration** (`tests/integration/settle-afl-api.test.ts`): observe → project →
   candidate → auto-apply for a new match; identical rerun no-op; A→B→A three versions;
   POSTGAME withheld then CONCLUDED applied; unresolved debutant leaves the match applied;
   co-source-owned row corroborated not refused; attendance enrichment (if approved); HALT on
   provider contradiction; `--dry-run` leaves every relation byte-identical.
6. **Bridge** (`tests/python/afl_api_bridge_contract.py` + `afldb_test` read-only coverage run).
7. **Brownlow** (`tests/afl-api-brownlow.test.ts` + integration): §10 validation list; replay of
   the live-count captures for idempotency.
8. **DEV**: S9 as above; `sync-dev.ps1`, migration 103 applied, bridge applied, dry-run then
   apply; smoke via `/seasons/2026` after `season-revalidation`.
9. **Live 2026 Grand Final**: useful only if S8 reaches DEV in time; otherwise the GF is
   captured by the monitor and replayed.
10. **Live 2026 Brownlow**: capture-only during the count (§10); replay later.

---

## 19. Acceptance criteria added by the 2026-09-19 amendments

Each criterion names the suite that proves it. A stage is not complete while any of its
criteria is unproven.

### 19.1 Co-source ownership (Q1) — `tests/integration/settle-afl-api.test.ts`, `tests/current-season-import.test.ts`
- (a) An `afltables`-owned 2026 match observed by `afl_api` with equal scores: no canonical
  write, no exception, `corroboratedForeignOwned = 1`, `agreeing_groups` includes `afl_api`,
  `matches.source_id` unchanged.
- (b) Same, with a differing score: no write, one open `source_disagreement` `data_issues` row
  keyed by the settle issue key; a later agreeing poll resolves it (existing lifecycle).
- (c) A match first promoted by `afl_api` is `afl_api`-owned; a subsequent AFL Tables settle
  over the same match performs no ownership change and no write except §19.2.
- (d) DB-free: `autoApplyOwnership()` still returns `refused/foreign_source_owner`; the
  co-source classification is applied by the settle core *after* that verdict and only for
  declared co-source pairs (a non-co-source owner is still an exception).
- (e) No code path can set `matches.source_id` on an existing row inside a settle; a source
  scan of `canonical-apply.ts` for `SET source_id` on `UPDATE` asserts it.

### 19.2 Attendance enrichment (Q2) — `tests/integration/settle-afl-api.test.ts`
- (a) `afl_api` promotes a match with `attendance NULL` and the non-complete
  `attendance_status`; promotion succeeds; the player rows land.
- (b) AFL Tables settle then supplies attendance for that match: exactly one
  `canonical_applications` row (`target_table = matches`, `verb = update`, `new_values` =
  the three attendance fields only), `attendance_source_id = afltables`,
  `matches.source_id` still `afl_api`.
- (b2) **Completion does not freeze the field:** the same as (b) but the AFL Tables
  observation arrives after the match has been CONCLUDED, fully settled (period scores and
  all 46 player rows applied) and corroborated on an earlier run, and after a `corrected`
  score candidate for the same row has been refused as foreign-owned — the attendance
  enrichment still lands, and the refused score candidate is unchanged.
- (b3) **Enrichment never inserts:** an AFL Tables attendance observation for a match with no
  canonical row proposes nothing under the enrichment rule (it is an ordinary `new` match
  proposal under the ordinary path).
- (c) Rerun: no-op.
- (d) With an active `data_overrides` `(matches, key, attendance)` row: refused
  `manual_authority_conflict`, candidate queued, no write.
- (e) With `attendance_source_id` non-NULL (`manual_admin_edit`, `afltables` or any source):
  no automatic write, whatever the value; a differing value is a `corrected` candidate.
- (e2) A 0-crowd enrichment without a citing `attendance_source_id` in the enriching
  projection is refused (`invalid_attendance`); a negative or non-integer value is refused.
- (f) An `afl_api` proposal never carries a non-NULL attendance (projection CHECK in
  `staging.afl_api_match` and a DB-free assertion on `proposedMatchValues`).
- (g) No other field group is enrichable: a DB-free test enumerates `CO_SOURCE_ENRICHMENT`
  and asserts it equals `{ matches: { attendance: [...] } }`; a DB-free test asserts the gate
  function reads `attendance_source_id` and `data_overrides` and **does not** read match
  status, `is_final`, `CONCLUDED`, or any player/period row count.

### 19.3 Rollover corroboration (Q7) — `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5 (S8) + a DB-free assertion
- (a) The rollover row in §5 no longer says "supersede in-season provenance"; it says
  corroborate/enrich per §7.5 and names the explicit-transfer rule.
- (b) `tests/reference-data.test.ts` asserts the registry declares `afltables` and `afl_api`
  as one co-source group and that neither family carries a `supersedes` relation.
- (c) ISSUE-101/F is cross-referenced as the owner of the rollover runbook change (not
  implemented here).
  > **Annotation 2026-09-23 (§22.21).** ISSUE-101 is Resolved. The rollover runbook change is now
  > owned by **AFLDB-ISSUE-233**.

### 19.4 Player bridge is bootstrap-only (T1) — `tests/python/afl_api_bridge_contract.py`, `tests/integration/settle-afl-api.test.ts`
- (a) The loader writes `external_identities` rows with `status = 'unique'`,
  `match_method = 'afl_api_stat_vector_bootstrap'`, and never updates or deletes an existing
  row; a second run over identical evidence is a no-op; a contradicting run withholds and opens
  a `data_issues` row.
- (b) The builder refuses any pair failing §6.3 (a)–(d); names never create a link (fixture:
  same surname, different stat vectors → withheld).
- (c) **AFL Tables absent:** with no AFL Tables snapshot on disk, no `afltables` staging rows
  and no `afltables`-owned `player_match_stats` for the match, a settle over a new
  `afl_api` match resolves every previously bridged `CD_I` and applies their rows.
- (d) An unbridged `CD_I` yields `unresolved_identity` for that player unit only; the match
  unit applies; no `players` row and no `external_identities` row is created.
- (e) A source scan asserts the settle core imports nothing from `import_fitzroy_core`,
  reads no `afltables` projection table, and resolves players solely through
  `refs.playerIdsByProviderId`.

### 19.5 Semantic hashing (T2) — `tests/afl-api-match.test.ts`, `tests/reference-data.test.ts`
- (a) Every ISSUE-228 family ships with `hash_exclusions: []`.
- (b) Two byte-different serialisations of the same parsed object (pretty vs compact; `9.0`
  vs `9`) produce one `payload_hash`.
- (c) The Hawthorn 10:29 / 21:41 pair produces `unchanged` with no exclusions (or the test
  prints the differing paths and fails until they are recorded as evidence — never until an
  exclusion is added).
- (d) Registry validator: an `afl_api` family exclusion without a matching `evidence[]` entry
  citing ≥ 3 pairs and a fixture path refuses; a fixture path that does not exist refuses.
- (e) For each exclusion that is ever added: a regression test asserts `unchanged` with it and
  `version_inserted` without it, using the recorded fixture pair.

### 19.6 POSTGAME deferral (T3) — `tests/afl-api-match.test.ts`, `tests/integration/settle-afl-api.test.ts`
- (a) A `POSTGAME` fixture record emits `deferral: {reason: 'status_not_concluded'}`,
  `projection: null`, `rejection: null`; the bundle validates under contract v2; contract v1
  (AFL Tables) refuses a `deferral` key.
- (b) Settle: the record is persisted to the spine, no projection row, no `promotion_candidates`
  row, no `import_rejections` row, `recordsDeferred.status_not_concluded = 1`,
  `snapshotRejections` unchanged, completeness `complete`, exit 0.
- (c) The same match re-observed as `CONCLUDED`: one new spine version, projection written,
  applied; the earlier deferral leaves no exception history.
- (d) Re-poll of an unchanged `POSTGAME` payload: `head_refreshed`, no version.
- (e) `--report` lists deferred records under "Not yet concluded", not under exceptions;
  `settle-status.ts` shows the count as informational.
- (f) A `CONCLUDED` match with a real gate failure is still a rejection/refusal and still turns
  `--require-complete-source` red (the distinction must not swallow genuine failures).

### 19.7 Round translation (T4) — `tests/afl-api-rounds.test.ts`, `tests/reference-data.test.ts`
- (a) 2026 table: `OR/0 → ('1', 1, home_and_away)`; `Round 24/24 → ('25', 25)`;
  `WF/25 → ('WF', NULL, wildcard_final)`; `QE/26` + "First Qualifying Final" → `QF`,
  + "Second Elimination Final" → `EF`; `SF/27`, `PF/28`, `GF/29`.
- (b) 2022 table: `Round 1/1 → ('1', 1)` (no Opening Round); finals week 1 without a label →
  `finals_label_required`.
- (c) Season with no vocabulary → the emitter HALTs before writing a bundle
  (`round_vocabulary_missing`); no DB connection is opened.
- (d) `api_round_number` outside the table → `round_unmapped` record rejection; the record is
  present in the enumeration; completeness reports `rejected_records`.
- (e) Declared name/abbreviation drift → `round_vocabulary_drift`.
- (f) Source scan: no file other than `afl-api-rounds.ts` contains `roundNumber + 1`,
  `roundNumber+1` or an equivalent offset applied to an AFL round; the Brownlow emitter and
  the match emitter both import `translateAflRound`.
- (g) Registry validator refuses a vocabulary with non-contiguous canonical H&A numbers,
  duplicate `api_round_number`, or a `mixed_finals` row without `finals_label_rules`.
- (h) Backtest: all 14 sample matches translate to the folder's canonical round (with the
  documented 2022–2024 finals-label limitation asserted as a refusal, not a guess).

---

# 20. Decision D-9b — the S9 acceptance-snapshot contract (RESOLVED 2026-09-22, option **B**)

> **Boundary.** Everything in this section was established by read-only, offline, hash-verified
> inspection. No SQL, no network, no acquisition, no settle, no Git mutation. No historical
> byte-bound evidence file was modified.

## 20.1 The problem, stated exactly

ISSUE-228 named `afl-api-2026-2026-09-21-011148` (manifest sha256 `dcbd0626…`) as the authoritative
S9 acceptance snapshot. **Its bytes are absent from every local root.** The only 2026 AFL API match
snapshot present anywhere is `afl-api-2026-2026-09-21-031725` (manifest sha256 `5018a3d6…`), which
is also the snapshot the ISSUE-224 92-row target set was actually re-derived against.

These are **not** the same snapshot and were never treated as such. `dcbd0626… ≠ 5018a3d6…`.

## 20.2 What was measured about the retained snapshot

`D:\dev\afldb\data\sources\afl_api\matches\afl-api-2026-2026-09-21-031725\` — read-only:

| Check | Result |
|---|---|
| `manifest.json` sha256 | `5018a3d6e68329170836fb84520e6b4181124bf2807e1c2f0cb9708660de0b62` ✓ equals the recorded value |
| Manifested files present and byte-exact | **652 / 652**, 0 missing, 0 hash mismatches |
| Files on disk absent from the manifest | 1 — `token.meta.json` (acquisition auth metadata, not source evidence, outside the manifest's authority) |
| `contract_version` / `source_key` / `acquisition_kind` | `1` / `afl_api` / `afl_api_match_snapshot` |
| `selection` | `{status: CONCLUDED, since: null, match: null}` |
| `season` / `comp_season_id` / `fixtures_only` | `2026` / `85` / `false` |
| `counts` | `matches_in_feed 218`, `matches_selected 217` |
| `acquired_at` | `2026-09-21T03:18:00.610Z` (≈2 h 07 m after `-011148`, same day, same selection contract) |

## 20.3 Substantive equivalence, re-derived rather than assumed

The accepted bridge artefact `data/reference/afl-api-player-bridge-2026-full-2026-09-21.json`
(sha256 `845a78d2…`) was built **against `-011148`** and retains that snapshot's derived census at
row grain: `matches_processed` (217 entries) and `providers` (669 entries, each carrying
`snapshot_row_count`, `observed_name`, and its per-match `matches` / `unmatched` lists). That
retained census is a usable fingerprint of the lost bytes. Every one of the following was recomputed
from `-031725`'s hash-verified bytes and compared against it:

| Axis | `-011148` (from the bridge artefact) | `-031725` (measured) | Result |
|---|---|---|---|
| Match set (`provider_match_id`) | 217 | 217 | **set-identical** — 0 only-in-bridge, 0 only-in-snapshot |
| Distinct provider players | 669 | 669 | **set-identical** — 0 either way (`sha256(sorted) = e9f47dc9…`) |
| Player-match rows | 9,983 | 9,983 | equal |
| Per-provider `snapshot_row_count` | 669 values | 669 values | **0 mismatches** |
| Per-provider `observed_name` | 669 values | 669 values | **0 mismatches** |
| Per-`(provider, match)` pair membership | 9,983 pairs | 9,983 pairs | **all 669 providers' claimed set == retained appearance set EXACTLY**; 0 claimed ids absent |
| The single `extendedStats: null` anomaly | `CD_M20260140305`, `homeTeamPlayerStats`, index 23, provider `CD_I993799` | **same match, same side, same index, same provider** | identical |
| `player_match_stats` column contract, at the per-entry grain `afl-api-bundle.ts:478-492` uses | 85 declared | **85 observed** | **0 undeclared, 0 declared-but-unobserved, 0 required-not-observed** |
| `match` (fixture) column contract | 70 declared | 67 observed | **0 undeclared** (3 declared-but-unobserved: `metadata.k2k_link`, `round.utcStartTime`, `round.utcEndTime`) |

**Source drift between the two acquisitions is zero on every axis that can be measured offline.**

### 20.3.1 What is NOT proven, stated plainly

The **stat values** were not independently verified. Each `agreeing_stat_count` is a function of the
snapshot *and* of canonical `player_match_stats` in `afldb_dev`, and no database was read (§9). So
identity-surface equivalence is proven to row grain; **stat-vector value equivalence is not**. This
is not a gap left open: re-deriving exactly those values against the authoritative snapshot is the
bridge rebuild that option B requires, so the unproven axis is the one the chosen route recomputes.

Two false leads were chased and discarded rather than recorded as findings, noted so a later pass
does not re-raise them:

- A `metadata` path appeared undeclared on the `match` family. It is **not**: `metadata: {}` on
  `CD_M20260141206` is an **empty** object, and `flattenObservedColumns()`
  (`src/lib/acquisition/afl-api-bundle.ts:86-105`) contributes **no path at all** for an empty
  record — only a **`null`** object becomes a leaf at its own path. Confirmed against
  `src/lib/acquisition/source-families.ts:772`. There is no undeclared-column exposure here.
- The `match_roster` family appeared to carry ~180 undeclared paths. It does not: that family is
  declared at the **inner `matchRoster` grain**, not the file-envelope grain, so an envelope-rooted
  comparison is not tool-faithful. Its `known_columns_status` is in any case already declared
  `incomplete`. **Not re-checked faithfully here** — it is not read by the bridge and is not part of
  the D-9b question.

## 20.4 The three options, each on its merits

| | **A — block until `-011148` bytes are recovered** | **B — supersede with retained `-031725`** | **C — acquire a fresh snapshot** |
|---|---|---|---|
| **Reproducibility** | **Nil today.** Nothing local can reproduce it; a recovery would itself need verification against `dcbd0626…` | **Full.** 652/652 files byte-exact against a manifest whose own hash matches the record | Full once acquired, but the acceptance snapshot then changes again on every re-acquisition |
| **Evidence already available** | The bridge's derived census only; **no bytes** | Bytes + manifest + the whole §20.3 equivalence table | **None** until the fetch runs |
| **All 669 providers re-resolved?** | No, if the exact bytes return | **Yes** | **Yes** |
| **Can the 577 imported links stand as acceptance evidence?** | Only if the exact bytes return | **No** | **No** |
| **Does the 92-row target set stay directly applicable?** | Unclear — it was built on `-031725`, so under A it would need rebuilding on recovered bytes | **Yes, directly** — it was already built and hash-verified against `-031725` | **No** — it would need rebuilding against the new snapshot |
| **Source drift risk** | None introduced, but the block is **indefinite** | **None measurable** (§20.3) | **Real and unbounded.** 2026 is complete, but a later fetch can carry corrected stats, revised statuses, renumbered providers or new columns — every one of which invalidates prior evidence |
| **Additional work** | Locate bytes on the DEV host or elsewhere; verify; then rebuild anyway if not found | Rebuild the bridge on `-031725`; re-point the record | Network acquisition (**forbidden this pass**); full rebuild; re-derive the target set; re-validate the column contract |
| **Effect on S9 acceptance** | **Indefinitely blocked** on a source that may not exist | S9 proceeds on a hash-verifiable, drift-free snapshot | S9 proceeds, but on bytes with no equivalence evidence and a fresh drift surface |

**A is rejected** because it makes acceptance depend on bytes that a whole-drive read-only search
could not find, with no evidence they exist anywhere and no bound on the wait.

**C is rejected** because it is *strictly worse than B on the axis that matters*: it discards a
retained snapshot already proven drift-free against the accepted evidence and replaces it with bytes
carrying no equivalence evidence at all, while also invalidating the 92-row target set. C is more
expensive **and** weaker. Cost is not why it loses.

## 20.5 Decision

> **D-9b — RESOLVED 2026-09-22, option B.** `afl-api-2026-2026-09-21-011148` is **formally
> superseded** as the ISSUE-228 S9 acceptance snapshot by the retained, immutable, hash-verified
> `afl-api-2026-2026-09-21-031725` (manifest sha256
> `5018a3d6e68329170836fb84520e6b4181124bf2807e1c2f0cb9708660de0b62`). No acceptance claim may
> depend on `-011148`'s unavailable bytes.

The independent verification asked for was performed and **found no source-contract difference that
makes B unsafe** (§20.2, §20.3). `-011148` is **not** deleted or rewritten: its label, manifest hash
`dcbd0626…` and the 577-link bridge built on it are retained as lineage, and every statement above
about it is sourced from the retained bridge artefact.

### 20.5.1 The no-mixing rule this creates

**S9's accepted bridge MUST be one coherent population built in a single run against `-031725`.**
It is explicitly forbidden to combine:

- the **577** links imported to DEV from the `-011148`-built bridge, with
- the **92** links that ISSUE-224 registration will newly resolve.

**All 669 providers must be re-resolved.** This is not merely bookkeeping — three independent
reasons each force it on their own:

1. **Snapshot coherence.** The accepted artefact must pin `-031725` in its own
   `snapshot_label` / `snapshot_manifest_sha256`. The current one pins `-011148`.
2. **Changed canonical substrate.** The bridge is built *from the database*
   (`built_from_database: afldb_dev`). D-8 step 1 registers 92 players and step 2 settles AFL Tables
   2026, creating new canonical `player_match_stats`. Every provider's resolution is computed against
   that substrate, so the 577 must be re-derived on the post-registration state, not carried over.
3. **Pre-ISSUE-244 lineage.** The 577 links and the `unresolvedIdentityPlayer 830` dry-run both
   predate the ISSUE-244 hardening and were already recorded as **not** current acceptance evidence.

Accordingly the **577 imported links are NOT acceptance evidence** and are retained as lineage only.
The **92-row target set remains directly applicable and needs no rebuild**: it was built against
`-031725` and hash-verifies (`e087baf7…`, `rows_sha256 75bd9576…`).

## 20.6 What D-9b does and does not authorise

D-9b settles **which snapshot is authoritative**. It authorises **no execution**: no acquisition, no
bridge rebuild, no import, no settle, no database write. The AFL Tables timer remains **OFF on both
DEV and PROD** and neither is to be enabled.

**S9 is NOT accepted. DEV is NOT claimed deployed. ISSUE-224 is NOT complete.**

## 20.7 Companion decisions recorded the same day (owned by ISSUE-224)

- **D-7 — APPROVED 2026-09-22.** The 92 Category A players are authorised registration candidates.
  New immutable artefact
  `docs/rebuild-manifests/draftguru/issue224-d7-registration-decision-20260922.json`
  (sha256 `a795c987ca62cf879cb2ecc3bb61d9e1533eae84882956c442ff252de307be3d`,
  `rows_sha256 0a3d13387352c610782330058c889456c3f3ca57ab1143aee88766144711e083`). The 2026-09-19
  Phase 3 verdict artefact is retained **unchanged**. D-7 authorises no database write.
- **D-8 — APPROVED 2026-09-22, sequence only.** See ISSUE-224 §16.2. Steps 3–5 of that sequence
  (bridge rebuild, link import, AFL API settle with `--require-complete-source`) are ISSUE-228's and
  must run against `-031725` per §20.5.

## 21. D-8 step 2 complete; D-8 step 3 runbook established (2026-09-22, cross-referenced from
ISSUE-224 — owned there, recorded here only as a pointer)

**D-8 step 2 (DEV AFL Tables settle for the 92 registered players) is COMPLETE** — 827 canonical
`player_match_stats` rows now exist for player ids 13370–13461. **D-8 step 3 (this issue's: rebuild
the AFL API stat-vector bridge)** has an established, unrun runbook: tool
`tools/current-season/emit-afl-api-player-bridge.ts`, `--label afl-api-2026-2026-09-21-031725`,
read-only against `afldb_dev`. A HALT was found — the ISSUE-224 worktree lacks the `-031725`
snapshot bytes locally and must run this step from the main checkout or via a junction. Full detail:
`issues/open/AFLDB-ISSUE-224.md` §20. **Neither step 3, 4 nor 5 has run. S9 remains NOT accepted.**

## 22. D-8 steps 3–5 now evidenced; a canonical `afl_api` apply and idempotence replay reported
(2026-09-23, Sonnet 5 — documentation reconciliation only; no database connection, no shell/Git
command, no code change)

**Boundary up front.** This pass read repository files only (including the untracked bridge
artefact below, in full) and wrote documentation only. No database was connected to, no settle or
import was run, nothing was committed. Two categories of evidence are kept explicitly distinct:
**independently confirmed** (Claude read the artefact itself, this pass) and **operator-reported**
(transcribed from the operator's own session, not reproduced).

### 22.1 D-8 step 3 (bridge rebuild) — INDEPENDENTLY CONFIRMED

Claude read `data/reference/afl-api-player-bridge-2026-full-2026-09-22.json` (untracked; present in
the worktree, not committed) directly. Its `counts` block:

```
providersLinked: 669          providersUnresolved: 0
canonicalMatchesResolved: 215  canonicalMatchesUnresolved: 2
playerMatchRowsCoveredByLinkedProviders: 9983   playerMatchRowsUncovered: 0
providersContradictory: 0     matchesEvaluated: 217
```

`built_from_database: "afldb_dev"`; `generated_utc: 2026-09-22T11:12:51.201Z`. These figures are an
**exact match** to `issues/open/AFLDB-ISSUE-224.md` §21.2's "Expected post-correction bridge
movement" table (`PROVIDERS_LINKED` 667→**669**, `PROVIDERS_UNRESOLVED` 2→**0**,
`PLAYER_MATCH_ROWS_UNCOVERED` 12→**0**, `CANONICAL_MATCHES_UNRESOLVED` unchanged at **2**, correctly
— it is a match-identity question, unrelated to the surname fix). This is strong evidence that:

1. the two-row canonical name-split correction (Alex Van Wyk id 13382, Hussien El Achkar id 13422 —
   ISSUE-224 §21) was applied to `afldb_dev` through the sanctioned `/admin/data-editor` path;
2. `tools/current-season/emit-afl-api-player-bridge.ts` was re-run against `afldb_dev` on snapshot
   `afl-api-2026-2026-09-21-031725` and resolved **all 669 providers**, i.e. ISSUE-224's
   registration/linkage prerequisite for ISSUE-228 Route A is now met.

**Not confirmed by this artefact alone:** whether the correction went through the editor
specifically (vs. some other path) — only that the canonical `given_name`/`surname` the bridge
builder read from `players` now agree with both providers' observed surnames. The artefact's own
`existing_artefact_overlap` field is `null` (no `--compare-artefact` overlap was captured in this
build), so it does not on its own prove the subsequent DEV import (§22.2) drew from this exact file
rather than a re-run producing the same figures.

### 22.2 D-8 steps 4–5 and the S9 canonical apply/replay — OPERATOR-REPORTED, NOT REPRODUCED

The operator reports, for `afldb_dev`, snapshot `afl-api-2026-2026-09-21-031725` (217 matches, 9,983
player-match rows, 10,417 observations, 0 build failures, source completeness COMPLETE):

- **Batch 111 (initial canonical apply):** `matches` insert 2, `match_period_scores` insert 2 (16
  physical rows), `player_match_stats` insert 93; open finding `foreign_source_owner` warning ×36.
- **Batch 113 (identical-snapshot replay, `--apply --auto-apply --require-complete-source`):**
  `observationsSeen 10417`, `payloadsCreated 0`, `versionsAppended 0`, `unresolvedIdentityMatch 0`,
  `unresolvedIdentityPlayer 0`, `corroboratedForeignOwned 215`, `sourceDisagreement 0`,
  `canonicalRowsInserted/Updated 0`, `canonicalApplicationsLogged 0`, `canonicalApplyRefusals 36`
  (same `foreign_source_owner` class), `canonicalApplyFailures 0`, exit code 0. A separate read-only
  query confirmed zero new `canonical_applications` rows and zero new canonical rows stamped by
  batch 113, with the same 36 open `foreign_source_owner` findings.

**Reconciliation.** `unresolvedIdentityPlayer 0` in both runs is consistent with §22.1's confirmed
669/0 bridge coverage — 215 corroborated + 2 `afl_api`-owned matches accounts for all 217 evaluated
matches, and the 93 `player_match_stats` rows inserted in batch 111 are of a piece with the 2
newly-owned matches. The 36 `foreign_source_owner` refusals are **expected safety behaviour**
per `AFLDB-ISSUE-228.md` §19.1(a)/(d): an `afltables`-owned row that `afl_api` also observes is
corroborated, not overwritten. **They are not weakened or bypassed by this pass and must not be
treated as a defect to fix.**

### 22.3 What this does and does not establish about S9 acceptance

**Established (Route A completeness, §"Addendum"/§4 of the `issues.md` reconciliation):** the same
immutable snapshot (`-031725`) now settles with `unresolvedIdentityPlayer = 0` and reports source
completeness COMPLETE — the literal Route A condition. Combined with §22.1's independent
confirmation of the 669-provider bridge, this is the strongest evidence to date that ISSUE-224's
registration/linkage prerequisite is satisfied and that the canonical apply exercised the
production-intended `--require-complete-source` guarded path (not a weakened one).

**NOT established — S9 is NOT accepted:**

1. **Brownlow replay / Assertion 9 (§9.9)** — the S9 stage-table row (§16) requires a Brownlow
   replay as part of S9 itself; the live-count capture/replay evidence (S7) remains open per every
   prior entry in this document and `issues.md`. Nothing in this pass or the operator's report
   touches Brownlow.
2. **DEV smoke** — *superseded 2026-09-23, see §22.9:* test plan item 8 (§18) calls for a smoke
   check via `/seasons/2026` after `season-revalidation`. Now evidenced (reading 2, operator-
   executed, byte-verified rollback).
3. **D-8 step 4 (the `external_identities` import)** — *superseded 2026-09-23, see §22.6:* an
   operator-run, direct read of `external_identities` now exists (new diagnostic
   `tools/current-season/audit-afl-api-player-bridge-persisted.ts`). It is operator-reported, not
   reproduced by Claude this pass.
4. **"One coherent population" (D-9b, top-of-file bullet 1)** — *superseded 2026-09-23, see §22.6:*
   the same operator-run audit directly compares every persisted `afl_api` `external_identities`
   row against the current `-031725` bridge artefact and reports zero stale/mismatched rows and
   zero unexpected rows, closing this gap on operator-reported evidence.
5. **DEV deployed SHA** is still unmeasured (top-of-file bullet 5) — not addressed by this pass.
6. **The bridge artefact is uncommitted** (`data/reference/afl-api-player-bridge-2026-full-2026-09-22.json`
   is untracked). Per §16's S5 stage table this artefact type is meant to be tracked
   (`data/reference/afl-api-player-bridge-<date>.json`, **N**ew file).

**ISSUE-224 is not complete. ISSUE-228 S9 is not accepted. DEV is not claimed fully deployed or
smoke-tested. The 36 `foreign_source_owner` refusals remain correct, expected behaviour.**

### 22.4 Recommended next steps, in order

All of the following are **read-only or operator-executed**; none is an irreversible or canonical
database write, per this pass's boundary.

1. ~~Independent confirmation of D-8 steps 3–4 via `emit:afl-api-player-bridge --validate-only`~~ —
   **superseded, see §22.6**: a more direct check (reading `external_identities` itself, not just
   re-deriving the bridge) was run instead and closes this gap on operator-reported evidence.
2. ~~**DEV smoke**, per test plan item 8~~ — **CLOSED 2026-09-23, see §22.9.** Reading 2 executed;
   the two newly-canonical 2026 matches (batch 111 Preliminary Finals) confirmed rendering on an
   authenticated fresh `/seasons/2026` fetch after a proven 4/4-worker revalidation; DEV restored
   byte-identically afterward.
3. **Brownlow replay / Assertion 9** — this is the standing S7 blocker, unchanged by today's DEV
   smoke evidence; investigated in full at §22.10. Both halves (the live-count replay and the
   §9.9 semantic-hash evidence) remain unmet on current repository/worktree evidence; its closeout
   path is already on record in `issues.md` ("Assertion 9 closeout path").
4. Once 2–3 are evidenced, **commit** the bridge artefact and this documentation update
   (operator-run, per CLAUDE.md §12), then re-assess S9 acceptance as a whole against §19's full
   acceptance-criteria list (not reproduced here in full — only §19.1 was checked against this
   evidence).

### 22.5 Files changed (this pass)

`issues/open/AFLDB-ISSUE-228.md` (M — this section and the top-of-file addendum), `IssuesIndex.md`
(M — ISSUE-228 and ISSUE-224 entries), `issues.md` (M — matching ledger entry). No code, test,
migration, `package.json`, deploy file, or `CHANGELOG.md` change — no application behaviour changed
this pass.

### 22.6 D-8 step 4 — persisted `external_identities` directly audited (2026-09-23, operator-run,
new diagnostic, reported not reproduced)

The operator ran a new read-only diagnostic against live `afldb_dev` (`afldb_app` role, proven
`transaction_read_only = on`), authored this pass:
`tools/current-season/audit-afl-api-player-bridge-persisted.ts`. Unlike
`emit-afl-api-player-bridge.ts` (which re-derives what the bridge *should* resolve to from
canonical state and never reads `external_identities`), this tool reads the **persisted**
`external_identities` rows for the `afl_api` source directly and diffs them against the
`-031725` artefact's declared `linked` population — closing exactly the gap §22.1 flagged as
unconfirmed (whether the table holds one coherent 669-provider population or a mix including
stale `player_id` values left behind by the superseded `-011148`/577-provider lineage, per the
importer's append-only, never-`UPDATE` contract).

Operator-reported result (command:
`npx tsx tools/current-season/audit-afl-api-player-bridge-persisted.ts --artefact data/reference/afl-api-player-bridge-2026-full-2026-09-22.json`):

```
Expected AFL API provider population:       669
Persisted AFL API provider identities:      669
Distinct AFL API provider IDs:              669
Providers linked to a canonical player:     669
Providers with no canonical player:           0
Provider IDs linked to >1 player:             0
Unexpected/stale AFL API provider IDs:        0
Artefact-linked providers missing from DB:    0
Open data_issues (afl_api_identity_contradiction): 0
```

`import_batches` targeting `external_identities` for `afl_api`: batch 102 (read 577, inserted 577
— the original bootstrap population), batch 106 (read 669, inserted 92 — the D-8 step 4 addition
that brings the population to 669), batches 107 and 108 (read 669, inserted 0 — re-run
idempotence). The 577 (batch 102) + 92 (batch 106) = 669 arithmetic is exact and consistent with
every other count in this section. Both named split-name cases (Alex Van Wyk `CD_I1019944` →
player 13382; Hussien El Achkar `CD_I1030308` → player 13422, ISSUE-224 §21) report
`status=unique` and PASS against their expected `player_id`.

**Status: operator-reported, not independently reproduced by Claude this pass** (Claude authored
the diagnostic and read its source; the operator executed it and pasted the console output — no
database connection was opened by Claude, per CLAUDE.md §9). It is materially stronger evidence
than §22.2's inference from settle counters alone, because it reads the target table directly
rather than inferring its state from `unresolvedIdentityPlayer = 0`. On this evidence, gaps
22.3(3) and 22.3(4) are closed pending independent reproduction; nothing in this pass changes
22.3(1) (Brownlow), 22.3(2) (DEV smoke), or 22.3(5)/(6) (deployed SHA, uncommitted artefact).

**Keep the diagnostic.** `tools/current-season/audit-afl-api-player-bridge-persisted.ts` is
retained regardless of the passing result — it is the only tool that proves `external_identities`
state directly rather than inferring it, and D-9b-shaped questions will recur.

### 22.7 DEV smoke (§18 item 8) — an architectural gap found while scoping it, not yet run

Before writing a smoke procedure, `revalidateSeason` (`src/lib/acquisition/season-revalidation.ts`)
was traced to its callers: it is invoked only from `tools/current-season/settle-afltables.ts` (the
AFL Tables nightly settle) and `src/app/admin/brownlow/actions.ts` (the admin Brownlow finalise/
correct/void/publish actions). **`tools/current-season/settle-afl-api.ts` — the tool that ran
batches 111/113 — does not call `revalidateSeason` at all.** `/seasons/[year]/page.tsx` sets
`export const revalidate = 3600`, so unlike the AFL Tables nightly settle path (which pushes an
on-commit invalidation per `docs/deployment.md` §"nightly in-season settle"), a canonical AFL API
apply does **not** force early regeneration of `/seasons/2026` — the ISR entry only refreshes
naturally, on the next request after up to a 1-hour-stale window from whenever it last rendered.

This means §18 item 8's literal phrase "smoke via `/seasons/2026` after `season-revalidation`"
does not describe what the current AFL API settle path actually does, and a smoke run before the
natural ISR window elapses (or before a manual revalidation) risks a false negative — an unchanged
page that reflects stale pre-apply state, not a failed apply. This is a discrepancy worth a
decision, not yet a filed issue: **flagged to the operator in this pass's report; not opened as a
tracked issue, since scope here is the S9 smoke procedure, not an ISSUE-228 code change.**

### 22.8 DEV revalidation blocker — root-caused, and the `settle-afl-api.ts` gap resolved to a
scope decision (2026-09-23, Sonnet 5 — documentation and scope determination only; no `.env` edit,
no service restart, no deployment, no DB write, no cache invalidation, no Git mutation)

**Trigger.** Operator-run, read-only DEV inspection (systemd `ExecStart`/`EnvironmentFile`,
process-environment presence checks) proved `AFLDB_REVALIDATE_URL` and `AFLDB_REVALIDATE_SECRET`
are **both absent** from `/home/arm/projects/afldb/.env` and from the running `afldb.service`
process environment, and that `src/app/api/internal/revalidate-season/route.ts:103-109` fail-closes
503 without them (as designed). This pass root-causes that absence and resolves the second,
separately-flagged §22.7 gap to a scope decision, using repository evidence only.

**A. The two environment variables — exact contract (`src/lib/acquisition/season-revalidation.ts:48-51,175-220`,
`docs/deployment.md:958-976,1184-1185`).** Both are **optional** and **both-or-neither**
(`readRevalidateConfig()` throws if exactly one is set); `AFLDB_REVALIDATE_URL` must resolve to
loopback (`127.0.0.1`/`::1`/`localhost`) or the config is refused. `docs/deployment.md:950-952`
states the contract in prose: *"Two host steps, and until both are done the settle is inert — it
runs and commits exactly as before, and the page falls back to expiring on its own."* This is a
deliberate fail-closed, per-host, opt-in design (`AFLDB-ISSUE-134`), not a two-phase rollout with
an implied "phase 2: make it permanent."

**Absence on DEV is NOT a regression against ISSUE-134's completed contract.** `issues/closed/
AFLDB-ISSUE-134.md` §10.1/§10.5 and §12.1/§12.8 show DEV (`streamanator`) was given the two
variables **twice**, both times as an explicit, time-boxed acceptance-test window, and both times
the `.env` was **restored from a pre-change backup afterward by design**: §10.5 — *"the acceptance
secret existed only on dev, only for this window, and is gone"*; §12.8 — identical wording, same
outcome, after the successful second acceptance run. Neither the runbook nor `CHANGELOG.md:3698-3732`
nor any later issue records a step that installed the two variables on DEV **permanently**. The
current absence is therefore the unchanged, expected post-ISSUE-134 state, not drift: **it is an
operator/deployment configuration step that has never been performed on DEV**, distinct from a
regression (nothing that once worked stopped working) and distinct from unimplemented code (the
route and the settle-side coverage loop are both complete and were proven correct on this exact
host in ISSUE-134 §12). It belongs inside ISSUE-228 because §18 item 8 — this issue's own S9 DEV
test-plan item — is the first place a permanent DEV installation of these two variables is
actually needed; no successor issue is warranted for a configuration step this issue's own test
plan already calls for.

**B. `settle-afl-api.ts`'s missing `revalidateSeason()` call — deliberate S8 scope decision, not
an oversight, and in tension with §18 item 8's wording.** `deploy/afldb-settle-afl-api.service:44-48`
carries a contemporaneous S8 comment: *"This unit reads no revalidation secret (season-page ISR
invalidation is the AFL Tables settle's own concern; this pass adds none for afl_api)"* — and
correspondingly lists `AFLDB_REVALIDATE_SECRET` in that unit's own `UnsetEnvironment=` (line 50).
`tools/current-season/settle-afl-api.ts` confirms this in code: unlike `tools/current-season/
settle-afltables.ts` (`SettleCliDeps.env`/`.revalidate`, `SettleCliOutcome.revalidation`,
`maybeRevalidate()` at lines 296-328, called post-commit at line 437), `AflApiSettleCliDeps`
(`settle-afl-api.ts:181`) and `AflApiSettleCliOutcome` carry no equivalent fields, and no call
site references `revalidateSeason`, `maybeRevalidate`, or `shouldRevalidateSeason` anywhere in the
file (confirmed by search — no matches). This is a **documented, considered S8 design choice**,
not a regression and not an accidental gap.

It sits in real tension with §18 item 8's own text — *"smoke via `/seasons/2026` after
`season-revalidation`"* — written at S0 plan time (2026-09-19), before S8's implementation-time
decision to scope revalidation out of the afl_api path. Neither section was amended to reconcile
the other; this pass does not resolve that tension by architectural preference (per instruction),
but narrows it to the two literal readings:

1. **Literal:** the *afl_api settle itself* must trigger `revalidateSeason()` — requires a code
   change to `settle-afl-api.ts`, reversing S8's documented decision.
2. **Loose:** the S9 DEV smoke step requires `/seasons/2026` to be checked **after a
   season-revalidation event of some kind has occurred** — satisfiable with **no code change**,
   by issuing the existing manual revalidation call (`docs/deployment.md`'s tracked `curl` command
   against `/api/internal/revalidate-season`, already used as the ISSUE-134 §9.3/§12.2 acceptance
   probe) once DEV is configured per (A), immediately after the `--apply` run.

Reading 2 is the smaller, non-regressive change and is consistent with S8's explicit, still-standing
design note; reading 1 would silently reverse a decision that was made deliberately and on the
record. **This pass recommends reading 2 as the minimum path to close §18 item 8, and treats
reading 1 (permanent `settle-afl-api.ts` wiring, for unattended future in-season afl_api settles)
as a genuine but separate follow-up — not a new issue number, but a named item under this issue's
own §16 S10 "successors" bucket, since it extends rather than blocks S9 acceptance.** This is a
scope-ownership determination, not an implementation; the operator may instead choose reading 1 and
have it implemented before S9 proceeds — that is an operator call, not a default this pass takes.

**C. Minimum remediation, separated.**

| # | Action | Type | Blocks S9? | Performed this pass? |
|---|---|---|---|---|
| 1 | Set `AFLDB_REVALIDATE_URL=http://127.0.0.1:<dev-app-port>` and `AFLDB_REVALIDATE_SECRET=<openssl rand -hex 32, generated ON the host>` in DEV `.env`, **permanently** (not a test window); restart `afldb.service` | Operator `.env` edit + service restart | **Yes** | No — outside this pass's authorised actions |
| 2 | Verify per `docs/deployment.md` §7c's tracked `curl` probe | Operator, read-only-to-app | Confirms (1) | No |
| 3 | After the S9 `--apply` run, issue one manual `curl -X POST .../revalidate-season -d '{"season":2026}'` before checking `/seasons/2026` | Operator, one-off | Satisfies §18 item 8 under reading 2 | No |
| 4 | Wire `revalidateSeason()` into `settle-afl-api.ts` (mirroring `settle-afltables.ts`'s `SettleCliDeps.env`/`.revalidate`/`maybeRevalidate()`/post-commit call shape, at the same point immediately after `buildSettleExceptionReport()` and before the final `return` in `runAflApiSettleCli()`, gated the same way on `canonicalRowsInserted + canonicalRowsUpdated + canonicalApplicationsLogged > 0`) | Code change | **No**, under reading 2 — optional, operator's call | Not implemented; not approved |

No secret was generated, rotated, printed, or installed by this pass. **D is not applicable**: no
other documented mechanism satisfies §18 item 8 without either (1)+(3) or (4).

**D. Issue tracking.** Both findings stay inside **AFLDB-ISSUE-228** — the config gap because §18
item 8 (this issue's own S9 test plan) is what first needs it, and the `settle-afl-api.ts` gap
because it is a direct, named consequence of this issue's own S8 stage and is explicitly recorded
in this issue's own systemd unit file. No issue number is allocated (`IssuesIndex.md` shows 6 open
issues; nothing here meets CLAUDE.md §5's bar for a new tracked defect independent of ISSUE-228's
own acceptance path).

**S9 status, updated.** DEV smoke remains **BLOCKED** pending operator action (1)+(2), then either
(3) or (4) per the operator's reading-1-vs-reading-2 decision. Brownlow replay / Assertion 9
remains separately PENDING and untouched by this pass. Batch 111/113 canonical evidence, the D-8
step 3/4 bridge evidence, and the persisted `external_identities` audit (§22.1, §22.6) are
unaffected and remain as previously recorded.

**Files changed (this pass):** `issues/open/AFLDB-ISSUE-228.md` (M — this §22.8), `issues.md`
(M — mirrored entry), `IssuesIndex.md` (M — ISSUE-228 addendum). No code, test, migration,
`package.json`, deploy file, `.env`, or `CHANGELOG.md` change; no shell, Git, SQL, SSH, or
deployment command executed.

### 22.9 DEV smoke (§18 item 8) — CLOSED / PASS (2026-09-23, later same day; operator-executed
per §22.8 reading 2; documentation only, no command run by the assistant, CLAUDE.md §9)

This closes gap 22.3(2) using the §22.8-C minimum remediation, **reading 2** (manual revalidation
of the existing route, no code change): items (1)–(3) of that table, operator-executed and
reported, not independently reproduced by Claude (no shell, DB, or network access, CLAUDE.md §9).

**A. Temporary acceptance-window configuration (§22.8-C item 1).** A byte-preserving backup of
DEV `/home/arm/projects/afldb/.env` was taken first (sha256 `6f262753…`, mode `600`). Temporary
`AFLDB_REVALIDATE_URL=http://127.0.0.1:3100/api/internal/revalidate-season` and a generated
`AFLDB_REVALIDATE_SECRET` (value not recorded, per instruction) were installed; `afldb.service`
was restarted (`old_main_pid=4097407` → `new_main_pid=517328`); health probe
`{"status":"ok","database":"ok","latencyMs":31}`; the running process environment confirmed the
secret `SET`, the URL `CORRECT`, `AFLDB_WORKERS=4`.

**B. Four-worker invalidation (§22.8-C item 2).** Four authenticated loopback calls to
`/api/internal/revalidate-season` for `/seasons/2026` round-robinned across all four workers
(`workerId` 2, 1, 4, 3 in turn; `workerCount 4` on every attempt) — `workers_seen=4 3 2 1`,
4/4. (One earlier attempt separately reached worker 4 but failed only in local shell/Python
evidence-parsing, not in the application; not counted toward the formal 4/4 proof, per operator
note.)

**C. Authenticated fresh-page smoke (§22.8-C item 3, §18 item 8 itself).** A temporary beta
admission token was minted in-memory from the application's own token signer (no beta-access
record persisted; the first mint attempt failed safely — standalone `tsx` lacks Web Crypto
globals — corrected via Node's `webcrypto`). `GET http://127.0.0.1:3100/seasons/2026` returned
`HTTP 200`, `x-nextjs-cache: MISS`, `Content-Length: 857783`. No `x-afldb-worker`/`x-afldb-build`
headers were present on this loopback response; per operator note this is not treated as a smoke
failure — the deployed SHA (`3de4eef9`) and the 4/4-worker acceptance (§B) were independently
proven immediately beforehand, and §18 item 8 does not require those supplementary headers. The
rendered page showed `2026 AFL Season · 218 matches · 18 clubs · Season in progress` and the exact
batch-111 canonical rows:

```
Preliminary Final
18 Sept 2026 Sydney 71–83 Fremantle       (match 17283)
19 Sept 2026 Hawthorn 122–131 Brisbane Lions   (match 17282)
```

These are the same two matches independently confirmed canonical by batch 111 (§22.2). **§18 item
8 = PASS.**

**D. Byte-identical rollback (§22.8-C, "not a test window" caveat honoured — this was, by design,
exactly the kind of time-boxed window `AFLDB-ISSUE-134` §10.5/§12.8 already established as the
correct pattern for a temporary DEV acceptance run).** The temporary configuration was removed;
restored `.env` sha256 `6f262753…` matched both the pre-change backup and the original, mode `600`
preserved. `afldb.service` restarted again (`old_main_pid=517328` → `new_main_pid=524695`);
health probe `{"status":"ok","database":"ok","latencyMs":31}`; the running process environment
confirmed both variables `MISSING`. Fail-closed behaviour independently reverified:
`revalidate_without_config_status=503`,
`{"error":"Post-settle revalidation is not configured on this server."}`. The acceptance secret no
longer exists in `.env` or the running process.

**What this does and does not establish.** It closes 22.3(2) under **reading 2** only (§22.8-B):
a manual, operator-triggered revalidation call satisfies §18 item 8's literal wording without
reversing S8's documented decision to keep `settle-afl-api.ts` free of an automatic
`revalidateSeason()` call. **Reading 1** (wiring `revalidateSeason()` permanently into
`settle-afl-api.ts` for unattended future settles) remains an explicit, separate, non-blocking S10
follow-up per §22.8-B — not performed, not required for S9. DEV's `AFLDB_REVALIDATE_URL`/
`AFLDB_REVALIDATE_SECRET` are, by design, temporary and absent again now (consistent with the
`ISSUE-134` pattern) — a *future* unattended AFL API settle still will not auto-revalidate the
season page (up to the natural 1-hour ISR window applies), which is the known, accepted,
unchanged S8 scope decision, not a new gap.

**Files changed (this pass):** `issues/open/AFLDB-ISSUE-228.md` (M — top-of-file addendum, §22.3,
§22.4, this §22.9), `issues.md` (M — mirrored entry), `IssuesIndex.md` (M — ISSUE-228 addendum).
No code, test, migration, `package.json`, deploy file, or `CHANGELOG.md` change. No `.env`, service,
or database action was taken by the assistant — all of §A–D above was operator-executed and
reported (CLAUDE.md §9).

### 22.10 Brownlow replay / Assertion 9 — repository contract derived, both halves found unmet on
current evidence, S9's sole remaining gate (2026-09-23, later same day; read-only repository
inspection only — Read/Grep/Glob native tools; no Bash/PowerShell grep/git/find used for this
section after an earlier self-correction this pass, see the session report; no shell, DB, Git, or
network command run; no mutation attempted, per CLAUDE.md §9 and the operator's "stop before
mutation" instruction)

**"Brownlow replay / Assertion 9" is repository shorthand for two textually distinct, separately-
gating requirements that are explicitly and repeatedly documented as NOT substitutable for one
another. Neither is satisfied on current evidence.**

**A. Requirement 1 — the S7/S9 "Brownlow replay" (§16 S7 row: "backtest §9.10; replay of
live-count captures"; §16 S9 row: "...Brownlow replay"; §18 test plan items 7 and 10).** Defined
operationally, in full, by `docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md`
(§0–§4): a **manual, one-off, real-event** capture of the actual 2026 AFL Brownlow count from the
real public feed (`aflapi.afl.com.au`/`api.afl.com.au/cfs` `bfawards/*`), acquired and settled
through the already-implemented `tools/current-season/acquire-afl-api-brownlow.ts` /
`settle-afl-api-brownlow.ts` pipeline, **target `afldb_test` exclusively — never DEV, never PROD**
(runbook §0 table, §4). §3.6's replay evidence requires: every captured snapshot preserved on
disk; repeated real captures across the count; **at least one replay of an already-processed,
unchanged snapshot** (idempotent no-op, re-running §3.4 step D against a prior label); settlement
of later, changed/advanced snapshots as votes are revealed; a genuine correction capture only if
the real feed issues one (never manufactured); a final `CONCLUDED` reconciliation if the count
concludes within the session. Acceptance evidence is the printed `leaderboardPlayersCompared`/
`leaderboardMismatches` (or equivalent) counters per snapshot, recorded in `issues.md` under this
issue (runbook §4) — never fabricated, never required to be a specific pre-set number, since it
depends on the real, not-yet-observed count.

**Repository evidence on whether this has run:** none. Every entry in `issues.md` under
`AFLDB-ISSUE-228` through the 2026-09-23 "DEV revalidation blocker root-caused" section (the last
entry immediately preceding this pass) states S7 as OPEN and the live-count capture/replay as not
yet evidenced; the runbook itself was written and validated (`sh -n`, systemd inspection) but not
reported as executed. Nothing dated after that in this repository records a real capture, a
settle against `afldb_test` from tonight's/this week's real feed, or the required idempotent-
replay evidence. **Status: PENDING / NOT EVIDENCED on repository record.**

**B. Requirement 2 — Backtest assertion 9 (§9.9 "Semantic hash evidence (T2)"; §16 S7 gate;
§19.5).** A **DB-free**, file-hash comparison, run by
`tools/current-season/emit-afl-api-bundle.ts` (exact command:
`npx tsx tools/current-season/emit-afl-api-bundle.ts [--out <path>]`, default output
`docs/rebuild-manifests/afl_api/backtest-20260919.json`): it looks under
`data/sources/AFLWebsite/AFLGamesSamples/monitor-CD_M20260142801/<timestamp>/` for **two**
timestamped raw captures of the same match, canonicalises and hashes each with an **empty**
exclusion list, and asserts the two hashes are `unchanged`. Differing paths would be recorded as
"evidence pair 1 of 3" in the registry, never silently added to `hash_exclusions`.

**Current tracked state (`docs/rebuild-manifests/afl_api/backtest-20260919.json`, generated
2026-09-19T20:53:57Z, read this pass):** assertion 9's own recorded detail is
`"fixture absent: 1 capture(s) found under monitor-CD_M20260142801 (need 2). Never a silent
pass."` — one capture (`20260919-214114`) exists in the last generated manifest; a second was
never produced. **This worktree's `data/sources/AFLWebsite/AFLGamesSamples/monitor-CD_M20260142801/`
path does not exist at all** (raw captures are deliberately gitignored/untracked per §9 design —
their absence here is expected and is not itself evidence that a second capture does or does not
exist elsewhere, e.g. on DEV or the operator's own machine/monitor). No file in this repository
records a second capture having been taken. **Status: PENDING / NOT EVIDENCED on repository
record; this worktree cannot independently confirm either way, since the raw bytes are
by-design not tracked.**

**C. The two requirements are explicitly non-substitutable — by the repository's own words, not
this pass's inference.** The live-count runbook states this three times, verbatim: *"Tonight's
real Brownlow captures, however clean, do NOT close assertion 9 / the `monitor-CD_M20260142801`
follow-up — keep those two facts separate"* (§1); *"do NOT close assertion 9 / `monitor-
CD_M20260142801`... Record tonight's evidence on its own terms; do not write it up as closing
that follow-up"* (§4). A completed Requirement 1 (live-count replay on `afldb_test`) therefore
would **not**, by itself, close Requirement 2 (assertion 9), and vice versa — both are required
for the S7 gate, and S9's own stage-table row (§16) separately lists "Brownlow replay" as an S9
item.

**D. Assertion 9's own documented closeout path** (recorded 2026-09-21, `issues.md` "Assertion 9
closeout path", unchanged): acquire a genuine second monitor-capture pair under the real feed
during the live count (cheapest, most natural opportunity, now possibly already past — see F
below); **or**, if the operator's already-mentioned manual second capture exists on disk in an
inspectable form, reconstruct it into the formal `backtest-20260919.json` monitor-pair layout;
**or**, failing both, explicitly disposition assertion 9 as a documented SKIP in that manifest
rather than leaving it an undocumented gap. No second capture has been fabricated or reconstructed
this pass, and `backtest-20260919.json` was not regenerated or overwritten.

**E. No mutation attempted, per the operator's own instruction (§7–§8 of this pass's brief) and
CLAUDE.md §9.** Both requirements' preconditions (a completed real 2026 live-count capture/replay
and/or a second `monitor-CD_M20260142801` capture) are, on all evidence available to this pass,
unmet. Running the live-count runbook now risks capturing a Brownlow count that has already
concluded (see F) with no captures taken during it — the runbook is explicit that this is a
one-off, non-repeatable real event. Fabricating, reconstructing, or backdating evidence for either
requirement is explicitly forbidden by the operator's brief and by CLAUDE.md's evidence-integrity
rules; none was done.

**F. Open question this pass cannot resolve from the repository alone.** The runbook and every
2026-09-21 entry describe the 2026 Brownlow count as "imminent (Grand Final week)." Today is
2026-09-23 and the two most recent canonical matches on `/seasons/2026` are the 18–19 Sept
Preliminary Finals (§22.9-C) — the Grand Final itself has not yet been recorded as canonical in
this repository, and no entry anywhere in `issues.md` reports the real Brownlow count having
occurred, been watched, or been captured. **This pass cannot determine, from repository evidence
alone, whether the real 2026 Brownlow count has already happened (and gone uncaptured) or is still
ahead.** This is an operator fact, not a repository fact, and is the single question that
determines whether Requirement 1's runbook can still be run at all this season.

**Assertion 9 / Brownlow replay: BLOCKED, precise reason — both of S9's required Brownlow inputs
(a real 2026 live-count capture/replay on `afldb_test`, and a second `monitor-CD_M20260142801`
capture pair) are absent from every piece of repository evidence available to this pass, and
whether the live-count window has already closed is a fact only the operator holds.** No dry-run,
apply, or replay was executed. **S9 status: unchanged from §22.9 — DEV smoke is now PASS; Brownlow
replay / Assertion 9 remains the sole outstanding S9 gate; ISSUE-228 S9 overall is NOT complete.**

**Recommended next step (operator-answered, not executed):** confirm whether the 2026 Brownlow
count has already occurred. If **not yet**: run the existing
`docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md` against `afldb_test` during the real
count, watching for a natural second `CD_M20260142801`-shaped capture opportunity if the monitor
is still active, or accept that assertion 9 stays a documented SKIP and disposition it explicitly
in `backtest-20260919.json` per its own closeout path (§D). If the count **has already passed**
uncaptured: assertion 9 has no remaining natural evidence-gathering opportunity this season and
must be dispositioned as an explicit, permanent SKIP (§D's third option) rather than left an
undocumented gap; Requirement 1 (live-count replay) would need its own separate operator decision
on whether a later, non-"tonight" `afldb_test` exercise against the concluded season's feed still
counts as acceptance evidence, or whether S9 proceeds with Requirement 1 formally waived/deferred
— **that is an operator/architectural decision this pass does not make.**

**Files changed (this pass):** `issues/open/AFLDB-ISSUE-228.md` (M — this §22.10), `issues.md`
(M — mirrored entry), `IssuesIndex.md` (M — ISSUE-228 addendum). No code, test, migration,
`package.json`, deploy file, `.env`, or `CHANGELOG.md` change; no shell, Git, SQL, SSH, or
deployment command executed; no database connection opened.

### 22.11 Operator contract clarification + completed-tracker acquisition proof (2026-09-23, later
same day, Sonnet 5; network acquisition explicitly operator-authorised this pass; no DB, Git, SSH,
or deployment command run)

**A. Contract clarification (operator-supplied, binding, recorded verbatim in substance).** §22.10's
Requirement 1 ("live-count replay") is **not** a requirement that AFLDB observe the Brownlow count
while the ceremony is physically in progress. The operator has clarified the actual S9/S7
acceptance objective: AFLDB must be able to (1) obtain the **official completed** round-by-round
Brownlow votes from the AFL source **after** the event, (2) resolve them to canonical
matches/players, (3) validate them, and (4) replay/ingest them safely and idempotently against
`afldb_test`. Missing the live ceremony window is **not**, by itself, a reason to SKIP Requirement 1.
The distinction that matters is: **live monitoring/capture timing** — desirable (feeds the still-
separate Assertion 9 evidence gap, §22.10 §B), but **not required** for this year's Requirement 1
acceptance; **official completed vote data obtainable from the AFL source** — required; **safe
deterministic replay/ingestion** — required; **identity/vote-integrity validation** — required;
**idempotence** — required. This corrects, not overrides, §22.10: Assertion 9 (§9.9, Requirement 2)
is untouched by this clarification and remains its own separately-gated item (§C below).

**B. The runbook's "one-off, tonight, real-event" framing is a documentation artefact, not a code
constraint — confirmed by reading the implementation, not assumed.**
`tools/current-season/acquire-afl-api-brownlow.ts` (`runBrownlowAcquisition()`) has exactly one
gate before making a network request: the §10/§D two-key switch
(`AFLDB_AFL_API_BROWNLOW_ENABLED` env var **and** the `site_settings
'acquisition.afl_api_brownlow_enabled'` super-admin toggle, both read via
`combineAflApiBrownlowGates()`). Nothing in the acquisition CLI checks a date, a "tonight" window,
or the feed's own `status`. `tools/current-season/settle-afl-api-brownlow.ts` §3.5 goes further: it
explicitly branches on the feed's own `status` field (`LIVE` → leaderboard mismatches advisory;
`CONCLUDED` → leaderboard mismatches **blocking**, `result.reconciliation.blocking`), i.e. the
pipeline was designed to consume **either** state and applies its **stricter** validation to a
concluded tracker, not a weaker or unsupported one. **The existing acquisition/settle pipeline
consumes a post-event completed tracker unchanged; no code change is needed for Requirement 1.**

**C. The official completed 2026 tracker is obtainable, right now, and is CONCLUDED.** Network
acquisition against the real public AFL feed (explicitly operator-authorised for this investigation,
§9-exception) succeeded end-to-end using the exact request shapes `src/lib/acquisition/afl-api-client.ts`
already implements:
- `POST https://api.afl.com.au/cfs/afl/WMCTok` → HTTP 200, media token issued.
- `GET https://api.afl.com.au/cfs/afl/bfawards/season/CD_S2026014` → HTTP 200, **`status:
  "CONCLUDED"`**.
- `GET https://api.afl.com.au/cfs/afl/bfawards/leaderboard/season/CD_S2026014` → HTTP 200,
  **`status: "CONCLUDED"`**.

This used the CLI's own token/endpoint logic manually (via `curl`, outside the sanctioned
`acquire-afl-api-brownlow.ts` snapshot/manifest path, because that CLI's own two-key admin gate
could not be evaluated this pass — no DB connection was available, §E below). The two raw response
bodies were saved as scratch evidence only, **not** as a tracked acquisition: `D:\tmp\brownlow-
season-2026.json` (296,218 bytes) and `D:\tmp\brownlow-leaderboard-2026.json` (131,467 bytes). These
are outside `data/sources/afl_api/brownlow/<label>/` and carry no manifest; they are proof that the
source is reachable and concluded, not an accepted acquisition artefact. A real acquisition must
still run through `acquire-afl-api-brownlow.ts` once the admin gate is confirmed (§E).

**D. Authoritative completed-source census, derived directly from the acquired feeds (DB-free,
computed this pass, not fabricated):**

| Metric | Value |
|---|---|
| Counted matches (`matchVotes[]` entries) | 207 |
| Distinct match ids | 207 (no duplicate `matchId` entries) |
| Distinct players receiving votes | 183 |
| Total vote-allocation rows (3+2+1 entries) | 621 |
| Total Brownlow votes represented | 1,242 |
| Matches with invalid vote totals (≠ 6) | 0 |
| Matches with duplicate 3/2/1 positions | 0 |
| Leaderboard entries | 183 (matches distinct-player count exactly) |
| Σ leaderboard `totalVotes` vs Σ season-feed votes | 1,242 = 1,242 (exact reconciliation) |
| Winners flagged | 1 — Nick Daicos, 47 votes |
| Round distribution | rounds 0–24 present, 207 matches total, matching the established 2023–2025 207-match H&A pattern (§2.5) |

207 matches / 621 rows / 1,242 votes is internally consistent (every match sums to exactly 6) and
matches the historical shape already validated for 2022–2025 (§9.10 closeout). **Not yet computed
this pass:** unresolved provider players/matches against this worktree's canonical rows, and
duplicate-vs-existing-canonical-row conflicts — those require either the settle CLI's own
resolution (`--dry-run` against `afldb_test`) or an authenticated DB read, neither available this
pass (§E).

**E. Blocker found this pass — no DB connectivity from this workstation; nothing DB-dependent could
run.** `DATABASE_URL` (→ `afldb_dev`, the database `readAflApiIngestionControls()` reads the §D
two-key super-admin Brownlow toggle from) and `AFLDB_TEST_DATABASE_URL` (→ `afldb_test`) both
resolve to `127.0.0.1`; a read-only preflight probe (`current_database()`/`current_user`/
`transaction_read_only`, the exact pattern §7's operator brief requested) against `DATABASE_URL`
refused with `Connection refused` on both attempts — no SSH tunnel is active from this workstation.
This blocks, in order: (a) confirming the super-admin `acquisition.afl_api_brownlow_enabled` toggle
state, which the sanctioned `acquire-afl-api-brownlow.ts` CLI itself would refuse to run without;
(b) match/player identity resolution against canonical `afldb_test` rows; (c) the documented
dry-run/apply/verify/idempotent-replay sequence (§7 steps B–F of the operator's brief). Per
CLAUDE.md §9, establishing an SSH tunnel is a user-executed action and was not attempted.
`AFLDB_TEST_IMPORT_DATABASE_URL` was not independently checked (no tunnel to test the derivation
against).

**F. S9 status: unchanged in substance, reconciled in framing.** DEV smoke remains PASS (§22.9).
Requirement 1 (Brownlow replay) is **no longer blocked on source availability or timing** — the
completed 2026 tracker is obtainable, CONCLUDED, and internally clean; the pipeline needs no code
change to consume it. Requirement 1 **is** still blocked on execution: the DB-dependent
dry-run/apply/verify/replay sequence has not run, pending an active tunnel and the super-admin
ingestion toggle. Requirement 2 (Assertion 9, §9.9) is **unaffected by this clarification** and
remains exactly as §22.10 left it — a second `monitor-CD_M20260142801` capture or an explicit
documented SKIP, an operator decision this pass does not make. **ISSUE-228 S9 is still NOT
complete.** No fabricated evidence, no invented counters, no database, Git, SSH, or deployment
command executed.

**Recommended next step:** once a DB tunnel is available, re-run the §E read-only preflight against
both `DATABASE_URL` and `AFLDB_TEST_DATABASE_URL` to (i) read the super-admin Brownlow toggle and
(ii) confirm `afldb_test` target/role, then run the sanctioned
`acquire-afl-api-brownlow.ts --season 2026` (superseding the scratch files in §C with a real
manifest-bound snapshot) followed by the documented build/validate → dry-run → retained
`afldb_test` apply → independent verification → idempotent replay sequence (operator brief §7).

**Files changed (this pass):** `issues/open/AFLDB-ISSUE-228.md` (M — this §22.11), `issues.md`
(M — mirrored entry), `IssuesIndex.md` (M — ISSUE-228 addendum). No code, test, migration,
`package.json`, deploy file, or `CHANGELOG.md` change; no Git, SQL, SSH, or deployment command
executed; no database connection opened or attempted beyond the refused read-only preflight in §E;
network acquisition against the public AFL API only, explicitly operator-authorised.

### 22.12 S9 tooling gap — no full-season `afldb_test`-native player bridge; emitter implemented,
bridge built read-only, STOPPED before import (2026-09-23, Opus 5.5; operator-authorised
implementation and read-only DB work; no `afldb_test` write, no Git)

**A. Starting state (measured this pass, read-only against `afldb_test`).** Batch **2418**
(`settle-afl-api-brownlow.ts`, season 2026, `mode=apply; auto-apply`, Brownlow snapshot
`afl-api-brownlow-2026-2026-09-23-015405`) is `completed`: 207 vote sets seen, 180 planned,
**27 refused `unresolved_identity`**, **540** canonical rows inserted, 183 leaderboard players
compared, 0 leaderboard mismatches. Canonical 2026 `brownlow_round_votes` = **180 sets / 540 rows /
1,080 votes**. Batch 2418 is retained as valid partial-apply evidence and was not touched.

**B. The gap (as reported by the operator, confirmed).** `afldb_test` holds 529 `afl_api`
`external_identities` (397 stat-vector bootstrap, 129 name/team/season, 3 manual). The only
full-season emitter, `emit-afl-api-player-bridge.ts`, is pinned to `afldb_dev`, and the importer
refuses its `afl_api_stat_vector_season` artefacts for `--target afldb_test`; the only
`afldb_test`-native builder, `build_afl_api_player_bridge.py`, covers the 14-match sample only.

**C. The importer's contract, proved before implementation.** For `--target afldb_test`,
`load_artefact()` refused `afl_api_stat_vector_season` **unconditionally**, so no metadata shape
could satisfy it. The only way round that without an importer change was to relabel full-season
evidence as `afl_api_stat_vector_bootstrap`, which would conflate evidence classes in
`external_identities.match_method` and was rejected. The importer change is the minimum
**target-bound** generalisation (`SEASON_EVIDENCE_PROVENANCE_BY_TARGET`): each target accepts
season evidence only when `built_from_database` is that target's own database **and** `tool` is that
database's pinned emitter. A DEV-built artefact is still refused for `afldb_test`, and a test-built
artefact is refused for `dev`. Every other provenance check (`read_only`, numeric `season`,
`snapshot_label`, 64-hex `snapshot_manifest_sha256`, `existing_claim_comparison`) is unchanged.

**D. Implementation.**
- `src/lib/acquisition/afl-api-player-evidence.ts`: a closed target list
  (`AFL_API_DEV_EVIDENCE_TARGET` = `afldb_dev`/`AFLDB_DEV_DATABASE_URL`,
  `AFL_API_TEST_EVIDENCE_TARGET` = `afldb_test`/`AFLDB_TEST_DATABASE_URL`), with
  `assertAflApiEvidenceDsnFor()`/`assertAflApiEvidenceSessionFor()`. `assertAflApiEvidenceDsn()` and
  `assertAflApiEvidenceSession()` are unchanged in behaviour: they delegate to the DEV target and
  still refuse `afldb_test`.
- `tools/current-season/emit-afl-api-player-bridge.ts`: the body is shared as
  `runEmitAflApiPlayerBridgeFor(target, …)`. The pinned target supplies the DSN variable, the live
  `current_database()` proof, `application_name` and the artefact `tool`. `runEmitAflApiPlayerBridgeCli()`
  stays DEV-pinned. The CLI still has no target, database or DSN flag.
- `tools/current-season/emit-afl-api-player-bridge-test.ts` (new) is the `afldb_test`-pinned entry
  point (`npm run emit:afl-api-player-bridge-test`). It uses the same snapshot load, match resolution,
  evidence engine and artefact shape as the DEV emitter, with a read-only startup parameter and a
  live read-only proof.
- `tools/migration/import_afl_api_player_bridge.py`: §C above.

**E. Tests (run this pass, all pass).** `npx vitest run tests/afl-api-player-bridge-cli.test.ts
tests/afl-api-player-evidence.test.ts` gave **76/76**; `python tests/python/afl_api_bridge_contract.py`
passed all checks; `npx tsc --noEmit` was clean. New coverage:
- the DEV guards still refuse `afldb_test`, and the TEST guards refuse every database except
  `afldb_test`, at both the DSN and the live session;
- both entry points run end to end against a fake read-only session: DEV refuses a live
  `afldb_test`, TEST refuses `afldb_dev`/`afldb`/`afldb_prod` after exactly one statement, and TEST
  refuses a missing or foreign DSN before connecting;
- a TEST artefact declares `built_from_database: "afldb_test"` and the test tool;
- `--compare-artefact` never injects candidate ids;
- the same evidence links to whichever canonical id the queried database holds;
- 217 matches are classified, so there is no fixed corpus;
- the importer accepts a test-native artefact for `afldb_test` and refuses: a DEV artefact for
  `afldb_test`, a test artefact for `dev`, `afldb_test` provenance carrying the DEV tool, a DEV
  artefact relabelled with the test tool, a missing `tool`, and malformed provenance.

**F. Test-native bridge, built read-only.** Command: `emit:afl-api-player-bridge-test --label
afl-api-2026-2026-09-23-002226 --expect-matches 217 --expect-rows 9983 --expect-providers 669
--compare-artefact data/reference/afl-api-player-bridge-2026-full-2026-09-22.json --out
data/reference/afl-api-player-bridge-2026-full-afldb-test-2026-09-23.json`. `-002226` is the snapshot
`afldb_test`'s own `afl_api` settle (batch 2415) used.

| Metric | Value |
|---|---|
| Session proof | `current_database()='afldb_test'`, `transaction_read_only=on`, `default_transaction_read_only=on` |
| Snapshot manifest sha256 | `54e0dd87…caf49b` |
| Matches / player-match rows / providers | 217 / 9,983 / 669 (census gate passed); 0 build failures |
| Canonical matches resolved / unresolved | 213 / 4 (`CD_M20260142701/02/801/802`, `no_canonical_match` — finals weeks 3–4, no Brownlow bearing) |
| Canonical `player_match_stats` rows read | 8,974 |
| Providers linked / unresolved / contradictory | **577 / 92 / 0** |
| Duplicate canonical jumper keys / nonstandard jumpers / all-zero withheld | 0 / 0 / 0 |
| Linked candidate ids distinct, and present in `afldb_test.players` | 577 / 577 |
| vs existing `afldb_test` `afl_api` links | 395 agree, **0 differ** |
| vs the DEV artefact (provider-id sets) | 577 both linked, 0 newly linked, 92 DEV-only, 0 now-contradictory |
| Importer `--validate-only --target afldb_test` (read-only) | **accepted**: would_link 182, already_linked 395, would_HALT_contradiction 0 |
| DEV artefact, same importer check | **REFUSED** (`built_from_database is 'afldb_dev'…`) |

Numeric ids equal the DEV artefact's for all 577 shared providers. That is informational only:
every id was read from `afldb_test`'s own rows, and it is not a proof of parity.

**G. The Brownlow providers: 23, not 22, and only 15 resolve. STOPPED here.** The full vote-row
census of the Brownlow snapshot (207 sets, 621 rows, 183 providers) finds **23** distinct providers
with no `afl_api` link in `afldb_test`, spread across exactly the **27** refused vote sets. The
operator's figure of 22 was not reproduced; the refusal `detail` records only the first unresolved
provider per set, so counting from it undercounts. The test-native bridge links **15 of the 23**.
The other **8** are ISSUE-224 registrants and stay `unresolved (no_matching_evidence)`:

`CD_I1005972` Milan Murdock, `CD_I1017073` Joel Fitzgerald, `CD_I1027168` Dyson Sharp,
`CD_I1028515` Jagga Smith, `CD_I1029297` Zeke Uwland, `CD_I1032042` Phoenix Gothard,
`CD_I1033084` Harry Dean, `CD_I1037021` Sam Swadling.

**Root cause: a data-state gap in `afldb_test`, not an emitter defect.** All 92 ISSUE-224
registrants exist in `afldb_test` (`players.id` 21875–21966), but **none of the 92 has a single
`player_match_stats` row**. `afldb_test`'s 2026 stats average 42.13 rows per match over 213
matches; the provider feed has about 46. The `afl_api` settle of `-002226` on `afldb_test` (batch
2415) inserted 0 rows. Stat-vector evidence needs the canonical stat rows, so **no evidence
emitter can link these 8 from `afldb_test` today**. On `afldb_dev` the same players were linked
because DEV's canonical 2026 stats do carry them (ISSUE-224 D-8 lineage). That D-8 stat re-linkage
step has not been reproduced on `afldb_test`.

Because the acceptance condition "all Brownlow-required provider IDs resolve" failed at the
build/verify step, the run **stopped before any `afldb_test` write**. There was no bridge
`--apply`, no Brownlow re-settle, no leaderboard reconciliation and no replay. Importing the 182
would-link rows alone would still leave vote sets refused, so it was not done piecemeal. No identity
was inserted by hand. No DEV `candidate_player_id` was copied. Batch 2418 is untouched.

**H. Decision needed (operator).** Either:
1. give `afldb_test` the ISSUE-224 D-8-equivalent 2026 canonical `player_match_stats` for the 92
   registrants through the sanctioned importer/settle path, then re-run this emitter (expected 669
   linked if the rows match DEV's). This is recommended and needs no new code; or
2. authorise a different, explicitly labelled evidence class for the 8, such as the existing
   `build_afl_api_brownlow_name_bridge.py` name/team/season class if its roster source covers them
   in `afldb_test` (not verified), or a stable-key AFL Tables-profile bridge.

This may be ISSUE-224 scope rather than an ISSUE-228 tooling gap. No successor issue is allocated
until the operator chooses.

**I. Status.** The emitter gap is **REMEDIATED** (implemented and tested; artefact built and
importer-accepted read-only). The Brownlow completion is **BLOCKED** on §G/§H. Assertion 9 is
unchanged and separate. **S9 is NOT accepted.**

**Files changed (this pass):**
- `src/lib/acquisition/afl-api-player-evidence.ts` (M)
- `tools/current-season/emit-afl-api-player-bridge.ts` (M)
- `tools/current-season/emit-afl-api-player-bridge-test.ts` (A)
- `tools/migration/import_afl_api_player_bridge.py` (M)
- `package.json` (M, one script)
- `tests/afl-api-player-bridge-cli.test.ts` (M)
- `tests/afl-api-player-evidence.test.ts` (M)
- `tests/python/afl_api_bridge_contract.py` (M)
- `data/reference/afl-api-player-bridge-2026-full-afldb-test-2026-09-23.json` (A, evidence artefact)
- this §22.12, `issues.md` (M), `IssuesIndex.md` (M)

### 22.13 Option 1 (populate the 92 registrants' 2026 stats in `afldb_test`): the sanctioned path is BLOCKED by a 2099 observation clock already in `afldb_test`. STOPPED before any write (2026-09-23, Opus 5.5; operator-authorised execution; no `afldb_test` mutation retained, no DEV/PROD, no Git)

**A. Operator decision.** Option 1 of §22.12 H: populate the 92 ISSUE-224 registrants' 2026
`player_match_stats` in `afldb_test` through the path DEV used. Then rebuild the test-native bridge,
import it, and resume the Brownlow settle. No weaker name/team/season path is allowed for the 8.
**Corrected count, confirmed:** there are **23** distinct Brownlow-required provider ids, not 22. Batch
2418's refusal `detail` records only the *first* unresolved provider of each of the 27 refused
sets, so a count taken from the refusals undercounts (§22.12 G).

**B. The sanctioned path, reconstructed from the repository (not from memory).** It is ISSUE-224
D-8 step 2 (`issues/open/AFLDB-ISSUE-224.md` §19.2 runbook, §20.1 DEV result). It is the in-season
AFL Tables settle of the retained snapshot `issue224-inseason-20260919`, run offline-first:
1. Bundle: `import_fitzroy_core.py --label issue224-inseason-20260919 --require-in-season
   --emit-observations <dir>/observations.json`. This was already emitted. The on-disk bytes match
   the §20.1 record: `player_stats_2026.csv` `d150d4bc…08c36`, `results.csv` `ec767923…9d39cb`,
   bundle 32,790,248 bytes `bd76b99e…`, manifest sha256 `93528144…0c51b92`, 215 matches, 9,890
   player-match rows, `on_record_error=abort`, no unkeyed rejections.
2. `tools/current-season/settle-afltables.ts --label issue224-inseason-20260919 --dry-run
   --auto-apply --require-complete-source`, then the same command with `--apply`.
   `--auto-apply` is required: without it no canonical row is written (§19.2.4).
   Role `afldb_import`, via `AFLDB_IMPORT_DATABASE_URL`. The tool has **no target switch and no
   `current_database()` assertion** (§19.2.3), so the target must be proven outside it.
   On DEV this path produced batch 105 with `canonicalRowsInserted 827`: 827 rows over the 92
   registrants.

**Targeting afldb_test safely.** The worktree `.env` DSNs name `127.0.0.1:5432`, where nothing
listens. The live tunnel is `127.0.0.1:55432`. A scratch wrapper (job-tmp, not in the repository)
took the `afldb_import` DSN, swapped in the database from `AFLDB_TEST_DATABASE_URL` and the tunnel
port, all in memory. It proved `current_database()='afldb_test'` and `current_user='afldb_import'`
before handing the client to the repository's own `runSettleCli()` through its documented
`deps.sql` seam. ISR revalidation was injected as a no-op (`deps.env={}`), so no site was contacted.

**C. Pre-population census, measured read-only.** The registrants were located by identity
contract, not by numeric DEV ids: the 92 `REGISTER` rows' `afltables_external_id` from
`issue224-d7-registration-decision-20260922.json`, joined to `external_identities`
(source `afltables`).

| Metric | Value |
|---|---|
| Session | `afldb_test` / `afldb_import` / `transaction_read_only=on` |
| Registrant AFL Tables identities resolved | **92 / 92** (92 distinct players, `players.id` 21875–21966) |
| Registrants with any 2026 `player_match_stats` | **0** (0 rows; 92 players with none) |
| Duplicate (player, match) rows for them | 0 |
| All 2026 `player_match_stats` / matches | 8,974 / 213 |
| `max(import_batches.id)` | 2418 |
| 2026 `brownlow_round_votes` | 540 rows / 1,080 votes (batch 2418 state, unchanged) |

**D. The sanctioned dry run REFUSED at the database.** The command in B.2 was run through the
wrapper with `--dry-run --auto-apply --require-complete-source`. The bundle validated against its
manifest, and then PostgreSQL raised:

```
new row for relation "source_records" violates check constraint "source_records_seen_ck"
Failing row contains (10, match, 2026|10|2026-05-07|Fremantle|Hawthorn, season=2026, 1, 82b30128…,
  2099-01-02 11:00:00+11, 2026-09-23 12:55:19.959+10, 2419, null)
```

The whole transaction rolled back and nothing was retained. **Root cause: pre-existing
`afldb_test` state, not the snapshot, the tool or the 92.** `afldb_test`'s entire 2026 AFL Tables
lineage comes from the settle-performance benchmark in `issues.md` "Stage 5 handoff": batches
**103/104/105**, 2026-09-06, snapshots `settle-2026-2026-09-06-*`. That benchmark injected an
observation clock of **2099-01-02 → 03 → 04** (`issues.md`: "`last_seen_at` advanced
2099-01-02→03"). Measured read-only: every one of the **10,011** `afltables` spine heads for 2026
(213 `match`, 9,798 `player_match_stats`, all `last_batch_id=105`) has `first_seen_at` in 2099.
`staging.source_records_seen_ck` requires `last_seen_at >= first_seen_at`. The CLI always observes
at the real clock (`settle-afltables.ts:1818`, `options.observedAt ?? new Date()`), so
**no real-clock AFL Tables settle can touch any 2026 key in `afldb_test` until 2099**. This is a
test-database hygiene defect left by the benchmark. It was not recorded anywhere.

Sequence note: that refused dry run consumed `import_batches` id 2419. The failing row shows it,
and `nextval` survives a rollback. No `import_batches` row exists for it; `max(id)` is still 2418.

**E. Diagnostic only: the same library entry point, rolled back, on the benchmark's own clock.**
This did not use the CLI. A second wrapper reproduced `runSettleCli()`'s bundle load
(`validateSettleBundle`, manifest re-hashed from disk) and its `runSettleAfltables()` call exactly
(`apply:false`, `autoApply:true`, the real `loadManualAuthority` loader, `in_progress_seasons`).
Its one addition was `observedAt: '2099-01-05T00:00:00Z'`, the next instant after the lineage.
**The transaction rolled back.** Afterwards: registrant 2026 pms still 0, all 2026 pms still 8,974,
`max(import_batches.id)` still 2418.

| Counter | Value |
|---|---|
| snapshotMatches / snapshotPlayerMatchRows / rejections | 215 / 9,890 / 0 |
| observationsSeen / unchanged / corrected / new versions | 10,105 / 10,224 / 94 / 94 |
| unresolvedIdentityPlayer / Club / Venue / Match | **0** / 0 / 0 / 2 (the 2 matches new since the 09-06 lineage, then inserted) |
| foreignOwnedCollision / sourceDisagreement / manualAuthorityRefusals | 0 / 0 / 0 |
| candidatesCreated / candidatesMootLeftPending | 0 / 824 |
| canonicalRowsInserted / Updated / ApplicationsLogged | **934** / **0** / 920 |
| canonicalRetryApplied / ApplyRefusals / ApplyFailures | **824** / 0 / 0 |
| canonicalMatchesRekeyed / RekeyRefusals | 0 / 0 |
| derivedRecomputePlayers | 181 |
| Source completeness | **COMPLETE** (10,105/10,105 represented, every scope sweepable) |

Reading, derived and not directly measured per player: 920 applications = 2 match inserts +
2 period sets + **916 player-match rows**, and 916 = 9,890 − 8,974. Of these, **824** are the retry
of the pending `unresolved_identity` candidates the 09-06 benchmark left for the not-yet-registered
players, which now resolve. The remaining 92 player-match rows are new since 09-06; most belong to
the 2 new matches. DEV inserted 827 for the 92 from a different canonical lineage. TEST's figure
for the 92 alone would be counted after an apply, not asserted here. **The path is otherwise
clean:** 0 unresolved players, 0 updates to existing canonical rows, 0 refusals, 0 failures,
0 disagreements, source COMPLETE.

**F. Why this stopped instead of applying.** The operator's contract was "the sanctioned existing
path only", and "if any documented safety gate refuses the operation, stop and report rather than
circumventing it". The sanctioned CLI refuses. The only way through found this pass is a retained
`--apply` that continues the injected 2099 clock (E). That is a non-CLI invocation, and it would add
more fabricated observation timestamps to `afldb_test`. Hand-editing `staging.source_records`
timestamps is manual SQL on a guarded spine and was **not** considered permissible. Both are
operator decisions.

**G. Decision needed (operator).** One of:
1. **Authorise a retained apply that continues the 2099 lineage** (recommended; smallest step).
   This is exactly E with `apply:true`, then an identical re-run as the idempotence proof. All
   gates stay intact. What is new is the explicit `observedAt` (2099-01-05, then 2099-01-06 for the
   replay). It is consistent with the lineage `afldb_test` already holds and touches only test data.
2. Authorise a proper hygiene repair first, e.g. a small reviewed tool, or a rebuild of
   `afldb_test`'s 2026 AFL Tables lineage on a real clock. Then run the unmodified CLI. This is
   larger, and a rebuild would also disturb the batch 2415/2418 AFL API/Brownlow state.
3. Record the benchmark residue as a separate `afldb_test` hygiene issue and defer.

After (1) or (2), the rest of the operator's sequence is unchanged: census (require 0 stat-less
registrants), `emit:afl-api-player-bridge-test` on `-002226` (require 669/0/0 and **23/23**
Brownlow providers linked), importer validate-only then `--target afldb_test` apply, identity
audit, Brownlow re-settle of the same capture (expected final 207 / 621 / 1,242), leaderboard
reconciliation over 183 players, and an identical replay.

**H. Not done.** No retained `afldb_test` write. No stats population, bridge rebuild, bridge
import, Brownlow re-settle, reconciliation or replay. Batch 2418 is untouched: 540 rows, 180/207
sets. It is still valid partial-apply evidence, not a failure. No DEV or PROD access. No Git.
**Assertion 9 is unchanged and separate** (the DB-free two-capture hash stability requirement on
`monitor-CD_M20260142801`). It is not PASS. The PhanesLight `new-file` step does not apply to
`emit-afl-api-player-bridge-test.ts`: `new-file` only creates a file with a header stamp and
refuses an existing path. `.phaneslight/registry/` does not exist in this worktree and is
`afldb-closure`'s alone to regenerate. Nothing was run and nothing changed.

**I. Status.** ISSUE-228 S9 is **BLOCKED** on G, which is an ISSUE-224 test-data parity
prerequisite made unreachable by the benchmark clock residue. No successor issue is allocated.
**S9 is NOT accepted.**

**Files changed (this pass):** this §22.13; `IssuesIndex.md` (M, next action).

### 22.14 Option 1 executed on `afldb_test`: stats population PASS, idempotence PASS; bridge rebuild 667/669, so the gate FAILED and the run STOPPED before the bridge import (2026-09-23, Opus 5.5; operator-authorised `afldb_test`-only execution; no DEV/PROD, no Git)

**A. Operator decision.** This is §22.13 G option 1. The operator authorised a retained apply that
continues `afldb_test`'s existing 2099 benchmark clock, `observedAt 2099-01-05`, followed by an
idempotence re-run at `2099-01-06`. The clock is a **test-environment accommodation, not production
behaviour.** It must not be used on DEV or PROD. Every identity, authority, completeness and
ownership gate stays enabled. There is no `afldb_test` rebuild, no repair of the 2099 rows, and
batches 2415/2418 are preserved. The benchmark residue is tracked separately as
**AFLDB-ISSUE-230** and does not block S9.

**B. Invocation.** A scratch wrapper (job-tmp, not in the repository) repeats §22.13 E exactly. It
calls `validateSettleBundle` with the manifest re-hashed from disk, then `runSettleAfltables()`
with `autoApply:true`, the real `loadManualAuthority` loader and `in_progress_seasons`, on snapshot
`issue224-inseason-20260919` (manifest sha256 `93528144…0c51b92`). Its only change from §22.13 E is
`apply:true`. It accepts no `observedAt` other than the two authorised values. Before running, it
proves `current_database()='afldb_test'` and `current_user='afldb_import'`. The rendered exception
report is `buildSettleExceptionReport`, the same one the CLI uses. No ISR request is made.

**C. Retained apply, `observedAt 2099-01-05`: batch 2421, PASS.** Import batch ids 2419 and 2420
were consumed by the earlier refused and rolled-back runs; `nextval` survives a rollback.

| Counter / measure | Before | After / batch 2421 |
|---|---|---|
| ISSUE-224 registrants resolved (AFL Tables identity) | 92 | 92 |
| Registrants with 2026 `player_match_stats` | 0 | **92** |
| Registrants with no 2026 stats | 92 | **0** |
| Registrant 2026 pms rows | 0 | **827** (DEV's D-8 step 2 figure was also 827) |
| All 2026 pms rows / 2026 matches | 8,974 / 213 | **9,890 / 215** |
| Duplicate (player, match) rows, DB-wide | 0 | **0** |
| `canonicalRowsInserted` / `Updated` / `ApplicationsLogged` | — | **934** / 0 / 920 |
| Ledger for batch 2421 (`canonical_applications`) | — | 2 `matches`, 2 `match_period_scores`, **916 `player_match_stats`** |
| `canonicalRetryApplied` / `candidatesMootLeftPending` | — | 824 / 824 |
| `unresolvedIdentityPlayer` / Club / Venue | — | **0** / 0 / 0 |
| `unresolvedIdentityMatch` | — | 2 (the 2 matches new since 09-06, then inserted in-run) |
| `sourceDisagreement` / `foreignOwnedCollision` / `manualAuthorityRefusals` | — | 0 / 0 / 0 |
| `canonicalApplyRefusals` / `ApplyFailures` / `RekeyRefusals` | — | 0 / 0 / 0 |
| Batch 2421 `import_rejections` / `records_rejected` | — | 0 / 0 |
| Exception report: ACTIVE items (unresolved, pending, failures, disagreements) | — | **0** |
| Source completeness | — | **COMPLETE** (10,105/10,105) |

The before and after measures were taken by the wrapper. They were **independently re-derived**
afterwards on a fresh read-only session (`transaction_read_only=on`): 92/92 with stats, 827
registrant rows, 9,890 pms, 0 duplicates, 0 null players, and the batch-2421 ledger and rejection
counts above. Inserted rows break down as 916 pms, 2 matches and 16 period-score rows (934 − 916 −
2). 916 = 9,890 − 8,974.

**D. Idempotence re-run, `observedAt 2099-01-06`: batch 2422, PASS.** `canonicalRowsInserted 0`,
`Updated 0`, `ApplicationsLogged 0`, `RetryApplied 0`, `versionsAppended 0`,
`observationsCorrected 0`, every unresolved/refusal/failure/disagreement counter 0
(`unresolvedIdentityMatch` is now 0 too), and source COMPLETE. The census was identical before and
after: 92 / 827 / 0 without / 9,890 / 215 / 0 duplicates / Brownlow 540 rows. **There was no
canonical stats mutation.**

**E. Test-native bridge rebuilt, read-only: 667 / 2 / 0. The 669/669 gate FAILED.** The command
was the same as §22.12 F, with a new `--out`:
`data/reference/afl-api-player-bridge-2026-full-afldb-test-post-d8-2026-09-23.json`. The §22.12
artefact is kept as prior evidence.

| Metric | Value |
|---|---|
| Session | `afldb_test`, `transaction_read_only=on`, `default_transaction_read_only=on` |
| Census | 217 / 9,983 / 669; 0 build failures; manifest `54e0dd87…caf49b` |
| Canonical matches resolved / unresolved | **215** / 2 (`CD_M20260142801/802`, Grand Final week, no Brownlow bearing) |
| Canonical pms rows read | 9,890 |
| Providers linked / unresolved / contradictory | **667 / 2 / 0** |
| Player-match rows uncovered | 12 |
| vs the DEV artefact | 667 both linked, 0 newly linked, 2 DEV-only, 0 now-contradictory |

The 2 unresolved providers are ISSUE-224 registrants:
- `CD_I1019944` Alex Van Wyk: `surname_disagrees(observed="Van Wyk", canonical="Wyk")`, 3 rows;
- `CD_I1030308` Hussien El Achkar: `surname_disagrees(observed="El Achkar", canonical="Achkar")`, 9
  rows.

**Root cause: the ISSUE-224 §21 multipart-surname defect, uncorrected on `afldb_test`.** The
`afldb_test` rows `players.id` 21887 and 21927 carry the pre-fix split: `given_name` `Alex Van` /
`Hussien El`, `surname` `Wyk` / `Achkar`, `sort_name` `Wyk, Alex Van` / `Achkar, Hussien El`. On DEV
the same defect (ids 13382 and 13422) was repaired by the reviewed data-editor correction and the
override/replay fix in `issues/open/AFLDB-ISSUE-224.md` §21.3, §22.3 and §22.5. That correction has
**never been reproduced on `afldb_test`**. The emitter's surname gate is behaving as designed.

**F. The 23 Brownlow-required providers: 23/23 resolve in the new artefact.** The census was taken
over the Brownlow snapshot `-015405` (183 vote-receiving providers). The 23 without an `afl_api`
identity in `afldb_test` are all `disposition: linked` in the new artefact, including the 8
registrants from §22.12 G. Neither `CD_I1019944` nor `CD_I1030308` is Brownlow-required. The Brownlow
completion is therefore not blocked on Brownlow grounds, but the operator's contract made 669/669
the gate for step 2.

**G. STOPPED before any bridge write.** The gates for the remaining steps (validate-only, import,
identity audit, Brownlow re-settle, 183-entry leaderboard reconciliation, replay) were not run.
Batches 2415 and 2418 are untouched. 2026 `brownlow_round_votes` is still 540 rows (the batch 2418
partial state). No name was corrected by hand, and no DEV id was copied.

**H. Decision needed (operator).** Either:
1. **Reproduce the ISSUE-224 §21 name correction on `afldb_test`** (recommended). This is the same
   sanctioned `saveEdit` path, with the corrected `given_name`/`surname` for ids 21887 and 21927 and
   their durable overrides, driven against `afldb_test` rather than the DEV app. Then re-emit and
   expect 669/0/0. The steps after that are unchanged. It is a new `afldb_test` write and needs its
   own authorisation; the correct invocation route for `afldb_test` (the DEV-app UI route in
   §21.3.3 is DEV-only) still has to be established; or
2. **Accept 667/669 for this acceptance.** All 23 Brownlow-required providers resolve, so import the
   667 and continue. The 2 non-Brownlow registrants stay unresolved, with the name correction
   tracked under ISSUE-224.

**I. Status.** The stats prerequisite (§22.12 H / §22.13) is **DONE on `afldb_test`** and was
verified and proved idempotent. The bridge rebuild is **BLOCKED at the 669/669 gate** on H.
Assertion 9 is unchanged and separate. **S9 is NOT accepted.**

**Files changed (this pass):** this §22.14;
`data/reference/afl-api-player-bridge-2026-full-afldb-test-post-d8-2026-09-23.json` (A, evidence
artefact); `issues.md` (M: the ISSUE-228 mirror, the new AFLDB-ISSUE-230, and the Open Issues table
rows for 230 and the missing 227); `IssuesIndex.md` (M). No code, test or `CHANGELOG.md` change;
this is test-database evidence with no retained behaviour change.

### 22.15 §22.14 H option 1 executed: name splits corrected on `afldb_test`, bridge 669/0/0, imported; Brownlow 207 / 621 / 1,242, leaderboard 183/183, replay idempotent. Brownlow Requirement 1 PASS on `afldb_test` (2026-09-23, Opus 5.5; operator-authorised `afldb_test`-only execution; no DEV/PROD, no Git)

**A. Operator decision.** Correct only `afldb_test` players 21887 (Alex Van Wyk, `CD_I1019944`) and
21927 (Hussien El Achkar, `CD_I1030308`) to the splits DEV already accepted. Use the sanctioned
correction path, or the smallest TEST-specific equivalent that keeps the same audit invariants. No
unaudited UPDATE. Then rebuild the bridge, which must reach 669/0/0 with 23/23 Brownlow providers
linked, and run the rest of the sequence. Accepting 667/669 was rejected. Batches 2415, 2418, 2421
and 2422 are preserved.

**B. The DEV correction path, from the repository (`issues/open/AFLDB-ISSUE-224.md` §21.3, §22.3,
§22.5).** The only supported writer for player name parts is the data editor's `name` group:
`/admin/data-editor` → Server Action `saveDataEdit` (which checks
`requireCapability('data.dataEditor')`) → query-layer `saveEdit` (`src/db/queries/data-edits.ts`).
In one `afldb_import` transaction, `saveEdit`:
- reads the row with `FOR UPDATE`;
- sets `display_name`, `given_name` and `surname`, recomputes `search_name` and `sort_name`, and
  deliberately leaves `slug` untouched;
- runs `syncManualIdentityNameRecord` (§22.3 A1), which merges the name parts into the player's
  `manual_admin_edit:<token>` / `identity` creation record and writes its own `data_edits` row
  (`manual_identity_record`);
- upserts the `afltables:<path>` / `name` override in `data_overrides`;
- writes the `name` `data_edits` audit row. A failed audit rolls the edit back (ISSUE-027).

Columns changed are `given_name`, `surname` and the derived `sort_name`. `display_name`,
`search_name` and `slug` keep their values. The correction's provenance is two `data_edits` rows, one
new override and one synced creation record per player.

**C. The TEST mechanism: the same writer, re-targeted.** The DEV app cannot target `afldb_test`: it
connects with the DEV host's own `AFLDB_IMPORT_DATABASE_URL`. `saveEdit` is a plain query-layer
function whose only target input is `process.env.AFLDB_IMPORT_DATABASE_URL`. The integration suite
`tests/integration/data-editor.test.ts` drives it against `afldb_test` the same way. So a scratch
wrapper (job-tmp, not in the repository):
- set that variable in memory to the `afldb_test` importer DSN, and `DATABASE_URL` to
  `AFLDB_TEST_DATABASE_URL`;
- on that exact DSN, proved `current_database()='afldb_test'` and `current_user='afldb_import'`;
- re-checked that both rows held exactly `Alex Van`/`Wyk` and `Hussien El`/`Achkar`, and refused
  otherwise;
- called the repository's own `saveEdit({ entityKey:'players', groupKey:'name', … })` once per
  player, with `display_name` unchanged. It ran under `tsx --conditions=react-server` to satisfy
  `server-only`.

The only step bypassed is the Server Action's session capability check, because there is no HTTP
session. The acting `adminUserId` is **79**, a `super_admin`: the same actor that recorded these
players' ISSUE-224 registration on `afldb_test`. The note reads `AFLDB-ISSUE-224 §21/§22 (via
ISSUE-228 S9 §22.15, afldb_test) — correct multipart surname; authority AFL Tables / fitzRoy
issue224-inseason-20260919. …`. No raw UPDATE was issued.

**D. Preflight (read-only).** The state was exactly DEV's §22.5 pre-state:
- both rows carried the wrong split;
- `sort_name` was `Wyk, Alex Van` / `Achkar, Hussien El`;
- one active `manual_admin_edit` / `identity` override per player carried the wrong parts, and no
  `name` override existed;
- the defect-class sweep returned **2**;
- the identities were AFL Tables and `manual_admin_edit`, both `resolved`, with no `afl_api` link.

**E. Result.** `saveEdit` returned `ok` for both, changing `given_name` and `surname` only.
Postconditions were independently verified on a fresh read-only session:

| Check | Result |
|---|---|
| 21887 | `Alex Van Wyk` / **`Alex`** / **`Van Wyk`** / `Van Wyk, Alex`; `search_name` `alex van wyk` and `slug` `alex-van-wyk` unchanged |
| 21927 | `Hussien El Achkar` / **`Hussien`** / **`El Achkar`** / `El Achkar, Hussien`; `search_name` and `slug` unchanged |
| Defect-class sweep | 2 → **0** |
| No other player changed | md5 over every other `players` row identical before and after (`a6dd4096…`); 13,430 rows |
| Identities | AFL Tables (`players/A/Alex_Van_Wyk.html`, `players/H/Hussien_El_Achkar.html`) and `manual_admin_edit` identities unchanged, same players, `resolved` |
| Collisions | 0 external ids resolved to more than one player; the duplicate-slug count (460) and same-`search_name` count (2) are unchanged from the baseline |
| Overrides | New `afltables:<path>` / `name` rows 4281 and 4282 hold the corrected parts. Creation records 4199 and 4239 are synced to the corrected parts. These are the only new override rows. |
| Audit | `data_edits` 4331–4334: one `manual_identity_record` and one `name` row per player, old → new parts, actor 79. These are the only new `data_edits` rows. |
| Replay proof (§22.5 step 9 merge) | replays 21887 → `Alex`/`Van Wyk` and 21927 → `Hussien`/`El Achkar`. Equal-authority disagreements DB-wide: **0** |

**F. Bridge rebuilt, read-only: 669 / 0 / 0.** The emitter refused to overwrite the 667-link
`…-post-d8-2026-09-23.json` it had written in §22.14 ("already exists with DIFFERENT content").
That file was deliberately removed; a copy is kept in job-tmp. It was re-emitted to the same path
(sha256 `b71ac61a…b715e9`).

| Counter | Value |
|---|---|
| `PROVIDERS_LINKED` / `UNRESOLVED` / `CONTRADICTORY` | **669 / 0 / 0** |
| `PLAYER_MATCH_ROWS_UNCOVERED` | **0** (9,983 covered) |
| Canonical matches resolved / unresolved | 215 / 2 (`CD_M20260142801/802`, unchanged) |
| vs the DEV artefact (provider-id sets) | 669 both linked, 0 DEV-only, 0 now-contradictory |
| Brownlow-required providers (no `afl_api` identity before import) | **23; linked 23; unresolved 0** |

**G. Importer, `--target afldb_test` (import batch 2423).** `AFLDB_TEST_IMPORT_DATABASE_URL` was
derived in memory.
- `--validate-only`: would_link **274**, already_linked 395, 0 contradictions, 0 identity-check
  failures.
- `--dry-run`: 274 / 395 / 0.
- `--apply`: batch **2423**, `records_read 669`, `records_inserted 274`, 0 updated, 0 rejected,
  `match_method=afl_api_stat_vector_season`.

**H. External identities, independently verified.**
- `afl_api` identities went from 529 to **803** (+274), all `resolved`.
- All 669 artefact providers are present, and each points at the artefact's `candidate_player_id`.
- The 395 pre-existing links are unchanged: 300 `afl_api_stat_vector_bootstrap`, 94
  `…name_team_season_bootstrap`, 1 manual adjudication. The 274 new ones are
  `afl_api_stat_vector_season`.
- There are 0 duplicate provider ids and 0 players holding more than one `afl_api` id. The 669
  providers map to 669 distinct players, with 0 orphans.
- All **183** Brownlow vote-receiving providers now have an identity.

**I. Brownlow re-settle of the same capture (`afl-api-brownlow-2026-2026-09-23-015405`, CONCLUDED).**
- **Invocation.** The repository CLI `runAflApiBrownlowSettleCli` was run with flags `--apply
  --auto-apply --use-fixture-identity`. The wrapper injected a writer proven to be `afldb_test` /
  `afldb_import`. The CLI's own two-key preflight ran unmodified, with its control DSN pointed at
  `afldb_test`: control and writer were both `afldb_test`, the admin switch was read live, and the
  deployment key was set in the process environment.
- **Why `--use-fixture-identity`.** Without it the CLI's I244-F006 guard refused before any write:
  all 207 sets resolve only through canonical fixture identity, because these matches are
  afltables-owned and the typed staging row is absent by design. The guard recommends the flag.
  Batch 2418 planned 180 sets with 0 typed rows, so it is inferred to have used the flag as well.
  Its `notes` field does not record flags.
- **Dry run:** 207 planned, 0 refused, 81 would insert, 180 no-ops, leaderboard 183/0. It consumed
  id 2424 and left no row.
- **Apply, batch 2425:** 207 seen and planned, **0 refused**, **81 inserted** (27 sets × 3), 0
  updated, 180 no-ops, 0 apply failures, 0 stale recipients demoted, 0 data issues, 0 payloads or
  versions, leaderboard **183 compared / 0 mismatches**.

**J. Final canonical state, independently reconciled.** A separate read-only checker, not the settle
tool, maps players only through `afldb_test`'s `afl_api` identities and infers the round offset from
the data (+1).

| Measure | Required | Result |
|---|---|---|
| Vote sets complete / partial / missing | 207 / 0 / 0 | **207 / 0 / 0** |
| Allocation rows (2026 `brownlow_round_votes`) | 621 | **621** (621 matched to the feed, 0 extra, 0 zero-vote, 0 duplicates) |
| Votes | 1,242 | **1,242** |
| Leaderboard entries matched / mismatched / missing / extra | 183 / 0 / 0 / 0 | **183 / 0 / 0 / 0**, and 0 provider ids unmapped |

**K. Identical replay (batch 2426): PASS.** The same command gave `canonicalRowsInserted 0`,
`Updated 0`, `ApplicationsLogged 0`, `voteSetsNoOp 207`, 0 refused, 0 failures, 0 payloads or
versions, and leaderboard 183/0. The 2026 `brownlow_round_votes` fingerprint (md5 over every row,
by id) was `178ca2d0…` both before and after, with 621 rows and the same max id. The batch-2426
ledger has 0 rows. **Zero canonical mutation.**

**L. Preservation.** Batches 2415, 2418, 2421 and 2422 are present and unchanged. This pass added
2423, 2425 and 2426; 2424 was a rolled-back dry run. Brownlow rows were written only by the settle
CLI. DEV and PROD were not accessed, and no Git command was run.

**M. Status.**
- Requirement 1 of §22.10/§22.11 (official completed Brownlow votes, obtained, resolved to canonical
  matches and players, validated, and replayed safely and idempotently against `afldb_test`) is
  **PASS on `afldb_test`**.
- The ISSUE-224 D-8-equivalent lineage is now complete on `afldb_test`: registrant stats, the name
  correction, and the 669-provider bridge.
- **Assertion 9 (§9.9) is unchanged and separate.** It is the only S9 item this pass does not touch.
- Accepting S9 overall is the operator's decision.
- AFLDB-ISSUE-230 (the 2099 benchmark clock) remains open and non-blocking.

**Files changed (this pass):**
- this §22.15;
- `data/reference/afl-api-player-bridge-2026-full-afldb-test-post-d8-2026-09-23.json` (A, now the
  669-link artefact; untracked, so there is no Git history of the 667 version);
- `issues.md` (M, the ISSUE-228 mirror and an ISSUE-224 note);
- `IssuesIndex.md` (M).

No code, test or `CHANGELOG.md` change.

### 22.16 S9 ACCEPTED — Brownlow completed-count acceptance: PASS (operator decision, 2026-09-23)

**A. Decision.** The operator recorded **ISSUE-228 S9 — Brownlow completed-count acceptance: PASS**
on the evidence of §22.13–§22.15, all on `afldb_test`. It is not partial, provisional or blocked.
It is reopened only if new evidence directly contradicts the retained database state.

**B. Acceptance block.**

```text
Canonical:
  207 / 207 vote sets
  621 allocation rows
  1,242 total votes
  every set exactly 3 / 2 / 1 (sum 6); 0 duplicate rows; 0 extra rows

Leaderboard (official completed tracker, CONCLUDED):
  183 compared
  0 missing
  0 extra
  0 mismatches
  official total 1,242 = canonical total 1,242

Identity:
  669 / 669 AFL API providers linked
  0 unresolved
  0 contradictory
  0 player-match rows uncovered (9,983)
  23 / 23 Brownlow-required providers linked
  all 183 vote recipients hold an afl_api identity

Replay (batch 2426):
  0 canonical inserts
  0 canonical updates
  207 / 207 vote sets already current
  checksum over every 2026 Brownlow row unchanged

S9: PASS
```

**C. Evidence chain (batches on `afldb_test`).**

| Step | Batch | Result |
|---|---|---|
| Registrant stats population | 2421 | 2026 pms 8,974 → 9,890 (+916); 934 canonical rows (916 pms, 2 matches, 16 period scores); 92/92 registrants with stats, 827 rows; 0 unresolved, refusals, failures, disagreements or duplicates; source COMPLETE |
| Stats no-change replay | 2422 | 0 inserts, 0 updates, 0 retries; censuses unchanged |
| Name corrections (21887 Alex/Van Wyk `CD_I1019944`; 21927 Hussien/El Achkar `CD_I1030308`) | — (`data_edits` 4331–4334) | sanctioned `saveEdit` writer, no raw UPDATE; only the two rows changed; 2 name overrides, creation records synced, 4 audit rows; same canonical players; 0 collisions; wrong-split sweep 2 → 0 |
| Bridge rebuild (read-only) | — | `data/reference/afl-api-player-bridge-2026-full-afldb-test-post-d8-2026-09-23.json`: 217 matches, 9,983 rows, 669 providers → 669 / 0 / 0 |
| Bridge import | 2423 | validate-only and dry-run 274 new / 395 already linked / 0 contradictions (274 + 395 = 669); `afl_api` identities 529 → 803; every provider resolves to the bridge's player; 0 duplicates, 0 orphans |
| Brownlow recovery | 2425 | 207/207 planned, 0 refused; 81 inserted = the 27 previously refused sets × 3; 180 sets no-op; 0 failures; 0 leaderboard mismatches |
| Brownlow replay | 2426 | 0 inserts, 0 updates; checksum unchanged |

**D. Nuances recorded, not waived.**
- **The name corrections did not pass through the web admin permission check.** There was no
  logged-in `afldb_test` admin session, so the Server Action's `requireCapability` check was not
  exercised. The underlying sanctioned writer (`saveEdit`) and its audit, override and
  creation-record behaviour were preserved in full (§22.15 C).
- **`--use-fixture-identity` is a required, guard-supported invocation detail, not a bypass.** All 207
  matches are AFL Tables-owned. Without the flag the CLI stopped before writing and named the flag as
  the supported fixture-identity path (I244-F006 guard, §22.15 I).
- **The artificial observation clock** (`2099-01-05` / `2099-01-06`) used for batches 2421/2422 was a
  TEST-only accommodation of the pre-existing 2099 benchmark residue. That residue is tracked as
  AFLDB-ISSUE-230 (LOW, separate). It does not invalidate 2421, 2422, the bridge, the Brownlow
  acceptance or S9.
- **The 667-link bridge was intentionally replaced.** The emitter refuses silent overwrite, so the
  stale untracked file was removed before re-emission. A copy of the 667 version exists only in the
  job temp folder, outside the repository.

**E. The recovery path is part of the acceptance evidence.** The history in §22.12–§22.15 is kept
as written:
- batch 2418 safely applied only the 180 resolvable sets (540 rows, 1,080 votes);
- 27 sets were refused rather than guessed;
- the unresolved-provider count was corrected from 22 to **23** after every refused set was analysed;
- TEST stat parity was missing (the 92 registrants had no 2026 stats);
- TEST name parity was missing for Van Wyk and El Achkar;
- once that evidence was legitimately repaired, the same Brownlow capture
  (`afl-api-brownlow-2026-2026-09-23-015405`) recovered naturally to full coverage;
- no deletion of the 540 earlier rows was needed.

**F. What S9 PASS does not cover.**
- **Assertion 9 (§9.9): NOT PASSED / BLOCKED.** It is a DB-free two-capture semantic-hash
  assertion. The Brownlow acquisition, the Brownlow replay, the AFL API player bridge, canonical
  idempotence and the 207 / 621 / 1,242 result are distinct assertions and do not close it.
- **ISSUE-228 overall stays OPEN.** Assertion 9 is a required closure gate by the repository's own
  contract: `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §"Assertion 9" ("Before ISSUE-228's
  final closeout it must be either proven …, reconstructed …, or explicitly recorded as a permitted
  SKIP in the backtest manifest with reasoning"), `issues.md` ISSUE-228 "§9.10 — HISTORICAL
  CLOSEOUT" ("before ISSUE-228 is finally marked complete, assertion 9 must be …"), and §16 S3's gate
  ("backtest §9.1–9.4, 9.8, 9.9 green"). No document makes it non-blocking.
- Nothing here installs or enables a timer, touches DEV or PROD, or changes code.

**Files changed (this pass):** the CURRENT STATE block at the top of this file; this §22.16 and
§22.17; `issues.md` (M: the ISSUE-228 status pointer, mirror, and Open Issues rows for 228 and 230);
`IssuesIndex.md` (M). No code, test, database or `CHANGELOG.md` change: this records acceptance of
test-database evidence and has no retained behaviour change.

### 22.17 Assertion 9 — contract and evidence inventory (2026-09-23, read-only; no shell, DB, Git or network)

**A. The exact requirement.**
- **§9.9:** "the 10:29 and 21:41 captures of `CD_M20260142801` are parsed, canonicalised and hashed
  **with an empty exclusion list**; the expected result is `unchanged`. If they differ, the differing
  paths are printed and recorded as **evidence pair 1 of 3** in the registry `evidence[]` for the
  affected family — not added to `hash_exclusions`."
- **§19.5 (c):** "The Hawthorn 10:29 / 21:41 pair produces `unchanged` with no exclusions (or the test
  prints the differing paths and fails until they are recorded as evidence …)."
- **§16 S3 gate:** "backtest §9.1–9.4, 9.8, 9.9 green". §9 allows an explicit "fixture absent" skip,
  never a silent pass.
- **Documented closeout options** (`issues.md` "§9.10 — HISTORICAL CLOSEOUT";
  `AFLDB-2026-API-ACQUISITION.md` §"Assertion 9"): (a) prove it with a genuine second capture; (b)
  reconstruct the formal monitor-pair layout from an already-existing manual second capture whose
  bytes are inspected first; or (c) record a permitted SKIP, with reasoning, in
  `docs/rebuild-manifests/afl_api/backtest-20260919.json`.

**B. The pair is named by time, and both captures are hash-bound in the tracked manifest.** "10:29"
and "21:41" are two different captures in two different folders:

| Capture | Folder (repo-relative, gitignored) | Producer | Time | Tracked sha256 (`backtest-20260919.json`) |
|---|---|---|---|---|
| "10:29" | `data/sources/AFLWebsite/AFLGamesSamples/2026-09-19_HAW_v_BL_CD_M20260142801/` | `grab-afl-current-sample.ps1`, saves `$response.Content` | `retrievedAtUtc 2026-09-19T10:29:29Z` (`source-manifest.json`) | `01-fixture-result.json` `be99a262…`; `02-player-stats.raw.json` `bc27a2e2…`; `03-match-roster.raw.json` `9a29a7da…` |
| "21:41" | `data/sources/AFLWebsite/AFLGamesSamples/monitor-CD_M20260142801/20260919-214114/` | `monitor-match*.ps1`, saves `.Content` | `capturedAtUtc 2026-09-19T11:41:14Z` = 21:41 AEST (`snapshot-meta.json`) | `01-fixture.json` `b6fa1f3a…`; `02-player-stats.json` `bc27a2e2…`; `03-match-roster.json` `9a29a7da…` |

The tracked manifest therefore already shows that the player-stats and match-roster files of the two
captures are **byte-identical**. Only the fixture files differ. They also have different forms: the
sample serialises one element of the season feed with `ConvertTo-Json -Depth 50`, while the monitor
uses `ConvertTo-Json -Depth 100 -Compress`.

**C. Why the manifest says "1 capture (need 2)": a harness layout defect, not a missing capture.**
`tools/current-season/emit-afl-api-bundle.ts:75` excludes `monitor-*` folders from the sample scan.
`:266-289` counts only the sub-folders *inside* the monitor folder and requires two. The 10:29
capture lives outside it, in the match sample folder, so the harness can never see the named pair.
Even with two monitor sub-folders, its pass branch computes nothing: its detail string reads
"compare manually pending a named-pair harness". **As written, the harness cannot prove §9.9.**

**D. Monitor context.** `monitor-CD_M20260142801/changes.csv` has exactly one row, the 21:41
snapshot. In `monitor-match-v2.ps1:219-221` the first poll (no previous hashes) marks all three
endpoints "changed" and saves them. The 21:41 snapshot is therefore the monitor's **baseline**, not a
detected change. §2.4's "the monitor recorded all three endpoint hashes as changed" is most likely
this first-poll behaviour. Which of the three `monitor-match*.ps1` versions actually ran is not
recorded. The monitor's own hashes (`f3a1a7e8…`, `c781e1bd…`) are over PowerShell-canonicalised JSON,
not file bytes, so they do not match the file sha256 values.

**E. Evidence inventory.**

| Location | 10:29 capture | 21:41 capture |
|---|---|---|
| This worktree (`D:\dev\afldb-issue-224-s9`) | absent | absent |
| Tracked repository history | never tracked: `data/sources/*` is gitignored (`.gitignore:127-128`); only the sha256 values are tracked, in `backtest-20260919.json`. History not inspected (no Git run). | same |
| Main checkout `D:\dev\afldb\data\sources\` (the documented local snapshot root, §20.2) | no `AFLWebsite` folder | no `AFLWebsite` folder |
| `D:\dev\afldb-issue-228\data\sources\AFLWebsite\AFLGamesSamples\` (the ISSUE-228 worktree that generated the manifest) | **present** (01–05) | **present** (01–03 + meta, `changes.csv`) |
| `D:\dev\testAFLGrab\AFLGamesSamples\` (the original capture project) | **present** (01–05, `source-manifest.json`) | **present** (same set) |
| `D:\backups\afldb\` | none found | none found |

A **third, later, independent capture** of the same match exists in the authoritative S9 snapshot
`D:\dev\afldb\data\sources\afl_api\matches\afl-api-2026-2026-09-21-031725\CD_M20260142801\`
(retrieved 2026-09-21T03:18Z). Its `match-roster.json` has the same sha256, `9a29a7da…`, and its
`player-stats.json` differs (`f6e1818f…`). It is not the §9.9 named pair and is not claimed as such.

**Not yet verified:** that the on-disk bytes in either location still equal the tracked sha256
values. Proving that needs a hash command, which is not run under CLAUDE.md §9.

**F. Can it be reproduced now?** The named pair is historical (2026-09-19). A capture taken today
from the live feed cannot stand in for either one, and none should be manufactured. It does not need
to be: both historical captures appear to exist on disk and are hash-bound in the tracked manifest.
Closeout option (b) is therefore open, provided the hashes verify, without fabricating or
reconstructing any bytes.

**G. Status.** **Assertion 9: NOT PASSED / BLOCKED.** It was not run, and no manifest was
regenerated. Nothing was copied into this worktree. The blocker is now stated precisely:
1. the on-disk bytes are not yet hash-verified against the tracked manifest; and
2. the harness cannot compare the named pair (C).

It is **not** that the second capture is missing.

**H. Smallest safe next action (operator).**
1. **Verify the bytes (read-only).** Compare each printed hash with the tracked value in B:
   ```powershell
   Get-FileHash -Algorithm SHA256 -Path D:\dev\testAFLGrab\AFLGamesSamples\2026-09-19_HAW_v_BL_CD_M20260142801\0[123]-*.json, D:\dev\testAFLGrab\AFLGamesSamples\monitor-CD_M20260142801\20260919-214114\0[123]-*.json, D:\dev\afldb-issue-228\data\sources\AFLWebsite\AFLGamesSamples\2026-09-19_HAW_v_BL_CD_M20260142801\0[123]-*.json, D:\dev\afldb-issue-228\data\sources\AFLWebsite\AFLGamesSamples\monitor-CD_M20260142801\20260919-214114\0[123]-*.json | Format-Table Hash, Path -AutoSize
   ```
2. **Then decide.**
   - **(b)** Authorise a scoped named-pair fix to `emit-afl-api-bundle.ts` assertion 9. It would
     compute `semanticHash()` for each family of the 10:29 sample and the 21:41 monitor capture, with
     empty exclusions. Before the manifest is regenerated, the verified bytes would be copied
     unmodified into the target checkout's gitignored path. A differing fixture path would be
     recorded as evidence pair 1 of 3 and never excluded.
   - **(c)** Record a permitted SKIP with reasoning in the manifest.

### 22.18 Assertion 9 closed by option (b): bytes verified, harness fixed, named pair canonically unchanged — Assertion 9 PASS (2026-09-23, Opus 5.5; operator-authorised hashing, test and backtest runs; no DB, DEV, PROD or Git mutation)

**A. Phase 1: historical bytes verified (read-only `Get-FileHash`, explicit paths).** Every file
matches its tracked `backtest-20260919.json` hash, and the two surviving copies are byte-identical.

| Capture | File | SHA-256 (actual = expected) | Bytes |
|---|---|---|---|
| 10:29 (`2026-09-19_HAW_v_BL_CD_M20260142801/`) | `01-fixture-result.json` | `be99a262877603dc25f0bdcedef4763edb2baff1f40e52ec85392681be854dc5` | 3,607 |
| 10:29 | `02-player-stats.raw.json` | `bc27a2e2ad7df0150f9b960d51596a02e3e47fe07e6f0004e9c4df5acfddba9c` | 92,709 |
| 10:29 | `03-match-roster.raw.json` | `9a29a7daa679b3ac0b878bc5d7b61b78b11433708be4e1d06378a504768c1088` | 156,739 |
| 21:41 (`monitor-CD_M20260142801/20260919-214114/`) | `01-fixture.json` | `b6fa1f3ab9d541fbdcc23f77d4d1c74a71ec8efec55beff9a2de58a82573ad14` | 1,349 |
| 21:41 | `02-player-stats.json` | `bc27a2e2ad7df0150f9b960d51596a02e3e47fe07e6f0004e9c4df5acfddba9c` | 92,709 |
| 21:41 | `03-match-roster.json` | `9a29a7daa679b3ac0b878bc5d7b61b78b11433708be4e1d06378a504768c1088` | 156,739 |

Locations: `D:\dev\afldb-issue-228\data\sources\AFLWebsite\AFLGamesSamples\` and
`D:\dev\testAFLGrab\AFLGamesSamples\`. Neither the 21 September acquisition capture nor any new live
capture was used.

**B. Phase 2: the defect and the fix (`tools/current-season/emit-afl-api-bundle.ts`).**

The defect had two parts:
1. The harness counted only sub-folders inside `monitor-*` and required two, so it could never see
   the 10:29 capture, which is in the match sample folder.
2. Its "pass" branch compared nothing ("compare manually pending a named-pair harness"). The old
   harness could therefore neither prove nor disprove §9.9.

The fix:
- `ASSERTION_9_PAIR` names the pair explicitly by path, with every file pinned to the historical
  sha256 above. Nothing is discovered by scanning or folder order.
- `runSemanticPairAssertion()` builds each capture through the production emitters
  (`buildAflApiMatchBundle` → `buildAflApiSettleRecords`). These are the exact per-record payloads
  settle persists.
- It hashes each payload with `canonicalJson`, the `observations.ts` canonical form with **no
  exclusions**, whatever the registry declares.
- It compares record by record and reports per-family aggregate hashes.

Outcomes:
- missing named file → explicit `skipped`;
- bytes not the pinned capture → `fail`;
- wrong match id or a parse failure → `fail`;
- any difference → `fail` as **evidence pair 1 of 3**, with the exact differing canonical paths;
- all equal → `pass`.

`exclusionsApplied: []` is written into the manifest's new `semanticPair` record.

**C. Focused tests** are in `tests/afl-api-match.test.ts`, in a new `describe` block that builds a
throwaway project root from the trimmed `CD_M20260142801` fixture. There are 8 cases:
- the pair is named explicitly;
- one capture → skipped;
- pretty vs compact bytes of the same payloads → PASS, after a real per-record comparison of all
  three families;
- `stats.kicks` changed → FAIL, evidence pair 1 of 3, path `playerStats.stats.kicks` only;
- a volatile `lastUpdated` change still FAILs, with `exclusionsApplied: []`;
- an unrelated third monitor capture is not substituted for a missing named one;
- foreign bytes at a named path → FAIL;
- `diffCanonicalPaths` reports index, key and length differences.

Results: the new block ran 8/8 on its own, the full file 131/131, and `tsc --noEmit` was clean.

**D. Phase 3: run against the preserved bytes.**
- The capture tree (115 files) was copied **unmodified** from `D:\dev\afldb-issue-228\data\sources\AFLWebsite\`
  into this worktree's gitignored `data/sources/AFLWebsite/`. A sha256 of all 115 files, compared
  before and after the copy, was identical. `git check-ignore` confirmed the path is ignored
  (`.gitignore:128`).
- `npx tsx tools/current-season/emit-afl-api-bundle.ts` was first run to a scratch output, diffed
  against the tracked manifest, and then run for real. The only change was assertion 9, `skipped` →
  `pass`. All 58 file bindings and the discovered columns are unchanged, and every other assertion
  keeps its outcome (1–4, 8 and 10 PASS; 5–7 and 10-cont skipped as DB-bound).
- The new tracked `docs/rebuild-manifests/afl_api/backtest-20260919.json` has sha256 `551d0b55…e101a6`.

| Family | Records 10:29 / 21:41 | Canonical aggregate hash (both sides) | Result |
|---|---|---|---|
| `match` | 1 / 1 | `890d5ea17643ced19b89bed67c4993902a31300df2294f1d85b81576e5f90005` | unchanged |
| `match_roster` | 1 / 1 | `9c809a6d2eefe60d9ab521958dbc62f72f11e0a22b95f00062fb381f56c683b0` | unchanged |
| `player_match_stats` | 46 / 46 | `af0a3938391ce698912d493fbd8a905d34a05e92f1e80c9428e3044711211229` | unchanged |

Differences: **none**. The fixture files differ in bytes (pretty `ConvertTo-Json -Depth 50` against
compact `-Compress`) but are canonically identical. That is the §19.5(b) property exercised on real
data. No evidence pair was recorded, and no exclusion was proposed or needed.

**Assertion 9: PASS.** It was proven on its own terms, not from S9, Brownlow or bridge evidence.

**Provenance note.** `tools/migration/build_afl_api_player_bridge.py:690` (the S5 bootstrap builder)
records the manifest's sha256 in the artefacts it builds. Artefacts built before today record the
old manifest hash as historical provenance. No importer or validator re-verifies it.

**E. Closure review.** Every documented closure gate is now met:
- S9 PASS (§22.16);
- Assertion 9 PASS (this section);
- DEV smoke PASS (§22.9);
- DEV deployed SHA measured as `3de4eef9` (§22.9 C).

**ISSUE-228 is not marked resolved by this pass.** CLAUDE.md §5 requires genuine follow-ups to be
recorded separately at resolution, and these residuals have no owner yet:
1. **S6's two deliberately open gaps.** These are the ISSUE-131 retired-identity rekey search for
   `afl_api` (`NO_MATCH_REKEY_SCOPE`) and the `match`-family absence sweep. They were documented
   as open in 2026-09-20 S6 and have no successor issue.
2. **S8 timer installation/enablement.** It is separately authorised work, per the ISSUE-244
   handoff; the timers are not installed or enabled on any host.
3. **Admin current-season panel wiring for the AFL API units** (§17 annotation, "later follow-up").
4. **S10 successors** (fixture ingestion §13, which §16 points at "ISSUE-229", season discovery,
   `afl_api` player-link adjudication, extended families, rollover doctrine). No
   `AFLDB-ISSUE-229` entry exists in `issues.md`.
5. **§22.4 item 4's re-assessment of S9 against §19's full criteria list was never written down.**
   Only §19.1 was checked against the S9 evidence. The criteria are suite-backed from S1–S7 operator
   validation, but no single pass has recorded them all together.
6. **The work is uncommitted on `sonnet/issue-224-s9-unblock`**, including this fix, the bridge
   artefacts and these records.
7. **MANDATORY CLOSURE GATE, added by the operator on 2026-09-23: the `README.md` AFL API
   documentation.** ISSUE-228 must not close until the project `README.md` documents the complete
   supported AFL API integration, covering both the game/current-season data flow and the Brownlow
   votes flow. It must also be checked against the implemented tooling:
   - no stale command names;
   - the 14-match sample backtest is not presented as the full-season path;
   - no implication that DEV and TEST bridge artefacts are interchangeable;
   - no implication that manual identity SQL is supported;
   - no secrets;
   - replay/idempotence and the provenance/ownership safeguards are documented;
   - the TEST-only accommodations (ISSUE-230's 2099 clock) are not presented as normal operation.

   The status of this gate is recorded in §22.19.

**Operator decision needed to resolve ISSUE-228:**
- open or waive follow-ups for items 1–4;
- accept item 5 as satisfied by the stage validations, or ask for a written §19 sweep;
- commit the branch.

Then ISSUE-228 can be marked resolved: the runbook moves to `issues/closed/`, the entry leaves
`IssuesIndex.md` and the Open Issues table, and a CHANGELOG resolution entry is added. ISSUE-230
stays open either way.

**F. Files changed (this pass):**
- `tools/current-season/emit-afl-api-bundle.ts` (M, the fix);
- `tests/afl-api-match.test.ts` (M, 8 tests);
- `docs/rebuild-manifests/afl_api/backtest-20260919.json` (M, regenerated);
- `CHANGELOG.md` (M);
- this top block and §22.18;
- `issues.md` (M);
- `IssuesIndex.md` (M).

Untracked and gitignored: `data/sources/AFLWebsite/` (115 files, byte-identical copies). No
database, DEV, PROD or Git mutation.

### 22.19 Closure gate §22.18 E item 7 — `README.md` AFL API documentation: WRITTEN AND CHECKED against the tooling (2026-09-23; operator review pending; no DB, DEV, PROD or Git action)

**A. What was written.** `README.md` has a new section, "AFL API integration (current-season data
and Brownlow votes)", placed between "Admin and data management" and "Deployment and operations".
It covers:
- the pipeline, drawn as acquire → retained snapshot → spine/typed projections → identity →
  guarded canonical settle → validation/replay;
- where AFL Tables remains involved: ownership and corroboration, player identity, and fixture
  identity;
- the game-data flow and its commands;
- the player bridge: the only writer, the DEV/TEST pinned emitters, the importer's target-bound
  provenance, why artefacts are database-specific, append-only semantics, and name corrections via
  the audited data editor only;
- the settle guards: two-key enablement with the same-database preflight, offline checks before any
  connection, `--require-complete-source`, the season gate, ownership and identity safety,
  persisted refusals, and idempotence;
- the Brownlow flow: acquisition, `CONCLUDED`, the 3/2/1 all-or-none vote sets, identity,
  `--use-fixture-identity`, partial application and recovery, leaderboard reconciliation,
  post-ceremony completed-count ingestion within the season gate, and the `afldb_test`-only
  backtest flag;
- the 2026 worked example (207 / 621 / 1,242 / 183 / 0 / 0 / 0);
- the Assertion 9 stability contract and its limits;
- boundaries and follow-ups.

Two existing README statements were corrected so they no longer contradict the new section:
- the admin "Acquisition" bullet ("AFL Tables … sole automatic, canonical-write provider");
- "Data sources and acknowledgements".

**B. The check against the implementation.**

| Requirement | Result |
|---|---|
| No stale command names | Every `npm run` name resolves in `package.json`; every repository path resolves on disk. Flag sets were checked against each CLI's `KNOWN_FLAGS` / parser (`acquire-afl-api.ts`, `settle-afl-api.ts`, `settle-afl-api-fixtures.ts`, `settle-afl-api-brownlow.ts`, `acquire-afl-api-brownlow.ts`, the importer's argparse). The plan's `bridge:afl-api` script (§17) does not exist and is not used. |
| 14-match sample not presented as full-season | `npm run emit:afl-api` is described as the DB-free backtest; `build_afl_api_player_bridge.py` as the historical 14-match S5 bootstrap, "**not** the full-season path". |
| DEV/TEST bridge artefacts not interchangeable | Stated, with the importer's target-bound gate (`SEASON_EVIDENCE_PROVENANCE_BY_TARGET`) and "never copy one across". |
| No implied manual identity SQL | Stated: the importer is the only `external_identities` writer; name fixes go through the audited data editor. |
| No secrets | No DSN, token, password or hash-like secret. Only setting keys and the non-secret enable flag name `AFLDB_AFL_API_BROWNLOW_ENABLED` appear. |
| Both flows documented | Yes. |
| Replay/idempotence documented | Yes, for both flows. |
| Provenance/ownership safeguards documented | Yes. |
| 2099 clock not presented as normal operation | Described only as a TEST-only accommodation tied to ISSUE-230. Real runs use the real clock. |

**C. Finding made while checking (documented, not changed).** `deploy/afldb-settle-afl-api-brownlow.sh`
runs `settle-afl-api-brownlow.ts --apply --auto-apply` **without** `--use-fixture-identity`. For a
season whose matches are AFL Tables-owned, the scheduled chain would therefore stop safely before
writing: the I244-F006 guard refuses. The 2026 completed count was ingested by an operator
invocation with the flag. This belongs with residual item 2 (timer installation/enablement): the
chain needs a reviewed decision on the flag before the Brownlow timer can be useful. The README
states the limitation. No deploy file was changed.

**D. Gate status.** Item 7 is **written and checked**. It is complete once the operator has reviewed
the README text. It does not close ISSUE-228 by itself: items 1–6 of §22.18 E still need operator
disposition.

> **Update 2026-09-23 (later same day): the operator accepted the README gate. Item 7 = PASS.**
> Items 1–6 are classified in §22.20.

**Files changed (this pass):**
- `README.md` (M);
- this §22.19 and §22.18 E item 7;
- `issues.md` (M: mirror bullet and Open Issues row);
- `IssuesIndex.md` (M).

No `CHANGELOG.md` entry: this is documentation with no behaviour change. No code, test, deploy,
database or Git change.

### 22.20 Closeout review of the §22.18 E residuals — ISSUE-228 technical acceptance COMPLETE (2026-09-23; operator-authorised DB-free tests and read-only Git; no DB, DEV, PROD or Git mutation)

**Inputs accepted without re-opening:** S9 PASS (§22.16), Assertion 9 PASS (§22.18), README gate PASS
(§22.19 update). ISSUE-230 stays separate and non-blocking.

Classes: **A** must complete before closure; **B** already satisfied; **C** explicit successor or
follow-up, non-blocking; **D** obsolete or superseded; **E** needs an operator decision.

**A. Residual matrix.**

| # | Requirement (§22.18 E) | Evidence / current state | Blocking? | Class | Next action |
|---|---|---|---|---|---|
| 1a | ISSUE-131 retired-identity rekey search for `afl_api` (`NO_MATCH_REKEY_SCOPE`) | Deliberately left open in the S6 closure pass. That pass records that it is "neither named by a literal §19.1–§19.7 acceptance item" (`issues.md`, S6 closure pass). S6 operator validation says "do not block S7; S6 core operational path is now COMPLETE". Scope is narrow: an `afl_api` row whose provider id was never linked and whose natural key has since been retired (acquisition doc §14.15). Provider-id-first and `match_key` resolution are unaffected. ISSUE-244 F031 census: 0 `afl_api`-owned matches exist. Brownlow never creates a match and uses the same scope (`afl-api-brownlow.ts:470`). | No | C (+E: open or waive) | Open a successor issue, or waive it with a recorded reason. |
| 1b | `match`-family absence sweep | Not implemented. It needs season-enumeration completeness that `AflApiSettleBundle` does not carry (S6 closure pass; acquisition doc §14.15). ISSUE-244 I244-F025 recorded it as INFO / NOTED, a documented gap. Consequence: a match that leaves the AFL feed is not flagged by this source. AFL Tables' own sweep is unaffected, and no canonical data is written wrongly. There is no Brownlow effect. | No | C (+E) | Same as 1a. It can share a successor with 1a. |
| 2 | S8 timer installation/enablement | S8's gate is `sh -n` + DEV dry-run (§16), recorded COMPLETE (acquisition doc §14.0). Its units are "NOT installed, enabled or started on any host … approved artefacts for a future DEV/production wiring pass" (§14.7). ISSUE-244 returned timer enablement as "separately authorised work". Nothing in §16–§19 makes an installed timer a closure criterion. | No | C (+E) | Operator authorises the wiring pass separately. See B below for the wrapper decision it carries. |
| 3 | Admin current-season panel wiring for the AFL API units | §17 annotation: "Admin-panel wiring … NOT been done and remains a later follow-up". §14.7: extending the "start now" trigger is "a disclosed follow-up". Already built: both ingestion switches on `/admin/current-season` (`AflApiIngestionControls.tsx`, §14.6) and `readSettleUnitTableStatus()` (`settle-status.ts:98`). No UI consumes that status function yet. Manual operation is documented (§14.7, §14.8, README). | No | C (+E) | Open a successor issue for the unit-status display and trigger, or waive it. |
| 4 | S10 successors | §16 S10: "separate issues", gate "—". §13.1: fixture ingestion is a "successor issue, not an ISSUE-228 stage". §19.3(c): ISSUE-101/F owns the rollover runbook change "not implemented here". None is allocated. `AFLDB-ISSUE-229` appears on no branch as an entry (read-only `git grep` of every local and remote ref: only as the plan's recommendation). ISSUE-101 is Resolved (`issues.md` ISSUE-101 entry), so the rollover-runbook item has no open owner. | No | C (+E) | Allocate successor entries, or waive: (i) fixture ingestion as `AFLDB-ISSUE-229`, as the plan reserves; (ii) season discovery; (iii) `admin/player-links` `afl_api` adjudication; (iv) optional extended stats, umpires and play-by-play families; (v) the rollover runbook change that ISSUE-101/F no longer owns. |
| 5 | §22.4 item 4: re-assessment against §19's full criteria | Done in C below: DB-free suites re-run on this branch; DB-bound criteria rest on recorded `afldb_test` runs of code this branch does not modify. | No | B | None. |
| 6 | Work uncommitted on `sonnet/issue-224-s9-unblock` | 15 modified tracked files, 5 wanted untracked files, 6 stray zero-byte files (inventory in the session report). | Mechanical | E (operator Git) | Operator reviews the diff and commits. |
| 7 | README AFL API documentation | Operator accepted it, 2026-09-23. | No | B | None. |

The operator-contract changes are already recorded, so nothing is class D among the numbered items.
§18 item 10 (live-count capture) was superseded by the completed-count contract in §22.11. That is
D, and it was already applied when S9 was accepted.

**B. Timer / deploy-chain finding (`deploy/afldb-settle-afl-api-brownlow.sh:135-136` omits
`--use-fixture-identity`).**
1. *Required before closure?* No. See item 2.
2. *Deliberately deferred?* Yes, twice over. Timer wiring is separately authorised work (§14.7).
   The omission itself was dispositioned **ACCEPTABLE FAIL-CLOSED** by ISSUE-244 §40: "the generic
   scheduled Brownlow wrapper intentionally continues to omit `--use-fixture-identity` and will fail
   visibly … rather than the flag being enabled implicitly". Changing the wrapper reverses a closed
   operator disposition, so it is an operator decision (E), not an ISSUE-228 fix.
3. *Would a permanent flag be correct?* Probably, once timers are wired. For an AFL Tables-owned
   season (2026: 0 `afl_api`-owned matches), every vote set needs the fallback, so the wrapper as
   written can never write a vote. The chain also depends on the match-family chain having persisted
   each match's fixture observation first (`resolveAflApiMatchViaFixtureObservation()` refuses
   `no_fixture_observation` → `unknown_match` otherwise).
4. *Unsafe for matches not owned by AFL Tables?* No. The flag is consulted only when a vote set has
   **no** typed `staging.afl_api_match` row (`afl-api-brownlow.ts:430-432`). An `afl_api`-owned or
   new match has one, so it keeps the staged, provider-id-first path with its
   `provider_identity_contradiction` HALT (`:470-477`). One nuance, recorded as INFO and not a
   defect: the fallback path has no provider-id contradiction check of its own. It relies on the
   (season, home club, away club, exact venue-local date) key being unique, which it enforces
   (0 → `unknown_match`, >1 → `fixture_identity_ambiguous`, `afl-api-fixture-identity.ts:329-338`).
5. *Is validation strong enough for a permanent flag?* Yes, from code:
   - The fallback is **SELECT-only**. It reads the persisted fixture spine head, re-parses it under
     the registry contract, and refuses `fixture_observation_invalid`, `match_date_unavailable` or
     `unmapped_club_hist`.
   - It resolves an **existing** `matches` row and never proposes `new_target` (`:420-425`).
   - `afl-api-brownlow.ts` issues no `matches` write. Its only direct writes are
     `staging.afl_api_brownlow_vote`, `import_batches` and `import_rejections`. Canonical votes go
     through `applyCanonicalUnit()` to `brownlow_round_votes` only.
   - Match ownership therefore never transfers, and AFL Tables-owned match data is never
     overwritten. Foreign-owned vote rows refuse the whole set (ISSUE-244 §20.6), and a vote-row
     `match_id` conflict refuses as `match_identity_conflict` (F007).
   - A wrapper-level condition would add nothing, because the CLI already decides per vote set.
   **Recommendation for the future wiring pass (not implemented here):** add `--use-fixture-identity`
   unconditionally to the wrapper's settle line. Record it as the operator's reversal of the
   ISSUE-244 §40 disposition. Prove it with `sh -n` plus a DEV `--dry-run` of the chain.

**C. §19 sweep (item 5), 2026-09-23, on this branch.**

| Command | Result |
|---|---|
| `npx vitest run tests/afl-api-match.test.ts tests/reference-data.test.ts tests/afl-api-rounds.test.ts tests/current-season-import.test.ts tests/afl-api-brownlow.test.ts tests/afl-api-settle-cli-gate.test.ts tests/afl-api-settle-plan.test.ts tests/afl-api-player-evidence.test.ts tests/afl-api-player-bridge-cli.test.ts tests/afl-api-ingestion-safety.test.ts` | **10 files, 728 passed, 4 skipped**. The skips are `current-season-import.test.ts`'s standing 4, recorded since S6. There were no failures. The acquisition tests wrote only OS-temp snapshot directories. |
| `npx tsc --noEmit` | exit 0 |
| `python tests/python/afl_api_bridge_contract.py` | "All afl_api player-bridge contract checks passed." exit 0 |

Coverage per criterion:
- **DB-free criteria, re-proven now:** §19.1(d)(e), §19.2(f)(g), §19.3(b), §19.4(a)(b)(e), §19.5
  (a)–(d), §19.6(a), §19.7 (a)–(h).
- **§19.3(a):** satisfied by the acquisition doc's 2026-09-21 Q7 amendment (line ~401).
- **§19.5(c):** Assertion 9 (§22.18).
- **§19.5(e):** vacuous, because no exclusion exists.

The **DB-bound** criteria are §19.1(a)–(c), §19.2(a)–(e2), §19.4(c)(d) and §19.6(b)–(f). They live
in `tests/integration/settle-afl-api.test.ts`, which writes to `afldb_test`. That suite was **not run
in this pass** (the DB-mutation boundary). Its last recorded result is **28/28 PASS** (ISSUE-244 §55,
2026-09-22, including the F030 8/8). This branch changes none of the code under it:
- the only `src/` change is `afl-api-player-evidence.ts`, an evidence-target parametrisation used by
  the bridge emitters;
- no settle core, `canonical-apply.ts`, resolver or migration file changed (`git diff --stat` against
  merge base `7f242ecc`).

The recorded result therefore still describes this code. The operator may re-run it on `afldb_test`
before the commit if they want a same-SHA record. It is not required by any documented gate.

**D. Conclusion.** **ISSUE-228 technical acceptance: COMPLETE.** No A-class item remains. The
remaining steps are operator-controlled:
1. open or waive the successors for items 1–4;
2. review and commit the branch;
3. resolve: move this runbook to `issues/closed/`, remove the IssuesIndex / Open Issues rows, add the
   CHANGELOG resolution entry;
4. any timer/DEV deployment, separately authorised.

**Files changed (this pass):**
- this top block, §22.19 D and §22.20;
- `issues.md` (M);
- `IssuesIndex.md` (M);
- `CHANGELOG.md` (M: corrected the stale "not imported" line of the 2026-09-23 bridge entry).

No code, test, deploy, database or Git change.

### 22.21 Closure preparation — successors allocated, workspace cleaned, CHANGELOG prepared (2026-09-23; operator-authorised DB-free tests and read-only Git; no DB, DEV, PROD or Git mutation)

**Inputs accepted without re-opening:** technical acceptance COMPLETE (§22.20). ISSUE-230 is
unchanged.

**A. Successor allocation.** Before allocating, the numbers were checked with read-only
`git grep` across every local and remote ref, and in the ledgers of every sibling worktree.
Only `AFLDB-ISSUE-229` appears, as the plan's reservation. 231–239 are unused everywhere, and 230 is
this branch's own uncommitted entry.

| Former residual (§22.18 E / §22.20) | Disposition |
|---|---|
| 1a ISSUE-131 retired-identity rekey for `afl_api` | **AFLDB-ISSUE-231** (Low). Hardening, not known corruption: it fails safely, and 0 `afl_api`-owned matches exist. |
| 1b `match`-family absence sweep | **AFLDB-ISSUE-231**, shared with 1a. |
| 2 S8 timer installation/enablement | **AFLDB-ISSUE-232** (Medium). It carries the Brownlow wrapper's `--use-fixture-identity` decision (a reversal of ISSUE-244 §40, §22.20 B) and the match-before-Brownlow ordering. `deploy/` was not changed. |
| 3 Admin current-season panel status and trigger | **AFLDB-ISSUE-232**, as operator/admin tooling (status display only). |
| §22.9 "reading 1": automatic `revalidateSeason()` after an unattended `settle-afl-api.ts` run | **AFLDB-ISSUE-232**. Not in the §22.18 E list, but §22.9 recorded it as a non-blocking follow-up with no owner. |
| 4(i) fixture ingestion | **AFLDB-ISSUE-229** (Medium), the reserved number, fixture ingestion only. |
| 4(ii) season discovery | **AFLDB-ISSUE-233** (Medium). |
| 4(iii) `admin/player-links` `afl_api` adjudication | **AFLDB-ISSUE-235** (Medium), standalone. A human `resolved` link would be a second `afl_api` identity writer beside the importer, which changes adjudication semantics rather than displaying status. |
| 4(iv) extended stats, umpires, play-by-play | **AFLDB-ISSUE-234** (Low). Optional; not required by this architecture. |
| 4(v) rollover runbook change (ISSUE-101/F, Resolved) | **AFLDB-ISSUE-233**, which replaces ISSUE-101/F as owner. |
| 5 §19 re-assessment | Satisfied (§22.20 C). |
| 6 uncommitted branch | Operator Git (below). |
| 7 README gate | PASS. `README.md` "Boundaries and follow-ups" now names the successor numbers. |

The frozen plan text is unchanged. Dated annotations were added under §13.1, after the §16 stage
table and at §19.3(c). The acquisition doc's known-gaps list gained a dated owner note. Its
"tracked manifest gap" (the acquisition tools do not copy their manifest into
`docs/rebuild-manifests/afl_api/`) was never an ISSUE-228 residual and has no successor. It is left
for an operator decision.

**B. Workspace cleanup.** The six root files `0)`, `1)`, `60s`, `and`, `clarification` and
`inspection` were each confirmed untracked (`git ls-files --error-unmatch`), zero bytes, and not
referenced by any repository file as a path. They were deleted with an explicit `rm` of those six
names, not `git clean`. A seventh zero-byte file, `1`, was created by this session's own tool calls
(mtime 2026-09-23 18:09) and was removed the same way. Nothing else was deleted.

**C. Reference artefacts kept, and why both `afldb_test` bridges stay.**

| File | Built from | Linked / unresolved / contradictory | Role |
|---|---|---|---|
| `data/reference/afl-api-player-bridge-2026-full-2026-09-21.json` (already tracked) | `afldb_dev` | 577 / 92 / 0 | Historical DEV bridge. It was not touched here. |
| `data/reference/afl-api-player-bridge-2026-full-2026-09-22.json` | `afldb_dev` | 669 / 0 / 0 | The DEV bridge after ISSUE-224 D-8 (§22). |
| `data/reference/afl-api-player-bridge-2026-full-afldb-test-2026-09-23.json` | `afldb_test` | 577 / 92 / 0 | **Evidence of the pre-D-8 TEST state** (§22.12 F). It proves the test-native emitter and the target-bound importer gate on real data, and records why the first TEST build was not imported (8 Brownlow providers lacked canonical stats). **It is not stale and not a duplicate. Do not delete it in a clean-up.** |
| `data/reference/afl-api-player-bridge-2026-full-afldb-test-post-d8-2026-09-23.json` | `afldb_test` | 669 / 0 / 0 | **The accepted TEST bridge**, imported as batch 2423. S9 rests on it (§22.15–§22.16). |

The DEV and TEST artefacts are not interchangeable. The importer refuses either one for the other
target.

**D. CHANGELOG.** A capability summary entry, "AFL.com.au official APIs as the current-season match,
player-stat and Brownlow source (AFLDB-ISSUE-228)", was added at the top of `[Unreleased]`. It is
**not** marked Resolved: by repository convention the "(Resolved)" heading comes with the
resolution step. It does not present the TEST-only 2099 clock as functionality.

**E. Lightweight validation (after these edits).**

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| The §22.20 C ten-file `npx vitest run …` | **10 files, 732 passed, 0 skipped** |
| `python tests/python/afl_api_bridge_contract.py` | "All afl_api player-bridge contract checks passed." exit 0 |

The difference from §22.20 C's 728 passed / 4 skipped is environmental, not a code change. The four
standing skips are `it.skipIf(!haveSh)` in `tests/current-season-import.test.ts` (`haveSh` probes
`sh -c 'exit 0'`). This run executed under Git Bash, where `sh` is on PATH, so all four ran and
passed. No database cycle was run: this pass changed documentation and issue records only.

**F. Intended commit inventory** (nothing staged):
- **CODE:** `src/lib/acquisition/afl-api-player-evidence.ts`; `tools/current-season/emit-afl-api-bundle.ts`;
  `tools/current-season/emit-afl-api-player-bridge.ts`; `tools/migration/import_afl_api_player_bridge.py`;
  `package.json`; new `tools/current-season/emit-afl-api-player-bridge-test.ts`; new
  `tools/current-season/audit-afl-api-player-bridge-persisted.ts`.
- **TESTS:** `tests/afl-api-match.test.ts`; `tests/afl-api-player-bridge-cli.test.ts`;
  `tests/afl-api-player-evidence.test.ts`; `tests/python/afl_api_bridge_contract.py`.
- **DOCUMENTATION:** `README.md`; `CHANGELOG.md`; `docs/acquisition/AFLDB-2026-API-ACQUISITION.md`.
- **ISSUES / SUCCESSORS:** `issues/open/AFLDB-ISSUE-228.md`; `issues.md` (the ISSUE-228 mirror,
  ISSUE-230, and the new ISSUE-229 and ISSUE-231–235); `IssuesIndex.md`.
- **REFERENCE EVIDENCE:** `docs/rebuild-manifests/afl_api/backtest-20260919.json`; the three
  untracked `data/reference/afl-api-player-bridge-2026-full-*` artefacts in C.

Excluded: `data/sources/AFLWebsite/`, which is ignored (`.gitignore:128`, `/data/sources/*`) and
does not appear in `git status`. No secrets were found: the only DSNs in the diff and the new files
are test placeholders (`u:p@h`). There are no deploy, DEV or production runtime artefacts, and no
unrelated changes. The two `afldb_dev`-built bridge JSONs are reference evidence, not DEV runtime
state.

**G. State.** **ISSUE-228: OPEN — technical acceptance complete; awaiting operator commit.** Not
moved to `issues/closed/`, not marked Resolved, and nothing was staged, committed, merged or pushed.
After the commit, resolution bookkeeping follows: move this runbook, remove the IssuesIndex and Open
Issues rows, and add "(Resolved)" to the CHANGELOG entry. Merge and deployment are separate.

**Files changed (this pass):** this top block, the annotations under §13.1, §16 and §19.3(c), and
this §22.21; `issues.md`; `IssuesIndex.md`; `README.md`; `CHANGELOG.md`;
`docs/acquisition/AFLDB-2026-API-ACQUISITION.md`. Deleted: the six untracked stray files, plus the
session-created `1`.

### 22.22 Resolution — RESOLVED / CLOSED (2026-09-23; bookkeeping only; no DB, DEV, PROD, network or Git mutation)

**Status:** Resolved — 2026-09-23.

**Commit:** the operator committed the §22.21 F inventory as `6eae820c` ("feat(acquisition): AFL API
current-season and Brownlow source acceptance (ISSUE-228)") on `sonnet/issue-224-s9-unblock`. The
working tree was clean after that commit. This resolution pass is issue and documentation
bookkeeping only. It is not merged, pushed or deployed.

**Gates at resolution** (none re-run here; each rests on its recorded section):

| Gate | Result | Record |
|---|---|---|
| S9 — Brownlow completed-count acceptance | **PASS** (`afldb_test`: 207 vote sets, 621 rows, 1,242 votes; leaderboard 183 compared, 0 missing/extra/mismatched; bridge 669/0/0; replay 0 mutations) | §22.15, §22.16 |
| Assertion 9 (§9.9) | **PASS** (named 10:29 / 21:41 pair hash-verified; match 1/1, match_roster 1/1, player_match_stats 46/46 canonically unchanged, no exclusions) | §22.18 |
| README AFL API documentation gate | **PASS** (operator-accepted) | §22.19 |
| §19 validation | **PASS** (DB-free sweep; DB-bound criteria on the recorded `settle-afl-api.test.ts` 28/28, ISSUE-244 §55) | §22.20 C, §22.21 E |

**No ISSUE-228 technical blocker remains.**

**Successors (open, owned elsewhere):** AFLDB-ISSUE-229 fixture ingestion; AFLDB-ISSUE-231
retired-identity rekey and `match`-family absence sweep; AFLDB-ISSUE-232 timers, Brownlow wrapper
`--use-fixture-identity` decision, match-before-Brownlow ordering, admin unit status and automatic
revalidation; AFLDB-ISSUE-233 season discovery and rollover; AFLDB-ISSUE-234 optional feeds;
AFLDB-ISSUE-235 `afl_api` player-link adjudication. **AFLDB-ISSUE-230** (the `afldb_test` 2099
clock) is separate TEST hygiene and stays open. Resolving ISSUE-228 does not install or enable any
timer.

**Bookkeeping applied:** this runbook moved from `issues/open/` to `issues/closed/` with its content
and evidence history unchanged apart from the top status block, the relabelled technical-acceptance
block beneath it, and this section. The ISSUE-228 rows were removed from `IssuesIndex.md` and the
`issues.md` Open Issues table. The `issues.md` detailed entry was marked Resolved. The CHANGELOG
entry was marked "(Resolved)". Active documentation links in `docs/` were repointed to
`issues/closed/AFLDB-ISSUE-228.md`. Historical "Files changed" lines in this record and in other
issue records that name `issues/open/AFLDB-ISSUE-228.md` are evidence of where the file was at the
time, and were left as written.
