#!/usr/bin/env bash
# R5 (ISSUE-362 O-1): print the EXACT retained paths of the pre-fix Caddy logs with sizes and checksums, for the owner's
# disposal-approval decision (earliest disposal REVIEW date Thu 7 Jan 2027; disposal itself needs a separate owner approval).
# PRODUCTION, run by the OWNER AS ROOT (the directory is root:root 0700). It takes no argument and hard-codes the directory.
# TRANSPORT (reviewer F-009; this file is NOT in the production checkout and must never be copied into it: P0-style probes require
# an empty `git status --porcelain`): at the 7 Jan 2027 review sitting, Claude pipes it as arm to /home/arm/ops/r5-retained-paths.sh
#   (tr -d '\r' < r5-retained-paths.sh | ssh.exe -o BatchMode=yes afldb 'umask 077; mkdir -p /home/arm/ops && cat > /home/arm/ops/r5-retained-paths.sh')
# (a production write of one file outside the checkout, named in the record); the owner then runs
#   sha256sum /home/arm/ops/r5-retained-paths.sh   -> must equal the sha256 recorded in R5-RETENTION-PROPOSAL.md section 7
#   sudo bash /home/arm/ops/r5-retained-paths.sh
# and removes the copy afterwards (rm /home/arm/ops/r5-retained-paths.sh). In A2 itself the inline owner block of runbook 4.5a
# (same checks, literal commands) is used instead: no file transfer on Tuesday.
# READ-ONLY: lists metadata, hashes files and runs `sha256sum -c` against the directory's own SHA256SUMS. It never prints file
# CONTENT, never writes, moves or deletes anything. Output is safe to paste into a record (names, sizes, hashes, counts).
# Command inventory: id stat find sort sha256sum cut wc grep date hostname printf echo (cd into the directory in a subshell).
# Override for a rehearsal on a scratch directory (never on production): R5_DIR=<dir> R5_ALLOW_NONROOT=1 bash r5-retained-paths.sh
set -uo pipefail; export LC_ALL=C
[ -n "${R5_DIR:-}" ] && [ "$(hostname)" = afldb-prod ] && { echo "STOP the R5_DIR override is refused on afldb-prod"; exit 2; }
R=${R5_DIR:-/var/log/afldb-r5-prefix-retained-20261124}
if [ "${R5_ALLOW_NONROOT:-0}" != 1 ]; then [ "$(id -u)" = 0 ] || { echo "STOP run as root (sudo bash r5-retained-paths.sh)"; exit 2; }; fi
echo "== R5 retained paths $(date -u +%FT%TZ) host=$(hostname) dir=$R"
[ -d "$R" ] || { echo "STOP $R does not exist"; exit 1; }
echo "directory: $(stat -c '%U:%G %a' "$R")  (expected root:root 700)"
F=0
echo "-- exact paths (name | bytes | owner:group mode | mtime UTC | sha256)"
T=0; n=0
while IFS= read -r -d '' f; do
  b=$(stat -c %s "$f"); T=$((T+b)); n=$((n+1))
  printf '%s | %s | %s | %s | %s\n' "$f" "$b" "$(stat -c '%U:%G %a' "$f")" "$(TZ=UTC stat -c %y "$f" | cut -c1-19)" "$(sha256sum < "$f" | cut -d' ' -f1)"
  [ "$(stat -c '%U:%G %a' "$f")" = "root:root 600" ] || { echo "  FAIL owner/mode of $f"; F=$((F+1)); }
done < <(find "$R" -mindepth 1 -maxdepth 1 -type f -print0 | sort -z)
echo "files: $n; total bytes: $T"
others=$(find "$R" -mindepth 1 \( ! -type f -o -path "$R/*/*" \) -print | wc -l); [ "$others" = 0 ] || { echo "  FAIL $others non-file or nested entries"; F=$((F+1)); }
echo "-- classification"
echo "rolled access files: $(find "$R" -maxdepth 1 -name 'afldb-access-2*.log.gz' | wc -l) (expected 5; 4 if Caddy pruned 2026-09-07 before A2)"
echo "rolled apex files:   $(find "$R" -maxdepth 1 -name 'afldb-apex-2*.log.gz' | wc -l) (expected 3, or 4 if the apex log rolled before A2)"
echo "live-file copies:    $(find "$R" -maxdepth 1 -name 'afldb-*.log.copy-at-r5-*' | wc -l) (expected 2)"
echo "not here by design:  /var/log/caddy/afldb-access-2026-09-04T11-02-31.065-size.log.gz (rotated out by Caddy between 14 and 22 Nov 2026; not recoverable from this host)"
if [ -f "$R/SHA256SUMS" ]; then
  L=$(wc -l < "$R/SHA256SUMS"); echo "SHA256SUMS lines: $L (expected = files - 1 = $((n-1)))"; [ "$L" = $((n-1)) ] || { echo "  FAIL SHA256SUMS line count"; F=$((F+1)); }
  grep -q ' SHA256SUMS$' "$R/SHA256SUMS" && { echo "  FAIL SHA256SUMS lists itself"; F=$((F+1)); }
  (cd "$R" && sha256sum -c --quiet SHA256SUMS) && echo "PASS sha256sum -c SHA256SUMS" || { echo "  FAIL sha256sum -c SHA256SUMS"; F=$((F+1)); }
else echo "  FAIL no SHA256SUMS"; F=$((F+1)); fi
echo "-- deletion-approval list (exact paths; for the owner's decision only; this script deletes nothing)"
find "$R" -mindepth 1 -maxdepth 1 -type f -print | sort; echo "$R/  (the directory, after its files)"
echo; [ $F = 0 ] && echo "R5 RETAINED RESULT PASS ($n files, $T bytes)" || { echo "R5 RETAINED RESULT FAIL ($F)"; exit 1; }
