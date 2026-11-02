#!/bin/bash
# ISSUE-316 C4b gate fix: CHECKOUT-ONLY rollout phases on afldb-prod, run as `arm`, one phase per call, by path.
#   bash rollout.sh pa <N>    read-only checks + the "before" snapshot (writes only $PRE; refuses to overwrite it)
#   bash rollout.sh d1 <N>    fetch, prove origin/main == N, re-run the static delta check from N's own bytes, fast-forward to N
#   bash rollout.sh d2 <N>    post-install verification: identity, only the expected bytes moved, the service did not notice
#   bash rollout.sh r1 <N>    checkout restore to the previous head (ONLY after a failed d2, checkout exactly N and clean)
# N is the approved pinned package commit (40 lowercase hex). No sudo. No build, no promotion, no restart, no database client, no provider
# contact, no C4b/settle/acquire tool is started by any phase. A failed assertion stops the phase with a non-zero status and no PASS line.
set -u -o pipefail
export LC_ALL=C
umask 077
stop() { echo "STOP: $1"; exit "${2:-1}"; }
PHASE=${1:?phase}; N=${2:?N (40 hex)}
[[ $N =~ ^[0-9a-f]{40}$ ]] || stop "N must be 40 lowercase hex" 2
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user (this package is for afldb-prod, as arm)" 3

PKG=docs/v2/evidence/c4b-fix-r2-20261102
PROD_HEAD=ea98a35f20610e75c18e698bc0d9fe084c3c783d        # the production checkout, serving release's source (R of D-316-13); clean
SERVING_ID=ea98a35f2061--vY0EFS0DdR-TiPkxTZz6             # serving release; must stay the selected one
ROLLBACK_ID=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy            # `previous`; must stay as it is
ROOT=/home/arm/afldb-releases
CHK=/home/arm/projects/afldb
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
REH=tools/current-season/afl-api-c4b-rehearsal.ts
SET=tools/current-season/settle-afl-api.ts
REH_OLD=e3ac29268507b8db89ca99f125a58abd065e0ff2; REH_NEW=cdf76a6744d9d6734fcfaf8bf93aba7ff258fa53
SET_OLD=c8d53c6ffbd4296f6dc7a3ffbbf2adc07a28d969; SET_NEW=c97f0cdcd24865307c5d1b4b9786f201cf235ac2
REH_SHA=e7464d5843e498863234fec9b7ad68acf886d1f8ea29a826e2f7177500036348
SET_SHA=06d6984848255763ebee054ed3bf7b3b832b25598029776e4b391c224a8ab77d
EV1=/home/arm/backups/afldb/c4b-ea98a35f-r1                # the first run's evidence: preserved, read-only here
EV1_RESULT_SHA=25a53e87bf3f500d78972320a6428d165c4d6af5752867b77011267c1c4dc663
SNAP1=$CHK/data/sources/afl_api/matches/afl-api-2027-2026-11-02-052722
SNAP1_FEED_SHA=1a51317b514b53c2d7261d23f506c92af6e0dbaff29c4a969e1281b19e2b7ced
PRE=/home/arm/c4b-fix-rollout-pre.txt                      # written by pa, read by d2; refuses to be overwritten
SVC="afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service"
TMR="afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer afldb-settle-afltables.timer"

cd "$CHK" || stop "no checkout" 3
no_tools_running() {
  [ -z "$(pgrep -f '[a]fl-api-c4b-rehearsal|[s]ettle-afl-api|[a]cquire-afl-api' || true)" ] || stop "a C4b/settle/acquire process is running" 4
  [ -z "$(tmux ls 2>/dev/null | grep -i c4b || true)" ] || stop "a c4b tmux session exists" 4
}
units_inert() {
  local u
  for u in $SVC; do [ "$(systemctl show -p LoadState --value "$u")" = loaded ] && [ "$(systemctl show -p ActiveState --value "$u")" = inactive ] || stop "$u is not loaded/inactive" 4; done
  for u in afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer; do
    [ "$(systemctl is-enabled "$u" 2>/dev/null)" = disabled ] && [ "$(systemctl show -p ActiveState --value "$u")" = inactive ] || stop "$u is not disabled/inactive" 4
  done
  case "$(systemctl is-enabled afldb-settle-afltables.timer 2>/dev/null)" in disabled|masked|not-found|"") ;; *) stop "the AFL Tables timer is enabled" 4;; esac
  [ "$(systemctl show -p ActiveState --value afldb-settle-afltables.timer)" != active ] || stop "the AFL Tables timer is active" 4
}
service_serves_release() {
  [ "$(readlink "$ROOT/current")"  = "releases/$SERVING_ID" ]  || stop "current is not releases/$SERVING_ID" 4
  [ "$(readlink "$ROOT/previous")" = "releases/$ROLLBACK_ID" ] || stop "previous is not releases/$ROLLBACK_ID" 4
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ] || stop "a release lock exists" 4
  [ "$(systemctl show -p ActiveState --value afldb)" = active ] || stop "afldb is not active" 4
  [ "$(systemctl show -p WorkingDirectory --value afldb)" = "$ROOT/current" ] || stop "the unit's WorkingDirectory is not the release current" 4
  [[ "$(systemctl show -p DropInPaths --value afldb)" == *release-route.conf* ]] || stop "the release-route drop-in is absent" 4
  local pid cg p c; pid=$(systemctl show -p MainPID --value afldb); [ "$pid" -gt 1 ] || stop "no MainPID" 4
  [ "$(readlink "/proc/$pid/cwd")" = "$ROOT/releases/$SERVING_ID" ] || stop "MainPID cwd is not the serving release" 4
  cg=$(systemctl show -p ControlGroup --value afldb)
  for p in $(cat "/sys/fs/cgroup$cg/cgroup.procs"); do
    c=$(readlink "/proc/$p/cwd" || true)
    case "$c" in "$CHK"|"$CHK"/*) stop "process $p of the unit runs inside the checkout: $c" 4;; esac
  done
  "$NODE" deploy/release.mjs status > /dev/null || stop "release status is not PASS" 4
  "$NODE" deploy/release.mjs verify "$SERVING_ID" > /dev/null || stop "the serving release does not verify" 4
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3100/api/health)" = 200 ] || stop "health is not 200" 4
}

case "$PHASE" in
pa)
  echo "== pa $(date -u +%FT%TZ)"
  [ ! -e "$PRE" ] || stop "$PRE already exists (a rollout was started; refusing to overwrite)" 5
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ] || stop "checkout HEAD is $(git rev-parse HEAD), expected $PROD_HEAD" 3
  [ -z "$(git status --porcelain)" ] || stop "checkout has changes" 3
  [ "$(git rev-parse "HEAD:$REH")" = "$REH_OLD" ] && [ "$(git hash-object "$REH")" = "$REH_OLD" ] || stop "C4b tool is not the recorded old blob" 3
  [ "$(git rev-parse "HEAD:$SET")" = "$SET_OLD" ] && [ "$(git hash-object "$SET")" = "$SET_OLD" ] || stop "settle tool is not the recorded old blob" 3
  no_tools_running; units_inert; service_serves_release
  [ -d "$EV1" ] && [ "$(sha256sum < "$EV1/result.json" | cut -c1-64)" = "$EV1_RESULT_SHA" ] || stop "the first run's evidence is missing or its result.json changed" 5
  [ "$(grep -c '"verdict": "HALT"' "$EV1/result.json")" = 1 ] || stop "the first run's result.json is not the HALT" 5
  [ "$(sha256sum < "$SNAP1/00-season-matches.json" | cut -c1-64)" = "$SNAP1_FEED_SHA" ] || stop "the captured live feed is missing or changed" 5
  [ -x "$NODE" ] && [ "$("$NODE" -v)" = v22.23.2 ] || stop "pinned node is not available" 4
  avail=$(df --output=avail -k /home/arm | tail -n 1 | tr -d ' '); echo "free ${avail} KB"; [ "$avail" -ge 1048576 ] || stop "less than 1 GiB free" 4
  {
    printf 'PRE_HEAD=%s\n' "$(git rev-parse HEAD)"
    printf 'PRE_PID=%s\n' "$(systemctl show -p MainPID --value afldb)"
    printf 'PRE_NRESTARTS=%s\n' "$(systemctl show -p NRestarts --value afldb)"
    printf 'PRE_ACTIVE_ENTER=%s\n' "$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb)"
    printf 'PRE_ENV=%s\n' "$(stat -c '%a:%U:%s:%Y' "$CHK/.env")"          # mode:owner:size:mtime; the value is never read
    printf 'PRE_EV1_LISTING=%s\n' "$(cd "$EV1" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-64)"
    printf 'PRE_SNAP1_MANIFEST=%s\n' "$(sha256sum < "$SNAP1/manifest.json" | cut -c1-64)"
  } > "$PRE"
  cat "$PRE"
  echo "PA PASS"
  ;;
d1)
  echo "== d1 $(date -u +%FT%TZ)"
  [ -f "$PRE" ] || stop "no $PRE: run pa first" 5
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ] && [ -z "$(git status --porcelain)" ] || stop "checkout is not the recorded clean head" 3
  no_tools_running
  git fetch origin || stop "fetch failed" 4
  [ "$(git rev-parse refs/remotes/origin/main)" = "$N" ] || stop "origin/main is $(git rev-parse refs/remotes/origin/main), not the approved $N (did the owner push exactly N?)" 5
  git cat-file -e "$N^{commit}" || stop "N is not in the object store" 5
  git show "$N:$PKG/static-delta-check.sh" | bash -s -- "$N" || stop "the static delta check failed on production" 5
  git merge --ff-only "$N" || stop "fast-forward failed" 5
  echo "D1 PASS (identity checks follow in d2)"
  ;;
d2)
  echo "== d2 $(date -u +%FT%TZ)"
  [ -f "$PRE" ] || stop "no $PRE" 5
  # shellcheck disable=SC1090
  . "$PRE"
  [ "$(git rev-parse HEAD)" = "$N" ] || stop "checkout HEAD is not N" 3
  [ -z "$(git status --porcelain)" ] || stop "checkout has changes" 3
  git diff --quiet "$N" -- || stop "tracked tree differs from N" 3
  [ "$(git rev-parse "HEAD:$REH")" = "$REH_NEW" ] && [ "$(git hash-object "$REH")" = "$REH_NEW" ] && [ "$(sha256sum "$REH" | cut -d' ' -f1)" = "$REH_SHA" ] || stop "C4b tool bytes are not the pinned new bytes" 3
  [ "$(git rev-parse "HEAD:$SET")" = "$SET_NEW" ] && [ "$(git hash-object "$SET")" = "$SET_NEW" ] && [ "$(sha256sum "$SET" | cut -d' ' -f1)" = "$SET_SHA" ] || stop "settle tool bytes are not the pinned new bytes" 3
  [ -z "$(git diff --name-only "$PROD_HEAD" HEAD -- src packages deploy data package.json package-lock.json next.config.ts tsconfig.json)" ] || stop "an application, deploy or data path moved" 3
  git diff --stat "$PROD_HEAD" HEAD -- tools
  [ "$PRE_HEAD" = "$PROD_HEAD" ] || stop "recorded PRE_HEAD differs" 3
  # the service did not notice
  [ "$(readlink "$ROOT/current")"  = "releases/$SERVING_ID" ] && [ "$(readlink "$ROOT/previous")" = "releases/$ROLLBACK_ID" ] || stop "a release pointer moved" 4
  [ "$(systemctl show -p MainPID --value afldb)" = "$PRE_PID" ] || stop "MainPID changed" 4
  [ "$(systemctl show -p NRestarts --value afldb)" = "$PRE_NRESTARTS" ] || stop "NRestarts changed" 4
  [ "$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb)" = "$PRE_ACTIVE_ENTER" ] || stop "ActiveEnterTimestamp changed" 4
  [ "$(stat -c '%a:%U:%s:%Y' "$CHK/.env")" = "$PRE_ENV" ] || stop ".env changed" 4
  no_tools_running; units_inert; service_serves_release
  # the first run's evidence and snapshot are exactly as they were
  [ "$(cd "$EV1" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-64)" = "$PRE_EV1_LISTING" ] || stop "the first run's evidence directory changed" 5
  [ "$(sha256sum < "$SNAP1/manifest.json" | cut -c1-64)" = "$PRE_SNAP1_MANIFEST" ] || stop "the first snapshot's manifest changed" 5
  echo "D2 PASS: checkout $PRE_HEAD -> $N; C4b tool $REH_OLD -> $REH_NEW; settle tool $SET_OLD -> $SET_NEW; service PID $PRE_PID unchanged; first-run evidence untouched"
  ;;
r1)
  echo "== r1 $(date -u +%FT%TZ)"
  [ "$(git rev-parse HEAD)" = "$N" ] && [ -z "$(git status --porcelain)" ] || stop "r1 applies only when the checkout is exactly N and clean; anything else is the owner's decision" 3
  no_tools_running
  git reset --hard "$PROD_HEAD" || stop "reset failed" 5
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ] && [ -z "$(git status --porcelain)" ] || stop "restore did not reach the previous head" 5
  [ "$(git hash-object "$REH")" = "$REH_OLD" ] && [ "$(git hash-object "$SET")" = "$SET_OLD" ] || stop "restored bytes are not the old blobs" 5
  echo "R1 PASS: checkout restored to $PROD_HEAD (the HALT-prone gate is back; do not run C4b on it)"
  ;;
*) stop "unknown phase" 2 ;;
esac
