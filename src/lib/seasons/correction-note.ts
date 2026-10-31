/**
 * Parses the human correction note a sealed-season edit carries (V2-GAP-006,
 * D-V2-GAP006-EDITORS E1; docs/v2/historical-baseline.md section 2).
 *
 * It trims and maps blank to null and does NOTHING ELSE: in particular it never truncates. The
 * season seal (src/lib/seasons/sealed-editor-guard.ts) judges the note's real length, so an
 * over-length note on a sealed season must reach it and be refused, not be cut to 2000 characters
 * and accepted as a valid correction. An over-length note on an OPEN season is unaffected: the audit
 * writers (`recordDataEdit`, the player-link resolution insert) still store at most 2000 characters,
 * exactly as before.
 *
 * Use it ONLY for the note that is the audit/correction note. A record's own descriptive text
 * (`notes`, `appointmentNote`, `reason`) keeps its own field's length rule.
 */
export function parseCorrectionNote(value: FormDataEntryValue | null): string | null {
  const s = (value ?? '').toString().trim();
  return s === '' ? null : s;
}

/**
 * The text stored when the correction note is ALSO kept as a record's own note (an appointment or a
 * list membership keeps the note it was made with). Trimmed and cut to 2000 characters, exactly what the
 * action layer used to hand the query layer, so an OPEN-season write stores what it always stored. The
 * seal itself judges the RAW note (`parseCorrectionNote`), never this cut copy.
 */
export function storedNoteText(note: string | null | undefined): string | null {
  const text = (note ?? '').trim().slice(0, 2000);
  return text === '' ? null : text;
}
