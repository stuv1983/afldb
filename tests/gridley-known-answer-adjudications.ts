/**
 * AFLDB-ISSUE-225 §19.2 (operator decisions D4, D6). Reader for the tracked
 * adjudications of Gridley known-answer disagreements,
 * data/players/gridley-known-answer-adjudications.csv.
 *
 * A row records that one player's disagreement with Gridley's answer key on one
 * criterion, in one direction, was reviewed against independent sources and
 * decided against the key. It is keyed by the AFL Tables profile path the
 * player's afltables identity holds, never by name or a database id, and it names
 * the exact AFLDB fact it was decided on (`afldb_evidence`). The corpus suite
 * re-derives that fact from the database on every run; any difference makes the
 * record STALE and the cell returns to `incorrect known answer`
 * (tests/gridley-corpus-support.ts `knownAnswerEvidenceStaleness`).
 *
 * Not a test file (vitest includes tests/**\/*.test.ts only): shared by the
 * corpus classification and the artefact contract test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCsv } from './height-adjudications';

export const GRIDLEY_KNOWN_ANSWER_ADJUDICATIONS_CSV = join(__dirname, '..', 'data', 'players', 'gridley-known-answer-adjudications.csv');
export const GRIDLEY_KNOWN_ANSWER_COLUMNS = [
  'afltables_profile', 'player', 'gridley_criterion', 'direction', 'verdict', 'afldb_evidence', 'independent_evidence', 'decided_on', 'reference',
] as const;
export const GRIDLEY_KNOWN_ANSWER_DIRECTIONS = ['gridley_lists', 'gridley_omits'] as const;
export const GRIDLEY_KNOWN_ANSWER_VERDICTS = ['gridley_key_error', 'gridley_key_inconsistent'] as const;

/**
 * The only (direction, verdict) shapes a record may take. `gridley_lists` +
 * `gridley_key_error`: AFLDB omits on the record's criterion alone and the key is
 * wrong. `gridley_omits` + `gridley_key_inconsistent`: AFLDB lists, and the key
 * contradicts itself; because a "Gridley omits" cell cannot say which axis the key
 * rejects, that shape always carries the criterion-pair guard.
 */
const SHAPES = new Set(['gridley_lists/gridley_key_error', 'gridley_omits/gridley_key_inconsistent']);

/**
 * The AFLDB fact each adjudicable criterion is decided on, and so the only
 * evidence kind the corpus suite re-derives for it. A criterion absent here
 * cannot be adjudicated: the reader refuses the row.
 */
export const KNOWN_ANSWER_EVIDENCE_KIND: Record<string, 'organization_games' | 'trusted_captaincies'> = {
  // games_at_one_club_min_incl_merged / games_at_multiple_clubs_min_incl_merged:
  // games per merged organization (club_organizations.slug = games).
  games250sameclub: 'organization_games',
  games100clubs2: 'organization_games',
  // club_captain_any: every trusted captaincies row (clubs.name = season).
  captain: 'trusted_captaincies',
};

export type GridleyKnownAnswerAdjudication = {
  afltablesProfile: string;
  player: string;
  gridleyCriterion: string;
  direction: (typeof GRIDLEY_KNOWN_ANSWER_DIRECTIONS)[number];
  verdict: (typeof GRIDLEY_KNOWN_ANSWER_VERDICTS)[number];
  /** `<kind>:<key>=<value>;...`, tokens sorted, exactly as knownAnswerEvidence derives it. */
  afldbEvidence: string;
  independentEvidence: string;
  decidedOn: string;
  reference: string;
};

export function loadGridleyKnownAnswerAdjudications(
  text: string = readFileSync(GRIDLEY_KNOWN_ANSWER_ADJUDICATIONS_CSV, 'utf8'),
): GridleyKnownAnswerAdjudication[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.join(',') !== GRIDLEY_KNOWN_ANSWER_COLUMNS.join(',')) {
    throw new Error(`gridley-known-answer-adjudications.csv header must be ${GRIDLEY_KNOWN_ANSWER_COLUMNS.join(',')}`);
  }
  const seen = new Set<string>();
  return rows.map((r, n) => {
    const line = n + 2;
    if (r.length !== GRIDLEY_KNOWN_ANSWER_COLUMNS.length) throw new Error(`gridley-known-answer-adjudications.csv row ${line}: ${r.length} fields`);
    const [afltablesProfile, player, gridleyCriterion, direction, verdict, afldbEvidence, independentEvidence, decidedOn, reference] = r;
    if (!/^players\/[A-Z]\/[A-Za-z0-9_'.-]+\.html$/.test(afltablesProfile)) throw new Error(`row ${line}: not an AFL Tables profile path: ${afltablesProfile}`);
    if (player.trim() === '' || player !== player.trim()) throw new Error(`row ${line}: player ${JSON.stringify(player)}`);
    const kind = KNOWN_ANSWER_EVIDENCE_KIND[gridleyCriterion];
    if (!kind) throw new Error(`row ${line}: gridley_criterion ${gridleyCriterion} has no declared evidence kind`);
    if (!(GRIDLEY_KNOWN_ANSWER_DIRECTIONS as readonly string[]).includes(direction)) throw new Error(`row ${line}: direction ${direction}`);
    if (!(GRIDLEY_KNOWN_ANSWER_VERDICTS as readonly string[]).includes(verdict)) throw new Error(`row ${line}: verdict ${verdict}`);
    if (!SHAPES.has(`${direction}/${verdict}`)) throw new Error(`row ${line}: verdict ${verdict} is not allowed for direction ${direction}`);
    const key = `${afltablesProfile}|${gridleyCriterion}|${direction}`;
    if (seen.has(key)) throw new Error(`row ${line}: duplicate (profile, criterion, direction) ${key}`);
    seen.add(key);
    if (!afldbEvidence.startsWith(`${kind}:`)) throw new Error(`row ${line}: afldb_evidence for ${gridleyCriterion} must be ${kind}:..., got ${afldbEvidence}`);
    const tokens = afldbEvidence.slice(kind.length + 1).split(';');
    const tokenShape = kind === 'organization_games' ? /^[a-z0-9-]+=\d+$/ : /^[A-Za-z][A-Za-z .'-]*=\d{4}$/;
    if (!tokens.every((t) => tokenShape.test(t)) || [...tokens].sort().join(';') !== tokens.join(';') || new Set(tokens).size !== tokens.length) {
      throw new Error(`row ${line}: afldb_evidence must be sorted, distinct ${kind} tokens, got ${afldbEvidence}`);
    }
    if (independentEvidence.trim().length < 40) throw new Error(`row ${line}: independent_evidence must state the evidence`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedOn)) throw new Error(`row ${line}: decided_on ${decidedOn}`);
    if (!/^AFLDB-ISSUE-\d{3}\b/.test(reference)) throw new Error(`row ${line}: reference ${reference}`);
    return {
      afltablesProfile, player, gridleyCriterion,
      direction: direction as GridleyKnownAnswerAdjudication['direction'],
      verdict: verdict as GridleyKnownAnswerAdjudication['verdict'],
      afldbEvidence, independentEvidence, decidedOn, reference,
    };
  });
}
