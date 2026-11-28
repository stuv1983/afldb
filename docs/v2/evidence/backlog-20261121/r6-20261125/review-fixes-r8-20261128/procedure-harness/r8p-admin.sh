#!/usr/bin/bash
# r8p-admin.sh (R6 r8, 28 Nov 2026). REHEARSAL ONLY. The ROOT steps of OWNER-PROCEDURE.md that run in the ADMIN ROOT SESSION: the
# workstation sends this file over the admin SSH path (key ~/.ssh/afldb_admin, user afldb-admin) as the stdin of
#   sudo -S -p '' -k /usr/bin/bash --noprofile --norc -s -- <step> <args>
# after one line holding the admin's password (the harness stand-in for the owner typing it in the admin session) [HARNESS].
# Steps: stage | checks | install | phase4 | reverify. Every byte installed comes from the tar the workstation sent over the admin
# path, re-verified here against the digests the WORKSTATION computed (passed as arguments, never read from a file on this host).
# Nothing here reads, executes or copies anything from /home/arm.
main() {
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin; umask 022; cd / || exit 90
STEP=${1:?step}; shift
R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128; R8=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r8-20261128
T=/home/afldb-admin/afldb-r8-stage.tar; X=/root/afldb-r8-extract; OC=/root/afldb-r8-owner-checks; BK=/root/afldb-r8-backup; VF=/root/afldb-r8-verify
CHECKS() { env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $OC/afldb-owner-checks.sh "$@" < /dev/null; }
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
  echo "---- verify-backup-install.sh as root"
  bash $BK/verify-backup-install.sh; echo "R8P VBI-ROOT exit $?"
  if grep -q -- '--as-arm' $BK/verify-backup-install.sh; then
    echo "---- verify-backup-install.sh --as-arm (root drops to arm: setpriv --reset-env, bash --noprofile --norc, stdin /dev/null)"
    bash $BK/verify-backup-install.sh --as-arm; echo "R8P VBI-ARM exit $? mode=as-arm"
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
  echo "---- verify-verify-install.sh --role prod as root"
  bash $VF/verify-verify-install.sh --role prod; echo "R8P VVI exit $?"
  echo "---- owner checks after the installs, BEFORE the access change"
  CHECKS --admin afldb-admin --admin-fp "$FP"; echo "R8P CHECKS exit $?";;
phase4)
  echo "---- Phase 4 (owner approval): remove arm from sudo; the console stays open"
  gpasswd -d arm sudo; echo "   gpasswd exit $?"
  echo "   id arm: $(id arm)"; echo "   sudo -l -U arm: $(sudo -n -l -U arm 2>&1 | tail -1)"
  echo "R8P PHASE4 done";;
reverify)
  FP=${1:?fp}
  bash $BK/verify-backup-install.sh; echo "R8P VBI-ROOT exit $?"
  if grep -q -- '--as-arm' $BK/verify-backup-install.sh; then bash $BK/verify-backup-install.sh --as-arm; echo "R8P VBI-ARM exit $? mode=as-arm"
  else setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc -s < $BK/verify-backup-install.sh; echo "R8P VBI-ARM exit $? mode=setpriv-fallback"; fi
  bash $VF/verify-verify-install.sh --role prod; echo "R8P VVI exit $?"
  echo "---- owner checks after the access change"
  CHECKS --admin afldb-admin --admin-fp "$FP"; echo "R8P CHECKS exit $?";;
*) echo "unknown step"; exit 2;;
esac
}
main "$@" < /dev/null; exit
