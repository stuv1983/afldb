# Block L outcome (GAP-029 match-event labels), 2026-11-02

**Status: APPLIED TO PRODUCTION AND VERIFIED.** 64 labels were written by the reviewed, detached apply, then checked independently of the wrapper's own output, then the same plan and approval were replayed (writes nothing). This is the outcome of the plan in the [execution-ready record](gap-029-block-l-execution-ready-2026-11-02.md); that record's "NOTHING WAS WRITTEN" status is historical and is superseded here.

**V2-GAP-029 as a whole stays OPEN.** Only the match-event label part (Block L) is done. The Gridley strict findings, the dated-membership and draft/trade dataset gaps and the unapproved 50 are unchanged and were not re-run against production by this block ([known gaps](known-gaps.md), [gap resolution](gap-029-gridley-resolution.md)).

Evidence: [`evidence/gap029-block-l-20261102/applied/`](evidence/gap029-block-l-20261102/applied/) (apply log, tool result, replay result, the approval file, the read-only verification script and its raw output; hashes in section 6).

## 1. Authority and binding

| Item | Value |
|---|---|
| Approval | the owner's message of 2026-11-02 ("BLOCK L APPROVAL"): exactly the 64 labels of the execution-ready record, revision `86da1a82329371fd23db6e2935a0e9334ba08f9a`, plan digest `1b538e1a50cacdb24d37d771d79261a5926e35c69f53d03481ec47a26e79528a`, plan file sha256 `ef2e25888f850b37b5a1c43595791eb517d15ccb73bd43fe7bd19047de4ccc24`, target `afldb_prod` on `afldb-prod` (`localhost:5432`, system identifier `7674454702926115004`, database OID `66668`), actor 1, distribution Anzac Day 31 / Dreamtime at the 'G 22 / King's Birthday 11. Expiry **2026-11-02T20:25:00Z** (stricter than the plan's own limit and the 20:30Z recommendation). The owner confirmed exclusivity for the window and accepted the per-label commits; no retry, reversal or restore was approved |
| Approval file | written on the host outside the checkout, mode 600: `/home/arm/ops/gap029-labels-86da1a82/evidence/approval-1.json` (sha256 `7160351b4a7dacb3cbd80e5095f1858770d98fbb4026d83ea2fc9a88665be14a`), the plan's `planDigest`, `target`, `revision`, `operation`, `evidenceSha256`; `approvedAt` 2026-11-02T00:45:00.000Z (set from the owner's message time, which precedes this session's first clock read at 00:45:36Z; the host clock read 00:46:29Z at preflight), `expiresAt` 2026-11-02T20:25:00.000Z, `reference` = the owner's approval in words (a copy is in the evidence directory) |
| Checkout and inputs | private pinned checkout `/home/arm/ops/gap029-labels-86da1a82/cand`: `HEAD` = R, `git status --porcelain` empty (re-checked by the script); plan file sha256 equal to the approved one; backup `afldb_prod-20261101T204724Z.dump` sha256 `9119895b…395d` equal to the plan's; backup freshness left **1,200 minutes** at the start |
| Script | `scripts/prod-apply.sh` copied to `/home/arm/ops/gap029-labels-86da1a82/in/prod-apply.sh` (it was not on the host); sha256 `3be00c634fce1b93197148d9c063c9e9f8b422bf0712e249a74f19a35a51bb06`, equal to the committed file (unmodified, LF only). Launched with `setsid nohup`, detached, log `evidence/apply-1.log` |

## 2. What ran (UTC; 2026-11-02 11:47 AEDT)

| Step | Result |
|---|---|
| Preflight (read-only, by this session) | host `afldb-prod`, user `arm`; checkout at R, clean; plan and backup hashes equal; every settle, AFL API, Brownlow and e-mail unit inactive; `afldb.service` active MainPID **3218527** (unchanged from the record); no conflicting process; no earlier approval or result file |
| A0 approval, plan, checkout (00:47:01) | "approval matches plan 1b538e1a50ca; backup freshness left 1200 min" |
| A1 exclusivity gate | "no conflicting process; app: active MainPID=3218527" |
| **A2 tool apply (00:47:01 to 00:47:04)** | "Labels committed (64 written)", `apply exit=0`; result file: `written` 64, `allLabelled` true, `auditRowsAdded` 64, `overridesAdded` 64 |
| A3 read-only verification as `afldb_backup` | labelled: Anzac Day **31**, Dreamtime at the 'G **22**, King's Birthday **11**; `data_edits` `match_event` rows **64**; active `data_overrides` `match_event` rows **64** |
| **A4 replay of the same plan and approval (00:47:05)** | "Every label is already applied; nothing written"; replay result `replay` true, `written` 0 |
| End | `head=86da1a82…` and `status_lines=0` in the checkout; script `DONE` |

## 3. Independent verification (actual rows, not wrapper status)

A separate read-only script (`afldb_backup`, session `default_transaction_read_only=on`, `verify-readonly.sh`) read the rows, and a local comparison checked them entry by entry against the **plan** (64 `matchId` to label) and the **evidence file** (64 natural keys):

| Check | Result |
|---|---|
| Identity | `afldb_backup`, `afldb_prod`, system identifier 7674454702926115004, OID 66668 |
| `matches` | 17,056 rows (unchanged), latest `2026-09-26`; exactly **64** with a non-NULL `match_event`, the 64 planned ids and no other, each with the planned label |
| `data_edits` | exactly 64 rows with `table_name` `matches` and `field_group` `match_event`, ids **96 to 159** (previous maximum 95; total now 159), one per planned match, `admin_user_id` **1**, `old_values` `{"match_event": null}`, `new_values` one key with the planned label, the evidence-file note |
| `data_overrides` | exactly 64 active rows for `matches` / `match_event`, ids **94 to 157** (total now 157), `entity_key` equal to the evidence file's natural key (`season|round|date|home|away`) for all 64, `override_values` a single key with the planned label, `admin_user_id` 1, `is_active` true |
| Nothing else | the five most recent non-label `data_edits` rows are the earlier 91 to 95 (`players` `source_identity`, `matches` `match_sheet`, `audit_note_repair`); ledger still 117, last `117_brownlow_provider_eligibility_unknown.sql` |
| Service | no restart, build, migration or deployment by this block; MainPID 3218527 at the exclusivity gate |

Totals before the block, derived from the new ids: 95 `data_edits` and 93 `data_overrides` rows, 0 labels.

## 4. Not done and still to be observed

- **Public pages.** Pages that read `match_event` (search, grid) are ISR-cached; allow about an hour or revalidate before judging them. No page was fetched or revalidated here, so the effect on `/search` and the Grid Solver is **unverified**.
- **The plan is consumed.** The baseline moved, so plan `1b538e1a…` and its approval are spent; a repeat would be refused (replay shows "already applied"). The approval has expiry 2026-11-02T20:25:00Z and must not be reused for anything else.
- **No reversal tool.** Reversal of any label is `saveEdit` of `match_event` back to NULL per match through the audited path, under its own review. The backup `9119895b…395d` is a last-resort full-database fallback that would also discard every write since 2026-11-02 07:47 AEDT. None was needed.

## 5. Leftovers (retained; nothing deleted)

On `afldb-prod`: `/home/arm/ops/gap029-labels-86da1a82/` (now also holding `evidence/approval-1.json`, `result-1.json`, `replay-1.json`, `apply-1.log` and `in/prod-apply.sh`), the backup directory, and three helper scripts written by this session to `/tmp` (`gap029-preflight.sh`, `gap029-launch.sh`, `gap029-verify.sh`; no secrets, they read credentials from `.env` at run time and print none). Others as in the [execution-ready record, section 11](gap-029-block-l-execution-ready-2026-11-02.md). Removal is the owner's word.

## 6. Evidence hashes (SHA-256)

| File | sha256 |
|---|---|
| `applied/apply-1.log` | `8c396dccd4802d5f0d01b42d3123ada93284db8a9da2c98e8ca811553492cb47` |
| `applied/result-1.json` | `0548846fe109879e1dccdcdb353ec90ba1e0bf4b5c87f0bf910ba1954b2f2252` |
| `applied/replay-1.json` | `4290109556d6e0834aa00853d597a387069a1462a278d43f9d4e87a7c7655071` |
| `applied/approval-1.json` | `7160351b4a7dacb3cbd80e5095f1858770d98fbb4026d83ea2fc9a88665be14a` |
| `applied/verify-readonly.sh` | `5d6c7f8304c14e9c9631de72772c106e45c53f74966294a2f08ad2c18ace6bc7` |
| `applied/verify-readonly-output.txt` | `8f3ed22b9612fd7cbd12ce2d99763132cc0397c2d82f95a67a194410836ea484` |

## 7. Effect on the other blocks

Blocks M, B and C do not read or pin `match_event`, `data_edits` or `data_overrides` counts (checked by search of their scripts); Block M's `matches` row-count guard (17,056) is unchanged. Each block still takes its own fresh backup, so the post-label state is captured by them. The Block M, B and C rehearsals and qualification are reused unchanged.
