import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authSql: vi.fn(),
  audit: vi.fn(),
  requireAdmin: vi.fn(),
  requireSuperAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  promoteSubmission: vi.fn(),
  validateSubmission: vi.fn(),
  getDataset: vi.fn(),
}));

vi.mock('@/db/authClient', () => ({ authSql: mocks.authSql }));
// Only the REAL pipeline (imported with vi.importActual below) reads datasets.
vi.mock('@/lib/ingest/datasets', () => ({
  getDataset: mocks.getDataset,
  readMatchResultsAuthority: vi.fn(),
  readMatchSheetAuthority: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({
  audit: mocks.audit,
  requireAdmin: mocks.requireAdmin,
  requireSuperAdmin: mocks.requireSuperAdmin,
}));
vi.mock('@/lib/ingest/pipeline', () => ({
  promoteSubmission: mocks.promoteSubmission,
  validateSubmission: mocks.validateSubmission,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { decideSubmission, runPromotion, runValidation } from '@/app/admin/submissions/[id]/actions';

// The module itself is mocked for the action tests above; the validation
// tests below need the real one, still wired to the mocked authSql/datasets.
const {
  validateSubmission, SubmissionChangedError, SubmissionNotValidatableError,
  INTAKE_VALIDATION_START_STATUSES, REVIEW_VALIDATION_START_STATUSES,
} = await vi.importActual<
  typeof import('@/lib/ingest/pipeline')
>('@/lib/ingest/pipeline');

function compact(strings: TemplateStringsArray): string {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperAdmin.mockResolvedValue({ id: 9, email: 'admin@example.test' });
  mocks.audit.mockResolvedValue(undefined);
});

// AFLDB V2 Stage 5 (V2-GAP-013, legacy-disposition L2) RETIRED the three submission review
// actions. They keep their names and their role guards (the first awaited statement) and REFUSE:
// no SQL, no pipeline call, no revalidation. The pipeline LIBRARY below is unchanged and keeps
// its tests: the offline tools still use it, and the ISSUE-273/306 contracts are properties of
// the library, not of the retired actions that used to call it.
const ADMIN = { id: 9, email: 'admin@example.test' };

/** What a stale `useActionState` client posts: (previous state, form data). The actions declare neither. */
type StaleAction = (previous: object, form: FormData) => Promise<unknown>;
const staleValidation = runValidation as unknown as StaleAction;
const staleDecision = decideSubmission as unknown as StaleAction;
const stalePromotion = runPromotion as unknown as StaleAction;

function reviewForm(id: number, decision?: 'approve' | 'reject'): FormData {
  const formData = new FormData();
  formData.set('id', String(id));
  if (decision) formData.set('decision', decision);
  return formData;
}

describe('retired submission review actions (AFLDB V2 Stage 5)', () => {
  const CALLS = [
    ['runValidation', () => staleValidation({}, reviewForm(17)), 'requireAdmin'],
    ['decideSubmission (approve)', () => staleDecision({}, reviewForm(17, 'approve')), 'requireSuperAdmin'],
    ['decideSubmission (reject)', () => staleDecision({}, reviewForm(17, 'reject')), 'requireSuperAdmin'],
    ['runPromotion', () => stalePromotion({}, reviewForm(17)), 'requireSuperAdmin'],
  ] as const;

  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue(ADMIN);
  });

  it('declares no parameters on any of the three actions', () => {
    expect([runValidation.length, decideSubmission.length, runPromotion.length]).toEqual([0, 0, 0]);
  });

  it.each(CALLS)('%s answers the typed refusal and never reaches the pipeline, SQL or the cache', async (_name, call) => {
    const result = await call();

    expect(result).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.submission_review' });
    expect((result as { error?: string }).error).toMatch(/retired/i);
    expect(mocks.validateSubmission).not.toHaveBeenCalled();
    expect(mocks.promoteSubmission).not.toHaveBeenCalled();
    expect(mocks.authSql).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(CALLS)('%s writes exactly one audit row naming the surface and the export', async (name, call) => {
    await call();

    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      'admin.legacy_retired_refused',
      { surface: 'admin.submission_review', export: name.split(' ')[0] },
      { userId: 9, label: 'admin@example.test' },
    );
  });

  it.each(CALLS)('%s calls its own role guard, and a guard that redirects stops it before the refusal', async (_name, call, guard) => {
    const redirect = new Error('NEXT_REDIRECT /admin');
    mocks[guard].mockRejectedValue(redirect);

    await expect(call()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks[guard]).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.promoteSubmission).not.toHaveBeenCalled();
  });

  it('keeps the validation and promotion guards apart: validation is an admin action, the verdicts are super admin', async () => {
    await staleValidation({}, reviewForm(17));
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.requireSuperAdmin).not.toHaveBeenCalled();

    mocks.requireAdmin.mockClear();
    await stalePromotion({}, reviewForm(17));
    await staleDecision({}, reviewForm(17, 'approve'));
    expect(mocks.requireSuperAdmin).toHaveBeenCalledTimes(2);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it('refuses whatever the form carries: no id, a bad id or an unknown decision change nothing', async () => {
    const odd = new FormData();
    odd.set('id', 'not-a-number');
    odd.set('decision', 'delete-everything');

    expect(await staleDecision({}, odd)).toMatchObject({ refused: true, code: 'legacy_retired' });
    expect(await staleValidation({}, new FormData())).toMatchObject({ refused: true, code: 'legacy_retired' });
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('still refuses when the audit write fails', async () => {
    mocks.audit.mockRejectedValue(new Error('audit insert failed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await stalePromotion({}, reviewForm(17))).toMatchObject({ refused: true, code: 'legacy_retired' });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// validateSubmission against a scripted authSql (AFLDB-ISSUE-273)
// ---------------------------------------------------------------------------
// The fake models just enough of a database to see WHERE each write lands:
// statements made inside `begin` are buffered and only count as committed
// when the callback returns; a throw discards them, as a rollback would.
// Real locking and visibility are proved in
// tests/integration/submission-promotion.test.ts.

type Recorded = { query: string; values: unknown[]; inTx: boolean };

function fakeValidationDb(opts: {
  start?: { dataset: string; status: string; version: string };
  /** What the locking re-read returns; defaults to the starting row. */
  locked?: { status: string; version: string } | null;
  rows: { rowNo: number; payload: Record<string, string | null> }[];
  /** Rows the bulk verdict UPDATE reports, per chunk length. */
  rowsWritten?: (chunkLength: number, chunkIndex: number) => number;
}) {
  const start = opts.start ?? { dataset: 'player_bio', status: 'validated', version: '1001' };
  const calls: Recorded[] = [];
  const committed: Recorded[] = [];
  let chunkIndex = 0;

  const respond = (inTx: boolean, buffer: Recorded[]) => async (
    strings: TemplateStringsArray, ...values: unknown[]
  ): Promise<unknown> => {
    const call = { query: compact(strings), values, inTx };
    calls.push(call);
    if (call.query.startsWith('SELECT dataset, status::text, xmin::text AS version')) return [start];
    if (call.query.startsWith('SELECT row_no')) return opts.rows;
    if (call.query.includes('FOR UPDATE')) {
      if (opts.locked === null) return [];
      return [opts.locked ?? { status: start.status, version: start.version }];
    }
    if (call.query.startsWith('UPDATE')) {
      buffer.push(call);
      if (call.query.startsWith('UPDATE data_submission_rows')) {
        const chunk = (values[0] as { json: unknown[] }).json;
        const count = opts.rowsWritten ? opts.rowsWritten(chunk.length, chunkIndex) : chunk.length;
        chunkIndex += 1;
        return Object.assign([], { count });
      }
      return [{ id: 17 }];
    }
    throw new Error(`unscripted statement: ${call.query}`);
  };

  const json = (value: unknown) => ({ json: value });
  mocks.authSql.mockImplementation(respond(false, committed));
  const begin = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    const pending: Recorded[] = [];
    const result = await callback(Object.assign(respond(true, pending), { json }));
    committed.push(...pending);
    return result;
  });
  Object.assign(mocks.authSql, { begin, json });
  return { calls, committed, begin };
}

function playerBioSpec(overrides: {
  fileKey?: (row: Record<string, string | null>) => string;
} = {}) {
  return {
    key: 'player_bio',
    fileKey: overrides.fileKey ?? ((row: Record<string, string | null>) => row.player_id ?? ''),
    validateRow: async (row: Record<string, string | null>) => (
      row.player_id === 'bad'
        ? { verdict: 'error', reasons: ['player_id must be a positive integer'] }
        : { verdict: 'ok', reasons: ['fine'], resolved: { player_id: Number(row.player_id) } }
    ),
  };
}

function rowsOf(...ids: string[]) {
  return ids.map((id, index) => ({ rowNo: index + 1, payload: { player_id: id } }));
}

const isWrite = (c: Recorded) => c.query.startsWith('UPDATE');

describe('validateSubmission write protocol (AFLDB-ISSUE-273)', () => {
  it('writes every verdict and the status in one transaction, behind the lock and a status CAS', async () => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({ rows: rowsOf('5', 'bad', '5') });

    const summary = await validateSubmission(17);

    expect(summary).toEqual({ ok: 1, warnings: 0, errors: 2, duplicates: 1 });
    expect(db.begin).toHaveBeenCalledOnce();
    // Nothing is written outside the transaction.
    expect(db.calls.filter((c) => !c.inTx && isWrite(c))).toEqual([]);

    const inTx = db.calls.filter((c) => c.inTx).map((c) => c.query);
    expect(inTx).toHaveLength(3);
    expect(inTx[0]).toBe(
      'SELECT status::text, xmin::text AS version FROM data_submissions WHERE id = ? FOR UPDATE',
    );
    expect(inTx[1]).toMatch(
      /^UPDATE data_submission_rows r SET verdict = v\.verdict, reasons = v\.reasons FROM jsonb_to_recordset\(\?\)/,
    );
    expect(inTx[2]).toMatch(
      /^UPDATE data_submissions SET status = 'validated'.* WHERE id = \? AND status = \? RETURNING id$/,
    );
    expect(db.committed.map((c) => c.query)).toEqual([inTx[1], inTx[2]]);

    const [rowWrite, statusWrite] = db.committed;
    expect((rowWrite.values[0] as { json: unknown }).json).toEqual([
      { row_no: 1, verdict: 'ok', reasons: { reasons: ['fine'], resolved: { player_id: 5 } } },
      {
        row_no: 2, verdict: 'error',
        reasons: { reasons: ['player_id must be a positive integer'], resolved: null },
      },
      {
        row_no: 3, verdict: 'error',
        reasons: { reasons: ['fine', 'duplicate of row 1 (key "5")'], resolved: { player_id: 5 } },
      },
    ]);
    expect(rowWrite.values[1]).toBe(17);
    expect(statusWrite.values).toEqual([{ json: summary }, 17, 'validated']);
  });

  it.each([
    ['rejected', 'a reject'],
    ['approved', 'an approve'],
    ['promoted', 'an approve then promote'],
  ])('refuses and writes nothing when the submission became %s (%s) mid-run', async (status) => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({ rows: rowsOf('5', '6'), locked: { status, version: '2002' } });

    const run = validateSubmission(17);
    await expect(run).rejects.toBeInstanceOf(SubmissionChangedError);
    await expect(run).rejects.toThrow(`became ${status} while it was being validated`);
    expect(db.calls.filter(isWrite)).toEqual([]);
    expect(db.committed).toEqual([]);
  });

  it('refuses when the status matches but the row was rewritten in between', async () => {
    // Another validation committed first, or a reject then a re-validation
    // returned the row to the starting status: only xmin tells them apart.
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({ rows: rowsOf('5'), locked: { status: 'validated', version: '3003' } });

    await expect(validateSubmission(17)).rejects.toThrow(/changed by another validation or review action/);
    expect(db.calls.filter(isWrite)).toEqual([]);
  });

  it('refuses when the submission disappeared before the write', async () => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({ rows: rowsOf('5'), locked: null });

    await expect(validateSubmission(17)).rejects.toThrow(/was deleted while it was being validated/);
    expect(db.committed).toEqual([]);
  });

  it('writes nothing at all when the run fails part-way through computing verdicts', async () => {
    let keys = 0;
    mocks.getDataset.mockReturnValue(playerBioSpec({
      // fileKey sits outside the per-row validator catch, so a throw here
      // aborts the run. Before ISSUE-273 row 1 had already been rewritten.
      fileKey: (row) => {
        keys += 1;
        if (keys === 2) throw new Error('fileKey exploded');
        return row.player_id ?? '';
      },
    }));
    const db = fakeValidationDb({ rows: rowsOf('5', '6', '7') });

    await expect(validateSubmission(17)).rejects.toThrow('fileKey exploded');
    expect(db.begin).not.toHaveBeenCalled();
    expect(db.calls.filter(isWrite)).toEqual([]);
  });

  it('rolls back every chunk already written when a later chunk does not land', async () => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const ids = Array.from({ length: 1201 }, (_, i) => String(i + 1));
    const db = fakeValidationDb({
      rows: rowsOf(...ids),
      rowsWritten: (length, index) => (index === 2 ? length - 1 : length),
    });

    await expect(validateSubmission(17)).rejects.toThrow('wrote 200 of 201 row verdicts; rolled back');
    const chunks = db.calls.filter((c) => c.query.startsWith('UPDATE data_submission_rows'));
    expect(chunks.map((c) => (c.values[0] as { json: unknown[] }).json.length)).toEqual([500, 500, 201]);
    expect(db.calls.some((c) => c.query.startsWith('UPDATE data_submissions'))).toBe(false);
    expect(db.committed).toEqual([]);
  });

  it('still refuses a submission that is not in a validatable state before doing any work', async () => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({
      start: { dataset: 'player_bio', status: 'approved', version: '1001' }, rows: rowsOf('5'),
    });

    await expect(validateSubmission(17))
      .rejects.toThrow('submission is approved; only staged files can be validated');
    expect(db.begin).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(1);
  });
});

describe('validateSubmission start-status policy (AFLDB-ISSUE-273)', () => {
  it('pins each caller\'s policy', () => {
    expect(REVIEW_VALIDATION_START_STATUSES).toEqual(['staged', 'validated', 'rejected']);
    expect(INTAKE_VALIDATION_START_STATUSES).toEqual(['staged', 'validated']);
  });

  it('still re-validates a rejected submission by default (the review page\'s manual path)', async () => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({
      start: { dataset: 'player_bio', status: 'rejected', version: '1001' }, rows: rowsOf('5'),
    });

    expect(await validateSubmission(17)).toEqual({ ok: 1, warnings: 0, errors: 0, duplicates: 0 });
    const statusWrite = db.committed.find((c) => c.query.startsWith('UPDATE data_submissions'));
    expect(statusWrite?.values).toEqual([{ json: { ok: 1, warnings: 0, errors: 0, duplicates: 0 } }, 17, 'rejected']);
  });

  it.each(['rejected', 'approved', 'promoted', 'failed'])(
    'refuses a %s submission under the intake policy at the first read, reading and writing nothing else',
    async (status) => {
      mocks.getDataset.mockReturnValue(playerBioSpec());
      const db = fakeValidationDb({
        start: { dataset: 'player_bio', status, version: '1001' }, rows: rowsOf('5'),
      });

      const run = validateSubmission(17, { startStatuses: INTAKE_VALIDATION_START_STATUSES });
      await expect(run).rejects.toBeInstanceOf(SubmissionNotValidatableError);
      await expect(run).rejects.toMatchObject({ submissionId: 17, status });
      // The policy is checked against the one SELECT that also captures xmin.
      expect(db.calls.map((c) => c.query)).toEqual([
        'SELECT dataset, status::text, xmin::text AS version FROM data_submissions WHERE id = ?',
      ]);
      expect(db.begin).not.toHaveBeenCalled();
      expect(mocks.getDataset).not.toHaveBeenCalled();
    },
  );

  it.each(['staged', 'validated'])('validates a %s submission under the intake policy', async (status) => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({ start: { dataset: 'player_bio', status, version: '1001' }, rows: rowsOf('5') });

    await validateSubmission(17, { startStatuses: INTAKE_VALIDATION_START_STATUSES });
    expect(db.committed.map((c) => c.query.split(' ', 2).join(' '))).toEqual([
      'UPDATE data_submission_rows', 'UPDATE data_submissions',
    ]);
    expect(db.committed[1].values.at(-1)).toBe(status);
  });
});

// ---------------------------------------------------------------------------
// validateSubmission and the resolved key (AFLDB-ISSUE-306)
// ---------------------------------------------------------------------------
// The real pipeline over a scripted database, with the REAL `fileKey` and
// `resolvedKey` of the two datasets that define one. Only `validateRow` is
// scripted (it plays the alias resolver): `Home Alias` resolves to `Home FC`.

const { DATASETS: realDatasets } = await vi.importActual<
  typeof import('@/lib/ingest/datasets')
>('@/lib/ingest/datasets');

describe('validateSubmission duplicate detection on the resolved key (AFLDB-ISSUE-306)', () => {
  const clubName = (text: string | null) => (text === 'Home Alias' || text === 'Home Alias 2' ? 'Home FC' : text);

  const matchSpec = () => ({
    ...realDatasets.match_results,
    validateRow: async (row: Record<string, string | null>) => ({
      verdict: 'ok' as const,
      reasons: [],
      resolved: {
        season: 2073, round_code: '1',
        home_club_name: clubName(row.home_club), away_club_name: clubName(row.away_club),
      },
    }),
  });

  /** Like matchSpec, but a row at the venue `Refused` is a failed row that still carries what it had resolved. */
  const matchSpecWithRefusedRow = () => ({
    ...matchSpec(),
    validateRow: async (row: Record<string, string | null>) => ({
      ...(await matchSpec().validateRow(row)),
      ...(row.venue === 'Refused'
        ? { verdict: 'error' as const, reasons: ['venue is refused'] }
        : {}),
    }),
  });

  const statsSpec = () => ({
    ...realDatasets.player_match_stats,
    validateRow: async (row: Record<string, string | null>) => (
      row.player === 'Nobody'
        ? { verdict: 'error' as const, reasons: ['player "Nobody" not found for 2073'] }
        : {
          verdict: 'ok' as const,
          reasons: [],
          resolved: { match_id: 500, player_id: row.player === 'Other Player' ? 901 : 900, club_id: 1 },
        }
    ),
  });

  const fixture = (extra: Record<string, string | null> = {}): Record<string, string | null> => ({
    season: '2073', round_code: 'R1', round_number: '1', match_date: '2073-03-01',
    home_club: 'Home FC', away_club: 'Away FC', ...extra,
  });
  const statLine = (extra: Record<string, string | null> = {}): Record<string, string | null> => ({
    season: '2073', round_code: 'R1', home_club: 'Home FC', away_club: 'Away FC',
    player: 'Fixture Player', club: 'Home FC', ...extra,
  });
  const numbered = (...payloads: Record<string, string | null>[]) =>
    payloads.map((payload, index) => ({ rowNo: index + 1, payload }));

  const written = (db: ReturnType<typeof fakeValidationDb>) =>
    (db.committed[0].values[0] as { json: Array<{ row_no: number; verdict: string; reasons: { reasons: string[] } }> }).json;

  it('marks the second spelling of one fixture a duplicate, and keeps the first row as it was', async () => {
    mocks.getDataset.mockReturnValue(matchSpec());
    const db = fakeValidationDb({
      start: { dataset: 'match_results', status: 'staged', version: '1' },
      rows: numbered(fixture(), fixture({ home_club: 'Home Alias' })),
    });

    const summary = await validateSubmission(17);

    expect(summary).toEqual({ ok: 1, warnings: 0, errors: 1, duplicates: 1 });
    const [first, second] = written(db);
    expect(first).toMatchObject({ row_no: 1, verdict: 'ok' });
    expect(first.reasons.reasons).toEqual([]);
    expect(second).toMatchObject({ row_no: 2, verdict: 'error' });
    expect(second.reasons.reasons).toEqual([
      'duplicate of row 1: the same record once names are resolved (key "2073|1|2073-03-01|Home FC|Away FC")',
    ]);
  });

  it('does not touch two genuinely different fixtures', async () => {
    mocks.getDataset.mockReturnValue(matchSpec());
    const db = fakeValidationDb({
      start: { dataset: 'match_results', status: 'staged', version: '1' },
      rows: numbered(fixture(), fixture({ match_date: '2073-03-08' }), fixture({ home_club: 'Away FC', away_club: 'Home Alias' })),
    });

    expect(await validateSubmission(17)).toEqual({ ok: 3, warnings: 0, errors: 0, duplicates: 0 });
    expect(written(db).map((v) => v.verdict)).toEqual(['ok', 'ok', 'ok']);
  });

  it('counts a row that is a duplicate by both keys once, under the cell-text reason', async () => {
    mocks.getDataset.mockReturnValue(matchSpec());
    const db = fakeValidationDb({
      start: { dataset: 'match_results', status: 'staged', version: '1' },
      rows: numbered(fixture(), fixture()),
    });

    expect(await validateSubmission(17)).toEqual({ ok: 1, warnings: 0, errors: 1, duplicates: 1 });
    expect(written(db)[1].reasons.reasons).toEqual([
      'duplicate of row 1 (key "2073|1|2073-03-01|Home FC|Away FC")',
    ]);
  });

  it('names the FIRST row that claimed the record, not the latest, however many spellings follow', async () => {
    mocks.getDataset.mockReturnValue(matchSpec());
    const db = fakeValidationDb({
      start: { dataset: 'match_results', status: 'staged', version: '1' },
      rows: numbered(
        fixture(),
        fixture({ home_club: 'Home Alias' }),
        fixture({ home_club: 'Home Alias 2' }),
      ),
    });

    expect(await validateSubmission(17)).toEqual({ ok: 1, warnings: 0, errors: 2, duplicates: 2 });
    const reasons = written(db).map((v) => v.reasons.reasons[0]);
    expect(reasons[1]).toMatch(/^duplicate of row 1: /);
    expect(reasons[2]).toMatch(/^duplicate of row 1: /);
  });

  it('lets a refused row claim nothing even when it carries a resolved value', async () => {
    mocks.getDataset.mockReturnValue(matchSpecWithRefusedRow());
    const db = fakeValidationDb({
      start: { dataset: 'match_results', status: 'staged', version: '1' },
      rows: numbered(fixture({ venue: 'Refused' }), fixture({ home_club: 'Home Alias' })),
    });

    // Row 1 is refused (so it never claims the fixture); row 2 is then the first good row.
    expect(await validateSubmission(17)).toEqual({ ok: 1, warnings: 0, errors: 1, duplicates: 0 });
    expect(written(db).map((v) => v.verdict)).toEqual(['error', 'ok']);
  });

  it('keeps the cell-text reason for a repeat of a row that is also an alias duplicate', async () => {
    mocks.getDataset.mockReturnValue(matchSpec());
    const db = fakeValidationDb({
      start: { dataset: 'match_results', status: 'staged', version: '1' },
      rows: numbered(fixture(), fixture({ home_club: 'Home Alias' }), fixture({ round_code: '1' })),
    });

    // Row 3 repeats row 1 by cell text once the round is read canonically; row 2 is the alias.
    expect(await validateSubmission(17)).toEqual({ ok: 1, warnings: 0, errors: 2, duplicates: 2 });
    expect(written(db)[1].reasons.reasons[0]).toMatch(/^duplicate of row 1: the same record once names are resolved/);
    expect(written(db)[2].reasons.reasons[0]).toMatch(/^duplicate of row 1 \(key /);
  });

  it('marks the same player-match under two club spellings a duplicate', async () => {
    mocks.getDataset.mockReturnValue(statsSpec());
    const db = fakeValidationDb({
      start: { dataset: 'player_match_stats', status: 'staged', version: '1' },
      rows: numbered(
        statLine(),
        statLine({ home_club: 'Home Alias', club: 'Home Alias' }),
        statLine({ player: 'Other Player' }),
      ),
    });

    expect(await validateSubmission(17)).toEqual({ ok: 2, warnings: 0, errors: 1, duplicates: 1 });
    const [, second, third] = written(db);
    expect(second.reasons.reasons).toEqual([
      'duplicate of row 1: the same record once names are resolved (key "player #900 in match #500")',
    ]);
    expect(third).toMatchObject({ row_no: 3, verdict: 'ok' });
  });

  it('lets a failed row claim nothing, so a later good row is not called its duplicate', async () => {
    mocks.getDataset.mockReturnValue(statsSpec());
    const db = fakeValidationDb({
      start: { dataset: 'player_match_stats', status: 'staged', version: '1' },
      rows: numbered(statLine({ player: 'Nobody' }), statLine()),
    });

    expect(await validateSubmission(17)).toEqual({ ok: 1, warnings: 0, errors: 1, duplicates: 0 });
    expect(written(db).map((v) => v.verdict)).toEqual(['error', 'ok']);
  });

  it('leaves a dataset without a resolved key exactly as it was', async () => {
    mocks.getDataset.mockReturnValue(playerBioSpec());
    const db = fakeValidationDb({ rows: rowsOf('5', '6', '7') });

    expect(await validateSubmission(17)).toEqual({ ok: 3, warnings: 0, errors: 0, duplicates: 0 });
    expect(written(db).map((v) => v.verdict)).toEqual(['ok', 'ok', 'ok']);
  });
});
