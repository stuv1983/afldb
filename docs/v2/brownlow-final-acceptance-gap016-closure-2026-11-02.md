# Brownlow final owner acceptance; V2-GAP-030, V2-GAP-031 and V2-GAP-016 (2026-11-02)

**Outcome:** the owner's final Brownlow acceptance is recorded. **V2-GAP-030 and V2-GAP-031 are CLOSED** on their written criteria and the production receipts. **V2-GAP-016 is CLOSED on its written remaining criteria** (sections 3, 4 and 6), with one owner-requested check, public rendering, **not performed** (section 5). The register is recounted from its rows in [known-gaps.md](known-gaps.md).

Authority for what was done: the owner's message of 2026-11-02 (section 1). It authorised targeted read-only checks of production's Brownlow state, read-only public inspection, and, if GAP-016's criteria required a fresh production-derived reconciliation, **one** post-Block-B backup with restricted private transfers and a restore verification on a guarded disposable environment. It did **not** authorise any Brownlow mutation, publication, replay, reversal, production restore, push, grant, restart, acquisition activation or cleanup, and none happened (section 8).

## 1. The owner's acceptance (verbatim)

> I accept Brownlow stages b0, b1, b2, b3 and e as applied to afldb_prod on 2 November 2026 at revision:
>
> ea98a35f20610e75c18e698bc0d9fe084c3c783d
>
> This acceptance covers the five receipts, complete plan digests, acceptance reads and preservation evidence recorded in docs/v2/block-b-outcome-2026-11-02.md.
>
> I accept:
> - the 212 fixture-identity observations and subsequent 2025 Brownlow staging;
> - the 320,861 historical match-id backfills;
> - adoption of the 621 positive 2025 rows, preserving the 8,901 source-less zero rows;
> - the twelve approved eligibility rulings and their atomic career publication;
> - preservation of all 9,522 rows of 2026 with the recorded unchanged digest.
>
> Record the final Brownlow owner acceptance and close GAP-030 and GAP-031 on their written criteria and production receipts. Update the relevant records and recount gaps from the rows.
>
> The retained 98/98 local-season reconciliation remains historical evidence. I am not asserting that it was re-run today, and this acceptance does not waive an explicit remaining production-comparison requirement for GAP-016.

The same message directs: finish GAP-016 verification and close it only when its actual remaining criteria are supported, otherwise name the exact unmet condition.

## 2. V2-GAP-030 and V2-GAP-031: written criteria against the receipts

| Gap | Written close condition (register row and entry) | Evidence | Met |
|---|---|---|---|
| **030** | "fresh counts/unique mapping plan, owner review of the guarded production runner and exact execution approval", then the backfill itself; 1984 to 2025 approved by D-V2-BROWNLOW-MATCH-BACKFILL-1, 2026 excluded | stage **b2**: plan `c55a894b…ead6`, 42 seasons (1984 to 2025), 320,861 repairs (22,239 positive + 298,622 zero), 0 excluded, one receipt (file sha256 `8cc0eae9ffec0756aa77967e906bba8ec4f01d8de15388d8ac55910491ef4635`); `accept` after b2 and after every later stage; 2026 digest `9522:8096c0494f77a8f4cd1ed270654fae95` unchanged; owner acceptance (section 1) | yes |
| **031** | "separately approved schema, fresh target/backup/baseline and exact execution approval" for the narrowest 2025-only adoption; OD-BROWNLOW-OWNERSHIP-1; the 207 settle issues were never auto-resolved | schema 116 and 117 were installed 2026-10-31 (ledger now 118); stage **b3**: plan `5251b00a…7996`, 207 sets, 621 rows adopted to `afl_api`, 8,901 zero rows keep source-less provenance, 621 audit rows, one receipt (file sha256 `f14882943647326dc9a56cc0c8d076b0078f19bf32c2218fd162f9a56b455ffd`); 0 unresolved `afl_api_brownlow_settle` issues, so `resolve` had nothing to close; owner acceptance | yes |

Both are corroborated by today's independent re-observation (section 4): live production still shows 320,861 in-scope `match_id` values, 621 sourced and 8,901 source-less 2025 rows with no positive source-less row, 0 unresolved settle issues, and five receipts.

## 3. V2-GAP-016: its actual remaining criteria, traced

The gap's text and register row had gone stale. What it said, and where it stands:

| Statement in the record | Source | Status now |
|---|---|---|
| "Still open for production: separate schema approvals for 116 and 117 with fresh backup/restore, deployment authority, exact per-operation execution approvals and reconciliation acceptance" | known-gaps GAP-016 entry (2026-10-20) | **Stale.** Migrations 116 and 117 were installed 2026-10-31 (A-REL); the ledger is 118; release `ea98a35f` serves; every per-operation execution approval was given and used (stages b0, b1, b2, b3 and e). Only *reconciliation acceptance* and the production comparison remained |
| "production recording and rollout pending", "the twelve production decisions" | known-gaps row; go-no-go.md | **Stale.** Stage e recorded the twelve `ineligible` decisions with their atomic career publication (decisions 1 to 12, user 1, basis `audited_correction`, no supersession); the 12 season rows are `is_ineligible` with no eligible rank and none a winner |
| "Remaining: **owner release acceptance and production-dump comparison**, NOT implementation/count" | known-gaps GAP-016 entry (Local follow-up, 2026-10-19); ADR 0014 "V2-GAP-016 disposition" | **The live criterion.** Owner acceptance of the Brownlow production state is section 1. The production-dump comparison had **not** been done after Block B: the retained 98/98 record came from a local database (`afldb_v2_rb_release_test`). It is done in section 4 |
| "remaining: confirm the projection path and run the blast-radius count" | go-no-go.md §"V2-GAP-016" | **Stale.** The projection path is the audited decision transaction (implemented, ADR 0014 amendment); the blast radius is the twelve players, measured and recorded in the Block B receipts |
| "no eligibility rule is recorded for API-era seasons" (V2 admin operations page; plan text) | admin-operations.md, plan.md | **Historical.** BP-2025-ELIGIBILITY-v1 and ADR 0014 record the rule and the tri-state representation |
| "Related: V2-GAP-010 (API coverage of 2012-2025 has no committed evidence)" | known-gaps GAP-016 entry | A *related* constraint, not a close condition of GAP-016; V2-GAP-010 was closed on 2026-10-31 as an accepted constraint (D-V2-GAP010, Option A). It is carried as a stated limit in section 7 |

So the exact remaining criteria were: **(a)** the owner's acceptance of the production recording (given, section 1) and **(b)** a production-dump comparison on the state *after* Block B. Section 4 supplies (b).

## 4. The fresh post-E production-derived reconciliation

### 4.1 Backup and transfer (owner-authorised, one backup)

| Item | Value |
|---|---|
| Capture | `capture-recon.sh` ([evidence/gap016-recon-20261102/](evidence/gap016-recon-20261102/capture-recon.sh)): the reviewed Block B capture with **constants only** changed (stage `recon`, decision label `GAP016-POSTE-RECON-BACKUP-20261102`, output directory, sidecar wording); the diff against `capture-b.sh` is 8 changed lines, all of that kind |
| Stamp, directory | `20261102T035406Z`; `/home/arm/backups/afldb/gap016-recon-20261102T035406Z` (new, mode 700) |
| Reference recorded in the sidecar | "Owner message 2026-11-02 accepting Block B stages b0 b1 b2 b3 e and authorising one post-Block-B backup for the GAP-016 production comparison" |
| Dump | `afldb_prod-20261102T035406Z.dump`, 30,089,386 bytes, sha256 `01cb5cbcd4422c8945b97e9b16815db884de1d208df8a5ca594c7706a1f72282`, 1,651 TOC entries, one `pg_dump` MVCC snapshot as `afldb_backup`, 03:54:06.67Z to 03:54:15.50Z, stderr empty |
| Identity and state at capture | `afldb_prod`, OID 66668, system identifier 7674454702926115004, cluster 16/main, ledger 118 rows / last `118_fixtures_unconfirmed_participants.sql` / digest `573594e9…af57` (read before and after, unchanged); all writer units inactive before and after; 0 AccessExclusive locks, 0 other active sessions; staged Brownlow `2025:621` |
| Not reused | no pre-E backup was used; the dump was taken **after** stage e committed (E accept 03:33:59Z) |
| Transfers | production to the workstation `D:\tmp\gap016-private\recon` (private) and on to streamanator `…/in/prod-recon/` (mode 700 directory, 600 files); the dump sha256 equalled the sidecar at both hops |

### 4.2 Restore verification (guarded disposable environment)

Restored with the reviewed `restore-verify-b.sh` into `afldb_v2_blockb_recon_rst_test` on the isolated cluster `afldb_v2_isolated` (127.0.0.1:55496), never the DEV database; ledger 118 with digest `573594e9…af57`; 17,056 matches and 218 fixtures; restored at 03:55:07Z. As at every Block B stage, the disposable copy's session time zone was aligned to `Australia/Melbourne` (production's) before its baseline; the UTC-session baseline `2ea7301e…2921` is retained beside it. The cluster was stopped afterwards (no listener on 55496); DEV `afldb.service` MainPID 1162113 and `postgresql@16-main` MainPID 1504 were unchanged throughout.

**The restored copy's Brownlow baseline is `433002971a4f9db9bfce8b6ab6858254b7f759af7151e00068153889d4ed821d`, exactly the `after_digest` of the E receipt, i.e. production's final baseline as the runner recorded it at 03:33:59Z.** So the fresh dump is the post-E state, and nothing in the runner's baseline moved between the receipt and the dump.

### 4.3 Live production against the restored copy (identical read-only queries on both)

| Table or scope | Rows | md5 of per-row md5 | Live == restored |
|---|---|---|---|
| `brownlow_season_votes` (season, player, votes, vote_rank, eligible_rank, is_ineligible, is_winner) | 16,120 | `38cbfe6e5528bad361dbc72e6eced506` | yes |
| `brownlow_round_votes` 1984 to 2025 (all columns) | 320,861 | `928122aa1afee25f52cd309349a943ba` | yes |
| `brownlow_round_votes` 2026 (all columns) | 9,522 | `8096c0494f77a8f4cd1ed270654fae95` | yes, and equal to the digest recorded before B0 |
| `brownlow_eligibility_decisions` | 12 | `0cbab275c9f74f652e8dc5c69a7a6510` | yes |
| winners (`season:player_id`) | 112 | `8f0190de565dc4db4f9ca95776894030` | yes |
| `brownlow_correction_receipts` (operation, plan, before, after) | 5 | `71ca1240c966ef2567e0d36858a0c165` | yes |

### 4.4 The focused reconciliation on the restored copy

`tools/v2/brownlow-history.ts` (read-only, marked isolated runner, refuses a non-isolated DSN), run at the pinned candidate `ea98a35f`, output [`brownlow-history-postE.json`](evidence/gap016-recon-20261102/brownlow-history-postE.json) (sha256 `ea90997a804254fbf9131e68c29ae69d2f8c9e9d280c22c888c9008a0d0b3257`); SQL facts in [`recon-facts.txt`](evidence/gap016-recon-20261102/recon-facts.txt).

| Result | Value |
|---|---|
| **Seasons covered** | **98**: every season 1924 to 2025 that has a Brownlow count (no medal 1942 to 1945). The count is read from the data, not assumed; it happens to equal the retained local record |
| Determined / agree / disagree / unresolved | **98 / 98 / 0 / 0**; refusals 0; `review` and `blocking` lists empty for every season |
| Basis | **97 seasons `stored_totals`** (stored-only; not API parity) and **1 season, 2025, `api_round_votes`** (the staged API match votes recorded by stage b1 now exist, so the 2025 determination is API-derived, not the stored-only fallback the local record used) |
| 2025 | 188 vote-getters, 1,242 raw votes, 0 missing eligibility, stored winner = determined winner = player **9235**, 39 votes (eligible rank 1); the twelve provider-ineligible players keep their raw votes and are excluded from the eligible ranking; runner-up 9910 with 32 |
| Joint-winner seasons (determined, not forced) | 1930 (3), 1940, 1949, 1952, 1959, 1965, 1981, 1986, 1987, 1996, 2003 (3), 2012 |
| Against the retained local record (`local-brownlow-history-final.json`) | identical season set; for 97 seasons every field equal (status, winners, vote-getters, raw totals, review, blocking, input checksum); **2025 differs only in basis and input checksum**, as expected |
| Raw round votes against stored season totals, 1984 to 2025 | 24,675 (season, player) pairs; 8,570 present in both with **0 value differences**; **0** positive round votes without a season row; **0** season rows without round votes; the other 16,105 pairs are zero-vote round rows, which the season table does not list |
| Flags | `is_ineligible` set in 1996 (1), 1997 (1), 2012 (1) and 2025 (12); all 15 have no eligible rank and none is a winner |

### 4.5 Live production, read-only, 2026-11-02T03:51Z (as `afldb_backup`, read-only session)

Identity `afldb_prod`, OID 66668, ledger 118; receipts `observe=2, backfill=1, adopt=1, eligibility=1`, the last `after_digest` `43300297…821d`; 98 seasons 1924 to 2025 in `brownlow_season_votes`, 16,120 rows; 2025 winner 9235 (39 votes, eligible rank 1); twelve decisions 1 to 12, all `ineligible`; 2025 ownership 621 sourced / 8,901 source-less (0 positive source-less); 2026 digest unchanged; 0 unresolved settle issues. The serving state was `afldb.service` MainPID 3268373, `NRestarts` 0, the production checkout at `ea98a35f`, clean.

## 5. Public rendering

**Not inspected. No public page was read.** The application is served only on `beta.afldb.com`, behind the closed-beta access-code gate (the apex `afldb.com` is a static coming-soon page and returns 404 for `/awards`, `/brownlow` and the player routes). Anonymous requests to `beta.afldb.com` return a 307 to `/beta`. The owner's instruction was to use headed Playwright and have the owner enter the credential. A headed Chromium window (this repository's own Playwright install) was opened on `https://beta.afldb.com/brownlow` twice, for 10 minutes and then 30 minutes (03:58:50Z to 04:08:50Z and 04:09:15Z to 04:39:15Z); the access code was not entered, the gate was not passed, and the script closed itself both times. No credential was requested in chat, read, guessed or bypassed, and no page beyond the gate response was fetched.

What was prepared and is ready to run: the read-only script (it only loads pages and saves text and screenshots) covers `/brownlow`, `/brownlow/2025`, `/brownlow/2024`, `/brownlow/2012`, `/brownlow/2003`, `/brownlow/1996`, `/awards` and the player pages for the 2025 winner (Matt Rowell, 9235), the runner-up (Nick Daicos, 9910) and three of the twelve (Toby Greene 12446, Shannon Neale 11831, Ollie Wines 10130). The values to compare against are the production figures in section 4.5: 2025 winner 39 votes, runner-up 32, the twelve flagged without an eligible rank, joint-winner seasons listed in 4.4.

**Consequence.** Whether the public pages already show the E publication, or wait for ISR revalidation, remains **unchecked**; this is carried as an open follow-up, not a gap. It is not one of GAP-016's written remaining criteria, and the publication path itself was demonstrated earlier on a local build (ADR 0014 amendment; 324/324 focused checks). A page that still shows pre-E values would be a revalidation question (see the `season-page-isr-stale` notes: `/seasons/[year]` is ISR with a one-hour window, `/brownlow` is `force-dynamic`), not a data defect: the database is verified in section 4.

## 6. Closure decisions

| Gap | Decision | Basis |
|---|---|---|
| **V2-GAP-030** | **CLOSED** | section 2: stage b2 receipt, 320,861 rows, 2026 excluded and unchanged; owner acceptance; re-observed (4.3, 4.5) |
| **V2-GAP-031** | **CLOSED** | section 2: stage b3 receipt, 621 adopted / 8,901 preserved, 0 unresolved settle issues; owner acceptance; re-observed |
| **V2-GAP-016** | **CLOSED** | its two live criteria (section 3): (a) owner acceptance of the production recording, section 1; (b) a production-dump comparison on the post-Block-B state, section 4: 98 of 98 seasons determined and agreeing on a fresh restore of production, that restore's runner baseline equal to the E receipt's, six Brownlow table digests equal between live production and the restore, raw round votes equal to stored season totals for every overlapping player-season. Raw-vote, eligibility and ownership distinctions are kept: raw votes unchanged for all twelve, eligibility carried by decisions and flags only, ownership by `source_id` only. Disagreements 0, refusals 0, limits in section 7 |

**Register recount (from the table rows, 2026-11-02):** 38 total / 36 closed / 2 open (open: **011** and **029**). Before this record: 38 / 33 / 5 (011, 016, 029, 030, 031). Closing 016, 030 and 031 moves three rows.

**What closure does not do.** It does not change the production cutover go/no-go (V2-GAP-011 and the ISSUE-316 sequence C3, C4b and C5 are open and separate), it does not approve any further Brownlow operation, and it does not assert the public pages render the new values (section 5).

## 7. Stated limits (not closed by this record)

* **Stored-only seasons.** 97 of 98 seasons reconcile against stored totals only; they have no API parity (V2-GAP-010, closed as an accepted constraint, not as new evidence). Only 2025 is API-derived.
* **Point in time.** The comparison covers production as of 03:54Z on 2026-11-02. A later write is not covered; the receipt chain and baseline digest make a later change detectable, they do not prevent one.
* **What the comparison is.** Equality of production with its own restored dump on the Brownlow tables, plus the internal-consistency reconciliation on that copy. It is not an independent check of historical medal facts against an external source.
* **The retained 98/98 local record** is unchanged historical evidence; today's run is a second, separate record, not a re-run of it.
* **Baselines moved.** Production's Brownlow baseline is `43300297…821d`; any later baseline-bound work must re-baseline.
* **Not pushed.** Local commits only; see the handoff for the list.

## 8. What was and was not done

Done (all within the owner's message): read-only SSH sessions to `afldb-prod` as `arm` (the read-only role `afldb_backup`, `default_transaction_read_only=on`); one capture that wrote one new mode-700 directory on production; private transfers; one restore and the read-only reconciliation on streamanator's guarded cluster (stopped again afterwards); read-only public inspection (section 5).

**Not done:** no Brownlow mutation, publication, replay, reversal or repeat of stages b0 to e; no production restore; no push; no grant, role or privilege change; no restart, timer or service change; no acquisition activation or setting write; no `.env` edit; no migration; no use of the `afldb_owner` channel on production; no cleanup. Frozen P/H/EXEC, `.codex/`, archived source work, the quarantined stores, the retained releases and the parked ISSUE-327 were not touched. No WSL distribution or quarantined store was used (ISSUE-331's boundary).

**Procedure disclosures.** (1) The capture and the restore wrapper were streamed from Windows PowerShell, which prepended a BOM to the first line and appended a stray carriage return after the closing brace: the shell reported `command not found` for those two fragments, which sit outside the script's block; the capture block ran in full and passed. For the reconciliation script the BOM made its first line (`set -uo pipefail`) fail, so that run executed without those options; every command in it returned 0 and its outputs are as listed. (2) The first production digest run used no DSN selector and failed with a password error before reading anything; it was rerun with `--prod`. (3) Left in place, as no cleanup was authorised: production `/home/arm/backups/afldb/gap016-recon-20261102T035406Z`; workstation `D:\tmp\gap016-private\recon`; streamanator `…/in/prod-recon/`, `…/evidence-private/recon/` and the disposable database `afldb_v2_blockb_recon_rst_test` (cluster stopped); session scratch files.
