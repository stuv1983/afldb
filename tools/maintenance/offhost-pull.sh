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
# none while a retention hold is in force). Every new dump is proven against its sha256
# sidecar and read with pg_restore --list; a dump that fails either is moved to <dest-dir>/quarantine, never kept
# as a good copy, and the run exits 1. A dump whose sidecar has not arrived yet is left for the next run.
#
# r10: a "RECEIVED <dump> sha256=<h> bytes=<b> size=<s>" line is printed only for a dump THIS run transferred in full and then
# verified (see "Receipt" below); a copy that was already present is never reported as received. The same record goes to fd 3
# when the caller opened it; callers parse fd 3 only (stdout also carries source-side text).
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

# Receipt (R6 r10, Astra case 1): what THIS run received, as opposed to what the directory already held. rsync itemises every
# file it transfers (--out-format, one line per transfer: flags, file size, bytes rsync moved for it, name); --ignore-existing
# skips, silently, every file already present, so a dump placed here before the run is never itemised. A dump counts as
# RECEIVED by this run only when (1) rsync itemised it as a file created here (">f+++++++++"), (2) rsync moved at least the
# file's size for it (a resume from an earlier partial copy moves less and is not a receipt), and (3) this run then verified
# it below. Only then does this script print "RECEIVED <dump> sha256=<hash> bytes=<moved> size=<size>". A dump verified for
# the first time without being received (it was already here) prints the ordinary "verified" line and no RECEIVED line.
# Retention, the retry of a dump whose sidecar arrives later and quarantine are unchanged; the receipt is evidence only.
# r10 round 2 (independent review F5, F6): (4) the dump was ABSENT here before rsync started, both as a file and as a partial
# under .rsync-partial (a resumed transfer is not a receipt), and --whole-file sends every byte (no delta against any basis);
# (5) the machine-readable receipt goes to file descriptor 3 when the caller opened it ("RECEIVED <dump> sha256=<h> bytes=<b>
# size=<s>", one per line), and rsync and ssh run with fd 3 closed, so text the SOURCE side prints (ssh stderr, rsync messages)
# can reach stdout/stderr but never fd 3. The stdout line stays for the log; callers must parse fd 3, never stdout.
declare -A PRE=()
for f in "$DEST"/*.dump "$DEST"/.rsync-partial/*.dump; do [[ -e "$f" ]] && PRE[$(basename -- "$f")]=1; done
items=$(rsync -a --whole-file --partial --partial-dir=.rsync-partial --ignore-existing --chmod=F600 --out-format='%i %l %b %n' \
  --include='*.dump' --include='*.dump.sha256' --exclude='*' "$SRC" "$DEST/" 3>&-); rrc=$?
declare -A RECV=()
while read -r iflags isize ibytes iname; do
  [[ -n "${iname:-}" && "$iflags" == '>'* ]] || continue   # files received; not directory attribute lines
  log "transferred $iname item=$iflags size=$isize bytes=$ibytes"
  if [[ "$iflags" == '>f+++++++++' && "$iname" == *.dump && "$iname" != */* && "$isize" =~ ^[1-9][0-9]*$ && "$ibytes" =~ ^[0-9]+$ ]] \
     && (( ibytes >= isize )); then
    if [[ -n "${PRE[$iname]:-}" ]]; then log "not a receipt: $iname (or a partial of it) was here before this run"
    else RECV[$iname]="$ibytes $isize"; fi
  fi
done <<< "$items"
[[ $rrc -eq 0 ]] || { log "rsync failed (exit $rrc); no receipt is issued for any file of this run"; exit 1; }

mkdir -p "$DEST/quarantine"
bad=0 checked=0 pending=0
# Dump names carry the SOURCE host's local wall-clock time (backup.sh: STAMP="$(date +%Y%m%d-%H%M%S)", production runs in
# Australia/Melbourne), not UTC. They are read in that zone (AFLDB-ISSUE-352, found at the first A2 pull on 2026-11-22:
# reading them as UTC put every dump about 11 h in the future and quarantined it). AFLDB_OFFHOST_TEST_NOW is a test-only
# clock override (epoch seconds); the daily wrapper never sets it.
STAMP_TZ="${AFLDB_OFFHOST_STAMP_TZ:-Australia/Melbourne}"
now="${AFLDB_OFFHOST_TEST_NOW:-$(date -u +%s)}"
[[ "$now" =~ ^[0-9]+$ ]] || { echo "offhost-pull: AFLDB_OFFHOST_TEST_NOW must be epoch seconds" >&2; exit 2; }
# stamp_to_epoch "YYYYMMDD HH:MM:SS": print the EARLIEST UTC instant at which that was the wall-clock time in $STAMP_TZ.
# A repeated local hour (daylight saving ends) has two valid instants: the earliest is used, so a genuine dump from either
# pass is never rejected as future-dated (the only slack this gives is the one repeated hour). A local time that never
# existed (daylight saving starts) and an unparseable stamp both fail.
stamp_to_epoch() {
  local s="$1" naive o z sign hh mm off e back best=""
  naive=$(date -u -d "$s" +%s 2> /dev/null) || return 1
  for o in -86400 0 86400; do
    z=$(TZ="$STAMP_TZ" date -d "@$((naive + o))" +%z 2> /dev/null) || return 1
    [[ "$z" =~ ^([+-])([0-9]{2})([0-9]{2})$ ]] || return 1
    sign="${BASH_REMATCH[1]}"; hh="${BASH_REMATCH[2]}"; mm="${BASH_REMATCH[3]}"
    off=$(( 10#$hh * 3600 + 10#$mm * 60 )); [[ "$sign" == - ]] && off=$((-off))
    e=$((naive - off))
    back=$(TZ="$STAMP_TZ" date -d "@$e" '+%Y%m%d %H:%M:%S' 2> /dev/null) || continue
    if [[ "$back" == "$s" ]] && { [[ -z "$best" ]] || (( e < best )); }; then best="$e"; fi
  done
  [[ -n "$best" ]] || return 1
  printf '%s\n' "$best"
}
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
  # this machine's clock (one hour of skew allowed). The stamp is the source's local time ($STAMP_TZ), see above.
  stamp=$(printf '%s' "$b" | sed -n 's/^[A-Za-z0-9_]*-\([0-9]\{8\}\)-\([0-9]\{2\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)\.dump$/\1 \2:\3:\4/p')
  if [[ -z "$stamp" ]]; then quarantine "$b" "unexpected name"; continue; fi
  stamp_epoch=$(stamp_to_epoch "$stamp") || { quarantine "$b" "unparseable stamp or not a $STAMP_TZ local time"; continue; }
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
    if [[ -n "${RECV[$b]:-}" ]]; then
      read -r rb rs <<< "${RECV[$b]}"; log "RECEIVED $b sha256=$actual bytes=$rb size=$rs"
      { printf 'RECEIVED %s sha256=%s bytes=%s size=%s\n' "$b" "$actual" "$rb" "$rs" >&3; } 2> /dev/null || true
    fi
  else
    quarantine "$b" "hash or archive check"
  fi
done

# Retention (review A-03): only VERIFIED dumps count and only they are pruned, ordered by when THIS machine verified
# them (the marker's mtime, this machine's clock), never by the source-chosen name. A run that verifies more new dumps
# than a healthy source produces (one a day; AFLDB_OFFHOST_MAX_NEW, default 3) prunes nothing and fails, so a flood of
# valid-looking dumps from a compromised source cannot evict the genuine copies in one pull. Residual: a source that
# adds one dump a day for KEEP days is indistinguishable from normal operation; the off-host alert covers that.
#
# The alert is DURABLE (AFLDB-ISSUE-352 closeout): the flood's markers are written before the count is known, so a
# skip that lasted one run let the next, unchanged pull count zero new dumps and prune the very copies the alert had
# protected. The alert therefore writes <dest-dir>/.retention-hold, and while that file exists every run deletes
# nothing and exits 1. Only an operator ends it, after deciding what the batch listed in the file is (quarantine the
# unwanted dumps by hand, then `rm <dest-dir>/.retention-hold`); the next run then applies normal retention.
MAX_NEW="${AFLDB_OFFHOST_MAX_NEW:-3}"
HOLD="$DEST/.retention-hold"
if (( prior > 0 && checked > MAX_NEW )); then  # the first (seeding) pull may verify many
  { printf 'retention hold set %s: %s new dumps verified in one run (limit %s)\n' "$(date -u +%FT%TZ)" "$checked" "$MAX_NEW"
    printf 'remove this file only after deciding what the batch below is; until then no copy is deleted\n'
    find "$DEST" -maxdepth 1 -name '.verified-*.dump' -newermt "@$now" -printf '%f\n' | sed 's/^\.verified-//' | sort
  } >> "$HOLD" || log "ALERT: could not write $HOLD; a later run could prune"
  log "ALERT: $checked new dumps verified in one run (limit $MAX_NEW); retention hold set, nothing deleted"
  bad=$((bad + 1))
elif [[ -e "$HOLD" ]]; then
  log "ALERT: retention hold in force ($HOLD); nothing deleted until an operator reviews and removes it"
  bad=$((bad + 1))
else
  ls -1t "$DEST"/.verified-*.dump 2> /dev/null | tail -n +$((KEEP + 1)) | while read -r marker; do
    b="$(basename "$marker")"; b="${b#.verified-}"
    rm -f "$DEST/$b" "$DEST/$b.sha256" "$marker"; log "retention: removed $b"
  done
fi

log "done: ${checked} newly verified, ${pending} pending, ${bad} failed; $(ls -1 "$DEST"/*.dump 2> /dev/null | wc -l) dump(s) held"
[[ $bad -eq 0 ]]
