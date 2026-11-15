# B1 runbook: release C′ to production (attended). Prepared read-only, 2026-11-16, from the worktree at C′

> Packet 6 (`../RELEASE-AND-REPAIR-PACKET-6.md`) is the contract: its §4 order and §7 approvals override this appendix wherever they differ.
> Not executed. Every host command here is for the approved sitting only.

Source of truth: `D:\dev\afldb-rem-20261114` at `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5`. Every `release.mjs:N` cite is that file at C′.
"c1c4b22e:release.mjs:N" means the serving revision's copy (read with `git show`). Nothing was executed on the host.

## 0. Identity table

| Item | Value | Basis |
|---|---|---|
| Published revision C′ | `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5` (parent Q⁗ `f6af6da9`; C′ adds records only: `docs/`, `issues/`, `issues.md`, `blockers.md`) | `git diff --name-only f6af6da9 a2e6ea99` |
| Serving `current` = rollback target | `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (rev `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`, BUILD_ID `bTVyci1eHVcKvSKDVZl_x`) | B0-FINDINGS.md:15 |
| `previous` (today) | `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`; after promote it leaves `previous` but stays under `releases/` (nothing deletes; release.mjs:34) | B0-FINDINGS.md:16 |
| New id format | `<first 12 hex of revision>-<BUILD_ID>` = **`a2e6ea9995a4-<BUILD_ID>`**, BUILD_ID `[A-Za-z0-9_-]{1,64}`, known only after the build | release.mjs:83-91, 1091 |
| After promote | `current` → `releases/a2e6ea9995a4-…`, `previous` → `releases/c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` | release.mjs:1335-1336 |
| Unchanged c1c4b22e→C′ | `src/db/migrations/` (head `118_fixtures_unconfirmed_participants.sql`), `package-lock.json`, `deploy/afldb.service`, `deploy/afldb.service.d/`, `deploy/post-install-check.sh`, `deploy/server-cluster.mjs` | `git diff --name-only` (empty) |
| Changed c1c4b22e→C′ that matter here | `deploy/release.mjs` (+438: `host-gate`, `--attended`, activation audit, `check-node-modules`, `migrationHead`), `deploy/afldb-settle-afl-api.sh` (+27, node_modules check), `tools/current-season/settle-afl-api-fixture*.ts` | `git diff --stat` |

## 1. Facts from the code that shape the sitting

- Args: values are space-separated only (`--revision <sha>`, never `--revision=<sha>`); booleans are exactly `no-live`, `allow-node-mismatch`,
  `attended`, `strict`, `confirm-attended-restart` (release.mjs:1688-1713). Linux only (1717). `--root` defaults to `/home/arm/afldb-releases` (53).
- **The serving revision's tool has no `host-gate`, no `--attended` flag, no `check-node-modules`** (c1c4b22e:release.mjs:19-25 usage, :1295
  `flags = ['no-live','allow-node-mismatch']`). Run at c1c4b22e, `host-gate` prints usage and exits 2, and `promote <id> --attended` fails
  (`--attended` is parsed as a valued option). **The fast-forward to C′ must precede the gate and promote.**
- `build` needs `--checkout`, `--revision` (full 40 hex, a commit present in the checkout) and `--afldb-env production` (1005-1008, 958-962). It
  does NOT need the checkout's HEAD to be the revision: it `git archive`s the revision into `builds/<stamp>-a2e6ea9995a4-<hex>/src` (982-1001,
  1035) and runs its own `npm ci` there (1074). It reads the unit file **from the revision** and refuses unless it runs on the Node that unit pins,
  `/home/arm/.nvm/versions/node/v22.23.2/bin/node` (afldb.service:29; release.mjs:938-949, 1018-1019). `.env` is the checkout's (1013).
- Admission: MemAvailable ≥ **3,200 MB** in-build or **2,100 MB** with `--typecheck off-host` (60, 1026-1031), free disk ≥ 6 GB (61, 1033); guard
  floor 384 MB kills the build group (57). Off-host needs `--typecheck-evidence` (1010-1012), recorded in `release.json` (1143).
- Build smoke: the candidate boots on `127.0.0.1:3199` (62, 790 refuses if the port is in use) with the service environment, i.e. **against the
  production database**, 1 worker (791-797); health ok/ok within 90 s, own `_buildManifest.js` 200, one CSS 200, `/` 200 with a 5-minute beta
  claim signed by `AFLDB_SESSION_SECRET` (772-780, 856-868), each `--smoke-paths` page 200, no error lines (875-876). Then one rename into
  `releases/` (918-923). Events: `build-start`, `build-pass` / `build-fail` (1069, 1156, 1165). Success line:
  `release: RELEASE READY <id> (<n> files, manifest <12hex>…) at <path>` (1157). A build never moves `current`/`previous`.
- `promote <id> --attended`: refuses without `--attended` (1268-1273); verifies the release manifest (1321-1322, 704-733); refuses if `<id>` is
  already current (1324) or the service's MainPID cwd is not `realpath(releases/<current>)` (1325-1333); runs the host gate (1334, 1276-1300);
  then `previous` → old current, `current` → `<id>` by rename(2) (1335-1336, 402-411); event `promote` with the service window (1337). It does
  not restart, touch the checkout or the DB (34-35). Prints `PROMOTED <id>; previous <old>` (1338).
- Host gate (`evaluateHostGate`, 273-303): REFUSES while `apt-daily.service`/`apt-daily-upgrade.service` is active, while `apt`/`apt-get`/`dpkg`/a
  running `unattended-upgrade` exists (279-280, 1236-1243), or when the next `apt-daily-upgrade.timer` is ≤ `--window-min` (default 90) minutes
  away (284-286). Warns only for: unreadable timer, pending reboot, missing needrestart hold (refusal only with `--strict`, 294-297). No
  time-of-day rule. Rollback mode never refuses (278).
- `status --expect <id>` (1429-1518): `current` = id; MainPID cwd inside it; `/api/health` 200 ok/ok; current `_buildManifest.js` 200; previous
  BUILD_ID's 404; activation audit (InvocationID change + apt-history coincidence is a FAIL unless `--confirm-attended-restart`, 1402-1422,
  1495). On PASS with `--expect` it appends `status-pass` (1513-1515); without `--expect` it writes nothing.
- Service: `WorkingDirectory=/home/arm/afldb-releases/current` (release-route.conf:16), resolved once at start; `EnvironmentFile` is the
  checkout's `.env` (afldb.service:33); `Restart=always`, start limit 5 in 120 s (afldb.service:15-16, 91).
- Nightly settle: `afldb-settle-afl-api.service` runs `/home/arm/projects/afldb/deploy/afldb-settle-afl-api.sh` with the checkout as cwd
  (afldb-settle-afl-api.service:11, 31), i.e. **checkout code and node_modules, never the release**.

## 2. The sitting (start 08:00–14:00 AEDT; Claude = `ssh afldb` as arm; OWNER = sudo)

Transport (Claude): `C:\Windows\System32\OpenSSH\ssh.exe afldb bash -s < <block-file>` (one block per call, `set -euo pipefail`). Every block begins:
```bash
set -euo pipefail; export LC_ALL=C
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; H0=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade
OLD_ID=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x; OLD_PREV=0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN
```

**S1 pre-checks (Claude, read-only; tool still at c1c4b22e).** STOP on any failed assertion; nothing has changed.
```bash
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
[ "$(git rev-parse HEAD)" = "$H0" ]; [ "$(git rev-parse --abbrev-ref HEAD)" = main ]; [ -z "$(git status --porcelain)" ]
[ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]                       # no build.lock / links.lock (release.mjs:518)
"$N" deploy/release.mjs status                                           # must end "STATUS PASS c1c4b22ee150-…"; writes nothing
"$N" deploy/release.mjs verify "$OLD_ID"                                 # "VERIFY PASS" (release.mjs:1180): the rollback target is intact
[ "$(systemctl is-active afldb-settle-afl-api.service || true)" = inactive ]
systemctl show afldb-settle-afl-api.timer -p NextElapseUSecRealtime --value   # must be after the sitting ends (next 05:00+≤15 min)
for u in apt-daily.service apt-daily-upgrade.service; do [ "$(systemctl is-active $u || true)" = inactive ]; done
for p in apt apt-get dpkg; do [ -z "$(pgrep -x $p || true)" ]; done   # NOT `! pgrep`: set -e ignores a negated command
systemctl list-timers apt-daily-upgrade.timer apt-daily.timer --all --no-pager   # apt-daily-upgrade LAST = today, NEXT = tomorrow 06:00-07:00
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo); echo "MemAvailable $avail MB"; [ "$avail" -ge 2100 ]
df -BG --output=avail "$ROOT" | tail -1                                  # ≥ 6G
[ "$(ss -ltn | grep -c ':3199 ' || true)" = 0 ]                          # smoke port free (release.mjs:790)
[ "$(grep -c '^AFLDB_BETA_GATE=on$' .env || true)" = 1 ]; [ "$(grep -c '^AFLDB_BETA_EPOCH=1$' .env || true)" = 1 ]   # counts only; the gate flag was not read in B0
```
Pass: every assertion holds and `status` prints STATUS PASS. Also confirm on the workstation: `git ls-remote origin refs/heads/main` = `$CP`.

**S2 fast-forward the serving checkout (Claude).** Does not touch the running site (it runs from the release). From here the 05:00 settle runs C′.
```bash
git fetch origin
[ "$(git rev-parse refs/remotes/origin/main)" = "$CP" ]; git merge-base --is-ancestor "$H0" "$CP"
git merge --ff-only "$CP"
[ "$(git rev-parse HEAD)" = "$CP" ]; [ -z "$(git status --porcelain)" ]
[ -z "$(git diff --name-only "$H0" "$CP" -- src/db/migrations package-lock.json)" ]   # no migration, no lock change: no npm ci
"$N" deploy/release.mjs status                       # C′ tool: STATUS PASS; "no recorded activation window" note is expected
"$N" deploy/release.mjs check-node-modules --checkout "$CHK"   # expect NODE_MODULES OK (exit 0); MISMATCH = record, owner decides (settle only warns)
```
Stop: ff refused (not ff), HEAD ≠ C′, porcelain non-empty, STATUS FAIL. State after a stop here: checkout C′, release c1c4b22e (see §3, same as rolled back).

**S3 build (Claude, in detached tmux; ~5 min measured, budget 15).** Off-host typecheck (see D2) needs the owner's acceptance of the evidence text.
```bash
LOG=/home/arm/b1-build-$(date -u +%Y%m%dT%H%M%SZ).log; [ ! -e "$LOG" ]
tmux new-session -d -s b1-build "export PATH=$PATH; cd $CHK && $N deploy/release.mjs build --checkout $CHK --revision $CP \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons,/draft \
  --typecheck-evidence 'npm run typecheck rc 0 on Linux (DEV streamanator, node v22.23.2) at f6af6da9 (run5/T2-QUALIFICATION.md section 2); C-prime a2e6ea99 = f6af6da9 + records-only' \
  > $LOG 2>&1; echo BUILD_EXIT=\$? >> $LOG"; echo "$LOG"
```
Poll (read-only) until `BUILD_EXIT=` appears: `tail -n 5 "$LOG"`. Then read the id:
```bash
NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "$LOG" | tail -n 1); echo "$NEW_ID"
[[ $NEW_ID =~ ^a2e6ea9995a4-[A-Za-z0-9_-]{1,64}$ ]]; grep -q '^BUILD_EXIT=0$' "$LOG"
tail -n 1 "$ROOT/events.log"                                             # "op":"build-pass","id":"$NEW_ID","revision":"$CP"
"$N" deploy/release.mjs verify "$NEW_ID"                                 # VERIFY PASS
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
grep -E '^release: (admission|smoke|build:|npm ci:)' "$LOG"              # record min MemAvailable, smoke pages (expect /, /players… 200)
```
Stop (nothing to recover; links untouched, release.mjs:1160-1167): `REFUSED`/`BUILD FAILED`, guard abort, `BUILD_EXIT≠0`, no READY line,
id not matching the regex. MemAvailable minimum under ~900 MB: stop and look, do not retry.

**S4 host gate (Claude, read-only, immediately before promote).**
`"$N" deploy/release.mjs host-gate` → pass: exit 0 and `HOST GATE PASS` (1555). Expected WARNINGs (not refusals): reboot pending, needrestart
hold missing (B4 not installed). **Do not pass `--strict`** (it refuses on the missing hold, 297). Refusal: wait (apt-daily may run at any hour)
and re-run; never `--skip-host-gate`.

**S5 promote (Claude, owner present and ready to restart within minutes).**
`"$N" deploy/release.mjs promote "$NEW_ID" --attended` → pass: exit 0, `PROMOTED <NEW_ID>; previous c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, then
`readlink "$ROOT/current"` = `releases/$NEW_ID`, `readlink "$ROOT/previous"` = `releases/$OLD_ID`, last events line `"op":"promote"` with a
`window`. Any REFUSED: links unchanged (all refusals precede 1335), STOP. **The activation window is now open** (any restart activates C′).

**S6 restart (OWNER, now).** `sudo systemctl restart afldb`. If `systemctl is-active afldb` ≠ active with `Result=start-limit-hit`:
`sudo systemctl reset-failed afldb && sudo systemctl start afldb` (post-install-check.sh:57), else go to §3.

**S7 identity gate (Claude).** `"$N" deploy/release.mjs status --expect "$NEW_ID"` → `STATUS PASS a2e6ea9995a4-…`: process in
`releases/$NEW_ID`, health 200 ok/ok, new `_buildManifest.js` 200, `bTVyci1eHVcKvSKDVZl_x` manifest 404, `restarted since promote` note with no
apt-coincidence FAIL. If the only FAIL is the apt-coincidence and the owner confirms the restart was theirs: rerun with `--confirm-attended-restart`.

**S8 post-install check (Claude).** `cd "$CHK" && bash deploy/post-install-check.sh "$NEW_ID"` (previous BUILD_ID defaults to
`previous`'s = `bTVyci1eHVcKvSKDVZl_x`, :31). It waits ≤60 s for loopback health (:51-53), requires the unit active (:54-59), runs `status
--expect` again (:61, a second `status-pass` line), health + `_buildManifest.js` on `http://127.0.0.1:3100` and `https://beta.afldb.com`
(:65-69), previous BUILD_ID 404 at origin loopback and cache-busted public, plain public 404 or Cloudflare `HIT` = CACHE not FAIL (:71-88), pages
`/ /beta /players /matches /seasons /clubs /records /search /admin/operations` 200 after redirects, every referenced JS/CSS 200 and byte-identical
to the release (:90-106), `POST /api/admin/email-intake` 410 (:107-108), journal (:110-127). Pass: `POST-INSTALL CHECK PASS <NEW_ID>`
(notes CACHE / journal unverified allowed). If it prints `UNVERIFIED journal`, **OWNER** runs the two printed commands:
`sudo journalctl -u afldb --since "<ActiveEnter>" -o cat | grep -E '\[afldb\] (primary|serving build)'` (identity line must name the new
BUILD_ID and `release $NEW_ID`) and `… | grep -ciE 'error|fatal|unhandled'` (must print 0).

**S9 public smoke (Claude, workstation curl; unauthenticated, gate on, AFLDB_BETA_EPOCH=1).**
| Request | Expect |
|---|---|
| `GET https://beta.afldb.com/api/health` | 200 `{"status":"ok","database":"ok"}` (public prefix, middleware.ts:31) |
| `GET https://beta.afldb.com/` | **307**, `Location: <AFLDB_BASE_URL origin>/beta` (no query) (middleware.ts:156-159, redirect.ts:36-37) |
| `GET https://beta.afldb.com/players` | 307 → `/beta?from=%2Fplayers` |
| `GET https://beta.afldb.com/beta` | 200 text/html, `X-Robots-Tag: noindex, nofollow` (Caddy; c1c4b22e Caddyfile.production:66, installed copy not compared) |
| `GET https://beta.afldb.com/admin/operations` | 307 → `/admin/login` (middleware.ts:107-113) |
| `GET …/_next/static/<new BUILD_ID>/_buildManifest.js` | 200 |
A 503 "Beta gate is on but …" means a secret/epoch misconfiguration (middleware.ts:119-135): rollback trigger.

**S10 observation (≥30 min, Claude read-only).** Every 10 min: `systemctl show afldb -p ActiveState -p NRestarts -p InvocationID -p MemoryCurrent`
(InvocationID unchanged since S6, NRestarts 0), loopback health 200 ok/ok, one ISR page (`curl -sI` with no cookie is a 307; use the S8 run's
pages or the owner's browser session). End with `"$N" deploy/release.mjs status` (no `--expect`): STATUS PASS, no "restarted since" note.
**Order (packet 6 §4 governs):** if B1a-0/B1a are approved they run between S2 and S3 (`../b1a/B1A-RUNBOOK.md`), so S3's build
prerenders already-repaired pages and the S9b page checks below can run straight after S8. If they are not approved, skip them.

## 3. Rollback

Triggers: S6 unit not active after one reset; S7 STATUS FAIL not explained by the apt-coincidence; S8 FAIL (other than CACHE / unverified
journal); S9 5xx or 503 gate message; journal errors; crash restarts during S10. Not a trigger: any stop before S5 (nothing switched).

```bash
"$N" deploy/release.mjs rollback --attended --checkout "$CHK" [--ledger-head 118_fixtures_unconfirmed_participants.sql]   # Claude
sudo systemctl restart afldb                                                                                         # OWNER
"$N" deploy/release.mjs status --expect c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x                                          # Claude
bash deploy/post-install-check.sh c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x                                                # Claude
```
- Target: `previous` by default (1363), which after S5 is `c1c4b22ee150-…`; `current` moves first, then `previous` → `$NEW_ID` (1376-1378);
  events `rollback-start`, `rollback` (with window, so the audit works). Never refuses on host state (278); verifies the target manifest
  (1366-1367); `c1c4b22e` has recorded `status-pass` (b0 result:41-43), so no warning (1368).
- `release.json` of `c1c4b22e` has **no `migrationHead`** (b0-prod-probe.result.txt:44; c1c4b22e tool predates the field), so pass
  `--checkout "$CHK"` to derive it from Git (1371) → `118_…`. `--ledger-head` needs a DB read (owner-approved read-only, B0 style); without it
  the tool proceeds and records `ledger: not-checked` (327). With both: status `match` (332). No schema differs, so either is safe.
- **Serving checkout stays at C′. Do not move it back by default.** Reasons: (a) the documented `rollback --attended`, `status` audit and
  `host-gate` exist only in the C′ tool; at c1c4b22e `--attended` is not a flag (c1c4b22e:release.mjs:1295) and the commands above break;
  (b) moving back is a non-fast-forward Git write (`git reset --keep $H0`), a separate owner decision. Consequence of checkout C′ + release
  c1c4b22e: the 05:00 settle runs C′'s wrapper (node_modules warn-only check) and C′'s `settle-afl-api-fixture*.ts` (ISSUE-350 HALT
  behaviour) against an unchanged schema; it calls the running c1c4b22e app only for season revalidation; off-season it is a 2 s no-op
  (B0-FINDINGS.md:59). Move the checkout back only if the rollback cause lies in checkout-run code (settle/tools), and then stop the settle
  timer first (procedure 03 lines 57-58 pattern) and re-run `check-node-modules`.

## 4. Discrepancies: code vs packet 5 §3 B1 (`run5/APPROVAL-PACKET-5.md`)

| # | Grade | Packet | Code / evidence | Effect |
|---|---|---|---|---|
| D1 | HIGH | :61 `release.mjs build --revision <C′>` | `--checkout` and `--afldb-env` are required (release.mjs:1005, 1007) | As written: `REFUSED: --checkout is required`. Use S3's full form. |
| D2 | HIGH | :61 no typecheck mode; budget "4–5 min measured" | Default `in-build` admission is 3,200 MB (60, 1026-1031); production showed MemAvailable 2,946–2,952 MB of 3,915 MB (d31612-ui-release-approval-2026-11-02.md:15, block-m-execution-package-2026-11-02.md:24). Both measured builds (4:51, 4:27) were `--typecheck off-host` (issue334-335 phase.sh:73; i336 d2.sh:6) | Likely admission refusal; if admitted, a longer, OOM-prone build. Needs `--typecheck off-host --typecheck-evidence "<text>"` and the owner's acceptance of the evidence (T2-QUALIFICATION.md:34 at `f6af6da9`; C′ records-only). Packet should say so. |
| D3 | MED | :60 lists pre-checks then ff, but :62 groups `host-gate` with the sitting; no statement that the gate needs C′'s tool | c1c4b22e tool has no `host-gate`/`--attended` (c1c4b22e:release.mjs:19-25, 1295) | Any gate run before S2 exits 2 (usage). Order S2 → S4 is mandatory. |
| D4 | MED | :64 rollback reserve `rollback --attended` only | Target release has no `migrationHead`; ledger check only with `--checkout` (1371) and `--ledger-head` (326-337) | Works as written but records `not-checked`; add `--checkout "$CHK"` (free) and optionally `--ledger-head`. |
| D5 | LOW | :62 `status --expect` then `post-install-check.sh` | post-install-check.sh:61 runs `status --expect` itself | Two `status-pass` events; harmless. |
| D6 | LOW | :62/:65 journal observation | arm usually cannot read the journal; the checker then prints UNVERIFIED and two sudo commands (post-install-check.sh:114-119) | Add the OWNER journal step to the sitting. |
| D7 | LOW | :62 `host-gate` | `--strict` refuses without the B4 hold (294-297; B0-FINDINGS.md:24 hold absent) | Run plain `host-gate`; expect two WARNINGs. |
| D8 | INFO | :50-53 correction (no time-of-day rule; 90-min look-ahead) | Confirmed (273-303, 1283) | — |
| D9 | INFO | :55-56 measured times | events.log: builds 01:11:57→01:16:48 and 05:10:33→05:15:00; promote→status-pass 7, 6, 28 min (b0 result:32-41) | Confirmed. Total 2 h 05 adds up. |
| D10 | INFO | :60 "no `npm ci`: lockfile unchanged" | Confirmed (`git diff` empty); the build runs its own `npm ci` in `builds/` (1074); the checkout's node_modules serve only the settle | Run `check-node-modules` after S2. |
| D11 | INFO | :125 rollback target `c1c4b22ee150-…` | = `previous` after promote (1335) | Default `rollback` needs no `--to`. |
| D12 | INFO | :60 "settle inactive" | The settle runs from the checkout (afldb-settle-afl-api.service:11, 31); the ff in S2 is the moment its code changes | S1 also checks the timer's next elapse; any abort after S2 leaves checkout C′ + release c1c4b22e (§3 consequences). |
