# Block B outcome: Brownlow stages B0, B1, B2, B3 and E applied to production (2026-11-02)

**Status: ALL FIVE STAGES APPLIED AND ACCEPTED. No later step was taken.** Under the owner's conditional ordered approval (stages b0, b1, b2, b3, e; D-B-ROLE `afldb_owner` through the packaged `AFLDB_BROWNLOW_CORRECTION_DSN` channel for this sequence only) the five stages ran in order on `afldb_prod` at revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d`. Each stage was one transaction with one receipt, each `accept` passed, no gate failed, no apply returned non-zero, nothing was retried, skipped, reapplied or reversed. Production was not restored. No push, migration, restart, timer change, acquisition activation, cleanup, privilege change or quarantined-store access took place.

Package: [block-b-execution-package-2026-11-02.md](block-b-execution-package-2026-11-02.md). Preparation: [block-b-b0-preparation-2026-11-02.md](block-b-b0-preparation-2026-11-02.md) (section 8 is the approval text). Evidence: [`evidence/block-b-apply-20261102/`](evidence/block-b-apply-20261102/) (the five receipt files and the helper scripts used).

## 1. Approval window

| Item | Value |
|---|---|
| Approval received | before **2026-11-02T03:09:01Z** (the first command of the session ran at that instant; the exact message instant is earlier and is not recorded by the harness) |
| Absolute deadline used | **2026-11-02T07:00:00Z** (conservatively earlier than receipt plus four hours) |
| Strictest per-stage bound | four hours after each plan; every approval file expired well inside it: b0 04:00Z, b1 04:30Z, b2 to e 04:45Z |
| Sequence ran | 03:10:06Z (B0 revalidation) to 03:33:59Z (E accept): about 24 minutes |
| Target | `afldb_prod`, `afldb-prod` localhost:5432, system identifier `7674454702926115004`, OID `66668`, cluster `16/main`, ledger 118 with digest `573594e9…af57` (checked by every `pre`) |
| Revision | `ea98a35f…c783d` (production checkout `HEAD`, clean throughout; serving release unchanged) |

## 2. Stages

Each stage passed the packaged `pre` with exactly the preceding receipts, took a fresh backup after the preceding committed stage (B0 reused the prepared 29-minute-old backup, as no stage preceded it), was transferred privately (workstation `D:\tmp\blockb-private\<stage>`, streamanator mode 700/600, sha256 equal at every hop), restore-verified off-production into a disposable database, had the restore session time zone aligned to Australia/Melbourne **before** its runner baseline, produced equal live and restored baselines (`assemble` refuses otherwise), produced a plan whose content was compared with the approved table, and only then had its approval file created.

| Stage | Plan digest | Backup (production dir; dump sha256) | Live == restored baseline (before the stage) | Approval file sha256 | Applied | Receipt file sha256 |
|---|---|---|---|---|---|---|
| **b0** | `7c84362f84c09d49dabd4616f4e70eca91d15d65e17bfd5d24895cb93c2bf267` | `blockb-b0-20261102T024137Z`; `25d89ec745fb2aeed6b16d964da5e7ee3b0a9032eecda53dae609036a5e73536` | `d998c1200d7b5de7dc0d93f35005cd2eacad65b95924412a5bc39720ce9b3de5` | `e646ccdaa90cb47467d19a44dd1fb0f9035bc25679c10bc030a52ace93fd021b` | 03:10:34Z to 03:12:45Z | `7d0fcbd85f1213d2da8b5fadf53a35683ca283cc4613f1bdbf85a3bb4a67b7cc` |
| **b1** | `c3e2320a34cfa853a48602a39e2d302812786a14dda388d99bddd0fdc5fab2ba` | `blockb-b1-20261102T031356Z`; `b9284a0443ff001b27942242647fa00dbfac7776d2888de97d086a6f76d7c028` | `955073dde4b14b942a950ee316d8f05f0a92dee13c0633a736551c4d6f1a2486` | `4a1726796680a28b8fef32aaaf229269e45a68cdb7decd3065bc8797b9e6fea7` | 03:17:41Z to 03:18:52Z | `655e200a77b7f11a16bd1355f086762e8fb29742f8be58dc59c2d1445fadd8f5` |
| **b2** | `c55a894b242498f234f340c15c60f26b2baca64da4c005d3d426777a7535ead6` | `blockb-b2-20261102T031919Z`; `146f293271e6ad21bdb60b3fa06d7011550eea5bda7c1218445ca5511ec14ab7` | `e5f932afd8f62952a4009de4d8ab7c933d2c18b3d40f1f8b932c4f9250325c8c` | `03af422e758e1e9781fd035f187c482da24b1cc52e054594b5caaf5ebad90dcb` | 03:22:41Z to 03:24:32Z | `8cc0eae9ffec0756aa77967e906bba8ec4f01d8de15388d8ac55910491ef4635` |
| **b3** | `5251b00acdf4c3c1e1c220d6d1510b819d3f73b14f27a97d7861584416c37996` | `blockb-b3-20261102T032439Z`; `a0c6187f95b20cc16e16df7a5edba59bb5a07e2e5dc5658a7bda8f353ff1895b` | `29bb088e04f8a1cd2d727e59d0d7ca992aeb8121878996dcc106b8cda4cdaa2d` | `ea037d721371102909193ed72b7356467d3c37b886eb9da07fb8abc6e689aa63` | 03:27:55Z to 03:29:16Z | `f14882943647326dc9a56cc0c8d076b0078f19bf32c2218fd162f9a56b455ffd` |
| **e** | `2333b3081ad5230986285f53182bb7bf593898ad35d71a4a2f6456623f2ba2fe` | `blockb-e-20261102T032927Z`; `aaa859060462da410d417d64e6d6c983b55475c281e7e404fe4d396fe2fa4a2b` | `6190479daf4cef4eb7ac7ad6e04dc762c7cb422d06af843cedab5a55842727bd` | `8ace4b664a633e8e5be9931cbd80a1f896828c75a08eb7f6312577c57a2589bb` | 03:32:43Z to 03:33:59Z | `11dfd8e6bdedb11beca309d12c7dd371984010834ec7875eb53e73b6c0a8ec72` |

Each approval's `reference` carries the owner's authorising sequence and the stage's plan digest (20+ characters; `make-approval.mjs` accepted it). Receipt `before_digest` / `after_digest` chain exactly: `d998c120…` to `955073dd…` to `e5f932af…` to `29bb088e…` to `6190479d…` to `43300297…821d` (the final production baseline).

### Plan content compared with the approved table before each approval file existed

| Stage | Required | Found in the plan |
|---|---|---|
| b0 | observe, `fixture-identities-2025`, season 2025, manifest `46a793d8…9b36`, 212 records, 4 refused ids, records digest `d6bbe184…671f` | all equal (212; `CD_M20250142501` to `…04` refused; digest equal) |
| b1 | observe, season 2025, manifest `43dec3ee…47f3`, 207 sets, 621 positive vote rows, 188 leaderboard players | 207 match sets, 621 vote rows (all positive), 188 leaderboard players, `CONCLUDED`; the staged snapshot manifest hashed `43dec3ee…47f3` |
| b2 | backfill, 42 seasons 1984 to 2025, 2026 excluded, 320,861 rows (22,239 positive + 298,622 zero) | 42 seasons, minimum 1984, maximum 2025, 2026 absent; 320,861 repairs; `positiveRepairable` 22,239 |
| b3 | adopt 2025, 621 rows adopted, 8,901 zero rows keep source-less provenance | 207 sets, 621 rows (all positive, none with a previous source), 9,522 minus 621 = 8,901 remain |
| e | eligibility, 12 rulings, actor 1, 0 existing decisions, 0 unresolved settle issues | request sha256 equal to the pinned `563f336e…858b`, 12 rulings for 12 distinct players, all `ineligible`, all `expectedCurrentDecisionId` null, actor 1; `pre e` confirmed an active Super Admin, 0 decisions and the settle checkpoint |

### Acceptance after each stage (packaged `accept`)

| Stage | Receipts | total / 2026 / in-scope `match_id` / 2025 source-less / 2025 `afl_api` / staged 2025 / decisions |
|---|---|---|
| b0 | `observe=1` | 330383 / 9522 / 0 / 9522 / 0 / 0 / 0 |
| b1 | `observe=2` | 330383 / 9522 / 0 / 9522 / 0 / 621 / 0 |
| b2 | `backfill=1,observe=2` | 330383 / 9522 / 320861 / 9522 / 0 / 621 / 0 |
| b3 | `adopt=1,backfill=1,observe=2` | 330383 / 9522 / 320861 / 8901 / 621 / 621 / 0 |
| e | `adopt=1,backfill=1,eligibility=1,observe=2` | 330383 / 9522 / 320861 / 8901 / 621 / 621 / 12 |

Stage-level runner results: b0 batch 73, 212 observations seen and 212 versions appended; b1 batch 74, 207 payloads and versions, zero canonical rows; b2 `exported` 320,861, `applied` 320,861, `alreadyApplied` 0, mapped 0 to 320,861; b3 batch 75, 207 sets changed, 621 rows changed, 621 ledger rows, `outsideOwnership` fingerprint unchanged; e: 12 of 12 decisions `ok`, the last decision's publication state `published` with no unresolved players.

## 3. Time zones (recorded every stage)

| Session | TimeZone |
|---|---|
| Production, `afldb_backup` and `afldb_owner` sessions (no database-level override) | `Australia/Melbourne` |
| Restored disposable copy, as restored | `Etc/UTC` |
| Restored disposable copy, after `ALTER DATABASE <restore db> SET TimeZone = 'Australia/Melbourne'` and before its baseline | `Australia/Melbourne` |

Only the disposable restore database was changed; production's setting and the baseline hashing algorithm were not. The UTC-session baselines are retained beside the aligned ones on streamanator (`baseline-restored-utc-session.json`). This is the package-procedure defect found during preparation (see the preparation record, section 3); it was repeated for every stage and the live and restored baselines were equal at every `assemble`.

## 4. Preservation evidence (read-only, after stage E, as `afldb_backup`)

| Check | Result |
|---|---|
| 2026 `brownlow_round_votes` | 9,522 rows, digest **`9522:8096c0494f77a8f4cd1ed270654fae95`** (identical to the value recorded before B0); 0 rows with a `match_id` |
| Rows below 1984 with a `match_id` | 0 |
| In-scope `match_id` | 320,861 = 22,239 positive + 298,622 zero |
| 2025 ownership | 621 sourced, all positive; 8,901 source-less, all zero; 0 positive source-less |
| 2025 raw votes | 9,522 rows, 1,242 total votes, 621 positive (unchanged by E) |
| 2025 winner | player **9235**, **39 votes**, `eligible_rank` 1, the only `is_winner` row; runner-up 9910 with 32; the raw round-vote sum agrees (39, 32, 29) |
| The twelve | `brownlow_eligibility_decisions` ids 1 to 12, season 2025, verdict `ineligible`, basis `audited_correction`, decided by user 1, no supersession; 12 season rows flagged ineligible, all without an eligible rank, none a winner |
| Unresolved `afl_api_brownlow_settle` issues | 0 |
| Ledger | 118 rows, last `118_fixtures_unconfirmed_participants.sql` |
| Serving state | `afldb.service` MainPID 3268373, `NRestarts` 0, active (the same MainPID as before B0); production checkout `HEAD` = R, 0 porcelain lines |
| DEV | `afldb.service` MainPID 1162113 and `postgresql@16-main` MainPID 1504, unchanged around every restore verification |
| Isolated cluster | stopped after each restore verification; no listener on port 55496 |

## 5. Remaining limitations (not closed by this record)

* **Not pushed.** This record and its commit are local only; origin/main is unchanged by this work.
* **Final owner acceptance: RECORDED later on 2026-11-02** (verbatim in [brownlow-final-acceptance-gap016-closure-2026-11-02.md](brownlow-final-acceptance-gap016-closure-2026-11-02.md) section 1). GAP-030 and GAP-031 are closed on it. *(This bullet originally read: the owner had not yet written the acceptance, so both gaps stayed open.)*
* **Public rendering:** unverified when this record was written; checked read-only later the same day, see section 5 of the closure record. *(Originally: no page, ISR cache or admin view had been fetched.)*
* **The 98/98 local-season reconciliation was not re-run** in this session. A separate fresh post-E production-derived reconciliation (98 of 98 seasons determined and agreeing) was run later the same day: closure record section 4. It does not alter the retained local record.
* **Baselines moved.** Production's Brownlow baseline is now `43300297…821d`. Any pending baseline-bound work (C4b, C5) must re-baseline.
* **Procedure deviation (disclosed):** the time zone alignment above is outside the packaged S3 text; it follows the preparation record and the owner's instruction.
* **B0 reused** the plan and backup prepared before the approval (backup 29 minutes old and plan 20 minutes old at apply), revalidated by `pre`, the plan summary and apply's own gates.
* **Left in place (no cleanup authorised):** the five backups under `/home/arm/backups/afldb/blockb-*`, `/home/arm/ops/blockb-ea98a35f2061/` (all plans, approvals, receipts and evidence), `/home/arm/bb-*.sh` and `/home/arm/bb2-*` scripts on production; on streamanator the workspace `/mnt/ssd/afldb-v2-blockb-prod-20261102T024241Z` with disposable databases `afldb_v2_blockb_{b0,b1,b2,b3,e}_rst_test` (cluster stopped) and `/home/arm/bb2-rv.sh`; on the workstation `D:\tmp\blockb-private\{b0,b1,b2,b3,e}`. Frozen P/H/EXEC, `.codex/`, archived source work, releases, quarantined stores and parked ISSUE-327 were not touched.

## 6. Final owner-acceptance statement (for the owner to write; this session does not)

> I accept the Brownlow correction stages b0, b1, b2, b3 and e as applied to `afldb_prod` on 2026-11-02 at revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d`, evidenced by the five receipts (plan digests `7c84362f…f267`, `c3e2320a…ab2ba`, `c55a894b…ead6`, `5251b00a…7996`, `2333b308…a2fe`) and the acceptance reads recorded in docs/v2/block-b-outcome-2026-11-02.md, against the 98/98 local-season reconciliation. GAP-030 and GAP-031 may close on these receipts.

**Recorded:** the owner wrote the acceptance (with its own wording, covering the five receipts, the 212 observations, the 320,861 backfills, the 621 adoptions with 8,901 preserved, the twelve rulings and the 9,522 preserved 2026 rows) on 2026-11-02. See the closure record. The wording above was a proposal, not what was recorded.
