#!/usr/bin/bash
# r8p-admin.sh (R6 r8, 28 Nov 2026). REHEARSAL ONLY. The ROOT steps of OWNER-PROCEDURE.md that run in the ADMIN ROOT SESSION: the
# workstation sends this file over the admin SSH path (key ~/.ssh/afldb_admin, user afldb-admin) as the stdin of
#   sudo -S -p '' -k /usr/bin/bash --noprofile --norc -s -- <step> <args>
# after one line holding the admin's password (the harness stand-in for the owner typing it in the admin session) [HARNESS].
# Steps: stage | checks | install | phase4 | checks44 | reverify45. Every byte installed comes from the tar the workstation sent over
# the admin path, re-verified here against the digests the WORKSTATION computed (passed as arguments, never read from a file on this
# host). Nothing here reads, executes or copies anything from /home/arm.
# r9: stage also stages the Phase 4 script to /root/afldb-r9-phase4 (OWNER-PROCEDURE 2.1.8); phase4 runs 4.0 entry, 4.1 gpasswd and
# 4.2 verify through it; the outputs the owner saves (3.5, 3.6, 3.11, 3.12 and 4.4, 4.5) are tee'd into /root/afldb-r9-evidence and
# handed to the admin's home, from where the workstation copies them back over the admin path.
main() {
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin; umask 022; cd / || exit 90
STEP=${1:?step}; shift
R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128; R8=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r8-20261128
R9=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128
T=/home/afldb-admin/afldb-r8-stage.tar; X=/root/afldb-r8-extract; OC=/root/afldb-r8-owner-checks; BK=/root/afldb-r8-backup; VF=/root/afldb-r8-verify
P4=/root/afldb-r9-phase4; P4S=/root/afldb-phase4-state; E=/root/afldb-r9-evidence
CHECKS() { env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $OC/afldb-owner-checks.sh "$@" < /dev/null; }
P4C() { env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $P4/afldb-phase4.sh "$@" < /dev/null; }
handover() { # the saved outputs, root-owned in $E, copied for the admin to carry back (0600, its own 0700 directory)
  install -d -o afldb-admin -g afldb-admin -m 0700 /home/afldb-admin/afldb-r9-evidence
  for f in "$E"/*; do install -o afldb-admin -g afldb-admin -m 0600 "$f" /home/afldb-admin/afldb-r9-evidence/; done
  echo "   handed over: $(cd "$E" && sha256sum -- * | awk '{printf "%s %s; ", substr($1, 1, 16), $2}')"; }
echo "== admin root session step $STEP $(date -u +%FT%TZ): $(id)"
echo "   session: loginuid $(cat /proc/self/loginuid); SUDO_USER=${SUDO_USER:-unset}; parent chain: $(p=$PPID; n=0; while [ "$p" -gt 0 ] 2>/dev/null && [ $n -lt 12 ]; do printf '%s:uid=%s ' "$(cat /proc/$p/comm)" "$(awk '/^Uid:/ {print $2}' /proc/$p/status)"; p=$(awk '/^PPid:/ {print $2}' /proc/$p/status); n=$((n+1)); done)"
case $STEP in
stage)
  TAR_SHA=${1:?}; BSUMS=${2:?}; VSUMS=${3:?}; CSUMS=${4:?}; VFP=${5:?}   # all computed on the workstation; $6 = the admin key fingerprint
  [ -f "$T" ] && [ ! -L "$T" ] && [ "$(stat -c %U "$T")" = afldb-admin ] || { echo "R8P STAGE STOP: $T missing, a link or not the admin's"; exit 1; }
  printf '%s  %s\n' "$TAR_SHA" "$T" | sha256sum -c --strict || { echo "R8P STAGE STOP: the tar is not the one the workstation hashed"; exit 1; }
  rm -rf "$X" $OC $BK $VF /opt/afldb-r8-armtest; install -d -m 0700 "$X"
  tar -x --no-same-owner --no-same-permissions -f "$T" -C "$X" || exit 1; chown -R root:root "$X"; chmod -R go-w "$X"
  install -d -m 0755 $OC; install -m 0644 "$X/$R8/owner-checks/afldb-owner-checks.sh" "$X/$R8/owner-checks/SHA256SUMS" $OC/
  [ "$(sha256sum < $OC/SHA256SUMS | cut -c1-64)" = "$CSUMS" ] && (cd $OC && sha256sum -c --strict SHA256SUMS) || { echo "R8P STAGE STOP: owner checks"; exit 1; }
  install -d -m 0755 $BK
  for f in afldb-backup-run afldb-backup-seal 70-afldb-backup-sealed.conf sealed-origin.sh install-backup.sh verify-backup-install.sh SHA256SUMS; do install -m 0644 "$X/$R7/backup/$f" $BK/$f; done
  install -m 0644 "$X/tools/maintenance/backup.sh" $BK/backup.sh
  [ "$(sha256sum < $BK/SHA256SUMS | cut -c1-64)" = "$BSUMS" ] && (cd $BK && sha256sum -c --strict SHA256SUMS) || { echo "R8P STAGE STOP: backup bundle"; exit 1; }
  cp -r "$X/$R7/verify" $VF && install -m 0644 "$X/keys/afldb_verify.pub" $VF/afldb_verify.pub && chown -R root:root $VF && chmod -R go-w $VF && chmod 0755 $VF
  [ "$(sha256sum < $VF/SHA256SUMS | cut -c1-64)" = "$VSUMS" ] && (cd $VF && sha256sum -c --strict --quiet SHA256SUMS) || { echo "R8P STAGE STOP: verifier packet"; exit 1; }
  [ "$(ssh-keygen -lf $VF/afldb_verify.pub | awk '{print $2}')" = "$VFP" ] || { echo "R8P STAGE STOP: the verify public key is not the workstation's"; exit 1; }
  # 2.1.8: the Phase 4 script, staged root-owned and checked against its pin (the workstation's digest of its SHA256SUMS)
  rm -rf $P4 $P4S $E; install -d -m 0755 $P4; install -m 0644 "$X/$R9/phase4/afldb-phase4.sh" "$X/$R9/phase4/SHA256SUMS" $P4/
  [ "$(sha256sum < $P4/SHA256SUMS | cut -c1-64)" = "${7:?phase4 pin}" ] && (cd $P4 && sha256sum -c --strict SHA256SUMS) || { echo "R8P STAGE STOP: Phase 4 script"; exit 1; }
  echo "   phase4 SHA256SUMS $7 (= the workstation value)"
  # a readable copy for arm's own attempt (scenario arm-sudo-*): root-owned, outside /home
  install -d -m 0755 /opt/afldb-r8-armtest /opt/afldb-r8-armtest/backup /opt/afldb-r8-armtest/checks
  cp -p $BK/* /opt/afldb-r8-armtest/backup/; cp -p $OC/* /opt/afldb-r8-armtest/checks/
  echo "   tar $TAR_SHA; owner checks $CSUMS; backup SHA256SUMS $BSUMS; verifier SHA256SUMS $VSUMS; verify key $VFP (each = the workstation value)"
  echo "R8P STAGE OK"
  echo "---- owner checks (Phase 2) BEFORE any install or access change"
  CHECKS --admin afldb-admin --admin-fp "${6:?admin fp}"; echo "R8P CHECKS exit $?";;
checks)
  CHECKS --admin afldb-admin --admin-fp "${1:?fp}"; echo "R8P CHECKS exit $?";;
install)
  FP=${1:?fp}
  echo "---- install-backup.sh (admin root session, staging $BK)"
  bash $BK/install-backup.sh $BK; echo "R8P INSTALL-BACKUP exit $?"
  H=/etc/postgresql/16/main/pg_hba.conf; I=/etc/postgresql/16/main/pg_ident.conf
  { echo 'local afldb_prod afldb_backup peer map=afldbbackup'; cat $H; } > $H.r8p && cat $H.r8p > $H && rm -f $H.r8p
  echo 'afldbbackup afldb-backup afldb_backup' >> $I
  runuser -u postgres -- psql -X -q -At -c 'SELECT pg_reload_conf()' < /dev/null
  install -d -m 0700 $E
  echo "---- 3.5 verify-backup-install.sh as root (tee $E/3.5-verify-backup-install.txt)"
  { echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"; bash $BK/verify-backup-install.sh; } 2>&1 | tee $E/3.5-verify-backup-install.txt; echo "R8P VBI-ROOT exit ${PIPESTATUS[0]}"
  if grep -q -- '--as-arm' $BK/verify-backup-install.sh; then
    echo "---- 3.6 verify-backup-install.sh --as-arm (root drops to arm: setpriv --reset-env, bash --noprofile --norc, stdin /dev/null)"
    { echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"; bash $BK/verify-backup-install.sh --as-arm; } 2>&1 | tee $E/3.6-verify-backup-install-as-arm.txt; echo "R8P VBI-ARM exit ${PIPESTATUS[0]} mode=as-arm"
  else
    echo "---- verify-backup-install.sh as arm through the explicit setpriv form (--as-arm not in this bundle: PENDING)"
    setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc -s < $BK/verify-backup-install.sh; echo "R8P VBI-ARM exit $? mode=setpriv-fallback"
  fi
  echo "---- install-verify.sh --role prod (admin root session, staging $VF)"
  bash $VF/install-verify.sh --role prod --key $VF/afldb_verify.pub; echo "R8P INSTALL-VERIFY exit $?"
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d afldb_prod < $VF/verifier-db.sql; echo "   verifier-db.sql exit $?"
  grep -v '^#' $VF/pg-auth-lines.txt | grep '^afldbverify ' >> $I
  # directly AFTER the afldb_backup line, which verify-backup-install.sh requires to stay the FIRST local line; both stay above
  # every broader local line
  sed -i "/^local afldb_prod afldb_backup peer map=afldbbackup\$/a $(grep '^local ' $VF/pg-auth-lines.txt)" $H
  runuser -u postgres -- psql -X -q -At -c 'SELECT pg_reload_conf()' < /dev/null
  echo "   pg_hba local lines: $(grep '^local' $H | tr -s ' ' | tr '\n' ';')"
  echo "---- 3.11 verify-verify-install.sh --role prod as root (tee $E/3.11-verify-verify-install.txt)"
  { echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"; bash $VF/verify-verify-install.sh --role prod; } 2>&1 | tee $E/3.11-verify-verify-install.txt; echo "R8P VVI exit ${PIPESTATUS[0]}"
  echo "---- 3.12 owner checks after the installs, BEFORE the access change (tee $E/3.12-owner-checks.txt)"
  { echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"; CHECKS --admin afldb-admin --admin-fp "$FP"; } 2>&1 | tee $E/3.12-owner-checks.txt; echo "R8P CHECKS exit ${PIPESTATUS[0]}"
  handover;;
phase4)
  echo "---- Phase 4 (owner approval) through afldb-phase4.sh; the console stays open"
  (cd $P4 && sha256sum -c --strict SHA256SUMS) || { echo "R8P PHASE4 STOP: the staged Phase 4 script does not match its pin"; exit 1; }
  echo "---- 4.0 entry"; P4C entry --state $P4S; rc=$?; echo "R8P P4-ENTRY exit $rc"
  [ "$rc" = 0 ] || { echo "R8P PHASE4 STOP: entry did not PASS; 4.1 not run"; exit 1; }
  echo "---- 4.1 gpasswd -d arm sudo"; gpasswd -d arm sudo; echo "R8P GPASSWD exit $?"
  echo "   id arm: $(id arm)"
  echo "---- 4.2 verify"; P4C verify --state $P4S; echo "R8P P4-VERIFY exit $?"
  echo "R8P PHASE4 done";;
checks44)
  FP=${1:?fp}
  echo "---- 4.4 owner checks after the access change (tee $E/4.4-owner-checks.txt)"
  { echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"; CHECKS --admin afldb-admin --admin-fp "$FP"; } 2>&1 | tee $E/4.4-owner-checks.txt; echo "R8P CHECKS exit ${PIPESTATUS[0]}"
  handover;;
reverify45)
  echo "---- 4.5 both installs re-verified in a new admin root session (tee $E/4.5-reverify.txt)"
  # the OWNER-PROCEDURE 4.5 form: { echo "BOOT-ID ..."; <the three checks>; } 2>&1 | tee <file>; the harness's own exit lines go to
  # fd 3, outside the saved file [HARNESS]
  exec 3>&1
  { echo "BOOT-ID $(/usr/bin/tr -d - < /proc/sys/kernel/random/boot_id)"
    bash $BK/verify-backup-install.sh; echo "R8P VBI-ROOT exit $?" >&3
    bash $BK/verify-backup-install.sh --as-arm; echo "R8P VBI-ARM exit $? mode=as-arm" >&3
    bash $VF/verify-verify-install.sh --role prod; echo "R8P VVI exit $?" >&3
  } 2>&1 | tee $E/4.5-reverify.txt
  exec 3>&-
  handover;;
*) echo "unknown step"; exit 2;;
esac
}
main "$@" < /dev/null; exit
