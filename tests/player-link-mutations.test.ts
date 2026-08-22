import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(),
  authSql: vi.fn(),
  sql: vi.fn(),
  requireSuperAdmin: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/authClient', () => ({ authSql: mocks.authSql }));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/session', () => ({
  requireSuperAdmin: mocks.requireSuperAdmin,
  audit: mocks.audit,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { createPlayerAction } from '@/app/admin/data-editor/actions';
import {
  createPlayerAndResolveLink,
  listUnresolvedLinks,
  resolveLink,
} from '@/db/queries/player-links';
import { createPlayer, type DraftPickInput } from '@/db/queries/players';

type SeenQuery = { text: string; values: unknown[] };
type QueryResponder = (text: string, values: unknown[]) => unknown[];

function compact(strings: TemplateStringsArray): string {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

function fakeTransaction(respond: QueryResponder): {
  tx: any;
  seen: SeenQuery[];
} {
  const seen: SeenQuery[] = [];
  const tx = vi.fn((first: TemplateStringsArray | string, ...values: unknown[]) => {
    // postgres.js uses sql('table_name') for a quoted identifier.
    if (typeof first === 'string') return { identifier: first };
    const text = compact(first);
    seen.push({ text, values });
    return Promise.resolve(respond(text, values));
  }) as any;
  // postgres.js transactions expose the full Sql surface, including .json.
  tx.json = (value: unknown) => ({ json: value });
  return { tx, seen };
}

function installImportClient(tx: any) {
  const client = {
    begin: vi.fn(async (callback: (transaction: any) => unknown) => callback(tx)),
    end: vi.fn(async () => undefined),
  };
  mocks.postgres.mockReturnValue(client);
  return client;
}

const originalImportUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  mocks.postgres.mockReset();
  mocks.authSql.mockReset();
  mocks.authSql.mockResolvedValue([]);
  mocks.sql.mockReset();
  mocks.requireSuperAdmin.mockReset();
  mocks.requireSuperAdmin.mockResolvedValue({ id: 5, email: 'admin@example.test' });
  mocks.audit.mockReset();
  mocks.revalidatePath.mockReset();
  process.env.AFLDB_IMPORT_DATABASE_URL = 'postgres://import@example/afldb_test';
  process.env.DATABASE_URL = 'postgres://app@example/afldb_test';
});

afterAll(() => {
  if (originalImportUrl === undefined) delete process.env.AFLDB_IMPORT_DATABASE_URL;
  else process.env.AFLDB_IMPORT_DATABASE_URL = originalImportUrl;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('draft identity resolution', () => {
  it('fails closed when a draft pick has no durable person id', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT draft_person_id AS')) return [{ draftPersonId: null }];
      return [];
    });
    installImportClient(tx);

    const result = await createPlayerAndResolveLink({
      targetTable: 'draft_picks',
      targetId: 41,
      adminUserId: 5,
      player: { displayName: 'New Draftee' },
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('no draft person identity'),
    });
    expect(seen.some((query) => query.text.startsWith('INSERT INTO players'))).toBe(false);
    expect(seen.map((query) => query.text).join('\n'))
      .not.toMatch(/display_name_raw|player_name_raw/i);
  });

  it('updates the exact draft person and every pick for that person, never a raw name', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT draft_person_id AS')) return [{ draftPersonId: 901 }];
      if (text.startsWith('SELECT link_status::text')) {
        return [{ status: 'unmatched', playerId: null }];
      }
      if (text.startsWith('SELECT link_status_value::text')) {
        return [{ status: 'ambiguous', draftPersonId: 901 }];
      }
      return [];
    });
    installImportClient(tx);

    const result = await resolveLink({
      targetTable: 'draft_picks',
      targetId: 41,
      playerId: 77,
      adminUserId: 5,
      note: 'Verified against the source profile.',
    });

    expect(result).toEqual({ ok: true });
    expect(seen.map((query) => query.text).join('\n'))
      .not.toMatch(/display_name_raw|player_name_raw/i);

    const personUpdate = seen.find((query) => query.text.startsWith('UPDATE draft_persons'));
    const picksUpdate = seen.find((query) => query.text.startsWith('UPDATE draft_picks'));
    expect(personUpdate?.text).toContain('WHERE id = ?');
    expect(personUpdate?.values).toEqual([77, 901]);
    expect(picksUpdate?.text).toContain('WHERE draft_person_id = ?');
    expect(picksUpdate?.values).toEqual([77, 901]);

    // The required resolution audit rides the same import transaction
    // (migration 066, AFLDB-ISSUE-027); nothing touches the auth pool.
    expect(mocks.authSql).not.toHaveBeenCalled();
    const auditInsert = seen.find((query) => (
      query.text.startsWith('INSERT INTO player_link_resolutions')
    ));
    expect(auditInsert?.values).toEqual([
      'draft_picks', 41, 77, 'ambiguous', 5,
      'Verified against the source profile.',
    ]);
    const picksUpdateIndex = seen.findIndex((query) => query.text.startsWith('UPDATE draft_picks'));
    expect(seen.findIndex((query) => query.text.startsWith('INSERT INTO player_link_resolutions')))
      .toBeGreaterThan(picksUpdateIndex);
  });

  it('fails the whole link when the required resolution audit cannot be written (AFLDB-ISSUE-027)', async () => {
    // The audit INSERT runs inside the import transaction: with the real
    // driver its failure aborts the transaction, so the link never
    // commits. The result is a plain error — never success-with-warning.
    const { tx } = fakeTransaction((text) => {
      if (text.startsWith('SELECT draft_person_id AS')) return [{ draftPersonId: 901 }];
      if (text.startsWith('SELECT link_status::text')) return [{ status: 'unmatched', playerId: null }];
      if (text.startsWith('SELECT link_status_value::text')) {
        return [{ status: 'unmatched', draftPersonId: 901 }];
      }
      if (text.startsWith('INSERT INTO player_link_resolutions')) {
        throw new Error('audit unavailable');
      }
      return [];
    });
    installImportClient(tx);

    const result = await resolveLink({
      targetTable: 'draft_picks',
      targetId: 41,
      playerId: 77,
      adminUserId: 5,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('The link could not be applied'),
    });
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('does not insert a player when the locked target has gone stale', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT draft_person_id AS')) return [{ draftPersonId: 901 }];
      if (text.startsWith('SELECT link_status::text')) {
        return [{ status: 'unmatched', playerId: null }];
      }
      if (text.startsWith('SELECT link_status_value::text')) {
        return [{ status: 'resolved', draftPersonId: 901 }];
      }
      return [];
    });
    const client = installImportClient(tx);

    const result = await createPlayerAndResolveLink({
      targetTable: 'draft_picks',
      targetId: 41,
      adminUserId: 5,
      player: { displayName: 'New Draftee' },
    });

    expect(result).toEqual({
      ok: false,
      error: 'No unresolved row with that id — it may already be linked.',
    });
    expect(client.begin).toHaveBeenCalledOnce();
    expect(seen.some((query) => query.text.startsWith('INSERT INTO players'))).toBe(false);
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('locks the unresolved target before creating and linking on the same transaction', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT draft_person_id AS')) return [{ draftPersonId: 901 }];
      if (text.startsWith('SELECT link_status::text')) {
        return [{ status: 'unmatched', playerId: null }];
      }
      if (text.startsWith('SELECT link_status_value::text')) {
        return [{ status: 'unmatched', draftPersonId: 901 }];
      }
      if (text.startsWith('INSERT INTO players')) {
        return [{ id: 77, slug: 'new-draftee', displayName: 'New Draftee' }];
      }
      return [];
    });
    const client = installImportClient(tx);

    const result = await createPlayerAndResolveLink({
      targetTable: 'draft_picks',
      targetId: 41,
      adminUserId: 5,
      player: { displayName: 'New Draftee' },
    });

    expect(result).toEqual({
      ok: true,
      player: { id: 77, slug: 'new-draftee', displayName: 'New Draftee' },
    });
    expect(client.begin).toHaveBeenCalledOnce();
    expect(mocks.postgres).toHaveBeenCalledOnce();
    const targetLock = seen.findIndex((query) => (
      query.text.startsWith('SELECT link_status_value::text')
      && query.text.includes('FOR UPDATE')
    ));
    const playerInsert = seen.findIndex((query) => query.text.startsWith('INSERT INTO players'));
    expect(targetLock).toBeGreaterThanOrEqual(0);
    expect(playerInsert).toBeGreaterThan(targetLock);
    expect(seen.findIndex((query) => query.text.startsWith('UPDATE draft_picks')))
      .toBeGreaterThan(playerInsert);
  });
});

describe('22Under22 award-winner resolution', () => {
  it('surfaces unresolved award winners with searchable award context', async () => {
    const expected = [{
      targetTable: 'award_winners' as const,
      targetId: 412,
      playerName: 'Source Name',
      linkStatus: 'unmatched',
      context: '22 Under 22 Team · 2026 · Carlton',
    }];
    mocks.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = compact(strings);
      if (text.startsWith('q."targetTable"')) return { text, values };
      return Promise.resolve(expected);
    });

    await expect(listUnresolvedLinks('award_winners')).resolves.toEqual(expected);
    const outer = mocks.sql.mock.calls.find(([strings]) => (
      compact(strings as TemplateStringsArray).includes('FROM award_winners w')
    ));
    expect(outer).toBeDefined();
    const text = compact(outer![0] as TemplateStringsArray);
    expect(text).toContain("SELECT 'award_winners' AS");
    expect(text).toContain("concat_ws(' · ', a.name, w.season::text");
    expect(text).toContain('JOIN awards a ON a.id = w.award_id');
  });

  it('locks and resolves an unmatched 22Under22 award_winners row by numeric id', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT link_status_value::text')) {
        return [{ status: 'unmatched' }];
      }
      return [];
    });
    installImportClient(tx);

    const result = await resolveLink({
      targetTable: 'award_winners',
      targetId: 412,
      playerId: 77,
      adminUserId: 5,
      note: 'Verified against the annual team source.',
    });

    expect(result).toEqual({ ok: true });
    const lock = seen.find((query) => query.text.startsWith('SELECT link_status_value::text'));
    const update = seen.find((query) => query.text.startsWith('UPDATE ?'));
    expect(lock?.text).toContain('FOR UPDATE');
    expect(lock?.values).toEqual([{ identifier: 'award_winners' }, 412]);
    expect(update?.values).toEqual([{ identifier: 'award_winners' }, 77, 412]);
    // Required audit on the same import transaction (AFLDB-ISSUE-027).
    expect(mocks.authSql).not.toHaveBeenCalled();
    const auditInsert = seen.find((query) => (
      query.text.startsWith('INSERT INTO player_link_resolutions')
    ));
    expect(auditInsert?.values).toEqual([
      'award_winners', 412, 77, 'unmatched', 5,
      'Verified against the annual team source.',
    ]);
  });
});

describe('player creation facts', () => {
  it('rejects partial draft fields at the server-action boundary', async () => {
    const formData = new FormData();
    formData.set('displayName', 'New Draftee');
    formData.set('recruitedFrom', 'Murray U18');

    const result = await createPlayerAction({}, formData);

    expect(result).toEqual({
      error: 'A valid draft year (1981–2100) is required with draft details.',
    });
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rejects partial draft information instead of inventing a draft year', async () => {
    const { tx, seen } = fakeTransaction(() => []);
    installImportClient(tx);

    const partialDraft = { recruitedFrom: 'Murray U18' } as DraftPickInput;
    await expect(createPlayer({
      displayName: 'New Draftee',
      dob: '2007-03-01',
      draftInfo: partialDraft,
    }, { adminUserId: 5 })).rejects.toThrow('An explicit draft year');

    expect(seen.some((query) => query.text.startsWith('INSERT INTO players'))).toBe(false);
    expect(seen.some((query) => query.text.startsWith('INSERT INTO draft_picks'))).toBe(false);
  });

  it('stores the supplied draft year and keeps unrecorded career totals NULL', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('INSERT INTO players')) {
        return [{ id: 88, slug: 'new-draftee', displayName: 'New Draftee' }];
      }
      return [];
    });
    installImportClient(tx);

    await createPlayer({
      displayName: 'New Draftee',
      dob: '1980-03-01',
      draftInfo: { draftYear: 2005, recruitedFrom: 'Murray U18' },
    }, { adminUserId: 5, note: 'Historic draftee backfill' });

    const draftInsert = seen.find((query) => query.text.startsWith('INSERT INTO draft_picks'));
    expect(draftInsert?.values[0]).toBe(2005);

    // The required data_edits audit is part of the same transaction
    // (AFLDB-ISSUE-027) and snapshots the created identity.
    const auditInsert = seen.find((query) => query.text.startsWith('INSERT INTO data_edits'));
    expect(auditInsert?.values).toEqual([
      'players', 88, 'player_creation',
      { json: {} },
      { json: { displayName: 'New Draftee', hasDraftInfo: true } },
      5, 'Historic draftee backfill',
    ]);
    expect(mocks.authSql).not.toHaveBeenCalled();

    const careerInsert = seen.find((query) => query.text.startsWith('INSERT INTO player_career_stats'));
    expect(careerInsert?.text).toContain(
      'VALUES ( ?, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0',
    );
  });

  it('rejects a draft club identity that was not active in the supplied year', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT c.id, c.name')) {
        return [{ id: 24, name: 'Western Bulldogs', activeId: 5 }];
      }
      return [];
    });
    installImportClient(tx);

    await expect(createPlayer({
      displayName: 'Historical Draftee',
      draftInfo: { draftYear: 1981, clubId: 24 },
    }, { adminUserId: 5 })).rejects.toThrow('not the historical club identity active in 1981');

    expect(seen.some((query) => query.text.includes('afldb_identity_for_season'))).toBe(true);
    expect(seen.some((query) => query.text.startsWith('INSERT INTO players'))).toBe(false);
  });

  it('does not fall back to the read-only application connection', async () => {
    delete process.env.AFLDB_IMPORT_DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://overprivileged-app@example/afldb_test';

    await expect(createPlayer({ displayName: 'No Import Role' }, { adminUserId: 5 }))
      .rejects.toThrow('AFLDB_IMPORT_DATABASE_URL is not configured.');
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
});
