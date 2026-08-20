import { describe, expect, it } from 'vitest';

describe('expanded NL UI corpus generator', () => {
  it('does not create doubled metric plurals', async () => {
    const { buildExpandedUiCorpusRows, pluralMetric } = await import('../tmp-generate-expanded-ui-corpus.mjs');

    expect(pluralMetric('goal')).toBe('goals');
    expect(pluralMetric('goals')).toBe('goals');
    expect(pluralMetric('marks')).toBe('marks');
    expect(pluralMetric('handballs')).toBe('handballs');

    const rows = buildExpandedUiCorpusRows();
    const body = rows.slice(1).map((row: string[]) => row[2]).join('\n');

    expect(body).not.toMatch(/\b(?:goalss|markss|kickss|handballss|disposalss)\b/);
  });

  it('keeps debut-season wording as an unsupported boundary oracle', async () => {
    const { buildExpandedUiCorpusRows } = await import('../tmp-generate-expanded-ui-corpus.mjs');

    const rows = buildExpandedUiCorpusRows();
    const debutSeasonRows = rows.slice(1).filter((row: string[]) => row[2].includes('in debut season'));

    expect(debutSeasonRows).toHaveLength(3);
    for (const row of debutSeasonRows) {
      expect(row[3]).toBe('decline');
      expect(row[4]).toContain('unsupported');
    }
  });
});
