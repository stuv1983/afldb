#!/usr/bin/bash
# r8p-container.sh (R6 r8, 28 Nov 2026). REHEARSAL ONLY: runs INSIDE one disposable container on streamanator whose PID 1 is the REAL
# systemd 255 (Ubuntu 24.04), started by r8p-host.sh (--network none, never --privileged, no bind mount). Never production.
# It is the CONSOLE STAND-IN of OWNER-PROCEDURE.md: `docker exec` as root plays the provider console logged in as root [HARNESS].
# Nothing in it installs either bundle: the bundles reach the container only through the admin SSH path (r8p-admin.sh).
#   setup              (stdin: arm's password) production today's shape: arm with sudo, arm's key and .env, PostgreSQL 16
#                      afldb_prod with an owner role, the base afldb-backup units, real sshd; prints the host key       [FIXTURE]
#   console <fp>       (stdin: the admin password) Phase 0 facts of the console session [HARNESS]; then pubkey-swap (arm replaces
#                      the carried .pub with another key) and pubkey-optprefix (arm prefixes the real key with an options field,
#                      same fingerprint): Phase 1 must refuse both and create nothing [FIXTURE-ATTACK]; pubkey-crlf (the key with
#                      a CRLF line end, R8-F-13): the machine test must accept it, and the mode creates nothing; then Phase 1 at the
#                      console: the carried .pub is accepted only as exactly one bare ed25519 line whose fingerprint equals the
#                      workstation's, only its type and key fields are installed, and afldb-admin gets its own password
#   nothing-installed  asserts no bundle was installed (after arm's refused attempt)
#   fc <fp>            fail-closed cases run through the admin-staged owner checks from this console: pg-superuser,
#                      pg-nologin-super (a NOLOGIN superuser role granted to arm's DSN role), group-writable, no-admin,
#                      admin-key-option, admin-extra-key, c3-gw-other (a root-run unit's argument in a root:<group arm is
#                      not in> 0775 directory: C3 reports it, does not fail), c3-gw-arm (the same directory group arm: C3 FAIL,
#                      R8-F-14), then control; each mutation is reverted afterwards                                     [FIXTURE]
#   phase4-backout     (r9; r10) the documented Phase 4 back-out at the console stand-in, from a FRESH session: it reads ONE line on
#                      stdin, the back-out command that 4.1 (apply) printed, carrying the attempt's state directory and seal, and
#                      runs it as printed (no fixed state path); run after every other scenario that needs the post-Phase-4 state
#   final              (stdin: every log of the run) `id` of every identity, then the count of fixture-password occurrences
# Labels: [REAL-SYSTEMD] [REAL] [FIXTURE] [FIXTURE-ATTACK] [HARNESS].
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin
CMD=${1:?command}; IN=/root/r8in
L() { printf '[%s] %s\n' "$1" "${*:2}"; }
as_arm() { setpriv --reuid=arm --regid=arm --init-groups --reset-env "$@" < /dev/null; }
pgq() { (cd / && runuser -u postgres -- env -i PATH=/usr/bin psql -X -q -At -v ON_ERROR_STOP=1 "$@") < /dev/null; }
wait_systemd() { local i; for i in $(seq 1 120); do case $(systemctl is-system-running 2>/dev/null) in running|degraded) return 0;; esac; sleep 1; done; echo "STOP systemd did not come up"; exit 1; }
CHECKS=/root/afldb-r8-owner-checks/afldb-owner-checks.sh
run_checks() { env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc "$CHECKS" "$@" < /dev/null; }

setup() {
  wait_systemd
  L REAL-SYSTEMD "$(systemctl --version | head -1); PID 1 $(cat /proc/1/comm); hostname $(hostname); kernel $(uname -r); $(. /etc/os-release; echo "$PRETTY_NAME")"
  read -r ARMPW || { echo "STOP no arm password on stdin"; exit 1; }
  userdel -r ubuntu > /dev/null 2>&1
  left=$(find / \( -path /proc -o -path /sys -o -path /dev \) -prune -o \( -uid 1000 -o -gid 1000 \) -print 2>/dev/null | head -50)
  [ -z "$left" ] || { L FIXTURE "image files left with uid/gid 1000 by the removed image user, given to root before arm exists: $(tr '\n' ' ' <<< "$left")"; xargs -r -d '\n' chown -h root:root <<< "$left"; }
  useradd -m -u 1000 -s /bin/bash -G sudo arm || { echo "STOP useradd arm"; exit 1; }
  printf 'arm:%s\n' "$ARMPW" | chpasswd || { echo "STOP chpasswd arm"; exit 1; }; unset ARMPW
  install -d -o arm -g arm -m 0700 /home/arm/.ssh && install -o arm -g arm -m 0600 $IN/keys/arm.pub /home/arm/.ssh/authorized_keys
  L FIXTURE "arm as on production today: $(id arm); sudo with its own password (passwd -S: $(passwd -S arm | awk '{print $2}')); arm's key installed"
  FPW=r8p-fixture-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n'); (umask 077; printf '%s\n' "$FPW" > /root/r8p-fixture-pw)
  install -d -o arm -g arm -m 0755 /home/arm/projects /home/arm/projects/afldb
  printf 'DATABASE_URL=postgresql://afldb_app:%s@127.0.0.1:5432/afldb_prod\nAFLDB_OWNER_DATABASE_URL="postgresql://afldb_owner:%s@127.0.0.1:5432/afldb_prod"\nAFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:%s@127.0.0.1/afldb_prod\nAFLDB_REVALIDATE_SECRET=%s\n' \
    "$FPW" "$FPW" "$FPW" "$FPW" > /home/arm/projects/afldb/.env
  chown arm:arm /home/arm/projects/afldb/.env; chmod 0600 /home/arm/projects/afldb/.env
  L FIXTURE "arm's .env with three DSNs (afldb_app, afldb_owner, afldb_backup) carrying a per-run fixture password (never printed)"
  systemctl start postgresql@16-main; for i in $(seq 1 60); do pgq -c 'select 1' > /dev/null 2>&1 && break; sleep 1; done
  pgq -c "CREATE ROLE afldb_owner LOGIN NOSUPERUSER PASSWORD '$FPW'" -c "CREATE ROLE afldb_app LOGIN PASSWORD '$FPW'" -c "CREATE ROLE afldb_backup LOGIN" \
      -c "CREATE DATABASE afldb_prod OWNER afldb_owner" > /dev/null || { echo "STOP roles"; exit 1; }
  pgq -d afldb_prod -c "CREATE SCHEMA afldb_meta AUTHORIZATION afldb_owner" -c "CREATE TABLE afldb_meta.schema_migrations (name text PRIMARY KEY)" \
      -c "ALTER TABLE afldb_meta.schema_migrations OWNER TO afldb_owner" -c "GRANT pg_read_all_data TO afldb_backup" > /dev/null || { echo "STOP schema"; exit 1; }
  unset FPW
  L REAL "PostgreSQL $(pgq -c 'SHOW server_version'); afldb_prod owner $(pgq -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='afldb_prod'"); login roles $(pgq -c "SELECT string_agg(rolname, ' ' ORDER BY rolname) FROM pg_roles WHERE rolcanlogin")"
  for u in afldb-backup.service afldb-backup.timer afldb-backup-failed.service; do install -o root -g root -m 0644 "$IN/deploy/$u" /etc/systemd/system/$u; done
  systemctl daemon-reload
  L REAL "base units (repository deploy/ copies, root-owned, timer not started): afldb-backup.service $(systemctl show afldb-backup.service -p LoadState --value) User=$(systemctl show afldb-backup.service -p User --value)"
  rm -f /etc/ssh/ssh_host_*; ssh-keygen -A > /dev/null; install -d -m 0755 /run/sshd
  systemctl enable --now ssh.service > /dev/null 2>&1 || systemctl enable --now ssh.socket > /dev/null 2>&1
  L REAL "sshd: $(sshd -V 2>&1 | head -1); sshd_config first directive: $(grep -nEv '^[[:space:]]*(#|$)' /etc/ssh/sshd_config | head -1)"
  echo "R8P HOSTKEY $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
  echo "R8P SETUP DONE"
}

phase0() {
  L HARNESS "console stand-in: docker exec as root; production's provider console root login is UNKNOWN (OWNER-PROCEDURE.md Phase 0)"
  echo "   id: $(id)"; echo "   loginuid: $(cat /proc/self/loginuid)"; echo "   passwd -S root: $(passwd -S root | awk '{print $2}')"
  echo "   ancestors: $(p=$$; while [ "$p" -gt 0 ] 2>/dev/null; do printf '%s:%s:uid=%s ' "$p" "$(cat /proc/$p/comm)" "$(awk '/^Uid:/ {print $2}' /proc/$p/status)"; p=$(awk '/^PPid:/ {print $2}' /proc/$p/status); done)"
  echo "R8P PHASE0 root-console=yes"
}

phase1() { # mode(real|swap|optprefix|crlf) fp ; the console commands of OWNER-PROCEDURE.md Phase 1 steps 1.4-1.5 and 1.6-1.10
  local MODE=$1 FP=$2 K=/root/afldb-r8-keyin/afldb_admin.pub OK
  if [ "$MODE" = crlf ]; then
    # r8 review R8-F-13: a carry that skipped the workstation's CR strip (Windows ssh-keygen writes CRLF). The machine test strips
    # ONE trailing CR, so it must accept this key; the mode then stops before creating anything.
    as_arm /usr/bin/bash --noprofile --norc -c 'cp ~/afldb_admin.pub ~/.r8p-saved.pub; tr -d "\r" < ~/.r8p-saved.pub | sed "s/\$/\r/" > ~/afldb_admin.pub'
    L FIXTURE "the carried key given a CRLF line end (an un-normalised Windows carry): CR count $(as_arm /usr/bin/grep -c $'\r' /home/arm/afldb_admin.pub)"
  fi
  if [ "$MODE" = swap ] || [ "$MODE" = optprefix ]; then
    as_arm /usr/bin/bash --noprofile --norc -c 'cp ~/afldb_admin.pub ~/.r8p-saved.pub'
    if [ "$MODE" = swap ]; then
      setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc -c 'cat > ~/afldb_admin.pub' < $IN/keys/swap.pub
      L FIXTURE-ATTACK "arm replaced the carried ~/afldb_admin.pub with another key (fingerprint $(ssh-keygen -lf $IN/keys/swap.pub | awk '{print $2}'))"
    else
      as_arm /usr/bin/bash --noprofile --norc -c '{ printf "command=\"/home/arm/x\" "; cat ~/.r8p-saved.pub; } > ~/afldb_admin.pub'
      L FIXTURE-ATTACK "arm prefixed the carried key with an options field (command=...); its fingerprint is still the workstation's"
    fi
  fi
  # 1.4: root's copy, read with arm's rights
  install -d -m 0700 /root/afldb-r8-keyin && rm -f "$K" "$K.n" "$K.line"
  as_arm /usr/bin/cat /home/arm/afldb_admin.pub > "$K"
  # 1.5: machine test, exactly as written in the procedure: ONE trailing CR is stripped (R8-F-13), then ONE line,
  # `ssh-ed25519 <68 base64 chars>` plus an optional printable comment, nothing before it; only the type and key fields are kept;
  # their fingerprint must equal the workstation's
  OK=0
  sed 's/\r$//' "$K" > "$K.n"
  [ "$(grep -c '' "$K.n")" = 1 ] && LC_ALL=C grep -Eqx 'ssh-ed25519 [A-Za-z0-9+/]{68}( [ -~]*)?' "$K.n" && awk '{print $1, $2}' "$K.n" > "$K.line" \
    && [ "$(ssh-keygen -lf "$K.line" | awk '{print $2}')" = "$FP" ] && OK=1
  echo "   carried key: $(grep -c '' "$K.n") line(s), $(grep -c $'\r' "$K") with a CR before the strip; shape $(LC_ALL=C grep -Eqx 'ssh-ed25519 [A-Za-z0-9+/]{68}( [ -~]*)?' "$K.n" && echo bare-ed25519 || echo NOT-bare); fingerprint of the kept fields $( [ -s "$K.line" ] && ssh-keygen -lf "$K.line" | awk '{print $2}' || echo none); workstation $FP"
  if [ "$OK" = 1 ] && [ "$MODE" = crlf ]; then
    echo "R8P PHASE1 CRLF-ACCEPTED (crlf): one trailing CR stripped; the kept fields carry the workstation's fingerprint; this rehearsal mode creates nothing"
    getent passwd afldb-admin > /dev/null && echo "R8P PHASE1 UNEXPECTED: afldb-admin exists"
    as_arm /usr/bin/bash --noprofile --norc -c 'mv ~/.r8p-saved.pub ~/afldb_admin.pub'
    return 0
  fi
  if [ "$OK" != 1 ]; then
    echo "R8P PHASE1 REFUSED ($MODE): the carried key is malformed or not the workstation key; nothing created"
    getent passwd afldb-admin > /dev/null && echo "R8P PHASE1 UNEXPECTED: afldb-admin exists"
    [ "$MODE" != real ] && as_arm /usr/bin/bash --noprofile --norc -c 'mv ~/.r8p-saved.pub ~/afldb_admin.pub'
    return 1
  fi
  [ "$MODE" != real ] && { echo "R8P PHASE1 UNEXPECTED ($MODE): the altered key was accepted"; return 3; }
  read -r APW || { echo "STOP no admin password on stdin"; return 1; }
  useradd -m -U -s /bin/bash afldb-admin || return 1
  printf 'afldb-admin:%s\n' "$APW" | chpasswd || return 1; unset APW
  usermod -a -G sudo afldb-admin || return 1
  chmod 0750 /home/afldb-admin
  install -d -o afldb-admin -g afldb-admin -m 0700 /home/afldb-admin/.ssh
  install -o afldb-admin -g afldb-admin -m 0600 "$K.line" /home/afldb-admin/.ssh/authorized_keys
  echo "   afldb-admin: $(id afldb-admin); password $(passwd -S afldb-admin | awk '{print $2}'); home $(stat -c '%U:%G %a' /home/afldb-admin); authorized_keys $(stat -c '%U:%G %a' /home/afldb-admin/.ssh/authorized_keys) $(ssh-keygen -lf /home/afldb-admin/.ssh/authorized_keys | awk '{print $2}') ($(grep -c '' /home/afldb-admin/.ssh/authorized_keys) line)"
  echo "   sudo -l -U afldb-admin: $(sudo -l -U afldb-admin | sed -n '/may run/,$p' | sed 1d | tr -s ' ' | tr '\n' ';')"
  echo "R8P PHASE1 DONE ($MODE)"
}

fc_case() { # case fp
  local CASE=$1 FP=$2 rc AK=/home/afldb-admin/.ssh/authorized_keys
  case $CASE in
    pg-superuser)   pgq -c 'ALTER ROLE afldb_owner SUPERUSER' > /dev/null; L FIXTURE "ALTER ROLE afldb_owner SUPERUSER (arm's owner DSN role)";;
    pg-nologin-super) pgq -c 'CREATE ROLE r8p_super NOLOGIN SUPERUSER' -c 'GRANT r8p_super TO afldb_owner' > /dev/null
                    L FIXTURE "CREATE ROLE r8p_super NOLOGIN SUPERUSER; GRANT r8p_super TO afldb_owner (arm's owner DSN role stays NOSUPERUSER itself: $(pgq -c "SELECT rolsuper FROM pg_roles WHERE rolname='afldb_owner'"))";;
    group-writable) chmod g+w /usr/local/lib/afldb-verify; L FIXTURE "chmod g+w /usr/local/lib/afldb-verify: $(stat -c '%U:%G %a' /usr/local/lib/afldb-verify)";;
    no-admin)       mv "$AK" /root/afldb-r8-keyin/held-authorized_keys; L FIXTURE "the admin's authorized_keys moved away (no admin SSH path)";;
    admin-key-option) cp -p "$AK" /root/afldb-r8-keyin/held-authorized_keys; { printf 'no-pty '; cat /root/afldb-r8-keyin/held-authorized_keys; } > "$AK"
                    L FIXTURE "the admin's single key line given an options prefix (no-pty); same fingerprint";;
    admin-extra-key) cp -p "$AK" /root/afldb-r8-keyin/held-authorized_keys; cat $IN/keys/swap.pub >> "$AK"
                    L FIXTURE "a second key line appended to the admin's authorized_keys";;
    c3-gw-other|c3-gw-arm) # R8-F-14: a root-run unit whose argument sits in a group-writable directory
                    groupadd r8pgrp; install -d -o root -g r8pgrp -m 0775 /opt/r8p-gw
                    printf '#!/bin/sh\ntrue\n' > /opt/r8p-gw/x.sh; chown root:root /opt/r8p-gw/x.sh; chmod 0755 /opt/r8p-gw/x.sh
                    printf '[Unit]\nDescription=r8p F-14 fixture\n[Service]\nType=oneshot\nExecStart=/bin/sh /opt/r8p-gw/x.sh\n' > /etc/systemd/system/r8p-gw.service
                    [ "$CASE" = c3-gw-arm ] && chgrp arm /opt/r8p-gw
                    systemctl daemon-reload
                    L FIXTURE "root-run r8p-gw.service runs /bin/sh /opt/r8p-gw/x.sh; /opt/r8p-gw is $(stat -c '%U:%G %a' /opt/r8p-gw) (arm's groups: $(id -Gn arm))";;
    control)        L HARNESS "no mutation (control)";;
  esac
  echo "---- owner checks from the console stand-in (case $CASE)"
  run_checks --admin afldb-admin --admin-fp "$FP"; rc=$?
  if [ "$CASE" = no-admin ]; then echo "---- and with an admin account that does not exist"; run_checks --admin afldb-nosuch | grep -E '^CHECK F|^OWNER CHECKS'; echo "R8P FC no-admin-nosuch checks-exit ${PIPESTATUS[0]}"; fi
  case $CASE in
    pg-superuser)   pgq -c 'ALTER ROLE afldb_owner NOSUPERUSER' > /dev/null;;
    pg-nologin-super) pgq -c 'DROP ROLE r8p_super' > /dev/null;;
    group-writable) chmod g-w /usr/local/lib/afldb-verify;;
    c3-gw-other|c3-gw-arm) rm -f /etc/systemd/system/r8p-gw.service; systemctl daemon-reload; rm -rf /opt/r8p-gw; groupdel r8pgrp;;
    no-admin|admin-key-option|admin-extra-key) mv /root/afldb-r8-keyin/held-authorized_keys "$AK";;
  esac
  echo "R8P FC $CASE checks-exit $rc (reverted)"
}

case $CMD in
setup) setup;;
console)
  FP=${2:?workstation fingerprint}
  phase0
  phase1 swap "$FP"; echo "R8P PUBKEY-SWAP exit $?"
  phase1 optprefix "$FP"; echo "R8P PUBKEY-OPTPREFIX exit $?"
  phase1 crlf "$FP"; echo "R8P PUBKEY-CRLF exit $?"
  phase1 real "$FP"; echo "R8P PHASE1 exit $?";;
nothing-installed)
  r=; id afldb-backup > /dev/null 2>&1 && r="$r user-afldb-backup"; id afldb-verify > /dev/null 2>&1 && r="$r user-afldb-verify"
  [ -e /etc/systemd/system/afldb-backup.service.d/70-afldb-backup-sealed.conf ] && r="$r drop-in"; [ -e /usr/local/lib/afldb-backup ] && r="$r code-dir"
  [ -e /usr/local/lib/afldb-verify ] && r="$r verify-dir"; getent group afldb-backup-read > /dev/null && r="$r group-afldb-backup-read"
  [ -z "$r" ] && echo "R8P NOTHING-INSTALLED yes" || echo "R8P NOTHING-INSTALLED no:$r";;
fc)
  FP=${2:?fp}
  [ -f "$CHECKS" ] || { echo "STOP the owner checks were not staged by the admin session"; exit 1; }
  for c in pg-superuser pg-nologin-super group-writable no-admin admin-key-option admin-extra-key c3-gw-other c3-gw-arm control; do fc_case "$c" "$FP"; done;;
phase4-backout) # r9: the documented back-out at the console stand-in, after the main flow (OWNER-PROCEDURE Phase 4 back-out)
  P4=/root/afldb-r10-phase4
  [ -f $P4/afldb-phase4.sh ] || { echo "STOP the Phase 4 script was not staged by the admin session"; exit 1; }
  IFS= read -r BC || { echo "STOP no back-out command on stdin"; exit 2; }
  [[ $BC == "(cd $P4 && sha256sum -c --strict SHA256SUMS) && env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $P4/afldb-phase4.sh backout --state /root/afldb-phase4/attempt-"*" --seal "* ]] \
    || { echo "STOP the line on stdin is not a printed afldb-phase4.sh back-out command: $BC"; exit 2; }
  echo "---- [CON] (console stand-in, a fresh session) the back-out command 4.1 printed, run as printed: $BC"
  echo "   access epoch before: $(cat /var/lib/afldb-access/epoch 2>/dev/null || echo none)"
  env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc -c "$BC" < /dev/null
  echo "R8P P4-BACKOUT exit $?"
  echo "   access epoch after: $(cat /var/lib/afldb-access/epoch 2>/dev/null || echo none)"
  echo "   id arm: $(id arm)"; echo "   sudo -l -U arm: $(sudo -n -l -U arm 2>&1 | tail -1)";;
final)
  for u in root arm afldb-admin afldb-backup afldb-verify postgres; do echo "   id $u: $(id "$u" 2>&1)"; done
  n=$(grep -c -F -f /root/r8p-fixture-pw); echo "R8P SECRET-SCAN fixture-password-occurrences ${n:-0}";;
*) echo "STOP unknown command $CMD"; exit 2;;
esac
