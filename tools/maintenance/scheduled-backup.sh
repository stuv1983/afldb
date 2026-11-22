#!/usr/bin/env bash
#
# AFLDB-ISSUE-352: scheduled backup, weekly restore verification, off-host copy and a monitor probe.
#
#   scheduled-backup.sh backup    one backup (tools/maintenance/backup.sh), checksum sidecar, optional off-host copy
#   scheduled-backup.sh verify    a FRESH backup, then tools/maintenance/restore-test.sh on exactly that dump
#   scheduled-backup.sh status    read-only: exit 0 only if the last backup/verify are recent and nothing FAILED
#
# This WRAPS backup.sh and restore-test.sh; it never edits or reimplements them (their text is pinned by
# tests/restore-test.test.sh and tests/db-promotion-check.test.ts, and ISSUE-341/342 hardened them).
#
# Environment (every value explicit; there is no default backup directory on purpose):
#   AFLDB_BACKUP_DIR              REQUIRED absolute path. Use a DEDICATED directory, not the one that holds the per-operation
#                                 dumps: backup.sh prunes every <db>-*.dump it finds there down to --keep.
#   AFLDB_BACKUP_KEEP             local retention, newest N dumps (default 14)
#   AFLDB_OFFHOST_DEST            optional existing directory (a mounted off-host volume); each new dump + sidecar is copied,
#                                 re-hashed and listed there. The recommended off-host path is the PULL script
#                                 tools/maintenance/offhost-pull.sh, run on the other host.
#   AFLDB_OFFHOST_KEEP            retention at the destination (default 30)
#   AFLDB_OFFHOST_REQUIRE_MOUNT   1 = the destination must be a mount point (a missing mount fails instead of filling /)
#   AFLDB_VERIFY_RETRY_SECONDS    pause before the one retry of a failed parity check (default 60): a live write between the
#                                 dump and the comparison is the only benign cause
#   AFLDB_BACKUP_MAX_AGE_HOURS    status: newest backup must be younger than this (default 30)
#   AFLDB_VERIFY_MAX_AGE_HOURS    status: newest verification must be younger than this (default 216 = 9 days)
#   AFLDB_BACKUP_TOOLS_DIR        where backup.sh and restore-test.sh live (default: this script's directory)
#
# backup.sh / restore-test.sh read the DSNs from the checkout's .env themselves (a DSN is never put on a command line).
# Exit codes: 0 ok; 1 failed (FAILED-<mode> marker written); 2 usage/configuration; 75 another run holds the lock (no marker).
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TOOLS="${AFLDB_BACKUP_TOOLS_DIR:-$HERE}"
MODE="${1:-}"

log() { printf '%s scheduled-backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die_config() { log "CONFIGURATION: $*" >&2; exit 2; }

case "$MODE" in backup|verify|status) ;; *) die_config "usage: scheduled-backup.sh backup|verify|status" ;; esac

BACKUP_DIR="${AFLDB_BACKUP_DIR:-}"
[[ -n "$BACKUP_DIR" && "$BACKUP_DIR" == /* ]] || die_config "AFLDB_BACKUP_DIR must be set to an absolute path (no default: a scheduled job must never guess its target)"
KEEP="${AFLDB_BACKUP_KEEP:-14}"
OFFHOST_DEST="${AFLDB_OFFHOST_DEST:-}"
OFFHOST_KEEP="${AFLDB_OFFHOST_KEEP:-30}"
RETRY_SECONDS="${AFLDB_VERIFY_RETRY_SECONDS:-60}"
MAX_BACKUP_H="${AFLDB_BACKUP_MAX_AGE_HOURS:-30}"
MAX_VERIFY_H="${AFLDB_VERIFY_MAX_AGE_HOURS:-216}"
for n in KEEP OFFHOST_KEEP RETRY_SECONDS MAX_BACKUP_H MAX_VERIFY_H; do
  [[ "${!n}" =~ ^[0-9]+$ ]] || die_config "$n must be a non-negative integer (got '${!n}')"
done
[[ "$KEEP" -ge 1 && "$OFFHOST_KEEP" -ge 1 ]] || die_config "retention must be at least 1"

STATE="$BACKUP_DIR/.state"

if [[ "$MODE" == status ]]; then
  now=$(date +%s)
  rc=0
  field() { sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p" "$1" 2>/dev/null | head -1; }
  check() { # label file max-hours
    local label="$1" file="$2" max="$3" epoch age
    if [[ ! -f "$file" ]]; then log "STATUS FAIL $label: never recorded ($file absent)"; rc=1; return; fi
    epoch=$(field "$file" epoch); age=$(( (now - ${epoch:-0}) / 3600 ))
    if [[ -z "$epoch" || "$age" -gt "$max" ]]; then log "STATUS FAIL $label: last success ${age}h ago (limit ${max}h)"; rc=1
    else log "STATUS ok   $label: $(field "$file" file) ${age}h ago"; fi
  }
  check "backup" "$STATE/last-backup.json" "$MAX_BACKUP_H"
  check "restore verification" "$STATE/last-verify.json" "$MAX_VERIFY_H"
  # Per-mode markers (review A-02): a backup success must not erase a failed restore verification.
  for marker in FAILED-backup FAILED-verify; do
    if [[ -f "$STATE/$marker" ]]; then log "STATUS FAIL a run failed: $(cat "$STATE/$marker")"; rc=1; fi
  done
  if [[ -f "$STATE/FAILED-unit" ]]; then log "STATUS FAIL the failure unit fired at $(cat "$STATE/FAILED-unit")"; rc=1; fi
  [[ -f "$STATE/last-backup.json" ]] && grep -q '"offhost":"failed"' "$STATE/last-backup.json" && { log "STATUS FAIL the last off-host copy failed"; rc=1; }
  exit "$rc"
fi

mkdir -p "$BACKUP_DIR" "$STATE" || die_config "cannot create $BACKUP_DIR"
chmod 700 "$STATE"
log "target: mode=$MODE dir=$BACKUP_DIR keep=$KEEP offhost=${OFFHOST_DEST:-none} tools=$TOOLS"
for tool in backup.sh restore-test.sh; do [[ -f "$TOOLS/$tool" ]] || die_config "$TOOLS/$tool not found"; done

# One run at a time; a second one is not a failure.
exec 9> "$STATE/lock"
flock -n 9 || { log "another run holds $STATE/lock; nothing done"; exit 75; }

fail() { # step exit-code
  printf '{"ts":"%s","mode":"%s","step":"%s","exit":%s}\n' "$(date -u +%FT%TZ)" "$MODE" "$1" "$2" > "$STATE/FAILED-$MODE"
  log "AFLDB_BACKUP_FAILURE mode=$MODE step=$1 exit=$2"
  exit 1
}
# A state record is evidence: status and the failure markers are judged against it. Returns 0 ONLY when the temporary write and
# the rename both succeeded (ISSUE-352 review, 22 Nov 2026: an unwritable destination used to log "backup ok", exit 0 and
# clear the failure marker). The previous record stays in place on any failure; callers must stop on a non-zero return.
write_state() { # file json
  local f="$1" tmp="$1.tmp"
  if [[ ! -d "$f" ]] && printf '%s\n' "$2" > "$tmp" && mv -f -- "$tmp" "$f"; then return 0; fi
  log "state write failed for $f (previous record kept)" >&2
  [[ -f "$tmp" ]] && rm -f -- "$tmp"
  return 1
}
scrub() { sed -E 's#postgres(ql)?://[^[:space:]]+#<dsn>#g'; }
# A success clears only the markers it disproves (review A-02): backup clears FAILED-backup; verify (which also takes a
# backup) clears both. FAILED-unit cannot name its mode, so it clears only once BOTH a backup and a verification have
# succeeded after it fired.
clear_markers() { # marker...
  local m; for m in "$@"; do rm -f "$STATE/$m"; done
  if [[ -f "$STATE/FAILED-unit" && "$STATE/last-backup.json" -nt "$STATE/FAILED-unit" && "$STATE/last-verify.json" -nt "$STATE/FAILED-unit" ]]; then
    rm -f "$STATE/FAILED-unit"
  fi
}

NEW_DUMP=''
run_backup() {
  local out rc
  out=$(bash "$TOOLS/backup.sh" --dir "$BACKUP_DIR" --keep "$KEEP" 2>&1); rc=$?
  printf '%s\n' "$out" | scrub
  [[ $rc -eq 0 ]] || return "$rc"
  NEW_DUMP=$(printf '%s\n' "$out" | sed -n 's/^==> Backing up .* to \(.*\)$/\1/p' | head -1)
  if [[ -z "$NEW_DUMP" || ! -s "$NEW_DUMP" ]]; then log "backup.sh succeeded but its dump cannot be found"; return 70; fi
  case "$NEW_DUMP" in "$BACKUP_DIR"/*) ;; *) log "backup.sh wrote outside $BACKUP_DIR: $NEW_DUMP"; return 71 ;; esac
  # Checksum sidecar (sha256sum -c format), so any copy can be proven byte-identical; then drop sidecars of pruned dumps.
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$NEW_DUMP")" > "$(basename "$NEW_DUMP").sha256") || return 72
  chmod 600 "$NEW_DUMP.sha256"
  local s
  for s in "$BACKUP_DIR"/*.dump.sha256; do [[ -e "$s" && ! -e "${s%.sha256}" ]] && rm -f "$s"; done
  return 0
}

offhost_push() { # dump  -> prints ok|failed|skipped
  [[ -n "$OFFHOST_DEST" ]] || { echo skipped; return 0; }
  local f="$1" b; b="$(basename "$1")"
  if [[ ! -d "$OFFHOST_DEST" ]]; then log "off-host destination $OFFHOST_DEST is not a directory (a missing mount must fail, not be created)" >&2; echo failed; return 1; fi
  if [[ "${AFLDB_OFFHOST_REQUIRE_MOUNT:-0}" == 1 ]] && ! mountpoint -q "$OFFHOST_DEST"; then log "off-host destination $OFFHOST_DEST is not a mount point" >&2; echo failed; return 1; fi
  {
    cp -- "$f" "$OFFHOST_DEST/.$b.partial" && cp -- "$f.sha256" "$OFFHOST_DEST/.$b.sha256.partial" \
      && mv "$OFFHOST_DEST/.$b.partial" "$OFFHOST_DEST/$b" && mv "$OFFHOST_DEST/.$b.sha256.partial" "$OFFHOST_DEST/$b.sha256" \
      && chmod 600 "$OFFHOST_DEST/$b" "$OFFHOST_DEST/$b.sha256" \
      && (cd "$OFFHOST_DEST" && sha256sum -c "$b.sha256" > /dev/null) \
      && pg_restore --list "$OFFHOST_DEST/$b" > /dev/null
  } || { log "off-host copy of $b failed verification" >&2; rm -f "$OFFHOST_DEST/.$b.partial" "$OFFHOST_DEST/.$b.sha256.partial"; echo failed; return 1; }
  # Retention at the destination: newest N dumps (by name, which carries the timestamp), sidecars follow their dump.
  ls -1 "$OFFHOST_DEST"/*.dump 2> /dev/null | sort -r | tail -n +$((OFFHOST_KEEP + 1)) | while read -r old; do rm -f "$old" "$old.sha256"; done
  echo ok
}

backup_flow() {
  run_backup || fail backup $?
  local offhost sha bytes
  offhost=$(offhost_push "$NEW_DUMP"); local orc=$?
  sha=$(cut -d' ' -f1 "$NEW_DUMP.sha256") && bytes=$(stat -c %s "$NEW_DUMP") && [[ -n "$sha" && -n "$bytes" ]] || fail evidence 1
  write_state "$STATE/last-backup.json" "$(printf '{"epoch":%s,"ts":"%s","file":"%s","sha256":"%s","bytes":%s,"offhost":"%s"}' \
    "$(date +%s)" "$(date -u +%FT%TZ)" "$(basename "$NEW_DUMP")" "$sha" "$bytes" "$offhost")" || fail state-write 1
  [[ $orc -eq 0 ]] || fail offhost "$orc"
  log "backup ok: $(basename "$NEW_DUMP") ${bytes} bytes sha256 ${sha:0:16} offhost=$offhost"
}

case "$MODE" in
  backup)
    backup_flow
    clear_markers FAILED-backup
    ;;
  verify)
    backup_flow
    attempt=1
    while :; do
      if bash "$TOOLS/restore-test.sh" "$NEW_DUMP" 2>&1 | scrub; [[ ${PIPESTATUS[0]} -eq 0 ]]; then break; fi
      if [[ $attempt -ge 2 ]]; then fail restore-test 1; fi
      attempt=$((attempt + 1)); log "restore verification failed; one retry in ${RETRY_SECONDS}s (a live write between dump and comparison is the benign cause)"
      sleep "$RETRY_SECONDS"
    done
    write_state "$STATE/last-verify.json" "$(printf '{"epoch":%s,"ts":"%s","file":"%s","sha256":"%s","attempts":%s}' \
      "$(date +%s)" "$(date -u +%FT%TZ)" "$(basename "$NEW_DUMP")" "$(cut -d' ' -f1 "$NEW_DUMP.sha256")" "$attempt")" || fail verify-state-write 1
    clear_markers FAILED-backup FAILED-verify
    log "verify ok: $(basename "$NEW_DUMP") restored and proven (attempt $attempt)"
    ;;
esac
