import 'server-only';

import type postgres from 'postgres';

import {
  AUDITED_CORRECTION_WORKFLOWS,
  CORRECTION_NOTE_MAX_LENGTH,
  CORRECTION_NOTE_MIN_LENGTH,
  evaluateSeasonWrite,
  type AuditedCorrection,
  type AuditedCorrectionWorkflow,
  type SealedSeasons,
} from '@afldb/domain';

import { SeasonRegistryError, loadSealedSeasons } from './sealed-seasons';

/**
 * The season seal for the audited ADMIN EDITORS (AFLDB V2, V2-GAP-006; owner decision
 * D-V2-GAP006-EDITORS, Option E1; docs/v2/historical-baseline.md §2).
 *
 * WHAT IT DOES. A mutation that writes a row of a SEALED season (1897-2026 at the time of writing; the range is whatever the registry says, read fresh from
 * data/reference/seasons.json) is refused unless it carries a human-written note of
 * {@link CORRECTION_NOTE_MIN_LENGTH}-{@link CORRECTION_NOTE_MAX_LENGTH} characters. An unknown or
 * undated season is treated as sealed (the same fail-closed rule as `evaluateSeasonWrite`), and an
 * unreadable registry refuses every sealed-scope write ({@link SealedEditorRefusal} code
 * `season_registry_unavailable`). A write wholly inside an OPEN season is unchanged: no note is
 * required and nothing extra is recorded.
 *
 * WHERE IT RUNS. Inside the editor's own import-role transaction, at the one place every audited
 * editor mutation already passes through: `recordDataEdit` (src/db/queries/audit-log.ts), and the
 * player-link resolution audit (src/db/queries/player-links.ts). A refusal THROWS from inside the
 * transaction, so the canonical write, the audit row and every sibling write roll back together:
 * a refused edit leaves canonical data and audit rows exactly as they were.
 *
 * THE CORRECTION RECORD. The actor is the authenticated admin the caller already derived on the
 * server (never a form field). The workflow id is DERIVED HERE from the audited table, never
 * supplied by a caller or a client: Brownlow authority and vote entry map to `brownlow_authority`,
 * a player-link resolution to `identity_adjudication`, every other manual editor to
 * `data_editor`. No workflow id was added (the closed list of `AUDITED_CORRECTION_WORKFLOWS` is
 * unchanged). The evidence reference names the REAL same-transaction audit row, read back from the
 * INSERT that wrote it (`data_edits:<id>`); it is never predicted or invented.
 *
 * WHAT IT IS NOT. It is application-level only. A writer that does not use these editors (a
 * direct SQL client, a legacy loader, the ISSUE-316 writers) is not stopped here; there is no
 * database constraint or trigger (V2-GAP-006 stays open for those layers).
 */

/** A season-scoped fact table whose audit `row_id` resolves to a season (the manifest's fact tables). */
const ROW_SEASON_SQL = {
  matches: 'season',
  draft_picks: 'draft_year',
  award_winners: 'season',
  player_achievements: 'season',
  after_siren_kicks: 'season',
  club_leadership: 'season',
} as const;

type RowSeasonTable = keyof typeof ROW_SEASON_SQL;

/**
 * Audit tables that are reference tables (docs/v2/historical-manifest-spec.md §2-§3: "reference
 * tables have no season and are never sealed") or the schedule (`fixtures`, §3 of
 * historical-baseline.md: "the schedule, not results"). A mutation audited against one of these
 * may declare `{ kind: 'reference' }`; against any other table the declaration is a programming
 * error and throws, so a season-bearing mutation cannot be waved through as "reference".
 */
export const REFERENCE_AUDIT_TABLES = [
  'players',
  'coaches',
  'hall_of_fame',
  'honour_team_members',
  'fixtures',
] as const;

export type ReferenceAuditTable = (typeof REFERENCE_AUDIT_TABLES)[number];

/**
 * How a mutation declares the seasons it touches. Required on every `recordDataEdit` call, so a
 * new editor mutation cannot be added without answering the question.
 *
 * - `row`: the seasons are read from the audited row itself, inside the transaction, after the
 *   write (matches, draft picks, award winners, special records, leadership, Brownlow authority
 *   and vote entry). A row that cannot be found resolves to an UNKNOWN season and so fails closed.
 *   `previousSeasons` names the season(s) the row occupied BEFORE the edit when an edit can move
 *   a record (old and new are both guarded).
 * - `seasons`: the caller names every season the mutation writes or removes rows in. Use this when
 *   the audit subject is not the sealed row (a season-list membership is audited against its
 *   player), when the audited row is deleted, or when one transaction spans several seasons.
 * - `reference`: the audit table is a reference table or the schedule; the mutation writes no
 *   season-bearing row.
 */
export type SealScope =
  | { readonly kind: 'row'; readonly previousSeasons?: readonly (number | null)[] }
  | { readonly kind: 'seasons'; readonly seasons: readonly (number | null)[] }
  | { readonly kind: 'reference' };

export type SealRefusalCode =
  | 'season_sealed'
  | 'correction_invalid'
  | 'season_registry_unavailable';

/** Thrown inside the editor transaction; the transaction rolls back and the module maps it. */
export class SealedEditorRefusal extends Error {
  readonly code: SealRefusalCode;

  readonly seasons: readonly (number | null)[];

  constructor(code: SealRefusalCode, seasons: readonly (number | null)[], message: string) {
    super(message);
    this.name = 'SealedEditorRefusal';
    this.code = code;
    this.seasons = seasons;
  }
}

export function isSealedEditorRefusal(error: unknown): error is SealedEditorRefusal {
  return error instanceof SealedEditorRefusal;
}

/** What the guard decided, for the caller and the tests. */
export type SealReceipt =
  | { readonly basis: 'not_applicable'; readonly seasons: readonly [] }
  | { readonly basis: 'open_season'; readonly seasons: readonly number[] }
  | {
    readonly basis: 'audited_correction';
    readonly seasons: readonly (number | null)[];
    readonly sealedSeasons: readonly (number | null)[];
    readonly workflow: AuditedCorrectionWorkflow;
    readonly actorUserId: number;
    readonly note: string;
    readonly evidenceRef: string;
  };

/** The audit tables that Brownlow authority and vote entry write (workflow `brownlow_authority`). */
const BROWNLOW_AUDIT_TABLES: readonly string[] = ['brownlow_vote_entry_state', 'brownlow_season_authority'];

/** The workflow id for an audited table, derived on the server. */
export function workflowForAuditTable(tableName: string): AuditedCorrectionWorkflow {
  return BROWNLOW_AUDIT_TABLES.includes(tableName) ? 'brownlow_authority' : 'data_editor';
}

/** The message an administrator reads; it states the rule and the way out. */
export function sealedNoteMessage(sealedSeasons: readonly (number | null)[], problem: 'missing' | 'short' | 'long'): string {
  const which = sealedSeasons.length === 1 && sealedSeasons[0] !== null
    ? `season ${sealedSeasons[0]} is sealed historical data`
    : `season ${sealedSeasons.map((s) => (s === null ? 'unknown/undated' : String(s))).join(', ')} is sealed historical data (an unknown or undated season is treated as sealed)`;
  const rule = `a correction note of ${CORRECTION_NOTE_MIN_LENGTH}-${CORRECTION_NOTE_MAX_LENGTH} characters is required`;
  const what = problem === 'missing'
    ? 'No note was entered.'
    : problem === 'short'
      ? `The note is shorter than ${CORRECTION_NOTE_MIN_LENGTH} characters.`
      : `The note is longer than ${CORRECTION_NOTE_MAX_LENGTH} characters.`;
  return `Refused: ${which}, so ${rule}. ${what} Explain what is being corrected and why, then save again. Nothing was changed.`;
}

type Tx = postgres.TransactionSql;

/** Resolve the declared scope to the distinct seasons it touches (null = unknown). */
export async function resolveSealScopeSeasons(
  tx: Tx,
  tableName: string,
  rowId: number,
  scope: SealScope,
): Promise<readonly (number | null)[]> {
  if (scope.kind === 'reference') {
    if (!(REFERENCE_AUDIT_TABLES as readonly string[]).includes(tableName)) {
      throw new Error(
        `Sealed-edit guard: '${tableName}' is not a reference audit table, so a mutation audited against it `
        + "cannot declare { kind: 'reference' }. Declare the seasons it writes.",
      );
    }
    return [];
  }
  const found: (number | null)[] = [];
  if (scope.kind === 'seasons') {
    found.push(...scope.seasons);
  } else {
    found.push(...(scope.previousSeasons ?? []));
    found.push(...await seasonsOfAuditedRow(tx, tableName, rowId));
  }
  const normalised = found.map((s) => (typeof s === 'number' && Number.isInteger(s) ? s : null));
  return [...new Set(normalised)];
}

async function seasonsOfAuditedRow(tx: Tx, tableName: string, rowId: number): Promise<(number | null)[]> {
  if (tableName === 'brownlow_season_authority') {
    // The audit row_id IS the season (src/db/queries/audit-log.ts, migration 094).
    return [Number.isInteger(rowId) ? rowId : null];
  }
  if (tableName === 'brownlow_vote_entry_state') {
    // row_id is the match id; the season is the match's.
    const rows = await tx<{ season: number | null }[]>`SELECT season FROM matches WHERE id = ${rowId}`;
    return [rows[0]?.season ?? null];
  }
  if (!Object.prototype.hasOwnProperty.call(ROW_SEASON_SQL, tableName)) {
    throw new Error(
      `Sealed-edit guard: '${tableName}' has no season column to resolve from the audited row. `
      + "Declare { kind: 'seasons', seasons: [...] } or { kind: 'reference' }.",
    );
  }
  const column = ROW_SEASON_SQL[tableName as RowSeasonTable];
  // The table and column come from the closed ROW_SEASON_SQL map above, never from input.
  const rows = await tx.unsafe<{ season: number | null }[]>(
    `SELECT ${column} AS season FROM ${tableName} WHERE id = $1`,
    [rowId],
  );
  return [rows[0]?.season ?? null];
}

export interface SealCheckInput {
  readonly tableName: string;
  readonly rowId: number;
  readonly scope: SealScope;
  readonly actorUserId: number;
  readonly note: string | null | undefined;
  /** The workflow id; defaults to the one derived from `tableName`. A caller never takes it from a client. */
  readonly workflow?: AuditedCorrectionWorkflow;
  /** The real audit record already written in this transaction (for example `data_edits:123`). */
  readonly evidenceRef: string;
  /** Test seam: the sealed range. Production reads the registry fresh. */
  readonly sealed?: SealedSeasons;
}

function noteProblem(note: string | null | undefined): 'missing' | 'short' | 'long' | null {
  const trimmed = (note ?? '').trim();
  if (trimmed.length === 0) return 'missing';
  if (trimmed.length < CORRECTION_NOTE_MIN_LENGTH) return 'short';
  if (trimmed.length > CORRECTION_NOTE_MAX_LENGTH) return 'long';
  return null;
}

/**
 * Decide the mutation against the seal, inside its transaction. Call it AFTER the audit row is
 * written (so `evidenceRef` names a real row) and let it throw: the throw rolls everything back.
 */
export async function enforceSealedEditorWrite(tx: Tx, input: SealCheckInput): Promise<SealReceipt> {
  if (!(AUDITED_CORRECTION_WORKFLOWS as readonly string[]).includes(input.workflow ?? workflowForAuditTable(input.tableName))) {
    throw new Error('Sealed-edit guard: the workflow is not in the closed audited-correction list.');
  }
  const seasons = await resolveSealScopeSeasons(tx, input.tableName, input.rowId, input.scope);
  if (seasons.length === 0) return { basis: 'not_applicable', seasons: [] };

  let sealed: SealedSeasons;
  try {
    sealed = input.sealed ?? loadSealedSeasons();
  } catch (error) {
    if (error instanceof SeasonRegistryError) {
      throw new SealedEditorRefusal(
        'season_registry_unavailable',
        seasons,
        'Refused: the season registry could not be read, so it cannot be proved that this season is open. '
        + 'Nothing was changed. Try again, or ask an administrator to check data/reference/seasons.json.',
      );
    }
    throw error;
  }

  const workflow = input.workflow ?? workflowForAuditTable(input.tableName);
  const correction: AuditedCorrection = {
    workflow,
    actorUserId: input.actorUserId,
    note: input.note ?? '',
    evidenceRef: input.evidenceRef,
  };

  const sealedSeasons: (number | null)[] = [];
  const openSeasons: number[] = [];
  let decisionDetail: { note: string; evidenceRef: string; actorUserId: number } | null = null;
  for (const season of seasons) {
    const decision = evaluateSeasonWrite({ season, sealed, correction });
    if (!decision.allowed) {
      // Report the note rule in the editor's own words; the domain message stays for the log.
      const problem = noteProblem(input.note);
      const sealedNow = seasons.filter((s) => s === null || evaluateSeasonWrite({ season: s, sealed, correction: null }).allowed === false);
      if (problem !== null) {
        throw new SealedEditorRefusal('correction_invalid', sealedNow, sealedNoteMessage(sealedNow, problem));
      }
      throw new SealedEditorRefusal(decision.code, sealedNow, decision.message);
    }
    if (decision.basis === 'audited_correction') {
      sealedSeasons.push(decision.audit.season);
      decisionDetail = {
        note: decision.audit.note, evidenceRef: decision.audit.evidenceRef, actorUserId: decision.audit.actorUserId,
      };
    } else {
      openSeasons.push(season as number);
    }
  }
  if (sealedSeasons.length === 0 || decisionDetail === null) {
    return { basis: 'open_season', seasons: openSeasons };
  }
  return {
    basis: 'audited_correction',
    seasons,
    sealedSeasons,
    workflow,
    actorUserId: decisionDetail.actorUserId,
    note: decisionDetail.note,
    evidenceRef: decisionDetail.evidenceRef,
  };
}
