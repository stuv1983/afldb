/**
 * The words the awards admin surface uses, and the small pure helpers that
 * build its URLs (AFLDB-ISSUE-165 §6).
 *
 * Pure and free of `server-only`: both the Server Components that render the
 * lists and the Client Components that render the action panels import from
 * here, so nothing in this file may reach the database.
 *
 * The three domains keep their own routes and their own vocabulary on
 * purpose (§6): an award winner, a Hall of Fame induction and an honour-team
 * selection are three different kinds of fact with three different identity
 * keys, and a single polymorphic table would have to call all three "record".
 */

export const AWARDS_ROOT = '/admin/awards';

export type HonourDomain = 'winners' | 'hall-of-fame' | 'honour-teams';

export const HONOUR_DOMAINS: readonly HonourDomain[] = ['winners', 'hall-of-fame', 'honour-teams'];

export function isHonourDomain(value: unknown): value is HonourDomain {
  return HONOUR_DOMAINS.includes(value as HonourDomain);
}

export const DOMAIN_LABELS: Record<HonourDomain, string> = {
  winners: 'Award winners',
  'hall-of-fame': 'Hall of Fame',
  'honour-teams': 'Honour & representative teams',
};

/** The singular noun each refusal sentence and each confirmation uses. */
export const DOMAIN_NOUNS: Record<HonourDomain, string> = {
  winners: 'award winner',
  'hall-of-fame': 'Hall of Fame induction',
  'honour-teams': 'honour-team selection',
};

export const DOMAIN_BLURBS: Record<HonourDomain, string> = {
  winners:
    'Every recorded winner or recipient of an award, from any source. Brownlow Medallists are '
    + 'not here: they come from the authoritative season-votes dataset.',
  'hall-of-fame':
    'Australian Football Hall of Fame inductees and Legends. An inductee later formally removed '
    + 'from the Hall keeps a removal year and stays on the public site; voiding is for a record '
    + 'that should never have been entered.',
  'honour-teams':
    'Team of the Century and similar representative selections, one row per selected person.',
};

export const STATUS_FILTER_LABELS: Record<string, string> = {
  active: 'Active only',
  void: 'Voided only',
  all: 'Active and voided',
};

export const PROVENANCE_LABELS: Record<string, string> = {
  source: 'Source-owned',
  manual: 'Manual (administrator)',
};

/**
 * The sentence a detail page shows above the correction form. A source-owned
 * row's correction must be recorded durably or the next reload reverts it; a
 * manual row's does not, because nothing reloads it.
 */
export const PROVENANCE_NOTES: Record<string, string> = {
  source:
    'This record is owned by its source and is reloaded by the importer. A correction here is '
    + 'recorded as a durable override so the next reload re-applies it rather than reverting it.',
  manual:
    'This record was created by an administrator. No importer reloads its fields, so a correction '
    + 'is an ordinary audited edit; its durable record is what survives a rebuild.',
};

export function domainListPath(domain: HonourDomain): string {
  return `${AWARDS_ROOT}/${domain}`;
}

export function domainDetailPath(domain: HonourDomain, id: number): string {
  return `${AWARDS_ROOT}/${domain}/${id}`;
}

export function domainNewPath(domain: HonourDomain): string {
  return `${AWARDS_ROOT}/${domain}/new`;
}

/** A list URL carrying its filters; empty values are dropped, never sent blank. */
export function listHref(
  domain: HonourDomain,
  filters: Record<string, string | number | undefined | null>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${domainListPath(domain)}?${qs}` : domainListPath(domain);
}

/**
 * Why a row's identity cannot be edited in place, in the words the
 * administrator sees beside the read-only fields. The mutation contract
 * refuses the change regardless (`identityFieldRefusal`); this is the reason
 * shown BEFORE they try, so the refusal is never the first they hear of it.
 */
export const IDENTITY_NOTICE =
  'These fields are what this record asserts. Changing one would silently turn this record into a '
  + 'different one and leave the audit trail describing something the database no longer says, so '
  + 'they are not editable. To correct one, void this record and record the correct one — both the '
  + 'mistake and the correction then survive as history.';
