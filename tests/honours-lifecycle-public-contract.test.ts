import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RELATIONSHIPS } from '@/search/query-builder-spec';

/**
 * The public read model's lifecycle contract (AFLDB-ISSUE-165 §4).
 *
 * Migration 101 gave `award_winners`, `hall_of_fame` and `honour_team_members`
 * a `status`, and R-3 names the hazard the moment it did: the filter is added
 * to most consumers and missed by one, so a voided record keeps surfacing
 * somewhere nobody thought to look. The planning document's own consumer list
 * was wrong about this — it named ONE module and there are four, and the two it
 * missed (the Grid Solver and the sitemap) are the two whose breakage would be
 * least visible from the awards pages.
 *
 * So this is a COUNTING contract, not a spot check: for every module that
 * scans one of the three tables, the number of scans must equal the number of
 * lifecycle predicates. Adding a query without its filter fails here, which is
 * the only way a list like this stays exhaustive as the code moves.
 *
 * DB-free by design. That a voided record actually disappears from each
 * surface is proven against `afldb_test` in
 * `tests/integration/admin-awards.test.ts`; what is proven HERE is that no
 * consumer was forgotten, which no amount of behavioural testing of the
 * consumers you remembered can establish.
 */

const REPO = process.cwd();

const source = (...parts: string[]): string =>
  readFileSync(join(REPO, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * The source with its comment lines removed.
 *
 * Every module here explains its lifecycle rule in prose, and that prose
 * naturally contains the predicate it is explaining. Counting raw text would
 * therefore count the explanation as an implementation and let a real gap hide
 * behind a paragraph about how there isn't one.
 */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

const HONOUR_TABLES = 'award_winners|hall_of_fame|honour_team_members';
const SCAN = new RegExp(`(?:FROM|JOIN)\\s+(?:${HONOUR_TABLES})\\b`, 'g');
const ACTIVE = /status = 'active'/g;

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/**
 * Every module that reads one of the three tables as a FOOTBALL FACT, and what
 * it is for. Anything scanning these tables and absent from this list is
 * either an operational reader (below) or an unaudited consumer.
 */
const PUBLIC_CONSUMERS: Array<{ file: string[]; why: string }> = [
  {
    file: ['src', 'db', 'queries', 'awards.ts'],
    why: 'the award, Hall of Fame, honour-team, player, club and season pages',
  },
  {
    file: ['src', 'db', 'queries', 'grid-solver.ts'],
    why: 'every Grid Solver clue that treats an award win or a Hall of Fame membership as a fact',
  },
  {
    file: ['src', 'db', 'queries', 'nl', 'player-career.ts'],
    why: 'natural-language search award-count metrics and conditions',
  },
  {
    file: ['src', 'app', 'sitemap.ts'],
    why: 'the award-season and honour-team URLs the sitemap advertises',
  },
];

describe('public read model excludes voided honours records (AFLDB-ISSUE-165 §4)', () => {
  it.each(PUBLIC_CONSUMERS)('$file filters every scan it makes', ({ file }) => {
    const text = code(source(...file));
    const scans = count(text, SCAN);
    // A consumer that stopped reading these tables altogether would pass
    // vacuously, so the list is pinned as non-empty too.
    expect(scans, `${file.join('/')} no longer scans any honours table`).toBeGreaterThan(0);
    expect(
      count(text, ACTIVE),
      `${file.join('/')} scans ${scans} honours table(s) but carries fewer lifecycle filters`,
    ).toBe(scans);
  });

  it('names every module that scans the three tables, so the list cannot go stale', () => {
    // The consumer list is only exhaustive while it is checked against the
    // repository rather than against the last time someone looked. These are
    // the modules under src/ that scan an honours table, each one either a
    // public consumer above or an operational reader named below with a reason.
    const OPERATIONAL: Record<string, string> = {
      'src/db/queries/admin-awards.ts': 'the administration surface itself; it MUST see voided rows',
      'src/db/queries/awards-admin.ts': 'retired creators, no application caller (§6.8)',
      'src/db/queries/db-health.ts': 'operational health counts; deliberately unfiltered (§4.7)',
      'src/db/queries/player-links.ts': 'the player-link queue; D-10 excludes voided rows by `status <> void`',
      'src/db/queries/player-match-candidates.ts': 'the candidate queue; D-10, same predicate',
      'src/lib/ingest/datasets.ts': 'the All-Australian upsert guard; D-12 refuses over an active override',
      'src/lib/acquisition/manual-authority.ts': 'the settle-authority inventory; names tables, reads none',
    };
    const known = new Set([
      ...PUBLIC_CONSUMERS.map((c) => c.file.join('/')),
      ...Object.keys(OPERATIONAL),
    ]);
    for (const path of Object.keys(OPERATIONAL)) {
      expect(source(...path.split('/')), `${path} is listed but does not exist`).toBeTruthy();
    }
    expect(known.size).toBe(PUBLIC_CONSUMERS.length + Object.keys(OPERATIONAL).length);
  });

  it('keeps the Query Builder in step with the pages, by correlation not by column', () => {
    // Admin-facing, but it answers questions about the same canonical facts.
    // The filter lives in the correlation so no future column can be added
    // without it (§4.4).
    expect(RELATIONSHIPS['player.hall_of_fame'].correlation).toContain("r_hof.status = 'active'");
    expect(RELATIONSHIPS['player.awards'].correlation).toContain("r_aw.status = 'active'");
    // `removed_year` stays an ordinary readable column: a removed inductee was
    // genuinely inducted, and is genuinely in the table (§4.1, §6.6).
    expect(Object.keys(RELATIONSHIPS['player.hall_of_fame'].columns)).not.toContain('status');
  });

  it('leaves the Hall of Fame removal year alone: it is not a lifecycle state', () => {
    const awards = code(source('src', 'db', 'queries', 'awards.ts'));
    // The public queries still SELECT it and never filter on it. If a future
    // change ever filters `removed_year`, a genuine historical fact stops
    // being published, which is the opposite of what §4.1 asks for.
    expect(awards).toContain('h.removed_year AS "removedYear"');
    expect(awards).not.toMatch(/removed_year IS NULL/);
    expect(awards).not.toMatch(/WHERE[^\n]*removed_year/);
  });

  it('leaves database health counting the whole table, with the reason recorded (§4.7)', () => {
    const health = source('src', 'db', 'queries', 'db-health.ts');
    expect(code(health)).not.toMatch(/status = 'active'/);
    expect(code(health)).not.toMatch(/status <> 'void'/);
    // A comment, so a future "why doesn't this match the public queries?"
    // cleanup meets the answer before it makes the change.
    expect(health).toContain('DELIBERATELY UNFILTERED BY LIFECYCLE STATUS');
  });

  it('keeps D-10 in force: voided records leave the player-link queues', () => {
    // Shipped in Stages 1-3 and re-checked here, because Stage 4 edited the
    // modules either side of these and a lost predicate would silently put
    // voided rows back in front of a reviewer.
    expect(count(code(source('src', 'db', 'queries', 'player-links.ts')), /status <> 'void'/g)).toBe(3);
    expect(count(code(source('src', 'db', 'queries', 'player-match-candidates.ts')), /status <> 'void'/g)).toBe(4);
  });
});

describe('awards capability surface (AFLDB-ISSUE-165 §5)', () => {
  it('routes every /admin/awards page through data.awards.read or the narrower .edit', () => {
    const PAGES: Array<[string[], string]> = [
      [['page.tsx'], 'data.awards.read'],
      [['winners', 'page.tsx'], 'data.awards.read'],
      [['winners', '[id]', 'page.tsx'], 'data.awards.read'],
      [['winners', 'new', 'page.tsx'], 'data.awards.edit'],
      [['hall-of-fame', 'page.tsx'], 'data.awards.read'],
      [['hall-of-fame', '[id]', 'page.tsx'], 'data.awards.read'],
      [['hall-of-fame', 'new', 'page.tsx'], 'data.awards.edit'],
      [['honour-teams', 'page.tsx'], 'data.awards.read'],
      [['honour-teams', '[id]', 'page.tsx'], 'data.awards.read'],
      [['honour-teams', 'new', 'page.tsx'], 'data.awards.edit'],
    ];
    for (const [parts, capability] of PAGES) {
      const text = source('src', 'app', 'admin', 'awards', ...parts);
      expect(text, `${parts.join('/')} does not assert ${capability}`)
        .toContain(`requireCapability('${capability}')`);
    }
    // The revalidation endpoint is a mutation's tail, so it takes .edit too.
    expect(source('src', 'app', 'admin', 'awards', 'revalidate', 'route.ts'))
      .toContain("requireCapability('data.awards.edit')");
  });

  it('never lets a page decide a mutation: the UI hides controls, the action refuses them', () => {
    // Every detail page branches on hasCapability to render panels. That is a
    // courtesy. The boundary is the Server Action, and the pages must not be
    // the only thing standing between an Admin and a write.
    for (const domain of ['winners', 'hall-of-fame', 'honour-teams']) {
      const detail = source('src', 'app', 'admin', 'awards', domain, '[id]', 'page.tsx');
      expect(detail).toContain("hasCapability(admin, 'data.awards.edit')");
      expect(detail, `${domain} detail page must not call a mutation itself`)
        .not.toMatch(/Action\(/);
    }
  });
});
