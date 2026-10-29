/**
 * AFLDB V2 Stage 3 (V2-GAP-006) — the pure seal on historical seasons: open seasons are
 * writable, sealed seasons are refused unless an audited correction is supplied, every invalid
 * correction field is refused, and the real data/reference/seasons.json seals 2026 but not 2027 (the 2026
 * rollover, AFLDB-ISSUE-316 D-316-1; the explicit predecessor sealed 2025 but not 2026).
 * No database, no network.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

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

import { isSettleSeasonSealed, refuseSealedSeasonForSettle } from '../tools/current-season/settle-season-seal';

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
