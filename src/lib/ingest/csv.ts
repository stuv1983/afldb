/**
 * RFC 4180 CSV parsing, dependency-free.
 *
 * Small by intent: quoted fields, escaped quotes, CRLF/LF, and a header
 * row. Anything a spreadsheet exports parses; anything pathological is
 * rejected with a line number rather than guessed at.
 */

export type CsvTable = {
  header: string[];
  rows: string[][];
};

export class CsvError extends Error {
  constructor(message: string, public line: number) {
    super(`line ${line}: ${message}`);
  }
}

const MAX_FIELD_LENGTH = 10_000;

export function parseCsv(text: string, maxRows = 100_000): CsvTable {
  // A UTF-8 BOM from Excel is markup, not data.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;

  const pushField = () => {
    if (field.length > MAX_FIELD_LENGTH) {
      throw new CsvError('field exceeds 10,000 characters', line);
    }
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    // A completely blank line is a separator, not an empty record.
    if (record.length > 1 || record[0] !== '') {
      records.push(record);
      if (records.length > maxRows + 1) {
        throw new CsvError(`more than ${maxRows} rows`, line);
      }
    }
    record = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line++;
        field += char;
      }
    } else if (char === '"') {
      if (field.length > 0) throw new CsvError('quote inside unquoted field', line);
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRecord();
      line++;
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (inQuotes) throw new CsvError('unterminated quoted field', line);
  if (field.length > 0 || record.length > 0) pushRecord();

  if (records.length === 0) throw new CsvError('file is empty', 1);

  const [headerRow, ...rows] = records;
  const header = headerRow.map((h) => h.trim().toLowerCase());

  const width = header.length;
  rows.forEach((row, index) => {
    if (row.length !== width) {
      throw new CsvError(
        `expected ${width} fields, found ${row.length}`,
        index + 2,
      );
    }
  });

  return { header, rows };
}

/** Rows as objects keyed by header, empty strings as null. */
export function toObjects(table: CsvTable): Record<string, string | null>[] {
  return table.rows.map((row) => {
    const object: Record<string, string | null> = {};
    table.header.forEach((key, i) => {
      const value = row[i].trim();
      object[key] = value === '' ? null : value;
    });
    return object;
  });
}
