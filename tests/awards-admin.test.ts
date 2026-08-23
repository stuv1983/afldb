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
  let lockAvailable: boolean;
  let existingHonourTeamRows: Array<{
    id: number;
    playerNameRaw: string;
    playerId: number | null;
  }>;
  let nextId: number;
  let importQueries: CapturedQuery[];
  let authQueries: CapturedQuery[];
  let importSql: {
    begin: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  let txJson: ReturnType<typeof vi.fn>;
  let auditUnavailable: boolean;

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
    lockAvailable = true;
    existingHonourTeamRows = [];
    nextId = 100;
    importQueries = [];
    authQueries = [];
    auditUnavailable = false;
    txJson = vi.fn((value: unknown) => value);

    const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      importQueries.push({ text, values });

      if (text.includes('FROM awards a')) {
        return [awardDefinition];
      }
      if (text.includes('pg_try_advisory_xact_lock')) {
        return [{ locked: lockAvailable }];
      }
      if (text.includes('SELECT id FROM sources')) {
        return sourceAvailable ? [{ id: 57 }] : [];
      }
      if (text.includes('FROM honour_team_members')) {
        return existingHonourTeamRows;
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
      if (text.includes('INSERT INTO data_edits')) {
        if (auditUnavailable) throw new Error('audit unavailable');
        return [];
      }
      throw new Error(`Unexpected test query: ${text}`);
    }), { json: txJson });

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

  it('rejects invalid numeric and vocabulary facts before opening a write connection', async () => {
    await expect(createAwardWinner({ ...awardInput, votes: -1 }))
      .rejects.toThrow('Award votes or statistic');
    await expect(createHallOfFameInductee({ ...hallOfFameInput, inductedYear: 2026, category: 'Wizard' }))
      .rejects.toThrow('Invalid Hall of Fame category');
    await expect(createHallOfFameInductee({
      ...hallOfFameInput,
      inductedYear: 2026,
      isLegend: true,
      legendYear: 2025,
    })).rejects.toThrow('Legend year');
    await expect(createHonourTeamMember({ ...honourTeamInput, sortOrder: -1 }))
      .rejects.toThrow('Lineup order');

    expect(mocks.postgres).not.toHaveBeenCalled();
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

    // Required audits ride the import transaction (AFLDB-ISSUE-027);
    // the auth pool is never touched.
    const audits = importQueries.filter((query) => query.text.includes('INSERT INTO data_edits'));
    expect(audits).toHaveLength(2);
    expect(mocks.authSql).not.toHaveBeenCalled();
    expect(authQueries).toHaveLength(0);
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
    expect(txJson).toHaveBeenCalledWith(expect.objectContaining({ clubId: 8 }));
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

  it('accepts and normalises an optional generic-award club identity active in the season', async () => {
    selectedClubIdentity = {
      selectedClubId: 8,
      seasonClubId: 8,
      seasonClubName: 'Footscray',
    };

    await createAwardWinner({
      ...awardInput,
      season: 1980,
      clubId: 8,
      clubNameRaw: 'untrusted form text',
    });

    const insert = importQueries.find((query) => query.text.includes('INSERT INTO award_winners'));
    expect(insert?.values).toContain(8);
    expect(insert?.values).toContain('Footscray');
    expect(insert?.values).not.toContain('untrusted form text');
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
  ])('rejects a %s whose required audit cannot be written, so nothing commits (AFLDB-ISSUE-027)', async (_label, create) => {
    // The data_edits INSERT runs inside the import transaction: with the
    // real driver its failure aborts the transaction and the statistical
    // insert rolls back. There is no success-with-warning state left.
    auditUnavailable = true;

    await expect(create()).rejects.toThrow('audit unavailable');
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it.each([
    ['award winner', () => createAwardWinner(awardInput)],
    ['Hall of Fame inductee', () => createHallOfFameInductee(hallOfFameInput)],
    ['honour team member', () => createHonourTeamMember(honourTeamInput)],
  ])('writes the required %s audit inside the import transaction, after the statistical insert', async (_label, create) => {
    const result = await create();

    expect(result).toEqual({ id: 100 });
    const statIndex = importQueries.findIndex((query) => (
      query.text.includes('INSERT INTO award_winners')
      || query.text.includes('INSERT INTO hall_of_fame')
      || query.text.includes('INSERT INTO honour_team_members')
    ));
    const auditIndex = importQueries.findIndex((query) => query.text.includes('INSERT INTO data_edits'));
    expect(statIndex).toBeGreaterThanOrEqual(0);
    expect(auditIndex).toBeGreaterThan(statIndex);
    const audit = importQueries[auditIndex];
    expect(audit.values[0]).toMatch(/^(award_winners|hall_of_fame|honour_team_members)$/);
    expect(audit.values[1]).toBe(100);
    expect(audit.values).toContain(9); // adminUserId
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('stamps manual_admin_edit provenance on both honours creators (AFLDB-ISSUE-080)', async () => {
    await createHallOfFameInductee(hallOfFameInput);
    await createHonourTeamMember(honourTeamInput);

    const sourceLookups = importQueries.filter((query) => query.text.includes('SELECT id FROM sources'));
    expect(sourceLookups).toHaveLength(2);
    expect(sourceLookups.every((query) => query.values[0] === 'manual_admin_edit')).toBe(true);

    const hofInsert = importQueries.find((query) => query.text.includes('INSERT INTO hall_of_fame'));
    expect(hofInsert?.text).toContain('source_id');
    expect(hofInsert?.values).toContain(57);

    const memberInsert = importQueries.find((query) => query.text.includes('INSERT INTO honour_team_members'));
    expect(memberInsert?.text).toContain('source_id');
    expect(memberInsert?.values).toContain(57);
  });

  it.each([
    ['Hall of Fame inductee', () => createHallOfFameInductee(hallOfFameInput)],
    ['honour team member', () => createHonourTeamMember(honourTeamInput)],
  ])('fails a %s before insertion when the required manual source is missing', async (_label, create) => {
    sourceAvailable = false;

    await expect(create()).rejects.toThrow(
      "Required source 'manual_admin_edit' is not configured.",
    );

    expect(importQueries.some((query) => query.text.includes('INSERT INTO'))).toBe(false);
  });

  it('serialises honour-team creation behind the shared identity advisory lock', async () => {
    await createHonourTeamMember(honourTeamInput);

    // The frozen §5.3 lock identity, taken transaction-scoped and first, so
    // the collision read and the INSERT share one protected window with
    // tools/migration/import_awards.py.
    const lockQuery = importQueries[0];
    expect(lockQuery.text).toContain('pg_try_advisory_xact_lock');
    expect(lockQuery.values).toEqual([717275, 1]);
    expect(importQueries.some((query) => query.text.includes('pg_advisory_lock'))).toBe(false);
  });

  it('fails fast with a bounded error while an honours reload holds the lock', async () => {
    lockAvailable = false;

    await expect(createHonourTeamMember(honourTeamInput)).rejects.toThrow(
      'An honours reload is in progress; try again shortly.',
    );

    expect(importQueries.some((query) => query.text.includes('INSERT INTO'))).toBe(false);
    expect(importQueries.some((query) => query.text.includes('FROM honour_team_members'))).toBe(false);
  });

  describe('honour-team create-only conflict policy (AFLDB-ISSUE-080 §4.3/§4.4)', () => {
    it('never upserts: the insert carries no ON CONFLICT clause in either shape', async () => {
      await createHonourTeamMember(honourTeamInput);
      await createHonourTeamMember({ ...honourTeamInput, playerId: 101 });

      const inserts = importQueries.filter((query) => query.text.includes('INSERT INTO honour_team_members'));
      expect(inserts).toHaveLength(2);
      expect(inserts.every((query) => !query.text.includes('ON CONFLICT'))).toBe(true);
    });

    it('refuses an unlinked duplicate of an existing unlinked entry', async () => {
      existingHonourTeamRows = [{ id: 7, playerNameRaw: 'Test Member', playerId: null }];

      await expect(createHonourTeamMember(honourTeamInput)).rejects.toThrow(
        /already has an entry named 'Test Member' \(entry #7, not linked to a player\)/,
      );
    });

    it('refuses a linked create over an existing unlinked entry with the same name', async () => {
      // One of the two mixed cases with no database backstop after
      // migration 059: the application check is the only guard.
      existingHonourTeamRows = [{ id: 8, playerNameRaw: 'Same Name', playerId: null }];

      await expect(createHonourTeamMember({ ...honourTeamInput, playerId: 101 }))
        .rejects.toThrow(/entry #8, not linked to a player.*linked to player #101/);
    });

    it('refuses an unlinked create over an existing linked entry with the same name', async () => {
      existingHonourTeamRows = [{ id: 9, playerNameRaw: 'Test Member', playerId: 303 }];

      await expect(createHonourTeamMember(honourTeamInput)).rejects.toThrow(
        /entry #9, linked to player #303.*not linked to a player/,
      );
    });

    it('refuses the same linked player even under a different display name (§4.4)', async () => {
      existingHonourTeamRows = [{ id: 11, playerNameRaw: 'Other Spelling', playerId: 101 }];

      await expect(createHonourTeamMember({ ...honourTeamInput, playerId: 101 }))
        .rejects.toThrow(/already records this player as 'Other Spelling' \(entry #11/);
    });

    it('still creates a second, differently-linked player sharing a display name (AFLDB-ISSUE-025)', async () => {
      // The §4.3 matrix's positive case: identity is positively known on both
      // sides and known to differ, so raw-name equality must not collapse it.
      existingHonourTeamRows = [{ id: 12, playerNameRaw: 'Same Name', playerId: 303 }];

      const result = await createHonourTeamMember({ ...honourTeamInput, playerId: 101 });

      expect(result).toEqual({ id: 100 });
      const insert = importQueries.find((query) => query.text.includes('INSERT INTO honour_team_members'));
      expect(insert?.values).toContain(101);
    });

    it('writes no audit row and reads no data_edits on the refusal path', async () => {
      existingHonourTeamRows = [{ id: 7, playerNameRaw: 'Test Member', playerId: null }];

      await expect(createHonourTeamMember(honourTeamInput)).rejects.toThrow();

      expect(importQueries.some((query) => query.text.includes('INSERT INTO'))).toBe(false);
      expect(importQueries.some((query) => query.text.includes('data_edits'))).toBe(false);
      expect(mocks.authSql).not.toHaveBeenCalled();
    });
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

describe('atomic audit grant migration contract (AFLDB-ISSUE-027)', () => {
  it('grants afldb_import append-only access to both audit tables, guarded on the role', () => {
    const migration = readFileSync(
      join(process.cwd(), 'src', 'db', 'migrations', '066_atomic_audit_import_grants.sql'),
      'utf8',
    );

    expect(migration).toContain("pg_roles WHERE rolname = 'afldb_import'");
    expect(migration).toContain('GRANT INSERT ON data_edits TO afldb_import');
    expect(migration).toContain('GRANT USAGE ON SEQUENCE data_edits_id_seq TO afldb_import');
    expect(migration).toContain('GRANT INSERT ON player_link_resolutions TO afldb_import');
    expect(migration).toContain('GRANT USAGE ON SEQUENCE player_link_resolutions_id_seq TO afldb_import');
    // Append-only: the migration must never widen beyond INSERT/USAGE.
    expect(migration).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE)\b/);
    expect(migration).not.toMatch(/GRANT SELECT/);
    // And it must not route through the full-DML import registry.
    expect(migration).not.toContain('grant_import_write');
  });

  it('is mirrored by the privileges reconciler after the import revoke loop', () => {
    const privileges = readFileSync(
      join(process.cwd(), 'tools', 'maintenance', 'privileges.sql'),
      'utf8',
    );

    expect(privileges).toContain('GRANT INSERT ON data_edits TO afldb_import');
    expect(privileges).toContain('GRANT USAGE ON SEQUENCE data_edits_id_seq TO afldb_import');
    expect(privileges).toContain('GRANT INSERT ON player_link_resolutions TO afldb_import');
    expect(privileges).toContain('GRANT USAGE ON SEQUENCE player_link_resolutions_id_seq TO afldb_import');
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
      /CREATE UNIQUE INDEX honour_team_linked_player_uq[\s\S]*?\(team_name, player_id\)[\s\S]*?WHERE player_id IS NOT NULL;/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX honour_team_unlinked_name_uq[\s\S]*?\(team_name, player_name_raw\)[\s\S]*?WHERE player_id IS NULL;/,
    );
    expect(migration).toContain('HAVING count(*) > 1');
    expect(migration).not.toMatch(/\bDELETE\b/);
  });
});

describe('honour-team advisory-lock identity contract (AFLDB-ISSUE-080 §5.3)', () => {
  // The two writers must contend on an identical literal lock identity.
  // Deriving the key twice — hashtext, language-level hashing, anything
  // computed — is exactly what this contract forbids, so the constants are
  // asserted as literals in both languages.
  it('freezes the same two integer constants in the importer and the admin path', () => {
    const importer = readFileSync(
      join(process.cwd(), 'tools', 'migration', 'import_awards.py'),
      'utf8',
    );
    const admin = readFileSync(
      join(process.cwd(), 'src', 'db', 'queries', 'awards-admin.ts'),
      'utf8',
    );

    expect(importer).toContain('HONOUR_TEAM_LOCK_NAMESPACE = 717275');
    expect(importer).toContain('HONOUR_TEAM_LOCK_KEY = 1');
    expect(admin).toContain('const HONOUR_TEAM_LOCK_NAMESPACE = 717275');
    expect(admin).toContain('const HONOUR_TEAM_LOCK_KEY = 1');

    // Transaction scope only: session locks would strand on a crashed
    // request, and a hashed identity could silently diverge between the
    // two languages.
    expect(importer).toContain('pg_advisory_xact_lock');
    expect(admin).toContain('pg_try_advisory_xact_lock');
    expect(importer).not.toContain('hashtext');
    expect(admin).not.toContain('hashtext');
  });
});

describe('awards admin audit-warning UI contract', () => {
  it('keeps only the best-effort activity-audit warning; the required-audit warning state is gone', () => {
    const actions = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'data-editor', 'actions.ts'),
      'utf8',
    );
    // Required data_edits audits are atomic with the mutation now
    // (AFLDB-ISSUE-027): a "committed but unaudited" warning can no
    // longer exist, so no action may read result.auditWarning or write
    // data_edits itself on the auth pool.
    expect(actions).not.toContain('auditWarning');
    expect(actions).not.toContain('authSql');
    expect(actions).not.toContain('INSERT INTO data_edits');
    // The intentionally best-effort activity audit keeps its warning.
    expect(actions).toContain('warning?: string');
    expect(actions).toContain('ACTIVITY_AUDIT_WARNING');
    expect(actions).toContain('Do not submit it again');

    for (const form of ['AwardWinnerForm.tsx', 'HallOfFameForm.tsx', 'HonourTeamForm.tsx']) {
      const source = readFileSync(
        join(process.cwd(), 'src', 'app', 'admin', 'data-editor', form),
        'utf8',
      );
      expect(source).toContain('state.warning');
    }

    const awardForm = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'data-editor', 'AwardWinnerForm.tsx'),
      'utf8',
    );
    expect(awardForm).toContain("award.slug !== 'brownlow-medal'");
    expect(awardForm).toContain('cannot be added here');
  });
});
