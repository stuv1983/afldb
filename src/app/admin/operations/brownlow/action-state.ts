import type { BrownlowEligibilityVerdict, BrownlowMedalStatus } from '@afldb/derived';

import type { OperationsActionState } from '../action-state';

/**
 * The serialisable state the Brownlow eligibility Server Action returns (AFLDB V2 Launch F F-D),
 * shaped for `useActionState`. Types only (every import is type-only and erased), so a Client
 * Component may import this module and no server-only module reaches a browser bundle. A
 * `'use server'` module can export nothing but async functions, hence this separate file.
 *
 * Plain JSON-compatible data throughout. `playerId` echoes the player the submitted form was about,
 * so a page carrying several decision forms can show field errors on the right one.
 */

/** The recomputed determination, in the compact form the action returns (the page holds the full view). */
export type BrownlowDeterminationSummary = {
  status: BrownlowMedalStatus;
  winners: { playerId: number; votes: number }[];
  tie: boolean | null;
  /** Players still needing review after the decision. */
  stillRequiringReview: number[];
  inputChecksum: string;
};

export type BrownlowEligibilityActionState = OperationsActionState & {
  /** The player the submitted form was about (set on success and on refusal). */
  playerId?: number;
  decision?: {
    id: number;
    season: number;
    verdict: BrownlowEligibilityVerdict;
    basis: 'open_season' | 'audited_correction';
    supersededId: number | null;
    decidedAt: string;
  };
  /** The determination recomputed after the decision; null when it could not be recomputed. */
  determination?: BrownlowDeterminationSummary | null;
};
