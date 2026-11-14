#!/usr/bin/env bash
# AFLDB-ISSUE-357 alternative / complement to the Caddy deny: remove the ISR entries Next persisted for a notFound()
# or a redirect. NOT installed anywhere; tested only against a disposable .next in the caddy357 workspace.
#
# A persisted not-found or redirect is recorded in the entry's .meta with a non-200 status
# ({"headers":{...},"status":404,...}). A 200 entry has no "status" key. Deleting a 404/308 entry loses nothing: Next
# renders it again on the next request, and the answer is the same 404/308.
#
# usage: prune-not-found.sh <path to .next/server/app> [--delete] [--min-age-minutes N]
#   default is a dry run: it lists counts and the disk it would free, deletes nothing.
#   Only the ISR route prefixes below are touched, and only entries older than N minutes (default 30) so a file
#   Next is still writing is never removed.
set -eu
A=${1:?usage: prune-not-found.sh <.next/server/app> [--delete] [--min-age-minutes N]}; shift
DELETE=no; AGE=30
while [ $# -gt 0 ]; do case "$1" in --delete) DELETE=yes;; --min-age-minutes) shift; AGE=$1;; *) echo "unknown arg $1"; exit 2;; esac; shift; done
[ -d "$A/players" ] || { echo "refusing: $A does not look like .next/server/app"; exit 2; }
n=0; kib=0
LIST=$(mktemp); trap 'rm -f "$LIST"' EXIT
for prefix in players matches seasons brownlow clubs venues honour-teams sitemap; do
  [ -d "$A/$prefix" ] || continue
  # list first, delete afterwards: deleting while `find` is still reading the directory races with it
  find "$A/$prefix" -maxdepth 1 -name '*.meta' -mmin +"$AGE" -print0 | xargs -0 -r grep -lE '"status":(404|307|308)' >> "$LIST" || true
done
while IFS= read -r meta; do
  base=${meta%.meta}
  sz=$(du -sck "$base".html "$base".meta "$base".rsc "$base".body "$base".segments 2>/dev/null | tail -1 | cut -f1)
  n=$((n+1)); kib=$((kib+${sz:-0}))
  if [ "$DELETE" = yes ]; then rm -f -- "$base".html "$base".meta "$base".rsc "$base".body; rm -rf -- "$base".segments; fi
done < "$LIST"
echo "$( [ "$DELETE" = yes ] && echo deleted || echo 'would delete (dry run)' ): entries=$n disk_KiB=$kib"
