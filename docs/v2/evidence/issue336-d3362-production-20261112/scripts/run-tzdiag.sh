set -u; umask 077; D=/home/arm/i336-tzdiag-20261112; mkdir -p "$D"; cat > "$D/tzdiag.mts" <<'EOS'
// Read-only diagnostic for the I336 plan refusal "baseline drift" (2026-11-12). Recomputes the I336 tool's surfaceDigest exactly
// (tools/v2/issue336-predraft-insert-production.ts:199-205 at c1c4b22e) in ONE read-only repeatable-read transaction, first in the
// session's default TimeZone, then after SET LOCAL TIME ZONE 'Etc/UTC' (the isolated restore cluster's setting). Prints digests,
// counts and column types only. The DSN comes from the environment and is never printed.
import { createRequire } from 'node:module';
import { canonJson, sha256 } from '/home/arm/ops/gap029-stages/c1c4b22e/cand/tools/v2/gap029-common.ts';
const require = createRequire('/home/arm/ops/gap029-stages/c1c4b22e/cand/package.json');
const postgres = require('postgres');
const dsn = process.env.DIAG_DSN;
if (!dsn) { console.log('no DSN'); process.exit(2); }
const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true, application_name: 'afldb-i336-tz-diag' } });
const surface = async (s: any) => {
  const one = async (q: string) => (await s.unsafe(q))[0];
  const p = await one(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM draft_picks t`);
  const q = await one(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM draft_persons t`);
  const o = await one(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM data_overrides t WHERE entity_type = 'draft_picks'`);
  return { digest: sha256(canonJson({ p, q, o })), p, q, o };
};
await sql.begin('read only isolation level repeatable read', async (tx: any) => {
  const [ro] = await tx`SHOW transaction_read_only`;
  const [tz] = await tx`SHOW timezone`;
  const cols = await tx`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('draft_picks','draft_persons','data_overrides') AND data_type LIKE 'timestamp%' ORDER BY 1, 2`;
  const [b] = await tx`SELECT count(*)::int AS n FROM import_batches`;
  const def = await surface(tx);
  await tx`SET LOCAL TIME ZONE 'Etc/UTC'`;
  const utc = await surface(tx);
  console.log(JSON.stringify({ transaction_read_only: ro.transaction_read_only, serverTimeZone: tz.TimeZone, importBatches: b.n,
    timestampColumns: cols.map((c: any) => `${c.table_name}.${c.column_name}:${c.data_type}`), defaultTz: def, utc }, null, 1));
});
await sql.end();
EOS
cd /home/arm/ops/gap029-stages/c1c4b22e/cand && DIAG_DSN="$(sed -n "s/^AFLDB_BACKUP_DATABASE_URL=//p" /home/arm/projects/afldb/.env | tail -1 | sed "s/^\"\(.*\)\"$/\1/")" /home/arm/.nvm/versions/node/v22.23.2/bin/node --import tsx "$D/tzdiag.mts"; echo DIAG-EXIT=$?; echo "cand dirty=$(git status --porcelain | wc -l)"
