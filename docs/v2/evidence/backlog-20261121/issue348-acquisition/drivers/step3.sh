#!/usr/bin/env bash
set -u
W=/mnt/ssd/afldb-backlog-20261122-dg
PY="$W/venv/bin/python"
EV="$W/src/docs/v2/evidence/issue336-draft-categories-20261105"
CL="$EV/d3363-classification-20261111/scripts"
PSQL="/usr/lib/postgresql/16/bin/psql -h 127.0.0.1 -p 61522 -U dgsuper -d afldb_prod_r0 -At"
mkdir -p "$W/drivers" "$W/work-fresh" "$W/work-owner"
cp /tmp/dg-build_fresh_inputs.py "$W/drivers/build_fresh_inputs.py"; rm -f /tmp/dg-build_fresh_inputs.py

echo "== export stored rows (same columns as export-draft.mjs)"
$PSQL -o "$W/work-fresh/draft-export.json" -c "
SELECT json_build_object('rows', json_agg(t ORDER BY t.id)) FROM (
 SELECT dp.id, dp.draft_year::int AS year, dp.draft_type AS type, dp.draft_kind AS kind,
        dp.pick_number::int AS pick, dp.pick_note, dp.player_name_raw AS player, dp.player_id::int AS player_id,
        dp.link_status_value::text AS link, dp.club_name_raw AS club_raw, c.name AS club, c.slug AS club_slug,
        dp.signing, dp.signing_kind, so.key AS source, dp.player_url, dp.detail,
        dp.original_club_raw AS origin, dp.draft_age::int AS age, dp.height_cm::int AS height,
        p.display_name AS player_display
   FROM draft_picks dp LEFT JOIN clubs c ON c.id = dp.club_id LEFT JOIN sources so ON so.id = dp.source_id
   LEFT JOIN players p ON p.id = dp.player_id) t"
echo "export rc=$?"
gzip -n -f "$W/work-fresh/draft-export.json"
cp "$W/work-fresh/draft-export.json.gz" "$W/work-owner/draft-export.json.gz"
sha256sum "$W/work-fresh/draft-export.json.gz"

echo "== fresh csv_rows"
"$PY" -I "$W/drivers/build_fresh_inputs.py" "$W" "$W/work-fresh" annual-html-20261122 || exit 1

echo "== owner CSV hash verification"
cd /mnt/ssd/afldb/records/d3363-owner-draftguru-csv-20261111 && sha256sum -c SHA256SUMS 2>&1 | grep -vc ": OK" ; sha256sum -c SHA256SUMS 2>&1 | grep -c ": OK"
cd "$W"
echo "== owner csv_rows (csv_inventory.py unchanged)"
"$PY" -I "$EV/csv_inventory.py" /mnt/ssd/afldb/records/d3363-owner-draftguru-csv-20261111 "$W/work-owner/csv_rows.json" > "$W/work-owner/csv-inventory.txt" 2>&1; echo "inv rc=$?"; head -c 200 "$W/work-owner/csv-inventory.txt"

for K in fresh owner; do
  echo "=== classifier: $K"
  D="$W/work-$K"
  "$PY" -I "$CL/extract_pairs.py" "$EV" "$D" > "$D/extract-pairs-output.txt" 2>&1; echo "extract rc=$?"; cat "$D/extract-pairs-output.txt" | head -c 400
  "$PY" -I "$EV/reconcile.py" "$D" > "$D/reconcile-output.txt" 2>&1; echo "reconcile rc=$?"
  "$PY" -I "$CL/classify.py" "$D" > "$D/classify-output.txt" 2>&1; echo "classify rc=$?"
  head -n 4 "$D/classify-output.txt" | cut -c1-600
done
