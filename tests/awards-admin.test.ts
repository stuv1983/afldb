import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const authSql = Object.assign(vi.fn(), {
    json: vi.fn((value: unknown) => value),
  });
  return {
    authSql,
    postgres: vi.fn(),
  };
});

vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/authClient', () => ({ authSql: mocks.authSql }));

import {
  createAwardWinner,
  createHallOfFameInductee,
  createHonourTeamMember,
} from '@/db/queries/awards-admin';

type CapturedQuery = { text: string; values: unknown[] };

const awardInput = {
  awardId: 4,
  season: 2025,
  playerNameRaw: 'Test Winner',
  adminUserId: 9,
};

const hallOfFameInput = {
  name: 'Test Inductee',
  inductedYear: 2025,
  adminUserId: 9,
};

const honourTeamInput = {
  teamName: 'Test Team',
  playerNameRaw: 'Test Member',
  adminUserId: 9,
};

describe('awards admin mutation contracts', () => {
  let awardDefinition: {
    slug: string;
    name: string;
    category: string;
    awardClubId: number | null;
    seasonClubId: number | null;
    seasonClubName: string | null;
  };
  let selectedClubIdentity: {
    selectedClubId: number;
    seasonClubId: number | null;
    seasonClubName: string | null;
  } | null;
  let sourceAvailable: boolean;
  let nextId: number;
  let importQueries: CapturedQuery[];
  let authQueries: CapturedQuery[];
  let importSql: {
    begin: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubEnv('AFLDB_IMPORT_DATABASE_URL', 'postgres://import@example/afldb_test');
    awardDefinition = {
      slug: 'coleman',
      name: 'Coleman Medal',
      category: 'award',
      awardClubId: null,
      seasonClubId: null,
      seasonClubName: null,
    };
    selectedClubIdentity = null;
    sourceAvailable = true;
    nextId = 100;
    importQueries = [];
    authQueries = [];

    const tx = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      importQueries.push({ text, values });

      if (text.includes('FROM awards a')) {
        return [awardDefinition];
      }
      if (text.includes('SELECT id FROM sources')) {
        return sourceAvailable ? [{ id: 57 }] : [];
      }
      if (text.includes('SELECT display_name AS "displayName" FROM players')) {
        return [{ displayName: 'Same Name' }];
      }
      if (text.includes('FROM clubs selected_club')) {
        return selectedClubIdentity ? [selectedClubIdentity] : [];
      }
      if (
        text.includes('INSERT INTO award_winners')
        || text.includes('INSERT INTO hall_of_fame')
        || text.includes('INSERT INTO honour_team_members')
      ) {
        return [{ id: nextId++ }];
      }
      throw new Error(`Unexpected test query: ${text}`);
    });

    importSql = {
      begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
      end: vi.fn(async () => undefined),
    };
    mocks.postgres.mockReset();
    mocks.postgres.mockReturnValue(importSql);
    mocks.authSql.mockReset();
    mocks.authSql.mockImplementation(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        authQueries.push({ text: strings.join('?'), values });
        return [];
      },
    );
    mocks.authSql.json.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the manual source and a distinct UUID record key for every award winner', async () => {
    await createAwardWinner(awardInput);
    await createAwardWinner({ ...awardInput, season: 2026 });

    const sourceLookups = importQueries.filter((query) => query.text.includes('SELECT id FROM sources'));
    expect(sourceLookups).toHaveLength(2);
    expect(sourceLookups.every((query) => query.values[0] === 'manual_admin_edit')).toBe(true);

    const inserts = importQueries.filter((query) => query.text.includes('INSERT INTO award_winners'));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((query) => query.text.includes('source_id, source_record_id'))).toBe(true);
    expect(inserts.every((query) => query.values.includes(57))).toBe(true);

    const recordIds = inserts.map((query) => query.values.find(
      (value) => typeof value === 'string' && value.startsWith('award_winner:'),
    ));
    expect(recordIds).toEqual([
      expect.stringMatching(/^award_winner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      expect.stringMatching(/^award_winner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    ]);
    expect(new Set(recordIds).size).toBe(2);
    expect(authQueries).toHaveLength(2);
  });

  it('fails before insertion when the required manual source is missing', async () => {
    sourceAvailable = false;

    await expect(createAwardWinner(awardInput)).rejects.toThrow(
      "Required source 'manual_admin_edit' is not configured.",
    );

    expect(importQueries.some((query) => query.text.includes('INSERT INTO award_winners'))).toBe(false);
    expect(mocks.authSql).not.toHaveBeenCalled();
    expect(importSql.end).toHaveBeenCalledOnce();
  });

  it('refuses to write Brownlow winners outside the authoritative season table', async () => {
    awardDefinition = {
      ...awardDefinition,
      slug: 'brownlow-medal',
      name: 'Brownlow Medal',
    };

    await expect(createAwardWinner(awardInput)).rejects.toThrow(
      'Brownlow Medal winners must be recorded in authoritative brownlow_season_votes, not award_winners.',
    );

    expect(importQueries.some((query) => query.text.includes('INSERT INTO award_winners'))).toBe(false);
    expect(importQueries.some((query) => query.text.includes('SELECT id FROM sources'))).toBe(false);
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('infers the historical club identity for a club best-and-fairest season', async () => {
    awardDefinition = {
      slug: 'bf-western-bulldogs',
      name: 'Charles Sutton Medal',
      category: 'club_best_and_fairest',
      awardClubId: 22,
      seasonClubId: 8,
      seasonClubName: 'Footscray',
    };

    await createAwardWinner({ ...awardInput, season: 1980 });

    const definitionQuery = importQueries.find((query) => query.text.includes('FROM awards a'));
    expect(definitionQuery?.text).toContain('afldb_identity_for_season');
    expect(definitionQuery?.values).toEqual([1980, awardInput.awardId]);

    const insert = importQueries.find((query) => query.text.includes('INSERT INTO award_winners'));
    expect(insert?.values).toContain(8);
    expect(insert?.values).toContain('Footscray');
    expect(mocks.authSql.json).toHaveBeenCalledWith(expect.objectContaining({ clubId: 8 }));
  });

  it('rejects a club best-and-fairest identity that conflicts with the award season', async () => {
    awardDefinition = {
      slug: 'bf-western-bulldogs',
      name: 'Charles Sutton Medal',
      category: 'club_best_and_fairest',
      awardClubId: 22,
      seasonClubId: 8,
      seasonClubName: 'Footscray',
    };

    await expect(createAwardWinner({
      ...awardInput,
      season: 1980,
      clubId: 22,
    })).rejects.toThrow(
      "Award 'Charles Sutton Medal' must use Footscray (club #8) in 1980.",
    );

    expect(importQueries.some((query) => query.text.includes('INSERT INTO award_winners'))).toBe(false);
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('rejects an optional generic-award club identity that was not active in the season', async () => {
    selectedClubIdentity = {
      selectedClubId: 22,
      seasonClubId: 8,
      seasonClubName: 'Footscray',
    };

    await expect(createAwardWinner({
      ...awardInput,
      season: 1980,
      clubId: 22,
    })).rejects.toThrow('Footscray (club #8) is the identity active in 1980.');

    const clubQuery = importQueries.find((query) => query.text.includes('FROM clubs selected_club'));
    expect(clubQuery?.text).toContain('afldb_identity_for_season');
    expect(clubQuery?.values).toEqual([1980, 22]);
    expect(importQueries.some((query) => query.text.includes('INSERT INTO award_winners'))).toBe(false);
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('requires the import-role connection for every awards mutation', async () => {
    vi.stubEnv('AFLDB_IMPORT_DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL', 'postgres://read-only@example/afldb_test');

    await expect(createAwardWinner(awardInput)).rejects.toThrow(
      'AFLDB_IMPORT_DATABASE_URL is not configured.',
    );
    await expect(createHallOfFameInductee(hallOfFameInput)).rejects.toThrow(
      'AFLDB_IMPORT_DATABASE_URL is not configured.',
    );
    await expect(createHonourTeamMember(honourTeamInput)).rejects.toThrow(
      'AFLDB_IMPORT_DATABASE_URL is not configured.',
    );

    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it.each([
    ['award winner', () => createAwardWinner(awardInput)],
    ['Hall of Fame inductee', () => createHallOfFameInductee(hallOfFameInput)],
    ['honour team member', () => createHonourTeamMember(honourTeamInput)],
  ])('reports a committed %s with an explicit audit warning instead of inviting a retry', async (_label, create) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.authSql.mockRejectedValueOnce(new Error('audit unavailable'));

    const result = await create();

    expect(result).toEqual({
      id: 100,
      auditWarning: expect.stringContaining('Do not submit it again'),
    });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('keys linked honour-team upserts by stable player identity, not display name', async () => {
    await createHonourTeamMember({ ...honourTeamInput, playerId: 101 });
    await createHonourTeamMember({ ...honourTeamInput, playerId: 202 });

    const inserts = importQueries.filter((query) => query.text.includes('INSERT INTO honour_team_members'));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((query) => (
      query.text.includes('ON CONFLICT (team_name, player_id) WHERE player_id IS NOT NULL')
    ))).toBe(true);
    expect(inserts[0].values).toContain(101);
    expect(inserts[1].values).toContain(202);
    expect(inserts.every((query) => query.values.includes('Same Name'))).toBe(true);
  });

  it('retains name-based duplicate protection only for unlinked honour-team rows', async () => {
    await createHonourTeamMember(honourTeamInput);

    const insert = importQueries.find((query) => query.text.includes('INSERT INTO honour_team_members'));
    expect(insert?.text).toContain(
      'ON CONFLICT (team_name, player_name_raw) WHERE player_id IS NULL',
    );
    expect(insert?.text).not.toContain('ON CONFLICT (team_name, player_id)');
  });
});

describe('data_edits migration contract', () => {
  it('widens only the table-name allowlist to every registered editor entity', () => {
    const migration = readFileSync(
      join(process.cwd(), 'src', 'db', 'migrations', '058_data_edits_editor_entities.sql'),
      'utf8',
    );

    expect(migration).toContain('DROP CONSTRAINT data_edits_table_name_check');
    for (const table of [
      'players',
      'matches',
      'draft_picks',
      'award_winners',
      'hall_of_fame',
      'honour_team_members',
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).not.toContain('award_winners_source_uq');
    expect(migration).not.toMatch(/\bGRANT\b/);
  });
});

describe('honour-team identity migration contract', () => {
  it('replaces name-only uniqueness with linked-player and unlinked-name keys', () => {
    const migration = readFileSync(
      join(process.cwd(), 'src', 'db', 'migrations', '059_honour_team_member_identity.sql'),
      'utf8',
    );

    expect(migration).toContain('DROP CONSTRAINT honour_team_uq');
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX honour_team_linked_player_uq[\s\S]*\(team_name, player_id\)[\s\S]*WHERE player_id IS NOT NULL/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX honour_team_unlinked_name_uq[\s\S]*\(team_name, player_name_raw\)[\s\S]*WHERE player_id IS NULL/,
    );
    expect(migration).toContain('HAVING count(*) > 1');
    expect(migration).not.toMatch(/\bDELETE\b/);
  });
});

describe('awards admin audit-warning UI contract', () => {
  it('carries post-commit audit warnings through the actions and all three forms', () => {
    const actions = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'data-editor', 'actions.ts'),
      'utf8',
    );
    expect(actions).toContain('warning?: string');
    expect(actions.match(/result\.auditWarning/g)).toHaveLength(3);
    expect(actions).toContain('Do not submit it again');

    for (const form of ['AwardWinnerForm.tsx', 'HallOfFameForm.tsx', 'HonourTeamForm.tsx']) {
      const source = readFileSync(
        join(process.cwd(), 'src', 'app', 'admin', 'data-editor', form),
        'utf8',
      );
      expect(source).toContain('state.warning');
    }
  });
});
