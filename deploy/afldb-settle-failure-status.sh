#!/bin/sh
# AFLDB-ISSUE-332 (review A-07) — READ-ONLY pull check of the nightly AFL API settle, for a monitor that runs ELSEWHERE.
#
# Why it exists. This host has no mail transport, no alerting agent and no journal forwarding (read-only probe 2026-11-14,
# docs/v2/evidence/remediation-20261114/run2/ops/README.md §2), and the failure notifier unit is deliberately sealed
# (PrivateNetwork=true), so a failed nightly is recorded here and delivered nowhere. A check that an owner-run host pulls
# over SSH (forced command, no shell) delivers the signal without opening the production host to the network, and it also
# sees what a push notifier cannot: a timer that stopped firing, or a host that is down (the pull itself then fails).
#
# What it reads, all read-only and unprivileged: `systemctl show` of the two settle services and the nightly timer, and
# (information only) the notifier marker directory if the notifier is installed. It works WITHOUT the notifier installed:
# the unit's own Result is authoritative for the latest run (a later success replaces a failure, so there is no stale
# marker to reason about). It opens no database and reads no credential, journal or log.
#
# Output: one `AFLDB_SETTLE_STATUS <OK|FAILED|UNKNOWN> ...` line first, then one line per fact. Exit 0 OK, 1 FAILED (a unit
# failed, the nightly timer is not active, or it has not fired within AFLDB_SETTLE_MAX_TRIGGER_AGE_H, default 36), 2 UNKNOWN
# (a property could not be read: treat as an alarm, never as OK).
#
# Environment (all optional; rehearsal and tests only): AFLDB_FAILURE_SYSTEMCTL (stub systemctl), AFLDB_FAILURE_STATE_DIR,
# AFLDB_FAILURE_NOW (epoch seconds), AFLDB_SETTLE_MAX_TRIGGER_AGE_H.
set -u
systemctl_bin="${AFLDB_FAILURE_SYSTEMCTL:-systemctl}"
state_dir="${AFLDB_FAILURE_STATE_DIR:-/var/lib/afldb-settle-failure}"
max_age_h="${AFLDB_SETTLE_MAX_TRIGGER_AGE_H:-36}"
now="${AFLDB_FAILURE_NOW:-$(date -u +%s)}"
case "$max_age_h" in '' | *[!0-9]*) max_age_h=36 ;; esac

failed=0
unknown=0
facts=""
add() { facts="$facts
$1"; }

# One property, one line, only characters a systemd value can carry here (never a shifted field, never a control byte).
# TZ=UTC because `systemctl show` ignores --timestamp= and prints a local-zone abbreviation GNU date cannot parse (AEDT):
# found by running this script read-only against production, where the unpinned form answered UNKNOWN.
prop() { TZ=UTC "$systemctl_bin" show "$1" -p "$2" --value 2>/dev/null | head -n 1 | tr -cd 'A-Za-z0-9 :._+-'; }

for unit in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do
  load="$(prop "$unit" LoadState)"
  if [ -z "$load" ] || [ "$load" = "not-found" ]; then
    unknown=1; add "unit $unit: not loaded or unreadable (LoadState=${load:-empty})"; continue
  fi
  result="$(prop "$unit" Result)"
  active="$(prop "$unit" ActiveState)"
  status="$(prop "$unit" ExecMainStatus)"
  add "unit $unit: ActiveState=${active:-?} Result=${result:-?} ExecMainStatus=${status:-?}"
  if [ -z "$result" ]; then unknown=1
  elif [ "$result" != "success" ] || [ "$active" = "failed" ]; then failed=1; add "  FAILED: the latest run of $unit did not succeed"
  fi
  marker="$state_dir/${unit%.service}.failed"
  if [ -f "$marker" ]; then add "  notifier marker present (information; the unit Result above is authoritative): $(grep -m1 '^time_utc=' "$marker" 2>/dev/null | tr -cd 'A-Za-z0-9=:._-')"; fi
done

# Liveness of the nightly: only the AFL API timer (the Brownlow timer is disabled by design until its window opens).
timer=afldb-settle-afl-api.timer
tload="$(prop "$timer" LoadState)"
tactive="$(prop "$timer" ActiveState)"
if [ -z "$tload" ] || [ "$tload" = "not-found" ]; then
  unknown=1; add "timer $timer: not loaded or unreadable"
elif [ "$tactive" != "active" ]; then
  failed=1; add "timer $timer: ActiveState=${tactive:-?}; FAILED: the nightly will not run"
else
  last="$(prop "$timer" LastTriggerUSec)"
  last_s=""
  if [ -n "$last" ] && [ "$last" != "n/a" ]; then last_s="$(date -u -d "$last" +%s 2>/dev/null || true)"; fi
  if [ -z "$last_s" ]; then
    unknown=1; add "timer $timer: LastTriggerUSec=${last:-empty}; cannot compute the age"
  else
    age_h=$(( (now - last_s) / 3600 ))
    add "timer $timer: active, last fired $last (${age_h} h ago; limit ${max_age_h} h)"
    if [ "$age_h" -gt "$max_age_h" ]; then failed=1; add "  FAILED: the nightly timer has not fired for ${age_h} h"; fi
  fi
fi

if [ "$failed" -ne 0 ]; then verdict=FAILED; code=1
elif [ "$unknown" -ne 0 ]; then verdict=UNKNOWN; code=2
else verdict=OK; code=0
fi
echo "AFLDB_SETTLE_STATUS $verdict"
printf '%s\n' "$facts" | sed '1{/^$/d;}'
exit "$code"
