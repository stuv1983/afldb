{
# AFLDB V2 host-prerequisite inspection (release gate 9, plan step 2). READ-ONLY. Prepared 2026-10-29.
# Revised 2026-10-29 under the D-V2-HOST-INSPECT-1 amendments: no process command line, crontab line or
# Caddy configuration line is printed; each is reduced to allowlisted, non-secret observations.
# Runs only under the owner's approval D-V2-HOST-INSPECT-1
# (docs/v2/host-prerequisites-inspection-2026-10-29.md). Streamed from Windows; nothing is copied to the host:
#   cmd /c "ssh -o BatchMode=yes afldb bash -s < inspect-host-readonly.sh > inspect.log 2>&1"
# It creates, edits and deletes NO file on the host: no unit, timer, polkit, Caddy, certificate, crontab, backup,
# database or application change; no sudo; no start/stop/reload/enable/disable; the caddy binary is never run.
# Git reads use GIT_OPTIONAL_LOCKS=0. psql runs -X, non-interactive, in read-only sessions as afldb_backup.
# The only side effects are ordinary log lines: one TLS handshake and one HTTPS GET per site, one direct
# health GET (Caddy/app access logs), and four short read-only database connections, one per query
# (identity, extensions, database list, ledger; server log, pg_stat_activity). The identity query runs
# first and any mismatch stops before the other three.
# Output goes to stdout only. Secret values are never printed: .env yields key names only; processes yield
# identity only (pid, user, elapsed, executable name, unit); crontab yields schedules and yes/no classes;
# Caddy yields hashes, diff line counts and allowlisted structure. Nothing relies on redacting raw text.
set -u -o pipefail
export LC_ALL=C GIT_OPTIONAL_LOCKS=0
umask 077
FINDINGS=0
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }
note() { FINDINGS=$((FINDINGS + 1)); echo "FINDING: $*"; }

R=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
BD=/home/arm/backups/afldb
PUBLIC_IP=209.38.87.252
EXPECT_REV=ff100dc2b8da8523f550ef45a9eaa3ef96d9d840
EXPECT_SYSID=7674454702926115004
EXPECT_OID=66668
EXPECT_EXT='pg_trgm=1.6 plpgsql=1.0 unaccent=1.1'
EXPECT_LEDGER_ROWS=110
EXPECT_LAST=110_match_sheet_player_match_stats_authority.sql
# Same digest and method as docs/v2/evidence/current-production-shadow/capture-prod.sh.
EXPECT_LEDGER_DIGEST=789946fe734b23c32ec87e59e3b860877d31a4b32b561624bf1d88fb8f055153
# sha256 of the repository deploy/ files (LF blobs); identical at ff100dc2 (deployed) and candidate 461f4372.
declare -A REPO_SHA=(
  [Caddyfile.production]=65478a2371183468e70986d763005217cd8f2e4411765ac745cdaf9411f54313
  [afldb.service]=a3444840e0bd5f94ea05ea4b01508e0e8209d65ae452be665c1049c6b34e149a
  [afldb-settle-afltables.service]=ac8d6085b75c7c60febc38b810af1841f2b6583fdbdc7fe8cbec113c5d67715b
  [afldb-settle-afltables.timer]=65a33089f59563745ea83660f077bfb87430b4eb66dfb05f5e0eb2c16df7409e
  [afldb-settle-afltables-trigger.rules]=3164e0d9d8f37603effcd5ef91ce2f5ba17fc340370f525251d21991b6c50b64
)
cmp_repo() {
  local f="$1" k="$2" s
  if [ -r "$f" ]; then
    s=$(sha256sum "$f" | cut -c1-64)
    echo "file $f sha256=$s repo_deploy_$k=${REPO_SHA[$k]}"
    [ "$s" = "${REPO_SHA[$k]}" ] || note "$f differs from repository deploy/$k"
  else
    note "$f is absent or unreadable"
  fi
}
UNIT_PROPS=Id,LoadState,ActiveState,SubState,UnitFileState,FragmentPath,DropInPaths,MainPID,ExecMainStartTimestamp,NRestarts,User,WorkingDirectory
# Presence and identity of processes whose command line matches a pattern. The command line is matched by
# pgrep but never printed: only pid, user, elapsed seconds, executable name and systemd unit.
proc_presence() {
  local pids p
  pids=$(pgrep -f -- "$2" 2>/dev/null | tr '\n' ' ')
  echo "process $1 count=$(wc -w <<< "$pids")"
  for p in $pids; do
    echo "process $1 pid=$p $(ps -o user=,etimes=,comm= -p "$p" 2>/dev/null | awk '{print "user=" $1 " elapsed_s=" $2 " comm=" $3}') unit=$(sed -n 's#.*/\([^/]*\.\(service\|scope\)\)$#\1#p' "/proc/$p/cgroup" 2>/dev/null | tail -1)"
  done
}
# Caddyfile structure from allowlisted tokens only: site addresses, handle matchers, proxy upstreams, root
# paths, file_server, log output paths and imports. A token outside its allowlist prints as <other>; no
# configuration line is printed.
caddy_structure() {
  awk -v SRC="$2" '
  function keep(s, re,   n, a, i, o) { n = split(s, a, /[ \t,]+/); o = ""
    for (i = 1; i <= n; i++) if (a[i] != "") o = o (o == "" ? "" : ",") (a[i] ~ re ? a[i] : "<other>")
    return o == "" ? "-" : o }
  BEGIN { HOST = "^(https?://)?[A-Za-z0-9.*-]+(:[0-9]+)?$"; UP = "^((https?|h2c)://)?(localhost|127\\.0\\.0\\.1|\\[::1\\]|[A-Za-z0-9.-]+)(:[0-9]+)?$"
    MATCH = "^(/[A-Za-z0-9._/*-]*|@[A-Za-z0-9_-]+)$"; ROOT = "^(\\*|/[A-Za-z0-9._/-]*)$"; FILE = "^/[A-Za-z0-9._/-]+$"; NAME = "^[A-Za-z0-9._/*-]+$"
    d = 0; site = "-"; hdl = "-" }
  { l = $0; sub(/^[ \t]+/, "", l); if (l ~ /^#/) next; sub(/[ \t]+#.*$/, "", l); sub(/[ \t]+$/, "", l); if (l == "") next
    c = l; gsub(/\{[^{} \t]*\}/, "", c); o = gsub(/\{/, "{", c); x = gsub(/\}/, "}", c)
    w = l; sub(/[ \t]*\{.*$/, "", w); split(w, f, /[ \t]+/); dir = f[1]; rest = w; sub(/^[^ \t]+[ \t]*/, "", rest)
    if (d == 0 && o > 0) {
      site = (w == "" ? "(global)" : (w ~ /^\(/ ? "(snippet)" : keep(w, HOST))); print "caddy_site " SRC " " site
    } else if (dir == "handle" || dir == "handle_path") {
      m = (rest == "" ? "(all)" : keep(rest, MATCH)); if (o > x) hdl = m; print "caddy_handle " SRC " site=" site " " dir "=" m
    } else if (dir == "reverse_proxy") { print "caddy_proxy " SRC " site=" site " handle=" hdl " upstream=" keep(rest, UP)
    } else if (dir == "root") { print "caddy_root " SRC " site=" site " handle=" hdl " path=" keep(rest, ROOT)
    } else if (dir == "file_server") { print "caddy_file_server " SRC " site=" site " handle=" hdl
    } else if (dir == "output" && f[2] == "file") { print "caddy_log_output " SRC " site=" site " path=" keep(f[3], FILE)
    } else if (dir == "import") { print "caddy_import " SRC " site=" site " name=" keep(rest, NAME) }
    d += o - x; if (d <= 1) hdl = "-"; if (d <= 0) { d = 0; site = "-" } }' "$1"
}

step "H0 host identity (stop on any mismatch)"
[ "$(hostname)" = afldb-prod ] || stop "unexpected host $(hostname)" 3
[ "$(id -un)" = arm ] || stop "unexpected user $(id -un)" 3
echo "host=$(hostname) user=$(id -un) kernel=$(uname -r) boot_id=$(cat /proc/sys/kernel/random/boot_id) uptime_s=$(cut -d' ' -f1 /proc/uptime)"
( . /etc/os-release 2>/dev/null && echo "os=${PRETTY_NAME:-unknown}" )
ip -brief address 2>/dev/null | grep -qF "$PUBLIC_IP" && echo "public_ip_bound=$PUBLIC_IP" \
  || note "public IP $PUBLIC_IP is not bound to a local interface (record; may be provider NAT)"

step "H1 deployed application and systemd (read-only queries)"
REV=$(git -C "$R" rev-parse HEAD 2>/dev/null || echo unknown)
echo "deployed_checkout=$REV build_id=$(cat "$R/.next/BUILD_ID" 2>/dev/null || echo unknown)"
echo "deployed_tracked_changes=$(git -C "$R" status --porcelain --untracked-files=no 2>/dev/null | wc -l)"
[ "$REV" = "$EXPECT_REV" ] || note "deployed checkout is not the recorded $EXPECT_REV"
[ -x "$NODE" ] && echo "node=$("$NODE" --version)" || note "pinned Node runtime $NODE is missing"
systemctl show afldb.service -p "$UNIT_PROPS" --no-pager | sed 's/^/afldb.service /'
cmp_repo "$(systemctl show -p FragmentPath --value afldb.service)" afldb.service
systemctl list-unit-files 'afldb*' --no-pager --no-legend | sed 's/^/unit_file /'
systemctl list-timers --all 'afldb-*' --no-pager | sed 's/^/timer /'
for u in afldb-settle-afltables.service afldb-settle-afltables.timer afldb-settle-afl-api.service afldb-settle-afl-api.timer \
  afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-email-intake.service afldb-email-intake.timer \
  afldb-backup.service afldb-backup.timer caddy.service postgresql@16-main.service; do
  printf 'state %s active=%s enabled=%s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)" "$(systemctl is-enabled "$u" 2>/dev/null)"
done
for k in afldb-settle-afltables.service afldb-settle-afltables.timer; do
  F=$(systemctl show -p FragmentPath --value "$k" 2>/dev/null); [ -n "$F" ] && cmp_repo "$F" "$k"
done
echo "polkit_dir $(stat -c '%a %U:%G' /etc/polkit-1/rules.d 2>&1)"
ls -la /etc/polkit-1/rules.d 2>&1 | sed 's/^/polkit /'
[ -r /etc/polkit-1/rules.d ] && for f in /etc/polkit-1/rules.d/*afldb*; do [ -r "$f" ] && cmp_repo "$f" afldb-settle-afltables-trigger.rules; done
proc_presence settle 'settle-'
proc_presence afl_api 'afl-api-'
proc_presence migrate 'migrate\.ts'
proc_presence pg_dump 'pg_dump'
proc_presence pg_restore 'pg_restore'

step "H2 Caddy (configuration read only; the caddy binary is not run)"
dpkg-query -W -f='caddy_package ${Version}\n' caddy 2>/dev/null || note "caddy is not a dpkg package (record its install route)"
systemctl show caddy.service -p "$UNIT_PROPS" --no-pager | sed 's/^/caddy.service /'
# ExecStart is reduced to its executable path and --config path; no other argument is printed.
CX=$(systemctl show caddy.service -p ExecStart --value 2>/dev/null)
echo "caddy_exec path=$(sed -n 's#.*path=\(/[A-Za-z0-9._/-]*\) .*#\1#p' <<< "$CX" | head -1) config=$(sed -n 's#.*--config \(/[A-Za-z0-9._/-]*\).*#\1#p' <<< "$CX" | head -1)"
unset CX
ls -la /etc/caddy 2>&1 | sed 's/^/etc_caddy /'
cmp_repo /etc/caddy/Caddyfile Caddyfile.production
if [ -r /etc/caddy/Caddyfile ] && [ -r "$R/deploy/Caddyfile.production" ]; then
  # Counts only: the differing lines themselves are never printed.
  echo "caddy_diff_lines only_in_live=$(diff "$R/deploy/Caddyfile.production" /etc/caddy/Caddyfile | grep -c '^>') only_in_repo=$(diff "$R/deploy/Caddyfile.production" /etc/caddy/Caddyfile | grep -c '^<')"
  caddy_structure "$R/deploy/Caddyfile.production" repo
fi
[ -r /etc/caddy/Caddyfile ] && caddy_structure /etc/caddy/Caddyfile live
echo "apex_dir $(stat -c '%U:%G %a %y' /var/www/afldb-soon 2>&1)"
ls -la /var/www/afldb-soon 2>&1 | head -40 | sed 's/^/apex_file /'
ls -la /var/log/caddy 2>&1 | sed 's/^/caddy_log_file /'   # names and sizes only; no log is read

step "H3 TLS, DNS and listeners"
ss -Hltn 2>/dev/null | awk '{print "listen " $4}' | sort -u
for h in afldb.com www.afldb.com beta.afldb.com; do
  echo "dns $h $(getent ahostsv4 "$h" | awk '{print $1}' | sort -u | tr '\n' ' ')"
  CERT=$(timeout 15 openssl s_client -connect 127.0.0.1:443 -servername "$h" </dev/null 2>/dev/null \
    | openssl x509 -noout -subject -issuer -startdate -enddate -fingerprint -sha256 -ext subjectAltName 2>/dev/null)
  if [ -n "$CERT" ]; then
    printf '%s\n' "$CERT" | sed "s/^/tls $h /"
    END=$(printf '%s\n' "$CERT" | sed -n 's/^notAfter=//p')
    DAYS=$(( ( $(date -d "$END" +%s) - $(date +%s) ) / 86400 )); echo "tls $h days_remaining=$DAYS"
    [ "$DAYS" -ge 30 ] || note "$h certificate expires within 30 days"
  else
    note "no certificate read for $h on 127.0.0.1:443"
  fi
  P=/; [ "$h" = beta.afldb.com ] && P=/api/health
  echo "https $h$P $(timeout 20 curl -sS -o /dev/null --resolve "$h:443:127.0.0.1" -w 'http=%{http_code} verify=%{ssl_verify_result} redirect=%{redirect_url}' "https://$h$P" 2>&1)"
done
echo "app_direct $(timeout 10 curl -sS -w ' http=%{http_code}' http://127.0.0.1:3100/api/health 2>&1)"

step "H4 backup and recovery routing (names, sizes and dates only; no dump is opened)"
echo "backup_dir $(stat -c '%a %U:%G' "$BD" 2>&1)"
ls -la --time-style=+%FT%T "$BD" 2>&1 | sed 's/^/backup_entry /'
echo "backup_dumps_top_level=$(find "$BD" -maxdepth 1 -name '*.dump' 2>/dev/null | wc -l) backup_total=$(du -sh "$BD" 2>/dev/null | cut -f1)"
df -B1 --output=target,size,used,avail /home/arm /var/lib/postgresql 2>/dev/null | sed 's/^/disk /'
systemctl list-timers --all --no-pager --no-legend 2>/dev/null | grep -iE 'backup|dump|restore|rclone|restic|borg' | sed 's/^/backup_timer /' \
  || echo "backup_timer none"
# Crontab: schedule fields (allowlisted) and yes/no classes per entry; no command text or assignment value.
CRON=$(crontab -l 2>/dev/null); CRON_RC=$?
if [ "$CRON_RC" -ne 0 ]; then
  echo "crontab none_or_unreadable rc=$CRON_RC"
else
  printf '%s\n' "$CRON" | awk '
    { l = $0; sub(/^[ \t]+/, "", l) }
    l == "" || l ~ /^#/ { next }
    l ~ /^[A-Za-z_][A-Za-z0-9_]*[ \t]*=/ { env++; next }
    { n++; split(l, f, /[ \t]+/); ll = tolower(l)
      if (f[1] ~ /^@[a-z]+$/) s = f[1]
      else { s = ""; for (i = 1; i <= 5; i++) s = s (i > 1 ? " " : "") ((f[i] ~ /^[0-9*\/,-]+$/ || f[i] ~ /^[A-Za-z][A-Za-z][A-Za-z]$/) ? f[i] : "<other>") }
      printf "crontab_entry %d schedule=\"%s\" afldb=%d backup=%d dump=%d offhost=%d\n", n, s, (ll ~ /afldb/), (ll ~ /backup/), (ll ~ /pg_dump|pg_basebackup/), (ll ~ /rclone|restic|borg|rsync|scp |aws |s3cmd|gsutil/) }
    END { printf "crontab entries=%d env_assignments=%d\n", n, env }'
fi
unset CRON
ls -la /etc/cron.d 2>&1 | sed 's/^/cron_d /'
grep -l -i afldb /etc/crontab /etc/cron.d/* /etc/cron.daily/* /etc/cron.weekly/* 2>/dev/null | sed 's/^/cron_mentions_afldb /'
for b in rclone restic borg rsync aws s3cmd gsutil; do command -v "$b" >/dev/null && echo "offhost_tool $b $(command -v "$b")"; done
[ -e /home/arm/.config/rclone/rclone.conf ] && echo "rclone_config present (not read)"
grep -iE '^[[:space:]]*Host[[:space:]]' /home/arm/.ssh/config 2>/dev/null | sed 's/^/ssh_host_alias /'
sha256sum "$R/tools/maintenance/backup.sh" "$R/tools/maintenance/restore-test.sh" 2>&1 | sed 's/^/deployed_script /'
echo "env_file $(stat -c '%a %U:%G' "$R/.env" 2>&1)"
echo "env_keys $(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$R/.env" 2>/dev/null | sort -u | tr '\n' ' ')"   # names only

step "H5 database identity and backup prerequisites (afldb_backup, read-only session)"
DSN=$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$R/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/')
[ -n "$DSN" ] || stop "AFLDB_BACKUP_DATABASE_URL empty" 2
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
[[ "$DSN" =~ $RE ]] || { unset DSN; stop "AFLDB_BACKUP_DATABASE_URL has an unexpected form (value not printed)" 2; }
PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
PWENC=${BASH_REMATCH[4]}
PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC DSN BASH_REMATCH
echo "dsn_identity user=$PGUSER host=$PGHOST port=$PGPORT database=$PGDATABASE"
[ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] \
  || stop "credential is not afldb_backup@localhost:5432/afldb_prod" 2
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
RO='-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=60000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-v2-host-prereq-inspect "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }
IDENT=$(q -c "SELECT current_database(), current_user, (SELECT oid FROM pg_database WHERE datname=current_database()),
 (SELECT system_identifier::text FROM pg_control_system()), current_setting('transaction_read_only'),
 (SELECT rolsuper FROM pg_roles WHERE rolname=current_user), (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
 current_setting('server_version')") || stop "identity query failed" 5
echo "identity $IDENT"
IFS=$'\t' read -r I_DB I_USER I_OID I_SYSID I_RO I_SUPER I_OWNER I_VER <<< "$IDENT"
[ "$I_DB" = afldb_prod ] && [ "$I_USER" = afldb_backup ] && [ "$I_OID" = "$EXPECT_OID" ] && [ "$I_SYSID" = "$EXPECT_SYSID" ] \
  && [ "$I_RO" = on ] && [ "$I_SUPER" = f ] && [ "$I_OWNER" = afldb_owner ] || stop "database identity differs from the reviewed target" 5
EXT=$(q -c "SELECT string_agg(extname||'='||extversion, ' ' ORDER BY extname) FROM pg_extension") || stop "extension query failed" 5
echo "extensions $EXT"; [ "$EXT" = "$EXPECT_EXT" ] || note "extension set or versions differ from $EXPECT_EXT"
q -c "SELECT 'database', datname, pg_get_userbyid(datdba) FROM pg_database WHERE NOT datistemplate ORDER BY datname" \
  | sed 's/^/catalog /' || stop "database list query failed" 5
LEDGER=$(q -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\"") || stop "ledger query failed" 5
unset PGPASSWORD
L_ROWS=$(printf '%s\n' "$LEDGER" | wc -l); L_LAST=$(printf '%s\n' "$LEDGER" | tail -1 | cut -f1)
L_DIG=$(printf '%s\n' "$LEDGER" | sha256sum | cut -c1-64)
echo "ledger rows=$L_ROWS last=$L_LAST digest=$L_DIG"
[ "$L_ROWS" = "$EXPECT_LEDGER_ROWS" ] && [ "$L_LAST" = "$EXPECT_LAST" ] && [ "$L_DIG" = "$EXPECT_LEDGER_DIGEST" ] \
  || { echo "STOP: RELEASE DRIFT: the ledger differs from the reviewed 110 baseline (findings=$FINDINGS)"; exit 6; }

step "END findings=$FINDINGS"
[ "$FINDINGS" -eq 0 ] && exit 0 || exit 10
}
