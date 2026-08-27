import './guard';

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';

import { lockBirthDateEnrichment, unlockBirthDateEnrichment } from './draft-lock';
import { createImportRoleParityHarness } from './import-role-parity';

/**
 * AFLDB-ISSUE-090 — DOB enrichment conflict writes are not pass-scoped or
 * idempotent. Deterministic regression suite for both enrichment passes
 * (tools/migration/enrich_birth_dates.py, ..._from_club_lists.py) and
 * migration 072 (src/db/migrations/072_dob_conflict_ownership.sql).
 *
 * Core correctness does not depend on the network, the real historical
 * club-list CSVs, or a developer-owned AFLDB_LEGACY_SQLITE: club-list
 * fixtures are tiny CSVs written to a temp dir; the register fixture is a
 * temp SQLite built with Python's stdlib sqlite3, pointed at via
 * AFLDB_LEGACY_SQLITE for the duration of one importer invocation.
 *
 * Fixture players are always named "Test Issue090Fixture<n>" so afterEach
 * can find and remove every trace of them (and their data_issues rows,
 * which carry no foreign key) after each test, independent of whether the
 * test passed. tests/integration/draft-lock.ts's birth-date enrichment
 * lock is held file-level, beside honours, for the whole file: this suite
 * writes dob_conflict/dob_internal_conflict/players.dob_disputed, which
 * release-gates.test.ts -> `gate: birth dates` reads as a steady-state
 * invariant.
 */
const integrationDsn = process.env.AFLDB_TEST_DATABASE_URL as string;

const root = process.cwd();
// .venv layout differs by platform: POSIX venvs put the interpreter under
// bin/, Windows venvs under Scripts/ with a .exe suffix.
const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}
const importRole = createImportRoleParityHarness(
  integrationDsn,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
const canRun = hasPsycopg() && importRole.isConfigured;
const roleParitySuffix = importRole.isConfigured ? '' : ` — ${importRole.skipMessage}`;

// ---------------------------------------------------------------------
// Migration 072: exercised by re-executing verbatim slices of the real
// file (never a re-implementation), sliced on the section banners it
// already carries. Migration 072 itself only ever runs once (applied by
// `npm run db:migrate`), so tests 15-18 re-run its SQL directly against
// dedicated fixture rows to prove the shipped logic, not a copy of it.
// ---------------------------------------------------------------------
const MIGRATION_072_PATH = join(root, 'src', 'db', 'migrations', '072_dob_conflict_ownership.sql');
const migration072Sql = readFileSync(MIGRATION_072_PATH, 'utf8');

function sliceMigration(fromMarker: string, toMarker: string): string {
  const from = migration072Sql.indexOf(fromMarker);
  const to = migration072Sql.indexOf(toMarker, from);
  if (from === -1 || to === -1) {
    throw new Error(`migration 072 marker not found: ${from === -1 ? fromMarker : toMarker}`);
  }
  return migration072Sql.slice(from, to);
}

const PRECONDITIONS_SQL = sliceMigration('-- 1. Fail-closed', '-- 2/3. Normalise');
const NORMALISE_SQL = sliceMigration('-- 2/3. Normalise', '-- 4-9. Losslessly');
const MERGE_AND_DELETE_SQL = sliceMigration('-- 4-9. Losslessly', '-- 11. D5');

// Migration 072 only ever runs once (applied by `npm run db:migrate`).
// Tests 15/16/17/17b/18 assert its normalise/merge/precondition/index
// behaviour and, for the duplicate-group scenarios, temporarily drop and
// recreate its unique index around their own fixture rows. Before 072 has
// applied, that index does not exist yet, and an unconditional
// `CREATE UNIQUE INDEX IF NOT EXISTS` in a `finally` block would create it
// early as a test side effect -- breaking 072's own (deliberately
// non-`IF NOT EXISTS`) `CREATE UNIQUE INDEX` when it later runs for real.
// This gate is read-only: it checks the authoritative migration ledger
// (afldb_meta.schema_migrations, the same table tools/db/migrate.ts writes
// to) and never creates, drops or otherwise changes schema merely to
// decide whether these tests should run.
const migration072Applied = await sql<{ applied: boolean }[]>`
  SELECT EXISTS (
    SELECT 1 FROM afldb_meta.schema_migrations
     WHERE name = '072_dob_conflict_ownership.sql'
  ) AS applied
`.then((rows) => rows[0]?.applied ?? false);

async function withoutUniqueIndex(fn: () => Promise<void>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_data_issues_open_dob_per_player`;
  try {
    await fn();
  } finally {
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_data_issues_open_dob_per_player
        ON data_issues (entity_type, entity_id, issue_type)
        WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict') AND resolved_at IS NULL
    `;
  }
}

// ---------------------------------------------------------------------
// Fixture players and clubs
// ---------------------------------------------------------------------
const UNIVERSITY_CSV = 'University_-_All_Time_Player_List.csv';
const BRISBANE_CSV = 'Brisbane_Bears_-_All_Time_Player_List.csv';
const CSV_HEADER = 'Cap,#,Player,DOB,HT,WT,Games (W-D-L),Goals,Seasons,Debut,Last';

let universityClubId = 0;
let brisbaneClubId = 0;
let fixtureCounter = 0;
let legacyIdCounter = 900_000_000;

function nextTag(): string {
  fixtureCounter += 1;
  return String(fixtureCounter);
}

function nextLegacyId(): number {
  legacyIdCounter += 1;
  return legacyIdCounter;
}

async function createFixturePlayer(opts: {
  dob?: string | null;
  clubIds?: number[];
  games?: number;
  goals?: number;
  legacyPlayerId?: number;
} = {}): Promise<{ id: number; surname: string; legacyPlayerId: number | null }> {
  const tag = nextTag();
  const surname = `Issue090Fixture${tag}`;
  const given = 'Test';
  const searchName = `${given.toLowerCase()} ${surname.toLowerCase()}`;
  const dob = opts.dob ?? null;
  const dobConfidence = dob ? 'sourced' : 'unknown';
  const legacyPlayerId = opts.legacyPlayerId ?? null;

  const [player] = await sql<{ id: number }[]>`
    INSERT INTO players
      (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname,
       dob, dob_confidence)
    VALUES (${legacyPlayerId}, ${`${given} ${surname}`}, ${`${surname}, ${given}`},
            ${searchName}, ${`issue090-fixture-${tag}`}, ${given}, ${surname},
            ${dob}, ${dobConfidence}::value_confidence)
    RETURNING id
  `;

  const games = opts.games ?? 50;
  const goals = opts.goals ?? 10;
  for (const clubId of opts.clubIds ?? []) {
    await sql`
      INSERT INTO player_clubs (player_id, club_id, games, goals, first_season, last_season)
      VALUES (${player.id}, ${clubId}, ${games}, ${goals}, 2000, 2005)
    `;
  }

  return { id: player.id, surname, legacyPlayerId };
}

function csvRow(cap: number, surname: string, dob: string, games = 50, goals = 10): string {
  const playerField = `"${surname}, Test"`;
  return [String(cap), '1', playerField, dob, '180cm', '80kg',
    `${games} (0-0-${games})`, String(goals), '2000-2005', '', ''].join(',');
}

function writeClubListCsv(dir: string, fileName: string, rows: string[]): void {
  writeFileSync(join(dir, fileName), [CSV_HEADER, ...rows].join('\n') + '\n', 'utf8');
}

function expectSuccess(result: SpawnSyncReturns<string>, label: string): void {
  if (result.status !== 0) {
    throw new Error(
      `${label} exited ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function runClubList(csvDir: string): SpawnSyncReturns<string> {
  return importRole.spawn(
    python,
    ['tools/migration/enrich_birth_dates_from_club_lists.py', '--quiet', '--csv-dir', csvDir],
    { cwd: root },
  );
}

function buildRegisterFixtureDb(
  path: string,
  rows: Array<{ profileUrl: string; dobRaw: string; legacyId: number }>,
): void {
  const script = [
    'import json, sqlite3',
    `con = sqlite3.connect(${JSON.stringify(path)})`,
    'cur = con.cursor()',
    'cur.execute("CREATE TABLE afltables_player_index (profile_url TEXT, player_id INTEGER)")',
    'cur.execute("CREATE TABLE club_player_register (player_url TEXT, raw_row_json TEXT)")',
    `rows = ${JSON.stringify(rows)}`,
    'for r in rows:',
    '    cur.execute("INSERT INTO afltables_player_index VALUES (?, ?)", (r["profileUrl"], r["legacyId"]))',
    '    payload = {"DOB HT WT Games (W-D-L) Goals Seasons Debut Last": r["dobRaw"]}',
    '    cur.execute("INSERT INTO club_player_register VALUES (?, ?)", (r["profileUrl"], json.dumps(payload)))',
    'con.commit()',
    'con.close()',
  ].join('\n');
  const result = spawnSync(python, ['-c', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`failed to build register fixture sqlite: ${result.stderr}`);
  }
}

// AFLDB-ISSUE-092 §5: every real register-pass invocation from this suite
// runs under a dedicated fixture sources row, so its reads/writes/deletes
// are structurally scoped away from the real `afltables` population
// regardless of the fixture register's size — independent of the §4
// fail-closed gate, which stays active as defence in depth.
const FIXTURE_SOURCE_KEY = 'afltables_issue090_fixture';
let fixtureSourceId = 0;

function runRegister(
  sqlitePath: string,
  extraArgs: string[] = [],
): SpawnSyncReturns<string> {
  return importRole.spawn(
    python,
    ['tools/migration/enrich_birth_dates.py', '--quiet',
      '--source-key', FIXTURE_SOURCE_KEY, ...extraArgs],
    {
      cwd: root,
      env: { AFLDB_LEGACY_SQLITE: sqlitePath },
    },
  );
}

type IssueRow = { id: number; details: Record<string, unknown> };

async function unresolvedDobConflict(entityId: number): Promise<IssueRow[]> {
  return sql<IssueRow[]>`
    SELECT id, details FROM data_issues
     WHERE entity_type = 'player' AND entity_id = ${entityId}
       AND issue_type = 'dob_conflict' AND resolved_at IS NULL
  `;
}

// Deletes every row this suite's fixture players own, in FK-safe order,
// matched only by the Issue090Fixture display-name marker. player_clubs
// and player_birth_evidence both have ON DELETE CASCADE on player_id and
// need no explicit statement; external_identities does not (a stored
// third-party match must survive an unrelated player deletion elsewhere),
// so the register pass's fixture-owned external_identities rows
// (enrich_birth_dates.py:528, keyed on the fixture's AFL Tables profile
// URL) must be removed before the fixture players themselves, or the
// DELETE FROM players statement fails its FK check for every id in the
// batch, not just the offending one -- leaving the whole batch stuck.
// Idempotent: a no-op when no Issue090Fixture rows remain.
async function cleanupIssue090Fixtures(): Promise<void> {
  const fixtures = await sql<{ id: number }[]>`
    SELECT id FROM players WHERE display_name LIKE '%Issue090Fixture%'
  `;
  const ids = fixtures.map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM external_identities WHERE player_id = ANY(${ids})`;
    await sql`DELETE FROM data_issues WHERE entity_type = 'player' AND entity_id = ANY(${ids})`;
    await sql`DELETE FROM players WHERE id = ANY(${ids})`;
  }
  // §5.4: keep the fixture source's own external_identities population at
  // zero between runs — cosmetic cleanliness, not a safety requirement
  // (the fixture source can never touch real data either way).
  if (fixtureSourceId) {
    await sql`DELETE FROM external_identities WHERE source_id = ${fixtureSourceId}`;
  }
}

describe.skipIf(!canRun)(
  `DOB enrichment issue reconciliation (AFLDB-ISSUE-090)${roleParitySuffix}`,
  () => {
  let issueSnapshot: Array<{
    id: number; entityType: string; entityId: number | null; issueType: string;
    severity: string; description: string; details: unknown; detectedAt: string;
    resolvedAt: string | null; resolution: string | null;
  }> = [];
  let playerSnapshot: Array<{
    id: number; dob: string | null; dobDisputed: boolean; dobConfidence: string;
    birthYear: number | null; birthYearMin: number | null; birthYearMax: number | null;
    birthYearConfidence: string; dobEvidenceId: number | null;
  }> = [];

  beforeAll(async () => {
    await importRole.validate();
    await lockBirthDateEnrichment(integrationDsn);

    // §5.1: dedicated fixture source, seeded idempotently at runtime (not
    // a migration). external_identities_uq is (source_id, external_id), so
    // rows under this source can never collide with real `afltables` rows.
    await sql`
      INSERT INTO sources (key, name, kind, description)
      VALUES (${FIXTURE_SOURCE_KEY}, 'ISSUE-090 test fixture source', 'manual',
              'Runtime fixture for dob-enrichment-issues.test.ts; never holds real data.')
      ON CONFLICT (key) DO NOTHING
    `;
    const [src] = await sql<{ id: number }[]>`
      SELECT id FROM sources WHERE key = ${FIXTURE_SOURCE_KEY}
    `;
    fixtureSourceId = src.id;

    // Recover residue an earlier interrupted/failed run left behind
    // (e.g. an afterEach that died mid-suite on the FK defect this fixed)
    // before the snapshot below runs, so a prior crash cannot poison this
    // run's blast-radius baseline or its fixture-id numbering.
    await cleanupIssue090Fixtures();

    const [uni] = await sql<{ id: number }[]>`
      SELECT c.id FROM clubs c JOIN club_organizations o ON o.id = c.organization_id
       WHERE o.name = 'University' LIMIT 1
    `;
    const [bris] = await sql<{ id: number }[]>`
      SELECT c.id FROM clubs c JOIN club_organizations o ON o.id = c.organization_id
       WHERE o.name = 'Brisbane Bears' LIMIT 1
    `;
    if (!uni || !bris) {
      throw new Error('fixture club organizations (University / Brisbane Bears) not found in afldb_test');
    }
    universityClubId = uni.id;
    brisbaneClubId = bris.id;

    issueSnapshot = await sql`
      SELECT id, entity_type AS "entityType", entity_id AS "entityId",
             issue_type AS "issueType", severity::text AS severity,
             description, details, detected_at::text AS "detectedAt",
             resolved_at::text AS "resolvedAt", resolution
        FROM data_issues
       WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict')
    `;
    const entityIds = [...new Set(
      issueSnapshot.map((r) => r.entityId).filter((x): x is number => x != null),
    )];
    if (entityIds.length) {
      playerSnapshot = await sql`
        SELECT id, dob::text AS dob, dob_disputed AS "dobDisputed",
               dob_confidence::text AS "dobConfidence", birth_year AS "birthYear",
               birth_year_min AS "birthYearMin", birth_year_max AS "birthYearMax",
               birth_year_confidence::text AS "birthYearConfidence",
               dob_evidence_id AS "dobEvidenceId"
          FROM players WHERE id = ANY(${entityIds})
      `;
    }
  }, 300_000);

  afterEach(async () => {
    await cleanupIssue090Fixtures();
  });

  afterAll(async () => {
    // Blast-radius guard (Sec 14): restore every dob_conflict/
    // dob_internal_conflict row and affected player column this file's
    // beforeAll observed, whatever this run did to them.
    const current = await sql<{ id: number }[]>`
      SELECT id FROM data_issues WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict')
    `;
    const currentIds = new Set(current.map((r) => r.id));
    const snapshotIds = new Set(issueSnapshot.map((r) => r.id));

    const extraneous = [...currentIds].filter((id) => !snapshotIds.has(id));
    if (extraneous.length) {
      await sql`DELETE FROM data_issues WHERE id = ANY(${extraneous})`;
    }
    for (const row of issueSnapshot) {
      if (currentIds.has(row.id)) {
        await sql`
          UPDATE data_issues
             SET entity_type = ${row.entityType}, entity_id = ${row.entityId},
                 issue_type = ${row.issueType}, severity = ${row.severity}::issue_severity,
                 description = ${row.description}, details = ${sql.json(row.details as never)},
                 detected_at = ${row.detectedAt}, resolved_at = ${row.resolvedAt},
                 resolution = ${row.resolution}
           WHERE id = ${row.id}
        `;
      } else {
        await sql`
          INSERT INTO data_issues OVERRIDING SYSTEM VALUE
            (id, entity_type, entity_id, issue_type, severity, description, details,
             detected_at, resolved_at, resolution)
          VALUES (${row.id}, ${row.entityType}, ${row.entityId}, ${row.issueType},
                  ${row.severity}::issue_severity, ${row.description}, ${sql.json(row.details as never)},
                  ${row.detectedAt}, ${row.resolvedAt}, ${row.resolution})
        `;
      }
    }
    for (const row of playerSnapshot) {
      await sql`
        UPDATE players
           SET dob = ${row.dob}, dob_disputed = ${row.dobDisputed},
               dob_confidence = ${row.dobConfidence}::value_confidence,
               birth_year = ${row.birthYear}, birth_year_min = ${row.birthYearMin},
               birth_year_max = ${row.birthYearMax},
               birth_year_confidence = ${row.birthYearConfidence}::value_confidence,
               dob_evidence_id = ${row.dobEvidenceId}
         WHERE id = ${row.id}
      `;
    }

    await unlockBirthDateEnrichment();
    await sql.end();
  });

  // ---------------------------------------------------------------------
  // Club-list pass
  // ---------------------------------------------------------------------
  describe('club-list pass', () => {
    it('tests 1/2: rerunning is idempotent and the issue identity is stable', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(101, fp.surname, '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run 1');
        const first = await unresolvedDobConflict(fp.id);
        expect(first).toHaveLength(1);

        expectSuccess(runClubList(dir), 'club-list run 2 (rerun)');
        const second = await unresolvedDobConflict(fp.id);
        expect(second).toHaveLength(1);
        expect(second[0].id).toBe(first[0].id);
        expect(second[0].details).toEqual(first[0].details);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 3: two club files retain distinct assertions for one player', async () => {
      const fp = await createFixturePlayer({
        dob: '1950-01-01', clubIds: [universityClubId, brisbaneClubId],
      });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(102, fp.surname, '1950-02-02')]);
        writeClubListCsv(dir, BRISBANE_CSV, [csvRow(103, fp.surname, '1950-03-03')]);
        expectSuccess(runClubList(dir), 'club-list run');

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        const clubList = (rows[0].details.disputed_by as any).club_list as Array<{ club: string }>;
        expect(clubList).toHaveLength(2);
        expect(clubList.map((a) => a.club).sort()).toEqual(['brisbane-bears', 'university']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 6: an unprocessed file\'s scope is untouched by a partial run', async () => {
      const fp = await createFixturePlayer({
        dob: '1950-01-01', clubIds: [universityClubId, brisbaneClubId],
      });
      const bothDir = mkdtempSync(join(tmpdir(), 'issue090-'));
      const partialDir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(bothDir, UNIVERSITY_CSV, [csvRow(104, fp.surname, '1950-02-02')]);
        writeClubListCsv(bothDir, BRISBANE_CSV, [csvRow(105, fp.surname, '1950-03-03')]);
        expectSuccess(runClubList(bothDir), 'club-list run (both files)');

        // Only University present this time -- Brisbane Bears' assertion
        // must survive untouched, with no evidence read about it at all.
        writeClubListCsv(partialDir, UNIVERSITY_CSV, [csvRow(104, fp.surname, '1950-02-02')]);
        expectSuccess(runClubList(partialDir), 'club-list run (University only)');

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        const clubList = (rows[0].details.disputed_by as any).club_list as Array<{ club: string; external_id: string }>;
        expect(clubList.map((a) => a.club).sort()).toEqual(['brisbane-bears', 'university']);
        expect(clubList.find((a) => a.club === 'brisbane-bears')?.external_id).toBe('club-list:brisbane-bears:cap105');
      } finally {
        rmSync(bothDir, { recursive: true, force: true });
        rmSync(partialDir, { recursive: true, force: true });
      }
    });

    it('test 7: an authoritative agreement removes the assertion', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(106, fp.surname, '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run 1');
        expect(await unresolvedDobConflict(fp.id)).toHaveLength(1);

        // Same record, now asserting the player's actual dob: cessation.
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(106, fp.surname, '1950-01-01')]);
        expectSuccess(runClubList(dir), 'club-list run 2 (agreement)');
        expect(await unresolvedDobConflict(fp.id)).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 8: a present but unmatchable record is retained, not treated as cessation', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(107, fp.surname, '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run 1');
        const before = await unresolvedDobConflict(fp.id);
        expect(before).toHaveLength(1);

        // Same cap number (same external_id), but the name no longer
        // matches anyone -- a failed match, not evidence of cessation.
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(107, 'NoSuchFixturePlayer', '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run 2 (unmatchable)');
        const after = await unresolvedDobConflict(fp.id);
        expect(after).toHaveLength(1);
        expect(after[0].details).toEqual(before[0].details);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 9: a record deleted from a processed file is cleaned up', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(108, fp.surname, '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run 1');
        expect(await unresolvedDobConflict(fp.id)).toHaveLength(1);

        // The file no longer contains cap 108 at all.
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(199, 'SomeoneElseEntirely', '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run 2 (record vanished)');
        expect(await unresolvedDobConflict(fp.id)).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------------
  // Cross-pass isolation
  // ---------------------------------------------------------------------
  describe('cross-pass isolation', () => {
    it('test 4: an existing register assertion survives a club-list run untouched', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01' });
      const registerAssertion = {
        source: 'afltables', external_id: 'players/T/fixture4.html',
        asserted: '1949-05-05', existing_at_detection: '1950-01-01',
      };
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture',
                ${sql.json({ version: 2, disputed_by: { register: [registerAssertion] }, resolution: 'manual review required' } as never)})
      `;
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        // The player never appears in any club-list CSV this run.
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(199, 'SomeoneElseEntirely', '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run');

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        expect((rows[0].details.disputed_by as any).register).toEqual([registerAssertion]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 5: an existing club-list assertion survives a real register run untouched', async () => {
      const legacyId = nextLegacyId();
      const fp = await createFixturePlayer({ dob: '1950-01-01', legacyPlayerId: legacyId });
      const clubListAssertion = {
        source: 'afltables', club: 'university', external_id: 'club-list:university:cap150',
        asserted: '1950-06-15', existing_at_detection: '1950-01-01',
      };
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture',
                ${sql.json({ version: 2, disputed_by: { club_list: [clubListAssertion] }, resolution: 'manual review required' } as never)})
      `;
      const sqliteDb = join(mkdtempSync(join(tmpdir(), 'issue090-sqlite-')), 'legacy.sqlite');
      try {
        buildRegisterFixtureDb(sqliteDb, [
          { profileUrl: `players/T/fixture5.html`, dobRaw: '1949-08-08', legacyId },
        ]);
        expectSuccess(runRegister(sqliteDb), 'register run');

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        expect((rows[0].details.disputed_by as any).club_list).toEqual([clubListAssertion]);
        expect((rows[0].details.disputed_by as any).register).toBeDefined();
        expect((rows[0].details.disputed_by as any).register[0].asserted).toBe('1949-08-08');
      } finally {
        rmSync(sqliteDb, { force: true });
      }
    });
  });

  // ---------------------------------------------------------------------
  // AFLDB-ISSUE-092 -- external_identities population-sanity gate and
  // fixture-source containment (§4/§5/§11 of AFLDB-ISSUE-092.md)
  // ---------------------------------------------------------------------
  describe('ISSUE-092: external_identities population gate', () => {
    async function seedIdentity(sourceId: number, externalId: string, playerId: number): Promise<void> {
      await sql`
        INSERT INTO external_identities
          (source_id, external_id, external_url, player_id, status, match_method, notes)
        VALUES (${sourceId}, ${externalId}, ${externalId}, ${playerId},
                'unique', 'afltables_profile_url', 'issue092 fixture')
      `;
    }

    async function identityCount(sourceId: number): Promise<number> {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM external_identities
         WHERE source_id = ${sourceId} AND match_method = 'afltables_profile_url'
      `;
      return row.n;
    }

    function registerFixture(rows: Array<{ profileUrl: string; dobRaw: string; legacyId: number }>): string {
      const path = join(mkdtempSync(join(tmpdir(), 'issue092-sqlite-')), 'legacy.sqlite');
      buildRegisterFixtureDb(path, rows);
      return path;
    }

    it('test 24: a fixture-source run cannot touch the real afltables population', async () => {
      const [real] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
      const anchor = await createFixturePlayer({ dob: '1950-01-01' });
      await seedIdentity(real.id, 'players/T/issue092-real-anchor.html', anchor.id);
      const realBefore = await identityCount(real.id);

      const legacyId = nextLegacyId();
      const fp = await createFixturePlayer({ legacyPlayerId: legacyId });
      const sqliteDb = registerFixture([
        { profileUrl: 'players/T/issue092-fixture24.html', dobRaw: '1951-01-01', legacyId },
      ]);
      try {
        expectSuccess(runRegister(sqliteDb), 'fixture-source register run');
        // The real population is untouched, row for row.
        expect(await identityCount(real.id)).toBe(realBefore);
        const [kept] = await sql<{ playerId: number }[]>`
          SELECT player_id AS "playerId" FROM external_identities
           WHERE source_id = ${real.id} AND external_id = 'players/T/issue092-real-anchor.html'
        `;
        expect(kept.playerId).toBe(anchor.id);
        // The run's own row landed under the fixture source only.
        expect(await identityCount(fixtureSourceId)).toBe(1);
        void fp;
      } finally {
        rmSync(sqliteDb, { force: true });
      }
    });

    it('test 25: an empty asserted population is refused unconditionally (§4 check 1)', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01' });
      for (let i = 0; i < 3; i += 1) {
        await seedIdentity(fixtureSourceId, `players/T/issue092-stored25-${i}.html`, fp.id);
      }
      const sqliteDb = registerFixture([]);
      try {
        const refused = runRegister(sqliteDb);
        expect(refused.status).not.toBe(0);
        expect(String(refused.stderr)).toMatch(/EMPTY population/);
        expect(await identityCount(fixtureSourceId)).toBe(3);

        // Not bypassable: the acknowledgement flag does not soften check 1.
        const acknowledged = runRegister(sqliteDb, ['--acknowledge-population-drop']);
        expect(acknowledged.status).not.toBe(0);
        expect(await identityCount(fixtureSourceId)).toBe(3);

        const [batch] = await sql<{ status: string }[]>`
          SELECT status FROM import_batches
           WHERE tool = 'enrich_birth_dates.py'
           ORDER BY id DESC LIMIT 1
        `;
        expect(batch.status).toBe('failed');
      } finally {
        rmSync(sqliteDb, { force: true });
      }
    });

    it('test 26: an over-threshold drop is refused, then permitted only with --acknowledge-population-drop (§4 check 2)', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01' });
      for (let i = 0; i < 20; i += 1) {
        await seedIdentity(fixtureSourceId, `players/T/issue092-stored26-${i}.html`, fp.id);
      }
      const legacyId = nextLegacyId();
      const asserted = await createFixturePlayer({ legacyPlayerId: legacyId });
      const sqliteDb = registerFixture([
        { profileUrl: 'players/T/issue092-fixture26.html', dobRaw: '1952-02-02', legacyId },
      ]);
      try {
        const refused = runRegister(sqliteDb);
        expect(refused.status).not.toBe(0);
        expect(String(refused.stderr)).toMatch(/population-drop threshold/);
        expect(await identityCount(fixtureSourceId)).toBe(20);

        const acknowledged = runRegister(sqliteDb, ['--acknowledge-population-drop']);
        expectSuccess(acknowledged, 'acknowledged register run');
        expect(String(acknowledged.stdout)).toMatch(/acknowledged population drop/);
        expect(await identityCount(fixtureSourceId)).toBe(1);
        const [row] = await sql<{ playerId: number }[]>`
          SELECT player_id AS "playerId" FROM external_identities
           WHERE source_id = ${fixtureSourceId}
             AND external_id = 'players/T/issue092-fixture26.html'
        `;
        expect(row.playerId).toBe(asserted.id);
      } finally {
        rmSync(sqliteDb, { force: true });
      }
    });

    it('test 27: an equal-or-larger asserted population passes with no false positive (§11.5, recovery direction)', async () => {
      const legacyId = nextLegacyId();
      const fp = await createFixturePlayer({ legacyPlayerId: legacyId });
      await seedIdentity(fixtureSourceId, 'players/T/issue092-fixture27.html', fp.id);
      const sqliteDb = registerFixture([
        { profileUrl: 'players/T/issue092-fixture27.html', dobRaw: '1953-03-03', legacyId },
      ]);
      try {
        // Ordinary re-run: asserted set covers the stored set exactly.
        expectSuccess(runRegister(sqliteDb), 'same-population register rerun');
        expect(await identityCount(fixtureSourceId)).toBe(1);
        // Rebuild-from-empty: pure insertion, gate never fires.
        await sql`DELETE FROM external_identities WHERE source_id = ${fixtureSourceId}`;
        expectSuccess(runRegister(sqliteDb), 'rebuild-from-empty register run');
        expect(await identityCount(fixtureSourceId)).toBe(1);
      } finally {
        rmSync(sqliteDb, { force: true });
      }
    });
  });

  // ---------------------------------------------------------------------
  // D1 -- resolved history suppresses an identical recurrence
  // ---------------------------------------------------------------------
  describe('D1: resolved-history suppression', () => {
    async function seedResolved(entityId: number, details: unknown): Promise<number> {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details, resolved_at, resolution)
        VALUES ('player', ${entityId}, 'dob_conflict', 'warning', 'fixture resolved',
                ${sql.json(details as never)}, now(), 'fixture')
        RETURNING id
      `;
      return row.id;
    }

    it('test 10: an identical legacy-shape (B) resolved assertion is not refiled', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      const resolvedId = await seedResolved(fp.id, {
        existing: '1950-01-01', club_list: '1950-06-15',
        external_id: 'club-list:university:cap160', source: 'afltables', resolution: 'manual review required',
      });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(160, fp.surname, '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run');

        expect(await unresolvedDobConflict(fp.id)).toHaveLength(0);
        const [resolvedRow] = await sql<{ resolvedAt: string | null }[]>`
          SELECT resolved_at::text AS "resolvedAt" FROM data_issues WHERE id = ${resolvedId}
        `;
        expect(resolvedRow.resolvedAt).not.toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 11: an identical v2 resolved assertion is not refiled', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      await seedResolved(fp.id, {
        version: 2,
        disputed_by: { club_list: [{
          source: 'afltables', club: 'university', external_id: 'club-list:university:cap161',
          asserted: '1950-06-15', existing_at_detection: '1950-01-01',
        }] },
        resolution: 'manual review required',
      });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(161, fp.surname, '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run');
        expect(await unresolvedDobConflict(fp.id)).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 12: a materially changed assertion (different asserted date) is filed as new', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      await seedResolved(fp.id, {
        existing: '1950-01-01', club_list: '1950-06-15',
        external_id: 'club-list:university:cap162', source: 'afltables', resolution: 'manual review required',
      });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(162, fp.surname, '1950-07-20')]);
        expectSuccess(runClubList(dir), 'club-list run');

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        const assertion = (rows[0].details.disputed_by as any).club_list[0];
        expect(assertion.asserted).toBe('1950-07-20');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 13: a changed baseline (players.dob moved) is filed as new', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      await seedResolved(fp.id, {
        existing: '1950-01-01', club_list: '1950-06-15',
        external_id: 'club-list:university:cap163', source: 'afltables', resolution: 'manual review required',
      });
      // The baseline changed since adjudication.
      await sql`UPDATE players SET dob = '1951-02-02', dob_confidence = 'sourced' WHERE id = ${fp.id}`;

      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(163, fp.surname, '1950-06-15')]);
        expectSuccess(runClubList(dir), 'club-list run');

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        const assertion = (rows[0].details.disputed_by as any).club_list[0];
        expect(assertion.existing_at_detection).toBe('1951-02-02');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 14: suppression is assertion-specific -- a resolved register conflict does not suppress a new club-list one', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      await seedResolved(fp.id, {
        existing: '1950-01-01', register: '1949-05-05', source: 'afltables', resolution: 'manual review required',
      });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(164, fp.surname, '1950-08-08')]);
        expectSuccess(runClubList(dir), 'club-list run');

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        expect((rows[0].details.disputed_by as any).club_list[0].asserted).toBe('1950-08-08');
        expect((rows[0].details.disputed_by as any).register).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------------
  // Migration 072 -- exercised via verbatim slices of the real file.
  // Gated on migration072Applied (Sec module header): before migration 072
  // has been applied to this database, these tests are skipped outright --
  // not run-and-expected-to-fail -- so they cannot mutate schema state
  // (uq_data_issues_open_dob_per_player) ahead of the real migration.
  // ---------------------------------------------------------------------
  describe.skipIf(!migration072Applied)('migration 072', () => {
    it('test 15: normalises legacy shapes A and B to v2', async () => {
      const register = await createFixturePlayer({ dob: '1950-01-01' });
      const clubList = await createFixturePlayer({ dob: '1950-01-01' });
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${register.id}, 'dob_conflict', 'warning', 'fixture',
                ${sql.json({ existing: '1950-01-01', register: '1949-05-05', source: 'afltables', resolution: 'manual review required' } as never)})
      `;
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${clubList.id}, 'dob_conflict', 'warning', 'fixture',
                ${sql.json({ existing: '1950-01-01', club_list: '1950-06-15', external_id: 'club-list:university:cap150a', source: 'afltables', resolution: 'manual review required' } as never)})
      `;

      await sql.unsafe(NORMALISE_SQL);

      const [regRow] = await unresolvedDobConflict(register.id);
      expect(regRow.details.version).toBe(2);
      expect((regRow.details.disputed_by as any).register[0]).toMatchObject({
        source: 'afltables', asserted: '1949-05-05', existing_at_detection: '1950-01-01',
      });

      const [clubRow] = await unresolvedDobConflict(clubList.id);
      expect(clubRow.details.version).toBe(2);
      expect((clubRow.details.disputed_by as any).club_list[0]).toMatchObject({
        source: 'afltables', club: 'university', external_id: 'club-list:university:cap150a',
        asserted: '1950-06-15', existing_at_detection: '1950-01-01',
      });
    });

    it('test 16: merges duplicate unresolved dob_conflict groups losslessly', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01' });
      await withoutUniqueIndex(async () => {
        const [row1] = await sql<{ id: number }[]>`
          INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
          VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture',
                  ${sql.json({ version: 2, disputed_by: { club_list: [{ source: 'afltables', club: 'university', external_id: 'club-list:university:cap170', asserted: '1950-06-01', existing_at_detection: '1950-01-01' }] }, resolution: 'manual review required' } as never)})
          RETURNING id
        `;
        const [row2] = await sql<{ id: number }[]>`
          INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
          VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture',
                  ${sql.json({ version: 2, disputed_by: { club_list: [{ source: 'afltables', club: 'university', external_id: 'club-list:university:cap171', asserted: '1950-07-01', existing_at_detection: '1950-01-01' }] }, resolution: 'manual review required' } as never)})
          RETURNING id
        `;

        await sql.unsafe(MERGE_AND_DELETE_SQL);

        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(BigInt(row1.id) < BigInt(row2.id) ? row1.id : row2.id);
        const assertions = (rows[0].details.disputed_by as any).club_list as Array<{ external_id: string }>;
        expect(assertions.map((a) => a.external_id).sort()).toEqual([
          'club-list:university:cap170', 'club-list:university:cap171',
        ]);
      });
    });

    it('test 17: each precondition aborts the migration, nothing applied', async () => {
      const cases: Array<{ label: string; details: unknown; pattern: RegExp }> = [
        {
          label: 'both legacy ownership keys',
          details: {
            existing: '1950-01-01', register: '1950-02-02', club_list: '1950-03-03',
            external_id: 'club-list:university:cap901', source: 'afltables', resolution: 'x',
          },
          pattern: /ownership ambiguous/,
        },
        {
          label: 'neither legacy key nor disputed_by',
          details: { existing: '1950-01-01', source: 'afltables', resolution: 'x' },
          pattern: /unattributable/,
        },
        {
          label: 'unrecognised payload version',
          details: { version: 3, disputed_by: {}, resolution: 'x' },
          pattern: /unrecognised payload version/,
        },
        {
          label: 'disputed_by not an object',
          details: { version: 2, disputed_by: 'oops', resolution: 'x' },
          pattern: /non-object disputed_by/,
        },
        {
          label: 'unparseable date inside disputed_by',
          details: {
            version: 2,
            disputed_by: { register: [{ source: 'afltables', external_id: null, asserted: 'not-a-date', existing_at_detection: '1950-01-01' }] },
            resolution: 'x',
          },
          pattern: /unparseable date/,
        },
        {
          label: 'malformed club_list external_id',
          details: {
            version: 2,
            disputed_by: { club_list: [{ source: 'afltables', club: 'university', external_id: 'not-club-shaped', asserted: '1950-06-01', existing_at_detection: '1950-01-01' }] },
            resolution: 'x',
          },
          pattern: /unrecognised external_id shape/,
        },
        {
          label: 'unrecognised details key',
          details: { version: 2, disputed_by: {}, resolution: 'x', bogus: true },
          pattern: /unrecognised details key/,
        },
      ];

      for (const testCase of cases) {
        const fp = await createFixturePlayer({ dob: '1950-01-01' });
        await expect(sql.begin(async (tx) => {
          await tx`
            INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
            VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture', ${sql.json(testCase.details as never)})
          `;
          await tx.unsafe(PRECONDITIONS_SQL);
        })).rejects.toThrow(testCase.pattern);

        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM data_issues WHERE entity_type = 'player' AND entity_id = ${fp.id}
        `;
        expect(row.n).toBe(0);
      }
    });

    it('test 17b: a duplicate unresolved dob_internal_conflict group aborts the migration', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01' });
      await withoutUniqueIndex(async () => {
        await expect(sql.begin(async (tx) => {
          await tx`
            INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
            VALUES ('player', ${fp.id}, 'dob_internal_conflict', 'warning', 'fixture', ${sql.json({ dates: ['1950-01-01', '1950-02-02'] } as never)})
          `;
          await tx`
            INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
            VALUES ('player', ${fp.id}, 'dob_internal_conflict', 'warning', 'fixture', ${sql.json({ dates: ['1951-01-01'] } as never)})
          `;
          await tx.unsafe(PRECONDITIONS_SQL);
        })).rejects.toThrow(/duplicate unresolved dob_internal_conflict/);

        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM data_issues
           WHERE entity_type = 'player' AND entity_id = ${fp.id} AND issue_type = 'dob_internal_conflict'
        `;
        expect(row.n).toBe(0);
      });
    });

    it('test 18: the unique index rejects a second unresolved DOB row per player, but permits resolved history and a coexisting dob_internal_conflict', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01' });
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture', ${sql.json({ version: 2, disputed_by: {}, resolution: 'x' } as never)})
      `;
      await expect(sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture 2', ${sql.json({ version: 2, disputed_by: {}, resolution: 'x' } as never)})
      `).rejects.toThrow();

      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details, resolved_at)
        VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture resolved 1',
                ${sql.json({ existing: '1950-01-01', register: '1950-02-02', source: 'afltables', resolution: 'x' } as never)}, now())
      `;
      await expect(sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details, resolved_at)
        VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture resolved 2',
                ${sql.json({ existing: '1950-01-01', register: '1950-03-03', source: 'afltables', resolution: 'x' } as never)}, now())
      `).resolves.toBeDefined();

      await expect(sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${fp.id}, 'dob_internal_conflict', 'warning', 'fixture',
                ${sql.json({ dates: ['1950-01-01', '1950-02-02'] } as never)})
      `).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------
  // D5 -- players.dob_disputed recompute
  // ---------------------------------------------------------------------
  describe('D5: dob_disputed recompute', () => {
    it('test 19: clears when no unresolved DOB issue remains', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(191, fp.surname, '1950-06-01')]);
        expectSuccess(runClubList(dir), 'club-list run 1');
        let [player] = await sql<{ disputed: boolean }[]>`
          SELECT dob_disputed AS disputed FROM players WHERE id = ${fp.id}
        `;
        expect(player.disputed).toBe(true);

        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(191, fp.surname, '1950-01-01')]);
        expectSuccess(runClubList(dir), 'club-list run 2 (agreement)');
        [player] = await sql<{ disputed: boolean }[]>`
          SELECT dob_disputed AS disputed FROM players WHERE id = ${fp.id}
        `;
        expect(player.disputed).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 20: stays true when another unresolved DOB issue remains', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player', ${fp.id}, 'dob_conflict', 'warning', 'fixture',
                ${sql.json({ version: 2, disputed_by: { register: [{ source: 'afltables', external_id: 'players/T/fixture20.html', asserted: '1949-05-05', existing_at_detection: '1950-01-01' }] }, resolution: 'manual review required' } as never)})
      `;
      await sql`UPDATE players SET dob_disputed = true WHERE id = ${fp.id}`;

      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(201, fp.surname, '1950-06-01')]);
        expectSuccess(runClubList(dir), 'club-list run 1');
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(201, fp.surname, '1950-01-01')]);
        expectSuccess(runClubList(dir), 'club-list run 2 (agreement)');

        const [player] = await sql<{ disputed: boolean }[]>`
          SELECT dob_disputed AS disputed FROM players WHERE id = ${fp.id}
        `;
        expect(player.disputed).toBe(true);
        const rows = await unresolvedDobConflict(fp.id);
        expect(rows).toHaveLength(1);
        expect((rows[0].details.disputed_by as any).register).toBeDefined();
        expect((rows[0].details.disputed_by as any).club_list).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('test 21: becomes true when a new unresolved DOB issue appears', async () => {
      const fp = await createFixturePlayer({ dob: '1950-01-01', clubIds: [universityClubId] });
      let [player] = await sql<{ disputed: boolean }[]>`
        SELECT dob_disputed AS disputed FROM players WHERE id = ${fp.id}
      `;
      expect(player.disputed).toBe(false);

      const dir = mkdtempSync(join(tmpdir(), 'issue090-'));
      try {
        writeClubListCsv(dir, UNIVERSITY_CSV, [csvRow(211, fp.surname, '1950-09-09')]);
        expectSuccess(runClubList(dir), 'club-list run');
        [player] = await sql<{ disputed: boolean }[]>`
          SELECT dob_disputed AS disputed FROM players WHERE id = ${fp.id}
        `;
        expect(player.disputed).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------------
  // Harness integrity
  // ---------------------------------------------------------------------
  describe('harness integrity', () => {
    it('test 22: matches the release-gate duplicate-issue invariant', async () => {
      const rows = await sql<{ issueType: string; n: number }[]>`
        SELECT issue_type AS "issueType", count(*)::int AS n FROM (
          SELECT issue_type, entity_type, entity_id, count(*) AS c
            FROM data_issues WHERE resolved_at IS NULL
           GROUP BY 1, 2, 3 HAVING count(*) > 1
        ) d GROUP BY issue_type
      `;
      expect(rows).toEqual([]);
    });

    it('test 23: leaves no fixture residue', async () => {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM players WHERE display_name LIKE '%Issue090Fixture%'
      `;
      expect(row.n).toBe(0);
    });
  });
  },
);
