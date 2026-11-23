#!/usr/bin/env bash
# REHEARSAL ONLY: streamanator (DEV host), as arm, ONE ssh connection, disposable workspace under /mnt/ssd, cleaned on exit.
# Refuses on afldb-prod. Never contacts production or beta.afldb.com. Runs the release scripts from a CLEAN EXPORT (STAGE = a
# `git archive` of the script revision, hash-checked by the runbook's printed staging command) against:
#   * a disposable clone (bare "origin" from a bundle of 17822b29; checkout reset to 7d92042f on main) for P2's real fast-forward;
#   * a sandbox release root holding three releases whose deploy/server-cluster.mjs are the REAL Git blobs of c8d4202a, 7d92042f
#     and 17822b29 over a stub standalone server (rehearsal/stub-server.cjs), MANIFEST/release.json made by the candidate's own
#     release.mjs hashing; promote and rollback by the REAL release.mjs (--root, --pid, --skip-host-gate);
#   * a systemd USER unit with the production shape: base unit WorkingDirectory = the checkout, drop-in release-route.conf
#     WorkingDirectory = <root>/current, ExecStart `node deploy/server-cluster.mjs` (relative), EnvironmentFile = checkout .env.
# Usage: bash rehearse.sh <STAGE> <bundle> <node_modules dir whose package-lock sha256 = 17822b29's>
set -uo pipefail; export LC_ALL=C
STAGE=${1:?STAGE}; BUNDLE=${2:?bundle}; NM=${3:?node_modules}
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH; NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
R=$STAGE/docs/v2/evidence/release-17822b29-20261124; S=$R/scripts; H=$R/rehearsal; R6=$STAGE/docs/v2/evidence/backlog-20261121/r6-20261125
SERVE=7d92042fd11010eaa20966e2f49ae7a93e286568; CAND=17822b29e6de2b6248cd7ada4221800fd81e0003
OLD=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; OLDB=XWruOm_9nLCSMY8nGPqYU; PREV=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; PREVB=aATnIlFOIQjq2z5oDdoHC
NEWB=R1rehearsal0000000000a; NEW=17822b29e6de-$NEWB
SUP_OLD=d82f24c48e2bc310857826e8fecc2e5ad90381ec3267c0d1ddba5ae19a822865; SUP_NEW=4e8ea9b5be9cda02a6d1e7251a68ab95887be9a2bf055e67ed03703d1ff81a17
UNIT=afldb-r1-reh; UD=$HOME/.config/systemd/user; PORT=3271; SC="systemctl --user"
W=$(mktemp -d /mnt/ssd/afldb-r1-rehearsal.XXXXXX); ROOT=$W/afldb-releases; CHK=$W/chk
cleanup() {
  systemctl --user stop "$UNIT" 2>/dev/null; rm -rf "$UD/$UNIT.service" "$UD/$UNIT.service.d"; systemctl --user daemon-reload
  rm -rf "$W"; echo "CLEANUP unit removed, workspace $W removed: $([ -e "$W" ] && echo NO || echo yes)"
}
trap cleanup EXIT
P=0; F=0
ok()  { echo "REH PASS $1"; P=$((P+1)); }
no()  { echo "REH FAIL $1"; F=$((F+1)); }
t()   { local n=$1; shift; if ( "$@" ); then ok "$n"; else no "$n"; fi; }          # must succeed
tn()  { local n=$1; shift; if ( "$@" ); then no "$n (expected a refusal)"; else ok "$n (refused as expected)"; fi; }
up()  { for i in $(seq 1 60); do curl -s -m 2 "http://127.0.0.1:$PORT/api/health" | grep -q '"status":"ok"' && return 0; sleep 0.5; done; return 1; }
main_pid() { systemctl --user show "$UNIT" -p MainPID --value; }
serving_line() { journalctl --user -u "$UNIT" -o cat --no-pager 2>/dev/null | grep '\[afldb\] serving build' | tail -n 1; }
echo "== R1 REHEARSAL $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) workspace=$W stage=$STAGE"
[ "$(ss -ltn | grep -c ":$PORT ")" = 0 ] || { echo "STOP port $PORT busy"; exit 1; }
[ -z "$(ls -d /home/arm/r1-* 2>/dev/null)" ] || { echo "STOP /home/arm/r1-* already exists: inspect before rehearsing"; exit 1; }

echo "-- A. static checks and the production host guard (each production script refuses off afldb-prod)"
for f in "$S"/*.sh; do t "bash -n $(basename "$f")" bash -n "$f"; done
t "node --check r1-browser.cjs" "$NODE" --check "$S/r1-browser.cjs"
guard() { local out rc; out=$(bash "$@" < /dev/null 2>&1); rc=$?; [ $rc != 0 ] && grep -q 'STOP' <<< "$out"; }
t "guard r1-g0-dump.sh"        guard "$S/r1-g0-dump.sh" 2026-11-24
t "guard r1-p1-precheck.sh"    guard "$S/r1-p1-precheck.sh" "$CAND"
t "guard r1-p2-ff.sh"          guard "$S/r1-p2-ff.sh" "$CAND"
t "guard r1-p3-build.sh"       guard "$S/r1-p3-build.sh"
t "guard r1-p3b-build-check.sh" guard "$S/r1-p3b-build-check.sh" /home/arm/r1-build-20261124T000000Z.log
t "guard r1-p4-gate-promote.sh" guard "$S/r1-p4-gate-promote.sh" "$NEW"
t "guard r1-p5-accept.sh"      guard "$S/r1-p5-accept.sh" "$NEW" 0123456789abcdef0123456789abcdef
t "guard r1-rawhead.sh"        guard "$S/r1-rawhead.sh" baseline none
t "guard r1-p6-observe.sh"     guard "$S/r1-p6-observe.sh" "$NEW" 0123456789abcdef0123456789abcdef
t "guard r1-rollback.sh"       guard "$S/r1-rollback.sh" links
t "the guard runs wrote nothing in /home/arm (no r1-* file, no tmux session)" bash -c "[ -z \"\$(ls -d /home/arm/r1-* 2>/dev/null)\" ] && ! tmux has-session -t r1-build 2>/dev/null"
t "S9 refuses a non-loopback S9_BASE" bash -c "S9_BASE=https://example.invalid bash '$S/r1-s9-public-smoke.sh' a b; [ \$? = 2 ]"
t "browser refuses rehearsal seams against production" bash -c "R1_HEADLESS=1 '$NODE' '$S/r1-browser.cjs' none; [ \$? = 2 ]"
fn() { sed -n "/^$2() {/,/^}/p" "$1" | sha256sum | cut -c1-64; }
t "serving_identity identical in P1, P5 and rollback" bash -c "[ '$(fn "$S/r1-p1-precheck.sh" serving_identity)' = '$(fn "$S/r1-p5-accept.sh" serving_identity)' ] && [ '$(fn "$S/r1-p5-accept.sh" serving_identity)' = '$(fn "$S/r1-rollback.sh" serving_identity)' ]"
t "revalidate_ordinals identical in P5 and rollback" bash -c "[ '$(fn "$S/r1-p5-accept.sh" revalidate_ordinals)' = '$(fn "$S/r1-rollback.sh" revalidate_ordinals)' ]"
t "pick_overnight_dump identical to the reviewed R6 copy" bash -c "[ '$(fn "$S/r1-g0-dump.sh" pick_overnight_dump)' = '$(fn "$R6/r6-pre-verify.sh" pick_overnight_dump)' ]"
for f in r1-p1-precheck r1-p2-ff r1-p3b-build-check r1-p5-accept r1-rawhead r1-p6-observe r1-rollback r1-g0-dump; do R1_LIB_ONLY=1 . "$S/$f.sh"; done

echo "-- B. disposable Git: bare origin (main = 17822b29) and a checkout on main at 7d92042f"
git clone -q --bare "$BUNDLE" "$W/origin.git" && git -C "$W/origin.git" branch -m claude/release-17822b29-prep-20261123 main \
  && git -C "$W/origin.git" symbolic-ref HEAD refs/heads/main
git clone -q -b main "$W/origin.git" "$CHK" && git -C "$CHK" reset -q --hard "$SERVE"
t "checkout on main at 7d92042f, clean, origin/main = 17822b29" bash -c "[ \"\$(git -C '$CHK' rev-parse --abbrev-ref HEAD) \$(git -C '$CHK' rev-parse HEAD) \$(git -C '$CHK' rev-parse origin/main)\" = 'main $SERVE $CAND' ] && [ -z \"\$(git -C '$CHK' status --porcelain)\" ]"
PREVREV=$(git -C "$CHK" rev-parse "c8d4202a4cb3^{commit}")
SEC1=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'); SEC2=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
umask 077; printf '%s\n' "PORT=$PORT" AFLDB_WORKERS=2 AFLDB_BETA_GATE=on AFLDB_BETA_EPOCH=1 "AFLDB_SESSION_SECRET=$SEC1" \
  "AFLDB_REVALIDATE_URL=http://127.0.0.1:$PORT/api/internal/revalidate-season" "AFLDB_REVALIDATE_SECRET=$SEC2" > "$CHK/.env"; umask 022
t ".env is ignored (porcelain still empty)" bash -c "[ -z \"\$(git -C '$CHK' status --porcelain)\" ]"

echo "-- C. sandbox releases with the REAL supervisor blobs"
mk() { local id=$1 rev=$2 bid=$3 d=$ROOT/releases/$1
  mkdir -p "$d/deploy" "$d/.next/standalone/.next" && git -C "$CHK" show "$rev:deploy/server-cluster.mjs" > "$d/deploy/server-cluster.mjs" \
  && cp "$H/stub-server.cjs" "$d/.next/standalone/server.js" && printf '%s' "$bid" > "$d/.next/standalone/.next/BUILD_ID" \
  && "$NODE" "$H/make-release.mjs" "$CHK" "$d" "$id" "$rev" "$bid"; }
mkdir -p "$ROOT/releases"; mk "$PREV" "$PREVREV" "$PREVB"; mk "$OLD" "$SERVE" "$OLDB"; mk "$NEW" "$CAND" "$NEWB"
ln -s "releases/$OLD" "$ROOT/current"; ln -s "releases/$PREV" "$ROOT/previous"
t "7d92042f release supervisor = pinned $SUP_OLD and in its MANIFEST" release_pins "$ROOT/releases/$OLD" "$SERVE" "$SUP_OLD"
t "17822b29 release supervisor = pinned $SUP_NEW and in its MANIFEST (P3b rule)" release_pins "$ROOT/releases/$NEW" "$CAND" "$SUP_NEW"
cp -a "$ROOT/releases/$NEW" "$W/tamper" && printf '\n' >> "$W/tamper/deploy/server-cluster.mjs"
tn "P3b rule on a release whose supervisor changed by one byte" release_pins "$W/tamper" "$CAND" "$SUP_NEW"
tn "P3b rule on the right bytes but the wrong revision" release_pins "$ROOT/releases/$NEW" "$SERVE" "$SUP_NEW"
t "release.mjs verify $NEW (sandbox root)" "$NODE" "$CHK/deploy/release.mjs" verify "$NEW" --root "$ROOT"

echo "-- D. systemd user unit with the production shape"
mkdir -p "$UD/$UNIT.service.d"
printf '%s\n' '[Unit]' 'Description=AFLDB R1 rehearsal (disposable)' '[Service]' 'Type=simple' "WorkingDirectory=$CHK" "EnvironmentFile=$CHK/.env" \
  "ExecStart=$NODE deploy/server-cluster.mjs" 'Restart=no' > "$UD/$UNIT.service"
printf '%s\n' '[Service]' "WorkingDirectory=$ROOT/current" > "$UD/$UNIT.service.d/release-route.conf"
systemctl --user daemon-reload && systemctl --user start "$UNIT" && up || { echo "STOP unit did not come up"; journalctl --user -u "$UNIT" -n 20 --no-pager; exit 1; }
echo "serving line: $(serving_line)"
t "P1 route check: drop-in loaded, WorkingDirectory=<root>/current, relative ExecStart" service_route "$UNIT" "$ROOT" "$NODE"
t "P1 identity: primary in the 7d92042f release, supervisor d82f24c4, workers 1 and 2, names 1/1" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$OLD")" "$SUP_OLD"
tn "P1 identity with the 17822b29 supervisor pin" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$OLD")" "$SUP_NEW"
t "supervisor log names the 7d92042f release" bash -c "[[ '$(serving_line)' == *\"serving build $OLDB release $OLD revision $SERVE\"* ]]"
t "raw-head baseline on the old build (records /brownlow/1897 = 200 as the ISSUE-367 live control)" rawhead_run "$CHK/.env" "$PORT" baseline "$W/bl.json" 1897 ""
cp "$W/bl.json" "$W/sunday.json"
p6ok() { local g; g=$(p6_tick "$CHK/.env" "$PORT"); echo "  tick: $g"; [ "$g" = 'health=200:ok seasons=200:title-ok brownlow=200:title-ok' ]; }
t "P6 tick on the old build" p6ok

echo "-- E. P2: real fast-forward in the disposable checkout"
tn "P2 with an unexpected origin/main pin (remote drift stop)" bash -c "set -euo pipefail; R1_LIB_ONLY=1 . '$S/r1-p2-ff.sh'; p2_checks '$CHK' 0123456789abcdef0123456789abcdef01234567"
t "after the refusal the checkout is still 7d92042f" bash -c "[ \"\$(git -C '$CHK' rev-parse HEAD)\" = $SERVE ]"
t "P2 checks and --ff-only to exactly 17822b29" bash -c "set -euo pipefail; R1_LIB_ONLY=1 . '$S/r1-p2-ff.sh'; p2_checks '$CHK' $CAND"
t "P2 re-run is idempotent (no merge)" bash -c "set -euo pipefail; R1_LIB_ONLY=1 . '$S/r1-p2-ff.sh'; o=\$(p2_checks '$CHK' $CAND); grep -q 'NOTE start HEAD already CAND' <<< \"\$o\""
ln -s "$NM" "$CHK/node_modules"
RV=$(cd "$CHK" && npx --no-install tsx tools/maintenance/revalidate-season.ts --season 2026 2>&1); RC=$?; echo "$RV" | tail -n 2
t "17822b29 revalidate CLI against the old-build cluster: 2/2, ordinals 1 and 2" revalidate_ordinals "$RV" "$RC" 2026

echo "-- F. promote (real release.mjs): links switch, the running service does NOT change"
"$NODE" "$CHK/deploy/release.mjs" promote "$NEW" --attended --root "$ROOT" --pid "$(main_pid)" --skip-host-gate "r1 rehearsal sandbox"
t "links current=$NEW previous=$OLD" bash -c "[ \"\$(readlink '$ROOT/current') \$(readlink '$ROOT/previous')\" = 'releases/$NEW releases/$OLD' ]"
t "before the restart the primary and workers still run the 7d92042f supervisor" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$OLD")" "$SUP_OLD"
W1=$(for w in $(pgrep -P "$(main_pid)"); do tr '\0' '\n' < "/proc/$w/environ" | grep -qx AFLDB_WORKER_ID=1 && echo "$w"; done)
kill -9 "$W1"; for i in $(seq 1 40); do sleep 0.5; [ "$(pgrep -P "$(main_pid)" | wc -l)" = 2 ] && ! kill -0 "$W1" 2>/dev/null && break; done
echo "killed worker 1 (pid $W1); workers now: $(pgrep -P "$(main_pid)" | tr '\n' ' ')"
t "a crash re-fork (worker 1 killed) stays in the 7d92042f release, ordinals 1 and 2" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$OLD")" "$SUP_OLD"

echo "-- G. restart = the 17822b29 supervisor from the 17822b29 release"
systemctl --user restart "$UNIT" && up
echo "serving line: $(serving_line)"
t "P5 identity: primary in releases/$NEW, supervisor 4e8ea9b5, workers 1 and 2, names 1/1" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$NEW")" "$SUP_NEW"
t "supervisor log names the 17822b29 release and revision" bash -c "[[ '$(serving_line)' == *\"serving build $NEWB release $NEW revision $CAND\"* ]]"
t "checkout supervisor untouched by promotion (still the 17822b29 blob only because P2 moved it)" bash -c "[ \"\$(sha256sum < '$CHK/deploy/server-cluster.mjs' | cut -c1-64)\" = $SUP_NEW ]"
RV=$(cd "$CHK" && npx --no-install tsx tools/maintenance/revalidate-season.ts --season 2026 2>&1); RC=$?; echo "$RV" | tail -n 2
t "P5 check 4: 2/2, ordinals 1 and 2" revalidate_ordinals "$RV" "$RC" 2026
t "raw-head check: titles, robots, winner, 14 badges, genuine 404s, sitemap codes, /brownlow/1897 now 404" rawhead_run "$CHK/.env" "$PORT" check "$W/bl.json" 1897 "$W/sunday.json"
t "P6 tick on the new build" p6ok
t "S9 (loopback seam): serving $NEWB, $OLDB 404" env S9_BASE="http://127.0.0.1:$PORT" bash "$S/r1-s9-public-smoke.sh" "$NEWB" "$OLDB"
COOKIE=$( ( set -a; . "$CHK/.env"; set +a; "$NODE" -e 'const c=require("node:crypto");const p=Buffer.from(JSON.stringify({v:1,kind:"beta",sub:"r1-reh",exp:Math.floor(Date.now()/1000)+900,epoch:1}));process.stdout.write("afldb_beta="+p.toString("base64url")+"."+c.createHmac("sha256",process.env.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url"))' ) )
t "browser runner (headless seam, desktop + mobile): VERDICT PASS" env R1_BROWSER_BASE="http://127.0.0.1:$PORT" R1_BROWSER_COOKIE="$COOKIE" R1_HEADLESS=1 \
  R1_PLAYWRIGHT="$NM/@playwright/test" R1_BROWSER_OUT="$W/browser" "$NODE" "$S/r1-browser.cjs" 1897
ls "$W/browser" | tr '\n' ' '; echo

echo "-- H. rollback (real release.mjs) and restart = the 7d92042f supervisor again"
"$NODE" "$CHK/deploy/release.mjs" rollback --attended --to "$OLD" --ledger-head 118_fixtures_unconfirmed_participants.sql --root "$ROOT" --skip-host-gate "r1 rehearsal sandbox"
t "links current=$OLD previous=$NEW" bash -c "[ \"\$(readlink '$ROOT/current') \$(readlink '$ROOT/previous')\" = 'releases/$OLD releases/$NEW' ]"
t "before the restart the 17822b29 supervisor still serves" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$NEW")" "$SUP_NEW"
systemctl --user restart "$UNIT" && up
echo "serving line: $(serving_line)"
t "rollback verify 3: primary in the 7d92042f release, supervisor d82f24c4, workers 1 and 2" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$OLD")" "$SUP_OLD"
t "supervisor log names the 7d92042f release again" bash -c "[[ '$(serving_line)' == *\"serving build $OLDB release $OLD revision $SERVE\"* ]]"
RV=$(cd "$CHK" && npx --no-install tsx tools/maintenance/revalidate-season.ts --season 2026 2>&1); RC=$?
t "rollback verify 4: 17822b29 CLI against the rolled-back cluster 2/2" revalidate_ordinals "$RV" "$RC" 2026
t "raw-head check after rollback (no ISSUE-367 controls)" rawhead_run "$CHK/.env" "$PORT" check "$W/bl.json" none "$W/sunday.json"
tn "raw-head check after rollback WITH the 1897 control (the old build serves it: the control has teeth)" rawhead_run "$CHK/.env" "$PORT" check "$W/bl.json" 1897 ""
t "S9 after rollback: serving $OLDB, $NEWB 404" env S9_BASE="http://127.0.0.1:$PORT" bash "$S/r1-s9-public-smoke.sh" "$OLDB" "$NEWB"

echo "-- I. without the drop-in the checkout's supervisor would serve: P1 refuses that state"
rm "$UD/$UNIT.service.d/release-route.conf"; systemctl --user daemon-reload
tn "P1 route check with no release-route.conf" service_route "$UNIT" "$ROOT" "$NODE"
systemctl --user restart "$UNIT" && up; echo "primary cwd without the drop-in: $(readlink "/proc/$(main_pid)/cwd")"
tn "P1 identity when systemd runs the checkout" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$OLD")" "$SUP_OLD"
printf '%s\n' '[Service]' "WorkingDirectory=$ROOT/current" > "$UD/$UNIT.service.d/release-route.conf"; systemctl --user daemon-reload; systemctl --user restart "$UNIT" && up
t "drop-in restored: the release supervisor serves again" serving_identity "$UNIT" "$(realpath "$ROOT/releases/$OLD")" "$SUP_OLD"

echo "-- J. rule fixtures (no service)"
tn "revalidate: 1/2 reached"      revalidate_ordinals "REVALIDATED season 2026: 1/2 worker(s) reached (1) in 4 request(s)." 0 2026
tn "revalidate: ordinals 1,3"     revalidate_ordinals "REVALIDATED season 2026: 2/2 worker(s) reached (1,3) in 2 request(s)." 0 2026
tn "revalidate: INCOMPLETE line"  revalidate_ordinals $'INCOMPLETE season 2026: 1/2\nREVALIDATED season 2026: 2/2 worker(s) reached (1,2) in 2 request(s).' 0 2026
tn "revalidate: exit 1"           revalidate_ordinals "REVALIDATED season 2026: 2/2 worker(s) reached (2,1) in 2 request(s)." 1 2026
t  "revalidate: 2/2 (2,1)"        revalidate_ordinals "REVALIDATED season 2026: 2/2 worker(s) reached (2,1) in 3 request(s)." 0 2026
BK=$W/bk; mkdir -p "$BK"; D1=afldb_prod-20261124-022107.dump; head -c 4096 /dev/urandom > "$BK/$D1"; H1=$(sha256sum < "$BK/$D1" | cut -c1-64)
printf '%s  %s\n' "$H1" "$D1" > "$BK/$D1.sha256"
J1="2026-11-23T15:21:40Z scheduled-backup: backup ok: $D1 4096 bytes sha256 ${H1:0:16} offhost=pending"
t  "G0 pick: unique, attributed, re-hash = sidecar" bash -c "[ \"\$(R1_LIB_ONLY=1 . '$S/r1-g0-dump.sh'; pick_overnight_dump '$BK' 20261124 '$J1')\" = '$D1 $H1' ]"
tn "G0 pick: journal names another digest" pick_overnight_dump "$BK" 20261124 "${J1/${H1:0:16}/0000000000000000}"
tn "G0 pick: no journal line (unattributable)" pick_overnight_dump "$BK" 20261124 ""
cp "$BK/$D1" "$BK/afldb_prod-20261124-023001.dump"
tn "G0 pick: two same-window dumps (ambiguous)" pick_overnight_dump "$BK" 20261124 "$J1"

echo "-- K. R6 amendment: the exact CURRENT_ID gate lines of the amended scripts, and of the reviewed originals"
gate_pre()  { ( OUTC=accepted; CUR=$2; eval "$(sed -n '/^case \$OUTC in accepted)/,/exit 2; }/p' "$1")"; echo GATE-OPEN ) | grep -q GATE-OPEN; }
gate_post() { ( K=6.8.0-149-generic; CUR=$2; PB=01234567-89ab-cdef-0123-456789abcdef; PI=0123456789abcdef0123456789abcdef; RS=none; R4=r4:no
  GB=$(printf '0%.0s' $(seq 64)); eval "$(sed -n '/^  \[\[ \$K =~/,/exit 2; }/p' "$1")"; echo GATE-OPEN ) | grep -q GATE-OPEN; }
git -C "$CHK" show "$CAND:docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh" > "$W/r6-pre-orig.sh"
git -C "$CHK" show "$CAND:docs/v2/evidence/backlog-20261121/r6-20261125/r6-post-verify.sh" > "$W/r6-post-orig.sh"
for c in "$NEW" "$OLD"; do t "amended pre-verify admits accepted $c" gate_pre "$R6/r6-pre-verify.sh" "$c"; t "amended post-verify admits $c" gate_post "$R6/r6-post-verify.sh" "$c"; done
t  "amended post-verify still admits $PREV" gate_post "$R6/r6-post-verify.sh" "$PREV"
tn "amended pre-verify: accepted with $PREV" gate_pre "$R6/r6-pre-verify.sh" "$PREV"
tn "amended pre-verify: a foreign release id" gate_pre "$R6/r6-pre-verify.sh" "0123456789ab-X"
tn "reviewed original pre-verify on a 17822b29 release (why the amendment is needed)" gate_pre "$W/r6-pre-orig.sh" "$NEW"
tn "reviewed original post-verify on a 17822b29 release" gate_post "$W/r6-post-orig.sh" "$NEW"
t  "reviewed original pre-verify on the rollback target $OLD (rollback/deferral need no amendment)" gate_pre "$W/r6-pre-orig.sh" "$OLD"

echo; echo "REHEARSAL RESULT $([ $F = 0 ] && echo PASS || echo FAIL): $P passed, $F failed ($(date -u +%FT%TZ))"
[ $F = 0 ]
