/**
 * The administrator's correction note, as every audited admin editor presents it
 * (V2-GAP-006, owner decision D-V2-GAP006-EDITORS E1; docs/v2/historical-baseline.md §2).
 *
 * WHY ONE FIELD. A change to a SEALED (completed) season is refused by the server unless it carries
 * a human-written note of 20-2000 characters; a change to an open season needs none. The editors
 * did not agree on how to ask for a note (some had none at all), so this is the one control they
 * share. It does not decide anything: the server resolves the season from the record being
 * changed and enforces the rule inside the editor's transaction
 * (`src/lib/seasons/sealed-editor-guard.ts`). The field is therefore never `required` in the
 * browser - whether it is required depends on a season the form often cannot know - but its copy
 * states the rule so a refusal is never a surprise.
 *
 * Plain markup with no hooks, so it renders in server and client trees alike. The submitted
 * value is the form field `name` (default `note`); the actor and the workflow are never form
 * fields - the server derives both.
 */

/** Mirrors CORRECTION_NOTE_MIN_LENGTH / _MAX_LENGTH in @afldb/domain (asserted by tests/v2-season-seal.test.ts). */
export const CORRECTION_NOTE_FIELD_MIN = 20;
export const CORRECTION_NOTE_FIELD_MAX = 2000;

export const CORRECTION_NOTE_HINT =
  `Required when this changes a sealed (completed) season: ${CORRECTION_NOTE_FIELD_MIN}-${CORRECTION_NOTE_FIELD_MAX} `
  + 'characters saying what is being corrected and the evidence. Optional for the current season.';

export function CorrectionNoteField({
  name = 'note',
  label = 'Correction note',
  disabled = false,
  rows = 2,
  id,
  value,
  onChange,
}: {
  /** The form field name the action reads (`note`, or `adminNote` on the awards editors). */
  name?: string;
  label?: string;
  disabled?: boolean;
  rows?: number;
  /** Stable id for the label association; defaults to a name-derived id. */
  id?: string;
  /** For panels that assemble their FormData from state: pass both to control the textarea. */
  value?: string;
  onChange?: (next: string) => void;
}) {
  const fieldId = id ?? `correction-note-${name}`;
  return (
    <div className="correction-note" style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        maxLength={CORRECTION_NOTE_FIELD_MAX}
        disabled={disabled}
        {...(value !== undefined ? { value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) } : {})}
        aria-describedby={`${fieldId}-hint`}
        style={{ maxWidth: '36rem', fontSize: '0.85rem' }}
      />
      <span id={`${fieldId}-hint`} className="muted" style={{ fontSize: '0.78rem', maxWidth: '36rem' }}>
        {CORRECTION_NOTE_HINT}
      </span>
    </div>
  );
}
