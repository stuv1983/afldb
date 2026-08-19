/**
 * What a super admin may edit by hand, stated once.
 *
 * The same three walls as the query-builder catalogue: table and column
 * identifiers come only from this file, never from a request; every
 * value is validated against its field's kind and bounds before it is
 * bound as a parameter; and anything not listed here cannot be edited
 * at all.
 *
 * Derived and identity columns are deliberately absent. slug,
 * search_name, sort_name, search_rank, debut_season and final_season on
 * players are maintained by tooling (search_name/sort_name are
 * recomputed by the editor itself when a name field changes — nothing
 * in the database does it); id and legacy ids are immutable; a match's
 * fixture identity (round, clubs, date) is a re-import job, not an
 * edit.
 *
 * No `server-only`: the admin form renders labels and kinds from this
 * file. It contains nothing secret — the same table names appear in the
 * query-builder spec the browser already loads.
 */

export type EditFieldKind = 'integer' | 'text' | 'date' | 'enum';

export type EditField = {
  key: string;
  label: string;
  kind: EditFieldKind;
  nullable: boolean;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  help?: string;
};

export type EditGroup = {
  key: string;
  label: string;
  /** Field keys edited together because CHECK constraints couple them. */
  fields: string[];
  help: string;
  /** rebuild_derived.py targets an edit here leaves stale. */
  affectsDerived?: string[];
};

export type EditEntity = {
  key: string;
  label: string;
  /** Physical table name. Only ever interpolated from this spec. */
  table: string;
  fields: Record<string, EditField>;
  groups: Record<string, EditGroup>;
};

const CONFIDENCE = ['sourced', 'estimated', 'derived', 'unknown'] as const;

export const EDITABLE_ENTITIES: Record<string, EditEntity> = {
  players: {
    key: 'players',
    label: 'Players',
    table: 'players',
    fields: {
      display_name: {
        key: 'display_name', label: 'Display name', kind: 'text', nullable: false,
        maxLength: 100,
        help: 'Search and sort forms are recomputed automatically. The URL slug never changes — links stay stable and the id is authoritative.',
      },
      given_name: { key: 'given_name', label: 'Given name', kind: 'text', nullable: true, maxLength: 60 },
      surname: { key: 'surname', label: 'Surname', kind: 'text', nullable: true, maxLength: 60 },
      dob: {
        key: 'dob', label: 'Date of birth', kind: 'date', nullable: true,
        help: 'Entering a date sets its confidence below — use "sourced" only when verified externally.',
      },
      dob_confidence: {
        key: 'dob_confidence', label: 'DOB confidence', kind: 'enum', nullable: false,
        enumValues: CONFIDENCE,
      },
      birth_year: { key: 'birth_year', label: 'Birth year', kind: 'integer', nullable: true, min: 1850, max: 2020 },
      birth_year_min: { key: 'birth_year_min', label: 'Birth year (earliest)', kind: 'integer', nullable: true, min: 1850, max: 2020 },
      birth_year_max: { key: 'birth_year_max', label: 'Birth year (latest)', kind: 'integer', nullable: true, min: 1850, max: 2020 },
      birth_year_confidence: {
        key: 'birth_year_confidence', label: 'Birth-year confidence', kind: 'enum', nullable: false,
        enumValues: CONFIDENCE,
      },
      height_cm: { key: 'height_cm', label: 'Height (cm)', kind: 'integer', nullable: true, min: 120, max: 230 },
      weight_kg: { key: 'weight_kg', label: 'Weight (kg)', kind: 'integer', nullable: true, min: 40, max: 160 },
      notes: { key: 'notes', label: 'Notes', kind: 'text', nullable: true, maxLength: 2000 },
    },
    groups: {
      name: {
        key: 'name', label: 'Name',
        fields: ['display_name', 'given_name', 'surname'],
        help: 'Saved together so the search and sort forms are rebuilt from a consistent set.',
      },
      dob: {
        key: 'dob', label: 'Date of birth',
        fields: ['dob', 'dob_confidence'],
        help: 'A date and how it is known travel together.',
      },
      birth_year: {
        key: 'birth_year', label: 'Birth year',
        fields: ['birth_year', 'birth_year_min', 'birth_year_max', 'birth_year_confidence'],
        help: 'Earliest may not exceed latest.',
      },
      height_cm: { key: 'height_cm', label: 'Height', fields: ['height_cm'], help: '' },
      weight_kg: { key: 'weight_kg', label: 'Weight', fields: ['weight_kg'], help: '' },
      notes: { key: 'notes', label: 'Notes', fields: ['notes'], help: '' },
    },
  },

  matches: {
    key: 'matches',
    label: 'Matches',
    table: 'matches',
    fields: {
      attendance: {
        key: 'attendance', label: 'Attendance', kind: 'integer', nullable: true, min: 0, max: 200000,
        help: 'Blank means "not recorded", never zero. A genuine 0 (a closed-door match) is accepted and cited to the manual-edit source, per migration 020.',
      },
      home_goals: { key: 'home_goals', label: 'Home goals', kind: 'integer', nullable: false, min: 0, max: 60 },
      home_behinds: { key: 'home_behinds', label: 'Home behinds', kind: 'integer', nullable: false, min: 0, max: 60 },
      away_goals: { key: 'away_goals', label: 'Away goals', kind: 'integer', nullable: false, min: 0, max: 60 },
      away_behinds: { key: 'away_behinds', label: 'Away behinds', kind: 'integer', nullable: false, min: 0, max: 60 },
      match_time: { key: 'match_time', label: 'Match time', kind: 'text', nullable: true, maxLength: 40 },
      match_event: { key: 'match_event', label: 'Match event', kind: 'text', nullable: true, maxLength: 120 },
      notes: { key: 'notes', label: 'Notes', kind: 'text', nullable: true, maxLength: 2000 },
    },
    groups: {
      attendance: {
        key: 'attendance', label: 'Attendance',
        fields: ['attendance'],
        help: '',
      },
      score: {
        key: 'score', label: 'Score',
        fields: ['home_goals', 'home_behinds', 'away_goals', 'away_behinds'],
        help: 'Scores, result, winner and margin are derived from goals and behinds — they are never typed by hand.',
        affectsDerived: ['player_season_stats', 'player_club_season_stats', 'player_career_stats'],
      },
      match_time: { key: 'match_time', label: 'Match time', fields: ['match_time'], help: '' },
      match_event: { key: 'match_event', label: 'Match event', fields: ['match_event'], help: '' },
      notes: { key: 'notes', label: 'Notes', fields: ['notes'], help: '' },
    },
  },

  draft_picks: {
    key: 'draft_picks',
    label: 'Draft picks',
    table: 'draft_picks',
    fields: {
      player_name_raw: {
        key: 'player_name_raw', label: 'Player name', kind: 'text', nullable: false, maxLength: 120,
        help: 'The name as recorded for the draft selection.',
      },
      original_club_raw: {
        key: 'original_club_raw', label: 'Recruited from (original club)', kind: 'text', nullable: true, maxLength: 160,
      },
      height_cm: { key: 'height_cm', label: 'Height (cm)', kind: 'integer', nullable: true, min: 120, max: 230 },
      weight_kg: { key: 'weight_kg', label: 'Weight (kg)', kind: 'integer', nullable: true, min: 40, max: 160 },
      draft_age: { key: 'draft_age', label: 'Draft age', kind: 'integer', nullable: true, min: 14, max: 50 },
      pick_note: { key: 'pick_note', label: 'Pick note', kind: 'text', nullable: true, maxLength: 500 },
      detail: { key: 'detail', label: 'Detail / biography', kind: 'text', nullable: true, maxLength: 2000 },
    },
    groups: {
      player_info: {
        key: 'player_info', label: 'Player details',
        fields: ['player_name_raw', 'original_club_raw', 'draft_age'],
        help: 'Basic player recruitment and junior club information.',
      },
      measurements: {
        key: 'measurements', label: 'Height and weight',
        fields: ['height_cm', 'weight_kg'],
        help: 'Physical statistics at time of drafting.',
      },
      notes: {
        key: 'notes', label: 'Notes and details',
        fields: ['pick_note', 'detail'],
        help: 'Biographical notes and selection conditions.',
      },
    },
  },
};

export function isEditableEntity(value: string): boolean {
  return Object.hasOwn(EDITABLE_ENTITIES, value);
}

export type FieldValue = string | number | null;

/**
 * Validate one field's submitted value against its spec.
 * Returns the coerced value, or an error message.
 */
export function validateFieldValue(
  field: EditField,
  raw: string,
): { ok: true; value: FieldValue } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    if (field.nullable) return { ok: true, value: null };
    return { ok: false, error: `${field.label} cannot be empty.` };
  }
  switch (field.kind) {
    case 'integer': {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) return { ok: false, error: `${field.label} must be a whole number.` };
      if (field.min !== undefined && n < field.min) {
        return { ok: false, error: `${field.label} must be at least ${field.min}.` };
      }
      if (field.max !== undefined && n > field.max) {
        return { ok: false, error: `${field.label} must be at most ${field.max}.` };
      }
      return { ok: true, value: n };
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { ok: false, error: `${field.label} must be YYYY-MM-DD.` };
      }
      // Round-trip, because Date() ROLLS an impossible day over instead
      // of rejecting it — 1954-02-31 silently becomes 3 March.
      const parsed = new Date(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
        return { ok: false, error: `${field.label} is not a real date.` };
      }
      return { ok: true, value: trimmed };
    }
    case 'enum': {
      if (!field.enumValues?.includes(trimmed)) {
        return { ok: false, error: `${field.label} must be one of: ${field.enumValues?.join(', ')}.` };
      }
      return { ok: true, value: trimmed };
    }
    case 'text': {
      if (field.maxLength !== undefined && trimmed.length > field.maxLength) {
        return { ok: false, error: `${field.label} is limited to ${field.maxLength} characters.` };
      }
      return { ok: true, value: trimmed };
    }
  }
}
