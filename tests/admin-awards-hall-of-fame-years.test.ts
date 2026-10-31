/**
 * Hall of Fame legend and removal years (AFLDB-ISSUE-286).
 *
 * `legend_year` and `removed_year` were bounded only against the induction
 * year, only on creation, and only for a Legend: a correction took any integer,
 * a non-Legend could keep a legend year, and a value above 32767 failed on the
 * `smallint` cast with a raw error. These cases drive the live mutation module
 * (`src/db/queries/admin-awards.ts`) over a fake transaction, so what is
 * asserted is the decision the code makes BEFORE it writes: a refusal that never
 * opens a connection, a precheck refusal that issues no UPDATE, and the value a
 * written statement carries. No database.
 *
 * What genuinely needs PostgreSQL (the real `smallint` columns, the row lock
 * and the atomic override/audit write) is `tests/integration/admin-awards.test.ts`
 * and is not exercised here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ postgres: vi.fn() }));

vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/client', () => ({ sql: vi.fn() }));

import {
  correctHallOfFameInductee,
  createHallOfFameInductee,
  hallOfFameYearsRefusal,
  replaceHallOfFameInductee,
  type HallOfFameCorrection,
  type HallOfFameRow,
} from '@/db/queries/admin-awards';

type Captured = { text: string; values: unknown[] };

const UPDATED_AT = '2026-10-14T00:00:00.000Z';

function hallRow(over: Partial<HallOfFameRow> = {}): HallOfFameRow {
  return {
    id: 7,
    name: 'Test Inductee',
    playerId: null,
    playerSlug: null,
    linkStatus: 'unmatched',
    category: 'Player',
    inductedYear: 2005,
    isLegend: false,
    legendYear: null,
    clubNameRaw: null,
    state: null,
    playingCareer: null,
    removedYear: null,
    notes: null,
    sourceId: 3,
    sourceKey: 'afl_hall_of_fame',
    status: 'active',
    statusReason: null,
    updatedAt: UPDATED_AT,
    ...over,
  };
}

let queries: Captured[];

function installFakeTransaction(locked: HallOfFameRow | null) {
  queries = [];
  const tx = Object.assign(
    vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      queries.push({ text, values });
      if (text.includes('SELECT id FROM sources')) return [{ id: 57 }];
      if (text.includes('INSERT INTO data_edits')) return [{ id: 9001 }];
      if (text.includes('FOR UPDATE')) return locked ? [{ id: locked.id }] : [];
      if (text.includes('INSERT INTO hall_of_fame')) return [{ id: 201 }];
      return [];
    }),
    {
      json: vi.fn((value: unknown) => value),
      unsafe: vi.fn(async () => (locked ? [locked] : [])),
    },
  );
  const importSql = {
    begin: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
    end: vi.fn(async () => undefined),
  };
  mocks.postgres.mockReset();
  mocks.postgres.mockReturnValue(importSql);
  return { tx, importSql };
}

const hallUpdates = () => queries.filter((q) => q.text.includes('UPDATE hall_of_fame'));
const hallInserts = () => queries.filter((q) => q.text.includes('INSERT INTO hall_of_fame'));

const base = { rowId: 7, expectedUpdatedAt: UPDATED_AT, adminUserId: 9 };
const created = { name: 'Test Inductee', inductedYear: 2005, adminUserId: 9 };

function correct(fields: HallOfFameCorrection) {
  return correctHallOfFameInductee({ ...base, fields });
}

beforeEach(() => {
  vi.stubEnv('AFLDB_IMPORT_DATABASE_URL', 'postgres://import@example/afldb_test');
  installFakeTransaction(hallRow());
});

describe('hallOfFameYearsRefusal: the one rule', () => {
  const legend = (legendYear: number | null | undefined, inductedYear: number | null = 2005) => hallOfFameYearsRefusal({
    inductedYear, isLegend: true, legendYear, removedYear: undefined,
  });
  const removal = (removedYear: number | null | undefined, inductedYear: number | null = 2005) => hallOfFameYearsRefusal({
    inductedYear, isLegend: false, legendYear: null, removedYear,
  });

  it('accepts a Legend year from the induction year to 2100 inclusive', () => {
    expect(legend(2005)).toBeNull();
    expect(legend(2100)).toBeNull();
  });

  it.each([20999, 32768, 2101, 2004, 1995, 2005.5, Number.NaN])('refuses a Legend year of %s', (year) => {
    expect(legend(year)).toBe('Legend year must be from the induction year to 2100.');
  });

  it('requires a legend year for a Legend, but never for anyone else', () => {
    expect(legend(null)).not.toBeNull();
    expect(legend(undefined)).not.toBeNull();
    expect(hallOfFameYearsRefusal({
      inductedYear: 2005, isLegend: false, legendYear: 20999, removedYear: undefined,
    })).toBeNull();
  });

  it('accepts a removal year from the induction year to 2100, or none', () => {
    expect(removal(null)).toBeNull();
    expect(removal(undefined)).toBeNull();
    expect(removal(2005)).toBeNull();
    expect(removal(2100)).toBeNull();
  });

  it.each([20999, 32768, 2101, 2004, 1995, 2005.5])('refuses a removal year of %s', (year) => {
    expect(removal(year)).toBe('Removal year must be from the induction year to 2100.');
  });

  it('floors both years at 1996 when the row has no induction year', () => {
    expect(legend(1996, null)).toBeNull();
    expect(legend(1995, null)).not.toBeNull();
    expect(removal(1996, null)).toBeNull();
    expect(removal(1995, null)).not.toBeNull();
  });
});

describe('createHallOfFameInductee refuses implausible years before it connects', () => {
  it.each([20999, 2101, 2004, 1995])('refuses a removal year of %s', async (removedYear) => {
    const result = await createHallOfFameInductee({ ...created, removedYear });
    expect(result).toMatchObject({
      ok: false, reason: 'validation', error: 'Removal year must be from the induction year to 2100.',
    });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it.each([20999, 2101, 2004])('refuses a Legend year of %s', async (legendYear) => {
    const result = await createHallOfFameInductee({ ...created, isLegend: true, legendYear });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it('stores a valid removal year and Legend year as given', async () => {
    const result = await createHallOfFameInductee({
      ...created, isLegend: true, legendYear: 2010, removedYear: 2020,
    });
    expect(result).toMatchObject({ ok: true });
    const [insert] = hallInserts();
    expect(insert.values[5]).toBe(true);
    expect(insert.values[6]).toBe(2010);
    expect(insert.values[10]).toBe(2020);
  });

  it('stores no legend year for a non-Legend, whatever was supplied', async () => {
    const result = await createHallOfFameInductee({ ...created, isLegend: false, legendYear: 2050 });
    expect(result).toMatchObject({ ok: true });
    const [insert] = hallInserts();
    expect(insert.values[5]).toBe(false);
    expect(insert.values[6]).toBeNull();
  });
});

describe('replaceHallOfFameInductee applies the same rule to the replacement', () => {
  const replace = (replacement: Parameters<typeof replaceHallOfFameInductee>[0]['replacement']) => replaceHallOfFameInductee({
    ...base, reason: 'the source named the wrong person', replacement,
  });

  it('refuses an implausible removal year without opening a connection', async () => {
    const result = await replace({ name: 'Right Person', inductedYear: 2005, removedYear: 20999 });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it('refuses an out-of-range induction year without opening a connection', async () => {
    const result = await replace({ name: 'Right Person', inductedYear: 1990 });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it('carries a valid replacement through, with no legend year for a non-Legend', async () => {
    const result = await replace({
      name: 'Right Person', inductedYear: 2005, isLegend: false, legendYear: 2050,
    });
    expect(result).toMatchObject({ ok: true });
    const [insert] = hallInserts();
    expect(insert.values[5]).toBe(false);
    expect(insert.values[6]).toBeNull();
  });
});

describe('correctHallOfFameInductee bounds both years on the correction path', () => {
  it.each([20999, 32768, 2101, 1995])('refuses a removal year of %s before it connects', async (removedYear) => {
    const result = await correct({ removedYear });
    expect(result).toMatchObject({
      ok: false, reason: 'validation', error: 'Removal year must be from the induction year to 2100.',
    });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it('refuses a supplied Legend year of 20999 for a Legend before it connects', async () => {
    const result = await correct({ isLegend: true, legendYear: 20999 });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it('refuses a removal year before the induction year, with no UPDATE', async () => {
    const result = await correct({ removedYear: 2003 });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(hallUpdates()).toHaveLength(0);
  });

  it('refuses a Legend year before the induction year, with no UPDATE', async () => {
    const result = await correct({ isLegend: true, legendYear: 2001 });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(hallUpdates()).toHaveLength(0);
  });

  it('refuses making an entry a Legend without a year, with no UPDATE', async () => {
    const result = await correct({ isLegend: true });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(hallUpdates()).toHaveLength(0);
  });

  it('refuses a Legend year of 20999 for an entry that is already a Legend, with no UPDATE', async () => {
    installFakeTransaction(hallRow({ isLegend: true, legendYear: 2010 }));
    const result = await correct({ legendYear: 20999 });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    expect(hallUpdates()).toHaveLength(0);
  });

  it('accepts the boundary years and writes them', async () => {
    const result = await correct({ isLegend: true, legendYear: 2100, removedYear: 2005 });
    expect(result).toMatchObject({ ok: true });
    const [update] = hallUpdates();
    // category, is_legend, legend_year, club, state, career, removed_year, notes, id
    expect(update.values[1]).toBe(true);
    expect(update.values[2]).toBe(2100);
    expect(update.values[6]).toBe(2005);
  });

  it('clears the legend year when Legend is un-ticked', async () => {
    installFakeTransaction(hallRow({ isLegend: true, legendYear: 2010 }));
    const result = await correct({ isLegend: false });
    expect(result).toMatchObject({ ok: true });
    const [update] = hallUpdates();
    expect(update.values[1]).toBe(false);
    expect(update.values[2]).toBeNull();
  });

  it('clears, rather than stores, a legend year named for a non-Legend', async () => {
    const result = await correct({ legendYear: 2050 });
    expect(result).toMatchObject({ ok: true });
    const [update] = hallUpdates();
    expect(update.values[1]).toBe(false);
    expect(update.values[2]).toBeNull();
  });

  it('leaves a non-Legend\'s stored legend year alone when the correction does not touch it', async () => {
    installFakeTransaction(hallRow({ isLegend: false, legendYear: 2012 }));
    const result = await correct({ notes: 'a note' });
    expect(result).toMatchObject({ ok: true });
    const [update] = hallUpdates();
    expect(update.values[2]).toBe(2012);
  });
});
