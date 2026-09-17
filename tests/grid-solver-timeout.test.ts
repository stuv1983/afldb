/**
 * AFLDB-ISSUE-118 Stage 4 -- the /grid-solver crash with Next digest
 * 1511510695 is a PostgreSQL statement timeout (SQLSTATE 57014) escaping
 * one cell's solve and rejecting the page's Promise.all, which renders the
 * error boundary for the whole route (ISSUE-076 traced the same digest to
 * 57014 on the dev build the telemetry names). The query-level fix is the
 * corpus gate in tests/integration/gridley-corpus.test.ts (no criterion over
 * one second, no timeouts); this guards the page: a timed-out square is
 * reported as one square and nothing else is caught.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({ sql: vi.fn() }));

import { guardCellTimeout, isStatementTimeout } from '@/db/queries/grid-solver';

/** The shape postgres.js gives a cancelled statement: an Error carrying the SQLSTATE in `code`. */
function statementTimeoutError(): Error & { code: string } {
  return Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
}

describe('isStatementTimeout', () => {
  it('recognises SQLSTATE 57014 and nothing else', () => {
    expect(isStatementTimeout(statementTimeoutError())).toBe(true);
    expect(isStatementTimeout(Object.assign(new Error('relation does not exist'), { code: '42P01' }))).toBe(false);
    expect(isStatementTimeout(new Error('Games must be a whole number.'))).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
    expect(isStatementTimeout('57014')).toBe(false);
  });
});

describe('guardCellTimeout', () => {
  it('returns the solved value when the cell completes', async () => {
    await expect(guardCellTimeout(async () => ({ eligible: 3 }))).resolves.toEqual({ status: 'solved', value: { eligible: 3 } });
  });

  it('confines a statement timeout to the one cell', async () => {
    await expect(guardCellTimeout(async () => { throw statementTimeoutError(); })).resolves.toEqual({ status: 'timeout' });
  });

  it('does not swallow anything that is not a timeout', async () => {
    const compileError = new Error('Games must be a whole number.');
    await expect(guardCellTimeout(async () => { throw compileError; })).rejects.toBe(compileError);
    const otherSqlError = Object.assign(new Error('permission denied'), { code: '42501' });
    await expect(guardCellTimeout(async () => { throw otherSqlError; })).rejects.toBe(otherSqlError);
  });

  it('keeps the other cells of a board when one times out', async () => {
    const outcomes = await Promise.all([
      guardCellTimeout(async () => 'a'),
      guardCellTimeout(async () => { throw statementTimeoutError(); }),
      guardCellTimeout(async () => 'c'),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['solved', 'timeout', 'solved']);
  });
});

describe('/grid-solver page', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'app', 'grid-solver', 'page.tsx'), 'utf8');

  it('solves every square and the drill-down through the timeout guard', () => {
    expect(page).toContain('guardCellTimeout(() => solveCellSummary(rowAxis, colAxis, state.order, axisCache))');
    expect(page).toContain('guardCellTimeout(() => solveCellRows(');
    // No bare call remains that could reject the whole render.
    expect(page).not.toMatch(/(?<!\(\) => )solveCellSummary\(/);
    expect(page).not.toMatch(/(?<!\(\) => )solveCellRows\(/);
  });

  it('renders a timed-out square as such rather than as an answer', () => {
    expect(page).toContain("outcome.status === 'timeout'");
    expect(page).toContain('Timed out');
  });
});
