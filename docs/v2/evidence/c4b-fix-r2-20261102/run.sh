#!/bin/bash
# ISSUE-316 C4b rerun (fresh D-316-13 grant) on afldb-prod, as `arm`, one phase per call, by path. Requires the checkout-only rollout (rollout.sh d2 PASS).
#   bash run.sh step-a <N>                       read-only except one new mode-600 feed copy; ends with `C4B-PRE PASS` from c-prod.sh
#   bash run.sh launch <N> <evidence-dir>        probe node inside tmux, then start THE ONE RUN in one tmux session (absolute node, explicit PATH)
#   bash run.sh launch <N> <evidence-dir> --probe-only   (workstation/DEV qualification of the launcher itself: never starts the tool)
#   bash run.sh step-c <N> <evidence-dir>        read-only verification after the run
# The tool is started only by `launch`, and `launch` is run only under the owner's fresh D-316-13 grant. No sudo.
set -u -o pipefail
export LC_ALL=C
umask 077
stop() { echo "STOP: $1"; exit "${2:-1}"; }
PHASE=${1:?phase}; N=${2:?N (40 hex)}
[[ $N =~ ^[0-9a-f]{40}$ ]] || stop "N must be 40 lowercase hex" 2
MODE=${4:-run}
if [ "$MODE" != --probe-only ]; then
  [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user (afldb-prod, as arm)" 3
  MODE=run
  CHK=/home/arm/projects/afldb
else
  [ "$PHASE" = launch ] || stop "--probe-only applies to launch only" 2
  CHK=${C4B_PROBE_CHECKOUT:?--probe-only needs C4B_PROBE_CHECKOUT (a clean checkout at N, off production)}
  [ "$(hostname)" != afldb-prod ] || stop "--probe-only is refused on afldb-prod" 3
fi

NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
TPATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/local/bin:/usr/bin:/bin   # the explicit PATH the tmux command carries (exit 127 on 2 Nov came from a non-login tmux shell with no node)
PKGROOT=/home/arm/c4b-r2-${N:0:12}
FEED=$PKGROOT/c4b-feed-2027.json
FEED_SRC=tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json
FEED_SHA=21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d
CPROD_REL=docs/v2/evidence/block-c-package-20261102/c-prod.sh
CPROD_SHA=ec839a47b645a61561ef885c1a5d1926be2e864fe3e557ec254553c6a031d496
PARENT=/home/arm/backups/afldb
SESSION=c4b-${N:0:8}-r2
EXPECT_PID=3268373

clean_at() {
  [ "$(git -C "$CHK" rev-parse HEAD)" = "$N" ] || stop "checkout HEAD is $(git -C "$CHK" rev-parse HEAD), expected $N" 3
  [ -z "$(git -C "$CHK" status --porcelain)" ] || stop "checkout has changes" 3
}

case "$PHASE" in
step-a)
  echo "== step-a $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
  clean_at; echo "checkout is exactly $N and clean"
  EVD=${3:-}; [ -z "$EVD" ] || [ ! -e "$EVD" ] || stop "evidence directory $EVD already exists" 5
  [ "$(sha256sum < "$CHK/$CPROD_REL" | cut -c1-64)" = "$CPROD_SHA" ] || stop "c-prod.sh is not the pinned bytes" 3
  mkdir -p "$PKGROOT"; chmod 700 "$PKGROOT"
  if [ -e "$FEED" ]; then echo "feed copy already exists"; else ( umask 077; git -C "$CHK" show "$N:$FEED_SRC" > "$FEED" ); chmod 600 "$FEED"; fi
  [ "$(sha256sum < "$FEED" | cut -c1-64)" = "$FEED_SHA" ] || stop "the feed copy is not the pinned bytes" 3
  ls -l "$FEED"
  [ -d "$PARENT" ] && [ -w "$PARENT" ] || stop "$PARENT is not a writable directory" 4
  df -h "$PARENT" /tmp "$CHK" | cat
  command -v tmux > /dev/null || stop "tmux is not installed" 4
  [ -z "$(tmux ls 2>/dev/null | grep -i c4b || true)" ] || stop "a c4b tmux session already exists" 4
  [ "$(systemctl show -p MainPID --value afldb)" = "$EXPECT_PID" ] || stop "afldb MainPID is not $EXPECT_PID" 4
  { echo "STEPA_AT=$(date -u +%FT%TZ)"; echo "PID=$(systemctl show -p MainPID --value afldb)"; echo "NRESTARTS=$(systemctl show -p NRestarts --value afldb)"; echo "ACTIVE_ENTER=$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb)"; } > "$PKGROOT/step-a.txt"
  cat "$PKGROOT/step-a.txt"
  bash "$CHK/$CPROD_REL" c4b-pre "$N" "$FEED" | tee "$PKGROOT/c4b-pre.txt" | tail -25
  grep -q '^C4B-PRE PASS$' "$PKGROOT/c4b-pre.txt" || stop "c4b-pre did not end C4B-PRE PASS" 5
  echo "STEP-A PASS"
  ;;
launch)
  EVD=${3:?evidence directory}
  case "$EVD" in /home/arm/backups/afldb/c4b-*-r2) ;; *) [ "$MODE" = --probe-only ] || stop "evidence directory must be /home/arm/backups/afldb/c4b-<rev8>-r2" 2;; esac
  echo "== launch ($MODE) $(date -u +%FT%TZ) N=$N evidence=$EVD"
  clean_at
  [ -x "$NODE" ] && [ "$("$NODE" -v)" = v22.23.2 ] || stop "pinned node $NODE is missing or not v22.23.2" 4
  [ ! -e "$EVD" ] || stop "evidence directory already exists (the tool would refuse it)" 5
  case "$EVD" in "$CHK"|"$CHK"/*) stop "evidence directory is inside the checkout" 5;; esac
  command -v tmux > /dev/null || stop "tmux is not installed" 4
  [ -z "$(tmux ls 2>/dev/null | grep -i c4b || true)" ] || stop "a c4b tmux session already exists" 4
  if [ "$MODE" = run ]; then
    [ -z "$(pgrep -f '[a]fl-api-c4b-rehearsal|[s]ettle-afl-api|[a]cquire-afl-api' || true)" ] || stop "a C4b/settle/acquire process is running" 4
    [ -d "$PKGROOT" ] && [ "$(sha256sum < "$FEED" | cut -c1-64)" = "$FEED_SHA" ] || stop "step-a has not been run (no pinned feed copy)" 5
    grep -q '^C4B-PRE PASS$' "$PKGROOT/c4b-pre.txt" || stop "no C4B-PRE PASS record" 5
    LOGDIR=$PKGROOT
  else
    LOGDIR=$(dirname "$EVD"); [ -d "$LOGDIR" ] && [ -w "$LOGDIR" ] || stop "probe log directory $LOGDIR is not writable" 4
  fi
  # Probe: the SAME kind of command the real launch uses (absolute node, explicit PATH, a non-login tmux shell), proving node resolves INSIDE tmux.
  PROBE=$LOGDIR/tmux-node-probe-${N:0:8}.txt; rm -f "$PROBE"
  tmux new-session -d -s "$SESSION-probe" -c "$CHK" "/usr/bin/env PATH=$TPATH $NODE -e 'console.log(process.version, process.execPath)' > $PROBE 2>&1; echo \$? >> $PROBE"
  for _ in $(seq 1 20); do [ -s "$PROBE" ] && [ "$(wc -l < "$PROBE")" -ge 2 ] && break; sleep 1; done
  tmux kill-session -t "$SESSION-probe" 2>/dev/null || true
  cat "$PROBE" 2>/dev/null
  [ "$(sed -n 1p "$PROBE")" = "v22.23.2 $NODE" ] && [ "$(sed -n 2p "$PROBE")" = 0 ] || stop "node did not run inside tmux (probe failed; the tool was NOT started)" 4
  echo "tmux node probe PASS"
  if [ "$MODE" = --probe-only ]; then echo "LAUNCH PROBE-ONLY PASS (the tool was not started)"; exit 0; fi
  LOG=$PKGROOT/c4b-run.log; EXITF=$PKGROOT/c4b-run.exit
  [ ! -e "$LOG" ] && [ ! -e "$EXITF" ] || stop "a previous run log/exit file exists in $PKGROOT" 5
  # THE ONE RUN. Separate argv, no profile, no login shell: everything it needs is in the command.
  tmux new-session -d -s "$SESSION" -c "$CHK" "/usr/bin/env PATH=$TPATH $NODE node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts --season 2027 --decision D-316-13 --evidence-dir $EVD --max-minutes 30 > $LOG 2>&1; echo \$? > $EXITF"
  sleep 2
  echo "started tmux session $SESSION at $(date -u +%FT%TZ); log $LOG; exit code file $EXITF (written when the tool ends)"
  echo "LAUNCH STARTED (the tool is running or has finished; do NOT start it again whatever the result)"
  ;;
step-c)
  EVD=${3:?evidence directory}
  echo "== step-c $(date -u +%FT%TZ) exit=$(cat "$PKGROOT/c4b-run.exit" 2>&1)"
  # shellcheck disable=SC1090
  . "$PKGROOT/step-a.txt"
  echo "HEAD=$(git -C "$CHK" rev-parse HEAD) porcelain=$(git -C "$CHK" status --porcelain | wc -l)"
  echo "afldb MainPID=$(systemctl show -p MainPID --value afldb) (was $PID) NRestarts=$(systemctl show -p NRestarts --value afldb) (was $NRESTARTS) ActiveEnter=$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb) (was $ACTIVE_ENTER)"
  for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer afldb-settle-afltables.timer; do echo "$u active=$(systemctl is-active "$u") enabled=$(systemctl is-enabled "$u" 2>&1)"; done
  echo "--- evidence dir"; ls -la "$EVD"; ( cd "$EVD" && find . -type f -print0 | sort -z | xargs -0 sha256sum )
  echo "--- result.json"; cat "$EVD/result.json"
  echo "--- snapshots"; ls -la "$CHK/data/sources/afl_api/matches" | cat
  echo "--- tmux"; tmux ls 2>&1
  echo "--- database (read-only; the packaged reader definitions, no phase is run)"
  P=$CHK/$CPROD_REL
  [ "$(sha256sum < "$P" | cut -c1-64)" = "$CPROD_SHA" ] || stop "c-prod.sh is not the pinned bytes" 3
  set -- x
  # shellcheck disable=SC1090
  source <(sed -n '14,18p;20,75p' "$P")
  backup_identity
  echo "setting=[$(setting_raw)]"
  echo "--- audit rows by the rehearsal tool"
  q -c "SELECT id, at, actor_label, action, detail::text FROM auth_audit_log WHERE actor_label='afl-api-c4b-rehearsal' ORDER BY id" 2>&1
  echo "--- canonical counts (season 2027 matches; afl_api-owned matches; import batches in the last hour)"
  q -c "SELECT (SELECT count(*) FROM matches WHERE season=2027), (SELECT count(*) FROM matches m JOIN sources s ON s.id=m.source_id WHERE s.key='afl_api')" 2>&1
  q -c "SELECT count(*), max(created_at) FROM import_batches WHERE created_at > now() - interval '1 hour'" 2>&1
  unset PGPASSWORD
  echo "STEP-C DONE (read-only; the verdict is in result.json above; the reviewer records it)"
  ;;
*) stop "unknown phase" 2 ;;
esac
