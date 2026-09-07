/**
 * getClubCrowdRecords (matches + venues + clubs), the club-page Record
 * Crowds section added for AFLDB-ISSUE-149.
 *
 * Truth is re-derived from the raw `matches.attendance` for the club's
 * lineage. Null attendance must never be treated as a crowd.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getClubCrowdRecords } from '@/db/queries/clubs';

afterAll(async () => {
  await sql.end();
});

async function clubIdBySlug(slug: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM clubs WHERE slug = ${slug}`;
  expect(row, `club ${slug} is missing from afldb_test`).toBeDefined();
  return row.id;
}

async function lineageIds(clubId: number): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM clubs
     WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
  `;
  return rows.map((r) => r.id);
}

type RawMatch = {
  id: number; attendance: number | null; roundType: string;
  isFinalsSeries: boolean | null;
  homeClubId: number; awayClubId: number;
};

async function lineageMatches(lineage: number[]): Promise<RawMatch[]> {
  return sql<RawMatch[]>`
    SELECT m.id, m.attendance, m.round_type::text AS "roundType",
           m.is_finals_series AS "isFinalsSeries",
           m.home_club_id AS "homeClubId", m.away_club_id AS "awayClubId"
      FROM matches m
     WHERE m.home_club_id = ANY(${lineage}) OR m.away_club_id = ANY(${lineage})
  `;
}

describe('getClubCrowdRecords', () => {
  it('Richmond: the three records match the raw attendance maxima and are real crowds', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = await lineageIds(clubId);
    const matches = await lineageMatches(lineage);
    const withCrowd = matches.filter((m) => m.attendance !== null);
    expect(withCrowd.length).toBeGreaterThan(50);

    const { records, top } = await getClubCrowdRecords(clubId);

    const maxOf = (pred: (m: RawMatch) => boolean) => {
      const vals = withCrowd.filter(pred).map((m) => m.attendance!);
      return vals.length ? Math.max(...vals) : null;
    };
    const expectedHA = maxOf((m) => m.roundType === 'home_and_away');
    const expectedFinals = maxOf((m) => m.isFinalsSeries === true);
    const expectedGF = maxOf((m) => m.roundType === 'grand_final');

    const byKind = new Map(records.map((r) => [r.kind, r]));
    if (expectedHA !== null) {
      expect(byKind.get('record_home_and_away')?.crowd).toBe(expectedHA);
      expect(byKind.get('record_home_and_away')?.roundType).toBe('home_and_away');
    }
    if (expectedFinals !== null) {
      expect(byKind.get('record_finals')?.crowd).toBe(expectedFinals);
    }
    if (expectedGF !== null) {
      expect(byKind.get('record_grand_final')?.crowd).toBe(expectedGF);
      expect(byKind.get('record_grand_final')?.roundType).toBe('grand_final');
    }

    for (const r of [...records, ...top]) {
      expect(r.crowd, 'a null attendance leaked into a crowd record').not.toBeNull();
      expect(r.crowd).toBeGreaterThan(0);
    }
  });

  it('Top 5 is the five largest recorded crowds, strictly ordered, deterministic', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = await lineageIds(clubId);
    const withCrowd = (await lineageMatches(lineage)).filter((m) => m.attendance !== null);
    const overallMax = Math.max(...withCrowd.map((m) => m.attendance!));

    const first = await getClubCrowdRecords(clubId);
    const second = await getClubCrowdRecords(clubId);
    expect(first.top.map((r) => r.matchId)).toEqual(second.top.map((r) => r.matchId));

    expect(first.top.length).toBe(Math.min(5, withCrowd.length));
    expect(first.top[0].crowd).toBe(overallMax);
    for (let i = 1; i < first.top.length; i++) {
      expect(first.top[i - 1].crowd).toBeGreaterThanOrEqual(first.top[i].crowd);
    }
  });

  it('the club can be the home or the away team in a crowd record', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));
    const { records, top } = await getClubCrowdRecords(clubId);
    const raws = await lineageMatches([...lineage]);

    let sawHome = false;
    let sawAway = false;
    for (const r of [...records, ...top]) {
      const raw = raws.find((m) => m.id === r.matchId)!;
      if (lineage.has(raw.homeClubId)) sawHome = true;
      if (lineage.has(raw.awayClubId)) sawAway = true;
      // The opponent is always the other side.
      expect([raw.homeClubId, raw.awayClubId]).toContain(r.opponentId);
      expect(lineage.has(r.opponentId)).toBe(false);
    }
    expect(sawHome, 'never the home team in any crowd record').toBe(true);
    expect(sawAway, 'never the away team in any crowd record').toBe(true);
  });

  it('a renamed club reports the same crowd records under either identity', async () => {
    const [pair] = await sql<{ eraId: number; currentId: number }[]>`
      SELECT c.id AS "eraId", c.current_identity_id AS "currentId"
        FROM clubs c WHERE c.current_identity_id <> c.id LIMIT 1
    `;
    if (!pair) return;
    const era = await getClubCrowdRecords(pair.eraId);
    const current = await getClubCrowdRecords(pair.currentId);
    expect(era.top.map((r) => r.matchId)).toEqual(current.top.map((r) => r.matchId));
    expect(era.records.map((r) => `${r.kind}:${r.matchId}`))
      .toEqual(current.records.map((r) => `${r.kind}:${r.matchId}`));
  });

  it('an unknown club id returns empty records and an empty top list', async () => {
    expect(await getClubCrowdRecords(-1)).toEqual({ records: [], top: [] });
  });
});
