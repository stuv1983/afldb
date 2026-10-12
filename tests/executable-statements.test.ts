/**
 * AFLDB-ISSUE-315. DB-free checks of the ISSUE-099 obligation O1 extractor
 * (tests/integration/executable-statements.ts), which the integration suite
 * settle-afltables.test.ts can only run with a test database: only real
 * `tx`/`sql` tagged templates are statements, so comments, quoted text and
 * regular expressions neither add one nor hide one, and on the real settle
 * sources the extraction is the corrected statement set.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { executableStatements } from './integration/executable-statements';

const SHAPE = /^(SELECT|INSERT|UPDATE|WITH)\b/i;
/** The extraction as it was before ISSUE-315: the same regex over the raw text. */
const RAW_TEMPLATE = /\b(?:tx|sql)(?:<[\s\S]*?>)?`([^`]*)`/g;

/** The two lines of `settle-afltables.ts` that the raw extraction read as two statements. */
const PROSE = [
  '      // `scope`, never `tx` — a recovered `40P01` raised on `tx` would still be',
  '      // re-thrown by `sql.begin` and roll the whole run back.',
].join('\n');

/** A regular expression whose class holds `/*`, after `)`: a hand lexer reads a block comment there. */
const REGEX_PREFIX = 'if (ready) /[/*]/.test(input);';

describe('executableStatements: comments', () => {
  it('excludes the settle comment that produced two prose bodies', () => {
    const rawBodies = [...PROSE.matchAll(RAW_TEMPLATE)].map((m) => m[1].replace(/\s+/g, ' ').trim());
    // The trap is real: without a syntax-aware reading these lines yield prose.
    expect(rawBodies).toEqual(['— a recovered', 'would still be // re-thrown by']);
    expect(executableStatements(PROSE)).toEqual([]);
    expect(executableStatements(`${PROSE}\nawait tx\`SELECT 1\`;`)).toEqual(['SELECT 1']);
  });

  it('excludes line and block comments, including one inside a substitution', () => {
    const source = [
      '// await tx`DELETE FROM staging.afltables_match`;',
      '/* await sql`TRUNCATE promotion_candidates`; */',
      '/**',
      ' * tx`DELETE FROM x` in a doc comment',
      ' */',
      'await tx`SELECT a FROM t WHERE b = ${b /* tx`DELETE FROM y` */} AND c = 1`;',
      'const half = a / 2; // sql`DELETE FROM z`',
    ].join('\n');
    expect(executableStatements(source)).toEqual(['SELECT a FROM t WHERE b = AND c = 1']);
  });
});

describe('executableStatements: regular expressions neither hide nor create a statement', () => {
  it('finds the statement after a regex literal that contains /*', () => {
    expect(executableStatements(`${REGEX_PREFIX} await tx\`SELECT 1\`;`)).toEqual(['SELECT 1']);
  });

  it('keeps a DELETE after the same regex visible, so O1 would still catch it', () => {
    const statements = executableStatements(`${REGEX_PREFIX}\nawait tx\`DELETE FROM t\`;`);
    expect(statements).toEqual(['DELETE FROM t']);
    expect(statements.some((s) => /\bDELETE\s+FROM\b/i.test(s))).toBe(true);
  });

  it('keeps regular-expression literals that contain quotes, backticks or //', () => {
    const source = [
      "const re = /'\\/\\//g;",
      'function f(x: string) { return /"/.test(x) || /`/.test(x); }',
      'const half = total / 2;',
      'await tx`SELECT 3`;',
    ].join('\n');
    expect(executableStatements(source)).toEqual(['SELECT 3']);
  });
});

describe('executableStatements: quoted text is not a statement', () => {
  it('ignores tx`DELETE FROM t` inside single- and double-quoted strings', () => {
    const source = [
      "const a = 'await tx`DELETE FROM t`;';",
      'const b = "await tx`DELETE FROM t`;";',
      'await tx`SELECT 2`;',
    ].join('\n');
    expect(executableStatements(source)).toEqual(['SELECT 2']);
  });

  it('ignores tx`DELETE FROM t` quoted inside an untagged template', () => {
    const source = [
      'const doc = `run tx\\`DELETE FROM t\\` never`;',
      'const url = `https://${host}//path`;',
      'await tx`SELECT 4`;',
    ].join('\n');
    expect(executableStatements(source)).toEqual(['SELECT 4']);
  });
});

describe('executableStatements: template bodies', () => {
  it('keeps // inside template SQL and reads a type-argument tag', () => {
    expect(executableStatements("await tx`SELECT 'http://example.invalid' AS u, a // 2 AS h FROM t`;"))
      .toEqual(["SELECT 'http://example.invalid' AS u, a // 2 AS h FROM t"]);
    expect(executableStatements('await sql<{ n: number }[]>`\n  SELECT 1 -- note // here\n`;'))
      .toEqual(['SELECT 1 -- note // here']);
  });

  it('blanks substitutions, including a quoted // inside one', () => {
    expect(executableStatements("await tx`SELECT ${'//'} AS s, ${n} AS n`;")).toEqual(['SELECT AS s, AS n']);
  });

  it('reads only tx and sql tags', () => {
    expect(executableStatements('await other`DELETE FROM t`; await tx`SELECT 5`;')).toEqual(['SELECT 5']);
  });
});

describe('executableStatements: the real settle sources (ISSUE-099 O1)', () => {
  const files = {
    settle: readFileSync('src/lib/acquisition/settle-afltables.ts', 'utf8'),
    store: readFileSync('src/lib/acquisition/observation-store.ts', 'utf8'),
    cli: readFileSync('tools/current-season/settle-afltables.ts', 'utf8'),
  };
  const statements = Object.values(files).flatMap((source) => executableStatements(source));

  it('extracts the corrected statement set: 31, the historical 33 less the two prose bodies', () => {
    // Exact on purpose, so a statement the extractor stops finding is noticed. A deliberate change
    // to the SQL in these three files updates these numbers with it.
    expect(executableStatements(files.settle)).toHaveLength(23);
    expect(executableStatements(files.store)).toHaveLength(8);
    expect(executableStatements(files.cli)).toHaveLength(0);
    expect(statements).toHaveLength(31);
  });

  it('finds the raw extraction\'s statements less the two prose bodies, in order, two read in full', () => {
    const raw = Object.values(files).flatMap((source) => [...source.matchAll(RAW_TEMPLATE)]
      .map((m) => m[1].replace(/\$\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean));
    expect(raw).toHaveLength(33);
    const expected = raw.filter((s) => s !== '— a recovered' && s !== 'would still be // re-thrown by');
    expect(statements).toHaveLength(expected.length);
    // The raw regex stopped two bodies at a template nested in a `${…}` (the import_batches notes
    // and the import_rejections reason), leaving a dangling `${`; the parser reads them whole.
    const truncated = expected.flatMap((s, i) => (s === statements[i] ? [] : [i]));
    expect(truncated.map((i) => expected[i].slice(0, 40))).toEqual([
      'INSERT INTO import_batches (source_id, t',
      'INSERT INTO import_rejections ( import_b',
    ]);
    for (const i of truncated) {
      expect(expected[i].endsWith('${')).toBe(true);
      expect(statements[i].startsWith(expected[i].slice(0, -2).trim())).toBe(true);
    }
    expect(statements[truncated[0]]).toMatch(/\) RETURNING id$/);
    expect(statements[truncated[1]]).toMatch(/VALUES \( , , , \)$/);
  });

  it('keeps all four positive controls', () => {
    for (const table of [
      'INSERT INTO staging.afltables_match',
      'INSERT INTO staging.afltables_player_match',
      'INSERT INTO promotion_candidates',
      'INSERT INTO staging.source_record_versions',
    ]) {
      expect(statements.some((s) => s.includes(table))).toBe(true);
    }
  });

  it('contains only statements: no prose body, and no DELETE or TRUNCATE', () => {
    expect(statements).not.toContain('— a recovered');
    expect(statements).not.toContain('would still be // re-thrown by');
    for (const statement of statements) {
      expect(statement).toMatch(SHAPE);
      expect(statement).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(statement).not.toMatch(/\bTRUNCATE\b/i);
    }
  });
});
