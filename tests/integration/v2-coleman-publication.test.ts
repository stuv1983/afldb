// db | Coleman publication into award winners PostgreSQL integration tests
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.
/**
 * AFLDB V2 Launch F (stream F-D, ADR 0015) - publishing the derived Coleman Medal into the
 * canonical `award_winners` table, against a REAL PostgreSQL (the isolated cluster's `_test`
 * database), through the production code path end to end:
 *
 *   loadColemanDerivationInput -> publishColemanResult(..., { projection: colemanAwardWinnerProjection })
 *
 * run over a postgres.js executor connected as the restricted `afldb_import` role (the role the
 * operations centre connects as). PGlite is not evidence for any of this.
 *
 * Proven here: first publication inserts winners, the ledger row, the provenance row and the audit
 * rows; a rerun changes nothing (row counts unchanged, every winner `retained`); joint winners are
 * several rows; finals goals never decide the winner; incomplete / unsettled / unrecorded seasons
 * write nothing anywhere; a refusal or a failure mid-projection rolls the LEDGER back too; a sealed
 * season whose stored rows already equal the derivation records provenance only; a corrected goal
 * fact updates or voids-and-inserts with audit; the administrator-override and voided-row refusals;
 * and the public award queries return the published rows.
 *
 * FIXTURES: synthetic clubs, players, matches and goals under the `v2-coleman-it` marker, on season
 * 2001 (sealed in data/reference/seasons.json). The template database holds NO reference rows, so
 * this suite seeds what it needs (sources, the season, the `coleman` award, an acting user) and
 * removes everything it created. It refuses to start if a Coleman 2001 row already exists.
 */
import './guard';

import { createImportRoleParityHarness } from './import-role-parity';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { nativeTransactionOf, postgresExecutor, type TransactionalSqlExecutor } from '@afldb/db';
import {
  COLEMAN_DERIVATION_VERSION,
  colemanProjectionNote,
  deriveColeman,
  publishColemanResult,
  type ColemanPublicationOutcome,
  type ColemanProjectionPort,
} from '@afldb/derived';

import { isAllowedRevalidatePath } from '@/app/admin/awards/revalidate-paths';
import { getAwardSeason, getAwardSeasons, getAwardWinners, listAwards } from '@/db/queries/awards';
import { colemanAwardWinnerProjection } from '@/db/queries/coleman-award-winners';
import { loadColemanContract, loadColemanDerivationInput } from '@/db/queries/coleman-inputs';
import { loadSeasonRegistry } from '@/lib/seasons/sealed-seasons';

const importRole = createImportRoleParityHarness(
  process.env.AFLDB_TEST_DATABASE_URL,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);

const MARKER = 'v2-coleman-it';
const SEASON = 2001;
const DERIVED_AT = '2026-10-19T00:00:00Z';
const NOTE = 'SYNTHETIC integration note: publish the derived Coleman result for the test season.';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
type Letter = (typeof LETTERS)[number];
/** Player letter -> index of the club it plays for (0..3), as in tests/v2-coleman-publication-fixtures.ts. */
const CLUB_OF: Record<Letter, number> = { A: 0, B: 0, C: 1, D: 1, E: 2, F: 2, G: 3, H: 3 };
/** Matches: home, away club indexes. The last one is a FINAL. */
const MATCHES = [
  { key: 'm1', home: 0, away: 1, final: false },
  { key: 'm2', home: 2, away: 3, final: false },
  { key: 'm3', home: 0, away: 2, final: false },
  { key: 'm4', home: 1, away: 3, final: false },
  { key: 'f1', home: 0, away: 1, final: true },
] as const;
/** Home-and-away totals: A=5, B=2, C=3, D=2, E=3, F=1, G=3, H=0. Finals rows never count. */
const BASE_GOALS: Record<string, number> = {
  'A:m1': 3, 'A:m3': 2, 'A:f1': 1,
  'B:m1': 1, 'B:m3': 1,
  'C:m1': 2, 'C:m4': 1, 'C:f1': 2,
  'D:m4': 2,
  'E:m2': 3,
  'F:m3': 1,
  'G:m2': 1, 'G:m4': 2,
};

const pathOf = (letter: Letter): string => `players/V/${MARKER}-${letter}.html`;
const keyOf = (letter: Letter): string => `coleman:${SEASON}:${pathOf(letter)}`;
const entityKeyOf = (letter: Letter): string => `afltables:${keyOf(letter)}`;
const nameOf = (letter: Letter): string => `Synthetic Coleman ${letter}`;

const owner = postgres(process.env.AFLDB_TEST_DATABASE_URL!, { max: 2, onnotice: () => {} });
const importSql = postgres(process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? process.env.AFLDB_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
const executor: TransactionalSqlExecutor = postgresExecutor(importSql);

const createdSources: string[] = [];
let createdSeason = false;
let createdAward = false;
let actorId = 0;
let awardId = 0;
let firstImportBatchId = 0; // batches the offline loader creates during this run are removed again
const playerIds = {} as Record<Letter, number>;
const clubIds: number[] = [];
const matchIds = {} as Record<string, number>;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

async function seed(): Promise<void> {
  const [batch] = await owner<{ id: number }[]>`SELECT coalesce(max(id), 0)::int AS id FROM import_batches`;
  firstImportBatchId = batch.id;
  for (const [key, kind] of [['afltables', 'scrape'], ['manual_admin_edit', 'manual'], ['draftguru', 'scrape']] as const) {
    const created = await owner`
      INSERT INTO sources (key, name, kind) VALUES (${key}, ${`${MARKER} ${key}`}, ${kind})
      ON CONFLICT (key) DO NOTHING RETURNING id`;
    if (created.length > 0) createdSources.push(key);
  }
  const season = await owner`
    INSERT INTO seasons (year, league, status) VALUES (${SEASON}, 'AFL', 'complete'::season_status)
    ON CONFLICT (year) DO NOTHING RETURNING year`;
  createdSeason = season.length > 0;
  const award = await owner<{ id: number }[]>`
    INSERT INTO awards (slug, name, category, competition)
    VALUES ('coleman', 'Coleman Medal', 'award', 'AFL')
    ON CONFLICT (slug) DO NOTHING RETURNING id::int AS id`;
  createdAward = award.length > 0;
  const [awardRow] = await owner<{ id: number }[]>`SELECT id::int AS id FROM awards WHERE slug = 'coleman'`;
  awardId = awardRow.id;

  const [user] = await owner<{ id: number }[]>`
    INSERT INTO auth_users (email, role) VALUES (${`${MARKER}@example.invalid`}, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id::int AS id`;
  actorId = user.id;

  await owner.begin(async (tx) => {
    await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
    for (let index = 0; index < 4; index += 1) {
      const [club] = await tx<{ id: number }[]>`
        INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist)
        VALUES (${`${MARKER}-club-${index}`}, ${`${MARKER} Club ${index}`}, ${`Club ${index}`}, ${`C${index}`}, -1,
                ${`${MARKER}-club-${index}`})
        RETURNING id::int AS id`;
      await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
      clubIds.push(club.id);
    }
  });

  const [afltables] = await owner<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
  for (const letter of LETTERS) {
    const name = nameOf(letter);
    const [player] = await owner<{ id: number }[]>`
      INSERT INTO players (display_name, search_name, sort_name, slug)
      VALUES (${name}, afldb_normalise_name(${name}), ${name}, ${`${MARKER}-${letter.toLowerCase()}`})
      RETURNING id::int AS id`;
    playerIds[letter] = player.id;
    await owner`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES (${afltables.id}, ${pathOf(letter)}, ${player.id}, 'unique', 'afltables_profile_url')`;
  }

  for (const match of MATCHES) {
    const [row] = await owner<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
        home_club_id, away_club_id, home_score, away_score, result, winner_club_id, margin, attendance_status
      ) VALUES (
        ${`${MARKER}|${match.key}`}, ${SEASON}, ${match.final ? 'EF' : '1'}, ${match.final ? null : 1},
        ${match.final ? 'elimination_final' : 'home_and_away'}::round_type, ${match.final},
        ${`${SEASON}-04-01`}, ${`${MARKER} Oval`}, ${clubIds[match.home]}, ${clubIds[match.away]},
        60, 30, 'home_win'::match_result, ${clubIds[match.home]}, 30, 'not_collected'::coverage_status
      ) RETURNING id::int AS id`;
    matchIds[match.key] = row.id;
    for (const letter of LETTERS) {
      if (CLUB_OF[letter] !== match.home && CLUB_OF[letter] !== match.away) continue;
      await owner`
        INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
        VALUES (${playerIds[letter]}, ${row.id}, ${clubIds[CLUB_OF[letter]]}, ${BASE_GOALS[`${letter}:${match.key}`] ?? 0})`;
    }
  }
}

async function purge(): Promise<void> {
  // Everything the suite writes, in dependency order. data_edits / ledgers are owner-deletable here only
  // because this is the isolated `_test` database; the import role could never do this.
  await owner`DELETE FROM data_edits WHERE table_name = 'award_winners' AND admin_user_id IN (SELECT id FROM auth_users WHERE email = ${`${MARKER}@example.invalid`})`;
  await owner`DELETE FROM data_overrides WHERE entity_type = 'award_winners' AND entity_key LIKE ${`%${MARKER}%`}`;
  await owner`DELETE FROM player_link_resolutions WHERE target_table = 'award_winners' AND admin_user_id IN (SELECT id FROM auth_users WHERE email = ${`${MARKER}@example.invalid`})`;
  await owner`DELETE FROM award_winners WHERE award_id = ${awardId} AND season = ${SEASON}`;
  await owner`DELETE FROM import_batches WHERE id > ${firstImportBatchId}`;
  await owner`DELETE FROM derived_award_projections WHERE award_slug = 'coleman' AND season = ${SEASON}`;
  await owner`DELETE FROM derived_award_results WHERE award_slug = 'coleman' AND season = ${SEASON}`;
}

async function teardown(): Promise<void> {
  await purge();
  await owner`DELETE FROM player_match_stats WHERE match_id IN (SELECT id FROM matches WHERE match_key LIKE ${`${MARKER}|%`})`;
  await owner`DELETE FROM matches WHERE match_key LIKE ${`${MARKER}|%`}`;
  await owner`DELETE FROM external_identities WHERE external_id LIKE ${`players/V/${MARKER}-%`}`;
  await owner`DELETE FROM players WHERE slug LIKE ${`${MARKER}-%`}`;
  await owner`DELETE FROM clubs WHERE slug LIKE ${`${MARKER}-club-%`}`;
  await owner`DELETE FROM auth_users WHERE email = ${`${MARKER}@example.invalid`}`;
  if (createdAward) await owner`DELETE FROM awards WHERE slug = 'coleman'`;
  if (createdSeason) await owner`DELETE FROM seasons WHERE year = ${SEASON}`;
  for (const key of createdSources) await owner`DELETE FROM sources WHERE key = ${key}`;
}

/** Restore every goal fact to the base totals (A leads with 5) and clear the Coleman rows. */
async function reset(): Promise<void> {
  await purge();
  for (const match of MATCHES) {
    for (const letter of LETTERS) {
      if (CLUB_OF[letter] !== match.home && CLUB_OF[letter] !== match.away) continue;
      await setGoals(letter, match.key, BASE_GOALS[`${letter}:${match.key}`] ?? 0);
    }
  }
  await owner`UPDATE awards SET first_season = NULL, last_season = NULL WHERE id = ${awardId}`;
}

async function setGoals(letter: Letter, matchKey: string, goals: number | null): Promise<void> {
  await owner`UPDATE player_match_stats SET goals = ${goals} WHERE player_id = ${playerIds[letter]} AND match_id = ${matchIds[matchKey]}`;
}

/* ------------------------------------------------------------------ *
 * The code path under test
 * ------------------------------------------------------------------ */

async function publish(
  over: { settled?: boolean; season?: number; projection?: ColemanProjectionPort; note?: string } = {},
): Promise<ColemanPublicationOutcome> {
  const input = await loadColemanDerivationInput(executor, {
    season: over.season ?? SEASON,
    settled: over.settled ?? true,
    derivedAt: DERIVED_AT,
    registry: loadSeasonRegistry(),
    contract: loadColemanContract(),
  });
  return publishColemanResult(
    executor,
    {
      derivation: input,
      correction: { workflow: 'derived_award_publication', actorUserId: actorId, note: over.note ?? NOTE, evidenceRef: `${MARKER}-evidence` },
      publishedBy: actorId,
      viewer: { role: 'super_admin', canManageAdmins: true },
    },
    { projection: over.projection ?? colemanAwardWinnerProjection },
  );
}

function expectPublished(outcome: ColemanPublicationOutcome) {
  if (!outcome.ok) throw new Error(`unexpected refusal ${outcome.refusal.code}: ${outcome.refusal.message}`);
  if (outcome.projection === null) throw new Error('the production port must have projected');
  return { ...outcome, projection: outcome.projection };
}

function expectRefused(outcome: ColemanPublicationOutcome) {
  if (outcome.ok) throw new Error(`expected a refusal, got ${outcome.outcome}`);
  return outcome.refusal;
}

interface Totals { winners: number; ledger: number; projections: number; edits: number }

async function totals(): Promise<Totals> {
  const [row] = await owner<{ winners: number; ledger: number; projections: number; edits: number }[]>`
    SELECT (SELECT count(*) FROM award_winners WHERE award_id = ${awardId})::int AS winners,
           (SELECT count(*) FROM derived_award_results WHERE award_slug = 'coleman')::int AS ledger,
           (SELECT count(*) FROM derived_award_projections WHERE award_slug = 'coleman')::int AS projections,
           (SELECT count(*) FROM data_edits WHERE table_name = 'award_winners' AND field_group = 'coleman_derived_publication')::int AS edits`;
  return row;
}

interface WinnerRow {
  id: number; season: number; player_id: number | null; player_name_raw: string; link_status_value: string;
  candidate_count: number; club_id: number | null; club_name_raw: string | null; votes: string | null; position: string | null;
  is_captain: boolean; is_vice_captain: boolean; note: string | null; status: string; status_reason: string | null;
  source_key: string; source_record_id: string; import_batch_id: string | null; updated_at: string;
}

async function winnerRows(): Promise<WinnerRow[]> {
  return owner<WinnerRow[]>`
    SELECT w.id::int AS id, w.season::int AS season, w.player_id::int AS player_id, w.player_name_raw,
           w.link_status_value::text AS link_status_value, w.candidate_count::int AS candidate_count,
           w.club_id::int AS club_id, w.club_name_raw, w.votes::text AS votes, w.position, w.is_captain, w.is_vice_captain,
           w.note, w.status, w.status_reason, s.key AS source_key, w.source_record_id,
           w.import_batch_id::text AS import_batch_id, w.updated_at::text AS updated_at
      FROM award_winners w LEFT JOIN sources s ON s.id = w.source_id
     WHERE w.award_id = ${awardId} ORDER BY w.source_record_id`;
}

/** Insert the row the offline LOADER would write for a derived winner (the same tuple and key). */
async function insertLoaderRow(letter: Letter, goals: number, over: { status?: string } = {}): Promise<number> {
  const [afltables] = await owner<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
  const [row] = await owner<{ id: number }[]>`
    INSERT INTO award_winners (
      award_id, season, player_id, player_name_raw, link_status_value, candidate_count, club_id, club_name_raw,
      votes, position, is_captain, is_vice_captain, note, status, status_reason, source_id, source_record_id, updated_at)
    VALUES (${awardId}, ${SEASON}, ${playerIds[letter]}, ${nameOf(letter)}, 'resolved', 0, ${clubIds[CLUB_OF[letter]]}, NULL,
            NULL, NULL, false, false, ${colemanProjectionNote(goals, 1)}, ${over.status ?? 'active'},
            ${over.status === 'void' ? 'SYNTHETIC void reason' : null}, ${afltables.id}, ${keyOf(letter)}, '2020-01-01T00:00:00Z')
    RETURNING id::int AS id`;
  return row.id;
}

beforeAll(async () => {
  if (importRole.isConfigured) await importRole.validate();
  await teardown().catch(() => undefined); // debris of a crashed earlier run (awardId is unknown then, so best effort)
  await seed();
  const [existing] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM award_winners WHERE award_id = ${awardId} AND season = ${SEASON}`;
  if (existing.n > 0) throw new Error(`refusing to run: ${existing.n} Coleman ${SEASON} row(s) already exist that this suite did not create`);
}, 60_000);

afterAll(async () => {
  try {
    await teardown();
  } finally {
    await importSql.end({ timeout: 5 });
    await owner.end({ timeout: 5 });
  }
}, 60_000);

beforeEach(reset);

/* ------------------------------------------------------------------ *
 * 1. First publication
 * ------------------------------------------------------------------ */

describe('first publication (SYNTHETIC, PostgreSQL)', () => {
  it('inserts the winner in the loader\'s exact format, with the ledger row, the provenance row and the audit row', async () => {
    const outcome = expectPublished(await publish());
    expect(outcome).toMatchObject({ outcome: 'published', season: SEASON, winnerKeys: [keyOf('A')], supersededId: null });
    expect(outcome.projection.counts).toEqual({ inserted: 1, updated: 0, voided: 0, retained: 0 });
    expect(outcome.projection.changedCount).toBe(1);

    const rows = await winnerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      season: SEASON,
      player_id: playerIds.A,
      player_name_raw: nameOf('A'), // the canonical players.display_name
      link_status_value: 'resolved',
      candidate_count: 0,
      club_id: clubIds[0],
      club_name_raw: null,
      votes: null,
      position: null,
      is_captain: false,
      is_vice_captain: false,
      note: 'Derived from AFLDB home-and-away match statistics: 5 goals (coleman-derivation.json method_version 1)',
      status: 'active',
      status_reason: null,
      source_key: 'afltables',
      source_record_id: keyOf('A'),
      import_batch_id: null,
    });

    const [ledger] = await owner<{ id: number; correction: { workflow: string; actorUserId: number }; winners: Array<{ key: string }> }[]>`
      SELECT id::int AS id, correction, winners FROM derived_award_results WHERE award_slug = 'coleman'`;
    expect(ledger.id).toBe(outcome.id);
    expect(ledger.correction).toMatchObject({ workflow: 'derived_award_publication', actorUserId: actorId });

    const [projection] = await owner<{
      id: number; derived_award_result_id: number; changed_count: number; retained_count: number; projected_by: number;
      actions: Array<{ entityKey: string; action: string; awardWinnerId: number }>; correction: { note: string; evidenceRef: string };
    }[]>`SELECT id::int AS id, derived_award_result_id::int AS derived_award_result_id, changed_count, retained_count,
                projected_by::int AS projected_by, actions, correction FROM derived_award_projections`;
    expect(projection).toMatchObject({ id: outcome.projection.projectionId, derived_award_result_id: outcome.id, changed_count: 1, retained_count: 0, projected_by: actorId });
    expect(projection.actions).toEqual([{ entityKey: entityKeyOf('A'), action: 'inserted', awardWinnerId: rows[0].id }]);
    expect(projection.correction).toMatchObject({ note: NOTE, evidenceRef: `${MARKER}-evidence` });

    const edits = await owner<{ row_id: number; admin_user_id: number; note: string; old_values: object; new_values: Record<string, unknown> }[]>`
      SELECT row_id::int AS row_id, admin_user_id::int AS admin_user_id, note, old_values, new_values
        FROM data_edits WHERE table_name = 'award_winners' AND field_group = 'coleman_derived_publication'`;
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ row_id: rows[0].id, admin_user_id: actorId, note: NOTE, old_values: {} });
    expect(edits[0].new_values).toMatchObject({
      action: 'inserted',
      entity_key: entityKeyOf('A'),
      lineage_identity: `afltables|${keyOf('A')}`,
      derived_award_result_id: outcome.id,
      ledger_outcome: 'published',
      method_version: 1,
      derivation_version: COLEMAN_DERIVATION_VERSION,
      input_checksum: outcome.inputChecksum,
      evidence_ref: `${MARKER}-evidence`,
      note: 'Derived from AFLDB home-and-away match statistics: 5 goals (coleman-derivation.json method_version 1)',
    });

    const [award] = await owner<{ first_season: number; last_season: number }[]>`SELECT first_season, last_season FROM awards WHERE id = ${awardId}`;
    expect(award).toEqual({ first_season: SEASON, last_season: SEASON });
    expect(outcome.projection.revalidatePaths).toEqual(expect.arrayContaining([
      '/awards', '/awards/coleman', `/awards/coleman/${SEASON}`, `/seasons/${SEASON}`, '/sitemap.xml',
      `/players/${MARKER}-a-${playerIds.A}`, `/clubs/${MARKER}-club-0`,
    ]));
    // The /admin/awards/revalidate allowlist admits every path (the client posts them after success).
    for (const path of outcome.projection.revalidatePaths) expect(isAllowedRevalidatePath(path), path).toBe(true);
  });

  it('the preview reports the same effect without writing anything', async () => {
    const before = await totals();
    const input = await loadColemanDerivationInput(executor, {
      season: SEASON, settled: true, derivedAt: DERIVED_AT, registry: loadSeasonRegistry(), contract: loadColemanContract(),
    });
    const derived = deriveColeman(input);
    if (!derived.ok) throw new Error('fixture refused');
    const preview = await colemanAwardWinnerProjection.preview(executor, derived.result);
    expect(preview).toMatchObject({ ok: true, counts: { inserted: 1, updated: 0, voided: 0, retained: 0 }, changedCount: 1 });
    expect(await totals()).toEqual(before);
    // After publishing, the same preview says nothing would change.
    await publish();
    expect(await colemanAwardWinnerProjection.preview(executor, derived.result))
      .toMatchObject({ ok: true, counts: { inserted: 0, updated: 0, voided: 0, retained: 1 }, changedCount: 0 });
  });

  it('refuses to run outside the publisher\'s native transaction (projection_unavailable)', async () => {
    await expect(colemanAwardWinnerProjection.project(executor, {
      derivation: undefined as never, derivedAwardResultId: 1, ledgerOutcome: 'published',
      audit: { season: SEASON, workflow: 'derived_award_publication', actorUserId: actorId, note: NOTE, evidenceRef: 'x' }, publishedBy: actorId,
    })).rejects.toMatchObject({ code: 'projection_unavailable' });
    expect(nativeTransactionOf(executor)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * 2. Idempotency
 * ------------------------------------------------------------------ */

describe('rerunning a publication cannot duplicate winners (SYNTHETIC, PostgreSQL)', () => {
  it('a rerun leaves every table\'s row count unchanged and every winner retained, untouched', async () => {
    expectPublished(await publish());
    const before = await totals();
    const rowsBefore = await winnerRows();
    expect(before).toEqual({ winners: 1, ledger: 1, projections: 1, edits: 1 });

    const again = expectPublished(await publish());
    expect(again.outcome).toBe('unchanged');
    expect(again.projection).toMatchObject({ projectionId: null, changedCount: 0, counts: { inserted: 0, updated: 0, voided: 0, retained: 1 }, revalidatePaths: [] });
    expect(again.projection.actions).toEqual([{ entityKey: entityKeyOf('A'), action: 'retained', awardWinnerId: rowsBefore[0].id }]);

    expect(await totals()).toEqual(before); // award_winners, derived_award_results, derived_award_projections, data_edits
    expect(await winnerRows()).toEqual(rowsBefore); // including updated_at

    // ... and again, many times over.
    for (let run = 0; run < 3; run += 1) expect(expectPublished(await publish()).outcome).toBe('unchanged');
    expect(await totals()).toEqual(before);
  });

  it('joint winners: a four-way tie is four rows, inserted once, retained on every rerun', async () => {
    await setGoals('A', 'm1', 1); // A = 1 + 2 = 3; C = 3, E = 3, G = 3
    const first = expectPublished(await publish());
    expect(first.winnerKeys).toEqual(['A', 'C', 'E', 'G'].map((letter) => keyOf(letter as Letter)));
    expect(first.projection.counts).toEqual({ inserted: 4, updated: 0, voided: 0, retained: 0 });
    const rows = await winnerRows();
    expect(rows.map((row) => row.player_name_raw)).toEqual(['A', 'C', 'E', 'G'].map((letter) => nameOf(letter as Letter)));
    expect(rows.every((row) => row.note === colemanProjectionNote(3, 1))).toBe(true);

    const before = await totals();
    expect(before.winners).toBe(4);
    const again = expectPublished(await publish());
    expect(again.projection.counts).toEqual({ inserted: 0, updated: 0, voided: 0, retained: 4 });
    expect(await totals()).toEqual(before);
  });

  it('the unique key backs it: a second row with the same (source, key) is impossible', async () => {
    expectPublished(await publish());
    await expect(insertLoaderRow('A', 5)).rejects.toThrow(/award_winners_source_uq|duplicate key/);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Finals never count
 * ------------------------------------------------------------------ */

describe('finals statistics are excluded (SYNTHETIC, PostgreSQL)', () => {
  it('finals goals that would change the leader are ignored', async () => {
    await setGoals('C', 'f1', 50); // C: 3 home-and-away + 50 in the final
    const outcome = expectPublished(await publish());
    expect(outcome.winnerKeys).toEqual([keyOf('A')]);
    const rows = await winnerRows();
    expect(rows.map((row) => row.source_record_id)).toEqual([keyOf('A')]);
    expect(rows[0].note).toBe(colemanProjectionNote(5, 1));
  });
});

/* ------------------------------------------------------------------ *
 * 4. Refusals write nothing anywhere
 * ------------------------------------------------------------------ */

describe('incomplete, unsettled and unrecorded seasons are refused with no write (SYNTHETIC, PostgreSQL)', () => {
  it('an unsettled attestation', async () => {
    const before = await totals();
    const refusal = expectRefused(await publish({ settled: false }));
    expect(refusal).toMatchObject({ code: 'derivation_refused', derivation: { code: 'season_not_settled' } });
    expect(await totals()).toEqual(before);
    expect(before).toEqual({ winners: 0, ledger: 0, projections: 0, edits: 0 });
  });

  it('an unsealed (in-progress) season', async () => {
    const inProgress = loadSeasonRegistry().in_progress_seasons[0];
    const refusal = expectRefused(await publish({ season: inProgress }));
    expect(refusal).toMatchObject({ code: 'derivation_refused', derivation: { code: 'season_not_complete' } });
    expect(await totals()).toEqual({ winners: 0, ledger: 0, projections: 0, edits: 0 });
  });

  it('incomplete rounds (a club with no goal rows in a home-and-away match)', async () => {
    await owner`DELETE FROM player_match_stats WHERE match_id = ${matchIds.m2} AND club_id = ${clubIds[3]}`;
    try {
      const refusal = expectRefused(await publish());
      expect(refusal).toMatchObject({ code: 'derivation_refused', derivation: { code: 'incomplete_rounds' } });
      expect(await totals()).toEqual({ winners: 0, ledger: 0, projections: 0, edits: 0 });
    } finally {
      for (const letter of ['G', 'H'] as const) {
        await owner`INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
                    VALUES (${playerIds[letter]}, ${matchIds.m2}, ${clubIds[3]}, ${BASE_GOALS[`${letter}:m2`] ?? 0})`;
      }
    }
  });

  it('a NULL goal is "not recorded", never zero', async () => {
    await setGoals('A', 'm1', null);
    const refusal = expectRefused(await publish());
    expect(refusal).toMatchObject({ code: 'derivation_refused', derivation: { code: 'goals_not_recorded' } });
    expect(await totals()).toEqual({ winners: 0, ledger: 0, projections: 0, edits: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * 5. Transactional rollback
 * ------------------------------------------------------------------ */

describe('a refusal or failure mid-projection rolls the ledger back too (SYNTHETIC, PostgreSQL)', () => {
  it('a foreign manual Coleman row refuses with foreign_winner_rows and writes NOTHING (ledger row absent)', async () => {
    const [manual] = await owner<{ id: number }[]>`
      INSERT INTO award_winners (award_id, season, player_id, player_name_raw, link_status_value, club_id, status, source_id, source_record_id)
      VALUES (${awardId}, ${SEASON}, ${playerIds.B}, ${nameOf('B')}, 'resolved', ${clubIds[0]}, 'active',
              (SELECT id FROM sources WHERE key = 'manual_admin_edit'), ${`award_winner:${MARKER}-manual`})
      RETURNING id::int AS id`;
    const before = await totals();
    const refusal = expectRefused(await publish());
    expect(refusal.code).toBe('foreign_winner_rows');
    expect(refusal.subjects).toEqual([`#${manual.id} manual_admin_edit:award_winner:${MARKER}-manual`]);
    expect(await totals()).toEqual(before);
    expect(before).toEqual({ winners: 1, ledger: 0, projections: 0, edits: 0 }); // only the manual row; the ledger insert rolled back
  });

  it('a port that fails AFTER inserting leaves no ledger, projection, winner or audit row', async () => {
    const failing: ColemanProjectionPort = {
      async project(tx, request) {
        await colemanAwardWinnerProjection.project(tx, request); // inserts the winner, the audit row and the provenance row
        throw new Error('SYNTHETIC failure after the projection wrote');
      },
    };
    await expect(publish({ projection: failing })).rejects.toThrow('SYNTHETIC failure after the projection wrote');
    expect(await totals()).toEqual({ winners: 0, ledger: 0, projections: 0, edits: 0 });
    const [award] = await owner<{ first_season: number | null }[]>`SELECT first_season FROM awards WHERE id = ${awardId}`;
    expect(award.first_season).toBeNull(); // the span recompute rolled back too
  });

  it('a missing award definition refuses with award_definition_missing and writes nothing', async () => {
    await owner`UPDATE awards SET slug = 'coleman-it-renamed' WHERE id = ${awardId}`;
    try {
      const refusal = expectRefused(await publish());
      expect(refusal.code).toBe('award_definition_missing');
    } finally {
      await owner`UPDATE awards SET slug = 'coleman' WHERE id = ${awardId}`;
    }
    expect((await totals()).ledger).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Sealed season with pre-existing loader-identical rows: provenance only
 * ------------------------------------------------------------------ */

describe('a sealed season whose stored rows already equal the derivation (SYNTHETIC, PostgreSQL)', () => {
  it('records provenance only: the winner row is untouched, including updated_at', async () => {
    const id = await insertLoaderRow('A', 5);
    const rowsBefore = await winnerRows();
    expect(rowsBefore[0].updated_at).toMatch(/^2020-01-01/);

    const outcome = expectPublished(await publish());
    expect(outcome.outcome).toBe('published'); // the ledger row is new ...
    expect(outcome.projection).toMatchObject({ changedCount: 0, counts: { inserted: 0, updated: 0, voided: 0, retained: 1 }, revalidatePaths: [] });
    expect(outcome.projection.projectionId).not.toBeNull(); // ... and the first projection of it is recorded

    expect(await winnerRows()).toEqual(rowsBefore); // award_winners unchanged
    expect(await totals()).toEqual({ winners: 1, ledger: 1, projections: 1, edits: 0 });
    const [projection] = await owner<{ changed_count: number; retained_count: number; actions: Array<{ action: string; awardWinnerId: number }> }[]>`
      SELECT changed_count, retained_count, actions FROM derived_award_projections`;
    expect(projection).toMatchObject({ changed_count: 0, retained_count: 1 });
    expect(projection.actions).toEqual([{ entityKey: entityKeyOf('A'), action: 'retained', awardWinnerId: id }]);
  });
});

/* ------------------------------------------------------------------ *
 * 7. A corrected goal fact: audited correction and republishing
 * ------------------------------------------------------------------ */

describe('a corrected goal fact is an audited correction (SYNTHETIC, PostgreSQL)', () => {
  it('the same winner with a corrected total: superseded ledger row, the row is UPDATED (note), one audit row', async () => {
    const first = expectPublished(await publish());
    const [before] = await winnerRows();
    await setGoals('A', 'm1', 4); // A = 4 + 2 = 6, still the leader

    const outcome = expectPublished(await publish({ note: 'SYNTHETIC correction: a goal was re-attributed to the leader.' }));
    expect(outcome).toMatchObject({ outcome: 'superseded', supersededId: first.id });
    expect(outcome.projection.counts).toEqual({ inserted: 0, updated: 1, voided: 0, retained: 0 });

    const rows = await winnerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(before.id); // the row keeps its id
    expect(rows[0].note).toBe(colemanProjectionNote(6, 1));
    expect(rows[0].updated_at).not.toBe(before.updated_at);
    expect(await totals()).toEqual({ winners: 1, ledger: 2, projections: 2, edits: 2 });

    const [edit] = await owner<{ old_values: Record<string, unknown>; new_values: Record<string, unknown>; note: string }[]>`
      SELECT old_values, new_values, note FROM data_edits
       WHERE table_name = 'award_winners' AND field_group = 'coleman_derived_publication' ORDER BY id DESC LIMIT 1`;
    expect(edit.old_values).toMatchObject({ note: colemanProjectionNote(5, 1), status: 'active' });
    expect(edit.new_values).toMatchObject({ action: 'updated', changed_fields: ['note'], note: colemanProjectionNote(6, 1), ledger_outcome: 'superseded' });
    expect(edit.note).toBe('SYNTHETIC correction: a goal was re-attributed to the leader.');
  });

  it('a different winner: the old winner is VOIDED with a reason, the new winners are INSERTED, all audited; the unique key survives', async () => {
    expectPublished(await publish());
    await setGoals('A', 'm1', 0);
    await setGoals('A', 'm3', 0); // A = 0 -> C, E and G tie on 3

    const outcome = expectPublished(await publish());
    expect(outcome.outcome).toBe('superseded');
    expect(outcome.projection.counts).toEqual({ inserted: 3, updated: 0, voided: 1, retained: 0 });
    expect(outcome.projection.changedCount).toBe(4);

    const rows = await winnerRows();
    const a = rows.find((row) => row.source_record_id === keyOf('A'));
    expect(a).toMatchObject({ status: 'void' });
    expect(a?.status_reason).toContain('no longer supports this winner');
    expect(rows.filter((row) => row.status === 'active').map((row) => row.player_name_raw)).toEqual(['C', 'E', 'G'].map((l) => nameOf(l as Letter)));
    expect(await totals()).toEqual({ winners: 4, ledger: 2, projections: 2, edits: 5 });

    // The public award queries return only the active rows.
    const [award] = await owner<{ id: number }[]>`SELECT id::int AS id FROM awards WHERE slug = 'coleman'`;
    const season = await getAwardSeason(award.id, SEASON);
    expect(season.map((row) => row.playerName).sort()).toEqual(['C', 'E', 'G'].map((l) => nameOf(l as Letter)));

    // Rerunning is now idempotent again.
    const before = await totals();
    expect(expectPublished(await publish()).projection.counts).toEqual({ inserted: 0, updated: 0, voided: 0, retained: 3 });
    expect(await totals()).toEqual(before);
  });

  it('a derived key that is stored as a VOID row is refused (derived_row_voided); the others are not touched', async () => {
    expectPublished(await publish());
    await setGoals('A', 'm1', 0);
    await setGoals('A', 'm3', 0);
    expectPublished(await publish()); // A voided, C/E/G inserted
    await setGoals('A', 'm1', 3);
    await setGoals('A', 'm3', 2); // back to the original: A leads again, but A's row is void
    const before = await totals();
    const rowsBefore = await winnerRows();

    const refusal = expectRefused(await publish());
    expect(refusal.code).toBe('derived_row_voided');
    expect(refusal.subjects).toHaveLength(1);
    expect(refusal.subjects?.[0]).toContain(keyOf('A'));
    expect(await totals()).toEqual(before);
    expect(await winnerRows()).toEqual(rowsBefore);
  });
});

/* ------------------------------------------------------------------ *
 * 8. Administrator decisions are not overridden
 * ------------------------------------------------------------------ */

describe('administrator overrides and decisions stand in the way, not under the wheels (SYNTHETIC, PostgreSQL)', () => {
  it('a data_overrides row on a row publication would change -> admin_override_present, nothing written', async () => {
    expectPublished(await publish());
    await owner`
      INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
      VALUES ('award_winners', ${entityKeyOf('A')}, 'record', '{}'::jsonb, ${actorId}, true)`;
    await setGoals('A', 'm1', 4); // would move the note
    const before = await totals();
    const rowsBefore = await winnerRows();

    const refusal = expectRefused(await publish());
    expect(refusal.code).toBe('admin_override_present');
    expect(refusal.subjects).toEqual([expect.stringContaining(keyOf('A'))]);
    expect(await totals()).toEqual(before);
    expect(await winnerRows()).toEqual(rowsBefore);
  });

  it('an override on a row that would stay as it is is NOT a conflict (retained)', async () => {
    expectPublished(await publish());
    await owner`
      INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
      VALUES ('award_winners', ${entityKeyOf('A')}, 'record', '{}'::jsonb, ${actorId}, true)`;
    expect(expectPublished(await publish()).projection.counts).toEqual({ inserted: 0, updated: 0, voided: 0, retained: 1 });
  });

  it('a human player-link decision on the row counts as an override', async () => {
    expectPublished(await publish());
    const [row] = await winnerRows();
    await owner`
      INSERT INTO player_link_resolutions (target_table, target_id, action, player_id, previous_status, admin_user_id)
      VALUES ('award_winners', ${row.id}, 'linked', ${playerIds.A}, 'resolved', ${actorId})`;
    await setGoals('A', 'm1', 4);
    expect(expectRefused(await publish()).code).toBe('admin_override_present');
  });

  it('a row an administrator voided (derived_row_voided)', async () => {
    const id = await insertLoaderRow('A', 5, { status: 'void' });
    const refusal = expectRefused(await publish());
    expect(refusal.code).toBe('derived_row_voided');
    expect(refusal.subjects).toEqual([`#${id} afltables:${keyOf('A')}`]);
    expect((await totals()).ledger).toBe(0);
  });

  it('a legacy (draftguru) Coleman row of the season is foreign and is never adopted or voided', async () => {
    const [legacy] = await owner<{ id: number }[]>`
      INSERT INTO award_winners (award_id, season, player_id, player_name_raw, link_status_value, club_id, status, source_id, source_record_id)
      VALUES (${awardId}, ${SEASON}, ${playerIds.A}, ${nameOf('A')}, 'resolved', ${clubIds[0]}, 'active',
              (SELECT id FROM sources WHERE key = 'draftguru'), ${`legacy-${MARKER}`})
      RETURNING id::int AS id`;
    const refusal = expectRefused(await publish());
    expect(refusal.code).toBe('foreign_winner_rows');
    expect(refusal.subjects).toEqual([`#${legacy.id} draftguru:legacy-${MARKER}`]);
    expect((await winnerRows())[0]).toMatchObject({ id: legacy.id, status: 'active' });
  });
});

/* ------------------------------------------------------------------ *
 * 9. The public award queries
 * ------------------------------------------------------------------ */

describe('the public award queries return the published rows (SYNTHETIC, PostgreSQL)', () => {
  it('getAwardSeason / getAwardWinners / getAwardSeasons / listAwards read the projection', async () => {
    await setGoals('A', 'm1', 1); // a four-way tie
    expectPublished(await publish());
    const [award] = await owner<{ id: number }[]>`SELECT id::int AS id FROM awards WHERE slug = 'coleman'`;

    const season = await getAwardSeason(award.id, SEASON);
    expect(season).toHaveLength(4);
    expect(season.map((row) => row.playerName).sort()).toEqual(['A', 'C', 'E', 'G'].map((l) => nameOf(l as Letter)));
    expect(season.every((row) => row.linkStatus === 'resolved' && row.votes === null && row.note === colemanProjectionNote(3, 1))).toBe(true);
    expect(season.find((row) => row.playerName === nameOf('A'))).toMatchObject({
      playerId: playerIds.A, playerSlug: `${MARKER}-a`, clubId: clubIds[0], clubSlug: `${MARKER}-club-0`,
    });

    expect((await getAwardWinners(award.id)).filter((row) => row.season === SEASON)).toHaveLength(4);
    expect(await getAwardSeasons(award.id)).toContain(SEASON);
    const summary = (await listAwards()).find((row) => row.slug === 'coleman');
    expect(summary).toMatchObject({ firstSeason: SEASON, lastSeason: SEASON, winnerCount: 4, seasonCount: 1 });
  });
});

/* ------------------------------------------------------------------ *
 * 10. Loader parity (review F-003, test 2): the REAL offline loader agrees with the projection
 * ------------------------------------------------------------------ */

const root = process.cwd();
const venvPython = join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
const python = process.env.AFLDB_TEST_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));
const canRunLoader = (() => {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
})();

describe('the offline loader (tools/migration/import_awards.py --groups coleman) agrees with the projection (SYNTHETIC, PostgreSQL)', () => {
  // The loader needs Python with psycopg. Where it is missing this block is skipped and the gap is
  // reported by the suite's runner; it is never counted as passing evidence.
  const loaderTest = it;

  function runLoader() {
    if (!canRunLoader) throw new Error('Offline Coleman verification requires AFLDB_TEST_PYTHON with psycopg');
    return spawnSync(python, [join(root, 'legacy', 'offline', 'coleman.py'), '--groups', 'coleman'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AFLDB_IMPORT_DATABASE_URL: process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? process.env.AFLDB_TEST_DATABASE_URL },
    });
  }

  /** The loader's own column tuple of every Coleman row, keyed by its source key (import_batch_id aside). */
  async function tuples() {
    return (await winnerRows()).map((row) => {
      const copy: Partial<WinnerRow> = { ...row };
      delete copy.import_batch_id;
      return copy;
    });
  }

  loaderTest('after a canonical publication the offline loader refuses and preserves every tuple', async () => {
    await setGoals('A', 'm1', 1); // a four-way tie: several rows, not just one
    const published = expectPublished(await publish());
    expect(published.projection.counts.inserted).toBe(4);
    const before = await tuples();

    const run = runLoader();
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status, output).not.toBe(0);
    expect(output).toContain('canonical publications exist; use the V2 publisher');
    expect(await tuples()).toEqual(before);

    // And the projection finds nothing to do afterwards.
    const afterLoader = expectPublished(await publish());
    expect(afterLoader.projection.counts).toEqual({ inserted: 0, updated: 0, voided: 0, retained: 4 });
  });

  loaderTest('a loader-written season is what the projection retains (no row of either writer is rewritten by the other)', async () => {
    const run = runLoader();
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(await tuples()).toHaveLength(1);
    const rows = await winnerRows();
    expect(rows[0].import_batch_id).not.toBeNull(); // written by the loader
    const outcome = expectPublished(await publish());
    expect(outcome.projection.counts).toEqual({ inserted: 0, updated: 0, voided: 0, retained: 1 });
    expect(outcome.projection.changedCount).toBe(0);
    expect((await winnerRows())[0]).toEqual(rows[0]);
  });
});
