#!/usr/bin/env bash
# remediation run 4, scope `qual`: stage the P0/P1 evidence (closure, rebuild, equivalence, setup) for transfer to the workstation. Read-only on evidence; writes $W/stage/p1.
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-qual-20261115; E=$W/evidence; S=$W/stage/p1
mkdir -p "$S"
sed -n '/==> FINAL VALIDATION/,/Rebuild complete/p' "$E/rebuild.out" > "$S/final-validation.txt"
grep -a -E '^==> ' "$E/rebuild.out" > "$S/rebuild-stage-banners.txt"
gzip -c "$E/rebuild.out" > "$S/rebuild.out.gz"
for f in plan.out inputs-precopy-run3ws.txt inputs-postcopy.txt inputs-after-rebuild.txt inputs-files-q.sha256 inputs-files-vs-run3.diff \
  dump.out dump.sha256 rb-restore.log ref-restore.log rb-table-counts.restored.tsv rb-table-counts.published-run3.tsv rb-table-counts.diff rb-table-counts.rebuilt-vs-restored.diff rebuilt-table-counts.tsv \
  brownlow-stat-availability.q.txt brownlow-stat-availability.q2.txt brownlow-stat-availability.r3.txt brownlow-stat-availability.q.summary.txt brownlow-stat-availability.r3.summary.txt \
  brownlow-stat-availability.r3-vs-q.diff brownlow-stat-availability.r3-vs-q2.diff digest.q.tsv digest.r3.tsv digest.r3-vs-q.diff venue_aliases.q.txt venue_aliases.r3.txt venue_aliases.explain.txt \
  rb-template-identity.txt snap-tmpl-probe.txt snap-template-identity.txt snap-template.table-counts.tsv listener.txt; do
  [ -f "$E/$f" ] && cp -p "$E/$f" "$S/$f" || echo "MISSING $f"
done
gzip -c "$E/dump.toc.txt" > "$S/dump.toc.txt.gz"
cp -p "$W/rebuild-pre.out" "$S/rebuild-pre.out"; cp -p "$W/setup.out" "$S/setup.out"; cp -p "$E/post1.out" "$S/post1.out"; cp -p "$E/post2.out" "$S/post2.out"; cp -p "$E/closure.out" "$S/closure.out"
mkdir -p "$S/closure"
for f in rebuild-per-entry.tsv rebuild-union.txt rebuild-intersection.txt aflw-entries.txt aflw-per-entry.tsv aflw-union.txt aflw-intersection.txt prefix-intersection.txt diff-6d5388ea-Qpp-nonrecord.txt; do cp -p "$E/closure/$f" "$S/closure/$f"; done
# the host's own diff lists (to be compared byte-for-byte with the workstation's)
for b in 692b1902 6d5388ea 7cfbe186; do sha256sum "$E/closure/diff-$b-Qpp.txt"; done > "$S/closure/host-diff-lists.sha256"
# rebuild time, from the rebuild log's own end line
grep -a -E '^(start_utc|lock_acquired_utc|end_utc)=' "$E/rebuild.out" > "$S/rebuild-times.txt"
ls -la "$S" | head -60; du -sh "$S"
