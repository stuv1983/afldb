import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/under_22.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/22-under-22.csv');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-under22-'));
const canonicalLines = readFileSync(canonicalCsv, 'utf8').trimEnd().split(/\r?\n/);
let variantNumber = 0;

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

type CheckResult = {
  status: number | null;
  payload: Record<string, unknown>;
  stderr: string;
};

function runChecker(csvPath?: string): CheckResult {
  const args = [checker];
  if (csvPath) args.push('--csv', csvPath);
  const result = spawnSync(python, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    payload: JSON.parse(result.stdout.trim()) as Record<string, unknown>,
    stderr: result.stderr,
  };
}

function writeVariant(lines: string[]): string {
  variantNumber += 1;
  const path = join(temporaryDirectory, `variant-${variantNumber}.csv`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function replaceCell(line: string, index: number, value: string): string {
  const cells = line.split(',');
  cells[index] = value;
  return cells.join(',');
}

function expectRejected(lines: string[], errorPattern: RegExp): void {
  const result = runChecker(writeVariant(lines));
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(result.payload.ok).toBe(false);
  expect(result.payload.error).toEqual(expect.stringMatching(errorPattern));
}

describe('canonical AFLPA 22under22 source', () => {
  it('contains a complete, machine-checkable 2012-2026 history', () => {
    const result = runChecker();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      row_count: 330,
      season_count: 15,
      seasons: [
        2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022,
        2023, 2024, 2025, 2026,
      ],
      captain_count: 15,
      vice_captain_count: 14,
    });
    expect(result.payload.rows_per_season).toEqual(
      Object.fromEntries(Array.from({ length: 15 }, (_, index) => [String(2012 + index), 22])),
    );
  });

  it('preserves representative source rows and leadership markers', () => {
    const csv = canonicalLines.join('\n');
    expect(csv).toContain(
      '22under22:2012:c:2,2012,C,Patrick Dangerfield,Adelaide,1,0',
    );
    expect(csv).toContain(
      '22under22:2019:b:2,2019,B,Harris Andrews,Brisbane Lions,1,0',
    );
    expect(csv).toContain(
      '22under22:2026:r:2,2026,R,Harry Sheezel,North Melbourne,1,0',
    );
    expect(csv).toContain(
      '22under22:2026:ic:4,2026,I/C,Ryley Sanders,Western Bulldogs,0,0',
    );
  });

  it('derives the supplied formation order from stable source slots', () => {
    const program = [
      'import json, sys',
      'sys.path.insert(0, "tools/migration")',
      'from under_22 import load_under_22',
      'rows = [row for row in load_under_22() if row.season == 2012]',
      'print(json.dumps([[row.position, row.sort_order] for row in rows]))',
    ].join('\n');
    const result = spawnSync(python, ['-c', program], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    const formation = JSON.parse(result.stdout.trim()) as [string, number][];
    expect(formation.map(([, order]) => order)).toEqual(
      Array.from({ length: 22 }, (_, index) => index + 1),
    );
    expect(formation.map(([position]) => position)).toEqual([
      'B', 'B', 'B', 'HB', 'HB', 'HB', 'C', 'C', 'C', 'HF', 'HF', 'HF',
      'F', 'F', 'F', 'R', 'R', 'R', 'I/C', 'I/C', 'I/C', 'I/C',
    ]);
  });

  it('rejects a malformed header', () => {
    const lines = [...canonicalLines];
    lines[0] = lines[0].replace('source_key', 'record_key');
    expectRejected(lines, /invalid header/);
  });

  it('rejects an invalid captain flag', () => {
    const lines = [...canonicalLines];
    lines[1] = replaceCell(lines[1], 5, 'yes');
    expectRejected(lines, /is_captain must be exactly '0' or '1'/);
  });

  it('rejects an invalid position', () => {
    const lines = [...canonicalLines];
    lines[1] = replaceCell(lines[1], 2, 'BENCH');
    expectRejected(lines, /invalid position/);
  });

  it('rejects duplicate source keys', () => {
    const lines = [...canonicalLines];
    const firstKey = lines[1].split(',')[0];
    lines[2] = replaceCell(lines[2], 0, firstKey);
    expectRejected(lines, /duplicate source_key/);
  });

  it('rejects duplicate players within a season', () => {
    const lines = [...canonicalLines];
    const firstPlayer = lines[1].split(',')[3];
    lines[2] = replaceCell(lines[2], 3, firstPlayer.toUpperCase());
    expectRejected(lines, /duplicate season\/player/);
  });

  it('uses AFLDB punctuation rules when detecting duplicate players', () => {
    const lines = [...canonicalLines];
    const source = lines.findIndex((line) => line.includes(",Jaeger O'Meara,"));
    const target = lines.findIndex((line) => line.startsWith('22under22:2013:r:1,'));
    expect(source).toBeGreaterThan(0);
    expect(target).toBeGreaterThan(0);
    lines[target] = replaceCell(lines[target], 3, 'Jaeger OMeara');
    expectRejected(lines, /duplicate season\/player/);
  });

  it('rejects an incomplete formation', () => {
    const lines = canonicalLines.slice(0, -1);
    expectRejected(lines, /formation slots are incomplete/);
  });

  it('rejects a missing season', () => {
    const header = canonicalLines[0];
    const without2012 = canonicalLines.slice(1).filter((line) => !line.includes(':2012:'));
    expectRejected([header, ...without2012], /season span must be exactly 2012-2026/);
  });

  it('rejects a season without exactly one captain', () => {
    const lines = canonicalLines.map((line) =>
      line.startsWith('22under22:2012:c:2,') ? replaceCell(line, 5, '0') : line,
    );
    expectRejected(lines, /season 2012: expected 1 captain, got 0/);
  });
});
