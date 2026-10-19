/**
 * AFLDB V2 Stage 5 (plan D9, ADR 0009, risk R-006) — the operations centre's FRONTEND CONTRACT.
 *
 * What is proven here, and on what:
 *  - the D9 action card (`describeConsequences`): all six fields for every mutation kind, "not
 *    reversible" for approve and reject, and no drift from the server module's audit action names,
 *    the service's rejection-reason rule or the domain's seal-note bounds;
 *  - every presentational component renders from SYNTHETIC props (tests/fixtures/v2/operations-centre)
 *    with `react-dom/server`, in its populated, empty, read-only and failed states, and NEVER contains
 *    a retired control label;
 *  - every page module: the expected `dynamic` and `robots`, a default async component, its capability
 *    guard called FIRST (before any read) with the right capability, a viewer without the capability
 *    refused before anything is read, and a failing read showing an inline notice instead of taking
 *    the page down;
 *  - the page loaders isolate their reads (fakes) and never render a thrown error's message.
 *
 * What is NOT proven: any real browser rendering, any CSS, any database. The pages need a database and
 * a session, which this workstation lacks; the operations-centre callers are replaced here by fakes
 * (their behaviour is tested in tests/v2-admin-operations.test.ts). Visual evidence is a separate step.
 * EVERY FIXTURE IS SYNTHETIC (tests/fixtures/v2/operations-centre/props.synthetic.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDecisionNote } from '@afldb/admin';
import { COVERAGE_REGISTRY, CORRECTION_NOTE_MAX_LENGTH, CORRECTION_NOTE_MIN_LENGTH } from '@afldb/domain';

import {
  ProposalEvidence,
  ProposalHistoryView,
  ProposalQueueTable,
  ProposalValidation,
  ProposalValues,
  QueueFilterBar,
} from '@/app/admin/operations/_components/AwardsViews';
import {
  BrownlowCaveats,
  BrownlowReportView,
  BrownlowSeasonPicker,
} from '@/app/admin/operations/_components/BrownlowViews';
import { ActionConsequences } from '@/app/admin/operations/_components/ActionConsequences';
import { ColemanComparisonResult, ColemanPublicationsTable } from '@/app/admin/operations/_components/ColemanViews';
import {
  ColemanWorkbenchView,
  CreateProposalsFormView,
  DecisionPanelView,
} from '@/app/admin/operations/_components/OperationForms';
import { ReviseApprovedPanelView, ReviseApprovedUnavailable } from '@/app/admin/operations/_components/ReviseApprovedViews';
import {
  AcquisitionRunsSection,
  CuratedDerivedSection,
  DataHealthSection,
  InspectionToolsSection,
  MaintenanceSection,
  OperationsHeader,
  SealedSeasonsSection,
} from '@/app/admin/operations/_components/OverviewSections';
import { ActionOutcome } from '@/app/admin/operations/_components/Shared';
import {
  CONSEQUENCE_AUDIT_ACTIONS,
  CONSEQUENCE_KINDS,
  REJECT_REASON_MIN_LENGTH,
  SEAL_NOTE_MAX_LENGTH,
  SEAL_NOTE_MIN_LENGTH,
  describeConsequences,
} from '@/app/admin/operations/consequences';
import {
  COVERAGE_UNAVAILABLE,
  READ_UNAVAILABLE,
  SEASON_REGISTRY_UNAVAILABLE,
  loadAwardsQueue,
  loadBrownlowReport,
  loadColemanPage,
  loadOperationsOverview,
  loadProposalPage,
  type PageDeps,
} from '@/app/admin/operations/page-data';
import {
  parseBrownlowQuery,
  parseQueueFilter,
  parseRouteId,
  summariseCoverage,
} from '@/app/admin/operations/views';
import { hasCapability, type Capability } from '@/lib/auth/capabilities';
import type { AdminUser } from '@/lib/auth/session';

import {
  SYNTHETIC_PLAIN_ADMIN,
  SYNTHETIC_PUBLICATION,
  SYNTHETIC_QUEUE,
  SYNTHETIC_REFUSED_STATE,
  SYNTHETIC_SEASON_REGISTRY,
  SYNTHETIC_SUPER_ADMIN,
  SYNTHETIC_UNIT_STATUSES,
  syntheticBrownlowReport,
  syntheticColemanComparison,
  syntheticHistory,
  syntheticOverview,
  syntheticOverviewReadsFailed,
  syntheticProposal,
} from './fixtures/v2/operations-centre/props.synthetic';

/* ---------------------------------------------------------------------------------------------
 * Mocks: the session guard, the operations-centre callers (their own suite proves them), the
 * settle status (needs systemd and a database) and next/navigation. Everything else is real.
 * ------------------------------------------------------------------------------------------- */

const session = vi.hoisted(() => ({
  actor: null as null | { id: number; email: string; role: 'contributor' | 'admin' | 'super_admin'; canManageAdmins: boolean; mustChangePassword: boolean },
}));

vi.mock('@/lib/auth/session', async () => {
  const { hasCapability: realHasCapability } = await import('@/lib/auth/capabilities');
  return {
    requireCapability: vi.fn(async (capability: Capability) => {
      if (session.actor === null || !realHasCapability(session.actor, capability)) throw new Error('NEXT_REDIRECT');
      return session.actor;
    }),
    audit: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/admin/operations-centre', () => ({
  listCuratedQueue: vi.fn(),
  readCuratedHistory: vi.fn(),
  listColemanPublicationsForAdmin: vi.fn(),
  reconcileBrownlowSeasonForAdmin: vi.fn(),
  approveCurated: vi.fn(),
  createCuratedFromFile: vi.fn(),
  rejectCurated: vi.fn(),
  validateCurated: vi.fn(),
  compareColemanSeason: vi.fn(),
  publishColemanSeason: vi.fn(),
}));

vi.mock('@/lib/acquisition/settle-status', () => ({
  readSettleUnitTableStatus: vi.fn(),
  readSettleRunStatus: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const { requireCapability } = await import('@/lib/auth/session');
const ops = await import('@/lib/admin/operations-centre');
const settle = await import('@/lib/acquisition/settle-status');
const guardMock = vi.mocked(requireCapability);
const opsMocks = vi.mocked(ops);
const settleMocks = vi.mocked(settle);

const SUPER_USER: AdminUser = { ...SYNTHETIC_SUPER_ADMIN };
const PLAIN_ADMIN: AdminUser = { ...SYNTHETIC_PLAIN_ADMIN };

/* ---------------------------------------------------------------------------------------------
 * Rendering helpers. Every markup string rendered anywhere is kept so the LAST test can prove that
 * no retired control label appears in any of it.
 * ------------------------------------------------------------------------------------------- */

const RENDERED: string[] = [];

function html(element: ReactElement): string {
  const markup = renderToStaticMarkup(element);
  RENDERED.push(markup);
  return markup;
}

const noopBinding = { state: {}, pending: false } as const;

/** Whether the decision button for `intent` carries `disabled` (attribute order is React's, so read the tag). */
function decisionButtonDisabled(markup: string, intent: string): boolean {
  const tag = new RegExp(`<button[^>]*value="${intent}"[^>]*>`).exec(markup);
  expect(tag, `the ${intent} button`).not.toBeNull();
  return /\sdisabled(=|\s|>)/.test(tag![0]);
}

/** Index of `needle` in `markup`; fails loudly when absent so an order assertion is never vacuous. */
function at(markup: string, needle: string): number {
  const index = markup.indexOf(needle);
  expect(index, `expected the markup to contain ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
  return index;
}

/* =============================================================================================
 * 1. The D9 action card
 * =========================================================================================== */
describe('describeConsequences: the six D9 fields for every mutation', () => {
  const FULL_CONTEXT = {
    actingEmail: 'synthetic.super@example.invalid',
    proposalId: 501,
    season: 2024,
    proposalStatus: 'validated',
    sealedSeason: true,
  } as const;

  it.each(CONSEQUENCE_KINDS)('%s states what changes, what is affected, the validation state, reversibility, the actor and the audit entries', (kind) => {
    const c = describeConsequences(kind, FULL_CONTEXT);
    expect(c.kind).toBe(kind);
    expect(c.title.length).toBeGreaterThan(5);
    expect(c.changes.length, 'what it will change').toBeGreaterThanOrEqual(1);
    for (const change of c.changes) expect(change.trim().length).toBeGreaterThan(10);
    expect(c.affected.trim().length, 'the affected season or records').toBeGreaterThan(10);
    expect(c.validationState.trim().length, 'the validation state').toBeGreaterThan(10);
    expect(typeof c.reversible).toBe('boolean');
    expect(c.reversibility.trim().length, 'reversibility').toBeGreaterThan(10);
    expect(c.actingUser, 'the acting user').toContain('synthetic.super@example.invalid');
    expect(c.audit.durable.trim().length, 'the durable audit').toBeGreaterThan(10);
    expect(c.audit.activity.trim().length, 'the activity-trail audit').toBeGreaterThan(10);
    expect(c.audit.activityActions.length).toBeGreaterThanOrEqual(2);
    for (const action of c.audit.activityActions) expect(c.audit.activity).toContain(action);
  });

  it('approve and reject say "not reversible"; the Coleman publication is not undone either; create and validate are reversible', () => {
    for (const kind of ['approve_proposal', 'reject_proposal'] as const) {
      const c = describeConsequences(kind, FULL_CONTEXT);
      expect(c.reversible, kind).toBe(false);
      expect(c.reversibility, kind).toMatch(/^Not reversible/);
    }
    expect(describeConsequences('publish_coleman', FULL_CONTEXT).reversible).toBe(false);
    expect(describeConsequences('create_proposals', FULL_CONTEXT).reversible).toBe(true);
    expect(describeConsequences('validate_proposal', FULL_CONTEXT).reversible).toBe(true);
  });

  it('works with no context at all: every field is still non-empty and the actor is stated honestly', () => {
    for (const kind of CONSEQUENCE_KINDS) {
      const c = describeConsequences(kind);
      expect(c.actingUser).toMatch(/signed-in administrator/);
      expect(c.affected.length).toBeGreaterThan(10);
      expect(c.validationState.length).toBeGreaterThan(10);
    }
  });

  it('approval states whether the season is sealed (and the note it then needs), open, or unknown (fail closed)', () => {
    expect(describeConsequences('approve_proposal', { ...FULL_CONTEXT, sealedSeason: true }).affected)
      .toMatch(new RegExp(`SEALED.*${SEAL_NOTE_MIN_LENGTH} to ${SEAL_NOTE_MAX_LENGTH} characters`));
    expect(describeConsequences('approve_proposal', { ...FULL_CONTEXT, sealedSeason: false }).affected).toMatch(/open \(in progress\)/);
    expect(describeConsequences('approve_proposal', { ...FULL_CONTEXT, sealedSeason: null }).affected).toMatch(/fails closed/);
  });

  it('approval names the status it needs, and the Coleman card carries the last comparison of the session', () => {
    expect(describeConsequences('approve_proposal', { ...FULL_CONTEXT, proposalStatus: 'proposed' }).validationState)
      .toMatch(/Requires status "validated" \(current: proposed/);
    expect(describeConsequences('publish_coleman').validationState).toMatch(/No comparison has been run/);
    const withComparison = describeConsequences('publish_coleman', {
      comparison: { season: 2024, category: 'agree', plan: 'unchanged', sealed: true },
    });
    expect(withComparison.validationState).toMatch(/season 2024.*agree with.*"unchanged"/);
    expect(describeConsequences('publish_coleman', {
      comparison: { season: 2024, category: 'not_derivable', plan: null, sealed: true },
    }).validationState).toMatch(/NOT derivable.*refused/);
  });

  it('the Coleman card states the award_winners effect, the sealed-season note, reversibility and the audit rows BEFORE submit', () => {
    const none = describeConsequences('publish_coleman');
    expect(none.changes.join(' ')).toMatch(/award_winners/);
    expect(none.changes.join(' ')).toMatch(/Run the read-only comparison first/);
    expect(none.validationState).toMatch(new RegExp(`settled attestation and a note of ${SEAL_NOTE_MIN_LENGTH} to ${SEAL_NOTE_MAX_LENGTH} characters`));
    expect(none.reversibility).toMatch(/^Not reversible in place.*later publish.*never a delete/);
    expect(none.audit.durable).toMatch(/derived_award_projections.*data_edits/);

    const previewed = describeConsequences('publish_coleman', {
      comparison: {
        season: 2024, category: 'disagree', plan: 'published', sealed: true,
        projection: { ok: true, inserted: 1, updated: 2, voided: 3, retained: 4 },
      },
    });
    expect(previewed.changes.join(' ')).toContain('Preview: 1 to insert, 2 to update, 3 to void, 4 unchanged.');
    const refused = describeConsequences('publish_coleman', {
      comparison: { season: 2024, category: 'disagree', plan: 'published', sealed: true, projection: { ok: false, code: 'foreign_winner_rows' } },
    });
    expect(refused.changes.join(' ')).toMatch(/REFUSED \(foreign_winner_rows\)/);
  });

  describe('no drift from the code the card describes', () => {
    it('mirrors OPERATIONS_AUDIT_ACTIONS in src/lib/admin/operations-centre.ts exactly', () => {
      const source = readFileSync(join(process.cwd(), 'src', 'lib', 'admin', 'operations-centre.ts'), 'utf8');
      const block = /export const OPERATIONS_AUDIT_ACTIONS = \{([\s\S]*?)\} as const;/.exec(source);
      expect(block, 'OPERATIONS_AUDIT_ACTIONS block not found').not.toBeNull();
      const real = Object.fromEntries([...block![1].matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
      expect(Object.keys(real).length).toBeGreaterThanOrEqual(7);
      expect(CONSEQUENCE_AUDIT_ACTIONS).toEqual(real);
    });

    it('the rejection-reason minimum is the service\'s own rule', () => {
      expect(() => checkDecisionNote('reject', 'x'.repeat(REJECT_REASON_MIN_LENGTH - 1), null)).toThrow(/at least 10 characters/);
      expect(checkDecisionNote('reject', 'x'.repeat(REJECT_REASON_MIN_LENGTH), null)).toBe('x'.repeat(REJECT_REASON_MIN_LENGTH));
      expect(REJECT_REASON_MIN_LENGTH).toBe(10);
    });

    it('the seal-note bounds are the domain\'s', () => {
      expect(SEAL_NOTE_MIN_LENGTH).toBe(CORRECTION_NOTE_MIN_LENGTH);
      expect(SEAL_NOTE_MAX_LENGTH).toBe(CORRECTION_NOTE_MAX_LENGTH);
    });
  });

  it('ActionConsequences renders every one of the six fields', () => {
    for (const kind of CONSEQUENCE_KINDS) {
      const markup = html(createElement(ActionConsequences, { consequences: describeConsequences(kind, { actingEmail: 'a@example.invalid' }) }));
      for (const label of ['Will change', 'Affects', 'Validation', 'Reversible', 'Acting user', 'Audit entries']) {
        expect(markup, `${kind} shows "${label}"`).toContain(`<dt>${label}</dt>`);
      }
      expect(markup).toContain('a@example.invalid');
    }
  });
});

/* =============================================================================================
 * 2. Pure view helpers
 * =========================================================================================== */
describe('view helpers', () => {
  it('summariseCoverage counts family-seasons per status and family from the committed registry', () => {
    const health = summariseCoverage(COVERAGE_REGISTRY);
    expect(health.entryCount).toBe(COVERAGE_REGISTRY.length);
    expect(health.rows.map((row) => row.family)).toEqual(['fixtures', 'results', 'match_stats', 'player_stats', 'brownlow']);
    const direct = COVERAGE_REGISTRY.reduce((sum, entry) => sum + (entry.through - entry.from + 1), 0);
    expect(health.totals.total).toBe(direct);
    for (const row of health.rows) {
      expect(Object.values(row.byStatus).reduce((a, b) => a + b, 0)).toBe(row.total);
    }
    expect(health.rows.reduce((sum, row) => sum + row.total, 0)).toBe(health.totals.total);
    // A status with no entry has a null span; one with entries has from <= through.
    for (const [status, span] of Object.entries(health.spans)) {
      if (health.totals.byStatus[status as keyof typeof health.totals.byStatus] === 0) expect(span).toBeNull();
      else expect(span!.from).toBeLessThanOrEqual(span!.through);
    }
  });

  it('parses the queue filter, the route id and the Brownlow query strictly', () => {
    expect(parseQueueFilter(undefined)).toBe('all');
    expect(parseQueueFilter('validated')).toBe('validated');
    expect(parseQueueFilter('nonsense')).toBe('all');
    expect(parseQueueFilter(['validated', 'rejected'])).toBe('all');
    expect(parseRouteId('501')).toBe(501);
    for (const bad of ['0', '-1', '1.5', 'abc', '', '1e3', '12345678901', ' 5']) expect(parseRouteId(bad), bad).toBeNull();
    expect(parseBrownlowQuery({})).toEqual({ season: null, rule: 'unrecorded', seasonError: null });
    expect(parseBrownlowQuery({ season: '2090', rule: 'stored_eligible_rank_one' })).toEqual({ season: 2090, rule: 'stored_eligible_rank_one', seasonError: null });
    expect(parseBrownlowQuery({ season: '1800' }).seasonError).toMatch(/whole year/);
    expect(parseBrownlowQuery({ season: 'abc', rule: 'made-up' })).toMatchObject({ season: null, rule: 'unrecorded' });
  });
});

/* =============================================================================================
 * 3. Presentational components, rendered from SYNTHETIC props
 * =========================================================================================== */
describe('overview sections', () => {
  const sections = (overview = syntheticOverview()): string => html(createElement('div', null,
    createElement(OperationsHeader, { email: 'synthetic.super@example.invalid', role: 'super_admin' }),
    createElement(DataHealthSection, { health: overview.coverage }),
    createElement(SealedSeasonsSection, { seasons: overview.seasons }),
    createElement(AcquisitionRunsSection, { aflApi: overview.aflApiRuns, aflTables: overview.aflTablesRun }),
    createElement(CuratedDerivedSection, { links: overview.curatedLinks, pending: overview.pending }),
    createElement(InspectionToolsSection, { links: overview.inspectionLinks }),
    createElement(MaintenanceSection),
  ));

  it('shows every section for a Super Admin, with the registry file named as a file and no control that starts anything', () => {
    const markup = sections();
    for (const heading of ['Operations centre', 'Data health', 'Sealed seasons', 'Acquisition runs', 'Curated awards and derived results', 'Inspection tools', 'Maintenance']) {
      expect(markup, heading).toContain(`>${heading}</h`);
    }
    // The coverage matrix is named as a repository file, never linked as a URL.
    expect(markup).toContain('docs/v2/coverage-matrix.md');
    expect(markup).not.toMatch(/href="[^"]*coverage-matrix/);
    // Acquisition runs are status only: no form, no button, no Start control.
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<button');
    expect(markup).toContain('AFLDB-ISSUE-316');
    // Plan section 7 R-042: the AFL Tables retirement is D-316-1 (C2) and the timer goes at C5
    // (D-316-4); D-316-2 is the inert AFL API unit installation and must not be named here.
    expect(markup).toContain('D-316-1');
    expect(markup).toContain('D-316-4');
    expect(markup).not.toContain('D-316-2');
    expect(markup).toContain('AFL Tables nightly settle');
    expect(markup).toContain('AFL API match and player statistics settle');
    expect(markup).toMatch(/There is no run-everything control/);
    // Data health: the per-family table and the per-status spans.
    expect(markup).toContain('Historical baseline');
    expect(markup).toContain('Season span of each status');
    expect(markup).toContain('Signed in as <span class="mono">synthetic.super@example.invalid</span> (Super Admin)');
    // Sealed seasons from the SYNTHETIC registry.
    expect(markup).toContain('1897–2025');
    expect(markup).toContain('data/reference/seasons.json');
    // The synthetic AFL Tables row is an explanation, not a state.
    expect(markup).toContain('On-demand refresh is not enabled on this host.');
    expect(markup).toContain('Undecided award proposals');
    expect(SYNTHETIC_SEASON_REGISTRY.in_progress_seasons).toEqual([2026]);
  });

  it('a Super Admin sees every inspection tool; a plain Admin sees only those its capabilities open', () => {
    const superMarkup = sections(syntheticOverview(SYNTHETIC_SUPER_ADMIN));
    for (const href of ['/admin/audit', '/admin/db-health', '/admin/app-health', '/admin/query-builder', '/admin/player-links', '/admin/brownlow', '/admin/current-season']) {
      expect(superMarkup, href).toContain(`href="${href}"`);
    }
    const adminMarkup = sections(syntheticOverview(SYNTHETIC_PLAIN_ADMIN));
    expect(adminMarkup).toContain('href="/admin/audit"');
    expect(adminMarkup).toContain('href="/admin/brownlow"');
    expect(adminMarkup).toContain('href="/admin/operations/awards"');
    for (const href of ['/admin/db-health', '/admin/app-health', '/admin/query-builder', '/admin/player-links', '/admin/current-season']) {
      expect(adminMarkup, href).not.toContain(`href="${href}"`);
    }
  });

  it('a failed read shows its own notice and every other section still renders', () => {
    const markup = sections(syntheticOverviewReadsFailed());
    expect((markup.match(/data-load-failure="true"/g) ?? []).length).toBe(5);
    expect(markup).toContain('SYNTHETIC failure text: the coverage registry could not be summarised.');
    expect(markup).toContain('SYNTHETIC failure text: the season registry could not be read.');
    for (const heading of ['Data health', 'Sealed seasons', 'Acquisition runs', 'Curated awards and derived results', 'Inspection tools', 'Maintenance']) {
      expect(markup, heading).toContain(`>${heading}</h`);
    }
    // The inspection links never depended on a read, so they survive.
    expect(markup).toContain('href="/admin/audit"');
  });

  it('shows no pending count when the viewer may not read award proposals', () => {
    const markup = html(createElement(CuratedDerivedSection, { links: [], pending: null }));
    expect(markup).not.toContain('Undecided award proposals');
    expect(markup).toContain('Your role holds none of the curated-award capabilities.');
  });
});

describe('award proposal views', () => {
  it('renders an empty queue and a populated one (stable identity and "not recorded", never a blank or a 0)', () => {
    expect(html(createElement(ProposalQueueTable, { proposals: [], limit: 200 }))).toContain('data-empty-queue="true"');
    const markup = html(createElement(ProposalQueueTable, { proposals: SYNTHETIC_QUEUE, limit: 200 }));
    expect(markup).toContain('href="/admin/operations/awards/501"');
    expect(markup).toContain('Synthetic Player A');
    expect(markup).toContain('afltables:players/S/Synthetic_Player_A.html');
    expect(markup).toContain('unresolved'); // proposal 504 has no stable identity
    expect(markup).toContain('not recorded'); // proposal 504 has no votes: not 0
    expect(markup).toContain('Validation failed');
    expect(html(createElement(ProposalQueueTable, { proposals: SYNTHETIC_QUEUE, limit: 4 }))).toContain('Showing the newest 4 proposals');
  });

  it('the filter bar links every status and marks the active one', () => {
    const markup = html(createElement(QueueFilterBar, { active: 'validated' }));
    expect(markup).toContain('<strong aria-current="page">Validated</strong>');
    expect(markup).toContain('href="/admin/operations/awards?status=rejected"');
    expect(markup).toContain('href="/admin/operations/awards"');
  });

  it('one proposal: values, evidence, validation (with issues) and the full history', () => {
    const failed = SYNTHETIC_QUEUE.find((p) => p.status === 'validation_failed')!;
    const proposal = syntheticProposal();
    const history = syntheticHistory(proposal);
    const markup = html(createElement('div', null,
      createElement(ProposalValues, { proposal }),
      createElement(ProposalEvidence, { proposal }),
      createElement(ProposalValidation, { proposal: failed }),
      createElement(ProposalHistoryView, { history }),
    ));
    for (const heading of ['Proposed values', 'Evidence', 'Validation', 'Revision and decision history']) {
      expect(markup, heading).toContain(`>${heading}</h`);
    }
    expect(markup).toContain('offline_file');
    expect(markup).toContain('https://example.invalid/synthetic-source');
    expect(markup).toContain('SYNTHETIC citation');
    expect(markup).toContain('2026-10-01');
    expect(markup).toContain('club_not_found');
    expect(markup).toContain('SYNTHETIC validation note');
    expect(markup).toContain('proposed → validated');
    expect(markup).toContain('user #9001');
  });
});

describe('mutation forms: the consequences come BEFORE the submit control', () => {
  const email = 'synthetic.super@example.invalid';

  it('create from a local file', () => {
    const markup = html(createElement(CreateProposalsFormView, { actingEmail: email, binding: noopBinding }));
    expect(at(markup, 'Before you submit: Create award proposals from a local file')).toBeLessThan(at(markup, 'type="submit"'));
    expect(markup).toContain(email);
    expect(markup).toContain('Create proposals (nothing is approved)');
    expect(markup).toContain('name="file"');
    expect(markup).toContain('name="decisionNote"');
  });

  it('validate, approve and reject each have their own card before their own button', () => {
    const markup = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'validated' }), actingEmail: email, sealedSeason: true, binding: noopBinding,
    }));
    const cards = [
      ['Before you submit: Validate this proposal', 'value="validate"'],
      ['Before you submit: Approve this proposal into the public record', 'value="approve"'],
      ['Before you submit: Reject this proposal', 'value="reject"'],
    ] as const;
    for (const [card, button] of cards) expect(at(markup, card), card).toBeLessThan(at(markup, button));
    expect(markup).toContain('Not reversible');
    expect(markup).toContain('SEALED');
    expect(decisionButtonDisabled(markup, 'approve')).toBe(false);
    expect(decisionButtonDisabled(markup, 'validate')).toBe(false);
    expect(decisionButtonDisabled(markup, 'reject')).toBe(false);
  });

  it('approval is disabled for a proposal that is not validated, and every decision for a decided one, with the reason shown', () => {
    const proposed = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'proposed' }), actingEmail: email, sealedSeason: false, binding: noopBinding,
    }));
    expect(decisionButtonDisabled(proposed, 'approve')).toBe(true);
    expect(proposed).toContain('Approval needs a validated proposal; this one is proposed.');
    expect(decisionButtonDisabled(proposed, 'validate')).toBe(false);
    expect(decisionButtonDisabled(proposed, 'reject')).toBe(false);
    const approved = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'approved' }), actingEmail: email, sealedSeason: true, binding: noopBinding,
    }));
    for (const intent of ['validate', 'approve', 'reject']) expect(decisionButtonDisabled(approved, intent), intent).toBe(true);
  });

  it('shows a refusal with its code, its field error and an audit warning without losing the card', () => {
    const markup = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal(),
      actingEmail: email,
      sealedSeason: true,
      binding: { state: { ...SYNTHETIC_REFUSED_STATE, auditWarning: 'SYNTHETIC audit warning: do not resubmit.' }, pending: false },
    }));
    expect(markup).toContain('season_sealed_correction_invalid');
    expect(markup).toContain('data-field-error="decisionNote"');
    expect(markup).toContain('SYNTHETIC audit warning: do not resubmit.');
    expect(markup).toContain('Before you submit: Approve this proposal');
  });

  it('a success shows the outcome message and the validation issues', () => {
    const markup = html(createElement(ActionOutcome, {
      state: {
        ok: true,
        message: 'The proposal validated. It can now be approved.',
        issues: [{ code: 'duplicate_live_proposal', severity: 'warning', message: 'SYNTHETIC warning', field: 'playerIdentity' }],
      },
    }));
    expect(markup).toContain('data-action-outcome="ok"');
    expect(markup).toContain('It can now be approved.');
    expect(markup).toContain('duplicate_live_proposal');
  });
});

describe('curated awards: four eyes and revising an approved winner (V2-GAP-019, V2-GAP-018)', () => {
  const email = 'synthetic.super@example.invalid';
  const approvedProposal = () => syntheticProposal({
    status: 'approved', approvedEntityKey: 'manual_admin_edit:award_winner:synthetic-1', approvedAt: '2026-10-18T10:00:00Z',
  });

  it('the attestation field is offered only to the creator of a validated revision, with the rule explained', () => {
    const creator = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'validated' }), actingEmail: email, sealedSeason: false, binding: noopBinding, viewerCreatedRevision: true,
    }));
    expect(creator).toContain('name="selfApprovalAttestation"');
    expect(creator).toContain('data-self-approval="true"');
    expect(creator).toMatch(/You created this revision/);
    expect(creator).toMatch(/at least 20 characters/);
    expect(at(creator, 'name="selfApprovalAttestation"')).toBeLessThan(at(creator, 'value="approve"'));

    const notCreator = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'validated' }), actingEmail: email, sealedSeason: false, binding: noopBinding, viewerCreatedRevision: false,
    }));
    expect(notCreator).not.toContain('name="selfApprovalAttestation"');
    const notApprovable = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'proposed' }), actingEmail: email, sealedSeason: false, binding: noopBinding, viewerCreatedRevision: true,
    }));
    expect(notApprovable).not.toContain('name="selfApprovalAttestation"');
  });

  it('a four-eyes refusal shows on the attestation field and an approval shows the pages it refreshed', () => {
    const refused = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'validated' }), actingEmail: email, sealedSeason: false, viewerCreatedRevision: true,
      binding: {
        state: { code: 'self_approval_attestation_required', error: 'A self-approval attestation needs at least 20 characters.', fieldErrors: { selfApprovalAttestation: 'A self-approval attestation needs at least 20 characters.' } },
        pending: false,
      },
    }));
    expect(refused).toContain('data-field-error="selfApprovalAttestation"');
    expect(refused).toContain('self_approval_attestation_required');

    const done = html(createElement(DecisionPanelView, {
      proposal: syntheticProposal({ status: 'approved' }), actingEmail: email, sealedSeason: false,
      binding: {
        state: { ok: true, message: 'Approved. The award winner now exists.', entityKey: 'manual_admin_edit:award_winner:u', selfApproval: true, revalidatePaths: ['/awards', '/awards/synthetic-medal'] },
        pending: false,
      },
    }));
    expect(done).toContain('self-approved with an attestation');
    expect(done).toContain('data-revalidated-paths="true"');
    expect(done).toContain('/awards/synthetic-medal');
  });

  it('the approve card now states the four-eyes rule and where an approved winner is changed afterwards', () => {
    const c = describeConsequences('approve_proposal', {});
    expect(c.changes.join(' ')).toMatch(/Four eyes.*cannot approve it.*attestation/);
    expect(c.reversibility).toMatch(/revising the approved winner/);
  });

  it('the revise card states what changes, the records, the seal, irreversibility, the actor and the audit rows BEFORE the submit control', () => {
    const markup = html(createElement(ReviseApprovedPanelView, {
      proposal: approvedProposal(), actingEmail: email, sealedSeason: true, binding: noopBinding,
    }));
    expect(at(markup, 'Before you submit: Revise this approved winner')).toBeLessThan(at(markup, 'type="submit"'));
    expect(markup).toMatch(/corrected in place|corrects the row in place/);
    expect(markup).toMatch(/voided and a replacement is created|voids the row and records a replacement/);
    expect(markup).toContain('award_winners');
    expect(markup).toContain('SEALED');
    expect(markup).toContain('Not reversible');
    expect(markup).toContain(email);
    expect(markup).toContain('supersede_approved');
    expect(markup).toContain('revise_approved');
    expect(markup).toContain('admin.curated_award_revised');
    expect(markup).toMatch(/\/admin\/player-links/);
    // The revision-note field says it is required, and the form starts from the approved values.
    expect(markup).toContain('name="decisionNote"');
    expect(markup).toContain('20 to 2000 characters, required');
    expect(markup).toContain('name="proposalId" value="501"');
    expect(markup).toContain('value="32"');
    expect(markup).toContain('value="afltables:players/S/Synthetic_Player_A.html"');
    expect(markup).toContain('Revise the approved winner');
  });

  it('the revise card for an open season and for an unreadable registry says so', () => {
    expect(describeConsequences('revise_approved_winner', { sealedSeason: false }).affected).toMatch(/open \(in progress\)/);
    expect(describeConsequences('revise_approved_winner', { sealedSeason: null }).affected).toMatch(/fails closed/);
    const c = describeConsequences('revise_approved_winner', { proposalStatus: 'validated' });
    expect(c.validationState).toMatch(/Requires status "approved" \(current: validated\)/);
    expect(c.validationState).toContain(`${SEAL_NOTE_MIN_LENGTH} to ${SEAL_NOTE_MAX_LENGTH} characters is ALWAYS required`);
  });

  it('shows pending, success, error and permission-denied states', () => {
    const pending = html(createElement(ReviseApprovedPanelView, {
      proposal: approvedProposal(), actingEmail: email, sealedSeason: false, binding: { state: {}, pending: true },
    }));
    expect(pending).toContain('Revising…');
    expect(/<button[^>]*type="submit"[^>]*disabled/.test(pending) || /<button[^>]*disabled[^>]*type="submit"/.test(pending)).toBe(true);

    const success = html(createElement(ReviseApprovedPanelView, {
      proposal: approvedProposal(), actingEmail: email, sealedSeason: true,
      binding: {
        state: {
          ok: true, message: 'Revised. The previous winner row was voided and a replacement now stands.',
          entityKey: 'manual_admin_edit:award_winner:new-key', mode: 'replace', sealedSeason: true,
          proposal: syntheticProposal({ id: 502, revision: 2, status: 'approved' }),
          revalidatePaths: ['/awards', '/awards/synthetic-medal/2024'],
        },
        pending: false,
      },
    }));
    expect(success).toContain('data-action-outcome="ok"');
    expect(success).toContain('data-revision-result="replace"');
    expect(success).toContain('manual_admin_edit:award_winner:new-key');
    expect(success).toContain('a replacement; the previous row is void');
    expect(success).toContain('proposal #502 (revision 2)');
    expect(success).toContain('an audited correction of a sealed season');
    expect(success).toContain('data-revalidated-paths="true"');

    const refused = html(createElement(ReviseApprovedPanelView, {
      proposal: approvedProposal(), actingEmail: email, sealedSeason: true,
      binding: {
        state: {
          code: 'note_required', error: 'Revising an approved winner needs a decision note of at least 20 characters recording why the approved record is being changed.',
          fieldErrors: { decisionNote: 'Revising an approved winner needs a decision note of at least 20 characters.' },
          auditWarning: 'SYNTHETIC audit warning: do not resubmit.',
        },
        pending: false,
      },
    }));
    expect(refused).toContain('data-action-outcome="refused"');
    expect(refused).toContain('data-field-error="decisionNote"');
    expect(refused).toContain('note_required');
    expect(refused).toContain('SYNTHETIC audit warning: do not resubmit.');

    const denied = html(createElement(ReviseApprovedUnavailable, { reason: 'permission' }));
    expect(denied).toContain('data-revise-unavailable="permission"');
    expect(denied).toContain('Super Admin action');
    expect(denied).not.toContain('<form');
    expect(html(createElement(ReviseApprovedUnavailable, { reason: 'not_newest' }))).toContain('Only the newest revision');
  });

  it('the awards forms post their server-computed paths to the allowlisted revalidate route; the actions never revalidate', () => {
    const client = readFileSync(join(process.cwd(), 'src', 'app', 'admin', 'operations', '_components', 'OperationsClientForms.tsx'), 'utf8');
    expect(client.match(/revalidateEndpoint: AWARDS_REVALIDATE_ENDPOINT/g)?.length).toBeGreaterThanOrEqual(2);
    expect(client).toContain("AWARDS_REVALIDATE_ENDPOINT = '/admin/awards/revalidate'");
    const actions = readFileSync(join(process.cwd(), 'src', 'app', 'admin', 'operations', 'awards', 'actions.ts'), 'utf8');
    expect(actions).not.toMatch(/revalidatePath\(/);
    // Every exported member of the 'use server' module is an async function (a const array 500s on first call).
    expect([...actions.matchAll(/^export (\w+) (\w+)/gm)].map((m) => m[1])).toEqual(Array(5).fill('async'));
    expect(actions).toMatch(/export async function reviseApprovedProposalAction[\s\S]*?await requireCapability\('data\.awards\.edit'\)/);
  });
});

describe('Coleman views', () => {
  it('lists current publications, or says there are none', () => {
    expect(html(createElement(ColemanPublicationsTable, { publications: [] }))).toContain('data-empty-publications="true"');
    const markup = html(createElement(ColemanPublicationsTable, { publications: [SYNTHETIC_PUBLICATION] }));
    expect(markup).toContain('2024');
    expect(markup).toContain('coleman:2024:players/S/Synthetic_Player_A.html');
    expect(markup).toContain('user #9001');
    expect(markup).toContain('SYNTHETICCHE…'); // the checksum is shortened in the table
  });

  it('shows the derivation summary, the comparison category and the plan for each outcome', () => {
    const agree = html(createElement(ColemanComparisonResult, { comparison: syntheticColemanComparison('agree') }));
    expect(agree).toContain('Agrees');
    expect(agree).toContain('Publishing now would write nothing');
    expect(agree).toContain('Derived winner');
    expect(agree).toContain('Synthetic_Player_A');
    expect(agree).toContain('Leaderboard (top 5 of 8)');

    const disagree = html(createElement(ColemanComparisonResult, { comparison: syntheticColemanComparison('disagree') }));
    expect(disagree).toContain('Disagrees');
    expect(disagree).toContain('Publishing now would record the FIRST publication');
    expect(disagree).toContain('Derived winners with no stored active row');

    const refused = html(createElement(ColemanComparisonResult, { comparison: syntheticColemanComparison('not_derivable') }));
    expect(refused).toContain('Not derivable');
    expect(refused).toContain('data-derivation-refused="season_not_settled"');
    expect(refused).toContain('Publishing is not possible for this season');
    expect(refused).not.toContain('Derived winner');
  });

  it('the workbench offers publishing only when canPublish, and the publish card carries the last comparison', () => {
    const read = html(createElement(ColemanWorkbenchView, {
      canPublish: false, actingEmail: 'synthetic.admin@example.invalid', defaultSeason: 2025, compare: noopBinding, publish: noopBinding,
    }));
    expect(read).toContain('Compare (read-only)');
    expect(read).toContain('data-publish-unavailable="true"');
    expect(read).not.toContain('name="note"');
    expect(read).not.toContain('Publish the derived result');
    expect(read).toContain('value="2025"');

    const full = html(createElement(ColemanWorkbenchView, {
      canPublish: true,
      actingEmail: 'synthetic.super@example.invalid',
      defaultSeason: null,
      compare: { state: { ok: true, comparison: syntheticColemanComparison('agree') }, pending: false },
      publish: noopBinding,
    }));
    expect(at(full, 'Before you submit: Publish the derived Coleman result')).toBeLessThan(at(full, 'Publish the derived result</button>'));
    expect(full).toContain('name="note"');
    expect(full).toContain('Last comparison this session (season 2024)');
    expect(full).toContain('Not reversible in place');
    expect(full).toContain('data-coleman-comparison="2024"');
  });

  it('shows a publication result with its evidence reference', () => {
    const markup = html(createElement(ColemanWorkbenchView, {
      canPublish: true,
      actingEmail: 'synthetic.super@example.invalid',
      defaultSeason: 2024,
      compare: noopBinding,
      publish: {
        pending: false,
        state: {
          ok: true,
          message: 'Published.',
          publication: {
            outcome: 'published', id: 8, supersededId: null, season: 2024, methodVersion: 1, derivationVersion: 'SYNTHETIC-v1',
            inputChecksum: 'SYNTHETICSUM', winnerKeys: ['coleman:2024:players/S/Synthetic_Player_A.html'], evidenceRef: 'coleman_derivation:2024:SYNTHETICSUM',
            projection: {
              projectionId: 3, counts: { inserted: 1, updated: 0, voided: 0, retained: 0 }, changedCount: 1,
              provenanceOnly: false, alreadyProjected: false,
              actions: [{ entityKey: 'afltables:coleman:2024:players/S/Synthetic_Player_A.html', action: 'inserted', awardWinnerId: 41 }],
            },
            revalidatePaths: ['/awards', '/awards/coleman', '/awards/coleman/2024'],
          },
          revalidatePaths: ['/awards', '/awards/coleman', '/awards/coleman/2024'],
        },
      },
    }));
    expect(markup).toContain('data-publication-result="published"');
    expect(markup).toContain('coleman_derivation:2024:SYNTHETICSUM');
    // The effect on the public winners and the provenance record are stated (ADR 0015).
    expect(markup).toContain('data-projection-outcome="changed"');
    expect(markup).toContain('1 inserted, 0 updated, 0 voided, 0 unchanged');
    expect(markup).toContain('derived_award_projections #3');
  });

  it('states provenance-only and already-projected outcomes, and the refusal preview, in words', () => {
    const outcome = (projection: Record<string, unknown>) => html(createElement(ColemanWorkbenchView, {
      canPublish: true, actingEmail: 'synthetic.super@example.invalid', defaultSeason: 2024, compare: noopBinding,
      publish: {
        pending: false,
        state: {
          ok: true,
          message: 'SYNTHETIC',
          publication: {
            outcome: 'unchanged', id: 8, supersededId: null, season: 2024, methodVersion: 1, derivationVersion: 'SYNTHETIC-v1',
            inputChecksum: 'SYNTHETICSUM', winnerKeys: [], evidenceRef: 'coleman_derivation:2024:SYNTHETICSUM',
            projection: { actions: [], changedCount: 0, ...projection }, revalidatePaths: [],
          } as never,
        },
      },
    }));
    const provenance = outcome({ projectionId: 5, counts: { inserted: 0, updated: 0, voided: 0, retained: 1 }, provenanceOnly: true, alreadyProjected: false });
    expect(provenance).toContain('data-projection-outcome="provenance_only"');
    expect(provenance).toContain('Provenance only: the stored winners already matched');
    const rerun = outcome({ projectionId: null, counts: { inserted: 0, updated: 0, voided: 0, retained: 1 }, provenanceOnly: false, alreadyProjected: true });
    expect(rerun).toContain('data-projection-outcome="already_projected"');
    expect(rerun).toContain('none written');

    const refused = html(createElement(ColemanComparisonResult, {
      comparison: {
        ...syntheticColemanComparison('disagree'),
        projection: {
          ok: false,
          refusal: { code: 'foreign_winner_rows', message: 'SYNTHETIC refusal words.', subjects: ['#7 manual_admin_edit:award_winner:SYNTHETIC'] },
        },
      },
    }));
    expect(refused).toContain('data-coleman-projection="refused"');
    expect(refused).toContain('Publishing would be refused');
    expect(refused).toContain('foreign_winner_rows');
    expect(refused).toContain('#7 manual_admin_edit:award_winner:SYNTHETIC');
    const preview = html(createElement(ColemanComparisonResult, { comparison: syntheticColemanComparison('disagree') }));
    expect(preview).toContain('data-coleman-projection="ok"');
    expect(preview).toContain('1 inserted, 0 updated, 0 voided, 0 unchanged');
    expect(html(createElement(ColemanComparisonResult, { comparison: syntheticColemanComparison('agree') })))
      .toContain('publishing would record provenance only');
  });
});

describe('Brownlow views', () => {
  it('states both caveats up front', () => {
    const markup = html(createElement(BrownlowCaveats));
    expect(markup).toContain('V2-GAP-016');
    expect(markup).toContain('F-WB1-005');
    expect(markup).toContain('data-caveat="eligibility-rule"');
    expect(markup).toContain('data-caveat="leaderboard-not-staged"');
    expect(markup).toContain('not supplied');
  });

  it('the picker is a GET form that keeps the season and the rule, and reports a bad season', () => {
    const markup = html(createElement(BrownlowSeasonPicker, { season: 2090, rule: 'stored_eligible_rank_one', seasonError: null }));
    expect(markup).toContain('method="get"');
    expect(markup).toContain('value="2090"');
    expect(markup).toMatch(/<option value="stored_eligible_rank_one" selected/);
    expect(html(createElement(BrownlowSeasonPicker, { season: null, rule: 'unrecorded', seasonError: 'The season must be a whole year from 1897 to 2100.' })))
      .toContain('data-field-error="season"');
  });

  it('a reconciled and a refused report render evidence, findings, comparisons and no stated leader', () => {
    const reconciled = html(createElement(BrownlowReportView, { report: syntheticBrownlowReport('reconciled') }));
    expect(reconciled).toContain('Season 2090: Reconciled');
    expect(reconciled).toContain('refused_eligibility_rule_unrecorded');
    expect(reconciled).toContain('none stated');
    expect(reconciled).toContain('club_unverifiable');
    expect(reconciled).toContain('not supplied'); // the API leaderboard
    expect(reconciled).toContain('Raw vote totals');

    const refused = html(createElement(BrownlowReportView, { report: syntheticBrownlowReport('refused') }));
    expect(refused).toContain('Season 2090: Refused');
    expect(refused).toContain('unresolved_player_identity');
    expect(refused).toContain('No vote totals could be formed.');
    expect(refused).toContain('none stated');
  });
});

/* =============================================================================================
 * 4. The page loaders isolate their reads
 * =========================================================================================== */
describe('page loaders (fakes)', () => {
  const healthyDeps = (over: Partial<PageDeps> = {}): Partial<PageDeps> => ({
    coverageRegistry: () => COVERAGE_REGISTRY,
    loadSeasonRegistry: async () => SYNTHETIC_SEASON_REGISTRY,
    readUnitTable: async () => SYNTHETIC_UNIT_STATUSES,
    readAflTablesRun: async () => SYNTHETIC_UNIT_STATUSES.afltables,
    operations: async () => opsMocks,
    ...over,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const fn of [
      opsMocks.listCuratedQueue, opsMocks.readCuratedHistory, opsMocks.listColemanPublicationsForAdmin,
      opsMocks.reconcileBrownlowSeasonForAdmin, opsMocks.approveCurated, opsMocks.createCuratedFromFile,
      opsMocks.rejectCurated, opsMocks.validateCurated, opsMocks.compareColemanSeason, opsMocks.publishColemanSeason,
    ]) fn.mockReset();
    opsMocks.listCuratedQueue.mockResolvedValue({ ok: true, proposals: SYNTHETIC_QUEUE });
  });

  it('a healthy overview loads every section', async () => {
    const overview = await loadOperationsOverview(SUPER_USER, healthyDeps());
    expect(overview.coverage.ok).toBe(true);
    expect(overview.seasons).toMatchObject({ ok: true, value: { from: 1897, through: 2025, open: [] } });
    expect(overview.aflApiRuns).toMatchObject({ ok: true });
    expect(overview.aflTablesRun).toMatchObject({ ok: true });
    expect(overview.pending).toMatchObject({ ok: true, value: { count: 3, atLeast: false } });
    expect(overview.inspectionLinks.length).toBe(7);
  });

  it('one failing read fails only its own section, with generic text that never carries the thrown message', async () => {
    const secret = 'SECRET-DETAIL /srv/afldb/private/path password=hunter2';
    const overview = await loadOperationsOverview(SUPER_USER, healthyDeps({
      coverageRegistry: () => { throw new Error(secret); },
      readUnitTable: async () => { throw new Error(secret); },
    }));
    expect(overview.coverage).toEqual({ ok: false, error: COVERAGE_UNAVAILABLE });
    expect(overview.aflApiRuns.ok).toBe(false);
    expect(overview.seasons.ok).toBe(true);
    expect(overview.aflTablesRun.ok).toBe(true);
    expect(overview.pending?.ok).toBe(true);
    expect(JSON.stringify(overview)).not.toContain('SECRET-DETAIL');
    expect(JSON.stringify(overview)).not.toContain('hunter2');

    const noRegistry = await loadOperationsOverview(SUPER_USER, healthyDeps({ loadSeasonRegistry: async () => { throw new Error(secret); } }));
    expect(noRegistry.seasons).toEqual({ ok: false, error: SEASON_REGISTRY_UNAVAILABLE });
    expect(noRegistry.coverage.ok).toBe(true);
    expect(JSON.stringify(noRegistry)).not.toContain('SECRET-DETAIL');
  });

  it('the pending count is not even read when the viewer may not read award proposals', async () => {
    const contributor: AdminUser = { ...SUPER_USER, role: 'contributor', canManageAdmins: false };
    const overview = await loadOperationsOverview(contributor, healthyDeps());
    expect(overview.pending).toBeNull();
    expect(overview.curatedLinks).toEqual([]);
    expect(opsMocks.listCuratedQueue).not.toHaveBeenCalled();
  });

  it('a refused or throwing proposal-queue read becomes a failed pending count, not a failed page', async () => {
    opsMocks.listCuratedQueue.mockResolvedValue({ ok: false, code: 'forbidden', error: 'no' });
    expect((await loadOperationsOverview(PLAIN_ADMIN, healthyDeps())).pending?.ok).toBe(false);
    opsMocks.listCuratedQueue.mockRejectedValue(new Error('SECRET-DETAIL'));
    const overview = await loadOperationsOverview(PLAIN_ADMIN, healthyDeps());
    expect(overview.pending).toEqual({ ok: false, error: READ_UNAVAILABLE });
    expect(overview.coverage.ok).toBe(true);
  });

  it('the queue loader passes the status filter, asks for superseded rows only on request, and keeps a typed refusal\'s words', async () => {
    await loadAwardsQueue(PLAIN_ADMIN, 'validated', healthyDeps());
    expect(opsMocks.listCuratedQueue).toHaveBeenLastCalledWith(PLAIN_ADMIN, { status: 'validated', includeSuperseded: false, limit: 200 });
    await loadAwardsQueue(PLAIN_ADMIN, 'superseded', healthyDeps());
    expect(opsMocks.listCuratedQueue).toHaveBeenLastCalledWith(PLAIN_ADMIN, { status: 'superseded', includeSuperseded: true, limit: 200 });
    await loadAwardsQueue(PLAIN_ADMIN, 'all', healthyDeps());
    expect(opsMocks.listCuratedQueue).toHaveBeenLastCalledWith(PLAIN_ADMIN, { includeSuperseded: false, limit: 200 });
    opsMocks.listCuratedQueue.mockResolvedValue({ ok: false, code: 'forbidden', error: 'Reading award proposals needs the data.awards.read capability.' });
    expect(await loadAwardsQueue(PLAIN_ADMIN, 'all', healthyDeps())).toEqual({ ok: false, error: 'Reading award proposals needs the data.awards.read capability.', code: 'forbidden' });
  });

  it('the proposal loader finds the named revision and the newest, and reports the seal as unknown when the registry fails', async () => {
    const older = syntheticProposal({ id: 500, revision: 1, status: 'superseded' });
    const newer = syntheticProposal({ id: 501, revision: 2, revisionOfId: 500, status: 'validated' });
    opsMocks.readCuratedHistory.mockResolvedValue({ ok: true, history: { revisions: [older, newer], decisions: [] } });
    const loaded = await loadProposalPage(SUPER_USER, 500, healthyDeps());
    expect(loaded).toMatchObject({ ok: true, value: { current: { id: 500 }, latest: { id: 501 }, sealedSeason: true } });

    const failed = await loadProposalPage(SUPER_USER, 501, healthyDeps({ loadSeasonRegistry: async () => { throw new Error('SECRET-DETAIL'); } }));
    expect(failed).toMatchObject({ ok: true, value: { sealedSeason: null } });

    opsMocks.readCuratedHistory.mockResolvedValue({ ok: false, code: 'not_found', error: 'Proposal 9 does not exist.' });
    expect(await loadProposalPage(SUPER_USER, 9, healthyDeps())).toEqual({ ok: false, error: 'Proposal 9 does not exist.', code: 'not_found' });
    // A history that does not contain the requested id is reported, not guessed.
    opsMocks.readCuratedHistory.mockResolvedValue({ ok: true, history: { revisions: [newer], decisions: [] } });
    expect(await loadProposalPage(SUPER_USER, 9, healthyDeps())).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('the Coleman loader isolates the publications from the season registry', async () => {
    opsMocks.listColemanPublicationsForAdmin.mockResolvedValue({ ok: true, publications: [SYNTHETIC_PUBLICATION] });
    const page = await loadColemanPage(PLAIN_ADMIN, healthyDeps({ loadSeasonRegistry: async () => { throw new Error('SECRET-DETAIL'); } }));
    expect(page.publications).toEqual({ ok: true, value: [SYNTHETIC_PUBLICATION] });
    expect(page.sealed).toEqual({ ok: false, error: SEASON_REGISTRY_UNAVAILABLE });
    opsMocks.listColemanPublicationsForAdmin.mockRejectedValue(new Error('SECRET-DETAIL'));
    const second = await loadColemanPage(PLAIN_ADMIN, healthyDeps());
    expect(second.publications).toEqual({ ok: false, error: READ_UNAVAILABLE });
    expect(second.sealed.ok).toBe(true);
  });

  it('the Brownlow loader reads nothing until a season is chosen', async () => {
    expect(await loadBrownlowReport(PLAIN_ADMIN, { season: null, rule: 'unrecorded', seasonError: null }, healthyDeps())).toBeNull();
    expect(opsMocks.reconcileBrownlowSeasonForAdmin).not.toHaveBeenCalled();
    opsMocks.reconcileBrownlowSeasonForAdmin.mockResolvedValue({ ok: true, report: syntheticBrownlowReport('reconciled') });
    expect(await loadBrownlowReport(PLAIN_ADMIN, { season: 2090, rule: 'stored_eligible_rank_one', seasonError: null }, healthyDeps()))
      .toMatchObject({ ok: true });
    expect(opsMocks.reconcileBrownlowSeasonForAdmin).toHaveBeenCalledWith(PLAIN_ADMIN, { season: 2090, eligibilityRule: 'stored_eligible_rank_one' });
  });
});

/* =============================================================================================
 * 5. The page modules: exports, guard first, role refusal, inline failures
 * =========================================================================================== */
type PageModule = {
  default: (props?: never) => Promise<ReactElement>;
  dynamic: string;
  metadata: { robots?: { index?: boolean; follow?: boolean } };
};

type PageCase = {
  name: string;
  file: string;
  capability: Capability;
  load: () => Promise<PageModule>;
  props: () => unknown;
};

const PAGES: PageCase[] = [
  {
    name: '/admin/operations', file: 'src/app/admin/operations/page.tsx', capability: 'operations.centre.read',
    load: () => import('@/app/admin/operations/page') as unknown as Promise<PageModule>, props: () => undefined,
  },
  {
    name: '/admin/operations/awards', file: 'src/app/admin/operations/awards/page.tsx', capability: 'data.awards.read',
    load: () => import('@/app/admin/operations/awards/page') as unknown as Promise<PageModule>,
    props: () => ({ searchParams: Promise.resolve({}) }),
  },
  {
    name: '/admin/operations/awards/[id]', file: 'src/app/admin/operations/awards/[id]/page.tsx', capability: 'data.awards.read',
    load: () => import('@/app/admin/operations/awards/[id]/page') as unknown as Promise<PageModule>,
    props: () => ({ params: Promise.resolve({ id: '501' }) }),
  },
  {
    name: '/admin/operations/coleman', file: 'src/app/admin/operations/coleman/page.tsx', capability: 'data.awards.read',
    load: () => import('@/app/admin/operations/coleman/page') as unknown as Promise<PageModule>, props: () => undefined,
  },
  {
    name: '/admin/operations/brownlow', file: 'src/app/admin/operations/brownlow/page.tsx', capability: 'data.brownlow.read',
    load: () => import('@/app/admin/operations/brownlow/page') as unknown as Promise<PageModule>,
    props: () => ({ searchParams: Promise.resolve({ season: '2090' }) }),
  },
];

/** Every ops mock the pages can reach, so "nothing was read" is one assertion. */
const everyRead = () => [
  opsMocks.listCuratedQueue, opsMocks.readCuratedHistory, opsMocks.listColemanPublicationsForAdmin,
  opsMocks.reconcileBrownlowSeasonForAdmin, settleMocks.readSettleUnitTableStatus, settleMocks.readSettleRunStatus,
];

function primeHealthyReads(): void {
  opsMocks.listCuratedQueue.mockResolvedValue({ ok: true, proposals: SYNTHETIC_QUEUE });
  opsMocks.readCuratedHistory.mockResolvedValue({ ok: true, history: syntheticHistory(syntheticProposal({ id: 501, status: 'validated' })) });
  opsMocks.listColemanPublicationsForAdmin.mockResolvedValue({ ok: true, publications: [SYNTHETIC_PUBLICATION] });
  opsMocks.reconcileBrownlowSeasonForAdmin.mockResolvedValue({ ok: true, report: syntheticBrownlowReport('reconciled') });
  // The synthetic statuses carry the structural subset the views read (UnitStatusLike), not every
  // field of the real settle records, so they are cast to the mocked functions' return types.
  settleMocks.readSettleUnitTableStatus.mockResolvedValue(
    SYNTHETIC_UNIT_STATUSES as unknown as Awaited<ReturnType<typeof settle.readSettleUnitTableStatus>>,
  );
  settleMocks.readSettleRunStatus.mockResolvedValue(
    { configured: false, ...SYNTHETIC_UNIT_STATUSES.afltables } as unknown as Awaited<ReturnType<typeof settle.readSettleRunStatus>>,
  );
}

describe('page modules', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    guardMock.mockClear();
    for (const fn of everyRead()) fn.mockReset();
    primeHealthyReads();
    session.actor = null;
  });

  describe.each(PAGES)('$name', (page) => {
    it('exports a default async component, force-dynamic, and robots noindex/nofollow', async () => {
      const mod = await page.load();
      expect(mod.dynamic).toBe('force-dynamic');
      expect(mod.metadata.robots).toEqual({ index: false, follow: false });
      expect(typeof mod.default).toBe('function');
      expect(mod.default.constructor.name).toBe('AsyncFunction');
    });

    it('calls its guard FIRST in the source, naming the capability the nav and the auth contract expect', () => {
      const source = readFileSync(join(process.cwd(), page.file), 'utf8').replace(/\r\n/g, '\n');
      const entry = /export default async function \w+\(([\s\S]*?)\) \{\n([\s\S]*?)\n\}\n/.exec(source);
      expect(entry, 'default async function not found').not.toBeNull();
      const firstStatement = entry![2].trim().split('\n')[0];
      expect(firstStatement).toContain(`await requireCapability('${page.capability}')`);
    });

    it('calls the guard before any read, and renders for a Super Admin', async () => {
      session.actor = SUPER_USER;
      const mod = await page.load();
      const element = await mod.default(page.props() as never);
      const reads = everyRead().filter((fn) => fn.mock.calls.length > 0);
      expect(guardMock).toHaveBeenCalledWith(page.capability);
      expect(guardMock.mock.invocationCallOrder[0]).toBeLessThan(Math.min(...reads.map((fn) => fn.mock.invocationCallOrder[0])));
      const markup = html(element);
      expect(markup.length).toBeGreaterThan(500);
    });

    it('refuses a viewer without the capability BEFORE reading anything', async () => {
      session.actor = { ...SUPER_USER, role: 'contributor', canManageAdmins: false };
      const mod = await page.load();
      await expect(mod.default(page.props() as never)).rejects.toThrow('NEXT_REDIRECT');
      for (const fn of everyRead()) expect(fn).not.toHaveBeenCalled();
      session.actor = null;
      await expect(mod.default(page.props() as never)).rejects.toThrow('NEXT_REDIRECT');
      for (const fn of everyRead()) expect(fn).not.toHaveBeenCalled();
    });
  });

  it('the capability each page demands is held by an Admin and a Super Admin (the read pages), so a plain Admin reaches them', () => {
    for (const page of PAGES) {
      expect(hasCapability(PLAIN_ADMIN, page.capability), page.name).toBe(true);
      expect(hasCapability(SUPER_USER, page.capability), page.name).toBe(true);
    }
  });

  it('overview: a failing settle status and a failing proposal count become inline notices; the page still renders', async () => {
    session.actor = PLAIN_ADMIN;
    settleMocks.readSettleUnitTableStatus.mockRejectedValue(new Error('SECRET-DETAIL'));
    opsMocks.listCuratedQueue.mockRejectedValue(new Error('SECRET-DETAIL'));
    const { default: Page } = await PAGES[0].load();
    const markup = html(await Page());
    expect(markup).toContain('data-load-failure="true"');
    expect(markup).not.toContain('SECRET-DETAIL');
    expect(markup).toContain('>Data health</h');
    expect(markup).toContain('>Inspection tools</h');
    expect(markup).not.toContain('<form');
  });

  it('awards queue: a Super Admin gets the create form; a plain Admin reads the queue and is told creation is not theirs', async () => {
    const { default: Page } = await PAGES[1].load();
    session.actor = SUPER_USER;
    const superMarkup = html(await Page({ searchParams: Promise.resolve({ status: 'validated' }) } as never));
    expect(superMarkup).toContain('Create proposals from a local file');
    expect(superMarkup).toContain('name="file"');
    expect(superMarkup).toContain('#501');
    expect(opsMocks.listCuratedQueue).toHaveBeenLastCalledWith(SUPER_USER, { status: 'validated', includeSuperseded: false, limit: 200 });

    session.actor = PLAIN_ADMIN;
    const adminMarkup = html(await Page({ searchParams: Promise.resolve({}) } as never));
    expect(adminMarkup).toContain('#501');
    expect(adminMarkup).not.toContain('name="file"');
    expect(adminMarkup).not.toContain('Create proposals from a local file');
    expect(adminMarkup).toContain('Super Admin actions');
  });

  it('awards queue: an empty queue and a failed read both render', async () => {
    session.actor = PLAIN_ADMIN;
    const { default: Page } = await PAGES[1].load();
    opsMocks.listCuratedQueue.mockResolvedValue({ ok: true, proposals: [] });
    expect(html(await Page({ searchParams: Promise.resolve({}) } as never))).toContain('data-empty-queue="true"');
    opsMocks.listCuratedQueue.mockRejectedValue(new Error('SECRET-DETAIL'));
    const failed = html(await Page({ searchParams: Promise.resolve({}) } as never));
    expect(failed).toContain('data-load-failure="true"');
    expect(failed).not.toContain('SECRET-DETAIL');
  });

  it('proposal page: the decision panel is a Super Admin\'s, only on the newest revision; a plain Admin reads', async () => {
    const { default: Page } = await PAGES[2].load();
    session.actor = SUPER_USER;
    const superMarkup = html(await Page({ params: Promise.resolve({ id: '501' }) } as never));
    expect(superMarkup).toContain('Decide this proposal');
    expect(superMarkup).toContain('Before you submit: Approve this proposal into the public record');
    expect(superMarkup).toContain('SEALED'); // 2024 is inside the real sealed range
    expect(superMarkup).toContain('Revision and decision history');

    session.actor = PLAIN_ADMIN;
    const adminMarkup = html(await Page({ params: Promise.resolve({ id: '501' }) } as never));
    expect(adminMarkup).not.toContain('Decide this proposal');
    expect(adminMarkup).toContain('data-read-only="true"');
    expect(adminMarkup).toContain('Proposed values');

    // An older revision shows the superseded notice and offers no decision.
    session.actor = SUPER_USER;
    const older = syntheticProposal({ id: 500, revision: 1, status: 'superseded' });
    const newer = syntheticProposal({ id: 501, revision: 2, revisionOfId: 500 });
    opsMocks.readCuratedHistory.mockResolvedValue({ ok: true, history: { revisions: [older, newer], decisions: [] } });
    const oldMarkup = html(await Page({ params: Promise.resolve({ id: '500' }) } as never));
    expect(oldMarkup).toContain('data-superseded-revision="true"');
    expect(oldMarkup).not.toContain('Decide this proposal');
  });

  it('proposal page: a malformed id is a 404 before any read; an unknown id is an inline notice', async () => {
    const { default: Page } = await PAGES[2].load();
    session.actor = SUPER_USER;
    for (const id of ['abc', '0', '1.5', '501abc']) {
      await expect(Page({ params: Promise.resolve({ id }) } as never), id).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(opsMocks.readCuratedHistory).not.toHaveBeenCalled();
    opsMocks.readCuratedHistory.mockResolvedValue({ ok: false, code: 'not_found', error: 'Proposal 9 does not exist.' });
    const markup = html(await Page({ params: Promise.resolve({ id: '9' }) } as never));
    expect(markup).toContain('data-load-failure="true"');
    expect(markup).toContain('Proposal 9 does not exist.');
    expect(markup).toContain('Award proposal #9');
    expect(markup).not.toContain('Decide this proposal');
  });

  it('Coleman page: publishing is offered only to a Super Admin; the registry failing is stated, not fatal', async () => {
    const { default: Page } = await PAGES[3].load();
    session.actor = SUPER_USER;
    const superMarkup = html(await Page());
    expect(superMarkup).toContain('Publish a derived result');
    expect(superMarkup).toContain('name="note"');
    expect(superMarkup).toContain('Compare (read-only)');
    expect(superMarkup).toContain('coleman:2024:players/S/Synthetic_Player_A.html');
    expect(superMarkup).toContain('value="2025"'); // the default season is the newest sealed one

    session.actor = PLAIN_ADMIN;
    const adminMarkup = html(await Page());
    expect(adminMarkup).toContain('Compare (read-only)');
    expect(adminMarkup).toContain('data-publish-unavailable="true"');
    expect(adminMarkup).not.toContain('name="note"');

    opsMocks.listColemanPublicationsForAdmin.mockResolvedValue({ ok: false, code: 'forbidden', error: 'SYNTHETIC refusal words.' });
    const failed = html(await Page());
    expect(failed).toContain('SYNTHETIC refusal words.');
    expect(failed).toContain('Compare (read-only)');
  });

  it('Brownlow page: no season reads nothing; a season shows the report; a bad season is reported; a refusal is inline; caveats always show', async () => {
    const { default: Page } = await PAGES[4].load();
    session.actor = PLAIN_ADMIN;

    const none = html(await Page({ searchParams: Promise.resolve({}) } as never));
    expect(none).toContain('data-no-season="true"');
    expect(none).toContain('V2-GAP-016');
    expect(opsMocks.reconcileBrownlowSeasonForAdmin).not.toHaveBeenCalled();

    const shown = html(await Page({ searchParams: Promise.resolve({ season: '2090', rule: 'stored_eligible_rank_one' }) } as never));
    expect(shown).toContain('Season 2090: Reconciled');
    expect(shown).toContain('F-WB1-005');
    expect(opsMocks.reconcileBrownlowSeasonForAdmin).toHaveBeenLastCalledWith(PLAIN_ADMIN, { season: 2090, eligibilityRule: 'stored_eligible_rank_one' });

    opsMocks.reconcileBrownlowSeasonForAdmin.mockClear();
    const bad = html(await Page({ searchParams: Promise.resolve({ season: 'abc' }) } as never));
    expect(bad).toContain('The season must be a whole year');
    expect(opsMocks.reconcileBrownlowSeasonForAdmin).not.toHaveBeenCalled();

    opsMocks.reconcileBrownlowSeasonForAdmin.mockResolvedValue({ ok: false, code: 'brownlow_input_inconsistent', error: 'SYNTHETIC: staged rows disagree.' });
    const refused = html(await Page({ searchParams: Promise.resolve({ season: '2090' }) } as never));
    expect(refused).toContain('data-load-failure="true"');
    expect(refused).toContain('SYNTHETIC: staged rows disagree.');
    expect(refused).toContain('V2-GAP-016');
  });
});

/* =============================================================================================
 * 6. The retired controls are gone from every screen
 * =========================================================================================== */
describe('retired controls', () => {
  // The exact texts the retired controls carried (git show HEAD:src/app/admin/{upload,current-season}/...):
  // the CSV upload form, the AFL Tables on-demand settle, the Squiggle/Kali fallback refresh, the
  // submission promotion, and the generic status refresh.
  const RETIRED_LABELS = [
    'Upload a file', 'Stage for review', 'Start settle', 'Fetch current AFL data now', 'Refresh status',
    'Run fallback staging refresh', 'Refresh from Squiggle', 'Promote', 'Refresh report',
  ];

  it('no operations-centre markup, in any state, contains a retired control label', () => {
    expect(RENDERED.length, 'the renders above must have run').toBeGreaterThan(40);
    const offenders = RETIRED_LABELS.flatMap((label) => RENDERED.filter((markup) => markup.includes(label)).map(() => label));
    expect(offenders).toEqual([]);
  });

  it('there is no generic "run everything" control either', () => {
    for (const markup of RENDERED) {
      expect(markup).not.toMatch(/Run all|Run everything|Refresh all|Sync all/i);
    }
  });
});
