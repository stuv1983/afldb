/**
 * AFLDB-ISSUE-125 — the production promotion contract and its read-only checker.
 *
 * DB-free. The contract (tools/db/promotion-inventory.ts) is pinned against the migration
 * files, so a migration that creates a table forces a decision here; the checker's
 * argument and database-name rules are pinned so no phase can be pointed at the wrong
 * database; and the checker's source is asserted to carry no write path.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACCEPTANCE_CHECKLIST,
  CANDIDATE_PREFIX,
  DERIVED_FOOTBALL_TABLES,
  EMAIL_BEARING_TABLES,
  PRE_REBUILD_PREFIX,
  PROMOTION_CONTRACT,
  PromotionRefused,
  RESERVED_EXAMPLE_DOMAINS,
  RESERVED_TEST_TLDS,
  TEST_FIXTURE_EMAIL_SQL,
  assertDatabaseForPhase,
  assertOldDatabaseName,
  auditMarkerSql,
  classifyPublicTables,
  compareCounts,
  contractByName,
  databaseOf,
  isTestFixtureEmail,
  publicContractTables,
  reinstatePlan,
  reinstatedPublicTables,
  reinstatedSchemas,
  resyncIdentitySql,
  tablesWithTreatment,
  truncateSql,
  truncatedPublicTables,
  withDatabase,
  type Snapshot,
} from '../tools/db/promotion-inventory';
import { DEFAULT_DSN_ENV, READ_ONLY_SQL, parseArgs } from '../tools/db/promotion-check';

const REPO = process.cwd();
const MIGRATIONS = join(REPO, 'src', 'db', 'migrations');

/** Every `public` table any migration creates, after the one rename (015). */
function migrationPublicTables(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    // Statements in file order: 015 renames player_season_stats and then creates a new
    // table of the same name, so order within a file matters.
    const statements = [...sql.matchAll(
      /(create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_.]*))|(alter\s+table\s+([a-z_]+)\s+rename\s+to\s+([a-z_]+))|(drop\s+table\s+(?:if\s+exists\s+)?([a-z_]+))/gi,
    )];
    for (const m of statements) {
      if (m[2]) { if (!m[2].includes('.')) names.add(m[2]); }
      else if (m[4]) { names.delete(m[4]); names.add(m[5]); }
      else if (m[7]) names.delete(m[7]);
    }
  }
  return names;
}

/**
 * The football tables: everything the migrations create that the contract does NOT
 * name. Pinned so that a new table cannot appear without someone classifying it — the
 * live checker refuses at runtime, this refuses at test time.
 */
const PINNED_FOOTBALL_TABLES = [
  'award_nominations', 'award_winners', 'awards', 'brownlow_round_votes', 'brownlow_season_votes',
  'captaincies', 'club_aliases', 'club_organization_relations', 'club_organizations', 'club_seasons',
  'clubs', 'data_issues', 'derived_rebuilds', 'draft_persons', 'draft_picks', 'external_identities',
  'father_son_selections', 'hall_of_fame', 'honour_team_members', 'import_batches', 'import_rejections',
  'match_period_scores', 'matches', 'player_achievements', 'player_birth_evidence', 'player_career_stats',
  'player_club_season_stats', 'player_clubs', 'player_match_period_stats', 'player_match_stats',
  'player_name_aliases', 'player_relationships', 'player_season_stats', 'players', 'promotion_candidates',
  'seasons', 'sources', 'stat_availability', 'stat_definitions', 'venue_aliases', 'venues',
];

describe('the contract covers every non-football table the migrations create', () => {
  const created = migrationPublicTables();
  const contract = new Set(publicContractTables().map((t) => t.name));

  it('names only tables that exist in the migrations', () => {
    for (const name of contract) expect(created.has(name), `${name} is not created by any migration`).toBe(true);
  });

  it('leaves exactly the pinned football tables unclassified (a new table must be decided here)', () => {
    const rest = [...created].filter((n) => !contract.has(n)).sort();
    expect(rest).toEqual([...PINNED_FOOTBALL_TABLES].sort());
  });

  it('the derived list is a subset of the football tables', () => {
    for (const name of DERIVED_FOOTBALL_TABLES) expect(PINNED_FOOTBALL_TABLES).toContain(name);
  });

  it('every issue-named table has an explicit treatment', () => {
    for (const name of [
      'auth_users', 'auth_sessions', 'admin_invites', 'auth_audit_log', 'beta_access_codes',
      'beta_allowed_emails', 'beta_login_tokens', 'site_settings', 'app_health_events',
      'nl_search_log', 'data_edits', 'data_overrides',
    ]) {
      expect(contractByName(name), name).toBeDefined();
    }
    // data_issues is import-owned (migration 001) and import-writable: the rebuild's.
    expect(contractByName('data_issues')).toBeUndefined();
    expect(PINNED_FOOTBALL_TABLES).toContain('data_issues');
  });

  it('has no duplicate entries and a note on every row', () => {
    const keys = PROMOTION_CONTRACT.map((t) => `${t.schema}.${t.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of PROMOTION_CONTRACT) expect(t.note.length, `${t.name} note`).toBeGreaterThan(20);
  });
});

describe('the production-only state contract', () => {
  it('reinstates auth identity and authorisation, never sessions or magic links', () => {
    expect(contractByName('auth_users')?.treatment).toBe('reinstate');
    expect(contractByName('admin_invites')?.treatment).toBe('reinstate');
    expect(contractByName('auth_sessions')?.treatment).toBe('reset');
    expect(contractByName('beta_login_tokens')?.treatment).toBe('reset');
  });

  it('preserves operator choices, uploads and human data authority', () => {
    for (const name of ['site_settings', 'site_media', 'data_edits', 'data_overrides',
      'beta_access_codes', 'beta_allowed_emails', 'beta_join_requests',
      'data_submissions', 'data_submission_rows', 'player_link_suggestions', 'player_link_resolutions']) {
      expect(contractByName(name)?.treatment, name).toBe('reinstate');
    }
  });

  it('keeps the audit trail and marks it, rather than reconstructing it silently', () => {
    const audit = contractByName('auth_audit_log')!;
    expect(audit.treatment).toBe('reinstate');
    expect(audit.compare).toBe('atLeast');
    expect(auditMarkerSql({ candidate: 'c', oldDatabase: 'o', preCutoverDump: 'p', rebuiltDump: 'r' }))
      .toContain("'database.promoted'");
  });

  it('makes a conscious decision on telemetry (preserve) and on the observation-spine review (reset, recorded gap)', () => {
    for (const name of ['nl_search_log', 'nl_search_review', 'nl_search_feedback', 'app_health_events']) {
      expect(contractByName(name)?.treatment, name).toBe('reinstate');
    }
    const decisions = contractByName('promotion_decisions')!;
    expect(decisions.treatment).toBe('reset');
    expect(decisions.note).toMatch(/GAP/);
  });

  it('takes the machine mutation ledger and the acquisition spine from the rebuild, and reinstates AFLW', () => {
    expect(contractByName('canonical_applications')?.treatment).toBe('rebuilt');
    expect(tablesWithTreatment('rebuilt')).toEqual(['canonical_applications', 'staging.*']);
    expect(reinstatedSchemas()).toEqual(['staging_aflw']);
  });

  it('regenerates the one table whose NOT NULL football reference cannot be reinstated', () => {
    const t = contractByName('player_link_match_candidates')!;
    expect(t.treatment).toBe('regenerate');
    expect(t.footballRefs?.[0]).toMatchObject({ column: 'player_id', references: 'players', nullable: false });
  });

  it('declares every FK into rebuilt data that the migrations define on a contract table', () => {
    // From the migrations: 023 data_submissions.import_batch_id, 056 player_link_resolutions.player_id,
    // 067 player_link_match_candidates.player_id, 074 promotion_decisions.candidate_id.
    const refs = PROMOTION_CONTRACT.flatMap((t) => (t.footballRefs ?? []).map((r) => `${t.name}.${r.column}->${r.references}`)).sort();
    expect(refs).toEqual([
      'data_submissions.import_batch_id->import_batches',
      'player_link_match_candidates.player_id->players',
      'player_link_resolutions.player_id->players',
      'promotion_decisions.candidate_id->promotion_candidates',
    ]);
  });
});

describe('reinstatement order and generated SQL', () => {
  it('reinstates auth_users first and children after their parents', () => {
    const order = reinstatedPublicTables();
    expect(order[0]).toBe('auth_users');
    const at = (n: string) => order.indexOf(n);
    expect(at('data_submission_rows')).toBeGreaterThan(at('data_submissions'));
    expect(at('nl_search_review')).toBeGreaterThan(at('nl_search_log'));
    expect(at('nl_search_feedback')).toBeGreaterThan(at('nl_search_log'));
    expect(at('app_health_events')).toBeGreaterThan(at('nl_search_log'));
    for (const n of order) expect(at(n)).toBeGreaterThanOrEqual(at('auth_users'));
    expect(order).not.toContain('auth_sessions');
    expect(order).not.toContain('promotion_decisions');
    expect(order).not.toContain('player_link_match_candidates');
    expect(order).not.toContain('canonical_applications');
  });

  it('truncates every non-rebuilt contract table in one statement, without CASCADE', () => {
    const sql = truncateSql();
    for (const name of truncatedPublicTables()) expect(sql).toContain(`public.${name}`);
    expect(truncatedPublicTables()).not.toContain('canonical_applications');
    expect(sql).not.toContain('canonical_applications');
    expect(sql).not.toMatch(/CASCADE/);
    expect(sql).toContain("schemaname = 'staging_aflw'");
    expect(sql).not.toContain("schemaname = 'staging'");
    expect(sql).toContain('RESTART IDENTITY');
  });

  it('re-syncs identity sequences of exactly the reinstated tables', () => {
    const sql = resyncIdentitySql();
    for (const name of reinstatedPublicTables()) expect(sql).toContain(`'${name}'`);
    expect(sql).not.toContain("'auth_sessions'");
    expect(sql).toContain('setval');
    expect(sql).toContain("attidentity <> ''");
  });

  it('writes an explicit cutover marker that names what was reinstated, reset and left as a gap', () => {
    const sql = auditMarkerSql({
      candidate: 'afldb_prod_candidate_20260905', oldDatabase: 'afldb_prod',
      preCutoverDump: "/home/arm/backups/afldb/afldb_prod-2026.dump", rebuiltDump: "it's.dump",
    });
    expect(sql).toContain('INSERT INTO auth_audit_log');
    expect(sql).toContain("'database.promoted'");
    expect(sql).toContain("'afldb_prod_candidate_20260905'");
    expect(sql).toContain("'it''s.dump'");
    expect(sql).toContain("'auth_users'");
    expect(sql).toContain("'auth_sessions'");
    expect(sql).toContain('promotion_decisions: reset');
    expect(sql).toMatch(/actor_user_id[\s\S]*NULL/);
  });

  it('emits one single-transaction data-only pg_restore per reinstated table, in order, plus the AFLW schema', () => {
    const plan = reinstatePlan({ candidate: 'afldb_prod_candidate_x', oldDatabase: 'afldb_prod', preCutoverDump: 'pre.dump', rebuiltDump: 'rebuilt.dump' });
    const tables = [...plan.matchAll(/--table=([a-z_]+)/g)].map((m) => m[1]);
    expect(tables).toEqual(reinstatedPublicTables());
    expect(plan).toContain('--schema=staging_aflw');
    expect((plan.match(/--single-transaction/g) ?? []).length).toBe(tables.length + 1);
    expect(plan).toContain('--data-only');
    expect(plan).toContain('privileges.sql');
    expect(plan).toContain('--phase candidate');
    expect(plan).not.toMatch(/postgres(ql)?:\/\//);
  });
});

describe('test-fixture identity predicate', () => {
  const fixtures = [
    'email-intake-test-fixture@afldb.test', 'super@example.test', 'issue-112-club-bf@example.test',
    'admin@example.com', 'them@example.org', 'x@sub.example.net', 'A@EXAMPLE.COM', 'a@foo.invalid',
    'a@localhost', 'a@b.localhost', 'a@corp.example', 'a@x.test.', 'nobody', '@x.com', 'a@', 'a@.', '',
  ];
  const real = [
    'someone@gmail.com', 'ops@afldb.com', 'x@testing.com', 'x@example.community', 'x@mytest.io',
    'a@example.co.uk', 'a@test.example.com.au', 'a@localhost.com', 'a@invalid.org',
  ];

  it('refuses every reserved-domain or malformed address', () => {
    for (const email of fixtures) expect(isTestFixtureEmail(email), email).toBe(true);
  });

  it('accepts real-world addresses, including ones that merely contain the word test', () => {
    for (const email of real) expect(isTestFixtureEmail(email), email).toBe(false);
  });

  it('covers the whole reserved set', () => {
    expect([...RESERVED_TEST_TLDS].sort()).toEqual(['example', 'invalid', 'localhost', 'test']);
    expect([...RESERVED_EXAMPLE_DOMAINS].sort()).toEqual(['example.com', 'example.net', 'example.org']);
  });

  it('the SQL form is generated from the same sets and agrees with the TypeScript form', () => {
    for (const tld of RESERVED_TEST_TLDS) expect(TEST_FIXTURE_EMAIL_SQL).toContain(tld);
    for (const d of RESERVED_EXAMPLE_DOMAINS) expect(TEST_FIXTURE_EMAIL_SQL).toContain(d.replace('.', '\\.'));
    expect(TEST_FIXTURE_EMAIL_SQL).toContain("split_part(email, '@', 2)");

    // Emulate the SQL predicate in JS from the very regexes it carries.
    const patterns = [...TEST_FIXTURE_EMAIL_SQL.matchAll(/~ '([^']+)'/g)].map((m) => new RegExp(m[1]));
    expect(patterns).toHaveLength(2);
    const sqlPredicate = (email: string): boolean => {
      const pos = email.indexOf('@') + 1; // position() is 1-based, 0 when absent
      if (pos <= 1 || pos === email.length) return true;
      const domain = email.split('@')[1].toLowerCase().replace(/\.+$/, '');
      if (domain === '') return true;
      return patterns.some((p) => p.test(domain));
    };
    for (const email of [...fixtures, ...real]) {
      expect(sqlPredicate(email), email).toBe(isTestFixtureEmail(email));
    }
  });

  it('checks every table that stores an access-granting email', () => {
    expect([...EMAIL_BEARING_TABLES].sort()).toEqual(
      ['admin_invites', 'auth_users', 'beta_allowed_emails', 'beta_join_requests', 'beta_login_tokens']);
    for (const t of EMAIL_BEARING_TABLES) expect(contractByName(t), t).toBeDefined();
  });
});

describe('fail-closed classification', () => {
  const contract = publicContractTables().map((t) => t.name);

  it('passes when every public table is in exactly one set', () => {
    const problems = classifyPublicTables([...contract, 'players', 'matches'], ['players', 'matches']);
    expect(problems).toEqual([]);
  });

  it('refuses an unclassified table, a doubly-classified table and a missing one', () => {
    const problems = classifyPublicTables([...contract, 'players', 'brand_new_table'], ['players', 'auth_users']);
    expect(problems).toContainEqual({ kind: 'unclassified', table: 'brand_new_table' });
    expect(problems).toContainEqual({ kind: 'both', table: 'auth_users' });
    const missing = classifyPublicTables(contract.filter((n) => n !== 'site_media'), []);
    expect(missing).toContainEqual({ kind: 'missing', table: 'site_media' });
  });
});

describe('database-name contract', () => {
  it('binds each phase to one database shape', () => {
    expect(() => assertDatabaseForPhase('source', 'afldb_test')).not.toThrow();
    expect(() => assertDatabaseForPhase('source', 'afldb_prod')).toThrow(PromotionRefused);
    expect(() => assertDatabaseForPhase('pre-cutover', 'afldb_prod')).not.toThrow();
    expect(() => assertDatabaseForPhase('production', 'afldb_prod')).not.toThrow();
    expect(() => assertDatabaseForPhase('production', 'afldb_dev')).toThrow(PromotionRefused);
    expect(() => assertDatabaseForPhase('production', `${CANDIDATE_PREFIX}20260905`)).toThrow(PromotionRefused);
    expect(() => assertDatabaseForPhase('candidate', `${CANDIDATE_PREFIX}20260905`)).not.toThrow();
    expect(() => assertDatabaseForPhase('restored', `${CANDIDATE_PREFIX}20260905-1200`)).not.toThrow();
    expect(() => assertDatabaseForPhase('candidate', 'afldb_prod')).toThrow(/never a candidate/);
    expect(() => assertDatabaseForPhase('candidate', CANDIDATE_PREFIX)).toThrow(PromotionRefused);
    expect(() => assertDatabaseForPhase('candidate', 'afldb_test')).toThrow(PromotionRefused);
    expect(() => assertDatabaseForPhase('source', 'afldb_test; DROP')).toThrow(PromotionRefused);
  });

  it('the old database is production or a kept pre-rebuild copy', () => {
    expect(() => assertOldDatabaseName('afldb_prod')).not.toThrow();
    expect(() => assertOldDatabaseName(`${PRE_REBUILD_PREFIX}20260905`)).not.toThrow();
    expect(() => assertOldDatabaseName(PRE_REBUILD_PREFIX)).toThrow(PromotionRefused);
    expect(() => assertOldDatabaseName('afldb_test')).toThrow(PromotionRefused);
    expect(() => assertOldDatabaseName('afldb_dev')).toThrow(PromotionRefused);
  });

  it('replaces the database name in a DSN and nothing else', () => {
    const dsn = 'postgresql://afldb_owner:s3cret@127.0.0.1:5432/afldb_dev?sslmode=disable';
    const out = withDatabase(dsn, 'afldb_prod_candidate_1');
    expect(out).toBe('postgresql://afldb_owner:s3cret@127.0.0.1:5432/afldb_prod_candidate_1?sslmode=disable');
    expect(databaseOf(out)).toBe('afldb_prod_candidate_1');
    expect(databaseOf(dsn)).toBe('afldb_dev');
    expect(() => withDatabase('mysql://x/y', 'z')).toThrow(PromotionRefused);
    expect(() => withDatabase('not a url', 'z')).toThrow(PromotionRefused);
  });
});

describe('snapshot comparison', () => {
  const snapshot: Snapshot = {
    issue: 'AFLDB-ISSUE-125', database: 'afldb_prod', takenAt: 't',
    counts: { 'public.auth_users': 1, 'public.auth_audit_log': 92, 'public.auth_sessions': 17, 'staging_aflw.matches': 400 },
    superAdmins: 1, fixtureRows: 0,
  };

  it('applies equal / zero / atLeast / any and reports a missing table', () => {
    const findings = compareCounts(snapshot, [
      { table: 'public.auth_users', rule: 'equal' },
      { table: 'public.auth_audit_log', rule: 'atLeast' },
      { table: 'public.auth_sessions', rule: 'zero' },
      { table: 'public.canonical_applications', rule: 'any' },
      { table: 'staging_aflw.matches', rule: 'equal' },
      { table: 'public.site_media', rule: 'equal' },
    ], {
      'public.auth_users': 1, 'public.auth_audit_log': 93, 'public.auth_sessions': 0,
      'public.canonical_applications': 5000, 'staging_aflw.matches': 400,
    });
    expect(findings.map((f) => f.ok)).toEqual([true, true, true, true, true, false]);
    expect(findings[1].detail).toContain('1 row(s) added');
    expect(findings[5].detail).toContain('missing');
  });

  it('fails a reinstated table that lost rows, a reset table that kept rows, and an unknown snapshot key', () => {
    const findings = compareCounts(snapshot, [
      { table: 'public.auth_users', rule: 'equal' },
      { table: 'public.auth_sessions', rule: 'zero' },
      { table: 'public.beta_access_codes', rule: 'equal' },
    ], { 'public.auth_users': 0, 'public.auth_sessions': 17, 'public.beta_access_codes': 1 });
    expect(findings.map((f) => f.ok)).toEqual([false, false, false]);
    expect(findings[2].detail).toBe('not in the snapshot');
  });
});

describe('checker arguments', () => {
  it('requires a phase and a database, and binds them', () => {
    expect(() => parseArgs([])).toThrow(/--database is required/);
    expect(() => parseArgs(['--database', 'afldb_prod'])).toThrow(/--phase is required/);
    expect(() => parseArgs(['--phase', 'nope', '--database', 'x'])).toThrow(/Unknown phase/);
    expect(() => parseArgs(['--phase', 'production', '--database', 'afldb_dev'])).toThrow(PromotionRefused);
    const ok = parseArgs(['--phase', 'production', '--database', 'afldb_prod', '--compare', 's.json', '--expect-super-admin', 'ops@afldb.com']);
    expect(ok).toMatchObject({ phase: 'production', database: 'afldb_prod', compare: 's.json', dsnEnv: DEFAULT_DSN_ENV });
  });

  it('takes an environment variable NAME for the DSN, never a DSN', () => {
    expect(() => parseArgs(['--phase', 'source', '--database', 'afldb_test', '--dsn-env', 'postgresql://u:p@h/db']))
      .toThrow(/never a DSN/);
    expect(parseArgs(['--phase', 'source', '--database', 'afldb_test', '--dsn-env', 'AFLDB_TEST_DATABASE_URL']).dsnEnv)
      .toBe('AFLDB_TEST_DATABASE_URL');
  });

  it('scopes the phase-specific flags', () => {
    expect(() => parseArgs(['--phase', 'restored', '--database', `${CANDIDATE_PREFIX}1`])).toThrow(/--old-database/);
    expect(() => parseArgs(['--phase', 'candidate', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod'])).toThrow(/only meaningful/);
    expect(() => parseArgs(['--phase', 'source', '--database', 'afldb_test', '--compare', 's.json'])).toThrow(/only meaningful/);
    expect(() => parseArgs(['--phase', 'production', '--database', 'afldb_prod', '--expect-fingerprint', 'a'.repeat(64)])).toThrow(/only meaningful/);
    expect(() => parseArgs(['--phase', 'source', '--database', 'afldb_test', '--expect-fingerprint', 'zz'])).toThrow(/sha256/);
    expect(() => parseArgs(['--phase', 'production', '--database', 'afldb_prod', '--expect-super-admin', 'nope'])).toThrow(/email/);
    expect(() => parseArgs(['--phase', 'production', '--database', 'afldb_prod', '--bogus'])).toThrow(/Unknown argument/);
    const restored = parseArgs(['--phase', 'restored', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod']);
    expect(restored.oldDatabase).toBe('afldb_prod');
  });

  it('the plan needs a candidate, the old database, both dumps and a directory; the checklist needs nothing', () => {
    expect(parseArgs(['--checklist']).checklist).toBe(true);
    expect(() => parseArgs(['--plan', '--database', 'afldb_prod'])).toThrow(/only ever run on a candidate/);
    expect(() => parseArgs(['--plan', '--database', `${CANDIDATE_PREFIX}1`])).toThrow(/--old-database/);
    expect(() => parseArgs(['--plan', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod'])).toThrow(/--pre-cutover-dump/);
    const plan = parseArgs(['--plan', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod',
      '--pre-cutover-dump', 'a.dump', '--rebuilt-dump', 'b.dump', '--plan-dir', 'out']);
    expect(plan).toMatchObject({ plan: true, planDir: 'out', preCutoverDump: 'a.dump', rebuiltDump: 'b.dump' });
  });
});

describe('the checker is read-only by construction', () => {
  const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');

  it('puts every session into a server-enforced read-only mode before any query', () => {
    expect(READ_ONLY_SQL).toBe('SET default_transaction_read_only = on');
    const open = source.slice(source.indexOf('async function openReadOnly'));
    expect(open).toMatch(/await q\(READ_ONLY_SQL\);\s*return/);
  });

  it('imports no execution path that could restore, truncate or grant', () => {
    expect(source).not.toMatch(/child_process/);
    expect(source).not.toMatch(/from '\.\/psql'/);
    expect(source).not.toMatch(/runPsql|RESET_SQL|spawnSync/);
    // The only files it writes are the counts snapshot and the operator plan.
    expect((source.match(/writeFileSync\(/g) ?? []).length).toBe(2);
  });

  it('never prints a DSN: the target line names the variable and the database only', () => {
    expect(source).toMatch(/via \$\{opts\.dsnEnv\}/);
    expect(source).not.toMatch(/console\.log\([^)]*\bdsn\b/);
  });
});

describe('acceptance checklist', () => {
  it('covers the mandatory gates', () => {
    const text = ACCEPTANCE_CHECKLIST.join('\n');
    for (const needle of ['hostname', 'backup.sh', 'sha256', 'restore-test.sh', '--phase source', '--phase pre-cutover',
      'candidate', '--phase restored', '--phase candidate', '--phase production', 'privileges.sql', 'super admin',
      'TOTP', 'data_overrides', 'settle', 'Rollback', 'afldb_prod_pre_rebuild_', 'afldb-prod', 'streamanator']) {
      expect(text, needle).toContain(needle);
    }
  });
});
