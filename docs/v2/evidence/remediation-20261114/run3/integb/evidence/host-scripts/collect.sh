#!/usr/bin/env bash
# collect.sh : stage the evidence of this scope under $W/collect (ANSI stripped, any postgres:// line removed, JSON/logs gzipped)
set -uo pipefail
W=/mnt/ssd/afldb-rem3-integb-20261114
C=$W/collect; rm -rf "$C"; mkdir -p "$C"/{final,final2,c1,exp,soft,it,facts,host-scripts}
strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
leak() { grep -a -l -i -E 'postgres://|PGPASSWORD|password=' "$@" 2>/dev/null || true; }
cp_text() { # src dst : text file, stripped, kept as .txt (gz if > 200 kB)
  local s=$1 d=$2
  if [ "$(stat -c %s "$s")" -gt 200000 ]; then strip < "$s" | gzip -9n > "$d.gz"; else strip < "$s" > "$d"; fi
}
for t in final:b-final final2:b-final2 c1:b-c1; do
  dst=${t%%:*}; src=$W/evidence/${t##*:}
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    case "$b" in
      *.json) gzip -9n < "$f" > "$C/$dst/$b.gz" ;;
      *.log) strip < "$f" | gzip -9n > "$C/$dst/$b.txt.gz" ;;
      SHA256SUMS) : ;;
      *) cp_text "$f" "$C/$dst/$b" ;;
    esac
  done
  [ -d "$src/brownlow" ] && { mkdir -p "$C/$dst/brownlow"; for f in "$src"/brownlow/*; do b=$(basename "$f"); case "$b" in *.json) gzip -9n < "$f" > "$C/$dst/brownlow/$b.gz" ;; *.log) strip < "$f" | gzip -9n > "$C/$dst/brownlow/$b.txt.gz" ;; *) cp_text "$f" "$C/$dst/brownlow/$b" ;; esac; done; }
done
for f in "$W"/evidence/exp/*; do b=$(basename "$f"); case "$b" in *.json) gzip -9n < "$f" > "$C/exp/$b.gz" ;; *.log) strip < "$f" | gzip -9n > "$C/exp/$b.txt.gz" ;; *) cp_text "$f" "$C/exp/$b" ;; esac; done
for f in "$W"/evidence/soft/*; do b=$(basename "$f"); case "$b" in *.json) gzip -9n < "$f" > "$C/soft/$b.gz" ;; *.log) strip < "$f" | gzip -9n > "$C/soft/$b.txt.gz" ;; *.txt) cp "$f" "$C/soft/$b" ;; esac; done
for f in "$W"/evidence/it/*; do b=$(basename "$f"); case "$b" in *.json) gzip -9n < "$f" > "$C/it/$b.gz" ;; *.log) strip < "$f" | gzip -9n > "$C/it/$b.txt.gz" ;; *) cp_text "$f" "$C/it/$b" ;; esac; done
for f in "$W"/evidence/facts[1-5]-*.txt "$W"/evidence/tsc.out "$W"/evidence/snaptmpl.log "$W"/evidence/setup.log "$W"/evidence/snap-tmpl-probe.txt "$W"/evidence/listener.txt; do [ -f "$f" ] && cp_text "$f" "$C/facts/$(basename "$f")"; done
for f in "$W"/in/*.sh "$W"/in/*.sql "$W"/in/snapA/cmp.js "$W"/in/snapA/msg.js "$W"/in/softlist.js "$W"/in/tc.out "$W"/in/exp-*.out "$W"/in/it-db.out; do [ -f "$f" ] && cp "$f" "$C/host-scripts/"; done
cp "$W"/in/rows2026.sql "$C/host-scripts/" 2>/dev/null || true
echo "files: $(find "$C" -type f | wc -l); size: $(du -sh "$C" | cut -f1)"
echo "possible credential leaks (uncompressed text only):"; leak $(find "$C" -type f ! -name '*.gz') ; echo "(end)"
for g in $(find "$C" -name '*.gz'); do zcat "$g" | grep -a -l -i -E 'postgres://|PGPASSWORD' >/dev/null 2>&1 && echo "LEAK in $g"; done; echo "gz scan done"
