#!/bin/sh
# AFLDB-ISSUE-332 (review A-07) — OPTIONAL network transport for the settle failure marker.
#
# Started as afldb-settle-failure-transport@<unit>.service, by an owner-installed drop-in on the notifier template (OnSuccess=,
# so the marker already exists). It is separate from the notifier on purpose: the notifier is sealed (PrivateNetwork=true,
# AF_UNIX only) and stays that way; this unit is the only one that may reach the network, and it holds no credential,
# database, journal or checkout secret (the unit hides /home except the read-only deploy directory).
#
# It runs ONE owner-supplied executable, AFLDB_FAILURE_TRANSPORT, with the marker path as its only argument. Without that
# variable it sends nothing and exits 0. A transport failure exits non-zero so the unit shows in `systemctl --failed`;
# the marker is the record either way. A credential for the transport (a webhook or ping URL) is supplied by the owner with
# a LoadCredential= line in the same drop-in and read by the transport from $CREDENTIALS_DIRECTORY; it is never in this repo.
#
# Environment: AFLDB_FAILURE_TRANSPORT (the executable), AFLDB_FAILURE_STATE_DIR (default /var/lib/afldb-settle-failure; tests).
set -u
umask 077

instance="${1:-}"
case "$instance" in
  afldb-settle-afl-api.service | afldb-settle-afl-api-brownlow.service) ;;
  *) echo "afldb-settle-failure-transport: refusing instance '$instance' (not a settle unit)" >&2; exit 2 ;;
esac

transport="${AFLDB_FAILURE_TRANSPORT:-}"
if [ -z "$transport" ]; then
  echo "afldb-settle-failure-transport: no transport configured; nothing sent (the marker is still the record)"
  exit 0
fi

state_dir="${AFLDB_FAILURE_STATE_DIR:-/var/lib/afldb-settle-failure}"
marker="$state_dir/${instance%.service}.failed"
if [ ! -f "$marker" ]; then
  echo "afldb-settle-failure-transport: no marker at $marker; nothing to send" >&2
  exit 3
fi
if [ ! -f "$transport" ] || [ ! -x "$transport" ]; then
  echo "afldb-settle-failure-transport: AFLDB_FAILURE_TRANSPORT is not an executable file" >&2
  exit 4
fi
if "$transport" "$marker"; then
  echo "AFLDB_SETTLE_FAILURE_DELIVERED unit=$instance marker=$marker"
  exit 0
fi
echo "afldb-settle-failure-transport: the transport exited non-zero; the marker is still the record" >&2
exit 1
