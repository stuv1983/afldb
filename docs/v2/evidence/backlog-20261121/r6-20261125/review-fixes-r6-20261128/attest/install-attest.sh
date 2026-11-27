#!/usr/bin/bash
# install-attest.sh: R6 r6 (28 Nov 2026), PROSPECTIVE owner procedure (DESIGN.md section 6). PREPARED, NOT RUN on production.
# Installs the backup-origin attestation: the root writer /usr/local/libexec/afldb/afldb-backup-attest (root:root 0755), the drop-in
# /etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf (root:root 0644) and the record directory
# /var/lib/afldb-backup-attest (root:root 0755); then `systemctl daemon-reload` and verify-attest-install.sh as root and as arm.
# Run as ROOT from a ROOT-OWNED STAGING DIRECTORY that holds the reviewed bundle (afldb-backup-attest, 60-afldb-backup-attest.conf,
# install-attest.sh, verify-attest-install.sh, SHA256SUMS), never from the checkout or anywhere under /home:
#   sudo install -d -o root -g root -m 0755 /opt/afldb-attest-r6 && sudo install -o root -g root -m 0644 <bundle files> /opt/afldb-attest-r6/
#   sha256sum /opt/afldb-attest-r6/SHA256SUMS      # compare with the reviewed digest BEFORE running anything from it
#   sudo bash /opt/afldb-attest-r6/install-attest.sh /opt/afldb-attest-r6 [--check]
# --check: read-only (the staging and unit checks, then the verify script as root and as arm); installs nothing.
# It refuses (INSTALL STOP, exit 2, nothing changed) unless: it runs as root; the staging directory and every component of its path
# are root-owned, not group/other-writable and not symlinks, and it is not under /home; the bundle files are root-owned regular files
# with one link, match SHA256SUMS exactly (and SHA256SUMS lists exactly those four), and the writer and drop-in match the digests
# pinned here (the same as in both gates); afldb-backup.service is loaded from a trusted root-owned FragmentPath (not under /home)
# with no EnvironmentFile=. It writes nothing but the three paths above (never the production checkout /home/arm/projects/afldb),
# and restarts, starts or stops nothing.
cd / || exit 2
export LC_ALL=C PATH=/usr/sbin:/usr/bin
umask 022
set -u -o pipefail
WS=799e6691954e4d7562cbc6b7af82f307cde0c8af71e450cd5f66f2af9994b398
DS=2a3a067ef408377ccf6deae7c97c38366854c581a16e3f33ce2265787abc440e
W=/usr/local/libexec/afldb/afldb-backup-attest
D=/etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf
RD=/var/lib/afldb-backup-attest
BUNDLE=(afldb-backup-attest 60-afldb-backup-attest.conf install-attest.sh verify-attest-install.sh)
stop() { echo "INSTALL STOP $*"; exit 2; }
STAGE=${1:-}; MODE=${2:-install}
[ "$#" -le 2 ] && [ -n "$STAGE" ] && { [ "$MODE" = install ] || [ "$MODE" = --check ]; } || stop "usage: install-attest.sh <root-owned staging dir> [--check]"
[ "$(id -u)" = 0 ] || stop "run as root"

# trusted <path> <dir|file>: no symlink from / to the leaf, every component uid 0 and not group/other-writable, the leaf of that type
# (a file: one link). Sets TW.
trusted() {
  local p=$1 want=$2 r c= i=0 u a n t out; local -a cs=(/)
  TW=
  [[ $p =~ ^(/[A-Za-z0-9_@.][A-Za-z0-9_@.-]{0,254}){1,32}$ && /$p/ != */./* && /$p/ != */../* ]] || { TW="'$p' is not a plain absolute path"; return 1; }
  r=${p#/}; while [ -n "$r" ]; do c=$c/${r%%/*}; cs+=("$c"); if [[ $r == */* ]]; then r=${r#*/}; else r=; fi; done
  out=$(stat -c '%u %a %h %F' -- "${cs[@]}" 2>/dev/null) || { TW="$p: missing or unreadable"; return 1; }
  while read -r u a n t; do
    c=${cs[i]}; i=$((i + 1))
    [ "$t" != "symbolic link" ] || { TW="$c is a symbolic link"; return 1; }
    [ "$u" = 0 ] || { TW="$c is owned by uid $u"; return 1; }
    if (( 8#$a & 8#022 )); then TW="$c has mode $a (group/other-writable)"; return 1; fi
    if [ "$i" -lt "${#cs[@]}" ] || [ "$want" = dir ]; then [ "$t" = directory ] || { TW="$c is a $t, not a directory"; return 1; }
    else [ "$t" = "regular file" ] && [ "$n" = 1 ] || { TW="$c is a $t with $n links, not a regular file with one"; return 1; }; fi
  done <<< "$out"
  [ "$i" = "${#cs[@]}" ] || { TW="$p: stat output incomplete"; return 1; }
}

echo "== install-attest.sh $MODE $(date -u +%FT%TZ) host=$(hostname) staging=$STAGE"
case $STAGE/ in /home/*) stop "the staging directory is under /home (arm-reachable); use a root-owned directory such as /opt/afldb-attest-r6";; esac
trusted "$STAGE" dir || stop "staging directory: $TW"
for f in "${BUNDLE[@]}" SHA256SUMS; do trusted "$STAGE/$f" file || stop "bundle file: $TW"; done
mapfile -t L < "$STAGE/SHA256SUMS"
names=$(for l in "${L[@]}"; do printf '%s\n' "${l#*  }"; done | sort | tr '\n' ' ')
[ "${#L[@]}" = 4 ] && [ "$names" = "$(printf '%s\n' "${BUNDLE[@]}" | sort | tr '\n' ' ')" ] || stop "SHA256SUMS must list exactly: ${BUNDLE[*]}"
(cd "$STAGE" && sha256sum --strict --quiet -c SHA256SUMS) || stop "the bundle does not match SHA256SUMS"
h=$(sha256sum < "$STAGE/afldb-backup-attest"); [ "${h%% *}" = "$WS" ] || stop "the staged writer is not the pinned $WS"
h=$(sha256sum < "$STAGE/60-afldb-backup-attest.conf"); [ "${h%% *}" = "$DS" ] || stop "the staged drop-in is not the pinned $DS"
echo "PASS bundle: 4 files match SHA256SUMS (sha256 $(sha256sum < "$STAGE/SHA256SUMS" | cut -c1-64)); writer $WS, drop-in $DS"

unit_check() { # the loaded unit: trusted fragment, no EnvironmentFile=
  local s l ls= frag= ef=0
  s=$(systemctl show afldb-backup.service -p LoadState -p FragmentPath -p EnvironmentFiles) || stop "systemctl show afldb-backup.service failed"
  while IFS= read -r l; do case $l in LoadState=*) ls=${l#*=};; FragmentPath=*) frag=${l#*=};; EnvironmentFiles=?*) ef=$((ef + 1));; esac; done <<< "$s"
  [ "$ls" = loaded ] || stop "afldb-backup.service is not loaded (LoadState=$ls): install the backup units first (docs/backup-restore.md section 3)"
  case $frag/ in /home/*) stop "afldb-backup.service is loaded from $frag, under /home";; esac
  trusted "$frag" file || stop "afldb-backup.service FragmentPath: $TW"
  [ "$ef" = 0 ] || stop "afldb-backup.service has an EnvironmentFile=: its environment is not root-controlled"
  echo "PASS afldb-backup.service ($1): loaded from trusted $frag, no EnvironmentFile="
}
unit_check "before"

verify_both() {
  local rc=0
  echo "-- verify-attest-install.sh as root"; bash --noprofile --norc "$STAGE/verify-attest-install.sh" arm || rc=1
  echo "-- verify-attest-install.sh as arm"
  setpriv --reuid=arm --regid=arm --init-groups env -i PATH=/usr/sbin:/usr/bin HOME=/ /usr/bin/bash --noprofile --norc "$STAGE/verify-attest-install.sh" arm || rc=1
  return $rc
}
if [ "$MODE" = --check ]; then
  verify_both && { echo "INSTALL CHECK RESULT PASS (nothing changed)"; exit 0; } || { echo "INSTALL CHECK RESULT FAIL (nothing changed)"; exit 1; }
fi

[ -e /usr/local/libexec ] || install -d -o root -g root -m 0755 /usr/local/libexec || stop "cannot create /usr/local/libexec"
for d in /usr/local/libexec /etc/systemd/system; do trusted "$d" dir || stop "parent directory: $TW"; done
install -d -o root -g root -m 0755 /usr/local/libexec/afldb "$RD" /etc/systemd/system/afldb-backup.service.d || stop "install -d failed"
install -o root -g root -m 0755 "$STAGE/afldb-backup-attest" "$W" || stop "cannot install the writer"
install -o root -g root -m 0644 "$STAGE/60-afldb-backup-attest.conf" "$D" || stop "cannot install the drop-in"
systemctl daemon-reload || stop "systemctl daemon-reload failed (the files are installed; run it again, then --check)"
echo "PASS installed $W, $D, $RD; daemon-reload done"
unit_check "after daemon-reload"
verify_both && { echo "INSTALL RESULT PASS: the next successful run of afldb-backup.service writes $RD/<invocation>.attest"; exit 0; } \
  || { echo "INSTALL RESULT FAIL: installed, but the verification failed (see above)"; exit 1; }
