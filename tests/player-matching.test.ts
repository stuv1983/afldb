import { afterEach, describe, expect, it } from 'vitest';

import {
  clubTextCalibration,
  clubTextWeights,
  policySnapshot,
  setClubTextCalibration,
} from '@/lib/player-matching/calibration';
import { ALGORITHM_VERSION, assessMatch, MATCH_POLICY } from '@/lib/player-matching/confidence';
import { parseCareerSpan } from '@/lib/player-matching/parse-career-span';
import {
  buildClubTextIndex,
  normaliseClubText,
  resolveClubText,
  splitClubText,
} from '@/lib/player-matching/club-identity';
import { scoreCandidate } from '@/lib/player-matching/score-candidate';
import {
  applyClubTextCalibration,
  describeClubTextCalibration,
  parseClubTextCalibration,
} from '../tools/matching/policy-options';
import {
  getLinkUniquenessScope,
  resolutionKey,
  type CandidateEvidence,
  type SourceEvidence,
  type TemporalEvidence,
} from '@/lib/player-matching/types';

/**
 * The deterministic matching core (migration 067, /admin/player-links).
 *
 * These are pure-function tests on purpose: the same scoring module runs
 * on the admin page, inside the import transaction that approves a
 * suggestion, and in the offline backtest whose precision figures
 * justify bulk approval. If those three ever disagreed, a measured
 * precision would stop meaning anything, so the rules are pinned here
 * rather than only observed in aggregate.
 */

const W = MATCH_POLICY.scoring;

function source(overrides: Partial<SourceEvidence> = {}): SourceEvidence {
  return {
    target: {
      targetTable: 'award_winners',
      targetId: 1,
      resolutionEntityType: 'award_winners',
      resolutionEntityId: 1,
    },
    rawName: 'John Smith',
    normalisedName: 'john smith',
    temporal: [],
    clubId: null,
    clubOrganizationId: null,
    clubMatch: 'lineage',
    clubNameRaw: null,
    resolvedClubs: [],
    reportedGames: null,
    reportedGoals: null,
    context: 'Test award',
    linkStatus: 'unmatched',
    uniquenessScope: { kind: 'none' },
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    playerId: 100,
    displayName: 'John Smith',
    searchName: 'john smith',
    aliasSearchNames: [],
    nameSimilarity: 1,
    givenName: 'John',
    surname: 'Smith',
    debutSeason: 1990,
    finalSeason: 1999,
    careerGames: 150,
    careerGoals: 60,
    clubs: [{ clubId: 7, organizationId: null, games: 150, firstSeason: 1990, lastSeason: 1999 }],
    clubHistoryComplete: true,
    uniquenessConflict: null,
    ...overrides,
  };
}

const activeSeason = (season: number, scope: 'afldb' | 'external' = 'afldb'): TemporalEvidence =>
  ({ kind: 'active_season', season, competitionScope: scope });

function signals(scored: { evidence: { signal: string }[] }): string[] {
  return scored.evidence.map((e) => e.signal);
}

describe('name evidence', () => {
  it('pays for an exact normalised name', () => {
    const scored = scoreCandidate(source(), candidate());
    expect(signals(scored)).toEqual(['name_exact']);
    expect(scored.score).toBe(W.name.exact);
  });

  it('pays once, not once per matching name signal', () => {
    // An exact name is also a perfect trigram match and a surname +
    // initial match. Only the strongest may score, or one fact would be
    // paid for three times.
    const scored = scoreCandidate(source(), candidate({ nameSimilarity: 1 }));
    const nameSignals = scored.evidence.filter((e) => e.family === 'name');
    expect(nameSignals).toHaveLength(1);
    expect(nameSignals[0].signal).toBe('name_exact');
  });

  it('accepts an exact alias when the display name differs', () => {
    const scored = scoreCandidate(
      source({ normalisedName: 'jack smith' }),
      candidate({ aliasSearchNames: ['jack smith'], nameSimilarity: 0.4 }),
    );
    expect(signals(scored)).toEqual(['name_alias_exact']);
    expect(scored.strongName).toBe(true);
  });

  it('grades trigram similarity into high and medium', () => {
    const high = scoreCandidate(
      source({ normalisedName: 'jon smith' }),
      candidate({ searchName: 'john smith', nameSimilarity: 0.92 }),
    );
    expect(signals(high)).toEqual(['name_trigram_high']);

    const medium = scoreCandidate(
      source({ normalisedName: 'jonathon smithe' }),
      candidate({ searchName: 'john smith', nameSimilarity: 0.78 }),
    );
    expect(signals(medium)).toEqual(['name_trigram_medium']);
  });

  it('matches a surname with a compatible initial', () => {
    const scored = scoreCandidate(
      source({ normalisedName: 'j smith' }),
      candidate({ nameSimilarity: 0.5 }),
    );
    expect(signals(scored)).toEqual(['name_surname_initial']);
  });

  it('rejects the same surname with an incompatible first name', () => {
    const scored = scoreCandidate(
      source({ normalisedName: 'peter smith' }),
      candidate({ nameSimilarity: 0.5 }),
    );
    expect(scored.evidence.filter((e) => e.family === 'name')).toHaveLength(0);
  });

  it('never calls fuzzy-only name evidence strong', () => {
    const scored = scoreCandidate(
      source({ normalisedName: 'jon smith' }),
      candidate({ nameSimilarity: 0.95 }),
    );
    expect(scored.strongName).toBe(false);
  });
});

/**
 * AFLDB-ISSUE-164 P1a. The normaliser itself is SQL and is proven in
 * tests/integration/player-matching.test.ts against the real function.
 * What belongs here is the consequence: the scorer's verdict on the two
 * strings the normaliser can hand it for the same visual name.
 */
describe('Unicode whitespace in source names', () => {
  /** U+00A0 NO-BREAK SPACE, built by code point so it stays visible in this file. */
  const NBSP = String.fromCharCode(0x00a0);

  const draftRow = () => source({
    rawName: `Aaron${NBSP}Cadman`,
    clubId: 7,
    temporal: [{ kind: 'draft_year', year: 2022 }],
    reportedGames: 150,
    reportedGoals: 60,
  });
  const player = () => candidate({
    displayName: 'Aaron Cadman',
    searchName: 'aaron cadman',
    debutSeason: 2023,
    finalSeason: 2032,
  });

  it('paid a preserved U+00A0 as a fuzzy name, capping the draft row at 79', () => {
    // The defect, pinned so the composition ISSUE-164 P0 measured stays
    // legible: the strings are visually identical and similarity is
    // 1.00, but they are not byte-equal, so the exact arm cannot fire.
    const scored = scoreCandidate(
      source({ ...draftRow(), normalisedName: `aaron${NBSP}cadman` }),
      player(),
    );
    expect(signals(scored)).toEqual([
      'name_trigram_high', 'club_anywhere', 'draft_year_before_debut',
      'draft_games_exact', 'draft_goals_exact',
    ]);
    expect(scored.score).toBe(79);
    expect(scored.strongName).toBe(false);
  });

  it('pays the canonicalised name as exact, the same as its ASCII form', () => {
    // Migration 099 canonicalises U+00A0 to an ordinary space, so the
    // source normalises to the byte-equal 'aaron cadman'. Only the name
    // family moves: 26 -> 44, and the row becomes strongly named.
    const scored = scoreCandidate(
      source({ ...draftRow(), normalisedName: 'aaron cadman' }),
      player(),
    );
    expect(signals(scored)).toEqual([
      'name_exact', 'club_anywhere', 'draft_year_before_debut',
      'draft_games_exact', 'draft_goals_exact',
    ]);
    expect(scored.score).toBe(97);
    expect(scored.strongName).toBe(true);
  });

  it('ships the changed matching semantics under a new algorithm version', () => {
    // Every cached v1 suggestion is stale the moment 099 lands; the
    // version string is what makes that visible rather than silent.
    expect(ALGORITHM_VERSION).toBe('v3');
  });
});

describe('club text resolution (D-4, read time, exact only)', () => {
  // A slice of the real shapes in data/awards/hall-of-fame.csv and
  // data/awards/honour-teams.csv: pipe-separated Hall of Fame lists,
  // comma-separated honour-team lists, competition tags, parentheticals
  // and a long tail of SANFL/WAFL/Tasmanian clubs AFLDB does not hold.
  const CARLTON = 2;
  const FOOTSCRAY = 5;
  const WESTERN_BULLDOGS = 6;
  const BULLDOGS_ORG = 6;
  const BEARS = 10;
  const LIONS = 11;

  const index = buildClubTextIndex([
    { text: 'Carlton', clubId: CARLTON, organizationId: CARLTON },
    { text: 'Footscray', clubId: FOOTSCRAY, organizationId: BULLDOGS_ORG },
    { text: 'Western Bulldogs', clubId: WESTERN_BULLDOGS, organizationId: BULLDOGS_ORG },
    { text: 'Bulldogs', clubId: WESTERN_BULLDOGS, organizationId: BULLDOGS_ORG },
    // The genuinely ambiguous string: two organizations, one short name.
    { text: 'Brisbane', clubId: BEARS, organizationId: BEARS },
    { text: 'Brisbane', clubId: LIONS, organizationId: LIONS },
    { text: 'Fremantle', clubId: 17, organizationId: 17 },
  ]);

  const orgs = (raw: string | null) =>
    resolveClubText(raw, index).map((c) => c.organizationId);

  it('normalises case and Unicode whitespace, and nothing else', () => {
    expect(normaliseClubText('  Western   Bulldogs ')).toBe('western bulldogs');
    expect(normaliseClubText('Western Bulldogs')).toBe('western bulldogs');
    expect(normaliseClubText('Fremantle (1882)')).toBe('fremantle (1882)');
  });

  it('splits on the separators both sources actually use', () => {
    expect(splitClubText('Collingwood | Fitzroy')).toEqual(['Collingwood', 'Fitzroy']);
    expect(splitClubText('Claremont, North Melbourne, St Kilda'))
      .toEqual(['Claremont', 'North Melbourne', 'St Kilda']);
  });

  it('resolves an exact club name', () => {
    expect(orgs('Carlton')).toEqual([CARLTON]);
  });

  it('resolves every identity of a lineage to the same continuing club', () => {
    expect(orgs('Footscray')).toEqual([BULLDOGS_ORG]);
    expect(orgs('Western Bulldogs')).toEqual([BULLDOGS_ORG]);
    expect(orgs('Bulldogs')).toEqual([BULLDOGS_ORG]);
  });

  it('keeps a multi-club field multi-club', () => {
    expect(orgs('Footscray | Carlton')).toEqual([BULLDOGS_ORG, CARLTON]);
  });

  it('reports one continuing club once, however many identities it names', () => {
    expect(orgs('Western Bulldogs | Footscray')).toEqual([BULLDOGS_ORG]);
  });

  it('drops a competition tag rather than guessing at it', () => {
    expect(orgs('Carlton, VFL')).toEqual([CARLTON]);
    expect(orgs('Norwood, SANFL, ANFC')).toEqual([]);
  });

  it('fails closed on text that names two continuing clubs', () => {
    // Brisbane Bears and Brisbane Lions are separate organizations, so
    // "Brisbane" cannot be resolved to either without inventing a fact.
    expect(orgs('Brisbane')).toEqual([]);
  });

  it('resolves nothing for a club AFLDB does not hold', () => {
    expect(orgs('Norwood | Sturt')).toEqual([]);
    expect(orgs('former coach of North Melbourne')).toEqual([]);
    expect(orgs('')).toEqual([]);
    expect(orgs(null)).toEqual([]);
  });

  it('never resolves a near miss', () => {
    // Trigram resolution would turn each of these into a real club.
    expect(orgs('Carltonn')).toEqual([]);
    expect(orgs('West Bulldogs')).toEqual([]);
    expect(orgs('South Adelaide')).toEqual([]);
  });

  it('does not strip a parenthetical that changes which club is meant', () => {
    // "Fremantle (1882)" is an 1882 Victorian club, not the AFL one.
    expect(orgs('Fremantle (1882)')).toEqual([]);
    expect(orgs('Fremantle')).toEqual([17]);
  });

  it('resolves a bracketed former identity of the same continuing club', () => {
    // "Western Bulldogs (Footscray)" is the form twelve Hall of Fame
    // rows use. Both halves are canonical clubs of one lineage.
    const resolved = resolveClubText('Western Bulldogs (Footscray)', index);
    expect(resolved.map((c) => c.organizationId)).toEqual([BULLDOGS_ORG]);
    expect(resolved[0].clubIds).toEqual([FOOTSCRAY, WESTERN_BULLDOGS]);
  });

  it('refuses a bracketed form whose halves are not one continuing club', () => {
    expect(orgs('Carlton (Footscray)')).toEqual([]);
    expect(orgs('Fremantle (1882)')).toEqual([]);
    expect(orgs('Glenorchy (New Town)')).toEqual([]);
  });

  it('is order-independent and deterministic', () => {
    expect(orgs('Footscray | Carlton')).toEqual(orgs('Footscray | Carlton'));
  });
});

describe('club lineage (S1)', () => {
  // player_clubs records the identity played under. A source row naming
  // another identity of the same continuing club is the same club, and
  // AFLDB has exactly these cases: Footscray/Western Bulldogs, South
  // Melbourne/Sydney, North Melbourne/Kangaroos. Fitzroy is a lineage of
  // its own, because a merger is not a rename.
  const FOOTSCRAY = 5;
  const WESTERN_BULLDOGS = 6;
  const BULLDOGS_ORG = 6;
  const FITZROY = 9;
  const FITZROY_ORG = 9;
  const BRISBANE_LIONS_ORG = 11;

  const footscrayCareer = () =>
    candidate({
      clubs: [{
        clubId: FOOTSCRAY,
        organizationId: BULLDOGS_ORG,
        games: 150,
        firstSeason: 1990,
        lastSeason: 1999,
      }],
    });

  const bulldogsSource = () =>
    source({
      clubId: WESTERN_BULLDOGS,
      clubOrganizationId: BULLDOGS_ORG,
      clubNameRaw: 'Western Bulldogs',
      temporal: [activeSeason(1994)],
    });

  it('matches a source club to the same continuing club under an older identity', () => {
    const scored = scoreCandidate(bulldogsSource(), footscrayCareer());
    expect(signals(scored)).toContain('club_in_season');
  });

  it('raises no club contradiction against the same continuing club', () => {
    // The v2 rule compared clubs.id and called this "never played for
    // Western Bulldogs" against a complete Footscray career.
    const scored = scoreCandidate(bulldogsSource(), footscrayCareer());
    expect(scored.conflicts.map((c) => c.reason)).not.toContain('club_not_in_history');
    expect(scored.conflicts).toEqual([]);
  });

  it('still contradicts a genuinely different club', () => {
    const scored = scoreCandidate(
      source({
        clubId: FITZROY,
        clubOrganizationId: FITZROY_ORG,
        clubNameRaw: 'Fitzroy',
        temporal: [activeSeason(1994)],
      }),
      footscrayCareer(),
    );
    expect(scored.conflicts.map((c) => c.reason)).toContain('club_not_in_history');
  });

  it('does not treat a merger as lineage: Fitzroy is not Brisbane Lions', () => {
    // migration 017 keeps them separate organizations on purpose --
    // Fitzroy's record stays Fitzroy's -- so a Fitzroy source row must
    // not be corroborated by a Brisbane Lions career.
    const scored = scoreCandidate(
      source({ clubId: FITZROY, clubOrganizationId: FITZROY_ORG, temporal: [activeSeason(1994)] }),
      candidate({
        clubs: [{
          clubId: 11,
          organizationId: BRISBANE_LIONS_ORG,
          games: 150,
          firstSeason: 1990,
          lastSeason: 1999,
        }],
      }),
    );
    expect(signals(scored)).not.toContain('club_in_season');
    expect(signals(scored)).not.toContain('club_anywhere');
    expect(scored.conflicts.map((c) => c.reason)).toContain('club_not_in_history');
  });

  it('falls back to the raw club id when AFLDB records no lineage', () => {
    const scored = scoreCandidate(
      source({ clubId: 7, clubOrganizationId: null, temporal: [activeSeason(1994)] }),
      candidate(),
    );
    expect(signals(scored)).toContain('club_in_season');
  });

  it('still scores one club signal, never two', () => {
    const scored = scoreCandidate(
      source({
        clubId: WESTERN_BULLDOGS,
        clubOrganizationId: BULLDOGS_ORG,
        clubNameRaw: 'Western Bulldogs',
        resolvedClubs: [{ text: 'Footscray', clubIds: [FOOTSCRAY], organizationId: BULLDOGS_ORG }],
        temporal: [activeSeason(1994)],
      }),
      footscrayCareer(),
    );
    expect(scored.evidence.filter((e) => e.family === 'club')).toHaveLength(1);
  });
});

describe('club lineage scope: draft sources keep v2 semantics', () => {
  // S1 is authorised for non-draft sources in this tranche only.
  // Lineage-aware club matching moved draft_person scoring on the
  // unresolved queue -- 40 rows into Very High, 16 changed Top-1
  // suggestions -- and no labelled set covers draft identity well
  // enough to accept that yet. The lineage is still carried on the
  // row; the scorer simply may not consult it for draft sources.
  const FOOTSCRAY = 5;
  const WESTERN_BULLDOGS = 6;
  const BULLDOGS_ORG = 6;

  const draftSource = (overrides: Partial<SourceEvidence> = {}) =>
    source({
      target: {
        targetTable: 'draft_picks',
        targetId: 1,
        resolutionEntityType: 'draft_person',
        resolutionEntityId: 1,
      },
      clubId: WESTERN_BULLDOGS,
      clubOrganizationId: BULLDOGS_ORG,
      clubMatch: 'club_id',
      clubNameRaw: 'Western Bulldogs',
      temporal: [activeSeason(1994)],
      ...overrides,
    });

  const footscrayCareer = (overrides: Partial<CandidateEvidence> = {}) =>
    candidate({
      clubs: [{
        clubId: FOOTSCRAY,
        organizationId: BULLDOGS_ORG,
        games: 150,
        firstSeason: 1990,
        lastSeason: 1999,
      }],
      ...overrides,
    });

  it('does not credit a draft club through the continuing organization', () => {
    const scored = scoreCandidate(draftSource(), footscrayCareer());
    expect(signals(scored)).not.toContain('club_in_season');
    expect(signals(scored)).not.toContain('club_anywhere');
    expect(scored.evidence.filter((e) => e.family === 'club')).toEqual([]);
  });

  it('still credits a draft club on a raw club-id match', () => {
    const scored = scoreCandidate(
      draftSource({ clubId: FOOTSCRAY, clubNameRaw: 'Footscray' }),
      footscrayCareer(),
    );
    expect(signals(scored)).toContain('club_in_season');
  });

  it('preserves v2 draft contradiction semantics through the organization', () => {
    // v2 raised no club_not_in_history here either, because the source
    // names no AFLDB season the player was AT that club; what must not
    // happen is the lineage changing the answer in either direction.
    const withoutLineage = scoreCandidate(
      draftSource({ clubOrganizationId: null }),
      footscrayCareer({ clubHistoryComplete: true }),
    );
    const withLineage = scoreCandidate(
      draftSource(),
      footscrayCareer({ clubHistoryComplete: true }),
    );
    expect(withLineage.conflicts).toEqual(withoutLineage.conflicts);
    expect(withLineage.conflicts.map((c) => c.reason)).toContain('club_not_in_history');
  });

  it('scores identically whether or not the lineage is carried', () => {
    // The whole point of the gate: carrying organization_id on a draft
    // row must be inert. Score, signals, conflicts, gap and band all
    // stay exactly where v2 left them.
    const blind = scoreCandidate(
      draftSource({ clubOrganizationId: null }),
      footscrayCareer({ clubHistoryComplete: true }),
    );
    const carried = scoreCandidate(
      draftSource(),
      footscrayCareer({ clubHistoryComplete: true }),
    );
    expect(carried).toEqual(blind);
  });

  it('leaves non-draft sources lineage-aware', () => {
    // The scope gate is per source, not a global retreat from S1.
    const scored = scoreCandidate(
      source({
        clubId: WESTERN_BULLDOGS,
        clubOrganizationId: BULLDOGS_ORG,
        clubMatch: 'lineage',
        clubNameRaw: 'Western Bulldogs',
        temporal: [activeSeason(1994)],
      }),
      footscrayCareer(),
    );
    expect(signals(scored)).toContain('club_in_season');
  });
});

describe('club text evidence (S3/S4)', () => {
  const SOUTH_MELBOURNE = 15;
  const SYDNEY = 16;
  const SYDNEY_ORG = 16;

  const swansCareer = () =>
    candidate({
      clubs: [{
        clubId: SOUTH_MELBOURNE,
        organizationId: SYDNEY_ORG,
        games: 150,
        firstSeason: 1990,
        lastSeason: 1999,
      }],
    });

  const elsewhereCareer = () =>
    candidate({
      clubs: [{ clubId: 7, organizationId: 7, games: 150, firstSeason: 1990, lastSeason: 1999 }],
    });

  const hallOfFame = (overrides: Partial<SourceEvidence> = {}) =>
    source({
      target: {
        targetTable: 'hall_of_fame',
        targetId: 1,
        resolutionEntityType: 'hall_of_fame',
        resolutionEntityId: 1,
      },
      clubId: null,
      clubNameRaw: 'Sydney',
      resolvedClubs: [{ text: 'Sydney', clubIds: [SYDNEY], organizationId: SYDNEY_ORG }],
      temporal: [{ kind: 'active_range', first: 1990, last: 1999 }],
      ...overrides,
    });

  /**
   * P3B's grid selected 15/15, so the shipped policy now scores club
   * text. The cases below still declare their own weights where the
   * point is the selection logic rather than the number, so that a
   * future recalibration moves one shipped constant and not a suite.
   */
  function withClubTextWeights<T>(inSpan: number, anywhere: number, fn: () => T): T {
    setClubTextCalibration({ clubTextInSpan: inSpan, clubTextAnywhere: anywhere });
    try {
      return fn();
    } finally {
      setClubTextCalibration(null);
    }
  }

  it('scores club text at the shipped 15/15, with no override set', () => {
    expect(MATCH_POLICY.scoring.club.clubTextInSpan).toBe(15);
    expect(MATCH_POLICY.scoring.club.clubTextAnywhere).toBe(15);

    // S3: the club sits inside the span the source itself asserts.
    const inSpan = scoreCandidate(hallOfFame(), swansCareer());
    expect(signals(inSpan)).toContain('club_in_span');
    expect(inSpan.evidence.find((e) => e.family === 'club')?.points).toBe(15);

    // S4: no asserted span, so the weaker club-text signal applies.
    const anywhere = scoreCandidate(hallOfFame({ temporal: [] }), swansCareer());
    expect(signals(anywhere)).toContain('club_text_anywhere');
    expect(anywhere.evidence.find((e) => e.family === 'club')?.points).toBe(15);
  });

  it('still scores exactly one club-family signal under the shipped policy', () => {
    const scored = scoreCandidate(hallOfFame(), swansCareer());
    expect(scored.evidence.filter((e) => e.family === 'club')).toHaveLength(1);
    expect(signals(scored)).not.toContain('club_text_anywhere');
  });

  it('shipped policy: unresolved club text scores nothing and conflicts with nothing', () => {
    // Most of a Hall of Fame club list is SANFL/WAFL/Tasmanian. Now that
    // the weight is non-zero, "not an AFLDB club" must still be silence.
    const scored = scoreCandidate(
      hallOfFame({ clubNameRaw: 'Norwood | Sturt', resolvedClubs: [] }),
      swansCareer(),
    );
    expect(scored.evidence.filter((e) => e.family === 'club')).toEqual([]);
    expect(scored.conflicts).toEqual([]);
  });

  it('shipped policy: a club the candidate never played for raises no contradiction', () => {
    const scored = scoreCandidate(hallOfFame(), elsewhereCareer());
    expect(scored.evidence.filter((e) => e.family === 'club')).toEqual([]);
    expect(scored.conflicts).toEqual([]);
  });

  it('never raises a contradiction from club text, resolved or not', () => {
    for (const resolvedClubs of [[], hallOfFame().resolvedClubs]) {
      const scored = withClubTextWeights(20, 12, () =>
        scoreCandidate(hallOfFame({ resolvedClubs }), elsewhereCareer()));
      expect(scored.conflicts).toEqual([]);
    }
  });

  it('S3 credits a club inside the stated career span, through lineage', () => {
    const scored = withClubTextWeights(20, 12, () =>
      scoreCandidate(hallOfFame(), swansCareer()));
    expect(signals(scored)).toContain('club_in_span');
    expect(scored.evidence.find((e) => e.family === 'club')?.points).toBe(20);
  });

  it('S3 takes precedence over S4, and only one club signal scores', () => {
    const scored = withClubTextWeights(20, 12, () =>
      scoreCandidate(hallOfFame(), swansCareer()));
    expect(scored.evidence.filter((e) => e.family === 'club')).toHaveLength(1);
    expect(signals(scored)).not.toContain('club_text_anywhere');
  });

  it('S4 credits the club when it sits outside the stated span', () => {
    const scored = withClubTextWeights(20, 12, () => scoreCandidate(
      hallOfFame({ temporal: [{ kind: 'active_range', first: 1970, last: 1979 }] }),
      swansCareer(),
    ));
    expect(signals(scored)).toContain('club_text_anywhere');
  });

  it('S4 alone applies when the source states no span (honour teams)', () => {
    const scored = withClubTextWeights(20, 12, () =>
      scoreCandidate(hallOfFame({ temporal: [] }), swansCareer()));
    expect(signals(scored)).toContain('club_text_anywhere');
  });

  it('unresolved club text gives no signal and no conflict', () => {
    const scored = withClubTextWeights(20, 12, () => scoreCandidate(
      hallOfFame({ clubNameRaw: 'Norwood | Sturt', resolvedClubs: [] }),
      swansCareer(),
    ));
    expect(scored.evidence.filter((e) => e.family === 'club')).toEqual([]);
    expect(scored.conflicts).toEqual([]);
  });

  it('a club the candidate never played for is unknown, not disagreement', () => {
    const scored = withClubTextWeights(20, 12, () =>
      scoreCandidate(hallOfFame(), elsewhereCareer()));
    expect(scored.evidence.filter((e) => e.family === 'club')).toEqual([]);
    expect(scored.conflicts).toEqual([]);
  });

  it('credits a multi-club source row on whichever club the career shows', () => {
    const scored = withClubTextWeights(20, 12, () => scoreCandidate(
      hallOfFame({
        clubNameRaw: 'Collingwood | Sydney',
        resolvedClubs: [
          { text: 'Collingwood', clubIds: [3], organizationId: 3 },
          { text: 'Sydney', clubIds: [SYDNEY], organizationId: SYDNEY_ORG },
        ],
      }),
      swansCareer(),
    ));
    expect(scored.evidence.filter((e) => e.family === 'club')).toHaveLength(1);
    expect(scored.evidence.find((e) => e.family === 'club')?.detail).toContain('Sydney');
  });

  it('does not resolve club text when the source carries a club id', () => {
    // One club fact, one club signal: award and achievement rows carry
    // both a club_id and its printed name and must not pay twice.
    const scored = withClubTextWeights(20, 12, () => scoreCandidate(
      source({
        clubId: 7,
        clubNameRaw: 'Richmond',
        resolvedClubs: [],
        temporal: [activeSeason(1994)],
      }),
      candidate(),
    ));
    expect(scored.evidence.filter((e) => e.family === 'club')).toHaveLength(1);
    expect(signals(scored)).toContain('club_in_season');
  });
});

describe('S3/S4 calibration overrides (AFLDB-ISSUE-164 P3B)', () => {
  /**
   * The grid measured four candidate weight pairs against one database
   * and selected 15/15, which now ships. The mechanism stays for the
   * next such question, and what must remain impossible is a run whose
   * numbers came from an edit of confidence.ts, an environment
   * variable, or a half-declared pair -- and an override that leaks
   * into the shipped policy or outlives the run that declared it.
   */
  const SYDNEY = 16;
  const SYDNEY_ORG = 16;

  const swansCareer = () =>
    candidate({
      clubs: [{
        clubId: SYDNEY,
        organizationId: SYDNEY_ORG,
        games: 150,
        firstSeason: 1990,
        lastSeason: 1999,
      }],
    });

  const hallOfFame = (overrides: Partial<SourceEvidence> = {}) =>
    source({
      target: {
        targetTable: 'hall_of_fame',
        targetId: 1,
        resolutionEntityType: 'hall_of_fame',
        resolutionEntityId: 1,
      },
      clubId: null,
      clubNameRaw: 'Sydney',
      resolvedClubs: [{ text: 'Sydney', clubIds: [SYDNEY], organizationId: SYDNEY_ORG }],
      temporal: [{ kind: 'active_range', first: 1990, last: 1999 }],
      ...overrides,
    });

  afterEach(() => setClubTextCalibration(null));

  it('omitting the options leaves the shipped 15/15 policy', () => {
    expect(parseClubTextCalibration([])).toBeNull();
    const applied = applyClubTextCalibration(['--table', 'hall_of_fame', '--limit', '10']);
    expect(applied).toEqual({
      clubTextInSpan: 15,
      clubTextAnywhere: 15,
      source: 'shipped',
    });
    expect(clubTextWeights()).toEqual({ clubTextInSpan: 15, clubTextAnywhere: 15 });
    const scored = scoreCandidate(hallOfFame(), swansCareer());
    expect(signals(scored)).toContain('club_in_span');
    expect(scored.evidence.find((e) => e.family === 'club')?.points).toBe(15);
    // A shipped run reports the shipped numbers, not a leftover override.
    expect(policySnapshot().scoring.club.clubTextInSpan).toBe(15);
    expect(policySnapshot().scoring.club.clubTextAnywhere).toBe(15);
  });

  it('records an explicit 15/15 row as an override, not as the shipped default', () => {
    const applied = applyClubTextCalibration([
      '--club-text-in-span', '15', '--club-text-anywhere', '15', '--out', 'x.json',
    ]);
    expect(applied).toEqual({
      clubTextInSpan: 15,
      clubTextAnywhere: 15,
      source: 'calibration-override',
    });
    expect(clubTextCalibration()).toEqual(applied);
    expect(describeClubTextCalibration(applied)).toContain('S3 clubTextInSpan=15');
    expect(describeClubTextCalibration(applied)).toContain('S4 clubTextAnywhere=15');

    const scored = scoreCandidate(hallOfFame(), swansCareer());
    expect(signals(scored)).toContain('club_in_span');
    expect(scored.evidence.find((e) => e.family === 'club')?.points).toBe(15);
    // Recorded where a report reads it, not only where the scorer does.
    expect(policySnapshot().scoring.club.clubTextInSpan).toBe(15);
    expect(policySnapshot().scoring.club.clubTextAnywhere).toBe(15);
  });

  it('is deterministic: the same row scores the same twice', () => {
    for (const [inSpan, anywhere] of [[23, 15], [24, 15], [29, 15]] as const) {
      applyClubTextCalibration([
        '--club-text-in-span', String(inSpan), '--club-text-anywhere', String(anywhere),
      ]);
      const first = scoreCandidate(hallOfFame(), swansCareer());
      const second = scoreCandidate(hallOfFame(), swansCareer());
      expect(second).toEqual(first);
      expect(first.evidence.find((e) => e.family === 'club')?.points).toBe(inSpan);
      // S4 is what a source stating no span can reach.
      const noSpan = scoreCandidate(hallOfFame({ temporal: [] }), swansCareer());
      expect(signals(noSpan)).toContain('club_text_anywhere');
      expect(noSpan.evidence.find((e) => e.family === 'club')?.points).toBe(anywhere);
    }
  });

  it('fails closed on a malformed, negative or half-declared pair', () => {
    const bad: string[][] = [
      ['--club-text-in-span', '15'],
      ['--club-text-anywhere', '15'],
      ['--club-text-in-span', '-5', '--club-text-anywhere', '15'],
      ['--club-text-in-span', 'fifteen', '--club-text-anywhere', '15'],
      ['--club-text-in-span', '15.5', '--club-text-anywhere', '15'],
      ['--club-text-in-span', '1e1', '--club-text-anywhere', '15'],
      ['--club-text-in-span', '', '--club-text-anywhere', '15'],
      ['--club-text-in-span', '101', '--club-text-anywhere', '15'],
      // The flag swallowing the next option is a typo, not a weight.
      ['--club-text-in-span', '--club-text-anywhere', '15'],
      ['--club-text-in-span', '15', '--club-text-anywhere'],
    ];
    for (const argv of bad) {
      expect(() => parseClubTextCalibration(argv), argv.join(' ')).toThrow();
    }
    // A refused run never leaves a partial policy behind.
    expect(clubTextWeights()).toEqual({ clubTextInSpan: 15, clubTextAnywhere: 15 });
    expect(() => setClubTextCalibration({ clubTextInSpan: -1, clubTextAnywhere: 15 })).toThrow();
    expect(() => setClubTextCalibration(
      { clubTextInSpan: Number.NaN, clubTextAnywhere: 15 })).toThrow();
    expect(clubTextWeights()).toEqual({ clubTextInSpan: 15, clubTextAnywhere: 15 });
  });

  it('never moves the shipped policy, whatever a calibration run declares', () => {
    applyClubTextCalibration(['--club-text-in-span', '29', '--club-text-anywhere', '15']);
    // MATCH_POLICY is what the application, the admin page and the
    // approval path read through. The override may not reach it.
    expect(MATCH_POLICY.scoring.club.clubTextInSpan).toBe(15);
    expect(MATCH_POLICY.scoring.club.clubTextAnywhere).toBe(15);
    expect(scoreCandidate(hallOfFame(), swansCareer())
      .evidence.find((e) => e.family === 'club')?.points).toBe(29);

    // Reset returns to the shipped pair, not to "not scored".
    setClubTextCalibration(null);
    expect(clubTextCalibration()).toEqual({
      clubTextInSpan: 15,
      clubTextAnywhere: 15,
      source: 'shipped',
    });
    expect(scoreCandidate(hallOfFame(), swansCareer())
      .evidence.find((e) => e.family === 'club')?.points).toBe(15);
  });

  it('leaves draft scoring untouched at every grid weight (D-9 scope)', () => {
    // Draft rows carry a club_id and no resolved club text, so S3/S4 are
    // unreachable for them by construction. Pinned rather than assumed:
    // the grid must not move a single draft number.
    const draftSource = () =>
      source({
        target: {
          targetTable: 'draft_picks',
          targetId: 1,
          resolutionEntityType: 'draft_person',
          resolutionEntityId: 1,
        },
        clubId: SYDNEY,
        clubOrganizationId: SYDNEY_ORG,
        clubMatch: 'club_id',
        clubNameRaw: 'Sydney',
        temporal: [activeSeason(1994), { kind: 'draft_year', year: 1989 }],
        reportedGames: 150,
        reportedGoals: 60,
      });

    const shipped = scoreCandidate(draftSource(), swansCareer());
    for (const [inSpan, anywhere] of [[15, 15], [23, 15], [24, 15], [29, 15]] as const) {
      applyClubTextCalibration([
        '--club-text-in-span', String(inSpan), '--club-text-anywhere', String(anywhere),
      ]);
      expect(scoreCandidate(draftSource(), swansCareer())).toEqual(shipped);
    }
  });
});

describe('club and era evidence', () => {
  it('rewards a club corroborated in the source season, not both club signals', () => {
    const scored = scoreCandidate(
      source({ clubId: 7, clubNameRaw: 'Richmond', temporal: [activeSeason(1994)] }),
      candidate(),
    );
    expect(signals(scored)).toEqual(['name_exact', 'club_in_season', 'era_season_in_career']);
    expect(scored.evidence.filter((e) => e.family === 'club')).toHaveLength(1);
    expect(scored.score).toBe(W.name.exact + W.club.clubSeason + W.era.seasonInCareer);
  });

  it('falls back to club-anywhere when the season is not covered', () => {
    const scored = scoreCandidate(
      source({ clubId: 7, temporal: [] }),
      candidate(),
    );
    expect(signals(scored)).toEqual(['name_exact', 'club_anywhere']);
  });

  it('grades a season just outside the career as near, not inside', () => {
    const scored = scoreCandidate(
      source({ temporal: [activeSeason(2000)] }),
      candidate(),
    );
    expect(signals(scored)).toEqual(['name_exact', 'era_season_near_career']);
  });

  it('gives no era credit when AFLDB does not know the career range', () => {
    const scored = scoreCandidate(
      source({ temporal: [activeSeason(1994)] }),
      candidate({ debutSeason: null, finalSeason: null }),
    );
    expect(signals(scored)).toEqual(['name_exact']);
  });
});

describe('temporal semantics', () => {
  it('treats a Hall of Fame induction year as no evidence at all', () => {
    // Induction happens long after retirement. It must neither pay nor
    // contradict, which is the whole reason the evidence is typed.
    const scored = scoreCandidate(
      source({ temporal: [{ kind: 'induction_year', year: 1996 }] }),
      candidate(),
    );
    expect(signals(scored)).toEqual(['name_exact']);
    expect(scored.conflicts).toHaveLength(0);
  });

  it('reads a draft year as preceding the debut, not as a playing season', () => {
    const scored = scoreCandidate(
      source({ temporal: [{ kind: 'draft_year', year: 1989 }] }),
      candidate(),
    );
    expect(signals(scored)).toEqual(['name_exact', 'draft_year_before_debut']);
    expect(scored.conflicts).toHaveLength(0);
  });

  it('gives no draft credit when the debut precedes the draft', () => {
    const scored = scoreCandidate(
      source({ temporal: [{ kind: 'draft_year', year: 1995 }] }),
      candidate({ debutSeason: 1990 }),
    );
    expect(signals(scored)).toEqual(['name_exact']);
  });

  it('scores an exact Hall of Fame career span above an overlapping one', () => {
    const exact = scoreCandidate(
      source({ temporal: [{ kind: 'active_range', first: 1990, last: 1999 }] }),
      candidate(),
    );
    expect(signals(exact)).toEqual(['name_exact', 'career_span_exact']);

    const overlap = scoreCandidate(
      source({ temporal: [{ kind: 'active_range', first: 1995, last: 2004 }] }),
      candidate(),
    );
    expect(signals(overlap)).toEqual(['name_exact', 'career_span_overlap']);
    expect(overlap.score).toBeLessThan(exact.score);
  });
});

describe('draft-source career totals', () => {
  it('rewards exact games and goals as separate signals', () => {
    const scored = scoreCandidate(
      source({ reportedGames: 150, reportedGoals: 60 }),
      candidate(),
    );
    expect(signals(scored)).toEqual(['name_exact', 'draft_games_exact', 'draft_goals_exact']);
  });

  it('rewards near values less than exact ones', () => {
    const scored = scoreCandidate(
      source({ reportedGames: 152, reportedGoals: 58 }),
      candidate(),
    );
    expect(signals(scored)).toEqual(['name_exact', 'draft_games_near', 'draft_goals_near']);
  });

  it('counts games and goals as ONE independent family', () => {
    // Both come from the same external record, so they corroborate each
    // other only in the sense that a source agrees with itself.
    const scored = scoreCandidate(
      source({ reportedGames: 150, reportedGoals: 60 }),
      candidate(),
    );
    expect(scored.corroboratingFamilies).toBe(2); // name + draft stats
  });

  it('treats a wildly different reported games count as no evidence, not a conflict', () => {
    // Draft sources count their own way; migration 019 says the column
    // is never a career statistic. Disagreement is silence.
    const scored = scoreCandidate(
      source({ reportedGames: 9 }),
      candidate({ careerGames: 250 }),
    );
    expect(signals(scored)).toEqual(['name_exact']);
    expect(scored.conflicts).toHaveLength(0);
  });
});

describe('hard conflicts', () => {
  it('contradicts a season well outside a complete AFLDB career', () => {
    const scored = scoreCandidate(
      source({ temporal: [activeSeason(1975)] }),
      candidate(),
    );
    expect(scored.hardConflict).toBe(true);
    expect(scored.conflicts[0].reason).toBe('season_outside_career');
  });

  it('will not contradict from an external competition season', () => {
    // A Sandover or Magarey Medal season says nothing about whether the
    // player had a VFL season that year. Every one of the 101 era
    // contradictions the first backtest raised against a known-correct
    // link was of exactly this kind.
    const scored = scoreCandidate(
      source({ temporal: [activeSeason(1975, 'external')] }),
      candidate(),
    );
    expect(scored.hardConflict).toBe(false);
  });

  it('will not contradict when the career range is not backed by games', () => {
    const scored = scoreCandidate(
      source({ temporal: [activeSeason(1975)] }),
      candidate({ careerGames: null }),
    );
    expect(scored.hardConflict).toBe(false);
  });

  it('contradicts a club absent from a complete history in an AFLDB season', () => {
    const scored = scoreCandidate(
      source({ clubId: 12, clubNameRaw: 'Carlton', temporal: [activeSeason(1994)] }),
      candidate(),
    );
    expect(scored.conflicts.map((c) => c.reason)).toContain('club_not_in_history');
  });

  it('will not contradict a club when the source names no AFLDB season', () => {
    // A draft pick names the club that DRAFTED the player, who may never
    // have played a senior game for it: 249 of the 252 club objections
    // the first backtest raised were against correct links for this
    // exact reason.
    const scored = scoreCandidate(
      source({ clubId: 12, temporal: [{ kind: 'draft_year', year: 1989 }] }),
      candidate(),
    );
    expect(scored.hardConflict).toBe(false);
  });

  it('will not contradict a club when the history is incomplete', () => {
    const scored = scoreCandidate(
      source({ clubId: 12, temporal: [activeSeason(1994)] }),
      candidate({ clubHistoryComplete: false }),
    );
    expect(scored.hardConflict).toBe(false);
  });

  it('carries a uniqueness collision through as a conflict', () => {
    const scored = scoreCandidate(
      source(),
      candidate({ uniquenessConflict: 'already holds a place in Team of the Century' }),
    );
    expect(scored.conflicts[0].reason).toBe('uniqueness_collision');
  });
});

describe('source-specific uniqueness scope', () => {
  it('scopes honour teams by team name', () => {
    expect(getLinkUniquenessScope('honour_team_members', 'Team of the Century'))
      .toEqual({ kind: 'honour_team', teamName: 'Team of the Century' });
  });

  it('does not scope awards, captaincies or achievements', () => {
    // One player legitimately wins many awards and captains many
    // seasons. Treating that as a collision would block correct links.
    for (const table of ['award_winners', 'captaincies', 'player_achievements', 'draft_picks'] as const) {
      expect(getLinkUniquenessScope(table, 'anything')).toEqual({ kind: 'none' });
    }
  });
});

describe('draft logical resolution identity', () => {
  it('keys a draft pick on its draft person, not the pick', () => {
    const key = resolutionKey({
      targetTable: 'draft_picks',
      targetId: 24668,
      resolutionEntityType: 'draft_person',
      resolutionEntityId: 991,
    });
    expect(key).toBe('draft_person:991');
  });

  it('keys every other table on the row itself', () => {
    const key = resolutionKey({
      targetTable: 'captaincies',
      targetId: 3230,
      resolutionEntityType: 'captaincies',
      resolutionEntityId: 3230,
    });
    expect(key).toBe('captaincies:3230');
  });
});

describe('career span parsing', () => {
  it('reads the shapes the Hall of Fame data actually uses', () => {
    expect(parseCareerSpan('1992-2007')).toEqual({ first: 1992, last: 2007 });
    expect(parseCareerSpan('1961-1972, 1973-1975')).toEqual({ first: 1961, last: 1975 });
    expect(parseCareerSpan('1997, 1998-2013')).toEqual({ first: 1997, last: 2013 });
    // Spans are not always in order in the source.
    expect(parseCareerSpan('1962-1965, 1967-1974, 1966')).toEqual({ first: 1962, last: 1974 });
    // Two-digit end years.
    expect(parseCareerSpan('1974-78, 1984-88')).toEqual({ first: 1974, last: 1988 });
    // A span that crosses a century boundary.
    expect(parseCareerSpan('1898-01')).toEqual({ first: 1898, last: 1901 });
  });

  it('returns nothing rather than guessing', () => {
    for (const input of [null, undefined, '', 'unknown', 'debut season', '12']) {
      expect(parseCareerSpan(input)).toBeNull();
    }
  });

  it('degrades to absent evidence, never to a contradiction', () => {
    const scored = scoreCandidate(
      source({ temporal: [] }),
      candidate(),
    );
    expect(scored.conflicts).toHaveLength(0);
    expect(scored.evidence.some((e) => e.family === 'career_span')).toBe(false);
  });
});

describe('assessment, gap and bands', () => {
  const rich = () =>
    source({ clubId: 7, clubNameRaw: 'Richmond', temporal: [activeSeason(1994)] });

  it('ranks deterministically and reports the gap to the runner-up', () => {
    const best = scoreCandidate(rich(), candidate());
    const rival = scoreCandidate(rich(), candidate({ playerId: 200, clubs: [], nameSimilarity: 1 }));
    const assessment = assessMatch([rival, best], 'award_winners');

    expect(assessment.best?.playerId).toBe(100);
    expect(assessment.gap).toBe(best.score - rival.score);
    expect(assessment.algorithmVersion).toBe(ALGORITHM_VERSION);
  });

  it('gives a lone candidate a null gap rather than a zero one', () => {
    // No rival is the least ambiguous case, not the most, and a zero
    // would read as a dead heat.
    const assessment = assessMatch([scoreCandidate(rich(), candidate())], 'award_winners');
    expect(assessment.gap).toBeNull();
    expect(assessment.band).toBe('very_high');
  });

  it('flags two near-identical candidates as ambiguous and refuses bulk', () => {
    const a = scoreCandidate(rich(), candidate({ playerId: 100 }));
    const b = scoreCandidate(rich(), candidate({ playerId: 200 }));
    const assessment = assessMatch([a, b], 'award_winners');

    expect(assessment.gap).toBe(0);
    expect(assessment.nearTies).toBe(1);
    expect(assessment.ambiguous).toBe(true);
    expect(assessment.bulkEligible).toBe(false);
  });

  it('caps a contradicted candidate below the approvable bands', () => {
    const conflicted = scoreCandidate(
      rich(),
      candidate({ uniquenessConflict: 'already in that team' }),
    );
    const assessment = assessMatch([conflicted], 'award_winners');

    expect(conflicted.score).toBeGreaterThanOrEqual(MATCH_POLICY.bands.veryHighScore);
    expect(assessment.band).toBe('low');
    expect(assessment.bulkEligible).toBe(false);
  });

  it('reports no band and no candidate for an empty set', () => {
    const assessment = assessMatch([], 'award_winners');
    expect(assessment.best).toBeNull();
    expect(assessment.band).toBe('none');
    expect(assessment.bulkEligible).toBe(false);
  });
});

describe('bulk eligibility is stricter than the display band', () => {
  it('accepts a fully corroborated, exactly named, unrivalled match', () => {
    const scored = scoreCandidate(
      source({ clubId: 7, clubNameRaw: 'Richmond', temporal: [activeSeason(1994)] }),
      candidate(),
    );
    const assessment = assessMatch([scored], 'award_winners');
    expect(assessment.band).toBe('very_high');
    expect(assessment.bulkEligible).toBe(true);
  });

  it('refuses a name-only match however unrivalled', () => {
    // The queue is full of state-league footballers who share a name
    // with an AFL player and have no AFLDB record of their own. A name
    // agreeing with itself is not corroboration.
    const assessment = assessMatch([scoreCandidate(source(), candidate())], 'award_winners');
    expect(assessment.bulkEligible).toBe(false);
  });

  it('refuses a fuzzy name even when everything else corroborates', () => {
    const scored = scoreCandidate(
      source({
        normalisedName: 'jon smith',
        clubId: 7,
        clubNameRaw: 'Richmond',
        temporal: [activeSeason(1994)],
      }),
      candidate({ nameSimilarity: 0.95 }),
    );
    const assessment = assessMatch([scored], 'award_winners');
    expect(assessment.best?.strongName).toBe(false);
    expect(assessment.bulkEligible).toBe(false);
  });

  it('refuses anything the policy floor does not clear', () => {
    const scored = scoreCandidate(
      source({ clubId: 7, temporal: [] }),
      candidate(),
    );
    const assessment = assessMatch([scored], 'award_winners');
    expect(scored.score).toBeLessThan(MATCH_POLICY.bulk.minScore);
    expect(assessment.bulkEligible).toBe(false);
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const s = source({ clubId: 7, temporal: [activeSeason(1994)] });
    const c = candidate();
    expect(JSON.stringify(scoreCandidate(s, c))).toBe(JSON.stringify(scoreCandidate(s, c)));
  });

  it('does not depend on the order candidates arrive in', () => {
    const s = source({ clubId: 7, temporal: [activeSeason(1994)] });
    const a = scoreCandidate(s, candidate({ playerId: 100 }));
    const b = scoreCandidate(s, candidate({ playerId: 200, clubs: [] }));
    expect(assessMatch([a, b], 'award_winners')).toEqual(assessMatch([b, a], 'award_winners'));
  });
});

describe('bulk eligibility is decided per source class', () => {
  const perfect = () =>
    scoreCandidate(
      source({ clubId: 7, clubNameRaw: 'Richmond', temporal: [activeSeason(1994)] }),
      candidate(),
    );

  it('admits the classes whose measured population showed no false positive', () => {
    // award_winners 2,750 bulk / 0 FP; award_nominations 702 / 0;
    // player_achievements 253 / 0.
    for (const sourceType of [
      'award_winners', 'award_nominations', 'player_achievements',
    ]) {
      const assessment = assessMatch([perfect()], sourceType);
      expect(assessment.band).toBe('very_high');
      expect(assessment.bulkEligible).toBe(true);
    }
  });

  it('suspends draft_person from unattended approval while still suggesting it', () => {
    // AFLDB-ISSUE-164 D-9. The 2,319-row admission is ISSUE-075
    // historical evidence the current backtest cannot reproduce -- the
    // executable baseline holds five labelled draft rows. Migration 099
    // lifts the whole NBSP-affected draft population to name_exact at
    // once, so the unattended path is closed until P1c re-gates the
    // class. The suggestion itself is unchanged.
    const assessment = assessMatch([perfect()], 'draft_person');
    expect(assessment.band).toBe('very_high');
    expect(assessment.bulkEligible).toBe(false);
  });

  it('keeps captaincies out of bulk while still suggesting it', () => {
    // A club's recorded captain and the player who actually led the
    // side can legitimately differ (captaincies#3230 names Jobe Watson
    // where AFLDB links Brendon Goddard, who captained while Watson was
    // suspended). Nothing available to the matcher separates that row
    // from a correct one, so a human decides it.
    const assessment = assessMatch([perfect()], 'captaincies');
    expect(assessment.band).toBe('very_high');
    expect(assessment.bulkEligible).toBe(false);
  });

  it('keeps classes with no measured bulk population out of bulk', () => {
    // Zero failures out of zero rows is not evidence of safety.
    for (const sourceType of ['hall_of_fame', 'honour_team_members']) {
      expect(assessMatch([perfect()], sourceType).bulkEligible).toBe(false);
    }
  });

  it('refuses an unknown source class rather than defaulting to allowed', () => {
    expect(assessMatch([perfect()], 'some_future_table').bulkEligible).toBe(false);
  });

  it('still requires every row-level rule inside an admitted class', () => {
    const conflicted = scoreCandidate(
      source({ clubId: 7, clubNameRaw: 'Richmond', temporal: [activeSeason(1994)] }),
      candidate({ uniquenessConflict: 'already linked in that scope' }),
    );
    expect(assessMatch([conflicted], 'award_winners').bulkEligible).toBe(false);

    const nameOnly = scoreCandidate(source(), candidate());
    expect(assessMatch([nameOnly], 'award_winners').bulkEligible).toBe(false);
  });
});

describe('career span as contradiction', () => {
  it('contradicts a stated span that shares no season with a complete career', () => {
    // Bill Walker of Swan Districts (1961-1976) is not Bill Walker of
    // Fitzroy (1903-1914), however exactly the names agree.
    const scored = scoreCandidate(
      source({ temporal: [{ kind: 'active_range', first: 1961, last: 1976 }] }),
      candidate({ debutSeason: 1903, finalSeason: 1914, careerGames: 169 }),
    );
    expect(scored.conflicts.map((c) => c.reason)).toContain('career_span_no_overlap');
    expect(assessMatch([scored], 'hall_of_fame').band).toBe('low');
  });

  it('accepts a span assembled from several fragments that does overlap', () => {
    // Murray Weideman's "1968-1969, 1953-1963" parses to 1953-1969, and
    // is the reason this rule reads the outer bounds rather than the
    // first fragment it finds.
    const span = parseCareerSpan('1968-1969, 1953-1963');
    expect(span).toEqual({ first: 1953, last: 1969 });

    const scored = scoreCandidate(
      source({ temporal: [{ kind: 'active_range', first: span!.first, last: span!.last }] }),
      candidate({ debutSeason: 1953, finalSeason: 1963, careerGames: 180 }),
    );
    expect(scored.hardConflict).toBe(false);
  });

  it('will not contradict when AFLDB does not know the career in full', () => {
    const scored = scoreCandidate(
      source({ temporal: [{ kind: 'active_range', first: 1961, last: 1976 }] }),
      candidate({ debutSeason: 1903, finalSeason: 1914, careerGames: null }),
    );
    expect(scored.hardConflict).toBe(false);
  });
});
