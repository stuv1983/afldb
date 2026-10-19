import type { ProposalRecord, ValidationIssue } from '@afldb/admin';

import type { ColemanComparisonView, ColemanPublicationResult } from '@/lib/admin/operations-centre';

/**
 * The serialisable states the operations-centre Server Actions return (AFLDB V2 Stage 5, plan D9),
 * shaped for `useActionState`. Types only: a `'use server'` module cannot export anything but async
 * functions, and a Client Component may import this module (every import here is type-only and is
 * erased, so no server-only module reaches a browser bundle).
 *
 * Every state is plain JSON-compatible data. A refusal sets `error` (words for people) and `code`
 * (the contract: an `OperationErrorCode`, or `invalid_input` for a form the action itself refused);
 * `fieldErrors` is keyed by the form field name. Success sets `ok: true` and `message`.
 * `auditWarning` is set only when the change was made but its activity-trail row was not written:
 * the operator must NOT resubmit.
 */
export type OperationsActionState = {
  ok?: boolean;
  error?: string;
  code?: string;
  /** For a `derivation_refused` Coleman publication: the derivation's own refusal code. */
  derivationCode?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  issues?: ValidationIssue[];
  auditWarning?: string;
};

/** The curated-award actions (`/admin/operations/awards/actions`). */
export type CuratedActionState = OperationsActionState & {
  /** Set by validate, approve and reject: the proposal after the transition. */
  proposal?: ProposalRecord;
  /** Set by create: every proposal created (all or none). */
  proposals?: ProposalRecord[];
  /** Validate only: which way the validation went. */
  validation?: 'validated' | 'validation_failed';
  /** Approve only: the durable `data_overrides` key of the `award_winners` row written. */
  entityKey?: string;
  /** Approve only: the season was sealed, so the approval was an audited correction. */
  sealedSeason?: boolean;
};

/** The Coleman actions (`/admin/operations/coleman/actions`). */
export type ColemanActionState = OperationsActionState & {
  /** Set by compare. */
  comparison?: ColemanComparisonView;
  /** Set by publish. */
  publication?: ColemanPublicationResult;
};

export const IDLE_OPERATIONS_STATE: OperationsActionState = {};
