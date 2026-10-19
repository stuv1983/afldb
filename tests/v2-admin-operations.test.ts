/**
 * AFLDB V2 Stage 5 (plan D9, V2-GAP-021) — the operations centre's SERVER WIRING.
 *
 * What is proven here, and on what:
 *  - the read loaders (sealed-season registry, Coleman inputs, Brownlow inputs): captured SQL is
 *    parameterised, ids are numbers, NULL goals and NULL ids stay NULL (FAKE executor);
 *  - the server callers (`src/lib/admin/operations-centre.ts`) end to end on in-memory PGlite:
 *    migration 111 and 112 applied VERBATIM, the real service SQL and the real loader SQL running as
 *    the stub `afldb_import` role, over STUB prerequisite tables;
 *  - the Server Actions (`src/app/admin/operations/**`): the guard is the first statement and
 *    refuses anonymous, contributor and (for edit actions) plain admin; the audit rows;
 *  - negative controls are recorded in the Launch D return (a guard/assertion removed -> a test
 *    fails -> restored).
 *
 * What is NOT proven: anything on a real PostgreSQL (V2-GAP-017). PGlite is not evidence for it, the
 * stubs below are NOT migrations 001-110, and the production promotion port
 * (`insertAwardWinner`) does not run here: a STUB port writes a stub `award_winners` row.
 * EVERY FIXTURE IS SYNTHETIC: names, ids, goals, votes and profile paths are invented; season 2024
 * is only a label (it is sealed in the real registry), and the Coleman goal facts are the
 * SYNTHETIC ones of tests/v2-coleman-publication-fixtures.ts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CuratedAwardError, createProposal, validateProposal, type ProposalInput } from '@afldb/admin';
import type { ApprovedWinnerRevisionPort, AwardPromotionPort, CuratedAwardsViewer } from '@afldb/admin';
import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';
import {
  ColemanProjectionRefusal,
  type ColemanDerivation,
  type ColemanProjectionRequest,
  type ColemanProjectionResult,
} from '@afldb/derived';
import { sealedSeasonsFrom } from '@afldb/domain';
import { createInMemoryPglite, pgliteExecutor, type InMemoryPglite } from '@afldb/testing';

import {
  approveCuratedProposalAction,
  createCuratedProposalsAction,
  rejectCuratedProposalAction,
  validateCuratedProposalAction,
} from '@/app/admin/operations/awards/actions';
import { compareColemanSeasonAction, publishColemanSeasonAction } from '@/app/admin/operations/coleman/actions';
import { parseCreateForm, parseProposalId, parseSeason } from '@/app/admin/operations/form';
import { BrownlowInputError, loadBrownlowReconciliationInput } from '@/db/queries/brownlow-reconciliation-inputs';
import {
  listColemanPublications,
  loadColemanContract,
  loadColemanDerivationInput,
  loadStoredColemanWinners,
} from '@/db/queries/coleman-inputs';
import {
  OPERATIONS_AUDIT_ACTIONS,
  approveCurated,
  compareColemanSeason,
  createCuratedFromFile,
  listColemanPublicationsForAdmin,
  listCuratedQueue,
  publishColemanSeason,
  readCuratedHistory,
  reconcileBrownlowSeasonForAdmin,
  rejectCurated,
  reviseApprovedCurated,
  validateCurated,
  type OperationsDeps,
} from '@/lib/admin/operations-centre';
import { audit, requireCapability, type AdminUser } from '@/lib/auth/session';
import { hasCapability, type Capability } from '@/lib/auth/capabilities';
import {
  SeasonRegistryError,
  loadSealedSeasons,
  loadSeasonRegistry,
} from '@/lib/seasons/sealed-seasons';

import {
  CONTRACT,
  REGISTRY,
  synthFacts,
  synthIdentities,
  synthMatches,
  synthPath,
} from './v2-coleman-publication-fixtures';

/* ---------------------------------------------------------------------------------------------
 * Mocks: the session module (guard + audit) and the production DB entry points, which the Server
 * Actions reach through the caller's DEFAULT dependencies.
 * ------------------------------------------------------------------------------------------- */

const session = vi.hoisted(() => ({
  actor: null as null | { id: number; email: string; role: 'contributor' | 'admin' | 'super_admin'; canManageAdmins: boolean; mustChangePassword: boolean },
}));
const bridge = vi.hoisted(() => ({
  withExecutor: null as null | (<T>(work: (executor: unknown) => Promise<T>) => Promise<T>),
  promote: null as null | ((tx: unknown, request: unknown) => Promise<{ entityKey: string }>),
  // The PRODUCTION Coleman projection port is mocked here (it needs the real award_winners table and a
  // postgres.js transaction, which PGlite stubs cannot host): its SQL is proven on PostgreSQL in
  // tests/integration/v2-coleman-publication.test.ts. These spies record that the operations centre
  // calls it on every publication and previews through it.
  project: vi.fn<(tx: unknown, request: ColemanProjectionRequest) => Promise<ColemanProjectionResult>>(),
  preview: vi.fn<(executor: unknown, derivation: ColemanDerivation) => Promise<unknown>>(),
}));

vi.mock('@/lib/auth/session', async () => {
  const { hasCapability: realHasCapability } = await import('@/lib/auth/capabilities');
  return {
    // The real guard redirects (throws NEXT_REDIRECT) when there is no session or the capability is missing.
    requireCapability: vi.fn(async (capability: Capability) => {
      if (session.actor === null || !realHasCapability(session.actor, capability)) throw new Error('NEXT_REDIRECT');
      return session.actor;
    }),
    audit: vi.fn(async () => undefined),
  };
});

vi.mock('@/db/queries/award-proposals', () => ({
  withAwardProposalExecutor: (work: (executor: unknown) => Promise<unknown>) => {
    if (bridge.withExecutor === null) throw new Error('test bridge not installed');
    return bridge.withExecutor(work);
  },
  awardWinnerPromotionPort: {
    promote: (tx: unknown, request: unknown) => {
      if (bridge.promote === null) throw new Error('test bridge not installed');
      return bridge.promote(tx, request);
    },
  },
  // V2-GAP-018: the real revision port is not used here; revisions inject `deps.revision` (see makeDeps).
  awardWinnerRevisionPort: {
    revise: async () => { throw new Error('the real revision port is not used in this suite'); },
  },
}));

vi.mock('@/db/queries/coleman-award-winners', () => ({
  colemanAwardWinnerProjection: {
    project: (tx: unknown, request: ColemanProjectionRequest) => bridge.project(tx, request),
    preview: (executor: unknown, derivation: ColemanDerivation) => bridge.preview(executor, derivation),
  },
}));

/** A STUB projection: reports every derived winner as inserted and writes nothing. */
function stubProjection(request: ColemanProjectionRequest): ColemanProjectionResult {
  const winners = request.derivation.winners;
  return {
    projectionId: null,
    actions: winners.map((winner) => ({ entityKey: `afltables:${winner.key}`, action: 'inserted' as const, awardWinnerId: null })),
    counts: { inserted: winners.length, updated: 0, voided: 0, retained: 0 },
    changedCount: winners.length,
    revalidatePaths: ['/awards', '/awards/coleman', `/awards/coleman/${request.derivation.season}`],
  };
}

const auditMock = vi.mocked(audit);
const guardMock = vi.mocked(requireCapability);

/* ---------------------------------------------------------------------------------------------
 * Actors
 * ------------------------------------------------------------------------------------------- */

const SUPER_USER: AdminUser = { id: 1, email: 'super@example.invalid', role: 'super_admin', canManageAdmins: true, mustChangePassword: false };
const PLAIN_ADMIN: AdminUser = { id: 2, email: 'admin@example.invalid', role: 'admin', canManageAdmins: false, mustChangePassword: false };
const CONTRIBUTOR_USER: AdminUser = { id: 3, email: 'contributor@example.invalid', role: 'contributor', canManageAdmins: false, mustChangePassword: false };

const NOW = () => new Date('2026-10-19T12:00:00Z');
const OPTIONS = { now: NOW };
// SYNTHETIC sealed range 1897-1899: curated fixtures in 1990 are OPEN under it. REAL_SEALED is the
// committed registry: 1990 and 2024 are sealed in it, 2026 is in progress.
const SYNTHETIC_OPEN = { from: 1897, through: 1899, open: [] as number[] };
const REAL_SEALED = sealedSeasonsFrom(REGISTRY);

/* ---------------------------------------------------------------------------------------------
 * STUB PREREQUISITES (SYNTHETIC). Minimal stand-ins for the tables migrations 111/112 and the
 * loaders read. Each is a stub written for this test, NOT the real schema (plan D2, R-017); the
 * column lists mirror the real migrations (cited in the Launch D return) for the columns used.
 * ------------------------------------------------------------------------------------------- */
const STUB_PREREQUISITES = `
  CREATE ROLE afldb_import NOLOGIN;
  CREATE ROLE afldb_auth NOLOGIN;
  CREATE ROLE afldb_app NOLOGIN;

  CREATE TYPE link_status AS ENUM ('unique', 'resolved', 'ambiguous', 'unmatched', 'implausible');
  CREATE TYPE round_type AS ENUM ('home_and_away', 'elimination_final', 'qualifying_final', 'semi_final', 'preliminary_final', 'grand_final');

  CREATE TABLE auth_users (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, email text NOT NULL);
  CREATE TABLE seasons (year smallint PRIMARY KEY);
  CREATE TABLE awards (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, slug text NOT NULL UNIQUE,
    name text NOT NULL, category text NOT NULL);
  CREATE TABLE players (id integer PRIMARY KEY, display_name text NOT NULL);
  CREATE TABLE clubs (id integer PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL);
  CREATE TABLE sources (id smallint PRIMARY KEY, key text NOT NULL UNIQUE);
  -- No UNIQUE (source_id, external_id) in the stub, so the AMBIGUOUS-identity case can be staged.
  CREATE TABLE external_identities (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    source_id smallint NOT NULL REFERENCES sources(id), external_id text NOT NULL,
    player_id integer, match_method text, status link_status NOT NULL);
  CREATE TABLE award_winners (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    award_id integer NOT NULL REFERENCES awards(id), season smallint,
    player_id integer, player_name_raw text NOT NULL,
    club_id integer, votes numeric(8,2), position text,
    is_captain boolean NOT NULL DEFAULT false, is_vice_captain boolean NOT NULL DEFAULT false,
    note text, status text NOT NULL DEFAULT 'active',
    source_id smallint, source_record_id text);
  CREATE TABLE matches (
    id integer PRIMARY KEY, season smallint NOT NULL, round_type round_type NOT NULL,
    round_number smallint, is_final boolean NOT NULL,
    home_club_id integer NOT NULL, away_club_id integer NOT NULL);
  CREATE TABLE player_match_stats (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    player_id integer NOT NULL, match_id integer NOT NULL REFERENCES matches(id), club_id integer NOT NULL,
    goals smallint,
    CONSTRAINT pms_player_match_uq UNIQUE (player_id, match_id));
  CREATE TABLE brownlow_season_votes (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    season smallint NOT NULL, player_id integer NOT NULL, club_id integer,
    votes smallint NOT NULL, vote_rank smallint, eligible_rank smallint,
    is_ineligible boolean NOT NULL DEFAULT false, is_winner boolean NOT NULL DEFAULT false,
    CONSTRAINT brownlow_season_uq UNIQUE (season, player_id));
  CREATE SCHEMA staging;
  CREATE TABLE staging.afl_api_brownlow_vote (
    source_id smallint NOT NULL, family text NOT NULL, external_record_id text NOT NULL, version_seq integer NOT NULL,
    provider_match_id text NOT NULL, provider_player_id text NOT NULL, provider_team_id text NOT NULL,
    season smallint NOT NULL, api_round_number smallint NOT NULL, canonical_round_number smallint NOT NULL,
    votes smallint NOT NULL, eligible boolean NOT NULL,
    match_id integer, player_id integer, club_id integer,
    PRIMARY KEY (source_id, family, external_record_id, provider_player_id));

  -- STUB grants: what the real import-writable registry / staging blanket grants give afldb_import.
  GRANT USAGE ON SCHEMA staging TO afldb_import;
  GRANT SELECT ON staging.afl_api_brownlow_vote TO afldb_import;
  GRANT SELECT ON auth_users, seasons, awards, players, clubs, sources, external_identities, award_winners,
                  matches, player_match_stats, brownlow_season_votes TO afldb_import;
  GRANT INSERT ON award_winners TO afldb_import;
  GRANT USAGE ON SEQUENCE award_winners_id_seq TO afldb_import;

  -- STUB seed (SYNTHETIC; no real people, results or identities).
  INSERT INTO auth_users (email) VALUES ('super@example.invalid'), ('admin@example.invalid'), ('contributor@example.invalid');
  INSERT INTO seasons (year) VALUES (1990), (1991), (2024), (2025), (2026);
  INSERT INTO awards (slug, name, category) VALUES
    ('synthetic-medal', 'Synthetic Medal', 'award'),
    ('brownlow-medal', 'Brownlow Medal', 'award'),
    ('coleman', 'Synthetic Coleman', 'award');
  INSERT INTO clubs (id, slug, name) VALUES
    (1, 'synthetic-club', 'Synthetic Club A'), (2, 'synthetic-club-b', 'Synthetic Club B'),
    (3, 'synthetic-club-c', 'Synthetic Club C'), (4, 'synthetic-club-d', 'Synthetic Club D');
  INSERT INTO sources (id, key) VALUES (1, 'afltables'), (2, 'manual_admin_edit'), (3, 'afl_api');
  INSERT INTO players (id, display_name) VALUES
    (1, 'Synthetic Player One'), (2, 'Synthetic Player Two'), (3, 'Synthetic Player Three'),
    (11, 'Synthetic Player A'), (12, 'Synthetic Player B'), (13, 'Synthetic Player C'), (14, 'Synthetic Player D'),
    (15, 'Synthetic Player E'), (16, 'Synthetic Player F'), (17, 'Synthetic Player G'), (18, 'Synthetic Player H');
  INSERT INTO external_identities (source_id, external_id, player_id, match_method, status) VALUES
    (1, 'players/s/synthetic_one.html', 1, 'afltables_profile_url', 'unique'),
    (1, 'players/s/synthetic_two.html', 2, 'afltables_profile_url', 'unique');
`;

const ID_ONE = 'afltables:players/s/synthetic_one.html';
const ID_TWO = 'afltables:players/s/synthetic_two.html';

const MIGRATION_111 = join(process.cwd(), 'src', 'db', 'migrations', '111_curated_award_proposals.sql');
const MIGRATION_112 = join(process.cwd(), 'src', 'db', 'migrations', '112_derived_award_results.sql');
const MIGRATION_113 = join(process.cwd(), 'src', 'db', 'migrations', '113_brownlow_eligibility_decisions.sql');
const MIGRATION_114 = join(process.cwd(), 'src', 'db', 'migrations', '114_award_projections_and_curated_revisions.sql');

let db: InMemoryPglite;

async function one<T extends object>(text: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(text, params);
  return rows[0];
}
async function count(table: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).n;
}

/** Runs `work` as the stub afldb_import role (the role the production executor connects as). */
async function asImportExecutor<T>(work: (executor: TransactionalSqlExecutor) => Promise<T>): Promise<T> {
  await db.query('SET ROLE afldb_import');
  try {
    return await work(pgliteExecutor(db));
  } finally {
    await db.query('RESET ROLE');
  }
}

const STUB_REVALIDATE_PATHS = ['/awards', '/awards/synthetic-medal', '/awards/synthetic-medal/1990'];

/** A STUB promotion port: writes a stub award_winners row. It is NOT insertAwardWinner. */
function stubPromotion(options: { fail?: 'after_write_refusal' | 'after_write_error' } = {}): AwardPromotionPort {
  return {
    async promote(tx, request) {
      const [row] = await tx.query<{ id: number }>(
        `INSERT INTO award_winners (award_id, season, player_id, player_name_raw, club_id, votes, position,
                                    is_captain, is_vice_captain, note, status, source_record_id)
         VALUES ($1::int, $2::smallint, $3::int, $4, $5::int, $6::numeric, $7, $8, $9, $10, 'active', $11)
         RETURNING id::int AS id`,
        [request.awardId, request.season, request.playerId, request.playerNameRaw, request.clubId,
          request.votes, request.position, request.isCaptain, request.isViceCaptain, request.note,
          `stub:${request.proposalKey}:${request.revision}`],
      );
      if (options.fail === 'after_write_refusal') throw new CuratedAwardError('promotion_refused', 'STUB promotion refused after writing');
      if (options.fail === 'after_write_error') throw new Error('STUB boom: connection reset by peer');
      // V2-GAP-024: the production port returns the paths of the row it wrote; the stub returns fixed ones.
      return { entityKey: `manual_admin_edit:stub-award-winner-${row.id}`, revalidatePaths: STUB_REVALIDATE_PATHS };
    },
  };
}

type Spies = { withExecutor: ReturnType<typeof vi.fn>; loadSealed: ReturnType<typeof vi.fn>; promote: ReturnType<typeof vi.fn> };

/** Dependencies over PGlite, with spies on the three things whose NON-use some tests assert. */
function makeDeps(over: Partial<OperationsDeps> = {}, promotion: AwardPromotionPort = stubPromotion()): { deps: Partial<OperationsDeps>; spies: Spies } {
  const withExecutor = vi.fn(asImportExecutor);
  const loadSealed = vi.fn(() => REAL_SEALED);
  const promote = vi.fn(promotion.promote.bind(promotion));
  const deps: Partial<OperationsDeps> = {
    withExecutor: withExecutor as unknown as OperationsDeps['withExecutor'],
    promotion: { promote },
    loadSealed,
    loadRegistry: () => REGISTRY,
    loadContract: () => CONTRACT,
    now: NOW,
    ...over,
  };
  return { deps, spies: { withExecutor, loadSealed, promote } };
}

function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    awardSlug: 'synthetic-medal',
    season: 1990,
    playerIdentity: ID_ONE,
    playerNameRaw: 'Synthetic Player One',
    clubSlug: 'synthetic-club',
    votes: '12.50',
    sourceKind: 'manual_entry',
    citation: 'SYNTHETIC citation for tests',
    acquiredOn: '2026-10-19',
    ...overrides,
  };
}

/**
 * Seed a proposal straight through the services (no audit row), optionally validated. Created by a
 * DIFFERENT super admin (stub user 2) than the one the tests approve as (user 1), so the four-eyes
 * rule (V2-GAP-019) is satisfied without an attestation; the self-approval paths have their own tests.
 */
const SEEDING_SUPER_VIEWER: CuratedAwardsViewer = { role: 'super_admin', canManageAdmins: true, userId: 2 };
async function seedProposal(overrides: Partial<ProposalInput> = {}, validated = true): Promise<number> {
  return asImportExecutor(async (executor) => {
    const created = await createProposal(SEEDING_SUPER_VIEWER, executor, proposal(overrides), OPTIONS);
    if (validated) await validateProposal(SEEDING_SUPER_VIEWER, executor, { proposalId: created.id }, OPTIONS);
    return created.id;
  });
}

function fileText(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    format: 'afldb-award-proposals',
    version: 1,
    defaults: { source_kind: 'offline_file', citation: 'SYNTHETIC file citation', acquired_on: '2026-10-19' },
    proposals: rows,
  });
}
const fileRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  award_slug: 'synthetic-medal', season: 1990, player_identity: ID_ONE, player_name: 'Synthetic Player One',
  club_slug: 'synthetic-club', votes: '12.50', ...over,
});

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
}

function auditActions(): string[] {
  return auditMock.mock.calls.map((call) => call[0]);
}

const LONG_NOTE = 'SYNTHETIC reviewer note: checked against the annual report.';
const SELF_ATTESTATION = 'SYNTHETIC attestation: no second reviewer is available this week.';

beforeAll(async () => {
  db = await createInMemoryPglite();
  await db.exec(STUB_PREREQUISITES);
  // The migrations under test, applied VERBATIM from disk (not edited to suit PGlite).
  await db.exec(readFileSync(MIGRATION_111, 'utf8'));
  await db.exec(readFileSync(MIGRATION_112, 'utf8'));
  await db.exec(readFileSync(MIGRATION_113, 'utf8'));
  await db.exec(readFileSync(MIGRATION_114, 'utf8'));
  bridge.withExecutor = asImportExecutor as unknown as typeof bridge.withExecutor;
  bridge.promote = (tx, request) => stubPromotion().promote(tx as SqlExecutor, request as Parameters<AwardPromotionPort['promote']>[1]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.query('RESET ROLE');
  await db.exec(`TRUNCATE award_proposal_decisions, award_proposals, award_winners, derived_award_projections,
                          derived_award_results, brownlow_eligibility_decisions,
                          player_match_stats, matches, brownlow_season_votes, staging.afl_api_brownlow_vote RESTART IDENTITY CASCADE`);
  await db.exec('DELETE FROM external_identities WHERE player_id >= 11');
  session.actor = null;
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  guardMock.mockClear();
  bridge.project.mockReset();
  bridge.project.mockImplementation(async (_tx, request) => stubProjection(request));
  bridge.preview.mockReset();
  bridge.preview.mockResolvedValue({
    ok: true, counts: { inserted: 1, updated: 0, voided: 0, retained: 0 }, changedCount: 1,
    actions: [{ entityKey: `afltables:${WINNER_A_KEY}`, action: 'inserted', awardWinnerId: null }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** SYNTHETIC Coleman data for season 2024: the fixtures of tests/v2-coleman-publication-fixtures.ts. */
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

const WINNER_A_KEY = `coleman:2024:${synthPath('A')}`;

/* =============================================================================================
 * 1. The sealed-season loader (fail closed)
 * =========================================================================================== */
describe('sealed-season loader', () => {
  const scratch: string[] = [];
  const projectWith = (registry: string | null): string => {
    const root = mkdtempSync(join(tmpdir(), 'afldb-v2-seasons-'));
    scratch.push(root);
    if (registry !== null) {
      mkdirSync(join(root, 'data', 'reference'), { recursive: true });
      writeFileSync(join(root, 'data', 'reference', 'seasons.json'), registry);
    }
    return root;
  };
  afterAll(() => {
    for (const root of scratch) rmSync(root, { recursive: true, force: true });
  });

  it('reads the committed registry and builds the same range as the settle CLIs', () => {
    const sealed = loadSealedSeasons(process.cwd());
    expect(sealed).toEqual(sealedSeasonsFrom(JSON.parse(readFileSync(join(process.cwd(), 'data', 'reference', 'seasons.json'), 'utf8'))));
    // The loader returns the three fields the seal reads, validated.
    expect(loadSeasonRegistry(process.cwd())).toEqual({
      first_season: REGISTRY.first_season,
      last_season: REGISTRY.last_season,
      in_progress_seasons: REGISTRY.in_progress_seasons,
    });
  });

  it('a missing registry file throws, it never defaults to "open"', () => {
    expect(() => loadSealedSeasons(projectWith(null))).toThrow(SeasonRegistryError);
    expect(() => loadSeasonRegistry(projectWith(null))).toThrow(/could not be read/);
  });

  it.each([
    ['malformed JSON', '{ not json'],
    ['a JSON array', '[]'],
    ['a missing first_season', JSON.stringify({ last_season: 2026, in_progress_seasons: [2026] })],
    ['a non-integer last_season', JSON.stringify({ first_season: 1897, last_season: '2026', in_progress_seasons: [] })],
    ['in_progress_seasons that is not a list of integers', JSON.stringify({ first_season: 1897, last_season: 2026, in_progress_seasons: ['2026'] })],
    ['first_season after last_season', JSON.stringify({ first_season: 2030, last_season: 2026, in_progress_seasons: [] })],
    ['every season in progress', JSON.stringify({ first_season: 2026, last_season: 2026, in_progress_seasons: [2026] })],
  ])('refuses %s', (_label, registry) => {
    expect(() => loadSealedSeasons(projectWith(registry))).toThrow(SeasonRegistryError);
  });
});

/* =============================================================================================
 * 2. Loaders against a FAKE executor: parameterised SQL, ids as numbers, NULL stays NULL
 * =========================================================================================== */
type Call = { text: string; params: readonly unknown[] };
function fakeExecutor(respond: (text: string, params: readonly unknown[]) => object[]): SqlExecutor & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async query<R extends object>(text: string, params: readonly unknown[] = []): Promise<R[]> {
      calls.push({ text, params });
      return respond(text, params) as R[];
    },
  };
}

describe('Coleman loaders (fake executor)', () => {
  const request = { season: 2024, settled: true, derivedAt: '2026-10-19T00:00:00.000Z', registry: REGISTRY, contract: CONTRACT };

  it('reads the committed contract', () => {
    expect(loadColemanContract(process.cwd())).toEqual(CONTRACT);
  });

  it('is parameterised, coerces ids to numbers, and keeps NULL goals NULL (and a recorded 0 a 0)', async () => {
    const executor = fakeExecutor((text) => {
      if (text.includes('FROM matches m')) return [{ matchId: '10', season: '2024', roundType: 'home_and_away', homeClubId: '1', awayClubId: 2 }];
      if (text.includes('FROM player_match_stats pms') && !text.includes('external_identities')) {
        return [
          { matchId: 10, playerId: '11', clubId: '1', goals: null },
          { matchId: 10, playerId: '12', clubId: '1', goals: 0 },
          { matchId: 10, playerId: '13', clubId: '2', goals: '3' },
        ];
      }
      return [{ playerId: '11', matchMethod: 'afltables_profile_url', externalId: 'players/S/x.html', status: 'unique' }];
    });
    const input = await loadColemanDerivationInput(executor, request);

    expect(input.matches).toEqual([{ matchId: 10, season: 2024, roundType: 'home_and_away', homeClubId: 1, awayClubId: 2 }]);
    expect(input.playerMatchGoals.map((fact) => fact.goals)).toEqual([null, 0, 3]);
    expect(input.playerMatchGoals.every((fact) => typeof fact.playerId === 'number' && typeof fact.clubId === 'number')).toBe(true);
    expect(input.identities).toEqual([{ playerId: 11, matchMethod: 'afltables_profile_url', externalId: 'players/S/x.html', status: 'unique' }]);
    expect(input.seasonState).toEqual({ registry: REGISTRY, settled: true });
    expect(input.derivedAt).toBe(request.derivedAt);

    expect(executor.calls).toHaveLength(3);
    for (const call of executor.calls) {
      expect(call.params).toContain(2024);
      // The season is a bound parameter, never text in the statement.
      expect(call.text).not.toMatch(/2024/);
      expect(call.text).toMatch(/\$1\b/);
    }
    // The identity rule is parameters too: source key, match method, and each accepted status.
    expect(executor.calls[2].params).toEqual([2024, 'afltables', 'afltables_profile_url', 'unique', 'resolved']);
    expect(executor.calls[2].text).toMatch(/IN \(\$4, \$5\)/);
    expect(executor.calls[2].text).not.toMatch(/unique|resolved/);
  });

  it('maps stored winners: an unlinked row keeps a NULL player id and a missing source stays NULL', async () => {
    const executor = fakeExecutor(() => [
      { season: '1999', playerId: null, sourceKey: null, sourceRecordId: null, status: 'void' },
      { season: 2000, playerId: '14', sourceKey: 'afltables', sourceRecordId: 'coleman:2000:players/x.html', status: 'active' },
    ]);
    const stored = await loadStoredColemanWinners(executor, 2000);
    expect(stored).toEqual([
      { season: 1999, playerId: null, sourceKey: null, sourceRecordId: null, status: 'void' },
      { season: 2000, playerId: 14, sourceKey: 'afltables', sourceRecordId: 'coleman:2000:players/x.html', status: 'active' },
    ]);
    expect(executor.calls[0].params).toEqual(['coleman', 2000]);
    expect(executor.calls[0].text).not.toMatch(/2000/);
    await loadStoredColemanWinners(executor);
    expect(executor.calls[1].params).toEqual(['coleman', null]);
  });

  it('lists only CURRENT publications (none superseded) and tolerates a jsonb string', async () => {
    const executor = fakeExecutor(() => [{
      id: '7', season: '2024', methodVersion: 1, derivationVersion: 'v2.coleman.1', inputChecksum: 'abc',
      derivedAt: '2026-10-19T00:00:00Z', publishedAt: '2026-10-19T00:00:01Z', publishedBy: '1', supersedesId: null,
      winners: JSON.stringify([{ key: WINNER_A_KEY }]),
    }]);
    const rows = await listColemanPublications(executor, 2024);
    expect(rows[0]).toMatchObject({ id: 7, season: 2024, publishedBy: 1, supersedesId: null, winnerKeys: [WINNER_A_KEY] });
    expect(executor.calls[0].text).toMatch(/NOT EXISTS \(SELECT 1 FROM derived_award_results s WHERE s\.supersedes_id = r\.id\)/);
    expect(executor.calls[0].params).toEqual(['coleman', 2024]);
  });
});

describe('Brownlow loader (fake executor)', () => {
  const baseRequest = { season: 2024, registry: REGISTRY, generatedAt: '2026-10-19T00:00:00.000Z' };
  const vote = (over: Record<string, unknown> = {}) => ({
    providerMatchId: 'M1', providerPlayerId: 'P1', providerTeamId: 'T1', apiRoundNumber: 1, canonicalRoundNumber: 1,
    votes: '3', eligible: true, matchId: '5', playerId: '11', clubId: null, ...over,
  });

  it('groups votes by provider match, keeps unresolved ids NULL, and reports leaderboard as not supplied', async () => {
    const executor = fakeExecutor((text) => {
      if (text.includes('staging.afl_api_brownlow_vote')) {
        return [vote(), vote({ providerPlayerId: 'P2', votes: 2, playerId: null }), vote({ providerMatchId: 'M2', matchId: null, providerPlayerId: 'P3', votes: 1 })];
      }
      if (text.includes('brownlow_season_votes')) return [];
      return [{ matchId: '5', season: 2024, roundNumber: 1, isFinal: false, homeClubId: 1, awayClubId: '2' }];
    });
    const input = await loadBrownlowReconciliationInput(executor, baseRequest);

    expect(input.seasonState).toBe('complete');
    expect(input.leaderboard).toBeNull();
    expect(input.storedTotals).toBeNull();
    expect(input.eligibilityRule).toBeUndefined();
    expect(input.matchVotes).toHaveLength(2);
    const [m1, m2] = input.matchVotes;
    expect(m1).toMatchObject({ providerMatchId: 'M1', matchId: 5, apiRoundNumber: 1, canonicalRoundNumber: 1 });
    expect(m1.votes.map((v) => [v.providerPlayerId, v.playerId, v.votes, v.clubId])).toEqual([['P1', 11, 3, null], ['P2', null, 2, null]]);
    expect(m2.matchId).toBeNull();
    expect(input.matchContext).toEqual([{
      matchId: 5, season: 2024, roundNumber: 1, isFinal: false, homeClubId: 1, awayClubId: 2,
      homeProviderTeamId: null, awayProviderTeamId: null,
    }]);
    for (const call of executor.calls) {
      expect(call.params).toContain(2024);
      expect(call.text).not.toMatch(/2024/);
    }
    expect(executor.calls[0].params).toEqual([2024, 'afl_api']);
  });

  it('a season that is not sealed is in_progress; stored totals pass through; the eligibility rule is explicit', async () => {
    const executor = fakeExecutor((text) => {
      if (text.includes('staging.afl_api_brownlow_vote')) return [];
      if (text.includes('brownlow_season_votes')) {
        return [{ playerId: '11', clubId: null, votes: '9', voteRank: 1, eligibleRank: null, isIneligible: true, isWinner: false }];
      }
      return [];
    });
    const input = await loadBrownlowReconciliationInput(executor, { ...baseRequest, season: 2026, eligibilityRule: 'stored_eligible_rank_one' });
    expect(input.seasonState).toBe('in_progress');
    expect(input.eligibilityRule).toBe('stored_eligible_rank_one');
    expect(input.storedTotals).toEqual([{ playerId: 11, clubId: null, votes: 9, voteRank: 1, eligibleRank: null, isIneligible: true, isWinner: false }]);
  });

  it('refuses staged rows of one match that disagree on the round', async () => {
    const executor = fakeExecutor((text) => (text.includes('staging.afl_api_brownlow_vote')
      ? [vote(), vote({ providerPlayerId: 'P2', apiRoundNumber: 2 })]
      : []));
    await expect(loadBrownlowReconciliationInput(executor, baseRequest)).rejects.toThrow(BrownlowInputError);
  });
});

/* =============================================================================================
 * 3. Form parsing (pure)
 * =========================================================================================== */
describe('operations form parsing', () => {
  it('proposal ids and seasons are strict', () => {
    expect(parseProposalId('12')).toEqual({ ok: true, value: 12 });
    for (const bad of ['0', '-1', '1.5', '1e3', '', ' ', 'abc', '1234567890', null]) {
      expect(parseProposalId(bad).ok, String(bad)).toBe(false);
    }
    expect(parseSeason('2024')).toEqual({ ok: true, value: 2024 });
    for (const bad of ['1896', '2101', '24', '2024.0', '', null, '20244']) expect(parseSeason(bad).ok, String(bad)).toBe(false);
  });

  it('the create form needs exactly one of a file or pasted text, a known format, and bounded defaults', async () => {
    const good = await parseCreateForm(form({ format: 'json', text: fileText([fileRow()]), sourceKind: 'wikipedia_offline_file', acquiredOn: '2026-10-19' }));
    expect(good).toMatchObject({ ok: true, value: { format: 'json', defaults: { sourceKind: 'wikipedia_offline_file', acquiredOn: '2026-10-19' }, decisionNote: null } });

    const neither = await parseCreateForm(form({ format: 'json' }));
    expect(neither).toMatchObject({ ok: false, fieldErrors: { file: expect.stringMatching(/Provide a proposal file/) } });

    const both = new FormData();
    both.set('format', 'csv');
    both.set('text', 'a,b');
    both.set('file', new File(['x'], 'p.csv'));
    expect(await parseCreateForm(both)).toMatchObject({ ok: false, fieldErrors: { file: expect.stringMatching(/not both/) } });

    const bad = await parseCreateForm(form({ format: 'xml', text: 'x', sourceKind: 'manual_entry', acquiredOn: '2026-02-30', decisionNote: 'n'.repeat(2001) }));
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(Object.keys(bad.fieldErrors).sort()).toEqual(['acquiredOn', 'decisionNote', 'format', 'sourceKind']);

    // A file upload is read as text.
    const upload = new FormData();
    upload.set('format', 'json');
    upload.set('file', new File([fileText([fileRow()])], 'proposals.json'));
    expect(await parseCreateForm(upload)).toMatchObject({ ok: true });
  });
});

/* =============================================================================================
 * 4. Curated awards through the server callers (PGlite, migration 111 verbatim)
 * =========================================================================================== */
describe('curated awards: server callers on PGlite', () => {
  it('reads: a plain admin may list and read history, a contributor may not; reads write no audit row', async () => {
    const proposalId = await seedProposal();
    const { deps } = makeDeps();

    const listed = await listCuratedQueue(PLAIN_ADMIN, {}, deps);
    expect(listed).toMatchObject({ ok: true });
    if (listed.ok) expect(listed.proposals.map((p) => p.id)).toEqual([proposalId]);
    const history = await readCuratedHistory(PLAIN_ADMIN, { proposalId }, deps);
    expect(history).toMatchObject({ ok: true });
    if (history.ok) expect(history.history.decisions.map((d) => d.action)).toEqual(['create', 'validate']);

    expect(await listCuratedQueue(CONTRIBUTOR_USER, {}, deps)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await readCuratedHistory(CONTRIBUTOR_USER, { proposalId }, deps)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('creates proposals from a file: one transaction, one ledger row each, ONE audit row, nothing approved', async () => {
    const { deps } = makeDeps();
    const text = fileText([fileRow(), fileRow({ season: 1991, player_identity: ID_TWO, player_name: 'Synthetic Player Two' })]);
    const result = await createCuratedFromFile(SUPER_USER, { text, format: 'json' }, deps);

    expect(result).toMatchObject({ ok: true, count: 2 });
    expect(await count('award_proposals')).toBe(2);
    expect(await count('award_proposal_decisions')).toBe(2);
    expect(await count('award_winners')).toBe(0);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(
      OPERATIONS_AUDIT_ACTIONS.curatedCreated,
      expect.objectContaining({ operation: 'create', source: 'file', format: 'json', count: 2, proposalIds: [1, 2], outcome: 'created' }),
      { userId: 1, label: 'super@example.invalid' },
    );
  });

  it('an invalid file is refused whole, with its issues, and the refusal is audited once', async () => {
    const { deps } = makeDeps();
    const text = fileText([fileRow(), fileRow({ season: 1800 })]);
    const result = await createCuratedFromFile(SUPER_USER, { text, format: 'json' }, deps);

    expect(result).toMatchObject({ ok: false, code: 'invalid_file' });
    expect(await count('award_proposals')).toBe(0);
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRefused]);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'create', code: 'invalid_file', outcome: 'refused' });
  });

  it('a plain admin is refused by the caller itself (past the route guard): nothing written, no connection, one refusal audit row', async () => {
    const proposalId = await seedProposal();
    const { deps, spies } = makeDeps();

    const created = await createCuratedFromFile(PLAIN_ADMIN, { text: fileText([fileRow()]), format: 'json' }, deps);
    const validated = await validateCurated(PLAIN_ADMIN, { proposalId }, deps);
    const approved = await approveCurated(PLAIN_ADMIN, { proposalId, decisionNote: LONG_NOTE }, deps);
    const rejected = await rejectCurated(PLAIN_ADMIN, { proposalId, decisionNote: LONG_NOTE }, deps);

    for (const result of [created, validated, approved, rejected]) expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(spies.withExecutor).not.toHaveBeenCalled();
    // The seal registry is not even read for a viewer who may not approve.
    expect(spies.loadSealed).not.toHaveBeenCalled();
    expect(await count('award_proposals')).toBe(1);
    expect(await count('award_proposal_decisions')).toBe(2);
    expect(auditActions()).toEqual(Array(4).fill(OPERATIONS_AUDIT_ACTIONS.curatedRefused));
  });

  it('validate: moves the proposal, writes one ledger row, audits the outcome and issue codes', async () => {
    const proposalId = await seedProposal({}, false);
    const { deps } = makeDeps();
    const result = await validateCurated(SUPER_USER, { proposalId }, deps);

    expect(result).toMatchObject({ ok: true, validation: 'validated' });
    if (result.ok) expect(result.proposal.status).toBe('validated');
    expect(await count('award_proposal_decisions')).toBe(2);
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedValidated]);

    // An unresolvable award fails validation: the proposal is stored as validation_failed and audited as such.
    const bad = await seedProposal({ awardSlug: 'no-such-award' }, false);
    auditMock.mockClear();
    const failed = await validateCurated(SUPER_USER, { proposalId: bad }, deps);
    expect(failed).toMatchObject({ ok: true, validation: 'validation_failed' });
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'validation_failed', issueCodes: expect.arrayContaining(['award_not_found']) });
  });

  it('approves into an OPEN season: ledger row, status, winner, one audit row; the seal was consulted', async () => {
    const proposalId = await seedProposal();
    const { deps, spies } = makeDeps({ loadSealed: () => SYNTHETIC_OPEN });
    const result = await approveCurated(SUPER_USER, { proposalId, decisionNote: 'checked against the annual report' }, deps);

    expect(result).toMatchObject({ ok: true, sealedSeason: false });
    if (result.ok) {
      expect(result.proposal.status).toBe('approved');
      expect(result.entityKey).toMatch(/^manual_admin_edit:stub-award-winner-\d+$/);
    }
    expect(spies.promote).toHaveBeenCalledTimes(1);
    expect(await count('award_winners')).toBe(1);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM award_proposal_decisions WHERE action = 'approve'`)).n).toBe(1);
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedApproved]);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ proposalId, season: 1990, outcome: 'approved', sealedSeason: false });
  });

  it('a SEALED season without a valid note is refused and nothing is written; with a note it is an audited correction', async () => {
    const proposalId = await seedProposal();
    const { deps, spies } = makeDeps(); // loadSealed = the REAL registry: 1990 is sealed
    const ledgerBefore = await count('award_proposal_decisions');

    for (const decisionNote of [undefined, '', 'too short']) {
      const refused = await approveCurated(SUPER_USER, { proposalId, decisionNote }, deps);
      expect(refused, String(decisionNote)).toMatchObject({ ok: false, code: 'season_sealed_correction_invalid' });
    }
    expect(spies.promote).not.toHaveBeenCalled();
    expect(await count('award_winners')).toBe(0);
    expect(await count('award_proposal_decisions')).toBe(ledgerBefore);
    expect((await one<{ status: string }>('SELECT status FROM award_proposals WHERE id = $1', [proposalId])).status).toBe('validated');
    expect(auditActions()).toEqual(Array(3).fill(OPERATIONS_AUDIT_ACTIONS.curatedRefused));
    expect(auditMock.mock.calls[0][1]).toMatchObject({ code: 'season_sealed_correction_invalid', outcome: 'refused' });

    auditMock.mockClear();
    const approved = await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, deps);
    expect(approved).toMatchObject({ ok: true, sealedSeason: true });
    expect(await count('award_winners')).toBe(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'approved', sealedSeason: true });
  });

  it('the registry is read on EVERY approval, and a loader failure refuses before any connection is opened', async () => {
    const proposalId = await seedProposal();
    const failing = vi.fn(() => { throw new SeasonRegistryError('The season registry could not be read: STUB'); });
    const { deps, spies } = makeDeps({ loadSealed: failing });

    const result = await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, deps);
    expect(result).toMatchObject({ ok: false, code: 'season_registry_unavailable' });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(spies.withExecutor).not.toHaveBeenCalled();
    expect(spies.promote).not.toHaveBeenCalled();
    expect(await count('award_winners')).toBe(0);
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRefused]);

    // A second approval reads the registry again (no cached "open").
    const reading = vi.fn(() => REAL_SEALED);
    const second = makeDeps({ loadSealed: reading });
    await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, second.deps);
    await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, second.deps);
    expect(reading).toHaveBeenCalledTimes(2);
  });

  it('a promotion-port refusal rolls EVERYTHING back (winner, status, ledger) and is reported with its typed code', async () => {
    const proposalId = await seedProposal();
    const { deps } = makeDeps({}, stubPromotion({ fail: 'after_write_refusal' }));
    const ledgerBefore = await count('award_proposal_decisions');
    const result = await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, deps);

    expect(result).toMatchObject({ ok: false, code: 'promotion_refused' });
    expect(await count('award_winners')).toBe(0);
    expect(await count('award_proposal_decisions')).toBe(ledgerBefore);
    expect((await one<{ status: string }>('SELECT status FROM award_proposals WHERE id = $1', [proposalId])).status).toBe('validated');
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRefused]);
  });

  it('an unexpected error is logged, becomes code "unexpected", leaks no detail, and still rolls back', async () => {
    const proposalId = await seedProposal();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = makeDeps({}, stubPromotion({ fail: 'after_write_error' }));
    const result = await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, deps);

    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (!result.ok) expect(result.error).not.toMatch(/boom|connection reset/i);
    expect(errorLog).toHaveBeenCalled();
    expect(await count('award_winners')).toBe(0);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ code: 'unexpected', outcome: 'refused' });
  });

  it('reject: a reason of at least 10 characters is kept in the ledger; a short one is refused and audited', async () => {
    const proposalId = await seedProposal();
    const { deps } = makeDeps();

    const short = await rejectCurated(SUPER_USER, { proposalId, decisionNote: 'no' }, deps);
    expect(short).toMatchObject({ ok: false, code: 'note_required' });
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRefused]);

    auditMock.mockClear();
    const rejected = await rejectCurated(SUPER_USER, { proposalId, decisionNote: 'duplicate of an earlier entry' }, deps);
    expect(rejected).toMatchObject({ ok: true });
    expect((await one<{ note: string }>(`SELECT note FROM award_proposal_decisions WHERE action = 'reject'`)).note).toBe('duplicate of an earlier entry');
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRejected]);

    // Terminal: it cannot be approved afterwards.
    expect(await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, deps)).toMatchObject({ ok: false, code: 'illegal_transition' });
  });

  it('a failing activity audit never changes the outcome: the change stands and the result carries a warning', async () => {
    const proposalId = await seedProposal();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    auditMock.mockRejectedValue(new Error('auth pool down'));
    const { deps } = makeDeps();

    const ok = await rejectCurated(SUPER_USER, { proposalId, decisionNote: 'duplicate of an earlier entry' }, deps);
    expect(ok).toMatchObject({ ok: true, auditWarning: expect.stringMatching(/Do not submit it again/) });
    expect((await one<{ status: string }>('SELECT status FROM award_proposals WHERE id = $1', [proposalId])).status).toBe('rejected');
    const refused = await rejectCurated(PLAIN_ADMIN, { proposalId, decisionNote: 'duplicate of an earlier entry' }, deps);
    expect(refused).toMatchObject({ ok: false, code: 'forbidden', auditWarning: expect.any(String) });
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  // V2-GAP-018: reviseApprovedCurated over PGlite with a STUB revision port (not the production one).
  describe('reviseApprovedCurated', () => {
    const REVISE_PATHS = ['/awards', '/awards/synthetic-medal'];

    /** Approve a seeded proposal and give its stub winner row the durable key the approval recorded. */
    async function approvedProposal(): Promise<number> {
      const proposalId = await seedProposal();
      const { deps } = makeDeps({ loadSealed: () => SYNTHETIC_OPEN });
      const approved = await approveCurated(SUPER_USER, { proposalId, decisionNote: LONG_NOTE }, deps);
      expect(approved).toMatchObject({ ok: true, selfApproval: false, revalidatePaths: STUB_REVALIDATE_PATHS });
      await db.query(`UPDATE award_winners SET source_id = 2, source_record_id = 'stub-award-winner-1'`);
      // The stub revision port updates the stub winner row; the real one writes through the lifecycle.
      await db.query('GRANT UPDATE ON award_winners TO afldb_import');
      auditMock.mockClear();
      return proposalId;
    }

    function stubRevision(fail = false): ApprovedWinnerRevisionPort {
      return {
        async revise(tx, request) {
          await tx.query(
            `UPDATE award_winners SET votes = $1::numeric WHERE source_record_id = $2`,
            [request.correction.votes ?? null, request.previousEntityKey.replace(/^manual_admin_edit:/, '')],
          );
          if (fail) throw new CuratedAwardError('promotion_refused', 'STUB revision refused after writing');
          return { entityKey: request.previousEntityKey, mode: request.mode, voidedEntityKey: null, revalidatePaths: REVISE_PATHS };
        },
      };
    }

    it('revises: the winner, the superseded and the new revision, two ledger rows and ONE audit row; the paths are returned', async () => {
      const proposalId = await approvedProposal();
      const revision = vi.fn(stubRevision().revise);
      const { deps } = makeDeps({ loadSealed: () => SYNTHETIC_OPEN, revision: { revise: revision } });
      const result = await reviseApprovedCurated(
        SUPER_USER, { proposalId, changes: { votes: '13' }, decisionNote: LONG_NOTE }, deps,
      );

      expect(result).toMatchObject({
        ok: true, mode: 'correct', sealedSeason: false, revalidatePaths: REVISE_PATHS,
        entityKey: 'manual_admin_edit:stub-award-winner-1', proposal: { revision: 2, status: 'approved' },
      });
      expect(revision).toHaveBeenCalledTimes(1);
      expect(revision.mock.calls[0][1]).toMatchObject({ mode: 'correct', correction: { votes: '13' }, adminNote: LONG_NOTE });
      expect((await one<{ votes: string }>('SELECT votes::text AS votes FROM award_winners')).votes).toBe('13.00');
      expect((await one<{ status: string }>('SELECT status FROM award_proposals WHERE id = $1', [proposalId])).status).toBe('superseded');
      const actions = await db.query<{ action: string }>('SELECT action FROM award_proposal_decisions ORDER BY id');
      expect(actions.rows.map((row) => row.action).slice(-2)).toEqual(['supersede_approved', 'revise_approved']);
      expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRevised]);
      expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'revise_approved', mode: 'correct', outcome: 'revised' });
    });

    it('a port failure rolls everything back and is audited once as a refusal', async () => {
      const proposalId = await approvedProposal();
      const { deps } = makeDeps({ loadSealed: () => SYNTHETIC_OPEN, revision: stubRevision(true) });
      const result = await reviseApprovedCurated(
        SUPER_USER, { proposalId, changes: { votes: '13' }, decisionNote: LONG_NOTE }, deps,
      );

      expect(result).toMatchObject({ ok: false, code: 'promotion_refused' });
      expect((await one<{ votes: string }>('SELECT votes::text AS votes FROM award_winners')).votes).toBe('12.50');
      expect((await one<{ status: string }>('SELECT status FROM award_proposals WHERE id = $1', [proposalId])).status).toBe('approved');
      expect(await count('award_proposals')).toBe(1);
      expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRefused]);
    });

    it('a plain admin is refused by the caller itself: no connection, no registry read, one refusal audit row', async () => {
      const proposalId = await approvedProposal();
      const { deps, spies } = makeDeps();
      const result = await reviseApprovedCurated(
        PLAIN_ADMIN, { proposalId, changes: { votes: '13' }, decisionNote: LONG_NOTE }, deps,
      );

      expect(result).toMatchObject({ ok: false, code: 'forbidden' });
      expect(spies.withExecutor).not.toHaveBeenCalled();
      expect(spies.loadSealed).not.toHaveBeenCalled();
      expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.curatedRefused]);
    });
  });
});

/* =============================================================================================
 * 5. Coleman through the server callers (PGlite, migration 112 verbatim; SYNTHETIC season 2024)
 * =========================================================================================== */
describe('Coleman: server callers on PGlite', () => {
  beforeEach(seedColeman);

  const NOTE = 'SYNTHETIC: publish the derived Coleman result for the test season.';

  it('compare is read-only and available to a plain admin: derives, compares with the stored rows, writes nothing', async () => {
    await db.query(
      `INSERT INTO award_winners (award_id, season, player_id, player_name_raw, status, source_id, source_record_id)
       VALUES (3, 2024, 11, 'Synthetic Player A', 'active', 1, $1)`, [WINNER_A_KEY]);
    const { deps, spies } = makeDeps();
    const result = await compareColemanSeason(PLAIN_ADMIN, { season: 2024, settled: true }, deps);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const { comparison } = result;
    expect(comparison).toMatchObject({ season: 2024, settled: true, sealed: true, current: null, plan: 'published' });
    expect(comparison.derivation).toMatchObject({ derivable: true, maxGoals: 5, tie: false, leaderboardSize: 8 });
    if (comparison.derivation.derivable) expect(comparison.derivation.winners.map((w) => w.key)).toEqual([WINNER_A_KEY]);
    expect(comparison.report.seasons[0]).toMatchObject({ season: 2024, category: 'agree' });
    expect(spies.withExecutor).toHaveBeenCalledTimes(1);
    expect(await count('derived_award_results')).toBe(0);
    expect(auditMock).not.toHaveBeenCalled();

    expect(await compareColemanSeason(CONTRIBUTOR_USER, { season: 2024, settled: true }, deps)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await compareColemanSeason(SUPER_USER, { season: 1800, settled: true }, deps)).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('compare without the settled attestation reports not_derivable (season_not_settled), it does not guess', async () => {
    const { deps } = makeDeps();
    const result = await compareColemanSeason(SUPER_USER, { season: 2024, settled: false }, deps);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.comparison.derivation).toMatchObject({ derivable: false, refusal: { code: 'season_not_settled' } });
    expect(result.comparison.report.seasons[0].category).toBe('not_derivable');
    expect(result.comparison.plan).toBeNull();
  });

  it('publish: a plain admin is refused by the caller itself; nothing is read or written; one refusal audit row', async () => {
    const { deps, spies } = makeDeps();
    const result = await publishColemanSeason(PLAIN_ADMIN, { season: 2024, settled: true, note: NOTE }, deps);
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(spies.withExecutor).not.toHaveBeenCalled();
    expect(await count('derived_award_results')).toBe(0);
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.colemanRefused]);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'publish', season: 2024, code: 'forbidden', outcome: 'refused' });
  });

  it('publish refuses settled:false and a missing or short note before touching the database', async () => {
    const { deps, spies } = makeDeps();
    const unsettled = await publishColemanSeason(SUPER_USER, { season: 2024, settled: false, note: NOTE }, deps);
    expect(unsettled).toMatchObject({ ok: false, code: 'settled_required' });
    for (const note of ['', '   ', 'too short', 'x'.repeat(2001)]) {
      expect(await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note }, deps), note.slice(0, 12))
        .toMatchObject({ ok: false, code: 'correction_invalid' });
    }
    expect(spies.withExecutor).not.toHaveBeenCalled();
    expect(await count('derived_award_results')).toBe(0);
    expect(auditActions()).toEqual(Array(5).fill(OPERATIONS_AUDIT_ACTIONS.colemanRefused));
  });

  it('publish refuses a season that is not sealed (in progress): the derivation refuses, nothing is written', async () => {
    const { deps } = makeDeps();
    const result = await publishColemanSeason(SUPER_USER, { season: 2026, settled: true, note: NOTE }, deps);
    expect(result).toMatchObject({ ok: false, code: 'derivation_refused', derivationCode: 'season_not_complete' });
    expect(await count('derived_award_results')).toBe(0);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ code: 'derivation_refused', derivationCode: 'season_not_complete' });
  });

  it('publish refuses a NULL goal in a home-and-away row (not recorded is not zero) and writes nothing', async () => {
    await db.query('UPDATE player_match_stats SET goals = NULL WHERE player_id = 11 AND match_id = 1');
    const { deps } = makeDeps();
    const result = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(result).toMatchObject({ ok: false, code: 'derivation_refused', derivationCode: 'goals_not_recorded' });
    expect(await count('derived_award_results')).toBe(0);
  });

  it('publishes as an audited correction, is idempotent (unchanged), and supersedes after a corrected statistic', async () => {
    const { deps } = makeDeps();
    const first = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(first).toMatchObject({ ok: true, outcome: 'published', id: 1, supersededId: null, season: 2024, winnerKeys: [WINNER_A_KEY] });
    if (!first.ok) return;
    expect(first.evidenceRef).toBe(`coleman_derivation:2024:${first.inputChecksum}`);

    const row = await one<{ published_by: number; basis: string; correction: { workflow: string; actorUserId: number; note: string; evidenceRef: string }; supersedes_id: number | null }>(
      'SELECT published_by, basis, correction, supersedes_id FROM derived_award_results');
    expect(row).toMatchObject({ published_by: 1, basis: 'audited_correction', supersedes_id: null });
    expect(row.correction).toMatchObject({ workflow: 'derived_award_publication', actorUserId: 1, note: NOTE, evidenceRef: first.evidenceRef });
    expect(await count('award_winners')).toBe(0); // the STUB projection port writes nothing; the real one is proven on PostgreSQL

    const again = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(again).toMatchObject({ ok: true, outcome: 'unchanged', id: 1, supersededId: null });
    expect(await count('derived_award_results')).toBe(1);

    // A corrected statistic (still A on top) changes the input checksum: a NEW row supersedes the old one.
    await db.query('UPDATE player_match_stats SET goals = goals + 1 WHERE player_id = 11 AND match_id = 1');
    const superseded = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(superseded).toMatchObject({ ok: true, outcome: 'superseded', id: 2, supersededId: 1 });
    expect(await count('derived_award_results')).toBe(2);

    expect(auditActions()).toEqual(Array(3).fill(OPERATIONS_AUDIT_ACTIONS.colemanPublished));
    expect(auditMock.mock.calls.map((call) => call[1]?.outcome)).toEqual(['published', 'unchanged', 'superseded']);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ season: 2024, resultId: 1, winnerCount: 1, evidenceRef: first.evidenceRef });

    // Compare now sees the current row and what publishing would do.
    const compared = await compareColemanSeason(PLAIN_ADMIN, { season: 2024, settled: true }, deps);
    expect(compared).toMatchObject({ ok: true });
    if (compared.ok) expect(compared.comparison).toMatchObject({ plan: 'unchanged', current: { id: 2, supersedesId: 1, winnerKeys: [WINNER_A_KEY] } });
  });

  it('listColemanPublicationsForAdmin: read-only, data.awards.read, current rows only, no winners document, nothing audited (Stage 5 UI read)', async () => {
    const { deps, spies } = makeDeps();
    expect(await listColemanPublicationsForAdmin(PLAIN_ADMIN, {}, deps)).toMatchObject({ ok: true, publications: [] });

    const first = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(first).toMatchObject({ ok: true, outcome: 'published', id: 1 });
    await db.query('UPDATE player_match_stats SET goals = goals + 1 WHERE player_id = 11 AND match_id = 1');
    expect(await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps))
      .toMatchObject({ ok: true, outcome: 'superseded', id: 2, supersededId: 1 });
    auditMock.mockClear();
    spies.withExecutor.mockClear();

    const listed = await listColemanPublicationsForAdmin(PLAIN_ADMIN, {}, deps);
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok) return;
    // Only the CURRENT row of the season (id 2); the superseded id 1 is history.
    expect(listed.publications.map((p) => [p.id, p.season, p.supersedesId])).toEqual([[2, 2024, 1]]);
    expect(listed.publications[0].winnerKeys).toEqual([WINNER_A_KEY]);
    expect(Object.keys(listed.publications[0])).not.toContain('winners');
    expect(spies.withExecutor).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();

    expect(await listColemanPublicationsForAdmin(SUPER_USER, { season: 2023 }, deps)).toMatchObject({ ok: true, publications: [] });
    expect(await listColemanPublicationsForAdmin(SUPER_USER, { season: 1800 }, deps)).toMatchObject({ ok: false, code: 'invalid_input' });
    spies.withExecutor.mockClear();
    expect(await listColemanPublicationsForAdmin(CONTRIBUTOR_USER, {}, deps)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(spies.withExecutor, 'a refused viewer never opens a connection').not.toHaveBeenCalled();
  });

  it('publish ALWAYS passes the production projection port, after the ledger step, on every outcome including unchanged', async () => {
    const { deps } = makeDeps(); // no colemanProjection override: the default (mocked production) port is used
    const first = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(first).toMatchObject({ ok: true, outcome: 'published', id: 1 });
    expect(bridge.project).toHaveBeenCalledTimes(1);
    const [, firstRequest] = bridge.project.mock.calls[0];
    expect(firstRequest).toMatchObject({
      derivedAwardResultId: 1, ledgerOutcome: 'published', publishedBy: 1,
      audit: { workflow: 'derived_award_publication', actorUserId: 1, note: NOTE },
    });
    expect(firstRequest.derivation.winners.map((w) => w.key)).toEqual([WINNER_A_KEY]);

    // A rerun leaves the ledger alone ('unchanged') and still goes through the port.
    const again = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(again).toMatchObject({ ok: true, outcome: 'unchanged', id: 1 });
    expect(bridge.project).toHaveBeenCalledTimes(2);
    expect(bridge.project.mock.calls[1][1]).toMatchObject({ derivedAwardResultId: 1, ledgerOutcome: 'unchanged' });

    // An injected port replaces it (and only then); nothing else ever bypasses the port.
    const injected = vi.fn(async (_tx: unknown, request: ColemanProjectionRequest) => stubProjection(request));
    await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, { ...deps, colemanProjection: { project: injected, preview: vi.fn() } });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(bridge.project).toHaveBeenCalledTimes(2);
  });

  it('publish returns the projection summary and the server-computed revalidation paths; the audit row carries the counts', async () => {
    const { deps } = makeDeps();
    const result = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(result).toMatchObject({
      ok: true,
      projection: { projectionId: null, changedCount: 1, provenanceOnly: false, alreadyProjected: false, counts: { inserted: 1, retained: 0 } },
      revalidatePaths: ['/awards', '/awards/coleman', '/awards/coleman/2024'],
    });
    expect(auditMock.mock.calls[0][1]).toMatchObject({ projected: { inserted: 1, updated: 0, voided: 0, retained: 0 }, provenanceOnly: false });

    // Provenance only: the port reports no change but recorded a projection row.
    bridge.project.mockImplementation(async (_tx, request) => ({
      ...stubProjection(request), projectionId: 7, changedCount: 0, revalidatePaths: [],
      counts: { inserted: 0, updated: 0, voided: 0, retained: 1 },
    }));
    const provenance = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(provenance).toMatchObject({
      ok: true, projection: { projectionId: 7, changedCount: 0, provenanceOnly: true, alreadyProjected: false }, revalidatePaths: [],
    });
  });

  it('a projection refusal rolls the LEDGER row back, is returned with its typed code and rows, and is audited as a refusal', async () => {
    bridge.project.mockImplementation(async () => {
      throw new ColemanProjectionRefusal('foreign_winner_rows', 'Refused: SYNTHETIC foreign row.', ['#7 manual_admin_edit:award_winner:SYNTHETIC']);
    });
    const { deps } = makeDeps();
    const result = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(result).toMatchObject({ ok: false, code: 'foreign_winner_rows' });
    if (!result.ok) expect(result.error).toContain('#7 manual_admin_edit:award_winner:SYNTHETIC');
    expect(bridge.project).toHaveBeenCalledTimes(1);
    expect(await count('derived_award_results')).toBe(0); // the ledger insert ran, then rolled back
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.colemanRefused]);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ code: 'foreign_winner_rows', outcome: 'refused' });
  });

  it('compare previews the award_winners effect through the same port, read-only, and only for a derivable sealed season', async () => {
    const { deps } = makeDeps();
    const result = await compareColemanSeason(PLAIN_ADMIN, { season: 2024, settled: true }, deps);
    expect(result).toMatchObject({
      ok: true,
      comparison: { projection: { ok: true, counts: { inserted: 1 }, changedCount: 1 } },
    });
    expect(bridge.preview).toHaveBeenCalledTimes(1);
    expect(bridge.project).not.toHaveBeenCalled();
    expect(await count('derived_award_results')).toBe(0);

    // A refusal the write would hit is shown, not thrown.
    bridge.preview.mockResolvedValue({ ok: false, refusal: { code: 'admin_override_present', message: 'SYNTHETIC', subjects: ['#1 afltables:x'] } });
    expect(await compareColemanSeason(PLAIN_ADMIN, { season: 2024, settled: true }, deps))
      .toMatchObject({ ok: true, comparison: { projection: { ok: false, refusal: { code: 'admin_override_present' } } } });

    // Not derivable (no settled attestation) and not sealed: no preview is computed at all.
    bridge.preview.mockClear();
    expect(await compareColemanSeason(PLAIN_ADMIN, { season: 2024, settled: false }, deps))
      .toMatchObject({ ok: true, comparison: { projection: null } });
    expect(await compareColemanSeason(PLAIN_ADMIN, { season: 2026, settled: true }, deps))
      .toMatchObject({ ok: true, comparison: { projection: null } });
    expect(bridge.preview).not.toHaveBeenCalled();
  });

  it('a Coleman contract that cannot be read refuses with its own code', async () => {
    const { deps, spies } = makeDeps({ loadContract: () => loadColemanContract('Z:/no/such/project/root') });
    const result = await publishColemanSeason(SUPER_USER, { season: 2024, settled: true, note: NOTE }, deps);
    expect(result).toMatchObject({ ok: false, code: 'coleman_contract_unavailable' });
    expect(spies.withExecutor).not.toHaveBeenCalled();
  });
});

/* =============================================================================================
 * 6. Brownlow reconciliation through the server caller (PGlite over stub staging)
 * =========================================================================================== */
describe('Brownlow reconciliation: server caller on PGlite', () => {
  beforeEach(async () => {
    await seedColeman(); // matches for 2024 (ids 1-5)
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
  });

  it('builds the input from the staged votes, the stored totals and the match context; a plain admin may run it; nothing is audited', async () => {
    const { deps, spies } = makeDeps();
    const result = await reconcileBrownlowSeasonForAdmin(PLAIN_ADMIN, { season: 2024 }, deps);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const { report } = result;
    expect(report.source).toMatchObject({
      sourceKey: 'afl_api', season: 2024, seasonState: 'complete', leaderboardStatus: null,
      evidence: { matchVoteRecords: 1, leaderboardEntries: null, storedRows: 3, contextMatches: 5 },
    });
    expect(report.rawVotes.matches[0]).toMatchObject({ providerMatchId: 'SYN_M1', matchId: 1, apiRoundNumber: 1 });
    expect(report.rawVotes.playerTotals.map((t) => [t.playerId, t.votes])).toEqual(expect.arrayContaining([[11, 3], [12, 2], [13, 1]]));
    expect(report.awardResultPresentation.providerClaims.leaderboardWinners).toBeNull();
    expect(spies.withExecutor).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('a season that is not sealed is reported in_progress; a contributor, a bad season and a bad rule are refused', async () => {
    const { deps } = makeDeps();
    const inProgress = await reconcileBrownlowSeasonForAdmin(SUPER_USER, { season: 2026, eligibilityRule: 'stored_eligible_rank_one' }, deps);
    expect(inProgress).toMatchObject({ ok: true });
    if (inProgress.ok) expect(inProgress.report.source.seasonState).toBe('in_progress');
    expect(await reconcileBrownlowSeasonForAdmin(CONTRIBUTOR_USER, { season: 2024 }, deps)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await reconcileBrownlowSeasonForAdmin(SUPER_USER, { season: 24 }, deps)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await reconcileBrownlowSeasonForAdmin(SUPER_USER, { season: 2024, eligibilityRule: 'whatever' as never }, deps)).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('inconsistent staged rows refuse with a typed code instead of guessing a round', async () => {
    await db.query(`UPDATE staging.afl_api_brownlow_vote SET api_round_number = 2 WHERE provider_player_id = 'SYN_P12'`);
    const { deps } = makeDeps();
    expect(await reconcileBrownlowSeasonForAdmin(SUPER_USER, { season: 2024 }, deps)).toMatchObject({ ok: false, code: 'brownlow_input_inconsistent' });
  });
});

/* =============================================================================================
 * 7. Server Actions: the guard, the role matrix, the audit rows, end to end over PGlite
 * =========================================================================================== */
describe('Server Actions: role refusal', () => {
  const EDIT_ACTIONS: Array<[string, (form: FormData) => Promise<unknown>, () => FormData]> = [
    ['createCuratedProposalsAction', (f) => createCuratedProposalsAction({}, f), () => form({ format: 'json', text: fileText([fileRow()]) })],
    ['validateCuratedProposalAction', (f) => validateCuratedProposalAction({}, f), () => form({ proposalId: '1' })],
    ['approveCuratedProposalAction', (f) => approveCuratedProposalAction({}, f), () => form({ proposalId: '1', decisionNote: LONG_NOTE })],
    ['rejectCuratedProposalAction', (f) => rejectCuratedProposalAction({}, f), () => form({ proposalId: '1', decisionNote: 'duplicate of an earlier entry' })],
    ['publishColemanSeasonAction', (f) => publishColemanSeasonAction({}, f), () => form({ season: '2024', settled: 'on', note: LONG_NOTE })],
  ];

  describe.each(EDIT_ACTIONS)('%s', (name, run, makeForm) => {
    it('redirects anonymous callers, contributors and a plain admin; nothing is written or audited', async () => {
      await seedProposal();
      const before = { proposals: await count('award_proposals'), ledger: await count('award_proposal_decisions') };
      for (const actor of [null, CONTRIBUTOR_USER, PLAIN_ADMIN]) {
        session.actor = actor;
        await expect(run(makeForm()), `${name} as ${actor?.role ?? 'anonymous'}`).rejects.toThrow('NEXT_REDIRECT');
      }
      expect(await count('award_proposals')).toBe(before.proposals);
      expect(await count('award_proposal_decisions')).toBe(before.ledger);
      expect(await count('derived_award_results')).toBe(0);
      expect(auditMock).not.toHaveBeenCalled();
      expect(guardMock.mock.calls.every((call) => call[0] === 'data.awards.edit')).toBe(true);
    });
  });

  it('compareColemanSeasonAction admits a plain admin and a super admin, and redirects a contributor and anonymous', async () => {
    await seedColeman();
    for (const actor of [null, CONTRIBUTOR_USER]) {
      session.actor = actor;
      await expect(compareColemanSeasonAction({}, form({ season: '2024', settled: 'on' }))).rejects.toThrow('NEXT_REDIRECT');
    }
    for (const actor of [PLAIN_ADMIN, SUPER_USER]) {
      session.actor = actor;
      const state = await compareColemanSeasonAction({}, form({ season: '2024', settled: 'on' }));
      expect(state).toMatchObject({ ok: true, comparison: { season: 2024, sealed: true } });
    }
    expect(guardMock.mock.calls.every((call) => call[0] === 'data.awards.read')).toBe(true);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('bad forms are refused by the action itself with field errors, after the guard and before any service', async () => {
    session.actor = SUPER_USER;
    expect(await approveCuratedProposalAction({}, form({ proposalId: 'abc' }))).toMatchObject({ code: 'invalid_input', fieldErrors: { proposalId: expect.any(String) } });
    expect(await validateCuratedProposalAction({}, form({ proposalId: '1', decisionNote: 'n'.repeat(2001) }))).toMatchObject({ code: 'invalid_input', fieldErrors: { decisionNote: expect.any(String) } });
    expect(await publishColemanSeasonAction({}, form({ season: '24', settled: 'on' }))).toMatchObject({ code: 'invalid_input', fieldErrors: { season: expect.any(String), note: expect.any(String) } });
    expect(await createCuratedProposalsAction({}, form({ format: 'xml' }))).toMatchObject({ code: 'invalid_input', fieldErrors: { format: expect.any(String), file: expect.any(String) } });
    expect(await compareColemanSeasonAction({}, form({ season: '' }))).toMatchObject({ code: 'invalid_input' });
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('Server Actions: the curated workflow end to end', () => {
  it('create -> validate -> approve (sealed season, with a note) -> a second approval is refused; every step audited once', async () => {
    session.actor = SUPER_USER;

    const created = await createCuratedProposalsAction({}, form({ format: 'json', text: fileText([fileRow()]) }));
    expect(created).toMatchObject({ ok: true, proposals: [{ id: 1, status: 'proposed' }] });

    const validated = await validateCuratedProposalAction({}, form({ proposalId: '1' }));
    expect(validated).toMatchObject({ ok: true, validation: 'validated', proposal: { status: 'validated' } });

    // Four eyes (V2-GAP-019): this super admin CREATED the revision, so approving it needs an attestation.
    const noAttestation = await approveCuratedProposalAction({}, form({ proposalId: '1', decisionNote: LONG_NOTE }));
    expect(noAttestation).toMatchObject({ code: 'self_approval_forbidden', fieldErrors: { selfApprovalAttestation: expect.any(String) } });
    const shortAttestation = await approveCuratedProposalAction({}, form({ proposalId: '1', decisionNote: LONG_NOTE, selfApprovalAttestation: 'too short' }));
    expect(shortAttestation).toMatchObject({ code: 'self_approval_attestation_required', fieldErrors: { selfApprovalAttestation: expect.any(String) } });
    expect(await count('award_winners')).toBe(0);

    // Season 1990 is sealed in the REAL registry (the default dependency): no note -> field error.
    const noNote = await approveCuratedProposalAction({}, form({ proposalId: '1', selfApprovalAttestation: SELF_ATTESTATION }));
    expect(noNote).toMatchObject({ code: 'season_sealed_correction_invalid', fieldErrors: { decisionNote: expect.any(String) } });
    expect(await count('award_winners')).toBe(0);

    const approved = await approveCuratedProposalAction({}, form({ proposalId: '1', decisionNote: LONG_NOTE, selfApprovalAttestation: SELF_ATTESTATION }));
    expect(approved).toMatchObject({
      ok: true, sealedSeason: true, selfApproval: true, proposal: { status: 'approved' }, revalidatePaths: STUB_REVALIDATE_PATHS,
    });
    expect(await count('award_winners')).toBe(1);
    const ledger = await one<{ new_values: Record<string, unknown> }>(
      `SELECT new_values FROM award_proposal_decisions WHERE action = 'approve'`);
    expect(ledger.new_values).toMatchObject({ selfApproval: true, selfApprovalAttestation: SELF_ATTESTATION });

    const again = await approveCuratedProposalAction({}, form({ proposalId: '1', decisionNote: LONG_NOTE, selfApprovalAttestation: SELF_ATTESTATION }));
    expect(again).toMatchObject({ code: 'illegal_transition' });

    expect(auditActions()).toEqual([
      OPERATIONS_AUDIT_ACTIONS.curatedCreated,
      OPERATIONS_AUDIT_ACTIONS.curatedValidated,
      OPERATIONS_AUDIT_ACTIONS.curatedRefused,
      OPERATIONS_AUDIT_ACTIONS.curatedRefused,
      OPERATIONS_AUDIT_ACTIONS.curatedRefused,
      OPERATIONS_AUDIT_ACTIONS.curatedApproved,
      OPERATIONS_AUDIT_ACTIONS.curatedRefused,
    ]);
    // The state is plain data: it survives a structured clone, as a Server Action result must.
    expect(JSON.parse(JSON.stringify(approved))).toEqual(approved);
  });

  it('reject through the action keeps the reason and refuses a short one with a field error', async () => {
    session.actor = SUPER_USER;
    await createCuratedProposalsAction({}, form({ format: 'json', text: fileText([fileRow()]) }));
    expect(await rejectCuratedProposalAction({}, form({ proposalId: '1', decisionNote: 'no' })))
      .toMatchObject({ code: 'note_required', fieldErrors: { decisionNote: expect.any(String) } });
    expect(await rejectCuratedProposalAction({}, form({ proposalId: '1', decisionNote: 'duplicate of an earlier entry' })))
      .toMatchObject({ ok: true, proposal: { status: 'rejected' } });
  });
});

describe('Server Actions: the Coleman workflow end to end', () => {
  beforeEach(seedColeman);

  it('publish needs the settled attestation and a note; then publishes, reports the evidence, and a repeat is unchanged', async () => {
    session.actor = SUPER_USER;
    expect(await publishColemanSeasonAction({}, form({ season: '2024', note: LONG_NOTE })))
      .toMatchObject({ code: 'settled_required', fieldErrors: { settled: expect.any(String) } });
    expect(await publishColemanSeasonAction({}, form({ season: '2024', settled: 'on', note: 'short' })))
      .toMatchObject({ code: 'correction_invalid', fieldErrors: { note: expect.any(String) } });

    const published = await publishColemanSeasonAction({}, form({ season: '2024', settled: 'on', note: LONG_NOTE }));
    expect(published).toMatchObject({ ok: true, publication: { outcome: 'published', id: 1, season: 2024, winnerKeys: [WINNER_A_KEY] } });
    // The action NEVER revalidates; it returns the server-computed paths for the client to post.
    expect(published).toMatchObject({ revalidatePaths: ['/awards', '/awards/coleman', '/awards/coleman/2024'] });
    expect(published.message).toContain('award_winners: 1 inserted, 0 updated, 0 voided, 0 retained.');
    const repeat = await publishColemanSeasonAction({}, form({ season: '2024', settled: 'on', note: LONG_NOTE }));
    expect(repeat).toMatchObject({ ok: true, publication: { outcome: 'unchanged', id: 1 } });
    expect(await count('derived_award_results')).toBe(1);

    expect(await publishColemanSeasonAction({}, form({ season: '2026', settled: 'on', note: LONG_NOTE })))
      .toMatchObject({ code: 'derivation_refused', derivationCode: 'season_not_complete' });
    expect(JSON.parse(JSON.stringify(published))).toEqual(published);
  });
});

/* =============================================================================================
 * 8. Static contract of the action modules
 * =========================================================================================== */
describe('action modules (static)', () => {
  const files = ['awards/actions.ts', 'coleman/actions.ts'].map((path) => join(process.cwd(), 'src', 'app', 'admin', 'operations', path));
  const sources = files.map((file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));

  it.each(files.map((file, index) => [file.split(/[\\/]/).slice(-2).join('/'), sources[index]]))('%s exports only async functions and never revalidates', (_name, source) => {
    expect(source.startsWith("'use server';")).toBe(true);
    // Every export is `export async function`: a 'use server' module exporting a const array 500s.
    const exports = [...source.matchAll(/^export\s+(.*)$/gm)].map((m) => m[1]);
    expect(exports.length).toBeGreaterThan(0);
    for (const declaration of exports) expect(declaration).toMatch(/^async function \w+\(/);
    expect(source).not.toMatch(/\brevalidatePath\s*\(|from 'next\/cache'/);
    // The guard is the first awaited statement of every exported action.
    for (const match of source.matchAll(/^export async function (\w+)\([^)]*\)[^{]*\{\n\s*const admin = await requireCapability\('data\.awards\.(edit|read)'\);/gms)) {
      expect(match[1]).toMatch(/Action$/);
    }
    const actionCount = [...source.matchAll(/^export async function \w+Action\(/gm)].length;
    const guarded = [...source.matchAll(/^export async function \w+Action\([^{]*\{\n  const admin = await requireCapability\(/gm)].length;
    expect(guarded).toBe(actionCount);
  });

  it('hasCapability agrees with the role matrix the actions rely on', () => {
    expect(hasCapability(PLAIN_ADMIN, 'data.awards.read')).toBe(true);
    expect(hasCapability(PLAIN_ADMIN, 'data.awards.edit')).toBe(false);
    expect(hasCapability(SUPER_USER, 'data.awards.edit')).toBe(true);
    expect(hasCapability(CONTRIBUTOR_USER, 'data.awards.read')).toBe(false);
    expect(hasCapability(PLAIN_ADMIN, 'data.brownlow.read')).toBe(true);
    expect(hasCapability(CONTRIBUTOR_USER, 'data.brownlow.read')).toBe(false);
  });
});


/* =============================================================================================
 * Launch F F-D stream A: Brownlow eligibility callers, action and form (docs/v2/adr/0014)
 *
 * What runs here: the capability refusals, the pre-SQL gate, the audit rows, the Server Action's
 * guard and parsing, the action-card wording and its drift test. What does NOT run here: the
 * decision SQL itself - it needs the postgres.js adapter (player identity is resolved through
 * `resolvePlayerIdentity`), so over PGlite the service refuses with `unexpected`; the real thing is
 * proved against PostgreSQL by tests/integration/v2-brownlow-eligibility.test.ts.
 * =========================================================================================== */
describe('Brownlow eligibility: callers, Server Action and form (Launch F F-D stream A)', () => {
  const DECISION = (over: Record<string, unknown> = {}) => ({
    season: 2024, playerId: 11, verdict: 'ineligible' as const, citation: 'https://example.invalid/ruling',
    note: LONG_NOTE, expectedCurrentDecisionId: null, ...over,
  });
  const decisionForm = (over: Record<string, string | undefined> = {}) => form({
    season: '2024', playerId: '11', verdict: 'ineligible', citation: 'https://example.invalid/ruling',
    note: LONG_NOTE, expectedCurrentDecisionId: '', ...over,
  });

  it('the action card mirrors the audit actions of OPERATIONS_AUDIT_ACTIONS exactly', async () => {
    const { BROWNLOW_ELIGIBILITY_AUDIT_ACTIONS } = await import('@/app/admin/operations/brownlow/eligibility-consequences');
    expect(BROWNLOW_ELIGIBILITY_AUDIT_ACTIONS).toEqual({
      brownlowEligibilityDecided: OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityDecided,
      brownlowEligibilityRefused: OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityRefused,
    });
    expect(OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityDecided).toBe('admin.brownlow_eligibility_decided');
    expect(OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityRefused).toBe('admin.brownlow_eligibility_refused');
  });

  it('the form constants mirror the service rules (citation 1..2000, note 20..2000)', async () => {
    const form_ = await import('@/app/admin/operations/brownlow/eligibility-form');
    const service = await import('@/db/queries/brownlow-eligibility');
    expect(form_.CITATION_MAX_LENGTH).toBe(service.BROWNLOW_CITATION_MAX_LENGTH);
    expect(form_.DECISION_NOTE_MIN_LENGTH).toBe(service.BROWNLOW_DECISION_NOTE_MIN_LENGTH);
    expect(form_.DECISION_NOTE_MAX_LENGTH).toBe(service.BROWNLOW_DECISION_NOTE_MAX_LENGTH);
  });

  it('determine: a contributor is refused before any SQL; a bad season is refused as invalid_input; nothing is audited', async () => {
    const { determineBrownlowSeasonForAdmin } = await import('@/lib/admin/operations-centre');
    const { deps, spies } = makeDeps();
    expect(await determineBrownlowSeasonForAdmin(CONTRIBUTOR_USER, { season: 2024 }, deps)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await determineBrownlowSeasonForAdmin(PLAIN_ADMIN, { season: 24 }, deps)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(spies.withExecutor).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('record: a plain admin and a contributor are refused (forbidden) BEFORE the registry or any connection; one refused audit row each', async () => {
    const { recordBrownlowEligibilityForAdmin } = await import('@/lib/admin/operations-centre');
    const loadRegistry = vi.fn(() => REGISTRY);
    const { deps, spies } = makeDeps({ loadRegistry });
    for (const actor of [PLAIN_ADMIN, CONTRIBUTOR_USER]) {
      expect(await recordBrownlowEligibilityForAdmin(actor, DECISION(), deps)).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect(loadRegistry).not.toHaveBeenCalled();
    expect(spies.withExecutor).not.toHaveBeenCalled();
    expect(await count('brownlow_eligibility_decisions')).toBe(0);
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityRefused, OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityRefused]);
    // The audit detail carries ids and codes, never the note or the citation.
    const detail = JSON.stringify(auditMock.mock.calls[0][1]);
    expect(detail).toContain('"code":"forbidden"');
    expect(detail).not.toContain(LONG_NOTE);
    expect(detail).not.toContain('example.invalid');
  });

  it('record: the service gate refuses a blank citation, a short note and a bad verdict with typed codes and writes nothing', async () => {
    const { recordBrownlowEligibilityForAdmin } = await import('@/lib/admin/operations-centre');
    const { deps } = makeDeps();
    expect(await recordBrownlowEligibilityForAdmin(SUPER_USER, DECISION({ citation: '   ' }), deps)).toMatchObject({ ok: false, code: 'citation_required' });
    expect(await recordBrownlowEligibilityForAdmin(SUPER_USER, DECISION({ note: 'too short' }), deps)).toMatchObject({ ok: false, code: 'note_invalid' });
    expect(await recordBrownlowEligibilityForAdmin(SUPER_USER, DECISION({ verdict: 'maybe' }), deps)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await recordBrownlowEligibilityForAdmin(SUPER_USER, DECISION({ season: 1800 }), deps)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await count('brownlow_eligibility_decisions')).toBe(0);
    expect(auditActions()).toEqual(Array(4).fill(OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityRefused));
  });

  it('record: over a non-postgres.js executor the service refuses to guess an identity (unexpected) and writes nothing', async () => {
    const { recordBrownlowEligibilityForAdmin } = await import('@/lib/admin/operations-centre');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = makeDeps();
    const result = await recordBrownlowEligibilityForAdmin(SUPER_USER, DECISION(), deps);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    expect(await count('brownlow_eligibility_decisions')).toBe(0);
    expect(auditActions()).toEqual([OPERATIONS_AUDIT_ACTIONS.brownlowEligibilityRefused]);
  });

  it('the Server Action redirects anonymous callers, contributors and a plain admin (guard: data.brownlow.finalise); nothing is written or audited', async () => {
    const { recordBrownlowEligibilityAction } = await import('@/app/admin/operations/brownlow/actions');
    for (const actor of [null, CONTRIBUTOR_USER, PLAIN_ADMIN]) {
      session.actor = actor;
      await expect(recordBrownlowEligibilityAction({}, decisionForm()), actor?.role ?? 'anonymous').rejects.toThrow('NEXT_REDIRECT');
    }
    expect(guardMock.mock.calls.every((call) => call[0] === 'data.brownlow.finalise')).toBe(true);
    expect(await count('brownlow_eligibility_decisions')).toBe(0);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('the Server Action refuses a bad form with field errors, after the guard and before any service; the player is echoed', async () => {
    const { recordBrownlowEligibilityAction } = await import('@/app/admin/operations/brownlow/actions');
    session.actor = SUPER_USER;
    const state = await recordBrownlowEligibilityAction({}, decisionForm({ season: '24', verdict: 'maybe', citation: ' ', note: 'short', expectedCurrentDecisionId: 'x' }));
    expect(state).toMatchObject({
      code: 'invalid_input',
      playerId: 11,
      fieldErrors: {
        season: expect.any(String), verdict: expect.any(String), citation: expect.any(String),
        note: expect.any(String), expectedCurrentDecisionId: expect.any(String),
      },
    });
    expect(await recordBrownlowEligibilityAction({}, decisionForm({ playerId: 'abc' }))).toMatchObject({ code: 'invalid_input', fieldErrors: { playerId: expect.any(String) } });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('a refusal from the service maps onto the right field and the state is plain data', async () => {
    const { recordBrownlowEligibilityAction } = await import('@/app/admin/operations/brownlow/actions');
    session.actor = SUPER_USER;
    // 20+ characters pass the form's shape check; the service then refuses the (non-postgres.js) executor.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = await recordBrownlowEligibilityAction({}, decisionForm());
    expect(state).toMatchObject({ code: 'unexpected', playerId: 11 });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    const { brownlowFailureState } = await import('@/app/admin/operations/brownlow/eligibility-form');
    expect(brownlowFailureState({ ok: false, code: 'citation_required', error: 'cite it' }, 7)).toMatchObject({ playerId: 7, fieldErrors: { citation: 'cite it' } });
    expect(brownlowFailureState({ ok: false, code: 'note_invalid', error: 'longer' }, 7)).toMatchObject({ fieldErrors: { note: 'longer' } });
    expect(brownlowFailureState({ ok: false, code: 'stale_decision', error: 'reload' }, 7)).toMatchObject({ code: 'stale_decision', playerId: 7 });
  });

  it('form parsing: shape checks only, with the boundaries', async () => {
    const f = await import('@/app/admin/operations/brownlow/eligibility-form');
    expect(f.parseBrownlowPlayerId('12')).toEqual({ ok: true, value: 12 });
    expect(f.parseBrownlowPlayerId('0').ok).toBe(false);
    expect(f.parseBrownlowPlayerId('1e3').ok).toBe(false);
    expect(f.parseBrownlowVerdict('eligible')).toEqual({ ok: true, value: 'eligible' });
    expect(f.parseBrownlowVerdict('Eligible').ok).toBe(false);
    expect(f.parseBrownlowCitation('  ref  ')).toEqual({ ok: true, value: 'ref' });
    expect(f.parseBrownlowCitation('').ok).toBe(false);
    expect(f.parseBrownlowCitation('x'.repeat(2001)).ok).toBe(false);
    expect(f.parseBrownlowCitation('x'.repeat(2000)).ok).toBe(true);
    expect(f.parseBrownlowDecisionNote('n'.repeat(19)).ok).toBe(false);
    expect(f.parseBrownlowDecisionNote('n'.repeat(20)).ok).toBe(true);
    expect(f.parseBrownlowDecisionNote(`  ${'n'.repeat(19)}  `).ok).toBe(false); // trimmed before the floor
    expect(f.parseBrownlowDecisionNote('n'.repeat(2001)).ok).toBe(false);
    expect(f.parseExpectedDecisionId('')).toEqual({ ok: true, value: null });
    expect(f.parseExpectedDecisionId('5')).toEqual({ ok: true, value: 5 });
    expect(f.parseExpectedDecisionId('-1').ok).toBe(false);
  });

  it('the action card states what changes, the irreversibility, the actor and the audit entries', async () => {
    const { describeBrownlowEligibilityConsequences } = await import('@/app/admin/operations/brownlow/eligibility-consequences');
    const sealed = describeBrownlowEligibilityConsequences({ actingEmail: 'super@example.invalid', season: 1990, playerId: 7, identity: 'afltables:players/s/x.html', sealedSeason: true, supersedesId: 4 });
    expect(sealed.changes.join(' ')).toMatch(/append-only/);
    expect(sealed.changes.join(' ')).toMatch(/NOT change any raw vote/);
    expect(sealed.affected).toContain('afltables:players/s/x.html');
    expect(sealed.validationState).toMatch(/SEALED/);
    expect(sealed.validationState).toMatch(/supersede decision #4/);
    expect(sealed.reversible).toBe(false);
    expect(sealed.reversibility).toMatch(/supersedes/);
    expect(sealed.actingUser).toContain('super@example.invalid');
    expect(sealed.audit.activityActions).toEqual(['admin.brownlow_eligibility_decided', 'admin.brownlow_eligibility_refused']);
    const open = describeBrownlowEligibilityConsequences({ season: 2026, playerId: 7, sealedSeason: false });
    expect(open.validationState).toMatch(/open/);
    expect(open.validationState).toMatch(/No earlier decision/);
    expect(describeBrownlowEligibilityConsequences({ season: 2026, playerId: 7, sealedSeason: null }).validationState).toMatch(/fails closed/);
  });

  it('the Brownlow action module exports only async functions, never revalidates, and guards first', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'app', 'admin', 'operations', 'brownlow', 'actions.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(source.startsWith("'use server';")).toBe(true);
    const exports = [...source.matchAll(/^export\s+(.*)$/gm)].map((m) => m[1]);
    expect(exports.length).toBeGreaterThan(0);
    for (const declaration of exports) expect(declaration).toMatch(/^async function \w+\(/);
    expect(source).not.toMatch(/\brevalidatePath\s*\(|from 'next\/cache'/);
    const actionCount = [...source.matchAll(/^export async function \w+Action\(/gm)].length;
    const guarded = [...source.matchAll(/^export async function \w+Action\([^{]*\{\n  const admin = await requireCapability\('data\.brownlow\.finalise'\);/gm)].length;
    expect(guarded).toBe(actionCount);
    expect(actionCount).toBe(1);
  });

  it('hasCapability: the decision is Super Admin only, the read is Admin and up', () => {
    expect(hasCapability(SUPER_USER, 'data.brownlow.finalise')).toBe(true);
    expect(hasCapability(PLAIN_ADMIN, 'data.brownlow.finalise')).toBe(false);
    expect(hasCapability(CONTRIBUTOR_USER, 'data.brownlow.finalise')).toBe(false);
    expect(hasCapability(PLAIN_ADMIN, 'data.brownlow.read')).toBe(true);
  });
});
