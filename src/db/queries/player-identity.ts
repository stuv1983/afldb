import 'server-only';

import type postgres from 'postgres';

/**
 * A player's DURABLE identity — the one shared module (AFLDB-ISSUE-161 §29).
 *
 * Extracted verbatim from `src/db/queries/admin-draft.ts` and
 * `src/db/queries/players.ts` when season-list administration became the second
 * domain that has to name a player in a `data_overrides` payload. The rule is
 * the same for both and must stay the same for both: a promotion renumbers
 * `players.id`, so a durable record names a person by an AFL Tables profile
 * path or by a minted `manual_admin_edit` token, and by nothing else. There is
 * exactly one identity system; a second one would be two answers to "who is
 * this row about".
 *
 * Behaviour is unchanged by the move — `admin-draft.ts` re-exports every name
 * it used to own, and `players.ts` re-exports `readManualPlayerToken`, so no
 * caller and no test had to change.
 *
 * NAMES NEVER DECIDE IDENTITY (I-10). Nothing here reads a display name, a
 * search name or a date of birth. A search UI may RANK candidates by name; only
 * this module says who a row is about, and when it cannot say so with
 * certainty it refuses rather than choosing.
 */

export const MANUAL_SOURCE_KEY = 'manual_admin_edit';

/** The `data_overrides.entity_key` of a MANUAL selection or player. */
export function manualEntityKey(token: string): string {
  return `${MANUAL_SOURCE_KEY}:${token}`;
}

/**
 * The `manual_admin_edit` token a player carries, or null when it holds none
 * (or, refusing to choose, more than one). Read inside the caller's
 * transaction: nothing identity-shaped is ever trusted from the browser
 * (AFLDB-ISSUE-160 §4).
 */
export async function readManualPlayerToken(
  tx: postgres.TransactionSql,
  playerId: number,
): Promise<string | null> {
  const rows = await tx<{ externalId: string }[]>`
    SELECT e.external_id AS "externalId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE e.player_id = ${playerId}
       AND s.key = 'manual_admin_edit'
       AND e.status IN ('unique', 'resolved')
     ORDER BY e.external_id
  `;
  return rows.length === 1 ? rows[0].externalId : null;
}

/**
 * The outcome of resolving one player to one identity string.
 *
 * `'ambiguous_identity'` is a member of `DraftRefusalReason` and of
 * `SeasonListRefusalReason`, so both domains map a refusal straight through
 * without translating it.
 */
export type PlayerIdentityResolution =
  | { ok: true; identity: string; minted: false }
  | { ok: false; error: string; reason: 'ambiguous_identity' }
  | { ok: true; identity: null; minted: false };

/**
 * The player's DURABLE identity string for an override payload, resolved
 * server-side inside the transaction (AFLDB-ISSUE-160 §4 rule 2 — nothing
 * identity-shaped is trusted from the browser). AFL Tables path first, then the
 * manual token.
 *
 * `{ ok: true, identity: null }` means the player holds NEITHER — a legacy
 * identity-less row. That is not an error here: the caller decides what it
 * means. `admin-draft.ts` mints one in the adopt path and refuses elsewhere;
 * `admin-season-lists.ts` always refuses, because minting an identity is a
 * player-lifecycle decision and season-list administration is not the place to
 * take one.
 */
export async function resolvePlayerIdentity(
  tx: postgres.TransactionSql,
  playerId: number,
): Promise<PlayerIdentityResolution> {
  const afl = await tx<{ externalId: string }[]>`
    SELECT DISTINCT e.external_id AS "externalId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE e.player_id = ${playerId}
       AND s.key = 'afltables'
       AND e.match_method = 'afltables_profile_url'
       AND e.status IN ('unique', 'resolved')
  `;
  if (afl.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous_identity',
      error: 'That player holds more than one AFL Tables profile identity. Refusing to choose one; '
        + 'reconcile the identity before recording a selection against them.',
    };
  }
  if (afl.length === 1) return { ok: true, identity: `afltables:${afl[0].externalId}`, minted: false };

  const token = await readManualPlayerToken(tx, playerId);
  if (token) return { ok: true, identity: manualEntityKey(token), minted: false };
  return { ok: true, identity: null, minted: false };
}
