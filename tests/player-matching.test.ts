import { describe, expect, it } from 'vitest';

import { ALGORITHM_VERSION, assessMatch, MATCH_POLICY } from '@/lib/player-matching/confidence';
import { parseCareerSpan } from '@/lib/player-matching/parse-career-span';
import { scoreCandidate } from '@/lib/player-matching/score-candidate';
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
    clubNameRaw: null,
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
    clubs: [{ clubId: 7, games: 150, firstSeason: 1990, lastSeason: 1999 }],
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
    const assessment = assessMatch([rival, best]);

    expect(assessment.best?.playerId).toBe(100);
    expect(assessment.gap).toBe(best.score - rival.score);
    expect(assessment.algorithmVersion).toBe(ALGORITHM_VERSION);
  });

  it('gives a lone candidate a null gap rather than a zero one', () => {
    // No rival is the least ambiguous case, not the most, and a zero
    // would read as a dead heat.
    const assessment = assessMatch([scoreCandidate(rich(), candidate())]);
    expect(assessment.gap).toBeNull();
    expect(assessment.band).toBe('very_high');
  });

  it('flags two near-identical candidates as ambiguous and refuses bulk', () => {
    const a = scoreCandidate(rich(), candidate({ playerId: 100 }));
    const b = scoreCandidate(rich(), candidate({ playerId: 200 }));
    const assessment = assessMatch([a, b]);

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
    const assessment = assessMatch([conflicted]);

    expect(conflicted.score).toBeGreaterThanOrEqual(MATCH_POLICY.bands.veryHighScore);
    expect(assessment.band).toBe('low');
    expect(assessment.bulkEligible).toBe(false);
  });

  it('reports no band and no candidate for an empty set', () => {
    const assessment = assessMatch([]);
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
    const assessment = assessMatch([scored]);
    expect(assessment.band).toBe('very_high');
    expect(assessment.bulkEligible).toBe(true);
  });

  it('refuses a name-only match however unrivalled', () => {
    // The queue is full of state-league footballers who share a name
    // with an AFL player and have no AFLDB record of their own. A name
    // agreeing with itself is not corroboration.
    const assessment = assessMatch([scoreCandidate(source(), candidate())]);
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
    const assessment = assessMatch([scored]);
    expect(assessment.best?.strongName).toBe(false);
    expect(assessment.bulkEligible).toBe(false);
  });

  it('refuses anything the policy floor does not clear', () => {
    const scored = scoreCandidate(
      source({ clubId: 7, temporal: [] }),
      candidate(),
    );
    const assessment = assessMatch([scored]);
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
    expect(assessMatch([a, b])).toEqual(assessMatch([b, a]));
  });
});
