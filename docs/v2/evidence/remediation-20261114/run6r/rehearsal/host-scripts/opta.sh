#!/usr/bin/env bash
# Packet 6R: rehearse B1a-0 option A (b1a0-dev-restore-verify.sh) with the 4 Nov production dump already on this host.
# "Production-side" inputs are read from a fresh copy of the 4 Nov snapshot template (same dump) in the run-4 cluster.
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem6r-b1a-20261116; C=/mnt/ssd/afldb-rem5-t2-20261115/cand
SN=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SN_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d; SN_BYTES=30141895
IDS=e5ead8dbf3baf9a7b647b0f55b04c496
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
A=$W/art; mkdir -p "$A/b1a" "$A/b1a0" "$W/opta/pe-good" "$W/opta/pe-bad"; chmod 700 "$W/opta"
cp "$W/in/b1a-accept-r6r.sql" "$W/in/b1a-repair-2026-r6r.mts" "$A/b1a/"; cp "$W/in/b1a0-parity.sql" "$W/in/b1a0-dev-restore-verify.sh" "$A/b1a0/"
echo "=== option A rehearsal $(date -u +%FT%TZ)"; (cd "$A" && sha256sum b1a/* b1a0/*)
# production-side inputs from a fresh template copy (run-4 cluster, port 55684)
( export AFLDB_V2_PG_ROOT=/mnt/ssd/afldb-rem4-coleman276-20261115-pg AFLDB_V2_PG_PORT=55684 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
  IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
  ss -ltn | grep -q ":55684 " || { IR start > "$W/ev/pg-start2.out" 2>&1 < /dev/null; sleep 3; }
  db=afldb_v2_rem6r_optaside_test; IR create-db "$db" --template afldb_v2_rem4coleman276_sntmpl_test 2>&1 | strip | tail -1
  D=docs/v2/evidence/remediation-20261114/run6r/b1a; mkdir -p "$C/$D"; cp "$A/b1a/b1a-accept-r6r.sql" "$C/$D/"
  IR run "$db" -- bash -c 'I=$AFLDB_TEST_IMPORT_DATABASE_URL; read -r O S < <(psql "$I" -XAtq -c "SELECT d.oid, c.system_identifier FROM pg_database d, pg_control_system() c WHERE d.datname = current_database()" | tr "|" " ")
    PGOPTIONS="-c default_transaction_read_only=on" psql "$I" -X -v ON_ERROR_STOP=1 -At -f '"$A"'/b1a0/b1a0-parity.sql > '"$W"'/opta/pe-good/parity-prod.txt
    PGOPTIONS="-c default_transaction_read_only=on" psql "$I" -X -v ON_ERROR_STOP=1 -At -v db='"$db"' -v oid="$O" -v sysid="$S" -f '"$D"'/b1a-accept-r6r.sql > '"$W"'/opta/pe-good/accept-before-prod.txt' 2>&1 | strip | grep -v '^isolated-pg:'
  rm -f "$C/$D/b1a-accept-r6r.sql"; (cd "$C" && rmdir -p "$D" 2>/dev/null)
  IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1; IR stop 2>&1 | strip | tail -1 )
echo "--- production-side inputs (from the template copy)"; cat "$W/opta/pe-good/parity-prod.txt" "$W/opta/pe-good/accept-before-prod.txt" | sed 's/^/  /'
sed 's/^players rows|\([0-9]*\)$/players rows|999999/' "$W/opta/pe-good/parity-prod.txt" > "$W/opta/pe-bad/parity-prod.txt"
sed 's/^ids2026|669|.*/ids2026|669|00000000000000000000000000000000/' "$W/opta/pe-good/accept-before-prod.txt" > "$W/opta/pe-bad/accept-before-prod.txt"
# the "transferred" copies (simulating the scp hop), 0600
install -m 600 "$SN" "$W/opta/rehearsal2-good-afldb_prod-20261104T021037Z.dump"; install -m 600 "$SN" "$W/opta/rehearsal2-bad-afldb_prod-20261104T021037Z.dump"
echo; echo "##### A1: matching production evidence (expect VERDICT PASS)"
bash "$A/b1a0/b1a0-dev-restore-verify.sh" "$W/opta/rehearsal2-good-afldb_prod-20261104T021037Z.dump" "$SN_SHA" "$SN_BYTES" "$W/opta/pe-good" "$IDS"; echo "script exit=$?"
echo; echo "##### A2: one parity value and the id-set line altered (expect VERDICT FAIL on 3 and 4)"
PORT=61435 bash "$A/b1a0/b1a0-dev-restore-verify.sh" "$W/opta/rehearsal2-bad-afldb_prod-20261104T021037Z.dump" "$SN_SHA" "$SN_BYTES" "$W/opta/pe-bad" "$IDS"; echo "script exit=$?"
echo; echo "##### A3: wrong sha256 (expect STOP before any cluster)"
install -m 600 "$SN" "$W/opta/rehearsal2-sha-afldb_prod-20261104T021037Z.dump"; PORT=61436 bash "$A/b1a0/b1a0-dev-restore-verify.sh" "$W/opta/rehearsal2-sha-afldb_prod-20261104T021037Z.dump" 0000 "$SN_BYTES" "$W/opta/pe-good" "$IDS"; echo "script exit=$?"
echo "=== DONE $(date -u +%FT%TZ)"
