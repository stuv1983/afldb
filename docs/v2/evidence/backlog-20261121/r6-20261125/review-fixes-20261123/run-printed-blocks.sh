#!/usr/bin/env bash
# REHEARSAL ONLY (workstation Git Bash). Runs the R6 r2 amendment's printed blocks VERBATIM: each block is cut out of the runbook
# text by position (the Nth ```bash block after the r2 amendment heading), so what runs is exactly what the operator copies.
#   block 1 archive (workstation)  -> run here
#   block 2 transfer to streamanator -> run here
#   block 3 transfer to production -> NOT run (production is out of scope)
#   block 4 staging/verification   -> run here (workstation) and on streamanator
#   block 5 re-check               -> run on streamanator against the verified root and against four changed copies
# Then exports the fixture (same revision) to streamanator and runs rehearse-r6-fixes.sh there (disposable containers), and
# finally removes everything this rehearsal created on streamanator. Production is never contacted.
# Usage: bash run-printed-blocks.sh <worktree holding the runbook> <output dir>
set -uo pipefail; export LC_ALL=C
WT=${1:?worktree}; OUT=${2:?output dir}; mkdir -p "$OUT"
RB=$WT/docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md
CODE=7af24a74b15af39b0bdebeec9be0b089c8adc8a1
H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-20261123
SSH=(C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i C:/Users/stuar/.ssh/afldb_dev arm@10.0.40.100)
blk() { awk -v n="$1" '/^## Amendment — 23 November 2026 \(r2\)/ {on=1} on && /^```bash$/ {k++; if (k == n) {p=1; next}} p && /^```$/ {exit} p' "$RB" | tr -d '\r'; }
echo "== R6 r2 printed blocks $(date -u +%FT%TZ) workstation=$(hostname) runbook=$(sha256sum < "$RB" | cut -c1-64)"
for i in 1 2 3 4 5; do blk $i > "$OUT/block$i.sh"; echo "   block $i: $(wc -l < "$OUT/block$i.sh") lines, sha256 $(sha256sum < "$OUT/block$i.sh" | cut -c1-64)"; done
grep -q "^CODE=$CODE$" "$OUT/block1.sh" || { echo "STOP block 1 does not pin $CODE"; exit 1; }

echo "-- block 1 (archive), verbatim, workstation"
bash "$OUT/block1.sh"; echo "   rc=$?"
echo "-- block 4 (staging), verbatim, workstation"
bash "$OUT/block4.sh"; echo "   rc=$?"
echo "-- block 2 (transfer to streamanator), verbatim"
bash "$OUT/block2.sh"; echo "   rc=$?"
echo "-- block 4 (staging), verbatim, streamanator"
"${SSH[@]}" bash -s < "$OUT/block4.sh" | tee "$OUT/stage-streamanator.out"; echo "   rc=${PIPESTATUS[0]}"
echo "   files verified: $(grep -c ': OK$' "$OUT/stage-streamanator.out")"
STAGE=$(sed -n 's/^R6 STAGE VERIFIED \(\/tmp\/afldb-r6-20261125-r2\.[A-Za-z0-9]*\) (15 files)$/\1/p' "$OUT/stage-streamanator.out")
[ -n "$STAGE" ] || { echo "STOP no verified staging root on streamanator"; exit 1; }
echo "   tar on streamanator: $("${SSH[@]}" 'sha256sum /tmp/afldb-r6-20261125-r2.tar' | cut -c1-64) (workstation: $(sha256sum < /tmp/afldb-r6-20261125-r2.tar | cut -c1-64))"

recheck() { # label setup-commands (run on streamanator before block 5, with STAGE preset to the copy)
  echo "-- block 5 (re-check), verbatim, streamanator: $1"
  { printf 'set -u; SRC=%s; T=$(mktemp -d /tmp/afldb-r6-recheck.XXXXXX); cp -a "$SRC/." "$T/"; cd "$T"; %s\ncd /; STAGE=$T\n' "$STAGE" "$2"
    cat "$OUT/block5.sh"; printf 'rc=$?; echo "   rc=$rc"; rm -rf "$T"\n'; } | "${SSH[@]}" bash -s 2>&1 | sed 's/^/     | /'
}
recheck "unchanged copy of the verified root" ':'
recheck "one staged file changed by one byte (r6-pre-verify.sh)" "printf '#' >> docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh"
recheck "one staged file changed and its manifest line rewritten to match (digest rule)" \
  "f=docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-rawhead.sh; printf '#' >> \$f; h=\$(sha256sum < \$f | cut -c1-64); sed -i \"s|^[0-9a-f]\\{64\\}  \$f\$|\$h  \$f|\" R6-SHA256SUMS"
recheck "an extra file in the staging root (file-count rule)" "printf 'x' > docs/extra.txt"
recheck "a staged file removed (r6-rawhead-check.sh)" "rm docs/v2/evidence/backlog-20261121/r6-20261125/r6-rawhead-check.sh"

echo "-- block 4 (staging), verbatim, streamanator, from an archive with one changed file"
"${SSH[@]}" 'set -e; cd /tmp; cp afldb-r6-20261125-r2.tar afldb-r6-20261125-r2.tar.good; X=$(mktemp -d /tmp/afldb-r6-bad.XXXXXX); tar -xf afldb-r6-20261125-r2.tar -C "$X"
  printf "#" >> "$X/docs/v2/evidence/backlog-20261121/r6-20261125/r6-rawhead-check.sh"; tar -cf afldb-r6-20261125-r2.tar -C "$X" docs tools src; rm -rf "$X"'
"${SSH[@]}" bash -s < "$OUT/block4.sh" 2>&1 | sed 's/^/     | /'; echo "   rc=${PIPESTATUS[0]}"
"${SSH[@]}" 'mv /tmp/afldb-r6-20261125-r2.tar.good /tmp/afldb-r6-20261125-r2.tar && sha256sum /tmp/afldb-r6-20261125-r2.tar | cut -c1-64'

echo "-- fixture export of $CODE and the container rehearsal (streamanator, one connection)"
git -C /d/dev/afldb archive --format=tar --output=/tmp/afldb-r6fix-fixture.tar "$CODE" deploy/release.mjs deploy/server-cluster.mjs \
  deploy/afldb-settle-failure-status.sh deploy/host-policy deploy/Caddyfile.production tools/build/env-in-standalone.mjs \
  tools/maintenance/scheduled-backup.sh docs/v2/evidence/release-17822b29-20261124/rehearsal/stub-server.cjs \
  docs/v2/evidence/release-17822b29-20261124/rehearsal/make-release.mjs "$H" || { echo "STOP fixture export"; exit 1; }
echo "   fixture tar sha256 $(sha256sum < /tmp/afldb-r6fix-fixture.tar | cut -c1-64)"
"${SSH[@]}" "set -u; FIX=\$(mktemp -d /tmp/afldb-r6fix-fixture.XXXXXX) && tar -xf - -C \"\$FIX\" && bash \"\$FIX/$H/rehearse-r6-fixes.sh\" '$STAGE' \"\$FIX\"; rc=\$?; rm -rf \"\$FIX\"; exit \$rc" \
  < /tmp/afldb-r6fix-fixture.tar 2>&1 | tee "$OUT/containers.out"; echo "   rc=${PIPESTATUS[0]}"

echo "-- cleanup on streamanator (everything this rehearsal created)"
"${SSH[@]}" 'ls -d /tmp/afldb-r6* 2>/dev/null | sed "s/^/   removing /"; rm -rf /tmp/afldb-r6-20261125-r2.* /tmp/afldb-r6-20261125-r2.tar /tmp/afldb-r6-recheck.* /tmp/afldb-r6-bad.* /tmp/afldb-r6fix-fixture.*; echo "   left: $(ls -d /tmp/afldb-r6* 2>/dev/null | wc -l)"; echo "   containers left: $(docker ps -aq --filter ancestor=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba | wc -l)"'
echo "-- cleanup on the workstation"
ls -d /tmp/afldb-r6-20261125-r2.* /tmp/afldb-r6fix-fixture.tar 2>/dev/null | sed 's/^/   removing /'
rm -rf /tmp/afldb-r6-20261125-r2.* /tmp/afldb-r6fix-fixture.tar
echo "== done $(date -u +%FT%TZ)"
