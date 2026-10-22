/**
 * AFLDB-ISSUE-316 C2 — successor ladder tuples (mechanism A).
 *
 * WHY. The rebuild accepts a ladder `rebuild_expectation` only when its profile names a reviewed
 * fingerprint tuple in a closed table. The predecessor and the rehearsal-only candidate are in that
 * table; a production successor for the next completed season needs a tuple of its own, but a profile
 * NAME must never be what grants it. A successor tuple is therefore an explicit, fingerprint-bound
 * record that also names the predecessor tuple it supersedes, and it is judged TOGETHER with the
 * documents it must agree with: the selected register entry, the retained retired predecessor entry,
 * the fitzRoy contract (range, witness binding, in-progress exclusion), `seasons.json`, and the witness
 * manifest from which the expected row count is derived independently.
 *
 * WHAT IT DOES NOT DO. It adopts nothing. The table is EMPTY in the repository until an owner-reviewed
 * adoption replaces the literal; it grants no census, rollover, source-acceptance or target authority,
 * and it never relaxes the rehearsal-only restrictions. Those checks live where they always did.
 *
 * Pure: no filesystem, no database, no clock.
 */

import { createHash } from 'node:crypto';

type Json = Record<string, unknown>;

export class LadderSuccessorRefused extends Error {}

function refuse(message: string): never {
  throw new LadderSuccessorRefused(message);
}

/** The fields the rebuild's pair carries (the same shape as the rehearsal package's `RehearsalPair`). */
export type LadderTuple = Readonly<{
  profile: string;
  core_snapshot_label: string;
  core_manifest_sha256: string;
  core_artefact_set_sha256: string;
  witness_snapshot_label: string;
  witness_manifest_sha256: string;
  first_season: number;
  last_season: number;
  expected_rows: number;
}>;

/** A tuple plus the predecessor profile it supersedes. */
export type SuccessorLadderTuple = LadderTuple & Readonly<{ supersedes: string }>;

const HEX64 = /^[0-9a-f]{64}$/;
const PROFILE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const TUPLE_KEYS: readonly string[] = [
  'profile', 'supersedes', 'core_snapshot_label', 'core_manifest_sha256', 'core_artefact_set_sha256',
  'witness_snapshot_label', 'witness_manifest_sha256', 'first_season', 'last_season', 'expected_rows',
];

/** A name that says rehearsal can never be a successor, and a rehearsal profile is never a predecessor. */
export function isRehearsalProfileName(name: string): boolean {
  return /rehearsal/i.test(name);
}

function season(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1800 || value > 2200) {
    refuse(`${what} is not a season year (got ${JSON.stringify(value)}).`);
  }
  return value;
}

function label(value: unknown, what: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    refuse(`${what} is not a snapshot label (got ${JSON.stringify(value)}).`);
  }
  return value;
}

function hex(value: unknown, what: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) refuse(`${what} must be a lower-case SHA-256 (64 hex).`);
  return value;
}

/** Validate one tuple's schema. The table key must equal the tuple's own profile. */
export function assertSuccessorLadderTuple(value: unknown, key: string): SuccessorLadderTuple {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`successor tuple ${JSON.stringify(key)} must be an object.`);
  }
  const o = value as Json;
  for (const k of Object.keys(o)) {
    if (!TUPLE_KEYS.includes(k)) refuse(`successor tuple ${JSON.stringify(key)} has the unknown field ${JSON.stringify(k)}.`);
  }
  for (const k of TUPLE_KEYS) {
    if (!(k in o)) refuse(`successor tuple ${JSON.stringify(key)} is missing ${JSON.stringify(k)}.`);
  }
  const profile = o.profile;
  if (typeof profile !== 'string' || !PROFILE_NAME.test(profile) || profile !== key) {
    refuse(`successor tuple key ${JSON.stringify(key)} and its profile ${JSON.stringify(profile)} must be the same lower-case hyphenated name.`);
  }
  if (isRehearsalProfileName(profile)) {
    refuse(`successor profile ${JSON.stringify(profile)} names a rehearsal; a rehearsal profile is never a successor.`);
  }
  const supersedes = o.supersedes;
  if (typeof supersedes !== 'string' || !PROFILE_NAME.test(supersedes) || supersedes === profile
      || isRehearsalProfileName(supersedes)) {
    refuse(`successor tuple ${JSON.stringify(key)} must supersede a different, non-rehearsal profile.`);
  }
  const first = season(o.first_season, `${key}.first_season`);
  const last = season(o.last_season, `${key}.last_season`);
  if (last < first) refuse(`successor tuple ${JSON.stringify(key)} covers ${first}..${last}, which is empty.`);
  const rows = o.expected_rows;
  if (typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows <= 0) {
    refuse(`successor tuple ${JSON.stringify(key)} expected_rows must be a positive integer.`);
  }
  return Object.freeze({
    profile, supersedes,
    core_snapshot_label: label(o.core_snapshot_label, `${key}.core_snapshot_label`),
    core_manifest_sha256: hex(o.core_manifest_sha256, `${key}.core_manifest_sha256`),
    core_artefact_set_sha256: hex(o.core_artefact_set_sha256, `${key}.core_artefact_set_sha256`),
    witness_snapshot_label: label(o.witness_snapshot_label, `${key}.witness_snapshot_label`),
    witness_manifest_sha256: hex(o.witness_manifest_sha256, `${key}.witness_manifest_sha256`),
    first_season: first, last_season: last, expected_rows: rows,
  });
}

/** Parse the closed table. Any malformed or inconsistent entry refuses the whole table. */
export function parseSuccessorLadderTuples(json: string): Record<string, SuccessorLadderTuple> {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (error) {
    refuse(`SUCCESSOR_LADDER_TUPLES_JSON is not valid JSON: ${String(error)}`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    refuse('SUCCESSOR_LADDER_TUPLES_JSON must be a JSON object keyed by profile name.');
  }
  const table: Record<string, SuccessorLadderTuple> = {};
  for (const [key, value] of Object.entries(doc as Json)) table[key] = assertSuccessorLadderTuple(value, key);
  return table;
}

// ---------------------------------------------------------------------------
// The source literal (read and edited without executing the module)
// ---------------------------------------------------------------------------

const LITERAL = /(export const SUCCESSOR_LADDER_TUPLES_JSON = ')([^'\r\n]*)(';)/g;

/** The JSON literal in `tools/db/rebuild-test.ts`, exactly one, read without executing the module. */
export function readSuccessorLadderTuplesJson(source: string): string {
  const matches = [...source.matchAll(LITERAL)];
  if (matches.length !== 1) {
    refuse(`tools/db/rebuild-test.ts does not contain exactly one SUCCESSOR_LADDER_TUPLES_JSON literal (found ${matches.length}).`);
  }
  return matches[0][2];
}

/**
 * Append exactly one reviewed tuple to the literal. Existing entries stay byte-identical, the new key must
 * be absent, and the result must parse back to the existing table plus that one tuple.
 */
export function planSuccessorTuplesEdit(source: string, tuple: SuccessorLadderTuple): string {
  const currentJson = readSuccessorLadderTuplesJson(source);
  const current = parseSuccessorLadderTuples(currentJson);
  if (Object.hasOwn(current, tuple.profile)) {
    refuse(`rebuild-test.ts already lists the successor profile ${JSON.stringify(tuple.profile)}.`);
  }
  const entries = Object.entries(current).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  entries.push(`${JSON.stringify(tuple.profile)}:${JSON.stringify(tuple)}`);
  const nextJson = `{${entries.join(',')}}`;
  const next = parseSuccessorLadderTuples(nextJson);
  if (JSON.stringify(next[tuple.profile]) !== JSON.stringify(tuple)
      || Object.keys(next).length !== Object.keys(current).length + 1) {
    refuse('the successor tuple table did not round-trip.');
  }
  for (const [k, v] of Object.entries(current)) {
    if (JSON.stringify(next[k]) !== JSON.stringify(v)) refuse(`the existing successor tuple ${JSON.stringify(k)} changed.`);
  }
  return source.replace(LITERAL, (_m, a: string, _b: string, c: string) => `${a}${nextJson}${c}`);
}

// ---------------------------------------------------------------------------
// Independent row derivation
// ---------------------------------------------------------------------------

/**
 * The witness row total derived from the witness manifest alone: one `ladder_<season>.csv` file per
 * season in `first..last`, no other file, no duplicate, each with a positive integer `row_count`. This is
 * independent of the tuple, the contract and the rebuild constant, which must all equal it.
 */
export function deriveLadderWitnessRows(
  manifestText: string, firstSeason: number, lastSeason: number, witnessLabel?: string,
): { files: number; rows: number } {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    refuse(`the ladder witness manifest is not valid JSON: ${String(error)}`);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    refuse('the ladder witness manifest must be a JSON object.');
  }
  const m = manifest as Json;
  if (witnessLabel !== undefined && m.snapshot_label !== witnessLabel) {
    refuse(`the ladder witness manifest is labelled ${JSON.stringify(m.snapshot_label)}, not ${JSON.stringify(witnessLabel)}.`);
  }
  if (!Array.isArray(m.files)) refuse('the ladder witness manifest has no files list.');
  const seen = new Map<number, number>();
  for (const [index, entry] of m.files.entries()) {
    const f = (typeof entry === 'object' && entry !== null ? entry : {}) as Json;
    const match = typeof f.filename === 'string' ? /^ladder_(\d{4})\.csv$/.exec(f.filename) : null;
    if (f.dataset !== 'ladder' || !match) refuse(`ladder witness manifest files[${index}] is not a ladder_<season>.csv ladder file.`);
    const year = Number(match[1]);
    if (year < firstSeason || year > lastSeason) {
      refuse(`ladder witness manifest files[${index}] is season ${year}, outside ${firstSeason}..${lastSeason}.`);
    }
    if (seen.has(year)) refuse(`ladder witness manifest lists season ${year} twice.`);
    if (typeof f.row_count !== 'number' || !Number.isSafeInteger(f.row_count) || f.row_count <= 0) {
      refuse(`ladder witness manifest files[${index}] has no positive integer row_count.`);
    }
    seen.set(year, f.row_count);
  }
  const expectedFiles = lastSeason - firstSeason + 1;
  if (seen.size !== expectedFiles) {
    refuse(`ladder witness manifest lists ${seen.size} season files, not the ${expectedFiles} of ${firstSeason}..${lastSeason}.`);
  }
  let rows = 0;
  for (const n of seen.values()) rows += n;
  return { files: seen.size, rows };
}

// ---------------------------------------------------------------------------
// Coherence of the whole transition
// ---------------------------------------------------------------------------

function sameList(value: unknown, expected: number[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((v, i) => v === expected[i]);
}

/**
 * A successor tuple holds only against its COMPLETE transition. Refuses a missing, rehearsal, equal,
 * non-adjacent or non-growing predecessor; a successor that reuses any predecessor fingerprint or label
 * (a crossed or stale tuple); a register that does not retain the exact retired predecessor entry; a
 * contract, `seasons.json` or witness binding that has not moved to the successor completed range with
 * the next season in progress; and a witness manifest whose independently derived row total differs.
 */
export function assertSuccessorTransition(input: {
  successor: SuccessorLadderTuple;
  predecessor: LadderTuple | undefined;
  register: Json;
  contract: Json;
  seasons: Json;
  /** Witness manifest text, when the caller can supply it. Required for the independent derivation. */
  witnessManifestText: string | undefined;
}): { derivedRows: number } {
  const { successor: s, predecessor: p, register, contract, seasons } = input;
  if (!p || p.profile !== s.supersedes) {
    refuse(`successor profile ${JSON.stringify(s.profile)} supersedes ${JSON.stringify(s.supersedes)}, which is not a reviewed predecessor tuple.`);
  }
  if (isRehearsalProfileName(p.profile)) refuse('a rehearsal profile is never a predecessor.');
  if (s.first_season !== p.first_season || s.last_season !== p.last_season + 1) {
    refuse(`successor range ${s.first_season}..${s.last_season} does not extend the predecessor's ${p.first_season}..${p.last_season} by exactly one completed season.`);
  }
  if (s.expected_rows <= p.expected_rows) {
    refuse(`successor expected_rows ${s.expected_rows} does not exceed the predecessor's ${p.expected_rows}.`);
  }
  for (const k of ['core_snapshot_label', 'core_manifest_sha256', 'core_artefact_set_sha256',
    'witness_snapshot_label', 'witness_manifest_sha256'] as const) {
    if (s[k] === p[k]) refuse(`successor tuple reuses the predecessor's ${k}: a crossed or stale tuple.`);
  }

  const baselines = Array.isArray(register.baselines) ? register.baselines as Json[] : [];
  const entries = baselines.filter((b) => b.snapshot_label === p.core_snapshot_label);
  const kept = entries[0];
  if (entries.length !== 1 || kept.acceptance_status !== 'retired'
      || (kept.acquisition as Json | undefined)?.manifest_sha256 !== p.core_manifest_sha256
      || (kept.raw_artefacts as Json | undefined)?.artefact_set_sha256 !== p.core_artefact_set_sha256) {
    refuse(`the register does not retain the predecessor ${JSON.stringify(p.core_snapshot_label)} exactly once, `
      + 'retired, with its reviewed manifest and artefact-set fingerprints: the transition is incomplete or stale.');
  }
  if (baselines.filter((b) => b.snapshot_label === s.core_snapshot_label).length !== 1) {
    refuse(`the register does not list the successor core ${JSON.stringify(s.core_snapshot_label)} exactly once.`);
  }

  const next = s.last_season + 1;
  if (seasons.last_season !== next || !sameList(seasons.in_progress_seasons, [next])) {
    refuse(`seasons.json must declare last_season ${next} with ${next} the only in-progress season, `
      + 'so the successor completed range is the completed range and nothing completed is still in progress.');
  }
  const excluded = ((contract.full_history as Json | undefined)?.current_season_excluded as Json | undefined)?.seasons;
  if (!sameList(excluded, [next])) {
    refuse(`the contract's current_season_excluded.seasons must be [${next}] for this successor.`);
  }
  const witness = (((contract.datasets as Json | undefined)?.ladder as Json | undefined)?.accepted_witness ?? {}) as Json;
  const seasonCount = s.last_season - s.first_season + 1;
  if (witness.files !== seasonCount || witness.rows !== s.expected_rows) {
    refuse(`the contract's accepted_witness records ${String(witness.files)} files / ${String(witness.rows)} rows, `
      + `not ${seasonCount} / ${s.expected_rows}.`);
  }

  if (input.witnessManifestText === undefined) {
    refuse('a successor profile needs the witness manifest bytes for the independent row derivation; none were supplied.');
  }
  const manifestSha = createHash('sha256').update(input.witnessManifestText.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  if (manifestSha !== s.witness_manifest_sha256) {
    refuse('the witness manifest bytes supplied for the row derivation are not the manifest the tuple pins.');
  }
  const derived = deriveLadderWitnessRows(input.witnessManifestText, s.first_season, s.last_season, s.witness_snapshot_label);
  if (derived.rows !== s.expected_rows) {
    refuse(`the witness manifest derives ${derived.rows} rows, not the tuple's ${s.expected_rows}.`);
  }
  return { derivedRows: derived.rows };
}
