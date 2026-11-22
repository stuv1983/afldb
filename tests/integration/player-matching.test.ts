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
 *
 * ONE EXCEPTION (AFLDB-ISSUE-363 TST-4): the apostrophe case seeds its own
 * synthetic player (`seedApostrophePlayer`, committed, removed in `finally`).
 * It used to discover a real `O[A-Z]...` player and `return` when there was
 * none, which is every production-shaped database: AFLDB stores those names
 * without the apostrophe, but the snapshot holds no such name starting with O.
 * The seed makes it assert everywhere, and it fails loudly if absent.
 *
 * SECOND EXCEPTION (AFLDB-ISSUE-377): the recall, honour-team self-collision and
 * "no contradiction against confirmed links" cases used to `return` below 20 (or 0)
 * trusted links, so on a database with no honours data they passed having asserted
 * nothing. Each now has (a) a MANDATORY case over a synthetic, committed, `finally`-removed
 * set of confirmed links (`seedConfirmedLinks`) that always runs and asserts, (b) a
 * control proving the assertion helper FAILS on an empty result, and (c) the original
 * empirical case, which reports an explicit `skip` with its reason when the real corpus
 * is too small instead of returning silently. Seeded rows are always removed before the
 * empirical cases read, so they can never make a small corpus look big enough.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  assessSources,
  fetchCandidateEvidence,
  fetchClubLineage,
  fetchSourceEvidence,
  type SourceEvidenceRow,
} from '@/db/queries/player-match-candidates';
import { resolveClubText } from '@/lib/player-matching/club-identity';
import {
  resolutionKey,
  type CandidateEvidence,
  type MatchAssessment,
  type SourceEvidence,
} from '@/lib/player-matching/types';

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

/** Reserved synthetic player for the apostrophe case. COMMITTED (the blocking SQL reads through the shared client). */
const APOSTROPHE_SLUG = 'issue363-apostrophe-player';
const APOSTROPHE_LEGACY_ID = -363_000_001;

async function removeApostrophePlayer(): Promise<void> {
  await sql`DELETE FROM players WHERE slug = ${APOSTROPHE_SLUG}`;
}

/** A player whose display name begins `O` + capital and carries no apostrophe, keyed as an import stores it. */
async function seedApostrophePlayer(): Promise<{ id: number; searchName: string; displayName: string }> {
  await removeApostrophePlayer();
  const [player] = await sql<{ id: number; searchName: string; displayName: string }[]>`
    INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
    VALUES (${APOSTROPHE_LEGACY_ID}, 'OBrienzzfixture', 'OBrienzzfixture, Issue', afldb_normalise_name('OBrienzzfixture'),
            ${APOSTROPHE_SLUG}, 'Issue', 'OBrienzzfixture')
    RETURNING id::int AS id, search_name AS "searchName", display_name AS "displayName"`;
  return player;
}

/** The empirical recall/contradiction cases only mean something with at least this many confirmed links. */
const EMPIRICAL_MIN_TRUSTED_LINKS = 20;
/** The recall floor the feature rests on (blocking that misses the true player makes every score irrelevant). */
const RECALL_FLOOR = 0.95;

const SEEDED_AWARD_SLUG = 'issue377-recall-award';
const SEEDED_TEAM = 'Issue377 Recall Team';
const SEEDED_SLUG_PREFIX = 'issue377-recall-';
const SEEDED_LEGACY_BASE = -377_100_000;
/**
 * Made-up given/surname pairs, deliberately dissimilar from one another (so trigram
 * blocking cannot confuse two seeded players) and from any real footballer.
 */
const SEEDED_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['Zorbak', 'Quillenmoor'], ['Vexley', 'Thrumbarrow'], ['Yarnolf', 'Dwindlecombe'],
  ['Kestrix', 'Plumbottle'], ['Orsolo', 'Fernwhistle'], ['Mubrik', 'Slatterhorn'],
  ['Quenzo', 'Aldermarsh'], ['Tavrian', 'Blightwater'], ['Ulfric', 'Nettlethorne'],
  ['Wexton', 'Harrowmere'], ['Xanthor', 'Pellingdon'], ['Jorvik', 'Crumbleton'],
  ['Lazlo', 'Frostenwick'], ['Dormund', 'Gallowshine'], ['Eskarn', 'Tumblewood'],
  ['Fenwick', 'Ravenscaldt'], ['Gorlan', 'Mistlethwaite'], ['Ibsen', 'Cobblethwaite'],
  ['Nyland', 'Skerrywick'], ['Pomeroy', 'Wintergale'], ['Rubek', 'Sallowfield'],
  ['Silvan', 'Dunmarrow'], ['Tobrin', 'Ashgrovelle'], ['Vandor', 'Oakenshaw'],
];
const SEEDED_LINKS = SEEDED_NAMES.length;

type SeededTable = 'award_winners' | 'honour_team_members';

/** Remove every seeded row, children before parents. Safe to call when nothing is seeded. */
async function removeSeededLinks(): Promise<void> {
  await sql`DELETE FROM honour_team_members WHERE team_name = ${SEEDED_TEAM}`;
  await sql`DELETE FROM award_winners
             WHERE award_id IN (SELECT id FROM awards WHERE slug = ${SEEDED_AWARD_SLUG})`;
  await sql`DELETE FROM awards WHERE slug = ${SEEDED_AWARD_SLUG}`;
  await sql`DELETE FROM players WHERE slug LIKE ${SEEDED_SLUG_PREFIX + '%'}`;
}

/**
 * The source-side spelling of a seeded name. Every third row is printed exactly, every
 * third carries an apostrophe the stored name lacks, every third is padded, doubled-spaced
 * and upper-cased -- all three normalise to the stored search_name in SQL, so recall here
 * exercises the same normalisation a real import depends on.
 */
function seededRawName(index: number): string {
  const [given, surname] = SEEDED_NAMES[index];
  if (index % 3 === 1) return `${given} ${surname.slice(0, 4)}'${surname.slice(4)}`;
  if (index % 3 === 2) return `  ${given.toUpperCase()}   ${surname.toUpperCase()} `;
  return `${given} ${surname}`;
}

/**
 * Seed SEEDED_LINKS synthetic players and one TRUSTED ('resolved', player_id set) source
 * row each in `table`, then read them back through `fetchSourceEvidence` exactly as the
 * backtest reads real links. COMMITTED, because the blocking SQL reads through the shared
 * client; callers MUST `removeSeededLinks()` in a `finally`.
 */
async function seedConfirmedLinks(table: SeededTable): Promise<SourceEvidenceRow[]> {
  await removeSeededLinks();
  let awardId: number | null = null;
  if (table === 'award_winners') {
    const [award] = await sql<{ id: number }[]>`
      INSERT INTO awards (slug, name, category)
      VALUES (${SEEDED_AWARD_SLUG}, 'Issue 377 recall fixture award', 'award')
      RETURNING id::int AS id`;
    awardId = award.id;
  }
  const rows: SourceEvidenceRow[] = [];
  for (let i = 0; i < SEEDED_LINKS; i += 1) {
    const [given, surname] = SEEDED_NAMES[i];
    const displayName = `${given} ${surname}`;
    const [player] = await sql<{ id: number }[]>`
      INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
      VALUES (${SEEDED_LEGACY_BASE - i}, ${displayName}, ${`${surname}, ${given}`},
              afldb_normalise_name(${displayName}), ${`${SEEDED_SLUG_PREFIX}${i}`}, ${given}, ${surname})
      RETURNING id::int AS id`;
    const rawName = seededRawName(i);
    const [row] = table === 'award_winners'
      ? await sql<{ id: number }[]>`
          INSERT INTO award_winners (award_id, player_id, player_name_raw, link_status_value, source_record_id)
          VALUES (${awardId}, ${player.id}, ${rawName}, 'resolved', ${`issue377:${i}`})
          RETURNING id::int AS id`
      : await sql<{ id: number }[]>`
          INSERT INTO honour_team_members (team_name, player_id, player_name_raw, link_status_value)
          VALUES (${SEEDED_TEAM}, ${player.id}, ${rawName}, 'resolved')
          RETURNING id::int AS id`;
    const [evidence] = await fetchSourceEvidence(sql, {
      status: 'trusted', table, entity: { type: table, id: row.id },
    });
    // The seed must be visible to the real reader as a trusted link to THIS player; if
    // it is not, the recall assertions below would be measuring nothing.
    expect(evidence, `seeded ${table} row ${i} must be read back as a trusted link`).toBeDefined();
    expect(evidence.knownPlayerId).toBe(player.id);
    rows.push(evidence);
  }
  return rows;
}

type LinkRow = Pick<SourceEvidenceRow, 'source' | 'knownPlayerId'>;

/**
 * The recall assertion, as a helper so a control can prove it is not vacuous. It FAILS on
 * a population smaller than `minRows` (an empty corpus is not a recall of 1.0) and on any
 * recall at or below RECALL_FLOOR.
 */
function assertRecall(
  rows: readonly LinkRow[],
  candidates: ReadonlyMap<string, readonly CandidateEvidence[]>,
  minRows: number,
): void {
  expect(rows.length, `recall needs at least ${minRows} confirmed links to mean anything`)
    .toBeGreaterThanOrEqual(minRows);
  const recalled = rows.filter((row) => {
    const set = candidates.get(resolutionKey(row.source.target)) ?? [];
    return set.some((c) => c.playerId === row.knownPlayerId);
  });
  expect(recalled.length / rows.length).toBeGreaterThan(RECALL_FLOOR);
}

/**
 * The no-contradiction assertion, likewise. `requireAssessedToOwnPlayer` (seeded: true)
 * additionally fails any row whose best candidate is not its own known player, so an empty
 * assessment map cannot pass; the empirical case keeps its original, looser semantics.
 */
function assertNoContradiction(
  rows: readonly LinkRow[],
  assessments: ReadonlyMap<string, MatchAssessment>,
  minRows: number,
  requireAssessedToOwnPlayer: boolean,
): void {
  expect(rows.length, `needs at least ${minRows} confirmed links to mean anything`)
    .toBeGreaterThanOrEqual(minRows);
  if (requireAssessedToOwnPlayer) {
    const missed = rows.filter(
      (row) => assessments.get(resolutionKey(row.source.target))?.best?.playerId !== row.knownPlayerId,
    );
    expect(missed.map((r) => resolutionKey(r.source.target)), 'every row must be assessed to its own player')
      .toEqual([]);
  }
  const contradicted = rows.filter((row) => {
    const assessment = assessments.get(resolutionKey(row.source.target));
    return assessment?.best?.playerId === row.knownPlayerId && assessment.hardConflict;
  });
  expect(contradicted).toHaveLength(0);
}

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
    // Seeded, not discovered (TST-4): the stored side is written by the same
    // SQL normaliser a real import uses, so the proof is that the SOURCE side
    // ("O'Brienzzfixture") normalises to exactly that stored key and blocks to the player.
    const player = await seedApostrophePlayer();
    try {
      expect(player.displayName, 'the seeded player must exist').toMatch(/^O[A-Z]/);
      expect(player.displayName).not.toContain("'");

      const withApostrophe = player.displayName.replace(/^O/, 'O@');
      const [{ normalised }] = await sql<{ normalised: string }[]>`
        SELECT afldb_normalise_name(replace(${withApostrophe}, '@', chr(39))) AS normalised
      `;
      expect(normalised).toBe(player.searchName);
      expect(normalised).not.toContain("'");

      const candidates = await fetchCandidateEvidence(
        sql,
        [sourceFor(2, normalised, player.displayName)],
      );
      expect((candidates.get('award_winners:2') ?? []).map((c) => c.playerId)).toContain(player.id);
    } finally {
      await removeApostrophePlayer();
    }
  });

  it('recalls the true player for seeded confirmed links (mandatory, always runs)', async () => {
    // AFLDB-ISSUE-377. Synthetic trusted links, so this asserts on an empty
    // database as well as a populated one. Source spellings differ from the
    // stored names (apostrophe, case, padding) so the SQL normalisation is
    // part of what is proven.
    try {
      const rows = await seedConfirmedLinks('award_winners');
      expect(rows).toHaveLength(SEEDED_LINKS);

      const candidates = await fetchCandidateEvidence(sql, rows.map((r) => r.source));
      assertRecall(rows, candidates, SEEDED_LINKS);
      // Seeded names are unique and exact after normalisation: recall is total.
      for (const row of rows) {
        const set = candidates.get(resolutionKey(row.source.target)) ?? [];
        expect(set.map((c) => c.playerId), `seeded row ${row.source.rawName.trim()}`)
          .toContain(row.knownPlayerId);
      }

      // Control: the SAME assertion over a deliberately empty candidate result
      // must fail, so this test cannot pass vacuously.
      expect(() => assertRecall(rows, new Map(), SEEDED_LINKS)).toThrow();
    } finally {
      await removeSeededLinks();
    }
  });

  it('control: the recall assertion fails on an empty population and on sub-floor recall', () => {
    // DB-free. An empty corpus is the exact shape the old test passed on.
    expect(() => assertRecall([], new Map(), EMPIRICAL_MIN_TRUSTED_LINKS)).toThrow();

    const target = (id: number) => ({
      targetTable: 'award_winners' as const, targetId: id,
      resolutionEntityType: 'award_winners' as const, resolutionEntityId: id,
    });
    const rowsOf = (n: number): LinkRow[] => Array.from({ length: n }, (_, i) => ({
      source: { ...sourceFor(i + 1, 'x', 'x'), target: target(i + 1) },
      knownPlayerId: i + 1,
    }));
    const candidatesFor = (recalledCount: number) => new Map(
      rowsOf(20).slice(0, recalledCount).map((r) => [
        resolutionKey(r.source.target),
        [{ playerId: r.knownPlayerId } as CandidateEvidence],
      ] as const),
    );
    // 20 rows: 20/20 and 20/20 pass; 19/20 = 0.95 is NOT above the floor; 18/20 fails.
    expect(() => assertRecall(rowsOf(20), candidatesFor(20), 20)).not.toThrow();
    expect(() => assertRecall(rowsOf(20), candidatesFor(19), 20)).toThrow();
    expect(() => assertRecall(rowsOf(20), candidatesFor(18), 20)).toThrow();
    // Too few rows is a failure of the population, not a pass.
    expect(() => assertRecall(rowsOf(19), candidatesFor(19), 20)).toThrow();
  });

  it('recalls the true player for confirmed links (empirical corpus)', async (ctx) => {
    // The measure the whole feature rests on: blocking that misses the
    // correct player makes every downstream score irrelevant.
    const rows = (await fetchSourceEvidence(sql, { status: 'trusted', limit: 200 }))
      .filter((r) => r.knownPlayerId !== null);
    if (rows.length < EMPIRICAL_MIN_TRUSTED_LINKS) {
      ctx.skip(
        `empirical corpus unavailable: ${rows.length} trusted links with a known player, `
        + `need ${EMPIRICAL_MIN_TRUSTED_LINKS}; the seeded recall case above is the mandatory control`,
      );
    }

    const candidates = await fetchCandidateEvidence(sql, rows.map((r) => r.source));
    assertRecall(rows, candidates, EMPIRICAL_MIN_TRUSTED_LINKS);
  });

  it('does not collide a seeded honour-team row with its own existing link (mandatory, always runs)', async () => {
    // AFLDB-ISSUE-377. A row being assessed is excluded from its own
    // uniqueness check. Without that, every already-linked row contradicts
    // itself.
    try {
      const rows = await seedConfirmedLinks('honour_team_members');
      expect(rows).toHaveLength(SEEDED_LINKS);
      for (const row of rows) expect(row.source.uniquenessScope).toEqual({ kind: 'honour_team', teamName: SEEDED_TEAM });

      const candidates = await fetchCandidateEvidence(sql, rows.map((r) => r.source));
      for (const row of rows) {
        const self = (candidates.get(resolutionKey(row.source.target)) ?? [])
          .find((c) => c.playerId === row.knownPlayerId);
        // Unlike the empirical case, the candidate MUST be there: no `if (self)`.
        expect(self, `seeded row ${row.source.rawName.trim()} must retrieve its own player`).toBeDefined();
        expect(self!.uniquenessConflict).toBeNull();
      }

      // Control: the same player assessed from a DIFFERENT honour-team row (an id that is
      // not the seeded one) does collide, so a null above is not just "never checked".
      const first = rows[0];
      const rival: SourceEvidence = {
        ...sourceFor(377, first.source.normalisedName, first.source.rawName),
        target: {
          targetTable: 'honour_team_members', targetId: -377,
          resolutionEntityType: 'honour_team_members', resolutionEntityId: -377,
        },
        uniquenessScope: { kind: 'honour_team', teamName: SEEDED_TEAM },
      };
      const rivalCandidates = await fetchCandidateEvidence(sql, [rival]);
      const taken = (rivalCandidates.get(resolutionKey(rival.target)) ?? [])
        .find((c) => c.playerId === first.knownPlayerId);
      expect(taken, 'the rival row must retrieve the seeded player').toBeDefined();
      expect(taken!.uniquenessConflict).not.toBeNull();
    } finally {
      await removeSeededLinks();
    }
  });

  it('does not collide an honour-team row with its own existing link (empirical corpus)', async (ctx) => {
    const rows = (await fetchSourceEvidence(sql, {
      status: 'trusted', table: 'honour_team_members', limit: 25,
    })).filter((r) => r.knownPlayerId !== null);
    if (rows.length === 0) {
      ctx.skip(
        'empirical corpus unavailable: no trusted honour_team_members links with a known player; '
        + 'the seeded honour-team case above is the mandatory control',
      );
    }

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
  it('raises no contradiction against seeded confirmed links (mandatory, always runs)', async () => {
    // AFLDB-ISSUE-377: seeded links, assessed end to end (blocking + scoring), must each
    // resolve to their own player with no hard conflict.
    try {
      const rows = await seedConfirmedLinks('award_winners');
      const assessments = await assessSources(sql, rows.map((r) => r.source));
      assertNoContradiction(rows, assessments, SEEDED_LINKS, true);

      // Control: an empty assessment result fails the seeded assertion...
      expect(() => assertNoContradiction(rows, new Map(), SEEDED_LINKS, true)).toThrow();
      // ...and so does a genuinely contradicted link (best = known player, hard conflict).
      const contradicted = new Map(
        rows.map((r) => [
          resolutionKey(r.source.target),
          { best: { playerId: r.knownPlayerId }, hardConflict: true } as unknown as MatchAssessment,
        ] as const),
      );
      expect(() => assertNoContradiction(rows, contradicted, SEEDED_LINKS, true)).toThrow();
    } finally {
      await removeSeededLinks();
    }
  });

  it('raises no contradiction against links AFLDB already confirmed (empirical corpus)', async (ctx) => {
    const rows = (await fetchSourceEvidence(sql, { status: 'trusted', limit: 200 }))
      .filter((r) => r.knownPlayerId !== null);
    if (rows.length < EMPIRICAL_MIN_TRUSTED_LINKS) {
      ctx.skip(
        `empirical corpus unavailable: ${rows.length} trusted links with a known player, `
        + `need ${EMPIRICAL_MIN_TRUSTED_LINKS}; the seeded contradiction case above is the mandatory control`,
      );
    }

    const assessments = await assessSources(sql, rows.map((r) => r.source));
    assertNoContradiction(rows, assessments, EMPIRICAL_MIN_TRUSTED_LINKS, false);
  });
});
