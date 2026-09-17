/**
 * AFLDB-ISSUE-118 §23.26. Reader for the tracked operator adjudications of
 * height source conflicts, data/players/height-adjudications.csv.
 *
 * A row records that every source AFLDB holds for one player was reviewed and
 * the canonical AFL Tables height retained with the reason, the date and the
 * runbook reference. It is keyed by the AFL Tables profile path the player's
 * afltables identity holds, never by name, and it names the exact canonical
 * height and competing evidence it was decided on, so a later change to either
 * makes the record visibly stale instead of silently applying.
 *
 * Not a test file (vitest includes tests/**\/*.test.ts only): shared by the
 * corpus classification and the artefact contract test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const HEIGHT_ADJUDICATIONS_CSV = join(__dirname, '..', 'data', 'players', 'height-adjudications.csv');
export const HEIGHT_ADJUDICATION_COLUMNS = ['afltables_profile', 'player', 'afltables_cm', 'competing_evidence', 'decision', 'reason', 'decided_on', 'reference'] as const;
export const HEIGHT_ADJUDICATION_DECISIONS = ['retain_afltables'] as const;

export type HeightAdjudication = {
  afltablesProfile: string;
  player: string;
  afltablesCm: number;
  /** `source:cm` pairs sorted by source and joined by `;`, exactly as the corpus test derives them from player_height_evidence. */
  competingEvidence: string;
  decision: (typeof HEIGHT_ADJUDICATION_DECISIONS)[number];
  reason: string;
  decidedOn: string;
  reference: string;
};

/** Minimal RFC 4180 parser: quoted fields with doubled quotes, LF or CRLF rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function loadHeightAdjudications(text: string = readFileSync(HEIGHT_ADJUDICATIONS_CSV, 'utf8')): HeightAdjudication[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.join(',') !== HEIGHT_ADJUDICATION_COLUMNS.join(',')) {
    throw new Error(`height-adjudications.csv header must be ${HEIGHT_ADJUDICATION_COLUMNS.join(',')}`);
  }
  const seen = new Set<string>();
  return rows.map((r, n) => {
    const line = n + 2;
    if (r.length !== HEIGHT_ADJUDICATION_COLUMNS.length) throw new Error(`height-adjudications.csv row ${line}: ${r.length} fields`);
    const [afltablesProfile, player, cm, competingEvidence, decision, reason, decidedOn, reference] = r;
    if (!/^players\/[A-Z]\/[A-Za-z0-9_'.-]+\.html$/.test(afltablesProfile)) throw new Error(`row ${line}: not an AFL Tables profile path: ${afltablesProfile}`);
    if (seen.has(afltablesProfile)) throw new Error(`row ${line}: duplicate profile ${afltablesProfile}`);
    seen.add(afltablesProfile);
    const afltablesCm = Number(cm);
    if (!Number.isInteger(afltablesCm) || afltablesCm < 140 || afltablesCm > 230) throw new Error(`row ${line}: afltables_cm ${cm}`);
    const pairs = competingEvidence.split(';');
    if (!pairs.every((p) => /^[a-z_]+:\d{3}$/.test(p)) || [...pairs].sort().join(';') !== competingEvidence) {
      throw new Error(`row ${line}: competing_evidence must be sorted source:cm pairs, got ${competingEvidence}`);
    }
    if (!(HEIGHT_ADJUDICATION_DECISIONS as readonly string[]).includes(decision)) throw new Error(`row ${line}: decision ${decision}`);
    if (reason.trim().length < 40) throw new Error(`row ${line}: reason must state the evidence`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedOn)) throw new Error(`row ${line}: decided_on ${decidedOn}`);
    if (!/^AFLDB-ISSUE-\d{3}\b/.test(reference)) throw new Error(`row ${line}: reference ${reference}`);
    return { afltablesProfile, player, afltablesCm, competingEvidence, decision: decision as HeightAdjudication['decision'], reason, decidedOn, reference };
  });
}

/**
 * Why a tracked adjudication does NOT apply to the player as the database now holds
 * them, or null when it applies. The corpus test derives `competing` from every
 * player_height_evidence row from a source other than AFL Tables.
 */
export function adjudicationStaleness(
  adj: Pick<HeightAdjudication, 'afltablesCm' | 'competingEvidence'>,
  canonicalHeight: number | null,
  competing: { source: string; height: number }[],
): string | null {
  if (canonicalHeight !== adj.afltablesCm) return `canonical height is now ${canonicalHeight ?? 'NULL'}, adjudicated at ${adj.afltablesCm}`;
  const now = competing.map((e) => `${e.source}:${e.height}`).sort().join(';');
  if (now !== adj.competingEvidence) return `competing evidence is now [${now}], adjudicated on [${adj.competingEvidence}]`;
  return null;
}
