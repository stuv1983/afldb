#!/bin/bash
# scope ops: read-only probe #5: is rsync / rrsync present on production (needed by off-host option A)?
for c in rsync rrsync pg_dump pg_restore gpg curl; do printf '%-11s ' "$c"; command -v "$c" || echo "(absent)"; done
ls -l /usr/share/doc/rsync/scripts/ 2>&1 | head -5
dpkg -l rsync 2>/dev/null | awk 'NR>5{print $1,$2,$3}'
