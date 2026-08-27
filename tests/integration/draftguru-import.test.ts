import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { confirmUnlinked, resolveLink } from '@/db/queries/player-links';

import { lockDraftTables, unlockDraftTables } from './draft-lock';

/*
 * TEST DATABASE SAFETY — this must run before anything imports a production helper.
 *
 * tests/setup.ts redirects DATABASE_URL to afldb_test and refuses any value that does
 * not end in `_test`. It does NOT touch AFLDB_IMPORT_DATABASE_URL, and the repository's
 * .env sets that to afldb_dev. Production helpers that open their own import-role
 * connection read it directly — `resolveLink` does exactly that at
 * src/db/queries/player-links.ts:481 — so without this redirect an in-process admin
 * mutation issued by a test would land in afldb_dev.
 *
 * The module-level redirect is the established convention in this directory
 * (awards-reload-links.test.ts:39, first-kick-goal-reload-links.test.ts:46,
 * data-editor.test.ts:9).
 */
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

/**
 * AFLDB-ISSUE-093 Stage B2-4/5 — behavioural proofs for the SUPPORTED DraftGuru
 * importer, tools/rebuild/draftguru/import_draftguru.py.
 *
 * This is the supported successor to tests/integration/draft-reload-links.test.ts, which
 * B2-7 retired along with the legacy importer it drove. That suite could only run when
 * AFLDB_LEGACY_SQLITE was present, which is exactly the coupling ISSUE-093 exists to
 * remove. Every invariant it protected is carried here — migration-069 stable person and
 * pick identity, source ownership, manual link preservation, confirmed_unlinked,
 * contradictory-decision refusal, foreign-row preservation and idempotence — mapped
 * one-for-one in AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md §89.
 *
 * Everything here runs against afldb_test (tests/setup.ts enforces the _test
 * allowlist) and holds the shared draft advisory lock, because it reconciles the
 * real 6,810-row draft population that release-gates.test.ts also counts.
 *
 * Prerequisites, asserted rather than assumed — the suite SKIPS with a clear reason
 * when they are absent:
 *   * psycopg in the repo virtualenv;
 *   * the accepted Stage A snapshot on disk (it is gitignored);
 *   * reference data loaded (sources `draftguru` + `afltables`, and clubs).
 *
 * The three AFL Tables players the real tracked ledger names are ensured to exist
 * before the import and removed afterwards if this suite created them, so the test
 * does not depend on a completed fitzRoy core import. It never fabricates the six
 * ledger values: it reads the real tracked ledger.
 */

const root = process.cwd();
const LEDGER_PATH = join(root, 'data', 'reference', 'draftguru-link-decisions.json');
const SNAPSHOT_DIR = join(root, 'data', 'sources', 'draftguru', 'annual-html-20260826');

const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

const canRun = hasPsycopg()
  && existsSync(join(SNAPSHOT_DIR, 'raw', 'years'))
  && existsSync(LEDGER_PATH);

type Ledger = {
  decisions: {
    player_url: string;
    decision: 'linked' | 'confirmed_unlinked';
    target: { source: string; external_id: string } | null;
  }[];
};

const ledger: Ledger = canRun
  ? JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  : { decisions: [] };

const afltablesTargets = ledger.decisions
  .filter((d) => d.target?.source === 'afltables')
  .map((d) => d.target!.external_id);
const draftguruTargets = ledger.decisions
  .filter((d) => d.target?.source === 'draftguru')
  .map((d) => d.player_url);
const unlinkedKey = ledger.decisions.find((d) => d.decision === 'confirmed_unlinked')?.player_url;

/**
 * The DSN every database path in this file must use, asserted rather than assumed.
 *
 * guard.ts requires AFLDB_TEST_DATABASE_URL to be set and setup.ts refuses any value
 * that does not end in `_test`, so this is a third layer. It exists because the one
 * thing standing between the importer subprocess and afldb_dev is an env override, and
 * an override that silently resolved to undefined would let the subprocess fall back to
 * the .env value through the importer's own load_env().
 */
function requireTestDsn(): string {
  const dsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_TEST_DATABASE_URL is not set.');
  const database = new URL(dsn).pathname.replace(/^\//, '');
  if (!/_test$/.test(database)) {
    throw new Error(
      `Refusing to run the importer against '${database}': this suite may only target a `
      + '_test database.',
    );
  }
  return dsn;
}

function runImporter(extra: string[] = []) {
  const dsn = requireTestDsn();
  return spawnSync(
    python,
    ['tools/rebuild/draftguru/import_draftguru.py', '--quiet', ...extra],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AFLDB_IMPORT_DATABASE_URL: dsn },
    },
  );
}

function withTempJson(doc: unknown, body: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'afldb-dg-'));
  try {
    const path = join(dir, 'doc.json');
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    body(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Players this suite created so the ledger's afltables targets resolve. */
const provisionedPlayerIds: number[] = [];
let draftguruSourceId = 0;
let afltablesSourceId = 0;
let referenceReady = false;

async function sourceId(key: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM sources WHERE key = ${key}`;
  return row?.id ?? 0;
}

/** The distinctive marker for a player this suite created; nothing else uses it. */
const FIXTURE_SLUG_PREFIX = 'b2-4-fixture-';

/**
 * Release every reference to these fixture players, then delete them.
 *
 * The imported 5,057 persons / 6,810 picks are the rebuild's intended state, not fixture
 * pollution, so they are never deleted. But three of those persons are linked — correctly
 * — to fixture players, and `draft_picks.player_id`, `draft_persons.player_id` and the
 * importer's own `external_identities(draftguru)` rows all reference them, so a fixture
 * player cannot simply be deleted.
 *
 * References are therefore RELEASED rather than the referencing rows destroyed. Every
 * statement is scoped to `ids`, and each null-out is paired with the link status its CHECK
 * constraint requires (`draft_picks_link_ck`, `draft_persons_link_ck`). The source-owned
 * population is left intact and unlinked — exactly the state the next run re-provisions
 * from.
 *
 * Only `afltables` identity rows belonging to these fixture players are deleted; the
 * importer's own `draftguru` identity rows are unlinked, not removed. Nothing is CASCADEd
 * and no constraint is disabled: a reference this does not know about must surface as a
 * foreign-key error naming its table rather than be swallowed.
 */
async function releaseAndDeletePlayers(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await sql`
    UPDATE draft_picks SET player_id = NULL, link_status_value = 'unmatched'
     WHERE player_id = ANY(${ids})`;
  await sql`
    UPDATE draft_persons SET player_id = NULL, link_status = 'unmatched'
     WHERE player_id = ANY(${ids})`;
  await sql`
    UPDATE external_identities SET player_id = NULL, status = 'unmatched'
     WHERE player_id = ANY(${ids}) AND source_id = ${draftguruSourceId}`;
  await sql`
    DELETE FROM external_identities
     WHERE player_id = ANY(${ids}) AND source_id = ${afltablesSourceId}`;
  await sql`DELETE FROM players WHERE id = ANY(${ids})`;
}

describe.skipIf(!canRun)('DraftGuru supported importer (afldb_test)', () => {
  beforeAll(async () => {
    await lockDraftTables();
    draftguruSourceId = await sourceId('draftguru');
    afltablesSourceId = await sourceId('afltables');
    const [clubCount] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM clubs`;
    referenceReady = Boolean(draftguruSourceId && afltablesSourceId && clubCount.n > 0);
    if (!referenceReady) return;

    // Self-heal: a previous run that failed mid-teardown can leave its fixture players
    // behind. They are identified by this suite's own slug marker and nothing else, and
    // are released and removed the same ownership-safe way teardown does.
    const stale = await sql<{ id: number }[]>`
      SELECT id FROM players WHERE slug LIKE ${`${FIXTURE_SLUG_PREFIX}%`}`;
    await releaseAndDeletePlayers(stale.map((row) => row.id));

    // Ensure the ledger's AFL Tables targets resolve. Created only when absent, so a
    // database that already carries a fitzRoy core import is used as-is.
    for (const externalId of afltablesTargets) {
      const [existing] = await sql<{ player_id: number | null }[]>`
        SELECT player_id FROM external_identities
         WHERE source_id = ${afltablesSourceId} AND external_id = ${externalId}
      `;
      if (existing?.player_id) continue;
      const [player] = await sql<{ id: number }[]>`
        INSERT INTO players (display_name, sort_name, search_name, slug)
        VALUES ('B2-4 Fixture Target', 'Fixture, B2-4',
                afldb_normalise_name('B2-4 Fixture Target'), ${`b2-4-fixture-${externalId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`})
        RETURNING id
      `;
      provisionedPlayerIds.push(player.id);
      await sql`
        INSERT INTO external_identities
          (source_id, external_id, external_url, player_id, status, match_method)
        VALUES (${afltablesSourceId}, ${externalId}, NULL, ${player.id},
                'unique', 'afltables_profile_url')
        ON CONFLICT (source_id, external_id) DO UPDATE SET player_id = EXCLUDED.player_id
      `;
    }
  }, 120_000);

  afterAll(async () => {
    try {
      if (referenceReady) await releaseAndDeletePlayers(provisionedPlayerIds);
    } finally {
      // The advisory lock is session-held; releasing it must not depend on cleanup.
      await unlockDraftTables();
    }
  }, 120_000);

  it('has its reference prerequisites loaded', () => {
    expect(referenceReady,
      'afldb_test needs reference data loaded (sources draftguru + afltables, clubs) '
      + 'before the DraftGuru importer can run: '
      + 'python tools/migration/load_reference_data.py').toBe(true);
  });

  describe.skipIf(!canRun)('first import', () => {
    it('imports the accepted Stage A population', async () => {
      const run = runImporter();
      expect(run.stdout + run.stderr).not.toMatch(/REFUSED|Traceback/);
      expect(run.status).toBe(0);

      const [persons] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM draft_persons WHERE source_id = ${draftguruSourceId}`;
      const [picks] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM draft_picks WHERE source_id = ${draftguruSourceId}`;
      expect(persons.n).toBe(5057);
      expect(picks.n).toBe(6810);
    }, 600_000);

    it('registers one DraftGuru external identity per person, ordinals intact', async () => {
      const [ids] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM external_identities
         WHERE source_id = ${draftguruSourceId}`;
      expect(ids.n).toBe(5057);

      // the proven convergence pair stays two people: nothing collapses an ordinal
      const pair = await sql<{ player_url: string }[]>`
        SELECT player_url FROM draft_persons
         WHERE source_id = ${draftguruSourceId}
           AND player_url LIKE 'https://www.draftguru.com.au/players/brad_miller/%'
         ORDER BY player_url`;
      expect(pair.map((p) => p.player_url)).toEqual([
        'https://www.draftguru.com.au/players/brad_miller/1',
        'https://www.draftguru.com.au/players/brad_miller/2',
      ]);
    });

    it('applies every explicit afltables decision to the existing canonical player', async () => {
      for (const decision of ledger.decisions.filter((d) => d.target?.source === 'afltables')) {
        const [person] = await sql<{ playerId: number | null; status: string }[]>`
          SELECT player_id AS "playerId", link_status::text AS status
            FROM draft_persons
           WHERE source_id = ${draftguruSourceId} AND player_url = ${decision.player_url}`;
        const [identity] = await sql<{ playerId: number }[]>`
          SELECT player_id AS "playerId" FROM external_identities
           WHERE source_id = ${afltablesSourceId}
             AND external_id = ${decision.target!.external_id}`;
        expect(person.playerId).toBe(identity.playerId);
        expect(person.status).toBe('resolved');
      }
    });

    it('creates exactly one minimal seed per draftguru decision, with nothing private',
      async () => {
        for (const url of draftguruTargets) {
          const seeds = await sql<{ id: number; dob: Date | null; weight: number | null;
            notes: string | null; height: number | null; slug: string }[]>`
            SELECT p.id, p.dob, p.weight_kg AS weight, p.notes, p.height_cm AS height, p.slug
              FROM players p
              JOIN external_identities ei ON ei.player_id = p.id
             WHERE ei.source_id = ${draftguruSourceId} AND ei.external_id = ${url}`;
          expect(seeds).toHaveLength(1);
          const seed = seeds[0];
          expect(seed.dob).toBeNull();
          expect(seed.weight).toBeNull();
          expect(seed.notes).toBeNull();
          expect(seed.height).toBeNull();
          expect(seed.slug).not.toBe('');

          // a zero-game player gets no career-stats row: rebuild_derived.py regenerates
          // that table from player_match_stats and would drop one anyway
          const [career] = await sql<{ n: number }[]>`
            SELECT count(*)::int AS n FROM player_career_stats WHERE player_id = ${seed.id}`;
          expect(career.n).toBe(0);
        }
      });

    it('leaves the confirmed_unlinked person genuinely unlinked', async () => {
      expect(unlinkedKey).toBeTruthy();
      const [person] = await sql<{ playerId: number | null; status: string }[]>`
        SELECT player_id AS "playerId", link_status::text AS status
          FROM draft_persons
         WHERE source_id = ${draftguruSourceId} AND player_url = ${unlinkedKey!}`;
      expect(person.playerId).toBeNull();
      expect(person.status).toBe('unmatched');
    });

    it('leaves every unbridged person unmatched — no automatic fallback', async () => {
      // with no bridge dataset supplied, only the ledger may produce a link
      const [linked] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM draft_persons
         WHERE source_id = ${draftguruSourceId} AND player_id IS NOT NULL`;
      expect(linked.n).toBe(ledger.decisions.filter((d) => d.decision === 'linked').length);
    });

    it('enforces the frozen column contracts', async () => {
      const [row] = await sql<{ detail: number; weight: number; grade: number;
        brisbane: number; brisbaneNull: number; vfl: number; afl: number }[]>`
        SELECT count(*) FILTER (WHERE signing_detail IS NOT NULL)::int AS detail,
               count(*) FILTER (WHERE weight_kg IS NOT NULL)::int     AS weight,
               count(*) FILTER (WHERE grade IS NOT NULL)::int         AS grade,
               count(*) FILTER (WHERE club_name_raw = 'Brisbane')::int AS brisbane,
               count(*) FILTER (WHERE club_name_raw = 'Brisbane'
                                  AND club_id IS NULL)::int           AS "brisbaneNull",
               count(*) FILTER (WHERE competition = 'VFL')::int       AS vfl,
               count(*) FILTER (WHERE competition = 'AFL')::int       AS afl
          FROM draft_picks WHERE source_id = ${draftguruSourceId}`;
      expect(row.detail).toBe(0);
      expect(row.weight).toBe(0);
      expect(row.grade).toBe(0);
      expect(row.brisbane).toBe(422);
      expect(row.brisbaneNull).toBe(422);
      expect(row.vfl).toBe(604);
      expect(row.afl).toBe(6206);
    });

    it('reproduces the frozen name_key rule, not the SQL normaliser', async () => {
      // the 131 persons whose name carries a hyphen, apostrophe or accent are exactly
      // where the two rules disagree; name_key must follow the frozen DraftGuru rule
      const [row] = await sql<{ differing: number }[]>`
        SELECT count(*)::int AS differing FROM draft_persons
         WHERE source_id = ${draftguruSourceId}
           AND name_key IS DISTINCT FROM afldb_normalise_name(display_name_raw)`;
      expect(row.differing).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!canRun)('reload behaviour', () => {
    it('is idempotent over identical inputs', async () => {
      const before = await sql<{ id: number; url: string }[]>`
        SELECT id, player_url AS url FROM draft_persons
         WHERE source_id = ${draftguruSourceId} ORDER BY player_url LIMIT 200`;
      const [seedsBefore] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM external_identities
         WHERE source_id = ${draftguruSourceId} AND player_id IS NOT NULL`;

      const run = runImporter();
      expect(run.status).toBe(0);

      const after = await sql<{ id: number; url: string }[]>`
        SELECT id, player_url AS url FROM draft_persons
         WHERE source_id = ${draftguruSourceId} ORDER BY player_url LIMIT 200`;
      const [seedsAfter] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM external_identities
         WHERE source_id = ${draftguruSourceId} AND player_id IS NOT NULL`;
      const [persons] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM draft_persons WHERE source_id = ${draftguruSourceId}`;
      const [picks] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM draft_picks WHERE source_id = ${draftguruSourceId}`;

      expect(after).toEqual(before);            // stable row ids
      expect(persons.n).toBe(5057);
      expect(picks.n).toBe(6810);
      expect(seedsAfter.n).toBe(seedsBefore.n); // no second seed player was minted
    }, 600_000);

    it('does not touch an admin-created pick it does not own', async () => {
      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO draft_picks (draft_year, draft_type, player_name_raw, link_status_value)
        VALUES (2001, 'National Draft', 'B2-4 Ownership Fixture', 'unmatched')
        RETURNING id`;
      try {
        const run = runImporter();
        expect(run.status).toBe(0);
        const [survivor] = await sql<{ id: number }[]>`
          SELECT id FROM draft_picks WHERE id = ${admin.id}`;
        expect(survivor,
          'a source_id IS NULL row is outside the reload and must survive it').toBeDefined();
      } finally {
        await sql`DELETE FROM draft_picks WHERE id = ${admin.id}`;
      }
    }, 600_000);
  });

  describe.skipIf(!canRun)('bridge interface', () => {
    it('links a person through an admissible bridge', async () => {
      // a person with no ledger decision, bridged to a target this suite can resolve
      const [candidate] = await sql<{ url: string }[]>`
        SELECT player_url AS url FROM draft_persons
         WHERE source_id = ${draftguruSourceId} AND player_id IS NULL
         ORDER BY player_url LIMIT 1`;
      const [target] = await sql<{ externalId: string }[]>`
        SELECT external_id AS "externalId" FROM external_identities
         WHERE source_id = ${afltablesSourceId} AND player_id IS NOT NULL
           AND external_id ~ '^players/[A-Za-z]/[^/]+\\.html$'
         ORDER BY external_id LIMIT 1`;

      withTempJson({
        schema_version: 1,
        bridges: [{ player_url: candidate.url, afltables_external_id: target.externalId }],
      }, (path) => {
        const run = runImporter(['--bridge', path]);
        expect(run.stdout + run.stderr).not.toMatch(/REFUSED|Traceback/);
        expect(run.status).toBe(0);
      });

      const [person] = await sql<{ playerId: number | null; status: string;
        method: string | null }[]>`
        SELECT player_id AS "playerId", link_status::text AS status,
               match_method AS method
          FROM draft_persons
         WHERE source_id = ${draftguruSourceId} AND player_url = ${candidate.url}`;
      expect(person.playerId).not.toBeNull();
      // 'unique', never 'resolved' — that stays reserved for a human decision
      expect(person.status).toBe('unique');
      expect(person.method).toBe('draftguru_person_page_afltables_bridge');

      // and the plain reload puts it back to unmatched, since no bridge is then supplied
      const back = runImporter();
      expect(back.status).toBe(0);
    }, 900_000);

    it('halts and rolls back when a bridge contradicts an explicit decision', async () => {
      const contradicted = ledger.decisions.find((d) => d.target?.source === 'afltables')!;
      const [other] = await sql<{ externalId: string }[]>`
        SELECT external_id AS "externalId" FROM external_identities
         WHERE source_id = ${afltablesSourceId} AND player_id IS NOT NULL
           AND external_id <> ${contradicted.target!.external_id}
           AND external_id ~ '^players/[A-Za-z]/[^/]+\\.html$'
         ORDER BY external_id LIMIT 1`;

      const [before] = await sql<{ playerId: number | null }[]>`
        SELECT player_id AS "playerId" FROM draft_persons
         WHERE source_id = ${draftguruSourceId} AND player_url = ${contradicted.player_url}`;

      withTempJson({
        schema_version: 1,
        bridges: [{
          player_url: contradicted.player_url,
          afltables_external_id: other.externalId,
        }],
      }, (path) => {
        const run = runImporter(['--bridge', path]);
        expect(run.status).toBe(1);
        expect(run.stdout).toContain('contradicts an explicit human decision');
      });

      const [after] = await sql<{ playerId: number | null }[]>`
        SELECT player_id AS "playerId" FROM draft_persons
         WHERE source_id = ${draftguruSourceId} AND player_url = ${contradicted.player_url}`;
      expect(after.playerId,
        'the human decision must survive a contradicting bridge').toBe(before.playerId);
    }, 900_000);
  });

  // -----------------------------------------------------------------------
  // B2-6 gate: an explicit afltables target that does not resolve must HALT,
  // and must never be replaced by a player invented from DraftGuru facts.
  // -----------------------------------------------------------------------
  describe.skipIf(!canRun)('missing afltables target', () => {
    it('halts, creates no replacement player, and changes nothing', async () => {
      const target = afltablesTargets[0];
      const [beforeIdentity] = await sql<{ playerId: number | null; status: string }[]>`
        SELECT player_id AS "playerId", status::text AS status FROM external_identities
         WHERE source_id = ${afltablesSourceId} AND external_id = ${target}`;
      const [beforePlayers] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM players`;
      const [beforePerson] = await sql<{ playerId: number | null; status: string }[]>`
        SELECT player_id AS "playerId", link_status::text AS status FROM draft_persons
         WHERE source_id = ${draftguruSourceId}
           AND player_url = ${ledger.decisions.find(
             (d) => d.target?.external_id === target)!.player_url}`;

      // Isolate rather than delete: the identity row stays, but stops resolving.
      await sql`
        UPDATE external_identities SET status = 'unmatched', player_id = NULL
         WHERE source_id = ${afltablesSourceId} AND external_id = ${target}`;
      try {
        const run = runImporter();
        expect(run.status).toBe(1);
        expect(run.stdout).toContain('canonical players after the fitzRoy import');
        expect(run.stdout).toContain('Refusing to create a replacement player');

        const [afterPlayers] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM players`;
        expect(afterPlayers.n,
          'no replacement canonical player may be invented from DraftGuru facts')
          .toBe(beforePlayers.n);

        const [afterPerson] = await sql<{ playerId: number | null; status: string }[]>`
          SELECT player_id AS "playerId", link_status::text AS status FROM draft_persons
           WHERE source_id = ${draftguruSourceId}
             AND player_url = ${ledger.decisions.find(
               (d) => d.target?.external_id === target)!.player_url}`;
        expect(afterPerson).toEqual(beforePerson);
      } finally {
        // Restore EXACTLY what was there — not merely some fixture player, which could
        // rebind this target to the wrong person.
        await sql`
          UPDATE external_identities
             SET status = ${beforeIdentity.status}::link_status,
                 player_id = ${beforeIdentity.playerId}
           WHERE source_id = ${afltablesSourceId} AND external_id = ${target}`;
      }
      const restored = runImporter();
      expect(restored.status).toBe(0);
    }, 900_000);
  });

  // -----------------------------------------------------------------------
  // B2-6 gate: source ownership. A deliberate NATURAL-key collision on an
  // admin-owned row, which is materially stronger than preserving an
  // unrelated admin pick.
  // -----------------------------------------------------------------------
  describe.skipIf(!canRun)('ownership boundary', () => {
    it('leaves an admin-owned row sharing a source row\'s natural key untouched',
      async () => {
        const [source] = await sql<{ url: string; year: number; kind: string }[]>`
          SELECT player_url AS url, draft_year AS year, draft_kind AS kind
            FROM draft_picks
           WHERE source_id = ${draftguruSourceId}
           ORDER BY player_url, draft_year LIMIT 1`;

        // Same (player_url, draft_year, draft_kind) as a real source row, but owned by
        // nobody: source_id IS NULL. migration 069's unique index is PARTIAL on
        // source_id IS NOT NULL, so the two coexist by design — ownership, not the
        // natural key alone, is what separates them.
        const [foreign] = await sql<{ id: number }[]>`
          INSERT INTO draft_picks
            (draft_year, draft_type, draft_kind, player_url, player_name_raw,
             link_status_value)
          VALUES (${source.year}, 'National Draft', ${source.kind}, ${source.url},
                  'B2-6 Ownership Collision Fixture', 'unmatched')
          RETURNING id`;
        try {
          const run = runImporter();
          expect(run.stdout + run.stderr).not.toMatch(/Traceback/);
          expect(run.status).toBe(0);

          const [survivor] = await sql<{ id: number; name: string; sourceId: number | null;
            playerId: number | null; status: string }[]>`
            SELECT id, player_name_raw AS name, source_id AS "sourceId",
                   player_id AS "playerId", link_status_value::text AS status
              FROM draft_picks WHERE id = ${foreign.id}`;
          expect(survivor, 'the reload must not delete a row it does not own').toBeDefined();
          expect(survivor.name).toBe('B2-6 Ownership Collision Fixture');
          expect(survivor.sourceId, 'the reload must not adopt a foreign row').toBeNull();
          expect(survivor.playerId).toBeNull();
          expect(survivor.status).toBe('unmatched');

          // and the source-owned row with the same natural key is still there and owned
          const [owned] = await sql<{ n: number }[]>`
            SELECT count(*)::int AS n FROM draft_picks
             WHERE source_id = ${draftguruSourceId} AND player_url = ${source.url}
               AND draft_year = ${source.year}
               AND draft_kind IS NOT DISTINCT FROM ${source.kind}`;
          expect(owned.n).toBe(1);
        } finally {
          await sql`DELETE FROM draft_picks WHERE id = ${foreign.id}`;
        }
      }, 900_000);
  });

  // -----------------------------------------------------------------------
  // B2-6 gate: a live human decision made AFTER the rebuild must survive a
  // later source reload (AFLDB-ISSUE-078).
  // -----------------------------------------------------------------------
  describe.skipIf(!canRun)('live human decision authority', () => {
    it('preserves an admin link across a source reload', async () => {
      // A person the source leaves unmatched, and a player to link them to. This is the
      // only shape the supported admin path can produce: resolveLockedLink refuses a
      // target that is already linked (src/db/queries/player-links.ts:463), so an admin
      // cannot contradict a ledger-derived link through the UI at all.
      const [person, other] = await sql<{ url: string; pickId: number }[]>`
        SELECT p.player_url AS url, min(k.id)::int AS "pickId"
          FROM draft_persons p
          JOIN draft_picks k ON k.draft_person_id = p.id
         WHERE p.source_id = ${draftguruSourceId} AND p.player_id IS NULL
         GROUP BY p.player_url
         ORDER BY p.player_url LIMIT 2`;
      const [player] = await sql<{ id: number }[]>`
        SELECT id FROM players WHERE id = ANY(${provisionedPlayerIds}) ORDER BY id LIMIT 1`;

      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES ('b2-6-fixture@example.invalid', 'super_admin')
        ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
        RETURNING id`;
      try {
        const applied = await resolveLink({
          targetTable: 'draft_picks',
          targetId: person.pickId,
          playerId: player.id,
          adminUserId: admin.id,
          note: 'B2-6 live decision fixture',
        });
        expect(applied.ok, `resolveLink failed: ${JSON.stringify(applied)}`).toBe(true);

        // A live confirmed_unlinked on a DIFFERENT person, so one reload proves both
        // decision kinds survive without paying for a second 6,810-row import.
        const vetoed = await confirmUnlinked({
          targetTable: 'draft_picks',
          targetId: other.pickId,
          adminUserId: admin.id,
          note: 'B2-6 live confirmed_unlinked fixture',
        });
        expect(vetoed.ok, `confirmUnlinked failed: ${JSON.stringify(vetoed)}`).toBe(true);

        const [linked] = await sql<{ playerId: number | null }[]>`
          SELECT player_id AS "playerId" FROM draft_persons
           WHERE source_id = ${draftguruSourceId} AND player_url = ${person.url}`;
        expect(linked.playerId).toBe(player.id);

        // The reload writes link state from its own incoming rows, so without the live
        // decision read this person would go straight back to unmatched.
        const run = runImporter();
        expect(run.status).toBe(0);

        const [after] = await sql<{ playerId: number | null; status: string;
          method: string | null }[]>`
          SELECT player_id AS "playerId", link_status::text AS status,
                 match_method AS method
            FROM draft_persons
           WHERE source_id = ${draftguruSourceId} AND player_url = ${person.url}`;
        expect(after.playerId,
          'a reload must not discard a live admin decision').toBe(player.id);
        expect(after.status).toBe('resolved');
        expect(after.method).toBe('draftguru_explicit_admin_decision');

        // every pick of that person carries it too — identity is person-grained
        const [picks] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM draft_picks k
            JOIN draft_persons p ON p.id = k.draft_person_id
           WHERE p.player_url = ${person.url} AND p.source_id = ${draftguruSourceId}
             AND k.player_id IS DISTINCT FROM ${player.id}`;
        expect(picks.n).toBe(0);

        // The live veto survives too, person-grained and still genuinely unlinked.
        const [veto] = await sql<{ playerId: number | null; status: string;
          method: string | null }[]>`
          SELECT player_id AS "playerId", link_status::text AS status,
                 match_method AS method
            FROM draft_persons
           WHERE source_id = ${draftguruSourceId} AND player_url = ${other.url}`;
        expect(veto.playerId).toBeNull();
        expect(veto.status).toBe('unmatched');
        expect(veto.method).toBe('draftguru_explicit_admin_decision');
      } finally {
        await sql`DELETE FROM player_link_resolutions WHERE admin_user_id = ${admin.id}`;
        await sql`DELETE FROM data_edits WHERE admin_user_id = ${admin.id}`
          .catch(() => undefined);
        await sql`DELETE FROM auth_users WHERE id = ${admin.id}`;
      }
      // With the decision gone the source reasserts itself: back to unmatched.
      const restored = runImporter();
      expect(restored.status).toBe(0);
      const [reset] = await sql<{ playerId: number | null }[]>`
        SELECT player_id AS "playerId" FROM draft_persons
         WHERE source_id = ${draftguruSourceId} AND player_url = ${person.url}`;
      expect(reset.playerId).toBeNull();
    }, 900_000);

    /*
     * Migrated from tests/integration/draft-reload-links.test.ts, which B2-7 retired with
     * the legacy importer. Identity is person-grained (migration 019), so two picks of one
     * person cannot carry disagreeing decisions; taking either silently would let one
     * pick's decision override another's. B2 handoff §16 requires a HALT here and says
     * --allow-link-loss deliberately does not apply.
     */
    it('halts when one person carries contradictory decisions across two picks', async () => {
      const [person] = await sql<{ url: string; first: number; second: number }[]>`
        SELECT p.player_url AS url,
               min(k.id)::int AS first, max(k.id)::int AS second
          FROM draft_persons p
          JOIN draft_picks k ON k.draft_person_id = p.id
         WHERE p.source_id = ${draftguruSourceId} AND p.player_id IS NULL
         GROUP BY p.player_url
        HAVING count(k.id) > 1
         ORDER BY p.player_url LIMIT 1`;
      expect(person, 'need a person with at least two picks').toBeDefined();

      const [player] = await sql<{ id: number }[]>`
        SELECT id FROM players WHERE id = ANY(${provisionedPlayerIds}) ORDER BY id LIMIT 1`;
      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES ('b2-7-contradiction@example.invalid', 'super_admin')
        ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
        RETURNING id`;
      try {
        // One pick linked, a sibling pick of the SAME person confirmed unlinked. The admin
        // UI refuses to create this, so it is written directly — the importer must not
        // assume the audit trail can only ever be self-consistent.
        await sql`
          INSERT INTO player_link_resolutions
            (target_table, target_id, action, player_id, previous_status, admin_user_id)
          VALUES ('draft_picks', ${person.first}, 'linked', ${player.id}, 'unmatched',
                  ${admin.id}),
                 ('draft_picks', ${person.second}, 'confirmed_unlinked', NULL, 'unmatched',
                  ${admin.id})`;

        const run = runImporter();
        expect(run.status).toBe(1);
        expect(run.stdout + run.stderr).toContain('contradictory explicit admin');

        // nothing was written: the person is still exactly as the last good run left it
        const [after] = await sql<{ playerId: number | null; status: string }[]>`
          SELECT player_id AS "playerId", link_status::text AS status FROM draft_persons
           WHERE source_id = ${draftguruSourceId} AND player_url = ${person.url}`;
        expect(after.playerId).toBeNull();
        expect(after.status).toBe('unmatched');
      } finally {
        await sql`DELETE FROM player_link_resolutions WHERE admin_user_id = ${admin.id}`;
        await sql`DELETE FROM data_edits WHERE admin_user_id = ${admin.id}`
          .catch(() => undefined);
        await sql`DELETE FROM auth_users WHERE id = ${admin.id}`;
      }
      const restored = runImporter();
      expect(restored.status).toBe(0);
    }, 900_000);
  });

  // -----------------------------------------------------------------------
  // B2-6 gate: a failure AFTER the reload has written must roll every source
  // mutation back, and the failed batch must survive that rollback as audit.
  // -----------------------------------------------------------------------
  describe.skipIf(!canRun)('failed run: rollback and durable audit', () => {
    const SENTINEL = 'B2-6-ROLLBACK-SENTINEL';
    const FIXTURE_URL_PREFIX = 'https://www.draftguru.com.au/players/b2-6-fixture-';

    it('rolls back partial source mutations and records a failed batch', async () => {
      const [victim] = await sql<{ url: string; id: number; note: string | null }[]>`
        SELECT player_url AS url, id, pick_note AS note FROM draft_picks
         WHERE source_id = ${draftguruSourceId}
         ORDER BY player_url, draft_year LIMIT 1`;

      // Something the reload MUST rewrite, so surviving proves the UPDATE rolled back.
      await sql`UPDATE draft_picks SET pick_note = ${SENTINEL} WHERE id = ${victim.id}`;

      // Trip the ISSUE-092 population-drop gate, which fires in
      // reconcile_draftguru_identities — after both keyed reloads have written.
      await sql`
        INSERT INTO external_identities (source_id, external_id, status, candidate_count)
        SELECT ${draftguruSourceId}, ${FIXTURE_URL_PREFIX} || g || '/1', 'unmatched', 0
          FROM generate_series(1, 700) AS g`;
      try {
        const run = runImporter();
        expect(run.status).toBe(1);
        expect(run.stdout + run.stderr).toMatch(/population-drop threshold|Refusing/);

        const [held] = await sql<{ note: string | null }[]>`
          SELECT pick_note AS note FROM draft_picks WHERE id = ${victim.id}`;
        expect(held.note,
          'a failed run must leave no partial source-owned mutation behind').toBe(SENTINEL);

        const [batch] = await sql<{ status: string; error: string | null }[]>`
          SELECT status, error FROM import_batches
           WHERE tool = 'import_draftguru.py'
           ORDER BY id DESC LIMIT 1`;
        expect(batch.status,
          'the failed batch is the durable audit and must survive the rollback')
          .toBe('failed');
        expect(batch.error).toBeTruthy();

        const [running] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM import_batches
           WHERE tool = 'import_draftguru.py' AND status = 'running'`;
        expect(running.n, 'no batch may be left stuck in running').toBe(0);
      } finally {
        await sql`
          DELETE FROM external_identities
           WHERE source_id = ${draftguruSourceId}
             AND external_id LIKE ${`${FIXTURE_URL_PREFIX}%`}`;
      }

      // Rerun after restoring the fixture proceeds normally and repairs the sentinel.
      const rerun = runImporter();
      expect(rerun.status).toBe(0);
      const [repaired] = await sql<{ note: string | null }[]>`
        SELECT pick_note AS note FROM draft_picks WHERE id = ${victim.id}`;
      expect(repaired.note).toBe(victim.note);

      const [ok] = await sql<{ status: string }[]>`
        SELECT status FROM import_batches
         WHERE tool = 'import_draftguru.py' ORDER BY id DESC LIMIT 1`;
      expect(ok.status).toBe('completed');
    }, 1_200_000);
  });
});
