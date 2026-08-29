/**
 * AFLDB-ISSUE-101 — end-of-season promotion / baseline rollover planner.
 *
 * WHAT THIS IS. When a season finishes, the boundary between "completed
 * history" and "the in-progress season" has to move. That boundary is not one
 * field: it is declared in four tracked artefacts and one TypeScript constant,
 * every one of which is cross-checked against the others by machinery that
 * already exists (`import_fitzroy_core.py`, `validate_ladder_witness.py`,
 * `tools/db/rebuild-test.ts` stage 9). Move one and forget another and the
 * rebuild refuses — correctly, but only *after* the operator has hand-edited
 * several files. This module computes the ENTIRE successor state in memory,
 * proves it coherent, and only then hands it to the CLI to write.
 *
 * WHAT THIS IS NOT.
 *
 *   * It is not a season-completion detector. It reads no clock and no
 *     calendar. Completion is established by a newly acquired full-history
 *     candidate that the EXISTING validator passed, plus a deliberate operator
 *     acknowledgement. Nothing here infers that a season ended.
 *   * It performs no canonical write, opens no database connection and issues
 *     no SQL. Completed-history supersession happens the one way it already
 *     happens: a clean rebuild from the newly accepted baseline.
 *     (AFLDB-ISSUE-099 writes no canonical row, so there is no in-season
 *     canonical provenance to rewrite, and no rewriter is built here.)
 *   * It does not re-point the stage-9 `matches_after_accepted_last_season`
 *     gate. That gate already derives its boundary from
 *     `accepted.measured.seasons_last` and re-points itself when the register
 *     advances. Nothing in this module touches it.
 *   * It does not define `club_seasons` ownership. AFLDB-ISSUE-095 owns the
 *     derivation and is resolved; this module only advances the accepted
 *     ladder WITNESS that stage 8.5 cross-checks the derivation against.
 *
 * REFUSE, NEVER REPAIR. A starting state whose artefacts already disagree is a
 * refusal naming the artefacts, not something to quietly normalise: a
 * half-rolled repository is exactly the condition this module exists to make
 * loud.
 *
 * PURITY. Every function here is deterministic and free of I/O, the clock and
 * the network. `node:crypto` is used for SHA-256 only, over bytes the caller
 * read. The CLI (`tools/db/rollover-season.ts`) owns all filesystem access.
 */
import { createHash } from 'node:crypto';

/** A refusal. Never carries a DSN, a secret or a path outside the repository. */
export class RolloverRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RolloverRefused';
  }
}

function refuse(message: string): never {
  throw new RolloverRefused(message);
}

type Json = Record<string, unknown>;

function obj(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${what} is not a JSON object.`);
  }
  return value as Json;
}

function arr(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) refuse(`${what} is not a JSON array.`);
  return value;
}

function int(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    refuse(`${what} is not an integer (found ${JSON.stringify(value)}).`);
  }
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    refuse(`${what} is not a non-empty string.`);
  }
  return value;
}

/** Deep structural equality over JSON values. Order-sensitive for arrays. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Evidence parsing — the validator is the authority, not the operator
// ---------------------------------------------------------------------------

/**
 * One EXECUTED validator run, as captured by the CLI.
 *
 * This type exists so that validator evidence cannot be a file an operator
 * wrote. The planner will not read a measured fingerprint out of anything that
 * is not the captured result of a real subprocess, with a real exit status and
 * the argv it was invoked with.
 */
export type ValidatorRun = {
  /** The exact argv, so the planner can prove WHAT was validated. */
  argv: readonly string[];
  /** Process exit status. `null` means the process was killed by a signal. */
  status: number | null;
  stdout: string;
  stderr: string;
};

/**
 * The measured fingerprint, read out of the REAL output of
 *
 *   import_fitzroy_core.py --label <new> --snapshot-dir <dir>
 *                          --manifest <path> --validate-only
 *
 * That run re-hashes every artefact against the manifest, checks every CSV's
 * columns and row counts, resolves club and player identity, and prints the
 * summary this parses. It is the inverse of `enforce_accepted_fingerprint()`,
 * which will later re-derive the same values and refuse on any drift.
 *
 * BOTH blocks are required. `--require-full-history` is now run pre-apply
 * against the computed successor contract, so its
 * `full-history gates PASSED — identity coverage` section is present and is the
 * only source of `identity_scan` (see IDENTITY_SCAN_SOURCE_NOTE). Output
 * carrying only the summary means the full-history gate did not run, which is
 * not the evidence this planner asked for.
 */
export type ValidatorEvidence = {
  measured: Record<string, number>;
  identityScan: Record<string, number>;
};

const SUMMARY_HEADER = 'snapshot scan summary';
const COVERAGE_HEADER = 'full-history gates PASSED';

export const IMPORTER = 'tools/migration/import_fitzroy_core.py';
export const LADDER_VALIDATOR = 'tools/rebuild/fitzroy/validate_ladder_witness.py';

/**
 * Flags that would make the run something other than an offline validation.
 * `--validate-only` opens no database connection at all; these would change
 * that, or change what is being adjudicated, so a run carrying one is not the
 * evidence this planner asked for.
 */
const FORBIDDEN_VALIDATOR_FLAGS = [
  '--dry-run', '--groups', '--emit-observations', '--require-in-season',
  '--acknowledge-population-drop', '--on-record-error', '--quiet',
] as const;

const IDENTITY_SCAN_KEYS = [
  'rows', 'missing_id', 'missing_url', 'malformed_url',
  'distinct_ids', 'distinct_urls',
] as const;

/**
 * WHERE `identity_scan` COMES FROM — and why it is no longer an input.
 *
 * The six identity-coverage counts are produced by `measure_identity_coverage()`,
 * which `import_fitzroy_core.py` reaches ONLY from inside `enforce_full_history()`
 * (or the in-season gate, which a full-history candidate is not). And
 * `enforce_full_history()` refuses first:
 *
 *     if rng.get("from") != first or rng.get("to") != last:
 *         raise ... "requested_range ... does not equal the contract's required range"
 *
 * where `first`/`last` come from `tools/rebuild/fitzroy/fitzroy-contract.json`.
 * A candidate covering 1897..Y therefore cannot pass that gate while the
 * TRACKED contract still declares 1897..Y-1 — the gate that would produce the
 * numbers was the gate the numbers were needed to advance past. An earlier
 * iteration of this planner resolved that by accepting the counts as a reviewed
 * operator input, backed by the mandatory post-apply re-derivation.
 *
 * AFLDB-ISSUE-101 closed the gap instead. `import_fitzroy_core.py` now carries a
 * backward-compatible `--contract` override (offline validation only; the
 * tracked contract remains the default), so the CLI materialises the COMPUTED
 * SUCCESSOR contract in a temporary directory and runs the real full-history
 * gate against it BEFORE any tracked file is written. The
 * `full-history gates PASSED — identity coverage` block in that run's stdout is
 * now the ONLY source of `identity_scan`, exactly as the
 * `snapshot scan summary` block is the only source of `measured`.
 *
 * There is no `--identity-scan` flag any more, and therefore no operator
 * statement for the validator to disagree with. The post-apply
 * `--require-accepted-baseline` run and the rebuild's PRECHECK still re-derive
 * all six; they are now a second proof of an executed measurement rather than
 * the first proof of a stated one.
 */
export const IDENTITY_SCAN_SOURCE_NOTE =
  'identity_scan is MEASURED by the executed --require-full-history gate, run against the '
  + 'computed successor contract in a temporary directory before any tracked file is '
  + 'written. It is never an operator input.';

/** Summary keys copied straight through as integers. */
const SUMMARY_INT_KEYS = [
  'matches', 'matches_with_player_rows', 'venues', 'attendance_known',
  'players', 'players_with_dob', 'players_with_dob_conflict',
  'player_match_rows', 'brownlow_round_vote_rows',
] as const;

export function parseValidatorEvidence(output: string): ValidatorEvidence {
  if (typeof output !== 'string' || output.trim() === '') {
    refuse('The full-history validator produced no output to read evidence from.');
  }
  let section: 'none' | 'summary' | 'coverage' = 'none';
  const summary = new Map<string, string>();
  const coverage = new Map<string, string>();

  for (const raw of output.split(/\r?\n/)) {
    if (raw.startsWith(SUMMARY_HEADER)) { section = 'summary'; continue; }
    if (raw.startsWith(COVERAGE_HEADER)) { section = 'coverage'; continue; }
    // Every emitted pair is indented; any unindented line ends the section.
    if (!/^ {2}\S/.test(raw)) {
      if (raw.trim() !== '') section = 'none';
      continue;
    }
    if (section === 'none') continue;
    const match = /^ {2}(\S+)\s{2,}(.*)$/.exec(raw);
    if (!match) continue;
    (section === 'summary' ? summary : coverage).set(match[1], match[2].trim());
  }

  if (summary.size === 0) {
    refuse(`The validator output carries no '${SUMMARY_HEADER}' block, so it is not a `
      + 'snapshot validation and cannot supply a measured fingerprint.');
  }
  if (coverage.size === 0) {
    refuse(`The validator output carries no '${COVERAGE_HEADER}' block, so the full-history `
      + 'gate did not run and identity coverage was never measured. '
      + IDENTITY_SCAN_SOURCE_NOTE);
  }

  const number = (from: Map<string, string>, key: string): number => {
    const value = from.get(key);
    if (value === undefined) {
      refuse(`The validator output records no '${key}', so the measured fingerprint `
        + 'would be incomplete. Refusing to construct a partial acceptance record.');
    }
    if (!/^\d+$/.test(value)) {
      refuse(`The validator's '${key}' is ${JSON.stringify(value)}, which is not a count.`);
    }
    return Number(value);
  };

  const seasons = summary.get('seasons');
  if (seasons === undefined || !/^\d{4}-\d{4}$/.test(seasons)) {
    refuse(`The validator's 'seasons' span is ${JSON.stringify(seasons ?? null)}, which is `
      + 'not a FIRST-LAST range; the accepted boundary cannot be derived from it.');
  }
  const [seasonsFirst, seasonsLast] = seasons.split('-').map(Number);

  const clubs = summary.get('club_identities');
  if (clubs === undefined || clubs.trim() === '') {
    refuse("The validator's 'club_identities' list is empty.");
  }
  // enforce_accepted_fingerprint() counts this the same way: comma-separated names.
  const clubIdentities = clubs.split(', ').filter((c) => c !== '').length;

  const measured: Record<string, number> = {
    matches: number(summary, 'matches'),
    matches_with_player_rows: number(summary, 'matches_with_player_rows'),
    seasons_first: seasonsFirst,
    seasons_last: seasonsLast,
    venues: number(summary, 'venues'),
    attendance_known: number(summary, 'attendance_known'),
    club_identities: clubIdentities,
    players: number(summary, 'players'),
    players_with_dob: number(summary, 'players_with_dob'),
    players_with_dob_conflict: number(summary, 'players_with_dob_conflict'),
    player_match_rows: number(summary, 'player_match_rows'),
    brownlow_round_vote_rows: number(summary, 'brownlow_round_vote_rows'),
  };
  // Named so an unread summary key is visible rather than silently dropped.
  for (const key of SUMMARY_INT_KEYS) {
    if (!(key in measured)) refuse(`Internal: summary key '${key}' was not mapped.`);
  }

  // The identity-coverage block prints exactly the six counts
  // `measure_identity_coverage()` returns, in the same `key<28> value` layout.
  const scan: Record<string, unknown> = {};
  for (const [key, value] of coverage) {
    scan[key] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return { measured, identityScan: assertIdentityScanMeasured(scan) };
}

/**
 * One temporary document a validator run was routed at.
 *
 * `bytes` is what the CLI READ BACK from `path` after writing it, so the
 * planner compares the document the validator actually opened against the
 * successor document it computed — not against a promise that they match.
 */
export type ValidatorOverride = {
  /** The command-line flag that routed the validator at this document. */
  flag: string;
  /** The path passed on the command line. */
  path: string;
  /** The bytes read back from that path after the CLI wrote it. */
  bytes: string;
};

/** Which historical gate a captured run must have carried. */
export type ValidatorGate = 'full-history' | 'accepted-baseline';

const GATE_FLAG: Record<ValidatorGate, string> = {
  'full-history': '--require-full-history',
  'accepted-baseline': '--require-accepted-baseline',
};

/**
 * Every flag that can redirect the importer at a document other than the
 * tracked one. A captured run may carry exactly the overrides the planner
 * required and no others, so a run pointed at some third register or contract
 * is refused rather than read.
 */
const REDIRECTING_FLAGS = [
  '--contract', '--stat-availability', '--accepted-baselines',
] as const;

/**
 * Prove the evidence came from a real validator execution of the RIGHT thing.
 *
 * Without this the planner would accept any text that looks like successful
 * validator output, which would make `--apply` authorised by a file the
 * operator wrote. Five things are checked, and all five matter:
 *
 *   1. the process actually ran and exited 0;
 *   2. it was the importer, in `--validate-only` mode, carrying no flag that
 *      would change what it adjudicates or let it reach a database;
 *   3. it carried the historical gate this evidence is claimed to come from
 *      (`--require-full-history` or `--require-accepted-baseline`), so a bare
 *      snapshot scan can never stand in for a gate that was never run;
 *   4. it was pointed at EXACTLY the label, manifest and snapshot directory
 *      the planner is about to bind into the acceptance record — so the bytes
 *      the validator hashed are the bytes the register will claim;
 *   5. every reference document it was redirected at held EXACTLY the successor
 *      bytes this planner computed, and it was redirected at nothing else. This
 *      is what makes a pre-apply gate run against a temporary successor state
 *      evidence about THIS plan rather than about some other state.
 */
export function assertValidatorRun(run: ValidatorRun, expect: {
  label: string; manifestPath: string; snapshotDir: string;
  gate: ValidatorGate;
  /** flag -> the exact bytes the planner requires that document to hold. */
  requiredOverrides: Array<{ flag: string; content: string }>;
  /** What the CLI actually wrote and pointed the run at. */
  overrides: ValidatorOverride[];
}): string {
  if (typeof run !== 'object' || run === null || !Array.isArray(run.argv)) {
    refuse('No captured validator run was supplied. The measured fingerprint may only '
      + 'come from an executed validation, never from a file or a flag.');
  }
  if (run.status !== 0) {
    const detail = (run.stderr || run.stdout || '').trim().split(/\r?\n/).slice(-4)
      .join(' | ');
    refuse(`The full-history snapshot validation did not pass (exit `
      + `${run.status === null ? 'signal' : run.status}). The rollover is authorised by `
      + `the validator's verdict, and there is no way to proceed without it.`
      + (detail ? ` Last output: ${detail}` : ''));
  }

  const argv = run.argv.map(String);
  if (!argv.some((a) => a.replace(/\\/g, '/').endsWith(IMPORTER))) {
    refuse(`The captured run did not invoke ${IMPORTER}.`);
  }
  if (!argv.includes('--validate-only')) {
    refuse('The captured validator run did not carry --validate-only, so it was not the '
      + 'offline validation this planner requires.');
  }
  for (const flag of FORBIDDEN_VALIDATOR_FLAGS) {
    if (argv.includes(flag)) {
      refuse(`The captured validator run carried ${flag}, which changes what it `
        + 'adjudicates. Refusing to treat it as the offline snapshot validation.');
    }
  }

  const valueOf = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index < 0 ? null : (argv[index + 1] ?? null);
  };
  const normalise = (p: string | null) => (p === null ? null : p.replace(/\\/g, '/'));
  // A label must match exactly. A path may be absolute, so an absolute path is accepted
  // only when it ends at a directory boundary before the expected repository-relative
  // path — never on a bare suffix match.
  const bindings: Array<[string, string | null, string, boolean]> = [
    ['--label', valueOf('--label'), expect.label, false],
    ['--manifest', normalise(valueOf('--manifest')),
      expect.manifestPath.replace(/\\/g, '/'), true],
    ['--snapshot-dir', normalise(valueOf('--snapshot-dir')),
      expect.snapshotDir.replace(/\\/g, '/'), true],
  ];
  for (const [flag, got, want, isPath] of bindings) {
    if (got === null) {
      refuse(`The captured validator run did not pass ${flag}, so it cannot be proved to `
        + 'have validated the candidate this rollover is accepting.');
    }
    if (got !== want && !(isPath && got.endsWith(`/${want}`))) {
      refuse(`The captured validator run passed ${flag} ${JSON.stringify(got)}, but the `
        + `rollover is binding ${JSON.stringify(want)}. The acceptance record must name `
        + 'exactly the artefacts that were validated.');
    }
  }

  const gateFlag = GATE_FLAG[expect.gate];
  if (!argv.includes(gateFlag)) {
    refuse(`The captured validator run did not carry ${gateFlag}, so the ${expect.gate} `
      + 'gate never ran. A snapshot scan is not that gate and must not stand in for it.');
  }

  const required = new Map<string, string>(
    expect.requiredOverrides.map((o) => [o.flag, o.content]));
  const supplied = new Map<string, ValidatorOverride>(
    expect.overrides.map((o) => [o.flag, o]));
  for (const [flag, content] of required) {
    const used = supplied.get(flag);
    if (used === undefined) {
      refuse(`The captured validator run records no ${flag} override. The ${expect.gate} `
        + 'gate must be run against the computed successor state, in a temporary '
        + 'directory, before any tracked file is written.');
    }
    if (valueOf(flag) !== used.path) {
      refuse(`The captured validator run passed ${flag} `
        + `${JSON.stringify(valueOf(flag))}, but the temporary document written for it is `
        + `${JSON.stringify(used.path)}.`);
    }
    if (used.bytes !== content) {
      refuse(`The document at ${used.path}, which ${flag} pointed the validator at, is not `
        + 'the successor document this plan computed. The gate therefore adjudicated some '
        + 'other state and proves nothing about this rollover.');
    }
  }
  for (const flag of REDIRECTING_FLAGS) {
    if (argv.includes(flag) && !required.has(flag)) {
      refuse(`The captured validator run carried ${flag}, which redirects it at a `
        + 'reference document this plan did not compute. Refusing to read its verdict.');
    }
  }
  return run.stdout;
}

/**
 * The six identity-coverage counts, as MEASURED by the executed full-history
 * gate. See IDENTITY_SCAN_SOURCE_NOTE — there is no operator input for these.
 *
 * The internal-possibility check is kept as a parsing sanity net: it can no
 * longer catch a bad operator statement, but it does catch a coverage block
 * this parser has misread.
 */
export function assertIdentityScanMeasured(measured: unknown): Record<string, number> {
  if (measured === undefined || measured === null) {
    refuse('The validator produced no identity coverage. ' + IDENTITY_SCAN_SOURCE_NOTE);
  }
  const doc = obj(measured, 'the measured identity coverage');
  const out: Record<string, number> = {};
  for (const key of IDENTITY_SCAN_KEYS) {
    const value = doc[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      refuse(`The measured identity coverage's '${key}' is not a whole count. All of `
        + `${IDENTITY_SCAN_KEYS.join(', ')} are printed by the full-history gate, so a `
        + 'missing or unreadable one means the block was not the one this expects.');
    }
    out[key] = value;
  }
  const unknown = Object.keys(doc)
    .filter((k) => k !== '$comment' && !IDENTITY_SCAN_KEYS.includes(k as never));
  if (unknown.length > 0) {
    refuse(`The measured identity coverage declares unknown key(s): ${unknown.join(', ')}.`);
  }
  if (out.distinct_urls > out.rows || out.distinct_ids > out.distinct_urls) {
    refuse('The measured identity coverage is internally impossible: distinct URLs cannot '
      + 'exceed scanned rows, and distinct IDs cannot exceed distinct URLs.');
  }
  return out;
}

/**
 * Prove the OFFLINE ladder witness validation ran, against this plan's
 * successor contract and this plan's ladder manifest.
 *
 * `--compare` is deliberately refused here. That half is the D7 set equality
 * against a rebuilt `club_seasons` table, it genuinely needs the database, and
 * `validate_ladder_witness.py` itself refuses to combine it with a temporary
 * contract. It stays where it belongs: inside the rebuild.
 */
export function assertLadderValidatorRun(run: ValidatorRun, expect: {
  witnessLabel: string;
  manifestDir: string;
  contractContent: string;
  overrides: ValidatorOverride[];
}): void {
  if (typeof run !== 'object' || run === null || !Array.isArray(run.argv)) {
    refuse('No captured ladder-witness validation was supplied. The offline witness proof '
      + 'is executed before the write; it is never assumed.');
  }
  if (run.status !== 0) {
    const detail = (run.stderr || run.stdout || '').trim().split(/\r?\n/).slice(-4)
      .join(' | ');
    refuse(`The offline ladder witness validation did not pass (exit `
      + `${run.status === null ? 'signal' : run.status}). The successor witness is not `
      + 'proven, so nothing is written.' + (detail ? ` Last output: ${detail}` : ''));
  }
  const argv = run.argv.map(String);
  if (!argv.some((a) => a.replace(/\\/g, '/').endsWith(LADDER_VALIDATOR))) {
    refuse(`The captured ladder run did not invoke ${LADDER_VALIDATOR}.`);
  }
  if (argv.includes('--compare')) {
    refuse('The captured ladder run carried --compare, which reads the rebuilt database. '
      + 'The pre-apply proof is the OFFLINE half only; --compare adjudicates the tracked '
      + 'accepted witness after the rebuild.');
  }
  const valueOf = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index < 0 ? null : (argv[index + 1] ?? null);
  };
  if (valueOf('--label') !== expect.witnessLabel) {
    refuse(`The captured ladder run validated ${JSON.stringify(valueOf('--label'))}, but `
      + `the rollover is accepting ${JSON.stringify(expect.witnessLabel)}.`);
  }
  const contract = expect.overrides.find((o) => o.flag === '--contract');
  if (contract === undefined) {
    refuse('The captured ladder run records no --contract override. The tracked contract '
      + 'still names the outgoing witness, so the successor witness can only be proven '
      + 'against the computed successor contract.');
  }
  if (valueOf('--contract') !== contract.path) {
    refuse(`The captured ladder run passed --contract `
      + `${JSON.stringify(valueOf('--contract'))}, but the temporary contract written for `
      + `it is ${JSON.stringify(contract.path)}.`);
  }
  if (contract.bytes !== expect.contractContent) {
    refuse('The contract the ladder validator read is not the successor contract this plan '
      + 'computed, so its verdict is about some other state.');
  }
  const manifestDir = valueOf('--manifest-dir');
  if (manifestDir === null
      || manifestDir.replace(/\\/g, '/') !== expect.manifestDir.replace(/\\/g, '/')) {
    refuse(`The captured ladder run read manifests from ${JSON.stringify(manifestDir)}, but `
      + `the rollover binds the manifest in ${JSON.stringify(expect.manifestDir)}. The `
      + 'validator must have hashed exactly the manifest the contract will name.');
  }
}

// ---------------------------------------------------------------------------
// Manifest-derived bindings
// ---------------------------------------------------------------------------

/**
 * The register's own second binding to the artefact set, recomputed here under
 * the rule the register itself declares:
 *
 *   sha256 over sorted lines '<filename> <sha256> <row_count>\n'
 *
 * It is derived from the manifest, never supplied. `verify_accepted_binding()`
 * recomputes it independently on every preflight, so an error here fails the
 * next rebuild rather than blessing anything.
 */
export function artefactSetDigest(manifest: Json): string {
  const files = arr(manifest.files, 'the manifest `files` list');
  const lines = files.map((entry, index) => {
    const file = obj(entry, `manifest file[${index}]`);
    return `${str(file.filename, `manifest file[${index}].filename`)} `
      + `${str(file.sha256, `manifest file[${index}].sha256`)} `
      + `${int(file.row_count, `manifest file[${index}].row_count`)}`;
  }).sort();
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

export function manifestRowTotal(manifest: Json): number {
  return arr(manifest.files, 'the manifest `files` list')
    .reduce((total, entry, index) =>
      total + int(obj(entry, `manifest file[${index}]`).row_count,
        `manifest file[${index}].row_count`), 0);
}

/** Per-season row counts, keyed by the season the filename encodes. */
export function ladderRowsBySeason(manifest: Json): Map<number, number> {
  const bySeason = new Map<number, number>();
  arr(manifest.files, 'the ladder manifest `files` list').forEach((entry, index) => {
    const file = obj(entry, `ladder manifest file[${index}]`);
    const name = str(file.filename, `ladder manifest file[${index}].filename`);
    const match = /^ladder_(\d{4})\.csv$/.exec(name);
    if (!match) {
      refuse(`Ladder witness artefact ${JSON.stringify(name)} is not a 'ladder_YYYY.csv' `
        + 'file, so its season cannot be established.');
    }
    const season = Number(match[1]);
    if (bySeason.has(season)) {
      refuse(`The ladder witness manifest lists season ${season} twice.`);
    }
    bySeason.set(season, int(file.row_count, `ladder manifest file[${index}].row_count`));
  });
  return bySeason;
}

// ---------------------------------------------------------------------------
// The current state, and what "coherent" means
// ---------------------------------------------------------------------------

export type ReferenceState = {
  /** data/reference/fitzroy-accepted-baselines.json */
  register: Json;
  /** data/reference/seasons.json */
  seasons: Json;
  /** tools/rebuild/fitzroy/fitzroy-contract.json */
  contract: Json;
  /** data/reference/stat-availability.json */
  statAvailability: Json;
  /** The row count stage 9 expects, read out of tools/db/rebuild-test.ts. */
  clubSeasonsExpectedRows: number;
};

/** The single accepted baseline, under the register's own selection policy. */
export function selectAccepted(register: Json): Json {
  if (register.contract !== 'afldb.fitzroy.accepted_baselines') {
    refuse('The acceptance register is not an afldb.fitzroy.accepted_baselines document.');
  }
  const policy = obj(register.selection_policy ?? {}, 'selection_policy').rule;
  if (policy !== 'exactly_one_accepted') {
    refuse(`The acceptance register declares selection policy ${JSON.stringify(policy)}, `
      + "but the only policy this rollover implements is 'exactly_one_accepted'.");
  }
  const baselines = arr(register.baselines ?? [], 'register.baselines');
  const accepted = baselines
    .map((b, i) => obj(b, `register.baselines[${i}]`))
    .filter((b) => b.acceptance_status === 'accepted');
  if (accepted.length === 0) {
    refuse('No fitzRoy baseline is marked accepted, so there is no completed historical '
      + 'boundary to roll forward from.');
  }
  if (accepted.length > 1) {
    const names = accepted.map((b) => String(b.snapshot_label)).sort().join(', ');
    refuse(`${accepted.length} fitzRoy baselines are marked accepted (${names}). `
      + 'Deterministic selection among several is not defined policy; the rollover '
      + 'refuses rather than choosing.');
  }
  return accepted[0];
}

/**
 * The non-accepted status vocabulary, if the register declares one.
 *
 * The register today declares only the SELECTION rule ("the single entry whose
 * acceptance_status is 'accepted'"); it declares no vocabulary for what a
 * retired baseline becomes. Rather than invent a word and write it into a
 * tracked acceptance record, this returns null and the caller refuses with the
 * remedy spelled out. Adding the declaration is a deliberate, reviewable
 * decision — not a side effect of the first rollover.
 */
export function retirementVocabulary(register: Json): string[] | null {
  const policy = obj(register.selection_policy ?? {}, 'selection_policy');
  const declared = policy.retired_statuses;
  if (declared === undefined) return null;
  const values = arr(declared, 'selection_policy.retired_statuses')
    .map((v, i) => str(v, `selection_policy.retired_statuses[${i}]`));
  if (values.length === 0) return null;
  if (values.includes('accepted')) {
    refuse("selection_policy.retired_statuses lists 'accepted', which would break the "
      + 'exactly_one_accepted invariant. Refusing to use that vocabulary.');
  }
  return values;
}

/**
 * Prove the artefacts agree with each other BEFORE anything moves.
 *
 * Used twice: once on the current state (a disagreement here means the
 * repository is already half-rolled and the rollover must not paper over it)
 * and once on the computed successor (which is what makes the plan safe to
 * write). Identical rules both times, so the successor is held to exactly the
 * standard the predecessor is.
 */
export function assertCoherent(state: ReferenceState, label: string): void {
  const accepted = selectAccepted(state.register);
  const seasons = state.seasons;
  const contract = state.contract;

  const fullHistory = obj(obj(contract.full_history ?? {}, 'contract.full_history'),
    'contract.full_history');
  const range = obj(fullHistory.season_range ?? {}, 'full_history.season_range');
  const excluded = obj(fullHistory.current_season_excluded ?? {},
    'full_history.current_season_excluded');

  const firstSeason = int(seasons.first_season, 'seasons.json first_season');
  const lastSeason = int(seasons.last_season, 'seasons.json last_season');
  const inProgress = arr(seasons.in_progress_seasons, 'seasons.json in_progress_seasons')
    .map((y, i) => int(y, `in_progress_seasons[${i}]`));
  const rangeFirst = int(range.first_season, 'full_history.season_range.first_season');
  const rangeLast = int(range.last_season, 'full_history.season_range.last_season');

  const disagree = (detail: string): never =>
    refuse(`${label}: ${detail} Refusing to continue — the rollover does not silently `
      + 'repair an inconsistent state.');

  if (rangeFirst !== firstSeason) {
    disagree(`the full-history contract starts at ${rangeFirst} but seasons.json starts `
      + `at ${firstSeason}.`);
  }
  if (rangeLast !== lastSeason - 1) {
    disagree(`the full-history contract's last completed season is ${rangeLast}, but `
      + `seasons.json last_season is ${lastSeason} (the contract requires last_season - 1).`);
  }
  if (inProgress.length === 0) {
    disagree('seasons.json declares no in_progress_seasons; the in-season acquisition '
      + 'path refuses an empty register, so this state is unusable.');
  }
  for (const year of inProgress) {
    if (year <= rangeLast) {
      disagree(`in-progress season ${year} is not later than the accepted completed `
        + `boundary ${rangeLast}.`);
    }
    if (year > lastSeason) {
      disagree(`in-progress season ${year} is outside the season range, which ends at `
        + `${lastSeason}.`);
    }
  }
  if (!jsonEqual([...inProgress].sort(), [...arr(excluded.seasons,
    'current_season_excluded.seasons')].sort())) {
    disagree('full_history.current_season_excluded.seasons does not equal '
      + 'seasons.json in_progress_seasons.');
  }

  const binding = obj(accepted.contract_binding ?? {}, 'accepted.contract_binding');
  const required = obj(binding.required_range ?? {}, 'accepted.required_range');
  if (int(required.first_season, 'accepted.required_range.first_season') !== rangeFirst
      || int(required.last_season, 'accepted.required_range.last_season') !== rangeLast) {
    disagree(`the accepted baseline's required_range is `
      + `${required.first_season}-${required.last_season}, but the full-history contract `
      + `declares ${rangeFirst}-${rangeLast}. import_fitzroy_core.py refuses on exactly `
      + 'this disagreement.');
  }

  const measured = obj(accepted.measured ?? {}, 'accepted.measured');
  const measuredLast = int(measured.seasons_last, 'accepted.measured.seasons_last');
  if (measuredLast !== rangeLast) {
    disagree(`the accepted baseline measured seasons through ${measuredLast}, but the `
      + `full-history contract declares the boundary at ${rangeLast}. Stage 9 derives `
      + 'its boundary from the measured value, so these must agree.');
  }

  const ladder = obj(obj(contract.datasets ?? {}, 'contract.datasets').ladder ?? {},
    'contract.datasets.ladder');
  const coverage = obj(ladder.coverage ?? {}, 'datasets.ladder.coverage');
  const witness = obj(ladder.accepted_witness ?? {}, 'datasets.ladder.accepted_witness');
  const coverageLast = int(coverage.last_season, 'ladder.coverage.last_season');
  if (coverageLast !== rangeLast) {
    disagree(`the accepted ladder witness covers through ${coverageLast}, but the accepted `
      + `completed boundary is ${rangeLast}. validate_ladder_witness.py --compare is a `
      + 'set equality against the whole club_seasons table, so a span mismatch fails.');
  }
  const coverageRows = int(coverage.club_season_rows, 'ladder.coverage.club_season_rows');
  if (int(witness.rows, 'ladder.accepted_witness.rows') !== coverageRows) {
    disagree('the accepted ladder witness row count disagrees with its own coverage block.');
  }
  if (state.clubSeasonsExpectedRows !== coverageRows) {
    disagree(`stage 9 expects ${state.clubSeasonsExpectedRows} club_seasons rows but the `
      + `accepted ladder witness carries ${coverageRows}.`);
  }
}

// ---------------------------------------------------------------------------
// Stat availability — reviewed, never fabricated
// ---------------------------------------------------------------------------

const RECORDED_COVERAGE = new Set(['complete', 'partial']);
const VALID_COVERAGE = new Set([
  'complete', 'partial', 'pending', 'not_collected', 'not_applicable',
]);

type CoverageCell = { key: string; season: number; coverage: string };

function coverageCells(doc: Json, what: string): CoverageCell[] {
  const cells: CoverageCell[] = [];
  const seen = new Set<string>();
  arr(doc.coverage_ranges, `${what} coverage_ranges`).forEach((entry, index) => {
    const range = obj(entry, `${what} coverage_ranges[${index}]`);
    const key = str(range.stat_key, `${what} coverage_ranges[${index}].stat_key`);
    const coverage = str(range.coverage, `${what} coverage_ranges[${index}].coverage`);
    if (!VALID_COVERAGE.has(coverage)) {
      refuse(`${what} declares coverage ${JSON.stringify(coverage)} for '${key}', which is `
        + `not one of ${[...VALID_COVERAGE].sort().join(', ')}.`);
    }
    const first = int(range.first_season, `${what} coverage_ranges[${index}].first_season`);
    const last = int(range.last_season, `${what} coverage_ranges[${index}].last_season`);
    if (last < first) {
      refuse(`${what}: '${key}' declares the range ${first}..${last}, which runs backwards.`);
    }
    for (let season = first; season <= last; season += 1) {
      const cell = `${key}:${season}`;
      if (seen.has(cell)) refuse(`${what} covers ${cell} twice.`);
      seen.add(cell);
      cells.push({ key, season, coverage });
    }
  });
  return cells;
}

/**
 * Validate the operator's REVIEWED successor stat-availability document.
 *
 * This file states what data AFLDB actually has, per statistic per season. It
 * is not a list of season numbers, and mechanically dragging every range
 * forward would assert that a season nobody has played yet already carries
 * complete statistics. So the successor document is a required, reviewed input
 * and this function only ever CHECKS it:
 *
 *   * nothing may claim `complete` or `partial` coverage for a season later
 *     than the season being completed — the fabrication gate;
 *   * nothing recorded for a completed season may quietly stop being recorded
 *     — the retraction gate;
 *   * every range must lie inside the successor season span, and no cell may
 *     be declared twice (the loader's own rules).
 *
 * Whether the newly completed season's Brownlow families move from `pending`
 * to a recorded class is exactly the kind of evidence-dependent decision this
 * refuses to guess: the operator states it and the diff shows it.
 */
export function assertStatAvailabilityReviewed(input: {
  current: Json;
  reviewed: Json;
  completedSeason: number;
  firstSeason: number;
  successorLastSeason: number;
}): { uncoveredForNewSeason: string[] } {
  const { current, reviewed, completedSeason, firstSeason, successorLastSeason } = input;

  if (reviewed.status !== 'READY') {
    refuse('The reviewed stat-availability document is not status READY, so the loader '
      + 'would ignore its coverage ranges.');
  }

  const after = coverageCells(reviewed, 'The reviewed stat-availability document');
  for (const cell of after) {
    if (cell.season < firstSeason || cell.season > successorLastSeason) {
      refuse(`The reviewed stat-availability document covers '${cell.key}' in `
        + `${cell.season}, outside the successor season range `
        + `${firstSeason}..${successorLastSeason}.`);
    }
    if (cell.season > completedSeason && RECORDED_COVERAGE.has(cell.coverage)) {
      refuse(`The reviewed stat-availability document declares '${cell.key}' `
        + `${cell.coverage} for ${cell.season}, a season later than the one being `
        + `completed (${completedSeason}). A season that has not been played cannot `
        + 'already have recorded data; the rollover will not fabricate availability.');
    }
  }

  const before = coverageCells(current, 'The current stat-availability document');
  const afterByCell = new Map(after.map((c) => [`${c.key}:${c.season}`, c.coverage]));
  for (const cell of before) {
    if (cell.season > completedSeason || !RECORDED_COVERAGE.has(cell.coverage)) continue;
    const now = afterByCell.get(`${cell.key}:${cell.season}`);
    if (now === undefined || !RECORDED_COVERAGE.has(now)) {
      refuse(`The reviewed stat-availability document retracts recorded coverage for `
        + `'${cell.key}' in ${cell.season} (was ${cell.coverage}, now `
        + `${now ?? 'absent'}). Losing recorded history is not a rollover outcome.`);
    }
  }

  // Reported, never enforced: a stat family with nothing to say about the new
  // in-progress season is a normal, honest state.
  const keys = new Set(after.map((c) => c.key));
  const covered = new Set(after.filter((c) => c.season === successorLastSeason)
    .map((c) => c.key));
  return {
    uncoveredForNewSeason: [...keys].filter((k) => !covered.has(k)).sort(),
  };
}

// ---------------------------------------------------------------------------
// Accepted corrections — reviewed for THIS acquisition, never inherited
// ---------------------------------------------------------------------------

const CORRECTIONS_COMMENT = '$comment';

/**
 * Validate the operator's REVIEWED `accepted_corrections` state for the
 * candidate baseline.
 *
 * WHY THIS IS NOT INHERITED. `accepted_corrections` records what a specific
 * acceptance decision covers: which source-club normalisations, which dropped
 * source rows, which import transformations were examined and settled for
 * THAT acquisition's bytes. A new acquisition is different bytes. Copying the
 * outgoing baseline's list forward would silently re-assert findings nobody
 * re-checked — the acceptance record would claim a review that never happened.
 * So the planner reads the outgoing baseline's corrections for their CATEGORY
 * NAMES only, and never for their values.
 *
 * WHAT "no corrections" LOOKS LIKE. The established shape in the register is
 * an object of category name -> array of `{kind, rule, ...}` entries. Empty is
 * therefore unambiguous in that shape already: the same categories, each an
 * empty array. The operator states that explicitly; it is never a default and
 * never an omission.
 *
 * The category set must match the outgoing baseline's exactly, so a category
 * cannot quietly disappear from the acceptance record either.
 */
export function assertAcceptedCorrectionsReviewed(input: {
  outgoing: unknown;
  reviewed: unknown;
}): { categories: string[]; entryCount: number } {
  const { outgoing, reviewed } = input;

  if (reviewed === undefined || reviewed === null) {
    refuse('No reviewed accepted_corrections state was supplied for the candidate '
      + 'baseline. Corrections are a per-acquisition acceptance decision and are never '
      + 'inherited from the outgoing baseline, so there is no default. Supply '
      + '--accepted-corrections with the reviewed state — for an acquisition needing '
      + 'none, that is the same categories with empty arrays.');
  }
  const doc = obj(reviewed, 'the reviewed accepted_corrections state');

  const categoriesOf = (value: unknown): string[] => {
    if (value === undefined || value === null) return [];
    return Object.keys(obj(value, 'accepted_corrections'))
      .filter((key) => key !== CORRECTIONS_COMMENT).sort();
  };

  const reviewedCategories = categoriesOf(doc);
  let entryCount = 0;
  for (const category of reviewedCategories) {
    const entries = arr(doc[category], `reviewed accepted_corrections.${category}`);
    entries.forEach((entry, index) => {
      const record = obj(entry, `reviewed accepted_corrections.${category}[${index}]`);
      str(record.kind, `reviewed accepted_corrections.${category}[${index}].kind`);
      str(record.rule, `reviewed accepted_corrections.${category}[${index}].rule`);
      entryCount += 1;
    });
  }

  // The outgoing record is consulted for its SHAPE only. Its entries are never read.
  const expected = categoriesOf(outgoing);
  if (expected.length > 0 && !jsonEqual(reviewedCategories, expected)) {
    refuse(`The reviewed accepted_corrections state declares categories `
      + `[${reviewedCategories.join(', ')}], but the acceptance record's established `
      + `shape is [${expected.join(', ')}]. State every category explicitly — an `
      + 'acquisition that needs none of a category declares it as an empty array, so a '
      + 'missing category is an omission rather than a decision.');
  }

  return { categories: reviewedCategories, entryCount };
}

// ---------------------------------------------------------------------------
// The stage-9 expected club-season row count
// ---------------------------------------------------------------------------

const CLUB_SEASONS_ROWS_ANCHOR =
  /(export const CLUB_SEASONS_EXPECTED = \{\s*\r?\n\s*rows: )(\d+)(,)/;

/**
 * Rewrite `CLUB_SEASONS_EXPECTED.rows` in tools/db/rebuild-test.ts.
 *
 * DECISION (AFLDB-ISSUE-101): the constant stays EXPLICIT REVIEWED EVIDENCE
 * rather than being derived from the accepted ladder witness at plan time.
 * Deriving it would have removed a hand-maintained number, but it would also
 * have widened stage 9's input surface to a third file for no correctness
 * gain — the strong guarantee already comes from
 * `validate_ladder_witness.py --compare`, a bidirectional set equality between
 * the witness and a table derived independently from `matches`. Keeping the
 * constant separate means a rollover that advances the witness and forgets
 * stage 9 fails loudly instead of agreeing with itself. The planner therefore
 * requires the operator to state the number and REFUSES unless it equals the
 * witness's own row total.
 *
 * Pure: takes source text, returns source text. Refuses on anything but
 * exactly one anchored match, so a refactor of that constant cannot be
 * silently mis-edited.
 */
export function planClubSeasonsConstantEdit(
  source: string, expectedCurrent: number, next: number,
): string {
  const matches = source.match(new RegExp(CLUB_SEASONS_ROWS_ANCHOR, 'g'));
  if (!matches || matches.length !== 1) {
    refuse(`tools/db/rebuild-test.ts does not contain exactly one CLUB_SEASONS_EXPECTED `
      + `rows declaration (found ${matches?.length ?? 0}). Refusing to edit source it `
      + 'cannot locate unambiguously.');
  }
  const found = Number(CLUB_SEASONS_ROWS_ANCHOR.exec(source)![2]);
  if (found !== expectedCurrent) {
    refuse(`tools/db/rebuild-test.ts declares CLUB_SEASONS_EXPECTED.rows = ${found}, but `
      + `the current state was read as ${expectedCurrent}.`);
  }
  return source.replace(CLUB_SEASONS_ROWS_ANCHOR, `$1${next}$3`);
}

/** Read the constant without executing the module. */
export function readClubSeasonsExpectedRows(source: string): number {
  const match = CLUB_SEASONS_ROWS_ANCHOR.exec(source);
  if (!match) {
    refuse('tools/db/rebuild-test.ts declares no CLUB_SEASONS_EXPECTED.rows value.');
  }
  return Number(match[2]);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Command-line shape, parsed and validated WITHOUT touching the filesystem.
 *
 * It lives here rather than in the CLI so that "the operator forgot a flag" is
 * a unit-testable refusal instead of something only reachable by spawning a
 * process. It validates presence and shape only; every path is resolved and
 * read by the CLI, which owns all I/O.
 */
export type RolloverArgs = {
  season: number;
  acknowledgeSeasonComplete: boolean;
  apply: boolean;
  rolloverDate: string;
  retirementStatus: string;
  expectedClubSeasonRows: number;
  coreManifest: string;
  ladderManifest: string;
  ladderCoverage: string;
  statAvailability: string;
  acceptedCorrections: string;
};

export function parseRolloverArgv(argv: string[]): RolloverArgs {
  const valueFor = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      refuse(`${flag} needs a value.`);
    }
    return value;
  };
  const need = (flag: string): string => {
    const value = valueFor(flag);
    if (value === null) refuse(`${flag} is required.`);
    return value;
  };
  const needInt = (flag: string): number => {
    const raw = need(flag);
    if (!/^\d+$/.test(raw)) {
      refuse(`${flag} must be a whole number, not ${JSON.stringify(raw)}.`);
    }
    return Number(raw);
  };

  const apply = argv.includes('--apply');
  const acknowledgeSeasonComplete = argv.includes('--acknowledge-season-complete');
  if (apply && !acknowledgeSeasonComplete) {
    refuse('--apply requires --acknowledge-season-complete. Writing the rollover is the '
      + 'deliberate release decision that a season has finished, and this tool has no '
      + 'other way to know that.');
  }
  // There is no way to hand this tool a verdict. The validators are executed on every
  // invocation, dry run and apply alike, and neither a skip nor a supplied transcript
  // exists to be offered.
  for (const banned of ['--skip-validation', '--no-validate', '--force',
    '--core-validator-output', '--assume-validated']) {
    if (argv.includes(banned)) {
      refuse(`${banned} does not exist. The snapshot validator is executed on every run — `
        + 'a rollover is authorised by its verdict, never by an assertion that it passed.');
    }
  }
  // Retired by AFLDB-ISSUE-101: identity coverage is now measured by the executed
  // full-history gate, so accepting a stated one would reintroduce exactly the
  // operator-supplied evidence this tool exists to refuse.
  if (argv.includes('--identity-scan')) {
    refuse('--identity-scan no longer exists. ' + IDENTITY_SCAN_SOURCE_NOTE);
  }

  return {
    season: needInt('--season'),
    acknowledgeSeasonComplete,
    apply,
    rolloverDate: need('--rollover-date'),
    retirementStatus: need('--retire-status'),
    expectedClubSeasonRows: needInt('--expected-club-season-rows'),
    coreManifest: need('--core-manifest'),
    ladderManifest: need('--ladder-manifest'),
    ladderCoverage: need('--ladder-coverage'),
    statAvailability: need('--stat-availability'),
    acceptedCorrections: need('--accepted-corrections'),
  };
}

export type RolloverRequest = {
  /** The season being completed. Explicit; never inferred from a clock. */
  season: number;
  /** The deliberate release decision. Without it, nothing is planned. */
  acknowledgeSeasonComplete: boolean;
  /** Stamped into accepted_on / validated_on / resolved_on. Explicit, not now(). */
  rolloverDate: string;
  /** What the outgoing baseline becomes. Must come from the register's vocabulary. */
  retirementStatus: string;
  /** Stage 9's reviewed expectation. Must equal the new witness's row total. */
  expectedClubSeasonRows: number;
};

/**
 * Everything the successor CONTRACT and `seasons.json` can be computed from.
 *
 * Deliberately excludes the validator runs. The successor contract has to exist
 * before the full-history gate can be pointed at it, and it depends on nothing
 * that gate produces — so it is computed first, materialised in a temporary
 * directory, and the gate is then run against it.
 */
export type SuccessorEvidence = {
  /** The new full-history acquisition manifest, parsed. */
  coreManifest: Json;
  /** Repository-relative path of that manifest. */
  coreManifestPath: string;
  /** Repository-relative snapshot directory the validator is pointed at. */
  coreSnapshotDir: string;
  /** The new ladder-witness acquisition manifest, parsed. */
  ladderManifest: Json;
  ladderManifestSha256: string;
  ladderManifestPath: string;
  /** The reviewed successor `datasets.ladder.coverage` block. */
  ladderCoverage: Json;
  /** The reviewed successor stat-availability document, parsed. */
  statAvailability: Json;
  /**
   * The exact bytes of that reviewed document. It is written through verbatim
   * rather than re-serialised, so the file that lands is byte-identical to the
   * file that was reviewed and none of its hand-maintained column alignment is
   * destroyed. It is also the document the pre-apply gates are pointed at.
   */
  statAvailabilityText: string;
  /**
   * The reviewed `accepted_corrections` state for THIS candidate acquisition.
   * Never defaulted and never inherited from the outgoing baseline.
   */
  acceptedCorrections: Json;
};

export type RolloverEvidence = SuccessorEvidence & {
  /** SHA-256 of the core manifest's bytes, computed by the caller from disk. */
  coreManifestSha256: string;
  /**
   * The CAPTURED result of the CLI executing the FULL-HISTORY gate against the
   * successor contract. Not a file, not a flag: `assertValidatorRun` refuses
   * anything that is not a real run of the right command against the right
   * artefacts and the right successor documents. Both `measured` AND
   * `identity_scan` come from this run's stdout.
   */
  coreValidatorRun: ValidatorRun;
  /** The temporary documents that run was routed at, read back from disk. */
  coreValidatorOverrides: ValidatorOverride[];
};

export type PlannedFile = { path: string; content: string; reformatted: boolean };

/**
 * The successor state that does not depend on any validator run.
 *
 * `planSeasonRollover` recomputes this from the same inputs, so the contract
 * the pre-apply gates were pointed at is provably the contract that gets
 * written: both are the deterministic output of one pure function.
 */
export type SuccessorState = {
  completedSeason: number;
  newInProgressSeason: number;
  firstSeason: number;
  retiredLabel: string;
  candidateLabel: string;
  witnessLabel: string;
  witnessRows: number;
  /** Directory the ladder validator must read `<witnessLabel>.json` from. */
  ladderManifestDir: string;
  /** The successor fitzRoy contract, exactly as it will be written. */
  contractContent: string;
  contractDocument: Json;
  /** The successor seasons.json, exactly as it will be written. */
  seasonsContent: string;
  seasonsDocument: Json;
  contractReformatted: boolean;
  seasonsReformatted: boolean;
  notes: string[];
  /** The outgoing accepted baseline, for the register the second stage builds. */
  outgoingBaseline: Json;
  requiredDatasets: unknown[];
  corrections: { categories: string[]; entryCount: number };
};

export type RolloverPlan = {
  completedSeason: number;
  newInProgressSeason: number;
  retiredLabel: string;
  acceptedLabel: string;
  witnessLabel: string;
  measured: Record<string, number>;
  identityScan: Record<string, number>;
  clubSeasonRows: { from: number; to: number };
  files: PlannedFile[];
  notes: string[];
  /** The bindings the remaining pre-apply gates must be checked against. */
  authority: {
    coreManifestPath: string;
    coreSnapshotDir: string;
    ladderManifestDir: string;
    successorContractContent: string;
    successorRegisterContent: string;
    reviewedStatAvailabilityContent: string;
  };
};

const REGISTER_PATH = 'data/reference/fitzroy-accepted-baselines.json';
const SEASONS_PATH = 'data/reference/seasons.json';
const CONTRACT_PATH = 'tools/rebuild/fitzroy/fitzroy-contract.json';
const STAT_AVAILABILITY_PATH = 'data/reference/stat-availability.json';
const REBUILD_PATH = 'tools/db/rebuild-test.ts';

/**
 * The line ending the existing document uses, so a rewrite does not silently
 * convert the whole file.
 *
 * Every tracked artefact in this repository is CRLF in a Windows checkout, and
 * emitting LF would have shown up as "every line changed" in review — which is
 * exactly the diff noise that makes a rollover unreviewable. Detected rather
 * than assumed, so the same code is correct on a Linux checkout.
 */
export function lineEndingOf(source: string): '\r\n' | '\n' {
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * Deterministic 2-space JSON with a trailing newline, in the source document's
 * own line ending.
 *
 * This is the repository's established convention for a machine-written
 * tracked reference document: `tools/rebuild/draftguru/export_link_decisions.py`
 * writes `data/reference/draftguru-link-decisions.json` as
 * `json.dumps(..., indent=2) + "\n"`, and that file round-trips through this
 * function unchanged. It does NOT reproduce the hand-maintained inline arrays
 * and column alignment in the older reference files; see the note the planner
 * emits, and the semantic-equivalence proof in the test suite.
 */
function serialise(doc: unknown, source: string): string {
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  const ending = lineEndingOf(source);
  return ending === '\n' ? body : body.replace(/\n/g, '\r\n');
}

/**
 * Compute the successor CONTRACT and `seasons.json`, or refuse.
 *
 * This is stage one of two, and the split exists for one reason: the
 * repository's own full-history gate can only adjudicate a successor candidate
 * when it is reading the successor contract, so that document has to be
 * computed and materialised BEFORE the gate runs. Nothing here depends on
 * anything the gate produces, so there is no circularity — only an ordering.
 *
 * Every refusal that does not need validator evidence lives here, which means a
 * half-rolled repository, an incoherent starting state, a candidate covering
 * the wrong span, a fabricated stat-availability document or an inherited
 * corrections block all refuse before a subprocess is even spawned.
 */
export function planSuccessorContract(input: {
  request: RolloverRequest;
  current: ReferenceState;
  currentSources: { register: string; seasons: string; contract: string;
                    statAvailability: string; rebuild: string };
  evidence: SuccessorEvidence;
}): SuccessorState {
  const { request, current, currentSources, evidence } = input;
  const notes: string[] = [];

  // --- the request itself -------------------------------------------------
  const Y = int(request.season, '--season');
  if (!request.acknowledgeSeasonComplete) {
    refuse(`Season ${Y} has not been acknowledged complete. This tool has no way to know `
      + 'that a season ended — it reads no clock and no calendar — so completion is an '
      + 'explicit operator decision, backed by a validated full-history candidate. Pass '
      + '--acknowledge-season-complete once both are true.');
  }
  if (!ISO_DATE.test(request.rolloverDate)) {
    refuse('--rollover-date must be an explicit YYYY-MM-DD date. The rollover never reads '
      + 'the system clock, so the date it stamps is one the operator states.');
  }

  // --- the starting state must already be coherent -------------------------
  assertCoherent(current, 'The repository\'s current reference state is inconsistent');

  const accepted = selectAccepted(current.register);
  const measuredNow = obj(accepted.measured ?? {}, 'accepted.measured');
  const acceptedLast = int(measuredNow.seasons_last, 'accepted.measured.seasons_last');
  const inProgress = arr(current.seasons.in_progress_seasons, 'in_progress_seasons')
    .map((y, i) => int(y, `in_progress_seasons[${i}]`));

  // Idempotence: a second attempt is a clear refusal, never a quiet no-op.
  if (Y <= acceptedLast) {
    refuse(`Season ${Y} is already inside the accepted historical boundary (the accepted `
      + `baseline measures through ${acceptedLast}). It has already been rolled over; `
      + 'there is nothing to do and nothing will be written.');
  }
  if (!inProgress.includes(Y)) {
    refuse(`Season ${Y} is not in seasons.json in_progress_seasons `
      + `(${inProgress.join(', ')}), so it is not the season this pipeline owns and `
      + 'cannot be the one completing.');
  }
  if (Y !== acceptedLast + 1) {
    refuse(`Season ${Y} does not directly follow the accepted boundary ${acceptedLast}. `
      + 'The historical baseline advances one season at a time; a gap would leave '
      + `${acceptedLast + 1}..${Y - 1} in neither the completed core nor the in-season `
      + 'pipeline.');
  }
  if (inProgress.length !== 1) {
    refuse(`seasons.json declares ${inProgress.length} in-progress seasons `
      + `(${inProgress.join(', ')}). The successor contract requires exactly one, so a `
      + 'multi-season rollover is not representable and is refused rather than guessed.');
  }
  const newInProgress = Y + 1;

  // --- the retirement status ----------------------------------------------
  const vocabulary = retirementVocabulary(current.register);
  if (vocabulary === null) {
    refuse('The acceptance register declares no vocabulary for a retired baseline. It '
      + "declares only the SELECTION rule ('exactly_one_accepted'), so there is no "
      + 'supported value for what the outgoing baseline becomes, and this rollover will '
      + 'not invent one and write it into a tracked acceptance record. Add an explicit '
      + `selection_policy.retired_statuses list to ${REGISTER_PATH} as a separate `
      + 'reviewed decision, then re-run.');
  }
  if (!vocabulary.includes(request.retirementStatus)) {
    refuse(`--retire-status ${JSON.stringify(request.retirementStatus)} is not one of the `
      + `register's declared retired statuses (${vocabulary.join(', ')}).`);
  }

  // --- the core candidate --------------------------------------------------
  const coreManifest = evidence.coreManifest;
  const newLabel = str(coreManifest.snapshot_label, 'the core manifest snapshot_label');
  const retiredLabel = str(accepted.snapshot_label, 'the accepted baseline snapshot_label');
  if (newLabel === retiredLabel) {
    refuse(`The candidate manifest carries the label of the currently accepted baseline `
      + `(${newLabel}). Snapshots are immutable; a new acquisition needs a new label.`);
  }
  for (const [index, entry] of arr(current.register.baselines ?? [], 'baselines').entries()) {
    if (obj(entry, `baselines[${index}]`).snapshot_label === newLabel) {
      refuse(`The acceptance register already contains a baseline labelled ${newLabel}.`);
    }
  }

  const fullHistory = obj(obj(current.contract.full_history ?? {}, 'full_history'),
    'full_history');
  const range = obj(fullHistory.season_range ?? {}, 'season_range');
  const firstSeason = int(range.first_season, 'season_range.first_season');

  const coreRange = obj(coreManifest.requested_range ?? {}, 'core manifest requested_range');
  if (int(coreRange.from, 'core manifest requested_range.from') !== firstSeason
      || int(coreRange.to, 'core manifest requested_range.to') !== Y) {
    refuse(`The candidate acquisition covers ${coreRange.from}-${coreRange.to}, but a `
      + `full-history candidate for a rollover to ${Y} must cover ${firstSeason}-${Y}.`);
  }
  const requiredDatasets = arr(fullHistory.required_datasets, 'required_datasets');
  if (!jsonEqual(coreManifest.datasets_requested, requiredDatasets)) {
    refuse('The candidate acquisition\'s datasets do not match the contract\'s '
      + `required_datasets (${requiredDatasets.join(', ')}).`);
  }
  if (coreManifest.fitzroy_version_pinned !== current.contract.pinned_version) {
    refuse(`The candidate acquisition pins fitzRoy `
      + `${String(coreManifest.fitzroy_version_pinned)}, but the contract pins `
      + `${String(current.contract.pinned_version)}.`);
  }

  // --- the ladder witness ---------------------------------------------------
  const ladderManifest = evidence.ladderManifest;
  const ladder = obj(obj(current.contract.datasets ?? {}, 'datasets').ladder ?? {}, 'ladder');
  const currentWitness = obj(ladder.accepted_witness ?? {}, 'accepted_witness');
  const currentCoverage = obj(ladder.coverage ?? {}, 'ladder.coverage');
  const witnessLabel = str(ladderManifest.snapshot_label, 'the ladder manifest label');
  if (witnessLabel === currentWitness.snapshot_label) {
    refuse(`The ladder witness manifest carries the currently accepted witness label `
      + `(${witnessLabel}). A witness covering a new season is a new acquisition.`);
  }
  const ladderRange = obj(ladderManifest.requested_range ?? {}, 'ladder requested_range');
  const coverageFirst = int(currentCoverage.first_season, 'ladder.coverage.first_season');
  if (int(ladderRange.from, 'ladder requested_range.from') !== coverageFirst
      || int(ladderRange.to, 'ladder requested_range.to') !== Y) {
    refuse(`The ladder witness covers ${ladderRange.from}-${ladderRange.to}, but it must `
      + `cover exactly the accepted completed span ${coverageFirst}-${Y}. `
      + 'validate_ladder_witness.py --compare is a set equality against the whole '
      + 'club_seasons table, so any other span fails the rebuild.');
  }
  if (!jsonEqual(ladderManifest.datasets_requested, ['ladder'])) {
    refuse('The ladder witness manifest requests datasets other than `ladder`.');
  }

  // `validate_ladder_witness.py` derives its manifest as `<manifest_dir>/<label>.json`
  // and hashes those bytes against the contract's `manifest_sha256`. Binding a manifest
  // whose filename is not the label would mean the validator hashed a different file
  // from the one this plan binds, so it refuses here rather than there.
  const ladderSlashed = evidence.ladderManifestPath.replace(/\\/g, '/');
  const ladderCut = ladderSlashed.lastIndexOf('/');
  const ladderManifestDir = ladderCut < 0 ? '.' : ladderSlashed.slice(0, ladderCut);
  const ladderBasename = ladderSlashed.slice(ladderCut + 1);
  if (ladderBasename !== `${witnessLabel}.json`) {
    refuse(`The ladder witness manifest is ${JSON.stringify(evidence.ladderManifestPath)}, `
      + `but its label is ${JSON.stringify(witnessLabel)}. The witness validator reads `
      + `'<dir>/${witnessLabel}.json', so a manifest filed under any other name cannot be `
      + 'the one it validates.');
  }

  const rowsBySeason = ladderRowsBySeason(ladderManifest);
  const expectedSeasons = Y - coverageFirst + 1;
  if (rowsBySeason.size !== expectedSeasons) {
    refuse(`The ladder witness manifest lists ${rowsBySeason.size} seasons, but `
      + `${coverageFirst}-${Y} is ${expectedSeasons} seasons.`);
  }
  for (let season = coverageFirst; season <= Y; season += 1) {
    if (!rowsBySeason.has(season)) {
      refuse(`The ladder witness manifest has no artefact for season ${season}.`);
    }
  }
  const witnessRows = manifestRowTotal(ladderManifest);

  // The CLUB_SEASONS_EXPECTED decision, enforced: the operator states stage 9's
  // number and it must equal the witness's own total.
  if (request.expectedClubSeasonRows !== witnessRows) {
    refuse(`--expected-club-season-rows ${request.expectedClubSeasonRows} disagrees with `
      + `the ladder witness's own ${witnessRows} rows. Stage 9's expectation is kept as `
      + 'separate reviewed evidence precisely so this disagreement is visible; correct '
      + 'the number or the acquisition, do not reconcile them by hand.');
  }
  if (witnessRows <= current.clubSeasonsExpectedRows) {
    refuse(`The new ladder witness carries ${witnessRows} club-season rows, which is not `
      + `more than the current ${current.clubSeasonsExpectedRows}. Completing a season `
      + 'adds club-seasons.');
  }

  // The reviewed successor coverage block: every gate-bearing field is checked
  // against the manifest; the probe-documentation fields are the operator's.
  const reviewedCoverage = obj(evidence.ladderCoverage, 'the reviewed ladder coverage block');
  const coverageChecks: Array<[string, unknown, unknown]> = [
    ['first_season', reviewedCoverage.first_season, coverageFirst],
    ['last_season', reviewedCoverage.last_season, Y],
    ['seasons_returned', reviewedCoverage.seasons_returned, expectedSeasons],
    ['club_season_rows', reviewedCoverage.club_season_rows, witnessRows],
  ];
  for (const [field, got, want] of coverageChecks) {
    if (got !== want) {
      refuse(`The reviewed ladder coverage block declares ${field} = `
        + `${JSON.stringify(got)}, but the acquisition proves ${JSON.stringify(want)}.`);
    }
  }
  const counts = [...rowsBySeason.values()];
  const minRows = Math.min(...counts);
  const maxRows = Math.max(...counts);
  const declaredMin = obj(reviewedCoverage.min_rows_season ?? {}, 'coverage.min_rows_season');
  const declaredMax = obj(reviewedCoverage.max_rows_season ?? {}, 'coverage.max_rows_season');
  if (declaredMin.rows !== minRows || declaredMax.rows !== maxRows) {
    refuse(`The reviewed ladder coverage block declares min/max season row counts `
      + `${JSON.stringify(declaredMin.rows)}/${JSON.stringify(declaredMax.rows)}, but the `
      + `acquisition contains ${minRows}/${maxRows}.`);
  }

  // --- accepted corrections -------------------------------------------------
  // Read for its category shape only; the outgoing entries are never consulted.
  const corrections = assertAcceptedCorrectionsReviewed({
    outgoing: accepted.accepted_corrections,
    reviewed: evidence.acceptedCorrections,
  });

  // --- stat availability ----------------------------------------------------
  const statResult = assertStatAvailabilityReviewed({
    current: current.statAvailability,
    reviewed: evidence.statAvailability,
    completedSeason: Y,
    firstSeason: int(current.seasons.first_season, 'seasons.first_season'),
    successorLastSeason: newInProgress,
  });
  if (statResult.uncoveredForNewSeason.length > 0) {
    notes.push(`stat-availability: ${statResult.uncoveredForNewSeason.length} stat `
      + `key(s) declare no coverage for ${newInProgress} `
      + `(${statResult.uncoveredForNewSeason.join(', ')}). That is legal and may be `
      + 'correct; it is reported so the omission is a decision, not an oversight.');
  }

  // --- build the successor documents ---------------------------------------
  const seasonsNext = JSON.parse(JSON.stringify(current.seasons)) as Json;
  seasonsNext.last_season = newInProgress;
  seasonsNext.in_progress_seasons = [newInProgress];
  const notesNow = obj(current.seasons.season_notes ?? {}, 'seasons.season_notes');
  const carried = notesNow[String(Y)];
  if (carried === undefined) {
    refuse(`seasons.json carries no season_notes entry for the in-progress season ${Y}, so `
      + 'the rollover cannot carry its wording forward and will not invent prose.');
  }
  const notesNext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(notesNow)) {
    if (key !== String(Y)) notesNext[key] = value;
  }
  notesNext[String(newInProgress)] = carried;
  seasonsNext.season_notes = notesNext;
  notes.push(`seasons.json: season_notes for ${Y} removed and carried verbatim to `
    + `${newInProgress} (${JSON.stringify(carried)}).`);

  const contractNext = JSON.parse(JSON.stringify(current.contract)) as Json;
  const fhNext = obj(contractNext.full_history, 'full_history');
  const rangeNext = obj(fhNext.season_range, 'season_range');
  rangeNext.last_season = Y;
  rangeNext.last_season_rule = `the latest COMPLETED season: data/reference/seasons.json `
    + `last_season (${newInProgress}) minus every entry in in_progress_seasons `
    + `([${newInProgress}])`;
  rangeNext.resolved_on = request.rolloverDate;
  obj(fhNext.current_season_excluded, 'current_season_excluded').seasons = [newInProgress];

  const ladderNext = obj(obj(contractNext.datasets, 'datasets').ladder, 'ladder');
  const witnessNext = obj(ladderNext.accepted_witness, 'accepted_witness');
  witnessNext.snapshot_label = witnessLabel;
  witnessNext.manifest = evidence.ladderManifestPath;
  witnessNext.manifest_sha256 = evidence.ladderManifestSha256;
  witnessNext.files = arr(ladderManifest.files, 'ladder files').length;
  witnessNext.rows = witnessRows;
  witnessNext.acquired_on = str(ladderManifest.extraction_date,
    'the ladder manifest extraction_date');
  witnessNext.validator =
    `tools/rebuild/fitzroy/validate_ladder_witness.py --label ${witnessLabel}`;
  ladderNext.coverage = reviewedCoverage;

  return {
    completedSeason: Y,
    newInProgressSeason: newInProgress,
    firstSeason,
    retiredLabel,
    candidateLabel: newLabel,
    witnessLabel,
    witnessRows,
    ladderManifestDir,
    contractContent: serialise(contractNext, currentSources.contract),
    contractDocument: contractNext,
    seasonsContent: serialise(seasonsNext, currentSources.seasons),
    seasonsDocument: seasonsNext,
    contractReformatted:
      serialise(current.contract, currentSources.contract) !== currentSources.contract,
    seasonsReformatted:
      serialise(current.seasons, currentSources.seasons) !== currentSources.seasons,
    notes,
    outgoingBaseline: accepted,
    requiredDatasets,
    corrections,
  };
}

/**
 * Compute the complete successor state, or refuse.
 *
 * Stage two. It recomputes stage one from the same inputs — `planSuccessorContract`
 * is pure and deterministic, so the contract the pre-apply gates were pointed at
 * IS the contract this writes — and then reads `measured` and `identity_scan`
 * out of the executed full-history gate.
 *
 * Nothing is written here and nothing is written by the caller until every
 * check below has passed, including a full re-validation of the SUCCESSOR
 * against the same coherence rules the current state had to satisfy, and — in
 * the CLI — `assertPreApplyAuthority` over the two remaining executed gates.
 */
export function planSeasonRollover(input: {
  request: RolloverRequest;
  current: ReferenceState;
  currentSources: { register: string; seasons: string; contract: string;
                    statAvailability: string; rebuild: string };
  evidence: RolloverEvidence;
}): RolloverPlan {
  const { request, current, currentSources, evidence } = input;
  const successor = planSuccessorContract(input);
  const notes = [...successor.notes];

  const Y = successor.completedSeason;
  const newInProgress = successor.newInProgressSeason;
  const firstSeason = successor.firstSeason;
  const newLabel = successor.candidateLabel;
  const retiredLabel = successor.retiredLabel;
  const witnessLabel = successor.witnessLabel;
  const witnessRows = successor.witnessRows;
  const accepted = successor.outgoingBaseline;
  const requiredDatasets = successor.requiredDatasets;
  const measuredNow = obj(accepted.measured ?? {}, 'accepted.measured');
  const coreManifest = evidence.coreManifest;
  const fullHistory = obj(obj(current.contract.full_history ?? {}, 'full_history'),
    'full_history');

  // --- the executed full-history gate is the authority ----------------------
  //
  // Not a transcript, not a flag, and not the tracked contract: the run proved
  // below carried --require-full-history against the successor contract this
  // plan computed, materialised in a temporary directory. Both the measured
  // fingerprint and the identity scan are read out of its stdout.
  const validatorStdout = assertValidatorRun(evidence.coreValidatorRun, {
    label: newLabel,
    manifestPath: evidence.coreManifestPath,
    snapshotDir: evidence.coreSnapshotDir,
    gate: 'full-history',
    requiredOverrides: [
      { flag: '--contract', content: successor.contractContent },
      { flag: '--stat-availability', content: evidence.statAvailabilityText },
    ],
    overrides: evidence.coreValidatorOverrides ?? [],
  });
  const { measured, identityScan } = parseValidatorEvidence(validatorStdout);
  if (measured.seasons_first !== firstSeason || measured.seasons_last !== Y) {
    refuse(`The validator measured seasons ${measured.seasons_first}-`
      + `${measured.seasons_last}, but the rollover is to ${firstSeason}-${Y}. The `
      + 'evidence does not describe the candidate being accepted.');
  }
  if (measured.matches <= int(measuredNow.matches, 'accepted.measured.matches')) {
    refuse(`The candidate measures ${measured.matches} matches, which is not more than the `
      + `currently accepted ${measuredNow.matches}. Adding a completed season cannot `
      + 'reduce or preserve the match count.');
  }

  const seasonsNext = successor.seasonsDocument;
  const contractNext = successor.contractDocument;
  const registerNext = JSON.parse(JSON.stringify(current.register)) as Json;
  const baselinesNext = arr(registerNext.baselines, 'baselines')
    .map((entry, index) => {
      const baseline = obj(entry, `baselines[${index}]`);
      if (baseline.snapshot_label === retiredLabel) {
        return { ...baseline, acceptance_status: request.retirementStatus };
      }
      return baseline;
    });

  const acquisitionNow = obj(accepted.acquisition ?? {}, 'accepted.acquisition');
  const rawNow = obj(accepted.raw_artefacts ?? {}, 'accepted.raw_artefacts');
  const bindingNow = obj(accepted.contract_binding ?? {}, 'accepted.contract_binding');
  const validationNow = obj(accepted.validation ?? {}, 'accepted.validation');

  const newBaseline: Json = {
    snapshot_label: newLabel,
    acceptance_status: 'accepted',
    accepted_on: request.rolloverDate,
    issue: 'AFLDB-ISSUE-101',
    competition: accepted.competition,
    snapshot_dir: `data/sources/afltables/fitzroy_core/${newLabel}`,
    acquisition: {
      manifest_path: evidence.coreManifestPath,
      manifest_sha256: evidence.coreManifestSha256,
      immutable: true,
      adapter: coreManifest.adapter,
      adapter_schema_version: coreManifest.adapter_schema_version,
      extraction_timestamp_utc: coreManifest.extraction_timestamp_utc,
      fitzroy_version_pinned: coreManifest.fitzroy_version_pinned,
      $comment: acquisitionNow.$comment,
    },
    raw_artefacts: {
      file_count: arr(coreManifest.files, 'core manifest files').length,
      total_rows: manifestRowTotal(coreManifest),
      artefact_set_sha256: artefactSetDigest(coreManifest),
      digest_rule: rawNow.digest_rule,
      $comment: rawNow.$comment,
    },
    contract_binding: {
      fitzroy_contract: bindingNow.fitzroy_contract,
      contract_version: current.contract.contract_version,
      contract_full_history_version: fullHistory.contract_full_history_version,
      required_range: { first_season: firstSeason, last_season: Y },
      required_datasets: requiredDatasets,
    },
    validation: {
      authority: validationNow.authority,
      command: `import_fitzroy_core.py --label ${newLabel} --validate-only `
        + '--require-full-history',
      verdict: 'PASSED',
      validated_on: request.rolloverDate,
      database_accessed: false,
      $comment: validationNow.$comment,
    },
    measured: { $comment: measuredNow.$comment, ...measured },
    identity_scan: {
      $comment: obj(accepted.identity_scan ?? {}, 'accepted.identity_scan').$comment,
      ...identityScan,
    },
    accepted_corrections: evidence.acceptedCorrections,
  };
  baselinesNext.push(newBaseline);
  registerNext.baselines = baselinesNext;
  notes.push(`acceptance register: accepted_corrections were REVIEWED for `
    + `${newLabel} — ${successor.corrections.entryCount} entr`
    + `${successor.corrections.entryCount === 1 ? 'y' : 'ies'} across `
    + `[${successor.corrections.categories.join(', ')}]. Nothing was inherited from `
    + `${retiredLabel}; its entries were not read.`);

  const rebuildNext = planClubSeasonsConstantEdit(
    currentSources.rebuild, current.clubSeasonsExpectedRows, witnessRows,
  );

  // --- the successor must satisfy exactly the rules the predecessor did -----
  assertCoherent({
    register: registerNext,
    seasons: seasonsNext,
    contract: contractNext,
    statAvailability: evidence.statAvailability,
    clubSeasonsExpectedRows: witnessRows,
  }, 'The computed successor state is inconsistent');

  // --- emit -----------------------------------------------------------------
  //
  // stat-availability is written through as the operator's OWN BYTES. It is the
  // one document the rollover replaces wholesale rather than mutates, so
  // re-serialising it would gain nothing and would destroy the hand-maintained
  // column alignment of the file whose review is mandatory. Writing the reviewed
  // bytes also makes the landed file byte-identical to the reviewed file, which
  // is a correctness property, not a cosmetic one.
  let restated: string;
  try {
    restated = JSON.stringify(JSON.parse(evidence.statAvailabilityText));
  } catch {
    refuse('The reviewed stat-availability bytes are not valid JSON, so they cannot be '
      + 'written through as the reviewed document.');
  }
  if (restated !== JSON.stringify(evidence.statAvailability)) {
    refuse('The reviewed stat-availability bytes and the parsed document handed to the '
      + 'planner are not the same document. Refusing to write bytes that were not the '
      + 'ones validated.');
  }

  const registerContent = serialise(registerNext, currentSources.register);
  const planned: PlannedFile[] = [
    { path: REGISTER_PATH, content: registerContent,
      reformatted: serialise(current.register, currentSources.register)
        !== currentSources.register },
    { path: SEASONS_PATH, content: successor.seasonsContent,
      reformatted: successor.seasonsReformatted },
    { path: CONTRACT_PATH, content: successor.contractContent,
      reformatted: successor.contractReformatted },
    { path: STAT_AVAILABILITY_PATH, content: evidence.statAvailabilityText,
      reformatted: false },
    { path: REBUILD_PATH, content: rebuildNext, reformatted: false },
  ];
  const reformatted = planned.filter((f) => f.reformatted).map((f) => f.path);
  if (reformatted.length > 0) {
    notes.push(`Whitespace will be normalised to deterministic 2-space JSON in: `
      + `${reformatted.join(', ')}. These files are hand-formatted with inline arrays that `
      + 'no serialiser reproduces, so a rewrite expands them. Key order, line endings and '
      + 'every value are preserved; the test suite proves the only SEMANTIC changes are '
      + 'the intended ones. Read the diff for content, not for shape.');
  }
  notes.push(`Pre-apply verdict (1/3): ${IMPORTER} --validate-only --require-full-history `
    + `EXECUTED and exited 0 against ${evidence.coreManifestPath} and `
    + `${evidence.coreSnapshotDir}, with --contract and --stat-availability pointed at the `
    + 'successor documents this plan computed, in a temporary directory. It re-hashed '
    + 'every artefact, checked every CSV shape, resolved identity and measured identity '
    + 'coverage; both the measured fingerprint and the identity scan above are its '
    + `output, not an operator statement. ${IDENTITY_SCAN_SOURCE_NOTE}`);
  notes.push(`Pre-apply gates (2/3 and 3/3), both executed against the same temporary `
    + `successor state before anything is written: ${IMPORTER} --label ${newLabel} `
    + `--validate-only --require-accepted-baseline (the acceptance binding + measured `
    + `fingerprint + identity-scan drift gate, run against the successor register this `
    + `plan computed), and ${LADDER_VALIDATOR} --label ${witnessLabel} (the offline `
    + 'witness proof: manifest binding, per-file hashes, per-season structure and '
    + 'identity resolution). Any failure means zero tracked writes.');
  notes.push(`Post-REBUILD: ${LADDER_VALIDATOR} --label ${witnessLabel} --compare is the `
    + 'D7 club_seasons cross-check and genuinely needs the rebuilt database, so it is the '
    + 'one proof that stays part of the afldb_test rebuild rather than gating the write. '
    + `${IMPORTER} --require-accepted-baseline also runs again in the rebuild's PRECHECK, `
    + 'that time against the landed tracked documents.');
  notes.push('No canonical row is written by this tool. Completed-history supersession '
    + 'happens when `npm run db:test:rebuild` next rebuilds from the newly accepted '
    + 'baseline; stage 9 will then gate `matches_after_accepted_last_season` at '
    + `season > ${Y} automatically, because it derives that boundary from `
    + 'accepted.measured.seasons_last.');

  return {
    completedSeason: Y,
    newInProgressSeason: newInProgress,
    retiredLabel,
    acceptedLabel: newLabel,
    witnessLabel,
    measured,
    identityScan,
    clubSeasonRows: { from: current.clubSeasonsExpectedRows, to: witnessRows },
    files: planned,
    notes,
    authority: {
      coreManifestPath: evidence.coreManifestPath,
      coreSnapshotDir: evidence.coreSnapshotDir,
      ladderManifestDir: successor.ladderManifestDir,
      successorContractContent: successor.contractContent,
      successorRegisterContent: registerContent,
      reviewedStatAvailabilityContent: evidence.statAvailabilityText,
    },
  };
}

/**
 * The LAST pre-apply gate, and the one that makes "zero tracked writes on any
 * failure" true rather than aspirational.
 *
 * `planSeasonRollover` proves the full-history gate; it cannot prove the other
 * two, because the acceptance gate has to read the successor REGISTER, which
 * does not exist until that plan is built. So the CLI materialises the register,
 * runs the remaining two gates against the temporary successor state, and this
 * adjudicates them. It throws `RolloverRefused` on anything short of both
 * having passed against exactly this plan's documents; the CLI writes only
 * after it returns.
 *
 * The acceptance run's own measured fingerprint and identity coverage are
 * compared against the plan's, so the two executions must agree with each other
 * as well as with the artefacts — a disagreement means one of them was reading
 * something else.
 */
export function assertPreApplyAuthority(input: {
  plan: RolloverPlan;
  acceptance: { run: ValidatorRun; overrides: ValidatorOverride[] };
  ladder: { run: ValidatorRun; overrides: ValidatorOverride[] };
}): void {
  const { plan, acceptance, ladder } = input;

  const stdout = assertValidatorRun(acceptance.run, {
    label: plan.acceptedLabel,
    manifestPath: plan.authority.coreManifestPath,
    snapshotDir: plan.authority.coreSnapshotDir,
    gate: 'accepted-baseline',
    requiredOverrides: [
      { flag: '--contract', content: plan.authority.successorContractContent },
      { flag: '--stat-availability',
        content: plan.authority.reviewedStatAvailabilityContent },
      { flag: '--accepted-baselines', content: plan.authority.successorRegisterContent },
    ],
    overrides: acceptance.overrides ?? [],
  });

  const again = parseValidatorEvidence(stdout);
  if (!jsonEqual(again.measured, plan.measured)
      || !jsonEqual(again.identityScan, plan.identityScan)) {
    refuse('The acceptance gate measured a different fingerprint from the full-history '
      + 'gate this plan was built on. Two runs over the same artefacts must agree; they '
      + 'do not, so nothing is written.');
  }

  assertLadderValidatorRun(ladder.run, {
    witnessLabel: plan.witnessLabel,
    manifestDir: plan.authority.ladderManifestDir,
    contractContent: plan.authority.successorContractContent,
    overrides: ladder.overrides ?? [],
  });
}
