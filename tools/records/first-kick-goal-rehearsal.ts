/**
 * AFLDB-ISSUE-249 — the code_test_db rehearsal of first-kick-goal reconstruction and of the
 * promotion gate that stops its loss.
 *
 *     AFLDB_CODE_TEST_DATABASE_URL=<afldb_owner DSN naming code_test_db> \
 *     AFLDB_CODE_TEST_IMPORT_DATABASE_URL=<afldb_import DSN naming code_test_db> \
 *       npm run db:code-test:issue249-rehearsal -- run --acknowledge code_test_db --out <evidence dir> \
 *         [--real-source]      # also R8: the real pinned 334-row source (needs the accepted extract,
 *                              # at data/records/ or via AFLDB_FIRST_KICK_GOAL_CSV)
 *     npm run db:code-test:issue249-rehearsal -- residue
 *
 * WHAT IT RUNS. The real code, not a model of it: the pinned-source loader and the importer's
 * own CLI (child processes, for the refusals that must precede any database contact), then the
 * importer's exported resolve and write phases, the rebuild's FINAL VALIDATION checks and the
 * promotion checker's reader and judge — all inside ONE transaction on the import role that
 * always ends in ROLLBACK.
 *
 * THE FIXTURE. A small extract + manifest + pin written to the evidence directory, built from
 * code_test_db's own canonical facts (players with a unique name and a recorded debut game),
 * plus one name no player carries. Nothing is fabricated in the database: every row the run
 * writes is the importer's, and all of it is rolled back.
 *
 * ISOLATION. It refuses unless the connection is code_test_db (by DSN name AND
 * current_database()), no other client session is attached, the importer's owned scope is
 * empty and no player_achievements override is active — so the importer, which owns the whole
 * `wikipedia_first_kick_goal` scope, can only ever touch the fixture.
 *
 * RESIDUE. A fresh-session fingerprint before and after: row counts, the three sequences the
 * importer advances (restored with setval, since nextval is not transactional), schemas,
 * prepared transactions and the database comment. They must be identical. No DSN is printed.
 *
 * THE REBUILD-RUNNER REHEARSAL (`runner`, RR0–RR7). `run` proves the importer; `runner` proves
 * the REBUILD RUNNER schedules and executes it. It enters through tools/db/rebuild-test.ts
 * itself — its parseArgs, resolveTarget (every database-name guard), planStages and
 * executeRebuild, dispatching through the CLI's own createCliDeps — against code_test_db:
 *
 *     npm run db:code-test:issue249-rehearsal -- runner --acknowledge code_test_db --out <dir>
 *
 * executeRebuild walks the REAL plan in its own order. code_test_db is already a completed
 * rebuild (ISSUE-146) holding every earlier stage's output but none of this family, so every
 * stage before `first-kick-goal` is dispatched and NOT executed (no reset, no reload), the
 * `first-kick-goal` stage runs for real — its planned argv and env, through the runner's
 * runCommand, committing — and the run halts deterministically before `ladder-witness`. The
 * family's FINAL VALIDATION checks then run through the runner's own runValidation, and the
 * complete planned FINAL VALIDATION stream is read for its first-kick-goal lines. Finally the
 * stage's committed rows, their data issues and its import batch are removed and the three
 * sequences restored; the fresh-session fingerprint must equal the pre-run one.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import postgres, { type Sql, type TransactionSql } from 'postgres';

import { judgeFirstKickGoalIdentities, readFirstKickGoalIdentities, type Query } from '../db/promotion-check';
import { runPsql, type SpawnSyncLike } from '../db/psql';
import {
  FINAL_VALIDATION_MARKER, buildFinalValidationSql, createCliDeps, databaseOf, executeRebuild, firstKickGoalArgv,
  firstKickGoalChecks, firstKickGoalValidateArgv, parseArgs as parseRebuildArgs, planStages, resolveFitzroySource,
  resolveTarget, type Deps, type ExecutionReport, type Stage,
} from '../db/rebuild-test';
import type { Row } from '../db/catalog-fingerprint';
import { resolveRehearsalDsns } from '../migration/afl_api_identity_rebuild_rehearsal_fixture';
import {
  ACHIEVEMENT_TYPE, FIRST_KICK_GOAL_PROVENANCE, FirstKickGoalSourceRefused, PROJECT_ROOT, SOURCE_KEY,
  activeManifestIds, canonicalSha256, loadPinnedSource, parseCsv, parseManifestText, trackedExpectedIds,
} from './first-kick-goal-source';
import {
  reconcileFirstKickGoal, reportResolution, resolveFirstKickGoalRows,
} from './import-first-kick-goal';

export class FirstKickGoalRehearsalRefused extends Error {}

export const FKG_REHEARSAL = {
  database: 'code_test_db',
  applicationName: 'afldb-issue249-first-kick-goal-rehearsal',
  unmatchedName: 'Zz Issuefortynine Unmatched',
  unmatchedClub: 'Carlton',
  unmatchedSeason: 1975,
  unmatchedRound: '3',
} as const;

// ---------------------------------------------------------------------------
// Arguments and the database guard (pure)
// ---------------------------------------------------------------------------

export type RehearsalCommand =
  | { step: 'run'; out: string; allowOwnerImportDsn: boolean; realSource: boolean }
  | { step: 'runner'; out: string }
  | { step: 'residue' };

export function parseFkgRehearsalArgs(argv: readonly string[]): RehearsalCommand {
  const [step, ...rest] = argv;
  if (step === 'residue') {
    if (rest.length > 0) throw new FirstKickGoalRehearsalRefused(`Unexpected argument(s) for residue: ${rest.join(' ')}`);
    return { step };
  }
  if (step === 'runner') {
    // The rebuild-runner rehearsal COMMITS through the real stage and then removes it, so it
    // takes no owner-substitution or fixture options: the stage runs exactly as planned.
    let acknowledge: string | undefined;
    let out: string | undefined;
    for (let i = 0; i < rest.length; i += 2) {
      const [arg, value] = [rest[i], rest[i + 1]];
      if (arg !== '--acknowledge' && arg !== '--out') throw new FirstKickGoalRehearsalRefused(`Unknown argument ${arg}.`);
      if (!value || value.startsWith('--')) throw new FirstKickGoalRehearsalRefused(`${arg} requires a value.`);
      if (arg === '--acknowledge') acknowledge = value; else out = value;
    }
    if (acknowledge !== FKG_REHEARSAL.database) {
      throw new FirstKickGoalRehearsalRefused(
        `runner commits (and then removes) the real stage's rows on ${FKG_REHEARSAL.database}: `
        + `pass --acknowledge ${FKG_REHEARSAL.database}.`);
    }
    if (!out) throw new FirstKickGoalRehearsalRefused('runner needs --out <evidence dir>.');
    return { step: 'runner', out };
  }
  if (step !== 'run') {
    throw new FirstKickGoalRehearsalRefused(
      'Usage: run --acknowledge code_test_db --out <dir> | runner --acknowledge code_test_db --out <dir> | residue');
  }
  let acknowledge: string | undefined;
  let out: string | undefined;
  let allowOwnerImportDsn = false;
  let realSource = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--allow-owner-import-dsn') { allowOwnerImportDsn = true; continue; }
    if (arg === '--real-source') { realSource = true; continue; }
    if (arg === '--acknowledge' || arg === '--out') {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new FirstKickGoalRehearsalRefused(`${arg} requires a value.`);
      if (arg === '--acknowledge') acknowledge = value; else out = value;
      i += 1;
      continue;
    }
    throw new FirstKickGoalRehearsalRefused(`Unknown argument ${arg}.`);
  }
  if (acknowledge !== FKG_REHEARSAL.database) {
    throw new FirstKickGoalRehearsalRefused(
      `run writes (and rolls back) on ${FKG_REHEARSAL.database}: pass --acknowledge ${FKG_REHEARSAL.database}.`);
  }
  if (!out) throw new FirstKickGoalRehearsalRefused('run needs --out <evidence dir>.');
  return { step: 'run', out, allowOwnerImportDsn, realSource };
}

/** The live half of the guard: the server must agree with the DSN. */
export function assertRehearsalDatabase(actual: string): void {
  if (actual !== FKG_REHEARSAL.database) {
    throw new FirstKickGoalRehearsalRefused(
      `Connected to '${actual}', not '${FKG_REHEARSAL.database}'. The ISSUE-249 rehearsal runs on `
      + `${FKG_REHEARSAL.database} only; nothing was written.`);
  }
}

// ---------------------------------------------------------------------------
// The fixture (pure given the chosen players)
// ---------------------------------------------------------------------------

export type FixturePlayer = {
  playerId: number; displayName: string; club: string; season: number; round: string; matchId: number;
};

export type Fixture = {
  extract: string;
  manifest: string;
  provenance: string;
  /** fkg id -> what the importer must write for it. */
  expect: Map<string, { playerId: number | null; matchId: number | null; linkStatus: string }>;
};

export function buildFixture(
  dir: string, players: readonly FixturePlayer[], ambiguous?: { name: string; club: string; season: number; round: string },
): Fixture {
  const lines = ['Player,Club,Rd.,Year'];
  const ids = ['Id,Player,Club,Rd.,Year,Status'];
  const expect = new Map<string, { playerId: number | null; matchId: number | null; linkStatus: string }>();
  let n = 0;
  const id = () => `fkg-${String(n += 1).padStart(3, '0')}`;
  for (const [i, p] of players.entries()) {
    if (/[,"\r\n]/.test(p.displayName) || /[,"]/.test(p.club)) {
      throw new FirstKickGoalRehearsalRefused(`Fixture player ${p.playerId} is not CSV-safe.`);
    }
    // The second player carries the "no further career goals" marker, so the legend
    // cross-check (a data_issues refile) is exercised as well.
    lines.push(`${p.displayName}${i === 1 ? ' *' : ''},${p.club},${p.round},${p.season}`);
    const key = id();
    ids.push(`${key},${p.displayName},${p.club},${p.round},${p.season},active`);
    expect.set(key, { playerId: p.playerId, matchId: p.matchId, linkStatus: 'unique' });
  }
  const u = FKG_REHEARSAL;
  lines.push(`${u.unmatchedName},${u.unmatchedClub},${u.unmatchedRound},${u.unmatchedSeason}`);
  const unmatchedKey = id();
  ids.push(`${unmatchedKey},${u.unmatchedName},${u.unmatchedClub},${u.unmatchedRound},${u.unmatchedSeason},active`);
  expect.set(unmatchedKey, { playerId: null, matchId: null, linkStatus: 'unmatched' });
  if (ambiguous) {
    lines.push(`${ambiguous.name},${ambiguous.club},${ambiguous.round},${ambiguous.season}`);
    const key = id();
    ids.push(`${key},${ambiguous.name},${ambiguous.club},${ambiguous.round},${ambiguous.season},active`);
    expect.set(key, { playerId: null, matchId: null, linkStatus: 'ambiguous' });
  }
  const extract = `${lines.join('\n')}\n`;
  const manifest = `${ids.join('\n')}\n`;
  const provenance = `${JSON.stringify({
    issue: 'AFLDB-ISSUE-249', note: 'code_test_db rehearsal fixture — never a real source',
    // Absolute: the importer CLI resolves a relative provenance path against the repository root.
    extract: join(dir, 'first-kick-goal.csv'),
    extract_sha256: canonicalSha256(Buffer.from(extract)),
    extract_rows: parseCsv(extract).length,
    manifest: join(dir, 'first-kick-goal-ids.csv'),
    manifest_sha256: canonicalSha256(Buffer.from(manifest)),
    manifest_active: activeManifestIds(parseManifestText(manifest, 'fixture')).length,
  }, null, 2)}\n`;
  return { extract, manifest, provenance, expect };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

type Evidence = { scenario: string; verdict: 'PASS' | 'FAIL'; detail: unknown };

class ForcedRollback extends Error {}

/** The gate's expectation in this rehearsal is the fixture's manifest, and says so. */
const FIXTURE_MANIFEST = 'the rehearsal fixture manifest';

function connect(dsn: string): Sql {
  return postgres(dsn, { max: 1, prepare: false, onnotice: () => {}, connection: { application_name: FKG_REHEARSAL.applicationName } });
}

function queryOf(db: Sql | TransactionSql): Query {
  return (text, params) => db.unsafe(text, (params ?? []) as never[]).then((rows) => rows as unknown as Row[]);
}

const SEQUENCE_TABLES = ['player_achievements', 'import_batches', 'data_issues'] as const;

export type Fingerprint = Record<string, string | number | boolean | null>;

/** A fresh-session, read-only snapshot. Everything the importer or this tool could leave behind. */
async function readFingerprint(sql: Sql): Promise<Fingerprint> {
  const fp: Fingerprint = {};
  const [c] = await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::int FROM player_achievements) AS player_achievements,
      (SELECT count(*)::int FROM player_achievements a JOIN sources s ON s.id = a.source_id
        WHERE s.key = ${SOURCE_KEY}) AS owned,
      (SELECT count(*)::int FROM import_batches) AS import_batches,
      (SELECT count(*)::int FROM import_batches WHERE tool = 'tools/records/import-first-kick-goal.ts') AS fkg_batches,
      (SELECT count(*)::int FROM data_issues) AS data_issues,
      (SELECT count(*)::int FROM data_issues WHERE entity_type = 'player_achievements') AS fkg_data_issues,
      (SELECT count(*)::int FROM data_overrides) AS data_overrides,
      (SELECT count(*)::int FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema') AS schemas,
      (SELECT count(*)::int FROM pg_prepared_xacts) AS prepared_xacts,
      (SELECT count(*)::int FROM pg_namespace WHERE nspname = 'promotion_staging') AS promotion_staging
  `;
  Object.assign(fp, c);
  const [comment] = await sql<{ d: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS d FROM pg_database WHERE datname = current_database()`;
  fp.database_comment = comment?.d ?? null;
  for (const table of SEQUENCE_TABLES) {
    const [seq] = await sql<{ name: string | null }[]>`SELECT pg_get_serial_sequence(${`public.${table}`}, 'id') AS name`;
    if (!seq?.name) { fp[`seq:${table}`] = null; continue; }
    const [state] = await sql.unsafe<{ last_value: string; is_called: boolean }[]>(
      `SELECT last_value::text, is_called FROM ${seq.name}`);
    fp[`seq:${table}`] = `${state.last_value}/${state.is_called}`;
  }
  return fp;
}

/** nextval is not transactional: put each sequence back exactly where it was. Owner only. */
async function restoreSequences(sql: Sql, before: Fingerprint): Promise<void> {
  for (const table of SEQUENCE_TABLES) {
    const value = before[`seq:${table}`];
    if (typeof value !== 'string') continue;
    const [last, called] = value.split('/');
    await sql`SELECT setval(pg_get_serial_sequence(${`public.${table}`}, 'id'), ${last}::bigint, ${called === 'true'})`;
  }
}

async function chooseFixturePlayers(tx: TransactionSql): Promise<FixturePlayer[]> {
  const pick = async (from: number, to: number): Promise<FixturePlayer> => {
    const [row] = await tx<FixturePlayer[]>`
      SELECT p.id AS "playerId", p.display_name AS "displayName", c.name AS club,
             m.season::int AS season, m.round_code AS round, m.id AS "matchId"
        FROM player_match_stats pms
        JOIN matches m ON m.id = pms.match_id
        JOIN players p ON p.id = pms.player_id
        JOIN clubs c ON c.id = pms.club_id
       WHERE pms.career_game_no = 1 AND NOT m.is_final AND m.round_code ~ '^[0-9]+$'
         AND m.season BETWEEN ${from} AND ${to} AND p.debut_season = m.season
         AND p.display_name !~ '[,"]' AND c.name !~ '[,"]'
         AND NOT EXISTS (SELECT 1 FROM players q WHERE q.search_name = p.search_name AND q.id <> p.id)
         AND (SELECT count(*) FROM player_match_stats x JOIN matches y ON y.id = x.match_id
               WHERE x.player_id = p.id AND y.season = m.season AND y.round_code = m.round_code) = 1
       ORDER BY p.id
       LIMIT 1`;
    if (!row) throw new FirstKickGoalRehearsalRefused(`code_test_db has no usable debut game in ${from}-${to}.`);
    return { ...row, playerId: Number(row.playerId), matchId: Number(row.matchId), season: Number(row.season) };
  };
  // Three eras, all before the Opening Round offset (2024+) so the source round is the AFLDB round.
  return [await pick(1920, 1959), await pick(1960, 1999), await pick(2000, 2019)];
}

/**
 * A name the shared resolver calls ambiguous AND the debut-game tiebreak cannot narrow to one:
 * two players of one search_name, both on one club's list in one season, where not exactly one
 * of them debuted for that club. Best-effort — absent on some databases, and reported as such.
 */
async function findAmbiguous(tx: TransactionSql): Promise<{ name: string; club: string; season: number; round: string } | undefined> {
  const [row] = await tx<{ name: string; club: string; season: number; round: string }[]>`
    WITH pairs AS (
      SELECT a.id AS a_id, b.id AS b_id, a.display_name AS name, a.search_name,
             greatest(a.debut_season, b.debut_season) AS season
        FROM players a JOIN players b ON b.search_name = a.search_name AND b.id > a.id
       WHERE a.debut_season IS NOT NULL AND b.debut_season IS NOT NULL
         AND greatest(a.debut_season, b.debut_season)
             <= least(COALESCE(a.final_season, 9999), COALESCE(b.final_season, 9999))
         AND a.display_name !~ '[,"]'
         AND (SELECT count(*) FROM players z WHERE z.search_name = a.search_name) = 2
    ), shared AS (
      SELECT p.*, pca.club_id
        FROM pairs p
        JOIN player_clubs pca ON pca.player_id = p.a_id AND pca.first_season <= p.season AND pca.last_season >= p.season
        JOIN player_clubs pcb ON pcb.player_id = p.b_id AND pcb.club_id = pca.club_id
                             AND pcb.first_season <= p.season AND pcb.last_season >= p.season
    )
    SELECT s.name, c.name AS club, s.season::int AS season, '1' AS round
      FROM shared s JOIN clubs c ON c.id = s.club_id
     WHERE c.name !~ '[,"]'
       AND c.first_season <= s.season AND (c.last_season IS NULL OR c.last_season >= s.season)
       AND (SELECT count(*) FROM players x
             WHERE x.id IN (s.a_id, s.b_id) AND x.debut_season <= s.season
               AND EXISTS (SELECT 1 FROM player_match_stats y WHERE y.player_id = x.id
                             AND y.career_game_no = 1 AND y.club_id = s.club_id)) <> 1
     ORDER BY s.season, s.name
     LIMIT 1`;
  return row ? { ...row, season: Number(row.season) } : undefined;
}

type OwnedRow = Record<string, unknown> & { source_record_id: string };

async function readOwned(tx: TransactionSql): Promise<OwnedRow[]> {
  return tx<OwnedRow[]>`
    SELECT a.id::text AS id, a.source_record_id, a.player_id, a.link_status_value::text AS link_status,
           a.candidate_count, a.club_id, a.club_name_raw, a.season, a.season_footnote_raw, a.round_raw,
           a.consecutive_goal_kicks, a.no_further_career_goals, a.no_further_career_kicks,
           a.kickless_matches_before_first_kick, a.match_id, a.notes, a.player_name_raw, a.player_name_clean,
           a.source_annotation, a.status, a.status_reason, a.import_batch_id::text AS import_batch_id,
           a.achievement_type::text AS achievement_type
      FROM player_achievements a JOIN sources s ON s.id = a.source_id
     WHERE s.key = ${SOURCE_KEY} AND a.achievement_type::text = ${ACHIEVEMENT_TYPE}
     ORDER BY a.source_record_id`;
}

async function readOwnedIssues(tx: TransactionSql): Promise<string[]> {
  const rows = await tx<{ k: string }[]>`
    SELECT concat_ws('|', a.source_record_id, d.issue_type, d.severity, d.description, d.details::text) AS k
      FROM data_issues d JOIN player_achievements a ON a.id = d.entity_id
      JOIN sources s ON s.id = a.source_id
     WHERE d.entity_type = 'player_achievements' AND s.key = ${SOURCE_KEY} AND d.resolved_at IS NULL
     ORDER BY 1`;
  return rows.map((r) => r.k);
}

/** Without the import batch, which a rerun legitimately moves to its own batch. */
function semantic(rows: readonly OwnedRow[]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([column]) => column !== 'import_batch_id'))));
}

async function runChecks(tx: TransactionSql, ids: string[]): Promise<{ key: string; expected: number; actual: number }[]> {
  const out: { key: string; expected: number; actual: number }[] = [];
  for (const check of firstKickGoalChecks(() => ids)) {
    const [row] = await tx.unsafe<Record<string, unknown>[]>(check.sql);
    out.push({ key: check.key, expected: check.expected, actual: Number(Object.values(row)[0]) });
  }
  return out;
}

function child(args: string[], env: Record<string, string>): { status: number | null; out: string } {
  const tsxCli = join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCli, '--conditions=react-server',
    join(PROJECT_ROOT, 'tools', 'records', 'import-first-kick-goal.ts'), ...args], {
    cwd: PROJECT_ROOT, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function run(cmd: Extract<RehearsalCommand, { step: 'run' }>): Promise<number> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: cmd.allowOwnerImportDsn });
  const out = resolve(cmd.out);
  mkdirSync(out, { recursive: true });
  const evidence: Evidence[] = [];
  const record = (scenario: string, ok: boolean, detail: unknown) => {
    evidence.push({ scenario, verdict: ok ? 'PASS' : 'FAIL', detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${scenario}`);
    if (!ok) console.log(`       ${JSON.stringify(detail)}`);
  };

  const owner = connect(dsns.ownerDsn);
  const importer = connect(dsns.importDsn);
  let before: Fingerprint | undefined;
  try {
    for (const [role, sql] of [['owner', owner], ['import', importer]] as const) {
      const [{ d, u }] = await sql<{ d: string; u: string }[]>`SELECT current_database() AS d, current_user AS u`;
      assertRehearsalDatabase(d);
      console.log(`${role} connection: ${d} as ${u}`);
    }
    const [{ others }] = await owner<{ others: number }[]>`
      SELECT count(*)::int AS others FROM pg_stat_activity
       WHERE datname = current_database() AND backend_type = 'client backend'
         AND application_name <> ${FKG_REHEARSAL.applicationName}`;
    if (others > 0) throw new FirstKickGoalRehearsalRefused(`${others} other client session(s) are attached to code_test_db.`);
    const [{ owned, overrides }] = await owner<{ owned: number; overrides: number }[]>`
      SELECT (SELECT count(*)::int FROM player_achievements a JOIN sources s ON s.id = a.source_id
               WHERE s.key = ${SOURCE_KEY}) AS owned,
             (SELECT count(*)::int FROM data_overrides WHERE entity_type = 'player_achievements' AND is_active) AS overrides`;
    if (owned > 0 || overrides > 0) {
      throw new FirstKickGoalRehearsalRefused(
        `code_test_db already holds ${owned} ${SOURCE_KEY} row(s) and ${overrides} active player_achievements `
        + 'override(s); the importer owns that whole scope, so the fixture would not be isolated. Nothing was written.');
    }
    before = await readFingerprint(owner);
    writeFileSync(join(out, 'fingerprint-before.json'), `${JSON.stringify(before, null, 2)}\n`);

    // ---- The fixture, from code_test_db's own facts (read in a READ ONLY transaction) ----
    const fixtureDir = join(out, 'fixture');
    mkdirSync(fixtureDir, { recursive: true });
    let fixture!: Fixture;
    await importer.begin('read only', async (tx) => {
      const players = await chooseFixturePlayers(tx);
      const ambiguous = await findAmbiguous(tx);
      fixture = buildFixture(fixtureDir, players, ambiguous);
      if (!ambiguous) console.log('note: no ambiguous-by-name case exists in code_test_db; R4 uses the unmatched row only');
    });
    const provenancePath = join(fixtureDir, 'first-kick-goal.source.json');
    writeFileSync(join(fixtureDir, 'first-kick-goal.csv'), fixture.extract);
    writeFileSync(join(fixtureDir, 'first-kick-goal-ids.csv'), fixture.manifest);
    writeFileSync(provenancePath, fixture.provenance);
    const expectedIds = [...fixture.expect.keys()].sort();
    const pinnedIo = { root: fixtureDir, env: {} };

    // ---- R3: missing / contradictory inputs refuse BEFORE any database contact ----
    // The importer's own CLI, as the rebuild stage runs it, pointed at code_test_db.
    const childEnv = { AFLDB_IMPORT_DATABASE_URL: dsns.importDsn, AFLDB_FIRST_KICK_GOAL_CSV: '', AFLDB_FIRST_KICK_GOAL_MANIFEST: '' };
    const okValidate = child(['--validate-only', '--provenance', provenancePath], childEnv);
    record('R3.0 pinned --validate-only accepts the intact fixture (control)', okValidate.status === 0,
      { status: okValidate.status, tail: okValidate.out.trim().split('\n').slice(-1) });
    const extractFile = join(fixtureDir, 'first-kick-goal.csv');
    rmSync(extractFile);
    const noExtract = child(['--apply', '--provenance', provenancePath], childEnv);
    record('R3.1 --apply with the extract missing refuses before connecting', noExtract.status === 1
      && /extract is missing/.test(noExtract.out) && !/Reconciled/.test(noExtract.out),
    { status: noExtract.status, tail: noExtract.out.trim().split('\n').slice(-2) });
    writeFileSync(extractFile, fixture.extract.replace(/\n$/, '\nExtra Row,Carlton,1,1990\n'));
    const tampered = child(['--apply', '--provenance', provenancePath], childEnv);
    record('R3.2 --apply with a changed extract refuses on the pinned hash', tampered.status === 1
      && /hashes to .* pins/.test(tampered.out) && !/Reconciled/.test(tampered.out),
    { status: tampered.status, tail: tampered.out.trim().split('\n').slice(-1) });
    writeFileSync(extractFile, fixture.extract);
    const manifestFile = join(fixtureDir, 'first-kick-goal-ids.csv');
    rmSync(manifestFile);
    let manifestRefusal = '';
    try { loadPinnedSource(provenancePath, pinnedIo); } catch (error) {
      if (error instanceof FirstKickGoalSourceRefused) manifestRefusal = error.message;
    }
    record('R3.3 a missing manifest refuses', /identity manifest is missing/.test(manifestRefusal), { manifestRefusal });
    writeFileSync(manifestFile, fixture.manifest);
    const afterRefusals = await readFingerprint(owner);
    record('R3.4 the refusals touched nothing (fingerprint unchanged)', JSON.stringify(afterRefusals) === JSON.stringify(before),
      { before, afterRefusals });

    const pinned = loadPinnedSource(provenancePath, pinnedIo);

    // ---- One transaction, import role, always rolled back ----
    try {
      await importer.begin(async (tx) => {
        const [{ d }] = await tx<{ d: string }[]>`SELECT current_database() AS d`;
        assertRehearsalDatabase(d);
        const q = queryOf(tx);
        const load = async () => {
          const { resolutions, openingRoundAdjusted } = await resolveFirstKickGoalRows(tx, pinned.rows);
          const counts = reportResolution(resolutions, openingRoundAdjusted);
          return reconcileFirstKickGoal(tx, {
            rows: pinned.rows, manifest: pinned.manifest, joined: pinned.joined, resolutions, counts,
          }, { allowLinkLoss: false, acceptRenames: [], acceptRetirements: [] });
        };

        // R1 — positive reconstruction.
        const first = await load();
        const rows1 = await readOwned(tx);
        const byId = new Map(rows1.map((r) => [r.source_record_id, r]));
        const r1Problems: string[] = [];
        for (const [key, want] of fixture.expect) {
          const got = byId.get(key);
          if (!got) { r1Problems.push(`${key} absent`); continue; }
          if (got.link_status !== want.linkStatus) r1Problems.push(`${key} link ${String(got.link_status)} != ${want.linkStatus}`);
          if ((got.player_id === null ? null : Number(got.player_id)) !== want.playerId) r1Problems.push(`${key} player ${String(got.player_id)} != ${want.playerId}`);
          if ((got.match_id === null ? null : Number(got.match_id)) !== want.matchId) r1Problems.push(`${key} match ${String(got.match_id)} != ${want.matchId}`);
          if (got.import_batch_id === null) r1Problems.push(`${key} has no import batch`);
          if (got.achievement_type !== ACHIEVEMENT_TYPE) r1Problems.push(`${key} type ${String(got.achievement_type)}`);
        }
        if (rows1.length !== fixture.expect.size) r1Problems.push(`${rows1.length} owned rows, expected ${fixture.expect.size}`);
        record('R1 positive reconstruction: every fixture id written once, under its fkg id, with the resolved player and match',
          r1Problems.length === 0 && first.inserted === fixture.expect.size && first.updated === 0 && first.deleted === 0,
          { first, problems: r1Problems, rows: rows1.map((r) => [r.source_record_id, r.link_status, r.player_id, r.match_id]) });
        const checks1 = await runChecks(tx, expectedIds);
        record('R1.b the rebuild FINAL VALIDATION first-kick-goal checks pass on the reconstruction',
          checks1.every((c) => c.actual === c.expected), checks1);

        // R4 — the unresolved identity stays unresolved, exactly per the importer contract.
        const unresolved = rows1.filter((r) => fixture.expect.get(r.source_record_id)?.playerId === null);
        record('R4 unmatched/ambiguous source rows are stored unlinked (player NULL, match NULL, no guess)',
          unresolved.length >= 1 && unresolved.every((r) => r.player_id === null && r.match_id === null
            && (r.link_status === 'unmatched' || r.link_status === 'ambiguous')),
          unresolved.map((r) => [r.source_record_id, r.player_name_clean, r.link_status, r.candidate_count]));

        // R6 — the complete candidate passes the gate, alone and against a target holding the same set.
        const observed1 = await readFirstKickGoalIdentities(q);
        const pass = judgeFirstKickGoalIdentities({ expected: expectedIds, expectedFrom: FIXTURE_MANIFEST, subject: { role: 'candidate code_test_db', observed: observed1 } });
        const passTarget = judgeFirstKickGoalIdentities({
          expected: expectedIds, expectedFrom: FIXTURE_MANIFEST, subject: { role: 'candidate code_test_db', observed: observed1 },
          target: { role: 'target (captured)', observed: observed1 },
        });
        record('R6 the exact/complete candidate PASSes the gate (alone and against the target)',
          pass.verdict === 'PASS' && passTarget.verdict === 'PASS', { lines: passTarget.lines });

        // R2 — idempotence: the rerun updates in place; nothing new, nothing lost, no drift.
        const semantic1 = semantic(rows1);
        const issues1 = await readOwnedIssues(tx);
        const second = await load();
        const rows2 = await readOwned(tx);
        const issues2 = await readOwnedIssues(tx);
        record('R2 idempotence: rerun inserts 0, deletes 0, keeps every surrogate id and every column (issues refiled identically)',
          second.inserted === 0 && second.deleted === 0 && second.updated === fixture.expect.size
            && semantic(rows2) === semantic1 && JSON.stringify(issues2) === JSON.stringify(issues1)
            && rows2.every((r) => r.import_batch_id === second.batchId),
          { second: { ...second, replay: undefined }, issues: issues1.length });

        // R5 — the catastrophic loss, reproduced and refused; then a partial loss.
        const targetCapture = observed1;
        try {
          await tx.savepoint(async (sp) => {
            await sp`DELETE FROM data_issues WHERE entity_type = 'player_achievements'
                       AND entity_id IN (SELECT a.id FROM player_achievements a JOIN sources s ON s.id = a.source_id WHERE s.key = ${SOURCE_KEY})`;
            await sp`DELETE FROM player_achievements a USING sources s WHERE s.id = a.source_id AND s.key = ${SOURCE_KEY}`;
            const empty = await readFirstKickGoalIdentities(queryOf(sp));
            const vsTarget = judgeFirstKickGoalIdentities({
              expected: expectedIds, expectedFrom: FIXTURE_MANIFEST, subject: { role: 'candidate code_test_db', observed: empty },
              target: { role: 'target (captured before the loss)', observed: targetCapture },
            });
            const alone = judgeFirstKickGoalIdentities({ expected: expectedIds, expectedFrom: FIXTURE_MANIFEST, subject: { role: 'source code_test_db', observed: empty } });
            const checks = await runChecks(sp, expectedIds);
            record('R5 catastrophic loss: target non-empty, candidate 0 -> the gate STOPs (and so does FINAL VALIDATION)',
              vsTarget.verdict === 'FAIL' && alone.verdict === 'FAIL'
                && vsTarget.lines.some((l) => /holds NO first-kick-goal record/.test(l))
                && vsTarget.targetMissing.length === expectedIds.length
                && checks.some((c) => c.actual !== c.expected),
              { lines: vsTarget.lines, checks });
            throw new ForcedRollback('R5 savepoint');
          });
        } catch (error) { if (!(error instanceof ForcedRollback)) throw error; }
        try {
          await tx.savepoint(async (sp) => {
            const victim = expectedIds[0];
            await sp`DELETE FROM data_issues WHERE entity_type = 'player_achievements'
                       AND entity_id IN (SELECT a.id FROM player_achievements a JOIN sources s ON s.id = a.source_id
                                          WHERE s.key = ${SOURCE_KEY} AND a.source_record_id = ${victim})`;
            await sp`DELETE FROM player_achievements a USING sources s
                      WHERE s.id = a.source_id AND s.key = ${SOURCE_KEY} AND a.source_record_id = ${victim}`;
            const partial = judgeFirstKickGoalIdentities({
              expected: expectedIds, expectedFrom: FIXTURE_MANIFEST, subject: { role: 'candidate code_test_db', observed: await readFirstKickGoalIdentities(queryOf(sp)) },
              target: { role: 'target', observed: targetCapture },
            });
            record('R5.b partial loss (one id) -> the gate STOPs naming exactly that id',
              partial.verdict === 'FAIL' && JSON.stringify(partial.missing) === JSON.stringify([victim])
                && JSON.stringify(partial.targetMissing) === JSON.stringify([victim]), { lines: partial.lines });
            throw new ForcedRollback('R5.b savepoint');
          });
        } catch (error) { if (!(error instanceof ForcedRollback)) throw error; }
        const restored = judgeFirstKickGoalIdentities({
          expected: expectedIds, expectedFrom: FIXTURE_MANIFEST, subject: { role: 'candidate code_test_db', observed: await readFirstKickGoalIdentities(q) },
        });
        record('R5.c both savepoints rolled back: the reconstruction is intact and PASSes again', restored.verdict === 'PASS', restored.lines);

        // R8 (opt-in, --real-source) — the REAL pinned source, as the rebuild stage loads it:
        // the tracked provenance and manifest plus the accepted gitignored extract (relocatable
        // by AFLDB_FIRST_KICK_GOAL_CSV, bytes pinned). Judged by the TRACKED manifest, exactly as
        // the promotion checker and FINAL VALIDATION judge afldb_test. Rolled back with the rest.
        if (cmd.realSource) {
          const real = loadPinnedSource(FIRST_KICK_GOAL_PROVENANCE);
          const tracked = trackedExpectedIds();
          try {
            await tx.savepoint(async (sp) => {
              // Empty the owned scope first (the fixture reuses fkg-001.., which would otherwise
              // read as renames), so the real load is a clean reconstruction, as on a rebuild.
              await sp`DELETE FROM data_issues WHERE entity_type = 'player_achievements'
                         AND entity_id IN (SELECT a.id FROM player_achievements a JOIN sources s ON s.id = a.source_id WHERE s.key = ${SOURCE_KEY})`;
              await sp`DELETE FROM player_achievements a USING sources s WHERE s.id = a.source_id AND s.key = ${SOURCE_KEY}`;
              const { resolutions, openingRoundAdjusted } = await resolveFirstKickGoalRows(sp, real.rows);
              const counts = reportResolution(resolutions, openingRoundAdjusted);
              const result = await reconcileFirstKickGoal(sp, {
                rows: real.rows, manifest: real.manifest, joined: real.joined, resolutions, counts,
              }, { allowLinkLoss: false, acceptRenames: [], acceptRetirements: [] });
              const judged = judgeFirstKickGoalIdentities({
                expected: tracked, subject: { role: 'code_test_db (real pinned source)', observed: await readFirstKickGoalIdentities(queryOf(sp)) },
              });
              const checks = await runChecks(sp, tracked);
              record(`R8 real pinned source: ${tracked.length} tracked ids reconstructed on a rebuilt database; `
                + 'tracked-manifest gate and FINAL VALIDATION PASS',
                result.inserted === tracked.length && result.deleted === 0 && judged.verdict === 'PASS'
                  && checks.every((c) => c.actual === c.expected),
                { result: { ...result, replay: undefined }, counts, lines: judged.lines, checks });
              throw new ForcedRollback('R8 savepoint');
            });
          } catch (error) { if (!(error instanceof ForcedRollback)) throw error; }
        }

        throw new ForcedRollback('outer');
      });
    } catch (error) {
      if (!(error instanceof ForcedRollback)) throw error;
    }
  } finally {
    await importer.end({ timeout: 5 });
    if (before) {
      await restoreSequences(owner, before);
      const after = await readFingerprint(owner);
      writeFileSync(join(out, 'fingerprint-after.json'), `${JSON.stringify(after, null, 2)}\n`);
      const same = JSON.stringify(after) === JSON.stringify(before);
      record('R7 residue: fresh-session fingerprint identical to the pre-run state (rows, sequences, schemas, comment, prepared xacts)',
        same, same ? { keys: Object.keys(after).length } : { before, after });
    }
    await owner.end({ timeout: 5 });
    writeFileSync(join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  const failed = evidence.filter((e) => e.verdict === 'FAIL');
  console.log(`\nAFLDB-ISSUE-249 code_test_db rehearsal: ${evidence.length - failed.length}/${evidence.length} PASS`
    + `${failed.length > 0 ? ` — FAILED: ${failed.map((f) => f.scenario.split(' ')[0]).join(', ')}` : ''}`);
  console.log(`evidence: ${out}`);
  return failed.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// The rebuild-runner rehearsal (RR0–RR7)
// ---------------------------------------------------------------------------

export const RUNNER_STAGE_UNDER_TEST = 'first-kick-goal';

/** Thrown from the gated log() the moment executeRebuild announces the stage after the one under test. */
export class RunnerRehearsalHalt extends Error {}

export type RunnerDispatch = { id: string; executed: boolean; status?: number };

/**
 * The runner's real Deps, gated so that executeRebuild — unchanged — walks the REAL plan in its
 * own order while only the stage under test reaches a real dependency:
 *
 *   log         every `==> <name>` must announce the NEXT planned stage (order is asserted, not
 *               assumed); announcing the stage after the one under test throws
 *               RunnerRehearsalHalt before that stage does anything.
 *   runCommand  delegated only while the current stage IS the stage under test, and only with
 *               its exact planned argv and env; any other command stage is recorded as
 *               dispatched-not-executed and answered with status 0 so the walk continues.
 *   runSql      (the destructive reset) and runValidation: never delegated.
 *
 * Pure given `real`; tested DB-free in tests/first-kick-goal-source.test.ts.
 */
export function gateRunnerDeps(stages: readonly Stage[], real: Deps, underTest = RUNNER_STAGE_UNDER_TEST): {
  deps: Deps; dispatched: RunnerDispatch[]; captured: { stdout: string; stderr: string };
} {
  const at = stages.findIndex((s) => s.id === underTest);
  if (at < 0 || stages.filter((s) => s.id === underTest).length !== 1 || at === stages.length - 1) {
    throw new FirstKickGoalRehearsalRefused(
      `The plan must hold exactly one '${underTest}' stage with a stage after it; nothing was run.`);
  }
  const dispatched: RunnerDispatch[] = [];
  const captured = { stdout: '', stderr: '' };
  const current = () => stages[dispatched.length - 1];
  const deps: Deps = {
    log: (line) => {
      if (!line.startsWith('==> ')) { real.log(line); return; }
      const next = stages[dispatched.length];
      if (!next || line !== `==> ${next.name}`) {
        throw new FirstKickGoalRehearsalRefused(
          `executeRebuild announced '${line}' where the plan's next stage is '${next?.id ?? '(none)'}'.`);
      }
      if (dispatched.length === at + 1) throw new RunnerRehearsalHalt(`halted before '${next.id}'`);
      dispatched.push({ id: next.id, executed: false });
      real.log(next.id === underTest ? `${line}   [EXECUTED]` : `${line}   [dispatched; not executed by this rehearsal]`);
    },
    runCommand: (argv, env) => {
      const stage = current();
      if (stage?.id !== underTest) return { status: 0, stdout: '', stderr: '' };
      if (JSON.stringify(argv) !== JSON.stringify(stage.argv)
          || JSON.stringify(env) !== JSON.stringify(stage.envOverlay ?? {})) {
        throw new FirstKickGoalRehearsalRefused(`'${underTest}' was dispatched with an argv or env that is not its planned one.`);
      }
      const result = real.runCommand(argv, env);
      Object.assign(dispatched[dispatched.length - 1], { executed: true, status: result.status });
      captured.stdout += result.stdout;
      captured.stderr += result.stderr;
      return result;
    },
    runSql: () => {
      if (current()?.id === underTest) throw new FirstKickGoalRehearsalRefused(`'${underTest}' reached runSql.`);
    },
    runValidation: () => {
      if (current()?.id === underTest) throw new FirstKickGoalRehearsalRefused(`'${underTest}' reached runValidation.`);
    },
    fileExists: real.fileExists,
  };
  return { deps, dispatched, captured };
}

/** Every column but the surrogate id and the batch, which a separate load legitimately changes. */
function identityFree(rows: readonly OwnedRow[]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([column]) => column !== 'id' && column !== 'import_batch_id'))));
}

const IMPORTER_TOOL = 'tools/records/import-first-kick-goal.ts';

async function runner(cmd: Extract<RehearsalCommand, { step: 'runner' }>): Promise<number> {
  const out = resolve(cmd.out);
  mkdirSync(out, { recursive: true });
  const evidence: Evidence[] = [];
  const record = (scenario: string, ok: boolean, detail: unknown) => {
    evidence.push({ scenario, verdict: ok ? 'PASS' : 'FAIL', detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${scenario}`);
    if (!ok) console.log(`       ${JSON.stringify(detail)}`);
  };

  // RR0 — the runner's OWN target resolution: every database-name guard, the dedicated
  // code_test_db variables, and the restricted import role (no owner substitution offered).
  const rebuildOpts = parseRebuildArgs(['--target', FKG_REHEARSAL.database]);
  const target = resolveTarget(process.env, rebuildOpts);
  if (target.database !== FKG_REHEARSAL.database || target.importIsOwnerSubstitution
      || databaseOf(target.importDsn) !== FKG_REHEARSAL.database) {
    throw new FirstKickGoalRehearsalRefused(
      `The runner resolved '${target.database}' (owner substitution: ${target.importIsOwnerSubstitution}); `
      + `this rehearsal runs on ${FKG_REHEARSAL.database} with the restricted import role only. Nothing was run.`);
  }
  const cli = createCliDeps(spawnSync);
  const tracked = trackedExpectedIds();

  const owner = connect(target.adminDsn);
  const importer = connect(target.importDsn);
  let before: Fingerprint | undefined;
  let maxBatchBefore = '0';
  let maxIssueBefore = '0';
  let stageDispatched = false;
  try {
    const roles: Record<string, string> = {};
    for (const [role, sql] of [['owner', owner], ['import', importer]] as const) {
      const [{ d, u }] = await sql<{ d: string; u: string }[]>`SELECT current_database() AS d, current_user AS u`;
      assertRehearsalDatabase(d);
      roles[role] = u;
      console.log(`${role} connection: ${d} as ${u}`);
    }
    const [{ others }] = await owner<{ others: number }[]>`
      SELECT count(*)::int AS others FROM pg_stat_activity
       WHERE datname = current_database() AND backend_type = 'client backend'
         AND application_name <> ${FKG_REHEARSAL.applicationName}`;
    if (others > 0) throw new FirstKickGoalRehearsalRefused(`${others} other client session(s) are attached to code_test_db.`);
    const [{ owned, overrides }] = await owner<{ owned: number; overrides: number }[]>`
      SELECT (SELECT count(*)::int FROM player_achievements a JOIN sources s ON s.id = a.source_id
               WHERE s.key = ${SOURCE_KEY}) AS owned,
             (SELECT count(*)::int FROM data_overrides WHERE entity_type = 'player_achievements' AND is_active) AS overrides`;
    if (owned > 0 || overrides > 0) {
      throw new FirstKickGoalRehearsalRefused(
        `code_test_db already holds ${owned} ${SOURCE_KEY} row(s) and ${overrides} active player_achievements `
        + 'override(s): the committed stage could not be removed exactly afterwards. Nothing was run.');
    }
    before = await readFingerprint(owner);
    writeFileSync(join(out, 'runner-fingerprint-before.json'), `${JSON.stringify(before, null, 2)}\n`);
    // Watermarks for the exact removal in RR7: nothing else writes here (no other session).
    [{ b: maxBatchBefore, i: maxIssueBefore }] = await owner<{ b: string; i: string }[]>`
      SELECT (SELECT coalesce(max(id), 0) FROM import_batches)::text AS b,
             (SELECT coalesce(max(id), 0) FROM data_issues)::text AS i`;
    record('RR0 rebuild-test.ts parseArgs/resolveTarget resolve code_test_db from its dedicated variables, restricted import role; '
      + 'both connections land on code_test_db; family empty, no active override, no other session',
    roles.import !== roles.owner, { roles, importIsOwnerSubstitution: target.importIsOwnerSubstitution });

    // RR1 — the REAL plan: where the stage sits, and exactly what it runs.
    const stages = planStages(target, resolveFitzroySource(rebuildOpts), rebuildOpts);
    const ids = stages.map((s) => s.id);
    const at = ids.indexOf(RUNNER_STAGE_UNDER_TEST);
    const stage = stages[at];
    const planProblems: string[] = [];
    if (at < 0 || ids.lastIndexOf(RUNNER_STAGE_UNDER_TEST) !== at) planProblems.push('not exactly one first-kick-goal stage');
    for (const earlier of ['recreate', 'migrations', 'privileges', 'fitzroy', 'draftguru',
      'afl-api-adjudications-bijection', 'derived', 'coleman']) {
      if (!(ids.indexOf(earlier) >= 0 && ids.indexOf(earlier) < at)) planProblems.push(`${earlier} is not before it`);
    }
    if (ids[at + 1] !== 'ladder-witness' || ids[ids.length - 1] !== 'fingerprints') planProblems.push('not followed by ladder-witness ... fingerprints');
    if (stage?.kind !== 'data' || stage.run !== 'command') planProblems.push('not a data command stage');
    if (JSON.stringify(stage?.argv) !== JSON.stringify(firstKickGoalArgv())) planProblems.push('argv is not firstKickGoalArgv()');
    const envKeys = Object.keys(stage?.envOverlay ?? {});
    if (JSON.stringify(envKeys) !== JSON.stringify(['AFLDB_IMPORT_DATABASE_URL'])
        || stage.envOverlay!.AFLDB_IMPORT_DATABASE_URL !== target.importDsn) planProblems.push('env is not the target import DSN');
    const fingerprintSql = stages[ids.length - 1]?.sql ?? '';
    if (!fingerprintSql.includes('first_kick_goal_id_set_mismatch')) planProblems.push('FINAL VALIDATION lacks the family checks');
    record('RR1 planStages(code_test_db) schedules exactly one first-kick-goal DATA stage after recreate/migrations/fitzroy/'
      + 'draftguru/bijection/derived/coleman and before ladder-witness and FINAL VALIDATION, with the pinned argv and the '
      + 'target import DSN; FINAL VALIDATION carries the family checks',
    planProblems.length === 0,
    { problems: planProblems, position: `${at + 1} of ${ids.length}`, order: ids, argv: stage?.argv, envKeys });
    if (planProblems.length > 0) throw new FirstKickGoalRehearsalRefused('The plan is wrong; the stage was not run.');

    // RR1.b — PRECHECK's pinned --validate-only, through the runner's own runCommand.
    const pre = cli.runCommand(firstKickGoalValidateArgv(), {});
    const preOk = pre.status === 0 && /exact manifest join; no database touched/.test(pre.stdout);
    record('RR1.b PRECHECK\'s first-kick-goal --validate-only, via the runner\'s runCommand: the pinned extract + manifest are intact',
      preOk, { status: pre.status, tail: pre.stdout.trim().split('\n').slice(-1) });
    if (!preOk) throw new FirstKickGoalRehearsalRefused('The pinned inputs are not intact; the stage was not run.');

    // RR2 — the reference: the importer's own phases on this database, rolled back.
    const pinned = loadPinnedSource(FIRST_KICK_GOAL_PROVENANCE);
    let reference!: { rows: string; issues: string[]; n: number };
    try {
      await importer.begin(async (tx) => {
        const { resolutions, openingRoundAdjusted } = await resolveFirstKickGoalRows(tx, pinned.rows);
        const counts = reportResolution(resolutions, openingRoundAdjusted);
        await reconcileFirstKickGoal(tx, { rows: pinned.rows, manifest: pinned.manifest, joined: pinned.joined, resolutions, counts },
          { allowLinkLoss: false, acceptRenames: [], acceptRetirements: [] });
        const rows = await readOwned(tx);
        reference = { rows: identityFree(rows), issues: await readOwnedIssues(tx), n: rows.length };
        throw new ForcedRollback('reference');
      });
    } catch (error) { if (!(error instanceof ForcedRollback)) throw error; }
    record('RR2 reference: the importer\'s own resolve + write phases on code_test_db, rolled back',
      reference.n === tracked.length, { rows: reference.n, dataIssues: reference.issues.length });

    // RR3 — executeRebuild over the WHOLE plan; only first-kick-goal executes; halt after it.
    const gated = gateRunnerDeps(stages, cli);
    let report: ExecutionReport | undefined;
    let halted = false;
    stageDispatched = true;
    try {
      report = executeRebuild(stages, target, gated.deps);
    } catch (error) {
      if (!(error instanceof RunnerRehearsalHalt)) throw error;
      halted = true;
    }
    const executed = gated.dispatched.filter((d) => d.executed);
    record('RR3 executeRebuild walked the real plan in order, executed ONLY first-kick-goal (exit 0) through the runner\'s '
      + 'runCommand, and halted before ladder-witness',
    halted && report === undefined
      && JSON.stringify(gated.dispatched.map((d) => d.id)) === JSON.stringify(ids.slice(0, at + 1))
      && executed.length === 1 && executed[0].id === RUNNER_STAGE_UNDER_TEST && executed[0].status === 0,
    { halted, report, dispatched: gated.dispatched.length, executed, notRun: ids.slice(at + 1),
      stageOutputTail: `${gated.captured.stdout}${gated.captured.stderr}`.trim().split('\n').slice(-6) });

    // RR4 — what the stage COMMITTED, read in a fresh read-only transaction.
    await owner.begin('read only', async (tx) => {
      const rows = await readOwned(tx);
      const issues = await readOwnedIssues(tx);
      const batches = [...new Set(rows.map((r) => r.import_batch_id))];
      const batchId = batches.length === 1 && typeof batches[0] === 'string' ? batches[0] : null;
      const [batch] = batchId === null ? [] : await tx<{ tool: string; status: string; records_read: number }[]>`
        SELECT tool, status, records_read::int AS records_read FROM import_batches WHERE id = ${batchId}::bigint`;
      const heldIds = rows.map((r) => r.source_record_id).sort();
      const links = rows.reduce<Record<string, number>>((acc, r) => {
        const k = String(r.link_status); acc[k] = (acc[k] ?? 0) + 1; return acc;
      }, {});
      record('RR4 the stage committed exactly the tracked manifest set, row-for-row identical to the reference '
        + '(every column but surrogate id and batch, and its data issues), in one completed import batch',
      rows.length === tracked.length && JSON.stringify(heldIds) === JSON.stringify([...tracked].sort())
        && identityFree(rows) === reference.rows && JSON.stringify(issues) === JSON.stringify(reference.issues)
        && batch?.tool === IMPORTER_TOOL && batch.records_read === tracked.length,
      { rows: rows.length, distinctIds: new Set(heldIds).size, links, dataIssues: issues.length, batch });
    });

    // RR5 — FINAL VALIDATION: the family's checks through the runner's own runValidation …
    let validationError: string | null = null;
    try { cli.runValidation(target.adminDsn, buildFinalValidationSql(firstKickGoalChecks())); } catch (error) {
      validationError = (error as Error).message;
    }
    record('RR5 the family\'s FINAL VALIDATION checks (buildFinalValidationSql(firstKickGoalChecks())) pass through the '
      + 'runner\'s runValidation', validationError === null, { validationError });
    // … and the COMPLETE planned FINAL VALIDATION stream, read for its first-kick-goal lines.
    // Its other domains belong to code_test_db's earlier rebuild and are reported, not judged.
    let stream: { status: number; stdout: string; stderr: string };
    try {
      stream = runPsql(target.adminDsn, fingerprintSql, { spawn: spawnSync as SpawnSyncLike, cwd: PROJECT_ROOT });
    } catch (error) {
      stream = { status: -1, stdout: '', stderr: (error as Error).message };
    }
    const streamLines = `${stream.stdout}\n${stream.stderr}`.split(/\r?\n/);
    const familyLines = streamLines.filter((l) => l.includes(`${FINAL_VALIDATION_MARKER} first_kick_goal_`))
      .map((l) => l.replace(/^.*?(AFLDB-FINAL-VALIDATION)/, '$1'));
    const familyOk = familyLines.length === 4 && familyLines.every((l) => {
      const m = / = (\d+) \(expected (\d+)\)$/.exec(l);
      return m !== null && m[1] === m[2];
    });
    record('RR5.b the complete planned FINAL VALIDATION stream measures all four first-kick-goal checks at their expected values',
      familyOk, { familyLines, streamExit: stream.status,
        streamVerdict: streamLines.find((l) => /AFLDB-FINAL-VALIDATION (PASSED|FAILED)/.test(l))?.replace(/^.*?(AFLDB-FINAL-VALIDATION)/, '$1') ?? null });

    // RR6 — ownership: a manual (non-manifest) first-kick-goal row is not a manifest member.
    // The committed family plus one manual_admin_edit row, in a transaction that always rolls back.
    try {
      await importer.begin(async (tx) => {
        const [manual] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'manual_admin_edit'`;
        if (!manual) throw new FirstKickGoalRehearsalRefused('code_test_db has no manual_admin_edit source.');
        await tx`
          INSERT INTO player_achievements (achievement_type, player_name_raw, player_name_clean, club_name_raw, season,
            round_raw, status, source_id, source_record_id, player_id, link_status_value, match_id)
          VALUES ('first_kick_goal'::player_achievement_type, 'Zz Issuefortynine Manual', 'Zz Issuefortynine Manual',
            ${FKG_REHEARSAL.unmatchedClub}, ${FKG_REHEARSAL.unmatchedSeason}::smallint, ${FKG_REHEARSAL.unmatchedRound},
            'active', ${manual.id}, ${`first_kick_goal:${randomUUID()}`}, NULL, 'unmatched'::link_status, NULL)`;
        const [{ family }] = await tx<{ family: number }[]>`
          SELECT count(*)::int AS family FROM player_achievements WHERE achievement_type::text = ${ACHIEVEMENT_TYPE}`;
        const observed = await readFirstKickGoalIdentities(queryOf(tx));
        const judged = judgeFirstKickGoalIdentities({
          expected: tracked, subject: { role: 'candidate code_test_db (+1 manual row)', observed },
          target: { role: 'target (same state)', observed },
        });
        const checks = await runChecks(tx, tracked);
        record(`RR6 manifest set + 1 manual_admin_edit row: ${tracked.length + 1} first-kick-goal rows, gate PASS on the `
          + `${tracked.length} manifest ids, FINAL VALIDATION checks pass`,
        family === tracked.length + 1 && judged.verdict === 'PASS' && judged.unknown.length === 0
          && checks.every((c) => c.actual === c.expected),
        { family, lines: judged.lines, checks });
        try {
          await tx.savepoint(async (sp) => {
            const victim = tracked[0];
            await sp`DELETE FROM data_issues WHERE entity_type = 'player_achievements'
                       AND entity_id IN (SELECT a.id FROM player_achievements a JOIN sources s ON s.id = a.source_id
                                          WHERE s.key = ${SOURCE_KEY} AND a.source_record_id = ${victim})`;
            await sp`DELETE FROM player_achievements a USING sources s
                      WHERE s.id = a.source_id AND s.key = ${SOURCE_KEY} AND a.source_record_id = ${victim}`;
            const lost = judgeFirstKickGoalIdentities({
              expected: tracked, subject: { role: 'candidate code_test_db (+1 manual row, -1 manifest id)', observed: await readFirstKickGoalIdentities(queryOf(sp)) },
              target: { role: 'target', observed },
            });
            const lostChecks = await runChecks(sp, tracked);
            record('RR6.b the manual row still present, one manifest id removed -> the gate STOPs naming exactly that id; '
              + 'FINAL VALIDATION fails',
            lost.verdict === 'FAIL' && JSON.stringify(lost.missing) === JSON.stringify([victim])
              && JSON.stringify(lost.targetMissing) === JSON.stringify([victim]) && lost.unknown.length === 0
              && lostChecks.some((c) => c.actual !== c.expected),
            { lines: lost.lines, checks: lostChecks });
            throw new ForcedRollback('RR6.b');
          });
        } catch (error) { if (!(error instanceof ForcedRollback)) throw error; }
        throw new ForcedRollback('RR6');
      });
    } catch (error) { if (!(error instanceof ForcedRollback)) throw error; }
  } finally {
    await importer.end({ timeout: 5 });
    if (before) {
      // RR7 — remove what the real stage committed, exactly: the pre-run family was empty, and
      // its data issues are every player_achievements issue above the pre-run watermark —
      // including the importer's table-level `source_count_discrepancy` row, which has no entity.
      if (stageDispatched) {
        const removed = await owner.begin(async (tx) => {
          const issues = await tx`
            DELETE FROM data_issues WHERE entity_type = 'player_achievements' AND id > ${maxIssueBefore}::bigint`;
          const rows = await tx`
            DELETE FROM player_achievements a USING sources s
             WHERE s.id = a.source_id AND s.key = ${SOURCE_KEY} AND a.achievement_type::text = ${ACHIEVEMENT_TYPE}`;
          const batches = await tx`DELETE FROM import_batches WHERE tool = ${IMPORTER_TOOL} AND id > ${maxBatchBefore}::bigint`;
          return { dataIssues: issues.count, rows: rows.count, importBatches: batches.count };
        });
        console.log(`removed the stage's committed state: ${JSON.stringify(removed)}`);
        evidence.push({ scenario: 'RR7.a removal of the stage\'s committed rows', verdict: 'PASS', detail: removed });
      }
      await restoreSequences(owner, before);
      const after = await readFingerprint(owner);
      writeFileSync(join(out, 'runner-fingerprint-after.json'), `${JSON.stringify(after, null, 2)}\n`);
      const same = JSON.stringify(after) === JSON.stringify(before);
      record('RR7 residue: fresh-session fingerprint identical to the pre-run state (rows, sequences, schemas, comment, prepared xacts)',
        same, same ? { keys: Object.keys(after).length } : { before, after });
    }
    await owner.end({ timeout: 5 });
    writeFileSync(join(out, 'runner-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  const failed = evidence.filter((e) => e.verdict === 'FAIL');
  console.log(`\nAFLDB-ISSUE-249 code_test_db REBUILD-RUNNER rehearsal: ${evidence.length - failed.length}/${evidence.length} PASS`
    + `${failed.length > 0 ? ` — FAILED: ${failed.map((f) => f.scenario.split(' ')[0]).join(', ')}` : ''}`);
  console.log(`evidence: ${out}`);
  return failed.length === 0 ? 0 : 1;
}

async function residue(): Promise<number> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: true });
  const owner = connect(dsns.ownerDsn);
  try {
    const [{ d }] = await owner<{ d: string }[]>`SELECT current_database() AS d`;
    assertRehearsalDatabase(d);
    console.log(JSON.stringify(await readFingerprint(owner), null, 2));
    return 0;
  } finally {
    await owner.end({ timeout: 5 });
  }
}

if (process.argv[1] && /first-kick-goal-rehearsal\.ts$/.test(process.argv[1])) {
  const cmd = (() => {
    try { return parseFkgRehearsalArgs(process.argv.slice(2)); } catch (error) {
      console.error(`REFUSED: ${(error as Error).message}`);
      process.exit(2);
    }
  })();
  (cmd.step === 'run' ? run(cmd) : cmd.step === 'runner' ? runner(cmd) : residue())
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`REFUSED: ${(error as Error).message}`);
      process.exit(1);
    });
}
