#!/usr/bin/env bash
# Packet 6R sitting, block R3 = packet 6R §5.2 removal step, for any path on which P6 did not run (B1a-0 failed, dry run did not pass,
# B1a abandoned). PRODUCTION, as arm. Removes only the two untracked artifact copies from the checkout; $A stays (700) as the record.
# Run: tr -d '\r' < r3-remove-artifacts.sh | ssh afldb bash -s
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
cd /home/arm/projects/afldb; REL=docs/v2/evidence/remediation-20261114/run6r/b1a
[ "$(git rev-parse HEAD)" = a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5 ]
rm -f "$REL"/b1a-repair-2026-r6r.mts "$REL"/b1a-accept-r6r.sql; rmdir -p "$REL" 2>/dev/null || true
git status --porcelain; [ -z "$(git status --porcelain)" ]; echo "R3 RESULT porcelain empty"
}
main "$@" < /dev/null
