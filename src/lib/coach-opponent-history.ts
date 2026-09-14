import 'server-only';

import {
  getOrganizationBySlug,
  type ComparisonOrganization,
} from '@/db/queries/club-comparison';
import {
  getCoachRecordAgainstOrganization,
  type CoachOrganizationRecord,
} from '@/db/queries/coaches';
import { parseSlug } from '@/lib/params';

/**
 * Stage 1C's opponent-history selection, resolved once and shared by
 * every caller (AFLDB-ISSUE-170 Stage 1D): the standalone coach page's
 * server-rendered selector, and the `/api/coaches/[id]/opponent-record`
 * route handler the player-linked coaching surface's client selector
 * calls. Neither caller re-derives "is this a real club organisation" on
 * its own, so an unresolvable slug reads the same way — the
 * `/clubs/compare` "is not a club on record" convention — everywhere.
 */
export type CoachOpponentSelection =
  | { kind: 'none' }
  | { kind: 'invalid'; requested: string }
  | { kind: 'resolved'; organization: ComparisonOrganization; record: CoachOrganizationRecord };

/**
 * `requested` is the raw, untrusted `?opponent=`/`?organization=` value.
 * Absent -> `none` (career page renders normally, Stage 1D's URL-state
 * contract). Present but unparseable, or naming no known organisation, or
 * naming a coach id that turns out not to exist -> `invalid`, never a
 * thrown error or a 500 — a hand-edited or stale URL is explained, not
 * rejected outright.
 */
export async function resolveCoachOpponentSelection(
  coachId: number,
  requested: string | undefined,
): Promise<CoachOpponentSelection> {
  if (!requested) return { kind: 'none' };

  const slug = parseSlug(requested);
  const organization = slug ? await getOrganizationBySlug(slug) : null;
  if (!organization) return { kind: 'invalid', requested };

  const record = await getCoachRecordAgainstOrganization(coachId, organization.id);
  if (!record) return { kind: 'invalid', requested };

  return { kind: 'resolved', organization, record };
}
