'use client';

import { useActionState } from 'react';

import {
  decideSubmission,
  runPromotion,
  runValidation,
  type ReviewState,
} from '@/app/admin/submissions/[id]/actions';

/**
 * The workflow buttons, enabled strictly by state:
 *
 *   staged     -> Validate
 *   validated  -> Validate again · Approve · Reject
 *   approved   -> Promote · Reject
 *   promoted   -> Validate again (for a re-run after a corrected upload)
 *   rejected   -> Validate again
 *   failed     -> Promote again (the transaction rolled back)
 *
 * The server re-checks every transition; these buttons are affordances,
 * not authority.
 */
export function ReviewControls({ id, status }: { id: number; status: string }) {
  const [validateState, validateAction, validating] =
    useActionState<ReviewState, FormData>(runValidation, {});
  const [decideState, decideAction, deciding] =
    useActionState<ReviewState, FormData>(decideSubmission, {});
  const [promoteState, promoteAction, promoting] =
    useActionState<ReviewState, FormData>(runPromotion, {});

  const busy = validating || deciding || promoting;
  const canValidate = ['staged', 'validated', 'rejected'].includes(status);
  const canDecide = status === 'validated';
  const canReject = ['staged', 'validated', 'approved'].includes(status);
  const canPromote = status === 'approved' || status === 'failed';

  return (
    <section className="section">
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {canValidate && (
          <form action={validateAction}>
            <input type="hidden" name="id" value={id} />
            <button className="btn btn-secondary" type="submit" disabled={busy}>
              {validating ? 'Validating…' : 'Validate'}
            </button>
          </form>
        )}
        {canDecide && (
          <form action={decideAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="approve" />
            <button className="btn" type="submit" disabled={busy}>
              {deciding ? 'Working…' : 'Approve'}
            </button>
          </form>
        )}
        {canPromote && (
          <form action={promoteAction}>
            <input type="hidden" name="id" value={id} />
            <button className="btn" type="submit" disabled={busy}>
              {promoting ? 'Promoting…' : 'Promote to database'}
            </button>
          </form>
        )}
        {canReject && (
          <form action={decideAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="reject" />
            <button className="btn btn-secondary" type="submit" disabled={busy}>
              Reject
            </button>
          </form>
        )}
      </div>

      {[validateState, decideState, promoteState].map((state, i) => (
        state.error
          ? <p key={i} className="notice" role="alert">{state.error}</p>
          : state.message
            ? <p key={i} className="notice">{state.message}</p>
            : null
      ))}
    </section>
  );
}
