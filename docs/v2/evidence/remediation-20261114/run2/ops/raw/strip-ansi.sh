#!/bin/bash
# scope ops: LF-only ANSI-stripped copies of the raw host outputs, with sha256 of raw and clean copies.
set -eu
cd /mnt/ssd/afldb-rem2-ops-20261114/out
for f in attended-proof deploy-release-test ingestion-332-green ingestion-332-green2 ingestion-332-red two-files verify-units; do
  sed -r 's/\x1b\[[0-9;]*m//g' "$f.txt" | tr -d '\r' > "$f.clean.txt"
done
rm -f npm-ci.clean.txt
sha256sum attended-proof.txt deploy-release-test.txt ingestion-332-green.txt ingestion-332-green2.txt ingestion-332-red.txt two-files.txt verify-units.txt > raw.sha256
sha256sum *.clean.txt > clean.sha256
cat raw.sha256 clean.sha256
