# Remediation 2026-11-14 — approval packet 4 (supersedes `../run3/APPROVAL-PACKET-3.md`, packet 2 and packet 1)

**Nothing in this packet has been executed.** No push, merge, release, install, restart, reboot, configuration change or log deletion; no
production contact of any kind (B0 included). Each approval below is separate: approving one approves nothing else. Silence is not approval.
No owner decision and no residual has been accepted on the owner's behalf.

## How to identify the candidate (one command)

A commit cannot contain its own hash. The candidate **C** is the commit this packet is in; three local refs point at it and nothing is committed
after it:

| Ref (local, never pushed) | Meaning |
|---|---|
| annotated tag **`remediation-final-20261115`** | its annotation states C's full SHA, Q‴'s full SHA, the push command with C's full SHA, and Approval A's text |
| branch `claude/remediation-final-20261115` | at C |
| branch `claude/remediation-20261114` | its tip is C |

**Print C's SHA (any shell):** `git rev-list -n 1 remediation-final-20261115` — Approval A and the push command below name exactly that commit.
Read the annotation with `git cat-file -p remediation-final-20261115`. The independent post-commit verification (fresh clone of the tag, checker,
ref equality, origin unchanged, refspec rehearsal) is written **outside** the candidate by `afldb-closure` phase B and quoted in the run's final
report; the manifest figures committed here are for the pre-final tip (`QUALIFICATION-4.md`, `CLOSURE-4.md`).

## Pins (re-read immediately before each step; any difference is a stop)

| Pin | Value | Source |
|---|---|---|
| `origin/main` | `de640826d13489c58392563e7ae1ff62403ed293` (unchanged; `git ls-remote` 2026-11-15) | read-only |
| **Candidate C** | `git rev-list -n 1 remediation-final-20261115` (see above) | local tag |
| **Executable revision Q‴** | **`16027092e075d9064df8a3749c4b17805c2eaaeb`**: the last commit that changes anything outside the record paths (RUN-PLAN-4 §3a F-008 allowlist); every commit after it up to C is records-only | `QUALIFICATION-4.md` |
| Fully qualified integrated revision Q″ | `1f7b0d717b37e98432716d6b9170fbd45142ab63`; Q″..Q‴ changed one doc stage-map line, one test assertion and three checker-map rows, requalified in `fixloop/` | `QUALIFICATION-4.md` |
| Run 3's candidate / Q′ (superseded) | `5cef810b` / `692b1902` | packet 3 |
| Production release, host, Caddyfile, database | **carried from run 2, not re-read** (no production access in runs 3–4): `current` `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, `previous` `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`; Caddyfile sha256 `4f6972ec…d7af036`; `afldb_prod` OID 66668, sysid 7674454702926115004, ledger 118, `AFLDB_BETA_EPOCH` 1, 2027 `NOT_OPEN` | `../run2/PINS-2.txt` |
| Schema change in the candidate | **none** (no file under `src/db/migrations/` changed since `de640826`) | `git diff` |
| DEV | `8b024098`, untouched (`DEV-STATE-BEFORE-4.txt` / `DEV-STATE-AFTER-4.txt`) | read-only |

## A. Publication (Git only; recommended: approve)

**What:** fast-forward `origin/main` from `de640826` to C:
- **169 commits** (`git rev-list --count de640826..remediation-final-20261115`; C is the single commit after the pre-final records commit): the full review `5035ed96`, runs 1–4.
- **4,281 files** changed in total at the pre-final tip; excluding `docs/v2/evidence/` and `issues/`: **215 files, +17,715 / −1,171** (C changes only files under `docs/v2/evidence/`; `CLOSURE-4.md` re-derives both figures).
- **Executable delta since run 3's Q′ `692b1902`** (outside the record paths): `src/db/queries/player-derived.ts` (D-365-1), `tools/db/afl-api-identity-correction-rehearsal.ts`
  (its settled-coverage pins), `docs/{architecture,data-dictionary}.md`, `docs/v2/{architecture,isolated-rebuild}.md`, 32 files under `tests/`
  (28 integration suites, 3 integration helpers incl. `leaked-fixtures.ts`, 1 unit suite), and the run-4 evidence checker and map. **No migration, deploy file, package file, `src/app` route or reference dataset changed in run 4.**
- **Proof that Q‴ is the executable revision:** `git diff --name-only 16027092 remediation-final-20261115` lists only `issues.md`, `IssuesIndex.md`,
  `blockers.md`, `CHANGELOG.md` and files under `docs/v2/evidence/remediation-20261114/` outside `run4/evidence/` (re-derived by `afldb-closure`, `CLOSURE-4.md`).
- **Lint stays a ratchet:** 338 errors in 43 files; never raised; not clean lint.

**Qualification** (`QUALIFICATION-4.md`): at Q″ typecheck rc 0; lint 338/43; unit 12,296 passed / 1 failed (a stale stage-map line, fixed at Q‴);
shell 24/24 and 42/42; build rc 0; the isolated standard rebuild re-run at Q″ (91 checks PASS, equivalent to run 3's); integration in four cells (§D);
dedicated clones 3/3, 8/8, 74/74, 28/28; ISSUE-238 rehearsal tool 83/84 (c47 class 6). At Q‴: typecheck rc 0, lint 338/43, `tests/v2-acquisition-pipeline.test.ts` 24/24, full unit 12,297 passed / 0 failed (one earlier full run had a 1 ms-window timing flake in `tests/rate-limit.test.ts`, 10/10 alone), `club-comparison` 70/70 on both bases in both modes, the loaded-2026 mutation 70/70 on both bases. Manifest verification with the
fixed checker (`REQUIRE_NO_UNRESOLVED=1`): rc 0 on a fresh clone of the fix-loop record (`ba77ae3b`): 70 manifests, 5,718 entries, COMMITTED-MISMATCH 0, AMBIGUOUS 0, HOST-MISMATCH 0, HOST-MISSING 0, UNRESOLVED 0 (COMMITTED-OK 3,752, ALIAS 15, HOST-OK 1,855, DECLARED-NOT-RETAINED 96); re-run by closure on the pre-final tip and on the tag.

**Before:** `git fetch origin` and confirm `origin/main` is still `de640826` (if it moved: stop; a rebase needs a new qualification). Run
`git rev-list -n 1 remediation-final-20261115` and compare it with the SHA in your approval. Expect a later merge in `D:\dev\afldb` (branch
`claude/issue-339-deploy-preflight`, unrelated uncommitted edits; packet 2 §A lists the overlap).
**Command (owner):** `git push origin "remediation-final-20261115^{commit}:refs/heads/main"` (fast-forward; refuse `--force`). The tag itself is
not pushed and is not part of this approval. The tag annotation carries the same command with C's full SHA.
**Recovery:** a revert commit; never rewrite `main`.
**Breaking changes to note (unchanged from packet 2):** `release.mjs promote`/`rollback` require `--attended`; per-file test mode refuses
parameterised or tunnelled DSNs (opt-in); the Caddy changes, once installed (B7), 404 a trailing slash on protected ISR routes, cap match ids at
99,999 and require slugs `[a-z0-9-]`. **New behaviour in run 4:** Brownlow coverage recomputes keep a completed season without loaded results at
`pending` (ISSUE-365).

> **Approval A:** "I approve publishing the commit `git rev-list -n 1 remediation-final-20261115` prints, ________ (full SHA), to `origin/main` by fast-forward from `de640826d13489c58392563e7ae1ff62403ed293`. Executable revision `16027092e075d9064df8a3749c4b17805c2eaaeb`. Lint is a 338-error ratchet, not clean." — owner, date ________.

## B. Production operations (each separately approved; all need A; B2–B8 need B1)

Procedures: `../run2/ops/procedures/01..06`, `../run2/caddy357/README.md` §10–§11. Every production pin was carried from run 2 and **must be
re-read** first. **Blanks marked `________` must be filled by the owner; nothing below is valid with a blank.** B2–B8 are unchanged from packet 3.

### B0. Read-only production probe (recommended: approve; before B1)
- **What:** re-read the run-2 pins (release ids, serving checkout, kernel, Caddyfile hash, database identity, ledger) and, for ISSUE-365, read only:
  the three 2026 Brownlow `stat_availability` rows, `SELECT brownlow_status, count(*) FROM player_season_stats WHERE season = 2026 GROUP BY 1`, and
  `seasons.status` for 2026 (`brownlow/README.md` §6.3 step 1), with the read-only probe pattern of `../AGENT-PROTOCOL.md` §6. No write.
> **Approval B0:** "I approve one read-only production probe of the pins and the ISSUE-365 2026 Brownlow rows on ________ (date/time AEDT), run by ________." — owner, date ________.

### B1. Release the published revision to production (recommended: approve, attended)
- **Change:** code only, no migration. Users see the run-1/2 fixes; the D-365-1 rule affects only future Brownlow recomputes (no public text changed).
- **Prerequisite:** B0 done; `node deploy/release.mjs host-gate`. **Commands:** `promote --attended`, then the owner's restart in the same sitting.
  **Validation:** `release.mjs status --expect <new id>`, `deploy/post-install-check.sh <new id>`, a public smoke. **Recovery:** `release.mjs rollback --attended` to the B0-read `current`.
> **Approval B1:** "I approve releasing ________ (C's full SHA, published) to production with `promote --attended` and my attended restart in the window ________ (date, 05:00–07:15 AEDT), rollback target `________` (as re-read in B0)." — owner, date ________.

### B1a. ISSUE-365 conditional repair (new; only if B0 shows a stale `not_applicable`; after B1 and a verified backup)
- **Why it may be needed:** the 4 Nov snapshot (production-derived) holds the three 2026 coverage rows at `pending` but **all 669** 2026
  `player_season_stats.brownlow_status` rows at `not_applicable`. The deployed rule stops new damage; it repairs nothing.
- **Procedure (`brownlow/README.md` §6.3):** in ONE transaction through the shipped code: (a) only if a 2026 coverage row reads `not_applicable`,
  `recomputeBrownlowCoverage(tx, 2026)`; (b) if any 2026 `player_season_stats` row reads `not_applicable` or (a) ran, `recomputeSeasonBrownlowStatus(tx, 2026)`;
  commit only if the acceptance holds inside the transaction, else roll back. **Acceptance:** 2026 `brownlow_season_total` and `brownlow_match_votes`
  `pending` (`brownlow_round_votes` `pending` or `partial` only when 2026 round vote rows exist); `DISTINCT brownlow_status` for 2026 = `pending` only;
  no Brownlow `not_applicable` row for seasons ≥ 1924 outside 1942–1945; still 12 such rows for 1942–1945. Dry-run (rolled back) on both test bases:
  `brownlow/raw/repair2026.txt`. **Recovery:** the backup taken immediately before.
> **Approval B1a:** "Given B0 showed ________ (what was stale), I approve the ISSUE-365 conditional repair of season 2026 per `run4/brownlow/README.md` §6.3 on ________ (date/time), after backup ________." — owner, date ________.

### B2–B8 (unchanged from packet 3; text and approval lines there apply verbatim with C in place of `5cef810b`)
B2 open 2027 (D-350-1, **by 2027-03-10**); B3 failure visibility (D-332-1 option A); B4 host patching policy; B5 the pending reboot; B6 scheduled
backups and off-host copy; B7 the combined Caddy install (sha256 `f00859d5…6d`, unchanged); B8 pre-fix logs. See `../run3/APPROVAL-PACKET-3.md` §B2–§B8.

## C. Decisions that need the owner

### C1. New in run 4

| Decision | Recommended | Consequence of the recommendation | Consequence of the alternative |
|---|---|---|---|
| **D-365-W** public wording of a `pending` Brownlow season (`src/lib/format.ts` `brownlowStatusNote`, `/players/[slug]`, `tests/e2e/journeys.spec.ts:134`) | change it to "Brownlow Medal results for this season have not been loaded yet." in a new run | the note stops claiming the season is in progress for a completed season | keep: a completed 2026 season reads "still in progress; the Brownlow Medal has not been awarded" |
| **ISSUE-365 B0/B1a** probe and conditional repair | approve B0; B1a only if B0 shows stale rows | production rows match the rule | the 2026 player-season rows may keep reading `not_applicable` |
| **G-1** Gridley on the accepted rebuild (3 ids, class 5): the standard rebuild reproduces 0 `data_overrides` (snapshot 165) and 64 GAP-029 labels | decide whether the standard rebuild must replay administrator overrides; until then classify the 3 ids as rebuild limitations | either a rebuild-stage change in a later run, or a documented limitation | the 3 ids stay class 5 on every rebuild |
| **T-1** retire the snapshot literal set in `nl-answers-after-siren` once the 4 Nov snapshot stops being a qualification base | retire later | one set of literals | two state-selected sets stay |
| **T-2** awards-reload-links' real reload adds one 2026 `award_winners` row on the snapshot in shared mode (the rebuild already holds it) | accept as convergence to the extract, or capture/restore real award rows in a later run | — | — |
| **RB-1 CLAUDE.md line (proposal only; this packet does not edit `CLAUDE.md`)** | add under §11: "`/mnt/ssd/afldb-i316-rb-I-20261023T0905Z` (a symlink) and `/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z` are one retained directory holding the standard rebuild's accepted inputs: never write, move, delete or clean either name." | agents see the rule at session start | the rule lives only in `docs/v2/isolated-rebuild.md` §6 and `blockers.md` |

**Item 4 interpretation (recorded for review):** the "four time-sensitive assertions" are the four `database` count witnesses re-pinned in run 3
(`bb81cbc9`); the release-gates "2026 is provisional" gates are 363-G. Both are fixed.

### C2. Carried unchanged from packet 3 (still open)

D-350-1 open 2027 (by 2027-03-10, B2); D-332-1 amendment (option A, B3) and G0b/G0c; ISSUE-357 O-1 residual; ISSUE-364 O-2 (accept the merge-time
ratchet); O-A05-1 (353); O-B06-1/2 (361); the prior `auth_sessions` row (362); "round most goals" (356); D-HO-1..7 (B4–B6). The run-3 decisions
D-365-1, 363-W, 363-G, 363-C, 363-B, 363-3 and RB-1 were approved for local implementation on 2026-11-15 and are implemented here.

## D. Remaining failures and gaps (bounded)

- **Integration at Q″** (`FAILURE-LEDGER-4.md`): snapshot 18 failing ids per mode (per-file and shared identical), rebuild 7 per mode (identical).
  Every id is class 1 (passes under its intended conditions: dedicated clones, OD-5 on rebuild-named clones, snapshot-only preconditions that pass on
  the accepted rebuild, the three 363-B birth-date pins) or class 5 (Gridley: snapshot 1, rebuild 3). No defect, stale assertion or refusal is unclassified.
- **ISSUE-363** stays open only for G-1 and publication; **ISSUE-365** stays open for B0/B1a and D-365-W.
- **Residual register:** `RESIDUALS-4.md` (with `../run3/RESIDUALS-3.md` and `../run2/RESIDUALS.md` for unchanged rows). Nothing accepted on the owner's behalf.
- **Not verified in run 4:** every production pin (carried), DEV `AFLDB_BETA_EPOCH`, Caddy `roll_keep_for`, DigitalOcean console and snapshots.
- **Incidents disclosed:** none outside authority. Disclosed in the scope records: two agents ran `pkill -f` patterns that matched (and killed) their own ssh shell (`gates`, `rbfail`; no other effect; the brief forbids broad `pkill -f`), a third was refused by the permission layer (`coleman276`); one full-order snapshot shared attribution run ran single-file vitest invocations without the heavy lock (`leaks`, disclosed as borderline); several agents killed their own queued waiters or mis-started runs by PID and dropped their own scratch databases; `coleman276`'s first mutation script reverted its own uncommitted test file on the host mid-batch (detected, re-run); `qual`'s first rehearsal pass mis-launched 21 react-server cases (re-run 22/22). The orchestrator ran the manifest checker from the workstation (read-only ssh hashing) and read-only `ls`/`sha256sum` on run-owned host paths; DEV state was read twice (identical PIDs, invocation ids and HEAD `8b024098`). RB-1 was listed read-only (`ls`) by the DEV-state script, never opened, written or moved.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Fixed locally** | committed on the branch |
| **Qualified** | passed at Q″, delta requalified at Q‴ |
| **Awaiting publication** | A |
| **Awaiting installation / operation** | B0, B1, B1a, B3–B7 |
| **Awaiting owner decision** | §C |
