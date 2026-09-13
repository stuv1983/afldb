/**
 * AFLDB-ISSUE-167 — the durable identity grammar for the two special-record
 * families.
 *
 * `player_achievements` (migration 053, first-kick goal) and `after_siren_kicks`
 * (migration 089) are curated external facts. A human decision about one of
 * them — a correction, a void, a manual addition — is durable only if it is
 * keyed on something a destructive rebuild and a promotion cannot renumber. The
 * surrogate `id` is exactly what they DO renumber, so `data_overrides.entity_key`
 * carries the row's natural identity instead:
 *
 *     '<sources.key>:<source_record_id>'
 *
 * Both families reduce to that one shape, which is materially simpler than the
 * three shapes AFLDB-ISSUE-165 needed, and it is the direct payoff of the
 * identity discipline migrations 053 and 089 established: unlike `hall_of_fame`
 * (keyed `name|inducted_year`) and `honour_team_members` (keyed
 * `team|player identity`), both tables here already carry a real, tracked source
 * record id on EVERY row. Measured on `afldb_test` 2026-09-13: 334 of 334
 * first-kick rows and 126 of 126 after-siren rows.
 *
 * THE PARSE RULE IS FIRST-COLON, and that choice is load-bearing. It lets a
 * minted manual id carry its own family prefix — `'first_kick_goal:<uuid>'`, the
 * `'award_winner:<uuid>'` shape AFLDB-ISSUE-165 established — without a second
 * separator and without ambiguity. It also locates the one refusal that really
 * matters: a colon in the SOURCE KEY would steal the split point, so it is
 * refused absolutely, while a colon further along is merely part of the record
 * id.
 *
 * The separate `assertSourceOwnedRecordId()` guard refuses a colon in an id
 * supplied by a source MANIFEST. That is a forward guard, not a migration:
 * probe P-3 measured zero colon-bearing `source_record_id` values across both
 * tables. It deliberately does NOT apply to a minted manual id, which contains
 * one by construction.
 *
 * DELIBERATELY PURE. No `server-only`, no database handle, no import of
 * anything that has either — this grammar is asserted by the migration, by
 * `tools/db/promotion-inventory.ts`'s lineage identities, by the replay
 * adapters and by the admin writer, so every one of them must be able to import
 * it.
 */
import { randomUUID } from 'node:crypto';

/**
 * The provenance source key a row an administrator created carries. Restated
 * here rather than imported because `src/db/queries/player-identity.ts` is
 * `server-only`; `tests/special-records-identity.test.ts` reads that file as
 * source and fails if the two ever disagree.
 */
export const MANUAL_SOURCE_KEY = 'manual_admin_edit';

/**
 * The two tables, and only these two. D-1 (2026-09-13) EXCLUDED the
 * family / father-son domain from P4 rather than deferring it, and
 * AFLDB-ISSUE-155 §12 is explicit that "no other record family is added merely
 * because it is manually curated".
 */
export const SPECIAL_RECORD_TABLES = ['player_achievements', 'after_siren_kicks'] as const;
export type SpecialRecordTable = (typeof SPECIAL_RECORD_TABLES)[number];

/**
 * The family prefix a minted manual `source_record_id` carries, one per table.
 * `first_kick_goal` matches `player_achievements.achievement_type`, which is the
 * name the domain already uses; `after_siren` matches the artefact and the NL
 * grain (`src/search/nl/plan.ts`).
 */
export const SPECIAL_RECORD_FAMILIES = ['first_kick_goal', 'after_siren'] as const;
export type SpecialRecordFamily = (typeof SPECIAL_RECORD_FAMILIES)[number];

/** Which family a table's manual rows are minted under. */
export const FAMILY_BY_TABLE: Readonly<Record<SpecialRecordTable, SpecialRecordFamily>> = {
  player_achievements: 'first_kick_goal',
  after_siren_kicks: 'after_siren',
};

/**
 * `'<sources.key>:<source_record_id>'`.
 *
 * Refuses a colon in the source key, and refuses either half empty: an
 * unparseable key is worse than no key, because it silently attaches a durable
 * decision to nothing.
 */
export function specialRecordEntityKey(sourceKey: string, sourceRecordId: string): string {
  if (!sourceKey) {
    throw new Error('A special-record entity_key needs a source key; none was given.');
  }
  if (sourceKey.includes(':')) {
    throw new Error(
      `Refusing a source key containing a colon (${JSON.stringify(sourceKey)}): the entity_key `
      + 'grammar splits on the FIRST colon, so a colon here would make the two halves '
      + 'unrecoverable.',
    );
  }
  if (!sourceRecordId) {
    throw new Error(
      `Refusing to key a ${sourceKey} record with an empty source_record_id: the source `
      + 'uniqueness constraints are UNIQUE NULLS NOT DISTINCT, so an empty identity collapses '
      + 'distinct rows together instead of distinguishing them.',
    );
  }
  return `${sourceKey}:${sourceRecordId}`;
}

/** The inverse, splitting on the FIRST colon only. */
export function parseSpecialRecordEntityKey(
  entityKey: string,
): { sourceKey: string; sourceRecordId: string } {
  const colon = entityKey.indexOf(':');
  if (colon <= 0 || colon === entityKey.length - 1) {
    throw new Error(
      `Not a special-record entity_key: ${JSON.stringify(entityKey)}. The shape is `
      + "'<sources.key>:<source_record_id>'.",
    );
  }
  return {
    sourceKey: entityKey.slice(0, colon),
    sourceRecordId: entityKey.slice(colon + 1),
  };
}

/**
 * The forward guard on an id that came from a source MANIFEST (AFLDB-ISSUE-167
 * §5.3). Nothing in either table carries a colon today; this keeps it that way,
 * so a manifest id and a minted manual id stay distinguishable on sight as well
 * as by their source.
 */
export function assertSourceOwnedRecordId(sourceRecordId: string): void {
  if (!sourceRecordId) {
    throw new Error('A source-owned special record needs a source_record_id; none was given.');
  }
  if (sourceRecordId.includes(':')) {
    throw new Error(
      `Refusing a source-owned source_record_id containing a colon `
      + `(${JSON.stringify(sourceRecordId)}). A colon is reserved for the minted manual ids, `
      + 'so admitting one here would make a manifest row indistinguishable from an '
      + 'administrator-created one by inspection.',
    );
  }
}

/**
 * Mints the `source_record_id` for a record an administrator creates:
 * `'<family>:<uuid>'`, carried on a row whose `source_id` is `manual_admin_edit`.
 *
 * Collision with a source-owned key is impossible on two independent axes — the
 * uuid, and the different `source_id` — which is why neither
 * `player_achievements_source_uq` nor `after_siren_kicks_source_uq` needs to
 * become active-row-only the way migration 101's keys did.
 */
export function mintManualSourceRecordId(family: SpecialRecordFamily): string {
  if (!SPECIAL_RECORD_FAMILIES.includes(family)) {
    throw new Error(
      `Unknown special-record family ${JSON.stringify(family)}. P4 covers `
      + `${SPECIAL_RECORD_FAMILIES.join(' and ')} only (D-1, 2026-09-13).`,
    );
  }
  return `${family}:${randomUUID()}`;
}
