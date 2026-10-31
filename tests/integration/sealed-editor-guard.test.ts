/**
 * V2-GAP-006, owner decision D-V2-GAP006-EDITORS (Option E1): the season seal for the audited admin
 * editors, proved against PostgreSQL with the REAL season registry (data/reference/seasons.json:
 * 1897-2026 sealed, 2027 in progress).
 *
 * WHAT THIS PROVES (the unit half is in tests/v2-season-seal.test.ts):
 *   - a sealed-season mutation through the real editor modules (create match, data-editor save,
 *     delete match) is REFUSED without a 20-2000 character note, and a refusal leaves canonical
 *     data and audit rows exactly as they were (the whole transaction rolls back);
 *   - a valid note is accepted, and the audit row binds the actor, the trimmed note and the
 *     table/row/field group of the edit;
 *   - an open season (2026 declared open for this suite) needs no note for the same edits;
 *   - the guard run DIRECTLY on a transaction (`recordDataEdit`) rolls back an earlier canonical
 *     write when it refuses, accepts a valid correction and returns a receipt whose evidence
 *     reference names the real `data_edits` row, derives the workflow from the table, guards both the
 *     old and the new season of a move, fails closed on an unknown season, and refuses when the
 *     registry cannot be read;
 *   - other editor families refuse a sealed-season change without a note (see the per-family
 *     suites: admin-awards, admin-special-records, admin-draft, ... which declare their fixture
 *     season open through ./sealed-registry-fixture and so keep exercising their own behaviour).
 *
 * FIXTURES: matches in season 1990 (sealed) and 2026 (declared open for this suite, see OPEN) between
 * two real club identities of the test database, round numbers from a private 9000+ counter, every row
 * tagged with MARKER in `notes`. They are removed through the real deleteMatch path (so the
 * recompute side effects are reverted the way an operator's undo reverts them), then the audit rows
 * by marker. Nothing real is edited.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAwardWinnerAction } from '@/app/admin/awards/actions';
import { setCoachAssignmentAction } from '@/app/admin/coaches/actions';
import { createManualPickAction } from '@/app/admin/draft/actions';
import { createAwardWinner } from '@/db/queries/admin-awards';
import { setCoachAssignment } from '@/db/queries/admin-coaches';
import { createManualPick } from '@/db/queries/admin-draft';
import { recordDataEdit } from '@/db/queries/audit-log';
import { saveEdit } from '@/db/queries/data-edits';
import { createMatch, deleteMatch, type CreateMatchInput } from '@/db/queries/match-admin';
import { SealedEditorRefusal } from '@/lib/seasons/sealed-editor-guard';
import { SeasonRegistryError, loadSealedSeasons } from '@/lib/seasons/sealed-seasons';

import { setFixtureSeasonsOpen } from './sealed-registry-fixture';

// The real registry, except that the OPEN fixture season is declared open (see below); one test
// makes the registry unreadable.
vi.mock('@/lib/seasons/sealed-seasons', async (importOriginal) => {
  const actual = (await import('./sealed-registry-fixture')).withFixtureSeasonOpen(
    await importOriginal<typeof import('@/lib/seasons/sealed-seasons')>(),
  );
  return { ...actual, loadSealedSeasons: vi.fn(actual.loadSealedSeasons) };
});

// The server actions are driven through their real FormData boundary (V2-GAP-006 note-length
// regression). Only the session (who the administrator is) and the cache/header seams are stubbed;
// the actions, their parsers and the query layer under them are the real ones.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, delete: () => undefined }),
}));
const fixtureAdmin = vi.hoisted(() => ({ id: 0, email: 'gap006-actions@example.invalid' }));
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  requireCapability: vi.fn(async () => ({ id: fixtureAdmin.id, email: fixtureAdmin.email })),
  audit: vi.fn(async () => undefined),
}));

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? testDbUrl;

const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });
const importSql = postgres(process.env.AFLDB_IMPORT_DATABASE_URL, { max: 1, onnotice: () => {} });

const MARKER = 'V2-GAP-006-E1';
const SEALED = 1990;
// The test database holds clubs only up to 2026, which the real registry has sealed; so the OPEN half
// of the suite declares 2026 open through the registry seam. 1990 stays sealed by the real registry.
const OPEN = 2026;
const GOOD_NOTE = `${MARKER}: corrected against the printed scoreboard.`;

let counter = 0;
const nextRound = () => 9500 + (counter += 1);

let actorId = 0;
let createdThrowawayAdmin = false;
let clubA = 0;
let clubB = 0;
let sealedClubA = 0;
let sealedClubB = 0;
const committedMatchIds: number[] = [];

function input(season: number, overrides: Partial<CreateMatchInput> = {}): CreateMatchInput {
  const roundNumber = overrides.roundNumber ?? nextRound();
  const homeClubId = season === SEALED ? sealedClubA : clubA;
  const awayClubId = season === SEALED ? sealedClubB : clubB;
  return {
    season,
    roundType: 'home_and_away',
    roundNumber,
    roundCode: String(roundNumber),
    matchDate: `${season}-01-01`,
    homeClubId,
    awayClubId,
    homeScore: 100,
    awayScore: 80,
    attendance: null,
    adminUserId: actorId,
    ...overrides,
  };
}

const auditTotal = async () => (await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM data_edits`)[0].n;
const matchRowsAt = async (season: number, roundNumber: number) => (await owner<{ n: number }[]>`
  SELECT count(*)::int AS n FROM matches WHERE season = ${season} AND round_number = ${roundNumber}`)[0].n;
const matchNotes = async (id: number) => (await owner<{ notes: string | null }[]>`
  SELECT notes FROM matches WHERE id = ${id}`)[0]?.notes ?? null;
const auditFor = async (rowId: number) => owner<{
  id: string; tableName: string; fieldGroup: string; adminUserId: number; note: string | null;
}[]>`
  SELECT id::text AS id, table_name AS "tableName", field_group AS "fieldGroup",
         admin_user_id AS "adminUserId", note
    FROM data_edits WHERE table_name = 'matches' AND row_id = ${rowId} ORDER BY id`;

/** Synthetic fixture matches only: round numbers from the private 9500+ counter in the two fixture seasons. */
async function cleanupLeftovers(): Promise<void> {
  const ids = (await owner<{ id: number }[]>`
    SELECT id::int AS id FROM matches WHERE season IN (${SEALED}, ${OPEN}) AND round_number >= 9500`).map((r) => r.id);
  if (ids.length === 0) return;
  await owner`DELETE FROM match_period_scores WHERE match_id IN ${owner(ids)}`;
  await owner`DELETE FROM matches WHERE id IN ${owner(ids)}`;
  await owner`DELETE FROM data_edits WHERE table_name = 'matches' AND row_id IN ${owner(ids)}`;
}

async function eligibleClubs(season: number): Promise<[number, number]> {
  const rows = await owner<{ id: number }[]>`
    SELECT id::int AS id FROM clubs
     WHERE afldb_identity_for_season(organization_id, ${season}::smallint) = id
     ORDER BY id LIMIT 2`;
  expect(rows.length, `two eligible club identities for ${season}`).toBe(2);
  return [rows[0].id, rows[1].id];
}

type FixtureResult = { ok: true; id: number; season: number } | { ok: false; error: string; refusal: SealedEditorRefusal | null };

/** createMatch throws on any refusal (its action catches); this turns that into a result. */
async function createFixtureMatch(season: number, note: string | undefined, round = nextRound()) {
  let created: FixtureResult;
  try {
    const row = await createMatch(input(season, { roundNumber: round, notes: `${MARKER} fixture (public text, 20+ chars, never the correction note)`, note }));
    committedMatchIds.push(row.id);
    created = { ok: true, ...row };
  } catch (error) {
    created = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      refusal: error instanceof SealedEditorRefusal ? error : null,
    };
  }
  return { created, round };
}

beforeAll(async () => {
  const [admin] = await owner<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (admin) {
    actorId = admin.id;
  } else {
    const [row] = await owner<{ id: number }[]>`
      INSERT INTO auth_users (email, password_hash, role) VALUES (${`${MARKER.toLowerCase()}@example.invalid`}, 'x', 'super_admin')
      RETURNING id`;
    actorId = row.id;
    createdThrowawayAdmin = true;
  }
  fixtureAdmin.id = actorId;
  setFixtureSeasonsOpen([OPEN]);
  await cleanupLeftovers(); // a crashed earlier run must not collide with this one's round numbers
  [sealedClubA, sealedClubB] = await eligibleClubs(SEALED);
  [clubA, clubB] = await eligibleClubs(OPEN);
}, 60_000);

afterAll(async () => {
  for (const id of committedMatchIds) {
    // Through the real path, so season metadata / club_seasons recomputes are reverted too. The
    // fixture seasons are not the registry's open season, so deleting needs a valid note.
    await deleteMatch({ matchId: id, adminUserId: actorId, reason: `${MARKER}: fixture teardown` }).catch(() => undefined);
  }
  await owner`DELETE FROM matches WHERE notes LIKE ${`${MARKER}%`}`.catch(() => undefined);
  await owner`DELETE FROM data_edits WHERE note LIKE ${`${MARKER}%`}`.catch(() => undefined);
  if (createdThrowawayAdmin) await owner`DELETE FROM auth_users WHERE id = ${actorId}`.catch(() => undefined);
  await importSql.end({ timeout: 5 });
  await owner.end({ timeout: 5 });
}, 60_000);

describe('create match: the sealed season needs a note, the open season does not', () => {
  it('refuses a missing, blank, short and excessive note, and leaves no match and no audit row', async () => {
    const auditBefore = await auditTotal();
    for (const note of [undefined, '   ', 'too short', 'x'.repeat(2001)]) {
      const round = nextRound();
      const { created } = await createFixtureMatch(SEALED, note, round);
      expect(created.ok, JSON.stringify(created)).toBe(false);
      if (!created.ok) {
        expect(created.refusal).toBeInstanceOf(SealedEditorRefusal);
        expect(created.error).toContain(`season ${SEALED} is sealed historical data`);
        expect(created.error).toContain('20-2000 characters');
        expect(created.error).toContain('Nothing was changed');
      }
      expect(await matchRowsAt(SEALED, round)).toBe(0);
    }
    expect(await auditTotal()).toBe(auditBefore);
  });

  it('accepts a valid correction note and binds actor, trimmed note and the edit to the audit row', async () => {
    const { created, round } = await createFixtureMatch(SEALED, `  ${GOOD_NOTE}  `);
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    expect(await matchRowsAt(SEALED, round)).toBe(1);
    const audit = await auditFor(created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tableName: 'matches', fieldGroup: 'match_creation', adminUserId: actorId, note: GOOD_NOTE,
    });
  });

  it('leaves the open season unchanged: no note, a short note, and the unchanged audit note', async () => {
    const auditBefore = await auditTotal();
    const { created } = await createFixtureMatch(OPEN, undefined);
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    const audit = await auditFor(created.id);
    expect(audit).toHaveLength(1);
    // Unchanged: with no correction note the match's own public text is still the stored audit note.
    expect(audit[0].note).toBe(`${MARKER} fixture (public text, 20+ chars, never the correction note)`);
    const { created: shortNote } = await createFixtureMatch(OPEN, 'short');
    expect(shortNote.ok, JSON.stringify(shortNote)).toBe(true);
    expect(await auditTotal()).toBe(auditBefore + 2);
  });
});

describe('data editor save on a sealed match', () => {
  let sealedId = 0;
  let openId = 0;

  beforeAll(async () => {
    const sealed = await createFixtureMatch(SEALED, GOOD_NOTE);
    if (!sealed.created.ok) throw new Error(`fixture: ${JSON.stringify(sealed.created)}`);
    sealedId = sealed.created.id;
    const open = await createFixtureMatch(OPEN, undefined);
    if (!open.created.ok) throw new Error(`fixture: ${JSON.stringify(open.created)}`);
    openId = open.created.id;
  }, 60_000);

  const save = (rowId: number, notes: string, note: string | null | undefined) => saveEdit({
    entityKey: 'matches', rowId, groupKey: 'notes', raw: { notes }, adminUserId: actorId, note,
  });

  it('refuses missing, short and excessive notes and leaves the canonical row and the audit untouched', async () => {
    const before = await matchNotes(sealedId);
    const auditBefore = await auditTotal();
    for (const note of [undefined, null, '', '  ', 'nineteen chars here', 'x'.repeat(2001)]) {
      const result = await save(sealedId, `${MARKER} edited ${String(note).length}`, note);
      expect(result.ok, JSON.stringify(result)).toBe(false);
      if (!result.ok) expect(result.error).toContain('sealed historical data');
    }
    expect(await matchNotes(sealedId)).toBe(before);
    expect(await auditTotal()).toBe(auditBefore);
  });

  it('accepts the 20 and 2000 character boundaries and records the trimmed note', async () => {
    const twenty = 'x'.repeat(20);
    expect((await save(sealedId, `${MARKER} boundary 20`, twenty)).ok).toBe(true);
    expect((await save(sealedId, `${MARKER} boundary 2000`, ` ${'y'.repeat(2000)} `)).ok).toBe(true);
    const audit = await auditFor(sealedId);
    const edits = audit.filter((row) => row.fieldGroup === 'notes');
    expect(edits.map((row) => row.note)).toEqual([twenty, 'y'.repeat(2000)]);
    expect(edits.every((row) => row.adminUserId === actorId && row.tableName === 'matches')).toBe(true);
    expect(await matchNotes(sealedId)).toBe(`${MARKER} boundary 2000`);
  });

  it('leaves an open-season save unchanged: no note required', async () => {
    const result = await save(openId, `${MARKER} open edit`, undefined);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await matchNotes(openId)).toBe(`${MARKER} open edit`);
  });
});

describe('delete match on a sealed season', () => {
  it('refuses without a reason, leaving the match and the audit; deletes with a reason and audits it', async () => {
    const { created, round } = await createFixtureMatch(SEALED, GOOD_NOTE);
    if (!created.ok) throw new Error(JSON.stringify(created));
    const auditBefore = await auditTotal();

    const refused = await deleteMatch({ matchId: created.id, adminUserId: actorId });
    expect(refused.ok, JSON.stringify(refused)).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('sealed historical data');
    expect(await deleteMatch({ matchId: created.id, adminUserId: actorId, reason: 'short' })).toMatchObject({ ok: false });
    expect(await matchRowsAt(SEALED, round)).toBe(1);
    expect(await auditTotal()).toBe(auditBefore);

    const deleted = await deleteMatch({ matchId: created.id, adminUserId: actorId, reason: `${MARKER}: wrong season, entered twice` });
    expect(deleted.ok, JSON.stringify(deleted)).toBe(true);
    expect(await matchRowsAt(SEALED, round)).toBe(0);
    const audit = await auditFor(created.id);
    expect(audit.at(-1)).toMatchObject({
      fieldGroup: 'match_deletion', adminUserId: actorId, note: `${MARKER}: wrong season, entered twice`,
    });
    committedMatchIds.splice(committedMatchIds.indexOf(created.id), 1);
  });
});

describe('the guard run directly on a transaction', () => {
  let matchId = 0;

  beforeAll(async () => {
    const { created } = await createFixtureMatch(SEALED, GOOD_NOTE);
    if (!created.ok) throw new Error(JSON.stringify(created));
    matchId = created.id;
  }, 60_000);

  /** A canonical write, then the audit call, in one import-role transaction. */
  const edit = (
    note: string | null,
    seal: Parameters<typeof recordDataEdit>[1]['seal'],
    overrides: Partial<Parameters<typeof recordDataEdit>[1]> = {},
  ) => importSql.begin(async (tx) => {
    await tx`UPDATE matches SET notes = ${`${MARKER} direct ${Date.now()}`} WHERE id = ${matchId}`;
    return recordDataEdit(tx, {
      tableName: 'matches', rowId: matchId, fieldGroup: 'notes', oldValues: {}, newValues: {},
      adminUserId: actorId, note, seal, ...overrides,
    });
  });

  it('rolls the earlier canonical write and the audit row back when it refuses', async () => {
    const before = await matchNotes(matchId);
    const auditBefore = await auditTotal();
    const failure = await edit(null, { kind: 'row' }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(SealedEditorRefusal);
    expect(failure).toMatchObject({ code: 'correction_invalid', seasons: [SEALED] });
    expect(await matchNotes(matchId)).toBe(before);
    expect(await auditTotal()).toBe(auditBefore);
  });

  it('returns a receipt whose evidence reference is the real data_edits row, with the workflow derived', async () => {
    const receipt = await edit(`  ${GOOD_NOTE}  `, { kind: 'row' });
    expect(receipt.seal).toMatchObject({
      basis: 'audited_correction', workflow: 'data_editor', actorUserId: actorId, note: GOOD_NOTE,
      seasons: [SEALED], sealedSeasons: [SEALED], evidenceRef: `data_edits:${receipt.id}`,
    });
    const [row] = await owner<{ note: string; adminUserId: number; tableName: string }[]>`
      SELECT note, admin_user_id AS "adminUserId", table_name AS "tableName" FROM data_edits WHERE id = ${receipt.id}::bigint`;
    expect(row).toEqual({ note: GOOD_NOTE, adminUserId: actorId, tableName: 'matches' });
  });

  it('guards both the old and the new season when an edit moves a record', async () => {
    // The row is in the open season now, but was in the sealed season: the OLD season needs the note.
    const open = await createFixtureMatch(OPEN, undefined);
    if (!open.created.ok) throw new Error(JSON.stringify(open.created));
    const movedFrom = (note: string | null) => importSql.begin((tx) => recordDataEdit(tx, {
      tableName: 'matches', rowId: open.created.ok ? open.created.id : 0, fieldGroup: 'notes', oldValues: {}, newValues: {},
      adminUserId: actorId, note, seal: { kind: 'row', previousSeasons: [SEALED] },
    }));
    await expect(movedFrom(null)).rejects.toMatchObject({ seasons: [SEALED] });
    await expect(movedFrom(GOOD_NOTE)).resolves.toMatchObject({ seal: { basis: 'audited_correction', seasons: [SEALED, OPEN] } });
  });

  it('fails closed on an unknown season and on a row that does not exist', async () => {
    const auditBefore = await auditTotal();
    await expect(edit(null, { kind: 'seasons', seasons: [null] })).rejects.toBeInstanceOf(SealedEditorRefusal);
    await expect(importSql.begin((tx) => recordDataEdit(tx, {
      tableName: 'matches', rowId: 2_147_000_001, fieldGroup: 'notes', oldValues: {}, newValues: {},
      adminUserId: actorId, note: null, seal: { kind: 'row' },
    }))).rejects.toMatchObject({ code: 'correction_invalid', seasons: [null] });
    expect(await auditTotal()).toBe(auditBefore);
  });

  it('derives brownlow_authority for the Brownlow audit tables, and reads the season from the authority row id', async () => {
    const auditBefore = await auditTotal();
    const outcome = await importSql.begin(async (tx) => {
      const receipt = await recordDataEdit(tx, {
        tableName: 'brownlow_season_authority', rowId: SEALED, fieldGroup: 'publish', oldValues: {}, newValues: {},
        adminUserId: actorId, note: GOOD_NOTE, seal: { kind: 'row' },
      });
      throw Object.assign(new Error('rollback'), { receipt });
    }).then(() => null, (error: { receipt?: Awaited<ReturnType<typeof recordDataEdit>> }) => error.receipt ?? null);
    expect(outcome?.seal).toMatchObject({ basis: 'audited_correction', workflow: 'brownlow_authority', seasons: [SEALED] });
    await expect(importSql.begin((tx) => recordDataEdit(tx, {
      tableName: 'brownlow_season_authority', rowId: SEALED, fieldGroup: 'publish', oldValues: {}, newValues: {},
      adminUserId: actorId, note: null, seal: { kind: 'row' },
    }))).rejects.toMatchObject({ code: 'correction_invalid' });
    expect(await auditTotal()).toBe(auditBefore);
  });

  it('refuses every season-scoped write, open or sealed, when the season registry cannot be read', async () => {
    const mocked = vi.mocked(loadSealedSeasons);
    mocked.mockImplementation(() => { throw new SeasonRegistryError('seasons.json is unreadable'); });
    const before = await matchNotes(matchId);
    const auditBefore = await auditTotal();
    try {
      await expect(edit(GOOD_NOTE, { kind: 'seasons', seasons: [OPEN] })).rejects.toMatchObject({ code: 'season_registry_unavailable' });
      await expect(edit(GOOD_NOTE, { kind: 'row' })).rejects.toMatchObject({ code: 'season_registry_unavailable' });
      expect(await matchNotes(matchId)).toBe(before);
      expect(await auditTotal()).toBe(auditBefore);
      // A reference-table audit has no season and does not consult the registry.
      await importSql.begin(async (tx) => {
        await recordDataEdit(tx, {
          tableName: 'coaches', rowId: 1, fieldGroup: 'identity', oldValues: {}, newValues: {},
          adminUserId: actorId, note: `${MARKER} reference`, seal: { kind: 'reference' },
        });
        throw Object.assign(new Error('rollback'), { expected: true });
      }).catch((error: { expected?: boolean }) => expect(error.expected).toBe(true));
    } finally {
      // Restore the FIXTURE-wrapped loader (the real registry plus the OPEN fixture season), not the raw
      // real one, so every later test in this file still sees the fixture season open.
      const actual = (await import('./sealed-registry-fixture')).withFixtureSeasonOpen(
        await vi.importActual<typeof import('@/lib/seasons/sealed-seasons')>('@/lib/seasons/sealed-seasons'),
      );
      mocked.mockReset();
      mocked.mockImplementation(actual.loadSealedSeasons);
    }
  });
});

describe('other editor families refuse a sealed-season change without a note and change nothing', () => {
  const counts = async () => (await owner<{ audits: number; matchCoaches: number; winners: number; picks: number }[]>`
    SELECT (SELECT count(*)::int FROM data_edits) AS audits,
           (SELECT count(*)::int FROM match_coaches) AS "matchCoaches",
           (SELECT count(*)::int FROM award_winners) AS winners,
           (SELECT count(*)::int FROM draft_picks) AS picks`)[0];

  it('coach assignment (match_coaches / matches)', async () => {
    const [target] = await owner<{ matchId: number; clubId: number; coachId: number }[]>`
      SELECT m.id::int AS "matchId", m.home_club_id::int AS "clubId", (SELECT id::int FROM coaches ORDER BY id LIMIT 1) AS "coachId"
        FROM matches m WHERE m.season = ${SEALED} ORDER BY m.id LIMIT 1`;
    const before = await counts();
    for (const note of [undefined, 'too short', 'x'.repeat(2001)]) {
      const result = await setCoachAssignment({
        assignments: [{ matchId: target.matchId, clubId: target.clubId }], coachId: target.coachId, adminUserId: actorId, note,
      });
      expect(result.ok, JSON.stringify(result)).toBe(false);
      if (!result.ok) expect(result.error).toContain('sealed historical data');
    }
    expect(await counts()).toEqual(before);
  });

  it('award winner (award_winners)', async () => {
    const [award] = await owner<{ id: number }[]>`SELECT id::int AS id FROM awards ORDER BY id LIMIT 1`;
    const before = await counts();
    for (const note of [undefined, 'too short', 'x'.repeat(2001)]) {
      const result = await createAwardWinner({
        awardId: award.id, season: SEALED, playerNameRaw: `${MARKER} synthetic`, adminUserId: actorId, note,
      });
      expect(result.ok, JSON.stringify(result)).toBe(false);
      if (!result.ok) expect(result.error).toContain('sealed historical data');
    }
    expect(await counts()).toEqual(before);
  });

  it('draft selection (draft_picks)', async () => {
    const [player] = await owner<{ id: number }[]>`SELECT id::int AS id FROM players ORDER BY id LIMIT 1`;
    const club = await owner<{ slug: string }[]>`SELECT slug FROM clubs WHERE id = ${sealedClubA}`;
    const before = await counts();
    for (const note of [undefined, 'too short', 'x'.repeat(2001)]) {
      const result = await createManualPick({
        playerId: player.id, draftYear: SEALED, draftType: 'National', draftKind: 'national', pickNumber: 199,
        clubSlug: club[0].slug, playerNameRaw: `${MARKER} synthetic`, adminUserId: actorId, note, confirmed: true,
      });
      expect(result.ok, JSON.stringify(result)).toBe(false);
      if (!result.ok) expect(result.error).toContain('sealed historical data');
    }
    expect(await counts()).toEqual(before);
  });
});

describe('through the server actions: a crafted over-length note is refused, never truncated into a valid correction', () => {
  // 2001 characters: the textarea's maxLength is only a browser hint, so a crafted POST can send this.
  const CRAFTED = `${MARKER}: crafted ${'x'.repeat(2001)}`.slice(0, 2001);
  const AT_LIMIT = CRAFTED.slice(0, 2000);

  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const snapshot = async () => (await owner<Record<string, number>[]>`
    SELECT (SELECT count(*)::int FROM data_edits) AS audits,
           (SELECT count(*)::int FROM match_coaches) AS "matchCoaches",
           (SELECT count(*)::int FROM data_overrides) AS overrides,
           (SELECT count(*)::int FROM award_winners) AS winners,
           (SELECT count(*)::int FROM draft_picks) AS picks,
           (SELECT count(*)::int FROM matches) AS matches`)[0];
  const expectRefusedAsTooLong = (result: { error?: string; ok?: boolean }) => {
    expect(result.ok, JSON.stringify(result)).toBeUndefined();
    expect(result.error).toContain('sealed historical data');
    expect(result.error).toContain('longer than 2000 characters');
    expect(result.error).toContain('Nothing was changed');
  };

  it('has the crafted fixture note at exactly 2001 characters, one over the limit', () => {
    expect(CRAFTED).toHaveLength(2001);
    expect(AT_LIMIT).toHaveLength(2000);
    expect(CRAFTED).toBe(CRAFTED.trim());
  });

  it('coach assignment action on a sealed match: refused, canonical rows, overrides and audit unchanged', async () => {
    const [target] = await owner<{ matchId: number; clubId: number; coachId: number }[]>`
      SELECT m.id::int AS "matchId", m.home_club_id::int AS "clubId", (SELECT id::int FROM coaches ORDER BY id LIMIT 1) AS "coachId"
        FROM matches m WHERE m.season = ${SEALED} ORDER BY m.id LIMIT 1`;
    const before = await snapshot();
    const result = await setCoachAssignmentAction({}, form({
      coachId: String(target.coachId), assignments: `${target.matchId}:${target.clubId}`, note: CRAFTED,
    }));
    expectRefusedAsTooLong(result);
    expect(await snapshot()).toEqual(before);
  });

  it('award winner action on a sealed season: refused, nothing written', async () => {
    const [award] = await owner<{ id: number }[]>`SELECT id::int AS id FROM awards ORDER BY id LIMIT 1`;
    const before = await snapshot();
    const result = await createAwardWinnerAction({}, form({
      awardId: String(award.id), season: String(SEALED), playerNameRaw: `${MARKER} synthetic`, adminNote: CRAFTED,
    }));
    expectRefusedAsTooLong(result);
    expect(await snapshot()).toEqual(before);
  });

  it('draft selection action on a sealed year: refused, nothing written', async () => {
    const [player] = await owner<{ id: number }[]>`SELECT id::int AS id FROM players ORDER BY id LIMIT 1`;
    const club = await owner<{ slug: string }[]>`SELECT slug FROM clubs WHERE id = ${sealedClubA}`;
    const before = await snapshot();
    const result = await createManualPickAction({}, form({
      playerId: String(player.id), draftYear: String(SEALED), eventPair: 'National|national', pickNumber: '199',
      clubSlug: club[0].slug, playerNameRaw: `${MARKER} synthetic`, confirmed: '1', note: CRAFTED,
    }));
    expectRefusedAsTooLong(result);
    expect(await snapshot()).toEqual(before);
  });

  it('leaves an OPEN season unchanged: the same 2001-character note is accepted and stored cut to 2000', async () => {
    const { created } = await createFixtureMatch(OPEN, undefined);
    if (!created.ok) throw new Error(JSON.stringify(created));
    const [coach] = await owner<{ id: number }[]>`SELECT id::int AS id FROM coaches ORDER BY id LIMIT 1`;
    const [match] = await owner<{ matchKey: string; slug: string }[]>`
      SELECT m.match_key AS "matchKey", c.slug FROM matches m JOIN clubs c ON c.id = m.home_club_id WHERE m.id = ${created.id}`;
    try {
      const result = await setCoachAssignmentAction({}, form({
        coachId: String(coach.id), assignments: `${created.id}:${clubA}`, note: CRAFTED,
      }));
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      const rows = await owner<{ note: string | null }[]>`
        SELECT note FROM data_edits WHERE table_name = 'matches' AND row_id = ${created.id} AND field_group = 'coach_assignment'`;
      expect(rows).toHaveLength(1);
      expect(rows[0].note).toBe(AT_LIMIT); // unchanged open-season behaviour: stored, cut to 2000
    } finally {
      await owner`DELETE FROM data_overrides WHERE entity_type = 'match_coaches' AND entity_key LIKE ${`${match.matchKey}%`}`.catch(() => undefined);
    }
  });
});
