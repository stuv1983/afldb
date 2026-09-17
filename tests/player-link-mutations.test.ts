import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(),
  authSql: vi.fn(),
  sql: vi.fn(),
  requireCapability: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
  fetchSourceEvidence: vi.fn(),
  assessOneSource: vi.fn(),
  readCachedSuggestionVersions: vi.fn(),
}));

vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/authClient', () => ({ authSql: mocks.authSql }));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/session', () => ({
  // data.playerLinks / data.dataEditor, both super-admin-only (AFLDB-ISSUE-158).
  requireCapability: mocks.requireCapability,
  audit: mocks.audit,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/db/queries/player-match-candidates', () => ({
  fetchSourceEvidence: mocks.fetchSourceEvidence,
  assessOneSource: mocks.assessOneSource,
  readCachedSuggestionVersions: mocks.readCachedSuggestionVersions,
  refreshMatchCandidates: vi.fn(),
}));

import { createPlayerAction } from '@/app/admin/data-editor/actions';
import {
  approveSuggestion,
  bulkApproveSuggestions,
  confirmUnlinked as confirmUnlinkedAction,
} from '@/app/admin/player-links/actions';
import {
  confirmUnlinked,
  createPlayerAndResolveLink,
  listUnresolvedLinks,
  resolveLink,
  resolveLinkFromSuggestion,
} from '@/db/queries/player-links';
import { createPlayer } from '@/db/queries/players';

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
  mocks.requireCapability.mockReset();
  mocks.requireCapability.mockResolvedValue({ id: 5, email: 'admin@example.test' });
  mocks.audit.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.fetchSourceEvidence.mockReset();
  mocks.assessOneSource.mockReset();
  mocks.readCachedSuggestionVersions.mockReset();
  mocks.readCachedSuggestionVersions.mockResolvedValue(new Map());
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
    // Provenance (migration 067) rides the same row: a hand-made link
    // is recorded as 'manual' and carries no score or algorithm version,
    // so a later calibration audit can tell the two apart.
    expect(auditInsert?.values).toEqual([
      'draft_picks', 41, 77, 'ambiguous', 5,
      'Verified against the source profile.',
      'manual', null, null,
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

describe('confirmUnlinked resolution', () => {
  it('uses AFLDB_IMPORT_DATABASE_URL and ignores form-supplied previousStatus', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT link_status_value::text')) {
        return [{ status: 'ambiguous' }];
      }
      return [];
    });
    const client = installImportClient(tx);

    const result = await confirmUnlinked({
      targetTable: 'award_winners',
      targetId: 412,
      adminUserId: 5,
      note: 'Definitely not the AFL player',
    });

    expect(result).toEqual({ ok: true });
    expect(client.begin).toHaveBeenCalledOnce();
    expect(mocks.authSql).not.toHaveBeenCalled();

    const auditInsert = seen.find((query) => (
      query.text.startsWith('INSERT INTO player_link_resolutions')
    ));
    // The previous_status must be 'ambiguous' (from lock), not 'unmatched'.
    expect(auditInsert?.values).toEqual([
      'award_winners', 412, 'ambiguous', 5, 'Definitely not the AFL player',
    ]);
    expect(auditInsert?.text).toContain("'confirmed_unlinked', NULL");
  });

  it('rejects duplicate stale confirmations without inserting anything', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT link_status_value::text')) return [{ status: 'unmatched' }];
      if (text.startsWith('SELECT action')) return [{ action: 'confirmed_unlinked', playerId: null }];
      return [];
    });
    installImportClient(tx);

    const result = await confirmUnlinked({
      targetTable: 'award_winners',
      targetId: 412,
      adminUserId: 5,
    });

    expect(result).toEqual({
      ok: false,
      error: 'This target was already confirmed unlinked by another admin.',
    });
    expect(seen.some((query) => query.text.startsWith('INSERT INTO'))).toBe(false);
  });

  it('fails closed for a draft identity with contradictory sibling decisions', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT draft_person_id AS')) return [{ draftPersonId: 901 }];
      if (text.startsWith('SELECT link_status::text')) return [{ status: 'unmatched', playerId: null }];
      if (text.startsWith('SELECT link_status_value::text')) return [{ status: 'ambiguous', draftPersonId: 901 }];
      if (text.startsWith('SELECT DISTINCT ON')) {
        // Return contradictory siblings
        return [
          { action: 'linked', playerId: 100 },
          { action: 'confirmed_unlinked', playerId: null },
        ];
      }
      return [];
    });
    installImportClient(tx);

    const result = await confirmUnlinked({
      targetTable: 'draft_picks',
      targetId: 41,
      adminUserId: 5,
    });

    expect(result).toEqual({
      ok: false,
      error: 'This draft identity has conflicting existing link decisions and cannot be changed until reviewed.',
    });
    expect(seen.some((query) => query.text.startsWith('INSERT INTO'))).toBe(false);
  });

  it('server action ignores form-supplied previousStatus and forwards only target details', async () => {
    mocks.requireCapability.mockResolvedValueOnce({ id: 5, email: 'admin@example.test' });
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT link_status_value::text')) return [{ status: 'unmatched' }];
      return [];
    });
    installImportClient(tx);

    const formData = new FormData();
    // Use target identifier 412, missing previousStatus segment from the real wire format
    formData.set('targets', 'award_winners:412');
    formData.set('note', 'Verified not a player');

    const result = await confirmUnlinkedAction({}, formData);

    expect(result).toEqual({ message: expect.stringContaining('Recorded 1 record(s)') });
    expect(mocks.requireCapability).toHaveBeenCalledOnce();

    const auditInsert = seen.find((query) => (
      query.text.startsWith('INSERT INTO player_link_resolutions')
    ));

    // The previous_status must be 'unmatched' (from lock inside the query), not the form's 'bogus_value...'
    expect(auditInsert?.values).toEqual([
      'award_winners', 412, 'unmatched', 5, 'Verified not a player',
    ]);
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
      'manual', null, null,
    ]);
  });
});

describe('player creation facts (AFLDB-ISSUE-160 §5, gate 3)', () => {
  it('refuses draft fields at the server-action boundary instead of dropping them', async () => {
    // D-5: draft selections have exactly one mutation contract, and it is not the
    // generic data editor. Rejecting rather than ignoring is the point -- a stale
    // client must not be able to silently discard a selection the administrator
    // believed they had recorded.
    const formData = new FormData();
    formData.set('displayName', 'New Draftee');
    formData.set('recruitedFrom', 'Murray U18');

    const result = await createPlayerAction({}, formData);

    expect(result).toEqual({ error: 'Draft selections are edited in /admin/draft.' });
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('refuses every draft field, not only the year', async () => {
    for (const field of ['draftYear', 'draftType', 'pickNumber', 'draftClubId', 'draftAge', 'pickNote']) {
      const formData = new FormData();
      formData.set('displayName', 'New Draftee');
      formData.set(field, '2005');
      expect(await createPlayerAction({}, formData), field)
        .toEqual({ error: 'Draft selections are edited in /admin/draft.' });
    }
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it('mints a durable identity and record, and inserts no draft row', async () => {
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
    }, { adminUserId: 5, note: 'Historic draftee backfill' });

    // DEF-4b: the ONLY INSERT INTO draft_picks in src/ is admin-draft.ts.
    expect(seen.some((query) => query.text.startsWith('INSERT INTO draft_picks'))).toBe(false);

    // DEF-4a: the player gets a durable identity (external_identities) AND a durable
    // record (data_overrides) in the same transaction, or it is not promotable.
    const identityInsert = seen.find((q) => q.text.startsWith('INSERT INTO external_identities'));
    expect(identityInsert, 'no manual identity minted').toBeDefined();
    expect(identityInsert!.text).toContain("SELECT id FROM sources WHERE key = 'manual_admin_edit'");
    expect(identityInsert!.text).toContain("'resolved', 0, 'manual_admin_edit'");
    const token = identityInsert!.values[0] as string;
    expect(token, 'the token is a randomUUID, never name-derived')
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(identityInsert!.values[1]).toBe('New Draftee');
    expect(identityInsert!.values[2]).toBe(88);

    const overrideInsert = seen.find((q) => q.text.startsWith('INSERT INTO data_overrides'));
    expect(overrideInsert, 'no durable record written').toBeDefined();
    expect(overrideInsert!.values[0]).toBe(`manual_admin_edit:${token}`);
    expect(overrideInsert!.values[1]).toEqual({
      json: {
        display_name: 'New Draftee', given_name: 'New', surname: 'Draftee',
        dob: '1980-03-01', dob_confidence: 'sourced', birth_year: 1980,
      },
    });
    expect(overrideInsert!.values[2]).toBe(5);

    // The required data_edits audit is part of the same transaction
    // (AFLDB-ISSUE-027) and snapshots the created identity.
    const auditInsert = seen.find((query) => query.text.startsWith('INSERT INTO data_edits'));
    expect(auditInsert?.values).toEqual([
      'players', 88, 'player_creation',
      { json: {} },
      { json: { displayName: 'New Draftee' } },
      5, 'Historic draftee backfill',
    ]);
    expect(mocks.authSql).not.toHaveBeenCalled();

    const careerInsert = seen.find((query) => query.text.startsWith('INSERT INTO player_career_stats'));
    expect(careerInsert?.text).toContain(
      'VALUES ( ?, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0',
    );
  });

  it('derives search_name, slug and sort_name in SQL, by the importer expressions', () => {
    // §3.2: a replayed twin has to be byte-identical to the row the admin typed, and
    // the only way to guarantee that is for both sides to run the same SQL. A
    // JavaScript slug would diverge the moment a name carries an accent or an
    // apostrophe.
    const source = readFileSync(join(process.cwd(), 'src/db/queries/players.ts'), 'utf8');
    const insert = source.slice(source.indexOf('INSERT INTO players ('));
    expect(insert).toContain('afldb_normalise_name(${displayName})');
    expect(insert, 'the backslash must survive BOTH the template literal and SQL')
      .toContain("regexp_replace(afldb_normalise_name(${displayName}), '\\\\s+', '-', 'g')");
    // A bare \s in a TS template literal is the letter s, so PostgreSQL would
    // replace every run of "s" in a name with a hyphen.
    expect(insert).not.toContain("'" + String.fromCharCode(92) + "s+'");
    expect(insert).toContain("ELSE ${surname}::text || ', ' || ${givenName}::text");
    // The same two expressions, spelled identically, in the replay that re-creates it.
    const replay = readFileSync(join(process.cwd(), 'tools/migration/common.py'), 'utf8');
    expect(replay).toContain('afldb_normalise_name(%(display_name)s)');
    expect(replay).toContain(
      "regexp_replace(afldb_normalise_name(%(display_name)s), '\\\\s+', '-', 'g')");
  });

  it('omits an absent optional field from the durable record, and keeps an explicit null', async () => {
    // absent-vs-explicit-null is what makes the replay's jsonb_exists arms mean what
    // they say: an absent key leaves the column alone, an explicit null clears it.
    const { tx, seen } = fakeTransaction((text) => (
      text.startsWith('INSERT INTO players')
        ? [{ id: 91, slug: 'minimal', displayName: 'Minimal' }]
        : []));
    installImportClient(tx);

    await createPlayer({ displayName: 'Minimal', notes: null }, { adminUserId: 5 });

    const overrideInsert = seen.find((q) => q.text.startsWith('INSERT INTO data_overrides'));
    const payload = (overrideInsert!.values[1] as { json: Record<string, unknown> }).json;
    expect(Object.keys(payload).sort()).toEqual(['display_name', 'given_name', 'notes', 'surname']);
    expect(payload.notes).toBeNull();
    expect('dob' in payload).toBe(false);
    expect('height_cm' in payload).toBe(false);
  });

  it('refuses to create a player it cannot attribute the durable record to', async () => {
    const { tx, seen } = fakeTransaction(() => []);
    installImportClient(tx);
    await expect(createPlayer({ displayName: 'Unattributed' }, { adminUserId: 0 }))
      .rejects.toThrow('valid administrator id');
    expect(seen.some((q) => q.text.startsWith('INSERT INTO players'))).toBe(false);
  });

  it('does not fall back to the read-only application connection', async () => {
    delete process.env.AFLDB_IMPORT_DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://overprivileged-app@example/afldb_test';

    await expect(createPlayer({ displayName: 'No Import Role' }, { adminUserId: 5 }))
      .rejects.toThrow('AFLDB_IMPORT_DATABASE_URL is not configured.');
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
});

/**
 * Approving a suggestion (migration 067).
 *
 * The cache is advice. These tests pin the rule that makes it safe to
 * treat it that way: the link is written only if a FRESH score,
 * computed inside the same transaction that holds the row's lock, still
 * names the player being approved.
 */
describe('suggested match approval', () => {
  const sourceRow = {
    source: {
      target: {
        targetTable: 'award_winners',
        targetId: 412,
        resolutionEntityType: 'award_winners',
        resolutionEntityId: 412,
      },
      rawName: "Michael O'Loughlin",
      normalisedName: 'michael oloughlin',
      temporal: [],
      clubId: 9,
      clubNameRaw: 'Sydney',
      reportedGames: null,
      reportedGoals: null,
      context: 'Bob Skilton Medal',
      linkStatus: 'unmatched',
      uniquenessScope: { kind: 'none' },
    },
    knownPlayerId: null,
  };

  function assessment(overrides: Record<string, unknown> = {}) {
    return {
      best: {
        playerId: 1000,
        displayName: 'Michael OLoughlin',
        score: 97,
        evidence: [],
        conflicts: [],
        hardConflict: false,
        corroboratingFamilies: 3,
        strongName: true,
      },
      alternatives: [],
      band: 'very_high',
      gap: null,
      nearTies: 0,
      ambiguous: false,
      hardConflict: false,
      bulkEligible: true,
      algorithmVersion: 'v1',
      ...overrides,
    };
  }

  function lockedUnmatchedRow() {
    return fakeTransaction((text) => {
      if (text.startsWith('SELECT link_status_value::text AS status')) {
        return [{ status: 'unmatched' }];
      }
      return [];
    });
  }

  it('records the score the SERVER computed, not one supplied by a caller', async () => {
    const { tx, seen } = lockedUnmatchedRow();
    installImportClient(tx);
    mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
    mocks.assessOneSource.mockResolvedValue(assessment());

    const result = await resolveLinkFromSuggestion({
      targetTable: 'award_winners',
      targetId: 412,
      playerId: 1000,
      adminUserId: 5,
      method: 'suggested',
      note: 'Apostrophe variant.',
    });

    expect(result).toEqual({ ok: true });
    const auditInsert = seen.find((query) => (
      query.text.startsWith('INSERT INTO player_link_resolutions')
    ));
    expect(auditInsert?.values).toEqual([
      'award_winners', 412, 1000, 'unmatched', 5,
      'Apostrophe variant.',
      'suggested', 97, 'v1',
    ]);
  });

  it('rescores inside the transaction that holds the lock', async () => {
    const { tx, seen } = lockedUnmatchedRow();
    installImportClient(tx);
    mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
    mocks.assessOneSource.mockResolvedValue(assessment());

    await resolveLinkFromSuggestion({
      targetTable: 'award_winners', targetId: 412, playerId: 1000,
      adminUserId: 5, method: 'suggested',
    });

    // Both reads are handed the transaction, not a pool: scoring a
    // different snapshot from the one being written would make the
    // re-check meaningless.
    expect(mocks.fetchSourceEvidence).toHaveBeenCalledWith(tx, expect.objectContaining({
      status: 'unresolved',
      entity: { type: 'award_winners', id: 412 },
    }));
    expect(mocks.assessOneSource).toHaveBeenCalledWith(tx, sourceRow.source);

    const lockIndex = seen.findIndex((q) => q.text.includes('FOR UPDATE'));
    const updateIndex = seen.findIndex((q) => q.text.startsWith('UPDATE'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(lockIndex);
  });

  it('refuses when the fresh score names a different player', async () => {
    const { tx, seen } = lockedUnmatchedRow();
    installImportClient(tx);
    mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
    mocks.assessOneSource.mockResolvedValue(
      assessment({ best: { ...assessment().best, playerId: 4331 } }),
    );

    const result = await resolveLinkFromSuggestion({
      targetTable: 'award_winners', targetId: 412, playerId: 1000,
      adminUserId: 5, method: 'suggested',
    });

    expect(result.ok).toBe(false);
    expect(seen.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
    expect(seen.some((q) => q.text.startsWith('INSERT INTO player_link_resolutions'))).toBe(false);
  });

  it('refuses a contradicted candidate', async () => {
    const { tx, seen } = lockedUnmatchedRow();
    installImportClient(tx);
    mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
    mocks.assessOneSource.mockResolvedValue(assessment({
      best: { ...assessment().best, hardConflict: true, conflicts: [{ reason: 'x', detail: 'y' }] },
      hardConflict: true,
      bulkEligible: false,
    }));

    const result = await resolveLinkFromSuggestion({
      targetTable: 'award_winners', targetId: 412, playerId: 1000,
      adminUserId: 5, method: 'suggested',
    });

    expect(result.ok).toBe(false);
    expect(seen.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
  });

  it('refuses a bulk approval that is no longer bulk-eligible', async () => {
    const { tx, seen } = lockedUnmatchedRow();
    installImportClient(tx);
    mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
    mocks.assessOneSource.mockResolvedValue(
      assessment({ bulkEligible: false, band: 'high', ambiguous: true }),
    );

    const bulk = await resolveLinkFromSuggestion({
      targetTable: 'award_winners', targetId: 412, playerId: 1000,
      adminUserId: 5, method: 'bulk_suggested',
    });
    expect(bulk.ok).toBe(false);
    expect(seen.some((q) => q.text.startsWith('UPDATE'))).toBe(false);

    // The same row remains approvable one at a time, by a human who can
    // read the evidence.
    const single = await resolveLinkFromSuggestion({
      targetTable: 'award_winners', targetId: 412, playerId: 1000,
      adminUserId: 5, method: 'suggested',
    });
    expect(single).toEqual({ ok: true });
  });

  it('refuses a row that stopped being unresolved while the page was open', async () => {
    const { tx, seen } = fakeTransaction((text) => {
      if (text.startsWith('SELECT link_status_value::text AS status')) {
        return [{ status: 'resolved' }];
      }
      return [];
    });
    installImportClient(tx);
    mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
    mocks.assessOneSource.mockResolvedValue(assessment());

    const result = await resolveLinkFromSuggestion({
      targetTable: 'award_winners', targetId: 412, playerId: 1000,
      adminUserId: 5, method: 'suggested',
    });

    expect(result.ok).toBe(false);
    expect(mocks.assessOneSource).not.toHaveBeenCalled();
    expect(seen.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
  });

  it('refuses to run without the import role', async () => {
    delete process.env.AFLDB_IMPORT_DATABASE_URL;
    const result = await resolveLinkFromSuggestion({
      targetTable: 'award_winners', targetId: 412, playerId: 1000,
      adminUserId: 5, method: 'suggested',
    });
    expect(result).toEqual({
      ok: false,
      error: 'AFLDB_IMPORT_DATABASE_URL is not configured.',
    });
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  /**
   * Stale cached scoring (AFLDB-ISSUE-164 P2, invariant 13).
   *
   * A cached suggestion computed under a different ALGORITHM_VERSION
   * than the running code must never be presented or acted on
   * silently. None of this weakens the rule above it: the fresh score
   * still decides, alone, and the stale figures are only ever reported.
   */
  describe('stale cached versions', () => {
    function formOf(fields: Record<string, string>): FormData {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return form;
    }

    it('approves a v1-cached row on the fresh v2 result and reports the staleness', async () => {
      const { tx, seen } = lockedUnmatchedRow();
      installImportClient(tx);
      mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
      mocks.assessOneSource.mockResolvedValue(assessment({
        algorithmVersion: 'v2',
        best: { ...assessment().best, score: 92 },
      }));

      const result = await resolveLinkFromSuggestion({
        targetTable: 'award_winners', targetId: 412, playerId: 1000,
        adminUserId: 5, method: 'suggested',
        displayed: { algorithmVersion: 'v1', score: 79 },
      });

      expect(result.ok).toBe(true);
      expect((result as { notice?: string }).notice)
        .toContain('shown as v1 score 79; approved on v2 score 92');
      // The recorded score and version are the FRESH ones, never the
      // ones that were on screen.
      const auditInsert = seen.find((query) => (
        query.text.startsWith('INSERT INTO player_link_resolutions')
      ));
      expect(auditInsert?.values.slice(-3)).toEqual(['suggested', 92, 'v2']);
    });

    it('says nothing when the cache and the running matcher agree', async () => {
      const { tx } = lockedUnmatchedRow();
      installImportClient(tx);
      mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
      mocks.assessOneSource.mockResolvedValue(assessment());

      const result = await resolveLinkFromSuggestion({
        targetTable: 'award_winners', targetId: 412, playerId: 1000,
        adminUserId: 5, method: 'suggested',
        displayed: { algorithmVersion: 'v1', score: 97 },
      });

      expect(result).toEqual({ ok: true });
    });

    it('refuses a stale row whose fresh best is a different player', async () => {
      const { tx, seen } = lockedUnmatchedRow();
      installImportClient(tx);
      mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
      mocks.assessOneSource.mockResolvedValue(assessment({
        algorithmVersion: 'v2',
        best: { ...assessment().best, playerId: 4331, score: 92 },
      }));

      const result = await resolveLinkFromSuggestion({
        targetTable: 'award_winners', targetId: 412, playerId: 1000,
        adminUserId: 5, method: 'suggested',
        displayed: { algorithmVersion: 'v1', score: 79 },
      });

      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining('no longer supports that player'),
      });
      expect(seen.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
      expect(seen.some((q) => q.text.startsWith('INSERT INTO player_link_resolutions'))).toBe(false);
    });

    it('refuses a stale bulk row that is no longer bulk-eligible', async () => {
      const { tx, seen } = lockedUnmatchedRow();
      installImportClient(tx);
      mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
      mocks.assessOneSource.mockResolvedValue(assessment({
        algorithmVersion: 'v2', bulkEligible: false, band: 'high',
      }));

      const result = await resolveLinkFromSuggestion({
        targetTable: 'award_winners', targetId: 412, playerId: 1000,
        adminUserId: 5, method: 'bulk_suggested',
        displayed: { algorithmVersion: 'v1', score: 97 },
      });

      expect(result.ok).toBe(false);
      expect(seen.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
    });

    it('takes the displayed version from the database, not from the form', async () => {
      const { tx } = lockedUnmatchedRow();
      installImportClient(tx);
      mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
      mocks.assessOneSource.mockResolvedValue(assessment({
        algorithmVersion: 'v2',
        best: { ...assessment().best, score: 92 },
      }));
      mocks.readCachedSuggestionVersions.mockResolvedValue(new Map([
        ['award_winners:412', {
          targetTable: 'award_winners', targetId: 412, algorithmVersion: 'v1', score: 79,
        }],
      ]));

      const state = await approveSuggestion({}, formOf({
        targets: 'award_winners:412:unmatched',
        playerId: '1000',
        // A browser trying to claim the cache is current must have no
        // effect whatsoever.
        algorithmVersion: 'v2',
        score: '97',
      }));

      expect(mocks.readCachedSuggestionVersions).toHaveBeenCalledWith(
        expect.anything(),
        [{ targetTable: 'award_winners', targetId: 412 }],
      );
      expect(state.message).toBe('Suggested match approved.');
      expect(state.warning).toContain('shown as v1 score 79; approved on v2 score 92');
    });

    it('reports stale rows per row in the bulk summary', async () => {
      const { tx } = lockedUnmatchedRow();
      installImportClient(tx);
      mocks.fetchSourceEvidence.mockResolvedValue([sourceRow]);
      mocks.assessOneSource.mockResolvedValue(assessment({
        algorithmVersion: 'v2',
        best: { ...assessment().best, score: 92 },
      }));
      mocks.readCachedSuggestionVersions.mockResolvedValue(new Map([
        ['award_winners:412', {
          targetTable: 'award_winners', targetId: 412, algorithmVersion: 'v1', score: 79,
        }],
        ['award_winners:413', {
          targetTable: 'award_winners', targetId: 413, algorithmVersion: 'v2', score: 92,
        }],
      ]));

      const state = await bulkApproveSuggestions({}, formOf({
        targets: 'award_winners:412:unmatched,award_winners:413:unmatched',
        playerIds: '1000,1000',
      }));

      expect(mocks.readCachedSuggestionVersions).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          { targetTable: 'award_winners', targetId: 412, previousStatus: 'unmatched' },
          { targetTable: 'award_winners', targetId: 413, previousStatus: 'unmatched' },
        ]),
      );
      expect(state.message).toBe('Approved 2 suggested match(es).');
      // Only the row that was actually stale is named.
      expect(state.warning).toContain('award_winners:412');
      expect(state.warning).not.toContain('award_winners:413');
    });
  });
});

/**
 * Source contracts for the admin actions.
 *
 * Behaviour tests cannot easily prove a NEGATIVE about a whole module —
 * that nothing anywhere reads a score out of the request — so these read
 * the source, in the style of tests/admin-match-mutations.test.ts.
 */
describe('player-link action contracts', () => {
  const actions = readFileSync(
    join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'actions.ts'),
    'utf8',
  );

  it('never reads a score, band or eligibility flag from the request', () => {
    for (const field of ['score', 'band', 'bulkEligible', 'confidence', 'algorithmVersion']) {
      expect(actions).not.toContain(`formData.get('${field}')`);
    }
  });

  it('routes suggested and bulk approvals through the rescoring path', () => {
    expect(actions).toContain('resolveLinkFromSuggestion');
    expect(actions).toContain("method: 'suggested'");
    expect(actions).toContain("method: 'bulk_suggested'");
  });

  it('keeps revalidatePath out of the new actions', () => {
    // Next 15.5 can hang the client commit when the submitting form
    // unmounts; the suggestion controls refresh after the action
    // settles instead (see SuggestionControls).
    const approval = actions.slice(actions.indexOf('export async function approveSuggestion'));
    expect(approval).not.toContain('revalidatePath');
    expect(approval).not.toContain('revalidatePublicLinkPages');
  });

  it('reports every skipped row instead of abandoning the batch', () => {
    const bulk = actions.slice(
      actions.indexOf('export async function bulkApproveSuggestions'),
      actions.indexOf('export async function refreshSuggestions'),
    );
    // A per-row failure must continue, not return, or one stale row
    // would silently strand the rest of the selection.
    expect(bulk).toContain('skipped.push');
    expect(bulk).toContain('continue;');
    expect(bulk).not.toMatch(/if \(!result\.ok\) return/);
  });

  it('reads the displayed algorithm version from the cache, never from the request', () => {
    // Invariant 13: staleness must be established server-side. A
    // browser-supplied version would let a stale page assert it was
    // current.
    expect(actions).toContain('readCachedSuggestionVersions(sql,');
    expect(actions).not.toContain("formData.get('algorithmVersion')");
    expect(actions).not.toContain("formData.get('score')");
  });

  it('gates every action behind the super-admin-only data.playerLinks capability', () => {
    const exported = actions.match(/export async function (\w+)/g) ?? [];
    expect(exported.length).toBeGreaterThanOrEqual(7);
    const guards = actions.match(/await requireCapability\('data\.playerLinks'\)/g) ?? [];
    expect(guards.length).toBe(exported.length);
  });
});

describe('suggestion cache jsonb contract', () => {
  const candidates = readFileSync(
    join(process.cwd(), 'src', 'db', 'queries', 'player-match-candidates.ts'),
    'utf8',
  );

  it('writes evidence through the driver json wrapper, not JSON.stringify', () => {
    // Handing postgres.js a STRING for a jsonb column stores the JSON of
    // that string, so the value reads back as text and every consumer
    // expecting an array throws. This reached the deployed page once.
    expect(candidates).toContain('writeSql.json(candidate.evidence)');
    expect(candidates).toContain('writeSql.json(candidate.conflicts)');
    expect(candidates).not.toContain('JSON.stringify(candidate.evidence)');
    expect(candidates).not.toContain('JSON.stringify(candidate.conflicts)');
  });

  it('reads those columns tolerantly, so a stale cache degrades instead of throwing', () => {
    expect(candidates).toContain('function asArray');
    expect(candidates).toContain('asArray<EvidenceItem>(row.evidence)');
    expect(candidates).toContain('asArray<HardConflict>(row.conflicts)');
  });
});

describe('queue page contracts', () => {
  const page = readFileSync(
    join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'page.tsx'),
    'utf8',
  );

  it('lists one row per resolution entity, not per source row', () => {
    // A draft person named in five drafts is one decision. Listing it
    // five times would ask for the same judgement repeatedly and would
    // let five rows be selected for a bulk approval the first already
    // settled.
    expect(page).toContain('seenEntities');
    expect(page).toContain('resolutionEntityType}:${r.resolutionEntityId}');
  });

  it('withholds a disagreeing name group from bulk selection', () => {
    expect(page).toContain('&& !group.disagrees');
  });

  it('reads evidence from the server-scored cache rather than recomputing it', () => {
    // The page must never form its own view of why a score is what it
    // is; it renders what the scorer recorded.
    expect(page).toContain('match.evidence.map');
    expect(page).not.toContain('scoreCandidate');
    expect(page).not.toContain('assessMatch');
  });

  it('derives staleness from the server-side cache version and shows it', () => {
    // Invariant 13: the page compares each cached row's version with the
    // version the running code declares, and says so on the page --
    // once at the top and again on every affected row.
    expect(page).toContain("from '@/lib/player-matching/confidence'");
    expect(page).toContain('ALGORITHM_VERSION');
    expect(page).toContain('s2.algorithmVersion !== ALGORITHM_VERSION');
    expect(page).toContain('match.algorithmVersion !== ALGORITHM_VERSION');
    expect(page).toContain('staleCount > 0');
    expect(page).toContain('Stale ({match.algorithmVersion})');
    // The drawer is told both versions so it can warn before approval.
    expect(page).toContain('currentAlgorithmVersion: ALGORITHM_VERSION');
    expect(page).toContain('stale,');
  });

  it('warns in the drawer that a stale score is not what approval will use', () => {
    const controls = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'ResolveControls.tsx'),
      'utf8',
    );
    expect(controls).toContain('match.stale');
    expect(controls).toContain('Stale suggestion');
    expect(controls).toContain('currentAlgorithmVersion');
    // The warning sits above the approval form, not after it.
    expect(controls.indexOf('Stale suggestion'))
      .toBeLessThan(controls.indexOf('action={approveAction}'));
  });

  it('explains a capped row rather than leaving the band unexplained', () => {
    // AFLDB-ISSUE-164 §11 items 1-2 / acceptance §13 item 1. The typed
    // reasons come from the pure helper and are worded server-side; the
    // page neither invents them nor rescores to get them.
    expect(page).toContain("from '@/lib/player-matching/explain-limits'");
    expect(page).toContain('explainLimits(');
    expect(page).toContain('profileFromSourceDetail(');
    expect(page).toContain('describeLimitReason(');
    expect(page).toContain('{limitLine}');
    // The group rule reaches the explanation as an input, not as a
    // second opinion formed inside it.
    expect(page).toContain('groupDisagrees: group.disagrees');
  });

  it('sends the drawer the criteria for every suggested row, not only bulk ones', () => {
    const controls = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'ResolveControls.tsx'),
      'utf8',
    );
    // §11 item 3: the block used to render only when match.bulkEligible,
    // which is exactly why a capped row and an unlucky one looked the
    // same. It now renders whenever there are criteria to show.
    expect(controls).toContain('match.bulkCriteria.length > 0');
    expect(controls).not.toContain('{match.bulkEligible && (');
    expect(controls).toContain("criterion.met ? '✓' : '✗'");
    // Source-class exclusion and the reachable ceiling are both visible.
    expect(controls).toContain('match.ceiling');
    expect(controls).toContain('match.limitReasons');
    expect(controls).toContain('match.clubTextUnresolved');
    expect(page).toContain('describeBulkChecklist(');
    expect(page).toContain('describeCeiling(');
  });

  it('keeps the stale warning alongside the criteria block', () => {
    const controls = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'ResolveControls.tsx'),
      'utf8',
    );
    // Invariant 13 must survive §11: both blocks coexist, and the stale
    // warning still sits above the approval form.
    expect(controls).toContain('Stale suggestion');
    expect(controls.indexOf('Stale suggestion'))
      .toBeLessThan(controls.indexOf('match.bulkCriteria.length > 0'));
    expect(controls.indexOf('match.bulkCriteria.length > 0'))
      .toBeLessThan(controls.indexOf('action={approveAction}'));
  });

  it('leaves scoring, bands and bulk eligibility to the server', () => {
    // The explanation layer is additive. Nothing on the page may decide
    // a band or a bulk flag, and bulkReady is still the cached
    // assessment narrowed only by the group rule.
    expect(page).toContain('const bulkReady = (match?.bulkEligible ?? false) && !group.disagrees');
    expect(page).toContain('bulkEligible: bulkReady,');
    expect(page).not.toContain('scoreCandidate');
    expect(page).not.toContain('assessMatch');
  });

  it('fetches page-scoped detail set-wise, never per row', () => {
    expect(page).toContain('readSourceDetails(sql, pageRows)');
    expect(page).toContain('readPlayerSummaries(');
    // One shared client panel, not a component per row.
    expect(page).toContain('<ResolvePanel />');
  });
});
