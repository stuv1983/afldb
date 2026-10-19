/**
 * AFLDB V2 Launch F — the cutover preflight for LEGACY PRODUCTION WRITERS (V2-GAP-011, V2-GAP-013).
 *
 * Pure: it judges facts an operator gathered on the production host (`tools/v2/cutover-preflight.ts`
 * reads them read-only with `systemctl show` and a directory listing, or takes them from a file). It
 * never runs a command and never changes a unit.
 *
 * The V2 release is refused while any legacy writer can still run:
 *   - the AFL Tables nightly settle (`afldb-settle-afltables.timer` / `.service`), which a V2 checkout
 *     refuses loudly (`deploy/afldb-settle-afltables.sh`), so an enabled timer would fail every night;
 *   - its on-demand start (a polkit rule naming `afldb-settle-afltables`);
 *   - the email-intake poller (`afldb-email-intake.timer` / `.service`), whose route answers 410 in V2.
 * Squiggle / Kali and CSV upload have no unit: they are app surfaces, retired in the code itself.
 *
 * Fail closed: an unknown unit state, a missing unit record or an unreadable listing refuses.
 */

/** The legacy units whose state decides the release. */
export const LEGACY_WRITER_UNITS = [
  'afldb-settle-afltables.timer',
  'afldb-settle-afltables.service',
  'afldb-email-intake.timer',
  'afldb-email-intake.service',
] as const;

/** One unit as `systemctl show --property=Id,LoadState,UnitFileState,ActiveState` reports it. */
export interface LegacyUnitFacts {
  readonly id: string;
  readonly loadState: string;
  readonly unitFileState: string;
  readonly activeState: string;
}

export interface LegacyWriterFacts {
  readonly units: readonly LegacyUnitFacts[];
  /** File names in the host's polkit rules directory, or null when it could not be listed. */
  readonly polkitRules: readonly string[] | null;
}

export interface LegacyWriterFinding {
  readonly subject: string;
  readonly ok: boolean;
  readonly detail: string;
  /** The reversible production-window command that clears a refusal (never run by V2). */
  readonly remedy?: string;
}

export interface LegacyWriterPreflight {
  readonly verdict: 'PASS' | 'REFUSE';
  readonly findings: readonly LegacyWriterFinding[];
}

const RUNNING = new Set(['active', 'activating', 'reloading', 'deactivating', 'refreshing']);
const STOPPED = new Set(['inactive', 'failed']);

function judgeUnit(unit: (typeof LEGACY_WRITER_UNITS)[number], facts: LegacyUnitFacts | undefined): LegacyWriterFinding {
  if (facts === undefined) return { subject: unit, ok: false, detail: 'no state was reported for this unit (fail closed)' };
  const state = `load=${facts.loadState} file=${facts.unitFileState || '-'} active=${facts.activeState}`;
  if (facts.loadState === 'not-found' && STOPPED.has(facts.activeState)) return { subject: unit, ok: true, detail: `not installed (${state})` };
  if (facts.loadState === 'masked' && !RUNNING.has(facts.activeState)) return { subject: unit, ok: true, detail: `masked (${state})` };
  if (facts.loadState !== 'loaded') return { subject: unit, ok: false, detail: `unrecognised load state (${state})` };
  if (RUNNING.has(facts.activeState)) {
    return {
      subject: unit, ok: false, detail: `running now (${state})`,
      remedy: unit.endsWith('.service') ? `wait for ${unit} to finish, then re-run this preflight` : `sudo systemctl disable --now ${unit}`,
    };
  }
  if (!STOPPED.has(facts.activeState)) return { subject: unit, ok: false, detail: `unrecognised active state (${state})` };
  if (unit.endsWith('.timer')) {
    if (facts.unitFileState === 'disabled' || facts.unitFileState === 'masked') return { subject: unit, ok: true, detail: state };
    return { subject: unit, ok: false, detail: `the timer can still fire (${state})`, remedy: `sudo systemctl disable --now ${unit}` };
  }
  // A oneshot service is `static`: it runs only when its timer or a start triggers it.
  return { subject: unit, ok: true, detail: state };
}

export function assessLegacyWriterPreflight(facts: LegacyWriterFacts): LegacyWriterPreflight {
  const byId = new Map(facts.units.map((u) => [u.id, u]));
  const findings: LegacyWriterFinding[] = LEGACY_WRITER_UNITS.map((unit) => judgeUnit(unit, byId.get(unit)));
  if (facts.polkitRules === null) {
    findings.push({ subject: 'polkit rules', ok: false, detail: 'the polkit rules directory could not be listed (fail closed)' });
  } else {
    const rules = facts.polkitRules.filter((name) => name.includes('afldb-settle-afltables'));
    findings.push(rules.length === 0
      ? { subject: 'polkit rules', ok: true, detail: 'no rule grants an on-demand AFL Tables settle start' }
      : {
        subject: 'polkit rules', ok: false,
        detail: `an on-demand AFL Tables start is still granted: ${rules.join(', ')}`,
        remedy: rules.map((r) => `sudo mv /etc/polkit-1/rules.d/${r} /root/afldb-v2-retired/${r}`).join(' && '),
      });
  }
  return { verdict: findings.every((f) => f.ok) ? 'PASS' : 'REFUSE', findings };
}

/** Parses `systemctl show <units...> --property=Id,LoadState,UnitFileState,ActiveState` output. */
export function parseSystemctlShow(text: string): LegacyUnitFacts[] {
  const units: LegacyUnitFacts[] = [];
  for (const block of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const props = new Map<string, string>();
    for (const line of block.split('\n')) {
      const at = line.indexOf('=');
      if (at > 0) props.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
    const id = props.get('Id');
    if (id === undefined) continue;
    units.push({
      id, loadState: props.get('LoadState') ?? '', unitFileState: props.get('UnitFileState') ?? '', activeState: props.get('ActiveState') ?? '',
    });
  }
  return units;
}

export function renderLegacyWriterPreflight(result: LegacyWriterPreflight): string {
  return [
    `Legacy production writers: ${result.verdict}`,
    ...result.findings.map((f) => `  ${f.ok ? 'PASS' : 'REFUSE'} ${f.subject}: ${f.detail}${f.remedy ? `\n         reversible remedy (operator, in the window): ${f.remedy}` : ''}`),
    result.verdict === 'PASS'
      ? 'No legacy writer can run. This is one release precondition, never the release go.'
      : 'The V2 release is refused until every legacy writer above is retired (docs/v2/cutover-runbook.md).',
  ].join('\n');
}
