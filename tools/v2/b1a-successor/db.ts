/**
 * AFLDB-ISSUE-366: the database side shared by the B1a successor tools. Every fingerprint expression lives here once, so
 * the BEFORE capture, the runner's pre-write check, the post-commit acceptance, recovery and the reversal guard can never
 * drift apart (packet 6R kept three hand-synchronised copies).
 *
 * Every line is computed as text in SQL, under explicit output settings, so its bytes do not depend on the session.
 */
import type postgres from 'postgres';

import {
  APP_NAME_PREFIX, LOCKED_TABLES, REPAIR_LOCK, REVERSE_APP_NAME_PREFIX, SEASON, CAPTURE_FORMAT, type DbLiveness,
} from './lib';

type Sql = postgres.Sql | postgres.TransactionSql;

/** Pins every setting that changes how a row or a value is rendered as text. Call inside the transaction. */
export async function pinOutputSettings(tx: postgres.TransactionSql) {
  await tx`SET LOCAL TimeZone = 'Etc/UTC'`;
  await tx`SET LOCAL DateStyle = 'ISO, YMD'`;
  await tx`SET LOCAL IntervalStyle = 'postgres'`;
  await tx`SET LOCAL extra_float_digits = 1`;
  await tx`SET LOCAL bytea_output = 'hex'`;
}

export interface Identity { db: string; oid: string; sysid: string; ro: string; iso: string; schema: string }
export async function readIdentity(tx: Sql): Promise<Identity> {
  const [id] = await tx<Identity[]>`
    SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid,
           current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS iso,
           coalesce(current_schema(), '') AS schema
      FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
  return id;
}

/** Count and md5 of whole-row JSON in bytewise order: identities, values and NULLs all count; an empty set is `0|-`. */
const contentFp = (label: string, from: string) =>
  `SELECT '${label}|' || count(*) || '|' || coalesce(md5(string_agg(t, E'\\n' ORDER BY t COLLATE "C")), '-') AS l
     FROM (SELECT to_jsonb(x)::text AS t FROM ${from}) q`;

/**
 * The v2 capture, in a fixed order. The packet 6R lines keep their packet 6R expressions (so a successor capture can be
 * read beside a historical one); `format`, `sitting`, `schema` and the five content fingerprints are new.
 */
export function captureStatements(sitting: string): string[] {
  const s = SEASON;
  return [
    `SELECT 'format|${CAPTURE_FORMAT}' AS l`,
    `SELECT 'sitting|' || ${quote(sitting)} AS l`,
    `SELECT 'identity|' || current_database() || '|' || d.oid || '|' || c.system_identifier AS l
       FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`,
    `SELECT 'schema|' || coalesce(current_schema(), '') AS l`,
    `SELECT 'pss2026|' || brownlow_status::text || '|' || count(*) || '|' || count(brownlow_votes) AS l
       FROM player_season_stats WHERE season = ${s} GROUP BY brownlow_status ORDER BY brownlow_status::text COLLATE "C"`,
    `SELECT 'ids2026|' || count(*) || '|' || coalesce(md5(string_agg(player_id::text, ',' ORDER BY player_id)), '-') AS l
       FROM player_season_stats WHERE season = ${s}`,
    `SELECT 'cov2026|' || stat_key || '|' || coverage::text || '|' || CASE WHEN is_recorded THEN 't' ELSE 'f' END || '|'
            || coalesce(populated_rows::text, '-') || '|' || coalesce(total_rows::text, '-') AS l
       FROM stat_availability WHERE season = ${s} AND stat_key LIKE 'brownlow%' ORDER BY stat_key COLLATE "C"`,
    `SELECT 'inputs2026|' || concat_ws('/',
       coalesce((SELECT status::text FROM seasons WHERE year = ${s}), 'none'),
       (SELECT count(*) FROM brownlow_season_votes WHERE season = ${s})::text,
       (SELECT count(*) FROM brownlow_round_votes WHERE season = ${s})::text,
       coalesce((SELECT string_agg(status || ':' || k, ',' ORDER BY status)
                   FROM (SELECT status::text AS status, count(*) AS k FROM brownlow_vote_entry_state WHERE season = ${s} GROUP BY 1) q), 'none'),
       (SELECT count(*) FROM brownlow_season_authority WHERE season = ${s} AND published_revision IS NOT NULL)::text) AS l`,
    `SELECT 'fp_pss_other(H1)|' || coalesce(md5(string_agg(p::text, E'\\n' ORDER BY p.season, p.player_id)), '-') AS l
       FROM player_season_stats p WHERE season <> ${s}`,
    `SELECT 'fp_pss2026_nonstatus(H2)|' || coalesce(md5(string_agg((to_jsonb(p) - 'brownlow_status')::text, E'\\n' ORDER BY p.player_id)), '-') AS l
       FROM player_season_stats p WHERE season = ${s}`,
    `SELECT 'fp_stat_availability(H3)|' || count(*) || '|' || coalesce(md5(string_agg(sa::text, E'\\n' ORDER BY sa.season, sa.stat_key)), '-') AS l
       FROM stat_availability sa`,
    `SELECT 'na_cov|' || count(*) FILTER (WHERE season >= 1924 AND season NOT BETWEEN 1942 AND 1945) || '|'
            || count(*) FILTER (WHERE season BETWEEN 1942 AND 1945) AS l
       FROM stat_availability WHERE stat_key LIKE 'brownlow%' AND coverage = 'not_applicable'`,
    `SELECT 'na_pss|' || count(*) FILTER (WHERE season >= 1924 AND season NOT BETWEEN 1942 AND 1945) || '|'
            || count(*) FILTER (WHERE season BETWEEN 1897 AND 1923 OR season BETWEEN 1942 AND 1945) AS l
       FROM player_season_stats WHERE brownlow_status = 'not_applicable'`,
    contentFp('fp_season2026', `seasons x WHERE x.year = ${s}`),
    contentFp('fp_medal2026', `brownlow_season_votes x WHERE x.season = ${s}`),
    contentFp('fp_authority2026', `brownlow_season_authority x WHERE x.season = ${s}`),
    contentFp('fp_entry2026', `brownlow_vote_entry_state x WHERE x.season = ${s}`),
    contentFp('fp_round2026', `brownlow_round_votes x WHERE x.season = ${s}`),
  ];
}

function quote(text: string) {
  if (!/^[0-9A-Za-z]+$/.test(text)) throw new Error('sitting must be alphanumeric');
  return `'${text}'`;
}

/** Runs the capture inside the caller's transaction (which must already have pinned its output settings). */
export async function captureLines(tx: postgres.TransactionSql, sitting: string): Promise<string[]> {
  const out: string[] = [];
  for (const statement of captureStatements(sitting)) {
    const rows = await tx.unsafe<{ l: string | null }[]>(statement);
    for (const r of rows) out.push(r.l ?? '<NULL>');
  }
  return out;
}

/** Takes the repair lock in this transaction; false when a repair or reversal transaction holds it. */
export async function tryRepairLock(tx: Sql): Promise<boolean> {
  const [r] = await tx<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${REPAIR_LOCK[0]}, ${REPAIR_LOCK[1]}) AS ok`;
  return r.ok;
}

/** The packet 6R lock statement, in the packet 6R order and mode. */
export const lockStatement = `LOCK TABLE ${LOCKED_TABLES.join(', ')} IN SHARE ROW EXCLUSIVE MODE`;

/**
 * Which B1a sessions are connected, and is the repair lock free? One short transaction of its own; the caller takes any
 * snapshot only after this one has ended (a snapshot taken by the statement that tests the lock could predate a commit).
 */
export async function readLiveness(sql: postgres.Sql, attempt: string): Promise<DbLiveness> {
  try {
    return await sql.begin('isolation level read committed read only', async (tx) => {
      const rows = await tx<{ app: string }[]>`
        SELECT application_name AS app FROM pg_stat_activity
         WHERE pid <> pg_backend_pid()
           AND (application_name LIKE ${`${APP_NAME_PREFIX}%`} OR application_name LIKE ${`${REVERSE_APP_NAME_PREFIX}%`}
                OR application_name = 'issue365-b1a-r6r')`;
      const lockFree = await tryRepairLock(tx);
      const mine = `${APP_NAME_PREFIX}${attempt}`;
      return {
        ok: true, sameAttempt: rows.filter((r) => r.app === mine).length,
        otherAttempts: rows.filter((r) => r.app !== mine).map((r) => r.app), lockFree,
      };
    });
  } catch (e) {
    return { ok: false, error: redact((e as Error).message), sameAttempt: 0, otherAttempts: [], lockFree: false };
  }
}

export const redact = (msg: string) => String(msg).replace(/postgres(ql)?:\/\/\S+/g, '<dsn>').slice(0, 300);
