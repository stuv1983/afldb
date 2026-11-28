#!/usr/bin/bash
# install-backup.sh: R6 r7 (28 Nov 2026) owner installation of the sealed nightly backup (DESIGN.md sections 2 and 3). PREPARED,
# NOT RUN ON PRODUCTION. Run by the OWNER, as root reached by a path that does NOT pass through arm's login (the console, or a
# separate administrative account with its own key; not sudo in an arm SSH session: R7 independent review round 1, F1; README 5):
#   bash <staging>/install-backup.sh <staging>
# <staging> is a root-owned directory (not under /home, no group/other write anywhere on its path) holding exactly the reviewed
# bundle: SHA256SUMS, afldb-backup-run, afldb-backup-seal, 70-afldb-backup-sealed.conf, sealed-origin.sh, install-backup.sh,
# verify-backup-install.sh and backup.sh (= the repository's tools/maintenance/backup.sh, byte-identical).
# It: verifies the bundle; checks the loaded afldb-backup.service is a root-owned unit with no r6 attest drop-in and no live job;
# creates the group afldb-backup-read, the system user afldb-backup (group afldb-backup, /usr/sbin/nologin, home /nonexistent, no
# supplementary group) and adds arm to afldb-backup-read; creates /usr/local/lib/afldb-backup (+ tools/maintenance) and
# /var/lib/afldb-backup/{seals,published,state,staging} with the owners and modes of DESIGN 2; installs the code and the drop-in;
# runs `systemctl daemon-reload`; then checks the result with the installed sealed-origin.sh (sealed_origin_install).
# It does NOT: edit pg_hba.conf or pg_ident.conf (it prints the exact lines; the owner adds them and reloads PostgreSQL), restart
# or start the timer or the service, write anything under /home (the production checkout stays clean), or remove anything.
# Rollback: README.md section "Rollback".
set -u -o pipefail
export LC_ALL=C PATH=/usr/sbin:/usr/bin
umask 022
cd / || exit 90
die() { printf 'INSTALL REFUSED: %s\n' "$1"; printf 'BACKUP INSTALL RESULT FAIL\n'; exit 1; }
say() { printf '%s\n' "$*"; }
STG=${1:-}
FILES=(afldb-backup-run afldb-backup-seal 70-afldb-backup-sealed.conf sealed-origin.sh install-backup.sh verify-backup-install.sh backup.sh)
CODE=/usr/local/lib/afldb-backup; DR=/var/lib/afldb-backup; DID=/etc/systemd/system/afldb-backup.service.d
DI=$DID/70-afldb-backup-sealed.conf; R6DI=$DID/60-afldb-backup-attest.conf

[ "$(id -u)" = 0 ] || die "run as root (uid $(id -u))"
[ -n "$STG" ] && [[ $STG =~ ^(/[A-Za-z0-9_.@-]+)+$ ]] || die "usage: install-backup.sh <absolute root-owned staging directory>"
case "$STG/" in /home/*) die "the staging directory must not be under /home";; */./*|*/../*) die "the staging path must be plain (no . or ..)";; esac
# Trusted staging: no symbolic link, every component root-owned and not group/other-writable, and every bundle file too.
p=; r=${STG#/}; comps=(/)
while [ -n "$r" ]; do p=$p/${r%%/*}; comps+=("$p"); [[ $r == */* ]] && r=${r#*/} || r=; done
for c in "${comps[@]}"; do
  s=$(stat -c '%u %a %F' -- "$c") || die "cannot stat $c"
  read -r u a t <<< "$s"
  [ "$t" = directory ] && [ "$u" = 0 ] && ! (( 8#$a & 8#022 )) || die "$c is '$s': every component of the staging path must be a root-owned directory without group/other write"
done
for f in SHA256SUMS "${FILES[@]}"; do
  s=$(stat -c '%u %a %h %F' -- "$STG/$f" 2>/dev/null) || die "$STG/$f is missing"
  read -r u a n t <<< "$s"
  [ "$t" = "regular file" ] && [ "$u" = 0 ] && [ "$n" = 1 ] && ! (( 8#$a & 8#022 )) || die "$STG/$f is '$s': need a root-owned regular file, one link, no group/other write"
done
x=$(ls -A "$STG" | sort | tr '\n' ' '); y=$(printf '%s\n' SHA256SUMS "${FILES[@]}" | sort | tr '\n' ' ')
[ "$x" = "$y" ] || die "$STG holds '$x', not exactly the bundle '$y'"
# The bundle: SHA256SUMS lists exactly the seven files and every one matches.
[ "$(awk '{print $2}' "$STG/SHA256SUMS" | sort | tr '\n' ' ')" = "$(printf '%s\n' "${FILES[@]}" | sort | tr '\n' ' ')" ] \
  || die "SHA256SUMS does not list exactly the bundle's seven files"
(cd "$STG" && sha256sum --strict --quiet -c SHA256SUMS) || die "the bundle does not match SHA256SUMS"
SUMS=$(sha256sum < "$STG/SHA256SUMS" | cut -c1-64)
say "bundle $STG verified: SHA256SUMS $SUMS (compare with README.md before going on; the install continues only on a match you have checked)"

# The library pins must equal the bundle's files (a library/bundle mismatch is caught before anything is installed).
for f in afldb-backup-run afldb-backup-seal 70-afldb-backup-sealed.conf backup.sh; do
  h=$(sha256sum < "$STG/$f" | cut -c1-64)
  grep -q "=$h" "$STG/sealed-origin.sh" || die "sealed-origin.sh does not pin $f ($h)"
done

# Prerequisites on this host.
for b in /usr/bin/env /usr/bin/bash /usr/bin/systemctl /usr/bin/busctl /usr/bin/sha256sum /usr/bin/stat /usr/bin/date /usr/bin/timeout \
    /usr/bin/cp /usr/bin/mv /usr/bin/chown /usr/bin/chmod /usr/bin/rm /usr/bin/id /usr/bin/find /usr/bin/sed /usr/bin/head \
    /usr/sbin/nologin /usr/share/zoneinfo/Australia/Melbourne; do
  [ -f "$b" ] && [ ! -L "$b" ] || die "$b is missing or a symbolic link (needed by the run, the sealer or the gate rule)"
done
command -v pg_dump > /dev/null && command -v pg_restore > /dev/null || die "pg_dump / pg_restore not found"
[ "$(systemctl show afldb-backup.service -p LoadState --value)" = loaded ] || die "afldb-backup.service is not loaded (install the base unit first)"
frag=$(systemctl show afldb-backup.service -p FragmentPath --value)
[ -n "$frag" ] && [ -f "$frag" ] && [ ! -L "$frag" ] && [ "$(stat -c %u -- "$frag")" = 0 ] || die "afldb-backup.service FragmentPath '$frag' is not a root-owned regular file (a symlink into the checkout must be replaced by a copy first)"
[ ! -e "$R6DI" ] || die "$R6DI (the r6 attest writer) is installed: remove it and daemon-reload first; r7 replaces it"
[ -z "$(systemctl show afldb-backup.service -p Job --value)" ] && [[ $(systemctl show afldb-backup.service -p ActiveState --value) =~ ^(inactive|failed)$ ]] \
  || die "afldb-backup.service is running or has a queued job: install outside 02:15-02:50 and when it is idle"
id arm > /dev/null 2>&1 || die "no user arm"

# Accounts (DESIGN 2).
getent group afldb-backup-read > /dev/null || groupadd --system afldb-backup-read || die "groupadd afldb-backup-read failed"
if ! getent passwd afldb-backup > /dev/null; then
  useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin afldb-backup || die "useradd afldb-backup failed"
fi
IFS=: read -r _ _ _ _ _ home shell <<< "$(getent passwd afldb-backup)"
[ "$home:$shell" = /nonexistent:/usr/sbin/nologin ] || die "afldb-backup exists with home '$home' shell '$shell' (need /nonexistent, /usr/sbin/nologin)"
[ "$(id -gn afldb-backup)" = afldb-backup ] && [ "$(id -Gn afldb-backup)" = afldb-backup ] || die "afldb-backup's groups are '$(id -Gn afldb-backup)', need exactly afldb-backup"
[ -z "$(getent group afldb-backup | cut -d: -f4)" ] || die "group afldb-backup has members: $(getent group afldb-backup | cut -d: -f4)"
usermod -a -G afldb-backup-read arm || die "usermod -a -G afldb-backup-read arm failed"
[[ " $(id -Gn arm) " == *" afldb-backup-read "* && " $(id -Gn arm) " != *" afldb-backup "* ]] || die "arm's groups are '$(id -Gn arm)'"
say "accounts: $(id afldb-backup); arm: $(id arm) (a session started before this sees the new group only after a new login)"

# Directories (DESIGN 2). install -d does not change an existing directory's owner or mode, so both are set explicitly.
mkd() { install -d "$1" && chown "$2" "$1" && chmod "$3" "$1" || die "cannot create $1"; }
mkd /usr/local/lib root:root 0755; mkd $CODE root:root 0755; mkd $CODE/tools root:root 0755; mkd $CODE/tools/maintenance root:root 0755
mkd $DR root:root 0755; mkd $DR/seals root:root 0755; mkd $DR/published root:afldb-backup-read 0750; mkd $DR/state root:afldb-backup-read 0750
mkd $DR/staging afldb-backup:afldb-backup 0700; mkd $DID root:root 0755

# Code and drop-in.
install -o root -g root -m 0755 "$STG/afldb-backup-run" $CODE/afldb-backup-run && install -o root -g root -m 0755 "$STG/afldb-backup-seal" $CODE/afldb-backup-seal \
  && install -o root -g root -m 0755 "$STG/backup.sh" $CODE/tools/maintenance/backup.sh && install -o root -g root -m 0644 "$STG/sealed-origin.sh" $CODE/sealed-origin.sh \
  && install -o root -g root -m 0644 "$STG/70-afldb-backup-sealed.conf" "$DI" || die "cannot install the code or the drop-in"
{ for f in afldb-backup-run afldb-backup-seal sealed-origin.sh; do grep "  $f\$" "$STG/SHA256SUMS"; done
  printf '%s  tools/maintenance/backup.sh\n' "$(sha256sum < "$STG/backup.sh" | cut -c1-64)"; } > $CODE/.SHA256SUMS.tmp \
  && chown root:root $CODE/.SHA256SUMS.tmp && chmod 0644 $CODE/.SHA256SUMS.tmp && mv -f -T $CODE/.SHA256SUMS.tmp $CODE/SHA256SUMS || die "cannot write $CODE/SHA256SUMS"
(cd $CODE && sha256sum --strict --quiet -c SHA256SUMS) || die "installed files do not match $CODE/SHA256SUMS"
systemctl daemon-reload || die "systemctl daemon-reload failed"

# Check what PID 1 now has loaded, with the installed gate library (rules 1-3).
# shellcheck source=/dev/null
. $CODE/sealed-origin.sh
if sealed_origin_install; then say "sealed_origin_install: PASS (trusted paths, pinned digests, effective unit)"
else say "sealed_origin_install: FAIL: $SO_REASON"; say "ROLLBACK: rm $DI && systemctl daemon-reload (README.md, Rollback)"; say "BACKUP INSTALL RESULT FAIL"; exit 1; fi

cat <<'EOF'
OWNER STEPS STILL REQUIRED (not done by this script):
 1. PostgreSQL peer authentication for the backup account, then reload (no restart):
      pg_ident.conf, add:   afldbbackup afldb-backup afldb_backup
      pg_hba.conf, add BEFORE any broader 'local' line:
                            local afldb_prod afldb_backup peer map=afldbbackup
      then:                 sudo -u postgres psql -c 'SELECT pg_reload_conf()'
 2. Run verify-backup-install.sh as root, then as arm in a NEW login (both must print BACKUP INSTALL RESULT PASS).
 3. streamanator: change the off-host pull source to <prod>:/var/lib/afldb-backup/published/ (offhost-pull.sh is unchanged).
 4. Status probes: AFLDB_BACKUP_SEALED_STATE_DIR=/var/lib/afldb-backup/state for `scheduled-backup.sh status`.
 5. Leave the timer as it is: the next 02:20 run is the first sealed one (seals/<invocation>.seal + published/<dump>).
EOF
say "BACKUP INSTALL RESULT PASS (installed; owner steps above remain)"
