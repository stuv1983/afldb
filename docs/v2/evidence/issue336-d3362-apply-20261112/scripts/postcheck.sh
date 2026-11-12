set -u; umask 077; D=/home/arm/i336-postcheck-20261112; mkdir -p "$D"; cat > "$D/post.mts" <<'EOS'
// Read-only post-apply check for I336 (2026-11-12). Counts only; the DSN comes from the environment and is never printed.
import { createRequire } from 'node:module';
const require = createRequire('/home/arm/ops/gap029-stages/a25306f9/cand/package.json');
const postgres = require('postgres');
const sql = postgres(process.env.DIAG_DSN, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC', application_name: 'afldb-i336-postcheck' } });
const AUD = `FROM data_edits WHERE table_name = 'draft_picks' AND row_id::text ~ '^[0-9]+$' AND row_id::text::bigint BETWEEN 6819 AND 6853`;
await sql.begin('read only isolation level repeatable read', async (tx: any) => {
  const [ro] = await tx`SHOW transaction_read_only`;
  const [c] = await tx.unsafe(`SELECT
    (SELECT count(*)::int FROM draft_picks) AS picks,
    (SELECT count(*)::int FROM draft_persons) AS persons,
    (SELECT count(*)::int FROM draft_picks WHERE id BETWEEN 6819 AND 6853) AS new_picks,
    (SELECT count(*)::int ${AUD}) AS audit_rows,
    (SELECT count(*)::int ${AUD} AND admin_user_id = 1) AS audit_actor1,
    (SELECT count(DISTINCT row_id)::int ${AUD}) AS audited_picks,
    (SELECT count(*)::int FROM data_overrides WHERE entity_type = 'draft_picks') AS overrides`);
  console.log(JSON.stringify({ transaction_read_only: ro.transaction_read_only, ...c }));
});
await sql.end();
EOS
cd /home/arm/ops/gap029-stages/a25306f9/cand && DIAG_DSN="$(sed -n "s/^AFLDB_BACKUP_DATABASE_URL=//p" /home/arm/projects/afldb/.env | tail -1 | sed "s/^\"\(.*\)\"$/\1/")" /home/arm/.nvm/versions/node/v22.23.2/bin/node --import tsx "$D/post.mts"; echo POST-EXIT=$?
echo "cand dirty=$(git status --porcelain | wc -l)"
echo "app: $(systemctl is-active afldb.service) MainPID=$(systemctl show afldb.service -p MainPID --value) NRestarts=$(systemctl show afldb.service -p NRestarts --value)"
systemctl list-timers --all --no-pager 'afldb*' | sed -n 2p
