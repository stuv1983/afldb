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

import { decideSubmission, runValidation } from '@/app/admin/submissions/[id]/actions';

// The module itself is mocked for the action tests above; the validation
// tests below need the real one, still wired to the mocked authSql/datasets.
const {
  validateSubmission, SubmissionChangedError, SubmissionNotValidatableError,
  INTAKE_VALIDATION_START_STATUSES, REVIEW_VALIDATION_START_STATUSES,
} = await vi.importActual<
  typeof import('@/lib/ingest/pipeline')
>('@/lib/ingest/pipeline');

function rejectionForm(id: number): FormData {
  const formData = new FormData();
  formData.set('id', String(id));
  formData.set('decision', 'reject');
  return formData;
}

function approvalForm(id: number): FormData {
  const formData = new FormData();
  formData.set('id', String(id));
  formData.set('decision', 'approve');
  return formData;
}

function compact(strings: TemplateStringsArray): string {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperAdmin.mockResolvedValue({ id: 9, email: 'admin@example.test' });
  mocks.audit.mockResolvedValue(undefined);
});

describe('submission rejection', () => {
  it('makes the permitted-state check and update one atomic statement', async () => {
    mocks.authSql.mockResolvedValue([{ id: 17 }]);

    const result = await decideSubmission({}, rejectionForm(17));

    expect(result).toEqual({ message: 'Rejected.' });
    expect(mocks.authSql).toHaveBeenCalledOnce();
    const [strings, ...values] = mocks.authSql.mock.calls[0];
    const query = compact(strings);
    expect(query).toContain("status IN ('staged', 'validated', 'approved')");
    expect(query).toContain('RETURNING id');
    expect(values).toEqual([9, 17]);
    expect(mocks.audit).toHaveBeenCalledWith(
      'submission.rejected',
      { submissionId: 17 },
      { userId: 9, label: 'admin@example.test' },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/submissions/17');
  });

  it('does not claim or audit success when a stale or missing row updates nothing', async () => {
    mocks.authSql.mockResolvedValue([]);

    const result = await decideSubmission({}, rejectionForm(17));

    expect(result).toEqual({
      error: 'Only a staged, validated, or approved submission can be rejected.',
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

type Tag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

/** Install `begin` (runs the callback against `tx`) on the mocked authSql. */
function installBegin(tx: Tag) {
  const begin = vi.fn(async (callback: (t: unknown) => unknown) => callback(tx));
  Object.assign(mocks.authSql, { begin });
  return begin;
}

describe('submission approval (AFLDB-ISSUE-273)', () => {
  it('locks the submission before the guarded approval, in one transaction', async () => {
    const tx = vi.fn<Tag>()
      .mockResolvedValueOnce([{ id: 17 }])
      .mockResolvedValueOnce([{ id: 17 }]);
    installBegin(tx);

    const result = await decideSubmission({}, approvalForm(17));

    expect(result).toEqual({ message: 'Approved.' });
    expect(mocks.authSql).not.toHaveBeenCalled();
    expect(tx).toHaveBeenCalledTimes(2);
    expect(compact(tx.mock.calls[0][0])).toBe('SELECT id FROM data_submissions WHERE id = ? FOR UPDATE');
    const update = compact(tx.mock.calls[1][0]);
    expect(update).toMatch(/^UPDATE data_submissions SET status = 'approved'/);
    expect(update).toContain("AND status = 'validated'");
    expect(update).toContain("(r.verdict = 'error' OR r.verdict IS NULL)");
    expect(update).toContain('RETURNING id');
  });

  it('does not audit an approval the guarded update refused', async () => {
    const tx = vi.fn<Tag>().mockResolvedValueOnce([{ id: 17 }]).mockResolvedValueOnce([]);
    installBegin(tx);

    const result = await decideSubmission({}, approvalForm(17));

    expect(result).toEqual({ error: 'Only a validated submission with no error rows can be approved.' });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('manual validation (AFLDB-ISSUE-273)', () => {
  it('keeps the review page on the default start policy, which admits a rejected file', async () => {
    mocks.requireAdmin.mockResolvedValue({ id: 9, email: 'admin@example.test' });
    mocks.validateSubmission.mockResolvedValue({ ok: 1, warnings: 0, errors: 0, duplicates: 0 });
    const form = new FormData();
    form.set('id', '17');

    expect(await runValidation({}, form)).toEqual({ message: 'Validated: 1 ok, 0 warnings, 0 errors.' });
    // No policy passed: REVIEW_VALIDATION_START_STATUSES, pinned below.
    expect(mocks.validateSubmission).toHaveBeenCalledWith(17);
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
