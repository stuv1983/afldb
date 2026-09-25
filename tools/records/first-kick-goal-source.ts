/**
 * The first-kick-goal SOURCE contract: the curated extract, the tracked
 * identity manifest and (AFLDB-ISSUE-249) the tracked provenance that pins
 * both. Pure: files and strings only, no database and no server-only import,
 * so the importer, the rebuild PRECHECK, the promotion checker and the DB-free
 * tests all read the source through ONE implementation.
 *
 * The parsing and manifest rules below moved here verbatim from
 * tools/records/import-first-kick-goal.ts (AFLDB-ISSUE-078 / -084 / -167);
 * their semantics are unchanged.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(__dirname, '..', '..');

export const SOURCE_KEY = 'wikipedia_first_kick_goal';
export const ACHIEVEMENT_TYPE = 'first_kick_goal';

/** Repository-relative, forward slashes: the form the provenance records. */
export const FIRST_KICK_GOAL_EXTRACT = 'data/records/first-kick-goal.csv';
export const FIRST_KICK_GOAL_MANIFEST = 'data/records/first-kick-goal-ids.csv';
/** AFLDB-ISSUE-249: the tracked pin of the two files above. */
export const FIRST_KICK_GOAL_PROVENANCE = 'data/records/first-kick-goal.source.json';

export const EXTRACT_ENV = 'AFLDB_FIRST_KICK_GOAL_CSV';
export const MANIFEST_ENV = 'AFLDB_FIRST_KICK_GOAL_MANIFEST';

/**
 * The extract to read. `AFLDB_FIRST_KICK_GOAL_CSV` points --check (or a full
 * run) at a candidate extract without touching the curated file, which is
 * what makes a new scrape reviewable before it replaces anything.
 */
export function csvPath(env: Record<string, string | undefined> = process.env): string {
  return env[EXTRACT_ENV] || join(PROJECT_ROOT, FIRST_KICK_GOAL_EXTRACT);
}

/**
 * The tracked identity manifest. Unlike the extract this file is committed
 * to git (the `22-under-22.csv` opt-in pattern): the extract is replaceable
 * source material, the manifest is durable AFLDB source identity.
 */
export function manifestPath(env: Record<string, string | undefined> = process.env): string {
  return env[MANIFEST_ENV] || join(PROJECT_ROOT, FIRST_KICK_GOAL_MANIFEST);
}

// --- Stable identity manifest ------------------------------------------
//
// The extract has no identifier of any kind, and its clean names are not
// durable (mojibake, spelling corrections, changes to the marker stripping
// itself). Durable identity is therefore ASSIGNED, once, and remembered in
// data/records/first-kick-goal-ids.csv:
//
//   Id,Player,Club,Rd.,Year,Status
//   fkg-001,Fred Fanning,Melbourne,1,1940,active
//
// `Id` is opaque and sequential -- deliberately not row position, a content
// hash, the cleaned name, a player_id or a season/round/club tuple. `Player`
// is the join key to the extract's clean name; `Club`/`Rd.`/`Year` are
// curator context. Editing a descriptive column never changes `Id`.
// `Status=retired` reserves a number permanently: it still counts toward
// max-ever-issued and is never reissued.

export const MANIFEST_HEADER = 'Id,Player,Club,Rd.,Year,Status';
export const ID_PATTERN = /^fkg-(\d{3,})$/;

export type ManifestRow = {
  id: string;
  player: string;
  club: string;
  round: string;
  year: string;
  status: 'active' | 'retired';
};

export function parseManifest(path: string): ManifestRow[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `The identity manifest ${path} does not exist. Run --assign-ids to `
      + 'bootstrap it from the current extract.',
    );
  }
  return parseManifestText(text, path);
}

export function parseManifestText(text: string, path: string): ManifestRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines[0] ?? '').replace(/^﻿/, '');
  if (header !== MANIFEST_HEADER) {
    throw new Error(`Manifest ${path}: unexpected header.\n  expected: ${MANIFEST_HEADER}\n  actual:   ${header}`);
  }

  const rows: ManifestRow[] = [];
  const seenIds = new Set<string>();
  const seenActiveNames = new Set<string>();
  for (const [i, line] of lines.slice(1).entries()) {
    const fields = line.split(',');
    if (fields.length !== 6) {
      throw new Error(`Manifest ${path} line ${i + 2}: expected 6 fields, got ${fields.length}: ${line}`);
    }
    const [id, player, club, round, year, status] = fields.map((f) => f.trim());
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Manifest ${path} line ${i + 2}: malformed stable id ${JSON.stringify(id)}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Manifest ${path} line ${i + 2}: duplicate stable id ${id}`);
    }
    seenIds.add(id);
    if (status !== 'active' && status !== 'retired') {
      throw new Error(`Manifest ${path} line ${i + 2}: status must be active or retired, got ${JSON.stringify(status)}`);
    }
    if (status === 'active') {
      // The active player name is the join key to the extract, so it has to
      // be a key. Two active rows sharing a name cannot be told apart.
      if (seenActiveNames.has(player)) {
        throw new Error(`Manifest ${path} line ${i + 2}: duplicate active player name ${JSON.stringify(player)}`);
      }
      seenActiveNames.add(player);
    }
    rows.push({ id, player, club, round, year, status });
  }
  return rows;
}

/** The ids a complete load must hold: every ACTIVE manifest row, sorted. */
export function activeManifestIds(manifest: readonly ManifestRow[]): string[] {
  return manifest.filter((m) => m.status === 'active').map((m) => m.id).sort();
}

export function manifestLine(row: ManifestRow): string {
  return [row.id, row.player, row.club, row.round, row.year, row.status].join(',');
}

/** Highest number ever issued, active AND retired: retirement reserves. */
export function maxEverIssued(manifest: readonly ManifestRow[]): number {
  return manifest.reduce((max, row) => {
    const n = Number(ID_PATTERN.exec(row.id)![1]);
    return n > max ? n : max;
  }, 0);
}

export type ManifestJoin = {
  /** playerNameClean -> stable id, for every matched extract row. */
  idByName: Map<string, string>;
  unmatchedActive: ManifestRow[];
  unmatchedExtract: SourceRow[];
};

/**
 * Match every extract row to an ACTIVE manifest row by clean name.
 *
 * The extract carries no identifier, so an unmatched extract name can NEVER
 * be classified as new while an active manifest row is also unmatched: that
 * pair is far more likely to be one spelling correction, and allocating a
 * new id for it would be exactly the rename -> new-identity failure this
 * manifest exists to prevent. Callers abort on any unmatched active row.
 */
export function joinManifest(rows: readonly SourceRow[], manifest: readonly ManifestRow[]): ManifestJoin {
  const active = new Map(manifest.filter((m) => m.status === 'active').map((m) => [m.player, m]));
  const idByName = new Map<string, string>();
  const matchedIds = new Set<string>();
  const unmatchedExtract: SourceRow[] = [];
  for (const row of rows) {
    const entry = active.get(row.playerNameClean);
    if (entry) {
      idByName.set(row.playerNameClean, entry.id);
      matchedIds.add(entry.id);
    } else {
      unmatchedExtract.push(row);
    }
  }
  const unmatchedActive = manifest.filter(
    (m) => m.status === 'active' && !matchedIds.has(m.id),
  );
  return { idByName, unmatchedActive, unmatchedExtract };
}

export function describeJoinFailure(joined: ManifestJoin): string {
  const parts: string[] = [];
  if (joined.unmatchedActive.length > 0) {
    parts.push(
      `${joined.unmatchedActive.length} ACTIVE manifest row(s) match no extract row:`,
      ...joined.unmatchedActive.map((m) => `    ${m.id} ${JSON.stringify(m.player)} (${m.club}, ${m.year})`),
    );
  }
  if (joined.unmatchedExtract.length > 0) {
    parts.push(
      `${joined.unmatchedExtract.length} extract row(s) match no active manifest row:`,
      ...joined.unmatchedExtract.map((r) => `    line ${r.lineNo}: ${JSON.stringify(r.playerNameClean)} (${r.clubNameRaw}, ${r.season})`),
    );
  }
  parts.push(
    'A curator must classify each: a rename/correction keeps its fkg id (edit',
    'the manifest Player), a genuine removal sets Status=retired, and only when',
    'every active manifest row is accounted for may --assign-ids allocate new',
    'ids for genuinely additional rows. Nothing was changed.',
  );
  return parts.join('\n');
}

// --- Parsing -----------------------------------------------------------

/**
 * The source's legend:
 *   (n)  goals scored with each of the first n kicks
 *   *    no further goals in the player's career
 *   †    no further kicks in the player's career
 *   #    no kick recorded in the first match
 *   ##   no kick recorded in the first two matches
 *
 * The dagger reaches us mojibake'd: the extract was decoded as Latin-1
 * somewhere upstream, and the byte loss is not cleanly reversible (a
 * latin1->utf8 round trip yields replacement characters, not "†"). It is
 * matched here by the corrupted form rather than repaired, since guessing
 * at bytes that are actually gone would be inventing data. Only the marker
 * glyph is affected; the names beside it are intact ASCII.
 */
export const DAGGER_MOJIBAKE = 'â';

export type Markers = {
  consecutiveGoalKicks: number;
  noFurtherCareerGoals: boolean;
  noFurtherCareerKicks: boolean;
  kicklessMatchesBeforeFirstKick: number;
};

function isMarkerToken(token: string): boolean {
  return /^\(\d+\)$/.test(token)
    || /^\*+$/.test(token)
    || /^#+$/.test(token)
    || token === DAGGER_MOJIBAKE;
}

/**
 * Markers combine ("Fabian Deluca ## *", "Samson Ryan # (3)"), so trailing
 * marker tokens are popped repeatedly rather than matched as one suffix.
 * A token that trails the name but matches no known marker is an error,
 * not something to drop: an unrecognised marker means the source grew a
 * legend entry this importer does not understand yet.
 */
export function splitPlayerName(raw: string): { clean: string; annotation: string | null; markers: Markers } {
  const tokens = raw.trim().split(/\s+/);
  const markerTokens: string[] = [];
  while (tokens.length > 1 && isMarkerToken(tokens[tokens.length - 1])) {
    markerTokens.unshift(tokens.pop()!);
  }

  const markers: Markers = {
    consecutiveGoalKicks: 1,
    noFurtherCareerGoals: false,
    noFurtherCareerKicks: false,
    kicklessMatchesBeforeFirstKick: 0,
  };
  for (const token of markerTokens) {
    if (/^\(\d+\)$/.test(token)) markers.consecutiveGoalKicks = Number(token.slice(1, -1));
    else if (/^\*+$/.test(token)) markers.noFurtherCareerGoals = true;
    else if (token === DAGGER_MOJIBAKE) markers.noFurtherCareerKicks = true;
    else if (/^#+$/.test(token)) markers.kicklessMatchesBeforeFirstKick = token.length;
  }

  return {
    clean: tokens.join(' '),
    annotation: markerTokens.length > 0 ? markerTokens.join(' ') : null,
    markers,
  };
}

export type SourceRow = {
  lineNo: number;
  playerNameRaw: string;
  playerNameClean: string;
  sourceAnnotation: string | null;
  markers: Markers;
  clubNameRaw: string;
  roundRaw: string;
  season: number;
  seasonFootnoteRaw: string | null;
  sourceRecordId: string;
};

export function parseCsv(text: string): SourceRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines[0] ?? '').replace(/^﻿/, '');
  const expected = 'Player,Club,Rd.,Year';
  if (header !== expected) {
    throw new Error(`Unexpected header.\n  expected: ${expected}\n  actual:   ${header}`);
  }

  return lines.slice(1).map((line, i) => {
    const lineNo = i + 2;
    const fields = line.split(',');
    if (fields.length !== 4) {
      throw new Error(`Line ${lineNo}: expected 4 fields, got ${fields.length}: ${line}`);
    }
    const [playerRaw, clubRaw, roundRaw, yearRaw] = fields;

    // Wikipedia citation markers are glued to the year with no separator
    // ("2014[8]"). They say nothing about the player and are split off.
    const yearMatch = yearRaw.trim().match(/^(\d{4})(\[[^\]]*\])?$/);
    if (!yearMatch) throw new Error(`Line ${lineNo}: unparseable year ${JSON.stringify(yearRaw)}`);

    const { clean, annotation, markers } = splitPlayerName(playerRaw);
    if (!clean) throw new Error(`Line ${lineNo}: no name left after stripping markers: ${playerRaw}`);

    return {
      lineNo,
      playerNameRaw: playerRaw.trim(),
      playerNameClean: clean,
      sourceAnnotation: annotation,
      markers,
      clubNameRaw: clubRaw.trim(),
      roundRaw: roundRaw.trim(),
      season: Number(yearMatch[1]),
      seasonFootnoteRaw: yearMatch[2] ?? null,
      sourceRecordId: `${yearMatch[1]}|${roundRaw.trim()}|${playerRaw.trim()}`,
    };
  });
}

// --- AFLDB-ISSUE-249: the pinned source ----------------------------------
//
// A rebuild reconstructs the family from these two files, so it must read
// exactly the bytes that were accepted -- not whichever extract happens to be
// on disk. The extract is gitignored and hand-curated (ISSUE-084 §9.2), so its
// LOCATION is the operator's (`AFLDB_FIRST_KICK_GOAL_CSV` may point at a copy
// outside the checkout) but its BYTES are pinned here. The manifest is pinned
// too: a new id is a new source decision and must be re-pinned deliberately.

export class FirstKickGoalSourceRefused extends Error {}

export type FirstKickGoalProvenance = {
  extract: string;
  extractSha256: string;
  extractRows: number;
  manifest: string;
  manifestSha256: string;
  manifestActive: number;
};

/**
 * SHA-256 of a file's CANONICAL bytes: CRLF folded to LF at the byte level,
 * nothing else touched. A worktree with autocrlf=true, or an extract copied
 * through Windows, hashes the same as the Linux checkout; mojibake bytes are
 * hashed as they are, never re-decoded.
 */
export function canonicalSha256(bytes: Buffer): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out.push(bytes[i]);
  }
  return createHash('sha256').update(Buffer.from(out)).digest('hex');
}

const SHA256_RE = /^[0-9a-f]{64}$/;

export function parseProvenance(text: string, path: string): FirstKickGoalProvenance {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new FirstKickGoalSourceRefused(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const str = (key: string): string => {
    const v = raw[key];
    if (typeof v !== 'string' || v.length === 0) {
      throw new FirstKickGoalSourceRefused(`${path}: "${key}" must be a non-empty string.`);
    }
    return v;
  };
  const count = (key: string): number => {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new FirstKickGoalSourceRefused(`${path}: "${key}" must be a positive integer.`);
    }
    return v;
  };
  const sha = (key: string): string => {
    const v = str(key);
    if (!SHA256_RE.test(v)) throw new FirstKickGoalSourceRefused(`${path}: "${key}" is not a lowercase sha256.`);
    return v;
  };
  return {
    extract: str('extract'),
    extractSha256: sha('extract_sha256'),
    extractRows: count('extract_rows'),
    manifest: str('manifest'),
    manifestSha256: sha('manifest_sha256'),
    manifestActive: count('manifest_active'),
  };
}

export type PinnedSource = {
  provenance: FirstKickGoalProvenance;
  extractPath: string;
  manifestPath: string;
  rows: SourceRow[];
  manifest: ManifestRow[];
  joined: ManifestJoin;
  /** The ids a complete load must hold. */
  expectedIds: string[];
};

export type PinnedSourceIo = {
  env?: Record<string, string | undefined>;
  root?: string;
  exists?: (path: string) => boolean;
  read?: (path: string) => Buffer;
};

function resolveFrom(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

/**
 * Load the first-kick-goal source exactly as pinned, or refuse.
 *
 * Every refusal happens here, before any database is contacted: a missing or
 * malformed provenance, a missing extract or manifest, bytes that no longer
 * hash to their pin, a row count or active count that moved, and a manifest
 * join that is not exact. The environment may relocate either file (the
 * extract is gitignored and often lives outside the checkout); it can never
 * change which bytes are accepted.
 */
export function loadPinnedSource(provenancePath: string, io: PinnedSourceIo = {}): PinnedSource {
  const env = io.env ?? process.env;
  const root = io.root ?? PROJECT_ROOT;
  const exists = io.exists ?? existsSync;
  const read = io.read ?? ((p: string) => readFileSync(p));

  const provFile = resolveFrom(root, provenancePath);
  if (!exists(provFile)) {
    throw new FirstKickGoalSourceRefused(
      `The first-kick-goal provenance ${provenancePath} is not in this checkout; nothing is pinned, `
      + 'so nothing will be loaded.');
  }
  const provenance = parseProvenance(read(provFile).toString('utf8'), provenancePath);

  const extractPath = env[EXTRACT_ENV] || resolveFrom(root, provenance.extract);
  const manifestFile = env[MANIFEST_ENV] || resolveFrom(root, provenance.manifest);

  if (!exists(extractPath)) {
    throw new FirstKickGoalSourceRefused(
      `The curated first-kick-goal extract is missing: ${extractPath}. It is gitignored, so a `
      + `checkout does not carry it: copy the accepted file to ${provenance.extract} or point `
      + `${EXTRACT_ENV} at it. Nothing was loaded.`);
  }
  if (!exists(manifestFile)) {
    throw new FirstKickGoalSourceRefused(
      `The first-kick-goal identity manifest is missing: ${manifestFile}. Nothing was loaded.`);
  }

  const extractBytes = read(extractPath);
  const extractSha = canonicalSha256(extractBytes);
  if (extractSha !== provenance.extractSha256) {
    throw new FirstKickGoalSourceRefused(
      `${extractPath} hashes to ${extractSha}, but ${provenancePath} pins `
      + `${provenance.extractSha256}. A different extract is a new source decision: review it with `
      + `${EXTRACT_ENV} and --check, then re-pin deliberately. Nothing was loaded.`);
  }
  const manifestBytes = read(manifestFile);
  const manifestSha = canonicalSha256(manifestBytes);
  if (manifestSha !== provenance.manifestSha256) {
    throw new FirstKickGoalSourceRefused(
      `${manifestFile} hashes to ${manifestSha}, but ${provenancePath} pins `
      + `${provenance.manifestSha256}. A manifest change (new, retired or renamed ids) must be `
      + 're-pinned deliberately. Nothing was loaded.');
  }

  let rows: SourceRow[];
  let manifest: ManifestRow[];
  try {
    rows = parseCsv(extractBytes.toString('utf8'));
    manifest = parseManifestText(manifestBytes.toString('utf8'), manifestFile);
  } catch (error) {
    throw new FirstKickGoalSourceRefused(`${(error as Error).message}\nNothing was loaded.`);
  }
  if (rows.length !== provenance.extractRows) {
    throw new FirstKickGoalSourceRefused(
      `${extractPath} parses to ${rows.length} rows, but ${provenancePath} pins `
      + `${provenance.extractRows}. Nothing was loaded.`);
  }
  const expectedIds = activeManifestIds(manifest);
  if (expectedIds.length !== provenance.manifestActive) {
    throw new FirstKickGoalSourceRefused(
      `${manifestFile} carries ${expectedIds.length} active ids, but ${provenancePath} pins `
      + `${provenance.manifestActive}. Nothing was loaded.`);
  }
  const joined = joinManifest(rows, manifest);
  if (joined.unmatchedActive.length > 0 || joined.unmatchedExtract.length > 0) {
    throw new FirstKickGoalSourceRefused(describeJoinFailure(joined));
  }
  return { provenance, extractPath, manifestPath: manifestFile, rows, manifest, joined, expectedIds };
}

/**
 * The ids the TRACKED manifest says a complete database holds -- what the
 * rebuild's FINAL VALIDATION and the promotion checker expect. Needs only the
 * committed manifest, never the gitignored extract, so it works on any host
 * that has the checkout.
 */
export function trackedExpectedIds(path: string = join(PROJECT_ROOT, FIRST_KICK_GOAL_MANIFEST)): string[] {
  if (!existsSync(path)) {
    throw new FirstKickGoalSourceRefused(`The tracked first-kick-goal manifest ${path} is not in this checkout.`);
  }
  return activeManifestIds(parseManifest(path));
}
