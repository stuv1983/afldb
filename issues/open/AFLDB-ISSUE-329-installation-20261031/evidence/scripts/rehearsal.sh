#!/bin/bash
# AFLDB-ISSUE-329 package dress rehearsal (R0-R9). Run as root in the rehearsal distro.
# Starts from production's present layout (unit without drop-in, serving the in-place bundle) and runs the
# package's own scripts and commands, retargeted only by environment overrides and paths.
set -u
R=/home/rehearsal/afldb-329-proof-20261030T233836Z
C=$R/candidate-6790983a
P=$R/final-proof-20261031/pkg-under-test
S=/mnt/c/Users/stuar/AppData/Local/Temp/claude/D--dev-afldbV2/35e65da4-c177-4941-b84d-de349e1323f7/scratchpad
E=$R/final-proof-20261031
U=afldb-r329r
NODE=/opt/node-v22.21.0-linux-x64/bin/node
CO=$R/tools-checkout
ROOT=$R/rehearsal-root
ID_A=5bf6942f475d-gC9Y3ew1t8MqKAeq01-8D; BUILD_A=gC9Y3ew1t8MqKAeq01-8D
ID_B=1a95a5c3b730-o-bFsiDenQy8syPTbRMwz; BUILD_B=o-bFsiDenQy8syPTbRMwz
LOG=$E/rehearsal.log
exec > >(tee "$LOG") 2>&1
mkdir -p "$P"; cp "$S/pkg/preflight.sh" "$S/pkg/post-install-check.sh" "$P/"   # the package scripts under test
export CHECKOUT=$CO ROOT UNIT=$U NODE EXPECT_USER=rehearsal LOCAL=http://127.0.0.1:3100 PUBLIC=http://127.0.0.1:3100 \
  MANIFEST=$R/systemd-proof/inplace-manifest.sha256 MANIFEST_SHA=41e14531bed1457cc3a646b3b58070b64a6a7a8ac2f12eb42561e5b2f7f8bb58 \
  MANIFEST_FILES=2935 INPLACE_BUILD_ID=$BUILD_A ADOPT_ID=$ID_A PROD_REV=5bf6942f475d0ef1f0d867fe9076727b32102514 \
  CODE_BASE=1a95a5c3b730f01982119ba67490a0c60d697090
CAND=1a95a5c3b730f01982119ba67490a0c60d697090
AS() { runuser -u rehearsal -- env PATH=/opt/node-v22.21.0-linux-x64/bin:/usr/bin:/bin CHECKOUT="$CHECKOUT" ROOT="$ROOT" UNIT="$UNIT" NODE="$NODE" \
  EXPECT_USER="$EXPECT_USER" LOCAL="$LOCAL" PUBLIC="$PUBLIC" MANIFEST="$MANIFEST" MANIFEST_SHA="$MANIFEST_SHA" MANIFEST_FILES="$MANIFEST_FILES" \
  INPLACE_BUILD_ID="$INPLACE_BUILD_ID" ADOPT_ID="$ADOPT_ID" PROD_REV="$PROD_REV" CODE_BASE="$CODE_BASE" "$@"; }
TOOL() { AS bash -c "cd '$CO' && '$NODE' '$C/deploy/release.mjs' \"\$@\" --root '$ROOT' --unit '$U'" _ "$@"; }
step() { echo; echo "=== $* ($(date -u +%T)Z)"; }
# Package pacing rule (unit StartLimitBurst=5 per 120 s counts manual restarts): wait 30 s after a start before the next restart.
LAST_START=$(date +%s)
paced_restart() { local w=$(( LAST_START + 30 - $(date +%s) )); [ $w -gt 0 ] && { echo "pacing: waiting ${w} s"; sleep $w; }
  local t=$(date +%s.%N); systemctl restart $U; local rc=$?; LAST_START=$(date +%s)
  echo "restart exit $rc after $(awk "BEGIN{printf \"%.1f\", $(date +%s.%N)-$t}") s"; return $rc; }
die() { echo "REHEARSAL FAIL: $*"; exit 1; }
cleanup() {
  step "R9 cleanup"
  systemctl stop $U 2>/dev/null; rm -rf /etc/systemd/system/$U.service /etc/systemd/system/$U.service.d
  systemctl daemon-reload; systemctl reset-failed $U 2>/dev/null; rm -f "$CO/.env"
  systemctl cat $U >/dev/null 2>&1 && echo "unit still present!" || echo "unit removed"; [ -e "$CO/.env" ] && echo ".env still present!" || echo "temporary .env removed"
}
trap cleanup EXIT
DROPIN_SRC=$C/deploy/afldb.service.d/release-route.conf
install_dropin() { mkdir -p /etc/systemd/system/$U.service.d; sed "s#/home/arm/afldb-releases#$ROOT#g" "$DROPIN_SRC" > /etc/systemd/system/$U.service.d/release-route.conf; }

step "R0 production's present layout: the unit without the drop-in, serving the in-place bundle"
[ -e "$ROOT" ] && die "$ROOT exists"; [ -e "$CO/.env" ] && die ".env exists"
install -m 600 -o rehearsal -g rehearsal "$R/build.env" "$CO/.env"
sed -e "s#/home/arm/projects/afldb#$CO#g" -e "s#/home/arm/.nvm/versions/node/v22.23.2/bin/node#$NODE#" \
    -e 's#^User=arm#User=rehearsal#' -e 's#^Group=arm#Group=rehearsal#' \
    -e 's#^After=network-online.target postgresql.service#After=network-online.target#' -e '/^Requires=postgresql.service/d' \
    "$C/deploy/afldb.service" > /etc/systemd/system/$U.service
systemctl daemon-reload; systemctl start $U; LAST_START=$(date +%s); sleep 2
PID=$(systemctl show -p MainPID --value $U); echo "MainPID $PID cwd $(readlink /proc/$PID/cwd); in-place _buildManifest $(curl -s -o /dev/null -w '%{http_code}' $LOCAL/_next/static/$BUILD_A/_buildManifest.js)"
git -C "$CO" -c safe.directory='*' status --porcelain | head -3; echo "(porcelain above; .env is ignored)"

step "R1 preflight install"
AS bash "$P/preflight.sh" install $CAND || die "preflight install"

step "R2 adopt (package §3.2 command, retargeted)"
TOOL adopt --checkout "$CO" --revision $PROD_REV --afldb-env production --expect-build-id $BUILD_A --from-manifest "$MANIFEST" || die adopt
TOOL verify $ID_A || die "verify A"
TOOL status --no-live || die "status --no-live"

step "R3 install the drop-in; daemon-reload; restart; post-install check"
install_dropin; systemctl daemon-reload
systemctl show $U -p DropInPaths -p WorkingDirectory -p ReadWritePaths --no-pager
paced_restart || die "restart R3"
AS bash "$P/post-install-check.sh" $ID_A || die "post-install A"

step "R4 back-out before any promotion: remove the drop-in; daemon-reload; restart; serving in place again"
rm /etc/systemd/system/$U.service.d/release-route.conf; rmdir /etc/systemd/system/$U.service.d; systemctl daemon-reload
paced_restart || die "restart R4"; sleep 2
PID=$(systemctl show -p MainPID --value $U); cwd=$(readlink /proc/$PID/cwd)
echo "DropInPaths=[$(systemctl show -p DropInPaths --value $U)] MainPID $PID cwd $cwd"
echo "health $(curl -s $LOCAL/api/health); in-place _buildManifest $(curl -s -o /dev/null -w '%{http_code}' $LOCAL/_next/static/$BUILD_A/_buildManifest.js)"
[ "$cwd" = "$CO" ] || die "back-out did not return to the checkout"
journalctl -u $U --since "@$(date -d "$(systemctl show -p ActiveEnterTimestamp --value $U)" +%s)" -o cat --no-pager | grep '\[afldb\]' | head -3

step "R5 re-install the drop-in; restart; post-install check"
install_dropin; systemctl daemon-reload; paced_restart || die "restart R5"
AS bash "$P/post-install-check.sh" $ID_A || die "post-install A (re-install)"

step "R6 preflight build"
AS bash "$P/preflight.sh" build $CAND || die "preflight build"

step "R7 promote a validated release (m7 stands in for the first route build; no build here); restart; check"
mkdir -p "$ROOT/builds/import-m7"; chown rehearsal:rehearsal "$ROOT/builds/import-m7"
AS cp -a "$R/release-root/releases/$ID_B" "$ROOT/builds/import-m7/candidate" && AS mv "$ROOT/builds/import-m7/candidate" "$ROOT/releases/$ID_B" || die "import m7"
TOOL verify $ID_B || die "verify B"
TOOL promote $ID_B || die "promote B"
paced_restart || die "restart"
AS bash "$P/post-install-check.sh" $ID_B $BUILD_A || die "post-install B"

step "R8 rollback to the retained adopted release; restart; check"
TOOL rollback || die rollback
paced_restart || die "restart"
AS bash "$P/post-install-check.sh" $ID_A $BUILD_B || die "post-install A after rollback"

step "R8b the start-limit hazard and its recovery (deliberate unpaced restarts)"
for i in 1 2 3 4 5 6; do systemctl restart $U >/dev/null 2>&1 && echo "unpaced restart $i ok" || { echo "unpaced restart $i FAILED: $(systemctl show -p Result --value $U)"; break; }; done
AS bash "$P/post-install-check.sh" $ID_A $BUILD_B && die "check passed on a stopped service" || echo "check FAILED as expected on the stopped service"
systemctl reset-failed $U && systemctl start $U && echo "recovered: reset-failed + start"
AS bash "$P/post-install-check.sh" $ID_A $BUILD_B || die "post-install after recovery"
echo "--- events.log"; cat "$ROOT/events.log"
echo; echo "REHEARSAL PASS"
