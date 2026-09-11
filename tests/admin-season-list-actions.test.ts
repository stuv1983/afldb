/**
 * The pure half of season list administration (AFLDB-ISSUE-161 Stage 1).
 *
 * Everything here is a decision the code makes BEFORE it writes anything: the
 * durable key shape and its parser, the season-bound arithmetic, the frozen
 * origin enumeration, and — driven over a fake transaction — the proof that
 * every precondition refusal really does happen with no statement written. No
 * database, so each rule is exercised in isolation from whatever rows happen to
 * exist.
 *
 * The half that genuinely needs PostgreSQL — that a mutation writes the
 * canonical row, the durable override and the audit row TOGETHER and rolls all
 * three back on any failure, that the tombstone survives a real replay, and
 * that the whole mutation set works for a season with zero matches — is
 * `tests/integration/admin-season-lists.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ postgres: vi.fn(), sql: vi.fn() }));
vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));

import {
  FIRST_LIST_SEASON,
  SEASON_LIST_ENTITY_TYPE,
  SEASON_LIST_FIELD_GROUP,
  SEASON_LIST_ORIGINS,
  addSeasonListMember,
  addSeasonListMembers,
  administrableListSeasons,
  isAdministrableListSeason,
  listSeasonBounds,
  parseSeasonListEntityKey,
  seasonListEntityKey,
} from '@/db/queries/admin-season-lists';

const migration = readFileSync(
  join(process.cwd(), 'src/db/migrations/096_season_list_members.sql'), 'utf8',
).replace(/\r\n/g, '\n');

type Responder = (text: string) => unknown[];

/** A postgres.js-shaped tagged template that answers from `respond`. */
type FakeTx = ((first: TemplateStringsArray | string) => unknown) & {
  json: (value: unknown) => unknown;
  unsafe: (text: string) => Promise<unknown>;
};

function fakeTx(respond: Responder) {
  const seen: string[] = [];
  const tx = ((first: TemplateStringsArray | string) => {
    if (typeof first === 'string') return { identifier: first };
    const text = first.join('?').replace(/\s+/g, ' ').trim();
    seen.push(text);
    return Promise.resolve(respond(text));
  }) as FakeTx;
  tx.json = (value: unknown) => ({ json: value });
  tx.unsafe = (text: string) => {
    seen.push(text.replace(/\s+/g, ' ').trim());
    return Promise.resolve(respond(text));
  };
  return { tx, seen };
}

/**
 * Stand in for the import-role connection `withImportConnection()` opens, so a
 * mutation can be driven to its refusal without a database. `seen` is every
 * statement the mutation actually issued — which is how "refused before any
 * write" is proved rather than asserted.
 */
function fakeImportConnection(respond: Responder) {
  const { tx, seen } = fakeTx(respond);
  mocks.postgres.mockReturnValue({
    begin: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    end: async () => {},
  });
  return seen;
}

/** The default answers: a 2026 register, one eligible club, one identified player. */
function defaultDb(overrides: Record<string, unknown[]> = {}): Responder {
  return (text) => {
    const flat = text.replace(/\s+/g, ' ');
    for (const [needle, rows] of Object.entries(overrides)) {
      if (flat.includes(needle)) return rows;
    }
    if (flat.includes('max(year)::int')) return [{ maxYear: 2026 }];
    if (flat.includes('FROM clubs c')) {
      return [{ id: 7, slug: 'richmond', name: 'Richmond', organizationId: 7, eligible: true }];
    }
    if (flat.includes('FROM players WHERE id')) return [{ id: 42, displayName: 'A Listed Player' }];
    if (flat.includes('SELECT DISTINCT e.external_id')) {
      return [{ externalId: 'players/D/Dustin_Martin0.html' }];
    }
    if (flat.includes('ORDER BY e.external_id')) return [];
    if (flat.includes('FROM season_list_members m')) return [];
    if (flat.includes('FROM sources WHERE key')) return [{ id: 3 }];
    if (flat.includes('INSERT INTO season_list_members')) return [{ id: 500 }];
    return [];
  };
}

const wrote = (seen: string[]) =>
  seen.filter((s) => /INSERT INTO|UPDATE |DELETE FROM/i.test(s));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AFLDB_IMPORT_DATABASE_URL = 'postgresql://fake@127.0.0.1:5432/afldb_test';
});

describe('the durable key shape (§5)', () => {
  it('is natural, not a minted token, and round-trips', () => {
    const key = seasonListEntityKey({
      clubSlug: 'richmond', season: 2027, playerIdentity: 'afltables:players/D/Dustin_Martin0.html',
    });
    expect(key).toBe('richmond|2027|afltables:players/D/Dustin_Martin0.html');
    expect(parseSeasonListEntityKey(key)).toEqual({
      clubSlug: 'richmond', season: 2027, playerIdentity: 'afltables:players/D/Dustin_Martin0.html',
    });

    const manual = seasonListEntityKey({
      clubSlug: 'gold-coast', season: 2027,
      playerIdentity: 'manual_admin_edit:2f6c0d3e-4a5b-6c7d-8e9f-001122334455',
    });
    expect(parseSeasonListEntityKey(manual)?.playerIdentity)
      .toBe('manual_admin_edit:2f6c0d3e-4a5b-6c7d-8e9f-001122334455');
  });

  it('refuses every shape that is not one, including the null|null class', () => {
    // §5: no equivalent of `null|null|<year>|null` can arise. These are the ways
    // one could be spelled, and none of them parses.
    for (const bad of [
      '', 'richmond', 'richmond|2027', '|2027|afltables:x', 'richmond||afltables:x',
      'richmond|2027|', 'null|null|2027|null', 'richmond|27|afltables:x',
      'richmond|20a7|afltables:x',
    ]) {
      expect(parseSeasonListEntityKey(bad), bad).toBeNull();
    }
  });

  it('keeps the identity last, so a separator inside one cannot corrupt the key', () => {
    const parsed = parseSeasonListEntityKey('richmond|2027|manual_admin_edit:a|b');
    expect(parsed).toEqual({
      clubSlug: 'richmond', season: 2027, playerIdentity: 'manual_admin_edit:a|b',
    });
  });

  it('names the entity type and field group the migration admits', () => {
    expect(SEASON_LIST_ENTITY_TYPE).toBe('season_list_members');
    expect(SEASON_LIST_FIELD_GROUP).toBe('membership');
    expect(migration).toContain("'season_list_members'");
  });
});

describe('the season bound (§9.1, I-4, D-2)', () => {
  it('is 2027 at the bottom and max(seasons.year) + 1 at the top', () => {
    expect(FIRST_LIST_SEASON).toBe(2027);
    expect(listSeasonBounds(2026)).toEqual({ first: 2027, last: 2027 });
    expect(listSeasonBounds(2027)).toEqual({ first: 2027, last: 2028 });
  });

  it('admits nothing at all when the register is empty', () => {
    const bounds = listSeasonBounds(null);
    expect(bounds.first).toBeGreaterThan(bounds.last);
    expect(isAdministrableListSeason(2027, bounds)).toBe(false);
  });

  it('refuses every season below 2027, whatever the register says', () => {
    for (const maxYear of [2026, 2030, 2100]) {
      const bounds = listSeasonBounds(maxYear);
      expect(isAdministrableListSeason(2026, bounds), String(maxYear)).toBe(false);
      expect(isAdministrableListSeason(1990, bounds), String(maxYear)).toBe(false);
    }
  });

  it('refuses a non-integer or fractional season', () => {
    const bounds = listSeasonBounds(2026);
    expect(isAdministrableListSeason(2027.5, bounds)).toBe(false);
    expect(isAdministrableListSeason(Number.NaN, bounds)).toBe(false);
  });
});

describe('the test-only ceiling is inert outside a test run', () => {
  const original = process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON;
  afterEach(() => {
    if (original === undefined) delete process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON;
    else process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON = original;
    vi.unstubAllEnvs();
  });

  it('raises the ceiling under vitest', () => {
    expect(process.env.NODE_ENV).toBe('test');
    process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON = '2028';
    mocks.sql.mockReturnValue(Promise.resolve([{ maxYear: 2026 }]));
    return administrableListSeasons().then((bounds) => {
      expect(bounds).toEqual({ first: 2027, last: 2029 });
    });
  });

  it('is ignored entirely when NODE_ENV is not test — the production case', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON = '2099';
    mocks.sql.mockReturnValue(Promise.resolve([{ maxYear: 2026 }]));
    // The real rule, unmoved: the variable cannot widen what a running server
    // will administer, and it can never lower FIRST_LIST_SEASON in any case.
    expect(await administrableListSeasons()).toEqual({ first: 2027, last: 2027 });
  });

  it('never lowers the floor', async () => {
    process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON = '1900';
    mocks.sql.mockReturnValue(Promise.resolve([{ maxYear: 2026 }]));
    const bounds = await administrableListSeasons();
    expect(bounds.first).toBe(2027);
    expect(bounds.last).toBe(2027);
  });
});

describe('the frozen origin enumeration (D-2)', () => {
  it('equals the migration CHECK and carries no appearance-derived value', () => {
    const check = /origin\s+text\s+NOT NULL CHECK \(origin IN \(([\s\S]*?)\)\),/.exec(migration)![1];
    const inMigration = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...SEASON_LIST_ORIGINS].sort()).toEqual([...inMigration].sort());
    expect(SEASON_LIST_ORIGINS).not.toContain('seeded_appearances');
    expect(migration).not.toContain('seeded_appearances');
  });
});

describe('every precondition refuses before a single statement writes (§18)', () => {
  it('refuses a season below 2027 and names why', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await addSeasonListMember({
      season: 2026, clubSlug: 'richmond', playerId: 42, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('validation');
    expect(result.error).toContain('2027');
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a season beyond the register + 1', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await addSeasonListMember({
      season: 2029, clubSlug: 'richmond', playerId: 42, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('validation');
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a club that is not eligible in the season', async () => {
    const seen = fakeImportConnection(defaultDb({
      'FROM clubs c': [{ id: 9, slug: 'fitzroy', name: 'Fitzroy', organizationId: 9, eligible: false }],
    }));
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'fitzroy', playerId: 42, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('validation');
    expect(result.error).toContain('Fitzroy');
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses an unknown club without inventing one', async () => {
    const seen = fakeImportConnection(defaultDb({ 'FROM clubs c': [] }));
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'not-a-club', playerId: 42, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('validation');
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a player who does not exist', async () => {
    const seen = fakeImportConnection(defaultDb({ 'FROM players WHERE id': [] }));
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'richmond', playerId: 999, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not_found');
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a player with two AFL Tables identities rather than choosing one', async () => {
    const seen = fakeImportConnection(defaultDb({
      'SELECT DISTINCT e.external_id': [{ externalId: 'players/A/One0.html' }, { externalId: 'players/A/One1.html' }],
    }));
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'richmond', playerId: 42, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous_identity');
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses an identity-less player and says how to repair them, never minting one', async () => {
    const seen = fakeImportConnection(defaultDb({
      'SELECT DISTINCT e.external_id': [],
      'ORDER BY e.external_id': [],
    }));
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'richmond', playerId: 42, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('conflict');
    expect(result.error).toMatch(/identity/i);
    // W-12 / I-10: minting belongs to the draft and adopt actions. Nothing here
    // writes an external_identities row.
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses a player already listed elsewhere, naming the club and offering transfer', async () => {
    const seen = fakeImportConnection(defaultDb({
      'FROM season_list_members m': [{ clubName: 'Carlton', clubSlug: 'carlton' }],
    }));
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'richmond', playerId: 42, adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('duplicate');
    expect(result.error).toContain('Carlton');
    expect(result.error).toMatch(/transfer/i);
    expect(wrote(seen)).toEqual([]);
  });

  it('refuses an empty multi-select without opening a connection at all', async () => {
    const result = await addSeasonListMembers({
      season: 2027, clubSlug: 'richmond', playerIds: [], adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it('checks EVERY player of a multi-select before writing any of them', async () => {
    // The second player is already listed. Nothing may be written for the first.
    let playerCall = 0;
    const seen = fakeImportConnection((text) => {
      const flat = text.replace(/\s+/g, ' ');
      if (flat.includes('FROM season_list_members m')) {
        playerCall += 1;
        return playerCall === 2 ? [{ clubName: 'Carlton', clubSlug: 'carlton' }] : [];
      }
      return defaultDb()(text);
    });
    const result = await addSeasonListMembers({
      season: 2027, clubSlug: 'richmond', playerIds: [42, 43], adminUserId: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('duplicate');
    expect(wrote(seen)).toEqual([]);
  });
});

describe('a successful add writes exactly the three rows the contract names (§18)', () => {
  it('writes the canonical row, the durable override and the audit row, in that order', async () => {
    const seen = fakeImportConnection(defaultDb());
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'richmond', playerId: 42, adminUserId: 1,
      candidateSource: 'appearances:2026',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entityKey).toBe('richmond|2027|afltables:players/D/Dustin_Martin0.html');

    const writes = wrote(seen);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('INSERT INTO season_list_members');
    expect(writes[0]).toContain('ON CONFLICT (season, player_id) DO NOTHING');
    expect(writes[1]).toContain('INSERT INTO data_overrides');
    // The override upsert REACTIVATES a tombstone for the same natural key
    // rather than creating a second record (§12.2).
    expect(writes[1]).toContain('is_active = true');
    expect(writes[2]).toContain('INSERT INTO data_edits');
  });

  it('audits the PLAYER, never the membership row (§17)', async () => {
    // A membership is deletable and is renumbered by a promotion, so an audit
    // row pointing at one would dangle. data_edits.table_name is not widened.
    const seen = fakeImportConnection(defaultDb());
    await addSeasonListMember({ season: 2027, clubSlug: 'richmond', playerId: 42, adminUserId: 1 });
    const audit = seen.find((s) => s.includes('INSERT INTO data_edits'))!;
    expect(audit).toContain('table_name');
    expect(audit).not.toContain('season_list_members');
  });

  it('throws rather than returning a refusal once the canonical row is written', async () => {
    // The ISSUE-160 RollbackRefusal defect, proved absent: postgres.js commits
    // when the begin() callback RESOLVES, so a duplicate discovered by
    // ON CONFLICT DO NOTHING must reject the transaction, not return.
    let began = false;
    const { tx } = fakeTx((text) => {
      const flat = text.replace(/\s+/g, ' ');
      if (flat.includes('INSERT INTO season_list_members')) return [];
      return defaultDb()(text);
    });
    let rejected = false;
    mocks.postgres.mockReturnValue({
      begin: async (fn: (t: unknown) => Promise<unknown>) => {
        began = true;
        try {
          return await fn(tx);
        } catch (error) {
          rejected = true;
          throw error;
        }
      },
      end: async () => {},
    });
    const result = await addSeasonListMember({
      season: 2027, clubSlug: 'richmond', playerId: 42, adminUserId: 1,
    });
    expect(began).toBe(true);
    expect(rejected).toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('duplicate');
  });
});
