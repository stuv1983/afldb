/**
 * Import the curated "goal with first VFL/AFL kick" list into
 * player_achievements.
 *
 *   npm run records:first-kick-goal -- --check    parse and decode only, no DB
 *   npm run records:first-kick-goal               resolve against the DB, report, write nothing
 *   npm run records:first-kick-goal -- --apply    resolve and write, in one transaction
 *
 * --check needs no database at all, so the parsing and legend decoding can
 * be validated anywhere; the workstation has no Postgres.
 * AFLDB_FIRST_KICK_GOAL_CSV points either mode at a candidate extract
 * without disturbing the curated file.
 *
 * Reloads are keyed, not destructive (AFLDB-ISSUE-078)
 * ----------------------------------------------------
 * This used to DELETE every `first_kick_goal` row and re-insert. That threw
 * away the surrogate ids, which are durable application identity:
 * `player_achievements` is a LINK_TARGET_TABLE, so
 * `player_link_resolutions.target_id` points at them. A reload therefore
 * discarded any manual link an admin had recorded in /admin/player-links and
 * left the audit row naming an id that no longer existed. It also deleted
 * every `first_kick_goal` row regardless of who owned it.
 *
 * Identity is assigned, not derived (the tracked manifest)
 * --------------------------------------------------------
 * The extract is a hand-curated, gitignored Wikipedia table with no
 * identifier of any kind, and its clean names are not durable: mojibake,
 * spelling corrections and marker changes all move them. Durable identity is
 * therefore assigned once per logical record in the TRACKED manifest
 * data/records/first-kick-goal-ids.csv (`fkg-NNN`), stored as
 * `source_record_id`, and enforced by player_achievements_source_uq.
 *
 *   --assign-ids            bootstrap the manifest, or allocate ids for
 *                           genuinely new extract rows (never regenerate)
 *   --rekey                 one-time database transition from the legacy
 *                           source_record_id format, in place, retry-safe
 *   --accept-rename fkg-N   acknowledge a rename of a DECIDED record
 *   --accept-retirement fkg-N   confirm deleting a retired record that
 *                           still carries durable references
 *
 * Rows are reconciled by `(source_id, source_record_id)`, scoped to the rows
 * this importer owns (`achievement_type = 'first_kick_goal'` AND its own
 * `source_id`). Matched ids are updated in place, so surrogate ids survive
 * any descriptive correction -- including a renamed player; new ids are
 * inserted; retired ids are deleted, after the same preflight as everything
 * else. Human decisions are read and classified before the first write and
 * re-applied afterwards; one that cannot be carried aborts the whole
 * transaction unless --allow-link-loss is given.
 *
 * The claim itself -- that a player's first kick was a goal -- cannot be
 * recomputed from AFLDB data: there is no play-by-play table, only
 * whole-match totals. What CAN be checked is everything around it, and this
 * script checks all of it rather than trusting the source: that the player
 * and club resolve, that the achievement's match is where the source says,
 * and that the two legend markers phrased in terms of career totals ("no
 * further goals", "no further kicks") agree with player_career_stats.
 * Disagreements become data_issues rows, never silent corrections.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { resolveClub, resolvePlayer } from '../../src/lib/ingest/datasets';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const SOURCE_KEY = 'wikipedia_first_kick_goal';
const ACHIEVEMENT_TYPE = 'first_kick_goal';

/**
 * The extract to read. `AFLDB_FIRST_KICK_GOAL_CSV` points --check (or a full
 * run) at a candidate extract without touching the curated file, which is
 * what makes a new scrape reviewable before it replaces anything.
 */
function csvPath(): string {
  return process.env.AFLDB_FIRST_KICK_GOAL_CSV
    || join(PROJECT_ROOT, 'data', 'records', 'first-kick-goal.csv');
}

/**
 * The tracked identity manifest. Unlike the extract this file is committed
 * to git (the `22-under-22.csv` opt-in pattern): the extract is replaceable
 * source material, the manifest is durable AFLDB source identity.
 */
function manifestPath(): string {
  return process.env.AFLDB_FIRST_KICK_GOAL_MANIFEST
    || join(PROJECT_ROOT, 'data', 'records', 'first-kick-goal-ids.csv');
}

/**
 * A reload that would lose a human identity decision, or that cannot be
 * keyed at all. Raised before anything in the owned scope is written, so the
 * surrounding transaction rolls back untouched (AFLDB-ISSUE-078).
 */
class ReloadAbort extends Error {}

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

const MANIFEST_HEADER = 'Id,Player,Club,Rd.,Year,Status';
const ID_PATTERN = /^fkg-(\d{3,})$/;

type ManifestRow = {
  id: string;
  player: string;
  club: string;
  round: string;
  year: string;
  status: 'active' | 'retired';
};

function parseManifest(path: string): ManifestRow[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `The identity manifest ${path} does not exist. Run --assign-ids to `
      + 'bootstrap it from the current extract.',
    );
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].replace(/^﻿/, '');
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

function manifestLine(row: ManifestRow): string {
  return [row.id, row.player, row.club, row.round, row.year, row.status].join(',');
}

/** Highest number ever issued, active AND retired: retirement reserves. */
function maxEverIssued(manifest: ManifestRow[]): number {
  return manifest.reduce((max, row) => {
    const n = Number(ID_PATTERN.exec(row.id)![1]);
    return n > max ? n : max;
  }, 0);
}

type ManifestJoin = {
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
function joinManifest(rows: SourceRow[], manifest: ManifestRow[]): ManifestJoin {
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

function describeJoinFailure(joined: ManifestJoin): string {
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

/**
 * --assign-ids: bootstrap the manifest, or allocate ids for genuinely new
 * extract rows. Never a "regenerate ids" command: existing allocations are
 * never rewritten and retired numbers are never reused.
 */
function runAssignIds(rows: SourceRow[], path: string): number {
  const names = new Set<string>();
  for (const row of rows) {
    if (names.has(row.playerNameClean)) {
      console.error(`The extract carries ${JSON.stringify(row.playerNameClean)} twice; no ids can be assigned.`);
      return 1;
    }
    names.add(row.playerNameClean);
  }

  if (!existsSync(path)) {
    // One-time bootstrap: no prior identity exists, so file order is merely
    // the assignment order, not something the ids will ever depend on again.
    const width = Math.max(3, String(rows.length).length);
    const lines = rows.map((row, i) => manifestLine({
      id: `fkg-${String(i + 1).padStart(width, '0')}`,
      player: row.playerNameClean,
      club: row.clubNameRaw,
      round: row.roundRaw,
      year: String(row.season),
      status: 'active',
    }));
    writeFileSync(path, [MANIFEST_HEADER, ...lines].join('\n') + '\n', 'utf8');
    console.log(`Bootstrapped ${path}: ${rows.length} stable ids assigned (fkg-001 ... fkg-${String(rows.length).padStart(width, '0')}).`);
    return 0;
  }

  const manifest = parseManifest(path);
  const joined = joinManifest(rows, manifest);
  if (joined.unmatchedActive.length > 0) {
    console.error(describeJoinFailure(joined));
    return 1;
  }
  if (joined.unmatchedExtract.length === 0) {
    console.log(`${path}: every extract row already has a stable id; nothing to assign.`);
    return 0;
  }

  const width = Math.max(3, String(maxEverIssued(manifest)).length);
  let next = maxEverIssued(manifest);
  const added = joined.unmatchedExtract.map((row) => {
    next += 1;
    return manifestLine({
      id: `fkg-${String(next).padStart(width, '0')}`,
      player: row.playerNameClean,
      club: row.clubNameRaw,
      round: row.roundRaw,
      year: String(row.season),
      status: 'active',
    });
  });
  const existing = readFileSync(path, 'utf8').replace(/\n+$/, '');
  writeFileSync(path, existing + '\n' + added.join('\n') + '\n', 'utf8');
  console.log(`Assigned ${added.length} new stable id(s) above fkg-${String(maxEverIssued(manifest) - added.length).padStart(width, '0')}:`);
  for (const line of added) console.log(`  ${line}`);
  return 0;
}

/**
 * --rekey: the one-time database transition from the old
 * "{season}|{round}|{rawname}" source_record_id format to the manifest's
 * stable ids, bridged by the CURRENT clean names. It must therefore run
 * before the extract is corrected or replaced — a changed source fails the
 * bridge closed rather than being mapped approximately.
 *
 * Retry-safe by state:
 *   all owned rows old-format   -> exact 1:1 rekey in place
 *   all owned rows valid fkg-NNN -> verify the mapping, report, no-op
 *   a mixture                    -> abort before mutation
 */
async function runRekey(manifest: ManifestRow[]): Promise<number> {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  const sql = postgres(dsn, { max: 1, onnotice: () => {} });
  try {
    const [source] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = ${SOURCE_KEY}`;
    if (!source) throw new Error(`Source ${SOURCE_KEY} is missing; run migration 053 first.`);

    const owned = await sql<{ id: number; key: string | null; name: string }[]>`
      SELECT id, source_record_id AS key, player_name_clean AS name
        FROM player_achievements
       WHERE achievement_type = ${ACHIEVEMENT_TYPE} AND source_id = ${source.id}
       ORDER BY id
    `;
    const stable = owned.filter((row) => row.key !== null && ID_PATTERN.test(row.key));
    const legacy = owned.filter((row) => row.key === null || !ID_PATTERN.test(row.key));

    const active = manifest.filter((m) => m.status === 'active');
    const manifestIds = new Set(manifest.map((m) => m.id));

    if (owned.length > 0 && legacy.length === 0) {
      // Already transitioned. Verify rather than trust: every stored id must
      // exist in the manifest exactly once (parseManifest enforced manifest
      // uniqueness; the database constraint enforces stored uniqueness).
      const unknown = stable.filter((row) => !manifestIds.has(row.key!));
      if (unknown.length > 0) {
        console.error(`${unknown.length} stored row(s) carry a stable id the manifest does not know:`);
        for (const row of unknown) console.error(`  id=${row.id} ${row.key} ${JSON.stringify(row.name)}`);
        return 1;
      }
      console.log(`Already rekeyed: ${stable.length} owned row(s) carry valid manifest ids. Nothing to do.`);
      return 0;
    }
    if (stable.length > 0 && legacy.length > 0) {
      console.error(
        `Mixed identity state: ${stable.length} row(s) already carry fkg ids and `
        + `${legacy.length} do not. This needs manual review; nothing was written.`,
      );
      return 1;
    }

    // All-legacy (or empty): bridge by clean name, exactly 1:1 or nothing.
    const idByName = new Map(active.map((m) => [m.player, m.id]));
    const mappings: { rowId: number; stableId: string }[] = [];
    const unmatchedDb: { id: number; key: string | null; name: string }[] = [];
    const usedIds = new Set<string>();
    const ambiguous: string[] = [];
    for (const row of legacy) {
      const stableId = idByName.get(row.name);
      if (!stableId) {
        unmatchedDb.push(row);
      } else if (usedIds.has(stableId)) {
        ambiguous.push(`${stableId} matches more than one database row`);
      } else {
        usedIds.add(stableId);
        mappings.push({ rowId: row.id, stableId });
      }
    }
    const unmatchedManifest = active.filter((m) => !usedIds.has(m.id));

    console.log('Rekey preflight:');
    console.log(`  active manifest rows        ${active.length}`);
    console.log(`  owned database rows         ${owned.length}`);
    console.log(`  exact 1:1 mappings          ${mappings.length}`);
    console.log(`  unmatched manifest rows     ${unmatchedManifest.length}`);
    console.log(`  unmatched database rows     ${unmatchedDb.length}`);
    console.log(`  duplicate/ambiguous         ${ambiguous.length}`);

    if (unmatchedManifest.length > 0 || unmatchedDb.length > 0 || ambiguous.length > 0
        || mappings.length !== owned.length || mappings.length !== active.length) {
      for (const m of unmatchedManifest) console.error(`  manifest unmatched: ${m.id} ${JSON.stringify(m.player)}`);
      for (const row of unmatchedDb) console.error(`  database unmatched: id=${row.id} ${JSON.stringify(row.name)}`);
      for (const message of ambiguous) console.error(`  ambiguous: ${message}`);
      console.error('The mapping is not exactly 1:1; nothing was written.');
      return 1;
    }

    await sql.begin(async (tx) => {
      for (const { rowId, stableId } of mappings) {
        await tx`
          UPDATE player_achievements SET source_record_id = ${stableId} WHERE id = ${rowId}
        `;
      }
    });
    console.log(`Rekeyed ${mappings.length} row(s) in place; every surrogate id is unchanged.`);
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Repeatable flag values; duplicates are an argument error, not a merge. */
function collectRepeatable(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a stable id argument.`);
      if (values.includes(value)) throw new Error(`${flag} ${value} was given more than once.`);
      values.push(value);
      i += 1;
    }
  }
  return values;
}

function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
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
const DAGGER_MOJIBAKE = 'â';

type Markers = {
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
function splitPlayerName(raw: string): { clean: string; annotation: string | null; markers: Markers } {
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

type SourceRow = {
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

function parseCsv(text: string): SourceRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].replace(/^﻿/, '');
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

/**
 * Rows whose source text is corrupted beyond automatic matching. Each entry
 * is a human decision recorded in git, not a fuzzy guess made at runtime --
 * the key is the marker-stripped CLEAN name (playerNameClean: "Billy
 * Picken", not "Billy Picken (2)"), so a corrected upstream file simply
 * stops matching here and resolves normally.
 */
const MANUAL_NAME_OVERRIDES: Record<string, string> = {
  // Encoding corruption: Setanta Ó hAilpín, Carlton, debuted 2005.
  // AFLDB stores the surname unspaced.
  'Setanta Ã hAilpÃ­n': 'Setanta OhAilpin',

  // Name-form variants. Each was confirmed against AFLDB by finding
  // exactly one player of that surname whose debut season and club match
  // the source row -- a spelling difference, not a judgement call.
  'Jack McMillan': 'Jack MacMillan',        // Footscray, 1936
  'Bob Pratt Jr.': 'Bob Pratt',             // South Melbourne, 1955 (the 1955 debutant, not his father)
  'Ray Allsopp': 'Ray Allsop',              // Richmond, 1955
  'Gary Farrant': 'Garry Farrant',          // North Melbourne, 1967
  'Tony Dullard': 'Anthony Dullard',        // Melbourne, 1973
  'Billy Picken': 'Bill Picken',            // Collingwood, 1974
  'Jack Anthony': 'John Anthony',           // Collingwood, 2008
  'Lachie Sullivan': 'Lachlan Sullivan',    // Collingwood, 2024
};

function hasEncodingCorruption(value: string): boolean {
  return /[ÃÂâ]|�/.test(value);
}

/**
 * The player's game in a given season and round.
 *
 * Rounds are numbered differently by the two sides for any season with an
 * Opening Round (2024 onward): AFLDB counts it as round 1, so the round
 * the source calls "R1" is AFLDB's round 2, and every later round is
 * likewise one higher. Rather than hardcode which seasons those are, the
 * offset is only tried when the exact round finds nothing AND the season
 * actually has an Opening-Round-shaped first round -- a round 1 with
 * markedly fewer games than round 2. A non-numeric round ("SF") is matched
 * exactly and never offset.
 */
async function findMatchForRound(
  sql: postgres.Sql,
  playerId: number,
  season: number,
  roundRaw: string,
): Promise<{ matchId: number; viaOpeningRoundOffset: boolean } | null> {
  const exact = await sql<{ matchId: number }[]>`
    SELECT pms.match_id AS "matchId"
      FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
     WHERE pms.player_id = ${playerId} AND m.season = ${season}
       AND upper(btrim(m.round_code)) = ${roundRaw.trim().toUpperCase()}
     LIMIT 1
  `;
  if (exact[0]) return { matchId: exact[0].matchId, viaOpeningRoundOffset: false };

  if (!/^\d+$/.test(roundRaw.trim())) return null;

  // An Opening Round is a short round 1 -- four or five games against a
  // full round 2 of nine. Strictly fewer, not "at most half": 2026's
  // five-game Opening Round is not half of nine and was missed by the
  // stricter test. This only runs when the exact round already found
  // nothing, so a season that merely had a small round 1 for other
  // reasons costs a lookup that then fails, not a wrong match.
  const [shape] = await sql<{ hasOpeningRound: boolean }[]>`
    SELECT COALESCE(
             count(*) FILTER (WHERE round_code = '1') > 0
             AND count(*) FILTER (WHERE round_code = '1')
                 < count(*) FILTER (WHERE round_code = '2'), false) AS "hasOpeningRound"
      FROM matches WHERE season = ${season} AND NOT is_final
  `;
  if (!shape?.hasOpeningRound) return null;

  const shifted = await sql<{ matchId: number }[]>`
    SELECT pms.match_id AS "matchId"
      FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
     WHERE pms.player_id = ${playerId} AND m.season = ${season}
       AND m.round_code = ${String(Number(roundRaw.trim()) + 1)}
     LIMIT 1
  `;
  return shifted[0] ? { matchId: shifted[0].matchId, viaOpeningRoundOffset: true } : null;
}

// --- Reporting ---------------------------------------------------------

type Resolution = {
  row: SourceRow;
  clubId: number | null;
  playerId: number | null;
  linkStatus: 'unique' | 'resolved' | 'ambiguous' | 'unmatched';
  candidateCount: number;
  matchId: number | null;
  notes: string[];
  issues: { issueType: string; severity: 'info' | 'warning' | 'error'; description: string; details: unknown }[];
};

function summarise(resolutions: Resolution[]): Record<string, number> {
  const linked = resolutions.filter((r) => r.linkStatus === 'unique' || r.linkStatus === 'resolved');
  return {
    imported: resolutions.length,
    matched: linked.length,
    ambiguous: resolutions.filter((r) => r.linkStatus === 'ambiguous').length,
    unmatched: resolutions.filter((r) => r.linkStatus === 'unmatched').length,
    clubsResolved: resolutions.filter((r) => r.clubId !== null).length,
    clubsUnresolved: resolutions.filter((r) => r.clubId === null).length,
    matchesResolved: resolutions.filter((r) => r.matchId !== null).length,
    matchesUnresolved: linked.length - resolutions.filter((r) => r.matchId !== null).length,
  };
}

// --- Main --------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const apply = argv.includes('--apply');
  const assignIds = argv.includes('--assign-ids');
  const rekeyMode = argv.includes('--rekey');
  const allowLinkLoss = argv.includes('--allow-link-loss');
  const acceptRenames = collectRepeatable(argv, '--accept-rename');
  const acceptRetirements = collectRepeatable(argv, '--accept-retirement');

  const path = csvPath();
  const rows = parseCsv(readFileSync(path, 'utf8'));
  console.log(`Parsed ${rows.length} rows from ${path}`);

  if (assignIds) {
    process.exitCode = runAssignIds(rows, manifestPath());
    return;
  }
  if (rekeyMode) {
    process.exitCode = await runRekey(parseManifest(manifestPath()));
    return;
  }

  const withMarkers = rows.filter((r) => r.sourceAnnotation !== null);
  const nGroups = new Map<number, number>();
  for (const r of rows) {
    if (r.markers.consecutiveGoalKicks > 1) {
      nGroups.set(r.markers.consecutiveGoalKicks, (nGroups.get(r.markers.consecutiveGoalKicks) ?? 0) + 1);
    }
  }
  console.log(`  annotated rows:            ${withMarkers.length}`);
  console.log(`  goals with first n kicks:  ${[...nGroups.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `n=${n}:${c}`).join(' ')}`);
  console.log(`  no further career goals:   ${rows.filter((r) => r.markers.noFurtherCareerGoals).length}`);
  console.log(`  no further career kicks:   ${rows.filter((r) => r.markers.noFurtherCareerKicks).length}`);
  console.log(`  kickless matches before:   ${rows.filter((r) => r.markers.kicklessMatchesBeforeFirstKick > 0).length}`);
  console.log(`  season range:              ${Math.min(...rows.map((r) => r.season))}-${Math.max(...rows.map((r) => r.season))}`);
  const corrupted = rows.filter((r) => hasEncodingCorruption(r.playerNameClean));
  if (corrupted.length > 0) {
    console.log(`  names with corrupt text:   ${corrupted.length}`);
    for (const r of corrupted) {
      const override = MANUAL_NAME_OVERRIDES[r.playerNameClean];
      console.log(`    line ${r.lineNo}: ${JSON.stringify(r.playerNameClean)}${override ? ` -> override ${JSON.stringify(override)}` : ' (NO OVERRIDE)'}`);
    }
  }

  if (checkOnly) {
    console.log('\n--check: parsing and legend decoding only, no database touched.');
    return;
  }

  // Identity comes from the tracked manifest, so the mapping is settled
  // before a database is even opened. Any unmatched row on EITHER side is a
  // curator question, never something to guess at or allocate around.
  const manifest = parseManifest(manifestPath());
  const joined = joinManifest(rows, manifest);
  if (joined.unmatchedActive.length > 0 || joined.unmatchedExtract.length > 0) {
    console.error(describeJoinFailure(joined));
    process.exitCode = 1;
    return;
  }

  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set (use --check to validate parsing without a database).');

  const sql = postgres(dsn, { max: 1, onnotice: () => {} });
  try {
    const resolutions: Resolution[] = [];
    let openingRoundAdjusted = 0;

    for (const row of rows) {
      const notes: string[] = [];
      const issues: Resolution['issues'] = [];

      const club = await resolveClub(sql, row.clubNameRaw, row.season);
      if (!club) notes.push(`Club "${row.clubNameRaw}" did not resolve for season ${row.season}.`);

      const overridden = MANUAL_NAME_OVERRIDES[row.playerNameClean];
      const lookupName = overridden ?? row.playerNameClean;
      if (overridden) notes.push(`Name resolved via a recorded manual override (source text is corrupted).`);

      let result = await resolvePlayer(sql, lookupName, row.season, club?.id ?? null);
      let linkStatus: Resolution['linkStatus'] = result.status;

      // This achievement happens on a player's first kick, so the player
      // debuted in (or just before) the listed season -- a much stronger
      // filter than name+club+season alone. Applied only to break a tie
      // the shared resolver already called ambiguous, and kept local so
      // the datasets that share resolvePlayer are unaffected.
      if (result.status === 'ambiguous') {
        // `<=`, not `=`: the debut season can genuinely precede the feat
        // (Brent Harvey debuted 1996, first kick 1997), and the "#" marker
        // that would flag those rows is known-incomplete, so the bound
        // cannot be tightened for unmarked rows.
        const narrowed = await sql<{ id: number }[]>`
          SELECT p.id
            FROM players p
           WHERE p.search_name = afldb_normalise_name(${lookupName})
             AND p.debut_season <= ${row.season}
             AND EXISTS (
               SELECT 1 FROM player_match_stats pms
                WHERE pms.player_id = p.id
                  AND pms.career_game_no = 1
                  ${club ? sql`AND pms.club_id = ${club.id}` : sql``}
             )
        `;
        if (narrowed.length === 1) {
          result = { status: 'unique', playerId: narrowed[0].id, count: result.count };
          linkStatus = 'resolved';
          notes.push('Ambiguous by name; resolved by debut game.');
        }
      }

      if (overridden && (linkStatus === 'unique')) linkStatus = 'resolved';

      const playerId = linkStatus === 'unique' || linkStatus === 'resolved' ? result.playerId : null;
      if (playerId === null && hasEncodingCorruption(row.playerNameClean)) {
        notes.push('Source text is encoding-corrupted; needs a manual override to link.');
      }

      // The match is the one the SOURCE says it happened in -- the
      // player's game in that season at that round -- not one inferred
      // from career position. Position is unreliable here: Brent Harvey's
      // debut (1996 R22) recorded no kick at all, and his first kick, the
      // goal, came in his second game (1997 R5), exactly as the source
      // says. Only 5 rows carry the "#" marker that would have warned of
      // this, so the marker cannot be relied on to catch the rest.
      let matchId: number | null = null;
      if (playerId !== null) {
        const found = await findMatchForRound(sql, playerId, row.season, row.roundRaw);
        if (found) {
          matchId = found.matchId;
          if (found.viaOpeningRoundOffset) openingRoundAdjusted += 1;
        } else {
          // Not resolvable to a game, so no game is linked. Inferring one
          // would attach real opponent/venue/score detail to a claim the
          // data does not actually support.
          issues.push({
            issueType: 'first_kick_match_unresolved',
            severity: 'warning',
            description: `Source says round ${row.roundRaw}, ${row.season}, but AFLDB records no game for this player in that round.`,
            details: { sourceRound: row.roundRaw, sourceSeason: row.season },
          });
          notes.push(`No game found for round ${row.roundRaw}, ${row.season}.`);
        }

        // The two legend markers phrased as career totals are the only
        // part of this dataset AFLDB can independently check. A row can
        // combine "(n)" with either marker ("goal with each of their
        // first 2 kicks, no further career goals"), in which case the
        // implied total is n, not 1. Only marked rows are worth the
        // lookup -- there is nothing to check for the other ~300.
        if (row.markers.noFurtherCareerGoals || row.markers.noFurtherCareerKicks) {
          const implied = row.markers.consecutiveGoalKicks;
          const [career] = await sql<{ goals: number | null; kicks: number | null }[]>`
            SELECT goals, kicks FROM player_career_stats WHERE player_id = ${playerId}
          `;
          if (career) {
            if (row.markers.noFurtherCareerGoals && career.goals !== null && career.goals !== implied) {
              issues.push({
                issueType: 'career_goals_contradicts_source',
                severity: 'warning',
                description: `Source marks "no further career goals" (implying ${implied} career goal${implied === 1 ? '' : 's'}); AFLDB has ${career.goals}.`,
                details: { claim: 'no_further_career_goals', sourceImplies: implied, afldbHas: career.goals },
              });
            }
            if (row.markers.noFurtherCareerKicks && career.kicks !== null && career.kicks !== implied) {
              issues.push({
                issueType: 'career_kicks_contradicts_source',
                severity: 'warning',
                description: `Source marks "no further career kicks" (implying ${implied} career kick${implied === 1 ? '' : 's'}); AFLDB has ${career.kicks}.`,
                details: { claim: 'no_further_career_kicks', sourceImplies: implied, afldbHas: career.kicks },
              });
            }
          }
        }
      }

      resolutions.push({
        row, clubId: club?.id ?? null, playerId, linkStatus,
        candidateCount: result.count, matchId, notes, issues,
      });
    }

    const counts = summarise(resolutions);
    console.log('\nResolution');
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} ${v}`);
    if (openingRoundAdjusted > 0) {
      console.log(`\n  ${openingRoundAdjusted} match(es) resolved one round later than the source's label:`);
      console.log("  the source numbers Opening Round separately, AFLDB counts it as round 1.");
    }

    const unresolved = resolutions.filter((r) => r.linkStatus === 'ambiguous' || r.linkStatus === 'unmatched');
    if (unresolved.length > 0) {
      console.log(`\nUnlinked rows (${unresolved.length}) -- stored with the source spelling, never guessed:`);
      for (const r of unresolved) {
        console.log(`  ${r.linkStatus.padEnd(9)} line ${r.row.lineNo}: ${r.row.playerNameClean} (${r.row.clubNameRaw}, ${r.row.season})${r.candidateCount > 1 ? ` [${r.candidateCount} candidates]` : ''}`);
      }
    }

    const allIssues = resolutions.flatMap((r) => r.issues);
    if (allIssues.length > 0) {
      console.log(`\nCross-check findings (${allIssues.length}) -- recorded as data_issues:`);
      for (const r of resolutions) {
        for (const issue of r.issues) console.log(`  ${issue.issueType}: ${r.row.playerNameClean} -- ${issue.description}`);
      }
    }

    if (!apply) {
      console.log('\nDry run. Nothing was written. Re-run with --apply to write.');
      return;
    }

    await sql.begin(async (tx) => {
      const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = ${SOURCE_KEY}`;
      if (!source) throw new Error(`Source ${SOURCE_KEY} is missing; run migration 053 first.`);

      const [batch] = await tx<{ id: number }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, status, records_read)
        VALUES (${source.id}, 'tools/records/import-first-kick-goal.ts', 'player_achievements', 'running', ${rows.length})
        RETURNING id
      `;

      // ---- The reload key -------------------------------------------
      // The stable id assigned in data/records/first-kick-goal-ids.csv,
      // stored as source_record_id and enforced by the existing
      // player_achievements_source_uq (source_id, source_record_id). The
      // extract's clean name is only the JOIN to the manifest, never the
      // identity: names move (mojibake, spelling corrections, marker
      // changes), the manifest id never does.
      const incoming = new Map<string, Resolution>();
      const duplicates = new Set<string>();
      for (const r of resolutions) {
        const key = joined.idByName.get(r.row.playerNameClean)!;
        if (incoming.has(key)) duplicates.add(key);
        else incoming.set(key, r);
      }
      if (duplicates.size > 0) {
        throw new ReloadAbort(
          `The source supplied ${duplicates.size} duplicate stable id(s): `
          + `${[...duplicates].slice(0, 5).join(', ')}. Nothing has been written.`,
        );
      }

      // ---- The rows this importer owns -------------------------------
      // Type AND source. player_achievements is shared: the type is meant to
      // grow, and a row stamped with another source is not this loader's to
      // update or delete. Scoping by ownership is what AFLDB-ISSUE-080
      // records the honours loaders failing to do.
      type OwnedRow = { id: number; key: string | null; name: string; playerId: number | null; status: string };
      const owned = await tx<OwnedRow[]>`
        SELECT id, source_record_id AS key, player_name_clean AS name,
               player_id AS "playerId", link_status_value::text AS status
          FROM player_achievements
         WHERE achievement_type = ${ACHIEVEMENT_TYPE} AND source_id = ${source.id}
      `;
      const legacyRows = owned.filter((row) => row.key === null || !ID_PATTERN.test(row.key));
      if (legacyRows.length > 0) {
        throw new ReloadAbort(
          legacyRows.length === owned.length
            ? `All ${owned.length} stored row(s) still carry the legacy source_record_id `
              + 'format. Run --rekey once before reloading. Nothing has been written.'
            : `Mixed identity state: ${legacyRows.length} of ${owned.length} stored row(s) `
              + 'do not carry a stable fkg id. This needs manual review; nothing has been written.',
        );
      }
      const manifestIds = new Set(manifest.map((m) => m.id));
      const unknownStored = owned.filter((row) => !manifestIds.has(row.key!));
      if (unknownStored.length > 0) {
        throw new ReloadAbort(
          `${unknownStored.length} stored row(s) carry a stable id the manifest does not know: `
          + unknownStored.slice(0, 5).map((r) => `${r.key} (${JSON.stringify(r.name)})`).join(', ')
          + '. Nothing has been written.',
        );
      }
      // player_achievements_source_uq makes stored keys unique per source;
      // build the map on that guarantee.
      const ownedByKey = new Map(owned.map((row) => [row.key!, row]));

      // ---- Classify every human decision BEFORE anything is written ---
      // The achievement row records only the OUTCOME (player_id plus
      // 'resolved'), so it cannot tell a human link from an import-derived
      // one. The append-only audit trail can, and its newest row per target
      // is the decision that stands.
      const decisions = await tx<{
        targetId: string | number; action: string; playerId: number | null; previousStatus: string;
      }[]>`
        SELECT DISTINCT ON (r.target_id)
               r.target_id AS "targetId", r.action, r.player_id AS "playerId",
               r.previous_status::text AS "previousStatus"
          FROM player_link_resolutions r
          JOIN player_achievements a ON a.id = r.target_id
         WHERE r.target_table = 'player_achievements'
           AND a.achievement_type = ${ACHIEVEMENT_TYPE}
           AND a.source_id = ${source.id}
         ORDER BY r.target_id, r.created_at DESC, r.id DESC
      `;
      if (decisions.length > 0) {
        console.log(`\n${decisions.length} manual identity decision(s) read.`);
      }
      // String keys on BOTH sides, deliberately: target_id is bigint and
      // postgres.js hands int8 back as a JavaScript string (an int8 can
      // exceed Number.MAX_SAFE_INTEGER, so the driver refuses to narrow).
      // A number-keyed Map here read every decision and then silently
      // dropped all of them -- no error, the source simply won. String()
      // on both sides stays correct whichever representation arrives.
      const ownedById = new Map(owned.map((row) => [String(row.id), row]));
      const decisionByRowId = new Map<string, { action: string; playerId: number | null; previousStatus: string }>();
      for (const decision of decisions) {
        const row = ownedById.get(String(decision.targetId));
        if (row) decisionByRowId.set(String(row.id), decision);
      }

      type Carried = { row: OwnedRow; action: string; playerId: number | null; previousStatus: string };
      const carried: Carried[] = [];
      const discarded: string[] = [];

      // Retirements: stored ids the incoming set no longer carries. The
      // curator retired (or removed) them in the manifest -- but "retired"
      // means the source fact went away, never "delete regardless of
      // application history", so each candidate passes the same preflight
      // as everything else.
      //
      // player_achievements.id is referenced WITHOUT a foreign key by four
      // things, and they are not all the same kind of reference:
      //
      //   player_link_resolutions      DURABLE, append-only by grant. A
      //                                decision here is a decision LOSS and
      //                                only --allow-link-loss authorises it.
      //   player_link_suggestions      DURABLE. Orphans are surfaced: the
      //                                "Reader suggestions" panel renders
      //                                every open row unjoined, so a
      //                                stranded tip sits in that queue
      //                                permanently and can never be
      //                                approved. Gated below.
      //   data_issues, adjudicated     DURABLE. Deliberately preserved
      //                                history (resolved_at IS NOT NULL).
      //                                Gated below.
      //   data_issues, unresolved      DISPOSABLE and this importer's own
      //                                droppings -- it files and refiles
      //                                them every run. Cleaned below.
      //   player_link_match_candidates DISPOSABLE and self-limiting: every
      //                                read is keyed by the entity ids
      //                                actually on the page
      //                                (readSuggestionsForEntities), so an
      //                                orphan is never fetched, and the
      //                                cache is advisory -- approval
      //                                rescores from source data. Not
      //                                consulted, not cleaned, and
      //                                deliberately NOT read here: the
      //                                import role has no privilege on it.
      const retirements = owned.filter((row) => !incoming.has(row.key!));
      const retirementRefs = new Map<string, string[]>();
      if (retirements.length > 0) {
        const ids = retirements.map((row) => row.id);
        const refs = await tx<{ id: string | number; kind: string; n: number }[]>`
          SELECT entity_id AS id, 'adjudicated data_issues' AS kind, count(*)::int AS n
            FROM data_issues
           WHERE entity_type = 'player_achievements' AND entity_id IN ${tx(ids)}
             AND resolved_at IS NOT NULL
           GROUP BY entity_id
          UNION ALL
          SELECT target_id, 'reader suggestions', count(*)::int
            FROM player_link_suggestions
           WHERE target_table = 'player_achievements' AND target_id IN ${tx(ids)}
           GROUP BY target_id
        `;
        for (const ref of refs) {
          const row = ownedById.get(String(ref.id));
          if (!row) continue;
          const list = retirementRefs.get(row.key!) ?? [];
          list.push(`${ref.n} ${ref.kind}`);
          retirementRefs.set(row.key!, list);
        }
      }

      const retirementsAtRisk: string[] = [];
      for (const row of retirements) {
        const decision = decisionByRowId.get(String(row.id));
        if (decision) {
          // A decision on a retiring row is a decision loss, and only
          // --allow-link-loss may authorise that -- --accept-retirement is
          // about durable references and deliberately cannot discard a
          // human decision.
          discarded.push(
            `player_achievements id=${row.id} [${row.key}] ${JSON.stringify(row.name)} `
            + `decision=${decision.action} `
            + `(${decision.playerId === null ? 'no player' : `player ${decision.playerId}`}): `
            + 'the source no longer carries this id',
          );
        }
        const refs = retirementRefs.get(row.key!);
        if (refs && !acceptRetirements.includes(row.key!)) {
          retirementsAtRisk.push(
            `${row.key} ${JSON.stringify(row.name)} (db id ${row.id}) still has ${refs.join(', ')}; `
            + `rerun with --accept-retirement ${row.key} to delete it anyway`,
          );
        }
      }

      // Renames: same stable id, different clean name -- the source says
      // this is still the same achievement with corrected descriptive data.
      // An undecided row updates in place (reported); a decided row needs
      // the curator's explicit per-record acknowledgement, because a reused
      // id would otherwise move a human decision onto a different person.
      type Rename = { row: OwnedRow; newName: string; decided: boolean };
      const renames: Rename[] = [];
      for (const row of owned) {
        const r = row.key !== null ? incoming.get(row.key) : undefined;
        if (r && r.row.playerNameClean !== row.name) {
          renames.push({
            row,
            newName: r.row.playerNameClean,
            decided: decisionByRowId.has(String(row.id)),
          });
        }
      }
      const renameByKey = new Map(renames.map((rename) => [rename.row.key!, rename]));

      // Acknowledgements must correspond to something actually detected in
      // THIS run: a stale or mistyped flag is an error, not a no-op.
      const badAcks: string[] = [];
      for (const key of acceptRenames) {
        if (!renameByKey.has(key)) {
          badAcks.push(`--accept-rename ${key}: no rename of that stable id was detected in this run`);
        }
      }
      const retirementKeys = new Set(retirements.map((row) => row.key!));
      for (const key of acceptRetirements) {
        if (!retirementKeys.has(key)) {
          badAcks.push(`--accept-retirement ${key}: no retirement of that stable id was detected in this run`);
        }
      }
      const unacknowledgedRenames = renames.filter(
        (rename) => rename.decided && !acceptRenames.includes(rename.row.key!),
      );

      // ---- Everything classified; abort as one report, before any write --
      const problems: string[] = [];
      if (badAcks.length > 0) problems.push(...badAcks);
      for (const rename of unacknowledgedRenames) {
        const decision = decisionByRowId.get(String(rename.row.id))!;
        problems.push(
          `${rename.row.key} is renamed ${JSON.stringify(rename.row.name)} -> `
          + `${JSON.stringify(rename.newName)} but carries a human decision `
          + `(${decision.action}${decision.playerId === null ? '' : `, player ${decision.playerId}`}); `
          + `review it, then rerun with --accept-rename ${rename.row.key}`,
        );
      }
      problems.push(...retirementsAtRisk);
      if (discarded.length > 0 && !allowLinkLoss) {
        problems.push(
          `${discarded.length} human identity decision(s) cannot survive this reload:`,
          ...discarded.map((message) => `  ${message}`),
          'Review them in /admin/player-links, or rerun with --allow-link-loss to discard them deliberately.',
        );
      }
      if (problems.length > 0) {
        throw new ReloadAbort(
          'This first-kick-goal reload cannot proceed; nothing has been written:\n  '
          + problems.join('\n  '),
        );
      }
      if (discarded.length > 0) {
        console.log(`\n--allow-link-loss: DISCARDING ${discarded.length} human identity decision(s):`);
        for (const message of discarded) console.log(`  ${message}`);
      }
      for (const row of owned) {
        const decision = decisionByRowId.get(String(row.id));
        if (!decision) continue;
        if (row.key !== null && incoming.has(row.key)) {
          carried.push({ row, ...decision });
        }
      }
      for (const rename of renames) {
        console.log(
          `  ${rename.row.key}: descriptive rename ${JSON.stringify(rename.row.name)} -> `
          + `${JSON.stringify(rename.newName)}${rename.decided ? ' (acknowledged, decision kept)' : ''}; same row, same id`,
        );
      }

      // ---- Write. Matched rows keep their id; only their columns change --
      // Retired keys go FIRST. `player_achievements_source_uq` covers
      // (source_id, source_record_id), and a departing row can still be
      // holding an id an incoming row is about to take -- inserting before
      // deleting would trip the constraint mid-transaction. Safe only
      // because every abort above has already run, and everything here is
      // one transaction: a later failure rolls this DELETE back too.
      const vanished = retirements.map((row) => row.key!);
      if (vanished.length > 0) {
        // The retiring rows' own unresolved data_issues go with them.
        // They are this importer's droppings -- it files and refiles them
        // every run -- and the refile below is scoped to the SURVIVING
        // ids, so without this they would outlive the row they describe
        // and point at a dead id. Adjudicated ones are history and stay;
        // that is exactly what --accept-retirement was required for.
        await tx`
          DELETE FROM data_issues
           WHERE entity_type = 'player_achievements'
             AND entity_id IN ${tx(retirements.map((row) => row.id))}
             AND resolved_at IS NULL
        `;
        await tx`
          DELETE FROM player_achievements
           WHERE achievement_type = ${ACHIEVEMENT_TYPE}
             AND source_id = ${source.id}
             AND source_record_id IN ${tx(vanished)}
        `;
        for (const row of retirements) {
          const refs = retirementRefs.get(row.key!);
          console.log(
            `  ${row.key} retired: row ${row.id} deleted`
            + (refs ? `; ACKNOWLEDGED durable references left behind: ${refs.join(', ')}` : ''),
          );
        }
      }

      const rowIds = new Map<string, number>();
      const insertedKeys: string[] = [];
      for (const [key, r] of incoming) {
        const match = ownedByKey.get(key);
        const values = {
          playerId: r.playerId,
          nameRaw: r.row.playerNameRaw,
          annotation: r.row.sourceAnnotation,
          status: r.linkStatus,
          candidates: r.candidateCount,
          clubId: r.clubId,
          clubRaw: r.row.clubNameRaw,
          season: r.row.season,
          footnote: r.row.seasonFootnoteRaw,
          round: r.row.roundRaw,
          notes: r.notes.length > 0 ? r.notes.join(' ') : null,
        };
        if (match) {
          await tx`
            UPDATE player_achievements SET
              player_id = ${values.playerId},
              player_name_raw = ${values.nameRaw},
              player_name_clean = ${r.row.playerNameClean},
              source_annotation = ${values.annotation},
              link_status_value = ${values.status},
              candidate_count = ${values.candidates},
              club_id = ${values.clubId},
              club_name_raw = ${values.clubRaw},
              season = ${values.season},
              season_footnote_raw = ${values.footnote},
              round_raw = ${values.round},
              consecutive_goal_kicks = ${r.row.markers.consecutiveGoalKicks},
              no_further_career_goals = ${r.row.markers.noFurtherCareerGoals},
              no_further_career_kicks = ${r.row.markers.noFurtherCareerKicks},
              kickless_matches_before_first_kick = ${r.row.markers.kicklessMatchesBeforeFirstKick},
              match_id = ${r.matchId},
              notes = ${values.notes},
              import_batch_id = ${batch.id}
            WHERE id = ${match.id}
          `;
          rowIds.set(key, match.id);
        } else {
          const [inserted] = await tx<{ id: number }[]>`
            INSERT INTO player_achievements (
              achievement_type, player_id, player_name_raw, player_name_clean,
              source_annotation, link_status_value, candidate_count,
              club_id, club_name_raw, season, season_footnote_raw, round_raw,
              consecutive_goal_kicks, no_further_career_goals, no_further_career_kicks,
              kickless_matches_before_first_kick, match_id, notes,
              source_id, source_record_id, import_batch_id
            ) VALUES (
              ${ACHIEVEMENT_TYPE}, ${values.playerId}, ${values.nameRaw}, ${r.row.playerNameClean},
              ${values.annotation}, ${values.status}, ${values.candidates},
              ${values.clubId}, ${values.clubRaw}, ${values.season}, ${values.footnote}, ${values.round},
              ${r.row.markers.consecutiveGoalKicks}, ${r.row.markers.noFurtherCareerGoals},
              ${r.row.markers.noFurtherCareerKicks}, ${r.row.markers.kicklessMatchesBeforeFirstKick},
              ${r.matchId}, ${values.notes},
              ${source.id}, ${key}, ${batch.id}
            ) RETURNING id
          `;
          rowIds.set(key, inserted.id);
          insertedKeys.push(key);
        }
      }

      // ---- Re-apply the human decisions ------------------------------
      for (const decision of carried) {
        const id = rowIds.get(decision.row.key!);
        if (id === undefined) continue;
        const source_ = incoming.get(decision.row.key!)!;
        if (decision.action === 'linked') {
          if (source_.playerId !== null && source_.playerId !== decision.playerId) {
            console.log(
              `  player_achievements id=${id} [${decision.row.key}] `
              + `${JSON.stringify(source_.row.playerNameClean)}: the source now links `
              + `player ${source_.playerId}, an admin linked player ${decision.playerId}; `
              + "keeping the admin's decision -- review it",
            );
          }
          await tx`
            UPDATE player_achievements
               SET player_id = ${decision.playerId}, link_status_value = 'resolved'
             WHERE id = ${id}
          `;
        } else {
          if (source_.playerId !== null) {
            console.log(
              `  player_achievements id=${id} [${decision.row.key}] `
              + `${JSON.stringify(source_.row.playerNameClean)}: the source now links `
              + `player ${source_.playerId}, an admin confirmed this row is genuinely `
              + 'unlinked; keeping it unlinked -- review it',
            );
          }
          // Keep the source's own unlinked wording where it has one; a
          // source that now claims a link has none, so fall back to the
          // status the admin was looking at when they decided.
          const unlinked = ['ambiguous', 'unmatched', 'implausible'];
          const status = unlinked.includes(source_.linkStatus)
            ? source_.linkStatus
            : (unlinked.includes(decision.previousStatus) ? decision.previousStatus : 'unmatched');
          await tx`
            UPDATE player_achievements
               SET player_id = NULL, link_status_value = ${status}
             WHERE id = ${id}
          `;
        }
      }

      // ---- Data issues, refiled against the ids that just survived ----
      // Only the unresolved ones this pass owns: a human resolution is a
      // recorded judgement, not this importer's to discard. Scoped to the
      // owned rows (plus the table-level count row, which has no entity)
      // so an issue filed against somebody else's achievement is untouched.
      const ownedIds = [...rowIds.values()];
      await tx`
        DELETE FROM data_issues
         WHERE entity_type = 'player_achievements'
           AND issue_type IN ('first_kick_match_unresolved', 'career_goals_contradicts_source',
                              'career_kicks_contradicts_source', 'source_count_discrepancy')
           AND resolved_at IS NULL
           AND (entity_id IS NULL OR entity_id IN ${tx(ownedIds)})
      `;

      for (const r of resolutions) {
        const id = rowIds.get(joined.idByName.get(r.row.playerNameClean)!);
        for (const issue of r.issues) {
          await tx`
            INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
            VALUES ('player_achievements', ${id ?? null}, ${issue.issueType}, ${issue.severity},
                    ${issue.description}, ${tx.json(issue.details as never)})
          `;
        }
      }

      // Written every run, agreeing or not: a live count beside the
      // source's own dated claim, rather than a gate the import can trip.
      await tx`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
        VALUES ('player_achievements', NULL, 'source_count_discrepancy', 'info',
                ${`Source prose claims 332 recognised players; the extract carried ${counts.imported} rows, of which ${counts.matched} linked to a player.`},
                ${tx.json({ claimed: 332, ...counts } as never)})
      `;

      const updated = ownedIds.length - insertedKeys.length;
      await tx`
        UPDATE import_batches
           SET completed_at = now(), status = 'completed',
               records_inserted = ${insertedKeys.length}, records_updated = ${updated}
         WHERE id = ${batch.id}
      `;

      console.log(
        `\nReconciled ${ownedIds.length} rows as import batch ${batch.id}: `
        + `${updated} updated, ${insertedKeys.length} inserted, ${vanished.length} deleted.`,
      );
      if (carried.length > 0) {
        console.log(`  ${carried.length} manual identity decision(s) preserved.`);
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

loadEnv();
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
