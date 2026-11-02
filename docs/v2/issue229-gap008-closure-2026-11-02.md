# ISSUE-229 and V2-GAP-008: closure reconciliation (2026-11-02)

**Outcome: both are CLOSED on their own written criteria.** This is a records change. No test, capture, build, host or database access was made to reach it; it re-reads the written criteria against evidence that already exists in the repository and in the M-a and M-b outcome records. It does **not** touch ISSUE-316 or V2-GAP-011, which stay open and separate, and it does not turn Brownlow execution or continuous timer activation into closure conditions of ISSUE-229 or GAP-008, because no authoritative requirement says so (section 3).

## 1. The written criteria, quoted

| Source | Text |
|---|---|
| `docs/v2/known-gaps.md` V2-GAP-008, **Close** | "Capture B2 under AFLDB-ISSUE-229, decide the open items there, build and test the writer against an isolated `afldb_test`. Until then the production go/no-go for an AFL API-only fixture pipeline is **no-go**." |
| `known-gaps.md` register row for V2-GAP-008 | next step: "capture B2, review its dry run, approve the first apply" |
| `issues/open/AFLDB-ISSUE-229.md` section 7, "Next, in order" | "1. Capture B2. 2. Run `--validate-only`, then `--dry-run`. 3. Review the TBC representation. 4. The owner approves the first `--apply`." |
| `issues.md` ISSUE-229 (2026-10-19 clarification, owner policy 2026-10-20) | "B2 is the first-season operational acceptance gate ... the first genuine 2027 whole-season/TBC/status/key/mapping check and owner-approved first apply" |
| `issues.md` ISSUE-229 **Out of scope** | "Season discovery (ISSUE-233), identity rekey and the match-family absence sweep (ISSUE-231), **timer wiring (ISSUE-232)**, and any other AFL API clean-up." |
| `docs/v2/owner-decisions-remaining-2026-10-31.md` | the V2-GAP-008 / ISSUE-229 row asks only for "An authentic 2027-season B2 capture" |

## 2. Each criterion against its evidence

| Criterion | Evidence | Met |
|---|---|---|
| **Capture B2** (the authentic 2027 whole-season pre-match feed) | compSeason `CD_S2027014` (id 102) exists; one fixtures-only capture, snapshot `afl-api-2027-2026-11-01-012026`, 218 matches (SCHEDULED 135, `PLACEHOLDER` 83), feed sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`; record `issue229-b2-2027-feed-check-2026-11-01.md` | yes |
| **`--validate-only`, then `--dry-run`**; review of the dry run | validate-only PASS (218 scheduled, 0 refused) once the owner decisions were applied; the first isolated dry-run refused all 218 and exposed exactly the open items (no `afl_api_2027` round vocabulary, `PLACEHOLDER` unsupported, venue `CD_V313` unmapped), which were then decided; dry-run and apply on a disposable production-derived clone created 218 with replay no-change; on production the window's check-only run was CLEAR and its dry-run reported `created=218`, exit 0 (M-b outcome section 2) | yes |
| **Decide the open items** | D-229-1 to D-229-8a (2026-10-02); the 2027 owner decisions: register 2027, declare `afl_api_2027` rounds (Wildcard Finals a distinct stage), map `CD_V313` to Eureka Stadium (5/5 one-to-one date-and-club matches in the 2023-2025 feeds), treat `PLACEHOLDER` as an unconfirmed scheduled fixture (migration 118); the unobserved statuses `LIVE`, `POSTPONED`, `CANCELLED` stay unsupported and fail closed by D-229-3 (an accepted constraint, not an open item) | yes |
| **Review the TBC representation** | unconfirmed rows store no date or time; ladder and bracket labels never become clubs; "To Be Confirmed" never becomes a venue; admin list shows confirmed, unconfirmed and label fixtures (36/36 desktop and mobile checks, commit `e5c730f7`). **Production, read-only, owner signed in:** 218 rows, 135 confirmed and 83 unconfirmed, 11 label-participant rows, 10 venue TBC, 83 date TBC, 0 unconfirmed rows with a date, 0 played; desktop and mobile layouts inspected (M-b outcome section 4) | yes |
| **Build and test the writer against an isolated `afldb_test`** | writer built (Launch F, `d760280e`) and extended; contract 80/80, writer integration 29/29, 51 offline files 4,608 passed, typecheck clean; the bounded window rehearsed 46/46 on Linux and Windows with the real settle CLI; independent review findings H1, M1, M2, L2, L3 and L1 fixed (as recorded in the ISSUE-229 ledger entry) | yes |
| **Owner approves the first `--apply`**, and it is applied | M-b approval (decision reference `D-MB-20261102 approved first production 2027 fixture ingestion`); run `fxw-2026-11-02T022520565Z-3270427`: apply `created=218`, exit 0, one completed batch 218 read / 218 inserted / 0 updated / 0 rejected, `matches` unchanged at 17,056; the acquisition switch was on for about 3.5 s and restored to an explicit boolean `false`, verified; independent `readback-b` PASS `218\|135\|83\|11\|10\|83\|0\|1\|0`; a fresh restore-verified backup (`blockm-b-20261102T022308Z`) preceded it | yes |
| Production go/no-go for the fixture pipeline (GAP-008's "until then ... no-go") | the pipeline has now run once on production, under approval, with a verified result. GAP-008's own blocker is therefore lifted. The overall production **cutover** go/no-go (`go-no-go.md`) is a separate decision that still lists V2-GAP-011 and the ISSUE-316 sequence; it is **not** changed here | yes (for GAP-008) |

## 3. What is deliberately not a closure condition

* **Brownlow execution (Block B)** and the Brownlow chain: separate issues (GAP-016, GAP-030, GAP-031); no ISSUE-229 or GAP-008 text requires them.
* **Continuous timer activation / recurring ingestion** (C3 inert install, C4 registration, C4b, C5): this is ISSUE-316 and V2-GAP-011 scope. ISSUE-229's ledger entry lists timer wiring as **out of scope** (ISSUE-232). The earlier index wording "remaining tracked scope (C3/C4b/C5 activation and the Brownlow chain) is unapproved" described ISSUE-316's sequence, not a written ISSUE-229 criterion, and is superseded by this reconciliation.
* **Reduced rollback fidelity after the apply:** a consequence of the approved change, disclosed in the M-b package (section 10) before the approval and recorded in the M-b outcome section 5; not a defect to close.

## 4. Residuals recorded separately (none gates closure)

* Further fixture refreshes of 2027 (the feed will change as AFL confirms fixtures) need the same bounded window under a new approval, or recurring acquisition under ISSUE-316 C4b/C5. The writer is idempotent; confirmed rows never regress.
* The 2026 diagnostic "218 played match(es) in this season have no fixture" on `/admin/fixtures` is unchanged by M-b (2026 had no fixtures before the window). It is not in ISSUE-229's scope (new-season pre-match ingestion); no issue is opened because it has no new reproducible defect beyond the existing diagnostic.
* `go-no-go.md` lines naming V2-GAP-008 as a cutover blocker are historical (dated 2026-10) and were **not** edited; read them with this record. `playbooks/issue.md`, `blockers.md`, the `.phaneslight` returns, a code comment in `packages/acquisition/src/fixture-contract.ts` and some evidence JSON name the runbook path `issues/open/AFLDB-ISSUE-229.md`; the runbook moved to `issues/closed/` and those historical references were left as written (blockers.md and the trackers were updated).
