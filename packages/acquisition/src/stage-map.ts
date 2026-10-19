/**
 * AFLDB V2 Stage 3 — renders the AFL API pipeline contract (./pipeline) as the markdown table in
 * docs/v2/architecture.md §9.
 *
 * Every row cites `path:line`, where `line` is the line of the symbol's EXPORT declaration:
 * `export function|async function|const|let|var|class|type|interface|enum <symbol>` or a name in
 * an `export { ... }` list (including `export { x as <symbol> }` and `export type { ... }`).
 * A symbol with no such export at its cited path is an error, so the table can never name code
 * that is not there. Pure: the caller supplies `readFile` (repository-relative POSIX path in,
 * file text or null out); this module does no I/O.
 */
import { AFL_API_PIPELINE, type StageDescriptor } from './pipeline';

export class StageMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageMapError';
  }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Replace comment text with spaces, keeping every newline so line numbers stay exact. */
function blankComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** The 1-based line of `symbol`'s export in `source`, or null when it is not exported there. */
export function findExportLine(source: string, symbol: string): number | null {
  if (!IDENTIFIER.test(symbol)) throw new StageMapError(`'${symbol}' is not an identifier.`);
  const text = blankComments(source);
  const escaped = symbol.replace(/\$/g, '\\$');
  const declaration = new RegExp(
    `^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\s*\\*?|const|let|var|class|abstract\\s+class|type|interface|enum)\\s+${escaped}(?![\\w$])`,
    'm',
  ).exec(text);
  if (declaration) return lineOf(text, declaration.index);

  const lists = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
  for (let list = lists.exec(text); list !== null; list = lists.exec(text)) {
    const innerStart = list.index + list[0].indexOf('{') + 1;
    const element = /(?:\btype\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g;
    for (let m = element.exec(list[1]); m !== null; m = element.exec(list[1])) {
      const exported = m[2] ?? m[1];
      if (exported === symbol) {
        const at = innerStart + m.index + m[0].lastIndexOf(exported);
        return lineOf(text, at);
      }
    }
  }
  return null;
}

/**
 * The stage map as a markdown table (no trailing newline). One row per implementation, in
 * pipeline order: | Stage | Location | Symbol | Writes |. Throws `StageMapError` when a cited
 * file cannot be read or does not export the symbol.
 */
export function renderAflApiStageMap(
  readFile: (path: string) => string | null,
  pipeline: readonly StageDescriptor[] = AFL_API_PIPELINE,
): string {
  const rows = ['| Stage | Location | Symbol | Writes |', '| --- | --- | --- | --- |'];
  const cache = new Map<string, string | null>();
  for (const stage of pipeline) {
    for (const impl of stage.implementations) {
      if (!cache.has(impl.path)) cache.set(impl.path, readFile(impl.path));
      const source = cache.get(impl.path) ?? null;
      if (source === null) {
        throw new StageMapError(`${stage.stage}: cited file '${impl.path}' (symbol '${impl.symbol}') does not exist.`);
      }
      const line = findExportLine(source, impl.symbol);
      if (line === null) {
        throw new StageMapError(`${stage.stage}: '${impl.path}' has no export named '${impl.symbol}'.`);
      }
      rows.push(`| ${stage.stage} | \`${impl.path}:${line}\` | \`${impl.symbol}\` | ${stage.writes} |`);
    }
  }
  return rows.join('\n');
}

export const STAGE_MAP_BEGIN = '<!-- stage-map:begin -->';
export const STAGE_MAP_END = '<!-- stage-map:end -->';

/**
 * Splice `table` between the two markers of `document`, preserving the document's line ending and
 * touching nothing else. Throws unless each marker occurs exactly once, begin before end.
 */
export function spliceStageMap(document: string, table: string): string {
  const parts = locateStageMap(document);
  const eol = document.includes('\r\n') ? '\r\n' : '\n';
  const body = table.replace(/\r?\n/g, eol);
  return `${document.slice(0, parts.contentStart)}${eol}${body}${eol}${document.slice(parts.contentEnd)}`;
}

/** The text between the markers with line endings normalised to LF and outer line breaks trimmed. */
export function extractStageMap(document: string): string {
  const parts = locateStageMap(document);
  return document.slice(parts.contentStart, parts.contentEnd).replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

function locateStageMap(document: string): { contentStart: number; contentEnd: number } {
  const begin = document.indexOf(STAGE_MAP_BEGIN);
  const end = document.indexOf(STAGE_MAP_END);
  if (begin < 0 || end < 0 || document.indexOf(STAGE_MAP_BEGIN, begin + 1) >= 0
    || document.indexOf(STAGE_MAP_END, end + 1) >= 0 || end < begin) {
    throw new StageMapError(`The document must hold exactly one '${STAGE_MAP_BEGIN}' followed by one '${STAGE_MAP_END}'.`);
  }
  return { contentStart: begin + STAGE_MAP_BEGIN.length, contentEnd: end };
}
