/**
 * AFLDB-ISSUE-167 Stage 4 — gate G-9, adapter parity.
 *
 * D-3 (2026-09-13) approved ONE durable authority (`data_overrides`) with TWO
 * replay adapters, explicitly conditional on the two being "pinned by
 * parity/contract tests". This is that pin.
 *
 *   TypeScript  tools/records/special-records-replay.ts, over
 *               `player_achievements`, run inside
 *               tools/records/import-first-kick-goal.ts's own transaction.
 *   Python      tools/migration/common.py's `replay_admin_overrides`, over
 *               `after_siren_kicks`, run inside tools/migration/after_siren.py's
 *               load transaction.
 *
 * WHAT PARITY MEANS HERE. Not identical code — the two adapters deliberately do
 * not share an implementation, and D-3 refused the port-to-Python option that
 * would have given them one. It means identical SEMANTICS: the same durable
 * decision, over the same starting row state, produces the same outcome on both
 * sides. So the cases live in ONE language-neutral corpus
 * (tests/fixtures/special-records-replay-parity.json) and BOTH adapters are
 * driven from it. Two hand-written suites would drift independently, and the
 * drift would be invisible until a rebuild silently lost somebody's decision.
 *
 * The SEEDING is shared too, and that is the point: only the replay itself
 * differs between the two runs, so a divergence can only come from the replay.
 *
 * The REAL Python function is spawned out of `tools/migration/common.py`. A
 * TypeScript reimplementation of it here would prove only that two pieces of
 * test code agree — the lesson tests/integration/admin-awards.test.ts:165-169
 * already records.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SPECIAL_RECORD_TABLES,
  type SpecialRecordTable,
  specialRecordEntityKey,
} from '../src/lib/special-records/identity';
import { replaySpecialRecordOverrides } from '../tools/records/special-records-replay';

const root = process.cwd();

/**
 * Every fixture row, and every fixture override key that CAN carry it, carries
 * this. Cleanup keys on it rather than on a per-run nonce so that debris a
 * crashed earlier run left behind is removed too — the repeatability lesson
 * tests/integration/admin-awards.test.ts:124-131 records, where a manual
 * `record` override naming a row that no longer existed failed the NEXT run's
 * replay closed.
 */
const MARKER = 'afldb-issue-167-parity';

type Corpus = {
  neutralColumns: string[];
  tables: Record<string, {
    adapter: 'typescript' | 'python';
    sourceKey: string;
    family: string;
    seedDefaults: Record<string, unknown>;
    recordDefaults: Record<string, unknown>;
  }>;
  seedRow: Record<string, unknown>;
  cases: {
    name: string;
    id: string;
    requirement: string;
    keySource: 'source' | 'manual' | 'literal' | 'literalSourcePrefixed';
    literalEntityKey?: string;
    seed: boolean;
    playerIdentityFromDatabase?: boolean;
    overrides: { field_group: string; values: Record<string, unknown> }[];
    expect: {
      outcome: 'ok' | 'fail_closed';
      messageContains?: string;
      rowExists: boolean;
      rowIsManual?: boolean;
      rowLinked?: boolean;
      warnContainsEntityKey?: boolean;
      row?: Record<string, unknown>;
    };
  }[];
};

const corpus: Corpus = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'special-records-replay-parity.json'), 'utf8'),
);

// ---------------------------------------------------------------------------
// Target proof. tests/setup.ts already refuses a DSN whose database does not
// end in _test; this adds the loopback half of the AFLDB-ISSUE-167 §15.0 safety
// contract, and it is asserted as a TEST rather than only as a precondition so
// that a suite which mutates rows can never be read as having proven its target
// by inspection alone.
// ---------------------------------------------------------------------------
const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL ?? '';

function targetIsSafe(): boolean {
  if (!testDbUrl) return false;
  try {
    const u = new URL(testDbUrl);
    return /_test$/.test(u.pathname.replace(/^\//, ''))
      && ['localhost', '127.0.0.1'].includes(u.hostname);
  } catch {
    return false;
  }
}

const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

const canRun = targetIsSafe() && hasPsycopg();
const skipReason = !targetIsSafe()
  ? 'AFLDB_TEST_DATABASE_URL must name a _test database on loopback'
  : 'python with psycopg is required to run the REAL common.py replay';

// A dedicated owner handle. `@/db/client`'s pool is shared with every other
// suite in the file's worker; this one is opened and closed by this suite so a
// forced rollback here cannot surprise anything else.
let sql: postgres.Sql;

/**
 * `data_overrides.admin_user_id` is NOT NULL REFERENCES auth_users(id)
 * (073:18): a durable decision has to name who made it. A dedicated fixture
 * admin, never the first real admin by id — the trap AFLDB-ISSUE-074 records
 * against the email-intake suite.
 */
const FIXTURE_EMAIL = 'afldb-issue-167-parity@example.test';
let adminUserId = 0;

/** The corpus documents itself in `$`-prefixed keys; they are never columns. */
function columns(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !k.startsWith('$')));
}

// ---------------------------------------------------------------------------
// The corpus, instantiated
// ---------------------------------------------------------------------------

/** The entity_key this case uses against this table. Deterministic, so purge can enumerate it. */
function entityKeyFor(table: SpecialRecordTable, c: Corpus['cases'][number]): string {
  const t = corpus.tables[table];
  switch (c.keySource) {
    case 'source':
      return specialRecordEntityKey(t.sourceKey, `${MARKER}-${c.id}`);
    case 'manual':
      // Shape-compatible with mintManualSourceRecordId()'s '<family>:<uuid>',
      // but deterministic and marker-bearing so purgeFixtures() can find it.
      // A uuid here would be unpurgeable by prefix, which is exactly the leak
      // AFLDB-ISSUE-165's suite had to fix.
      return specialRecordEntityKey('manual_admin_edit', `${t.family}:${MARKER}-${c.id}`);
    case 'literalSourcePrefixed':
      // Deliberately NOT built through specialRecordEntityKey(), which refuses
      // an empty half: the point of the case is that the REPLAY refuses a key
      // the writer would never have minted.
      return `${t.sourceKey}:`;
    case 'literal':
      return c.literalEntityKey!;
  }
}

/** The source_record_id half, or null when the key is deliberately unparseable. */
function recordIdFor(table: SpecialRecordTable, c: Corpus['cases'][number]): string | null {
  const key = entityKeyFor(table, c);
  const colon = key.indexOf(':');
  if (colon <= 0 || colon === key.length - 1) return null;
  return key.slice(colon + 1);
}

function allEntityKeys(table: SpecialRecordTable): string[] {
  return corpus.cases.map((c) => entityKeyFor(table, c));
}

async function purgeFixtures(): Promise<void> {
  for (const table of SPECIAL_RECORD_TABLES) {
    await sql`
      DELETE FROM data_overrides
       WHERE entity_type = ${table}
         AND (entity_key LIKE ${`%${MARKER}%`} OR entity_key = ANY(${allEntityKeys(table)}))
    `;
    await sql`DELETE FROM ${sql(table)} WHERE source_record_id LIKE ${`%${MARKER}%`}`;
  }
}

async function sourceId(key: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = ${key}`;
  if (!row) throw new Error(`fixture needs a sources row for ${key}`);
  return row.id;
}

/** Seed the case's starting row state, shared byte-for-byte by both adapters. */
async function seedCase(table: SpecialRecordTable, c: Corpus['cases'][number]): Promise<void> {
  const t = corpus.tables[table];
  const recordId = recordIdFor(table, c);
  if (c.seed && recordId !== null) {
    await sql`
      INSERT INTO ${sql(table)} ${sql({
        ...columns(corpus.seedRow),
        ...columns(t.seedDefaults),
        source_id: await sourceId(t.sourceKey),
        source_record_id: recordId,
      } as unknown as Record<string, never>)}
    `;
  }
  for (const o of c.overrides) {
    const values: Record<string, unknown> = o.field_group === 'record'
      ? { ...columns(t.recordDefaults), ...o.values }
      : { ...o.values };
    if (c.playerIdentityFromDatabase) {
      // A REAL identity, discovered at run time rather than seeded: the
      // external_identities_uq UNIQUE (source_id, external_id) makes any such
      // row resolve to exactly one player by construction, which is the
      // condition the replay requires.
      const [ident] = await sql<{ identity: string }[]>`
        SELECT s.key || ':' || ei.external_id AS identity
          FROM external_identities ei JOIN sources s ON s.id = ei.source_id
         WHERE ei.status IN ('unique', 'resolved') AND ei.player_id IS NOT NULL
           AND position(':' in s.key) = 0
         ORDER BY ei.id LIMIT 1
      `;
      if (!ident) throw new Error('fixture needs one resolved external_identities row');
      values.player_identity = ident.identity;
    }
    await sql`
      INSERT INTO data_overrides
        (entity_type, entity_key, field_group, override_values, is_active, admin_user_id)
      VALUES (${table}, ${entityKeyFor(table, c)}, ${o.field_group},
              ${sql.json(values as never)}, true, ${adminUserId})
    `;
  }
}

type Outcome = { ok: boolean; message: string; stdout: string };

/** Run the TypeScript adapter exactly as the importer runs it: on one transaction handle. */
async function runTypeScript(table: SpecialRecordTable): Promise<Outcome> {
  const lines: string[] = [];
  try {
    await sql.begin(async (tx) => {
      await replaySpecialRecordOverrides(tx, table, { warn: (m) => { lines.push(m); } });
    });
    return { ok: true, message: '', stdout: lines.join('\n') };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      stdout: lines.join('\n'),
    };
  }
}

/** Run the REAL `replay_admin_overrides` out of tools/migration/common.py. */
function runPython(table: SpecialRecordTable): Outcome {
  const script = [
    'import sys, os',
    `sys.path.insert(0, ${JSON.stringify(join(root, 'tools', 'migration'))})`,
    'import psycopg',
    'from common import replay_admin_overrides',
    'conn = psycopg.connect(os.environ["AFLDB_REPLAY_DSN"])',
    'try:',
    `    replay_admin_overrides(conn, ${JSON.stringify(table)})`,
    '    conn.commit()',
    'except Exception as exc:',
    '    conn.rollback()',
    '    sys.stderr.write(str(exc))',
    '    sys.exit(1)',
    'finally:',
    '    conn.close()',
  ].join('\n');
  const run = spawnSync(python, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AFLDB_REPLAY_DSN: testDbUrl },
  });
  return {
    ok: run.status === 0,
    message: String(run.stderr ?? '') + (run.error ? `\n${run.error.message}` : ''),
    stdout: String(run.stdout ?? ''),
  };
}

/** Everything the assertions look at, read back after the adapter ran. */
type Observed = {
  outcome: Outcome;
  row: Record<string, unknown> | null;
  rowSourceKey: string | null;
  overrideFingerprint: string | null;
};

async function observe(table: SpecialRecordTable, c: Corpus['cases'][number], outcome: Outcome): Promise<Observed> {
  const recordId = recordIdFor(table, c);
  let row: Record<string, unknown> | null = null;
  let rowSourceKey: string | null = null;
  if (recordId !== null) {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT x.*, s.key AS "__sourceKey"
        FROM ${sql(table)} x LEFT JOIN sources s ON s.id = x.source_id
       WHERE x.source_record_id = ${recordId}
    `;
    if (rows.length > 1) throw new Error(`fixture invariant broken: ${rows.length} rows for ${recordId}`);
    if (rows.length === 1) {
      row = rows[0];
      rowSourceKey = (rows[0].__sourceKey as string | null) ?? null;
    }
  }
  const [fp] = await sql<{ f: string | null }[]>`
    SELECT md5(string_agg(
             o.entity_key || '|' || o.field_group || '|' || o.override_values::text
               || '|' || o.is_active::text, E'\n' ORDER BY o.entity_key, o.field_group)) AS f
      FROM data_overrides o
     WHERE o.entity_type = ${table}
       AND (o.entity_key LIKE ${`%${MARKER}%`} OR o.entity_key = ANY(${allEntityKeys(table)}))
  `;
  return { outcome, row, rowSourceKey, overrideFingerprint: fp.f };
}

/** The semantic summary the two adapters must agree on, independent of wording. */
function semantics(o: Observed, c: Corpus['cases'][number]): Record<string, unknown> {
  const neutral: Record<string, unknown> = {};
  if (o.row) for (const col of corpus.neutralColumns) neutral[col] = o.row[col] ?? null;
  return {
    ok: o.outcome.ok,
    rowExists: o.row !== null,
    rowIsManual: o.rowSourceKey === 'manual_admin_edit',
    rowLinked: o.row ? o.row.player_id !== null && o.row.link_status_value === 'resolved' : null,
    warned: /RETAINED/.test(o.outcome.stdout),
    neutral: o.row ? neutral : null,
    overridesUntouched: o.overrideFingerprint,
    caseId: c.id,
  };
}

describe.skipIf(!canRun)(`special-record replay adapter parity (AFLDB-ISSUE-167 G-9)${canRun ? '' : ` — ${skipReason}`}`, () => {
  beforeAll(async () => {
    sql = postgres(testDbUrl, { max: 1, onnotice: () => {} });
    const [admin] = await sql<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES (${FIXTURE_EMAIL}, 'admin')
      ON CONFLICT (email) DO UPDATE SET role = 'admin'
      RETURNING id
    `;
    adminUserId = admin.id;
    await purgeFixtures();
  });

  afterAll(async () => {
    if (sql) {
      await purgeFixtures();
      await sql.end({ timeout: 5 });
    }
  });

  it('proves its target before mutating it', async () => {
    const [row] = await sql<{ db: string; host: string | null }[]>`
      SELECT current_database() AS db, host(inet_server_addr()) AS host
    `;
    expect(row.db).toMatch(/_test$/);
    expect(['127.0.0.1', '::1', null]).toContain(row.host);
  });

  it('drives both adapters from one corpus, over both tables', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(corpus.tables).sort()).toEqual([...SPECIAL_RECORD_TABLES].sort());
    expect(corpus.tables.player_achievements.adapter).toBe('typescript');
    expect(corpus.tables.after_siren_kicks.adapter).toBe('python');
  });

  for (const c of corpus.cases) {
    it(`${c.name} — identically in both adapters`, async () => {
      const observations: Partial<Record<SpecialRecordTable, Observed>> = {};

      for (const table of SPECIAL_RECORD_TABLES) {
        await purgeFixtures();
        await seedCase(table, c);
        const outcome = corpus.tables[table].adapter === 'typescript'
          ? await runTypeScript(table)
          : runPython(table);
        const seen = await observe(table, c, outcome);
        observations[table] = seen;

        const where = `${table} (${corpus.tables[table].adapter}) — ${c.requirement}`;

        // 1. The outcome the corpus specifies.
        expect(seen.outcome.ok, `${where}\n${seen.outcome.message}\n${seen.outcome.stdout}`)
          .toBe(c.expect.outcome === 'ok');
        if (c.expect.messageContains) {
          expect(seen.outcome.message, where).toContain(c.expect.messageContains);
        }

        // 2. The row state.
        expect(seen.row !== null, `${where}: rowExists`).toBe(c.expect.rowExists);
        if (c.expect.rowIsManual) expect(seen.rowSourceKey, where).toBe('manual_admin_edit');
        if (c.expect.rowLinked) {
          expect(seen.row?.player_id, `${where}: player_id`).not.toBeNull();
          expect(seen.row?.link_status_value, `${where}: link_status_value`).toBe('resolved');
        }
        for (const [col, value] of Object.entries(c.expect.row ?? {})) {
          expect(seen.row?.[col] ?? null, `${where}: ${col}`).toEqual(value);
        }

        // 3. Warn-and-retain, where the corpus asks for it.
        if (c.expect.warnContainsEntityKey) {
          expect(seen.outcome.stdout, `${where}: warning`).toContain(entityKeyFor(table, c));
          expect(seen.outcome.stdout, `${where}: warning`).toContain('RETAINED');
        }

        // 4. READ-ONLY PARITY. Neither adapter may write data_overrides — the
        //    warn-and-retain branch above least of all, since not discarding
        //    the override is its entire purpose. Migration 073 grants
        //    afldb_import SELECT and nothing else here (073:29-38), so a write
        //    would also fail closed in production; this proves the intent, not
        //    just the privilege.
        const expectedFingerprint = await (async () => {
          const [fp] = await sql<{ f: string | null }[]>`
            SELECT md5(string_agg(
                     o.entity_key || '|' || o.field_group || '|' || o.override_values::text
                       || '|' || o.is_active::text, E'\n' ORDER BY o.entity_key, o.field_group)) AS f
              FROM data_overrides o
             WHERE o.entity_type = ${table}
               AND (o.entity_key LIKE ${`%${MARKER}%`} OR o.entity_key = ANY(${allEntityKeys(table)}))
          `;
          return fp.f;
        })();
        expect(seen.overrideFingerprint, `${where}: data_overrides must be untouched`)
          .toBe(expectedFingerprint);
        expect(seen.overrideFingerprint, `${where}: the override must still be there`)
          .not.toBeNull();
      }

      // 5. And the two adapters must agree with EACH OTHER, not merely each
      //    with the corpus. This is the assertion D-3 actually asked for.
      const a = semantics(observations.player_achievements!, c);
      const b = semantics(observations.after_siren_kicks!, c);
      expect(
        { ...a, overridesUntouched: undefined, neutral: a.neutral },
        `TypeScript and Python diverged on "${c.name}"`,
      ).toEqual({ ...b, overridesUntouched: undefined, neutral: b.neutral });
    });
  }
});
