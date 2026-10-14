/**
 * The award Replace panel can give the duplicate confirmation its action
 * requires (AFLDB-ISSUE-285).
 *
 * A replacement that names a player who already holds an active row for the
 * replacement's award and season is refused as `duplicate`; the action answers
 * `needsConfirmation: true` and only proceeds when `confirmDuplicate` is posted.
 * `ReplacePanel` had no control that could post it, so the legitimate case (the
 * 1984 All-Australian club and state selections, R-5) could not be expressed.
 *
 * These cases cover the three parts the panel is built from -- when the control
 * is offered, what the confirm button posts, and what the Server Action does
 * with that post -- plus the rendered control. The panel's own React state
 * transitions are not exercised (no DOM in this suite); the source-contract
 * case pins that the panel is wired through them. No database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => ({ id: 9, email: 'admin@example.test' })),
  audit: vi.fn(async () => undefined),
  replaceAwardWinner: vi.fn(),
  postgres: vi.fn(),
}));

vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('@/db/client', () => ({ sql: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth/session', () => ({
  requireCapability: mocks.requireCapability,
  audit: mocks.audit,
}));
vi.mock('@/db/queries/admin-awards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries/admin-awards')>();
  return { ...actual, replaceAwardWinner: mocks.replaceAwardWinner };
});

import { replaceAwardWinnerAction } from '@/app/admin/awards/actions';
import {
  offersDuplicateConfirmation,
  ReplaceConfirmation,
  withReplaceConfirmation,
} from '@/app/admin/awards/ReplacePanel';

const DUPLICATE_MESSAGE = 'That player already holds a row for this award and season.';

/** What the panel's preview step collects before the confirm button adds its flags. */
function previewData(): FormData {
  const data = new FormData();
  data.set('rowId', '41');
  data.set('expectedUpdatedAt', '2026-10-14T00:00:00.000Z');
  data.set('reason', 'recorded under the wrong season');
  data.set('new:awardId', '4');
  data.set('new:season', '1984');
  data.set('new:playerId', '77');
  return data;
}

function confirmation(over: Partial<Parameters<typeof ReplaceConfirmation>[0]> = {}) {
  return renderToStaticMarkup(createElement(ReplaceConfirmation, {
    currentSummary: 'All-Australian 1985 — Test Player',
    reason: 'recorded under the wrong season',
    summary: ['Award: All-Australian', 'Season: 1984'],
    offerDuplicateConfirmation: false,
    duplicateConfirmed: false,
    onDuplicateConfirmedChange: () => undefined,
    isPending: false,
    onConfirm: () => undefined,
    onBack: () => undefined,
    ...over,
  }));
}

beforeEach(() => {
  mocks.replaceAwardWinner.mockReset();
});

describe('ReplaceConfirmation: the duplicate checkbox', () => {
  it('renders the confirmation control when it is offered', () => {
    const html = confirmation({ offerDuplicateConfirmation: true });
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="confirmDuplicate"');
    expect(html).toContain('this really is a second, separate selection');
    expect(html).not.toMatch(/\bchecked(=|\s|>)/);
  });

  it('shows the control ticked once the administrator ticks it', () => {
    const html = confirmation({ offerDuplicateConfirmation: true, duplicateConfirmed: true });
    expect(html).toMatch(/\bchecked(=|\s|>)/);
  });

  it('does not render the control when it is not offered', () => {
    const html = confirmation({ offerDuplicateConfirmation: false });
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('confirmDuplicate');
    // Both halves of the replacement are still shown.
    expect(html).toContain('All-Australian 1985');
    expect(html).toContain('Season: 1984');
    expect(html).toContain('Confirm replacement');
  });
});

describe('offersDuplicateConfirmation: when the control is offered', () => {
  const pending = { id: 'preview-1' };

  it('offers it for the refused award-winner preview', () => {
    expect(offersDuplicateConfirmation('winners', { needsConfirmation: true }, pending, pending)).toBe(true);
  });

  it.each(['hall-of-fame', 'honour-teams'] as const)(
    'never offers it for %s, whose actions do not read confirmDuplicate',
    (domain) => {
      expect(offersDuplicateConfirmation(domain, { needsConfirmation: true }, pending, pending)).toBe(false);
    },
  );

  it('does not offer it without a duplicate refusal', () => {
    expect(offersDuplicateConfirmation('winners', {}, pending, pending)).toBe(false);
    expect(offersDuplicateConfirmation('winners', { needsConfirmation: false }, pending, pending)).toBe(false);
  });

  it('does not offer it for a different preview than the one refused', () => {
    // The state flag outlives "Back to the details"; a new preview of another
    // player must not inherit a confirmation given for the earlier one.
    expect(offersDuplicateConfirmation('winners', { needsConfirmation: true }, pending, { id: 'preview-2' })).toBe(false);
    expect(offersDuplicateConfirmation('winners', { needsConfirmation: true }, null, pending)).toBe(false);
  });

  it('does not offer it when no preview is showing', () => {
    expect(offersDuplicateConfirmation('winners', { needsConfirmation: true }, null, null)).toBe(false);
  });
});

describe('withReplaceConfirmation: what the confirm button posts', () => {
  it('always sets confirmReplace', () => {
    const data = withReplaceConfirmation(previewData(), false);
    expect(data.get('confirmReplace')).toBe('1');
  });

  it('posts confirmDuplicate, unprefixed, only when it was ticked', () => {
    const ticked = withReplaceConfirmation(previewData(), true);
    expect(ticked.get('confirmDuplicate')).toBe('1');
    expect(ticked.has('new:confirmDuplicate')).toBe(false);

    const unticked = withReplaceConfirmation(previewData(), false);
    expect(unticked.has('confirmDuplicate')).toBe(false);
  });

  it('removes a confirmation left on the same data by an earlier attempt', () => {
    const data = withReplaceConfirmation(previewData(), true);
    withReplaceConfirmation(data, false);
    expect(data.has('confirmDuplicate')).toBe(false);
    expect(data.get('confirmReplace')).toBe('1');
  });
});

describe('replaceAwardWinnerAction: the round trip the panel makes', () => {
  const refusal = { ok: false, reason: 'duplicate', error: DUPLICATE_MESSAGE };
  const success = {
    ok: true, rowId: 42, entityKey: 'award_winners:42', revalidatePaths: ['/awards'],
  };

  it('answers a duplicate with a refusal the panel can confirm', async () => {
    mocks.replaceAwardWinner.mockResolvedValue(refusal);
    const state = await replaceAwardWinnerAction({}, withReplaceConfirmation(previewData(), false));
    expect(state).toMatchObject({ error: DUPLICATE_MESSAGE, needsConfirmation: true });
    expect(mocks.replaceAwardWinner.mock.calls[0][0].replacement.confirmDuplicate).toBe(false);
  });

  it('carries the ticked confirmation into the replacement, and the second submission succeeds', async () => {
    mocks.replaceAwardWinner.mockResolvedValueOnce(refusal).mockResolvedValueOnce(success);
    const data = previewData();

    const first = await replaceAwardWinnerAction({}, withReplaceConfirmation(data, false));
    expect(first.needsConfirmation).toBe(true);

    const second = await replaceAwardWinnerAction({}, withReplaceConfirmation(data, true));
    expect(second).toMatchObject({ ok: true, createdId: 42 });
    const input = mocks.replaceAwardWinner.mock.calls[1][0];
    expect(input.replacement.confirmDuplicate).toBe(true);
    expect(input.replacement).toMatchObject({ awardId: 4, season: 1984, playerId: 77 });
    expect(input).toMatchObject({ rowId: 41, adminUserId: 9 });
  });
});

describe('ReplacePanel wiring', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'app', 'admin', 'awards', 'ReplacePanel.tsx'), 'utf8',
  );

  it('confirms through the helpers and hands the control to the confirmation step', () => {
    expect(source).toContain('withReplaceConfirmation(pending.data, offerDuplicateConfirmation && duplicateConfirmed)');
    expect(source).toContain('offerDuplicateConfirmation={offerDuplicateConfirmation}');
    expect(source).toContain('onDuplicateConfirmedChange={setDuplicateConfirmed}');
    // The flag is never set by default, and never survives a new preview.
    expect(source).toContain('useState(false)');
    expect(source).toMatch(/setDuplicateConfirmed\(false\);\s*setPending\(\{ data, summary: describe\(data\) \}\)/);
    // The old unconditional flag write is gone.
    expect(source).not.toContain("pending.data.set('confirmReplace', '1')");
  });
});
