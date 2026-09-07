/**
 * AFLDB-ISSUE-125 — the production promotion contract and its read-only checker.
 *
 * DB-free. The contract (tools/db/promotion-inventory.ts) is pinned against the migration
 * files, so a migration that creates a table forces a decision here; the checker's
 * argument and database-name rules are pinned so no phase can be pointed at the wrong
 * database; and the checker's source is asserted to carry no write path.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACCEPTANCE_CHECKLIST,
  CANDIDATE_PREFIX,
  DEFAULT_ENVIRONMENT,
  assertContractCoherent,
  effectiveCompare,
  effectiveTreatment,
  historicalOnlyFor,
  historicalOnlyProblems,
  historicalOnlyTables,
  isHistoricalOnlyColumn,
  judgeLineage,
  type TableTreatment,
  DERIVED_FOOTBALL_TABLES,
  EMAIL_BEARING_TABLES,
  ENVIRONMENTS,
  LINEAGE_IDENTITY_SQL,
  PRE_REBUILD_PREFIX,
  PROMOTION_CONTRACT,
  PromotionRefused,
  REBUILT_REFERRER_FKS,
  RESERVED_EXAMPLE_DOMAINS,
  RESERVED_TEST_TLDS,
  TEST_FIXTURE_EMAIL_SQL,
  assertDatabaseForPhase,
  assertOldDatabaseName,
  assertPromotionPlanCoherent,
  auditMarkerSql,
  classifyPublicTables,
  compareCounts,
  contractByName,
  databaseOf,
  detectLineageChange,
  environmentNames,
  isTestFixtureEmail,
  lineageRemapProblems,
  lineageBoundTables,
  lineageRemapSql,
  lineageTargetsOf,
  publicContractTables,
  promotionContractProblems,
  promotionPlanProblems,
  quoteIdent,
  reinstatePlan,
  resolveLineageRemap,
  reinstatedPublicTables,
  reinstatedSchemaTables,
  reinstatedSchemas,
  resyncIdentitySql,
  rollbackSql,
  swapSql,
  stableLineageTargetForFootballRef,
  tablesWithTreatment,
  truncateSql,
  truncatedPublicTables,
  withDatabase,
  type Snapshot,
} from '../tools/db/promotion-inventory';
import { DEFAULT_DSN_ENV, READ_ONLY_SQL, parseArgs, writePlan } from '../tools/db/promotion-check';

const REPO = process.cwd();
const MIGRATIONS = join(REPO, 'src', 'db', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Every `public` table any migration creates, after the one rename (015). `upTo` includes
 * that file and stops, which is how the migration-045 registry seed is reconstructed.
 */
function migrationPublicTables(upTo?: string): Set<string> {
  const names = new Set<string>();
  for (const file of migrationFiles()) {
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
    if (upTo && file === upTo) break;
  }
  return names;
}

/** SQL with `--` line comments removed: migration 045 documents its own API in one. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * AFLDB-ISSUE-142 (A). `afldb_meta.import_writable_tables` reconstructed FROM THE MIGRATIONS,
 * the way the live database builds it: migration 045 seeds it from the catalogue as it stood
 * then, minus a hand-typed operational exclusion list, and every later migration that creates
 * a table the ETL reloads calls `grant_import_write()`.
 *
 * The suite used to pin the football tables as a hand-written list, which silently ASSUMED
 * that a migration's non-contract table is import-writable. Migration 062 is the case that
 * assumption gets wrong: it registers nothing at all, so the live gate — which reads the
 * registry — refused every phase on every real database while this file passed. Deriving the
 * registry here means a future 062-shaped migration fails at test time, which is what
 * AFLDB-ISSUE-141's fail-closed classification was for.
 */
function migrationImportWritableTables(): Set<string> {
  const files = migrationFiles();
  const seedFile = files.find((f) => /^045_/.test(f));
  if (!seedFile) throw new Error('migration 045 (the registry) is missing');
  const seedSql = withoutComments(readFileSync(join(MIGRATIONS, seedFile), 'utf8'));

  // The exclusion list is read out of the migration, never re-typed here.
  const excludedBlock = /<>\s*ALL\s*\(\s*ARRAY\s*\[([\s\S]*?)\]\s*\)/.exec(seedSql);
  if (!excludedBlock) throw new Error('migration 045 no longer seeds the registry from the catalogue');
  const excluded = new Set([...excludedBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

  const registry = new Set<string>();
  for (const name of migrationPublicTables(seedFile)) if (!excluded.has(name)) registry.add(name);

  for (const file of files) {
    if (file < seedFile) continue;   // 045 defines grant_import_write(); nothing calls it earlier
    const sql = withoutComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
    for (const m of sql.matchAll(/grant_import_write\(\s*'([a-z_]+)'\s*\)/g)) registry.add(m[1]);
    for (const m of sql.matchAll(/revoke_import_write\(\s*'([a-z_]+)'\s*\)/g)) registry.delete(m[1]);
    // A registered table that is renamed away or dropped leaves a stale row privileges.sql
    // prunes, so the derived registry loses it too — and the new name is then unclassified
    // until someone decides it, which is the fail-closed direction.
    for (const m of sql.matchAll(/alter\s+table\s+([a-z_]+)\s+rename\s+to\s+([a-z_]+)|drop\s+table\s+(?:if\s+exists\s+)?([a-z_]+)/gi)) {
      registry.delete(m[1] ?? m[3]);
    }
  }
  return registry;
}

/**
 * The football tables: everything the migrations create that the contract does NOT name.
 * Pinned so that a new table cannot appear without someone classifying it — the live checker
 * refuses at runtime, this refuses at test time.
 *
 * AFLDB-ISSUE-142 (A): this list is no longer taken on trust. It is asserted equal to the
 * registry derived from the migrations themselves (`migrationImportWritableTables()`), so a
 * table that is merely *assumed* import-writable — as `player_match_period_stats` was, which
 * is why the live gate refused every phase while this suite passed — fails here.
 */
const PINNED_FOOTBALL_TABLES = [
  'after_siren_kicks', 'award_nominations', 'award_winners', 'awards', 'brownlow_round_votes',
  'brownlow_season_votes', 'captaincies', 'club_aliases', 'club_organization_relations',
  'club_organizations', 'club_seasons', 'coaches',
  'clubs', 'data_issues', 'derived_rebuilds', 'draft_persons', 'draft_picks', 'external_identities',
  'father_son_selections', 'hall_of_fame', 'honour_team_members', 'import_batches', 'import_rejections',
  'match_coaches', 'match_period_scores', 'matches', 'player_achievements', 'player_birth_evidence',
  'player_career_stats', 'player_height_evidence',
  'player_club_season_stats', 'player_clubs', 'player_match_stats',
  'player_name_aliases', 'player_relationships', 'player_season_stats', 'players', 'promotion_candidates',
  'seasons', 'sources', 'stat_availability', 'stat_definitions', 'venue_aliases', 'venues',
];

function generatedPlanArtifacts(environment: 'prod' | 'dev' = 'prod') {
  const input = {
    candidate: environment === 'prod' ? 'afldb_prod_candidate_test' : 'afldb_dev_candidate_test',
    oldDatabase: environment === 'prod' ? 'afldb_prod' : 'afldb_dev',
    preCutoverDump: '/backups/pre.dump', rebuiltDump: '/backups/rebuilt.dump', environment,
  } as const;
  return {
    truncate: truncateSql(),
    reinstate: reinstatePlan(input),
    resyncIdentity: resyncIdentitySql(environment),
    auditMarker: auditMarkerSql(input),
  };
}

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

  // AFLDB-ISSUE-141. The three migration-080 tables are deliberately NOT import-writable
  // (080_external_grids.sql: grant_import_write() would hand out UPDATE/DELETE/TRUNCATE and
  // privileges.sql would restore them at every reconcile). Before this issue they were in
  // neither set, so the classification gate refused every database carrying 080 AND — the
  // substantive defect — a generated plan named them in neither the truncate list nor the
  // reinstate list, which would have swapped an immutable captured corpus for empty tables.
  it('classifies every migration-080 table, so a plan can never silently drop the corpus', () => {
    const trio = ['external_grid_sources', 'external_grids', 'external_grid_axes'];
    for (const name of trio) {
      const t = contractByName(name);
      expect(t, `${name} must have an explicit treatment`).toBeDefined();
      expect(t!.treatment, name).toBe('reinstate');
      expect(t!.compare, name).toBe('equal');
      expect(truncatedPublicTables(), name).toContain(name);
      expect(reinstatedPublicTables(), name).toContain(name);
    }
    // Never registered import-writable: that is what makes the corpus immutable.
    const migration = readFileSync(join(MIGRATIONS, '080_external_grids.sql'), 'utf8');
    for (const name of trio) expect(migration).not.toContain(`grant_import_write('${name}')`);
    // And the migration really does create all three, so the contract is not naming ghosts.
    for (const name of trio) expect(migrationPublicTables().has(name), name).toBe(true);
  });

  // AFLDB-ISSUE-142 (A). The live gate reads afldb_meta.import_writable_tables and refuses a
  // public table that is in neither set. Reconstruct that registry from the migrations and
  // run the real classifier over it, so this suite fails exactly where the checker does.
  it('classifies every migration-created table the way the live gate does', () => {
    const created = [...migrationPublicTables()].sort();
    const registry = [...migrationImportWritableTables()].sort();
    for (const name of registry) expect(created, `${name} is registered but never created`).toContain(name);
    expect(classifyPublicTables(created, registry)).toEqual([]);
  });

  it('pins the football tables to the derived registry, not to an assumption', () => {
    expect([...migrationImportWritableTables()].sort()).toEqual([...PINNED_FOOTBALL_TABLES].sort());
  });

  // The table that proved the assumption wrong: created by migration 062, registered by
  // nothing (no grant_import_write, no grant_app_read), written by nothing, produced by no
  // rebuild stage — and therefore refused by the live gate on afldb_test AND afldb_dev.
  it('decides player_match_period_stats in the contract, without granting the ETL anything', () => {
    const t = contractByName('player_match_period_stats')!;
    expect(t, 'player_match_period_stats must have an explicit treatment').toBeDefined();
    expect(t.treatment).toBe('rebuilt');
    expect(t.compare).toBe('zero');
    expect(t.category).toBe('football');
    expect(truncatedPublicTables()).not.toContain('player_match_period_stats');
    expect(reinstatedPublicTables()).not.toContain('player_match_period_stats');
    expect(migrationImportWritableTables().has('player_match_period_stats')).toBe(false);
    const migration = readFileSync(join(MIGRATIONS, '062_player_match_period_stats.sql'), 'utf8');
    expect(migration).toContain('CREATE TABLE player_match_period_stats');
    expect(migration).not.toContain('grant_import_write');
    expect(migration).not.toContain('grant_app_read');
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
    expect(tablesWithTreatment('rebuilt'))
      .toEqual(['canonical_applications', 'player_match_period_stats', 'staging.*']);
    expect(reinstatedSchemas()).toEqual(['staging_aflw']);
  });

  it('regenerates the one table whose NOT NULL football reference cannot be reinstated', () => {
    const t = contractByName('player_link_match_candidates')!;
    expect(t.treatment).toBe('regenerate');
    expect(t.footballRefs?.[0]).toMatchObject({ column: 'player_id', references: 'players', nullable: false });
  });

  it('declares every FK into rebuilt data that the migrations define on a contract table', () => {
    // From the migrations: 023 data_submissions.import_batch_id, 056 player_link_resolutions.player_id,
    // 067 player_link_match_candidates.player_id, 074 promotion_decisions.candidate_id,
    // 080 external_grid_sources.ingest_source_id and external_grids.import_batch_id.
    const refs = PROMOTION_CONTRACT.flatMap((t) => (t.footballRefs ?? []).map((r) => `${t.name}.${r.column}->${r.references}`)).sort();
    expect(refs).toEqual([
      'data_submissions.import_batch_id->import_batches',
      'external_grid_sources.ingest_source_id->sources',
      'external_grids.import_batch_id->import_batches',
      'player_link_match_candidates.player_id->players',
      'player_link_resolutions.player_id->players',
      'promotion_decisions.candidate_id->promotion_candidates',
    ]);
  });

  // AFLDB-ISSUE-141. Both migration-080 references are NOT NULL into import-writable
  // (rebuilt) tables, so neither can take the nullable exception path of §7.4. The contract
  // must therefore carry a decided remediation for each, or the checker's refusal has no
  // path out of it and the corpus is stranded.
  it('records an explicit remediation for every NOT NULL reference it reinstates', () => {
    for (const t of PROMOTION_CONTRACT) {
      for (const ref of t.footballRefs ?? []) {
        if (t.treatment !== 'reinstate' || ref.nullable) continue;
        expect(ref.remediation, `${t.name}.${ref.column}`).toBeTruthy();
        expect(ref.remediation!.length, `${t.name}.${ref.column}`).toBeGreaterThan(40);
      }
    }
    expect(contractByName('external_grids')!.footballRefs![0].remediation).toMatch(/import_batches/);
    expect(contractByName('external_grid_sources')!.footballRefs![0].remediation).toMatch(/gridley/);
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

  // AFLDB-ISSUE-141. external_grids.source_id -> external_grid_sources (NOT NULL) and
  // external_grid_axes.grid_id -> external_grids (ON DELETE CASCADE): the reinstate order
  // is the only thing that keeps a per-table pg_restore from tripping either FK, and the
  // truncate must remove migration 080's own external_grid_sources seed before the dump's
  // row is restored so external_grids.source_id lands on the same id.
  it('reinstates the captured grid corpus in FK order, after emptying the migration seed', () => {
    const order = reinstatedPublicTables();
    const at = (n: string) => order.indexOf(n);
    expect(at('external_grid_sources')).toBeGreaterThanOrEqual(0);
    expect(at('external_grids')).toBeGreaterThan(at('external_grid_sources'));
    expect(at('external_grid_axes')).toBeGreaterThan(at('external_grids'));
    const truncate = truncateSql();
    for (const n of ['external_grid_sources', 'external_grids', 'external_grid_axes']) {
      expect(truncate, n).toContain(`"public"."${n}"`);
    }
    // Truncated together in the one statement, so no CASCADE is needed for the cascade FK.
    expect(truncate).not.toMatch(/CASCADE/);
  });

  it('truncates every non-rebuilt contract table in one statement, without CASCADE', () => {
    const sql = truncateSql();
    for (const name of truncatedPublicTables()) expect(sql).toContain(`"public"."${name}"`);
    expect(truncatedPublicTables()).not.toContain('canonical_applications');
    expect(sql).not.toContain('canonical_applications');
    expect(sql).not.toMatch(/CASCADE/);
    expect(sql).toContain("schemaname = 'staging_aflw'");
    expect(sql).not.toContain("schemaname = 'staging'");
    expect(sql).toContain('RESTART IDENTITY');
    // AFLDB-ISSUE-139 Phase 4E-2: staging_aflw.matches -> staging_aflw.fixtures refused a
    // table-at-a-time truncate of the schema; it must be one statement over every table.
    expect(sql).toContain("string_agg(format('%I.%I', schemaname, tablename)");
    expect(sql).toContain("EXECUTE 'TRUNCATE TABLE ' || tabs || ' RESTART IDENTITY'");
    expect(sql).not.toMatch(/FOR r IN SELECT tablename/);
  });

  // AFLDB-ISSUE-139 Phase 4E-2: the first live run of promotion-truncate.sql was refused —
  // "cannot truncate a table referenced in a foreign key constraint": migration 074's
  // promotion_candidates.resolved_decision_id -> promotion_decisions(id). The referrer is
  // REBUILT, so it can neither join the TRUNCATE nor be cascaded, and promotion_decisions
  // cannot leave the statement either (it references auth_users). The constraint is dropped
  // before the one TRUNCATE and re-added by its original name after it, in one transaction.
  it('drops and re-adds the rebuilt-side FK around the one TRUNCATE (074)', () => {
    const fk = REBUILT_REFERRER_FKS.find((f) => f.references === 'promotion_decisions');
    expect(fk).toBeDefined();
    expect(fk!.referrer).toBe('promotion_candidates');
    expect(fk!.constraint).toBe('promotion_candidates_decision_fk');
    expect(fk!.column).toBe('resolved_decision_id');
    const sql = truncateSql();
    const drop = sql.indexOf('ALTER TABLE "public"."promotion_candidates" DROP CONSTRAINT "promotion_candidates_decision_fk";');
    const truncate = sql.indexOf('TRUNCATE TABLE');
    const add = sql.indexOf('ALTER TABLE "public"."promotion_candidates" ADD CONSTRAINT "promotion_candidates_decision_fk"');
    expect(drop).toBeGreaterThan(sql.indexOf('BEGIN;'));
    expect(truncate).toBeGreaterThan(drop);
    expect(add).toBeGreaterThan(truncate);
    expect(sql.indexOf('COMMIT;')).toBeGreaterThan(add);
    expect(sql).toContain('FOREIGN KEY ("resolved_decision_id") REFERENCES "public"."promotion_decisions"("id");');
    expect(sql).not.toMatch(/CASCADE/);
    expect(sql).not.toMatch(/DELETE FROM/);
    for (const f of REBUILT_REFERRER_FKS) {
      expect(truncatedPublicTables(), f.references).toContain(f.references);
      expect(contractByName(f.referrer)?.treatment ?? 'rebuilt', f.referrer).toBe('rebuilt');
    }
    // The constraint name and column are pinned to the migration that created them.
    const migrations = readdirSync(join(process.cwd(), 'src', 'db', 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(process.cwd(), 'src', 'db', 'migrations', f), 'utf8'))
      .join('\n');
    expect(migrations).toMatch(/promotion_candidates_decision_fk\s+FOREIGN KEY \(resolved_decision_id\)\s+REFERENCES promotion_decisions\(id\)/);
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
    const plan = reinstatePlan({ candidate: 'afldb_prod_candidate_x', oldDatabase: 'afldb_prod', preCutoverDump: '/backups/pre.dump', rebuiltDump: '/backups/rebuilt.dump' });
    const publicTables = [...plan.matchAll(/--exit-on-error --table=([a-z_]+)/g)].map((m) => m[1]);
    expect(publicTables).toEqual(reinstatedPublicTables());
    // AFLDB-ISSUE-139 Phase 4E-2: `--schema=staging_aflw` alone restores in TOC (alphabetical)
    // order and the single transaction dies on fixtures -> seasons. One line per table, in
    // the contract's FK order, and every table of migration 025's schema is listed exactly once.
    const schemaTables = [...plan.matchAll(/--schema=staging_aflw --table=([a-z_]+)/g)].map((m) => m[1]);
    expect(plan).not.toMatch(/--schema=staging_aflw "/);
    expect(schemaTables).toEqual(reinstatedSchemaTables().map((t) => t.table));
    const migration025 = readFileSync(join(process.cwd(), 'src', 'db', 'migrations', '025_staging_aflw.sql'), 'utf8');
    const created = [...migration025.matchAll(/CREATE TABLE staging_aflw\.([a-z_]+)/g)].map((m) => m[1]);
    expect([...schemaTables].sort()).toEqual([...new Set(created)].sort());
    // Every referenced table precedes its referrer in the plan.
    const migrationDependencies: string[] = [];
    for (const m of migration025.matchAll(/CREATE TABLE staging_aflw\.([a-z_]+)([\s\S]*?)\);/g)) {
      const referrer = m[1];
      for (const ref of m[2].matchAll(/REFERENCES staging_aflw\.([a-z_]+)/g)) {
        migrationDependencies.push(`${referrer}->${ref[1]}`);
        expect(schemaTables.indexOf(ref[1]), `${referrer} -> ${ref[1]}`).toBeLessThan(schemaTables.indexOf(referrer));
      }
    }
    const schemaContract = PROMOTION_CONTRACT.find((t) => t.schema === 'staging_aflw')!;
    const declaredDependencies = (schemaContract.tableDependencies ?? [])
      .flatMap((dependency) => dependency.dependsOn.map((parent) => `${dependency.table}->${parent}`));
    expect([...declaredDependencies].sort()).toEqual([...new Set(migrationDependencies)].sort());
    expect((plan.match(/--single-transaction/g) ?? []).length).toBe(publicTables.length + schemaTables.length);
    expect(plan).toContain('--data-only');
    expect(plan).toContain('privileges.sql');
    expect(plan).toContain('--phase candidate');
    expect(plan).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('the generated plan restores the migration-080 corpus, in order', () => {
    const plan = reinstatePlan({
      candidate: 'afldb_prod_candidate_x', oldDatabase: 'afldb_prod',
      preCutoverDump: '/backups/pre.dump', rebuiltDump: '/backups/rebuilt.dump',
    });
    const tables = [...plan.matchAll(/--exit-on-error --table=([a-z_]+)/g)].map((m) => m[1]);
    expect(tables).toContain('external_grid_sources');
    expect(tables).toContain('external_grids');
    expect(tables).toContain('external_grid_axes');
    expect(tables.indexOf('external_grids')).toBeGreaterThan(tables.indexOf('external_grid_sources'));
    expect(tables.indexOf('external_grid_axes')).toBeGreaterThan(tables.indexOf('external_grids'));
  });

  it('validates the complete generated plan before it can be written', () => {
    for (const environment of ['prod', 'dev'] as const) {
      const artifacts = generatedPlanArtifacts(environment);
      expect(promotionContractProblems()).toEqual([]);
      expect(promotionPlanProblems(artifacts, environment)).toEqual([]);
      expect(() => assertPromotionPlanCoherent(artifacts, environment)).not.toThrow();
    }
  });

  it('refuses DELETE substitution and an incomplete or misordered FK lifecycle', () => {
    const artifacts = generatedPlanArtifacts();
    const deleteSubstitution = {
      ...artifacts,
      truncate: artifacts.truncate.replace('TRUNCATE TABLE\n  ', 'DELETE FROM\n  '),
    };
    expect(() => assertPromotionPlanCoherent(deleteSubstitution))
      .toThrow(/substitutes DELETE/);

    const fk = REBUILT_REFERRER_FKS[0];
    const addText = `ALTER TABLE "public"."${fk.referrer}" ADD CONSTRAINT "${fk.constraint}"`;
    const addStart = artifacts.truncate.indexOf(addText);
    const addEnd = artifacts.truncate.indexOf(';', addStart) + 1;
    const missingAdd = {
      ...artifacts,
      truncate: artifacts.truncate.slice(0, addStart) + artifacts.truncate.slice(addEnd),
    };
    expect(() => assertPromotionPlanCoherent(missingAdd)).toThrow(/exactly one DROP and one ADD/);

    const addBlock = artifacts.truncate.slice(addStart, addEnd);
    const withoutAdd = artifacts.truncate.slice(0, addStart) + artifacts.truncate.slice(addEnd);
    const beforeTruncate = withoutAdd.indexOf('TRUNCATE TABLE');
    const earlyAdd = {
      ...artifacts,
      truncate: withoutAdd.slice(0, beforeTruncate) + addBlock + '\n' + withoutAdd.slice(beforeTruncate),
    };
    expect(() => assertPromotionPlanCoherent(earlyAdd)).toThrow(/BEGIN -> DROP -> TRUNCATE -> ADD -> COMMIT/);
  });

  it('refuses staging_aflw TOC/alphabetical restore and unsafe whole-schema fallback', () => {
    const artifacts = generatedPlanArtifacts();
    const perTableTruncate = artifacts.truncate.replace(
      "EXECUTE 'TRUNCATE TABLE ' || tabs || ' RESTART IDENTITY'",
      "EXECUTE format('TRUNCATE TABLE staging_aflw.%I RESTART IDENTITY', tablename)",
    );
    expect(() => assertPromotionPlanCoherent({ ...artifacts, truncate: perTableTruncate }))
      .toThrow(/not one FK-safe schema\/table-group statement/);
    const swapped = artifacts.reinstate
      .replace('--schema=staging_aflw --table=seasons', '--schema=staging_aflw --table=__first__')
      .replace('--schema=staging_aflw --table=fixtures', '--schema=staging_aflw --table=seasons')
      .replace('--schema=staging_aflw --table=__first__', '--schema=staging_aflw --table=fixtures');
    expect(() => assertPromotionPlanCoherent({ ...artifacts, reinstate: swapped }))
      .toThrow(/staging_aflw restore order/);
    expect(() => assertPromotionPlanCoherent({
      ...artifacts, reinstate: `${artifacts.reinstate}\npg_restore --schema=staging_aflw "x.dump"\n`,
    })).toThrow(/whole-schema\/TOC order/);
  });

  it('rejects contradictory dispositions, invalid dependencies and pre-restore FK recreation', () => {
    const duplicate: TableTreatment = {
      ...contractByName('data_edits')!, treatment: 'reset', compare: 'zero',
    };
    expect(promotionContractProblems([...PROMOTION_CONTRACT, duplicate]).join('\n'))
      .toContain('public.data_edits has contradictory duplicate dispositions');

    const badSchema = PROMOTION_CONTRACT.map((table) => table.schema === 'staging_aflw'
      ? { ...table, tables: [...table.tables!].sort() }
      : table);
    expect(promotionContractProblems(badSchema).join('\n'))
      .toContain("staging_aflw.* restore order puts 'fixtures' before required parent 'seasons'");

    const restoreDecisions = PROMOTION_CONTRACT.map((table) => table.name === 'promotion_decisions'
      ? { ...table, treatment: 'reinstate' as const, compare: 'equal' as const }
      : table);
    expect(promotionContractProblems(restoreDecisions).join('\n'))
      .toContain('targets restored data, but this lifecycle recreates before restore');
  });

  // AFLDB-ISSUE-141. The plan is environment-aware, and `prod` output is byte-identical to
  // what it was before the environment existed.
  it('generates the same production plan as before, and a DEV plan only when asked', () => {
    const base = {
      oldDatabase: 'afldb_prod', preCutoverDump: '/backups/pre.dump', rebuiltDump: '/backups/rebuilt.dump',
    };
    const prod = reinstatePlan({ ...base, candidate: 'afldb_prod_candidate_x' });
    expect(prod).toBe(reinstatePlan({ ...base, candidate: 'afldb_prod_candidate_x', environment: 'prod' }));
    expect(prod).toContain('PROD (afldb-prod)');
    expect(prod).not.toContain('--environment');

    const dev = reinstatePlan({
      candidate: 'afldb_dev_candidate_x', oldDatabase: 'afldb_dev',
      preCutoverDump: '/backups/pre.dump', rebuiltDump: '/backups/rebuilt.dump', environment: 'dev',
    });
    expect(dev).toContain('DEV (streamanator)');
    expect(dev).toContain('--environment dev');
    expect(dev).not.toContain('afldb-prod');
    // Same contract, same order: dev is a name shape, not a different plan — except for the
    // tables AFLDB-ISSUE-143 withholds there, which the dev list itself accounts for.
    expect([...dev.matchAll(/--exit-on-error --table=([a-z_]+)/g)].map((m) => m[1])).toEqual(reinstatedPublicTables('dev'));
  });

  it('names the environment in the audit marker, defaulting to production', () => {
    const prod = auditMarkerSql({ candidate: 'c', oldDatabase: 'o', preCutoverDump: 'p', rebuiltDump: 'r' });
    expect(prod).toContain("'operator: production promotion (AFLDB-ISSUE-125)'");
    expect(prod).toContain("'environment', 'prod'");
    const dev = auditMarkerSql({
      candidate: 'c', oldDatabase: 'o', preCutoverDump: 'p', rebuiltDump: 'r', environment: 'dev',
    });
    expect(dev).toContain("'operator: dev promotion (AFLDB-ISSUE-125)'");
    expect(dev).toContain("'environment', 'dev'");
  });

  it('quotes every database identifier in generated swap and rollback SQL', () => {
    const input = {
      candidate: 'afldb_dev_candidate_20260906-112500', oldDatabase: 'afldb_dev',
      preCutoverDump: '/home/arm/example.dump', rebuiltDump: '/home/arm/rebuilt.dump',
      environment: 'dev' as const,
    };
    expect(quoteIdent('afldb_dev_pre_rebuild_20260906-112500'))
      .toBe('"afldb_dev_pre_rebuild_20260906-112500"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
    const swap = swapSql(input);
    expect(swap).toContain('ALTER DATABASE "afldb_dev" RENAME TO "afldb_dev_pre_rebuild_20260906-112500";');
    expect(swap).toContain('ALTER DATABASE "afldb_dev_candidate_20260906-112500" RENAME TO "afldb_dev";');
    const rollback = rollbackSql(input);
    expect(rollback).toContain('ALTER DATABASE "afldb_dev" RENAME TO "afldb_dev_candidate_20260906-112500";');
    expect(rollback).toContain('ALTER DATABASE "afldb_dev_pre_rebuild_20260906-112500" RENAME TO "afldb_dev";');
    expect(`${swap}\n${rollback}`).not.toMatch(/ALTER DATABASE\s+[a-z_0-9-]+\s+RENAME TO\s+[a-z_0-9-]+/i);
  });

  it('writes the quoted hyphen-safe swap and rollback as part of the operator plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-promotion-plan-'));
    try {
      const files = writePlan({
        environment: 'dev', plan: true, checklist: false, allowFixtureIdentities: false,
        dsnEnv: 'AFLDB_OWNER_DATABASE_URL', database: 'afldb_dev_candidate_20260906-112500',
        oldDatabase: 'afldb_dev', preCutoverDump: '/home/arm/example.dump',
        rebuiltDump: '/home/arm/rebuilt.dump', planDir: dir,
      });
      expect(files.map((file) => file.split(/[\\/]/).at(-1))).toEqual([
        'promotion-truncate.sql', 'promotion-resync-identity.sql',
        'promotion-audit-marker.sql', 'promotion-reinstate.sh',
        'promotion-swap.sql', 'promotion-rollback.sql',
      ]);
      expect(readFileSync(join(dir, 'promotion-swap.sql'), 'utf8'))
        .toContain('RENAME TO "afldb_dev_pre_rebuild_20260906-112500"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  // AFLDB-ISSUE-141. The environment is an explicit descriptor, never a deduction from the
  // name offered. The matrix below is the whole safety property: one more accepted shape per
  // phase, and every refusal that existed before still refuses.
  it('defaults to production, and production behaviour is unchanged without the flag', () => {
    expect(DEFAULT_ENVIRONMENT).toBe('prod');
    expect([...ENVIRONMENTS].sort()).toEqual(['dev', 'prod']);
    const prod = environmentNames();
    expect(prod).toMatchObject({
      environment: 'prod', live: 'afldb_prod', source: 'afldb_test',
      candidatePrefix: CANDIDATE_PREFIX, preRebuildPrefix: PRE_REBUILD_PREFIX,
    });
    expect(environmentNames('prod')).toEqual(prod);
    // Every no-environment call site keeps the production contract.
    expect(() => assertDatabaseForPhase('production', 'afldb_prod')).not.toThrow();
    expect(() => assertDatabaseForPhase('production', 'afldb_dev')).toThrow(PromotionRefused);
    expect(() => assertOldDatabaseName('afldb_prod')).not.toThrow();
    expect(() => assertOldDatabaseName('afldb_dev')).toThrow(PromotionRefused);
  });

  it('accepts the dev shapes only under --environment dev, with the same fail-closed matrix', () => {
    const dev = environmentNames('dev');
    expect(dev).toMatchObject({
      environment: 'dev', live: 'afldb_dev', source: 'afldb_test',
      candidatePrefix: 'afldb_dev_candidate_', preRebuildPrefix: 'afldb_dev_pre_rebuild_',
    });

    // Source: the rebuild target is afldb_test in both environments — db:test:rebuild
    // accepts no other name — so this phase is deliberately identical.
    expect(() => assertDatabaseForPhase('source', 'afldb_test', 'dev')).not.toThrow();
    expect(() => assertDatabaseForPhase('source', 'afldb_dev', 'dev')).toThrow(PromotionRefused);

    // Live phases.
    for (const phase of ['pre-cutover', 'production'] as const) {
      expect(() => assertDatabaseForPhase(phase, 'afldb_dev', 'dev')).not.toThrow();
      expect(() => assertDatabaseForPhase(phase, 'afldb_prod', 'dev')).toThrow(PromotionRefused);
      expect(() => assertDatabaseForPhase(phase, 'afldb_dev', 'prod')).toThrow(PromotionRefused);
    }

    // Candidate phases: a dev candidate under dev, and nothing else.
    for (const phase of ['restored', 'candidate'] as const) {
      expect(() => assertDatabaseForPhase(phase, 'afldb_dev_candidate_20260906', 'dev')).not.toThrow();
      expect(() => assertDatabaseForPhase(phase, 'afldb_dev', 'dev')).toThrow(/never a candidate/);
      expect(() => assertDatabaseForPhase(phase, 'afldb_dev_candidate_', 'dev')).toThrow(PromotionRefused);
      expect(() => assertDatabaseForPhase(phase, 'afldb_prod_candidate_20260906', 'dev')).toThrow(PromotionRefused);
      expect(() => assertDatabaseForPhase(phase, 'afldb_dev_candidate_20260906', 'prod')).toThrow(PromotionRefused);
    }

    // Malformed names are refused before the environment is consulted at all.
    expect(() => assertDatabaseForPhase('source', 'afldb_test; DROP', 'dev')).toThrow(/not a plausible/);
    expect(() => assertDatabaseForPhase('candidate', 'afldb_dev_candidate_x; DROP', 'dev')).toThrow(/not a plausible/);

    // Old-database names, both directions.
    expect(() => assertOldDatabaseName('afldb_dev', 'dev')).not.toThrow();
    expect(() => assertOldDatabaseName('afldb_dev_pre_rebuild_20260906', 'dev')).not.toThrow();
    expect(() => assertOldDatabaseName('afldb_dev_pre_rebuild_', 'dev')).toThrow(PromotionRefused);
    expect(() => assertOldDatabaseName('afldb_prod', 'dev')).toThrow(PromotionRefused);
    expect(() => assertOldDatabaseName('afldb_prod_pre_rebuild_20260906', 'dev')).toThrow(PromotionRefused);
    expect(() => assertOldDatabaseName('afldb_dev_pre_rebuild_20260906', 'prod')).toThrow(PromotionRefused);
    expect(() => assertOldDatabaseName('afldb_test', 'dev')).toThrow(PromotionRefused);
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
    // AFLDB-ISSUE-142: the remap needs both databases, which only `restored` opens.
    expect(() => parseArgs(['--phase', 'candidate', '--database', `${CANDIDATE_PREFIX}1`,
      '--lineage-remap-out', 'remap.sql'])).toThrow(/only meaningful with --phase restored/);
    expect(parseArgs(['--phase', 'restored', '--database', `${CANDIDATE_PREFIX}1`,
      '--old-database', 'afldb_prod', '--lineage-remap-out', 'remap.sql']).lineageRemapOut)
      .toBe('remap.sql');
    const restored = parseArgs(['--phase', 'restored', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod']);
    expect(restored.oldDatabase).toBe('afldb_prod');
  });

  // AFLDB-ISSUE-141.
  it('defaults --environment to prod and refuses anything but prod|dev', () => {
    expect(parseArgs(['--phase', 'source', '--database', 'afldb_test']).environment).toBe('prod');
    expect(parseArgs(['--environment', 'prod', '--phase', 'production', '--database', 'afldb_prod']).environment).toBe('prod');
    expect(parseArgs(['--environment', 'dev', '--phase', 'production', '--database', 'afldb_dev']).environment).toBe('dev');
    expect(() => parseArgs(['--environment', 'staging', '--phase', 'source', '--database', 'afldb_test']))
      .toThrow(/Unknown environment/);
    expect(() => parseArgs(['--environment', '--phase'])).toThrow(/needs a value/);
  });

  it('binds each phase to its own environment, in both directions', () => {
    // dev names are refused under the default (prod) contract
    expect(() => parseArgs(['--phase', 'production', '--database', 'afldb_dev'])).toThrow(PromotionRefused);
    expect(() => parseArgs(['--phase', 'candidate', '--database', 'afldb_dev_candidate_1'])).toThrow(PromotionRefused);
    // prod names are refused once dev is stated
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'production', '--database', 'afldb_prod'])).toThrow(PromotionRefused);
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'candidate', '--database', `${CANDIDATE_PREFIX}1`])).toThrow(PromotionRefused);
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', 'afldb_dev_candidate_1',
      '--old-database', 'afldb_prod'])).toThrow(PromotionRefused);
    // and the dev path works when everything is stated
    const dev = parseArgs(['--environment', 'dev', '--phase', 'restored',
      '--database', 'afldb_dev_candidate_1', '--old-database', 'afldb_dev']);
    expect(dev).toMatchObject({ environment: 'dev', database: 'afldb_dev_candidate_1', oldDatabase: 'afldb_dev' });
  });

  it('offers the fixture-identity acceptance on DEV only, and never by default', () => {
    expect(parseArgs(['--phase', 'production', '--database', 'afldb_prod']).allowFixtureIdentities).toBe(false);
    expect(parseArgs(['--environment', 'dev', '--phase', 'production', '--database', 'afldb_dev']).allowFixtureIdentities)
      .toBe(false);
    const accepted = parseArgs(['--environment', 'dev', '--phase', 'production', '--database', 'afldb_dev',
      '--allow-fixture-identities']);
    expect(accepted.allowFixtureIdentities).toBe(true);
    // Refused under prod — including the implicit prod of no --environment at all, and even
    // in the modes that never consult it, so it can never be silently ignored.
    for (const argv of [
      ['--phase', 'production', '--database', 'afldb_prod', '--allow-fixture-identities'],
      ['--environment', 'prod', '--phase', 'production', '--database', 'afldb_prod', '--allow-fixture-identities'],
      ['--checklist', '--allow-fixture-identities'],
    ]) {
      expect(() => parseArgs(argv), argv.join(' ')).toThrow(/DEV-only/);
    }
  });

  it('the plan needs a candidate, the old database, both dumps and a directory; the checklist needs nothing', () => {
    expect(parseArgs(['--checklist']).checklist).toBe(true);
    expect(() => parseArgs(['--plan', '--database', 'afldb_prod'])).toThrow(/only ever run on a candidate/);
    expect(() => parseArgs(['--plan', '--database', `${CANDIDATE_PREFIX}1`])).toThrow(/--old-database/);
    expect(() => parseArgs(['--plan', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod'])).toThrow(/--pre-cutover-dump/);
    const plan = parseArgs(['--plan', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod',
      '--pre-cutover-dump', '/home/arm/a.dump', '--rebuilt-dump', '/home/arm/b.dump', '--plan-dir', 'out']);
    expect(plan).toMatchObject({ plan: true, planDir: 'out', preCutoverDump: '/home/arm/a.dump', rebuiltDump: '/home/arm/b.dump' });
    expect(() => parseArgs(['--plan', '--database', `${CANDIDATE_PREFIX}1`, '--old-database', 'afldb_prod',
      '--pre-cutover-dump', 'C:/Program Files/Git/home/arm/example.dump',
      '--rebuilt-dump', '/home/arm/b.dump', '--plan-dir', 'out']))
      .toThrow(/MSYS_NO_PATHCONV=1/);
  });

  // AFLDB-ISSUE-141. --plan is the only supported producer of a preservation plan, so its
  // prefix check is the gate that decides whether DEV can be promoted by the procedure at all.
  it('binds --plan to the stated environment candidate prefix', () => {
    const devArgs = ['--plan', '--database', 'afldb_dev_candidate_1', '--old-database', 'afldb_dev',
      '--pre-cutover-dump', '/home/arm/a.dump', '--rebuilt-dump', '/home/arm/b.dump', '--plan-dir', 'out'];
    expect(() => parseArgs(devArgs)).toThrow(/only ever run on a candidate/);
    expect(parseArgs(['--environment', 'dev', ...devArgs])).toMatchObject({
      plan: true, environment: 'dev', database: 'afldb_dev_candidate_1', oldDatabase: 'afldb_dev',
    });
    // A bare prefix with no stamp is still not a candidate name.
    expect(() => parseArgs(['--environment', 'dev', '--plan', '--database', 'afldb_dev_candidate_',
      '--old-database', 'afldb_dev', '--pre-cutover-dump', '/a', '--rebuilt-dump', '/b', '--plan-dir', 'o']))
      .toThrow(/only ever run on a candidate/);
    // The production candidate prefix is refused once dev is stated, and vice versa.
    expect(() => parseArgs(['--environment', 'dev', '--plan', '--database', `${CANDIDATE_PREFIX}1`,
      '--old-database', 'afldb_dev', '--pre-cutover-dump', '/a', '--rebuilt-dump', '/b', '--plan-dir', 'o']))
      .toThrow(/only ever run on a candidate/);
  });
});

/**
 * AFLDB-ISSUE-142 (B). A reinstated id-keyed row is only meaningful while the candidate
 * shares the replaced database's id lineage. On `afldb_dev` it does not: 34 of the 36
 * `player_link_resolutions` player ids exist in the rebuilt lineage and every one of them
 * names a DIFFERENT person (151 Craig Bradley vs Alan McGowan; 318 Gary O'Donnell vs Alex
 * Georgiou). The old dangling-reference probe reports "0 missing" for exactly those rows,
 * because it asks whether an id exists, not whether it still means the same thing.
 */
describe('lineage-safe reinstatement', () => {
  const PROFILE = 'afltables_profile_url';

  it('declares every lineage-bound column, including the Gridley source reference', () => {
    expect(lineageBoundTables().map((t) => t.name).sort())
      .toEqual(['data_edits', 'external_grid_sources', 'player_link_resolutions']);

    const resolutions = lineageTargetsOf(contractByName('player_link_resolutions')!);
    expect(resolutions.find((x) => x.ref.column === 'player_id')!.target)
      .toMatchObject({ entity: 'players', identity: PROFILE });
    // The seven honours tables target_id points into have NO stable external identity, and
    // saying so explicitly is the decision: the checker refuses instead of reinstating an id
    // that now names a different honours row.
    const targets = resolutions.filter((x) => x.ref.column === 'target_id');
    expect(targets).toHaveLength(7);
    for (const { ref, target } of targets) {
      expect(target.identity).toBe('none');
      expect(ref.kindColumn).toBe('target_table');
      expect(target.kind).toBe(target.entity);
    }

    const edits = lineageTargetsOf(contractByName('data_edits')!);
    expect(edits.map((x) => `${x.target.kind}:${x.target.identity}`).sort())
      .toEqual(['matches:match_key', 'players:afltables_profile_url']);
    const gridSource = contractByName('external_grid_sources')!;
    const gridTarget = stableLineageTargetForFootballRef(gridSource, 'ingest_source_id', 'sources');
    expect(gridTarget).toMatchObject({ entity: 'sources', identity: 'source_key' });
    const gridRefs = lineageTargetsOf(gridSource);
    expect(gridRefs).toHaveLength(1);
    for (const { ref } of [...resolutions, ...edits, ...gridRefs]) {
      expect(ref.remediation.length, ref.column).toBeGreaterThan(80);
    }
  });

  it('identifies rows by a stable external key only — never by a name', () => {
    for (const rule of ['afltables_profile_url', 'match_key', 'source_key'] as const) {
      const sql = `${LINEAGE_IDENTITY_SQL[rule].byId}\n${LINEAGE_IDENTITY_SQL[rule].byIdentity}`;
      expect(sql).not.toMatch(/display_name|search_name|given_name|surname|full_name/i);
      expect(sql).not.toMatch(/\bilike\b|similarity|levenshtein|soundex/i);
      // Both directions of the same identity, so a mapping can be proved round trip.
      expect(sql).toContain('$1::bigint[]');
      expect(sql).toContain('$1::text[]');
    }
    expect(LINEAGE_IDENTITY_SQL.afltables_profile_url.byId).toContain("s.key = 'afltables'");
    expect(LINEAGE_IDENTITY_SQL.afltables_profile_url.byId).toContain("match_method = 'afltables_profile_url'");
    expect(LINEAGE_IDENTITY_SQL.afltables_profile_url.byId).toContain("status IN ('unique', 'resolved')");
    expect(LINEAGE_IDENTITY_SQL.match_key.byId).toContain('match_key');
    expect(LINEAGE_IDENTITY_SQL.source_key.byId).toContain('key AS identity');
  });

  it('remaps Gridley preservation by source key when source and candidate ids differ', () => {
    const remap = resolveLineageRemap({
      entity: 'sources', rule: 'source_key', referencedIds: [41],
      replacedIdentities: [{ id: 41, identity: 'gridley' }],
      candidateIdentities: [{ id: 903, identity: 'gridley' }],
    });
    expect(remap.mapped).toEqual([{ oldId: 41, identity: 'gridley', newId: 903 }]);
    expect(remap.unchanged).toBe(0);
    const sql = lineageRemapSql({
      candidate: 'afldb_dev_candidate_x', oldDatabase: 'afldb_dev', environment: 'dev',
      plans: [{
        table: 'external_grid_sources', column: 'ingest_source_id', entity: 'sources',
        rule: 'source_key', remediation: 'resolve by source key',
        rows: [{ rowId: 5, oldValue: 41 }], remap,
      }],
    });
    expect(sql).toContain('UPDATE "public"."external_grid_sources" SET "ingest_source_id" = 903'
      + ' WHERE "id" = 5 AND "ingest_source_id" = 41;');
    expect(sql).toContain('--   41 -> gridley -> 903');
    expect(sql).not.toMatch(/\b(?:80|7)\b/);
  });

  it('remaps through the identity and never through the integer', () => {
    const remap = resolveLineageRemap({
      entity: 'players', rule: PROFILE,
      referencedIds: [151, 318, 4242, 999],
      replacedIdentities: [
        { id: 151, identity: 'players/B/Craig_Bradley.html' },
        { id: 318, identity: 'players/O/Gary_ODonnell.html' },
        { id: 4242, identity: 'players/W/Ward_Retired.html' },
        // 999 carries no identity at all in the replaced database.
      ],
      candidateIdentities: [
        { id: 907, identity: 'players/B/Craig_Bradley.html' },
        { id: 1188, identity: 'players/O/Gary_ODonnell.html' },
        // The same INTEGER exists in the candidate and is somebody else entirely.
        { id: 151, identity: 'players/M/Alan_McGowan.html' },
        { id: 318, identity: 'players/G/Alex_Georgiou.html' },
      ],
    });
    expect(remap.mapped).toEqual([
      { oldId: 151, identity: 'players/B/Craig_Bradley.html', newId: 907 },
      { oldId: 318, identity: 'players/O/Gary_ODonnell.html', newId: 1188 },
    ]);
    expect(remap.unchanged).toBe(0);
    // Reported in id order, the order the resolver walks the referenced ids in.
    expect(remap.unresolved).toEqual([
      { oldId: 999, reason: 'no_identity_in_replaced' },
      { oldId: 4242, reason: 'identity_absent_in_candidate', identity: 'players/W/Ward_Retired.html' },
    ]);
  });

  it('refuses an ambiguous identity in either database, and a column with no identity at all', () => {
    const ambiguousOld = resolveLineageRemap({
      entity: 'players', rule: PROFILE, referencedIds: [500],
      // A renumbered AFL Tables url leaves one player carrying two identities.
      replacedIdentities: [{ id: 500, identity: 'players/C/Charlie_Cameron.html' },
        { id: 500, identity: 'players/C/Charlie_Cameron3.html' }],
      candidateIdentities: [{ id: 2604, identity: 'players/C/Charlie_Cameron.html' },
        { id: 2608, identity: 'players/C/Charlie_Cameron3.html' }],
    });
    expect(ambiguousOld.mapped).toEqual([]);
    expect(ambiguousOld.unresolved).toEqual([{ oldId: 500, reason: 'ambiguous_in_replaced' }]);

    const ambiguousNew = resolveLineageRemap({
      entity: 'players', rule: PROFILE, referencedIds: [500],
      replacedIdentities: [{ id: 500, identity: 'players/J/Jack_Ross.html' }],
      candidateIdentities: [{ id: 11, identity: 'players/J/Jack_Ross.html' },
        { id: 12, identity: 'players/J/Jack_Ross.html' }],
    });
    expect(ambiguousNew.unresolved)
      .toEqual([{ oldId: 500, reason: 'ambiguous_in_candidate', identity: 'players/J/Jack_Ross.html' }]);

    const noRule = resolveLineageRemap({
      entity: 'award_winners', rule: 'none', referencedIds: [7, 9],
      replacedIdentities: [], candidateIdentities: [],
    });
    expect(noRule.mapped).toEqual([]);
    expect(noRule.unresolved).toEqual([
      { oldId: 7, reason: 'no_stable_identity_rule' },
      { oldId: 9, reason: 'no_stable_identity_rule' },
    ]);
  });

  it('surfaces a merge rather than hiding it, and counts an unchanged id', () => {
    const remap = resolveLineageRemap({
      entity: 'players', rule: PROFILE, referencedIds: [2604, 2608, 77],
      replacedIdentities: [
        { id: 2604, identity: 'players/C/Charlie_Cameron.html' },
        { id: 2608, identity: 'players/C/Charlie_Cameron3.html' },
        { id: 77, identity: 'players/S/Same_Id.html' },
      ],
      candidateIdentities: [
        { id: 500, identity: 'players/C/Charlie_Cameron.html' },
        { id: 500, identity: 'players/C/Charlie_Cameron3.html' },
        { id: 77, identity: 'players/S/Same_Id.html' },
      ],
    });
    expect(remap.merges).toEqual([{ newId: 500, oldIds: [2604, 2608] }]);
    expect(remap.unchanged).toBe(1);
  });

  it('treats a shared lineage as shared, and anything unproven as changed', () => {
    expect(detectLineageChange([
      { id: 1, replaced: 'players/A/A.html', candidate: 'players/A/A.html' },
      { id: 2, replaced: 'players/B/B.html', candidate: 'players/B/B.html' },
    ])).toMatchObject({ changed: false, agreed: 2, incomparable: 0 });

    const changed = detectLineageChange([
      { id: 151, replaced: 'players/B/Craig_Bradley.html', candidate: 'players/M/Alan_McGowan.html' },
      { id: 2, replaced: 'players/B/B.html', candidate: 'players/B/B.html' },
    ]);
    expect(changed.changed).toBe(true);
    expect(changed.differed).toEqual([
      { id: 151, replaced: 'players/B/Craig_Bradley.html', candidate: 'players/M/Alan_McGowan.html' },
    ]);

    // Nothing comparable proves nothing, so it is not "same lineage".
    expect(detectLineageChange([{ id: 1, replaced: 'x' }, { id: 2, candidate: 'y' }]))
      .toMatchObject({ changed: true, agreed: 0, incomparable: 2 });
    expect(detectLineageChange([]).changed).toBe(true);
  });

  it('writes only evidenced UPDATEs, comments every unresolved id, and touches nothing else', () => {
    const mapped = resolveLineageRemap({
      entity: 'players', rule: PROFILE, referencedIds: [151, 999],
      replacedIdentities: [{ id: 151, identity: 'players/B/Craig_Bradley.html' }],
      candidateIdentities: [{ id: 907, identity: 'players/B/Craig_Bradley.html' }],
    });
    // Under `prod` no historical-only disposition applies (AFLDB-ISSUE-143 declares them
    // for `dev` only), so this is the AFLDB-ISSUE-142 remap exactly as it always was.
    const sql = lineageRemapSql({
      candidate: 'afldb_prod_candidate_20260906', oldDatabase: 'afldb_prod', environment: 'prod',
      plans: [{
        table: 'player_link_resolutions', column: 'player_id', entity: 'players', rule: PROFILE,
        remediation: contractByName('player_link_resolutions')!.lineageRefs![0].remediation,
        rows: [{ rowId: 12, oldValue: 151 }, { rowId: 13, oldValue: 999 }],
        remap: mapped,
      }],
    });
    expect(sql).toContain('UPDATE "public"."player_link_resolutions" SET "player_id" = 907'
      + ' WHERE "id" = 12 AND "player_id" = 151;');
    expect(sql).toContain('--   151 -> players/B/Craig_Bradley.html -> 907');
    expect(sql).toContain('-- UNRESOLVED player_link_resolutions.player_id = 999 (no_identity_in_replaced)');
    expect(sql).toContain('row(s) 13');
    // One column per statement, and no other kind of write anywhere in the file.
    for (const stmt of sql.split('\n').filter((l) => l.startsWith('UPDATE '))) {
      expect(stmt.match(/ SET /g)).toHaveLength(1);
      expect(stmt).not.toContain(',');
    }
    expect(sql).not.toMatch(/\b(DELETE|INSERT|TRUNCATE|ALTER|DROP)\b/);
    // Re-running is a no-op, and the verification query is the proof of ownership.
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('NOT IN (SELECT id FROM (VALUES (907,');
  });

  it('emits nothing for an id that already points at the right row', () => {
    const remap = resolveLineageRemap({
      entity: 'matches', rule: 'match_key', referencedIds: [17042],
      replacedIdentities: [{ id: 17042, identity: '2026|23|2026-08-14|fremantle|adelaide' }],
      candidateIdentities: [{ id: 17042, identity: '2026|23|2026-08-14|fremantle|adelaide' }],
    });
    const sql = lineageRemapSql({
      candidate: 'c', oldDatabase: 'o',
      plans: [{
        table: 'data_edits', column: 'row_id', kindColumn: 'table_name', kind: 'matches',
        entity: 'matches', rule: 'match_key', remediation: 'x',
        rows: [{ rowId: 3, oldValue: 17042 }], remap,
      }],
    });
    expect(sql.split('\n').filter((l) => l.startsWith('UPDATE'))).toHaveLength(0);
    expect(sql).toContain('Every referenced id was evidenced');
  });
});

/**
 * AFLDB-ISSUE-143. §7.4c of docs/production-promotion.md documents two answers for a
 * lineage-bound row that cannot be evidenced; until this issue the checker and the plan
 * could execute neither, so a DEV promotion could never pass `--phase restored`.
 *
 * The executable answer is (2): the table is truncated in the candidate, given no
 * `pg_restore` line, expected to read 0 rows, named in the audit marker, and retained in
 * full in the pre-cutover dump and the kept pre-rebuild database. What these tests hold it
 * to is that it is a DECLARATION and not a switch — one contract entry drives the gate, the
 * plan and the comparison together, and everything it does not name still refuses.
 */
describe('historical-only / recorded-gap disposition', () => {
  const PROFILE = 'afltables_profile_url';
  const withheldOnDev = ['data_edits', 'player_link_resolutions'];

  const synthetic = (over: Partial<TableTreatment>): TableTreatment => ({
    schema: 'public', name: 't', subsystem: 's', category: 'operations',
    productionOnly: true, treatment: 'reinstate', compare: 'equal', order: 20,
    lineageRefs: [{
      column: 'row_id', targets: [{ entity: 'players', identity: PROFILE }], remediation: 'x',
    }],
    note: 'n', ...over,
  });
  const declaration = (over: Partial<NonNullable<TableTreatment['historicalOnly']>> = {}) => ({
    environments: ['dev'] as const, columns: ['row_id'], decidedBy: 'd', summary: 's', reason: 'r', ...over,
  });

  it('the real contract is coherent, and declares nothing for production', () => {
    expect(() => assertContractCoherent()).not.toThrow();
    expect(historicalOnlyTables('prod')).toEqual([]);
    expect(historicalOnlyTables('dev').map((e) => e.table.name).sort()).toEqual(withheldOnDev);
    for (const { table, disposition } of historicalOnlyTables('dev')) {
      expect(disposition.environments, table.name).toEqual(['dev']);
      // Exhaustive by construction: every lineage-bound column is named, so adding one
      // re-opens the decision instead of inheriting it.
      expect([...disposition.columns].sort(), table.name)
        .toEqual(table.lineageRefs!.map((r) => r.column).sort());
      expect(disposition.decidedBy, table.name).toContain('AFLDB-ISSUE-139');
      expect(disposition.reason.length, table.name).toBeGreaterThan(200);
    }
  });

  it('refuses a declaration that is partial, misplaced or unbacked', () => {
    expect(historicalOnlyProblems(synthetic({ historicalOnly: declaration() }))).toEqual([]);
    // A table with two lineage columns and only one named: the other could never be remapped.
    const twoColumns = synthetic({
      lineageRefs: [
        { column: 'a', targets: [{ entity: 'players', identity: PROFILE }], remediation: 'x' },
        { column: 'b', targets: [{ entity: 'players', identity: PROFILE }], remediation: 'x' },
      ],
      historicalOnly: declaration({ columns: ['a'] }),
    });
    expect(historicalOnlyProblems(twoColumns).join(' ')).toContain('does not name its lineage-bound column(s) b');

    expect(historicalOnlyProblems(synthetic({ historicalOnly: declaration({ columns: ['row_id', 'nope'] }) })).join(' '))
      .toContain('names column(s) nope, which are not lineage-bound');
    expect(historicalOnlyProblems(synthetic({ lineageRefs: undefined, historicalOnly: declaration({ columns: [] }) })).join(' '))
      .toContain('declares no lineage-bound column');
    expect(historicalOnlyProblems(synthetic({ treatment: 'reset', historicalOnly: declaration() })).join(' '))
      .toContain("has treatment 'reset'");
    expect(historicalOnlyProblems(synthetic({ historicalOnly: declaration({ environments: [] as never }) })).join(' '))
      .toContain('for no environment');
    expect(historicalOnlyProblems(synthetic({ historicalOnly: declaration({ environments: ['staging'] as never }) })).join(' '))
      .toContain("unknown environment 'staging'");
    for (const field of ['decidedBy', 'summary', 'reason'] as const) {
      expect(historicalOnlyProblems(synthetic({ historicalOnly: declaration({ [field]: '  ' }) })).join(' '), field)
        .toContain(`has an empty ${field}`);
    }
  });

  it('accepts unresolved rows ONLY for the exact declared table, column and environment', () => {
    // The measured AFLDB-ISSUE-139 Phase 4C′ shape, to the row.
    const dev = judgeLineage({
      environment: 'dev',
      columns: [
        { table: 'player_link_resolutions', column: 'player_id', unresolved: 3 },
        { table: 'player_link_resolutions', column: 'target_id', unresolved: 94 },
        { table: 'data_edits', column: 'row_id', unresolved: 15 },
      ],
    });
    expect(dev.verdict).toBe('WARN');
    expect(dev.refused).toEqual([]);
    expect(dev.acceptedTotal).toBe(112);
    expect(dev.accepted.map((a) => `${a.table}.${a.column}`))
      .toEqual(['player_link_resolutions.player_id', 'player_link_resolutions.target_id', 'data_edits.row_id']);
    for (const a of dev.accepted) expect(a.decidedBy).toContain('AFLDB-ISSUE-139');

    // The SAME rows, under the production contract: refused, exactly as before this issue.
    const prod = judgeLineage({
      environment: 'prod',
      columns: [
        { table: 'player_link_resolutions', column: 'target_id', unresolved: 94 },
        { table: 'data_edits', column: 'row_id', unresolved: 15 },
      ],
    });
    expect(prod.verdict).toBe('FAIL');
    expect(prod.accepted).toEqual([]);
    expect(prod.refusedTotal).toBe(109);
  });

  it('still refuses another table, another column, and a column that resolved anyway', () => {
    const mixed = judgeLineage({
      environment: 'dev',
      columns: [
        { table: 'player_link_resolutions', column: 'target_id', unresolved: 94 },
        // A column of a DECLARED table that the declaration does not name.
        { table: 'player_link_resolutions', column: 'some_future_column', unresolved: 1 },
        // An undeclared table, and one that is not in the contract at all.
        { table: 'nl_search_review', column: 'search_id', unresolved: 2 },
        { table: 'not_in_the_contract', column: 'x', unresolved: 5 },
      ],
    });
    expect(mixed.verdict).toBe('FAIL');
    expect(mixed.refused.map((r) => `${r.table}.${r.column}`))
      .toEqual(['player_link_resolutions.some_future_column', 'nl_search_review.search_id', 'not_in_the_contract.x']);
    expect(mixed.refusedTotal).toBe(8);
    expect(mixed.acceptedTotal).toBe(94);

    // Nothing unresolved is nothing to judge, and a clean lineage change is still a WARN.
    expect(judgeLineage({ environment: 'dev', columns: [
      { table: 'data_edits', column: 'row_id', unresolved: 0 },
    ] })).toMatchObject({ verdict: 'WARN', accepted: [], refused: [] });

    expect(isHistoricalOnlyColumn('player_link_resolutions', 'target_id', 'dev')).toBe(true);
    expect(isHistoricalOnlyColumn('player_link_resolutions', 'target_id', 'prod')).toBe(false);
    expect(isHistoricalOnlyColumn('player_link_resolutions', 'other', 'dev')).toBe(false);
    expect(isHistoricalOnlyColumn('data_submissions', 'import_batch_id', 'dev')).toBe(false);
  });

  it('production and the default are unchanged in every derived view', () => {
    expect(reinstatedPublicTables()).toEqual(reinstatedPublicTables('prod'));
    for (const name of withheldOnDev) {
      const table = contractByName(name)!;
      expect(reinstatedPublicTables('prod'), name).toContain(name);
      expect(historicalOnlyFor(table, 'prod'), name).toBeUndefined();
      expect(effectiveTreatment(table, 'prod'), name).toBe('reinstate');
      expect(effectiveCompare(table, 'prod'), name).toBe('equal');
      expect(tablesWithTreatment('reinstate', 'prod'), name).toContain(name);
      // …and withheld on DEV, in all four views at once.
      expect(reinstatedPublicTables('dev'), name).not.toContain(name);
      expect(effectiveTreatment(table, 'dev'), name).toBe('reset');
      expect(effectiveCompare(table, 'dev'), name).toBe('zero');
      expect(tablesWithTreatment('reinstate', 'dev'), name).not.toContain(name);
      expect(tablesWithTreatment('reset', 'dev'), name).not.toContain(name);
      // Still truncated: the candidate keeps none of the rebuilt copy either, which is what
      // makes `compare: zero` true and what stops test-state rows surviving the promotion.
      expect(truncatedPublicTables(), name).toContain(name);
      expect(truncateSql(), name).toContain(`"public"."${name}"`);
    }
    const base = { oldDatabase: 'afldb_prod', preCutoverDump: '/backups/pre.dump', rebuiltDump: '/backups/rebuilt.dump' };
    const prodPlan = reinstatePlan({ ...base, candidate: 'afldb_prod_candidate_x' });
    expect(prodPlan).not.toContain('HISTORICAL-ONLY');
    expect(prodPlan).toContain('--table=player_link_resolutions');
    expect(prodPlan).toContain('--table=data_edits');
    expect(resyncIdentitySql('prod')).toBe(resyncIdentitySql());
    expect(auditMarkerSql({ candidate: 'c', oldDatabase: 'o', preCutoverDump: 'p', rebuiltDump: 'r' }))
      .toContain("'historical_only', to_jsonb(ARRAY[]::text[])");
  });

  it('the DEV plan visibly omits the withheld tables and generates no write for their rows', () => {
    const dev = reinstatePlan({
      candidate: 'afldb_dev_candidate_x', oldDatabase: 'afldb_dev',
      preCutoverDump: '/backups/pre.dump', rebuiltDump: '/backups/rebuilt.dump', environment: 'dev',
    });
    expect(dev).toContain('INTENTIONALLY NOT REINSTATED (AFLDB-ISSUE-143 historical-only / recorded gap)');
    for (const name of withheldOnDev) {
      expect(dev, name).toContain(`public.${name} — AFLDB-ISSUE-139`);
      // No restore line, and no write of any kind naming the table outside the comments.
      expect(dev, name).not.toContain(`--table=${name}`);
      for (const line of dev.split('\n').filter((l) => !l.trimStart().startsWith('#'))) {
        expect(line, `${name}: ${line}`).not.toMatch(new RegExp(`\\b(INSERT|UPDATE|DELETE)\\b.*${name}`));
      }
    }
    // The reader is told where the rows went, and that the candidate must read empty.
    expect(dev).toContain('/backups/pre.dump');
    expect(dev).toContain('afldb_dev_pre_rebuild_<stamp>');
    expect(dev).toContain('expects 0 rows');
    expect(dev).toContain('Nothing is deleted');
    // Every other reinstated table is untouched, in the same order.
    expect([...dev.matchAll(/--exit-on-error --table=([a-z_]+)/g)].map((m) => m[1])).toEqual(reinstatedPublicTables('dev'));
    expect(reinstatedPublicTables('dev').length).toBe(reinstatedPublicTables('prod').length - 2);
  });

  it('the DEV audit marker records the gap, the table and the deciding issue', () => {
    const sql = auditMarkerSql({
      candidate: 'afldb_dev_candidate_x', oldDatabase: 'afldb_dev',
      preCutoverDump: 'p', rebuiltDump: 'r', environment: 'dev',
    });
    for (const name of withheldOnDev) {
      expect(sql, name).toContain(`${name} (AFLDB-ISSUE-139`);
      expect(sql, name).toContain(`${name}: NOT reinstated on a DEV promotion`);
    }
    expect(sql).toContain("'historical_only', to_jsonb(ARRAY[");
    // And they are no longer claimed as reinstated.
    expect(sql).toMatch(/'reinstated', to_jsonb\(ARRAY\[[^\]]*\]\)/);
    const reinstated = sql.match(/'reinstated', to_jsonb\(ARRAY\[([^\]]*)\]\)/)![1];
    for (const name of withheldOnDev) expect(reinstated, name).not.toContain(`'${name}'`);
  });

  it('the remap file writes no statement for a withheld column, and still remaps the rest', () => {
    const unresolvable = resolveLineageRemap({
      entity: 'award_winners', rule: 'none', referencedIds: [7, 9],
      replacedIdentities: [], candidateIdentities: [],
    });
    const evidenced = resolveLineageRemap({
      entity: 'import_batches', rule: PROFILE, referencedIds: [151],
      replacedIdentities: [{ id: 151, identity: 'players/B/Craig_Bradley.html' }],
      candidateIdentities: [{ id: 907, identity: 'players/B/Craig_Bradley.html' }],
    });
    const sql = lineageRemapSql({
      candidate: 'afldb_dev_candidate_x', oldDatabase: 'afldb_dev', environment: 'dev',
      plans: [
        {
          table: 'player_link_resolutions', column: 'target_id', kindColumn: 'target_table',
          kind: 'award_winners', entity: 'award_winners', rule: 'none',
          remediation: 'unused here', rows: [{ rowId: 1, oldValue: 7 }, { rowId: 2, oldValue: 9 }],
          remap: unresolvable,
        },
        // An undeclared table under the same environment: the AFLDB-ISSUE-142 path, intact.
        {
          table: 'data_submissions', column: 'import_batch_id', entity: 'import_batches', rule: PROFILE,
          remediation: 'unused here', rows: [{ rowId: 5, oldValue: 151 }], remap: evidenced,
        },
      ],
    });
    expect(sql).toContain('-- HISTORICAL-ONLY (AFLDB-ISSUE-143) under --environment dev:');
    expect(sql).toContain('NONE of them reinstated, so NONE of them remapped.');
    expect(sql).toContain('afldb_dev_pre_rebuild_<stamp>');
    expect(sql).not.toMatch(/player_link_resolutions.*\bUPDATE\b|UPDATE[^\n]*player_link_resolutions/);
    expect(sql).not.toContain('-- UNRESOLVED player_link_resolutions');
    // The stable row still takes the existing remap path, guarded by the value it was proved
    // against, and the verification query covers it and only it.
    expect(sql).toContain('UPDATE "public"."data_submissions" SET "import_batch_id" = 907'
      + ' WHERE "id" = 5 AND "import_batch_id" = 151;');
    expect(sql).toContain('SELECT t."id", t."import_batch_id" FROM "public"."data_submissions" t');
    expect(sql).not.toContain('SELECT t."id", t."target_id"');
    expect(sql).toContain('Every referenced id was evidenced');
    expect(sql).toContain('1 column(s) are HISTORICAL-ONLY by contract');
    expect(sql).not.toMatch(/\b(DELETE|INSERT|TRUNCATE|ALTER|DROP)\b/);
  });

  it('fails closed if a historical-only table ever receives a generated remap write', () => {
    const remap = resolveLineageRemap({
      entity: 'award_winners', rule: 'none', referencedIds: [17],
      replacedIdentities: [], candidateIdentities: [],
    });
    const plans = [{
      table: 'player_link_resolutions', column: 'target_id', kindColumn: 'target_table',
      kind: 'award_winners', entity: 'award_winners', rule: 'none' as const,
      remediation: 'not reinstated', rows: [{ rowId: 4, oldValue: 17 }], remap,
    }];
    const valid = lineageRemapSql({
      candidate: 'afldb_dev_candidate_x', oldDatabase: 'afldb_dev', environment: 'dev', plans,
    });
    expect(lineageRemapProblems(valid, plans, 'dev')).toEqual([]);
    const unsafe = valid.replace('COMMIT;', 'UPDATE "public"."player_link_resolutions" SET "target_id" = 99;\nCOMMIT;');
    expect(lineageRemapProblems(unsafe, plans, 'dev'))
      .toEqual(['historical-only table player_link_resolutions receives a generated remap write']);
  });

  it('introduces no name matching and no generic override flag', () => {
    const inventory = readFileSync(join(REPO, 'tools', 'db', 'promotion-inventory.ts'), 'utf8');
    const checker = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    for (const source of [inventory, checker]) {
      expect(source).not.toMatch(/\bilike\b|similarity|levenshtein|soundex/i);
      expect(source).not.toMatch(/display_name|search_name|full_name/i);
    }
    // The disposition is reachable only from the contract: no command-line flag, and no
    // environment-blind acceptance.
    expect(checker).not.toMatch(/--allow-unresolved|--ignore-lineage|--force/);
    expect(checker).toContain('judgeLineage');
    // Acceptance is decided per (table, column, environment) — never per verdict.
    const gate = checker.slice(checker.indexOf('async function gateLineageIdentity'),
                              checker.indexOf('async function gateFingerprint'));
    expect(gate).toMatch(/unresolvedTotal === 0 \? 'WARN' : 'FAIL'/);
    expect(gate).toContain('const unresolvedTotal = judgement.refusedTotal;');
    expect(gate).toContain('historicalOnlyFor(t, environment)');
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
    // The only files it writes are the counts snapshot, the operator plan and the
    // AFLDB-ISSUE-142 lineage remap — all read and run by hand, none of them a database write.
    expect((source.match(/writeFileSync\(/g) ?? []).length).toBe(3);
  });

  it('never prints a DSN: the target line names the variable and the database only', () => {
    expect(source).toMatch(/via \$\{opts\.dsnEnv\}/);
    expect(source).not.toMatch(/console\.log\([^)]*\bdsn\b/);
  });
});

/**
 * AFLDB-ISSUE-141. The two gates that differ on DEV are database-bound, so their behaviour
 * is pinned here from the source text — the same technique this file already uses to prove
 * the checker carries no write path. What must hold: the refusal is still the default, the
 * relaxation is reachable only from the explicit flag, and accepting fixtures makes the
 * checker print MORE, never less.
 */
describe('the DEV relaxations are explicit, and never silent', () => {
  const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');

  it('keeps the fixture refusal as the default and only WARNs behind the flag', () => {
    const gate = source.slice(source.indexOf('async function gateFixtureIdentities'),
                              source.indexOf('async function gateSuperAdmin'));
    // Still a refusal in the phases that require absence...
    expect(gate).toMatch(/mustBeAbsent[\s\S]*'Test-fixture identities', 'FAIL'/);
    // ...and the only way past it is the flag, checked together with mustBeAbsent.
    expect(gate).toMatch(/mustBeAbsent && allowAccepted/);
    expect(gate).toContain('CONSCIOUSLY ACCEPTED');
    expect(gate).toContain("'WARN'");
    // Accepting prints every row: the ten-row sample cap is lifted, never widened silently.
    expect(gate).toMatch(/const sampleLimit = allowAccepted \? '' : ' LIMIT 10'/);
    expect(gate).toContain('${sampleLimit}');
    expect(gate).not.toMatch(/ORDER BY email LIMIT 10/);
  });

  it('makes the super-admin expectation optional on DEV only when it was not asked for', () => {
    const gate = source.slice(source.indexOf('async function gateSuperAdmin'),
                              source.indexOf('async function gateInventory'));
    expect(gate).toMatch(/const enforced = required && \(environment === 'prod' \|\| expected !== undefined\)/);
    // The unenforced path still says so out loud rather than dropping the check.
    expect(gate).toContain('NOT enforced under --environment dev');
    expect(gate).toContain("warn = true");
  });

  // AFLDB-ISSUE-142 (B). The lineage gate must ask a different question from the dangling
  // probe, must fail closed, and must never reach for a name.
  it('proves lineage from identities, refuses what it cannot evidence, and never matches a name', () => {
    const gate = source.slice(source.indexOf('async function gateLineageIdentity'),
                              source.indexOf('async function gateFingerprint'));
    expect(gate).toContain('detectLineageChange');
    expect(gate).toContain('resolveLineageRemap');
    // Same lineage passes and generates nothing; a change refuses unless every id is evidenced.
    expect(gate).toMatch(/if \(!verdict\.changed\)[\s\S]*'PASS'/);
    expect(gate).toMatch(/unresolvedTotal === 0 \? 'WARN' : 'FAIL'/);
    // Identity SQL is the contract's, asked of both databases by identical logic.
    expect(gate).not.toMatch(/display_name|search_name|ilike/i);
    expect(gate).toContain('LINEAGE_IDENTITY_SQL');
    // A remap nobody could read by hand is a refusal, not a file.
    expect(gate).toContain('LINEAGE_ROW_CAP');
  });

  it('never infers the environment from a database name', () => {
    // The only writers of Options.environment are the explicit flag and the default.
    expect(source).toMatch(/case '--environment'/);
    expect((source.match(/out\.environment = /g) ?? []).length).toBe(1);
    expect(source).toContain('environment: DEFAULT_ENVIRONMENT');
    expect(source).not.toMatch(/startsWith\('afldb_dev/);
    expect(source).not.toMatch(/=== 'afldb_dev'/);
    // And the DEV-only flag is refused before any early return.
    expect(source).toMatch(/allowFixtureIdentities && out\.environment !== 'dev'/);
  });
});

describe('acceptance checklist', () => {
  it('covers the mandatory gates', () => {
    const text = ACCEPTANCE_CHECKLIST.join('\n');
    for (const needle of ['hostname', 'backup.sh', 'sha256', 'restore-test.sh', '--phase source', '--phase pre-cutover',
      'candidate', '--phase restored', '--phase candidate', '--phase production', 'privileges.sql', 'super admin',
      'TOTP', 'data_overrides', 'settle', 'Rollback', 'afldb_prod_pre_rebuild_', 'afldb-prod', 'streamanator',
      'lineage', 'player_link_resolutions.player_id', 'data_edits.row_id']) {
      expect(text, needle).toContain(needle);
    }
  });
});
