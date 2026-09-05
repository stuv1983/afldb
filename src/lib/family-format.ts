import type {
  PlayerFamilyFatherSonAsFather,
  PlayerFamilyFatherSonAsSon,
} from '@/db/queries/players';

/**
 * Human label for the father-son source's `competition` pathway
 * (AFLDB-ISSUE-118 §23.29 F.1). Only 'national' | 'rookie' | 'pre-draft' are
 * ever written by `father_son.py load`; an unrecognised value is shown
 * verbatim rather than swallowed, so a future pathway cannot silently
 * disappear from the profile.
 */
export function competitionLabel(competition: string | null): string | null {
  if (competition === 'national') return 'National Draft';
  if (competition === 'rookie') return 'Rookie Draft';
  if (competition === 'pre-draft') return 'Pre-Draft Selection';
  return competition;
}

/**
 * One line describing a father-son selection: club, year and pathway, plus
 * the pick when the source recorded one. Never prints a bare "null" for a
 * missing competition or pick -- both are simply omitted.
 */
export function formatSelectionDetail(row: {
  clubName: string | null;
  draftYear: number;
  competition: string | null;
  selectionPick: number | null;
}): string {
  const parts: string[] = [];
  if (row.clubName) parts.push(row.clubName);

  const label = competitionLabel(row.competition);
  parts.push(label ? `${row.draftYear} ${label}` : String(row.draftYear));

  if (row.selectionPick !== null) parts.push(`Pick ${row.selectionPick}`);

  return parts.join(' · ');
}

/**
 * Label for a generic `player_relationships` row, from this player's
 * perspective. A `sibling` row says what the source evidenced through the
 * loader's `relationship_label` (§23.31: `brothers` / `twin brothers`,
 * `sisters`, else sex not evidenced) -- a linked player's unlinked sister
 * must not be shown as a brother. The asymmetric types follow the convention
 * the existing father-son loader already writes (father as person A, son as
 * person B -- §23.29 F.8), which the query's `direction` already reflects.
 */
export function relationshipLabel(relationshipType: string, direction: 'from' | 'to', label = ''): string {
  switch (relationshipType) {
    case 'sibling':
      if (label === 'brothers') return 'Brother';
      if (label === 'twin brothers') return 'Twin brother';
      if (label === 'sisters') return 'Sister';
      if (label === 'twins') return 'Twin';
      return 'Sibling';
    case 'parent_child':
      return direction === 'from' ? 'Parent' : 'Child';
    case 'grandparent_grandchild':
      return direction === 'from' ? 'Grandparent' : 'Grandchild';
    case 'aunt_uncle_niece_nephew':
      return direction === 'from' ? 'Aunt/Uncle' : 'Niece/Nephew';
    case 'cousin':
      return 'Cousin';
    case 'spouse':
      return 'Spouse';
    case 'in_law':
      return 'In-law';
    default:
      return 'Relative';
  }
}

/** True when there is anything worth a Family section for this player. */
export function hasFamilyContent(family: {
  relationships: unknown[];
  fatherSonAsSon: PlayerFamilyFatherSonAsSon[];
  fatherSonAsFather: PlayerFamilyFatherSonAsFather[];
}): boolean {
  return family.relationships.length > 0
    || family.fatherSonAsSon.length > 0
    || family.fatherSonAsFather.length > 0;
}
