// AFLDB-ISSUE-265 Phase A operator helper. READ-ONLY at every database step.
//
// Derived from D:\tmp\issue264\issue264-db-probe.mjs and issue264-window.mjs (copied, not
// modified): the same secret hygiene (connection strings come only from I265_* variables the
// runner sets, are never printed, every message is redacted) and the same derive / target /
// isolation logic. Every database query runs inside a READ ONLY transaction.
//
// Modes:
//   selftest   NO database contact. Exercises derive, the URL guards, redaction and the
//              retained-record reconciliation on synthetic inputs.
//   derive     NO database contact. Rewrites each source URL (I265_SRC_*) to the tunnel endpoint
//              and to afldb_test, keeping user, password and query; cross-checked against
//              postgres.js's own option parsing (no connection opened). JSON to stdout, refused
//              at a terminal.
//   targets    Every DSN names exactly afldb_test at the expected endpoint; every live session has
//              the intended role (current_user and session_user), is not in recovery, and all of
//              them reach ONE server (address, port, database oid, postmaster start time).
//   preflight  targets (owner) + isolation + migration state, written to I265_OUT_FILE.
//   isolation  No other session on afldb_test holds a transaction, a lock or a prepared transaction.
//   snapshot   Fixture residue (reserved season 2078 and every ISSUE-265 namespace, plus a
//              catalog-driven count of every single-column foreign key that points at one of them),
//              historical fingerprints (club_seasons and the other recompute-written tables WITH
//              their ids), and retained-record accounting. Without I265_BASELINE_FILE: a baseline,
//              refused if any residue exists. With it: a comparison, reconciled with the harness's
//              evidence file (I265_EVIDENCE_FILE) when present.
//
// Exit codes: 0 clean / OK, 3 refused or dirty, 2 error.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const mode = process.argv[2];
const env = process.env;

/* ------------------------------------------------------------------ *
 * Fixture namespace (tests/integration/settle-promotion-deadlock.test.ts §17.2)
 * ------------------------------------------------------------------ */

export const NS = {
  season: 2078,
  afltablesPrefix: 'issue265-',
  apiToken: '2078I265',
  slugPrefix: 'afldb-issue-265-',
  tag: 'AFLDB-ISSUE-265',
  fileName: 'AFLDB-ISSUE-265.csv',
  fixtureTool: 'issue265-settle-fixture',
  fixtureEmail: 'issue-265-deadlock-fixture@afldb.test',
  batchNoteLike: '%snapshot=issue265-%',
};
// None of these contains an unescaped `_`, so none is wider than it reads (`\_` escapes it).
const RECORD_LIKE = [`${NS.afltablesPrefix}%`, `%${NS.apiToken}%`, `${NS.season}|%`];
const ISSUE_LIKE = [`%${NS.afltablesPrefix}%`, `%${NS.apiToken}%`, `%${NS.tag} Home Club%`, `%${NS.tag} Away Club%`];
const SEASON_GATE_KEYS = ['afltables', 'afl_api'].map((s) => `${s}|apply|season|${NS.season}|seasons`);
const SLUG_LIKE = `${NS.slugPrefix}%`;
const RETAINED_TARGETS = ['match_results', 'player_match_stats'];

/** The namespace rows of each table a foreign key can point at (constant SQL, no input). */
const NS_PARENT_SETS = {
  seasons: `SELECT ${NS.season}::smallint`,
  matches: `SELECT id FROM matches WHERE season = ${NS.season} OR match_key LIKE '${NS.season}|%'`,
  players: `SELECT id FROM players WHERE slug LIKE '${SLUG_LIKE}'`,
  clubs: `SELECT id FROM clubs WHERE slug LIKE '${SLUG_LIKE}' OR legacy_club_hist LIKE '${SLUG_LIKE}'`,
  club_organizations: `SELECT id FROM club_organizations WHERE slug LIKE '${SLUG_LIKE}'`,
  venues: `SELECT id FROM venues WHERE slug LIKE '${SLUG_LIKE}'`,
  promotion_candidates: `SELECT id FROM promotion_candidates WHERE external_record_id LIKE ANY(ARRAY['${RECORD_LIKE.join("','")}'])`,
  data_submissions: `SELECT id FROM data_submissions WHERE filename = '${NS.fileName}'`,
};

const ROLE_KEYS = [
  { key: 'owner', dsnVar: 'I265_OWNER', roleVar: 'I265_EXPECT_OWNER' },
  { key: 'import', dsnVar: 'I265_IMPORT', roleVar: 'I265_EXPECT_IMPORT' },
  { key: 'auth', dsnVar: 'I265_AUTH', roleVar: 'I265_EXPECT_AUTH' },
];
const SOURCE_KEYS = [
  { key: 'owner', srcVar: 'I265_SRC_OWNER' },
  { key: 'import', srcVar: 'I265_SRC_IMPORT' },
  { key: 'auth', srcVar: 'I265_SRC_AUTH' },
];

/* ------------------------------------------------------------------ *
 * Secret hygiene
 * ------------------------------------------------------------------ */

const secrets = [];
function addSecret(value) {
  if (!value) return;
  secrets.push(value);
  const m = /^[a-z]+:\/\/[^:/@]+:([^@]+)@/i.exec(value);
  if (m && m[1].length >= 4) {
    secrets.push(m[1]);
    try { secrets.push(decodeURIComponent(m[1])); } catch { /* raw only */ }
  }
}
for (const name of [...ROLE_KEYS.map((r) => r.dsnVar), ...SOURCE_KEYS.map((s) => s.srcVar)]) addSecret(env[name]);
function redact(text) {
  let out = String(text);
  for (const s of secrets) if (s) out = out.split(s).join('[REDACTED]');
  return out;
}

class ProbeStop extends Error {
  constructor(message, code) { super(message ?? ''); this.code = code; }
}
function fail(message, code = 2) { throw new ProbeStop(message, code); }
function refuse(message) { throw new ProbeStop(message, 3); }
const log = (line) => console.log(redact(line));

let postgres;
const EXPECT_DB = 'afldb_test';

/* ------------------------------------------------------------------ *
 * URL guards (no database contact)
 * ------------------------------------------------------------------ */

// Query parameters libpq or postgres.js could read as a host, port, database or identity.
const TARGET_PARAMS = new Set([
  'host', 'hostaddr', 'hostname', 'port', 'path', 'dbname', 'database', 'db',
  'user', 'username', 'password', 'pass', 'service', 'passfile', 'options',
]);

export function parseTarget(key, raw, expectEndpoint) {
  if (!raw) fail(`${key}: connection setting is missing`);
  let url;
  try { url = new URL(raw); } catch { fail(`${key}: connection setting is not a valid URL`); }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') fail(`${key}: protocol is ${url.protocol}, expected postgres:`);
  const db = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (db !== EXPECT_DB) fail(`${key}: URL names database '${db}', expected '${EXPECT_DB}'`);
  if (!url.username) fail(`${key}: URL names no user`);
  if (!url.hostname || url.hostname.includes(',')) fail(`${key}: URL must name exactly one host`);
  for (const name of url.searchParams.keys()) {
    if (TARGET_PARAMS.has(name.toLowerCase())) fail(`${key}: URL query parameter '${name}' could override the target`);
  }
  const endpoint = `${url.hostname.toLowerCase()}:${url.port || '5432'}`;
  if (!expectEndpoint) fail('the expected endpoint is not set');
  if (endpoint !== expectEndpoint.toLowerCase()) fail(`${key}: URL endpoint is ${endpoint}, expected ${expectEndpoint}`);
  return { key, raw, urlUser: decodeURIComponent(url.username), endpoint };
}

export function tunnelEndpoint(hostText, portText) {
  const host = (hostText || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(host)) fail('the tunnel host must be a host name or IPv4 address');
  if (!/^\d{1,5}$/.test(portText || '') || Number(portText) < 1 || Number(portText) > 65535) {
    fail('the tunnel port must be an integer from 1 to 65535');
  }
  return { host, port: String(Number(portText)) };
}

export async function deriveOne(key, raw, tunnel) {
  let url;
  try { url = new URL(raw); } catch { fail(`${key}: source connection setting is not a valid URL`); }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') fail(`${key}: source protocol is ${url.protocol}, expected postgres:`);
  if (!url.username) fail(`${key}: source URL names no user`);
  if (!url.hostname) fail(`${key}: source URL names no host`);
  if (url.hostname.includes(',')) fail(`${key}: source URL is multi-host; refusing to rewrite it`);
  if (url.hash) fail(`${key}: source URL has a fragment; refusing to rewrite it`);
  for (const name of url.searchParams.keys()) {
    if (TARGET_PARAMS.has(name.toLowerCase())) fail(`${key}: source URL query parameter '${name}' could override the target; refusing`);
  }
  const { username, password, search } = url;
  url.hostname = tunnel.host;
  url.port = tunnel.port;
  url.pathname = `/${EXPECT_DB}`;
  if (url.hostname.toLowerCase() !== tunnel.host || url.port !== tunnel.port
      || url.pathname !== `/${EXPECT_DB}` || url.username !== username
      || url.password !== password || url.search !== search || url.hash) {
    fail(`${key}: rewritten URL did not keep the intended components`);
  }
  const derived = url.href;
  // Cross-check with the parser the suite actually uses. postgres.js connects only on a query.
  const sql = postgres(derived, { max: 1, onnotice: () => {} });
  try {
    const o = sql.options;
    const problems = [];
    if (o.host.length !== 1 || String(o.host[0]).toLowerCase() !== tunnel.host) problems.push('host');
    if (o.port.length !== 1 || o.port[0] !== Number(tunnel.port)) problems.push('port');
    if (o.path) problems.push('socket path');
    if (o.database !== EXPECT_DB) problems.push('database');
    if (o.user !== decodeURIComponent(username)) problems.push('user');
    if (password && o.pass !== decodeURIComponent(password)) problems.push('password');
    if (problems.length) fail(`${key}: postgres.js reads the derived URL differently (${problems.join(', ')})`);
  } finally {
    await sql.end({ timeout: 0 });
  }
  return { derived, user: decodeURIComponent(username) };
}

async function derive() {
  if (process.stdout.isTTY) fail('derive writes connection strings to stdout; it must be captured, not run at a terminal');
  const tunnel = tunnelEndpoint(env.I265_TUNNEL_HOST, env.I265_TUNNEL_PORT);
  const out = {};
  for (const { key, srcVar } of SOURCE_KEYS) {
    const raw = env[srcVar];
    if (!raw) fail(`${key}: source connection setting is missing (${srcVar})`);
    const { derived, user } = await deriveOne(key, raw, tunnel);
    out[key] = derived;
    process.stderr.write(`  derived ${key.padEnd(6)} user=${user} -> ${tunnel.host}:${tunnel.port}/${EXPECT_DB}\n`);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function connect(raw, label) {
  return postgres(raw, {
    max: 1, connect_timeout: 20, idle_timeout: 5, onnotice: () => {},
    connection: { application_name: `afldb-issue-265-probe ${label}`.slice(0, 63) },
  });
}

async function readOnly(sql, fn, timeout = '120s') {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    await tx`SELECT set_config('statement_timeout', ${timeout}, true)`;
    await tx`SET LOCAL jit = off`;
    const [ro] = await tx`SELECT current_setting('transaction_read_only') AS ro`;
    if (ro.ro !== 'on') fail('the probe transaction is not read only');
    return fn(tx);
  });
}

/* ------------------------------------------------------------------ *
 * targets
 * ------------------------------------------------------------------ */

async function liveIdentity(tx) {
  const [row] = await tx`
    SELECT current_user::text AS role, session_user::text AS session_role,
           current_database()::text AS db, inet_server_addr()::text AS addr,
           inet_server_port() AS port, pg_is_in_recovery() AS recovery,
           (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS db_oid,
           pg_postmaster_start_time()::text AS postmaster_start
  `;
  return { ...row };
}

async function targets(keys = ROLE_KEYS.map((r) => r.key)) {
  const expectEndpoint = env.I265_EXPECT_ENDPOINT || '';
  const wanted = ROLE_KEYS.filter(({ key }) => keys.includes(key));
  const parsed = wanted.map(({ key, dsnVar }) => parseTarget(key, env[dsnVar], expectEndpoint));
  const report = [];
  for (const { key, roleVar } of wanted) {
    const target = parsed.find((p) => p.key === key);
    const expectedRole = env[roleVar];
    if (!expectedRole) fail(`${key}: expected role (${roleVar}) is not set`);
    const sql = connect(target.raw, `targets ${key}`);
    try {
      const row = await readOnly(sql, (tx) => liveIdentity(tx), '30s');
      report.push({ key, expectedRole, urlUser: target.urlUser, endpoint: target.endpoint, ...row });
    } catch (e) {
      if (e instanceof ProbeStop) throw e;
      fail(`${key}: live probe failed: ${e.message}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
  const problems = [];
  for (const r of report) {
    if (r.db !== EXPECT_DB) problems.push(`${r.key}: live database is '${r.db}'`);
    if (r.role !== r.expectedRole) problems.push(`${r.key}: live role is '${r.role}', expected '${r.expectedRole}'`);
    if (r.session_role !== r.expectedRole) problems.push(`${r.key}: session role is '${r.session_role}', expected '${r.expectedRole}'`);
    if (r.recovery) problems.push(`${r.key}: server is in recovery`);
  }
  const servers = new Set(report.map((r) => `${r.addr}:${r.port} db-oid ${r.db_oid} up ${r.postmaster_start}`));
  if (servers.size !== 1) problems.push(`live sessions reached different servers: ${[...servers].join(' | ')}`);
  for (const r of report) {
    log(`  ${r.key.padEnd(6)} role=${r.role} db=${r.db} url-endpoint=${r.endpoint} server=${r.addr}:${r.port} db-oid=${r.db_oid} up=${r.postmaster_start}`);
  }
  if (problems.length) {
    for (const p of problems) log(`  REFUSED: ${p}`);
    refuse('target proof failed; nothing was written');
  }
  log(`  TARGETS OK: ${report.length} connection(s), each ${EXPECT_DB} at ${expectEndpoint}, intended roles, one server.`);
  return report;
}

/* ------------------------------------------------------------------ *
 * isolation and migration state (issue264-window.mjs, reduced to read-only)
 * ------------------------------------------------------------------ */

async function proveIsolation(tx, dbOid) {
  const sessions = await tx`
    SELECT pid::int AS pid, usename::text AS usename, application_name::text AS app,
           state::text AS state, xact_start::text AS "xactStart", backend_type::text AS "backendType"
      FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()
     ORDER BY pid
  `;
  const locks = await tx`
    SELECT l.pid::int AS pid, l.locktype::text AS locktype, l.mode::text AS mode,
           l.granted AS granted, coalesce(c.relname::text, '-') AS relation
      FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation
     WHERE l.pid <> pg_backend_pid()
       AND l.locktype <> 'virtualxid'
       AND (l.database = ${dbOid}::oid
            OR l.pid IN (SELECT pid FROM pg_stat_activity WHERE datname = current_database()))
     ORDER BY l.pid
  `;
  const prepared = await tx`SELECT gid::text AS gid FROM pg_prepared_xacts WHERE database = current_database()`;
  const problems = [];
  log(`  isolation  other sessions on ${EXPECT_DB}: ${sessions.length}`);
  for (const s of sessions) {
    log(`    session pid=${s.pid} user=${s.usename} app='${s.app}' state=${s.state} xact=${s.xactStart ?? '-'} type=${s.backendType}`);
    if (s.state === null) problems.push(`session ${s.pid} is not observable (insufficient privilege)`);
    else if (s.state !== 'idle') problems.push(`session ${s.pid} is ${s.state}`);
    if (s.xactStart) problems.push(`session ${s.pid} has an open transaction`);
  }
  for (const l of locks) {
    log(`    lock pid=${l.pid} ${l.locktype} ${l.mode} granted=${l.granted} relation=${l.relation}`);
    problems.push(`session ${l.pid} holds or awaits a ${l.locktype} lock (${l.relation})`);
  }
  for (const p of prepared) problems.push(`prepared transaction ${p.gid} is open`);
  if (problems.length) {
    for (const p of problems) log(`  REFUSED: ${p}`);
    refuse('isolation cannot be proved; nothing was written');
  }
  log(`  ISOLATION OK: no other session holds a transaction or lock on ${EXPECT_DB}.`);
}

const MIG_110 = '110_match_sheet_player_match_stats_authority.sql';

export function migrationVerdict(files, applied, checkAdmitsPms) {
  const appliedSet = new Set(applied);
  const pending = files.filter((f) => !appliedSet.has(f));
  const orphans = applied.filter((n) => !files.includes(n));
  const problems = [];
  if (orphans.length) problems.push(`the ledger names migrations this tree does not have: ${orphans.join(', ')}`);
  const otherPending = pending.filter((f) => f !== MIG_110);
  if (otherPending.length) problems.push(`migrations other than 110 are pending: ${otherPending.join(', ')}`);
  const has110 = appliedSet.has(MIG_110);
  if (checkAdmitsPms === null) problems.push('the data_overrides entity_type CHECK cannot be read unambiguously');
  else if (checkAdmitsPms !== has110) {
    problems.push(`the CHECK ${checkAdmitsPms ? 'admits' : 'does not admit'} player_match_stats but migration 110 is ${has110 ? 'applied' : 'not applied'}`);
  }
  return { state: has110 ? 'B (110 applied)' : 'A (110 not applied)', pending, orphans, problems };
}

async function migrationState(tx, root) {
  const ledger = await tx`SELECT name FROM afldb_meta.schema_migrations ORDER BY name`;
  const checks = await tx`
    SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
     WHERE c.conrelid = 'public.data_overrides'::regclass AND c.conname = 'data_overrides_entity_type_check'
  `;
  const [authority] = await tx`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active)::int AS active
      FROM data_overrides WHERE entity_type = 'player_match_stats'
  `;
  const files = readdirSync(join(root, 'src', 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const admits = checks.length === 1 ? [...checks[0].def.matchAll(/'([^']*)'/g)].map((m) => m[1]).includes('player_match_stats') : null;
  const verdict = migrationVerdict(files, ledger.map((r) => r.name), admits);
  log(`  migrations: ${ledger.length} applied, ${files.length} in the tree; pending [${verdict.pending.join(', ') || 'none'}]; State ${verdict.state}`);
  log(`  player_match_stats authority rows (any season): ${authority.total} (active ${authority.active}); informational — the reserved season has none (census)`);
  log('  Phase A does not need migration 110: no file it runs writes or reads a player_match_stats override of 2078,');
  log('  and manual-authority.ts / datasets.ts answer it identically in State A and State B (runbook §17.10).');
  if (verdict.problems.length) {
    for (const p of verdict.problems) log(`  REFUSED: ${p}`);
    refuse('the migration state does not match this tree; nothing was written');
  }
  return { applied: ledger.length, files: files.length, ...verdict, authority: { ...authority } };
}

async function modePreflight(root) {
  await targets(['owner']);
  const owner = parseTarget('owner', env.I265_OWNER, env.I265_EXPECT_ENDPOINT);
  const sql = connect(owner.raw, 'preflight');
  try {
    const capture = await readOnly(sql, async (tx) => {
      const where = await liveIdentity(tx);
      await proveIsolation(tx, where.db_oid);
      const migrations = await migrationState(tx, root);
      const settings = await tx`
        SELECT name, setting, unit FROM pg_settings
         WHERE name IN ('deadlock_timeout', 'lock_timeout', 'statement_timeout', 'max_connections', 'server_version')
         ORDER BY name
      `;
      for (const s of settings) log(`  setting ${s.name} = ${s.setting}${s.unit ? ` ${s.unit}` : ''}`);
      // Review F-001: A1 step 5 must fit the promotion's 5 s hook bound with every settle statement
      // crossing this link. Recorded so a budget miss is explainable; it does not gate the run.
      const rtt = [];
      for (let i = 0; i < 10; i += 1) {
        const t0 = process.hrtime.bigint();
        await tx`SELECT 1`;
        rtt.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      rtt.sort((a, b) => a - b);
      const roundTrip = { medianMs: Number(((rtt[4] + rtt[5]) / 2).toFixed(1)), maxMs: Number(rtt[9].toFixed(1)) };
      log(`  round trip (10 x SELECT 1): median ${roundTrip.medianMs} ms, max ${roundTrip.maxMs} ms`);
      return { takenAt: new Date().toISOString(), where, migrations, settings: settings.map((s) => ({ ...s })), roundTrip };
    });
    if (env.I265_OUT_FILE) writeFileSync(env.I265_OUT_FILE, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function modeIsolation() {
  const owner = parseTarget('owner', env.I265_OWNER, env.I265_EXPECT_ENDPOINT);
  const sql = connect(owner.raw, 'isolation');
  try {
    await readOnly(sql, async (tx) => {
      const where = await liveIdentity(tx);
      if (where.db !== EXPECT_DB || where.role !== env.I265_EXPECT_OWNER) refuse('isolation probe is not the owner on afldb_test');
      await proveIsolation(tx, where.db_oid);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* ------------------------------------------------------------------ *
 * snapshot: residue, fingerprints, retained accounting
 * ------------------------------------------------------------------ */

const hashOf = (rowExpr, from, where) => `
  SELECT count(*)::text AS n, coalesce(sum(hashtextextended(${rowExpr}, 0)), 0)::text AS h FROM ${from} WHERE ${where}`;
const notNs = (pred) => `NOT coalesce(${pred}, false)`;
const recLike = `ARRAY['${RECORD_LIKE.join("','")}']`;
const issueLike = `ARRAY['${ISSUE_LIKE.join("','")}']`;
const gateKeys = `ARRAY['${SEASON_GATE_KEYS.join("','")}']`;
const synth = `(SELECT id FROM players WHERE slug LIKE '${SLUG_LIKE}')`;
const S = NS.season;

/** Historical rows: everything outside the reserved season and the namespaces. Constant SQL only. */
export const FINGERPRINTS = [
  ['matches', hashOf('t::text', 'matches t', `t.season IS DISTINCT FROM ${S}`)],
  ['match_period_scores', hashOf('t::text', 'match_period_scores t JOIN matches m ON m.id = t.match_id', `m.season IS DISTINCT FROM ${S}`)],
  ['player_match_stats', hashOf('t::text', 'player_match_stats t JOIN matches m ON m.id = t.match_id', `m.season IS DISTINCT FROM ${S}`)],
  ['players', hashOf('t::text', 'players t', notNs(`t.slug LIKE '${SLUG_LIKE}'`))],
  ['external_identities', hashOf('t::text', 'external_identities t', notNs(`t.external_id LIKE '%${NS.apiToken}%' OR t.external_id LIKE '${NS.afltablesPrefix}%'`))],
  ['seasons', hashOf('t::text', 'seasons t', `t.year IS DISTINCT FROM ${S}`)],
  ['clubs', hashOf('t::text', 'clubs t', notNs(`t.slug LIKE '${SLUG_LIKE}'`))],
  ['club_organizations', hashOf('t::text', 'club_organizations t', notNs(`t.slug LIKE '${SLUG_LIKE}'`))],
  ['venues', hashOf('t::text', 'venues t', notNs(`t.slug LIKE '${SLUG_LIKE}'`))],
  // Recompute-written: WITH ids (nothing in Phase A may re-issue a historical id), and without.
  ['club_seasons_with_ids', hashOf('t::text', 'club_seasons t', `t.season IS DISTINCT FROM ${S}`)],
  ['club_seasons_values', hashOf("(to_jsonb(t) - 'id')::text", 'club_seasons t', `t.season IS DISTINCT FROM ${S}`)],
  ['player_clubs_with_ids', hashOf('t::text', 'player_clubs t', `t.player_id NOT IN ${synth}`)],
  ['player_career_stats_with_ids', hashOf('t::text', 'player_career_stats t', `t.player_id NOT IN ${synth}`)],
  ['player_season_stats_with_ids', hashOf('t::text', 'player_season_stats t', `t.season IS DISTINCT FROM ${S} AND t.player_id NOT IN ${synth}`)],
  ['player_club_season_stats_with_ids', hashOf('t::text', 'player_club_season_stats t', `t.season IS DISTINCT FROM ${S} AND t.player_id NOT IN ${synth}`)],
  ['stat_availability', hashOf('t::text', 'stat_availability t', `t.season IS DISTINCT FROM ${S}`)],
  ['brownlow_round_votes', hashOf('t::text', 'brownlow_round_votes t', `t.season IS DISTINCT FROM ${S}`)],
  ['data_overrides', hashOf('t::text', 'data_overrides t', notNs(`t.entity_key LIKE '${S}|%' OR t.entity_key LIKE '${NS.afltablesPrefix}%'`))],
  ['data_edits', hashOf('t::text', 'data_edits t', 'true')],
  // Findings and ledgers (a settle resolves findings by key; the ledger cites spine versions).
  ['data_issues', hashOf('t::text', 'data_issues t', notNs(`t.issue_key LIKE ANY(${issueLike}) OR t.issue_key = ANY(${gateKeys})`))],
  ['canonical_applications', hashOf('t::text', 'canonical_applications t', notNs(`t.external_record_id LIKE ANY(${recLike}) OR t.target_key->>'match_key' LIKE '${S}|%'`))],
  ['promotion_candidates', hashOf('t::text', 'promotion_candidates t', notNs(`t.external_record_id LIKE ANY(${recLike})`))],
  ['promotion_decisions', hashOf('t::text', 'promotion_decisions t', `t.candidate_id NOT IN (${NS_PARENT_SETS.promotion_candidates})`)],
  ['import_rejections', hashOf('t::text', 'import_rejections t', notNs(`t.source_record_id LIKE ANY(${recLike})`))],
  // The observation spine and typed projections (the absence sweep and observation store update heads).
  ['staging.source_records', hashOf('t::text', 'staging.source_records t', notNs(`t.external_record_id LIKE ANY(${recLike})`))],
  ['staging.source_record_versions', hashOf('t::text', 'staging.source_record_versions t', notNs(`t.external_record_id LIKE ANY(${recLike})`))],
  ['staging.source_payloads_keys', hashOf("t.source_id::text || '|' || t.family || '|' || t.payload_hash::text", 'staging.source_payloads t',
    notNs(`t.raw_payload->>'issue265_fixture' IS NOT NULL OR t.raw_payload::text LIKE '%${NS.apiToken}%'`))],
  ['staging.afltables_match', hashOf('t::text', 'staging.afltables_match t', `t.season IS DISTINCT FROM ${S}`)],
  ['staging.afltables_player_match', hashOf('t::text', 'staging.afltables_player_match t', `t.season IS DISTINCT FROM ${S}`)],
  ['staging.afl_api_match', hashOf('t::text', 'staging.afl_api_match t', `t.season IS DISTINCT FROM ${S}`)],
  ['staging.afl_api_player_match', hashOf('t::text', 'staging.afl_api_player_match t', `t.season IS DISTINCT FROM ${S}`)],
  ['staging.afl_api_lineup', hashOf('t::text', 'staging.afl_api_lineup t', `t.season IS DISTINCT FROM ${S}`)],
  ['staging.afl_api_brownlow_vote', hashOf('t::text', 'staging.afl_api_brownlow_vote t', `t.season IS DISTINCT FROM ${S}`)],
  // Intake, users, sources (the retained rows are accounted separately below).
  ['data_submissions', hashOf('t::text', 'data_submissions t', `t.filename IS DISTINCT FROM '${NS.fileName}'`)],
  ['data_submission_rows', hashOf('t::text', 'data_submission_rows t JOIN data_submissions s ON s.id = t.submission_id', `s.filename IS DISTINCT FROM '${NS.fileName}'`)],
  ['sources', hashOf('t::text', 'sources t', "t.key <> 'sports_data_lab'")],
  ['auth_users', hashOf('t::text', 'auth_users t', `t.email IS DISTINCT FROM '${NS.fixtureEmail}'`)],
];

/** Namespace rows that must not exist (before the run) or remain (after it). Constant SQL only. */
export const RESIDUE = [
  ['matches', `SELECT count(*) FROM matches WHERE season = ${S} OR match_key LIKE '${S}|%'`],
  ['seasons', `SELECT count(*) FROM seasons WHERE year = ${S}`],
  ['players', `SELECT count(*) FROM players WHERE slug LIKE '${SLUG_LIKE}' OR display_name LIKE '${NS.tag}%'`],
  ['clubs', `SELECT count(*) FROM clubs WHERE slug LIKE '${SLUG_LIKE}' OR legacy_club_hist LIKE '${SLUG_LIKE}' OR name LIKE '${NS.tag}%'`],
  ['club_organizations', `SELECT count(*) FROM club_organizations WHERE slug LIKE '${SLUG_LIKE}' OR name LIKE '${NS.tag}%'`],
  ['venues', `SELECT count(*) FROM venues WHERE slug LIKE '${SLUG_LIKE}' OR canonical_name LIKE '${NS.tag}%' OR legacy_name LIKE '${NS.tag}%'`],
  ['external_identities', `SELECT count(*) FROM external_identities WHERE external_id LIKE '%${NS.apiToken}%' OR external_id LIKE '${NS.afltablesPrefix}%'`],
  ['data_overrides', `SELECT count(*) FROM data_overrides WHERE entity_key LIKE '${S}|%' OR entity_key LIKE '${NS.afltablesPrefix}%'`],
  ['data_issues', `SELECT count(*) FROM data_issues WHERE issue_key LIKE ANY(${issueLike}) OR issue_key = ANY(${gateKeys})`],
  ['canonical_applications', `SELECT count(*) FROM canonical_applications WHERE external_record_id LIKE ANY(${recLike}) OR target_key->>'match_key' LIKE '${S}|%'`],
  ['promotion_candidates', `SELECT count(*) FROM promotion_candidates WHERE external_record_id LIKE ANY(${recLike})`],
  ['import_rejections', `SELECT count(*) FROM import_rejections WHERE source_record_id LIKE ANY(${recLike})`],
  ['staging.source_records', `SELECT count(*) FROM staging.source_records WHERE external_record_id LIKE ANY(${recLike})`],
  ['staging.source_record_versions', `SELECT count(*) FROM staging.source_record_versions WHERE external_record_id LIKE ANY(${recLike})`],
  ['staging.source_payloads', `SELECT count(*) FROM staging.source_payloads WHERE raw_payload->>'issue265_fixture' IS NOT NULL OR raw_payload::text LIKE '%${NS.apiToken}%'`],
  ['staging.afl_api_match (provider id)', `SELECT count(*) FROM staging.afl_api_match WHERE external_record_id LIKE '%${NS.apiToken}%'`],
  ['staging.afl_api_player_match (provider id)', `SELECT count(*) FROM staging.afl_api_player_match WHERE provider_match_id LIKE '%${NS.apiToken}%'`],
  ['data_submissions', `SELECT count(*) FROM data_submissions WHERE filename = '${NS.fileName}'`],
  ['import_batches (settle and fixture)', `SELECT count(*) FROM import_batches WHERE tool = '${NS.fixtureTool}' OR notes LIKE '${NS.batchNoteLike}'`],
];

async function fkCensus(tx) {
  const fks = await tx`
    SELECT c.conname::text AS conname, c.conrelid::regclass::text AS child,
           regexp_replace(c.confrelid::regclass::text, '^public\\.', '') AS parent,
           quote_ident(ca.attname) AS col, array_length(c.conkey, 1) AS width
      FROM pg_constraint c
      JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND regexp_replace(c.confrelid::regclass::text, '^public\\.', '') = ANY(${Object.keys(NS_PARENT_SETS)}::text[])
     ORDER BY 2, 1
  `;
  const out = { counted: 0, composite: [], nonZero: [] };
  for (const fk of fks) {
    if (fk.width !== 1) { out.composite.push(`${fk.child}.${fk.conname}`); continue; }
    // child comes from regclass::text (already quoted where needed); col from quote_ident.
    const [row] = await tx.unsafe(`SELECT count(*)::int AS n FROM ${fk.child} x WHERE x.${fk.col} IN (${NS_PARENT_SETS[fk.parent]})`);
    out.counted += 1;
    if (row.n !== 0) out.nonZero.push({ fk: `${fk.child}.${fk.col} -> ${fk.parent}`, n: row.n });
  }
  return out;
}

export function reconcileRetained({ newBatches, evidence, fixtureUsers, sportsDataLab, liveSubmissionIds, expectRetained }) {
  const problems = [];
  const notes = [];
  const evidenceIds = evidence ? new Set(evidence.retainedPromotionBatches.map((b) => String(b.batchId))) : null;
  for (const b of newBatches) {
    const m = /^submission (\d+)$/.exec(b.notes ?? '');
    const shapeOk = b.tool === 'admin-upload' && RETAINED_TARGETS.includes(b.target_table) && m !== null;
    const submissionGone = m !== null && !liveSubmissionIds.includes(Number(m[1]));
    if (!shapeOk) { problems.push(`new import_batches id ${b.id} (${b.tool}/${b.target_table}) is not a retained promotion batch`); continue; }
    if (!submissionGone) { problems.push(`new import_batches id ${b.id} cites submission ${m[1]}, which still exists`); continue; }
    if (evidenceIds === null) { problems.push(`new import_batches id ${b.id} is unattributed: no harness evidence file to reconcile with`); continue; }
    if (!evidenceIds.has(String(b.id))) { problems.push(`new import_batches id ${b.id} is not in the harness's retained list`); continue; }
    notes.push(`retained import_batches id ${b.id} ${b.target_table} (submission ${m[1]}, deleted): explained`);
  }
  if (evidenceIds) {
    for (const id of evidenceIds) {
      if (!newBatches.some((b) => String(b.id) === id)) problems.push(`the harness lists retained batch ${id}, which is not new since the baseline`);
    }
  }
  if (expectRetained !== null && newBatches.length !== expectRetained) {
    problems.push(`expected exactly ${expectRetained} retained promotion batch(es), found ${newBatches.length}`);
  }
  if (fixtureUsers !== 1) problems.push(`fixture auth user rows: ${fixtureUsers}, expected exactly 1 (retained)`);
  if (sportsDataLab !== 1) problems.push(`sources 'sports_data_lab' rows: ${sportsDataLab}, expected exactly 1 (retained)`);
  return { problems, notes };
}

async function snapshot() {
  const owner = parseTarget('owner', env.I265_OWNER, env.I265_EXPECT_ENDPOINT);
  const baselineFile = env.I265_BASELINE_FILE || null;
  const baseline = baselineFile ? JSON.parse(readFileSync(baselineFile, 'utf8')) : null;
  const ceiling = baseline ? baseline.batches.maxId : null;
  const sql = connect(owner.raw, 'snapshot');
  let result;
  try {
    result = await readOnly(sql, async (tx) => {
      const where = await liveIdentity(tx);
      if (where.db !== EXPECT_DB || where.role !== env.I265_EXPECT_OWNER) refuse('snapshot is not the owner on afldb_test');
      const fingerprints = {};
      for (const [label, text] of FINGERPRINTS) {
        const [row] = await tx.unsafe(text);
        fingerprints[label] = { n: row.n, h: row.h };
      }
      const [batchRow] = await tx`SELECT coalesce(max(id), 0)::text AS "maxId" FROM import_batches`;
      fingerprints.import_batches = await (async () => {
        const [row] = ceiling === null
          ? await tx`SELECT count(*)::text AS n, coalesce(sum(hashtextextended(t::text, 0)), 0)::text AS h FROM import_batches t`
          : await tx`SELECT count(*)::text AS n, coalesce(sum(hashtextextended(t::text, 0)), 0)::text AS h FROM import_batches t WHERE t.id <= ${ceiling}::bigint`;
        return { n: row.n, h: row.h };
      })();
      const residue = {};
      for (const [label, text] of RESIDUE) {
        const [row] = await tx.unsafe(`SELECT (${text})::int AS n`);
        residue[label] = row.n;
      }
      const fk = await fkCensus(tx);
      const [retained] = await tx`
        SELECT (SELECT count(*) FROM auth_users WHERE email = ${NS.fixtureEmail})::int AS fixture_users,
               (SELECT count(*) FROM sources WHERE key = 'sports_data_lab')::int AS sports_data_lab
      `;
      const newBatches = ceiling === null ? [] : (await tx`
        SELECT id::text AS id, tool, target_table, notes FROM import_batches WHERE id > ${ceiling}::bigint ORDER BY id
      `).map((r) => ({ ...r }));
      const liveSubmissionIds = (await tx`SELECT id::int AS id FROM data_submissions WHERE id = ANY(${newBatches
        .map((b) => /^submission (\d+)$/.exec(b.notes ?? '')).filter(Boolean).map((m) => Number(m[1]))}::int[])`).map((r) => r.id);
      return {
        takenAt: new Date().toISOString(), where, fingerprints, residue, fkCensus: fk,
        retained: { ...retained }, batches: { maxId: batchRow.maxId, newSinceBaseline: newBatches }, liveSubmissionIds,
      };
    }, '900s');
  } catch (e) {
    if (e instanceof ProbeStop) throw e;
    fail(`snapshot failed: ${e.message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const residueNonZero = Object.entries(result.residue).filter(([, n]) => n !== 0);
  for (const [k, n] of Object.entries(result.residue)) log(`  residue  ${k.padEnd(44)} ${n}`);
  log(`  foreign keys into a namespace row: ${result.fkCensus.counted} single-column checked, ${result.fkCensus.nonZero.length} non-zero`);
  for (const z of result.fkCensus.nonZero) log(`    RESIDUE via ${z.fk}: ${z.n}`);
  if (result.fkCensus.composite.length) log(`    composite (not counted; listed for review): ${result.fkCensus.composite.join(', ')}`);
  log(`  retained fixture auth user rows ${result.retained.fixture_users}; sports_data_lab sources ${result.retained.sports_data_lab}`);
  log(`  import_batches max id ${result.batches.maxId}`);

  const outFile = env.I265_OUT_FILE;
  if (outFile) writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  if (!baseline) {
    for (const [t, v] of Object.entries(result.fingerprints)) log(`  baseline ${t.padEnd(36)} rows=${v.n}`);
    if (residueNonZero.length || result.fkCensus.nonZero.length) {
      log('  DIRTY: ISSUE-265 fixture residue exists BEFORE the run (collision); nothing may be written.');
      refuse('baseline refused');
    }
    log('  BASELINE OK: no residue in season 2078 or any ISSUE-265 namespace.');
    return;
  }

  const changed = [];
  for (const [t, v] of Object.entries(baseline.fingerprints)) {
    const now = result.fingerprints[t];
    if (!now || now.n !== v.n || now.h !== v.h) changed.push(`${t} (rows ${v.n} -> ${now ? now.n : 'missing'}${now && now.n === v.n ? ', content changed' : ''})`);
  }
  let evidence = null;
  const evidenceFile = env.I265_EVIDENCE_FILE;
  if (evidenceFile && existsSync(evidenceFile)) evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
  const expectRetained = env.I265_EXPECT_RETAINED ? Number(env.I265_EXPECT_RETAINED) : null;
  const reconciliation = reconcileRetained({
    newBatches: result.batches.newSinceBaseline, evidence, fixtureUsers: result.retained.fixture_users,
    sportsDataLab: result.retained.sports_data_lab, liveSubmissionIds: result.liveSubmissionIds, expectRetained,
  });
  log(`  harness evidence file: ${evidence ? `read (${evidence.retainedPromotionBatches.length} retained batch(es); fixture user pre-existed=${evidence.fixtureUser?.preexisted}; sports_data_lab seeded by this run=${evidence.sportsDataLabSource?.seededByThisRun})` : 'ABSENT'}`);
  if (evidence) {
    log(`  harness teardown problems: ${evidence.teardownProblems?.length ?? 'n/a'}; harness residue: ${JSON.stringify(evidence.residue)}; harness fingerprints equal: ${evidence.fingerprintsEqual}`);
  }
  for (const n of reconciliation.notes) log(`  ${n}`);
  if (changed.length || residueNonZero.length || result.fkCensus.nonZero.length || reconciliation.problems.length) {
    for (const c of changed) log(`  CHANGED historical rows: ${c}`);
    for (const [k, n] of residueNonZero) log(`  RESIDUE: ${k} = ${n}`);
    for (const p of reconciliation.problems) log(`  UNEXPLAINED: ${p}`);
    log('  DIRTY');
    refuse('census is not clean');
  }
  log('  CLEAN: historical fingerprints equal the baseline; no residue; every retained row accounted for.');
}

/* ------------------------------------------------------------------ *
 * selftest (no database contact)
 * ------------------------------------------------------------------ */

async function selftest() {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push([name, true, '']); } catch (e) { results.push([name, false, e.message]); }
  };
  const throwsWith = async (name, fn, pattern) => {
    try { await fn(); results.push([name, false, 'did not throw']); } catch (e) {
      results.push([name, pattern.test(e.message), e.message]);
    }
  };
  const fakePw = 'not-a-real-secret-123';
  const fake = `postgres://afldb_owner:${fakePw}@db.example.invalid:5432/afldb_dev?sslmode=disable`;
  addSecret(fake);
  const tunnel = tunnelEndpoint('127.0.0.1', '55432');
  const { derived } = await deriveOne('owner', fake, tunnel);
  check('derive rewrites host, port and database only', () => {
    const u = new URL(derived);
    if (u.hostname !== '127.0.0.1' || u.port !== '55432' || u.pathname !== '/afldb_test' || u.username !== 'afldb_owner'
        || u.password !== fakePw || u.search !== '?sslmode=disable') throw new Error('components differ');
  });
  check('parseTarget accepts the derived URL at its endpoint', () => parseTarget('owner', derived, '127.0.0.1:55432'));
  await throwsWith('parseTarget refuses a _test suffix that is not afldb_test',
    () => parseTarget('owner', derived.replace('/afldb_test', '/code_test_db_test'), '127.0.0.1:55432'), /expected 'afldb_test'/);
  await throwsWith('parseTarget refuses another endpoint', () => parseTarget('owner', derived, '127.0.0.1:5432'), /endpoint/);
  await throwsWith('parseTarget refuses a host override parameter',
    () => parseTarget('owner', `${derived}&host=prod.example.invalid`, '127.0.0.1:55432'), /could override/);
  await throwsWith('deriveOne refuses a dbname override parameter',
    () => deriveOne('owner', `${fake}&dbname=afldb_prod`, tunnel), /could override/);
  await throwsWith('deriveOne refuses a multi-host URL',
    () => deriveOne('owner', fake.replace('db.example.invalid:5432', 'a.invalid:1,b.invalid:2'), tunnel), /multi-host|not a valid URL/);
  check('redaction removes a registered URL and its password', () => {
    // At run time the derived URLs arrive as I265_OWNER/IMPORT/AUTH and are registered at start-up.
    addSecret(derived);
    const text = redact(`failed for ${derived} with ${fakePw} and ${encodeURIComponent(fakePw)}`);
    if (text.includes(fakePw) || text.includes(derived) || !text.includes('[REDACTED]')) throw new Error(text);
  });
  check('migration verdict: State A with only 110 pending is accepted', () => {
    const v = migrationVerdict(['108_a.sql', '109_b.sql', MIG_110], ['108_a.sql', '109_b.sql'], false);
    if (v.problems.length || !v.state.startsWith('A')) throw new Error(JSON.stringify(v));
  });
  check('migration verdict: State B is accepted', () => {
    const v = migrationVerdict(['109_b.sql', MIG_110], ['109_b.sql', MIG_110], true);
    if (v.problems.length || !v.state.startsWith('B')) throw new Error(JSON.stringify(v));
  });
  check('migration verdict: another pending migration is refused', () => {
    const v = migrationVerdict(['109_b.sql', MIG_110, '111_c.sql'], ['109_b.sql'], false);
    if (!v.problems.some((p) => /111_c/.test(p))) throw new Error(JSON.stringify(v));
  });
  check('migration verdict: CHECK/ledger disagreement is refused', () => {
    const v = migrationVerdict(['109_b.sql', MIG_110], ['109_b.sql'], true);
    if (!v.problems.length) throw new Error('accepted');
  });
  const evidence = { retainedPromotionBatches: [{ batchId: '901' }, { batchId: '902' }, { batchId: '903' }] };
  const batches = [
    { id: '901', tool: 'admin-upload', target_table: 'match_results', notes: 'submission 11' },
    { id: '902', tool: 'admin-upload', target_table: 'player_match_stats', notes: 'submission 12' },
    { id: '903', tool: 'admin-upload', target_table: 'player_match_stats', notes: 'submission 13' },
  ];
  check('reconcile: three explained batches, user and source retained', () => {
    const r = reconcileRetained({ newBatches: batches, evidence, fixtureUsers: 1, sportsDataLab: 1, liveSubmissionIds: [], expectRetained: 3 });
    if (r.problems.length) throw new Error(r.problems.join('; '));
  });
  check('reconcile: a settle batch left behind is unexplained', () => {
    const r = reconcileRetained({ newBatches: [...batches, { id: '904', tool: 'settle-afl-api.ts', target_table: 'staging.source_record_versions', notes: 'x' }], evidence, fixtureUsers: 1, sportsDataLab: 1, liveSubmissionIds: [], expectRetained: 3 });
    if (!r.problems.some((p) => /904/.test(p))) throw new Error('accepted');
  });
  check('reconcile: a batch whose submission still exists is unexplained', () => {
    const r = reconcileRetained({ newBatches: batches, evidence, fixtureUsers: 1, sportsDataLab: 1, liveSubmissionIds: [12], expectRetained: 3 });
    if (!r.problems.some((p) => /submission 12/.test(p))) throw new Error('accepted');
  });
  check('reconcile: no evidence file leaves every new batch unattributed', () => {
    const r = reconcileRetained({ newBatches: batches, evidence: null, fixtureUsers: 1, sportsDataLab: 1, liveSubmissionIds: [], expectRetained: 3 });
    if (r.problems.length !== 3) throw new Error(r.problems.join('; '));
  });
  check('reconcile: a second fixture user is refused', () => {
    const r = reconcileRetained({ newBatches: batches, evidence, fixtureUsers: 2, sportsDataLab: 1, liveSubmissionIds: [], expectRetained: 3 });
    if (!r.problems.some((p) => /auth user/.test(p))) throw new Error('accepted');
  });
  check('constant SQL carries no unescaped LIKE underscore in a namespace token', () => {
    for (const token of [NS.afltablesPrefix, NS.apiToken, NS.slugPrefix, NS.tag]) if (token.includes('_')) throw new Error(token);
  });
  check('every fingerprint and residue query is constant text', () => {
    for (const [, text] of [...FINGERPRINTS, ...RESIDUE]) if (/\$\{|undefined|NaN/.test(text)) throw new Error(text);
  });
  check('club_seasons is fingerprinted with its ids', () => {
    if (!FINGERPRINTS.some(([label, text]) => label === 'club_seasons_with_ids' && /hashtextextended\(t::text/.test(text))) throw new Error('missing');
  });
  let failed = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `: ${redact(detail)}`}`);
  }
  console.log(`  selftest: ${results.length - failed}/${results.length} passed`);
  if (failed) refuse('selftest failed');
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

try {
  const root = env.I265_ROOT;
  if (!root) fail('I265_ROOT is not set');
  try {
    postgres = createRequire(join(root, 'package.json'))('postgres');
  } catch (e) {
    fail(`cannot load postgres from ${root}: ${e.message}`);
  }
  if ((env.I265_EXPECT_DB ?? EXPECT_DB) !== EXPECT_DB) fail('I265_EXPECT_DB must be exactly afldb_test');

  if (mode === 'selftest') await selftest();
  else if (mode === 'derive') await derive();
  else if (mode === 'targets') await targets();
  else if (mode === 'preflight') await modePreflight(root);
  else if (mode === 'isolation') await modeIsolation();
  else if (mode === 'snapshot') await snapshot();
  else fail(`unknown mode '${mode}'`);
  process.exitCode = 0;
} catch (e) {
  if (e instanceof ProbeStop) {
    if (e.message) process.stderr.write(`PROBE ${e.code === 3 ? 'REFUSED' : 'ERROR'}: ${redact(e.message)}\n`);
    process.exitCode = e.code;
  } else {
    process.stderr.write(`PROBE ERROR: ${redact(e && e.message ? e.message : String(e))}\n`);
    process.exitCode = 2;
  }
}
