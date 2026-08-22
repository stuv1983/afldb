import type { EvidenceItem, HardConflict } from '@/lib/player-matching/types';

/**
 * Turning matcher output into something a reviewer can act on.
 *
 * A Super Admin approving an identity should not have to know how the
 * scorer works. Two rules follow from that, and both are the reason
 * this module exists rather than the page formatting things inline:
 *
 *   1. Every label here is derived from the SAME evidence the server
 *      scored. The UI never re-decides what a row means; if it did,
 *      the page could disagree with the number beside it.
 *   2. A source record is described in its own terms. "Essendon · 1993"
 *      is a captaincy, an award and a nomination all at once, and a
 *      queue of near-identical lines is exactly what made the old page
 *      unreviewable.
 */

// ---------------------------------------------------------------------
// Source records
// ---------------------------------------------------------------------

/**
 * The identifying fields of one source row, as its own table records
 * them. Built in SQL per branch so nothing here needs a second query.
 */
export type SourceDetail =
  | { kind: 'award_winner'; award: string | null; season: number | null;
      club: string | null; position: string | null }
  | { kind: 'award_nomination'; award: string | null; season: number | null;
      club: string | null; round: number | null }
  | { kind: 'hall_of_fame'; category: string | null; inductedYear: number | null;
      playingCareer: string | null; club: string | null; isLegend: boolean }
  | { kind: 'honour_team'; team: string | null; position: string | null;
      role: string | null; club: string | null }
  | { kind: 'captaincy'; season: number | null; club: string | null; role: string | null }
  | { kind: 'achievement'; achievement: string | null; season: number | null;
      club: string | null; round: string | null }
  | { kind: 'draft'; draftYear: number | null; club: string | null;
      draftType: string | null; pick: number | null;
      reportedGames: number | null; reportedGoals: number | null; picks: number }
  | { kind: 'unknown' };

export type SourceRecordView = {
  /** What KIND of record this is: the answer to "why is this row separate?". */
  typeLabel: string;
  /** Identifying context, most significant first. */
  lines: string[];
};

function joinParts(parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ');
}

export function describeSourceRecord(detail: SourceDetail | null): SourceRecordView {
  if (!detail) return { typeLabel: 'Source record', lines: [] };

  switch (detail.kind) {
    case 'award_winner':
      return {
        typeLabel: 'Award winner',
        lines: [
          detail.award ?? 'Award',
          joinParts([detail.club, detail.season]),
          detail.position ? `Position: ${detail.position}` : '',
        ].filter(Boolean),
      };

    case 'award_nomination':
      return {
        typeLabel: 'Award nomination',
        lines: [
          detail.award ?? 'Award',
          joinParts([
            detail.club,
            detail.season,
            detail.round !== null ? `Round ${detail.round}` : null,
          ]),
        ].filter(Boolean),
      };

    case 'hall_of_fame':
      return {
        typeLabel: detail.isLegend ? 'Hall of Fame (Legend)' : 'Hall of Fame',
        lines: [
          // Induction is not a playing season and is never labelled as
          // one: the scorer refuses to read it that way, and so does
          // the page.
          detail.playingCareer ? `Playing career: ${detail.playingCareer}` : '',
          detail.inductedYear !== null ? `Inducted: ${detail.inductedYear}` : '',
          joinParts([detail.category, detail.club]),
        ].filter(Boolean),
      };

    case 'honour_team':
      return {
        typeLabel: 'Honour team',
        lines: [
          detail.team ?? 'Honour team',
          joinParts([detail.position, detail.role, detail.club]),
        ].filter(Boolean),
      };

    case 'captaincy':
      return {
        typeLabel: detail.role && detail.role !== 'Captain' ? detail.role : 'Captaincy',
        lines: [joinParts([detail.club, detail.season])].filter(Boolean),
      };

    case 'achievement':
      return {
        typeLabel: 'Player achievement',
        lines: [
          (detail.achievement ?? 'Achievement').replace(/_/g, ' '),
          joinParts([detail.club, detail.season, detail.round]),
        ].filter(Boolean),
      };

    case 'draft': {
      const reported = detail.reportedGames !== null || detail.reportedGoals !== null
        ? `Reported: ${detail.reportedGames ?? '?'} games · ${detail.reportedGoals ?? '?'} goals`
        : '';
      return {
        typeLabel: 'Draft',
        lines: [
          joinParts([
            detail.draftYear,
            detail.club,
            detail.pick !== null ? `Pick ${detail.pick}` : null,
            detail.draftType,
          ]),
          reported,
          // One person, however many picks they were named in.
          detail.picks > 1 ? `${detail.picks} draft picks for this person` : '',
        ].filter(Boolean),
      };
    }

    default:
      return { typeLabel: 'Source record', lines: [] };
  }
}

// ---------------------------------------------------------------------
// Evidence, in a reviewer's words
// ---------------------------------------------------------------------

/**
 * Short labels for the row, expanded ones for the drawer.
 *
 * Both are keyed off the signal the SERVER recorded, so what a reviewer
 * reads is a translation of the score rather than a second opinion
 * about it.
 */
const EVIDENCE_LABELS: Record<string, { short: string; long: string }> = {
  name_exact: { short: 'Exact name', long: 'Exact name after normalisation' },
  name_alias_exact: { short: 'Alias', long: 'Matches a recorded alias of this player' },
  name_trigram_high: { short: 'Similar name', long: 'Very close name spelling' },
  name_trigram_medium: { short: 'Similar name', long: 'Similar name spelling' },
  name_surname_initial: { short: 'Surname + initial', long: 'Surname and first initial agree' },
  club_in_season: { short: 'Club + season', long: 'Played for that club in the source season' },
  club_anywhere: { short: 'Club career', long: 'Played for that club at some point' },
  era_season_in_career: { short: 'Playing era', long: 'Source season falls inside the AFL career' },
  era_season_near_career: { short: 'Playing era', long: 'Source season sits beside the AFL career' },
  career_span_exact: { short: 'Career span', long: 'Source career span matches exactly' },
  career_span_overlap: { short: 'Career span', long: 'Source career span overlaps the AFL career' },
  draft_year_before_debut: { short: 'Draft timing', long: 'Draft year sits just before the AFL debut' },
  draft_games_exact: { short: 'Draft games', long: 'Games reported by the draft source match' },
  draft_games_near: { short: 'Draft games', long: 'Games reported by the draft source are close' },
  draft_goals_exact: { short: 'Draft goals', long: 'Goals reported by the draft source match' },
  draft_goals_near: { short: 'Draft goals', long: 'Goals reported by the draft source are close' },
};

const CONFLICT_LABELS: Record<string, string> = {
  season_outside_career: 'Source season falls outside this player’s career',
  club_not_in_history: 'This player never played for that club',
  uniqueness_collision: 'This player already holds that place',
  career_span_no_overlap: 'Career span does not overlap this player’s career',
};

export function evidenceLabel(signal: string): string {
  return EVIDENCE_LABELS[signal]?.short ?? signal.replace(/_/g, ' ');
}

export function evidenceDescription(item: EvidenceItem): string {
  return EVIDENCE_LABELS[item.signal]?.long ?? item.detail;
}

export function conflictLabel(conflict: HardConflict): string {
  return CONFLICT_LABELS[conflict.reason] ?? conflict.detail;
}

/**
 * Independent corroborating families, counted the way the scorer counts
 * them: reported games and goals come from one external record and
 * travel together, so they are one kind of agreement, not two.
 *
 * Exported so the page can explain bulk eligibility using the scorer's
 * own arithmetic rather than a lookalike of it.
 */
export function independentFamilyCount(evidence: readonly EvidenceItem[]): number {
  const groups = new Set<string>();
  for (const item of evidence) {
    groups.add(
      item.family === 'draft_games' || item.family === 'draft_goals'
        ? 'draft_stats'
        : item.family,
    );
  }
  return groups.size;
}

/** Name evidence good enough to stand on: exact, or an exact alias. */
export function hasStrongNameEvidence(evidence: readonly EvidenceItem[]): boolean {
  return evidence.some(
    (item) => item.signal === 'name_exact' || item.signal === 'name_alias_exact',
  );
}

/** Plain wording for the runner-up, which "gap" alone never conveyed. */
export function describeAlternative(
  gap: number | null,
  best: { playerName: string; score: number } | null,
): string {
  if (gap === null) return 'No credible alternative';
  if (!best) return `Gap: ${gap}`;
  return `Next best: ${best.playerName} · ${best.score} (gap ${gap})`;
}

/**
 * Why a row may be approved unattended, in the four things a reviewer
 * would otherwise have to take on trust.
 */
export function describeBulkCriteria(
  evidence: readonly EvidenceItem[],
  conflicts: readonly HardConflict[],
  gap: number | null,
): string[] {
  // Counted WITHOUT the name. The eligibility rule wants a name plus at
  // least one other kind of agreement, so quoting the total here would
  // credit the name twice -- once as identity, once as corroboration of
  // itself.
  const corroborating = independentFamilyCount(evidence.filter((e) => e.family !== 'name'));
  return [
    hasStrongNameEvidence(evidence)
      ? 'Strong identity match'
      : 'Name evidence is not exact',
    corroborating >= 1
      ? `Independent football evidence (${corroborating} kind${corroborating === 1 ? '' : 's'})`
      : 'Nothing corroborates the name',
    conflicts.length === 0 ? 'No hard conflicts' : 'Contradicted by the source',
    gap === null ? 'No credible alternative' : `No close alternative (gap ${gap})`,
  ];
}
