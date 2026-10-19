// tests | Integration tests for curated award four eyes and approved revisions
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.
/**
 * AFLDB V2 Launch F (stream F-D, ADR 0008) - the curated-award follow-ups, against a REAL PostgreSQL
 * (the isolated cluster's `_test` database), through the production code path end to end:
 *
 *   withAwardProposalExecutor -> approveProposal / reviseApprovedProposal
 *     -> awardWinnerPromotionPort / awardWinnerRevisionPort -> the tx-level replace / correct
 *
 * run over a postgres.js executor connected as the restricted `afldb_import` role (the role the
 * operations centre connects as). PGlite is not evidence for any of this.
 *
 * Proven here:
 *  - V2-GAP-019 four eyes: another approver writes award_winners + data_overrides + data_edits + the
 *    ledger and returns the revalidation paths (V2-GAP-024); the creator is refused without an
 *    attestation and approved with one, the ledger row recording `selfApproval`;
 *  - V2-GAP-018 approved revision: the CORRECT path (votes change: one row, same key) and the REPLACE
 *    path (player changes: old row void, new row active, new key) each commit in ONE transaction with
 *    both ledger rows; a forced canonical failure leaves NO ledger row, the proposal still approved and
 *    award_winners untouched; a void canonical row is refused; a sealed season needs the 20..2000 note;
 *  - V2-GAP-020: an identity-less proposal cannot be approved - the approval's own re-validation
 *    refuses it (`stale_validation`, issue `player_unresolved`) and nothing is written.
 *
 * FIXTURES: synthetic awards, players, clubs and seasons under the `v2-b2-it` marker. The template
 * database holds NO reference rows, so this suite seeds what it needs (sources, seasons 2091 and 2092,
 * two clubs, two players with AFL Tables identities, two super admins) and removes everything it created.
 */
import './guard';

import { createImportRoleParityHarness } from './import-role-parity';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  approveProposal,
  createProposal,
  reviseApprovedProposal,
  validateProposal,
  type ApprovedWinnerRevisionPort,
  type CuratedAwardsViewer,
  type ProposalInput,
} from '@afldb/admin';
import type { SealedSeasons } from '@afldb/domain';

import { isAllowedRevalidatePath } from '@/app/admin/awards/revalidate-paths';
import { awardWinnerPromotionPort, awardWinnerRevisionPort, withAwardProposalExecutor } from '@/db/queries/award-proposals';
import { awardPath, awardSeasonPath, playerPath, seasonPath } from '@/lib/format';

const importRole = createImportRoleParityHarness(
  process.env.AFLDB_TEST_DATABASE_URL,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
// The production executor connects with AFLDB_IMPORT_DATABASE_URL: point it at the restricted test role.
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL
  ?? process.env.AFLDB_TEST_DATABASE_URL;

const MARKER = 'v2-b2-it';
const OPEN_SEASON = 2092;
const SEALED_SEASON = 2091;
const NOW = () => new Date('2026-10-19T12:00:00Z');
const OPTIONS = { now: NOW };
/** Sealed through 2091 only: 2091 is sealed, 2092 is open. */
const SEALED: SealedSeasons = { from: 1897, through: SEALED_SEASON, open: [] };
/** Nothing in range is sealed: every fixture season is open. */
const OPEN: SealedSeasons = { from: 1897, through: 1899, open: [] };
const NOTE = 'SYNTHETIC integration note: checked against the club annual report (page 14).';
const ATTESTATION = 'SYNTHETIC attestation: no second reviewer is available this week.';

const owner = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 2, onnotice: () => {} });

const createdSources: string[] = [];
const createdSeasons: number[] = [];
let creatorId = 0;
let approverId = 0;
let creator: CuratedAwardsViewer;
let approver: CuratedAwardsViewer;
const players: { id: number; identity: string; slug: string }[] = [];
const clubs: { id: number; slug: string }[] = [];
let awardCounter = 0;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

async function seed(): Promise<void> {
  for (const [key, kind] of [['afltables', 'scrape'], ['manual_admin_edit', 'manual']] as const) {
    const created = await owner`
      INSERT INTO sources (key, name, kind) VALUES (${key}, ${`${MARKER} ${key}`}, ${kind})
      ON CONFLICT (key) DO NOTHING RETURNING id`;
    if (created.length > 0) createdSources.push(key);
  }
  for (const year of [SEALED_SEASON, OPEN_SEASON]) {
    const created = await owner`
      INSERT INTO seasons (year, league, status) VALUES (${year}, 'AFL', 'complete'::season_status)
      ON CONFLICT (year) DO NOTHING RETURNING year`;
    if (created.length > 0) createdSeasons.push(year);
  }
  for (const [role, email] of [['creator', 'creator'], ['approver', 'approver']] as const) {
    const [user] = await owner<{ id: number }[]>`
      INSERT INTO auth_users (email, role) VALUES (${`${MARKER}-${email}@example.invalid`}, 'super_admin')
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id::int AS id`;
    if (role === 'creator') creatorId = user.id; else approverId = user.id;
  }
  creator = { role: 'super_admin', canManageAdmins: true, userId: creatorId };
  approver = { role: 'super_admin', canManageAdmins: true, userId: approverId };

  const [afltables] = await owner<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
  for (const index of [1, 2]) {
    const name = `Synthetic B2 Player ${index}`;
    const slug = `${MARKER}-player-${index}`;
    const path = `players/V/${MARKER}-${index}.html`;
    const [player] = await owner<{ id: number }[]>`
      INSERT INTO players (display_name, search_name, sort_name, slug)
      VALUES (${name}, afldb_normalise_name(${name}), ${name}, ${slug}) RETURNING id::int AS id`;
    await owner`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES (${afltables.id}, ${path}, ${player.id}, 'unique', 'afltables_profile_url')`;
    players.push({ id: player.id, identity: `afltables:${path}`, slug });
  }
  for (const index of [1, 2]) {
    const [org] = await owner<{ id: number }[]>`
      INSERT INTO club_organizations (name, slug) VALUES (${`${MARKER} Organization ${index}`}, ${`${MARKER}-org-${index}`})
      RETURNING id::int AS id`;
    await owner.begin(async (tx) => {
      await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
      const [club] = await tx<{ id: number }[]>`
        INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
        VALUES (${`${MARKER}-club-${index}`}, ${`${MARKER} Club ${index}`}, ${`Club ${index}`}, ${`B${index}`}, -1,
                ${`${MARKER}-club-${index}`}, ${org.id})
        RETURNING id::int AS id`;
      await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
      clubs.push({ id: club.id, slug: `${MARKER}-club-${index}` });
    });
  }
}

async function purge(): Promise<void> {
  const like = `${MARKER}-%`;
  await owner`DELETE FROM award_proposal_decisions WHERE proposal_id IN (SELECT id FROM award_proposals WHERE award_slug LIKE ${like})`;
  await owner`DELETE FROM award_proposals WHERE award_slug LIKE ${like}`;
  await owner`DELETE FROM data_edits WHERE table_name = 'award_winners' AND new_values->>'award_slug' LIKE ${like}`;
  await owner`
    DELETE FROM data_overrides
     WHERE entity_type = 'award_winners'
       AND (override_values->>'award_slug' LIKE ${like}
            OR entity_key IN (SELECT s.key || ':' || w.source_record_id
                                FROM award_winners w JOIN sources s ON s.id = w.source_id
                               WHERE w.award_id IN (SELECT id FROM awards WHERE slug LIKE ${like})))`;
  await owner`DELETE FROM award_winners WHERE award_id IN (SELECT id FROM awards WHERE slug LIKE ${like})`;
  await owner`DELETE FROM awards WHERE slug LIKE ${like}`;
}

async function teardown(): Promise<void> {
  await purge();
  await owner`DELETE FROM external_identities WHERE external_id LIKE ${`players/V/${MARKER}-%`}`;
  await owner`DELETE FROM players WHERE slug LIKE ${`${MARKER}-%`}`;
  await owner`DELETE FROM clubs WHERE slug LIKE ${`${MARKER}-club-%`}`;
  await owner`DELETE FROM club_organizations WHERE slug LIKE ${`${MARKER}-org-%`}`;
  await owner`DELETE FROM auth_users WHERE email LIKE ${`${MARKER}-%@example.invalid`}`;
  if (createdSeasons.length > 0) await owner`DELETE FROM seasons WHERE year IN ${owner(createdSeasons)}`;
  if (createdSources.length > 0) await owner`DELETE FROM sources WHERE key IN ${owner(createdSources)}`;
}

beforeAll(async () => {
  if (importRole.isConfigured) {
    const proof = await importRole.validate();
    expect(proof.restricted.role).toBe('afldb_import');
    expect(proof.restricted.database).toMatch(/_test$/);
  }
  await teardown(); // debris of a crashed earlier run
  await seed();
}, 60_000);

afterAll(async () => {
  await teardown();
  await owner.end({ timeout: 5 });
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

type Fixture = { awardId: number; slug: string };

/** One award per test: every duplicate and span check is then about THIS test's rows only. */
async function makeAward(): Promise<Fixture> {
  awardCounter += 1;
  const slug = `${MARKER}-award-${awardCounter}`;
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO awards (slug, name, category, competition) VALUES (${slug}, ${`${MARKER} award ${awardCounter}`}, 'award', 'AFL')
    RETURNING id::int AS id`;
  return { awardId: row.id, slug };
}

function proposalInput(award: Fixture, over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    awardSlug: award.slug,
    season: OPEN_SEASON,
    playerIdentity: players[0].identity,
    playerNameRaw: 'Synthetic B2 Player 1',
    clubSlug: null,
    votes: '10',
    position: null,
    sourceKind: 'manual_entry',
    citation: 'SYNTHETIC citation for integration tests',
    acquiredOn: '2026-10-01',
    ...over,
  };
}

/** Create (as `by`) and validate one proposal; returns its id. */
async function validatedProposal(award: Fixture, over: Partial<ProposalInput> = {}, by: CuratedAwardsViewer = creator): Promise<number> {
  return withAwardProposalExecutor(async (executor) => {
    const created = await createProposal(by, executor, proposalInput(award, over), OPTIONS);
    const validated = await validateProposal(by, executor, { proposalId: created.id }, OPTIONS);
    expect(validated.status).toBe('validated');
    return created.id;
  });
}

const approveAs = (viewer: CuratedAwardsViewer, proposalId: number, input: { decisionNote?: string; selfApprovalAttestation?: string } = {}, sealed: SealedSeasons = OPEN) =>
  withAwardProposalExecutor((executor) => approveProposal(
    viewer, executor, { proposalId, ...input }, { promotion: awardWinnerPromotionPort, sealed }, OPTIONS));

/** Create, validate (creator) and approve (approver): an approved proposal and its canonical winner. */
async function approvedProposal(award: Fixture, over: Partial<ProposalInput> = {}): Promise<{ proposalId: number; entityKey: string }> {
  const proposalId = await validatedProposal(award, over);
  const approved = await approveAs(approver, proposalId, { decisionNote: NOTE });
  return { proposalId, entityKey: approved.promotion.entityKey };
}

const reviseAs = (
  viewer: CuratedAwardsViewer,
  proposalId: number,
  changes: Partial<ProposalInput>,
  decisionNote: string | null = NOTE,
  sealed: SealedSeasons = OPEN,
  revision: ApprovedWinnerRevisionPort = awardWinnerRevisionPort,
) => withAwardProposalExecutor((executor) => reviseApprovedProposal(
  viewer, executor, { proposalId, changes, decisionNote }, { revision, sealed }, OPTIONS));

/** The real port, then a failure: the canonical SQL has genuinely run when the transaction is undone. */
const failingAfterCanonicalWrite: ApprovedWinnerRevisionPort = {
  async revise(tx, request) {
    await awardWinnerRevisionPort.revise(tx, request);
    throw new Error('FORCED failure after the canonical write');
  },
};

type WinnerRow = { id: number; status: string; statusReason: string | null; votes: string | null; season: number; playerId: number | null; position: string | null; clubId: number | null; key: string };

async function winners(award: Fixture): Promise<WinnerRow[]> {
  return owner<WinnerRow[]>`
    SELECT w.id::int AS id, w.status, w.status_reason AS "statusReason", w.votes::text AS votes, w.season::int AS season,
           w.player_id::int AS "playerId", w.position, w.club_id::int AS "clubId", s.key || ':' || w.source_record_id AS key
      FROM award_winners w JOIN sources s ON s.id = w.source_id
     WHERE w.award_id = ${award.awardId} ORDER BY w.id`;
}

async function ledger(award: Fixture) {
  return owner<{ proposalId: number; action: string; fromStatus: string | null; toStatus: string; adminUserId: number; note: string | null; newValues: Record<string, unknown> }[]>`
    SELECT d.proposal_id::int AS "proposalId", d.action, d.from_status AS "fromStatus", d.to_status AS "toStatus",
           d.admin_user_id::int AS "adminUserId", d.note, d.new_values AS "newValues"
      FROM award_proposal_decisions d JOIN award_proposals p ON p.id = d.proposal_id
     WHERE p.award_slug = ${award.slug} ORDER BY d.id`;
}

async function proposalRows(award: Fixture) {
  return owner<{ id: number; revision: number; revisionOfId: number | null; status: string; approvedEntityKey: string | null; createdBy: number; votes: string | null; season: number }[]>`
    SELECT id::int AS id, revision::int AS revision, revision_of_id::int AS "revisionOfId", status,
           approved_entity_key AS "approvedEntityKey", created_by::int AS "createdBy", votes::text AS votes, season::int AS season
      FROM award_proposals WHERE award_slug = ${award.slug} ORDER BY id`;
}

async function auditCounts(award: Fixture): Promise<{ edits: number; overrides: number }> {
  const [edits] = await owner<{ n: number }[]>`
    SELECT count(*)::int AS n FROM data_edits WHERE table_name = 'award_winners' AND new_values->>'award_slug' = ${award.slug}`;
  const [overrides] = await owner<{ n: number }[]>`
    SELECT count(*)::int AS n FROM data_overrides
     WHERE entity_type = 'award_winners'
       AND entity_key IN (SELECT s.key || ':' || w.source_record_id FROM award_winners w JOIN sources s ON s.id = w.source_id WHERE w.award_id = ${award.awardId})`;
  return { edits: edits.n, overrides: overrides.n };
}

async function dataEdits(award: Fixture) {
  return owner<{ fieldGroup: string; note: string | null; adminUserId: number; newValues: Record<string, unknown> }[]>`
    SELECT field_group AS "fieldGroup", note, admin_user_id::int AS "adminUserId", new_values AS "newValues"
      FROM data_edits WHERE table_name = 'award_winners' AND new_values->>'award_slug' = ${award.slug} ORDER BY id`;
}

async function overrideOf(entityKey: string) {
  return owner<{ fieldGroup: string; values: Record<string, unknown> }[]>`
    SELECT field_group AS "fieldGroup", override_values AS values FROM data_overrides
     WHERE entity_type = 'award_winners' AND entity_key = ${entityKey} ORDER BY field_group`;
}

async function expectNothingChanged(award: Fixture, before: { winners: WinnerRow[]; ledgerLength: number; proposals: unknown; counts: { edits: number; overrides: number } }) {
  expect(await winners(award)).toEqual(before.winners);
  expect((await ledger(award)).length).toBe(before.ledgerLength);
  expect(await proposalRows(award)).toEqual(before.proposals);
  expect(await auditCounts(award)).toEqual(before.counts);
}

async function snapshot(award: Fixture) {
  return {
    winners: await winners(award),
    ledgerLength: (await ledger(award)).length,
    proposals: await proposalRows(award),
    counts: await auditCounts(award),
  };
}

/* ------------------------------------------------------------------ *
 * V2-GAP-019 / V2-GAP-024: approval
 * ------------------------------------------------------------------ */

describe('approval by another administrator (four eyes satisfied)', () => {
  it('writes award_winners + data_overrides + data_edits + the ledger in one transaction and returns the revalidation paths', async () => {
    const award = await makeAward();
    const proposalId = await validatedProposal(award, { clubSlug: clubs[0].slug });
    const approved = await approveAs(approver, proposalId, { decisionNote: NOTE });

    const [winner] = await winners(award);
    expect(winner).toMatchObject({ status: 'active', votes: '10.00', season: OPEN_SEASON, playerId: players[0].id, clubId: clubs[0].id });
    expect(winner.key).toBe(approved.promotion.entityKey);
    expect(approved.proposal).toMatchObject({ status: 'approved', approvedEntityKey: winner.key, createdBy: creatorId });

    const overrides = await overrideOf(winner.key);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ fieldGroup: 'record', values: { award_slug: award.slug, season: OPEN_SEASON, votes: '10.00', club_slug: clubs[0].slug } });
    const edits = await dataEdits(award);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      fieldGroup: 'award_winner_created', note: NOTE, adminUserId: approverId,
      newValues: { entity_key: winner.key, curated_proposal_id: proposalId, curated_proposal_revision: 1, curated_source_kind: 'manual_entry' },
    });

    expect((await ledger(award)).map((row) => [row.action, row.adminUserId])).toEqual([
      ['create', creatorId], ['validate', creatorId], ['approve', approverId]]);
    const approveRow = (await ledger(award)).find((row) => row.action === 'approve')!;
    expect(approveRow.newValues).toMatchObject({ status: 'approved', approved_entity_key: winner.key, selfApproval: false });
    expect('selfApprovalAttestation' in approveRow.newValues).toBe(false);

    // The award span was recomputed in the same transaction.
    const [span] = await owner<{ first: number; last: number }[]>`SELECT first_season::int AS first, last_season::int AS last FROM awards WHERE id = ${award.awardId}`;
    expect(span).toEqual({ first: OPEN_SEASON, last: OPEN_SEASON });

    // V2-GAP-024: the paths are computed server-side from the created row and the revalidate route admits every one.
    expect(approved.promotion.revalidatePaths).toEqual(expect.arrayContaining([
      '/awards', awardPath(award.slug), '/sitemap.xml', awardSeasonPath(award.slug, OPEN_SEASON), seasonPath(OPEN_SEASON),
      playerPath(players[0].slug, players[0].id),
    ]));
    for (const path of approved.promotion.revalidatePaths ?? []) expect(isAllowedRevalidatePath(path), path).toBe(true);
  });
});

describe('approval by the creator (V2-GAP-019)', () => {
  it('is refused self_approval_forbidden without an attestation, and nothing is written', async () => {
    const award = await makeAward();
    const proposalId = await validatedProposal(award);
    const before = await snapshot(award);

    await expect(approveAs(creator, proposalId, { decisionNote: NOTE })).rejects.toMatchObject({ code: 'self_approval_forbidden' });
    await expect(approveAs(creator, proposalId, { decisionNote: NOTE, selfApprovalAttestation: 'x'.repeat(19) }))
      .rejects.toMatchObject({ code: 'self_approval_attestation_required' });
    await expectNothingChanged(award, before);
    expect(await winners(award)).toEqual([]);
  });

  it('succeeds with a 20+ character attestation; the ledger row records selfApproval and the attestation text', async () => {
    const award = await makeAward();
    const proposalId = await validatedProposal(award);
    const approved = await approveAs(creator, proposalId, { decisionNote: NOTE, selfApprovalAttestation: `  ${ATTESTATION}  ` });

    expect(approved.proposal.status).toBe('approved');
    const [winner] = await winners(award);
    expect(winner.status).toBe('active');
    expect((await dataEdits(award))[0].fieldGroup).toBe('award_winner_created');
    const approveRow = (await ledger(award)).find((row) => row.action === 'approve')!;
    expect(approveRow).toMatchObject({ adminUserId: creatorId });
    expect(approveRow.newValues).toMatchObject({ selfApproval: true, selfApprovalAttestation: ATTESTATION });
  });
});

/* ------------------------------------------------------------------ *
 * V2-GAP-018: revising an approved winner
 * ------------------------------------------------------------------ */

describe('reviseApprovedProposal: the CORRECT path (votes change)', () => {
  it('corrects the one row in place and records both ledger rows in the same transaction', async () => {
    const award = await makeAward();
    const { proposalId, entityKey } = await approvedProposal(award);
    const result = await reviseAs(creator, proposalId, { votes: '15', position: 'Centre' });

    expect(result.revised).toMatchObject({ mode: 'correct', entityKey, voidedEntityKey: null });
    expect(result.revised.revalidatePaths).toEqual(expect.arrayContaining(['/awards', awardPath(award.slug), awardSeasonPath(award.slug, OPEN_SEASON)]));
    for (const path of result.revised.revalidatePaths) expect(isAllowedRevalidatePath(path), path).toBe(true);

    // ONE canonical row, same durable key, new values; no second row, no void.
    expect(await winners(award)).toEqual([expect.objectContaining({ key: entityKey, status: 'active', votes: '15.00', position: 'Centre', playerId: players[0].id })]);
    // The durable record (what survives a rebuild) carries the new values.
    expect((await overrideOf(entityKey))[0]).toMatchObject({ fieldGroup: 'record', values: { votes: '15', position: 'Centre' } });
    const edits = await dataEdits(award);
    expect(edits.map((edit) => edit.fieldGroup)).toEqual(['award_winner_created', 'award_winner_corrected']);
    expect(edits[1]).toMatchObject({
      note: NOTE, adminUserId: creatorId,
      newValues: { votes: '15', position: 'Centre', curated_proposal_id: proposalId, curated_proposal_revision: 2, curated_revises_entity_key: entityKey },
    });

    // The proposals: revision 1 superseded (key kept), revision 2 approved with the SAME key, linked.
    const rows = await proposalRows(award);
    expect(rows).toEqual([
      expect.objectContaining({ id: proposalId, revision: 1, status: 'superseded', approvedEntityKey: entityKey, votes: '10.00' }),
      expect.objectContaining({ id: result.revision.id, revision: 2, revisionOfId: proposalId, status: 'approved', approvedEntityKey: entityKey, votes: '15.00', createdBy: creatorId }),
    ]);
    const log = await ledger(award);
    expect(log.map((row) => row.action)).toEqual(['create', 'validate', 'approve', 'supersede_approved', 'revise_approved']);
    expect(log[3]).toMatchObject({ proposalId, fromStatus: 'approved', toStatus: 'superseded', adminUserId: creatorId, note: NOTE });
    expect(log[4]).toMatchObject({ proposalId: result.revision.id, fromStatus: null, toStatus: 'approved', adminUserId: creatorId, note: NOTE });
    expect(log[4].newValues).toMatchObject({ selfApproval: true, mode: 'correct', approved_entity_key: entityKey, previous_entity_key: entityKey, revision: 2 });
    // Exactly one live revision remains.
    expect(rows.filter((row) => ['proposed', 'validated', 'validation_failed', 'approved'].includes(row.status))).toHaveLength(1);
  });

  it('a club change is a correction too, resolved against the season club identity', async () => {
    const award = await makeAward();
    const { proposalId, entityKey } = await approvedProposal(award, { clubSlug: clubs[0].slug });
    const result = await reviseAs(creator, proposalId, { clubSlug: clubs[1].slug });
    expect(result.revised.mode).toBe('correct');
    expect(await winners(award)).toEqual([expect.objectContaining({ key: entityKey, clubId: clubs[1].id })]);
    expect(result.revised.revalidatePaths).toEqual(expect.arrayContaining(['/awards']));
  });
});

describe('reviseApprovedProposal: the REPLACE path (the player changes)', () => {
  it('voids the old row and creates the new one in one transaction; the revision records the NEW key', async () => {
    const award = await makeAward();
    const { proposalId, entityKey } = await approvedProposal(award);
    const result = await reviseAs(creator, proposalId, { playerIdentity: players[1].identity, playerNameRaw: 'Synthetic B2 Player 2' });

    expect(result.revised.mode).toBe('replace');
    expect(result.revised.entityKey).not.toBe(entityKey);
    expect(result.revised.voidedEntityKey).toBe(entityKey);
    const rows = await winners(award);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: entityKey, status: 'void', playerId: players[0].id });
    expect(rows[0].statusReason).toContain(NOTE);
    expect(rows[1]).toMatchObject({ key: result.revised.entityKey, status: 'active', playerId: players[1].id, votes: '10.00' });

    // The void's durable record names its replacement; the new row has its own record.
    expect((await overrideOf(entityKey)).find((o) => o.fieldGroup === 'lifecycle')?.values).toMatchObject({ status: 'void', replaced_by_key: result.revised.entityKey });
    expect((await overrideOf(result.revised.entityKey))[0]).toMatchObject({ fieldGroup: 'record', values: { replaces_key: entityKey } });
    const edits = await dataEdits(award);
    expect(edits.map((edit) => edit.fieldGroup)).toEqual(['award_winner_created', 'award_winner_created', 'award_winner_voided']);
    expect(edits[1].newValues).toMatchObject({ curated_proposal_id: proposalId, curated_proposal_revision: 2, replaces: entityKey });
    expect(edits[2].newValues).toMatchObject({ replaced_by_key: result.revised.entityKey, status: 'void' });

    expect((await proposalRows(award)).map((row) => [row.revision, row.status, row.approvedEntityKey])).toEqual([
      [1, 'superseded', entityKey], [2, 'approved', result.revised.entityKey]]);
    expect((await ledger(award)).map((row) => row.action)).toEqual(['create', 'validate', 'approve', 'supersede_approved', 'revise_approved']);

    // The new revision is the live one: it can be revised again and locates the NEW row by its key.
    const again = await reviseAs(creator, result.revision.id, { votes: '20' });
    expect(again.revised).toMatchObject({ mode: 'correct', entityKey: result.revised.entityKey });
    expect((await winners(award)).filter((row) => row.status === 'active')).toEqual([expect.objectContaining({ key: result.revised.entityKey, votes: '20.00' })]);
  });

  it('moving the winner to another season is a replacement too, and the span follows the active rows', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award);
    const result = await reviseAs(creator, proposalId, { season: SEALED_SEASON }, NOTE, OPEN);
    expect(result.revised.mode).toBe('replace');
    expect(result.revised.revalidatePaths).toEqual(expect.arrayContaining([
      awardSeasonPath(award.slug, OPEN_SEASON), awardSeasonPath(award.slug, SEALED_SEASON), seasonPath(OPEN_SEASON), seasonPath(SEALED_SEASON)]));
    const [span] = await owner<{ first: number; last: number }[]>`SELECT first_season::int AS first, last_season::int AS last FROM awards WHERE id = ${award.awardId}`;
    expect(span).toEqual({ first: SEALED_SEASON, last: SEALED_SEASON });
  });
});

describe('reviseApprovedProposal: atomicity and refusals', () => {
  it('a forced canonical failure after the real correction leaves no ledger row, the proposal approved and award_winners unchanged', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award);
    const before = await snapshot(award);

    await expect(reviseAs(creator, proposalId, { votes: '99' }, NOTE, OPEN, failingAfterCanonicalWrite))
      .rejects.toThrow('FORCED failure after the canonical write');
    await expectNothingChanged(award, before);
    expect((await proposalRows(award))[0].status).toBe('approved');
  });

  it('a forced canonical failure after the real replacement (void + insert) is rolled back as one', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award);
    const before = await snapshot(award);

    await expect(reviseAs(creator, proposalId, { playerIdentity: players[1].identity, playerNameRaw: 'Synthetic B2 Player 2' }, NOTE, OPEN, failingAfterCanonicalWrite))
      .rejects.toThrow('FORCED failure after the canonical write');
    await expectNothingChanged(award, before);
    expect(await winners(award)).toHaveLength(1);
    expect((await winners(award))[0].status).toBe('active');
  });

  it('a void canonical winner is refused approved_winner_not_active: nothing is written', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award);
    await owner`UPDATE award_winners SET status = 'void', status_reason = 'SYNTHETIC out-of-band void', updated_at = now() WHERE award_id = ${award.awardId}`;
    const before = await snapshot(award);

    await expect(reviseAs(creator, proposalId, { votes: '99' })).rejects.toMatchObject({ code: 'approved_winner_not_active' });
    await expectNothingChanged(award, before);
  });

  it('a missing canonical winner is refused approved_winner_not_active too', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award);
    await owner`DELETE FROM award_winners WHERE award_id = ${award.awardId}`;
    await expect(reviseAs(creator, proposalId, { votes: '99' })).rejects.toMatchObject({ code: 'approved_winner_not_active' });
    expect((await proposalRows(award))[0].status).toBe('approved');
  });

  it('the decision note is required (20..2000) and a no-op or evidence-only change is refused', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award);
    const before = await snapshot(award);

    await expect(reviseAs(creator, proposalId, { votes: '99' }, null)).rejects.toMatchObject({ code: 'note_required' });
    await expect(reviseAs(creator, proposalId, { votes: '99' }, 'x'.repeat(19))).rejects.toMatchObject({ code: 'note_required' });
    await expect(reviseAs(creator, proposalId, { votes: '10' })).rejects.toMatchObject({ code: 'no_change' });
    await expect(reviseAs(creator, proposalId, { citation: 'A different SYNTHETIC citation' })).rejects.toMatchObject({ code: 'no_change' });
    await expect(reviseAs(creator, proposalId, { votes: '-3' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expectNothingChanged(award, before);
  });

  it('SEALED SEASON: the revision needs the 20..2000 note; a short note writes nothing, a valid one is an audited correction', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award, { season: SEALED_SEASON });
    const before = await snapshot(award);

    for (const note of [null, 'too short']) {
      await expect(reviseAs(creator, proposalId, { votes: '99' }, note, SEALED)).rejects.toMatchObject({ code: 'season_sealed_correction_invalid' });
    }
    await expectNothingChanged(award, before);

    const result = await reviseAs(creator, proposalId, { votes: '99' }, NOTE, SEALED);
    expect(result.revision.status).toBe('approved');
    expect((await winners(award))[0].votes).toBe('99.00');
    expect((await ledger(award)).at(-1)).toMatchObject({ action: 'revise_approved', note: NOTE });
  });

  it('moving a winner INTO a sealed season from an open one is checked against the seal as well', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award, { season: OPEN_SEASON });
    const before = await snapshot(award);
    await expect(reviseAs(creator, proposalId, { season: SEALED_SEASON }, 'too short', SEALED)).rejects.toMatchObject({ code: 'season_sealed_correction_invalid' });
    await expectNothingChanged(award, before);
  });

  it('a different active winner for the same player is still a duplicate; confirming the repeat lets the revision through', async () => {
    const award = await makeAward();
    const { proposalId } = await approvedProposal(award);
    // A second, independent approved winner for the same player, award and season (a confirmed repeat).
    await withAwardProposalExecutor(async (executor) => {
      const created = await createProposal(creator, executor, proposalInput(award, { duplicateConfirmed: true }), OPTIONS);
      await validateProposal(creator, executor, { proposalId: created.id }, OPTIONS);
      await approveProposal(approver, executor, { proposalId: created.id, decisionNote: NOTE }, { promotion: awardWinnerPromotionPort, sealed: OPEN }, OPTIONS);
    });
    const error = await reviseAs(creator, proposalId, { votes: '12' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_input' });
    const done = await reviseAs(creator, proposalId, { votes: '12', duplicateConfirmed: true });
    expect(done.revision.status).toBe('approved');
  });
});

/* ------------------------------------------------------------------ *
 * V2-GAP-020: the identity-less refusal is a safety property and holds on the APPROVAL path
 * ------------------------------------------------------------------ */

describe('an identity-less proposal cannot be approved (V2-GAP-020)', () => {
  it('validation refuses it (player_unresolved) and the proposal is then not approvable', async () => {
    const award = await makeAward();
    const proposalId = await withAwardProposalExecutor(async (executor) => {
      const created = await createProposal(creator, executor, proposalInput(award, { playerIdentity: null }), OPTIONS);
      const validated = await validateProposal(creator, executor, { proposalId: created.id }, OPTIONS);
      expect(validated.status).toBe('validation_failed');
      expect(validated.validationResult?.issues.map((issue) => issue.code)).toContain('player_unresolved');
      return created.id;
    });
    await expect(approveAs(approver, proposalId, { decisionNote: NOTE })).rejects.toMatchObject({ code: 'illegal_transition' });
    expect(await winners(award)).toEqual([]);
  });

  it('even a row forced to "validated" is stopped by the approval\'s own re-validation: stale_validation, nothing written', async () => {
    const award = await makeAward();
    const proposalId = await withAwardProposalExecutor(async (executor) => (
      await createProposal(creator, executor, proposalInput(award, { playerIdentity: null }), OPTIONS)).id);
    // A tampered or legacy row that claims to be validated: the re-validation inside approval is what holds the line.
    await owner`
      UPDATE award_proposals SET status = 'validated', validated_at = now(),
             validation_result = ${owner.json({ ok: true, issues: [], checkedAt: '2026-10-19T12:00:00.000Z' })}
       WHERE id = ${proposalId}`;
    const before = await snapshot(award);

    const error = await approveAs(approver, proposalId, { decisionNote: NOTE }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'stale_validation' });
    expect((error as { issues: { code: string }[] }).issues.map((issue) => issue.code)).toEqual(['player_unresolved']);

    await expectNothingChanged(award, before);
    expect(await winners(award)).toEqual([]);
    expect(await auditCounts(award)).toEqual({ edits: 0, overrides: 0 });
    expect((await ledger(award)).some((row) => row.action === 'approve')).toBe(false);
    expect((await proposalRows(award))[0]).toMatchObject({ status: 'validated', approvedEntityKey: null });
  });
});
