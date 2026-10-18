/**
 * AFLDB-ISSUE-316 C2 — the season rollover retires AFL Tables network fetching
 * in the same write.
 *
 * WHY. The rollover writes `in_progress_seasons: [Y + 1]` and refuses an empty
 * register. Left `active`, the AFL Tables nightly would then fetch season
 * Y + 1 from afltables.com and could insert, and so own, its matches before the
 * AFL API settle does. So the rollover itself writes
 * `data/reference/afltables-network.json` to `retired`, and refuses to plan
 * anything unless that switch is `active` and bounded to exactly the season
 * being completed — the state in which the final AFL Tables full-history
 * acquisition this rollover consumes was possible.
 *
 * WHICH DECISION. The operator names the owner decision with
 * `--afltables-retirement-decision`, and it must be EXACTLY the one registered
 * for the season being completed in `AFLTABLES_RETIREMENT_DECISIONS` (2026:
 * `D-316-1`). A well-formed but unrelated id (`D-999-1`, `D-316-10`) is refused:
 * a decision id is evidence of authority only when it is the decision that
 * authorised this act. The flag stays generic because the switch can be
 * re-activated for a later season (ISSUE-316 §7, Recovery); that re-activation
 * is a reviewed commit with its own owner decision, and the same commit adds its
 * season and decision to the table here. No entry, no retirement.
 *
 * WHAT IT DOES NOT DO. It cannot prove when the core snapshot was acquired, and
 * it does not decide that AFL Tables should be retired: the decision exists
 * outside this code, and the reviewed rollover commit is the record. Rolling over a season AFTER AFL Tables is
 * retired (about October 2027) is refused here, because the full-history
 * acquisition that rollover would need cannot be made: that is the
 * ownership-replay successor design (D-316-6), not something to work around.
 *
 * Pure: the CLI (`tools/db/rollover-season.ts`) reads the files and writes the
 * planned bytes.
 */
import { parseAfltablesNetworkStatus } from '../acquisition/afltables-network';

import { RolloverRefused, lineEndingOf, type PlannedFile } from './season-rollover';

export const AFLTABLES_NETWORK_PATH = 'data/reference/afltables-network.json';
export const AFLTABLES_RETIREMENT_DECISION_FLAG = '--afltables-retirement-decision';

const DECISION_ID = /^D-[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * The owner decision that authorises retiring AFL Tables at the rollover of
 * each season, keyed by the season being completed. Only these exact strings
 * authorise; adding an entry is a reviewed change that names the decision.
 */
export const AFLTABLES_RETIREMENT_DECISIONS: Readonly<Record<number, string>> = Object.freeze({
  2026: 'D-316-1',
});

function refuse(message: string): never {
  throw new RolloverRefused(message);
}

/**
 * The decision id the operator named, syntax only (`D-…`, given once).
 * Whether it AUTHORISES this rollover is `planAfltablesNetworkRetirement`'s
 * check, which knows the season.
 */
export function parseAfltablesRetirementDecision(argv: readonly string[]): string {
  const index = argv.indexOf(AFLTABLES_RETIREMENT_DECISION_FLAG);
  if (index >= 0 && argv.indexOf(AFLTABLES_RETIREMENT_DECISION_FLAG, index + 1) >= 0) {
    refuse(`${AFLTABLES_RETIREMENT_DECISION_FLAG} was given more than once; name the one owner decision once.`);
  }
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined || value.startsWith('--')) {
    refuse(`${AFLTABLES_RETIREMENT_DECISION_FLAG} <decision id> is required (AFLDB-ISSUE-316 D-316-1). `
      + `The rollover writes ${AFLTABLES_NETWORK_PATH} to 'retired' in the same write as the next `
      + 'in-progress season, so the AFL Tables nightly can never fetch that season; it needs the '
      + 'owner decision that authorises it.');
  }
  if (!DECISION_ID.test(value)) {
    refuse(`${AFLTABLES_RETIREMENT_DECISION_FLAG} must be a decision id such as D-316-1, not `
      + `${JSON.stringify(value)}.`);
  }
  return value;
}

export function planAfltablesNetworkRetirement(input: {
  /** The season the rollover completes. */
  completedSeason: number;
  /** The rollover's own explicit `--rollover-date`, already validated. */
  rolloverDate: string;
  decision: string;
  /** The switch's bytes, as the CLI read them. */
  currentSource: string;
  /** `seasons.json` as it stands BEFORE the rollover, parsed. */
  currentSeasons: unknown;
}): { file: PlannedFile; note: string } {
  const { completedSeason: Y, rolloverDate, decision, currentSource } = input;
  let current: unknown;
  try {
    current = JSON.parse(currentSource);
  } catch {
    refuse(`${AFLTABLES_NETWORK_PATH} is not valid JSON, so the rollover cannot show that the final `
      + 'AFL Tables acquisition was possible, nor retire the switch from a known state.');
  }

  const status = parseAfltablesNetworkStatus(current, input.currentSeasons);
  if (status !== 'active') {
    refuse(`${AFLTABLES_NETWORK_PATH} reads '${status}' against the current in-progress register. `
      + 'This rollover consumes a final AFL Tables full-history acquisition, which only an active, '
      + `bounded switch allows, and it is the step that retires the switch. A rollover after AFL `
      + 'Tables is retired needs the ownership-replay / AFL API baseline design (AFLDB-ISSUE-316 '
      + 'D-316-6); it is refused, not worked around.');
  }
  const control = current as Record<string, unknown>;
  if (control.last_season !== Y) {
    refuse(`${AFLTABLES_NETWORK_PATH} bounds AFL Tables to last_season ${String(control.last_season)}, `
      + `but this rollover completes ${Y}. The switch must name exactly the season being completed, `
      + 'so the final acquisition and the retirement are about the same season.');
  }
  const authorised = Object.hasOwn(AFLTABLES_RETIREMENT_DECISIONS, Y) ? AFLTABLES_RETIREMENT_DECISIONS[Y] : undefined;
  if (authorised === undefined) {
    refuse(`No owner decision is registered for retiring AFL Tables at the ${Y} rollover `
      + '(AFLTABLES_RETIREMENT_DECISIONS in src/lib/rollover/afltables-network-retirement.ts). '
      + 'The commit that re-activated the switch for this season must register the decision that '
      + 'authorises retiring it again; the rollover will not accept one named only on the command line.');
  }
  if (decision !== authorised) {
    refuse(`${AFLTABLES_RETIREMENT_DECISION_FLAG} ${JSON.stringify(decision)} does not authorise retiring `
      + `AFL Tables at the ${Y} rollover: the recorded owner decision is ${authorised} `
      + '(AFLDB-ISSUE-316 §8). Any other id, however well formed, is refused.');
  }

  const next: Record<string, unknown> = { ...control, status: 'retired', decision, changed_at: rolloverDate };
  // Belt and braces: whatever register lands beside it, the written switch refuses.
  if (parseAfltablesNetworkStatus(next, { in_progress_seasons: [] }) !== 'retired') {
    refuse('Internal error: the planned switch is not retired.');
  }
  const ending = lineEndingOf(currentSource);
  const serialise = (doc: unknown): string => {
    const body = `${JSON.stringify(doc, null, 2)}\n`;
    return ending === '\n' ? body : body.replace(/\n/g, '\r\n');
  };

  return {
    file: {
      path: AFLTABLES_NETWORK_PATH,
      content: serialise(next),
      reformatted: serialise(control) !== currentSource,
    },
    note: `${AFLTABLES_NETWORK_PATH}: status active -> retired (last_season ${Y} kept; decision `
      + `${decision}; changed_at ${rolloverDate}). Written BEFORE the other files, so an interrupted `
      + `write leaves AFL Tables retired, never fetching ${Y + 1}; a commit that carries `
      + `seasons.json [${Y + 1}] without it leaves the switch out of bounds, and every gate refuses. `
      + 'Every AFL Tables network path refuses from the deploy of this commit.',
  };
}
