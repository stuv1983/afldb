# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-08-29
**Open issues:** 4

## How Claude should use this file

- Read this file once near the start of technical AFLDB work.
- Use it to identify overlap with a known open issue.
- If an issue is relevant, read only that exact detailed entry from `issues.md`.
- Do not read all of `issues.md` just to understand current project problems.
- When an issue is created, reopened, resolved, materially reclassified, or
  given a materially different next action, update this file in the same task.
- Keep this file synchronized with the Open Issues table at the top of
  `issues.md`.

## Open issues at a glance

| Issue | Severity | Area | Current state |
|---|---|---|---|
| `AFLDB-ISSUE-107` | Medium | Framework / Runtime / Deployment | **Open; deployed and proven live on Linux dev.** Next 16.3.1/Webpack, React/ReactDOM 19.2.8, Node v22.23.2; typecheck 0 errors; complete standalone build `uZReW8G1XnsGnG5FNYY-I` proven live via `x-afldb-build`; systemd healthy at unchanged 4 workers / pool 10; 17/17 live routes clean with zero hydration/client errors. Only guarded database integration is not green, blocked by `AFLDB-ISSUE-108` and provably not framework attributable. |
| `AFLDB-ISSUE-109` | Medium | Admin / Privileges / Data integrity | **Open.** The data editor's override save inserts into `data_overrides` on the `afldb_import` connection, but migration `073` grants that role `SELECT` only and `privileges.sql` agrees. Latent since `073`; applying it to `afldb_dev` moved the failure from *relation does not exist* to *permission denied*. Fix belongs in a new migration or by moving the write off the importer connection — never a hand-granted privilege. |
| `AFLDB-ISSUE-108` | Medium | Test database / Data integrity | **Open.** `afldb_test` is at 77/77 migrations but its data predates the current full-history expectations, failing 33 guarded integration tests on content. `db:test:rebuild` is blocked: the gitignored DraftGuru corpus and `AFLDB_TEST_IMPORT_DATABASE_URL` are both absent on the dev host. Three further failures are shared-database interference under default vitest parallelism. |
<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-090` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "Next action" text is SUPERSEDED. Authoritative records:
     the `AFLDB-ISSUE-090` entry in `issues.md` (Resolution, 2026-08-28) and
     `AFLDB-ISSUE-090.md` §27. Final evidence: DOB reconciliation suite 27/27, the canonical
     external-identity release assertion 1/1 (pin 13,275), privileges 24/24 with no grant
     widened. NOTE: the full `release-gates.test.ts` suite is NOT green — Gate 1 was 42
     passed / 22 failed on 2026-08-28 and the 16 unrelated failures stay with
     `AFLDB-ISSUE-095`, `AFLDB-ISSUE-093`/DraftGuru B3, `AFLDB-ISSUE-096`/`-098`/`-099` and
     rebuild-baseline drift. Two unowned observations are carried at `AFLDB-ISSUE-090.md`
     §27.5: no legacy-free writer for `brownlow_season_votes`, and no writer at all for
     `unlinked_player_with_games` backlog issues. Neither was converted to an issue here.

| `AFLDB-ISSUE-090` | Medium | Data integrity / Import | Club-list DOB enrichment stacked duplicate unresolved `dob_conflict` rows on rerun and the register pass deleted conflicts it did not own. **Reconciliation contract IMPLEMENTED and PROVEN**: migration 072 applied, focused suite 27/27, and the global duplicate-issue invariant in `release-gates.test.ts` is **GREEN**. **Gate 1 run 2026-08-28** — 64 tests / 42 passed / 22 failed, all classified (handoff §11.3). Owned repair made: external-identity pin `12_472` → `13_275` (test-baseline repair from the canonical rebuild; live 13,275 = `measured.players` = `distinct_urls`, `missing_url` 0). The five `gate: birth dates` population assertions are **RETIRED as acceptance** — the canonical rebuild runs neither enrichment pass, 855 DOBs is the accepted baseline's contracted figure, the register pass needs `AFLDB_LEGACY_SQLITE` plus a `legacy_player_id` nothing writes, and the club-list CSVs are gitignored/absent. Revised standard: `AFLDB-ISSUE-090.md` §27.4. **Next action: run `privileges.test.ts` (Gate 2) — no grant widened.** Other 16 failures owned by ISSUE-095 / ISSUE-093-B3 / ISSUE-096-098-099 / rebuild drift; untouched. |
-->

<!-- Open issues continue. The header is repeated because the retired ISSUE-090 row
     above interrupts the table. -->

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-095` is **Resolved** and is NO LONGER an open
     issue. The row below is the pre-resolution index row, kept only as lineage; its
     "next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-095`
     entry in `issues.md` (Resolution, 2026-08-28) and `AFLDB-ISSUE-095.md` §14.
     Final evidence: clean afldb_test rebuild passed, 1,622-row ladder witness
     comparison agreed on every field, final validation 19/19, release gates 45/64
     with all nine club-organization/identity gates green. No migration (75/75), no
     privilege widened. The 19 remaining gate failures are owned by Brownlow
     acquisition, DraftGuru B3, DOB enrichment, the attendance baseline and the
     current-season 2026 pipeline — NOT by this issue.

| `AFLDB-ISSUE-095` | Medium | Data acquisition / Import architecture / Data integrity | `club_seasons` has no canonical, legacy-free acquisition path — `rebuild_derived.py` builds it only from `staging.team_seasons`, whose sole writer is `import_legacy_afl.py` under `AFLDB_LEGACY_SQLITE`. A clean canonical rebuild therefore correctly yields `club_seasons = 0`. **D1–D7 approved and IMPLEMENTED 2026-08-28** (`AFLDB-ISSUE-095.md` §10 decisions, §11 record). The pinned fitzRoy `fetch_ladder_afltables` was deparsed and **computes** its ladder from results under a uniform 4/2/0 rule, so it is adopted as a **validation witness only**; every `club_seasons` column is now derived from canonical `matches` under a declared rule, `ladder_rank` fails closed to NULL on an exact tie (audited: zero ties in 1,622 rows), provenance moved `sports_data_lab` → `afltables`, and a **fail-open** `North Melbourne` 1999–2007 identity gap was closed. Six Stage-9 gates added; nine-stage topology unchanged; no migration. Resolver proof 37/37 DB-free. **Not resolved** — vitest suites unrun (worktree has no `node_modules`), ladder acquisition and clean rebuild outstanding. |
-->
<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-096` is **Resolved** (complete within its authorised S1–S4
     scope) and is NO LONGER an open issue. Do not read the commented-out row below as current:
     it is the pre-resolution index row, kept only as lineage, and its intermediate "UNAPPLIED",
     "BLOCKED" and "next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-096`
     entry in `issues.md` and `AFLDB-ISSUE-096.md` §16.16–§16.17. Final evidence: source contract
     106/106, spine suite 13/13, FK gate 2/2, privileges 24/24, migrations 75/75 with 074 before
     075, fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.
     Downstream work stays with `AFLDB-ISSUE-086` (manual authority), `AFLDB-ISSUE-099`
     (the `data_issues` disagreement row) and `AFLDB-ISSUE-101` (rollover supersession).

| `AFLDB-ISSUE-096` | Medium | Data acquisition / Import architecture | Parent architecture/contract issue for 2026+ API-first acquisition. **HALT LIFTED 2026-08-28** — decisions A–H and §12 approved (`AFLDB-ISSUE-096.md` §14); now foundation implementation S1–S4, still **no family-specific importer**. Evidence baseline: P3/P4/P5/P6 PASS; **P1/P2 RE-RUN 2026-08-28 with the supplied Kali key — both PASS**; P7 still BLOCKED. **P1 falsified an approved S1 declaration**: Kali `/matches` is NOT a Squiggle proxy, so Squiggle+Kali are now TWO match witnesses (`/fixture` stays a proven proxy). **S1 IMPLEMENTED + AMENDED** (GREEN 34/34); **S2 COMPLETE and GREEN 2026-08-28 — final post-hygiene run 61/61, 0 failures, 303 ms** (first run 59/61; the two red source-contract assertions were **confirmed false positives** — both `[^;]*` regexes spanned the migration's own explanatory comments — and the **tests** were repaired to inspect executable SQL statements; migration unchanged, append-only and A→B→A invariants intact). §16.4 hygiene fixed: the NUL bytes in `observations.ts:499` are now source escapes (same character, keys byte-identical — the proposed space separator was **rejected** as semantics-changing and ambiguity-permitting) and the stale "migration 073" header reads 074. Migration **074** (073 is ISSUE-086's `data_overrides`) **UNAPPLIED**; no CHANGELOG entry required at this checkpoint. **S3 COMPLETE and GREEN 2026-08-28 — `84/84`, 0 failures, 316 ms** — `src/lib/acquisition/reconciliation.ts` computes Decision C's ten verbs from a live payload against the stored open version with an exported precedence, reusing S2's ownership predicate and authority boundary; foreign **and unreadable** ownership fail closed before authority is asked, agreement never substitutes for authority, and a payload change moving no projected fact field returns the verb-less `history_only` outcome (settled, not an eleventh verb). **S4 IMPLEMENTED 2026-08-28 and AWAITING VALIDATION (§16.10)** — new pure `src/lib/acquisition/promotion-review.ts` carries the review contract: the candidate record with 074's CHECKs enforced in TypeScript, a `baselineCanonicalHash` over **exactly the proposed fields** (ordering-independent, null for a `new` target), `renderReviewItem`, `evaluateAcceptRequest`, the requeue-vs-supersede rule, and reject/requeue decision drafts; render and accept both recompute the baseline from re-read values and then delegate to **S2's `evaluateAcceptance`**, so its gate order and the `stale_review`/`stale_canonical_target` distinction are unchanged. `observations.ts` gained one additive, behaviour-preserving export (`canonicalJson`) so canonical values are never hashed under a family's *payload* exclusions. **§7's gate is intact by construction:** no `'accept'` decision is representable, a cleared evaluation still returns `write.implemented: false`, and `UNAVAILABLE_MANUAL_AUTHORITY` refuses every promotable verb including `new`. **S4 COMPLETE and GREEN 2026-08-28 — `105/105`, 0 failures, 357 ms** on the final post-hygiene run, user-run: the promotion-review contract renders the approved candidate evidence, hashes a baseline over **exactly** the proposed/touched fields (deterministic, ordering-independent; unrelated canonical changes do not stale a review, proposed-field changes do), keeps moved source evidence and a moved canonical baseline as **distinct** stale outcomes, re-runs every acceptance gate fail-closed (provider agreement never substitutes for authority; foreign and unreadable ownership refuse; authority conflict and indeterminate/unavailable refuse; season ownership enforced), rejects without mutating canonical facts or observations, and exposes no force/override/bypass/consensus path. **The canonical acceptance/write transaction is deliberately NOT implemented** — the write, provenance quartet and real `accept` decision row stay blocked behind ISSUE-086's authority contract, `PromotionDecisionDraft` cannot represent an acceptance, and a fully cleared gate still reports the write as unimplemented. NUL hygiene RESOLVED (user-performed byte repair, verified). Migration 074 UNAPPLIED; no production/`afldb_dev` work; **no approved S5 exists** — §11 stops at S4. `AFLDB-ISSUE-100` remains separate and does not block this checkpoint. **PostgreSQL validation phase HALTED AT PREFLIGHT 2026-08-28 and BLOCKED (§16.13):** `npx tsx tools/db/migrate.ts --status --target test` proved the target is `afldb_test` (73 of 74 applied) and then **refused** because applied migration `073_data_overrides.sql` (**ISSUE-086's**) fails the checksum guard. 074 was **NOT applied and NOT modified**; no database was written; S1–S4 stay green. Line-ending and algorithm causes are eliminated (ISSUE-091's three-representation tolerance; 72 rows validated in the same pass); Git shows **one committed 073 blob only** (`a8ad3079…`, in `2a068a8`/`e0d64aa`), clean worktree, no stashes — so **no committed revision matches the applied artefact** and `dev` holds **no** invalid mutation of an applied migration. **CONFIRMED by the ledger:** stored `47937827…`, committed canonical-LF `778c5bfb…`, applied `2026-08-28 01:54:41.063665+10` — **1 h 1 min 48 s before** the sole committed revision existed (`2026-08-28 02:56:29+10`), so an **uncommitted intermediate** version was migrated and then changed before commit. **Repair owned by `AFLDB-ISSUE-086`** (database-ledger coherence, not history surgery); **a later corrective migration cannot fix it alone** — the runner validates applied checksums before running anything, so the baseline must be made coherent first, and `afldb_test` must **not** be rebuilt from this worktree while pending 074 lacks its §16.14 FK indexes. **074 has NOT failed — it was never executed.** **BLOCKER RESOLVED 2026-08-28:** ISSUE-086 rebuilt `afldb_test` cleanly through the committed 073 — **73/73 applied, 0 pending, no drift** — so the **PostgreSQL validation phase may resume**. The structural pre-application review's **three missing FK-covering indexes** are now **repaired in 074 itself before first application** (§16.14): `ix_promotion_candidates_evidence`, `ix_promotion_candidates_decision`, `ix_promotion_decisions_admin`. **074 remains UNAPPLIED** pending DB-free source-contract validation of that repair, **075 (ISSUE-086) also remains unapplied**, and application must be normal filename order — **074 then 075**. **No DB-backed FK validation is green yet** — `tests/integration/fk-indexes.test.ts` is untouched and cannot run against 074 until 074 is applied. **PHASE RESUMED AND SCHEMA GATE GREEN 2026-08-28 (§16.16):** 074 then 075 applied to `afldb_test` only, **75/75, 0 pending, no drift**, privileges reconciled, FK gate **2/2**, fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`. `src/lib/acquisition/` still has **no persistence layer**, so new suite `tests/integration/observation-spine.test.ts` proves the **schema half** of §5.H only — real `decideObservation`/`sweepAbsences` decisions applied to `afldb_test`, each head read back out of PostgreSQL, all inside an always-rolled-back transaction on a synthetic `sources` row. Refreshed matrix: **2 executable** (A→B→A; absence ≠ deletion), **3 partial** (idempotence; foreign ownership; stale-review race), **3 BLOCKED** — manual authority (ISSUE-086), the `data_issues` row (never implemented), rollover supersession (ISSUE-101, no supersession column in 074). **No canonical acceptance/write path added**; blocked rows have no test rather than a fake one. **VALIDATION GREEN 2026-08-28, user-run: source contract `106/106`, FK catalogue gate `2/2`, spine suite `13/13`.** The one first-run failure was a fixture defect (`seasons.is_complete` is generated from `status` since migration 015) that aborted ten cases in shared setup before their bodies ran; seed corrected to `status = 'in_progress'`, no behavioural assertion changed, rerun 13/13. **13/13 proves the implemented PostgreSQL/schema half of §5.H only** — the three partial rows stay partial and the three blocked rows stay blocked. |
-->

<!-- Open issues continue. The header is repeated below because the retired ISSUE-096 row
     above and the retired ISSUE-099 row that follows both interrupt the table. -->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-099` is Resolved (T1-T8 complete, validated end-to-end
     on real 2026 data) and is NO LONGER an open issue. Do not read the commented-out row
     below as current: it is the pre-implementation index row, kept only as lineage, and its
     "nothing implemented" / "start at T1" text is SUPERSEDED. Authoritative records: the
     `AFLDB-ISSUE-099` entry in `issues.md` and `AFLDB-ISSUE-099.md` "T8 — COMPLETE".
     Final evidence: `current-season-import` 172/172; `settle-afltables` integration 20/20
     with zero skips (incl. restricted `afldb_import` role parity); typecheck at the 13-error
     unrelated baseline with zero ISSUE-099 errors; ESLint silent; real 2026 acquisition
     207 matches / 9522 player rows / 0 missing profile URLs; clean apply (batch 90) then
     idempotent rerun (batch 91) with ZERO canonical rows written. Migration 076 is applied
     and checksum-frozen - never edit it. Carried out as separate open work below:
     `AFLDB-ISSUE-104`, `AFLDB-ISSUE-105`, `AFLDB-ISSUE-106`. Downstream: `AFLDB-ISSUE-101`.

| `AFLDB-ISSUE-099` | Medium | Data acquisition / Import architecture | 2026 has no player stats, period scores, attendance or Brownlow votes. Nightly in-season AFL Tables settle pass. **Planning COMPLETE 2026-08-28 — approved contract at `AFLDB-ISSUE-099.md`; nothing implemented. P5 PASSED, stop condition NOT triggered — no longer probe-blocked.** v1 stops at candidates + `data_issues`: **zero canonical writes.** Next action: fresh Opus/High/Normal session, carry-over `AFLDB-ISSUE-099.md`, start at T1. |
-->

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-100` is **Resolved** and is NO LONGER an open
     issue. Implemented and validated end-to-end against the real 2026 R20/R25 source;
     migration 077 applied and checksum-frozen. Retained as lineage only — its
     "next action" text is SUPERSEDED. See `issues.md` for the resolution record.
| `AFLDB-ISSUE-100` | Medium | Data acquisition / Import architecture | Staging-only lineup/team-announcement domain fed by `fetch_lineup_afl`. **Never canonical participation.** **P3 (identity) and P3b (shape/types/NULLs/completeness) both PASS** — no longer probe-blocked; the R20-only column is `lateChanges` and the set is complete at 20. **L1–L3B2 COMPLETE and GREEN 2026-08-29.** Source-family contract, bounded acquisition (`tools/rebuild/afl_api/`), deterministic observation bundle (`lineup-bundle.ts`), **migration 077 applied and checksum-frozen** to `afldb_test`, and persistence (`lineup-store.ts`) through the **074 spine** into the typed `staging.afl_api_lineup`. Durable family-local contracts: `external_record_id` = `providerId\|teamId\|player.playerId` (delimiter-refusing), `scope_key` = `season=YYYY;round=NN`, enumeration `complete:false` permanently. Binding and proved: `source_id` resolved internally from literal `'afl_api'`; unresolved `match_id`/`club_id`/`player_id` stay **NULL** and the row still persists; **no absence sweep**; **no DELETE/TRUNCATE path** (keyed upsert only); **no canonical participation write**; `player.captain` raw evidence but **not projected** (572/572 `FALSE` sentinel); `lateChanges` **verbatim, never parsed**; no closed enum CHECKs; `required_columns` stays at five. Owner **16/16 + 11/11** and **restricted `afldb_import` parity green**. Next: **bounded real R20/R25 persistence validation**, then close-out. |
-->
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-101` is **Resolved** and is NO LONGER an open issue.
     Resolved for the **reusable mechanism only**: an explicit, fail-closed rollover planner +
     dry-run-by-default CLI, with the fitzRoy full-history, accepted-baseline and offline
     ladder-witness authorities all EXECUTED against a temporary successor state before any
     tracked write. `measured` and `identity_scan` are derived from validator execution;
     `--identity-scan` no longer exists. **No season was rolled** — the real boundary is
     unchanged (accepted through 2025, `seasons.json` 2026 / `in_progress [2026]`), no
     migration was added (077 remains the highest, untouched), and no canonical row is
     written. Only `validate_ladder_witness.py --compare` remains post-rebuild, because it
     requires the rebuilt database. Actual 2026 -> 2027 execution is **intentionally deferred**
     until the season is formally complete and genuine completed-season evidence (a real
     full-history candidate `1897..Y` plus a matching ladder witness) exists; it must not be
     manufactured. Final evidence: `tests/season-rollover.test.ts` 131/131;
     broader regression 5/5 suites, 472 passed, 6 existing skips;
     `tests/python/ladder_identity_contract.py` all executable checks passed (acquired witness
     bytes skipped — gitignored by design). Authoritative record: the `AFLDB-ISSUE-101` entry
     in `issues.md`. `AFLDB-ISSUE-101-HANDOFF.md` is handoff documentation only and its §14/§15
     "current active task" and "what remains" text is SUPERSEDED. Do not read the
     commented-out row below as current — its "not yet validated" text is SUPERSEDED.

| `AFLDB-ISSUE-101` | Medium | Data acquisition / Import architecture / Data integrity | End-of-season promotion / baseline rollover. **Planner + CLI IMPLEMENTED 2026-08-29, not yet validated** (`src/lib/rollover/season-rollover.ts`, `tools/db/rollover-season.ts`, `tests/season-rollover.test.ts`). No migration, no canonical write, no clock read; **2026 NOT rolled**. ISSUE-099 and ISSUE-095 are both Resolved, so both dependencies are satisfied. Two policy points adjudicated 2026-08-29: the retired-baseline lifecycle status is **`retired`** (now declared in the real register as `selection_policy.retired_statuses`, a policy-only edit that changed no acceptance, measurement or fingerprint), and **`accepted_corrections` are reviewed per acquisition, never inherited**. **Must not redefine completed-season `club_seasons` ownership** — ISSUE-095's D1–D7 are implemented, not open, and its D7 already added six `club_seasons` Stage-9 gates. |
-->

<!-- Open issues continue. The header is repeated because the retired ISSUE-101 row
     above interrupts the table. -->

| Issue | Severity | Area | Current state |
|---|---|---|---|
| `AFLDB-ISSUE-102` | Medium | Data acquisition / Import architecture | `import_awards.py:1408` still requires `AFLDB_LEGACY_SQLITE` — the awards sibling of the ISSUE-095 gap. **Record only; do not design the replacement.** |
| `AFLDB-ISSUE-104` | Low | Data acquisition / Import architecture / Data integrity | Migration 076's open-row unique key `(issue_type, issue_key)` carries **no owner**, so the `data_issues` refresh upsert could update a foreign-owned open row. Resolution *is* ownership-scoped; refresh is not. **Unreachable today** — ISSUE-099 is the only writer that populates `issue_key`. Key files: `076_afltables_settle_projections.sql` (**frozen — never edit**), `settle-afltables.ts`. Next action: **nothing until a second `issue_key` writer is proposed**; ownership must enter the dedup contract before one ships. |
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-105` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "NOT yet validated" / "next action" text is SUPERSEDED.
     Authoritative record: the `AFLDB-ISSUE-105` entry in `issues.md` (Resolution, 2026-08-29).
     Final evidence, user-run: `current-season-import` 178/178; `settle-afltables` integration
     19 passed / 1 skipped; `afl-api-lineup-store` integration 10 passed / 1 skipped;
     `observation-spine` 13/13. **Both skips are the restricted `afldb_import`-role parity
     cases, skipped because `AFLDB_TEST_IMPORT_DATABASE_URL` is unset — they did NOT run.**
     Not a blocker: no privilege, role, schema or migration behaviour changed, and the
     representation was proved through real PostgreSQL `RETURNING`/binding paths. No
     migration (077 remains the highest, untouched) and no runtime data-format change.

| `AFLDB-ISSUE-105` | Low | Data acquisition / Import architecture / Type safety | postgres.js returns uncast `import_batches.id` (`bigint`) as a **string** while several call sites declared `number`. **Adjudicated and IMPLEMENTED 2026-08-29, NOT yet validated.** Convention: an opaque branded **string** `ImportBatchId`, decoded once at the driver boundary by a fail-closed `asImportBatchId()` — new `src/lib/import-batch-id.ts`. Applied to every TS `INSERT INTO import_batches ... RETURNING id` and every signature carrying a batch id (observation-store, settle, lineup-store, current-season, ingest pipeline/datasets, submissions page, first-kick-goal tool). **No schema/migration change** (077 stays frozen); **no `bigint`→`int` cast** — seven pre-existing test casts removed; **no `Number()` narrowing** — the ISSUE-099 `Number(result.batchId)` workaround is gone. Runtime behaviour is unchanged: every value was already a string. Next action: run `npm test -- tests/current-season-import.test.ts`, then the settle and lineup integration suites. |
-->

<!-- No open rows follow. Everything below is retired lineage only: ISSUE-106 (retired
     2026-08-29) and ISSUE-093 (retired 2026-08-27). The three open issues are
     ISSUE-068, ISSUE-102 and ISSUE-104, listed above. -->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-106` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "Next action" text is SUPERSEDED.
     Authoritative record: the `AFLDB-ISSUE-106` entry in `issues.md` (Resolution, 2026-08-29).
     Final semantics: absent/NULL/empty `period_scores` all mean the source published NO
     period-score evidence, so `match_period_scores` is **not established**,
     `proposedPeriodScoreValues()` returns `null`, and no empty-array candidate can be
     created. Published periods are preserved exactly (partial publication included, NULL
     stays NULL, no periods 5+ invented). Deliberate accounting corrections: a rejected
     record with `projection: null` establishes `matches` only, so the settle suite's
     rejected-record expectation is 4 candidates / 3 rejections, and `observationsUnchanged`
     — which counts reconciliation outcomes per **established** target — is 4, not 5.
     Final evidence, user-run: `current-season-import` 180/180; `settle-afltables` integration
     19 passed / 1 skipped. **The skip is the restricted `afldb_import`-role parity case,
     skipped because `AFLDB_TEST_IMPORT_DATABASE_URL` is unset — it did NOT run.** Not a
     blocker: no privilege, role, schema or migration behaviour changed. No migration (077
     remains the highest, untouched) and no change to the canonical period-score
     representation.

| `AFLDB-ISSUE-106` | Low | Data acquisition / Import architecture | `proposedPeriodScoreValues()` returns `{ period_scores: [] }` instead of `null` for a match with no published quarter scores, so it would raise an **empty** `match_period_scores` candidate — the sibling of the Brownlow defect ISSUE-099 D2 fixed. **Unreachable in the real T8 snapshot** (all 207 matches carried period scores). Next action: decide whether that match establishes the target; if not, return `null`, extend `targetEstablishedBySource()`, and reconcile the integration suite's rejected-record expectation deliberately. |
-->
<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is Resolved and is NO LONGER an open issue.
     Do not read the commented-out row below: it is the pre-resolution index row, kept only
     as lineage, and its "NEXT PHASE"/"next action" text is SUPERSEDED — the first clean
     rebuild has since PASSED (nine stages, 13/13 final validation). Authoritative records:
     the `AFLDB-ISSUE-093` entry in `issues.md` and `AFLDB-ISSUE-093.md` §H15. The only
     remaining follow-up is `AFLDB-ISSUE-095`, listed above as an open issue.

| `AFLDB-ISSUE-093` | Medium | Tooling / Data integrity / Import architecture | **CHECKPOINT 2026-08-27 — CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN. Read `AFLDB-ISSUE-093.md` §19 first — it is the authoritative current-state record.** Accepted baseline `full-history-20260827` (1897–2025, 131 artefacts, 719,042 rows), hash-bound via `data/reference/fitzroy-accepted-baselines.json` (`exactly_one_accepted`, no latest-label fallback) and independently revalidated offline with no PostgreSQL access. Phases 1–4a COMPLETE; DraftGuru Stage A/B1/B2-1..B2-8 COMPLETE (supported `import_draftguru.py`, tracked link ledger, legacy `import_draft.py` tombstoned); orchestrator `npm run db:test:rebuild` IMPLEMENTED (normal mode auto-selects the accepted baseline; validator runs before any destructive stage). **417/417 DB-free tests.** **RESET BLOCKER 2 CLOSED 2026-08-27 — live rollback proof PASSED (`a8a2a899…` → `a8a2a899…` exact, 950 relations, psql exit 3, 1498 ms). `afldb_test` reconstructed: migrations 001–072 + privileges, schema only, NO canonical data. NEXT PHASE: FIRST ACTUAL CLEAN REBUILD — read the FIRST CLEAN REBUILD HANDOFF (§H1–§H10) at the end of `AFLDB-ISSUE-093.md`.** Incident lineage retained in full and not rewritten: Building the proof had already found and fixed two real defects (`runSql` never sent the SQL at all — `void client.unsafe(...)`; and the `pg_` schema exclusion excluded nothing, so `DROP SCHEMA pg_toast` would have aborted the first loop). The live run then exited 0 without aborting and the reset committed: pre-proof `0229d62c…` → post-incident `f46ce34c…`. **`RESET_SQL` has therefore now RUN against live PostgreSQL and produced exactly the intended clean slate (schemas 1, relations 0, migrations absent, 3 extensions and all 56 extension-owned objects preserved) — its semantics are validated; the ROLLBACK CONTAINMENT is what failed and remains unproven.** Production and `afldb_dev` untouched; loss was schema + privileges only, no import had ever run. No clean rebuild has been executed. **SELF-COLLISION FIXED (§20.14):** the hardened proof then refused twice with "1 other client session(s) connected" — the harness's own postgres.js observer, held open across the psql run; corrected to three phases with nothing spanning the reset, gate unchanged and no session exempted. Key files: `AFLDB-ISSUE-093.md` §19–§20, `AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` PART I–XVIII, `tools/db/rebuild-test.ts`, `tools/db/prove-reset.ts`, `tools/migration/import_fitzroy_core.py`, `tools/rebuild/draftguru/import_draftguru.py`, `data/reference/*.json`. **EXECUTION-BOUNDARY AUDIT 2026-08-27 (§H11) — the first clean rebuild is NOT READY: three blockers. F1 `db:migrate:test`/`db:privileges:test` are POSIX-shell scripts and npm on Windows runs them under `cmd.exe`, so stages 3 and 4 fail *after* the destructive stage 2 wipes the database (remedy proven: `npm_config_script_shell=bash`, which also propagates to the nested `npm run` calls). F2 `AFLDB_TEST_IMPORT_DATABASE_URL` is unset on `dev` (ISSUE-083 parked at `fa035ed`), so `resolveTarget()` refuses before preflight — operator must set it or pass `--allow-owner-import-dsn`. F3 stage 9 FINAL VALIDATION is declared `run: 'internal'` and `executeRebuild()` has no `internal` branch, so it does nothing and `FINGERPRINT_QUERIES` is never called — the run cannot fail closed on validation/fingerprint mismatch as §H9 requires. F4 (no DB identity/session/psql-probe gate in the orchestrator) and F5 (no lock/statement timeout on the destructive reset) are recorded and compensated by operator-run read-only checks. `.env` loading, the psql argv, accepted-baseline selection, DraftGuru inputs and the zero-`AFLDB_LEGACY_SQLITE` boundary all audited CORRECT. **REMEDIATED 2026-08-27 (§H11.8): F1 and F3 are RESOLVED.** `db:migrate:test` is now `tsx tools/db/migrate.ts --target test` (new `--target` flag; `AFLDB_MIGRATE_TARGET` still supported, a disagreement is a refusal) and `db:privileges`/`db:privileges:test` route through new `tools/db/privileges.ts`, which resolves the DSN in Node — psql invocation otherwise unchanged, script names unchanged. Stage 9 is now a real `validate` stage with its own `deps.runValidation` separate from the destructive `runSql`: 13 gates bound to the accepted register's `measured` block plus `matches_after_accepted_last_season = 0`, `draft_persons` and `draft_picks`; an unrecognised measured key is a refusal so the gate cannot silently shrink; read-only, reports every value, fails the run on any mismatch. `FINGERPRINT_QUERIES` removed. **182/182 DB-free tests** in `tests/db-test-rebuild.test.ts`. **FIRST CLEAN REBUILD ATTEMPT 1 FAILED AT STAGE 5 — REPAIRED (§H12, 2026-08-27).** PRECHECK/RESET/MIGRATIONS 72-72/PRIVILEGES all passed; REFERENCE died on `psycopg.errors.InsufficientPrivilege: permission denied for table player_link_match_candidates` in `guard_cascade()`, which probed every transitive FK dependent of its truncate roots with `SELECT count(*)`. Root cause: `privileges.sql` grants `afldb_import` SELECT on a **base table** only via `import_writable_tables`; `app_readable_tables` is consulted only for views. Migration 045 seeded that registry from the tables existing then, so every base table created after 045 is revoked unless its migration calls `grant_import_write()` — migration 067 registers the candidate cache app-read ONLY, by design (migration 070 reasons about that exact table). The closure is 30 relations and **two** are unreadable: `player_link_match_candidates` (067) and `player_match_period_stats` (062, direct `club_id → clubs` FK) — so a one-table grant would have failed on the next relation. **Repair (no grant added, `privileges.sql` UNCHANGED):** `guard_cascade()` now classifies dependents via `has_table_privilege()` (new `common.selectable()`), counts rows only in proven-readable ones, and REFUSES on any it cannot prove empty; new `reload_truncate()` skips a TRUNCATE whose targets are already empty, since `TRUNCATE … CASCADE` needs privileges on the whole cascade set. On a clean rebuild the roots are always empty, so no closure relation is read or locked and a future migration cannot reintroduce the failure. **204/204 DB-free tests** (`reference-data` + `db-test-rebuild`), `py_compile` OK, no new tsc errors. `afldb_test` holds migrated+privileged schema and ZERO rows (the guard refuses before any write) — the post-stage-4 state. **BOUNDED STAGE-5 PROOF 1 FAILED SAFELY — REPAIRED AGAIN (§H13).** The §H12 repair was necessary but NOT sufficient and its "complete" claim is amended in place. Root cause of the second failure: **a freshly migrated database is not empty** — migrations 015 and 016 SEED `stat_definitions` and `stat_availability`, both truncate roots of the `coverage` group. `guard_cascade()` evaluated emptiness and took its cascade closure over the **union of every group's truncate targets** while `reload_truncate()` decides per group at call time, so the union short circuit could never fire and the closure of the EMPTY `clubs`/`seasons` roots (whose truncates would have been skipped) was adjudicated anyway — refusing over a cascade that was never going to happen. Hypotheses #1/#2/#3/#4 confirmed, #5 rejected. **Repair:** closure is now taken from `populated_roots` only (on a fresh DB that is `{stat_definitions, stat_availability}`, whose closure is just `stat_availability` — in the loader's own rebuild set, so `outside` is empty and neither denied relation is touched); and `guard_cascade()`/`reload_truncate()` can no longer disagree — the guard records the roots it adjudicated and the truncate refuses anything outside that set, or if the guard never ran. **New `tests/python/reference_cascade_contract.py`: 19 DB-free BEHAVIOURAL scenarios** driving the real functions against a fake connection that raises if the guard reads a denied relation — §H12's source-string tests passed against wrong control flow, which is the lesson. **206/206** TS tests, `py_compile` OK, no new tsc errors. `privileges.sql` and `src/db/migrations/` still UNCHANGED; `--allow-cascade` still unused. `afldb_test` untouched (the guard refuses before any write) and still in the post-stage-4 state. **FIRST COMPLETE CLEAN REBUILD PASSED — 2026-08-27 (§H15). STATUS: CLEAN REBUILD PROVEN — FINAL POST-REBUILD VALIDATION PENDING.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` ran end to end: all NINE stages passed (PRECHECK, RESET, MIGRATIONS 72/72, PRIVILEGES, REFERENCE, FITZROY, DRAFTGURU, DERIVED, FINAL VALIDATION), with data stages under the **restricted `afldb_import` role** — no `--allow-owner-import-dsn`, no `AFLDB_LEGACY_SQLITE`, not production, not `afldb_dev`. Baseline `full-history-20260827` (131 artefacts, 719,042 rows, manifest `cc8aaf09…`, artefact-set `8e14ce61…`); DraftGuru `annual-html-20260826` (5,057 persons / 6,810 picks / 6 ledger decisions / 5,052 unmatched / 2 seeded). fitzRoy: venues 52, players 13,275, matches 16,838, match_period_scores 134,704, player_match_stats 685,471, brownlow_round_votes 320,861. **Stage 9: `AFLDB-FINAL-VALIDATION PASSED: 13 checks`**, including `matches_after_accepted_last_season = 0` (2026 correctly excluded). Two defects were exposed only by real execution under the restricted role and are now repaired: the REFERENCE cascade guard (§H12/§H13 — `afldb_import` correctly denied `player_link_match_candidates`/`player_match_period_stats`; migrations 015/016 SEED `stat_definitions`/`stat_availability` so the empty-root assumption was false; repair scopes cascade analysis to populated roots, **`privileges.sql` unchanged, no grant added**) and fitzRoy corrections-parameter threading (§H14 — both import phases repaired, `corrections` now required). **`club_seasons = 0` RESOLVED as SEPARATE FOLLOW-UP (§H15.5, source-proven 2026-08-27) — it does NOT invalidate the core rebuild.** The only writer of `staging.team_seasons` is `tools/migration/import_legacy_afl.py` (`:767/:776/:795`, group key `"ladders"`), which requires `AFLDB_LEGACY_SQLITE` (`:1021`). `REBUILDS["club_seasons"]` selects `FROM staging.team_seasons`, so an empty staging table correctly yields zero rows. The ladder/team-season domain therefore has **no canonical acquisition path yet** and was never in the nine-stage contract — zero is the *expected* outcome of a legacy-free rebuild, not a defect in it. Real degradation while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`, `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser/plan/vocab`, `lib/edit/spec.ts`). fitzRoy can derive `played/wins/draws/losses/points_for/points_against/percentage` (and already derives `is_premier`/`finals_played`); `ladder_rank` and `premiership_points` need an external ladder source — both are nullable in the schema, so a partial rebuild is schema-legal but needs a provenance decision (the SQL hardcodes `source_id` = `sports_data_lab`). **Stage 9 must NOT gate `club_seasons` until the domain lands**, or every canonical rebuild would fail on a known gap. Next action: **record a follow-up issue for canonical legacy-free ladder/team-season acquisition + load stage + Stage-9 gate (determine the next unused id from `issues.md`/`IssuesIndex.md` — NOT `AFLDB-ISSUE-094`, already used by NL semantic mapping; link `AFLDB-ISSUE-015` and `AFLDB-ISSUE-093`, do not absorb ISSUE-015), then ISSUE-093 can be marked Resolved — 2026-08-27.** Do NOT start DraftGuru Stage B3; do NOT merge the parked branches. **ISSUE-059 (`4444d76`) and ISSUE-073 (`0885129`) are now UNBLOCKED** for their own focused DB-backed validation against the rebuilt database, as separate work. Do NOT start DraftGuru Stage B3 (optional, not a blocker); do NOT merge the parked branches — ISSUE-083 is complete and parked at `fa035ed`, ISSUE-059 at `4444d76`, ISSUE-073 at `0885129`.** |
-->

---

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-068` is **Resolved** (2026-08-29) and is NO LONGER an
     open issue. The block below is retained as lineage only; its "Current state" and
     "Exact next action" text is SUPERSEDED. Authoritative record: the `AFLDB-ISSUE-068`
     entry in `issues.md` (Status: Resolved) and `AFLDB-ISSUE-068.md` (Resolution —
     2026-08-29). Closing conclusion: the React #418 hydration defect was owned by the Next
     15.5.23 framework dependency closure/runtime/client/serving path; the Next 16.3.1
     closure eliminated it in matched A/B testing and the result is confirmed on the real
     Linux dev deployment with a clean 1,440-load acceptance at BUILD_ID
     uZReW8G1XnsGnG5FNYY-I. No exact internal Next.js function, commit or upstream bug ID is
     claimed. ISSUE-107, ISSUE-108 and ISSUE-109 remain Open and separate.
## AFLDB-ISSUE-068 — Intermittent React hydration errors during NL UI sweeps

- **Severity:** Medium
- **Area:** UI/Hydration
- **Runbook:** `AFLDB-ISSUE-068.md`.
- **First wrong layer:** Next 15.5.23 framework dependency closure/runtime/client/serving path.
- **Current state:** H9 is confirmed at the owning-layer level. Matched Next 15.5.23 passes
  (`oroK-9PaBQoMFamvJGRqB`) completed 1,440 / 1,440 with 73 and 62 hydration/client errors;
  matched Next 16.3.1 passes (`5RU_F0rm5IyuiVwKX9XHi`) completed 1,440 / 1,440 with zero and
  zero. All four runs had identical 1,238 / 202 / 0 semantics, zero HTTP/page errors, zero
  violations and zero metamorphic disagreements. Per-load `x-afldb-build` proved build identity.
- **Causal boundary:** Do not claim a specific Next.js internal function, upstream bug/commit,
  or `next` alone. React/ReactDOM stayed 19.2.8. Next 16 changes the segment-cache/prefetch
  serving format, so internal hydration correction versus changed serving path is not
  distinguished.
- **Deployed acceptance PASSED 2026-08-29:** ISSUE-107 deployed the closure and proved the live
  build; the sweep then ran against `uZReW8G1XnsGnG5FNYY-I` on `http://10.0.40.100:8090` with the
  full 1,440-question corpus, 4 Playwright workers, pool 10, tracing on, JavaScript enabled and no
  retries. Result: **1,440 / 1,440 observed, all bound to that build; zero hydration errors on
  every cut (per worker, same/cross worker, every RSC cluster), zero client errors, zero
  violations, zero metamorphic disagreements, zero HTTP and page errors.** Outcomes improved to
  1,440 / 0 / 0 — attributable to the NL work merged since the A/B source, not to the framework,
  and recorded as such.
- **Corpus note:** the tracked corpus is five rows short of the A/B set; a commit merged after the
  A/B removed five ambiguous "most games in a game" questions. The complete corpus survived on the
  dev host and was proven a clean superset before use, so no threshold was adjusted.
- **Exact next action:** every stated closure condition is met. Awaiting an explicit operator
  decision to close — closure was not authorised with the run, so the issue is left Open.

-->

## AFLDB-ISSUE-107 — Next.js 16 framework/runtime upgrade

- **Severity:** Medium
- **Area:** Framework / Runtime / Deployment
- **Runbook:** `AFLDB-ISSUE-107.md`.
- **Current state:** Open; deployed to Linux development on 2026-08-29 and proven live.
  Commit `be2a963` on `dev`, Node `v22.23.2`, Next `16.3.1`, React/ReactDOM `19.2.8`, Webpack.
  Typecheck 0 errors; the Webpack build completed page collection, 1,499 static pages and
  complete standalone output; `deploy/sync-dev.ps1 -Issue107Gate` exited 0; live
  `x-afldb-build` equals BUILD_ID `uZReW8G1XnsGnG5FNYY-I`; systemd active with four
  `next-server (v16.3.1)` workers at `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`,
  `AFLDB_TRACE_REQUESTS=on`; `/api/health` ok; 17/17 focused live routes clean with zero
  console, page and hydration errors. The `/sitemap.xml` question is closed: no duplicate-route
  warning in the production build, and its 404 is the intended `AFLDB_INDEXING`-off behaviour.
- **Key files/subsystem:** `deploy/sync-dev.ps1` (four gate-integrity repairs: nvm Node
  selection, base64 remote transport, server-side `$(…)` evaluation, sudo-less systemd restart);
  the dev host `.env` (`AFLDB_POOL_MAX=10` added).
- **Only open gate:** G2's guarded database integration. 33 stable failures against `afldb_test`
  are content failures with no framework surface — tracked as `AFLDB-ISSUE-108`, not as an
  ISSUE-107 regression.
- **Dev migrations applied 2026-08-29:** on operator instruction, `071`–`077` were applied to
  `afldb_dev` via `npm run db:migrate` after confirming the target database, the absence of
  `AFLDB_PROD_DATABASE_URL` and the 70/77 starting status. Now **77/77, 0 pending**, no checksum
  drift, no privileges reconciliation required, production untouched. Smoke: `/api/health` ok;
  `/admin`, `/admin/data-editor`, `/admin/current-season` all 307 to login with no 500; live
  `x-afldb-build` unchanged at `uZReW8G1XnsGnG5FNYY-I` with no restart or rebuild. Applying `073`
  exposed `AFLDB-ISSUE-109`.
- **Stop conditions:** unexplained React/dependency expansion, simultaneous bundler change,
  semantic/security regression, unreproducible framework controls, live build mismatch,
  reduced concurrency, or any unexplained hydration/client error in ISSUE-068 acceptance.
- **Exact next action:** hand BUILD_ID `uZReW8G1XnsGnG5FNYY-I` on `http://10.0.40.100:8090` to
  ISSUE-068 for its 1,440-row acceptance at 4 Playwright workers (`NL_UI_WORKERS` unset).
  Re-run guarded integration once ISSUE-108 restores `afldb_test`. Do not resolve either issue
  before its owned gates pass, and do not roll out production.

## AFLDB-ISSUE-108 — `afldb_test` data predates the current full-history expectations

- **Severity:** Medium
- **Area:** Test database / Data integrity / Tooling
- **Current state:** Open. `afldb_test` is migrated to 77/77 but its data is an older, partial
  load, so 33 guarded integration tests fail on content: Brownlow season votes 0 against 79,113,
  855 players with a date of birth against 12,478, draft-link identity 5 against 3,459.
  A separate failure is the absent gitignored DraftGuru `full-history-20260826` corpus. Three
  further failures appear only under vitest's default file parallelism, where several suites
  mutate the one shared `afldb_test` concurrently.
- **Not a framework issue:** every failing file imports nothing from `next`, `react` or
  `src/app`; confirmed on Next 16.3.1 / React 19.2.8 / Node v22.23.2.
- **Key files/subsystem:** `tests/integration/release-gates.test.ts`,
  `tests/integration/database.test.ts`, `tools/db/rebuild-test.ts`, `docs/deployment.md` §6a.
- **Blocked repair:** `npm run db:test:rebuild` needs `AFLDB_TEST_IMPORT_DATABASE_URL` (absent
  from the dev host `.env`, and it fails closed rather than inheriting the `afldb_dev` import
  DSN) and the tracked DraftGuru corpus (absent on the host). It is also destructive.
- **Exact next action:** restore the corpus, provision a restricted `afldb_import` DSN for
  `afldb_test`, run `npm run db:test:rebuild -- --fitzroy-label <full-history-label>
  --acknowledge-destroy afldb_test`, re-run the guarded suite, and decide separately whether the
  release gates may assert global counts under shared-database parallelism.

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-077` is **Resolved** (2026-08-26) and is NO LONGER an
     open issue. The detail block below is retained as lineage only: its "Current state" and
     "Next action" text is the pre-resolution index text and is SUPERSEDED. Authoritative
     record: the `AFLDB-ISSUE-077` entry in `issues.md` (Status: Resolved, Resolved:
     2026-08-26). Root cause: `saveSiteSettings` revalidated only four paths, so statically
     generated pages kept serving a stale root layout and the client router flipped the theme
     on navigation between a revalidated and a stale page. Fix: `revalidatePath('/', 'layout')`
     in `src/app/admin/settings/actions.ts`, invalidating the whole root-layout cache boundary
     in one operation. Validation: `tests/admin-settings-actions.test.ts` 1/1, asserting the
     exact call and that it is the only revalidation issued. This block was left uncommented
     when the issue was resolved and was retired by the 2026-08-28 ledger reconciliation.

## AFLDB-ISSUE-077 — Frontend theme changes unpredictably during a user session (RETIRED)

- **Severity:** Medium
- **Area:** UI/Settings
- **Key files:** `src/db/queries/site-settings.ts`, `src/app/layout.tsx`, theme/layout components, and any client-side theme initialisation/storage code.
- **First wrong layer:** UI/settings state propagation or cache consistency.
- **Current state:** A theme selected by a super admin is not stable during ordinary browsing. One public page can render with the configured theme and the next internal navigation can render a different theme without any settings change. This is separate from ISSUE-072, which only covers the stale `frontendTheme` default-shape test.
- **Next action:** Trace every `frontendTheme` authority and cache boundary (database, admin mutation/revalidation, SSR layout, cookie/local storage, hydration), reduce them to one authoritative resolved theme, then add browser coverage that navigates across multiple routes and proves the theme remains unchanged until a super admin deliberately changes it.

-->




<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-086` is **Resolved** and is NO LONGER an open issue. The
     detail block below is retained as lineage only, and its "unapplied", "1/2" and "next action"
     text is SUPERSEDED. The reopening was solely the missing supporting index on
     `data_overrides(admin_user_id) -> auth_users(id)` omitted by migration 073 — never a defect
     in the durable admin-override behaviour, which remains validated by
     `tests/data-overrides-source-contract.test.ts` 6/6 and
     `tests/integration/draftguru-import.test.ts` 19/19 (an admin override surviving a destructive
     source reload under the restricted importer role). Repaired forward-only in migration 075
     with 073 untouched after application; 075 held until 074 could apply first; 074 then 075
     applied cleanly; ledger 75/75, 0 pending, no drift; `tests/integration/fk-indexes.test.ts`
     2/2; privileges reconciled; `afldb_test` fingerprint
     `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`. All evidence is from
     `afldb_test`; no production or `afldb_dev` application is claimed. Authoritative records:
     the `AFLDB-ISSUE-086` entry in `issues.md` and `AFLDB-ISSUE-086.md`.

## AFLDB-ISSUE-086 — Durable admin overrides: `data_overrides(admin_user_id)` is an unindexed foreign key (RETIRED)

- **Severity:** Medium
- **Area:** Admin / Data integrity
- **Key files:** `src/db/migrations/073_data_overrides.sql` (applied,
  checksum-baselined, **must not be edited**);
  `src/db/migrations/075_data_overrides_fk_index.sql` (**applied to `afldb_test`
  2026-08-28, after 074; now checksum-frozen — must not be edited**);
  `tests/data-overrides-source-contract.test.ts`;
  `tests/integration/fk-indexes.test.ts` (read-only here);
  `AFLDB-ISSUE-086.md` (runbook, durable source of truth).
- **First wrong layer:** Database schema (migration 073).
- **Current state:** REOPENED 2026-08-28. The durable-override fix itself is
  validated and unchanged: checksum-baseline repair completed successfully; the
  clean rebuild through migration 073 passed **13/13** final validation;
  migration status **73/73, 0 pending, no drift**; DB-free source contract
  **6/6**; restricted-role DraftGuru integration **19/19**. Reopened for a
  separate proven defect: migration 073 declares
  `admin_user_id integer NOT NULL REFERENCES auth_users(id)` but indexes only
  `(entity_type, entity_key)`, so `tests/integration/fk-indexes.test.ts` was
  **1/2** on `data_overrides(admin_user_id) -> auth_users` and a parent-side
  `auth_users` delete sequentially scans `data_overrides`. Migration 075 is the
  forward repair (`CREATE INDEX IF NOT EXISTS ix_data_overrides_admin_user_id
  ON data_overrides (admin_user_id);`) and is **APPLIED to `afldb_test`**:
  `AFLDB-ISSUE-096` applied **074 then 075** in that order on 2026-08-28
  (75 files, 75 applied, 0 pending, no drift; privileges reconciled), and
  `tests/integration/fk-indexes.test.ts` is **2/2**, validating ISSUE-096's three
  074 FK indexes and this issue's `ix_data_overrides_admin_user_id` in one pass.
- **Exact next action:** *(The previous action — "repair ISSUE-096's migration
  074 first, then apply **074 then 075**, then re-run
  `tests/integration/fk-indexes.test.ts` and expect 2/2" — was executed on
  2026-08-28 and passed.)* The unindexed-FK defect is repaired and
  database-validated. **Whether that closes `AFLDB-ISSUE-086` is this issue's own
  decision** — `AFLDB-ISSUE-096` synced the proven facts only and changed no
  status, scope, ownership or historical conclusion. Migrations 073, 074 and 075
  are all applied and checksum-frozen: do not edit any of them, and do not
  renumber 075.

-->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-090` is **Resolved** and is NO LONGER an open issue.
     The detail block below is kept as lineage only. Every "Current state", "Next action"
     and HALT line in it is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-090` entry
     in `issues.md` (Resolution, 2026-08-28) and `AFLDB-ISSUE-090.md` §27. -->

## AFLDB-ISSUE-090 — DOB enrichment conflict writes are not pass-scoped or idempotent (RETIRED)

- **Status:** **Resolved 2026-08-28.** Final validation, operator-run against the
  canonically rebuilt `afldb_test`: DOB reconciliation suite **27/27** · canonical
  external-identity release assertion **1/1** (63 skipped; pin **13,275**) · privileges
  **24/24** with **no grant widened**. Resolved against the amended standard at
  `AFLDB-ISSUE-090.md` §27.4. **The full `release-gates.test.ts` suite is NOT green** —
  Gate 1 was 42 passed / 22 failed; the 16 unrelated failures keep their own owners and were
  left unchanged.

- **Severity:** Medium
- **Area:** Data integrity / Import
- **Key files:** `tools/migration/enrich_birth_dates_from_club_lists.py` (`:412-432`),
  `tools/migration/enrich_birth_dates.py` (`:407-412`),
  `src/db/migrations/072_dob_conflict_ownership.sql` (new),
  `tests/integration/dob-enrichment-issues.test.ts` (new)
- **Runbook:** `AFLDB-ISSUE-090.md` — durable source of truth. Planning COMPLETE/APPROVED;
  **implementation COMPLETE and validated 2026-08-28** (§27.4 standard, §27.6 resolution) —
  the "implementation IN PROGRESS" text that stood here is superseded lineage.
  Migration 072 APPLIED to `afldb_test`
  (`db:status` 72/72, 0 pending). `dob-enrichment-issues.test.ts` post-migration rerun
  GREEN 23/23 (fixed a test-harness bigint/string assertion defect on the way, not a
  migration defect). `AFLDB-ISSUE-091`'s migration-checksum blocker is Resolved.
- **Current state (SUPERSEDED 2026-08-28 by the Gate 1 result below; retained as lineage):**
  `release-gates.test.ts` validation was HALTED; **the halt is LIFTED as
  of 2026-08-28**. The intended duplicate-`dob_conflict` gate is GREEN (the fix ISSUE-090 set
  out to make). Two unrelated `external_identities` gates had flipped green→red (expected
  12,472 `afltables_profile_url`/`unique` rows, found 0) — root-caused to a pre-existing
  importer defect in `enrich_birth_dates.py` exposed by this issue's own new regression
  suite, **not** to migration 072 (conclusively ruled out — see `AFLDB-ISSUE-090.md`). That
  defect was tracked as **`AFLDB-ISSUE-092`**, which is now **Resolved** (fail-closed
  population gate + `--source-key` containment, validated 27/27 on 2026-08-28), and the
  emptied population was restored to **13,275** by the 2026-08-27 canonical rebuild. The
  0-row condition is gone; what remains is whether the 12,472 pin is still the right expected
  value — an ISSUE-090 decision. This issue is **OPEN and unblocked**, not resolved.
- **Approved decisions:** D1 identical resolved recurrence suppressed (assertion-specific);
  D1a no `recurrence_of`; D2 targeted partial unique index; D3 equivalent
  `dob_internal_conflict` invariant; D4 `external_identity_conflict` is follow-up;
  D5 recompute `players.dob_disputed`.
- **Gate 1 result (2026-08-28):** `release-gates.test.ts` — **64 tests, 42 passed, 22
  failed**, every failure classified in `AFLDB-ISSUE-090-HANDOFF.md` §11.3. **ISSUE-090's own
  duplicate-`dob_conflict` invariant (`:497-507`) is GREEN.** Six failures touched this
  issue: the one stale pin (repaired) and five `gate: birth dates` population assertions
  (retired as acceptance). The other 16 are owned by `AFLDB-ISSUE-095` (3),
  `AFLDB-ISSUE-093`/DraftGuru B3 (2), `AFLDB-ISSUE-096`/`-098`/`-099` (2), rebuild-baseline
  drift (4) and two unowned gaps (5) — **left unchanged.**
- **The one repair:** `tests/integration/release-gates.test.ts` `gate: birth dates` →
  `matches players on the profile URL rather than the name`, `12_472` → `13_275`. A
  **test-baseline repair caused by the canonical rebuild, not a data change** — live
  `afldb_test` 13,275, accepted baseline `measured.players` 13,275,
  `identity_scan.distinct_urls` 13,275, `missing_url`/`malformed_url` 0, Stage 9 PASSED.
  12,472 was the retired `AFLDB_LEGACY_SQLITE` register population. **The
  `player_birth_evidence` 12,472 pin was NOT re-pinned** — a different population, live 855.
- **Acceptance amended (`AFLDB-ISSUE-090.md` §27):** ISSUE-090 no longer has to recreate the
  old 12,478-player enriched DOB snapshot. The canonical rebuild invokes neither enrichment
  pass; `players_with_dob: 855` / `players_with_dob_conflict: 0` are the accepted baseline's
  own contracted figures; the register pass requires `AFLDB_LEGACY_SQLITE` **and** would
  resolve zero players because nothing canonical writes `players.legacy_player_id`; the
  club-list pass's CSV directory is gitignored and absent. Old requirement preserved as
  lineage at §27.3; revised standard at §27.4.
- **Next action — NONE. SUPERSEDED, retained as lineage.** This bullet read *"run
  `npm test -- tests/integration/privileges.test.ts` (Gate 2) … This issue remains **OPEN**
  until Gate 2 passes."* Gate 2 was run on 2026-08-28: **24/24 PASS, no grant widened.** With
  that, every item of the `AFLDB-ISSUE-090.md` §27.4 standard is met and the issue is
  **Resolved**. There is no outstanding ISSUE-090 action.

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-092` is **Resolved** and is NO LONGER an open issue.
     Its index row and detail block have been removed from this open-issues-only file.
     Authoritative records: the `AFLDB-ISSUE-092` entry in `issues.md` and
     `AFLDB-ISSUE-092.md` §17 (§17.1 implementation verification, §17.2 recovery superseded
     by rebuild, §17.5 acceptance validation).

     Outcome: the fail-closed `external_identities` population-drop gate
     (`check_population_drop()` in `tools/migration/common.py`, reused by
     `import_fitzroy_core.py`) plus `--source-key` containment were implemented 2026-08-25
     and VALIDATED 2026-08-28 — `npm test -- tests/integration/dob-enrichment-issues.test.ts`
     **27/27, no skips**, tests 24–27 executed and green. §6 recovery of the emptied test
     database was superseded by the 2026-08-27 canonical rebuild, which repopulated the
     AFL Tables identity population to **13,275** through the gated import path.

     The historical incident (a one-row synthetic register wiping the real 12,472-row
     population via `dob-enrichment-issues.test.ts` test 5) is preserved in full in
     `issues.md` and `AFLDB-ISSUE-092.md` §1/§2 and must not be erased.

     Downstream: `AFLDB-ISSUE-090` is UNBLOCKED but still OPEN, listed above. Its two
     external-identity release gates are pinned at the stale legacy-derived 12,472 against a
     canonical 13,275; that re-pin is an ISSUE-090 decision and 12,472 must not be silently
     reinstated. -->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-095` is RESOLVED. Retained as lineage only; it is
     NOT an open issue and its "next action" text is SUPERSEDED. See `issues.md` and
     `AFLDB-ISSUE-095.md` §14.

## AFLDB-ISSUE-095 — Canonical legacy-free ladder / team-season acquisition

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Key files:** `AFLDB-ISSUE-095.md` (runbook, durable source of truth);
  `tools/migration/rebuild_derived.py` (`REBUILDS["club_seasons"]`, `:312`);
  `tools/migration/import_legacy_afl.py` (`:767`, `:776`, `:795`, `:996`, `:1021`);
  `src/db/migrations/006_draft_relationships.sql` (`:55-80`);
  `src/db/queries/player-derived.ts` (`recomputeClubSeasons`, `:402-411`);
  `tools/db/rebuild-test.ts` (Stage 9); `data/reference/sources.json`
- **Current state:** OPEN, nothing implemented. Proven during ISSUE-093's first complete
  canonical clean rebuild (`AFLDB-ISSUE-093.md` §H15.5): `club_seasons` is built **only** from
  `staging.team_seasons`, whose **only** writer is `import_legacy_afl.py` under
  `AFLDB_LEGACY_SQLITE`. The canonical rebuild deliberately has no legacy staging-load stage,
  so `club_seasons = 0` is the *expected* outcome of a legacy-free rebuild, not a defect in it.
  Degraded while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season
  NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`,
  `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser`/`plan`/`vocab`,
  `lib/edit/spec.ts`). Also note `recomputeClubSeasons` fails closed on an empty
  `staging.team_seasons`, so match create/delete/score-edit throws for every season on a
  canonically rebuilt database — by design, not a new defect.
- **DB-free validation: GREEN for this issue** (`AFLDB-ISSUE-095.md` §12) — 309 passed,
  6 skipped, plus the resolver contract 37/37. The single remaining failure,
  `reference-data.test.ts` → `finds the tables created after 045 that never registered
  import write`, is **`AFLDB-ISSUE-096`/`-086` drift** from migrations 073/074
  (`data_overrides`, `promotion_decisions`) and was deliberately left untouched: repairing
  it asserts a privilege decision that belongs to ISSUE-086's blocked manual-authority
  contract.
- **Witness acquired and validated (`AFLDB-ISSUE-095.md` §13).** `ladder-20260828`,
  129 files / 1,622 rows, pinned in the contract by `accepted_witness` + manifest sha256.
  New single-authority validator `tools/rebuild/fitzroy/validate_ladder_witness.py`
  (26/26 offline, no DB, no network); D7 cross-check wired as a tenth **validation** stage
  (`ladder-witness`, between `derived` and `fingerprints`) — the four-stage **data**
  topology is unchanged and now asserted. Durability reuses ISSUE-093's convention:
  bytes gitignored, manifest tracked, PRECHECK refuses before destruction — proven by
  execution (exit 2 with bytes absent, 0 restored).
- **Exact next action:** the clean `afldb_test` rebuild — a **separate authorisation**, and
  the only thing that can prove the D7 cross-check. It is a **full destructive recreate**
  of `afldb_test`. **ZERO supported `AFLDB_LEGACY_SQLITE` dependency.**
- **Do NOT** add a `club_seasons` non-zero Stage-9 gate until this lands — it would fail every
  canonical rebuild over a known, deliberate gap.
- **Links:** `AFLDB-ISSUE-093` (Resolved 2026-08-27, this issue is its recorded follow-up) and
  `AFLDB-ISSUE-015` (Resolved 2026-08-22, per-season `recomputeClubSeasons` parity) —
  **linked, not absorbed**; ISSUE-015's status is unchanged.

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-096` is **Resolved**, complete within its authorised S1–S4
     scope. The detail block below is retained as lineage only. It is NOT an open issue, and its
     intermediate "UNAPPLIED", "BLOCKED", "not yet run" and "next action" text is SUPERSEDED:
     migration 074 is applied and checksum-frozen (074 before 075, 75/75, 0 pending), and the
     final validated evidence is source contract 106/106, spine suite 13/13, FK gate 2/2,
     privileges 24/24, fingerprint
     `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.
     Authoritative records: the `AFLDB-ISSUE-096` entry in `issues.md` and `AFLDB-ISSUE-096.md`
     §16.16–§16.17. The remaining §5.H partial and blocked rows are NOT unfinished ISSUE-096 work:
     they are either consequences with no code to exercise until a future persistence/accept path
     exists, or downstream capabilities owned by `AFLDB-ISSUE-086` (manual authority),
     `AFLDB-ISSUE-099` (the `data_issues` disagreement row) and
     `AFLDB-ISSUE-101` (rollover supersession), all of which remain open above.

-->

## AFLDB-ISSUE-096 — 2026+ API-first acquisition architecture and contract (RETIRED)

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-ISSUE-096.md` — **durable source of truth for this issue**.
  `AFLDB-2026-API-ACQUISITION.md` is the parent investigation runbook (§4, §9 row A, and §13 for
  the dated P1–P7 probe results).
- **Key files:** `data/reference/source-families.json` (new, S1),
  `src/lib/acquisition/source-families.ts` (new, S1), `tests/reference-data.test.ts` (extended);
  `src/db/migrations/074_source_observation_spine.sql` (new, S2, **applied to `afldb_test`**),
  `tests/integration/observation-spine.test.ts` (new, §5.H schema half),
  `src/lib/acquisition/observations.ts` (new, S2), `src/lib/acquisition/reconciliation.ts`
  (new, S3), `tests/current-season-import.test.ts` (extended, S2+S3);
  orientation only: `src/lib/external-afl/current-season-import.ts`,
  `src/db/migrations/063_external_current_match_sources.sql`, `064_matches_external_provenance.sql`
- **Approval:** **HALT LIFTED 2026-08-28.** Decisions A–H and the §12 items approved and recorded
  verbatim in `AFLDB-ISSUE-096.md` §14: three-grain observation model; retain
  `staging.external_current_matches`; **no automatic canonical promotion in v1**; ISSUE-086
  authority boundary is interface-and-invariant only; Kali sits in the Squiggle independence group;
  **P1/P2/P7 are not retried** and no local database substitutes for P7. The issue is now
  foundation implementation S1–S4; family importers remain excluded.
- **S1 IMPLEMENTED (2026-08-28):** tracked source-family registry + pure fail-closed typed parser
  + DB-free contract tests. **Seven** families over four sources; **no family is promotable**;
  AFL API lineup columns deliberately `incomplete` so a round-20 payload refuses;
  `afltables.player_match_stats` and `kali_afl_stats.player_stats` are `identity_only`. No
  migration, no importer, no `sources.json`/`seasons.json` change.
- **P1/P2 RE-RUN 2026-08-28 (user supplied `KALI_AFL_API_KEY` and authorised the retry) — both
  PASS, and P1 AMENDED S1.** Kali `/matches` is **not** a Squiggle proxy: a genuine value
  disagreement on a completed match (Essendon v Port Adelaide 2026-08-23, Kali 95–105 vs
  Squiggle 95–104 at `complete=100`), `crowd` on 80/204 rows where Squiggle has no attendance
  field, 0 shared ids, a different venue vocabulary on 80/160 joined games, no goals/behinds.
  `kali_afl_stats.match` therefore moved to its own `kali` group and to a fully declared
  14-column shape (`sourcedAt` = `source_updated_at`, new `kali_2026` round vocabulary);
  `/fixture` stays a proven proxy in the `squiggle` group. **P2:** no player id on the Kali stat
  grain, so a new `kali_afl_stats.player_stats` family records the gap as `identity_only`.
  **Residual, flagged for review:** P1 disproves *pairwise* derivation; a *common ultimate
  upstream* is not excluded. **P7 stays BLOCKED; no local database substitutes for it.**
- **Current state:** Evidence baseline established 2026-08-28:
  **P3/P4/P5/P6 PASS**, **P5 stop condition NOT triggered** (`url` is 0 NA and 1:1 with `ID`, but
  **`ID` is 82 NA in-season — key on `url`**); **P1/P2 BLOCKED**, no `KALI_AFL_API_KEY`;
  **P7 BLOCKED**, SSH refused and **no database queried**. Contract drafted: three observation
  grains (immutable payloads / ordered versions / current-key state, so A→B→A stays three ordered
  states while repeat polling stays idempotent), reconciliation verb set, reviewed-promotion
  contract with a stale-review recheck, source containment, independence groups, season lifecycle.
- **S2 IMPLEMENTED (2026-08-28), DB-free suite GREEN, migration still unapplied:** `src/db/migrations/074_source_observation_spine.sql`
  (**unapplied**) — three observation grains + `promotion_candidates` + append-only
  `promotion_decisions`; `src/lib/acquisition/observations.ts` (pure: no DB/fs/network/clock);
  `tools/maintenance/privileges.sql` registered so the append-only grant survives a reconcile;
  28 DB-free tests. A→B→A stays three versions over two payloads because history is keyed
  by `version_seq` and **never** unique on `payload_hash`. Acceptance fails closed, and manual
  authority `indeterminate` refuses exactly as `conflict` does.
- **Validation 2026-08-28, three runs: 59/61 (FAILED) → 61/61 (PASSED) → post-hygiene 61/61,
  0 failures, 303 ms (PASSED). S2 IS COMPLETE AND GREEN.** All behavioural tests passed every
  time. The two red assertions
  (`:653` append-only grants, `:668` history uniqueness) were **confirmed false positives**:
  `[^;]*` is not a SQL statement boundary, so both regexes spanned the migration's own
  explanatory comments. Only the **tests** were repaired — a `sqlStatements()` helper strips
  `--` comments and splits on `;`, and the assertions now pin the complete set of executable
  GRANTs on `promotion_decisions` and the single `UNIQUE` statement on the versions table.
  Migration unchanged, no invariant weakened (`AFLDB-ISSUE-096.md` §16.3).
- **S2 hygiene FIXED 2026-08-28 (§16.4):** the two literal NUL bytes in `observations.ts:499`
  are now `U+0000` escapes — **same character, so `observationKey()` output is byte-identical**;
  the runbook's suggested "plain space" separator was NOT adopted, as it would change runtime
  semantics and let a value containing a space make a key ambiguous. Header corrected to
  "migration 074". `073_data_overrides.sql` (ISSUE-086) still observed, not investigated (§16.5);
  `privileges.sql:294`'s "Migration 073" is ISSUE-086's and is correct.
- **S3 COMPLETE and GREEN 2026-08-28 — user-run `npm test -- tests/current-season-import.test.ts`:
  `84/84`, 0 failures, 316 ms.** `src/lib/acquisition/reconciliation.ts` (new, pure: imports only
  `./observations` and `./source-families`) computes exactly Decision C's ten verbs from a live
  payload against the stored open version, precedence exported as `VERB_PRECEDENCE`:
  `stale_review → absent → unchanged → unresolved_identity → foreign_owned_collision →
  source_disagreement → manual_authority_conflict → new / rescheduled / corrected`. Structural
  evidence resolves before content; refusal gates run only when a canonical change is actually
  proposed; `unchanged` comes only from the family hash contract; `rescheduled` stays distinct from
  `corrected`; `absent` is observation state and never deletion; `source_disagreement` needs
  disagreeing **independence groups**, not two source rows; foreign **or unreadable** ownership
  fails closed **before** authority is asked; provider agreement never substitutes for authority;
  `conflict` and indeterminate authority both fail closed; no database/network/filesystem/clock/
  write path, and no force, override or consensus shortcut.
- **`history_only` — settled S3 outcome, not an eleventh verb.** A changed payload that advances
  history but moves **no projected canonical fact field** (Squiggle completion `90 → 100`) returns
  `history_only`: not in `RECONCILIATION_VERBS`, not a candidate verb, not a canonical change —
  history advances with no fact-level proposal. Calling it `unchanged` would erase a real
  source-state transition; calling it `corrected` would propose a candidate with no changed fields.
  Do not redesign unless S4 integration evidence contradicts it.
- **S4 IMPLEMENTED 2026-08-28, AWAITING VALIDATION (§16.10).** New pure module
  `src/lib/acquisition/promotion-review.ts`: the candidate record with migration 074's CHECK
  constraints enforced in TypeScript; `baselineCanonicalHash` over **exactly the proposed fields**
  (`sha256/v1(canonical-fields)`, sorted names, sorted keys at every depth, 64 hex chars, null for a
  `new` target, refusal on an unread field); `renderReviewItem`; `evaluateAcceptRequest`; the
  requeue/supersede rule; and reject/requeue decision drafts. Render and accept both run
  `runPromotionGates`, which recomputes the baseline from re-read values and then delegates to
  **S2's `evaluateAcceptance`** — gate order and the `stale_review` / `stale_canonical_target`
  distinction unchanged. `stale_canonical_target` ⇒ re-render in place (stays pending);
  `stale_review` ⇒ **supersede** so reconciliation can insert the replacement. One additive,
  behaviour-preserving change to `observations.ts`: the canonicaliser is hoisted and exported as
  `canonicalJson`, because a family's payload `hash_exclusions` must never be applied to canonical
  values. 20 DB-free tests added to `tests/current-season-import.test.ts`.
- **§7 gate INTACT and enforced by construction.** `PromotionDecisionDraft` has **no `'accept'`
  decision** and typed-`null` value columns, so S4 cannot represent an acceptance; a cleared
  evaluation returns `write: { implemented: false, blockedBy: 'canonical_write_unimplemented' }`
  with `canonicalChange: 'none'`. Under `UNAVAILABLE_MANUAL_AUTHORITY` every promotable verb —
  `new` included — refuses. **Blocked pending ISSUE-086:** the canonical acceptance transaction
  (write + provenance quartet + `accept` decision row) for `corrected`/`rescheduled` onto an
  existing row. No force flag, override, bypass or consensus shortcut added.
- **Checkpoint — all four approved stages complete:** S1 `34/34`, S2 `61/61`, S3 `84/84`, **S4
  complete and green `105/105`** (0 failures, 357 ms, final post-hygiene run, user-run 2026-08-28).
  The **canonical acceptance/write transaction remains deliberately unimplemented** behind
  ISSUE-086's authority gate, and the S4 type/state model must **not** be read as evidence those
  writes exist. `history_only` remains settled as an observation-layer outcome only. Migration
  **074 UNAPPLIED**, with **no production and no `afldb_dev` database work** at any point.
  `AFLDB-ISSUE-100` remains separate. **No CHANGELOG entry** — nothing has landed behaviour.
- **NUL hygiene RESOLVED (§16.11).** Both `observations.ts` and `source-families.ts` carried a raw
  `0x00` where the intended value is U+0000. The assistant located the second one (the
  `parseSourceFamilyRegistry` duplicate-declaration machine key) but **could not repair it
  natively** and stopped for evidence; **the user verified (`cat -A` showed `^@`, proving the
  separator had not become a space) and performed the byte-level repair**, after which
  `grep -naP '\x00'` returned no matches and the suite stayed green. Runtime semantics unchanged.
  PostgreSQL `text` still cannot store U+0000 — a forward concern only if a later stage proposes
  persisting one of these composite machine keys.
- **Schema/migration gate GREEN 2026-08-28 (`AFLDB-ISSUE-096.md` §16.16).** The migration-073
  baseline blocker is **closed**; the §16.14 three-index repair landed in 074 before its first
  application; 074 and 075 were then applied in normal filename order — **074 then 075** — to
  **`afldb_test` only**. **75/75 applied, 0 pending, no drift**; privileges reconciled;
  `tests/integration/fk-indexes.test.ts` **2/2** (real-catalogue proof of ISSUE-096's three 074
  indexes and `AFLDB-ISSUE-086`'s `data_overrides.admin_user_id` at once); fingerprint
  **`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`**.
- **§5.H refreshed (§16.16 supersedes §16.15).** `src/lib/acquisition/` still has **no persistence
  layer**, so 074 created tables and not a writer for them. New suite
  `tests/integration/observation-spine.test.ts` drives the real `decideObservation`/`sweepAbsences`
  and applies each decision to `afldb_test`, reading each head **back out of PostgreSQL**; it
  proves the **schema half** of §5.H only. **2 fully executable** (A→B→A correction replay;
  absence ≠ deletion), **3 partial** (idempotence; foreign ownership; stale-review race),
  **3 BLOCKED** (manual authority — ISSUE-086; `data_issues` disagreement row — never implemented;
  rollover supersession — ISSUE-101, no supersession column in 074). **No canonical
  acceptance/write path exists or was added**; no blocked row was faked.
- **VALIDATION GREEN 2026-08-28 (user-run):** `tests/current-season-import.test.ts` **106/106**,
  `tests/integration/fk-indexes.test.ts` **2/2**, `tests/integration/observation-spine.test.ts`
  **13/13**. The FK gate validates the §16.14 source-contract FK repair in 074 and ISSUE-086's 075
  index together. The first spine run failed only on a **fixture** defect — the seed wrote
  `seasons.is_complete`, generated from `status` since migration 015 — which aborted ten cases in
  shared setup before their bodies ran; the seed now writes `status = 'in_progress'`, **no
  behavioural assertion changed**, rerun 13/13. **13/13 proves the implemented PostgreSQL/schema
  half of §5.H only** — not an importer and not a canonical accept transaction, neither of which
  exists. The three partial rows stay partial and the three blocked rows stay blocked.
- **Exact next action — the last ISSUE-096-owned validation gap:** 074's append-only-by-grant
  invariant on `promotion_decisions` now has catalogue coverage in
  `tests/integration/privileges.test.ts`'s existing append-only contract (positive `SELECT`/`INSERT`
  grant, plus no `UPDATE`/`DELETE`/`TRUNCATE` for `afldb_auth`); `privileges.sql` was inspected and
  **not changed**, its spec was already correct. **Run
  `npm test -- tests/integration/privileges.test.ts`. Do not close ISSUE-096 until it passes.**
- **Exact next action: none inside ISSUE-096 as approved.** §11 decomposes to S1–S4 and stops, so
  **there is no approved S5** — a next stage is a fresh approval decision (§16.12). Unbuilt work and
  blockers: (1) the canonical acceptance/write transaction — **blocked on `AFLDB-ISSUE-086`** by
  §7's gate; (2) applying migration 074 + the §5.H PostgreSQL tests — **not** ISSUE-086-blocked but
  a separate explicitly authorised step, **`afldb_test` only**; (3) the admin review screen — an
  explicit §2 **non-goal** of this issue. Do not apply migration 074 and do not implement
  ISSUE-086 here.
- **Manual-authority boundary:** ISSUE-096 defines only the invariant and the fail-closed
  interface; the **mechanism/storage (incl. `data_overrides`) belongs to `AFLDB-ISSUE-086`** and is
  not pre-empted. Promotion of `corrected` candidates onto existing rows is gated on that contract.
- **Unblocked by this evidence:** `AFLDB-ISSUE-099` (P5) and `AFLDB-ISSUE-100` (P3) are no longer
  probe-blocked. `AFLDB-ISSUE-098` remains independently actionable.
- **Do NOT** implement any family-specific importer here (`AFLDB-ISSUE-099`, `AFLDB-ISSUE-100`
  own those). Do NOT duplicate `AFLDB-ISSUE-086` or `AFLDB-ISSUE-095`.
- **Approved policy retained:** free sources only; fetch/staging/diff automatic; canonical
  promotion reviewed by default; lineups staging-only; in-progress season only; completed
  seasons re-acquired via the full-history fitzRoy path.

-->

## AFLDB-ISSUE-099 — In-season AFL Tables settle stage

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-ISSUE-099.md` — **durable source of truth, approved implementation
  contract.** `AFLDB-2026-API-ACQUISITION.md` §2.4, §5, §9 row D, §13.5 is the parent
  investigation record.
- **Key files:** `tools/rebuild/fitzroy/acquire_core.R`, `fitzroy-contract.json`,
  `tools/migration/import_fitzroy_core.py`, `src/lib/acquisition/*`,
  `src/db/migrations/074_source_observation_spine.sql` (applied — **must not be edited**)
- **Current state:** OPEN, **in implementation on branch `claude/issue-099`**. **T1–T6
  COMPLETE.** Migration **076 applied and checksum-frozen — never edit it**, a defect needs a
  forward migration. T6 delivered `observation-store.ts` (behaviour-preserving extraction),
  `settle-afltables.ts` (pure contract + settle transaction), the review-first operator CLI, and
  the `tests/integration/settle-afltables.test.ts` gate. Final evidence: integration **13 passed
  / 1 conditional skip**, `current-season-import` **153/153**, typecheck at the exact pre-T6
  baseline (13 errors in 4 unrelated files, zero ISSUE-099), targeted ESLint 0/0. O1 proved over
  executable SQL + surviving sentinels; no canonical fact row written by any settle transaction.
  2026 still has no player-match statistics, period scores, attendance or Brownlow votes —
  v1 writes NO canonical row by design.
- **P5 — SUPERSEDED GATE.** The previous entry read *"implementation gated on probe **P5**.
  If P5 shows no stable `ID`/`url` for 2026, implementation is blocked."* **P5 ran
  2026-08-28 and PASSED; the stop condition was NOT triggered.** Do not rerun it. Binding
  result: `url` **0 NA** and 1:1 with populated `ID`; `ID` itself **82 NA** in-season.
  **Key on the stable `url`; never require `ID`; names are never identity.**
- **Superseded wording:** the "snapshot labelled `partial`" description is stale —
  `acquire_core.R` no longer emits a `partial` label. The in-season path is a third
  `acquisition_kind` (`in_season_partial`) with its own offline adjudicator.
- **Approved architecture:** in-season partial acquisition + SHA-256 manifest → deterministic
  Python→TypeScript observation bundle → migration-074 observation persistence → typed family
  projections → reconciliation → `promotion_candidates` → idempotent `data_issues` →
  dry-run/apply reporting. Families: `afltables.match` (→ `matches`, `match_period_scores`;
  attendance is a `matches` field) and `afltables.player_match_stats` (→ `player_match_stats`,
  `brownlow_round_votes`).
- **v1 canonical-write prohibition:** ZERO canonical INSERT/UPDATE and no `accept`
  `promotion_decisions` row. Acceptance is a separately approved later stage; its
  prerequisites are recorded at `AFLDB-ISSUE-099.md` §16.
- **Schema:** new forward migration **076** only — typed staging projections,
  `data_issues.issue_key` + partial unique index, FK-covering indexes, grants. Migrations
  073/074/075 are **not** edited.
- **Dependencies:** `AFLDB-ISSUE-096` Resolved (074 applied, checksum-frozen);
  `AFLDB-ISSUE-086` Resolved but entity-scoped — a prerequisite of the acceptance stage,
  **not** a v1 gate.
- **Exact next action:** **fresh session — start T7**: the `data_issues` writer / refresher /
  resolver with ownership scoping, plus §23.2 dry-run/apply counter reporting. Its gate extends
  `tests/integration/settle-afltables.test.ts`; no schema work is needed (076 already carries
  `data_issues.issue_key` + `uq_data_issues_open_by_key`, and the identity helpers are
  unit-tested). Then T8. Carried-forward constraints are in `AFLDB-ISSUE-099.md` "T6 — COMPLETE":
  restricted `afldb_import` role parity is a conditional matrix check for T8, and the bigint
  `batchId` type mismatch is separately tracked cross-issue debt — do not cast bigint to int.

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-100` is **Resolved** (see `issues.md`). The detail
     block below is retained as lineage only. It is NOT an open issue and its
     "exact next action" is SUPERSEDED: L1-L3B2 shipped, migration 077 is applied and
     checksum-frozen, and real 2026 R20/R25 validation passed with idempotent replay
     (468 and 104 rows; 0 canonical writes; all canonical FKs NULL by design).
## AFLDB-ISSUE-100 — Staging-only lineup / team-announcement domain

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.5, §9 row E, **§13.10 (P3b evidence)**.
- **Key files:** `data/reference/source-families.json` (`afl_api.lineup` family +
  `afl_api_2026` round vocabulary), `tools/rebuild/afl_api/` (`afl-api-contract.json`,
  `acquire_lineups.R`, `emit_lineup_bundle.ts`), `src/lib/acquisition/lineup-bundle.ts`,
  `tests/afl-api-lineup.test.ts`, `tests/reference-data.test.ts`; new
  `staging.external_lineups` and the `afl_api` `sources` row (migration **077**, not yet written)
- **L2 COMPLETE and GREEN 2026-08-29** — bounded acquisition + deterministic observation bundle,
  **still entirely DB-free**: no migration, no `sources` row, no staging table, no persistence,
  no absence sweep. Three durable **family-local** contracts now exist: `external_record_id` =
  `providerId|teamId|player.playerId` in declared key order, refusing a missing, blank,
  non-string or `|`-containing component rather than escaping it; `scope_key` =
  `season=<int>;round=<int>`; and enumeration `complete: false` **permanently**, typed as the
  literal `false` so widening it fails typecheck. A **separate** `tools/rebuild/afl_api/`
  source contract was created rather than adding a fourth acquisition kind to
  `fitzroy-contract.json`, whose `applies_to_source` is AFL Tables. Gates: `afl-api-lineup`
  **38/38**; four suites together **272 passed / 2 pre-existing skips**; typecheck at the exact
  13-error unrelated baseline with **zero** ISSUE-100 errors. Proven end-to-end on live
  upstream: R20 468×20 with `lateChanges`, R25 104×19 without; in the real R20 bundle 26 verbatim
  `lateChanges` rows and 442 present-and-null, captain `false` 468/468, jumper integers 1–51,
  every projection null; re-acquire → re-emit byte-identical.
- **Current state:** OPEN, **L1 COMPLETE and GREEN 2026-08-29** — source-family contract only.
  **No schema, no migration, no persistence, no database access.** Both gates
  are satisfied: **P3 PASS** (identity — `CD_M…`/`CD_T…`/`CD_I…`, cross-endpoint join measured
  26/26) and **P3b PASS** (shape/types/NULLs/completeness — R20 468 × 20, R25 104 × 19). The
  column P3 counted but never enumerated is **`lateChanges`**, and it is **conditional**, so
  R25's 19 columns are a strict subset of R20's 20. 0 NA except `lateChanges` (442/468), 0 blank
  strings, **0 duplicate external keys over 572 rows**, exact fixture↔lineup **match-set**
  equality in both rounds. Gates: `tests/reference-data.test.ts` **39 passed / 2 pre-existing
  Python-gated skips**; `tests/current-season-import.test.ts` **172/172**.
- **Approved rule — retained explicitly:** **lineups are staging-only and never become
  canonical participation.** Canonical participation remains the played match sheet. No public
  surface. `promotion_policy` is `never` and is test-pinned.
- **Binding limitations (decisions, not gaps):** **absence sweeping DISABLED** —
  `markMissingObservationsAbsent()` is never called for this family and `absent_since` is never
  set, because match-set completeness does not prove row-grain completeness; migration-074
  version/idempotence persistence is otherwise reused unchanged. **`player.captain` not
  projected** — `FALSE` for 572/572 across 11 matches and 22 team instances, a sentinel, and
  deliberately *not* declared zero-is-missing. **`lateChanges` verbatim, never parsed or
  name-matched** — conditional, nullable, **team-grain** free text with no provider player ids.
  **No closed enum CHECKs** on `status`/`teamStatus`/`teamType`/`compSeason.shortName`/`position`
  — measured vocabularies, not provider contracts. **`required_columns` stays at five.**
- **Still unknown, and design-binding:** whether rows reflect the team **before or after** a late
  change (n = 1); whether team player-rows are **row-grain complete** on every run.
- **Corrected by P3b:** §13.3's round-25 record implied a uniformly unconfirmed payload; R25 is
  **50/50 mixed at match grain**. Identity finding unaffected.
- **L3A COMPLETE 2026-08-29 — all three provider→canonical mappings are `none`.** `CD_M…`/
  `CD_T…`/`CD_I…` appear in no migration, query or lib outside ISSUE-100's own code, and
  `afl_api` appears in no migration at all. `external_identities`'s only writer is
  `import_fitzroy_core.py:2285`, hard-coded to `afltables`/`afltables_profile_url`, so no
  `afl_api` identity exists and no approved bridge populates one. **No mapping was created.**
  **Pre-match match identity is structurally unavailable:** `matches` requires NOT NULL
  scores/result/margin (migration 003), so an unplayed fixture cannot exist there and
  `match_id` can never be NOT NULL. **Club resolution is incomplete:** 12/18 R20 team names
  resolve against the loader-derived alias set; six are marketing forms and two match no field
  at all. The DB-backed measurement was **not run** — no `.env` and no DSN in this worktree;
  none was fabricated.
- **OPTION B approved and implemented:** provider identity is NOT NULL and is the row identity;
  `match_id`/`club_id`/`player_id` are nullable and in no key. Mirrors
  `staging.external_current_matches` (migration 063). `lateChanges` is **settled as
  raw-observation-only** — no column, no table, no parsing, test-pinned.
- **Migration 077 APPLIED and CHECKSUM-FROZEN 2026-08-29** — `afldb_test` only, identity proven
  `afldb_test|afldb_owner`, **77/77 applied, 0 pending**. Registers `afl_api` **fail-closed**
  (idempotent on an identical row, `RAISE EXCEPTION` on a conflicting one — not 060/063's
  blanket `ON CONFLICT DO UPDATE`) and creates `staging.afl_api_lineup`. `jumper_number` is
  `text` per AFLDB's schema-wide convention (004/025/076). Two pre-application corrections
  landed first: the source description now describes the provider and the **lineup family
  only** rather than binding every future `afl_api` family, and "unauthenticated" became
  "requires no operator-supplied API key". **Never edit 077 — a defect needs a forward
  migration.** Gate: `tests/afl-api-lineup-migration.test.ts` **22/22**.
- **L3B2 COMPLETE and GREEN 2026-08-29.** `src/lib/acquisition/lineup-store.ts` persists an
  emitted bundle through the **074 spine** via the shared `persistSourceObservation()` (no
  second observation system), then upserts the typed projection linked to the exact
  `version_seq` read back from PostgreSQL, all inside one `sql.begin`.
  `tools/rebuild/afl_api/persist_lineups.ts` is the operator entry point. Proven properties:
  **`source_id` resolved internally from the literal `'afl_api'`** (no `sourceId` on the
  signature or options; refuses when the key is absent; refuses another source's bundle);
  **unresolved `match_id`/`club_id`/`player_id` stay NULL and the row still persists**;
  **no absence sweep**; **no DELETE/TRUNCATE executable path** (keyed upsert only — a code
  property, since `privileges.sql` grants `afldb_import` both schema-wide); **no canonical
  participation write** (writes exactly `import_batches` + `staging.afl_api_lineup`); **no
  typed `lateChanges` or captain projection**. Validation: `afl-api-lineup-store` **16/16**
  DB-free, `integration/afl-api-lineup-store` **11/11**, and **restricted-role parity GREEN**
  under `AFLDB_TEST_IMPORT_DATABASE_URL` (identity `afldb_test|afldb_import`; first persist,
  idempotent replay, revision advance). DELETE/TRUNCATE were deliberately **not executed**
  under that role — the invariant is that the path never issues them.
- **Exact next action:** **bounded real R20/R25 persistence validation** against the
  acquisitions already on disk at `data/sources/afl_api/lineups/`, then final close-out.
  Everything so far ran on synthetic fixtures. ISSUE-100 stays **Open** until that passes;
  CHANGELOG is deliberately not yet updated. Canonical enrichment (`match_id`/`club_id`/
  `player_id`) remains deferred by decision — `match_id` is unresolvable pre-match by schema,
  club enrichment would need ISSUE-099's private name-based resolver (12/18 on R20), and no
  `afl_api` player bridge exists. Note `tests/integration/fk-indexes.test.ts` scans
  `nspname = 'public'` only, so it does **not** cover this staging table's FK indexes — they
  were added by reading, as migration 076's were.

-->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-101` is **Resolved** (the reusable mechanism; see
     `issues.md` for the authoritative resolution record). The detail block below is retained
     as lineage only. It is NOT an open issue and its "not yet validated" / "Exact next
     action" text is SUPERSEDED: the focused suite is 131/131, the broader regression is
     5/5 suites / 472 passed / 6 existing skips, and
     `tests/python/ladder_identity_contract.py` passed every executable check (acquired
     witness bytes skipped — gitignored by design). **No season was rolled**, and actual
     2026 -> 2027 execution is intentionally deferred until the season is formally complete
     and genuine completed-season evidence exists.

## AFLDB-ISSUE-101 — End-of-season promotion / baseline rollover (RETIRED)

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §5 (rollover row), §9 row F.
- **Key files:** `src/lib/rollover/season-rollover.ts` (planner),
  `tools/db/rollover-season.ts` (CLI), `tests/season-rollover.test.ts`,
  `tools/migration/import_fitzroy_core.py` (offline `--contract` / `--stat-availability`),
  `tools/rebuild/fitzroy/validate_ladder_witness.py` (offline `--contract` / `--manifest-dir`),
  `data/reference/fitzroy-accepted-baselines.json`, `data/reference/seasons.json`,
  `data/reference/stat-availability.json`,
  `tools/rebuild/fitzroy/fitzroy-contract.json`,
  `tools/db/rebuild-test.ts` (`CLUB_SEASONS_EXPECTED.rows` only)
- **Current state:** OPEN. **Planner + CLI IMPLEMENTED 2026-08-29, not yet validated.**
  Pure DB-free planner computes and validates the whole successor state in memory; CLI is
  dry-run by default and `--apply` also requires `--acknowledge-season-complete`. No
  migration, no canonical write, no database connection, no clock read. **2026 is NOT
  rolled and the real 2025/2026 boundary is unchanged.**
- **Retired lifecycle vocabulary — ADJUDICATED 2026-08-29:** `retired` is the value for a
  baseline that was accepted and has since been replaced. Declared in the real register as
  `selection_policy.retired_statuses: ["retired"]` — a **policy declaration only**: the
  accepted baseline, `measured.seasons_last` (2025), `required_range` and both acquisition
  fingerprints are untouched. `accepted` may never be listed; `candidate` is **not** valid
  for a previously accepted baseline; unknown values refuse.
- **`accepted_corrections` — ADJUDICATED 2026-08-29:** no longer auto-inherited. Reviewed
  per acquisition via required `--accepted-corrections`; the outgoing record supplies
  **category names only**, never values; "no corrections" is stated explicitly as the same
  categories with empty arrays; missing/unknown/non-array categories and entries lacking
  `kind`/`rule` refuse.
- **Validator authority — corrected 2026-08-29:** operator-supplied validator stdout is no
  longer accepted. The CLI **executes** the validators on every invocation (dry run and apply
  alike), refuses on non-zero exit, and proves from the captured argv that each run was the
  right command against exactly the label/manifest/snapshot being bound. No
  `--skip-validation`, no supplied transcript, no cached success.
- **Pre-apply authority CLOSED 2026-08-29 (§14 of `AFLDB-ISSUE-101-HANDOFF.md`).** Backward-
  compatible, offline-only path overrides were added — `import_fitzroy_core.py --contract` and
  `--stat-availability` (both require `--validate-only`), and
  `validate_ladder_witness.py --contract` / `--manifest-dir` (both refused with `--compare`).
  **All defaults are unchanged**, so the rebuild orchestrator, `tests/python` and the settle
  path are unaffected. The CLI now materialises the computed successor contract and register
  in an OS temp directory and runs **three** gates before any tracked write:
  (1) `--validate-only --require-full-history`, (2) `--validate-only
  --require-accepted-baseline` against the successor register, (3) the offline ladder witness.
  Each captured run is bound by the **bytes read back** from the temporary files, so a gate
  that adjudicated some other state is refused. **`identity_scan` is now MEASURED by gate (1)
  and `--identity-scan` no longer exists as an input.** Only
  `validate_ladder_witness.py --compare` still waits for the rebuilt database.
- **Validation GREEN 2026-08-29 (user-run):** `tests/season-rollover.test.ts` **131/131**,
  no skips; broader regression **5/5 suites, 472 passed, 6 existing skips** (skip count
  unchanged from the 426/6 pre-override baseline). The importer's new paths are exercised
  end-to-end because `tests/fitzroy-core-import.test.ts` spawns it with `--validate-only`,
  `--require-full-history` and `--accepted-baselines`.
- **Exact next action:** run the one uncovered direct test of the changed witness validator —
  `.venv/Scripts/python.exe tests/python/ladder_identity_contract.py`. It is the only
  executable test of `validate_ladder_witness.py` (its §7 spawns it with **default** paths)
  and **no vitest suite runs it**, so the 472 do not cover that file. After it passes, the
  reusable mechanism is implementation-complete and `CHANGELOG.md` becomes appropriate; the
  only remaining work is the deliberate decision in `AFLDB-ISSUE-101-HANDOFF.md` §15.4 —
  defer live CLI exercise until a season actually closes, or rehearse against a throwaway
  temporary state. **Do not manufacture a fake 1897..2026 acquisition.**
- **Dependencies:** `AFLDB-ISSUE-099` and `AFLDB-ISSUE-095` are both **Resolved** — both
  dependencies are satisfied.
- **Corrected orientation (do not re-derive from the old wording):**
  - `matches_after_accepted_last_season` **already derives its boundary** from
    `accepted.measured.seasons_last` and re-points itself; it is not edited here. The gate
    that does **not** self-advance is `CLUB_SEASONS_EXPECTED.rows`.
  - `AFLDB-ISSUE-099` writes **zero canonical rows**, so there is no in-season canonical
    provenance to rewrite; supersession is the existing clean rebuild.
  - the old key-file list omitted `tools/rebuild/fitzroy/fitzroy-contract.json` and
    `data/reference/stat-availability.json`, which carry five of the coupled transitions.
- **Boundary:** **must not independently redefine completed-season `club_seasons` ownership**
  — that stays with `AFLDB-ISSUE-095`, which is **Resolved** and whose D1–D7 are
  **implemented, not open**. Its D7 already added six `club_seasons` Stage-9 gates. **Do not
  add another.** The only coordination point is the accepted ladder witness span.

-->

## AFLDB-ISSUE-102 — Awards have no canonical legacy-free acquisition path

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `AFLDB-2026-API-ACQUISITION.md` §2.7, §9 row G.
- **Key files:** `tools/migration/import_awards.py` (`:1408`)
- **Current state:** OPEN, **record only**. `import_awards.py:1408` still calls
  `require_env("AFLDB_LEGACY_SQLITE")`, so the awards/honours domain carries the same legacy
  dependency `AFLDB-ISSUE-095` records for `club_seasons`. No free API covers Coleman, Rising
  Star, All-Australian, AFLCA, AFLPA or club best-and-fairest; Brownlow is the exception via
  the AFL Tables path.
- **Exact next action:** none. **Do not design the replacement under this investigation** — no
  source selection, no per-award provenance decision, no importer work is authorised.
- **Links:** `AFLDB-ISSUE-095` as the direct sibling gap — linked, **not absorbed**.

<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is RESOLVED (see `issues.md` and
     `AFLDB-ISSUE-093.md` §H15). The detail block below is retained as lineage only. It is NOT
     an open issue and its "next action" text is SUPERSEDED: the first clean rebuild has since
     been executed and passed all nine stages with 13/13 final validation, and the only
     remaining follow-up is `AFLDB-ISSUE-095` above.

## AFLDB-ISSUE-093 — Deterministic afldb_test rebuild from authoritative sources (RETIRED)

- **Severity:** Medium
- **Area:** Tooling / Data integrity / Import architecture
- **Key files:** `AFLDB-ISSUE-093.md` (durable source of truth, §15 = Phase-1 record,
  §16 = Phase-2 record); `AFLDB-ISSUE-093-PHASE-3-HANDOFF.md`; `data/reference/*.json`;
  `tools/migration/load_reference_data.py`; `tests/reference-data.test.ts`;
  `tools/rebuild/fitzroy/` (contract + `acquire_core.R`);
  `tests/fitzroy-acquisition.test.ts`;
  `docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json`.
- **Current state:** Architecture approved; **Phase 1 COMPLETE (2026-08-25)** —
  static/reference domains ported to tracked JSON datasets + standalone loader,
  validated 12/12; old test DB preserved as `afldb_test_pre_rebuild_20260825`
  (`ALLOW_CONNECTIONS=false`, reference-only). **Phase 2 COMPLETE (2026-08-25)** —
  fitzRoy pinned at 1.8.0 (fail-closed version gate), canonical AFL Tables acquisition
  (`fetch_player_stats_afltables` + details + results) verified by real probes and a
  real `trial-2024` acquisition with a tracked SHA-256 manifest; stable ID/name/URL and
  match identity/scores/venue SUPPORTED; DOB/match stats/Brownlow votes (correct
  per-player-per-match grain)/attendance SUPPORTED WITH COVERAGE LIMITATION;
  `player_match_period_stats` MISSING (deferred). 13/13 static tests; zero
  `AFLDB_LEGACY_SQLITE`/PostgreSQL dependency. There is still no database named
  `afldb_test`; no load has been executed anywhere yet.
- **Depends on:** `AFLDB-ISSUE-092` §4 (the fail-closed `external_identities`
  population-sanity gate) must land in whatever importer owns that reconciliation before it
  is ever run against `afldb_test`, rebuilt path or not — this is now part of Phase 3.
- **Phase 3 IMPLEMENTED (2026-08-25, §17):** club-list DOB enrichment wired to canonical
  `data/sources/afltables/club_lists/` (complete-or-refuse in canonical mode, fail-closed
  header/file validation before any DB access, `--require-complete`;
  `tests/club-list-sources.test.ts` new) + ISSUE-092 §4 gate/§5 containment implemented
  (see that issue). Static gate PASS 33/33 (user-run 2026-08-25). DB-side validation of
  the gate tests awaits a test database.
- **Phase 4a IMPLEMENTED (2026-08-25, §18):** `tools/migration/import_fitzroy_core.py` —
  canonical snapshot+manifest → venues, players (+DOB evidence under the distinct
  fitzRoy source, external identities under the ISSUE-092 gate), matches/period
  scores/attendance, player_match_stats (explicit STAT_MAP, NULL ≠ 0), derived
  brownlow_round_votes (coverage-gated, NA ≠ 0). Fail-closed manifest/SHA-256/column
  validation before any DB access; `--validate-only` needs no psycopg.
  `tests/fitzroy-core-import.test.ts` new.
- **Checkpoint (2026-08-27) — read `AFLDB-ISSUE-093.md` §19 first; it supersedes the
  per-phase history above.** Canonical full-history fitzRoy source FROZEN
  (`full-history-20260827`, 1897–2025, accepted via
  `data/reference/fitzroy-accepted-baselines.json` under `exactly_one_accepted`); DraftGuru
  Stage A + supported importer COMPLETE; legacy `import_draft.py` tombstoned; orchestrator
  `npm run db:test:rebuild` implemented but **never executed**. Stage B3 optional, not
  started.
- **Blocker 2 — RESET_SQL proof: IMPLEMENTED, awaiting execution (2026-08-27, §20).**
  Two real defects found and fixed while inspecting it: `runSql` never sent the SQL at all
  (`void client.unsafe(...)` — postgres.js only executes on `.then`/`.execute()`), so the
  destructive stage would have reported success against an untouched database; and the
  `pg_` schema exclusion (`NOT LIKE 'pg\\_%'` through two escaping layers) excluded nothing,
  so `DROP SCHEMA pg_toast` would have aborted the first loop. New rollback-only proof
  `tools/db/prove-reset.ts` + `npm run db:test:prove-reset`; DB-free suite 417/417.
- **Execution-path parity correction (2026-08-27 review, §20.5).** The proof originally ran
  `RESET_SQL` through postgres.js while the real rebuild ran it through psql — proving the
  SQL and leaving the mechanism untested. Now both go through one shared helper
  `tools/db/psql.ts` with identical binary and argv; the proof's stream always ends in
  `RAISE EXCEPTION`, so psql cannot commit it and **exit status 0 is treated as a failure**.
  psql availability is probed through the reset's own argv and fails closed before the reset.
  Owner policy hardened to a refusal: `current_user` and `session_user` must both be exactly
  `afldb_owner`, neither a superuser (§20.5a).
- **INCIDENT 2026-08-27 — THE ROLLBACK PROOF COMMITTED THE RESET; `afldb_test` WAS WIPED
  (§20.9a, §20.12).** psql exited 0 instead of aborting, and the read-only verification then
  returned MISMATCH: pre-proof `0229d62c…` → post-incident `f46ce34c…`, i.e. schemas 1
  (`public` only), relations 0, migrations absent, extensions 3 with all 56 extension-owned
  objects intact. **That is exactly the intended clean slate, so `RESET_SQL` is now
  empirically correct; the rollback containment is what failed.** Production and `afldb_dev`
  were never targeted. Loss was schema + privileges only — no fitzRoy import had ever run.
  Leading cause: the psql argv led with the DSN, and PostgreSQL's own non-permuting
  `getopt_long` (Windows) can then swallow `--single-transaction` and `ON_ERROR_STOP=1` as
  operands, leaving psql to autocommit each statement and exit 0 regardless of errors; the
  stream itself is byte-clean (0 CR, 0 backslashes, 0 NUL, balanced dollar tags, sentinel
  correctly wrapped in a `DO` block). Fixed: DSN passed as `-d`, a probe that fails unless
  stdin is delivered AND a raising script exits non-zero, a deferred-constraint commit trap
  armed before the reset that also detects autocommit and stops the stream before the first
  destructive statement, and redacted relaying of psql's output. `db:privileges[:test]` moved
  off the same argv shape.
- **SELF-COLLISION FOUND AND FIXED 2026-08-27 (§20.14), reproduced twice.** The hardened
  proof refused with "1 other client session(s) connected" while a standalone psql check saw
  none and the phantom vanished on exit. Cause confirmed from the connection lifecycle: the
  CLI held ONE postgres.js observer open across the whole proof, so psql — a second backend —
  correctly counted it, while the Node-side gate could not see itself
  (`pid <> pg_backend_pid()`). The gate was right; the harness was the intruder. Corrected to
  three phases with nothing spanning the psql run: observation session opened and CLOSED,
  then psql only, then a FRESH session for the post-rollback fingerprint. `ProofDeps` now
  exposes `withSession` rather than a `query` handle, so no connection can be kept open, and
  **no application_name/PID/role exemption was added** — asserted by test.
- **RESET BLOCKER 2 CLOSED 2026-08-27.** `afldb_test` reconstructed after the incident
  (migrations 001–072, privileges reconciled, PostgreSQL 16.15, `afldb_owner` non-superuser)
  and the rollback-only proof re-run against a real schema: pre-reset and post-rollback
  fingerprints both `a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7`
  (exact equality), health 950 relations / 3 extensions, psql exit 3 (the deliberate abort),
  1498 ms; inside the aborted transaction every rebuild-owned object class was 0 and the
  public schema, 3 extensions and 56 extension-owned objects were preserved.
- **Exact next action:** **FIRST ACTUAL CLEAN REBUILD**, fresh session, per the **FIRST CLEAN
  REBUILD HANDOFF (§H1–§H10)** at the end of `AFLDB-ISSUE-093.md`. The database holds
  migrated schema and privileges only — no canonical data has ever been loaded. The agent may
  inspect and prepare; the user runs the destructive command.
- **Superseded next action:** decide sequencing (§20.13). `afldb_test` is now an empty clean
  slate, so re-running the proof against it proves little. **Tell Codex before it touches
  `afldb_test` for ISSUE-083** — its schema and per-object grants are gone. Blocker 2 stays
  OPEN. Do **not** start the clean
  rebuild until it passes. Remaining blockers after that: ISSUE-083 restricted
  `afldb_import` parity (Codex, separate worktree, do not absorb), then the first actual
  clean rebuild. Preserved `afldb_test_pre_rebuild_20260825` stays locked, never an input.
  ISSUE-092 §11 tests 24–27 still pending.
-->

## AFLDB-ISSUE-109 — data editor writes `data_overrides` on a SELECT-only connection

- **Severity:** Medium
- **Area:** Admin / Privileges / Data integrity
- **Current state:** Open. `saveEdit()` in `src/db/queries/data-edits.ts` opens a short-lived
  `afldb_import` connection and inserts into `data_overrides` inside it, but migration
  `073_data_overrides.sql` deliberately grants `afldb_import` only `SELECT` on that table, and
  `tools/maintenance/privileges.sql` reconciles to the same grant. Confirmed live on `afldb_dev`:
  `has_table_privilege('afldb_import','data_overrides','INSERT')` is false. Reached only when an
  edit actually produces overrides.
- **Not a regression:** latent since `073` was written. Applying the committed migration to
  `afldb_dev` on 2026-08-29 moved the failure from *relation does not exist* to *permission
  denied*; it did not create it.
- **Key files/subsystem:** `src/db/queries/data-edits.ts`, `src/db/migrations/073_data_overrides.sql`,
  `tools/maintenance/privileges.sql`, `src/app/admin/data-editor/`.
- **Exact next action:** adjudicate ownership against `AFLDB-ISSUE-086`'s intent — either move the
  override write off the importer connection, or add a **new** migration widening the grant. Do
  not hand-`GRANT` on any host. Add a regression test that exercises an edit producing an
  override.
