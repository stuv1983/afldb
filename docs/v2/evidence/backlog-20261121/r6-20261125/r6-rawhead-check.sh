#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), step F-4: the post-reboot raw-head check. PRODUCTION (afldb-prod), as arm, ONE connection.
# R6 review finding 3 (23 Nov 2026): Sunday's pinned helper a1a2-20261124/a1-rawhead.sh has no host or user guard; it reads
# /home/arm/projects/afldb/.env, creates a temporary probe file and makes loopback requests on any host it is started on. This entry
# point refuses (exit 2, nothing read, nothing written, no request) unless the user is arm AND the host is afldb-prod, then checks
# that the staged helper is byte-identical to Sunday's pin and runs it, unchanged, in check mode against Sunday's baseline
# /home/arm/a1-rawhead-baseline.json. The helper and its baseline are not modified. Before the guard this script runs only
# `hostname` and `id -un`; it never sources .env.
# R6 r3 (Astra, 24 Nov 2026), hash-to-execution: the helper is read ONCE into memory; those bytes are hashed and those same bytes
# are executed (`bash -c`), so the staged path is not opened again between the pin check and execution. (Sunday's helper does
# not use its own path: no BASH_SOURCE, $0 or dirname.) A helper containing a NUL byte cannot be held this way and fails the pin.
# Run (production, after F-2 PASS, from the verified staging root): bash "$STAGE/$B/r6-20261125/r6-rawhead-check.sh"
# Exit: 2 = refused (wrong host or user, helper missing or not the pinned bytes); otherwise the helper's own exit (0 = PASS).
A1_RAWHEAD_SHA256=cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0
main() {
  set -uo pipefail; export LC_ALL=C
  local host user dir helper sum body
  host=$(hostname 2>/dev/null) || host=
  user=$(id -un 2>/dev/null) || user=
  if [ "$host" != afldb-prod ] || [ "$user" != arm ]; then
    echo "STOP not arm@afldb-prod (host '$host', user '$user'): the raw-head probe was not started"
    exit 2
  fi
  dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd) || dir=
  helper=${dir%/r6-20261125}/a1a2-20261124/a1-rawhead.sh
  if [ -z "$dir" ] || [ "$dir" = "${dir%/r6-20261125}" ] || [ ! -f "$helper" ]; then
    echo "STOP run this script from the verified staging root (helper $helper not found)"
    exit 2
  fi
  if ! body=$(cat -- "$helper" 2>/dev/null && printf x); then
    echo "STOP $helper could not be read"
    exit 2
  fi
  body=${body%x}
  sum=$(printf '%s' "$body" | sha256sum | cut -d' ' -f1)
  if [ "$sum" != "$A1_RAWHEAD_SHA256" ]; then
    echo "STOP $helper is $sum, not Sunday's pinned $A1_RAWHEAD_SHA256"
    exit 2
  fi
  echo "== R6 F-4 raw-head entry $(date -u +%FT%TZ) host=$host user=$user helper=$sum (executing the hashed bytes)"
  exec bash -c "$body" "$helper" check
}
main "$@" < /dev/null
