'use client';

import type { ProposalRecord } from '@afldb/admin';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, type FormEvent } from 'react';

import {
  IDLE_OPERATIONS_STATE,
  type ColemanActionState,
  type CuratedActionState,
  type OperationsActionState,
} from '../action-state';
import {
  approveCuratedProposalAction,
  createCuratedProposalsAction,
  rejectCuratedProposalAction,
  reviseApprovedProposalAction,
  validateCuratedProposalAction,
} from '../awards/actions';
import { compareColemanSeasonAction, publishColemanSeasonAction } from '../coleman/actions';

import {
  ColemanWorkbenchView,
  CreateProposalsFormView,
  DecisionPanelView,
  type FormBinding,
} from './OperationForms';
import { ReviseApprovedPanelView } from './ReviseApprovedViews';

/**
 * The Client Component wrappers of the operations-centre forms (AFLDB V2 Stage 5, plan D9).
 *
 * Each wrapper binds a Server Action to its pure view in `OperationForms.tsx` with `useActionState`
 * and the repository's `startTransition(() => dispatch(formData))` pattern (see
 * `src/components/admin/action-submit.ts`): the submit is intercepted, the form is NOT reset on a
 * refusal (a rejected note is not lost), and after a MUTATION succeeds the route is refreshed with
 * `router.refresh()`. There is no `revalidatePath` anywhere near a Server Action (it hangs the
 * client here); every operations page is `force-dynamic`, so a refresh is all it needs.
 *
 * The wrappers stay mounted across the refresh (same tree position), so the outcome of an approval
 * or rejection is still on screen after the proposal's status has changed underneath it.
 *
 * Only erased types, the action references and pure views are imported: no server-only module can
 * reach the browser through this file.
 */

type ServerAction<S> = (previous: S, formData: FormData) => Promise<S>;

/**
 * Post the server-computed public paths to a capability-gated, allowlisted revalidate route, AFTER
 * the action resolved (the awards pattern, `src/components/admin/action-submit.ts`). Best-effort: the
 * write has already committed, so a missed invalidation only leaves a public page stale until its
 * ISR window expires.
 */
async function postRevalidatePaths(endpoint: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
  } catch {
    // Best-effort, see above.
  }
}

/** `useActionState` + the submit interception shared by every form here. */
function useOperationsAction<S extends OperationsActionState>(
  action: ServerAction<S>,
  initial: S,
  options: { refreshOnSuccess: boolean; revalidateEndpoint?: string },
): FormBinding<S> {
  const router = useRouter();
  // `useActionState`'s own generic resolves `Awaited<State>`, which does not simplify back to `S`
  // for a caller-supplied bound, so it is instantiated at the concrete base shape and cast back out
  // (the same workaround as src/components/admin/action-submit.ts). `action` and `initial` are
  // already typed against `S`, so the values React carries are never anything else.
  const wrapped = async (previous: OperationsActionState, formData: FormData): Promise<OperationsActionState> => {
    const result = await action(previous as S, formData);
    if (result.ok === true && options.revalidateEndpoint !== undefined) {
      await postRevalidatePaths(options.revalidateEndpoint, (result as { revalidatePaths?: string[] }).revalidatePaths ?? []);
    }
    if (result.ok === true && options.refreshOnSuccess) router.refresh();
    return result;
  };
  const [current, dispatch, pending] = useActionState<OperationsActionState, FormData>(wrapped, initial);
  const state = current as S;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    // The submitter carries `intent`, so the decision form knows which of its buttons was pressed.
    const data = submitter instanceof HTMLElement ? new FormData(form, submitter) : new FormData(form);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}

export function CreateProposalsForm({ actingEmail }: { actingEmail: string }) {
  const binding = useOperationsAction<CuratedActionState>(
    createCuratedProposalsAction, IDLE_OPERATIONS_STATE, { refreshOnSuccess: true },
  );
  return <CreateProposalsFormView actingEmail={actingEmail} binding={binding} />;
}

type DecisionIntent = 'validate' | 'approve' | 'reject';

const DECISION_ACTIONS: Record<DecisionIntent, ServerAction<CuratedActionState>> = {
  validate: validateCuratedProposalAction,
  approve: approveCuratedProposalAction,
  reject: rejectCuratedProposalAction,
};

/** One form, three buttons: the pressed button's `intent` picks the Server Action. */
async function decide(previous: CuratedActionState, formData: FormData): Promise<CuratedActionState> {
  const intent = formData.get('intent');
  if (intent !== 'validate' && intent !== 'approve' && intent !== 'reject') {
    return { error: 'Choose validate, approve or reject.', code: 'invalid_input' };
  }
  return DECISION_ACTIONS[intent](previous, formData);
}

/** An approval changes public award pages: its server-computed paths go to the awards revalidate route. */
const AWARDS_REVALIDATE_ENDPOINT = '/admin/awards/revalidate';

export function DecisionPanel({
  proposal, actingEmail, sealedSeason, viewerCreatedRevision = false,
}: {
  proposal: ProposalRecord;
  actingEmail: string;
  sealedSeason: boolean | null;
  /** V2-GAP-019: the signed-in administrator created this revision (the attestation field is shown). */
  viewerCreatedRevision?: boolean;
}) {
  const binding = useOperationsAction<CuratedActionState>(
    decide, IDLE_OPERATIONS_STATE, { refreshOnSuccess: true, revalidateEndpoint: AWARDS_REVALIDATE_ENDPOINT },
  );
  return (
    <DecisionPanelView
      proposal={proposal}
      actingEmail={actingEmail}
      sealedSeason={sealedSeason}
      binding={binding}
      viewerCreatedRevision={viewerCreatedRevision}
    />
  );
}

/**
 * The revise-approved panel (V2-GAP-018). After a successful revision the superseded revision's page
 * is stale (the newest revision has a new id), so it moves to the new revision instead of refreshing in
 * place; this wrapper stays mounted across that navigation and keeps the outcome on screen.
 */
export function ReviseApprovedPanel({
  proposal, actingEmail, sealedSeason,
}: {
  proposal: ProposalRecord;
  actingEmail: string;
  sealedSeason: boolean | null;
}) {
  const router = useRouter();
  const binding = useOperationsAction<CuratedActionState>(
    reviseApprovedProposalAction, IDLE_OPERATIONS_STATE,
    { refreshOnSuccess: false, revalidateEndpoint: AWARDS_REVALIDATE_ENDPOINT },
  );
  const revisedId = binding.state.ok === true ? binding.state.proposal?.id : undefined;
  useEffect(() => {
    if (revisedId !== undefined && revisedId !== proposal.id) router.replace(`/admin/operations/awards/${revisedId}`);
  }, [revisedId, proposal.id, router]);
  return <ReviseApprovedPanelView proposal={proposal} actingEmail={actingEmail} sealedSeason={sealedSeason} binding={binding} />;
}

export function ColemanWorkbench({
  canPublish, actingEmail, defaultSeason,
}: {
  canPublish: boolean;
  actingEmail: string;
  defaultSeason: number | null;
}) {
  // Compare is read-only: it needs no refresh. Publishing changes the list of publications above.
  const compare = useOperationsAction<ColemanActionState>(
    compareColemanSeasonAction, IDLE_OPERATIONS_STATE, { refreshOnSuccess: false },
  );
  // The projection changes public award pages: post the server-computed paths to the awards route.
  const publish = useOperationsAction<ColemanActionState>(
    publishColemanSeasonAction, IDLE_OPERATIONS_STATE, { refreshOnSuccess: true, revalidateEndpoint: '/admin/awards/revalidate' },
  );
  return (
    <ColemanWorkbenchView
      canPublish={canPublish}
      actingEmail={actingEmail}
      defaultSeason={defaultSeason}
      compare={compare}
      publish={publish}
    />
  );
}
