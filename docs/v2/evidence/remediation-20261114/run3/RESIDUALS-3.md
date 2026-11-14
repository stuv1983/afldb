# Remediation run 3 — residual register (supersedes `../run2/RESIDUALS.md` where it differs)

Every residual known at the end of run 3. **"Accepted" appears nowhere here**: a grade is not the owner's acceptance, and
each row waits for the owner (`APPROVAL-PACKET-3.md` §C). Run-2 residuals not listed in §3 are **unchanged** and stay in
`../run2/RESIDUALS.md` (§2.1 lint ratchet, §2.2–2.3 Caddy, §2.4 failure notification, §2.5 `--attended`, §2.6 host patching,
§2.7 backups, §2.8 sensitive logs, §2.10 admin, §2.11 public).

Status words as in run 2: **fixed locally** (committed on `claude/remediation-20261114`, unpublished); **qualified** (passed at
Q′ = `692b1902`, `QUALIFICATION-3.md`); **awaiting publication / owner decision**.

## 1. Fixed in run 3 (no residual beyond publication)

| Item | Commit | State |
|---|---|---|
| T363-1 `settle-afl-api-state-b` order dependence and deletion of the snapshot's `CD_I297354` identity row | `18cbde7b` | fixed locally, qualified |
| `settle-afl-api` deletion of the same snapshot row (PLAN-REVIEW-3 F-002) | `69168858` | fixed locally, qualified |
| Run-1 "unclassified" `database` "separates the war years" failure: `settle-afl-api-brownlow` rewrote season 2026's `stat_availability` | `6edf4f99` | explained and fixed locally, qualified |
| `settle-afl-api-issue276` fixtures collided with the real 2026 preliminary final | `532e234d` | fixed locally, qualified |
| 4 `database` witnesses measured on the retired baseline | `bb81cbc9` | re-pinned with evidence (`run3/integb/README.md` §5), qualified |
| Phase-B runner: the bridged rebuild copy had no planner statistics | `0c66f3e3` | fixed (evidence tooling only) |
| ISSUE-363 decision (3) "re-check after a rebuild" | — | **carried out on an isolated accepted-baseline rebuild** (`run3/rebuild`), not on the shared `afldb_test`; decision (3) itself is not adopted on the owner's behalf |

## 2. New residuals

### 2.1 ISSUE-365: Brownlow coverage recompute of a completed season (MED, new issue)
- **Consequence:** one `recomputeBrownlowCoverage` of a completed season with no loaded medal (2026 today) marks it `not_applicable` ("no medal") and `lockMatch` then refuses Brownlow admin for it. Callers: the AFL API Brownlow settle (`afl-api-brownlow.ts:1722`) and Brownlow admin (`admin-brownlow.ts:1192`, `:1392`).
- **Protection now:** none in code; the test-side contamination is fixed (`6edf4f99`).
- **Not verified:** production's current 2026 coverage rows (no production contact in run 3).
- **Operator action:** before any release, read production's 2026 `stat_availability` Brownlow rows read-only.
- **Alternatives / recommendation:** D-365-1 (packet §C): (a) keep `pending` unless a declared no-medal season, with a regression (recommended); (b) keep the rule; (c) limitation.

### 2.2 Stale test witnesses not corrected (ISSUE-363, MED, owner)
- **What:** 27 ids (club-comparison 24; release-gates "exact 261 players", "records why each attendance is missing", "attaches every ladder row") plus the related rebuild-only witnesses below. Every difference is the completed 2026 season in the accepted baseline (`run3/integb/README.md` §6; deltas in `run3/integb/evidence/soft/cc2.list.txt`, `rg1.list.txt`).
- **Why not corrected:** the run's correction rule required each corrected file to pass on the rebuild; neither file can, for reasons that are not witness values (surrogate ids, "latest meeting 2025" statements, the 2026 gates).
- **Consequence:** these ids fail on both the snapshot and the accepted rebuild; they are classified, not passed.
- **Recommendation:** bound the club-comparison witnesses to seasons ≤ 2025 and replace surrogate-id lookups with a stable key; re-pin the release-gates counts and fingerprints.

### 2.3 Season-state and contract pins (ISSUE-363, owner)
- **"2026 is provisional" gates (3, release-gates):** on the accepted baseline 2026 is complete and 2027 is the only season in progress. Recommendation: re-point to the current in-progress season.
- **Coleman contract `expected_rows` 46 (awards-reload-links):** the rebuild holds 47 (1980–2026). Frozen pin, not edited. Recommendation: re-pin and derive the legacy-transition expectation.
- **Birth-date pins (3 release-gates ids, rebuild only):** rebuild 13,347 dates against the pinned 13,255 (snapshot passes). Recommendation: pins follow the accepted rebuild.
- **Surrogate player ids (2 club-comparison ids, rebuild only):** Lyons 6818/6850, Cook 6711/6743 differ between snapshot and rebuild. Recommendation: stable keys.
- **Gridley:** run-2 limitation N7 unchanged (40 failing cells on both bases); two assertions fail only on the rebuild (criteria gaps, 65 deferral cells). Owner to classify.
- **Wildcard finals in career `finals` (INFO):** `is_final` true, `is_finals_series` false for the 2026 wildcard round; a modelling question, no work created.

### 2.4 ISSUE-363 shared-mode effects (unchanged, LOW)
- T363-2 (`admin-fixtures` commits deletion of all `fixtures` rows) and T363-3 (`after-siren` contamination) are unchanged in shared mode; per-file mode (`MODE=all`) removes both. ISSUE-363's resolution criterion ("runs without cross-file fixture leaks") is therefore met only in per-file mode, so 363 stays **open, partially resolved**.
- The three `settle-afl-api-brownlow*` suites still resolve the real `CD_I297354` through the snapshot (LOW, F-STATEB-001); they pass in every order tested. Recommendation: the same rename helper, test-only.
- A full test-and-file shuffle of the settle family fails the same 10 within-file-ordered tests at base and at Q′ (INFO).

### 2.5 Evidence verifier false positive (LOW)
- `run2/evidence/verify-manifests.sh` matches manifest entries by basename within the first path component (`run3`), so `template-identity.txt` in `run3/integ/evidence/brownlow/retained-artefacts.SHA256SUMS` is compared with the unrelated `run3/integb/evidence/c1/template-identity.txt`: **1 COMMITTED-MISMATCH**. The real file is committed as `run3/integ/evidence/brownlow/template-identity.restored.txt` and hashes to the expected `4ec64b7b…ea60` (re-checked by the orchestrator with `git cat-file`). No evidence byte is wrong.
- **Recommendation:** scope the verifier's basename match to the scope directory in a later records change (it is a script; changing it after Q′ moves Q′).

### 2.6 Rebuild inputs are load-bearing in one retained workspace (LOW)
- The accepted fitzRoy core `c2-2026-final-core-v1`, the ladder witness `c2-2026-final-ladder-v1` and the coaches raw bundle were found only in `/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z/package` (DEV lacks them). Losing that workspace would block the standard rebuild.
- **Owner choice:** retain that workspace (recommended) or copy the three hash-verified inputs to a retained location of your choice: `<retention location>`.
- `docs/v2/isolated-rebuild.md` §3/§5 still name the retired baseline, 89 checks and the v2 bridge parent (now `c2-2026-final-core-v1`, 91, v3) — INFO, not edited.

## 3. Run-2 residuals changed by run 3

| Run-2 row | Change |
|---|---|
| §2.9 test harness: "`settle-afl-api-state-b` hidden order dependence (F-1)" | fixed (§1) |
| §2.9 "decision (3) still needs a rebuilt `afldb_test`" | done on an isolated rebuild; outcome in §2.2–2.3 |
| §2.10 "`data-editor` 5 snapshot-authority failures" | pass on the accepted rebuild (class 1); still fail on the snapshot by precondition |
| §2.10 "`admin-brownlow` P2 snapshot oracle 9522" | passes on the accepted rebuild (class 1) |
| §2.12 "No rebuilt `afldb_test`" | an isolated rebuild exists (`run3/rebuild`); the shared `afldb_test` is still not rebuilt |
| §2.12 "Unclassified failure: war years" | explained and fixed (§1) |
| §2.12 "dedicated-clone Brownlow suites not run" | run from their documented recipe and retained artefacts: 3/3 and 8/8 (`run3/integ`, `run3/integb`) |

## 4. Host footprint left in place (owner housekeeping)

Workspaces under `/mnt/ssd/afldb-rem3-*` (stateb 1.4 G + 1.2 G cluster; rebuild 1.7 G + 1.5 G; integ 1.4 G + 2.3 G; integb 1.5 G + 8.7 G;
qual 3.6 G + 1.9 G) and `/mnt/ssd/afldb-rem3-base` (bundle, heavy lock, the rebuilt dump and bridge child). Every cluster is stopped; no
listener on 55671–55677. Recommendation: keep `afldb-rem3-base/rebuilt/` (the accepted-baseline dump, 20.7 MB) until the owner decides §2.2–2.3; the rest
may be removed after publication.
