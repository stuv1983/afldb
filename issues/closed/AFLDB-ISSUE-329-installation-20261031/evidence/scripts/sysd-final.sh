#!/bin/bash
# AFLDB-ISSUE-329 final real-systemd proof (F1-F7). Run as root in the rehearsal distro.
# Tool, unit and drop-in come from the exact candidate merge tree (git archive of 6790983a).
# Nothing here builds the application; both releases are existing validated artifacts.
set -u
R=/home/rehearsal/afldb-329-proof-20261030T233836Z
C=$R/candidate-6790983a
F=$R/sysd-final-root
E=$R/final-proof-20261031
U=afldb-r329f
NODE=/opt/node-v22.21.0-linux-x64/bin/node
CHECKOUT=$R/tools-checkout
ID_A=5bf6942f475d-gC9Y3ew1t8MqKAeq01-8D        # S1 in-place bundle, adopted by manifest
ID_B=1a95a5c3b730-o-bFsiDenQy8syPTbRMwz        # m7, built + V1-V7 validated by the final tool
REV_A=5bf6942f475d0ef1f0d867fe9076727b32102514
MANIFEST_A=$R/systemd-proof/inplace-manifest.sha256
BASE=http://127.0.0.1:3100
RUID=$(id -u rehearsal); RGID=$(id -g rehearsal)
mkdir -p "$E"; chown rehearsal:rehearsal "$E"
LOG=$E/proof.log
exec > >(tee "$LOG") 2>&1
T() { runuser -u rehearsal -- env PATH=/opt/node-v22.21.0-linux-x64/bin:/usr/bin:/bin "$NODE" "$C/deploy/release.mjs" "$@" --root "$F" --unit "$U"; }
step() { echo; echo "=== $* ($(date -u +%T)Z)"; }
die() { echo "PROOF FAIL: $*"; exit 1; }
cleanup() {
  step "F7 cleanup: stop and remove the test unit; remove the temporary .env (root, releases and logs kept)"
  [ -n "${PROBER:-}" ] && kill "$PROBER" 2>/dev/null
  systemctl stop $U 2>/dev/null
  rm -rf /etc/systemd/system/$U.service /etc/systemd/system/$U.service.d
  systemctl daemon-reload; systemctl reset-failed $U 2>/dev/null
  rm -f "$CHECKOUT/.env"
  systemctl cat $U >/dev/null 2>&1 && echo "unit still present!" || echo "unit removed"
  [ -e "$CHECKOUT/.env" ] && echo ".env still present!" || echo "temporary .env removed"
}
trap cleanup EXIT
wait_health() {
  for i in $(seq 1 120); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/health)" = 200 ] && { echo "healthy after $((i*250)) ms"; return 0; }
    sleep 0.25
  done
  return 1
}
asset_check() { # $1 release id: CSS + _buildManifest served bytes must equal the release's files
  local rel=$F/releases/$1 bid css path code ctype
  bid=$(cat "$rel/.next/standalone/.next/BUILD_ID")
  css=$(cd "$rel/.next/standalone/.next/static" && ls css/*.css | head -1)
  for path in "static/css/${css#css/}" "static/$bid/_buildManifest.js"; do
    read -r code ctype < <(curl -s -o "$E/asset.tmp" -w '%{http_code} %{content_type}\n' "$BASE/_next/$path")
    local want got; want=$(sha256sum < "$rel/.next/standalone/.next/$path" | cut -c1-64); got=$(sha256sum < "$E/asset.tmp" | cut -c1-64)
    echo "asset /_next/$path $code $ctype bytes $( [ "$want" = "$got" ] && echo "= release file ${want:0:12}" || echo "DIFFER (want ${want:0:12} got ${got:0:12})")"
    [ "$code" = 200 ] && [ "$want" = "$got" ] || return 1
  done
  rm -f "$E/asset.tmp"
}
identity_since() { journalctl -u $U --since "@$1" -o cat --no-pager | grep '\[afldb\] serving build' | tail -1; }
in_ns() { nsenter -t "$(systemctl show -p MainPID --value $U)" -m "$@"; }

step "F0 identities"
echo "host $(hostname) $(uname -r); $(systemctl --version | head -1); node $($NODE -v)"
( cd "$C" && sha256sum deploy/release.mjs deploy/server-cluster.mjs deploy/afldb.service deploy/afldb.service.d/release-route.conf tools/build/env-in-standalone.mjs )
[ -e "$F" ] && die "$F already exists"
[ -e "$CHECKOUT/.env" ] && die "$CHECKOUT/.env already exists"
ss -ltn | grep -qE ':(3100|3199)\b' && die "port 3100/3199 in use"
echo "manifest A $(sha256sum < "$MANIFEST_A" | cut -c1-64) ($(wc -l < "$MANIFEST_A") files); in-place BUILD_ID $(cat $CHECKOUT/.next/standalone/.next/BUILD_ID)"
( cd "$CHECKOUT/.next/standalone" && sha256sum --quiet -c "$MANIFEST_A" ) && echo "in-place bundle matches manifest A" || die "in-place bundle drifted"
echo "release B (source) manifest $(sha256sum < $R/release-root/releases/$ID_B/MANIFEST.sha256 | cut -c1-64)"
install -m 600 -o rehearsal -g rehearsal "$R/build.env" "$CHECKOUT/.env"
echo "temporary .env installed in the checkout stand-in (names: $(sed -E 's/=.*//' "$CHECKOUT/.env" | tr '\n' ' '))"

step "F1 adopt the validated in-place bundle by its recorded manifest"
runuser -u rehearsal -- mkdir -p "$F"
T adopt --checkout "$CHECKOUT" --revision $REV_A --afldb-env production --expect-build-id gC9Y3ew1t8MqKAeq01-8D --from-manifest "$MANIFEST_A" || die adopt
T verify $ID_A || die "verify A"

step "F2 install the unit and the drop-in as separate files (candidate tree, retargeted only at the private root)"
sed -e "s#/home/arm/projects/afldb#$CHECKOUT#g" \
    -e "s#/home/arm/.nvm/versions/node/v22.23.2/bin/node#$NODE#" \
    -e 's#^User=arm#User=rehearsal#' -e 's#^Group=arm#Group=rehearsal#' \
    -e 's#^After=network-online.target postgresql.service#After=network-online.target#' \
    -e '/^Requires=postgresql.service/d' \
    "$C/deploy/afldb.service" > /etc/systemd/system/$U.service
mkdir -p /etc/systemd/system/$U.service.d
sed -e "s#/home/arm/afldb-releases#$F#g" "$C/deploy/afldb.service.d/release-route.conf" > /etc/systemd/system/$U.service.d/release-route.conf
echo "--- unit vs deploy/afldb.service"; diff "$C/deploy/afldb.service" /etc/systemd/system/$U.service
echo "--- drop-in vs deploy/afldb.service.d/release-route.conf"; diff "$C/deploy/afldb.service.d/release-route.conf" /etc/systemd/system/$U.service.d/release-route.conf
systemctl daemon-reload
systemctl show $U -p DropInPaths -p WorkingDirectory -p ReadWritePaths -p ProtectSystem -p ProtectHome -p PrivateTmp -p NoNewPrivileges -p User -p UnsetEnvironment --no-pager
systemctl show $U -p ExecStart --value | cut -c1-120

step "F3 start through the release route; identity and assets"
t0=$(date +%s); systemctl start $U || die start
wait_health || die "no health after start"
T status --expect $ID_A || die "status A"
echo "journal: $(identity_since $t0)"
identity_since $t0 | grep -q "release $ID_A revision $REV_A" || die "identity line A"
asset_check $ID_A || die "assets A"
echo "/ $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' $BASE/); /beta $(curl -s -o /dev/null -w '%{http_code}' $BASE/beta) (beta gate on, no claim)"

step "F4 filesystem restrictions of the running service (inside its mount namespace)"
PID=$(systemctl show -p MainPID --value $U)
echo "MainPID $PID user $(ps -o user= -p $PID) cwd $(readlink /proc/$PID/cwd)"
REL_A=$(readlink -f $F/releases/$ID_A)
probe_w() { # $1 label, $2 path, $3 expected (ok|EROFS), $4.. setpriv args
  local label=$1 path=$2 want=$3; shift 3
  local out; out=$(in_ns "$@" touch "$path" 2>&1); local rc=$?
  [ $rc -eq 0 ] && in_ns rm -f "$path"
  local got=ok; [ $rc -ne 0 ] && got=$(echo "$out" | grep -oE 'Read-only file system|Permission denied' | head -1)
  echo "$label: $path -> ${got:-$out} (expected $want)"
  case $want in ok) [ $rc -eq 0 ];; EROFS) [ "$got" = 'Read-only file system' ];; esac
}
AS_SVC=(-S $RUID -G $RGID)
ok=1
probe_w "service user, own release ISR cache" "$REL_A/.next/standalone/.next/cache/r329f-probe" ok "${AS_SVC[@]}" || ok=0
probe_w "root in namespace, checkout"       "$CHECKOUT/r329f-probe" EROFS || ok=0
probe_w "root in namespace, checkout .env dir" "$CHECKOUT/.env.r329f-probe" EROFS || ok=0
probe_w "root in namespace, release root (links)" "$F/r329f-probe" EROFS || ok=0
probe_w "root in namespace, /etc (ProtectSystem=strict)" "/etc/r329f-probe" EROFS || ok=0
probe_w "root in namespace, /usr" "/usr/r329f-probe" EROFS || ok=0
probe_w "root in namespace, another home path" "/home/rehearsal/r329f-probe" EROFS || ok=0
out=$(in_ns ln -sfn releases/x "$F/current" 2>&1) && { echo "current link writable!"; ok=0; } || echo "replace current symlink -> $(echo "$out" | grep -oE 'Read-only file system')"
echo "PrivateTmp: host /tmp entries visible inside: $(in_ns ls -A /tmp | wc -l) (host has $(ls -A /tmp | wc -l))"
[ $ok = 1 ] || die "sandbox"
echo "note: the whole releases/ directory is writable by design (drop-in grants it), so a retained release is writable by the service; verify/promote/rollback refuse a drifted release (L9)"

step "F5 promote another validated release (m7, no rebuild); restart; identity and assets"
mkdir -p "$F/builds/import-m7"; chown rehearsal:rehearsal "$F/builds/import-m7"
runuser -u rehearsal -- cp -a "$R/release-root/releases/$ID_B" "$F/builds/import-m7/candidate" || die "copy m7"
runuser -u rehearsal -- mv "$F/builds/import-m7/candidate" "$F/releases/$ID_B" || die "rename m7"
echo "m7 copied byte-for-byte (cp -a) from release-root and renamed into releases/"
T verify $ID_B || die "verify B"
T promote $ID_B || die "promote B"
T status --expect $ID_B && die "status passed before restart" || echo "status before restart: FAIL (expected: restart pending)"
( while [ ! -e "$E/stop-probe" ]; do printf '%s %s\n' "$(date +%s.%N | cut -c1-14)" "$(curl -s -o /dev/null -m 2 -w '%{http_code}' $BASE/api/health)"; sleep 0.1; done ) > "$E/probe-restart-B.txt" & PROBER=$!
sleep 1; t0=$(date +%s); systemctl restart $U || die "restart B"
wait_health || die "no health after restart B"
sleep 1; touch "$E/stop-probe"; wait $PROBER; PROBER=; rm -f "$E/stop-probe"
echo "restart probe (health every 100 ms): $(wc -l < $E/probe-restart-B.txt) probes, $(grep -vc ' 200$' $E/probe-restart-B.txt) non-200 (window $(awk '$2!=200{if(!a)a=$1;b=$1}END{if(a)printf "%.1f s",b-a+0.1;else print "none"}' $E/probe-restart-B.txt))"
T status --expect $ID_B || die "status B"
echo "journal: $(identity_since $t0)"
identity_since $t0 | grep -q "release $ID_B revision 1a95a5c3b730f01982119ba67490a0c60d697090" || die "identity line B"
asset_check $ID_B || die "assets B"

step "F6 roll back to the retained adopted release without rebuilding; restart; identity and assets"
before=$(ls -A "$F/builds" | sort | tr '\n' ' ')
t1=$(date +%s.%N); T rollback || die rollback; t2=$(date +%s.%N)
after=$(ls -A "$F/builds" | sort | tr '\n' ' ')
echo "rollback took $(awk "BEGIN{printf \"%.1f\", $t2-$t1}") s; builds/ before: [$before] after: [$after]"
[ "$before" = "$after" ] || die "rollback created a workspace"
t0=$(date +%s); systemctl restart $U || die "restart A"
wait_health || die "no health after restart A"
T status --expect $ID_A || die "status A after rollback"
echo "journal: $(identity_since $t0)"
identity_since $t0 | grep -q "release $ID_A revision $REV_A" || die "identity line A after rollback"
asset_check $ID_A || die "assets A after rollback"
echo "B's BUILD_ID now: $(curl -s -o /dev/null -w '%{http_code}' $BASE/_next/static/o-bFsiDenQy8syPTbRMwz/_buildManifest.js) (expect 404)"
T verify $ID_A || die "verify A after serving"
T verify $ID_B || die "verify B after serving"
echo "--- events.log"; cat "$F/events.log"
echo; echo "PROOF PASS"
