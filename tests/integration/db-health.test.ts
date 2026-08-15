/**
 * Regression guard for the Database Health page's diagnostics queries,
 * run against the real (test) database rather than mocked, the same
 * reasoning as privileges.test.ts: these queries exist specifically to
 * catch drift between derived and fact tables, so they need to run
 * against real rows to mean anything.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  getCoreSummary,
  getDatabaseSize,
  getLatestRebuilds,
  getLinkQuality,
  getStatEraStarts,
  getSubmissionBacklog,
  listTableRowCounts,
  reconcileCareerTotals,
} from '@/db/queries/db-health';

afterAll(async () => {
  await sql.end();
});

// Kept in sync by hand with privileges.test.ts's OPERATIONAL_TABLES: this
// is a second, independent guard that the health page's table inventory
// -- built on pg_stat_user_tables, which is NOT privilege-filtered --
// never surfaces a table the public role cannot even read.
const OPERATIONAL_TABLES = [
  'auth_users',
  'auth_sessions',
  'auth_audit_log',
  'beta_access_codes',
  'beta_allowed_emails',
  'beta_login_tokens',
  'beta_join_requests',
  'data_submissions',
  'data_submission_rows',
  'admin_invites',
];

describe('db-health queries', () => {
  it('finds no drift between player_career_stats and its source fact tables', async () => {
    const checks = await reconcileCareerTotals();
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.mismatches, check.check).toBe(0);
    }
  });

  it('reports core counts consistent with each other', async () => {
    const core = await getCoreSummary();
    expect(core.players).toBeGreaterThan(0);
    expect(core.matches).toBeGreaterThan(0);
    expect(core.playerGameRows).toBeGreaterThan(0);
    expect(core.playersWithCareerStats).toBeLessThanOrEqual(core.players);
  });

  it('lists real statistical tables but never an operational one', async () => {
    const tables = await listTableRowCounts();
    const names = tables.map((t) => t.table);
    expect(names).toEqual(expect.arrayContaining(['players', 'matches', 'player_match_stats']));
    for (const operational of OPERATIONAL_TABLES) {
      expect(names).not.toContain(operational);
    }
  });

  it('reads the submission backlog through authSql without throwing', async () => {
    const backlog = await getSubmissionBacklog();
    expect(Array.isArray(backlog)).toBe(true);
    for (const row of backlog) {
      expect(row.count).toBeGreaterThan(0);
    }
  });

  it('reads rebuild log, link quality, stat eras and database size without throwing', async () => {
    const [rebuilds, linkQuality, statEras, size] = await Promise.all([
      getLatestRebuilds(5),
      getLinkQuality(),
      getStatEraStarts(),
      getDatabaseSize(),
    ]);
    expect(Array.isArray(rebuilds)).toBe(true);
    expect(linkQuality.length).toBeGreaterThan(0);
    expect(statEras.length).toBeGreaterThan(0);
    expect(size.bytes).toBeGreaterThan(0);
  });
});
