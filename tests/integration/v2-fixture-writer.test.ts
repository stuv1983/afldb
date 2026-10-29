/**
 * AFLDB-ISSUE-229 / V2-GAP-008 — the AFL API fixture writer on real PostgreSQL
 * (packages/acquisition/src/fixture-writer.ts; staging in fixture-lifecycle.ts).
 *
 * DATA. Every provider record starts from committed authentic bytes: the SCHEDULED Grand Final
 * slice (04-) and CONCLUDED records of the retained 2026 season feed. Records marked SYNTHETIC are
 * deep copies with the score blocks removed, a status replaced, a start time moved or a provider id
 * renamed (`CD_MV2FX…`, never a real id). No POSTPONED / CANCELLED / ABANDONED payload has ever been
 * observed; those cases prove the acknowledged-mapping mechanics only, never the provider's shape.
 *
 * ISOLATION. The provider team and venue ids are mapped, for this suite only, onto test-owned clubs
 * and a test-owned venue, so the suite needs no historical rows and cannot collide with them. The
 * writer runs on the restricted import role when one is configured. Teardown removes only rows this
 * suite created (marker-named clubs, venue, organisations and their fixtures and batches).
 */
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  parseAcknowledgedUnobservedStatuses,
  parseSourceFamilyRegistry,
  stageAflApiFixtureFeed,
  type AflApiFixtureContractContext,
  type AflApiFixtureStage,
} from '@afldb/acquisition';
import { postgresExecutor } from '@afldb/db';

import { parseAflApiIdentities, type AflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import { settleAflApiFixtureStage } from '@/lib/acquisition/afl-api-fixture-writer';

process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? process.env.AFLDB_TEST_DATABASE_URL;

const MARKER = 'v2-fx-it';
const SEASON = 2026;
const root = join(__dirname, '..', '..');
const readJson = (...parts: string[]): unknown => JSON.parse(readFileSync(join(root, ...parts), 'utf8'));

const owner = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
const importer = postgres(process.env.AFLDB_IMPORT_DATABASE_URL!, { max: 1, onnotice: () => {}, transform: { undefined: null } });
const db = postgresExecutor(importer);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw provider JSON under mutation
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const realIdentities = parseAflApiIdentities(readJson('data', 'reference', 'afl-api-identities.json'));
const registry = parseSourceFamilyRegistry(readJson('data', 'reference', 'source-families.json'));
const grandFinal = readJson('tests', 'fixtures', 'afl_api', 'match', '04-season-feed-scheduled.raw-slice.json') as Json;
const feed2026 = (readJson('tests', 'fixtures', 'afl_api', 'seasons', '00-season-matches-2026.raw.json') as { matches: Json[] }).matches;

/** SYNTHETIC: an authentic CONCLUDED record turned pre-match (scores removed) under a synthetic id. */
function preMatch(base: Json, id: string, mutate: (copy: Json) => void = () => {}): Json {
  const copy = clone(base);
  delete copy.home.score;
  delete copy.away.score;
  copy.status = 'SCHEDULED';
  copy.providerId = id;
  mutate(copy);
  return copy;
}

const round1 = feed2026.find((m) => m.round?.roundNumber === 1)!;
const round2 = feed2026.find((m) => m.round?.roundNumber === 2)!;
const R1 = 'CD_MV2FX0001';
const R2 = 'CD_MV2FX0002';
const GF = 'CD_MV2FX0029';
const records = (): Json[] => [
  preMatch(round1, R1),
  preMatch(round2, R2),
  { ...clone(grandFinal), providerId: GF },
];

const teamIds = [...new Set([round1, round2, grandFinal].flatMap((m) => [m.home.team.providerId, m.away.team.providerId]))] as string[];
const venueIds = [...new Set([round1, round2, grandFinal].map((m) => m.venue.providerId))] as string[];
const histOf = (teamId: string) => `${MARKER}-club-${teamIds.indexOf(teamId)}`;
const VENUE_LEGACY = `${MARKER}-venue`;

const identities: AflApiIdentities = {
  seasons: realIdentities.seasons,
  teams: new Map(teamIds.map((id) => [id, { ...realIdentities.teams.get(id)!, hist: histOf(id) }])),
  venues: new Map(venueIds.map((id) => [id, { ...realIdentities.venues.get(id)!, legacyName: VENUE_LEGACY }])),
};
const ctx: AflApiFixtureContractContext = { registry, identities };
const provenance = { tool: 'v2-fixture-writer.test.ts', snapshotLabel: `${MARKER}-snapshot`, manifestSha256: '0'.repeat(64) };

const stageOf = (feed: Json[], ack: string[] = []): AflApiFixtureStage =>
  stageAflApiFixtureFeed(feed, ctx, { season: SEASON, acknowledgedUnobservedStatuses: parseAcknowledgedUnobservedStatuses(ack) });
const settle = (stage: AflApiFixtureStage, mode: 'apply' | 'dry-run' = 'apply') => settleAflApiFixtureStage(db, { stage, mode, provenance });

type Row = {
  fixtureKey: string; sourceRecordId: string; sourceKey: string; roundCode: string; matchDate: string | null;
  matchTime: string | null; venueRaw: string | null; status: string; statusReason: string | null; batchId: string | null;
};
async function rows(): Promise<Row[]> {
  return owner<Row[]>`
    SELECT f.fixture_key AS "fixtureKey", f.source_record_id AS "sourceRecordId", s.key AS "sourceKey",
           f.round_code AS "roundCode", f.match_date::text AS "matchDate", f.match_time AS "matchTime",
           f.venue_raw AS "venueRaw", f.status, f.status_reason AS "statusReason", f.import_batch_id::text AS "batchId"
      FROM fixtures f JOIN sources s ON s.id = f.source_id
     WHERE f.home_club_id IN (SELECT id FROM clubs WHERE slug LIKE ${`${MARKER}-club-%`})
     ORDER BY f.source_record_id`;
}
const byId = async (id: string) => (await rows()).find((r) => r.sourceRecordId === id);
const batchCount = async () => (await owner<{ n: number }[]>`
  SELECT count(*)::int AS n FROM import_batches WHERE tool = ${provenance.tool}`)[0].n;

const clubIds: number[] = [];

async function purgeFixtures(): Promise<void> {
  await owner`DELETE FROM fixtures WHERE home_club_id IN (SELECT id FROM clubs WHERE slug LIKE ${`${MARKER}-club-%`})`;
  await owner`DELETE FROM import_batches WHERE tool = ${provenance.tool}`;
}

async function teardown(): Promise<void> {
  await purgeFixtures();
  await owner`DELETE FROM clubs WHERE slug LIKE ${`${MARKER}-club-%`}`;
  await owner`DELETE FROM club_organizations WHERE slug LIKE ${`${MARKER}-org-%`}`;
  await owner`DELETE FROM venues WHERE slug = ${VENUE_LEGACY}`;
}

beforeAll(async () => {
  await teardown();
  for (const teamId of teamIds) {
    const index = teamIds.indexOf(teamId);
    const [org] = await owner<{ id: number }[]>`
      INSERT INTO club_organizations (name, slug) VALUES (${`${MARKER} Organization ${index}`}, ${`${MARKER}-org-${index}`})
      RETURNING id::int AS id`;
    await owner.begin(async (tx) => {
      await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
      const [club] = await tx<{ id: number }[]>`
        INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
        VALUES (${histOf(teamId)}, ${`${MARKER} Club ${index}`}, ${`FX ${index}`}, ${`F${index}`}, -1, ${histOf(teamId)}, ${org.id})
        RETURNING id::int AS id`;
      await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
      clubIds.push(club.id);
    });
  }
  await owner`
    INSERT INTO venues (slug, canonical_name, legacy_name) VALUES (${VENUE_LEGACY}, ${`${MARKER} Venue`}, ${VENUE_LEGACY})`;
});

beforeEach(purgeFixtures);

afterAll(async () => {
  await teardown();
  await owner.end({ timeout: 5 });
  await importer.end({ timeout: 5 });
});

describe('promotion: create, replay, reschedule (AFLDB-ISSUE-229)', () => {
  it('creates provider-owned rows with explicit identity and provenance, and nothing else', async () => {
    const outcome = await settle(stageOf(records()));
    expect(outcome.status).toBe('applied');
    expect(outcome.actions.map((a) => [a.providerId, a.kind])).toEqual([[R1, 'created'], [R2, 'created'], [GF, 'created']]);
    const written = await rows();
    expect(written).toHaveLength(3);
    for (const row of written) {
      expect(row.sourceKey).toBe('afl_api');
      expect(row.fixtureKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.batchId).toBe(outcome.batchId);
      expect(row.venueRaw).toBe(`${MARKER} Venue`);
      expect(row.status).toBe('scheduled');
      expect(row.matchTime).toMatch(/^\d{2}:\d{2}$/);
    }
    expect((await byId(GF))).toMatchObject({ roundCode: 'GF', matchDate: '2026-09-26', matchTime: '14:30' });
    const [batch] = await owner<{ status: string; inserted: number; notes: string; target: string }[]>`
      SELECT status::text, records_inserted::int AS inserted, notes, target_table AS target FROM import_batches WHERE id = ${outcome.batchId!}`;
    expect(batch).toMatchObject({ status: 'completed', inserted: 3, target: 'fixtures' });
    expect(batch.notes).toContain(`snapshot=${provenance.snapshotLabel}`);
    // D-229-6 / D-229-7 / D-229-8a: no override, audit or spine pointer for an importer row.
    const keys = written.map((r) => r.fixtureKey);
    const [pointers] = await owner<{ n: number }[]>`
      SELECT ((SELECT count(*) FROM data_overrides WHERE entity_type = 'fixtures' AND entity_key = ANY(${keys.map((k) => `manual_admin_edit:${k}`)}::text[]))
            + (SELECT count(*) FROM staging.source_records WHERE external_record_id = ANY(${[R1, R2, GF]}::text[])))::int AS n`;
    expect(pointers.n).toBe(0);
  });

  it('is idempotent: replaying the same snapshot changes nothing and opens no batch', async () => {
    await settle(stageOf(records()));
    const before = await rows();
    const batches = await batchCount();
    const replay = await settle(stageOf(records()));
    expect(replay.status).toBe('no_changes');
    expect(replay.actions.every((a) => a.kind === 'unchanged')).toBe(true);
    expect(await rows()).toEqual(before);
    expect(await batchCount()).toBe(batches);
  });

  it('reschedules the same provider id in place, keeping its fixture_key', async () => {
    await settle(stageOf(records()));
    const before = (await byId(R1))!;
    const moved = records().map((r) => r.providerId === R1
      ? { ...r, utcStartTime: r.utcStartTime.replace(/^(\d{4}-\d{2}-)(\d{2})/, (_: string, ym: string, d: string) => `${ym}${String(Number(d) + 1).padStart(2, '0')}`) }
      : r);
    const outcome = await settle(stageOf(moved));
    expect(outcome.status).toBe('applied');
    const action = outcome.actions.find((a) => a.providerId === R1)!;
    expect(action.kind).toBe('rescheduled');
    expect(Object.keys(action.changes)).toEqual(['match_date']);
    const after = (await byId(R1))!;
    expect(after.fixtureKey).toBe(before.fixtureKey);
    expect(after.matchDate).not.toBe(before.matchDate);
    expect(after.batchId).toBe(outcome.batchId);
  });

  it('dry-run executes the writes and keeps none of them', async () => {
    const outcome = await settle(stageOf(records()), 'dry-run');
    expect(outcome.status).toBe('dry_run');
    expect(outcome.batchId).toBeNull();
    expect(await rows()).toHaveLength(0);
    expect(await batchCount()).toBe(0);
  });

  it('re-ingests after a destructive rebuild under the same provider identity and a new fixture_key (D-229-7)', async () => {
    await settle(stageOf(records()));
    const first = (await byId(GF))!;
    await purgeFixtures();
    await settle(stageOf(records()));
    const second = (await byId(GF))!;
    expect(second.sourceRecordId).toBe(first.sourceRecordId);
    expect(second.fixtureKey).not.toBe(first.fixtureKey);
  });
});

describe('lifecycle: postponed, cancelled, abandoned, completed, reinstated', () => {
  const withStatus = (id: string, status: string) => records().map((r) => (r.providerId === id ? { ...r, status } : r));

  it('refuses an unacknowledged unobserved status and changes nothing (D-229-3)', async () => {
    await settle(stageOf(records()));
    const before = await rows();
    const outcome = await settle(stageOf(withStatus(R1, 'POSTPONED')));
    expect(outcome.status).toBe('refused');
    expect(outcome.refusals[0].detail).toContain('status_unsupported');
    expect(await rows()).toEqual(before);
  });

  it('postponed (acknowledged): stays scheduled with date and time TBC', async () => {
    await settle(stageOf(records()));
    const outcome = await settle(stageOf(withStatus(R1, 'POSTPONED'), ['POSTPONED']));
    expect(outcome.actions.find((a) => a.providerId === R1)!.kind).toBe('postponed');
    expect(await byId(R1)).toMatchObject({ status: 'scheduled', matchDate: null, matchTime: null });
  });

  it('cancelled (acknowledged), then reinstated by a later SCHEDULED observation', async () => {
    await settle(stageOf(records()));
    await settle(stageOf(withStatus(R2, 'CANCELLED'), ['CANCELLED']));
    expect(await byId(R2)).toMatchObject({ status: 'cancelled', statusReason: `AFL API status CANCELLED (provider match ${R2})` });
    const back = await settle(stageOf(records()));
    expect(back.actions.find((a) => a.providerId === R2)!.kind).toBe('reinstated');
    expect(await byId(R2)).toMatchObject({ status: 'scheduled', statusReason: null });
  });

  it('abandoned (acknowledged) records a cancelled fixture whose reason says abandoned', async () => {
    await settle(stageOf(records()));
    await settle(stageOf(withStatus(GF, 'ABANDONED'), ['ABANDONED']));
    expect((await byId(GF))!.statusReason).toMatch(/^abandoned: AFL API status ABANDONED/);
    expect((await byId(GF))!.status).toBe('cancelled');
  });

  it('completed: a CONCLUDED observation of an owned fixture retains it untouched', async () => {
    await settle(stageOf(records()));
    const before = await rows();
    const concluded = records().map((r) => (r.providerId === R1 ? { ...clone(round1), providerId: R1 } : r));
    const outcome = await settle(stageOf(concluded));
    expect(outcome.status).toBe('no_changes');
    expect(outcome.actions.find((a) => a.providerId === R1)!.kind).toBe('completed_retained');
    expect(await rows()).toEqual(before);
  });

  it('a transition never creates a fixture', async () => {
    const outcome = await settle(stageOf([{ ...preMatch(round1, 'CD_MV2FX0099'), status: 'CANCELLED' }], ['CANCELLED']));
    expect(outcome.status).toBe('refused');
    expect(outcome.refusals.map((r) => r.code)).toEqual(['lifecycle_target_missing']);
    expect(await rows()).toHaveLength(0);
  });
});

describe('fail closed: identity, ownership, atomicity', () => {
  it('refuses an unresolved club and an unresolved venue, writing nothing', async () => {
    const unknownClub: AflApiFixtureContractContext = {
      registry, identities: { ...identities, teams: new Map([...identities.teams].map(([id, t]) => [id, { ...t, hist: `${t.hist}-missing` }])) },
    };
    const a = await settleAflApiFixtureStage(db, { stage: stageAflApiFixtureFeed(records(), unknownClub, { season: SEASON }), mode: 'apply', provenance });
    expect(new Set(a.refusals.map((r) => r.code))).toEqual(new Set(['club_unresolved']));
    const unknownVenue: AflApiFixtureContractContext = {
      registry, identities: { ...identities, venues: new Map([...identities.venues].map(([id, v]) => [id, { ...v, legacyName: `${MARKER}-nowhere` }])) },
    };
    const b = await settleAflApiFixtureStage(db, { stage: stageAflApiFixtureFeed(records(), unknownVenue, { season: SEASON }), mode: 'apply', provenance });
    expect(new Set(b.refusals.map((r) => r.code))).toEqual(new Set(['venue_unresolved']));
    expect(await rows()).toHaveLength(0);
    expect(await batchCount()).toBe(0);
  });

  it('never merges with or overwrites a manual fixture of the same game (D-229-4)', async () => {
    const [manual] = await owner<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'manual_admin_edit'`;
    const home = clubIds[teamIds.indexOf(grandFinal.home.team.providerId)];
    const away = clubIds[teamIds.indexOf(grandFinal.away.team.providerId)];
    await owner`
      INSERT INTO fixtures (fixture_key, season, round_code, round_number, round_type, home_club_id, away_club_id, source_id, source_record_id)
      VALUES (${`${MARKER}-manual`}, ${SEASON}, 'GF', NULL, 'grand_final', ${away}, ${home}, ${manual.id}, ${`${MARKER}-manual`})`;
    const outcome = await settle(stageOf(records()));
    expect(outcome.status).toBe('refused');
    expect(outcome.refusals.map((r) => [r.providerId, r.code])).toEqual([[GF, 'foreign_owned_collision']]);
    const kept = await rows();
    expect(kept.map((r) => r.sourceKey)).toEqual(['manual_admin_edit']);
  });

  it('refuses a provider id that now names different clubs', async () => {
    await settle(stageOf(records()));
    const swapped = records().map((r) => (r.providerId === R1 ? { ...r, home: r.away, away: r.home } : r));
    const outcome = await settle(stageOf(swapped));
    expect(outcome.refusals.map((r) => [r.providerId, r.code])).toEqual([[R1, 'club_identity_changed']]);
  });

  it('refuses a second provider id for a game already held (two ids, one fixture)', async () => {
    await settle(stageOf(records()));
    const outcome = await settle(stageOf([...records(), preMatch(round1, 'CD_MV2FX0101', (c) => { c.utcStartTime = c.utcStartTime.replace(/T\d{2}/, 'T09'); })]));
    expect(outcome.status).toBe('refused');
  });

  it('is all-or-nothing: one refusing record means no record is written', async () => {
    const mixed = [...records(), preMatch(round1, 'CD_MV2FX0102', (c) => { c.venue.providerId = 'CD_V_UNKNOWN'; })];
    const outcome = await settle(stageOf(mixed));
    expect(outcome.status).toBe('refused');
    expect(await rows()).toHaveLength(0);
    expect(await batchCount()).toBe(0);
  });
});

describe('the admin contract refuses provider-owned rows (D-229-6)', () => {
  it('rescheduleFixture on an afl_api row returns provider_owned and changes nothing', async () => {
    const { rescheduleFixture } = await import('@/db/queries/admin-fixtures');
    await settle(stageOf(records()));
    const before = (await byId(GF))!;
    const result = await rescheduleFixture({
      fixtureKey: before.fixtureKey, expectedUpdatedAt: 'irrelevant', adminUserId: 1,
      matchDate: '2026-10-03', matchTime: '14:30',
    });
    expect(result).toMatchObject({ ok: false, reason: 'provider_owned' });
    expect(await byId(GF)).toEqual(before);
  });
});
