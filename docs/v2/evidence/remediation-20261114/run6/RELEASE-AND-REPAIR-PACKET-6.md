# Remediation 2026-11-14: release-and-repair packet 6 (B1, B1a-0, B1a). Supersedes packet 5 §3 B1, B1a and `../run5/b1a/README.md` §3, §5, §6

**Executed in run 6 (2026-11-16):** Approval A only, publication by fast-forward (§1). Everything else here is **preparation**: read-only
analysis of the published code and the run-5 records, by Claude plus three read-only preparation agents with separate scopes (release
procedure, B1a with backup and restore, public pages). **Not executed:** no SSH, database, production deployment, backup, repair, restart,
installation, configuration change or log deletion. No new production probe: production facts are B0's (2026-11-15 20:19 AEDT) and are
re-read at the start of the sitting (S1). Each approval in §9 is separate; silence is not approval. **B8 remains a separate owner decision.**

Appendices in this directory: `b1/B1-RUNBOOK.md` (the sitting's commands, code citations, discrepancies), `b1a/B1A-RUNBOOK.md` (backup,
restore verification, runner mapping, recovery), `b1a/b1a-accept.sql`, `b1a/b1a-reverse.sql`, `public/PUBLIC-CHECKS.md`. Where an appendix
differs from this packet, this packet governs.

## 1. Publication (Approval A): DONE, verified

| Check (owner's list) | Result |
|---|---|
| Candidate ref and SHA | `git rev-list -n 1 remediation-final-20261115-r5` = `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5`; annotated tag; branches `claude/remediation-final-20261115-r5` and `claude/remediation-20261114` at the same SHA; worktree clean |
| Complete publication delta | `de640826..a2e6ea99`: **172 commits, 0 merges**, single author; 4,298 paths (4,118 added, 179 modified, 1 renamed), 51.5 MB of added/modified blobs, largest 4.9 MB (`issues.md`). By area: 4,067 run evidence, 95 `tests/`, 54 `src/`, 20 `tools/`, 18 `deploy/`, 5 `packages/`, config (`package.json`, `next.config.ts`, `vitest.config.mts`, `eslint.config.mjs`, `.gitattributes`), `.env.example` (comment-only `AFLDB_COMPARE_*` lines), trackers. 461 binaries (410 `.gz`, 50 `.png`, 1 `.tgz`). Secret scan of every added text line and of the decompressed content of all 411 compressed files: only test fixtures and placeholders (`test:test`, `hunter2` in `tests/db-test-rebuild.test.ts` redaction tests, `<pw>`, `<redacted>`, `s3cret-pw`/`pw2`/`pw3` in DSN-shape tests). Note: packet 5 §5 row A says "171 commits"; §2 and the tag say 172; **172 is correct**. |
| Committed evidence checksums | 67 manifests in the delta, checked against the committed bytes (LF worktree = blobs): **3,779 entries match**; 1,749 name host-side files that are not in the repository (by design); **13 differ, all explained**: 4 pre-redaction host originals whose committed LF/BOM-stripped copies verify 24/24 (`run2/ops/README.md:146`); 1 host log whose committed copy verifies in `run2/qualification-2/SHA256SUMS`; 7 entries of `run3/integ/evidence/brownlow/fixture-root.files.sha256`, which hashes an extracted host fixture tarball (recorded 258/258 HOST-OK, `run4/evidence/README.md:170`) and was falsely matched by my path fallback to repository files of the same name; 1 pin of `tests/integration/club-comparison.test.ts` at `a1571ee5` (it matches that commit exactly; later run-4 commits changed the file). `run5/SHA256SUMS`: 15/15. |
| Qualification applies to the executable revision | `git diff --name-only f6af6da9 a2e6ea99` = `CHANGELOG.md`, `IssuesIndex.md`, `blockers.md`, `issues.md` and 15 files under `run5/` (records; the B1a runner is excluded from typecheck and lint by `tsconfig.json:44` and `eslint.config.mjs:83`). `git diff --name-only 16027092 f6af6da9` outside evidence = the T-2 test file plus the four trackers. Run 4 qualified Q‴ `16027092` (`../run4/QUALIFICATION-4.md:13`); run 5 qualified Q⁗ `f6af6da9` on the affected scope (`../run5/T2-QUALIFICATION.md` §2: typecheck rc 0, lint gate 338/43 = the ratchet, per-file and shared runs). |
| `origin/main` still the expected base | `git fetch` then `git ls-remote origin refs/heads/main` = `de640826d13489c58392563e7ae1ff62403ed293`, re-read immediately before the push |
| Push | `git push origin a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5:refs/heads/main`: `de640826..a2e6ea99  -> main`, rc 0, no force; tags not pushed |
| Remote after | `git ls-remote origin refs/heads/main` = **`a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5`** |

Lint is a ratchet allowing 338 existing errors in 43 files, not clean lint. Classified integration failures remain failures
(`../run4/FAILURE-LEDGER-4.md`). Publication waives no operational decision.

## 2. Identities

| | Value |
|---|---|
| Published revision (C′) | `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5` = `origin/main` |
| Executable revision | `f6af6da93551aed9dbd5658319346d7ecdd96ea3` (everything after it is records-only) |
| Serving now (B0) = **rollback target** | `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (revision `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`) |
| `previous` now (B0) | `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN` (stays under `releases/` after promote; nothing deletes it) |
| New release id | **`a2e6ea9995a4-<BUILD_ID>`**: first 12 hex of the revision, `-`, the build's BUILD_ID (`deploy/release.mjs:83-87`); known only from the build's `release: RELEASE READY <id>` line (`:1157`) |
| After promote | `current` = `a2e6ea9995a4-…`, `previous` = `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (`:1335-1336`); `rollback --attended` targets `previous` by default (`:1363`) |
| Database | `afldb_prod`, OID 66668, system identifier `7674454702926115004`, ledger 118 (`118_fixtures_unconfirmed_participants.sql`); C′ has no migration and an unchanged `package-lock.json` |

## 3. Proposed window

**Wednesday 18 November 2026, 10:00–12:30 AEDT** (alternative: Thursday 19 November, same hours). Any weekday block of 2 h 30 min that
starts between 08:00 and 14:00 AEDT satisfies the rules below; the final choice is the owner's.

- Clear of the nightly settle (`afldb-settle-afl-api.timer` 05:00 + up to 15 min, runs from the serving checkout; off-season a 2-second
  no-op) and of `apt-daily-upgrade` (06:00 + up to 60 min; without B4 its needrestart restarts `afldb` and PostgreSQL). At 10:00 the next
  `apt-daily-upgrade` is about 20 h away, so `host-gate`'s 90-minute look-ahead (`release.mjs:284-286`) does not bite; S1 confirms that its
  LAST run is today. Clear of midnight logrotate. `apt-daily` (downloads) can start at any hour: the gate then refuses; wait and re-run it.
- `host-gate` has **no time-of-day rule** (`release.mjs:273-303`).

## 4. The sitting: order and time budget

**Order change from packet 5 (recommended):** B1a-0 and B1a run **after S2 (serving checkout fast-forwarded to C′) and before S3 (build)**.
Reason: `release.mjs build` runs `next build` against the production database and prerenders every season page and the 500 most-viewed
player pages (`release.mjs:1073-1083`; `src/app/players/[slug]/page.tsx:55,71`). Built before the repair, the new release would ship
"No medal" entries for up to an hour; built after it, the release ships repaired pages and the page checks can run in the sitting.
B1a does not depend on the release in service: the runner runs from the checkout (C′ after S2), `recomputeSeasonBrownlowStatus` is
unchanged since `c1c4b22e` (`player-derived.ts:379-400`), and the Brownlow wording (`src/lib/format.ts:41-58`) is identical in both
releases (`git diff c1c4b22e a2e6ea99 -- src/lib/format.ts` touches only `parseEntitySlug`). The backup then doubles as the pre-release
restore point. If the owner prefers packet 5's order (B1a after B1), use the 75-minute allowance in `public/PUBLIC-CHECKS.md` §3.

| Step | Who | Budget |
|---|---|---|
| S1 read-only pre-checks (pins, links, checkout clean, `release.mjs status`, `verify` rollback target, settle inactive, apt idle, timers, memory ≥ 2,100 MB, disk ≥ 6 GB, port 3199 free, beta gate/epoch lines) | Claude | 10 min |
| S2 `git fetch` + `git merge --ff-only a2e6ea99` in the serving checkout; C′ tool `status`; `check-node-modules` | Claude | 5 min |
| **B1a-0** fresh dump to a new directory, sha256, `pg_restore --list`, pre-repair row proof, `restore-test.sh <dump>` | Claude | 15 min |
| **B1a** preflight, acceptance BEFORE capture, dry run, commit, acceptance AFTER, compare | Claude | 15 min |
| S3 `release.mjs build` (4 min 27 s – 4 min 51 s measured) | Claude | 15 min |
| S4 `host-gate`, S5 `promote --attended`, **S6 owner restart**, S7 `status --expect`, S8 `post-install-check.sh` (+ owner journal lines), S9 public smoke, **S9b player-page checks** | Claude / **owner** | 35 min |
| Rollback reserve | Claude / **owner** | 15 min |
| S10 observation (health, restarts, one ISR page, final `status`) | Claude | 30 min |
| **Total** | | **2 h 20 min; book 2 h 30 min** |

Owner presence is needed from S5 (promote opens the activation window: any restart activates C′) to the end of S8, and for any rollback.
If B1a-0 or B1a is not approved, or stops, skip it: S3 onward is unaffected (B1 alone repairs nothing; ISSUE-365 stays as B0 found it).

## 5. Commands and checks

Full commands with pass criteria and stop conditions: `b1/B1-RUNBOOK.md` §2 (S1–S10) and `b1a/B1A-RUNBOOK.md` §0–§3. Transport: Claude
over Windows OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe afldb bash -s`, one script per call, `set -euo pipefail`), as `arm`, with the unit's
Node `/home/arm/.nvm/versions/node/v22.23.2/bin` first on `PATH`. `.env` is sourced only inside a `( … )` subshell, never echoed.

### 5.1 B1 corrections to packet 5 (verified in code)

- **The build command in packet 5 fails as written.** `build` requires `--checkout` and `--afldb-env` (`release.mjs:1005,1007`). Use:
  `node deploy/release.mjs build --checkout /home/arm/projects/afldb --revision a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5 --afldb-env production --typecheck off-host --typecheck-evidence "<text, §9 B1>" --smoke-paths /players,/clubs,/seasons,/draft`
  in a detached `tmux` session with its exit code appended to the log.
- **`--typecheck off-host` is needed.** The default in-build typecheck requires MemAvailable ≥ 3,200 MB (`release.mjs:60,1026-1031`);
  production has shown about 2,950 MB of 3,915 MB, and both measured builds used off-host. Off-host requires evidence text recorded in
  `release.json` (`:1010-1012,1143`): `npm run typecheck` rc 0 at `f6af6da9` on the DEV host, Node v22.23.2 (`../run5/T2-QUALIFICATION.md`
  §2, `../run5/host-scripts/t2-qual.sh:8,70`); C′ differs from `f6af6da9` by records only, and the records path is excluded from typecheck.
  **The owner accepts that text as part of Approval B1.**
- **S2 must precede `host-gate` and `promote`.** The serving revision's `release.mjs` has no `host-gate` and no `--attended` flag
  (`c1c4b22e:deploy/release.mjs:1295`). Run plain `host-gate`, not `--strict` (it refuses on the missing B4 hold, `:294-297`); expect two
  warnings (reboot pending, hold missing).
- **Rollback should carry `--checkout`** so the ledger head is derived from Git (`c1c4b22e`'s `release.json` has no `migrationHead`, `:1371`).
- `post-install-check.sh` runs `status --expect` itself (a second `status-pass` line, harmless). `arm` normally cannot read the journal; the
  checker then prints `UNVERIFIED journal` and the two owner commands below.

### 5.2 Owner commands (sudo, owner only)

```bash
sudo systemctl restart afldb                                   # S6, once, right after "PROMOTED a2e6ea9995a4-…"
# only if the unit is not active and Result=start-limit-hit:
sudo systemctl reset-failed afldb && sudo systemctl start afldb
# only if post-install-check prints UNVERIFIED journal (it prints the exact --since value):
sudo journalctl -u afldb --since "<ActiveEnterTimestamp>" -o cat | grep -E '\[afldb\] (primary|serving build)'   # must name the new BUILD_ID and release
sudo journalctl -u afldb --since "<ActiveEnterTimestamp>" -o cat | grep -ciE 'error|fatal|unhandled'               # must print 0
# rollback (§6.1), after Claude's `rollback --attended --checkout …`:
sudo systemctl restart afldb
```

### 5.3 Release checks (pass = all)

S7 `status --expect a2e6ea9995a4-<BUILD_ID>` → `STATUS PASS` (process in the new release, health 200 ok/ok, new `_buildManifest.js` 200,
old BUILD_ID 404, restart noted, no apt coincidence). S8 `post-install-check.sh a2e6ea9995a4-<BUILD_ID>` → `POST-INSTALL CHECK PASS` (loopback
and `https://beta.afldb.com` health and manifest, previous BUILD_ID 404 or CACHE note, 10 pages 200 after redirects, every referenced JS/CSS
200 and byte-identical, `POST /api/admin/email-intake` 410, journal or owner lines). S9 public smoke, no cookie: `/api/health` 200 ok/ok;
`/` 307 → `/beta`; `/players` 307 → `/beta?from=%2Fplayers`; `/beta` 200 (the `X-Robots-Tag: noindex, nofollow` header comes from the installed Caddyfile, which was not compared: record it, do not gate on it); `/admin/operations` 307 →
`/admin/login`; new `_buildManifest.js` 200. A 503 "Beta gate is on but …" is a rollback trigger. S9b: §7.

### 5.4 B1a-0: fresh backup and restore verification (separate approval)

```bash
( cd /home/arm/projects/afldb
  D=/home/arm/backups/afldb-b1a-$(date +%Y%m%d-%H%M%S); test ! -e "$D" || exit 1
  bash tools/maintenance/backup.sh --dir "$D" --keep 1000          # never bare: bare prunes ~/backups/afldb to 7 (backup.sh:40-41,123-127)
  F=$(ls -1 "$D"/afldb_prod-*.dump); [ "$(ls -1 "$D"/*.dump | wc -l)" = 1 ]
  (cd "$D" && sha256sum "$(basename "$F")" > "$(basename "$F").sha256" && cat ./*.sha256)   # record the hash in the sitting log
  pg_restore --list "$F" | grep -E 'dbname: afldb_prod'             # must match
  # pre-repair proof from the dump itself (no database): expect "not_applicable 669" and "votes_non_null 0"
  # (awk extract: b1a/B1A-RUNBOOK.md §1.2)
  bash tools/maintenance/restore-test.sh "$F"; echo "exit=$?" )     # always pass the dump path; bare picks the newest dump elsewhere
```

- Dump: `pg_dump -Fc` as the read-only `afldb_backup` role (`AFLDB_BACKUP_DATABASE_URL`), about 30 MB, ACCESS SHARE locks only, written as
  `.partial` and renamed after `pg_restore --list` reads it; directory 700, file 600. Prunes nothing (new directory, `--keep 1000`).
- Restore verification (`restore-test.sh` at C′): restores into **`afldb_restore_test` on the production cluster** as the owner role, with
  an identity guard on every write: drops all its tables, `pg_restore --jobs=4`, then **replaces its database comment marker** with the new
  dump's sha256 (the marker `db:promotion:check --phase freeze-dump` reads). Reads `afldb_prod` with 9 aggregate parity SELECTs; writes
  nothing there. Pass: 9 × PASS, "Restore verified: the backup is proven.", exit 0. Never measured on production (17 s on the rehearsal
  host); brief CPU/IO load, off-peak. A parity miss caused by a concurrent write fails safe: re-run once, then stop.
- Stop B1a (not B1) if any step fails.

### 5.5 B1a: the transaction

```bash
( cd /home/arm/projects/afldb && set -a && . ./.env && set +a
  M=docs/v2/evidence/remediation-20261114/run5/b1a/b1a-repair-2026.mts      # sha256 8453572e796f16fbe5f7900404e021bff62f13d764ac35197f1ceedb5fd7a27c
  A="--dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004 --expect-rows 669"
  node --import tsx "$M" $A;          echo "exit=$?"     # 1) dry run
  node --import tsx "$M" $A --commit; echo "exit=$?" )   # 2) separate call, only after 1) and the BEFORE capture
```

**Preconditions** (operator-checked unless marked *runner*): Approvals B1a-0 and B1a given; S2 done (checkout HEAD = C′, clean; runner hash
as above; `node_modules/tsx` and `node_modules/postgres` present); B1a-0 passed in this sitting; `afldb-settle-afl-api.service` inactive and
no writer (`pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore'` empty); the acceptance BEFORE capture taken and equal to B0 (below).
*Runner, inside the transaction:* identity `afldb_prod`/66668/sysid and read-write session; 2026 `complete`; exactly 3 coverage rows; 0
2026 medal rows; exactly 669 2026 player-season rows. The runner does **not** require the start state to be exactly 669 × `not_applicable`:
**the operator does**, by requiring the dry run's BEFORE line to be byte for byte:

```
BEFORE {"coverage":["brownlow_match_votes=pending","brownlow_round_votes=pending","brownlow_season_total=pending"],"pss":["not_applicable:669/votes:0"],"season":"complete","medalRows":0,"roundRows":9522,"naOutside":0,"naWar":12}
AFTER(in tx) {"coverage":["brownlow_match_votes=pending","brownlow_round_votes=pending","brownlow_season_total=pending"],"pss":["pending:669/votes:0"],"season":"complete","medalRows":0,"roundRows":9522,"naOutside":0,"naWar":12}
OUTCOME DRY-RUN-PASS (rolled back)        (run 2: same BEFORE/AFTER, then OUTCOME COMMITTED)
```

**Effect (expected 669 rows):** one statement, `recomputeSeasonBrownlowStatus(tx, 2026)`: `UPDATE player_season_stats SET brownlow_status =
<derived>, brownlow_votes = <derived> WHERE season = 2026`; with coverage `pending` and no medal rows every row derives `pending`, votes
NULL. 669 rows `not_applicable` → `pending`; votes NULL → NULL. Nothing else is written: not `stat_availability` (the coverage recompute
runs only if a 2026 coverage row reads `not_applicable`; none does), not `brownlow_*`, `data_edits`, `data_overrides`, any other season.
`lock_timeout 5s`, `statement_timeout 120s`; seconds. In-transaction assertions: coverage still pending/unrecorded; 2026 rows one status,
`pending`, 669, 0 votes; 0 `not_applicable` coverage rows ≥ 1924 outside 1942–45 and 12 inside; other seasons' player-season and coverage
fingerprints unchanged. Commits only if all hold. **Decide on the OUTCOME line, not the exit code:** `NOTHING-TO-REPAIR` exits 0 but on
the commit run means someone changed the rows: stop and investigate.

**Acceptance** (`b1a/b1a-accept.sql`, read-only role, REPEATABLE READ READ ONLY, identity assertion), BEFORE the commit and AFTER:

| Line | BEFORE (= B0) | AFTER |
|---|---|---|
| `pss2026` | `not_applicable|669|0` | **`pending|669|0`**, one line |
| `cov2026` | 3 × `pending|f|-|-` | identical |
| `inputs2026` | `complete/0/9522/<entry-state>/<n>` | identical |
| `fp_pss_other`, `fp_pss2026_nonbrownlow`, `fp_sa_except_2026_brownlow` | H1, H2, H3 | **identical** |
| `na_cov` | `0|12` | `0|12` |
| `na_pss` | `669|9553` | **`0|9553`** |

Keep the BEFORE output: the reversal consumes `inputs2026`, H1 and H2. Then continue with S3.

## 6. Recovery

### 6.1 Release (B1)
Triggers: unit not active after one reset; S7 FAIL not explained by an owner-confirmed restart; S8 FAIL other than CACHE / unverified journal;
S9 5xx or the 503 gate message; journal errors; crash restarts during S10. Any stop before S5 needs no recovery (links untouched).
`node deploy/release.mjs rollback --attended --checkout /home/arm/projects/afldb` (Claude) → owner `sudo systemctl restart afldb` →
`status --expect c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` → `post-install-check.sh c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`. The serving checkout
**stays at C′** (the rollback, gate and audit commands exist only in C′'s tool; moving back is a non-fast-forward Git write and a separate
owner decision). Consequence: the 05:00 settle runs C′'s wrapper against an unchanged schema (off-season no-op). A release rollback does not
touch B1a: the repaired rows stay, and `c1c4b22e` renders them with the same wording (its cached pages converge within an hour).

### 6.2 B1a: guarded reversal (`b1a/b1a-reverse.sql`, needs its own owner approval at the time)
Reverses **only if the rows still match the repaired state exactly**: identity; 2026 rows 669 × `pending`, 0 votes; 0 medal rows; the three
coverage rows pending/unrecorded; `inputs2026` and the H1/H2 fingerprints equal to the BEFORE capture. It locks `player_season_stats` and
`stat_availability` against other writers, updates `pending` → `not_applicable` WHERE season 2026 AND `pending` AND votes NULL, requires
exactly 669 rows (`GET DIAGNOSTICS`), re-checks the post-state, and only then commits; any failed guard rolls everything back.
**Do not use it** when any guard would fail; when a medal, round votes, a vote-entry decision or a publication was loaded; when a release,
settle or admin action has recomputed 2026 since; or when the dry run's BEFORE line was not exactly `not_applicable:669/votes:0`. It
re-introduces the ISSUE-365 defect, so use it only if the repair itself is shown to cause a fault. Otherwise: stop, keep the current
state, take a fresh B1a-0-style dump and plan a targeted fix as a new approval.

### 6.3 Backstop: the B1a-0 dump (separate owner approval, needs sudo)
`docs/backup-restore.md` procedure A: restore into a new database, privileges, verify, rename-swap. Discards every write since the dump
(sessions, audit, admin edits); downtime; the database gets a **new OID**, so every `66668` pin must be re-pinned. For a B1a-only fault,
§6.2 is far narrower.

### 6.4 Runner failure mid-way
Everything runs in one `sql.begin` (runner `:62-103`): any error rolls back; a killed process or dropped SSH session leaves the server to
roll back. If the connection drops **during COMMIT** (`OUTCOME ERROR`), re-run the acceptance SQL: `pss2026` is either `not_applicable|669|0`
(not committed) or `pending|669|0` (committed). No partial state is possible (one UPDATE).

## 7. Post-repair public-page checks and cache refresh

Only one public surface changes: the **2026 row of each 2026 player's season table** on `/players/[slug]`, BV cell and its tooltip
(`src/app/players/[slug]/page.tsx:612-613`, data `src/db/queries/players.ts:622`). `/seasons/2026` ("No votes recorded for 2026"),
`/brownlow/2026` (404), `/brownlow`, clubs, compare, records, matches, NL search, Grid Solver, sitemap and metadata read the medal or vote
tables, which B1a does not touch, and render identically before and after.

**Checks (S9b, in the sitting, because B1a precedes the build):** on the host, loopback `http://127.0.0.1:<PORT from .env>` with a
15-minute beta claim cookie minted from `.env` (as `release.mjs:772-780` does), removed afterwards. Players: confirm with one read-only
query (`public/PUBLIC-CHECKS.md` §4) the paths of 3 2026 players with no pre-1924 or 1942–45 seasons (candidates from earlier production
evidence: `scott-pendlebury-11724`, `nick-daicos-9910`, `matt-rowell-9235`, `toby-greene-12446`, `ollie-wines-10130`) plus one 2026
debutant. 16 fresh connections per URL (they rotate across the workers; production documents `AFLDB_WORKERS=2`, S1 reads the real value).
Pass: every sample 200 with "Not yet awarded" and "still in progress; the Brownlow Medal has not been awarded" present and "No medal" /
"No Brownlow Medal was awarded for this season" absent; anonymous request 307 → `/beta?from=…`; `/seasons/2026` 200 with "No votes recorded
for"; `/brownlow/2026` 404. The owner may also view one page in their own admitted browser.

**Cache-refresh allowance.** `/players/[slug]` is ISR with `revalidate = 3600`; each worker keeps its own memory layer over the release's
on-disk entries; staleness is judged from the entry's file time, so a restart does not refresh a recent entry. With packet 6's order the new
release's entries are built after the commit, so **no allowance is needed** for the new release. An allowance of **75 minutes after the
B1a commit** (3,600 s plus margin; one request to trigger regeneration and one to see it, per worker) applies only (a) in packet 5's order,
or (b) after a rollback to `c1c4b22e`, whose old entries regenerate on first request. Stale beyond that: check the on-disk entry's time
(read-only); written after the commit but still "No medal" means data, not cache: re-run the acceptance SQL and stop; one worker stale for
more than 2 hours goes to the owner (a restart is the owner's action). No on-demand revalidation route is recommended (the existing ones act
on one worker or on season pages only).

## 8. The pending wording (decide before approving B1a)

Repairing the statuses alone changes what visitors read on every 2026 player's page, 2026 row:

| | BV cell | Tooltip |
|---|---|---|
| **Today** (`not_applicable`) | "No medal" | "No Brownlow Medal was awarded for this season." |
| **After B1a, without D-365-W** (`pending`) | "Not yet awarded" | "The season is still in progress; the Brownlow Medal has not been awarded." |
| After D-365-W (later code change and release) | (wording to match) | "Brownlow Medal results for this season have not been loaded yet." |

After B1a the page will say the medal is **still to come and the season still in progress**. That is **still incorrect**: 2026 is
`complete` (the same row shows no "In progress" badge, so the tooltip contradicts its own row), and the 2026 medal has been awarded;
AFLDB simply has not loaded the result. It is less misleading than today's text, which states that no medal exists, putting 2026 alongside
the war years. No number is shown in either state, sorting is unchanged, and no other page changes.

Options: (1) **approve B1a in this sitting and D-365-W for the next code change** (recommended: removes the false "no medal" statement now,
needs no further data step when D-365-W ships, and the guarded reversal stays available); (2) defer B1a until D-365-W is released, keeping
"No medal" until then, then go straight to the correct sentence; (3) implement D-365-W first (a code change at `src/lib/format.ts:42,56`
plus qualification and a new publication approval) and release it in place of C′, which delays B1.

## 9. Approvals needed now

> **Approval B1:** "I approve releasing `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5` to production on ________ (date) starting ________ AEDT
> (08:00–14:00; proposed Wed 18 Nov 10:00) per packet 6: fast-forward of the serving checkout, `release.mjs build --typecheck off-host`
> with the evidence text 'npm run typecheck rc 0 at f6af6da9 on the DEV host, Node v22.23.2 (run5/T2-QUALIFICATION.md §2); a2e6ea99 =
> f6af6da9 plus records only', `host-gate`, `promote --attended`, my own `sudo systemctl restart afldb`, the release checks, and rollback to
> `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` with my restart if a trigger fires; commands other than mine run by Claude over Windows OpenSSH;
> stop if S1 reads anything other than B0."

> **Approval B1a-0:** "I approve, in the same sitting, a fresh `afldb_prod` dump with `backup.sh --dir <new directory> --keep 1000` (no
> pruning) and its verification by `restore-test.sh <that dump>`, which drops and reloads `afldb_restore_test` on the production cluster and
> replaces its marker; nothing written to `afldb_prod`."

> **Approval B1a:** "I approve the ISSUE-365 repair of season 2026 per packet 6 §5.5 (669 rows `not_applicable` → `pending`, nothing else)
> after B1a-0 passes and before the build, accepting that 2026 player pages will then read 'Not yet awarded' / 'The season is still in
> progress…' until D-365-W ships; stop if any precondition or the BEFORE line differs from B0."

> **D-365-W:** "Change the `pending` Brownlow wording to 'Brownlow Medal results for this season have not been loaded yet.' (and a matching
> cell label) in the next code change." (Not part of this sitting.)

Not needed now: a reversal (§6.2) or restore (§6.3) approval unless a fault arises. B2–B7 are unchanged from packet 5 §6. **B8 remains a
separate owner decision**, to be taken after B7, even though its statement has no blanks.

## 10. Records and follow-ups

- **T-2 residue, recorded as a test-isolation follow-up (ISSUE-363):** `tests/integration/awards-reload-links.test.ts` restores only the
  `award_winners` rows and award spans it changes. After a shared-mode run the content of `award_nominations`, `hall_of_fame`,
  `honour_team_members` and `captaincies` still differs (row counts equal; cause not characterised) and `import_batches` grows. The file as
  a whole does **not** leave a shared database unchanged. The run-5 CHANGELOG line that said it "no longer leaves a real-data side effect"
  is corrected. Routine test maintenance; no production effect.
- **Corrections to run-5 records** (kept unchanged; superseded here): packet 5 §5 "171 commits" (172); packet 5 §3 build command (§5.1);
  `run5/b1a/README.md` §3 heading "each checked inside the transaction" (items 1–3 are operator checks), §5 (`/seasons/[year]` does not
  render the status; only `/players/[slug]` converges), §6 (the unguarded inverse UPDATE is replaced by §6.2), §2 (`.env` sourcing must be in
  a subshell).
- Tracker updates (2026-11-16): `CHANGELOG.md`, `issues.md` (ISSUE-363, ISSUE-365 and their Open Issues rows), `IssuesIndex.md`.
- Residual risks, all LOW and fail-safe: the C′ `restore-test.sh` has never run on production and its strict DSN contract may refuse before
  writing; the runner's OID/sysid checks depend on the flags being passed (the command line above passes them); the runner's
  in-transaction fingerprints are aggregate (the acceptance SQL adds row-level ones); the `brownlow_status` column default is
  `not_applicable`, so a path that inserts 2026 player-season rows without the recompute would re-create the defect.
