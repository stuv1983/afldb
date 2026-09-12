import { describe, expect, it } from 'vitest';

import { ALGORITHM_VERSION, MATCH_POLICY } from '@/lib/player-matching/confidence';
import {
  conflictLabel,
  describeAlternative,
  describeBulkChecklist,
  describeCeiling,
  describeLimitReason,
  describeSourceRecord,
  evidenceLabel,
  hasStrongNameEvidence,
  independentFamilyCount,
} from '@/lib/player-matching/describe';
import {
  explainLimits,
  profileFromSourceDetail,
  profileFromSourceEvidence,
  reachableCeiling,
  type LimitAssessmentInput,
  type LimitReasonCode,
  type SourceProfile,
} from '@/lib/player-matching/explain-limits';
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

// ---------------------------------------------------------------------
// Explainability (AFLDB-ISSUE-164 §11, acceptance §13 item 1)
// ---------------------------------------------------------------------

/** A profile with nothing on it; each test turns on only what it needs. */
const profile = (sourceType: string, over: Partial<SourceProfile> = {}): SourceProfile => ({
  sourceType,
  hasClubId: false,
  clubText: 'absent',
  hasActiveSeason: false,
  hasAssertedRange: false,
  hasDraftYear: false,
  hasReportedGames: false,
  hasReportedGoals: false,
  ...over,
});

const assessed = (over: Partial<LimitAssessmentInput> = {}): LimitAssessmentInput => ({
  band: 'very_high',
  score: 97,
  gap: null,
  nearTies: 0,
  ambiguous: false,
  hardConflict: false,
  bulkEligible: false,
  evidence: [],
  conflicts: [],
  ...over,
});

const codes = (assessment: LimitAssessmentInput, p: SourceProfile): LimitReasonCode[] =>
  explainLimits(assessment, p).reasons.map((r) => r.code);

describe('reachable ceiling reproduces the §3 arithmetic', () => {
  it('puts a complete draft profile at 97, exactly as §3.1 computes it', () => {
    // name_exact 44 + club_anywhere 15 + draft timing 13 + games 15 +
    // goals 10. club_in_season is unreachable because a draft row
    // carries no active season at all.
    const ceiling = reachableCeiling(profile('draft_person', {
      hasClubId: true, hasDraftYear: true, hasReportedGames: true, hasReportedGoals: true,
    }));
    expect(ceiling.score).toBe(97);
    expect(ceiling.parts.map((p) => p.signal)).toContain('club_anywhere');
    expect(ceiling.parts.map((p) => p.signal)).not.toContain('club_in_season');
    expect(ceiling.reachesVeryHigh).toBe(true);
  });

  it('puts an honour-team row with no resolvable club at 44, as §3.2 does', () => {
    const ceiling = reachableCeiling(profile('honour_team_members'));
    expect(ceiling.score).toBe(44);
    expect(ceiling.reachesVeryHigh).toBe(false);
  });

  it('puts an award row with a season but no club_id at 61', () => {
    expect(reachableCeiling(profile('award_winners', { hasActiveSeason: true })).score)
      .toBe(61);
    // With a real club_id the same row reaches 97.
    expect(reachableCeiling(
      profile('award_winners', { hasActiveSeason: true, hasClubId: true }),
    ).score).toBe(97);
  });

  it('counts club text and club_id as ONE family, never both', () => {
    // S1-S4 are one club family (§6). A profile carrying both must not
    // be paid twice for the same club.
    const both = reachableCeiling(profile('hall_of_fame', {
      hasClubId: true, clubText: 'resolved', hasAssertedRange: true,
    }));
    expect(both.parts.filter((p) => p.family === 'club')).toHaveLength(1);
  });

  it('never invents evidence a source does not carry', () => {
    // Hall of Fame with a parsed span and a resolvable club:
    // 44 + 15 (club in span) + 17 (career span) = 76. Still short of the
    // Very High floor, which is the honest answer.
    const ceiling = reachableCeiling(profile('hall_of_fame', {
      clubText: 'resolved', hasAssertedRange: true,
    }));
    expect(ceiling.score).toBe(76);
    expect(ceiling.reachesVeryHigh).toBe(false);
  });

  it('reads its weights from MATCH_POLICY rather than repeating them', () => {
    const ceiling = reachableCeiling(profile('captaincies', {
      hasClubId: true, hasActiveSeason: true,
    }));
    expect(ceiling.score).toBe(
      MATCH_POLICY.scoring.name.exact
      + MATCH_POLICY.scoring.club.clubSeason
      + MATCH_POLICY.scoring.era.seasonInCareer,
    );
  });
});

describe('source profiles are derived, not guessed', () => {
  it('distinguishes an award row with a club_id from one with only club text', () => {
    const linked = profileFromSourceDetail({
      kind: 'award_winner', award: 'Brownlow Medal', season: 1994,
      club: 'Richmond', position: null, hasClubId: true,
    }, 'award_winners');
    expect(linked.hasClubId).toBe(true);

    // The club NAME is present either way, so the name alone must never
    // be read as proof of a club_id.
    const textOnly = profileFromSourceDetail({
      kind: 'award_winner', award: 'Brownlow Medal', season: 1994,
      club: 'Richmond', position: null, hasClubId: false,
    }, 'award_winners');
    expect(textOnly.hasClubId).toBe(false);
    expect(reachableCeiling(textOnly).score).toBe(61);
  });

  it('reads a Hall of Fame career span through the same parser the scorer uses', () => {
    const parsed = profileFromSourceDetail({
      kind: 'hall_of_fame', category: 'Player', inductedYear: 2015,
      playingCareer: '1987-1998', club: 'Essendon', isLegend: false,
    }, 'hall_of_fame', { clubTextResolved: true });
    expect(parsed.hasAssertedRange).toBe(true);
    expect(parsed.clubText).toBe('resolved');

    const unparsed = profileFromSourceDetail({
      kind: 'hall_of_fame', category: 'Player', inductedYear: 2015,
      playingCareer: 'unknown', club: 'Glenelg', isLegend: false,
    }, 'hall_of_fame');
    expect(unparsed.hasAssertedRange).toBe(false);
    expect(unparsed.clubText).toBe('present_unresolved');
  });

  it('agrees with the live evidence row it is a stand-in for', () => {
    const fromEvidence = profileFromSourceEvidence({
      target: {
        targetTable: 'draft_picks', targetId: 1,
        resolutionEntityType: 'draft_person', resolutionEntityId: 9,
      },
      rawName: 'Aaron Cadman', normalisedName: 'aaron cadman',
      temporal: [{ kind: 'draft_year', year: 2022 }],
      clubId: 12, clubOrganizationId: 12, clubMatch: 'club_id',
      clubNameRaw: 'GWS', resolvedClubs: [],
      reportedGames: 40, reportedGoals: 22,
      context: '', uniquenessScope: { kind: 'none' }, linkStatus: 'unmatched',
    }, 'draft_person');

    const fromDetail = profileFromSourceDetail({
      kind: 'draft', draftYear: 2022, club: 'GWS', draftType: 'National',
      pick: 1, reportedGames: 40, reportedGoals: 22, picks: 1,
    }, 'draft_person');

    expect(fromEvidence).toEqual(fromDetail);
    expect(reachableCeiling(fromEvidence).score).toBe(97);
  });
});

describe('limit reasons explain every P0 shape', () => {
  it('names a non-exact name as the reason, above the arithmetic it causes', () => {
    // §3.1 composition 1: every non-name family agrees and the only
    // shortfall is the name string.
    const assessment = assessed({
      band: 'high', score: 79, gap: null,
      evidence: [
        item('name_trigram_high', 'name', 26),
        item('club_in_season', 'club', 36),
        item('era_season_in_career', 'era', 17),
      ],
    });
    const p = profile('award_winners', { hasClubId: true, hasActiveSeason: true });
    const explained = explainLimits(assessment, p);
    expect(explained.primary?.code).toBe('name_not_exact');
    expect(explained.reasons.map((r) => r.code)).toContain('below_bulk_score_floor');
    expect(describeLimitReason(explained.primary!))
      .toBe('Not bulk-ready: the name is not an exact match');
  });

  it('reports a policy exclusion as policy, independently of the score', () => {
    // A captaincy that agrees on everything. Nothing about the evidence
    // is wrong; the class is simply not approved unattended.
    const assessment = assessed({
      score: 97,
      evidence: [
        item('name_exact', 'name', 44),
        item('club_in_season', 'club', 36),
        item('era_season_in_career', 'era', 17),
      ],
    });
    const p = profile('captaincies', { hasClubId: true, hasActiveSeason: true });
    const explained = explainLimits(assessment, p);
    expect(explained.reasons.map((r) => r.code)).toEqual(['source_class_not_bulk']);
    expect(describeLimitReason(explained.reasons[0]))
      .toBe('Not bulk-ready: captaincies is suggestion-only (policy)');
    // The evidence criteria all still read as met: the row is excluded
    // by class, not by anything it failed to prove.
    const evidenceChecks = explained.checks.filter((c) => c.key !== 'source_class');
    expect(evidenceChecks.every((c) => c.met)).toBe(true);
  });

  it('says when nothing independent corroborates the name', () => {
    const assessment = assessed({
      band: 'low', score: 44, evidence: [item('name_exact', 'name', 44)],
    });
    const explained = explainLimits(assessment, profile('award_winners'));
    expect(explained.primary?.code).toBe('no_independent_corroboration');
    const reason = explained.reasons.find((r) => r.code === 'no_independent_corroboration');
    expect(reason).toMatchObject({ families: 1, required: 2 });
  });

  it('quotes the bulk score floor when that is the only shortfall', () => {
    const assessment = assessed({
      score: 80, gap: 30,
      evidence: [item('name_exact', 'name', 44), item('club_in_season', 'club', 36)],
    });
    const p = profile('award_winners', { hasClubId: true, hasActiveSeason: true });
    const explained = explainLimits(assessment, p);
    expect(explained.reasons.map((r) => r.code)).toEqual(['below_bulk_score_floor']);
    expect(describeLimitReason(explained.reasons[0]))
      .toBe('Not bulk-ready: score 80 is below the bulk floor of 90');
  });

  it('puts a near tie ahead of the gap floor it also breaches', () => {
    const assessment = assessed({
      score: 97, gap: 3, nearTies: 1, ambiguous: true,
      evidence: [
        item('name_exact', 'name', 44),
        item('club_in_season', 'club', 36),
        item('era_season_in_career', 'era', 17),
      ],
    });
    const p = profile('award_winners', { hasClubId: true, hasActiveSeason: true });
    const explained = explainLimits(assessment, p);
    expect(explained.primary?.code).toBe('near_tie');
    expect(explained.reasons.map((r) => r.code))
      .toEqual(['near_tie', 'below_bulk_gap_floor']);
    expect(describeLimitReason(explained.primary!))
      .toBe('Needs review: the next candidate is only 3 behind');
  });

  it('puts a hard conflict above everything else', () => {
    const assessment = assessed({
      band: 'low', score: 97, hardConflict: true,
      conflicts: [{ reason: 'club_not_in_history', detail: 'never played there' }],
      evidence: [item('name_exact', 'name', 44), item('club_in_season', 'club', 36)],
    });
    const p = profile('award_winners', { hasClubId: true, hasActiveSeason: true });
    const explained = explainLimits(assessment, p);
    expect(explained.primary?.code).toBe('hard_conflict');
  });

  it('says outright when a record type can never reach Very High', () => {
    const assessment = assessed({
      band: 'low', score: 44, evidence: [item('name_exact', 'name', 44)],
    });
    const explained = explainLimits(assessment, profile('honour_team_members'));
    const ceiling = explained.reasons.find(
      (r) => r.code === 'profile_ceiling_below_very_high',
    );
    expect(ceiling).toMatchObject({ ceiling: 44, required: 85 });
    expect(describeLimitReason(ceiling!))
      .toBe('A honour_team_members record can reach at most 44, '
        + 'below the Very High floor of 85');
    // Policy exclusion and ceiling are separate statements.
    expect(explained.reasons.map((r) => r.code)).toContain('source_class_not_bulk');
  });

  it('raises no reason at all for a fully eligible row', () => {
    const assessment = assessed({
      score: 97, gap: 97, bulkEligible: true,
      evidence: [
        item('name_exact', 'name', 44),
        item('club_in_season', 'club', 36),
        item('era_season_in_career', 'era', 17),
      ],
    });
    const p = profile('award_winners', { hasClubId: true, hasActiveSeason: true });
    const explained = explainLimits(assessment, p);
    expect(explained.reasons).toEqual([]);
    expect(explained.primary).toBeNull();
    expect(explained.bulkReady).toBe(true);
    expect(explained.checks.every((c) => c.met)).toBe(true);
  });

  it('withholds a disagreeing name group and says why', () => {
    const assessment = assessed({
      score: 97, gap: 97, bulkEligible: true,
      evidence: [item('name_exact', 'name', 44), item('club_in_season', 'club', 36)],
    });
    const p = profile('award_winners', { hasClubId: true, hasActiveSeason: true });
    const explained = explainLimits(assessment, p, { groupDisagrees: true });
    expect(explained.bulkReady).toBe(false);
    expect(explained.primary?.code).toBe('group_disagrees');
  });

  it('treats unresolved club text as neither evidence nor a reason', () => {
    // Club text naming a SANFL club is not a failure of this row; it is
    // simply not evidence. It must add no reason of its own and must not
    // change the ceiling relative to a row with no club text at all.
    const assessment = assessed({
      band: 'low', score: 44, evidence: [item('name_exact', 'name', 44)],
    });
    const unresolved = profile('honour_team_members', { clubText: 'present_unresolved' });
    const absent = profile('honour_team_members', { clubText: 'absent' });

    expect(reachableCeiling(unresolved).score).toBe(reachableCeiling(absent).score);
    expect(codes(assessment, unresolved)).toEqual(codes(assessment, absent));
    expect(codes(assessment, unresolved)).not.toContain('club_text_unresolved');
  });
});

describe('explainability never rescores', () => {
  it('leaves the assessment it was handed untouched', () => {
    const assessment = assessed({
      band: 'high', score: 79,
      evidence: [item('name_trigram_high', 'name', 26), item('club_anywhere', 'club', 15)],
    });
    const before = JSON.stringify(assessment);
    explainLimits(assessment, profile('draft_person', {
      hasClubId: true, hasDraftYear: true, hasReportedGames: true, hasReportedGoals: true,
    }));
    expect(JSON.stringify(assessment)).toBe(before);
  });

  it('repeats the eligibility answer rather than forming its own', () => {
    // bulkEligible is assessMatch's decision. explainLimits reports it;
    // it may never contradict it, and the only thing it may add is the
    // page-level group rule.
    const eligible = assessed({ score: 97, gap: 97, bulkEligible: true,
      evidence: [item('name_exact', 'name', 44), item('club_in_season', 'club', 36)] });
    const p = profile('award_winners', { hasClubId: true, hasActiveSeason: true });
    expect(explainLimits(eligible, p).bulkReady).toBe(true);
    expect(explainLimits({ ...eligible, bulkEligible: false }, p).bulkReady).toBe(false);
  });

  it('is explanatory only: the shipped version and policy are unchanged', () => {
    expect(ALGORITHM_VERSION).toBe('v3');
    expect(MATCH_POLICY.scoring.club.clubTextInSpan).toBe(15);
    expect(MATCH_POLICY.scoring.club.clubTextAnywhere).toBe(15);
    expect(MATCH_POLICY.bulk.sourceTypes.draft_person).toBe(false);
  });
});

describe('bulk readiness is explained, not asserted', () => {
  it('lists every criterion with its own verdict, on a row that passes', () => {
    const explained = explainLimits(
      assessed({
        score: 97, gap: 97, bulkEligible: true,
        evidence: [item('name_exact', 'name', 44), item('club_in_season', 'club', 36)],
      }),
      profile('award_winners', { hasClubId: true, hasActiveSeason: true }),
    );
    const checklist = describeBulkChecklist(explained.checks);
    expect(checklist.map((c) => c.met)).toEqual([true, true, true, true, true, true]);
    expect(checklist[0].label).toBe('Strong identity match');
    expect(checklist[5].label).toBe('award_winners may be approved unattended');
  });

  it('says which criterion is missing rather than hiding it', () => {
    const explained = explainLimits(
      assessed({
        band: 'low', score: 26, gap: 3, hardConflict: true,
        conflicts: [{ reason: 'club_not_in_history', detail: 'never played there' }],
        evidence: [item('name_trigram_high', 'name', 26)],
      }),
      profile('hall_of_fame'),
    );
    const checklist = describeBulkChecklist(explained.checks);
    expect(checklist.every((c) => !c.met)).toBe(true);
    expect(checklist[0].label).toBe('Name evidence is not exact');
    expect(checklist[1].label).toBe('Only 1 evidence family — 2 required');
    expect(checklist[2].label).toBe('Score 26 is below the bulk floor of 90');
    expect(checklist[3].label).toBe('Next candidate is only 3 behind — 25 required');
    expect(checklist[4].label).toBe('Contradicted by the source');
    expect(checklist[5].label).toBe('hall_of_fame is suggestion-only (policy)');
  });

  it('states the ceiling as a ceiling, never as a score', () => {
    expect(describeCeiling(44, false))
      .toBe('Highest score this record type can reach: 44 — never Very High');
    expect(describeCeiling(97, true))
      .toBe('Highest score this record type can reach: 97');
  });
});
