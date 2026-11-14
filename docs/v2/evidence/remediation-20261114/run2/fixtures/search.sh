#!/usr/bin/env bash
# Read-only search for retained fixtures (run 2, P2-04). Names, stat and sha256 only; no copies; skips private/.
set -u
ROOTS="/mnt/ssd/afldb/records /mnt/ssd/afldb/workspaces /home/arm/projects/afldb/data"
for r in /mnt/ssd/afldb-rem-*-20261114; do ROOTS="$ROOTS $r"; done
echo "# search $(date -Iseconds) roots: $ROOTS"
for name in full-history-20260902 c2-2026-final-core-v1 person-html-20260826 annual-html-20260826; do
  echo "## directory name: $name"
  timeout 600 find $ROOTS -name private -prune -o -type d -name "$name" -print 2>/dev/null | while read -r d; do
    echo "DIR $d files=$(find "$d" -type f | wc -l) bytes=$(du -sb "$d" | cut -f1)"
  done
done
echo "## sample.json under person-html-20260826"
timeout 600 find $ROOTS -name private -prune -o -type f -path '*person-html-20260826*' -name sample.json -print 2>/dev/null | while read -r f; do
  echo "FILE $f size=$(stat -c %s "$f") mtime=$(stat -c %y "$f") sha256=$(sha256sum "$f" | cut -d' ' -f1)"
done
echo "## fitzroy core manifests (json) named full-history-20260902 / c2-2026-final-core-v1"
timeout 600 find $ROOTS -name private -prune -o -type f \( -name 'full-history-20260902*.json' -o -name 'c2-2026-final-core-v1*.json' \) -print 2>/dev/null | while read -r f; do
  echo "FILE $f sha256=$(sha256sum "$f" | cut -d' ' -f1)"
done
echo "## tarballs/archives that may hold them (names only)"
timeout 600 find $ROOTS -name private -prune -o -type f \( -iname '*fitzroy*core*.tar*' -o -iname '*person-html-20260826*' -o -iname '*full-history-20260902*' \) -print 2>/dev/null | head -50
echo "# done"
