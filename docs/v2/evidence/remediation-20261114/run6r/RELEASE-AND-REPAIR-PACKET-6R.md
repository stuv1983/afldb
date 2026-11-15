# Remediation 2026-11-14: release-and-repair packet 6R (B1, B1a-0, B1a). Replaces packet 6 for B1a-0 and B1a, and packet 6's sequence

**Scope of this correction (2026-11-16):** a bounded safety correction to packet 6 and the B1a operation only. **Nothing was executed on
production:** no SSH to production, no production database session, no deployment, backup, repair, restart, installation or log deletion.
All execution was on the DEV host `streamanator`, on disposable copies of the 4 Nov production snapshot, plus local Git commits.
**The published application candidate is unchanged:** `origin/main` = `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5`; no application code changed
(`git diff a2e6ea99 15aa89cb -- src tools deploy packages tests package.json package-lock.json next.config.ts` is empty).
Each approval in §9 is separate; silence is not approval. **B8 remains a separate owner decision.**

What packet 6 still governs, unchanged: §1 (publication record), §2 (identities), §3 (window rules), §5.1–§5.3 and `../run6/b1/B1-RUNBOOK.md`
S1–S10 (release commands and checks), §7 and `../run6/public/PUBLIC-CHECKS.md` (page checks), §8 (pending wording, D-365-W). What 6R replaces:
packet 6 §4 (order and the "skip it" rule), §5.4 (B1a-0), §5.5 (B1a), §6 (recovery), §9 (approvals), and all of `../run6/b1a/` (runbook,
acceptance and reversal SQL). **The run-5 runner `run5/b1a/b1a-repair-2026.mts` (sha256 `8453572e…a27c`) is withdrawn: never run it.**

## 1. Corrections made, and their rehearsal results

### 1.1 What was wrong with packet 6's B1a (verified in its code)

| Packet 6 defect | 6R correction (in `b1a/b1a-repair-2026-r6r.mts`) |
|---|---|
| OID and system identifier were optional (checked only if the flag was passed) | `--expect-db`, `--expect-oid`, `--expect-sysid` and `--expect-ids-md5` are **all required**; any missing or unknown flag refuses before connecting |
| Start state "669 × `not_applicable`" was an operator eyeball check of the BEFORE line; the runner accepted mixed states | The runner requires **exactly 669 rows, every one `not_applicable` with NULL votes, whose ordered `player_id` set hashes to the pinned `e5ead8dbf3baf9a7b647b0f55b04c496`**; mixed, missing, additional or substituted rows refuse |
| It could recompute coverage (`recomputeBrownlowCoverage`) | **Never** recomputes or writes coverage. It asserts the three 2026 Brownlow coverage rows are exactly `pending`/unrecorded/NULL/NULL; any other coverage state refuses ("needs a separate reviewed operation") |
| It wrote through `recomputeSeasonBrownlowStatus`, which assigns `brownlow_status` **and** `brownlow_votes` on every 2026 row | One targeted statement: `UPDATE player_season_stats SET brownlow_status = 'pending' WHERE season = 2026 AND brownlow_status = 'not_applicable' AND brownlow_votes IS NULL RETURNING player_id`. `brownlow_votes` is not assigned. The shipped derivation (`brownlowStatusSql`) is only **read**, to assert it yields `pending` for 2026 (so the next settle recompute agrees) |
| No locks: a concurrent writer could change state between the checks and the update | §2: `SHARE ROW EXCLUSIVE` on all seven tables involved, taken **before** any check, plus `FOR UPDATE` on the 2026 rows |
| Acceptance was aggregate (status counts per season) | Before COMMIT it verifies: the RETURNING id set hashes to the pin and has 669 rows; all 669 are `pending` with NULL votes; the md5 of every 2026 row **minus `brownlow_status`** is unchanged; every other season's rows (full-row md5) unchanged; the whole of `stat_availability` (full-row md5 and count) unchanged; medal, authority and derivation still as required |
| `NOTHING-TO-REPAIR` exited 0 on a commit run | Distinct outcomes and exit codes: `0` DRY-RUN-PASS / COMMITTED, `1` REFUSED, `2` ERROR (e.g. lock timeout), `3` ALREADY-APPLIED (the exact repaired state; nothing written), `4` COMMIT-UNKNOWN (connection lost during COMMIT) |
| `lock_timeout 5s`, `statement_timeout 120s` | `lock_timeout 5s`, `statement_timeout 60s`, `idle_in_transaction_session_timeout 60s`, all `SET LOCAL`; session must be read-write and READ COMMITTED |

The acceptance probe (`b1a/b1a-accept-r6r.sql`) and the guarded reversal (`b1a/b1a-reverse-r6r.sql`) were brought into line: identity is
passed as `-v db/oid/sysid` (never defaulted, so the same file is rehearsed and run unmodified); new lines `ids2026` and
`fp_stat_availability(H3)`; H2 now excludes only `brownlow_status`; the reversal takes the runner's locks in the runner's order, guards on the
BEFORE ids, inputs, H1, H2 and H3, requires `-v commit=true|false` (absent → refuses), and assigns only `brownlow_status`.

### 1.2 Rehearsal (DEV host, 2026-11-15 22:05–22:12 UTC; `rehearsal/raw/rehearsal.txt`, `rehearsal/raw/opta2.txt`)

Each case ran on its **own fresh copy** of the 4 Nov snapshot template (`afldb_v2_rem4coleman276_sntmpl_test`; 2026 state equal to what B0 read
on production: 669 × `not_applicable`, coverage 3 × `pending`, 0 medal rows), as the real `afldb_import` role (which holds UPDATE on all seven
locked tables, as on production), from the run-5 candidate checkout `f6af6da9` (its `src/` equals `a2e6ea99`'s) with the three artifacts as
untracked copies at the hashes in §3, removed afterwards (checkout porcelain 0). Every copy was dropped. "State byte-identical" means equal
md5 of the 2026 rows' `xmin` (proves no row version was written), of every `player_season_stats` and `stat_availability` row, and the 2026
medal count.

| Case | Setup | Result |
|---|---|---|
| Exact state, dry run | none | `DRY-RUN-PASS (rolled back)`, exit 0; **state byte-identical afterwards (xmin unchanged): the dry run rolled back** |
| Exact state, commit | none | `COMMITTED`, exit 0. Acceptance BEFORE→AFTER changed exactly two lines: `pss2026` `not_applicable\|669\|0` → `pending\|669\|0`, `na_pss` `669\|9553` → `0\|9553`; ids, H1, H2, H3, coverage, inputs identical; `stat_availability` byte-identical |
| Repeat commit, repeat dry run | after the commit | `ALREADY-APPLIED (nothing written)`, exit 3, twice; **xmin unchanged: no further mutation** |
| Reversal | after the commit | without `-v commit`: refused; wrong H3: refused; dry run: rolled back (xmin unchanged); commit: `REVERSE COMMITTED`; afterwards every 2026 row, every `player_season_stats` row and every `stat_availability` row is **byte-identical to the pre-repair state**, acceptance identical to BEFORE; repeated: refused (rows not `pending`); wrong identity: refused |
| Wrong identity | `--commit` each | wrong database name, wrong OID, wrong system identifier, wrong id-set hash: `REFUSED`, exit 1; `--expect-sysid`, `--expect-oid` or `--expect-ids-md5` omitted, or the retired `--expect-rows` flag: `REFUSED usage`, exit 1; state byte-identical |
| Mixed state | 1 of 669 set `pending` | dry run and `--commit`: `REFUSED … mixed or changed: not_applicable 668, pending 1`; state byte-identical |
| Row-count drift | 1 row deleted (668) / 1 row added (670) | `REFUSED` (id-set hash and count) for both, dry run and commit; state byte-identical |
| Substitution | 1 deleted + 1 added (669 rows, all `not_applicable`) | `REFUSED` (id-set hash differs): count alone would have passed |
| Coverage drift | round votes `partial`; season total `not_applicable` | `REFUSED` (coverage rows; for the second also "derivation gives not_applicable"); state byte-identical |
| Loaded medal | one 2026 `brownlow_season_votes` row | `REFUSED 1 brownlow_season_votes rows for 2026`; state byte-identical |
| Concurrent writer holding a lock > 5 s | open no-op UPDATE on `player_season_stats` (2025 row) for 8 s | `ERROR canceling statement due to lock timeout`, exit 2, after 5.3 s; 2026 xmin unchanged |
| Concurrent writer commits a 2026 change while the runner waits | 2026 row → `pending`, commit at 2 s | runner waited 1,266 ms for the lock, then saw the committed change: `REFUSED … mixed`; only the writer's change exists |
| Writers arriving while the runner holds its locks | a `FOR SHARE` holder delays the runner's `FOR UPDATE` for ~3.3 s | `pg_locks` at t = 1.5 s: runner holds `ShareRowExclusiveLock` on all seven tables (granted) and waits on the holder's row; four writers (UPDATE a 2026 `player_season_stats` row, UPDATE a 2026 coverage row, INSERT a 2026 medal row, UPDATE `seasons` 2026), each `lock_timeout 1s`: **all four cancelled by lock timeout**; a reader returned at once (669). Runner then `COMMITTED`; afterwards 669 `pending`, 0 medal rows, coverage unchanged (no writer change landed) |
| Two runners at once | both `--commit` | one `COMMITTED`; the other waited 531 ms on the first's lock, then `ALREADY-APPLIED`, exit 3 |

Static qualification of the runner (the repository typecheck and lint exclude `docs/**/evidence`, so they were run on it explicitly):
`tsc -p` with the repository `compilerOptions` (strict) including only the runner and its import graph: **rc 0**; `eslint --no-ignore
--max-warnings 0` with the repository config: **rc 0** (`rehearsal/raw/rehearsal.txt` lines 10–11).

## 2. Concurrency: lock order and why no write can pass between the final check and the update

Inside one transaction (READ COMMITTED, read-write; both asserted):

1. `SET LOCAL lock_timeout '5s'`, `statement_timeout '60s'`, `idle_in_transaction_session_timeout '60s'`; identity read and asserted.
2. **One** `LOCK TABLE seasons, stat_availability, brownlow_season_votes, brownlow_season_authority, brownlow_vote_entry_state,
   brownlow_round_votes, player_season_stats IN SHARE ROW EXCLUSIVE MODE` (acquired in that order; the written table last). These are every
   table the preconditions read and every table the shipped status derivation reads.
3. `SELECT player_id FROM player_season_stats WHERE season = 2026 ORDER BY player_id FOR UPDATE` (row locks in key order).
4. All preconditions (each statement takes a fresh snapshot, after step 2, so it sees every write committed before the locks were granted).
5. The single UPDATE, the in-transaction acceptance, then COMMIT (or ROLLBACK for a dry run / any failure).

**Why nothing can change between step 4 and step 5:** `SHARE ROW EXCLUSIVE` conflicts with `ROW EXCLUSIVE` (taken by every INSERT, UPDATE,
DELETE, MERGE and COPY FROM), `SHARE UPDATE EXCLUSIVE`, `SHARE`, itself, `EXCLUSIVE` and `ACCESS EXCLUSIVE` (TRUNCATE, DDL). No session,
superuser included, can modify a row of a locked table without first obtaining one of those modes, and none can be granted until this
transaction ends; locks are held from step 2 to COMMIT/ROLLBACK, which covers the whole check-to-update interval. Only `ACCESS SHARE` (plain
reads) and `ROW SHARE` (`SELECT … FOR UPDATE/SHARE`, which cannot modify data) remain compatible: public pages keep reading throughout. A
writer already in progress when step 2 starts makes the runner wait (it then sees that writer's committed result) or, beyond 5 s, cancels the
runner with a lock timeout (fail-safe, nothing written). Because every lock is taken in one statement before any read or write, a deadlock
with another lock order can only abort a transaction that has written nothing. The reversal takes the identical locks in the identical order.
Rehearsal evidence: the four concurrency rows of §1.2 and `rehearsal/raw/conc-blocked-runner.txt`.
Cost: on production the locks are held for about a second (rehearsal: 7–8 ms to acquire, whole run under 2 s); during it, admin edits of
these tables and a settle would wait (the settle is required inactive). Readers are not affected.

## 3. Operational executable artifacts: classification, pins, qualification

These files live under `docs/v2/evidence/…` and are excluded from the repository typecheck (`tsconfig.json:44`) and lint
(`eslint.config.mjs:83`), **but they are executable operational artifacts**: each is pinned by commit, Git blob and sha256, executed only at
those bytes, and qualified by the evidence named. They were committed in local commit **`15aa89cb23c462796d673962258b940ae6502473`** on
`claude/remediation-20261114` (parent `9a68ad52`), **unpushed**; they reach production and the DEV host by copy with sha256 verification
(§5), not through `origin/main`.

| Artifact (path under `docs/v2/evidence/remediation-20261114/run6r/`) | Role | sha256 | Git blob @ `15aa89cb` | Qualification |
|---|---|---|---|---|
| `b1a/b1a-repair-2026-r6r.mts` | B1a runner (writes) | `bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c` | `74f1fcc7e4302472eed62de52723a1e38dcb9f09` | tsc strict rc 0, eslint rc 0, 13 rehearsal cases (§1.2), option-A dry run on a restored dump |
| `b1a/b1a-accept-r6r.sql` | acceptance probe (read-only) | `dc6211d7826d03712ab95a872889a562b86c5a86b72a4fc717431005b5033ec7` | `8d27fcbdf6605e71ad975caefe4e430520551938` | executed in the exact case (BEFORE, AFTER, after reversal) and option A |
| `b1a/b1a-reverse-r6r.sql` | guarded reversal (writes; separate approval) | `e8343ae635288781ff2e5b2957cafa40287f0bfce6dc77f1b87f555c2cd616f3` | `769d348b96a71e515e068c57eb7ad1bcf1851091` | refusal ×4, dry run, commit restoring the exact pre-repair bytes (§1.2) |
| `b1a0/b1a0-dev-restore-verify.sh` | option A backup verification (DEV host only) | `3ec8fd207117c560af8564e57e70c41381c119df02d3558ab0b58d0cf8c067cf` | `a7416eeec53d7eb3bec3f05610866a721c83fbe5` | `rehearsal/raw/opta2.txt`: PASS case, tampered-evidence FAIL case, wrong-sha256 STOP case |
| `b1a0/b1a0-parity.sql` | the nine `restore-test.sh` parity aggregates (read-only) | `7c2a7be0eca0ed1f7024ccc6197b333818caadb7727f2f3be49ae97eb70fcf5d` | `998eefbdd8e147666f8571399d0d868380342eb5` | `rehearsal/raw/opta2.txt` (the first run, `opta.txt`, used a version without `\set QUIET`, superseded) |

Unchanged artifacts the sitting also executes, all at the published candidate `a2e6ea99` and qualified by runs 4–5 (packet 6 §1, §5.1):
`deploy/release.mjs`, `deploy/post-install-check.sh`, `tools/maintenance/backup.sh`, `tools/maintenance/restore-test.sh` (option B only),
`src/db/queries/brownlow-readiness.ts` (imported by the runner; sha256 `42a1f1f4…0dbcc` read at rehearsal). Documents still governing:
`../run6/b1/B1-RUNBOOK.md` (`77076e50…a508`), `../run6/public/PUBLIC-CHECKS.md` (`4298ae7b…ff53`) per `../run6/SHA256SUMS`.
Rehearsal environment: DEV host, Node v22.23.2, psql 16.15, PostgreSQL 16.15; isolated cluster `afldb-rem4-coleman276-20261115-pg`.
Manifest: `SHA256SUMS` (21 committed files, relative paths); path-aware checker result at `15aa89cb` in §6.

## 4. Release and repair sequence (corrects packet 6 §4 and §6)

### 4.1 Recommended order (unchanged in substance from packet 6; corrected in its failure handling)

S1 pre-checks → S2 fast-forward the serving checkout to C′ → **B1a-0** (dump; verification by the chosen option) → **B1a** (dry run, commit,
acceptance) → S3 build → S4 host-gate → S5 promote → S6 owner restart → S7–S9b checks → S10 observation.

Why B1a before the build: the build prerenders player pages from the database, so building after the repair ships repaired pages and lets
S9b check them in the sitting; and the repair is independent of which release serves (both `c1c4b22e` and C′ render a `pending` row with
identical wording, `src/lib/format.ts` unchanged between them; the runner runs from the checkout, not the release). The B1a-0 dump is also
the pre-sitting database restore point. The alternative (B1a after S10) is acceptable but needs the 75-minute ISR allowance (packet 6 §7).

### 4.2 Gate after B1a: establish whether it committed before doing anything else

**A B1a that did not end in `COMMITTED` is never "skipped" on assumption.** Before S3:

| Runner outcome | Committed? | Next |
|---|---|---|
| `COMMITTED` (exit 0) | yes | acceptance AFTER (must equal §5.3), continue to S3 |
| `REFUSED` (1), `ERROR` (2), process killed, SSH lost, no OUTCOME line, or `COMMIT-UNKNOWN` (4) | **unknown until read** | run the acceptance probe (read-only). `pss2026` = `not_applicable\|669\|0` with `ids2026` = the pin: **not committed** → B1a is abandoned for this sitting (ISSUE-365 stays as B0 found it) and S3 may proceed. `pending\|669\|0` with the pin: **committed** → treat as COMMITTED. **Anything else: STOP the sitting before S3** (no build, no promote) and report: someone or something else changed 2026 |
| `ALREADY-APPLIED` (3) | the rows were already repaired before this run | STOP and report (nothing in this sitting should have repaired them) |

The same rule applies if B1a-0 fails: B1a never ran, so nothing was committed by it; the acceptance probe is still read once to confirm the
state is B0's before S3 (and if it is not, STOP).

### 4.3 If B1a committed and the release then fails

Application rollback and database reversal are **different operations with different triggers**. A release failure triggers at most an
application rollback (release links back to `c1c4b22e` plus the owner's restart, packet 6 §6.1). **It never triggers the B1a reversal, a
database restore, or any database write:** C′ has no migration, so the database needs no rollback for the application, and the repaired
rows are correct data for both releases.

| Failure point | State | Recovery |
|---|---|---|
| S3 build fails (any `REFUSED`, `BUILD FAILED`, `BUILD_EXIT≠0`, no READY line) | serving `c1c4b22e`, links untouched (`release.mjs:1160-1167`), checkout at C′, **database repaired** | No rollback (nothing promoted). Retry the build at most once, in the window, only if the cause is understood and needs no code or data change; otherwise end the sitting. Any partial `builds/`/`releases/` output stays in place (no deletion without approval). Public: `c1c4b22e` serves repaired rows; its cached player pages converge within the 75-minute allowance (packet 6 §7(b)); check after it. |
| S4 host-gate refuses | as above | wait and re-run (packet 6 §3); never `--skip-host-gate`; if the window runs out, end the sitting as above |
| S5 promote refuses | links unchanged (all refusals precede `release.mjs:1335`) | as S3 failure |
| S5 promote outcome unclear (session lost) | unknown | read `release.mjs status` and both `readlink`s **before any restart**; `current` = new → the owner restarts (continue at S6) or Claude runs `rollback --attended --checkout …` first, by the owner's choice; `current` = old → as S3 failure |
| S6–S10 failure (unit not active after one reset, S7/S8 FAIL other than CACHE/journal-unverified, 5xx, 503 gate message, journal errors, crash restarts) | C′ serving or failed, **database repaired** | application rollback only: `rollback --attended --checkout /home/arm/projects/afldb` → owner `sudo systemctl restart afldb` → `status --expect c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` → `post-install-check.sh c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`. The checkout stays at C′ (packet 6 §6.1). Then the 75-minute allowance for `c1c4b22e`'s cached pages. |

**Database reversal (`b1a-reverse-r6r.sql`)** is only for a fault **caused by the repaired rows themselves** (for example a page or job
demonstrably failing on 2026 `pending` rows), needs its own owner approval at the time, and runs only if every guard holds: same 669 ids,
all `pending`, NULL votes, no medal or published authority, coverage unchanged, and `inputs2026`, H1, H2 and H3 equal to the BEFORE capture.
If anything legitimate has changed since (a settle, an admin edit, a medal load, any other season's rows, any coverage row), the guard refuses
and the newer state is kept: **the reversal can never undo newer legitimate changes.** Run its dry run (`-v commit=false`) first.

**Whole-database restore** from the B1a-0 dump is **never automatic** and is not part of any recovery path above. It would discard every
write since the dump (sessions, audit, admin edits), needs downtime and sudo, and gives the database a new OID (every `66668` pin re-pinned).
It is a separate owner decision, only for a fault that neither the application rollback nor the guarded reversal can address.

## 5. Commands for B1a-0 and B1a (replace packet 6 §5.4–§5.5 and `../run6/b1a/B1A-RUNBOOK.md` §1.3–§4)

Preflight: `../run6/b1a/B1A-RUNBOOK.md` §0 still applies, except that the runner hash line is replaced by the artifact check in §5.2.
**Order in the sitting:** §5.2 (artifacts onto production) → §5.1 (dump and BEFORE captures) → §5.4 or §5.5 (verification) → §5.3 (B1a)
→ remove the artifacts (§5.2) → S3. Transport as packet 6 §5 (Windows OpenSSH alias `afldb`, `bash -s` scripts with `set -euo pipefail`, as `arm`, Node v22.23.2 first on `PATH`,
`.env` sourced only inside a subshell and never echoed; `pgconn` from `B1A-RUNBOOK.md:20-22`).

### 5.1 B1a-0, both options: the fresh dump (as packet 6; prunes nothing)

`../run6/b1a/B1A-RUNBOOK.md` §1.2 exactly: `backup.sh --dir /home/arm/backups/afldb-b1a-<stamp> --keep 1000` into a new directory, one dump,
`.sha256` written and recorded, `pg_restore --list` names `afldb_prod`, the DB-free awk proof prints `not_applicable 669` and
`votes_non_null 0`. Then, still as `arm` with the read-only backup role, immediately (no writer may run, B1A-RUNBOOK §0):

```bash
( cd /home/arm/projects/afldb && set -a && . ./.env && set +a && pgconn AFLDB_BACKUP_DATABASE_URL && D=/home/arm/backups/afldb-b1a-<stamp>
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -d "$DSN" -f "$A/b1a0-parity.sql" > "$D/parity-prod.txt"
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -v db=afldb_prod -v oid=66668 \
    -v sysid=7674454702926115004 -d "$DSN" -f "$A/b1a-accept-r6r.sql" > "$D/accept-before-prod.txt"
  chmod 600 "$D"/*.txt; cat "$D/accept-before-prod.txt" )      # $A = the hash-verified artifact directory of §5.2
```
`accept-before-prod.txt` is **the BEFORE capture** (keep it: the reversal consumes `ids2026`, `inputs2026`, H1, H2, H3). Expected: `identity|afldb_prod|66668|7674454702926115004`,
`pss2026|not_applicable|669|0`, `ids2026|669|e5ead8dbf3baf9a7b647b0f55b04c496`, three `cov2026|…|pending|f|-|-`, `inputs2026|complete/0/9522/…/0`,
`na_cov|0|12`, `na_pss|669|…`. Any difference on these lines: STOP B1a (§4.2 then decides S3). For reference the 4 Nov snapshot reads
`inputs2026|complete/0/9522/draft:1/0`, H1 `097fd0b35e770ad7aac79b678f582f16`, H2 `a18697db41e9c25fd24d00e2095fa9ab`, H3 `3120|0c3d4ab4bf45dbec07b0ae94e103d532`;
production may legitimately differ on H1/H3 (other seasons, other statistics) without being a stop.

### 5.2 Artifacts onto production (untracked, hash-verified, removed before S3)

From a clone at `15aa89cb` on the workstation, Claude copies the three `b1a/` files and `b1a0/b1a0-parity.sql` to a new directory
`A=/home/arm/b1a-r6r-<stamp>` (mode 700) on production, then:

```bash
( cd "$A" && sha256sum -c - <<'EOF'
bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c  b1a-repair-2026-r6r.mts
dc6211d7826d03712ab95a872889a562b86c5a86b72a4fc717431005b5033ec7  b1a-accept-r6r.sql
e8343ae635288781ff2e5b2957cafa40287f0bfce6dc77f1b87f555c2cd616f3  b1a-reverse-r6r.sql
7c2a7be0eca0ed1f7024ccc6197b333818caadb7727f2f3be49ae97eb70fcf5d  b1a0-parity.sql
EOF
)
cd /home/arm/projects/afldb && REL=docs/v2/evidence/remediation-20261114/run6r/b1a
[ "$(git rev-parse HEAD)" = a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5 ] && [ -z "$(git status --porcelain)" ] && [ ! -e "$REL" ]
mkdir -p "$REL" && install -m 0644 "$A/b1a-repair-2026-r6r.mts" "$A/b1a-accept-r6r.sql" "$REL/"    # the runner imports ../../../../../../src
```
After B1a (whatever its outcome): `rm -f "$REL"/b1a-repair-2026-r6r.mts "$REL"/b1a-accept-r6r.sql; rmdir -p "$REL" 2>/dev/null; git status --porcelain`
must print nothing **before S3**. `$A` stays (700) as the sitting's record.

### 5.3 B1a, the transaction

```bash
( cd /home/arm/projects/afldb && set -a && . ./.env && set +a
  M=docs/v2/evidence/remediation-20261114/run6r/b1a/b1a-repair-2026-r6r.mts
  P="--dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004 --expect-ids-md5 e5ead8dbf3baf9a7b647b0f55b04c496"
  node --import tsx "$M" $P;          echo "exit=$?"      # 1) dry run
  node --import tsx "$M" $P --commit; echo "exit=$?" )    # 2) separate call, only after 1) passed and the backup is verified
```
Pass for 1): a `LOCKED` line naming the seven tables; `BEFORE` with `"pss2026":"669 rows, not_applicable 669, pending 0, votes 0"`,
`"ids":"e5ead8dbf3baf9a7b647b0f55b04c496"`, coverage three `pending/unrecorded/-/-`, `"season":"complete"`, `"medalRows":0`,
`"publishedAuthority":0`, `"derivedStatus":"pending"`, **and its `fp2026NonStatus`, `fpOtherSeasons`, `fpStatAvailability` equal to H2, H1, H3
of the BEFORE capture**; `AFTER(in tx)` with `669 rows, not_applicable 0, pending 669, votes 0` and the same three fingerprints; `OUTCOME
DRY-RUN-PASS (rolled back)`, exit 0. Pass for 2): the same `BEFORE`/`AFTER`, `OUTCOME COMMITTED`, exit 0. Anything else: §4.2.
Then the acceptance AFTER (same command as §5.1, to `accept-after-prod.txt`) and `diff` against the BEFORE capture: **exactly** `pss2026`
`not_applicable|669|0` → `pending|669|0` and `na_pss` `669|n` → `0|n` change; every other line identical (as in the rehearsal).

### 5.4 B1a-0 verification, option A (preferred): fresh disposable restore on `streamanator`

After §5.1, Claude copies the dump, its `.sha256`, `parity-prod.txt` and `accept-before-prod.txt` from production to a new workstation
staging directory `D:\tmp\afldb-b1a0-<stamp>\`, checks the sha256, copies them to a new directory `W=/mnt/ssd/afldb-b1a0-<stamp>` (mode 700)
on the DEV host, checks the sha256 there, then **deletes the workstation staging copy**. The two `b1a0/` files and the `b1a/` runner and
acceptance files go to `$W/art/{b1a0,b1a}/` from the `15aa89cb` clone, hash-checked against §3. Then on the DEV host:

```bash
PORT=61432 bash "$W/art/b1a0/b1a0-dev-restore-verify.sh" "$W/afldb_prod-<stamp>.dump" <sha256> <bytes> "$W" e5ead8dbf3baf9a7b647b0f55b04c496
```
It initialises a **brand-new** isolated cluster (`/mnt/ssd/afldb-b1a0-verify-<stamp>-pg`, loopback port 61432, outside the host's ephemeral
range 32768–60999, generated credentials), restores the dump with `pg_restore` (must exit 0 with **no** stderr line), and passes only if:
the nine parity aggregates equal `parity-prod.txt`; the acceptance probe on the restored copy equals production's BEFORE capture on every line
except `identity` (the exact 669 ids, every other season's rows, all coverage, inputs); and the runner's dry run on the copy prints
`DRY-RUN-PASS`. Pass: `VERDICT PASS`, exit 0. It stops the cluster and deletes nothing: the DEV dump copy and the stopped cluster (both hold
production data, including auth tables) stay mode 700 until the owner decides their removal. **Nothing is written on the production
cluster beyond the dump file.** Rehearsed with the 4 Nov production dump (restore 7 s; `rehearsal/raw/opta2.txt`). Budget: 15 minutes.
A FAIL or STOP: B1a does not run (§4.2).

### 5.5 B1a-0 verification, option B: `restore-test.sh` on the production cluster (destructive; separate approval)

`bash tools/maintenance/restore-test.sh <the §5.1 dump>` (C′ version; always with the dump path) as in `../run6/b1a/B1A-RUNBOOK.md` §1.3–§1.4.
**This is not read-only.** On the production cluster, as the owner role, it clears the comment of `afldb_restore_test`, drops every table in
it, reloads it from the dump (`pg_restore --jobs=4`, about 0.6 GB of writes plus WAL and CPU on the 3.9 GB host serving the site), and on
success **replaces the database comment marker** with `afldb.restore_test.v1 sha256=<new dump>`. That marker is what
`db:promotion:check --phase freeze-dump` reads (`tools/db/promotion-freeze.ts:725`, `tools/db/promotion-check.ts:3685-3694`): any procedure
relying on the current marker's dump stops verifying. A failure part-way leaves `afldb_restore_test` partly loaded with no marker
(fail-safe for the checker, but the previous proof is gone). It reads `afldb_prod` with the nine parity SELECTs and writes nothing there. It
has never run on production. Its proof of the 2026 rows is weaker than option A's: counts from the awk extract, not row fingerprints. Pass:
9 × PASS, "Restore verified: the backup is proven.", exit 0.

## 6. Packet 6 checksum exceptions, re-verified with the established path-aware checker

Checker: `run4/evidence/verify-manifests.sh` (sha256 `78443813…7b6d`, map `29a96e86…946e4c`), exact path resolution, no basename fallback;
self-test 33 passed, 0 failed; fresh clone, clean tree, real read-only host round. Outputs: `checksums/`.

| Revision | Manifests | Entries | COMMITTED-OK | COMMITTED-OK-ALIAS | HOST-OK | DECLARED-NOT-RETAINED | COMMITTED-MISMATCH | HOST-MISMATCH | AMBIGUOUS | HOST-MISSING | UNRESOLVED |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `9a68ad52` (packet 6) | 72 | 5,739 | 3,773 | 15 | 1,855 | 96 | **0** | **0** | **0** | 0 | **0** |
| `15aa89cb` (6R artifacts) | 73 | 5,760 | 3,794 | 15 | 1,855 | 96 | **0** | **0** | **0** | 0 | **0** |

Packet 6 §1 listed 13 entries that "differ". Under the path-aware checker **none is a current-artifact mismatch**; each is a preserved
historical or redacted-original hash, verified against the object it actually names:

| Packet 6's entries | Checker class | What the hash proves |
|---|---|---|
| 4 pre-redaction host originals, `run2/ops/raw/SHA256SUMS-originals.txt:10-13` | COMMITTED-OK-ALIAS (`bom-crlf` transform, `manifest-map.tsv` L61–L64, `run2/ops/README.md:146`) | the original bytes (UTF-8 BOM + CRLF) recomputed from the committed LF copy match the recorded original hash; the original hash is preserved, the committed copy is the redacted/normalised one |
| 1 host log, `run2/qualification-2/SHA256SUMS` | HOST-OK | the host original still hashes as recorded (the committed copy is verified separately in the same manifest) |
| 7 entries of `run3/integ/evidence/brownlow/fixture-root.files.sha256` | HOST-OK (258/258 for that manifest) | they name files of an extracted host fixture tree; packet 6's ad-hoc basename fallback had compared them with unrelated repository files of the same name |
| 1 pin of `tests/integration/club-comparison.test.ts`, `run4/clubcmp/evidence/c1_test-sha256.txt:1` | HOST-OK (`/mnt/ssd/afldb-rem4-clubcmp-20261115/cand/…`) | a historical pin of the file at `a1571ee5`, verified against the retained host checkout; later commits changed the file, which is expected and not a mismatch |

Actual current-artifact mismatches (COMMITTED-MISMATCH, HOST-MISMATCH, AMBIGUOUS): **0**. Packet 6's ad-hoc method is retired; use this checker.

### 6.1 At the 6R artifact commit
Fresh clone detached at `15aa89cb`, porcelain 0, `REQUIRE_NO_UNRESOLVED=1`: rc 0, `# RESULT exit=0`. The new manifest `run6r/SHA256SUMS`: **21/21 COMMITTED-OK**; every other count equals `9a68ad52`'s (the 21 new entries are the only difference). Outputs: `checksums/verify-at-15aa89cb.tsv`, `.summary.txt` (added with this packet, so not listed in `SHA256SUMS`).

## 7. Residual risks (all fail-safe)

- **The 2026 id-set pin comes from the 4 Nov snapshot**, not from production (B0 read counts, not ids). If production's 669 rows are a
  different set, the runner refuses and B1a stops; a new approval would be needed. This is intended: the approval names exact rows.
- The runner cannot see writes to tables it does not lock; none of them feeds the 2026 player-season status or the derivation.
- The artifacts are not on `origin/main`; their integrity in the sitting rests on the sha256 checks of §5.2 and §5.4.
- Option A moves a production dump (auth tables included) to the DEV host, which already holds the 4 Nov production dump under the same
  precedent; the copy is retained 700 until the owner decides. Option B writes on the production cluster (§5.5).
- `brownlow_status` defaults to `not_applicable`: a path that inserts 2026 player-season rows without the recompute could re-create the
  defect (packet 6 §10; unchanged).

## 8. Records

Local commits on `claude/remediation-20261114`, unpushed: `9a68ad52` (packet 6), `15aa89cb` (6R artifacts and evidence), and the commit
adding this packet and the tracker updates. Publishing them is a separate records-only approval and is **not needed for the sitting** (the
artifacts travel by hash). Host: workspace `/mnt/ssd/afldb-rem6r-b1a-20261116` (rehearsal inputs and outputs), rehearsal clusters
`/mnt/ssd/afldb-b1a0-verify-rehearsal*-pg` (stopped), run-4 cluster stopped again, every disposable database dropped.

## 9. Approvals (only the window and the backup-verification choice are open)

> **Approval B1:** "I approve releasing `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5` to production on ________ (date) starting ________ AEDT
> (a weekday, start between 08:00 and 14:00; book 2 h 30 min) per packet 6 §5.1–§5.3 and `run6/b1/B1-RUNBOOK.md` S1–S10, with packet 6R §4
> governing the order and failure handling: fast-forward of the serving checkout to `a2e6ea99`; `release.mjs build --typecheck off-host` with
> the evidence text 'npm run typecheck rc 0 on Linux (DEV streamanator, node v22.23.2) at f6af6da9 (run5/T2-QUALIFICATION.md section 2);
> C-prime a2e6ea99 = f6af6da9 + records-only'; `host-gate` (not `--strict`); `promote --attended`; my own `sudo systemctl restart afldb`; the
> release checks S7–S10; and, if a packet 6R §4.3 trigger fires, application rollback to `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` with my
> restart. A release failure never triggers a database reversal or restore. Commands other than mine run by Claude over Windows OpenSSH.
> Stop if S1 reads anything other than B0, or if §4.2 finds the 2026 state unexplained."

> **Approval B1a-0:** "In the same sitting, after S2 and before S3, I approve a fresh `afldb_prod` dump with `backup.sh --dir
> /home/arm/backups/afldb-b1a-<stamp> --keep 1000` (prunes nothing), its sha256 and header check, and the read-only parity and acceptance
> BEFORE captures of packet 6R §5.1, verified by **option ___** :
> **[A]** packet 6R §5.4: copy the dump and the two captures via `D:\tmp\afldb-b1a0-<stamp>\` (deleted once the DEV copy's sha256 matches)
> to `/mnt/ssd/afldb-b1a0-<stamp>` on streamanator, restore it into a brand-new isolated cluster with `b1a0-dev-restore-verify.sh` (sha256
> `3ec8fd20…67cf`), pass only on `VERDICT PASS`; the DEV copy and the stopped cluster are retained (700) until I decide; nothing written on
> the production cluster beyond the dump file; or
> **[B]** packet 6R §5.5: `restore-test.sh <that dump>` on the production cluster, which drops and reloads every table of
> `afldb_restore_test` and **replaces its `afldb.restore_test.v1` marker** (the one `db:promotion:check --phase freeze-dump` reads); I accept
> that this is a destructive write on the production cluster and that the previous marker's proof is lost.
> If the verification fails or stops, B1a does not run."

> **Approval B1a:** "After B1a-0 passes and before S3, I approve the ISSUE-365 repair of season 2026 per packet 6R §5.2–§5.3: the runner
> `run6r/b1a/b1a-repair-2026-r6r.mts` at sha256 `bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c` (commit `15aa89cb`), copied
> untracked into the serving checkout and removed before S3, run as `AFLDB_IMPORT_DATABASE_URL` with `--expect-db afldb_prod --expect-oid 66668
> --expect-sysid 7674454702926115004 --expect-ids-md5 e5ead8dbf3baf9a7b647b0f55b04c496`, dry run first, then `--commit`. It changes only
> `player_season_stats.brownlow_status` of exactly those 669 2026 rows from `not_applicable` to `pending` (votes stay NULL), recomputes and
> writes no coverage, and commits only if every precondition and acceptance check in packet 6R §1.1 holds under its locks. I accept that 2026
> player pages will then read 'Not yet awarded' / 'The season is still in progress…' until D-365-W ships (packet 6 §8). If it does not end in
> COMMITTED, packet 6R §4.2 decides from a read-only acceptance probe whether it committed before anything else happens."

> **D-365-W** (unchanged, not part of this sitting): "Change the `pending` Brownlow wording to 'Brownlow Medal results for this season have
> not been loaded yet.' (and a matching cell label) in the next code change."

Not needed now: the guarded reversal (`b1a-reverse-r6r.sql`, sha256 `e8343ae6…16f3`; its own approval only if the repaired rows themselves
cause a fault, §4.3) and any whole-database restore (separate owner decision). B2–B7 unchanged from packet 5 §6; **B8 remains a separate
owner decision**.
