#!/usr/bin/env bash
#
# AFLDB-ISSUE-352: the off-host copy, as a PULL run on the OTHER machine.
#
#   offhost-pull.sh <source> <dest-dir> [--keep N]
#
#   <source>    rsync source holding scheduled-backup.sh's output: /path/dir/ or user@host:/path/dir/
#   <dest-dir>  local directory on this (off-host) machine; must already exist
#
# Why a pull: the production host never holds a credential that can delete or alter these copies, so a compromised or
# destroyed production host cannot take its own backups with it. Copies are only ever ADDED (--ignore-existing); the one
# deletion is this script's own retention (newest N dumps, default 30). Every new dump is proven against its sha256
# sidecar and read with pg_restore --list; a dump that fails either is moved to <dest-dir>/quarantine, never kept
# as a good copy, and the run exits 1. A dump whose sidecar has not arrived yet is left for the next run.
#
# This copies and verifies bytes. It does NOT prove a restore: that is scheduled-backup.sh verify, on the source host.
# Dumps contain authentication data and audit history: the destination directory is mode 700, files 600; treat the machine
# as holding production secrets.
#
set -uo pipefail

SRC="${1:-}"; DEST="${2:-}"; KEEP=30
[[ "${3:-}" == --keep ]] && KEEP="${4:-}"
if [[ -z "$SRC" || -z "$DEST" ]] || ! [[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 1 ]]; then
  echo "usage: offhost-pull.sh <source> <dest-dir> [--keep N]" >&2; exit 2
fi
[[ "$DEST" == /* ]] || { echo "offhost-pull: <dest-dir> must be an absolute path" >&2; exit 2; }
[[ -d "$DEST" ]] || { echo "offhost-pull: $DEST is not an existing directory (a missing mount must fail, not be created)" >&2; exit 1; }
SRC="${SRC%/}/"
log() { printf '%s offhost-pull: %s\n' "$(date -u +%FT%TZ)" "$*"; }
log "pull $SRC -> $DEST keep=$KEEP"
chmod 700 "$DEST"

rsync -a --partial --partial-dir=.rsync-partial --ignore-existing --chmod=F600 \
  --include='*.dump' --include='*.dump.sha256' --exclude='*' "$SRC" "$DEST/" || { log "rsync failed"; exit 1; }

mkdir -p "$DEST/quarantine"
bad=0 checked=0 pending=0
for dump in "$DEST"/*.dump; do
  [[ -e "$dump" ]] || continue
  b="$(basename "$dump")"
  if [[ -e "$DEST/.verified-$b" ]]; then continue; fi
  if [[ ! -f "$DEST/$b.sha256" ]]; then pending=$((pending + 1)); log "pending (no sidecar yet): $b"; continue; fi
  if (cd "$DEST" && sha256sum -c "$b.sha256" > /dev/null 2>&1) && pg_restore --list "$dump" > /dev/null 2>&1; then
    : > "$DEST/.verified-$b"; checked=$((checked + 1)); log "verified $b"
  else
    bad=$((bad + 1)); log "FAILED verification, quarantined: $b"
    mv -- "$dump" "$DEST/quarantine/$b"; mv -- "$DEST/$b.sha256" "$DEST/quarantine/$b.sha256" 2> /dev/null || true
  fi
done

# Retention: newest N dumps by name (the name carries the timestamp); markers and sidecars follow their dump.
ls -1 "$DEST"/*.dump 2> /dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  b="$(basename "$old")"; rm -f "$old" "$old.sha256" "$DEST/.verified-$b"; log "retention: removed $b"
done

log "done: ${checked} newly verified, ${pending} pending, ${bad} failed; $(ls -1 "$DEST"/*.dump 2> /dev/null | wc -l) dump(s) held"
[[ $bad -eq 0 ]]
