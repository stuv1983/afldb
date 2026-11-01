# Brownlow gaps V2-GAP-016 / 030 / 031 — fresh production read-only census and execution-ready plan (2026-11-01)

Status: **prepared; nothing was executed.** No production data, schema, role, service or file was changed. The
census below replaces the archive expectations in [the approval package](brownlow-production-approval-package-2026-10-20.md)
as the current baseline. Policy approvals are unchanged: D-V2-BROWNLOW-MATCH-BACKFILL-1 (1984–2025),
OD-BROWNLOW-OWNERSHIP-1 (2025) and D-V2-BROWNLOW-ELIGIBILITY-1 ([record](brownlow-policy-decisions-2026-10-20.md)).
**2026 stays excluded from every operation.** Migrations 116/117 were installed 2026-10-31 (A-REL, ledger 117).

## 1. How the census was taken

Three SSH sessions to `afldb-prod` as `arm` between 2026-11-01T01:25Z and 01:28Z (no sudo, no remote file change). Each
ran `psql` as role `afldb_import` (DSN read from the checkout `.env` inside the session, never printed) with
`default_transaction_read_only=on`, `statement_timeout` 60–120 s and `lock_timeout` 3 s. Scripts and output:
[`evidence/brownlow-prod-readonly-census-2026-11-01.txt`](evidence/brownlow-prod-readonly-census-2026-11-01.txt)
(sha256 `bc03e925792481ce0bc4bfdba5ef1ee712315225a1bd34fb6f58850f283bb0f6`).

**Identity matches the A-REL record:** host `afldb-prod`, database `afldb_prod`, OID **66668**, system identifier
**7674454702926115004**, cluster `16/main`, transaction read-only `on`.

**Not readable with this role (owner-only, unchanged):** `afldb_meta.schema_migrations` and
`public.brownlow_correction_receipts` (`permission denied`; nobody was asked to grant anything). So today's census does
**not** re-prove ledger 117 or the empty receipt ledger; those remain as recorded in
[the A-REL record](production-execution-record-2026-10-31.md) and must be re-read by the operator role at plan time.

## 2. Current production facts

| Fact | Value | Against the archive expectation |
|---|---|---|
| `brownlow_round_votes` total | **330,383** | equal |
| 1984–2025 | 320,861 rows, 42 seasons, **match_id NULL on all 320,861**; 22,239 positive, 298,622 zero; source_id NULL on all | equal (expected 320,861) |
| 2026 | 9,522 rows, `afltables`-owned, match_id NULL; excluded | equal |
| 2025 | 9,522 rows, **no source** (legacy, source-less): 621 positive, 8,901 zero | equal (621 / 8,901) |
| Backfill classification, scope 1984–2025 (the module's `CLASSIFY_SQL`, scope as a literal) | **320,861 repairable; 0 excluded** (0 no_candidate, 0 ambiguous, 0 mirror disagreement, 0 pair/slot clash); mirror recorded on all 320,861 and agrees | equal (0 excluded) |
| 2025 positives mapped | 621 rows across **207 distinct matches** | equal (207 sets) |
| `staging.afl_api_brownlow_vote` | **0 rows** (nothing observed yet) | new fact: `observe` has not been run |
| `data_issues` of any Brownlow type | **0 rows (resolved or not)** | new fact: no `ownership_indeterminate` issue exists on production |
| `brownlow_eligibility_decisions` / `brownlow_season_authority` | 0 / 0 | consistent with no eligibility operation |
| `brownlow_season_votes` | 16,120 rows, seasons 1924–2025 | not part of any operation |
| `brownlow_vote_entry_state` | 1 row: season 2026, status `draft`, match 17137 | 2026 untouched; **production has 2026 matches the disposable clones lack** |

Informational fingerprints computed with the same formulation as the module's `FINGERPRINT_SQL` (not byte-verified
against it; the authoritative values come from the tool's own `baseline`/`plan` at execution time): columns hash,
scope 1984–2025 `bc52f294822559af08ce9de5997862ccca322a8b423c0751485ab69d3b4a418d`; 2026
`91160419b77e52d618d52fd044b6a49660b2172b1e0984af045818da987f1337`; mapping hash of both scopes is the SHA-256 of
the empty string (`e3b0c442…b855`), which is what "zero mapped rows" looks like. Informational proposal digest over
the 320,861 `id:match_id` pairs: `ba6048e741d7ac352e863f730d43d7bb1869961137e2981fa3cd16f723afd500`. It is **not** an
execution-plan digest and approves nothing.

## 3. What this changes in the packages

- **GAP-030 (backfill):** the fresh counts equal the rehearsal exactly; the 320,861-row scope has no exclusion class
  to review. Ready for the E-approval flow (section 4, step B).
- **GAP-031 (adoption):** adoption cannot be planned on production yet. The plan joins the **staged** afl_api
  Brownlow votes, and staging is empty. `observe` (the 2025 recording) is the first operation, then `adopt`.
- **`resolve`:** there are no Brownlow `data_issues` on production, so there is nothing for `resolve` to close.
  The settle refusal (`ownership_indeterminate`, 207 sets) arises only when the Brownlow settle is run, and it has not
  run there. `resolve` is therefore **not needed unless issues appear**; do not plan it.
- **GAP-016 (reconciliation):** the public publication path and the 98/98 local seasons are as recorded; what remains is
  the recording (`observe`), the match-ID backfill and the ownership adoption above, and the reconciliation acceptance
  after them. The `eligibility` operation (twelve rulings) stays separate and unstarted (0 decisions).
- **GAP-029 caveat:** production has at least one 2026 match, so my earlier statement that the 8 dated-membership cells
  cannot be checked rests on the disposable clones only; see the update in
  [the GAP-029 record](gap-029-match-event-correction-2026-11-01.md) §4.

## 4. Ordered execution plan (owner-attended; none approved)

Common gates for every step (from the package): reviewed clean checkout at a stated full revision; target.json from
independent facts (host `afldb-prod`, port, database `afldb_prod`, OID 66668, system identifier 7674454702926115004,
cluster `16/main`, comment as read by the operator); verified backup plus restore evidence no older than 24 hours with
`baselineDigest` equal to the fresh target baseline; migrations 116/117 and the receipt ledger read by the operator
role; settle gate quiet (the legacy writers are retired); DSN supplied only as `AFLDB_BROWNLOW_CORRECTION_DSN`. Each
step has its **own** plan, execution approval and fresh baseline; no multi-operation batch on a stale baseline.

| Step | Operation (request file) | Expected write | Acceptance check | Reversal |
|---|---|---|---|---|
| A | `baseline` on production, then on the restored copy | none | `baselineDigest` equal; both reports kept in the restore evidence | none needed |
| B1 | `observe`, `{"operation":"observe","seasons":[2025]}`, `--snapshot-label afl-api-brownlow-2025-2026-10-20-014218`, source `afl_api` | spine, typed staging (207 sets, 188 leaderboard players), batch, receipt; no canonical vote write | staging has 621 positive rows and 207 sets; round-vote fingerprints unchanged; receipt present | observations are retained history; supersede, never erase |
| B2 | `backfill`, seasons 1984…2025 named explicitly, source `legacy` | `match_id` set on **320,861** rows; receipt | the rehearsal fingerprints: only `mapped_rows` 0 → 320,861 moves; indexes valid; FKs validated; 2026 hash `9116…1337` unchanged | `reverse-backfill` plan/approval from the original export and receipt, only while the post-state is unchanged |
| B3 | `adopt`, `{"operation":"adopt","seasons":[2025]}`, source `afl_api` | 621 provenance changes, 621 audit rows, batch, receipt; 8,901 zero rows preserved with original provenance | planner reports 207 adoptable, 0 refused; 621 values equal the staged values; zero rows untouched | `reverse-adopt` before any later write; an API write blocks reversal |
| C | Reconciliation acceptance | none | owner records acceptance of B1–B3 evidence against the 98/98 local-season record; GAP-016 narrowed accordingly | n/a |

Prerequisite file: the pinned snapshot `afl-api-brownlow-2025-2026-10-20-014218` (2 raw files + manifest; manifest
sha256 `43dec3ee84e2bd622a9d33899eb16896487d5344f5225eaa819b5a1262bb47f3`, both file hashes re-verified today) is held at
`D:\tmp\afldb-gap006-brownlow-artifacts-20261101\acq-x\`, **outside any checkout**; it must be placed under the reviewed
checkout's acquisition directory before B1. No provider is contacted.

## 5. What the owner must provide or decide

1. Name the **window** and the operator (the role that can read `afldb_meta` and the receipt ledger, and run `pg_control_system()`).
2. Take and restore-verify a **fresh backup** (24-hour freshness) and run step A.
3. Give a separate written **execution approval** per step (B1, B2, B3), each bound to its fresh plan digest, target, full
   revision, season list, source, expiry (not after the plan's) and a reference of at least 20 characters.
4. Place the snapshot into the checkout, and confirm that skipping `resolve` is accepted (no issues exist).
5. Decide whether the `eligibility` rulings (twelve) are executed in this window or later.

No timer, deployment, writer or provider is activated by any step.
