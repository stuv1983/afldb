import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import type {
  AflApiCandidateIdentityRow,
  AflApiForwardIdentityResult,
  AflApiImporterMatchMethod,
  AflApiPlayerRemapResult,
  CapturedImporterRow,
} from '@/lib/acquisition/afl-api-adjudication';

import {
  assertS6LedgerIsolated,
  cleanupI14Fixtures,
  cleanupS6Fixtures,
  I1_FIXTURE,
  I14_FIXTURE,
  i14StaleLedgerRow,
  issue235FixtureResidue,
  ISSUE235_OWNERSHIP,
  isS6MatchRecordId,
  ownsAfltablesId,
  ownsLegacyPlayerId,
  ownsProviderId,
  S6_ACTOR_EMAIL,
  S6_AFLTABLES_ID_PATTERN,
  S6_AFLTABLES_PREFIX,
  S6_FIXTURE_TOOL,
  S6_HASH_RECIPE,
  S6_LEGACY_ID_RANGE,
  S6_MATCH_RECORD_PATTERN,
  S6_OWNERSHIP,
  S6_PROVIDER_ID_PATTERN,
  s6MatchId,
  s6ProviderId,
  seedI14Actor,
  ZERO_ISSUE235_RESIDUE,
} from './integration/afl-api-adjudication-fixtures';
import { I18_FIXTURE } from '../tools/migration/afl_api_adjudication_i18_fixture';

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

/**
 * AFLDB-ISSUE-235 §10.1 A1-A4, A9 — the pure decision module
 * (`src/lib/acquisition/afl-api-adjudication.ts`), DB-free. No postgres/authSql mock is
 * needed here: every function under test takes plain data and returns plain data.
 */
describe('AFLDB-ISSUE-235: afl-api-adjudication (pure module)', () => {
  it('A1 — the fingerprint is deterministic, order-independent, and changes with any field', async () => {
    const { adjudicationFingerprint } = await import('@/lib/acquisition/afl-api-adjudication');
    const base = {
      providerId: 'CD_I100',
      existing: null,
      pendingCandidates: [{ id: 1, sourceVersionSeq: 5 }, { id: 2, sourceVersionSeq: 3 }],
      latestAdjudicationId: null,
      chosenPlayerId: 42,
      chosenPlayerExistingRows: [],
    };
    const a = adjudicationFingerprint(base);
    const b = adjudicationFingerprint(base);
    expect(a).toBe(b); // deterministic
    expect(a).toMatch(/^[0-9a-f]{64}$/);

    // Reordering the candidate array must not change the digest.
    const reordered = adjudicationFingerprint({
      ...base,
      pendingCandidates: [...base.pendingCandidates].reverse(),
    });
    expect(reordered).toBe(a);

    // Any real field change moves the digest: row, candidate version, audit id, player links.
    expect(adjudicationFingerprint({ ...base, existing: { id: 9, status: 'unique', playerId: 5, matchMethod: 'x' } }))
      .not.toBe(a);
    expect(adjudicationFingerprint({
      ...base, pendingCandidates: [{ id: 1, sourceVersionSeq: 6 }, { id: 2, sourceVersionSeq: 3 }],
    })).not.toBe(a);
    expect(adjudicationFingerprint({ ...base, latestAdjudicationId: 7 })).not.toBe(a);
    expect(adjudicationFingerprint({ ...base, chosenPlayerId: 43 })).not.toBe(a);
    expect(adjudicationFingerprint({
      ...base, chosenPlayerExistingRows: [{ id: 1, status: 'unique', matchMethod: 'afltables_profile_url' }],
    })).not.toBe(a);
  });

  it('A2 — validation rejects a bad provider id, non-integer player id, an out-of-bounds note, and a missing ack', async () => {
    const { validateAdjudicationInput } = await import('@/lib/acquisition/afl-api-adjudication');
    const good = {
      providerId: 'CD_I12345', playerId: 42, note: 'x'.repeat(30),
      surnameDisagrees: false, surnameAcknowledged: false,
    };
    expect(validateAdjudicationInput(good)).toEqual([]);

    expect(validateAdjudicationInput({ ...good, providerId: 'CD_I' })).toContain('invalid_provider_id');
    expect(validateAdjudicationInput({ ...good, providerId: '12345' })).toContain('invalid_provider_id');
    expect(validateAdjudicationInput({ ...good, playerId: 0 })).toContain('invalid_player_id');
    expect(validateAdjudicationInput({ ...good, playerId: 1.5 })).toContain('invalid_player_id');
    expect(validateAdjudicationInput({ ...good, playerId: -3 })).toContain('invalid_player_id');
    expect(validateAdjudicationInput({ ...good, note: 'x'.repeat(19) })).toContain('note_too_short');
    expect(validateAdjudicationInput({ ...good, note: 'x'.repeat(20) })).toEqual([]);
    expect(validateAdjudicationInput({ ...good, note: 'x'.repeat(2001) })).toContain('note_too_long');
    expect(validateAdjudicationInput({ ...good, note: 'x'.repeat(2000) })).toEqual([]);
    expect(validateAdjudicationInput({ ...good, surnameDisagrees: true, surnameAcknowledged: false }))
      .toContain('missing_surname_acknowledgement');
    expect(validateAdjudicationInput({ ...good, surnameDisagrees: true, surnameAcknowledged: true }))
      .toEqual([]);
  });

  it('A3 — state classification covers U0, U1, L-I (every loader method incl. legacy manual), L-H, and X', async () => {
    const { classifyAflApiIdentityState } = await import('@/lib/acquisition/afl-api-adjudication');
    expect(classifyAflApiIdentityState({ row: null, hasPendingCandidate: false })).toBe('U0');
    expect(classifyAflApiIdentityState({ row: null, hasPendingCandidate: true })).toBe('U1');

    for (const matchMethod of [
      'afl_api_stat_vector_bootstrap', 'afl_api_name_team_season_bootstrap',
      'afl_api_manual_adjudication', 'afl_api_stat_vector_season',
    ]) {
      expect(classifyAflApiIdentityState({
        row: { id: 1, status: 'unique', playerId: 5, matchMethod }, hasPendingCandidate: false,
      }), matchMethod).toBe('L-I');
    }

    expect(classifyAflApiIdentityState({
      row: { id: 1, status: 'resolved', playerId: 5, matchMethod: 'afl_api_admin_adjudication' },
      hasPendingCandidate: false,
    })).toBe('L-H');

    // X: NULL player, an untrusted status, and resolved under a foreign method.
    expect(classifyAflApiIdentityState({
      row: { id: 1, status: 'unique', playerId: null, matchMethod: 'afl_api_stat_vector_bootstrap' },
      hasPendingCandidate: false,
    })).toBe('X');
    expect(classifyAflApiIdentityState({
      row: { id: 1, status: 'ambiguous', playerId: 5, matchMethod: null }, hasPendingCandidate: false,
    })).toBe('X');
    expect(classifyAflApiIdentityState({
      row: { id: 1, status: 'resolved', playerId: 5, matchMethod: 'some_other_method' },
      hasPendingCandidate: false,
    })).toBe('X');
  });

  it('A4 — refusal mapping covers T2-T9, T19 and T20', async () => {
    const { decideAflApiLink, decideAflApiRevoke } = await import('@/lib/acquisition/afl-api-adjudication');
    const baseLink = {
      state: 'U1' as const, existingRow: null, chosenPlayerId: 1,
      chosenPlayerOtherAflApiProviderId: null, chosenPlayerHasStableIdentity: true,
      hasPendingEvidence: true, fingerprintMatches: true, surnameDisagrees: false, surnameAcknowledged: false,
    };
    expect(decideAflApiLink(baseLink)).toEqual({ allow: true });

    // T6: stale fingerprint refuses before anything else is even consulted.
    expect(decideAflApiLink({ ...baseLink, fingerprintMatches: false }).allow).toBe(false);
    expect((decideAflApiLink({ ...baseLink, fingerprintMatches: false }) as any).code).toBe('T6_stale_fingerprint');

    // T8: anomalous row.
    expect((decideAflApiLink({ ...baseLink, state: 'X' }) as any).code).toBe('T8_anomalous_row');

    // T2 / T3: already linked, same vs different player.
    expect((decideAflApiLink({
      ...baseLink, state: 'L-H', existingRow: { id: 1, status: 'resolved', playerId: 1, matchMethod: 'afl_api_admin_adjudication' },
    }) as any).code).toBe('T2_already_linked_same_player');
    expect((decideAflApiLink({
      ...baseLink, state: 'L-I', existingRow: { id: 1, status: 'unique', playerId: 999, matchMethod: 'afl_api_stat_vector_bootstrap' },
    }) as any).code).toBe('T3_already_linked_different_player');

    // T5: no pending evidence.
    expect((decideAflApiLink({ ...baseLink, hasPendingEvidence: false }) as any).code).toBe('T5_no_evidence');

    // T4: the chosen player already holds a different provider.
    expect((decideAflApiLink({ ...baseLink, chosenPlayerOtherAflApiProviderId: 'CD_I999' }) as any).code)
      .toBe('T4_player_holds_another_provider');

    // T7: the chosen player has no stable identity.
    expect((decideAflApiLink({ ...baseLink, chosenPlayerHasStableIdentity: false }) as any).code)
      .toBe('T7_player_not_stable');

    // T9: surname disagreement without acknowledgement.
    expect((decideAflApiLink({ ...baseLink, surnameDisagrees: true, surnameAcknowledged: false }) as any).code)
      .toBe('T9_surname_ack_required');
    expect(decideAflApiLink({ ...baseLink, surnameDisagrees: true, surnameAcknowledged: true })).toEqual({ allow: true });

    // T19 / T20: revoke.
    const baseRevoke = { state: 'L-H' as const, fingerprintMatches: true, nonUseProven: true };
    expect(decideAflApiRevoke(baseRevoke)).toEqual({ allow: true });
    expect((decideAflApiRevoke({ ...baseRevoke, fingerprintMatches: false }) as any).code).toBe('T6_stale_fingerprint');
    expect((decideAflApiRevoke({ ...baseRevoke, state: 'X' }) as any).code).toBe('T8_anomalous_row');
    expect((decideAflApiRevoke({ ...baseRevoke, state: 'L-I' }) as any).code).toBe('T20_revoke_importer_link');
    expect((decideAflApiRevoke({ ...baseRevoke, nonUseProven: false }) as any).code).toBe('T19_revoke_unprovable');
  });

  it('A9 — extractProviderClassification pulls a hit, a surname disagreement, and competitors from a fabricated engine result', async () => {
    const { extractProviderClassification } = await import('@/lib/acquisition/afl-api-adjudication');
    const classification = {
      providerId: 'CD_I700', observedName: 'Matt Taberner', observedSurname: 'Taberner',
      snapshotRowCount: 3, matchedEvidenceCount: 1, disposition: 'contradictory' as const,
      reason: 'surname_disagrees(Matt/Matthew)', candidatePlayerId: null, canonicalSurname: 'Taberner',
      evidenceSummary: 'fixture',
      matches: [{
        providerMatchId: 'CD_M1', canonicalPlayerId: 12205, agreeingStatCount: 12,
        allZeroCoreVector: false, canonicalSurname: 'Taberner',
      }],
      unmatched: [],
      competingCandidates: [{
        canonicalPlayerId: 12205, providerMatchIds: ['CD_M1'], competingProviderIds: ['CD_I701'],
      }],
    };
    const result = { counters: {} as any, providers: [classification], matches: [] };

    expect(extractProviderClassification(result as any, 'CD_I700')).toEqual(classification);
    expect(extractProviderClassification(result as any, 'CD_I999_absent')).toBeNull();
  });

  it('A11 (R1, R2, R5) — the manifest proof fails closed, on fabricated catalogue/use data', async () => {
    const { validateManifestAgainstCatalogue, evaluateNonUseProof } =
      await import('@/lib/acquisition/afl-api-adjudication');

    const fixtureManifest = [
      {
        schema: 'public', table: 'fixture_link_dependent', playerColumns: ['player_id'],
        class: 'LINK_DEPENDENT', provenanceColumns: ['source_id'], reason: 'fixture',
      },
      {
        schema: 'public', table: 'fixture_link_independent', playerColumns: ['player_id'],
        class: 'LINK_INDEPENDENT', provenanceColumns: ['source_id'], reason: 'fixture',
      },
      {
        schema: 'public', table: 'fixture_not_source_bearing', playerColumns: ['player_id'],
        class: 'NOT_SOURCE_BEARING', provenanceColumns: [], reason: 'fixture',
      },
      // A staging table, to prove the check is not public-only.
      {
        schema: 'staging', table: 'fixture_staging_dependent', playerColumns: ['player_id'],
        class: 'LINK_DEPENDENT', provenanceColumns: ['source_id'], reason: 'fixture',
      },
    ] as const;

    // A catalogue table absent from the manifest, in ANY schema, refuses as unprovable.
    const unclassified = validateManifestAgainstCatalogue(
      [{ schema: 'staging', table: 'fixture_brand_new', column: 'player_id' }],
      fixtureManifest,
    );
    expect(unclassified).toEqual([{
      kind: 'unclassified_table', schema: 'staging', table: 'fixture_brand_new', columns: ['player_id'],
    }]);

    // A manifest entry whose declared column no longer exists in the catalogue refuses.
    const missingColumn = validateManifestAgainstCatalogue(
      [{ schema: 'public', table: 'fixture_link_dependent', column: 'renamed_player_id' }],
      fixtureManifest,
    );
    expect(missingColumn).toContainEqual({
      kind: 'missing_column', schema: 'public', table: 'fixture_link_dependent', column: 'player_id',
    });

    // A NOT_SOURCE_BEARING table that has since gained a source_id (or source_key) column refuses.
    const gainedSourceId = validateManifestAgainstCatalogue(
      [
        { schema: 'public', table: 'fixture_not_source_bearing', column: 'player_id' },
        { schema: 'public', table: 'fixture_not_source_bearing', column: 'source_id' },
      ],
      fixtureManifest,
    );
    expect(gainedSourceId).toContainEqual({
      kind: 'not_source_bearing_gained_source_id', schema: 'public', table: 'fixture_not_source_bearing',
    });
    // ...but not when the manifest entry already declares it (a deliberate, acknowledged column).
    const acknowledged = validateManifestAgainstCatalogue(
      [
        { schema: 'public', table: 'fixture_link_independent', column: 'player_id' },
        { schema: 'public', table: 'fixture_link_independent', column: 'source_id' },
      ],
      fixtureManifest,
    );
    expect(acknowledged).toEqual([]);

    // A clean catalogue (every table classified, every column present) proves nothing.
    const clean = validateManifestAgainstCatalogue(
      [
        { schema: 'public', table: 'fixture_link_dependent', column: 'player_id' },
        { schema: 'staging', table: 'fixture_staging_dependent', column: 'player_id' },
      ],
      fixtureManifest,
    );
    expect(clean).toEqual([]);

    // A LINK_INDEPENDENT table (e.g. player_height_evidence) is never counted as use "by
    // itself" (D10): the query module (§7.2) runs use-predicate counts ONLY for
    // LINK_DEPENDENT tables and the two ledger checks, so a LINK_INDEPENDENT table's rows
    // never reach `useCounts` at all -- evaluateNonUseProof has no LINK_INDEPENDENT
    // exemption of its own to test, because none is needed: the exemption is that the
    // query module never measures it. What IS this function's own job is refusing on any
    // count it IS given, whatever the table:
    expect(evaluateNonUseProof({
      manifestProblems: [], lockTimedOut: false,
      useCounts: [{ schema: 'public', table: 'player_height_evidence', count: 3 }],
    }).proven).toBe(false); // a nonzero count always refuses, regardless of which table

    // ...a genuine LINK_DEPENDENT (or ledger) hit refuses, naming the table.
    expect(evaluateNonUseProof({
      manifestProblems: [], lockTimedOut: false,
      useCounts: [{ schema: 'public', table: 'player_match_stats', count: 1 }],
    })).toMatchObject({ proven: false, reason: expect.stringContaining('player_match_stats') });

    // A lock timeout refuses as "retry", independent of every other check.
    expect(evaluateNonUseProof({
      manifestProblems: [{ kind: 'unclassified_table', schema: 'x', table: 'y', columns: [] }],
      useCounts: [], lockTimedOut: true,
    })).toEqual({ proven: false, reason: expect.stringContaining('retry') });

    // Any manifest problem refuses, even with zero use counts.
    expect(evaluateNonUseProof({
      manifestProblems: [{ kind: 'missing_column', schema: 'x', table: 'y', column: 'z' }],
      useCounts: [], lockTimedOut: false,
    }).proven).toBe(false);

    // Zero problems, zero use, no timeout -> proven.
    expect(evaluateNonUseProof({ manifestProblems: [], useCounts: [], lockTimedOut: false }))
      .toEqual({ proven: true });
  });

  it('A11: promotion_candidates.target_id is never read in the ledger checks', async () => {
    const { AFL_API_LEDGER_CHECKS } = await import('@/lib/acquisition/afl-api-adjudication');
    const pc = AFL_API_LEDGER_CHECKS.find((c) => c.table === 'promotion_candidates')!;
    // The predicate proper (before the explanatory comment) never reads target_id --
    // it names the constant only to explain WHY it is deliberately absent (R5).
    expect(pc.predicate.split(' -- ')[0]).not.toMatch(/\btarget_id\b/);
    expect(pc.predicate).toContain("proposed_fields->>'player_id'");
    const ca = AFL_API_LEDGER_CHECKS.find((c) => c.table === 'canonical_applications')!;
    expect(ca.predicate).toContain("target_key->>'player_id'");
    expect(ca.predicate).toContain("external_record_id LIKE '%|' || <CD_I>");
  });

  it('A11b — every REFERENCES players column in src/db/migrations/*.sql is classified, with the classes D10 declares', async () => {
    const { AFL_API_PLAYER_REFERENCE_MANIFEST } = await import('@/lib/acquisition/afl-api-adjudication');
    const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    const createPattern = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;
    const refPattern = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+\S.*?REFERENCES\s+players\s*\(/i;
    // A renamed table keeps its player FK under the NEW name: 015 renames 007's
    // player_season_stats to player_club_season_stats, which the live catalogue (I17) sees.
    const renamePattern = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-zA-Z_][a-zA-Z0-9_.]*)\s+RENAME\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i;
    const qualify = (name: string) => (name.includes('.') ? name : `public.${name}`);
    const found = new Set<string>(); // "schema.table.column"

    for (const file of files) {
      const text = readFileSync(join(migrationsDir, file), 'utf8');
      const lines = text.split('\n');
      let currentTable: string | null = null;
      for (const line of lines) {
        createPattern.lastIndex = 0;
        const createMatch = createPattern.exec(line);
        if (createMatch) currentTable = createMatch[1];
        if (line.trim().startsWith('--')) continue; // a comment mentioning REFERENCES players is not a real column
        const renameMatch = renamePattern.exec(line);
        if (renameMatch) {
          const from = `${qualify(renameMatch[1])}.`;
          const to = `${qualify(renameMatch[1]).split('.')[0]}.${renameMatch[2]}.`;
          for (const key of [...found].filter((k) => k.startsWith(from))) {
            found.delete(key);
            found.add(to + key.slice(from.length));
          }
          continue;
        }
        const refMatch = refPattern.exec(line);
        if (refMatch && currentTable) {
          const [schema, table] = currentTable.includes('.')
            ? currentTable.split('.')
            : ['public', currentTable];
          found.add(`${schema}.${table}.${refMatch[1]}`);
        }
      }
    }

    // Every real REFERENCES players(id) column has a manifest entry naming it.
    const manifestColumns = new Set(
      AFL_API_PLAYER_REFERENCE_MANIFEST.flatMap(
        (e) => e.playerColumns.map((c) => `${e.schema}.${e.table}.${c}`),
      ),
    );
    const missingFromManifest = [...found].filter((key) => !manifestColumns.has(key));
    expect(missingFromManifest, missingFromManifest.join(', ')).toEqual([]);

    // No manifest entry names a column the live migration set does not actually create
    // (a stale entry is exactly as dangerous as a missing one -- it hides a real change).
    const staleManifestEntries = [...manifestColumns].filter((key) => !found.has(key));
    expect(staleManifestEntries, staleManifestEntries.join(', ')).toEqual([]);

    // Every class used is one D10 declares.
    for (const entry of AFL_API_PLAYER_REFERENCE_MANIFEST) {
      expect(['LINK_DEPENDENT', 'LINK_INDEPENDENT', 'NOT_SOURCE_BEARING'], `${entry.schema}.${entry.table}`)
        .toContain(entry.class);
    }

    // The initial LINK_DEPENDENT set the runbook pins (D10), confirmed by tracing the
    // settle writers (S3): exactly these four, no more, no fewer.
    const linkDependent = AFL_API_PLAYER_REFERENCE_MANIFEST
      .filter((e) => e.class === 'LINK_DEPENDENT')
      .map((e) => `${e.schema}.${e.table}`)
      .sort();
    expect(linkDependent).toEqual([
      'public.brownlow_round_votes', 'public.player_match_stats',
      'staging.afl_api_brownlow_vote', 'staging.afl_api_player_match',
    ]);

    // player_height_evidence is confirmed LINK_INDEPENDENT (the D10 precedent), never
    // counted as use on its own.
    const height = AFL_API_PLAYER_REFERENCE_MANIFEST.find((e) => e.table === 'player_height_evidence');
    expect(height?.class).toBe('LINK_INDEPENDENT');

    // A staging table is genuinely present (R2): the manifest is not public-only.
    expect(AFL_API_PLAYER_REFERENCE_MANIFEST.some((e) => e.schema === 'staging')).toBe(true);
  });

  it('I17 live finding — public.player_club_season_stats.player_id is classified NOT_SOURCE_BEARING with no provenance column', async () => {
    const { AFL_API_PLAYER_REFERENCE_MANIFEST, validateManifestAgainstCatalogue } =
      await import('@/lib/acquisition/afl-api-adjudication');
    const entries = AFL_API_PLAYER_REFERENCE_MANIFEST
      .filter((e) => e.schema === 'public' && e.table === 'player_club_season_stats');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      playerColumns: ['player_id'], class: 'NOT_SOURCE_BEARING', provenanceColumns: [],
    });
    // Its derived neighbours carry the same class (the precedent the entry follows).
    for (const table of ['player_season_stats', 'player_career_stats', 'player_clubs']) {
      expect(AFL_API_PLAYER_REFERENCE_MANIFEST.find((e) => e.schema === 'public' && e.table === table)?.class, table)
        .toBe('NOT_SOURCE_BEARING');
    }
    // The exact catalogue row the live I17 check reported as unclassified_table is now clean,
    // and the validator itself is unweakened: the same row with a gained source_id refuses.
    const liveRow = { schema: 'public', table: 'player_club_season_stats', column: 'player_id' };
    expect(validateManifestAgainstCatalogue([liveRow])).toEqual([]);
    expect(validateManifestAgainstCatalogue([liveRow, { ...liveRow, column: 'source_id' }]))
      .toContainEqual({ kind: 'not_source_bearing_gained_source_id', schema: 'public', table: 'player_club_season_stats' });
  });
});

/**
 * AFLDB-ISSUE-237 §9 — the importer identity capture/replay/promotion pure module, DB-free.
 * Extends the ISSUE-235 pure-module block above with D5, D6, D9, D13, D14 and the G1/G2/G3
 * classifiers. No postgres/authSql mock is exercised: every function here is a pure function
 * of plain data.
 */
describe('AFLDB-ISSUE-237: afl-api-adjudication (pure module, importer identity)', () => {
  it('AFL_API_IMPORTER_MATCH_METHODS is the loader\'s own allowed set (AFLDB-ISSUE-241: the .ts loader)', async () => {
    const { AFL_API_IMPORTER_MATCH_METHODS } = await import('@/lib/acquisition/afl-api-adjudication');
    expect([...AFL_API_IMPORTER_MATCH_METHODS].sort()).toEqual([
      'afl_api_manual_adjudication', 'afl_api_name_team_season_bootstrap',
      'afl_api_stat_vector_bootstrap', 'afl_api_stat_vector_season',
    ]);
    // The loader no longer keeps a second copy of the set: it imports this one, and the retired
    // Python stub carries no method list at all, so the two can no longer drift.
    const tsSource = readFileSync(join(process.cwd(), 'tools', 'migration', 'import_afl_api_player_bridge.ts'), 'utf8');
    expect(tsSource).toContain('AFL_API_IMPORTER_MATCH_METHODS');
    expect(tsSource).toContain('isAflApiImporterMatchMethod(evidenceClass)');
    const pySource = readFileSync(join(process.cwd(), 'tools', 'migration', 'import_afl_api_player_bridge.py'), 'utf8');
    expect(pySource).not.toMatch(/ALLOWED_MATCH_METHODS|INSERT INTO|psycopg/);
  });

  it('importerCaptureStructureProblems — D13 capture structure checks', async () => {
    const { importerCaptureStructureProblems } = await import('@/lib/acquisition/afl-api-adjudication');
    const base = {
      status: 'unique' as const, candidateCount: 1 as const, externalName: null, externalUrl: null,
      notes: null, playerId: 1,
    };
    // `overrides` deliberately breaks the D5 shape (bad method, count, url) -- the checks under
    // test exist precisely for rows the static type forbids, so the widening cast is explicit.
    const row = (
      externalId: string, playerIdentity: string,
      overrides: Partial<Record<keyof CapturedImporterRow, unknown>> = {},
    ): CapturedImporterRow => ({
      ...base, externalId, playerIdentity, matchMethod: 'afl_api_stat_vector_bootstrap', ...overrides,
    } as unknown as CapturedImporterRow);

    expect(importerCaptureStructureProblems([row('CD_I1', 'a')])).toEqual([]);
    // duplicate provider
    expect(importerCaptureStructureProblems([row('CD_I1', 'a'), row('CD_I1', 'b')]))
      .toContainEqual({ kind: 'duplicate_provider', externalId: 'CD_I1' });
    // duplicate identity (the migration 104 per-player index)
    expect(importerCaptureStructureProblems([row('CD_I1', 'a'), row('CD_I2', 'a')]))
      .toContainEqual({ kind: 'duplicate_identity', playerIdentity: 'a' });
    // unsupported method
    expect(importerCaptureStructureProblems([row('CD_I1', 'a', { matchMethod: 'not_a_real_method' })]))
      .toContainEqual({ kind: 'unsupported_method', externalId: 'CD_I1', matchMethod: 'not_a_real_method' });
    // candidate_count != 1
    expect(importerCaptureStructureProblems([row('CD_I1', 'a', { candidateCount: 2 })]))
      .toContainEqual({ kind: 'unexpected_candidate_count', externalId: 'CD_I1', candidateCount: 2 });
    // non-NULL url
    expect(importerCaptureStructureProblems([row('CD_I1', 'a', { externalUrl: 'https://example.com' })]))
      .toContainEqual({ kind: 'non_null_external_url', externalId: 'CD_I1' });
    // empty identity
    expect(importerCaptureStructureProblems([row('CD_I1', '')]))
      .toContainEqual({ kind: 'empty_identity', externalId: 'CD_I1' });
  });

  it('planAflApiImporterReplay — every D9 row of the importer replay table', async () => {
    const { planAflApiImporterReplay } = await import('@/lib/acquisition/afl-api-adjudication');
    const IDENTITY = 'players/A/Alpha_Able.html';
    const captured = (
      externalId: string, playerIdentity = IDENTITY, playerId = 1,
      matchMethod: AflApiImporterMatchMethod = 'afl_api_stat_vector_bootstrap',
    ): CapturedImporterRow => ({
      externalId, playerIdentity, matchMethod, status: 'unique',
      candidateCount: 1, externalName: null, externalUrl: null, notes: null, playerId,
    });
    const remapTo = (newPlayerId: number, remappedIdentity = IDENTITY) => ({ ok: true as const, newPlayerId, remappedIdentity });
    const plan = (input: {
      capturedRows: ReturnType<typeof captured>[];
      remap: Array<[string, AflApiPlayerRemapResult]>;
      candidates?: { externalId: string; status: string; matchMethod: string | null; playerId: number | null }[];
    }) => planAflApiImporterReplay({
      capturedRows: input.capturedRows,
      remapByExternalId: new Map(input.remap),
      candidateByExternalId: new Map((input.candidates ?? []).map((c) => [c.externalId, c])),
      candidatePlayerAflApiRow: new Map((input.candidates ?? [])
        .filter((c) => c.playerId !== null).map((c) => [c.playerId!, c])),
    });

    // insert
    expect(plan({ capturedRows: [captured('CD_I1')], remap: [['CD_I1', remapTo(907)]] }))
      .toEqual({ inserts: [{ externalId: 'CD_I1', playerId: 907, row: captured('CD_I1') }], noops: [], stops: [] });
    // identical no-op (the recovery-verify path)
    expect(plan({
      capturedRows: [captured('CD_I1')], remap: [['CD_I1', remapTo(907)]],
      candidates: [{ externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 907 }],
    })).toMatchObject({ inserts: [], noops: [{ externalId: 'CD_I1' }], stops: [] });
    // same player, different method -> STOP
    expect(plan({
      capturedRows: [captured('CD_I1')], remap: [['CD_I1', remapTo(907)]],
      candidates: [{ externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_manual_adjudication', playerId: 907 }],
    }).stops).toEqual([{ externalId: 'CD_I1', reason: 'an importer row for this provider already exists under a different method or field' }]);
    // different player under the same provider -> STOP
    expect(plan({
      capturedRows: [captured('CD_I1')], remap: [['CD_I1', remapTo(907)]],
      candidates: [{ externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 555 }],
    }).stops).toEqual([{ externalId: 'CD_I1', reason: 'an importer row for this provider already exists, resolved to a different player' }]);
    // player collision (migration 104 per-player index)
    expect(plan({
      capturedRows: [captured('CD_I1')], remap: [['CD_I1', remapTo(907)]],
      candidates: [{ externalId: 'CD_I2', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 907 }],
    }).stops).toEqual([{ externalId: 'CD_I1', reason: 'player 907 already holds a different afl_api provider (CD_I2)' }]);
    // an existing human row for the same provider (same or different player) -> STOP
    for (const playerId of [907, 555]) {
      expect(plan({
        capturedRows: [captured('CD_I1')], remap: [['CD_I1', remapTo(907)]],
        candidates: [{ externalId: 'CD_I1', status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId }],
      }).stops[0].reason).toContain('human resolved row already exists');
    }
    // unresolvable
    expect(plan({ capturedRows: [captured('CD_I1')], remap: [] }).stops)
      .toEqual([{ externalId: 'CD_I1', reason: 'the captured row\'s player identity does not resolve to any candidate player' }]);
    // ambiguous
    expect(plan({ capturedRows: [captured('CD_I1')], remap: [['CD_I1', { ok: false, reason: 'ambiguous' }]] }).stops)
      .toEqual([{ externalId: 'CD_I1', reason: 'the captured row\'s player identity resolves to more than one candidate player' }]);
    // an old id remapped to a DIFFERENT new id through its identity -- an ordinary insert, not a stop
    expect(plan({ capturedRows: [captured('CD_I1', IDENTITY, 42)], remap: [['CD_I1', remapTo(907)]] }).inserts)
      .toEqual([{ externalId: 'CD_I1', playerId: 907, row: captured('CD_I1', IDENTITY, 42) }]);
  });

  it('importerParityProblems — D13 exact parity between a capture and the live projection', async () => {
    const { importerParityProblems } = await import('@/lib/acquisition/afl-api-adjudication');
    const proj = (externalId: string, overrides: Partial<Record<string, unknown>> = {}) => ({
      externalId, playerIdentity: 'a', status: 'unique' as const, candidateCount: 1,
      matchMethod: 'afl_api_stat_vector_bootstrap', externalName: null, externalUrl: null, notes: null,
      ...overrides,
    });
    expect(importerParityProblems({ captured: [proj('CD_I1')], live: [proj('CD_I1')] })).toEqual([]);
    // a missing row
    expect(importerParityProblems({ captured: [proj('CD_I1')], live: [] }))
      .toContainEqual({ kind: 'missing_row', externalId: 'CD_I1' });
    // an extra row
    expect(importerParityProblems({ captured: [], live: [proj('CD_I1')] }))
      .toContainEqual({ kind: 'extra_row', externalId: 'CD_I1' });
    // a retargeted identity
    expect(importerParityProblems({ captured: [proj('CD_I1')], live: [proj('CD_I1', { playerIdentity: 'b' })] }))
      .toContainEqual({ kind: 'retargeted_identity', externalId: 'CD_I1', captured: 'a', live: 'b' });
    // a changed method
    expect(importerParityProblems({ captured: [proj('CD_I1')], live: [proj('CD_I1', { matchMethod: 'afl_api_manual_adjudication' })] }))
      .toContainEqual({ kind: 'changed_method', externalId: 'CD_I1', captured: 'afl_api_stat_vector_bootstrap', live: 'afl_api_manual_adjudication' });
    // a changed notes value
    expect(importerParityProblems({ captured: [proj('CD_I1', { notes: 'x' })], live: [proj('CD_I1', { notes: 'y' })] }))
      .toContainEqual({ kind: 'changed_field', externalId: 'CD_I1', field: 'notes', captured: 'x', live: 'y' });
  });

  it('D15 supersede (OD-2) — the ONE new transition in planAflApiAdjudicationReplay', async () => {
    const {
      planAflApiAdjudicationReplay, AFL_API_ADMIN_MATCH_METHOD,
    } = await import('@/lib/acquisition/afl-api-adjudication');
    const IDENTITY = 'players/A/Alpha_Able.html';
    const linked = (externalId: string, playerIdentity = IDENTITY) => ({
      id: 1, externalId, action: 'linked' as const, playerId: 1, playerIdentity, supersedesId: null,
    });
    const remapTo = (newPlayerId: number, remappedIdentity = IDENTITY) => ({ ok: true as const, newPlayerId, remappedIdentity });
    const fullImporterRow = (
      externalId: string, playerId: number, overrides: Partial<AflApiCandidateIdentityRow> = {},
    ): AflApiCandidateIdentityRow => ({
      externalId, status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId,
      candidateCount: 1, externalUrl: null, ...overrides,
    });
    const plan = (candidate: AflApiCandidateIdentityRow, expectedSupersedes: Set<string>) => planAflApiAdjudicationReplay({
      ledgerRows: [linked('CD_I1')],
      remapByExternalId: new Map([['CD_I1', remapTo(907)]]),
      candidateByExternalId: new Map([[candidate.externalId, candidate]]),
      candidatePlayerAflApiRow: candidate.playerId === null
        ? new Map()
        : new Map([[candidate.playerId, candidate]]),
      expectedSupersedes,
    });

    // AGREE (same provider, same identity via the remap, same remapped player, full D5 row)
    // -> a supersede, not a STOP, when the provider is in the expected set.
    expect(plan(fullImporterRow('CD_I1', 907), new Set(['CD_I1'])))
      .toEqual({ inserts: [], noops: [], stops: [], supersedes: [{ externalId: 'CD_I1', playerId: 907 }] });

    // An otherwise-agreeing importer row is STILL a STOP when the caller's expected set does
    // not name it -- the replay never decides its own supersedes (D9).
    expect(plan(fullImporterRow('CD_I1', 907), new Set()).stops)
      .toEqual([{
        externalId: 'CD_I1',
        reason: 'an agreeing importer row exists for this provider but is not in the expected supersede set',
      }]);

    // Same provider, same player_id, but not a full D5 row (unsupported method) -> STOP, never
    // a supersede, even if named in the expected set.
    expect(plan(fullImporterRow('CD_I1', 907, { matchMethod: 'not_approved' }), new Set(['CD_I1'])).stops)
      .toEqual([{ externalId: 'CD_I1', reason: 'a conflicting external_identities row already exists for this provider id' }]);

    // candidate_count != 1 -> STOP
    expect(plan(fullImporterRow('CD_I1', 907, { candidateCount: 2 }), new Set(['CD_I1'])).stops)
      .toEqual([{ externalId: 'CD_I1', reason: 'a conflicting external_identities row already exists for this provider id' }]);

    // a non-NULL url -> STOP
    expect(plan(fullImporterRow('CD_I1', 907, { externalUrl: 'https://example.com' }), new Set(['CD_I1'])).stops)
      .toEqual([{ externalId: 'CD_I1', reason: 'a conflicting external_identities row already exists for this provider id' }]);

    // an importer row for a DIFFERENT player -> STOP (never treated as agreeing)
    expect(plan(fullImporterRow('CD_I1', 555), new Set(['CD_I1'])).stops)
      .toEqual([{ externalId: 'CD_I1', reason: 'a conflicting external_identities row already exists for this provider id' }]);

    // a non-identical human row -> STOP (unchanged ISSUE-235 behaviour)
    expect(plan({ externalId: 'CD_I1', status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId: 555 }, new Set(['CD_I1'])).stops)
      .toEqual([{ externalId: 'CD_I1', reason: 'a conflicting external_identities row already exists for this provider id' }]);

    // a superseded row satisfies the bijection: the caller writes exactly the row an INSERT
    // would create (resolved/afl_api_admin_adjudication under the SAME remapped player).
    const superseded = plan(fullImporterRow('CD_I1', 907), new Set(['CD_I1'])).supersedes[0];
    expect(superseded).toEqual({ externalId: 'CD_I1', playerId: 907 });

    // supersede never applies to a resolved row: an identical human row is a no-op, not a
    // supersede, even when the provider is named in the expected set.
    expect(planAflApiAdjudicationReplay({
      ledgerRows: [linked('CD_I1')],
      remapByExternalId: new Map([['CD_I1', remapTo(907)]]),
      candidateByExternalId: new Map([['CD_I1', { externalId: 'CD_I1', status: 'resolved', matchMethod: AFL_API_ADMIN_MATCH_METHOD, playerId: 907 }]]),
      candidatePlayerAflApiRow: new Map(),
      expectedSupersedes: new Set(['CD_I1']),
    })).toEqual({ inserts: [], noops: [{ externalId: 'CD_I1' }], stops: [], supersedes: [] });
  });

  it('aflApiAgrees — the six-condition agreement predicate: only all six together hold', async () => {
    const { aflApiAgrees } = await import('@/lib/acquisition/afl-api-adjudication');
    const importerRow = {
      status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', candidateCount: 1,
      externalUrl: null, playerId: 907, playerIdentity: 'a',
    };
    const ledgerEntry = { playerIdentity: 'a', effectiveState: 'LINKED' as const };
    const ledgerRemap = { ok: true as const, newPlayerId: 907, remappedIdentity: 'a' };

    expect(aflApiAgrees({ importerRow, ledgerEntry, ledgerRemap })).toBe(true);

    // each condition, violated alone, makes it false
    expect(aflApiAgrees({ importerRow: { ...importerRow, playerId: 555 }, ledgerEntry, ledgerRemap })).toBe(false); // different remapped player
    expect(aflApiAgrees({ importerRow: { ...importerRow, playerIdentity: 'b' }, ledgerEntry, ledgerRemap })).toBe(false); // identity differs by one value
    expect(aflApiAgrees({ importerRow: { ...importerRow, status: 'resolved' }, ledgerEntry, ledgerRemap })).toBe(false); // non-unique status
    expect(aflApiAgrees({ importerRow: { ...importerRow, matchMethod: 'not_approved' }, ledgerEntry, ledgerRemap })).toBe(false); // unapproved method
    expect(aflApiAgrees({ importerRow, ledgerEntry: { ...ledgerEntry, effectiveState: 'REVOKED' }, ledgerRemap })).toBe(false); // revoked latest action
    expect(aflApiAgrees({ importerRow, ledgerEntry, ledgerRemap: { ok: false, reason: 'unresolvable' } })).toBe(false); // remap to another/no player
    expect(aflApiAgrees({ importerRow: null, ledgerEntry, ledgerRemap })).toBe(false);
    expect(aflApiAgrees({ importerRow, ledgerEntry: null, ledgerRemap })).toBe(false);
  });

  it('E_rebuild — the shared check for Stage 2 and Stage 18 (D9 rebuild semantics)', async () => {
    const { computeAflApiAgreeingProviders } = await import('@/lib/acquisition/afl-api-adjudication');
    const linked = (externalId: string, playerIdentity: string) => ({
      id: 1, externalId, action: 'linked' as const, playerId: 1, playerIdentity, supersedesId: null,
    });
    const importerRow = (playerIdentity: string, playerId: number) => ({
      status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', candidateCount: 1,
      externalUrl: null, playerId, playerIdentity,
    });
    const remap = { ok: true as const, newPlayerId: 907, remappedIdentity: 'a' };

    // an accepted, non-overlapping capture -> E_rebuild = ∅
    expect(computeAflApiAgreeingProviders({
      ledgerRows: [linked('CD_I1', 'a')],
      importerByExternalId: new Map(),
      remapByExternalId: new Map([['CD_I1', remap]]),
    }).size).toBe(0);

    // a synthetic overlapping capture (an agreeing importer row plus a LINKED ledger entry for
    // the same provider) -> non-empty, named
    const agreeing = computeAflApiAgreeingProviders({
      ledgerRows: [linked('CD_I1', 'a')],
      importerByExternalId: new Map([['CD_I1', importerRow('a', 907)]]),
      remapByExternalId: new Map([['CD_I1', remap]]),
    });
    expect([...agreeing]).toEqual(['CD_I1']);
  });

  it('capturedOverlapProviders — Stage 18\'s independent E_rebuild recheck over the capture file alone (conditions 1-5, no database)', async () => {
    const { capturedOverlapProviders } = await import('@/lib/acquisition/afl-api-adjudication');
    const linked = (externalId: string, playerIdentity: string, action: 'linked' | 'revoked' = 'linked') => ({
      id: 1, externalId, action, playerId: 1, playerIdentity, supersedesId: action === 'revoked' ? 1 : null,
    });
    const importerRow = (externalId: string, playerIdentity: string) => ({
      externalId, playerIdentity, matchMethod: 'afl_api_stat_vector_bootstrap' as const,
      status: 'unique' as const, candidateCount: 1 as const, externalName: null, externalUrl: null,
      notes: null, playerId: 501,
    });

    // no overlap: different providers or a non-matching identity -> empty
    expect(capturedOverlapProviders({
      ledgerRows: [linked('CD_I1', 'a')], importerRows: [importerRow('CD_I2', 'b')],
    })).toEqual([]);
    expect(capturedOverlapProviders({
      ledgerRows: [linked('CD_I1', 'a')], importerRows: [importerRow('CD_I1', 'b')],
    })).toEqual([]);
    // a revoked (not net-linked) ledger row never overlaps, even with a matching importer row
    expect(capturedOverlapProviders({
      ledgerRows: [linked('CD_I1', 'a', 'revoked')], importerRows: [importerRow('CD_I1', 'a')],
    })).toEqual([]);
    // same provider, same identity, net-linked -> overlap, named, sorted
    expect(capturedOverlapProviders({
      ledgerRows: [linked('CD_I2', 'b'), linked('CD_I1', 'a')],
      importerRows: [importerRow('CD_I1', 'a'), importerRow('CD_I2', 'b')],
    })).toEqual(['CD_I1', 'CD_I2']);
    // only the LATEST action per provider counts (net): linked then revoked -> no overlap
    expect(capturedOverlapProviders({
      ledgerRows: [linked('CD_I1', 'a'), { ...linked('CD_I1', 'a', 'revoked'), id: 2 }],
      importerRows: [importerRow('CD_I1', 'a')],
    })).toEqual([]);
  });

  it('E_promotion — G2.AGREE, the non-empty exact-set semantics (D9 promotion)', async () => {
    const { aflApiSupersedeMismatch } = await import('@/lib/acquisition/afl-api-adjudication');
    // E_promotion empty, zero actual supersedes -> pass (no mismatch)
    expect(aflApiSupersedeMismatch({ expected: new Set(), actual: [] })).toEqual({ missing: [], extra: [] });
    // E_promotion empty, one actual supersede -> STOP (extra)
    expect(aflApiSupersedeMismatch({ expected: new Set(), actual: [{ externalId: 'CD_I1' }] }))
      .toEqual({ missing: [], extra: ['CD_I1'] });
    // E_promotion non-empty and equal to the actual set -> pass
    expect(aflApiSupersedeMismatch({ expected: new Set(['CD_I1']), actual: [{ externalId: 'CD_I1' }] }))
      .toEqual({ missing: [], extra: [] });
    // a provider missing from the actual set -> STOP
    expect(aflApiSupersedeMismatch({ expected: new Set(['CD_I1']), actual: [] }))
      .toEqual({ missing: ['CD_I1'], extra: [] });
    // an additional provider in the actual set -> STOP
    expect(aflApiSupersedeMismatch({ expected: new Set(['CD_I1']), actual: [{ externalId: 'CD_I1' }, { externalId: 'CD_I2' }] }))
      .toEqual({ missing: [], extra: ['CD_I2'] });
  });

  it('censusAflApiRows / classifyAflApiCensusRow — every D5 anomaly class', async () => {
    const { censusAflApiRows } = await import('@/lib/acquisition/afl-api-adjudication');
    const importerRow = { externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId: 1, candidateCount: 1, externalUrl: null };
    const humanRow = { externalId: 'CD_I2', status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: 2, candidateCount: 0, externalUrl: null };
    const clean = censusAflApiRows([importerRow, humanRow]);
    expect(clean.anomalies).toEqual([]);
    expect(clean.importerRows).toHaveLength(1);
    expect(clean.humanRows).toHaveLength(1);

    const anomalyCases = [
      { ...importerRow, playerId: null }, // NULL player
      { ...importerRow, matchMethod: 'not_approved' }, // unsupported method
      { ...importerRow, candidateCount: 2 }, // unexpected candidate_count
      { ...importerRow, externalUrl: 'https://example.com' }, // non-NULL url
      { ...humanRow, matchMethod: 'afl_api_stat_vector_bootstrap' }, // resolved under another method
      { externalId: 'CD_I3', status: 'pending', matchMethod: null, playerId: null, candidateCount: 0, externalUrl: null }, // unsupported status
      { ...humanRow, playerId: null }, // resolved with NULL player
    ];
    for (const row of anomalyCases) {
      expect(censusAflApiRows([row]).anomalies, JSON.stringify(row)).toHaveLength(1);
    }
  });

  it('classifyAflApiG2 — AGREE, DISAGREE, COLLISION, UNSUPPORTED, manual-token FAIL, revoked INFO', async () => {
    const { classifyAflApiG2 } = await import('@/lib/acquisition/afl-api-adjudication');
    const fullRow = (playerId: number) => ({
      status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', candidateCount: 1,
      externalUrl: null, playerId, playerIdentity: 'a',
    });
    const entry = (overrides: Partial<Parameters<typeof classifyAflApiG2>[0][number]>) => ({
      externalId: 'CD_I1', ledgerNetAction: 'linked' as const, identityIsManualToken: false,
      candidateRow: null, remappedCandidatePlayerId: null, collidingProviderId: null,
      ...overrides,
    });

    expect(classifyAflApiG2([entry({ candidateRow: fullRow(907), remappedCandidatePlayerId: 907 })]))
      .toEqual([{ externalId: 'CD_I1', outcome: 'AGREE' }]);
    expect(classifyAflApiG2([entry({ candidateRow: fullRow(907), remappedCandidatePlayerId: 555 })]))
      .toEqual([{ externalId: 'CD_I1', outcome: 'DISAGREE' }]);
    expect(classifyAflApiG2([entry({ collidingProviderId: 'CD_I9' })]))
      .toEqual([{ externalId: 'CD_I1', outcome: 'COLLISION', collidingProviderId: 'CD_I9' }]);
    expect(classifyAflApiG2([entry({ candidateRow: { ...fullRow(907), matchMethod: 'not_approved' }, remappedCandidatePlayerId: 907 })]))
      .toEqual([{ externalId: 'CD_I1', outcome: 'UNSUPPORTED' }]);
    expect(classifyAflApiG2([entry({ identityIsManualToken: true, candidateRow: fullRow(907), remappedCandidatePlayerId: 907 })]))
      .toEqual([{ externalId: 'CD_I1', outcome: 'UNEVALUABLE' }]);
    expect(classifyAflApiG2([entry({ ledgerNetAction: 'revoked', candidateRow: fullRow(907) })]))
      .toEqual([{ externalId: 'CD_I1', outcome: 'INFO_REVOKED_CANDIDATE' }]);
    // a revoked entry with no candidate row: nothing to report
    expect(classifyAflApiG2([entry({ ledgerNetAction: 'revoked', candidateRow: null })])).toEqual([]);
    // a net-linked entry with no candidate row at all: outside the table (ordinary D15 insert)
    expect(classifyAflApiG2([entry({ candidateRow: null })])).toEqual([]);
  });

  it('classifyAflApiG3 production — hard loss FAILs for every method, no WARN grade exists', async () => {
    const { classifyAflApiG3 } = await import('@/lib/acquisition/afl-api-adjudication');
    const target = (externalId: string, matchMethod: string) => ({ externalId, playerIdentity: 'a', matchMethod });

    for (const method of ['afl_api_stat_vector_bootstrap', 'afl_api_name_team_season_bootstrap', 'afl_api_manual_adjudication', 'afl_api_stat_vector_season']) {
      expect(classifyAflApiG3({ environment: 'production', targetRows: [target('CD_I1', method)], candidateRows: [] }))
        .toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'hard_loss' }]);
    }
    // method change -> FAIL in production
    expect(classifyAflApiG3({
      environment: 'production',
      targetRows: [target('CD_I1', 'afl_api_stat_vector_bootstrap')],
      candidateRows: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_manual_adjudication' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'method_changed' }]);
    // disagreement -> FAIL
    expect(classifyAflApiG3({
      environment: 'production',
      targetRows: [target('CD_I1', 'afl_api_stat_vector_bootstrap')],
      candidateRows: [{ externalId: 'CD_I1', playerIdentity: 'b', matchMethod: 'afl_api_stat_vector_bootstrap' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'disagreement' }]);
    // collision -> FAIL (plus the candidate's own provider is gained coverage, INFO)
    expect(classifyAflApiG3({
      environment: 'production',
      targetRows: [target('CD_I1', 'afl_api_stat_vector_bootstrap')],
      candidateRows: [{ externalId: 'CD_I9', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_bootstrap' }],
    })).toEqual([
      { externalId: 'CD_I1', outcome: 'FAIL', reason: 'collision' },
      { externalId: 'CD_I9', outcome: 'INFO', reason: 'gained_coverage' },
    ]);
    // gain -> INFO
    expect(classifyAflApiG3({
      environment: 'production', targetRows: [],
      candidateRows: [{ externalId: 'CD_I9', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_bootstrap' }],
    })).toEqual([{ externalId: 'CD_I9', outcome: 'INFO', reason: 'gained_coverage' }]);
    // same provider, same identity, same method -> PASS
    expect(classifyAflApiG3({
      environment: 'production',
      targetRows: [target('CD_I1', 'afl_api_stat_vector_bootstrap')],
      candidateRows: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_bootstrap' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'PASS' }]);
    // a classification file supplied under production is never consulted
    expect(classifyAflApiG3({
      environment: 'production', targetRows: [target('CD_I1', 'afl_api_stat_vector_season')], candidateRows: [],
      devRegenerationEntries: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'hard_loss' }]);
  });

  it('classifyAflApiG3 DEV — the narrow season-class regeneration exception, everything else as production', async () => {
    const { classifyAflApiG3 } = await import('@/lib/acquisition/afl-api-adjudication');
    const target = (externalId: string, matchMethod = 'afl_api_stat_vector_season') => ({ externalId, playerIdentity: 'a', matchMethod });

    // an unlisted loss -> FAIL
    expect(classifyAflApiG3({ environment: 'dev', targetRows: [target('CD_I1')], candidateRows: [] }))
      .toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'hard_loss' }]);
    // a listed season-class loss -> WARN
    expect(classifyAflApiG3({
      environment: 'dev', targetRows: [target('CD_I1')], candidateRows: [],
      devRegenerationEntries: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'WARN', reason: 'hard_loss_regeneration' }]);
    // a listed loss of another (non-eligible) class -> FAIL
    expect(classifyAflApiG3({
      environment: 'dev', targetRows: [target('CD_I1', 'afl_api_stat_vector_bootstrap')], candidateRows: [],
      devRegenerationEntries: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_bootstrap' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'hard_loss' }]);
    // a listed entry that does not match the target row -> not eligible, FAIL
    expect(classifyAflApiG3({
      environment: 'dev', targetRows: [target('CD_I1')], candidateRows: [],
      devRegenerationEntries: [{ externalId: 'CD_I1', playerIdentity: 'DIFFERENT', matchMethod: 'afl_api_stat_vector_season' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'hard_loss' }]);
    // a listed entry whose identity is actually held by ANOTHER candidate provider -- G3's own
    // "identity held elsewhere" collision row applies (never eligible for the WARN exception,
    // classification or no), and that same candidate row is also reported as gained coverage.
    expect(classifyAflApiG3({
      environment: 'dev', targetRows: [target('CD_I1')],
      candidateRows: [{ externalId: 'CD_I9', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }],
      devRegenerationEntries: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }],
    })).toEqual([
      { externalId: 'CD_I1', outcome: 'FAIL', reason: 'collision' },
      { externalId: 'CD_I9', outcome: 'INFO', reason: 'gained_coverage' },
    ]);
    // method change -> WARN on DEV (unlike production's FAIL)
    expect(classifyAflApiG3({
      environment: 'dev',
      targetRows: [target('CD_I1', 'afl_api_stat_vector_bootstrap')],
      candidateRows: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_manual_adjudication' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'WARN', reason: 'method_changed' }]);
  });

  it('validateAflApiDevRegenerationClassification — a stale or wrong classification entry refuses', async () => {
    const { validateAflApiDevRegenerationClassification } = await import('@/lib/acquisition/afl-api-adjudication');
    const targetRows = [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }];
    // a matching, eligible, absent, non-colliding entry -> clean
    expect(validateAflApiDevRegenerationClassification({
      entries: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }],
      targetRows, candidateRows: [],
    })).toEqual([]);
    // a tampered/stale entry that does not match the target row
    expect(validateAflApiDevRegenerationClassification({
      entries: [{ externalId: 'CD_I1', playerIdentity: 'WRONG', matchMethod: 'afl_api_stat_vector_season' }],
      targetRows, candidateRows: [],
    })).toEqual([{ kind: 'entry_does_not_match_target', externalId: 'CD_I1' }]);
    // a listed entry still present in the candidate
    expect(validateAflApiDevRegenerationClassification({
      entries: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }],
      targetRows, candidateRows: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }],
    })).toEqual([{ kind: 'entry_not_absent_from_candidate', externalId: 'CD_I1' }]);
  });

  it('classifyAflApiDevRegenerationCensus — the mandatory post-re-acquisition verification', async () => {
    const { classifyAflApiDevRegenerationCensus } = await import('@/lib/acquisition/afl-api-adjudication');
    const entries = [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season' }];
    // all regenerated -> PASS
    expect(classifyAflApiDevRegenerationCensus({
      entries, afterRows: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_season', status: 'unique' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'PASS' }]);
    // one absent -> FAIL
    expect(classifyAflApiDevRegenerationCensus({ entries, afterRows: [] }))
      .toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'absent' }]);
    // one under another identity -> FAIL
    expect(classifyAflApiDevRegenerationCensus({
      entries, afterRows: [{ externalId: 'CD_I1', playerIdentity: 'DIFFERENT', matchMethod: 'afl_api_stat_vector_season', status: 'unique' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'different_identity' }]);
    // one under another method -> FAIL
    expect(classifyAflApiDevRegenerationCensus({
      entries, afterRows: [{ externalId: 'CD_I1', playerIdentity: 'a', matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique' }],
    })).toEqual([{ externalId: 'CD_I1', outcome: 'FAIL', reason: 'different_method_or_status' }]);
  });

  it('classifyAflApiG1 — census anomaly, resolved row, ledger row, unresolved identity, multi-row player, marker present', async () => {
    const { classifyAflApiG1 } = await import('@/lib/acquisition/afl-api-adjudication');
    const importerRow = (externalId: string, playerId: number) => ({
      externalId, status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerId, candidateCount: 1, externalUrl: null,
    });
    const resolved: AflApiForwardIdentityResult = { ok: true, identity: 'a', via: 'afltables' };

    expect(classifyAflApiG1({
      rows: [importerRow('CD_I1', 1)], ledgerRowCount: 0,
      identityByPlayerId: new Map([[1, resolved]]), rebuildMarkerPresent: false,
    })).toEqual([]);
    expect(classifyAflApiG1({ rows: [], ledgerRowCount: 0, identityByPlayerId: new Map(), rebuildMarkerPresent: true }))
      .toContainEqual({ kind: 'rebuild_marker_present' });
    expect(classifyAflApiG1({ rows: [], ledgerRowCount: 3, identityByPlayerId: new Map(), rebuildMarkerPresent: false }))
      .toContainEqual({ kind: 'ledger_row_present', count: 3 });
    expect(classifyAflApiG1({
      rows: [{ externalId: 'CD_I1', status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: 1, candidateCount: 0, externalUrl: null }],
      ledgerRowCount: 0, identityByPlayerId: new Map(), rebuildMarkerPresent: false,
    })).toContainEqual({ kind: 'resolved_row_present', externalId: 'CD_I1' });
    expect(classifyAflApiG1({
      rows: [importerRow('CD_I1', 1)], ledgerRowCount: 0,
      identityByPlayerId: new Map(), rebuildMarkerPresent: false,
    })).toContainEqual({ kind: 'unresolved_identity', externalId: 'CD_I1', reason: 'no_identity' });
    expect(classifyAflApiG1({
      rows: [importerRow('CD_I1', 1), importerRow('CD_I2', 1)], ledgerRowCount: 0,
      identityByPlayerId: new Map([[1, resolved]]), rebuildMarkerPresent: false,
    })).toContainEqual({ kind: 'player_holds_multiple_rows', playerId: 1, externalIds: ['CD_I1', 'CD_I2'] });
  });

  it('AFLDB-ISSUE-237 F-L4-3 — classifyAflApiG1 boundLedger: the reinstated TARGET ledger passes only when it is exactly the bound one', async () => {
    const { classifyAflApiG1 } = await import('@/lib/acquisition/afl-api-adjudication');
    const base = { rows: [], identityByPlayerId: new Map(), rebuildMarkerPresent: false } as const;
    const sha = 'a'.repeat(64);
    // source (no boundLedger): any ledger row refuses, exactly as before
    expect(classifyAflApiG1({ ...base, ledgerRowCount: 2 })).toEqual([{ kind: 'ledger_row_present', count: 2 }]);
    // candidate (boundLedger): the bound ledger passes, any drift refuses
    expect(classifyAflApiG1({ ...base, ledgerRowCount: 2, boundLedger: { boundRowCount: 2, boundSha256: sha, actualSha256: sha } })).toEqual([]);
    for (const [ledgerRowCount, actualSha256] of [[1, sha], [3, sha], [2, 'b'.repeat(64)], [0, sha]] as const) {
      expect(classifyAflApiG1({ ...base, ledgerRowCount, boundLedger: { boundRowCount: 2, boundSha256: sha, actualSha256 } }))
        .toEqual([{ kind: 'ledger_not_bound_target_state', boundRowCount: 2, actualRowCount: ledgerRowCount, boundSha256: sha, actualSha256 }]);
    }
    // a bound EMPTY ledger is bound as strongly
    expect(classifyAflApiG1({ ...base, ledgerRowCount: 1, boundLedger: { boundRowCount: 0, boundSha256: sha, actualSha256: 'c'.repeat(64) } }))
      .toHaveLength(1);
    // resolved rows still refuse with a bound ledger: D15 has not run yet
    expect(classifyAflApiG1({
      ...base, rows: [{ externalId: 'CD_I1', status: 'resolved', matchMethod: 'afl_api_admin_adjudication', playerId: 1, candidateCount: 0, externalUrl: null }],
      ledgerRowCount: 0, boundLedger: { boundRowCount: 0, boundSha256: sha, actualSha256: sha },
    })).toContainEqual({ kind: 'resolved_row_present', externalId: 'CD_I1' });
  });

  it('AFLDB-ISSUE-237 F-L4-2 — classifyAflApiG2 grades an unresolvable/ambiguous ledger identity UNRESOLVED (refusing), never AGREE', async () => {
    const { classifyAflApiG2, aflApiG2AgreeSet, AFL_API_G2_REFUSING_OUTCOMES } = await import('@/lib/acquisition/afl-api-adjudication');
    const entry = { externalId: 'CD_I1', ledgerNetAction: 'linked' as const, identityIsManualToken: false, candidateRow: null,
      remappedCandidatePlayerId: null, collidingProviderId: null };
    for (const remapFailure of ['unresolvable', 'ambiguous'] as const) {
      const grades = classifyAflApiG2([{ ...entry, remapFailure }]);
      expect(grades).toEqual([{ externalId: 'CD_I1', outcome: 'UNRESOLVED', reason: remapFailure }]);
      expect(AFL_API_G2_REFUSING_OUTCOMES.has(grades[0].outcome)).toBe(true);
      expect(aflApiG2AgreeSet(grades).size).toBe(0);
    }
    // omitted = the pre-fix caller: no grade for the INSERT case, unchanged
    expect(classifyAflApiG2([entry])).toEqual([]);
    // a revoked entry is never UNRESOLVED
    expect(classifyAflApiG2([{ ...entry, ledgerNetAction: 'revoked', remapFailure: 'unresolvable' }])).toEqual([]);
    for (const outcome of ['AGREE', 'INFO_REVOKED_CANDIDATE'] as const) expect(AFL_API_G2_REFUSING_OUTCOMES.has(outcome)).toBe(false);
  });

  it('AFLDB-ISSUE-237 F-L4-4 — state digests: stable fields only, order-independent, bigint-as-string safe', async () => {
    const { aflApiImporterStateSha256, aflApiLedgerStateSha256 } = await import('@/lib/acquisition/afl-api-adjudication');
    const rows = [
      { externalId: 'CD_I2', status: 'unique', matchMethod: 'afl_api_stat_vector_season', playerIdentity: 'players/B/B.html' },
      { externalId: 'CD_I1', status: 'unique', matchMethod: 'afl_api_stat_vector_bootstrap', playerIdentity: null },
    ];
    expect(aflApiImporterStateSha256(rows)).toBe(aflApiImporterStateSha256([...rows].reverse()));
    expect(aflApiImporterStateSha256(rows)).not.toBe(aflApiImporterStateSha256([{ ...rows[0], playerIdentity: 'players/C/C.html' }, rows[1]]));
    expect(() => aflApiImporterStateSha256([rows[0], rows[0]])).toThrow(/appears twice/);

    const ledger = [
      { id: 7, externalId: 'CD_I1', action: 'linked' as const, playerId: 900, playerIdentity: 'players/A/A.html', supersedesId: null },
      { id: 9, externalId: 'CD_I1', action: 'revoked' as const, playerId: 900, playerIdentity: 'players/A/A.html', supersedesId: 7 },
    ];
    const sha = aflApiLedgerStateSha256(ledger);
    // player_id is remapped by the promotion reinstatement, so it is not part of the digest
    expect(aflApiLedgerStateSha256(ledger.map((r) => ({ ...r, playerId: 10 })))).toBe(sha);
    // postgres.js returns bigint id/supersedes_id as strings: the same ledger hashes the same
    expect(aflApiLedgerStateSha256(ledger.map((r) => ({ ...r, id: String(r.id), supersedesId: r.supersedesId === null ? null : String(r.supersedesId) })) as never)).toBe(sha);
    expect(aflApiLedgerStateSha256([...ledger].reverse())).toBe(sha);
    expect(aflApiLedgerStateSha256([ledger[0]])).not.toBe(sha);
    expect(aflApiLedgerStateSha256([{ ...ledger[0], action: 'revoked' }, ledger[1]])).not.toBe(sha);
    expect(() => aflApiLedgerStateSha256([ledger[0], ledger[0]])).toThrow(/appears twice/);
  });

  it('aflApiRebuildIdentityRefusalReason — D7\'s rebuild-only manual-token refusal', async () => {
    const { aflApiRebuildIdentityRefusalReason } = await import('@/lib/acquisition/afl-api-adjudication');
    expect(aflApiRebuildIdentityRefusalReason({ ok: true, identity: 'a', via: 'afltables' })).toBeNull();
    expect(aflApiRebuildIdentityRefusalReason({ ok: true, identity: 'tok', via: 'manual_admin_edit' }))
      .toContain('manual_admin_edit token');
    expect(aflApiRebuildIdentityRefusalReason({ ok: false, reason: 'ambiguous' })).toContain('more than one');
    expect(aflApiRebuildIdentityRefusalReason({ ok: false, reason: 'no_identity' })).toContain('no accepted stable identity');
  });

  /*
   * Continuity amendment (operator-approved 2026-09-25): exactly one tracked
   * profile_url_continuity pair resolves to the rule's continuing_url; every other multi-path
   * case stays ambiguous. The rules come only from the validated fitzRoy contract.
   */
  describe('continuity amendment — classifyAflApiForwardIdentity and the fitzRoy contract parser', () => {
    const ruleJson = (over: Record<string, unknown> = {}) => ({
      id: 'test-renumbered-profile', dataset: 'player_stats', file: 'player_stats_2025.csv',
      continuing_url: 'players/Q/Quinn_Test.html', renumbered_url: 'players/Q/Quinn_Test2.html',
      expect: {
        continuing_id: '99001', continuing_last_season: 2024, continuing_last_career_game: 10,
        renumbered_first_season: 2025, renumbered_last_season: 2025, renumbered_first_career_game: 11,
        renumbered_rows: 3,
      },
      authority: 'test authority', reason: 'test reason', ...over,
    });
    const contractOf = (...rules: unknown[]) => ({ profile_url_continuity: { rules } });
    const load = async () => {
      const adjudication = await import('@/lib/acquisition/afl-api-adjudication');
      const continuity = await import('@/lib/acquisition/fitzroy-profile-continuity');
      const rules = continuity.parseFitzroyProfileContinuityRules(contractOf(ruleJson()));
      const classify = (afltablesPaths: string[], manualIdentities: string[] = [], continuityRules = rules) =>
        adjudication.classifyAflApiForwardIdentity({ afltablesPaths, manualIdentities, continuityRules });
      return { ...adjudication, ...continuity, rules, classify };
    };
    const CONT = 'players/Q/Quinn_Test.html';
    const RENUM = 'players/Q/Quinn_Test2.html';
    const OTHER = 'players/Z/Unrelated_Profile.html';

    it('one path is unchanged; the exact pair resolves to continuing_url in either order', async () => {
      const { classify } = await load();
      expect(classify([OTHER])).toEqual({ ok: true, identity: OTHER, via: 'afltables' });
      expect(classify([CONT, RENUM])).toEqual({ ok: true, identity: CONT, via: 'afltables' });
      expect(classify([RENUM, CONT])).toEqual({ ok: true, identity: CONT, via: 'afltables' });
      expect(classify([RENUM, CONT, RENUM])).toEqual({ ok: true, identity: CONT, via: 'afltables' }); // duplicates collapse
    });

    it('every non-exact multi-path case stays ambiguous', async () => {
      const { classify } = await load();
      const ambiguous = { ok: false, reason: 'ambiguous' };
      expect(classify([CONT, OTHER])).toEqual(ambiguous);
      expect(classify([RENUM, OTHER])).toEqual(ambiguous);
      expect(classify([CONT, RENUM, OTHER])).toEqual(ambiguous);
      expect(classify(['players/A/Alpha_One.html', 'players/A/Alpha_One2.html'])).toEqual(ambiguous); // no rule names them
      expect(classify([CONT, RENUM], [], [] as never)).toEqual(ambiguous); // no rules loaded -> no exception
    });

    it('the continuing path is chosen by the rule, never by sort order', async () => {
      const { parseFitzroyProfileContinuityRules, classify } = await load();
      // continuing_url sorts AFTER renumbered_url, so a lexicographic pick would return the wrong one
      const rules = parseFitzroyProfileContinuityRules(contractOf(ruleJson({
        continuing_url: 'players/Z/Zed_Zulu9.html', renumbered_url: 'players/A/Zed_Zulu.html',
      })));
      expect(['players/A/Zed_Zulu.html', 'players/Z/Zed_Zulu9.html'].sort()[0]).toBe('players/A/Zed_Zulu.html');
      for (const order of [['players/A/Zed_Zulu.html', 'players/Z/Zed_Zulu9.html'], ['players/Z/Zed_Zulu9.html', 'players/A/Zed_Zulu.html']]) {
        expect(classify(order, [], rules)).toEqual({ ok: true, identity: 'players/Z/Zed_Zulu9.html', via: 'afltables' });
      }
    });

    it('manual-admin semantics are unchanged, and an exact pair keeps AFL Tables precedence over a token', async () => {
      const { classify } = await load();
      expect(classify([CONT, RENUM], ['tok-1'])).toEqual({ ok: true, identity: CONT, via: 'afltables' });
      expect(classify([OTHER], ['tok-1'])).toEqual({ ok: true, identity: OTHER, via: 'afltables' });
      expect(classify([], ['tok-1'])).toEqual({ ok: true, identity: 'tok-1', via: 'manual_admin_edit' });
      expect(classify([], ['tok-1', 'tok-2'])).toEqual({ ok: false, reason: 'ambiguous' });
      expect(classify([], [])).toEqual({ ok: false, reason: 'no_identity' });
      // a non-exact pair is NOT rescued by a manual token: AFL Tables ambiguity still wins
      expect(classify([CONT, OTHER], ['tok-1'])).toEqual({ ok: false, reason: 'ambiguous' });
    });

    it('classifyAflApiForwardIdentityRows groups per player and reports a player with no row as no_identity', async () => {
      const { classifyAflApiForwardIdentityRows, rules } = await load();
      const result = classifyAflApiForwardIdentityRows({
        playerIds: [1, 2, 3, 4],
        rows: [
          { playerId: 1, externalId: RENUM, sourceKey: 'afltables' },
          { playerId: 1, externalId: CONT, sourceKey: 'afltables' },
          { playerId: 2, externalId: CONT, sourceKey: 'afltables' },
          { playerId: 2, externalId: OTHER, sourceKey: 'afltables' },
          { playerId: 3, externalId: 'tok-3', sourceKey: 'manual_admin_edit' },
        ],
        continuityRules: rules,
      });
      expect([...result.entries()]).toEqual([
        [1, { ok: true, identity: CONT, via: 'afltables' }],
        [2, { ok: false, reason: 'ambiguous' }],
        [3, { ok: true, identity: 'tok-3', via: 'manual_admin_edit' }],
        [4, { ok: false, reason: 'no_identity' }],
      ]);
    });

    it('the real tracked contract parses, and each of its rules folds to that rule\'s own continuing_url', async () => {
      const { loadFitzroyProfileContinuityRules, classify } = await load();
      const real = loadFitzroyProfileContinuityRules();
      expect(real.length).toBeGreaterThan(0);
      for (const rule of real) {
        expect(classify([rule.renumberedUrl, rule.continuingUrl], [], real))
          .toEqual({ ok: true, identity: rule.continuingUrl, via: 'afltables' });
      }
    });

    it('an unreadable, non-JSON or non-object contract fails closed', async () => {
      const { loadFitzroyProfileContinuityRules, parseFitzroyProfileContinuityRules, FitzroyProfileContinuityContractError } = await load();
      const dir = mkdtempSync(join(tmpdir(), 'afldb-i237-continuity-'));
      try {
        expect(() => loadFitzroyProfileContinuityRules(join(dir, 'missing.json'))).toThrow(FitzroyProfileContinuityContractError);
        expect(() => loadFitzroyProfileContinuityRules(join(dir, 'missing.json'))).toThrow(/could not be read/);
        writeFileSync(join(dir, 'bad.json'), '{"profile_url_continuity": ');
        expect(() => loadFitzroyProfileContinuityRules(join(dir, 'bad.json'))).toThrow(/not valid JSON/);
        writeFileSync(join(dir, 'ok.json'), JSON.stringify(contractOf(ruleJson())));
        expect(loadFitzroyProfileContinuityRules(join(dir, 'ok.json')).map((r) => r.continuingUrl)).toEqual([CONT]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      for (const bad of [null, [], 'x', { profile_url_continuity: [] }, { profile_url_continuity: { rules: {} } }]) {
        expect(() => parseFitzroyProfileContinuityRules(bad), JSON.stringify(bad)).toThrow(FitzroyProfileContinuityContractError);
      }
    });

    it('duplicate, self-mapping, chained or otherwise invalid rules refuse the WHOLE contract', async () => {
      const { parseFitzroyProfileContinuityRules } = await load();
      const expectOf = (over: Record<string, unknown>) => ({ ...ruleJson().expect, ...over });
      const cases: [string, unknown[], RegExp][] = [
        ['duplicate id', [ruleJson(), ruleJson({ renumbered_url: 'players/Q/Quinn_Test3.html' })], /id must be a unique/],
        ['duplicate renumbered path', [ruleJson(), ruleJson({ id: 'b', continuing_url: 'players/Q/Quinn_Other.html' })], /named by more than one rule/],
        ['self mapping', [ruleJson({ renumbered_url: CONT })], /are the same path/],
        ['chain', [ruleJson(), ruleJson({ id: 'b', continuing_url: RENUM, renumbered_url: 'players/Q/Quinn_Test3.html' })], /chains are not inferred/],
        ['un-normalised path', [ruleJson({ renumbered_url: 'https://afltables.com/afl/stats/players/Q/Quinn_Test2.html' })], /normalised profile path/],
        ['wrong dataset', [ruleJson({ dataset: 'results' })], /dataset must be 'player_stats'/],
        ['bad file', [ruleJson({ file: 'player_stats.csv' })], /file must name/],
        ['file season mismatch', [ruleJson({ file: 'player_stats_2024.csv' })], /file must be the artefact/],
        ['missing expect', [ruleJson({ expect: undefined })], /expect must be an object/],
        ['missing expect key', [ruleJson({ expect: { continuing_id: '1' } })], /expect lacks/],
        ['blank continuing id', [ruleJson({ expect: expectOf({ continuing_id: ' ' }) })], /continuing_id must be/],
        ['non-integer fact', [ruleJson({ expect: expectOf({ renumbered_rows: '3' }) })], /non-negative integer/],
        ['boolean fact', [ruleJson({ expect: expectOf({ renumbered_rows: true }) })], /non-negative integer/],
        ['overlapping seasons', [ruleJson({ expect: expectOf({ continuing_last_season: 2025 }) })], /may never overlap/],
        ['career game gap', [ruleJson({ expect: expectOf({ renumbered_first_career_game: 12 }) })], /exactly continuing_last_career_game \+ 1/],
        ['zero rows', [ruleJson({ expect: expectOf({ renumbered_rows: 0 }) })], /at least 1/],
        ['reversed renumbered seasons', [ruleJson({ expect: expectOf({ renumbered_last_season: 2024, continuing_last_season: 2023 }) })], /precedes renumbered_first_season/],
        ['blank authority', [ruleJson({ authority: '' })], /authority must be a non-empty string/],
        ['non-object rule', ['players/Q/Quinn_Test.html'], /a rule must be an object/],
      ];
      for (const [name, rules, message] of cases) {
        expect(() => parseFitzroyProfileContinuityRules(contractOf(...rules)), name).toThrow(message);
      }
      // a valid rule alongside an invalid one does not survive: the contract refuses as a whole
      expect(() => parseFitzroyProfileContinuityRules(contractOf(ruleJson(), ruleJson({ id: 'b', renumbered_url: 'bad' }))))
        .toThrow(/normalised profile path/);
    });

    /*
     * Reverse direction (identity -> target player): a tracked rule asserts its two paths are
     * one footballer, so an identity the rule names resolves only when the target holds BOTH
     * paths on the SAME single player. Every other target state refuses — never a fallback to
     * the identity's own path alone.
     */
    describe('continuity amendment — classifyAflApiReverseIdentity (target must prove the pair)', () => {
      const reverse = async (identity: string, byPath: Record<string, number[]>) => {
        const { classifyAflApiReverseIdentity, rules } = await load();
        return classifyAflApiReverseIdentity({
          identity, playerIdsByPath: new Map(Object.entries(byPath)), continuityRules: rules,
        });
      };
      const contradiction = (refusal: string, continuingPlayerIds: number[], renumberedPlayerIds: number[]) => ({
        ok: false, reason: 'continuity_contradiction', ruleId: 'test-renumbered-profile', refusal,
        continuingPlayerIds, renumberedPlayerIds,
      });

      it('(1) the exact pair folded onto one target player resolves, from either path of the rule', async () => {
        expect(await reverse(CONT, { [CONT]: [7], [RENUM]: [7] }))
          .toEqual({ ok: true, newPlayerId: 7, remappedIdentity: CONT });
        expect(await reverse(RENUM, { [CONT]: [7], [RENUM]: [7] }))
          .toEqual({ ok: true, newPlayerId: 7, remappedIdentity: RENUM });
        // duplicate rows for one player collapse
        expect(await reverse(CONT, { [CONT]: [7, 7], [RENUM]: [7] }))
          .toEqual({ ok: true, newPlayerId: 7, remappedIdentity: CONT });
      });

      it('(2) continuing on player A and renumbered on player B is a split — STOP, never A alone', async () => {
        expect(await reverse(CONT, { [CONT]: [7], [RENUM]: [8] })).toEqual(contradiction('split', [7], [8]));
        expect(await reverse(RENUM, { [CONT]: [7], [RENUM]: [8] })).toEqual(contradiction('split', [7], [8]));
      });

      it('(3)/(4) a missing continuing or renumbered path — STOP', async () => {
        expect(await reverse(CONT, { [RENUM]: [7] })).toEqual(contradiction('continuing_missing', [], [7]));
        expect(await reverse(CONT, { [CONT]: [7] })).toEqual(contradiction('renumbered_missing', [7], []));
        expect(await reverse(RENUM, { [RENUM]: [7] })).toEqual(contradiction('continuing_missing', [], [7]));
        expect(await reverse(CONT, {})).toEqual(contradiction('continuing_missing', [], []));
      });

      it('(5)/(6) an ambiguous continuing or renumbered path — STOP', async () => {
        expect(await reverse(CONT, { [CONT]: [8, 7], [RENUM]: [7] }))
          .toEqual(contradiction('continuing_ambiguous', [7, 8], [7]));
        expect(await reverse(CONT, { [CONT]: [7], [RENUM]: [7, 9] }))
          .toEqual(contradiction('renumbered_ambiguous', [7], [7, 9]));
      });

      it('(7) an identity no tracked rule names is unchanged: one -> it, none -> unresolvable, several -> ambiguous', async () => {
        expect(await reverse(OTHER, { [OTHER]: [3] })).toEqual({ ok: true, newPlayerId: 3, remappedIdentity: OTHER });
        expect(await reverse(OTHER, {})).toEqual({ ok: false, reason: 'unresolvable' });
        expect(await reverse(OTHER, { [OTHER]: [3, 4] })).toEqual({ ok: false, reason: 'ambiguous' });
        // a split pair elsewhere on the target never touches an unrelated identity
        expect(await reverse(OTHER, { [OTHER]: [3], [CONT]: [7], [RENUM]: [8] }))
          .toEqual({ ok: true, newPlayerId: 3, remappedIdentity: OTHER });
        // with no rules loaded, a would-be continuity path is an ordinary single path
        const { classifyAflApiReverseIdentity } = await load();
        expect(classifyAflApiReverseIdentity({
          identity: CONT, playerIdsByPath: new Map([[CONT, [7]], [RENUM, [8]]]), continuityRules: [] as never,
        })).toEqual({ ok: true, newPlayerId: 7, remappedIdentity: CONT });
      });

      it('(8) the exact SOURCE pair still normalises to continuing_url, and that identity round-trips to the folded target player', async () => {
        const { classify, classifyAflApiReverseIdentity, rules } = await load();
        const forward = classify([RENUM, CONT]);
        expect(forward).toEqual({ ok: true, identity: CONT, via: 'afltables' });
        expect(classifyAflApiReverseIdentity({
          identity: (forward as { identity: string }).identity,
          playerIdsByPath: new Map([[CONT, [42]], [RENUM, [42]]]), continuityRules: rules,
        })).toEqual({ ok: true, newPlayerId: 42, remappedIdentity: CONT });
      });

      it('aflApiReverseIdentityPaths names exactly the identity plus both paths of each rule naming it', async () => {
        const { aflApiReverseIdentityPaths, rules } = await load();
        expect(aflApiReverseIdentityPaths(OTHER, rules)).toEqual([OTHER]);
        expect(aflApiReverseIdentityPaths(CONT, rules)).toEqual([CONT, RENUM]);
        expect(aflApiReverseIdentityPaths(RENUM, rules)).toEqual([RENUM, CONT]);
      });

      it('two rules sharing a continuing path must land on the same single player', async () => {
        const { parseFitzroyProfileContinuityRules, classifyAflApiReverseIdentity } = await load();
        const RENUM3 = 'players/Q/Quinn_Test3.html';
        const two = parseFitzroyProfileContinuityRules(contractOf(ruleJson(), ruleJson({ id: 'b', renumbered_url: RENUM3 })));
        const run = (byPath: [string, number[]][]) => classifyAflApiReverseIdentity({
          identity: CONT, playerIdsByPath: new Map(byPath), continuityRules: two,
        });
        expect(run([[CONT, [7]], [RENUM, [7]], [RENUM3, [7]]])).toEqual({ ok: true, newPlayerId: 7, remappedIdentity: CONT });
        expect(run([[CONT, [7]], [RENUM, [7]], [RENUM3, [8]]])).toMatchObject({ ok: false, ruleId: 'b', refusal: 'split' });
      });

      it('every real tracked rule: folded target resolves, split target refuses', async () => {
        const { classifyAflApiReverseIdentity, loadFitzroyProfileContinuityRules } = await load();
        const real = loadFitzroyProfileContinuityRules();
        for (const rule of real) {
          const folded = new Map([[rule.continuingUrl, [1]], [rule.renumberedUrl, [1]]]);
          const split = new Map([[rule.continuingUrl, [1]], [rule.renumberedUrl, [2]]]);
          expect(classifyAflApiReverseIdentity({ identity: rule.continuingUrl, playerIdsByPath: folded, continuityRules: real }))
            .toEqual({ ok: true, newPlayerId: 1, remappedIdentity: rule.continuingUrl });
          expect(classifyAflApiReverseIdentity({ identity: rule.continuingUrl, playerIdsByPath: split, continuityRules: real }))
            .toMatchObject({ ok: false, reason: 'continuity_contradiction', ruleId: rule.id, refusal: 'split' });
        }
      });

      it('both replay planners STOP a contradicted identity with the shared wording, and G2 grades it CONTINUITY_CONTRADICTION', async () => {
        const {
          classifyAflApiReverseIdentity, planAflApiImporterReplay, planAflApiAdjudicationReplay, classifyAflApiG2, rules,
        } = await load();
        const remap = classifyAflApiReverseIdentity({
          identity: CONT, playerIdsByPath: new Map([[CONT, [7]], [RENUM, [8]]]), continuityRules: rules,
        });
        const importer = planAflApiImporterReplay({
          capturedRows: [{
            externalId: 'CD_I1', playerIdentity: CONT, matchMethod: 'afl_api_stat_vector_bootstrap', status: 'unique',
            candidateCount: 1, externalName: null, externalUrl: null, notes: null, playerId: 1,
          }],
          remapByExternalId: new Map([['CD_I1', remap]]),
          candidateByExternalId: new Map(), candidatePlayerAflApiRow: new Map(),
        });
        expect(importer.inserts).toEqual([]);
        expect(importer.stops).toEqual([{
          externalId: 'CD_I1',
          reason: 'the captured row\'s player identity is named by tracked profile_url_continuity rule '
            + 'test-renumbered-profile and the target contradicts it: its continuing_url and renumbered_url '
            + 'resolve to different target players (continuing -> [7], renumbered -> [8])',
        }]);
        const ledger = planAflApiAdjudicationReplay({
          ledgerRows: [{ id: 1, externalId: 'CD_I1', action: 'linked', playerId: 1, playerIdentity: CONT, supersedesId: null }],
          remapByExternalId: new Map([['CD_I1', remap]]),
          candidateByExternalId: new Map(), candidatePlayerAflApiRow: new Map(),
        });
        expect(ledger.inserts).toEqual([]);
        expect(ledger.stops[0].reason).toMatch(/^the ledger row's player_identity is named by tracked profile_url_continuity rule test-renumbered-profile .*different target players/);
        // G2 refuses even with NO candidate importer row for the provider (the D15 INSERT case)
        const grades = classifyAflApiG2([{
          externalId: 'CD_I1', ledgerNetAction: 'linked', identityIsManualToken: false, candidateRow: null,
          remappedCandidatePlayerId: null, collidingProviderId: null,
          continuityContradiction: remap as Extract<typeof remap, { reason: 'continuity_contradiction' }>,
        }]);
        expect(grades).toEqual([{
          externalId: 'CD_I1', outcome: 'CONTINUITY_CONTRADICTION',
          reason: expect.stringContaining('rule test-renumbered-profile and the target contradicts it'),
        }]);
      });
    });
  });
});

/**
 * AFLDB-ISSUE-235 §10.1 A5, A10, A12 — order-of-operations and premise pins against the
 * query module's own source, the same style `tests/player-link-mutations.test.ts` already
 * uses for `players.ts`/`common.py` (line ~547). Preferred here over a hand-built fake `tx`
 * that would have to correctly answer a dozen distinct query shapes: a source-order
 * assertion is exactly as strong a pin on the CONTRACT ("lock, then re-read, then write, in
 * this order") without the fragility of guessing every SQL fragment a fake cursor must
 * recognise.
 */
describe('AFLDB-ISSUE-235: afl-api-player-links.ts (order of operations, DB-free)', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'db', 'queries', 'afl-api-player-links.ts'), 'utf8',
  );

  it('S8 regression — admin-only detail reads use authSql while mutation reads stay on tx', () => {
    const detailStart = source.indexOf('export async function readAflApiProviderEvidence');
    const historyStart = source.indexOf('export type AflApiAdjudicationHistoryRow');
    const writesStart = source.indexOf('export async function linkAflApiProvider');

    expect(detailStart).toBeGreaterThanOrEqual(0);
    expect(historyStart).toBeGreaterThan(detailStart);
    expect(writesStart).toBeGreaterThan(historyStart);

    const detail = source.slice(detailStart, historyStart);
    expect(detail).toContain('readPendingCandidates(authSql, sourceId, providerId)');
    expect(detail).toContain('readLatestAdjudicationId(authSql, providerId)');
    expect(detail).not.toContain('readPendingCandidates(sql, sourceId, providerId)');
    expect(detail).not.toContain('readLatestAdjudicationId(sql, providerId)');

    const history = source.slice(historyStart, writesStart);
    expect(history).toContain('const rows = await authSql<AflApiAdjudicationHistoryRow[]>`');
    expect(history).not.toContain('const rows = await sql<AflApiAdjudicationHistoryRow[]>`');

    const link = source.slice(
      source.indexOf('export async function linkAflApiProvider'),
      source.indexOf('export type RevokeAflApiLinkInput'),
    );
    expect(link).toContain('readPendingCandidates(tx, sourceId, input.providerId)');
    expect(link).toContain('readLatestAdjudicationId(tx, input.providerId)');

    const revoke = source.slice(source.indexOf('export async function revokeAflApiLink'));
    expect(revoke).toContain('readPendingCandidates(tx, sourceId, input.providerId)');
    expect(revoke).toContain('readLatestAdjudicationId(tx, input.providerId)');
  });

  it('S8 V3 regression — settled provider evidence uses current spine heads without weakening pending evidence', () => {
    const detailStart = source.indexOf('export async function readAflApiProviderEvidence');
    const historyStart = source.indexOf('export type AflApiAdjudicationHistoryRow');
    const detail = source.slice(detailStart, historyStart);

    expect(detail).toContain('const hasPendingEvidence = pendingCandidates.length > 0;');
    expect(detail).toContain('const payloadRows = hasPendingEvidence');

    const pendingSqlStart = detail.indexOf('? await sql<AflApiProviderPayloadRow[]>`');
    const settledSqlStart = detail.indexOf(': await sql<AflApiProviderPayloadRow[]>`');
    const settledSqlEnd = detail.indexOf('`;', settledSqlStart);
    expect(pendingSqlStart).toBeGreaterThanOrEqual(0);
    expect(settledSqlStart).toBeGreaterThan(pendingSqlStart);
    expect(settledSqlEnd).toBeGreaterThan(settledSqlStart);
    const pendingSql = detail.slice(pendingSqlStart, settledSqlStart);
    const settledSql = detail.slice(settledSqlStart, settledSqlEnd);

    // Actionable U1 evidence remains tied to the exact pending promotion-candidate versions.
    expect(pendingSql).toContain('FROM promotion_candidates c');
    expect(pendingSql).toContain("c.status = 'pending'");
    expect(pendingSql).toContain('v.version_seq = c.source_version_seq');
    expect(pendingSql).toContain('NULL::text AS "projectedMatchKey"');
    expect(pendingSql).toContain('NULL::integer AS "projectedClubId"');

    // Settled L-I/L-H display evidence uses only the durable current observation head,
    // joined to the projection row of that SAME current version.
    expect(settledSql).toContain('FROM staging.source_records r');
    expect(settledSql).toContain('v.version_seq = r.current_version_seq');
    expect(settledSql).toContain('JOIN staging.afl_api_player_match pm');
    expect(settledSql).toContain('pm.version_seq = r.current_version_seq');
    expect(settledSql).toContain("r.family = 'player_match_stats'");
    expect(settledSql).toContain('pm.match_key AS "projectedMatchKey"');
    expect(settledSql).toContain('pm.club_id AS "projectedClubId"');
    // The projection supplies match/club context only -- never the player identity
    // the bridge rule must recompute. (The safety COMMENT naming pm.player_id sits
    // outside this SQL slice, so this is checked against the SQL alone.)
    expect(settledSql).not.toMatch(/pm\.player_id/);
    expect(settledSql).not.toMatch(/\bplayer_id\b/);
    expect(detail).not.toMatch(/pm\.player_id\s+AS\b/);

    // Settled match resolution is by canonical matches.match_key, not staging.afl_api_match.
    expect(detail).toContain('FROM matches');
    expect(detail).toContain('WHERE match_key = ANY(${projectedMatchKeys})');
    expect(detail).toContain('canonicalIdByMatchKey.get(row.projectedMatchKey) ?? null');

    // Pending CD_T resolution follows ISSUE-228 §6.2: tracked identity map -> legacy_club_hist.
    expect(source).toContain("import aflApiIdentitiesJson from '../../../data/reference/afl-api-identities.json';");
    expect(source).toContain('const AFL_API_IDENTITIES = parseAflApiIdentities(aflApiIdentitiesJson);');
    expect(detail).toContain('AFL_API_IDENTITIES.teams.get(providerTeamId)?.hist ?? null');
    expect(detail).toContain('WHERE legacy_club_hist = ANY(${declaredHists})');

    // Provider evidence rows: pending -> §6.2 map, settled -> projected club id.
    expect(detail).toMatch(
      /const clubId = hasPendingEvidence\s+\? \(providerTeamId \? pendingProviderTeamClubIds\.get\(providerTeamId\) \?\? null : null\)\s+: r\.projectedClubId;/,
    );
    expect(detail).not.toContain('clubId: null');
  });
  it('A5 — linkAflApiProvider: locks, re-reads, INSERT external_identities (resolved/afl_api_admin_adjudication), then the audit INSERT', () => {
    const fn = source.slice(source.indexOf('export async function linkAflApiProvider'));
    const at = (needle: string, from = 0) => {
      const i = fn.indexOf(needle, from);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const lockProvider = at('await takeIdentityLocks(tx, input.providerId, input.playerId)');
    const insertIdentity = at('INSERT INTO external_identities', lockProvider);
    const insertAudit = at('INSERT INTO afl_api_identity_adjudications', insertIdentity);
    expect(insertIdentity).toBeGreaterThan(lockProvider);
    expect(insertAudit).toBeGreaterThan(insertIdentity);
    // The identity row is written 'resolved' / afl_api_admin_adjudication -- the only pair
    // this issue ever writes (D1, D8) -- never the loader's 'unique'.
    const insertBlock = fn.slice(insertIdentity, insertAudit);
    expect(insertBlock).toContain("'resolved'");
    expect(insertBlock).toContain('AFL_API_ADMIN_MATCH_METHOD');
    // takeIdentityLocks() itself locks the provider before the player (D7's fixed order).
    const lockFn = source.slice(source.indexOf('async function takeIdentityLocks'));
    const providerLock = lockFn.indexOf('providerLockKey');
    const playerLock = lockFn.indexOf('playerLockKey');
    expect(providerLock).toBeGreaterThanOrEqual(0);
    expect(playerLock).toBeGreaterThan(providerLock);
  });

  it('I7 live finding — a link against an L-I/L-H row keeps its T2/T3 code even when the surname disagrees', async () => {
    const { decideAflApiLink } = await import('@/lib/acquisition/afl-api-adjudication');
    // The I7 condition: importer-linked (L-I) row, pending evidence naming a different
    // surname, no acknowledgement. T2/T3 outrank T9 in the pure rule.
    const base = {
      existingRow: { id: 1, status: 'unique', playerId: 42, matchMethod: 'afl_api_stat_vector_bootstrap' },
      chosenPlayerOtherAflApiProviderId: null, chosenPlayerHasStableIdentity: false,
      hasPendingEvidence: true, fingerprintMatches: true, surnameDisagrees: true, surnameAcknowledged: false,
    };
    for (const state of ['L-I', 'L-H'] as const) {
      expect(decideAflApiLink({ ...base, state, chosenPlayerId: 42 }))
        .toMatchObject({ allow: false, code: 'T2_already_linked_same_player' });
      expect(decideAflApiLink({ ...base, state, chosenPlayerId: 43 }))
        .toMatchObject({ allow: false, code: 'T3_already_linked_different_player' });
    }

    // The query layer must not pre-empt that decision: the pre-decision input check drops
    // the surname item (T9 is decideAflApiLink's own), and a refusal carries decision.code.
    const link = fnBody('export async function linkAflApiProvider');
    const inputCheck = link.indexOf('validateAdjudicationInput({');
    const decision = link.indexOf('decideAflApiLink({');
    expect(inputCheck).toBeGreaterThanOrEqual(0);
    expect(decision).toBeGreaterThan(inputCheck);
    expect(link.slice(inputCheck, decision))
      .toContain(".filter((problem) => problem !== 'missing_surname_acknowledgement')");
    expect(link).toContain('if (!decision.allow) return { ok: false, error: decision.message, code: decision.code };');
    // Every write follows the refusal return.
    expect(link.indexOf('INSERT INTO external_identities'))
      .toBeGreaterThan(link.indexOf('if (!decision.allow) return'));
  });

  it('A10 — revoke: advisory locks, transaction-local lock_timeout, LOCK TABLE ACCESS EXCLUSIVE, re-reads, then the proof queries; DELETE only after every proof count is 0', () => {
    const fn = source.slice(source.indexOf('export async function revokeAflApiLink'));
    const at = (needle: string, from = 0) => {
      const i = fn.indexOf(needle, from);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const advisoryLocks = at('await takeIdentityLocks(tx, input.providerId');
    const setLockTimeout = at("set_config('lock_timeout', ${REVOKE_LOCK_TIMEOUT}, true)", advisoryLocks);
    const lockTable = at('LOCK TABLE external_identities IN ACCESS EXCLUSIVE MODE', setLockTimeout);
    const reReadExisting = at('readExistingIdentity(tx, sourceId, input.providerId)', lockTable);
    const nonUseProof = at('await proveNonUse(', reReadExisting);
    const deleteRow = at('DELETE FROM external_identities', nonUseProof);
    const insertAudit = at('INSERT INTO afl_api_identity_adjudications', deleteRow);
    expect(setLockTimeout).toBeGreaterThan(advisoryLocks);
    expect(lockTable).toBeGreaterThan(setLockTimeout);
    expect(reReadExisting).toBeGreaterThan(lockTable);
    expect(nonUseProof).toBeGreaterThan(reReadExisting);
    expect(deleteRow).toBeGreaterThan(nonUseProof);
    expect(insertAudit).toBeGreaterThan(deleteRow);
    expect(fn.slice(insertAudit, insertAudit + 400)).toContain("'revoked'");
    // decideAflApiRevoke (the T19/T20/T6/T8 gate) is consulted before the DELETE.
    const decisionCheck = at('decideAflApiRevoke(', nonUseProof);
    expect(decisionCheck).toBeLessThan(deleteRow);
  });

  // The three pins below guard postgres.js driver behaviour (node_modules/postgres/src/index.js):
  // it binds every interpolation as a parameter typed by the server, and begin() rethrows any
  // failed statement even when the callback caught it, after issuing ROLLBACK.
  const fnBody = (name: string) => {
    const start = source.indexOf(name);
    expect(start, name).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('\n}', start));
  };

  it('the revoke lock_timeout is set with set_config(…, true), never a parameterised SET', () => {
    const revoke = fnBody('export async function revokeAflApiLink');
    expect(revoke).toContain("await tx`SELECT set_config('lock_timeout', ${REVOKE_LOCK_TIMEOUT}, true)`");
    // SET takes no bind parameter: any `SET … ${…}` becomes `SET … $1` and always fails.
    expect(source).not.toMatch(/\bSET\s+(LOCAL\s+)?\w+\s*(=|TO)\s*\$\{/i);
    expect(source).not.toContain('SET LOCAL lock_timeout');
    expect(source).toMatch(/const REVOKE_LOCK_TIMEOUT = '2s';/);
  });

  it('D8 — link and revoke pass the audit jsonb values as objects through tx.json(), never JSON.stringify text', () => {
    const link = fnBody('export async function linkAflApiProvider');
    const revoke = fnBody('export async function revokeAflApiLink');
    for (const fn of [link, revoke]) {
      expect(fn).not.toContain('JSON.stringify');
      expect(fn).not.toContain('sqlJson');
    }
    expect(link).toContain('${existing === null ? null : jsonb(tx, existing)}, ${jsonb(tx, evidence)}');
    expect(revoke).toContain('${jsonb(tx, existing)},');
    expect(revoke).toContain('${jsonb(tx, { nonUseProof: nonUse })}');
    const helper = fnBody('function jsonb(');
    expect(helper).toContain('tx.json(value as unknown as postgres.JSONValue)');
    expect(helper).not.toContain('JSON.stringify');
    expect(source).not.toMatch(/function sqlJson/);
  });

  it('23505 and 55P03 are classified only after begin() has rolled back, never by a catch inside the transaction', () => {
    const link = fnBody('export async function linkAflApiProvider');
    const revoke = fnBody('export async function revokeAflApiLink');
    for (const [fn, predicate] of [[link, 'isUniqueViolation(error)'], [revoke, 'isLockTimeout(error)']] as const) {
      const begin = fn.indexOf('return await importSql.begin(async (tx) => {');
      const outerCatch = fn.indexOf('\n  } catch (error) {');
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(outerCatch).toBeGreaterThan(begin);
      const txBody = fn.slice(begin, outerCatch);
      // Nothing inside the transaction catches a statement error and keeps going.
      expect(txBody).not.toMatch(/\bcatch\b/);
      expect(txBody).not.toContain('isUniqueViolation');
      expect(txBody).not.toContain('isLockTimeout');
      expect(fn.indexOf(predicate)).toBeGreaterThan(outerCatch);
    }
    expect(revoke.slice(revoke.indexOf('isLockTimeout(error)'), revoke.indexOf('isLockTimeout(error)') + 250))
      .toContain("code: 'T19_revoke_unprovable'");

    // The 23505 loser re-reads the committed state on the pool (`importSql`), not on the
    // rolled-back transaction, and classifies it: its own provider row -> T6, else the
    // chosen player's other provider -> T4, else T6.
    expect(link).toContain('if (isUniqueViolation(error)) return await classifyLinkUniqueViolation(importSql, input);');
    const classify = fnBody('async function classifyLinkUniqueViolation(');
    expect(classify).toMatch(/\(\s*db: Sql, input: LinkAflApiProviderInput,\s*\)/);
    expect(classify).not.toMatch(/\btx\b|\.begin\(/);
    const reProvider = classify.indexOf('readExistingIdentity(db, sourceId, input.providerId)');
    const rePlayer = classify.indexOf('readPlayerOtherAflApiRow(db, sourceId, input.playerId, input.providerId)');
    expect(reProvider).toBeGreaterThanOrEqual(0);
    expect(rePlayer).toBeGreaterThan(reProvider);
    expect(classify.slice(reProvider, rePlayer)).toContain('if (existing !== null) return stale();');
    expect(classify).toContain("code: 'T4_player_holds_another_provider'");
    expect(classify).toContain("code: 'T6_stale_fingerprint'");
  });

  it('proveNonUse fails closed on every one of R1/R2/R5\'s rules (source-level: it composes the pure evaluator, never a bespoke pass rule)', () => {
    const fnStart = source.indexOf('async function proveNonUse');
    const fn = source.slice(fnStart, source.indexOf('\n}', fnStart));
    expect(fn).toContain('validateManifestAgainstCatalogue(catalogueRows, AFL_API_PLAYER_REFERENCE_MANIFEST)');
    expect(fn).toContain("entry.class !== 'LINK_DEPENDENT'");
    expect(fn).toContain('AFL_API_LEDGER_CHECKS');
    expect(fn).not.toMatch(/\btarget_id\b/); // R5: never read
    expect(fn).toContain('evaluateNonUseProof({');
  });

  it('A12 — resolveAflApiPlayer runs on the settle\'s own write transaction in both consumers', () => {
    const settle = readFileSync(join(process.cwd(), 'src', 'lib', 'acquisition', 'settle-afl-api.ts'), 'utf8');
    const settlePlan = readFileSync(join(process.cwd(), 'src', 'lib', 'acquisition', 'afl-api-settle-plan.ts'), 'utf8');
    const brownlow = readFileSync(join(process.cwd(), 'src', 'lib', 'acquisition', 'afl-api-brownlow.ts'), 'utf8');

    // resolveAflApiPlayer() itself takes a generic `sql` parameter (it is also read from
    // outside a transaction, e.g. the admin query module), so the premise is pinned at the
    // CALL CHAIN into it, not at its own signature: each settle opens exactly one
    // `sql.begin`, and passes that `tx` all the way down to the resolver.
    expect(settlePlan).toMatch(/async function planPlayerUnit\(\s*sql\b/);
    expect(settlePlan).toMatch(/resolveAflApiPlayer\(sql, sourceId, row\.providerPlayerId\)/);
    // settle-afl-api.ts's settle opens one sql.begin and calls planAflApiMatchUnit with
    // that SAME tx (settle-afl-api.ts:1137 in the plan-review's citation).
    expect(settle.match(/await sql\.begin\(async \(tx\) => \{/g)?.length).toBe(1);
    expect(settle).toMatch(/planAflApiMatchUnit\(\s*tx,/);

    // afl-api-brownlow.ts's settle likewise opens one sql.begin and passes tx down through
    // planAflApiBrownlowMatchSet() to resolveAflApiPlayer(sql, ...) (afl-api-brownlow.ts:707).
    expect(brownlow.match(/await sql\.begin\(async \(tx\) => \{/g)?.length).toBe(1);
    expect(brownlow).toMatch(/planAflApiBrownlowMatchSet\(\s*tx,/);
    expect(brownlow).toMatch(/resolveAflApiPlayer\(sql, sourceId, vote\.providerPlayerId\)/);
  });
});

/**
 * AFLDB-ISSUE-235 S6 — the shared integration fixture's ownership definition, DB-free. The first
 * full live S6 run (2026-09-24) failed both leftover gates on 6 afl_api identities, 57 dependent
 * rows and 81 pending candidates that were REAL afldb_test rows: 2026 has real Champion Data
 * providers `CD_I999xxx`, and the gate selected `LIKE 'CD_I999%'`. These pin the exact
 * ownership that replaced it, and that teardown and the gate read the same one.
 */
describe('AFLDB-ISSUE-235 S6: fixture ownership (DB-free)', () => {
  // Real 2026 providers from the tracked bridges and ledgers, plus plausible real ids that
  // share the S6 prefix's leading characters.
  const REAL_PROVIDER_IDS = [
    'CD_I999321', 'CD_I999326', 'CD_I999331', 'CD_I999391', 'CD_I999715', 'CD_I999724', 'CD_I999827',
    'CD_I1002231', 'CD_I999235', 'CD_I9992351',
  ];

  it('owns exactly the ISSUE-235 fixture provider ids, never a real CD_I999xxx provider', () => {
    for (const id of REAL_PROVIDER_IDS) {
      expect(ownsProviderId(ISSUE235_OWNERSHIP, id), id).toBe(false);
      expect(ownsProviderId(S6_OWNERSHIP, id), id).toBe(false);
    }
    for (const id of [s6ProviderId(1), s6ProviderId(1599), s6ProviderId(9999)]) {
      expect(ownsProviderId(S6_OWNERSHIP, id), id).toBe(true);
      expect(ownsProviderId(ISSUE235_OWNERSHIP, id), id).toBe(true);
    }
    const literal = [I1_FIXTURE.providerA, I1_FIXTURE.providerB, I14_FIXTURE.providerLinked, I14_FIXTURE.providerRevoked,
      I18_FIXTURE.providerId];
    for (const id of literal) {
      expect(ownsProviderId(ISSUE235_OWNERSHIP, id), id).toBe(true);
      expect(ownsProviderId(S6_OWNERSHIP, id), id).toBe(false); // I1/I14/I18 have their own teardown
    }
    // I18: a syntactically valid 10-digit CD_I id, and its spine record is not an S6 record.
    expect(I18_FIXTURE.providerId).toMatch(/^CD_I[0-9]{10}$/);
    expect(isS6MatchRecordId(I18_FIXTURE.externalRecordId)).toBe(false);
    expect(I18_FIXTURE.externalRecordId.split('|')).toEqual([I18_FIXTURE.matchId, I18_FIXTURE.teamId, I18_FIXTURE.providerId]);
    // Whole-string: neither a longer nor a suffixed/prefixed id is an S6 id.
    for (const id of ['CD_I99923500011', 'CD_I9992350001x', `x${s6ProviderId(1)}`]) {
      expect(ownsProviderId(ISSUE235_OWNERSHIP, id), id).toBe(false);
    }
    expect(() => s6ProviderId(0)).toThrow(/1…9999/);
    expect(() => s6ProviderId(10000)).toThrow(/1…9999/);
  });

  it('matches no provider id in any tracked AFL API reference file', () => {
    const dir = join(process.cwd(), 'data', 'reference');
    const seen = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => /^afl-api-.*\.json$/.test(f))) {
      for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/"(CD_I[0-9]+)"/g)) seen.add(m[1]);
    }
    expect(seen.has('CD_I999321')).toBe(true); // not vacuous: real CD_I999xxx ids are present
    expect([...seen].filter((id) => ownsProviderId(ISSUE235_OWNERSHIP, id))).toEqual([]);
  });

  it('owns exactly the fixture match records, players and AFL Tables identities', () => {
    expect(isS6MatchRecordId(s6MatchId(601))).toBe(true);
    expect(isS6MatchRecordId(`${s6MatchId(1)}|CD_T20|${s6ProviderId(1)}`)).toBe(true);
    for (const id of ['CD_M20260140609', 'CD_M2026ISSUE228001', 'CD_M99923500011', 'CD_M9992350001x|y', 'CD_M999235']) {
      expect(isS6MatchRecordId(id), id).toBe(false);
    }

    for (const n of [S6_LEGACY_ID_RANGE.min, S6_LEGACY_ID_RANGE.max, I1_FIXTURE.legacyPlayerId,
      I14_FIXTURE.legacyPlayerIdA, I14_FIXTURE.legacyPlayerIdB]) {
      expect(ownsLegacyPlayerId(ISSUE235_OWNERSHIP, n), String(n)).toBe(true);
    }
    // The old gate's -235999999…-235000000 span is gone; so is any other suite's synthetic id.
    for (const n of [-235000000, -235999999, -235140003, -228000001, 1, 12345]) {
      expect(ownsLegacyPlayerId(ISSUE235_OWNERSHIP, n), String(n)).toBe(false);
    }
    expect(ownsLegacyPlayerId(S6_OWNERSHIP, I1_FIXTURE.legacyPlayerId)).toBe(false);

    expect(ownsAfltablesId(S6_OWNERSHIP, `${S6_AFLTABLES_PREFIX}17.html`)).toBe(true);
    expect(ownsAfltablesId(ISSUE235_OWNERSHIP, I14_FIXTURE.afltablesIdA)).toBe(true);
    expect(ownsAfltablesId(S6_OWNERSHIP, I14_FIXTURE.afltablesIdA)).toBe(false);
    for (const id of ['players/Z/Issue235-Other.html', `${S6_AFLTABLES_PREFIX}17.htm`, 'players/Z/Zac_Smith.html']) {
      expect(ownsAfltablesId(ISSUE235_OWNERSHIP, id), id).toBe(false);
    }
  });

  /** A postgres.js stand-in that renders every awaited statement, nested fragments inlined. */
  function recordingDb(): { db: any; statements: { text: string; values: unknown[] }[] } {
    type Frag = { strings: readonly string[]; values: unknown[]; then?: unknown };
    const frags = new WeakSet<object>();
    const render = (f: Frag): { text: string; values: unknown[] } => {
      let text = f.strings[0];
      const values: unknown[] = [];
      f.values.forEach((v, i) => {
        if (v !== null && typeof v === 'object' && frags.has(v)) {
          const inner = render(v as Frag);
          text += inner.text;
          values.push(...inner.values);
        } else {
          text += '?';
          values.push(v);
        }
        text += f.strings[i + 1];
      });
      return { text: text.replace(/\s+/g, ' ').trim(), values };
    };
    const statements: { text: string; values: unknown[] }[] = [];
    const db = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const frag: Frag = { strings: [...strings], values };
      frags.add(frag);
      frag.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        statements.push(render(frag));
        return Promise.resolve([{ ...ZERO_ISSUE235_RESIDUE, n: 0 }]).then(resolve, reject);
      };
      return frag;
    };
    return { db, statements };
  }

  const refs = { aflApiSourceId: 77, afltablesSourceId: 1, manualAdminEditSourceId: null };
  const PATTERNS = [S6_PROVIDER_ID_PATTERN, S6_MATCH_RECORD_PATTERN, S6_AFLTABLES_ID_PATTERN];
  const flat = (statements: { values: unknown[] }[]) =>
    statements.flatMap((s) => s.values.flatMap((v) => (Array.isArray(v) ? v : [v])));

  it('teardown, the leftover gate and the isolation precondition read the one ownership definition', async () => {
    const cleanup = recordingDb();
    await cleanupS6Fixtures(cleanup.db, refs);
    const residue = recordingDb();
    await issue235FixtureResidue(residue.db, refs);
    const isolation = recordingDb();
    await assertS6LedgerIsolated(isolation.db, refs);

    expect(cleanup.statements.length).toBeGreaterThan(10);
    expect(residue.statements).toHaveLength(1);
    expect(isolation.statements).toHaveLength(2);
    for (const { statements } of [cleanup, residue, isolation]) {
      // No prefix selector anywhere: every id predicate is exact or anchored.
      for (const s of statements) expect(s.text, s.text).not.toMatch(/\bLIKE\b/i);
    }

    const strings = (statements: { values: unknown[] }[]) => new Set(flat(statements).filter((v) => typeof v === 'string'));
    // Teardown: S6's anchored patterns and its own labels, nothing else — no I1/I14 id.
    expect(strings(cleanup.statements)).toEqual(new Set([...PATTERNS, S6_ACTOR_EMAIL, S6_HASH_RECIPE, S6_FIXTURE_TOOL]));
    // The gate: the SAME patterns and labels, plus exactly I1's and I14's literal ids.
    expect(strings(residue.statements)).toEqual(new Set([
      ...PATTERNS, S6_ACTOR_EMAIL, S6_HASH_RECIPE, S6_FIXTURE_TOOL,
      ...ISSUE235_OWNERSHIP.providerIds, ...ISSUE235_OWNERSHIP.afltablesIds,
      // I14's own suite-created actor.
      I14_FIXTURE.actorEmail,
      // I18's exact literals: its actor, spine record, payload recipe and batch tool.
      I18_FIXTURE.actorEmail, I18_FIXTURE.externalRecordId, I18_FIXTURE.hashRecipe, I18_FIXTURE.tool,
    ]));
    // S6 teardown never reaches an I18 row; the isolation check names I18's provider exactly.
    for (const v of [I18_FIXTURE.providerId, I18_FIXTURE.actorEmail, I18_FIXTURE.externalRecordId,
      I18_FIXTURE.hashRecipe, I18_FIXTURE.tool, I18_FIXTURE.stableIdentity]) {
      expect(strings(cleanup.statements).has(v), v).toBe(false);
    }
    expect(isolation.statements.every((s) => s.values.includes(I18_FIXTURE.providerId))).toBe(true);
    // The same S6 player range in both; the gate adds exactly I1's and I14's players.
    for (const { statements } of [cleanup, residue]) {
      const numbers = flat(statements).filter((v) => typeof v === 'number');
      expect(numbers).toContain(S6_LEGACY_ID_RANGE.min);
      expect(numbers).toContain(S6_LEGACY_ID_RANGE.max);
    }
    expect(flat(residue.statements)).toEqual(expect.arrayContaining([...ISSUE235_OWNERSHIP.legacyPlayerIds]));
    // The isolation precondition counts non-fixture rows by the gate's own provider ownership.
    expect(strings(isolation.statements)).toEqual(new Set([S6_PROVIDER_ID_PATTERN, ...ISSUE235_OWNERSHIP.providerIds]));
  });

  it('I14 stores an FK-valid but WRONG numeric player id with a DIFFERENT stable identity', () => {
    const row = i14StaleLedgerRow({ playerIdA: 501, playerIdB: 502 });
    expect(row.playerId).toBe(502); // player B: a real row, so migration 104's FK holds
    expect(row.playerId).not.toBe(501); // ...but not the player the identity names
    expect(row.playerIdentity).toBe(I14_FIXTURE.afltablesIdA);
    expect(row.playerIdentity).not.toBe(I14_FIXTURE.afltablesIdB);
    expect(() => i14StaleLedgerRow({ playerIdA: 7, playerIdB: 7 })).toThrow(/two distinct/);

    // The live case uses it, and no dangling literal id or bare prefix selector survives.
    const integration = (file: string) => readFileSync(join(process.cwd(), 'tests', 'integration', file), 'utf8');
    const suite = integration('settle-afl-api.test.ts');
    expect(suite).toContain('i14StaleLedgerRow({ playerIdA: i14PlayerIdA, playerIdB: i14PlayerIdB })');
    expect(suite).not.toMatch(/'linked',\s*999999999/);
    expect(suite).toContain('expect(resolved.playerId).not.toBe(stale.playerId)');
    for (const file of ['settle-afl-api.test.ts', 'player-link-concurrency.test.ts', 'afl-api-adjudication-fixtures.ts',
      'afl-api-fixture-ownership.ts']) {
      expect(integration(file), file).not.toMatch(/LIKE[^\n]*(CD_I999|S6_PROVIDER_PREFIX|S6_MATCH_PREFIX|ISSUE235_)/);
    }
    // Fixture provider literals live only in the registry, so the gate cannot miss one.
    for (const file of ['settle-afl-api.test.ts', 'player-link-concurrency.test.ts']) {
      expect(integration(file), file).not.toMatch(/'CD_I999[0-9]*'/);
    }
  });

  it('I14 owns its actor and its teardown needs nothing from setup (a rebuilt afldb_test has zero auth_users)', async () => {
    // The post-I18 run refused at "afldb_test must have at least one auth_users row", then its
    // afterAll threw UNDEFINED_VALUE on the never-assigned source id. Both are gone:
    expect(I14_FIXTURE.actorEmail).toMatch(/^issue235-i14-fixture@example\.test$/);
    expect(new Set([S6_ACTOR_EMAIL, I14_FIXTURE.actorEmail, I18_FIXTURE.actorEmail]).size).toBe(3);

    // The actor: exact email, super_admin, disabled, no credentials.
    const seed = recordingDb();
    await seedI14Actor(seed.db);
    expect(seed.statements).toHaveLength(1);
    expect(seed.statements[0].text).toMatch(/INSERT INTO auth_users \(email, role, password_hash, totp_secret, disabled_at\) VALUES \(\?, 'super_admin', NULL, NULL, now\(\)\)/);
    expect(seed.statements[0].values).toEqual([I14_FIXTURE.actorEmail]);

    // The teardown takes no setup value at all: every bound value is one of I14's literals.
    expect(cleanupI14Fixtures.length).toBe(1);
    const cleanup = recordingDb();
    await cleanupI14Fixtures(cleanup.db);
    const values = flat(cleanup.statements);
    expect(values).not.toContain(undefined);
    expect(new Set(values)).toEqual(new Set([
      I14_FIXTURE.actorEmail, I14_FIXTURE.legacyPlayerIdA, I14_FIXTURE.legacyPlayerIdB,
      I14_FIXTURE.providerLinked, I14_FIXTURE.providerRevoked, I14_FIXTURE.afltablesIdA, I14_FIXTURE.afltablesIdB,
    ]));
    for (const s of cleanup.statements) expect(s.text, s.text).not.toMatch(/\bLIKE\b/i);
    // Child to parent, ending with the actor.
    expect(cleanup.statements.map((s) => s.text.match(/^DELETE FROM (\S+)/)?.[1]))
      .toEqual(['afl_api_identity_adjudications', 'external_identities', 'players', 'auth_users']);

    // The live suite uses both, never an arbitrary account, and I17 has its own setup-free block.
    const suite = readFileSync(join(process.cwd(), 'tests', 'integration', 'settle-afl-api.test.ts'), 'utf8');
    expect(suite).not.toMatch(/FROM auth_users ORDER BY/);
    expect(suite).not.toContain('at least one auth_users row');
    expect(suite).toContain('i14AdminUserId = await seedI14Actor(sql)');
    const i17 = suite.slice(suite.indexOf("describe('AFLDB-ISSUE-235 (I17)"), suite.indexOf("it('I17 (R1/R2 live pin)"));
    expect(i17).toMatch(/^describe\('AFLDB-ISSUE-235 \(I17\)/);
    expect(i17).not.toMatch(/beforeAll|beforeEach/);
  });
});
