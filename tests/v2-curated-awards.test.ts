/**
 * AFLDB V2 Stage 4 (plan D8, ADR 0008) — curated awards, DB-free unit tests.
 *
 * A captured/fake executor stands in for the database, so these prove the SERVICE CONTRACT:
 *   - the workflow state machine (every illegal transition refused with a typed code);
 *   - every validation failure code;
 *   - role refusal before any SQL is sent;
 *   - exactly one ledger row per transition, written inside the transition's transaction;
 *   - approval rolls back (no commit) when the promotion port throws;
 *   - the offline file parser refuses a file whole;
 *   - the production wiring (`insertAwardWinner` on the service's own transaction);
 *   - a static proof that none of these modules can reach the network.
 * The real SQL and migration 111 run in tests/v2-curated-awards-pglite.test.ts.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type postgres from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CURATED_AWARD_TRANSITIONS,
  CuratedAwardError,
  MAX_SEASON,
  MIN_SEASON,
  PROPOSAL_ACTIONS,
  PROPOSAL_STATUSES,
  approveProposal,
  assertTransition,
  checkDecisionNote,
  createProposal,
  createProposalsFromFile,
  decideFourEyes,
  isLegalTransition,
  listProposals,
  normaliseProposalInput,
  parseAwardProposalFile,
  parseCsvRecords,
  readProposalHistory,
  rejectProposal,
  reviseApprovedProposal,
  reviseProposal,
  splitPlayerIdentity,
  validateAwardProposal,
  validateProposal,
  type ApprovedWinnerRevisionPort,
  type ApprovedWinnerRevisionRequest,
  type AwardPromotionPort,
  type CuratedAwardsViewer,
  type ProposalInput,
  type ProposalValues,
  type ValidationCode,
  type ValidationFacts,
} from '@afldb/admin';
import {
  nativeTransactionOf,
  postgresExecutor,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from '@afldb/db';
import { sealedSeasonsFrom, type SealedSeasons } from '@afldb/domain';

import { isAllowedRevalidatePath } from '@/app/admin/awards/revalidate-paths';
import { awardWinnerPromotionPort, awardWinnerRevisionPort } from '@/db/queries/award-proposals';
import {
  awardWinnerPaths,
  insertAwardWinner,
  readAwardWinnerInTx,
  reviseApprovedAwardWinnerInTx,
} from '@/db/queries/admin-awards';
import { awardPath, awardSeasonPath, clubPath, playerPath, seasonPath } from '@/lib/format';

// The production lifecycle functions are replaced: this suite pins the MAPPING, not PostgreSQL.
vi.mock('@/db/queries/admin-awards', () => ({
  insertAwardWinner: vi.fn(),
  readAwardWinnerInTx: vi.fn(),
  awardWinnerPaths: vi.fn(),
  reviseApprovedAwardWinnerInTx: vi.fn(),
}));

const ROOT = process.cwd();
const TODAY = '2026-10-19';
const NOW = () => new Date('2026-10-19T12:00:00Z');
const OPTIONS = { now: NOW };
const ID_ONE = 'afltables:players/s/synthetic_one.html';
// SYNTHETIC sealed range 1897-1899: the fixtures' seasons (1990, 1991) are OPEN under it, so the
// existing approve tests keep exercising the pre-seal behaviour. The seal tests use the real registry.
const SYNTHETIC_OPEN = { from: 1897, through: 1899, open: [] as number[] };
const REAL_SEALED = sealedSeasonsFrom(JSON.parse(readFileSync(join(process.cwd(), 'data', 'reference', 'seasons.json'), 'utf8')));

const SUPER: CuratedAwardsViewer = { role: 'super_admin', canManageAdmins: true, userId: 1 };
const ADMIN: CuratedAwardsViewer = { role: 'admin', canManageAdmins: false, userId: 2 };
const CONTRIBUTOR: CuratedAwardsViewer = { role: 'contributor', canManageAdmins: false, userId: 3 };

function input(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    awardSlug: 'synthetic-medal',
    season: 1990,
    playerIdentity: ID_ONE,
    playerNameRaw: 'Synthetic Player One',
    sourceKind: 'manual_entry',
    citation: 'SYNTHETIC citation',
    acquiredOn: TODAY,
    ...overrides,
  };
}
function values(overrides: Partial<ProposalInput> = {}): ProposalValues {
  return normaliseProposalInput(input(overrides));
}
const CLEAN_FACTS: ValidationFacts = {
  award: { id: 7, slug: 'synthetic-medal', category: 'award' },
  seasonInRegister: true,
  playerIds: [101],
  club: undefined,
  activeWinnerIds: [],
  pendingProposalIds: [],
};
function check(overrides: Partial<ProposalInput>, facts: ValidationFacts | null = CLEAN_FACTS) {
  return validateAwardProposal(values(overrides), facts, { today: TODAY, checkedAt: '2026-10-19T12:00:00.000Z' });
}
const codesOf = (result: { issues: { code: string }[] }) => result.issues.map((i) => i.code);

// ---------------------------------------------------------------------------
// A scripted fake executor: records every statement and every transaction event.
// ---------------------------------------------------------------------------
type Call = { text: string; params: readonly unknown[] };

const PROPOSAL_ROW = {
  id: 10, proposalKey: '11111111-1111-4111-8111-111111111111', revision: 1, revisionOfId: null,
  awardSlug: 'synthetic-medal', season: 1990, playerIdentity: ID_ONE, playerNameRaw: 'Synthetic Player One',
  clubSlug: null as string | null, votes: '12.50', position: null as string | null, isCaptain: false, isViceCaptain: false, note: null as string | null,
  duplicateConfirmed: false, sourceKind: 'manual_entry', sourceUrl: null as string | null, citation: 'SYNTHETIC citation',
  acquiredOn: '2026-10-01', status: 'validated', validationResult: null, validatedAt: null,
  approvedEntityKey: null as string | null, approvedAt: null as string | null, createdBy: 9,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

function makeFake(overrides: { row?: Partial<typeof PROPOSAL_ROW>; activeWinners?: number[] } = {}) {
  const calls: Call[] = [];
  const events: string[] = [];
  const row = { ...PROPOSAL_ROW, ...overrides.row };
  const reply = (text: string): object[] => {
    if (/FROM award_proposals p WHERE p\.id = \$1/.test(text)) return [row];
    if (/INSERT INTO award_proposals\s/.test(text)) return [{ id: 11 }];
    if (/FROM awards WHERE slug/.test(text)) return [{ id: 7, slug: 'synthetic-medal', category: 'award' }];
    if (/FROM seasons/.test(text)) return [{ year: 1990 }];
    if (/FROM clubs WHERE slug/.test(text)) return [{ id: 3 }];
    if (/FROM external_identities/.test(text)) return [{ id: 101 }];
    if (/FROM award_winners/.test(text)) return (overrides.activeWinners ?? []).map((id) => ({ id }));
    if (/^\s*UPDATE award_proposals/.test(text)) return [{ id: 10 }];
    if (/pg_advisory_xact_lock/.test(text)) return [{}];
    return [];
  };
  const runner: SqlExecutor = {
    async query<R extends object>(text: string, params: readonly unknown[] = []): Promise<R[]> {
      calls.push({ text, params });
      return reply(text) as R[];
    },
  };
  const executor: TransactionalSqlExecutor = {
    query: runner.query,
    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      events.push('begin');
      try {
        const result = await work(runner);
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  };
  const ledgerInserts = () => calls.filter((c) => /INSERT INTO award_proposal_decisions/.test(c.text));
  const statusUpdates = () => calls.filter((c) => /^\s*UPDATE award_proposals/.test(c.text));
  return { executor, calls, events, ledgerInserts, statusUpdates };
}

function okPromotion() {
  const promote = vi.fn<AwardPromotionPort['promote']>(async () => ({ entityKey: 'manual_admin_edit:synthetic-key' }));
  return { promote } satisfies AwardPromotionPort;
}

// ---------------------------------------------------------------------------
// 1. State machine
// ---------------------------------------------------------------------------
describe('the workflow state machine', () => {
  const FROMS = [null, ...PROPOSAL_STATUSES] as const;

  it('allows exactly the documented edges', () => {
    const legal = PROPOSAL_ACTIONS.flatMap((action) => FROMS.flatMap((from) => PROPOSAL_STATUSES
      .filter((to) => isLegalTransition(action, from, to)).map((to) => `${action}:${from}>${to}`)));
    expect(legal).toEqual([
      'create:null>proposed',
      'validate:proposed>validated', 'validate:proposed>validation_failed',
      'validate:validated>validated', 'validate:validated>validation_failed',
      'validate:validation_failed>validated', 'validate:validation_failed>validation_failed',
      'approve:validated>approved',
      'reject:proposed>rejected', 'reject:validated>rejected', 'reject:validation_failed>rejected',
      'revise:null>proposed',
      'supersede:proposed>superseded', 'supersede:validated>superseded', 'supersede:validation_failed>superseded',
      // V2-GAP-018 (migration 114): the audited revision of an approved proposal.
      'supersede_approved:approved>superseded', 'revise_approved:null>approved',
    ]);
    expect(Object.values(CURATED_AWARD_TRANSITIONS).reduce((n, edges) => n + edges.length, 0)).toBe(legal.length);
  });

  it('refuses every other (action, from, to) triple with the typed code illegal_transition', () => {
    let refused = 0;
    for (const action of PROPOSAL_ACTIONS) {
      for (const from of FROMS) {
        for (const to of PROPOSAL_STATUSES) {
          if (isLegalTransition(action, from, to)) {
            expect(() => assertTransition(action, from, to)).not.toThrow();
            continue;
          }
          refused += 1;
          try {
            assertTransition(action, from, to);
            expect.unreachable(`${action} ${from} -> ${to} should be refused`);
          } catch (error) {
            expect(error).toBeInstanceOf(CuratedAwardError);
            expect((error as CuratedAwardError).code).toBe('illegal_transition');
          }
        }
      }
    }
    expect(refused).toBe(PROPOSAL_ACTIONS.length * FROMS.length * PROPOSAL_STATUSES.length - 17);
  });

  it('rejected and superseded are terminal; approved has exactly one way out, supersede_approved (V2-GAP-018)', () => {
    for (const status of ['approved', 'rejected', 'superseded'] as const) {
      for (const action of PROPOSAL_ACTIONS) {
        for (const to of PROPOSAL_STATUSES) {
          const viaRevision = status === 'approved' && action === 'supersede_approved' && to === 'superseded';
          expect(isLegalTransition(action, status, to), `${action} ${status} -> ${to}`).toBe(viaRevision);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Validation
// ---------------------------------------------------------------------------
describe('validateAwardProposal', () => {
  it('passes a clean proposal', () => {
    expect(check({})).toEqual({ ok: true, issues: [], checkedAt: '2026-10-19T12:00:00.000Z' });
    expect(check({}, null).ok).toBe(true);
  });

  // Typed exhaustively: adding a ValidationCode without a case here fails the compiler.
  const CASES: Record<ValidationCode, () => ReturnType<typeof check>> = {
    award_slug_required: () => check({ awardSlug: '  ' }, null),
    award_not_found: () => check({}, { ...CLEAN_FACTS, award: null }),
    award_not_supported: () => check({ awardSlug: 'brownlow-medal' }, null),
    season_out_of_range: () => check({ season: MIN_SEASON - 1 }, null),
    season_not_in_register: () => check({}, { ...CLEAN_FACTS, seasonInRegister: false }),
    player_name_required: () => check({ playerNameRaw: ' ' }, null),
    player_identity_malformed: () => check({ playerIdentity: 'players/x.html' }, null),
    player_unresolved: () => check({ playerIdentity: null }),
    player_identity_unresolved: () => check({}, { ...CLEAN_FACTS, playerIds: [] }),
    player_identity_ambiguous: () => check({}, { ...CLEAN_FACTS, playerIds: [101, 102] }),
    club_not_found: () => check({ clubSlug: 'nowhere' }, { ...CLEAN_FACTS, club: null }),
    votes_out_of_range: () => check({ votes: '1000000' }, null),
    field_too_long: () => check({ note: 'x'.repeat(2001) }, null),
    source_kind_invalid: () => check({ sourceKind: 'telepathy' as ProposalInput['sourceKind'] }, null),
    evidence_missing: () => check({ citation: null, sourceUrl: null }, null),
    source_url_invalid: () => check({ sourceUrl: 'ftp://x.invalid/a' }, null),
    wikipedia_url_required: () => check({ sourceKind: 'wikipedia_offline_file', sourceUrl: 'https://example.invalid/a' }, null),
    acquired_on_invalid: () => check({ acquiredOn: '2026-02-30' }, null),
    duplicate_active_winner: () => check({}, { ...CLEAN_FACTS, activeWinnerIds: [5] }),
    duplicate_live_proposal: () => check({}, { ...CLEAN_FACTS, pendingProposalIds: [9] }),
  };

  it.each(Object.keys(CASES) as ValidationCode[])('reports %s as an error', (code) => {
    const result = CASES[code]();
    expect(codesOf(result)).toContain(code);
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.code === code)?.severity).toBe('error');
  });

  it('checks the season range, votes bounds and the date', () => {
    expect(check({ season: MIN_SEASON }, null).ok).toBe(true);
    expect(check({ season: MAX_SEASON }, null).ok).toBe(true);
    expect(codesOf(check({ season: MAX_SEASON + 1 }, null))).toEqual(['season_out_of_range']);
    expect(codesOf(check({ season: 1990.5 }, null))).toEqual(['season_out_of_range']);
    for (const votes of ['0', '999999.99', '12.5']) expect(check({ votes }, null).ok, votes).toBe(true);
    for (const votes of ['-1', '12.345', 'abc', '1e3']) expect(codesOf(check({ votes }, null)), votes).toEqual(['votes_out_of_range']);
    // "Not recorded" is null, never 0.
    expect(normaliseProposalInput(input({ votes: null })).votes).toBeNull();
    expect(normaliseProposalInput(input({ votes: '' })).votes).toBeNull();
    expect(normaliseProposalInput(input({ votes: 0 })).votes).toBe('0');
    expect(codesOf(check({ acquiredOn: '2026-10-20' }, null))).toEqual(['acquired_on_invalid']);
    expect(check({ acquiredOn: '2026-10-19' }, null).ok).toBe(true);
  });

  it('evidence needs a URL or a citation; Wikipedia needs a wikipedia.org page', () => {
    expect(check({ citation: null, sourceUrl: 'https://example.invalid/page' }, null).ok).toBe(true);
    expect(codesOf(check({ citation: null, sourceUrl: null }, null))).toEqual(['evidence_missing']);
    expect(check({ sourceKind: 'wikipedia_offline_file', sourceUrl: 'https://en.wikipedia.org/wiki/X' }, null).ok).toBe(true);
    expect(codesOf(check({ sourceKind: 'wikipedia_offline_file', sourceUrl: null }, null))).toContain('wikipedia_url_required');
    expect(codesOf(check({ sourceKind: 'wikipedia_offline_file', sourceUrl: 'http://en.wikipedia.org/wiki/X' }, null))).toContain('wikipedia_url_required');
  });

  it('a duplicate is a conflict to confirm: error unless duplicateConfirmed, then a warning', () => {
    const facts = { ...CLEAN_FACTS, activeWinnerIds: [5], pendingProposalIds: [9] };
    const unconfirmed = check({}, facts);
    expect(unconfirmed.ok).toBe(false);
    expect(unconfirmed.issues.map((i) => `${i.code}:${i.severity}`)).toEqual(['duplicate_active_winner:error', 'duplicate_live_proposal:error']);
    const confirmed = check({ duplicateConfirmed: true }, facts);
    expect(confirmed.ok).toBe(true);
    expect(confirmed.issues.map((i) => `${i.code}:${i.severity}`)).toEqual(['duplicate_active_winner:warning', 'duplicate_live_proposal:warning']);
  });

  it('splits a durable player identity', () => {
    expect(splitPlayerIdentity('afltables:players/a/b.html')).toEqual({ sourceKey: 'afltables', externalId: 'players/a/b.html' });
    expect(splitPlayerIdentity('manual_admin_edit:abc:def')).toEqual({ sourceKey: 'manual_admin_edit', externalId: 'abc:def' });
    expect(splitPlayerIdentity('players/a/b.html')).toBeNull();
    expect(splitPlayerIdentity('squiggle:12')).toBeNull();
  });

  it('decision notes: a rejection needs a reason; Wikipedia approval needs a verification note', () => {
    expect(() => checkDecisionNote('reject', null, 'manual_entry')).toThrow(/reason/);
    expect(() => checkDecisionNote('reject', 'short', 'manual_entry')).toThrow(/reason/);
    expect(checkDecisionNote('reject', ' a proper reason here ', 'manual_entry')).toBe('a proper reason here');
    expect(checkDecisionNote('approve', null, 'manual_entry')).toBeNull();
    expect(() => checkDecisionNote('approve', 'ok', 'wikipedia_offline_file')).toThrow(CuratedAwardError);
    expect(checkDecisionNote('approve', 'Verified against the club annual report.', 'wikipedia_offline_file')).toContain('Verified');
    expect(() => checkDecisionNote('validate', 'x'.repeat(2001), null)).toThrow(/longer/);
  });
});

// ---------------------------------------------------------------------------
// 3. Services against the fake executor
// ---------------------------------------------------------------------------
describe('services: role refusal happens before any SQL', () => {
  const mutations: [string, (v: CuratedAwardsViewer, f: ReturnType<typeof makeFake>) => Promise<unknown>][] = [
    ['createProposal', (v, f) => createProposal(v, f.executor, input(), OPTIONS)],
    ['createProposalsFromFile', (v, f) => createProposalsFromFile(v, f.executor, { text: '{}', format: 'json' }, OPTIONS)],
    ['validateProposal', (v, f) => validateProposal(v, f.executor, { proposalId: 10 }, OPTIONS)],
    ['approveProposal', (v, f) => approveProposal(v, f.executor, { proposalId: 10 }, { promotion: okPromotion(), sealed: SYNTHETIC_OPEN }, OPTIONS)],
    ['rejectProposal', (v, f) => rejectProposal(v, f.executor, { proposalId: 10, decisionNote: 'a sufficient reason' })],
    ['reviseProposal', (v, f) => reviseProposal(v, f.executor, { proposalId: 10, changes: { season: 1991 } }, OPTIONS)],
    ['reviseApprovedProposal', (v, f) => reviseApprovedProposal(v, f.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: 'a sufficient reason for it' }, { revision: { revise: vi.fn() }, sealed: SYNTHETIC_OPEN }, OPTIONS)],
  ];

  for (const viewer of [ADMIN, CONTRIBUTOR]) {
    it.each(mutations)(`${viewer.role} cannot %s`, async (_name, run) => {
      const fake = makeFake();
      await expect(run(viewer, fake)).rejects.toMatchObject({ code: 'forbidden' });
      expect(fake.calls).toEqual([]);
      expect(fake.events).toEqual([]);
    });
  }

  it('an admin can read; a contributor cannot; no viewer without a user id may do anything', async () => {
    const fake = makeFake();
    // The fake answers only the by-id read; list/revision/ledger queries come back empty.
    await expect(listProposals(ADMIN, fake.executor)).resolves.toEqual([]);
    await expect(readProposalHistory(ADMIN, fake.executor, { proposalId: 10 })).resolves.toEqual({ revisions: [], decisions: [] });
    await expect(listProposals(CONTRIBUTOR, fake.executor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(readProposalHistory(CONTRIBUTOR, fake.executor, { proposalId: 10 })).rejects.toMatchObject({ code: 'forbidden' });
    const nobody = { ...SUPER, userId: 0 };
    await expect(createProposal(nobody, fake.executor, input(), OPTIONS)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listProposals(nobody, fake.executor)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('reads send parameterised SQL only, with a bounded limit', async () => {
    const fake = makeFake();
    await listProposals(SUPER, fake.executor, { status: 'validated', limit: 100000 });
    const query = fake.calls.at(-1)!;
    expect(query.params).toEqual(['validated', null, null, false, 500]);
    await expect(listProposals(SUPER, fake.executor, { status: 'bogus' as never })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('services: exactly one ledger row per transition, inside its transaction', () => {
  it('create: one proposal insert, one ledger row, committed', async () => {
    const fake = makeFake();
    await createProposal(SUPER, fake.executor, input(), OPTIONS);
    expect(fake.events).toEqual(['begin', 'commit']);
    expect(fake.ledgerInserts()).toHaveLength(1);
    expect(fake.ledgerInserts()[0].params.slice(0, 5)).toEqual([11, 'create', null, 'proposed', 1]);
    // jsonb parameters are passed as VALUES, never pre-stringified (postgres.js would double-encode a string).
    expect(typeof fake.ledgerInserts()[0].params[6]).toBe('object');
    expect(fake.ledgerInserts()[0].params[5]).toBeNull();
  });

  it('create refuses an unstorable proposal before any SQL', async () => {
    const fake = makeFake();
    const error = await createProposal(SUPER, fake.executor, input({ citation: null, sourceUrl: null }), OPTIONS).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_input' });
    expect((error as CuratedAwardError).issues.map((i) => i.code)).toEqual(['evidence_missing']);
    expect(fake.calls).toEqual([]);
  });

  it('validate: one status update and one ledger row', async () => {
    const fake = makeFake({ row: { status: 'proposed' } });
    const record = await validateProposal(SUPER, fake.executor, { proposalId: 10 }, OPTIONS);
    expect(record.id).toBe(10);
    expect(fake.events).toEqual(['begin', 'commit']);
    expect(fake.statusUpdates()).toHaveLength(1);
    expect(fake.statusUpdates()[0].params.slice(0, 2)).toEqual([10, 'validated']);
    expect(fake.ledgerInserts()).toHaveLength(1);
    expect(fake.ledgerInserts()[0].params.slice(1, 5)).toEqual(['validate', 'proposed', 'validated', 1]);
  });

  it('validate records validation_failed when a fact is wrong', async () => {
    const fake = makeFake({ row: { status: 'proposed' }, activeWinners: [5] });
    await validateProposal(SUPER, fake.executor, { proposalId: 10 }, OPTIONS);
    expect(fake.statusUpdates()[0].params[1]).toBe('validation_failed');
    expect(fake.ledgerInserts()[0].params.slice(3, 4)).toEqual(['validation_failed']);
  });

  it('approve: re-validates, promotes once, one status update, one ledger row, committed', async () => {
    const fake = makeFake();
    const promotion = okPromotion();
    const result = await approveProposal(SUPER, fake.executor, { proposalId: 10, decisionNote: 'checked' }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS);
    expect(result.promotion.entityKey).toBe('manual_admin_edit:synthetic-key');
    expect(fake.events).toEqual(['begin', 'commit']);
    expect(promotion.promote).toHaveBeenCalledTimes(1);
    expect(promotion.promote.mock.calls[0][1]).toMatchObject({
      proposalId: 10, awardId: 7, playerId: 101, clubId: null, season: 1990, adminUserId: 1, adminNote: 'checked',
      confirmDuplicate: false, votes: '12.50', evidence: { sourceKind: 'manual_entry', acquiredOn: '2026-10-01' },
    });
    expect(fake.statusUpdates()).toHaveLength(1);
    expect(fake.statusUpdates()[0].params[2]).toBe('manual_admin_edit:synthetic-key');
    expect(fake.ledgerInserts()).toHaveLength(1);
    expect(fake.ledgerInserts()[0].params.slice(1, 5)).toEqual(['approve', 'validated', 'approved', 1]);
    // The advisory lock and the row lock are taken inside the transaction.
    expect(fake.calls.some((c) => /FOR UPDATE/.test(c.text))).toBe(true);
    expect(fake.calls.some((c) => /pg_advisory_xact_lock/.test(c.text))).toBe(true);
  });

  it('APPROVE ROLLBACK: a throwing promotion port rolls back; no status update, no ledger row, no commit', async () => {
    const fake = makeFake();
    const promotion: AwardPromotionPort = { promote: vi.fn(async () => { throw new Error('promotion exploded'); }) };
    await expect(approveProposal(SUPER, fake.executor, { proposalId: 10 }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS)).rejects.toThrow('promotion exploded');
    expect(fake.events).toEqual(['begin', 'rollback']);
    expect(fake.events).not.toContain('commit');
    expect(fake.statusUpdates()).toEqual([]);
    expect(fake.ledgerInserts()).toEqual([]);
  });

  it('a typed refusal from the promotion port also rolls back', async () => {
    const fake = makeFake();
    const promotion: AwardPromotionPort = {
      promote: vi.fn(async () => { throw new CuratedAwardError('promotion_refused', 'validation: refused'); }),
    };
    await expect(approveProposal(SUPER, fake.executor, { proposalId: 10 }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS)).rejects.toMatchObject({ code: 'promotion_refused' });
    expect(fake.events).toEqual(['begin', 'rollback']);
    expect(fake.ledgerInserts()).toEqual([]);
  });

  it('approve refuses a stale validation without promoting or writing', async () => {
    const fake = makeFake({ activeWinners: [5] });
    const promotion = okPromotion();
    await expect(approveProposal(SUPER, fake.executor, { proposalId: 10 }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS)).rejects.toMatchObject({ code: 'stale_validation' });
    expect(promotion.promote).not.toHaveBeenCalled();
    expect(fake.events).toEqual(['begin', 'rollback']);
    expect(fake.statusUpdates()).toEqual([]);
    expect(fake.ledgerInserts()).toEqual([]);
  });

  it('approve refuses a proposal that is not validated, and an unnoted Wikipedia approval', async () => {
    for (const status of ['proposed', 'validation_failed', 'approved', 'rejected', 'superseded']) {
      const fake = makeFake({ row: { status } });
      await expect(approveProposal(SUPER, fake.executor, { proposalId: 10 }, { promotion: okPromotion(), sealed: SYNTHETIC_OPEN }, OPTIONS))
        .rejects.toMatchObject({ code: 'illegal_transition' });
      expect(fake.ledgerInserts()).toEqual([]);
    }
    const wiki = makeFake({ row: { sourceKind: 'wikipedia_offline_file', sourceUrl: 'https://en.wikipedia.org/wiki/X' } });
    const promotion = okPromotion();
    await expect(approveProposal(SUPER, wiki.executor, { proposalId: 10 }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS)).rejects.toMatchObject({ code: 'note_required' });
    expect(promotion.promote).not.toHaveBeenCalled();
  });

  // The season seal (docs/v2/historical-baseline.md §2, workflow `curated_award_approval`). The fixture
  // proposal is for season 1990: SEALED under the real registry, OPEN under SYNTHETIC_OPEN.
  describe('approve: the season seal', () => {
    const LONG_NOTE = 'Checked against the club annual report and the AFL Record.';

    it('the real registry seals the fixture season (so these cases really are sealed)', () => {
      expect(REAL_SEALED.from).toBeLessThanOrEqual(1990);
      expect(REAL_SEALED.through).toBeGreaterThanOrEqual(1990);
      expect(REAL_SEALED.open).not.toContain(1990);
    });

    it.each([
      ['no note', undefined],
      ['a null note', null],
      ['a short note', 'checked'],
      ['a note that is short after trimming', `   ${'x'.repeat(10)}   `],
    ])('a sealed season with %s is refused before the port is called, with zero writes', async (_name, decisionNote) => {
      const fake = makeFake();
      const promotion = okPromotion();
      const error = await approveProposal(
        SUPER, fake.executor, { proposalId: 10, decisionNote }, { promotion, sealed: REAL_SEALED }, OPTIONS,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CuratedAwardError);
      expect(error).toMatchObject({ code: 'season_sealed_correction_invalid' });
      expect((error as CuratedAwardError).message).toContain('season 1990 is sealed');
      expect((error as CuratedAwardError).message).toContain('note must be 20-2000 characters');
      expect(promotion.promote).not.toHaveBeenCalled();
      expect(fake.events).toEqual(['begin', 'rollback']);
      expect(fake.statusUpdates()).toEqual([]);
      expect(fake.ledgerInserts()).toEqual([]);
    });

    it('a sealed season with a valid note is approved: promoted once, one status update, one ledger row carrying the note', async () => {
      const fake = makeFake();
      const promotion = okPromotion();
      const result = await approveProposal(
        SUPER, fake.executor, { proposalId: 10, decisionNote: LONG_NOTE }, { promotion, sealed: REAL_SEALED }, OPTIONS,
      );
      expect(result.proposal.id).toBe(10);
      expect(fake.events).toEqual(['begin', 'commit']);
      expect(promotion.promote).toHaveBeenCalledTimes(1);
      expect(promotion.promote.mock.calls[0][1]).toMatchObject({ season: 1990, adminUserId: 1, adminNote: LONG_NOTE });
      expect(fake.statusUpdates()).toHaveLength(1);
      expect(fake.ledgerInserts()).toHaveLength(1);
      expect(fake.ledgerInserts()[0].params.slice(1, 5)).toEqual(['approve', 'validated', 'approved', 1]);
      expect(fake.ledgerInserts()[0].params[7]).toBe(LONG_NOTE);
    });

    it('an open season needs no note: approved exactly as before the seal existed', async () => {
      const fake = makeFake();
      const promotion = okPromotion();
      await approveProposal(SUPER, fake.executor, { proposalId: 10 }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS);
      expect(fake.events).toEqual(['begin', 'commit']);
      expect(promotion.promote).toHaveBeenCalledTimes(1);
      expect(fake.ledgerInserts()).toHaveLength(1);
      expect(fake.ledgerInserts()[0].params[7]).toBeNull();
    });

    it('the rules compose: a Wikipedia proposal in a sealed season needs the verification note, and a long one passes both', async () => {
      const overrides = { sourceKind: 'wikipedia_offline_file', sourceUrl: 'https://en.wikipedia.org/wiki/X' };
      const refused = makeFake({ row: overrides });
      const refusedPromotion = okPromotion();
      await expect(approveProposal(
        SUPER, refused.executor, { proposalId: 10, decisionNote: 'looks right' }, { promotion: refusedPromotion, sealed: REAL_SEALED }, OPTIONS,
      )).rejects.toMatchObject({ code: 'note_required' });
      expect(refusedPromotion.promote).not.toHaveBeenCalled();

      const approved = makeFake({ row: overrides });
      const promotion = okPromotion();
      await approveProposal(
        SUPER, approved.executor, { proposalId: 10, decisionNote: LONG_NOTE }, { promotion, sealed: REAL_SEALED }, OPTIONS,
      );
      expect(promotion.promote).toHaveBeenCalledTimes(1);
      expect(approved.ledgerInserts()).toHaveLength(1);
    });
  });

  it('reject: one status update and one ledger row carrying the reason', async () => {
    const fake = makeFake({ row: { status: 'proposed' } });
    await rejectProposal(SUPER, fake.executor, { proposalId: 10, decisionNote: 'The citation is not a source.' });
    expect(fake.events).toEqual(['begin', 'commit']);
    expect(fake.statusUpdates()).toHaveLength(1);
    expect(fake.ledgerInserts()).toHaveLength(1);
    expect(fake.ledgerInserts()[0].params.slice(1, 5)).toEqual(['reject', 'proposed', 'rejected', 1]);
    expect(fake.ledgerInserts()[0].params[7]).toBe('The citation is not a source.');
    const bare = makeFake({ row: { status: 'proposed' } });
    await expect(rejectProposal(SUPER, bare.executor, { proposalId: 10 })).rejects.toMatchObject({ code: 'note_required' });
    expect(bare.events).toEqual(['begin', 'rollback']);
  });

  it('revise: two transitions on two rows, two ledger rows, supersede first', async () => {
    const fake = makeFake({ row: { status: 'validated' } });
    const { revision } = await reviseProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '13' } }, OPTIONS);
    expect(revision.id).toBe(10); // the fake serves the same row back; the SQL ordering is what is asserted
    expect(fake.events).toEqual(['begin', 'commit']);
    const order = fake.calls.map((c) => {
      if (/^\s*UPDATE award_proposals/.test(c.text)) return 'supersede-update';
      if (/INSERT INTO award_proposals\s/.test(c.text)) return 'insert-revision';
      if (/INSERT INTO award_proposal_decisions/.test(c.text)) return `ledger:${String(c.params[1])}`;
      return null;
    }).filter(Boolean);
    expect(order).toEqual(['supersede-update', 'ledger:supersede', 'insert-revision', 'ledger:revise']);
    const insert = fake.calls.find((c) => /INSERT INTO award_proposals\s/.test(c.text))!;
    expect(insert.params.slice(0, 3)).toEqual(['11111111-1111-4111-8111-111111111111', 2, 10]);
    expect(fake.ledgerInserts()).toHaveLength(2);
  });

  it('revise refuses: approved (typed), terminal states, no change, invalid change', async () => {
    const approved = makeFake({ row: { status: 'approved', approvedEntityKey: 'k', approvedAt: '2026-10-02T00:00:00.000Z' } });
    await expect(reviseProposal(SUPER, approved.executor, { proposalId: 10, changes: { votes: '14' } }, OPTIONS))
      .rejects.toMatchObject({ code: 'approved_revision_unsupported' });
    for (const status of ['rejected', 'superseded']) {
      const fake = makeFake({ row: { status } });
      await expect(reviseProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '14' } }, OPTIONS)).rejects.toMatchObject({ code: 'illegal_transition' });
    }
    const same = makeFake();
    await expect(reviseProposal(SUPER, same.executor, { proposalId: 10, changes: { votes: '12.50' } }, OPTIONS)).rejects.toMatchObject({ code: 'no_change' });
    const bad = makeFake();
    await expect(reviseProposal(SUPER, bad.executor, { proposalId: 10, changes: { season: 1700 } }, OPTIONS)).rejects.toMatchObject({ code: 'invalid_input' });
    for (const fake of [approved, same, bad]) {
      expect(fake.ledgerInserts()).toEqual([]);
      expect(fake.statusUpdates()).toEqual([]);
    }
  });

  it('every service rejects a bad proposal id and reports a missing proposal as not_found', async () => {
    const fake = makeFake();
    await expect(validateProposal(SUPER, fake.executor, { proposalId: 0 }, OPTIONS)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(validateProposal(SUPER, fake.executor, { proposalId: 1.5 }, OPTIONS)).rejects.toMatchObject({ code: 'invalid_input' });
    const empty: TransactionalSqlExecutor = {
      query: async () => [],
      transaction: async (work) => work({ query: async () => [] }),
    };
    await expect(validateProposal(SUPER, empty, { proposalId: 99 }, OPTIONS)).rejects.toMatchObject({ code: 'not_found' });
    await expect(readProposalHistory(SUPER, empty, { proposalId: 99 })).rejects.toMatchObject({ code: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// 3b. Four eyes (V2-GAP-019)
// ---------------------------------------------------------------------------
describe('four eyes: the creator of a revision may not approve it without an attestation', () => {
  const refusal = (fn: () => unknown): unknown => {
    try { fn(); } catch (error) { return error; }
    return undefined;
  };
  const ATTESTATION = 'No second reviewer is available before the printing deadline.';
  /** PROPOSAL_ROW.createdBy is 9 (not SUPER's id 1): SUPER approving is the "someone else" case. */
  const CREATOR_IS_SUPER = { createdBy: SUPER.userId };

  it('decideFourEyes: another approver needs nothing; a creator needs the explicit super_admin role AND 20+ trimmed characters', () => {
    expect(decideFourEyes(SUPER, 9, null)).toEqual({ selfApproval: false });
    expect(decideFourEyes(SUPER, 9, 'ignored when the approver is not the creator')).toEqual({ selfApproval: false });

    // A creator who is not a super admin is refused whatever they attest: the role is checked
    // explicitly, so widening data.awards.edit later cannot silently widen self-approval.
    for (const viewer of [ADMIN, CONTRIBUTOR]) {
      expect(refusal(() => decideFourEyes(viewer, viewer.userId, ATTESTATION))).toMatchObject({ code: 'self_approval_forbidden' });
    }
    // A super admin creator with no attestation: forbidden. Present but short (19 trimmed): attestation required.
    for (const blank of [undefined, null, '', '   ']) {
      expect(refusal(() => decideFourEyes(SUPER, SUPER.userId, blank))).toMatchObject({ code: 'self_approval_forbidden' });
    }
    expect(refusal(() => decideFourEyes(SUPER, SUPER.userId, 'x'.repeat(19)))).toMatchObject({ code: 'self_approval_attestation_required' });
    expect(refusal(() => decideFourEyes(SUPER, SUPER.userId, `  ${'x'.repeat(19)}  `))).toMatchObject({ code: 'self_approval_attestation_required' });
    expect(refusal(() => decideFourEyes(SUPER, SUPER.userId, 'x'.repeat(2001)))).toMatchObject({ code: 'invalid_input' });
    expect(decideFourEyes(SUPER, SUPER.userId, `  ${'x'.repeat(20)}  `)).toEqual({ selfApproval: true, attestation: 'x'.repeat(20) });
  });

  it('a creator approving their own revision is refused self_approval_forbidden: nothing promoted, written or ledgered', async () => {
    const fake = makeFake({ row: CREATOR_IS_SUPER });
    const promotion = okPromotion();
    await expect(approveProposal(SUPER, fake.executor, { proposalId: 10, decisionNote: 'checked' }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS))
      .rejects.toMatchObject({ code: 'self_approval_forbidden' });
    expect(promotion.promote).not.toHaveBeenCalled();
    expect(fake.events).toEqual(['begin', 'rollback']);
    expect(fake.statusUpdates()).toEqual([]);
    expect(fake.ledgerInserts()).toEqual([]);
  });

  it('a 19-character attestation is refused self_approval_attestation_required; nothing is written', async () => {
    const fake = makeFake({ row: CREATOR_IS_SUPER });
    const promotion = okPromotion();
    await expect(approveProposal(
      SUPER, fake.executor,
      { proposalId: 10, selfApprovalAttestation: 'x'.repeat(19) }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS,
    )).rejects.toMatchObject({ code: 'self_approval_attestation_required' });
    expect(promotion.promote).not.toHaveBeenCalled();
    expect(fake.ledgerInserts()).toEqual([]);
  });

  it('a super_admin creator with a 20+ character attestation is approved; the ledger row records selfApproval and the attestation', async () => {
    const fake = makeFake({ row: CREATOR_IS_SUPER });
    const promotion = okPromotion();
    const result = await approveProposal(
      SUPER, fake.executor,
      { proposalId: 10, decisionNote: 'checked', selfApprovalAttestation: `  ${ATTESTATION}  ` }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS,
    );
    expect(result.promotion.entityKey).toBe('manual_admin_edit:synthetic-key');
    expect(promotion.promote).toHaveBeenCalledTimes(1);
    expect(fake.events).toEqual(['begin', 'commit']);
    expect(fake.ledgerInserts()).toHaveLength(1);
    expect(fake.ledgerInserts()[0].params[6]).toMatchObject({
      status: 'approved', approved_entity_key: 'manual_admin_edit:synthetic-key',
      selfApproval: true, selfApprovalAttestation: ATTESTATION,
    });
  });

  it('a different approver needs no attestation: selfApproval is recorded false and any attestation is not kept', async () => {
    const fake = makeFake();
    await approveProposal(
      SUPER, fake.executor,
      { proposalId: 10, decisionNote: 'checked', selfApprovalAttestation: ATTESTATION }, { promotion: okPromotion(), sealed: SYNTHETIC_OPEN }, OPTIONS,
    );
    const ledger = fake.ledgerInserts()[0].params[6] as Record<string, unknown>;
    expect(ledger.selfApproval).toBe(false);
    expect('selfApprovalAttestation' in ledger).toBe(false);
  });

  it('the four-eyes check runs before the promotion port and before any lookup, but after the role gate', async () => {
    // An admin (not a super admin) creator is stopped by the capability gate first: forbidden, zero SQL.
    const gate = makeFake({ row: { createdBy: ADMIN.userId } });
    await expect(approveProposal(ADMIN, gate.executor, { proposalId: 10, selfApprovalAttestation: ATTESTATION }, { promotion: okPromotion(), sealed: SYNTHETIC_OPEN }, OPTIONS))
      .rejects.toMatchObject({ code: 'forbidden' });
    expect(gate.calls).toEqual([]);
    // A creator is refused before the validation lookups run (only the row lock was sent).
    const fake = makeFake({ row: CREATOR_IS_SUPER });
    await approveProposal(SUPER, fake.executor, { proposalId: 10 }, { promotion: okPromotion(), sealed: SYNTHETIC_OPEN }, OPTIONS).catch(() => undefined);
    expect(fake.calls.some((c) => /FROM awards WHERE slug/.test(c.text))).toBe(false);
  });

  it('the promotion result carries the revalidation paths the port computed (V2-GAP-024)', async () => {
    const paths = ['/awards', '/awards/synthetic-medal'];
    const fake = makeFake();
    const promotion: AwardPromotionPort = { promote: vi.fn(async () => ({ entityKey: 'manual_admin_edit:k', revalidatePaths: paths })) };
    const result = await approveProposal(SUPER, fake.executor, { proposalId: 10, decisionNote: 'checked' }, { promotion, sealed: SYNTHETIC_OPEN }, OPTIONS);
    expect(result.promotion.revalidatePaths).toEqual(paths);
  });
});

// ---------------------------------------------------------------------------
// 3c. Revising an APPROVED proposal (V2-GAP-018)
// ---------------------------------------------------------------------------
describe('reviseApprovedProposal: one transaction, two ledger rows, the canonical change through the port', () => {
  const KEY = 'manual_admin_edit:award_winner:abc-123';
  const NOTE = 'Corrected against the club annual report (page 14).';
  const APPROVED = { status: 'approved', approvedEntityKey: KEY, approvedAt: '2026-10-02T00:00:00.000Z' };
  const PATHS = ['/awards', '/awards/synthetic-medal', '/awards/synthetic-medal/1990'];

  function okRevision(mode: 'correct' | 'replace' = 'correct') {
    const revise = vi.fn<ApprovedWinnerRevisionPort['revise']>(async (_tx, request) => ({
      entityKey: mode === 'replace' ? 'manual_admin_edit:award_winner:new-456' : request.previousEntityKey,
      mode,
      voidedEntityKey: mode === 'replace' ? request.previousEntityKey : null,
      revalidatePaths: PATHS,
    }));
    return { revise } satisfies ApprovedWinnerRevisionPort;
  }
  const deps = (revision: ApprovedWinnerRevisionPort, sealed: SealedSeasons = SYNTHETIC_OPEN) => ({ revision, sealed });

  it('correct: validates, calls the port, supersedes the old revision then inserts the new one as approved, in that order', async () => {
    const fake = makeFake({ row: APPROVED });
    const revision = okRevision();
    const result = await reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: NOTE }, deps(revision), OPTIONS);

    expect(result.revised).toMatchObject({ entityKey: KEY, mode: 'correct', revalidatePaths: PATHS });
    expect(fake.events).toEqual(['begin', 'commit']);
    expect(revision.revise).toHaveBeenCalledTimes(1);
    expect(revision.revise.mock.calls[0][1]).toMatchObject({
      proposalId: 10, fromRevision: 1, toRevision: 2, previousEntityKey: KEY, mode: 'correct',
      correction: { votes: '13' }, adminUserId: 1, adminNote: NOTE,
      target: { awardId: 7, season: 1990, playerId: 101, votes: '13' },
    });
    const order = fake.calls.map((c) => {
      if (/FOR UPDATE/.test(c.text)) return 'lock';
      if (/^\s*UPDATE award_proposals/.test(c.text)) return 'supersede-update';
      if (/INSERT INTO award_proposals\s/.test(c.text)) return 'insert-approved-revision';
      if (/INSERT INTO award_proposal_decisions/.test(c.text)) return `ledger:${String(c.params[1])}`;
      return null;
    }).filter(Boolean);
    expect(order).toEqual(['lock', 'supersede-update', 'ledger:supersede_approved', 'insert-approved-revision', 'ledger:revise_approved']);
    const insert = fake.calls.find((c) => /INSERT INTO award_proposals\s/.test(c.text))!;
    expect(insert.text).toContain("'approved'");
    expect(insert.params.slice(0, 3)).toEqual(['11111111-1111-4111-8111-111111111111', 2, 10]);
    expect(insert.params.at(-1)).toBe(KEY);
    const [supersedeRow, reviseRow] = fake.ledgerInserts();
    expect(supersedeRow.params.slice(1, 5)).toEqual(['supersede_approved', 'approved', 'superseded', 1]);
    expect(reviseRow.params.slice(1, 5)).toEqual(['revise_approved', null, 'approved', 1]);
    expect(reviseRow.params[6]).toMatchObject({ status: 'approved', approved_entity_key: KEY, previous_entity_key: KEY, mode: 'correct', revision: 2, revision_of_id: 10, selfApproval: true, votes: '13' });
    expect(supersedeRow.params[7]).toBe(NOTE);
    expect(reviseRow.params[7]).toBe(NOTE);
  });

  it('replace: an identity-bearing change (season, award, player identity or name) takes the replace mode and records the NEW entity key', async () => {
    for (const changes of [{ season: 1991 }, { playerNameRaw: 'Synthetic Player Uno' }, { playerIdentity: 'afltables:players/s/synthetic_two.html' }, { awardSlug: 'other-medal' }] as const) {
      const fake = makeFake({ row: APPROVED });
      const revision = okRevision('replace');
      const result = await reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes, decisionNote: NOTE }, deps(revision), OPTIONS);
      expect(revision.revise.mock.calls[0][1].mode).toBe('replace');
      expect(result.revised).toMatchObject({ mode: 'replace', entityKey: 'manual_admin_edit:award_winner:new-456', voidedEntityKey: KEY });
      expect(fake.calls.find((c) => /INSERT INTO award_proposals\s/.test(c.text))!.params.at(-1)).toBe('manual_admin_edit:award_winner:new-456');
      expect(fake.ledgerInserts()[1].params[6]).toMatchObject({ approved_entity_key: 'manual_admin_edit:award_winner:new-456', previous_entity_key: KEY, mode: 'replace' });
    }
  });

  it('only non-identity values changing is a correct, naming just the fields that changed (club only when the slug changed)', async () => {
    const fake = makeFake({ row: { ...APPROVED, position: 'Forward', clubSlug: 'a-club' } });
    const revision = okRevision();
    await reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes: { position: null, isCaptain: true, note: 'n', votes: '12.5' }, decisionNote: NOTE }, deps(revision), OPTIONS);
    // '12.5' is the same recorded value as '12.50'; the club did not change so clubId is absent.
    expect(revision.revise.mock.calls[0][1].correction).toEqual({ position: null, isCaptain: true, note: 'n' });

    const moved = makeFake({ row: { ...APPROVED, clubSlug: 'a-club' } });
    const movedRevision = okRevision();
    await reviseApprovedProposal(SUPER, moved.executor, { proposalId: 10, changes: { clubSlug: 'b-club' }, decisionNote: NOTE }, deps(movedRevision), OPTIONS);
    expect(movedRevision.revise.mock.calls[0][1].correction).toEqual({ clubId: 3 });
    const cleared = makeFake({ row: { ...APPROVED, clubSlug: 'a-club' } });
    const clearedRevision = okRevision();
    await reviseApprovedProposal(SUPER, cleared.executor, { proposalId: 10, changes: { clubSlug: null }, decisionNote: NOTE }, deps(clearedRevision), OPTIONS);
    expect(clearedRevision.revise.mock.calls[0][1].correction).toEqual({ clubId: null });
  });

  it('PORT FAILURE ROLLBACK: a throwing port rolls back; no supersede, no new revision, no ledger row, no commit', async () => {
    const fake = makeFake({ row: APPROVED });
    const revision: ApprovedWinnerRevisionPort = { revise: vi.fn(async () => { throw new Error('canonical write exploded'); }) };
    await expect(reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: NOTE }, deps(revision), OPTIONS))
      .rejects.toThrow('canonical write exploded');
    expect(fake.events).toEqual(['begin', 'rollback']);
    expect(fake.statusUpdates()).toEqual([]);
    expect(fake.ledgerInserts()).toEqual([]);
    expect(fake.calls.some((c) => /INSERT INTO award_proposals\s/.test(c.text))).toBe(false);

    const refused: ApprovedWinnerRevisionPort = {
      revise: vi.fn(async () => { throw new CuratedAwardError('approved_winner_not_active', 'The approved winner is void.'); }),
    };
    const second = makeFake({ row: APPROVED });
    await expect(reviseApprovedProposal(SUPER, second.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: NOTE }, deps(refused), OPTIONS))
      .rejects.toMatchObject({ code: 'approved_winner_not_active' });
    expect(second.ledgerInserts()).toEqual([]);
  });

  it('the approved canonical row is not a "duplicate" of its own revision: the active-winner lookup excludes its entity key', async () => {
    const fake = makeFake({ row: APPROVED });
    await reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: NOTE }, deps(okRevision()), OPTIONS);
    const lookup = fake.calls.find((c) => /FROM award_winners/.test(c.text))!;
    expect(lookup.text).toMatch(/AND NOT \(source_record_id = \$5 AND source_id IN \(SELECT id FROM sources WHERE key = \$4\)\)/);
    expect(lookup.params.slice(3)).toEqual(['manual_admin_edit', 'award_winner:abc-123']);
    // Another active winner for the same player (a real duplicate) still refuses the revision.
    const dup = makeFake({ row: APPROVED, activeWinners: [5] });
    const revision = okRevision();
    await expect(reviseApprovedProposal(SUPER, dup.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: NOTE }, deps(revision), OPTIONS))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(revision.revise).not.toHaveBeenCalled();
  });

  it('refuses: not approved, no change, evidence-only change, invalid new values — all before the port and with no write', async () => {
    for (const status of ['proposed', 'validated', 'validation_failed', 'rejected', 'superseded']) {
      const fake = makeFake({ row: { status } });
      const revision = okRevision();
      await expect(reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: NOTE }, deps(revision), OPTIONS))
        .rejects.toMatchObject({ code: 'illegal_transition' });
      expect(revision.revise).not.toHaveBeenCalled();
      expect(fake.ledgerInserts()).toEqual([]);
    }
    const cases: [Partial<ProposalInput>, string][] = [
      [{ votes: '12.50' }, 'no_change'],
      // Evidence-only: the proposal changes but the canonical row would not.
      [{ citation: 'A different SYNTHETIC citation' }, 'no_change'],
      [{ season: 1700 }, 'invalid_input'],
      [{ votes: '-4' }, 'invalid_input'],
    ];
    for (const [changes, code] of cases) {
      const fake = makeFake({ row: APPROVED });
      const revision = okRevision();
      await expect(reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes, decisionNote: NOTE }, deps(revision), OPTIONS))
        .rejects.toMatchObject({ code });
      expect(revision.revise).not.toHaveBeenCalled();
      expect(fake.statusUpdates()).toEqual([]);
      expect(fake.ledgerInserts()).toEqual([]);
      expect(fake.events).toEqual(['begin', 'rollback']);
    }
  });

  it('the decision note is always required (20..2000 trimmed); a sealed season refuses first, with the seal message', async () => {
    for (const decisionNote of [undefined, null, '', '   ', 'too short', `  ${'n'.repeat(19)}  `]) {
      const fake = makeFake({ row: APPROVED });
      const revision = okRevision();
      await expect(reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote }, deps(revision), OPTIONS))
        .rejects.toMatchObject({ code: 'note_required' });
      expect(revision.revise).not.toHaveBeenCalled();
      expect(fake.ledgerInserts()).toEqual([]);
    }
    const long = makeFake({ row: APPROVED });
    await expect(reviseApprovedProposal(SUPER, long.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: 'n'.repeat(2001) }, deps(okRevision()), OPTIONS))
      .rejects.toMatchObject({ code: 'invalid_input' });

    // 1990 is SEALED in the real registry: a short note is a seal refusal and the port is never called.
    const sealed = makeFake({ row: APPROVED });
    const revision = okRevision();
    await expect(reviseApprovedProposal(SUPER, sealed.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: 'too short' }, deps(revision, REAL_SEALED), OPTIONS))
      .rejects.toMatchObject({ code: 'season_sealed_correction_invalid' });
    expect(revision.revise).not.toHaveBeenCalled();
    expect(sealed.ledgerInserts()).toEqual([]);
    // With a 20+ character note the sealed season is an audited correction and proceeds.
    const ok = makeFake({ row: APPROVED });
    await reviseApprovedProposal(SUPER, ok.executor, { proposalId: 10, changes: { votes: '13' }, decisionNote: NOTE }, deps(okRevision(), REAL_SEALED), OPTIONS);
    expect(ok.events).toEqual(['begin', 'commit']);
  });

  it('moving a winner INTO a sealed season is checked against the seal too (both the old and the new season)', async () => {
    // The old season (1990) is open under the synthetic range; the new one (1898) is sealed under it.
    const fake = makeFake({ row: APPROVED });
    const revision = okRevision('replace');
    await expect(reviseApprovedProposal(SUPER, fake.executor, { proposalId: 10, changes: { season: 1898 }, decisionNote: 'short' }, deps(revision, SYNTHETIC_OPEN), OPTIONS))
      .rejects.toMatchObject({ code: 'season_sealed_correction_invalid' });
    expect(revision.revise).not.toHaveBeenCalled();
  });

  it('reviseProposal still refuses an approved proposal, now pointing at reviseApprovedProposal', async () => {
    const fake = makeFake({ row: APPROVED });
    const error = await reviseProposal(SUPER, fake.executor, { proposalId: 10, changes: { votes: '14' } }, OPTIONS).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'approved_revision_unsupported' });
    expect((error as Error).message).toContain('reviseApprovedProposal');
  });
});

// ---------------------------------------------------------------------------
// 4. The offline file parser
// ---------------------------------------------------------------------------
describe('parseAwardProposalFile: whole-file refusal', () => {
  const fileDoc = (proposals: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({
    format: 'afldb-award-proposals', version: 1,
    defaults: { source_kind: 'offline_file', citation: 'SYNTHETIC file citation', acquired_on: '2026-10-18' },
    proposals, ...extra,
  });
  const row = (overrides: Record<string, unknown> = {}) => ({
    award_slug: 'synthetic-medal', season: 1990, player_identity: ID_ONE, player_name: 'Synthetic Player One', ...overrides,
  });

  it('accepts a valid JSON file and layers row values over file defaults over argument defaults', () => {
    const parsed = parseAwardProposalFile(fileDoc([row(), row({ season: 1991, player_identity: 'afltables:players/s/synthetic_two.html', votes: 3, source_kind: 'wikipedia_offline_file', source_url: 'https://en.wikipedia.org/wiki/X' })]),
      'json', { acquiredOn: '2020-01-01', sourceKind: 'offline_file' }, TODAY);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.proposals).toHaveLength(2);
    expect(parsed.proposals[0]).toMatchObject({ sourceKind: 'offline_file', acquiredOn: '2026-10-18', citation: 'SYNTHETIC file citation', season: 1990 });
    expect(parsed.proposals[1]).toMatchObject({ sourceKind: 'wikipedia_offline_file', votes: 3, sourceUrl: 'https://en.wikipedia.org/wiki/X' });
  });

  it('refuses the WHOLE file when any row is invalid, listing every problem and returning no proposals', () => {
    const parsed = parseAwardProposalFile(fileDoc([
      row(), row({ season: 1700, player_identity: 'afltables:players/s/other.html' }), row({ award_slug: '', player_identity: 'afltables:players/s/third.html' }),
    ]), 'json', {}, TODAY);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.map((e) => e.row)).toEqual([2, 3]);
    expect(parsed.errors[0].issues.map((i) => i.code)).toEqual(['season_out_of_range']);
    expect(parsed).not.toHaveProperty('proposals');
  });

  it.each([
    ['not JSON', '{nope', /not valid JSON/],
    ['not an object', '[]', /must be an object/],
    ['wrong format', JSON.stringify({ format: 'x', version: 1, proposals: [row()] }), /format must be/],
    ['wrong version', JSON.stringify({ format: 'afldb-award-proposals', version: 2, defaults: { source_kind: 'offline_file', citation: 'c', acquired_on: '2026-10-18' }, proposals: [row()] }), /version must be 1/],
    ['unknown top-level key', fileDoc([row()], { extra: 1 }), /Unknown top-level/],
    ['unknown row key', fileDoc([row({ player_id: 5 })]), /Unknown key\(s\): player_id/],
    ['no proposals', fileDoc([]), /holds no proposals/],
    ['proposals not an array', fileDoc([]).replace('"proposals":[]', '"proposals":{}'), /proposals must be an array/],
    ['manual_entry in a file', fileDoc([row({ source_kind: 'manual_entry' })]), /source_kind must be one of/],
    ['no source kind', JSON.stringify({ format: 'afldb-award-proposals', version: 1, defaults: { citation: 'c', acquired_on: '2026-10-18' }, proposals: [row()] }), /source_kind is required/],
    ['missing evidence', JSON.stringify({ format: 'afldb-award-proposals', version: 1, defaults: { source_kind: 'offline_file', acquired_on: '2026-10-18' }, proposals: [row()] }), /source URL or a citation/],
    ['a non-object proposal', fileDoc([5]), /must be an object/],
    ['wrong field type', fileDoc([row({ player_name: 7 })]), /player_name must be text/],
    ['wikipedia without a wikipedia URL', fileDoc([row({ source_kind: 'wikipedia_offline_file', source_url: 'https://example.invalid/a' })]), /wikipedia\.org/],
    ['a repeated row', fileDoc([row(), row()]), /Repeats row 1/],
    ['empty', '   ', /empty/],
  ])('refuses %s', (_name, text, pattern) => {
    const parsed = parseAwardProposalFile(text, 'json', {}, TODAY);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.map((e) => e.message).join(' | ')).toMatch(pattern);
  });

  it('a confirmed repeat is allowed', () => {
    const parsed = parseAwardProposalFile(fileDoc([row(), row({ duplicate_confirmed: true })]), 'json', {}, TODAY);
    expect(parsed.ok).toBe(true);
  });

  it('parses CSV (quotes, commas, CRLF, BOM) and refuses it whole on a bad row', () => {
    const header = 'award_slug,season,player_identity,player_name,votes,note,is_captain,citation,source_kind,acquired_on';
    const good = `﻿${header}\r\nsynthetic-medal,1990,${ID_ONE},"One, Synthetic ""Quoted""",12.5,"two\nlines",true,SYNTHETIC cite,offline_file,2026-10-18\r\n`;
    const parsed = parseAwardProposalFile(good, 'csv', {}, TODAY);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.proposals[0]).toMatchObject({ playerNameRaw: 'One, Synthetic "Quoted"', votes: '12.5', note: 'two\nlines', isCaptain: true, season: 1990 });
    }
    const bad = `${header}\nsynthetic-medal,1990,${ID_ONE},A,1,,,c,offline_file,2026-10-18\nsynthetic-medal,abc,${ID_ONE},B,1,,,c,offline_file,2026-10-18\n`;
    const refused = parseAwardProposalFile(bad, 'csv', {}, TODAY);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.map((e) => e.row)).toEqual([2]);
    expect(parseAwardProposalFile(`${header},bogus\n`, 'csv', {}, TODAY).ok).toBe(false);
    expect(parseAwardProposalFile(`${header}\nonly,two\n`, 'csv', {}, TODAY).ok).toBe(false);
    expect(parseAwardProposalFile('award_slug\n"unterminated', 'csv', {}, TODAY).ok).toBe(false);
    expect(parseAwardProposalFile('', 'csv', {}, TODAY).ok).toBe(false);
    expect(parseAwardProposalFile('x', 'xml' as never, {}, TODAY).ok).toBe(false);
  });

  it('the CSV record splitter handles quoting and line endings', () => {
    expect(parseCsvRecords('a,b\r\n"c,d","e""f"\n\ng')).toEqual([['a', 'b'], ['c,d', 'e"f'], ['g']]);
    expect(parseCsvRecords('')).toEqual([]);
    expect(() => parseCsvRecords('"open')).toThrow(/not closed/);
  });

  it('createProposalsFromFile refuses an invalid file before opening a transaction, and creates proposals only', async () => {
    const bad = makeFake();
    await expect(createProposalsFromFile(SUPER, bad.executor, { text: fileDoc([row({ season: 1 })]), format: 'json' }, OPTIONS))
      .rejects.toMatchObject({ code: 'invalid_file' });
    expect(bad.events).toEqual([]);
    expect(bad.calls).toEqual([]);

    const good = makeFake();
    const created = await createProposalsFromFile(SUPER, good.executor, { text: fileDoc([row(), row({ season: 1991 })]), format: 'json' }, OPTIONS);
    expect(created).toHaveLength(2);
    expect(good.events).toEqual(['begin', 'commit']);
    expect(good.ledgerInserts()).toHaveLength(2);
    // Creating from a file never validates, promotes or approves anything.
    expect(good.calls.some((c) => /award_winners|UPDATE award_proposals/.test(c.text))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Production wiring (insertAwardWinner mocked)
// ---------------------------------------------------------------------------
describe('the production promotion port', () => {
  const insert = vi.mocked(insertAwardWinner);
  const request = {
    proposalId: 10, proposalKey: 'k', revision: 2, awardId: 7, season: 1990, playerId: 101,
    playerNameRaw: 'Synthetic Player One', clubId: 3, votes: '12.50', position: 'p', isCaptain: true,
    isViceCaptain: false, note: 'n', confirmDuplicate: true, adminUserId: 1, adminNote: 'approved',
    evidence: { sourceKind: 'offline_file' as const, sourceUrl: 'https://example.invalid/a', citation: null, acquiredOn: '2026-10-01' },
  };

  beforeEach(() => { insert.mockReset(); });

  it('calls the existing insertAwardWinner on the SAME native transaction, carrying the proposal into the audit row', async () => {
    const unsafe = vi.fn(async () => []);
    const nativeTx = { unsafe } as unknown as postgres.TransactionSql;
    const sql = {
      unsafe,
      begin: async (work: (tx: postgres.TransactionSql) => Promise<unknown>) => work(nativeTx),
    } as unknown as postgres.Sql;
    insert.mockResolvedValue({ rowId: 5, entityKey: 'manual_admin_edit:award_winner:u', sourceRecordId: 'award_winner:u' });

    const result = await postgresExecutor(sql).transaction((tx) => awardWinnerPromotionPort.promote(tx, request));
    expect(result).toEqual({ entityKey: 'manual_admin_edit:award_winner:u', revalidatePaths: [] });
    expect(insert).toHaveBeenCalledTimes(1);
    const [usedTx, args] = insert.mock.calls[0];
    expect(usedTx).toBe(nativeTx);
    expect(args).toMatchObject({
      awardId: 7, season: 1990, playerId: 101, clubId: 3, votes: '12.50', isCaptain: true,
      adminUserId: 1, adminNote: 'approved', confirmDuplicate: true,
      auditExtra: { curated_proposal_id: 10, curated_proposal_key: 'k', curated_proposal_revision: 2, curated_source_kind: 'offline_file', curated_acquired_on: '2026-10-01' },
    });
  });

  it('refuses to run outside a postgres.js transaction executor', async () => {
    const plain: SqlExecutor = { query: async () => [] };
    await expect(awardWinnerPromotionPort.promote(plain, request)).rejects.toMatchObject({ code: 'promotion_refused' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('maps the awards module\'s RollbackRefusal to the typed promotion_refused and rethrows anything else', async () => {
    const nativeTx = { unsafe: vi.fn() } as unknown as postgres.TransactionSql;
    const sql = { unsafe: vi.fn(), begin: async (work: (tx: postgres.TransactionSql) => Promise<unknown>) => work(nativeTx) } as unknown as postgres.Sql;
    const refusal = Object.assign(new Error('The selected award does not exist.'), { name: 'RollbackRefusal', reason: 'validation', detail: 'The selected award does not exist.' });
    insert.mockRejectedValueOnce(refusal);
    const error = await postgresExecutor(sql).transaction((tx) => awardWinnerPromotionPort.promote(tx, request)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CuratedAwardError);
    expect(error).toMatchObject({ code: 'promotion_refused', message: 'validation: The selected award does not exist.' });
    insert.mockRejectedValueOnce(new Error('connection reset'));
    await expect(postgresExecutor(sql).transaction((tx) => awardWinnerPromotionPort.promote(tx, request))).rejects.toThrow('connection reset');
  });

  it('is server-only and never copies the award_winners SQL', () => {
    const source = readFileSync(join(ROOT, 'src', 'db', 'queries', 'award-proposals.ts'), 'utf8');
    expect(source).toMatch(/^import 'server-only';/);
    expect(source).not.toMatch(/INSERT INTO award_winners/);
    expect(source).not.toMatch(/INSERT INTO data_edits|INSERT INTO data_overrides/);
    expect(source).toContain("from '@/db/queries/admin-awards'");
    // @afldb/admin importing it is ruled out by the import allowlist in the static proofs below.
  });
});

describe('the production ports: revalidation paths and the approved-winner revision (V2-GAP-024, V2-GAP-018)', () => {
  const insert = vi.mocked(insertAwardWinner);
  const readRow = vi.mocked(readAwardWinnerInTx);
  const pathsFor = vi.mocked(awardWinnerPaths);
  const reviseInTx = vi.mocked(reviseApprovedAwardWinnerInTx);

  function nativeExecutor() {
    const unsafe = vi.fn(async () => []);
    const nativeTx = { unsafe } as unknown as postgres.TransactionSql;
    const sql = {
      unsafe,
      begin: async (work: (tx: postgres.TransactionSql) => Promise<unknown>) => work(nativeTx),
    } as unknown as postgres.Sql;
    return { nativeTx, executor: postgresExecutor(sql) };
  }

  const promotion = {
    proposalId: 10, proposalKey: 'k', revision: 1, awardId: 7, season: 1990, playerId: 101,
    playerNameRaw: 'Synthetic Player One', clubId: null, votes: '12.50', position: null, isCaptain: false,
    isViceCaptain: false, note: null, confirmDuplicate: false, adminUserId: 1, adminNote: 'approved',
    evidence: { sourceKind: 'offline_file' as const, sourceUrl: null, citation: 'c', acquiredOn: '2026-10-01' },
  };
  const revisionRequest: ApprovedWinnerRevisionRequest = {
    proposalId: 10, proposalKey: 'k', fromRevision: 1, toRevision: 2,
    previousEntityKey: 'manual_admin_edit:award_winner:abc', mode: 'correct', correction: { votes: '13' },
    target: {
      awardId: 7, season: 1990, playerId: 101, playerNameRaw: 'Synthetic Player One', clubId: 3, votes: '13',
      position: 'p', isCaptain: true, isViceCaptain: false, note: 'n', confirmDuplicate: true,
    },
    adminUserId: 4, adminNote: 'A sufficient revision reason.',
    evidence: { sourceKind: 'offline_file', sourceUrl: 'https://example.invalid/a', citation: null, acquiredOn: '2026-10-01' },
  };

  beforeEach(() => {
    insert.mockReset();
    readRow.mockReset();
    pathsFor.mockReset();
    reviseInTx.mockReset();
  });

  it('the promotion port returns the paths of the row it created, computed from that row (not client-supplied)', async () => {
    const { nativeTx, executor } = nativeExecutor();
    insert.mockResolvedValue({ rowId: 5, entityKey: 'manual_admin_edit:award_winner:u', sourceRecordId: 'award_winner:u' });
    const row = { id: 5, awardSlug: 'synthetic-medal', season: 1990, playerId: 101, playerSlug: 'p', clubSlug: null } as unknown as Awaited<ReturnType<typeof readAwardWinnerInTx>>;
    readRow.mockResolvedValue(row);
    pathsFor.mockReturnValue(['/awards', '/awards/synthetic-medal']);

    const result = await executor.transaction((tx) => awardWinnerPromotionPort.promote(tx, promotion));
    expect(result).toEqual({ entityKey: 'manual_admin_edit:award_winner:u', revalidatePaths: ['/awards', '/awards/synthetic-medal'] });
    expect(readRow).toHaveBeenCalledWith(nativeTx, 5);
    expect(pathsFor).toHaveBeenCalledWith(row);

    readRow.mockResolvedValue(null);
    const missing = await executor.transaction((tx) => awardWinnerPromotionPort.promote(tx, promotion));
    expect(missing.revalidatePaths).toEqual([]);
  });

  it('every path the server computes for a winner is admitted by the /admin/awards/revalidate allowlist', () => {
    const computed = [
      '/awards', awardPath('synthetic-medal'), '/sitemap.xml', awardSeasonPath('synthetic-medal', 1990),
      seasonPath(1990), playerPath('synthetic-player-one', 101), clubPath('synthetic-club'),
    ];
    for (const path of computed) expect(isAllowedRevalidatePath(path), path).toBe(true);
    expect(isAllowedRevalidatePath('/admin/operations')).toBe(false);
    expect(isAllowedRevalidatePath('//evil.example/awards')).toBe(false);
  });

  it('the revision port runs the tx-level lifecycle on the SAME native transaction, mapping the request and carrying the proposal into the audit', async () => {
    const { nativeTx, executor } = nativeExecutor();
    reviseInTx.mockResolvedValue({ mode: 'correct', rowId: 5, entityKey: 'manual_admin_edit:award_winner:abc', voidedEntityKey: null, revalidatePaths: ['/awards'] });

    const result = await executor.transaction((tx) => awardWinnerRevisionPort.revise(tx, revisionRequest));
    expect(result).toEqual({ entityKey: 'manual_admin_edit:award_winner:abc', mode: 'correct', voidedEntityKey: null, revalidatePaths: ['/awards'] });
    expect(reviseInTx).toHaveBeenCalledTimes(1);
    const [usedTx, args] = reviseInTx.mock.calls[0];
    expect(usedTx).toBe(nativeTx);
    expect(args).toMatchObject({
      approvedEntityKey: 'manual_admin_edit:award_winner:abc', adminUserId: 4, adminNote: 'A sufficient revision reason.',
      mode: 'correct', correction: { votes: '13' },
      replacement: { awardId: 7, season: 1990, playerId: 101, clubId: 3, votes: '13', isCaptain: true, confirmDuplicate: true },
      auditExtra: {
        curated_proposal_id: 10, curated_proposal_key: 'k', curated_proposal_revision: 2, curated_revises_revision: 1,
        curated_revises_entity_key: 'manual_admin_edit:award_winner:abc', curated_source_kind: 'offline_file',
      },
    });
  });

  it('the revision port refuses to run outside a postgres.js transaction executor', async () => {
    const plain: SqlExecutor = { query: async () => [] };
    await expect(awardWinnerRevisionPort.revise(plain, revisionRequest)).rejects.toMatchObject({ code: 'promotion_refused' });
    expect(reviseInTx).not.toHaveBeenCalled();
  });

  it('a missing or void canonical winner is approved_winner_not_active; any other lifecycle refusal is promotion_refused; anything else rethrows', async () => {
    const { executor } = nativeExecutor();
    const refusal = (reason: string, detail: string) => Object.assign(new Error(detail), { name: 'RollbackRefusal', reason, detail });
    for (const reason of ['not_found', 'invalid_transition']) {
      reviseInTx.mockRejectedValueOnce(refusal(reason, 'The approved award winner is void.'));
      const error = await executor.transaction((tx) => awardWinnerRevisionPort.revise(tx, revisionRequest)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CuratedAwardError);
      expect(error).toMatchObject({ code: 'approved_winner_not_active', message: 'The approved award winner is void.' });
    }
    reviseInTx.mockRejectedValueOnce(refusal('duplicate', 'already recorded'));
    const duplicate = await executor.transaction((tx) => awardWinnerRevisionPort.revise(tx, revisionRequest)).catch((e: unknown) => e);
    expect(duplicate).toMatchObject({ code: 'promotion_refused', message: 'duplicate: already recorded' });
    reviseInTx.mockRejectedValueOnce(new Error('connection reset'));
    await expect(executor.transaction((tx) => awardWinnerRevisionPort.revise(tx, revisionRequest))).rejects.toThrow('connection reset');
  });

  it('is server-only and copies no award_winners SQL: it goes through the lifecycle functions', () => {
    const source = readFileSync(join(ROOT, 'src', 'db', 'queries', 'award-proposals.ts'), 'utf8');
    expect(source).not.toMatch(/UPDATE award_winners|INSERT INTO award_winners|INSERT INTO data_edits|INSERT INTO data_overrides/);
    expect(source).toContain('reviseApprovedAwardWinnerInTx');
  });
});

// ---------------------------------------------------------------------------
// 6. The postgres.js adapter
// ---------------------------------------------------------------------------
describe('postgresExecutor', () => {
  it('sends parameterised text through unsafe and returns plain rows', async () => {
    const unsafe = vi.fn<(text: string, params: unknown[]) => Promise<object[]>>(async () => Object.assign([{ a: 1 }], { count: 1 }));
    const executor = postgresExecutor({ unsafe, begin: vi.fn() } as unknown as postgres.Sql);
    const rows = await executor.query('SELECT $1::int AS a', [1]);
    expect(rows).toEqual([{ a: 1 }]);
    expect(Array.isArray(rows)).toBe(true);
    expect(unsafe).toHaveBeenCalledWith('SELECT $1::int AS a', [1]);
    await executor.query('SELECT 1');
    expect(unsafe).toHaveBeenLastCalledWith('SELECT 1', []);
    expect(nativeTransactionOf(executor)).toBeUndefined();
  });

  it('runs a transaction through sql.begin, rolls back on a throw, and exposes the native handle only inside', async () => {
    const txUnsafe = vi.fn(async () => []);
    const nativeTx = { unsafe: txUnsafe } as unknown as postgres.TransactionSql;
    let ended: 'resolved' | 'rejected' | null = null;
    const begin = vi.fn(async (work: (tx: postgres.TransactionSql) => Promise<unknown>) => {
      try { const r = await work(nativeTx); ended = 'resolved'; return r; } catch (e) { ended = 'rejected'; throw e; }
    });
    const executor = postgresExecutor({ unsafe: vi.fn(), begin } as unknown as postgres.Sql);
    await executor.transaction(async (tx) => {
      await tx.query('SELECT 1');
      expect(nativeTransactionOf(tx)).toBe(nativeTx);
      expect('transaction' in tx).toBe(false);
    });
    expect(ended).toBe('resolved');
    await expect(executor.transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(ended).toBe('rejected');
    expect(txUnsafe).toHaveBeenCalledWith('SELECT 1', []);
  });
});

// ---------------------------------------------------------------------------
// 7. Static proofs: no network, in-memory only
// ---------------------------------------------------------------------------
describe('static proofs', () => {
  const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

  function analyse(path: string): { imports: string[]; identifiers: Set<string>; source: string } {
    const source = readFileSync(join(ROOT, path), 'utf8');
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const imports = ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);
    const identifiers = new Set<string>();
    const visit = (node: import('typescript').Node): void => {
      if (ts.isIdentifier(node)) identifiers.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
    return { imports, identifiers, source };
  }

  const NETWORK_IDENTIFIERS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'XMLHttpRequestUpload', 'sendBeacon'];

  // A strict import ALLOWLIST per module: anything outside it (an HTTP client, a socket, a file
  // reader) fails here.
  const MODULES: [string, readonly string[]][] = [
    ['packages/admin/src/curated-awards-model.ts', ['@/lib/auth/capabilities']],
    ['packages/admin/src/curated-awards-file.ts', ['./curated-awards-model']],
    // '@afldb/domain' is the pure season-seal decision (no I/O, no network); added with the seal check.
    ['packages/admin/src/curated-awards.ts', ['@afldb/db', '@afldb/domain', './curated-awards-model', './curated-awards-file']],
    ['packages/db/src/sql-executor.ts', ['postgres']],
    ['packages/testing/src/pglite.ts', ['@afldb/db', '@electric-sql/pglite']],
  ];

  it.each(MODULES)('%s imports only its allowlist and names no network API', (path, allowed) => {
    const { imports, identifiers } = analyse(path);
    expect(imports.filter((i) => !allowed.includes(i))).toEqual([]);
    expect(NETWORK_IDENTIFIERS.filter((name) => identifiers.has(name))).toEqual([]);
  });

  it('the admin curated-award modules read no file and fetch nothing: Wikipedia input is text handed in', () => {
    for (const path of ['packages/admin/src/curated-awards-model.ts', 'packages/admin/src/curated-awards-file.ts', 'packages/admin/src/curated-awards.ts']) {
      const { imports, identifiers } = analyse(path);
      expect(imports.some((i) => /^(node:)?(fs|http|https|net|dns|tls|dgram|child_process)(\/|$)/.test(i)), path).toBe(false);
      for (const name of ['readFile', 'readFileSync', 'createReadStream', 'readdirSync']) expect(identifiers.has(name), `${path} ${name}`).toBe(false);
    }
  });

  it('the production adapter and its package index reach no HTTP client either', () => {
    for (const path of ['src/db/queries/award-proposals.ts', 'packages/admin/src/index.ts']) {
      const { imports, identifiers } = analyse(path);
      expect(imports.some((i) => /^(node:)?(http|https|net|dns|tls|dgram)$|^(undici|axios|node-fetch|got|ws)$/.test(i)), path).toBe(false);
      expect(NETWORK_IDENTIFIERS.filter((name) => identifiers.has(name)), path).toEqual([]);
    }
  });

  it('the PGlite helper is in-memory only: new PGlite() takes no argument, so no dataDir', () => {
    const { source } = analyse('packages/testing/src/pglite.ts');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/new PGlite\(([^)]*)\)/g)).toEqual(['new PGlite()']);
    expect(code).not.toMatch(/dataDir|idb:\/\/|file:\/\//);
  });
});
