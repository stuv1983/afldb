/**
 * AFLDB-ISSUE-153 Stage 1 — the two public record surfaces whose prose and
 * whose query disagreed (ISSUE-152 finding F1), fixed under operator
 * decisions Q3 (correct the father-son page's meaning; do not re-point it)
 * and Q4 (state relationship = 'sibling' on the family surface).
 *
 * Both changes are deliberately unprovable against today's data: Stage 0
 * measured that no parent_child row carries a family_key and no family_key
 * group holds a non-sibling row (§4.6), so the sibling constraint is a
 * no-op on afldb_test and an integration test would pass either way. What
 * has to be pinned is therefore the CONTRACT — the SQL states the
 * constraint, and the page states what the record is — which is what these
 * tests assert. Query correctness against real rows stays in
 * tests/integration/player-family-and-coaching.test.ts.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ emitted: [] as string[] }));
const emitted = mocks.emitted;

vi.mock('@/db/client', () => {
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    mocks.emitted.push(strings.raw.join(' ? '));
    return [];
  });
  return { sql };
});

vi.mock('@/db/queries/family-records', async () => {
  const actual = await vi.importActual<typeof import('@/db/queries/family-records')>(
    '@/db/queries/family-records',
  );
  return {
    ...actual,
    getFamilyRecords: vi.fn(async () => []),
    getFamilyRecordsSummary: vi.fn(async () => ({ families: 351, linkedPlayers: 704 })),
    getFatherSonRecords: vi.fn(async () => []),
    getFatherSonSummary: vi.fn(async () => ({ total: 127, bothLinked: 96, oneUnlinked: 31 })),
  };
});

// --- Q4: the family board counts siblings, and says so in SQL ---------

describe('family record queries state the sibling relationship (ISSUE-153 Q4)', () => {
  beforeEach(() => {
    emitted.length = 0;
  });

  it('getFamilyRecords constrains every player_relationships scan to siblings', async () => {
    const { getFamilyRecords } = await vi.importActual<
      typeof import('@/db/queries/family-records')
    >('@/db/queries/family-records');
    await getFamilyRecords(50);

    expect(emitted).toHaveLength(1);
    const [query] = emitted;
    const scans = query.split(/\bFROM player_relationships\b/).slice(1);
    // family_names, plus both sides of the family_members union.
    expect(scans).toHaveLength(3);
    for (const scan of scans) {
      expect(scan).toMatch(/^\s*WHERE relationship = 'sibling' AND family_key IS NOT NULL/);
    }
  });

  it('getFamilyRecordsSummary counts the same sibling population as the board it heads', async () => {
    const { getFamilyRecordsSummary } = await vi.importActual<
      typeof import('@/db/queries/family-records')
    >('@/db/queries/family-records');
    await getFamilyRecordsSummary();

    expect(emitted).toHaveLength(1);
    const scans = emitted[0].split(/\bFROM player_relationships\b/).slice(1);
    expect(scans).toHaveLength(2);
    for (const scan of scans) {
      expect(scan).toMatch(/^\s*WHERE relationship = 'sibling' AND family_key IS NOT NULL/);
    }
  });

  it('the father-son board is NOT narrowed to siblings — it reads parent_child', async () => {
    const { getFatherSonRecords, getFatherSonSummary } = await vi.importActual<
      typeof import('@/db/queries/family-records')
    >('@/db/queries/family-records');
    await getFatherSonRecords(200);
    await getFatherSonSummary();

    expect(emitted).toHaveLength(2);
    for (const query of emitted) {
      expect(query).toContain("relationship = 'parent_child'");
      expect(query).not.toContain("relationship = 'sibling'");
    }
  });
});

// --- Q3: the father-son page describes the selection rule -------------

describe('/records/father-son prose describes the selection record (ISSUE-153 Q3)', () => {
  it('names the AFL father-son rule selection, not a bare parent-child relationship', async () => {
    const page = (await import('@/app/records/father-son/page')).default;
    const html = renderToStaticMarkup(await page());
    const text = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, (e) => (e === '&ndash;' ? '–' : ' '));

    // What the record IS.
    expect(text).toMatch(/selection[s]? made under the AFL father–son rule/i);
    expect(text).toMatch(/drafted under the rule/i);
    // What it is NOT — the reading ISSUE-152 F1 recorded as the page's defect.
    expect(text).toMatch(/not a general record of fathers and sons who both played/i);
    // The authority is named, and the projection is not presented as the authority.
    expect(html).toContain('father_son_selections');
    expect(text).toMatch(/authority/i);
    // Scopes that live only on the selection record are disclosed as absent.
    expect(text).toMatch(/Club, draft year, pick and draft pathway live only on the selection record/i);
  });

  it('states the unlinked-side contract instead of the previous garbled sentence', async () => {
    const page = (await import('@/app/records/father-son/page')).default;
    const html = renderToStaticMarkup(await page());

    expect(html).not.toContain('not fabricated a player');
    expect(html).toMatch(/does not fabricate a player identity for an unmatched name/i);
    expect(html).toMatch(/no\s+combined total/i);
    // The stat strip counts selections, which is what the 127 rows are.
    expect(html).toContain('Recorded selections');
    expect(html).not.toContain('Recorded pairs');
  });
});

describe('/records/family prose matches the constrained query (ISSUE-153 Q4)', () => {
  it('says only sibling relationships are counted', async () => {
    const page = (await import('@/app/records/family/page')).default;
    const html = renderToStaticMarkup(await page());
    const text = html.replace(/<[^>]*>/g, ' ');

    expect(text).toMatch(/only sibling relationships are counted/i);
    expect(text).toMatch(/never adds a member or\s+a game to a family here/i);
  });
});
