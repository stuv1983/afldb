# Remediation 2026-11-14 — approval packet 5 (finalisation; supersedes `../run4/APPROVAL-PACKET-4.md` and packets 1–3)

**Executed in run 5:** B0 only (owner-approved read-only production probe, 2026-11-15 20:19 AEDT, `B0-FINDINGS.md`). One test-only local
correction (T-2) with affected-scope qualification, and records. **Not executed:** no push, merge, release, install, restart, reboot,
backup, data repair, configuration change or log deletion; no DEV service operation (host test work stayed in a run-owned workspace and test cluster). Each approval below is separate; silence is not approval; no
owner decision has been taken on the owner's behalf.

## 1. Candidate and pins (re-read immediately before each step; any difference is a stop)

| Ref (local, never pushed) | Points at | Status |
|---|---|---|
| annotated tag **`remediation-final-20261115-r5`** | **C′**, the commit this packet is in (a commit cannot name itself: print it with `git rev-list -n 1 remediation-final-20261115-r5`; the tag annotation states C′'s full SHA) | **the candidate for Approval A** |
| branch `claude/remediation-final-20261115-r5` | C′ | |
| branch `claude/remediation-20261114` | tip C′ | |
| tag `remediation-final-20261115`, branch `claude/remediation-final-20261115` | `7088f2a19d3d0e7a75dd295aaed925c27e074613` (C, run 4) | **retained unchanged; superseded** |

| Pin | Value |
|---|---|
| `origin/main` | `de640826d13489c58392563e7ae1ff62403ed293` (`git ls-remote`, 2026-11-15, unchanged) |
| **Executable revision Q⁗** | **`f6af6da93551aed9dbd5658319346d7ecdd96ea3`** — C (`7088f2a1`) plus two commits that change only `tests/integration/awards-reload-links.test.ts` (T-2: `96573534` Coleman-only restore, superseded by `f6af6da9` all award rows and spans). Every commit after Q⁗ up to C′ is **records-only** (`git diff --name-only f6af6da9 remediation-final-20261115-r5` lists only `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md` and files under `docs/v2/evidence/remediation-20261114/run5/`). |
| Prior executable revision Q‴ | `16027092e075d9064df8a3749c4b17805c2eaaeb` (run 4; `git diff --name-only 16027092 f6af6da9` = the T-2 test file plus run-4 records) |
| Production (B0, read 2026-11-15 20:19 AEDT) | `current` `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, `previous` `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`, checkout `main` `c1c4b22e…` clean, STATUS PASS, health ok/ok, `afldb` MainPID 3774230 since 2026-11-14 06:35:21; `afldb_prod` OID 66668, sysid `7674454702926115004`, ledger 118 (`118_fixtures_unconfirmed_participants.sql`); `AFLDB_BETA_EPOCH` 1; 2026 `complete`, no 2027 row; Caddyfile `4f6972ec…d7af036`; kernel 137, reboot pending; needrestart hold and apt 52 absent |
| Schema change in the candidate | none (no `src/db/migrations/` file changed since `c1c4b22e`); `package-lock.json` unchanged |

**Executable vs records.** Run 5's only executable change is the T-2 test file (Q⁗). Everything else in run 5 is records: this packet,
`B0-FINDINGS.md` with the probe script and output, `b1a/` (README, the B1a runner and its rehearsal output), `G1-REBUILD-TIERS.md`,
`T2-QUALIFICATION.md`, `host-scripts/`, and the tracker lines. The B1a runner `b1a/b1a-repair-2026.mts` is an operator script kept on the
record path (excluded from the repository typecheck and lint, `tsconfig.json` / `eslint.config.mjs`); it is not application code and runs only
under Approval B1a.

## 2. Approval A — publication (Git only; recommended: approve)

- Fast-forward `origin/main` from `de640826` to C′: **172 commits** (169 to C, the two T-2 commits, the run-5 records commit).
- Qualification: run 4's (`../run4/QUALIFICATION-4.md`) for everything up to Q‴, unchanged. **Run-5 delta (T-2) qualified on its affected scope
  only** (`T2-QUALIFICATION.md`): typecheck rc 0 and lint gate 338/43 (ratchet unchanged) at Q⁗; `awards-reload-links` per-file on the rebuild and
  snapshot templates; shared on both with a full table-count, `award_winners` row-content, award-span and honours-table content diff against the
  untouched template; red at C and at `96573534` reproduce the residues. Broad qualification was not repeated (nothing outside that file changed).
- **Before:** `git fetch origin`; `origin/main` must still be `de640826` (if it moved: stop). `git rev-list -n 1 remediation-final-20261115-r5` must
  print the SHA in your approval.
- **Command (owner):** `git push origin "remediation-final-20261115-r5^{commit}:refs/heads/main"` (fast-forward; never `--force`). The tags are not pushed.
- **Recovery:** a revert commit; never rewrite `main`. Breaking changes as packet 4 §A (`--attended`, per-file DSN refusal, Caddy shapes once B7
  is installed, ISSUE-365 rule for future recomputes).

## 3. Production operations

### B0 — DONE (2026-11-15 20:19 AEDT, Claude, read-only). Findings: `B0-FINDINGS.md`. Nothing moved since run 2; **ISSUE-365 is present** (§4).

### B1 — release C′ to production (recommended: approve, attended, daytime)

**Correction to packets 2–4.** They said `host-gate` "refuses outside 05:00–07:15 AEDT" and asked for a window **inside** 05:00–07:15. Both are
wrong. `evaluateHostGate` (`deploy/release.mjs:273`) has no time-of-day rule: it refuses while apt runs or when `apt-daily-upgrade` is due
within 90 minutes. Procedures 02/03 state the real rule: work **outside** 05:00–07:15, which holds the nightly settle (05:00 + ≤ 15 min,
running from the serving checkout) and `apt-daily-upgrade` (06:00 + ≤ 60 min, which without B4 restarts `afldb` and PostgreSQL).

**Time budget (measured on production, `events.log`):** build 4 min 51 s (2026-11-05) and 4 min 27 s (2026-11-11); promote → `status-pass`
6–28 min (2026-11-03, -05, -11).

| Step | Budget |
|---|---|
| Pre-checks: re-read pins (B0 queries), `origin/main` = C′, settle inactive, `git fetch` + fast-forward the serving checkout to C′ (no `npm ci`: lockfile unchanged) | 15 min |
| `release.mjs build --revision <C′>` (4–5 min measured) + margin | 15 min |
| Attended sitting: `host-gate`, `promote --attended`, owner `sudo systemctl restart afldb`, `status --expect`, `post-install-check.sh`, public smoke | 30 min |
| B1a if approved (backup + verify, dry run, commit, re-read) | 20 min |
| Rollback reserve (`rollback --attended`, restart, `status --expect`) | 15 min |
| Observation (health, journal, one ISR page) before leaving | 30 min |
| **Total** | **≈ 2 h 05 min; book 2 h 30 min** |

**Derived window:** start no earlier than **08:00 AEDT** (apt-daily-upgrade's 06:00–07:00 run and its restarts are over; confirm with
`systemctl list-timers apt-daily-upgrade.timer` that LAST is today) and finish by **16:30 AEDT**; i.e. a 2 h 30 min block starting
**08:00–14:00 AEDT** on a day you are available, recommended **10:00–12:30 AEDT on a weekday**. It avoids the settle (05:00–05:15 + run),
apt-daily-upgrade (06:00–07:00 + the gate's 90-minute look-ahead), midnight logrotate, and leaves the evening free. `apt-daily` (downloads
only) can start at any hour: if `host-gate` refuses for it, wait and re-run the gate. Off-season: no live matches, the settle is a 2-second
no-op. The final window is yours.

### B1a — ISSUE-365 repair of season 2026 (conditional, separately approved; recommended: approve, same sitting, after B1)

B0 shows the condition holds: 669/669 2026 `player_season_stats` rows `not_applicable`, coverage rows `pending`. Concrete scope, preconditions,
assertions and recovery: `b1a/README.md`; runner `b1a/b1a-repair-2026.mts` (step (b) only: `recomputeSeasonBrownlowStatus(tx, 2026)`; 669 rows
→ `pending`; nothing else written; commits only if every in-transaction assertion holds). Rehearsed on fresh copies of the snapshot (state
identical to production) and the rebuild: `b1a/dry-run.txt`. Requires a backup taken and verified immediately before (no scheduled backup
exists). Recovery: the exact inverse UPDATE (669 rows) or the dump.

### B2–B8 — unchanged in substance from packet 3 (procedures `../run2/ops/procedures/01..06`, `../run2/caddy357/README.md` §10–§11), with C′ in place of `5cef810b`/C. Only the owner's blanks are shown in §6.

## 4. ISSUE-365 on production (B0)

**Present.** All 669 2026 player-season rows read `not_applicable` (votes NULL); the three 2026 coverage rows read `pending`; 0 medal rows;
9,522 round-vote rows; no other season affected; 12 war-season coverage rows as declared. **Consequence:** every 2026 player-season Brownlow cell
says "No medal" / "No Brownlow Medal was awarded for this season." (false for a completed season whose results are not loaded). Brownlow admin
is **not** locked (the lock reads the `pending` coverage row). Stable until something recomputes 2026. B1 alone repairs nothing; B1a does,
and leaves "Not yet awarded" / "The season is still in progress…" until D-365-W changes the `pending` wording.

## 5. Owner decisions (every genuinely unresolved one)

| # | You are deciding | Recommended → consequence | Blocks |
|---|---|---|---|
| A | Publish C′ to `origin/main` | **Approve** → 171 commits land; no production effect | **Publication**; every B step |
| B1 | Release window for C′ | **A 2 h 30 min block starting 08:00–14:00 AEDT (suggest 10:00 weekday)** → run-1/2/4 fixes live; no schema change | **Deployment** |
| B1a | Repair 2026 player-season Brownlow status | **Approve, same sitting after B1 and a verified backup** → 669 rows `pending`; "No medal" disappears within ~1 h (ISR) | Only that operation |
| D-365-W | Public wording of a `pending` Brownlow season | **"Brownlow Medal results for this season have not been loaded yet."** in the next code change → no false claim for 2026 | A later release (not B1) |
| D-350-1 (B2) | Open 2027 | **After B1, by 2027-03-10** → nightly keeps working; otherwise every nightly fails from 2027-03-17 | Later operation (deadline) |
| D-332-1 (B3) | Failure visibility | **Option A: hourly pull check from your host, alarm to a channel you watch** → failures stop being silent; first test alarm must arrive | Later operation; do before the first 2027 nightly |
| D-HO-1 (B4) | Patching policy | **Install needrestart hold + apt 52 and commit to a weekly window** → no unattended `afldb`/PostgreSQL restart (which can activate a promoted release unattended) | Later operation (B1's gate mitigates meanwhile) |
| D-HO-6 (B5) | Pending reboot (kernel 137 → 149) | **Separate attended reboot after B4 and an off-host backup; console access confirmed first** | Later operation |
| D-HO-2/3/5/7 (B6) | Scheduled backups and off-host copy | **Install after B1; off-host pull to your host; retention per procedure 05** → no more per-operation-only backups | Later operation |
| B7 + 357 O-1 | Combined Caddy install; well-formed unknown slugs persist ~76 KiB each | **Install, keep the beta gate on; add prune job + disk alert before public launch** | Later operation; public launch |
| B8 | Pre-fix Caddy logs (after B7) | **Delete rolled files, truncate live ones** (not secure erasure) | Later operation |
| G-1 | Gridley on the rebuild: replay curated state? | **Keep the frozen source-only rebuild as the contract; add an opt-in tier-P overlay of tracked GAP-029 labels on a copy; never import live `data_overrides`** (`G1-REBUILD-TIERS.md`) | Nothing (future qualification) |
| RB-1 line | Add the RB-1 retention rule to `CLAUDE.md` §11 (text in packet 4 §C1) | **Add** → agents see it at session start | Nothing |
| O-A05-1 (353) | Protect the 1,247 line-ups? | **Leave unprotected** | Nothing |
| O-B06-1/2 (361) | Beta-gate response and waiters | **Keep 200 + noindex; 24 waiters / 10 s** | Nothing |
| 356 | "round most goals" | **Keep resolving to Barry Round** | Nothing |
| 364 O-2 | Lint gating | **Accept the merge-time ratchet (338/43)** | Nothing |

Removed as decisions (routine test maintenance, handled in runs, not production policy): **T-1** (retire the snapshot literal set in
`nl-answers-after-siren` when the 4 Nov snapshot stops being a qualification base), **T-2** (now corrected locally, §7), the 363-B pin
follow-ups and closure C-001/C-002/C-004. **ISSUE-362 prior `auth_sessions` row:** its 12-hour TTL lapsed long ago; not re-read in B0, so
leave it for the next read-only probe to confirm and close, not a decision.

## 6. Approval statements

> **Approval A:** "I approve publishing `<C′ full SHA>` (`git rev-list -n 1 remediation-final-20261115-r5`) to `origin/main` by fast-forward from `de640826d13489c58392563e7ae1ff62403ed293`. Executable revision `f6af6da93551aed9dbd5658319346d7ecdd96ea3`; everything after it is records-only. Lint is a 338-error ratchet, not clean." — owner, 2026-11-15.
> (The run's final report gives this statement with C′'s full SHA filled in.)

> **Approval B1:** "I approve releasing `<C′ full SHA>` (published) to production by `release.mjs build`, `promote --attended` and my own `sudo systemctl restart afldb` in one sitting on ________ (date) starting ________ AEDT (08:00–14:00), commands other than the restart run by Claude over Windows OpenSSH; rollback target `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` unless the pre-check reads otherwise (then stop)."

> **Approval B1a:** "I approve the ISSUE-365 repair of season 2026 per `run5/b1a/README.md` (669 rows, step (b) only) in the same sitting as B1, after a backup taken and verified immediately before it; stop if any precondition differs from B0."

> **B2:** "I approve opening season 2027 per procedure 01 on ________ (date, by 2027-03-10); I will type the plan digest the ceremony prints."
> **B3:** "I adopt D-332-1 option A: owner host ________, alarm channel ________, first delivery test on ________."
> **B4:** "I approve installing the needrestart hold and apt 52 per procedure 02; weekly maintenance window ________ (day/time AEDT)."
> **B5:** "I approve one attended reboot on ________ (date/time AEDT) per procedure 03; DigitalOcean console access confirmed on ________."
> **B6:** "I approve the backup and verify units per procedure 05; off-host destination ________ (host:path), local retention ________, off-host retention ________."
> **B7:** "I approve installing `deploy/Caddyfile.production` sha256 `f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d` per caddy357 §10–§11 with one reload on ________ (date/time); the beta gate stays on."
> **B8:** "After B7, I approve deleting the rolled pre-fix Caddy logs and truncating the live ones per procedure 06 §3."

## 7. T-2 (corrected locally; records `T2-QUALIFICATION.md`)

`awards-reload-links` now captures every pre-existing `award_winners` row (whole, by id) and every award span once before any block and
restores them set-based at file teardown, failing the file if anything still differs. Before: on the snapshot the file left the derived 2026
Coleman winner (+1 row) and 22 relinked "22 Under 22" rows behind, and on both bases re-stamped every reloaded row's `import_batch_id`.
`import_batches` row growth is unchanged (tests read it only relatively; recorded residue). **Newly measured residue:** the content of
`award_nominations`, `hall_of_fame`, `honour_team_members` and `captaincies` still differs after a shared run (row counts equal; cause not
characterised); extending the same restore to them is routine test maintenance for the next test run, not an owner decision.

## 8. Remaining and bounded

Integration ledger as run 4 (`../run4/FAILURE-LEDGER-4.md`: snapshot 18 ids, rebuild 7, classes 1 and 5), minus the T-2 residue.
ISSUE-363 open for G-1 and publication; ISSUE-365 open for publication, B1, B1a and D-365-W. Not verified: DigitalOcean console/snapshots,
root crontab, system journal, Caddy `roll_keep_for`, the `afl_api_current_season_enabled` control setting.
