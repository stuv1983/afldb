# Packet 6R sitting: B1 + B1a-0 (option A) + B1a, Wednesday 18 November 2026, 10:00–12:30 AEDT (= 17 Nov 23:00 – 18 Nov 01:30 UTC)

Prepared 2026-11-16 (Monday) by Claude. **Nothing in this directory has been executed on production.** Packet 6R governs ordering,
preconditions and failure handling (`../RELEASE-AND-REPAIR-PACKET-6R.md` §4, §5); packet 6 §2, §3, §5.1–§5.3, §7 and `../../run6/b1/B1-RUNBOOK.md`
S1–S10 govern the release commands. The blocks here are transcriptions of those commands into `bash -s` scripts; where a block differs
from the runbook text, the difference is listed in §2 below.

## 1. Owner approval (verbatim, received 2026-11-16 ~10:13 AEDT)

> I, Stuart, approve B1, B1a-0 option A, and B1a for Wednesday 18 November 2026, 10:00–12:30 AEDT, under RELEASE-AND-REPAIR-PACKET-6R.md.
> Packet 6R governs the ordering, preconditions and failure handling.
>
> B1: Release a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5, using the qualified off-host typecheck evidence at
> f6af6da93551aed9dbd5658319346d7ecdd96ea3 and the unchanged build resource guards. Recheck production identities and prerequisites before
> proceeding. Fast-forward the serving checkout, build with the packet's complete arguments and --typecheck off-host, run host-gate, and
> promote --attended. I will perform the sudo restart and any required privileged checks. Claude may perform the approved non-sudo
> commands through Windows OpenSSH. The sole application rollback target is c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x. A release failure does not
> authorise database reversal or restoration.
>
> B1a-0, option A: After S2 and before S3, take ONE fresh afldb_prod backup into a new directory using --keep 1000, pruning nothing.
> Capture its hash, header, parity evidence and acceptance BEFORE state. Transfer and verify it on streamanator using the hash-pinned packet
> 6R restore-verification artifacts, restoring into a brand-new isolated cluster. Require VERDICT PASS before repair. Retain the off-host
> backup and stopped cluster with restricted permissions. The temporary workstation copy may be deleted only after the verified off-host
> copy exists. Do not replace afldb_restore_test on the production cluster.
>
> B1a: After successful backup verification, approve the dry run followed by one commit using: runner SHA256
> bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c, from commit 15aa89cb; database afldb_prod, OID 66668, system identifier
> 7674454702926115004; 2026 player-id-set MD5 e5ead8dbf3baf9a7b647b0f55b04c496. Change only brownlow_status from not_applicable to pending
> for those exact 669 rows. Votes remain NULL and coverage remains unchanged. Require every locked precondition and postcondition in packet 6R.
>
> Do not retry automatically. On any ambiguous commit result, use the packet's read-only state determination before further action.
>
> I accept the documented interim wording until D-365-W ships. D-365-W, database reversal, whole-database restoration and all other
> production operations remain separately gated.
>
> Establish authenticated browser acceptance readiness before promotion. Complete the release, repair and public-page checks within the
> window, reserving time for recovery. Stop on identity drift or failed prerequisites and follow the approved state-specific recovery procedure.
>
> I also approve publishing the reviewed preparation commits through c34ae24d, including their operational artifacts, and subsequent
> records-only commits documenting this approved execution. Review each complete delta and publish by fast-forward only.
>
> Before the window, complete independent preparation without repeating passed qualification. At the window, proceed until an owner-only
> action is required and provide its exact command.

The typecheck evidence text the owner accepts with B1 is packet 6R §9's, used verbatim in `p7-s3-build.sh`.

## 2. Preparation done 2026-11-16 (no production contact)

- **Publication:** the three reviewed records-only commits `9a68ad52`, `15aa89cb`, `c34ae24d` (no path outside `docs/`, `issues.md`,
  `IssuesIndex.md`, `CHANGELOG.md`; secret/credential/address scan of the whole delta empty) published by fast-forward
  `a2e6ea99..c34ae24d`; `git ls-remote origin refs/heads/main` = `c34ae24d610eab4d05adfd908de426173d077c94`.
- **Artifacts:** the five `run6r/b1a*/` files hash to the packet 6R §3 sha256 values and their Git blobs equal §3's blob ids.
- **DEV host readiness (read-only, 2026-11-15 23:15 UTC):** candidate checkout `/mnt/ssd/afldb-rem5-t2-20261115/cand` at `f6af6da9`,
  porcelain 0, `node_modules` tsx/postgres present, `tools/v2/isolated-pg.ts` present, `brownlow-readiness.ts` sha256 prefix `42a1f1f4`
  (= packet 6R §3), Node v22.23.2, PostgreSQL/psql 16.15, port 61432 not listening, ephemeral range 32768–60999, `/mnt/ssd` 384 GB free.
- **Session readiness analysis (code, no host):** the serving release mints admin claims with `epoch: 1` (`c1c4b22e:src/lib/auth/session.ts:191`)
  and beta claims at `AFLDB_BETA_EPOCH`; C′ holds admin claims to `minEpoch` = `AFLDB_BETA_EPOCH` (`src/middleware.ts`, ISSUE-362 SEC-2).
  With production's epoch 1 (S1 asserts the line), **an existing admitted browser keeps working after promotion**; an admin cookie expires
  12 h after sign-in, so an admin-session browser should sign in at the start of the window.

### Adaptation from the runbook text (owner-visible)

| Runbook text | Block | Why |
|---|---|---|
| S1 workstation check `git ls-remote origin refs/heads/main` = `a2e6ea99`; S2 `[ origin/main = CP ]` | P0 (workstation) and P2 assert **`a2e6ea99` is an ancestor of `origin/main` and `git diff a2e6ea99 origin/main` is empty for `src tools deploy packages tests package.json package-lock.json next.config.ts`**; the checkout is still fast-forwarded to `a2e6ea99` exactly | the owner-approved publication moved `origin/main` to `c34ae24d` (records only). The literal check would STOP the sitting at S2. Packet 6R §8 anticipated publication as independent of the sitting. |
| Packet 6R §5.3 runs dry run and commit in one subshell | P5 (dry run) and P6 (commit) are separate connections; P6 refuses unless P5's `dryrun.txt` shows `DRY-RUN-PASS` | §5.3's own text: "separate call, only after 1) passed and the backup is verified" |
| PUBLIC-CHECKS §4 debutant `ORDER BY s.games LIMIT 1` | P10: the first 2026 player with no earlier season (`NOT EXISTS … season < 2026`), by id | the runbook's query does not select a debutant |
| S10 four separate polls | P11: one connection, four ticks 10 min apart | fewer SSH connections (the home network's IPS has blocked bursts of SSH to the droplet before) |

## 3. Transport

Workstation, Bash tool, Windows OpenSSH: production `C:/Windows/System32/OpenSSH/ssh.exe afldb` (alias → `arm@209.38.87.252`);
DEV `ssh.exe -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`. Each block: `tr -d '\r' < <block> | ssh … bash -s -- <args>`; the body
is one function run with stdin from `/dev/null`. **One connection per step, no automatic retries, no rapid reconnects** (memory:
`afldb-firewall-blocks-own-ssh`); if SSH stops connecting while HTTPS works, suspect the local IPS, wait, and tell the owner.
`STAMP` = UTC `yyyymmddThhmmssZ` fixed once at P0; `A=/home/arm/b1a-r6r-$STAMP`, `D=/home/arm/backups/afldb-b1a-$STAMP`,
`W=/mnt/ssd/afldb-b1a0-$STAMP`, staging `D:\tmp\afldb-b1a0-$STAMP\`; artifact source `D:\tmp\afldb-b1a-r6r-art-20261118\` = raw blobs
from `git show 15aa89cb:<path>` (2026-11-16), `prod\` (runner, accept, reverse, parity → `$A`) and `dev\b1a\`, `dev\b1a0\` (runner, accept,
parity, verify script → `$W/art/`); all eight files hashed equal to packet 6R §3 at extraction, re-checked at P0.

## 4. Sequence (AEDT targets; who; stop rule)

| # | ~AEDT | Step | Who | Pass / stop |
|---|---|---|---|---|
| P0 | 10:00 | workstation: `git ls-remote` ancestry check, artifact-source sha256 check, fix `STAMP` | Claude | any mismatch: STOP |
| P1 | 10:02 | `p1-s1-precheck.sh` (S1, read-only) | Claude | `P1 RESULT PASS`; anything else: STOP, nothing changed |
| P2 | 10:10 | `p2-s2-ff.sh STAMP` (S2 ff to `a2e6ea99`, `mkdir -m 700 $A`) | Claude | `P2 RESULT PASS`; STOP leaves checkout C′, release `c1c4b22e` (B1-RUNBOOK §3) |
| P2b | 10:14 | `scp` the 4 production artifacts (runner, accept, reverse, parity) into `$A` | Claude | |
| P3 | 10:15 | `p3-b1a0-dump.sh STAMP` (§5.2 verify/install, §5.1 dump + captures) | Claude | `BEFORE-CHECK PASS`; else B1a abandoned: R3, R1 `probe`, then §4.2 decides S3 |
| P3b | 10:22 | `scp` dump, `.sha256`, `parity-prod.txt`, `accept-before-prod.txt` → staging; local sha256; add `art/`; DEV `mkdir -m 700 $W $W/art $W/art/b1a0 $W/art/b1a`; `scp` to `$W`; then delete the staging copy only after P4's sha256 PASS line | Claude | sha256 mismatch: STOP B1a |
| P4 | 10:27 | DEV `p4-dev-verify.sh STAMP <sha256> <bytes>` (≈15 min budget). In parallel: P10 `baseline` (optional) | Claude | `P4 RESULT VERDICT PASS`; else B1a does not run: R3, R1 `probe`, §4.2 |
| P5 | 10:45 | `p5-b1a-dryrun.sh STAMP` | Claude | `P5 RESULT DRY-RUN PASS`; else no commit: R3, R1 `probe`, §4.2 |
| P6 | 10:48 | `p6-b1a-commit.sh STAMP` — **once; never re-run** | Claude | `OUTCOME COMMITTED` exit 0 and `ACCEPTANCE-DIFF EXACT` → S3. Any other outcome / lost session: **R1 `probe` first** (§4.2 table): `not_applicable\|669\|0` + pin = not committed (B1a abandoned, S3 may proceed); `pending\|669\|0` + pin = committed; anything else or `ALREADY-APPLIED`: STOP before S3 |
| P7 | 10:52 | `p7-s3-build.sh` then `p7b-s3-build-check.sh <LOG>` | Claude | `P7b RESULT BUILD PASS <NEW_ID>`; failure: retry at most once in the window only if the cause is understood and needs no code/data change |
| — | 11:05 | **OWNER: present and ready to restart; browser readiness** (§5) | **Owner** | |
| P8 | 11:07 | `p8-s4s5-gate-promote.sh NEW_ID` (S4 host-gate, S5 promote --attended) | Claude | gate refusal: wait and re-run P8 (never `--skip-host-gate`); promote REFUSED: links unchanged, end as S3 failure; session lost: R1 before any restart |
| S6 | 11:08 | **OWNER: `sudo systemctl restart afldb`** | **Owner** | |
| P9 | 11:10 | `p9-s7s8-checks.sh NEW_ID [confirm]` (S7, S8) | Claude | `P9 RESULT`; `UNVERIFIED journal` → owner journal lines (§5); FAIL → rollback (R2) |
| S9 | 11:15 | workstation `curl` public smoke (B1-RUNBOOK S9 table) | Claude | 5xx or 503 gate message → rollback |
| P10 | 11:18 | `p10-s9b-pages.sh after` (S9b) | Claude | `P10 RESULT after PASS`; stale → PUBLIC-CHECKS §3 steps; data wrong → R1 `probe`, STOP |
| P11 | 11:25 | `p11-s10-observe.sh NEW_ID <player>` in the background (31 min) | Claude | `P11 RESULT OBSERVATION PASS`; crash restarts/errors → rollback |
| — | 12:00 | records commit (results, hashes, outcome); publish records-only by fast-forward after reviewing the delta | Claude | |
| — | –12:30 | reserve for recovery | | |

Rollback (only on a packet 6R §4.3 trigger after S5): `r2-rollback.sh links` → **OWNER `sudo systemctl restart afldb`** →
`r2-rollback.sh verify`. Never a database reversal or restore (separately gated). After a rollback to `c1c4b22e`, its cached player pages
converge within the 75-minute allowance (packet 6 §7).

## 5. Owner-only actions (exact commands)

1. **Before P8 (browser readiness):** in your own admitted browser, open `https://beta.afldb.com/players/scott-pendlebury-11724` and
   confirm the page renders (not the `/beta` sign-in page). If your browser relies on an admin session, sign in at the start of the window.
   Expected after B1a + promotion: the 2026 row's BV cell reads "Not yet awarded" (hover: "The season is still in progress; …").
2. **S6, right after P8 prints `PROMOTED`:** `sudo systemctl restart afldb`
3. Only if the unit is not active and `Result=start-limit-hit`: `sudo systemctl reset-failed afldb && sudo systemctl start afldb`
4. Only if P9 prints `UNVERIFIED journal` (it prints the exact `--since` value):
   `sudo journalctl -u afldb --since "<ActiveEnterTimestamp>" -o cat | grep -E '\[afldb\] (primary|serving build)'` (must name the new
   BUILD_ID and release) and `sudo journalctl -u afldb --since "<ActiveEnterTimestamp>" -o cat | grep -ciE 'error|fatal|unhandled'` (must print 0)
5. Rollback only: `sudo systemctl restart afldb` after `r2-rollback.sh links`.
6. After the sitting (no deadline): decide removal of the DEV dump copy `$W` and the stopped cluster `/mnt/ssd/afldb-b1a0-verify-…-pg`.

## 6. Block manifest

`SHA256SUMS` in this directory (LF bytes as committed). Each block's sha256 is re-checked on the workstation before it is sent.
