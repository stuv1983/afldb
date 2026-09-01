import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 closeout (§24). DB-free parser/validation coverage for
 * tools/migration/award_definitions.py, in the tests/named-medals-source
 * mould: every case writes a small variant file and drives the real Python
 * checker as a subprocess — no database, no import_awards.py run.
 *
 * This manifest is the tracked home for the last two `awards` rows that only
 * the legacy `awards` group created: `all-australian` and `rising-star`. It is
 * one shared file but NOT a shared writer — `import_all_australian` and
 * `import_rising_star` each reconcile only their own slug, through disjoint
 * slug-scoped reloads, so neither can delete or rewrite the other's row.
 *
 * `coleman`, `22-under-22`, the 19 `bf-*` and the 17 named medals are
 * deliberately absent: each already has its own tracked owner, and a second
 * writer for any of them is the double-ownership hazard this file exists to
 * avoid.
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/award_definitions.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/award-definitions.csv');
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-award-defs-'));
const canonicalLines = readFileSync(canonicalCsv, 'utf8').trimEnd().split(/\r?\n/);
let variantNumber = 0;

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

type CheckResult = {
  status: number | null;
  payload: Record<string, any>;
  stderr: string;
};

function runChecker(csvPath?: string): CheckResult {
  const args = [checker];
  if (csvPath) args.push('--csv', csvPath);
  const result = spawnSync(python, args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  return {
    status: result.status,
    payload: JSON.parse(result.stdout.trim()),
    stderr: result.stderr,
  };
}

function writeVariant(lines: string[]): string {
  variantNumber += 1;
  const path = join(temporaryDirectory, `variant-${variantNumber}.csv`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function expectRejected(lines: string[], errorPattern: RegExp): void {
  const result = runChecker(writeVariant(lines));
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(result.payload.ok).toBe(false);
  expect(result.payload.error).toEqual(expect.stringMatching(errorPattern));
}

/** Replace one cell of one data row, leaving every other byte alone. */
function withCell(rowIndex: number, column: string, value: string): string[] {
  const header = canonicalLines[0].split(',');
  const columnIndex = header.indexOf(column);
  expect(columnIndex).toBeGreaterThanOrEqual(0);
  return canonicalLines.map((line, index) => {
    if (index !== rowIndex + 1) return line;
    const cells = line.split(',');
    cells[columnIndex] = value;
    return cells.join(',');
  });
}

describe('award-definitions manifest (AFLDB-ISSUE-112 §24)', () => {
  it('parses the canonical manifest and reports the measured shape', () => {
    const result = runChecker();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload.ok).toBe(true);
    expect(result.payload.definition_count).toBe(2);
    expect(Object.keys(result.payload.definitions).sort())
      .toEqual(['all-australian', 'rising-star']);
  });

  it('round-trips the All-Australian definition exactly as afldb_dev holds it', () => {
    expect(runChecker().payload.definitions['all-australian']).toEqual({
      name: 'All-Australian Team',
      category: 'honour_team',
      competition: 'AFL',
      first_season: 1953,
      last_season: 2025,
      source_citation: 'draftguru',
    });
  });

  it('round-trips the Rising Star definition exactly as afldb_dev holds it', () => {
    expect(runChecker().payload.definitions['rising-star']).toEqual({
      name: 'Rising Star Award',
      category: 'award',
      competition: 'AFL',
      first_season: 1993,
      last_season: 2025,
      source_citation: 'draftguru',
    });
  });

  it('carries only the two definitions no other manifest owns', () => {
    // A third slug here would give an award two id-preserving writers with
    // overlapping delete scopes — the cascade hazard §22.2/§23.2 avoided.
    const text = readFileSync(canonicalCsv, 'utf8');
    for (const owned of ['coleman', '22-under-22', 'bf-', 'brownlow-medal']) {
      expect(text).not.toContain(owned);
    }
  });

  // --- refusals ------------------------------------------------------------

  it('refuses a changed header', () => {
    expectRejected(['slug,name,category,competition,first_season,last_season',
                    ...canonicalLines.slice(1)], /invalid header/);
  });

  it('refuses a row with too many columns', () => {
    expectRejected([canonicalLines[0], `${canonicalLines[1]},extra`,
                    canonicalLines[2]], /too many columns/);
  });

  it('refuses a missing required field', () => {
    expectRejected(withCell(0, 'name', ''), /name is required/);
  });

  it('refuses edge whitespace in a text field', () => {
    expectRejected(withCell(0, 'name', 'All-Australian Team '),
                   /leading or trailing whitespace/);
  });

  it('refuses a slug this file does not own', () => {
    expectRejected(withCell(0, 'slug', 'coleman'), /unknown slug 'coleman'/);
  });

  it('refuses a definition whose category disagrees with its slug', () => {
    expectRejected(withCell(0, 'category', 'award'),
                   /all-australian' is category 'honour_team'/);
  });

  it('refuses an unknown competition', () => {
    expectRejected(withCell(1, 'competition', 'VFL'), /competition 'VFL' must be/);
  });

  it('refuses a non-integer season bound', () => {
    expectRejected(withCell(1, 'first_season', 'nineteen'),
                   /first_season must be an integer/);
  });

  it('refuses first_season after last_season', () => {
    expectRejected(withCell(1, 'first_season', '2030'), /malformed season bounds/);
  });

  it('refuses a season bound outside the competition span', () => {
    expectRejected(withCell(1, 'last_season', '2030'), /malformed season bounds/);
  });

  it('refuses an unknown source_citation', () => {
    expectRejected(withCell(0, 'source_citation', 'manifest'),
                   /has source_citation 'draftguru', got 'manifest'/);
  });

  it('refuses a different known source because both definitions are DraftGuru-owned', () => {
    expectRejected(withCell(1, 'source_citation', 'footywire'),
                   /has source_citation 'draftguru', got 'footywire'/);
  });

  it('refuses a duplicate slug', () => {
    expectRejected([canonicalLines[0], canonicalLines[1], canonicalLines[1]],
                   /duplicate slug/);
  });

  it('refuses rows out of deterministic order', () => {
    expectRejected([canonicalLines[0], canonicalLines[2], canonicalLines[1]],
                   /out of deterministic order/);
  });

  it('refuses a truncated file rather than loading half the definitions', () => {
    expectRejected(canonicalLines.slice(0, -1), /expected exactly the 2 shared/);
  });

  it('refuses an unreadable file rather than defaulting', () => {
    const result = runChecker(join(temporaryDirectory, 'absent.csv'));
    expect(result.status).toBe(1);
    expect(result.payload.error).toEqual(expect.stringMatching(/cannot read/));
  });
});

describe('shared definitions are wired without double ownership', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('reconciles each definition scoped to its own slug alone', () => {
    expect(source).toContain(
      'scope_column="slug", scope_values=[definition.slug], scope_exclude=False,');
  });

  it('gives All-Australian and Rising Star their own definition, not a guard', () => {
    expect(source).toContain(
      'award_id = reconcile_shared_definition(pg, batch, ALL_AUSTRALIAN_SLUG)');
    expect(source).toContain(
      'award_id = reconcile_shared_definition(pg, batch, RISING_STAR_SLUG)');
    // The old refusal — telling the operator to run the legacy group first —
    // is what made a canonical, legacy-free rebuild impossible for both
    // families. It survives only as prose in the helper's docstring.
    expect(source).not.toContain('award definition is missing; ');
    expect(source.split("run the 'awards' group first")).toHaveLength(2);
  });

  it('never widens the legacy group’s own definition reload scope', () => {
    // Removing a slug from build_definitions() without this would make that
    // shared reload DELETE the row and ON DELETE CASCADE its winners.
    expect(source).toContain(
      'scope_column="slug", scope_values=[UNDER_22_SLUG], scope_exclude=True,');
  });

  it('reads the definition through the manifest, never a hardcoded literal', () => {
    expect(source).toContain('from award_definitions import');
    expect(source).toContain('definition_for as award_definition_for');
  });
});
