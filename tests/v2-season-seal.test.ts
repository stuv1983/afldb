/**
 * AFLDB V2 Stage 3 (V2-GAP-006) — the pure seal on historical seasons: open seasons are
 * writable, sealed seasons are refused unless an audited correction is supplied, every invalid
 * correction field is refused, and the real data/reference/seasons.json seals 2026 but not 2027 (the 2026
 * rollover, AFLDB-ISSUE-316 D-316-1; the explicit predecessor sealed 2025 but not 2026).
 * No database, no network.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  ADJUDICATION_NOTE_MAX_LENGTH,
  ADJUDICATION_NOTE_MIN_LENGTH,
} from '@/lib/acquisition/afl-api-adjudication';
import {
  AUDITED_CORRECTION_WORKFLOWS,
  CORRECTION_NOTE_MAX_LENGTH,
  CORRECTION_NOTE_MIN_LENGTH,
  SealedSeasonRefusal,
  assertSeasonWritable,
  evaluateSeasonWrite,
  isSealedSeason,
  sealedSeasonsFrom,
  type AuditedCorrection,
  type SeasonRegistry,
} from '@afldb/domain';

import {
  CORRECTION_NOTE_FIELD_MAX,
  CORRECTION_NOTE_FIELD_MIN,
} from '@/components/admin/CorrectionNoteField';
import {
  REFERENCE_AUDIT_TABLES,
  SealedEditorRefusal,
  enforceSealedEditorWrite,
  resolveSealScopeSeasons,
  workflowForAuditTable,
  type SealScope,
} from '@/lib/seasons/sealed-editor-guard';
import { parseCorrectionNote, storedNoteText } from '@/lib/seasons/correction-note';
import { SeasonRegistryError, loadSealedSeasons } from '@/lib/seasons/sealed-seasons';

import { isSettleSeasonSealed, refuseSealedSeasonForSettle } from '../tools/current-season/settle-season-seal';

// V2-GAP-006 editor guard: the registry loader is wrapped so one test can make it fail; by default
// it is the real implementation reading the real data/reference/seasons.json.
vi.mock('@/lib/seasons/sealed-seasons', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seasons/sealed-seasons')>();
  return { ...actual, loadSealedSeasons: vi.fn(actual.loadSealedSeasons) };
});

const REAL_REGISTRY = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'reference', 'seasons.json'), 'utf8'),
) as SeasonRegistry;

// SYNTHETIC registry: sealed 1897-2025 with 2026 open, plus a gap season (1950) still open.
const SEALED = sealedSeasonsFrom({ first_season: 1897, last_season: 2026, in_progress_seasons: [2026] });

const VALID_NOTE = 'Corrects a transcription error against the printed scoreboard.';

function correction(overrides: Partial<Record<keyof AuditedCorrection, unknown>> = {}): AuditedCorrection {
  return {
    workflow: 'data_editor',
    actorUserId: 7,
    note: VALID_NOTE,
    evidenceRef: 'AFLDB-ISSUE-999',
    ...overrides,
  } as AuditedCorrection;
}

describe('the real data/reference/seasons.json', () => {
  it('seals 2026 and does not seal 2027 (or a season past last_season) since the 2026 rollover', () => {
    const sealed = sealedSeasonsFrom(REAL_REGISTRY);
    expect(isSealedSeason(sealed, 2025)).toBe(true);
    expect(isSealedSeason(sealed, 2026)).toBe(true);
    expect(isSealedSeason(sealed, 2027)).toBe(false);
    expect(isSealedSeason(sealed, 2028)).toBe(false);
    expect(evaluateSeasonWrite({ season: 2026, sealed, correction: null })).toMatchObject({
      allowed: false, code: 'season_sealed',
    });
    expect(evaluateSeasonWrite({ season: 2027, sealed, correction: null })).toEqual({
      allowed: true, basis: 'open_season',
    });
  });
});

describe('evaluateSeasonWrite', () => {
  it('allows an open season, with or without a correction (the correction is not consulted)', () => {
    expect(evaluateSeasonWrite({ season: 2026, sealed: SEALED, correction: null })).toEqual({
      allowed: true, basis: 'open_season',
    });
    expect(evaluateSeasonWrite({ season: 2026, sealed: SEALED, correction: correction({ actorUserId: 0 }) })).toEqual({
      allowed: true, basis: 'open_season',
    });
  });

  it('does not seal a season outside first..last (a synthetic 2071/2099 fixture season, or 1800)', () => {
    for (const season of [2071, 2099, 1800]) {
      expect(evaluateSeasonWrite({ season, sealed: SEALED, correction: null })).toEqual({
        allowed: true, basis: 'open_season',
      });
    }
  });

  it('refuses a sealed season without a correction, with an actionable message', () => {
    const decision = evaluateSeasonWrite({ season: 2025, sealed: SEALED, correction: null });
    expect(decision).toMatchObject({ allowed: false, code: 'season_sealed' });
    const message = (decision as { message: string }).message;
    expect(message).toContain('season 2025');
    expect(message).toContain('sealed');
    expect(message).toContain('data/reference/seasons.json');
    expect(message).toContain('never rewrite sealed history');
    expect(message).toContain('docs/v2/historical-baseline.md');
    for (const workflow of AUDITED_CORRECTION_WORKFLOWS) expect(message).toContain(workflow);
  });

  it('treats an unknown or undated season (null, NaN, fractional) as sealed: it cannot be proved open', () => {
    for (const season of [null, Number.NaN, 2025.5]) {
      const decision = evaluateSeasonWrite({ season, sealed: SEALED, correction: null });
      expect(decision).toMatchObject({ allowed: false, code: 'season_sealed' });
      expect((decision as { message: string }).message).toContain('unknown or undated season');
    }
    // ... and a valid correction admits it, with the season recorded as null.
    expect(evaluateSeasonWrite({ season: null, sealed: SEALED, correction: correction() })).toMatchObject({
      allowed: true, basis: 'audited_correction', audit: { season: null },
    });
  });

  it('allows a sealed season under a valid audited correction, returning the exact audit record (trimmed)', () => {
    const decision = evaluateSeasonWrite({
      season: 2025,
      sealed: SEALED,
      correction: correction({ note: `  ${VALID_NOTE}  `, evidenceRef: '  AFLDB-ISSUE-999 ' }),
    });
    expect(decision).toEqual({
      allowed: true,
      basis: 'audited_correction',
      audit: {
        season: 2025, workflow: 'data_editor', actorUserId: 7, note: VALID_NOTE, evidenceRef: 'AFLDB-ISSUE-999',
      },
    });
  });

  it('accepts every listed workflow, and the list excludes automatic settle application', () => {
    expect([...AUDITED_CORRECTION_WORKFLOWS]).toEqual([
      'data_editor', 'promotion_review', 'identity_adjudication', 'brownlow_authority', 'csv_submission_promotion',
      'derived_award_publication', 'curated_award_approval', 'brownlow_eligibility_decision',
    ]);
    for (const workflow of AUDITED_CORRECTION_WORKFLOWS) {
      expect(evaluateSeasonWrite({ season: 1990, sealed: SEALED, correction: correction({ workflow }) }))
        .toMatchObject({ allowed: true, basis: 'audited_correction', audit: { workflow } });
    }
    expect((AUDITED_CORRECTION_WORKFLOWS as readonly string[]).some((w) => /settle|canonical_application/.test(w)))
      .toBe(false);
  });

  const INVALID: readonly { name: string; override: Partial<Record<keyof AuditedCorrection, unknown>>; text: RegExp }[] = [
    { name: 'unknown workflow', override: { workflow: 'settle' }, text: /workflow 'settle' is not an audited/ },
    { name: 'automatic canonical application', override: { workflow: 'canonical_application' }, text: /not an audited/ },
    { name: 'actor 0', override: { actorUserId: 0 }, text: /actorUserId must be a positive integer/ },
    { name: 'negative actor', override: { actorUserId: -3 }, text: /actorUserId/ },
    { name: 'non-integer actor', override: { actorUserId: 1.5 }, text: /actorUserId/ },
    { name: 'string actor', override: { actorUserId: '7' }, text: /actorUserId/ },
    { name: 'note too short after trim', override: { note: `   ${'x'.repeat(CORRECTION_NOTE_MIN_LENGTH - 1)}   ` }, text: /note must be 20-2000/ },
    { name: 'note too long after trim', override: { note: 'x'.repeat(CORRECTION_NOTE_MAX_LENGTH + 1) }, text: /note must be 20-2000/ },
    { name: 'note not a string', override: { note: 42 }, text: /note must be/ },
    { name: 'empty evidenceRef', override: { evidenceRef: '' }, text: /evidenceRef must be non-empty/ },
    { name: 'blank evidenceRef', override: { evidenceRef: '   ' }, text: /evidenceRef must be non-empty/ },
  ];

  for (const { name, override, text } of INVALID) {
    it(`refuses a sealed season with an invalid correction: ${name}`, () => {
      const decision = evaluateSeasonWrite({ season: 2025, sealed: SEALED, correction: correction(override) });
      expect(decision).toMatchObject({ allowed: false, code: 'correction_invalid' });
      expect((decision as { message: string }).message).toMatch(text);
      expect((decision as { message: string }).message).toContain('season 2025');
    });
  }

  it('accepts a note of exactly the minimum and maximum trimmed length', () => {
    for (const length of [CORRECTION_NOTE_MIN_LENGTH, CORRECTION_NOTE_MAX_LENGTH]) {
      expect(evaluateSeasonWrite({
        season: 2025, sealed: SEALED, correction: correction({ note: ` ${'x'.repeat(length)} ` }),
      })).toMatchObject({ allowed: true, basis: 'audited_correction' });
    }
  });

  it('keeps the note bounds equal to the adjudication workflow bounds it mirrors', () => {
    expect(CORRECTION_NOTE_MIN_LENGTH).toBe(ADJUDICATION_NOTE_MIN_LENGTH);
    expect(CORRECTION_NOTE_MAX_LENGTH).toBe(ADJUDICATION_NOTE_MAX_LENGTH);
  });
});

describe('the settle gate across the 2026 -> 2027 season boundary (AFLDB-ISSUE-316)', () => {
  // EXPLICIT predecessor and candidate registries, never the tracked file: the gate reads
  // data/reference/seasons.json under the CLI's own project root, so each case gets its own root.
  const PREDECESSOR = { first_season: 1897, last_season: 2026, in_progress_seasons: [2026] };
  const CANDIDATE = { first_season: 1897, last_season: 2027, in_progress_seasons: [2027] };
  const roots: string[] = [];
  const rootFor = (registry: SeasonRegistry): string => {
    const root = mkdtempSync(join(tmpdir(), 'afldb-season-boundary-'));
    roots.push(root);
    mkdirSync(join(root, 'data', 'reference'), { recursive: true });
    writeFileSync(join(root, 'data', 'reference', 'seasons.json'), `${JSON.stringify(registry)}\n`);
    return root;
  };
  afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('admits a 2026 settle before the rollover and refuses it after, before any client', () => {
    expect(isSettleSeasonSealed(rootFor(PREDECESSOR), 2026)).toBe(false);
    expect(() => refuseSealedSeasonForSettle(rootFor(PREDECESSOR), 2026)).not.toThrow();
    const candidate = rootFor(CANDIDATE);
    expect(isSettleSeasonSealed(candidate, 2026)).toBe(true);
    expect(() => refuseSealedSeasonForSettle(candidate, 2026))
      .toThrow(expect.objectContaining({ name: 'SealedSeasonRefusal', code: 'season_sealed', season: 2026 }));
    expect(() => refuseSealedSeasonForSettle(candidate, 2027)).not.toThrow();
  });

  it('leaves sealed 2026 to the audited workflows only: brownlow_authority with a valid record, never a settle', () => {
    const sealed = sealedSeasonsFrom(CANDIDATE);
    expect(evaluateSeasonWrite({ season: 2026, sealed, correction: null }))
      .toMatchObject({ allowed: false, code: 'season_sealed' });
    expect(evaluateSeasonWrite({ season: 2026, sealed, correction: correction({ workflow: 'brownlow_authority' }) }))
      .toMatchObject({ allowed: true, basis: 'audited_correction', audit: { season: 2026, workflow: 'brownlow_authority' } });
    expect(evaluateSeasonWrite({ season: 2026, sealed, correction: correction({ workflow: 'settle' }) }))
      .toMatchObject({ allowed: false, code: 'correction_invalid' });
  });
});

describe('assertSeasonWritable / SealedSeasonRefusal', () => {
  it('throws a SealedSeasonRefusal carrying the code and season', () => {
    let thrown: unknown;
    try {
      assertSeasonWritable({ season: 2025, sealed: SEALED, correction: null });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SealedSeasonRefusal);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: 'SealedSeasonRefusal', code: 'season_sealed', season: 2025 });
    expect((thrown as Error).message).toContain('sealed');
  });

  it('throws correction_invalid for a bad correction and returns the allowing decision otherwise', () => {
    expect(() => assertSeasonWritable({ season: 2025, sealed: SEALED, correction: correction({ actorUserId: 0 }) }))
      .toThrow(expect.objectContaining({ code: 'correction_invalid' }));
    expect(assertSeasonWritable({ season: 2026, sealed: SEALED, correction: null })).toEqual({
      allowed: true, basis: 'open_season',
    });
    expect(assertSeasonWritable({ season: 2025, sealed: SEALED, correction: correction() }).basis)
      .toBe('audited_correction');
  });
});


// ---------------------------------------------------------------------------------------------
// V2-GAP-006, owner decision D-V2-GAP006-EDITORS (Option E1): the season seal for the audited
// admin editors. A sealed-season mutation needs a 20-2000 character human note; an open season
// needs none; an unknown season fails closed; an unreadable registry refuses. No database here -
// the PostgreSQL behaviour (rollback, audit binding, per-editor mutations) is in
// tests/integration/sealed-editor-guard.test.ts.
// ---------------------------------------------------------------------------------------------

const REAL_SEALED = sealedSeasonsFrom(REAL_REGISTRY);
const SEALED_YEAR = 2019;
const OPEN_YEAR = REAL_SEALED.through + 1; // the in-progress season of the real registry
const EDITOR_NOTE = 'Corrected against the printed AFL Record scoreboard.';

/** A transaction stand-in: row-season lookups answer from `seasons` ("table:id" -> season); nothing else is touched. */
function fakeTx(seasons: Record<string, number | null> = {}) {
  const queries: string[] = [];
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join('?'));
    const season = seasons[`matches:${String(values[0])}`];
    return season === undefined ? [] : [{ season }];
  };
  const unsafe = async (query: string, params: unknown[]) => {
    queries.push(query);
    const table = /FROM (\w+) WHERE/.exec(query)?.[1] ?? '';
    const season = seasons[`${table}:${String(params[0])}`];
    return season === undefined ? [] : [{ season }];
  };
  return { tx: Object.assign(tagged, { unsafe }) as unknown as postgres.TransactionSql, queries };
}

async function enforce(opts: {
  tableName?: string; rowId?: number; scope: SealScope; note?: string | null;
  seasons?: Record<string, number | null>; workflow?: Parameters<typeof enforceSealedEditorWrite>[1]['workflow'];
}) {
  const { tx } = fakeTx(opts.seasons);
  return enforceSealedEditorWrite(tx, {
    tableName: opts.tableName ?? 'matches',
    rowId: opts.rowId ?? 1,
    scope: opts.scope,
    actorUserId: 7,
    note: opts.note ?? null,
    workflow: opts.workflow,
    evidenceRef: 'data_edits:99',
  });
}

describe('the editor guard: sealed seasons need a human note (V2-GAP-006 E1)', () => {
  it('mirrors the domain note limits in the form field copy', () => {
    expect(CORRECTION_NOTE_FIELD_MIN).toBe(CORRECTION_NOTE_MIN_LENGTH);
    expect(CORRECTION_NOTE_FIELD_MAX).toBe(CORRECTION_NOTE_MAX_LENGTH);
  });

  it('reads the real registry: sealed through the last season not in progress, the in-progress season open', () => {
    expect(isSealedSeason(REAL_SEALED, SEALED_YEAR)).toBe(true);
    expect(isSealedSeason(REAL_SEALED, OPEN_YEAR)).toBe(false);
  });

  it('refuses a missing note on a sealed season, naming the rule and that nothing changed', async () => {
    for (const note of [null, undefined, '', '   \n ']) {
      const failure = await enforce({ scope: { kind: 'seasons', seasons: [SEALED_YEAR] }, note })
        .then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(SealedEditorRefusal);
      expect(failure).toMatchObject({ code: 'correction_invalid', seasons: [SEALED_YEAR] });
      expect((failure as Error).message).toContain(`${SEALED_YEAR} is sealed historical data`);
      expect((failure as Error).message).toContain('20-2000 characters');
      expect((failure as Error).message).toContain('No note was entered');
      expect((failure as Error).message).toContain('Nothing was changed');
    }
  });

  it('refuses a short note (trimmed) and an excessive note, but not the boundaries', async () => {
    const scope: SealScope = { kind: 'seasons', seasons: [SEALED_YEAR] };
    await expect(enforce({ scope, note: 'too short' })).rejects.toMatchObject({ code: 'correction_invalid' });
    await expect(enforce({ scope, note: `   ${'x'.repeat(19)}   ` })).rejects.toThrow(/shorter than 20/);
    await expect(enforce({ scope, note: 'x'.repeat(2001) })).rejects.toThrow(/longer than 2000/);
    await expect(enforce({ scope, note: 'x'.repeat(20) })).resolves.toMatchObject({ basis: 'audited_correction' });
    await expect(enforce({ scope, note: 'x'.repeat(2000) })).resolves.toMatchObject({ basis: 'audited_correction' });
  });

  it('accepts a valid sealed correction and binds workflow, actor, trimmed note and the real audit row', async () => {
    const receipt = await enforce({ scope: { kind: 'seasons', seasons: [SEALED_YEAR] }, note: `  ${EDITOR_NOTE}  ` });
    expect(receipt).toEqual({
      basis: 'audited_correction',
      seasons: [SEALED_YEAR],
      sealedSeasons: [SEALED_YEAR],
      workflow: 'data_editor',
      actorUserId: 7,
      note: EDITOR_NOTE,
      evidenceRef: 'data_edits:99',
    });
  });

  it('leaves an open season unchanged: no note needed, nothing recorded', async () => {
    const scope: SealScope = { kind: 'seasons', seasons: [OPEN_YEAR] };
    await expect(enforce({ scope })).resolves.toEqual({ basis: 'open_season', seasons: [OPEN_YEAR] });
    await expect(enforce({ scope, note: 'x' })).resolves.toMatchObject({ basis: 'open_season' });
    // A season beyond the registry (the synthetic fixture seasons 2079+) is not sealed either.
    await expect(enforce({ scope: { kind: 'seasons', seasons: [2079] } })).resolves.toMatchObject({ basis: 'open_season' });
  });

  it('fails closed on an unknown or undated season, and on a row that cannot be found', async () => {
    await expect(enforce({ scope: { kind: 'seasons', seasons: [null] } })).rejects.toMatchObject({ code: 'correction_invalid' });
    await expect(enforce({ scope: { kind: 'seasons', seasons: [Number.NaN] } })).rejects.toBeInstanceOf(SealedEditorRefusal);
    await expect(enforce({ scope: { kind: 'seasons', seasons: [2019.5] } })).rejects.toBeInstanceOf(SealedEditorRefusal);
    // The audited row does not exist (or has a NULL season): unknown, so sealed.
    await expect(enforce({ scope: { kind: 'row' }, seasons: {} })).rejects.toBeInstanceOf(SealedEditorRefusal);
    await expect(enforce({ scope: { kind: 'row' }, seasons: { 'matches:1': null } }))
      .rejects.toMatchObject({ code: 'correction_invalid' });
    // With a valid note the unknown season is an audited correction, recorded as unknown.
    await expect(enforce({ scope: { kind: 'row' }, seasons: { 'matches:1': null }, note: EDITOR_NOTE }))
      .resolves.toMatchObject({ basis: 'audited_correction', sealedSeasons: [null] });
  });

  it('resolves the season from the audited row, and guards BOTH the old and the new season of a move', async () => {
    const scope = (previousSeasons?: number[]): SealScope => ({ kind: 'row', previousSeasons });
    // Row now in an open season, previously sealed: the old season is guarded.
    await expect(enforce({ scope: scope([SEALED_YEAR]), seasons: { 'matches:1': OPEN_YEAR } }))
      .rejects.toMatchObject({ code: 'correction_invalid', seasons: [SEALED_YEAR] });
    // Row now sealed, previously open: the new season is guarded.
    await expect(enforce({ scope: scope([OPEN_YEAR]), seasons: { 'matches:1': SEALED_YEAR } }))
      .rejects.toMatchObject({ seasons: [SEALED_YEAR] });
    // Both open: no note.
    await expect(enforce({ scope: scope([OPEN_YEAR]), seasons: { 'matches:1': OPEN_YEAR } }))
      .resolves.toMatchObject({ basis: 'open_season' });
    // Both sealed, valid note: one correction covering both.
    await expect(enforce({ scope: scope([2001]), seasons: { 'matches:1': SEALED_YEAR }, note: EDITOR_NOTE }))
      .resolves.toMatchObject({ basis: 'audited_correction', sealedSeasons: [2001, SEALED_YEAR] });
  });

  it('guards every season of a multi-season mutation, and only the sealed ones need the note', async () => {
    const mixed: SealScope = { kind: 'seasons', seasons: [OPEN_YEAR, SEALED_YEAR, SEALED_YEAR, 2001] };
    await expect(enforce({ scope: mixed })).rejects.toMatchObject({ seasons: [SEALED_YEAR, 2001] });
    await expect(enforce({ scope: mixed, note: EDITOR_NOTE })).resolves.toMatchObject({
      basis: 'audited_correction', seasons: [OPEN_YEAR, SEALED_YEAR, 2001], sealedSeasons: [SEALED_YEAR, 2001],
    });
    await expect(enforce({ scope: { kind: 'seasons', seasons: [OPEN_YEAR, OPEN_YEAR + 1] } }))
      .resolves.toMatchObject({ basis: 'open_season' });
  });

  it('refuses every sealed-scope write when the registry cannot be read, and never for a reference table', async () => {
    const mocked = vi.mocked(loadSealedSeasons);
    mocked.mockImplementation(() => { throw new SeasonRegistryError('seasons.json is unreadable'); });
    try {
      await expect(enforce({ scope: { kind: 'seasons', seasons: [OPEN_YEAR] }, note: EDITOR_NOTE }))
        .rejects.toMatchObject({ name: 'SealedEditorRefusal', code: 'season_registry_unavailable' });
      await expect(enforce({ scope: { kind: 'row' }, seasons: { 'matches:1': OPEN_YEAR } }))
        .rejects.toMatchObject({ code: 'season_registry_unavailable' });
      // A reference-table mutation has no season, so the registry is not consulted.
      await expect(enforce({ tableName: 'players', scope: { kind: 'reference' } }))
        .resolves.toEqual({ basis: 'not_applicable', seasons: [] });
    } finally {
      const actual = await vi.importActual<typeof import('@/lib/seasons/sealed-seasons')>('@/lib/seasons/sealed-seasons');
      mocked.mockReset();
      mocked.mockImplementation(actual.loadSealedSeasons);
    }
  });

  it("allows { kind: 'reference' } only for the reference audit tables, never as a way past a season-bearing one", async () => {
    for (const table of REFERENCE_AUDIT_TABLES) {
      await expect(enforce({ tableName: table, scope: { kind: 'reference' } })).resolves.toMatchObject({ basis: 'not_applicable' });
    }
    for (const table of ['matches', 'draft_picks', 'award_winners', 'club_leadership', 'brownlow_season_authority']) {
      await expect(enforce({ tableName: table, scope: { kind: 'reference' } })).rejects.toThrow(/not a reference audit table/);
    }
    // And a reference table cannot resolve a season from its row: it must declare the seasons.
    await expect(resolveSealScopeSeasons(fakeTx().tx, 'players', 1, { kind: 'row' })).rejects.toThrow(/no season column/);
  });

  it('derives the workflow from the audited table on the server, from the closed list, adding none', async () => {
    expect(workflowForAuditTable('brownlow_vote_entry_state')).toBe('brownlow_authority');
    expect(workflowForAuditTable('brownlow_season_authority')).toBe('brownlow_authority');
    for (const table of ['matches', 'draft_picks', 'award_winners', 'club_leadership', 'player_achievements', 'after_siren_kicks', 'players']) {
      expect(workflowForAuditTable(table)).toBe('data_editor');
    }
    expect(AUDITED_CORRECTION_WORKFLOWS).toHaveLength(8); // the closed list gained no id
    const brownlow = await enforce({
      tableName: 'brownlow_season_authority', rowId: SEALED_YEAR, scope: { kind: 'row' }, note: EDITOR_NOTE,
    });
    expect(brownlow).toMatchObject({ basis: 'audited_correction', workflow: 'brownlow_authority', seasons: [SEALED_YEAR] });
    // A server-side caller already under another audited workflow can name it (never a client).
    const link = await enforce({
      scope: { kind: 'seasons', seasons: [SEALED_YEAR] }, note: EDITOR_NOTE, workflow: 'identity_adjudication',
    });
    expect(link).toMatchObject({ workflow: 'identity_adjudication' });
    await expect(enforce({
      scope: { kind: 'seasons', seasons: [SEALED_YEAR] }, note: EDITOR_NOTE,
      workflow: 'settle' as never,
    })).rejects.toThrow(/closed audited-correction list/);
  });

  it('resolves the Brownlow vote-entry row through its match and the authority row as the season itself', async () => {
    const { tx } = fakeTx({ 'matches:55': SEALED_YEAR });
    await expect(resolveSealScopeSeasons(tx, 'brownlow_vote_entry_state', 55, { kind: 'row' })).resolves.toEqual([SEALED_YEAR]);
    await expect(resolveSealScopeSeasons(tx, 'brownlow_season_authority', 2005, { kind: 'row' })).resolves.toEqual([2005]);
    await expect(resolveSealScopeSeasons(tx, 'brownlow_vote_entry_state', 56, { kind: 'row' })).resolves.toEqual([null]);
  });
});

describe('an empty season declaration fails closed (V2-GAP-006 E1 review F-005)', () => {
  it('resolves to one unknown season, which is treated as sealed, never to "nothing to guard"', async () => {
    await expect(resolveSealScopeSeasons({} as postgres.TransactionSql, 'players', 1, { kind: 'seasons', seasons: [] })).resolves.toEqual([null]);
  });
});

describe('every audited editor mutation declares its seasons (V2-GAP-006 E1 inventory)', () => {
  const QUERY_DIR = join(__dirname, '..', 'src', 'db', 'queries');
  const files = readdirSync(QUERY_DIR).filter((f) => f.endsWith('.ts') && f !== 'audit-log.ts');

  /** Every `recordDataEdit(` call expression in the source, with its argument block. */
  function callBlocks(source: string): string[] {
    const blocks: string[] = [];
    const re = /await recordDataEdit\(/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      // The call ends at the first line that closes the argument object at the call's own indent.
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const indent = /^\s*/.exec(source.slice(lineStart))![0];
      const end = source.indexOf(`\n${indent}});`, match.index);
      blocks.push(source.slice(match.index, end + 1));
    }
    return blocks;
  }

  it('passes a seal scope at every call site, in every query module', () => {
    let total = 0;
    for (const file of files) {
      const source = readFileSync(join(QUERY_DIR, file), 'utf8');
      for (const block of callBlocks(source)) {
        total += 1;
        expect(block, `${file}: ${block.slice(0, 80)}`).toMatch(/\bseal:\s*(\{ kind: '|(input|entity)\.table)/);
      }
    }
    expect(total).toBe(55); // the inventory at 2026-10-31; a new call site must be declared AND raise this
  });

  it("never passes { kind: 'reference' } for a table the manifest treats as season-bearing", () => {
    for (const file of files) {
      const source = readFileSync(join(QUERY_DIR, file), 'utf8');
      for (const block of callBlocks(source)) {
        if (!/seal:\s*\{ kind: 'reference' \}/.test(block)) continue;
        const table = /tableName:\s*'(\w+)'/.exec(block)?.[1];
        // `entity.table`/`input.table` dynamic sites are declared per case, so only literals are checked here.
        if (table !== undefined) expect(REFERENCE_AUDIT_TABLES as readonly string[], `${file}: ${table}`).toContain(table);
      }
    }
  });

  it('keeps the player-link resolution on the identity_adjudication workflow', () => {
    const source = readFileSync(join(QUERY_DIR, 'player-links.ts'), 'utf8');
    expect(source).toContain("workflow: 'identity_adjudication'");
    expect(source).toContain('enforceSealedEditorWrite');
  });
});

describe('the action layer never truncates the correction note (V2-GAP-006 E1, note-length bypass)', () => {
  const ADMIN_DIR = join(__dirname, '..', 'src', 'app', 'admin');

  function adminSources(dir: string = ADMIN_DIR): { file: string; source: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return adminSources(path);
      return /\.tsx?$/.test(entry.name) ? [{ file: path.slice(ADMIN_DIR.length + 1).replaceAll('\\', '/'), source: readFileSync(path, 'utf8') }] : [];
    });
  }

  it('parseCorrectionNote trims, maps blank to null and keeps an over-length note whole', () => {
    expect(parseCorrectionNote(null)).toBeNull();
    expect(parseCorrectionNote('')).toBeNull();
    expect(parseCorrectionNote('   \n ')).toBeNull();
    expect(parseCorrectionNote('  a note  ')).toBe('a note');
    expect(parseCorrectionNote('x'.repeat(2000))).toHaveLength(2000);
    // The point of the fix: 2001 characters must reach the guard as 2001, never be cut to 2000.
    expect(parseCorrectionNote('x'.repeat(2001))).toHaveLength(2001);
    expect(parseCorrectionNote(`  ${'y'.repeat(5000)}  `)).toHaveLength(5000);
  });

  it('a note of 2001 characters is refused by the guard, while the truncated 2000 would have been accepted', () => {
    const sealed = SEALED;
    const verdict = (note: string) => evaluateSeasonWrite({
      season: 1990, sealed,
      correction: { workflow: 'data_editor', actorUserId: 1, note, evidenceRef: 'data_edits:1' },
    });
    expect(verdict('x'.repeat(2000)).allowed).toBe(true);
    expect(verdict(parseCorrectionNote('x'.repeat(2001)) ?? '').allowed).toBe(false);
  });

  it('no sealed-editor action parses its audit note through a truncating helper', () => {
    // Fixtures write only the schedule (a declared reference table), so its optional note is not a seal note.
    const NOT_SEALED = new Set(['fixtures/actions.ts']);
    // data-editor and player-links reject an over-length note outright before calling the query layer.
    const REJECTS_OVERLENGTH = new Set(['data-editor/actions.ts', 'player-links/actions.ts']);
    for (const { file, source } of adminSources()) {
      if (NOT_SEALED.has(file) || REJECTS_OVERLENGTH.has(file)) continue;
      // A bare `note` may be a record's own 1000-character field (awards), so only the 2000 cap is the audit note.
      expect(source, file).not.toMatch(/(optionalText|requiredText)\(\s*formData\.get\('(note|adminNote)'\)\s*,\s*2000\s*\)/);
    }
    for (const file of REJECTS_OVERLENGTH) {
      const source = readFileSync(join(ADMIN_DIR, file), 'utf8');
      expect(source, file).toContain('Notes are limited to 2000 characters.');
    }
  });

  it('every audit-note field of the covered actions goes through parseCorrectionNote (pinned per module)', () => {
    const PINNED: Record<string, number> = {
      'awards/actions.ts': 15, 'coaches/actions.ts': 7, 'draft/actions.ts': 9, 'records/actions.ts': 10,
      'season-lists/actions.ts': 5, 'season-lists/leadership-actions.ts': 6,
    };
    for (const [file, expected] of Object.entries(PINNED)) {
      const source = readFileSync(join(ADMIN_DIR, file), 'utf8');
      expect(source.match(/parseCorrectionNote\(formData\.get\('(note|adminNote)'\)\)/g) ?? [], file).toHaveLength(expected);
      // `adminNote` is only ever the audit note, so no read of it may bypass the parser.
      expect(source, file).not.toMatch(/(?<!parseCorrectionNote\()formData\.get\('adminNote'\)/);
    }
  });

  it('no form that carries the correction note uses <form action>, whose automatic reset would wipe a refused edit', () => {
    // React 19 resets every uncontrolled field when a <form action={fn}> settles, refusal included. A sealed-season
    // refusal must keep what the administrator typed, so those forms submit through keepFormOnSubmit instead.
    for (const { file, source } of adminSources()) {
      if (!/CorrectionNoteField|name="note"/.test(source) || !file.endsWith('.tsx')) continue;
      expect(source, file).not.toMatch(/<form[^>]*action={/);
    }
  });

  it('storedNoteText keeps the open-season stored copy exactly as before: trimmed, cut to 2000, blank is null', () => {
    expect(storedNoteText(undefined)).toBeNull();
    expect(storedNoteText('  \n ')).toBeNull();
    expect(storedNoteText('  kept  ')).toBe('kept');
    expect(storedNoteText('y'.repeat(2001))).toHaveLength(2000);
    expect(storedNoteText(` ${'z'.repeat(2500)} `)).toBe('z'.repeat(2000));
  });

  it('the records that keep a note of their own store the capped copy of THEIR OWN note; the correction note reaches only the audit row', () => {
    const q = (file: string) => readFileSync(join(__dirname, '..', 'src', 'db', 'queries', file), 'utf8').replaceAll('\r\n', '\n');
    // V2-GAP-006 review F-003: the correction justification is never the appointment's or the list entry's own note.
    const leadership = q('admin-club-leadership.ts');
    expect(leadership).toContain("'active', ${input.startedOn}::date, ${storedNoteText(input.note)},");
    expect(leadership).toContain('note: storedNoteText(input.note),');
    const fn = (source: string, name: string): string => {
      const start = source.indexOf(`async function ${name}(`);
      const end = source.indexOf('\n}\n', start);
      return start < 0 || end < 0 ? '' : source.slice(start, end);
    };
    const appointment = fn(leadership, 'insertAppointment');
    expect(appointment).toContain('note: input.correctionNote,');
    expect(appointment).not.toContain('note: input.note,\n    seal');
    expect(leadership).toContain("note: (input.appointmentNote ?? '').trim() || null,");
    expect(leadership).toContain("correctionNote: (input.note ?? '').trim() || null,");
    expect(leadership).toContain('note: appointmentNote,\n          correctionNote: note,');
    const lists = q('admin-season-lists.ts');
    expect(lists).toContain('${storedNoteText(input.memberNote)})');
    expect(lists).toContain('note: storedNoteText(input.memberNote),');
    const membership = fn(lists, 'insertMembership');
    expect(membership).toContain('note: input.correctionNote,');
    expect(membership).not.toContain('storedNoteText(input.note)');
    // A removal's durable tombstone carries no note either.
    const removal = fn(lists, 'deleteMembership');
    expect(removal.slice(0, removal.indexOf('recordDataEdit'))).not.toContain('note: input.note');
  });

  it('the actions read the record note and the correction note from separate fields', () => {
    const read = (file: string) => readFileSync(join(ADMIN_DIR, file), 'utf8');
    const lists = read('season-lists/actions.ts');
    expect(lists).toContain("memberNote: optionalText(formData.get('memberNote'), 2000),");
    const leadership = read('season-lists/leadership-actions.ts');
    expect(leadership.split("appointmentNote: optionalText(formData.get('appointmentNote'), 2000),").length - 1).toBe(3);
  });

  it('the Brownlow eligibility publication seals the HUMAN note, never its generated default', () => {
    const q = (file: string) => readFileSync(join(__dirname, '..', 'src', 'db', 'queries', file), 'utf8');
    const publication = q('brownlow-eligibility.ts');
    const calls = publication.match(/await recordDataEdit\(native, \{[\s\S]*?\n    \}\);/g) ?? [];
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toContain("sealNote: 'sealNote' in request ? request.sealNote : request.note");
    const admin = q('admin-brownlow.ts');
    expect(admin).toContain('sealNote: reason,');
    expect(admin).toContain('sealNote: input.note,');
  });

  it('the shared parser never slices', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'lib', 'seasons', 'correction-note.ts'), 'utf8');
    const parser = /export function parseCorrectionNote[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    expect(parser).toContain('parseCorrectionNote');
    expect(parser).not.toMatch(/slice|substring|substr|maxLength/);
  });
});
