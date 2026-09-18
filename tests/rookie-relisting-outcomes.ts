/**
 * AFLDB-ISSUE-222 §11.19.12/§11.19.13, operator decision D2. Reader for the tracked
 * independent-source review of the eight `pickrookie` disagreements
 * (docs/rebuild-manifests/draftguru/rookie-relisting-independent-review-20260919-v1.md),
 * data/players/rookie-relisting-outcomes.csv.
 *
 * A row records that an independent source -- never Gridley's key, never recollection --
 * was opened and read, and states what it supports for one linked player: a Rookie Draft
 * selection/re-listing DraftGuru's linked page omits (`gridley_supported`, a DraftGuru
 * source coverage gap), no independent support (`draftguru_supported`), or conflicting/no
 * evidence (`undetermined`). Keyed by the AFL Tables profile path the player's afltables
 * identity holds, never by name or by a database-generated id, so it survives a rebuild.
 * Only `gridley_supported` rows are ever read for classification; the other verdicts are
 * recorded review history, not an instruction to reclassify anything.
 *
 * Not a test file (vitest includes tests/**\/*.test.ts only): shared by the corpus
 * classification and any future artefact contract test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './height-adjudications';

export const ROOKIE_RELISTING_OUTCOMES_CSV = join(__dirname, '..', 'data', 'players', 'rookie-relisting-outcomes.csv');
export const ROOKIE_RELISTING_COLUMNS = [
  'afltables_profile', 'player', 'event_year', 'event_club', 'pick',
  'evidence_strength', 'verdict', 'evidence', 'decided_on', 'reference',
] as const;
export const ROOKIE_RELISTING_VERDICTS = ['gridley_supported', 'draftguru_supported', 'undetermined'] as const;
export const ROOKIE_RELISTING_EVIDENCE_STRENGTHS = ['primary', 'secondary'] as const;

export type RookieRelistingOutcome = {
  afltablesProfile: string;
  player: string;
  eventYear: number;
  eventClub: string;
  pick: number;
  evidenceStrength: (typeof ROOKIE_RELISTING_EVIDENCE_STRENGTHS)[number];
  verdict: (typeof ROOKIE_RELISTING_VERDICTS)[number];
  evidence: string;
  decidedOn: string;
  reference: string;
};

export function loadRookieRelistingOutcomes(text: string = readFileSync(ROOKIE_RELISTING_OUTCOMES_CSV, 'utf8')): RookieRelistingOutcome[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.join(',') !== ROOKIE_RELISTING_COLUMNS.join(',')) {
    throw new Error(`rookie-relisting-outcomes.csv header must be ${ROOKIE_RELISTING_COLUMNS.join(',')}`);
  }
  const seen = new Set<string>();
  return rows.map((r, n) => {
    const line = n + 2;
    if (r.length !== ROOKIE_RELISTING_COLUMNS.length) throw new Error(`rookie-relisting-outcomes.csv row ${line}: ${r.length} fields`);
    const [afltablesProfile, player, eventYearRaw, eventClub, pickRaw, evidenceStrength, verdict, evidence, decidedOn, reference] = r;
    if (!/^players\/[A-Z]\/[A-Za-z0-9_'.-]+\.html$/.test(afltablesProfile)) throw new Error(`row ${line}: not an AFL Tables profile path: ${afltablesProfile}`);
    if (seen.has(afltablesProfile)) throw new Error(`row ${line}: duplicate profile ${afltablesProfile}`);
    seen.add(afltablesProfile);
    const eventYear = Number(eventYearRaw);
    if (!Number.isInteger(eventYear) || eventYear < 1996) throw new Error(`row ${line}: event_year ${eventYearRaw}`);
    const pick = Number(pickRaw);
    if (!Number.isInteger(pick) || pick < 1) throw new Error(`row ${line}: pick ${pickRaw}`);
    if (!(ROOKIE_RELISTING_EVIDENCE_STRENGTHS as readonly string[]).includes(evidenceStrength)) throw new Error(`row ${line}: evidence_strength ${evidenceStrength}`);
    if (!(ROOKIE_RELISTING_VERDICTS as readonly string[]).includes(verdict)) throw new Error(`row ${line}: verdict ${verdict}`);
    if (evidence.trim().length < 40) throw new Error(`row ${line}: evidence must state the source`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedOn)) throw new Error(`row ${line}: decided_on ${decidedOn}`);
    if (!/^AFLDB-ISSUE-\d{3}\b/.test(reference)) throw new Error(`row ${line}: reference ${reference}`);
    return {
      afltablesProfile, player, eventYear, eventClub, pick,
      evidenceStrength: evidenceStrength as RookieRelistingOutcome['evidenceStrength'],
      verdict: verdict as RookieRelistingOutcome['verdict'],
      evidence, decidedOn, reference,
    };
  });
}
