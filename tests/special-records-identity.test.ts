/**
 * AFLDB-ISSUE-167 Stage 2 — the special-record durable identity grammar.
 *
 * `data_overrides.entity_key` is the row's DURABLE NATURAL identity, never its
 * `id`: ids are renumbered by a destructive rebuild and by a promotion, so an
 * override keyed on one re-attaches a human decision to a different record.
 * Both P4 families reduce to the same shape — `'<sources.key>:<source_record_id>'`
 * — because unlike `hall_of_fame` and `honour_team_members` both already carry a
 * real, tracked source record id on every row (migrations 053 and 089).
 *
 * The parse rule is FIRST-colon, which is what makes a minted manual id
 * (`'first_kick_goal:<uuid>'`, the `award_winner:<uuid>` shape AFLDB-ISSUE-165
 * established) expressible without a second separator. That is also why the
 * absolute refusal is on a colon in the SOURCE KEY, which would steal the split
 * point, rather than on a colon anywhere in the string.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MANUAL_SOURCE_KEY,
  SPECIAL_RECORD_FAMILIES,
  SPECIAL_RECORD_TABLES,
  assertSourceOwnedRecordId,
  mintManualSourceRecordId,
  parseSpecialRecordEntityKey,
  specialRecordEntityKey,
} from '@/lib/special-records/identity';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('special-record entity_key formation', () => {
  it('is the source key, a colon, and the source record id', () => {
    expect(specialRecordEntityKey('wikipedia_first_kick_goal', 'fkg-042'))
      .toBe('wikipedia_first_kick_goal:fkg-042');
    expect(specialRecordEntityKey('wikipedia_after_siren_kicks', '1978-r14-brisbane'))
      .toBe('wikipedia_after_siren_kicks:1978-r14-brisbane');
  });

  it('refuses a colon in the SOURCE KEY, which would steal the split point', () => {
    expect(() => specialRecordEntityKey('wikipedia:first_kick_goal', 'fkg-042'))
      .toThrow(/source key/i);
  });

  it('refuses an empty half rather than minting a key that cannot be parsed back', () => {
    expect(() => specialRecordEntityKey('', 'fkg-042')).toThrow();
    expect(() => specialRecordEntityKey('wikipedia_first_kick_goal', '')).toThrow();
  });

  it('round-trips through the FIRST-colon parse, minted ids included', () => {
    for (const [sourceKey, recordId] of [
      ['wikipedia_first_kick_goal', 'fkg-042'],
      ['wikipedia_after_siren_kicks', '1978-r14-brisbane'],
      // The minted manual id carries its own colon, and the first-colon rule is
      // exactly what keeps that unambiguous.
      [MANUAL_SOURCE_KEY, 'first_kick_goal:0f9c1f3a-1111-4222-8333-444455556666'],
      [MANUAL_SOURCE_KEY, 'after_siren:0f9c1f3a-1111-4222-8333-444455556666'],
    ] as const) {
      const key = specialRecordEntityKey(sourceKey, recordId);
      expect(parseSpecialRecordEntityKey(key)).toEqual({ sourceKey, sourceRecordId: recordId });
    }
  });

  it('refuses to parse a string with no colon at all', () => {
    expect(() => parseSpecialRecordEntityKey('wikipedia_first_kick_goal')).toThrow();
  });
});

describe('source-owned record ids', () => {
  /*
   * The forward guard AFLDB-ISSUE-167 §5.3 asks for. Probe P-3 measured 0
   * colon-bearing source_record_id values across both tables (460 rows,
   * afldb_test 2026-09-13), so this refuses a value that has never existed
   * rather than migrating one that has.
   */
  it('accepts the tracked manifest shapes', () => {
    expect(() => assertSourceOwnedRecordId('fkg-042')).not.toThrow();
    expect(() => assertSourceOwnedRecordId('fkg-334')).not.toThrow();
    expect(() => assertSourceOwnedRecordId('1978-r14-brisbane')).not.toThrow();
  });

  it('refuses a colon-bearing manifest id', () => {
    expect(() => assertSourceOwnedRecordId('fkg:042')).toThrow(/colon/i);
  });

  it('refuses an empty id, which UNIQUE NULLS NOT DISTINCT would silently collapse', () => {
    expect(() => assertSourceOwnedRecordId('')).toThrow();
  });
});

describe('minted manual identity', () => {
  it('mints one id per family, prefixed by the family', () => {
    for (const family of SPECIAL_RECORD_FAMILIES) {
      const id = mintManualSourceRecordId(family);
      expect(id.startsWith(`${family}:`)).toBe(true);
    }
  });

  it('cannot collide with a source-owned key by construction', () => {
    // Two independent axes: the minted id carries a uuid AND the manual row
    // carries a different source_id, so its entity_key differs in BOTH halves
    // from anything the manifest can produce.
    const minted = new Set<string>();
    for (let i = 0; i < 500; i += 1) minted.add(mintManualSourceRecordId('first_kick_goal'));
    expect(minted.size).toBe(500);

    for (const id of minted) {
      expect(() => assertSourceOwnedRecordId(id)).toThrow();
      expect(specialRecordEntityKey(MANUAL_SOURCE_KEY, id).startsWith(`${MANUAL_SOURCE_KEY}:`))
        .toBe(true);
    }
  });

  it('refuses a family it does not know', () => {
    expect(() => mintManualSourceRecordId('hall_of_fame' as never)).toThrow();
  });

  it('mints from WEB crypto, so the grammar stays bundlable for a client', () => {
    // AFLDB-ISSUE-167 §26 (Stage 7). This module is imported by
    // src/app/admin/records/labels.ts, which a CLIENT Component imports, so a
    // `node:` builtin anywhere in it fails the production build outright:
    // "UnhandledSchemeError: Reading from "node:crypto" is not handled by
    // plugins". Nothing but `npm run build` catches it — tsc, ESLint and every
    // vitest suite run in Node, where the import resolves perfectly.
    const source = readSource('src/lib/special-records/identity.ts');
    const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line));
    expect(imports, 'identity.ts must import nothing at all').toEqual([]);
    expect(source).toContain('crypto.randomUUID()');
    // And the id is still a v4 uuid behind its family prefix.
    expect(mintManualSourceRecordId('after_siren').slice('after_siren:'.length))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('the module agrees with the rest of the repository', () => {
  it("names the same manual source key player-identity.ts writes", () => {
    // player-identity.ts is `server-only`, so it is read as SOURCE rather than
    // imported: a pure grammar module must stay importable from anywhere.
    const source = readSource('src/db/queries/player-identity.ts');
    expect(source).toContain(`export const MANUAL_SOURCE_KEY = '${MANUAL_SOURCE_KEY}';`);
  });

  it('names exactly the two tables migration 102 admits, and no third family', () => {
    expect([...SPECIAL_RECORD_TABLES].sort())
      .toEqual(['after_siren_kicks', 'player_achievements']);
    // D-1 (2026-09-13) EXCLUDED the family / father-son domain from P4. A third
    // entry here is the first symptom of that decision being reopened by
    // accident.
    expect(SPECIAL_RECORD_FAMILIES).toHaveLength(2);
  });

  it('is admitted by migration 102 on both allowlists', () => {
    const migration = readSource('src/db/migrations/102_special_records_lifecycle.sql');
    const overrideCheck = migration.slice(
      migration.indexOf('ADD CONSTRAINT data_overrides_entity_type_check'),
    );
    const editsCheck = migration.slice(
      migration.indexOf('ADD CONSTRAINT data_edits_table_name_check'),
    );
    for (const table of SPECIAL_RECORD_TABLES) {
      expect(overrideCheck.slice(0, overrideCheck.indexOf('));'))).toContain(`'${table}'`);
      expect(editsCheck.slice(0, editsCheck.indexOf('));'))).toContain(`'${table}'`);
    }
  });
});
