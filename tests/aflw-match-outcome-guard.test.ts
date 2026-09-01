import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  unsafe: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/db/client', () => {
  const sql = Object.assign(
    vi.fn(async () => [{ total: '0' }]),
    { unsafe: mocks.unsafe },
  );
  return { sql };
});

import { runAflwMatchSearch } from '@/db/queries/aflw';
import {
  AFLW_MATCH_OUTCOME_FILTERS,
  AFLW_MATCH_SORTS,
} from '@/search/aflw-filters';

describe('runAflwMatchSearch outcome guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.unsafe.mockImplementation((value: string) => value);
  });

  it('ignores inherited Object properties rather than treating them as outcome filters', async () => {
    await runAflwMatchSearch({
      sort: 'date_desc',
      limit: 20,
      offset: 0,
      outcome: 'constructor',
    });

    expect(mocks.unsafe).toHaveBeenCalledTimes(1);
    expect(mocks.unsafe).toHaveBeenCalledWith(AFLW_MATCH_SORTS.date_desc.sql);
  });

  it('still applies a registered outcome filter', async () => {
    const [outcome] = Object.keys(AFLW_MATCH_OUTCOME_FILTERS) as Array<
      keyof typeof AFLW_MATCH_OUTCOME_FILTERS
    >;

    await runAflwMatchSearch({
      sort: 'date_desc',
      limit: 20,
      offset: 0,
      outcome,
    });

    expect(mocks.unsafe).toHaveBeenCalledTimes(2);
    expect(mocks.unsafe).toHaveBeenCalledWith(AFLW_MATCH_OUTCOME_FILTERS[outcome].sql);
    expect(mocks.unsafe).toHaveBeenCalledWith(AFLW_MATCH_SORTS.date_desc.sql);
  });
});
