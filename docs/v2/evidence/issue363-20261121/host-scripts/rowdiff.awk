# ISSUE-363 (2026-11-21): aggregate a rows.sql comparison. Usage: awk -f rowdiff.awk rows-template.txt rows-after.txt
# Prints counts only (per table: rows only in the template, rows only after, rows changed, rows whose ONLY change is
# import_batch_id; per table/column change counts; link_status_value and player_id NULL/non-NULL transitions).
function val(s) { return substr(s, index(s, "=") + 1) }
function key(s) { return substr(s, 1, index(s, "=") - 1) }
{
  rest = $0; sub(/^[^ ]+ [^ ]+ /, "", rest)
  r = $1 SUBSEP $2; k = key(rest); v = val(rest)
  if (FNR == NR) { A[r, k] = v; ra[r] = 1; ka[r, k] = 1 } else { B[r, k] = v; rb[r] = 1; kb[r, k] = 1 }
  tables[$1] = 1
}
END {
  for (r in ra) if (!(r in rb)) { split(r, p, SUBSEP); onlyA[p[1]]++ }
  for (r in rb) if (!(r in ra)) { split(r, p, SUBSEP); onlyB[p[1]]++ }
  for (rk in A) {
    split(rk, p, SUBSEP); r = p[1] SUBSEP p[2]; k = p[3]
    if (!(r in rb)) continue
    if (A[rk] != B[rk]) {
      col[p[1] " " k]++; ch[r] = ch[r] " " k
      if (k == "link_status_value") tr[p[1] " link_status " A[rk] "->" B[rk]]++
      if (k == "player_id") tr[p[1] " player_id " (A[rk] == "null" ? "null" : "id") "->" (B[rk] == "null" ? "null" : "id")]++
    }
  }
  for (r in ch) { split(r, p, SUBSEP); changed[p[1]]++; if (ch[r] == " import_batch_id") onlyBatch[p[1]]++ }
  for (t in tables) printf "table %s: only_template=%d only_after=%d changed=%d changed_only_import_batch_id=%d\n", t, onlyA[t], onlyB[t], changed[t], onlyBatch[t]
  for (c in col) printf "column %s changed_rows=%d\n", c, col[c]
  for (x in tr) printf "transition %s rows=%d\n", x, tr[x]
}
