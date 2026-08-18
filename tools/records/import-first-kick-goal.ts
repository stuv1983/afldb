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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { resolveClub, resolvePlayer } from '../../src/lib/ingest/datasets';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CSV_PATH = join(PROJECT_ROOT, 'data', 'records', 'first-kick-goal.csv');
const SOURCE_KEY = 'wikipedia_first_kick_goal';

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
 * the key is the raw source string, so a corrected upstream file simply
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
  const checkOnly = process.argv.includes('--check');
  const apply = process.argv.includes('--apply');

  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  console.log(`Parsed ${rows.length} rows from ${CSV_PATH}`);

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
      const override = MANUAL_NAME_OVERRIDES[r.playerNameRaw];
      console.log(`    line ${r.lineNo}: ${JSON.stringify(r.playerNameClean)}${override ? ` -> override ${JSON.stringify(override)}` : ' (NO OVERRIDE)'}`);
    }
  }

  if (checkOnly) {
    console.log('\n--check: parsing and legend decoding only, no database touched.');
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
        const debutBound = row.markers.kicklessMatchesBeforeFirstKick > 0 ? row.season : row.season;
        const narrowed = await sql<{ id: number }[]>`
          SELECT p.id
            FROM players p
           WHERE p.search_name = afldb_normalise_name(${lookupName})
             AND p.debut_season <= ${debutBound}
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
        // part of this dataset AFLDB can independently check.
        const [career] = await sql<{ goals: number | null; kicks: number | null }[]>`
          SELECT goals, kicks FROM player_career_stats WHERE player_id = ${playerId}
        `;
        if (career) {
          if (row.markers.noFurtherCareerGoals && career.goals !== null && career.goals !== 1) {
            issues.push({
              issueType: 'career_goals_contradicts_source',
              severity: 'warning',
              description: `Source marks "no further career goals" (implying 1 career goal); AFLDB has ${career.goals}.`,
              details: { claim: 'no_further_career_goals', sourceImplies: 1, afldbHas: career.goals },
            });
          }
          if (row.markers.noFurtherCareerKicks && career.kicks !== null && career.kicks !== 1) {
            issues.push({
              issueType: 'career_kicks_contradicts_source',
              severity: 'warning',
              description: `Source marks "no further career kicks" (implying 1 career kick); AFLDB has ${career.kicks}.`,
              details: { claim: 'no_further_career_kicks', sourceImplies: 1, afldbHas: career.kicks },
            });
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

      // Scoped to this achievement type, not the whole table, which is
      // meant to hold other curated achievements later. Delete-and-insert
      // rather than upsert, because a corrected source file may REMOVE a
      // row and an upsert could never notice.
      await tx`DELETE FROM player_achievements WHERE achievement_type = 'first_kick_goal'`;

      for (const r of resolutions) {
        const [inserted] = await tx<{ id: number }[]>`
          INSERT INTO player_achievements (
            achievement_type, player_id, player_name_raw, player_name_clean,
            source_annotation, link_status_value, candidate_count,
            club_id, club_name_raw, season, season_footnote_raw, round_raw,
            consecutive_goal_kicks, no_further_career_goals, no_further_career_kicks,
            kickless_matches_before_first_kick, match_id, notes,
            source_id, source_record_id, import_batch_id
          ) VALUES (
            'first_kick_goal', ${r.playerId}, ${r.row.playerNameRaw}, ${r.row.playerNameClean},
            ${r.row.sourceAnnotation}, ${r.linkStatus}, ${r.candidateCount},
            ${r.clubId}, ${r.row.clubNameRaw}, ${r.row.season}, ${r.row.seasonFootnoteRaw}, ${r.row.roundRaw},
            ${r.row.markers.consecutiveGoalKicks}, ${r.row.markers.noFurtherCareerGoals},
            ${r.row.markers.noFurtherCareerKicks}, ${r.row.markers.kicklessMatchesBeforeFirstKick},
            ${r.matchId}, ${r.notes.length > 0 ? r.notes.join(' ') : null},
            ${source.id}, ${r.row.sourceRecordId}, ${batch.id}
          ) RETURNING id
        `;

        for (const issue of r.issues) {
          await tx`
            INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, details)
            VALUES ('player_achievements', ${inserted.id}, ${issue.issueType}, ${issue.severity},
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

      await tx`
        UPDATE import_batches
           SET completed_at = now(), status = 'completed', records_inserted = ${resolutions.length}
         WHERE id = ${batch.id}
      `;

      console.log(`\nWrote ${resolutions.length} rows as import batch ${batch.id}.`);
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
