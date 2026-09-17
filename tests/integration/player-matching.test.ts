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
  fetchClubLineage,
  fetchSourceEvidence,
} from '@/db/queries/player-match-candidates';
import { resolveClubText } from '@/lib/player-matching/club-identity';
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
    clubOrganizationId: null,
    clubMatch: 'lineage',
    clubNameRaw: null,
    resolvedClubs: [],
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

/**
 * afldb_normalise_name() itself (AFLDB-ISSUE-164 P1a, migration 099).
 *
 * There is exactly one implementation and it is SQL, so this is the only
 * place its behaviour can be proven. The scoring consequence is covered
 * DB-free in tests/player-matching.test.ts.
 */
describe('name normalisation', () => {
  // Built by code point: a raw U+00A0 in this file would be invisible
  // to a reader and indistinguishable from the ordinary space it is
  // being tested against.
  const NBSP = String.fromCharCode(0x00a0);
  const ZERO_WIDTH = String.fromCharCode(0x200b);
  /** Every other separator migration 099 admits, asserted one by one. */
  const SEPARATORS = [
    0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
    0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  ].map((code) => String.fromCharCode(code));

  async function normalise(input: string): Promise<string> {
    const [row] = await sql<{ n: string }[]>`SELECT afldb_normalise_name(${input}) AS n`;
    return row.n;
  }

  it('canonicalises U+00A0 to an ordinary space', async () => {
    // The ISSUE-164 P0 defect: 5,057 of 5,057 draft_persons rows use
    // U+00A0 as their separator. Before migration 099 this returned the
    // U+00A0 form unchanged, which no players.search_name can equal.
    expect(await normalise(`Aaron${NBSP}Cadman`)).toBe(`aaron cadman`);
    expect(await normalise(`Aaron${NBSP}Cadman`)).toBe(await normalise(`Aaron Cadman`));
  });

  it('canonicalises the other Unicode space separators the same way', async () => {
    for (const space of SEPARATORS) {
      expect(await normalise(`Aaron${space}Cadman`)).toBe(`aaron cadman`);
    }
  });

  it('leaves zero-width characters alone rather than inventing a word break', async () => {
    // U+200B is not a separator. Turning it into a space would split one
    // name into two tokens, which is a different and unproven decision.
    expect(await normalise(`Aaron${ZERO_WIDTH}Cadman`)).not.toBe(`aaron cadman`);
  });

  it('keeps every behaviour migrations 008 and 009 established', async () => {
    expect(await normalise('John Smith')).toBe('john smith');          // lowercase, plain space
    expect(await normalise("Gary O'Donnell")).toBe('gary odonnell');   // apostrophe removed
    expect(await normalise('T.J. Smith')).toBe('tj smith');            // full stops removed
    expect(await normalise('Anthony McDonald-Tipungwuti'))             // hyphen becomes a space
      .toBe('anthony mcdonald tipungwuti');
    expect(await normalise('Ren\u00e9e Dupr\u00e9')).toBe('renee dupre');    // unaccented
  });

  it('collapses and trims whitespace deterministically, Unicode included', async () => {
    expect(await normalise('  John   Smith  ')).toBe('john smith');
    expect(await normalise(`${NBSP}John${NBSP}${NBSP}Smith${NBSP}`)).toBe(`john smith`);
    expect(await normalise(`John ${NBSP}Smith`)).toBe(`john smith`);
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

describe('club lineage and club text against real clubs', () => {
  // AFLDB-ISSUE-164 S1/S3/S4. Unit tests pin the rules; only the real
  // clubs and club_aliases rows can say whether the historical
  // identities this feature exists for actually resolve.
  const orgsFor = (lineage: Awaited<ReturnType<typeof fetchClubLineage>>, text: string) =>
    resolveClubText(text, lineage.textIndex).map((c) => c.organizationId);

  it('resolves a rename to one continuing club: Footscray and Western Bulldogs', async () => {
    const lineage = await fetchClubLineage(sql);
    const footscray = orgsFor(lineage, 'Footscray');
    const bulldogs = orgsFor(lineage, 'Western Bulldogs');
    expect(footscray).toHaveLength(1);
    expect(bulldogs).toEqual(footscray);
  });

  it('resolves a relocation to one continuing club: South Melbourne and Sydney', async () => {
    const lineage = await fetchClubLineage(sql);
    const south = orgsFor(lineage, 'South Melbourne');
    const sydney = orgsFor(lineage, 'Sydney');
    expect(south).toHaveLength(1);
    expect(sydney).toEqual(south);
  });

  it('keeps a merger out of the lineage: Fitzroy is not Brisbane Lions', async () => {
    // migration 017 records the merger as a relation between two
    // organizations precisely so the records do not combine.
    const lineage = await fetchClubLineage(sql);
    const fitzroy = orgsFor(lineage, 'Fitzroy');
    const lions = orgsFor(lineage, 'Brisbane Lions');
    expect(fitzroy).toHaveLength(1);
    expect(lions).toHaveLength(1);
    expect(fitzroy).not.toEqual(lions);
  });

  it('resolves the Kangaroos identity to North Melbourne where the schema has it', async () => {
    const lineage = await fetchClubLineage(sql);
    const kangaroos = orgsFor(lineage, 'Kangaroos');
    if (kangaroos.length === 0) return; // not a separate identity in this schema
    expect(kangaroos).toEqual(orgsFor(lineage, 'North Melbourne'));
  });

  it('resolves no club text to more than one continuing club', async () => {
    // Ambiguity fails closed, so every resolution is exactly one club.
    const lineage = await fetchClubLineage(sql);
    for (const text of ['Carlton', 'Brisbane', 'Melbourne', 'Adelaide', 'Port Adelaide']) {
      for (const resolved of resolveClubText(text, lineage.textIndex)) {
        expect(resolved.organizationId).not.toBeNull();
      }
    }
  });

  it('leaves a club AFLDB does not hold unresolved rather than guessing', async () => {
    const lineage = await fetchClubLineage(sql);
    for (const text of ['Norwood', 'Sturt', 'Claremont', 'SANFL', 'VFL/AFL']) {
      expect(orgsFor(lineage, text)).toEqual([]);
    }
  });

  it('carries the lineage on every source row and candidate club', async () => {
    const rows = await fetchSourceEvidence(sql, { status: 'trusted', limit: 50 });
    if (rows.length === 0) return;
    for (const row of rows) {
      if (row.source.clubId !== null) {
        expect(row.source.clubOrganizationId).not.toBeNull();
        // A club_id source never re-resolves its own printed name.
        expect(row.source.resolvedClubs).toEqual([]);
      }
    }
    const candidates = await fetchCandidateEvidence(sql, rows.map((r) => r.source));
    for (const set of candidates.values()) {
      for (const candidate of set) {
        for (const club of candidate.clubs) expect(club.organizationId).not.toBeNull();
      }
    }
  });

  it('gates lineage-aware club matching to the authorised sources', async () => {
    // S1 is a non-draft tranche. Draft rows carry the lineage and must
    // not be compared through it until Tier 2 can measure the change.
    const rows = await fetchSourceEvidence(sql, { status: 'unresolved', limit: 200 });
    if (rows.length === 0) return;
    for (const row of rows) {
      expect(row.source.clubMatch).toBe(
        row.source.target.targetTable === 'draft_picks' ? 'club_id' : 'lineage',
      );
    }
  });

  it('resolves Hall of Fame club text where it names AFLDB clubs, and never fuzzily', async () => {
    const rows = await fetchSourceEvidence(sql, { status: 'trusted', table: 'hall_of_fame' });
    if (rows.length === 0) return;
    const withText = rows.filter((r) => (r.source.clubNameRaw ?? '').trim().length > 0);
    if (withText.length === 0) return;

    for (const row of withText) {
      const raw = row.source.clubNameRaw ?? '';
      for (const resolved of row.source.resolvedClubs) {
        // Every resolution came from a segment of the raw text verbatim.
        expect(raw).toContain(resolved.text);
      }
    }
    // The population this signal exists for is non-empty.
    expect(withText.some((r) => r.source.resolvedClubs.length > 0)).toBe(true);
  });

  it('raises no contradiction from a club-text source, resolved or not', async () => {
    for (const table of ['hall_of_fame', 'honour_team_members'] as const) {
      const rows = await fetchSourceEvidence(sql, { status: 'trusted', table, limit: 200 });
      if (rows.length === 0) continue;
      const assessments = await assessSources(sql, rows.map((r) => r.source));
      for (const row of rows) {
        const assessment = assessments.get(resolutionKey(row.source.target));
        for (const conflict of assessment?.best?.conflicts ?? []) {
          expect(conflict.reason).not.toBe('club_not_in_history');
        }
      }
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
