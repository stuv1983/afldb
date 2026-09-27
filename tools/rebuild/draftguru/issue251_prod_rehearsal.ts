/**
 * AFLDB-ISSUE-251 — isolated rehearsal of the PROD adoption write, against the disposable
 * full-rebuild rehearsal database `code_test_db`, NEVER against `afldb_prod` and NEVER against
 * the retained failed candidate `afldb_prod_candidate_20260926-213225`.
 *
 *     npm run db:code-test:issue251-rehearsal -- seed
 *     npm run db:code-test:issue251-rehearsal -- classify
 *     npm run db:code-test:issue251-rehearsal -- apply
 *     npm run db:code-test:issue251-rehearsal -- verify
 *     npm run db:code-test:issue251-rehearsal -- teardown
 *     npm run db:code-test:issue251-rehearsal -- residue
 *
 * (`--conditions=react-server` is required in the package script: this loads the real
 * `server-only` canonical primitives, exactly as `register_issue224_s9_players.ts` does.)
 *
 * WHAT IT PROVES. `apply` calls `runProdAdoptionWrite` — the EXACT function
 * `register_issue224_s9_players.ts`'s PROD branch calls inside `sql.begin()` — against a
 * database whose starting state represents what the current PROD relationship to the 92 ISSUE-224
 * paths actually is: none of the 92 registrations present, none of the 92 AFL Tables paths
 * present, real schema/migrations (`code_test_db` is migrated exactly like `afldb_test`). `seed`
 * refuses if either is untrue, so a stale rehearsal database can never silently pass. This
 * exercises the real mutation code — the same canonical primitives, the same shared postcondition
 * battery, the same PROD-only `assertNoAflApiIdentityWritten` proof — without going through
 * `resolveProdTarget()`, which hard-refuses any database name other than `afldb_prod` by design.
 *
 * TARGET. `code_test_db` ONLY, through `AFLDB_CODE_TEST_DATABASE_URL` (owner — actor
 * provisioning and the baseline/teardown checks) and `AFLDB_CODE_TEST_IMPORT_DATABASE_URL`
 * (`afldb_import` — the write, matching the role PROD actually writes as). No other variable
 * names a target here, and the target is never inferred: both DSNs must NAME `code_test_db`.
 *
 * ACTOR. `seed` mints ONE real, viable, enabled, fully-enrolled `super_admin` under a namespaced,
 * deliberately NON-reserved-domain email (`afldb-issue251-rehearsal@rehearsal.afldb.internal` —
 * NOT a `.test`/`.example`/`.invalid`/`.localhost`/`example.com`/`.net`/`.org` address, because
 * migration 105's `assert_viable_super_admin_actor()` now refuses exactly those inside the write
 * transaction `apply` exercises, and this actor must pass that call for the rehearsal to prove
 * anything), using the app's own `hashPassword` / `generateTotpSecret` (`src/lib/auth/crypto.ts`)
 * — the SAME primitives `tools/admin/create-admin.ts` uses to mint a real administrator. This is
 * deliberately NOT `insertAttributionOnlyActor` (`tools/migration/rebuild_manual_registrations.ts`),
 * which always writes a disabled, credential-less row — the opposite of what PROD adoption
 * requires and refuses (`assertViableProdActor`, and now also `assert_viable_super_admin_actor()`
 * inside the write transaction). Nothing about the password or secret is ever printed.
 *
 * TEARDOWN. Deletes only the exact 92 target-set AFL Tables paths' `external_identities` +
 * `players` + `data_overrides` rows and the one namespaced rehearsal actor. `residue` counts the
 * whole namespace so a partial teardown is visible rather than silently accepted.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { generateTotpSecret, hashPassword } from '@/lib/auth/crypto';

import {
  loadAndValidateArtefacts, loadPinnedProdNameParts, runProdAdoptionWrite, type ProdActorRow,
  type Target,
} from './register_issue224_s9_players';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const TARGET_SET = join(REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru', 'issue224-s9-target-set-20260922.json');
const DECISION = join(REPO_ROOT, 'docs', 'rebuild-manifests', 'draftguru', 'issue224-d7-registration-decision-20260922.json');

// NOT a reserved fixture domain (AFLDB-ISSUE-251 finding): migration 105's
// assert_viable_super_admin_actor() now refuses '.test'/'.example'/'.invalid'/'.localhost' and
// 'example.com'/'.net'/'.org' addresses inside the SAME transaction runProdAdoptionWrite calls,
// and this rehearsal actor must pass that call to exercise the real write path. A `.invalid`
// address (the previous value here) would now be refused as a fixture actor, which is correct
// behaviour but would make this harness untestable — so the rehearsal-only actor lives at a
// clearly-namespaced, non-reserved domain instead.
const REHEARSAL_ACTOR_EMAIL = 'afldb-issue251-rehearsal@rehearsal.afldb.internal';
const REHEARSAL_DATABASE = 'code_test_db';

class RehearsalRefused extends Error {}

function requireCodeTestDsn(envVar: string): string {
  const dsn = process.env[envVar];
  if (!dsn) throw new RehearsalRefused(`${envVar} is not set.`);
  const path = new URL(dsn).pathname.replace(/^\//, '');
  if (path !== REHEARSAL_DATABASE) {
    throw new RehearsalRefused(`${envVar} does not target /${REHEARSAL_DATABASE} (observed /${path}).`);
  }
  return dsn;
}

async function assertConnectedTo(sql: postgres.Sql, expectedUser?: string): Promise<void> {
  const [row] = await sql<{ database: string; currentUser: string }[]>`
    SELECT current_database() AS "database", current_user AS "currentUser"
  `;
  if (row.database !== REHEARSAL_DATABASE) {
    throw new RehearsalRefused(`connected database is '${row.database}', expected '${REHEARSAL_DATABASE}'.`);
  }
  if (expectedUser !== undefined && row.currentUser !== expectedUser) {
    throw new RehearsalRefused(`connected user is '${row.currentUser}', expected '${expectedUser}'.`);
  }
}

function loadTargets(): Target[] {
  return loadAndValidateArtefacts(TARGET_SET, DECISION, loadPinnedProdNameParts());
}

async function seed(): Promise<void> {
  const ownerDsn = requireCodeTestDsn('AFLDB_CODE_TEST_DATABASE_URL');
  const targets = loadTargets();
  const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
  try {
    await assertConnectedTo(sql);

    const paths = targets.map((t) => t.profilePath);
    const [{ count: existingPaths }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afltables' AND e.external_id = ANY(${paths})
    `;
    if (Number(existingPaths) !== 0) {
      throw new RehearsalRefused(
        `${existingPaths} of the 92 pinned AFL Tables path(s) already exist on '${REHEARSAL_DATABASE}'. `
        + 'seed requires a database representing the current PROD relationship to this cohort: '
        + 'none of the 92 paths present. Run teardown first, or use a freshly rebuilt database.',
      );
    }

    const [existingActor] = await sql<{ id: number }[]>`
      SELECT id FROM auth_users WHERE lower(email) = ${REHEARSAL_ACTOR_EMAIL}
    `;
    if (existingActor) {
      throw new RehearsalRefused(
        `the rehearsal actor ${REHEARSAL_ACTOR_EMAIL} already exists (id ${existingActor.id}). `
        + 'Run teardown first.',
      );
    }

    const passwordHash = await hashPassword(`rehearsal-only-${Date.now()}-${Math.random()}`);
    const totpSecret = generateTotpSecret();
    const [actor] = await sql<{ id: number }[]>`
      INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
      VALUES (${REHEARSAL_ACTOR_EMAIL}, 'super_admin', ${passwordHash}, ${totpSecret}, NULL)
      RETURNING id
    `;
    console.log(
      `Seeded: ${targets.length} target(s) confirmed absent; rehearsal actor admin_user_id=${actor.id} `
      + `(enabled, super_admin, password+TOTP enrolled). Nothing else was written.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function fetchRehearsalActor(sql: postgres.Sql): Promise<ProdActorRow> {
  const [actor] = await sql<ProdActorRow[]>`
    SELECT id, role,
           (disabled_at IS NULL) AS "isActive",
           (password_hash IS NOT NULL) AS "hasPassword",
           (totp_secret IS NOT NULL) AS "hasTotp"
      FROM auth_users WHERE lower(email) = ${REHEARSAL_ACTOR_EMAIL}
  `;
  if (!actor) {
    throw new RehearsalRefused(`no rehearsal actor ${REHEARSAL_ACTOR_EMAIL} found. Run seed first.`);
  }
  return actor;
}

async function classify(): Promise<void> {
  const importDsn = requireCodeTestDsn('AFLDB_CODE_TEST_IMPORT_DATABASE_URL');
  const targets = loadTargets();
  const sql = postgres(importDsn, { max: 1, onnotice: () => {} });
  try {
    await assertConnectedTo(sql, 'afldb_import');
    // Re-import here (not at module scope) so this file never pulls the classify() internals
    // out of register_issue224_s9_players.ts as a second implementation; it is not exported
    // because it is an implementation detail of that module's own CLI, so this rehearsal instead
    // proves the SAME shape indirectly via runProdAdoptionWrite's own internal classification
    // during `apply`, and via a plain external_identities count here for a fast read-only check.
    const paths = targets.map((t) => t.profilePath);
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afltables' AND e.match_method = 'afltables_profile_url'
         AND e.status IN ('unique', 'resolved') AND e.external_id = ANY(${paths})
    `;
    console.log(
      `${count}/${targets.length} of the pinned AFL Tables paths already resolve to a player on `
      + `'${REHEARSAL_DATABASE}' (expect 0 before apply, ${targets.length} after).`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function apply(): Promise<void> {
  const ownerDsn = requireCodeTestDsn('AFLDB_CODE_TEST_DATABASE_URL');
  const importDsn = requireCodeTestDsn('AFLDB_CODE_TEST_IMPORT_DATABASE_URL');
  const targets = loadTargets();

  const ownerSql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
  let actor: ProdActorRow;
  try {
    await assertConnectedTo(ownerSql);
    actor = await fetchRehearsalActor(ownerSql);
  } finally {
    await ownerSql.end({ timeout: 5 });
  }

  const sql = postgres(importDsn, { max: 1, onnotice: () => {} });
  try {
    await assertConnectedTo(sql, 'afldb_import');
    // No pre-fetched actor row is passed to the write: runProdAdoptionWrite's first act re-reads
    // and re-asserts this exact actor id, authoritatively, inside this same transaction (AFLDB-
    // ISSUE-251 finding) — the fetch above is only how this harness learns the id to pass.
    const outcome = await sql.begin((tx) => runProdAdoptionWrite(tx, {
      targets, adminUserId: actor.id,
    }));
    console.log(`APPLY complete: ${outcome.created.length} player(s) created and attached.`);
    for (const r of outcome.integrityResults) console.log(`  ${r}`);
    console.log('Transaction committed = yes');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function verify(): Promise<void> {
  const importDsn = requireCodeTestDsn('AFLDB_CODE_TEST_IMPORT_DATABASE_URL');
  const targets = loadTargets();
  const sql = postgres(importDsn, { max: 1, onnotice: () => {} });
  try {
    await assertConnectedTo(sql, 'afldb_import');
    const paths = targets.map((t) => t.profilePath);
    const identities = await sql<{ externalId: string; playerId: number | null; status: string }[]>`
      SELECT e.external_id AS "externalId", e.player_id AS "playerId", e.status::text AS status
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afltables' AND e.external_id = ANY(${paths})
    `;
    const resolved = identities.filter((i) => i.playerId !== null && (i.status === 'unique' || i.status === 'resolved'));
    if (resolved.length !== targets.length) {
      throw new RehearsalRefused(
        `deterministic second classification expected all ${targets.length} paths resolved; observed `
        + `${resolved.length}.`,
      );
    }
    const [{ count: afl_api_count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM external_identities e
        JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afl_api' AND e.player_id = ANY(${resolved.map((r) => r.playerId as number)})
    `;
    if (Number(afl_api_count) !== 0) {
      throw new RehearsalRefused(`${afl_api_count} afl_api identities exist for the adopted players; expected 0.`);
    }
    console.log(
      `VERIFY: all ${targets.length} paths resolved (deterministic second classification), `
      + '0 afl_api identities among the adopted players.',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function teardown(): Promise<void> {
  const ownerDsn = requireCodeTestDsn('AFLDB_CODE_TEST_DATABASE_URL');
  const targets = loadTargets();
  const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
  try {
    await assertConnectedTo(sql);
    const paths = targets.map((t) => t.profilePath);
    await sql.begin(async (tx) => {
      const identities = await tx<{ playerId: number | null }[]>`
        SELECT e.player_id AS "playerId"
          FROM external_identities e JOIN sources s ON s.id = e.source_id
         WHERE s.key = 'afltables' AND e.external_id = ANY(${paths})
      `;
      const playerIds = identities.map((i) => i.playerId).filter((id): id is number => id !== null);
      if (playerIds.length > 0) {
        // recordDataEdit() (inside attachAflTablesIdentityInTransaction) writes one append-only
        // data_edits row per cohort player, admin_user_id-FK'd to the rehearsal actor. Left in
        // place, that FK refuses the actor DELETE below. Scoped to exactly the cohort's own
        // player rows (table_name='players', row_id = the cohort's player ids) -- never a
        // blanket delete by admin_user_id, so this can never remove another actor's audit trail.
        await tx`DELETE FROM data_edits WHERE table_name = 'players' AND row_id = ANY(${playerIds})`;
        await tx`DELETE FROM data_overrides WHERE entity_type = 'players'
                  AND split_part(entity_key, ':', 1) = 'manual_admin_edit'
                  AND entity_key IN (
                    SELECT 'manual_admin_edit:' || e2.external_id
                      FROM external_identities e2 JOIN sources s2 ON s2.id = e2.source_id
                     WHERE s2.key = 'manual_admin_edit' AND e2.player_id = ANY(${playerIds})
                  )`;
        await tx`DELETE FROM external_identities WHERE player_id = ANY(${playerIds})`;
        await tx`DELETE FROM player_career_stats WHERE player_id = ANY(${playerIds})`;
        await tx`DELETE FROM players WHERE id = ANY(${playerIds})`;
      }
      await tx`DELETE FROM auth_sessions WHERE user_id = (
                 SELECT id FROM auth_users WHERE lower(email) = ${REHEARSAL_ACTOR_EMAIL}
               )`;
      await tx`DELETE FROM auth_users WHERE lower(email) = ${REHEARSAL_ACTOR_EMAIL}`;
      console.log(`Teardown: removed ${playerIds.length} player(s) and the rehearsal actor.`);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function residue(): Promise<void> {
  const ownerDsn = requireCodeTestDsn('AFLDB_CODE_TEST_DATABASE_URL');
  const targets = loadTargets();
  const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
  try {
    await assertConnectedTo(sql);
    const paths = targets.map((t) => t.profilePath);
    const [{ count: pathCount }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afltables' AND e.external_id = ANY(${paths})
    `;
    const [{ count: actorCount }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM auth_users WHERE lower(email) = ${REHEARSAL_ACTOR_EMAIL}
    `;
    console.log(`Residue: ${pathCount} pinned path(s) still present, ${actorCount} rehearsal actor row(s) still present.`);
    if (Number(pathCount) !== 0 || Number(actorCount) !== 0) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const step = process.argv[2];
  if (step === 'seed') return seed();
  if (step === 'classify') return classify();
  if (step === 'apply') return apply();
  if (step === 'verify') return verify();
  if (step === 'teardown') return teardown();
  if (step === 'residue') return residue();
  throw new RehearsalRefused(`Unknown step '${String(step)}': seed, classify, apply, verify, teardown or residue.`);
}

if (process.argv[1] && /issue251_prod_rehearsal\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
