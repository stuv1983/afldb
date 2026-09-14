/**
 * AFLDB-ISSUE-167 Stage 5 — the public read models of `player_achievements`
 * and `after_siren_kicks` carry `status = 'active'`, fragment by fragment.
 *
 * The DB-backed proof that a voided record actually disappears lives in
 * `tests/integration/special-records-public-suppression.test.ts`. This file
 * exists for the thing that suite structurally cannot cover: the NEXT
 * fragment. A ninth public consumer added next year has no failing
 * integration test of its own, because nobody thought to write one — and a
 * single unfiltered `FROM player_achievements` is enough to make suppression
 * a lie again. So every relation reference in `src/` is enumerated here and
 * must be classified. Adding one without classifying it fails.
 *
 * §7 of the runbook is explicit that a count-based assertion is not enough:
 * the test NAMES the fragments. It does that by parsing each `sql` template
 * literal, resolving the module-level fragment constants it interpolates, and
 * requiring the filter under the same alias the reference used — so filtering
 * four of five CTEs fails, where a whole-file "contains the string" check
 * would pass.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SPECIAL_RECORD_TABLES } from '@/lib/special-records/identity';

const root = process.cwd();
const SRC = join(root, 'src');

const TABLE_RE = new RegExp(`\\b(?:FROM|JOIN)\\s+(${SPECIAL_RECORD_TABLES.join('|')})\\b\\s*(?:AS\\s+)?([a-z][a-z0-9_]*)?`, 'gi');
/** Words that follow a relation without being an alias. */
const NOT_AN_ALIAS = new Set(['where', 'group', 'order', 'limit', 'on', 'left', 'join', 'union', 'set', 'having', 'as']);

// ---------------------------------------------------------------------------
// Classification. Every file in `src/` that references either table by
// relation must appear in exactly one of these three lists.
// ---------------------------------------------------------------------------

/**
 * Public read paths. Every relation reference in these files must carry the
 * active filter under its own alias.
 */
const PUBLIC_MODULES = [
  'src/db/queries/player-achievements.ts',
  'src/db/queries/after-siren.ts',
  'src/db/queries/awards.ts',
  'src/db/queries/grid-solver.ts',
  'src/db/queries/nl/achievement-summary.ts',
  'src/db/queries/player-links.ts',
  'src/db/queries/player-match-candidates.ts',
] as const;

/**
 * Public read paths whose filter is applied by a named helper rather than
 * inside the literal itself. Each entry must prove the helper, so "it is
 * filtered upstream" is never taken on trust.
 */
const UPSTREAM_FILTERED: {
  file: string; why: string; proof: RegExp;
}[] = [
  {
    file: 'src/db/queries/nl/after-siren.ts',
    why: 'every query in the module is built from baseClauses(), which emits the filter as its first clause, so the exclusions count is filtered by the same rule as the answer',
    // The filter must be pushed UNCONDITIONALLY -- inside no `if` -- as the
    // first clause of baseClauses. A conditional one would leave the
    // no-filter question shape unprotected, which is every bare question.
    // Matched against the source with runs of whitespace collapsed.
    proof: /function baseClauses\([^)]*\)[^{]*\{ const clauses: SqlFragment\[\] = \[\]; clauses\.push\(sql`a\.status = 'active'`\);/,
  },
];

/**
 * References that are not public reads. Each carries the reason it is exempt,
 * so a future reader does not have to re-derive it.
 */
const NON_PUBLIC: Record<string, string> = {
  'src/db/queries/admin-special-records.ts':
    'the Stage 3 admin surface, which deliberately shows active AND void (the whole point of the surface)',
  'src/db/queries/match-admin.ts':
    'an administrative DELETE, not a read; Stage 6 replaces it with a refusal',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Source with comments removed: prose naming a table is not a reference to it. */
function executable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every template literal in the source, with `${...}` interpolations kept
 * inline as text. Scanned rather than regexed because a `sql` literal here
 * routinely interpolates another `sql` literal, and a non-greedy
 * backtick-to-backtick match tears those in half.
 */
function templateLiterals(source: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '`') continue;
    let depth = 0;
    let j = i + 1;
    for (; j < source.length; j += 1) {
      const c = source[j];
      if (c === '\\') { j += 1; continue; }
      if (c === '$' && source[j + 1] === '{') { depth += 1; j += 1; continue; }
      if (c === '}' && depth > 0) { depth -= 1; continue; }
      if (c === '`' && depth === 0) break;
    }
    out.push(source.slice(i + 1, j));
    i = j;
  }
  return out;
}

/**
 * The module-level `const NAME = sql`...`` fragments, so a literal that says
 * `a.${ACTIVE}` is judged on what ACTIVE actually contains.
 */
function fragmentConstants(source: string): Map<string, string> {
  const consts = new Map<string, string>();
  const re = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*sql`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [body] = templateLiterals(source.slice(m.index + m[0].length - 1));
    if (body !== undefined) consts.set(m[1], body);
  }
  return consts;
}

/** Resolve `${NAME}` and `alias.${NAME}` against the module's fragments. */
function expand(literal: string, consts: Map<string, string>): string {
  let out = literal;
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(/([a-z][a-z0-9_]*\.)?\$\{\s*([A-Z][A-Z0-9_]*)\s*\}/g,
      (whole, alias: string | undefined, name: string) => {
        const body = consts.get(name);
        if (body === undefined) return whole;
        // `a.${FRAG}` prefixes the alias onto the fragment's FIRST column only,
        // which is exactly how postgres.js composes it.
        return alias ? `${alias}${body}` : body;
      });
  }
  return out;
}

type Reference = { table: string; alias: string | null };

function referencesIn(literal: string): Reference[] {
  const refs: Reference[] = [];
  for (const m of literal.matchAll(TABLE_RE)) {
    const alias = m[2] && !NOT_AN_ALIAS.has(m[2].toLowerCase()) ? m[2] : null;
    refs.push({ table: m[1], alias });
  }
  return refs;
}

function activeFilterCount(literal: string, alias: string | null): number {
  const re = alias
    ? new RegExp(`\\b${alias}\\.status\\s*=\\s*'active'`, 'g')
    : /(?<![a-z0-9_.])status\s*=\s*'active'/g;
  return [...literal.matchAll(re)].length;
}

const FILES_WITH_REFERENCES = walk(SRC)
  .map((f) => ({ rel: relative(root, f).split(sep).join('/'), source: executable(readFileSync(f, 'utf8')) }))
  .filter(({ source }) => referencesIn(source).length > 0);

describe('AFLDB-ISSUE-167 Stage 5 — public special-record reads are filtered', () => {
  it('classifies every file in src/ that references either table', () => {
    const classified = new Set<string>([
      ...PUBLIC_MODULES,
      ...UPSTREAM_FILTERED.map((u) => u.file),
      ...Object.keys(NON_PUBLIC),
    ]);
    const unclassified = FILES_WITH_REFERENCES.map((f) => f.rel).filter((rel) => !classified.has(rel));
    expect(unclassified, [
      'A new file reads player_achievements or after_siren_kicks.',
      'Classify it: add it to PUBLIC_MODULES and filter every relation reference',
      "with status = 'active', or to NON_PUBLIC with the reason it is exempt.",
    ].join(' ')).toEqual([]);

    // And the converse: a classification naming a file that no longer reads
    // either table is stale, and would hide the next unfiltered reference.
    const present = new Set(FILES_WITH_REFERENCES.map((f) => f.rel));
    expect([...classified].filter((rel) => !present.has(rel))).toEqual([]);
  });

  it.each(PUBLIC_MODULES)('%s filters every relation reference by alias', (rel) => {
    const entry = FILES_WITH_REFERENCES.find((f) => f.rel === rel)!;
    const consts = fragmentConstants(entry.source);

    let checked = 0;
    for (const raw of templateLiterals(entry.source)) {
      const literal = expand(raw, consts);
      const refs = referencesIn(literal);
      if (refs.length === 0) continue;

      // Per alias, so filtering four of five identically-aliased CTEs fails.
      const byAlias = new Map<string, number>();
      for (const ref of refs) byAlias.set(ref.alias ?? '', (byAlias.get(ref.alias ?? '') ?? 0) + 1);

      for (const [alias, count] of byAlias) {
        const filters = activeFilterCount(literal, alias || null);
        expect(filters, [
          `${rel}: ${count} reference(s) to a special-record table as`,
          alias ? `alias "${alias}"` : '(no alias)',
          `but only ${filters} "status = 'active'" filter(s) in the same statement.`,
          'Fragment:', literal.trim().slice(0, 240),
        ].join(' ')).toBeGreaterThanOrEqual(count);
        checked += count;
      }
    }
    expect(checked, `${rel} was classified public but holds no relation reference`).toBeGreaterThan(0);
  });

  it.each(UPSTREAM_FILTERED)('$file is filtered by a proven helper', ({ file, proof }) => {
    const entry = FILES_WITH_REFERENCES.find((f) => f.rel === file)!;
    expect(entry.source.replace(/\s+/g, ' ')).toMatch(proof);
  });

  it('never softens the filter to a null-tolerant or negated form', () => {
    // Migration 102 made status NOT NULL DEFAULT 'active' with a two-value
    // CHECK, so `status IS NULL OR status = 'active'` would be dead weight
    // that quietly invites a third state in, and `status <> 'void'` would
    // admit one. The neighbouring AFLDB-ISSUE-165 tables use `<> 'void'`
    // because their own lifecycle vocabulary is wider; these two do not.
    for (const rel of PUBLIC_MODULES) {
      const { source } = FILES_WITH_REFERENCES.find((f) => f.rel === rel)!;
      const consts = fragmentConstants(source);
      for (const raw of templateLiterals(source)) {
        const literal = expand(raw, consts);
        if (referencesIn(literal).length === 0) continue;
        expect(literal, rel).not.toMatch(/status\s+IS\s+NULL/i);
        // `<> 'void'` is legitimate in these files for the ISSUE-165 tables,
        // so only flag it where it is applied to OUR alias.
        for (const ref of referencesIn(literal)) {
          if (!ref.alias) continue;
          expect(literal, `${rel}: ${ref.table} must use = 'active', not <> 'void'`)
            .not.toMatch(new RegExp(`\\b${ref.alias}\\.status\\s*<>\\s*'void'`));
        }
      }
    }
  });
});
