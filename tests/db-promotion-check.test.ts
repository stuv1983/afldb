/**
 * AFLDB-ISSUE-125 — the production promotion contract and its read-only checker.
 *
 * DB-free. The contract (tools/db/promotion-inventory.ts) is pinned against the migration
 * files, so a migration that creates a table forces a decision here; the checker's
 * argument and database-name rules are pinned so no phase can be pointed at the wrong
 * database; and the checker's source is asserted to carry no write path.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  judgeStagedSourceRows,
  judgeStagingLeftover,
  type TableTreatment,
  DERIVED_FOOTBALL_TABLES,
  EMAIL_BEARING_TABLES,
  ENVIRONMENTS,
  LINEAGE_IDENTITY_SQL,
  PHASES,
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
  rowIdColumnOf,
  swapSql,
  STAGING_SCHEMA,
  STAGE_COMPLETION_FUNCTION,
  STAGE_COMPLETION_TABLE,
  isStagedLineageColumn,
  isStagedReinstatement,
  plannedReinstateOrder,
  promoteStagedSql,
  reinstateGroups,
  stableLineageTargetForFootballRef,
  stageSql,
  stageCompletionTriggerSql,
  stageEvidenceMissingMessage,
  stagedCopyRedirect,
  stagedLineageColumns,
  stagedMayBeEmpty,
  stagedMayBeEmptyProblems,
  stagedPlanProblems,
  stagedReinstateTables,
  stagedReinstatementProblems,
  tablesWithTreatment,
  truncateSql,
  truncatedPublicTables,
  withDatabase,
  decodeMatchCoachKey,
  lineageRemapBindingGuard,
  matchKeysOfOverrides,
  planPromotionMatchReplay,
  planPromotionPlayersReplay,
  playerIdentityKeysOfOverrides,
  promotionPlayerCheckProblems,
  applyManualIdentityConvergence,
  convergencePathsToRead,
  manualIdentityConvergenceSql,
  planManualIdentityConvergence,
  type ManualIdentityConvergenceEntry,
  type PromotionIdentityRow,
  type PromotionOverrideRow,
  type PromotionPlayerCheckRow,
  type Snapshot,
} from '../tools/db/promotion-inventory';
import {
  AFL_API_LEDGER_ROWS_SQL, DATABASE_COMMENT_SQL, Report, aflApiDevRegenerationProposal, aflApiG2Entries, aflApiSupersedeFileFor,
  evaluateAflApiG2, gateAflApiCandidateAfterReinstate, gateAflApiG1, gateAflApiOverlap, gateAflApiRebuildMarker,
  PROMOTION_REPLAY_IDENTITIES_SQL, PROMOTION_REPLAY_MATCH_KEYS_SQL, PROMOTION_REPLAY_MAX_SEASON_SQL,
  PROMOTION_REPLAY_OVERRIDES_SQL, PROMOTION_REPLAY_PLAYER_CHECKS_SQL, gateOverrideReplayTargets, publishRestoredLineageRemap,
  PROMOTION_CONVERGENCE_TARGET_IDENTITIES_SQL,
  publishRestoredAflApiFiles, readRebuildMarkerPresent, writeOperatorFileAtomically, type AflApiOverlapResult, type Query,
  DEFAULT_DSN_ENV, READ_ONLY_SQL, parseArgs, readAflApiForwardIdentities as readPromotionForwardIdentities,
  readAflApiReverseIdentities as readPromotionReverseIdentities, writePlan,
  FIRST_KICK_GOAL_GATE, FIRST_KICK_GOAL_IDENTITIES_SQL, gateFirstKickGoalIdentities, judgeFirstKickGoalIdentities,
  type FirstKickGoalObserved,
} from '../tools/db/promotion-check';
import { trackedExpectedIds } from '../tools/records/first-kick-goal-source';
import {
  AflApiReplayAbort, readAflApiForwardIdentities as readRebuildForwardIdentities, replayAflApiAdjudicationsFromSupersedeFile,
  resolveAflApiPlayerIdentity,
} from '../tools/migration/replay_afl_api_adjudications';
import { loadFitzroyProfileContinuityRules } from '../src/lib/acquisition/fitzroy-profile-continuity';
import { readManualPlayerToken } from '../src/db/queries/player-identity';
import { registrationsFromLive, type LiveRegistrationState } from '../tools/migration/rebuild_manual_registrations';
import type { TransactionSql } from 'postgres';
import {
  CONVERGENCE_REHEARSAL,
  ConvergenceRehearsalRefused,
  parseConvergenceRehearsalArgs,
  rehearsalPath,
  rehearsalToken,
  scaleWorld,
  worldNamespaceProblems,
} from '../tools/db/promotion-convergence-rehearsal';
import {
  AFL_API_ADMIN_MATCH_METHOD,
  AFL_API_G2_REFUSING_OUTCOMES,
  AFL_API_REBUILD_MARKER_FORMAT,
  AflApiPromotionFileRefused,
  aflApiDevRegenerationBindingProblems,
  aflApiDevRegenerationEntriesFromG3,
  aflApiLedgerStateSha256,
  aflApiSupersedeBindingProblems,
  buildAflApiSupersedeFile,
  classifyAflApiG3,
  parseAflApiDevRegenerationClassification,
  parseAflApiSupersedeFile,
  validateAflApiDevRegenerationClassification,
  type AflApiCensusRow,
  aflApiG2AgreeSet,
  checkAflApiAdjudicationBijection,
  classifyAflApiG2,
  planAflApiAdjudicationReplay,
  type AflApiAdjudicationLedgerRow,
  type AflApiContinuityContradiction,
  type AflApiCandidateIdentityRow,
  type AflApiPlayerRemapResult,
} from '../src/lib/acquisition/afl-api-adjudication';

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
  'brownlow_season_votes', 'captaincies', 'club_aliases', 'club_leadership',
  'club_organization_relations',
  'club_organizations', 'club_seasons', 'coaches',
  'clubs', 'data_issues', 'derived_rebuilds', 'draft_persons', 'draft_picks', 'external_identities',
  'father_son_selections', 'fixtures',
  'hall_of_fame', 'honour_team_members', 'import_batches', 'import_rejections',
  'match_coaches', 'match_period_scores', 'matches', 'player_achievements', 'player_birth_evidence',
  'player_career_stats', 'player_height_evidence',
  'player_club_season_stats', 'player_clubs', 'player_match_stats',
  'player_name_aliases', 'player_relationships', 'player_season_stats', 'players', 'promotion_candidates',
  'season_list_members',
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
    stage: stageSql(environment),
    promoteStaged: promoteStagedSql(environment),
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
    // 080 external_grid_sources.ingest_source_id and external_grids.import_batch_id,
    // 094 brownlow_vote_entry_state.{match_id,three_player_id,two_player_id,one_player_id}.
    const refs = PROMOTION_CONTRACT.flatMap((t) => (t.footballRefs ?? []).map((r) => `${t.name}.${r.column}->${r.references}`)).sort();
    expect(refs).toEqual([
      'afl_api_identity_adjudications.player_id->players',
      'brownlow_vote_entry_state.match_id->matches',
      'brownlow_vote_entry_state.one_player_id->players',
      'brownlow_vote_entry_state.three_player_id->players',
      'brownlow_vote_entry_state.two_player_id->players',
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
    // AFLDB-ISSUE-151: the staged tables have no plain restore line; every other reinstated
    // table does, in the plan's order (direct, then the staged tables' dependants).
    const groups = reinstateGroups();
    expect(publicTables).toEqual([...groups.direct, ...groups.dependants]);
    expect([...publicTables, ...groups.staged].sort()).toEqual([...reinstatedPublicTables()].sort());
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
    // …plus one single-transaction load per staged table (AFLDB-ISSUE-151).
    expect((plan.match(/--single-transaction/g) ?? []).length)
      .toBe(publicTables.length + schemaTables.length + groups.staged.length);
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
    // AFLDB-ISSUE-151: external_grid_sources is STAGED, never plainly restored into public;
    // its two dependants are restored only after the promotion, in FK order.
    expect(tables).not.toContain('external_grid_sources');
    expect(tables).toContain('external_grids');
    expect(tables).toContain('external_grid_axes');
    expect(tables.indexOf('external_grid_axes')).toBeGreaterThan(tables.indexOf('external_grids'));
    const promote = plan.indexOf('-f promotion-promote-staged.sql');
    expect(promote).toBeGreaterThan(0);
    expect(plan.indexOf('--exit-on-error --table=external_grids ')).toBeGreaterThan(promote);
    expect(plan.indexOf('--table=external_grid_sources -f - ')).toBeLessThan(promote);
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
    // tables AFLDB-ISSUE-143 withholds there, which the dev list itself accounts for, and the
    // staged tables (AFLDB-ISSUE-151), which have no plain restore line in either environment.
    const devGroups = reinstateGroups('dev');
    expect([...dev.matchAll(/--exit-on-error --table=([a-z_]+)/g)].map((m) => m[1]))
      .toEqual([...devGroups.direct, ...devGroups.dependants]);
    expect(devGroups.staged).toEqual(reinstateGroups('prod').staged);
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
        'promotion-truncate.sql', 'promotion-stage.sql', 'promotion-promote-staged.sql',
        'promotion-resync-identity.sql', 'promotion-audit-marker.sql', 'promotion-reinstate.sh',
        'promotion-swap.sql', 'promotion-rollback.sql',
      ]);
      expect(readFileSync(join(dir, 'promotion-swap.sql'), 'utf8'))
        .toContain('RENAME TO "afldb_dev_pre_rebuild_20260906-112500"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses every plan destination before writing any partial plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-promotion-plan-'));
    const sentinel = join(dir, 'promotion-rollback.sql');
    try {
      writeFileSync(sentinel, 'operator-owned sentinel\n', 'utf8');
      expect(() => writePlan({
        environment: 'dev', plan: true, checklist: false, allowFixtureIdentities: false,
        dsnEnv: 'AFLDB_OWNER_DATABASE_URL', database: 'afldb_dev_candidate_20260906-112500',
        oldDatabase: 'afldb_dev', preCutoverDump: '/home/arm/example.dump',
        rebuiltDump: '/home/arm/rebuilt.dump', planDir: dir,
      })).toThrow(/refusing to write a partial plan/);
      expect(readdirSync(dir)).toEqual(['promotion-rollback.sql']);
      expect(readFileSync(sentinel, 'utf8')).toBe('operator-owned sentinel\n');
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

  it('AFLDB-ISSUE-237 §6.3 — dev-regeneration-census is DEV-only and inspects the live DEV database', () => {
    expect(() => assertDatabaseForPhase('dev-regeneration-census', 'afldb_dev', 'dev')).not.toThrow();
    expect(() => assertDatabaseForPhase('dev-regeneration-census', 'afldb_dev', 'prod'))
      .toThrow(/DEV-only/);
    expect(() => assertDatabaseForPhase('dev-regeneration-census', 'afldb_prod', 'dev'))
      .toThrow(PromotionRefused);
    expect(PHASES).toContain('dev-regeneration-census');
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

  it('AFLDB-ISSUE-237 — scopes --afl-api-dev-regeneration and --afl-api-supersede-out', () => {
    // --afl-api-dev-regeneration needs --environment dev, in any phase.
    expect(() => parseArgs(['--phase', 'restored', '--database', `${CANDIDATE_PREFIX}1`,
      '--old-database', 'afldb_prod', '--afl-api-dev-regeneration', 'c.json']))
      .toThrow(/DEV-only regeneration classification/);
    // ...and only at --phase restored or --phase dev-regeneration-census.
    const devCandidatePrefix = environmentNames('dev').candidatePrefix;
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'candidate', '--database', `${devCandidatePrefix}1`,
      '--afl-api-dev-regeneration', 'c.json']))
      .toThrow(/only meaningful with --phase restored or --phase dev-regeneration-census/);
    expect(parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', `${devCandidatePrefix}1`,
      '--old-database', 'afldb_dev', '--afl-api-dev-regeneration', 'c.json']).aflApiDevRegeneration)
      .toBe('c.json');
    // dev-regeneration-census REQUIRES the classification file.
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'dev-regeneration-census', '--database', 'afldb_dev']))
      .toThrow(/needs --afl-api-dev-regeneration/);
    expect(parseArgs(['--environment', 'dev', '--phase', 'dev-regeneration-census', '--database', 'afldb_dev',
      '--afl-api-dev-regeneration', 'c.json']).aflApiDevRegeneration).toBe('c.json');

    // --afl-api-supersede-out is restored-only.
    expect(() => parseArgs(['--phase', 'candidate', '--database', `${CANDIDATE_PREFIX}1`,
      '--afl-api-supersede-out', 'e.json']))
      .toThrow(/only meaningful with --phase restored/);
    expect(parseArgs(['--phase', 'restored', '--database', `${CANDIDATE_PREFIX}1`,
      '--old-database', 'afldb_prod', '--afl-api-supersede-out', 'e.json']).aflApiSupersedeOut)
      .toBe('e.json');
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
    // AFLDB-ISSUE-155: brownlow_vote_entry_state joins the list. Migration 094's workflow rows
    // carry four references into rebuilt data — three nullable player slots and match_id, which
    // is also the table's primary key — and a rebuild reassigns every one of those ids.
    expect(lineageBoundTables().map((t) => t.name).sort())
      .toEqual([
        'afl_api_identity_adjudications', 'brownlow_vote_entry_state', 'data_edits',
        'external_grid_sources', 'player_link_resolutions',
      ]);

    const resolutions = lineageTargetsOf(contractByName('player_link_resolutions')!);
    expect(resolutions.find((x) => x.ref.column === 'player_id')!.target)
      .toMatchObject({ entity: 'players', identity: PROFILE });
    // SIX of the seven tables target_id points into have NO stable external identity, and
    // saying so explicitly is the decision: the checker refuses instead of reinstating an id
    // that now names a different honours row.
    //
    // AFLDB-ISSUE-167 §11.3 corrected the seventh. player_achievements was classified 'none'
    // with the rest, and had been wrong since the AFLDB-ISSUE-078 rekey: every row carries a
    // tracked, COMMITTED 'fkg-NNN' from data/records/first-kick-goal-ids.csv, which is an
    // external key for one of its rows and is evidenced in the repository rather than only in
    // the database. Understating that is not the safe direction — it is what makes a stale
    // target_id look unresolvable when it could have been resolved, and it left a real
    // promotion hazard classified as an accepted one.
    const targets = resolutions.filter((x) => x.ref.column === 'target_id');
    expect(targets).toHaveLength(7);
    for (const { ref, target } of targets) {
      expect(ref.kindColumn).toBe('target_table');
      expect(target.kind).toBe(target.entity);
    }
    expect(targets.map((x) => `${x.target.kind}:${x.target.identity}`).sort())
      .toEqual([
        'award_nominations:none', 'award_winners:none', 'captaincies:none',
        'draft_picks:none', 'hall_of_fame:none', 'honour_team_members:none',
        'player_achievements:first_kick_goal_key',
      ]);
    // And the correction does NOT reopen AFLDB-ISSUE-139 D1: the table is still withheld from a
    // DEV promotion, because six of its seven targets still cannot be evidenced.
    expect(isHistoricalOnlyColumn('player_link_resolutions', 'target_id', 'dev')).toBe(true);

    const edits = lineageTargetsOf(contractByName('data_edits')!);
    expect(edits.map((x) => `${x.target.kind}:${x.target.identity}`).sort())
      .toEqual([
        // AFLDB-ISSUE-167 §11.2: migration 102 admits both special-record tables into
        // data_edits_table_name_check, and each is given its lineage target in the SAME
        // change — the first time that obligation has been discharged at the point it was
        // created rather than found by a later issue.
        'after_siren_kicks:after_siren_key',
        'award_winners:award_winner_key',
        'club_leadership:appointment_key',
        'coaches:afltables_coach_path', 'draft_picks:draft_pick_key',
        'fixtures:fixture_key',
        'hall_of_fame:hall_of_fame_key',
        'honour_team_members:honour_team_key',
        'matches:match_key',
        'player_achievements:first_kick_goal_key',
        'players:afltables_profile_url',
      ]);
    // AFLDB-ISSUE-160 D-3. 'draft_picks' had been admitted by
    // data_edits_table_name_check since migration 057 with NO lineage target, so a
    // draft audit row was reinstated with its integer row_id unchanged and was never
    // counted, listed or remapped -- on a lineage-changing promotion that integer names
    // a different selection. The target makes the gate remap it or stop.
    const draftTarget = edits.find((x) => x.target.kind === 'draft_picks')!;
    expect(draftTarget.target).toMatchObject({
      kind: 'draft_picks', entity: 'draft_picks', identity: 'draft_pick_key',
    });
    expect(draftTarget.ref.column).toBe('row_id');
    expect(draftTarget.ref.kindColumn).toBe('table_name');
    // AFLDB-ISSUE-159 §5.6. Migration 095 admits 'coaches' into
    // data_edits.table_name, which obliges a lineage target for it: coaches is
    // rebuilt on promotion, so the swap renumbers every coach id a human edit
    // names. 'match_coaches' is deliberately NOT admitted and therefore needs no
    // target -- a coaching-assignment edit is audited against its match.
    const coachTarget = edits.find((x) => x.target.kind === 'coaches')!;
    expect(coachTarget.target).toMatchObject({
      kind: 'coaches', entity: 'coaches', identity: 'afltables_coach_path',
    });
    expect(coachTarget.ref.column).toBe('row_id');
    expect(coachTarget.ref.kindColumn).toBe('table_name');
    expect(edits.some((x) => x.target.kind === 'match_coaches')).toBe(false);
    // AFLDB-ISSUE-162 §20/§24. Migration 097 admits 'fixtures' into
    // data_edits.table_name, which obliges a lineage target for the same
    // reason: fixtures is an import-writable registry table, so the swap
    // renumbers every fixture id a human edit names. Unlike a season-list
    // membership — which is DELETABLE and is therefore audited against its
    // player instead — a fixture is NEVER deleted (cancelled and void keep the
    // row) and the override replay re-creates every one of them in the
    // candidate before this remap runs, so every fixture audit row resolves.
    const fixtureTarget = edits.find((x) => x.target.kind === 'fixtures')!;
    expect(fixtureTarget.target).toMatchObject({
      kind: 'fixtures', entity: 'fixtures', identity: 'fixture_key',
    });
    expect(fixtureTarget.ref.column).toBe('row_id');
    expect(fixtureTarget.ref.kindColumn).toBe('table_name');
    // AFLDB-ISSUE-163 §19. Migration 098 admits 'club_leadership' into
    // data_edits.table_name, which obliges a lineage target for the same
    // reason once more: club_leadership is an import-writable registry table,
    // so the swap renumbers every appointment id a human edit names. An
    // appointment is never deleted (ended and void keep the row) and the
    // override replay re-creates every one of them in the candidate before
    // this remap runs, so every leadership audit row resolves.
    const leadershipTarget = edits.find((x) => x.target.kind === 'club_leadership')!;
    expect(leadershipTarget.target).toMatchObject({
      kind: 'club_leadership', entity: 'club_leadership', identity: 'appointment_key',
    });
    expect(leadershipTarget.ref.column).toBe('row_id');
    expect(leadershipTarget.ref.kindColumn).toBe('table_name');
    // AFLDB-ISSUE-165 §8. Migration 058 admitted all three honours tables into
    // data_edits.table_name and for seven migrations NONE of them had a lineage
    // target — the AFLDB-ISSUE-160 D-3 defect again, and with a wider blast
    // radius, because /admin/data-editor has been creating rows in all three
    // since AFLDB-ISSUE-080. All three are import-writable tables that a
    // promotion rebuilds, so an honours audit row was reinstated with its
    // integer row_id unchanged and would name a different award, inductee or
    // selection after a lineage change.
    for (const [kind, identity] of [
      ['award_winners', 'award_winner_key'],
      ['hall_of_fame', 'hall_of_fame_key'],
      ['honour_team_members', 'honour_team_key'],
    ] as const) {
      const target = edits.find((x) => x.target.kind === kind)!;
      expect(target.target).toMatchObject({ kind, entity: kind, identity });
      expect(target.ref.column).toBe('row_id');
      expect(target.ref.kindColumn).toBe('table_name');
    }
    // award_nominations and captaincies are deliberately NOT here: neither is
    // admitted by data_edits_table_name_check, so neither needs a target, and
    // adding one would assert an audit path that does not exist.
    expect(edits.some((x) => x.target.kind === 'award_nominations')).toBe(false);
    expect(edits.some((x) => x.target.kind === 'captaincies')).toBe(false);
    expect(edits.some((x) => x.target.kind === 'season_list_members')).toBe(false);
    expect(edits.every((x) => x.target.identity !== 'none')).toBe(true);
    // The three new identity rules must be executable, not merely declared: a
    // target naming a rule with no SQL would pass the shape check above and
    // then fail at remap time, on the night of a promotion.
    for (const rule of ['award_winner_key', 'hall_of_fame_key', 'honour_team_key'] as const) {
      expect(LINEAGE_IDENTITY_SQL[rule].byId).toContain('$1::bigint[]');
      expect(LINEAGE_IDENTITY_SQL[rule].byIdentity).toContain('$1::text[]');
      // Never a name match. An honours row that cannot be identified is
      // reported unresolved; it is never attached to the closest display name,
      // which is the AFLDB-ISSUE-025 defect migration 059 exists to prevent.
      expect(LINEAGE_IDENTITY_SQL[rule].byId).not.toMatch(/ILIKE|display_name|similarity/i);
    }
    const gridSource = contractByName('external_grid_sources')!;
    const gridTarget = stableLineageTargetForFootballRef(gridSource, 'ingest_source_id', 'sources');
    expect(gridTarget).toMatchObject({ entity: 'sources', identity: 'source_key' });
    const gridRefs = lineageTargetsOf(gridSource);
    expect(gridRefs).toHaveLength(1);

    // AFLDB-ISSUE-155. Declaration order is the remap order, and it is load-bearing: every plan
    // on this table is anchored by match_id (the table's own primary key — rowIdColumn), so the
    // player slots must be remapped while match_id still holds its pre-cutover value. match_id
    // settles last and is self-anchored.
    const brownlow = contractByName('brownlow_vote_entry_state')!;
    const brownlowRefs = lineageTargetsOf(brownlow);
    expect(brownlowRefs.map((x) => `${x.ref.column}->${x.target.entity}:${x.target.identity}`)).toEqual([
      'three_player_id->players:afltables_profile_url',
      'two_player_id->players:afltables_profile_url',
      'one_player_id->players:afltables_profile_url',
      'match_id->matches:match_key',
    ]);
    expect(stableLineageTargetForFootballRef(brownlow, 'match_id', 'matches'))
      .toMatchObject({ entity: 'matches', identity: 'match_key' });
    // The row anchor is declared only where the surrogate default is wrong; everywhere else the
    // generic machinery keeps identifying a row by `id`.
    expect(rowIdColumnOf(brownlow)).toBe('match_id');
    for (const t of PROMOTION_CONTRACT) {
      if (t.name !== 'brownlow_vote_entry_state') expect(rowIdColumnOf(t), t.name).toBe('id');
    }

    for (const { ref } of [...resolutions, ...edits, ...gridRefs, ...brownlowRefs]) {
      expect(ref.remediation.length, ref.column).toBeGreaterThan(80);
    }
  });

  /**
   * THE STANDING CONTRACT (AFLDB-ISSUE-165 §8).
   *
   * Admitting a table into `data_edits_table_name_check` creates audit rows
   * whose `row_id` is an integer in THAT table — and says nothing about whether
   * the integer still names the same row after a promotion. Four times now the
   * two have been allowed to come apart silently: `draft_picks` (migration 057,
   * found by AFLDB-ISSUE-160 D-3) and `award_winners`, `hall_of_fame` and
   * `honour_team_members` (migration 058, found here). Each time the audit rows
   * were reinstated with their old integers, counted by nothing, and named a
   * different row on the other side.
   *
   * So the allowlist is read from the migrations and compared against the
   * declared targets, and a table may be absent from the targets ONLY by
   * appearing in the exemption register below with a reason. Adding a table to
   * the CHECK now forces the decision at review time rather than on the night
   * of a promotion.
   */
  it('gives every admitted data_edits.table_name a lineage target or a recorded exemption', () => {
    // The LAST definition wins: every widening restates the whole list.
    let admitted: string[] = [];
    for (const file of migrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const m of sql.matchAll(
        /data_edits_table_name_check CHECK \(table_name IN \(([\s\S]*?)\)\)/g,
      )) {
        admitted = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      }
    }
    expect(admitted.length).toBeGreaterThan(0);
    expect(admitted).toContain('award_winners');

    /**
     * Admitted names that legitimately need NO lineage target, each with the
     * reason. An entry here is a decision on the record, not a way to make the
     * check pass.
     */
    const EXEMPT: Record<string, string> = {
      // The audit subject is a SEASON YEAR, not a surrogate id: seasons.year is
      // a permanent natural identity that no rebuild and no promotion
      // renumbers, so there is nothing to remap.
      brownlow_season_authority:
        'row_id is a season year — a permanent natural identity, never renumbered',
      // RECORDED GAP, not a clean exemption. brownlow_vote_entry_state's
      // primary key IS match_id (migration 094), so a row_id here is a match id
      // and a lineage change DOES renumber it. The table's own lineageRefs
      // remap its columns; its data_edits rows are not covered. Raised by
      // AFLDB-ISSUE-165's preflight and belongs to the Brownlow admin domain
      // (AFLDB-ISSUE-155), not to this issue — recorded here so it cannot be
      // forgotten or silently inherited.
      brownlow_vote_entry_state:
        'RECORDED GAP (AFLDB-ISSUE-165 preflight): row_id is a match id and IS renumbered by a '
        + 'lineage change; needs a matches/match_key target, owned by the Brownlow admin domain',
    };

    const targeted = new Set(
      lineageTargetsOf(contractByName('data_edits')!).map((x) => x.target.kind),
    );
    for (const table of admitted) {
      if (targeted.has(table)) continue;
      expect(
        Object.keys(EXEMPT),
        `data_edits admits '${table}' with no lineage target and no recorded exemption`,
      ).toContain(table);
      expect(EXEMPT[table].length).toBeGreaterThan(40);
    }
    // And nothing is targeted that the CHECK does not admit: a target for an
    // unadmitted table describes an audit path that cannot exist.
    for (const table of targeted) expect(admitted).toContain(table);
  });

  it('identifies rows by a stable external key only — never by a name', () => {
    for (const rule of [
      'afltables_profile_url', 'match_key', 'source_key', 'afltables_coach_path',
      'draft_pick_key', 'fixture_key',
    ] as const) {
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

    // AFLDB-ISSUE-159. The coach identity is the PATH, on a column that is NOT
    // NULL UNIQUE since migration 087 and is minted once and never edited, so it
    // denotes the same person on both databases. coaches.name_key is a name, and
    // the exclusion above must keep catching it if anyone ever swaps them.
    const coach = LINEAGE_IDENTITY_SQL.afltables_coach_path;
    expect(coach.entity).toBe('coaches');
    expect(coach.byId).toContain('afltables_coach_path AS identity');
    expect(coach.byIdentity).toContain('afltables_coach_path = ANY ($1::text[])');
    expect(`${coach.byId}\n${coach.byIdentity}`).not.toContain('name_key');
    // It resolves an admin-created coach exactly as it resolves a sourced one:
    // no namespace is special-cased, because 'manual:<token>' IS the identity.
    expect(`${coach.byId}\n${coach.byIdentity}`).not.toMatch(/manual|LIKE/i);
    expect(coach.description).toContain('manual:<token>');

    // AFLDB-ISSUE-160. The players rule admits a SECOND identity namespace -- the
    // manual token an admin-created player is minted with -- without ever admitting a
    // name. DISTINCT ON with the AFL Tables path ordered first keeps one player to one
    // identity, so a player known by token on the replaced side and by path in the
    // candidate still resolves.
    const players = LINEAGE_IDENTITY_SQL.afltables_profile_url;
    expect(players.byId).toContain("s.key = 'manual_admin_edit'");
    expect(players.byId).toContain("match_method = 'manual_admin_edit'");
    expect(players.byId).toContain('DISTINCT ON (ei.player_id)');
    expect(players.byIdentity).toContain('DISTINCT ON (ei.player_id)');
    expect(players.byId).toContain("ORDER BY ei.player_id, (s.key <> 'afltables')");
    expect(players.byIdentity).toContain("ORDER BY ei.player_id, (s.key <> 'afltables')");

    // AFLDB-ISSUE-160 D-3. The draft key is the SOURCE KEY, never the per-database
    // sources.id -- the id is renumbered by a rebuild and would silently rename every
    // selection. A selection with no source_id has no key at all and is absent from
    // both directions, so it reports unresolved instead of being carried by an integer.
    const draft = LINEAGE_IDENTITY_SQL.draft_pick_key;
    expect(draft.entity).toBe('draft_picks');
    expect(draft.byId).toContain("s.key || '|' || dp.player_url");
    expect(draft.byIdentity).toContain("s.key || '|' || dp.player_url");
    expect(`${draft.byId}\n${draft.byIdentity}`).not.toMatch(/player_name_raw|club_name_raw/);
    expect(`${draft.byId}\n${draft.byIdentity}`).toContain('JOIN public.sources s ON s.id = dp.source_id');
    expect(draft.description).toContain('manual:<token>');

    // AFLDB-ISSUE-162 D-6 and the operator constraint of 2026-09-11. A fixture
    // resolves through the UUID token it was minted with and never through a
    // match_key: `fixtures` carries no match_key and no match_id column at all,
    // because "played" is a read-time resolution rather than a stored link.
    // The column is NOT NULL and a fixture is never deleted, so a cancelled or
    // void row resolves exactly as a scheduled one does.
    const fixture = LINEAGE_IDENTITY_SQL.fixture_key;
    expect(fixture.entity).toBe('fixtures');
    expect(fixture.byId).toContain('fixture_key AS identity');
    expect(fixture.byIdentity).toContain('fixture_key = ANY ($1::text[])');
    const fixtureSql = `${fixture.byId}\n${fixture.byIdentity}`;
    expect(fixtureSql).not.toContain('match_key');
    expect(fixtureSql).not.toContain('match_id');
    expect(fixtureSql).not.toMatch(/round_code|match_date|venue|club/i);

    // AFLDB-ISSUE-163 §5. An appointment resolves through the UUID token it
    // was minted with, never through (club, season, player, role): that tuple
    // recurs when a player is re-appointed later in the same season, and every
    // other candidate component is a fact an administrator may correct. The
    // column is NOT NULL and an appointment is never deleted, so an ended or
    // void row resolves exactly as an active one does.
    const appointment = LINEAGE_IDENTITY_SQL.appointment_key;
    expect(appointment.entity).toBe('club_leadership');
    expect(appointment.byId).toContain('appointment_key AS identity');
    expect(appointment.byIdentity).toContain('appointment_key = ANY ($1::text[])');
    const appointmentSql = `${appointment.byId}\n${appointment.byIdentity}`;
    // (The table's own name contains "club", so the exclusion names the FACTS a
    // natural key would have been built from, not that substring.)
    expect(appointmentSql).not.toMatch(/display_name|player_name|\bseason\b|\brole\b|club_id/i);
  });

  it('AFLDB-ISSUE-160 D-3: draft selections remap by identity, and a NULL-source row refuses', () => {
    // Source-owned and manual selections both resolve; the pre-ISSUE-160 admin row,
    // which carries no key on either side, is 'no_identity_in_replaced' -- reported,
    // never dropped and never carried by its old integer.
    const remap = resolveLineageRemap({
      entity: 'draft_picks',
      rule: 'draft_pick_key',
      referencedIds: [10, 11, 12],
      replacedIdentities: [
        { id: 10, identity: 'draftguru|https://www.draftguru.com.au/players/a-player/1|2019|national' },
        { id: 11, identity: 'manual_admin_edit|manual:0f1c2d3e-4a5b-6c7d-8e9f-001122334455|2024|rookie' },
      ],
      candidateIdentities: [
        { id: 900, identity: 'draftguru|https://www.draftguru.com.au/players/a-player/1|2019|national' },
        { id: 901, identity: 'manual_admin_edit|manual:0f1c2d3e-4a5b-6c7d-8e9f-001122334455|2024|rookie' },
      ],
    });
    expect(remap.mapped).toEqual([
      {
        oldId: 10, newId: 900,
        identity: 'draftguru|https://www.draftguru.com.au/players/a-player/1|2019|national',
      },
      {
        oldId: 11, newId: 901,
        identity: 'manual_admin_edit|manual:0f1c2d3e-4a5b-6c7d-8e9f-001122334455|2024|rookie',
      },
    ]);
    expect(remap.unresolved).toEqual([{ oldId: 12, reason: 'no_identity_in_replaced' }]);
    expect(remap.merges).toEqual([]);
  });

  it('AFLDB-ISSUE-160: a manual player resolves by token, and by path once it is attached', () => {
    // The token-only player (never debuted) and the path+token player (debuted, the
    // identity attached by 6.5 and bound onto the candidate by the §8.1 replay) both
    // map to exactly one candidate row, and neither is ambiguous despite holding two
    // identity rows -- that is what DISTINCT ON with the path ordered first buys.
    const remap = resolveLineageRemap({
      entity: 'players',
      rule: 'afltables_profile_url',
      referencedIds: [4, 5],
      replacedIdentities: [
        { id: 4, identity: 'aa11bb22-cc33-dd44-ee55-ff6677889900' },
        { id: 5, identity: 'players/S/Some_Player0.html' },
      ],
      candidateIdentities: [
        { id: 7004, identity: 'aa11bb22-cc33-dd44-ee55-ff6677889900' },
        { id: 7005, identity: 'players/S/Some_Player0.html' },
      ],
    });
    expect(remap.unresolved).toEqual([]);
    expect(remap.mapped.map((m) => `${m.oldId}->${m.newId}`)).toEqual(['4->7004', '5->7005']);
  });

  it('AFLDB-ISSUE-160 W-16: the draft target leaves the DEV historical-only declaration coherent', () => {
    // data_edits is historical-only on DEV and names row_id. The new target is a third
    // KIND on that same column, not a new column, so the disposition still names every
    // lineage-bound column -- and assertContractCoherent() is the thing that says so.
    const edits = contractByName('data_edits')!;
    expect(edits.historicalOnly!.columns).toEqual(['row_id']);
    expect([...new Set(lineageTargetsOf(edits).map((x) => x.ref.column))]).toEqual(['row_id']);
    expect(() => assertContractCoherent()).not.toThrow();
    expect(promotionContractProblems()).toEqual([]);
  });

  it('AFLDB-ISSUE-159 S-4: the coach target leaves the DEV historical-only declaration coherent', () => {
    // The refusal this guards against: historicalOnlyProblems() requires a
    // withheld table's disposition to name EVERY lineage-bound COLUMN of that
    // table. The coach target is a third target on the EXISTING row_id column,
    // not a new column, so the DEV declaration still names all of them.
    const edits = contractByName('data_edits')!;
    expect(edits.historicalOnly!.environments).toEqual(['dev']);
    expect(edits.historicalOnly!.columns).toEqual(['row_id']);
    expect([...new Set((edits.lineageRefs ?? []).map((r) => r.column))]).toEqual(['row_id']);
    expect(historicalOnlyProblems(edits)).toEqual([]);
    expect(() => assertContractCoherent()).not.toThrow();

    // And §5.6: coaches / match_coaches get NO PROMOTION_CONTRACT entry. Both are
    // already registered in afldb_meta.import_writable_tables (087:114-115), so
    // they are rebuilt data; declaring them here as well would classify them
    // {kind:'both'}, which is a refusal.
    // AFLDB-ISSUE-161 §19 / W-8 is the same shape: season_list_members is
    // registered by migration 096's grant_import_write, so it is rebuilt data
    // and must have NO PROMOTION_CONTRACT entry. An unclassified table refuses
    // every promotion phase (R-3) and a doubly-classified one is {kind:'both'},
    // which also refuses — so this assertion and its presence in
    // PINNED_FOOTBALL_TABLES above are the two halves of the classification.
    // AFLDB-ISSUE-162 §20 / R-1 is the same shape again: fixtures is registered
    // by migration 097's grant_import_write, so it is rebuilt data and must
    // have NO PROMOTION_CONTRACT entry.
    // AFLDB-ISSUE-163 §19 / R-20 is the same shape once more: club_leadership
    // is registered by migration 098's grant_import_write, so it is rebuilt
    // data and must have NO PROMOTION_CONTRACT entry.
    for (const name of [
      'coaches', 'match_coaches', 'season_list_members', 'fixtures', 'club_leadership',
    ]) {
      expect(contractByName(name), name).toBeUndefined();
    }
    // The acceptance checklist names every new entity type in the replay step.
    const checklist = ACCEPTANCE_CHECKLIST.join('\n');
    expect(checklist).toContain('coaches');
    expect(checklist).toContain('match_coaches');
    expect(checklist).toContain('season_list_members');
    expect(checklist).toContain('fixtures');
    expect(checklist).toContain('club_leadership');
  });

  it('AFLDB-ISSUE-167 §11: both special-record families are rebuilt data, and the '
    + 'checklist names BOTH replay adapters', () => {
    // Same shape once more, and §11.4 withdrew the planning premise that said
    // otherwise: player_achievements (053:152) and after_siren_kicks (089) were
    // each registered in afldb_meta.import_writable_tables on the day they were
    // created, so both are rebuilt data and must have NO PROMOTION_CONTRACT
    // entry. A doubly-classified table is {kind:'both'}, which refuses.
    for (const name of ['player_achievements', 'after_siren_kicks']) {
      expect(contractByName(name), name).toBeUndefined();
    }
    expect(() => assertContractCoherent()).not.toThrow();

    // Migration 102 widened data_overrides.entity_type with both, so the replay
    // step has TWO MORE entity types -- and, uniquely so far, two adapters
    // (D-3): after_siren_kicks replays in Python with the rest, and
    // player_achievements replays through the TypeScript adapter, because its
    // importer is TypeScript. An operator who runs only the Python loop
    // republishes every voided first-kick goal and loses every manual one, so
    // the checklist has to name the second adapter by file, not just the entity.
    const checklist = ACCEPTANCE_CHECKLIST.join('\n');
    expect(checklist).toContain('player_achievements');
    expect(checklist).toContain('after_siren_kicks');
    expect(checklist).toContain('tools/records/special-records-replay.ts');
    // And the ordering that makes their data_edits rows resolvable at all.
    expect(checklist).toContain('first_kick_goal_key');
    expect(checklist).toContain('after_siren_key');
    expect(checklist).toMatch(/BEFORE the data_edits row_id remap/);
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
    // AFLDB-ISSUE-151: the column is NOT NULL against an immediate FK, so the UPDATE lands
    // in the staging copy the plan restores the table into — never in public, where the
    // rows are not yet (and where the old integer could never have been inserted).
    expect(sql).toContain('UPDATE "promotion_staging"."external_grid_sources" SET "ingest_source_id" = 903'
      + ' WHERE "id" = 5 AND "ingest_source_id" = 41;');
    expect(sql).not.toContain('UPDATE "public"."external_grid_sources"');
    expect(sql).toContain('STAGED (AFLDB-ISSUE-151)');
    expect(sql).toContain('--   41 -> gridley -> 903');
    expect(sql).toContain('FROM "promotion_staging"."external_grid_sources" t');
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
 * AFLDB-ISSUE-235 (OD-3, R8). `afl_api_identity_adjudications` is durable identity
 * authority: unlike `player_link_resolutions`, it is reinstated in EVERY environment (no
 * DEV historical-only carve-out), because every row's `player_identity` is captured at
 * write time from a stable identity — there is no six-of-seven-unkeyed problem to fall
 * back on. C1/C2/C3/C2b, §10.1.
 */
describe('AFLDB-ISSUE-235: afl_api_identity_adjudications', () => {
  const PROFILE = 'afltables_profile_url';
  const table = contractByName('afl_api_identity_adjudications');

  it('C1 — is classified, so the contract-coverage check names no unclassified table for it', () => {
    expect(table).toBeDefined();
    expect(publicContractTables().map((t) => t.name)).toContain('afl_api_identity_adjudications');
    expect(migrationPublicTables().has('afl_api_identity_adjudications')).toBe(true);
  });

  it('C2 — declares its lineage ref on player_id, through the existing afltables_profile_url rule', () => {
    const refs = lineageTargetsOf(table!);
    expect(refs).toHaveLength(1);
    expect(refs[0].ref.column).toBe('player_id');
    expect(refs[0].target).toMatchObject({ entity: 'players', identity: PROFILE });
    expect(refs[0].ref.remediation.length).toBeGreaterThan(80);
  });

  it('C2b (R8) — reuses the existing identity rule (no new LineageIdentityRule) and carries the stored-identity assertion hook', () => {
    // "No new identity kind": the ref's rule is exactly the one player_link_resolutions
    // already uses, and LINEAGE_IDENTITY_SQL gains no new key for this table.
    const refs = lineageTargetsOf(table!);
    expect(refs[0].target.identity).toBe(PROFILE);
    expect(Object.keys(LINEAGE_IDENTITY_SQL)).not.toContain('afl_api_identity');
    expect(table!.lineageRefs![0].storedIdentityColumn).toBe('player_identity');

    // The post-remap assertion: a row whose freshly re-derived identity agrees with its
    // own stored player_identity remaps normally...
    const agreeing = resolveLineageRemap({
      entity: 'players', rule: PROFILE, referencedIds: [151],
      replacedIdentities: [{ id: 151, identity: 'players/B/Craig_Bradley.html' }],
      candidateIdentities: [{ id: 907, identity: 'players/B/Craig_Bradley.html' }],
    });
    const agreeingSql = lineageRemapSql({
      candidate: 'afldb_prod_candidate_x', oldDatabase: 'afldb_prod', environment: 'prod',
      plans: [{
        table: 'afl_api_identity_adjudications', column: 'player_id', entity: 'players', rule: PROFILE,
        remediation: table!.lineageRefs![0].remediation,
        rows: [{ rowId: 5, oldValue: 151 }],
        remap: agreeing,
        storedIdentities: new Map([[5, 'players/B/Craig_Bradley.html']]),
      }],
    });
    // Staged (AFLDB-ISSUE-151), same as brownlow_vote_entry_state: player_id is a NOT NULL
    // reference into players (rebuilt), so the table restores into promotion_staging first.
    expect(agreeingSql).toContain('UPDATE "promotion_staging"."afl_api_identity_adjudications" SET "player_id" = 907'
      + ' WHERE "id" = 5 AND "player_id" = 151;');
    expect(agreeingSql).not.toContain('STORED IDENTITY MISMATCH');

    // ...but a row whose re-derived identity DISAGREES with its own stored value is refused
    // outright, never silently remapped and never silently dropped — a resolvable-but-wrong
    // identity is exactly as dangerous as an unresolved one (D15).
    const mismatched = resolveLineageRemap({
      entity: 'players', rule: PROFILE, referencedIds: [151],
      replacedIdentities: [{ id: 151, identity: 'players/B/Craig_Bradley.html' }],
      candidateIdentities: [{ id: 907, identity: 'players/B/Craig_Bradley.html' }],
    });
    const mismatchedSql = lineageRemapSql({
      candidate: 'afldb_prod_candidate_x', oldDatabase: 'afldb_prod', environment: 'prod',
      plans: [{
        table: 'afl_api_identity_adjudications', column: 'player_id', entity: 'players', rule: PROFILE,
        remediation: table!.lineageRefs![0].remediation,
        rows: [{ rowId: 5, oldValue: 151 }],
        remap: mismatched,
        // A different stored identity than what the lineage rule re-derives for id 151 —
        // e.g. the player's afltables identity changed between the adjudication and the
        // promotion. The row must never remap on the strength of the id chain alone.
        storedIdentities: new Map([[5, 'players/O/Someone_Else.html']]),
      }],
    });
    expect(mismatchedSql).not.toMatch(/UPDATE\s+"[a-z_]+"\."afl_api_identity_adjudications"/);
    expect(mismatchedSql).toContain(
      '-- STORED IDENTITY MISMATCH afl_api_identity_adjudications.player_id row 5: '
      + 'id 151 re-derives as players/B/Craig_Bradley.html, but the row\'s own stored identity is '
      + 'players/O/Someone_Else.html — refusing to remap this row (AFLDB-ISSUE-235 OD-3)',
    );
    expect(mismatchedSql).not.toContain('Every referenced id was evidenced');
  });

  it('C3 (OD-3) — is reinstated in every environment; no historicalOnly disposition, unlike player_link_resolutions', () => {
    expect(table!.historicalOnly).toBeUndefined();
    for (const environment of ENVIRONMENTS) {
      expect(historicalOnlyFor(table!, environment), environment).toBeUndefined();
    }
    expect(table!.treatment).toBe('reinstate');
    expect(table!.productionOnly).toBe(true);
  });

  it('C4 (OD-3, R3) — the replay planner covers every row of the D15 decision table; every disagreement is a STOP, never a skip or an overwrite', () => {
    const IDENTITY = 'players/A/Alpha_Able.html';
    const linked = (id: number, externalId: string, playerIdentity = IDENTITY): AflApiAdjudicationLedgerRow => ({
      id, externalId, action: 'linked', playerId: 1, playerIdentity, supersedesId: null,
    });
    const human = (externalId: string, playerId: number): AflApiCandidateIdentityRow => ({
      externalId, status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId,
    });
    const importer = (externalId: string, playerId: number): AflApiCandidateIdentityRow => ({
      externalId, status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerId,
    });
    const remapTo = (newPlayerId: number, remappedIdentity = IDENTITY): AflApiPlayerRemapResult => (
      { ok: true, newPlayerId, remappedIdentity });
    const plan = (input: {
      ledgerRows: AflApiAdjudicationLedgerRow[];
      remap: Array<[string, AflApiPlayerRemapResult]>;
      candidates?: AflApiCandidateIdentityRow[];
    }) => planAflApiAdjudicationReplay({
      ledgerRows: input.ledgerRows,
      remapByExternalId: new Map(input.remap),
      candidateByExternalId: new Map((input.candidates ?? []).map((c) => [c.externalId, c])),
      candidatePlayerAflApiRow: new Map((input.candidates ?? [])
        .filter((c) => c.playerId !== null).map((c) => [c.playerId!, c])),
    });

    // A net-linked entry: one INSERT, under the REMAPPED player.
    expect(plan({ ledgerRows: [linked(1, 'CD_I1')], remap: [['CD_I1', remapTo(907)]] }))
      .toEqual({ inserts: [{ externalId: 'CD_I1', playerId: 907 }], noops: [], stops: [], supersedes: [] });
    // A revoked entry (net state is the latest row): nothing, not even a remap is needed.
    expect(plan({
      ledgerRows: [linked(1, 'CD_I1'), { ...linked(2, 'CD_I1'), action: 'revoked', supersedesId: 1 }],
      remap: [],
    })).toEqual({ inserts: [], noops: [], stops: [], supersedes: [] });
    // linked -> revoked -> linked is net-linked again.
    expect(plan({
      ledgerRows: [linked(1, 'CD_I1'), { ...linked(2, 'CD_I1'), action: 'revoked', supersedesId: 1 }, linked(3, 'CD_I1')],
      remap: [['CD_I1', remapTo(907)]],
    }).inserts).toEqual([{ externalId: 'CD_I1', playerId: 907 }]);
    // The identical human row already present: an idempotent no-op.
    expect(plan({ ledgerRows: [linked(1, 'CD_I1')], remap: [['CD_I1', remapTo(907)]], candidates: [human('CD_I1', 907)] }))
      .toEqual({ inserts: [], noops: [{ externalId: 'CD_I1' }], stops: [], supersedes: [] });

    const stopsOf = (input: Parameters<typeof plan>[0]) => {
      const result = plan(input);
      expect(result.inserts).toEqual([]);
      expect(result.noops).toEqual([]);
      return result.stops;
    };
    // An importer row for the CD_I naming another player, or the SAME player (not the identical
    // human row), or a human row for another player: each a STOP.
    for (const candidate of [importer('CD_I1', 555), importer('CD_I1', 907), human('CD_I1', 555)]) {
      expect(stopsOf({ ledgerRows: [linked(1, 'CD_I1')], remap: [['CD_I1', remapTo(907)]], candidates: [candidate] }))
        .toEqual([{ externalId: 'CD_I1', reason: 'a conflicting external_identities row already exists for this provider id' }]);
    }
    // The remapped player already holds another afl_api row (OD-1).
    expect(stopsOf({ ledgerRows: [linked(1, 'CD_I1')], remap: [['CD_I1', remapTo(907)]], candidates: [importer('CD_I2', 907)] }))
      .toEqual([{ externalId: 'CD_I1', reason: 'player 907 already holds a different afl_api provider (CD_I2)' }]);
    // An unresolvable or ambiguous identity (and a row with no remap at all).
    expect(stopsOf({ ledgerRows: [linked(1, 'CD_I1')], remap: [['CD_I1', { ok: false, reason: 'unresolvable' }]] }))
      .toEqual([{ externalId: 'CD_I1', reason: 'the ledger row\'s player_identity does not resolve to any candidate player' }]);
    expect(stopsOf({ ledgerRows: [linked(1, 'CD_I1')], remap: [['CD_I1', { ok: false, reason: 'ambiguous' }]] }))
      .toEqual([{ externalId: 'CD_I1', reason: 'the ledger row\'s player_identity resolves to more than one candidate player' }]);
    expect(stopsOf({ ledgerRows: [linked(1, 'CD_I1')], remap: [] }))
      .toEqual([{ externalId: 'CD_I1', reason: 'the ledger row\'s player_identity does not resolve to any candidate player' }]);
    // A remap whose identity differs from the stored player_identity. UNREACHABLE through the
    // live adapter -- resolveAflApiPlayerIdentity() looks the player up BY the stored identity
    // and returns that same string -- so it is pinned here, DB-free, and never made reachable
    // by weakening the planner (settle-afl-api.test.ts I15 records why it has no live case).
    expect(stopsOf({ ledgerRows: [linked(1, 'CD_I1')], remap: [['CD_I1', remapTo(907, 'players/O/Someone_Else.html')]] }))
      .toEqual([{ externalId: 'CD_I1', reason: 'the remapped player\'s identity does not equal the ledger row\'s stored player_identity' }]);

    // A stop is reported per provider and never hides another decision: the adapter throws on
    // ANY stop, so nothing in `inserts` is ever written alongside one (asserted live by I15).
    const mixed = plan({
      ledgerRows: [linked(1, 'CD_I1'), linked(2, 'CD_I2')],
      remap: [['CD_I1', remapTo(907)], ['CD_I2', { ok: false, reason: 'unresolvable' }]],
    });
    expect(mixed.inserts).toEqual([{ externalId: 'CD_I1', playerId: 907 }]);
    expect(mixed.stops.map((s) => s.externalId)).toEqual(['CD_I2']);
  });

  it('C5 (OD-3) — the bijection checker reports both directions, and only human resolved rows count', () => {
    const ledgerRows: AflApiAdjudicationLedgerRow[] = [
      { id: 1, externalId: 'CD_I1', action: 'linked', playerId: 1, playerIdentity: 'a', supersedesId: null },
      { id: 2, externalId: 'CD_I2', action: 'linked', playerId: 2, playerIdentity: 'b', supersedesId: null },
      { id: 3, externalId: 'CD_I2', action: 'revoked', playerId: 2, playerIdentity: 'b', supersedesId: 2 },
      { id: 4, externalId: 'CD_I3', action: 'linked', playerId: 3, playerIdentity: 'c', supersedesId: null },
    ];
    const row = (externalId: string, status = 'resolved', matchMethod: string | null = AFL_API_ADMIN_MATCH_METHOD) =>
      ({ externalId, status, matchMethod });
    expect(checkAflApiAdjudicationBijection({ ledgerRows, resolvedRows: [row('CD_I1'), row('CD_I3')] })).toEqual([]);
    expect(checkAflApiAdjudicationBijection({ ledgerRows, resolvedRows: [row('CD_I1')] }))
      .toEqual([{ kind: 'ledger_without_row', externalId: 'CD_I3' }]);
    // A net-revoked provider with a human row, and a human row with no ledger at all.
    expect(checkAflApiAdjudicationBijection({
      ledgerRows, resolvedRows: [row('CD_I1'), row('CD_I2'), row('CD_I3'), row('CD_I9')],
    })).toEqual([
      { kind: 'row_without_ledger', externalId: 'CD_I2' },
      { kind: 'row_without_ledger', externalId: 'CD_I9' },
    ]);
    // A resolved row under any other method is not a human identity, on either side.
    expect(checkAflApiAdjudicationBijection({
      ledgerRows, resolvedRows: [row('CD_I1'), row('CD_I3'), row('CD_I9', 'resolved', 'afl_api_stat_vector_season')],
    })).toEqual([]);
    expect(checkAflApiAdjudicationBijection({
      ledgerRows, resolvedRows: [row('CD_I1'), row('CD_I3', 'resolved', 'afl_api_stat_vector_season')],
    })).toEqual([{ kind: 'ledger_without_row', externalId: 'CD_I3' }]);
  });

  it('is contract-coherent alongside every other table', () => {
    expect(promotionContractProblems()).toEqual([]);
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
    // Every other reinstated table is untouched, in the same order (the staged tables of
    // AFLDB-ISSUE-151 have no plain restore line in either environment).
    const devGroups = reinstateGroups('dev');
    expect([...dev.matchAll(/--exit-on-error --table=([a-z_]+)/g)].map((m) => m[1]))
      .toEqual([...devGroups.direct, ...devGroups.dependants]);
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

/**
 * AFLDB-ISSUE-151. Met on the first production promotion (stamp 20260907-234124): the old
 * database's external_grid_sources row 1 carried ingest_source_id 57 (sources 57 = gridley),
 * the rebuilt candidate's gridley row is sources 7 and its id 57 does not exist. The remap
 * of AFLDB-ISSUE-142 resolved it correctly (57 -> gridley -> 7) but the plan restored the
 * table straight into public FIRST, where the NOT NULL immediate FK refuses 57 before any
 * UPDATE can run. The fix: such a table is STAGED — restored into promotion_staging with no
 * constraints, remapped there by the evidenced file, then promoted under the FK with its ids
 * preserved. These tests hold the plan to that shape and to everything it must not do.
 */
describe('staged reinstatement of NOT NULL lineage-bound references', () => {
  const PLAN_INPUT = {
    candidate: 'afldb_prod_candidate_20260907-234124', oldDatabase: 'afldb_prod',
    preCutoverDump: '/home/arm/backups/afldb/pre.dump', rebuiltDump: '/home/arm/afldb_test_rebuilt.dump',
  } as const;
  const gridSources = contractByName('external_grid_sources')!;

  /** The exact production case, resolved the way --phase restored resolves it. */
  function productionCaseRemap() {
    return resolveLineageRemap({
      entity: 'sources', rule: 'source_key', referencedIds: [57],
      replacedIdentities: [{ id: 57, identity: 'gridley' }],
      candidateIdentities: [{ id: 7, identity: 'gridley' }],
    });
  }
  function productionCasePlan(remap = productionCaseRemap()) {
    return {
      table: 'external_grid_sources', column: 'ingest_source_id', entity: 'sources',
      rule: 'source_key' as const, remediation: gridSources.lineageRefs![0].remediation,
      rows: [{ rowId: 1, oldValue: 57 }], remap,
    };
  }

  it('stages exactly the tables the contract makes stageable — decided by shape, not by name', () => {
    expect(isStagedReinstatement(gridSources)).toBe(true);
    expect(stagedLineageColumns(gridSources)).toEqual([
      { column: 'ingest_source_id', references: 'sources', identity: 'source_key' },
    ]);
    for (const environment of ENVIRONMENTS) {
      // Sorted (order, name): brownlow_vote_entry_state and external_grid_sources tie on
      // order 20, so name breaks the tie.
      expect(stagedReinstateTables(environment).map((t) => t.name))
        .toEqual(['afl_api_identity_adjudications', 'brownlow_vote_entry_state', 'external_grid_sources']);
      expect(isStagedLineageColumn('external_grid_sources', 'ingest_source_id', environment)).toBe(true);
      // Neither another column of the same table nor a lineage-bound column elsewhere.
      expect(isStagedLineageColumn('external_grid_sources', 'code', environment)).toBe(false);
      expect(isStagedLineageColumn('player_link_resolutions', 'player_id', environment)).toBe(false);
      expect(isStagedLineageColumn('data_edits', 'row_id', environment)).toBe(false);
      // AFLDB-ISSUE-155: brownlow_vote_entry_state is staged by match_id (NOT NULL), and its
      // nullable player-slot columns are staged TOO — table-level, not column-level — because
      // the whole row sits in promotion_staging until match_id is settled.
      expect(isStagedLineageColumn('brownlow_vote_entry_state', 'match_id', environment)).toBe(true);
      expect(isStagedLineageColumn('brownlow_vote_entry_state', 'three_player_id', environment)).toBe(true);
      expect(isStagedLineageColumn('brownlow_vote_entry_state', 'two_player_id', environment)).toBe(true);
      expect(isStagedLineageColumn('brownlow_vote_entry_state', 'one_player_id', environment)).toBe(true);
    }
    // The nullable exception path (§7.4) and the NOT NULL refusal path (§7.4b, import_batch_id)
    // are untouched: neither shape is staged.
    for (const t of publicContractTables()) {
      for (const ref of t.footballRefs ?? []) {
        const stable = stableLineageTargetForFootballRef(t, ref.column, ref.references);
        const staged = stagedLineageColumns(t).some((c) => c.column === ref.column);
        expect(staged, `${t.name}.${ref.column}`).toBe(!ref.nullable && stable !== undefined);
      }
    }
    expect(stagedLineageColumns(contractByName('data_submissions')!)).toEqual([]);
    expect(stagedLineageColumns(contractByName('player_link_resolutions')!)).toEqual([]);
    expect(stagedLineageColumns(contractByName('external_grids')!)).toEqual([]);
  });

  it('is a property of the reference, proven on synthetic tables', () => {
    const base = {
      schema: 'public' as const, subsystem: 's', category: 'operations' as const, productionOnly: true,
      treatment: 'reinstate' as const, compare: 'equal' as const, order: 20, note: 'n',
    };
    const notNullStable: TableTreatment = {
      ...base, name: 'synthetic_a',
      footballRefs: [{ column: 'source_id', references: 'sources', nullable: false, remediation: 'r' }],
      lineageRefs: [{ column: 'source_id', targets: [{ entity: 'sources', identity: 'source_key' }], remediation: 'r' }],
    };
    const nullableStable: TableTreatment = { ...notNullStable, name: 'synthetic_b',
      footballRefs: [{ column: 'source_id', references: 'sources', nullable: true }] };
    const notNullNoIdentity: TableTreatment = { ...notNullStable, name: 'synthetic_c',
      lineageRefs: [{ column: 'source_id', targets: [{ entity: 'sources', identity: 'none' }], remediation: 'r' }] };
    const notNullNoLineage: TableTreatment = { ...notNullStable, name: 'synthetic_d', lineageRefs: undefined };
    const reset: TableTreatment = { ...notNullStable, name: 'synthetic_e', treatment: 'reset', lineageRefs: undefined };
    expect(isStagedReinstatement(notNullStable)).toBe(true);
    expect(isStagedReinstatement(nullableStable)).toBe(false);
    expect(isStagedReinstatement(notNullNoIdentity)).toBe(false);
    expect(isStagedReinstatement(notNullNoLineage)).toBe(false);
    expect(isStagedReinstatement(reset)).toBe(false);
    expect(stagedReinstatementProblems(notNullStable)).toEqual([]);
    // A polymorphic column cannot be promoted by the generic INSERT … SELECT *, so the contract
    // refuses to stage it rather than generating a plan that only looks safe.
    const polymorphic: TableTreatment = { ...notNullStable, name: 'synthetic_f',
      lineageRefs: [{ column: 'source_id', kindColumn: 'kind',
        targets: [{ kind: 'x', entity: 'sources', identity: 'source_key' }], remediation: 'r' }] };
    expect(stagedReinstatementProblems(polymorphic)).toEqual([
      'stages polymorphic column source_id, which the staged promotion does not support',
    ]);
    expect(promotionContractProblems([...PROMOTION_CONTRACT, polymorphic])).toContain(
      'public.synthetic_f stages polymorphic column source_id, which the staged promotion does not support',
    );
  });

  it('splits the restore into direct, staged and dependants, and the planned order is still FK-safe', () => {
    for (const environment of ENVIRONMENTS) {
      const groups = reinstateGroups(environment);
      expect(groups.staged).toEqual(['afl_api_identity_adjudications', 'brownlow_vote_entry_state', 'external_grid_sources']);
      expect(groups.dependants).toEqual(['external_grids', 'external_grid_axes']);
      expect(groups.direct).not.toContain('brownlow_vote_entry_state');
      expect(groups.direct).not.toContain('external_grid_sources');
      expect(groups.direct).not.toContain('external_grids');
      expect(groups.direct).not.toContain('external_grid_axes');
      const planned = plannedReinstateOrder(environment);
      expect([...planned].sort()).toEqual([...reinstatedPublicTables(environment)].sort());
      expect(planned.indexOf('external_grids')).toBeGreaterThan(planned.indexOf('external_grid_sources'));
      expect(planned.indexOf('external_grid_axes')).toBeGreaterThan(planned.indexOf('external_grids'));
      for (const t of publicContractTables()) {
        if (!planned.includes(t.name)) continue;
        for (const parent of t.restoreAfter ?? []) {
          expect(planned.indexOf(parent), `${t.name} after ${parent}`).toBeLessThan(planned.indexOf(t.name));
        }
      }
    }
    expect(promotionContractProblems()).toEqual([]);
  });

  it('resolves the production case through sources.key and writes the UPDATE into the staging copy', () => {
    const remap = productionCaseRemap();
    expect(remap.mapped).toEqual([{ oldId: 57, identity: 'gridley', newId: 7 }]);
    expect(remap.unresolved).toEqual([]);
    expect(remap.unchanged).toBe(0);
    const sql = lineageRemapSql({ candidate: PLAN_INPUT.candidate, oldDatabase: 'afldb_prod', environment: 'prod',
      plans: [productionCasePlan(remap)] });
    expect(sql).toContain('--   57 -> gridley -> 7');
    expect(sql).toContain('UPDATE "promotion_staging"."external_grid_sources" SET "ingest_source_id" = 7'
      + ' WHERE "id" = 1 AND "ingest_source_id" = 57;');
    // The row keeps its own id (the guard is on id = 1), and nothing is written in public.
    expect(sql).not.toMatch(/UPDATE "public"\."external_grid_sources"/);
    expect(sql).not.toMatch(/\b(DELETE|INSERT|TRUNCATE|ALTER|DROP)\b/);
    // Never by name: the display name of the source appears nowhere in the file.
    expect(sql).not.toMatch(/Gridley/);
    expect(sql).toContain('FROM "promotion_staging"."external_grid_sources" t');
    expect(sql).toContain('NOT IN (SELECT id FROM (VALUES (7, \'gridley\')');
    expect(lineageRemapProblems(sql, [productionCasePlan(remap)], 'prod')).toEqual([]);
  });

  it('still fails closed when the stable identity cannot be evidenced, and never fabricates the row', () => {
    const absent = resolveLineageRemap({
      entity: 'sources', rule: 'source_key', referencedIds: [57],
      replacedIdentities: [{ id: 57, identity: 'gridley' }],
      candidateIdentities: [],
    });
    expect(absent.unresolved).toEqual([{ oldId: 57, reason: 'identity_absent_in_candidate', identity: 'gridley' }]);
    for (const environment of ENVIRONMENTS) {
      expect(judgeLineage({ environment, columns: [
        { table: 'external_grid_sources', column: 'ingest_source_id', unresolved: 1 },
      ] }).verdict).toBe('FAIL');
    }
    const sql = lineageRemapSql({ candidate: PLAN_INPUT.candidate, oldDatabase: 'afldb_prod', environment: 'prod',
      plans: [productionCasePlan(absent)] });
    expect(sql.split('\n').filter((l) => l.startsWith('UPDATE'))).toHaveLength(0);
    expect(sql).toContain('-- UNRESOLVED external_grid_sources.ingest_source_id = 57 (identity_absent_in_candidate, identity gridley)');
    expect(sql).not.toMatch(/INSERT/);
    // And the promotion refuses the unsettled integer before any INSERT, naming the rule.
    const promote = promoteStagedSql('prod');
    expect(promote).toContain("external_grid_sources.ingest_source_id still carries the replaced database''s id(s)");
    expect(promote).toContain('never insert a sources row');
    expect(promote.indexOf('RAISE EXCEPTION')).toBeLessThan(promote.indexOf('INSERT INTO "public"."external_grid_sources"'));
  });

  it('refuses a remap that writes a staged column in public instead of the staging copy', () => {
    const plans = [productionCasePlan()];
    const good = lineageRemapSql({ candidate: 'c', oldDatabase: 'o', environment: 'prod', plans });
    const bad = good.replace('UPDATE "promotion_staging"."external_grid_sources"', 'UPDATE "public"."external_grid_sources"');
    expect(bad).not.toBe(good);
    expect(lineageRemapProblems(bad, plans, 'prod')).toEqual([
      'staged table external_grid_sources receives a generated remap write in public instead of promotion_staging',
    ]);
  });

  it('the generated plan never plainly restores the staged table, and orders stage -> remap -> promote -> dependants', () => {
    for (const environment of ENVIRONMENTS) {
      const plan = reinstatePlan({ ...PLAN_INPUT, environment });
      expect(plan).not.toMatch(/--exit-on-error --table=external_grid_sources(\s|$)/);
      const at = (needle: string) => { const i = plan.indexOf(needle); expect(i, needle).toBeGreaterThanOrEqual(0); return i; };
      const groups = reinstateGroups(environment);
      const lastDirect = plan.lastIndexOf(`--exit-on-error --table=${groups.direct.at(-1)} `);
      const stage = at('-f promotion-stage.sql');
      const restore = at('--table=external_grid_sources -f - \'/home/arm/backups/afldb/pre.dump\'');
      const redirect = at(`| sed -e '${stagedCopyRedirect('external_grid_sources')}' > promotion-stage-external_grid_sources.sql`);
      const guard = at("grep -q '^COPY promotion_staging.external_grid_sources (' promotion-stage-external_grid_sources.sql");
      const load = at('--single-transaction -f promotion-stage-external_grid_sources.sql');
      const remap = at('-f "$LINEAGE_REMAP_SQL"');
      const promote = at('-f promotion-promote-staged.sql');
      const grids = at('--exit-on-error --table=external_grids ');
      const axes = at('--exit-on-error --table=external_grid_axes ');
      const aflw = at('--schema=staging_aflw --table=seasons');
      const resync = at('-f promotion-resync-identity.sql');
      expect([lastDirect, stage, restore, redirect, guard, load, remap, promote, grids, axes, aflw, resync])
        .toEqual([lastDirect, stage, restore, redirect, guard, load, remap, promote, grids, axes, aflw, resync].slice().sort((a, b) => a - b));
      expect(plan).toContain('LINEAGE_REMAP_SQL is the file --phase restored wrote through --lineage-remap-out');
      expect(plan).toContain('AFLDB-ISSUE-151');
      // The staged restore is the only line of its kind, and it is the redirected script that is loaded.
      expect((plan.match(/--table=external_grid_sources -f - /g) ?? []).length).toBe(1);
      expect((plan.match(/-f promotion-promote-staged\.sql/g) ?? []).length).toBe(1);
      expect(plan).not.toMatch(/postgres(ql)?:\/\//);
    }
  });

  it('the staging and promotion SQL preserve ids, keep the FK in force and leave nothing behind', () => {
    const stage = stageSql();
    expect(stage).toContain('CREATE SCHEMA "promotion_staging";');
    expect(stage).toContain('CREATE TABLE "promotion_staging"."external_grid_sources" (LIKE "public"."external_grid_sources");');
    expect(stage).not.toMatch(/INCLUDING/);
    expect(stage).toMatch(/^BEGIN;/m);
    expect(stage).toMatch(/^COMMIT;/m);
    const promote = promoteStagedSql();
    expect(promote).toContain('INSERT INTO "public"."external_grid_sources" OVERRIDING SYSTEM VALUE'
      + ' SELECT * FROM "promotion_staging"."external_grid_sources" ORDER BY "id";');
    expect(promote).toContain('DROP TABLE "promotion_staging"."external_grid_sources";');
    expect(promote).toContain('DROP SCHEMA "promotion_staging";');
    expect(promote).toContain('is empty: the staged restore (plan step 2b) did not run');
    // Refuses BEFORE the INSERT, in the same transaction, and touches nothing else.
    expect(promote.indexOf('RAISE EXCEPTION')).toBeLessThan(promote.indexOf('INSERT INTO'));
    expect(promote).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|CASCADE)\b/);
    for (const text of [stage, promote, reinstatePlan(PLAN_INPUT)]) {
      expect(text).not.toMatch(/session_replication_role|DISABLE TRIGGER|DROP CONSTRAINT|SET CONSTRAINTS|DEFERRABLE|NOT VALID|--disable-triggers|--superuser/i);
      expect(text).not.toMatch(/INSERT INTO "public"\."sources"/);
    }
    // The identity sequence of the promoted table is still re-synced afterwards.
    expect(resyncIdentitySql()).toContain("'external_grid_sources'");
    expect(stagedPlanProblems(generatedPlanArtifacts('prod'))).toEqual([]);
    expect(stagedPlanProblems(generatedPlanArtifacts('dev'), 'dev')).toEqual([]);
  });

  it('the plan validator refuses the unsafe plain restore, a misordered lifecycle and a constraint bypass', () => {
    const good = generatedPlanArtifacts('prod');
    const restoreLine = 'pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges \\\n'
      + "           --single-transaction --exit-on-error --table=external_grid_sources '/backups/pre.dump'\n";
    // The pre-fix shape: a plain restore of the staged table before anything else.
    const plain = { ...good, reinstate: good.reinstate.replace('psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-stage.sql', `${restoreLine}psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-stage.sql`) };
    expect(stagedPlanProblems(plain)).toContain('staged table external_grid_sources receives a plain pg_restore into public');
    expect(promotionPlanProblems(plain)).toContain('public restore order differs from the prod contract');
    // Promotion before the remap: the old integer would meet the FK.
    const remapLine = 'psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f "$LINEAGE_REMAP_SQL"';
    const promoteLine = 'psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-promote-staged.sql';
    const swapped = { ...good, reinstate: good.reinstate.replace(remapLine, '@@R@@').replace(promoteLine, remapLine).replace('@@R@@', promoteLine) };
    expect(stagedPlanProblems(swapped)).toContain('staged lifecycle is not ordered direct restores -> stage -> remap -> promote -> dependants');
    // A dependant restored before the promotion, and the remap dropped altogether.
    const early = { ...good, reinstate: good.reinstate.replace(promoteLine, '@@P@@').replace(/pg_restore[^\n]*\n[^\n]*--table=external_grids '[^\n]*\n/, (m) => `${m}${promoteLine}\n`).replace('@@P@@\n', '') };
    expect(stagedPlanProblems(early)).toContain('staged lifecycle is not ordered direct restores -> stage -> remap -> promote -> dependants');
    const noRemap = { ...good, reinstate: good.reinstate.replace(remapLine, '') };
    expect(stagedPlanProblems(noRemap)).toContain('plan must apply the lineage remap exactly once');
    // Every constraint bypass is refused wherever it appears.
    for (const bypass of ['SET session_replication_role = replica;', 'ALTER TABLE "public"."external_grid_sources" DISABLE TRIGGER ALL;',
      'ALTER TABLE "public"."external_grid_sources" DROP CONSTRAINT "external_grid_sources_ingest_source_id_fkey";',
      'SET CONSTRAINTS ALL DEFERRED;']) {
      expect(stagedPlanProblems({ ...good, stage: `${good.stage}${bypass}\n` }), bypass).toContain('stage bypasses or weakens a constraint');
      expect(stagedPlanProblems({ ...good, promoteStaged: `${good.promoteStaged}${bypass}\n` }), bypass).toContain('promoteStaged bypasses or weakens a constraint');
    }
    expect(stagedPlanProblems({ ...good, reinstate: `${good.reinstate}pg_restore --disable-triggers …\n` })).toContain('reinstate bypasses or weakens a constraint');
    // The promotion must keep the ids and drop the staging copy; the redirect must be present.
    // Dropping OVERRIDING SYSTEM VALUE is refused for EVERY staged table, and per table: the
    // validator walks reinstateGroups().staged, so a plan that keeps the ids of one staged table
    // and reassigns another's is caught, naming exactly the offender. (Asserted with both a
    // replaceAll and a single-occurrence replace so neither table can be covered by the other.)
    const staged = reinstateGroups('prod').staged;
    expect(staged).toEqual(['afl_api_identity_adjudications', 'brownlow_vote_entry_state', 'external_grid_sources']);
    const noOverride = { ...good, promoteStaged: good.promoteStaged.replaceAll(' OVERRIDING SYSTEM VALUE', '') };
    expect(stagedPlanProblems(noOverride))
      .toEqual(staged.map((t) => `promotion-promote-staged.sql does not promote ${t} with its ids preserved`));
    for (const table of staged) {
      const one = {
        ...good,
        promoteStaged: good.promoteStaged.replace(
          `INSERT INTO "public"."${table}" OVERRIDING SYSTEM VALUE`, `INSERT INTO "public"."${table}"`),
      };
      expect(one.promoteStaged, table).not.toBe(good.promoteStaged);
      expect(stagedPlanProblems(one))
        .toEqual([`promotion-promote-staged.sql does not promote ${table} with its ids preserved`]);
    }
    const noRedirect = { ...good, reinstate: good.reinstate.replace(stagedCopyRedirect('external_grid_sources'), 's/x/y/') };
    expect(stagedPlanProblems(noRedirect)).toContain('staged table external_grid_sources restore does not redirect its COPY to promotion_staging');
    const cascade = { ...good, promoteStaged: good.promoteStaged.replace('DROP SCHEMA "promotion_staging";', 'DROP SCHEMA "promotion_staging" CASCADE;') };
    expect(stagedPlanProblems(cascade)).toContain('staged lifecycle uses CASCADE');
    expect(() => assertPromotionPlanCoherent(plain)).toThrow(PromotionRefused);
  });

  it('the COPY redirect is anchored to the dump header and is the only edit of the restore stream', () => {
    expect(stagedCopyRedirect('external_grid_sources'))
      .toBe('s/^COPY public\\.external_grid_sources (/COPY promotion_staging.external_grid_sources (/');
    expect(STAGING_SCHEMA).toBe('promotion_staging');
    expect(() => stagedCopyRedirect('Bad Name')).toThrow(PromotionRefused);
  });

  it('encodes the invariant that a staged table holds rows unless its contract permits zero: judged at pre-cutover, refused at promotion', () => {
    // AFLDB-ISSUE-247: emptiness alone never proves the staged restore ran, so every table
    // whose contract does NOT declare stagedMayBeEmpty keeps the AFLDB-ISSUE-151 refusal word
    // for word, and the one that does is accepted only on stage-completion evidence.
    const promote = promoteStagedSql();
    expect(promote).toContain('IF staged_rows = 0 THEN');
    expect(promote).toContain('an empty copy is never a legitimate state');
    const requiresRows = stagedReinstateTables('prod').filter((t) => !stagedMayBeEmpty(t)).map((t) => t.name);
    expect(requiresRows).toEqual(['brownlow_vote_entry_state', 'external_grid_sources']);
    // Every staged table carries its OWN emptiness decision — one populated copy never vouches
    // for a sibling that restored nothing.
    for (const name of requiresRows) {
      expect(promote, name).toContain(
        `promotion_staging.${name} is empty: the staged restore (plan step 2b) did not run or restored nothing`);
    }
    expect(promote).not.toContain('promotion_staging.afl_api_identity_adjudications is empty');
    expect((promote.match(/IF staged_rows = 0 THEN/g) ?? []).length).toBe(stagedReinstateTables('prod').length);
    for (const environment of ENVIRONMENTS) {
      const staged = stagedReinstateTables(environment).map((t) => t.name);
      // AFLDB-ISSUE-155: brownlow_vote_entry_state is staged too (match_id is a NOT NULL
      // primary-key reference into rebuilt matches), so the gate now judges two tables.
      expect(staged).toEqual(['afl_api_identity_adjudications', 'brownlow_vote_entry_state', 'external_grid_sources']);
      const ok = judgeStagedSourceRows(
        {
          'public.afl_api_identity_adjudications': 1, 'public.brownlow_vote_entry_state': 4,
          'public.external_grid_sources': 1, 'public.external_grids': 0,
        },
        environment);
      expect(ok).toEqual({
        populated: [
          { table: 'afl_api_identity_adjudications', rows: 1 },
          { table: 'brownlow_vote_entry_state', rows: 4 },
          { table: 'external_grid_sources', rows: 1 },
        ],
        empty: [], emptyPermitted: [], missing: [], verdict: 'PASS',
      });
      // All three at zero: the two that require rows refuse; the permitted one is reported.
      const empty = judgeStagedSourceRows(
        {
          'public.afl_api_identity_adjudications': 0, 'public.brownlow_vote_entry_state': 0,
          'public.external_grid_sources': 0,
        }, environment);
      expect(empty.verdict).toBe('FAIL');
      expect(empty.empty).toEqual(requiresRows);
      expect(empty.emptyPermitted).toEqual([{ table: 'afl_api_identity_adjudications', decidedBy: 'AFLDB-ISSUE-247' }]);
      for (const one of staged) {
        const others = Object.fromEntries(staged.filter((t) => t !== one).map((t) => [`public.${t}`, 2]));
        const oneEmpty = judgeStagedSourceRows({ ...others, [`public.${one}`]: 0 }, environment);
        const permitted = one === 'afl_api_identity_adjudications';
        expect(oneEmpty.verdict, one).toBe(permitted ? 'PASS' : 'FAIL');
        expect(oneEmpty.empty, one).toEqual(permitted ? [] : [one]);
        expect(oneEmpty.emptyPermitted.map((e) => e.table), one).toEqual(permitted ? [one] : []);
        expect(oneEmpty.missing, one).toEqual([]);
        // An ABSENT table refuses whatever its contract says about emptiness.
        const oneAbsent = judgeStagedSourceRows(others, environment);
        expect(oneAbsent.verdict, one).toBe('FAIL');
        expect(oneAbsent.missing, one).toEqual([one]);
        expect(oneAbsent.empty, one).toEqual([]);
      }
      const absent = judgeStagedSourceRows({ 'public.external_grids': 3 }, environment);
      expect(absent.verdict).toBe('FAIL');
      expect(absent.missing).toEqual(staged);
      // Only a staged table is judged: a non-staged reinstated table at 0 is not this gate's business.
      expect(judgeStagedSourceRows(
        {
          'public.afl_api_identity_adjudications': 1, 'public.brownlow_vote_entry_state': 4,
          'public.external_grid_sources': 2, 'public.auth_users': 0,
        },
        environment).verdict).toBe('PASS');
    }
    // The checker applies it at exactly the pre-cutover phase, from the inventory it already took.
    const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    expect(source).toContain("if (phase === 'pre-cutover') gateStagedSourceRows(counts, opts.environment, report);");
    expect(source).toContain('EMPTY, permitted by contract');
    expect(isStagedReinstatement(gridSources)).toBe(true);
    expect(isStagedReinstatement(contractByName('brownlow_vote_entry_state')!)).toBe(true);
  });

  it('an interrupted staged reinstatement fails closed: the leftover schema is refused everywhere and never reused', () => {
    // The generated files never adopt or silently remove an existing staging schema.
    const stage = stageSql();
    const promote = promoteStagedSql();
    expect(stage).toContain('CREATE SCHEMA "promotion_staging";');
    expect(stage).not.toMatch(/IF\s+NOT\s+EXISTS|IF\s+EXISTS|DROP\s+SCHEMA|DROP\s+TABLE/i);
    expect(stage).toContain('never reuse it');
    expect(promote).not.toMatch(/IF\s+EXISTS|IF\s+NOT\s+EXISTS|CREATE\s+SCHEMA/i);
    expect((promote.match(/DROP SCHEMA/g) ?? []).length).toBe(1);
    for (const environment of ENVIRONMENTS) {
      expect(reinstatePlan({ ...PLAN_INPUT, environment })).not.toMatch(/DROP\s+SCHEMA|IF\s+NOT\s+EXISTS/i);
    }
    // The plan validator refuses every shape that would reuse or quietly clean up a leftover.
    const good = generatedPlanArtifacts('prod');
    expect(stagedPlanProblems(good)).toEqual([]);
    const adopt = { ...good, stage: good.stage.replace('CREATE SCHEMA "promotion_staging";', 'CREATE SCHEMA IF NOT EXISTS "promotion_staging";') };
    expect(stagedPlanProblems(adopt)).toContain('stage silently reuses or removes a leftover staging schema');
    expect(stagedPlanProblems(adopt)).toContain('promotion-stage.sql does not create the staging schema');
    const preDrop = { ...good, stage: good.stage.replace('BEGIN;', 'BEGIN;\nDROP SCHEMA "promotion_staging";') };
    expect(stagedPlanProblems(preDrop)).toContain('a leftover staging schema is dropped outside promotion-promote-staged.sql');
    const preDropIfExists = { ...good, stage: good.stage.replace('BEGIN;', 'BEGIN;\nDROP SCHEMA IF EXISTS "promotion_staging" CASCADE;') };
    expect(stagedPlanProblems(preDropIfExists)).toEqual(expect.arrayContaining([
      'staged lifecycle uses CASCADE',
      'stage silently reuses or removes a leftover staging schema',
      'a leftover staging schema is dropped outside promotion-promote-staged.sql',
    ]));
    const planDrop = { ...good, reinstate: good.reinstate.replace('-f promotion-stage.sql', '-c \'DROP SCHEMA promotion_staging\'\npsql "$CANDIDATE_DSN" -f promotion-stage.sql') };
    expect(stagedPlanProblems(planDrop)).toContain('a leftover staging schema is dropped outside promotion-promote-staged.sql');
    const lenientPromote = { ...good, promoteStaged: good.promoteStaged.replace('DROP SCHEMA "promotion_staging";', 'DROP SCHEMA IF EXISTS "promotion_staging";') };
    expect(stagedPlanProblems(lenientPromote)).toEqual(expect.arrayContaining([
      'promoteStaged silently reuses or removes a leftover staging schema',
      'promotion-promote-staged.sql does not drop the staging schema',
    ]));
    for (const bad of [adopt, preDrop, planDrop, lenientPromote]) expect(() => assertPromotionPlanCoherent(bad)).toThrow(PromotionRefused);
    // The checker refuses a leftover at EVERY phase, before the phase-specific gates, and its
    // verdict tells the operator to inspect first, never reuse, and drop only by hand.
    expect(judgeStagingLeftover(null)).toEqual({ verdict: 'PASS', lines: ['schema promotion_staging is absent'] });
    const bare = judgeStagingLeftover([]);
    expect(bare.verdict).toBe('FAIL');
    expect(bare.lines.join('\n')).toContain('it holds no tables');
    const left = judgeStagingLeftover([{ table: 'external_grid_sources', rows: 1 }]);
    expect(left.verdict).toBe('FAIL');
    const text = left.lines.join('\n');
    for (const needle of ['did not finish', 'promotion_staging.external_grid_sources', '1 row(s)', 'Inspect it before anything else',
      'Never reuse it', 'nothing generated drops it', 'Drop it by hand', 'regenerate the plan']) {
      expect(text, needle).toContain(needle);
    }
    const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    const leftoverCall = source.indexOf('await gateStagingLeftover(conn.q, report);');
    expect(leftoverCall).toBeGreaterThan(source.indexOf('await gateClassification(conn.q, report);'));
    expect(leftoverCall).toBeLessThan(source.indexOf("old = await openReadOnly(withDatabase(baseDsn, opts.oldDatabase!), 'old');"));
    expect(source.slice(leftoverCall - 200, leftoverCall)).not.toMatch(/if \(phase/);
    expect(source).not.toMatch(/DROP SCHEMA/);
    // And the operator documentation requires the inspection before any cleanup or retry.
    const doc = readFileSync(join(REPO, 'docs', 'production-promotion.md'), 'utf8');
    for (const needle of ['inspect it, never reuse it', 'Interrupted staged reinstatement', 'refuses at every phase',
      'after the inspection is recorded', 'CREATE SCHEMA` refuses']) {
      expect(doc, needle).toContain(needle);
    }
  });

  it('every operator surface now says the same thing about the staged table', () => {
    const checklist = ACCEPTANCE_CHECKLIST.join('\n');
    for (const needle of ['AFLDB-ISSUE-151', 'promotion_staging', 'external_grid_sources.ingest_source_id',
      'No sources row inserted', 'no constraint dropped or deferred']) {
      expect(checklist, needle).toContain(needle);
    }
    expect(checklist).not.toMatch(/settled BEFORE its restore lines/);
    expect(gridSources.footballRefs![0].remediation).toContain('STAGES this table');
    expect(gridSources.lineageRefs![0].remediation).toContain('STAGED copy');
    expect(gridSources.lineageRefs![0].remediation).not.toMatch(/after reinstatement/);
    const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    expect(source).toContain("the plan STAGES ${t.name} (AFLDB-ISSUE-151)");
    expect(source).not.toMatch(/apply it after reinstate, before acceptance/);
    expect(source).not.toMatch(/run it on the candidate AFTER the reinstate/);
    // A shared lineage still generates the remap file, as an explicit no-op, so the plan's fixed
    // remap step always has its file — prepared at the one generation site, published (only on a
    // fully passing run, AFLDB-ISSUE-237 L4) by publishRestoredLineageRemap.
    expect(source).toContain('prepareRemap([], true)');
    expect(source).toContain('an explicit no-op (shared lineage, no UPDATE)');
    const doc = readFileSync(join(REPO, 'docs', 'production-promotion.md'), 'utf8');
    for (const needle of ['AFLDB-ISSUE-151', 'promotion_staging', 'promotion-stage.sql', 'promotion-promote-staged.sql']) {
      expect(doc, needle).toContain(needle);
    }
  });
});

/**
 * AFLDB-ISSUE-247 — a legitimately empty staged table (afl_api_identity_adjudications, 0 rows
 * on afldb_dev at ISSUE-237 L4 A5) versus a staged restore that never ran.
 *
 * DB-free. No in-process PostgreSQL is available, so the generated promotion is exercised by
 * walking each table's DO block guard by guard, in file order, exactly as PL/pgSQL would:
 * an unknown guard fails the test, so a change to the SQL's control flow forces this suite to
 * be revisited rather than silently passing. The live proof is the rehearsal in
 * issues/closed/AFLDB-ISSUE-247.md.
 */
describe('AFLDB-ISSUE-247 — stage-completion evidence for legitimately empty staged tables', () => {
  const AFL = 'afl_api_identity_adjudications';
  const GRID = 'external_grid_sources';
  const BROWNLOW = 'brownlow_vote_entry_state';
  const S = '"promotion_staging"';

  type StagedState = {
    /** The stage-completion row's restored_rows; undefined = no row (the restore never committed). */
    evidence?: number;
    stagedRows: number;
    /** True when a lineage column still carries a replaced-database id. */
    unsettled?: boolean;
  };
  type BlockOutcome = { outcome: 'PASS'; notices: string[] } | { outcome: 'REFUSE'; message: string };

  function promoteBlockOf(promote: string, table: string): string {
    const start = promote.indexOf(`-- ${table}\nDO $$`);
    const end = promote.indexOf(`DROP TABLE ${S}."${table}";`, start);
    expect(start, table).toBeGreaterThanOrEqual(0);
    expect(end, table).toBeGreaterThan(start);
    return promote.slice(start, end);
  }

  const GUARDS: Record<string, (s: StagedState) => boolean> = {
    'NOT FOUND': (s) => s.evidence === undefined,
    'staged_rows <> evidenced_rows': (s) => s.stagedRows !== s.evidence,
    'staged_rows = 0': (s) => s.stagedRows === 0,
    'unsettled IS NOT NULL': (s) => s.unsettled === true,
  };

  function runPromoteBlock(promote: string, table: string, state: StagedState): BlockOutcome {
    const block = promoteBlockOf(promote, table);
    const guards = [...block.matchAll(/^\s*IF (.+?) THEN\n\s*RAISE (EXCEPTION|NOTICE) '((?:[^']|'')*)'/gm)];
    expect(guards.length, table).toBeGreaterThanOrEqual(3);
    // Every RAISE in the block is one of the guards walked here, plus the closing NOTICE:
    // nothing refuses unguarded.
    expect((block.match(/RAISE (EXCEPTION|NOTICE)/g) ?? []).length, table).toBe(guards.length + 1);
    // The promotion INSERT follows every guard.
    expect(block.indexOf(`INSERT INTO "public"."${table}"`), table).toBeGreaterThan(guards.at(-1)!.index!);
    const notices: string[] = [];
    for (const [, condition, kind, message] of guards) {
      const guard = GUARDS[condition];
      if (!guard) throw new Error(`unknown guard in ${table}'s promotion block: IF ${condition} THEN`);
      if (!guard(state)) continue;
      if (kind === 'EXCEPTION') return { outcome: 'REFUSE', message: message.replaceAll("''", "'") };
      notices.push(message);
    }
    return { outcome: 'PASS', notices };
  }

  it('the contract permits zero rows only where it says so, and only on a staged table', () => {
    expect(stagedMayBeEmpty(contractByName(AFL)!)?.decidedBy).toBe('AFLDB-ISSUE-247');
    expect(stagedMayBeEmpty(contractByName(GRID)!)).toBeUndefined();
    expect(stagedMayBeEmpty(contractByName(BROWNLOW)!)).toBeUndefined();
    expect(promotionContractProblems()).toEqual([]);
    const authUsers = contractByName('auth_users')!;
    const notStaged = { ...authUsers, stagedMayBeEmpty: { decidedBy: 'AFLDB-ISSUE-247', reason: 'x' } };
    expect(stagedMayBeEmpty(notStaged)).toBeUndefined();
    expect(stagedMayBeEmptyProblems(notStaged)).toEqual(['declares stagedMayBeEmpty but is not a staged reinstatement']);
    const afl = contractByName(AFL)!;
    expect(stagedMayBeEmptyProblems({ ...afl, stagedMayBeEmpty: { decidedBy: 'operator said so', reason: '' } })).toEqual([
      'declares stagedMayBeEmpty without a deciding issue', 'declares stagedMayBeEmpty without a reason',
    ]);
    const swapped = PROMOTION_CONTRACT.map((t) => (t.name === 'auth_users' && t.schema === 'public' ? notStaged : t));
    expect(promotionContractProblems(swapped)).toContain('public.auth_users declares stagedMayBeEmpty but is not a staged reinstatement');
    // The evidence table can never shadow a contract table inside the staging schema.
    const colliding = [...PROMOTION_CONTRACT, { ...authUsers, name: STAGE_COMPLETION_TABLE }];
    expect(promotionContractProblems(colliding))
      .toContain(`public.${STAGE_COMPLETION_TABLE} collides with the stage-completion evidence table in promotion_staging`);
  });

  it('0 rows with the restore completed PASSES for afl_api_identity_adjudications — the ISSUE-237 L4 A5 state', () => {
    for (const environment of ENVIRONMENTS) {
      // The exact afldb_dev census that REFUSED A5 now passes the pre-cutover gate.
      const a5 = judgeStagedSourceRows({ [`public.${AFL}`]: 0, [`public.${BROWNLOW}`]: 3, [`public.${GRID}`]: 1 }, environment);
      expect(a5.verdict).toBe('PASS');
      expect(a5.emptyPermitted).toEqual([{ table: AFL, decidedBy: 'AFLDB-ISSUE-247' }]);
      expect(a5.populated).toEqual([{ table: BROWNLOW, rows: 3 }, { table: GRID, rows: 1 }]);
      const run = runPromoteBlock(promoteStagedSql(environment), AFL, { evidence: 0, stagedRows: 0 });
      expect(run.outcome).toBe('PASS');
      expect(run.outcome === 'PASS' && run.notices.join('\n')).toContain('permitted empty by contract (AFLDB-ISSUE-247)');
    }
  });

  it('0 rows with the restore step skipped REFUSES the same table, at runtime and in the plan', () => {
    for (const environment of ENVIRONMENTS) {
      const promote = promoteStagedSql(environment);
      expect(runPromoteBlock(promote, AFL, { stagedRows: 0 }))
        .toEqual({ outcome: 'REFUSE', message: stageEvidenceMissingMessage(AFL) });
      const good = generatedPlanArtifacts(environment);
      const load = `psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 --single-transaction -f promotion-stage-${AFL}.sql\n`;
      expect(good.reinstate).toContain(load);
      const notLoaded = `staged table ${AFL} is not loaded from promotion-stage-${AFL}.sql in one transaction`;
      const skipped = { ...good, reinstate: good.reinstate.replace(load, '') };
      expect(stagedPlanProblems(skipped, environment)).toContain(notLoaded);
      // Splitting the load out of its single transaction is refused too: the trigger's row must
      // commit with the COPY or not at all.
      const split = { ...good, reinstate: good.reinstate.replace(load, load.replace(' --single-transaction', '')) };
      expect(stagedPlanProblems(split, environment)).toContain(notLoaded);
      expect(() => assertPromotionPlanCoherent(skipped, environment)).toThrow(PromotionRefused);
    }
  });

  it('external_grid_sources and brownlow_vote_entry_state at 0 rows REFUSE even with completion evidence', () => {
    for (const environment of ENVIRONMENTS) {
      const promote = promoteStagedSql(environment);
      for (const table of [GRID, BROWNLOW]) {
        const run = runPromoteBlock(promote, table, { evidence: 0, stagedRows: 0 });
        expect(run.outcome, table).toBe('REFUSE');
        expect(run.outcome === 'REFUSE' && run.message, table).toContain(
          `promotion_staging.${table} is empty: the staged restore (plan step 2b) did not run or restored nothing`);
      }
      // ...and a promotion that quietly downgrades that refusal is caught by the plan validator.
      const good = generatedPlanArtifacts(environment);
      const lenient = {
        ...good,
        promoteStaged: good.promoteStaged.replace(
          `RAISE EXCEPTION 'promotion_staging.${GRID} is empty`, `RAISE NOTICE 'promotion_staging.${GRID} was empty`),
      };
      expect(lenient.promoteStaged).not.toBe(good.promoteStaged);
      expect(stagedPlanProblems(lenient, environment))
        .toEqual([`promotion-promote-staged.sql accepts an empty ${GRID}, whose contract requires rows`]);
    }
  });

  it('a non-empty staged table with completion evidence PASSES unchanged, and an unsettled row still refuses', () => {
    for (const environment of ENVIRONMENTS) {
      const promote = promoteStagedSql(environment);
      for (const table of [AFL, BROWNLOW, GRID]) {
        expect(runPromoteBlock(promote, table, { evidence: 3, stagedRows: 3 })).toEqual({ outcome: 'PASS', notices: [] });
        const unsettled = runPromoteBlock(promote, table, { evidence: 3, stagedRows: 3, unsettled: true });
        expect(unsettled.outcome, table).toBe('REFUSE');
        expect(unsettled.outcome === 'REFUSE' && unsettled.message, table).toContain("still carries the replaced database's id(s)");
      }
    }
  });

  it('a staging copy whose row count moved after its evidenced restore REFUSES', () => {
    const promote = promoteStagedSql();
    const cases: [string, StagedState][] = [[AFL, { evidence: 0, stagedRows: 1 }], [GRID, { evidence: 2, stagedRows: 1 }]];
    for (const [table, state] of cases) {
      const run = runPromoteBlock(promote, table, state);
      expect(run.outcome, table).toBe('REFUSE');
      expect(run.outcome === 'REFUSE' && run.message, table)
        .toContain(`promotion_staging.${table} holds % row(s) but its evidenced restore copied %`);
    }
  });

  it('an interrupted stage stays fail-closed: no evidence without a committed COPY, and the leftover is refused', () => {
    // Evidence is written only by the trigger, created inside promotion-stage.sql's transaction.
    const stage = stageSql();
    expect(stage).toMatch(/^BEGIN;/m);
    expect(stage.indexOf('CREATE TRIGGER')).toBeLessThan(stage.lastIndexOf('COMMIT;'));
    expect(stage).not.toMatch(/IF\s+NOT\s+EXISTS|IF\s+EXISTS|DROP\s+SCHEMA|DROP\s+TABLE|DROP\s+FUNCTION/i);
    // Stopped after afl_api's load but before the others: the first table with no evidence refuses.
    const promote = promoteStagedSql();
    expect(runPromoteBlock(promote, AFL, { evidence: 0, stagedRows: 0 }).outcome).toBe('PASS');
    expect(runPromoteBlock(promote, BROWNLOW, { stagedRows: 0 }))
      .toEqual({ outcome: 'REFUSE', message: stageEvidenceMissingMessage(BROWNLOW) });
    // The checker refuses the residue at every phase, evidence table included.
    const left = judgeStagingLeftover([{ table: AFL, rows: 0 }, { table: STAGE_COMPLETION_TABLE, rows: 1 }]);
    expect(left.verdict).toBe('FAIL');
    const text = left.lines.join('\n');
    expect(text).toContain('did not finish');
    expect(text).toContain(`${STAGE_COMPLETION_TABLE} holds one row per staged table whose COPY committed`);
    expect(judgeStagingLeftover([{ table: STAGE_COMPLETION_TABLE, rows: 0 }]).verdict).toBe('FAIL');
    expect(judgeStagingLeftover([{ table: GRID, rows: 1 }]).lines.join('\n')).not.toContain(STAGE_COMPLETION_TABLE);
  });

  it('evidence cannot be spoofed by an unrelated table', () => {
    const stage = stageSql();
    const staged = stagedReinstateTables().map((t) => t.name);
    // The evidence table admits exactly the staged tables, once each.
    expect(stage).toContain(`staged_table text PRIMARY KEY CHECK (staged_table IN (${staged.map((t) => `'${t}'`).join(', ')})),`);
    // The recorder takes the name from the trigger's own table and refuses anything but a staged COPY.
    expect(stage).toContain('SELECT TG_TABLE_NAME, count(*) FROM restored;');
    expect(stage).toContain("IF TG_TABLE_SCHEMA <> 'promotion_staging' OR TG_OP <> 'INSERT' OR TG_LEVEL <> 'STATEMENT' THEN");
    for (const table of staged) {
      expect(stageCompletionTriggerSql(table))
        .toContain(`AFTER INSERT ON ${S}."${table}" REFERENCING NEW TABLE AS restored FOR EACH STATEMENT`);
    }
    // One table's evidence never vouches for another: the lookup is keyed by the table's own name.
    const promote = promoteStagedSql();
    for (const table of staged) {
      expect(runPromoteBlock(promote, table, { stagedRows: 0 }))
        .toEqual({ outcome: 'REFUSE', message: stageEvidenceMissingMessage(table) });
      expect(promoteBlockOf(promote, table)).toContain(`c.staged_table = '${table}';`);
    }
    const good = generatedPlanArtifacts('dev');
    const problems = (bad: Partial<typeof good>) => stagedPlanProblems({ ...good, ...bad }, 'dev');
    expect(problems({})).toEqual([]);
    // A trigger retargeted onto a sibling leaves its own table without one.
    expect(problems({ stage: good.stage.replace(`ON ${S}."${AFL}" REFERENCING`, `ON ${S}."${GRID}" REFERENCING`) }))
      .toContain(`staged table ${AFL} carries no stage-completion trigger in promotion-stage.sql`);
    // A promotion that reads a sibling's evidence for this table.
    expect(problems({ promoteStaged: good.promoteStaged.replace(`c.staged_table = '${AFL}';`, `c.staged_table = '${GRID}';`) }))
      .toContain(`promotion-promote-staged.sql does not demand stage-completion evidence for ${AFL}`);
    // A CHECK widened to admit an unrelated table.
    expect(problems({ stage: good.stage.replace(`IN ('${AFL}',`, `IN ('auth_users', '${AFL}',`) }))
      .toContain('promotion-stage.sql does not create one stage-completion table admitting exactly the staged tables');
    // A recorder that writes a literal name instead of its trigger's table.
    expect(problems({ stage: good.stage.replace('SELECT TG_TABLE_NAME, count(*)', `SELECT '${AFL}', count(*)`) }))
      .toContain("promotion-stage.sql does not create the stage-completion recorder from the trigger's own table");
    // Nothing but the trigger writes evidence, and nothing removes a trigger.
    const forged = `INSERT INTO ${S}."${STAGE_COMPLETION_TABLE}" (staged_table, restored_rows) VALUES ('${AFL}', 0);`;
    expect(problems({ promoteStaged: good.promoteStaged.replace('BEGIN;', `BEGIN;\n${forged}`) }))
      .toContain('promoteStaged writes stage-completion evidence directly');
    expect(problems({ reinstate: `${good.reinstate}psql "$CANDIDATE_DSN" -c "INSERT INTO promotion_staging.${STAGE_COMPLETION_TABLE} VALUES ('${AFL}', 0)"\n` }))
      .toContain('reinstate writes stage-completion evidence directly');
    expect(problems({ reinstate: `${good.reinstate}psql "$CANDIDATE_DSN" -c 'DROP TRIGGER ${STAGE_COMPLETION_FUNCTION} ON promotion_staging.${AFL}'\n` }))
      .toContain('reinstate removes or alters a stage-completion trigger');
    expect(lineageRemapProblems(`BEGIN;\n${forged}\nCOMMIT;\n`, [], 'dev'))
      .toEqual([`remap touches the stage-completion evidence promotion_staging.${STAGE_COMPLETION_TABLE}`]);
  });

  it('the generated transcript records stage evidence in the correct order', () => {
    for (const environment of ENVIRONMENTS) {
      const { stage, promoteStaged: promote, reinstate: plan } = generatedPlanArtifacts(environment);
      const staged = stagedReinstateTables(environment).map((t) => t.name);
      const at = (text: string, needle: string) => {
        const i = text.indexOf(needle);
        expect(i, needle).toBeGreaterThanOrEqual(0);
        return i;
      };
      const ascending = (xs: number[]) => xs.slice().sort((a, b) => a - b);
      // promotion-stage.sql: schema -> copies -> evidence table -> recorder -> one trigger per copy -> COMMIT.
      const stageOrder = [
        at(stage, `CREATE SCHEMA ${S};`),
        ...staged.map((t) => at(stage, `CREATE TABLE ${S}."${t}" (LIKE "public"."${t}");`)),
        at(stage, `CREATE TABLE ${S}."${STAGE_COMPLETION_TABLE}" (`),
        at(stage, `CREATE FUNCTION ${S}."${STAGE_COMPLETION_FUNCTION}"() RETURNS trigger`),
        ...staged.map((t) => at(stage, stageCompletionTriggerSql(t))),
        at(stage, '\nCOMMIT;'),
      ];
      expect(stageOrder).toEqual(ascending(stageOrder));
      // The transcript: stage -> (restore -> grep guard -> single-transaction load) per table -> remap -> promote.
      const planOrder = [at(plan, '-f promotion-stage.sql')];
      for (const t of staged) {
        planOrder.push(
          at(plan, `--table=${t} -f - `),
          at(plan, `grep -q '^COPY promotion_staging.${t} (' promotion-stage-${t}.sql`),
          at(plan, `psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 --single-transaction -f promotion-stage-${t}.sql`),
        );
      }
      planOrder.push(at(plan, '-f "$LINEAGE_REMAP_SQL"'), at(plan, '-f promotion-promote-staged.sql'));
      expect(planOrder).toEqual(ascending(planOrder));
      expect(plan).toContain('stage-completion trigger');
      expect(plan).not.toContain(STAGE_COMPLETION_TABLE);
      // promotion-promote-staged.sql, per table: evidence lookup -> missing refusal -> count
      // check -> emptiness decision -> INSERT.
      for (const t of staged) {
        const block = promoteBlockOf(promote, t);
        const order = [
          at(block, `c.staged_table = '${t}';`), at(block, 'IF NOT FOUND THEN'), at(block, 'IF staged_rows <> evidenced_rows THEN'),
          at(block, 'IF staged_rows = 0 THEN'), at(block, `INSERT INTO "public"."${t}"`),
        ];
        expect(order, t).toEqual(ascending(order));
      }
      expect(stagedPlanProblems({ stage, promoteStaged: promote, reinstate: plan }, environment)).toEqual([]);
      // A trigger created after COMMIT is refused.
      const late = stage.replace(`${stageCompletionTriggerSql(AFL)}\n`, '').replace('\nCOMMIT;', `\nCOMMIT;\n${stageCompletionTriggerSql(AFL)}`);
      expect(late).not.toBe(stage);
      expect(stagedPlanProblems({ stage: late, promoteStaged: promote, reinstate: plan }, environment))
        .toContain(`staged table ${AFL} carries no stage-completion trigger in promotion-stage.sql`);
    }
  });

  it('a completed promotion removes every staging and evidence object, and nothing cascades', () => {
    for (const environment of ENVIRONMENTS) {
      const { stage, promoteStaged: promote, reinstate } = generatedPlanArtifacts(environment);
      const staged = stagedReinstateTables(environment).map((t) => t.name);
      // Every relation and function promotion-stage.sql creates is dropped by the promotion;
      // each trigger rides the staging copy it is ON, which is dropped with it.
      const created = [...stage.matchAll(/CREATE (TABLE|FUNCTION) ("promotion_staging"\."[a-z_]+")/g)].map((m) => `${m[1]} ${m[2]}`);
      expect(created).toEqual([
        ...staged.map((t) => `TABLE ${S}."${t}"`), `TABLE ${S}."${STAGE_COMPLETION_TABLE}"`, `FUNCTION ${S}."${STAGE_COMPLETION_FUNCTION}"`,
      ]);
      const drops = created.map((c) => {
        const [kind, name] = c.split(' ');
        return promote.indexOf(kind === 'FUNCTION' ? `DROP FUNCTION ${name}();` : `DROP TABLE ${name};`);
      });
      for (const [i, d] of drops.entries()) expect(d, created[i]).toBeGreaterThan(0);
      const tail = [...drops, promote.indexOf(`DROP SCHEMA ${S};`), promote.lastIndexOf('COMMIT;')];
      expect(tail).toEqual(tail.slice().sort((a, b) => a - b));
      for (const t of staged) expect(stageCompletionTriggerSql(t)).toContain(`ON ${S}."${t}" `);
      expect(promote).not.toMatch(/\bCASCADE\b|IF\s+EXISTS/i);
      // The validator refuses a promotion that leaves the evidence or its recorder behind.
      for (const leftover of [`DROP TABLE ${S}."${STAGE_COMPLETION_TABLE}";\n`, `DROP FUNCTION ${S}."${STAGE_COMPLETION_FUNCTION}"();\n`]) {
        expect(stagedPlanProblems({ stage, reinstate, promoteStaged: promote.replace(leftover, '') }, environment), leftover)
          .toContain('promotion-promote-staged.sql does not drop the stage-completion evidence after the last promotion and before the schema');
      }
    }
  });

  it('candidate/production count comparisons are not weakened', () => {
    for (const environment of ENVIRONMENTS) {
      for (const t of stagedReinstateTables(environment)) expect(effectiveCompare(t, environment), t.name).toBe('equal');
    }
    const key = `public.${AFL}`;
    const snapshot = (n: number): Snapshot => ({
      issue: 'AFLDB-ISSUE-125', database: 'afldb_dev', takenAt: 't', counts: { [key]: n }, superAdmins: 1, fixtureRows: 0,
    });
    const judge = (before: number, after: Record<string, number>) =>
      compareCounts(snapshot(before), [{ table: key, rule: 'equal' }], after)[0];
    expect(judge(0, { [key]: 0 })).toMatchObject({ ok: true, detail: 'reinstated in full' });
    expect(judge(0, { [key]: 1 }).ok).toBe(false);
    expect(judge(3, { [key]: 0 }).ok).toBe(false);
    expect(judge(0, {}).ok).toBe(false);
  });

  it('the operator documentation carries the mechanism', () => {
    const doc = readFileSync(join(REPO, 'docs', 'production-promotion.md'), 'utf8');
    for (const needle of ['AFLDB-ISSUE-247', 'stagedMayBeEmpty', STAGE_COMPLETION_TABLE, 'stage-completion evidence']) {
      expect(doc, needle).toContain(needle);
    }
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
    // The only files it writes are the counts snapshot, the operator plan, and — through the one
    // atomic no-clobber writer — the AFLDB-ISSUE-142 lineage remap (AFLDB-ISSUE-237 L4: only on a
    // fully passing run), the AFLDB-ISSUE-237 E_promotion file and the DEV regeneration proposal.
    // All are read and run by hand; none is a database write.
    expect((source.match(/writeFileSync\(/g) ?? []).length).toBe(3);
  });

  it('never prints a DSN: the target line names the variable and the database only', () => {
    expect(source).toMatch(/via \$\{opts\.dsnEnv\}/);
    expect(source).not.toMatch(/console\.log\([^)]*\bdsn\b/);
  });
});

/**
 * AFLDB-ISSUE-237 §6.2/§6.3 — G1/G2/G3 wiring: which phase calls which gate, in what order,
 * pinned from the source text the same way the read-only proof above pins the checker's own
 * shape. `main()`'s body is not exported, so its CONTRACT ("this phase calls this gate") is
 * proven the same way `gateLineageIdentity`'s own dispatch is: order of appearance in the file.
 */
describe('AFLDB-ISSUE-237 — G1/G2/G3 wiring order (source-pinned, DB-free)', () => {
  const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
  const main = source.slice(source.indexOf('async function main('));

  it('G1 runs at --phase source; the candidate phase runs the bound after-reinstatement G1 (F-L4-3)', () => {
    expect(main).toMatch(/if \(phase === 'source'\) await gateAflApiG1\(conn\.q, report\)/);
    expect(main).toMatch(/if \(phase === 'candidate'\) \{\s*await gateAflApiCandidateAfterReinstate\(conn\.q, boundSupersede!/);
    // the bound file is read (and refused if bad) before any database is opened
    const readAt = main.indexOf('readAflApiSupersedeFile(opts.aflApiSupersedeIn!)');
    expect(readAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(main.indexOf('let aflApiOverlap'));
  });

  it('the pre-cutover target census runs only at --phase pre-cutover, before the snapshot is built', () => {
    const censusAt = main.indexOf('aflApiTargetCensus = await gateAflApiPreCutoverCensus(conn.q, report)');
    const markerAt = main.indexOf('await gateAflApiRebuildMarker([{ role: `target ${opts.database}`, q: conn.q }], report)');
    expect(markerAt).toBeGreaterThan(main.indexOf("if (phase === 'pre-cutover') {"));
    expect(markerAt).toBeLessThan(censusAt);
    const snapshotAt = main.indexOf('const snapshot: Snapshot');
    expect(censusAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeGreaterThan(censusAt);
    expect(main).toMatch(/counts, superAdmins, fixtureRows: fixtures, aflApiTargetCensus/);
  });

  it('G2/G3 (gateAflApiOverlap) run only inside the --phase restored branch, after the lineage-identity gate', () => {
    const restoredBranch = main.slice(main.indexOf("if (phase === 'restored') {"), main.indexOf("if (opts.compare)"));
    expect(restoredBranch).toContain('gateAflApiOverlap(');
    expect(restoredBranch.indexOf('gateLineageIdentity(')).toBeLessThan(restoredBranch.indexOf('gateAflApiOverlap('));
  });

  it("dev-regeneration-census is a standalone early branch, never reaching the standard gate pipeline", () => {
    const branchAt = main.indexOf("if (phase === 'dev-regeneration-census')");
    const reportAt = main.indexOf('const report = new Report();');
    expect(branchAt).toBeGreaterThan(-1);
    // The branch's own `return` happens before the standard pipeline's `gateClassification`,
    // `gateStagingLeftover`, `gateMigrationParity`, `gateFixtureIdentities` and `gateSuperAdmin`
    // calls -- none of those names appear between the branch and its own early return.
    const branchBody = main.slice(branchAt, main.indexOf('const report = new Report();', reportAt + 1));
    for (const other of ['gateStagingLeftover', 'gateMigrationParity', 'gateFixtureIdentities', 'gateSuperAdmin', 'gateInventory']) {
      expect(branchBody).not.toContain(other);
    }
  });

  it('production never reads a DEV regeneration classification file (D14: no general WARN)', () => {
    const overlapFn = source.slice(source.indexOf('async function gateAflApiOverlap'), source.indexOf('async function runAflApiDevRegenerationCensus'));
    expect(overlapFn).toMatch(/environment === 'dev' && devRegenerationPath/);
  });
});

/**
 * AFLDB-ISSUE-237 continuity amendment (2026-09-25): the promotion checker's forward lookup
 * and the rebuild/recovery reader must return exactly the same answer for the same rows — both
 * delegate to the one shared classifier over the same validated fitzRoy contract.
 */
describe('AFLDB-ISSUE-237 continuity — promotion and rebuild forward identity agree (DB-free)', () => {
  const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
  const rule = loadFitzroyProfileContinuityRules()[0];
  const OTHER = 'players/Z/Unrelated_Profile.html';
  const rows = [
    { playerId: 1, externalId: 'players/A/Alpha_Only.html', sourceKey: 'afltables' },
    { playerId: 2, externalId: rule.renumberedUrl, sourceKey: 'afltables' },
    { playerId: 2, externalId: rule.continuingUrl, sourceKey: 'afltables' },
    { playerId: 3, externalId: rule.continuingUrl, sourceKey: 'afltables' },
    { playerId: 3, externalId: OTHER, sourceKey: 'afltables' },
    { playerId: 4, externalId: rule.renumberedUrl, sourceKey: 'afltables' },
    { playerId: 4, externalId: OTHER, sourceKey: 'afltables' },
    { playerId: 5, externalId: rule.continuingUrl, sourceKey: 'afltables' },
    { playerId: 5, externalId: rule.renumberedUrl, sourceKey: 'afltables' },
    { playerId: 5, externalId: OTHER, sourceKey: 'afltables' },
    { playerId: 6, externalId: rule.continuingUrl, sourceKey: 'afltables' },
    { playerId: 6, externalId: rule.renumberedUrl, sourceKey: 'afltables' },
    { playerId: 6, externalId: 'manual-token-6', sourceKey: 'manual_admin_edit' },
    { playerId: 7, externalId: 'manual-token-7', sourceKey: 'manual_admin_edit' },
  ];
  const playerIds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('both readers return the identical map, with the exact pair folded to continuing_url', async () => {
    // postgres.js returns the promotion reader's bigint player ids as strings
    const promotionQ = async () => rows.map((r) => ({ ...r, playerId: String(r.playerId) }));
    const rebuildTx = Object.assign(async () => rows, { array: (values: unknown[]) => values }) as unknown as TransactionSql;
    const promotion = await readPromotionForwardIdentities(promotionQ, playerIds);
    const rebuild = await readRebuildForwardIdentities(rebuildTx, playerIds);
    expect([...promotion.entries()]).toEqual([...rebuild.entries()]);
    expect([...promotion.entries()]).toEqual([
      [1, { ok: true, identity: 'players/A/Alpha_Only.html', via: 'afltables' }],
      [2, { ok: true, identity: rule.continuingUrl, via: 'afltables' }],
      [3, { ok: false, reason: 'ambiguous' }],
      [4, { ok: false, reason: 'ambiguous' }],
      [5, { ok: false, reason: 'ambiguous' }],
      [6, { ok: true, identity: rule.continuingUrl, via: 'afltables' }],
      [7, { ok: true, identity: 'manual-token-7', via: 'manual_admin_edit' }],
      [8, { ok: false, reason: 'no_identity' }],
    ]);
  });

  it('the promotion checker keeps no private classification: it delegates to the shared classifier and loader', () => {
    const fn = source.slice(source.indexOf('export async function readAflApiForwardIdentities('),
      source.indexOf('async function readAflApiLedgerRowCount('));
    expect(fn).toContain('classifyAflApiForwardIdentityRows({');
    expect(fn).toContain('= loadFitzroyProfileContinuityRules()');
    expect(fn).not.toMatch(/afltables\.length|reason: 'ambiguous'/);
  });
});

/**
 * AFLDB-ISSUE-237 continuity amendment, REVERSE direction (2026-09-25 tightening): a tracked
 * rule's identity resolves on a target only when both rule paths name the same single player.
 * The promotion checker's G2 reader and the replay adapter's `resolveAflApiPlayerIdentity`
 * (Stage 18, D15, R4) must classify every target state identically — both delegate to
 * `classifyAflApiReverseIdentity` — and a split candidate must FAIL G2.
 */
describe('AFLDB-ISSUE-237 continuity — promotion and replay reverse identity agree; a split target refuses (DB-free)', () => {
  const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
  const rule = loadFitzroyProfileContinuityRules()[0];
  const PLAIN = 'players/Z/Unrelated_Profile.html';
  type Held = { identity: string; playerId: number }[];

  /** The promotion reader's Query, answering its one ANY($1) statement from `held`. */
  const promotionQ = (held: Held) => async (_text: string, params?: unknown[]) => {
    const paths = (params?.[0] ?? []) as string[];
    // DISTINCT (identity, player), and bigint player ids come back as strings
    const seen = new Set<string>();
    return held.filter((h) => paths.includes(h.identity))
      .filter((h) => !seen.has(`${h.identity}|${h.playerId}`) && seen.add(`${h.identity}|${h.playerId}`))
      .map((h) => ({ identity: h.identity, playerId: String(h.playerId) }));
  };
  /** The replay adapter's tx, answering its per-path statement from the SAME `held`. */
  const replayTx = (held: Held) => Object.assign(
    async (_strings: TemplateStringsArray, path: string) =>
      [...new Set(held.filter((h) => h.identity === path).map((h) => h.playerId))].map((playerId) => ({ playerId })),
    { array: (values: unknown[]) => values },
  ) as unknown as TransactionSql;

  const states: [string, Held][] = [
    ['folded pair', [{ identity: rule.continuingUrl, playerId: 7 }, { identity: rule.renumberedUrl, playerId: 7 }]],
    ['split pair', [{ identity: rule.continuingUrl, playerId: 7 }, { identity: rule.renumberedUrl, playerId: 8 }]],
    ['continuing missing', [{ identity: rule.renumberedUrl, playerId: 7 }]],
    ['renumbered missing', [{ identity: rule.continuingUrl, playerId: 7 }]],
    ['continuing ambiguous', [
      { identity: rule.continuingUrl, playerId: 7 }, { identity: rule.continuingUrl, playerId: 9 },
      { identity: rule.renumberedUrl, playerId: 7 }]],
    ['renumbered ambiguous', [
      { identity: rule.continuingUrl, playerId: 7 }, { identity: rule.renumberedUrl, playerId: 7 },
      { identity: rule.renumberedUrl, playerId: 9 }]],
    ['plain single', [{ identity: PLAIN, playerId: 3 }, { identity: rule.continuingUrl, playerId: 7 }, { identity: rule.renumberedUrl, playerId: 8 }]],
    ['plain ambiguous', [{ identity: PLAIN, playerId: 3 }, { identity: PLAIN, playerId: 4 }]],
    ['nothing held', []],
  ];

  it('(12) both implementations return the identical classification for every target state', async () => {
    const identities = [rule.continuingUrl, rule.renumberedUrl, PLAIN];
    const outcomes: Record<string, unknown> = {};
    for (const [name, held] of states) {
      const promotion = await readPromotionReverseIdentities(promotionQ(held), identities);
      for (const identity of identities) {
        const replay = await resolveAflApiPlayerIdentity(replayTx(held), identity);
        expect(promotion.get(identity), `${name}: ${identity}`).toEqual(replay);
      }
      outcomes[name] = promotion.get(rule.continuingUrl);
    }
    // and what they agree on is the required rule
    expect(outcomes['folded pair']).toEqual({ ok: true, newPlayerId: 7, remappedIdentity: rule.continuingUrl });
    for (const [name, refusal] of [
      ['split pair', 'split'], ['continuing missing', 'continuing_missing'], ['renumbered missing', 'renumbered_missing'],
      ['continuing ambiguous', 'continuing_ambiguous'], ['renumbered ambiguous', 'renumbered_ambiguous'],
    ] as const) {
      expect(outcomes[name], name).toMatchObject({ ok: false, reason: 'continuity_contradiction', ruleId: rule.id, refusal });
    }
    const plain = async (held: Held) => (await readPromotionReverseIdentities(promotionQ(held), [PLAIN])).get(PLAIN);
    expect(await plain(states[6][1])).toEqual({ ok: true, newPlayerId: 3, remappedIdentity: PLAIN });
    expect(await plain(states[7][1])).toEqual({ ok: false, reason: 'ambiguous' });
    expect(await plain([])).toEqual({ ok: false, reason: 'unresolvable' });
  });

  it('(11) the promotion check refuses a split candidate: G2 grades the ledger entry CONTINUITY_CONTRADICTION, never AGREE', async () => {
    const split = (await readPromotionReverseIdentities(promotionQ(states[1][1]), [rule.continuingUrl])).get(rule.continuingUrl)!;
    expect(split.ok).toBe(false);
    // the exact entry gateAflApiOverlap builds, with and without a candidate importer row
    for (const candidateRow of [null, {
      status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', candidateCount: 1, externalUrl: null,
      playerId: 7, playerIdentity: rule.continuingUrl,
    }]) {
      const grades = classifyAflApiG2([{
        externalId: 'CD_I1', ledgerNetAction: 'linked', identityIsManualToken: false, candidateRow,
        remappedCandidatePlayerId: null, collidingProviderId: null,
        continuityContradiction: split as AflApiContinuityContradiction,
      }]);
      expect(grades).toEqual([{ externalId: 'CD_I1', outcome: 'CONTINUITY_CONTRADICTION', reason: expect.stringContaining(
        `rule ${rule.id} and the target contradicts it: its continuing_url and renumbered_url resolve to different target players`) }]);
      expect(aflApiG2AgreeSet(grades).size).toBe(0);
    }
  });

  it('gateAflApiOverlap wires G2 through the shared reverse reader and FAILS on a contradiction', () => {
    const overlap = source.slice(source.indexOf('export async function evaluateAflApiG2'), source.indexOf('async function runAflApiDevRegenerationCensus'));
    expect(overlap).toContain('await readAflApiReverseIdentities(sides.candidate, identities)');
    expect(overlap).toContain("continuityContradiction: remap?.ok === false && remap.reason === 'continuity_contradiction' ? remap : null");
    expect(overlap).toMatch(/g2Failed = grades\.some\(\(g\) => AFL_API_G2_REFUSING_OUTCOMES\.has\(g\.outcome\)\)/);
    expect(AFL_API_G2_REFUSING_OUTCOMES.has('CONTINUITY_CONTRADICTION')).toBe(true);
    // no private reverse classification left in the gate
    expect(overlap).not.toMatch(/remapped\.length === 1/);
    const reader = source.slice(source.indexOf('export async function readAflApiReverseIdentities('),
      source.indexOf('function aflApiRowsToG3('));
    expect(reader).toContain('classifyAflApiReverseIdentity({');
    expect(reader).toContain('aflApiReverseIdentityPaths(');
    expect(reader).toContain('= loadFitzroyProfileContinuityRules()');
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

/**
 * AFLDB-ISSUE-237 L4 hardening (2026-09-25): F-L4-1 (marker read), F-L4-2 (G2 database roles),
 * F-L4-3 (candidate-phase ledger), F-L4-4 (bound E_promotion file + post-swap D15 refusal),
 * F-L4-5 (DEV regeneration generator) and F-L4-6 (documentation), each driven through the
 * checker's real gate functions against in-memory databases. DB-free.
 */
describe('AFLDB-ISSUE-237 L4 hardening — promotion afl_api gates (DB-free)', () => {
  type FakeIdentity = { playerId: number; externalId: string; sourceKey: 'afltables' | 'manual_admin_edit' };
  type FakeDb = {
    /** The DATABASE comment (pg_shdescription). */
    comment: string | null;
    /** A comment on some other object in the per-database pg_description. */
    objectComment: string | null;
    afl: AflApiCensusRow[];
    ids: FakeIdentity[];
    ledger: AflApiAdjudicationLedgerRow[];
    log: string[];
  };
  const fakeDb = (over: Partial<FakeDb> = {}): FakeDb => ({
    comment: null, objectComment: null, afl: [], ids: [], ledger: [], log: [], ...over,
  });
  /** Answers exactly the statements the checker's afl_api readers issue; anything else throws. */
  const fakeQ = (db: FakeDb): Query => async (text, params = []) => {
    db.log.push(text);
    if (text.includes('shobj_description(')) return [{ comment: db.comment }];
    if (text.includes('obj_description(')) return [{ comment: db.objectComment }];
    if (text.includes("FROM sources WHERE key = 'afl_api'")) return [{ id: 1 }];
    if (text.includes('FROM external_identities WHERE source_id = $1')) return db.afl.map((r) => ({ ...r }));
    if (text.includes('count(*)::int AS n FROM afl_api_identity_adjudications')) return [{ n: db.ledger.length }];
    if (text === AFL_API_LEDGER_ROWS_SQL) {
      // bigint columns arrive as strings from postgres.js
      return [...db.ledger].sort((a, b) => a.id - b.id).map((r) => ({
        ...r, id: String(r.id), supersedesId: r.supersedesId === null ? null : String(r.supersedesId),
      }));
    }
    if (text.includes('"manualIdentity"')) {
      const wanted = params[0] as string[];
      return [...new Set(db.ids.filter((i) => i.sourceKey === 'manual_admin_edit' && wanted.includes(i.externalId))
        .map((i) => i.externalId))].map((manualIdentity) => ({ manualIdentity }));
    }
    if (text.includes('ei.player_id = ANY')) {
      const wanted = (params[0] as unknown[]).map(Number);
      return db.ids.filter((i) => wanted.includes(i.playerId))
        .map((i) => ({ playerId: String(i.playerId), externalId: i.externalId, sourceKey: i.sourceKey }));
    }
    if (text.includes('ei.external_id = ANY')) {
      const wanted = params[0] as string[];
      const seen = new Set<string>();
      return db.ids.filter((i) => wanted.includes(i.externalId))
        .filter((i) => !seen.has(`${i.externalId}|${i.playerId}`) && seen.add(`${i.externalId}|${i.playerId}`))
        .map((i) => ({ identity: i.externalId, playerId: String(i.playerId) }));
    }
    throw new Error(`fake database: unexpected SQL ${text}`);
  };

  const importer = (externalId: string, playerId: number, matchMethod = 'afl_api_stat_vector_season'): AflApiCensusRow => ({
    externalId, status: 'unique', matchMethod, playerId, candidateCount: 1, externalUrl: null,
  });
  const human = (externalId: string, playerId: number): AflApiCensusRow => ({
    externalId, status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId, candidateCount: 0, externalUrl: null,
  });
  const at = (playerId: number, externalId: string): FakeIdentity => ({ playerId, externalId, sourceKey: 'afltables' });
  const linked = (id: number, externalId: string, playerId: number, playerIdentity: string): AflApiAdjudicationLedgerRow => ({
    id, externalId, action: 'linked', playerId, playerIdentity, supersedesId: null,
  });
  const path = (key: string) => `players/${key}/${key}_Player.html`;
  const [A, B, C, D, E, F, Z] = ['A', 'B', 'C', 'D', 'E', 'F', 'Z'].map(path);
  const MARKER = JSON.stringify({ format: AFL_API_REBUILD_MARKER_FORMAT, version: 2, capturedAt: 'x', payloadSha256: 'a'.repeat(64), fileSha256: 'b'.repeat(64) });
  const CAND = 'afldb_dev_candidate_20260925-120000';
  const NAMES = { candidateDatabase: CAND, targetDatabase: 'afldb_dev' };

  /** The rebuilt candidate at --phase restored: rebuilt player ids, importer rows, NO ledger (source lineage). */
  const candidateAtRestored = (over: Partial<FakeDb> = {}) => fakeDb({
    ids: [at(10, A), at(11, B), at(12, C), at(13, D), at(14, E)],
    afl: [importer('CD_I1', 10), importer('CD_I2', 11, 'afl_api_stat_vector_bootstrap')],
    ...over,
  });
  /** DEV (the target): its own player ids, one human adjudication over CD_I1, an importer row CD_I2. */
  const devTarget = (over: Partial<FakeDb> = {}) => fakeDb({
    ids: [at(900, A), at(901, B), at(902, C), { playerId: 903, externalId: 'manual-token-903', sourceKey: 'manual_admin_edit' }],
    afl: [human('CD_I1', 900), importer('CD_I2', 901, 'afl_api_stat_vector_bootstrap')],
    ledger: [linked(7, 'CD_I1', 900, A)],
    ...over,
  });
  /** The candidate after the promotion plan reinstated DEV's ledger (player_id remapped 900 -> 10). */
  const candidateAfterReinstate = (over: Partial<FakeDb> = {}) => candidateAtRestored({
    ledger: [linked(7, 'CD_I1', 10, A)], ...over,
  });

  const restored = async (candidate: FakeDb, target: FakeDb, devRegenerationPath?: string) => {
    const report = new Report();
    const overlap = await gateAflApiOverlap(
      { candidate: fakeQ(candidate), target: fakeQ(target) }, NAMES, 'dev', devRegenerationPath, report);
    return { report, overlap };
  };
  const verdictOf = (report: Report, gate: string) => report.results.find((r) => r.gate.includes(gate))?.verdict;

  let dir: string;
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), 'afldb-issue237-l4-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  // --- F-L4-1 ----------------------------------------------------------------------------------

  it('F-L4-1 — reads the DATABASE comment with shobj_description, the rebuild lifecycle\'s own statement', () => {
    const checker = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    const rebuild = readFileSync(join(REPO, 'tools', 'migration', 'rebuild_afl_api_adjudications.ts'), 'utf8');
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
    expect(squash(rebuild)).toContain(squash(DATABASE_COMMENT_SQL));
    expect(DATABASE_COMMENT_SQL).toContain("shobj_description(oid, 'pg_database')");
    // no per-database obj_description() read survives anywhere in the checker
    expect(checker).not.toMatch(/(?<!sh)obj_description\(/);
    // the tag the checker recognises is the rebuild's own CAPTURE_FORMAT
    expect(rebuild).toContain(`export const CAPTURE_FORMAT = '${AFL_API_REBUILD_MARKER_FORMAT}';`);
  });

  it('F-L4-1 (a/b/c) — marker present FAILS, marker absent PASSES, an unrelated object comment is not the marker', async () => {
    expect(await readRebuildMarkerPresent(fakeQ(fakeDb({ comment: MARKER })))).toBe(true);
    expect(await readRebuildMarkerPresent(fakeQ(fakeDb()))).toBe(false);
    expect(await readRebuildMarkerPresent(fakeQ(fakeDb({ objectComment: MARKER })))).toBe(false);
    expect(await readRebuildMarkerPresent(fakeQ(fakeDb({ comment: 'a DBA note, not a marker' })))).toBe(false);

    const source = (over: Partial<FakeDb>) => candidateAtRestored({ ids: [at(10, A), at(11, B)], ...over });
    for (const [over, verdict] of [[{ comment: MARKER }, 'FAIL'], [{}, 'PASS'], [{ objectComment: MARKER }, 'PASS']] as const) {
      const report = new Report();
      await gateAflApiG1(fakeQ(source(over)), report);
      expect(report.results[0].verdict, JSON.stringify(over)).toBe(verdict);
      if (verdict === 'FAIL') expect(report.results[0].lines.join('\n')).toContain('rebuild_marker_present');
    }

    // pre-cutover (target) and restored (candidate + target) phases
    for (const [dbs, verdict] of [
      [[fakeDb({ comment: MARKER })], 'FAIL'],
      [[fakeDb(), fakeDb({ comment: MARKER })], 'FAIL'],
      [[fakeDb({ objectComment: MARKER }), fakeDb()], 'PASS'],
    ] as const) {
      const report = new Report();
      await gateAflApiRebuildMarker(dbs.map((db, i) => ({ role: `db${i}`, q: fakeQ(db) })), report);
      expect(report.results[0].verdict).toBe(verdict);
    }

    // candidate phase
    const target = devTarget();
    const { overlap } = await restored(candidateAtRestored(), target);
    const bound = aflApiSupersedeFileFor(overlap, { environment: 'dev', ...NAMES });
    for (const [over, verdict] of [[{ comment: MARKER }, 'FAIL'], [{ objectComment: MARKER }, 'PASS']] as const) {
      const report = new Report();
      await gateAflApiCandidateAfterReinstate(fakeQ(candidateAfterReinstate(over)), bound, { environment: 'dev', ...NAMES }, report);
      expect(report.results[0].verdict).toBe(verdict);
    }
  });

  // --- F-L4-2 ----------------------------------------------------------------------------------

  it('F-L4-2 — importer rows from the CANDIDATE, the human ledger from the TARGET: E_promotion is the AGREE set', async () => {
    const candidate = candidateAtRestored();
    const target = devTarget();
    const { report, overlap } = await restored(candidate, target);
    expect(report.failed).toBe(false);
    expect([...overlap.ePromotion]).toEqual(['CD_I1']);
    expect(verdictOf(report, 'G2')).toBe('PASS');
    expect(verdictOf(report, 'G3')).toBe('PASS');
    // the roles, proven from what each database was actually asked
    expect(target.log).toContain(AFL_API_LEDGER_ROWS_SQL);
    expect(candidate.log).not.toContain(AFL_API_LEDGER_ROWS_SQL);
    expect(candidate.log.some((t) => t.includes('ei.external_id = ANY') && !t.includes('"manualIdentity"'))).toBe(true);
    expect(target.log.some((t) => t.includes('ei.external_id = ANY') && !t.includes('"manualIdentity"'))).toBe(false);

    // the pre-fix wiring — both sides read from the candidate — is exactly the vacuous E = ∅
    const wrong = await evaluateAflApiG2({ candidate: fakeQ(candidateAtRestored()), humanLedger: fakeQ(candidateAtRestored()), manualTokenSides: [] });
    expect(wrong.ePromotion.size).toBe(0);
  });

  it('F-L4-2 — the restored gate is wired with explicit roles, and matches no name and no cross-lineage player id', () => {
    const checker = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    const main = checker.slice(checker.indexOf('async function main('));
    expect(main).toContain('{ candidate: conn.q, target: old.q }');
    const overlap = checker.slice(checker.indexOf('export async function gateAflApiOverlap('), checker.indexOf('export function aflApiSupersedeFileFor('));
    expect(overlap).toContain('candidate: sides.candidate, humanLedger: sides.target, manualTokenSides: [sides.target, sides.candidate]');
    expect(overlap).not.toMatch(/humanLedger: sides\.candidate/);
    const g2 = checker.slice(checker.indexOf('export async function evaluateAflApiG2('), checker.indexOf('function g2Lines('));
    expect(g2).not.toMatch(/external_name|display_name|surname|given_name|\.name\b/);
    // the only player id compared is the candidate's own remap against the candidate's own row
    expect(g2).not.toMatch(/\bledger\w*\.playerId\b|\bentry\.playerId\b/);
  });

  it('F-L4-2 — every prohibited G2 classification STOPS before the swap, and leaves no E_promotion file', async () => {
    const rule = loadFitzroyProfileContinuityRules()[0];
    const cases: [string, Partial<FakeDb>, Partial<FakeDb>, string][] = [
      ['DISAGREE', {}, { ledger: [linked(8, 'CD_I2', 902, C)] }, 'DISAGREE'],
      ['COLLISION', {}, { ledger: [linked(9, 'CD_I9', 900, A)] }, 'COLLISION'],
      ['UNEVALUABLE (a DEV manual token, known only to the TARGET)', {}, { ledger: [linked(10, 'CD_I8', 903, 'manual-token-903')] }, 'UNEVALUABLE'],
      ['UNRESOLVED (unresolvable)', {}, { ledger: [linked(11, 'CD_I7', 900, Z)] }, 'UNRESOLVED'],
      ['UNRESOLVED (ambiguous)', { ids: [at(10, A), at(11, B), at(12, C), at(15, C)] }, { ledger: [linked(12, 'CD_I6', 902, C)] }, 'UNRESOLVED'],
      ['CONTINUITY_CONTRADICTION', { ids: [at(10, A), at(11, B), at(20, rule.continuingUrl), at(21, rule.renumberedUrl)] },
        { ledger: [linked(13, 'CD_I5', 900, rule.continuingUrl)] }, 'CONTINUITY_CONTRADICTION'],
    ];
    for (const [name, candidateOver, targetOver, outcome] of cases) {
      const { report, overlap } = await restored(candidateAtRestored(candidateOver), devTarget(targetOver));
      expect(verdictOf(report, 'G2'), name).toBe('FAIL');
      expect(report.results.find((r) => r.gate.includes('G2'))!.lines.join('\n'), name).toContain(`: ${outcome}`);
      expect(AFL_API_G2_REFUSING_OUTCOMES.has(outcome as never), name).toBe(true);
      const out = join(dir, `e-${outcome}-${Math.random()}.json`);
      publishRestoredAflApiFiles(parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', CAND,
        '--old-database', 'afldb_dev', '--afl-api-supersede-out', out]), overlap, report);
      expect(readdirSync(dir).filter((f) => f.startsWith('e-')), name).toEqual([]);
      expect(verdictOf(report, 'E_promotion file NOT written'), name).toBe('INFO');
    }
    // a revoked net entry over an importer row stays INFO, never a refusal, never in E
    const revoked = devTarget({ ledger: [linked(7, 'CD_I1', 900, A), { ...linked(14, 'CD_I1', 900, A), action: 'revoked', supersedesId: 7 }] });
    const { report, overlap } = await restored(candidateAtRestored(), revoked);
    expect(verdictOf(report, 'G2')).toBe('PASS');
    expect(overlap.ePromotion.size).toBe(0);
  });

  it('G3 — an importer row whose player has no single forward identity is a STOP at restored, never silently ungraded', async () => {
    // DEV player 901 gained a second, unrelated AFL Tables path after pre-cutover: CD_I2's identity is ambiguous
    const target = devTarget({ ids: [at(900, A), at(901, B), at(901, F), at(902, C)] });
    const { report, overlap } = await restored(candidateAtRestored(), target);
    expect(verdictOf(report, 'G3')).toBe('FAIL');
    expect(report.results.find((r) => r.gate.includes('G3'))!.lines.join('\n'))
      .toContain('STOP target CD_I2: importer row whose player has no single forward stable identity');
    // and nothing is published from the refused run
    const out = join(dir, 'e-ungraded.json');
    publishRestoredAflApiFiles(parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', CAND,
      '--old-database', 'afldb_dev', '--afl-api-supersede-out', out]), overlap, report);
    expect(readdirSync(dir).filter((f) => f.startsWith('e-'))).toEqual([]);

    // beside an otherwise eligible season hard loss, the ungraded row still makes the generator refuse
    const withLoss = devTarget({
      ids: [at(900, A), at(901, B), at(901, F), at(902, C), at(904, E)],
      afl: [...devTarget().afl, importer('CD_I5', 904, 'afl_api_stat_vector_season')],
    });
    const second = await restored(candidateAtRestored(), withLoss);
    const proposal = aflApiDevRegenerationProposal({
      failedGates: second.report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate),
      overlap: second.overlap, names: NAMES, season: 2026, reason: 'x', reacquisitionPlan: 'y',
    });
    expect('refusals' in proposal && proposal.refusals).toContain(
      'target CD_I2: no single forward stable identity; G3 cannot grade it');
  });

  // ISSUE-235's link stores the FIRST path of a continuity pair in collation order; ISSUE-237's
  // forward classifier gives the pair's player the CONTINUING path. Same player, two strings: G2
  // must refuse by player, exactly as the post-swap D15 planner does, or the refusal lands after
  // the swap.
  it('G2 — a ledger identity naming the same candidate player as another provider\'s importer row is a COLLISION, by player', () => {
    const R = 'players/C/Charlie_Cameron3.html';
    const C = 'players/C/Charlie_Cameron.html';
    const ledger = { ...linked(1, 'CD_X', 700, R), playerIdentity: R };
    const importerY = {
      externalId: 'CD_Y', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap' as const,
      playerId: 55, candidateCount: 1, externalUrl: null,
    };
    const entries = aflApiG2Entries({
      candidate: { importerRows: [importerY], identityByExternalId: new Map([['CD_Y', C]]) },
      net: new Map([['CD_X', ledger]]),
      manualIdentities: new Set(),
      remapByIdentity: new Map([[R, { ok: true as const, newPlayerId: 55, remappedIdentity: R }]]),
    });
    expect(entries[0].collidingProviderId).toBe('CD_Y');
    expect(classifyAflApiG2(entries)).toEqual([{ externalId: 'CD_X', outcome: 'COLLISION', collidingProviderId: 'CD_Y' }]);
    // the same input is what D15 refuses after the swap
    const d15 = planAflApiAdjudicationReplay({
      ledgerRows: [ledger], remapByExternalId: new Map([['CD_X', { ok: true as const, newPlayerId: 55, remappedIdentity: R }]]),
      candidateByExternalId: new Map([['CD_Y', importerY]]), candidatePlayerAflApiRow: new Map([[55, importerY]]),
    });
    expect(d15.stops).toEqual([{ externalId: 'CD_X', reason: 'player 55 already holds a different afl_api provider (CD_Y)' }]);
    // the provider's OWN row on the remapped player is not a collision
    const own = aflApiG2Entries({
      candidate: { importerRows: [{ ...importerY, externalId: 'CD_X' }], identityByExternalId: new Map([['CD_X', C]]) },
      net: new Map([['CD_X', ledger]]), manualIdentities: new Set(),
      remapByIdentity: new Map([[R, { ok: true as const, newPlayerId: 55, remappedIdentity: R }]]),
    });
    expect(classifyAflApiG2(own)).toEqual([{ externalId: 'CD_X', outcome: 'AGREE' }]);
  });

  // --- F-L4-3 ----------------------------------------------------------------------------------

  it('F-L4-3 — source lineage still refuses any human authority, at --phase source and in the restored candidate', async () => {
    const report = new Report();
    await gateAflApiG1(fakeQ(candidateAtRestored({ ledger: [linked(1, 'CD_I1', 10, A)] })), report);
    expect(report.results[0].verdict).toBe('FAIL');
    expect(report.results[0].lines.join('\n')).toContain('ledger_row_present');

    const humanReport = new Report();
    await gateAflApiG1(fakeQ(candidateAtRestored({ afl: [human('CD_I1', 10)] })), humanReport);
    expect(humanReport.results[0].lines.join('\n')).toContain('resolved_row_present');

    for (const over of [{ ledger: [linked(1, 'CD_I1', 10, A)] }, { afl: [importer('CD_I2', 11), human('CD_I1', 10)] }]) {
      const { report: restoredReport } = await restored(candidateAtRestored(over), devTarget());
      expect(verdictOf(restoredReport, 'source-lineage human authority')).toBe('FAIL');
    }
  });

  it('F-L4-3 — the candidate phase ACCEPTS exactly the reinstated target ledger and refuses any drift from it', async () => {
    const { overlap } = await restored(candidateAtRestored(), devTarget());
    const bound = aflApiSupersedeFileFor(overlap, { environment: 'dev', ...NAMES });
    const run = async (db: FakeDb, file = bound, names = { environment: 'dev' as const, ...NAMES }) => {
      const report = new Report();
      await gateAflApiCandidateAfterReinstate(fakeQ(db), file, names, report);
      return report.results[0];
    };
    const ok = await run(candidateAfterReinstate());
    expect(ok.verdict).toBe('PASS');
    expect(ok.lines.join('\n')).toContain('E_promotion (AGREE) = {CD_I1}');

    const refusals: [string, FakeDb, string][] = [
      ['a human row dropped', candidateAfterReinstate({ ledger: [] }), 'ledger_not_bound_target_state'],
      ['a human row added', candidateAfterReinstate({ ledger: [linked(7, 'CD_I1', 10, A), linked(8, 'CD_I9', 12, C)] }), 'ledger_not_bound_target_state'],
      ['a decision downgraded to revoked', candidateAfterReinstate({ ledger: [{ ...linked(7, 'CD_I1', 10, A), action: 'revoked' }] }), 'ledger_not_bound_target_state'],
      ['a stored identity altered', candidateAfterReinstate({ ledger: [linked(7, 'CD_I1', 10, B)] }), 'ledger_not_bound_target_state'],
      ['a resolved row before D15', candidateAfterReinstate({ afl: [human('CD_I1', 10), importer('CD_I2', 11, 'afl_api_stat_vector_bootstrap')] }), 'resolved_row_present'],
      ['importer state changed', candidateAfterReinstate({ afl: [importer('CD_I1', 10)] }), 'importer_state_mismatch'],
    ];
    for (const [name, db, kind] of refusals) {
      const result = await run(db);
      expect(result.verdict, name).toBe('FAIL');
      expect(result.lines.join('\n'), name).toContain(kind);
    }
    const foreign = await run(candidateAfterReinstate(), bound, { environment: 'dev', candidateDatabase: `${CAND}x`, targetDatabase: 'afldb_dev' });
    expect(foreign.lines.join('\n')).toContain('candidate_database_mismatch');

    // parseArgs: the candidate phase cannot run without the bound file
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'candidate', '--database', CAND]))
      .toThrow(/needs --afl-api-supersede-in/);
    expect(parseArgs(['--environment', 'dev', '--phase', 'candidate', '--database', CAND,
      '--afl-api-supersede-in', '/x/e.json']).aflApiSupersedeIn).toBe('/x/e.json');
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', CAND, '--old-database', 'afldb_dev',
      '--afl-api-supersede-in', '/x/e.json'])).toThrow(/only meaningful with --phase candidate/);
  });

  // --- F-L4-4 ----------------------------------------------------------------------------------

  it('F-L4-4 — the E_promotion file is written only by a fully passing restored run, atomically, bound, deterministic', async () => {
    const { report, overlap } = await restored(candidateAtRestored(), devTarget());
    const out = join(dir, 'supersede.json');
    const opts = parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', CAND,
      '--old-database', 'afldb_dev', '--afl-api-supersede-out', out]);
    publishRestoredAflApiFiles(opts, overlap, report);
    expect(readdirSync(dir)).toEqual(['supersede.json']); // no .partial-* left behind
    const text = readFileSync(out, 'utf8');
    const file = parseAflApiSupersedeFile(text);
    expect(file).toMatchObject({
      environment: 'dev', candidateDatabase: CAND, targetDatabase: 'afldb_dev', expectedSupersedes: ['CD_I1'],
      candidateImporterRowCount: 2, candidateImporterSha256: overlap.candidate.state.sha256,
      targetLedgerRowCount: 1, targetLedgerSha256: aflApiLedgerStateSha256([linked(7, 'CD_I1', 900, A)]),
    });
    // deterministic: the same state gives byte-identical content
    const again = await restored(candidateAtRestored(), devTarget());
    expect(`${JSON.stringify(aflApiSupersedeFileFor(again.overlap, { environment: 'dev', ...NAMES }), null, 2)}\n`).toBe(text);
    // never overwritten
    expect(() => writeOperatorFileAtomically(out, 'x')).toThrow(PromotionRefused);
    expect(readFileSync(out, 'utf8')).toBe(text);

    // any failed gate of the run (not only an afl_api one) suppresses the file
    const failing = await restored(candidateAtRestored(), devTarget());
    failing.report.add('Lineage identity', 'FAIL');
    const refusedOut = join(dir, 'refused.json');
    publishRestoredAflApiFiles({ ...opts, aflApiSupersedeOut: refusedOut }, failing.overlap, failing.report);
    expect(readdirSync(dir)).toEqual(['supersede.json']);
  });

  it('F-L4-4 — a stale, foreign, tampered, unbound or candidate-mismatched file is refused; an empty set is bound as strongly', () => {
    const base = {
      environment: 'dev' as const, candidateDatabase: CAND, targetDatabase: 'afldb_dev',
      candidateImporterRowCount: 2, candidateImporterSha256: 'c'.repeat(64),
      targetLedgerRowCount: 1, targetLedgerSha256: 'd'.repeat(64),
    };
    const file = buildAflApiSupersedeFile({ ...base, expectedSupersedes: ['CD_I2', 'CD_I1', 'CD_I2'] });
    expect(file.expectedSupersedes).toEqual(['CD_I1', 'CD_I2']);
    const text = JSON.stringify(file);
    expect(parseAflApiSupersedeFile(text)).toEqual(file);

    const refuse = (mutate: (o: Record<string, unknown>) => void, why: RegExp) => {
      const o = JSON.parse(text) as Record<string, unknown>;
      mutate(o);
      expect(() => parseAflApiSupersedeFile(JSON.stringify(o))).toThrow(AflApiPromotionFileRefused);
      expect(() => parseAflApiSupersedeFile(JSON.stringify(o))).toThrow(why);
    };
    refuse((o) => { o.expectedSupersedes = ['CD_I1']; }, /tampered/);
    refuse((o) => { o.targetLedgerSha256 = 'e'.repeat(64); }, /tampered/);
    refuse((o) => { o.expectedSupersedes = ['CD_I2', 'CD_I1']; }, /sorted/);
    refuse((o) => { o.version = 1; }, /stale/);
    refuse((o) => { o.format = 'something.else'; }, /not an afldb\.afl_api_supersede_expected file/);
    refuse((o) => { o.note = 'hand edit'; }, /unexpected field set/);
    // the pre-fix v1 shape is refused outright
    expect(() => parseAflApiSupersedeFile(JSON.stringify({
      issue: 'AFLDB-ISSUE-125', format: 'afldb.afl_api_supersede_expected', version: 1, expectedSupersedes: [],
    }))).toThrow(AflApiPromotionFileRefused);

    const actual = { environment: 'dev', targetDatabase: 'afldb_dev', candidateDatabase: CAND,
      importer: { rowCount: 2, sha256: 'c'.repeat(64) }, ledger: { rowCount: 1, sha256: 'd'.repeat(64) } };
    expect(aflApiSupersedeBindingProblems(file, actual)).toEqual([]);
    const empty = buildAflApiSupersedeFile({ ...base, targetLedgerRowCount: 0, targetLedgerSha256: aflApiLedgerStateSha256([]), expectedSupersedes: [] });
    expect(empty.expectedSupersedes).toEqual([]);
    expect(aflApiSupersedeBindingProblems(empty, { ...actual, ledger: { rowCount: 0, sha256: aflApiLedgerStateSha256([]) } })).toEqual([]);
    for (const [name, over, kind] of [
      ['stale ledger', { ledger: { rowCount: 1, sha256: 'f'.repeat(64) } }, 'ledger_state_mismatch'],
      ['candidate-mismatched', { importer: { rowCount: 2, sha256: 'f'.repeat(64) } }, 'importer_state_mismatch'],
      ['foreign environment', { environment: 'prod' }, 'environment_mismatch'],
      ['foreign target', { targetDatabase: 'afldb_prod' }, 'target_database_mismatch'],
      ['foreign candidate', { candidateDatabase: 'afldb_dev_candidate_other' }, 'candidate_database_mismatch'],
    ] as const) {
      expect(aflApiSupersedeBindingProblems(file, { ...actual, ...over }).map((p) => p.kind), name).toContain(kind);
    }
    // an empty set bound to an empty ledger still refuses a promoted DB that now holds a decision
    expect(aflApiSupersedeBindingProblems(empty, actual).map((p) => p.kind)).toContain('ledger_state_mismatch');
  });

  it('F-L4-4 — post-swap D15 replay: supersedes exactly the bound set, and refuses every unbound file before any write', async () => {
    type ReplayState = { database: string; afl: AflApiCensusRow[]; ids: FakeIdentity[]; ledger: AflApiAdjudicationLedgerRow[]; writes: string[] };
    const replayTx = (state: ReplayState) => Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$');
      if (/^\s*(UPDATE|INSERT INTO) external_identities/.test(text)) { state.writes.push(text.trim().split(/\s+/)[0]); return []; }
      if (text.includes('current_database()')) return [{ currentDatabase: state.database }];
      if (text.includes("FROM sources WHERE key = 'afl_api'")) return [{ id: 1 }];
      if (text.includes('FROM afl_api_identity_adjudications')) {
        return state.ledger.map((r) => ({ ...r, id: String(r.id), supersedesId: r.supersedesId === null ? null : String(r.supersedesId) }));
      }
      if (text.includes('ei.player_id = ANY')) {
        const wanted = (values[0] as number[]).map(Number);
        return state.ids.filter((i) => wanted.includes(i.playerId));
      }
      if (text.includes('ei.external_id = ')) {
        return [...new Set(state.ids.filter((i) => i.externalId === values[0]).map((i) => i.playerId))].map((playerId) => ({ playerId }));
      }
      if (text.includes('FROM external_identities WHERE source_id =')) return state.afl.map((r) => ({ ...r }));
      throw new Error(`fake tx: unexpected SQL ${text}`);
    }, { array: (v: unknown[]) => v }) as unknown as TransactionSql;
    // the promoted database = the accepted candidate, renamed, overrides replayed
    const promoted = (over: Partial<ReplayState> = {}): ReplayState => {
      const c = candidateAfterReinstate();
      return { database: 'afldb_dev', afl: c.afl, ids: c.ids, ledger: c.ledger, writes: [], ...over };
    };
    const { overlap } = await restored(candidateAtRestored(), devTarget());
    const text = JSON.stringify(aflApiSupersedeFileFor(overlap, { environment: 'dev', ...NAMES }));
    const expected: { environment: 'prod' | 'dev'; targetDatabase: string } = { environment: 'dev', targetDatabase: 'afldb_dev' };

    const good = promoted();
    const counts = await replayAflApiAdjudicationsFromSupersedeFile(replayTx(good), text, expected);
    expect(counts.supersedes).toEqual([{ externalId: 'CD_I1', playerId: 10 }]);
    expect(good.writes).toEqual(['UPDATE']);

    const refusals: [string, ReplayState, string, typeof expected][] = [
      ['stale: DEV adjudicated after --phase restored', promoted({ ledger: [linked(7, 'CD_I1', 10, A), linked(8, 'CD_I9', 12, C)] }), text, expected],
      ['candidate-mismatched importer state', promoted({ afl: [importer('CD_I1', 10)] }), text, expected],
      ['foreign environment', promoted(), text, { environment: 'prod', targetDatabase: 'afldb_dev' }],
      ['connected to the wrong database', promoted({ database: 'afldb_dev_pre_rebuild_20260925-120000' }), text, expected],
      ['tampered', promoted(), text.replace('"CD_I1"]', '"CD_I1","CD_I2"]'), expected],
      ['unbound v1', promoted(), JSON.stringify({ issue: 'AFLDB-ISSUE-125', format: 'afldb.afl_api_supersede_expected', version: 1, expectedSupersedes: ['CD_I1'] }), expected],
    ];
    for (const [name, state, fileText, exp] of refusals) {
      await expect(replayAflApiAdjudicationsFromSupersedeFile(replayTx(state), fileText, exp), name).rejects.toThrow(AflApiReplayAbort);
      expect(state.writes, name).toEqual([]);
    }
  });

  // --- F-L4-5 ----------------------------------------------------------------------------------

  it('F-L4-5 — the generator proposes only afl_api_stat_vector_season hard losses, bound to both compared states', async () => {
    // DEV lost CD_I5 (season) in the candidate; everything else agrees.
    const target = devTarget({
      ids: [...devTarget().ids, at(904, E)],
      afl: [...devTarget().afl, importer('CD_I5', 904, 'afl_api_stat_vector_season')],
    });
    const { report, overlap } = await restored(candidateAtRestored(), target);
    expect(verdictOf(report, 'G3')).toBe('FAIL');
    const failedGates = report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate);
    const proposal = aflApiDevRegenerationProposal({
      failedGates, overlap, names: NAMES, season: 2026, reason: 'ISSUE-237 L4 hard losses', reacquisitionPlan: 'ISSUE-224/228 §9',
    });
    if (!('classification' in proposal)) throw new Error(JSON.stringify(proposal));
    const c = proposal.classification;
    expect(c.entries).toEqual([{ externalId: 'CD_I5', playerIdentity: E, matchMethod: 'afl_api_stat_vector_season' }]);
    expect(c).toMatchObject({ database: 'afldb_dev', candidateDatabase: CAND,
      targetImporterSha256: overlap.target.state.sha256, candidateImporterSha256: overlap.candidate.state.sha256 });
    expect(parseAflApiDevRegenerationClassification(JSON.stringify(c))).toEqual(c);

    // consumed exactly as --phase restored consumes it: bound, valid, and G3 then PASSES with one WARN
    expect(aflApiDevRegenerationBindingProblems(c, { targetDatabase: 'afldb_dev', candidateDatabase: CAND,
      targetImporterSha256: overlap.target.state.sha256, candidateImporterSha256: overlap.candidate.state.sha256 })).toEqual([]);
    expect(validateAflApiDevRegenerationClassification({ entries: c.entries, targetRows: overlap.targetRows, candidateRows: overlap.candidateRows })).toEqual([]);
    const g3 = classifyAflApiG3({ environment: 'dev', targetRows: overlap.targetRows, candidateRows: overlap.candidateRows, devRegenerationEntries: c.entries });
    expect(g3.filter((g) => g.outcome === 'FAIL')).toEqual([]);
    expect(g3).toContainEqual({ externalId: 'CD_I5', outcome: 'WARN', reason: 'hard_loss_regeneration' });
    // ...but not against a different candidate state, nor after the post-swap census moves to another target
    expect(aflApiDevRegenerationBindingProblems(c, { targetDatabase: 'afldb_dev', candidateImporterSha256: 'f'.repeat(64) })
      .map((p) => p.kind)).toEqual(['importer_state_mismatch']);
    expect(aflApiDevRegenerationBindingProblems(c, { targetDatabase: 'afldb_prod' }).map((p) => p.kind)).toEqual(['target_database_mismatch']);

    // written through publishRestoredAflApiFiles: G3-only failure -> proposal; the E_promotion file is NOT written
    const out = join(dir, 'regeneration.json');
    const supersedeOut = join(dir, 'supersede.json');
    publishRestoredAflApiFiles(parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', CAND,
      '--old-database', 'afldb_dev', '--afl-api-supersede-out', supersedeOut, '--afl-api-dev-regeneration-out', out,
      '--afl-api-regeneration-season', '2026', '--afl-api-regeneration-reason', 'ISSUE-237 L4 hard losses',
      '--afl-api-regeneration-plan', 'ISSUE-224/228 §9']), overlap, report);
    expect(readdirSync(dir)).toEqual(['regeneration.json']);
    expect(parseAflApiDevRegenerationClassification(readFileSync(out, 'utf8'))).toEqual(c);
  });

  it('F-L4-5 — never proposes a bootstrap, name/team or manual-adjudication loss, nor alongside any other failure', async () => {
    for (const method of ['afl_api_stat_vector_bootstrap', 'afl_api_name_team_season_bootstrap', 'afl_api_manual_adjudication']) {
      const target = devTarget({
        ids: [...devTarget().ids, at(904, E), at(905, F)],
        afl: [...devTarget().afl, importer('CD_I5', 904, 'afl_api_stat_vector_season'), importer('CD_I4', 905, method)],
      });
      const { report, overlap } = await restored(candidateAtRestored(), target);
      const proposal = aflApiDevRegenerationProposal({
        failedGates: report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate), overlap, names: NAMES,
        season: 2026, reason: 'r', reacquisitionPlan: 'p',
      });
      expect('refusals' in proposal && proposal.refusals.join('\n'), method).toContain(`hard loss of ${method} is never regenerable`);
    }
    // the pure selector agrees, straight from G3 grades
    const selection = aflApiDevRegenerationEntriesFromG3({
      g3Grades: [
        { externalId: 'CD_I1', outcome: 'FAIL', reason: 'hard_loss' },
        { externalId: 'CD_I2', outcome: 'FAIL', reason: 'hard_loss' },
        { externalId: 'CD_I3', outcome: 'FAIL', reason: 'collision' },
        { externalId: 'CD_I4', outcome: 'PASS' },
      ],
      targetRows: [
        { externalId: 'CD_I1', playerIdentity: A, matchMethod: 'afl_api_stat_vector_season' },
        { externalId: 'CD_I2', playerIdentity: B, matchMethod: 'afl_api_manual_adjudication' },
        { externalId: 'CD_I3', playerIdentity: C, matchMethod: 'afl_api_stat_vector_season' },
      ],
    });
    expect(selection.entries.map((e) => e.externalId)).toEqual(['CD_I1']);
    expect(selection.refusals.map((r) => r.externalId)).toEqual(['CD_I2', 'CD_I3']);

    // another failed gate: refused, and publish records a FAIL instead of writing
    const target = devTarget({ ids: [...devTarget().ids, at(904, E)], afl: [...devTarget().afl, importer('CD_I5', 904)] });
    const { report, overlap } = await restored(candidateAtRestored(), target);
    report.add('Lineage identity', 'FAIL');
    const out = join(dir, 'regeneration.json');
    publishRestoredAflApiFiles(parseArgs(['--environment', 'dev', '--phase', 'restored', '--database', CAND,
      '--old-database', 'afldb_dev', '--afl-api-dev-regeneration-out', out, '--afl-api-regeneration-season', '2026',
      '--afl-api-regeneration-reason', 'r', '--afl-api-regeneration-plan', 'p']), overlap, report);
    expect(readdirSync(dir)).toEqual([]);
    expect(verdictOf(report, 'classification NOT generated')).toBe('FAIL');
  });

  it('F-L4-5 — the classification file is strict: v2 only, every field hashed, no hand-authored or edited file', () => {
    const c = {
      format: 'afldb.afl_api_dev_regeneration_classification', version: 2, database: 'afldb_dev', candidateDatabase: CAND,
      season: 2026, reason: 'r', reacquisitionPlan: 'p', targetImporterSha256: 'a'.repeat(64), candidateImporterSha256: 'b'.repeat(64),
      entries: [{ externalId: 'CD_I5', playerIdentity: E, matchMethod: 'afl_api_stat_vector_season' }],
    };
    const { entries } = c;
    const built = parseAflApiDevRegenerationClassification(JSON.stringify(
      // round-trip through the only writer
      aflApiDevRegenerationProposalFor(entries)));
    expect(built.entries).toEqual(entries);
    const text = JSON.stringify(built);
    for (const [name, mutate] of [
      ['reason edited', (o: Record<string, unknown>) => { o.reason = 'something else'; }],
      ['plan edited', (o: Record<string, unknown>) => { o.reacquisitionPlan = 'something else'; }],
      ['entry swapped', (o: Record<string, unknown>) => { (o.entries as Record<string, unknown>[])[0].playerIdentity = A; }],
      ['candidate rebound', (o: Record<string, unknown>) => { o.candidateImporterSha256 = 'f'.repeat(64); }],
    ] as const) {
      const o = JSON.parse(text) as Record<string, unknown>;
      mutate(o);
      expect(() => parseAflApiDevRegenerationClassification(JSON.stringify(o)), name).toThrow(/tampered/);
    }
    // the v1 hand-authored recipe (§11d.4 of the old runbook) is refused
    const legacy = { format: c.format, version: 1, database: 'afldb_dev', season: 2026, reason: 'r', reacquisitionPlan: 'p', entries, payloadSha256: 'a'.repeat(64) };
    expect(() => parseAflApiDevRegenerationClassification(JSON.stringify(legacy))).toThrow(AflApiPromotionFileRefused);
    // an ineligible class can never even be parsed
    const o = JSON.parse(text) as Record<string, unknown>;
    (o.entries as Record<string, unknown>[])[0].matchMethod = 'afl_api_stat_vector_bootstrap';
    expect(() => parseAflApiDevRegenerationClassification(JSON.stringify(o))).toThrow(/only afl_api_stat_vector_season/);
  });

  it('F-L4-5 — the generator flags are DEV-only, restored-only, complete, and never combined with consumption', () => {
    const base = ['--phase', 'restored', '--database', CAND, '--old-database', 'afldb_dev'];
    const gen = ['--afl-api-dev-regeneration-out', '/x/r.json', '--afl-api-regeneration-season', '2026',
      '--afl-api-regeneration-reason', 'r', '--afl-api-regeneration-plan', 'p'];
    expect(parseArgs(['--environment', 'dev', ...base, ...gen])).toMatchObject({
      aflApiDevRegenerationOut: '/x/r.json', aflApiRegenerationSeason: 2026, aflApiRegenerationReason: 'r', aflApiRegenerationPlan: 'p',
    });
    expect(() => parseArgs(['--environment', 'prod', '--phase', 'restored', '--database', `${CANDIDATE_PREFIX}1`,
      '--old-database', 'afldb_prod', ...gen])).toThrow(/DEV-only/);
    expect(() => parseArgs(['--environment', 'dev', ...base, ...gen.slice(0, 4)])).toThrow(/needs all of/);
    expect(() => parseArgs(['--environment', 'dev', ...base, ...gen.slice(2)])).toThrow(/needs all of/);
    expect(() => parseArgs(['--environment', 'dev', ...base, ...gen, '--afl-api-dev-regeneration', '/x/c.json'])).toThrow(/never both/);
    expect(() => parseArgs(['--environment', 'dev', '--phase', 'pre-cutover', '--database', 'afldb_dev', ...gen]))
      .toThrow(/only meaningful with --phase restored/);
    expect(() => parseArgs(['--environment', 'dev', ...base, '--afl-api-regeneration-season', '26'])).toThrow(/four-digit/);
  });

  // --- F-L4-6 ----------------------------------------------------------------------------------

  it('F-L4-6 — the documentation no longer claims a per-row target census in the snapshot', () => {
    const doc = readFileSync(join(REPO, 'docs', 'production-promotion.md'), 'utf8');
    expect(doc).not.toMatch(/records\s+`\(external_id, stable identity, match_method\)` per importer row into the snapshot/);
    expect(doc).toContain('--afl-api-supersede-in');
    expect(doc).toContain('replayAflApiAdjudicationsFromSupersedeFile');
  });

  function aflApiDevRegenerationProposalFor(entries: { externalId: string; playerIdentity: string; matchMethod: string }[]) {
    const overlap = {
      ePromotion: new Set<string>(), ledgerState: { rowCount: 0, sha256: 'c'.repeat(64) },
      candidate: { state: { rowCount: 0, sha256: 'b'.repeat(64) }, importerRows: [], identityByExternalId: new Map() },
      target: { state: { rowCount: 1, sha256: 'a'.repeat(64) }, importerRows: [], identityByExternalId: new Map() },
      targetRows: entries, candidateRows: [],
      g3Grades: entries.map((e) => ({ externalId: e.externalId, outcome: 'FAIL' as const, reason: 'hard_loss' as const })),
    } as unknown as AflApiOverlapResult;
    const proposal = aflApiDevRegenerationProposal({ failedGates: ['afl_api importer identity — G3 cross-lineage comparison'],
      overlap, names: NAMES, season: 2026, reason: 'r', reacquisitionPlan: 'p' });
    if (!('classification' in proposal)) throw new Error(JSON.stringify(proposal));
    return proposal.classification;
  }
});

/**
 * AFLDB-ISSUE-237 L4 semantic blockers (2026-09-25): A4.2 (the post-swap players replay when the
 * target and the candidate carry DIFFERENT manual tokens for one AFL Tables path), A4.3 (target
 * overrides keyed to a match the historical candidate does not hold) and the
 * `--lineage-remap-out` refusal artefact. Each is a pre-swap checker gate now, driven here through
 * the real planners, the real gate function and the real publisher. DB-free.
 */
describe('AFLDB-ISSUE-237 L4 — A4.2 / A4.3 replay gates and the lineage remap artefact (DB-free)', () => {
  const P = 'players/P/P_Player.html';
  const Q = 'players/Q/Q_Player.html';
  const record = (token: string, path: string | null, extra: Record<string, unknown> = {}): PromotionOverrideRow => ({
    entityType: 'players', entityKey: `manual_admin_edit:${token}`, fieldGroup: 'identity',
    overrideValues: JSON.stringify({ display_name: 'Registered Player', ...(path === null ? {} : { afltables_profile_path: path }), ...extra }),
  });
  const manual = (token: string, playerId: number | null, status = 'resolved'): PromotionIdentityRow => ({
    sourceKey: 'manual_admin_edit', externalId: token, playerId, status, matchMethod: 'manual_admin_edit',
  });
  const aft = (path: string, playerId: number | null, status = 'resolved', matchMethod = 'afltables_profile_url'): PromotionIdentityRow => ({
    sourceKey: 'afltables', externalId: path, playerId, status, matchMethod,
  });
  const plan = (overrides: PromotionOverrideRow[], candidate: PromotionIdentityRow[]) =>
    planPromotionPlayersReplay({ overrides, candidate });

  // --- A4.2 ----------------------------------------------------------------------------------

  it('A4.2 (1) same token + same path: present, nothing inserted, no STOP', () => {
    const r = plan([record('A', P)], [manual('A', 20), aft(P, 20)]);
    expect(r.problems).toEqual([]);
    expect(r.present).toEqual([{ token: 'A', path: P, playerId: 20 }]);
    expect(r.binds).toEqual([]);
    expect(r.creates).toEqual([]);
  });

  it('A4.2 (2) different token + same path: STOP — binding would give one person two manual identities', () => {
    const r = plan([record('A', P)], [manual('B', 20), aft(P, 20)]);
    expect(r.binds).toEqual([]);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain('different token, same path');
    expect(r.problems[0]).toContain('manual_admin_edit:B');
    // B is also a candidate token the target never recorded
    expect(r.problems[1]).toContain('candidate manual_admin_edit:B (candidate player 20) has no target creation record');
  });

  it('A4.2 (2b) token absent, path held by a player with NO manual token: the ISSUE-160 bind, no STOP', () => {
    const r = plan([record('A', P)], [aft(P, 20)]);
    expect(r.problems).toEqual([]);
    expect(r.binds).toEqual([{ token: 'A', path: P, playerId: 20 }]);
  });

  it('A4.2 (3) same token + different path: STOP, in every direction', () => {
    expect(plan([record('A', P)], [manual('A', 20), aft(Q, 20)]).problems[0]).toContain('same token, different path');
    // the record's path is ALSO held by another player
    expect(plan([record('A', P)], [manual('A', 20), aft(P, 20), aft(P, 21)]).problems[0]).toContain('held elsewhere');
    // the record names no path, but the token's candidate player holds one
    expect(plan([record('A', null)], [manual('A', 20), aft(Q, 20)]).problems[0]).toContain('same token, different path');
  });

  it('A4.2 (4) two target tokens converging onto one candidate player: STOP', () => {
    // Player 20 holds both paths (a continuity pair); neither token is in the candidate.
    const r = plan([record('A1', P), record('A2', Q)], [aft(P, 20), aft(Q, 20)]);
    expect(r.binds).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('converges on candidate player 20');
    // two records naming the SAME path would create a twin carrying neither
    expect(plan([record('A1', P), record('A2', P)], []).problems[0]).toContain('also named by manual_admin_edit:A1');
  });

  it('A4.2 (5) candidate path ambiguous or not an accepted profile identity: STOP', () => {
    expect(plan([record('A', P)], [aft(P, 20), aft(P, 21)]).problems[0]).toContain('resolves to 2 candidate players');
    expect(plan([record('A', P)], [aft(P, 20, 'ambiguous')]).problems[0]).toContain('not an accepted afltables_profile_url row');
    expect(plan([record('A', P)], [aft(P, null, 'unmatched')]).problems[0]).toContain('not an accepted afltables_profile_url row');
  });

  it('A4.2 (6) candidate path missing: the replay creates the player with its path; a correction on it resolves', () => {
    const correction: PromotionOverrideRow = {
      entityType: 'players', entityKey: `afltables:${P}`, fieldGroup: 'name', overrideValues: '{"display_name":"X"}',
    };
    const r = plan([record('A', P), correction], []);
    expect(r.problems).toEqual([]);
    expect(r.creates).toEqual([{ token: 'A', path: P }]);
    expect(r.corrections).toEqual([{ entityKey: `afltables:${P}`, fieldGroup: 'name', resolvesTo: `created ${P}` }]);
    // a manual-only record (no path) is created too: nothing to converge by, and no name is read
    expect(plan([record('A', null)], []).creates).toEqual([{ token: 'A', path: null }]);
  });

  it('A4.2 (7) duplicate manual identities: STOP', () => {
    // the token's candidate player carries a second token
    expect(plan([record('A', P)], [manual('A', 20), manual('B', 20), aft(P, 20)]).problems[0])
      .toContain('duplicate manual identity');
    // the token row exists but is not accepted and player-linked
    expect(plan([record('A', P)], [manual('A', 20, 'ambiguous'), aft(P, 20)]).problems[0])
      .toContain('not one accepted, player-linked row');
    expect(plan([record('A', null)], [manual('A', null)]).problems[0]).toContain('not one accepted, player-linked row');
    // a manual-namespace row in a field group other than the creation record's
    expect(plan([{ ...record('A', P), fieldGroup: 'name' }], []).problems[0]).toContain("only field_group 'identity'");
  });

  it('A4.2 — a source-keyed correction whose identity the candidate lacks, or holds twice, is a STOP, not a silent drop', () => {
    const correction = (key: string): PromotionOverrideRow => ({
      entityType: 'players', entityKey: key, fieldGroup: 'dob', overrideValues: '{"dob":null}',
    });
    expect(plan([correction(`afltables:${Q}`)], []).problems[0]).toContain('match nothing and silently drop it');
    expect(plan([correction(`afltables:${Q}`)], [aft(Q, 20), aft(Q, 21)]).problems[0]).toContain('apply it to every one of them');
    expect(plan([correction(`afltables:${Q}`)], [aft(Q, 20)]).corrections).toEqual([
      { entityKey: `afltables:${Q}`, fieldGroup: 'dob', resolvesTo: 'player 20' },
    ]);
  });

  it("A4.2 — the replay's own payload refusals are predicted before the swap", () => {
    expect(plan([{ ...record('A', null), overrideValues: '[1]' }], []).problems[0]).toContain('not a JSON object');
    expect(plan([record('A', null, { dob: '2001-01-01' })], []).problems[0]).toContain('dob is set with no dob_confidence');
    expect(plan([record('A', null, { dob: '2001-01-01', dob_confidence: 'sourced' })], []).problems).toEqual([]);
    // 'exact' is not a value_confidence (migration 001): the replay's INSERT cast raises.
    expect(plan([record('A', null, { dob: '2001-01-01', dob_confidence: 'exact' })], []).problems[0])
      .toContain('dob_confidence is not a value_confidence');
  });

  // The replay's pre-check refuses a creation record with no usable name (common.py), AFTER the
  // swap. The gate predicts it through the shared ISSUE-245 validator, so neither promotion module
  // names the field itself (the guard below still holds).
  it('A4.2 — a creation record the replay cannot re-create a player from is a STOP: missing, null or blank name', () => {
    const noName = (payload: Record<string, unknown>): PromotionOverrideRow => ({
      entityType: 'players', entityKey: 'manual_admin_edit:A', fieldGroup: 'identity', overrideValues: JSON.stringify(payload),
    });
    for (const payload of [{}, { display_name: null }, { display_name: '  ' }, { display_name: 7 }]) {
      const r = plan([noName(payload)], []);
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toContain('no display_name to re-create the player with');
      expect(r.creates).toEqual([]);
    }
    // the same record against a candidate that already holds its token: still a STOP (the replay's
    // pre-check runs over EVERY active manual record, present or not)
    expect(plan([noName({})], [manual('A', 20)]).problems[0]).toContain('no display_name');
  });

  it('A4.2 — every cast the replay makes is predicted: smallint range and scale, calendar date, enum, key shape', () => {
    const stop = (extra: Record<string, unknown>, raw?: string) => plan([raw === undefined
      ? record('A', null, extra) : { ...record('A', null), overrideValues: raw }], []).problems;
    expect(stop({ height_cm: 40000 })[0]).toContain('height_cm is not a smallint');
    expect(stop({ weight_kg: '80' })[0]).toContain('weight_kg is not a smallint');
    // jsonb keeps a numeric's scale: 1990.0 is an integer to JSON.parse, but '1990.0'::smallint raises
    expect(stop({}, '{"display_name": "R", "birth_year": 1990.0}')[0]).toContain('birth_year is not a smallint');
    expect(stop({}, '{"display_name": "R", "birth_year": 1990}')).toEqual([]);
    expect(stop({ dob: '2001-02-30', dob_confidence: 'sourced' })[0]).toContain('not a YYYY-MM-DD calendar date');
    expect(stop({ birth_year_confidence: 'likely' })[0]).toContain('birth_year_confidence is not a value_confidence');
    expect(stop({ given_name: 3 })[0]).toContain('given_name is not text or null');
    expect(stop({ afltables_profile_path: 'not/a/path' })[0]).toContain('not an AFL Tables profile path');
  });

  it('A4.2 — a source-keyed correction the merge UPDATE would raise on is a STOP', () => {
    const corr = (overrideValues: string): PromotionOverrideRow => ({
      entityType: 'players', entityKey: `afltables:${Q}`, fieldGroup: 'dob', overrideValues,
    });
    expect(plan([corr('"x"')], [aft(Q, 20)]).problems[0]).toContain('not a JSON object');
    expect(plan([corr('{"dob":"2001-13-01"}')], [aft(Q, 20)]).problems[0]).toContain('calendar date');
    expect(plan([corr('{"dob_confidence":"exact"}')], [aft(Q, 20)]).problems[0]).toContain('not a value_confidence');
    expect(plan([corr('{"dob":"2001-01-01","dob_confidence":"sourced"}')], [aft(Q, 20)]).problems).toEqual([]);
  });

  it('A4.2 — equal-authority overrides that disagree on one field of one player are a STOP; different ranks are not', () => {
    const corr = (entityKey: string, fieldGroup: string, payload: Record<string, unknown>): PromotionOverrideRow => ({
      entityType: 'players', entityKey, fieldGroup, overrideValues: JSON.stringify(payload),
    });
    const draft = { sourceKey: 'draftguru', externalId: 'dg-1', playerId: 20, status: 'resolved', matchMethod: 'x' };
    // two corrections (rank 1) on player 20, through two identities, disagreeing on 'notes'
    const r = plan([corr(`afltables:${Q}`, 'notes', { notes: 'a' }), corr('draftguru:dg-1', 'notes', { notes: 'b' })],
      [aft(Q, 20), draft]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("player 20: field 'notes' is claimed by equal-authority overrides that disagree");
    // agreeing values (jsonb equality: key order and numeric form do not matter) are not a conflict
    expect(plan([corr(`afltables:${Q}`, 'notes', { notes: 'a' }), corr('draftguru:dg-1', 'notes', { notes: 'a' })],
      [aft(Q, 20), draft]).problems).toEqual([]);
    // a creation record (rank 0) and a correction (rank 1) disagreeing: precedence settles it
    const settled = plan([record('A', P, { notes: 'old' }), corr(`afltables:${P}`, 'notes', { notes: 'new' })], [aft(P, 20)]);
    expect(settled.problems).toEqual([]);
    expect(settled.merges).toEqual([{ target: 'player 20', playerId: 20, insertBase: null,
      fields: expect.objectContaining({ notes: 'new', afltables_profile_path: P }) }]);
  });

  it('A4.2 — the merge UPDATE cannot violate a players CHECK against the candidate row', () => {
    const corr = (payload: Record<string, unknown>): PromotionOverrideRow => ({
      entityType: 'players', entityKey: `afltables:${Q}`, fieldGroup: 'dob', overrideValues: JSON.stringify(payload),
    });
    const row = (over: Partial<PromotionPlayerCheckRow> = {}): PromotionPlayerCheckRow => ({
      hasDob: false, dobConfidence: 'unknown', birthYearMin: null, birthYearMax: null, ...over,
    });
    const checks = (overrides: PromotionOverrideRow[], rows: [number, PromotionPlayerCheckRow][], candidate = [aft(Q, 20)]) =>
      promotionPlayerCheckProblems(plan(overrides, candidate).merges, new Map(rows));
    // a dob-only correction (the data editor records CHANGED fields only) meets a candidate row whose
    // confidence is 'unknown': players_dob_confidence_ck raises after the swap
    expect(checks([corr({ dob: '2001-01-01' })], [[20, row()]])[0]).toContain('players_dob_confidence_ck');
    // ...but not when the candidate row already carries a confidence, or the payload carries one
    expect(checks([corr({ dob: '2001-01-01' })], [[20, row({ dobConfidence: 'sourced' })]])).toEqual([]);
    expect(checks([corr({ dob: '2001-01-01', dob_confidence: 'sourced' })], [[20, row()]])).toEqual([]);
    // clearing the confidence of a row that keeps its dob
    expect(checks([corr({ dob_confidence: 'unknown' })], [[20, row({ hasDob: true, dobConfidence: 'sourced' })]])[0])
      .toContain('players_dob_confidence_ck');
    // a partial birth-year correction against the candidate's other bound
    expect(checks([corr({ birth_year_min: 1990 })], [[20, row({ birthYearMax: 1985 })]])[0]).toContain('players_birth_range_ck');
    expect(checks([corr({ birth_year_min: 1990, birth_year_max: 1991 })], [[20, row({ birthYearMax: 1985 })]])).toEqual([]);
    // a merge onto a player the read did not return
    expect(checks([corr({ notes: null })], [])[0]).toContain('holds no players row');
    // a created player starts from its INSERT (no range, the record's own dob/confidence)
    const created = plan([record('A', P, { dob: '2001-01-01', dob_confidence: 'sourced' }),
      { ...corr({ birth_year_min: 1990 }), entityKey: `afltables:${P}` }], []);
    expect(created.merges[0]).toMatchObject({ target: 'created A', playerId: null,
      insertBase: { hasDob: true, dobConfidence: 'sourced', birthYearMin: null, birthYearMax: null } });
    expect(promotionPlayerCheckProblems(created.merges, new Map())).toEqual([]);
  });

  // A candidate token with no target creation record would be carried through the swap as a manual
  // identity with no creation record (the target's data_overrides replaces the candidate's).
  it('A4.2 — a candidate-only manual token is a STOP, with or without an AFL Tables path', () => {
    for (const candidate of [[manual('B', 20), aft(P, 20)], [manual('B', 20)]]) {
      const r = plan([], candidate);
      expect(r.candidateOnlyTokens).toEqual([{ token: 'B', playerId: 20 }]);
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toContain('candidate manual_admin_edit:B (candidate player 20) has no target creation record');
    }
    // a token the target DOES record is never candidate-only, even when that record is refused
    expect(plan([{ ...record('A', P), overrideValues: '{}' }], [manual('A', 20), aft(P, 20)]).candidateOnlyTokens).toEqual([]);
  });

  it('A4.2 — identity keys read for the planner: record paths and correction identities, never names', () => {
    const keys = playerIdentityKeysOfOverrides([
      record('A', P), record('B', null),
      { entityType: 'players', entityKey: `afltables:${Q}`, fieldGroup: 'name', overrideValues: '{}' },
      { entityType: 'matches', entityKey: '2026|1|x|a|b', fieldGroup: 'score', overrideValues: '{}' },
    ]);
    expect(keys).toEqual({ sourceKeys: ['afltables', 'afltables'], externalIds: [P, Q] });
  });

  // --- A4.3 ----------------------------------------------------------------------------------

  const mk = (entityType: string, entityKey: string, fieldGroup = 'score'): PromotionOverrideRow => ({
    entityType, entityKey, fieldGroup, overrideValues: '{}',
  });
  const K25 = '2025|1|2025-03-13|Richmond|Carlton';
  const K26 = '2026|1|2026-03-12|Richmond|Carlton';

  it('A4.3 — a 2026-keyed matches or match_coaches override is a STOP naming the lifecycle boundary', () => {
    const r = planPromotionMatchReplay({
      overrides: [mk('matches', K25), mk('matches', K26), mk('match_coaches', `${K26}|richmond`, 'coach')],
      candidateMatchKeys: new Set([K25]), candidateMaxSeason: 2025,
    });
    expect(r.resolved).toBe(1);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain("season 2026 is after the candidate's historical baseline (max season 2025)");
    expect(r.problems[0]).toContain('silently match nothing');
    expect(r.problems[1]).toContain('raises after the swap');
  });

  it('A4.3 — an absent historical key is a STOP too; an undecodable match_coaches key is a STOP; players are not read', () => {
    const r = planPromotionMatchReplay({
      overrides: [mk('matches', '1999|1|1999-03-01|A|B'), mk('match_coaches', 'no-delimiter', 'coach'),
        mk('players', 'manual_admin_edit:A', 'identity')],
      candidateMatchKeys: new Set(), candidateMaxSeason: 2025,
    });
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).not.toContain('historical baseline');
    expect(r.problems[1]).toContain('not <match_key>|<club slug>');
    // the replay's own decode: the club slug is after the LAST delimiter
    expect(decodeMatchCoachKey(`${K26}|gold-coast`)).toEqual({ matchKey: K26, clubSlug: 'gold-coast' });
    expect(decodeMatchCoachKey(`${K26}|`)).toBeNull();
    expect(matchKeysOfOverrides([mk('matches', K25), mk('match_coaches', `${K26}|richmond`)])).toEqual([K25, K26]);
  });

  // --- the gate: which database answers which read -------------------------------------------

  type Side = { overrides: PromotionOverrideRow[]; identities: PromotionIdentityRow[]; matchKeys: string[]; maxSeason: number | null; log: string[] };
  const side = (over: Partial<Side> = {}): Side => ({ overrides: [], identities: [], matchKeys: [], maxSeason: 2025, log: [], ...over });
  const sideQ = (s: Side): Query => async (text, params = []) => {
    s.log.push(text);
    if (text === PROMOTION_REPLAY_OVERRIDES_SQL) return s.overrides.map((o) => ({ ...o }));
    if (text === PROMOTION_REPLAY_IDENTITIES_SQL) {
      const [keys, ids] = params as [string[], string[]];
      return s.identities.filter((i) => i.sourceKey === 'manual_admin_edit'
        || keys.some((k, n) => k === i.sourceKey && ids[n] === i.externalId)
        || (i.sourceKey === 'afltables' && s.identities.some((m) => m.sourceKey === 'manual_admin_edit' && m.playerId === i.playerId)))
        .map((i) => ({ ...i, playerId: i.playerId === null ? null : String(i.playerId) }));
    }
    if (text === PROMOTION_REPLAY_MATCH_KEYS_SQL) {
      const wanted = params[0] as string[];
      return s.matchKeys.filter((k) => wanted.includes(k)).map((matchKey) => ({ matchKey }));
    }
    if (text === PROMOTION_REPLAY_MAX_SEASON_SQL) return [{ maxSeason: s.maxSeason }];
    if (text === PROMOTION_REPLAY_PLAYER_CHECKS_SQL) {
      // every requested player exists, with no dob and no birth range (postgres.js: int as number)
      return (params[0] as number[]).map((playerId) => ({
        playerId, hasDob: false, dobConfidence: 'unknown', birthYearMin: null, birthYearMax: null,
      }));
    }
    throw new Error(`fake database: unexpected SQL ${text}`);
  };

  let dir: string;
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), 'afldb-issue237-remap-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('restored phase: overrides from the TARGET, identities and matches from the CANDIDATE; STOPs fail the run', async () => {
    const target = side({ overrides: [record('A', P), mk('matches', K26)], identities: [manual('A', 900), aft(P, 900)] });
    const candidate = side({ identities: [manual('B', 20), aft(P, 20)], matchKeys: [K25] });
    const report = new Report();
    const out = await gateOverrideReplayTargets({ overrides: sideQ(target), candidate: sideQ(candidate) },
      { overrides: 'target afldb_dev', candidate: 'candidate c' }, report);
    expect(target.log).toEqual([PROMOTION_REPLAY_OVERRIDES_SQL]);
    expect(candidate.log).toContain(PROMOTION_REPLAY_IDENTITIES_SQL);
    expect(candidate.log).toContain(PROMOTION_REPLAY_MATCH_KEYS_SQL);
    expect(candidate.log).not.toContain(PROMOTION_REPLAY_OVERRIDES_SQL);
    expect(out.players.problems[0]).toContain('different token, same path');
    expect(out.matches.problems[0]).toContain('season 2026');
    expect(report.results.map((r) => r.verdict)).toEqual(['FAIL', 'FAIL']);
    expect(report.results[0].gate).toContain('A4.2');
    expect(report.results[1].gate).toContain('A4.3');
  });

  it('candidate phase: the reinstated target overrides and the candidate identities are one database; a clean state PASSES', async () => {
    const both = side({ overrides: [record('A', P), mk('matches', K25)], identities: [aft(P, 20)], matchKeys: [K25] });
    const report = new Report();
    const out = await gateOverrideReplayTargets({ overrides: sideQ(both), candidate: sideQ(both) },
      { overrides: 'candidate c (reinstated)', candidate: 'candidate c' }, report);
    expect(out.players.binds).toEqual([{ token: 'A', path: P, playerId: 20 }]);
    expect(out.matches.resolved).toBe(1);
    expect(report.failed).toBe(false);
    // the CHECK columns were read from the candidate, by the resolved id only
    expect(both.log).toContain(PROMOTION_REPLAY_PLAYER_CHECKS_SQL);
  });

  it('the gate folds the candidate-row CHECK prediction into the A4.2 verdict', async () => {
    const target = side({ overrides: [{
      entityType: 'players', entityKey: `afltables:${P}`, fieldGroup: 'dob', overrideValues: '{"dob":"2001-01-01"}',
    }] });
    const candidate = side({ identities: [aft(P, 20)] });
    const report = new Report();
    const out = await gateOverrideReplayTargets({ overrides: sideQ(target), candidate: sideQ(candidate) },
      { overrides: 'target afldb_dev', candidate: 'candidate c' }, report);
    expect(candidate.log).toContain(PROMOTION_REPLAY_PLAYER_CHECKS_SQL);
    expect(target.log).not.toContain(PROMOTION_REPLAY_PLAYER_CHECKS_SQL);
    expect(out.players.problems).toEqual([expect.stringContaining('players_dob_confidence_ck')]);
    expect(report.results[0].verdict).toBe('FAIL');
  });

  it('the gate is wired into --phase restored and --phase candidate, before any file is published', () => {
    const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    const main = source.slice(source.indexOf('async function main('));
    const restoredBranch = main.slice(main.indexOf("if (phase === 'restored') {"), main.indexOf('if (opts.compare)'));
    expect(restoredBranch).toContain('gateOverrideReplayTargets({ overrides: old.q, candidate: conn.q }');
    const candidateBranch = main.slice(main.indexOf("if (phase === 'candidate') {"), main.indexOf('let aflApiTargetCensus'));
    expect(candidateBranch).toContain('gateOverrideReplayTargets({ overrides: conn.q, candidate: conn.q }');
    // publication happens after the gates, and the remap is refused up front if it exists
    expect(main.indexOf('publishRestoredLineageRemap(')).toBeGreaterThan(main.indexOf('await conn.end();'));
    expect(main).toContain('[opts.aflApiSupersedeOut, opts.aflApiDevRegenerationOut, opts.lineageRemapOut]');
    // the lineage gate generates, it never writes
    const gate = source.slice(source.indexOf('async function gateLineageIdentity'), source.indexOf('async function readAflApiCensus'));
    expect(gate).toContain('prepareRemap(plans, false)');
    expect(gate).not.toMatch(/writeFileSync|writeOperatorFileAtomically/);
    // No name is read by the new gate. Its ONE players read is the CHECK-column read, by the ids
    // stable identities already resolved, from the candidate -- never a name, never a lookup.
    const newGate = source.slice(source.indexOf('export const PROMOTION_REPLAY_OVERRIDES_SQL'),
      source.indexOf('export function publishRestoredLineageRemap'));
    expect(newGate).not.toMatch(/display_name|search_name|given_name|surname|full_name|ilike/i);
    expect(newGate.match(/FROM players\b/gi)).toHaveLength(1);
    expect(PROMOTION_REPLAY_PLAYER_CHECKS_SQL).toMatch(/FROM players\s+WHERE id = ANY\s*\(\$1::int\[\]\)/);
    expect(PROMOTION_REPLAY_PLAYER_CHECKS_SQL).not.toMatch(/\bdob AS|name/i);
    expect(newGate).toContain('sides.candidate(PROMOTION_REPLAY_PLAYER_CHECKS_SQL, [checkIds])');
  });

  // --- --lineage-remap-out -------------------------------------------------------------------

  const REMAP = lineageRemapSql({ candidate: 'afldb_dev_candidate_20260925-120000', oldDatabase: 'afldb_dev', environment: 'dev', plans: [] });

  it('remap: a refused run publishes NO file, and says so', () => {
    const out = join(dir, 'remap.sql');
    const report = new Report();
    report.add('afl_api importer identity — G3 cross-lineage comparison', 'FAIL', []);
    publishRestoredLineageRemap(out, REMAP, report);
    expect(readdirSync(dir)).toEqual([]);
    expect(report.results.at(-1)).toMatchObject({ gate: 'Lineage remap file NOT written', verdict: 'INFO' });
    // nothing prepared (the lineage gate itself refused) is not written either
    publishRestoredLineageRemap(out, undefined, new Report());
    expect(readdirSync(dir)).toEqual([]);
  });

  it('remap: a fully passing run publishes exactly the prepared SQL, once, never over an existing file', () => {
    const out = join(dir, 'remap.sql');
    const report = new Report();
    report.add('Lineage identity of reinstated id-keyed rows', 'PASS', []);
    publishRestoredLineageRemap(out, REMAP, report);
    expect(readFileSync(out, 'utf8')).toBe(REMAP);
    expect(report.results.at(-1)?.gate).toBe('Lineage remap file written');
    expect(() => publishRestoredLineageRemap(out, REMAP, new Report())).toThrow(PromotionRefused);
    expect(readdirSync(dir)).toEqual(['remap.sql']);
  });

  it('remap: the file refuses any database but the candidate it was evidenced against, before any UPDATE', () => {
    const guard = lineageRemapBindingGuard('afldb_dev_candidate_20260925-120000');
    expect(guard.join('\n')).toContain("IF current_database() <> 'afldb_dev_candidate_20260925-120000' THEN");
    expect(guard.join('\n')).toContain('RAISE EXCEPTION');
    const lines = REMAP.split('\n');
    const begin = lines.indexOf('BEGIN;');
    expect(begin).toBeGreaterThan(-1);
    expect(lines.slice(begin + 1, begin + 1 + guard.length)).toEqual(guard);
    expect(lineageRemapBindingGuard("o'brien").join('\n')).toContain("'o''brien'");
  });
});

/**
 * AFLDB-ISSUE-242 — manual player registration token convergence at the promotion boundary. A
 * `manual_admin_edit` token is minted per database, so the same person registered on the
 * candidate's source and on the target carries two tokens; ISSUE-237 A4.2 (B4) correctly STOPs
 * that state unchanged. These cases drive the convergence planner, the SQL it adds to the step-2c
 * remap transaction, the restored and candidate gates, and the final state through the ISSUE-245
 * capture rule (`registrationsFromLive`) and `readManualPlayerToken`. DB-free.
 */
describe('AFLDB-ISSUE-242 — manual registration token convergence (DB-free)', () => {
  const P = 'players/P/P_Player.html';
  const Q = 'players/Q/Q_Player.html';
  const CAND = 'afldb_dev_candidate_20260925-120000';
  const record = (token: string, path: string | null): PromotionOverrideRow => ({
    entityType: 'players', entityKey: `manual_admin_edit:${token}`, fieldGroup: 'identity',
    overrideValues: JSON.stringify({ display_name: 'Registered Player', ...(path === null ? {} : { afltables_profile_path: path }) }),
  });
  const manual = (token: string, playerId: number | null, status = 'resolved'): PromotionIdentityRow => ({
    sourceKey: 'manual_admin_edit', externalId: token, playerId, status, matchMethod: 'manual_admin_edit',
  });
  const aft = (path: string, playerId: number | null, status = 'resolved'): PromotionIdentityRow => ({
    sourceKey: 'afltables', externalId: path, playerId, status, matchMethod: 'afltables_profile_url',
  });
  const converge = (overrides: PromotionOverrideRow[], candidate: PromotionIdentityRow[], target: PromotionIdentityRow[] = []) =>
    planManualIdentityConvergence({ overrides, candidate, target });
  /** What --phase restored decides: the convergence, the candidate after 2c, and the replay predicted over it. */
  const predict = (overrides: PromotionOverrideRow[], candidate: PromotionIdentityRow[], target: PromotionIdentityRow[] = []) => {
    const c = converge(overrides, candidate, target);
    const state = applyManualIdentityConvergence(candidate, c.entries);
    return { c, state, replay: planPromotionPlayersReplay({ overrides, candidate: state }) };
  };
  /** The post-swap replay's identity writes (binds; creates as fresh ids): the promoted state. */
  const afterReplay = (state: PromotionIdentityRow[], replay: ReturnType<typeof planPromotionPlayersReplay>) => {
    const out = [...state, ...replay.binds.map((b) => manual(b.token, b.playerId))];
    replay.creates.forEach((c, i) => {
      out.push(manual(c.token, 5000 + i));
      if (c.path !== null) out.push(aft(c.path, 5000 + i));
    });
    return out;
  };
  const live = (overrides: PromotionOverrideRow[], ids: PromotionIdentityRow[]): LiveRegistrationState => ({
    overrides: overrides.filter((o) => o.entityType === 'players').map((o) => ({
      entityKey: o.entityKey, fieldGroup: o.fieldGroup, isActive: true, overrideValues: o.overrideValues,
      createdAt: '2026-09-25T00:00:00.000000Z', updatedAt: '2026-09-25T00:00:00.000000Z',
      adminUserId: 7, adminEmail: 'owner@afldb.example', adminRole: 'super_admin',
    })),
    corrections: [],
    manualIdentities: ids.filter((i) => i.sourceKey === 'manual_admin_edit')
      .map(({ externalId, playerId, status, matchMethod }) => ({ externalId, playerId, status, matchMethod })),
    afltablesIdentities: ids.filter((i) => i.sourceKey === 'afltables')
      .map(({ externalId, playerId, status, matchMethod }) => ({ externalId, playerId, status, matchMethod })),
  });
  /** `readManualPlayerToken` over an identity set: the tagged template's one value is the player id. */
  const tokenOf = (ids: PromotionIdentityRow[], playerId: number) => readManualPlayerToken((async (_: TemplateStringsArray, id: number) => ids
    .filter((r) => r.sourceKey === 'manual_admin_edit' && r.playerId === id && ['unique', 'resolved'].includes(r.status))
    .map((r) => ({ externalId: r.externalId }))
    .sort((a, b) => (a.externalId < b.externalId ? -1 : 1))) as unknown as TransactionSql, playerId);

  // --- the ten identity cases ----------------------------------------------------------------

  it('(1) same path, same token: nothing to converge; the replay finds it present', () => {
    const { c, replay } = predict([record('A', P)], [manual('A', 20), aft(P, 20)]);
    expect(c).toEqual({ entries: [], problems: [] });
    expect(replay.present).toEqual([{ token: 'A', path: P, playerId: 20 }]);
    expect(replay.problems).toEqual([]);
  });

  it('(2) same path, different token: rebind -- the candidate token retires, the TARGET token binds to the same player', async () => {
    const overrides = [record('A', P)];
    const { c, state, replay } = predict(overrides, [manual('B', 20), aft(P, 20)]);
    expect(c.problems).toEqual([]);
    expect(c.entries).toEqual([{ kind: 'rebind', path: P, candidateToken: 'B', targetToken: 'A', playerId: 20 }]);
    // no second player, no unbacked token: one manual identity, the target's, on the path's player
    expect(state.filter((r) => r.sourceKey === 'manual_admin_edit')).toEqual([manual('A', 20)]);
    expect(replay).toMatchObject({ present: [{ token: 'A', path: P, playerId: 20 }], binds: [], creates: [], candidateOnlyTokens: [], problems: [] });
    const promoted = afterReplay(state, replay);
    expect(registrationsFromLive(live(overrides, promoted))).toMatchObject({ problems: [], registrations: [{ token: 'A', playerId: 20 }] });
    expect(await tokenOf(promoted, 20)).toBe('A');
  });

  it('(3) candidate P + token, target holds P with NO registration: retire -- the player stays owned by P, no token', async () => {
    const { c, state, replay } = predict([], [manual('B', 20), aft(P, 20)], [aft(P, 900, 'unique')]);
    expect(c.entries).toEqual([{ kind: 'retire', path: P, candidateToken: 'B', targetToken: null, playerId: 20 }]);
    expect(state).toEqual([aft(P, 20)]);
    expect(replay.problems).toEqual([]);
    expect(replay.candidateOnlyTokens).toEqual([]);
    const promoted = afterReplay(state, replay);
    expect(registrationsFromLive(live([], promoted))).toEqual({ registrations: [], problems: [] });
    expect(await tokenOf(promoted, 20)).toBeNull();
  });

  it('(3) retire needs the target to PROVE P source-owned: unaccepted, ambiguous or token-carrying holders STOP', () => {
    const candidate = [manual('B', 20), aft(P, 20)];
    expect(converge([], candidate, [aft(P, 900, 'ambiguous')]).problems[0]).toContain('does not prove the person source-owned');
    expect(converge([], candidate, [aft(P, 900), aft(P, 901)]).problems[0]).toContain('does not prove the person source-owned');
    // the target's holder carries a token that no active creation record names with P
    expect(converge([], candidate, [aft(P, 900), manual('Z', 900)]).problems[0])
      .toContain('the target registration state is itself unsupported');
    for (const target of [[aft(P, 900, 'ambiguous')], [aft(P, 900), manual('Z', 900)]]) {
      expect(converge([], candidate, target).entries).toEqual([]);
    }
  });

  it('(4) target P + token, candidate P with no token: nothing to converge; the replay binds the TARGET token', async () => {
    const overrides = [record('A', P)];
    const { c, state, replay } = predict(overrides, [aft(P, 20)]);
    expect(c).toEqual({ entries: [], problems: [] });
    expect(replay.binds).toEqual([{ token: 'A', path: P, playerId: 20 }]);
    const promoted = afterReplay(state, replay);
    expect(registrationsFromLive(live(overrides, promoted)).problems).toEqual([]);
    expect(await tokenOf(promoted, 20)).toBe('A');
  });

  it('(5) same token, different path: STOP -- never converged', () => {
    const { c, replay } = predict([record('A', P)], [manual('A', 20), aft(Q, 20)]);
    expect(c.entries).toEqual([]);
    expect(replay.problems[0]).toContain('same token, different path');
    // the target token for P is already held by ANOTHER candidate player than P's
    const held = converge([record('A', P)], [manual('B', 20), aft(P, 20), manual('A', 21), aft(Q, 21)]);
    expect(held.entries).toEqual([]);
    expect(held.problems[0]).toContain('already held by candidate player(s) 21; same token, different person');
  });

  it('(6) two target tokens converging on one candidate player: STOP -- no rule proves one survivor', () => {
    // the candidate-token player holds both paths the two records name
    const r = predict([record('A1', P), record('A2', Q)], [manual('B', 20), aft(P, 20), aft(Q, 20)]);
    expect(r.c.entries).toEqual([]);
    expect(r.c.problems[0]).toContain('holds 2 AFL Tables profile paths');
    expect(r.replay.problems.some((p) => p.includes('different token, same path'))).toBe(true);
    // with no candidate token at all, the replay planner's own convergence STOP still holds
    expect(predict([record('A1', P), record('A2', Q)], [aft(P, 20), aft(Q, 20)]).replay.problems
      .some((p) => p.includes('converges on candidate player 20'))).toBe(true);
    // two target records naming the same path
    const twin = converge([record('A1', P), record('A2', P)], [manual('B', 20), aft(P, 20)]);
    expect(twin.problems[0]).toContain('named by 2 target creation records');
    // one candidate player carrying two candidate-only tokens
    expect(converge([record('A', P)], [manual('B', 20), manual('C', 20), aft(P, 20)]).problems[0])
      .toContain('one person with two tokens has no single survivor');
  });

  it('(7) ambiguous AFL Tables path in the candidate: STOP', () => {
    const r = converge([record('A', P)], [manual('B', 20), aft(P, 20), aft(P, 21)]);
    expect(r.entries).toEqual([]);
    expect(r.problems[0]).toContain('also held elsewhere in the candidate');
  });

  it('(8) unaccepted / non-unique AFL Tables identity: STOP', () => {
    // the candidate player's only path row is not accepted: no lineage key at all
    expect(converge([record('A', P)], [manual('B', 20), aft(P, 20, 'ambiguous')]).problems[0])
      .toContain('holds no accepted AFL Tables profile path');
    // an accepted row on the player, but another row for the same path is unaccepted
    expect(converge([record('A', P)], [manual('B', 20), aft(P, 20), aft(P, null, 'unmatched')]).problems[0])
      .toContain('not an accepted afltables_profile_url identity');
    // the candidate token row itself is not accepted and player-linked
    expect(converge([], [manual('B', 20, 'ambiguous'), aft(P, 20)], [aft(P, 900)]).problems[0])
      .toContain('not one accepted, player-linked identity row');
  });

  it('(9) manual-only players: a candidate one with no path STOPs; a target one keeps its own token contract', () => {
    // candidate-only manual-only token: no durable cross-database identity, and no name is read
    const r = predict([record('A', null)], [manual('B', 20)]);
    expect(r.c.entries).toEqual([]);
    expect(r.c.problems[0]).toContain('no durable cross-database identity; a manual-only player is never matched by name');
    expect(r.replay.problems.some((p) => p.includes('candidate manual_admin_edit:B (candidate player 20) has no target creation record'))).toBe(true);
    // a target manual-only registration is its own identity: present when the candidate holds it,
    // re-created by the replay when it does not -- no cross-database match is made either way
    expect(predict([record('A', null)], [manual('A', 20)]).replay).toMatchObject({ present: [{ token: 'A', path: null, playerId: 20 }], problems: [] });
    expect(predict([record('A', null)], []).replay).toMatchObject({ creates: [{ token: 'A', path: null }], problems: [] });
  });

  it('(10) missing candidate player: the target registration re-creates it through the production replay contract', () => {
    const { c, replay } = predict([record('A', P)], []);
    expect(c).toEqual({ entries: [], problems: [] });
    expect(replay).toMatchObject({ creates: [{ token: 'A', path: P }], problems: [] });
    // still fail-closed when the path IS in the candidate but not bindable
    expect(predict([record('A', P)], [aft(P, 20, 'ambiguous')]).replay.problems[0]).toContain('not an accepted afltables_profile_url row');
  });

  it('candidate-only orphan token: the target neither records nor holds P -- STOP, never retired', () => {
    const { c, replay } = predict([], [manual('B', 20), aft(P, 20)], []);
    expect(c.entries).toEqual([]);
    expect(c.problems[0]).toContain('the target neither records a registration for players/P/P_Player.html nor holds it');
    expect(replay.candidateOnlyTokens).toEqual([{ token: 'B', playerId: 20 }]);
    // the planner never reads the target for a player it has no reason to converge
    expect(convergencePathsToRead({ overrides: [record('B', P)], candidate: [manual('B', 20), aft(P, 20)] })).toEqual([]);
    expect(convergencePathsToRead({ overrides: [], candidate: [manual('B', 20), aft(P, 20), aft(Q, 21)] })).toEqual([P]);
  });

  it('a token or path carrying a control character is refused before it can reach the remap file', () => {
    expect(converge([], [manual('B\nDROP', 20), aft(P, 20)], [aft(P, 900)]).problems[0]).toContain('control character');
    expect(converge([], [manual('B', 20), aft('players/P/P\n.html', 20)], [aft('players/P/P\n.html', 900)]).problems[0])
      .toContain('control character');
  });

  // --- retry / idempotence -------------------------------------------------------------------

  it('retry: planning, applying and generating are deterministic and idempotent; a converged state plans nothing', () => {
    const overrides = [record('A', P)];
    const candidate = [aft(Q, 21), manual('C', 21), aft(P, 20), manual('B', 20)];
    const target = [aft(Q, 900, 'unique')];
    const first = converge(overrides, candidate, target);
    expect(first.problems).toEqual([]);
    // same answer on a retried candidate preparation, whatever order the rows are read in
    expect(converge(overrides, [...candidate].reverse(), target)).toEqual(first);
    expect(first.entries.map((e) => e.candidateToken)).toEqual(['B', 'C']);
    const once = applyManualIdentityConvergence(candidate, first.entries);
    expect(applyManualIdentityConvergence(once, first.entries)).toEqual(once);
    // no extra token on retry: exactly one manual identity, the target's
    expect(once.filter((r) => r.sourceKey === 'manual_admin_edit')).toEqual([manual('A', 20)]);
    // the converged state needs nothing further, and the next promotion from it plans nothing either
    expect(converge(overrides, once, target)).toEqual({ entries: [], problems: [] });
    expect(converge(overrides, once, once)).toEqual({ entries: [], problems: [] });
    expect(manualIdentityConvergenceSql(first.entries)).toEqual(manualIdentityConvergenceSql(converge(overrides, candidate, target).entries));
  });

  it('the SQL: guarded writes, a rebind in ONE statement, no ON CONFLICT, a final-state assertion, inside the remap transaction', () => {
    const entries: ManualIdentityConvergenceEntry[] = [
      { kind: 'rebind', path: P, candidateToken: 'B', targetToken: 'A', playerId: 20 },
      { kind: 'retire', path: "players/O/O'Brien.html", candidateToken: 'C', targetToken: null, playerId: 21 },
    ];
    const sql = lineageRemapSql({ candidate: CAND, oldDatabase: 'afldb_dev', environment: 'dev', plans: [], convergence: entries });
    const lines = sql.split('\n');
    const at = (needle: string) => lines.findIndex((l) => l.startsWith(needle));
    const begin = at('BEGIN;');
    const guard = at('DO $bind$ BEGIN');
    const rebind = at('WITH retired AS (DELETE FROM "public"."external_identities"');
    const retire = at('DELETE FROM "public"."external_identities"');
    const assertAt = at('DO $converge$ BEGIN');
    const commit = at('COMMIT;');
    expect(begin).toBeGreaterThan(-1);
    expect([begin, guard, rebind, retire, assertAt, commit]).toEqual([...[begin, guard, rebind, retire, assertAt, commit]].sort((a, b) => a - b));
    expect(new Set([begin, guard, rebind, retire, assertAt, commit]).size).toBe(6);
    const section = lines.slice(rebind, commit).join('\n');
    // the rebind's INSERT reads ONLY the row its DELETE retired: a re-run inserts nothing
    expect(lines[rebind]).toContain("e.external_id = 'B' AND e.player_id = 20");
    expect(lines[rebind]).toContain("a.player_id = 20 AND a.external_id = 'players/P/P_Player.html'");
    expect(lines[rebind]).toContain('RETURNING e.player_id, e.external_name)');
    expect(lines[rebind + 2]).toMatch(/^SELECT .*'A', r\.external_name, r\.player_id, 'resolved', 0, 'manual_admin_edit', .* FROM retired r;$/);
    expect(lines[retire]).toContain("e.external_id = 'C' AND e.player_id = 21");
    expect(lines[retire]).toContain("'players/O/O''Brien.html'");
    expect(section).not.toMatch(/ON CONFLICT/i);
    // the final state is asserted per entry, and over the whole manual set, before COMMIT
    expect(section.match(/RAISE EXCEPTION 'AFLDB-ISSUE-242: (rebind|retire) of/g)).toHaveLength(2);
    expect(section).toContain("= ARRAY['A']::text[]");
    expect(section).toContain("o.entity_key = 'manual_admin_edit:A' AND o.override_values->>'afltables_profile_path' = 'players/P/P_Player.html') = 1");
    expect(section).toContain("= '{}'::text[]");
    expect(section).toContain('a manual_admin_edit identity has no single active creation record after convergence');
    expect(section).toContain('a player carries more than one manual_admin_edit identity after convergence');
    // no name is read or written by the convergence, and the structural remap guard still holds
    expect(section).not.toMatch(/display_name|search_name|given_name|surname/i);
    expect(lineageRemapProblems(sql, [], 'dev')).toEqual([]);
    // nothing converged: the file is byte-for-byte the ISSUE-237 file
    expect(lineageRemapSql({ candidate: CAND, oldDatabase: 'afldb_dev', environment: 'dev', plans: [], convergence: [] }))
      .toBe(lineageRemapSql({ candidate: CAND, oldDatabase: 'afldb_dev', environment: 'dev', plans: [] }));
    expect(manualIdentityConvergenceSql([])).toEqual([]);
  });

  it('the remap step the convergence rides exists in the DEV plan, after the reinstated data_overrides', () => {
    const plan = reinstatePlan({ candidate: CAND, oldDatabase: 'afldb_dev', environment: 'dev',
      preCutoverDump: '/home/arm/backups/afldb/pre.dump', rebuiltDump: '/home/arm/afldb_test_rebuilt.dump' });
    const remap = plan.indexOf('-f "$LINEAGE_REMAP_SQL"');
    expect(remap).toBeGreaterThan(-1);
    expect(plan.indexOf('--table=data_overrides ')).toBeGreaterThan(-1);
    expect(plan.indexOf('--table=data_overrides ')).toBeLessThan(remap);
    expect(plan.lastIndexOf('db:promotion:check -- --phase candidate')).toBeGreaterThan(remap);
  });

  // --- the gates -----------------------------------------------------------------------------

  type Db = { overrides?: PromotionOverrideRow[]; identities?: PromotionIdentityRow[]; log: string[] };
  const db = (s: Db): Query => async (text, params = []) => {
    s.log.push(text);
    const ids = s.identities ?? [];
    const out = (rows: PromotionIdentityRow[]) => rows.map((i) => ({ ...i, playerId: i.playerId === null ? null : String(i.playerId) }));
    if (text === PROMOTION_REPLAY_OVERRIDES_SQL) return (s.overrides ?? []).map((o) => ({ ...o }));
    if (text === PROMOTION_REPLAY_IDENTITIES_SQL) {
      const [keys, xs] = params as [string[], string[]];
      return out(ids.filter((i) => i.sourceKey === 'manual_admin_edit'
        || keys.some((k, n) => k === i.sourceKey && xs[n] === i.externalId)
        || (i.sourceKey === 'afltables' && ids.some((m) => m.sourceKey === 'manual_admin_edit' && m.playerId === i.playerId))));
    }
    if (text === PROMOTION_CONVERGENCE_TARGET_IDENTITIES_SQL) {
      const paths = params[0] as string[];
      const holders = new Set(ids.filter((i) => i.sourceKey === 'afltables' && paths.includes(i.externalId) && i.playerId !== null)
        .map((i) => i.playerId));
      return out(ids.filter((i) => (i.sourceKey === 'afltables' && paths.includes(i.externalId))
        || (i.sourceKey === 'manual_admin_edit' && holders.has(i.playerId))));
    }
    if (text === PROMOTION_REPLAY_MAX_SEASON_SQL) return [{ maxSeason: 2025 }];
    if (text === PROMOTION_REPLAY_PLAYER_CHECKS_SQL) {
      return (params[0] as number[]).map((playerId) => ({
        playerId, hasDob: false, dobConfidence: 'unknown', birthYearMin: null, birthYearMax: null,
      }));
    }
    throw new Error(`fake database: unexpected SQL ${text}`);
  };
  const restored = async (target: Db, candidate: Db) => {
    const report = new Report();
    const out = await gateOverrideReplayTargets({ overrides: db(target), candidate: db(candidate) },
      { overrides: 'target afldb_dev', candidate: `candidate ${CAND}` }, report, { target: db(target), role: 'target afldb_dev' });
    return { report, out };
  };
  const candidatePhase = async (both: Db) => {
    const report = new Report();
    const out = await gateOverrideReplayTargets({ overrides: db(both), candidate: db(both) },
      { overrides: `candidate ${CAND} (reinstated)`, candidate: `candidate ${CAND}` }, report);
    return { report, out };
  };

  let dir: string;
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), 'afldb-issue242-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('B4 (restored): the benign same-path / different-token case now PASSES, and its convergence reaches the remap file', async () => {
    const target: Db = { overrides: [record('A', P)], identities: [manual('A', 900), aft(P, 900)], log: [] };
    const candidate: Db = { identities: [manual('B', 20), aft(P, 20)], log: [] };
    const { report, out } = await restored(target, candidate);
    expect(report.failed).toBe(false);
    expect(report.results.map((r) => r.gate)).toEqual([
      'manual player registration token convergence planned (AFLDB-ISSUE-242)',
      'data_overrides players replay predicted on the candidate (AFLDB-ISSUE-237 A4.2)',
      'data_overrides match-keyed replay targets exist in the candidate (AFLDB-ISSUE-237 A4.3)',
    ]);
    expect(out.convergence.entries).toEqual([{ kind: 'rebind', path: P, candidateToken: 'B', targetToken: 'A', playerId: 20 }]);
    expect(out.players.present).toEqual([{ token: 'A', path: P, playerId: 20 }]);
    // the candidate is never asked for the target's identities, nor the target for the candidate's
    expect(candidate.log).not.toContain(PROMOTION_CONVERGENCE_TARGET_IDENTITIES_SQL);
    expect(target.log).not.toContain(PROMOTION_REPLAY_IDENTITIES_SQL);
    // published only because every gate passed, and it carries the convergence
    const file = join(dir, 'remap.sql');
    publishRestoredLineageRemap(file, lineageRemapSql({ candidate: CAND, oldDatabase: 'afldb_dev', environment: 'dev', plans: [],
      convergence: out.convergence.entries }), report);
    expect(readFileSync(file, 'utf8')).toContain('-- AFLDB-ISSUE-242 — manual player registration token convergence.');
  });

  it('B4 (restored): the retire case reads the target\'s identities for P only', async () => {
    const target: Db = { identities: [aft(P, 900, 'unique'), aft(Q, 901)], log: [] };
    const candidate: Db = { identities: [manual('B', 20), aft(P, 20)], log: [] };
    const { report, out } = await restored(target, candidate);
    expect(report.failed).toBe(false);
    expect(out.convergence.entries).toEqual([{ kind: 'retire', path: P, candidateToken: 'B', targetToken: null, playerId: 20 }]);
    expect(target.log).toContain(PROMOTION_CONVERGENCE_TARGET_IDENTITIES_SQL);
  });

  it('B4 (restored): contradictory and unsupported cases still STOP before the swap, and publish no remap file', async () => {
    const cases: [PromotionOverrideRow[], PromotionIdentityRow[], PromotionIdentityRow[], string][] = [
      [[record('A', P)], [manual('A', 20), aft(Q, 20)], [], 'same token, different path'],
      [[record('A1', P), record('A2', Q)], [manual('B', 20), aft(P, 20), aft(Q, 20)], [], 'holds 2 AFL Tables profile paths'],
      [[record('A', P)], [manual('B', 20), aft(P, 20), aft(P, 21)], [], 'also held elsewhere in the candidate'],
      [[record('A', P)], [manual('B', 20), aft(P, 20, 'ambiguous')], [], 'holds no accepted AFL Tables profile path'],
      [[], [manual('B', 20)], [], 'no durable cross-database identity'],
      [[], [manual('B', 20), aft(P, 20)], [], 'the target neither records a registration'],
    ];
    for (const [overrides, candidateIds, targetIds, expected] of cases) {
      const { report, out } = await restored({ overrides, identities: targetIds, log: [] }, { identities: candidateIds, log: [] });
      expect(report.failed, expected).toBe(true);
      expect([...out.convergence.problems, ...out.players.problems].some((p) => p.includes(expected)), expected).toBe(true);
      const file = join(dir, `remap-${expected.length}.sql`);
      publishRestoredLineageRemap(file, lineageRemapSql({ candidate: CAND, oldDatabase: 'afldb_dev', environment: 'dev', plans: [],
        convergence: out.convergence.entries }), report);
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it('B4 (candidate): after step 2c the converged candidate PASSES; without it the token is the unchanged A4.2 STOP', async () => {
    const overrides = [record('A', P)];
    const before = [manual('B', 20), aft(P, 20)];
    const entries = converge(overrides, before).entries;
    const converged = await candidatePhase({ overrides, identities: applyManualIdentityConvergence(before, entries), log: [] });
    expect(converged.report.failed).toBe(false);
    expect(converged.out.players.present).toEqual([{ token: 'A', path: P, playerId: 20 }]);
    // the candidate phase plans nothing: it never reads a target, and converges nothing itself
    expect(converged.out.convergence).toEqual({ entries: [], problems: [] });
    const skipped = await candidatePhase({ overrides, identities: before, log: [] });
    expect(skipped.report.failed).toBe(true);
    expect(skipped.out.players.problems[0]).toContain('different token, same path');
    expect(skipped.out.players.problems[1]).toContain('candidate manual_admin_edit:B (candidate player 20) has no target creation record');
    // a retired-but-not-applied token is the candidate-only STOP at this phase too
    const retired = await candidatePhase({ overrides: [], identities: [manual('B', 20), aft(P, 20)], log: [] });
    expect(retired.report.failed).toBe(true);
  });

  it('scales to a whole registration set with no per-player rule: every token converges, the final state is capturable', async () => {
    const n = 92;
    const path = (i: number) => `players/X/Player_${i}.html`;
    const half = Math.floor(n / 2);
    const overrides = Array.from({ length: half }, (_, i) => record(`dev-${i}`, path(i)));
    const candidateIds = Array.from({ length: n }, (_, i) => [manual(`cand-${i}`, 100 + i), aft(path(i), 100 + i)]).flat();
    const targetIds = Array.from({ length: n - half }, (_, i) => aft(path(half + i), 9000 + i, 'unique'));
    const { report, out } = await restored({ overrides, identities: targetIds, log: [] }, { identities: candidateIds, log: [] });
    expect(report.failed).toBe(false);
    expect(out.convergence.entries.filter((e) => e.kind === 'rebind')).toHaveLength(half);
    expect(out.convergence.entries.filter((e) => e.kind === 'retire')).toHaveLength(n - half);
    const state = applyManualIdentityConvergence(candidateIds, out.convergence.entries);
    const replay = planPromotionPlayersReplay({ overrides, candidate: state });
    expect(replay.present).toHaveLength(half);
    const promoted = afterReplay(state, replay);
    const capture = registrationsFromLive(live(overrides, promoted));
    expect(capture.problems).toEqual([]);
    expect(capture.registrations.map((r) => r.token).sort()).toEqual(overrides.map((o) => o.entityKey.slice('manual_admin_edit:'.length)).sort());
    expect(await tokenOf(promoted, 100)).toBe('dev-0');
    expect(await tokenOf(promoted, 100 + n - 1)).toBeNull();
    // idempotent: the next promotion from this state converges nothing
    expect(converge(overrides, promoted, promoted)).toEqual({ entries: [], problems: [] });
  });

  it('the restored phase plans the convergence BEFORE the lineage gate that writes it; the candidate phase plans none', () => {
    const source = readFileSync(join(REPO, 'tools', 'db', 'promotion-check.ts'), 'utf8');
    const main = source.slice(source.indexOf('async function main('));
    const restoredBranch = main.slice(main.indexOf("if (phase === 'restored') {"), main.indexOf('if (opts.compare)'));
    const gateAt = restoredBranch.indexOf('gateOverrideReplayTargets({ overrides: old.q, candidate: conn.q }');
    expect(gateAt).toBeGreaterThan(-1);
    expect(restoredBranch).toContain("{ target: old.q, role: `target ${opts.oldDatabase}` }");
    expect(restoredBranch.indexOf('gateLineageIdentity(')).toBeGreaterThan(gateAt);
    expect(restoredBranch).toContain('replay.convergence.entries');
    const candidateBranch = main.slice(main.indexOf("if (phase === 'candidate') {"), main.indexOf('let aflApiTargetCensus'));
    expect(candidateBranch).toContain('gateOverrideReplayTargets({ overrides: conn.q, candidate: conn.q }');
    expect(candidateBranch).not.toContain('target:');
  });
});

describe('AFLDB-ISSUE-242 — code_test_db convergence rehearsal harness (DB-free)', () => {
  it('writes only with --acknowledge code_test_db, and run needs an evidence directory', () => {
    expect(() => parseConvergenceRehearsalArgs(['run', '--out', 'x'])).toThrow(ConvergenceRehearsalRefused);
    expect(() => parseConvergenceRehearsalArgs(['run', '--acknowledge', 'afldb_test', '--out', 'x'])).toThrow(/--acknowledge code_test_db/);
    expect(() => parseConvergenceRehearsalArgs(['teardown', '--acknowledge', 'afldb_dev'])).toThrow(ConvergenceRehearsalRefused);
    expect(() => parseConvergenceRehearsalArgs(['run', '--acknowledge', 'code_test_db'])).toThrow(/--out/);
    expect(() => parseConvergenceRehearsalArgs(['run', '--acknowledge', 'code_test_db', '--out', 'x', '--scale', '0'])).toThrow(/--scale/);
    expect(() => parseConvergenceRehearsalArgs(['run', '--acknowledge', 'code_test_db', '--out', 'x', '--target', 'afldb_dev'])).toThrow(/Unknown flag/);
    expect(parseConvergenceRehearsalArgs(['run', '--acknowledge', 'code_test_db', '--out', 'x'])).toEqual({ step: 'run', out: 'x', scale: 92 });
    expect(parseConvergenceRehearsalArgs(['residue'])).toEqual({ step: 'residue' });
    expect(parseConvergenceRehearsalArgs(['teardown', '--acknowledge', 'code_test_db'])).toEqual({ step: 'teardown' });
  });

  it('keeps every fixture identity in its own namespace: UUID-shaped tokens and valid AFL Tables paths', () => {
    expect(CONVERGENCE_REHEARSAL.database).toBe('code_test_db');
    expect(rehearsalToken('candidate', 1, 1)).toBe('2420cccc-0001-4000-8000-000000000001');
    expect(rehearsalToken('target', 20, 92)).toBe('2420dddd-0020-4000-8000-000000000092');
    expect(rehearsalPath('S', 1)).toBe('players/Z/Zz242_S_1.html');
    expect(worldNamespaceProblems(scaleWorld(92))).toEqual([]);
    expect(worldNamespaceProblems({
      name: 'outside', target: [], records: [],
      candidate: [{ key: 'x', paths: [{ path: 'players/A/Real_Player.html' }], token: 'not-a-fixture-token', record: true }],
    })).toHaveLength(2);
  });

  it('builds the scale world as a deterministic rebind/retire mixture of any size', () => {
    const w = scaleWorld(92);
    expect([w.candidate.length, w.records.length, w.target.filter((t) => t.token === null).length]).toEqual([92, 62, 30]);
    expect(scaleWorld(92)).toEqual(w);
    expect(new Set(w.candidate.map((c) => c.paths[0].path)).size).toBe(92);
    const small = scaleWorld(7);
    expect([small.candidate.length, small.records.length]).toEqual([7, 5]);
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-249 — the first-kick-goal source identity gate
// ---------------------------------------------------------------------------

describe('AFLDB-ISSUE-249 first-kick-goal source identities', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  const EXPECTED = ['fkg-001', 'fkg-002', 'fkg-003'];
  const held = (...ids: string[]): FirstKickGoalObserved[] => ids.map((recordId) => ({ recordId, n: 1 }));
  /** A read-only fake: one answer per database, and it refuses any SQL but the gate's own. */
  const fakeDb = (rows: FirstKickGoalObserved[]) => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const q: Query = async (text, params) => {
      calls.push({ text, params });
      if (text !== FIRST_KICK_GOAL_IDENTITIES_SQL) throw new Error(`unexpected SQL: ${text}`);
      return rows.map((r) => ({ recordId: r.recordId, n: String(r.n) }));
    };
    return { q, calls };
  };

  it('STOPs the observed transition: a non-empty target and an EMPTY candidate', () => {
    const j = judgeFirstKickGoalIdentities({
      expected: EXPECTED,
      subject: { role: 'candidate afldb_dev_candidate_x', observed: [] },
      target: { role: 'target afldb_dev', observed: held('fkg-001', 'fkg-002', 'fkg-003') },
    });
    expect(j.verdict).toBe('FAIL');
    expect(j.missing).toEqual(EXPECTED);
    expect(j.targetMissing).toEqual(EXPECTED);
    expect(j.lines.join('\n')).toMatch(/STOP candidate afldb_dev_candidate_x holds NO first-kick-goal record while 3 are expected and target afldb_dev holds 3 — the AFLDB-ISSUE-249 loss/);
  });

  it('STOPs an empty source even without a target to compare with: the manifest is the expectation', () => {
    const j = judgeFirstKickGoalIdentities({ expected: EXPECTED, subject: { role: 'source afldb_test', observed: [] } });
    expect(j.verdict).toBe('FAIL');
    expect(j.lines.join('\n')).toMatch(/holds NO first-kick-goal record while 3 are expected — the AFLDB-ISSUE-249 loss/);
  });

  it('PASSes exactly the manifest set, with or without a target holding the same set', () => {
    const exact = judgeFirstKickGoalIdentities({ expected: EXPECTED, subject: { role: 'c', observed: held(...EXPECTED) } });
    expect(exact.verdict).toBe('PASS');
    expect([exact.missing, exact.unknown, exact.duplicated, exact.targetMissing]).toEqual([[], [], [], []]);
    const withTarget = judgeFirstKickGoalIdentities({
      expected: EXPECTED, subject: { role: 'c', observed: held('fkg-003', 'fkg-001', 'fkg-002') },
      target: { role: 't', observed: held(...EXPECTED) },
    });
    expect(withTarget.verdict).toBe('PASS');
  });

  it('is semantic, not a count: a partial, an unknown, a NULL or a duplicated id each FAIL', () => {
    // Three rows, but one id swapped for an id the manifest does not carry.
    const swapped = judgeFirstKickGoalIdentities({ expected: EXPECTED, subject: { role: 'c', observed: held('fkg-001', 'fkg-002', 'fkg-999') } });
    expect(swapped.verdict).toBe('FAIL');
    expect(swapped.missing).toEqual(['fkg-003']);
    expect(swapped.unknown).toEqual(['fkg-999']);
    // Three rows, one id twice.
    const dup = judgeFirstKickGoalIdentities({
      expected: EXPECTED, subject: { role: 'c', observed: [{ recordId: 'fkg-001', n: 2 }, { recordId: 'fkg-002', n: 1 }] },
    });
    expect(dup.verdict).toBe('FAIL');
    expect(dup.duplicated).toEqual(['fkg-001 ×2']);
    expect(dup.missing).toEqual(['fkg-003']);
    const nul = judgeFirstKickGoalIdentities({
      expected: EXPECTED, subject: { role: 'c', observed: [...held(...EXPECTED), { recordId: null, n: 1 }] },
    });
    expect(nul.verdict).toBe('FAIL');
    expect(nul.unknown).toEqual(['(null)']);
    const partial = judgeFirstKickGoalIdentities({ expected: EXPECTED, subject: { role: 'c', observed: held('fkg-001') } });
    expect(partial.verdict).toBe('FAIL');
    expect(partial.lines.join('\n')).not.toMatch(/holds NO/); // a STOP, but not the empty-set message
  });

  it('reports a target id the manifest has since retired without refusing its absence', () => {
    const j = judgeFirstKickGoalIdentities({
      expected: EXPECTED, subject: { role: 'c', observed: held(...EXPECTED) },
      target: { role: 't', observed: held(...EXPECTED, 'fkg-004') },
    });
    expect(j.verdict).toBe('PASS');
    expect(j.targetRetired).toEqual(['fkg-004']);
    expect(j.lines.join('\n')).toMatch(/retired in the manifest and correctly absent here: fkg-004/);
  });

  it("only reports, never refuses, the target's own read at pre-cutover", () => {
    const j = judgeFirstKickGoalIdentities({ expected: EXPECTED, subject: { role: 'target afldb_dev', observed: [] }, informational: true });
    expect(j.verdict).toBe('INFO');
    expect(j.lines.join('\n')).not.toMatch(/STOP/);
  });

  it('gate: reads only its own read-only SQL, binds source key and type, and adds one result', async () => {
    const candidate = fakeDb([]);
    const target = fakeDb(held(...EXPECTED));
    const report = new Report();
    const j = await gateFirstKickGoalIdentities({ q: candidate.q, role: 'candidate x' }, ['player_achievements'], report,
      { target: { q: target.q, role: 'target afldb_dev' }, expected: EXPECTED });
    expect(j?.verdict).toBe('FAIL');
    expect(report.results).toEqual([expect.objectContaining({ gate: FIRST_KICK_GOAL_GATE, verdict: 'FAIL' })]);
    expect(candidate.calls).toHaveLength(1);
    expect(target.calls).toHaveLength(1);
    for (const call of [...candidate.calls, ...target.calls]) {
      expect(call.params).toEqual(['wikipedia_first_kick_goal', 'first_kick_goal']);
      expect(call.text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i);
    }
    const passReport = new Report();
    await gateFirstKickGoalIdentities({ q: fakeDb(held(...EXPECTED)).q, role: 'candidate x' }, ['player_achievements'],
      passReport, { expected: EXPECTED });
    expect(passReport.results.map((r) => r.verdict)).toEqual(['PASS']);
  });

  it('gate: an absent player_achievements table FAILs (INFO when only informational), without querying', async () => {
    const db = fakeDb([]);
    const report = new Report();
    await gateFirstKickGoalIdentities({ q: db.q, role: 'candidate x' }, [], report, { expected: EXPECTED });
    await gateFirstKickGoalIdentities({ q: db.q, role: 'target x' }, [], report, { expected: EXPECTED, informational: true });
    expect(report.results.map((r) => r.verdict)).toEqual(['FAIL', 'INFO']);
    expect(db.calls).toEqual([]);
  });

  it('gate: defaults its expectation to the TRACKED manifest', async () => {
    const tracked = trackedExpectedIds();
    expect(tracked.length).toBeGreaterThan(0);
    const j = await gateFirstKickGoalIdentities({ q: fakeDb(held(...tracked)).q, role: 'candidate x' },
      ['player_achievements'], new Report());
    expect(j?.verdict).toBe('PASS');
    const short = await gateFirstKickGoalIdentities({ q: fakeDb(held(...tracked.slice(1))).q, role: 'candidate x' },
      ['player_achievements'], new Report());
    expect(short?.verdict).toBe('FAIL');
    expect(short?.missing).toEqual([tracked[0]]);
  });

  it('owns the manifest-backed fkg set only: a manual first-kick-goal row is not a member (the DEV 334 + 1 shape)', async () => {
    // A table, not a canned answer: every first-kick-goal row whatever its source, filtered and
    // grouped exactly by the gate's bound parameters ($1 = source key, $2 = achievement type).
    type AchievementRow = { sourceKey: string; type: string; recordId: string };
    const tableDb = (rows: AchievementRow[]) => {
      const q: Query = async (text, params) => {
        if (text !== FIRST_KICK_GOAL_IDENTITIES_SQL) throw new Error(`unexpected SQL: ${text}`);
        const [key, type] = params as [string, string];
        const counts = new Map<string, number>();
        for (const r of rows) if (r.sourceKey === key && r.type === type) counts.set(r.recordId, (counts.get(r.recordId) ?? 0) + 1);
        return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([recordId, n]) => ({ recordId, n: String(n) }));
      };
      return q;
    };
    const tracked = trackedExpectedIds();
    const wiki = (ids: readonly string[]): AchievementRow[] => ids.map((recordId) => ({
      sourceKey: 'wikipedia_first_kick_goal', type: 'first_kick_goal', recordId }));
    // The ISSUE-167 acceptance row: manual_admin_edit provenance, a `first_kick_goal:<uuid>` key.
    const manual: AchievementRow = {
      sourceKey: 'manual_admin_edit', type: 'first_kick_goal', recordId: 'first_kick_goal:fdadd8a8-0000-4000-8000-000000000249' };
    const full = [...wiki(tracked), manual];
    expect(full).toHaveLength(tracked.length + 1);

    const report = new Report();
    const pass = await gateFirstKickGoalIdentities({ q: tableDb(full), role: 'candidate x' }, ['player_achievements'], report,
      { target: { q: tableDb(full), role: 'target afldb_dev' } });
    expect(pass?.verdict).toBe('PASS');
    expect([pass?.missing, pass?.unknown, pass?.duplicated, pass?.targetMissing]).toEqual([[], [], [], []]);
    expect(pass?.lines.join('\n')).toContain(`candidate x: ${tracked.length} wikipedia_first_kick_goal row(s), ${tracked.length} distinct id(s)`);
    expect(pass?.lines.join('\n')).not.toMatch(/first_kick_goal:/);

    // Remove one manifest-backed id, the manual row still present: STOP naming exactly that id.
    const victim = tracked[Math.floor(tracked.length / 2)];
    const lost = await gateFirstKickGoalIdentities(
      { q: tableDb(full.filter((r) => r.recordId !== victim)), role: 'candidate x' }, ['player_achievements'], new Report(),
      { target: { q: tableDb(full), role: 'target afldb_dev' } });
    expect(lost?.verdict).toBe('FAIL');
    expect(lost?.missing).toEqual([victim]);
    expect(lost?.targetMissing).toEqual([victim]);
    expect(lost?.unknown).toEqual([]);
    expect(lost?.lines.join('\n')).toContain(`STOP missing 1: ${victim}`);

    // Provenance and duplicate checks are not weakened by the scoping: a duplicated fkg id still FAILs.
    const dup = await gateFirstKickGoalIdentities({ q: tableDb([...full, ...wiki([tracked[0]])]), role: 'candidate x' },
      ['player_achievements'], new Report());
    expect(dup?.verdict).toBe('FAIL');
    expect(dup?.duplicated).toEqual([`${tracked[0]} ×2`]);

    // The rebuild's FINAL VALIDATION checks scope the family the same way: type AND source.
    const { firstKickGoalChecks } = await import('../tools/db/rebuild-test');
    for (const check of firstKickGoalChecks()) {
      expect(check.sql).toContain("s.key = 'wikipedia_first_kick_goal' AND a.achievement_type = 'first_kick_goal'");
    }
  });

  it('is wired into source, candidate and production, the restored target comparison, and pre-cutover (INFO)', () => {
    const src = readFileSync(join(process.cwd(), 'tools', 'db', 'promotion-check.ts'), 'utf8').replace(/\r\n/g, '\n');
    const main = src.slice(src.indexOf('async function main('));
    expect(main).toMatch(/phase === 'source' \|\| phase === 'candidate' \|\| phase === 'production'\) \{\n\s+await gateFirstKickGoalIdentities\(/);
    expect(main).toMatch(/phase === 'pre-cutover'\) \{\n\s+await gateFirstKickGoalIdentities\([^;]*informational: true/);
    // restored: the candidate against the target, inside the block that opened the target,
    // before the lineage gate and so before any remap file can be published.
    const restored = main.slice(main.indexOf("if (phase === 'restored') {"));
    expect(restored.slice(0, restored.indexOf('gateLineageIdentity'))).toMatch(
      /gateFirstKickGoalIdentities\(\{ q: conn\.q, role: `candidate \$\{opts\.database\}` \}, present, report,\n\s+\{ target: \{ q: old\.q/);
  });
});
