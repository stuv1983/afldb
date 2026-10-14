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
 * These cases cover the parts the panel is built from -- when the control is
 * offered, what the confirm button posts, what the Server Action does with that
 * post, and the rendered control -- and then drive the real `ReplacePanel`
 * through preview, refusal, tick, resubmit and a different preview, by calling
 * the component function against a small hook harness. There is no DOM and no
 * browser, so the markup the page finally paints is not exercised. No database.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => ({ id: 9, email: 'admin@example.test' })),
  audit: vi.fn(async () => undefined),
  replaceAwardWinner: vi.fn(),
  replaceHallOfFameInductee: vi.fn(),
  replaceHonourTeamMember: vi.fn(),
  createAwardWinner: vi.fn(),
  createHallOfFameInductee: vi.fn(),
  createHonourTeamMember: vi.fn(),
  postgres: vi.fn(),
}));

// A minimal hook harness so the REAL `ReplacePanel` function can be driven
// without a DOM: while `active`, `useState`/`useRef` are slot-based, `useEffect`
// is inert, and the awards submit hook returns whatever state the case sets.
// Outside a harness case every hook is React's own.
const harness = vi.hoisted(() => ({
  active: false,
  slots: [] as unknown[],
  cursor: 0,
  actionState: {} as Record<string, unknown>,
  submit: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!harness.active) return actual.useState<unknown>(initial);
      const index = harness.cursor++;
      if (!(index in harness.slots)) {
        harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const set = (next: unknown) => {
        harness.slots[index] = typeof next === 'function'
          ? (next as (previous: unknown) => unknown)(harness.slots[index])
          : next;
      };
      return [harness.slots[index], set];
    },
    useRef: (initial: unknown) => {
      if (!harness.active) return actual.useRef<unknown>(initial);
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useEffect: (effect: () => void, deps?: unknown[]) => {
      if (!harness.active) actual.useEffect(effect, deps);
    },
  };
});

vi.mock('@/app/admin/awards/submit-helper', () => ({
  useAwardsActionSubmit: () => ({
    state: harness.actionState, isPending: false, submit: harness.submit,
  }),
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
  return {
    ...actual,
    replaceAwardWinner: mocks.replaceAwardWinner,
    replaceHallOfFameInductee: mocks.replaceHallOfFameInductee,
    replaceHonourTeamMember: mocks.replaceHonourTeamMember,
    createAwardWinner: mocks.createAwardWinner,
    createHallOfFameInductee: mocks.createHallOfFameInductee,
    createHonourTeamMember: mocks.createHonourTeamMember,
  };
});

import {
  createAwardWinnerAction,
  createHallOfFameAction,
  createHonourTeamMemberAction,
  replaceAwardWinnerAction,
  replaceHallOfFameAction,
  replaceHonourTeamAction,
} from '@/app/admin/awards/actions';
import type { HonourDomain } from '@/app/admin/awards/labels';
import {
  offersDuplicateConfirmation,
  ReplaceConfirmation,
  ReplacePanel,
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
  mocks.replaceHallOfFameInductee.mockReset();
  mocks.replaceHonourTeamMember.mockReset();
  mocks.createAwardWinner.mockReset();
  mocks.createHallOfFameInductee.mockReset();
  mocks.createHonourTeamMember.mockReset();
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

// ---------------------------------------------------------------------------
// The administrative note (AFLDB-ISSUE-283). The forms and the replace panel
// promise it is "kept with the audit entry"; the create actions never read it.
// What the query layer then writes is covered by the integration suites.
// ---------------------------------------------------------------------------

describe('the administrative note reaches the query layer apart from the record text (ISSUE-283)', () => {
  const created = { ok: true, rowId: 42, entityKey: 'award_winners:42', revalidatePaths: ['/awards'] };
  const form = (fields: Array<[string, string]>): FormData => {
    const data = new FormData();
    for (const [key, value] of fields) data.set(key, value);
    return data;
  };

  it('createAwardWinnerAction passes adminNote, and keeps the citation as the row note', async () => {
    mocks.createAwardWinner.mockResolvedValue(created);
    await createAwardWinnerAction({}, form([
      ['awardId', '4'], ['season', '1984'], ['playerId', '77'],
      ['note', 'public citation'], ['adminNote', 'checked against the club record'],
    ]));
    expect(mocks.createAwardWinner.mock.calls[0][0]).toMatchObject({
      adminUserId: 9, note: 'public citation', adminNote: 'checked against the club record',
    });
  });

  it('createHallOfFameAction passes adminNote, and keeps the biography as the row notes', async () => {
    mocks.createHallOfFameInductee.mockResolvedValue({ ...created, table: 'hall_of_fame' });
    await createHallOfFameAction({}, form([
      ['name', 'Test Inductee'], ['inductedYear', '2003'],
      ['notes', 'public biography'], ['adminNote', 'checked against the club record'],
    ]));
    expect(mocks.createHallOfFameInductee.mock.calls[0][0]).toMatchObject({
      adminUserId: 9, notes: 'public biography', adminNote: 'checked against the club record',
    });
  });

  it('createHonourTeamMemberAction passes adminNote, and keeps the selection note as the row note', async () => {
    mocks.createHonourTeamMember.mockResolvedValue({ ...created, table: 'honour_team_members' });
    await createHonourTeamMemberAction({}, form([
      ['teamName', 'Test Team'], ['playerId', '77'], ['sortOrder', '0'],
      ['note', 'public selection note'], ['adminNote', 'checked against the club record'],
    ]));
    expect(mocks.createHonourTeamMember.mock.calls[0][0]).toMatchObject({
      adminUserId: 9, note: 'public selection note', adminNote: 'checked against the club record',
    });
  });

  it('a create with no admin note passes none, rather than the record text', async () => {
    mocks.createAwardWinner.mockResolvedValue(created);
    await createAwardWinnerAction({}, form([
      ['awardId', '4'], ['season', '1984'], ['playerId', '77'], ['note', 'public citation'],
    ]));
    expect(mocks.createAwardWinner.mock.calls[0][0].adminNote ?? null).toBeNull();
  });

  it('the three replace actions pass the admin note as `note`, outside the replacement', async () => {
    const replaced = { ...created, voidedEntityKey: 'k', voidedRowId: 41, replacementId: 'r' };
    mocks.replaceAwardWinner.mockResolvedValue(replaced);
    mocks.replaceHallOfFameInductee.mockResolvedValue(replaced);
    mocks.replaceHonourTeamMember.mockResolvedValue(replaced);
    const base: Array<[string, string]> = [
      ['rowId', '41'], ['expectedUpdatedAt', '2026-10-14T00:00:00.000Z'],
      ['reason', 'recorded wrongly'], ['confirmReplace', '1'],
      ['adminNote', 'checked against the club record'],
    ];
    await replaceAwardWinnerAction({}, form([
      ...base, ['new:awardId', '4'], ['new:season', '1984'], ['new:playerId', '77'],
    ]));
    await replaceHallOfFameAction({}, form([
      ...base, ['new:name', 'Test Inductee'], ['new:inductedYear', '2003'],
    ]));
    await replaceHonourTeamAction({}, form([
      ...base, ['new:teamName', 'Test Team'], ['new:playerId', '77'], ['new:sortOrder', '0'],
    ]));
    for (const mock of [
      mocks.replaceAwardWinner, mocks.replaceHallOfFameInductee, mocks.replaceHonourTeamMember,
    ]) {
      const input = mock.mock.calls[0][0];
      expect(input.note).toBe('checked against the club record');
      expect(input.replacement).not.toHaveProperty('adminNote');
    }
  });
});

// ---------------------------------------------------------------------------
// The real ReplacePanel, driven through preview -> confirm -> refusal -> tick ->
// confirm -> back -> a different preview, by calling the component function
// against the hook harness above. No DOM and no browser: the elements it returns
// are inspected and their handlers called, so what is asserted is what the panel
// would send, not what its source text looks like.
// ---------------------------------------------------------------------------

type El = { type: unknown; props: Record<string, unknown> };
type ConfirmationProps = Parameters<typeof ReplaceConfirmation>[0];

const isEl = (node: unknown): node is El =>
  typeof node === 'object' && node !== null && 'type' in node && 'props' in node;

function findElement(node: unknown, matches: (el: El) => boolean): El | undefined {
  const hits: El[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    if (!isEl(current)) return;
    if (matches(current)) hits.push(current);
    visit(current.props.children);
  };
  visit(node);
  return hits[0];
}

/** `new FormData(form)` needs a DOM form; this stand-in reads the entries a case gives it. */
class FormDataFromEntries extends FormData {
  constructor(form?: { entries?: Array<[string, string]> }) {
    super();
    for (const [key, value] of form?.entries ?? []) this.append(key, value);
  }
}

const UPDATED_AT = '2026-10-14T00:00:00.000Z';

function startPanel(domain: HonourDomain) {
  harness.active = true;
  harness.slots = [];
  harness.cursor = 0;
  harness.actionState = {};
  harness.submit.mockReset();
  const props = {
    domain, rowId: 41, expectedUpdatedAt: UPDATED_AT,
    currentSummary: 'All-Australian 1985 — Test Player',
    awards: [], clubs: [], existingTeams: [],
  };
  const render = () => { harness.cursor = 0; return ReplacePanel(props); };
  const confirmation = (): ConfirmationProps => {
    const el = findElement(render(), (e) => e.type === ReplaceConfirmation);
    if (!el) throw new Error('the confirmation step is not showing');
    return el.props as unknown as ConfirmationProps;
  };
  const panel = {
    open() {
      const button = findElement(render(), (e) => e.type === 'button' && e.props.children === 'Replace this record…');
      (button?.props.onClick as () => void)();
    },
    /** Fill the first step and press "Preview the replacement…". */
    preview(fields: Array<[string, string]>) {
      const form = findElement(render(), (e) => e.type === 'form');
      if (!form) throw new Error('the details form is not showing');
      (form.props.onSubmit as (event: unknown) => void)({
        preventDefault: () => undefined,
        currentTarget: { entries: [['reason', 'recorded under the wrong season'], ...fields] },
      });
    },
    showsConfirmation: () => findElement(render(), (e) => e.type === ReplaceConfirmation) !== undefined,
    confirmation,
    /** Press "Confirm replacement" and return what was handed to the submit hook. */
    confirm(): FormData {
      confirmation().onConfirm();
      return harness.submit.mock.calls.at(-1)?.[0] as FormData;
    },
    /** The action answers with this state (a fresh object, as each response is). */
    respond(state: Record<string, unknown>) { harness.actionState = { ...state }; },
    submissions: () => harness.submit.mock.calls.length,
  };
  return panel;
}

const DUPLICATE_STATE = { error: DUPLICATE_MESSAGE, needsConfirmation: true, confirm: DUPLICATE_MESSAGE };
const WINNER_77: Array<[string, string]> = [['new:awardId', '4'], ['new:season', '1984'], ['new:playerId', '77']];
const WINNER_88: Array<[string, string]> = [['new:awardId', '4'], ['new:season', '1984'], ['new:playerId', '88']];

describe('ReplacePanel: the whole confirmation flow, driven as behaviour', () => {
  beforeEach(() => {
    vi.stubGlobal('FormData', FormDataFromEntries);
  });
  afterEach(() => {
    harness.active = false;
    vi.unstubAllGlobals();
  });

  it('confirms the first attempt without a duplicate confirmation', () => {
    const panel = startPanel('winners');
    panel.open();
    panel.preview(WINNER_77);
    expect(panel.confirmation().offerDuplicateConfirmation).toBe(false);

    const sent = panel.confirm();
    expect(sent.get('confirmReplace')).toBe('1');
    expect(sent.has('confirmDuplicate')).toBe(false);
    expect(sent.get('new:playerId')).toBe('77');
    expect(sent.get('rowId')).toBe('41');
  });

  it('offers the checkbox after a duplicate refusal, and ticking it resubmits the same preview with the confirmation', () => {
    const panel = startPanel('winners');
    panel.open();
    panel.preview(WINNER_77);
    panel.confirm();

    panel.respond(DUPLICATE_STATE);
    expect(panel.confirmation().offerDuplicateConfirmation).toBe(true);
    expect(panel.confirmation().duplicateConfirmed).toBe(false);

    // Pressing confirm again WITHOUT ticking still sends no confirmation.
    expect(panel.confirm().has('confirmDuplicate')).toBe(false);

    panel.respond(DUPLICATE_STATE);
    panel.confirmation().onDuplicateConfirmedChange(true);
    expect(panel.confirmation().duplicateConfirmed).toBe(true);

    const sent = panel.confirm();
    expect(sent.get('confirmDuplicate')).toBe('1');
    expect(sent.has('new:confirmDuplicate')).toBe(false);
    expect(sent.get('confirmReplace')).toBe('1');
    expect(sent.get('new:playerId')).toBe('77');
    expect(panel.submissions()).toBe(3);
  });

  it('does not carry a confirmation given for one player onto another player\'s preview', () => {
    const panel = startPanel('winners');
    panel.open();
    panel.preview(WINNER_77);
    panel.confirm();
    panel.respond(DUPLICATE_STATE);
    panel.confirmation().onDuplicateConfirmedChange(true);
    expect(panel.confirmation().duplicateConfirmed).toBe(true);

    // Back to the details, then a preview of a DIFFERENT player. The action
    // state still says needsConfirmation from player 77's refusal.
    panel.confirmation().onBack();
    expect(panel.showsConfirmation()).toBe(false);
    panel.preview(WINNER_88);
    expect(panel.confirmation().offerDuplicateConfirmation).toBe(false);
    expect(panel.confirmation().duplicateConfirmed).toBe(false);
    const first88 = panel.confirm();
    expect(first88.get('new:playerId')).toBe('88');
    expect(first88.has('confirmDuplicate')).toBe(false);

    // Player 88 is itself refused as a duplicate: the control comes back
    // UNTICKED, so the administrator has to confirm this one on its own.
    panel.respond(DUPLICATE_STATE);
    expect(panel.confirmation().offerDuplicateConfirmation).toBe(true);
    expect(panel.confirmation().duplicateConfirmed).toBe(false);
    const second88 = panel.confirm();
    expect(second88.get('new:playerId')).toBe('88');
    expect(second88.has('confirmDuplicate')).toBe(false);
  });

  it('does not send a ticked confirmation once the control is no longer offered', () => {
    const panel = startPanel('winners');
    panel.open();
    panel.preview(WINNER_77);
    panel.confirm();
    panel.respond(DUPLICATE_STATE);
    panel.confirmation().onDuplicateConfirmedChange(true);
    panel.confirm();

    // The next response is a different refusal: no needsConfirmation, so the
    // checkbox is gone and the earlier tick must not ride along.
    panel.respond({ error: 'That record changed while this page was open. Reload it and try again.' });
    expect(panel.confirmation().offerDuplicateConfirmation).toBe(false);
    expect(panel.confirm().has('confirmDuplicate')).toBe(false);
  });

  it.each([
    ['hall-of-fame', [['new:name', 'Test Inductee'], ['new:inductedYear', '2005']] as Array<[string, string]>],
    ['honour-teams', [['new:teamName', 'Test Team'], ['new:playerNameRaw', 'Test Member']] as Array<[string, string]>],
  ] as const)('never offers the checkbox for a %s replacement, whatever the action answers', (domain, fields) => {
    const panel = startPanel(domain);
    panel.open();
    panel.preview([...fields]);
    panel.confirm();
    panel.respond(DUPLICATE_STATE);
    expect(panel.confirmation().offerDuplicateConfirmation).toBe(false);
    expect(panel.confirm().has('confirmDuplicate')).toBe(false);
  });
});
