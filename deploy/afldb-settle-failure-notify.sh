#!/bin/sh
# AFLDB-ISSUE-332 (OPS-4 of the 2026-11-14 full review) — the failure notifier for the nightly AFL API settle units.
#
# Started by systemd as afldb-settle-failure@<unit>.service when the named settle unit ENTERS the failed state
# (deploy/afldb-settle-afl-api.service.d/on-failure.conf, OnFailure=). It is a notifier, never a retry: it
# changes nothing about the settle, opens no database, reads no credential and sends nothing by itself.
#
# What it does, in order, each step failing closed:
#   1. validates the instance name against the two settle units (no path, no shell metacharacter ever reaches a command);
#   2. writes ONE marker file, atomically (write to a temp name, rename), under $STATE_DIR (systemd StateDirectory=):
#        <unit-without-.service>.failed        the latest failure of that unit: UTC time, unit, result, exit status,
#                                              invocation id, the line to run to read the failure
#   3. appends one line to $STATE_DIR/failures.log (an append-only history; the marker is the "latest" view);
#   4. only if AFLDB_FAILURE_TRANSPORT names an executable file: runs it with the marker path as its one argument.
#      The unit configures no transport. Inside this sealed unit (PrivateNetwork=true, AF_UNIX only) a transport can only use
#      LOCAL channels; it CANNOT reach the network, so a mail relay or webhook set here would log "transport exited non-zero"
#      and deliver nothing (review A-07). A network channel belongs to the separate, optional
#      afldb-settle-failure-transport@.service (started by the owner drop-in transport.conf.example after this unit succeeds),
#      or to the pull check deploy/afldb-settle-failure-status.sh. The application mailer is deliberately NOT reused, because
#      the settle units drop every SMTP credential by design (AFLDB-ISSUE-232). A transport failure is logged and never
#      changes this script's exit status: the marker is the record.
#
# A marker is "stale" once a later run of the unit succeeded; the check below compares the two. See
# docs/v2/evidence/remediation-20261114/rollover/README.md (operator runbook) for the exact check and the safe re-run.
#
# Environment (all optional; the unit sets none of them except STATE_DIRECTORY via systemd):
#   STATE_DIRECTORY             set by systemd from StateDirectory= (the marker directory)
#   AFLDB_FAILURE_STATE_DIR     overrides STATE_DIRECTORY (rehearsal only)
#   AFLDB_FAILURE_TRANSPORT     an executable called as: $AFLDB_FAILURE_TRANSPORT <marker-path>
#   AFLDB_FAILURE_SYSTEMCTL     the systemctl to ask for the unit's state (rehearsal stub); default systemctl
set -eu
umask 077

instance="${1:-}"
case "$instance" in
  afldb-settle-afl-api.service | afldb-settle-afl-api-brownlow.service) ;;
  *) echo "afldb-settle-failure-notify: refusing instance '$instance' (not a settle unit)" >&2; exit 2 ;;
esac
unit_base="${instance%.service}"

state_dir="${AFLDB_FAILURE_STATE_DIR:-${STATE_DIRECTORY:-}}"
if [ -z "$state_dir" ] || [ ! -d "$state_dir" ]; then
  echo "afldb-settle-failure-notify: no state directory (STATE_DIRECTORY / AFLDB_FAILURE_STATE_DIR); nothing recorded" >&2
  exit 3
fi

systemctl_bin="${AFLDB_FAILURE_SYSTEMCTL:-systemctl}"
# `show` is read-only and needs no privilege. Each property is requested separately so one missing property is "unknown",
# never a shifted field.
prop() { "$systemctl_bin" show "$instance" -p "$1" --value 2>/dev/null | head -n 1 | tr -cd 'A-Za-z0-9 :._+-' || true; }
result="$(prop Result)"
exit_status="$(prop ExecMainStatus)"
invocation="$(prop InvocationID)"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

marker="$state_dir/$unit_base.failed"
tmp="$state_dir/.$unit_base.failed.$$"
{
  echo "time_utc=$now"
  echo "unit=$instance"
  echo "result=${result:-unknown}"
  echo "exit_status=${exit_status:-unknown}"
  echo "invocation_id=${invocation:-unknown}"
  echo "read_failure=journalctl -u $unit_base --since '-1 day' | grep -E 'AFLDB_SETTLE_FAILURE|HALT|REFUSED|ERROR|FAILED'"
  echo "runbook=docs/v2/evidence/remediation-20261114/rollover/README.md (operator recovery runbook for a failed nightly)"
} > "$tmp"
mv -f "$tmp" "$marker"
printf '%s %s result=%s exit=%s invocation=%s\n' "$now" "$instance" "${result:-unknown}" "${exit_status:-unknown}" "${invocation:-unknown}" >> "$state_dir/failures.log"
echo "AFLDB_SETTLE_FAILURE_RECORDED unit=$instance marker=$marker"

transport="${AFLDB_FAILURE_TRANSPORT:-}"
if [ -n "$transport" ]; then
  if [ -f "$transport" ] && [ -x "$transport" ]; then
    "$transport" "$marker" || echo "afldb-settle-failure-notify: transport exited non-zero; the marker is still the record" >&2
  else
    echo "afldb-settle-failure-notify: AFLDB_FAILURE_TRANSPORT is not an executable file; the marker is still the record" >&2
  fi
fi
exit 0
