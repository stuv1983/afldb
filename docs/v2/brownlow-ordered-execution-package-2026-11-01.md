# Brownlow ordered execution package: observe, backfill, adoption, eligibility, acceptance (2026-11-01)

**Status: PREPARED, NOT EXECUTED. Nothing was run against production or any shared database, including `observe`.** This package orders and pins the stages already approved at policy level (D-V2-BROWNLOW-ELIGIBILITY-1, OD-BROWNLOW-OWNERSHIP-1, D-V2-BROWNLOW-MATCH-BACKFILL-1 at reviewed HEAD `92aa541d91a9b2cfcb43ddda861f573801540ec8`; [decisions](brownlow-policy-decisions-2026-10-20.md)). Policy approval is not execution approval: every stage below needs its own fresh plan, its own written execution approval and its own baseline ([approval package](brownlow-production-approval-package-2026-10-20.md) contract, unchanged). Covers V2-GAP-016, 030 and 031. 2026 is excluded from every stage.

The facts here come from the fresh read-only production census ([record](brownlow-gaps-016-030-031-fresh-census-2026-11-01.md)) and from re-reads on the guarded disposable restore of the checksum-verified production backup (`afldb_prod-20261031-084435.dump`, sha256 `3f5b5339…4730`, restored as `afldb_v2_gap029_prod_test`). The disposable restore is a copy of PRODUCTION AS OF 2026-10-31, not production now; the tool's own `baseline` and `plan` are authoritative at execution time.

## 1. Reconciliation of the archive figures with today's 320,861

| Quantity | Archive rehearsal (all seasons, 2026-10-20) | Of which 2026 (excluded) | 1984-2025 scope | Fresh production census (2026-11-01) | Restore of 2026-10-31 backup (re-read) |
|---|---|---|---|---|---|
| `brownlow_round_votes` rows, `match_id` NULL | 330,383 repairable | 9,522 | **320,861** (330,383 - 9,522) | 330,383 total; **320,861** in scope; 0 excluded | 330,383 total; 320,861 in 1984-2025 |
| of which positive-vote rows | 22,860 | 621 | **22,239** (22,860 - 621) | 22,239 | 22,239 (2026: 621, read directly) |
| of which zero-vote rows | 307,523 | 8,901 | **298,622** (307,523 - 8,901) | 298,622 | 298,622 (2026: 8,901, read directly) |
| `match_id` already set in scope | 0 (every archived row NULL) | 0 | 0 | 0 on all 320,861 | 0 |
| Backfill classification | 330,383 repairable (rehearsal ran all seasons) | not part of production scope: the runner refuses 2026 | 320,861 repairable; 0 no_candidate, 0 ambiguous, 0 mirror disagreement, 0 clash | equal | n/a |
| 2025 specifically | 9,522 rows: 621 positive, 8,901 zero, 207 sets (3-2-1), source-less legacy | n/a | included in the 320,861 | equal | 9,522 rows, 621/8,901, `source_id` NULL on all |
| 2026 rows | afltables-owned | **9,522 preserved, fingerprint-protected** | excluded | 9,522, afltables-owned | 9,522 (621 positive, 8,901 zero, 1 source); informational hash `91160419b77e52d618d52fd044b6a49660b2172b1e0984af045818da987f1337` |

The arithmetic closes exactly in every column (330,383 = 320,861 + 9,522; 22,860 = 22,239 + 621; 307,523 = 298,622 + 8,901). The archive figure 330,383 is an all-seasons number that already contained 2026; the 320,861 is not a different dataset, it is the same archive less 2026. 2025 and 2026 coincide at 9,522 rows and 621/8,901 because 207 sets x 46 players = 9,522 and 207 x 3 votes = 621; a direct comparison found only 48 of 621 positive rows sharing round, player and votes between the two seasons, so the 2026 rows are not a copy of 2025. Observed once, not investigated further, and outside every stage here. The archived 320,861 stays an expectation: the tool re-derives the count and refuses on any difference.

## 2. Gates common to every stage

1. A reviewed clean checkout at one stated full revision (the runner reads `HEAD`, refuses tracked or staged changes; unrelated untracked `.codex/` is neither read nor changed). The approval is pinned to that execution revision. **This repository's HEAD at preparation is not it**; the owner names the revision.
2. `target.json` from independent facts: host, port, database `afldb_prod`, operator `user`, `systemIdentifier` (7674454702926115004 was recorded by the earlier census), `databaseOid` (66668), `clusterName` (`16/main`), `databaseComment` as read. These must be re-read by the operator in the owner block (section 3), not copied from this document.
3. A verified backup and restore evidence no older than 24 hours at plan and apply, `restoredAt` after `capturedAt`, `baselineDigest` equal to the fresh target baseline. The 2026-10-31 backup is **too old** for execution.
4. Migrations 116 and 117 present (the owner block reads `afldb_meta.schema_migrations`, which `afldb_import` cannot read) and the receipt ledger readable.
5. Settle gate quiet; the legacy writers are retired and no AFL API writer or timer is enabled. No stage activates any timer, deployment, writer or provider.
6. DSN only as the environment secret `AFLDB_BROWNLOW_CORRECTION_DSN`; nothing printed, committed or put in a request. Outputs, target, backup, restore evidence, plan and approval files outside the checkout, created exclusively.
7. Each stage has its own plan, approval and fresh baseline. No multi-operation batch on a stale baseline. After a committed stage the next stage's baseline is taken again.

Plan / apply commands are those in the [approval package](brownlow-production-approval-package-2026-10-20.md) (`plan --target --request --backup --backup-file --restore-evidence --out`, then `apply --plan --approval --backup-file --restore-evidence --out`), run with `node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts`. `execution-approval.json`: `planDigest`, exact `target`, full `revision`, exact `operation`, exact `seasons`, `source`, `approvedAt`, `expiresAt` (not after the plan's), a written `reference` of at least 20 characters (and for eligibility the full `rulings` array).

## 3. One owner read-only block (ledger and receipts)

`afldb_import` cannot read `afldb_meta` or `public.brownlow_correction_receipts`, and `pg_control_system()` needs a role provisioned for it. Run once by the operator role the owner designates, **read only**, and paste the output. Do not substitute a more privileged role or grant `afldb_import` anything to make this work; if a statement is denied, report the denial as the result.

```sql
\set ON_ERROR_STOP on
BEGIN READ ONLY;
-- 1. migration ledger (expect 117 as latest; 116 and 117 present)
SELECT count(*) AS ledger_rows, max(name) AS latest FROM afldb_meta.schema_migrations;
SELECT name, checksum FROM afldb_meta.schema_migrations WHERE name LIKE '116%' OR name LIKE '117%' ORDER BY name;
-- 2. receipts (expect 0 rows before stage B1)
SELECT count(*) AS receipts, count(*) FILTER (WHERE operation = 'observe') AS observe,
       count(*) FILTER (WHERE operation = 'backfill') AS backfill, count(*) FILTER (WHERE operation = 'adopt') AS adopt,
       count(*) FILTER (WHERE operation = 'eligibility') AS eligibility
  FROM public.brownlow_correction_receipts;
SELECT plan_digest, operation, code_revision, approval_reference, applied_at FROM public.brownlow_correction_receipts ORDER BY applied_at;
-- 3. target identity for target.json
SELECT current_user AS operator_role, inet_server_port() AS port, current_database() AS database,
       (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
       (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
       current_setting('cluster_name') AS cluster_name,
       shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS database_comment;
-- 4. the eligibility actor: active Super Admin ids only (no e-mail, no secrets)
SELECT id, role::text, (disabled_at IS NOT NULL) AS disabled FROM public.auth_users WHERE role::text = 'super_admin' ORDER BY id;
-- 5. state the stages assume (expect 0 / 0 / 0)
SELECT (SELECT count(*) FROM public.brownlow_eligibility_decisions) AS eligibility_decisions,
       (SELECT count(*) FROM public.data_issues WHERE issue_type = 'afl_api_brownlow_settle' AND entity_type = 'brownlow_round_votes' AND resolved_at IS NULL) AS unresolved_brownlow_settle_issues,
       (SELECT count(*) FROM staging.afl_api_brownlow_vote) AS staged_brownlow_votes;
ROLLBACK;
```

On the 2026-10-31 restore the same reads return: latest ledger name `117_brownlow_provider_eligibility_unknown.sql`, active Super Admin id **1** (one row, not disabled), 0 eligibility decisions. The restore is not production; production's values are what the owner block must report. `actorId` in the eligibility request (section 7) is **1 only if production returns the same**.

## 4. Stage A: baselines (read-only)

`baseline` on production, then on the restored copy of the fresh backup, each with its own proved `target.json`; compare `baselineDigest` (equal required); keep both reports in the restore evidence. Writes nothing. Needs the owner's authority to connect to the named target. Expected fresh values are those of section 1 and the census.

## 5. Stage B1: observe (2025)

| Item | Value |
|---|---|
| Request | `{"operation":"observe","seasons":[2025]}`, source `afl_api`, `--snapshot-label afl-api-brownlow-2025-2026-10-20-014218` on both `plan` and `apply` |
| Prerequisite | the pinned snapshot (2 raw files + manifest, manifest sha256 `43dec3ee84e2bd622a9d33899eb16896487d5344f5225eaa819b5a1262bb47f3`) held at `D:\tmp\afldb-gap006-brownlow-artifacts-20261101\acq-x\` is placed under the reviewed checkout's acquisition directory (the loader resolves it from the process working directory, i.e. the checkout root) before planning; re-hash all three files first. No provider is contacted |
| Entry guards | the runner requires 207 sets, 188 leaderboard entries, literal boolean provider eligibility and a 2025 manifest, and refuses an unknown flag |
| Expected write | spine, typed staging (207 sets, 621 positive vote rows, 188 leaderboard players), import batch, receipt. **No canonical vote write** |
| Acceptance (read-only) | `SELECT count(*) FROM staging.afl_api_brownlow_vote WHERE season = 2025` = 621 (and 207 distinct match sets in the receipt `result`); `brownlow_round_votes` total 330,383 and the scope and 2026 fingerprints unchanged from stage A; one `observe` receipt |
| Reversal | none: observations are retained history; supersede, never erase |

## 6. Stage B2: backfill (1984-2025), then B3: adopt (2025)

Order is **backfill, then adoption** (the census order). This is a chosen order, not a tool constraint: the adoption planner accepts a row whose `match_id` is NULL or equals the staged match and never moves `match_id`, so adoption would also plan before backfill. Backfill first means the `resolve` agreement check (which requires `match_id` equal to the staged match) holds without a second pass.

**B2 backfill.** Request: `{"operation":"backfill","seasons":[1984,1985,...,2025]}` naming **every** season 1984 through 2025 explicitly (42 seasons), source `legacy`. Expected: `match_id` set on exactly **320,861** rows; zero exclusions. Acceptance (read-only): `SELECT count(*) FILTER (WHERE match_id IS NOT NULL) FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025` = 320,861; 2026 rows still 9,522 with `match_id` NULL; total 330,383; positive 22,239 and zero 298,622 in scope unchanged; only the rehearsal's `mapped_rows` fingerprint moves (0 to 320,861); indexes valid, FKs validated; 2026 hash unchanged. Reversal: `reverse-backfill` from the original export and receipt, only while the post-state is unchanged. **Stop and return to the owner if the fresh plan count is not 320,861 or any exclusion class is non-zero.**

**B3 adopt.** Request: `{"operation":"adopt","seasons":[2025]}`, source `afl_api`. Planner must report 207 adoptable, 0 refused. Expected: 621 provenance changes, 621 `canonical_applications` audit rows, batch, receipt; the 8,901 zero rows keep their original (source-less) provenance. Acceptance (read-only): 621 rows in 2025 with `source_id` of `afl_api`, 8,901 with `source_id` NULL; the 621 values equal the staged values; votes and every other column unchanged. Reversal: `reverse-adopt` before any later write; an API write blocks reversal (`reversal_drift`).

## 7. The `resolve` checkpoint (skip rule)

`resolve` may be **skipped only if** the following count is zero **at the checkpoint after B3** (it is evaluated again, freshly, by the operator then; today it is 0 on the restore and, per the census, 0 on production):

```sql
SELECT count(*) FROM public.data_issues
 WHERE issue_type = 'afl_api_brownlow_settle' AND entity_type = 'brownlow_round_votes' AND resolved_at IS NULL;
```

Zero: record "resolve skipped, 0 unresolved" with the output in the stage record and go to E. **Non-zero: stop this stage for an owner decision**; do not proceed to E on that basis alone. The only `resolve` the tool allows names exact issue ids, requires the planner to show 207 already adopted, 0 refused, 0 adoptable and the 621-row agreement, and requires a factual resolution of at least 20 characters. The settle never closes its own issues. Nothing in B1-B3 runs the Brownlow settle, so none are expected.

## 8. Stage E: eligibility recording (separately pinned)

Pinned content: [`evidence/brownlow-eligibility-request-2026-11-01.json`](evidence/brownlow-eligibility-request-2026-11-01.json), sha256 `0f49b83ed8219f115ee10c64ae5110c54ab3fc3e2555da8622d84ff437d22b65`, generated mechanically from the approved ruling table (git blob `92aa541d…:docs/v2/brownlow-eligibility-ruling-2026-10-20.md`, sha256 `5ddde8547751353877f56816770097756f1a9faa1bb5aa89a803098c7b20ed56`, verified equal before use; the later commit `99a1165c` changed only the banner and the policy-implementation note, not the twelve rows). Each ruling's `citation` is the regulation reference plus the exact afl.com.au article URLs from the table; each `note` is the table's evidence and ruling text.

| # | Player | `playerId` | Durable identity | 2025 votes | Verdict | Citations (afl.com.au/news/...) |
|---|---|---|---|---|---|---|
| 1 | Toby Greene | 12446 | `afltables:players/T/Toby_Greene.html` | 14 | ineligible | 1373677, 1427225 |
| 2 | Tristan Xerri | 12869 | `afltables:players/T/Tristan_Xerri.html` | 7 | ineligible | 1365693, 1365899 |
| 3 | Zac Bailey | 13246 | `afltables:players/Z/Zac_Bailey.html` | 6 | ineligible | 1361425, 1365899 |
| 4 | Rory Laird | 11386 | `afltables:players/R/Rory_Laird.html` | 5 | ineligible | 1388030, 1388249, 1396186 |
| 5 | Sam Durham | 11625 | `afltables:players/S/Sam_Durham.html` | 4 | ineligible | 1339570, 1339726, 1354977 |
| 6 | Dan Houston | 3191 | `afltables:players/D/Dan_Houston.html` | 3 | ineligible | 1292232, 1305410 |
| 7 | Dylan Shiel | 4006 | `afltables:players/D/Dylan_Shiel.html` | 3 | ineligible | 1383983, 1388249, 1396186 |
| 8 | Patrick Voss | 10252 | `afltables:players/P/Patrick_Voss.html` | 3 | ineligible | 1300207, 1300516 |
| 9 | Liam Baker | 8798 | `afltables:players/L/Liam_Baker.html` | 2 | ineligible | 1401221, 1403587 |
| 10 | Ollie Wines | 10130 | `afltables:players/O/Ollie_Wines.html` | 2 | ineligible | 1393572, 1396382 |
| 11 | Shannon Neale | 11831 | `afltables:players/S/Shannon_Neale.html` | 2 | ineligible | 1396161, 1398164 |
| 12 | James Peatling | 6737 | `afltables:players/J/James_Peatling.html` | 1 | ineligible | 1297048, 1305410 |

Every ruling carries `expectedCurrentDecisionId: null` (production has 0 decisions; the owner block confirms). `actorId` in the pinned file is **1**, the single active Super Admin in the 2026-10-31 restore: it is a candidate, not a fact about production. If the owner block returns a different id, regenerate the file with that id (its hash changes; re-pin) before planning.

**Re-checks already made on the production-derived restore (read-only, today):** all twelve durable identities resolve uniquely through `external_identities` (kind `afltables_profile_url`, status unique) to exactly these player ids; all twelve are present in 2025 `brownlow_season_votes` with `is_ineligible = false` and eligible ranks 27, 51, 61, 74, 87, 96, 96, 96, 122, 122, 122, 152 (an unevaluated default per the ruling record, not a finding); 0 eligibility decisions. The guarded runner re-resolves identity and refuses ambiguity at plan time.

Gates specific to E: B1-B3 committed and the section 7 checkpoint recorded; active Super Admin (the runner checks `auth_users` role and `disabled_at`); sealed-season registry; the approval enumerates the **entire** `rulings` array, and any changed, omitted or extra ruling refuses. Expected write: 12 decision rows, audited metadata and career publication in the same transaction, receipt; raw votes unchanged. Acceptance (read-only): 12 rows in `brownlow_eligibility_decisions`; for the twelve, `is_ineligible = true` and `eligible_rank` NULL; the winner stays p9235 with 39 votes and eligible rank 1; one `eligibility` receipt. Reversal: new audited superseding decisions; history is never deleted. This stage records decisions only; it does not select a season eligibility rule (`BP-2025-ELIGIBILITY-v1` already governs; the earlier warning against a global `stored_eligible_rank_one` shortcut stands). **Not rehearsed through the runner on the production-derived restore** (the runner needs a production-identity `target.json`); the service itself was exercised on a disposable clone in the earlier sandbox (12/12 accepted).

## 9. Stage C: reconciliation acceptance

No database write. The owner records acceptance of the B1, B2, B3 and E evidence against the 98/98 local-season reconciliation: GAP-016 is narrowed to whatever the owner leaves open; GAP-030 (backfill) and GAP-031 (adoption) are closed only by their receipts and acceptance checks above. Nothing is claimed as done by this package.

## 10. Consolidated owner action list (Brownlow)

1. Name the window, the operator role, and the reviewed execution revision.
2. Run the section 3 read-only block with the designated operator role and return the output (migration ledger, receipts, target identity, actor id, assumed counts).
3. Take and restore-verify a fresh backup (24 hours); run stage A.
4. Place the pinned snapshot in the checkout; confirm the skip rule for `resolve` (section 7).
5. Give a separate written execution approval per stage (B1, B2, B3, E), each bound to its fresh plan digest, target, revision, season list, source, expiry and a reference of at least 20 characters; E additionally enumerates the twelve rulings and the `actorId`.
6. Decide whether E runs in the same window or later; the stages are independent after B3.

## 11. What was not done

No production connection and no command of this package was run. The runner was not executed against any target; the eligibility request was validated for shape and lengths only (notes up to 379 characters, citations up to 355; limits 2,000). The disposable restore reads above are of the 2026-10-31 backup. The stage record for each future step is written at execution time.
