/**
 * AFLDB-ISSUE-235 — the ONE ownership definition for every ISSUE-235 fixture on `afldb_test`
 * (S6, I1, I14, I18): the namespace literals and anchored patterns, the reference-row lookup,
 * the S6 and I14 teardowns, the ledger-isolation precondition and the leftover gate.
 *
 * SERVER-NEUTRAL BY CONTRACT. This module imports only the `postgres` types and the I18 fixture's
 * literals. It must never import `@/db/*`, a `server-only` module or anything that does:
 * `tools/migration/afl_api_adjudication_i18_fixture.ts teardown` loads it under plain `tsx`
 * (no `--conditions=react-server`), where `server-only` throws. The seeding and form rendering
 * that DO need the real query module stay in `./afl-api-adjudication-fixtures.ts`, which
 * re-exports everything here. (`tests/db-test-rebuild.test.ts` pins the boundary.)
 *
 * The full ownership rules are documented at the head of `./afl-api-adjudication-fixtures.ts`.
 */
import type postgres from 'postgres';

import { I18_FIXTURE } from '../../tools/migration/afl_api_adjudication_i18_fixture';

type Db = postgres.Sql | postgres.TransactionSql;

/* ------------------------------------------------------------------ *
 * Namespace
 * ------------------------------------------------------------------ */

/** I1 (`settle-afl-api.test.ts`): migration 104's one-provider-per-player index. */
export const I1_FIXTURE = {
  legacyPlayerId: -235000001,
  providerA: 'CD_I9990000001',
  providerB: 'CD_I9990000002',
  afltablesId: 'players/Z/Issue235-I1-test.html',
} as const;

/** I14 (`settle-afl-api.test.ts`): the D15 replay. */
export const I14_FIXTURE = {
  legacyPlayerIdA: -235140001,
  legacyPlayerIdB: -235140002,
  afltablesIdA: 'players/Z/Issue235-I14-test-a.html',
  afltablesIdB: 'players/Z/Issue235-I14-test-b.html',
  providerLinked: 'CD_I9991400001',
  providerRevoked: 'CD_I9991400002',
  /**
   * I14's own ledger actor: suite-created, super_admin, disabled, no credentials. A rebuilt
   * `afldb_test` legitimately has ZERO `auth_users` rows, so I14 never borrows an existing one.
   */
  actorEmail: 'issue235-i14-fixture@example.test',
} as const;

/**
 * I14's net-linked ledger row: numeric-id reuse across a destructive rebuild. The stored
 * `player_id` is VALID (migration 104's `REFERENCES players(id)` holds) but WRONG — it names
 * player B — while the durable `player_identity` names player A. A replay that re-derives from
 * the identity links player A; one that trusted the column would link player B.
 */
export function i14StaleLedgerRow(input: { playerIdA: number; playerIdB: number }): {
  playerId: number; playerIdentity: string;
} {
  if (input.playerIdA === input.playerIdB) throw new Error('I14 needs two distinct fixture players.');
  return { playerId: input.playerIdB, playerIdentity: I14_FIXTURE.afltablesIdA };
}

/** The S6 cases' own ids; `s6ProviderId()`/`s6MatchId()`/`seedS6Player()` build from these. */
export const S6_PROVIDER_PREFIX = 'CD_I999235';
export const S6_MATCH_PREFIX = 'CD_M999235';
/** The S6 fixture players: exactly the image of `seedS6Player()` keys 1…9999. */
export const S6_LEGACY_ID_RANGE = { min: -235209999, max: -235200001 } as const;
export const S6_AFLTABLES_PREFIX = 'players/Z/Issue235-S6-';
/**
 * Anchored, whole-string patterns (identical in JS `RegExp` and PostgreSQL `~`): exactly the
 * ids `s6ProviderId()`, `s6MatchId()` and `seedS6Player()` can produce. The match pattern also
 * accepts an S6 match id as the leading `|` segment of a spine record id.
 */
export const S6_PROVIDER_ID_PATTERN = '^CD_I999235[0-9]{4}$';
export const S6_MATCH_RECORD_PATTERN = '^CD_M999235[0-9]{4}(\\||$)';
export const S6_AFLTABLES_ID_PATTERN = '^players/Z/Issue235-S6-[0-9]{1,4}\\.html$';
export const S6_ACTOR_EMAIL = 'issue235-s6-fixture@example.test';
export const S6_FIXTURE_TOOL = 'issue235-s6-fixture';
export const S6_HASH_RECIPE = 'issue235-s6-fixture:sha256';
export const S6_SEASON = 2026;
/** OD-4: 20–2000 characters, stating the non-name evidence relied on. */
export const S6_NOTE = 'AFLDB-ISSUE-235 S6 fixture: same match, same club, same jumper number.';

function s6Key(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('S6 fixture key must be 1…9999.');
  return String(n).padStart(4, '0');
}

export function s6ProviderId(n: number): string {
  return `${S6_PROVIDER_PREFIX}${s6Key(n)}`;
}

export function s6MatchId(n: number): string {
  return `${S6_MATCH_PREFIX}${s6Key(n)}`;
}

/**
 * One fixture-ownership definition. A row is owned when its id is one of the literal ids OR
 * matches the anchored pattern; a player when its legacy id is literal OR in the range.
 */
export type FixtureOwnership = {
  providerIds: readonly string[];
  providerIdPattern: string;
  legacyPlayerIds: readonly number[];
  legacyPlayerIdRange: { min: number; max: number };
  afltablesIds: readonly string[];
  afltablesIdPattern: string;
};

/** What `cleanupS6Fixtures()` removes. */
export const S6_OWNERSHIP: FixtureOwnership = {
  providerIds: [],
  providerIdPattern: S6_PROVIDER_ID_PATTERN,
  legacyPlayerIds: [],
  legacyPlayerIdRange: S6_LEGACY_ID_RANGE,
  afltablesIds: [],
  afltablesIdPattern: S6_AFLTABLES_ID_PATTERN,
};

/**
 * What the leftover gate counts: S6 plus I1's, I14's and I18's literal ids (each has its own
 * teardown). I18 owns no player: its baseline player is a real, rebuilt one.
 */
export const ISSUE235_OWNERSHIP: FixtureOwnership = {
  providerIds: [I1_FIXTURE.providerA, I1_FIXTURE.providerB, I14_FIXTURE.providerLinked, I14_FIXTURE.providerRevoked,
    I18_FIXTURE.providerId],
  providerIdPattern: S6_PROVIDER_ID_PATTERN,
  legacyPlayerIds: [I1_FIXTURE.legacyPlayerId, I14_FIXTURE.legacyPlayerIdA, I14_FIXTURE.legacyPlayerIdB],
  legacyPlayerIdRange: S6_LEGACY_ID_RANGE,
  afltablesIds: [I1_FIXTURE.afltablesId, I14_FIXTURE.afltablesIdA, I14_FIXTURE.afltablesIdB],
  afltablesIdPattern: S6_AFLTABLES_ID_PATTERN,
};

export function ownsProviderId(o: FixtureOwnership, id: string): boolean {
  return o.providerIds.includes(id) || new RegExp(o.providerIdPattern).test(id);
}

export function ownsLegacyPlayerId(o: FixtureOwnership, legacyId: number): boolean {
  return o.legacyPlayerIds.includes(legacyId)
    || (legacyId >= o.legacyPlayerIdRange.min && legacyId <= o.legacyPlayerIdRange.max);
}

export function ownsAfltablesId(o: FixtureOwnership, id: string): boolean {
  return o.afltablesIds.includes(id) || new RegExp(o.afltablesIdPattern).test(id);
}

export function isS6MatchRecordId(id: string): boolean {
  return new RegExp(S6_MATCH_RECORD_PATTERN).test(id);
}

/* The same definition as SQL. `expr` is a fixed column expression fragment, never input. */

function ownedProviderSql(db: Db, o: FixtureOwnership, expr: postgres.Fragment): postgres.Fragment {
  return db`(${expr} = ANY(${o.providerIds as string[]}::text[]) OR ${expr} ~ ${o.providerIdPattern})`;
}

function ownedAfltablesSql(db: Db, o: FixtureOwnership, expr: postgres.Fragment): postgres.Fragment {
  return db`(${expr} = ANY(${o.afltablesIds as string[]}::text[]) OR ${expr} ~ ${o.afltablesIdPattern})`;
}

function ownedPlayersSql(db: Db, o: FixtureOwnership): postgres.Fragment {
  return db`
    SELECT id FROM players
     WHERE legacy_player_id = ANY(${o.legacyPlayerIds as number[]}::int[])
        OR legacy_player_id BETWEEN ${o.legacyPlayerIdRange.min} AND ${o.legacyPlayerIdRange.max}
  `;
}

function s6MatchRecordSql(db: Db, expr: postgres.Fragment): postgres.Fragment {
  return db`${expr} ~ ${S6_MATCH_RECORD_PATTERN}`;
}

/* ------------------------------------------------------------------ *
 * Reference rows (read, never written)
 * ------------------------------------------------------------------ */

export type S6Refs = {
  aflApiSourceId: number;
  afltablesSourceId: number;
  /** `null` only on a database without migration 057's row; the one case that needs it refuses. */
  manualAdminEditSourceId: number | null;
};

export async function loadS6Refs(db: Db): Promise<S6Refs> {
  const rows = await db<{ key: string; id: number }[]>`
    SELECT key, id FROM sources WHERE key IN ('afl_api', 'afltables', 'manual_admin_edit')
  `;
  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  const aflApiSourceId = byKey.get('afl_api');
  const afltablesSourceId = byKey.get('afltables');
  if (aflApiSourceId === undefined || afltablesSourceId === undefined) {
    throw new Error("sources 'afl_api' (migration 077) and 'afltables' must both exist on afldb_test.");
  }
  return { aflApiSourceId, afltablesSourceId, manualAdminEditSourceId: byKey.get('manual_admin_edit') ?? null };
}

/* ------------------------------------------------------------------ *
 * Isolation preconditions for ledger-global code
 * ------------------------------------------------------------------ */

/**
 * `replayAflApiAdjudications()`, the bijection check and `readLedger()` read the WHOLE
 * ledger. Their exact-count assertions are only meaningful if every ledger row, and every
 * human `afl_api` identity, on `afldb_test` is an ISSUE-235 fixture row (`ISSUE235_OWNERSHIP`;
 * a real `CD_I999xxx` provider is NOT one). This refuses — it never deletes a foreign row —
 * when that is not so. A seeded I18 fixture also refuses: it is ownership-counted, but it lives
 * across a rebuild and would break S6's exact ledger-global counts; `teardown` it first.
 */
export async function assertS6LedgerIsolated(db: Db, refs: S6Refs): Promise<void> {
  const [ledger] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM afl_api_identity_adjudications
     WHERE NOT ${ownedProviderSql(db, ISSUE235_OWNERSHIP, db`external_id`)}
        OR external_id = ${I18_FIXTURE.providerId}
  `;
  const [human] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM external_identities
     WHERE source_id = ${refs.aflApiSourceId} AND status = 'resolved'
       AND match_method = 'afl_api_admin_adjudication'
       AND (NOT ${ownedProviderSql(db, ISSUE235_OWNERSHIP, db`external_id`)}
            OR external_id = ${I18_FIXTURE.providerId})
  `;
  if (ledger.n !== 0 || human.n !== 0) {
    throw new Error(
      `ISSUE-235 S6 precondition: afldb_test holds ${ledger.n} non-S6 adjudication row(s) and `
      + `${human.n} non-S6 human afl_api identity row(s) (an I18 fixture counts: run its teardown). `
      + 'The ledger-global replay/recovery assertions need both at 0. Nothing was deleted; reconcile by hand.');
  }
}

/* ------------------------------------------------------------------ *
 * Teardown and the leftover gate
 * ------------------------------------------------------------------ */

/**
 * Remove every S6 fixture row (`S6_OWNERSHIP`), and nothing else, child-to-parent, as the
 * owner. Idempotent, so it runs before setup as well as after every case.
 */
export async function cleanupS6Fixtures(db: Db, refs: S6Refs): Promise<void> {
  const players = ownedPlayersSql(db, S6_OWNERSHIP);
  const actor = db`SELECT id FROM auth_users WHERE lower(email) = ${S6_ACTOR_EMAIL}`;

  // One statement, so a revoked row and the linked row it supersedes go together.
  await db`
    DELETE FROM afl_api_identity_adjudications
     WHERE ${ownedProviderSql(db, S6_OWNERSHIP, db`external_id`)}
        OR admin_user_id IN (${actor})
        OR player_id IN (${players})
  `;
  await db`
    DELETE FROM brownlow_round_votes
     WHERE player_id IN (${players}) OR ${s6MatchRecordSql(db, db`source_record_id`)}
  `;
  await db`DELETE FROM player_height_evidence WHERE player_id IN (${players})`;
  await db`DELETE FROM canonical_applications WHERE ${s6MatchRecordSql(db, db`external_record_id`)}`;
  await db`DELETE FROM promotion_candidates WHERE ${s6MatchRecordSql(db, db`external_record_id`)}`;
  // Settle-written rows naming an S6 player (the I2/I5 lifecycle case). The settle suite's own
  // cleanup() removes the rest of that case's rows by its CD_M2026ISSUE228 namespace, but it
  // cannot delete its matches while player_clubs (RESTRICT on first/last_match_id) or any
  // player FK still names an S6 player.
  await db`DELETE FROM staging.afl_api_player_match WHERE player_id IN (${players})`;
  await db`DELETE FROM player_match_stats WHERE player_id IN (${players})`;
  await db`DELETE FROM player_clubs WHERE player_id IN (${players})`;
  await db`DELETE FROM player_season_stats WHERE player_id IN (${players})`;
  await db`DELETE FROM player_career_stats WHERE player_id IN (${players})`;
  await db`
    DELETE FROM staging.source_records
     WHERE source_id = ${refs.aflApiSourceId} AND ${s6MatchRecordSql(db, db`external_record_id`)}
  `;
  await db`
    DELETE FROM staging.source_record_versions
     WHERE source_id = ${refs.aflApiSourceId} AND ${s6MatchRecordSql(db, db`external_record_id`)}
  `;
  await db`DELETE FROM staging.source_payloads WHERE hash_recipe = ${S6_HASH_RECIPE}`;
  await db`DELETE FROM import_batches WHERE tool = ${S6_FIXTURE_TOOL}`;
  await db`
    DELETE FROM external_identities
     WHERE (source_id = ${refs.aflApiSourceId} AND ${ownedProviderSql(db, S6_OWNERSHIP, db`external_id`)})
        OR ${ownedAfltablesSql(db, S6_OWNERSHIP, db`external_id`)}
        OR player_id IN (${players})
  `;
  await db`DELETE FROM players WHERE id IN (${players})`;
  await db`DELETE FROM auth_users WHERE lower(email) = ${S6_ACTOR_EMAIL}`;
}

/**
 * I14's ledger actor: super_admin, disabled, no credentials, the exact `@example.test` email.
 * Always suite-created — a freshly rebuilt `afldb_test` has no `auth_users` rows at all, and a
 * borrowed human or I18 actor would make I14 depend on, and write audit rows against, state it
 * does not own. `cleanupI14Fixtures()` runs first, so a leftover is removed, never reused.
 */
export async function seedI14Actor(db: Db): Promise<number> {
  const [row] = await db<{ id: number }[]>`
    INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
    VALUES (${I14_FIXTURE.actorEmail}, 'super_admin', NULL, NULL, now())
    RETURNING id
  `;
  return row.id;
}

/**
 * Remove every I14 fixture row, and nothing else, child-to-parent, as the owner. Selects by
 * I14's literal ids ONLY — the source ids are resolved inside the statements — so it needs no
 * value from setup and is safe after a `beforeAll` that failed part-way (or never ran).
 * Idempotent, so it runs before setup as well as after.
 */
export async function cleanupI14Fixtures(db: Db): Promise<void> {
  const f = I14_FIXTURE;
  const actor = db`SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail}`;
  const players = db`SELECT id FROM players WHERE legacy_player_id IN (${f.legacyPlayerIdA}, ${f.legacyPlayerIdB})`;
  // One statement, so a revoked row and the linked row it supersedes go together.
  await db`
    DELETE FROM afl_api_identity_adjudications
     WHERE (source_key = 'afl_api' AND external_id IN (${f.providerLinked}, ${f.providerRevoked}))
        OR admin_user_id IN (${actor})
        OR player_id IN (${players})
  `;
  await db`
    DELETE FROM external_identities
     WHERE (source_id = (SELECT id FROM sources WHERE key = 'afl_api')
            AND external_id IN (${f.providerLinked}, ${f.providerRevoked}))
        OR (source_id = (SELECT id FROM sources WHERE key = 'afltables')
            AND external_id IN (${f.afltablesIdA}, ${f.afltablesIdB}))
  `;
  await db`DELETE FROM players WHERE legacy_player_id IN (${f.legacyPlayerIdA}, ${f.legacyPlayerIdB})`;
  await db`DELETE FROM auth_users WHERE lower(email) = ${f.actorEmail}`;
}

export type Issue235Residue = {
  adjudications: number;
  aflApiIdentities: number;
  afltablesIdentities: number;
  players: number;
  pendingCandidates: number;
  fixtureCandidates: number;
  dependentRows: number;
  canonicalApplications: number;
  spineRows: number;
  importBatches: number;
  actors: number;
};

export const ZERO_ISSUE235_RESIDUE: Issue235Residue = {
  adjudications: 0, aflApiIdentities: 0, afltablesIdentities: 0, players: 0, pendingCandidates: 0,
  fixtureCandidates: 0, dependentRows: 0, canonicalApplications: 0, spineRows: 0, importBatches: 0, actors: 0,
};

/**
 * The S6 leftover gate: every ISSUE-235 fixture row (`ISSUE235_OWNERSHIP`: S6, I1, I14 and I18)
 * that could survive an interrupted run. All zero after a clean run. It counts ONLY rows that
 * ownership proves are fixture rows; a real `afldb_test` row is never residue. Every fixture
 * actor (S6's, I14's and I18's, each suite-created) is counted by its exact email. I18's spine
 * record, payload recipe and batch tool ARE counted, by their exact literals; its baseline
 * player is real and never counted.
 */
export async function issue235FixtureResidue(db: Db, refs: S6Refs): Promise<Issue235Residue> {
  const o = ISSUE235_OWNERSHIP;
  const players = ownedPlayersSql(db, o);
  const actors = db`
    SELECT id FROM auth_users
     WHERE lower(email) IN (${S6_ACTOR_EMAIL}, ${I14_FIXTURE.actorEmail}, ${I18_FIXTURE.actorEmail})
  `;
  const [row] = await db<Issue235Residue[]>`
    SELECT
      (SELECT count(*)::int FROM afl_api_identity_adjudications
        WHERE ${ownedProviderSql(db, o, db`external_id`)}
           OR admin_user_id IN (${actors})) AS "adjudications",
      (SELECT count(*)::int FROM external_identities
        WHERE source_id = ${refs.aflApiSourceId} AND ${ownedProviderSql(db, o, db`external_id`)}) AS "aflApiIdentities",
      (SELECT count(*)::int FROM external_identities
        WHERE ${ownedAfltablesSql(db, o, db`external_id`)}) AS "afltablesIdentities",
      (SELECT count(*)::int FROM players WHERE id IN (${players})) AS "players",
      (SELECT count(*)::int FROM promotion_candidates
        WHERE source_id = ${refs.aflApiSourceId} AND status = 'pending'
          AND ${ownedProviderSql(db, o, db`split_part(external_record_id, '|', 3)`)}) AS "pendingCandidates",
      (SELECT count(*)::int FROM promotion_candidates
        WHERE ${s6MatchRecordSql(db, db`external_record_id`)}
           OR external_record_id = ${I18_FIXTURE.externalRecordId}) AS "fixtureCandidates",
      ((SELECT count(*)::int FROM player_match_stats WHERE player_id IN (${players}))
       + (SELECT count(*)::int FROM brownlow_round_votes
           WHERE player_id IN (${players}) OR ${s6MatchRecordSql(db, db`source_record_id`)})
       + (SELECT count(*)::int FROM player_height_evidence WHERE player_id IN (${players}))
       + (SELECT count(*)::int FROM staging.afl_api_player_match
           WHERE player_id IN (${players}) OR ${ownedProviderSql(db, o, db`provider_player_id`)})
       + (SELECT count(*)::int FROM player_clubs WHERE player_id IN (${players}))) AS "dependentRows",
      (SELECT count(*)::int FROM canonical_applications ca
        WHERE ${s6MatchRecordSql(db, db`ca.external_record_id`)}
           OR EXISTS (SELECT 1 FROM unnest(string_to_array(ca.external_record_id, '|')) AS seg(v)
                       WHERE ${ownedProviderSql(db, o, db`seg.v`)})) AS "canonicalApplications",
      ((SELECT count(*)::int FROM staging.source_record_versions
         WHERE ${s6MatchRecordSql(db, db`external_record_id`)}
            OR external_record_id = ${I18_FIXTURE.externalRecordId})
       + (SELECT count(*)::int FROM staging.source_payloads
           WHERE hash_recipe IN (${S6_HASH_RECIPE}, ${I18_FIXTURE.hashRecipe}))) AS "spineRows",
      (SELECT count(*)::int FROM import_batches
        WHERE tool IN (${S6_FIXTURE_TOOL}, ${I18_FIXTURE.tool})) AS "importBatches",
      (SELECT count(*)::int FROM (${actors}) a) AS "actors"
  `;
  return row;
}
