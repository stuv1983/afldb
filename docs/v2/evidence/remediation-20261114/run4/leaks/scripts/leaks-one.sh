#!/usr/bin/env bash
# run-4 leaks scope. Executed INSIDE `isolated-pg run <db> --` (AFLDB_TEST_DATABASE_URL is set there).
# Usage (env: CAND E TAG): leaks-one.sh <test file relative to the checkout> [<extra vitest args>...]
# Appends to $E/attrib-$TAG.tsv:  file <TAB> rc <TAB> table <TAB> rows_before <TAB> rows_after <TAB> net <TAB> versions
# for every ordinary table with net != 0 or versions > 0 (versions = visible row versions with xmin >= the txid taken before the file, i.e. rows
# inserted or updated by a transaction that committed during the file). A file with no residue writes one line with table "-".
# Appends to $E/fp-$TAG.tsv: file <TAB> table <TAB> md5-before <TAB> md5-after <TAB> same|CHANGED  (content fingerprints of some tables, the surrogate `id` key excluded).
set -u -o pipefail
export LC_ALL=C
: "${CAND:?}" "${E:?}" "${TAG:?}" "${AFLDB_TEST_DATABASE_URL:?}"
FILE=$1; shift
P() { "$AFLDB_V2_PG_BIN/psql" -X -A -t -F'|' "$AFLDB_TEST_DATABASE_URL" "$@"; }
fp() { echo "SELECT '$1', md5(coalesce(string_agg((to_jsonb(t) - 'id')::text, '' ORDER BY (to_jsonb(t) - 'id')::text), '')) FROM $1 t"; }
FPSQL="$(for t in seasons club_seasons clubs sources auth_users data_overrides data_edits player_season_stats matches draft_picks draft_persons; do fp $t; echo UNION ALL; done | sed '$d' | tr '\n' ' ')"
X0=$(P -c 'SELECT txid_current()' | tr -d ' \n')
P -v x0="$X0" -f "$E/counts-$TAG.sql" | sort > "$E/.before.$TAG"
P -c "$FPSQL" | sort > "$E/.fpb.$TAG"
mkdir -p "$E/attrib-$TAG-logs"
LOG="$E/attrib-$TAG-logs/$(echo "$FILE" | tr '/' '_').log"
( cd "$CAND" && timeout 1700 node node_modules/vitest/vitest.mjs run "$FILE" "$@" ) > "$LOG" 2>&1
RC=$?
P -v x0="$X0" -f "$E/counts-$TAG.sql" | sort > "$E/.after.$TAG"
P -c "$FPSQL" | sort > "$E/.fpa.$TAG"
join -t'|' "$E/.fpb.$TAG" "$E/.fpa.$TAG" | awk -F'|' -v f="$FILE" '{ printf "%s\t%s\t%s\t%s\t%s\n", f, $1, substr($2,1,8), substr($3,1,8), ($2 == $3 ? "same" : "CHANGED") }' >> "$E/fp-$TAG.tsv"
NLINES=$(join -t'|' "$E/.before.$TAG" "$E/.after.$TAG" | awk -F'|' -v f="$FILE" -v rc="$RC" '
  { net = $4 - $2; if (net != 0 || $5 > 0) { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", f, rc, $1, $2, $4, net, $5; n++ } }
  END { if (n == 0) printf "%s\t%s\t-\t0\t0\t0\t0\n", f, rc }')
printf '%s\n' "$NLINES" >> "$E/attrib-$TAG.tsv"
echo "$FILE rc=$RC residue-tables=$(printf '%s\n' "$NLINES" | awk -F'\t' '$3 != "-"' | wc -l)"
# Optional row-level dump of the residue (DIAG=1): up to 12 rows per residue table, 260 chars each. Only for the accepted-rebuild base
# (the snapshot is production-derived: aggregates only, never row extracts).
if [ "${DIAG:-0}" = 1 ]; then
  printf '%s\n' "$NLINES" | awk -F'\t' '$3 != "-" { print $3 }' | while read -r T; do
    echo "== $FILE $T"
    P -c "SELECT left(to_jsonb(t)::text, 260) FROM $T t WHERE xmin::text::bigint >= $X0 ORDER BY 1 LIMIT 12"
  done >> "$E/diag-$TAG.txt"
fi
