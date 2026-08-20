import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authSql: vi.fn(),
  audit: vi.fn(),
  requireAdmin: vi.fn(),
  requireSuperAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  promoteSubmission: vi.fn(),
  validateSubmission: vi.fn(),
}));

vi.mock('@/db/authClient', () => ({ authSql: mocks.authSql }));
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

import { decideSubmission } from '@/app/admin/submissions/[id]/actions';

function rejectionForm(id: number): FormData {
  const formData = new FormData();
  formData.set('id', String(id));
  formData.set('decision', 'reject');
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
