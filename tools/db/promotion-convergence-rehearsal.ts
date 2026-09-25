/**
 * AFLDB-ISSUE-242 — the code_test_db rehearsal of the step-2c manual identity convergence.
 *
 *     AFLDB_CODE_TEST_DATABASE_URL=<afldb_owner DSN naming code_test_db> \
 *       npx tsx --conditions=react-server tools/db/promotion-convergence-rehearsal.ts \
 *         run --acknowledge code_test_db --out <evidence dir> [--scale 92]
 *     ... residue
 *     ... teardown --acknowledge code_test_db
 *
 * WHAT IT PROVES. PostgreSQL executes the file `--phase restored` publishes for plan step 2c:
 * the real `gateOverrideReplayTargets` plans the convergence from real reads, the real
 * `lineageRemapSql` writes the file, and `psql -X -v ON_ERROR_STOP=1 -f` runs it, as step 2c
 * does. Nothing here re-implements the convergence. The file carries no lineage plans (this
 * rehearsal reinstates no lineage-bound table); its convergence section is byte-for-byte what
 * the generator emits for the same entries inside a real remap file.
 *
 * THE TARGET. DEV is never contacted. The target the plan reads is the schema
 * `issue242_rehearsal_target` inside code_test_db: its own `sources`, `external_identities` and
 * `data_overrides`, read through a connection whose search_path is that schema only, so the
 * checker's own target SQL runs unchanged. Plan step 2a (the target's data_overrides replacing
 * the candidate's) is simulated for the fixture rows only.
 *
 * ISOLATION. code_test_db must hold no manual_admin_edit identity and no replayable
 * data_overrides row outside the fixture, no rebuild marker, no fixture residue and no other
 * session; otherwise it refuses before any write. The step-2c assertions are global over
 * `public`, so this is what keeps them about the fixture alone.
 *
 * NAMESPACE. Player slugs `issue242-rehearsal-…`, AFL Tables paths `players/Z/Zz242_…`, tokens
 * `2420cccc-…` (candidate) and `2420dddd-…` (target), the schema above, and one
 * attribution-only actor. Every world is torn down before the next, and the run ends with a
 * zero-residue proof. Target: code_test_db ONLY. No DSN is printed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import postgres, { type Sql, type TransactionSql } from 'postgres';

import { resolveRehearsalDsns } from '../migration/afl_api_identity_rebuild_rehearsal_fixture';
import {
  insertAttributionOnlyActor,
  readLiveRegistrationState,
  REGISTRATION_PROFILE_PATH_RE,
  registrationsFromLive,
} from '../migration/rebuild_manual_registrations';
import type { Row } from './catalog-fingerprint';
import { gateOverrideReplayTargets, readRebuildMarkerPresent, Report, type Query } from './promotion-check';
import { lineageRemapSql, type ManualIdentityConvergenceEntry } from './promotion-inventory';
import { redact } from './psql';

export class ConvergenceRehearsalRefused extends Error {}

export const CONVERGENCE_REHEARSAL = {
  database: 'code_test_db',
  targetSchema: 'issue242_rehearsal_target',
  slugPrefix: 'issue242-rehearsal-',
  pathPrefix: 'players/Z/Zz242_',
  candidateTokenPrefix: '2420cccc-',
  targetTokenPrefix: '2420dddd-',
  /** Both token prefixes share it, so one prefix finds every fixture creation record. */
  recordKeyPrefix: 'manual_admin_edit:2420',
  note: 'AFLDB-ISSUE-242 rehearsal fixture',
  actorEmail: 'issue242-rehearsal-fixture@example.test',
  actorRole: 'super_admin',
  defaultScale: 92,
} as const;

// ---------------------------------------------------------------------------
// The fixture (pure)
// ---------------------------------------------------------------------------

type PathSpec = { path: string; status?: 'unique' | 'ambiguous' };
/** A candidate player: the paths it holds, its token, and whether its own creation record exists. */
export type CandidateSpec = { key: string; paths: PathSpec[]; token: string | null; record: boolean };
/** A target player. Target ids are synthetic and never leave the target read. */
export type TargetSpec = { key: string; paths: PathSpec[]; token: string | null };
/** A target creation record `manual_admin_edit:<token>` naming `path`. */
export type RecordSpec = { token: string; path: string | null };
export type World = { name: string; candidate: CandidateSpec[]; target: TargetSpec[]; records: RecordSpec[] };

/** A UUID-shaped token in the fixture namespace: `2420cccc-00CC-4000-8000-NNNNNNNNNNNN`. */
export function rehearsalToken(side: 'candidate' | 'target', caseNo: number, n: number): string {
  const prefix = side === 'candidate' ? CONVERGENCE_REHEARSAL.candidateTokenPrefix : CONVERGENCE_REHEARSAL.targetTokenPrefix;
  return `${prefix}${String(caseNo).padStart(4, '0')}-4000-8000-${String(n).padStart(12, '0')}`;
}

export function rehearsalPath(caseKey: string, n: number): string {
  return `${CONVERGENCE_REHEARSAL.pathPrefix}${caseKey}_${n}.html`;
}

/**
 * The scale world: `n` registrations, a deterministic mixture -- every third retires (the target
 * holds the path with no registration), the rest rebind (the target registered the same path
 * under its own token). Nothing depends on a particular `n`.
 */
export function scaleWorld(n: number, caseNo = 20): World {
  const world: World = { name: `scale-${n}`, candidate: [], target: [], records: [] };
  for (let i = 1; i <= n; i += 1) {
    const path = rehearsalPath('S', i);
    const key = `s${i}`;
    world.candidate.push({ key, paths: [{ path }], token: rehearsalToken('candidate', caseNo, i), record: true });
    if (i % 3 === 0) {
      world.target.push({ key, paths: [{ path }], token: null });
    } else {
      const token = rehearsalToken('target', caseNo, i);
      world.target.push({ key, paths: [{ path }], token });
      world.records.push({ token, path });
    }
  }
  return world;
}

/** Every fixture identity string is inside the namespace and every path is a valid profile path. */
export function worldNamespaceProblems(world: World): string[] {
  const f = CONVERGENCE_REHEARSAL;
  const problems: string[] = [];
  const paths = [...world.candidate, ...world.target].flatMap((p) => p.paths.map((x) => x.path))
    .concat(world.records.flatMap((r) => (r.path === null ? [] : [r.path])));
  for (const p of paths) {
    if (!p.startsWith(f.pathPrefix) || !REGISTRATION_PROFILE_PATH_RE.test(p)) problems.push(`path ${p} is outside the fixture namespace`);
  }
  const tokens = [...world.candidate, ...world.target].flatMap((p) => (p.token === null ? [] : [p.token]))
    .concat(world.records.map((r) => r.token));
  for (const t of tokens) {
    if (!t.startsWith(f.candidateTokenPrefix) && !t.startsWith(f.targetTokenPrefix)) problems.push(`token ${t} is outside the fixture namespace`);
  }
  return problems;
}

export type RehearsalCommand =
  | { step: 'run'; out: string; scale: number }
  | { step: 'residue' }
  | { step: 'teardown' };

export function parseConvergenceRehearsalArgs(argv: readonly string[]): RehearsalCommand {
  const [step, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new ConvergenceRehearsalRefused(`Unrecognised argument ${rest[i]}.`);
    flags.set(rest[i], rest[i + 1]);
  }
  const known = new Set(['--acknowledge', '--out', '--scale']);
  for (const k of flags.keys()) if (!known.has(k)) throw new ConvergenceRehearsalRefused(`Unknown flag ${k}.`);
  if (step === 'residue') return { step };
  if (step !== 'run' && step !== 'teardown') throw new ConvergenceRehearsalRefused('Usage: run | residue | teardown.');
  if (flags.get('--acknowledge') !== CONVERGENCE_REHEARSAL.database) {
    throw new ConvergenceRehearsalRefused(`${step} writes to ${CONVERGENCE_REHEARSAL.database}: pass --acknowledge ${CONVERGENCE_REHEARSAL.database}.`);
  }
  if (step === 'teardown') return { step };
  const out = flags.get('--out');
  if (!out) throw new ConvergenceRehearsalRefused('run needs --out <evidence dir> for the generated step-2c files.');
  const scale = flags.has('--scale') ? Number(flags.get('--scale')) : CONVERGENCE_REHEARSAL.defaultScale;
  if (!Number.isInteger(scale) || scale < 1 || scale > 9999) throw new ConvergenceRehearsalRefused('--scale must be an integer 1..9999.');
  return { step, out, scale };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const f = CONVERGENCE_REHEARSAL;
type Tx = TransactionSql;

function connect(dsn: string, searchPath?: string): Sql {
  return postgres(dsn, {
    // No prepared-statement cache: the target schema is dropped and re-created between worlds.
    max: 1, prepare: false, onnotice: () => {},
    connection: { application_name: 'afldb-issue242-convergence-rehearsal', ...(searchPath ? { search_path: searchPath } : {}) },
  });
}

function queryOf(sql: Sql): Query {
  return (text, params) => sql.unsafe(text, (params ?? []) as never[]).then((rows) => rows as unknown as Row[]);
}

async function assertDatabase(tx: Tx | Sql): Promise<void> {
  const [{ d }] = await tx<{ d: string }[]>`SELECT current_database() AS d`;
  if (d !== f.database) throw new ConvergenceRehearsalRefused(`Connected to '${d}', not '${f.database}'; nothing was written.`);
}

export type Residue = {
  players: number; identities: number; records: number; actors: number; targetSchema: number; dataEdits: number;
};

async function readResidue(sql: Sql): Promise<Residue> {
  const [row] = await sql<Residue[]>`
    SELECT
      (SELECT count(*)::int FROM players WHERE starts_with(slug, ${f.slugPrefix})) AS players,
      (SELECT count(*)::int FROM external_identities
        WHERE starts_with(external_id, ${f.pathPrefix}) OR starts_with(external_id, ${f.candidateTokenPrefix})
           OR starts_with(external_id, ${f.targetTokenPrefix})) AS identities,
      (SELECT count(*)::int FROM data_overrides WHERE starts_with(entity_key, ${f.recordKeyPrefix})
           OR override_values->>'notes' LIKE ${`${f.note}%`}) AS records,
      (SELECT count(*)::int FROM auth_users WHERE lower(email) = ${f.actorEmail}) AS actors,
      (SELECT count(*)::int FROM pg_namespace WHERE nspname = ${f.targetSchema}) AS "targetSchema",
      (SELECT count(*)::int FROM data_edits
        WHERE admin_user_id IN (SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail})) AS "dataEdits"
  `;
  return row;
}

const residueTotal = (r: Residue): number => Object.values(r).reduce((s, n) => s + n, 0);

type Preflight = { database: string; user: string; readOnly: string; pg: string };

/** Identity, write-capability and isolation, before any write. Refuses on any doubt. */
async function preflight(sql: Sql): Promise<Preflight> {
  const identity = await sql.begin(async (tx) => {
    const [row] = await tx<Preflight[]>`
      SELECT current_database() AS database, current_user AS "user",
             current_setting('transaction_read_only') AS "readOnly", current_setting('server_version') AS pg
    `;
    return row;
  }) as Preflight;
  const problems: string[] = [];
  if (identity.database !== f.database) problems.push(`connected to '${identity.database}', not '${f.database}'`);
  if (identity.readOnly !== 'off') problems.push(`transaction_read_only = ${identity.readOnly}`);
  const residue = await readResidue(sql);
  if (residueTotal(residue) !== 0) problems.push(`fixture residue already present ${JSON.stringify(residue)}: run teardown first`);
  const [iso] = await sql<{ manual: number; replayable: number; others: number }[]>`
    SELECT
      (SELECT count(*)::int FROM external_identities e JOIN sources s ON s.id = e.source_id
        WHERE s.key = 'manual_admin_edit') AS manual,
      (SELECT count(*)::int FROM data_overrides WHERE entity_type IN ('players', 'matches', 'match_coaches')) AS replayable,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()) AS others
  `;
  if (iso.manual !== 0) problems.push(`${iso.manual} manual_admin_edit identit(ies) outside the fixture: the step-2c global assertions would not be about the fixture alone`);
  if (iso.replayable !== 0) problems.push(`${iso.replayable} replayable data_overrides row(s) outside the fixture`);
  if (iso.others !== 0) problems.push(`${iso.others} other session(s) on ${f.database}`);
  if (await readRebuildMarkerPresent(queryOf(sql))) problems.push('a rebuild marker is present');
  if (problems.length > 0) throw new ConvergenceRehearsalRefused(`Preflight refused; nothing was written: ${problems.join('; ')}.`);
  return identity;
}

const TARGET_DDL = `
  CREATE SCHEMA ${f.targetSchema};
  CREATE TABLE ${f.targetSchema}.sources (id smallint PRIMARY KEY, key text NOT NULL UNIQUE);
  CREATE TABLE ${f.targetSchema}.external_identities (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id smallint NOT NULL REFERENCES ${f.targetSchema}.sources (id),
    external_id text NOT NULL, player_id integer, status public.link_status NOT NULL, match_method text,
    UNIQUE (source_id, external_id));
  CREATE TABLE ${f.targetSchema}.data_overrides (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type text NOT NULL, entity_key text NOT NULL, field_group text NOT NULL,
    override_values jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_key, field_group));
  INSERT INTO ${f.targetSchema}.sources (id, key) VALUES (1, 'afltables'), (2, 'manual_admin_edit');
`;

function payload(side: 'candidate' | 'target', key: string, path: string | null): string {
  return JSON.stringify({
    display_name: `Issue242 Rehearsal ${key}`, given_name: 'Issue242', surname: `Rehearsal ${key}`,
    notes: `${f.note}: ${side} creation record`, afltables_profile_path: path,
  });
}

/** Seed one world: the simulated target schema and the candidate rows in public. Returns key -> candidate player id. */
async function seedWorld(sql: Sql, world: World, actorId: number): Promise<Map<string, number>> {
  const problems = worldNamespaceProblems(world);
  if (problems.length > 0) throw new ConvergenceRehearsalRefused(`World ${world.name}: ${problems.join('; ')}`);
  return await sql.begin(async (tx) => {
    await assertDatabase(tx);
    await tx.unsafe(TARGET_DDL);
    const t = f.targetSchema;
    for (const [i, p] of world.target.entries()) {
      for (const x of p.paths) {
        await tx.unsafe(`INSERT INTO ${t}.external_identities (source_id, external_id, player_id, status, match_method)
                         VALUES (1, $1, $2, $3, 'afltables_profile_url')`, [x.path, i + 1, x.status ?? 'unique']);
      }
      if (p.token !== null) {
        await tx.unsafe(`INSERT INTO ${t}.external_identities (source_id, external_id, player_id, status, match_method)
                         VALUES (2, $1, $2, 'resolved', 'manual_admin_edit')`, [p.token, i + 1]);
      }
    }
    for (const r of world.records) {
      await tx.unsafe(`INSERT INTO ${t}.data_overrides (entity_type, entity_key, field_group, override_values)
                       VALUES ('players', $1, 'identity', $2::text::jsonb)`, [`manual_admin_edit:${r.token}`, payload('target', r.token.slice(-4), r.path)]);
    }
    const ids = new Map<string, number>();
    for (const c of world.candidate) {
      const display = `Issue242 Rehearsal ${world.name} ${c.key}`;
      const [{ id }] = await tx<{ id: number }[]>`
        INSERT INTO players (display_name, sort_name, search_name, slug)
        VALUES (${display}, ${`Rehearsal ${c.key}, Issue242`}, ${display.toLowerCase()}, ${`${f.slugPrefix}${world.name}-${c.key}`})
        RETURNING id
      `;
      ids.set(c.key, id);
      for (const x of c.paths) {
        const status = x.status ?? 'unique';
        await tx`
          INSERT INTO external_identities (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
          VALUES ((SELECT id FROM sources WHERE key = 'afltables'), ${x.path}, ${display}, ${id}, ${status}::link_status,
                  ${status === 'unique' ? 1 : 2}, 'afltables_profile_url', ${f.note})
        `;
      }
      if (c.token !== null) {
        // As createPlayerInTransaction writes it.
        await tx`
          INSERT INTO external_identities (source_id, external_id, external_name, external_url, player_id, status, candidate_count, match_method, notes)
          VALUES ((SELECT id FROM sources WHERE key = 'manual_admin_edit'), ${c.token}, ${display}, NULL, ${id},
                  'resolved', 0, 'manual_admin_edit', ${f.note})
        `;
        if (c.record) {
          await tx`
            INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
            VALUES ('players', ${`manual_admin_edit:${c.token}`}, 'identity',
                    ${payload('candidate', c.key, c.paths[0]?.path ?? null)}::text::jsonb, ${actorId}, true, now())
          `;
        }
      }
    }
    // A creation record must be a jsonb OBJECT: a JS string bound as jsonb is double-encoded.
    const [{ bad }] = await tx.unsafe(`SELECT (SELECT count(*) FROM ${t}.data_overrides WHERE jsonb_typeof(override_values) <> 'object')
      + (SELECT count(*) FROM public.data_overrides WHERE starts_with(entity_key, $1) AND jsonb_typeof(override_values) <> 'object') AS bad`,
    [f.recordKeyPrefix]);
    if (Number(bad) !== 0) throw new ConvergenceRehearsalRefused(`World ${world.name}: ${String(bad)} seeded creation record(s) are not jsonb objects.`);
    return ids;
  }) as Map<string, number>;
}

/** Plan step 2a for the fixture only: the target's creation records replace the candidate's, verbatim. */
async function reinstateTargetOverrides(sql: Sql, actorId: number): Promise<number> {
  return await sql.begin(async (tx) => {
    await assertDatabase(tx);
    await tx`DELETE FROM data_overrides WHERE entity_type = 'players' AND starts_with(entity_key, ${f.recordKeyPrefix})`;
    const inserted = await tx.unsafe(`
      INSERT INTO public.data_overrides (entity_type, entity_key, field_group, override_values, is_active, admin_user_id, created_at, updated_at)
      SELECT entity_type, entity_key, field_group, override_values, is_active, $1, created_at, updated_at
        FROM ${f.targetSchema}.data_overrides ORDER BY id`, [actorId]);
    return inserted.count;
  }) as number;
}

/** Tear one world down (the actor survives until the final teardown). */
async function teardownWorld(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await assertDatabase(tx);
    await tx`
      DELETE FROM external_identities
       WHERE starts_with(external_id, ${f.pathPrefix}) OR starts_with(external_id, ${f.candidateTokenPrefix})
          OR starts_with(external_id, ${f.targetTokenPrefix})
    `;
    await tx`DELETE FROM data_overrides WHERE starts_with(entity_key, ${f.recordKeyPrefix}) OR override_values->>'notes' LIKE ${`${f.note}%`}`;
    await tx`DELETE FROM players WHERE starts_with(slug, ${f.slugPrefix})`;
    await tx.unsafe(`DROP SCHEMA IF EXISTS ${f.targetSchema} CASCADE`);
  });
}

async function teardownAll(sql: Sql): Promise<Residue> {
  await teardownWorld(sql);
  await sql.begin(async (tx) => {
    await assertDatabase(tx);
    await tx`DELETE FROM auth_users WHERE lower(email) = ${f.actorEmail}`;
  });
  return readResidue(sql);
}

/** Every fixture row that the convergence or a refusal could touch, as one hashable text. */
async function census(sql: Sql): Promise<{ text: string; sha256: string }> {
  const identities = await sql`
    SELECT s.key, e.external_id, e.player_id, e.status::text AS status, e.match_method, e.external_name, e.notes
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE starts_with(e.external_id, ${f.pathPrefix}) OR starts_with(e.external_id, ${f.candidateTokenPrefix})
        OR starts_with(e.external_id, ${f.targetTokenPrefix})
     ORDER BY s.key, e.external_id
  `;
  const records = await sql`
    SELECT entity_type, entity_key, field_group, is_active, override_values::text AS v, admin_user_id,
           created_at::text AS c, updated_at::text AS u
      FROM data_overrides WHERE starts_with(entity_key, ${f.recordKeyPrefix}) ORDER BY entity_key, field_group
  `;
  const players = await sql`SELECT id, slug FROM players WHERE starts_with(slug, ${f.slugPrefix}) ORDER BY id`;
  const text = JSON.stringify({ identities, records, players });
  return { text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}

type Global = { orphanTokens: number; multiTokenPlayers: number; duplicatePaths: number; recordsWithoutToken: number; manualTokens: number };

/** The final-state invariants over the whole database (which preflight proved holds only fixture registrations). */
async function globalInvariants(sql: Sql): Promise<Global> {
  const [row] = await sql<Global[]>`
    SELECT
      (SELECT count(*)::int FROM external_identities e JOIN sources s ON s.id = e.source_id WHERE s.key = 'manual_admin_edit'
          AND (SELECT count(*) FROM data_overrides o WHERE o.is_active AND o.entity_type = 'players' AND o.field_group = 'identity'
                 AND o.entity_key = 'manual_admin_edit:' || e.external_id) <> 1) AS "orphanTokens",
      (SELECT count(*)::int FROM (SELECT e.player_id FROM external_identities e JOIN sources s ON s.id = e.source_id
          WHERE s.key = 'manual_admin_edit' AND e.player_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x) AS "multiTokenPlayers",
      (SELECT count(*)::int FROM (SELECT e.external_id FROM external_identities e JOIN sources s ON s.id = e.source_id
          WHERE s.key = 'afltables' AND starts_with(e.external_id, ${f.pathPrefix}) GROUP BY 1 HAVING count(*) > 1) x) AS "duplicatePaths",
      (SELECT count(*)::int FROM data_overrides o WHERE o.is_active AND o.entity_type = 'players'
          AND split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
          AND NOT EXISTS (SELECT 1 FROM external_identities e JOIN sources s ON s.id = e.source_id
                           WHERE s.key = 'manual_admin_edit' AND 'manual_admin_edit:' || e.external_id = o.entity_key)) AS "recordsWithoutToken",
      (SELECT count(*)::int FROM external_identities e JOIN sources s ON s.id = e.source_id WHERE s.key = 'manual_admin_edit') AS "manualTokens"
  `;
  return row;
}

type IdentityRow = { key: string; externalId: string; playerId: number | null; status: string; matchMethod: string | null; notes: string | null };

async function rowsNamed(sql: Sql, externalId: string): Promise<IdentityRow[]> {
  return await sql<IdentityRow[]>`
    SELECT s.key, e.external_id AS "externalId", e.player_id AS "playerId", e.status::text AS status,
           e.match_method AS "matchMethod", e.notes
      FROM external_identities e JOIN sources s ON s.id = e.source_id WHERE e.external_id = ${externalId} ORDER BY s.key
  `;
}

async function manualTokensOf(sql: Sql, playerId: number): Promise<string[]> {
  return (await sql<{ t: string }[]>`
    SELECT e.external_id AS t FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'manual_admin_edit' AND e.player_id = ${playerId} ORDER BY 1
  `).map((r) => r.t);
}

async function recordText(sql: Sql, schema: 'public' | 'target', token: string): Promise<string | null> {
  const relation = schema === 'public' ? 'public.data_overrides' : `${f.targetSchema}.data_overrides`;
  const rows = await sql.unsafe(`SELECT override_values::text AS v FROM ${relation}
    WHERE is_active AND entity_type = 'players' AND field_group = 'identity' AND entity_key = $1`, [`manual_admin_edit:${token}`]);
  return rows.length === 1 ? String(rows[0].v) : rows.length === 0 ? null : `<${rows.length} rows>`;
}

async function playerExists(sql: Sql, id: number): Promise<boolean> {
  return (await sql`SELECT 1 FROM players WHERE id = ${id}`).length === 1;
}

type LiveRegistrations = { tokens: string[]; problems: string[]; byToken: Map<string, { playerId: number; path: string | null }> };

async function liveRegistrations(sql: Sql): Promise<LiveRegistrations> {
  return await sql.begin('read only', async (tx) => {
    const live = registrationsFromLive(await readLiveRegistrationState(tx));
    return {
      tokens: live.registrations.map((r) => r.token),
      problems: live.problems,
      byToken: new Map(live.registrations.map((r) => [r.token, { playerId: r.playerId, path: r.afltablesProfilePath }])),
    };
  }) as LiveRegistrations;
}

type TokenReader = (tx: Tx, playerId: number) => Promise<string | null>;

async function manualPlayerToken(sql: Sql, read: TokenReader, playerId: number): Promise<string | null> {
  return await sql.begin('read only', (tx) => read(tx, playerId)) as string | null;
}

// ---------------------------------------------------------------------------
// The step-2c file and its execution
// ---------------------------------------------------------------------------

type Planned = { report: Report; entries: ManualIdentityConvergenceEntry[]; convergence: string; a42: string; failed: boolean; problems: string[] };

const verdictOf = (report: Report, fragment: string): string =>
  report.results.find((r) => r.gate.includes(fragment))?.verdict ?? 'ABSENT';

/** --phase restored's A4.2 path: target overrides and identities from the target schema, candidate from public. */
async function planRestored(cand: Sql, target: Sql): Promise<Planned> {
  const report = new Report();
  const result = await gateOverrideReplayTargets(
    { overrides: queryOf(target), candidate: queryOf(cand) },
    { overrides: `simulated target (schema ${f.targetSchema})`, candidate: `candidate ${f.database}` },
    report,
    { target: queryOf(target), role: `simulated target (schema ${f.targetSchema})` },
  );
  return {
    report, entries: result.convergence.entries, problems: result.convergence.problems,
    convergence: verdictOf(report, 'AFLDB-ISSUE-242'), a42: verdictOf(report, 'A4.2'), failed: report.failed,
  };
}

/** --phase candidate's A4.2: the reinstated overrides and the converged identities, both from the candidate. Plans nothing. */
async function checkCandidate(cand: Sql): Promise<{ a42: string; failed: boolean; convergence: string }> {
  const report = new Report();
  await gateOverrideReplayTargets(
    { overrides: queryOf(cand), candidate: queryOf(cand) },
    { overrides: `candidate ${f.database} (the target's reinstated data_overrides)`, candidate: `candidate ${f.database}` },
    report,
  );
  return { a42: verdictOf(report, 'A4.2'), failed: report.failed, convergence: verdictOf(report, 'AFLDB-ISSUE-242') };
}

type Artefact = { file: string; sha256: string; text: string };

function writeArtefact(out: string, name: string, entries: readonly ManualIdentityConvergenceEntry[]): Artefact {
  const text = lineageRemapSql({ candidate: f.database, oldDatabase: `simulated-target(${f.targetSchema})`, plans: [], convergence: entries });
  const file = join(out, `${name}.step2c.sql`);
  writeFileSync(file, text, 'utf8');
  return { file, text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}

type Execution = { status: number | null; stdout: string; stderr: string };

/** Step 2c as the plan runs it: psql -f the file, under ON_ERROR_STOP unless told otherwise. */
function execute(dsn: string, file: string, onErrorStop = true): Execution {
  const args = ['-X', ...(onErrorStop ? ['-v', 'ON_ERROR_STOP=1'] : []), '-d', dsn, '-f', file];
  const r = spawnSync('psql', args, { encoding: 'utf8', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
  if (r.error) throw new ConvergenceRehearsalRefused(`psql did not start: ${redact(r.error.message)}`);
  return { status: r.status, stdout: redact(r.stdout ?? ''), stderr: redact(r.stderr ?? '') };
}

const tags = (stdout: string): string[] => stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(BEGIN|COMMIT|ROLLBACK|DO|INSERT \d+ \d+|DELETE \d+)$/.test(l));
const tagSummary = (stdout: string): string => {
  const counts = new Map<string, number>();
  for (const t of tags(stdout)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => (n === 1 ? t : `${t} x${n}`)).join(', ');
};

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

type Check = { world: string; label: string; ok: boolean; detail: string };

class Checks {
  readonly all: Check[] = [];
  constructor(private world = '') {}
  in(world: string): this { this.world = world; console.log(`\n=== ${world}`); return this; }
  that(label: string, ok: boolean, detail = ''): void {
    this.all.push({ world: this.world, label, ok, detail });
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  }
  note(text: string): void { console.log(`  ${text}`); }
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

type Ctx = { dsn: string; cand: Sql; target: Sql; actorId: number; out: string; checks: Checks; readToken: TokenReader };

/** Seed a world, then hand the body the ids; the world is always torn down and its residue proven zero. */
async function inWorld(ctx: Ctx, world: World, body: (ids: Map<string, number>) => Promise<void>): Promise<void> {
  ctx.checks.in(world.name);
  try {
    const ids = await seedWorld(ctx.cand, world, ctx.actorId);
    ctx.checks.note(`seeded: ${world.candidate.length} candidate player(s), ${world.target.length} target player(s), ${world.records.length} target record(s)`);
    await body(ids);
  } finally {
    await teardownWorld(ctx.cand);
    const r = await readResidue(ctx.cand);
    ctx.checks.that('world torn down: zero fixture rows (actor kept until the end)', residueTotal({ ...r, actors: 0 }) === 0, JSON.stringify(r));
  }
}

async function expectStop(ctx: Ctx, gate: 'convergence' | 'a42', fragment: RegExp): Promise<void> {
  const before = await census(ctx.cand);
  const p = await planRestored(ctx.cand, ctx.target);
  ctx.checks.that('--phase restored FAILS (no remap file would be published)', p.failed, `convergence ${p.convergence}, A4.2 ${p.a42}`);
  if (gate === 'convergence') {
    ctx.checks.that('the convergence gate is the STOP, with no entry planned', p.convergence === 'FAIL' && p.entries.length === 0,
      p.problems.join(' | '));
    ctx.checks.that('the STOP names the expected reason', p.problems.some((x) => fragment.test(x)), String(fragment));
  } else {
    const lines = p.report.results.find((r) => r.gate.includes('A4.2'))?.lines ?? [];
    ctx.checks.that('A4.2 is the STOP (nothing for the convergence to plan)', p.a42 === 'FAIL' && p.entries.length === 0, `convergence ${p.convergence}`);
    ctx.checks.that('the STOP names the expected reason', lines.some((x) => fragment.test(x)), lines.filter((x) => x.startsWith('STOP')).join(' | '));
  }
  const after = await census(ctx.cand);
  ctx.checks.that('nothing written: census unchanged', before.sha256 === after.sha256, after.sha256.slice(0, 16));
}

async function caseRebind(ctx: Ctx): Promise<void> {
  const P = rehearsalPath('A', 1);
  const B = rehearsalToken('candidate', 1, 1);
  const A = rehearsalToken('target', 1, 1);
  const world: World = {
    name: 'A-rebind',
    candidate: [{ key: 'x', paths: [{ path: P }], token: B, record: true }],
    target: [{ key: 'x', paths: [{ path: P }], token: A }],
    records: [{ token: A, path: P }],
  };
  await inWorld(ctx, world, async (ids) => {
    const X = ids.get('x')!;
    const c = ctx.checks;
    const plan = await planRestored(ctx.cand, ctx.target);
    c.that('B4 plans exactly one rebind, gates PASS', !plan.failed && plan.entries.length === 1 && plan.entries[0].kind === 'rebind'
      && plan.entries[0].candidateToken === B && plan.entries[0].targetToken === A && plan.entries[0].path === P,
    `convergence ${plan.convergence}, A4.2 ${plan.a42}`);
    // Only a fully passing --phase restored publishes a file.
    if (plan.failed) return;
    const art = writeArtefact(ctx.out, world.name, plan.entries);
    c.note(`artefact ${art.file} sha256 ${art.sha256}`);
    c.that('2a reinstated the target creation record', await reinstateTargetOverrides(ctx.cand, ctx.actorId) === 1);
    const first = execute(ctx.dsn, art.file);
    c.that('2c first execution exits 0 and INSERTs one row', first.status === 0 && tags(first.stdout).includes('INSERT 0 1'),
      `exit ${first.status}; ${tagSummary(first.stdout)}${first.stderr.trim() ? `; ${first.stderr.trim()}` : ''}`);
    c.that('player X is still the same candidate-local row', await playerExists(ctx.cand, X), `players.id ${X}`);
    const path = await rowsNamed(ctx.cand, P);
    c.that('path P unchanged, one accepted row on X', path.length === 1 && path[0].playerId === X && path[0].status === 'unique'
      && path[0].matchMethod === 'afltables_profile_url');
    c.that('candidate token B absent everywhere', (await rowsNamed(ctx.cand, B)).length === 0);
    const a = await rowsNamed(ctx.cand, A);
    c.that('target token A attached to X (resolved, manual_admin_edit)', a.length === 1 && a[0].key === 'manual_admin_edit'
      && a[0].playerId === X && a[0].status === 'resolved' && a[0].matchMethod === 'manual_admin_edit', JSON.stringify(a[0] ?? null));
    c.that('X carries exactly one manual token', same(await manualTokensOf(ctx.cand, X), [A]));
    const targetRecord = await recordText(ctx.cand, 'target', A);
    c.that('target creation record A present, byte-identical to the target', targetRecord !== null
      && await recordText(ctx.cand, 'public', A) === targetRecord);
    c.that('candidate creation record B absent', await recordText(ctx.cand, 'public', B) === null);
    const g = await globalInvariants(ctx.cand);
    c.that('global: one token, one active record, no orphan, no duplicate path', g.manualTokens === 1 && g.orphanTokens === 0
      && g.multiTokenPlayers === 0 && g.duplicatePaths === 0 && g.recordsWithoutToken === 0, JSON.stringify(g));
    const live = await liveRegistrations(ctx.cand);
    const reg = live.byToken.get(A);
    c.that('registrationsFromLive PASS: A registered on X with path P', live.problems.length === 0 && same(live.tokens, [A])
      && reg?.playerId === X && reg.path === P, live.problems.join(' | '));
    c.that('readManualPlayerToken(X) = A', await manualPlayerToken(ctx.cand, ctx.readToken, X) === A);
    const c2 = await checkCandidate(ctx.cand);
    c.that('C2 (--phase candidate A4.2) PASS over the converged candidate', !c2.failed && c2.a42 === 'PASS', `A4.2 ${c2.a42}, convergence gate ${c2.convergence}`);

    // I. Retry: the same artefact, and the supported re-plan.
    const settled = await census(ctx.cand);
    const again = execute(ctx.dsn, art.file);
    const afterAgain = await census(ctx.cand);
    c.that('same artefact executed twice: exit 0, INSERTs nothing, state byte-identical', again.status === 0
      && tags(again.stdout).includes('INSERT 0 0') && !tags(again.stdout).includes('INSERT 0 1') && settled.sha256 === afterAgain.sha256,
    `exit ${again.status}; ${tagSummary(again.stdout)}; census ${afterAgain.sha256.slice(0, 16)}`);
    const replan = await planRestored(ctx.cand, ctx.target);
    c.that('re-plan at --phase restored: nothing to converge, gates PASS', !replan.failed && replan.entries.length === 0,
      `convergence ${replan.convergence}, A4.2 ${replan.a42}`);
    const reArt = writeArtefact(ctx.out, `${world.name}-replan`, replan.entries);
    c.that('re-plan file carries no convergence section', !reArt.text.includes('AFLDB-ISSUE-242 — manual player'));
    const reRun = execute(ctx.dsn, reArt.file);
    c.that('re-plan file executes as a no-op', reRun.status === 0 && (await census(ctx.cand)).sha256 === settled.sha256,
      `exit ${reRun.status}; ${tagSummary(reRun.stdout)}`);
  });
}

async function caseRetire(ctx: Ctx): Promise<void> {
  const P = rehearsalPath('B', 1);
  const B = rehearsalToken('candidate', 2, 1);
  const world: World = {
    name: 'B-retire',
    candidate: [{ key: 'x', paths: [{ path: P }], token: B, record: true }],
    target: [{ key: 'x', paths: [{ path: P }], token: null }],
    records: [],
  };
  await inWorld(ctx, world, async (ids) => {
    const X = ids.get('x')!;
    const c = ctx.checks;
    const plan = await planRestored(ctx.cand, ctx.target);
    c.that('B4 plans exactly one retire, gates PASS', !plan.failed && plan.entries.length === 1 && plan.entries[0].kind === 'retire'
      && plan.entries[0].candidateToken === B && plan.entries[0].targetToken === null, `convergence ${plan.convergence}, A4.2 ${plan.a42}`);
    // Only a fully passing --phase restored publishes a file.
    if (plan.failed) return;
    const art = writeArtefact(ctx.out, world.name, plan.entries);
    c.note(`artefact ${art.file} sha256 ${art.sha256}`);
    c.that('2a reinstated the target (no creation record)', await reinstateTargetOverrides(ctx.cand, ctx.actorId) === 0);
    const first = execute(ctx.dsn, art.file);
    c.that('2c first execution exits 0 and DELETEs one row', first.status === 0 && tags(first.stdout).includes('DELETE 1'),
      `exit ${first.status}; ${tagSummary(first.stdout)}${first.stderr.trim() ? `; ${first.stderr.trim()}` : ''}`);
    c.that('player X remains', await playerExists(ctx.cand, X), `players.id ${X}`);
    const path = await rowsNamed(ctx.cand, P);
    c.that('path P remains, accepted, on X (source identity authoritative)', path.length === 1 && path[0].playerId === X
      && path[0].status === 'unique' && path[0].matchMethod === 'afltables_profile_url');
    c.that('token B removed', (await rowsNamed(ctx.cand, B)).length === 0);
    c.that('no manual token remains on X', (await manualTokensOf(ctx.cand, X)).length === 0);
    c.that('candidate creation record B absent', await recordText(ctx.cand, 'public', B) === null);
    const g = await globalInvariants(ctx.cand);
    c.that('global: no manual token, no orphan, no record without a token', g.manualTokens === 0 && g.orphanTokens === 0
      && g.recordsWithoutToken === 0 && g.duplicatePaths === 0, JSON.stringify(g));
    const live = await liveRegistrations(ctx.cand);
    c.that('registrationsFromLive PASS (no registration, no problem)', live.problems.length === 0 && live.tokens.length === 0, live.problems.join(' | '));
    c.that('readManualPlayerToken(X) = null', await manualPlayerToken(ctx.cand, ctx.readToken, X) === null);
    const c2 = await checkCandidate(ctx.cand);
    c.that('C2 PASS', !c2.failed && c2.a42 === 'PASS', `A4.2 ${c2.a42}`);
    const settled = await census(ctx.cand);
    const again = execute(ctx.dsn, art.file);
    c.that('same artefact executed twice: exit 0, DELETE 0, state byte-identical', again.status === 0
      && tags(again.stdout).includes('DELETE 0') && (await census(ctx.cand)).sha256 === settled.sha256, `exit ${again.status}; ${tagSummary(again.stdout)}`);
    const replan = await planRestored(ctx.cand, ctx.target);
    c.that('re-plan: nothing to converge, gates PASS', !replan.failed && replan.entries.length === 0);
  });
}

async function caseControl(ctx: Ctx): Promise<void> {
  const P = rehearsalPath('C', 1);
  const T = rehearsalToken('target', 3, 1);
  const world: World = {
    name: 'C-same-path-same-token',
    candidate: [{ key: 'x', paths: [{ path: P }], token: T, record: true }],
    target: [{ key: 'x', paths: [{ path: P }], token: T }],
    records: [{ token: T, path: P }],
  };
  await inWorld(ctx, world, async (ids) => {
    const X = ids.get('x')!;
    const c = ctx.checks;
    const plan = await planRestored(ctx.cand, ctx.target);
    c.that('B4 plans no convergence, gates PASS (A4.2 present)', !plan.failed && plan.entries.length === 0, `convergence ${plan.convergence}, A4.2 ${plan.a42}`);
    // Only a fully passing --phase restored publishes a file.
    if (plan.failed) return;
    const art = writeArtefact(ctx.out, world.name, plan.entries);
    c.that('file carries no convergence section', !art.text.includes('AFLDB-ISSUE-242 — manual player'));
    await reinstateTargetOverrides(ctx.cand, ctx.actorId);
    const before = await census(ctx.cand);
    const run = execute(ctx.dsn, art.file);
    c.that('2c exits 0 and changes nothing', run.status === 0 && (await census(ctx.cand)).sha256 === before.sha256, `exit ${run.status}; ${tagSummary(run.stdout)}`);
    c.that('X keeps T and P', same(await manualTokensOf(ctx.cand, X), [T]) && (await rowsNamed(ctx.cand, P))[0]?.playerId === X);
    const live = await liveRegistrations(ctx.cand);
    c.that('registrationsFromLive PASS', live.problems.length === 0 && same(live.tokens, [T]), live.problems.join(' | '));
    const c2 = await checkCandidate(ctx.cand);
    c.that('C2 PASS', !c2.failed && c2.a42 === 'PASS');
  });
}

async function caseCollisionPlanned(ctx: Ctx): Promise<void> {
  const A = rehearsalToken('target', 4, 1);
  const world: World = {
    name: 'D-different-token-collision',
    candidate: [
      { key: 'x', paths: [{ path: rehearsalPath('D', 1) }], token: rehearsalToken('candidate', 4, 1), record: true },
      { key: 'y', paths: [{ path: rehearsalPath('D', 2) }], token: A, record: true },
    ],
    target: [{ key: 'x', paths: [{ path: rehearsalPath('D', 1) }], token: A }],
    records: [{ token: A, path: rehearsalPath('D', 1) }],
  };
  await inWorld(ctx, world, () => expectStop(ctx, 'convergence', /already held by candidate player/));
}

/**
 * The refusal proofs. R1: a file planned while the target token was free, run after another
 * candidate player took it -- the rebind's INSERT raises inside its own CTE. R2: a file run
 * without the reinstate -- the CTE succeeds and the assertion raises after it.
 */
async function caseRefusals(ctx: Ctx): Promise<void> {
  const c = ctx.checks;
  for (const variant of ['R1-collision-at-execution', 'R2-assertion-after-cte'] as const) {
    const caseNo = variant.startsWith('R1') ? 5 : 6;
    const P = rehearsalPath(variant.slice(0, 2), 1);
    const B = rehearsalToken('candidate', caseNo, 1);
    const A = rehearsalToken('target', caseNo, 1);
    const world: World = {
      name: `D-${variant}`,
      candidate: [{ key: 'x', paths: [{ path: P }], token: B, record: true }],
      target: [{ key: 'x', paths: [{ path: P }], token: A }],
      records: [{ token: A, path: P }],
    };
    await inWorld(ctx, world, async (ids) => {
      const X = ids.get('x')!;
      const plan = await planRestored(ctx.cand, ctx.target);
      c.that('B4 planned one rebind against the state it read', !plan.failed && plan.entries.length === 1);
      // Only a fully passing --phase restored publishes a file.
      if (plan.failed) return;
      const art = writeArtefact(ctx.out, world.name, plan.entries);
      c.note(`artefact ${art.file} sha256 ${art.sha256}`);
      if (variant.startsWith('R1')) {
        await reinstateTargetOverrides(ctx.cand, ctx.actorId);
        // Drift after planning: another candidate player now holds the target token A.
        await ctx.cand.begin(async (tx) => {
          await assertDatabase(tx);
          const [{ id }] = await tx<{ id: number }[]>`
            INSERT INTO players (display_name, sort_name, search_name, slug)
            VALUES ('Issue242 Rehearsal drift y', 'Rehearsal y, Issue242', 'issue242 rehearsal drift y', ${`${f.slugPrefix}${world.name}-y`})
            RETURNING id`;
          await tx`
            INSERT INTO external_identities (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
            VALUES ((SELECT id FROM sources WHERE key = 'manual_admin_edit'), ${A}, 'Issue242 Rehearsal drift y', ${id},
                    'resolved', 0, 'manual_admin_edit', ${f.note})`;
        });
        c.note('drift: candidate player y now holds target token A');
      } else {
        c.note('the reinstate (2a) is deliberately NOT run: record A is absent, candidate record B still present');
      }
      const before = await census(ctx.cand);
      const tokensBefore = { B: await rowsNamed(ctx.cand, B), A: await rowsNamed(ctx.cand, A), P: await rowsNamed(ctx.cand, P) };
      const run = execute(ctx.dsn, art.file);
      const expected = variant.startsWith('R1') ? /external_identities_uq/ : /AFLDB-ISSUE-242: rebind of manual_admin_edit:.* did not reach its planned state/;
      c.that('2c under ON_ERROR_STOP refuses (non-zero exit) with the expected error', run.status !== 0 && expected.test(run.stderr),
        `exit ${run.status}; ${run.stderr.trim().split(/\r?\n/)[0]}`);
      if (variant.startsWith('R2')) {
        c.that('the rebind CTE had executed (INSERT 0 1) before the assertion raised', tags(run.stdout).includes('INSERT 0 1'), tagSummary(run.stdout));
      } else {
        c.that('the rebind statement itself failed (no INSERT tag)', !tags(run.stdout).some((t) => t.startsWith('INSERT')), tagSummary(run.stdout));
      }
      const after = await census(ctx.cand);
      c.that('census byte-identical after the failed transaction', before.sha256 === after.sha256, `${before.sha256.slice(0, 16)} = ${after.sha256.slice(0, 16)}`);
      c.that('candidate token B still on X, path P still on X, no stranded player', same((await rowsNamed(ctx.cand, B)).map((r) => String(r.playerId)), [String(X)])
        && JSON.stringify(await rowsNamed(ctx.cand, P)) === JSON.stringify(tokensBefore.P)
        && JSON.stringify(await rowsNamed(ctx.cand, A)) === JSON.stringify(tokensBefore.A));
      const records = { A: await recordText(ctx.cand, 'public', A) !== null, B: await recordText(ctx.cand, 'public', B) !== null };
      c.that('creation records as before the run (R1: A reinstated, B gone; R2: B only)',
        variant.startsWith('R1') ? records.A && !records.B : !records.A && records.B, JSON.stringify(records));
      const loose = execute(ctx.dsn, art.file, false);
      c.that('the same file WITHOUT ON_ERROR_STOP: the error aborts the transaction and COMMIT rolls back',
        tags(loose.stdout).includes('ROLLBACK') && (await census(ctx.cand)).sha256 === before.sha256,
        `exit ${loose.status}; ${tagSummary(loose.stdout)}`);
    });
  }
}

async function caseTwoTargetTokens(ctx: Ctx): Promise<void> {
  const P = rehearsalPath('E', 1);
  const A1 = rehearsalToken('target', 7, 1);
  const A2 = rehearsalToken('target', 7, 2);
  await inWorld(ctx, {
    name: 'E1-two-target-records-one-path',
    candidate: [{ key: 'x', paths: [{ path: P }], token: rehearsalToken('candidate', 7, 1), record: true }],
    target: [{ key: 't1', paths: [{ path: P }], token: A1 }, { key: 't2', paths: [], token: A2 }],
    records: [{ token: A1, path: P }, { token: A2, path: P }],
  }, () => expectStop(ctx, 'convergence', /is named by 2 target creation records/));
  const P1 = rehearsalPath('E', 2);
  const P2 = rehearsalPath('E', 3);
  await inWorld(ctx, {
    name: 'E2-two-target-tokens-one-candidate-player',
    candidate: [{ key: 'x', paths: [{ path: P1 }, { path: P2 }], token: rehearsalToken('candidate', 8, 1), record: true }],
    target: [
      { key: 't1', paths: [{ path: P1 }], token: rehearsalToken('target', 8, 1) },
      { key: 't2', paths: [{ path: P2 }], token: rehearsalToken('target', 8, 2) },
    ],
    records: [{ token: rehearsalToken('target', 8, 1), path: P1 }, { token: rehearsalToken('target', 8, 2), path: P2 }],
  }, () => expectStop(ctx, 'convergence', /holds 2 AFL Tables profile paths/));
}

async function caseSameTokenDifferentPath(ctx: Ctx): Promise<void> {
  const T = rehearsalToken('target', 9, 1);
  await inWorld(ctx, {
    name: 'F-same-token-different-path',
    candidate: [{ key: 'x', paths: [{ path: rehearsalPath('F', 1) }], token: T, record: true }],
    target: [{ key: 'x', paths: [{ path: rehearsalPath('F', 2) }], token: T }],
    records: [{ token: T, path: rehearsalPath('F', 2) }],
  }, () => expectStop(ctx, 'a42', /^STOP .*same token, different path/));
}

async function caseAmbiguousPath(ctx: Ctx): Promise<void> {
  await inWorld(ctx, {
    name: 'G1-ambiguous-path-in-candidate',
    candidate: [{ key: 'x', paths: [{ path: rehearsalPath('G', 1), status: 'ambiguous' }], token: rehearsalToken('candidate', 10, 1), record: true }],
    target: [{ key: 'x', paths: [{ path: rehearsalPath('G', 1) }], token: null }],
    records: [],
  }, () => expectStop(ctx, 'convergence', /holds no accepted AFL Tables profile path/));
  await inWorld(ctx, {
    name: 'G2-ambiguous-path-in-target',
    candidate: [{ key: 'x', paths: [{ path: rehearsalPath('G', 2) }], token: rehearsalToken('candidate', 11, 1), record: true }],
    target: [{ key: 'x', paths: [{ path: rehearsalPath('G', 2), status: 'ambiguous' }], token: null }],
    records: [],
  }, () => expectStop(ctx, 'convergence', /holds .* ambiguously/));
}

async function caseOrphan(ctx: Ctx): Promise<void> {
  await inWorld(ctx, {
    name: 'H-orphan-candidate-token',
    candidate: [{ key: 'x', paths: [{ path: rehearsalPath('H', 1) }], token: rehearsalToken('candidate', 12, 1), record: true }],
    target: [],
    records: [],
  }, () => expectStop(ctx, 'convergence', /neither records a registration .* nor holds it/));
}

async function caseScale(ctx: Ctx, n: number): Promise<void> {
  const world = scaleWorld(n);
  const rebinds = world.records.length;
  await inWorld(ctx, world, async (ids) => {
    const c = ctx.checks;
    const started = Date.now();
    const plan = await planRestored(ctx.cand, ctx.target);
    c.that(`B4 plans ${n} convergences (${rebinds} rebind, ${n - rebinds} retire), gates PASS`, !plan.failed && plan.entries.length === n
      && plan.entries.filter((e) => e.kind === 'rebind').length === rebinds, `convergence ${plan.convergence}, A4.2 ${plan.a42}`);
    // Only a fully passing --phase restored publishes a file.
    if (plan.failed) return;
    const art = writeArtefact(ctx.out, world.name, plan.entries);
    c.note(`artefact ${art.file} sha256 ${art.sha256} (${art.text.split('\n').length} lines)`);
    c.that(`2a reinstated ${rebinds} target record(s)`, await reinstateTargetOverrides(ctx.cand, ctx.actorId) === rebinds);
    const first = execute(ctx.dsn, art.file);
    const t = tags(first.stdout);
    c.that('2c exits 0; every planned action applied', first.status === 0 && t.filter((x) => x === 'INSERT 0 1').length === rebinds
      && t.filter((x) => x === 'DELETE 1').length === n - rebinds && t.includes('COMMIT'),
    `exit ${first.status}; ${tagSummary(first.stdout)}${first.stderr.trim() ? `; ${first.stderr.trim()}` : ''}`);
    let perPlayer = 0;
    for (const [i, cs] of world.candidate.entries()) {
      const X = ids.get(cs.key)!;
      const expected = world.target[i].token === null ? [] : [world.target[i].token!];
      const path = await rowsNamed(ctx.cand, cs.paths[0].path);
      if (same(await manualTokensOf(ctx.cand, X), expected) && path.length === 1 && path[0].playerId === X
        && (await rowsNamed(ctx.cand, cs.token!)).length === 0) perPlayer += 1;
    }
    c.that(`per player: candidate token gone, expected token (or none) on the same row, path on the same row (${perPlayer}/${n})`, perPlayer === n);
    const g = await globalInvariants(ctx.cand);
    c.that('global: zero orphan tokens, no player with >1 token, paths unique, every record has its token', g.orphanTokens === 0
      && g.multiTokenPlayers === 0 && g.duplicatePaths === 0 && g.recordsWithoutToken === 0 && g.manualTokens === rebinds, JSON.stringify(g));
    const live = await liveRegistrations(ctx.cand);
    c.that(`registrationsFromLive PASS with ${rebinds} registration(s)`, live.problems.length === 0 && live.tokens.length === rebinds,
      live.problems.slice(0, 3).join(' | '));
    const c2 = await checkCandidate(ctx.cand);
    c.that('C2 PASS', !c2.failed && c2.a42 === 'PASS', `A4.2 ${c2.a42}`);
    const settled = await census(ctx.cand);
    const again = execute(ctx.dsn, art.file);
    const t2 = tags(again.stdout);
    c.that('same artefact executed twice: exit 0, nothing inserted or deleted, state byte-identical', again.status === 0
      && t2.filter((x) => x === 'INSERT 0 0').length === rebinds && t2.filter((x) => x === 'DELETE 0').length === n - rebinds
      && (await census(ctx.cand)).sha256 === settled.sha256, tagSummary(again.stdout));
    const replan = await planRestored(ctx.cand, ctx.target);
    c.that('re-plan is empty, gates PASS', !replan.failed && replan.entries.length === 0);
    c.note(`scale world ran in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  });
}

async function runRehearsal(dsn: string, out: string, scale: number): Promise<number> {
  mkdirSync(out, { recursive: true });
  const cand = connect(dsn);
  const target = connect(dsn, f.targetSchema);
  const checks = new Checks();
  let final: Residue | null = null;
  try {
    const pre = await preflight(cand);
    console.log(`preflight: current_database=${pre.database} current_user=${pre.user} transaction_read_only=${pre.readOnly} server=${pre.pg}`);
    console.log('preflight: isolation PASS (no fixture residue, no non-fixture manual identity or replayable override, no other session, no rebuild marker)');
    // readManualPlayerToken is server-only; its module's clients are pointed at code_test_db before it loads and never queried.
    process.env.DATABASE_URL = dsn;
    process.env.AFLDB_AUTH_DATABASE_URL = dsn;
    process.env.AFLDB_IMPORT_DATABASE_URL = dsn;
    const { readManualPlayerToken } = await import('@/db/queries/player-identity');
    const actorId = await cand.begin(async (tx) => {
      await assertDatabase(tx);
      return insertAttributionOnlyActor(tx, { email: f.actorEmail, role: f.actorRole });
    }) as number;
    const ctx: Ctx = { dsn, cand, target, actorId, out, checks, readToken: readManualPlayerToken as TokenReader };
    await caseRebind(ctx);
    await caseRetire(ctx);
    await caseControl(ctx);
    await caseCollisionPlanned(ctx);
    await caseRefusals(ctx);
    await caseTwoTargetTokens(ctx);
    await caseSameTokenDifferentPath(ctx);
    await caseAmbiguousPath(ctx);
    await caseOrphan(ctx);
    await caseScale(ctx, scale);
  } finally {
    final = await teardownAll(cand).catch((error: unknown) => {
      console.error(`TEARDOWN FAILED: ${redact((error as Error).message)} — run: teardown --acknowledge ${f.database}`);
      return null;
    });
    await cand.end();
    await target.end();
  }
  checks.in('cleanup');
  checks.that('final residue is zero (players, identities, records, actor, schema, data_edits)', final !== null && residueTotal(final) === 0, JSON.stringify(final));
  const failed = checks.all.filter((x) => !x.ok);
  console.log(`\nISSUE-242 code_test_db rehearsal: ${checks.all.length - failed.length}/${checks.all.length} checks PASS`);
  for (const x of failed) console.log(`  FAILED [${x.world}] ${x.label} — ${x.detail}`);
  return failed.length === 0 ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const command = parseConvergenceRehearsalArgs(argv);
  const { ownerDsn, database } = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: true });
  if (database !== f.database) throw new ConvergenceRehearsalRefused(`Refusing '${database}': ${f.database} only.`);
  console.log(`AFLDB-ISSUE-242 convergence rehearsal — ${command.step} on ${database}`);
  if (command.step === 'run') return runRehearsal(ownerDsn, resolve(command.out), command.scale);
  const sql = connect(ownerDsn);
  try {
    await assertDatabase(sql);
    const residue = command.step === 'teardown' ? await teardownAll(sql) : await readResidue(sql);
    console.log(`residue: ${JSON.stringify(residue)}`);
    return residueTotal(residue) === 0 ? 0 : 1;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && /promotion-convergence-rehearsal\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
