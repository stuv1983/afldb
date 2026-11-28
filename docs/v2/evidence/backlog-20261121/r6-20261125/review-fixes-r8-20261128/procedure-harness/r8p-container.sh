#!/usr/bin/bash
# r8p-container.sh (R6 r8, 28 Nov 2026). REHEARSAL ONLY: runs INSIDE one disposable container on streamanator whose PID 1 is the REAL
# systemd 255 (Ubuntu 24.04), started by r8p-host.sh (--network none, never --privileged, no bind mount). Never production.
# It is the CONSOLE STAND-IN of OWNER-PROCEDURE.md: `docker exec` as root plays the provider console logged in as root [HARNESS].
# Nothing in it installs either bundle: the bundles reach the container only through the admin SSH path (r8p-admin.sh).
#   setup              (stdin: arm's password) production today's shape: arm with sudo, arm's key and .env, PostgreSQL 16
#                      afldb_prod with an owner role, the base afldb-backup units, real sshd; prints the host key       [FIXTURE]
#   console <fp>       (stdin: the admin password) Phase 0 facts of the console session [HARNESS]; then pubkey-swap: arm replaces
#                      the carried .pub with another key and Phase 1 must refuse and create nothing [FIXTURE-ATTACK]; then Phase 1
#                      at the console: the .pub arm carried is accepted only if its fingerprint equals the workstation's, and
#                      afldb-admin is created with its own password and that key
#   nothing-installed  asserts no bundle was installed (after arm's refused attempt)
#   fc <fp>            fail-closed cases run through the admin-staged owner checks from this console: pg-superuser,
#                      group-writable, no-admin, then control; each mutation is reverted afterwards                    [FIXTURE]
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

phase1() { # mode(real|swap) fp ; the console commands of OWNER-PROCEDURE.md Phase 1 (typed by the owner at the console as root)
  local MODE=$1 FP=$2 GOT
  if [ "$MODE" = swap ]; then
    as_arm /usr/bin/bash --noprofile --norc -c 'cp ~/afldb_admin.pub ~/.r8p-saved.pub'
    setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc -c 'cat > ~/afldb_admin.pub' < $IN/keys/swap.pub
    L FIXTURE-ATTACK "arm replaced the carried ~/afldb_admin.pub with another key (fingerprint $(ssh-keygen -lf $IN/keys/swap.pub | awk '{print $2}'))"
  fi
  install -d -m 0700 /root/afldb-r8-keyin && rm -f /root/afldb-r8-keyin/afldb_admin.pub
  as_arm /usr/bin/cat /home/arm/afldb_admin.pub > /root/afldb-r8-keyin/afldb_admin.pub     # read with arm's rights, into root's copy
  GOT=$(ssh-keygen -lf /root/afldb-r8-keyin/afldb_admin.pub 2>/dev/null)
  echo "   carried key, root's copy: $(awk '{print $1, $2, $NF}' <<< "$GOT") ($(grep -c . /root/afldb-r8-keyin/afldb_admin.pub) line(s)); workstation fingerprint $FP"
  if [ "$(grep -c . <<< "$GOT")" != 1 ] || [ "$(awk '{print $2}' <<< "$GOT")" != "$FP" ] || [[ $GOT != *"(ED25519)" ]] \
     || [ "$(awk 'NF {print $1}' /root/afldb-r8-keyin/afldb_admin.pub)" != ssh-ed25519 ]; then   # one bare key line: no options prefix
    echo "R8P PHASE1 REFUSED ($MODE): the carried key's fingerprint is not the workstation's; nothing created"
    getent passwd afldb-admin > /dev/null && echo "R8P PHASE1 UNEXPECTED: afldb-admin exists"
    [ "$MODE" = swap ] && as_arm /usr/bin/bash --noprofile --norc -c 'mv ~/.r8p-saved.pub ~/afldb_admin.pub'
    return 1
  fi
  [ "$MODE" = swap ] && { echo "R8P PHASE1 UNEXPECTED ($MODE): the swapped key was accepted"; return 3; }
  read -r APW || { echo "STOP no admin password on stdin"; return 1; }
  useradd -m -U -s /bin/bash afldb-admin || return 1
  printf 'afldb-admin:%s\n' "$APW" | chpasswd || return 1; unset APW
  usermod -a -G sudo afldb-admin || return 1
  chmod 0750 /home/afldb-admin
  install -d -o afldb-admin -g afldb-admin -m 0700 /home/afldb-admin/.ssh
  install -o afldb-admin -g afldb-admin -m 0600 /root/afldb-r8-keyin/afldb_admin.pub /home/afldb-admin/.ssh/authorized_keys
  echo "   afldb-admin: $(id afldb-admin); password $(passwd -S afldb-admin | awk '{print $2}'); home $(stat -c '%U:%G %a' /home/afldb-admin); authorized_keys $(stat -c '%U:%G %a' /home/afldb-admin/.ssh/authorized_keys) $(ssh-keygen -lf /home/afldb-admin/.ssh/authorized_keys | awk '{print $2}')"
  echo "   sudo -l -U afldb-admin: $(sudo -l -U afldb-admin | sed -n '/may run/,$p' | sed 1d | tr -s ' ' | tr '\n' ';')"
  echo "R8P PHASE1 DONE ($MODE)"
}

fc_case() { # case fp
  local CASE=$1 FP=$2 rc
  case $CASE in
    pg-superuser)   pgq -c 'ALTER ROLE afldb_owner SUPERUSER' > /dev/null; L FIXTURE "ALTER ROLE afldb_owner SUPERUSER (arm's owner DSN role)";;
    group-writable) chmod g+w /usr/local/lib/afldb-verify; L FIXTURE "chmod g+w /usr/local/lib/afldb-verify: $(stat -c '%U:%G %a' /usr/local/lib/afldb-verify)";;
    no-admin)       mv /home/afldb-admin/.ssh/authorized_keys /root/afldb-r8-keyin/held-authorized_keys; L FIXTURE "the admin's authorized_keys moved away (no admin SSH path)";;
    control)        L HARNESS "no mutation (control)";;
  esac
  echo "---- owner checks from the console stand-in (case $CASE)"
  run_checks --admin afldb-admin --admin-fp "$FP"; rc=$?
  if [ "$CASE" = no-admin ]; then echo "---- and with an admin account that does not exist"; run_checks --admin afldb-nosuch | grep -E '^CHECK F|^OWNER CHECKS'; echo "R8P FC no-admin-nosuch checks-exit ${PIPESTATUS[0]}"; fi
  case $CASE in
    pg-superuser)   pgq -c 'ALTER ROLE afldb_owner NOSUPERUSER' > /dev/null;;
    group-writable) chmod g-w /usr/local/lib/afldb-verify;;
    no-admin)       mv /root/afldb-r8-keyin/held-authorized_keys /home/afldb-admin/.ssh/authorized_keys;;
  esac
  echo "R8P FC $CASE checks-exit $rc (reverted)"
}

case $CMD in
setup) setup;;
console)
  FP=${2:?workstation fingerprint}
  phase0
  phase1 swap "$FP"; echo "R8P PUBKEY-SWAP exit $?"
  phase1 real "$FP"; echo "R8P PHASE1 exit $?";;
nothing-installed)
  r=; id afldb-backup > /dev/null 2>&1 && r="$r user-afldb-backup"; id afldb-verify > /dev/null 2>&1 && r="$r user-afldb-verify"
  [ -e /etc/systemd/system/afldb-backup.service.d/70-afldb-backup-sealed.conf ] && r="$r drop-in"; [ -e /usr/local/lib/afldb-backup ] && r="$r code-dir"
  [ -e /usr/local/lib/afldb-verify ] && r="$r verify-dir"; getent group afldb-backup-read > /dev/null && r="$r group-afldb-backup-read"
  [ -z "$r" ] && echo "R8P NOTHING-INSTALLED yes" || echo "R8P NOTHING-INSTALLED no:$r";;
fc)
  FP=${2:?fp}
  [ -f "$CHECKS" ] || { echo "STOP the owner checks were not staged by the admin session"; exit 1; }
  for c in pg-superuser group-writable no-admin control; do fc_case "$c" "$FP"; done;;
final)
  for u in root arm afldb-admin afldb-backup afldb-verify postgres; do echo "   id $u: $(id "$u" 2>&1)"; done
  n=$(grep -c -F -f /root/r8p-fixture-pw); echo "R8P SECRET-SCAN fixture-password-occurrences ${n:-0}";;
*) echo "STOP unknown command $CMD"; exit 2;;
esac
