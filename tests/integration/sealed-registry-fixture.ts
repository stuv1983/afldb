/**
 * Test seam for editor suites whose fixtures live in "the season after the newest one on the test
 * database" (V2-GAP-006, D-V2-GAP006-EDITORS E1).
 *
 * Those suites (draft, awards) pick their fixture season from the test database itself
 * (`max(matches.season) + 1`, `max(seasons.year)`), which on a rebuilt history is a season the real
 * registry (`data/reference/seasons.json`) has already sealed. They exercise the editors' own
 * behaviour in the CURRENT season, so they declare that season open here instead of threading a
 * 20-character note through every unrelated call. The sealed behaviour is not hidden by this: it is
 * proved against PostgreSQL in tests/integration/sealed-editor-guard.test.ts, with the real
 * registry.
 *
 * Usage, in the suite (vi.mock is hoisted, so the factory loads this module lazily):
 *
 *   vi.mock('@/lib/seasons/sealed-seasons', async (importOriginal) =>
 *     (await import('./sealed-registry-fixture')).withFixtureSeasonOpen(await importOriginal()));
 *   // ...in beforeAll, once the fixture season is known:
 *   setFixtureSeasonOpen(fixtureSeason);
 *
 * Until `setFixtureSeasonOpen` is called the real registry applies unchanged.
 */
import type { SealedSeasons } from '@afldb/domain';

let throughOverride: number | null = null;
let extraOpen: readonly number[] = [];

/** Declare individual seasons inside the sealed range open (a suite whose synthetic rows sit in, say, 1897). */
export function setFixtureSeasonsOpen(seasons: readonly number[]): void {
  extraOpen = [...seasons];
}

/** Every season from this one on is open; the seasons before it stay sealed (1897 onward). */
export function setFixtureSeasonOpen(firstOpenSeason: number): void {
  throughOverride = firstOpenSeason - 1;
}

export function clearFixtureSeasonOpen(): void {
  throughOverride = null;
  extraOpen = [];
}

export function withFixtureSeasonOpen<T extends { loadSealedSeasons: (root?: string) => SealedSeasons }>(
  actual: T,
): T {
  return {
    ...actual,
    loadSealedSeasons: (root?: string): SealedSeasons => {
      const real = actual.loadSealedSeasons(root);
      const through = throughOverride ?? real.through;
      const open = [...new Set([...real.open, ...extraOpen])].sort((a, b) => a - b);
      return { from: real.from, through, open: throughOverride === null ? open : extraOpen.slice().sort((a, b) => a - b) };
    },
  };
}
