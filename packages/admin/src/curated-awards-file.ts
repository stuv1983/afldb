/**
 * @afldb/admin — the offline award-proposal file parser (AFLDB V2 Stage 4, ADR 0008).
 *
 * PURE. It takes the TEXT of a locally supplied file and returns proposal inputs; it opens no file,
 * makes no request and imports nothing that can (tests/v2-curated-awards.test.ts asserts that
 * statically). Wikipedia-derived data enters AFLDB only this way: a person prepares the file offline,
 * a super_admin supplies it, and it can only ever create PROPOSALS — never an award_winners row and
 * never an approval.
 *
 * Whole-file refusal: if any row is invalid the result is `{ ok: false }` listing every problem, and
 * no input at all is returned. There is no partial import.
 *
 * JSON shape (all keys snake_case, unknown keys refused):
 *   { "format": "afldb-award-proposals", "version": 1,
 *     "defaults": { "source_kind": "...", "source_url": "...", "citation": "...", "acquired_on": "YYYY-MM-DD" },
 *     "proposals": [ { "award_slug": "...", "season": 1990, "player_identity": "afltables:...",
 *                      "player_name": "...", "club_slug": null, "votes": null, "position": null,
 *                      "is_captain": false, "is_vice_captain": false, "note": null,
 *                      "duplicate_confirmed": false, "citation": null, "source_url": null,
 *                      "source_kind": null, "acquired_on": null } ] }
 * CSV: a header row of the same row keys, then one proposal per line (RFC 4180 quoting).
 * Row values override the file's `defaults`, which override the `defaults` argument.
 */
import {
  normaliseProposalInput,
  validateAwardProposal,
  type ProposalInput,
  type ProposalSourceKind,
  type ValidationIssue,
} from './curated-awards-model';

export type AwardProposalFileFormat = 'json' | 'csv';

export const AWARD_PROPOSAL_FILE_FORMAT = 'afldb-award-proposals';
export const AWARD_PROPOSAL_FILE_VERSION = 1;
export const MAX_FILE_ROWS = 5000;

/** The only source kinds a FILE may claim; `manual_entry` is the admin editor's alone. */
export const FILE_SOURCE_KINDS: readonly ProposalSourceKind[] = ['offline_file', 'wikipedia_offline_file'];

export type AwardProposalFileDefaults = {
  sourceKind?: ProposalSourceKind;
  sourceUrl?: string | null;
  citation?: string | null;
  acquiredOn?: string;
};

export type FileRowError = {
  /** 1-based data row (JSON proposals index or CSV line after the header); null for a file-level problem. */
  row: number | null;
  message: string;
  issues: ValidationIssue[];
};

export type ParsedAwardProposalFile =
  | { ok: true; proposals: ProposalInput[] }
  | { ok: false; errors: FileRowError[] };

const ROW_KEYS = [
  'award_slug', 'season', 'player_identity', 'player_name', 'club_slug', 'votes', 'position',
  'is_captain', 'is_vice_captain', 'note', 'duplicate_confirmed', 'citation', 'source_url',
  'source_kind', 'acquired_on',
] as const;
type RowKey = (typeof ROW_KEYS)[number];
const DEFAULT_KEYS = ['source_kind', 'source_url', 'citation', 'acquired_on'] as const;

type RawRow = Partial<Record<RowKey, unknown>>;

function fail(message: string, row: number | null = null, issues: ValidationIssue[] = []): ParsedAwardProposalFile {
  return { ok: false, errors: [{ row, message, issues }] };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// --- CSV (RFC 4180) --------------------------------------------------------

/** Parse CSV text into records. Throws on an unterminated quoted field. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; sawAny = true; continue; }
    if (ch === ',') { record.push(field); field = ''; sawAny = true; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (sawAny || field !== '' || record.length > 0) { record.push(field); records.push(record); }
      field = ''; record = []; sawAny = false;
      continue;
    }
    field += ch;
    sawAny = true;
  }
  if (inQuotes) throw new Error('A quoted CSV field is not closed.');
  if (sawAny || field !== '' || record.length > 0) { record.push(field); records.push(record); }
  return records;
}

function csvToRows(text: string): { rows: RawRow[] } | { error: string } {
  let records: string[][];
  try {
    records = parseCsvRecords(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (records.length === 0) return { error: 'The CSV file is empty.' };
  const header = records[0].map((h) => h.trim());
  const unknown = header.filter((h) => !(ROW_KEYS as readonly string[]).includes(h));
  if (unknown.length > 0) return { error: `Unknown CSV column(s): ${unknown.join(', ')}.` };
  if (new Set(header).size !== header.length) return { error: 'The CSV header repeats a column.' };
  const rows: RawRow[] = [];
  for (const [index, record] of records.slice(1).entries()) {
    if (record.length !== header.length) {
      return { error: `CSV data row ${index + 1} has ${record.length} field(s); the header has ${header.length}.` };
    }
    const row: RawRow = {};
    header.forEach((key, column) => { row[key as RowKey] = record[column]; });
    rows.push(row);
  }
  return { rows };
}

// --- shared row handling ---------------------------------------------------

function textOrNull(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function wrongType(key: string, expected: string): string {
  return `${key} must be ${expected}.`;
}

function toBoolean(value: unknown, key: string, problems: string[]): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  problems.push(wrongType(key, 'true or false'));
  return undefined;
}

function toSeason(value: unknown, problems: string[]): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d{1,5}$/.test(value.trim())) return Number(value.trim());
  problems.push(wrongType('season', 'a whole year'));
  return Number.NaN;
}

function toVotes(value: unknown, problems: string[]): string | number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  problems.push(wrongType('votes', 'a number or text'));
  return null;
}

function rowToInput(
  raw: RawRow,
  defaults: AwardProposalFileDefaults,
  problems: string[],
): ProposalInput {
  for (const key of ['award_slug', 'player_identity', 'player_name', 'club_slug', 'position', 'note', 'citation', 'source_url', 'source_kind', 'acquired_on'] as const) {
    const value = raw[key];
    if (value !== undefined && value !== null && typeof value !== 'string') problems.push(wrongType(key, 'text'));
  }
  const kind = (textOrNull(raw.source_kind) ?? defaults.sourceKind) as ProposalSourceKind | undefined;
  if (kind === undefined) problems.push('source_kind is required (row or file default).');
  else if (!FILE_SOURCE_KINDS.includes(kind)) problems.push(`source_kind must be one of ${FILE_SOURCE_KINDS.join(', ')} in a file.`);

  return {
    awardSlug: textOrNull(raw.award_slug) ?? '',
    season: toSeason(raw.season, problems),
    playerIdentity: textOrNull(raw.player_identity) ?? null,
    playerNameRaw: textOrNull(raw.player_name) ?? '',
    clubSlug: textOrNull(raw.club_slug) ?? null,
    votes: toVotes(raw.votes, problems),
    position: textOrNull(raw.position) ?? null,
    isCaptain: toBoolean(raw.is_captain, 'is_captain', problems),
    isViceCaptain: toBoolean(raw.is_vice_captain, 'is_vice_captain', problems),
    note: textOrNull(raw.note) ?? null,
    duplicateConfirmed: toBoolean(raw.duplicate_confirmed, 'duplicate_confirmed', problems),
    sourceKind: kind ?? 'offline_file',
    sourceUrl: textOrNull(raw.source_url) ?? defaults.sourceUrl ?? null,
    citation: textOrNull(raw.citation) ?? defaults.citation ?? null,
    acquiredOn: textOrNull(raw.acquired_on) ?? defaults.acquiredOn ?? '',
  };
}

function mergeFileDefaults(
  base: AwardProposalFileDefaults,
  file: unknown,
  errors: FileRowError[],
): AwardProposalFileDefaults {
  if (file === undefined) return base;
  if (file === null || typeof file !== 'object' || Array.isArray(file)) {
    errors.push({ row: null, message: 'defaults must be an object.', issues: [] });
    return base;
  }
  const record = file as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !(DEFAULT_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) errors.push({ row: null, message: `Unknown defaults key(s): ${unknown.join(', ')}.`, issues: [] });
  for (const key of DEFAULT_KEYS) {
    const value = record[key];
    if (value !== undefined && value !== null && typeof value !== 'string') errors.push({ row: null, message: wrongType(`defaults.${key}`, 'text'), issues: [] });
  }
  return {
    sourceKind: (textOrNull(record.source_kind) as ProposalSourceKind | undefined) ?? base.sourceKind,
    sourceUrl: textOrNull(record.source_url) ?? base.sourceUrl,
    citation: textOrNull(record.citation) ?? base.citation,
    acquiredOn: textOrNull(record.acquired_on) ?? base.acquiredOn,
  };
}

/**
 * Parse a locally supplied award-proposal file. `today` (YYYY-MM-DD, UTC) bounds `acquired_on`.
 * Returns every proposal or, if ANY row is invalid, only the errors.
 */
export function parseAwardProposalFile(
  text: string,
  format: AwardProposalFileFormat,
  defaults: AwardProposalFileDefaults,
  today: string,
): ParsedAwardProposalFile {
  const body = stripBom(text);
  if (format !== 'json' && format !== 'csv') return fail(`Unsupported file format '${String(format)}'.`);
  if (body.trim() === '') return fail('The file is empty.');

  const errors: FileRowError[] = [];
  let rows: RawRow[];
  let effective = defaults;

  if (format === 'json') {
    let document: unknown;
    try {
      document = JSON.parse(body);
    } catch (error) {
      return fail(`The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      return fail('The JSON file must be an object with a "proposals" array.');
    }
    const root = document as Record<string, unknown>;
    const unknownRoot = Object.keys(root).filter((k) => !['format', 'version', 'defaults', 'proposals'].includes(k));
    if (unknownRoot.length > 0) errors.push({ row: null, message: `Unknown top-level key(s): ${unknownRoot.join(', ')}.`, issues: [] });
    if (root.format !== AWARD_PROPOSAL_FILE_FORMAT) errors.push({ row: null, message: `format must be "${AWARD_PROPOSAL_FILE_FORMAT}".`, issues: [] });
    if (root.version !== AWARD_PROPOSAL_FILE_VERSION) errors.push({ row: null, message: `version must be ${AWARD_PROPOSAL_FILE_VERSION}.`, issues: [] });
    effective = mergeFileDefaults(defaults, root.defaults, errors);
    if (!Array.isArray(root.proposals)) return { ok: false, errors: [...errors, { row: null, message: 'proposals must be an array.', issues: [] }] };
    rows = [];
    for (const [index, entry] of (root.proposals as unknown[]).entries()) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push({ row: index + 1, message: 'A proposal must be an object.', issues: [] });
        continue;
      }
      const unknownKeys = Object.keys(entry).filter((k) => !(ROW_KEYS as readonly string[]).includes(k));
      if (unknownKeys.length > 0) errors.push({ row: index + 1, message: `Unknown key(s): ${unknownKeys.join(', ')}.`, issues: [] });
      rows.push(entry as RawRow);
    }
  } else {
    const csv = csvToRows(body);
    if ('error' in csv) return fail(csv.error);
    rows = csv.rows;
  }

  if (rows.length === 0) return { ok: false, errors: [...errors, { row: null, message: 'The file holds no proposals.', issues: [] }] };
  if (rows.length > MAX_FILE_ROWS) return { ok: false, errors: [...errors, { row: null, message: `The file holds more than ${MAX_FILE_ROWS} proposals.`, issues: [] }] };

  const proposals: ProposalInput[] = [];
  const seen = new Map<string, number>();
  for (const [index, raw] of rows.entries()) {
    const rowNumber = index + 1;
    const problems: string[] = [];
    const input = rowToInput(raw, effective, problems);
    const result = validateAwardProposal(normaliseProposalInput(input), null, { today, checkedAt: '' });
    const issues = result.issues.filter((issue) => issue.severity === 'error');
    if (problems.length > 0 || issues.length > 0) {
      errors.push({
        row: rowNumber,
        message: [...problems, ...issues.map((issue) => issue.message)].join(' '),
        issues,
      });
    }
    // The same award, season and player twice in one file is a mistake unless confirmed.
    if (input.playerIdentity && !input.duplicateConfirmed) {
      const key = `${input.awardSlug}|${input.season}|${input.playerIdentity}`;
      const first = seen.get(key);
      if (first !== undefined) {
        errors.push({ row: rowNumber, message: `Repeats row ${first} (same award, season and player); set duplicate_confirmed if both are intended.`, issues: [] });
      } else seen.set(key, rowNumber);
    }
    proposals.push(input);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, proposals };
}
