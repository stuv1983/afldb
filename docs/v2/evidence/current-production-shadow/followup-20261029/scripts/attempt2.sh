#!/bin/bash
# D-V2-CURRENT-SHADOW-FOLLOWUP-1 attempt 2 of two FILE-ONLY comparators (no database, no cluster). Attempt 1 outputs
# are kept unchanged beside these. Corrections: item 3 parses paths with spaces whole; item 4c matches ACL sections
# to new objects by base name (pg_dump names function DDL by argument types, ACLs by argument names).
set -uo pipefail
export LC_ALL=C
umask 077
R=/home/arm/afldb-v2-currentshadow-20261028T192336Z
F=$R/followup; S=$F/scripts; O=$F/evidence; E=$R/evidence
LV=/home/arm/afldb-v2-linuxverify-20261028T0310Z
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
[ "$(hostname)" = streamanator ] || { echo "STOP: wrong host"; exit 2; }
[ -s "$O/followup.done" ] && [ ! -e "$O/evidence-sha256.txt" ] && [ ! -e "$O/attempt2.log" ] || { echo "STOP: state unexpected"; exit 2; }
exec > >(tee -a "$O/attempt2.log") 2>&1
echo "== attempt 2 start $(date -u +%FT%TZ)"
( cd "$S" && sha256sum --check --strict SCRIPTS2.SHA256 ) || { echo "STOP: attempt-2 scripts not pinned"; exit 2; }
cp "$S/SCRIPTS2.SHA256" "$O/scripts2.expected.sha256"
"$NODE" "$S/inventory-compare2.mjs" "$E/src-vs-c478c31b-manifest.diff" "$E/src.files.sha256" "$LV/xfer/inputs.sha256" \
  "$LV/evidence/src-c478c31b.files.sha256" "$O/src-rehash.sha256" "$O/inputs-tar.list" "$O/inventory-comparison.attempt2.json"
echo "EXIT inventory-compare.attempt2 = $?" | tee -a "$O/exit-codes.attempt2.txt"
"$NODE" "$S/schema-sections2.mjs" "$O/archive.schema.sql" "$E/before.schema.sql" "$E/postmig.schema.sql" "$R/src/src/db/migrations" "$O/schema-sections.attempt2.json"
echo "EXIT schema-sections.attempt2 = $?" | tee -a "$O/exit-codes.attempt2.txt"
echo "== attempt 2 done $(date -u +%FT%TZ)"
