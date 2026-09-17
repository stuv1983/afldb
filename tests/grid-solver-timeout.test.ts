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
// A tag that records nothing: compileAxis validates every parameter before it
// interpolates one, which is what the GridAxisError cases below rely on.
vi.mock('@/db/client', () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));

import { compileAxis, GridAxisError, guardCellTimeout, isStatementTimeout } from '@/db/queries/grid-solver';

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

  // AFLDB-ISSUE-221.
  it('renders an invalid axis value as such, keys the form by the board token, and names a question nobody matches', () => {
    expect(page).toContain("outcome.status === 'invalid'");
    expect(page).toContain('Invalid value');
    // The form keeps the board in client state; keyed by the token, "Reset"
    // and a shared link both remount it on the board the URL names.
    expect(page).toMatch(/<GridSolverForm\s+key=\{boardToken\}/);
    // An axis with no players is told apart from an empty intersection.
    expect(page).toContain('cell.emptyAxis');
    expect(page).toContain('No data');
  });
});

/**
 * AFLDB-ISSUE-221 -- a share link is hand-editable and the form's number
 * inputs accept any magnitude, and before this a season of 199999 or a
 * threshold of 99999999999 reached PostgreSQL as a bound value it rejects
 * (22003, out of range for smallint/integer) -- which is not a timeout, so
 * the whole page rendered the error boundary. Every request number is now
 * bounded at the compiler, the failure is a GridAxisError, and the guard
 * confines it to the squares that use the axis.
 */
describe('GridAxisError', () => {
  const axis = (builder: string, params: Record<string, string>) => ({ builder, params });

  it('bounds thresholds to the smallint range and ids to the integer range', () => {
    expect(() => compileAxis(axis('career_games_min', { games: '32767' }))).not.toThrow();
    expect(() => compileAxis(axis('career_games_min', { games: '32768' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('career_games_min', { games: '99999999999' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('career_games_min', { games: '-1' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('career_games_min', { games: '1.5' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('career_games_min', { games: 'abc' }))).toThrow('Games must be a whole number between 0 and 32767.');
    expect(() => compileAxis(axis('debuted_between', { from: '1990', to: '199999' }))).toThrow('To season must be a whole number between 0 and 32767.');
    expect(() => compileAxis(axis('played_for_club', { club: '100000' }))).not.toThrow();
    expect(() => compileAxis(axis('played_for_club', { club: '3000000000' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('teammate_of', { player: '' }))).toThrow('Player is required.');
  });

  it('rejects a non-finite or negative average and an unknown statistic or draft kind the same way', () => {
    expect(() => compileAxis(axis('career_stat_avg_min', { stat: 'goals', avg: '1e400', minGames: '1' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('career_stat_avg_min', { stat: 'goals', avg: '-2', minGames: '1' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('career_stat_avg_min', { stat: 'spoils', avg: '1', minGames: '1' }))).toThrow(GridAxisError);
    expect(() => compileAxis(axis('draft_type_is', { draftType: 'pre_season' }))).toThrow('Draft type is not one of the recorded draft kinds.');
    expect(() => compileAxis(axis('draft_type_is', { draftType: 'National Draft' }))).not.toThrow();
    expect(() => compileAxis(axis('given_name_in', { names: ' , , ' }))).toThrow(GridAxisError);
  });

  it('is confined to its square by guardCellTimeout, carrying the parameter message', async () => {
    const bad = new GridAxisError('Games must be a whole number between 0 and 32767.');
    await expect(guardCellTimeout(async () => { throw bad; })).resolves.toEqual({ status: 'invalid', message: bad.message });
    // A data exception is NOT confined: the bounds make it unreachable, so one
    // arriving is a real fault and still rejects the render.
    const outOfRange = Object.assign(new Error('value "199999" is out of range for type smallint'), { code: '22003' });
    await expect(guardCellTimeout(async () => { throw outOfRange; })).rejects.toBe(outOfRange);
  });
});
