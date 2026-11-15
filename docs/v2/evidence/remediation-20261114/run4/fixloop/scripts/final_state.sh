#!/usr/bin/env bash
# fixloop: database list and host-only hashes (read-only), BEFORE the cluster is stopped.
set -u -o pipefail
. "$(dirname "$0")/common.sh"
{
  echo "date $(date -u +%FT%TZ)"
  echo "cand HEAD=$(git -C $CAND rev-parse HEAD) porcelain=$(git -C $CAND status --porcelain | wc -l)"
  echo "databases on the cluster (port $PORT):"
  IR list 2>&1 | strip
} | tee "$E/final-db-list.txt"
# host-only payload hashes (uncompressed originals, bundle/dump inputs), absolute paths
{
  (cd "$E" && for f in f3_*.json f3_*.log mnew*.json mnew*.log mreal*.json mreal*.log mctl*.json mctl*.log unit-all.json unit-all.log unit-all2.json unit-all2.log unit-focus.json unit-focus.log; do [ -f "$f" ] && sha256sum "$PWD/$f"; done)
  sha256sum "$BUNDLE" "$QDUMP" "$SNAP"
} > "$E/HOST-SHA256SUMS"
wc -l "$E/HOST-SHA256SUMS"
