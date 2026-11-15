# B0 read-only production probe (owner-approved 2026-11-15). One ssh session, script on stdin, nothing written on the host.
# No sudo. DSN read on the host from .env and never printed. Aggregates only. Every DB read is inside a
# REPEATABLE READ READ ONLY transaction with default_transaction_read_only, after an identity assertion.
set -u
export LC_ALL=C
echo "== probe_at_utc $(date -u +%FT%TZ) host_local $(date '+%F %T %Z')"
echo "== host $(hostname) kernel_running $(uname -r) uptime_since $(uptime -s)"
if [ -e /var/run/reboot-required ]; then echo "reboot_required=present"; cat /var/run/reboot-required.pkgs 2>/dev/null | sed 's/^/  pkg: /'; else echo "reboot_required=absent"; fi
echo "caddyfile_sha256=$(sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1)"
for f in /etc/needrestart/conf.d/50-afldb-hold.conf /etc/apt/apt.conf.d/52-afldb-unattended; do [ -e "$f" ] && echo "present $f" || echo "absent $f"; done

R=/home/arm/afldb-releases
echo "== releases"
echo "current=$(readlink "$R/current" | sed 's#.*/##') previous=$(readlink "$R/previous" | sed 's#.*/##')"
ls -1 "$R/releases" | sed 's/^/  release: /'
EV_BEFORE=$(wc -l < "$R/events.log" 2>/dev/null || echo NA)
echo "events_log_lines_before=$EV_BEFORE"
tail -n 12 "$R/events.log" 2>/dev/null | sed -E 's/"(memAvailableMb|manifest|workspace)":("[^"]*"|[0-9]+),?//g' | sed 's/^/  ev: /'
CUR="$R/current"
node_bin=/home/arm/.nvm/versions/node/v22.23.2/bin/node
[ -f "$CUR/release.json" ] && "$node_bin" -e 'const r=require(process.argv[1]);console.log("current_release_json "+JSON.stringify({revision:r.revision,buildId:r.buildId,migrationHead:r.migrationHead,afldbEnv:r.afldbEnv,builtAt:r.builtAt??r.createdAt??null}))' "$CUR/release.json"

echo "== serving checkout"
C=/home/arm/projects/afldb
echo "checkout_head=$(git -C "$C" rev-parse HEAD) branch=$(git -C "$C" rev-parse --abbrev-ref HEAD) porcelain_lines=$(git -C "$C" --no-optional-locks status --porcelain | wc -l)"
echo "beta_epoch_line=$(grep -c '^AFLDB_BETA_EPOCH=' "$C/.env") AFLDB_BETA_EPOCH=$(sed -n 's/^AFLDB_BETA_EPOCH=//p' "$C/.env" | tail -1)"

echo "== release.mjs status (no --expect; read-only)"
( cd "$C" && PATH="/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH" "$node_bin" deploy/release.mjs status 2>&1 | sed -E 's#postgres(ql)?://[^ ]+#<dsn>#g' | tail -n 40 )
echo "events_log_lines_after=$(wc -l < "$R/events.log" 2>/dev/null || echo NA)"

echo "== service identity"
for u in afldb.service postgresql@16-main.service caddy.service; do
  echo "$u $(systemctl show "$u" -p ActiveState -p SubState -p MainPID -p NRestarts -p InvocationID -p ActiveEnterTimestamp --no-pager | tr '\n' ' ')"
done
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3000}
echo "health_local port=$P code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:$P/api/health) body=$(curl -s -m 10 http://127.0.0.1:$P/api/health | head -c 300)"

echo "== timers (all)"
systemctl list-timers --all --no-pager 2>&1 | sed 's/^/  /'
echo "== afldb timer units"
for t in $(systemctl list-unit-files --no-pager --no-legend 'afldb*' 2>/dev/null | awk '{print $1}'); do
  echo "$t $(systemctl show "$t" -p UnitFileState -p ActiveState -p LastTriggerUSec -p NextElapseUSecRealtime --no-pager | tr '\n' ' ')"
done
for t in afldb-settle-afl-api.timer afldb-settle-afltables.timer afldb-settle-afl-api-brownlow.timer afldb-backup.timer afldb-backup-verify.timer afldb-email-intake.timer apt-daily-upgrade.timer apt-daily.timer; do
  echo "-- cat $t"; systemctl cat "$t" --no-pager 2>&1 | grep -E '^(# /|OnCalendar|RandomizedDelaySec|Persistent|AccuracySec|OnBootSec|OnUnitActiveSec)' | sed 's/^/   /'
done
echo "== recent settle runs (unit timestamps)"
for s in afldb-settle-afl-api.service afldb-settle-afltables.service afldb-settle-afl-api-brownlow.service; do
  echo "$s $(systemctl show "$s" -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp -p InactiveExitTimestamp -p InactiveEnterTimestamp --no-pager | tr '\n' ' ')"
done
echo "== arm crontab"; crontab -l 2>&1 | grep -v '^#' | sed 's/^/  /'
echo "== seasons.json in-progress entries"
"$node_bin" -e 'const s=require(process.argv[1]);const a=Array.isArray(s)?s:(s.seasons??Object.values(s));console.log(JSON.stringify(a.filter(x=>x&&x.year>=2026)))' "$C/data/reference/seasons.json" 2>&1 | head -c 600; echo

echo "== database"
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$C/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/')"
"$node_bin" --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require = createRequire('/home/arm/projects/afldb/package.json');
const postgres = require('postgres');
const sql = postgres(process.env.RV_DSN, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC', statement_timeout: 60000, application_name: 'b0-readonly-probe' } });
const out = {};
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [identity] = await tx`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid,
      current_setting('transaction_read_only') AS ro, current_user AS role, now()::text AS at, version() AS version
      FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
    if (identity.db !== 'afldb_prod' || identity.oid !== '66668' || identity.sysid !== '7674454702926115004' || identity.ro !== 'on')
      throw Error('production identity/read-only mismatch: ' + JSON.stringify({ db: identity.db, oid: identity.oid, ro: identity.ro }));
    out.identity = identity;
    out.ledger = (await tx`SELECT max(name) AS head, count(*)::int AS applied FROM afldb_meta.schema_migrations`)[0];
    out.ledger_last3 = (await tx`SELECT name FROM afldb_meta.schema_migrations ORDER BY name DESC LIMIT 3`).map((r) => r.name);
    out.seasons = await tx`SELECT year, status FROM seasons WHERE year >= 2025 ORDER BY year`;
    out.site_settings = await tx`SELECT key, value::text AS value FROM site_settings WHERE key IN ('afl_api_current_season_enabled') ORDER BY key`;
    out.cov2026 = await tx`SELECT stat_key, coverage::text, is_recorded, populated_rows, total_rows FROM stat_availability
      WHERE season = 2026 AND stat_key IN ('brownlow_season_total','brownlow_round_votes','brownlow_match_votes') ORDER BY stat_key`;
    out.pss2026 = await tx`SELECT brownlow_status::text, count(*)::int AS n, count(brownlow_votes)::int AS votes_non_null
      FROM player_season_stats WHERE season = 2026 GROUP BY 1 ORDER BY 1`;
    out.pss2025 = await tx`SELECT brownlow_status::text, count(*)::int AS n FROM player_season_stats WHERE season = 2025 GROUP BY 1 ORDER BY 1`;
    out.brownlow_rows_2026 = (await tx`SELECT
      (SELECT count(*)::int FROM brownlow_season_votes WHERE season = 2026) AS season_votes,
      (SELECT count(*)::int FROM brownlow_round_votes WHERE season = 2026) AS round_votes,
      (SELECT count(*)::int FROM brownlow_vote_entry_state WHERE season = 2026) AS entry_state,
      (SELECT count(*)::int FROM player_match_stats p JOIN matches m ON m.id = p.match_id WHERE m.season = 2026 AND p.brownlow_votes IS NOT NULL) AS pms_votes_non_null,
      (SELECT count(*)::int FROM matches WHERE season = 2026 AND round_type = 'home_and_away') AS ha_matches`)[0];
    out.na_cov_outside_declared = await tx`SELECT season, stat_key, coverage::text FROM stat_availability
      WHERE stat_key LIKE 'brownlow%' AND coverage = 'not_applicable' AND season >= 1924 AND season NOT BETWEEN 1942 AND 1945 ORDER BY 1, 2`;
    out.na_cov_war = (await tx`SELECT count(*)::int AS n FROM stat_availability
      WHERE stat_key LIKE 'brownlow%' AND coverage = 'not_applicable' AND season BETWEEN 1942 AND 1945`)[0].n;
    out.na_pss_outside_declared = await tx`SELECT season, count(*)::int AS n FROM player_season_stats
      WHERE brownlow_status = 'not_applicable' AND season >= 1924 AND season NOT BETWEEN 1942 AND 1945 GROUP BY 1 ORDER BY 1`;
    out.na_pss_declared = (await tx`SELECT count(*)::int AS n FROM player_season_stats
      WHERE brownlow_status = 'not_applicable' AND (season BETWEEN 1897 AND 1923 OR season BETWEEN 1942 AND 1945)`)[0].n;
  });
  console.log(JSON.stringify(out, null, 1));
} catch (e) { console.log('DB_ERROR', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 400)); }
finally { await sql.end(); }
JS
unset RV_DSN
echo "== end $(date -u +%FT%TZ)"
