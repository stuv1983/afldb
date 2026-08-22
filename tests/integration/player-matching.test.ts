/**
 * Candidate generation against real data.
 *
 * The pure scoring rules are covered by tests/player-matching.test.ts.
 * What cannot be proven without a database is the half that decides who
 * is even compared: the SQL blocking. A floor set too high, or a
 * normalisation that disagrees with the one PostgreSQL stored, loses the
 * right player before any scoring happens -- a failure the unit tests
 * are structurally incapable of seeing.
 *
 * Nothing here writes, and no player or link is hardcoded: rows are
 * discovered at runtime so the suite survives a data reload.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  assessSources,
  fetchCandidateEvidence,
  fetchSourceEvidence,
} from '@/db/queries/player-match-candidates';
import { resolutionKey, type SourceEvidence } from '@/lib/player-matching/types';

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

function sourceFor(id: number, normalisedName: string, rawName: string): SourceEvidence {
  return {
    target: {
      targetTable: 'award_winners',
      targetId: id,
      resolutionEntityType: 'award_winners',
      resolutionEntityId: id,
    },
    rawName,
    normalisedName,
    temporal: [],
    clubId: null,
    clubNameRaw: null,
    reportedGames: null,
    reportedGoals: null,
    context: 'candidate generation test',
    linkStatus: 'unmatched',
    uniquenessScope: { kind: 'none' },
  };
}

describe('source evidence extraction', () => {
  it('reads draft picks at draft_person grain, never per pick', async () => {
    const rows = await fetchSourceEvidence(sql, { status: 'unresolved', table: 'draft_picks' });
    if (rows.length === 0) return;

    for (const row of rows) {
      expect(row.source.target.resolutionEntityType).toBe('draft_person');
      expect(row.source.target.resolutionEntityId).toBeGreaterThan(0);
    }
    // One decision per person: a person with four picks must not appear
    // as four suggestions that could disagree with each other.
    const keys = rows.map((r) => resolutionKey(r.source.target));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('labels award seasons external and captaincy seasons AFLDB', async () => {
    // The distinction decides whether a career range may CONTRADICT a
    // source: award_winners covers Magarey, Sandover and U18 medals,
    // where a player legitimately had no AFLDB season that year.
    const [award] = await fetchSourceEvidence(sql, {
      status: 'trusted', table: 'award_winners', limit: 1,
    });
    if (award) {
      for (const item of award.source.temporal) {
        if (item.kind === 'active_season') expect(item.competitionScope).toBe('external');
      }
    }

    const [captaincy] = await fetchSourceEvidence(sql, {
      status: 'trusted', table: 'captaincies', limit: 1,
    });
    if (captaincy) {
      const seasons = captaincy.source.temporal.filter((t) => t.kind === 'active_season');
      expect(seasons.length).toBeGreaterThan(0);
      for (const item of seasons) {
        if (item.kind === 'active_season') expect(item.competitionScope).toBe('afldb');
      }
    }
  });

  it('keeps the known player id out of the evidence the scorer sees', async () => {
    const rows = await fetchSourceEvidence(sql, { status: 'trusted', limit: 25 });
    if (rows.length === 0) return;
    expect(rows.some((r) => r.knownPlayerId !== null)).toBe(true);
    for (const row of rows) {
      expect(JSON.stringify(row.source)).not.toContain('knownPlayerId');
    }
  });
});

describe('candidate blocking', () => {
  it('finds a player by their exact normalised name', async () => {
    const [player] = await sql<{ id: number; searchName: string; displayName: string }[]>`
      SELECT id, search_name AS "searchName", display_name AS "displayName"
        FROM players
       WHERE search_name <> ''
       ORDER BY id
       LIMIT 1
    `;
    const candidates = await fetchCandidateEvidence(
      sql,
      [sourceFor(1, player.searchName, player.displayName)],
    );
    const found = candidates.get('award_winners:1') ?? [];
    expect(found.map((c) => c.playerId)).toContain(player.id);
  });

  it('matches across punctuation, because both sides are normalised in SQL', async () => {
    // AFLDB stores many names without their apostrophe ("Gary
    // ODonnell") while the sources keep it. afldb_normalise_name strips
    // it from both, which is the only reason those rows can ever link.
    const [player] = await sql<{ id: number; searchName: string; displayName: string }[]>`
      SELECT id, search_name AS "searchName", display_name AS "displayName"
        FROM players
       WHERE display_name ~ '^O[A-Z]'
       ORDER BY id
       LIMIT 1
    `;
    if (!player) return;

    const withApostrophe = player.displayName.replace(/^O/, 'O@');
    const [{ normalised }] = await sql<{ normalised: string }[]>`
      SELECT afldb_normalise_name(replace(${withApostrophe}, '@', chr(39))) AS normalised
    `;
    expect(normalised).toBe(player.searchName);

    const candidates = await fetchCandidateEvidence(
      sql,
      [sourceFor(2, normalised, player.displayName)],
    );
    expect((candidates.get('award_winners:2') ?? []).map((c) => c.playerId)).toContain(player.id);
  });

  it('recalls the true player for confirmed links', async () => {
    // The measure the whole feature rests on: blocking that misses the
    // correct player makes every downstream score irrelevant.
    const rows = (await fetchSourceEvidence(sql, { status: 'trusted', limit: 200 }))
      .filter((r) => r.knownPlayerId !== null);
    if (rows.length < 20) return;

    const candidates = await fetchCandidateEvidence(sql, rows.map((r) => r.source));
    const recalled = rows.filter((row) => {
      const set = candidates.get(resolutionKey(row.source.target)) ?? [];
      return set.some((c) => c.playerId === row.knownPlayerId);
    });
    expect(recalled.length / rows.length).toBeGreaterThan(0.95);
  });

  it('does not collide an honour-team row with its own existing link', async () => {
    // A row being assessed is excluded from its own uniqueness check.
    // Without that, every already-linked row contradicts itself.
    const rows = (await fetchSourceEvidence(sql, {
      status: 'trusted', table: 'honour_team_members', limit: 25,
    })).filter((r) => r.knownPlayerId !== null);
    if (rows.length === 0) return;

    const candidates = await fetchCandidateEvidence(sql, rows.map((r) => r.source));
    for (const row of rows) {
      const self = (candidates.get(resolutionKey(row.source.target)) ?? [])
        .find((c) => c.playerId === row.knownPlayerId);
      if (self) expect(self.uniquenessConflict).toBeNull();
    }
  });
});

describe('assessment over real rows', () => {
  it('raises no contradiction against links AFLDB already confirmed', async () => {
    const rows = (await fetchSourceEvidence(sql, { status: 'trusted', limit: 200 }))
      .filter((r) => r.knownPlayerId !== null);
    if (rows.length < 20) return;

    const assessments = await assessSources(sql, rows.map((r) => r.source));
    const contradicted = rows.filter((row) => {
      const assessment = assessments.get(resolutionKey(row.source.target));
      return assessment?.best?.playerId === row.knownPlayerId && assessment.hardConflict;
    });
    expect(contradicted).toHaveLength(0);
  });
});
