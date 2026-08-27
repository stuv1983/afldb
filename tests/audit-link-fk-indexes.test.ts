import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations');
const MIGRATION_NAME = '071_audit_link_fk_indexes.sql';

type IndexContract = {
  name: string;
  table: string;
  column: string;
  predicate: string | null;
  concurrently: boolean;
  ifNotExists: boolean;
};

function migration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

function withoutLineComments(sql: string): string {
  return sql.replace(/--.*$/gm, '').trim();
}

function indexContracts(sql: string): IndexContract[] {
  const pattern = /CREATE\s+INDEX\s+(?:(CONCURRENTLY)\s+)?(?:(IF\s+NOT\s+EXISTS)\s+)?([a-z0-9_]+)\s+ON\s+([a-z0-9_]+)\s*\(\s*([a-z0-9_]+)\s*\)\s*(?:WHERE\s+([a-z0-9_]+)\s+IS\s+NOT\s+NULL)?\s*;/gi;

  return [...withoutLineComments(sql).matchAll(pattern)].map((match) => ({
    name: match[3],
    table: match[4],
    column: match[5],
    predicate: match[6] ? `${match[6]} IS NOT NULL` : null,
    concurrently: Boolean(match[1]),
    ifNotExists: Boolean(match[2]),
  }));
}

function columnDefinition(sql: string, column: string): string {
  const line = sql.split(/\r?\n/).find((candidate) =>
    new RegExp(`^\\s*${column}\\s+`).test(candidate)
  );
  if (!line) throw new Error(`Column ${column} was not found`);
  return line.trim();
}

const expectedIndexes: IndexContract[] = [
  {
    name: 'ix_data_edits_admin_user_id',
    table: 'data_edits',
    column: 'admin_user_id',
    predicate: null,
    concurrently: false,
    ifNotExists: true,
  },
  {
    name: 'ix_plr_admin_user_id',
    table: 'player_link_resolutions',
    column: 'admin_user_id',
    predicate: null,
    concurrently: false,
    ifNotExists: true,
  },
  {
    name: 'ix_plr_player_id',
    table: 'player_link_resolutions',
    column: 'player_id',
    predicate: 'player_id IS NOT NULL',
    concurrently: false,
    ifNotExists: true,
  },
  {
    name: 'ix_pls_resolved_by',
    table: 'player_link_suggestions',
    column: 'resolved_by',
    predicate: 'resolved_by IS NOT NULL',
    concurrently: false,
    ifNotExists: true,
  },
];

describe('AFLDB-ISSUE-073 audit/link foreign-key indexes', () => {
  it('keeps migration 071 uniquely ordered between migrations 070 and 072', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    expect(files.filter((name) => /^(?:070|071|072)_/.test(name))).toEqual([
      '070_import_reads_link_suggestions.sql',
      MIGRATION_NAME,
      '072_dob_conflict_ownership.sql',
    ]);
  });

  it('pins the four FK definitions, parents, nullability, and default actions', () => {
    const playerLinks = migration('056_player_link_review.sql');
    const dataEdits = migration('057_data_edits.sql');
    const definitions = [
      columnDefinition(dataEdits, 'admin_user_id'),
      columnDefinition(playerLinks, 'admin_user_id'),
      columnDefinition(playerLinks, 'player_id'),
      columnDefinition(playerLinks, 'resolved_by'),
    ];

    expect(definitions).toEqual([
      'admin_user_id   integer NOT NULL REFERENCES auth_users(id),',
      'admin_user_id   integer NOT NULL REFERENCES auth_users(id),',
      'player_id       integer REFERENCES players(id),',
      'resolved_by     integer REFERENCES auth_users(id),',
    ]);
    for (const definition of definitions) {
      expect(definition).not.toMatch(/\bON\s+(?:DELETE|UPDATE)\b/i);
    }
  });

  it('creates exactly the four deterministic supporting indexes and nothing else', () => {
    const sql = migration(MIGRATION_NAME);
    const indexes = indexContracts(sql);
    const statements = withoutLineComments(sql)
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(indexes).toEqual(expectedIndexes);
    expect(statements).toHaveLength(expectedIndexes.length);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i);
    }
  });

  it('uses transaction-compatible CREATE INDEX and repository idempotency convention', () => {
    const sql = migration(MIGRATION_NAME);
    const indexes = indexContracts(sql);
    const establishedConventions = [
      migration('041_fk_indexes_and_dead_indexes.sql'),
      migration('050_nl_search_fk_indexes.sql'),
    ];

    expect(sql).not.toMatch(/\bCONCURRENTLY\b/i);
    expect(indexes.every((index) => index.ifNotExists && !index.concurrently)).toBe(true);
    for (const precedent of establishedConventions) {
      expect(precedent).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i);
    }
  });

  it('does not silence auth_users or players through DELETE_FREE_PARENTS', () => {
    const acceptanceTest = readFileSync(
      join(process.cwd(), 'tests', 'integration', 'fk-indexes.test.ts'),
      'utf8',
    );
    const exemptions = acceptanceTest.match(
      /const DELETE_FREE_PARENTS:[^=]+\s*=\s*\{([\s\S]*?)\n\};/,
    );

    expect(exemptions, 'DELETE_FREE_PARENTS block not found').not.toBeNull();
    expect(exemptions![1]).not.toMatch(/^\s*['"]?(?:auth_users|players)['"]?\s*:/m);
  });
});
