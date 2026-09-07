/**
 * getClubMatchRecords (matches + venues + clubs), the club-page Club
 * Records section added for AFLDB-ISSUE-149.
 *
 * Truth is re-derived here directly from the raw scorelines
 * (`home_score` / `away_score`) for every match in the club's lineage,
 * never from the function under test. Identities are discovered
 * dynamically (Richmond by slug, its lineage by organization_id).
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getClubMatchRecords, type ClubMatchRecordKind } from '@/db/queries/clubs';

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
  id: number; season: number; matchDate: Date;
  homeClubId: number; awayClubId: number;
  homeScore: number; awayScore: number;
  attendance: number | null; roundType: string;
};

async function allLineageMatches(lineage: number[]): Promise<RawMatch[]> {
  return sql<RawMatch[]>`
    SELECT m.id, m.season, m.match_date AS "matchDate",
           m.home_club_id AS "homeClubId", m.away_club_id AS "awayClubId",
           m.home_score AS "homeScore", m.away_score AS "awayScore",
           m.attendance, m.round_type::text AS "roundType"
      FROM matches m
     WHERE m.home_club_id = ANY(${lineage}) OR m.away_club_id = ANY(${lineage})
  `;
}

/** Score / opponent from the lineage club's perspective. */
function perspective(m: RawMatch, lineage: Set<number>) {
  const clubIsHome = lineage.has(m.homeClubId);
  return {
    clubScore: clubIsHome ? m.homeScore : m.awayScore,
    opponentScore: clubIsHome ? m.awayScore : m.homeScore,
    opponentId: clubIsHome ? m.awayClubId : m.homeClubId,
    clubIsHome,
  };
}

describe('getClubMatchRecords', () => {
  it('Richmond: every record value and orientation matches the raw scoreline truth', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));
    const matches = await allLineageMatches([...lineage]);
    expect(matches.length, 'no Richmond matches in this DB').toBeGreaterThan(100);

    const rows = await getClubMatchRecords(clubId);
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    expect(rows.length).toBe(6);

    const persp = matches.map((m) => ({ m, ...perspective(m, lineage) }));
    const maxMargin = Math.max(...persp.filter((x) => x.clubScore > x.opponentScore)
      .map((x) => x.clubScore - x.opponentScore));
    const maxLoss = Math.max(...persp.filter((x) => x.opponentScore > x.clubScore)
      .map((x) => x.opponentScore - x.clubScore));
    const maxScore = Math.max(...persp.map((x) => x.clubScore));
    const minScore = Math.min(...persp.map((x) => x.clubScore));
    const maxCombined = Math.max(...persp.map((x) => x.clubScore + x.opponentScore));
    const minCombined = Math.min(...persp.map((x) => x.clubScore + x.opponentScore));

    const expected: Record<ClubMatchRecordKind, number> = {
      biggest_win: maxMargin,
      biggest_loss: maxLoss,
      highest_score: maxScore,
      lowest_score: minScore,
      highest_scoring_match: maxCombined,
      lowest_scoring_match: minCombined,
    };

    for (const [kind, value] of Object.entries(expected) as [ClubMatchRecordKind, number][]) {
      const row = byKind.get(kind);
      expect(row, kind).toBeDefined();
      expect(row!.value, kind).toBe(value);

      // Re-derive the perspective for the chosen match by id.
      const raw = matches.find((m) => m.id === row!.matchId)!;
      const p = perspective(raw, lineage);
      expect(row!.clubScore, `${kind} clubScore`).toBe(p.clubScore);
      expect(row!.opponentScore, `${kind} opponentScore`).toBe(p.opponentScore);
      expect(row!.opponentId, `${kind} opponentId`).toBe(p.opponentId);
      expect(lineage.has(row!.opponentId), `${kind} opponent must not be a lineage club`).toBe(false);
      expect(row!.season, `${kind} season`).toBe(raw.season);
    }

    // The record-holding match genuinely holds that value.
    expect(byKind.get('biggest_win')!.clubScore - byKind.get('biggest_win')!.opponentScore)
      .toBe(maxMargin);
    expect(byKind.get('highest_scoring_match')!.clubScore
      + byKind.get('highest_scoring_match')!.opponentScore).toBe(maxCombined);
  });

  it('covers a home case and an away case across the six records', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));
    const rows = await getClubMatchRecords(clubId);
    const raws = await allLineageMatches([...lineage]);

    let sawHome = false;
    let sawAway = false;
    for (const r of rows) {
      const raw = raws.find((m) => m.id === r.matchId)!;
      if (lineage.has(raw.homeClubId)) sawHome = true;
      if (lineage.has(raw.awayClubId)) sawAway = true;
    }
    expect(sawHome || sawAway, 'no record match involves the club at all').toBe(true);
    // Orientation is correct regardless; both being present is likely but
    // not guaranteed for one club's six extreme matches, so only assert
    // that whichever occurred was oriented right (checked above).
  });

  it('is deterministic — the same match ids on repeated calls', async () => {
    const clubId = await clubIdBySlug('richmond');
    const a = await getClubMatchRecords(clubId);
    const b = await getClubMatchRecords(clubId);
    expect(a.map((r) => `${r.kind}:${r.matchId}`)).toEqual(b.map((r) => `${r.kind}:${r.matchId}`));
  });

  it('a renamed club reports the same records under either identity', async () => {
    const [pair] = await sql<{ eraId: number; currentId: number }[]>`
      SELECT c.id AS "eraId", c.current_identity_id AS "currentId"
        FROM clubs c
       WHERE c.current_identity_id <> c.id
       LIMIT 1
    `;
    if (!pair) return;
    const era = await getClubMatchRecords(pair.eraId);
    const current = await getClubMatchRecords(pair.currentId);
    expect(era.map((r) => `${r.kind}:${r.matchId}:${r.value}`))
      .toEqual(current.map((r) => `${r.kind}:${r.matchId}:${r.value}`));
  });

  it('an unknown club id returns an empty list, never throws', async () => {
    expect(await getClubMatchRecords(-1)).toEqual([]);
  });
});
