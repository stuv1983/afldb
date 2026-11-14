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
# deletion is this script's own retention (the N most recently verified dumps by this machine's clock, default 30, and
# none in a run that verified an implausible number of new dumps). Every new dump is proven against its sha256
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
now=$(date -u +%s)
prior=$(ls -1 "$DEST"/.verified-*.dump 2> /dev/null | wc -l)
quarantine() { # basename reason
  bad=$((bad + 1)); log "FAILED verification ($2), quarantined: $1"
  mv -- "$DEST/$1" "$DEST/quarantine/$1"; mv -- "$DEST/$1.sha256" "$DEST/quarantine/$1.sha256" 2> /dev/null || true
}
for dump in "$DEST"/*.dump; do
  [[ -e "$dump" ]] || continue
  b="$(basename "$dump")"
  if [[ -e "$DEST/.verified-$b" ]]; then continue; fi
  if [[ ! -f "$DEST/$b.sha256" ]]; then pending=$((pending + 1)); log "pending (no sidecar yet): $b"; continue; fi
  # Names are chosen by the source (review A-03): only <db>-YYYYMMDD-HHMMSS.dump, and never stamped in the future by
  # this machine's clock (one hour of skew allowed).
  stamp=$(printf '%s' "$b" | sed -n 's/^[A-Za-z0-9_]*-\([0-9]\{8\}\)-\([0-9]\{2\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)\.dump$/\1 \2:\3:\4/p')
  if [[ -z "$stamp" ]]; then quarantine "$b" "unexpected name"; continue; fi
  stamp_epoch=$(date -u -d "$stamp" +%s 2> /dev/null) || { quarantine "$b" "unparseable stamp"; continue; }
  if (( stamp_epoch > now + 3600 )); then quarantine "$b" "stamped in the future"; continue; fi
  # The sidecar must be exactly one line naming THIS dump, and the dump's own hash must equal it: sha256sum -c alone
  # checks whatever file the source-supplied sidecar names.
  expected=$(awk 'NR == 1 { print $1 }' "$DEST/$b.sha256")
  named=$(awk 'NR == 1 { sub(/^\*/, "", $2); print $2 }' "$DEST/$b.sha256")
  if [[ "$(wc -l < "$DEST/$b.sha256")" -ne 1 || "$named" != "$b" || ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
    quarantine "$b" "sidecar does not name this dump"; continue
  fi
  actual=$(sha256sum < "$dump" | cut -d' ' -f1)
  if [[ "$actual" == "$expected" ]] && pg_restore --list "$dump" > /dev/null 2>&1; then
    : > "$DEST/.verified-$b"; checked=$((checked + 1)); log "verified $b"
  else
    quarantine "$b" "hash or archive check"
  fi
done

# Retention (review A-03): only VERIFIED dumps count and only they are pruned, ordered by when THIS machine verified
# them (the marker's mtime, this machine's clock), never by the source-chosen name. A run that verifies more new dumps
# than a healthy source produces (one a day; AFLDB_OFFHOST_MAX_NEW, default 3) prunes nothing and fails, so a flood of
# valid-looking dumps from a compromised source cannot evict the genuine copies in one pull. Residual: a source that
# adds one dump a day for KEEP days is indistinguishable from normal operation; the off-host alert covers that.
MAX_NEW="${AFLDB_OFFHOST_MAX_NEW:-3}"
if (( prior > 0 && checked > MAX_NEW )); then  # the first (seeding) pull may verify many
  log "ALERT: $checked new dumps verified in one run (limit $MAX_NEW); retention skipped, nothing deleted"
  bad=$((bad + 1))
else
  ls -1t "$DEST"/.verified-*.dump 2> /dev/null | tail -n +$((KEEP + 1)) | while read -r marker; do
    b="$(basename "$marker")"; b="${b#.verified-}"
    rm -f "$DEST/$b" "$DEST/$b.sha256" "$marker"; log "retention: removed $b"
  done
fi

log "done: ${checked} newly verified, ${pending} pending, ${bad} failed; $(ls -1 "$DEST"/*.dump 2> /dev/null | wc -l) dump(s) held"
[[ $bad -eq 0 ]]
