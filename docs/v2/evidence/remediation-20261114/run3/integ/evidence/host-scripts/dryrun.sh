#!/usr/bin/env bash
# rem3-integ: dry-run and refusal cases of run-rebuilt.sh against the sibling's published rebuild (nothing is changed).
set -uo pipefail
W=/mnt/ssd/afldb-rem3-integ-20261114
R=/mnt/ssd/afldb-rem3-base/rebuilt
RUN=$W/in/runner/run-rebuilt.sh
D=$R/afldb_v2_rb_rem3-6d5388ea.dump
S=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
C=$R/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
OUT=$W/evidence/a/runner-dryrun.txt
: > "$OUT"
t() { # <label> <expected rc> <env assignments or -> -- args...
  local label=$1 want=$2 envs=$3; shift 3
  local out rc
  if [ "$envs" = "-" ]; then out=$(timeout 60 bash "$RUN" "$@" 2>&1); rc=$?; else out=$(env $envs timeout 60 bash "$RUN" "$@" 2>&1); rc=$?; fi
  printf '## %s | expected rc=%s | got rc=%s | %s\n' "$label" "$want" "$rc" "$([ "$rc" = "$want" ] && echo OK || echo MISMATCH)" >> "$OUT"
  printf '%s\n' "$out" | tail -4 | cut -c1-240 >> "$OUT"
}
t "ok (all groups + brownlow)" 0 - --dump $D --sha256 $S --bridge $C --dry-run --with-brownlow
t "ok (subset)" 0 - --dump $D --sha256 $S --bridge $C --dry-run --groups restore,od5 --tag t1
t "sha not the SHA256SUMS entry" 2 - --dump $D --sha256 0000000000000000000000000000000000000000000000000000000000000000 --bridge $C --dry-run
t "sha malformed" 2 - --dump $D --sha256 abc --bridge $C --dry-run
t "missing dump" 2 - --dump $R/none.dump --sha256 $S --bridge $C --dry-run
t "missing bridge" 2 - --dump $D --sha256 $S --bridge $R/none.json --dry-run
t "port 5432" 2 - --dump $D --sha256 $S --bridge $C --port 5432 --dry-run
t "port 55651 (sibling)" 2 - --dump $D --sha256 $S --bridge $C --port 55651 --dry-run
t "port 55660" 2 - --dump $D --sha256 $S --bridge $C --port 55660 --dry-run
t "port 80" 2 - --dump $D --sha256 $S --bridge $C --port 80 --dry-run
t "per-file prefix env set" 2 AFLDB_TEST_PER_FILE_DB_PREFIX=afldb_v2_rb_ --dump $D --sha256 $S --bridge $C --dry-run
t "ambient test DSN env set" 2 AFLDB_TEST_DATABASE_URL=dummy --dump $D --sha256 $S --bridge $C --dry-run
t "foreign workspace" 2 - --dump $D --sha256 $S --bridge $C --workspace /mnt/ssd/afldb-rem3-stateb-20261114 --dry-run
t "unknown group" 2 - --dump $D --sha256 $S --bridge $C --groups restore,bogus --dry-run
t "unknown argument" 2 - --dump $D --sha256 $S --bridge $C --frob --dry-run
t "bad tag" 2 - --dump $D --sha256 $S --bridge $C --tag 'a b' --dry-run
echo "cases: $(grep -c '^## ' "$OUT"), mismatches: $(grep -c MISMATCH "$OUT")"
grep '^## ' "$OUT"
