/**
 * Draft and recruitment categories (AFLDB-ISSUE-336).
 *
 * `draft_picks.draft_kind` is the canonical acquisition category, one of the ten kinds
 * enumerated by `data/reference/draftguru-event-kinds.json`; `draft_type` is the source's
 * display label (it keeps the `National` / `National Draft` wording split that `draft_kind`
 * collapses). A pick number is only meaningful WITHIN its kind: National pick 1 and Rookie
 * pick 1 are different selections, and a Trade, Free Agency, Pre-Draft or Post-Draft
 * acquisition carries no number at all.
 *
 * Father–Son is not a category. It is a signing mechanism recorded in
 * `draft_picks.signing_kind` and overlaps the real category (National, Rookie, Pre-Draft),
 * so it is offered as a filtered view over the same rows, never as a separate count.
 *
 * Pure module: no database access, safe for server and client code and for unit tests.
 */

export type DraftCategory = {
  /** The stored `draft_picks.draft_kind`. */
  kind: string;
  /** URL value of the `view` parameter. */
  slug: string;
  /** Short label: "National", "Rookie", "Trade". */
  short: string;
  /** Event label: "National Draft", "Pre-Draft selection". */
  label: string;
  /** True when the source numbers selections within this kind. */
  numbered: boolean;
  /** Primary categories always have a tab; the others appear when the year has rows. */
  primary: boolean;
};

/** Display and ordering sequence. Every kind of the enumeration appears exactly once. */
export const DRAFT_CATEGORIES: readonly DraftCategory[] = [
  { kind: 'national', slug: 'national', short: 'National', label: 'National Draft', numbered: true, primary: true },
  { kind: 'rookie', slug: 'rookie', short: 'Rookie', label: 'Rookie Draft', numbered: true, primary: true },
  { kind: 'preseason', slug: 'pre-season', short: 'Pre-Season', label: 'Pre-Season Draft', numbered: true, primary: true },
  { kind: 'midseason', slug: 'mid-season', short: 'Mid-Season', label: 'Mid-Season Draft', numbered: true, primary: true },
  { kind: 'trade', slug: 'trade', short: 'Trade', label: 'Trade', numbered: false, primary: true },
  { kind: 'pre_draft', slug: 'pre-draft', short: 'Pre-Draft', label: 'Pre-Draft selection', numbered: false, primary: false },
  { kind: 'post_draft', slug: 'post-draft', short: 'Post-Draft', label: 'Post-Draft selection', numbered: false, primary: false },
  { kind: 'free_agency', slug: 'free-agency', short: 'Free Agency', label: 'Free Agency', numbered: false, primary: false },
  { kind: 'mini_draft', slug: 'mini-draft', short: 'Mini-Draft', label: 'Mini-Draft', numbered: true, primary: false },
  {
    kind: 'training_squad_selection', slug: 'training-squad', short: 'Training Squad',
    label: 'Training Squad Selection', numbered: true, primary: false,
  },
];

/** The stored `signing_kind` that marks a Father–Son selection. */
export const FATHER_SON_SIGNING_KIND = 'Father-Son';
export const FATHER_SON_LABEL = 'Father–Son';

export const ALL_VIEW = 'all';
export const FATHER_SON_VIEW = 'father-son';

export type DraftView =
  | { type: 'all' }
  | { type: 'category'; category: DraftCategory }
  | { type: 'father-son' };

const BY_KIND = new Map(DRAFT_CATEGORIES.map((c) => [c.kind, c]));
const BY_SLUG = new Map(DRAFT_CATEGORIES.map((c) => [c.slug, c]));

export function draftCategoryForKind(kind: string | null | undefined): DraftCategory | null {
  return kind ? BY_KIND.get(kind) ?? null : null;
}

/** The view a `view` parameter names. Unknown, empty or absent values are the All view. */
export function parseDraftView(value: string | undefined): DraftView {
  if (value === FATHER_SON_VIEW) return { type: 'father-son' };
  const category = value ? BY_SLUG.get(value) : undefined;
  return category ? { type: 'category', category } : { type: 'all' };
}

/** The `view` parameter value for a view, or undefined for All (the default). */
export function draftViewParam(view: DraftView): string | undefined {
  if (view.type === 'father-son') return FATHER_SON_VIEW;
  if (view.type === 'category') return view.category.slug;
  return undefined;
}

/** True when the stored signing kind is Father–Son. */
export function isFatherSon(signingKind: string | null | undefined): boolean {
  return signingKind === FATHER_SON_SIGNING_KIND;
}

type SelectionFacts = {
  draftKind: string | null;
  draftType: string;
  pickNumber: number | null;
  signingKind?: string | null;
};

/** "National", "Rookie" ... or the source's own label when the kind is not enumerated. */
export function categoryShortLabel(facts: Pick<SelectionFacts, 'draftKind' | 'draftType'>): string {
  return draftCategoryForKind(facts.draftKind)?.short ?? facts.draftType;
}

/** "National Draft", "Pre-Draft selection" ... or the source's own label. */
export function categoryEventLabel(facts: Pick<SelectionFacts, 'draftKind' | 'draftType'>): string {
  return draftCategoryForKind(facts.draftKind)?.label ?? facts.draftType;
}

/**
 * The selection inside its category: "National — Pick 4 — Father–Son", "Trade",
 * "Pre-Draft — Father–Son". A pick number is shown only when one is recorded.
 */
export function selectionLabel(facts: SelectionFacts): string {
  const parts = [categoryShortLabel(facts)];
  if (facts.pickNumber !== null) parts.push(`Pick ${facts.pickNumber}`);
  if (isFatherSon(facts.signingKind)) parts.push(FATHER_SON_LABEL);
  return parts.join(' — ');
}

/** The acquisition event with its year: "2025 Rookie Draft — Pick 1". */
export function draftEventLabel(facts: SelectionFacts & { draftYear: number }): string {
  const parts = [`${facts.draftYear} ${categoryEventLabel(facts)}`];
  if (facts.pickNumber !== null) parts.push(`Pick ${facts.pickNumber}`);
  if (isFatherSon(facts.signingKind)) parts.push(FATHER_SON_LABEL);
  return parts.join(' — ');
}

/** The year page opened on the selection's own category. */
export function draftYearViewPath(year: number, kind: string | null | undefined): string {
  const category = draftCategoryForKind(kind);
  return category ? `/draft/${year}?view=${category.slug}` : `/draft/${year}`;
}

/** Ordering rank of a kind; unknown kinds sort after every enumerated one. */
export function draftCategoryRank(kind: string | null | undefined): number {
  const index = DRAFT_CATEGORIES.findIndex((c) => c.kind === kind);
  return index === -1 ? DRAFT_CATEGORIES.length : index;
}

for (const c of DRAFT_CATEGORIES) {
  // The kinds are interpolated into a constant SQL CASE expression (draft.ts), so they
  // must stay plain identifiers.
  if (!/^[a-z_]+$/.test(c.kind)) throw new Error(`draft kind ${c.kind} is not a plain identifier`);
}

/** SQL CASE giving each stored draft_kind its display rank. Built only from the constants above. */
export const DRAFT_KIND_RANK_SQL = `CASE dp.draft_kind ${DRAFT_CATEGORIES.map(
  (c, i) => `WHEN '${c.kind}' THEN ${i}`,
).join(' ')} ELSE ${DRAFT_CATEGORIES.length} END`;
