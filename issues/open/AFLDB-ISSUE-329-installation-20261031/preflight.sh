#!/bin/bash
# AFLDB-ISSUE-329 installation preflight. READ-ONLY: it changes nothing, stops nothing, starts nothing.
#
#   bash preflight.sh install <candidate-sha>   before the adopt + drop-in installation (package §3)
#   bash preflight.sh build   <candidate-sha>   before the first build through the route (package §5)
#
# Run as arm from the serving checkout. Prints one line per check and ends with PREFLIGHT PASS or
# PREFLIGHT STOP. A STOP is final for this window: do not add swap, stop the service or lower a
# threshold to get past it; report the output to the owner. The environment overrides below exist
# only so the script can be rehearsed off-host.
set -u
MODE=${1:-}; CAND=${2:-}
CHECKOUT=${CHECKOUT:-/home/arm/projects/afldb}
ROOT=${ROOT:-/home/arm/afldb-releases}
UNIT=${UNIT:-afldb}
NODE=${NODE:-/home/arm/.nvm/versions/node/v22.23.2/bin/node}
EXPECT_USER=${EXPECT_USER:-arm}
MANIFEST=${MANIFEST:-/home/arm/backups/afldb/release-v2-20261030T210000Z/standalone-manifest.sha256}
MANIFEST_SHA=${MANIFEST_SHA:-b8a0c6d33b9fd623185b2b2e08fd9b041b973602db82e93eefae520b4b556a29}
MANIFEST_FILES=${MANIFEST_FILES:-12994}
INPLACE_BUILD_ID=${INPLACE_BUILD_ID:-QNEHXAtU53TzUjj0Mb7mv}
ADOPT_ID=${ADOPT_ID:-9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv}
PROD_REV=${PROD_REV:-9ed9c9dd3e84682c43e96c46e98974b245eb54ed}
CODE_BASE=${CODE_BASE:-6790983ab3d3ae5292ad8a311c203e2584bd04a5}   # the typechecked merge tree
SHA_RELEASE=${SHA_RELEASE:-f5a24a71e5cdef24f9b7aeba428c7c89e02353fa5f123da12ea37b94514e6b4b}
SHA_DROPIN=${SHA_DROPIN:-14942fc53421ff60eddb738b338e7a3db38a22429839fb4eabd8978edea1f5ff}
SHA_CLUSTER=${SHA_CLUSTER:-d82f24c48e2bc310857826e8fecc2e5ad90381ec3267c0d1ddba5ae19a822865}
SHA_ENVSCAN=${SHA_ENVSCAN:-99ed47c6d673e6dd1f9c789097be202e704162edcc98623e7182bac9d58635c2}
MIN_FREE_GB=${MIN_FREE_GB:-6}                      # the build route's own admission floor; PostgreSQL shares the disk
MIN_AVAIL_INSTALL_MB=${MIN_AVAIL_INSTALL_MB:-800}  # adopt hashes and copies; it needs little memory
MIN_AVAIL_BUILD_MB=${MIN_AVAIL_BUILD_MB:-2100}     # release.mjs admission for --typecheck off-host (§7)

fails=0
ok()   { echo "  ok    $*"; }
stop() { echo "  STOP  $*"; fails=$((fails + 1)); }
info() { echo "  info  $*"; }
case $MODE in install|build) ;; *) echo "usage: bash preflight.sh install|build <candidate-sha>"; exit 2;; esac
[[ $CAND =~ ^[0-9a-f]{40}$ ]] || { echo "usage: the candidate must be a full 40-hex SHA"; exit 2; }
echo "AFLDB-ISSUE-329 preflight ($MODE) $(date -u +%FT%TZ) on $(hostname)"

echo "identity"
[ "$(id -un)" = "$EXPECT_USER" ] && ok "user $(id -un)" || stop "user is $(id -un), expected $EXPECT_USER"
cd "$CHECKOUT" 2>/dev/null || { stop "cannot enter $CHECKOUT"; echo "PREFLIGHT STOP ($fails)"; exit 1; }
head=$(git rev-parse HEAD 2>/dev/null)
if [ "$MODE" = install ]; then
  case $head in
    "$PROD_REV") ok "checkout HEAD $head (production; step 1 fast-forwards it)";;
    "$CAND") ok "checkout HEAD $head (already the candidate)";;
    *) stop "checkout HEAD $head is neither $PROD_REV nor the candidate";;
  esac
  git merge-base --is-ancestor "$PROD_REV" "$CAND" 2>/dev/null && ok "candidate descends from $PROD_REV (fast-forward)" \
    || stop "candidate $CAND is not a fast-forward of $PROD_REV (or is not fetched)"
else
  [ "$head" = "$CAND" ] && ok "checkout HEAD is the candidate" || stop "checkout HEAD $head, expected $CAND"
fi
[ -z "$(git status --porcelain)" ] && ok "checkout porcelain clean" || stop "checkout has uncommitted or untracked changes"
others=$(git diff --name-only "$CODE_BASE" "$CAND" 2>/dev/null | grep -vE '^(issues/|docs/)|\.md$' || true)
git cat-file -e "$CODE_BASE^{commit}" 2>/dev/null && [ -z "$others" ] \
  && ok "candidate differs from the typechecked tree $CODE_BASE only in issues/, docs/ or Markdown" \
  || stop "candidate differs from $CODE_BASE outside documentation: ${others:-<base commit missing>}"
[ -z "$(git diff --name-only "$PROD_REV" "$CAND" -- src/db/migrations 2>/dev/null)" ] \
  && ok "no migration between $PROD_REV and the candidate (forward-only rule not engaged)" \
  || stop "the candidate adds migrations; this package does not cover them"
for pair in "deploy/release.mjs:$SHA_RELEASE" "deploy/afldb.service.d/release-route.conf:$SHA_DROPIN" \
            "deploy/server-cluster.mjs:$SHA_CLUSTER" "tools/build/env-in-standalone.mjs:$SHA_ENVSCAN"; do
  f=${pair%%:*}; want=${pair#*:}
  got=$(git show "$CAND:$f" 2>/dev/null | sha256sum | cut -c1-64)
  [ "$got" = "$want" ] && ok "$f ${want:0:12}… at the candidate" || stop "$f at the candidate is ${got:0:12}…, expected ${want:0:12}…"
done
[ -x "$NODE" ] && ok "node $NODE $("$NODE" -v)" || stop "pinned node $NODE missing"

echo "service"
prop() { systemctl show "$UNIT" -p "$1" --value; }
ActiveState=$(prop ActiveState); MainPID=$(prop MainPID); NRestarts=$(prop NRestarts)
WorkingDirectory=$(prop WorkingDirectory); DropInPaths=$(prop DropInPaths); ExecStart=$(prop ExecStart)
[ "$ActiveState" = active ] && ok "$UNIT active, MainPID $MainPID, NRestarts $NRestarts" || stop "$UNIT is $ActiveState"
journalctl -u "$UNIT" -n 1 -q --no-pager 2>/dev/null | grep -q . && info "journal readable by $(id -un)" \
  || info "journal NOT readable by $(id -un): post-install-check.sh will report the journal UNVERIFIED and print the owner's sudo commands"
case $ExecStart in *" deploy/server-cluster.mjs "*|*" deploy/server-cluster.mjs;"*) ok "ExecStart runs the relative deploy/server-cluster.mjs";;
  *) stop "ExecStart is not the relative deploy/server-cluster.mjs: ${ExecStart:0:160}";; esac
cwd=$(readlink "/proc/$MainPID/cwd" 2>/dev/null || echo unreadable)
if [ "$MODE" = install ]; then
  [ -z "$DropInPaths" ] && ok "no drop-in installed" || stop "drop-ins already present: $DropInPaths"
  [ "$WorkingDirectory" = "$CHECKOUT" ] && [ "$cwd" = "$CHECKOUT" ] && ok "serving in place from $CHECKOUT" \
    || stop "unit WorkingDirectory $WorkingDirectory, process cwd $cwd; expected $CHECKOUT"
else
  case $DropInPaths in *release-route.conf*) ok "release-route drop-in active";; *) stop "release-route drop-in not active ($DropInPaths)";; esac
  cur=$(readlink -f "$ROOT/current" 2>/dev/null)
  [ -n "$cur" ] && [ "$cwd" = "$cur" ] && ok "serving from current $(basename "$cur")" || stop "process cwd $cwd is not current ($cur)"
fi

echo "artifacts"
if [ "$MODE" = install ]; then
  a=$(cat .next/BUILD_ID 2>/dev/null); b=$(cat .next/standalone/.next/BUILD_ID 2>/dev/null)
  [ "$a" = "$INPLACE_BUILD_ID" ] && [ "$b" = "$INPLACE_BUILD_ID" ] && ok "in-place BUILD_ID $b" || stop "in-place BUILD_ID .next=$a standalone=$b, expected $INPLACE_BUILD_ID"
  [ "$(sha256sum < "$MANIFEST" 2>/dev/null | cut -c1-64)" = "$MANIFEST_SHA" ] && ok "manifest ${MANIFEST_SHA:0:12}… intact" || stop "manifest $MANIFEST missing or changed"
  n=$(grep -cE '^[0-9a-f]{64}  ' "$MANIFEST" 2>/dev/null); s=$(grep -c '^SYMLINK' "$MANIFEST" 2>/dev/null)
  [ "$n" = "$MANIFEST_FILES" ] && [ "$s" = 0 ] && ok "manifest lists $n files, 0 symlinks" || stop "manifest lists $n files and $s symlinks; expected $MANIFEST_FILES and 0"
  if [ ! -e "$ROOT" ] || [ -z "$(ls -A "$ROOT" 2>/dev/null)" ]; then ok "release root $ROOT absent or empty"
  else stop "release root $ROOT already has content: $(ls -A "$ROOT" | tr '\n' ' ')"; fi
else
  [ -d "$ROOT/releases/$ADOPT_ID" ] && ok "adopted release $ADOPT_ID retained (the rollback target)" || stop "adopted release $ADOPT_ID missing"
  grep -q "\"op\":\"status-pass\",\"id\":\"$ADOPT_ID\"" "$ROOT/events.log" 2>/dev/null && ok "adopted release has a recorded status PASS" \
    || stop "adopted release has no status PASS in events.log"
  for l in build links; do [ ! -e "$ROOT/$l.lock" ] && ok "no $l.lock" || stop "$ROOT/$l.lock present: $(cat "$ROOT/$l.lock" 2>/dev/null)"; done
  (exec 3<>/dev/tcp/127.0.0.1/3199) 2>/dev/null && stop "smoke port 3199 is in use" || ok "smoke port 3199 free"
fi

echo "capacity"
d=$ROOT; [ -e "$d" ] || d=$(dirname "$ROOT")
free_gb=$(df -P -BG "$d" | awk 'NR==2 {sub("G","",$4); print $4}')
[ "$free_gb" -ge "$MIN_FREE_GB" ] && ok "free disk under $d: ${free_gb} GB (floor $MIN_FREE_GB)" || stop "free disk ${free_gb} GB below $MIN_FREE_GB GB"
avail=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo); total=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)
swap=$(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo)
mem=$(systemctl show "$UNIT" -p MemoryCurrent --value); [[ $mem =~ ^[0-9]+$ ]] && mem="$((mem / 1048576)) MB" || mem=n/a
info "MemTotal ${total} MB, MemAvailable ${avail} MB, swap ${swap} MB, $UNIT MemoryCurrent $mem"
floor=$MIN_AVAIL_INSTALL_MB; [ "$MODE" = build ] && floor=$MIN_AVAIL_BUILD_MB
[ "$avail" -ge "$floor" ] && ok "MemAvailable ${avail} MB ≥ ${floor} MB" \
  || stop "MemAvailable ${avail} MB below ${floor} MB: do not add swap, stop the service or lower a threshold; report to the owner (§7)"

if [ $fails -eq 0 ]; then echo "PREFLIGHT PASS ($MODE)"; exit 0; fi
echo "PREFLIGHT STOP ($fails)"; exit 1
