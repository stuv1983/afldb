#!/usr/bin/bash
# r7v-container.sh (R6 r7, MED-2 verifier harness). REHEARSAL ONLY: runs INSIDE a disposable container on streamanator whose PID 1 is
# the REAL systemd 255 (Ubuntu 24.04), started by r7v-host.sh (--network none, never --privileged). Never production.
#   setup-prod     container "afldb-prod": PostgreSQL 16 fixture database afldb_prod (REAL pg_dump archive), the verifier's peer role
#                  (verify/verifier-db.sql + verify/pg-auth-lines.txt, applied verbatim), the REAL sealed backup (R7/backup final:
#                  install-backup.sh, the real timer at the fake-zone 02:20, the real run wrapper, backup.sh and root sealer), a FIXTURE
#                  application afldb.service (User=arm,
#                  python3, 2 workers) on 127.0.0.1:3100, arm's checkout/.env/releases/backup state, and the verifier installed by
#                  THE OWNER INSTALL SCRIPT verify/install-verify.sh --role prod from a root-owned staging copy.
#   setup-offhost  container "streamanator": real cron (fake fixed-offset Melbourne zone so its 03:10 job fires minutes from now), the
#                  REAL kits/afldb-offhost-pull-daily.sh with a FIXTURE offhost-pull.sh (copies the dump the harness carried from the
#                  prod container instead of rsync from production), arm's crontab pair, and install-verify.sh --role offhost.
#   hostile        as arm: ~/.bashrc, ~/.profile, ~/.bash_login, ~/.bash_profile defining functions/aliases and a PATH of shims,
#                  ~/bin shims, a replaced ~/.nvm node, edited checkout scripts and .env lines (FIXTURE-ATTACK)
#   tamper|untamper  root appends one byte to / restores the published dump (FIXTURE damage for the refusal scenario)
#   status         prints facts for the host driver (labelled HARNESS)
# Labels: [REAL-SYSTEMD] [REAL] [FIXTURE] [FIXTURE-ATTACK] [HARNESS].
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin
CMD=${1:?command}
FIX=/in/fix; R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128; KIT=docs/v2/evidence/backlog-20261121/kits
DAY=${R7V_DAY:?}; DAYC=${DAY//-/}
CUR=17822b29e6de-R7VfixtureBuild; PREV=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; CURB=R7VfixtureBuild; PREVB=XWruOm_9nLCSMY8nGPqYU
CHK=/home/arm/projects/afldb; REL=/home/arm/afldb-releases; BK=/home/arm/backups/afldb-scheduled; SB=/var/lib/afldb-backup
L() { printf '[%s] %s\n' "$1" "${*:2}"; }
as_arm() { runuser -u arm -- "$@"; }
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
wait_systemd() { local i; for i in $(seq 1 120); do case $(systemctl is-system-running 2>/dev/null) in running|degraded) return 0;; esac; sleep 1; done; echo "STOP systemd did not come up"; exit 1; }

common() {
  wait_systemd
  L REAL-SYSTEMD "$(systemctl --version | head -1); PID 1 $(cat /proc/1/comm); hostname $(hostname); kernel $(uname -r); $(. /etc/os-release; echo "$PRETTY_NAME")"
  L FIXTURE "zone $(readlink -f /etc/localtime); now UTC $(date -u +%FT%T), Melbourne $(TZ=Australia/Melbourne date '+%F %T %Z')"
  userdel -r ubuntu > /dev/null 2>&1; id arm > /dev/null 2>&1 || useradd -m -u 1000 -s /bin/bash arm
  chmod 0750 /home/arm; chown arm:arm /home/arm
  install -d -o arm -g arm -m 0700 /home/arm/.ssh
  install -o arm -g arm -m 0600 "$FIX/r7v-keys/arm_key.pub" /home/arm/.ssh/authorized_keys
  rm -f /etc/ssh/ssh_host_*; ssh-keygen -A > /dev/null; install -d -m 0755 /run/sshd
  systemctl enable --now ssh.service > /dev/null 2>&1 || systemctl enable --now ssh.socket > /dev/null 2>&1
  # the owner's staging copy: root-owned, protected (install-verify.sh refuses anything else)
  rm -rf /root/r7v-staging; cp -r "$FIX/$R7/verify" /root/r7v-staging; cp "$FIX/r7v-keys/afldb_verify.pub" /root/r7v-staging/afldb_verify.pub
  chown -R root:root /root/r7v-staging; chmod -R go-w /root/r7v-staging; chmod 0755 /root/r7v-staging
  L HARNESS "staging /root/r7v-staging: bundle digest $(sha256sum < /root/r7v-staging/bundle/SHA256SUMS | cut -c1-64)"
}

install_verifier() { # role
  echo "---- install-verify.sh --role $1 (as root, from the root-owned staging; THE OWNER INSTALL SCRIPT UNDER TEST)"
  bash /root/r7v-staging/install-verify.sh --role "$1" --key /root/r7v-staging/afldb_verify.pub 2>&1 | sed 's/^/   | /'
  [ "${PIPESTATUS[0]}" = 0 ] || { echo "STOP install-verify.sh failed"; exit 1; }
  echo "---- verify-verify-install.sh as arm (read-only; sshd checks skipped without root)"
  install -m 0755 /root/r7v-staging/verify-verify-install.sh /tmp/r7v-vvi.sh   # the staging directory is root-only
  as_arm bash /tmp/r7v-vvi.sh --role "$1" 2>&1 | sed 's/^/   | /' || true; rm -f /tmp/r7v-vvi.sh
}

pgq() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# The REAL sealed backup (R7/backup, final; not edited here): the deploy/ units, the backup implementer's owner install from a root-owned
# staging directory, and the REAL timer started before the fake-zone 02:20 of today. Only the timer's timing is a FIXTURE drop-in
# (RandomizedDelaySec=0, AccuracySec=1s; production: 10min, 1min), as in R7/backup-harness.
install_backup() {
  local ST=/opt/r7v-backup-staging B=$FIX/$R7/backup f u
  for u in afldb-backup.service afldb-backup.timer afldb-backup-failed.service; do install -o root -g root -m 0644 "$FIX/deploy/$u" /etc/systemd/system/$u; done
  install -d -o root -g root -m 0755 /etc/systemd/system/afldb-backup.timer.d
  printf '[Timer]\nRandomizedDelaySec=0\nAccuracySec=1s\n' > /etc/systemd/system/afldb-backup.timer.d/50-r7v-fixture-timing.conf
  systemctl daemon-reload
  install -d -o root -g root -m 0755 $ST
  for f in afldb-backup-run afldb-backup-seal 70-afldb-backup-sealed.conf sealed-origin.sh install-backup.sh verify-backup-install.sh SHA256SUMS; do
    install -o root -g root -m 0644 "$B/$f" $ST/$f; done
  install -o root -g root -m 0644 "$FIX/tools/maintenance/backup.sh" $ST/backup.sh
  echo "---- R7/backup/install-backup.sh $ST (REAL: the backup implementer's owner install, as root)"
  (cd / && bash $ST/install-backup.sh $ST) 2>&1 | sed 's/^/   | /'; [ "${PIPESTATUS[0]}" = 0 ] || { echo "STOP install-backup.sh failed"; exit 1; }
  pgq -c "CREATE ROLE afldb_backup LOGIN" -c "GRANT CONNECT ON DATABASE afldb_prod TO afldb_backup" > /dev/null && pgq -d afldb_prod -c "GRANT pg_read_all_data TO afldb_backup" > /dev/null \
    || { echo "STOP afldb_backup role"; exit 1; }
  { echo 'local afldb_prod afldb_backup peer map=afldbbackup'; cat /etc/postgresql/16/main/pg_hba.conf; } > /tmp/hba && cat /tmp/hba > /etc/postgresql/16/main/pg_hba.conf; rm -f /tmp/hba
  echo 'afldbbackup afldb-backup afldb_backup' >> /etc/postgresql/16/main/pg_ident.conf; systemctl reload postgresql@16-main
  L FIXTURE "owner PostgreSQL step for the backup applied as install-backup.sh prints it; role afldb_backup + pg_read_all_data (production: the existing role)"
  systemctl start afldb-backup.timer
  L REAL-SYSTEMD "afldb-backup.timer started at local $(TZ=Australia/Melbourne date '+%F %T'); next elapse $(systemctl show afldb-backup.timer -p NextElapseUSecRealtime --value)"
}

wait_backup() {
  local td=${R7V_TD:?} i s
  while [ "$(date +%s)" -lt "$td" ]; do sleep 1; done
  for i in $(seq 1 240); do
    shopt -s nullglob; s=($SB/seals/*.seal); shopt -u nullglob
    [ "${#s[@]}" -ge 1 ] && [ -z "$(systemctl show afldb-backup.service -p Job --value)" ] \
      && [[ $(systemctl show afldb-backup.service -p ActiveState --value) =~ ^(inactive|failed)$ ]] && break; sleep 1; done
  L REAL-SYSTEMD "afldb-backup.service: $(systemctl show afldb-backup.service -p Result -p ExecMainStatus -p InvocationID | tr '\n' ' ')"
  L REAL-SYSTEMD "afldb-backup.timer LastTriggerUSec $(busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec) ($(TZ=Australia/Melbourne date '+%F %T %Z'))"
  for f in $SB/seals/* $SB/published/* $SB/state/*; do echo "   $(stat -c '%A %U:%G links=%h %s B' "$f") $f"; done
  cat $SB/seals/*.seal | sed 's/^/   seal | /'
  [ "$(systemctl show afldb-backup.service -p Result --value)" = success ] && [ "${#s[@]}" = 1 ] || { echo "STOP the real timer run did not seal one successful run"; exit 1; }
}

setup_prod() {
  common
  # PostgreSQL 16 (REAL server), fixture database
  systemctl start postgresql@16-main; for i in $(seq 1 60); do runuser -u postgres -- psql -X -qAt -c 'select 1' > /dev/null 2>&1 && break; sleep 1; done
  local vdump=afldb_prod-$DAYC-033012.dump vsha
  install -d -o arm -g arm -m 0755 /home/arm/backups "$BK"; install -d -o arm -g arm -m 0700 "$BK/.state"
  head -c 65536 /dev/urandom > "$BK/$vdump"; chown arm:arm "$BK/$vdump"; chmod 0600 "$BK/$vdump"; vsha=$(sha256sum < "$BK/$vdump" | cut -c1-64)
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 <<SQL > /dev/null
CREATE DATABASE afldb_prod; CREATE DATABASE afldb_restore_test;
COMMENT ON DATABASE afldb_restore_test IS 'afldb.restore_test.v1 sha256=$vsha';
REVOKE CONNECT ON DATABASE afldb_prod FROM PUBLIC;
SQL
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d afldb_prod <<'SQL' > /dev/null
CREATE SCHEMA afldb_meta; CREATE TABLE afldb_meta.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), secret_note text DEFAULT 'not for the verifier');
INSERT INTO afldb_meta.schema_migrations (name) SELECT lpad(g::text, 3, '0') || '_fixture.sql' FROM generate_series(1, 117) g;
INSERT INTO afldb_meta.schema_migrations (name) VALUES ('118_fixtures_unconfirmed_participants.sql');
CREATE TABLE public.players (id int PRIMARY KEY, name text); INSERT INTO public.players VALUES (1, 'fixture');
SQL
  install_backup
  echo "---- verify/verifier-db.sql and verify/pg-auth-lines.txt applied verbatim (the prospective owner step)"
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d afldb_prod < /root/r7v-staging/verifier-db.sql 2>&1 | sed 's/^/   | /'
  [ "${PIPESTATUS[0]}" = 0 ] || { echo "STOP verifier-db.sql failed"; exit 1; }
  grep -v '^#' /root/r7v-staging/pg-auth-lines.txt | grep '^afldbverify ' >> /etc/postgresql/16/main/pg_ident.conf
  sed -i "0,/^local/s//$(grep '^local ' /root/r7v-staging/pg-auth-lines.txt)\nlocal/" /etc/postgresql/16/main/pg_hba.conf
  systemctl reload postgresql@16-main; sleep 1
  L REAL "pg_hba local lines: $(grep '^local' /etc/postgresql/16/main/pg_hba.conf | tr -s ' ' | tr '\n' ';')"
  # arm's world (data the verifier reads through the root facts reader)
  printf '{"epoch":%s,"file":"%s","sha256":"%s","attempts":1}\n' "$(( $(date +%s) - 3600 ))" "$vdump" "$vsha" > "$BK/.state/last-verify.json"
  printf '{"epoch":%s,"file":"%s","offhost":"skipped"}\n' "$(( $(date +%s) - 3600 ))" "$vdump" > "$BK/.state/last-backup.json"
  chown -R arm:arm "$BK"; chmod 0600 "$BK/.state/"*
  install -d -o arm -g arm -m 0755 /home/arm/projects "$CHK" "$CHK/.git" "$CHK/.git/refs" "$CHK/.git/refs/heads" "$CHK/deploy" "$CHK/tools" "$CHK/tools/maintenance"
  echo 'ref: refs/heads/main' > "$CHK/.git/HEAD"; echo 17822b29e6de2b6248cd7ada4221800fd81e0003 > "$CHK/.git/refs/heads/main"
  printf 'AFLDB_REVALIDATE_URL=http://127.0.0.1:3100/api/revalidate\nAFLDB_REVALIDATE_SECRET=fixture-secret-never-printed\nAFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:pw@127.0.0.1/afldb_prod\n' > "$CHK/.env"
  cp "$FIX/deploy/release.mjs" "$CHK/deploy/release.mjs"; cp "$FIX/tools/maintenance/scheduled-backup.sh" "$CHK/tools/maintenance/"
  cp "$FIX/deploy/afldb-settle-failure-status.sh" "$CHK/deploy/"
  chown -R arm:arm "$CHK"; chmod 0600 "$CHK/.env"; echo '{}' > /home/arm/a1-rawhead-baseline.json; chown arm:arm /home/arm/a1-rawhead-baseline.json
  install -d -o arm -g arm -m 0755 "$REL" "$REL/releases" "$REL/releases/$CUR/.next/static/$CURB" "$REL/releases/$PREV/.next/static/$PREVB"
  printf '{"id":"%s","revision":"17822b29e6de2b6248cd7ada4221800fd81e0003","buildId":"%s","afldbEnv":"production","createdBy":"r7v-fixture"}\n' "$CUR" "$CURB" > "$REL/releases/$CUR/release.json"
  printf '{"id":"%s","revision":"7d92042fd1100000000000000000000000000000","buildId":"%s","afldbEnv":"production"}\n' "$PREV" "$PREVB" > "$REL/releases/$PREV/release.json"
  echo 'self.__BUILD_MANIFEST={}' | tee "$REL/releases/$CUR/.next/static/$CURB/_buildManifest.js" > "$REL/releases/$PREV/.next/static/$PREVB/_buildManifest.js"
  cat > "$REL/releases/$CUR/server.py" <<'PY'
# FIXTURE application (arm-owned, run by afldb.service as arm): /api/health and this release's own _buildManifest.js; two workers.
import http.server, os, time
for _ in range(2):
    if os.fork() == 0:
        while True:
            time.sleep(3600)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        code, ctype, body = 404, 'text/html', b'not found'
        if self.path == '/api/health':
            code, ctype, body = 200, 'application/json', b'{"status":"ok","database":"ok"}'
        elif self.path.startswith('/_next/static/') and self.path.endswith('/_buildManifest.js'):
            p = os.path.join('.next', 'static', self.path.split('/')[3], '_buildManifest.js')
            if os.path.isfile(p):
                code, ctype, body = 200, 'application/javascript', b'self.__BUILD_MANIFEST={}'
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass
http.server.HTTPServer(('127.0.0.1', 3100), H).serve_forever()
PY
  ln -sfn "releases/$CUR" "$REL/current"; ln -sfn "releases/$PREV" "$REL/previous"; chown -R -h arm:arm "$REL"
  cat > /etc/systemd/system/afldb.service <<EOF
# FIXTURE application unit (REHEARSAL): User=arm, WorkingDirectory through the current link, like production's release route.
[Unit]
Description=AFLDB fixture application (r7v)
[Service]
User=arm
WorkingDirectory=$REL/current
ExecStart=/usr/bin/python3 server.py
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload; systemctl start afldb.service; sleep 2
  local live; live=$(systemctl show afldb -p InvocationID --value)
  printf '{"op":"status-pass","id":"%s","invocationId":"%s","nRestarts":0}\n' "$CUR" "$live" > "$REL/events.log"; chown arm:arm "$REL/events.log"
  L FIXTURE "afldb.service (fixture app) active=$(systemctl is-active afldb) MainPID $(systemctl show afldb -p MainPID --value) InvocationID $live; current -> releases/$CUR"
  install -d /etc/needrestart/conf.d; cp "$FIX/deploy/host-policy/needrestart-afldb-hold.conf" /etc/needrestart/conf.d/50-afldb-hold.conf
  cp "$FIX/deploy/host-policy/apt-52-afldb-unattended.conf" /etc/apt/apt.conf.d/52-afldb-unattended
  L FIXTURE "R1 host policy files copied from the repo into /etc; no caddy, no afldb-backup-verify (weekly restore) unit, no production kernels (container)"
  install_verifier prod
  wait_backup
  L HARNESS "A2ARGS accepted $CUR r3:yes r4:no 10:00 tue:released inv:$live"
}

setup_offhost() {
  common
  local D=/mnt/ssd/afldb-offhost-prod OPS=/home/arm/afldb-ops
  install -d -m 0755 /mnt/ssd; install -d -o arm -g arm -m 0700 "$D"; install -d -o arm -g arm -m 0755 "$OPS"; install -d -o arm -g arm -m 0700 "$OPS/state"
  cp "$FIX/$KIT/afldb-offhost-pull-daily.sh" "$OPS/afldb-offhost-pull-daily.sh"
  cat > "$OPS/offhost-pull.sh" <<'EOF'
#!/usr/bin/env bash
# FIXTURE offhost-pull.sh (REHEARSAL): instead of rsync from production, copy the dump and sidecar the harness carried from the
# prod container (/opt/r7v-incoming), re-hash against the sidecar and write the .verified-<dump> marker, like the real script.
dest=${2:?dest}; dest=${dest%/}
for f in /opt/r7v-incoming/*.dump; do
  n=${f##*/}; cp "$f" "$dest/$n" && cp "$f.sha256" "$dest/$n.sha256" || exit 1
  [ "$(sha256sum < "$dest/$n" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$dest/$n.sha256")" ] || exit 1
  : > "$dest/.verified-$n"; echo "pulled $n"
done
EOF
  printf '#!/bin/sh\ncat > /dev/null\n' > "$OPS/alarm-email.sh"
  chown -R arm:arm "$OPS"; chmod 0755 "$OPS"/*.sh; chmod -R a+rX /opt/r7v-incoming
  printf '%s\n' '# AFLDB-A2-r3: ISSUE-352 daily off-host pull (owner decision 3, 2026-11-22); installed by a2-cron-install.sh' \
    '10 3 * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh' > /root/arm.crontab
  # FIXTURE (container only): pam_loginuid cannot write /proc/self/loginuid without CAP_AUDIT_CONTROL, which fails every cron job
  sed -i 's/^session[[:space:]]\+required[[:space:]]\+pam_loginuid\.so/#&/' /etc/pam.d/cron
  crontab -u arm /root/arm.crontab; systemctl enable --now cron > /dev/null 2>&1; systemctl restart cron
  L REAL "cron $(systemctl is-active cron); arm crontab installed; the REAL afldb-offhost-pull-daily.sh ($(sha256sum < "$OPS/afldb-offhost-pull-daily.sh" | cut -c1-16)) with the FIXTURE offhost-pull.sh"
  L FIXTURE "the 03:10 job is due at local $DAY 03:10:00 = real $(date -u -d "@${R7V_DISPATCH:-0}" +%FT%TZ)"
  install_verifier offhost
}

hostile() {
  L FIXTURE-ATTACK "as arm: login files, shell functions and aliases, PATH shims, a replaced ~/.nvm node, edited checkout and .env"
  local evil='bash() { cat > /dev/null; echo "PASS forged by ~/.bashrc"; echo "G0 PROD RESULT PASS: forged"; echo "OFFHOST-COMPARE afldb_prod-'$DAYC'-022003.dump 0000000000000000000000000000000000000000000000000000000000000000"; echo "R6 OFFHOST RESULT PASS"; echo "R6 PRE RESULT PASS"; return 0; }
sha256sum() { echo "0000000000000000000000000000000000000000000000000000000000000000  -"; }
systemctl() { echo "forged"; }
alias stat="echo forged"; export PATH=$HOME/bin:$PATH; export BASH_ENV=$HOME/.evil.sh; export ENV=$HOME/.evil.sh; export LD_PRELOAD=$HOME/evil.so
export PYTHONPATH=$HOME/pyevil PYTHONSTARTUP=$HOME/pyevil/start.py PGSERVICEFILE=$HOME/.pg_service.conf PGHOST=/tmp'
  for f in .bashrc .profile .bash_login .bash_profile .evil.sh; do printf '%s\n' "$evil" > "/home/arm/$f"; done
  install -d /home/arm/bin /home/arm/pyevil /home/arm/.nvm/versions/node/v22.23.2/bin
  for b in systemctl busctl journalctl sha256sum stat date hostname id cat python3 python3.12 psql timeout env bash sed grep awk; do
    printf '#!/bin/sh\necho "FORGED %s shim"; echo "R6 PRE RESULT PASS"; exit 0\n' "$b" > "/home/arm/bin/$b"; chmod 0755 "/home/arm/bin/$b"; done
  printf 'import sys\nprint("R6 PRE RESULT PASS (forged by PYTHONPATH json)")\nsys.exit(0)\n' > /home/arm/pyevil/json.py; cp /home/arm/pyevil/json.py /home/arm/pyevil/socket.py
  printf '#!/bin/sh\necho "forged node"; echo "release: STATUS PASS %s"; exit 0\n' "$CUR" > /home/arm/.nvm/versions/node/v22.23.2/bin/node
  chmod 0755 /home/arm/.nvm/versions/node/v22.23.2/bin/node
  if [ -d "$CHK" ]; then
    printf '#!/usr/bin/env node\nconsole.log("release: STATUS PASS %s"); process.exit(0)\n' "$CUR" > "$CHK/deploy/release.mjs"
    printf '#!/bin/sh\necho "AFLDB_SETTLE_STATUS OK (forged)"; exit 0\n' > "$CHK/deploy/afldb-settle-failure-status.sh"
    printf '#!/usr/bin/env bash\necho "STATUS ok forged"; exit 0\n' > "$CHK/tools/maintenance/scheduled-backup.sh"
    printf 'BASH_ENV=/home/arm/.evil.sh\nNODE_OPTIONS=--require /home/arm/evil.js\nPATH=/home/arm/bin\n' >> "$CHK/.env"
  fi
  chown -R arm:arm /home/arm
  L FIXTURE-ATTACK "arm's own login now: $(as_arm bash -lc 'type -t bash; echo "$PATH"' 2>&1 | tr '\n' ' ')"
}

case $CMD in
  setup-prod) setup_prod;;
  setup-offhost) setup_offhost;;
  hostile) hostile;;
  tamper) f=$(ls $SB/published/*.dump); stat -c %s "$f" > /root/r7v-size; printf X >> "$f"; L FIXTURE "root appended one byte to $f";;
  untamper) f=$(ls $SB/published/*.dump); truncate -s "$(cat /root/r7v-size)" "$f"; L FIXTURE "restored $f to $(stat -c %s "$f") B";;
  pull-log) cat /home/arm/afldb-ops/state/offhost-pull.log 2>/dev/null;;
  hostkey) cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub;;
  *) echo "STOP unknown command $CMD"; exit 2;;
esac
