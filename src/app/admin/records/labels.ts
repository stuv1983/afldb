/**
 * The words the special-records admin surface uses, and the small pure helpers
 * that build its URLs (AFLDB-ISSUE-167 §10).
 *
 * Pure and free of `server-only`: the Server Components that render the lists
 * import from here, and so will the Client Components that render the action
 * panels when Stage 6 adds them, so nothing in this file may reach the
 * database.
 *
 * THE TWO FAMILIES KEEP THEIR OWN ROUTES AND THEIR OWN VOCABULARY, under one
 * nav entry (§10.1). A first-kick goal and a kick after the siren are
 * different kinds of fact with different correctable fields and different
 * football context; a single merged list would have to call both "record" and
 * would hide exactly the distinctions an administrator needs. The slugs match
 * the PUBLIC pages — /records/first-kick-goal and /records/after-the-siren —
 * so the two halves of the site name the same thing the same way.
 */
import { specialRecordEntityKey } from '@/lib/special-records/identity';

export const RECORDS_ROOT = '/admin/records';

export type RecordFamilySlug = 'first-kick-goal' | 'after-the-siren';

export const RECORD_FAMILY_SLUGS: readonly RecordFamilySlug[] = [
  'first-kick-goal', 'after-the-siren',
];

export function isRecordFamilySlug(value: unknown): value is RecordFamilySlug {
  return RECORD_FAMILY_SLUGS.includes(value as RecordFamilySlug);
}

export const FAMILY_LABELS: Record<RecordFamilySlug, string> = {
  'first-kick-goal': 'First-kick goal',
  'after-the-siren': 'After the siren',
};

/** The singular noun each sentence on the surface uses. */
export const FAMILY_NOUNS: Record<RecordFamilySlug, string> = {
  'first-kick-goal': 'first-kick-goal record',
  'after-the-siren': 'after-the-siren record',
};

export const FAMILY_BLURBS: Record<RecordFamilySlug, string> = {
  'first-kick-goal':
    'Players who kicked a goal with their first kick in senior football. Curated from '
    + 'Wikipedia and keyed on a tracked manifest id; AFLDB holds no play-by-play data these '
    + 'could be recomputed from.',
  'after-the-siren':
    'Kicks taken after the siren — to win, to draw, or missed — including pre-season and '
    + 'night-series matches, which keep their competition name and resolve to no match row.',
};

/** Where the public site says the same thing, for a one-click comparison. */
export const FAMILY_PUBLIC_PATHS: Record<RecordFamilySlug, string> = {
  'first-kick-goal': '/records/first-kick-goal',
  'after-the-siren': '/records/after-the-siren',
};

/**
 * `all` is FIRST and is the default, which is this surface's one deliberate
 * departure from the awards lists (AFLDB-ISSUE-165 opens on active). The
 * surface exists to report what the lifecycle has taken out of the public
 * site, and 334 + 126 rows make showing everything free.
 */
export const STATUS_FILTER_LABELS: Record<string, string> = {
  all: 'Active and voided',
  active: 'Active only',
  void: 'Voided only',
};

export const PROVENANCE_LABELS: Record<string, string> = {
  source: 'Source-owned',
  manual: 'Manual (administrator)',
};

export const LINK_FILTER_LABELS: Record<string, string> = {
  linked: 'Linked to a player',
  unlinked: 'Not linked',
};

/**
 * The sentence a detail page shows about provenance. A source-owned row is
 * reloaded by its importer; a manual row is not. Stage 3 states the difference
 * because it is what an administrator needs to know BEFORE Stage 6 lets them
 * change anything.
 */
export const PROVENANCE_NOTES: Record<string, string> = {
  source:
    'This record is owned by its source and is reloaded by its importer. Correcting it will '
    + 'need a durable override so the next reload re-applies the correction rather than '
    + 'reverting it.',
  manual:
    'This record was created by an administrator. No importer reloads its fields; its durable '
    + 'record is what survives a rebuild.',
};

/**
 * Why the identity-bearing facts are shown and not offered as fields (§4,
 * §10.2). Stated here, on a read-only surface, so that when Stage 6 refuses an
 * identity edit the refusal is never the first an administrator hears of the
 * rule.
 */
export const IDENTITY_NOTICE =
  'These facts are what this record asserts, and they are what its durable identity is made '
  + 'of. Changing one would silently turn this record into a different one and leave the audit '
  + 'trail describing something the database no longer says. A wrong identity is corrected by '
  + 'voiding this record and recording the correct one, so that both the mistake and the '
  + 'correction survive as history.';

/**
 * Why the link state is shown and not actionable (decision D-2, 2026-09-13).
 * The gap is deliberate and is recorded as a follow-up: it is visible here
 * rather than silent.
 */
export const LINK_STATE_NOTICE =
  'Player links are decided in Player links, not here, and after-the-siren rows are not in '
  + 'that queue today. The link state and candidate count are shown so an unresolved record is '
  + 'visible as unresolved; there is deliberately no way to link one from this surface, which '
  + 'would create a second authority over the same decision.';

/** Why the derived fields can never be typed into, in the words shown beside them. */
export const DERIVED_NOTICE =
  'Derived fields are computed from the record rather than entered on it: the player link and '
  + 'its candidate count come from the link decision, and the match is resolved from the '
  + 'season, round and clubs. They are shown because they are what the record resolved to.';

/**
 * What the hub promises, told per role rather than per stage.
 *
 * Stage 3 shipped one unconditional sentence, because at Stage 3 the surface
 * really was read-only for everyone. Stage 6 gave Super Admin the mutation
 * surface and did not revisit this copy, so DEV showed a Super Admin "nothing
 * here changes a record" directly above controls that change records
 * (AFLDB-ISSUE-167 §27). An administrator acts on what the page tells them, so
 * the sentence is now chosen by the same `data.specialRecords.edit` check that
 * decides whether the controls render at all.
 */
export const READ_ONLY_NOTICE =
  'This surface is read-only: it shows what each record asserts, where it came from, whether '
  + 'it stands, and every manual edit ever recorded against it. Nothing here changes a record, '
  + 'and nothing here deletes one.';

/** The same promise for a role that CAN act: correctable, never deletable. */
export const EDITABLE_NOTICE =
  'This surface shows what each record asserts, where it came from, whether it stands, and '
  + 'every manual edit ever recorded against it. A record can be corrected, suppressed, '
  + 'reinstated or replaced here, and nothing here deletes one: a suppressed record is kept, '
  + 'with its reason and its audit trail.';

/**
 * The row's durable identity, or null when one cannot be formed.
 *
 * `specialRecordEntityKey` throws on an unformable key, which is right for the
 * writers: a durable decision attached to nothing is worse than no decision.
 * A READING surface must not 500 on such a row — it must show it, because a
 * record that cannot be administered is exactly what an administrator needs to
 * see. Measured 2026-09-13, every one of the 460 rows can form one.
 */
export function durableIdentityOf(
  sourceKey: string | null, sourceRecordId: string | null,
): string | null {
  if (!sourceKey || !sourceRecordId) return null;
  try {
    return specialRecordEntityKey(sourceKey, sourceRecordId);
  } catch {
    return null;
  }
}

export function familyListPath(family: RecordFamilySlug): string {
  return `${RECORDS_ROOT}/${family}`;
}

export function familyDetailPath(family: RecordFamilySlug, id: number): string {
  return `${RECORDS_ROOT}/${family}/${id}`;
}

/** A list URL carrying its filters; empty values are dropped, never sent blank. */
export function listHref(
  family: RecordFamilySlug,
  filters: Record<string, string | number | undefined | null>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${familyListPath(family)}?${qs}` : familyListPath(family);
}
