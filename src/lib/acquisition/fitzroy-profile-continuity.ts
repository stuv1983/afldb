/**
 * AFLDB-ISSUE-237 (continuity amendment, 2026-09-25) — the tracked AFL Tables
 * `profile_url_continuity` rules (AFLDB-ISSUE-136), read from the SAME contract
 * `tools/migration/import_fitzroy_core.py` folds renumbered profiles with:
 * `tools/rebuild/fitzroy/fitzroy-contract.json`.
 *
 * Neutral by construction: no database, no `server-only`, no query module. It imports
 * only `node:fs`/`node:path`/`node:url`, so the plain-`tsx` rebuild and recovery tools and the
 * promotion checker can all load it (the `afl-api-fixture-ownership.ts` lesson: plain tsx is
 * not the react-server condition).
 *
 * FAIL CLOSED. `parseFitzroyProfileContinuityRules` applies every shape check
 * `load_profile_continuity_rules()` (import_fitzroy_core.py) applies before the importer will
 * fold anything — unique ids, `player_stats` dataset and file, two DISTINCT normalised
 * profile paths, unique renumbered paths, a complete typed `expect` block whose facts are
 * internally consistent, non-empty authority/reason, and no chain (a continuing path that is
 * another rule's renumbered path). One malformed rule refuses the whole contract: a rule the
 * importer would refuse can never be used here to collapse two identities into one.
 *
 * Only the two paths and the id survive parsing. The evidence the importer re-measures from
 * the snapshot (`expect`) is validated for shape, never re-measured here — the importer is the
 * sole place a rule is bound to source rows; this module only states WHICH two paths one
 * reviewed rule declares to be the same footballer.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The tracked fitzRoy contract, resolved from this file (src/lib/acquisition), never cwd. */
export const FITZROY_CONTRACT_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json',
);

/** import_fitzroy_core.py `PROFILE_PATH_SHAPE` — exactly the form external_identities stores. */
const PROFILE_PATH_SHAPE = /^players\/[A-Z]\/[^/]+\.html$/;
/** import_fitzroy_core.py `PLAYER_STATS_FILE`. */
const PLAYER_STATS_FILE = /^player_stats_(\d{4})\.csv$/;
/** import_fitzroy_core.py `CONTINUITY_EXPECT_KEYS`; every key after the first is a non-negative int. */
const CONTINUITY_EXPECT_KEYS = [
  'continuing_id', 'continuing_last_season', 'continuing_last_career_game',
  'renumbered_first_season', 'renumbered_last_season',
  'renumbered_first_career_game', 'renumbered_rows',
] as const;

export type FitzroyProfileContinuityRule = {
  readonly id: string;
  /** The ID-bearing profile the cached fitzRoy seasons use — the one the importer folds INTO. */
  readonly continuingUrl: string;
  /** The live, renumbered profile the importer folds into the continuing player. */
  readonly renumberedUrl: string;
};

declare const VALIDATED: unique symbol;
/**
 * A rule list that has passed `parseFitzroyProfileContinuityRules`. Branded so the stable
 * identity classifier cannot be handed a hand-built list that skipped validation.
 */
export type ValidatedFitzroyProfileContinuityRules =
  readonly FitzroyProfileContinuityRule[] & { readonly [VALIDATED]: true };

/** Raised for an unreadable or malformed continuity contract. Never caught by the classifier. */
export class FitzroyProfileContinuityContractError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validates the parsed contract's `profile_url_continuity.rules[]` exactly as the fitzRoy
 * importer does, and returns the id + two paths of each rule. A contract with no
 * `profile_url_continuity` section yields no rules (the importer's own behaviour); every
 * multi-path player then stays ambiguous, which is the refusing direction.
 */
export function parseFitzroyProfileContinuityRules(
  contract: unknown, label = 'fitzroy-contract.json',
): ValidatedFitzroyProfileContinuityRules {
  if (!isRecord(contract)) {
    throw new FitzroyProfileContinuityContractError(`${label}: the contract is not a JSON object.`);
  }
  const section = contract.profile_url_continuity;
  if (section === undefined || section === null) return [] as unknown as ValidatedFitzroyProfileContinuityRules;
  if (!isRecord(section)) {
    throw new FitzroyProfileContinuityContractError(`${label}: profile_url_continuity is not an object.`);
  }
  const rawRules = section.rules ?? [];
  if (!Array.isArray(rawRules)) {
    throw new FitzroyProfileContinuityContractError(`${label}: profile_url_continuity.rules is not an array.`);
  }

  const refuse = (rule: unknown, detail: string) => new FitzroyProfileContinuityContractError(
    `${label}: profile_url_continuity rule ${JSON.stringify(isRecord(rule) ? rule.id ?? null : null)} `
    + `is malformed: ${detail}`);

  const seenIds = new Set<string>();
  const renumbered = new Set<string>();
  const rules: FitzroyProfileContinuityRule[] = [];
  for (const rule of rawRules) {
    if (!isRecord(rule)) throw refuse(rule, 'a rule must be an object');
    const id = rule.id;
    if (typeof id !== 'string' || id === '' || seenIds.has(id)) throw refuse(rule, 'id must be a unique non-empty string');
    seenIds.add(id);
    if (rule.dataset !== 'player_stats') throw refuse(rule, "dataset must be 'player_stats'");
    const fileMatch = PLAYER_STATS_FILE.exec(typeof rule.file === 'string' ? rule.file : '');
    if (!fileMatch) {
      throw refuse(rule, "file must name the renumbered profile's player_stats artefact (player_stats_<season>.csv)");
    }
    const cont = rule.continuing_url;
    const renum = rule.renumbered_url;
    for (const [key, path] of [['continuing_url', cont], ['renumbered_url', renum]] as const) {
      if (typeof path !== 'string' || !PROFILE_PATH_SHAPE.test(path)) {
        throw refuse(rule, `${key} must be a normalised profile path (players/A/Name.html), got ${JSON.stringify(path ?? null)}`);
      }
    }
    if (cont === renum) throw refuse(rule, 'continuing_url and renumbered_url are the same path');
    if (renumbered.has(renum as string)) throw refuse(rule, `renumbered_url ${JSON.stringify(renum)} is named by more than one rule`);
    renumbered.add(renum as string);

    const expect = rule.expect;
    if (!isRecord(expect)) throw refuse(rule, 'expect must be an object');
    const missing = CONTINUITY_EXPECT_KEYS.filter((k) => !(k in expect));
    if (missing.length > 0) throw refuse(rule, `expect lacks ${missing.join(', ')}`);
    if (typeof expect.continuing_id !== 'string' || expect.continuing_id.trim() === '') {
      throw refuse(rule, 'expect.continuing_id must be the non-empty fitzRoy ID string');
    }
    for (const key of CONTINUITY_EXPECT_KEYS.slice(1)) {
      if (!isNonNegativeInt(expect[key])) throw refuse(rule, `expect.${key} must be a non-negative integer`);
    }
    const e = expect as Record<(typeof CONTINUITY_EXPECT_KEYS)[number], number>;
    if (e.renumbered_last_season < e.renumbered_first_season) {
      throw refuse(rule, 'expect.renumbered_last_season precedes renumbered_first_season');
    }
    if (Number(fileMatch[1]) !== e.renumbered_first_season) {
      throw refuse(rule, 'file must be the artefact of expect.renumbered_first_season');
    }
    if (e.continuing_last_season >= e.renumbered_first_season) {
      throw refuse(rule, 'expect.continuing_last_season must precede renumbered_first_season: the two profiles may never overlap');
    }
    if (e.renumbered_first_career_game !== e.continuing_last_career_game + 1) {
      throw refuse(rule, 'expect.renumbered_first_career_game must be exactly continuing_last_career_game + 1');
    }
    if (e.renumbered_rows < 1) throw refuse(rule, 'expect.renumbered_rows must be at least 1');
    for (const key of ['authority', 'reason'] as const) {
      if (typeof rule[key] !== 'string' || (rule[key] as string).trim() === '') {
        throw refuse(rule, `${key} must be a non-empty string`);
      }
    }
    rules.push({ id, continuingUrl: cont as string, renumberedUrl: renum as string });
  }
  for (const rule of rules) {
    if (renumbered.has(rule.continuingUrl)) {
      throw refuse({ id: rule.id }, `continuing_url ${JSON.stringify(rule.continuingUrl)} is another `
        + "rule's renumbered_url; chains are not inferred");
    }
  }
  return Object.freeze(rules) as unknown as ValidatedFitzroyProfileContinuityRules;
}

/** Reads and validates the tracked contract. An unreadable file or invalid JSON refuses. */
export function loadFitzroyProfileContinuityRules(
  path: string = FITZROY_CONTRACT_PATH,
): ValidatedFitzroyProfileContinuityRules {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new FitzroyProfileContinuityContractError(
      `The fitzRoy continuity contract could not be read (${path}): ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new FitzroyProfileContinuityContractError(
      `The fitzRoy continuity contract is not valid JSON (${path}): ${(error as Error).message}`);
  }
  return parseFitzroyProfileContinuityRules(parsed, path);
}
