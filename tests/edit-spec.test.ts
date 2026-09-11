import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EDITABLE_ENTITIES, validateFieldValue } from '@/lib/edit/spec';

const players = EDITABLE_ENTITIES.players;
const matches = EDITABLE_ENTITIES.matches;

describe('validateFieldValue', () => {
  it('accepts a valid date and rejects a malformed one', () => {
    expect(validateFieldValue(players.fields.dob, '1954-02-07')).toEqual({ ok: true, value: '1954-02-07' });
    expect(validateFieldValue(players.fields.dob, '07/02/1954').ok).toBe(false);
    // A shape-valid but impossible date must not pass.
    expect(validateFieldValue(players.fields.dob, '1954-02-31').ok).toBe(false);
  });

  it('treats blank as NULL only when the field is nullable', () => {
    expect(validateFieldValue(players.fields.dob, '  ')).toEqual({ ok: true, value: null });
    expect(validateFieldValue(players.fields.display_name, '').ok).toBe(false);
  });

  it('enforces integer bounds', () => {
    expect(validateFieldValue(players.fields.height_cm, '198')).toEqual({ ok: true, value: 198 });
    expect(validateFieldValue(players.fields.height_cm, '119').ok).toBe(false);
    expect(validateFieldValue(players.fields.height_cm, '231').ok).toBe(false);
    expect(validateFieldValue(players.fields.height_cm, '18.5').ok).toBe(false);
  });

  it('restricts enums to the declared vocabulary', () => {
    expect(validateFieldValue(players.fields.dob_confidence, 'sourced')).toEqual({ ok: true, value: 'sourced' });
    expect(validateFieldValue(players.fields.dob_confidence, 'certain').ok).toBe(false);
  });

  it('caps text length', () => {
    expect(validateFieldValue(players.fields.surname, 'x'.repeat(61)).ok).toBe(false);
  });

  it('accepts a zero attendance — a confirmed zero is a real figure', () => {
    expect(validateFieldValue(matches.fields.attendance, '0')).toEqual({ ok: true, value: 0 });
  });

  it('validates draft_picks fields properly', () => {
    const draft = EDITABLE_ENTITIES.draft_picks;
    expect(draft).toBeDefined();
    expect(validateFieldValue(draft.fields.player_name_raw, 'Riley Onley')).toEqual({ ok: true, value: 'Riley Onley' });
    expect(validateFieldValue(draft.fields.player_name_raw, '')).toEqual({ ok: false, error: 'Player name cannot be empty.' });
    expect(validateFieldValue(draft.fields.height_cm, '195')).toEqual({ ok: true, value: 195 });
    expect(validateFieldValue(draft.fields.weight_kg, '88')).toEqual({ ok: true, value: 88 });
    expect(validateFieldValue(draft.fields.draft_age, '18')).toEqual({ ok: true, value: 18 });
    expect(validateFieldValue(draft.fields.draft_age, '12').ok).toBe(false);
  });
});

describe('EDITABLE_ENTITIES integrity', () => {
  it('every group field exists in its entity', () => {
    for (const entity of Object.values(EDITABLE_ENTITIES)) {
      for (const group of Object.values(entity.groups)) {
        for (const fieldKey of group.fields) {
          expect(entity.fields[fieldKey], `${entity.key}.${group.key}.${fieldKey}`).toBeDefined();
        }
      }
    }
  });

  it('never lists a derived or identity column as editable', () => {
    const forbidden = ['id', 'slug', 'search_name', 'sort_name', 'search_rank',
      'debut_season', 'final_season', 'legacy_player_id', 'legacy_match_id',
      'result', 'winner_club_id', 'margin', 'home_score', 'away_score',
      'is_final', 'round_type', 'round_number'];
    for (const entity of Object.values(EDITABLE_ENTITIES)) {
      for (const key of Object.keys(entity.fields)) {
        expect(forbidden, `${entity.key}.${key}`).not.toContain(key);
      }
    }
  });
});

describe('AFLDB-ISSUE-160 D-5: the draft spec survives, the draft WRITER does not', () => {
  const draft = EDITABLE_ENTITIES.draft_picks;

  it('keeps draft_picks as the field spec the new surface validates with', () => {
    // The spec entry is not the writer. /admin/draft validates against exactly this
    // catalogue, so removing it would move field bounds into a second place.
    expect(draft).toBeDefined();
    expect(draft.table).toBe('draft_picks');
    expect(Object.keys(draft.groups).sort())
      .toEqual(['measurements', 'notes', 'player_info', 'selection_facts']);
  });

  it('adds the selection_facts group the generic editor never had', () => {
    // Pick number and club are the two source facts most often wrong, and correcting
    // either was impossible without inventing a second draft writer.
    expect(draft.groups.selection_facts.fields).toEqual(['pick_number', 'club_slug']);
    expect(draft.fields.pick_number).toMatchObject({ kind: 'integer', nullable: true });
    // The club travels as a SLUG. A club id posted by a browser is meaningless the
    // moment a promotion renumbers it, and the era-correct identity has to be resolved
    // against draft_year server-side anyway (J-6/J-7).
    expect(draft.fields.club_slug).toMatchObject({ kind: 'text', nullable: false });
    expect(Object.keys(draft.fields)).not.toContain('club_id');
  });

  it('refuses a draft edit at the generic editor, rather than writing a second contract', () => {
    const source = readFileSync(join(process.cwd(), 'src/db/queries/data-edits.ts'), 'utf8');
    expect(source).toContain("if (input.entityKey === 'draft_picks') {");
    expect(source).toContain("return { ok: false, error: 'Draft selections are edited in /admin/draft.' };");
    // The natural-key branch that produced 'null|null|<year>|null' is gone with it
    // (DEF-1): one key shared by every admin pick of a year, which the UNIQUE made the
    // second edit overwrite and which no replay could ever match.
    expect(source).not.toContain('applyDraftPickEdit');
    expect(source).not.toMatch(/row\.source_id\}\|\$\{row\.player_url/);
  });
});
