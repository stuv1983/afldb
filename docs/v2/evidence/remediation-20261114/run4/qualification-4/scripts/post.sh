#!/usr/bin/env bash
# remediation run 4, scope `qual`, P5: comparisons of each cell with its baseline (no database access, no test is run).
#   bash $W/in/post.sh
set -u -o pipefail
. "$(dirname "$0")/common.sh"
EVD=$CAND/$REPO_EVD
CMP=$IN/compare.mjs
B=$EVD/run4/baseline/raw
R3=$EVD/run3/qualification-3/integ-failures.tsv
echo "== run-3 baseline for S-PF: $R3 ($(wc -l < "$R3") ids); B4 baselines: c1/c2/c3 ($(wc -l < "$B/c1-failures.tsv")/$(wc -l < "$B/c2-failures.tsv")/$(wc -l < "$B/c3-failures.tsv") ids)"
# S-PF vs run 3: classes from the baseline scope's c3-classified.tsv (its 46 ids equal run 3's 46: README section 4)
[ -f "$E/s_pf-failures.tsv" ] && node "$CMP" "$E/s_pf-failures.tsv" "$R3" "$B/c3-classified.tsv" "$E/cmp-s_pf-vs-run3.tsv"
[ -f "$E/r_pf-failures.tsv" ] && node "$CMP" "$E/r_pf-failures.tsv" "$B/c1-failures.tsv" "$B/c1-classified.tsv" "$E/cmp-r_pf-vs-b4c1.tsv"
[ -f "$E/r_sh-failures.tsv" ] && node "$CMP" "$E/r_sh-failures.tsv" "$B/c2-failures.tsv" "$B/c2-classified.tsv" "$E/cmp-r_sh-vs-b4c2.tsv"
[ -f "$E/s_sh-failures.tsv" ] && node "$CMP" "$E/s_sh-failures.tsv" "$B/c3-failures.tsv" "$B/c3-classified.tsv" "$E/cmp-s_sh-vs-b4c3.tsv"
# informational: S-SH vs S-PF at Q'' (does shared mode change the snapshot's ids?)
[ -f "$E/s_pf-failures.tsv" ] && [ -f "$E/s_sh-failures.tsv" ] && node "$CMP" "$E/s_sh-failures.tsv" "$E/s_pf-failures.tsv" - "$E/cmp-s_sh-vs-s_pf-at-Qpp.tsv"
[ -f "$E/r_pf-failures.tsv" ] && [ -f "$E/r_sh-failures.tsv" ] && node "$CMP" "$E/r_sh-failures.tsv" "$E/r_pf-failures.tsv" - "$E/cmp-r_sh-vs-r_pf-at-Qpp.tsv"
for t in s_pf r_pf r_sh s_sh; do
  [ -f "$E/$t-failures.tsv" ] || continue
  echo "== $t: failing ids $(wc -l < "$E/$t-failures.tsv") ($(grep -c '<file-level>' "$E/$t-failures.tsv") file-level); files failing: $(cut -f1 "$E/$t-failures.tsv" | sort -u | wc -l)"
done
