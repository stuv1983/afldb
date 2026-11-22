#!/usr/bin/env bash
# Disposable Linux fixtures only. ROOT is the uploaded source tree, no live ops.
# ISSUE-352 (22-23 Nov 2026): updated to the corrected contract. The journal CMD record holds the command only (the observed
# Debian cron format), the wrapper BEGIN carries the process lineage, and the verifier distinguishes COPY-FAILED (exit 1) from
# COPY-VERIFIED-ORIGIN-UNPROVEN (exit 10). The full three-outcome and installer matrix is t-352-scheduled-origin.sh.
set -euo pipefail
ROOT=${1:?source root}; B=$ROOT/docs/v2/evidence/backlog-20261121
W=$(mktemp -d /mnt/ssd/afldb-review-fixture-XXXXXX); trap 'rm -rf -- "$W"' EXIT
mkdir -p "$W/ops/state" "$W/dest" "$W/bin"
export AFLDB_OPS=$W/ops AFLDB_OFFHOST_DEST=$W/dest CRON_LOG_FILE=$W/cron CRONTAB_BIN=$W/bin/crontab
cp "$B/kits/scheduled-pull-evidence.sh" "$W/ops/"
CMD='AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh'
LINE="10 3 * * * $CMD"
T0=$(date -d '2026-11-17T16:10:01Z' +%s)
printf '#!/bin/sh\ncat "%s"\n' "$W/ct" > "$CRONTAB_BIN"; chmod +x "$CRONTAB_BIN"
printf '# AFLDB-A2-r3\n%s\n' "$LINE" > "$W/ct"
D=afldb_prod-20261118-022125.dump; printf fixture > "$W/dest/$D"
S=$(sha256sum < "$W/dest/$D" | cut -d' ' -f1)
printf '%s  %s\n' "$S" "$D" > "$W/dest/$D.sha256"; touch "$W/dest/.verified-$D"
good() {
  printf '2026-11-18T03:10:01+11:00 streamanator CRON[777]: (arm) CMD (%s)\n' "$CMD" > "$W/cron"
  cat > "$W/ops/state/offhost-pull.log" <<EOF
2026-11-17T16:10:01Z BEGIN run=scheduled cron_pid=776 lineage=778:sh:$T0,777:sh:$T0,776:cron:$T0
2026-11-17T16:12:00Z VERIFIED run=scheduled dump=$D sha256=$S
2026-11-17T16:12:01Z END run=scheduled rc=0
EOF
}
pass=0
expect() { local want=$1 name=$2 rc=0; shift 2; "$@" > "$W/result" 2>&1 || rc=$?; cat "$W/result"; echo "$name actual_exit=$rc expected=$want"; [ "$rc" = "$want" ]; pass=$((pass+1)); }
verify() { bash "$B/r6-20261125/r6-offhost-verify.sh" 2026-11-18 "$D" "$S"; }
observe() { bash "$B/a1a2-20261124/a2-cron-observe.sh" r3 2026-11-18 "$D" "$S"; }
good; expect 0 scheduled-chain verify; expect 0 r3-observer observe
good; sed -i 's/ lineage=.*$/ lineage=5001:bash:1/' "$W/ops/state/offhost-pull.log"; expect 10 manual-success verify; expect 10 r3-propagates-unproven observe
good; sed -i 's/2026-11-18/2026-11-16/' "$W/cron"; expect 10 monday-for-wednesday verify
good; sed -i 's/rc=0/rc=1/' "$W/ops/state/offhost-pull.log"
printf '2026-11-17T16:20:00Z BEGIN run=retry cron_pid=none lineage=5001:bash:1\n2026-11-17T16:21:00Z END run=retry rc=0\n' >> "$W/ops/state/offhost-pull.log"
expect 1 failed-scheduled-then-retry verify
good; sed -i '/ VERIFIED /d' "$W/ops/state/offhost-pull.log"; echo "unrelated verified $D" >> "$W/ops/state/offhost-pull.log"; expect 10 unrelated-verified verify
good; sed -i 's/022125/033635/' "$W/ops/state/offhost-pull.log"; expect 10 verification-service-dump verify
good; expect 1 wrong-production-sha bash "$B/r6-20261125/r6-offhost-verify.sh" 2026-11-18 "$D" "$(printf '%064d' 0)"
good; touch "$W/dest/.retention-hold"; expect 1 active-hold verify; rm "$W/dest/.retention-hold"
good; cp "$W/cron" "$W/dup"; cat "$W/dup" >> "$W/cron"; expect 10 ambiguous-dispatch verify
good; sed -i 's/16:12:01/17:12:01/' "$W/ops/state/offhost-pull.log"; expect 1 late-completion verify
good; echo corrupt >> "$W/dest/$D"; expect 1 changed-dump-bytes verify; printf fixture > "$W/dest/$D"
good; printf '%s  other.dump\n' "$S" > "$W/dest/$D.sha256"; expect 1 wrong-sidecar verify; printf '%s  %s\n' "$S" "$D" > "$W/dest/$D.sha256"
good; rm "$W/dest/.verified-$D"; expect 1 missing-marker verify; touch "$W/dest/.verified-$D"
# Run the actual wrapper with a local fake pull and simulated CRON ancestry.
printf '#!/bin/sh\nexit 0\n' > "$W/ops/offhost-pull.sh"
printf '#!/bin/sh\ncase "$*" in *comm*) echo CRON;; *) echo 1;; esac\n' > "$W/bin/ps"
chmod +x "$W/bin/ps"
expect 0 wrapper bash -c 'PATH="$1/bin:$PATH" sh "$2/kits/afldb-offhost-pull-daily.sh"' _ "$W" "$B"
grep -q "VERIFIED .*dump=$D sha256=$S" "$W/ops/state/offhost-pull.log"
grep -q 'END .*rc=0' "$W/ops/state/offhost-pull.log"
# Verify installer pins against the same repository bytes, without installing cron.
cp "$B/kits/afldb-offhost-pull-daily.sh" "$W/ops/"
cp "$ROOT/tools/maintenance/offhost-pull.sh" "$W/ops/"
printf '#!/usr/bin/env bash\nexit 0\n' > "$W/ops/alarm-email.sh"; chmod +x "$W/ops/alarm-email.sh"
echo 'fixture-only=1' > "$W/ops/alarm-smtp.env"; chmod 600 "$W/ops/alarm-smtp.env"
printf 'DUMP %s\npg_restore exit=0, stderr lines 0\nFIRSTCOPY RESULT RESTORE PASS (fixture)\n' "$W/dest/$D" > "$W/ops/state/a2-firstcopy-restore.log"
expect 0 installer-pins env AFLDB_CRON_MIN_LINES=0 bash "$B/a1a2-20261124/a2-cron-install.sh" check r3
grep -q 'PASS wrapper pins:' "$W/result"; grep -q 'PRECONDITIONS PASS' "$W/result"
touch "$W/ops/state/crontab.pre-a2-r2-install-20261117T000000Z"
echo '2026-11-17T00:17:01Z rc=0 AFLDB_SETTLE_STATUS OK' > "$W/ops/state/settle-check.log"
expect 0 r2-observer-unchanged bash "$B/a1a2-20261124/a2-cron-observe.sh" r2
grep -q 'FIRST SCHEDULED RUN:.*rc=0' "$W/result"
# Extract exact production functions, without running their main / production calls.
source <(sed -n '/^check_revalidation_processes()/,/^main() {/p' "$B/r6-20261125/r6-post-verify.sh" | sed '$d')
pgrep() { printf '%s\n' "$WORKERS"; }
WORKERS='102 103'
for p in 101 102 103; do mkdir -p "$W/proc/$p"; ln -s /release "$W/proc/$p/cwd"; done
envgood() {
  for p in 101 102 103; do printf 'AFLDB_REVALIDATE_URL=http://fixture\0AFLDB_REVALIDATE_SECRET=fixture\0' > "$W/proc/$p/environ"; done
  printf 'AFLDB_WORKER_ID=1\0' >> "$W/proc/102/environ"; printf 'AFLDB_WORKER_ID=2\0' >> "$W/proc/103/environ"
}
checkenv() { check_revalidation_processes 101 /release "$W/proc"; }
envgood; expect 0 process-healthy checkenv
envgood; : > "$W/proc/101/environ"; expect 1 process-zero-zero checkenv
envgood; printf 'AFLDB_REVALIDATE_URL=http://fixture\0' > "$W/proc/101/environ"; expect 1 process-missing-secret checkenv
envgood; printf 'AFLDB_REVALIDATE_URL=\0AFLDB_REVALIDATE_SECRET=fixture\0' > "$W/proc/101/environ"; expect 1 process-blank-url checkenv
envgood; printf 'AFLDB_REVALIDATE_SECRET=\0' >> "$W/proc/102/environ"; expect 1 process-duplicate-secret checkenv
envgood; WORKERS=102; expect 1 process-missing-worker checkenv
source <(sed -n '/^expected_head_title()/,/^main() {/p' "$B/a1a2-20261124/a1-p6-observe.sh" | sed '$d')
TITLE='2026 AFL Season — Ladder, Results &amp; Finals | AFLDB'
printf '<html><head><script>var x="Page not found"</script><title>%s</title></head><body><script>Page not found</script></body></html>' "$TITLE" > "$W/page"
expect 0 title-healthy-rsc expected_head_title "$W/page" "$TITLE"
BTITLE='2026 Brownlow Medal — Winner, Votes &amp; Leaderboard | AFLDB'
printf '<head><title>%s</title></head><script>Page not found</script>' "$BTITLE" > "$W/page"
expect 0 title-brownlow-healthy-rsc expected_head_title "$W/page" "$BTITLE"
echo '<html><head></head><body>Page not found</body></html>' > "$W/page"; expect 1 title-missing expected_head_title "$W/page" "$TITLE"
echo '<head><title>Page not found | AFLDB</title></head>' > "$W/page"; expect 1 title-not-found expected_head_title "$W/page" "$TITLE"
echo '<head><title>unterminated</head>' > "$W/page"; expect 1 title-unparseable expected_head_title "$W/page" "$TITLE"
echo "SUNDAY-REVIEW RESULT $pass passed, 0 failed"
