/**
 * Populated-ledger rollback rehearsal: content, identity, sequence, relationship and public-result
 * fingerprints of the V2 ledgers and the canonical rows they audit. Read-only. It describes a database
 * whose V2 tables are absent too (the state after the documented reversal), so the same command records
 * before-reversal, after-reversal and after-recovery.
 *
 *   node --import tsx tools/v2/rollback-fingerprint.ts <out.json>          (via tools/v2/isolated-pg.ts run)
 *   node --import tsx tools/v2/rollback-fingerprint.ts --compare <a.json> <b.json>
 *
 * Row content is hashed as `row::text` ordered by id, so a jsonb, timestamp or NULL difference is a
 * different hash. The output holds counts and digests only (no row values).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import postgres from 'postgres';

import { checkIsolatedTestDsn } from '@afldb/domain';

const LEDGERS = [
  { table: 'award_proposals', references: ['revision_of_id', 'created_by'] },
  { table: 'award_proposal_decisions', references: ['proposal_id', 'admin_user_id'] },
  { table: 'derived_award_results', references: ['supersedes_id', 'published_by'] },
  { table: 'brownlow_eligibility_decisions', references: ['supersedes_id', 'decided_by'] },
  { table: 'derived_award_projections', references: ['derived_award_result_id', 'projected_by'] },
] as const;
const MARKER = 'rb-pop';

type Digest = { rows: number; digest: string };
const digestOf = (rows: Digest[]): Digest => rows[0] ?? { rows: 0, digest: 'absent' };

async function fingerprint(): Promise<Record<string, unknown>> {
  const url = process.env.AFLDB_OWNER_DATABASE_URL ?? '';
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(url, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length > 0) {
    throw new Error('Refused: run through tools/v2/isolated-pg.ts against an isolated afldb_v2_*_test database');
  }
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
  try {
    const hash = async (query: string): Promise<Digest> => digestOf(await sql.unsafe(query) as unknown as Digest[]);
    const present = async (table: string) => (await sql.unsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`))[0].ok as boolean;
    const out: Record<string, unknown> = { database: new URL(url).pathname.slice(1) };
    const ledgers: Record<string, unknown> = {};
    for (const { table, references } of LEDGERS) {
      if (!(await present(table))) { ledgers[table] = { present: false }; continue; }
      const sequence = (await sql.unsafe(`SELECT pg_get_serial_sequence('public.${table}', 'id') AS name`))[0].name as string;
      const [state] = await sql.unsafe(`SELECT last_value::text AS last_value, is_called FROM ${sequence}`);
      const [max] = await sql.unsafe(`SELECT coalesce(max(id), 0)::text AS max FROM ${table}`);
      ledgers[table] = {
        present: true,
        content: await hash(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM ${table} t`),
        identity: await hash(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(t.id::text, ',' ORDER BY t.id), '')) AS digest FROM ${table} t`),
        relationships: await hash(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(concat_ws('/', t.id${references.map((r) => `, t.${r}`).join('')}), ',' ORDER BY t.id), '')) AS digest FROM ${table} t`),
        sequence: { name: sequence, lastValue: state.last_value, isCalled: state.is_called, maxId: max.max },
      };
    }
    out.ledgers = ledgers;

    const canonical: Record<string, Digest> = {};
    const q = async (name: string, query: string) => { canonical[name] = await hash(query); };
    await q('awards', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM awards t`);
    await q('award_winners', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM award_winners t`);
    await q('data_overrides_award_winners', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM data_overrides t WHERE entity_type = 'award_winners'`);
    await q('data_edits', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM data_edits t`);
    await q('auth_audit_log', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM auth_audit_log t`);
    // The local runtime check adds two sessioned fixture identities (local-release-*); they are reported apart so
    // a change to any other account, hash or credential is visible.
    await q('auth_users', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM auth_users t WHERE t.email NOT LIKE 'local-release-%@example.invalid'`);
    await q('auth_users_runtime_fixtures', `SELECT count(*)::int AS rows, 'n/a' AS digest FROM auth_users t WHERE t.email LIKE 'local-release-%@example.invalid'`);
    await q('brownlow_season_votes', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.season, t.player_id), '')) AS digest FROM brownlow_season_votes t`);
    await q('brownlow_round_votes', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM brownlow_round_votes t`);
    out.canonical = canonical;

    // Public results: the winner sets the public award and Brownlow queries read.
    const pub: Record<string, Digest> = {};
    const p = async (name: string, query: string) => { pub[name] = await hash(query); };
    await p('brownlow_winners', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(season || ':' || player_id, ',' ORDER BY season, player_id), '')) AS digest FROM brownlow_season_votes WHERE is_winner`);
    await p('synthetic_award_winners', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(w.id || ':' || a.slug || ':' || w.season || ':' || coalesce(w.player_id::text, '') || ':' || w.status || ':' || coalesce(w.votes::text, ''), ',' ORDER BY w.id), '')) AS digest
      FROM award_winners w JOIN awards a ON a.id = w.award_id WHERE a.slug LIKE '${MARKER}-%'`);
    await p('coleman_published_season', `SELECT count(*)::int AS rows, md5(coalesce(string_agg(w.id || ':' || w.season || ':' || coalesce(w.player_id::text, '') || ':' || w.status, ',' ORDER BY w.id), '')) AS digest
      FROM award_winners w JOIN awards a ON a.id = w.award_id WHERE a.slug = 'coleman' AND w.season >= 2095`);
    out.publicResults = pub;

    // Cross-references that cross the V2 / canonical boundary. A dropped ledger leaves them dangling.
    const refs: Record<string, unknown> = {};
    const r = async (name: string, query: string) => { refs[name] = (await sql.unsafe(query))[0]; };
    // Absent ledger: every curated link in data_edits dangles (resolvable 0).
    await r('data_edits_curated_proposal_links', `SELECT count(*)::int AS total, 0::int AS resolvable
        FROM data_edits WHERE new_values ? 'curated_proposal_id'`);
    if (await present('award_proposals')) {
      await r('data_edits_curated_proposal_links', `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM award_proposals p WHERE p.id = (e.new_values->>'curated_proposal_id')::bigint))::int AS resolvable
          FROM data_edits e WHERE e.new_values ? 'curated_proposal_id'`);
      await r('approved_proposals_to_overrides', `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_overrides o WHERE o.entity_type = 'award_winners' AND o.entity_key = p.approved_entity_key))::int AS resolvable
          FROM award_proposals p WHERE p.approved_entity_key IS NOT NULL`);
    }
    if (await present('derived_award_projections')) {
      await r('projection_actions_to_winners', `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM award_winners w WHERE w.id = (a->>'awardWinnerId')::bigint))::int AS resolvable
          FROM derived_award_projections d, jsonb_array_elements(d.actions) a`);
    }
    out.references = refs;
    return out;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Differences between two fingerprints; `ignore` names top-level sections to skip (e.g. a deliberate change). */
export function diff(a: unknown, b: unknown, path = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    // Two copies of the same state differ in database name only.
    if (path === '') keys.delete('database');
    return [...keys].flatMap((key) => diff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`));
  }
  return [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}

async function main(): Promise<void> {
  const [first, a, b] = process.argv.slice(2);
  if (first === '--compare') {
    const differences = diff(JSON.parse(readFileSync(a, 'utf8')), JSON.parse(readFileSync(b, 'utf8')));
    for (const line of differences) console.log(line);
    console.log(differences.length === 0 ? 'IDENTICAL' : `${differences.length} DIFFERENCES`);
    process.exitCode = differences.length === 0 ? 0 : 1;
    return;
  }
  if (!first) throw new Error('usage: rollback-fingerprint.ts <out.json> | --compare <a.json> <b.json>');
  const result = await fingerprint();
  writeFileSync(first, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`fingerprint written: ${first}`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; });
