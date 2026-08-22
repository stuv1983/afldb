import { describe, expect, it } from 'vitest';

import {
  conflictLabel,
  describeAlternative,
  describeBulkCriteria,
  describeSourceRecord,
  evidenceLabel,
  hasStrongNameEvidence,
  independentFamilyCount,
} from '@/lib/player-matching/describe';
import type { EvidenceItem } from '@/lib/player-matching/types';

/**
 * The review layer.
 *
 * A Super Admin approving an identity has to be able to tell WHAT the
 * record is and WHY the score is what it is. These pin the two rules
 * that make that possible: a record is described in its own terms, and
 * every label is a translation of the server's own evidence rather than
 * a second opinion about it.
 */

const item = (signal: string, family: string, points: number): EvidenceItem =>
  ({ signal, family: family as EvidenceItem['family'], detail: 'detail', points });

describe('source records are described in their own terms', () => {
  it('tells an award, a nomination and an honour team apart for one name', () => {
    // The failure this exists to prevent: three rows for "Michael
    // O'Loughlin" that a reviewer cannot distinguish.
    const award = describeSourceRecord({
      kind: 'award_winner', award: 'Bob Skilton Medal', season: 1998,
      club: 'Sydney', position: null,
    });
    expect(award.typeLabel).toBe('Award winner');
    expect(award.lines).toContain('Bob Skilton Medal');
    expect(award.lines).toContain('Sydney · 1998');

    const nomination = describeSourceRecord({
      kind: 'award_nomination', award: 'Rising Star Award', season: 2005,
      club: 'Sydney', round: 17,
    });
    expect(nomination.typeLabel).toBe('Award nomination');
    expect(nomination.lines).toContain('Sydney · 2005 · Round 17');

    const team = describeSourceRecord({
      kind: 'honour_team', team: 'Sydney Team of the Century',
      position: 'Half Back', role: null, club: null,
    });
    expect(team.typeLabel).toBe('Honour team');
    expect(team.lines).toContain('Sydney Team of the Century');

    expect(new Set([award.typeLabel, nomination.typeLabel, team.typeLabel]).size).toBe(3);
  });

  it('never presents a Hall of Fame induction year as a playing season', () => {
    const hof = describeSourceRecord({
      kind: 'hall_of_fame', category: 'Player', inductedYear: 2015,
      playingCareer: '1987-1998', club: 'Essendon', isLegend: false,
    });
    expect(hof.lines).toContain('Playing career: 1987-1998');
    expect(hof.lines).toContain('Inducted: 2015');
    // The two are labelled separately and neither reads as the other.
    expect(hof.lines.some((l) => /^Inducted/.test(l) && /career/i.test(l))).toBe(false);
  });

  it('marks a legend', () => {
    const hof = describeSourceRecord({
      kind: 'hall_of_fame', category: null, inductedYear: 1996,
      playingCareer: null, club: null, isLegend: true,
    });
    expect(hof.typeLabel).toBe('Hall of Fame (Legend)');
  });

  it('shows the draft source its own reported totals and pick count', () => {
    const draft = describeSourceRecord({
      kind: 'draft', draftYear: 1988, club: 'Essendon', draftType: 'National',
      pick: 4, reportedGames: 243, reportedGoals: 46, picks: 3,
    });
    expect(draft.typeLabel).toBe('Draft');
    expect(draft.lines[0]).toContain('1988');
    expect(draft.lines[0]).toContain('Pick 4');
    expect(draft.lines).toContain('Reported: 243 games · 46 goals');
    // One person, three picks -- said plainly, not shown as three rows.
    expect(draft.lines).toContain('3 draft picks for this person');
  });

  it('names a captaincy role when it is not simply Captain', () => {
    expect(describeSourceRecord({
      kind: 'captaincy', season: 1996, club: 'Essendon', role: 'Vice-Captain',
    }).typeLabel).toBe('Vice-Captain');
    expect(describeSourceRecord({
      kind: 'captaincy', season: 1996, club: 'Essendon', role: 'Captain',
    }).typeLabel).toBe('Captaincy');
  });

  it('degrades to a generic label rather than throwing', () => {
    expect(describeSourceRecord(null).typeLabel).toBe('Source record');
    expect(describeSourceRecord({ kind: 'unknown' }).lines).toEqual([]);
  });
});

describe('evidence is translated, never reinterpreted', () => {
  it('gives every scoring signal reviewer-facing wording', () => {
    const signals = [
      'name_exact', 'name_alias_exact', 'name_trigram_high', 'name_trigram_medium',
      'name_surname_initial', 'club_in_season', 'club_anywhere',
      'era_season_in_career', 'era_season_near_career', 'career_span_exact',
      'career_span_overlap', 'draft_year_before_debut', 'draft_games_exact',
      'draft_games_near', 'draft_goals_exact', 'draft_goals_near',
    ];
    for (const signal of signals) {
      const label = evidenceLabel(signal);
      // Readable, and not the raw identifier leaking through.
      expect(label).not.toContain('_');
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it('falls back readably for a signal it has never seen', () => {
    expect(evidenceLabel('some_new_signal')).toBe('some new signal');
  });

  it('states a conflict in plain words', () => {
    expect(conflictLabel({ reason: 'club_not_in_history', detail: 'raw detail' }))
      .toBe('This player never played for that club');
    expect(conflictLabel({ reason: 'unknown_reason', detail: 'raw detail' }))
      .toBe('raw detail');
  });

  it('counts corroborating families the way the scorer counts them', () => {
    // Reported games and goals come from one external record, so they
    // are one kind of agreement. The UI must not count them as two and
    // claim corroboration the score never granted.
    const evidence = [
      item('name_exact', 'name', 44),
      item('draft_games_exact', 'draft_games', 15),
      item('draft_goals_exact', 'draft_goals', 10),
    ];
    expect(independentFamilyCount(evidence)).toBe(2);
  });

  it('recognises only exact or alias name evidence as strong', () => {
    expect(hasStrongNameEvidence([item('name_exact', 'name', 44)])).toBe(true);
    expect(hasStrongNameEvidence([item('name_alias_exact', 'name', 41)])).toBe(true);
    expect(hasStrongNameEvidence([item('name_trigram_high', 'name', 26)])).toBe(false);
  });
});

describe('alternatives are described without matcher jargon', () => {
  it('says so plainly when there is no rival', () => {
    expect(describeAlternative(null, null)).toBe('No credible alternative');
  });

  it('names the runner-up and the margin', () => {
    expect(describeAlternative(26, { playerName: 'John Smith', score: 71 }))
      .toBe('Next best: John Smith · 71 (gap 26)');
  });
});

describe('bulk readiness is explained, not asserted', () => {
  it('lists the four things that make a row safe unattended', () => {
    const criteria = describeBulkCriteria(
      [item('name_exact', 'name', 44), item('club_in_season', 'club', 36)],
      [],
      null,
    );
    expect(criteria).toEqual([
      'Strong identity match',
      'Independent football evidence (2 kinds)',
      'No hard conflicts',
      'No credible alternative',
    ]);
  });

  it('says which criterion is missing rather than hiding it', () => {
    const criteria = describeBulkCriteria(
      [item('name_trigram_high', 'name', 26)],
      [{ reason: 'club_not_in_history', detail: 'never played there' }],
      3,
    );
    expect(criteria[0]).toBe('Name evidence is not exact');
    expect(criteria[1]).toBe('Only one kind of evidence');
    expect(criteria[2]).toBe('Contradicted by the source');
    expect(criteria[3]).toBe('No close alternative (gap 3)');
  });
});
