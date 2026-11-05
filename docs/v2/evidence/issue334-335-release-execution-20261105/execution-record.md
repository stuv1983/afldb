# ISSUE-334/335 release: execution record (5 Nov 2026)

Contract: [issue334-335-release-approval-2026-11-05.md](../../issue334-335-release-approval-2026-11-05.md) sections 5 to 8.

## Approval as received (owner, 2026-11-05, receipt 12:07 AEDT)

- R `0f251c2daa8d7c6c38eacd559376dde41e010fd9`; H `f32d44f07b3f81129aad4cce2feef1629a37fef1`; expected origin/main before push `87b6b2160a7c7e627f10646957aeeb754d04393e`; outgoing release and only rollback target `a0b1080f5b98-B8kdpO6PO1tUCHus0j1za`.
- The owner acknowledged that the release also carries the GAP-029 `admin-draft.ts` refactor (package section 2).
- **D0 was delegated to Claude for this exact commit only**, overriding the package's owner-only push boundary. Claude executes locally and over SSH as `arm`, without sudo.
- Preparation window: 90 minutes from receipt, so it ended 13:37 AEDT. Stop at the first failed gate; no build retry; no guard lowered. **Stop after the verified build; no promotion while the owner is away.**
- Cutover: one owner-initiated block containing D3a then the D3b sudo restart. It is authorised before 17:00 AEDT 6 Nov 2026, with at least 100 minutes before any afldb timer fires. It is not run if its checks fail or the deadline has passed. After the owner returns the cutover output, D3c and D4 proceed without a further approval; acceptance must finish within 60 minutes of the restart.
- **D4 command amendment (owner):** the unique-string check is a single invocation, `grep -rqF -- 'active manual coach assignment' "$ROOT/releases/$NEW_ID/.next/standalone/.next/server"`. It replaces `grep -rlF … | grep -q .`, which can fail falsely under `pipefail`. R and H are unchanged.
- Acceptance consists of the package's manifest and provenance, serving identity, health and preservation checks. No real match deletion or media replacement on production. The refusals are recorded as proven on isolated Linux and **not exercised on production**.

## Transport

- Every production phase ran from one pinned script, `phase.sh` (this folder; sha256 `3ca42f903f850cc9a5f5aa278ee238a39da0ed91904474b5e21ece19f119e6af`). It was copied byte-exact to `/home/arm/i334-335/phase.sh`, and each SSH session checks the hash before running.
  - The package blocks are verbatim, except the D4 amendment above and the read-only prechecks the owner required before D3a in the `cutover` phase.
- Git Bash's own `ssh` was refused (`Permission denied (publickey)`); Windows OpenSSH, which holds the agent key, was used for everything else.
- The P-A script was piped through PowerShell. That added a BOM and CRLF, so line 1 (the shebang) and the empty last line errored harmlessly, and the remote hash differed from the local one. The P-A block's own assertions ran and passed. Later phases used byte-exact stdin redirection with a verified hash.

## Results

| Step | Time (AEDT, 5 Nov) | Result |
|---|---|---|
| W0 | 12:07:33 | **PASS**: HEAD = H, tree clean except `.codex/`, STATIC DELTA CHECK PASS (63 enumerated non-documentation files, 4 application source files), `origin/main` = `87b6b216`. Outgoing commits: `9a8b17cf`, `06459e99`, `0f251c2d`, `21fd09aa`, `f32d44f0` |
| P-A | 12:08:59 | **PASS**. Details below |
| J1 | 12:09 | no afldb cron entries |
| D0 | 12:09:29 to 12:09:33 | **PASS**: `87b6b216..f32d44f0 -> main` on `https://github.com/stuv1983/afldb.git`, no force; remote re-read = H |
| D1 | 12:11:51 to 12:11:57 | **PASS**: fetch `d00e07e3..f32d44f0`; STATIC DELTA CHECK PASS on production from H's bytes; `merge --ff-only`; HEAD = H, clean; STATUS PASS; STATE OLD_SERVING |
| D2 | 12:11:57 to about 12:16:54 (tmux `i334d2`, one run) | **PASS**. Details below |
| Post-build verification (`v`) | 12:17:00 | **PASS**. Details below |

**P-A details:**
- **Production as recorded:** checkout `d00e07e3`, clean; no locks; `current` = `a0b1080f5b98-B8kdpO6PO1tUCHus0j1za`; `previous` = `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6`.
- **Release checks:** STATUS PASS. VERIFY PASS for `OLD_ID`, with 190 server-output files differing, which is ISR and allowed. STATE OLD_SERVING (MainPID 3326560, started Tue 3 Nov 08:48:00, NRestarts 0).
- **Resources:** MemAvailable 2,745 MB; 50,082,752 KB free; no `pg_dump`, `rsync` or restore process.
- **Timers and setting:** `afldb-settle-afl-api.timer` next run **Fri 2026-11-06 05:07:25 AEDT** (last trigger Thu 5 Nov 05:03:41); `AFLDB_SETTLE_TRIGGER` count 1; the match timer is enabled; the Brownlow and AFL Tables timers are disabled.
- **Helpers:** the `c5-observe` helper is present, and `arm` can read the afldb journal.

**D2 details:**
- **Admission:** MemAvailable 2,778 MB, 47.8 GB free.
- **`npm ci`:** 16 s, minimum 1,897 MB available, peak RSS 903 MB.
- **Build:** 248 s, minimum 1,209 MB available, peak RSS 1,695 MB.
- **Candidate:** passed V1 to V5; boot smoke ok (`/`, `/players`, `/clubs`, `/seasons` 200).
- **Result:** **`RELEASE READY 0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`** (12,996 files, manifest `ee6f3971a3ea…`). VERIFY PASS (revision `0f251c2daa8d7c6c38eacd559376dde41e010fd9`, BUILD_ID `3t0xWKI76Jgna2tB8a9oN`). Links unmoved; STATE OLD_SERVING. NEWFILE `/home/arm/i334-335-new-id.txt` written.

**Post-build verification details:**
- VERIFY PASS with revision = R.
- `current` = `OLD_ID` and `previous` = `OLD_PREV`, both unchanged; STATUS PASS; STATE **OLD_SERVING** (MainPID 3326560).
- The ISSUE-335 string is present in the `NEW_ID` server bundle and absent from `OLD_ID`.
- Retained releases: all six earlier ones plus `NEW_ID`.

At this point Claude stopped after the verified build, as instructed, with no promotion, restart, recovery, database or settings action.

## Cutover (owner) and acceptance

The owner returned the output of a cutover invocation that started at 15:15:44 AEDT. It printed `CUTOVER FAILED rc=1: DO NOT RESTART`, after both VERIFY lines and before the link assertion line. Its closing probe already showed **NEW_SERVING**: `current` = `NEW_ID`, `previous` = `OLD_ID`, and MainPID 3427584 running `NEW_ID`.

Claude acted on nothing until a read-only provenance collection (`provenance.sh`, `provenance-20261105.log`) established what had happened.

**Provenance (read-only):**
- `events.log` shows `promote 0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN previous a0b1080f5b98-B8kdpO6PO1tUCHus0j1za` at 15:11:49.252 AEDT, and the link mtimes match it.
- The sudo journal shows `arm : TTY=pts/0 ; PWD=/home/arm/i334-335 ; COMMAND=/usr/bin/systemctl restart afldb` at **15:11:58 AEDT**.
- The old primary received SIGTERM at 15:11:58, and the new primary started at 15:12:03 with the identity line for `NEW_ID` at revision `R`.
- `restart-probe.log`, written at 15:12:23, shows STATE NEW_SERVING. The block writes that file only after the cutover phase's last line equals `D3a PASS`.
- **Conclusion:** the owner's first invocation, at about 15:11, passed the prechecks and D3a, and the owner restarted at 15:11:58. That run counts as D3b.
- The invocation the owner returned, at 15:15:44, was a second one. Its prechecks correctly refused, because `current` was no longer `OLD_ID`, and it changed nothing.
- **Lost evidence:** the second run's `tee` overwrote the first run's `cutover.log`, so the first run's precheck text is not retained. What remains is the event and journal ordering plus `restart-probe.log`.
- **Window conditions held:** the deadline (17:00 AEDT 6 Nov) and the timer margin, since the next match timer run is 05:07:25 6 Nov.

**Acceptance against the 15:11:58 restart (the 60-minute limit was 16:11:58):**

| Step | Time (AEDT) | Result |
|---|---|---|
| D3c | 15:17:54 to 15:17:58 | **PASS**. Details below |
| D4 | 15:17:58 to 15:18:04 | **PASS**. Details below |

**D3c details:**
- **Post-install check PASS:**
  - STATUS PASS: the process runs `NEW_ID`.
  - Loopback and `https://beta.afldb.com` health ok, and the new `_buildManifest.js` returns 200.
  - The previous build returns 404 at the origin, both loopback and cache-busted public. One old Cloudflare cache HIT of an immutable asset is reported and is harmless.
  - 10 pages ok; 8 assets 200, byte-identical to `NEW_ID`; `POST /api/admin/email-intake` 410.
  - The primary start line is present; 0 error, fatal or unhandled lines; NRestarts 0.
- **Identity:** STATE NEW_SERVING. The journal identity line names `release 0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN revision 0f251c2daa8d…`.
- **Setting:** `AFLDB_SETTLE_TRIGGER` count 1.
- **`c5-observe timer` PASS:** match timer enabled and active, next run Fri 6 Nov 05:07:25, the same as P-A; Brownlow and AFL Tables timers disabled and inactive; 0 settle or acquire processes; setting still true.

**D4 details:**
- VERIFY PASS: revision `R`, 12,996 files.
- STATE NEW_SERVING.
- The single-invocation `grep -rqF` (owner amendment) found the ISSUE-335 literal.
- `D4 PASS (serving revision R, manifest-verified; refusals proven on Linux, not on production)`.

**Decision: ACCEPTED.** Acceptance took 6 minutes from the restart. No recovery was used.

**Not exercised on production:**
- the ISSUE-334 403 refusal;
- the ISSUE-335 deletion refusal;
- the optional same-origin upload smoke;
- any check for orphaned `match_coaches` overrides.

**Untouched:** no database or schema write, grant, `.env`, settings or timer change, Brownlow operation, manual settle, WSL access or cleanup. Claude ran no sudo command and no restart.

**Retained:** `OLD_ID` (now `previous`, the only rollback target), `OLD_PREV` and the four older releases. Logs: `/home/arm/i334-335/` on production, and this folder.

**Push:** none after D0. The outcome commit is local.

## Post-acceptance: orphaned `match_coaches` override census (owner-authorised, read-only)

Run 2026-11-05T04:26:00Z by Claude over the existing read-only SSH authority (`arm`, no sudo). Script:
`scripts/census-match-coaches-overrides-prod.sh`; output: `census-match-coaches-overrides-prod.out` (both in this folder).

- **Boundary:** `afldb_backup` credential from the checkout `.env` (never printed), `default_transaction_read_only=on`
  plus an explicit `BEGIN … REPEATABLE READ READ ONLY … ROLLBACK`; `transaction_read_only` read `on` at start and end.
  No DDL, no temp objects, no write, deactivation, repair, deletion or replay.
- **Target:** `afldb_prod`, PostgreSQL 16.15, ledger 118 (`118_fixtures_unconfirmed_participants.sql`).
- **Method:** the key decode is copied verbatim from `replay_admin_overrides(match_coaches)` in
  `tools/migration/common.py` (match key = everything before the last `|`, club slug after it, equality only). Classes,
  in the replay's precedence: malformed (no delimiter / empty slug), missing match, invalid club slug, then a
  participation check (club is the match's home or away club, as `setCoachAssignment` enforces), missing or unresolvable
  `coach_identity`.
- **Result:** `data_overrides` holds **no `match_coaches` rows in any state** (no active, no inactive); `active_total 0`.
  So there are **0** malformed keys, **0** missing matches, **0** invalid club references and **0** non-participant
  clubs. No data-remediation finding is needed.
- **Basis for reading 0 as real:** no row-level security policy exists in the migration history, and a privilege
  failure would have aborted the run under `ON_ERROR_STOP` (`psql_rc=0`). No separate positive-control count was run.
- The cutover provenance above is unchanged: the second run's documented refusal and the overwritten first-run
  `cutover.log` stand as recorded; cutover was not rerun and no missing evidence was reconstructed.
