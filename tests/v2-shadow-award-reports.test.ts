/**
 * AFLDB V2 Stage 6 — tools/v2/shadow-award-reports.ts: the read-only capture of the Coleman
 * comparison and Brownlow reconciliation reports from a shadow copy.
 *
 * What is proven here, and on what:
 *  - the capture drives the REAL Stage 5 loaders (`src/db/queries/coleman-inputs.ts`,
 *    `brownlow-reconciliation-inputs.ts`) and the real pure builders over in-memory PGlite and
 *    STUB tables (SYNTHETIC rows only; they are NOT migrations 001-110), and its reports are
 *    deep-equal to what the operations-centre callers (`compareColemanSeason`,
 *    `reconcileBrownlowSeasonForAdmin`) produce for the same data and clock;
 *  - the reports validate, and two runs with the same clock are byte-identical;
 *  - every refusal exits 2, writes nothing, never calls the session factory and never prints the
 *    DSN (password, host or whole);
 *  - the code path issues no write: every statement the executor sees is a SELECT/WITH read, the
 *    session statements are the read-only transaction ones, and a recording wrapper proves it;
 *  - the read-only state check refuses a writable transaction before any loader runs;
 *  - the production session (postgres.js `begin` with read-only options, rollback sentinel,
 *    database-name check, `end()`) over a FAKE client.
 *
 * What is NOT proven: anything on a real PostgreSQL (V2-GAP-017). Season 2024 is only a label:
 * it is complete in the committed registry. EVERY FIXTURE IS SYNTHETIC (the Coleman goal facts are
 * those of tests/v2-coleman-publication-fixtures.ts).
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SqlExecutor } from '@afldb/db';
import {
  validateBrownlowReconciliationReport,
  validateColemanComparisonReport,
  type ColemanComparisonReport,
} from '@afldb/derived';
import { createInMemoryPglite, pgliteExecutor, type InMemoryPglite } from '@afldb/testing';

import {
  compareColemanSeason,
  reconcileBrownlowSeasonForAdmin,
  type OperationsDeps,
} from '@/lib/admin/operations-centre';
import type { AdminUser } from '@/lib/auth/session';
import { SeasonRegistryError } from '@/lib/seasons/sealed-seasons';

import {
  MAX_COLEMAN_SPAN,
  READ_ONLY_STATE_SQL,
  SESSION_BEGIN_OPTIONS,
  SESSION_LOCAL_SETTINGS,
  USAGE,
  assertReadOnlyState,
  createPostgresSessionFactory,
  parseCaptureArgs,
  readOnlyGuard,
  runCli,
  type CliDeps,
  type CliResult,
  type ReadSession,
  type SessionFactory,
} from '../tools/v2/shadow-award-reports';
import {
  CONTRACT,
  REGISTRY,
  synthFacts,
  synthIdentities,
  synthMatches,
  synthPath,
} from './v2-coleman-publication-fixtures';

/* ---------------------------------------------------------------------------------------------
 * Mocks: operations-centre imports the session module and the production DB entry points. The
 * equivalence tests below only use its READ callers, with an injected executor.
 * ------------------------------------------------------------------------------------------- */
vi.mock('@/lib/auth/session', () => ({ audit: vi.fn(async () => undefined), requireCapability: vi.fn() }));
vi.mock('@/db/queries/award-proposals', () => ({
  withAwardProposalExecutor: () => { throw new Error('not used by the capture tests'); },
  awardWinnerPromotionPort: { promote: () => { throw new Error('not used by the capture tests'); } },
}));

/* ---------------------------------------------------------------------------------------------
 * STUB tables (SYNTHETIC): only what the Coleman and Brownlow READ loaders select from.
 * ------------------------------------------------------------------------------------------- */
const STUB_SCHEMA = `
  CREATE TYPE link_status AS ENUM ('unique', 'resolved', 'ambiguous', 'unmatched', 'implausible');
  CREATE TYPE round_type AS ENUM ('home_and_away', 'elimination_final', 'qualifying_final', 'semi_final', 'preliminary_final', 'grand_final');
  CREATE TABLE awards (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, slug text NOT NULL UNIQUE);
  CREATE TABLE sources (id smallint PRIMARY KEY, key text NOT NULL UNIQUE);
  CREATE TABLE external_identities (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    source_id smallint NOT NULL REFERENCES sources(id), external_id text NOT NULL,
    player_id integer, match_method text, status link_status NOT NULL);
  CREATE TABLE award_winners (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    award_id integer NOT NULL REFERENCES awards(id), season smallint,
    player_id integer, player_name_raw text NOT NULL, status text NOT NULL DEFAULT 'active',
    source_id smallint, source_record_id text);
  CREATE TABLE matches (
    id integer PRIMARY KEY, season smallint NOT NULL, round_type round_type NOT NULL,
    round_number smallint, is_final boolean NOT NULL,
    home_club_id integer NOT NULL, away_club_id integer NOT NULL);
  CREATE TABLE player_match_stats (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    player_id integer NOT NULL, match_id integer NOT NULL REFERENCES matches(id), club_id integer NOT NULL,
    goals smallint, CONSTRAINT pms_player_match_uq UNIQUE (player_id, match_id));
  CREATE TABLE brownlow_season_votes (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    season smallint NOT NULL, player_id integer NOT NULL, club_id integer,
    votes smallint NOT NULL, vote_rank smallint, eligible_rank smallint,
    is_ineligible boolean NOT NULL DEFAULT false, is_winner boolean NOT NULL DEFAULT false,
    CONSTRAINT brownlow_season_uq UNIQUE (season, player_id));
  -- Read only by the Stage 5 comparator the equivalence test calls (listColemanPublications); always empty.
  CREATE TABLE derived_award_results (
    id integer PRIMARY KEY, award_slug text NOT NULL, season smallint NOT NULL, method_version smallint NOT NULL,
    derivation_version text NOT NULL, input_checksum text NOT NULL, derived_at timestamptz NOT NULL,
    published_at timestamptz NOT NULL, published_by integer NOT NULL, supersedes_id integer, winners jsonb NOT NULL);
  CREATE SCHEMA staging;
  CREATE TABLE staging.afl_api_brownlow_vote (
    source_id smallint NOT NULL, family text NOT NULL, external_record_id text NOT NULL, version_seq integer NOT NULL,
    provider_match_id text NOT NULL, provider_player_id text NOT NULL, provider_team_id text NOT NULL,
    season smallint NOT NULL, api_round_number smallint NOT NULL, canonical_round_number smallint NOT NULL,
    votes smallint NOT NULL, eligible boolean NOT NULL,
    match_id integer, player_id integer, club_id integer,
    PRIMARY KEY (source_id, family, external_record_id, provider_player_id));
  INSERT INTO awards (slug) VALUES ('synthetic-medal'), ('brownlow-medal'), ('coleman');
  INSERT INTO sources (id, key) VALUES (1, 'afltables'), (2, 'manual_admin_edit'), (3, 'afl_api');
`;

const WINNER_A_KEY = `coleman:2024:${synthPath('A')}`;
const NOW = () => new Date('2026-10-19T12:00:00Z');
const GENERATED_AT = '2026-10-19T12:00:00.000Z';

const DSN_VAR = 'SHADOW_REPORT_DSN';
const DSN_PASSWORD = 's3cretPw42';
const DSN_HOST = 'db-host.example.invalid';
const DSN = `postgres://shadow_user:${DSN_PASSWORD}@${DSN_HOST}:5432/afldb_v2_shadow_r1_test`;
const OUT = 'D:/synthetic/out/report.json';

const SUPER_USER: AdminUser = { id: 1, email: 'super@example.invalid', role: 'super_admin', canManageAdmins: true, mustChangePassword: false };

let db: InMemoryPglite;

beforeAll(async () => {
  db = await createInMemoryPglite();
  await db.exec(STUB_SCHEMA);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function seedColeman(): Promise<void> {
  for (const match of synthMatches()) {
    const isFinal = match.roundType !== 'home_and_away';
    await db.query(
      `INSERT INTO matches (id, season, round_type, round_number, is_final, home_club_id, away_club_id)
       VALUES ($1, $2, $3::round_type, $4, $5, $6, $7)`,
      [match.matchId, match.season, match.roundType, isFinal ? null : Number(match.matchId), isFinal, match.homeClubId, match.awayClubId],
    );
  }
  for (const fact of synthFacts()) {
    await db.query(
      'INSERT INTO player_match_stats (player_id, match_id, club_id, goals) VALUES ($1, $2, $3, $4)',
      [fact.playerId, fact.matchId, fact.clubId, fact.goals],
    );
  }
  for (const identity of synthIdentities()) {
    await db.query(
      `INSERT INTO external_identities (source_id, external_id, player_id, match_method, status)
       VALUES (1, $1, $2, $3, $4::link_status)`,
      [identity.externalId, identity.playerId, identity.matchMethod, identity.status],
    );
  }
}

async function seedStoredWinnerA(): Promise<void> {
  await db.query(
    `INSERT INTO award_winners (award_id, season, player_id, player_name_raw, status, source_id, source_record_id)
     VALUES (3, 2024, 11, 'Synthetic Player A', 'active', 1, $1)`, [WINNER_A_KEY]);
}

async function seedBrownlow(): Promise<void> {
  await db.query(
    `INSERT INTO staging.afl_api_brownlow_vote
       (source_id, family, external_record_id, version_seq, provider_match_id, provider_player_id, provider_team_id,
        season, api_round_number, canonical_round_number, votes, eligible, match_id, player_id, club_id)
     VALUES (3, 'brownlow_match_votes', 'SYN_M1', 1, 'SYN_M1', 'SYN_P11', 'SYN_T1', 2024, 1, 1, 3, true, 1, 11, NULL),
            (3, 'brownlow_match_votes', 'SYN_M1', 1, 'SYN_M1', 'SYN_P12', 'SYN_T1', 2024, 1, 1, 2, true, 1, 12, NULL),
            (3, 'brownlow_match_votes', 'SYN_M1', 1, 'SYN_M1', 'SYN_P13', 'SYN_T2', 2024, 1, 1, 1, true, 1, 13, NULL)`);
  await db.query(
    `INSERT INTO brownlow_season_votes (season, player_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner)
     VALUES (2024, 11, 3, 1, 1, false, true), (2024, 12, 2, 2, 2, false, false), (2024, 13, 1, 3, 3, false, false)`);
}

beforeEach(async () => {
  await db.exec(`TRUNCATE award_winners, player_match_stats, matches, brownlow_season_votes,
                          staging.afl_api_brownlow_vote, external_identities RESTART IDENTITY CASCADE`);
  await seedColeman();
});

/* ---------------------------------------------------------------------------------------------
 * Harness: a session over PGlite that opens the same transaction the production one does, and
 * records EVERY statement that reaches the database.
 * ------------------------------------------------------------------------------------------- */
type Probe = {
  statements: string[];
  /** Statements the loaders' executor saw (after the guard). */
  executorStatements: string[];
  closed: number;
  opened: number;
};

function newProbe(): Probe {
  return { statements: [], executorStatements: [], closed: 0, opened: 0 };
}

function pgliteSession(probe: Probe, begin = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`): ReadSession {
  probe.opened += 1;
  return {
    async readOnly<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T> {
      probe.statements.push(begin);
      await db.exec(begin);
      try {
        const inner = pgliteExecutor(db);
        const recording: SqlExecutor = {
          query: (text, params) => {
            probe.statements.push(text);
            probe.executorStatements.push(text);
            return inner.query(text, params);
          },
        };
        return await work(recording);
      } finally {
        probe.statements.push('ROLLBACK');
        await db.exec('ROLLBACK');
      }
    },
    async close() {
      probe.closed += 1;
    },
  };
}

type Run = {
  result: CliResult;
  written: Map<string, string>;
  factory: ReturnType<typeof vi.fn>;
  probe: Probe;
};

async function run(argv: string[], over: Partial<CliDeps> = {}, existing: string[] = [], session?: (probe: Probe) => ReadSession): Promise<Run> {
  const written = new Map<string, string>();
  const probe = newProbe();
  const factory = vi.fn<SessionFactory>(() => (session ? session(probe) : pgliteSession(probe)));
  const result = await runCli(argv, {
    env: { [DSN_VAR]: DSN },
    createSession: factory as unknown as SessionFactory,
    exists: (path) => written.has(path) || existing.includes(path),
    writeFile: (path, text) => {
      if (written.has(path)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      written.set(path, text);
    },
    now: NOW,
    loadRegistry: () => REGISTRY,
    loadContract: () => CONTRACT,
    ...over,
  });
  return { result, written, factory, probe };
}

const COLEMAN_ARGV = ['coleman', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024', '--settled', '--out', OUT];
const BROWNLOW_ARGV = ['brownlow', '--dsn-env', DSN_VAR, '--season', '2024', '--out', OUT];

function output(result: CliResult): string {
  return JSON.stringify(result);
}

function expectNoDsn(result: CliResult): void {
  const text = output(result);
  for (const secret of [DSN, DSN_PASSWORD, DSN_HOST, 'shadow_user']) expect(text).not.toContain(secret);
}

function expectRefused(r: Run, messagePart: string | RegExp): void {
  expect(r.result.exitCode).toBe(2);
  expect(r.written.size).toBe(0);
  expect(r.factory).not.toHaveBeenCalled();
  expect(r.result.lines).toEqual([]);
  expect(r.result.errors.join('\n')).toMatch(messagePart);
  expect(r.result.errors.at(-1)).toBe('Nothing was written.');
  expectNoDsn(r.result);
}

const reportOf = (r: Run): ColemanComparisonReport => JSON.parse(r.written.get(OUT) as string) as ColemanComparisonReport;

/* =============================================================================================
 * 1. Coleman capture
 * =========================================================================================== */
describe('Coleman capture', () => {
  it('writes a valid report whose categories match the Stage 5 expectations for the same seed', async () => {
    await seedStoredWinnerA();
    const r = await run(COLEMAN_ARGV);
    expect(r.result.exitCode).toBe(0);
    expect(r.result.errors).toEqual([]);
    const report = reportOf(r);
    expect(validateColemanComparisonReport(report)).toEqual([]);
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.summary).toEqual({ seasons: 1, agree: 1, disagree: 0, notDerivable: 0 });
    expect(report.seasons[0]).toMatchObject({ season: 2024, category: 'agree', refusal: null });
    expect(report.seasons[0].derivedWinners.map((w) => w.key)).toEqual([WINNER_A_KEY]);
    expect(report.seasons[0].derivedWinners[0].goals).toBe(5);
    expect(r.result.lines.join('\n')).toContain('seasons 1, agree 1, disagree 0, notDerivable 0');
    expect(r.result.lines.join('\n')).toContain(`written  : ${OUT}`);
    expect(r.result.lines.join('\n')).toContain("database 'afldb_v2_shadow_r1_test' from SHADOW_REPORT_DSN");
    expectNoDsn(r.result);
    expect(r.factory).toHaveBeenCalledTimes(1);
    expect(r.factory.mock.calls[0][1]).toBe('afldb_v2_shadow_r1_test');
    expect(r.probe.closed).toBe(1);
  });

  it('is a disagree (missing winner) when no stored row exists, and does not guess', async () => {
    const r = await run(COLEMAN_ARGV);
    expect(r.result.exitCode).toBe(0);
    expect(reportOf(r).seasons[0]).toMatchObject({ category: 'disagree' });
    expect(reportOf(r).seasons[0].missing.map((w) => w.key)).toEqual([WINNER_A_KEY]);
    expect(reportOf(r).summary).toMatchObject({ agree: 0, disagree: 1 });
  });

  it('covers a whole range in ONE report: one outcome per season, the rest not_derivable, stored rows unfiltered', async () => {
    await seedStoredWinnerA();
    await db.query(
      `INSERT INTO award_winners (award_id, season, player_id, player_name_raw, status, source_id, source_record_id)
       VALUES (3, 1990, 12, 'Synthetic Player B', 'active', 1, 'coleman:1990:synthetic')`);
    const r = await run(['coleman', '--dsn-env', DSN_VAR, '--from', '2023', '--through', '2026', '--settled', '--out', OUT]);
    expect(r.result.exitCode).toBe(0);
    const report = reportOf(r);
    expect(validateColemanComparisonReport(report)).toEqual([]);
    expect(report.seasons.map((s) => s.season)).toEqual([2023, 2024, 2025, 2026]);
    expect(report.seasons.find((s) => s.season === 2024)?.category).toBe('agree');
    for (const season of [2023, 2025, 2026]) {
      const entry = report.seasons.find((s) => s.season === season);
      expect(entry?.category).toBe('not_derivable');
      expect(entry?.refusal?.code).toBeTruthy();
      expect(entry?.inputChecksum).toBeNull();
    }
    expect(report.summary).toEqual({ seasons: 4, agree: 1, disagree: 0, notDerivable: 3 });
    expect(report.storedSeasonsWithoutOutcome).toEqual([1990]);
  });

  it('without --settled every season is not_derivable (season_not_settled): the attestation is never assumed', async () => {
    const r = await run(['coleman', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024', '--out', OUT]);
    expect(r.result.exitCode).toBe(0);
    expect(reportOf(r).seasons[0]).toMatchObject({ season: 2024, category: 'not_derivable', refusal: { code: 'season_not_settled' } });
  });

  it('equals the operations-centre comparison report for the same data and clock (the Stage 5 read path is reused)', async () => {
    await seedStoredWinnerA();
    const r = await run(COLEMAN_ARGV);
    const deps: Partial<OperationsDeps> = {
      withExecutor: ((work: (e: unknown) => Promise<unknown>) => work(pgliteExecutor(db))) as unknown as OperationsDeps['withExecutor'],
      loadRegistry: () => REGISTRY,
      loadContract: () => CONTRACT,
      now: NOW,
    };
    const stage5 = await compareColemanSeason(SUPER_USER, { season: 2024, settled: true }, deps);
    expect(stage5.ok).toBe(true);
    if (!stage5.ok) return;
    expect(reportOf(r)).toEqual(JSON.parse(JSON.stringify(stage5.comparison.report)));
  });

  it('is byte-identical when run twice with the same clock (so the parity tool compares content)', async () => {
    await seedStoredWinnerA();
    const first = await run(COLEMAN_ARGV);
    const second = await run(COLEMAN_ARGV);
    expect(first.written.get(OUT)).toBe(second.written.get(OUT));
    expect(first.written.get(OUT)?.endsWith('\n')).toBe(true);
    const later = await run(COLEMAN_ARGV, { now: () => new Date('2026-10-20T00:00:00Z') });
    expect(JSON.parse(later.written.get(OUT) as string).generatedAt).toBe('2026-10-20T00:00:00.000Z');
  });
});

/* =============================================================================================
 * 2. Brownlow capture
 * =========================================================================================== */
describe('Brownlow capture', () => {
  beforeEach(seedBrownlow);

  it('writes a valid reconciliation report for one season', async () => {
    const r = await run(BROWNLOW_ARGV);
    expect(r.result.exitCode).toBe(0);
    const report = JSON.parse(r.written.get(OUT) as string);
    expect(validateBrownlowReconciliationReport(report)).toEqual([]);
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.source).toMatchObject({ sourceKey: 'afl_api', season: 2024, seasonState: 'complete' });
    expect(report.awardResultPresentation.eligibilityRule).toBe('unrecorded');
    expect(r.result.lines.join('\n')).toContain(`outcome ${report.outcome}`);
    expectNoDsn(r.result);
    expect(r.probe.closed).toBe(1);
  });

  it('passes the eligibility rule through, and rejects an unknown one before connecting', async () => {
    const ok = await run([...BROWNLOW_ARGV, '--eligibility-rule', 'stored_eligible_rank_one']);
    expect(ok.result.exitCode).toBe(0);
    expect(JSON.parse(ok.written.get(OUT) as string).awardResultPresentation.eligibilityRule).toBe('stored_eligible_rank_one');
    expectRefused(await run([...BROWNLOW_ARGV, '--eligibility-rule', 'whatever']), /--eligibility-rule must be one of/);
  });

  it('equals the operations-centre report for the same data and clock', async () => {
    const r = await run([...BROWNLOW_ARGV, '--eligibility-rule', 'stored_eligible_rank_one']);
    const deps: Partial<OperationsDeps> = {
      withExecutor: ((work: (e: unknown) => Promise<unknown>) => work(pgliteExecutor(db))) as unknown as OperationsDeps['withExecutor'],
      loadRegistry: () => REGISTRY,
      now: NOW,
    };
    const stage5 = await reconcileBrownlowSeasonForAdmin(SUPER_USER, { season: 2024, eligibilityRule: 'stored_eligible_rank_one' }, deps);
    expect(stage5.ok).toBe(true);
    if (!stage5.ok) return;
    expect(JSON.parse(r.written.get(OUT) as string)).toEqual(JSON.parse(JSON.stringify(stage5.report)));
  });

  it('is byte-identical when run twice with the same clock', async () => {
    const first = await run(BROWNLOW_ARGV);
    const second = await run(BROWNLOW_ARGV);
    expect(first.written.get(OUT)).toBe(second.written.get(OUT));
  });

  it('a season in progress is reported in_progress, not refused', async () => {
    const r = await run(['brownlow', '--dsn-env', DSN_VAR, '--season', '2026', '--out', OUT]);
    expect(r.result.exitCode).toBe(0);
    expect(JSON.parse(r.written.get(OUT) as string).source.seasonState).toBe('in_progress');
  });

  it('inconsistent staged rows refuse (exit 2, nothing written, session closed)', async () => {
    await db.query(`UPDATE staging.afl_api_brownlow_vote SET api_round_number = 2 WHERE provider_player_id = 'SYN_P12'`);
    const r = await run(BROWNLOW_ARGV);
    expect(r.result.exitCode).toBe(2);
    expect(r.written.size).toBe(0);
    expect(r.result.errors[0]).toMatch(/^REFUSED:/);
    expect(r.probe.closed).toBe(1);
  });
});

/* =============================================================================================
 * 3. Refusals: exit 2, nothing written, the session factory never called, the DSN never printed
 * =========================================================================================== */
describe('refusals', () => {
  it('--dsn-env missing, malformed or its variable unset or blank', async () => {
    expectRefused(await run(['coleman', '--from', '2024', '--through', '2024', '--out', OUT]), /--dsn-env <VARIABLE> is required/);
    expectRefused(await run(['coleman', '--dsn-env', 'lower-case', '--from', '2024', '--through', '2024', '--out', OUT]), /--dsn-env must name an environment variable/);
    expectRefused(await run(COLEMAN_ARGV, { env: {} }), /SHADOW_REPORT_DSN is not set/);
    expectRefused(await run(COLEMAN_ARGV, { env: { [DSN_VAR]: '   ' } }), /SHADOW_REPORT_DSN is not set/);
  });

  it.each([
    ['afldb_test', 'afldb_test is the shared integration-test database'],
    ['afldb', 'afldb is production'],
    ['afldb_prod', 'production'],
    ['afldb_dev', 'the development database'],
    ['afldb_restore_test', 'restore-verification'],
    ['code_test_db', 'full-rebuild rehearsal'],
    ['postgres', 'maintenance database'],
    ['afldb_v2_shadow', 'does not match'],
    ['afldb_v2_shadow_test_x', 'does not match'],
    ['some_other_test', 'does not match'],
  ])('a DSN naming %s is not a shadow copy', async (database, reason) => {
    const dsn = `postgres://u:${DSN_PASSWORD}@${DSN_HOST}:5432/${database}`;
    const r = await run(COLEMAN_ARGV, { env: { [DSN_VAR]: dsn } });
    expectRefused(r, new RegExp(`not an isolated shadow copy \\(database '${database}'\\): .*${reason}`));
    expect(output(r.result)).not.toContain(dsn);
  });

  it('a DSN that names no readable database (keyword form, no path) is refused without echoing it', async () => {
    for (const dsn of [`host=${DSN_HOST} dbname=afldb_v2_shadow_r1_test password=${DSN_PASSWORD}`, `postgres://u:${DSN_PASSWORD}@${DSN_HOST}/`]) {
      const r = await run(COLEMAN_ARGV, { env: { [DSN_VAR]: dsn } });
      expectRefused(r, /database <unreadable>/);
    }
  });

  it('inside a test process it refuses unless a session factory was injected, and never builds a real one', async () => {
    const written = new Map<string, string>();
    const result = await runCli(COLEMAN_ARGV, {
      env: { VITEST: 'true', [DSN_VAR]: DSN },
      exists: () => false,
      writeFile: (p, t) => { written.set(p, t); },
      now: NOW,
      loadRegistry: () => REGISTRY,
      loadContract: () => CONTRACT,
    });
    expect(result.exitCode).toBe(2);
    expect(result.errors.join('\n')).toContain('never connects from a test process');
    expect(written.size).toBe(0);
    expectNoDsn(result);
    // The real process.env carries VITEST in this very run: the default deps refuse the same way.
    const viaProcess = await runCli(COLEMAN_ARGV, { env: { ...process.env, [DSN_VAR]: DSN } });
    expect(viaProcess.exitCode).toBe(2);
    expect(viaProcess.errors.join('\n')).toContain('never connects from a test process');
  });

  it('an injected factory in a test process is allowed (this is how the suite runs)', async () => {
    const r = await run(COLEMAN_ARGV, { env: { VITEST: 'true', [DSN_VAR]: DSN } });
    expect(r.result.exitCode).toBe(0);
  });

  it('refuses when --out exists, before any connection', async () => {
    expectRefused(await run(COLEMAN_ARGV, {}, [OUT]), /--out file already exists/);
  });

  it('refuses a late EEXIST from the exclusive writer and an unwritable path; nothing is reported written', async () => {
    const racing = await run(COLEMAN_ARGV, { writeFile: () => { throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); } });
    expect(racing.result.exitCode).toBe(2);
    expect(racing.result.errors.join('\n')).toContain('--out file already exists');
    expect(racing.result.lines).toEqual([]);
    const broken = await run(COLEMAN_ARGV, { writeFile: () => { throw Object.assign(new Error(`ENOENT ${DSN}`), { code: 'ENOENT' }); } });
    expect(broken.result.exitCode).toBe(2);
    expect(broken.result.errors.join('\n')).toContain('could not be written');
    expectNoDsn(broken.result);
  });

  it.each([
    ['--from after --through', ['coleman', '--dsn-env', DSN_VAR, '--from', '2025', '--through', '2024', '--out', OUT], /--from must not be after --through/],
    ['a non-integer season', ['coleman', '--dsn-env', DSN_VAR, '--from', '20x4', '--through', '2024', '--out', OUT], /--from must be a whole year/],
    ['a decimal season', ['coleman', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024.5', '--out', OUT], /--through must be a whole year/],
    ['a negative season', ['brownlow', '--dsn-env', DSN_VAR, '--season', '-1', '--out', OUT], /--season (needs a value|must be a whole year)/],
    ['a season before the first', ['brownlow', '--dsn-env', DSN_VAR, '--season', '1800', '--out', OUT], /from 1897 to 2100/],
    ['a season after the last', ['coleman', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2101', '--out', OUT], /from 1897 to 2100/],
    ['a span over 200 seasons', ['coleman', '--dsn-env', DSN_VAR, '--from', '1897', '--through', '2097', '--out', OUT], /at most 200 seasons/],
    ['a missing season', ['brownlow', '--dsn-env', DSN_VAR, '--out', OUT], /--season must be a whole year/],
    ['a missing --out', ['brownlow', '--dsn-env', DSN_VAR, '--season', '2024'], /--out <file> is required/],
    ['an unknown option', ['coleman', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024', '--out', OUT, '--force'], /--force is not an option of coleman/],
    ['a Coleman option on brownlow', ['brownlow', '--dsn-env', DSN_VAR, '--season', '2024', '--settled', '--out', OUT], /--settled is not an option of brownlow/],
    ['a Brownlow option on coleman', ['coleman', '--dsn-env', DSN_VAR, '--season', '2024', '--out', OUT], /--season is not an option of coleman/],
    ['a repeated option', ['coleman', '--dsn-env', DSN_VAR, '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024', '--out', OUT], /given twice/],
    ['a positional argument', ['coleman', 'extra', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024', '--out', OUT], /unexpected argument extra/],
    ['an unknown command', ['reset', '--dsn-env', DSN_VAR], /must be coleman or brownlow/],
    ['no arguments', [], /must be coleman or brownlow/],
  ] as const)('refuses %s', async (_name, argv, message) => {
    const r = await run([...argv]);
    expectRefused(r, message);
    expect(r.result.errors.join('\n')).toContain(USAGE);
  });

  it('accepts exactly the maximum span of 200 seasons', () => {
    expect(parseCaptureArgs(['coleman', '--dsn-env', DSN_VAR, '--from', '1897', '--through', String(1897 + MAX_COLEMAN_SPAN - 1), '--out', OUT]))
      .toMatchObject({ mode: 'coleman', from: 1897, through: 2096, settled: false });
  });

  it('refuses an unreadable registry or contract before any connection', async () => {
    expectRefused(await run(COLEMAN_ARGV, { loadRegistry: () => { throw new SeasonRegistryError(`registry unreadable at ${DSN}`); } }), /REFUSED: registry unreadable/);
    expectRefused(await run(COLEMAN_ARGV, { loadContract: () => { throw new Error('boom'); } }), /FAILED: boom/);
  });

  it('refuses a report that does not validate (an out-of-range clock), writing nothing', async () => {
    const r = await run(COLEMAN_ARGV, { now: () => new Date('+012345-01-01T00:00:00Z') });
    expect(r.result.exitCode).toBe(2);
    expect(r.written.size).toBe(0);
    expect(r.result.errors.join('\n')).toContain('the Coleman report is invalid');
    expect(r.probe.closed).toBe(1);
  });
});

/* =============================================================================================
 * 4. Read-only discipline
 * =========================================================================================== */
describe('read-only discipline', () => {
  it('Coleman: the session opens a read-only repeatable-read transaction, every loader statement is a read, ROLLBACK is last and once', async () => {
    await seedStoredWinnerA();
    const r = await run(COLEMAN_ARGV);
    expect(r.result.exitCode).toBe(0);
    const { statements, executorStatements } = r.probe;
    expect(statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.filter((s) => s === 'ROLLBACK')).toHaveLength(1);
    expect(executorStatements[0]).toBe(READ_ONLY_STATE_SQL);
    expect(executorStatements.length).toBeGreaterThan(3);
    for (const text of executorStatements) {
      expect(text).toMatch(/^\s*(SELECT|WITH)\b/i);
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM|REINDEX|LOCK)\b/i);
    }
    expect(statements.slice(1, -1)).toEqual(executorStatements);
  });

  it('Brownlow: the same discipline', async () => {
    await seedBrownlow();
    const r = await run(BROWNLOW_ARGV);
    expect(r.result.exitCode).toBe(0);
    expect(r.probe.statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(r.probe.statements.at(-1)).toBe('ROLLBACK');
    for (const text of r.probe.executorStatements) expect(text).toMatch(/^\s*(SELECT|WITH)\b/i);
  });

  it('a transaction that is not read only is refused after the state check, before any loader statement', async () => {
    const r = await run(COLEMAN_ARGV, {}, [], (probe) => pgliteSession(probe, 'BEGIN ISOLATION LEVEL REPEATABLE READ'));
    expect(r.result.exitCode).toBe(2);
    expect(r.written.size).toBe(0);
    expect(r.result.errors.join('\n')).toContain('transaction_read_only = on');
    expect(r.probe.executorStatements).toEqual([READ_ONLY_STATE_SQL]);
    expect(r.probe.closed).toBe(1);
    expect(r.probe.statements.at(-1)).toBe('ROLLBACK');
  });

  it('a transaction that is not repeatable read is refused', async () => {
    const r = await run(COLEMAN_ARGV, {}, [], (probe) => pgliteSession(probe, 'BEGIN READ ONLY'));
    expect(r.result.exitCode).toBe(2);
    expect(r.result.errors.join('\n')).toContain('repeatable read');
    expect(r.probe.executorStatements).toEqual([READ_ONLY_STATE_SQL]);
  });

  it('assertReadOnlyState refuses an empty or off answer', async () => {
    const answer = (rows: object[]): SqlExecutor => ({ query: async () => rows as never });
    await expect(assertReadOnlyState(answer([]))).rejects.toThrow('transaction_read_only = on');
    await expect(assertReadOnlyState(answer([{ transaction_read_only: 'off', transaction_isolation: 'repeatable read' }]))).rejects.toThrow('transaction_read_only = on');
    await expect(assertReadOnlyState(answer([{ transaction_read_only: 'on', transaction_isolation: 'read committed' }]))).rejects.toThrow('repeatable read');
    await expect(assertReadOnlyState(answer([{ transaction_read_only: 'on', transaction_isolation: 'repeatable read' }]))).resolves.toBeUndefined();
  });

  it('the guard forwards reads and refuses every write shape without reaching the database', async () => {
    const seen: string[] = [];
    const guarded = readOnlyGuard({ query: async (text) => { seen.push(text); return [] as never; } });
    await expect(guarded.query('SELECT 1')).resolves.toEqual([]);
    await expect(guarded.query('  with x as (select 1) select * from x')).resolves.toEqual([]);
    for (const text of [
      'INSERT INTO award_winners (season) VALUES (1)',
      'UPDATE matches SET season = 1',
      'DELETE FROM matches',
      'TRUNCATE matches',
      'DROP TABLE matches',
      'WITH d AS (DELETE FROM matches RETURNING *) SELECT * FROM d',
      'SELECT 1; DROP TABLE matches',
      'SELECT * FROM matches FOR UPDATE',
      'SET default_transaction_read_only = off',
      'BEGIN',
      'COMMIT',
      'COPY matches TO PROGRAM \'x\'',
      '',
    ]) {
      await expect(guarded.query(text)).rejects.toThrow('not a read');
    }
    expect(seen).toEqual(['SELECT 1', '  with x as (select 1) select * from x']);
  });

  it('a database error is reported as FAILED with the DSN, its password and its host removed', async () => {
    let closed = 0;
    const r = await run(COLEMAN_ARGV, {}, [], () => ({
      readOnly: async () => { throw new Error(`connect ECONNREFUSED ${DSN_HOST}:5432 using ${DSN} (password ${DSN_PASSWORD})\nstack line`); },
      close: async () => { closed += 1; },
    }));
    expect(r.result.exitCode).toBe(2);
    expect(r.written.size).toBe(0);
    expect(r.result.errors[0]).toMatch(/^FAILED: connect ECONNREFUSED/);
    expect(r.result.errors[0]).not.toContain('stack line');
    expectNoDsn(r.result);
    expect(closed).toBe(1);
  });
});

/* =============================================================================================
 * 5. The production session over a FAKE postgres.js client
 * =========================================================================================== */
describe('production session (fake client)', () => {
  type Events = string[];

  function fakeClient(events: Events, over: { database?: string; readOnlyState?: boolean } = {}) {
    const tx = {
      unsafe: async (text: string) => {
        events.push(text);
        if (text === 'SELECT current_database() AS database_name') return [{ database_name: over.database ?? 'afldb_v2_shadow_r1_test' }];
        if (text === READ_ONLY_STATE_SQL) {
          return [{ transaction_read_only: over.readOnlyState === false ? 'off' : 'on', transaction_isolation: 'repeatable read' }];
        }
        return [{ answer: 1 }];
      },
    };
    return {
      begin: async (options: string, work: (t: typeof tx) => Promise<unknown>) => {
        events.push(`BEGIN ${options}`);
        try {
          return await work(tx);
        } catch (error) {
          events.push('ROLLBACK');
          throw error;
        }
      },
      end: async () => { events.push('END'); },
    };
  }

  it('begins read only + repeatable read, applies the local settings, checks the database, rolls back, ends the client', async () => {
    const events: Events = [];
    const connect = vi.fn(async () => fakeClient(events) as never);
    const factory = createPostgresSessionFactory(connect);
    const session = await factory(DSN, 'afldb_v2_shadow_r1_test');
    expect(connect).toHaveBeenCalledWith(DSN);
    const value = await session.readOnly(async (executor) => {
      expect(await executor.query('SELECT 1 AS answer')).toEqual([{ answer: 1 }]);
      return 'done';
    });
    await session.close();
    expect(value).toBe('done');
    expect(events).toEqual([
      `BEGIN ${SESSION_BEGIN_OPTIONS}`,
      ...SESSION_LOCAL_SETTINGS,
      'SELECT current_database() AS database_name',
      'SELECT 1 AS answer',
      'ROLLBACK',
      'END',
    ]);
    expect(SESSION_BEGIN_OPTIONS).toBe('isolation level repeatable read read only');
    for (const setting of SESSION_LOCAL_SETTINGS) expect(setting).toMatch(/^SET LOCAL [a-z_]+ = '[0-9]+s'$/);
  });

  it('refuses a connection to a database the DSN did not name, before any loader statement', async () => {
    const events: Events = [];
    const session = await createPostgresSessionFactory(async () => fakeClient(events, { database: 'afldb_test' }) as never)(DSN, 'afldb_v2_shadow_r1_test');
    const work = vi.fn(async () => 'never');
    await expect(session.readOnly(work)).rejects.toThrow('not the one the DSN named');
    expect(work).not.toHaveBeenCalled();
    expect(events).toContain('ROLLBACK');
  });

  it('rolls back and rethrows when the work fails, and the whole CLI path ends the client', async () => {
    const events: Events = [];
    const factory = createPostgresSessionFactory(async () => fakeClient(events, { readOnlyState: false }) as never);
    const r = await runCli(COLEMAN_ARGV, {
      env: { [DSN_VAR]: DSN },
      createSession: factory,
      exists: () => false,
      writeFile: () => { throw new Error('must not write'); },
      now: NOW,
      loadRegistry: () => REGISTRY,
      loadContract: () => CONTRACT,
    });
    expect(r.exitCode).toBe(2);
    expect(r.errors.join('\n')).toContain('transaction_read_only = on');
    expect(events.at(-2)).toBe('ROLLBACK');
    expect(events.at(-1)).toBe('END');
    expectNoDsn(r);
  });

  it('the default connect function is lazy: building the factory opens nothing', () => {
    expect(typeof createPostgresSessionFactory()).toBe('function');
  });
});

/* =============================================================================================
 * 6. The default (real) file writer: exclusive create
 * =========================================================================================== */
describe('default writer', () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the file once and refuses to overwrite it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-v2-shadow-reports-'));
    scratch.push(dir);
    const out = join(dir, 'coleman.json');
    const probe = newProbe();
    const deps = (): Partial<CliDeps> => ({
      env: { [DSN_VAR]: DSN },
      createSession: () => pgliteSession(probe),
      now: NOW,
      loadRegistry: () => REGISTRY,
      loadContract: () => CONTRACT,
    });
    const argv = ['coleman', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024', '--settled', '--out', out];
    const first = await runCli(argv, deps());
    expect(first.exitCode).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(validateColemanComparisonReport(JSON.parse(text))).toEqual([]);
    const second = await runCli(argv, deps());
    expect(second.exitCode).toBe(2);
    expect(second.errors.join('\n')).toContain('already exists');
    expect(readFileSync(out, 'utf8')).toBe(text);
    // a refused run creates nothing
    const refused = join(dir, 'refused.json');
    const bad = await runCli(['coleman', '--dsn-env', DSN_VAR, '--from', '2024', '--through', '2024', '--out', refused], { ...deps(), env: { [DSN_VAR]: 'postgres://u:p@h/afldb_test' } });
    expect(bad.exitCode).toBe(2);
    expect(existsSync(refused)).toBe(false);
  });
});
